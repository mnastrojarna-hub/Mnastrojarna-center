import { tr } from "./i18n";
/**
 * Úložiště rozpracované práce v prohlížeči – ochrana dokumentace (NDA).
 *
 * Výchozí režim „none“: do prohlížeče se NEUKLÁDÁ žádný dokument (model, výkres, náhled, název). Práce žije jen
 * v paměti otevřené karty a v souborech, které si uživatel sám uloží (.mncad, STEP…). Po zavření karty je pryč.
 *
 * Volitelný režim „encrypted“: dokumenty se ukládají do localStorage tohoto prohlížeče zašifrované (AES-GCM 256,
 * klíč z hesla přes PBKDF2-SHA-256, 200 000 iterací). Bez hesla je nikdo nepřečte – ani jiný uživatel téhož počítače.
 * Odemknutí platí po dobu otevřené karty (klíč v sessionStorage), po zavření karty je úložiště zamčené.
 *
 * Nastavení programu (jednotky, myš, zkratky) se ukládají nešifrovaně – neobsahují žádná data z dokumentů.
 */

export type PersistMode = "none" | "encrypted";

const MODE_KEY = "mn-cad-persist-v1";
const SALT_KEY = "mn-cad-vault-salt-v1";
const CHECK_KEY = "mn-cad-vault-check-v1";
const SESSION_KEY = "mn-cad-vault-key";
/** klíče, pod kterými se ukládají dokumenty (vše se při vypnutí / vymazání odstraní) */
export const DOC_KEYS = ["mn-cad-doc-v1", "mn-cad-tabs-v1", "mn-cad-recent-v1", "mn-cad-prefs-v1"];
export const DOC_PREFIX = "mn-cad-doc-";

let key: CryptoKey | null = null;

const ls = () => (typeof localStorage === "undefined" ? null : localStorage);
const ss = () => (typeof sessionStorage === "undefined" ? null : sessionStorage);
const enc = new TextEncoder();
const dec = new TextDecoder();
const b64 = (a: ArrayBuffer | Uint8Array) => btoa(String.fromCharCode(...new Uint8Array(a)));
const unb64 = (s: string) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));

export function persistMode(): PersistMode {
  return ls()?.getItem(MODE_KEY) === "encrypted" ? "encrypted" : "none";
}
export function isUnlocked() {
  return !!key;
}
/** Smaže z prohlížeče všechny uložené dokumenty (i z dřívějších verzí programu). Nastavení zůstává. */
export function wipeStoredDocuments() {
  const l = ls();
  if (!l) return;
  for (const k of Object.keys(l)) if (k.startsWith(DOC_PREFIX) || DOC_KEYS.includes(k)) l.removeItem(k);
}

async function deriveKey(pass: string, salt: Uint8Array): Promise<CryptoKey> {
  const base = await crypto.subtle.importKey("raw", enc.encode(pass.normalize("NFKC")), "PBKDF2", false, ["deriveKey"]);
  return crypto.subtle.deriveKey({ name: "PBKDF2", salt: salt as BufferSource, iterations: 200_000, hash: "SHA-256" }, base, { name: "AES-GCM", length: 256 }, true, ["encrypt", "decrypt"]);
}
async function encryptText(k: CryptoKey, text: string): Promise<string> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, k, enc.encode(text));
  return `v1.${b64(iv)}.${b64(ct)}`;
}
async function decryptText(k: CryptoKey, payload: string): Promise<string> {
  const [v, ivb, ctb] = payload.split(".");
  if (v !== "v1" || !ivb || !ctb) throw new Error("bad payload");
  const pt = await crypto.subtle.decrypt({ name: "AES-GCM", iv: unb64(ivb) }, k, unb64(ctb));
  return dec.decode(pt);
}
async function rememberSession(k: CryptoKey) {
  try {
    ss()?.setItem(SESSION_KEY, b64(await crypto.subtle.exportKey("raw", k)));
  } catch {
    /* bez session – po obnovení stránky se zeptáme na heslo */
  }
}

/** Zapne šifrované úložiště s novým heslem (dosud uložené nešifrované dokumenty se smažou). */
export async function enableEncrypted(pass: string): Promise<void> {
  if (pass.length < 4) throw new Error(tr("Heslo musí mít alespoň 4 znaky."));
  const l = ls();
  if (!l) throw new Error(tr("Úložiště prohlížeče není dostupné."));
  wipeStoredDocuments();
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const k = await deriveKey(pass, salt);
  l.setItem(SALT_KEY, b64(salt));
  l.setItem(CHECK_KEY, await encryptText(k, "mnastrojarna-cad"));
  l.setItem(MODE_KEY, "encrypted");
  key = k;
  await rememberSession(k);
}

/** Odemkne úložiště heslem; false = špatné heslo. */
export async function unlock(pass: string): Promise<boolean> {
  const l = ls();
  const salt = l?.getItem(SALT_KEY);
  const check = l?.getItem(CHECK_KEY);
  if (!l || !salt || !check) return false;
  try {
    const k = await deriveKey(pass, unb64(salt));
    if ((await decryptText(k, check)) !== "mnastrojarna-cad") return false;
    key = k;
    await rememberSession(k);
    return true;
  } catch {
    return false;
  }
}

/** Obnoví odemčení v rámci téže karty prohlížeče (po obnovení stránky). */
export async function restoreSession(): Promise<boolean> {
  if (key) return true;
  const raw = ss()?.getItem(SESSION_KEY);
  const check = ls()?.getItem(CHECK_KEY);
  if (!raw || !check) return false;
  try {
    const k = await crypto.subtle.importKey("raw", unb64(raw), "AES-GCM", true, ["encrypt", "decrypt"]);
    if ((await decryptText(k, check)) !== "mnastrojarna-cad") return false;
    key = k;
    return true;
  } catch {
    return false;
  }
}

export function lock() {
  key = null;
  ss()?.removeItem(SESSION_KEY);
}

/** Vypne šifrované úložiště a smaže vše uložené. */
export function disableEncrypted() {
  wipeStoredDocuments();
  const l = ls();
  l?.removeItem(SALT_KEY);
  l?.removeItem(CHECK_KEY);
  l?.removeItem(MODE_KEY);
  lock();
}

/** Uloží text pod klíčem – jen v režimu „encrypted“ a odemčeno; jinak se nic neuloží. */
export async function vaultSet(k: string, text: string): Promise<void> {
  if (persistMode() !== "encrypted" || !key) return;
  try {
    ls()?.setItem(k, await encryptText(key, text));
  } catch {
    /* plné úložiště */
  }
}
export async function vaultGet(k: string): Promise<string | null> {
  if (persistMode() !== "encrypted" || !key) return null;
  const v = ls()?.getItem(k);
  if (!v) return null;
  try {
    return await decryptText(key, v);
  } catch {
    return null;
  }
}
export function vaultRemove(k: string) {
  ls()?.removeItem(k);
}

/** Událost pro UI: změna režimu / odemčení / vymazání. */
export const VAULT_EVENT = "mn-cad-vault";
export function notifyVault() {
  if (typeof window !== "undefined") window.dispatchEvent(new CustomEvent(VAULT_EVENT));
}
