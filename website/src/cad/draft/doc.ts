/**
 * 2D výkres jako dokument CADu: nový model (hladina 0, typy čar, styl Standard), dokument druhu „draft“
 * pro záložky, ukládání .mncad, automatické ukládání, sdílený odkaz a historii.
 */
import { tr } from "../i18n";
import type { CadDoc } from "../types";
import { DEFAULT_LINETYPES, linetypeLibrary } from "./linetypes";
import { baseDraftModel, draftEntityCount, type DraftModel, type DraftUnits } from "./model";
import { UNITS } from "./units";

/** Nový prázdný 2D model (mm, hladina 0, 9 typů čar acadiso, styl Standard). */
export function newDraftModel(opts: { units?: DraftUnits } = {}): DraftModel {
  const m = baseDraftModel();
  const units = opts.units ?? "mm";
  const metric = units !== "in" && units !== "ft" && units !== "yd" && units !== "mi";
  const lib = linetypeLibrary(metric);
  m.linetypes = DEFAULT_LINETYPES.map((n) => lib.find((l) => l.name === n)!).filter(Boolean);
  m.vars = { ...m.vars, units, measurement: metric ? 1 : 0, ...(metric ? {} : { textsize: 0.2, grid: 0.5, snap: 0.5, lwdefault: 0.25 }) };
  if (units !== "mm" && metric) {
    // velikosti v jednotkách výkresu (text 2,5 mm, mřížka 10 mm)
    const k = 1 / UNITS[units].mm;
    m.vars.textsize = 2.5 * k;
    m.vars.grid = 10 * k;
    m.vars.snap = 10 * k;
    m.linetypes = m.linetypes.map((l) => ({ ...l, pattern: l.pattern.map((x) => x * k) }));
  }
  return m;
}

/** Nový dokument 2D výkresu. */
export function emptyDraftDoc(name = tr("Nový 2D výkres"), opts: { units?: DraftUnits } = {}): CadDoc {
  return { app: "mnastrojarna-cad", version: 2, name, material: "ocel", features: [], kind: "draft", draft: newDraftModel(opts) };
}

export const isDraftDoc = (d: CadDoc | null | undefined): d is CadDoc & { kind: "draft"; draft: DraftModel } => !!d && d.kind === "draft" && !!d.draft;

/** Dokument má obsah (prvky dílu, komponenty sestavy nebo entity 2D výkresu) – sdílení, nedávné soubory, varování. */
export const docHasContent = (d: CadDoc) => d.features.length > 0 || (d.components?.length ?? 0) > 0 || draftEntityCount(d.draft) > 0;

/** Druh záložky dokumentu. */
export const docTabKind = (d: CadDoc): "part" | "assembly" | "draft" => (d.kind === "assembly" ? "assembly" : d.kind === "draft" ? "draft" : "part");

/** Doplní chybějící části modelu staršího / ručně psaného dokumentu (JSON od agenta). */
export function normalizeDraftDoc(d: CadDoc): CadDoc {
  if (d.kind !== "draft") return d;
  const base = newDraftModel();
  const m = (d.draft ?? {}) as Partial<DraftModel>;
  const draft: DraftModel = {
    ...base,
    ...m,
    vars: { ...base.vars, ...(m.vars ?? {}) },
    layers: m.layers?.length ? m.layers : base.layers,
    linetypes: m.linetypes?.length ? m.linetypes : base.linetypes,
    textStyles: m.textStyles?.length ? m.textStyles : base.textStyles,
    entities: Array.isArray(m.entities) ? m.entities : [],
  } as DraftModel;
  if (!draft.layers.some((l) => l.name === "0")) draft.layers = [base.layers[0], ...draft.layers];
  // id entit: chybějící doplnit, čítač za nejvyšší číslo
  let seq = draft.seq || 0;
  for (const e of draft.entities) {
    const n = /^e(\d+)$/.exec(e.id ?? "")?.[1];
    if (n) seq = Math.max(seq, Number(n));
  }
  const used = new Set<string>();
  draft.entities = draft.entities.map((e) => {
    let id = e.id;
    if (!id || used.has(id)) id = `e${++seq}`;
    used.add(id);
    return id === e.id && e.layer ? e : { ...e, id, layer: e.layer ?? "0" };
  });
  draft.seq = seq;
  return { ...d, features: d.features ?? [], draft };
}
