/**
 * Data importů (STEP, STL, BREP…) v šifrovaném úložišti prohlížeče.
 *
 * Dokument drží jen odkazy `mnblob:<otisk>` (blobs.ts) – automatické uložení, záložky a nedávné soubory (vault.ts, localStorage)
 * by bez dat importů po obnovení stránky neměly co postavit. Bajty se proto ukládají zvlášť do IndexedDB: každý soubor jednou
 * podle otisku, zašifrovaný stejným klíčem jako dokumenty (AES-GCM). Časté automatické ukládání pak zapisuje jen malý JSON
 * s odkazy; data souboru se šifrují a zapisují jen poprvé (10 MB import ≈ desítky ms jednou, ne při každé změně).
 *
 * V režimu „neukládat“ (výchozí) se nic nezapisuje; vypnutí / vymazání úložiště smaže i tuto databázi (`wipeStoredDocuments`).
 */
import { BLOB_PREFIX, blobIdOf, blobOf, docBlobEntries, docBlobRefs, hasBlob, missingBlobFiles, putBlobAs } from "./blobs";
import { tr } from "./i18n";
import type { CadDoc } from "./types";
import { BLOB_DB, isUnlocked, persistMode, storedDocKeys, vaultGeneration, vaultGet, vaultSeal, vaultUnseal } from "./vault";

/** úložiště zašifrovaných dat podle otisku (IndexedDB; v testech náhrada v paměti) */
export type BlobBackend = {
  get(id: string): Promise<Uint8Array | undefined>;
  put(id: string, data: Uint8Array): Promise<void>;
  delete(id: string): Promise<void>;
  keys(): Promise<string[]>;
};

const STORE = "blobs";
let db: Promise<IDBDatabase> | null = null;

function openDb(): Promise<IDBDatabase> {
  if (db) return db;
  db = new Promise<IDBDatabase>((resolve, reject) => {
    const rq = indexedDB.open(BLOB_DB, 1);
    rq.onupgradeneeded = () => {
      if (!rq.result.objectStoreNames.contains(STORE)) rq.result.createObjectStore(STORE);
    };
    rq.onsuccess = () => {
      const d = rq.result;
      // vymazání úložiště (deleteDatabase) čeká na zavření otevřených spojení
      d.onversionchange = () => {
        d.close();
        db = null;
      };
      resolve(d);
    };
    rq.onerror = () => reject(rq.error);
    rq.onblocked = () => reject(new Error("IndexedDB blocked"));
  });
  db.catch(() => {
    db = null;
  });
  return db;
}

const req = <T>(r: IDBRequest<T>) =>
  new Promise<T>((resolve, reject) => {
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });

async function tx<T>(mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const d = await openDb();
  const t = d.transaction(STORE, mode);
  const res = await req(fn(t.objectStore(STORE)));
  if (mode === "readwrite")
    await new Promise<void>((resolve, reject) => {
      t.oncomplete = () => resolve();
      t.onerror = () => reject(t.error);
      t.onabort = () => reject(t.error ?? new Error("IndexedDB abort"));
    });
  return res;
}

const idbBackend: BlobBackend = {
  get: async (id) => {
    const v = await tx("readonly", (s) => s.get(id) as IDBRequest<ArrayBuffer | Uint8Array | undefined>);
    return v ? (v instanceof Uint8Array ? v : new Uint8Array(v)) : undefined;
  },
  put: async (id, data) => {
    await tx("readwrite", (s) => s.put(data, id));
  },
  delete: async (id) => {
    await tx("readwrite", (s) => s.delete(id));
  },
  keys: async () => (await tx("readonly", (s) => s.getAllKeys())).map(String),
};

let backend: BlobBackend | null = typeof indexedDB !== "undefined" ? idbBackend : null;
/** náhrada úložiště (testy) */
export function setBlobBackend(b: BlobBackend | null) {
  backend = b;
  persisted.clear();
  pending.clear();
  gaveUp.clear();
}

/** otisky, které už v úložišti jsou (zapsané nebo načtené v této kartě) – zapisují se jen poprvé */
const persisted = new Set<string>();
const pending = new Map<string, Promise<boolean>>();
/** data, která se uložit nepodařilo (plné úložiště) – při dalších automatických uloženích se znovu nešifrují (ohlásí se jednou) */
const gaveUp = new Set<string>();
let gen = -1;
const syncGeneration = () => {
  if (gen !== vaultGeneration()) {
    gen = vaultGeneration();
    persisted.clear();
    pending.clear();
    gaveUp.clear();
  }
};

const active = () => !!backend && persistMode() === "encrypted" && isUnlocked();

async function persistOne(id: string): Promise<boolean> {
  const bytes = blobOf(BLOB_PREFIX + id);
  if (!bytes || !backend) return false;
  const sealed = await vaultSeal(bytes);
  if (!sealed) return false;
  await backend.put(id, sealed);
  return true;
}

export type PersistReport = { written: number; bytes: number; failed: string[]; ms: number };

/**
 * Uloží data importů dokumentu, která v úložišti ještě nejsou (každý otisk jednou). Volá se při automatickém uložení –
 * opakované volání se stejnými odkazy nic nešifruje ani nezapisuje. `failed` = názvy souborů, jejichž data se uložit
 * nepodařilo (plné úložiště, IndexedDB nedostupné).
 */
export async function persistDocBlobs(doc: CadDoc): Promise<PersistReport> {
  const t0 = performance.now();
  const out: PersistReport = { written: 0, bytes: 0, failed: [], ms: 0 };
  if (persistMode() !== "encrypted" || !isUnlocked()) return out;
  syncGeneration();
  const todo = docBlobEntries(doc).filter((e) => hasBlob(e.ref) && !persisted.has(blobIdOf(e.ref)) && !gaveUp.has(blobIdOf(e.ref)));
  if (todo.length)
    await Promise.all(
      todo.map(async ({ ref, fileName }) => {
        const id = blobIdOf(ref);
        let p = pending.get(id);
        const mine = !p;
        if (!p) {
          p = persistOne(id).catch(() => false);
          pending.set(id, p);
        }
        const ok = await p;
        if (mine) {
          pending.delete(id);
          if (ok) {
            persisted.add(id);
            out.written++;
            out.bytes += blobOf(ref)?.length ?? 0;
          } else gaveUp.add(id);
        }
        if (!ok) out.failed.push(fileName);
      }),
    );
  out.ms = performance.now() - t0;
  return out;
}

/**
 * Doplní do paměti data importů dokumentu z úložiště (obnova po načtení stránky, záložky, nedávné soubory).
 * Vrací názvy souborů, jejichž data nejsou ani v úložišti.
 */
export async function loadDocBlobs(doc: CadDoc): Promise<string[]> {
  const missing = docBlobRefs(doc).filter((r) => !hasBlob(r));
  if (missing.length && active()) {
    syncGeneration();
    await Promise.all(
      missing.map(async (ref) => {
        const id = blobIdOf(ref);
        try {
          const sealed = await backend!.get(id);
          const bytes = sealed ? await vaultUnseal(sealed) : null;
          if (bytes) {
            putBlobAs(id, bytes);
            persisted.add(id);
          }
        } catch {
          /* chybí – ohlásí se názvem souboru */
        }
      }),
    );
  }
  return missingBlobFiles(doc);
}

/**
 * Úklid: smaže data importů, na která už žádný uložený dokument neodkazuje (rozpracovaný dokument, nedávné soubory)
 * a která nejsou v paměti této karty. Vrací počet smazaných.
 */
export async function gcVaultBlobs(): Promise<number> {
  if (!active()) return 0;
  syncGeneration();
  const keep = new Set<string>();
  const re = /mnblob:([0-9a-z]+)/g;
  for (const k of storedDocKeys()) {
    const t = await vaultGet(k);
    if (t) for (const m of t.matchAll(re)) keep.add(m[1]);
  }
  let n = 0;
  for (const id of await backend!.keys()) {
    if (keep.has(id) || hasBlob(BLOB_PREFIX + id) || pending.has(id)) continue;
    await backend!.delete(id);
    persisted.delete(id);
    n++;
  }
  return n;
}

/** hlášení pro uživatele: obnovený dokument odkazuje na soubory, jejichž data nejsou v paměti ani v úložišti */
export const lostImportsText = (names: string[]) =>
  tr("Dokument odkazuje na importované soubory, jejichž data nejsou v paměti ani v úložišti prohlížeče: {0}. Tyto prvky se nepostaví – otevřete soubory znovu (nebo uložený projekt .mncad).", names.join(", "));
