/**
 * Nacenění v2 — sdílené typy deterministického kalkulačního jádra.
 * Jádro počítá baseline kalkulaci (polotovar, materiál, časy, složitost,
 * sériovost, strategie, termín, vyhlazení ceny); AI ji následně rafinuje.
 */

// ── Polotovary ──────────────────────────────────────────────
export type BlankType =
  | "kulatina" | "trubka" | "prirez" | "plech"
  | "vypalek" | "vykovek" | "odlitek" | "vylisek";

export interface BlankProposal {
  type: BlankType;
  /** Lidsky čitelný rozměr polotovaru včetně přídavků, např. "⌀55 × 126 mm" */
  dimensions: string;
  volumeDm3: number;
  weightKg: number;        // hmotnost polotovaru
  partWeightKg: number;    // hmotnost hotového dílu (odhad / z výkresu)
  wasteKg: number;         // odpad (úběr)
  utilizationPercent: number; // využití materiálu v %
  note: string;
}

// ── Materiály ───────────────────────────────────────────────
export type MaterialGroup =
  | "konstrukcni_ocel" | "automatova_ocel" | "legovana_ocel" | "nastrojova_ocel"
  | "nerez" | "litina" | "hlinik" | "mosaz" | "med" | "bronz" | "titan" | "plast";

export type MaterialAvailability = "bezna" | "omezena" | "specialni";

export interface MaterialInfo {
  key: string;
  /** Všechny názvy/aliasy (ČSN, W.Nr., EN), malými písmeny */
  aliases: string[];
  label: string;
  group: MaterialGroup;
  densityKgDm3: number;
  pricePerKg: number;        // CZK/kg — výchozí, přepsatelné z DB
  machinability: number;     // 1 = běžná ocel; >1 hůře obrobitelný
  special: boolean;          // speciální materiál (přirážka)
  availability: MaterialAvailability;
}

export interface MaterialCostInput {
  material: MaterialInfo;
  blankWeightKg: number;
  quantity: number;
  certificateRequired?: boolean;
  params: PricingParams;
}

export interface MaterialCostResult {
  pricePerKg: number;
  basePerPiece: number;
  surchargesPercent: number;   // součet přirážek v %
  surchargeNotes: string[];
  transportPerOrder: number;
  costPerPiece: number;        // vč. přirážek + rozpočtená doprava
  costTotal: number;
}

// ── Technologie a stroje ────────────────────────────────────
export type TechnologyKey =
  | "soustruzeni" | "dlouhotocne_soustruzeni"
  | "frezovani_3osy" | "frezovani_4osy" | "frezovani_5os"
  | "brouseni" | "dratove_rezani" | "hloubeni_edm"
  | "laser" | "vodni_paprsek" | "paleni"
  | "svarovani" | "montaz"
  | "tepelne_zpracovani" | "povrchova_uprava" | "kooperace";

export type MachineSize = "maly" | "stredni" | "velky" | "portal";

export interface MachineRate {
  key: string;
  label: string;
  technology: TechnologyKey;
  size: MachineSize;
  ratePerHour: number; // CZK/h, základ pro CZ
}

// ── Složitost ───────────────────────────────────────────────
export interface ToleranceCounts { t005: number; t01: number; t04: number; t1: number }

export interface ComplexityInput {
  operationCount: number;
  setupCount: number;
  toolCountEstimate: number;
  tolerances: ToleranceCounts;     // sloučené počty (před + po tepelce)
  geomToleranceCount: number;
  threadCount: number;
  pocketCount: number;
  holeCount: number;
  machinability: number;           // z materiálu
  hasHeatTreatment: boolean;
  hasTightSurfaceFinish: boolean;  // Ra ≤ 0,8
}

export interface ComplexityResult {
  coefficient: number;        // 1,0–2,5
  scrapRiskPercent: number;   // riziko zmetkovitosti
  measurementDifficulty: "nizka" | "stredni" | "vysoka";
  notes: string[];
}

// ── Sériovost ───────────────────────────────────────────────
export type SeriesClass = "jeden_kus" | "prototyp" | "mala_serie" | "stredni_serie" | "velka_serie";

export interface SeriesInfo {
  cls: SeriesClass;
  label: string;
  /** Násobič strojního času na kus (učení/efektivita série) */
  perPieceTimeFactor: number;
}

// ── Strategie ───────────────────────────────────────────────
export interface StrategyContext {
  /** Aktuální vytížení výroby v % */
  utilizationPercent?: number;
  /** Atraktivita / strategický význam zákazníka */
  customerAttractive?: boolean;
  customerStrategic?: boolean;
  /** Opakovaná zakázka / opakovatelný díl */
  repeatBusiness?: boolean;
  /** Vysoce konkurenční trh u této poptávky */
  competitiveMarket?: boolean;
  /** Riziko zákazníka (platební morálka apod.) */
  riskyCustomer?: boolean;
}

export interface StrategyResult {
  level: number;            // 1–10 po úpravách
  requestedLevel: number;   // zadáno uživatelem / default
  marginPercent: number;
  adjustments: string[];    // zdůvodnění posunů
}

// ── Termín dodání ───────────────────────────────────────────
export type LeadTimeMode = "expres" | "rychly" | "standard" | "dlouhy";

export interface LeadTimeResult {
  mode: LeadTimeMode;
  days: number;                  // nabízený termín
  standardDays: number;          // přirozený termín bez expresu
  surchargePercent: number;      // přirážka za zkrácení
  notes: string[];
}

// ── Vyhlazení ceny ──────────────────────────────────────────
export interface HistoricalPrice {
  unitPrice: number;
  date: string;     // ISO
  note?: string;
}

export interface SmoothingResult {
  price: number;
  adjusted: boolean;
  referencePrice?: number;  // klouzavý průměr historie (po inflaci)
  note: string;
}

// ── Zákaznický cenový profil ────────────────────────────────
export interface CustomerPricingProfile {
  name?: string;
  marginPercent?: number | null;       // individuální marže
  priceLevel?: "nizka" | "standard" | "premium" | null;
  businessPriority?: "nizka" | "stredni" | "vysoka" | "strategicky" | null;
  paymentMorale?: "vyborna" | "dobra" | "prumerna" | "spatna" | null;
  riskLevel?: "nizke" | "stredni" | "vysoke" | null;
  annualRevenueCzk?: number | null;
  repeatCustomer?: boolean | null;
}

// ── Parametry kalkulace (laditelné v DB) ────────────────────
export interface PricingParams {
  hourlyRate: number;          // Kč/h výchozí strojní sazba
  handlingRate: number;        // Kč/h manipulace
  programmingRate: number;     // Kč/h programování
  setupRate: number;           // Kč/h seřizování
  inspectionRate: number;      // Kč/h kontrola
  marginPercent: number;       // výchozí marže (strategie 5)
  inflationPercent: number;    // %/rok pro historické ceny
  transportDefault: number;    // Kč doprava hotových dílů
  materialTransport: number;   // Kč doprava materiálu na zakázku
  strategyLevel: number;       // 1–10
  utilizationPercent: number;  // vytížení výroby %
  smallQtySurchargePct: number;     // přirážka malé množství materiálu
  specialMaterialSurchargePct: number;
  certificationSurchargePct: number;
  scarceMaterialSurchargePct: number;
  maxPriceStepPct: number;     // max. skok ceny vs. historie
  expressSurchargePct: number; // expres termín
  fastSurchargePct: number;    // rychlý termín
  countryCode: string;         // země výroby (sazby strojů)
}

// ── Operace a výsledná kalkulace ────────────────────────────
export interface OperationEstimate {
  technology: TechnologyKey;
  name: string;
  machine: string;             // label stroje
  ratePerHour: number;
  setupMinutes: number;        // na dávku
  programmingMinutes: number;  // na dávku
  firstPieceMinutes: number;   // výroba + kontrola 1. kusu (na dávku)
  minutesPerPiece: number;     // sériový čas / ks
  inspectionMinutesPerPiece: number;
  costPerPiece: number;        // vč. amortizace fixních časů
  cooperation: boolean;        // kooperace (cena se počítá zvlášť)
}

export interface PriceBreakdown {
  // Vstupy / odvozené
  material: MaterialInfo;
  blank: BlankProposal;
  materialCost: MaterialCostResult;
  operations: OperationEstimate[];
  complexity: ComplexityResult;
  series: SeriesInfo;
  strategy: StrategyResult;
  leadTime: LeadTimeResult;
  smoothing: SmoothingResult | null;

  // Časy
  timePerPieceMin: number;        // celkový čas na kus (stroj + kontrola)
  timeFixedMin: number;           // fixní časy na dávku (programování, seřízení, 1. kus)
  timeTotalMin: number;           // celkem na zakázku

  // Náklady / ks
  machiningCostPerPiece: number;
  fixedCostPerPiece: number;       // amortizace programování/seřízení/1. kusu
  inspectionCostPerPiece: number;
  handlingMinutesPerPiece: number;
  handlingCostPerPiece: number;
  packingCostPerPiece: number;
  cooperationCostPerPiece: number; // tepelka + povrch + ostatní kooperace
  surfaceTreatmentCost: number;
  heatTreatmentCost: number;
  transportPerPiece: number;

  costPerPiece: number;            // úplné výrobní náklady / ks
  marginPercent: number;
  unitPrice: number;               // nabídková cena / ks (po strategii, expresu, vyhlazení)
  totalPrice: number;
  scrapAllowancePercent: number;

  quantity: number;
  confidence: number;              // 0–1 dle úplnosti vstupů
  reasoning: string[];             // zdůvodnění kalkulace po krocích
  needsClarification: string[];
}
