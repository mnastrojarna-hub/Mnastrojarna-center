/**
 * Kontrola kót výkresu: z historie prvků odvodí, jaké rozměry by měl výrobní výkres nést (průměry a hloubky děr,
 * závity, rozměry skic, tloušťky, zaoblení, celkové rozměry…), a porovná je s kótami, které na listu jsou
 * (automatické i uživatelské). Automatické kótování je jen pomocný základ – tato kontrola ukáže, co chybí.
 * Čisté funkce (testovatelné v Node).
 */
import { threadByName } from "./defaults";
import type { CadDoc, Feature, Vec3 } from "./types";

export type DimKind = "lin" | "dia" | "rad" | "thread";
export type DimExpect = { kind: DimKind; value: number; label: string; source: string };
export type DimCheckItem = DimExpect & { present: boolean };

const fmt = (n: number) => (Math.round(n * 100) / 100).toString().replace(".", ",");
const push = (out: DimExpect[], kind: DimKind, value: number, label: string, source: string) => {
  if (!(value > 0) || !Number.isFinite(value)) return;
  if (out.some((o) => o.kind === kind && Math.abs(o.value - value) < 0.005)) return; // stejná hodnota stačí jednou
  out.push({ kind, value, label, source });
};
/** kolikrát se prvek opakuje (pole, která na něj odkazují) */
function countOf(doc: CadDoc, id: string): number {
  let n = 1;
  for (const f of doc.features) {
    if (f.type !== "pattern" || f.suppressed) continue;
    const ids = f.featureIds?.length ? f.featureIds : [f.featureId];
    if (!ids.includes(id)) continue;
    if (f.kind === "linear") n *= f.count * (f.count2 ?? 1);
    else if (f.kind === "circular" || f.kind === "curve") n *= f.count;
  }
  return n;
}

/** Očekávané kóty z historie prvků. */
export function expectedDims(doc: CadDoc, bbox: [Vec3, Vec3] | null): DimExpect[] {
  const out: DimExpect[] = [];
  if (bbox) {
    const L = bbox[1][0] - bbox[0][0];
    const W = bbox[1][1] - bbox[0][1];
    const H = bbox[1][2] - bbox[0][2];
    push(out, "lin", L, `${fmt(L)} (délka X)`, "celkové rozměry");
    push(out, "lin", W, `${fmt(W)} (šířka Y)`, "celkové rozměry");
    push(out, "lin", H, `${fmt(H)} (výška Z)`, "celkové rozměry");
  }
  const sketchUsed = new Set(doc.features.flatMap((f) => ("sketchId" in f && typeof f.sketchId === "string" ? [f.sketchId] : "profileId" in f ? [f.profileId] : [])));
  for (const f of doc.features as Feature[]) {
    if (f.suppressed) continue;
    const src = f.name;
    switch (f.type) {
      case "hole": {
        const n = countOf(doc, f.id);
        const cnt = n > 1 ? `${n}× ` : "";
        if (f.kind === "tapped" && f.thread) {
          const t = threadByName(f.thread);
          push(out, "thread", t?.d ?? parseFloat(f.thread.replace(/^m/i, "")), `${cnt}${f.thread.toUpperCase()}${f.depth > 0 ? ` hl. ${fmt(f.depth)}` : ""}`, src);
        } else push(out, "dia", f.diameter, `${cnt}Ø${fmt(f.diameter)}${f.depth > 0 ? ` hl. ${fmt(f.depth)}` : " skrz"}`, src);
        if (f.depth > 0) push(out, "lin", f.depth, `${fmt(f.depth)} (hloubka díry)`, src);
        if (f.cbDiameter > 0) {
          push(out, "dia", f.cbDiameter, `Ø${fmt(f.cbDiameter)} (zahloubení)`, src);
          push(out, "lin", f.cbDepth, `${fmt(f.cbDepth)} (hloubka zahloubení)`, src);
        }
        if (f.csDiameter) push(out, "dia", f.csDiameter, `Ø${fmt(f.csDiameter)} (kuželové zahloubení)`, src);
        break;
      }
      case "cylinder":
        push(out, "dia", 2 * f.radius, `Ø${fmt(2 * f.radius)}`, src);
        push(out, "lin", f.height, `${fmt(f.height)} (výška)`, src);
        break;
      case "tube":
        push(out, "dia", f.outer, `Ø${fmt(f.outer)}`, src);
        if (f.inner > 0) push(out, "dia", f.inner, `Ø${fmt(f.inner)}`, src);
        push(out, "lin", f.height, `${fmt(f.height)} (výška)`, src);
        break;
      case "sphere":
        push(out, "dia", 2 * f.radius, `Ø${fmt(2 * f.radius)} (koule)`, src);
        break;
      case "cone":
        push(out, "dia", 2 * f.radius1, `Ø${fmt(2 * f.radius1)}`, src);
        if (f.radius2 > 0) push(out, "dia", 2 * f.radius2, `Ø${fmt(2 * f.radius2)}`, src);
        push(out, "lin", f.height, `${fmt(f.height)} (výška)`, src);
        break;
      case "box":
        for (const v of f.size) push(out, "lin", v, `${fmt(v)}`, src);
        break;
      case "extrude":
        if (!f.extent || f.extent.kind === "blind") push(out, "lin", f.extent?.kind === "blind" ? f.extent.d : f.distance, `${fmt(f.extent?.kind === "blind" ? f.extent.d : f.distance)} (výška vysunutí)`, src);
        break;
      case "sketch":
        if (!sketchUsed.has(f.id)) break;
        for (const e of f.entities) {
          if (e.construction) continue;
          if (e.type === "circle") push(out, "dia", 2 * e.r, `Ø${fmt(2 * e.r)}`, src);
          else if (e.type === "rect") {
            push(out, "lin", e.w, `${fmt(e.w)}`, src);
            push(out, "lin", e.h, `${fmt(e.h)}`, src);
            if (e.r > 0) push(out, "rad", e.r, `R${fmt(e.r)} (rohy)`, src);
          } else if (e.type === "slot") {
            push(out, "lin", e.length, `${fmt(e.length)} (délka drážky)`, src);
            push(out, "lin", e.width, `${fmt(e.width)} (šířka drážky)`, src);
          } else if (e.type === "polygon") push(out, "dia", 2 * e.r, `Ø${fmt(2 * e.r)} (opsaná kružnice ${e.sides}-úhelníku)`, src);
          else if (e.type === "ellipse") {
            push(out, "lin", 2 * e.rx, `${fmt(2 * e.rx)} (elipsa)`, src);
            push(out, "lin", 2 * e.ry, `${fmt(2 * e.ry)} (elipsa)`, src);
          }
        }
        break;
      case "fillet":
        push(out, "rad", f.radius, `R${fmt(f.radius)}`, src);
        break;
      case "chamfer":
        push(out, "lin", f.distance, `${fmt(f.distance)}×45° (sražení)`, src);
        break;
      case "shell":
        push(out, "lin", f.thickness, `${fmt(f.thickness)} (tloušťka stěny)`, src);
        break;
      case "pattern":
        if (f.kind === "linear") {
          push(out, "lin", f.spacing, `${fmt(f.spacing)} (rozteč)`, src);
          if (f.spacing2) push(out, "lin", f.spacing2, `${fmt(f.spacing2)} (rozteč)`, src);
        }
        break;
      case "spring":
        push(out, "dia", 2 * f.radius, `Ø${fmt(2 * f.radius)} (pružina)`, src);
        push(out, "lin", f.pitch, `${fmt(f.pitch)} (stoupání)`, src);
        break;
      default:
        break;
    }
  }
  return out;
}

const num = (s: string) => parseFloat(s.replace(",", "."));
/** Kóty přítomné na listu – z textů vrstvy „dim“ (automatické i uživatelské): „Ø18“, „4× Ø18“, „165“, „R3“, „M6 hl. 12“, „Ø50 H8“. */
export function presentDims(texts: { s: string; layer?: string }[]): { kind: DimKind; value: number; text: string }[] {
  const out: { kind: DimKind; value: number; text: string }[] = [];
  for (const t of texts) {
    if (t.layer && t.layer !== "dim") continue;
    const raw = t.s.replace(/^\s*\d+\s*[×x]\s*/i, "").trim();
    let m: RegExpExecArray | null;
    if ((m = /^M\s*(\d+(?:[.,]\d+)?)/i.exec(raw))) out.push({ kind: "thread", value: num(m[1]), text: t.s });
    else if ((m = /^[Øø⌀]\s*(\d+(?:[.,]\d+)?)/.exec(raw))) out.push({ kind: "dia", value: num(m[1]), text: t.s });
    else if ((m = /^R\s*(\d+(?:[.,]\d+)?)/.exec(raw))) out.push({ kind: "rad", value: num(m[1]), text: t.s });
    else if ((m = /^(\d+(?:[.,]\d+)?)/.exec(raw))) out.push({ kind: "lin", value: num(m[1]), text: t.s });
    // další čísla v textu (např. „hl. 12“) jako lineární
    for (const h of raw.matchAll(/hl\.\s*(\d+(?:[.,]\d+)?)/g)) out.push({ kind: "lin", value: num(h[1]), text: t.s });
  }
  return out;
}

/** Porovnání: která očekávaná kóta na listu je (stejný druh a hodnota ±0,01) a která chybí. */
export function dimCheck(doc: CadDoc, bbox: [Vec3, Vec3] | null, texts: { s: string; layer?: string }[]): DimCheckItem[] {
  const have = presentDims(texts);
  const tol = (v: number) => Math.max(0.01, Math.abs(v) * 1e-4);
  return expectedDims(doc, bbox).map((e) => ({ ...e, present: have.some((h) => h.kind === e.kind && Math.abs(h.value - e.value) <= tol(e.value)) }));
}
