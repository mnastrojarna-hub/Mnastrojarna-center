/**
 * Soubor ke stažení odkazem (balík B3; polní zpráva 959 – agent v prohlížeči v cloudu ke staženým souborům nedosáhne):
 * `uložit odkaz`, `export step odkaz`, `výkres export pdf … odkaz`, `skica export dxf odkaz`. Soubor se zašifruje
 * (AES-GCM, náhodný 128bitový klíč) a nahraje do vlastního úložiště odkazů (public/cad/share/index.php – stejné API jako
 * sdílený dokument, server vidí jen šifrovaná data); odkaz `<web>/cad/soubor/index.html#f=<id>.<klíč>` otevře malou
 * stránku (public/cad/soubor/index.html), která obsah stáhne, v prohlížeči dešifruje a nabídne soubor ke stažení.
 * Klíč je jen v části za `#` (ta se na server nikdy neposílá). Tvar odkazu a šifrování sdíleného dokumentu (share.ts) se
 * nemění – soubor má vlastní příznak a vlastní stránku.
 *
 * Obsah v úložišti: "MNQ" 0x01 | příznaky (2 = deflate, 8 = soubor) | iv 12 B | AES-GCM(kontejner), hlavička = AAD;
 * kontejner = délka JSON (uint32 LE) | JSON {v:1, name, mime, bytes, sha256, exp} | data souboru.
 */
import { b64u, deflate, inflate, probeSelfStore, selfStoreBase, timeoutSignal, unb64u, uploadTimeoutMs, type SelfStoreInfo } from "./share";
import { tr } from "./i18n";

/** cesta stránky, která soubor z odkazu dešifruje a nabídne ke stažení (vedle /cad/share/) */
export const FILE_PAGE_PATH = "/cad/soubor/index.html";
const MAGIC = [0x4d, 0x4e, 0x51, 0x01]; // "MNQ" v1
const F_DEFLATE = 2;
const F_FILE = 8;

export type SharedFileMeta = { v: 1; name: string; mime: string; bytes: number; sha256: string; exp: number };
export type SharedFileResult = { url: string; bytes: number; exp: number; id: string; del: string };
export type SharedFile = { meta: SharedFileMeta; data: Uint8Array };

const enc = new TextEncoder();
const hex = (b: ArrayBuffer) => [...new Uint8Array(b)].map((x) => x.toString(16).padStart(2, "0")).join("");
const concat = (...parts: (Uint8Array | number[])[]) => {
  const out = new Uint8Array(parts.reduce((s, p) => s + p.length, 0));
  let o = 0;
  for (const p of parts) {
    out.set(p, o);
    o += p.length;
  }
  return out;
};

/** Chyba úložiště souborů: `unavailable` = úložiště neodpovídá / není nastavené (✗ share.store-unavailable), jinak odmítnutí */
export class FileStoreError extends Error {
  constructor(
    message: string,
    readonly unavailable: boolean,
  ) {
    super(message);
    this.name = "FileStoreError";
  }
}

/** stránka odkazu na soubor vedle úložiště (`https://…/cad/share/` → `https://…/cad/soubor/index.html`) */
export const filePageFor = (storeBase: string): string => new URL("../soubor/index.html", storeBase.replace(/\/?$/, "/")).href;

/** nahraje šifrovaný obsah do úložiště (po částech podle limitu serveru) – stejné API jako sdílený dokument */
async function upload(info: SelfStoreInfo, blob: Uint8Array, days: number): Promise<{ id: string; del: string; exp: number }> {
  const chunk = Math.max(65_536, Math.min(info.chunkBytes, blob.length));
  const post = async (url: string, body: Uint8Array, headers: Record<string, string> = {}) => {
    // časový limit: úložiště, které odpoví na ?ping, ale nahrávání nedokončí, nesmí zastavit celý běh (✗ share.store-unavailable)
    const ms = uploadTimeoutMs(body.length);
    const signal = timeoutSignal(ms);
    try {
      return await fetch(url, { method: "POST", credentials: "same-origin", cache: "no-store", headers: { "Content-Type": "application/octet-stream", ...headers }, body: body as BodyInit, ...(signal ? { signal } : {}) });
    } catch {
      if (signal?.aborted) throw new FileStoreError(`${tr("Úložiště sdílení neodpovídá – nahrávání nedoběhlo do {0} s.", Math.round(ms / 1000))} (${info.base})`, true);
      throw new FileStoreError(`${tr("Úložiště sdílení není dostupné (síť).")} (${info.base})`, true);
    }
  };
  const fail = async (res: Response): Promise<never> => {
    let j: { error?: string } = {};
    try {
      j = (await res.json()) as typeof j;
    } catch {
      /* bez JSON */
    }
    throw new FileStoreError(tr("Úložiště sdílení odmítlo nahrání ({0}).", `${res.status}${j.error ? " " + j.error : ""}`), false);
  };
  let res = await post(`${info.base}?days=${days}&total=${blob.length}`, blob.slice(0, chunk));
  if (!res.ok) await fail(res);
  const j = (await res.json()) as { id: string; del: string; exp: number; size: number };
  if (!/^[0-9A-Za-z]{8,12}$/.test(j.id ?? "") || !j.del) throw new FileStoreError(tr("Úložiště sdílení vrátilo neplatnou odpověď."), false);
  let size = j.size;
  while (size < blob.length) {
    res = await post(`${info.base}?id=${j.id}&offset=${size}`, blob.slice(size, size + chunk), { "X-Delete-Token": j.del });
    if (!res.ok) await fail(res);
    size = ((await res.json()) as { size: number }).size;
  }
  return { id: j.id, del: j.del, exp: j.exp * 1000 };
}

/**
 * Zašifruje soubor a nahraje ho do vlastního úložiště; vrátí odkaz na stránku, která ho nabídne ke stažení.
 * `store` = adresa úložiště (výchozí podle hostitele / stránky – `selfStoreBase`), `page` = stránka odkazu (výchozí vedle
 * úložiště). Úložiště neodpovídá → `FileStoreError` s `unavailable`.
 */
export async function shareFile(f: { name: string; mime: string; data: Uint8Array }, o: { days?: number; store?: string | null; page?: string } = {}): Promise<SharedFileResult> {
  const base = o.store !== undefined ? o.store : selfStoreBase();
  if (!base) throw new FileStoreError(tr("úložiště krátkých odkazů není nastavené"), true);
  const info = await probeSelfStore(false, base);
  if (!info) throw new FileStoreError(tr("úložiště krátkých odkazů neodpovídá ({0})", base), true);
  const days = Math.min(info.maxDays, Math.max(1, Math.round(o.days ?? 10)));
  const exp = Date.now() + days * 86_400_000;
  const meta: SharedFileMeta = { v: 1, name: f.name, mime: f.mime, bytes: f.data.length, sha256: hex(await crypto.subtle.digest("SHA-256", f.data as BufferSource)), exp };
  const json = enc.encode(JSON.stringify(meta));
  const head = new Uint8Array(4);
  new DataView(head.buffer).setUint32(0, json.length, true);
  const plain = concat(head, json, f.data);
  const z = await deflate(plain);
  const header = concat(MAGIC, [(z ? F_DEFLATE : 0) | F_FILE]);
  const raw = crypto.getRandomValues(new Uint8Array(16));
  const key = await crypto.subtle.importKey("raw", raw as BufferSource, "AES-GCM", false, ["encrypt"]);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv: iv as BufferSource, additionalData: header as BufferSource }, key, (z ?? plain) as BufferSource));
  const blob = concat(header, iv, ct);
  if (blob.length > info.maxBytes) throw new FileStoreError(tr("Soubor je pro úložiště odkazů příliš velký: {0} B po kompresi a zašifrování, limit {1} B.", blob.length, info.maxBytes), false);
  const up = await upload(info, blob, days);
  const page = o.page ?? filePageFor(info.base);
  return { url: `${page}#f=${up.id}.${b64u(raw)}`, bytes: blob.length, exp: up.exp, id: up.id, del: up.del };
}

/** rozbor části adresy za `#` odkazu na soubor: `f=<id>.<klíč>` */
export function parseFileHash(hash: string): { id: string; key: string } | null {
  const m = /(?:^#?|&)f=([0-9A-Za-z]{8,12})\.([A-Za-z0-9_-]{22})(?![A-Za-z0-9_-])/.exec(hash);
  return m ? { id: m[1], key: m[2] } : null;
}

/**
 * Dešifruje obsah z úložiště (stejný postup jako stránka public/cad/soubor/index.html) – testy, Node. Neplatný obsah,
 * klíč nebo otisk SHA-256 → chyba.
 */
export async function decryptSharedFile(blob: Uint8Array, key: string): Promise<SharedFile> {
  if (blob.length < 5 + 12 + 16 || MAGIC.some((b, i) => blob[i] !== b) || !(blob[4] & F_FILE)) throw new Error(tr("Odkaz nevede na sdílený soubor."));
  const header = blob.subarray(0, 5);
  const k = await crypto.subtle.importKey("raw", unb64u(key) as BufferSource, "AES-GCM", false, ["decrypt"]);
  const plain = new Uint8Array(await crypto.subtle.decrypt({ name: "AES-GCM", iv: blob.subarray(5, 17) as BufferSource, additionalData: header as BufferSource }, k, blob.subarray(17) as BufferSource));
  const data0 = blob[4] & F_DEFLATE ? await inflate(plain) : plain;
  const n = new DataView(data0.buffer, data0.byteOffset, data0.byteLength).getUint32(0, true);
  const meta = JSON.parse(new TextDecoder().decode(data0.subarray(4, 4 + n))) as SharedFileMeta;
  const data = data0.slice(4 + n);
  if (data.length !== meta.bytes || hex(await crypto.subtle.digest("SHA-256", data as BufferSource)) !== meta.sha256) throw new Error(tr("Sdílený soubor je poškozený (otisk nesouhlasí)."));
  return { meta, data };
}
