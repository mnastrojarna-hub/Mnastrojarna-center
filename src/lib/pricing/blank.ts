import type { BlankProposal, BlankType, MaterialInfo } from "./types";
import { round2 } from "./materials";

/**
 * Automatický návrh polotovaru: typ (kulatina/trubka/přířez/plech/výpalek/
 * výkovek/odlitek/výlisek), rozměr s přídavky, objem, hmotnost, odpad,
 * využití materiálu.
 */

export interface ParsedDimensions {
  shape: "round" | "tube" | "box" | "unknown";
  d?: number;       // vnější průměr
  dInner?: number;  // vnitřní průměr (trubka)
  l?: number;       // délka (rotační)
  x?: number; y?: number; z?: number; // hranol/deska
  raw: string;
}

const NUM = "(\\d+(?:[.,]\\d+)?)";
const SEP = "\\s*[x×*]\\s*";

/** Rozpozná rozměry z textu: "⌀50 × 120", "D50x120", "TR 60/40 × 100", "120 × 80 × 25". */
export function parseDimensions(text?: string | null): ParsedDimensions {
  const raw = (text ?? "").trim();
  if (!raw) return { shape: "unknown", raw };
  const t = raw.toLowerCase().replace(/mm/g, " ").replace(/ø|⌀|φ/g, "fi ");

  // Trubka: "tr 60/40 x 100", "fi 60/40 x 100", "60/40 x 100"
  let m = t.match(new RegExp(`(?:tr\\.?\\s*|fi\\s*|d\\s*)?${NUM}\\s*/\\s*${NUM}${SEP}${NUM}`));
  if (m) return { shape: "tube", d: num(m[1]), dInner: num(m[2]), l: num(m[3]), raw };

  // Kulatina: "fi 50 x 120", "d50x120", "pr. 50 x 120", "kr 50 x 120"
  m = t.match(new RegExp(`(?:fi|d|pr\\.?|kr)\\s*${NUM}${SEP}${NUM}`));
  if (m) return { shape: "round", d: num(m[1]), l: num(m[2]), raw };

  // Hranol/deska: "120 x 80 x 25"
  m = t.match(new RegExp(`${NUM}${SEP}${NUM}${SEP}${NUM}`));
  if (m) {
    const dims = [num(m[1]), num(m[2]), num(m[3])].sort((a, b) => b - a);
    return { shape: "box", x: dims[0], y: dims[1], z: dims[2], raw };
  }

  // Samotný průměr: "fi 50" (délku neznáme)
  m = t.match(new RegExp(`(?:fi|d|pr\\.?)\\s*${NUM}`));
  if (m) return { shape: "round", d: num(m[1]), raw };

  return { shape: "unknown", raw };
}

function num(s: string): number {
  return Number(s.replace(",", "."));
}

/** Přídavek na průměr/stranu dle velikosti rozměru (mm). */
export function allowance(dimensionMm: number): number {
  if (dimensionMm <= 30) return 3;
  if (dimensionMm <= 80) return 4;
  if (dimensionMm <= 200) return 5;
  return 8;
}

/** Přídavek na délku (upnutí + zarovnání čel). */
function lengthAllowance(lengthMm: number): number {
  if (lengthMm <= 100) return 4;
  if (lengthMm <= 300) return 6;
  return 10;
}

const BLANK_LABEL: Record<BlankType, string> = {
  kulatina: "Kulatina", trubka: "Trubka", prirez: "Přířez", plech: "Plech",
  vypalek: "Výpalek", vykovek: "Výkovek", odlitek: "Odlitek", vylisek: "Výlisek",
};

export function blankTypeLabel(t: BlankType): string {
  return BLANK_LABEL[t];
}

export interface ProposeBlankInput {
  partType?: string;          // obrabeny_dil | plech | svarenec | vykovek | odlitek | jine
  blankDimensions?: string;   // text z výkresu / formuláře
  blankWeightKg?: number;     // pokud známe z výkresu, má přednost
  finishedWeightKg?: number;
  material: MaterialInfo;
  technologies?: string[];
}

/** Navrhne polotovar včetně objemu, hmotnosti, odpadu a využití materiálu. */
export function proposeBlank(input: ProposeBlankInput): BlankProposal {
  const dims = parseDimensions(input.blankDimensions);
  const density = input.material.densityKgDm3;
  const tech = (input.technologies ?? []).map((t) => t.toLowerCase()).join(" ");

  // Typ polotovaru
  let type: BlankType;
  const pt = (input.partType ?? "").toLowerCase();
  if (pt === "vykovek") type = "vykovek";
  else if (pt === "odlitek") type = "odlitek";
  else if (pt === "vylisek") type = "vylisek";
  else if (pt === "plech" || (dims.shape === "box" && (dims.z ?? 99) <= 8)) {
    type = /laser|plamen|pál|pal|vodní|vodni|výpal|vypal/.test(tech) ? "vypalek" : "plech";
  } else if (dims.shape === "tube") type = "trubka";
  else if (dims.shape === "round") type = "kulatina";
  else if (dims.shape === "box") type = "prirez";
  else if (/soustruž|soustruz|dlouhotoč|dlouhotoc/.test(tech)) type = "kulatina";
  else type = "prirez";

  // Rozměr polotovaru s přídavky + objem (dm³)
  let volumeDm3 = 0;
  let dimensions = dims.raw || "—";
  const notes: string[] = [];

  if (dims.shape === "round" && dims.d) {
    const D = dims.d + allowance(dims.d);
    const L = (dims.l ?? dims.d) + lengthAllowance(dims.l ?? dims.d);
    if (!dims.l) notes.push("délka odhadnuta (na výkrese chybí)");
    volumeDm3 = (Math.PI * (D / 2) ** 2 * L) / 1_000_000;
    dimensions = `⌀${D} × ${L} mm`;
  } else if (dims.shape === "tube" && dims.d && dims.dInner) {
    const D = dims.d + allowance(dims.d);
    const dI = Math.max(0, dims.dInner - 2);
    const L = (dims.l ?? dims.d) + lengthAllowance(dims.l ?? dims.d);
    volumeDm3 = (Math.PI * ((D / 2) ** 2 - (dI / 2) ** 2) * L) / 1_000_000;
    dimensions = `TR ⌀${D}/⌀${dI} × ${L} mm`;
  } else if (dims.shape === "box" && dims.x && dims.y && dims.z) {
    const a = allowance(dims.x);
    const X = dims.x + a, Y = dims.y + allowance(dims.y);
    // U plechu/výpalku tloušťka zůstává (standardní formát plechu)
    const Z = type === "plech" || type === "vypalek" ? dims.z : dims.z + allowance(dims.z);
    volumeDm3 = (X * Y * Z) / 1_000_000;
    dimensions = `${X} × ${Y} × ${Z} mm`;
  }

  // Hmotnosti: výkres má přednost před výpočtem
  let weightKg = input.blankWeightKg && input.blankWeightKg > 0 ? input.blankWeightKg : round2(volumeDm3 * density);
  if (!volumeDm3 && weightKg > 0) volumeDm3 = round2(weightKg / density);
  if (!weightKg && !volumeDm3) notes.push("rozměry polotovaru se nepodařilo určit — doplň");

  // Výkovek/odlitek/výlisek mají tvar blízký dílu → menší odpad
  const nearNet = type === "vykovek" || type === "odlitek" || type === "vylisek";
  let partWeightKg = input.finishedWeightKg && input.finishedWeightKg > 0
    ? input.finishedWeightKg
    : round2(weightKg * (nearNet ? 0.85 : 0.55));
  if (!input.finishedWeightKg && weightKg > 0) notes.push("hmotnost hotového dílu odhadnuta");
  if (nearNet && (!input.blankWeightKg || input.blankWeightKg <= 0) && input.finishedWeightKg) {
    weightKg = round2(input.finishedWeightKg / 0.85);
  }
  if (partWeightKg > weightKg && weightKg > 0) partWeightKg = weightKg;

  const wasteKg = round2(Math.max(0, weightKg - partWeightKg));
  const utilizationPercent = weightKg > 0 ? Math.round((partWeightKg / weightKg) * 100) : 0;

  return {
    type,
    dimensions,
    volumeDm3: round2(volumeDm3),
    weightKg: round2(weightKg),
    partWeightKg: round2(partWeightKg),
    wasteKg,
    utilizationPercent,
    note: [`${BLANK_LABEL[type]}${nearNet ? " (tvarový polotovar)" : ""}`, ...notes].join(" · "),
  };
}
