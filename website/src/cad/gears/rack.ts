/**
 * Základní profil (hřeben) podle ISO 53:1998 / DIN 867: výška hlavy h_aP*, paty h_fP* a poloměr zaoblení paty ρ_fP*
 * v násobcích modulu. Typ A odpovídá DIN 867.
 */
import { tr } from "../i18n";
import { DEG } from "./num";

export type RackSpec = { ha: number; hf: number; rho: number };
export const RACKS: Record<string, RackSpec> = {
  A: { ha: 1, hf: 1.25, rho: 0.38 },
  B: { ha: 1, hf: 1.25, rho: 0.3 },
  C: { ha: 1, hf: 1.25, rho: 0.25 },
  D: { ha: 1, hf: 1.4, rho: 0.39 },
};
export const RACK_OPTIONS = () => [
  { v: "A", l: tr("ISO 53 A (DIN 867): ρ 0,38, pata 1,25") },
  { v: "B", l: tr("ISO 53 B: ρ 0,30, pata 1,25") },
  { v: "C", l: tr("ISO 53 C: ρ 0,25, pata 1,25") },
  { v: "D", l: tr("ISO 53 D: ρ 0,39, pata 1,40") },
  { v: "custom", l: tr("Vlastní (řádky níže)") },
];
/** profil podle volby; „custom“ bere zadané hodnoty */
export function rackOf(type: string, custom: RackSpec): RackSpec {
  return RACKS[type] ?? { ha: custom.ha > 0 ? custom.ha : 1, hf: custom.hf > 0 ? custom.hf : 1.25, rho: custom.rho >= 0 ? custom.rho : 0.38 };
}
/** největší zaoblení paty, které se do hřebene vejde (v modulech): ρ·(1 − sin α)/cos α ≤ π/4 − h_fP·tan α */
export function rackRhoMax(hf: number, alphaDeg: number): number {
  const a = alphaDeg * DEG;
  return (Math.PI / 4 - hf * Math.tan(a)) / ((1 - Math.sin(a)) / Math.cos(a));
}
export const rackName = (type: string) => (RACKS[type] ? `ISO 53-${type}` : tr("vlastní"));
