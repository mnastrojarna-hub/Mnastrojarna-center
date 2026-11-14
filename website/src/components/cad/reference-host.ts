/**
 * Hostitel příkazů předlohy (cad/reference/run.ts) v aplikaci: promítnuté pohledy modelu z jádra (cad.drawing),
 * připojené soubory konzole (cad/attached-files.ts), stažení obrázku překryvu bez dialogu, pdf.js z /public/vendor.
 * Jediné místo, kde předloha sahá na prohlížeč – smyčka příkazů v cad-app.tsx volá jen `runReferenceOp`.
 */
import { attachedFiles, attachedList } from "@/cad/attached-files";
import { b64ToBytes } from "@/cad/blobs";
import { cad } from "@/cad/client";
import type { DrawingMeta, DrawingOptions } from "@/cad/drawing";
import { loadPdfJs, pdfDocOptions } from "@/cad/pdfjs";
import type { RefCmd } from "@/cad/reference/parse";
import type { RefResult } from "@/cad/reference/run";
import type { CadDoc } from "@/cad/types";
import { writeSaved } from "@/lib/save-file";

/** bajty připojeného souboru (data URL) */
const dataUrlBytes = (u: string) => b64ToBytes(u.replace(/^data:[^,]*,/, ""));

/** provedení příkazu předlohy nad dokumentem (výsledek: protokol, změněný / nový dokument) */
export async function runReferenceOp(cmd: RefCmd, d: CadDoc): Promise<RefResult> {
  const { runReferenceCmd } = await import("@/cad/reference/run");
  return runReferenceCmd(cmd, d, {
    drawing: (doc, meta, opts) => cad.drawing(doc, meta as DrawingMeta, opts as Partial<DrawingOptions>) as never,
    file: (name) => {
      const f = attachedFiles.get(name);
      return f ? { name: f.name, bytes: dataUrlBytes(f.dataUrl) } : null;
    },
    attached: attachedList,
    download: async (name, bytes, mime) => void (await writeSaved({ name, handle: null }, bytes as BlobPart, mime)),
    load: {
      pdfjs: async () => {
        const lib = await loadPdfJs();
        const { data: _d, ...docOptions } = pdfDocOptions(new Uint8Array(0));
        void _d;
        return { lib: lib as never, docOptions };
      },
    },
  });
}
