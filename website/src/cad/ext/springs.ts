/**
 * Pružiny z tabulky – prvky historie `spring.compression`, `spring.extension`, `spring.torsion`, `spring.disc` (výpočet
 * a střednice v `cad/springs`, těleso v `springs-kernel.ts`). Na pásu karet se nenabízejí samostatně (`hidden`): jediný vstup je
 * tlačítko Pružina (průvodce s tabulkou, components/cad/springs). Obecný příkaz `prvek spring.compression d=2 De=20 …`,
 * `prvek nápověda spring.compression` a starší dokumenty fungují jako u ostatních rozšíření.
 */
import { tr } from "../i18n";
import { noteFeatureInfo, noteFeatureWarning } from "../feature-notes";
import { compressionSpecOf, discOf, extensionPieces, KINDS, readExtension, readTorsion, springCalc, springResults, torsionPieces, type SpringKind, type SpringRow } from "../springs";
import type { BoolMode, CadDoc, Vec3 } from "../types";
import { extDirection, extPoint } from "./place";
import { registerExt, setExtTool, type ExtBuildCtx, type ExtParam, type Shape } from "./registry";
import { compressionSolid, discStackSolid, piecesSolid, placeSpring } from "./springs-kernel";

type Data = Record<string, unknown>;
const MODES = ["new", "add", "cut", "intersect"];
const modeOf = (d: Data): BoolMode => (MODES.includes(String(d.mode)) ? (d.mode as BoolMode) : "new");

function applyMode(body: Shape | null, tool: Shape, mode: BoolMode): Shape {
  if (!body) {
    if (mode === "cut" || mode === "intersect") throw new Error(tr("Není z čeho odebírat – nejdřív vytvořte těleso."));
    return tool;
  }
  if (mode === "cut") return body.cut(tool) as Shape;
  if (mode === "intersect") return body.intersect(tool) as Shape;
  return body.fuse(tool) as Shape;
}

/** řádek tabulky → parametr automatického formuláře / obecného příkazu */
export function rowParam(r: SpringRow): ExtParam {
  if (r.kind === "enum") return { key: r.key, label: r.label, kind: "enum", options: r.options ?? [], hint: r.hint };
  if (r.kind === "bool") return { key: r.key, label: r.label, kind: "bool", hint: r.hint };
  return { key: r.key, label: r.label, kind: "number", ...(r.unit ? { unit: r.unit } : {}), ...(r.min !== undefined ? { min: r.min } : {}), ...(r.max !== undefined ? { max: r.max } : {}), ...(r.step !== undefined ? { step: r.step } : {}), hint: r.hint };
}
/** parametry umístění společné všem pružinám */
export const placeParams = (): ExtParam[] => [
  { key: "atRef", label: tr("Poloha (začátek osy) odkazem"), kind: "point", hint: tr("vrchol, střed hrany nebo kružnice, bod skici… – má přednost před souřadnicemi") },
  { key: "at", label: tr("Poloha (začátek osy)"), kind: "vec3" },
  { key: "axis", label: tr("Osa pružiny"), kind: "direction", hint: tr("X / Y / Z, vektor, nebo odkazem: osa díry (válcové plochy), hrana, normála plochy") },
  { key: "len", label: tr("Délka tvaru (stlačená)"), kind: "number", unit: "mm", min: 0, step: 0.5, hint: tr("prázdné = volná délka; tvar stlačené pružiny (stoupání se zmenší, závěrné závity zůstanou)") },
  { key: "mode", label: tr("Operace"), kind: "mode", newLabel: tr("Nové těleso / přidat") },
];

/** Těleso pružiny v souřadnicích prvku (osa +Z) podle druhu. */
export function springLocalSolid(kind: SpringKind, data: Data): Shape {
  if (kind === "compression") {
    const s = compressionSpecOf(data);
    if (!s) throw new Error(tr("Pružině chybí rozměry (d, D, L0, n)."));
    return compressionSolid(s);
  }
  if (kind === "extension") {
    const i = readExtension(data);
    return piecesSolid(extensionPieces({ d: i.d, D: i.D, turns: i.n, loop: i.loop, loop2: i.loop2, hand: i.hand }));
  }
  if (kind === "torsion") {
    const i = readTorsion(data);
    return piecesSolid(torsionPieces({ d: i.d, D: i.D, turns: i.n, leg1: i.leg1, leg2: i.leg2, l1: i.l1, l2: i.l2, hand: i.hand, gap: 0.01 }));
  }
  const o = discOf(data);
  if (!o) throw new Error(tr("Talířové pružině chybí rozměry (De, Di, t, h0)."));
  return discStackSolid(o);
}

function buildSpring(kind: SpringKind, data: Data, ctx: ExtBuildCtx): Shape {
  const c = springCalc(kind, data);
  const err = c.issues.find((i) => i.level === "error");
  if (err) throw new Error(tr("{0}: {1}", KINDS[kind].label(), err.text));
  for (const w of c.issues.filter((i) => i.level === "warn")) noteFeatureWarning(w.text);
  noteFeatureInfo(springResults(c), { spring: { kind, ...Object.fromEntries(Object.entries(c.v).filter(([, x]) => Number.isFinite(x))) } });
  const local = springLocalSolid(kind, data);
  const axis = extDirection(data, ctx, "axis", { fallback: [0, 0, 1] });
  const at: Vec3 = extPoint(data, ctx, "at");
  const tool = placeSpring(local, axis, at);
  const mode = modeOf(data);
  setExtTool(ctx, tool, mode === "new" ? "add" : mode);
  return applyMode(ctx.body, tool, mode);
}

const ICON: Record<SpringKind, string> = { compression: "spring", extension: "spring-ext", torsion: "spring-torsion", disc: "spring-disc" };
for (const k of Object.values(KINDS)) {
  registerExt({
    ext: k.ext,
    label: k.label(),
    icon: ICON[k.kind],
    tone: "create",
    tab: "create",
    group: "Konstrukční prvky",
    hidden: true,
    hint: tr("{0} – tabulka s výpočtem ({1})", k.label(), k.standard),
    toolBody: true,
    make: (doc: CadDoc) => ({ ...k.defaults(), at: [0, 0, 0], axis: "Z", mode: doc.features.some((f) => f.type !== "sketch" && f.type !== "datum") ? "add" : "new" }),
    params: [...k.rows().map(rowParam), ...placeParams()],
    build: (data, ctx) => buildSpring(k.kind, data, ctx),
  });
}

// akce textu `pružina tabulka` (provedení: components/cad/springs/register.tsx → protokol)
registerExt({ ext: "spring.table", label: tr("Tabulka pružin"), icon: "spring", tone: "tool", tab: "create", group: "Konstrukční prvky", hidden: true, action: true, hint: tr("spočtené údaje pružin z tabulky v dílu"), make: () => ({}) });
