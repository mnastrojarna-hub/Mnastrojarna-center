/**
 * Soubory připojené k textovým příkazům (tlačítko „Připojit soubor…“ v konzoli Textové příkazy, logo v razítku a další
 * příkazy, které berou soubor podle názvu – např. `výkres razítko logo="firma.png"`, `předloha "výkres.dwg"`,
 * `porovnat "ref.step"`, `otevřít "díl.mncad"`). Jen v paměti karty (nic se neukládá ani neodesílá); název se hledá bez
 * ohledu na velikost písmen, i bez cesty a přípony.
 *
 * Úložiště je jedno – přiložené soubory enginu (`appAttachments`, cad/engine/attachments.ts: vstupy příkazů v aplikaci);
 * tento modul nad ním dává pohled s typem a data URL pro razítko a předlohu.
 */
import { b64ToBytes, bytesToB64 } from "./blobs";
import { appAttachments, type AttachedItem } from "./engine/attachments";

export type AttachedFile = { name: string; mime: string; dataUrl: string; bytes: number; at: number; data: Uint8Array };

/** připojený soubor jako záznam s data URL (počítá se až při čtení – velké soubory reference ho nepotřebují) */
function view(f: AttachedItem): AttachedFile {
  let url: string | null = null;
  return {
    name: f.name,
    mime: f.mime,
    bytes: f.data.length,
    at: f.at,
    data: f.data,
    get dataUrl() {
      return (url ??= `data:${f.mime};base64,${bytesToB64(f.data)}`);
    },
  };
}

export const attachedFiles = {
  /** připojí soubor (stejný název = nahradí) – data jako data URL nebo bajty */
  add(f: { name: string; mime: string; dataUrl?: string; data?: Uint8Array; bytes?: number; at?: number }): AttachedFile {
    const data = f.data ?? b64ToBytes((f.dataUrl ?? "").replace(/^data:[^,]*,/, ""));
    const r = appAttachments.add(f.name, data, f.mime);
    return view(appAttachments.items().find((x) => x.name === r.name)!);
  },
  /**
   * Soubory odpovídající názvu: přesný název, jinak shoda bez přípony, jinak názvy začínající zadaným textem.
   * Víc než jeden = nejednoznačný název (volající ho ohlásí se seznamem); žádný = soubor není připojený.
   */
  matches(name: string): AttachedFile[] {
    return appAttachments.matches(name).map(view);
  },
  /** soubor podle názvu (jednoznačná shoda podle `matches`), jinak null */
  get(name: string): AttachedFile | null {
    const m = attachedFiles.matches(name);
    return m.length === 1 ? m[0] : null;
  },
  list(): AttachedFile[] {
    return appAttachments.items().map(view);
  },
  remove(name: string): boolean {
    return appAttachments.remove(name);
  },
  clear() {
    appAttachments.clear();
  },
  subscribe(f: () => void) {
    return appAttachments.subscribe(f);
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
