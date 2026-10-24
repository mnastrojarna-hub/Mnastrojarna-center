/**
 * Skupiny materiálu pro rychlý přehled + rozpoznání tepelného zpracování a povrchových úprav.
 *
 * Čistý modul (bez serverových závislostí, bez importu ikon) — použitelný v klientu i na serveru.
 * Ikony jsou jména z lucide-react (UI si je namapuje samo).
 *
 *  - classifyMaterial(označení, aiSkupina?) → skupina, podskupina, hustota, stav (+QT…), tvrdost
 *  - parseTreatments(text) → tepelné zpracování (s tvrdostí / hloubkou) a povrchové úpravy
 *
 * Přednost má jednoznačné označení (W.Nr., ČSN, EN, AISI, UNS, obchodní název); AI skupina je jen záloha.
 */

// ═════════════════════════════════════════════════════════════════════════
// Skupiny materiálu
// ═════════════════════════════════════════════════════════════════════════

export type MaterialGroupKey =
  | "bezna_ocel"
  | "zuslechtena_ocel"
  | "nastrojova_ocel"
  | "slinuty_karbid"
  | "nerez"
  | "duplex"
  | "med"
  | "barevne_kovy"
  | "litina"
  | "hlinik"
  | "titan"
  | "plasty"
  | "ostatni";

export interface MaterialGroupDef {
  key: MaterialGroupKey;
  label: string;
  short: string;
  /** Slovo do popisu hmotnosti („kulatina … , ocel 7,85 g/cm³"). */
  densityLabel: string;
  description: string;
  /** Tailwind třídy štítku (vypsané celé kvůli JIT). */
  badge: string;
  dot: string;
  text: string;
  /** Jméno ikony z lucide-react. */
  icon: string;
  /** Typická hustota g/cm³. */
  density: number;
}

export const MATERIAL_GROUP_ORDER: MaterialGroupKey[] = [
  "bezna_ocel", "zuslechtena_ocel", "nastrojova_ocel", "slinuty_karbid", "nerez", "duplex",
  "med", "barevne_kovy", "litina", "hlinik", "titan", "plasty", "ostatni",
];

export const MATERIAL_GROUPS: Record<MaterialGroupKey, MaterialGroupDef> = {
  bezna_ocel: {
    key: "bezna_ocel", label: "Běžná konstrukční ocel", short: "Ocel", densityLabel: "ocel",
    description: "S235, S355, 11 373, 11 523, C45, 12 050, automatová 11SMn30…",
    badge: "bg-slate-100 text-slate-800 dark:bg-slate-500/15 dark:text-slate-300",
    dot: "bg-slate-500", text: "text-slate-700 dark:text-slate-300", icon: "Box", density: 7.85,
  },
  zuslechtena_ocel: {
    key: "zuslechtena_ocel", label: "Zušlechtěná / legovaná ocel", short: "Zušl. ocel", densityLabel: "legovaná ocel",
    description: "QT, ČSN 14/15/16 xxx, 42CrMo4, 34CrNiMo6, cementační 16MnCr5, ložisková 100Cr6…",
    badge: "bg-blue-100 text-blue-800 dark:bg-blue-500/15 dark:text-blue-300",
    dot: "bg-blue-500", text: "text-blue-700 dark:text-blue-300", icon: "Flame", density: 7.85,
  },
  nastrojova_ocel: {
    key: "nastrojova_ocel", label: "Nástrojová ocel", short: "Nástr. ocel", densityLabel: "nástrojová ocel",
    description: "ČSN 19 xxx, 1.2xxx, X153CrMoV12 (D2), H11/H13, rychlořezná HSS 19 8xx…",
    badge: "bg-violet-100 text-violet-800 dark:bg-violet-500/15 dark:text-violet-300",
    dot: "bg-violet-500", text: "text-violet-700 dark:text-violet-300", icon: "Hammer", density: 7.8,
  },
  slinuty_karbid: {
    key: "slinuty_karbid", label: "Slinutý karbid", short: "SK / HM", densityLabel: "slinutý karbid",
    description: "HM, tvrdokov, WC-Co, K10/K20/K40…",
    badge: "bg-fuchsia-100 text-fuchsia-800 dark:bg-fuchsia-500/15 dark:text-fuchsia-300",
    dot: "bg-fuchsia-500", text: "text-fuchsia-700 dark:text-fuchsia-300", icon: "Gem", density: 14.5,
  },
  nerez: {
    key: "nerez", label: "Nerezová ocel", short: "Nerez", densityLabel: "nerez",
    description: "ČSN 17 xxx, 1.43xx/1.44xx, AISI 304/316/420, X5CrNi18-10…",
    badge: "bg-cyan-100 text-cyan-800 dark:bg-cyan-500/15 dark:text-cyan-300",
    dot: "bg-cyan-500", text: "text-cyan-700 dark:text-cyan-300", icon: "Sparkles", density: 7.9,
  },
  duplex: {
    key: "duplex", label: "Duplexní nerez", short: "Duplex", densityLabel: "duplex",
    description: "1.4462 (2205), 1.4362, super duplex 1.4410 (2507), 1.4501…",
    badge: "bg-teal-100 text-teal-800 dark:bg-teal-500/15 dark:text-teal-300",
    dot: "bg-teal-500", text: "text-teal-700 dark:text-teal-300", icon: "Layers", density: 7.8,
  },
  med: {
    key: "med", label: "Měď", short: "Měď", densityLabel: "měď",
    description: "Cu-ETP, E-Cu, Cu-OF, CuCrZr (elektrody)…",
    badge: "bg-orange-100 text-orange-800 dark:bg-orange-500/15 dark:text-orange-300",
    dot: "bg-orange-500", text: "text-orange-700 dark:text-orange-300", icon: "Zap", density: 8.94,
  },
  barevne_kovy: {
    key: "barevne_kovy", label: "Jiné barevné kovy", short: "Barevné", densityLabel: "barevný kov",
    description: "mosaz CuZn, bronz CuSn, CuAl, niklové slitiny Inconel/Hastelloy, hořčík, zinek…",
    badge: "bg-amber-100 text-amber-800 dark:bg-amber-500/15 dark:text-amber-300",
    dot: "bg-amber-500", text: "text-amber-700 dark:text-amber-300", icon: "Coins", density: 8.5,
  },
  litina: {
    key: "litina", label: "Litina", short: "Litina", densityLabel: "litina",
    description: "šedá GJL (GG), tvárná GJS (GGG), ČSN 42 24xx / 42 23xx, ocelolitina…",
    badge: "bg-stone-200 text-stone-800 dark:bg-stone-500/20 dark:text-stone-300",
    dot: "bg-stone-500", text: "text-stone-700 dark:text-stone-300", icon: "Factory", density: 7.2,
  },
  hlinik: {
    key: "hlinik", label: "Hliník", short: "Hliník", densityLabel: "hliník",
    description: "EN AW-6082, 7075, 2017 (dural), 5083, AlMgSi1, AlCuMg1…",
    badge: "bg-lime-100 text-lime-800 dark:bg-lime-500/15 dark:text-lime-300",
    dot: "bg-lime-500", text: "text-lime-700 dark:text-lime-300", icon: "Feather", density: 2.7,
  },
  titan: {
    key: "titan", label: "Titan", short: "Titan", densityLabel: "titan",
    description: "Grade 2, Grade 5 (Ti6Al4V), 3.7035, 3.7165…",
    badge: "bg-pink-100 text-pink-800 dark:bg-pink-500/15 dark:text-pink-300",
    dot: "bg-pink-500", text: "text-pink-700 dark:text-pink-300", icon: "Rocket", density: 4.5,
  },
  plasty: {
    key: "plasty", label: "Plasty", short: "Plast", densityLabel: "plast",
    description: "POM, PA6, PE, PTFE, PEEK, PVC, PMMA, textit…",
    badge: "bg-green-100 text-green-800 dark:bg-green-500/15 dark:text-green-300",
    dot: "bg-green-500", text: "text-green-700 dark:text-green-300", icon: "FlaskConical", density: 1.3,
  },
  ostatni: {
    key: "ostatni", label: "Ostatní / neurčeno", short: "Neurčeno", densityLabel: "materiál (předpoklad ocel)",
    description: "Materiál se nepodařilo zařadit — hustota se počítá jako ocel.",
    badge: "border border-dashed border-zinc-400 bg-transparent text-zinc-600 dark:border-zinc-500 dark:text-zinc-400",
    dot: "bg-zinc-400", text: "text-zinc-600 dark:text-zinc-400", icon: "CircleHelp", density: 7.85,
  },
};

export interface MaterialSubgroup {
  key: string;
  group: MaterialGroupKey;
  label: string;
  /** Přesnější hustota g/cm³. */
  density: number;
}

const SG = (key: string, group: MaterialGroupKey, label: string, density: number): MaterialSubgroup =>
  ({ key, group, label, density });

/** Podskupiny s přesnější hustotou / doplňující informací. */
export const MATERIAL_SUBGROUPS = {
  automatova: SG("automatova", "bezna_ocel", "automatová ocel", 7.85),
  usle_uhlikova: SG("usle_uhlikova", "bezna_ocel", "ušlechtilá uhlíková ocel", 7.85),
  plech_ocel: SG("plech_ocel", "bezna_ocel", "ocelový plech", 7.85),
  cementacni: SG("cementacni", "zuslechtena_ocel", "cementační ocel", 7.85),
  nitridacni: SG("nitridacni", "zuslechtena_ocel", "nitridační ocel", 7.85),
  lozyskova: SG("lozyskova", "zuslechtena_ocel", "ložisková ocel", 7.83),
  pruzinova: SG("pruzinova", "zuslechtena_ocel", "pružinová ocel", 7.85),
  oteruvzdorna: SG("oteruvzdorna", "zuslechtena_ocel", "otěruvzdorná / vysokopevná ocel", 7.85),
  manganova: SG("manganova", "zuslechtena_ocel", "manganová ocel", 7.9),
  hss: SG("hss", "nastrojova_ocel", "rychlořezná ocel (HSS)", 8.1),
  nastr_ledeburit: SG("nastr_ledeburit", "nastrojova_ocel", "ledeburitická nástrojová ocel (12 % Cr)", 7.7),
  nastr_tepla: SG("nastr_tepla", "nastrojova_ocel", "nástrojová ocel pro práci za tepla", 7.8),
  nastr_formy: SG("nastr_formy", "nastrojova_ocel", "ocel na formy", 7.8),
  nerez_austenit: SG("nerez_austenit", "nerez", "austenitická nerez", 7.9),
  nerez_austenit_mo: SG("nerez_austenit_mo", "nerez", "austenitická nerez s Mo (316)", 8.0),
  nerez_martenzit: SG("nerez_martenzit", "nerez", "martenzitická / feritická nerez", 7.7),
  nerez_ph: SG("nerez_ph", "nerez", "precipitačně vytvrditelná nerez (17-4PH)", 7.8),
  nerez_zaruvzdorna: SG("nerez_zaruvzdorna", "nerez", "žáruvzdorná ocel", 7.9),
  super_duplex: SG("super_duplex", "duplex", "super duplex", 7.8),
  med_nizkolegovana: SG("med_nizkolegovana", "med", "nízkolegovaná měď (CuCrZr)", 8.9),
  mosaz: SG("mosaz", "barevne_kovy", "mosaz", 8.5),
  bronz: SG("bronz", "barevne_kovy", "bronz", 8.8),
  hlinikovy_bronz: SG("hlinikovy_bronz", "barevne_kovy", "hliníkový bronz", 7.6),
  mednikl: SG("mednikl", "barevne_kovy", "měďnikl (CuNi)", 8.9),
  alpaka: SG("alpaka", "barevne_kovy", "alpaka (CuNiZn)", 8.7),
  berylliova_med: SG("berylliova_med", "barevne_kovy", "berylliová měď", 8.3),
  niklova_slitina: SG("niklova_slitina", "barevne_kovy", "niklová slitina", 8.4),
  nikl: SG("nikl", "barevne_kovy", "nikl", 8.9),
  monel: SG("monel", "barevne_kovy", "Monel (NiCu)", 8.8),
  hastelloy: SG("hastelloy", "barevne_kovy", "Hastelloy (NiMo)", 8.9),
  horcik: SG("horcik", "barevne_kovy", "hořčík", 1.8),
  zinek: SG("zinek", "barevne_kovy", "zinek / Zamak", 6.9),
  wolfram: SG("wolfram", "barevne_kovy", "wolfram / těžká slitina", 18.0),
  molybden: SG("molybden", "barevne_kovy", "molybden", 10.2),
  olovo: SG("olovo", "barevne_kovy", "olovo", 11.3),
  litina_seda: SG("litina_seda", "litina", "šedá litina (GJL)", 7.2),
  litina_tvarna: SG("litina_tvarna", "litina", "tvárná litina (GJS)", 7.1),
  litina_temper: SG("litina_temper", "litina", "temperovaná litina", 7.3),
  ocelolitina: SG("ocelolitina", "litina", "ocelolitina (odlitek z oceli)", 7.85),
  al_dural: SG("al_dural", "hlinik", "dural (AlCu, 2xxx)", 2.79),
  al_7xxx: SG("al_7xxx", "hlinik", "vysokopevný hliník (AlZn, 7xxx)", 2.81),
  al_5xxx: SG("al_5xxx", "hlinik", "hliník AlMg (5xxx)", 2.66),
  al_slevarensky: SG("al_slevarensky", "hlinik", "slévárenský hliník (AlSi)", 2.68),
  ti_cisty: SG("ti_cisty", "titan", "technický titan (Gr 1–4)", 4.51),
  ti_slitina: SG("ti_slitina", "titan", "slitina titanu (Ti6Al4V)", 4.43),
  pom: SG("pom", "plasty", "POM", 1.41),
  pa: SG("pa", "plasty", "PA (polyamid)", 1.14),
  pa_gf: SG("pa_gf", "plasty", "PA plněný sklem (GF30)", 1.36),
  pe: SG("pe", "plasty", "PE", 0.95),
  pe_uhmw: SG("pe_uhmw", "plasty", "PE-UHMW (PE 1000)", 0.93),
  pp: SG("pp", "plasty", "PP", 0.91),
  ptfe: SG("ptfe", "plasty", "PTFE", 2.2),
  peek: SG("peek", "plasty", "PEEK", 1.31),
  peek_gf: SG("peek_gf", "plasty", "PEEK plněný sklem (GF30)", 1.51),
  peek_cf: SG("peek_cf", "plasty", "PEEK plněný uhlíkem (CF30)", 1.41),
  pvc: SG("pvc", "plasty", "PVC", 1.4),
  pc: SG("pc", "plasty", "PC", 1.2),
  pmma: SG("pmma", "plasty", "PMMA (plexi)", 1.19),
  pet: SG("pet", "plasty", "PET", 1.38),
  pvdf: SG("pvdf", "plasty", "PVDF", 1.78),
  abs: SG("abs", "plasty", "ABS", 1.05),
  pur: SG("pur", "plasty", "PUR", 1.2),
  pei: SG("pei", "plasty", "PEI", 1.27),
  pps: SG("pps", "plasty", "PPS", 1.35),
  textit: SG("textit", "plasty", "textit / tvrzená tkanina", 1.35),
  sklotextit: SG("sklotextit", "plasty", "sklotextit (G10 / FR4)", 1.85),
  grafit: SG("grafit", "ostatni", "grafit", 1.8),
  keramika: SG("keramika", "ostatni", "technická keramika", 3.9),
  pryz: SG("pryz", "ostatni", "pryž", 1.3),
  drevo: SG("drevo", "ostatni", "dřevo", 0.7),
  sklo: SG("sklo", "ostatni", "sklo", 2.5),
} satisfies Record<string, MaterialSubgroup>;

export type MaterialSubgroupKey = keyof typeof MATERIAL_SUBGROUPS;

/** Synonyma pro převod volného textu AI na klíč skupiny. */
const GROUP_SYNONYMS: Record<MaterialGroupKey, string[]> = {
  bezna_ocel: ["bezna ocel", "bezna konstrukcni ocel", "konstrukcni ocel", "uhlikova ocel", "konstrukcni_ocel", "automatova_ocel", "automatova ocel", "structural steel", "carbon steel", "mild steel", "baustahl", "ocel", "steel", "stahl"],
  zuslechtena_ocel: ["zuslechtena ocel", "zuslechtena", "legovana ocel", "legovana_ocel", "zuslechtovaci ocel", "qt", "alloy steel", "vergutungsstahl", "cementacni ocel", "nitridacni ocel", "lozyskova ocel", "pruzinova ocel", "quenched and tempered steel"],
  nastrojova_ocel: ["nastrojova ocel", "nastrojova", "tool steel", "werkzeugstahl", "hss", "rychlorezna ocel", "high speed steel"],
  slinuty_karbid: ["slinuty karbid", "karbid", "tvrdokov", "hm", "hartmetall", "carbide", "cemented carbide", "tungsten carbide", "sk"],
  nerez: ["nerez", "nerezova ocel", "nerezova", "korozivzdorna ocel", "stainless", "stainless steel", "inox", "edelstahl", "rostfrei"],
  duplex: ["duplex", "duplexni nerez", "duplexni ocel", "super duplex", "superduplex", "duplex stainless"],
  med: ["med", "copper", "kupfer", "elektrolyticka med"],
  barevne_kovy: ["barevne kovy", "barevny kov", "jine barevne kovy", "nezelezne kovy", "nonferrous", "non-ferrous", "mosaz", "bronz", "brass", "bronze", "messing", "niklova slitina", "nickel alloy", "inconel"],
  litina: ["litina", "cast iron", "gusseisen", "seda litina", "tvarna litina", "grauguss"],
  hlinik: ["hlinik", "hlinikova slitina", "aluminium", "aluminum", "alu", "dural"],
  titan: ["titan", "titanium", "slitina titanu"],
  plasty: ["plasty", "plast", "plastic", "plastics", "kunststoff", "polymer"],
  ostatni: ["ostatni", "neurceno", "nezname", "neznamy", "jine", "other", "unknown"],
};

export function isMaterialGroupKey(v: unknown): v is MaterialGroupKey {
  return typeof v === "string" && Object.prototype.hasOwnProperty.call(MATERIAL_GROUPS, v);
}

export function materialGroupMeta(key: string | null | undefined): MaterialGroupDef {
  return isMaterialGroupKey(key) ? MATERIAL_GROUPS[key] : MATERIAL_GROUPS.ostatni;
}

/** Volný text skupiny (z AI) → klíč skupiny, nebo null. */
export function materialGroupFromText(text: string | null | undefined): MaterialGroupKey | null {
  if (!text) return null;
  const t = fold(text).replace(/[_\-/]+/g, " ").replace(/\s+/g, " ").trim();
  if (!t) return null;
  const asKey = t.replace(/ /g, "_");
  if (isMaterialGroupKey(asKey)) return asKey;
  for (const key of MATERIAL_GROUP_ORDER) {
    if (fold(MATERIAL_GROUPS[key].label) === t || fold(MATERIAL_GROUPS[key].short) === t) return key;
  }
  for (const key of MATERIAL_GROUP_ORDER) {
    if (GROUP_SYNONYMS[key].some((s) => s.replace(/_/g, " ") === t)) return key;
  }
  // částečná shoda — od nejdelších synonym (aby „zušlechtěná ocel" nevyhrálo „ocel")
  const all = MATERIAL_GROUP_ORDER.flatMap((key) => GROUP_SYNONYMS[key].map((s) => ({ key, s: s.replace(/_/g, " ") })))
    .filter((x) => x.s.length >= 4)
    .sort((a, b) => b.s.length - a.s.length);
  for (const { key, s } of all) if (new RegExp(`(?:^|\\s)${escapeRe(s)}(?:\\s|$)`).test(t)) return key;
  return null;
}

/** Seznam skupin pro AI prompt / JSON schéma (enum). */
export const MATERIAL_GROUP_KEYS: readonly MaterialGroupKey[] = MATERIAL_GROUP_ORDER;

export function materialGroupPromptList(): string {
  return MATERIAL_GROUP_ORDER.map((k) => `${k} = ${MATERIAL_GROUPS[k].label} (${MATERIAL_GROUPS[k].description})`).join("; ");
}

// ═════════════════════════════════════════════════════════════════════════
// Pomocné funkce textu
// ═════════════════════════════════════════════════════════════════════════

/** Malá písmena bez diakritiky; zachová délku řetězce (indexy sedí s originálem po NFC). */
export function fold(s: string): string {
  const n = s.normalize("NFC");
  let out = "";
  for (let i = 0; i < n.length; i++) {
    const ch = n[i];
    const f = ch.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
    out += f.length === 1 ? f : (f[0] ?? ch);
  }
  return out;
}

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function numFrom(s: string | undefined): number {
  return s ? Number(s.replace(",", ".")) : NaN;
}

// ═════════════════════════════════════════════════════════════════════════
// classifyMaterial
// ═════════════════════════════════════════════════════════════════════════

export type MaterialMatchSource = "oznaceni" | "obchodni_nazev" | "klicove_slovo" | "ai" | "zadny";

export interface MaterialClassification {
  group: MaterialGroupKey;
  label: string;
  subgroup: MaterialSubgroup | null;
  /** 0–1: 0,95 jednoznačné označení · 0,9 obchodní název · 0,75 klíčové slovo · 0,5 AI · 0 nic. */
  confidence: number;
  source: MaterialMatchSource;
  /** Úsek textu, který rozhodl. */
  matched: string;
  /** Uklizené označení („ČSN 19 552", „1.2379", „EN AW-6082", „42CrMo4"…), jinak "" . */
  normalizedDesignation: string;
  /** Hustota g/cm³ (podskupina má přednost). */
  density: number;
  /** true = hustota jen předpokládaná (neurčený materiál → ocel). */
  densityAssumed: boolean;
  /** Stav dodání / zpracování z označení („zušlechtěno (+QT)", „žíháno na měkko (+A)"…). */
  condition: string | null;
  /** Tvrdost uvedená u materiálu („28-32 HRC"). */
  hardness: string | null;
  /** Odlitek (GX…, GS-…, G20Mn5…). */
  cast: boolean;
}

interface Candidate {
  group: MaterialGroupKey;
  sub: MaterialSubgroup | null;
  conf: number;
  source: MaterialMatchSource;
  matched: string;
  normalized: string;
  index: number;
  cast?: boolean;
}

const S = MATERIAL_SUBGROUPS;

// ── W.Nr. (Werkstoffnummer) ──────────────────────────────────────────────
const DUPLEX_WNR = new Set(["4062", "4162", "4362", "4460", "4462", "4482", "4507", "4655", "4662"]);
const SUPER_DUPLEX_WNR = new Set(["4410", "4501", "4469", "4468"]);
const CEMENT_WNR = new Set(["7131", "7147", "7139", "7149", "6587", "5919", "6523", "7016", "5920", "5752", "7321", "7243", "6657", "0401", "1141", "1151"]);
const NITRID_WNR = new Set(["8519", "8550", "8509", "8523", "7361"]);
const SPRING_WNR = new Set(["8159", "7176", "5026", "7108", "7102", "8161"]);
const AUTOMAT_WNR = new Set(["0715", "0718", "0736", "0737", "0711", "0721", "0726", "0760"]);
const HOT_WORK_WNR = new Set(["2343", "2344", "2367", "2365", "2606", "2714", "2713", "2885", "2999", "2581", "2709"]);
const MOLD_WNR = new Set(["2311", "2312", "2738", "2083", "2316", "2085", "2162", "2764", "2767"]);
const LEDEBURIT_WNR = new Set(["2379", "2080", "2436", "2601", "2380", "2363"]);
/** Martenzitické / měkce martenzitické nerezi v řadě 1.43xx–1.45xx (jinak by vyšly jako austenit). */
const MARTENSITIC_WNR = new Set(["4313", "4418", "4528", "4405", "4414"]);
/** Austenit s Mo mimo řadu 1.44xx (1.4571, 904L 1.4539, 254 SMO 1.4547…). */
const AUST_MO_WNR = new Set(["4571", "4580", "4573", "4539", "4547", "4529", "4565", "4583"]);

function wnrCandidate(major: string, rest: string): { group: MaterialGroupKey; sub: MaterialSubgroup | null } | null {
  const n = Number(rest);
  if (major === "0") {
    if (rest[0] === "6") return { group: "litina", sub: S.litina_seda };
    if (rest[0] === "7") return { group: "litina", sub: S.litina_tvarna };
    if (rest[0] === "8") return { group: "litina", sub: S.litina_temper };
    return { group: "litina", sub: null };
  }
  if (major === "1") {
    if (n < 2000) {
      if (AUTOMAT_WNR.has(rest)) return { group: "bezna_ocel", sub: S.automatova };
      if (CEMENT_WNR.has(rest)) return { group: "bezna_ocel", sub: S.usle_uhlikova };
      if (n >= 1000) return { group: "bezna_ocel", sub: S.usle_uhlikova };
      if (n >= 330 && n <= 399) return { group: "bezna_ocel", sub: S.plech_ocel };
      return { group: "bezna_ocel", sub: null };
    }
    if (n < 3000) {
      if (HOT_WORK_WNR.has(rest)) return { group: "nastrojova_ocel", sub: S.nastr_tepla };
      if (MOLD_WNR.has(rest)) return { group: "nastrojova_ocel", sub: S.nastr_formy };
      if (LEDEBURIT_WNR.has(rest)) return { group: "nastrojova_ocel", sub: S.nastr_ledeburit };
      return { group: "nastrojova_ocel", sub: null };
    }
    if (n < 3500) return { group: "nastrojova_ocel", sub: S.hss };
    if (n < 3600) return { group: "zuslechtena_ocel", sub: S.lozyskova };
    if (n < 4000) return { group: "zuslechtena_ocel", sub: null };
    if (n < 5000) {
      if (SUPER_DUPLEX_WNR.has(rest)) return { group: "duplex", sub: S.super_duplex };
      if (DUPLEX_WNR.has(rest)) return { group: "duplex", sub: null };
      if (rest === "4542" || rest === "4548" || rest === "4545" || rest === "4534") return { group: "nerez", sub: S.nerez_ph };
      if (n < 4200 || MARTENSITIC_WNR.has(rest)) return { group: "nerez", sub: S.nerez_martenzit };
      if (n >= 4700) return { group: "nerez", sub: S.nerez_zaruvzdorna };
      if ((n >= 4400 && n < 4500) || AUST_MO_WNR.has(rest)) return { group: "nerez", sub: S.nerez_austenit_mo };
      return { group: "nerez", sub: S.nerez_austenit };
    }
    if (n < 9000) {
      if (CEMENT_WNR.has(rest)) return { group: "zuslechtena_ocel", sub: S.cementacni };
      if (NITRID_WNR.has(rest)) return { group: "zuslechtena_ocel", sub: S.nitridacni };
      if (SPRING_WNR.has(rest)) return { group: "zuslechtena_ocel", sub: S.pruzinova };
      return { group: "zuslechtena_ocel", sub: null };
    }
    return null;
  }
  if (major === "2") {
    if (n < 200) return { group: "med", sub: null };
    if (n < 800) return { group: "barevne_kovy", sub: S.mosaz };
    if (n < 900) return { group: "barevne_kovy", sub: S.mednikl };
    if (n < 1000) return { group: "barevne_kovy", sub: S.hlinikovy_bronz };
    if (n < 1200) return { group: "barevne_kovy", sub: S.bronz };
    if (n < 1300) {
      if (rest === "1247" || rest === "1245" || rest === "1285") return { group: "barevne_kovy", sub: S.berylliova_med };
      return { group: "med", sub: S.med_nizkolegovana };
    }
    if (n >= 2000 && n < 2300) return { group: "barevne_kovy", sub: S.zinek };
    if (n >= 3000 && n < 3300) return { group: "barevne_kovy", sub: S.olovo };
    if (n >= 4000 && n < 5000) {
      if (rest === "4360" || rest === "4375") return { group: "barevne_kovy", sub: S.monel };
      if (rest === "4819" || rest === "4602" || rest === "4617") return { group: "barevne_kovy", sub: S.hastelloy };
      return { group: "barevne_kovy", sub: S.niklova_slitina };
    }
    return { group: "barevne_kovy", sub: null };
  }
  if (major === "3") {
    if (n < 1000) return { group: "hlinik", sub: null };
    if (n < 2000) return { group: "hlinik", sub: S.al_dural };
    if (n < 3000) return { group: "hlinik", sub: n >= 2100 && n < 2600 && rest !== "2315" ? S.al_slevarensky : null };
    if (n < 4000) return { group: "hlinik", sub: S.al_5xxx };
    if (n < 5000) return { group: "hlinik", sub: S.al_7xxx };
    if (n < 6000) return { group: "barevne_kovy", sub: S.horcik };
    if (n >= 7000 && n < 8000) {
      return { group: "titan", sub: ["7025", "7035", "7055", "7065", "7235"].includes(rest) ? S.ti_cisty : S.ti_slitina };
    }
    return null;
  }
  return null;
}

// ── ČSN ──────────────────────────────────────────────────────────────────
const CSN_STATE: Record<string, string> = {
  "0": "bez tepelného zpracování (.0)",
  "1": "normalizačně žíháno (.1)",
  "2": "žíháno (.2)",
  "3": "žíháno na měkko (.3)",
  "4": "kaleno (.4)",
  "5": "normalizačně žíháno a popuštěno (.5)",
  "6": "zušlechtěno na dolní pevnost (.6)",
  "7": "zušlechtěno na střední pevnost (.7)",
  "8": "zušlechtěno na horní pevnost (.8)",
  "9": "stav dle dohody (.9)",
};

function csnSteelCandidate(cls: string, rest: string): { group: MaterialGroupKey; sub: MaterialSubgroup | null } | null {
  const code = cls + rest;
  switch (cls) {
    case "10":
      return { group: "bezna_ocel", sub: null };
    case "11":
      return { group: "bezna_ocel", sub: rest[0] === "1" ? S.automatova : null };
    case "12":
      return { group: "bezna_ocel", sub: S.usle_uhlikova };
    case "13":
      return { group: "zuslechtena_ocel", sub: /^13(2[4-9]|3)/.test(code) ? S.pruzinova : null };
    case "14":
      if (["14220", "14221", "14223", "14120", "14140"].includes(code)) return { group: "zuslechtena_ocel", sub: S.cementacni };
      if (["14109", "14209", "14100"].includes(code)) return { group: "zuslechtena_ocel", sub: S.lozyskova };
      if (code === "14340") return { group: "zuslechtena_ocel", sub: S.nitridacni };
      return { group: "zuslechtena_ocel", sub: null };
    case "15":
      if (["15260", "15261", "15230"].includes(code)) return { group: "zuslechtena_ocel", sub: code === "15230" ? null : S.pruzinova };
      if (["15330", "15340", "15320"].includes(code)) return { group: "zuslechtena_ocel", sub: S.nitridacni };
      if (["15124", "15123", "15115"].includes(code)) return { group: "zuslechtena_ocel", sub: S.cementacni };
      return { group: "zuslechtena_ocel", sub: null };
    case "16":
      if (["16220", "16420", "16520", "16326", "16231"].includes(code)) return { group: "zuslechtena_ocel", sub: S.cementacni };
      return { group: "zuslechtena_ocel", sub: null };
    case "17":
      if (rest[0] === "0" || rest[0] === "1") return { group: "nerez", sub: S.nerez_martenzit };
      if (["17251", "17253", "17255", "17125", "17153"].includes(code)) return { group: "nerez", sub: S.nerez_zaruvzdorna };
      if (["17346", "17347", "17348", "17349", "17350", "17352"].includes(code)) return { group: "nerez", sub: S.nerez_austenit_mo };
      return { group: "nerez", sub: S.nerez_austenit };
    case "19":
      if (rest[0] === "8") return { group: "nastrojova_ocel", sub: S.hss };
      if (["19573", "19436", "19437", "19572", "19571"].includes(code)) return { group: "nastrojova_ocel", sub: S.nastr_ledeburit };
      if (["19552", "19554", "19559", "19662", "19663", "19720", "19721"].includes(code)) return { group: "nastrojova_ocel", sub: S.nastr_tepla };
      if (["19520", "19521", "19523", "19541"].includes(code)) return { group: "nastrojova_ocel", sub: S.nastr_formy };
      return { group: "nastrojova_ocel", sub: null };
    default:
      return null;
  }
}

/**
 * ČSN 42 xxxx: 42 2xxx litiny, 42 3xxx barevné kovy, 42 4xxx hliník. Ostatní řady nejsou materiál —
 * 42 0xxx obecné normy, 42 5xxx–42 7xxx ROZMĚROVÉ normy hutních výrobků (42 5510 tyče kruhové,
 * 42 5522 ploché, 42 5310 plechy, 42 5715 trubky…) → null (rozhoduje jiné označení nebo AI).
 */
function csn42Candidate(rest: string): { group: MaterialGroupKey; sub: MaterialSubgroup | null; conf: number } | null {
  const n = Number(rest);
  if (n >= 2300 && n < 2400) return { group: "litina", sub: S.litina_tvarna, conf: 0.95 };
  if (n >= 2400 && n < 2500) return { group: "litina", sub: S.litina_seda, conf: 0.95 };
  if (n >= 2500 && n < 2600) return { group: "litina", sub: S.litina_temper, conf: 0.95 };
  if (n >= 2600 && n < 3000) return { group: "litina", sub: S.ocelolitina, conf: 0.9 };
  if (n >= 2000 && n < 2300) return { group: "litina", sub: null, conf: 0.8 };
  if (n >= 3000 && n < 3010) return { group: "med", sub: null, conf: 0.9 };
  if (n >= 3010 && n < 3200) return { group: "barevne_kovy", sub: S.bronz, conf: 0.85 };
  if (n >= 3200 && n < 3300) return { group: "barevne_kovy", sub: S.mosaz, conf: 0.9 };
  if (n >= 3300 && n < 4000) return { group: "barevne_kovy", sub: null, conf: 0.8 };
  if (n >= 4000 && n < 5000) return { group: "hlinik", sub: n >= 4200 && n < 4300 ? S.al_dural : null, conf: 0.9 };
  return null;
}

// ── EN chemické označení ─────────────────────────────────────────────────
const ELEMENTS = ["Cr", "Mo", "Ni", "Mn", "Si", "Co", "Ti", "Nb", "Cu", "Al", "Pb", "Se", "Zr", "Bi", "Ce", "Te", "V", "W", "B", "S", "N", "P"];

function splitElements(s: string): string[] | null {
  const out: string[] = [];
  let i = 0;
  const low = s.toLowerCase();
  while (i < low.length) {
    const two = ELEMENTS.find((e) => e.length === 2 && low.startsWith(e.toLowerCase(), i));
    if (two) { out.push(two); i += 2; continue; }
    const one = ELEMENTS.find((e) => e.length === 1 && low.startsWith(e.toLowerCase(), i));
    if (one) { out.push(one); i += 1; continue; }
    return null;
  }
  return out.length ? out : null;
}

function prettyChem(prefix: string, carbon: string, elems: string[], nums: string): string {
  return `${prefix}${carbon}${elems.join("")}${nums}`;
}

const TOOL_LOWALLOY = new Set([
  "90mncrv8", "115crv3", "100mncrw4", "40crmnmo7", "40crmnmos8-6", "40crmnnimo8-6-4", "21mncr5", "45nicrmo16",
  "60wcrv8", "60wcrv7", "50nicr13", "55nicrmov7", "56nimocrv7", "102cr6", "105wcr6", "107wcr5", "80crv2",
  "31crv3", "32crmov12-28", "145v33", "70mnmocr8", "35crmo8", "36crnimo16", "58sicr8",
]);
const CEMENT_LOWALLOY = new Set([
  "16mncr5", "20mncr5", "16mncrs5", "20mncrs5", "18crnimo7-6", "17crnimo6", "15crni6", "20nicrmo2-2", "21nicrmo2",
  "17cr3", "20mocr4", "14nicr14", "16nicr4", "18crmo4", "20crmo4", "20mocrs4", "17nicrmo6-4", "14nicrmo13-4", "18cr4",
]);
const NITRID_LOWALLOY = new Set(["31crmov9", "34cralni7", "41cralmo7", "34cralmo5", "15crmov6", "33crmov12-9"]);
const BEARING_LOWALLOY = new Set(["100cr6", "100crmn6", "100crmo7", "100crmo7-3", "100crmnsi6-4"]);
const SPRING_LOWALLOY = new Set(["51crv4", "55cr3", "54sicr6", "55si7", "60sicr7", "61sicr7", "38si7", "50crv4", "56si7", "52crmov4"]);

function lowAlloyCandidate(carbon: string, elems: string[], numsRaw: string): { group: MaterialGroupKey; sub: MaterialSubgroup | null; normalized: string } {
  const normalized = prettyChem("", carbon, elems, numsRaw);
  const key = normalized.toLowerCase();
  if (elems[0] === "S" || (elems[0] === "Mn" && elems.includes("S") && Number(carbon) <= 15) || (elems.includes("Pb") && elems.includes("S"))) {
    return { group: "bezna_ocel", sub: S.automatova, normalized };
  }
  if (TOOL_LOWALLOY.has(key)) return { group: "nastrojova_ocel", sub: null, normalized };
  if (CEMENT_LOWALLOY.has(key)) return { group: "zuslechtena_ocel", sub: S.cementacni, normalized };
  if (NITRID_LOWALLOY.has(key)) return { group: "zuslechtena_ocel", sub: S.nitridacni, normalized };
  if (BEARING_LOWALLOY.has(key)) return { group: "zuslechtena_ocel", sub: S.lozyskova, normalized };
  if (SPRING_LOWALLOY.has(key)) return { group: "zuslechtena_ocel", sub: S.pruzinova, normalized };
  return { group: "zuslechtena_ocel", sub: null, normalized };
}

const TOOL_HIGHALLOY = new Set(["x45nicrmo4", "x40cr14", "x38crmo16", "x33crs16", "x36crmo17", "x50crmov15", "x100crmov5", "x155crvmo12-1"]);

function highAlloyCandidate(carbonStr: string, elems: string[], numsRaw: string): { group: MaterialGroupKey; sub: MaterialSubgroup | null; normalized: string } {
  const normalized = prettyChem("X", carbonStr, elems, numsRaw);
  const key = normalized.toLowerCase();
  const carbon = Number(carbonStr);
  const nums = numsRaw.split("-").map(Number).filter((x) => !Number.isNaN(x));
  const content: Record<string, number> = {};
  // čísla patří postupně prvkům; prvky bez čísla (N, Ti…) mají 0 (stopové)
  elems.forEach((e, i) => { content[e] = nums[i] ?? 0; });
  const cr = content.Cr ?? 0;
  const ni = content.Ni ?? 0;
  if (TOOL_HIGHALLOY.has(key)) {
    return { group: "nastrojova_ocel", sub: key.startsWith("x100") || key.startsWith("x155") ? S.nastr_ledeburit : S.nastr_formy, normalized };
  }
  if (elems.includes("N") && cr >= 20 && ni <= 8) {
    return { group: "duplex", sub: cr >= 24 ? S.super_duplex : null, normalized };
  }
  if (carbon >= 140 && cr >= 10) return { group: "nastrojova_ocel", sub: S.nastr_ledeburit, normalized };
  if (cr >= 10.5 && carbon <= 120) {
    if (ni >= 6 || (content.Mn ?? 0) >= 5) {
      const sub = cr >= 20 && ni >= 12 ? S.nerez_zaruvzdorna : (content.Mo ?? 0) >= 2 ? S.nerez_austenit_mo : S.nerez_austenit;
      return { group: "nerez", sub, normalized };
    }
    if (elems.includes("Cu") && ni >= 3) return { group: "nerez", sub: S.nerez_ph, normalized };
    return { group: "nerez", sub: S.nerez_martenzit, normalized };
  }
  if (carbon >= 30 && cr >= 2.5 && (elems.includes("Mo") || elems.includes("V") || elems.includes("W"))) {
    return { group: "nastrojova_ocel", sub: carbon >= 80 ? S.nastr_ledeburit : S.nastr_tepla, normalized };
  }
  if ((content.Mn ?? 0) >= 10) return { group: "zuslechtena_ocel", sub: S.manganova, normalized };
  return { group: "zuslechtena_ocel", sub: null, normalized };
}

// ── AISI / SAE / bez prefixu ─────────────────────────────────────────────
const AISI_STAINLESS_3 = new Set(["201", "202", "301", "302", "303", "304", "305", "309", "310", "314", "316", "317", "321", "329", "347", "403", "405", "409", "410", "414", "416", "420", "430", "431", "434", "440", "444", "446", "630", "631", "904"]);
const AISI_TOOL = new Set(["D2", "D3", "D6", "D7", "A2", "A6", "A8", "A10", "O1", "O2", "O6", "H10", "H11", "H12", "H13", "H19", "H21", "M2", "M3", "M4", "M7", "M35", "M42", "P20", "P21", "S1", "S5", "S7", "L6", "W1", "T1", "T15", "CPM10V"]);
const DUPLEX_NUM = new Set(["2205", "2304", "2507", "2101", "2003", "2404"]);
const AL_BARE = new Set(["1050", "1060", "1070", "1100", "1200", "2007", "2011", "2014", "2017", "2024", "2030", "3003", "3103", "3105", "5005", "5052", "5083", "5086", "5754", "5182", "6005", "6012", "6026", "6060", "6061", "6063", "6082", "6101", "6262", "7010", "7020", "7021", "7022", "7050", "7075", "7175"]);
const STEEL_BARE_4 = new Set(["1008", "1010", "1015", "1018", "1020", "1035", "1040", "1045", "1050", "1060", "1080", "1095", "1117", "1141", "1144", "1212", "1213", "1215", "4130", "4135", "4137", "4140", "4142", "4145", "4150", "4320", "4340", "4620", "4820", "5140", "5160", "6150", "8620", "8640", "9260", "9310"]);

function aisiNumCandidate(num: string, suffix: string): { group: MaterialGroupKey; sub: MaterialSubgroup | null } | null {
  if (num.length === 3) {
    if (!AISI_STAINLESS_3.has(num)) return null;
    if (num === "630" || num === "631") return { group: "nerez", sub: S.nerez_ph };
    if (num === "329") return { group: "duplex", sub: null };
    if (num[0] === "4") return { group: "nerez", sub: S.nerez_martenzit };
    if (num === "309" || num === "310" || num === "314") return { group: "nerez", sub: S.nerez_zaruvzdorna };
    if (num === "316" || num === "317" || num === "904") return { group: "nerez", sub: S.nerez_austenit_mo };
    return { group: "nerez", sub: S.nerez_austenit };
  }
  if (DUPLEX_NUM.has(num)) return { group: "duplex", sub: num === "2507" ? S.super_duplex : null };
  if (num.length === 4 || num.length === 5) {
    const p2 = num.slice(0, 2);
    if (num === "52100") return { group: "zuslechtena_ocel", sub: S.lozyskova };
    if (["10", "11", "12", "15"].includes(p2) || /^12l/i.test(num + suffix)) {
      return { group: "bezna_ocel", sub: ["11", "12"].includes(p2) ? S.automatova : null };
    }
    if (["13", "40", "41", "43", "44", "46", "47", "48", "50", "51", "52", "61", "81", "86", "87", "88", "92", "93", "94", "98"].includes(p2)) {
      const cem = ["8620", "8617", "8622", "4320", "4620", "4820", "9310", "4118", "5120"].includes(num);
      return { group: "zuslechtena_ocel", sub: cem ? S.cementacni : num === "9260" || num === "5160" ? S.pruzinova : null };
    }
  }
  return null;
}

function alSeriesSub(series: string): MaterialSubgroup | null {
  switch (series[0]) {
    case "2": return S.al_dural;
    case "5": return S.al_5xxx;
    case "7": return S.al_7xxx;
    case "4": return S.al_slevarensky;
    default: return null;
  }
}

// ── UNS ──────────────────────────────────────────────────────────────────
const UNS_DUPLEX = new Set(["31803", "32205", "32750", "32760", "32304", "32101", "32550", "32520", "32906", "32707", "39274", "31260", "32003", "32404"]);

function unsCandidate(letter: string, digits: string): { group: MaterialGroupKey; sub: MaterialSubgroup | null } | null {
  const n = Number(digits);
  switch (letter) {
    case "S":
      if (UNS_DUPLEX.has(digits)) return { group: "duplex", sub: ["32750", "32760", "32520", "32550", "32707", "39274"].includes(digits) ? S.super_duplex : null };
      if (digits.startsWith("174") || digits.startsWith("155") || digits.startsWith("138")) return { group: "nerez", sub: S.nerez_ph };
      if (digits[0] === "4") return { group: "nerez", sub: S.nerez_martenzit };
      if (digits[0] === "2" || digits[0] === "3") return { group: "nerez", sub: S.nerez_austenit };
      return { group: "nerez", sub: null };
    case "N":
      if (digits.startsWith("04")) return { group: "barevne_kovy", sub: S.monel };
      if (digits.startsWith("10")) return { group: "barevne_kovy", sub: S.hastelloy };
      return { group: "barevne_kovy", sub: S.niklova_slitina };
    case "R":
      if (digits.startsWith("5")) return { group: "titan", sub: digits.startsWith("50") ? S.ti_cisty : S.ti_slitina };
      return null;
    case "C":
      if (n < 16000) return { group: "med", sub: null };
      if (n < 50000) return { group: "barevne_kovy", sub: S.mosaz };
      if (n < 60000) return { group: "barevne_kovy", sub: S.bronz };
      if (n < 65000) return { group: "barevne_kovy", sub: S.hlinikovy_bronz };
      if (n < 70000) return { group: "barevne_kovy", sub: S.bronz };
      if (n < 73000) return { group: "barevne_kovy", sub: S.mednikl };
      if (n < 80000) return { group: "barevne_kovy", sub: S.alpaka };
      return { group: "barevne_kovy", sub: S.bronz };
    case "A":
      return { group: "hlinik", sub: digits[0] === "9" ? alSeriesSub(digits.slice(1)) : null };
    case "G":
      return aisiNumCandidate(digits.slice(0, 4), "") ?? { group: "zuslechtena_ocel", sub: null };
    default:
      return null;
  }
}

// ── EN měď (EN 1412: písmeno za číslem) ──────────────────────────────────
function enCopperCandidate(letter: string): { group: MaterialGroupKey; sub: MaterialSubgroup | null } {
  switch (letter) {
    case "A": return { group: "med", sub: null };
    case "B": case "C": case "D": case "E": return { group: "med", sub: S.med_nizkolegovana };
    case "G": return { group: "barevne_kovy", sub: S.hlinikovy_bronz };
    case "H": return { group: "barevne_kovy", sub: S.mednikl };
    case "J": return { group: "barevne_kovy", sub: S.alpaka };
    case "K": return { group: "barevne_kovy", sub: S.bronz };
    case "L": case "M": case "N": case "P": case "R": case "S": return { group: "barevne_kovy", sub: S.mosaz };
    default: return { group: "barevne_kovy", sub: null };
  }
}

function cuChemCandidate(el: string): { group: MaterialGroupKey; sub: MaterialSubgroup | null } {
  switch (el.toLowerCase()) {
    case "zn": return { group: "barevne_kovy", sub: S.mosaz };
    case "sn": case "pb": case "si": case "mn": return { group: "barevne_kovy", sub: S.bronz };
    case "al": return { group: "barevne_kovy", sub: S.hlinikovy_bronz };
    case "ni": return { group: "barevne_kovy", sub: S.mednikl };
    case "be": case "co": return { group: "barevne_kovy", sub: S.berylliova_med };
    default: return { group: "med", sub: S.med_nizkolegovana };
  }
}

// ── Obchodní názvy a klíčová slova (porovnává se s fold textem) ──────────
interface WordRule { re: RegExp; group: MaterialGroupKey; sub?: MaterialSubgroup; conf: number; source: MaterialMatchSource; name?: string }

const TRADE_RULES: WordRule[] = [
  // nástrojové oceli
  { re: /\b(?:bohler|boehler)\s*([kwms]\d{3})\b/, group: "nastrojova_ocel", conf: 0.92, source: "obchodni_nazev" },
  { re: /(?<![a-z\d])(k1[01]0|k105|k3[0-9]0|k353|k455|k460|k600|k720|k890|w30[0-3]|w32[01]|w350|w36[01]|w40[03]|m20[01]|m238|m26[18]|m3[0-9]0|m31[45]|m333|m368|m461|s290|s390|s590|s600|s705|s790)(?![a-z\d])/, group: "nastrojova_ocel", conf: 0.85, source: "obchodni_nazev" },
  { re: /\b(arne|calmax|caldie|rigor|sleipner|sverker\s?\d*|vanadis\s?\d*\w?|vancron\s?\d*|orvar(?:\s?(?:supreme|2m))?|dievar|qro\s?90|vidar|unimax|impax(?:\s?supreme)?|nimax|holdax|ramax|stavax(?:\s?esr)?|mirrax|corrax|elmax|polmax|royalloy|formvar|alvar|uddeholm)\b/, group: "nastrojova_ocel", conf: 0.9, source: "obchodni_nazev" },
  { re: /\b(toolox\s?\d*|thyrodur\s?\d*|thyroplast\s?\d*|thyrotherm\s?\d*|cryodur\s?\d*|formadur\s?\d*|silberstahl|cpm\s?\d*v?|asp\s?20\d\d|pm\s?(?:23|30|60))\b/, group: "nastrojova_ocel", conf: 0.9, source: "obchodni_nazev" },
  { re: /\b(hss(?:-e|-co|-pm)?|rychlorez\w*|high[\s-]speed\s+steel|schnellarbeitsstahl)\b/, group: "nastrojova_ocel", sub: S.hss, conf: 0.85, source: "klicove_slovo" },
  // otěruvzdorné / vysokopevné plechy
  { re: /\b(hardox\s?\d*|weldox\s?\d*|strenx\s?\d*|xar\s?\d{3}|raex\s?\d{3}|dillidur\s?\d*|quard\s?\d*)\b/, group: "zuslechtena_ocel", sub: S.oteruvzdorna, conf: 0.9, source: "obchodni_nazev" },
  { re: /\b(domex\s?\d*|docol\s?\d*)\b/, group: "bezna_ocel", sub: S.plech_ocel, conf: 0.85, source: "obchodni_nazev" },
  // duplex
  { re: /\b(super[\s-]?duplex|zeron\s?100|saf\s?2507|ferralium\s?255)\b/, group: "duplex", sub: S.super_duplex, conf: 0.92, source: "obchodni_nazev" },
  { re: /\b(duplex\w*|saf\s?2205|saf\s?2304|ldx\s?2101|lean\s+duplex)\b/, group: "duplex", conf: 0.88, source: "klicove_slovo" },
  // nerez (obchodní)
  { re: /\b(17-4\s?ph|15-5\s?ph|13-8\s?(?:ph|mo)|17-7\s?ph)\b/, group: "nerez", sub: S.nerez_ph, conf: 0.92, source: "obchodni_nazev" },
  { re: /\b(v2a|v4a|nirosta|remanit\s?\d*)\b/, group: "nerez", conf: 0.88, source: "obchodni_nazev" },
  { re: /\ba[24]\s?-\s?(?:50|70|80)\b/, group: "nerez", sub: S.nerez_austenit, conf: 0.85, source: "obchodni_nazev" },
  // niklové slitiny
  { re: /\bmonel\s?(?:k-?)?\d*\b/, group: "barevne_kovy", sub: S.monel, conf: 0.95, source: "obchodni_nazev" },
  { re: /\bhastelloy\s?[a-z]?-?\d*\b/, group: "barevne_kovy", sub: S.hastelloy, conf: 0.97, source: "obchodni_nazev" },
  { re: /\b(inconel\s?\d*|incoloy\s?\d*|nimonic\s?\d*|waspaloy|haynes\s?\d*|udimet\s?\d*|alloy\s?(?:600|601|617|625|690|718|725|800h?t?|825|x-?750|c-?276|c-?22|c-?2000|b-?2|400|k-?500|59)\b)/, group: "barevne_kovy", sub: S.niklova_slitina, conf: 0.97, source: "obchodni_nazev" },
  // měď a slitiny
  { re: /\b(e-?cu\w*|se-?cu|sf-?cu|of-?cu|cu-?etp|cu-?ofe?|cu-?dhp|cu-?hcp|cu-?phc|cu-?frhc|cu-?dlp|cu\s?99(?:[.,]\d+)?)\b/, group: "med", conf: 0.95, source: "oznaceni" },
  { re: /\b(elmedur\s?\w*|cucrzr|cucr1zr|cucr1)\b/, group: "med", sub: S.med_nizkolegovana, conf: 0.93, source: "obchodni_nazev" },
  { re: /\bms\s?(?:5[6-9]|6[0-3]|70|72)\b/, group: "barevne_kovy", sub: S.mosaz, conf: 0.92, source: "oznaceni" },
  { re: /\b(rg\s?(?:4|5|7|10)|g-?bz\s?\d+|gbz\d+|ampco\s?\d*|ampcoloy\s?\d*)\b/, group: "barevne_kovy", sub: S.bronz, conf: 0.9, source: "obchodni_nazev" },
  { re: /\b(zamak\s?\d*|znal\d+cu\d*)\b/, group: "barevne_kovy", sub: S.zinek, conf: 0.9, source: "obchodni_nazev" },
  { re: /\b(az31\w?|az91\w?|am60\w?|ze41\w?)\b/, group: "barevne_kovy", sub: S.horcik, conf: 0.9, source: "oznaceni" },
  { re: /\b(densimet\s?\d*|inermet\s?\d*|wolfram(?!\w*[kc]arbid)\w*|tungsten(?!\s+carbide))\b/, group: "barevne_kovy", sub: S.wolfram, conf: 0.85, source: "klicove_slovo" },
  { re: /\b(molybden\w*|molybdenum|tzm)\b/, group: "barevne_kovy", sub: S.molybden, conf: 0.85, source: "klicove_slovo" },
  // hliník (obchodní)
  { re: /\b(certal|fortal|alumec\s?\d*|ergal|avional|perunal\s?\d*|anticorodal\s?\d*|contal|alca\s?(?:plus|5)|hokotol|weldural|unidal|ecodal)\b/, group: "hlinik", conf: 0.9, source: "obchodni_nazev" },
  { re: /\b(dural(?:umin\w*)?)\b/, group: "hlinik", sub: S.al_dural, conf: 0.9, source: "obchodni_nazev" },
  // titan
  { re: /\b(ti\s?-?6al\s?-?4v(?:\s?eli)?|tial6v4|ti\s?6-4)\b/, group: "titan", sub: S.ti_slitina, conf: 0.97, source: "oznaceni" },
  { re: /\b(?:ti(?:tan\w*)?|titanium)\s*(?:gr(?:ade)?\.?\s?|g)(1|2|3|4|5|7|9|12|23)\b/, group: "titan", conf: 0.97, source: "oznaceni", name: "ti-grade" },
  // slinutý karbid
  { re: /\b(slinut\w*\s+karbid\w*|wolfram[kc]arbid\w*|tvrdokov\w*|hartmetall\w*|(?:cemented|tungsten)\s+carbide|wc\s?[-/]?\s?co\b|widia|karbid\s+wolfram\w*)/, group: "slinuty_karbid", conf: 0.92, source: "klicove_slovo" },
  { re: /(?<![a-z\d])(gt\s?(?:10|15|20|30|40|55)|cts\s?\d{2}\w?|h10f|h6f)(?![a-z\d])/, group: "slinuty_karbid", conf: 0.85, source: "obchodni_nazev" },
  // litina (slovy)
  { re: /\b(ocelolit\w*|stahlguss|cast\s+steel|gs-?\d{2}(?:-\d)?)\b/, group: "litina", sub: S.ocelolitina, conf: 0.85, source: "klicove_slovo" },
  { re: /\b(tvarn\w*\s+litin\w*|sphaeroguss|spharoguss|ductile\s+iron|nodular\s+iron)\b/, group: "litina", sub: S.litina_tvarna, conf: 0.85, source: "klicove_slovo" },
  { re: /\b(sed\w*\s+litin\w*|grauguss|grey\s+(?:cast\s+)?iron|gray\s+(?:cast\s+)?iron|meehanite)\b/, group: "litina", sub: S.litina_seda, conf: 0.85, source: "klicove_slovo" },
  { re: /\b(litin\w*|gusseisen|cast\s+iron)\b/, group: "litina", conf: 0.78, source: "klicove_slovo" },
  // plasty (zkratky a obchodní názvy)
  { re: /(?<![a-z\d])(pom(?:-?[ch])?|delrin|hostaform|ertacetal|tecaform|sustarin\s?\w?|polyacetal|polyoxymethylen\w*)(?![a-z\d])/, group: "plasty", sub: S.pom, conf: 0.9, source: "oznaceni" },
  { re: /(?<![a-z\d])(pa\s?6(?:[.,]?6|g|\s?g|12)?|pa\s?12|pa\s?11|pa\s?46|ertalon\s?\w*|nylatron\s?\w*|tecamid\s?\w*|silon|polyamid\w*|nylon)(?![a-z\d])/, group: "plasty", sub: S.pa, conf: 0.9, source: "oznaceni" },
  { re: /(?<![a-z\d])(pe-?uhmw|uhmw-?pe|uhmwpe|pe\s?1000|pe\s?500|pe-?hmw)(?![a-z\d])/, group: "plasty", sub: S.pe_uhmw, conf: 0.9, source: "oznaceni" },
  { re: /(?<![a-z\d])(pe(?:-?hd|-?ld|\s?300)?|hdpe|ldpe|polyethylen\w*|polyethylene)(?![a-z\d])/, group: "plasty", sub: S.pe, conf: 0.85, source: "oznaceni" },
  { re: /(?<![a-z\d])(ptfe|teflon\w*|tecaflon)(?![a-z\d])/, group: "plasty", sub: S.ptfe, conf: 0.9, source: "oznaceni" },
  { re: /(?<![a-z\d])(peek(?:-?gf30|-?cf30)?|ketron\s?\w*|tecapeek\s?\w*)(?![a-z\d])/, group: "plasty", sub: S.peek, conf: 0.9, source: "oznaceni" },
  { re: /(?<![a-z\d])(pvc(?:-?[uc])?|novodur)(?![a-z\d])/, group: "plasty", sub: S.pvc, conf: 0.88, source: "oznaceni" },
  { re: /(?<![a-z\d])(pmma|plexi\w*|acrylglas|perspex)(?![a-z\d])/, group: "plasty", sub: S.pmma, conf: 0.88, source: "oznaceni" },
  { re: /(?<![a-z\d])(pc|lexan|makrolon|polykarbonat\w*|polycarbonat\w*)(?![a-z\d])/, group: "plasty", sub: S.pc, conf: 0.85, source: "oznaceni" },
  { re: /(?<![a-z\d])(pet-?p?|petp|ertalyte\s?\w*)(?![a-z\d])/, group: "plasty", sub: S.pet, conf: 0.85, source: "oznaceni" },
  { re: /(?<![a-z\d])(pvdf|kynar)(?![a-z\d])/, group: "plasty", sub: S.pvdf, conf: 0.88, source: "oznaceni" },
  { re: /(?<![a-z\d])(pp(?:-?h|-?c)?|polypropylen\w*)(?![a-z\d])/, group: "plasty", sub: S.pp, conf: 0.85, source: "oznaceni" },
  { re: /(?<![a-z\d])(abs)(?![a-z\d])/, group: "plasty", sub: S.abs, conf: 0.85, source: "oznaceni" },
  { re: /(?<![a-z\d])(pur|polyuretan\w*|vulkollan)(?![a-z\d])/, group: "plasty", sub: S.pur, conf: 0.8, source: "oznaceni" },
  { re: /(?<![a-z\d])(pei|ultem)(?![a-z\d])/, group: "plasty", sub: S.pei, conf: 0.88, source: "oznaceni" },
  { re: /(?<![a-z\d])(pps|techtron)(?![a-z\d])/, group: "plasty", sub: S.pps, conf: 0.88, source: "oznaceni" },
  { re: /(?<![a-z\d])(sklotextit\w*|g-?10|fr-?4|hgw\s?2372)(?![a-z\d])/, group: "plasty", sub: S.sklotextit, conf: 0.85, source: "oznaceni" },
  { re: /(?<![a-z\d])(textit\w*|tvrzen\w*\s+tkanin\w*|novotex|hgw\s?2082|bakelit\w*|pertinax|turbotex)(?![a-z\d])/, group: "plasty", sub: S.textit, conf: 0.85, source: "obchodni_nazev" },
  // ostatní nekovy
  { re: /\b(grafit\w*|graphit\w*|graphite)\b/, group: "ostatni", sub: S.grafit, conf: 0.85, source: "klicove_slovo" },
  { re: /\b(keramik\w*|ceramic\w*|al2o3|zro2|oxid\s+hlinit\w*|korund|karbid\s+kremik\w*|sic|si3n4)\b/, group: "ostatni", sub: S.keramika, conf: 0.85, source: "klicove_slovo" },
  { re: /\b(pryz\w*|guma|gumov\w*|rubber|gummi|epdm|nbr|fkm|viton|silikon\w*)\b/, group: "ostatni", sub: S.pryz, conf: 0.8, source: "klicove_slovo" },
  { re: /\b(drev\w*|wood|holz|preklizk\w*)\b/, group: "ostatni", sub: S.drevo, conf: 0.8, source: "klicove_slovo" },
  { re: /\b(sklo|glass|glas)\b/, group: "ostatni", sub: S.sklo, conf: 0.8, source: "klicove_slovo" },
];

/** Obecná klíčová slova — slabší než označení. */
const KEYWORD_RULES: WordRule[] = [
  { re: /\b(nerez\w*|korozivzdorn\w*|stainless|inox\w*|edelstahl|rostfrei\w*|nichtrostend\w*)\b/, group: "nerez", conf: 0.78, source: "klicove_slovo" },
  { re: /\b(nastrojov\w*\s+ocel\w*|nastrojarsk\w*\s+ocel\w*|tool\s+steel|werkzeugstahl|kaltarbeitsstahl|warmarbeitsstahl)\b/, group: "nastrojova_ocel", conf: 0.78, source: "klicove_slovo" },
  { re: /\b(cementacni\s+ocel\w*|einsatzstahl|case[\s-]hardening\s+steel)\b/, group: "zuslechtena_ocel", sub: S.cementacni, conf: 0.75, source: "klicove_slovo" },
  { re: /\b(nitridacni\s+ocel\w*|nitrierstahl)\b/, group: "zuslechtena_ocel", sub: S.nitridacni, conf: 0.75, source: "klicove_slovo" },
  { re: /\b(zuslecht\w*\s+ocel\w*|zuslechtovaci\s+ocel\w*|legovan\w*\s+ocel\w*|vergutungsstahl|alloy\s+steel|qt\s+steel|ocel\s+qt)\b/, group: "zuslechtena_ocel", conf: 0.75, source: "klicove_slovo" },
  { re: /\b(automatov\w*\s+ocel\w*|automatenstahl|free[\s-]cutting\s+steel)\b/, group: "bezna_ocel", sub: S.automatova, conf: 0.75, source: "klicove_slovo" },
  { re: /\b(hlinik\w*|alumin(?:ium|um)\w*|alu)\b/, group: "hlinik", conf: 0.78, source: "klicove_slovo" },
  { re: /\b(mosaz\w*|messing|brass)\b/, group: "barevne_kovy", sub: S.mosaz, conf: 0.8, source: "klicove_slovo" },
  { re: /\b(bronz\w*|bronze)\b/, group: "barevne_kovy", sub: S.bronz, conf: 0.8, source: "klicove_slovo" },
  { re: /\b(med|medi|medeny|copper|kupfer)\b/, group: "med", conf: 0.78, source: "klicove_slovo" },
  { re: /\b(nikl\w*\s+slitin\w*|nickel\s+alloy|nickelbasis\w*|nickel[\s-]base)\b/, group: "barevne_kovy", sub: S.niklova_slitina, conf: 0.78, source: "klicove_slovo" },
  { re: /\b(horcik\w*|magnesium|magnezium)\b/, group: "barevne_kovy", sub: S.horcik, conf: 0.78, source: "klicove_slovo" },
  { re: /\b(zinek|zinc\s+alloy|zinkdruckguss)\b/, group: "barevne_kovy", sub: S.zinek, conf: 0.7, source: "klicove_slovo" },
  { re: /\b(barevn\w*\s+kov\w*|nezelezn\w*\s+kov\w*|non-?ferrous|buntmetall)\b/, group: "barevne_kovy", conf: 0.72, source: "klicove_slovo" },
  { re: /\b(titan\w*)\b/, group: "titan", conf: 0.8, source: "klicove_slovo" },
  { re: /\b(plast\w*|kunststoff\w*|polymer\w*)\b/, group: "plasty", conf: 0.72, source: "klicove_slovo" },
  { re: /\b(karbid\w*|carbide|hm)\b/, group: "slinuty_karbid", conf: 0.72, source: "klicove_slovo" },
  { re: /\b(konstrukcn\w*\s+ocel\w*|baustahl|structural\s+steel|mild\s+steel|carbon\s+steel|uhlikov\w*\s+ocel\w*)\b/, group: "bezna_ocel", conf: 0.7, source: "klicove_slovo" },
  { re: /\b(ocel\w*|steel|stahl)\b/, group: "bezna_ocel", conf: 0.55, source: "klicove_slovo" },
];

// ── Stav (+QT, zušlechtěno, kaleno…) ─────────────────────────────────────
const PLUS_STATES: Record<string, string> = {
  QT: "zušlechtěno (+QT)", Q: "kaleno (+Q)", QL: "zušlechtěno (+QL)", N: "normalizačně žíháno (+N)",
  NT: "normalizováno a popuštěno (+NT)", A: "žíháno na měkko (+A)", AC: "žíháno na kulový perlit (+AC)",
  C: "taženo za studena (+C)", SH: "loupáno (+SH)", SR: "žíháno ke snížení pnutí (+SR)", AR: "válcováno (+AR)",
  AT: "rozpouštěcí žíhání (+AT)", T: "popuštěno (+T)", U: "bez tepelného zpracování (+U)", M: "termomechanicky válcováno (+M)",
};

const BARE_SYMBOLS: Record<string, { group: MaterialGroupKey; sub: MaterialSubgroup | null; norm: string }> = {
  al: { group: "hlinik", sub: null, norm: "Al" }, alu: { group: "hlinik", sub: null, norm: "Al" },
  cu: { group: "med", sub: null, norm: "Cu" }, ms: { group: "barevne_kovy", sub: S.mosaz, norm: "Ms" },
  ti: { group: "titan", sub: null, norm: "Ti" }, mg: { group: "barevne_kovy", sub: S.horcik, norm: "Mg" },
  pa: { group: "plasty", sub: S.pa, norm: "PA" }, ni: { group: "barevne_kovy", sub: S.nikl, norm: "Ni" },
};

function detectCondition(t: string, f: string): { condition: string | null; qt: boolean } {
  const plus = t.match(/\+\s?(QT|QL|NT|AC|SH|SR|AR|AT|Q|N|A|C|T|U|M)(?![A-Za-z])/);
  if (plus) {
    const k = plus[1].toUpperCase();
    return { condition: PLUS_STATES[k] ?? `+${k}`, qt: k === "QT" || k === "QL" };
  }
  if (/\bzuslecht\w*|\bzusl\.|\bvergut\w*|quenched\s+(?:and|&)\s+tempered|\bq\s?\+\s?t\b|\bqt\b|\bq&t\b/.test(f)) {
    return { condition: "zušlechtěno", qt: true };
  }
  if (/\b(?:za)?kalen[aoy]?\b|\bgehartet\b|\bhardened\b/.test(f)) return { condition: "kaleno", qt: false };
  if (/zihan\w*\s+na\s+mekko|weichgegluht|soft[\s-]annealed/.test(f)) return { condition: "žíháno na měkko", qt: false };
  if (/normaliz\w*|normalgegluht|normali[sz]ed/.test(f)) return { condition: "normalizačně žíháno", qt: false };
  if (/\btazen\w*\b|\bgezogen\b|cold[\s-]drawn/.test(f)) return { condition: "taženo za studena", qt: false };
  return { condition: null, qt: false };
}

/**
 * Zařadí materiál do skupiny pro rychlý přehled.
 * @param designation označení z výkresu („1.2379", „ČSN 15 142.6", „42CrMo4+QT", „EN AW-6082 T6", „nerez"…)
 * @param aiGroup skupina navržená AI — použije se jen, když z označení nic jednoznačného nevyplývá
 */
export function classifyMaterial(designation: string | null | undefined, aiGroup?: string | null): MaterialClassification {
  const raw = (designation ?? "").normalize("NFKC").replace(/[‐-―−]/g, "-").replace(/ /g, " ").trim();
  // „11 SMnPb 30", „42 CrMo 4" (mezery uvnitř EN chemického označení) → „11SMnPb30", „42CrMo4"
  const t = raw.replace(/(?<![A-Za-z\d.,])(\d{1,3})\s+([A-Z][a-z]?(?:[A-Z][a-z]?){0,4})\s+(\d{1,3}(?:-\d{1,2}){0,3})(?![A-Za-z\d])/g,
    (all, c: string, el: string, n: string) => (splitElements(el) ? `${c}${el}${n}` : all));
  const f = fold(t);
  let csnCondition: string | null = null;
  let csnQt = false;
  const cands: Candidate[] = [];
  const add = (c: Omit<Candidate, "index"> & { index?: number }) => cands.push({ index: 0, ...c });

  if (t) {
    // Odlitky: GX… → nerez/duplex/nástrojová dle zbytku; GS-…, G20Mn5, GP240GH → ocelolitina
    for (const m of t.matchAll(/(?<![A-Za-z\d])G-?(X\d{1,3}[A-Za-z][A-Za-z\d-]*)/g)) {
      const inner = classifyMaterial(m[1]);
      if (inner.confidence >= 0.9) {
        add({ group: inner.group, sub: inner.subgroup, conf: 0.95, source: "oznaceni", matched: m[0], normalized: `G${inner.normalizedDesignation}`, index: m.index ?? 0, cast: true });
      }
    }
    for (const m of t.matchAll(/(?<![A-Za-z\d])(?:GS-?(?:C)?\d{2}[A-Za-z\d-]*|G\d{2,3}(?:Mn|Cr|Mo|Ni)[A-Za-z\d-]*|GP\d{3}[A-Za-z]*)(?![A-Za-z\d])/g)) {
      add({ group: "litina", sub: S.ocelolitina, conf: 0.95, source: "oznaceni", matched: m[0], normalized: m[0].toUpperCase().replace(/MN/g, "Mn").replace(/CR/g, "Cr"), index: m.index ?? 0, cast: true });
    }

    // W.Nr.
    for (const m of t.matchAll(/(?<![\d.,A-Za-z])([0-3])[.,]\s?(\d{4})(?![\d])/g)) {
      const c = wnrCandidate(m[1], m[2]);
      if (c) add({ ...c, conf: 0.95, source: "oznaceni", matched: m[0], normalized: `${m[1]}.${m[2]}`, index: m.index ?? 0 });
    }

    // ČSN oceli 10–17, 19 (s volitelným doplňkovým číslem .6 atd.)
    for (const m of t.matchAll(/(?<![\d.,A-Za-z])(?<!(?:EN|DIN|ISO|ASTM|IEC|EN ISO)\s?)(1[0-79])\s?(\d{3})(?:\s?[.,]\s?(\d))?(?:[.,]\d)?(?![\d])/gi)) {
      const c = csnSteelCandidate(m[1], m[2]);
      if (!c) continue;
      let { group, sub } = c;
      const state = m[3];
      if (state && ["6", "7", "8"].includes(state) && group === "bezna_ocel") { group = "zuslechtena_ocel"; sub = null; }
      // Doplňkové číslo = stav TZ (ČSN 42 0002) u tříd 10–16 a 19; u nerezi (17) má jiný význam
      if (state && m[1] !== "17" && !csnCondition) {
        csnCondition = CSN_STATE[state] ?? null;
        csnQt = ["6", "7", "8"].includes(state) && m[1] !== "19";
      }
      add({ group, sub, conf: 0.95, source: "oznaceni", matched: m[0], normalized: `ČSN ${m[1]} ${m[2]}${state ? `.${state}` : ""}`, index: m.index ?? 0 });
    }
    // ČSN 41 xxxx (norma materiálu: 41 5142 = ocel 15 142)
    for (const m of t.matchAll(/(?:ČSN|CSN)\s?41\s?([0-79])(\d{3})(?![\d])/gi)) {
      const c = csnSteelCandidate(`1${m[1]}`, m[2]);
      if (c) add({ ...c, conf: 0.95, source: "oznaceni", matched: m[0], normalized: `ČSN 1${m[1]} ${m[2]}`, index: m.index ?? 0 });
    }
    // ČSN 42 xxxx (litiny, barevné kovy)
    for (const m of t.matchAll(/(?<![\d.,A-Za-z])42\s?(\d{4})(?:[.,]\d{1,2})?(?![\d])/g)) {
      const c = csn42Candidate(m[1]);
      if (!c) continue;
      add({ group: c.group, sub: c.sub, conf: c.conf, source: "oznaceni", matched: m[0], normalized: `ČSN 42 ${m[1]}`, index: m.index ?? 0 });
    }

    // EN vysokolegované X…
    for (const m of t.matchAll(/(?<![A-Za-z\d])X\s?(\d{1,3})([A-Za-z]{1,12}?)(\d{1,3}(?:[.,]\d)?(?:-\d{1,2}){0,4})(?![\d])/gi)) {
      const elems = splitElements(m[2]);
      if (!elems) continue;
      const c = highAlloyCandidate(m[1], elems, m[3]);
      add({ ...c, conf: 0.95, source: "oznaceni", matched: m[0], index: m.index ?? 0 });
    }
    // HSS HS6-5-2(-5)
    for (const m of t.matchAll(/(?<![A-Za-z\d])HS\s?(\d{1,2}-\d{1,2}-\d{1,2}(?:-\d{1,2})?)(?![\d])/gi)) {
      add({ group: "nastrojova_ocel", sub: S.hss, conf: 0.95, source: "oznaceni", matched: m[0], normalized: `HS${m[1]}`, index: m.index ?? 0 });
    }
    // EN nízkolegované 42CrMo4, 16MnCr5, 100Cr6, 11SMn30…
    for (const m of t.matchAll(/(?<![A-Za-z\d.,])(\d{1,3})([A-Za-z]{1,10}?)(\d{1,3}(?:-\d{1,2}){0,3})(?![A-Za-z\d])/g)) {
      const elems = splitElements(m[2]);
      if (!elems) continue;
      // „10N", „40s6" (uložení), „5V"… nejsou materiály; samotné S jen u automatových (35S20)
      if (elems.length === 1 && !["Cr", "Mn", "Si", "Mo", "Ni", "S"].includes(elems[0]) && !TOOL_LOWALLOY.has(m[0].toLowerCase())) continue;
      if (elems.length === 1 && elems[0] === "S" && !(Number(m[1]) >= 9 && Number(m[3]) >= 15)) continue;
      const c = lowAlloyCandidate(m[1], elems, m[3]);
      add({ ...c, conf: 0.95, source: "oznaceni", matched: m[0], index: m.index ?? 0 });
    }
    // Uhlíkové C45, C45E, Ck45, C60, C80U (U/W = nástrojová)
    for (const m of t.matchAll(/(?<![A-Za-z\d.,])(C[kfq]?)\s?(10|15|16|22|25|30|35|40|45|50|55|60|67|70|75|80|85|90|100|105|110|125)(E|R|U|W\d?|D|S)?(?![A-Za-z\d])/gi)) {
      // „PEEK CF30", „PA6 GF30" — plnivo plastu, ne ocel Cf30
      if (/(?:peek|pa\s?\d{0,2}|pps|pei|pom|pp|pet|ptfe|pa6|pa66)\s?[-/]?\s?$/.test(f.slice(Math.max(0, (m.index ?? 0) - 8), m.index ?? 0))) continue;
      const prefix = m[1].charAt(0).toUpperCase() + m[1].slice(1).toLowerCase();
      const suf = (m[3] ?? "").toUpperCase();
      const normalized = `${prefix}${m[2]}${suf}`;
      const tool = suf.startsWith("U") || suf.startsWith("W");
      add({ group: tool ? "nastrojova_ocel" : "bezna_ocel", sub: tool ? null : S.usle_uhlikova, conf: 0.93, source: "oznaceni", matched: m[0], normalized, index: m.index ?? 0 });
    }
    // Konstrukční S235JR, S355J2+N, E295, P265GH, S690QL, DC01, DX51D
    for (const m of t.matchAll(/(?<![A-Za-z\d])([SEP])\s?(\d{3})([A-Z][A-Z\d]{0,5})?(?![\d])/gi)) {
      const letter = m[1].toUpperCase();
      const num = m[2];
      const suf = (m[3] ?? "").toUpperCase();
      if (letter === "S") {
        const structural = ["185", "235", "275", "315", "355", "380", "420", "460", "500", "550", "620", "650", "690", "700", "890", "960", "1100"];
        if (!structural.includes(num)) continue; // S600, S390… = Böhler HSS (TRADE_RULES)
        if (!suf && ["500", "690", "700"].includes(num) && /bohler|boehler/.test(f)) continue;
      }
      // E295/E335/E360 (EN 10025-2) a přesné trubky E215–E470 (EN 10305: E235+N, E355+SR)
      if (letter === "E" && !["215", "235", "255", "295", "335", "355", "360", "410", "470"].includes(num)) continue;
      if (letter === "P" && !["195", "235", "265", "275", "295", "355", "460"].includes(num)) continue;
      const qt = /Q/.test(suf) && letter === "S";
      add({
        group: qt ? "zuslechtena_ocel" : "bezna_ocel", sub: qt ? S.oteruvzdorna : /MC|NC|M$/.test(suf) ? S.plech_ocel : null,
        conf: 0.95, source: "oznaceni", matched: m[0], normalized: `${letter}${num}${suf}`, index: m.index ?? 0,
      });
    }
    for (const m of t.matchAll(/(?<![A-Za-z\d])(DC0[1-7]|DD1[1-4]|DX5[1-7]D?|HC\d{3}LA)(?:\+Z\d*)?(?![A-Za-z\d])/gi)) {
      add({ group: "bezna_ocel", sub: S.plech_ocel, conf: 0.95, source: "oznaceni", matched: m[0], normalized: m[1].toUpperCase(), index: m.index ?? 0 });
    }
    // Tažená automatová ocel ETG 88 / ETG 100 (Steeltec)
    for (const m of t.matchAll(/(?<![A-Za-z\d])ETG\s?-?\s?(88|100)(?![\d])/gi)) {
      add({ group: "bezna_ocel", sub: S.automatova, conf: 0.95, source: "oznaceni", matched: m[0], normalized: `ETG ${m[1]}`, index: m.index ?? 0 });
    }
    // Staré DIN St37-2, St52-3, RSt37-2
    for (const m of t.matchAll(/(?<![A-Za-z\d])(?:R|U)?St\s?(33|34|37|42|44|50|52|60|70)(?:-\d)?(?![\d])/g)) {
      add({ group: "bezna_ocel", sub: null, conf: 0.93, source: "oznaceni", matched: m[0], normalized: m[0].replace(/\s/g, ""), index: m.index ?? 0 });
    }

    // Litiny EN-GJL-250, GJS-400-15, GG25, GGG40, EN-JL1040
    for (const m of t.matchAll(/(?<![A-Za-z\d])(?:EN-?)?GJ([LSMV])(?:[A-Z])?\s?-?\s?(\d{3})(-\d{1,2})?(?![\d])/gi)) {
      const k = m[1].toUpperCase();
      const sub = k === "L" ? S.litina_seda : k === "S" ? S.litina_tvarna : k === "M" ? S.litina_temper : null;
      add({ group: "litina", sub, conf: 0.97, source: "oznaceni", matched: m[0], normalized: `EN-GJ${k}-${m[2]}${m[3] ?? ""}`, index: m.index ?? 0 });
    }
    for (const m of t.matchAll(/(?<![A-Za-z\d])(GGG|GG|GTW|GTS)\s?-?\s?(\d{2})(?![\d])/gi)) {
      const k = m[1].toUpperCase();
      const sub = k === "GG" ? S.litina_seda : k === "GGG" ? S.litina_tvarna : S.litina_temper;
      add({ group: "litina", sub, conf: 0.97, source: "oznaceni", matched: m[0], normalized: `${k}-${m[2]}`, index: m.index ?? 0 });
    }
    for (const m of t.matchAll(/(?<![A-Za-z\d])EN-?J([LSM])\s?(\d{4})(?![\d])/gi)) {
      const k = m[1].toUpperCase();
      add({ group: "litina", sub: k === "L" ? S.litina_seda : k === "S" ? S.litina_tvarna : S.litina_temper, conf: 0.95, source: "oznaceni", matched: m[0], normalized: `EN-J${k}${m[2]}`, index: m.index ?? 0 });
    }

    // Hliník EN AW-6082, AW 7075, AA 6061, EN AC-43000
    for (const m of t.matchAll(/(?<![A-Za-z\d])(?:EN\s?)?A([WC])\s?-?\s?(\d{4,5})([A-Z])?(?![\d])/gi)) {
      const cast = m[1].toUpperCase() === "C";
      add({ group: "hlinik", sub: cast ? S.al_slevarensky : alSeriesSub(m[2]), conf: 0.97, source: "oznaceni", matched: m[0], normalized: `EN A${m[1].toUpperCase()}-${m[2]}${(m[3] ?? "").toUpperCase()}`, index: m.index ?? 0 });
    }
    for (const m of t.matchAll(/(?<![A-Za-z\d])AA\s?-?(\d{4})(?![\d])/gi)) {
      add({ group: "hlinik", sub: alSeriesSub(m[1]), conf: 0.95, source: "oznaceni", matched: m[0], normalized: `AA ${m[1]}`, index: m.index ?? 0 });
    }
    // Hliník chemicky AlMgSi1, AlZnMgCu1,5, AlCuMg1, Al99,5, AlSi10Mg
    for (const m of t.matchAll(/(?<![A-Za-z\d])(?:G-?)?Al\s?(99[.,]?\d*|(?:Mg|Si|Cu|Zn|Mn|Pb|Bi|Fe|Li)[A-Za-z\d.,()]*)/gi)) {
      const body = m[1].toLowerCase();
      if (!/^(99|mg|si|cu|zn|mn|pb|bi|fe|li)/.test(body)) continue;
      const sub = /cu/.test(body) && !/zn/.test(body) ? S.al_dural
        : /zn/.test(body) ? S.al_7xxx
          : /^si(?:7|9|1[0-2])/.test(body) ? S.al_slevarensky
            : /^mg/.test(body) && !/si/.test(body) ? S.al_5xxx : null;
      add({ group: "hlinik", sub, conf: 0.95, source: "oznaceni", matched: m[0], normalized: m[0].replace(/\s/g, ""), index: m.index ?? 0 });
    }

    // Měď / slitiny chemicky CuZn39Pb3, CuSn8, CuAl10Fe5Ni5, CuNi10Fe1Mn, CuBe2
    for (const m of t.matchAll(/(?<![A-Za-z\d])(?:G-?|GC-?|GZ-?)?Cu\s?(Zn|Sn|Al|Ni|Cr|Be|Co|Fe|Pb|Si|Mn|Ag|Te|Zr|Mg)\d?[A-Za-z\d.,-]*/gi)) {
      let c = cuChemCandidate(m[1]);
      if (m[1].toLowerCase() === "ni" && /zn/i.test(m[0])) c = { group: "barevne_kovy", sub: S.alpaka };
      // CuNi1Si, CuNi2Si, CuNi3Si (Corson, ≈ 97 % Cu) = nízkolegovaná měď jako CW111C, ne měďnikl
      else if (m[1].toLowerCase() === "ni" && Number(m[0].match(/Ni(\d+)/i)?.[1] ?? 99) <= 3) c = { group: "med", sub: S.med_nizkolegovana };
      add({ ...c, conf: 0.95, source: "oznaceni", matched: m[0], normalized: m[0].replace(/\s/g, ""), index: m.index ?? 0 });
    }
    // EN čísla mědi CW614N, CC491K, CW008A
    for (const m of t.matchAll(/(?<![A-Za-z\d])C([WCBFMR])\s?(\d{3})([A-Z])(?![A-Za-z\d])/gi)) {
      const c = enCopperCandidate(m[3].toUpperCase());
      add({ ...c, conf: 0.95, source: "oznaceni", matched: m[0], normalized: `C${m[1].toUpperCase()}${m[2]}${m[3].toUpperCase()}`, index: m.index ?? 0 });
    }
    // Nikl chemicky NiCr22Mo9Nb, NiCu30Fe, NiMo16Cr15W
    for (const m of t.matchAll(/(?<![A-Za-z\d])Ni(Cr|Cu|Mo|Fe)\d{1,2}[A-Za-z\d-]*/g)) {
      const sub = m[1] === "Cu" ? S.monel : m[1] === "Mo" ? S.hastelloy : S.niklova_slitina;
      add({ group: "barevne_kovy", sub, conf: 0.93, source: "oznaceni", matched: m[0], normalized: m[0], index: m.index ?? 0 });
    }

    // UNS (S31603, N06625, R56400, C36000 / s prefixem „UNS" vše)
    for (const m of t.matchAll(/(?<![A-Za-z\d])(UNS\s?)?([SNRCAG])\s?(\d{5})(?![\d])/gi)) {
      const letter = m[2].toUpperCase();
      if (!m[1] && !["S", "N", "R"].includes(letter)) continue;
      if (!m[1] && letter === "R" && !m[3].startsWith("5")) continue;
      const c = unsCandidate(letter, m[3]);
      if (c) add({ ...c, conf: m[1] ? 0.95 : 0.9, source: "oznaceni", matched: m[0], normalized: `UNS ${letter}${m[3]}`, index: m.index ?? 0 });
    }

    // AISI / SAE s prefixem
    for (const m of t.matchAll(/(?<![A-Za-z])(?:AISI|SAE|ASTM|A\.I\.S\.I\.|SS)\s?-?\s?(\d{3,5})((?:LN|L|H|S|Ti|Cb|F|Se|Cu|[ABC])(?![A-Za-z]))?(?![\d])/gi)) {
      const c = aisiNumCandidate(m[1], m[2] ?? "");
      if (c) add({ ...c, conf: 0.95, source: "oznaceni", matched: m[0], normalized: `AISI ${m[1]}${m[2] ?? ""}`, index: m.index ?? 0 });
    }
    for (const m of t.matchAll(/(?<![A-Za-z])(?:AISI|SAE)\s?-?\s?([A-Z]\d{1,2})(?![\d])/gi)) {
      const code = m[1].toUpperCase();
      if (AISI_TOOL.has(code)) add({ group: "nastrojova_ocel", sub: null, conf: 0.95, source: "oznaceni", matched: m[0], normalized: `AISI ${code}`, index: m.index ?? 0 });
    }
    // Holá čísla: 304, 316L, 2205, 6082-T6, 4140 (ne rozměry: ne před/za „x" ani „mm")
    for (const m of t.matchAll(/(?<![\d.,A-Za-z/Øø⌀])(\d{3,5})(LN|L|H|Ti|TI|S|F|[ABC])?(?:\s?-?\s?(T\d{1,4}|H\d{2,3}|O(?![A-Za-z])))?(?![\d.,]|\s?(?:x|×|mm|\*))/g)) {
      const prev = t.slice(Math.max(0, (m.index ?? 0) - 3), m.index ?? 0);
      if (/[x×*]\s?$/.test(prev)) continue;
      const [, num, suf, temper] = m;
      if (num.length === 4 && (AL_BARE.has(num) || (temper && /^[THO]/.test(temper) && /^[1-8]/.test(num)))) {
        if (!(STEEL_BARE_4.has(num) && !temper && !suf) || num === "1050") {
          add({ group: "hlinik", sub: alSeriesSub(num), conf: temper ? 0.9 : 0.78, source: "oznaceni", matched: m[0], normalized: `EN AW-${num}${suf ?? ""}${temper ? ` ${temper.toUpperCase()}` : ""}`, index: m.index ?? 0 });
          continue;
        }
      }
      if (DUPLEX_NUM.has(num)) {
        add({ group: "duplex", sub: num === "2507" ? S.super_duplex : null, conf: 0.85, source: "oznaceni", matched: m[0], normalized: num, index: m.index ?? 0 });
        continue;
      }
      if (num.length === 3 && AISI_STAINLESS_3.has(num)) {
        const c = aisiNumCandidate(num, suf ?? "");
        if (c) add({ ...c, conf: 0.8, source: "oznaceni", matched: m[0], normalized: `AISI ${num}${suf ?? ""}`, index: m.index ?? 0 });
        continue;
      }
      if (num.length >= 4 && STEEL_BARE_4.has(num)) {
        const c = aisiNumCandidate(num, suf ?? "");
        if (c) add({ ...c, conf: 0.75, source: "oznaceni", matched: m[0], normalized: `AISI ${num}`, index: m.index ?? 0 });
      }
    }
    // Holé AISI kódy nástrojových ocelí jen jako celé označení („D2", „H13", „P20").
    // Holé „A2" / „A4" je na CZ/DE výkresech nerez (ISO 3506: A2 ≈ 1.4301, A4 ≈ 1.4401) — AISI A2 jen
    // s prefixem „AISI" (výše) nebo jako 1.2363.
    {
      const whole = t.replace(/[()]/g, " ").trim().toUpperCase();
      if (whole === "A2" || whole === "A4") {
        add({ group: "nerez", sub: whole === "A4" ? S.nerez_austenit_mo : S.nerez_austenit, conf: 0.7, source: "oznaceni", matched: t, normalized: whole, index: 0 });
      } else if (AISI_TOOL.has(whole)) {
        add({ group: "nastrojova_ocel", sub: null, conf: 0.8, source: "oznaceni", matched: t, normalized: `AISI ${whole}`, index: 0 });
      }
    }
    // Holé chemické značky / zkratky jako samostatné slovo: „Al", „Alu", „Cu", „Ms", „Ti", „Mg", „PA", „Ni".
    // „MS" velkými může být anglicky „mild steel" → jistota pod prahem AI (0,58), AI ji může přebít.
    for (const m of t.matchAll(/(?<![A-Za-z\d])(alu|al|cu|ms|ti|mg|pa|ni)(?![A-Za-z\d])/gi)) {
      const idx = m.index ?? 0;
      const sym = m[1].toLowerCase();
      if (sym === "ni" && /chem|galv|nikl|nick/.test(f.slice(Math.max(0, idx - 12), idx))) continue; // „chem. Ni" = úprava
      const b = BARE_SYMBOLS[sym];
      add({ group: b.group, sub: b.sub, conf: m[1] === "MS" ? 0.58 : 0.7, source: "oznaceni", matched: m[0], normalized: b.norm, index: idx });
    }
    // „SK" = slinutý karbid (zkratka velkými)
    for (const m of t.matchAll(/(?<![A-Za-z\d])SK(?![A-Za-z])/g)) {
      add({ group: "slinuty_karbid", sub: null, conf: 0.8, source: "oznaceni", matched: m[0], normalized: "SK", index: m.index ?? 0 });
    }
    // Slinutý karbid K10–K40 (ISO), „HM K20"
    for (const m of t.matchAll(/(?<![A-Za-z\d])K\s?(0[1-5]|10|15|20|25|30|35|40)(?![\d])/g)) {
      add({ group: "slinuty_karbid", sub: null, conf: 0.85, source: "oznaceni", matched: m[0], normalized: `K${m[1]}`, index: m.index ?? 0 });
    }
    for (const m of t.matchAll(/(?<![A-Za-z])HM(?![A-Za-z])/g)) {
      add({ group: "slinuty_karbid", sub: null, conf: 0.85, source: "oznaceni", matched: m[0], normalized: "HM", index: m.index ?? 0 });
    }
    // Titan W.Nr./EN čísla a Grade bez prefixu „Ti" (jen když je v textu titan)
    if (/\bti\b|titan/.test(f)) {
      for (const m of f.matchAll(/\b(?:gr(?:ade)?\.?\s?)(1|2|3|4|5|7|9|12|23)\b/g)) {
        const g = Number(m[1]);
        add({ group: "titan", sub: [1, 2, 3, 4, 7, 12].includes(g) ? S.ti_cisty : S.ti_slitina, conf: 0.95, source: "oznaceni", matched: t.slice(m.index ?? 0, (m.index ?? 0) + m[0].length), normalized: `Ti Grade ${g}`, index: m.index ?? 0 });
      }
    }

    // Obchodní názvy + klíčová slova (fold text)
    for (const rule of [...TRADE_RULES, ...KEYWORD_RULES]) {
      const re = new RegExp(rule.re.source, "g");
      for (const m of f.matchAll(re)) {
        const idx = m.index ?? 0;
        // „karbid křemíku" není slinutý karbid; „chemicky nikl" není materiál apod.
        if (rule.group === "slinuty_karbid" && /kremik|silic|bor/.test(f.slice(idx, idx + 30))) continue;
        let sub = rule.sub ?? null;
        let normalized = t.slice(idx, idx + m[0].length);
        if (rule.name === "ti-grade") {
          const g = Number(m[1]);
          sub = [1, 2, 3, 4, 7, 12].includes(g) ? S.ti_cisty : S.ti_slitina;
          normalized = `Ti Grade ${g}`;
        }
        add({ group: rule.group, sub, conf: rule.conf, source: rule.source, matched: t.slice(idx, idx + m[0].length), normalized: rule.source === "klicove_slovo" ? "" : normalized, index: idx });
      }
    }
  }

  const det = detectCondition(t, f);
  let condition = det.condition ?? csnCondition;
  const qt = det.qt || csnQt;
  const hardness = t ? (findHardness(t)[0]?.value ?? null) : null;

  // Výběr: nejvyšší jistota, při shodě dřívější výskyt
  cands.sort((a, b) => b.conf - a.conf || a.index - b.index);
  let best = cands[0] ?? null;

  // AI skupina jen jako záloha: nic nenalezeno, nebo jen obecné slovo („ocel") a AI říká jinou skupinu
  const aiKey = materialGroupFromText(aiGroup ?? null);
  if (aiKey && (!best || (best.conf < 0.6 && best.group !== aiKey))) {
    best = { group: aiKey, sub: null, conf: 0.5, source: "ai", matched: aiGroup ?? "", normalized: "", index: 0 };
  }
  if (!best) {
    const def = MATERIAL_GROUPS.ostatni;
    return {
      group: "ostatni", label: def.label, subgroup: null, confidence: 0, source: "zadny", matched: "",
      normalizedDesignation: "", density: def.density, densityAssumed: true, condition, hardness, cast: false,
    };
  }

  let group = best.group;
  let sub = best.sub;
  // Běžná ocel ve stavu +QT / zušlechtěno = zušlechtěná
  if (group === "bezna_ocel" && qt) { group = "zuslechtena_ocel"; sub = null; }
  // Stav dodání hliníku (EN 515): T6, T651, H14, O → material_condition (není operace TZ)
  if (group === "hlinik" && !condition) {
    const temper = t.match(/(?<![A-Za-z\d])(T[3-9]\d{0,3}|T4\d{0,3}|H[1-3]\d{1,2}|O)(?![A-Za-z\d])/);
    if (temper && temper[1] !== "O") {
      const k = temper[1].toUpperCase();
      condition = k.startsWith("T4") ? `přirozeně stárnuto (${k})` : k.startsWith("T") ? `vytvrzeno (${k})` : `zpevněno za studena (${k})`;
    } else if (temper && /AW|AA|Al/.test(t)) {
      condition = "žíháno (O)";
    }
  }
  // Plněné plasty (GF / CF) mají výrazně vyšší hustotu
  if (group === "plasty" && (sub?.key === "pa" || sub?.key === "peek")) {
    const filler = f.match(/\b(?:gf|cf)\s?-?\d{2}\b|\b(?:glass|sklo|skel)\w*/)?.[0] ?? "";
    if (filler) sub = sub.key === "pa" ? S.pa_gf : /^cf/.test(filler) ? S.peek_cf : S.peek_gf;
  }

  // Uklizené označení: unikátní označení vítězné skupiny (max 3)
  const sameGroup = cands.filter((c) => c.group === best!.group && c.normalized && c.conf >= 0.75);
  const seen = new Set<string>();
  const parts: string[] = [];
  for (const c of [...sameGroup].sort((a, b) => a.index - b.index)) {
    const k = c.normalized.toLowerCase().replace(/[\s.-]/g, "");
    if (seen.has(k)) continue;
    // vynechat dílčí shody uvnitř delší (EN AW-6082 vs AA 6082 vs 6082)
    if ([...seen].some((s) => s.includes(k) || k.includes(s))) continue;
    seen.add(k);
    parts.push(c.normalized);
    if (parts.length >= 3) break;
  }
  const qtSuffix = qt && parts.length && !/\+\s?q/i.test(parts.join(" ")) && /\+\s?Q/i.test(t) ? "+QT" : "";
  const normalizedDesignation = parts.length ? parts.join(" / ") + qtSuffix : "";

  const def = MATERIAL_GROUPS[group];
  const density = sub && sub.group === group ? sub.density : def.density;
  return {
    group,
    label: def.label,
    subgroup: sub && sub.group === group ? sub : null,
    confidence: Math.round(best.conf * 100) / 100,
    source: best.source,
    matched: best.matched,
    normalizedDesignation,
    density,
    densityAssumed: group === "ostatni" && !(sub && sub.group === "ostatni"),
    condition,
    hardness,
    cast: !!best.cast,
  };
}

// ═════════════════════════════════════════════════════════════════════════
// Tvrdost
// ═════════════════════════════════════════════════════════════════════════

export interface HardnessMatch {
  /** „58-60 HRC", „min. 600 HV1", „max. 250 HB" */
  value: string;
  unit: string;
  min: number | null;
  max: number | null;
  index: number;
  length: number;
}

const HARD_UNIT = "(HRC|HRB|HRA|HBW|HB|HV\\d{0,2}|HR15N|HR30N|HR45N)";
const HARD_NUM2 = "(\\d{1,4}(?:[.,]\\d)?)";
const HARD_NUM = "(\\d{2,4}(?:[.,]\\d)?)";

function normUnit(u: string): string {
  return u.toUpperCase().replace(/\s/g, "");
}

function plausible(unit: string, v: number): boolean {
  if (unit.startsWith("HRC")) return v >= 15 && v <= 72;
  if (unit.startsWith("HRB") || unit.startsWith("HRA") || unit.startsWith("HR")) return v >= 20 && v <= 100;
  if (unit.startsWith("HB")) return v >= 50 && v <= 750;
  if (unit.startsWith("HV")) return v >= 80 && v <= 3000;
  return false;
}

function fmtHard(n: number): string {
  return String(n).replace(".", ",");
}

/** Najde všechny údaje o tvrdosti v textu. */
export function findHardness(text: string): HardnessMatch[] {
  const out: HardnessMatch[] = [];
  const taken: Array<[number, number]> = [];
  const overlaps = (a: number, b: number) => taken.some(([x, y]) => a < y && b > x);
  const t = text.replace(/[‐-―−]/g, "-");
  const push = (m: RegExpMatchArray, prefix: string | undefined, a: string, b: string | undefined, plusMinus: string | undefined, unitRaw: string) => {
    const idx = m.index ?? 0;
    if (overlaps(idx, idx + m[0].length)) return;
    const unit = normUnit(unitRaw);
    const lo = numFrom(a);
    if (!plausible(unit, lo)) return;
    let min: number | null = lo;
    let max: number | null = lo;
    let value: string;
    const pre = (prefix ?? "").toLowerCase();
    if (b) {
      const hi = numFrom(b);
      if (!plausible(unit, hi) && !(hi < lo && hi <= 10)) return;
      const top = hi < lo && hi <= 10 ? lo + hi : hi; // „58+2"
      min = Math.min(lo, top); max = Math.max(lo, top);
      value = `${fmtHard(min)}-${fmtHard(max)} ${unit}`;
    } else if (plusMinus) {
      const d = numFrom(plusMinus);
      min = lo - d; max = lo + d;
      value = `${fmtHard(min)}-${fmtHard(max)} ${unit}`;
    } else if (/min|≥|>/.test(pre)) {
      max = null; value = `min. ${fmtHard(lo)} ${unit}`;
    } else if (/max|≤|</.test(pre)) {
      min = null; value = `max. ${fmtHard(lo)} ${unit}`;
    } else {
      value = `${fmtHard(lo)} ${unit}`;
    }
    taken.push([idx, idx + m[0].length]);
    out.push({ value, unit, min, max, index: idx, length: m[0].length });
  };
  // tolerance za jednotkou: „58 HRC +2", „60 HRC ±2", „58 HRC +2/-0"
  const re0 = new RegExp(`(min\\.?|max\\.?)?\\s*${HARD_NUM}\\s*${HARD_UNIT}\\s*(?:(\\+)\\s*(\\d{1,2}(?:[.,]\\d)?)(?:\\s*\\/\\s*-\\s*0)?|(?:±|\\+\\/-|\\+-)\\s*(\\d{1,2}(?:[.,]\\d)?))(?![\\d.,])`, "gi");
  for (const m of t.matchAll(re0)) push(m, m[1], m[2], m[5], m[6], m[3]);
  // číslo před jednotkou: „58-60 HRC", „58+2 HRC", „58±2HRC", „min. 55 HRC", „≥ 600 HV1"
  const re1 = new RegExp(`(min\\.?|max\\.?|≥|>=|≤|<=|>|<)?\\s*${HARD_NUM}\\s*(?:(?:-|÷|až|bis|to|\\.\\.|\\+)\\s*${HARD_NUM2}|(?:±|\\+\\/-|\\+-)\\s*(\\d{1,2}(?:[.,]\\d)?))?\\s*${HARD_UNIT}(?![A-Za-z])`, "gi");
  for (const m of t.matchAll(re1)) push(m, m[1], m[2], m[3], m[4], m[5]);
  // jednotka před číslem: „HRC 58-60", „HV1 min. 550", „HB: 220"
  const re2 = new RegExp(`(?<![A-Za-z])${HARD_UNIT}\\s*[:=]?\\s*(min\\.?|max\\.?|≥|>=|≤|<=)?\\s*${HARD_NUM}(?:\\s*(?:-|÷|až|bis|to|\\+)\\s*${HARD_NUM2}|\\s*(?:±|\\+\\/-)\\s*(\\d{1,2}(?:[.,]\\d)?))?`, "gi");
  for (const m of t.matchAll(re2)) push(m, m[2], m[3], m[4], m[5], m[1]);
  return out.sort((a, b) => a.index - b.index);
}

// ═════════════════════════════════════════════════════════════════════════
// Tepelné zpracování a povrchové úpravy
// ═════════════════════════════════════════════════════════════════════════

export type HeatKind =
  | "kaleni" | "indukcni_kaleni" | "zuslechteni" | "cementace" | "karbonitridace" | "nitridace" | "nitrocementace"
  | "zihani" | "zihani_pnuti" | "normalizace" | "popousteni" | "precipitacni_vytvrzeni" | "hlubokozmrazeni" | "bez_tz";

export type SurfaceKind =
  | "zinkovani" | "galvanicky_zinek" | "zinkove_lamely" | "cerneni" | "eloxovani" | "chromovani" | "tvrdochrom"
  | "niklovani" | "chemicky_nikl" | "lakovani" | "praskove_lakovani" | "fosfatovani" | "moreni" | "pasivace"
  | "chromatovani" | "tryskani" | "lesteni" | "brouseni_povrchu" | "lapovani_honovani" | "povlak" | "cinovani"
  | "stribreni" | "zlaceni" | "nastrik" | "konzervace" | "omilani" | "bez_upravy";

export interface TreatmentKindDef {
  key: string;
  label: string;
  short: string;
  badge: string;
  dot: string;
}

const TK = (key: string, label: string, short: string, color: string): TreatmentKindDef => ({
  key, label, short, badge: BADGE[color], dot: DOT[color],
});

// Celé třídy vypsané (Tailwind JIT je musí vidět v kódu)
const BADGE: Record<string, string> = {
  rose: "bg-rose-100 text-rose-800 dark:bg-rose-500/15 dark:text-rose-300",
  red: "bg-red-100 text-red-800 dark:bg-red-500/15 dark:text-red-300",
  orange: "bg-orange-100 text-orange-800 dark:bg-orange-500/15 dark:text-orange-300",
  amber: "bg-amber-100 text-amber-800 dark:bg-amber-500/15 dark:text-amber-300",
  yellow: "bg-yellow-100 text-yellow-800 dark:bg-yellow-500/15 dark:text-yellow-300",
  lime: "bg-lime-100 text-lime-800 dark:bg-lime-500/15 dark:text-lime-300",
  green: "bg-green-100 text-green-800 dark:bg-green-500/15 dark:text-green-300",
  emerald: "bg-emerald-100 text-emerald-800 dark:bg-emerald-500/15 dark:text-emerald-300",
  teal: "bg-teal-100 text-teal-800 dark:bg-teal-500/15 dark:text-teal-300",
  cyan: "bg-cyan-100 text-cyan-800 dark:bg-cyan-500/15 dark:text-cyan-300",
  sky: "bg-sky-100 text-sky-800 dark:bg-sky-500/15 dark:text-sky-300",
  blue: "bg-blue-100 text-blue-800 dark:bg-blue-500/15 dark:text-blue-300",
  indigo: "bg-indigo-100 text-indigo-800 dark:bg-indigo-500/15 dark:text-indigo-300",
  violet: "bg-violet-100 text-violet-800 dark:bg-violet-500/15 dark:text-violet-300",
  purple: "bg-purple-100 text-purple-800 dark:bg-purple-500/15 dark:text-purple-300",
  fuchsia: "bg-fuchsia-100 text-fuchsia-800 dark:bg-fuchsia-500/15 dark:text-fuchsia-300",
  pink: "bg-pink-100 text-pink-800 dark:bg-pink-500/15 dark:text-pink-300",
  slate: "bg-slate-100 text-slate-800 dark:bg-slate-500/15 dark:text-slate-300",
  zinc: "bg-zinc-200 text-zinc-800 dark:bg-zinc-500/20 dark:text-zinc-300",
  stone: "bg-stone-200 text-stone-800 dark:bg-stone-500/20 dark:text-stone-300",
  neutral: "border border-dashed border-neutral-400 bg-transparent text-neutral-600 dark:border-neutral-500 dark:text-neutral-400",
};
const DOT: Record<string, string> = {
  rose: "bg-rose-500", red: "bg-red-500", orange: "bg-orange-500", amber: "bg-amber-500", yellow: "bg-yellow-500",
  lime: "bg-lime-500", green: "bg-green-500", emerald: "bg-emerald-500", teal: "bg-teal-500", cyan: "bg-cyan-500",
  sky: "bg-sky-500", blue: "bg-blue-500", indigo: "bg-indigo-500", violet: "bg-violet-500", purple: "bg-purple-500",
  fuchsia: "bg-fuchsia-500", pink: "bg-pink-500", slate: "bg-slate-500", zinc: "bg-zinc-500", stone: "bg-stone-500",
  neutral: "bg-neutral-400",
};

export const HEAT_KINDS: Record<HeatKind, TreatmentKindDef> = {
  kaleni: TK("kaleni", "Kalení", "Kaleno", "red"),
  indukcni_kaleni: TK("indukcni_kaleni", "Indukční / povrchové kalení", "Ind. kaleno", "rose"),
  zuslechteni: TK("zuslechteni", "Zušlechtění", "Zušl.", "blue"),
  cementace: TK("cementace", "Cementace", "Cement.", "amber"),
  karbonitridace: TK("karbonitridace", "Karbonitridace", "Karbonitr.", "orange"),
  nitridace: TK("nitridace", "Nitridace", "Nitrid.", "violet"),
  nitrocementace: TK("nitrocementace", "Nitrocementace (QPQ / Tenifer)", "Nitrocem.", "purple"),
  zihani: TK("zihani", "Žíhání", "Žíháno", "yellow"),
  zihani_pnuti: TK("zihani_pnuti", "Žíhání ke snížení pnutí", "Bez pnutí", "lime"),
  normalizace: TK("normalizace", "Normalizační žíhání", "Normaliz.", "green"),
  popousteni: TK("popousteni", "Popouštění", "Popuštěno", "orange"),
  precipitacni_vytvrzeni: TK("precipitacni_vytvrzeni", "Precipitační vytvrzení", "Vytvrzeno", "teal"),
  hlubokozmrazeni: TK("hlubokozmrazeni", "Hluboké zmrazení", "Zmrazeno", "cyan"),
  bez_tz: TK("bez_tz", "Bez tepelného zpracování", "Bez TZ", "neutral"),
};

export const SURFACE_KINDS: Record<SurfaceKind, TreatmentKindDef> = {
  zinkovani: TK("zinkovani", "Zinkování", "Zn", "slate"),
  galvanicky_zinek: TK("galvanicky_zinek", "Galvanický zinek", "Zn galv.", "sky"),
  zinkove_lamely: TK("zinkove_lamely", "Zinkové lamely (Geomet / Dacromet)", "Zn lamely", "cyan"),
  cerneni: TK("cerneni", "Černění", "Černěno", "stone"),
  eloxovani: TK("eloxovani", "Eloxování (anodizace)", "Elox", "indigo"),
  chromovani: TK("chromovani", "Chromování", "Cr", "blue"),
  tvrdochrom: TK("tvrdochrom", "Tvrdochrom", "Tvrdý Cr", "violet"),
  niklovani: TK("niklovani", "Niklování", "Ni", "teal"),
  chemicky_nikl: TK("chemicky_nikl", "Chemický nikl", "Chem. Ni", "emerald"),
  lakovani: TK("lakovani", "Lakování", "Lak", "orange"),
  praskove_lakovani: TK("praskove_lakovani", "Práškové lakování", "Prášk. lak", "amber"),
  fosfatovani: TK("fosfatovani", "Fosfátování", "Fosfát", "zinc"),
  moreni: TK("moreni", "Moření", "Mořeno", "lime"),
  pasivace: TK("pasivace", "Pasivace", "Pasiv.", "green"),
  chromatovani: TK("chromatovani", "Chromátování / konverzní vrstva", "Chromát", "yellow"),
  tryskani: TK("tryskani", "Tryskání", "Tryskáno", "stone"),
  lesteni: TK("lesteni", "Leštění", "Leštěno", "pink"),
  brouseni_povrchu: TK("brouseni_povrchu", "Broušení", "Broušeno", "slate"),
  lapovani_honovani: TK("lapovani_honovani", "Lapování / honování", "Lapováno", "purple"),
  povlak: TK("povlak", "Povlak (PVD / DLC / TiN)", "Povlak", "fuchsia"),
  cinovani: TK("cinovani", "Cínování", "Sn", "zinc"),
  stribreni: TK("stribreni", "Stříbření", "Ag", "slate"),
  zlaceni: TK("zlaceni", "Zlacení", "Au", "yellow"),
  nastrik: TK("nastrik", "Žárový nástřik", "Nástřik", "red"),
  konzervace: TK("konzervace", "Konzervace (olej)", "Konzerv.", "neutral"),
  omilani: TK("omilani", "Omílání (trowalizace)", "Omíláno", "teal"),
  bez_upravy: TK("bez_upravy", "Bez povrchové úpravy", "Bez PÚ", "neutral"),
};

export interface HeatTreatmentItem {
  kind: HeatKind;
  label: string;
  hardness?: string;
  /** Hloubka vrstvy („0,8-1,2 mm"). */
  depth?: string;
  detail?: string;
  /** Odvozeno jen z tvrdosti (bez slova o zpracování). */
  inferred?: boolean;
  matched: string;
}

export interface SurfaceTreatmentItem {
  kind: SurfaceKind;
  label: string;
  detail?: string;
  matched: string;
}

export interface ParsedTreatments {
  heat: HeatTreatmentItem[];
  surface: SurfaceTreatmentItem[];
  /** Všechny tvrdosti nalezené v textu. */
  hardness: string[];
}

interface TPattern<K extends string> {
  kind: K;
  re: RegExp;
  /** span = shoda, around = okolí (25 znaků před, 40 za), after = shoda + 40 znaků za */
  detail?: (span: string, around: string, after: string) => string | undefined;
}

// Pozn.: vše proti fold textu (malá písmena, bez diakritiky; ä→a, ü→u, ö→o)
const HEAT_PATTERNS: TPattern<HeatKind>[] = [
  { kind: "bez_tz", re: /\bbez\s+(?:tepeln\w*\s+zprac\w*|tz)\b|\b(?:tz|tepeln\w*\s+zprac\w*)\s*[:=-]?\s*(?:zadn[eayo]|neni|none)(?![\w])|\bohne\s+warmebehandlung\w*|\b(?:no|without)\s+heat\s+treatment\b|\bunbehandelt\b/ },
  { kind: "nitrocementace", re: /\bnitrocement\w*|\bnitrokarbur\w*|\bnitrocarbur\w*|\btenifer\w*|\bqpq\b|\btufftrid\w*|\bsalzbadnitrier\w*|\bsursulf\w*|\bkarbonitrid\w*\s+v\s+solne\w*/ },
  { kind: "karbonitridace", re: /\bkarbonitrid\w*|\bcarbonitrid\w*|\bcarbonitrier\w*/ },
  { kind: "nitridace", re: /\bplazm\w*\s+nitrid\w*|\bplasma\s?nitri\w*|\bplasmanitri\w*|\bgasnitri\w*|\bplynov\w*\s+nitrid\w*|\bnitrid(?:ovat|ovano|ovany|ovana|ovane|ovani|ovanim|ace|aci|ed|ing|uj\w*)\b|\bnitrid\b|\bnitrier(?:t|en|ung)\b|\bnht\b/,
    detail: (s) => (/plazm|plasma/.test(s) ? "plazmová" : /gas|plyn/.test(s) ? "plynová" : undefined) },
  { kind: "cementace", re: /\bcementov\w*|\bcementac(?:e|i)\b|\bnacement\w*|\beinsatzh[a]?rt\w*|\beinsatzgeh[a]?rtet\b|\bcarburi[sz]\w*|\bcase[\s-]?harden\w*|\baufkohl\w*|\beht\b|\bchd\b/ },
  { kind: "indukcni_kaleni", re: /\bindukc\w*\s+(?:povrch\w*\s+)?kal\w*|\bkal\w*\s+indukc\w*|\binduktiv\w*\s+geh?[a]?rt\w*|\binduktionsh[a]?rt\w*|\binduction[\s-]+harden\w*|\bpovrchov\w*\s+kal\w*|\brandschichth?[a]?rt\w*|\bplamen\w*\s+kal\w*|\bflammh[a]?rt\w*|\bflammgeh[a]?rtet\b|\bflame[\s-]+harden\w*|\bsht\b|\brht\b/,
    detail: (s) => (/plamen|flamm|flame/.test(s) ? "plamenem" : /indukc|indukt|induct/.test(s) ? "indukčně" : undefined) },
  { kind: "zuslechteni", re: /\bzuslecht\w*\b(?!\s+ocel)|\bzusl\.|\bvergut\w*|\bquenched\s+(?:and|&)\s+tempered\b|\bq\s?\+\s?t\b|\+\s?qt\b|\bqt\b|\bq\s?&\s?t\b/,
    detail: (_s, _around, after) => strengthNear(after) },
  { kind: "precipitacni_vytvrzeni", re: /\bvytvrz\w*|\bprecipita\w*|\bausgeh[a]?rtet\b|\baush[a]?rt\w*|\bage[d]?[\s-]harden\w*|\bsolution\s+(?:treated\s+and\s+)?aged\b|\b(?:h900|h1025|h1075|h1150)\b|\bt6\d{0,2}\b|\bt7\d{0,2}\b/,
    detail: (s) => s.match(/\b(t\d{1,3}|h\d{3,4})\b/)?.[1]?.toUpperCase() },
  { kind: "hlubokozmrazeni", re: /\b(?:hluboc\w*\s+)?zmraz\w*|\bkryogen\w*|\btiefk[u]?hl\w*|\bcryogen\w*|\bsub[\s-]?zero\b|\bdeep\s+freez\w*/ },
  { kind: "zihani_pnuti", re: /\bzih\w*\s+(?:ke\s+|na\s+)?snizeni\s+(?:vnitrni\w*\s+)?pnuti\b|\bsnizeni\s+(?:vnitrni\w*\s+)?pnuti\b|\bodstraneni\s+pnuti\b|\bodpnut\w*|\bspannungsarm\w*(?:\s+gegl[u]?h\w*)?|\bstress[\s-]+reliev\w*|\+\s?sr\b|\bzih\w*\s+na\s+pnuti\b/ },
  { kind: "normalizace", re: /\bnormaliz\w*(?:\s+zih\w*)?|\bnormalisier\w*|\bnormalgegl[u]?h\w*|\bnormali[sz]ed\b|\bnormali[sz]ing\b/ },
  { kind: "zihani", re: /\b(?:vy)?zih(?:at|ano|ana|any|ani|anim|ej|nout)\w*|\bweichgegl[u]?h\w*|\bweichgl[u]?h\w*|\bgegl[u]?ht\b|\bgl[u]?hen\b|\banneal\w*|\+\s?a\b/,
    detail: (s, around) => (/mekko|weich|soft/.test(around) ? "na měkko" : undefined) },
  { kind: "kaleni", re: /\bvakuov\w*\s+kal\w*|\bvakuumgeh?[a]?rt\w*|\bvacuum[\s-]+harden\w*|\b(?:za|pro)?kal(?:it|eno|ena|ene|eny|eni|enim|ime|i)\b|\bkal\.(?=\s|\d)|\bgeh[a]?rtet\b|\bh[a]?rten\b|\bdurchgeh[a]?rtet\b|\bharden(?:ed|ing)?\b|\bthrough[\s-]harden\w*|\bquench(?:ed|ing)?\b/,
    detail: (s, around) => (/vakuu?|vacuum/.test(around) ? "vakuově" : /durch|through|prokal/.test(s) ? "prokaleno" : undefined) },
  { kind: "popousteni", re: /\bpopust\w*|\bpopoust\w*|\bangelassen\b|\banlassen\b|\btempered\b|\btempering\b/ },
];

const SURFACE_PATTERNS: TPattern<SurfaceKind>[] = [
  { kind: "bez_upravy", re: /\bbez\s+povrch\w*\s+uprav\w*|\bbez\s+pu\b|\bbez\s+upravy\b|\b(?:pu|povrch\w*\s+uprav\w*)\s*[:=-]?\s*(?:zadn[eayo]|neni|none)(?![\w])|\bohne\s+oberfl[a]?ch\w*|\bno\s+surface\s+(?:treatment|finish|coating)\b|\bunbeschichtet\b/ },
  { kind: "praskove_lakovani", re: /\bprask\w*\s+(?:lak\w*|barv\w*|nater\w*|nanes\w*)|\bkomaxit\w*|\bpulverbeschicht\w*|\bpulverlack\w*|\bpowder[\s-]+coat\w*|\bpolyester\s+powder\b/ },
  { kind: "zinkove_lamely", re: /\blamel\w*\s+zin\w*|\bzinkov\w*\s+lamel\w*|\bzinklamell\w*|\bzinc[\s-]+flake\w*|\bdacromet\w*|\bgeomet\w*|\bdelta[\s-]?(?:protekt|tone|seal)\w*|\bmagni\s?\d{3}\b/ },
  { kind: "zinkovani", re: /\bzarov\w*\s+(?:po)?zink\w*|\b(?:po)?zink\w*\s+zarov\w*|\bzarov\w*\s+zinek\b|\bzink\w*\s+ponor\w*|\bponor\w*\s+zink\w*|\bfeuerverzink\w*|\bhot[\s-]?dip\w*(?:\s+galvani\w*)?|\bhdg\b|\bt\s?zn\b/, detail: () => "žárové" },
  { kind: "galvanicky_zinek", re: /\bgalv(?:an\w*)?\.?\s*(?:po)?zin[kc]\w*|\bgalv(?:an\w*)?\.?\s*verzink\w*|\b(?:po)?zink\w*\s+galvan\w*|\bgalv\.?\s*zn\b|\bgalvanic\s+zinc\b|\bgalvan\w*\s+zn\b|\belektrolyt\w*\s+(?:po)?zink\w*|\bgalvanisch\s+verzink\w*|\belektrolytisch\s+verzink\w*|\bzinc[\s-]+plat\w*|\belectro[\s-]?(?:galvani|zinc)\w*|\bzn\s?-?ni\b|\bzink[\s-]?nickel\b|\bzinc[\s-]+nickel\b|\bfe\s?\/\s?zn\s?\d+\w*|\bzn\s?\d{1,2}\b|\bzn\b|\bznni\b/ },
  { kind: "zinkovani", re: /\b(?:po)?zink(?:ovat|ovano|ovani|ovana|ovany|ovanim|uj)\b|\bpozink\w*|\bverzink\w*|\bgalvani[sz](?:ed|ing)\b|\bzinc[\s-]+coat\w*|\bzinek\b/ },
  { kind: "cerneni", re: /\b(?:po|za)?cern(?:eni|it|eno|ena|eny|enim)\b|\bbr[u]?nier\w*|\bblack[\s-]+oxid\w*|\bblackening\b|\bblacken(?:ed)?\b|\bschwarz\s*oxid\w*|\bbrunyr\w*/ },
  { kind: "eloxovani", re: /\b(?:tvrd\w*\s+)?elox\w*|\b(?:tvrd\w*\s+)?anodi[sz]\w*|\banodic\w*|\bhard[\s-]?coat\w*|\bhartcoat\w*|\bhart[\s-]?anodi\w*|\bhartelox\w*|\bhard\s+anodi\w*|\bhae\b|\bmil-?a-?8625\w*/,
    detail: (s, around, after) => {
      const parts: string[] = [];
      if (/tvrd|hart|hard|type\s?iii|typ\s?iii/.test(around)) parts.push("tvrdý");
      const COL = /\b(cern\w*|prirodn\w*|natur\w*|schwarz|black|clear|cir\w*|silber\w*|silver|cerven\w*|rot|red|modr\w*|blau|blue|zlat\w*|gold\w*)\b/;
      const col = after.match(COL)?.[1] ?? around.slice(Math.max(0, around.length - after.length - 12), around.length - after.length).match(COL)?.[1];
      if (col) parts.push(colorCs(col));
      const code = after.match(/\b(e\d\s?\/?\s?(?:ev|c)\s?\d{1,2})\b/)?.[1];
      if (code) parts.push(code.toUpperCase().replace(/\s/g, ""));
      return parts.length ? parts.join(", ") : undefined;
    } },
  { kind: "tvrdochrom", re: /\btvrd\w*\s+chrom\w*|\btvrdochrom\w*|\bhartchrom\w*|\bhartverchrom\w*|\bhard[\s-]+chrom\w*|\bhcr\b/ },
  { kind: "chromovani", re: /\b(?:po)?chromov(?:at|ano|ani|ana|any|anim)\b|\bpochrom\w*|\bverchromt\b|\bchrom(?:e|ium)[\s-]+plat\w*|\bchromed\b|\bglanzchrom\w*/ },
  { kind: "chemicky_nikl", re: /\bchem\w*\.?\s+(?:po)?nikl\w*|\bchem\.?\s?ni\b|\bchemisch\w*\s+(?:vernickel\w*|nickel\w*)|\bchemisch-?nickel\w*|\bchemnickel\w*|\bni\s?-?p\b|\bkanigen\b|\benp\b|\belectroless\s+nickel\w*|\bdurni\w*|\bnicklad\w*/ },
  { kind: "niklovani", re: /\b(?:po)?niklov(?:at|ano|ani|ana|any|anim)\b|\bponiklov\w*|\bgalvanick\w*\s+nikl\w*|\bvernickelt\b|\bnickel[\s-]+plat\w*|\bni\s?\d{1,2}\s?(?:µm|μm|um)\b/ },
  { kind: "lakovani", re: /\b(?:na)?lakov(?:at|ano|ani|ana|any|anim)\b|\bnaterem\b|\bnater\b|\bnatrit\b|\bnatreno\b|\blackier\w*|\bpaint(?:ed|ing)?\b|\bbarva\s+ral\b|\bral\s?\d{4}\b|\bzakladn\w*\s+barv\w*|\bkataforez\w*|\bktl\b|\be[\s-]coat\w*|\bgrundier\w*|\bprimer\b/,
    detail: (s, around) => (/kataforez|ktl|e[\s-]coat/.test(s) ? "kataforéza" : /zakladn|grundier|primer/.test(s) ? "základní barva" : undefined) },
  { kind: "fosfatovani", re: /\b\w*(?:fosfat|phosphat)\w*|\bbonderi\w*|\bparkeri\w*/,
    detail: (s, around, after) => (/mangan/.test(around) || /^\w+\s*[-,]?\s*mn\b/.test(after) ? "manganový" : /zink|zinc|zinek/.test(around) || /^\w+\s*[-,]?\s*zn\b/.test(after) ? "zinkový" : undefined) },
  { kind: "moreni", re: /\bmoren\w*|\bmorit\b|\bbeizen\b|\bgebeizt\b|\bpickl\w*/ },
  { kind: "chromatovani", re: /\bchromatov\w*|\bchromatier\w*|\bchromat(?:e|ing)\s+conver\w*|\balodin\w*|\biridit\w*|\bsurtec\s?\d*|\bkonverzn\w*\s+vrstv\w*|\bchem\w*\s+konverz\w*|\bconversion\s+coat\w*|\bchem\s?film\b/ },
  { kind: "pasivace", re: /\bpasiv\w*|\bpassivi\w*|\bpassivat\w*/ },
  { kind: "tryskani", re: /\b(?:o)?trysk\w*|\b(?:o)?piskov\w*|\bkulickov\w*|\b\w*gestrahlt\b|\bstrahl(?:en|ung)\b|\bsandstrahl\w*|\bglasperl\w*|\bkugelstrahl\w*|\b(?:sand|bead|shot|grit|glass[\s-]bead)[\s-]?blast\w*|\bshot[\s-]?peen\w*|\bblasted\b|\bsa\s?(?:2[.,]5|2½|3)\b/,
    detail: (s, around) => (/kulick|kugel|shot[\s-]?peen/.test(s) ? "kuličkování" : /sklen|glas|glass/.test(around) ? "skleněnými kuličkami" : /pisk|sand/.test(s) ? "pískování" : around.match(/\bsa\s?(2[.,]5|2½|3)\b/) ? `Sa ${around.match(/\bsa\s?(2[.,]5|2½|3)\b/)?.[1]?.replace(".", ",")}` : undefined) },
  { kind: "lesteni", re: /\b(?:vy|na)?lest(?:it|eno|eni|ena|eny|enim)\b|\belektrolyt\w*\s+lest\w*|\belektropol\w*|\belectropol\w*|\bpoliert\b|\bpolier\w*|\bpolish\w*|\bzrcadl\w*\s+lesk\w*|\bspiegelpol\w*|\bmirror[\s-]+polish\w*/,
    detail: (s) => (/elektro|electro/.test(s) ? "elektrolyticky" : /zrcadl|spiegel|mirror/.test(s) ? "zrcadlově" : undefined) },
  { kind: "lapovani_honovani", re: /\blapov\w*|\bgel[a]?ppt\b|\bl[a]?ppen\b|\blapped\b|\blapping\b|\bhonov\w*|\bgehont\b|\bhonen\b|\bhoned\b|\bhoning\b|\bsuperfinis\w*/ },
  { kind: "brouseni_povrchu", re: /\b(?:pro|vy|za|na)?brous(?:it|eno|eni|ena|eny|enim)\b|\bgeschliffen\b|\bschleifen\b|\bground\b|\bgrinding\b/ },
  { kind: "cinovani", re: /\b(?:po)?cinov(?:at|ano|ani|ana|any)\w*|\bverzinn\w*|\btin[\s-]+plat\w*|\bsn\s?\d{1,2}\s?(?:µm|μm|um)\b/ },
  { kind: "stribreni", re: /\b(?:po)?stribr(?:it|eno|eni|ena)\w*|\bversilber\w*|\bsilver[\s-]+plat\w*|\bag\s?\d{1,2}\s?(?:µm|μm|um)\b/ },
  { kind: "zlaceni", re: /\b(?:po)?zlac(?:eni|eno|ena|it)\w*|\bvergold\w*|\bgold[\s-]+plat\w*/ },
  { kind: "nastrik", re: /\b(?:zarov\w*|plazm\w*)\s+nastrik\w*|\bnastrik\w*|\bthermisch\w*\s+spritz\w*|\bplasma[\s-]?spray\w*|\bthermal\s+spray\w*|\bhvof\b|\bmetaliz\w*|\bflammspritz\w*/ },
  { kind: "povlak", re: /\bpvd\b|\bcvd\b|\bdlc\b|\bpacvd\b|\bpovlak\w*|\bbeschicht\w*|\bcoating\b|\bcoated\b|\bbalinit\w*|\boerlikon\b|\bplatit\b|\bticn\b|\btialn\b|\baltin\b|\balcrn\b|\bcrn\b|\bzrn\b|\btitannitrid\w*|\btitanium\s+nitride\b|\bwc\/c\b|\bteflon\w*\s+povlak\w*/ },
  { kind: "omilani", re: /\b(?:vy|o)?mil(?:at|ani|ano|ana|any|anim)\b|\bomil\w*|\btrowal\w*|\bgleitschlif\w*|\bgleitschleif\w*|\bvibrator\w*\s+finish\w*|\bvibro\s?finish\w*|\btumbl(?:ed|ing)\b|\bbarrel\s+finish\w*/ },
  { kind: "konzervace", re: /\bkonzerv\w*|\bnaolej\w*|\bolejov(?:at|ano|ana)\w*|\bgeolt\b|\boiled\b|\bkorozn\w*\s+ochran\w*|\btectyl\w*|\bkonservier\w*|\brust\s+prevent\w*|\bvci\b/ },
];

function colorCs(c: string): string {
  if (/^(cern|schwarz|black)/.test(c)) return "černý";
  if (/^(prirodn|natur|clear|cir)/.test(c)) return "přírodní";
  if (/^(silber|silver)/.test(c)) return "stříbrný";
  if (/^(cerven|rot|red)/.test(c)) return "červený";
  if (/^(modr|blau|blue)/.test(c)) return "modrý";
  if (/^(zlat|gold)/.test(c)) return "zlatý";
  return c;
}

const NEGATION = /(?:\bbez|\bne|\bnicht|\bohne|\bno|\bnot|\bwithout|\bkein\w*)\s*$/;

/** Pevnost u zušlechtění: „Rm 900-1100 MPa", „auf 900-1100 N/mm²" → „Rm 900-1100 MPa". */
function strengthNear(after: string): string | undefined {
  const m = after.match(/(?:\brm\s*[:=]?\s*|\bna\s+|\bauf\s+|\bto\s+)(\d{3,4})\s*(?:(?:-|÷|az|bis|to)\s*(\d{3,4}))?\s*(?:mpa|n\s?\/\s?mm\s?(?:2|²)?)/)
    ?? after.match(/\brm\s*[:=]?\s*(\d{3,4})(?:\s*(?:-|÷|az)\s*(\d{3,4}))?/);
  if (!m) return undefined;
  return `Rm ${m[1]}${m[2] ? `-${m[2]}` : ""} MPa`;
}

function thicknessNear(around: string): string | undefined {
  const m = around.match(/(\d{1,3}(?:[.,]\d)?)\s*(?:-|÷|až)?\s*(\d{1,3}(?:[.,]\d)?)?\s*(?:µm|μm|um|mikron\w*|my)\b/);
  if (!m) return undefined;
  return `${m[1].replace(".", ",")}${m[2] ? `-${m[2].replace(".", ",")}` : ""} µm`;
}

const DEPTH_NUM = "(\\d+(?:[.,]\\d+)?)\\s*(?:(-|÷|az|\\+)\\s*(\\d+(?:[.,]\\d+)?))?";

function depthValue(lo: number, sep: string | undefined, second: string | undefined): string | undefined {
  if (!(lo > 0 && lo < 10)) return undefined; // hloubka vrstvy je v desetinách mm až jednotkách mm
  if (!second) return `${fmtDec(lo)} mm`;
  const s2 = numFrom(second);
  const hi = sep === "+" ? lo + s2 : s2; // „0,8 +0,3" = 0,8–1,1
  return `${fmtDec(Math.min(lo, hi))}-${fmtDec(Math.max(lo, hi))} mm`;
}

/**
 * Hloubka vrstvy u zpracování na pozici idx..end (fold text):
 *  1. klíčové slovo (Eht, CHD, NHT, hloubka, hl., vrstva…) s číslem — za CHD/Eht smí stát mezní tvrdost
 *     („CHD 550HV1 0,8-1,0", „Eht550HV1 0,6");
 *  2. jinak samotné „0,8 mm" (0,05–5 mm) do ~20 znaků za slovem zpracování, pokud mezi tím nezačíná
 *     jiné zpracování s vrstvou (`stops`).
 */
function depthNear(f: string, idx: number, end: number, stops: number[]): string | undefined {
  const from = Math.max(0, idx - 30);
  const around = f.slice(from, Math.min(f.length, end + 70));
  const kw = new RegExp(`(?:\\beht|\\bchd|\\bnht|\\brht|\\bsht|\\bcd\\b|hloubk\\w*(?:\\s+(?!\\d)\\w+)?|(?:\\bdo\\s+)?\\bhl\\.|\\btl(?:\\.|oustk\\w*)?\\s+vrstv\\w*|\\bvrstv\\w*|\\btiefe\\b|\\bdepth\\b)\\s*[:=]?\\s*(?:\\d{3,4}\\s?hv\\s?\\d{0,2}\\s*[:=]?\\s*)?(?:min\\.?\\s*)?${DEPTH_NUM}`);
  const m = around.match(kw);
  if (m) {
    const v = depthValue(numFrom(m[1]), m[2], m[3]);
    if (v) return v;
  }
  const tail = f.slice(end, Math.min(f.length, end + 30));
  const bare = tail.match(new RegExp(`^[^\\d|;]{0,20}?${DEPTH_NUM}\\s*mm\\b`));
  if (bare) {
    const numAt = end + (bare.index ?? 0) + bare[0].search(/\d/);
    if (stops.some((p) => p > end && p < numAt)) return undefined;
    const lo = numFrom(bare[1]);
    if (lo >= 0.05 && lo <= 5) return depthValue(lo, bare[2], bare[3]);
  }
  return undefined;
}

function fmtDec(n: number): string {
  return String(Math.round(n * 100) / 100).replace(".", ",");
}

/**
 * Rozpozná tepelné zpracování a povrchové úpravy z volného textu výkresu (česky / německy / anglicky).
 * Vstup může být pole TZ, pole PÚ, poznámky i označení materiálu — klidně spojené dohromady.
 */
export function parseTreatments(text: string | null | undefined): ParsedTreatments {
  const t = (text ?? "").normalize("NFC").replace(/[‐-―−]/g, "-");
  const f = fold(t);
  const hardnessAll = findHardness(t);
  const heat: Array<HeatTreatmentItem & { index: number; end: number }> = [];
  const surface: Array<SurfaceTreatmentItem & { index: number; end: number }> = [];
  const taken: Array<[number, number]> = [];
  const overlaps = (a: number, b: number) => taken.some(([x, y]) => a < y && b > x);
  // tvrdosti nesmí být brány jako slova (např. „HB")
  for (const h of hardnessAll) taken.push([h.index, h.index + h.length]);

  const scan = <K extends string>(patterns: TPattern<K>[], onHit: (p: TPattern<K>, span: string, around: string, after: string, idx: number, end: number) => void) => {
    for (const p of patterns) {
      const re = new RegExp(p.re.source, "g");
      for (const m of f.matchAll(re)) {
        const idx = m.index ?? 0;
        const end = idx + m[0].length;
        if (!m[0].trim() || overlaps(idx, end)) continue;
        const before = f.slice(Math.max(0, idx - 12), idx);
        if (NEGATION.test(before) && !String(p.kind).startsWith("bez_")) { taken.push([idx, end]); continue; }
        taken.push([idx, end]);
        const around = f.slice(Math.max(0, idx - 25), Math.min(f.length, end + 40));
        const after = f.slice(idx, Math.min(f.length, end + 40));
        onHit(p, m[0], around, after, idx, end);
      }
    }
  };

  scan(HEAT_PATTERNS, (p, span, around, after, idx, end) => {
    heat.push({ kind: p.kind, label: HEAT_KINDS[p.kind].label, detail: p.detail?.(span, around, after), matched: t.slice(idx, end), index: idx, end });
  });
  scan(SURFACE_PATTERNS, (p, span, around, after, idx, end) => {
    const tail = f.slice(idx, Math.min(f.length, end + 30));
    let detail = p.detail?.(span, around, after);
    const th = ["zinkovani", "galvanicky_zinek", "zinkove_lamely", "chromovani", "tvrdochrom", "niklovani", "chemicky_nikl", "eloxovani", "povlak", "lakovani", "praskove_lakovani", "cinovani", "stribreni", "zlaceni", "nastrik"].includes(p.kind)
      ? thicknessNear(tail) : undefined;
    if (p.kind === "galvanicky_zinek") {
      const zn = t.slice(idx, end).match(/zn\s?(\d{1,2})/i);
      if (zn && !th) detail = `${zn[1]} µm`;
      if (/\bzn\s?-?ni\b|\bznni\b|zink[\s-]?nickel|zinc[\s-]+nickel/.test(span)) detail = [detail, "ZnNi"].filter(Boolean).join(", ");
    }
    if (p.kind === "povlak") {
      const coat = t.slice(Math.max(0, idx - 5), Math.min(t.length, end + 25))
        .match(/\b(TiN|TiCN|TiAlN|AlTiN|AlCrN|CrN|ZrN|DLC|WC\/C|a-C:H|ta-C|PTFE|Teflon)\b/i)?.[1];
      if (coat) detail = coat.length <= 6 ? normalizeCoating(coat) : coat;
      else if (/pvd/.test(span)) detail = "PVD";
      else if (/cvd/.test(span)) detail = "CVD";
    }
    if (p.kind === "lakovani" || p.kind === "praskove_lakovani") {
      const ral = around.match(/\bral\s?(\d{4})\b/)?.[1];
      if (ral) detail = [detail, `RAL ${ral}`].filter(Boolean).join(", ");
    }
    if (th) detail = [detail, th].filter(Boolean).join(", ");
    surface.push({ kind: p.kind, label: SURFACE_KINDS[p.kind].label, detail, matched: t.slice(idx, end), index: idx, end });
  });
  // Povlaky psané zkratkou s velkými písmeny (TiN ≠ anglické „tin")
  for (const m of t.matchAll(/(?<![A-Za-z])(TiN|TiCN|TiAlN|AlTiN|AlCrN|CrN|ZrN|DLC)(?![A-Za-z])/g)) {
    const idx = m.index ?? 0;
    const end = idx + m[0].length;
    if (overlaps(idx, end)) continue;
    taken.push([idx, end]);
    surface.push({ kind: "povlak", label: SURFACE_KINDS.povlak.label, detail: m[1], matched: m[0], index: idx, end });
  }
  // Práškové lakování: samostatné „RAL 9005" není další lakování
  if (surface.some((s) => s.kind === "praskove_lakovani")) {
    for (const s of [...surface]) {
      if (s.kind === "lakovani" && /^(?:barva\s+)?ral\b/i.test(fold(s.matched))) {
        const pr = surface.find((x) => x.kind === "praskove_lakovani");
        const ral = s.matched.match(/\d{4}/)?.[0];
        if (pr && ral && !(pr.detail ?? "").includes(ral)) pr.detail = [pr.detail, `RAL ${ral}`].filter(Boolean).join(", ");
        surface.splice(surface.indexOf(s), 1);
      }
    }
  }

  // „fosfátovat Zn" / „Zn-fosfát" = zinkový fosfát, ne další (galvanický) zinek
  for (const ph of surface.filter((s) => s.kind === "fosfatovani")) {
    for (const z of [...surface]) {
      if (z.kind !== "galvanicky_zinek" && z.kind !== "zinkovani") continue;
      const between = z.index >= ph.end ? f.slice(ph.end, z.index) : z.end <= ph.index ? f.slice(z.end, ph.index) : null;
      if (between === null || !/^[\s-]{0,3}$|^\s*\(?\s*$/.test(between) || !/^(?:zn|zinek|zink\w*)$/.test(f.slice(z.index, z.end).trim())) continue;
      if (!(ph.detail ?? "").includes("zinkový")) ph.detail = [ph.detail, "zinkový"].filter(Boolean).join(", ");
      surface.splice(surface.indexOf(z), 1);
    }
  }

  // Pasivace / chromátování u zinku = detail zinku, ne samostatná úprava
  const zinc = surface.filter((s) => s.kind === "galvanicky_zinek" || s.kind === "zinkovani" || s.kind === "zinkove_lamely");
  for (const s of [...surface]) {
    if ((s.kind === "pasivace" || s.kind === "chromatovani") && zinc.length) {
      const z = zinc.reduce((best, cur) => (Math.abs(cur.index - s.index) < Math.abs(best.index - s.index) ? cur : best));
      if (Math.abs(z.index - s.index) <= 60) {
        const around = f.slice(Math.max(0, s.index - 20), s.end + 20);
        const col = around.match(/\b(modr\w*|cern\w*|zlut\w*|transparent\w*|bil\w*|silnovrstv\w*|tlustovrstv\w*|dickschicht\w*|blau\w*|schwarz\w*|gelb\w*|blue|black|yellow|clear|trivalent\w*)\b/)?.[1];
        const what = s.kind === "pasivace" ? "pasivace" : "chromátování";
        const word = col ? `${passivColor(col)} ${what}` : what;
        z.detail = [z.detail, word].filter(Boolean).join(", ");
        surface.splice(surface.indexOf(s), 1);
      }
    }
  }

  // Obecné „zinkování" s tloušťkou do 25 µm = galvanický zinek (žárový má 50–100 µm)
  for (const z of surface) {
    if (z.kind !== "zinkovani" || (z.detail ?? "").includes("žárové")) continue;
    const um = (z.detail ?? "").match(/(\d+(?:,\d)?)(?:-(\d+(?:,\d)?))?\s*µm/);
    const top = um ? numFrom(um[2] ?? um[1]) : NaN;
    if (top > 0 && top <= 25) { z.kind = "galvanicky_zinek"; z.label = SURFACE_KINDS.galvanicky_zinek.label; }
  }

  // Mezní tvrdost hloubky vrstvy (HV hned za CHD/Eht/NHT, nebo v závorce za hloubkou: „Eht 0,8 (550 HV1)")
  // není tvrdost povrchu → jde do detailu zpracování, ne do tvrdosti.
  const limitHard = new Set<HardnessMatch>();
  for (const h of hardnessAll) {
    if (!h.unit.startsWith("HV")) continue;
    const pre = f.slice(Math.max(0, h.index - 30), h.index);
    if (/(?:\beht|\bchd|\bnht|\brht|\bsht)\s*[:=]?\s*$/.test(pre)
      || /(?:\beht|\bchd|\bnht|\brht|\bsht)\s*[:=]?\s*\d+(?:[.,]\d+)?(?:\s*(?:-|÷|\+)\s*\d+(?:[.,]\d+)?)?\s*(?:mm)?\s*\(\s*$/.test(pre)) {
      limitHard.add(h);
    }
  }
  // Tvrdost → nejbližší tepelné zpracování (za ním do 60 znaků, jinak před ním do 30)
  const hardKinds: HeatKind[] = ["kaleni", "indukcni_kaleni", "zuslechteni", "cementace", "karbonitridace", "nitridace", "nitrocementace", "popousteni", "precipitacni_vytvrzeni"];
  const unassigned: HardnessMatch[] = [];
  for (const h of hardnessAll) {
    if (limitHard.has(h)) {
      const owner = heat.filter((x) => ["cementace", "karbonitridace", "nitridace", "nitrocementace", "indukcni_kaleni"].includes(x.kind) && x.index <= h.index)
        .sort((a, b) => b.index - a.index)[0] ?? heat.find((x) => x.kind === "cementace" || x.kind === "nitridace" || x.kind === "indukcni_kaleni");
      if (owner) owner.detail = [owner.detail, `mezní tvrdost ${h.value}`].filter(Boolean).join(", ");
      continue;
    }
    const cands = heat.filter((x) => hardKinds.includes(x.kind) && !x.hardness);
    const after = cands.filter((x) => x.index <= h.index && h.index - x.end <= 60).sort((a, b) => b.index - a.index)[0];
    const before = cands.filter((x) => x.index > h.index && x.index - (h.index + h.length) <= 30).sort((a, b) => a.index - b.index)[0];
    const target = after ?? before;
    // popouštění tvrdost nebere, když je v textu kalení (tvrdost patří kalení)
    const target2 = target?.kind === "popousteni" ? (heat.find((x) => x.kind === "kaleni" && !x.hardness) ?? target) : target;
    if (target2) target2.hardness = h.value;
    else unassigned.push(h);
  }
  for (const h of unassigned) {
    if (heat.some((x) => x.hardness === h.value)) continue;
    // Tvrdost bez slova: ≥ 45 HRC (nebo ≥ 450 HV) = kalení, jinak zušlechtění
    const hi = h.max ?? h.min ?? 0;
    const hard = (h.unit.startsWith("HRC") && hi >= 45) || (h.unit.startsWith("HV") && hi >= 450);
    const existing = heat.find((x) => (hard ? x.kind === "kaleni" : x.kind === "zuslechteni") && !x.hardness);
    if (existing) { existing.hardness = h.value; continue; }
    const kind: HeatKind = hard ? "kaleni" : "zuslechteni";
    heat.push({ kind, label: HEAT_KINDS[kind].label, hardness: h.value, inferred: true, matched: t.slice(h.index, h.index + h.length), index: h.index, end: h.index + h.length });
  }

  // Hloubka vrstvy → cementace / nitridace / indukční
  const depthKinds: HeatKind[] = ["cementace", "karbonitridace", "nitridace", "nitrocementace", "indukcni_kaleni"];
  const stops = heat.filter((x) => depthKinds.includes(x.kind)).map((x) => x.index);
  for (const x of heat) {
    if (!depthKinds.includes(x.kind)) continue;
    const d = depthNear(f, x.index, x.end, stops);
    if (d) x.depth = d;
  }
  // Cementace: „kalit" vedle je součást procesu → kalení nechat (tvrdost většinou patří jemu) — ponecháno záměrně.

  // Sloučit stejné druhy (první výskyt), seřadit podle pozice
  const mergeBy = <T extends { kind: string; detail?: string; index: number }>(items: T[], extra: (a: T, b: T) => void): T[] => {
    const out: T[] = [];
    for (const it of items.sort((a, b) => a.index - b.index)) {
      const ex = out.find((o) => o.kind === it.kind);
      if (!ex) { out.push(it); continue; }
      if (it.detail) {
        const have = (ex.detail ?? "").split(", ").filter(Boolean);
        for (const part of it.detail.split(", ")) if (part && !have.includes(part)) have.push(part);
        ex.detail = have.join(", ");
      }
      extra(ex, it);
    }
    return out;
  };
  const heatOut = mergeBy(heat, (a, b) => {
    if (!a.hardness && b.hardness) a.hardness = b.hardness;
    if (!a.depth && b.depth) a.depth = b.depth;
    if (a.inferred && !b.inferred) a.inferred = undefined;
  });
  const surfaceOut = mergeBy(surface, () => undefined);

  // „bez TZ" / „bez PÚ" jen když nic jiného
  const heatFinal = heatOut.length > 1 ? heatOut.filter((h) => h.kind !== "bez_tz") : heatOut;
  const surfFinal = surfaceOut.length > 1 ? surfaceOut.filter((s) => s.kind !== "bez_upravy") : surfaceOut;

  return {
    heat: heatFinal.map(({ index: _i, end: _e, ...rest }) => clean(rest)),
    surface: surfFinal.map(({ index: _i, end: _e, ...rest }) => clean(rest)),
    hardness: hardnessAll.filter((h) => !limitHard.has(h)).map((h) => h.value),
  };
}

function clean<T extends object>(o: T): T {
  for (const k of Object.keys(o) as Array<keyof T>) if (o[k] === undefined) delete o[k];
  return o;
}

function normalizeCoating(c: string): string {
  const map: Record<string, string> = { tin: "TiN", ticn: "TiCN", tialn: "TiAlN", altin: "AlTiN", alcrn: "AlCrN", crn: "CrN", zrn: "ZrN", dlc: "DLC", "wc/c": "WC/C", ptfe: "PTFE" };
  return map[c.toLowerCase()] ?? c;
}

function passivColor(c: string): string {
  if (/^(modr|blau|blue)/.test(c)) return "modrá";
  if (/^(cern|schwarz|black)/.test(c)) return "černá";
  if (/^(zlut|gelb|yellow)/.test(c)) return "žlutá";
  if (/^(transparent|clear|bil)/.test(c)) return "transparentní";
  if (/^(silnovrstv|tlustovrstv|dickschicht)/.test(c)) return "silnovrstvá";
  if (/^trivalent/.test(c)) return "Cr(III)";
  return c;
}

/** „kalení 58-60 HRC (vakuově); popouštění" — do sloupce heat_treatment. */
function plainLabel(label: string): string {
  const base = label.replace(/\s*\(.*\)\s*$/, "");
  return base.charAt(0).toLowerCase() + base.slice(1);
}

export function formatHeatTreatments(items: HeatTreatmentItem[]): string {
  return items.map((h) => {
    let s = plainLabel(h.label);
    if (h.hardness) s += ` ${h.hardness}`;
    if (h.depth) s += `, hloubka ${h.depth}`;
    if (h.detail) s += ` (${h.detail})`;
    return s;
  }).join("; ");
}

/** „galvanický zinek (8 µm, modrá pasivace); tryskání" — do sloupce surface_treatment. */
export function formatSurfaceTreatments(items: SurfaceTreatmentItem[]): string {
  return items.map((s) => `${plainLabel(s.label)}${s.detail ? ` (${s.detail})` : ""}`).join("; ");
}
