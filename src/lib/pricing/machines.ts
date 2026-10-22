import type { MachineRate, MachineSize, TechnologyKey } from "./types";

/**
 * Strojní kapacity a hodinové sazby: dle typu stroje, velikosti a země výroby.
 * Sazby jsou výchozí (CZ) — přepsatelné v DB (machine_rates) nebo parametrem.
 */

export const MACHINE_RATES: MachineRate[] = [
  { key: "cnc_male", label: "Malé CNC frézovací centrum", technology: "frezovani_3osy", size: "maly", ratePerHour: 900 },
  { key: "cnc_stredni", label: "Střední CNC frézovací centrum", technology: "frezovani_3osy", size: "stredni", ratePerHour: 1200 },
  { key: "cnc_velke", label: "Velké CNC frézovací centrum", technology: "frezovani_3osy", size: "velky", ratePerHour: 1600 },
  { key: "cnc_portal", label: "Portálové CNC centrum", technology: "frezovani_3osy", size: "portal", ratePerHour: 2200 },
  { key: "cnc_4osy", label: "CNC centrum 4 osy", technology: "frezovani_4osy", size: "stredni", ratePerHour: 1400 },
  { key: "cnc_5os", label: "Pětiosé CNC centrum", technology: "frezovani_5os", size: "stredni", ratePerHour: 1800 },
  { key: "soustruh_maly", label: "CNC soustruh malý", technology: "soustruzeni", size: "maly", ratePerHour: 850 },
  { key: "soustruh", label: "CNC soustruh", technology: "soustruzeni", size: "stredni", ratePerHour: 1000 },
  { key: "soustruh_velky", label: "CNC soustruh velký", technology: "soustruzeni", size: "velky", ratePerHour: 1400 },
  { key: "dlouhotocny", label: "Dlouhotočný automat", technology: "dlouhotocne_soustruzeni", size: "maly", ratePerHour: 1100 },
  { key: "bruska", label: "Bruska (rovinná/kruhová)", technology: "brouseni", size: "stredni", ratePerHour: 1000 },
  { key: "dratovka", label: "Drátová řezačka (WEDM)", technology: "dratove_rezani", size: "stredni", ratePerHour: 850 },
  { key: "hloubicka", label: "Hloubička (EDM)", technology: "hloubeni_edm", size: "stredni", ratePerHour: 950 },
  { key: "laser", label: "Laser", technology: "laser", size: "stredni", ratePerHour: 1400 },
  { key: "vodni_paprsek", label: "Vodní paprsek", technology: "vodni_paprsek", size: "stredni", ratePerHour: 1300 },
  { key: "paleni", label: "Pálicí stroj (plazma/plamen)", technology: "paleni", size: "stredni", ratePerHour: 800 },
  { key: "svarovna", label: "Svařovna", technology: "svarovani", size: "stredni", ratePerHour: 750 },
  { key: "montaz", label: "Montážní pracoviště", technology: "montaz", size: "stredni", ratePerHour: 600 },
];

/** Koeficient hodinové sazby dle země výroby. */
export const COUNTRY_RATE_FACTOR: Record<string, number> = {
  CZ: 1.0, SK: 0.95, PL: 0.9, HU: 0.85, DE: 1.8, AT: 1.7, CH: 2.5, IT: 1.4, FR: 1.5, CN: 0.6, IN: 0.55,
};

export function countryFactor(code?: string): number {
  return COUNTRY_RATE_FACTOR[(code ?? "CZ").toUpperCase()] ?? 1.0;
}

/** Velikost stroje podle největšího rozměru dílu (mm). */
export function machineSizeFor(maxDimensionMm: number): MachineSize {
  if (maxDimensionMm <= 0) return "stredni";
  if (maxDimensionMm <= 200) return "maly";
  if (maxDimensionMm <= 600) return "stredni";
  if (maxDimensionMm <= 1500) return "velky";
  return "portal";
}

/** Vybere stroj pro technologii a velikost; padá na nejbližší dostupný. */
export function pickMachine(technology: TechnologyKey, size: MachineSize, countryCode?: string, rates: MachineRate[] = MACHINE_RATES): MachineRate {
  const candidates = rates.filter((m) => m.technology === technology);
  const order: MachineSize[] = [size, "stredni", "maly", "velky", "portal"];
  let machine = candidates[0];
  for (const s of order) {
    const hit = candidates.find((m) => m.size === s);
    if (hit) { machine = hit; break; }
  }
  if (!machine) {
    // neznámá technologie → výchozí střední CNC
    machine = rates.find((m) => m.key === "cnc_stredni") ?? MACHINE_RATES.find((m) => m.key === "cnc_stredni")!;
  }
  const f = countryFactor(countryCode);
  return f === 1 ? machine : { ...machine, ratePerHour: Math.round(machine.ratePerHour * f) };
}

/** Mapování volného textu technologie (z výkresu / AI) na klíč technologie. */
export function normalizeTechnology(text: string): TechnologyKey | null {
  const t = text.toLowerCase();
  if (/dlouhotoč|dlouhotoc|swiss/.test(t)) return "dlouhotocne_soustruzeni";
  if (/soustruž|soustruz|turn/.test(t)) return "soustruzeni";
  if (/5[\s-]?os|petios|pětios/.test(t)) return "frezovani_5os";
  if (/4[\s-]?os/.test(t)) return "frezovani_4osy";
  if (/fréz|frez|mill/.test(t)) return "frezovani_3osy";
  if (/brou[sš]/.test(t)) return "brouseni";
  if (/drát|drat|wedm|wire/.test(t)) return "dratove_rezani";
  if (/hloub|edm|elektroeroz/.test(t)) return "hloubeni_edm";
  if (/laser/.test(t)) return "laser";
  if (/vodní|vodni|waterjet/.test(t)) return "vodni_paprsek";
  if (/pálení|paleni|plazma|plamen/.test(t)) return "paleni";
  if (/svař|svar|weld/.test(t)) return "svarovani";
  if (/mont|assembl/.test(t)) return "montaz";
  if (/kal|žíh|zih|cement|nitrid|popou|tepel/.test(t)) return "tepelne_zpracovani";
  if (/zinek|zinko|elox|černěn|cernen|chrom|nikl|lak|povrch|fosf/.test(t)) return "povrchova_uprava";
  if (/kooperac/.test(t)) return "kooperace";
  return null;
}

export const TECHNOLOGY_LABEL: Record<TechnologyKey, string> = {
  soustruzeni: "Soustružení",
  dlouhotocne_soustruzeni: "Dlouhotočné soustružení",
  frezovani_3osy: "Frézování 3 osy",
  frezovani_4osy: "Frézování 4 osy",
  frezovani_5os: "Frézování 5 os",
  brouseni: "Broušení",
  dratove_rezani: "Drátové řezání",
  hloubeni_edm: "Hloubení EDM",
  laser: "Laser",
  vodni_paprsek: "Vodní paprsek",
  paleni: "Pálení",
  svarovani: "Svařování",
  montaz: "Montáž",
  tepelne_zpracovani: "Tepelné zpracování",
  povrchova_uprava: "Povrchová úprava",
  kooperace: "Kooperace",
};

/** Kooperační technologie — neúčtují se hodinovou sazbou, ale cenou kooperace. */
export const COOPERATION_TECHNOLOGIES: TechnologyKey[] = [
  "tepelne_zpracovani", "povrchova_uprava", "kooperace",
];
