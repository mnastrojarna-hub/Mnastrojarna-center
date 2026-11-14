/**
 * Sdílení dokumentu odkazem (díl, sestava, výkresy) – s ohledem na ochranu dokumentace (NDA).
 *
 * Tři způsoby, všechny bez čitelných dat na serveru:
 *  – „krátký odkaz“ (výchozí, je-li k dispozici úložiště): dokument se v prohlížeči zašifruje (AES-GCM) a nahraje do
 *    úložiště; v odkazu je za `#` (ta část se na server nikdy neposílá) jen desetimístný KÓD – z něj se pomalým
 *    odvozením (PBKDF2) získá id v úložišti i šifrovací klíč. Úložiště: Supabase Storage (NEXT_PUBLIC_CAD_SHARE_URL +
 *    NEXT_PUBLIC_CAD_SHARE_KEY, bucket `cad-share`; starší tvar `#r=`), jinak vlastní úložiště na stejném webu – PHP skript
 *    `/cad/share/` (public/cad/share/index.php), když odpoví na `?ping`.
 *    Data importů (STEP…) jdou do úložiště binárně (ne base64) a zkomprimovaná – vejdou se i velké modely.
 *  – „v odkazu“ (bez serveru): celý dokument je zkomprimovaný (deflate) v části adresy za `#`. Dlouhý odkaz – použije
 *    se, když úložiště není (dialog řekne proč), při platnosti „bez omezení“ nebo na přání.
 *
 * Volitelné heslo: klíč se odvodí z hesla (PBKDF2-SHA-256, 200 000 iterací) – samotný odkaz pak nestačí.
 * Platnost: v obsahu je čas vypršení; po něm se dokument neotevře (v úložišti se navíc smaže).
 *
 * Tvar odkazu:   /s#<KÓD>                    vlastní úložiště, nejkratší tvar (vlna 16): 10 znaků base58 (bez 0 O I l – dá
 *                                            se přečíst nahlas i opsat), ≈ 58,6 bitu. `/s` (`/en/s`, `/de/s`) přesměruje na
 *                                            `/cad`; část za `#` prohlížeč přes přesměrování zachová. Na produkci
 *                                            `https://mnastrojarna.cz/s#Ab3kZ9xQ2m` = 36 znaků (základ lze zkrátit:
 *                                            NEXT_PUBLIC_CAD_SHARE_SHORT). Stránka přijme i `/cad#<KÓD>`.
 *                                            prk = PBKDF2-HMAC-SHA-256(kód, sůl "mncad-share-v2", 1 200 000 iterací, 32 B –
 *                                            jeden blok, takže zkoušení kódu stojí útočníka totéž co příjemce);
 *                                            id = 11 znaků base58 z HKDF(prk, "mncad-share-v2 id"), klíč AES-256 =
 *                                            HKDF(prk, "mncad-share-v2 key"). S heslem je klíč z druhého pomalého odvození
 *                                            PBKDF2(prk + heslo) – id zůstává jen z kódu, samotný kód dokument neotevře.
 *                                            Server ani držitel uložených dat tak nemůže kódy zkoušet rychlou hašovací
 *                                            funkcí. Sůl je pro všechny odkazy stejná (do odkazu se víc nevejde): kdo by
 *                                            získal všechna id z úložiště, zkouší jeden kód proti všem najednou – pro
 *                                            citlivé výkresy proto heslo nebo krátká platnost.
 *                /cad#q=<id>.<klíč>          starší tvar (vlna 8; id 10 znaků base62 od serveru, klíč 22 znaků = 128 bitů) –
 *                                            otevírá se dál; nově vzniká jen proti starší verzi skriptu úložiště.
 *                /cad#s=1d.<data>           dokument v odkazu, deflate
 *                /cad#s=1dp.<sůl>.<data>    totéž s heslem (data = AES-GCM)
 *                /cad#s=1r.<data>           bez komprese (prohlížeč bez CompressionStream)
 *                /cad#r=<cesta>.<klíč>      úložiště Supabase, klíč náhodný
 *                /cad#r=<cesta>.<klíč>.p<sůl>   úložiště Supabase + heslo
 *
 * Obsah ve vlastním úložišti:  "MNQ" 0x02 | příznaky (1 = heslo, 2 = deflate, 4 = kontejner) | iv 12 B | AES-GCM   (kód)
 *                              "MNQ" 0x01 | příznaky | [sůl 16 B] | iv 12 B | AES-GCM                              (#q=)
 * (hlavička je ověřená jako AAD). Kontejner = délka JSON (uint32 LE) | JSON {v, exp, from, view, doc (odkazy mnblob), bin: [[otisk, délka]…]} | data importů.
 */
import { blobId, blobOf, docBlobRefs, embedBlobs, blobIdOf, putBlobAs } from "./blobs";
import { cadLocale, tr } from "./i18n";
import { SHARE_CODE_ALPHABET, SHARE_CODE_CLASS, SHARE_CODE_HASH_SRC, SHARE_CODE_LEN } from "./share-code";
import { pruneUnderlays } from "./sketch-underlay";
import type { CadDoc } from "./types";

export type ShareView = "model" | "drawing";
export type SharePayload = { v: 1; exp: number | null; from?: string; view?: ShareView; doc: CadDoc };
/** link = celý dokument v odkazu, store = Supabase Storage, self = vlastní úložiště na webu (/cad/share/) */
export type ShareMode = "link" | "store" | "self";
export type ShareResult = {
  url: string;
  mode: ShareMode;
  bytes: number;
  exp: number | null;
  password: boolean;
  /** proč je odkaz dlouhý (úložiště nedostupné, bez omezení platnosti…) */
  note?: string;
  /** vlastní úložiště: id a token ke smazání (zneplatnění odkazu) */
  id?: string;
  del?: string;
  /** vlastní úložiště, nejkratší tvar: desetimístný kód z odkazu (část za #) – dá se přečíst nahlas nebo opsat */
  code?: string;
};
export type ParsedShare =
  | { kind: "link"; data: string; compressed: boolean; salt: string | null }
  | { kind: "store"; path: string; key: string; salt: string | null }
  | { kind: "self"; id: string; key: string }
  | { kind: "code"; code: string };
/**
 * důvody neotevření: expired = platnost vypršela, revoked = odesílatel odkaz zneplatnil, notfound = v úložišti nic
 * takového není (u odkazu s kódem nejspíš překlep), insecure = stránka neběží přes https (prohlížeč nemá WebCrypto)
 */
export type OpenResult = { ok: true; payload: SharePayload; mode: ShareMode } | { ok: false; reason: "expired" | "revoked" | "password" | "notfound" | "invalid" | "network" | "insecure"; exp?: number | null };

/** nabízené platnosti (dny); null = bez omezení (jen v odkazu) */
export const SHARE_DAYS = [1, 7, 10, 30, 90] as const;
export const SHARE_DEFAULT_DAYS = 10;
/** od této délky (znaky) odkaz upozorní, že SMS ho nepřenese */
export const LINK_WARN_CHARS = 8_000;
/** nad tuto délku se dokument do odkazu nevkládá (poštovní klienti a messengery ho rozlámou) */
export const LINK_MAX_CHARS = 250_000;
const STORE_BUCKET = "cad-share";
const CHECK = "mnastrojarna-cad-share";

const enc = new TextEncoder();
const dec = new TextDecoder();

/* ───────── base64url (po blocích – velká pole by přetekla zásobník u String.fromCharCode) ───────── */
export function b64u(bytes: Uint8Array): string {
  let s = "";
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
export function unb64u(s: string): Uint8Array {
  const t = s.replace(/-/g, "+").replace(/_/g, "/");
  return Uint8Array.from(atob(t + "=".repeat((4 - (t.length % 4)) % 4)), (c) => c.charCodeAt(0));
}

/* ───────── komprese (nativní CompressionStream; bez ní se posílá nekomprimováno) ───────── */
const hasCompression = () => typeof CompressionStream !== "undefined" && typeof DecompressionStream !== "undefined";
async function pipe(bytes: Uint8Array, stream: { readable: ReadableStream; writable: WritableStream }): Promise<Uint8Array> {
  const w = stream.writable.getWriter();
  // chyby zápisu (poškozená data) se projeví při čtení – sliby zápisu nesmí zůstat neodchycené
  w.write(bytes).catch(() => undefined);
  w.close().catch(() => undefined);
  return new Uint8Array(await new Response(stream.readable).arrayBuffer());
}
export async function deflate(bytes: Uint8Array): Promise<Uint8Array | null> {
  if (!hasCompression()) return null;
  try {
    return await pipe(bytes, new CompressionStream("deflate-raw"));
  } catch {
    return null;
  }
}
export async function inflate(bytes: Uint8Array): Promise<Uint8Array> {
  return pipe(bytes, new DecompressionStream("deflate-raw"));
}

/* ───────── šifrování ───────── */
/** WebCrypto (crypto.subtle) dává prohlížeč jen v zabezpečeném kontextu – https nebo localhost; na http:// chybí */
export const shareCryptoOk = () => typeof crypto !== "undefined" && !!crypto.subtle;
/**
 * Adresa téže stránky přes https – pro stránku otevřenou na http://, kde sdílení nejde (viz shareCryptoOk). Jen na
 * výchozím portu (na jiném portu https nejspíš neběží); jinak null. `hash` = část za # (sdílený odkaz), kterou má nést.
 */
export function shareHttpsUrl(hash = ""): string | null {
  if (typeof location === "undefined" || location.protocol !== "http:" || location.port) return null;
  return `https://${location.host}${location.pathname}${location.search}${hash}`;
}
const insecureText = () => tr("Sdílení odkazem potřebuje zabezpečené připojení: otevřete CAD na adrese začínající https:// (na http:// prohlížeč šifrování nedovolí).");
async function keyFromPassword(secret: string, salt: Uint8Array): Promise<CryptoKey> {
  const base = await crypto.subtle.importKey("raw", enc.encode(secret.normalize("NFKC")), "PBKDF2", false, ["deriveKey"]);
  return crypto.subtle.deriveKey({ name: "PBKDF2", salt: salt as BufferSource, iterations: 200_000, hash: "SHA-256" }, base, { name: "AES-GCM", length: 256 }, false, ["encrypt", "decrypt"]);
}
async function keyFromRaw(raw: Uint8Array): Promise<CryptoKey> {
  return crypto.subtle.importKey("raw", raw as BufferSource, "AES-GCM", false, ["encrypt", "decrypt"]);
}
/** AES-GCM: iv (12 B) + šifrový text; `aad` = ověřená, nešifrovaná data (hlavička obsahu) */
async function encrypt(key: CryptoKey, plain: Uint8Array, aad?: Uint8Array): Promise<Uint8Array> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv: iv as BufferSource, ...(aad ? { additionalData: aad as BufferSource } : {}) }, key, plain as BufferSource));
  const out = new Uint8Array(12 + ct.length);
  out.set(iv);
  out.set(ct, 12);
  return out;
}
async function decrypt(key: CryptoKey, data: Uint8Array, aad?: Uint8Array): Promise<Uint8Array> {
  return new Uint8Array(await crypto.subtle.decrypt({ name: "AES-GCM", iv: data.subarray(0, 12) as BufferSource, ...(aad ? { additionalData: aad as BufferSource } : {}) }, key, data.subarray(12) as BufferSource));
}

/* ───────── krátký kód (nejkratší odkaz) ───────── */
export { SHARE_CODE_ALPHABET, SHARE_CODE_LEN };
/** (dekódovaná) část adresy za # tvořená jen kódem; toleruje vše, co messenger nebo věta přilepí za odkaz */
const CODE_HASH_RE = new RegExp(SHARE_CODE_HASH_SRC);
/** kód po skupinách 4-4-2 (jak ho ukazuje dialog sdílení) ručně dopsaný za adresu: `…/s#Ab3k Z9xQ 2m`, `…#Ab3k-Z9xQ-2m` */
const CODE_GROUPED_HASH_RE = new RegExp(`^(${SHARE_CODE_CLASS}{4})[ \\u00a0.·_-](${SHARE_CODE_CLASS}{4})[ \\u00a0.·_-](${SHARE_CODE_CLASS}{2})[^0-9A-Za-z]*$`);
const CODE_CHAR_RE = new RegExp(`^${SHARE_CODE_CLASS}$`);
/** oddělovače skupin kódu („Ab3k Z9xQ 2m“, „Ab3k-Z9xQ-2m“) */
const CODE_SEP_RE = /[\s\u00a0.·_-]/;
/** písmeno nebo číslice (i s diakritikou) – hranice kódu v textu */
const WORD_RE = /[\p{L}\p{N}]/u;
/** samostatný kód kdekoli v textu: vcelku, nebo po skupinách 4-4-2 jako v dialogu sdílení */
const CODE_IN_TEXT_RE = new RegExp(`(?:^|[^\\p{L}\\p{N}])(?:(${SHARE_CODE_CLASS}{${SHARE_CODE_LEN}})|(${SHARE_CODE_CLASS}{4})[ \\u00a0.·_-](${SHARE_CODE_CLASS}{4})[ \\u00a0.·_-](${SHARE_CODE_CLASS}{2}))(?![\\p{L}\\p{N}])`, "u");
const safeDecode = (s: string) => {
  try {
    return decodeURIComponent(s);
  } catch {
    return s;
  }
};
const KDF_SALT = "mncad-share-v2";
/** iterace PBKDF2 (jeden blok 32 B) – pevné: změna by zneplatnila vydané odkazy */
export const SHARE_KDF_ITERATIONS = 1_200_000;
/** délka id v úložišti odvozeného z kódu (base58). Id přidělená serverem (starší odkazy #q=) mají 10 znaků – nepřekrývají se. */
export const SHARE_ID_LEN = 11;

/** Náhodný kód: 10 znaků base58, rovnoměrně (zamítací výběr) ≈ 58,6 bitu. */
export function randomShareCode(): string {
  let out = "";
  const buf = new Uint8Array(24);
  while (out.length < SHARE_CODE_LEN) {
    crypto.getRandomValues(buf);
    for (let i = 0; i < buf.length && out.length < SHARE_CODE_LEN; i++) if (buf[i] < 232) out += SHARE_CODE_ALPHABET[buf[i] % 58]; // 232 = 4 × 58: bez zkreslení
  }
  return out;
}
/** kód po skupinách pro čtení nahlas: „Ab3k Z9xQ 2m“ */
export const groupShareCode = (code: string) => code.replace(/(.{4})(?=.)/g, "$1 ");

/**
 * Pomalé odvození: PBKDF2-HMAC-SHA-256, 1 200 000 iterací, výstup 32 B = JEDEN blok. (Delší výstup by PBKDF2 počítal
 * jako nezávislé bloky – kdo zkouší kódy proti ukradenému id, by pak platil jen za jeden z nich, příjemce za všechny.)
 */
async function slowKey(secret: Uint8Array, salt: string): Promise<Uint8Array> {
  const base = await crypto.subtle.importKey("raw", secret as BufferSource, "PBKDF2", false, ["deriveBits"]);
  return new Uint8Array(await crypto.subtle.deriveBits({ name: "PBKDF2", salt: enc.encode(salt) as BufferSource, iterations: SHARE_KDF_ITERATIONS, hash: "SHA-256" }, base, 256));
}
/** rychlé rozšíření pomalu odvozeného tajemství na nezávislé hodnoty podle popisku (HKDF-SHA-256, prázdná sůl) */
async function expand(prk: Uint8Array, label: string, bytes: number): Promise<Uint8Array> {
  const base = await crypto.subtle.importKey("raw", prk as BufferSource, "HKDF", false, ["deriveBits"]);
  return new Uint8Array(await crypto.subtle.deriveBits({ name: "HKDF", hash: "SHA-256", salt: new Uint8Array(0) as BufferSource, info: enc.encode(`${KDF_SALT} ${label}`) as BufferSource }, base, bytes * 8));
}
/** id úložiště: 128bitové číslo modulo 58^11 jako 11 znaků base58 (zkreslení < 2^-63) */
function idFromBytes(bytes: Uint8Array): string {
  const n = Array.from(bytes.subarray(0, 16));
  let id = "";
  for (let d = 0; d < SHARE_ID_LEN; d++) {
    let rem = 0;
    for (let i = 0; i < n.length; i++) {
      const v = rem * 256 + n[i];
      n[i] = Math.floor(v / 58);
      rem = v % 58;
    }
    id = SHARE_CODE_ALPHABET[rem] + id;
  }
  return id;
}
export type ShareDerived = { id: string; key: Uint8Array };
/** poslední odvození bez hesla (kód → tajemství, id, klíč): dotaz na heslo ani opakované otevření nepočítá znovu */
const kdfCache = new Map<string, Promise<ShareDerived & { prk: Uint8Array }>>();
/**
 * Z kódu odvodí id v úložišti i klíč JEDNÍM pomalým výpočtem: prk = PBKDF2-HMAC-SHA-256(kód, "mncad-share-v2",
 * 1 200 000 iterací, 32 B); id = 11 znaků base58 z HKDF(prk, "mncad-share-v2 id", 16 B), klíč AES-256 =
 * HKDF(prk, "mncad-share-v2 key", 32 B) – id tedy o klíči nic neprozradí a obojí stojí celý pomalý výpočet.
 * S heslem je klíč z druhého pomalého odvození: prk2 = PBKDF2(prk ‖ heslo NFKC, "mncad-share-v2 password"), klíč =
 * HKDF(prk2, "mncad-share-v2 key"); id zůstává jen z kódu – úložiště se najde bez hesla, ale samotný kód dokument neotevře.
 */
export async function deriveShareCode(code: string, password?: string): Promise<ShareDerived> {
  let base = kdfCache.get(code);
  if (!base) {
    base = slowKey(enc.encode(code), KDF_SALT).then(async (prk) => ({ prk, id: idFromBytes(await expand(prk, "id", 16)), key: await expand(prk, "key", 32) }));
    kdfCache.set(code, base);
    base.catch(() => kdfCache.delete(code));
    while (kdfCache.size > 4) kdfCache.delete(kdfCache.keys().next().value as string);
  }
  const d = await base;
  if (!password) return { id: d.id, key: d.key };
  const prk2 = await slowKey(concat(d.prk, enc.encode(password.normalize("NFKC"))), `${KDF_SALT} password`);
  return { id: d.id, key: await expand(prk2, "key", 32) };
}

/* ───────── konfigurace úložiště ───────── */
function storeConfig(): { url: string; key: string } | null {
  const url = (process.env.NEXT_PUBLIC_CAD_SHARE_URL ?? "").trim().replace(/\/+$/, "");
  const key = (process.env.NEXT_PUBLIC_CAD_SHARE_KEY ?? "").trim();
  return url && key ? { url, key } : null;
}
/** Je nastavené úložiště Supabase (NEXT_PUBLIC_CAD_SHARE_URL / _KEY)? */
export const shareStoreConfigured = () => !!storeConfig();

/** cesta vlastního úložiště na webu (public/cad/share/index.php) */
export const SELF_STORE_PATH = "/cad/share/";
/**
 * Adresa vlastního úložiště: `<origin>/cad/share/`. NEXT_PUBLIC_CAD_SHARE_SELF = off ho vypne, jiná adresa
 * (https://… nebo /cesta/) ho přesměruje.
 */
export function selfStoreBase(): string | null {
  const env = (process.env.NEXT_PUBLIC_CAD_SHARE_SELF ?? "").trim();
  if (/^(0|off|false|no)$/i.test(env)) return null;
  if (/^https?:\/\//i.test(env)) return env.replace(/\/?$/, "/");
  const origin = typeof location !== "undefined" ? location.origin : "";
  if (!origin || origin === "null" || !/^https?:/.test(origin)) return null;
  return origin + (env.startsWith("/") ? env.replace(/\/?$/, "/") : SELF_STORE_PATH);
}
/** dočte (zahodí) tělo odpovědi, která se dál nepoužije – spojení se hned uvolní a požadavek nezůstane viset rozpracovaný */
const drain = (res: Response): Promise<void> => res.arrayBuffer().then(() => undefined).catch(() => undefined);
export type SelfStoreInfo = { base: string; maxBytes: number; chunkBytes: number; maxDays: number; /** server přijme id odvozené z kódu (`?ping` v ≥ 2) → nejkratší odkaz */ clientId?: boolean };
let probeCache: { base: string; until: number; p: Promise<SelfStoreInfo | null> } | null = null;
/** Odpovídá vlastní úložiště (`?ping`)? Výsledek se pamatuje 5 min (nedostupnost 30 s). */
export function probeSelfStore(force = false): Promise<SelfStoreInfo | null> {
  const base = selfStoreBase();
  if (!base) return Promise.resolve(null);
  if (!force && probeCache && probeCache.base === base && Date.now() < probeCache.until) return probeCache.p;
  const entry = { base, until: Date.now() + 300_000, p: Promise.resolve<SelfStoreInfo | null>(null) };
  entry.p = (async () => {
    const ctl = typeof AbortController !== "undefined" ? new AbortController() : null;
    const timer = ctl ? setTimeout(() => ctl.abort(), 6000) : null;
    try {
      const res = await fetch(base + "?ping", { cache: "no-store", credentials: "same-origin", ...(ctl ? { signal: ctl.signal } : {}) });
      if (!res.ok || !/json/i.test(res.headers.get("content-type") ?? "")) {
        await drain(res); // např. stránka 404 hostingu bez PHP
        throw new Error("ping");
      }
      const j = (await res.json()) as { ok?: unknown; v?: unknown; max_bytes?: unknown; chunk_bytes?: unknown; max_days?: unknown };
      const max = Number(j.max_bytes);
      if (j.ok !== true || !(max > 0)) throw new Error("ping");
      const chunk = Number(j.chunk_bytes);
      return { base, maxBytes: max, chunkBytes: chunk >= 65_536 ? chunk : max, maxDays: Number(j.max_days) > 0 ? Number(j.max_days) : 90, clientId: Number(j.v) >= 2 };
    } catch {
      entry.until = Date.now() + 30_000;
      return null;
    } finally {
      if (timer) clearTimeout(timer);
    }
  })();
  probeCache = entry;
  return entry.p;
}
/** zapomene výsledek `?ping` (testy, nový pokus) */
export function resetShareProbe() {
  probeCache = null;
  selfCache.clear();
  kdfCache.clear();
}
/** Dostupná úložiště pro krátký odkaz (dialog). */
export async function shareStores(): Promise<{ supabase: boolean; self: SelfStoreInfo | null }> {
  return { supabase: shareStoreConfigured(), self: await probeSelfStore() };
}

/* ───────── vytvoření odkazu ───────── */
export type ShareOptions = {
  /** platnost ve dnech; null = bez omezení (jen režim „v odkazu“) */
  days: number | null;
  password?: string;
  view?: ShareView;
  /** jméno / firma odesílatele (zobrazí se příjemci) */
  from?: string;
  /** vynutit způsob; výchozí: krátký odkaz přes úložiště (Supabase → vlastní), jinak dokument v odkazu. „store“ = libovolné úložiště */
  mode?: ShareMode;
  /** základ adresy (výchozí: aktuální stránka bez #) */
  base?: string;
  /** průběh nahrávání do úložiště (bajty) */
  onProgress?: (sent: number, total: number) => void;
};

function baseUrl(base?: string) {
  if (base) return base;
  if (typeof location === "undefined") return "/cad";
  return location.origin + location.pathname.replace(/\/$/, "") + (location.pathname.endsWith("/") ? "/" : "");
}

/**
 * Základ nejkratšího odkazu (`<základ>#<KÓD>`) pro stránku CADu `page` (výchozí: aktuální stránka):
 *  – NEXT_PUBLIC_CAD_SHARE_SHORT (čeština; např. `https://mnastrojarna.cz/s` nebo kratší doména, která přesměruje na
 *    /cad), NEXT_PUBLIC_CAD_SHARE_SHORT_EN / _DE pro /en/cad a /de/cad;
 *  – jinak `<původ>/s`, `<původ>/en/s`, `<původ>/de/s` (přesměrování v next.config.mjs → i v .htaccess statického
 *    exportu). Jen u hostitele www.mnastrojarna.cz se vynechá „www.“ (holá doména přesměruje 301 na www a část za #
 *    prohlížeč zachová);
 *  – stránka mimo /cad (jiná cesta, vložení): adresa stránky – `#KÓD` přijme přímo.
 */
export function shareShortBase(page?: string): string {
  const pageUrl = baseUrl(page);
  let u: URL | null = null;
  try {
    u = new URL(pageUrl);
  } catch {
    u = null;
  }
  const m = u ? /^(\/(?:en|de))?\/cad\/?$/.exec(u.pathname) : null;
  const lang = m?.[1] ?? "";
  // (statické čtení process.env.NEXT_PUBLIC_… – Next hodnotu dosadí při sestavení)
  const env = (lang === "/en" ? process.env.NEXT_PUBLIC_CAD_SHARE_SHORT_EN : lang === "/de" ? process.env.NEXT_PUBLIC_CAD_SHARE_SHORT_DE : process.env.NEXT_PUBLIC_CAD_SHARE_SHORT) ?? "";
  const set = env.trim().replace(/#.*$/, "");
  if (/^https?:\/\/[^/]/i.test(set)) return set;
  if (!u || !m) return pageUrl;
  const origin = u.hostname === "www.mnastrojarna.cz" ? `${u.protocol}//mnastrojarna.cz${u.port ? ":" + u.port : ""}` : u.origin;
  return `${origin}${lang}/s`;
}

/** Chyba úložiště: `fallback` = dokument lze poslat aspoň v odkazu (síť, limit požadavků, plné úložiště…). */
class ShareStoreError extends Error {
  constructor(
    message: string,
    readonly fallback: boolean,
  ) {
    super(message);
  }
}
const mb = (n: number) => (n / 1024 / 1024).toLocaleString(cadLocale(), { maximumFractionDigits: 1 }) + " MB";
const tooBig = (bytes: number, max: number) =>
  tr("Model je pro sdílení odkazem příliš velký: {0} po kompresi a zašifrování, limit úložiště je {1}. Uložte .mncad nebo STEP a pošlete soubor (např. přes úschovnu).", mb(bytes), mb(max));

/** id odvozené z kódu už v úložišti je (409) – vylosuje se nový kód */
class ShareIdTaken extends Error {}

const MAGIC = [0x4d, 0x4e, 0x51, 0x01]; // "MNQ" v1 – starší odkaz #q=<id>.<klíč> (v hlavičce sůl hesla)
const MAGIC2 = [0x4d, 0x4e, 0x51, 0x02]; // "MNQ" v2 – odkaz s kódem (klíč z PBKDF2 kódu, bez soli v hlavičce)
const F_PASSWORD = 1;
const F_DEFLATE = 2;
const F_CONTAINER = 4;
const concat = (...parts: (Uint8Array | number[])[]) => {
  const n = parts.reduce((s, p) => s + p.length, 0);
  const out = new Uint8Array(n);
  let o = 0;
  for (const p of parts) {
    out.set(p, o);
    o += p.length;
  }
  return out;
};

/** Kontejner pro úložiště: JSON s odkazy mnblob + data importů binárně (bez base64 → menší a lépe se zkomprimuje). */
function packContainer(payload: SharePayload): Uint8Array {
  const doc = pruneUnderlays(payload.doc);
  const bin: [string, number][] = [];
  const parts: Uint8Array[] = [];
  for (const ref of docBlobRefs(doc)) {
    const b = blobOf(ref);
    if (!b) continue; // chybějící data zůstanou odkazem (příjemci se ohlásí jako chybějící import)
    bin.push([blobIdOf(ref), b.length]);
    parts.push(b);
  }
  const json = enc.encode(JSON.stringify({ ...payload, doc, bin }));
  const head = new Uint8Array(4);
  new DataView(head.buffer).setUint32(0, json.length, true);
  return concat(head, json, ...parts);
}
function unpackContainer(bytes: Uint8Array): SharePayload | null {
  if (bytes.length < 4) return null;
  const n = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint32(0, true);
  if (4 + n > bytes.length) return null;
  const p = JSON.parse(dec.decode(bytes.subarray(4, 4 + n))) as SharePayload & { bin?: unknown };
  let off = 4 + n;
  for (const e of Array.isArray(p.bin) ? p.bin : []) {
    const [id, len] = (Array.isArray(e) ? e : []) as [unknown, unknown];
    if (typeof id !== "string" || typeof len !== "number" || len < 0 || off + len > bytes.length) return null;
    const data = bytes.slice(off, off + len);
    off += len;
    if (blobId(data) === id) putBlobAs(id, data); // jen data odpovídající otisku (jinak by mohla přepsat cizí import)
  }
  delete p.bin;
  return validPayload(p) ? p : null;
}
const validPayload = (p: SharePayload | null | undefined): p is SharePayload => p?.v === 1 && p.doc?.app === "mnastrojarna-cad" && Array.isArray(p.doc.features);

/** Nahraje šifrovaný obsah do vlastního úložiště (po částech podle limitu serveru). */
async function uploadSelf(info: SelfStoreInfo, blob: Uint8Array, days: number, onProgress?: (sent: number, total: number) => void, clientId?: string): Promise<{ id: string; del: string; exp: number }> {
  const chunk = Math.max(65_536, Math.min(info.chunkBytes, blob.length));
  const post = async (url: string, body: Uint8Array, headers: Record<string, string> = {}) => {
    try {
      return await fetch(url, { method: "POST", credentials: "same-origin", cache: "no-store", headers: { "Content-Type": "application/octet-stream", ...headers }, body: body as BodyInit });
    } catch {
      throw new ShareStoreError(tr("Úložiště sdílení není dostupné (síť)."), true);
    }
  };
  const fail = async (res: Response): Promise<never> => {
    let j: { error?: string; max_bytes?: number } = {};
    try {
      j = (await res.json()) as typeof j;
    } catch {
      /* odpověď bez JSON */
    }
    if (res.status === 413) throw new ShareStoreError(tooBig(blob.length, j.max_bytes || info.maxBytes), false);
    if (res.status === 429) throw new ShareStoreError(tr("Úložiště sdílení dočasně odmítá další nahrávání z této adresy (limit za hodinu)."), true);
    if (res.status === 507) throw new ShareStoreError(tr("Úložiště sdílení na serveru je plné."), true);
    throw new ShareStoreError(tr("Úložiště sdílení odmítlo nahrání ({0}).", `${res.status}${j.error ? " " + j.error : ""}`), true);
  };
  onProgress?.(0, blob.length);
  let res = await post(`${info.base}?days=${days}&total=${blob.length}${clientId ? `&id=${clientId}` : ""}`, blob.slice(0, chunk));
  if (clientId && res.status === 409) throw new ShareIdTaken();
  if (!res.ok) await fail(res);
  const j = (await res.json()) as { id: string; del: string; exp: number; size: number };
  if (!/^[0-9A-Za-z]{8,12}$/.test(j.id ?? "") || !j.del || (clientId && j.id !== clientId)) throw new ShareStoreError(tr("Úložiště sdílení vrátilo neplatnou odpověď."), true);
  let size = j.size;
  let retries = 0;
  while (size < blob.length) {
    onProgress?.(size, blob.length);
    res = await post(`${info.base}?id=${j.id}&offset=${size}`, blob.slice(size, size + chunk), { "X-Delete-Token": j.del });
    if (res.status === 409 && retries++ < 3) {
      size = Number(((await res.json()) as { size?: number }).size) || 0;
      continue;
    }
    if (!res.ok) await fail(res);
    size = ((await res.json()) as { size: number }).size;
  }
  onProgress?.(blob.length, blob.length);
  return { id: j.id, del: j.del, exp: j.exp * 1000 };
}

/** Sestaví odkaz. Vyhodí chybu s česky formulovaným důvodem (příliš velký dokument, úložiště nedostupné…). */
export async function createShareLink(doc: CadDoc, o: ShareOptions): Promise<ShareResult> {
  const password = o.password?.trim() || "";
  const base = baseUrl(o.base);
  const from = o.from?.trim() || undefined;
  const store = storeConfig();
  const expOf = (days: number | null) => (days ? Date.now() + days * 86_400_000 : null);
  // bez WebCrypto (stránka na http://) jde jen dokument v odkazu bez hesla – vše ostatní šifruje
  if (!shareCryptoOk() && !(o.mode === "link" && !password)) throw new Error(insecureText());
  const storeDays = (max: number) => (o.days ? Math.min(max, Math.max(1, Math.round(o.days))) : null);

  // celý dokument v odkazu (data importů jako base64 – embedBlobs)
  const asLink = async (note?: string): Promise<ShareResult> => {
    const exp = expOf(o.days);
    const payload: SharePayload = { v: 1, exp, from, view: o.view, doc: embedBlobs(doc) };
    const json = enc.encode(JSON.stringify(payload));
    const packed = (await deflate(json)) ?? json;
    const compressed = packed !== json;
    let body: Uint8Array = packed;
    let salt: Uint8Array | null = null;
    if (password) {
      salt = crypto.getRandomValues(new Uint8Array(16));
      body = await encrypt(await keyFromPassword(password, salt), packed);
    }
    const flags = `1${compressed ? "d" : "r"}${salt ? "p" : ""}`;
    const url = `${base}#s=${flags}.${salt ? b64u(salt) + "." : ""}${b64u(body)}`;
    return { url, mode: "link", bytes: body.length, exp, password: !!password, ...(note ? { note } : {}) };
  };
  const linkOrThrow = async (note?: string, hint?: () => Promise<string | undefined>): Promise<ShareResult> => {
    const r = await asLink(note);
    if (r.url.length > LINK_MAX_CHARS) throw new Error(tr("Dokument je pro odkaz příliš velký ({0} kB, zřejmě importovaná geometrie). {1}", Math.round(r.url.length / 1024), (await hint?.()) ?? tr("Uložte .mncad nebo STEP a pošlete soubor, nebo nastavte úložiště sdílení.")));
    return r;
  };

  // Supabase Storage (šifrováno náhodným klíčem; data importů jako base64 v JSON – starší formát #r=)
  const asStore = async (): Promise<ShareResult> => {
    if (!store) throw new ShareStoreError(tr("Úložiště sdílení není nastavené (NEXT_PUBLIC_CAD_SHARE_URL / NEXT_PUBLIC_CAD_SHARE_KEY)."), true);
    const days = storeDays(90);
    if (!days) throw new Error(tr("V úložišti musí mít odkaz omezenou platnost (max. 90 dní)."));
    const exp = expOf(days);
    const json = enc.encode(JSON.stringify({ v: 1, exp, from, view: o.view, doc: embedBlobs(doc) } satisfies SharePayload));
    const packed = (await deflate(json)) ?? json;
    const raw = crypto.getRandomValues(new Uint8Array(32));
    let salt: Uint8Array | null = null;
    let key: CryptoKey;
    if (password) {
      salt = crypto.getRandomValues(new Uint8Array(16));
      key = await keyFromPassword(b64u(raw) + "\u0000" + password, salt);
    } else key = await keyFromRaw(raw);
    const body = await encrypt(key, packed);
    const id = b64u(crypto.getRandomValues(new Uint8Array(16)));
    const path = `d${days}/${id}.bin`;
    let res: Response;
    try {
      res = await fetch(`${store.url}/storage/v1/object/${STORE_BUCKET}/${path}`, {
        method: "POST",
        headers: { apikey: store.key, Authorization: `Bearer ${store.key}`, "Content-Type": "application/octet-stream", "x-upsert": "false" },
        body: body as BodyInit,
      });
    } catch {
      throw new ShareStoreError(tr("Úložiště sdílení není dostupné (síť). Zkuste to znovu nebo pošlete soubor .mncad."), true);
    }
    if (!res.ok) throw new ShareStoreError(tr("Úložiště sdílení odmítlo nahrání ({0}). Zkontrolujte nastavení bucketu „cad-share“.", res.status), res.status !== 413);
    const url = `${base}#r=${path.replace("/", "~").replace(/\.bin$/, "")}.${b64u(raw)}${salt ? ".p" + b64u(salt) : ""}`;
    return { url, mode: "store", bytes: body.length, exp, password: !!password };
  };

  // vlastní úložiště na webu (/cad/share/): nejkratší odkaz <základ>/s#<KÓD> – id i klíč se odvodí z kódu
  const asSelf = async (info: SelfStoreInfo | null): Promise<ShareResult> => {
    if (!info) throw new ShareStoreError(tr("Úložiště sdílení na serveru ({0}) neodpovídá.", SELF_STORE_PATH), true);
    const days = storeDays(info.maxDays);
    if (!days) throw new Error(tr("V úložišti musí mít odkaz omezenou platnost (max. {0} dní).", info.maxDays));
    const exp = expOf(days);
    const plain = packContainer({ v: 1, exp, from, view: o.view, doc });
    const z = await deflate(plain);
    const body = z ?? plain;
    const flags = (password ? F_PASSWORD : 0) | (z ? F_DEFLATE : 0) | F_CONTAINER;
    if (!info.clientId) {
      // starší skript úložiště (id přiděluje server): odkaz #q=<id>.<klíč 128 bitů>
      const raw = crypto.getRandomValues(new Uint8Array(16));
      const salt = password ? crypto.getRandomValues(new Uint8Array(16)) : null;
      const header = concat(MAGIC, [flags], salt ?? []);
      const key = salt ? await keyFromPassword(b64u(raw) + "\u0000" + password, salt) : await keyFromRaw(raw);
      const blob = concat(header, await encrypt(key, body, header));
      if (blob.length > info.maxBytes) throw new ShareStoreError(tooBig(blob.length, info.maxBytes), false);
      const up = await uploadSelf(info, blob, days, o.onProgress);
      const note = tr("Úložiště sdílení na serveru je starší verze (bez krátkých kódů) – odkaz má proto delší tvar. Nahrajte na web aktuální soubor cad/share/index.php.");
      return { url: `${base}#q=${up.id}.${b64u(raw)}`, mode: "self", bytes: blob.length, exp, password: !!password, note, id: up.id, del: up.del };
    }
    const header = concat(MAGIC2, [flags]);
    const size = header.length + 12 + body.length + 16; // hlavička + iv + data + značka GCM
    if (size > info.maxBytes) throw new ShareStoreError(tooBig(size, info.maxBytes), false);
    for (let attempt = 0; ; attempt++) {
      const code = randomShareCode();
      const d = await deriveShareCode(code);
      const key = await keyFromRaw(password ? (await deriveShareCode(code, password)).key : d.key);
      const blob = concat(header, await encrypt(key, body, header));
      try {
        const up = await uploadSelf(info, blob, days, o.onProgress, d.id);
        return { url: `${shareShortBase(base)}#${code}`, mode: "self", bytes: blob.length, exp, password: !!password, id: up.id, del: up.del, code };
      } catch (e) {
        // id už existuje (prakticky jen souběh nebo zkouška): nový kód, nejvýš 3 pokusy
        if (!(e instanceof ShareIdTaken)) throw e;
        if (attempt >= 2) throw new ShareStoreError(tr("Úložiště sdílení odmítlo nahrání ({0}).", "409 id_taken"), true);
      }
    }
  };

  if (o.mode === "link") return linkOrThrow(undefined, async () => (store || (await probeSelfStore()) ? tr("Zvolte úložiště.") : undefined));
  if (o.mode === "self") return asSelf(await probeSelfStore());
  if (o.mode === "store") return store ? asStore() : asSelf(await probeSelfStore());

  // automaticky: krátký odkaz přes úložiště (Supabase → vlastní na webu); jinak celý dokument v odkazu s vysvětlením
  if (!o.days) return linkOrThrow(tr("Bez omezení platnosti nemůže být dokument v úložišti – celý je proto v odkazu. Pro krátký odkaz zvolte platnost 1–90 dní."), async () => tr("Zvolte omezenou platnost a úložiště."));
  const why: string[] = [];
  if (store) {
    try {
      return await asStore();
    } catch (e) {
      if (e instanceof ShareStoreError && !e.fallback) throw e;
      why.push((e as Error).message);
    }
  }
  const info = await probeSelfStore();
  if (info) {
    try {
      return await asSelf(info);
    } catch (e) {
      if (e instanceof ShareStoreError && !e.fallback) throw e;
      if (!(e instanceof ShareStoreError)) throw e;
      why.push(e.message);
    }
  } else if (!store) why.push(tr("Krátký odkaz není k dispozici: úložiště sdílení na serveru ({0}) neodpovídá.", SELF_STORE_PATH));
  return linkOrThrow(`${why.join(" ")} ${tr("Celý dokument je proto v odkazu (dlouhý odkaz).")}`);
}

/** Zneplatní krátký odkaz (smaže šifrovaný obsah z vlastního úložiště). */
export async function revokeShare(r: Pick<ShareResult, "mode" | "id" | "del">): Promise<boolean> {
  const base = selfStoreBase();
  if (r.mode !== "self" || !r.id || !r.del || !base) return false;
  try {
    const res = await fetch(`${base}?id=${encodeURIComponent(r.id)}`, { method: "DELETE", credentials: "same-origin", headers: { "X-Delete-Token": r.del } });
    void drain(res);
    if (res.ok || res.status === 404 || res.status === 410) {
      selfCache.delete(r.id);
      return true;
    }
  } catch {
    /* síť */
  }
  return false;
}

/* ───────── otevření odkazu ───────── */
/** Rozpozná sdílený dokument v části adresy za # (`#<KÓD>`, `#q=…`, `#s=…` nebo `#r=…`). */
export function parseShareHash(hash: string): ParsedShare | null {
  const h = hash.replace(/^#/, "");
  // (prohlížeč znaky přilepené za kód v adrese zakóduje – „>“ na %3E, uvozovku na %22 –, proto dekódovat)
  const decoded = safeDecode(h);
  const bare = CODE_HASH_RE.exec(decoded);
  if (bare) return { kind: "code", code: bare[1] };
  const grouped = CODE_GROUPED_HASH_RE.exec(decoded);
  if (grouped) return { kind: "code", code: grouped[1] + grouped[2] + grouped[3] };
  const params = new URLSearchParams(h);
  const q = params.get("q");
  if (q) {
    // tolerantní ke znakům, které messenger přilepí za odkaz (tečka, závorka…)
    const m = /^([0-9A-Za-z]{8,12})\.([A-Za-z0-9_-]{22})(?![A-Za-z0-9_-])/.exec(q);
    return m ? { kind: "self", id: m[1], key: m[2] } : null;
  }
  const s = params.get("s");
  if (s) {
    const m = /^1([dr])(p?)\.(.+)$/s.exec(s);
    if (!m) return null;
    const rest = m[3];
    if (m[2]) {
      const i = rest.indexOf(".");
      if (i < 0) return null;
      return { kind: "link", compressed: m[1] === "d", salt: rest.slice(0, i), data: rest.slice(i + 1) };
    }
    return { kind: "link", compressed: m[1] === "d", salt: null, data: rest };
  }
  const r = params.get("r");
  if (r) {
    const parts = r.split(".");
    if (parts.length < 2 || !/^d\d+~[A-Za-z0-9_-]+$/.test(parts[0])) return null;
    const salt = parts[2]?.startsWith("p") ? parts[2].slice(1) : null;
    return { kind: "store", path: parts[0].replace("~", "/") + ".bin", key: parts[1], salt };
  }
  return null;
}

/**
 * Kód na začátku textu: 10 znaků abecedy, mezi nimi smí být oddělovače skupin (mezera, pomlčka, tečka…); za kódem
 * konec, nebo cokoli, co nezačíná písmenem či číslicí („Ab3k Z9xQ 2m – heslo pošlu zvlášť“).
 */
function codeAtStart(text: string): string | null {
  let code = "";
  let i = 0;
  for (; i < text.length && code.length < SHARE_CODE_LEN; i++) {
    const ch = text[i];
    if (CODE_CHAR_RE.test(ch)) code += ch;
    else if (!code || !CODE_SEP_RE.test(ch)) return null;
  }
  return code.length === SHARE_CODE_LEN && (i >= text.length || !WORD_RE.test(text[i])) ? code : null;
}

/**
 * Ručně zadaný kód nebo celý odkaz: „Ab3k Z9xQ 2m“, „Ab3kZ9xQ2m“, „Kód: Ab3k Z9xQ 2m“ (řádek z dialogu sdílení),
 * „mnastrojarna.cz/s#Ab3kZ9xQ2m“, odkaz s kódem po skupinách, odkaz uprostřed zprávy („…#Ab3kZ9xQ2m – heslo pošlu
 * zvlášť“) i starší odkazy (`…#q=…`, `…#s=…`). Mezery, pomlčky a tečky mezi skupinami kódu se ignorují.
 */
export function parseShareInput(text: string): ParsedShare | null {
  return locateShare(text)?.parsed ?? null;
}
/** Část za # rozpoznaná v ručním zadání, ve tvaru pro odložení (u kódu `#KÓD`); null = zadání není kód ani odkaz. */
export function shareInputHash(text: string): string | null {
  return locateShare(text)?.hash ?? null;
}
function locateShare(text: string): { parsed: ParsedShare; hash: string } | null {
  const t = text.trim();
  const code = (c: string | null | undefined) => (c ? { parsed: { kind: "code", code: c } as ParsedShare, hash: `#${c}` } : null);
  // odkaz: část za # (první #, za kterým je rozpoznatelný sdílený odkaz – název dílu ve zprávě může # obsahovat také)
  for (let i = t.indexOf("#"); i >= 0; i = t.indexOf("#", i + 1)) {
    const rest = t.slice(i + 1);
    const hash = "#" + /^\S*/.exec(rest)![0];
    const p = parseShareHash(hash);
    if (p) return p.kind === "code" ? code(p.code) : { parsed: p, hash };
    const c = code(codeAtStart(rest));
    if (c) return c;
  }
  // samotný kód (libovolně rozdělený), i s popiskem před dvojtečkou („Kód: …“)
  const direct = code(codeAtStart(t));
  if (direct) return direct;
  for (let i = t.indexOf(":"); i >= 0; i = t.indexOf(":", i + 1)) {
    const c = code(codeAtStart(t.slice(i + 1).trimStart()));
    if (c) return c;
  }
  // kód uvnitř delšího textu
  const m = CODE_IN_TEXT_RE.exec(t);
  return m ? code(m[1] ?? m[2] + m[3] + m[4]) : null;
}

/**
 * Proč zadání není platný kód – konkrétně (délka, znak mimo abecedu), aby příjemce věděl, co opravit.
 * `hash` = text je část adresy za #: vrátí null, když nevypadá jako pokus o kód (jiná kotva stránky) – jinak vždy text.
 */
export function shareCodeProblem(text: string, hash = false): string | null {
  const t = safeDecode(text.trim().replace(/^#/, "")).replace(/[^0-9A-Za-z]+$/, "");
  // část za #: jen souvislých 8–12 písmen a číslic s aspoň jednou číslicí nebo velkým písmenem – běžná kotva stránky
  // (#dokumentace, #jak-na-to) pokus o kód není
  if (hash && !/^(?=.*[0-9A-Z])[0-9A-Za-z]{8,12}$/.test(t)) return null;
  const cand = t.replace(/[\s\u00a0.·_-]+/g, "");
  const alnum = /^[0-9A-Za-z]+$/.test(cand);
  const general = tr("Kód má 10 znaků (písmena a číslice, záleží na velikosti písmen) – nebo vložte celý odkaz.");
  if (!alnum || cand.length < 6 || cand.length > 16) return general;
  const bad = [...new Set(cand.match(/[0OIl]/g) ?? [])];
  if (cand.length !== SHARE_CODE_LEN) return tr("Kód má 10 znaků, zadáno je {0}. Zkontrolujte, zda se zkopíroval celý – záleží i na velikosti písmen.", cand.length);
  if (bad.length) return tr("V kódu je znak {0}, který se v kódech nepoužívá: 0 (nula), O (velké o), I (velké i) a l (malé L) v nich nejsou, aby se nepletly. Zkontrolujte podobné znaky a velikost písmen.", bad.map((c) => `„${c}“`).join(", "));
  return general;
}

async function unpack(bytes: Uint8Array, compressed: boolean): Promise<SharePayload | null> {
  try {
    const plain = compressed ? await inflate(bytes) : bytes;
    const p = JSON.parse(dec.decode(plain)) as SharePayload;
    return validPayload(p) ? p : null;
  } catch {
    return null;
  }
}
function checkExp(p: SharePayload): OpenResult {
  if (p.exp && Date.now() > p.exp) return { ok: false, reason: "expired", exp: p.exp };
  return { ok: true, payload: p, mode: "link" };
}

/** stažený šifrovaný obsah (id → bajty): opakovaný pokus o heslo nestahuje znovu; drží se jen poslední 2 */
const selfCache = new Map<string, Uint8Array>();

type OpenFail = Extract<OpenResult, { ok: false }>;
/** stáhne šifrovaný obsah z vlastního úložiště (nebo vrátí důvod, proč to nejde) */
async function fetchSelf(id: string): Promise<Uint8Array | OpenFail> {
  const base = selfStoreBase();
  if (!base) return { ok: false, reason: "notfound" };
  const cached = selfCache.get(id);
  if (cached) return cached;
  let res: Response;
  try {
    res = await fetch(`${base}?id=${encodeURIComponent(id)}`, { credentials: "same-origin" });
  } catch {
    return { ok: false, reason: "network" };
  }
  if (res.status === 410) {
    let exp: number | null = null;
    let revoked = false;
    try {
      const j = (await res.json()) as { exp?: number; error?: string };
      exp = typeof j.exp === "number" ? j.exp * 1000 : null;
      revoked = j.error === "revoked";
    } catch {
      /* bez data */
    }
    return revoked ? { ok: false, reason: "revoked" } : { ok: false, reason: "expired", exp };
  }
  if (!res.ok) {
    await drain(res);
    return { ok: false, reason: res.status === 404 || res.status === 400 ? "notfound" : "network" };
  }
  const body = new Uint8Array(await res.arrayBuffer());
  selfCache.set(id, body);
  while (selfCache.size > 2) selfCache.delete(selfCache.keys().next().value as string);
  return body;
}
/** rozbalí dešifrovaný obsah (deflate, kontejner), ověří ho a zkontroluje platnost */
async function finishSelf(id: string, flags: number, plain: Uint8Array): Promise<OpenResult> {
  let p: SharePayload | null = null;
  try {
    const data = flags & F_DEFLATE ? await inflate(plain) : plain;
    p = flags & F_CONTAINER ? unpackContainer(data) : JSON.parse(dec.decode(data));
  } catch {
    p = null;
  }
  if (!validPayload(p)) return { ok: false, reason: "invalid" };
  selfCache.delete(id);
  const r = checkExp(p);
  return r.ok ? { ...r, mode: "self" } : r;
}
const hasMagic = (body: Uint8Array, magic: number[]) => magic.every((b, i) => body[i] === b);

/** starší odkaz #q=<id>.<klíč> (obsah „MNQ“ v1) */
async function openSelf(parsed: Extract<ParsedShare, { kind: "self" }>, password?: string): Promise<OpenResult> {
  const body = await fetchSelf(parsed.id);
  if (!(body instanceof Uint8Array)) return body;
  if (body.length < 5 + 28 || !hasMagic(body, MAGIC)) return { ok: false, reason: "invalid" };
  const flags = body[4];
  const hasPw = !!(flags & F_PASSWORD);
  const headLen = 5 + (hasPw ? 16 : 0);
  if (hasPw && !password) return { ok: false, reason: "password" };
  let raw: Uint8Array;
  try {
    raw = unb64u(parsed.key);
  } catch {
    return { ok: false, reason: "invalid" };
  }
  if (raw.length !== 16) return { ok: false, reason: "invalid" };
  let plain: Uint8Array;
  try {
    const key = hasPw ? await keyFromPassword(b64u(raw) + "\u0000" + password, body.subarray(5, 21)) : await keyFromRaw(raw);
    plain = await decrypt(key, body.subarray(headLen), body.subarray(0, headLen));
  } catch {
    return { ok: false, reason: hasPw ? "password" : "invalid" };
  }
  return finishSelf(parsed.id, flags, plain);
}

/** odkaz s kódem (obsah „MNQ“ v2): z kódu se odvodí id i klíč, s heslem klíč z kódu + hesla */
async function openCode(parsed: Extract<ParsedShare, { kind: "code" }>, password?: string): Promise<OpenResult> {
  if (!selfStoreBase()) return { ok: false, reason: "notfound" };
  let d: ShareDerived;
  try {
    d = await deriveShareCode(parsed.code);
  } catch {
    return { ok: false, reason: "invalid" };
  }
  const body = await fetchSelf(d.id);
  if (!(body instanceof Uint8Array)) return body;
  if (body.length < 5 + 28 || !hasMagic(body, MAGIC2)) return { ok: false, reason: "invalid" };
  const flags = body[4];
  const hasPw = !!(flags & F_PASSWORD);
  const pw = password?.trim();
  if (hasPw && !pw) return { ok: false, reason: "password" };
  let plain: Uint8Array;
  try {
    const key = await keyFromRaw(hasPw ? (await deriveShareCode(parsed.code, pw)).key : d.key);
    plain = await decrypt(key, body.subarray(5), body.subarray(0, 5));
  } catch {
    return { ok: false, reason: hasPw ? "password" : "invalid" };
  }
  return finishSelf(d.id, flags, plain);
}

/** Otevře sdílený dokument. Při ochraně heslem bez hesla vrací reason „password“. */
export async function openShareLink(parsed: ParsedShare, password?: string): Promise<OpenResult> {
  // bez WebCrypto (stránka na http://) jde otevřít jen dokument v odkazu bez hesla
  if (!shareCryptoOk() && !(parsed.kind === "link" && !parsed.salt)) return { ok: false, reason: "insecure" };
  if (parsed.kind === "code") return openCode(parsed, password);
  if (parsed.kind === "self") return openSelf(parsed, password);
  if (parsed.kind === "link") {
    let bytes: Uint8Array;
    try {
      bytes = unb64u(parsed.data);
    } catch {
      return { ok: false, reason: "invalid" };
    }
    if (parsed.salt) {
      if (!password) return { ok: false, reason: "password" };
      try {
        bytes = await decrypt(await keyFromPassword(password, unb64u(parsed.salt)), bytes);
      } catch {
        return { ok: false, reason: "password" };
      }
    }
    const p = await unpack(bytes, parsed.compressed);
    return p ? checkExp(p) : { ok: false, reason: "invalid" };
  }
  const store = storeConfig();
  if (!store) return { ok: false, reason: "notfound" };
  if (parsed.salt && !password) return { ok: false, reason: "password" };
  let res: Response;
  try {
    res = await fetch(`${store.url}/storage/v1/object/public/${STORE_BUCKET}/${parsed.path}`, { headers: { apikey: store.key } });
  } catch {
    return { ok: false, reason: "network" };
  }
  if (res.status === 404 || res.status === 400) return { ok: false, reason: "notfound" };
  if (!res.ok) return { ok: false, reason: "network" };
  const body = new Uint8Array(await res.arrayBuffer());
  try {
    const key = parsed.salt ? await keyFromPassword(parsed.key + "\u0000" + password, unb64u(parsed.salt)) : await keyFromRaw(unb64u(parsed.key));
    const packed = await decrypt(key, body);
    const p = (await unpack(packed, true)) ?? (await unpack(packed, false));
    if (!p) return { ok: false, reason: "invalid" };
    const r = checkExp(p);
    return r.ok ? { ...r, mode: "store" } : r;
  } catch {
    return { ok: false, reason: parsed.salt ? "password" : "invalid" };
  }
}

/** Text zprávy k odkazu (WhatsApp / e-mail). */
export function shareMessage(docName: string, r: ShareResult): string {
  const until = r.exp ? tr(" (platí do {0})", new Date(r.exp).toLocaleDateString(cadLocale())) : "";
  return tr("Mnástrojárna CAD – sdílený dokument „{0}“{1}:\n{2}{3}\n\nOtevře se v prohlížeči bez instalace (Chrome, Edge, Firefox, Safari).", docName, until, r.url, r.password ? tr("\n\nOdkaz je chráněný heslem – pošlu ho zvlášť.") : "");
}

/**
 * Důvod neotevření odkazu česky. `kind` = druh odkazu: u odkazu s kódem „nenalezeno“ nejčastěji znamená překlep
 * (jiné písmeno, velikost písmen) – hlášení na to upozorní.
 */
export function openErrorText(reason: Exclude<OpenResult, { ok: true }>["reason"], exp?: number | null, kind?: ParsedShare["kind"]): string {
  switch (reason) {
    case "expired":
      return tr("Platnost sdíleného odkazu vypršela{0}. Požádejte odesílatele o nové sdílení.", exp ? ` (${new Date(exp).toLocaleDateString(cadLocale())})` : "");
    case "revoked":
      return tr("Odesílatel tento sdílený odkaz zneplatnil. Požádejte ho o nové sdílení.");
    case "password":
      return tr("Nesprávné heslo.");
    case "insecure":
      return tr("Sdílený odkaz jde otevřít jen přes zabezpečené připojení: otevřete ho na adrese začínající https:// (na http:// prohlížeč šifrování nedovolí).");
    case "notfound":
      if (kind === "code") return tr("Dokument s tímto kódem v úložišti není. Zkontrolujte kód – záleží na velikosti písmen a znaky 0, O, I a l se v něm nevyskytují. Je-li kód správně, požádejte odesílatele o nové sdílení.");
      return tr("Sdílený dokument už v úložišti není (platnost vypršela nebo byl smazán). Požádejte odesílatele o nové sdílení.");
    case "network":
      return tr("Úložiště sdílení není dostupné. Zkuste to znovu později.");
    default:
      return tr("Odkaz není platný sdílený dokument Mnástrojárna CAD (zkontrolujte, zda se zkopíroval celý).");
  }
}
export const CHECK_TAG = CHECK;
