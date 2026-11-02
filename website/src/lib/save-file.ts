/**
 * Uložení souboru do počítače s dotazem na místo a název.
 *  – Chrome / Edge / Opera: systémový dialog „Uložit jako“ (File System Access API); dialog se otevře PŘED výpočtem dat,
 *    aby platilo uživatelské gesto i u delšího exportu (STEP, PDF).
 *  – Firefox / Safari: dotaz na název souboru a stažení do složky Stažené (prohlížeč umí nabídnout i vlastní umístění,
 *    je-li zapnuto „Vždy se zeptat, kam soubory ukládat“).
 * Vrací true při uložení, false při zrušení uživatelem.
 */

type PickerWindow = Window & {
  showSaveFilePicker?: (o: { suggestedName?: string; types?: { description?: string; accept: Record<string, string[]> }[]; excludeAcceptAllOption?: boolean }) => Promise<FileSystemFileHandle>;
};

export type SavedFile = { name: string; handle: FileSystemFileHandle | null };

const DESCRIPTIONS: Record<string, string> = {
  ".mncad": "Projekt Mnástrojárna CAD",
  ".step": "STEP (ISO 10303)",
  ".stp": "STEP (ISO 10303)",
  ".brep": "OpenCascade BREP",
  ".stl": "STL (3D tisk)",
  ".3mf": "3MF",
  ".obj": "Wavefront OBJ",
  ".glb": "glTF binární",
  ".wrl": "VRML",
  ".dxf": "DXF (AutoCAD výměnný formát)",
  ".dwg": "DWG (AutoCAD)",
  ".svg": "SVG",
  ".pdf": "PDF",
  ".csv": "CSV (tabulka)",
  ".json": "JSON",
};

function extOf(name: string) {
  const m = /\.[a-z0-9]+$/i.exec(name);
  return m ? m[0].toLowerCase() : "";
}

/** Otevře dialog (nebo dotaz na název) a vrátí cíl; `null` = zrušeno. */
export async function pickSaveTarget(suggested: string, mime: string): Promise<SavedFile | null> {
  const w = window as PickerWindow;
  const ext = extOf(suggested);
  const cleanMime = (mime.split(";")[0] || "application/octet-stream").trim();
  if (typeof w.showSaveFilePicker === "function") {
    try {
      const handle = await w.showSaveFilePicker({
        suggestedName: suggested,
        types: ext ? [{ description: DESCRIPTIONS[ext] ?? `${ext.slice(1).toUpperCase()} soubor`, accept: { [cleanMime]: [ext] } }] : undefined,
      });
      return { name: handle.name, handle };
    } catch (e) {
      if ((e as Error).name === "AbortError") return null; // uživatel zrušil
      /* SecurityError (vypršelo gesto) nebo jiná chyba → záložní cesta níže */
    }
  }
  const typed = window.prompt("Uložit jako – název souboru:", suggested);
  if (typed === null) return null;
  let name = typed.trim() || suggested;
  if (ext && !extOf(name)) name += ext;
  return { name, handle: null };
}

/** Zapíše data do cíle z `pickSaveTarget` (handle) nebo spustí stažení. */
export async function writeSaved(target: SavedFile, data: BlobPart, mime: string): Promise<void> {
  const blob = new Blob([data], { type: mime });
  if (target.handle) {
    const ws = await target.handle.createWritable();
    await ws.write(blob);
    await ws.close();
    return;
  }
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = target.name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

/**
 * Uloží soubor: nejdřív dotaz na místo a název, pak (případně asynchronní) výroba dat a zápis.
 * `data` může být funkce – zavolá se až po potvrzení dialogu (export se nepočítá zbytečně, když uživatel zruší).
 */
export async function saveFile(suggested: string, data: BlobPart | (() => Promise<BlobPart> | BlobPart), mime: string): Promise<SavedFile | null> {
  const target = await pickSaveTarget(suggested, mime);
  if (!target) return null;
  const payload = typeof data === "function" ? await data() : data;
  await writeSaved(target, payload, mime);
  return target;
}
