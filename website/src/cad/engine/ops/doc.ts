/** `{ … }` (JSON dokument .mncad, `window.mncad.setDocument`): nová záložka, s `inPlace` nahradí dokument aktivní záložky. */
import { internBlobs } from "../../blobs";
import { stampAgentNotes } from "../../drawing-notes-rules";
import { tr } from "../../i18n";
import { flush, prepare, runOf, startDoc } from "../run-doc";
import { acceptLine, loadsModel } from "../accept";
import { startRunDoc, type RunDocStart } from "../runs";
import { freshenRunDoc } from "../spring-fresh";
import { coded, say, type OpHandler } from "./util";

export const docOp: OpHandler<"doc"> = async (op, ctx) => {
  await flush(ctx);
  // data importů z mapy `blobs` (.mncad této verze) do úložiště ještě před ověřovací stavbou; poznámky listů z JSON skriptu
  // agenta = text agenta, i když JSON tvrdí "by":"user" (vlna 23, R6 – rozhoduje cesta; pravidla nejdou obejít vloženým dokumentem)
  const din = stampAgentNotes(internBlobs(op.doc), "agent");
  const incoming = din.features;
  // inPlace = nahradit dokument aktivní záložky jedním krokem historie; jinak nová záložka, při opakovaném běhu záložka téhož
  // dokumentu (JSON / setDocument / otevřít) z dřívějšího běhu (engine/runs.ts)
  let st: RunDocStart | null = null;
  if (ctx.opts.inPlace) startDoc(ctx, { ...din, features: [] }, { openNew: false });
  else st = await startRunDoc(ctx, { ...din, features: [] }, { origin: "open" });
  const r = runOf(ctx);
  for (const raw of incoming) r.doc.features.push(prepare(ctx, raw, true)); // $last, režim, duplicitní id – prvek po prvku
  const d = r.doc;
  const text = ctx.opts.inPlace ? tr("✓ dokument „{0}“ ({1} prvků) nahradil otevřený dokument – jeden krok historie (zpět ho vrátí)", d.name, d.features.length) : st?.reused ? tr("✓ dokument „{0}“ ({1} prvků) – nahradí záložku téhož názvu z dřívějšího běhu", d.name, d.features.length) : tr("✓ dokument „{0}“ ({1} prvků) – otevře se v nové záložce", d.name, d.features.length);
  // dokument s prvky se teprve postaví: načtení je přijetí (ℹ), výsledek ✓ / ⚠ / ✗ dá ověřovací stavba na tomto řádku (22i)
  say(ctx, loadsModel(d) ? acceptLine(text) : text);
  st?.report();
  // pravidla textu výkresu (vlna 23, R1–R5): načtený dokument agenta s porušením = ✗ na řádku načtení (dokument zůstane
  // otevřený k opravě, export listu s porušením se odmítne, vyhodnocení listu nálezy vypíše)
  for (const f of (await import("../../drawing-agent")).ingestFindings(d)) coded(ctx, f.code, { args: f.args, ...(f.text ? { text: f.text } : {}) });
  // pružiny: délka z dosedacích ploch, rozpor s uloženou délkou ⚠ spring.stale (vlna 22, bod 7)
  await freshenRunDoc(ctx, op.line);
};
