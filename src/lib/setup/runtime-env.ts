import "server-only";
import fs from "node:fs";
import path from "node:path";

/**
 * Runtime konfigurace prostředí nastavovaná z UI (průvodce /setup).
 * Lokálně se trvale ukládá do data/runtime-env.json + .env.local;
 * na Vercelu disk zapisovat nelze — tam se klíče zadávají v dashboardu
 * (průvodce vygeneruje hodnoty ke zkopírování).
 */

const DATA_DIR = path.join(process.cwd(), "data");
const RUNTIME_FILE = path.join(DATA_DIR, "runtime-env.json");
const ENV_LOCAL_FILE = path.join(process.cwd(), ".env.local");

/** Klíče, které smí průvodce nastavením zapisovat do prostředí. */
export const ALLOWED_ENV_KEYS = new Set([
  "NEXT_PUBLIC_SUPABASE_URL",
  "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY",
  "SUPABASE_SECRET_KEY",
]);

export function isVercel(): boolean {
  return Boolean(process.env.VERCEL);
}

/** Lze konfiguraci trvale uložit na disk? (localhost ano, Vercel ne) */
export function canPersistEnv(): boolean {
  if (isVercel()) return false;
  try {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    fs.accessSync(DATA_DIR, fs.constants.W_OK);
    return true;
  } catch {
    return false;
  }
}

function writeRuntimeFile(values: Record<string, string>) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  let current: Record<string, string> = {};
  try {
    current = JSON.parse(fs.readFileSync(RUNTIME_FILE, "utf8"));
  } catch {
    // první zápis nebo poškozený soubor — začni načisto
  }
  fs.writeFileSync(RUNTIME_FILE, JSON.stringify({ ...current, ...values }, null, 2) + "\n", {
    mode: 0o600,
  });
}

/** Upsert řádků KEY=value v .env.local (ostatní obsah zachová). */
function writeEnvLocal(values: Record<string, string>) {
  let content = "";
  try {
    content = fs.readFileSync(ENV_LOCAL_FILE, "utf8");
  } catch {
    // soubor zatím neexistuje
  }
  const lines = content.length ? content.split("\n") : [];
  for (const [key, value] of Object.entries(values)) {
    const line = `${key}=${value}`;
    const idx = lines.findIndex((l) => l.trimStart().startsWith(`${key}=`));
    if (idx >= 0) lines[idx] = line;
    else lines.push(line);
  }
  fs.writeFileSync(ENV_LOCAL_FILE, lines.join("\n") + (lines.at(-1) === "" ? "" : "\n"));
}

/**
 * Aplikuje hodnoty okamžitě do běžícího procesu a (pokud to jde) je trvale
 * uloží do data/runtime-env.json + .env.local. Vrací, zda došlo k trvalému uložení.
 */
export function applyRuntimeEnv(values: Record<string, string>): { persisted: boolean } {
  const filtered: Record<string, string> = {};
  for (const [k, v] of Object.entries(values)) {
    if (ALLOWED_ENV_KEYS.has(k) && v.trim()) filtered[k] = v.trim();
  }
  for (const [k, v] of Object.entries(filtered)) process.env[k] = v;
  if (!canPersistEnv()) return { persisted: false };
  try {
    writeRuntimeFile(filtered);
    writeEnvLocal(filtered);
    return { persisted: true };
  } catch {
    return { persisted: false };
  }
}
