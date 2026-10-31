import {
  MessageSquareQuote, Calculator, FileText, ShoppingCart, BadgeCheck, Factory, PackageOpen,
  Warehouse, Wrench, Truck, ReceiptText, CircleCheckBig, PauseCircle, AlertTriangle, CircleSlash, Ban,
  type LucideIcon,
} from "lucide-react";
import type { JobStage } from "@/lib/supabase/database.types";

/**
 * Stavy zakázky v Knize zakázek — jediný zdroj pravdy pro popisky, barvy,
 * ikony a pořadí. Každý stav má vlastní barvu, ať se v knize vyzná i nový
 * zaměstnanec na první pohled. Třídy Tailwindu jsou vypsané celé (JIT je musí
 * najít v souboru), proto se nikde neskládají z částí.
 */

export interface StageMeta {
  key: JobStage;
  label: string;
  /** Krátký popisek do úzkých míst (chip na mobilu). */
  short: string;
  description: string;
  icon: LucideIcon;
  /** Měkký odznak: pozadí + text (světlý i tmavý režim). */
  badge: string;
  /** Plná barva — aktivní chip filtru, tlačítko (kontrast textu ≥ 4,5 : 1). */
  solid: string;
  /** Tečka / proužek. */
  dot: string;
  /** Levý barevný pruh řádku v knize. */
  bar: string;
  /** Jemný rámeček (karta na mobilu, zvýraznění). */
  ring: string;
  /** Text v barvě stavu. */
  text: string;
  /** HEX pro PDF, grafy a e-maily. */
  hex: string;
  /** main = běžný tok, optional = volitelný krok toku, side = speciální stav mimo tok. */
  kind: "main" | "optional" | "side";
}

export const STAGES: Record<JobStage, StageMeta> = {
  poptavka: {
    key: "poptavka", label: "Poptávka", short: "Poptávka",
    description: "Zákazník poptal díl — čeká na nacenění.",
    icon: MessageSquareQuote,
    badge: "bg-sky-100 text-sky-800 dark:bg-sky-500/15 dark:text-sky-300",
    solid: "bg-sky-700 text-white", dot: "bg-sky-500", bar: "bg-sky-500",
    ring: "ring-sky-500/30 border-sky-200 dark:border-sky-500/30", text: "text-sky-600 dark:text-sky-400",
    hex: "#0ea5e9", kind: "main",
  },
  naceneni: {
    key: "naceneni", label: "Nacenění", short: "Nacenění",
    description: "Připravujeme cenu (ručně, AI se zatím jen učí).",
    icon: Calculator,
    badge: "bg-amber-100 text-amber-800 dark:bg-amber-500/15 dark:text-amber-300",
    solid: "bg-amber-400 text-amber-950", dot: "bg-amber-500", bar: "bg-amber-500",
    ring: "ring-amber-500/30 border-amber-200 dark:border-amber-500/30", text: "text-amber-600 dark:text-amber-400",
    hex: "#f59e0b", kind: "main",
  },
  nabidka: {
    key: "nabidka", label: "Nabídka odeslaná", short: "Nabídka",
    description: "Nabídka odešla zákazníkovi — čekáme na objednávku.",
    icon: FileText,
    badge: "bg-violet-100 text-violet-800 dark:bg-violet-500/15 dark:text-violet-300",
    solid: "bg-violet-700 text-white", dot: "bg-violet-500", bar: "bg-violet-500",
    ring: "ring-violet-500/30 border-violet-200 dark:border-violet-500/30", text: "text-violet-600 dark:text-violet-400",
    hex: "#8b5cf6", kind: "main",
  },
  objednavka: {
    key: "objednavka", label: "Objednávka", short: "Objednávka",
    description: "Zákazník objednal — potvrď objednávku.",
    icon: ShoppingCart,
    badge: "bg-orange-100 text-orange-800 dark:bg-orange-500/15 dark:text-orange-300",
    solid: "bg-orange-700 text-white", dot: "bg-orange-500", bar: "bg-orange-500",
    ring: "ring-orange-500/30 border-orange-200 dark:border-orange-500/30", text: "text-orange-600 dark:text-orange-400",
    hex: "#f97316", kind: "main",
  },
  potvrzeno: {
    key: "potvrzeno", label: "Potvrzená objednávka", short: "Potvrzeno",
    description: "Objednávka potvrzena zákazníkovi, termín slíben.",
    icon: BadgeCheck,
    badge: "bg-indigo-100 text-indigo-800 dark:bg-indigo-500/15 dark:text-indigo-300",
    solid: "bg-indigo-700 text-white", dot: "bg-indigo-500", bar: "bg-indigo-500",
    ring: "ring-indigo-500/30 border-indigo-200 dark:border-indigo-500/30", text: "text-indigo-600 dark:text-indigo-400",
    hex: "#6366f1", kind: "main",
  },
  ve_vyrobe: {
    key: "ve_vyrobe", label: "Ve výrobě", short: "Výroba",
    description: "Vyrábí se — u nás nebo u dodavatele.",
    icon: Factory,
    badge: "bg-yellow-100 text-yellow-800 dark:bg-yellow-500/15 dark:text-yellow-300",
    solid: "bg-yellow-500 text-yellow-950", dot: "bg-yellow-500", bar: "bg-yellow-500",
    ring: "ring-yellow-500/30 border-yellow-200 dark:border-yellow-500/30", text: "text-yellow-700 dark:text-yellow-400",
    hex: "#eab308", kind: "main",
  },
  dodano_k_nam: {
    key: "dodano_k_nam", label: "Dodáno k nám", short: "U nás",
    description: "Hotové díly jsou u nás — od dodavatele nebo z naší výroby.",
    icon: PackageOpen,
    badge: "bg-cyan-100 text-cyan-800 dark:bg-cyan-500/15 dark:text-cyan-300",
    solid: "bg-cyan-700 text-white", dot: "bg-cyan-500", bar: "bg-cyan-500",
    ring: "ring-cyan-500/30 border-cyan-200 dark:border-cyan-500/30", text: "text-cyan-600 dark:text-cyan-400",
    hex: "#06b6d4", kind: "main",
  },
  na_sklade: {
    key: "na_sklade", label: "Na skladě", short: "Sklad",
    description: "Leží u nás skladem — čeká na expedici.",
    icon: Warehouse,
    badge: "bg-teal-100 text-teal-800 dark:bg-teal-500/15 dark:text-teal-300",
    solid: "bg-teal-700 text-white", dot: "bg-teal-500", bar: "bg-teal-500",
    ring: "ring-teal-500/30 border-teal-200 dark:border-teal-500/30", text: "text-teal-600 dark:text-teal-400",
    hex: "#14b8a6", kind: "optional",
  },
  montaz: {
    key: "montaz", label: "Montáž", short: "Montáž",
    description: "Probíhá montáž / kompletace před dodáním.",
    icon: Wrench,
    badge: "bg-fuchsia-100 text-fuchsia-800 dark:bg-fuchsia-500/15 dark:text-fuchsia-300",
    solid: "bg-fuchsia-700 text-white", dot: "bg-fuchsia-500", bar: "bg-fuchsia-500",
    ring: "ring-fuchsia-500/30 border-fuchsia-200 dark:border-fuchsia-500/30", text: "text-fuchsia-600 dark:text-fuchsia-400",
    hex: "#d946ef", kind: "optional",
  },
  dodano_zakaznikovi: {
    key: "dodano_zakaznikovi", label: "Dodáno zákazníkovi", short: "Dodáno",
    description: "Zboží předáno zákazníkovi — vystav fakturu.",
    icon: Truck,
    badge: "bg-green-100 text-green-800 dark:bg-green-500/15 dark:text-green-300",
    solid: "bg-green-700 text-white", dot: "bg-green-500", bar: "bg-green-500",
    ring: "ring-green-500/30 border-green-200 dark:border-green-500/30", text: "text-green-600 dark:text-green-400",
    hex: "#22c55e", kind: "main",
  },
  fakturovano: {
    key: "fakturovano", label: "Vyfakturováno", short: "Faktura",
    description: "Faktura vystavena — čeká se na úhradu.",
    icon: ReceiptText,
    badge: "bg-emerald-100 text-emerald-800 dark:bg-emerald-500/15 dark:text-emerald-300",
    solid: "bg-emerald-700 text-white", dot: "bg-emerald-600", bar: "bg-emerald-600",
    ring: "ring-emerald-500/30 border-emerald-200 dark:border-emerald-500/30", text: "text-emerald-700 dark:text-emerald-400",
    hex: "#059669", kind: "main",
  },
  dokonceno: {
    key: "dokonceno", label: "Dokončeno", short: "Hotovo",
    description: "Zakázka uzavřena a zaplacena.",
    icon: CircleCheckBig,
    badge: "bg-slate-200 text-slate-700 dark:bg-slate-500/20 dark:text-slate-300",
    solid: "bg-slate-600 text-white", dot: "bg-slate-500", bar: "bg-slate-400",
    ring: "ring-slate-500/30 border-slate-200 dark:border-slate-500/30", text: "text-slate-600 dark:text-slate-400",
    hex: "#64748b", kind: "main",
  },
  pozastaveno: {
    key: "pozastaveno", label: "Pozastaveno", short: "Pauza",
    description: "Zakázka stojí — čeká na zákazníka či dodavatele.",
    icon: PauseCircle,
    badge: "bg-zinc-200 text-zinc-700 dark:bg-zinc-500/20 dark:text-zinc-300",
    solid: "bg-zinc-600 text-white", dot: "bg-zinc-400", bar: "bg-zinc-400",
    ring: "ring-zinc-500/30 border-zinc-200 dark:border-zinc-500/30", text: "text-zinc-600 dark:text-zinc-400",
    hex: "#a1a1aa", kind: "side",
  },
  reklamace: {
    key: "reklamace", label: "Reklamace", short: "Reklamace",
    description: "Zákazník reklamuje — řeš přednostně.",
    icon: AlertTriangle,
    badge: "bg-pink-100 text-pink-800 dark:bg-pink-500/15 dark:text-pink-300",
    solid: "bg-pink-700 text-white", dot: "bg-pink-500", bar: "bg-pink-500",
    ring: "ring-pink-500/30 border-pink-200 dark:border-pink-500/30", text: "text-pink-600 dark:text-pink-400",
    hex: "#ec4899", kind: "side",
  },
  nerealizovano: {
    key: "nerealizovano", label: "Nerealizováno", short: "Nerealiz.",
    description: "Zákazník neobjednal (prohraná nabídka).",
    icon: CircleSlash,
    badge: "bg-stone-200 text-stone-700 dark:bg-stone-500/20 dark:text-stone-300",
    solid: "bg-stone-600 text-white", dot: "bg-stone-400", bar: "bg-stone-300",
    ring: "ring-stone-500/30 border-stone-200 dark:border-stone-500/30", text: "text-stone-600 dark:text-stone-400",
    hex: "#a8a29e", kind: "side",
  },
  zruseno: {
    key: "zruseno", label: "Zrušeno", short: "Zrušeno",
    description: "Zakázka zrušena.",
    icon: Ban,
    badge: "bg-red-100 text-red-700 dark:bg-red-500/15 dark:text-red-300",
    solid: "bg-red-700 text-white", dot: "bg-red-500", bar: "bg-red-400",
    ring: "ring-red-500/30 border-red-200 dark:border-red-500/30", text: "text-red-600 dark:text-red-400",
    hex: "#ef4444", kind: "side",
  },
};

/** Všechny stavy v pořadí zobrazení (tok → volitelné → speciální). */
export const STAGE_ORDER: JobStage[] = [
  "poptavka", "naceneni", "nabidka", "objednavka", "potvrzeno", "ve_vyrobe",
  "dodano_k_nam", "na_sklade", "montaz", "dodano_zakaznikovi", "fakturovano", "dokonceno",
  "pozastaveno", "reklamace", "nerealizovano", "zruseno",
];

/** Běžný tok zakázky (bez volitelných kroků). */
export const MAIN_FLOW: JobStage[] = [
  "poptavka", "naceneni", "nabidka", "objednavka", "potvrzeno", "ve_vyrobe",
  "dodano_k_nam", "dodano_zakaznikovi", "fakturovano", "dokonceno",
];

/** Speciální stavy mimo tok. */
export const SIDE_STAGES: JobStage[] = ["pozastaveno", "reklamace", "nerealizovano", "zruseno"];

/** Uzavřené stavy — zakázka už nehoří, nehlídáme termíny. */
export const CLOSED_STAGES: JobStage[] = ["dokonceno", "nerealizovano", "zruseno"];

/** Stavy, kdy je zboží už u zákazníka (termín dodání splněn). */
export const DELIVERED_STAGES: JobStage[] = ["dodano_zakaznikovi", "fakturovano", "dokonceno"];

/** Stavy toku od objednávky do dodání — zakázka v nich ještě nemá vystavený dodací list na vše (pokud se stav neopozdil). */
export const PRE_DELIVERY_STAGES: JobStage[] = ["objednavka", "potvrzeno", "ve_vyrobe", "dodano_k_nam", "na_sklade", "montaz"];

/**
 * Objednávky v běhu (Kniha → Objednávky, „Objednávky v běhu", „Hodnota v běhu"): od objednávky do vystavení
 * dodacího listu, vč. pozastavených a reklamací (ty chtějí pozornost i po dodání). Dodáno zákazníkovi,
 * vyfakturováno a dokončeno = Dokončené.
 */
export const RUNNING_ORDER_STAGES: JobStage[] = [...PRE_DELIVERY_STAGES, "pozastaveno", "reklamace"];

/**
 * Zboží je u zákazníka (vystavený DL na celou dodávku): stav Dodáno zákazníkovi a dál, nebo stav toku před
 * dodáním, ve kterém má zakázka dodané všechny položky (stav se neposunul — ruční vrácení, starší data).
 * Částečná dodávka = ne (zakázka zůstává v běhu). Pozastavené a reklamace se neposouvají.
 * Fakta položek = orders.items_count / items_delivered (udržuje DB, jako job_flow_v).
 */
export function isDeliveredToCustomer(j: {
  stage: JobStage;
  flow?: { itemsCount?: number | null; itemsDelivered?: number | null } | null;
}): boolean {
  if (DELIVERED_STAGES.includes(j.stage)) return true;
  if (!PRE_DELIVERY_STAGES.includes(j.stage)) return false;
  const count = Number(j.flow?.itemsCount ?? 0);
  return count > 0 && Number(j.flow?.itemsDelivered ?? 0) >= count;
}

/** Objednávka v běhu = stav objednávky… a zboží ještě není celé u zákazníka (bez DL na vše). */
export function isRunningOrder(j: Parameters<typeof isDeliveredToCustomer>[0]): boolean {
  return RUNNING_ORDER_STAGES.includes(j.stage) && !isDeliveredToCustomer(j);
}

export function isJobStage(value: unknown): value is JobStage {
  return typeof value === "string" && value in STAGES;
}

export function stageMeta(stage: JobStage): StageMeta {
  return STAGES[stage] ?? STAGES.poptavka;
}

/**
 * Pořadí stavu v toku (pro „posouvej jen dopředu"). Speciální stavy = -1,
 * ty AI ani import nikdy automaticky nemění.
 */
const RANK: Partial<Record<JobStage, number>> = {
  poptavka: 0, naceneni: 1, nabidka: 2, objednavka: 3, potvrzeno: 4, ve_vyrobe: 5,
  dodano_k_nam: 6, na_sklade: 7, montaz: 8, dodano_zakaznikovi: 9, fakturovano: 10, dokonceno: 11,
};

export function stageRank(stage: JobStage): number {
  return RANK[stage] ?? -1;
}

/** Další krok běžného toku (tlačítko „Posunout"). Speciální stavy nemají další krok. */
export function nextStage(stage: JobStage): JobStage | null {
  if (stage === "na_sklade" || stage === "montaz") return "dodano_zakaznikovi";
  const i = MAIN_FLOW.indexOf(stage);
  if (i < 0 || i >= MAIN_FLOW.length - 1) return null;
  return MAIN_FLOW[i + 1];
}

/** Je `to` v toku dál než `from`? (speciální stavy se nikdy nepřepisují automaticky) */
export function isForward(from: JobStage, to: JobStage): boolean {
  const a = stageRank(from);
  const b = stageRank(to);
  return a >= 0 && b > a;
}

// ── Skupiny pro filtry knihy ────────────────────────────────
export type StageGroupKey =
  | "aktivni" | "obchod" | "realizace" | "dodano" | "problem"
  | "uzavrene" | "nerealizovane" | "zrusene" | "vse";

export interface StageGroup {
  key: StageGroupKey;
  label: string;
  stages: JobStage[];
}

export const STAGE_GROUPS: StageGroup[] = [
  { key: "aktivni", label: "Aktivní", stages: STAGE_ORDER.filter((s) => !CLOSED_STAGES.includes(s)) },
  { key: "obchod", label: "Poptávky & nabídky", stages: ["poptavka", "naceneni", "nabidka"] },
  { key: "realizace", label: "V realizaci", stages: ["objednavka", "potvrzeno", "ve_vyrobe", "dodano_k_nam", "na_sklade", "montaz"] },
  { key: "dodano", label: "Dodáno & fakturace", stages: ["dodano_zakaznikovi", "fakturovano"] },
  { key: "problem", label: "Pozastavené & reklamace", stages: ["pozastaveno", "reklamace"] },
  { key: "uzavrene", label: "Dokončené", stages: ["dokonceno"] },
  { key: "nerealizovane", label: "Nerealizované", stages: ["nerealizovano"] },
  { key: "zrusene", label: "Zrušené", stages: ["zruseno"] },
  { key: "vse", label: "Vše", stages: STAGE_ORDER },
];

export function stageGroup(key: StageGroupKey): StageGroup {
  return STAGE_GROUPS.find((g) => g.key === key) ?? STAGE_GROUPS[0];
}
