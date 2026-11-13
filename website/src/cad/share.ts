/**
 * Sdílení dokumentu odkazem (díl, sestava, výkresy) – s ohledem na ochranu dokumentace (NDA).
 *
 * Tři způsoby, všechny bez čitelných dat na serveru:
 *  – „krátký odkaz“ (výchozí, je-li k dispozici úložiště): dokument se v prohlížeči zašifruje (AES-GCM) náhodným
 *    128bitovým klíčem a nahraje do úložiště; v odkazu je jen krátké id a klíč za `#` (ta část se na server nikdy
 *    neposílá). Úložiště: Supabase Storage (NEXT_PUBLIC_CAD_SHARE_URL + NEXT_PUBLIC_CAD_SHARE_KEY, bucket `cad-share`),
 *    jinak vlastní úložiště na stejném webu – PHP skript `/cad/share/` (public/cad/share/index.php), když odpoví na `?ping`.
 *    Data importů (STEP…) jdou do úložiště binárně (ne base64) a zkomprimovaná – vejdou se i velké modely.
 *  – „v odkazu“ (bez serveru): celý dokument je zkomprimovaný (deflate) v části adresy za `#`. Dlouhý odkaz – použije
 *    se, když úložiště není (dialog řekne proč), při platnosti „bez omezení“ nebo na přání.
 *
 * Volitelné heslo: klíč se odvodí z hesla (PBKDF2-SHA-256, 200 000 iterací) – samotný odkaz pak nestačí.
 * Platnost: v obsahu je čas vypršení; po něm se dokument neotevře (v úložišti se navíc smaže).
 *
 * Tvar odkazu:   /cad#q=<id>.<klíč>          vlastní úložiště (id 10 znaků base62, klíč 22 znaků = 128 bitů); ~70 znaků.
 *                                            Heslo, sůl a příznaky jsou v (šifrovaném) obsahu – odkaz s heslem je stejně krátký.
 *                /cad#s=1d.<data>           dokument v odkazu, deflate
 *                /cad#s=1dp.<sůl>.<data>    totéž s heslem (data = AES-GCM)
 *                /cad#s=1r.<data>           bez komprese (prohlížeč bez CompressionStream)
 *                /cad#r=<cesta>.<klíč>      úložiště Supabase, klíč náhodný
 *                /cad#r=<cesta>.<klíč>.p<sůl>   úložiště Supabase + heslo
 *
 * Obsah ve vlastním úložišti:  "MNQ" 0x01 | příznaky (1 = heslo, 2 = deflate, 4 = kontejner) | [sůl 16 B] | iv 12 B | AES-GCM
 * (hlavička je ověřená jako AAD). Kontejner = délka JSON (uint32 LE) | JSON {v, exp, from, view, doc (odkazy mnblob), bin: [[otisk, délka]…]} | data importů.
 */
import { blobId, blobOf, docBlobRefs, embedBlobs, blobIdOf, putBlobAs } from "./blobs";
import { cadLocale, tr } from "./i18n";
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
};
export type ParsedShare =
  | { kind: "link"; data: string; compressed: boolean; salt: string | null }
  | { kind: "store"; path: string; key: string; salt: string | null }
  | { kind: "self"; id: string; key: string };
export type OpenResult = { ok: true; payload: SharePayload; mode: ShareMode } | { ok: false; reason: "expired" | "password" | "notfound" | "invalid" | "network"; exp?: number | null };

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
export type SelfStoreInfo = { base: string; maxBytes: number; chunkBytes: number; maxDays: number };
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
      if (!res.ok || !/json/i.test(res.headers.get("content-type") ?? "")) throw new Error("ping");
      const j = (await res.json()) as { ok?: unknown; max_bytes?: unknown; chunk_bytes?: unknown; max_days?: unknown };
      const max = Number(j.max_bytes);
      if (j.ok !== true || !(max > 0)) throw new Error("ping");
      const chunk = Number(j.chunk_bytes);
      return { base, maxBytes: max, chunkBytes: chunk >= 65_536 ? chunk : max, maxDays: Number(j.max_days) > 0 ? Number(j.max_days) : 90 };
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

const MAGIC = [0x4d, 0x4e, 0x51, 0x01]; // "MNQ" v1
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
async function uploadSelf(info: SelfStoreInfo, blob: Uint8Array, days: number, onProgress?: (sent: number, total: number) => void): Promise<{ id: string; del: string; exp: number }> {
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
  let res = await post(`${info.base}?days=${days}&total=${blob.length}`, blob.slice(0, chunk));
  if (!res.ok) await fail(res);
  const j = (await res.json()) as { id: string; del: string; exp: number; size: number };
  if (!/^[0-9A-Za-z]{8,12}$/.test(j.id ?? "") || !j.del) throw new ShareStoreError(tr("Úložiště sdílení vrátilo neplatnou odpověď."), true);
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

  // vlastní úložiště na webu (/cad/share/): krátký odkaz #q=<id>.<klíč 128 bitů>
  const asSelf = async (info: SelfStoreInfo | null): Promise<ShareResult> => {
    if (!info) throw new ShareStoreError(tr("Úložiště sdílení na serveru ({0}) neodpovídá.", SELF_STORE_PATH), true);
    const days = storeDays(info.maxDays);
    if (!days) throw new Error(tr("V úložišti musí mít odkaz omezenou platnost (max. {0} dní).", info.maxDays));
    const exp = expOf(days);
    const plain = packContainer({ v: 1, exp, from, view: o.view, doc });
    const z = await deflate(plain);
    const raw = crypto.getRandomValues(new Uint8Array(16));
    const salt = password ? crypto.getRandomValues(new Uint8Array(16)) : null;
    const header = concat(MAGIC, [(salt ? F_PASSWORD : 0) | (z ? F_DEFLATE : 0) | F_CONTAINER], salt ?? []);
    const key = salt ? await keyFromPassword(b64u(raw) + "\u0000" + password, salt) : await keyFromRaw(raw);
    const blob = concat(header, await encrypt(key, z ?? plain, header));
    if (blob.length > info.maxBytes) throw new ShareStoreError(tooBig(blob.length, info.maxBytes), false);
    const up = await uploadSelf(info, blob, days, o.onProgress);
    return { url: `${base}#q=${up.id}.${b64u(raw)}`, mode: "self", bytes: blob.length, exp, password: !!password, id: up.id, del: up.del };
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
    if (res.ok || res.status === 404) {
      selfCache.delete(r.id);
      return true;
    }
  } catch {
    /* síť */
  }
  return false;
}

/* ───────── otevření odkazu ───────── */
/** Rozpozná sdílený dokument v části adresy za # (`#q=…`, `#s=…` nebo `#r=…`). */
export function parseShareHash(hash: string): ParsedShare | null {
  const h = hash.replace(/^#/, "");
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

async function openSelf(parsed: Extract<ParsedShare, { kind: "self" }>, password?: string): Promise<OpenResult> {
  const base = selfStoreBase();
  if (!base) return { ok: false, reason: "notfound" };
  let body = selfCache.get(parsed.id);
  if (!body) {
    let res: Response;
    try {
      res = await fetch(`${base}?id=${encodeURIComponent(parsed.id)}`, { credentials: "same-origin" });
    } catch {
      return { ok: false, reason: "network" };
    }
    if (res.status === 410) {
      let exp: number | null = null;
      try {
        const j = (await res.json()) as { exp?: number };
        exp = typeof j.exp === "number" ? j.exp * 1000 : null;
      } catch {
        /* bez data */
      }
      return { ok: false, reason: "expired", exp };
    }
    if (res.status === 404 || res.status === 400) return { ok: false, reason: "notfound" };
    if (!res.ok) return { ok: false, reason: "network" };
    body = new Uint8Array(await res.arrayBuffer());
    selfCache.set(parsed.id, body);
    while (selfCache.size > 2) selfCache.delete(selfCache.keys().next().value as string);
  }
  if (body.length < 5 + 28 || MAGIC.some((b, i) => body[i] !== b)) return { ok: false, reason: "invalid" };
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
  let p: SharePayload | null = null;
  try {
    const data = flags & F_DEFLATE ? await inflate(plain) : plain;
    p = flags & F_CONTAINER ? unpackContainer(data) : JSON.parse(dec.decode(data));
  } catch {
    p = null;
  }
  if (!validPayload(p)) return { ok: false, reason: "invalid" };
  selfCache.delete(parsed.id);
  const r = checkExp(p);
  return r.ok ? { ...r, mode: "self" } : r;
}

/** Otevře sdílený dokument. Při ochraně heslem bez hesla vrací reason „password“. */
export async function openShareLink(parsed: ParsedShare, password?: string): Promise<OpenResult> {
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

/** Důvod neotevření odkazu česky. */
export function openErrorText(reason: Exclude<OpenResult, { ok: true }>["reason"], exp?: number | null): string {
  switch (reason) {
    case "expired":
      return tr("Platnost sdíleného odkazu vypršela{0}. Požádejte odesílatele o nové sdílení.", exp ? ` (${new Date(exp).toLocaleDateString(cadLocale())})` : "");
    case "password":
      return tr("Nesprávné heslo.");
    case "notfound":
      return tr("Sdílený dokument už v úložišti není (platnost vypršela nebo byl smazán). Požádejte odesílatele o nové sdílení.");
    case "network":
      return tr("Úložiště sdílení není dostupné. Zkuste to znovu později.");
    default:
      return tr("Odkaz není platný sdílený dokument Mnástrojárna CAD (zkontrolujte, zda se zkopíroval celý).");
  }
}
export const CHECK_TAG = CHECK;
