/** `{ … }` (JSON dokument .mncad, `window.mncad.setDocument`): nová záložka, s `inPlace` nahradí dokument aktivní záložky. */
import { internBlobs } from "../../blobs";
import { tr } from "../../i18n";
import { flush, prepare, runOf, startDoc } from "../run-doc";
import { say, type OpHandler } from "./util";

export const docOp: OpHandler<"doc"> = async (op, ctx) => {
  await flush(ctx);
  const din = internBlobs(op.doc); // data importů z mapy `blobs` (.mncad této verze) do úložiště ještě před ověřovací stavbou
  const incoming = din.features;
  startDoc(ctx, { ...din, features: [] }, { openNew: !ctx.opts.inPlace }); // inPlace = nahradit dokument aktivní záložky jedním krokem historie
  const r = runOf(ctx);
  for (const raw of incoming) r.doc.features.push(prepare(ctx, raw, true)); // $last, režim, duplicitní id – prvek po prvku
  const d = r.doc;
  say(ctx, ctx.opts.inPlace ? tr("✓ dokument „{0}“ ({1} prvků) nahradil otevřený dokument – jeden krok historie (zpět ho vrátí)", d.name, d.features.length) : tr("✓ dokument „{0}“ ({1} prvků) – otevře se v nové záložce", d.name, d.features.length));
};
