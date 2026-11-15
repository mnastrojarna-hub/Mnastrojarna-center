/**
 * Prvek z textového příkazu (kvádr, vysunout, díra, prvek …): odkazy, tělesa a režim (`prepare`), díra / text bez
 * souřadnice z na povrch tělesa podle sítě (`fillTop`), poznámka parseru, upozornění na vybrané hrany v aplikaci.
 */
import { topAt } from "../../agent";
import { fillHoleTops } from "../../agent-hole";
import { tr } from "../../i18n";
import { buildDoc, prepare, runOf } from "../run-doc";
import { coded, say, type OpHandler } from "./util";

export const featureOp: OpHandler<"feature"> = async (op, ctx) => {
  const r = runOf(ctx);
  const f = prepare(ctx, op.feature);
  if (op.fillTop) {
    const res = await buildDoc(ctx);
    if (!res.metrics) throw new Error(tr("není těleso, na jehož povrch by se prvek umístil – zadejte i souřadnici z"));
    if (f.type === "hole") {
      // povrch tělesa přímo v místě díry (podle sítě) – deska i vedle vyššího náboje; mimo těleso = obálka + upozornění;
      // více poloh (`v x y v x y z …`): jen polohy zadané dvěma čísly (fillHoleTops, agent-hole.ts – vlna 15)
      // 5.2 č. 18: díra mimo povrch nikdy tiše – ⚠ hole.no-surface (začíná na obálce tělesa)
      const metrics = res.metrics;
      fillHoleTops(f, op.fillPoints, (u, v) => topAt(res.mesh, f.axis, u, v), metrics.bbox, op.line, (u, v, at) => coded(ctx, "hole.no-surface", { text: tr("v místě [{0}; {1}] není povrch tělesa – díra začíná na obálce tělesa ({2})", u, v, at) }));
    } else if (f.type === "text" && f.plane.kind === "base") {
      const h = f.plane.name === "XY" ? topAt(res.mesh, "Z", f.position[0], f.position[1]) : null;
      f.plane.offset = h ?? res.metrics.bbox[1][f.plane.name === "XY" ? 2 : f.plane.name === "XZ" ? 1 : 0];
    }
  }
  r.doc.features.push(f);
  r.added.push(f);
  r.changed = true;
  say(ctx, tr("→ {0} ({1}) přidán – výsledek po výpočtu níže", f.name, f.type));
  if (op.note) say(ctx, `  ${op.note}`); // např. vrták závitové díry zadaný ručně (agent-hole.ts)
  const selNote = ctx.host.ui?.selectionNote?.(f) ?? null; // zaoblit 3 při vybraných hranách: všechny hrany, ne výběr
  if (selNote) say(ctx, selNote);
};
