/**
 * Stav 2D výkresu pro agenty a protokol: jednotky, rozsah, počty entit podle druhu, hladiny s počty, výběr.
 */
import { tr } from "../i18n";
import { colorLabel } from "./colors";
import { boxUnion, emptyBox, isEmptyBox, type Box } from "./geom";
import { entityBox, kindLabel, type KindCtx } from "./kinds";
import { layerUse, lwLabel } from "./layers";
import { spaceEntities, type DraftEntity, type DraftModel, type Vec2 } from "./model";
import type { DraftSession } from "./session";
import { fmtLen, fmtPt, unitsLabel } from "./units";

/** rozsah viditelných i skrytých konečných entit (přímky a polopřímky se nepočítají) */
export function extents(model: DraftModel, list: readonly DraftEntity[]): Box | null {
  const ctx: KindCtx = { model };
  let b = emptyBox();
  for (const e of list) {
    const eb = entityBox(e, ctx);
    if (eb) b = boxUnion(b, eb);
  }
  return isEmptyBox(b) ? null : b;
}

export type DraftStatus = {
  units: string;
  prec: number;
  ltscale: number;
  clayer: string;
  space: string;
  entities: number;
  counts: Record<string, number>;
  extents: { min: Vec2; max: Vec2; width: number; height: number } | null;
  layers: { name: string; color: number | string; linetype: string; lineweight: number | "Default"; on: boolean; frozen: boolean; locked: boolean; plot: boolean; current: boolean; count: number; desc?: string }[];
  linetypes: string[];
  selection: string[];
};

export function draftStatus(model: DraftModel, session?: DraftSession | null): DraftStatus {
  const space = session?.space ?? "model";
  const list = spaceEntities(model, space) ?? model.entities;
  const counts: Record<string, number> = {};
  for (const e of list) counts[e.type] = (counts[e.type] ?? 0) + 1;
  const ex = extents(model, list);
  return {
    units: model.vars.units,
    prec: model.vars.prec,
    ltscale: model.vars.ltscale,
    clayer: model.vars.clayer,
    space,
    entities: list.length,
    counts,
    extents: ex ? { min: [ex.x0, ex.y0], max: [ex.x1, ex.y1], width: ex.x1 - ex.x0, height: ex.y1 - ex.y0 } : null,
    layers: model.layers.map((l) => ({ name: l.name, color: l.color, linetype: l.linetype, lineweight: l.lineweight, on: l.on, frozen: l.frozen, locked: l.locked, plot: l.plot, current: l.name === model.vars.clayer, count: layerUse(model, l.name), ...(l.desc ? { desc: l.desc } : {}) })),
    linetypes: model.linetypes.map((l) => l.name),
    selection: session ? [...session.sel] : [],
  };
}

export function draftStatusText(model: DraftModel, session?: DraftSession | null, name?: string): string {
  const s = draftStatus(model, session);
  const v = model.vars;
  const out: string[] = [];
  out.push(tr("2D výkres{0} · jednotky {1} · přesnost {2} · LTSCALE {3} · prostor {4}", name ? ` „${name}“` : "", unitsLabel(model.vars.units), s.prec, s.ltscale, s.space));
  const cnt = Object.entries(s.counts)
    .sort((a, b) => b[1] - a[1])
    .map(([t, n]) => `${kindLabel(t)} ${n}`)
    .join(", ");
  out.push(tr("Entit: {0}{1}", s.entities, cnt ? ` (${cnt})` : ""));
  out.push(s.extents ? tr("Rozsah: {0} – {1} ({2} × {3})", fmtPt(s.extents.min, v), fmtPt(s.extents.max, v), fmtLen(s.extents.width, v), fmtLen(s.extents.height, v)) : tr("Rozsah: prázdný výkres"));
  out.push(tr("Hladiny ({0}), aktuální: {1}", s.layers.length, s.clayer));
  for (const l of s.layers) {
    const st = [l.on ? tr("zapnutá") : tr("vypnutá"), l.frozen ? tr("zmrazená") : "", l.locked ? tr("zamčená") : "", l.plot ? "" : tr("netiskne")].filter(Boolean).join(", ");
    out.push(`  ${l.current ? "✓" : "·"} ${l.name} — ${tr("barva")} ${colorLabel(l.color)}, ${l.linetype}, ${lwLabel(l.lineweight)}, ${st}, ${tr("entit")} ${l.count}${l.desc ? ` — ${l.desc}` : ""}`);
  }
  if (s.selection.length) out.push(tr("Výběr: {0} ({1})", s.selection.length, s.selection.slice(0, 30).join(", ") + (s.selection.length > 30 ? " …" : "")));
  return out.join("\n");
}
