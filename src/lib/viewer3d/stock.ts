/**
 * Hmotnost dílu a polotovaru z 3D modelu: objem tělesa × hustota materiálu, polotovar
 * (přířez z obalového kvádru, kulatina u rotačních dílů) s přídavky podle pravidel nacenění
 * (src/lib/pricing/blank.ts), aby čísla seděla s kalkulací. Kulatina se zaokrouhlí na běžný
 * průměr tyče, přířez na celé mm.
 */
import { allowance, lengthAllowance } from "@/lib/pricing/blank";

export type StockKind = "prirez" | "kulatina";
export type StockMode = "auto" | StockKind;

export interface StockGeometry {
  /** Rozměry obalového kvádru X, Y, Z (mm). */
  size: [number, number, number];
  /** Rotační díl: průměr opsaného válce a délka podél osy (mm). */
  round?: { diameter: number; length: number } | null;
  /** Objem tělesa (mm³). */
  volumeMm3: number;
}

export interface StockResult {
  kind: StockKind;
  /** Lidsky: „Kulatina ⌀45 × 84 mm", „Přířez 30 × 25 × 18 mm". */
  label: string;
  dims: number[];
  volumeMm3: number;
  /** Hmotnost polotovaru (kg). */
  massKg: number;
  /** Hmotnost hotového dílu (kg). */
  partMassKg: number;
  /** Využití materiálu (%) a odpad (kg). */
  utilization: number;
  wasteKg: number;
  /** Plech / tenký přířez — tloušťka bez přídavku. */
  sheet: boolean;
}

/** Běžné průměry tyčí kulatiny (mm) — větší se zaokrouhlí na 10 mm. */
export const BAR_DIAMETERS = [
  6, 8, 10, 12, 14, 15, 16, 18, 20, 22, 25, 28, 30, 32, 35, 36, 38, 40, 42, 45, 48, 50, 52, 55, 60, 63, 65, 70, 75, 80,
  85, 90, 95, 100, 105, 110, 115, 120, 125, 130, 140, 150, 160, 170, 180, 190, 200, 210, 220, 230, 240, 250, 260, 280, 300,
];

export function standardBar(d: number): number {
  const exact = Math.ceil(d - 1e-6);
  return BAR_DIAMETERS.find((x) => x >= exact) ?? Math.ceil(exact / 10) * 10;
}

/** kg z mm³ a hustoty v kg/dm³ (= g/cm³). */
export function massKg(volumeMm3: number, densityKgDm3: number): number {
  return (volumeMm3 / 1_000_000) * densityKgDm3;
}

/** Polotovar pro díl. `allowanceMm` přepíše standardní přídavek (na každý rozměr celkem). */
export function stockFor(geom: StockGeometry, densityKgDm3: number, mode: StockMode = "auto", allowanceMm?: number | null): StockResult {
  const kind: StockKind = mode === "auto" ? (geom.round ? "kulatina" : "prirez") : mode === "kulatina" && !geom.round ? "kulatina" : mode;
  const add = (d: number, length = false) => (allowanceMm != null && allowanceMm >= 0 ? allowanceMm : length ? lengthAllowance(d) : allowance(d));
  const partMass = massKg(geom.volumeMm3, densityKgDm3);
  let dims: number[];
  let volume: number;
  let label: string;
  let sheet = false;
  if (kind === "kulatina") {
    // bez rozpoznané osy: kulatina přes nejdelší rozměr, průměr z ostatních dvou (úhlopříčka)
    const sorted = [...geom.size].sort((a, b) => b - a);
    const d0 = geom.round?.diameter ?? Math.hypot(sorted[1], sorted[2]);
    const l0 = geom.round?.length ?? sorted[0];
    const D = standardBar(d0 + add(d0));
    const L = Math.ceil(l0 + add(l0, true));
    dims = [D, L];
    volume = Math.PI * (D / 2) ** 2 * L;
    label = `Kulatina ⌀${D} × ${L} mm`;
  } else {
    const [x, y, z] = geom.size;
    const min = Math.min(x, y, z);
    // tenký díl (≤ 8 mm) = plech / výpalek: tloušťka bez přídavku (jako v nacenění)
    sheet = min <= 8 && allowanceMm == null;
    const grow = (d: number) => (sheet && d === min ? Math.ceil(d - 1e-6) : Math.ceil(d + add(d) - 1e-6));
    dims = [grow(x), grow(y), grow(z)];
    volume = dims[0] * dims[1] * dims[2];
    label = `${sheet ? "Plech / přířez" : "Přířez"} ${dims.join(" × ")} mm`;
  }
  const mass = massKg(volume, densityKgDm3);
  return {
    kind, label, dims, volumeMm3: volume, massKg: mass, partMassKg: partMass,
    utilization: mass > 0 ? Math.round((partMass / mass) * 100) : 0,
    wasteKg: Math.max(0, mass - partMass),
    sheet,
  };
}

/** Formát kg: do 1 kg na gramy přesněji. */
export function fmtKg(kg: number): string {
  const s = kg >= 100 ? kg.toFixed(1) : kg >= 1 ? kg.toFixed(2) : kg.toFixed(3);
  return `${s.replace(".", ",")} kg`;
}
