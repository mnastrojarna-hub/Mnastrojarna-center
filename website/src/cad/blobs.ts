/**
 * Úložiště obsahu importovaných souborů podle otisku (content-addressed).
 *
 * Importovaný STEP / BREP / STL dřív žil v dokumentu jako řetězec base64 (46 MB soubor = 62 MB textu). Dokument se v UI
 * kopíruje do historie Zpět, převádí na JSON (klíče geometrie, automatické ukládání, posílání do jádra) – každá taková operace
 * pak trvala desítky až stovky milisekund a držela další kopie v paměti. Teď prvek / komponenta drží jen odkaz
 * `mnblob:<otisk>` a bajty jsou tady (jednou). Do jádra (worker) se bajty posílají jen poprvé (`client.ts`), do souboru
 * `.mncad` se při uložení vloží zpět jako base64 (`embedBlobs`) – uložené soubory zůstávají samostatné a staré soubory se
 * při otevření převedou na odkazy (`internBlobs`).
 */
import { pruneUnderlays } from "./sketch-underlay";
import type { CadDoc, Feature } from "./types";

export const BLOB_PREFIX = "mnblob:";
/** od jaké délky base64 se data importu při otevření dokumentu převedou na odkaz */
const INTERN_MIN = 4 * 1024;

/**
 * Uložený dokument (.mncad, sdílení): data importů jsou v mapě `blobs` (otisk → base64) jednou, prvky a komponenty drží
 * odkazy. Opakované výskyty téhož dílu (sestava STEP: 341 výskytů, 151 dílů) tak soubor nezvětšují. Starší soubory
 * s base64 přímo v prvcích se čtou dál (`internBlobs`).
 */
export type SavedDoc = CadDoc & { blobs?: Record<string, string> };

const store = new Map<string, Uint8Array>();

export const isBlobRef = (s: unknown): boolean => typeof s === "string" && s.startsWith(BLOB_PREFIX);

/** Otisk obsahu: dvojitý FNV-1a (2 × 32 bitů) + délka – stejný obsah = stejný odkaz. */
export function blobId(bytes: Uint8Array): string {
  let h1 = 0x811c9dc5;
  let h2 = 0x01000193 ^ bytes.length;
  const n = bytes.length;
  // po 4 bajtech (rychlejší než po jednom; zbytek po bajtech)
  const words = n >> 2;
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  for (let i = 0; i < words; i++) {
    const w = dv.getUint32(i << 2, true);
    h1 = Math.imul(h1 ^ w, 16777619);
    h2 = Math.imul(h2 ^ (w >>> 7 | w << 25), 2246822519);
  }
  for (let i = words << 2; i < n; i++) {
    h1 = Math.imul(h1 ^ bytes[i], 16777619);
    h2 = Math.imul(h2 ^ bytes[i], 2246822519);
  }
  return (h1 >>> 0).toString(16).padStart(8, "0") + (h2 >>> 0).toString(16).padStart(8, "0") + n.toString(36);
}

/** Uloží bajty a vrátí odkaz `mnblob:<otisk>` (stejná data se uloží jen jednou). */
export function putBlob(bytes: Uint8Array): string {
  const id = blobId(bytes);
  if (!store.has(id)) store.set(id, bytes);
  return BLOB_PREFIX + id;
}
/** uloží bajty pod známým otiskem (jádro dostává data od UI i s otiskem) */
export function putBlobAs(id: string, bytes: Uint8Array) {
  if (!store.has(id)) store.set(id, bytes);
}
export const blobOf = (ref: string): Uint8Array | undefined => store.get(ref.slice(BLOB_PREFIX.length));
export const hasBlob = (ref: string) => store.has(ref.slice(BLOB_PREFIX.length));
export const blobIdOf = (ref: string) => ref.slice(BLOB_PREFIX.length);
/** velikost uložených dat v bajtech (diagnostika) */
export const blobStats = () => ({ count: store.size, bytes: [...store.values()].reduce((s, b) => s + b.length, 0) });

/** Chybějící data importu (dokument z automatického uložení bez souboru, odkaz z jiné karty). */
export class MissingBlob extends Error {}

// ---------------- base64 ----------------

export function b64ToBytes(b64: string): Uint8Array {
  if (typeof atob === "function") {
    const s = atob(b64);
    const u = new Uint8Array(s.length);
    for (let i = 0; i < s.length; i++) u[i] = s.charCodeAt(i);
    return u;
  }
  return new Uint8Array(Buffer.from(b64, "base64"));
}
export function bytesToB64(u8: Uint8Array): string {
  if (typeof btoa !== "function") return Buffer.from(u8).toString("base64");
  const parts: string[] = [];
  for (let i = 0; i < u8.length; i += 0x8000) parts.push(String.fromCharCode(...u8.subarray(i, i + 0x8000)));
  return btoa(parts.join(""));
}

/** Data importu (odkaz nebo base64) → bajty. Chybějící odkaz → `MissingBlob`. */
export function dataBytes(data: string, fileName = ""): Uint8Array {
  if (isBlobRef(data)) {
    const b = blobOf(data);
    if (!b) throw new MissingBlob(fileName);
    return b;
  }
  return b64ToBytes(data);
}

// ---------------- procházení dokumentu ----------------

type DataHolder = { data: string; fileName?: string };
type ModelLike = { source?: { kind?: string; doc?: CadDoc } };
/** dokumenty vložené do výkresů (Další modely na listu → ze souboru .mncad) – i jejich importy patří k dokumentu */
function drawingModelDocs(doc: CadDoc): CadDoc[] {
  const out: CadDoc[] = [];
  for (const dr of doc.drawings ?? []) {
    const models = (dr?.options as { models?: unknown } | undefined)?.models;
    if (!Array.isArray(models)) continue;
    for (const m of models as ModelLike[]) if (m?.source?.kind === "doc" && m.source.doc && typeof m.source.doc === "object") out.push(m.source.doc);
  }
  return out;
}
/** všechna místa s daty importu v dokumentu (prvky importu, komponenty ze souboru, vnořené díly a podsestavy, modely ve výkresech) */
function holders(doc: CadDoc, out: DataHolder[] = [], depth = 0): DataHolder[] {
  if (depth > 20) return out;
  for (const f of doc.features ?? []) if (f.type === "import") out.push(f as Extract<Feature, { type: "import" }>);
  for (const c of doc.components ?? []) {
    const s = c.source;
    if (s.kind === "file") out.push(s);
    else holders(s.doc, out, depth + 1);
  }
  for (const d of drawingModelDocs(doc)) holders(d, out, depth + 1);
  return out;
}

/** odkazy na data importů v dokumentu (každý jednou) s názvem souboru */
export function docBlobEntries(doc: CadDoc): { ref: string; fileName: string }[] {
  const out = new Map<string, string>();
  for (const h of holders(doc)) if (isBlobRef(h.data) && !out.has(h.data)) out.set(h.data, h.fileName || blobIdOf(h.data));
  return [...out].map(([ref, fileName]) => ({ ref, fileName }));
}
export const docBlobRefs = (doc: CadDoc): string[] => docBlobEntries(doc).map((e) => e.ref);

/** Odkazy na data v libovolné hodnotě (zpráva pro jádro) – bez kopírování, jen průchod objekty. */
export function blobRefsIn(v: unknown, out = new Set<string>(), depth = 0): Set<string> {
  if (depth > 40 || v === null || typeof v !== "object") {
    if (isBlobRef(v)) out.add(v as string);
    return out;
  }
  if (ArrayBuffer.isView(v) || v instanceof ArrayBuffer) return out;
  if (Array.isArray(v)) {
    for (const x of v) {
      if (typeof x === "string") {
        if (isBlobRef(x)) out.add(x);
      } else if (x && typeof x === "object") blobRefsIn(x, out, depth + 1);
    }
    return out;
  }
  for (const k in v as Record<string, unknown>) {
    const x = (v as Record<string, unknown>)[k];
    if (typeof x === "string") {
      if (isBlobRef(x)) out.add(x);
    } else if (x && typeof x === "object") blobRefsIn(x, out, depth + 1);
  }
  return out;
}

const mapDoc = (doc: CadDoc, fn: (data: string) => string, depth = 0): CadDoc => {
  if (depth > 20) return doc;
  let changed = false;
  const features = (doc.features ?? []).map((f) => {
    if (f.type !== "import") return f;
    const d = fn(f.data);
    if (d === f.data) return f;
    changed = true;
    return { ...f, data: d };
  });
  const components = doc.components?.map((c) => {
    const s = c.source;
    if (s.kind === "file") {
      const d = fn(s.data);
      if (d === s.data) return c;
      changed = true;
      return { ...c, source: { ...s, data: d } };
    }
    const sub = mapDoc(s.doc, fn, depth + 1);
    if (sub === s.doc) return c;
    changed = true;
    return { ...c, source: { ...s, doc: sub } };
  });
  // dokumenty vložené do výkresů (Další modely na listu)
  const drawings = doc.drawings?.map((dr) => {
    const models = (dr?.options as { models?: unknown } | undefined)?.models;
    if (!Array.isArray(models)) return dr;
    let mch = false;
    const next = (models as ModelLike[]).map((m) => {
      if (m?.source?.kind !== "doc" || !m.source.doc || typeof m.source.doc !== "object") return m;
      const sub = mapDoc(m.source.doc, fn, depth + 1);
      if (sub === m.source.doc) return m;
      mch = true;
      return { ...m, source: { ...m.source, doc: sub } };
    });
    if (!mch) return dr;
    changed = true;
    return { ...dr, options: { ...dr.options, models: next } };
  });
  if (!changed) return doc;
  return { ...doc, features, ...(components ? { components } : {}), ...(drawings ? { drawings } : {}) };
};

/**
 * Velká data importů v dokumentu (base64) převede na odkazy do úložiště (otevření souboru .mncad, sdíleného odkazu, obnova).
 * Stejná data (opakované instance téhož dílu) se uloží jen jednou. Vrací tentýž objekt, když není co převádět.
 */
export function internBlobs(saved: CadDoc): CadDoc {
  let doc = saved;
  const map = (saved as SavedDoc).blobs;
  if (map && typeof map === "object") {
    for (const [id, b64] of Object.entries(map)) if (typeof b64 === "string") putBlobAs(id, b64ToBytes(b64));
    const { blobs: _b, ...rest } = saved as SavedDoc;
    void _b;
    doc = rest;
  }
  const memo = new Map<string, string>();
  return mapDoc(doc, (data) => {
    if (isBlobRef(data) || typeof data !== "string" || data.length < INTERN_MIN) return data;
    const hit = memo.get(data);
    if (hit) return hit;
    try {
      const ref = putBlob(b64ToBytes(data));
      memo.set(data, ref);
      return ref;
    } catch {
      return data; // neplatné base64 – nechat, chybu ohlásí jádro
    }
  });
}

/**
 * Dokument k uložení (.mncad, export pro AI, sdílení): data importů se přidají do mapy `blobs` (každá jen jednou), takže soubor
 * je samostatný. `inline: true` = base64 přímo v prvcích / komponentách (starší formát). Podklady skic, které v dokumentu
 * už nejsou, se vypustí (`pruneUnderlays`).
 */
export function embedBlobs(doc0: CadDoc, opts: { inline?: boolean } = {}): SavedDoc {
  const doc = pruneUnderlays(doc0); // podklad smazané skici se neukládá ani nesdílí
  if (opts.inline) {
    const memo = new Map<string, string>();
    return mapDoc(doc, (data) => {
      if (!isBlobRef(data)) return data;
      const hit = memo.get(data);
      if (hit) return hit;
      const b = blobOf(data);
      if (!b) return data; // chybějící data zůstanou odkazem – jádro ohlásí srozumitelnou chybu
      const s = bytesToB64(b);
      memo.set(data, s);
      return s;
    });
  }
  const blobs: Record<string, string> = {};
  for (const h of holders(doc)) {
    if (!isBlobRef(h.data)) continue;
    const id = blobIdOf(h.data);
    if (blobs[id]) continue;
    const b = blobOf(h.data);
    if (b) blobs[id] = bytesToB64(b);
  }
  return Object.keys(blobs).length ? { ...doc, blobs } : doc;
}

/** Chybí některá data importů dokumentu? (např. dokument obnovený z automatického uložení) */
export function missingBlobs(doc: CadDoc): string[] {
  return holders(doc)
    .map((h) => h.data)
    .filter((d) => isBlobRef(d) && !hasBlob(d));
}

/** Názvy souborů, jejichž data v paměti chybí (pro srozumitelné hlášení). */
export function missingBlobFiles(doc: CadDoc): string[] {
  const out = new Set<string>();
  for (const h of holders(doc)) if (isBlobRef(h.data) && !hasBlob(h.data)) out.add(h.fileName || blobIdOf(h.data));
  return [...out];
}

/** Celková velikost dat importů v dokumentu (bajty). */
export function docDataBytes(doc: CadDoc): number {
  const seen = new Set<string>();
  let n = 0;
  for (const h of holders(doc)) {
    if (seen.has(h.data)) continue;
    seen.add(h.data);
    n += isBlobRef(h.data) ? (blobOf(h.data)?.length ?? 0) : Math.floor((h.data.length * 3) / 4);
  }
  return n;
}
