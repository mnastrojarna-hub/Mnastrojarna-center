"use server";

import { revalidatePath } from "next/cache";
import { createOperatorClient, isSupabaseConfigured } from "@/lib/supabase/server";
import { userActor } from "@/lib/supabase/actor-headers";
import { checkFeature, getAccess } from "@/lib/auth/session";
import type { Feature } from "@/lib/auth/permissions";
import type { CurrentUser } from "@/lib/data/current-user";
import { logAudit } from "@/lib/audit";
import { recordCorrection } from "@/app/actions/corrections";
import { logJobEvent, type JobsDb } from "@/lib/jobs/events";
import { findOrCreateCustomer } from "@/lib/jobs/customers";
import { isJobStage, isForward } from "@/lib/jobs/stages";
import { JOB_PERSON_COLUMNS, formatFieldValue } from "@/lib/jobs/field-labels";
import {
  jobInputToRow, validateJobInput, validateItems, jobItemToRow, quoteItemToRow, quoteInputToRow,
  computeItemTotals, diffJob, describeChanges, fieldEventMessage, stageEventMessage, aiFilledColumns,
  quoteRevisionNumber, isUuid, isJobSource, isQuoteStatus, cleanText, cleanDate, cleanNumber, todayIso,
  translateDbError, type JobChange,
} from "@/lib/jobs/mapping";
import type { JobStage, JobSource } from "@/lib/supabase/database.types";
import type { ActionResult, JobInput, JobItemInput, JobQuoteInput } from "@/lib/jobs/types";
import {
  FLOW_QUOTE_COLUMNS, QUOTE_ACCEPT_BLOCKED, quoteApprovalBlock, quoteFactsFromRow, quoteSendBlock, reasonRequired,
} from "@/lib/jobs/flow-status";
import { approveQuoteCore, quoteSnapshotShaById, scheduleQuoteApprovalNotice } from "@/lib/jobs/quote-approval-store";
import { supersedeEditedMailChanges } from "@/lib/email/job-link-store";
import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Akce Knihy zakázek: zakázka, položky, stav, komentáře a nabídky.
 * Data jdou servisním klíčem → oprávnění hlídá každá akce sama (checkFeature).
 * Každá změna se zapíše do historie zakázky (job_events).
 */

interface Ctx {
  db: JobsDb;
  user: CurrentUser;
  margins: boolean;
  can: (f: Feature) => boolean;
}

const NOT_FOUND = "Zakázka nenalezena.";
const QUOTE_NOT_FOUND = "Nabídka nenalezena.";

async function begin(feature: Feature = "orders"): Promise<Ctx | { error: string }> {
  if (!isSupabaseConfigured()) return { error: "Supabase není nakonfigurováno." };
  const access = await checkFeature(feature);
  if ("error" in access) return { error: access.error };
  const { can } = await getAccess();
  // autor změn = přihlášený uživatel (DB z hlaviček doplní *_by a historii)
  const db = await createOperatorClient({ actor: userActor(access.user) });
  return { db, user: access.user, margins: can("margins"), can };
}

function fail(err: unknown): { ok: false; error: string } {
  if (typeof err === "string") return { ok: false, error: translateDbError(err) };
  return { ok: false, error: err instanceof Error ? translateDbError(err.message) : "Neočekávaná chyba." };
}

const FLOW_PATHS = ["/orders", "/inquiries", "/pricing", "/quotes", "/confirmations", "/documents", "/"];

function revalidateJob(jobId?: string | null) {
  for (const p of FLOW_PATHS) revalidatePath(p);
  revalidatePath("/customers", "layout");
  if (jobId) revalidatePath(`/orders/${jobId}`);
}

type Row = Record<string, unknown>;

async function loadJob(db: JobsDb, id: string, columns = "*"): Promise<Row | null> {
  const { data, error } = await db.from("orders").select(columns).eq("id", id).maybeSingle();
  if (error) console.error(`[jobs] Načtení zakázky selhalo: ${error.message}`);
  return (data as Row | null) ?? null;
}

function clamp01(v: unknown): number | null {
  const n = cleanNumber(v);
  if (n === null) return null;
  return Math.round(Math.min(1, Math.max(0, n)) * 1000) / 1000;
}

/** Jména pro id ve změnách (osoby, zákazník, dodavatel) — do textu historie. */
async function refNames(db: JobsDb, changes: JobChange[]): Promise<Record<string, string>> {
  const people = new Set<string>();
  const customers = new Set<string>();
  const suppliers = new Set<string>();
  for (const c of changes) {
    const target = JOB_PERSON_COLUMNS.includes(c.field) ? people
      : c.field === "customer_id" ? customers
      : c.field === "supplier_id" ? suppliers
      : null;
    if (!target) continue;
    for (const v of [c.from, c.to]) if (isUuid(v)) target.add(v);
  }
  const out: Record<string, string> = {};
  try {
    const [p, cu, su] = await Promise.all([
      people.size ? db.from("profiles").select("id, full_name, email").in("id", [...people]) : Promise.resolve({ data: [] }),
      customers.size ? db.from("customers").select("id, name").in("id", [...customers]) : Promise.resolve({ data: [] }),
      suppliers.size ? db.from("suppliers").select("id, name").in("id", [...suppliers]) : Promise.resolve({ data: [] }),
    ]);
    for (const r of (p.data ?? []) as { id: string; full_name: string | null; email: string | null }[]) {
      out[r.id] = (r.full_name ?? "").trim() || (r.email ?? "").trim() || r.id;
    }
    for (const r of [...((cu.data ?? []) as { id: string; name: string }[]), ...((su.data ?? []) as { id: string; name: string }[])]) {
      out[r.id] = r.name;
    }
  } catch {
    // jména jsou jen pro čitelnost historie
  }
  return out;
}

/** Hodnota pro AI korekci — surová (datum RRRR-MM-DD), u id jméno. */
function rawValue(v: unknown, refs: Record<string, string>): string {
  if (v === null || v === undefined) return "";
  if (typeof v === "string") return refs[v] ?? v;
  if (Array.isArray(v)) return v.map(String).join(", ");
  return String(v);
}

/** Změna stavu + záznam do historie (sdílí setJobStage i nabídky). */
/** Uzavření zakázky (nerealizováno / zrušeno) jen přes moveJobStage — s právem marže a důvodem. */
const CLOSE_NEEDS_REASON = "Uzavřít zakázku jako nerealizovanou nebo zrušenou jde jen přes Korekci stavu s důvodem.";

/** Nabídka vzniká jen jako rozpracovaná / ke schválení; další stavy mění setQuoteState (práva, přechody). */
const NEW_QUOTE_STATUSES = new Set(["navrh_ai", "ke_schvaleni"]);

async function applyStage(
  db: JobsDb, jobId: string, from: JobStage | null, to: JobStage, actorId: string, note?: string | null,
): Promise<string | null> {
  const { error } = await db.from("orders").update({ status: to } as never).eq("id", jobId);
  if (error) return error.message;
  await logJobEvent(db, {
    jobId, type: "stage", message: stageEventMessage(from, to, note),
    data: { from, to, ...(cleanText(note, 500) ? { note: cleanText(note, 500) } : {}) }, actorId,
  });
  return null;
}

// ── Zakázka ─────────────────────────────────────────────────
const OWNER_ADMIN_ONLY = "Obchodníka zakázky mění jen super admin.";

/**
 * #25: nová zakázka — ne-admin smí jako obchodníka zvolit jen sebe, nikoho, nebo obchodníka
 * vybraného zákazníka (foto dokladu tak zakázku dá obchodníkovi zákazníka). null = v pořádku.
 */
async function ownerChoiceError(c: Ctx, ownerId: string | null | undefined, customerId: string | null): Promise<string | null> {
  if (c.user.role === "super_admin" || !ownerId || ownerId === c.user.id) return null;
  if (customerId && isUuid(customerId)) {
    const { data } = await c.db.from("customers").select("owner_id").eq("id", customerId).maybeSingle();
    if ((data as { owner_id: string | null } | null)?.owner_id === ownerId) return null;
  }
  return OWNER_ADMIN_ONLY;
}

/** Obchodník zákazníka (jen aktivní účet) — výchozí Obchodník nové zakázky bez výslovné volby. */
async function activeCustomerOwner(db: JobsDb, customerId: string | null | undefined): Promise<string | null> {
  if (!customerId || !isUuid(customerId)) return null;
  const { data } = await db.from("customers").select("owner_id").eq("id", customerId).maybeSingle();
  const ownerId = (data as { owner_id: string | null } | null)?.owner_id ?? null;
  if (!ownerId) return null;
  const { data: p } = await db.from("profiles").select("active").eq("id", ownerId).maybeSingle();
  return (p as { active: boolean | null } | null)?.active === false ? null : ownerId;
}

export async function createJob(
  input: JobInput & { items?: JobItemInput[] },
  opts: {
    source?: JobSource; emailId?: string; aiFilled?: boolean; aiConfidence?: number;
    /** Dávkové focení: „<captureId>:<skupina>" rovnou v insertu (unikát — opakování nezaloží druhou zakázku). */
    captureKey?: string;
  } = {},
): Promise<ActionResult<{ id: string; number: string }>> {
  const c = await begin();
  if ("error" in c) return fail(c.error);
  if (!input || typeof input !== "object") return fail("Chybí údaje zakázky.");
  if (opts.captureKey !== undefined && !/^[0-9a-f-]{36}:g\d{1,3}$/.test(String(opts.captureKey))) return fail("Neplatný klíč focení.");
  const invalid = validateJobInput(input);
  if (invalid) return fail(invalid);
  const items = input.items ?? [];
  const badItems = validateItems(items);
  if (badItems) return fail(badItems);
  if (opts.source !== undefined && !isJobSource(opts.source)) return fail("Neznámý zdroj zakázky.");
  if (opts.emailId !== undefined && opts.emailId !== null && !isUuid(opts.emailId)) return fail("Neplatný e-mail.");

  try {
    const { db, user, margins } = c;
    const stage: JobStage = input.stage ?? "poptavka";
    if (reasonRequired("job", stage)) return fail(CLOSE_NEEDS_REASON);
    const row = jobInputToRow({ ...input, stage });
    if (!margins) delete row.purchase_cost;

    // #25: obchodníka zakázky určuje super admin — ostatní jen sebe, nikoho, nebo obchodníka vybraného
    // zákazníka. Kontrola PŘED jakýmkoli zápisem (jinak by zůstal založený zákazník s cizím obchodníkem,
    // kterého by pak šlo „převzít" jako obchodníka zákazníka). Nezvoleno / „—" = výchozí níže (jako dřív).
    const isAdmin = user.role === "super_admin";
    const isSales = isAdmin || user.role === "obchodnik";
    const requestedOwner = (row.owner_id as string | null | undefined) ?? undefined;
    delete row.owner_id;
    if (requestedOwner !== undefined) {
      const ownerErr = await ownerChoiceError(c, requestedOwner, (row.customer_id as string | null | undefined) ?? null);
      if (ownerErr) return fail(ownerErr);
    }

    // zákazník: vybraný, nebo dohledat / založit podle názvu
    // (nový zákazník: super admin → zvolený obchodník / on; obchodník → on sám; zaměstnanec → bez obchodníka)
    let customerCreated = false;
    if (!row.customer_id) {
      const name = cleanText(input.customerName, 300);
      if (name) {
        const customerOwner = isAdmin ? (requestedOwner ?? user.id) : isSales ? user.id : null;
        const found = await findOrCreateCustomer(db, { name, ownerId: customerOwner });
        if (!found) return fail("Zákazníka se nepodařilo dohledat ani založit.");
        row.customer_id = found.id;
        customerCreated = found.created;
      }
    }

    // #25: bez výslovné volby jako u e-mailu a fotky — Obchodník = obchodník zákazníka, jinak zakládající
    // obchodník / super admin; zaměstnanec zakázku zpracovává (Obchodník = obchodník zákazníka, jinak nikdo).
    let ownerId: string | null;
    if (requestedOwner !== undefined) {
      ownerId = requestedOwner;
    } else {
      const customerOwner = await activeCustomerOwner(db, row.customer_id as string | null | undefined);
      ownerId = customerOwner ?? (isSales ? user.id : null);
      if (!isSales && row.assignee_id === undefined) row.assignee_id = user.id;
    }

    const itemRows = items.map((it, i) => {
      const r = jobItemToRow(it, i);
      if (!margins) r.purchase_unit_price = null;
      return r;
    });
    const totals = computeItemTotals(items.map((it) => ({
      quantity: it.quantity, unitPrice: it.unitPrice, purchaseUnitPrice: margins ? it.purchaseUnitPrice : null,
    })));
    if (input.value === undefined && totals.value !== null) row.value = totals.value;
    if (margins && input.purchaseCost === undefined && totals.purchaseCost !== null) row.purchase_cost = totals.purchaseCost;

    if (!row.title) {
      row.title = cleanText(items[0]?.name, 300) ?? cleanText(items[0]?.drawingNumber, 300) ?? "Nová zakázka";
    }
    if (stage === "poptavka" && !row.inquiry_date) row.inquiry_date = todayIso();

    const { data: number, error: numErr } = await db.rpc("next_job_number");
    if (numErr || typeof number !== "string" || !number) {
      return fail(numErr?.message ?? "Nepodařilo se přidělit číslo zakázky.");
    }

    const source: JobSource = opts.source ?? "manual";
    const insert = {
      ...row,
      number,
      status: stage,
      owner_id: ownerId,
      created_by: user.id,
      source,
      email_id: opts.emailId ?? null,
      ai_filled: Boolean(opts.aiFilled),
      ai_confidence: clamp01(opts.aiConfidence),
      ...(opts.captureKey ? { capture_key: opts.captureKey } : {}),
    };
    const { data: created, error } = await db.from("orders").insert(insert as never).select("id, number").single();
    if (error || !created) return fail(error?.message ?? "Zakázku se nepodařilo založit.");
    const jobId = (created as { id: string }).id;

    if (itemRows.length) {
      const { error: itemErr } = await db
        .from("order_items")
        .insert(itemRows.map((r) => ({ ...r, order_id: jobId })) as never);
      if (itemErr) {
        await db.from("orders").delete().eq("id", jobId);
        return fail(`Položky se nepodařilo uložit: ${itemErr.message}`);
      }
    }

    await logJobEvent(db, {
      jobId, type: "created", message: "Zakázka založena",
      data: { source, items: itemRows.length, customerCreated, ...(opts.emailId ? { emailId: opts.emailId } : {}) },
      actorId: user.id,
    });
    // poznámka při založení i v historii (majitel 29. 10.: „měly by tam být i poznámky")
    const createdNote = typeof row.note === "string" && row.note.trim() ? row.note.trim() : null;
    if (createdNote) {
      await logJobEvent(db, {
        jobId, type: "field", message: `Interní poznámka: ${createdNote.slice(0, 300)}`,
        data: { changes: [{ field: "note", label: "Interní poznámka", from: null, to: createdNote, fromText: "—", toText: createdNote }], note: true },
        actorId: user.id,
      });
    }
    await logAudit({ action: "job_created", entity: "orders", entityId: jobId, diff: { number, source } });
    revalidateJob(jobId);
    return { ok: true, id: jobId, number };
  } catch (err) {
    return fail(err);
  }
}

export async function updateJob(id: string, patch: JobInput): Promise<ActionResult> {
  const c = await begin();
  if ("error" in c) return fail(c.error);
  if (!isUuid(id)) return fail(NOT_FOUND);
  if (!patch || typeof patch !== "object") return fail("Chybí změny.");
  const invalid = validateJobInput(patch);
  if (invalid) return fail(invalid);

  try {
    const { db, user, margins } = c;
    const before = await loadJob(db, id);
    if (!before) return fail(NOT_FOUND);

    const { stage, ...rest } = patch;
    const row = jobInputToRow(rest);
    delete row.status;
    if (!margins) delete row.purchase_cost;
    // čísla dokladů jen z jejich jediné cesty: faktura = „Vystavit fakturu" / „Faktura vystavená mimo
    // systém" (právo na marže), DL = zápis dodání — obecná úprava zakázky je nepřepíše (A2)
    delete row.invoice_number;
    delete row.delivery_note_number;

    // #25: obchodníka zakázky mění jen super admin („Zpracovává" smí každý) — kontrola PŘED založením
    // zákazníka níže (jinak by po odmítnutí zůstal založený zákazník)
    const isAdmin = user.role === "super_admin";
    if (!isAdmin && row.owner_id !== undefined && diffJob(before, { owner_id: row.owner_id }).length) return fail(OWNER_ADMIN_ONLY);

    if (rest.customerId === undefined) {
      const name = cleanText(rest.customerName, 300);
      if (name) {
        // nový zákazník: obchodník zakázky, jinak zakládající obchodník / super admin; zaměstnanec obchodníkem není
        const isSales = isAdmin || user.role === "obchodnik";
        const found = await findOrCreateCustomer(db, { name, ownerId: (before.owner_id as string | null) ?? (isSales ? user.id : null) });
        if (!found) return fail("Zákazníka se nepodařilo dohledat ani založit.");
        row.customer_id = found.id;
      }
    }

    const changes = diffJob(before, row);
    if (!isAdmin && changes.some((ch) => ch.field === "owner_id")) return fail(OWNER_ADMIN_ONLY);
    const fromStage = isJobStage(before.status) ? before.status : null;
    const stageTo = stage !== undefined && stage !== fromStage ? stage : null;
    if (stageTo && reasonRequired("job", stageTo)) return fail(CLOSE_NEEDS_REASON);
    if (!changes.length && !stageTo) return { ok: true };

    if (changes.length) {
      const update: Row = {};
      for (const ch of changes) update[ch.field] = row[ch.field];
      const { error } = await db.from("orders").update(update as never).eq("id", id);
      if (error) return fail(error.message);

      // AI se učí: oprava pole, které vyplnila AI (události „ai" s data.filledColumns)
      let aiCorrected: string[] = [];
      if (before.ai_filled === true) {
        const { data: evs } = await db.from("job_events").select("type, data, created_at").eq("job_id", id).in("type", ["ai", "field"]);
        const filled = aiFilledColumns((evs ?? []) as { type: string; data: unknown; created_at: string }[]);
        aiCorrected = changes.filter((ch) => filled.has(ch.field)).map((ch) => ch.field);
      }

      const refs = await refNames(db, changes);
      const views = describeChanges(changes, refs);
      await logJobEvent(db, {
        jobId: id, type: "field", message: fieldEventMessage(views),
        data: { changes: views, ...(aiCorrected.length ? { aiCorrected } : {}) },
        actorId: user.id,
      });

      for (const field of aiCorrected) {
        const v = views.find((x) => x.field === field);
        if (!v) continue;
        try {
          await recordCorrection({
            agentKey: "capture",
            field: v.label,
            context: `Zakázka ${String(before.number ?? "")} — ${String(before.title ?? "")}`.slice(0, 500),
            aiValue: rawValue(v.from, refs) || formatFieldValue(field, v.from),
            correctedValue: rawValue(v.to, refs) || "(prázdné)",
          });
        } catch {
          // učení AI nesmí shodit uložení
        }
      }
    }

    if (stageTo) {
      const err = await applyStage(db, id, fromStage, stageTo, user.id);
      if (err) return fail(err);
    }

    revalidateJob(id);
    return { ok: true };
  } catch (err) {
    return fail(err);
  }
}

export async function setJobStage(id: string, stage: JobStage, note?: string): Promise<ActionResult> {
  const c = await begin();
  if ("error" in c) return fail(c.error);
  if (!isUuid(id)) return fail(NOT_FOUND);
  if (!isJobStage(stage)) return fail("Neznámý stav zakázky.");
  if (reasonRequired("job", stage)) return fail(CLOSE_NEEDS_REASON);
  try {
    const job = await loadJob(c.db, id, "id, status");
    if (!job) return fail(NOT_FOUND);
    const from = isJobStage(job.status) ? job.status : null;
    if (from === stage) return { ok: true };
    const err = await applyStage(c.db, id, from, stage, c.user.id, note);
    if (err) return fail(err);
    revalidateJob(id);
    return { ok: true };
  } catch (err) {
    return fail(err);
  }
}

export async function deleteJob(id: string): Promise<ActionResult> {
  const c = await begin("delete");
  if ("error" in c) return fail(c.error);
  if (!isUuid(id)) return fail(NOT_FOUND);
  try {
    const { db } = c;
    const job = await loadJob(db, id, "id, number, title, customer_id");
    if (!job) return fail(NOT_FOUND);

    const { data: files } = await db.from("job_files").select("storage_path").eq("job_id", id);
    const paths = ((files ?? []) as { storage_path: string }[]).map((f) => f.storage_path).filter(Boolean);

    // nabídky zakázky patří k ní (položky se smažou kaskádou)
    const { data: quotes, error: qErr } = await db.from("quotes").delete().eq("job_id", id).select("id");
    if (qErr) return fail(qErr.message);

    const { error } = await db.from("orders").delete().eq("id", id);
    if (error) return fail(error.message);

    if (paths.length) {
      try {
        const { error: stErr } = await db.storage.from("job-files").remove(paths);
        if (stErr) console.error(`[jobs] Mazání souborů z úložiště selhalo: ${stErr.message}`);
      } catch (e) {
        console.error(`[jobs] Mazání souborů z úložiště selhalo: ${e instanceof Error ? e.message : String(e)}`);
      }
    }

    await logAudit({
      action: "job_deleted", entity: "orders", entityId: id,
      diff: { number: job.number, title: job.title, files: paths.length, quotes: (quotes ?? []).length },
    });
    revalidateJob(id);
    return { ok: true };
  } catch (err) {
    return fail(err);
  }
}

// ── Položky a komentáře ─────────────────────────────────────
export async function saveJobItems(jobId: string, items: JobItemInput[]): Promise<ActionResult> {
  const c = await begin();
  if ("error" in c) return fail(c.error);
  if (!isUuid(jobId)) return fail(NOT_FOUND);
  const bad = validateItems(items);
  if (bad) return fail(bad);

  try {
    const { db, user, margins } = c;
    const job = await loadJob(db, jobId, "id, value");
    if (!job) return fail(NOT_FOUND);

    const { data: oldData, error: oldErr } = await db
      .from("order_items")
      .select("id, drawing_id, purchase_unit_price, note, drawing_number, name")
      .eq("order_id", jobId);
    if (oldErr) return fail(oldErr.message);
    const old = new Map(((oldData ?? []) as { id: string; drawing_id: string | null; purchase_unit_price: number | null; note: string | null; drawing_number: string | null; name: string | null }[]).map((r) => [r.id, r]));

    const rows = items.map((it, i): Row => {
      const r = jobItemToRow(it, i);
      const prev = it.id && isUuid(it.id) ? old.get(it.id) : undefined;
      // bez práva na marže se nákupní cena nesmí ztratit ani přepsat
      if (!margins) r.purchase_unit_price = prev?.purchase_unit_price ?? null;
      if (prev?.drawing_id) r.drawing_id = prev.drawing_id;
      return { ...r, order_id: jobId };
    });

    // upsert podle id: existující se upraví (dodávky a uzavření položek zůstanou), nové se vloží,
    // odebrané smažou. Vložení ani smazání stav zakázky neposouvá.
    const keep = new Set<string>();
    const fresh: Row[] = [];
    const existing: { id: string; row: Row }[] = [];
    items.forEach((it, i) => {
      if (it.id && isUuid(it.id) && old.has(it.id) && !keep.has(it.id)) {
        keep.add(it.id);
        existing.push({ id: it.id, row: rows[i] });
      } else {
        fresh.push(rows[i]);
      }
    });
    let insertedIds: string[] = [];
    if (fresh.length) {
      const { data: ins, error: insErr } = await db.from("order_items").insert(fresh as never).select("id");
      if (insErr) return fail(insErr.message);
      insertedIds = ((ins ?? []) as { id: string }[]).map((r) => r.id);
    }
    for (const e of existing) {
      const { order_id: _orderId, ...patch } = e.row;
      void _orderId;
      const { error: upErr } = await db.from("order_items").update(patch as never).eq("id", e.id).eq("order_id", jobId);
      if (upErr) {
        if (insertedIds.length) await db.from("order_items").delete().in("id", insertedIds);
        return fail(upErr.message);
      }
    }
    const removed = [...old.keys()].filter((id) => !keep.has(id));
    if (removed.length) {
      const { error: delErr } = await db.from("order_items").delete().in("id", removed);
      if (delErr) return fail(delErr.message);
    }
    // Pošta B: ručně přepsaná hodnota z e-mailu (počet, materiál, revize, poznámka) = „nahrazeno ruční úpravou"
    await supersedeEditedMailChanges(db as unknown as SupabaseClient, jobId, user.id);

    const totals = computeItemTotals(rows.map((r) => ({
      quantity: r.quantity as number,
      unitPrice: r.unit_price as number | null,
      purchaseUnitPrice: r.purchase_unit_price as number | null,
    })));
    const update: Row = {};
    if (rows.some((r) => r.unit_price !== null)) update.value = totals.value;
    if (margins && rows.some((r) => r.purchase_unit_price !== null)) update.purchase_cost = totals.purchaseCost;
    if (Object.keys(update).length) {
      const { error: upErr } = await db.from("orders").update(update as never).eq("id", jobId);
      if (upErr) return fail(upErr.message);
    }

    // poznámky položek (nové / změněné) jako změny v historii — s textem, ne jen „Položky upraveny"
    const noteChanges = items.flatMap((it, i) => {
      const prev = it.id && isUuid(it.id) ? old.get(it.id) : undefined;
      const before = (prev?.note ?? "").trim();
      const after = (typeof rows[i].note === "string" ? (rows[i].note as string) : "").trim();
      if (before === after) return [];
      const ref = cleanText((rows[i].drawing_number as string | null) ?? prev?.drawing_number ?? (rows[i].name as string | null) ?? prev?.name, 120) ?? `položka ${i + 1}`;
      return [{ field: "item_note", label: `Poznámka položky ${ref}`, from: before || null, to: after || null, fromText: before || "—", toText: after || "—" }];
    });
    await logJobEvent(db, {
      jobId, type: "field",
      message: noteChanges.length === 1 && rows.length === 1 ? `${noteChanges[0].label}: ${noteChanges[0].toText}`.slice(0, 500) : `Položky upraveny (${rows.length})`,
      data: { items: rows.length, ...(update.value !== undefined ? { value: update.value } : {}), ...(noteChanges.length ? { changes: noteChanges, note: true } : {}) },
      actorId: user.id,
    });
    revalidateJob(jobId);
    return { ok: true };
  } catch (err) {
    return fail(err);
  }
}

export async function addJobComment(jobId: string, text: string): Promise<ActionResult> {
  const c = await begin();
  if ("error" in c) return fail(c.error);
  if (!isUuid(jobId)) return fail(NOT_FOUND);
  const message = cleanText(text, 5000);
  if (!message) return fail("Napiš text komentáře.");
  try {
    const job = await loadJob(c.db, jobId, "id");
    if (!job) return fail(NOT_FOUND);
    const { error } = await c.db.from("job_events").insert({
      job_id: jobId, type: "comment", message, data: {}, actor_id: c.user.id,
    } as never);
    if (error) return fail(error.message);
    revalidatePath(`/orders/${jobId}`);
    return { ok: true };
  } catch (err) {
    return fail(err);
  }
}

// ── Nabídky zakázky ─────────────────────────────────────────
type QuoteRowFull = Row & {
  id: string;
  number: string | null;
  job_id: string | null;
  status: string;
  revision: number | null;
  approved_by: string | null;
  total: number | string | null;
  items?: Row[] | null;
};

async function loadQuote(db: JobsDb, quoteId: string): Promise<QuoteRowFull | null> {
  const { data, error } = await db.from("quotes").select("*, items:quote_items!quote_id(*)").eq("id", quoteId).maybeSingle();
  if (error) console.error(`[jobs] Načtení nabídky selhalo: ${error.message}`);
  return (data as QuoteRowFull | null) ?? null;
}

function validateQuoteInput(input: Partial<JobQuoteInput>, requireItems: boolean): string | null {
  if (!input || typeof input !== "object") return "Chybí údaje nabídky.";
  if (requireItems || input.items !== undefined) {
    const bad = validateItems(input.items ?? []);
    if (bad) return bad;
  }
  if (input.status !== undefined && !isQuoteStatus(input.status)) return "Neznámý stav nabídky.";
  if (input.validUntil && cleanDate(input.validUntil) === null) return "Neplatné datum platnosti nabídky (čekám RRRR-MM-DD).";
  if (input.leadTimeDays !== undefined && input.leadTimeDays !== null) {
    const n = cleanNumber(input.leadTimeDays);
    if (n === null || n < 0 || n > 3650) return "Neplatná dodací lhůta.";
  }
  return null;
}

async function maxRevision(db: JobsDb, jobId: string): Promise<number> {
  const { data } = await db.from("quotes").select("revision").eq("job_id", jobId);
  return ((data ?? []) as { revision: number | null }[]).reduce((m, r) => Math.max(m, r.revision ?? 1), 0);
}

function quoteLabel(q: { number: string | null }): string {
  return q.number ? `Nabídka ${q.number}` : "Nabídka";
}

/** Podpis položek pro zjištění, zda se nabídka po schválení změnila. */
function itemsSignature(rows: Row[]): string {
  return JSON.stringify(
    [...rows]
      .sort((a, b) => Number(a.position ?? 0) - Number(b.position ?? 0))
      .map((r) => [r.drawing_number ?? null, r.name ?? null, r.description ?? null, r.material ?? null,
        cleanNumber(r.quantity), r.unit ?? "ks", cleanNumber(r.unit_price), cleanNumber(r.vat_rate)]),
  );
}

/** Plný podpis položek (i nákupní cena a poznámka) — beze změny se položky vůbec nepřepisují. */
function itemsFullSignature(rows: Row[]): string {
  return JSON.stringify(
    [...rows]
      .sort((a, b) => Number(a.position ?? 0) - Number(b.position ?? 0))
      .map((r) => [r.drawing_number ?? null, r.name ?? null, r.description ?? null, r.material ?? null,
        cleanNumber(r.quantity), r.unit ?? "ks", cleanNumber(r.unit_price), cleanNumber(r.vat_rate),
        cleanNumber(r.purchase_unit_price), r.note ?? null, r.drawing_id ?? null]),
  );
}

function revalidateQuote(jobId: string | null) {
  revalidateJob(jobId);
}

const PENDING_SUFFIX = " — čeká na schválení super admina";
const QUOTE_EDIT_SENT = "Odeslanou nabídku nejde upravit — vytvoř novou verzi.";
const QUOTE_EDIT_ARCHIVED = "Archivovanou verzi nabídky neupravuj — obnov ji z archivu, nebo vytvoř novou verzi.";

/** Stav nabídky po zápisu (schválení / nutnost schválení dopočítá DB). */
async function quoteApprovalState(db: JobsDb, quoteId: string): Promise<{ state: string | null; approvedBy: string | null; adminApprovalRequired: boolean }> {
  const { data } = await db.from("quotes").select("state, approved_by, admin_approval_required").eq("id", quoteId).maybeSingle();
  const r = (data ?? {}) as { state?: string | null; approved_by?: string | null; admin_approval_required?: boolean | null };
  return { state: r.state ?? null, approvedBy: r.approved_by ?? null, adminApprovalRequired: Boolean(r.admin_approval_required) };
}

export async function createJobQuote(
  jobId: string, input: JobQuoteInput,
): Promise<ActionResult<{ id: string; number: string; needsApproval?: boolean }>> {
  const c = await begin();
  if ("error" in c) return fail(c.error);
  if (!isUuid(jobId)) return fail(NOT_FOUND);
  const invalid = validateQuoteInput(input, true);
  if (invalid) return fail(invalid);

  try {
    const { db, user, margins } = c;
    const job = await loadJob(db, jobId, "id, number, customer_id, priced_by");
    if (!job) return fail(NOT_FOUND);

    const revision = (await maxRevision(db, jobId)) + 1;
    const { data: number, error: numErr } = await db.rpc("next_doc_number", { p_prefix: "NAB" });
    if (numErr || typeof number !== "string" || !number) return fail(numErr?.message ?? "Nepodařilo se přidělit číslo nabídky.");

    const itemRows = input.items.map((it, i) => {
      const r = quoteItemToRow(it, i);
      if (!margins) r.purchase_unit_price = null;
      return r;
    });
    const totals = computeItemTotals(itemRows.map((r) => ({ quantity: r.quantity as number, unitPrice: r.unit_price as number | null })));
    const header = quoteInputToRow(input);
    const insert = {
      ...header,
      number,
      job_id: jobId,
      customer_id: job.customer_id ?? null,
      status: typeof header.status === "string" && NEW_QUOTE_STATUSES.has(header.status) ? header.status : "ke_schvaleni",
      currency: header.currency ?? "CZK",
      total: totals.value,
      revision,
      created_by: user.id,
      owner_id: user.id,
      ai_generated: false,
      archived: false,
    };
    const { data: created, error } = await db.from("quotes").insert(insert as never).select("id").single();
    if (error || !created) return fail(error?.message ?? "Nabídku se nepodařilo založit.");
    const quoteId = (created as { id: string }).id;

    if (itemRows.length) {
      const { error: itemErr } = await db.from("quote_items").insert(itemRows.map((r) => ({ ...r, quote_id: quoteId })) as never);
      if (itemErr) {
        await db.from("quotes").delete().eq("id", quoteId);
        return fail(`Položky nabídky se nepodařilo uložit: ${itemErr.message}`);
      }
    }
    // kdo nacenil = autor první nacenené nabídky
    if (totals.value !== null && !job.priced_by) {
      await db.from("orders").update({ priced_by: user.id } as never).eq("id", jobId);
    }

    // #25: nabídku ne-admina označí DB „Neschválená“ — odeslat ji půjde až po schválení super adminem
    const after = await quoteApprovalState(db, quoteId);
    const needsApproval = after.adminApprovalRequired && !after.approvedBy;
    await logJobEvent(db, {
      jobId, type: "quote",
      message: `${quoteLabel({ number })} vytvořena${revision > 1 ? ` (verze ${revision})` : ""}${needsApproval ? PENDING_SUFFIX : ""}`,
      data: { quoteId, number, revision, total: totals.value, action: "created", ...(needsApproval ? { needsApproval: true } : {}) },
      actorId: user.id,
    });
    if (needsApproval) await scheduleQuoteApprovalNotice({ quoteId, jobId, authorId: user.id });
    revalidateQuote(jobId);
    return { ok: true, id: quoteId, number, needsApproval };
  } catch (err) {
    return fail(err);
  }
}

export async function updateJobQuote(quoteId: string, input: JobQuoteInput): Promise<ActionResult<{ approvalReset: boolean }>> {
  const c = await begin();
  if ("error" in c) return fail(c.error);
  if (!isUuid(quoteId)) return fail(QUOTE_NOT_FOUND);
  const invalid = validateQuoteInput(input, false);
  if (invalid) return fail(invalid);

  try {
    const { db, user, margins } = c;
    const quote = await loadQuote(db, quoteId);
    if (!quote) return fail(QUOTE_NOT_FOUND);
    // #25: odeslanou / uzavřenou nabídku ani archivní verzi neupravujeme (nová verze se schválí znovu)
    const state = typeof quote.state === "string" ? quote.state : null;
    if (quote.archived === true || state === "archivovana") return fail(QUOTE_EDIT_ARCHIVED);
    if (state && state !== "rozpracovana" && state !== "ke_schvaleni" && state !== "schvalena") return fail(QUOTE_EDIT_SENT);
    const isAdmin = user.role === "super_admin";
    const wasApproved = Boolean(quote.approved_by);
    const oldItems = [...(quote.items ?? [])].sort((a, b) => Number(a.position ?? 0) - Number(b.position ?? 0));

    const update: Row = quoteInputToRow(input);
    delete update.status; // stav jen přes setQuoteState (práva + povolené přechody)
    let itemRows: Row[] | null = null;
    if (Array.isArray(input.items)) {
      itemRows = input.items.map((it, i) => {
        const r = quoteItemToRow(it, i);
        if (!margins) {
          // nákupní cenu zachovat u stejné položky (pozice + výkres)
          const prev = oldItems[i];
          r.purchase_unit_price = prev && (prev.drawing_number ?? null) === r.drawing_number
            ? cleanNumber(prev.purchase_unit_price) : null;
        }
        return { ...r, quote_id: quoteId };
      });
      update.total = computeItemTotals(itemRows.map((r) => ({ quantity: r.quantity as number, unitPrice: r.unit_price as number | null }))).value;
    }

    const contentChanged = itemRows !== null && itemsSignature(itemRows) !== itemsSignature(oldItems);
    // beze změny položky nepřepisovat (přepis = změna obsahu → u ne-admina nové schválení)
    if (itemRows && itemsFullSignature(itemRows) === itemsFullSignature(oldItems)) itemRows = null;
    // #25: schválení po změně ruší DB (ne-admin); super admin úpravou znovu schvaluje — tady se nic nepíše

    if (itemRows) {
      let insertedIds: string[] = [];
      if (itemRows.length) {
        const { data: ins, error: insErr } = await db.from("quote_items").insert(itemRows as never).select("id");
        if (insErr) return fail(insErr.message);
        insertedIds = ((ins ?? []) as { id: string }[]).map((r) => r.id);
      }
      const oldIds = oldItems.map((r) => r.id).filter(isUuid);
      if (oldIds.length) {
        const { error: delErr } = await db.from("quote_items").delete().in("id", oldIds);
        if (delErr) {
          if (insertedIds.length) await db.from("quote_items").delete().in("id", insertedIds);
          return fail(delErr.message);
        }
      }
    }
    if (Object.keys(update).length) {
      const { error } = await db.from("quotes").update(update as never).eq("id", quoteId);
      if (error) return fail(error.message);
    }

    const now = await quoteApprovalState(db, quoteId);
    const resetApproval = wasApproved && !now.approvedBy;
    const reapproved = isAdmin && Boolean(now.approvedBy) && now.state === "schvalena";
    if (reapproved) {
      // co super admin uložil, je nově schválené znění (čas schválení posunula DB)
      const sha = await quoteSnapshotShaById(quote.job_id, quoteId);
      const { error } = await db.from("quotes").update({ approved_snapshot_sha: sha } as never).eq("id", quoteId);
      if (error) console.error(`[jobs] Otisk schválené nabídky se nepodařilo uložit: ${error.message}`);
    }

    if (quote.job_id) {
      const suffix = resetApproval ? " (schválení zrušeno — nutno znovu schválit)"
        : reapproved && wasApproved ? " a znovu schválena" : "";
      await logJobEvent(db, {
        jobId: quote.job_id, type: "quote",
        message: `${quoteLabel(quote)} upravena${suffix}`,
        data: { quoteId, number: quote.number, action: "updated", total: update.total ?? null, approvalReset: resetApproval, contentChanged },
        actorId: user.id,
      });
    }
    if (resetApproval || (!isAdmin && now.adminApprovalRequired && !now.approvedBy && quote.approval_returned_at)) {
      await scheduleQuoteApprovalNotice({ quoteId, jobId: quote.job_id, authorId: user.id });
    }
    revalidateQuote(quote.job_id);
    return { ok: true, approvalReset: resetApproval };
  } catch (err) {
    return fail(err);
  }
}

export async function approveJobQuote(quoteId: string, opts: { expectedUpdatedAt?: string | null } = {}): Promise<ActionResult> {
  // #25: schvaluje jen super admin (nabídky ostatních i AI) — jádro sdílí setQuoteState i fronta
  const c = await begin("quote_approval");
  if ("error" in c) return fail(c.error);
  if (!isUuid(quoteId)) return fail(QUOTE_NOT_FOUND);
  try {
    const res = await approveQuoteCore(c.db, c.user, quoteId, { expectedUpdatedAt: opts.expectedUpdatedAt ?? null });
    if (!res.ok) return fail(res.error ?? "Nabídku se nepodařilo schválit.");
    revalidateQuote(res.jobId ?? null);
    return { ok: true };
  } catch (err) {
    return fail(err);
  }
}

/** Fakta nabídky + obchodník a řešitel zakázky pro quoteSendBlock. */
async function sendCheck(c: Ctx, quoteId: string): Promise<string | null> {
  const { data } = await c.db.from("quotes").select(FLOW_QUOTE_COLUMNS).eq("id", quoteId).maybeSingle();
  if (!data) return QUOTE_NOT_FOUND;
  const facts = quoteFactsFromRow(data as Row);
  const jobId = (data as Row).job_id;
  const job = typeof jobId === "string" ? await loadJob(c.db, jobId, "owner_id, assignee_id") : null;
  return quoteSendBlock(facts, {
    can: c.can, userId: c.user.id, isSuperAdmin: c.user.role === "super_admin",
    jobOwnerId: typeof job?.owner_id === "string" ? job.owner_id : null,
    jobAssigneeId: typeof job?.assignee_id === "string" ? job.assignee_id : null,
  });
}

export async function markJobQuoteSent(quoteId: string): Promise<ActionResult> {
  // #25: kdo smí odeslat, rozhodne quoteSendBlock (neschválenou nikdo; schválenou i autor / řešitel)
  const c = await begin();
  if ("error" in c) return fail(c.error);
  if (!isUuid(quoteId)) return fail(QUOTE_NOT_FOUND);
  try {
    const { db, user } = c;
    const quote = await loadQuote(db, quoteId);
    if (!quote) return fail(QUOTE_NOT_FOUND);
    if (quote.state !== "rozpracovana" && quote.state !== "schvalena" && quote.state !== "ke_schvaleni") {
      return fail("Odeslat jde jen rozpracovanou nebo schválenou nabídku.");
    }
    const block = await sendCheck(c, quoteId);
    if (block) return fail(block);
    const { error } = await db.from("quotes").update({ status: "odeslano", sent_at: new Date().toISOString() } as never).eq("id", quoteId);
    if (error) return fail(error.message);
    if (quote.job_id) {
      await logJobEvent(db, {
        jobId: quote.job_id, type: "quote", message: `${quoteLabel(quote)} odeslána zákazníkovi`,
        data: { quoteId, number: quote.number, action: "sent" }, actorId: user.id,
      });
      const job = await loadJob(db, quote.job_id, "id, status");
      const from = job && isJobStage(job.status) ? job.status : null;
      if (from && isForward(from, "nabidka")) {
        const err = await applyStage(db, quote.job_id, from, "nabidka", user.id);
        if (err) return fail(err);
      }
    }
    revalidateQuote(quote.job_id);
    return { ok: true };
  } catch (err) {
    return fail(err);
  }
}

export async function acceptJobQuote(quoteId: string): Promise<ActionResult> {
  const c = await begin();
  if ("error" in c) return fail(c.error);
  if (!isUuid(quoteId)) return fail(QUOTE_NOT_FOUND);
  try {
    const { db, user } = c;
    const quote = await loadQuote(db, quoteId);
    if (!quote) return fail(QUOTE_NOT_FOUND);
    if (!quote.job_id) return fail("Nabídka není přiřazená k žádné zakázce.");
    // #25: přijmout jde jen odeslanou nabídku — a neschválenou zákazník nikdy nedostal
    if (quoteApprovalBlock(quoteFactsFromRow(quote))) return fail(QUOTE_ACCEPT_BLOCKED);
    if (quote.state !== "odeslana" && quote.state !== "pripominky") return fail("Zákazník může přijmout jen odeslanou nabídku.");
    const job = await loadJob(db, quote.job_id, "id, status, value");
    if (!job) return fail(NOT_FOUND);

    const { error } = await db.from("quotes").update({ status: "prijato" } as never).eq("id", quoteId);
    if (error) return fail(error.message);

    const total = cleanNumber(quote.total);
    const jobUpdate: Row = { quote_id: quoteId };
    if (total !== null) jobUpdate.value = total;
    const { error: jobErr } = await db.from("orders").update(jobUpdate as never).eq("id", quote.job_id);
    if (jobErr) return fail(jobErr.message);

    const valueText = total !== null ? ` — hodnota zakázky ${formatFieldValue("value", total)}` : "";
    await logJobEvent(db, {
      jobId: quote.job_id, type: "quote", message: `${quoteLabel(quote)} přijata zákazníkem${valueText}`,
      data: { quoteId, number: quote.number, action: "accepted", total, previousValue: cleanNumber(job.value) },
      actorId: user.id,
    });

    const from = isJobStage(job.status) ? job.status : null;
    if (from && isForward(from, "objednavka")) {
      const err = await applyStage(db, quote.job_id, from, "objednavka", user.id);
      if (err) return fail(err);
    }
    revalidateQuote(quote.job_id);
    return { ok: true };
  } catch (err) {
    return fail(err);
  }
}

export async function rejectJobQuote(quoteId: string, reason?: string): Promise<ActionResult> {
  // zamítnutí může zavřít zakázku → jen s právem na marže (jako setQuoteState → zamitnuta)
  const c = await begin("margins");
  if ("error" in c) return fail(c.error);
  if (!isUuid(quoteId)) return fail(QUOTE_NOT_FOUND);
  try {
    const { db, user } = c;
    const quote = await loadQuote(db, quoteId);
    if (!quote) return fail(QUOTE_NOT_FOUND);
    // #25: zamítnout jde jen odeslanou nabídku (= flow_reject_quote) — jinak by šla „zamítnout a znovu otevřít“
    if (quote.state !== "odeslana" && quote.state !== "pripominky") return fail("Zamítnout lze jen odeslanou nabídku.");
    const why = cleanText(reason, 2000);
    const { error } = await db.from("quotes").update({ status: "zamitnuto", rejected_reason: why } as never).eq("id", quoteId);
    if (error) return fail(error.message);
    if (quote.job_id) {
      // zamítnutá nabídka už nemůže být ta přijatá
      await db.from("orders").update({ quote_id: null } as never).eq("id", quote.job_id).eq("quote_id", quoteId);
      await logJobEvent(db, {
        jobId: quote.job_id, type: "quote", message: `${quoteLabel(quote)} zamítnuta${why ? ` — ${why}` : ""}`,
        data: { quoteId, number: quote.number, action: "rejected", reason: why }, actorId: user.id,
      });
    }
    revalidateQuote(quote.job_id);
    return { ok: true };
  } catch (err) {
    return fail(err);
  }
}

export async function newJobQuoteRevision(quoteId: string): Promise<ActionResult<{ id: string; number: string }>> {
  const c = await begin();
  if ("error" in c) return fail(c.error);
  if (!isUuid(quoteId)) return fail(QUOTE_NOT_FOUND);
  try {
    const { db, user } = c;
    const quote = await loadQuote(db, quoteId);
    if (!quote) return fail(QUOTE_NOT_FOUND);

    let rev = (quote.job_id ? await maxRevision(db, quote.job_id) : (quote.revision ?? 1)) + 1;
    const copy = {
      title: quote.title ?? null,
      currency: quote.currency ?? "CZK",
      total: quote.total ?? null,
      valid_until: quote.valid_until ?? null,
      lead_time_days: quote.lead_time_days ?? null,
      delivery_terms: quote.delivery_terms ?? null,
      payment_terms: quote.payment_terms ?? null,
      note: quote.note ?? null,
      job_id: quote.job_id,
      customer_id: quote.customer_id ?? null,
      status: "ke_schvaleni",
      created_by: user.id,
      owner_id: user.id,
      ai_generated: false,
      archived: false,
    };

    let createdId: string | null = null;
    let number = "";
    for (let attempt = 0; attempt < 5 && !createdId; attempt++, rev++) {
      if (quote.number) {
        number = quoteRevisionNumber(quote.number, rev);
      } else {
        const { data: n, error: nErr } = await db.rpc("next_doc_number", { p_prefix: "NAB" });
        if (nErr || typeof n !== "string") return fail(nErr?.message ?? "Nepodařilo se přidělit číslo nabídky.");
        number = n;
      }
      const { data, error } = await db.from("quotes").insert({ ...copy, number, revision: rev } as never).select("id").single();
      if (!error && data) {
        createdId = (data as { id: string }).id;
        break;
      }
      // 23505 = číslo už existuje → zkusit další verzi
      if (error && (error as { code?: string }).code !== "23505") return fail(error.message);
    }
    if (!createdId) return fail("Nepodařilo se vytvořit novou verzi nabídky.");
    const finalRev = rev;

    const items = (quote.items ?? []).map((r) => ({
      ...Object.fromEntries(Object.entries(r).filter(([k]) => k !== "id" && k !== "quote_id")),
      quote_id: createdId,
    }));
    if (items.length) {
      const { error: itemErr } = await db.from("quote_items").insert(items as never);
      if (itemErr) {
        await db.from("quotes").delete().eq("id", createdId);
        return fail(`Položky nové verze se nepodařilo uložit: ${itemErr.message}`);
      }
    }
    await db.from("quotes").update({ archived: true } as never).eq("id", quoteId);

    const st = await quoteApprovalState(db, createdId);
    const needsApproval = st.adminApprovalRequired && !st.approvedBy;
    if (quote.job_id) {
      await logJobEvent(db, {
        jobId: quote.job_id, type: "quote",
        message: `Nová verze nabídky ${number} (verze ${finalRev}) — ${quote.number ?? "původní"} archivována${needsApproval ? PENDING_SUFFIX : ""}`,
        data: { quoteId: createdId, number, revision: finalRev, previousQuoteId: quoteId, action: "revision", ...(needsApproval ? { needsApproval: true } : {}) },
        actorId: user.id,
      });
    }
    if (needsApproval) await scheduleQuoteApprovalNotice({ quoteId: createdId, jobId: quote.job_id, authorId: user.id });
    revalidateQuote(quote.job_id);
    return { ok: true, id: createdId, number };
  } catch (err) {
    return fail(err);
  }
}

export async function setJobQuoteArchived(quoteId: string, archived: boolean): Promise<ActionResult> {
  const c = await begin();
  if ("error" in c) return fail(c.error);
  if (!isUuid(quoteId)) return fail(QUOTE_NOT_FOUND);
  try {
    const { db, user } = c;
    const quote = await loadQuote(db, quoteId);
    if (!quote) return fail(QUOTE_NOT_FOUND);
    const { error } = await db.from("quotes").update({ archived: Boolean(archived) } as never).eq("id", quoteId);
    if (error) return fail(error.message);
    if (quote.job_id) {
      await logJobEvent(db, {
        jobId: quote.job_id, type: "quote",
        message: `${quoteLabel(quote)} ${archived ? "archivována" : "obnovena z archivu"}`,
        data: { quoteId, number: quote.number, action: archived ? "archived" : "unarchived" }, actorId: user.id,
      });
    }
    revalidateQuote(quote.job_id);
    return { ok: true };
  } catch (err) {
    return fail(err);
  }
}

export async function deleteJobQuote(quoteId: string): Promise<ActionResult> {
  const c = await begin("delete");
  if ("error" in c) return fail(c.error);
  if (!isUuid(quoteId)) return fail(QUOTE_NOT_FOUND);
  try {
    const { db, user } = c;
    const quote = await loadQuote(db, quoteId);
    if (!quote) return fail(QUOTE_NOT_FOUND);
    // orders.quote_id se vynuluje samo (on delete set null)
    const { error } = await db.from("quotes").delete().eq("id", quoteId);
    if (error) return fail(error.message);
    await logAudit({
      action: "quote_deleted", entity: "quotes", entityId: quoteId,
      diff: { number: quote.number, jobId: quote.job_id, total: quote.total },
    });
    if (quote.job_id) {
      await logJobEvent(db, {
        jobId: quote.job_id, type: "quote", message: `${quoteLabel(quote)} smazána`,
        data: { quoteId, number: quote.number, action: "deleted" }, actorId: user.id,
      });
    }
    revalidateQuote(quote.job_id);
    return { ok: true };
  } catch (err) {
    return fail(err);
  }
}
