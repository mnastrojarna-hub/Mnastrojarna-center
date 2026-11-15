/** Prvek s výběrem hran / ploch pravidlem (zaoblit … hrany svislé, skořepina … otevřít +Z, obecný prvek s pravidlem). */
import { selectEdges, selectFaces } from "../../agent";
import { tr } from "../../i18n";
import { stampFeature } from "../stamp";
import { prepare, runOf, topology } from "../run-doc";
import { coded, say, type OpHandler } from "./util";

export const selectOp: OpHandler<"select"> = async (op, ctx) => {
  const r = runOf(ctx);
  const f = prepare(ctx, op.feature);
  const t = await topology(ctx, f.body);
  // strana bez rovinné plochy na obálce → nejkrajnější rovnoběžná plocha: nikdy tiše (⚠ select.fallback, 5.2 č. 12)
  const fallback = (w: string) => coded(ctx, "select.fallback", { args: [w] });
  if (op.into) {
    // obecný prvek: indexy ploch / hran podle pravidla na zadanou cestu v prvku
    const idx = op.into.kind === "faces" ? selectFaces(op.rule, t.faces, t.bbox, fallback) : selectEdges(op.rule, t.edges, t.bbox);
    if (!idx.length) throw new Error(op.into.kind === "faces" ? tr("žádná plocha neodpovídá pravidlu „{0}“ (ploch celkem {1})", op.rule.join(" "), t.faces.length) : tr("žádná hrana neodpovídá pravidlu „{0}“ (hran celkem {1})", op.rule.join(" "), t.edges.length));
    const keys = op.into.path.split(".");
    let o = f as unknown as Record<string, unknown>;
    for (const k of keys.slice(0, -1)) o = (o[k] = { ...(o[k] as Record<string, unknown>) }) as Record<string, unknown>;
    o[keys[keys.length - 1]] = idx;
    say(ctx, tr("→ {0} ({1}) – {2} {3} podle pravidla „{4}“ – výsledek po výpočtu níže", f.name, f.type === "ext" ? f.ext : f.type, idx.length, op.into.kind === "faces" ? tr("ploch") : tr("hran"), op.rule.join(" ")));
  } else if (f.type === "fillet" || f.type === "chamfer") {
    const idx = selectEdges(op.rule, t.edges, t.bbox);
    if (!idx.length) throw new Error(tr("žádná hrana neodpovídá pravidlu „{0}“ (hran celkem {1})", op.rule.join(" "), t.edges.length));
    f.edges = idx;
    say(ctx, tr("→ {0} ({1}) – {2} hran podle pravidla „{3}“ – výsledek po výpočtu níže", f.name, f.type, idx.length, op.rule.join(" ")));
  } else if (f.type === "shell") {
    const idx = selectFaces(op.rule, t.faces, t.bbox, fallback);
    if (!idx.length) throw new Error(tr("žádná plocha neodpovídá pravidlu „{0}“ (ploch celkem {1})", op.rule.join(" "), t.faces.length));
    f.faces = idx;
    say(ctx, tr("→ {0} (shell) – otevřeno ploch: {1} – výsledek po výpočtu níže", f.name, idx.length));
  } else throw new Error(tr("pravidlo výběru podporují zaoblení, sražení a skořepina"));
  const d = r.doc;
  const stamped = await stampFeature(ctx.host.kernel, f.body ? { ...d, activeBody: f.body } : d, f); // otisky vybraných entit (přežijí přečíslování)
  r.doc.features.push(stamped);
  r.added.push(stamped);
  r.changed = true;
};
