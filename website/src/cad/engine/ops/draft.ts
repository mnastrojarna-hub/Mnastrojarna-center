/** `2d …`: 2D výkres (cad/draft/agent.ts) – `2d nový` = nová záložka, ostatní příkazy nad otevřeným 2D výkresem. */
import { b64ToBytes } from "../../blobs";
import { flush, runOf } from "../run-doc";
import { startRunDoc, type RunDocStart } from "../runs";
import { say, type OpHandler } from "./util";

/** soubor příkazu 2D výkresu (`2d export dwg|dxf`, `2d tisk`, `2d wblock`, `2d atrext` …) z `results[].data.file` */
type DraftFile = { name: string; mime: string; text?: string; base64?: string };

export const draftOp: OpHandler<"draft"> = async (op, ctx) => {
  const r = runOf(ctx);
  const res = await (await import("../../draft/agent")).applyDraftText(r.doc, op.text);
  let st: RunDocStart | null = null;
  if (res.newDoc) {
    await flush(ctx);
    r.currentBody = null;
    st = await startRunDoc(ctx, res.newDoc, { origin: "new" }); // `2d nový "A"` podruhé = záložka „A“ z dřívějšího běhu (engine/runs.ts)
  } else if (res.changed) {
    r.doc = res.doc;
    r.changed = true;
  }
  say(ctx, ...res.log);
  st?.report();
  // Textová cesta nemá GUI (`ui.download` chybí v CLI i v enginu prohlížeče): soubor, který příkaz vyrobil, doručí hostitel
  // (CLI = výstupní složka + řádek F protokolu, prohlížeč = stejný FileSink jako `výkres export …`). Dřív hlásil ✓ bez souboru.
  for (const x of res.results) {
    const f = x.ok ? (x.data?.file as DraftFile | undefined) : undefined;
    if (!f || (f.text === undefined && !f.base64)) continue;
    const data = f.text !== undefined ? new TextEncoder().encode(f.text) : b64ToBytes(f.base64!);
    await ctx.host.files.write({ name: f.name, mime: f.mime, data, doc: r.doc.name, format: f.name.split(".").pop()?.toLowerCase() ?? "bin" });
  }
};
