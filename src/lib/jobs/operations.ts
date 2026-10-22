import {
  Disc3, Cog, Gem, Flame, SprayCan, Zap, Sparkles, Drill, Wrench, Layers, Puzzle, Ruler, Truck,
  PackageCheck, CircleDot, Clock, Loader, CircleCheck, AlertTriangle, SkipForward,
  type LucideIcon,
} from "lucide-react";

/**
 * Výrobní operace zakázky (podrobný postup výroby). Každý druh má vlastní
 * barvu a ikonu — v detailu zakázky i v řádku knihy je hned vidět, kde se
 * díl právě nachází. Třídy Tailwindu jsou vypsané celé (JIT).
 */

export type OperationKind =
  | "soustruzeni" | "frezovani" | "brouseni" | "tepelne_zpracovani" | "povrchova_uprava"
  | "dratove_rezani" | "elektroeroze" | "vrtani" | "svarovani" | "plech" | "montaz"
  | "kontrola" | "doprava" | "kompletni_dodavka" | "jine";

export type OperationStatus = "ceka" | "probiha" | "hotovo" | "problem" | "preskoceno";

export interface OperationKindMeta {
  key: OperationKind;
  label: string;
  short: string;
  icon: LucideIcon;
  badge: string;
  solid: string;
  dot: string;
  text: string;
}

export const OPERATION_KINDS: Record<OperationKind, OperationKindMeta> = {
  soustruzeni: { key: "soustruzeni", label: "Soustružení", short: "Soustruh", icon: Disc3, badge: "bg-sky-100 text-sky-800 dark:bg-sky-500/15 dark:text-sky-300", solid: "bg-sky-500 text-white", dot: "bg-sky-500", text: "text-sky-600 dark:text-sky-400" },
  frezovani: { key: "frezovani", label: "Frézování", short: "Fréza", icon: Cog, badge: "bg-blue-100 text-blue-800 dark:bg-blue-500/15 dark:text-blue-300", solid: "bg-blue-600 text-white", dot: "bg-blue-600", text: "text-blue-600 dark:text-blue-400" },
  brouseni: { key: "brouseni", label: "Broušení", short: "Bruska", icon: Gem, badge: "bg-indigo-100 text-indigo-800 dark:bg-indigo-500/15 dark:text-indigo-300", solid: "bg-indigo-500 text-white", dot: "bg-indigo-500", text: "text-indigo-600 dark:text-indigo-400" },
  tepelne_zpracovani: { key: "tepelne_zpracovani", label: "Tepelné zpracování", short: "Kalení", icon: Flame, badge: "bg-orange-100 text-orange-800 dark:bg-orange-500/15 dark:text-orange-300", solid: "bg-orange-500 text-white", dot: "bg-orange-500", text: "text-orange-600 dark:text-orange-400" },
  povrchova_uprava: { key: "povrchova_uprava", label: "Povrchová úprava", short: "Povrch", icon: SprayCan, badge: "bg-purple-100 text-purple-800 dark:bg-purple-500/15 dark:text-purple-300", solid: "bg-purple-500 text-white", dot: "bg-purple-500", text: "text-purple-600 dark:text-purple-400" },
  dratove_rezani: { key: "dratove_rezani", label: "Drátové řezání", short: "Drát", icon: Zap, badge: "bg-yellow-100 text-yellow-800 dark:bg-yellow-500/15 dark:text-yellow-300", solid: "bg-yellow-500 text-yellow-950", dot: "bg-yellow-500", text: "text-yellow-700 dark:text-yellow-400" },
  elektroeroze: { key: "elektroeroze", label: "Elektroeroze (hloubení)", short: "Eroze", icon: Sparkles, badge: "bg-amber-100 text-amber-800 dark:bg-amber-500/15 dark:text-amber-300", solid: "bg-amber-500 text-white", dot: "bg-amber-500", text: "text-amber-600 dark:text-amber-400" },
  vrtani: { key: "vrtani", label: "Vrtání / závitování", short: "Vrtání", icon: Drill, badge: "bg-cyan-100 text-cyan-800 dark:bg-cyan-500/15 dark:text-cyan-300", solid: "bg-cyan-500 text-white", dot: "bg-cyan-500", text: "text-cyan-600 dark:text-cyan-400" },
  svarovani: { key: "svarovani", label: "Svařování", short: "Svár", icon: Wrench, badge: "bg-red-100 text-red-800 dark:bg-red-500/15 dark:text-red-300", solid: "bg-red-500 text-white", dot: "bg-red-500", text: "text-red-600 dark:text-red-400" },
  plech: { key: "plech", label: "Plech (laser, ohyb)", short: "Plech", icon: Layers, badge: "bg-teal-100 text-teal-800 dark:bg-teal-500/15 dark:text-teal-300", solid: "bg-teal-500 text-white", dot: "bg-teal-500", text: "text-teal-600 dark:text-teal-400" },
  montaz: { key: "montaz", label: "Montáž", short: "Montáž", icon: Puzzle, badge: "bg-fuchsia-100 text-fuchsia-800 dark:bg-fuchsia-500/15 dark:text-fuchsia-300", solid: "bg-fuchsia-500 text-white", dot: "bg-fuchsia-500", text: "text-fuchsia-600 dark:text-fuchsia-400" },
  kontrola: { key: "kontrola", label: "Kontrola / měření", short: "Kontrola", icon: Ruler, badge: "bg-emerald-100 text-emerald-800 dark:bg-emerald-500/15 dark:text-emerald-300", solid: "bg-emerald-600 text-white", dot: "bg-emerald-600", text: "text-emerald-700 dark:text-emerald-400" },
  doprava: { key: "doprava", label: "Doprava", short: "Doprava", icon: Truck, badge: "bg-slate-200 text-slate-700 dark:bg-slate-500/20 dark:text-slate-300", solid: "bg-slate-600 text-white", dot: "bg-slate-500", text: "text-slate-600 dark:text-slate-400" },
  kompletni_dodavka: { key: "kompletni_dodavka", label: "Kompletní dodávka", short: "Komplet", icon: PackageCheck, badge: "bg-lime-100 text-lime-800 dark:bg-lime-500/15 dark:text-lime-300", solid: "bg-lime-600 text-white", dot: "bg-lime-600", text: "text-lime-700 dark:text-lime-400" },
  jine: { key: "jine", label: "Jiná operace", short: "Jiné", icon: CircleDot, badge: "bg-zinc-200 text-zinc-700 dark:bg-zinc-500/20 dark:text-zinc-300", solid: "bg-zinc-500 text-white", dot: "bg-zinc-400", text: "text-zinc-600 dark:text-zinc-400" },
};

/** Pořadí v nabídce „Přidat operaci" (nejčastější první). */
export const OPERATION_KIND_ORDER: OperationKind[] = [
  "soustruzeni", "frezovani", "tepelne_zpracovani", "brouseni", "povrchova_uprava", "dratove_rezani",
  "elektroeroze", "vrtani", "svarovani", "plech", "montaz", "kontrola", "doprava", "kompletni_dodavka", "jine",
];

export interface OperationStatusMeta {
  key: OperationStatus;
  label: string;
  icon: LucideIcon;
  badge: string;
  dot: string;
}

export const OPERATION_STATUSES: Record<OperationStatus, OperationStatusMeta> = {
  ceka: { key: "ceka", label: "Čeká", icon: Clock, badge: "bg-muted text-muted-foreground", dot: "bg-zinc-300 dark:bg-zinc-600" },
  probiha: { key: "probiha", label: "Probíhá", icon: Loader, badge: "bg-amber-100 text-amber-800 dark:bg-amber-500/15 dark:text-amber-300", dot: "bg-amber-500" },
  hotovo: { key: "hotovo", label: "Hotovo", icon: CircleCheck, badge: "bg-green-100 text-green-800 dark:bg-green-500/15 dark:text-green-300", dot: "bg-green-500" },
  problem: { key: "problem", label: "Problém", icon: AlertTriangle, badge: "bg-red-100 text-red-700 dark:bg-red-500/15 dark:text-red-300", dot: "bg-red-500" },
  preskoceno: { key: "preskoceno", label: "Přeskočeno", icon: SkipForward, badge: "bg-muted text-muted-foreground line-through", dot: "bg-zinc-200 dark:bg-zinc-700" },
};

/** Další stav jedním klepnutím: čeká → probíhá → hotovo. */
export function nextOperationStatus(status: OperationStatus): OperationStatus | null {
  if (status === "ceka") return "probiha";
  if (status === "probiha" || status === "problem") return "hotovo";
  return null;
}

/** Šablony postupů pro rychlé založení. */
export const OPERATION_TEMPLATES: { key: string; label: string; kinds: OperationKind[] }[] = [
  { key: "komplet", label: "Kompletní dodávka (jedna firma)", kinds: ["kompletni_dodavka"] },
  { key: "soustruzeny", label: "Soustružený díl — kalený a broušený", kinds: ["soustruzeni", "tepelne_zpracovani", "brouseni", "povrchova_uprava"] },
  { key: "frezovany", label: "Frézovaný díl — kalený a broušený", kinds: ["frezovani", "tepelne_zpracovani", "brouseni", "povrchova_uprava"] },
  { key: "nastroj", label: "Nástroj (soustruh → fréza → kalení → bruska → drát)", kinds: ["soustruzeni", "frezovani", "tepelne_zpracovani", "brouseni", "dratove_rezani", "kontrola"] },
  { key: "svarenec", label: "Svařenec (plech → svár → obrábění → povrch)", kinds: ["plech", "svarovani", "frezovani", "povrchova_uprava"] },
];

export function isOperationKind(v: unknown): v is OperationKind {
  return typeof v === "string" && v in OPERATION_KINDS;
}

export function isOperationStatus(v: unknown): v is OperationStatus {
  return typeof v === "string" && v in OPERATION_STATUSES;
}

/** Popisek „kde se to nachází" pro řádek knihy. */
export function productionLabel(step: string | null, location: string | null): string | null {
  if (!step) return null;
  if (step === "hotovo") return "Výroba hotová";
  const kind = isOperationKind(step) ? OPERATION_KINDS[step].label : step;
  return location ? `${kind} · ${location}` : kind;
}
