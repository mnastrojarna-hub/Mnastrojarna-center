/**
 * Sdílení dokumentu odkazem (díl, sestava, výkresy) – s ohledem na ochranu dokumentace (NDA).
 *
 * Dva způsoby, oba bez čitelných dat na serveru:
 *  – „v odkazu“ (výchozí, bez serveru): celý dokument je zkomprimovaný (deflate) v části adresy za `#`. Tuto část
 *    prohlížeč nikdy neposílá na server (ani na náš hosting, ani do měření návštěvnosti) – dokument existuje jen
 *    v odkazu, který si uživatel sám pošle (WhatsApp, e-mail, Teams…). Vhodné pro parametrické díly a sestavy
 *    (jednotky až desítky kB). Pro importovanou geometrii (STEP) bývá odkaz příliš dlouhý.
 *  – „úložiště“ (volitelné; NEXT_PUBLIC_CAD_SHARE_URL + NEXT_PUBLIC_CAD_SHARE_KEY = Supabase Storage, bucket
 *    `cad-share`): dokument se zašifruje náhodným klíčem (AES-GCM 256) a nahraje; klíč je JEN v odkazu za `#`.
 *    Server vidí pouze šifrovaná data. Soubory se po vypršení platnosti mažou (supabase/migrations/…_cad_share.sql).
 *
 * Volitelné heslo: klíč se odvodí z hesla (PBKDF2-SHA-256, 200 000 iterací) – samotný odkaz pak nestačí.
 * Platnost: v obsahu je čas vypršení; po něm se dokument neotevře (v úložišti se navíc smaže).
 *
 * Tvar odkazu:   /cad#s=1d.<data>          dokument v odkazu, deflate
 *                /cad#s=1dp.<sůl>.<data>   totéž s heslem (data = AES-GCM)
 *                /cad#s=1r.<data>          bez komprese (prohlížeč bez CompressionStream)
 *                /cad#r=<cesta>.<klíč>     úložiště, klíč náhodný
 *                /cad#r=<cesta>.<klíč>.p<sůl>   úložiště + heslo
 */
import { embedBlobs } from "./blobs";
import { cadLocale, tr } from "./i18n";
import type { CadDoc } from "./types";

export type ShareView = "model" | "drawing";
export type SharePayload = { v: 1; exp: number | null; from?: string; view?: ShareView; doc: CadDoc };
export type ShareMode = "link" | "store";
export type ShareResult = { url: string; mode: ShareMode; bytes: number; exp: number | null; password: boolean };
export type ParsedShare = { kind: "link"; data: string; compressed: boolean; salt: string | null } | { kind: "store"; path: string; key: string; salt: string | null };
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
async function encrypt(key: CryptoKey, plain: Uint8Array): Promise<Uint8Array> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv: iv as BufferSource }, key, plain as BufferSource));
  const out = new Uint8Array(12 + ct.length);
  out.set(iv);
  out.set(ct, 12);
  return out;
}
async function decrypt(key: CryptoKey, data: Uint8Array): Promise<Uint8Array> {
  return new Uint8Array(await crypto.subtle.decrypt({ name: "AES-GCM", iv: data.subarray(0, 12) as BufferSource }, key, data.subarray(12) as BufferSource));
}

/* ───────── konfigurace úložiště ───────── */
function storeConfig(): { url: string; key: string } | null {
  const url = (process.env.NEXT_PUBLIC_CAD_SHARE_URL ?? "").trim().replace(/\/+$/, "");
  const key = (process.env.NEXT_PUBLIC_CAD_SHARE_KEY ?? "").trim();
  return url && key ? { url, key } : null;
}
/** Je nastavené úložiště sdílení (pro velké dokumenty, např. importované STEP)? */
export const shareStoreConfigured = () => !!storeConfig();

/* ───────── vytvoření odkazu ───────── */
export type ShareOptions = {
  /** platnost ve dnech; null = bez omezení (jen režim „v odkazu“) */
  days: number | null;
  password?: string;
  view?: ShareView;
  /** jméno / firma odesílatele (zobrazí se příjemci) */
  from?: string;
  /** vynutit způsob; výchozí: v odkazu, pokud je krátký, jinak úložiště (je-li nastavené) */
  mode?: ShareMode;
  /** základ adresy (výchozí: aktuální stránka bez #) */
  base?: string;
};

function baseUrl(base?: string) {
  if (base) return base;
  if (typeof location === "undefined") return "/cad";
  return location.origin + location.pathname.replace(/\/$/, "") + (location.pathname.endsWith("/") ? "/" : "");
}

/** Sestaví odkaz. Vyhodí chybu s česky formulovaným důvodem (příliš velký dokument, úložiště nedostupné…). */
export async function createShareLink(doc: CadDoc, o: ShareOptions): Promise<ShareResult> {
  const exp = o.days ? Date.now() + o.days * 86_400_000 : null;
  // data importů (odkazy mnblob: platí jen v této kartě) se do odkazu vloží jako base64
  const payload: SharePayload = { v: 1, exp, from: o.from?.trim() || undefined, view: o.view, doc: embedBlobs(doc) };
  const json = enc.encode(JSON.stringify(payload));
  const packed = (await deflate(json)) ?? json;
  const compressed = packed !== json;
  const store = storeConfig();
  const password = o.password?.trim() || "";
  const base = baseUrl(o.base);

  const asLink = async (): Promise<ShareResult> => {
    let body: Uint8Array = packed;
    let salt: Uint8Array | null = null;
    if (password) {
      salt = crypto.getRandomValues(new Uint8Array(16));
      body = await encrypt(await keyFromPassword(password, salt), packed);
    }
    const flags = `1${compressed ? "d" : "r"}${salt ? "p" : ""}`;
    const url = `${base}#s=${flags}.${salt ? b64u(salt) + "." : ""}${b64u(body)}`;
    return { url, mode: "link", bytes: body.length, exp, password: !!password };
  };

  const asStore = async (): Promise<ShareResult> => {
    if (!store) throw new Error(tr("Úložiště sdílení není nastavené (NEXT_PUBLIC_CAD_SHARE_URL / NEXT_PUBLIC_CAD_SHARE_KEY)."));
    if (!o.days) throw new Error(tr("V úložišti musí mít odkaz omezenou platnost (max. 90 dní)."));
    const days = Math.min(90, Math.max(1, Math.round(o.days)));
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
      throw new Error(tr("Úložiště sdílení není dostupné (síť). Zkuste to znovu nebo pošlete soubor .mncad."));
    }
    if (!res.ok) throw new Error(tr("Úložiště sdílení odmítlo nahrání ({0}). Zkontrolujte nastavení bucketu „cad-share“.", res.status));
    const url = `${base}#r=${path.replace("/", "~").replace(/\.bin$/, "")}.${b64u(raw)}${salt ? ".p" + b64u(salt) : ""}`;
    return { url, mode: "store", bytes: body.length, exp, password: !!password };
  };

  if (o.mode === "store") return asStore();
  if (o.mode === "link") {
    const r = await asLink();
    if (r.url.length > LINK_MAX_CHARS) throw new Error(tr("Dokument je pro odkaz příliš velký ({0} kB, zřejmě importovaná geometrie). {1}", Math.round(r.url.length / 1024), store ? tr("Zvolte úložiště.") : tr("Uložte .mncad nebo STEP a pošlete soubor, nebo nastavte úložiště sdílení.")));
    return r;
  }
  // automaticky: krátký → v odkazu; dlouhý → úložiště, je-li k dispozici
  const r = await asLink();
  if (r.url.length <= LINK_WARN_CHARS || !store || !o.days) {
    if (r.url.length > LINK_MAX_CHARS) throw new Error(tr("Dokument je pro odkaz příliš velký ({0} kB, zřejmě importovaná geometrie). {1}", Math.round(r.url.length / 1024), store ? tr("Zvolte omezenou platnost a úložiště.") : tr("Uložte .mncad nebo STEP a pošlete soubor, nebo nastavte úložiště sdílení.")));
    return r;
  }
  return asStore();
}

/* ───────── otevření odkazu ───────── */
/** Rozpozná sdílený dokument v části adresy za # (`#s=…` nebo `#r=…`). */
export function parseShareHash(hash: string): ParsedShare | null {
  const h = hash.replace(/^#/, "");
  const params = new URLSearchParams(h);
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
    if (p?.v !== 1 || p.doc?.app !== "mnastrojarna-cad" || !Array.isArray(p.doc.features)) return null;
    return p;
  } catch {
    return null;
  }
}
function checkExp(p: SharePayload): OpenResult {
  if (p.exp && Date.now() > p.exp) return { ok: false, reason: "expired", exp: p.exp };
  return { ok: true, payload: p, mode: "link" };
}

/** Otevře sdílený dokument. Při ochraně heslem bez hesla vrací reason „password“. */
export async function openShareLink(parsed: ParsedShare, password?: string): Promise<OpenResult> {
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
