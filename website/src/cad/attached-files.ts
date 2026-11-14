/**
 * Soubory připojené k textovým příkazům (tlačítko „Připojit soubor…“ v konzoli Textové příkazy, logo v razítku a další
 * příkazy, které berou soubor podle názvu – např. `výkres razítko logo="firma.png"`). Jen v paměti karty (nic se
 * neukládá ani neodesílá); název se hledá bez ohledu na velikost písmen, i bez cesty a přípony.
 */
export type AttachedFile = { name: string; mime: string; dataUrl: string; bytes: number; at: number };

const files = new Map<string, AttachedFile>();
const subs = new Set<() => void>();
const key = (n: string) => n.trim().replace(/^.*[\\/]/, "").toLowerCase();
const stem = (n: string) => key(n).replace(/\.[^.]+$/, "");

export const attachedFiles = {
  /** připojí soubor (stejný název = nahradí) */
  add(f: Omit<AttachedFile, "at"> & { at?: number }): AttachedFile {
    const v = { ...f, name: f.name.replace(/^.*[\\/]/, ""), at: f.at ?? Date.now() };
    files.set(key(v.name), v);
    for (const s of subs) s();
    return v;
  },
  /**
   * Soubory odpovídající názvu: přesný název, jinak shoda bez přípony, jinak názvy začínající zadaným textem.
   * Víc než jeden = nejednoznačný název (volající ho ohlásí se seznamem); žádný = soubor není připojený.
   */
  matches(name: string): AttachedFile[] {
    const k = key(name);
    if (!k) return [];
    if (files.has(k)) return [files.get(k)!];
    const all = [...files.values()].sort((a, b) => a.at - b.at);
    const byStem = all.filter((f) => stem(f.name) === stem(name));
    if (byStem.length) return byStem;
    return all.filter((f) => key(f.name).startsWith(k));
  },
  /** soubor podle názvu (jednoznačná shoda podle `matches`), jinak null */
  get(name: string): AttachedFile | null {
    const m = attachedFiles.matches(name);
    return m.length === 1 ? m[0] : null;
  },
  list(): AttachedFile[] {
    return [...files.values()].sort((a, b) => a.at - b.at);
  },
  remove(name: string): boolean {
    const ok = files.delete(key(name));
    if (ok) for (const s of subs) s();
    return ok;
  },
  clear() {
    files.clear();
    for (const s of subs) s();
  },
  subscribe(f: () => void) {
    subs.add(f);
    return () => void subs.delete(f);
  },
};

/** přehled připojených souborů pro chybové hlášky („firma.png (12 kB), …“) */
export const attachedList = (): string =>
  attachedFiles
    .list()
    .map((f) => `${f.name} (${Math.max(1, Math.round(f.bytes / 1024))} kB)`)
    .join(", ");

/** Soubor jako data URL v prohlížeči (FileReader). */
export function readFileAsDataUrl(file: Blob): Promise<string> {
  return new Promise((res, rej) => {
    const r = new FileReader();
    r.onload = () => res(String(r.result));
    r.onerror = () => rej(r.error ?? new Error("FileReader"));
    r.readAsDataURL(file);
  });
}
