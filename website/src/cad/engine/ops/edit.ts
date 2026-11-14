/**
 * Úpravy existujícího modelu a skici, proměnné, konfigurace (agent-edit.ts); `zpět` / `znovu` = skutečná historie
 * dokumentu aktivní záložky (`ws.undo` / `ws.redo`, jeden běh příkazů = jeden krok).
 */
import { selectEdges, selectFaces } from "../../agent";
import { applyEdit, historyText } from "../../agent-edit";
import type { CadDoc } from "../../types";
import { stampFeature } from "../stamp";
import { flush, openSketchFor, runOf } from "../run-doc";
import { say, type OpHandler } from "./util";

export const editOp: OpHandler<"edit"> = async (op, ctx) => {
  const r = runOf(ctx);
  const k = ctx.host.kernel;
  if (op.cmd.kind === "undo" || op.cmd.kind === "redo") {
    const { kind: dir, n } = op.cmd;
    await flush(ctx); // dosavadní změny tohoto běhu = jeden krok historie
    r.openNew = false;
    r.tabbed = false;
    const { moved } = dir === "undo" ? ctx.ws.undo(n) : ctx.ws.redo(n);
    r.doc = JSON.parse(JSON.stringify(ctx.ws.present())) as CadDoc;
    r.added.length = 0;
    const h = ctx.ws.history();
    say(ctx, historyText(dir, n, moved, { past: { length: h.undo } as unknown[], future: { length: h.redo } as unknown[] }));
    return;
  }
  const res = await applyEdit(r.doc, op.cmd, { kernel: { topology: k.topology, selectFaces, selectEdges, stamp: (before, f) => stampFeature(k, before, f), build: k.build }, openSketchId: openSketchFor(ctx) }, op.sketch);
  r.doc = res.doc;
  r.changed = r.changed || res.changed;
  for (const id of res.removed)
    if (r.added.some((f) => f.id === id))
      r.added.splice(
        r.added.findIndex((f) => f.id === id),
        1,
      );
  for (const f of r.doc.features) if (res.touched.includes(f.id) && !r.added.some((x) => x.id === f.id)) r.added.push(f);
  say(ctx, ...res.log);
};
