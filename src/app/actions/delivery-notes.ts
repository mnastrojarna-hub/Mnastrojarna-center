"use server";

import { revalidatePath } from "next/cache";
import { createOperatorClient, isSupabaseConfigured } from "@/lib/supabase/server";
import { userActor } from "@/lib/supabase/actor-headers";
import { checkFeature } from "@/lib/auth/session";
import type { CurrentUser } from "@/lib/data/current-user";
import { getJob } from "@/lib/data/jobs";
import { logAudit } from "@/lib/audit";
import { logJobEvent, type JobsDb } from "@/lib/jobs/events";
import { isJobStage } from "@/lib/jobs/stages";
import { cleanText, isUuid, translateDbError } from "@/lib/jobs/mapping";
import type { ActionResult } from "@/lib/jobs/types";
import type { JobStage } from "@/lib/supabase/database.types";
import { round3, type DeliveryRowInput } from "@/lib/jobs/delivery-notes";
import {
  DeliveryNoteError, deliveryNoteLines, fileOfNote, issueDeliveryNote, issuedDeliveryNotes, reserveDeliveryNote,
  type DeliveryNoteRow, type IssueNoteResult,
} from "@/lib/jobs/delivery-notes-store";

/**
 * Zapsat dodání zákazníkovi + dodací list této dodávky (jedno tlačítko „Zapsat dodání a dodací list").
 * Pořadí: kontrola → ZÁBOR dodaného množství (podmíněný UPDATE „dodáno = from" u každé položky;
 * když jedna neprojde, už zabrané se vrátí a nic dalšího nevznikne — souběžný zápis kolegy vyhraje
 * jen jeden) → číslo DL (zábor řádku delivery_notes) → historie dodání s číslem DL → PDF do
 * Dokumentů zakázky. Když DL selže, dodání ZŮSTANE zapsané
 * a uživatel to vidí („Dodání je zapsané, dodací list se nepodařilo vystavit") + „Vystavit dodací
 * list znovu" se stejným číslem (reissue). Kdo smí zapsat dodání (workflow), smí vystavit i jeho DL
 * (bez cen). Data jdou servisním klíčem → oprávnění hlídá akce.
 */

const NOT_FOUND = "Zakázka nenalezena.";
const PATHS = ["/orders", "/documents", "/dashboard", "/"];

interface Ctx {
  db: JobsDb;
  user: CurrentUser;
}

async function begin(): Promise<Ctx | { error: string }> {
  if (!isSupabaseConfigured()) return { error: "Supabase není nakonfigurováno." };
  const access = await checkFeature("workflow");
  if ("error" in access) return { error: access.error };
  const db = await createOperatorClient({ actor: userActor(access.user) });
  return { db, user: access.user };
}

function fail(err: unknown): { ok: false; error: string } {
  if (typeof err === "string") return { ok: false, error: translateDbError(err) };
  if (err && typeof err === "object" && "message" in err) return { ok: false, error: translateDbError(String((err as { message: unknown }).message)) };
  return { ok: false, error: "Neočekávaná chyba." };
}

function myName(user: CurrentUser): string | undefined {
  return (user.fullName || "").trim() || (user.email || "").trim() || undefined;
}

function qty(n: number): string {
  return new Intl.NumberFormat("cs-CZ", { maximumFractionDigits: 3 }).format(n);
}

interface ItemRow {
  id: string; name: string | null; drawing_number: string | null; description: string | null;
  quantity: number | string; unit: string | null; delivered_quantity: number | string; delivery_closed: boolean;
}

function itemName(i: ItemRow): string {
  return (i.name ?? "").trim() || (i.drawing_number ?? "").trim() || (i.description ?? "").trim() || "Položka";
}

export type DeliveryNoteInfo = Pick<IssueNoteResult, "id" | "number" | "fileId" | "filename" | "version" | "label" | "final">;

export type RecordDeliveryResult = ActionResult<{
  stage: JobStage | null;
  /** Vystavený dodací list této dodávky (bez zaškrtnutí „Vystavit dodací list" chybí). */
  deliveryNote: DeliveryNoteInfo | null;
  /** Dodání se zapsalo (i když DL selhal — pak ok: false + retry). */
  recorded: boolean;
  /** „Vystavit dodací list znovu": rezervované číslo DL (id/number null = číslo se ještě nepřidělilo). */
  retry: { id: string | null; number: string | null } | null;
}>;

function conflict(item: ItemRow, now: number): string {
  return `${itemName(item)}: mezitím někdo zapsal dodání (teď ${qty(now)} ${item.unit ?? "ks"}) — zavři dialog a zkontroluj stav.`;
}

/**
 * Zapsat dodání po položkách (from = dodáno při otevření dialogu, to = dodáno po této dodávce)
 * a s issueNote vystavit dodací list jen s tím, co odešlo teď. reissue = dodání už je zapsané
 * (DL selhal) → jen vystavit jeho DL; retryId = rezervované číslo z té chyby (stejné číslo DL).
 * Souběžný zápis jiného uživatele → chyba „mezitím někdo zapsal", nic se nezapíše ani nevystaví.
 */
export async function recordDelivery(
  jobId: string,
  rows: DeliveryRowInput[],
  opts: { note?: string | null; issueNote?: boolean; retryId?: string | null; reissue?: boolean } = {},
): Promise<RecordDeliveryResult> {
  if (!isUuid(jobId)) return fail(NOT_FOUND);
  if (!Array.isArray(rows) || !rows.length) return fail("Zadej, kolik se dodává.");
  if (opts.retryId && !isUuid(opts.retryId)) return fail("Dodací list nenalezen.");
  const c = await begin();
  if ("error" in c) return fail(c.error);
  const { db, user } = c;
  const text = cleanText(opts.note, 500);
  const reissue = opts.reissue === true;
  const issueNote = reissue || opts.issueNote !== false;

  try {
    const { data, error } = await db.from("order_items")
      .select("id, name, drawing_number, description, quantity, unit, delivered_quantity, delivery_closed").eq("order_id", jobId);
    if (error) return fail(error);
    const items = new Map(((data ?? []) as ItemRow[]).map((i) => [i.id, i]));
    if (!items.size) return fail("Zakázka nemá položky — zapiš částečnou dodávku poznámkou.");

    // kontrola: dodáno v DB musí být „from" (u reissue už „to" — dodání je zapsané)
    const changes: { item: ItemRow; from: number; to: number }[] = [];
    const lineRows: DeliveryRowInput[] = [];
    for (const r of rows) {
      const item = r && typeof r.itemId === "string" && isUuid(r.itemId) ? items.get(r.itemId.toLowerCase()) : undefined;
      if (!item) return fail("Položka nepatří k této zakázce.");
      const from = round3(Number(r.from));
      const to = round3(Number(r.to));
      if (!Number.isFinite(from) || !Number.isFinite(to) || to < 0 || from < 0) return fail(`${itemName(item)}: neplatné množství.`);
      const ordered = Number(item.quantity);
      if (ordered > 0 && to > ordered * 1.5) return fail(`${itemName(item)}: ${qty(to)} je víc než 1,5× objednaného množství — nadodání?`);
      const now = round3(Number(item.delivered_quantity));
      if (reissue) {
        if (now !== to) return fail(`${itemName(item)}: dodání se mezitím změnilo (teď ${qty(now)} ${item.unit ?? "ks"}) — zavři dialog a zkontroluj stav.`);
        if (to !== from) lineRows.push({ itemId: item.id, from, to });
        continue;
      }
      if (now !== from) return fail(conflict(item, now));
      if (to !== from) {
        changes.push({ item, from, to });
        lineRows.push({ itemId: item.id, from, to });
      }
    }
    if (!reissue && !changes.length) return fail("Nic se nezměnilo — zadej, kolik se dodává teď.");
    if (issueNote && !lineRows.some((r) => r.to > r.from)) {
      return fail("Na dodací list není co dát — dodané množství se jen snižuje. Zruš „Vystavit dodací list“, nebo zadej dodávku.");
    }

    // zakázku musí uživatel vidět (karta zakázky) — dřív, než se cokoli zapíše
    const job = issueNote ? await getJob(jobId) : null;
    if (issueNote && !job) return fail(NOT_FOUND);

    // 1) zábor dodaného množství — podmíněně; prohraný souběh vrátí, co už zabral
    const claimed: typeof changes = [];
    for (const ch of changes) {
      const { data: upd, error: upErr } = await db.from("order_items").update({ delivered_quantity: ch.to } as never)
        .eq("id", ch.item.id).eq("order_id", jobId).eq("delivered_quantity", ch.from).select("id");
      if (upErr || !upd?.length) {
        for (const back of claimed.reverse()) {
          const { error: bErr } = await db.from("order_items").update({ delivered_quantity: back.from } as never)
            .eq("id", back.item.id).eq("order_id", jobId).eq("delivered_quantity", back.to);
          if (bErr) console.error(`[delivery-notes] Vrácení dodaného množství selhalo: ${bErr.message}`);
        }
        let why: string;
        if (upErr) why = translateDbError(upErr.message);
        else {
          const { data: cur } = await db.from("order_items").select("delivered_quantity").eq("id", ch.item.id).maybeSingle();
          why = conflict(ch.item, round3(Number((cur as { delivered_quantity?: number | string } | null)?.delivered_quantity ?? 0)));
        }
        return { ok: false, error: `Dodání se nezapsalo: ${why}`, recorded: false, retry: null };
      }
      claimed.push(ch);
    }

    const asNoteError = (err: unknown) =>
      err instanceof DeliveryNoteError ? err : new DeliveryNoteError(err instanceof Error ? err.message : String(err), null);

    // 2) číslo DL (rychlé) → historie dodání hned s číslem DL; 3) PDF jen s tím, co odešlo teď
    let reserved: DeliveryNoteRow | null = null;
    let noteErr: DeliveryNoteError | null = null;
    if (issueNote && job) {
      try {
        reserved = await reserveDeliveryNote(db, job, { note: text, retryId: opts.retryId ?? null });
      } catch (err) {
        noteErr = asNoteError(err);
      }
    }
    if (changes.length) {
      const sum = await db.from("orders").select("items_count, items_delivered").eq("id", jobId).maybeSingle();
      const s = (sum.data ?? {}) as { items_count?: number; items_delivered?: number };
      const total = Number(s.items_count) || 0;
      const summary = total ? `${Number(s.items_delivered) || 0} z ${total} položek` : "";
      await logJobEvent(db, {
        jobId, type: "field", entity: "delivery", actorId: user.id,
        message: `Dodáno: ${changes.map((ch) => `${itemName(ch.item)} ${qty(ch.to)}/${qty(Number(ch.item.quantity))} ${ch.item.unit ?? "ks"}`).join(", ")}`
          + (summary ? ` · ${summary}` : "") + (reserved ? ` · DL ${reserved.number}` : noteErr ? " · dodací list se nevystavil" : "") + (text ? ` — ${text}` : ""),
        data: {
          production: "delivery", ...(reserved ? { deliveryNoteId: reserved.id, deliveryNoteNumber: reserved.number } : {}),
          items: changes.map((ch) => ({ itemId: ch.item.id, from: ch.from, to: ch.to })),
        },
      });
    }
    let note: IssueNoteResult | null = null;
    if (reserved && job) {
      try {
        note = await issueDeliveryNote(db, user.id, job, lineRows, { note: text, preparedBy: myName(user), reserved });
      } catch (err) {
        noteErr = asNoteError(err);
      }
    }
    if (note) {
      await logAudit({
        action: "document_issued", entity: "job_files", entityId: note.fileId,
        diff: { jobId, kind: "dodaci_list", number: note.number, version: note.version, deliveryNoteId: note.id },
      });
    }
    for (const p of PATHS) revalidatePath(p);
    revalidatePath(`/orders/${jobId}`);
    const st = await db.from("orders").select("status").eq("id", jobId).maybeSingle();
    const stageRaw = (st.data as { status?: string } | null)?.status;
    const stage = isJobStage(stageRaw) ? stageRaw : null;

    if (noteErr) {
      const nr = noteErr.note ? ` ${noteErr.note.number}` : "";
      return {
        ok: false,
        error: `Dodání je zapsané, dodací list${nr} se nepodařilo vystavit: ${noteErr.message}`
          + (noteErr.blocked ? "" : ` Zkus „Vystavit dodací list znovu“${noteErr.note ? " — číslo zůstane" : ""}.`),
        recorded: true,
        stage,
        retry: noteErr.blocked ? null : { id: noteErr.note?.id ?? null, number: noteErr.note?.number ?? null },
      };
    }
    return {
      ok: true,
      stage,
      recorded: true,
      retry: null,
      deliveryNote: note ? { id: note.id, number: note.number, fileId: note.fileId, filename: note.filename, version: note.version, label: note.label, final: note.final } : null,
    };
  } catch (err) {
    return fail(err);
  }
}

export interface DeliveryNoteListItem {
  id: string;
  number: string;
  issueDate: string;
  fileId: string | null;
  filename: string | null;
  lines: { description: string; quantity: number; unit: string }[];
}

/** Vystavené dodací listy dodávek zakázky (pro Doklady a Dokumenty → Vystavit doklad). */
export async function listDeliveryNotes(jobId: string): Promise<ActionResult<{ notes: DeliveryNoteListItem[] }>> {
  if (!isUuid(jobId)) return fail(NOT_FOUND);
  if (!isSupabaseConfigured()) return fail("Supabase není nakonfigurováno.");
  const access = await checkFeature("documents");
  if ("error" in access) return fail(access.error);
  try {
    // zakázku musí uživatel vidět (stejná kontrola jako karta zakázky)
    const job = await getJob(jobId);
    if (!job) return fail(NOT_FOUND);
    const db = await createOperatorClient({ actor: userActor(access.user) });
    const rows = await issuedDeliveryNotes(db, job.id);
    const notes: DeliveryNoteListItem[] = [];
    for (const r of rows) {
      const file = await fileOfNote(db, job.id, r.storage_path);
      notes.push({
        id: r.id, number: r.number, issueDate: r.issue_date,
        fileId: file?.id ?? null, filename: file?.filename ?? null, lines: await deliveryNoteLines(db, r.id),
      });
    }
    return { ok: true, notes };
  } catch (err) {
    return fail(err);
  }
}
