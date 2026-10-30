"use server";

import { revalidatePath } from "next/cache";
import { parseEmailFile } from "@/lib/email/parse";
import { ingestEmails, isMailAiEnabled, type RawEmail } from "@/lib/email/ingest";
import { createOperatorClient, hasServiceKey, isSupabaseConfigured } from "@/lib/supabase/server";
import { checkFeature } from "@/lib/auth/session";
import { userActor } from "@/lib/supabase/actor-headers";
import { logAudit } from "@/lib/audit";
import { CAPTURE_BUCKET, capturePagePath, isCapturePagePath } from "@/lib/jobs/capture-review";

export interface ImportFileResult {
  fileName: string;
  ok: boolean;
  subject?: string;
  from?: string;
  category?: string;
  error?: string;
}

export interface ImportResult {
  ok: boolean;
  files: ImportFileResult[];
  ingested: number;
  /** Proběhla AI analýza (hlavní vypínač + klíč). */
  ai?: boolean;
  message?: string;
}

const MAX_FILES = 50;
const MAX_SIZE = 25 * 1024 * 1024;

/** První schránka uživatele (importovaná pošta se k ní přiřadí), jinak null. */
async function firstOwnMailboxId(userId: string): Promise<string | null> {
  try {
    const db = await createOperatorClient({ actor: userActor({ id: userId }, "import") });
    const { data } = await db
      .from("mailboxes")
      .select("id")
      .eq("owner_id", userId)
      .order("created_at", { ascending: true })
      .limit(1);
    return ((data ?? []) as { id: string }[])[0]?.id ?? null;
  } catch {
    return null;
  }
}

export interface OutlookUploadSlot {
  filename: string;
  path: string;
  token: string;
  bucket: string;
}

/**
 * Krok 1 importu: podepsané URL pro přímé nahrání .msg / .eml do capture/<já>/ (e-mail s výkresy mívá
 * desítky MB — přes server action by neprošel: limit těla 1 MB, Vercel 4,5 MB).
 */
export async function createOutlookImportUploads(files: { filename: string; size: number }[]): Promise<{ ok: boolean; error?: string; slots: OutlookUploadSlot[] }> {
  const access = await checkFeature("mail");
  if ("error" in access) return { ok: false, error: access.error, slots: [] };
  if (!isSupabaseConfigured() || !hasServiceKey()) {
    return { ok: false, error: "Pro import doplň Supabase servisní klíč (Nastavení → Integrace).", slots: [] };
  }
  const list = Array.isArray(files) ? files : [];
  if (!list.length) return { ok: false, error: "Nebyly vybrány žádné soubory.", slots: [] };
  if (list.length > MAX_FILES) return { ok: false, error: `Najednou lze nahrát max ${MAX_FILES} souborů.`, slots: [] };
  const db = await createOperatorClient({ actor: userActor(access.user, "import") });
  const slots: OutlookUploadSlot[] = [];
  for (const f of list) {
    const filename = String(f?.filename ?? "").slice(0, 255) || "email.eml";
    if (!(Number(f?.size) > 0) || Number(f.size) > MAX_SIZE) return { ok: false, error: `Soubor ${filename} je prázdný nebo větší než 25 MB.`, slots: [] };
    const path = capturePagePath(access.user.id, crypto.randomUUID(), filename);
    const { data, error } = await db.storage.from(CAPTURE_BUCKET).createSignedUploadUrl(path);
    if (error || !data?.token) return { ok: false, error: error?.message ?? "Nahrání se nepodařilo připravit.", slots: [] };
    slots.push({ filename, path: (data.path as string | undefined) ?? path, token: data.token as string, bucket: CAPTURE_BUCKET });
  }
  return { ok: true, slots };
}

/**
 * Import kompletních e-mailových souborů z Outlooku (.msg / .eml) — krok 2: soubory už leží v úložišti
 * (createOutlookImportUploads), server je přečte, smaže a každý projde stejnou ingest pipeline jako stažená
 * pošta (s AI jen při zapnutém hlavním vypínači); uloží se do pošty toho, kdo importuje (owner_id = já,
 * schránka = moje první schránka).
 */
export async function importOutlookFiles(input: { files: { path: string; filename: string }[]; tooBig?: string[] }): Promise<ImportResult> {
  const access = await checkFeature("mail");
  if ("error" in access) return { ok: false, files: [], ingested: 0, message: access.error };
  const { user } = access;
  const refs = (Array.isArray(input?.files) ? input.files : []).filter((f) => isCapturePagePath(user.id, f?.path));
  const tooBig = (Array.isArray(input?.tooBig) ? input.tooBig : []).map((n) => String(n).slice(0, 255));
  if (refs.length === 0 && tooBig.length === 0) return { ok: false, files: [], ingested: 0, message: "Nebyly vybrány žádné soubory." };
  if (refs.length > MAX_FILES) {
    return { ok: false, files: [], ingested: 0, message: `Najednou lze nahrát max ${MAX_FILES} souborů.` };
  }

  const results: ImportFileResult[] = tooBig.map((fileName) => ({ fileName, ok: false, error: "Soubor je větší než 25 MB." }));
  const parsed: RawEmail[] = [];
  const db = refs.length ? await createOperatorClient({ actor: userActor(user, "import") }) : null;

  for (const ref of refs) {
    const name = String(ref.filename ?? "").slice(0, 255) || ref.path.split("/").pop() || "email";
    const file = { name };
    try {
      const { data, error } = await db!.storage.from(CAPTURE_BUCKET).download(ref.path);
      if (error || !data) {
        results.push({ fileName: name, ok: false, error: "Soubor se nepodařilo načíst — nahraj ho znovu." });
        continue;
      }
      const buf = Buffer.from(await (data as Blob).arrayBuffer());
      if (buf.length > MAX_SIZE) {
        results.push({ fileName: name, ok: false, error: "Soubor je větší než 25 MB." });
        continue;
      }
      const p = parseEmailFile(file.name, buf);
      if (!p.ok || !p.email) {
        results.push({ fileName: file.name, ok: false, error: p.error ?? "Nelze přečíst." });
        continue;
      }
      parsed.push(p.email);
      results.push({
        fileName: file.name,
        ok: true,
        subject: p.email.subject,
        from: p.email.fromEmail || p.email.fromName,
      });
    } catch (err) {
      results.push({ fileName: file.name, ok: false, error: err instanceof Error ? err.message : "Chyba čtení souboru." });
    }
  }
  // nahrané soubory jen dočasně (obsah je teď v poště)
  if (db && refs.length) {
    try { await db.storage.from(CAPTURE_BUCKET).remove(refs.map((r) => r.path)); } catch { /* vyprší samy (24 h) */ }
  }

  // Uložení (+ AI analýza, pokud je zapnutá) — vyžaduje Supabase + servisní klíč
  let ingested = 0;
  let message: string | undefined;
  let ai = false;
  if (parsed.length > 0) {
    if (!isSupabaseConfigured() || !hasServiceKey()) {
      message =
        "Soubory byly přečteny, ale pro uložení doplň Supabase servisní klíč (Nastavení → Integrace).";
    } else {
      try {
        const mailboxId = await firstOwnMailboxId(user.id);
        ai = await isMailAiEnabled();
        ingested = await ingestEmails(parsed, mailboxId, { ownerId: user.id, actor: userActor(user, "import") });
        await logAudit({
          action: "emails_imported", entity: "emails", actor: userActor(user, "import"),
          diff: { files: parsed.length, ingested, ai },
        });
        if (ingested < parsed.length) {
          const dup = parsed.length - ingested;
          message = `Uloženo ${ingested} e-mailů${dup ? ` — ${dup} už v poště bylo (nebo se nepodařilo uložit)` : ""}.`;
        }
        revalidatePath("/inbox");
        revalidatePath("/dashboard");
      } catch (err) {
        message = err instanceof Error ? err.message : "Chyba při ukládání e-mailů.";
      }
    }
  }

  const okCount = results.filter((r) => r.ok).length;
  return { ok: okCount > 0, files: results, ingested, ai, message };
}
