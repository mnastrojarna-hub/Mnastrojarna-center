"use server";

import { revalidatePath } from "next/cache";
import { parseEmailFile } from "@/lib/email/parse";
import { ingestEmails, isMailAiEnabled, type RawEmail } from "@/lib/email/ingest";
import { createOperatorClient, hasServiceKey, isSupabaseConfigured } from "@/lib/supabase/server";
import { checkFeature } from "@/lib/auth/session";
import { userActor } from "@/lib/supabase/actor-headers";
import { logAudit } from "@/lib/audit";

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

/**
 * Import kompletních e-mailových souborů z Outlooku (.msg / .eml).
 * Každý soubor se naparsuje, projde stejnou ingest pipeline jako stažená
 * pošta (s AI jen při zapnutém hlavním vypínači) a uloží se do pošty toho,
 * kdo importuje (owner_id = já, schránka = moje první schránka).
 */
export async function importOutlookFiles(form: FormData): Promise<ImportResult> {
  const access = await checkFeature("mail");
  if ("error" in access) return { ok: false, files: [], ingested: 0, message: access.error };
  const { user } = access;
  if (!(form instanceof FormData)) return { ok: false, files: [], ingested: 0, message: "Neplatný požadavek." };
  const files = form.getAll("files").filter((f): f is File => f instanceof File);
  if (files.length === 0) return { ok: false, files: [], ingested: 0, message: "Nebyly vybrány žádné soubory." };
  if (files.length > MAX_FILES) {
    return { ok: false, files: [], ingested: 0, message: `Najednou lze nahrát max ${MAX_FILES} souborů.` };
  }

  const results: ImportFileResult[] = [];
  const parsed: RawEmail[] = [];

  for (const file of files) {
    if (file.size > MAX_SIZE) {
      results.push({ fileName: file.name, ok: false, error: "Soubor je větší než 25 MB." });
      continue;
    }
    try {
      const buf = Buffer.from(await file.arrayBuffer());
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
