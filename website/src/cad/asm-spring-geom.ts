/**
 * Pružina v sestavě – geometrie (čisté funkce bez jádra a bez importu z assembly.ts, aby ji mohlo použít rozložení sestavy).
 *
 * Komponenta s `spring` (types.ts SpringDef) je díl s prvkem Pružina (normálie DIN 2095, příkaz `pružina`) nebo s trubkou / válcem
 * (zjednodušená pružina). Osa pružiny v souřadnicích dílu: u prvku Pružina poloha − ½ drátu po ose (dosedací rovina konce drátu),
 * délka = stoupání · závity + drát; u trubky / válce podstava a výška. Délku v sestavě určují dosedací plochy (cad/asm-spring.ts).
 *
 * Reprezentace (dokumentováno v návodu pro AI):
 * - PŘESNĚ (jádro: export STEP / BREP, kolize, objem, výkres, zobrazení po přepočtu vazeb): díl se postaví znovu v aktuální délce –
 *   u prvku Pružina se změní stoupání (stoupání = (L − drát) / závity, počet závitů a drát zůstávají), u trubky / válce výška;
 *   začátek pružiny se posune po ose na dosedací plochu A (`offset`).
 * - SÍŤ (přehrávání pohybové studie v okně): síť volné pružiny se jen protáhne / stlačí po ose (měřítko L / L_modelu) – bez
 *   stavby v jádře v každém kroku.
 */
import { springDataAt, springPartGeom } from "./springs";
import type { AsmComponent, CadDoc, Feature, Vec3 } from "./types";

/**
 * Osa pružiny v dílu: začátek (dosedací bod na straně počátku), jednotkový směr, délka modelu, délka na doraz podle modelu;
 * `ring` = poloměr kružnice, kterou pružina dosedá na plochu (střední poloměr závitu, u trubky střed stěny) – dosedací plocha
 * musí mít pod ní materiál (ne díru, kterou pružina prochází).
 */
export type SpringGeom = {
  base: Vec3;
  axis: Vec3;
  length: number;
  solid?: number;
  /** volná délka L0, liší-li se od délky modelu (tlačná pružina z tabulky postavená v jiné délce `tvar`) */
  free?: number;
  /** tuhost z výpočtu tlačné pružiny z tabulky [N/mm] (cad/springs) – výchozí tuhost `sestava pružina` */
  rate?: number;
  ring: number;
  featureId: string;
  kind: "spring" | "tube" | "cylinder";
};

const AX: Record<string, Vec3> = { X: [1, 0, 0], Y: [0, 1, 0], Z: [0, 0, 1] };
const unit = (v: Vec3): Vec3 => {
  const l = Math.hypot(v[0], v[1], v[2]) || 1;
  return [v[0] / l, v[1] / l, v[2] / l];
};
/** zaokrouhlení délek pružiny: šum řešiče (1e-9 mm) nesmí vytvořit nový díl (nový klíč mezipaměti jádra) */
export const springRound = (v: number) => Math.round(v * 1e4) / 1e4 || 0;
/**
 * Délka TVARU pružiny na mřížce 1e-4 mm (klíč mezipaměti jádra) zaokrouhlená DOLŮ s rezervou 1e-7 mm na šum řešiče: konec pružiny
 * nikdy nepřesáhne dosedací plochu B. Zaokrouhlení k nejbližší hodnotě ho posunulo až o 5·10⁻⁵ mm do desky – broušený konec
 * (rovinná plocha) pak dal falešnou ⚠ kolizi (recenze integrace vlny 21: 0,105 mm³ v krocích po 1/3 mm).
 */
export const springShapeLen = (v: number) => Math.floor(v * 1e4 + 1e-3) / 1e4 || 0;
/**
 * Posun začátku pružiny po ose (na dosedací plochu A) a poloha komponenty: mřížka 1e-7 mm jako vzájemná poloha v kontrole kolizí
 * (asm-kernel relOf) – začátek leží na ploše A, ne o zaokrouhlení 1e-4 mm v desce.
 */
export const springPosRound = (v: number) => Math.round(v * 1e7) / 1e7 || 0;

/** směr prvku (osa X/Y/Z nebo směr vektorem / osou); jiný odkaz (hrana, plocha) → null */
function featureAxis(f: { axis?: string; dirDef?: unknown }): Vec3 | null {
  const d = f.dirDef as { kind: string; v?: Vec3; axis?: string } | undefined;
  if (d) {
    if (d.kind === "vector" && d.v) return unit(d.v);
    if (d.kind === "axis" && d.axis) return AX[d.axis] ?? null;
    return null;
  }
  return AX[f.axis ?? "Z"] ?? null;
}

/** Osa a délka pružiny v dílu (první prvek Pružina, jinak první trubka / válec); null = díl není pružina. */
export function springGeom(doc: CadDoc | undefined): SpringGeom | null {
  if (!doc || doc.kind === "assembly") return null;
  const live = doc.features.filter((f) => !f.suppressed);
  const sp = live.find((f) => f.type === "spring") as (Feature & { type: "spring" }) | undefined;
  if (sp) {
    const axis = featureAxis(sp);
    if (!axis || !(sp.pitch > 0 && sp.turns > 0 && sp.wire > 0)) return null;
    const h = sp.wire / 2;
    return { base: [sp.position[0] - axis[0] * h, sp.position[1] - axis[1] * h, sp.position[2] - axis[2] * h], axis, length: sp.pitch * sp.turns + sp.wire, solid: (sp.turns + 1) * sp.wire, ring: Math.max(sp.radius, sp.wire / 2), featureId: sp.id, kind: "spring" };
  }
  // tlačná pružina z tabulky (prvek spring.compression, cad/springs): osa z bodu `at`, délka modelu (tvar / L0), Ln a tuhost
  // R z výpočtu EN 13906-1 – `sestava pružina … mezi …` je převezme bez zadání (tažná / zkrutná / talířová sem nepatří)
  const tab = springPartGeom(doc);
  if (tab && tab.ext === "spring.compression")
    return { base: tab.base, axis: tab.axis, length: tab.length, ...(tab.solid !== undefined ? { solid: tab.solid } : {}), free: tab.free, ...(tab.rate !== undefined ? { rate: tab.rate } : {}), ring: tab.ring, featureId: tab.featureId, kind: "spring" };
  const t = live.find((f) => f.type === "tube" || f.type === "cylinder") as (Feature & { type: "tube" | "cylinder" }) | undefined;
  if (t) {
    const axis = featureAxis(t);
    if (!axis || !(t.height > 0)) return null;
    // trubka: střed stěny (průměry outer / inner), válec: polovina poloměru
    const ring = t.type === "tube" ? (t.outer + t.inner) / 4 : t.radius / 2;
    return { base: [...t.position] as Vec3, axis, length: t.height, ring, featureId: t.id, kind: t.type };
  }
  return null;
}

/**
 * Díl pružiny v délce `L` (přesný tvar pro jádro): prvek Pružina s novým stoupáním (nejméně o 0,05 % větším než drát – jinak by se
 * závity protínaly; pod délkou na doraz tedy zůstane tvar na dorazu), trubka / válec s novou výškou. Ostatní prvky beze změny.
 */
export function springDocAt(doc: CadDoc, L: number): CadDoc {
  const g = springGeom(doc);
  if (!g) return doc;
  return {
    ...doc,
    features: doc.features.map((f) => {
      if (f.id !== g.featureId) return f;
      if (f.type === "spring") return { ...f, pitch: Math.max(f.wire * 1.0005, (L - f.wire) / f.turns) };
      if (f.type === "tube" || f.type === "cylinder") return { ...f, height: Math.max(0.01, L) };
      if (f.type === "ext") return { ...f, data: springDataAt(f.data ?? {}, Math.max(0.01, L)) }; // tabulková pružina: délka tvaru
      return f;
    }),
  };
}

/** Lokální směr pružiny komponenty přenesený natočením umístění (Eulerovy úhly XYZ jako rotMatrix v assembly.ts: R = Rx·Ry·Rz). */
function rotate(rot: Vec3, v: Vec3): Vec3 {
  const [a, b, c] = rot.map((d) => (d * Math.PI) / 180);
  // Rz
  let x = Math.cos(c) * v[0] - Math.sin(c) * v[1];
  let y = Math.sin(c) * v[0] + Math.cos(c) * v[1];
  let z = v[2];
  // Ry
  [x, z] = [Math.cos(b) * x + Math.sin(b) * z, -Math.sin(b) * x + Math.cos(b) * z];
  // Rx
  [y, z] = [Math.cos(a) * y - Math.sin(a) * z, Math.sin(a) * y + Math.cos(a) * z];
  return [x, y, z];
}
export const springWorldAxis = (c: AsmComponent, g: SpringGeom): Vec3 => unit(rotate(c.placement.rotation, g.axis));

/** Délka pružiny v sestavě: uložená z posledního přepočtu, jinak volná délka (bez dosedacích ploch zůstává model). */
export function springLengthOf(c: AsmComponent): number | null {
  if (!c.spring || c.source.kind !== "part") return null;
  return c.spring.length ?? null;
}

/**
 * Komponenta s pružinou v aktuální délce pro jádro a zobrazení: zdroj = díl v délce `spring.length`, začátek posunutý po ose
 * o `spring.offset` (na dosedací plochu A). Bez pružiny / beze změny délky a polohy vrací tutéž komponentu.
 */
export function springEffective(c: AsmComponent): AsmComponent {
  const s = c.spring;
  if (!s || c.source.kind !== "part") return c;
  const g = springGeom(c.source.doc);
  if (!g) return c;
  const L = s.length ?? g.length;
  const off = s.offset ?? 0;
  const sameLen = Math.abs(L - g.length) < 1e-6;
  if (sameLen && Math.abs(off) < 1e-9) return c;
  const u = springWorldAxis(c, g);
  const position = off ? (c.placement.position.map((v, k) => springPosRound(v + u[k] * off)) as Vec3) : c.placement.position;
  return { ...c, source: sameLen ? c.source : { kind: "part", doc: springDocAt(c.source.doc, L) }, placement: { position, rotation: c.placement.rotation } };
}

/**
 * Lokální matice 4×4 (po sloupcích) pro SÍŤ volné pružiny v aktuální délce: posun začátku o `offset` po ose a měřítko po ose
 * k = L / L_modelu kolem začátku. null = beze změny.
 */
export function springMeshMatrix(c: AsmComponent): number[] | null {
  const s = c.spring;
  if (!s || c.source.kind !== "part") return null;
  const g = springGeom(c.source.doc);
  if (!g) return null;
  const k = (s.length ?? g.length) / g.length;
  const off = s.offset ?? 0;
  if (Math.abs(k - 1) < 1e-9 && Math.abs(off) < 1e-9) return null;
  const a = g.axis;
  const b = g.base;
  // x' = b + a·off + S·(x − b),  S = I + (k − 1)·a·aᵀ
  const S = [0, 1, 2].map((i) => [0, 1, 2].map((j) => (i === j ? 1 : 0) + (k - 1) * a[i] * a[j]));
  const t = [0, 1, 2].map((i) => b[i] + a[i] * off - (S[i][0] * b[0] + S[i][1] * b[1] + S[i][2] * b[2]));
  return [S[0][0], S[1][0], S[2][0], 0, S[0][1], S[1][1], S[2][1], 0, S[0][2], S[1][2], S[2][2], 0, t[0], t[1], t[2], 1];
}
