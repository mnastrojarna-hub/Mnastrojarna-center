/**
 * Přiložené soubory v prohlížeči (CAD-HEADLESS-NAVRH.md kap. 2.3 `FileSource`, 6.2; balík B5): vstupy příkazů
 * `porovnat "ref.step"` a `otevřít "díl.mncad"` z konzole – v CLI je dává `--files` / složka skriptu, v HTTP `body.files`,
 * v aplikaci tlačítko „Připojit soubor…“ konzole a `window.mncad.attach(…)`. Jen paměť záložky prohlížeče (po obnovení
 * stránky se přiloží znovu); stejný název přiložený podruhé nahradí předchozí.
 *
 * Jediné úložiště připojených souborů aplikace: logo razítka (`výkres razítko logo="firma.png"`) a předloha DWG / PDF
 * (`předloha "výkres.dwg"`) ho čtou přes `cad/attached-files.ts` (data URL, hledání i bez přípony), `porovnat` / `otevřít`
 * přes `FileSource` (`read`).
 */
import { tr } from "../i18n";
import { MissingInputError, type FileSource } from "./host";

/** nejvíc přiložených souborů a dat celkem (paměť prohlížeče) */
export const ATTACH_LIMIT = { files: 64, bytes: 512 * 1024 * 1024 };

export type AttachInput = { name: string; base64: string } | { name: string; text: string } | { name: string; data: Uint8Array | ArrayBuffer };
export type AttachedFile = { name: string; bytes: number };
/** připojený soubor s daty a typem (pořadí připojení `at`) */
export type AttachedItem = { name: string; data: Uint8Array; mime: string; at: number };
export type AttachmentStore = FileSource & {
  add(name: string, data: Uint8Array, mime?: string): AttachedFile;
  remove(name: string): boolean;
  clear(): void;
  entries(): AttachedFile[];
  /** soubory s daty v pořadí připojení */
  items(): AttachedItem[];
  /**
   * Soubory odpovídající názvu (logo razítka, předloha): přesný název (bez cesty, bez ohledu na velikost písmen), jinak shoda
   * bez přípony, jinak názvy začínající zadaným textem. Víc než jeden = nejednoznačný název; žádný = soubor není připojený.
   */
  matches(name: string): AttachedItem[];
  /** odběr změn seznamu (konzole ukazuje připojené soubory) */
  subscribe(fn: () => void): () => void;
};

/** název bez cesty (soubor z dialogu / `C:\…\a.step` → `a.step`) */
const baseName = (n: string) => String(n ?? "").replace(/^.*[\\/]/, "").trim();
const nameKey = (n: string) => baseName(n).toLowerCase();
const nameStem = (n: string) => nameKey(n).replace(/\.[^.]+$/, "");

/**
 * Názvy souborů odpovídající zadanému názvu (logo razítka, předloha – i bez přípony nebo jen začátkem): přesný název (bez
 * cesty, bez ohledu na velikost písmen), jinak shoda bez přípony, jinak názvy začínající zadaným textem; `items` v pořadí,
 * ve kterém se mají nabídnout. Víc než jeden = nejednoznačný název.
 */
export function matchNames<T>(items: readonly T[], name: string, nameOf: (x: T) => string): T[] {
  const key = nameKey(name);
  if (!key) return [];
  const exact = items.filter((x) => nameKey(nameOf(x)) === key);
  if (exact.length) return exact;
  const byStem = items.filter((x) => nameStem(nameOf(x)) === nameStem(name));
  if (byStem.length) return byStem;
  return items.filter((x) => nameKey(nameOf(x)).startsWith(key));
}

function b64Bytes(s: string): Uint8Array {
  const clean = s.replace(/^data:[^,]*,/, "").replace(/\s+/g, "");
  if (!/^[A-Za-z0-9+/_-]*={0,2}$/.test(clean)) throw new Error(tr("attach: base64 obsahuje neplatné znaky"));
  const bin = atob(clean.replace(/-/g, "+").replace(/_/g, "/"));
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

/** data přiloženého souboru z volání `window.mncad.attach` */
export function attachBytes(f: AttachInput): Uint8Array {
  if ("base64" in f && typeof f.base64 === "string") return b64Bytes(f.base64);
  if ("text" in f && typeof f.text === "string") return new TextEncoder().encode(f.text);
  if ("data" in f && f.data instanceof Uint8Array) return f.data;
  if ("data" in f && f.data instanceof ArrayBuffer) return new Uint8Array(f.data);
  throw new Error(tr("attach potřebuje {0}", "{ name, base64 } | { name, text } | { name, data }"));
}

/** Úložiště přiložených souborů (FileSource pro engine). Názvy se porovnávají bez ohledu na velikost písmen. */
export function attachmentStore(): AttachmentStore {
  const files = new Map<string, AttachedItem>();
  const subs = new Set<() => void>();
  const k = nameKey;
  const total = () => [...files.values()].reduce((a, f) => a + f.data.length, 0);
  const changed = () => {
    for (const f of subs) f();
  };
  const byAt = () => [...files.values()].sort((a, b) => a.at - b.at);
  let seq = 0;
  return {
    list: () => [...files.values()].map((f) => f.name).sort(),
    async read(name: string) {
      const f = files.get(k(name));
      if (!f) throw new MissingInputError(name, [...files.values()].map((x) => x.name).sort());
      return { name: f.name, data: f.data };
    },
    add(name: string, data: Uint8Array, mime?: string) {
      const n = baseName(name);
      if (!n) throw new Error(tr("attach: chybí název souboru"));
      const prev = files.get(k(n));
      if (!prev && files.size >= ATTACH_LIMIT.files) throw new Error(tr("přiložit lze nejvýš {0} souborů – odeberte některý (window.mncad.detach)", ATTACH_LIMIT.files));
      if (total() - (prev?.data.length ?? 0) + data.length > ATTACH_LIMIT.bytes) throw new Error(tr("přiložené soubory by měly víc než {0} MB", Math.round(ATTACH_LIMIT.bytes / 1048576)));
      // pořadí připojení: čas a pořadové číslo (dvě připojení v téže milisekundě)
      files.set(k(n), { name: n, data, mime: mime || "application/octet-stream", at: Date.now() + ++seq / 1e6 });
      changed();
      return { name: n, bytes: data.length };
    },
    remove: (name: string) => {
      const ok = files.delete(k(name));
      if (ok) changed();
      return ok;
    },
    clear: () => {
      files.clear();
      changed();
    },
    entries: () => [...files.values()].map((f) => ({ name: f.name, bytes: f.data.length })).sort((a, b) => a.name.localeCompare(b.name)),
    items: byAt,
    matches: (name: string) => matchNames(byAt(), name, (f) => f.name),
    subscribe(fn: () => void) {
      subs.add(fn);
      return () => void subs.delete(fn);
    },
  };
}

/** přiložené soubory aplikace (jedna záložka prohlížeče) – vstupy enginu v aplikaci (components/cad/engine-port.ts) */
export const appAttachments: AttachmentStore = attachmentStore();
