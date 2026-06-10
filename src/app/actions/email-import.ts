"use server";

import { revalidatePath } from "next/cache";
import { parseEmailFile } from "@/lib/email/parse";
import { ingestEmails, type RawEmail } from "@/lib/email/ingest";
import { isSupabaseConfigured } from "@/lib/supabase/server";

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
  message?: string;
}

const MAX_FILES = 50;
const MAX_SIZE = 25 * 1024 * 1024;

/**
 * Import kompletních e-mailových souborů z Outlooku (.msg / .eml).
 * Každý soubor se naparsuje, projde stejnou AI ingest pipeline jako stažená
 * pošta (kategorizace, návrh odpovědi, fronta ke schválení) a uloží.
 */
export async function importOutlookFiles(form: FormData): Promise<ImportResult> {
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

  // Uložení + AI analýza (pokud je nakonfigurováno Supabase + servisní klíč)
  let ingested = 0;
  let message: string | undefined;
  if (parsed.length > 0) {
    if (!isSupabaseConfigured() || !process.env.SUPABASE_SECRET_KEY) {
      message =
        "Soubory byly přečteny, ale pro uložení a AI analýzu doplň Supabase servisní klíč (Nastavení → Integrace).";
    } else {
      try {
        ingested = await ingestEmails(parsed);
        revalidatePath("/inbox");
        revalidatePath("/dashboard");
      } catch (err) {
        message = err instanceof Error ? err.message : "Chyba při ukládání e-mailů.";
      }
    }
  }

  const okCount = results.filter((r) => r.ok).length;
  return { ok: okCount > 0, files: results, ingested, message };
}
