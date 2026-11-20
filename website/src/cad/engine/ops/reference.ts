/**
 * Předloha DWG / DXF / PDF zákazníka (vlna 15, cad/reference): `předloha "výkres.dwg"` (připojení), `předloha stav | výtah …
 * | otevřít | odebrat`, `porovnat předloha pohled …`, `kontrola kót`. Výpočet je jeden (cad/reference/run.ts) pro aplikaci
 * i CLI: pohledy modelu počítá jádro hostitele (`kernel.drawing`), soubor předlohy je vstup hostitele (`host.inputs` –
 * v aplikaci připojené soubory konzole, v CLI `--files` / složka skriptu), obrázek překryvu jde do `host.files`.
 * DWG / DXF se čtou i bez prohlížeče (v prohlížeči v pracovním vlákně importu, v CLI ve vlákně běhu); PDF potřebuje pdf.js
 * hostitele (`host.pdfjs`) – bez něj ✗ `host.app-only`.
 * (Dřívější `components/cad/reference-host.ts` vlny 15 – obsluha předlohy ve staré smyčce cad-app.tsx – je touto operací nahrazen.)
 */
import type { DrawingMeta, DrawingOptions } from "../../drawing";
import { tr } from "../../i18n";
import { matchNames } from "../attachments";
import type { FileSource } from "../host";
import { flush, runOf } from "../run-doc";
import { startRunDoc, type RunDocStart } from "../runs";
import { coded, say, type OpHandler } from "./util";

const isPdfName = (n: string) => /\.pdf$/i.test(n);
const isPdfBytes = (u8: Uint8Array) => u8.length > 4 && u8[0] === 0x25 && u8[1] === 0x50 && u8[2] === 0x44 && u8[3] === 0x46;

/** soubor vstupů hostitele podle názvu (přesně, bez přípony, začátkem názvu – jako logo razítka), jen jednoznačná shoda */
async function inputFile(inputs: FileSource, name: string): Promise<{ name: string; bytes: Uint8Array } | null> {
  const hit = matchNames(inputs.list(), name, (n) => n);
  if (hit.length !== 1) return null;
  try {
    const f = await inputs.read(hit[0]);
    return { name: f.name, bytes: f.data };
  } catch {
    return null;
  }
}

export const referenceOp: OpHandler<"reference"> = async (op, ctx) => {
  const r = runOf(ctx);
  const host = ctx.host;
  const cmd = op.cmd;
  // soubory, které příkaz může číst (cad/reference/run.ts volá `file` synchronně): připojovaný soubor a soubor předlohy
  // uložené v dokumentu (načte se znovu, když ji paměť nemá – po obnovení stránky, v nové relaci CLI)
  const want = [...(cmd.kind === "load" && !cmd.data ? [cmd.name] : []), ...(r.doc.reference?.name ? [r.doc.reference.name] : [])];
  const files = new Map<string, { name: string; bytes: Uint8Array } | null>();
  for (const n of want) if (!files.has(n)) files.set(n, await inputFile(host.inputs, n));
  if (!host.pdfjs && cmd.kind === "load") {
    const f = cmd.data ? null : files.get(cmd.name);
    if (isPdfName(f?.name ?? cmd.name) || (f && isPdfBytes(f.bytes)) || (cmd.data && /^data:application\/pdf/i.test(cmd.data))) {
      coded(ctx, "host.app-only", { args: [tr("předloha PDF (pdf.js) – DWG / DXF předlohu lze připojit i bez prohlížeče")] });
      return;
    }
  }
  const { runReferenceCmd } = await import("../../reference/run");
  const res = await runReferenceCmd(cmd, r.doc, {
    drawing: (doc, meta, opts) => host.kernel.drawing(doc, meta as DrawingMeta, opts as Partial<DrawingOptions>) as never,
    file: (name) => files.get(name) ?? null,
    attached: () => host.inputs.list().join(", "),
    download: async (name, bytes, mime) => void (await host.files.write({ name, mime, data: bytes, doc: r.doc.name, format: name.split(".").pop()?.toLowerCase() ?? "bin" })),
    // DWG / DXF: čtení podle prostředí (draftImport) – v prohlížeči pracovní vlákno importu (velký výkres zákazníka nezablokuje
    // okno, jako dřívější reference-host vlny 15), v Node (CLI) bez Worker ve vlákně běhu
    load: { ...(host.pdfjs ? { pdfjs: async () => { const p = await host.pdfjs!(); return { lib: p.lib as never, docOptions: p.docOptions }; } } : {}) },
  });
  let st: RunDocStart | null = null;
  if (res.newDoc) {
    // `předloha otevřít`: předloha jako 2D výkres v nové záložce
    await flush(ctx);
    r.currentBody = null;
    st = await startRunDoc(ctx, res.newDoc, { origin: "open" }); // předloha jako 2D výkres – opakovaný běh (engine/runs.ts)
  } else if (res.doc) {
    r.doc = res.doc;
    r.changed = true;
  }
  say(ctx, ...res.log);
  st?.report();
};
