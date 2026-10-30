import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { settingsFromRow } from "./settings";

/**
 * Master fotky v plném rozlišení (spec §2.3, B1): prohlížeč hlavní soubor fotky zmenší (≤ 2400 px — čtení AI,
 * náhledy, mobilní data) a ORIGINÁL nahraje vedle něj přímo do úložiště (podepsaná URL, bajty nikdy nejdou přes
 * funkci). Anonymizace pak čte master (anon_source_path) → kopie pro dodavatele má plné rozlišení a bez varování
 * „Fotka v nízkém rozlišení". Bez rendereru — smí ho importovat server action.
 */

/** Typy, které prohlížeč posílá jako master beze změny (HEIC dekóduje server — libheif). */
export const MASTER_MIMES = ["image/jpeg", "image/png", "image/webp", "image/heic", "image/heif"] as const;
export const MASTER_MAX_BYTES = 30 * 1024 * 1024;

type Db = Pick<SupabaseClient, "from" | "storage">;

export function isMasterMime(mime: string | null | undefined): boolean {
  return (MASTER_MIMES as readonly string[]).includes(String(mime ?? "").toLowerCase());
}

/** Smí prohlížeč nahrát master? (anonymizace zapnutá, Nastavení → „Fotky v plném rozlišení", typ a velikost) */
export async function masterUploadAllowed(db: Db, mime: string | null | undefined, size: number | null | undefined): Promise<boolean> {
  if (!isMasterMime(mime) || !(Number(size) > 0) || Number(size) > MASTER_MAX_BYTES) return false;
  try {
    const { data } = await db.from("drawing_anon_settings").select("*").eq("id", 1).maybeSingle();
    const s = settingsFromRow(data as Record<string, unknown> | null);
    return s.enabled && s.hiresCapture;
  } catch {
    return true; // výchozí nastavení: zapnuto
  }
}

/** Existuje objekt v úložišti? (master se registruje, jen když ho prohlížeč opravdu nahrál) */
export async function storageHas(db: Db, bucket: string, path: string): Promise<boolean> {
  const i = path.lastIndexOf("/");
  if (i <= 0) return false;
  try {
    const { data, error } = await db.storage.from(bucket).list(path.slice(0, i), { search: path.slice(i + 1), limit: 10 });
    if (error) return false;
    return ((data ?? []) as { name: string }[]).some((x) => x.name === path.slice(i + 1));
  } catch {
    return false;
  }
}

/**
 * Přesun masteru z dočasné složky focení k dokumentu zakázky. Idempotentní (opakované uložení dávky: zdroj už
 * přesunutý → cíl existuje). true = master je na místě.
 */
export async function moveMaster(db: Db, bucket: string, from: string | null, to: string | null): Promise<boolean> {
  if (!from || !to) return false;
  const { error } = await db.storage.from(bucket).move(from, to);
  if (!error) return true;
  return storageHas(db, bucket, to);
}
