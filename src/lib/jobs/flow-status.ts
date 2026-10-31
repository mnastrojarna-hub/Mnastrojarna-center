import {
  Inbox, UserRoundCheck, FileQuestion, CircleCheck, CircleX, Undo2, CircleCheckBig, Hourglass, PenLine, Calculator,
  Trophy, ThumbsDown, Archive, MessageSquareWarning, Send, ShieldCheck, ShieldQuestion, FilePen, CalendarX,
  ShoppingCart, GitCompare, BadgeCheck, RefreshCw, Ban, PackageCheck, CircleDotDashed, Factory, FilePlus, FileCheck,
  MailCheck, FileX, ClipboardCheck, Truck, Package, Banknote, AlarmClock, Sparkles, Hand, Camera, Mail, Cog, Upload,
  Clock, Globe, Database, CircleSlash, Pencil, Undo, CalendarPlus, ThumbsUp, Handshake, ReceiptText, Wrench,
  ArrowRightCircle, Flag, CalendarClock, CalendarX2, UserRoundX, FileSignature, PauseCircle, PlayCircle, PackageX,
  AlertTriangle, ClipboardPen, FileDiff,
  type LucideIcon,
} from "lucide-react";
import type { Feature } from "@/lib/auth/permissions";
import type { PersonRef } from "@/lib/jobs/types";
import type {
  JobStage, QuoteStatus, InquiryStatus, OrderDocStatus, QuoteState, LostReason, ChangeVia, ActorKind, FlowCause,
  FlowProposal, OrderMismatch, PurchaseOrderStatus,
} from "@/lib/supabase/database.types";

export type { InquiryStatus, OrderDocStatus, QuoteState, LostReason, ChangeVia, ActorKind, FlowCause };

/**
 * Podrobné stavy obchodního toku — JEDINÝ zdroj pravdy pro UI (štítky, barvy, ikony, přechody,
 * další krok, chip řádku, náhled dopadu korekce, „kdo · kdy“). Odvozené stavy zrcadlí SQL view
 * job_flow_v (migrace 20261023100000) — shodu hlídá integrační test parity.
 * Třídy Tailwindu jsou vypsané celé (JIT je musí najít jako literály) — nikdy je neskládat.
 */

// ── Typy ────────────────────────────────────────────────────
export type FlowPhase = "inquiry" | "pricing" | "quote" | "order" | "fulfilment" | "confirmation"
  | "delivery" | "payment" | "purchase" | "proposal";
export type FlowTone = "action" | "work" | "wait" | "partial" | "ok" | "problem" | "lost" | "cancel" | "archive" | "proposal";
export type FlowHue = "sky" | "amber" | "violet" | "orange" | "indigo" | "yellow" | "green" | "emerald" | "lime";
/** Klíče palety — přesně tabulka 1.0 specifikace (jen použité kombinace). */
export type PaletteKey =
  | "sky.action" | "sky.work" | "sky.wait" | "sky.ok"
  | "amber.action" | "amber.work" | "amber.wait" | "amber.ok"
  | "violet.action" | "violet.work" | "violet.wait" | "violet.ok"
  | "orange.action"
  | "indigo.action" | "indigo.work" | "indigo.wait" | "indigo.ok"
  | "yellow.work"
  | "green.action" | "green.work" | "green.partial" | "green.ok"
  | "emerald.wait" | "emerald.partial" | "emerald.ok"
  | "lime.partial"
  | "rose.problem" | "stone.lost" | "red.cancel" | "muted.archive" | "ghost.proposal";
export type PricingState = "ceka" | "ceka_na_dodavatele" | "rozpracovano" | "naceneno";
export type QuoteDisplayState = QuoteState | "vyprsela";
export type FulfilmentState = "ve_vyrobe" | "castecne_dodana" | "dokoncena";
export type ConfirmationState = "k_vystaveni" | "vystaveno" | "odeslano" | "bez_dokladu";
export type DeliveryState = "k_expedici" | "castecne" | "dodano" | "dl_potvrzen";
export type PaymentState = "ceka_na_uhradu" | "castecne_zaplaceno" | "po_splatnosti" | "zaplaceno";
export type PurchaseExtraState = "castecne_dodana" | "po_terminu";
/** Fáze s ručními přechody. */
export type TransitionPhase = "inquiry" | "quote" | "order";
/** Fáze pro práva a důvody (job = hlavní stav zakázky). */
export type ReasonPhase = TransitionPhase | "job";

export interface PaletteClasses {
  /** Chip / odznak. */
  badge: string;
  /** Tečka nebo proužek. */
  dot: string;
  /** Aktivní chip filtru, primární tlačítko (kontrast textu ≥ 4,5 : 1). */
  solid: string;
  /** Najetí myší u plné barvy — celý literál, aby twMerge přebil hover výchozí varianty Buttonu. */
  hover: string;
  /** Text v barvě stavu. */
  text: string;
}

// ── Paleta (tabulka 1.0) ────────────────────────────────────
export const FLOW_PALETTE: Record<PaletteKey, PaletteClasses> = {
  "sky.action": {
    badge: "bg-sky-50 text-sky-800 ring-1 ring-inset ring-sky-400 dark:bg-sky-500/10 dark:text-sky-200 dark:ring-sky-400/50",
    dot: "bg-sky-500", solid: "bg-sky-700 text-white", hover: "hover:bg-sky-800", text: "text-sky-700 dark:text-sky-300",
  },
  "sky.work": {
    badge: "bg-sky-100 text-sky-800 dark:bg-sky-500/15 dark:text-sky-300",
    dot: "bg-sky-400", solid: "bg-sky-700 text-white", hover: "hover:bg-sky-800", text: "text-sky-700 dark:text-sky-300",
  },
  "sky.wait": {
    badge: "border border-dashed border-sky-400 bg-transparent text-sky-700 dark:border-sky-400/60 dark:text-sky-300",
    dot: "bg-sky-300 dark:bg-sky-500/60", solid: "bg-sky-700 text-white", hover: "hover:bg-sky-800", text: "text-sky-600 dark:text-sky-300",
  },
  "sky.ok": {
    badge: "bg-sky-700 text-white dark:bg-sky-500 dark:text-sky-950",
    dot: "bg-sky-600", solid: "bg-sky-800 text-white", hover: "hover:bg-sky-900", text: "text-sky-700 dark:text-sky-300",
  },
  "amber.action": {
    badge: "bg-amber-50 text-amber-900 ring-1 ring-inset ring-amber-400 dark:bg-amber-500/10 dark:text-amber-200 dark:ring-amber-400/50",
    dot: "bg-amber-500", solid: "bg-amber-400 text-amber-950", hover: "hover:bg-amber-300", text: "text-amber-700 dark:text-amber-300",
  },
  "amber.work": {
    badge: "bg-amber-100 text-amber-900 dark:bg-amber-500/15 dark:text-amber-300",
    dot: "bg-amber-400", solid: "bg-amber-400 text-amber-950", hover: "hover:bg-amber-300", text: "text-amber-700 dark:text-amber-300",
  },
  "amber.wait": {
    badge: "border border-dashed border-amber-400 bg-transparent text-amber-800 dark:border-amber-400/60 dark:text-amber-300",
    dot: "bg-amber-300 dark:bg-amber-500/60", solid: "bg-amber-400 text-amber-950", hover: "hover:bg-amber-300", text: "text-amber-700 dark:text-amber-300",
  },
  "amber.ok": {
    badge: "bg-amber-500 text-amber-950 dark:bg-amber-400 dark:text-amber-950",
    dot: "bg-amber-500", solid: "bg-amber-500 text-amber-950", hover: "hover:bg-amber-400", text: "text-amber-700 dark:text-amber-300",
  },
  "violet.action": {
    badge: "bg-violet-50 text-violet-800 ring-1 ring-inset ring-violet-400 dark:bg-violet-500/10 dark:text-violet-200 dark:ring-violet-400/50",
    dot: "bg-violet-500", solid: "bg-violet-700 text-white", hover: "hover:bg-violet-800", text: "text-violet-700 dark:text-violet-300",
  },
  "violet.work": {
    badge: "bg-violet-100 text-violet-800 dark:bg-violet-500/15 dark:text-violet-300",
    dot: "bg-violet-400", solid: "bg-violet-700 text-white", hover: "hover:bg-violet-800", text: "text-violet-700 dark:text-violet-300",
  },
  "violet.wait": {
    badge: "border border-dashed border-violet-400 bg-transparent text-violet-700 dark:border-violet-400/60 dark:text-violet-300",
    dot: "bg-violet-300 dark:bg-violet-500/60", solid: "bg-violet-700 text-white", hover: "hover:bg-violet-800", text: "text-violet-600 dark:text-violet-300",
  },
  "violet.ok": {
    badge: "bg-violet-700 text-white dark:bg-violet-500 dark:text-violet-950",
    dot: "bg-violet-600", solid: "bg-violet-800 text-white", hover: "hover:bg-violet-900", text: "text-violet-700 dark:text-violet-300",
  },
  "orange.action": {
    badge: "bg-orange-50 text-orange-800 ring-1 ring-inset ring-orange-400 dark:bg-orange-500/10 dark:text-orange-200 dark:ring-orange-400/50",
    dot: "bg-orange-500", solid: "bg-orange-700 text-white", hover: "hover:bg-orange-800", text: "text-orange-700 dark:text-orange-300",
  },
  "indigo.action": {
    badge: "bg-indigo-50 text-indigo-800 ring-1 ring-inset ring-indigo-400 dark:bg-indigo-500/10 dark:text-indigo-200 dark:ring-indigo-400/50",
    dot: "bg-indigo-500", solid: "bg-indigo-700 text-white", hover: "hover:bg-indigo-800", text: "text-indigo-700 dark:text-indigo-300",
  },
  "indigo.work": {
    badge: "bg-indigo-100 text-indigo-800 dark:bg-indigo-500/15 dark:text-indigo-300",
    dot: "bg-indigo-400", solid: "bg-indigo-700 text-white", hover: "hover:bg-indigo-800", text: "text-indigo-700 dark:text-indigo-300",
  },
  "indigo.wait": {
    badge: "border border-dashed border-indigo-400 bg-transparent text-indigo-700 dark:border-indigo-400/60 dark:text-indigo-300",
    dot: "bg-indigo-300 dark:bg-indigo-500/60", solid: "bg-indigo-700 text-white", hover: "hover:bg-indigo-800", text: "text-indigo-600 dark:text-indigo-300",
  },
  "indigo.ok": {
    badge: "bg-indigo-700 text-white dark:bg-indigo-500 dark:text-indigo-950",
    dot: "bg-indigo-600", solid: "bg-indigo-800 text-white", hover: "hover:bg-indigo-900", text: "text-indigo-700 dark:text-indigo-300",
  },
  "yellow.work": {
    badge: "bg-yellow-100 text-yellow-900 dark:bg-yellow-500/15 dark:text-yellow-300",
    dot: "bg-yellow-400", solid: "bg-yellow-400 text-yellow-950", hover: "hover:bg-yellow-300", text: "text-yellow-700 dark:text-yellow-300",
  },
  "green.action": {
    badge: "bg-green-50 text-green-800 ring-1 ring-inset ring-green-400 dark:bg-green-500/10 dark:text-green-200 dark:ring-green-400/50",
    dot: "bg-green-500", solid: "bg-green-700 text-white", hover: "hover:bg-green-800", text: "text-green-700 dark:text-green-300",
  },
  "green.work": {
    badge: "bg-green-100 text-green-800 dark:bg-green-500/15 dark:text-green-300",
    dot: "bg-green-400", solid: "bg-green-700 text-white", hover: "hover:bg-green-800", text: "text-green-700 dark:text-green-300",
  },
  "green.partial": {
    badge: "bg-green-50 text-green-800 ring-1 ring-inset ring-green-200 dark:bg-green-500/10 dark:text-green-300 dark:ring-green-500/30",
    dot: "bg-green-400", solid: "bg-green-700 text-white", hover: "hover:bg-green-800", text: "text-green-700 dark:text-green-300",
  },
  "green.ok": {
    badge: "bg-green-700 text-white dark:bg-green-500 dark:text-green-950",
    dot: "bg-green-600", solid: "bg-green-800 text-white", hover: "hover:bg-green-900", text: "text-green-700 dark:text-green-300",
  },
  "emerald.wait": {
    badge: "border border-dashed border-emerald-400 bg-transparent text-emerald-700 dark:border-emerald-400/60 dark:text-emerald-300",
    dot: "bg-emerald-300 dark:bg-emerald-500/60", solid: "bg-emerald-700 text-white", hover: "hover:bg-emerald-800", text: "text-emerald-700 dark:text-emerald-300",
  },
  "emerald.partial": {
    badge: "bg-emerald-50 text-emerald-800 ring-1 ring-inset ring-emerald-200 dark:bg-emerald-500/10 dark:text-emerald-300 dark:ring-emerald-500/30",
    dot: "bg-emerald-400", solid: "bg-emerald-700 text-white", hover: "hover:bg-emerald-800", text: "text-emerald-700 dark:text-emerald-300",
  },
  "emerald.ok": {
    badge: "bg-emerald-700 text-white dark:bg-emerald-500 dark:text-emerald-950",
    dot: "bg-emerald-600", solid: "bg-emerald-800 text-white", hover: "hover:bg-emerald-900", text: "text-emerald-700 dark:text-emerald-300",
  },
  "lime.partial": {
    badge: "bg-lime-50 text-lime-800 ring-1 ring-inset ring-lime-300 dark:bg-lime-500/10 dark:text-lime-300 dark:ring-lime-500/30",
    dot: "bg-lime-500", solid: "bg-lime-400 text-lime-950", hover: "hover:bg-lime-300", text: "text-lime-700 dark:text-lime-300",
  },
  "rose.problem": {
    badge: "bg-rose-100 text-rose-800 ring-1 ring-inset ring-rose-400 dark:bg-rose-500/15 dark:text-rose-200 dark:ring-rose-400/50",
    dot: "bg-rose-500", solid: "bg-rose-700 text-white", hover: "hover:bg-rose-800", text: "text-rose-700 dark:text-rose-300",
  },
  "stone.lost": {
    badge: "bg-stone-200 text-stone-700 dark:bg-stone-500/20 dark:text-stone-300",
    dot: "bg-stone-400", solid: "bg-stone-600 text-white", hover: "hover:bg-stone-700", text: "text-stone-600 dark:text-stone-400",
  },
  "red.cancel": {
    badge: "bg-red-100 text-red-700 dark:bg-red-500/15 dark:text-red-300",
    dot: "bg-red-500", solid: "bg-red-700 text-white", hover: "hover:bg-red-800", text: "text-red-700 dark:text-red-300",
  },
  "muted.archive": {
    badge: "bg-muted text-muted-foreground",
    dot: "bg-zinc-300 dark:bg-zinc-600", solid: "bg-zinc-600 text-white", hover: "hover:bg-zinc-700", text: "text-muted-foreground",
  },
  "ghost.proposal": {
    badge: "border border-dashed border-muted-foreground/40 bg-transparent text-muted-foreground",
    dot: "bg-zinc-300 dark:bg-zinc-600", solid: "bg-zinc-600 text-white", hover: "hover:bg-zinc-700", text: "text-muted-foreground",
  },
};

/** Výplň pilulky průběhu podle odstínu fáze. */
export const PILL_FILL: Record<"green" | "emerald" | "lime" | "amber" | "yellow", string> = {
  green: "bg-green-500",
  emerald: "bg-emerald-500",
  lime: "bg-lime-500",
  amber: "bg-amber-500",
  yellow: "bg-yellow-500",
};
export type PillHue = keyof typeof PILL_FILL;

/** Základ chipu (1.0) + ikona. */
export const CHIP_BASE = "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium whitespace-nowrap";
export const CHIP_ICON = "size-3.5 shrink-0";
/** Podklad pilulky průběhu. */
export const PILL_TRACK = "relative h-1.5 w-12 overflow-hidden rounded-full bg-black/10 dark:bg-white/15";
/** Výplň pilulky (+ PILL_FILL[hue], šířka přes style). */
export const PILL_BAR = "absolute inset-y-0 left-0 rounded-full";

/** Odstín pilulky z klíče palety (green.partial → green). */
export function pillHueOf(palette: PaletteKey): PillHue {
  const hue = palette.split(".")[0];
  return hue === "green" || hue === "emerald" || hue === "lime" || hue === "amber" || hue === "yellow" ? hue : "green";
}

// ── Meta stavů ──────────────────────────────────────────────
export interface FlowStateMeta<K extends string = string> {
  key: K;
  phase: FlowPhase;
  label: string;
  /** Krátký popisek do úzkých míst (mobil). */
  short: string;
  description: string;
  icon: LucideIcon;
  tone: FlowTone;
  palette: PaletteKey;
  /** auto = systém/AI, manual = jen člověk, derived = počítá se, both = obojí. */
  source: "auto" | "manual" | "derived" | "both";
  /** Fáze je uzavřená (filtr „Otevřené“ ji skryje). */
  terminal: boolean;
  /** Přechod sem vyžaduje důvod. */
  needsReason?: boolean;
}

function meta<K extends string>(m: FlowStateMeta<K>): FlowStateMeta<K> {
  return m;
}

export const INQUIRY_STATES: Record<InquiryStatus, FlowStateMeta<InquiryStatus>> = {
  prijata: meta({
    key: "prijata", phase: "inquiry", label: "Přijatá", short: "Přijatá",
    description: "Poptávka přišla (e-mail, foto, AI, import) a nikdo ji ještě nepřevzal.",
    icon: Inbox, tone: "action", palette: "sky.action", source: "auto", terminal: false,
  }),
  v_reseni: meta({
    key: "v_reseni", phase: "inquiry", label: "V řešení", short: "Řeší se",
    description: "Někdo poptávku převzal, začalo nacenění nebo k ní vznikla nabídka.",
    icon: UserRoundCheck, tone: "work", palette: "sky.work", source: "both", terminal: false,
  }),
  ceka_na_podklady: meta({
    key: "ceka_na_podklady", phase: "inquiry", label: "Čeká na podklady", short: "Podklady",
    description: "Chybí výkres, model, množství nebo materiál — skončí samo, jakmile podklady přijdou.",
    icon: FileQuestion, tone: "wait", palette: "sky.wait", source: "manual", terminal: false,
  }),
  zpracovana: meta({
    key: "zpracovana", phase: "inquiry", label: "Zpracovaná", short: "Zprac.",
    description: "Nabídka odešla nebo poptávka přešla do objednávky.",
    icon: CircleCheck, tone: "ok", palette: "sky.ok", source: "derived", terminal: true,
  }),
  odmitnuta: meta({
    key: "odmitnuta", phase: "inquiry", label: "Odmítnutá", short: "Odmítnutá",
    description: "Odmítli jsme my (nevyrábíme, kapacita, nevyplatí se, duplicita).",
    icon: CircleX, tone: "lost", palette: "stone.lost", source: "manual", terminal: true, needsReason: true,
  }),
  stazena: meta({
    key: "stazena", phase: "inquiry", label: "Stažená zákazníkem", short: "Stažená",
    description: "Zákazník poptávku stáhl nebo neodpovídá.",
    icon: Undo2, tone: "lost", palette: "stone.lost", source: "manual", terminal: true, needsReason: true,
  }),
};

export const PRICING_STATES: Record<PricingState, FlowStateMeta<PricingState>> = {
  naceneno: meta({
    key: "naceneno", phase: "pricing", label: "Naceněno", short: "Naceněno",
    description: "Všechny položky mají cenu — vytvoř nabídku.",
    icon: CircleCheckBig, tone: "ok", palette: "amber.ok", source: "derived", terminal: false,
  }),
  ceka_na_dodavatele: meta({
    key: "ceka_na_dodavatele", phase: "pricing", label: "Čeká na ceny dodavatelů", short: "Dodavatelé",
    description: "Poptali jsme dodavatele a cena zatím nepřišla.",
    icon: Hourglass, tone: "wait", palette: "amber.wait", source: "derived", terminal: false,
  }),
  rozpracovano: meta({
    key: "rozpracovano", phase: "pricing", label: "Naceňuje se", short: "Naceňuje se",
    description: "Část položek už má cenu.",
    icon: PenLine, tone: "work", palette: "amber.work", source: "derived", terminal: false,
  }),
  ceka: meta({
    key: "ceka", phase: "pricing", label: "Bez ceny", short: "Bez ceny",
    description: "Žádná položka zatím nemá cenu — doplň ji v nabídce.",
    icon: Calculator, tone: "action", palette: "amber.action", source: "derived", terminal: false,
  }),
};

export const QUOTE_STATES: Record<QuoteDisplayState, FlowStateMeta<QuoteDisplayState>> = {
  rozpracovana: meta({
    key: "rozpracovana", phase: "quote", label: "Rozpracovaná", short: "Rozprac.",
    description: "Nabídka se připravuje (AI nebo ručně).",
    icon: FilePen, tone: "work", palette: "violet.work", source: "both", terminal: false,
  }),
  ke_schvaleni: meta({
    key: "ke_schvaleni", phase: "quote", label: "Neschválená", short: "Neschválená",
    description: "Neschválená — čeká na schválení (super admin nebo schvalovatel nabídek). Odeslat ji půjde až po schválení.",
    icon: ShieldQuestion, tone: "action", palette: "violet.action", source: "both", terminal: false,
  }),
  schvalena: meta({
    key: "schvalena", phase: "quote", label: "Schválená", short: "Schválená",
    description: "Schválená — připravená k odeslání.",
    icon: ShieldCheck, tone: "action", palette: "violet.action", source: "manual", terminal: false,
  }),
  odeslana: meta({
    key: "odeslana", phase: "quote", label: "Odeslaná", short: "Odeslaná",
    description: "Odešla zákazníkovi — čekáme na odpověď.",
    icon: Send, tone: "wait", palette: "violet.wait", source: "both", terminal: false,
  }),
  pripominky: meta({
    key: "pripominky", phase: "quote", label: "Připomínky zákazníka", short: "Připomínky",
    description: "Zákazník chce změnu — připrav novou verzi.",
    icon: MessageSquareWarning, tone: "problem", palette: "rose.problem", source: "both", terminal: false,
  }),
  vyprsela: meta({
    key: "vyprsela", phase: "quote", label: "Vypršela platnost", short: "Vypršela",
    description: "Odeslaná nabídka už neplatí — prodluž ji, pošli novou verzi nebo ji uzavři.",
    icon: CalendarX, tone: "problem", palette: "rose.problem", source: "derived", terminal: false,
  }),
  prijata: meta({
    key: "prijata", phase: "quote", label: "Přijatá", short: "Přijatá",
    description: "Zákazník objednal (vyhraná nabídka).",
    icon: Trophy, tone: "ok", palette: "violet.ok", source: "both", terminal: true,
  }),
  zamitnuta: meta({
    key: "zamitnuta", phase: "quote", label: "Zamítnutá", short: "Zamítnutá",
    description: "Prohraná nabídka (důvod je povinný).",
    icon: ThumbsDown, tone: "lost", palette: "stone.lost", source: "manual", terminal: true, needsReason: true,
  }),
  archivovana: meta({
    key: "archivovana", phase: "quote", label: "Archivovaná", short: "Archiv",
    description: "Nahrazená novou verzí nebo uzavřená se zakázkou.",
    icon: Archive, tone: "archive", palette: "muted.archive", source: "both", terminal: true,
  }),
};

export const ORDER_STATES: Record<OrderDocStatus, FlowStateMeta<OrderDocStatus>> = {
  dorucena: meta({
    key: "dorucena", phase: "order", label: "Doručená", short: "Doručená",
    description: "Objednávka přišla a čeká na naše potvrzení.",
    icon: ShoppingCart, tone: "action", palette: "orange.action", source: "auto", terminal: false,
  }),
  rozpor: meta({
    key: "rozpor", phase: "order", label: "Rozpor s nabídkou", short: "Rozpor",
    description: "Objednávka se liší od nabídky (cena, množství, revize, termín, položky…).",
    icon: GitCompare, tone: "problem", palette: "rose.problem", source: "both", terminal: false,
  }),
  potvrzena: meta({
    key: "potvrzena", phase: "order", label: "Potvrzená", short: "Potvrzená",
    description: "Objednávku plníme.",
    icon: BadgeCheck, tone: "work", palette: "indigo.work", source: "both", terminal: false,
  }),
  aktualizovana: meta({
    key: "aktualizovana", phase: "order", label: "Aktualizovaná", short: "Aktualiz.",
    description: "Zákazník poslal změnu potvrzené objednávky — potvrď ji, nebo ji odmítni.",
    icon: RefreshCw, tone: "action", palette: "indigo.action", source: "both", terminal: false,
  }),
  stornovana: meta({
    key: "stornovana", phase: "order", label: "Stornovaná", short: "Storno",
    description: "Zákazník objednávku zrušil (důvod je povinný).",
    icon: Ban, tone: "cancel", palette: "red.cancel", source: "manual", terminal: true, needsReason: true,
  }),
};

export const FULFILMENT_STATES: Record<FulfilmentState, FlowStateMeta<FulfilmentState>> = {
  ve_vyrobe: meta({
    key: "ve_vyrobe", phase: "fulfilment", label: "Ve výrobě", short: "Výroba",
    description: "Objednávka se vyrábí.",
    icon: Factory, tone: "work", palette: "yellow.work", source: "derived", terminal: false,
  }),
  castecne_dodana: meta({
    key: "castecne_dodana", phase: "fulfilment", label: "Částečně dodaná", short: "Částečně",
    description: "Část položek už je u zákazníka.",
    icon: CircleDotDashed, tone: "partial", palette: "green.partial", source: "derived", terminal: false,
  }),
  dokoncena: meta({
    key: "dokoncena", phase: "fulfilment", label: "Dokončená", short: "Dokončená",
    description: "Vše dodáno (platbu ukazuje fáze faktury).",
    icon: PackageCheck, tone: "ok", palette: "green.ok", source: "derived", terminal: true,
  }),
};

export const CONFIRMATION_STATES: Record<ConfirmationState, FlowStateMeta<ConfirmationState>> = {
  k_vystaveni: meta({
    key: "k_vystaveni", phase: "confirmation", label: "K vystavení", short: "Vystavit",
    description: "K aktuální revizi objednávky zatím není vystavené naše potvrzení.",
    icon: FilePlus, tone: "action", palette: "indigo.action", source: "derived", terminal: false,
  }),
  vystaveno: meta({
    key: "vystaveno", phase: "confirmation", label: "Vystavené, neodeslané", short: "Neodesl.",
    description: "Potvrzení je vystavené, ale ještě neodešlo.",
    icon: FileCheck, tone: "work", palette: "indigo.work", source: "derived", terminal: false,
  }),
  odeslano: meta({
    key: "odeslano", phase: "confirmation", label: "Potvrzení odesláno", short: "Odesláno",
    description: "Potvrzení potvrzené revize odešlo zákazníkovi.",
    icon: MailCheck, tone: "ok", palette: "indigo.ok", source: "derived", terminal: true,
  }),
  bez_dokladu: meta({
    key: "bez_dokladu", phase: "confirmation", label: "Potvrzeno bez dokladu", short: "Bez dokladu",
    description: "Objednávka je potvrzená, ale k potvrzené revizi nic neodešlo.",
    icon: FileX, tone: "wait", palette: "indigo.wait", source: "derived", terminal: false,
  }),
};

export const DELIVERY_STATES: Record<DeliveryState, FlowStateMeta<DeliveryState>> = {
  dl_potvrzen: meta({
    key: "dl_potvrzen", phase: "delivery", label: "DL potvrzen", short: "DL potvrzen",
    description: "Zákazník potvrdil dodací list k poslední dodávce — vystav fakturu.",
    icon: ClipboardCheck, tone: "ok", palette: "green.ok", source: "derived", terminal: true,
  }),
  dodano: meta({
    key: "dodano", phase: "delivery", label: "Dodáno", short: "Dodáno",
    description: "Vše dodáno — potvrď (vyfoť) podepsaný dodací list.",
    icon: Truck, tone: "work", palette: "green.work", source: "derived", terminal: false,
  }),
  castecne: meta({
    key: "castecne", phase: "delivery", label: "Částečně dodáno", short: "Částečně",
    description: "Část položek je dodaná — dodej zbytek, nebo položku uzavři s menším množstvím.",
    icon: CircleDotDashed, tone: "partial", palette: "green.partial", source: "derived", terminal: false,
  }),
  k_expedici: meta({
    key: "k_expedici", phase: "delivery", label: "K expedici", short: "Expedice",
    description: "Zboží je hotové / u nás — zapiš dodání a vystav dodací list.",
    icon: Package, tone: "action", palette: "green.action", source: "derived", terminal: false,
  }),
};

export const PAYMENT_STATES: Record<PaymentState, FlowStateMeta<PaymentState>> = {
  zaplaceno: meta({
    key: "zaplaceno", phase: "payment", label: "Zaplaceno", short: "Zaplaceno",
    description: "Zakázka je vyrovnaná.",
    icon: Banknote, tone: "ok", palette: "emerald.ok", source: "derived", terminal: true,
  }),
  po_splatnosti: meta({
    key: "po_splatnosti", phase: "payment", label: "Po splatnosti", short: "Po splat.",
    description: "Faktura je po splatnosti.",
    icon: AlarmClock, tone: "problem", palette: "rose.problem", source: "derived", terminal: false,
  }),
  castecne_zaplaceno: meta({
    key: "castecne_zaplaceno", phase: "payment", label: "Částečně zaplaceno", short: "Částečně",
    description: "Část úhrady (nebo záloha) je přijatá.",
    icon: CircleDotDashed, tone: "partial", palette: "emerald.partial", source: "derived", terminal: false,
  }),
  ceka_na_uhradu: meta({
    key: "ceka_na_uhradu", phase: "payment", label: "Čeká na úhradu", short: "Úhrada",
    description: "Faktura je vystavená, platba zatím nepřišla.",
    icon: Hourglass, tone: "wait", palette: "emerald.wait", source: "derived", terminal: false,
  }),
};

export const PURCHASE_EXTRA_STATES: Record<PurchaseExtraState, FlowStateMeta<PurchaseExtraState>> = {
  castecne_dodana: meta({
    key: "castecne_dodana", phase: "purchase", label: "Částečně dodaná", short: "Částečně",
    description: "Od dodavatele přišla jen část položek.",
    icon: CircleDotDashed, tone: "partial", palette: "lime.partial", source: "derived", terminal: false,
  }),
  po_terminu: meta({
    key: "po_terminu", phase: "purchase", label: "Po termínu", short: "Po termínu",
    description: "Dodavatel nedodal v potvrzeném (požadovaném) termínu.",
    icon: AlarmClock, tone: "problem", palette: "rose.problem", source: "derived", terminal: false,
  }),
};

/** Chip řádku: potvrzená objednávka čeká na předání do výroby (kdo + termín). */
export const NO_PLAN_META: FlowStateMeta<"bez_postupu"> = meta({
  key: "bez_postupu", phase: "fulfilment", label: "K předání do výroby", short: "K předání",
  description: "Objednávka je potvrzená — předej ji do výroby: kdo to dělá a do kdy.",
  icon: Wrench, tone: "action", palette: "indigo.action", source: "derived", terminal: false,
});
/** Chip řádku: ve výrobě, ale aktuální krok nemá kdo nebo termín (starší zakázky). */
export const UNPLANNED_META: FlowStateMeta<"bez_predani"> = meta({
  key: "bez_predani", phase: "fulfilment", label: "Chybí kdo a termín", short: "Chybí kdo",
  description: "Zakázka je ve výrobě, ale aktuální krok nemá, kdo to dělá, nebo termín.",
  icon: UserRoundX, tone: "problem", palette: "rose.problem", source: "derived", terminal: false,
});
/** Chip řádku: další krok čeká na předání (kdo + termín + objednávka). */
export const NEXT_STEP_META: FlowStateMeta<"k_predani_kroku"> = meta({
  key: "k_predani_kroku", phase: "fulfilment", label: "K předání dalšímu kroku", short: "Další krok",
  description: "Předchozí krok je hotový — předej díl dalšímu kroku (kdo + termín).",
  icon: ArrowRightCircle, tone: "action", palette: "amber.action", source: "derived", terminal: false,
});
/** Chip řádku: výroba skončí po konečném termínu (zákazník). */
export const ROUTE_LATE_META: FlowStateMeta<"ohrozeny_termin"> = meta({
  key: "ohrozeny_termin", phase: "fulfilment", label: "Ohrožen konečný termín", short: "Ohrožen termín",
  description: "Výroba podle termínů kroků skončí po konečném termínu (zákazník).",
  icon: CalendarX2, tone: "problem", palette: "rose.problem", source: "derived", terminal: false,
});
/** Chip řádku: konečný termín (zákazník) se změnil — postup je potřeba přeplánovat. */
export const FINAL_CHANGED_META: FlowStateMeta<"termin_zmenen"> = meta({
  key: "termin_zmenen", phase: "fulfilment", label: "Konečný termín se změnil — přeplánuj výrobu", short: "Přeplánovat",
  description: "Krok s konečným termínem má jiné datum než konečný termín (zákazník).",
  icon: CalendarClock, tone: "action", palette: "amber.action", source: "derived", terminal: false,
});
/** Chip řádku nerealizované zakázky (důvod prohry). */
export const LOST_JOB_META: FlowStateMeta<"nerealizovano"> = meta({
  key: "nerealizovano", phase: "inquiry", label: "Nerealizováno", short: "Nerealiz.",
  description: "Zakázka se nerealizovala.",
  icon: CircleSlash, tone: "lost", palette: "stone.lost", source: "manual", terminal: true, needsReason: true,
});
/** Chip řádku zrušené zakázky (důvod storna). */
export const CANCELLED_JOB_META: FlowStateMeta<"zruseno"> = meta({
  key: "zruseno", phase: "order", label: "Zrušeno", short: "Zrušeno",
  description: "Zakázka je zrušená.",
  icon: Ban, tone: "cancel", palette: "red.cancel", source: "manual", terminal: true, needsReason: true,
});
/** Chip návrhu změny („duch“). */
export const PROPOSAL_META: FlowStateMeta<"proposal"> = meta({
  key: "proposal", phase: "proposal", label: "Návrh", short: "Návrh",
  description: "Zaměstnanec nebo AI navrhli změnu — rozhodne člověk s právem.",
  icon: Hand, tone: "proposal", palette: "ghost.proposal", source: "both", terminal: false,
});

// ── Pořadí chipů filtru a výchozí „Otevřené“ ────────────────
export const INQUIRY_ORDER: InquiryStatus[] = ["prijata", "v_reseni", "ceka_na_podklady", "zpracovana", "odmitnuta", "stazena"];
export const OPEN_INQUIRY: InquiryStatus[] = ["prijata", "v_reseni", "ceka_na_podklady"];
export const PRICING_ORDER: PricingState[] = ["ceka", "ceka_na_dodavatele", "rozpracovano", "naceneno"];
export const QUOTE_ORDER: QuoteDisplayState[] = [
  "rozpracovana", "ke_schvaleni", "schvalena", "odeslana", "pripominky", "vyprsela", "prijata", "zamitnuta", "archivovana",
];
export const OPEN_QUOTE: QuoteDisplayState[] = ["rozpracovana", "ke_schvaleni", "schvalena", "odeslana", "pripominky", "vyprsela"];
export const ORDER_ORDER: OrderDocStatus[] = ["dorucena", "rozpor", "aktualizovana", "potvrzena", "stornovana"];
/** Akční seznam „K potvrzení“ (/confirmations). */
export const CONFIRM_QUEUE: OrderDocStatus[] = ["dorucena", "rozpor", "aktualizovana"];
/** Chipy záložky Potvrzení (a segmentu Objednávky v Knize). */
export const ORDER_TAB_CHIPS: { key: string; phase: "order" | "fulfilment"; open: boolean }[] = [
  { key: "dorucena", phase: "order", open: true },
  { key: "rozpor", phase: "order", open: true },
  { key: "aktualizovana", phase: "order", open: true },
  { key: "potvrzena", phase: "order", open: false },
  { key: "ve_vyrobe", phase: "fulfilment", open: false },
  { key: "castecne_dodana", phase: "fulfilment", open: false },
  { key: "dokoncena", phase: "fulfilment", open: false },
  { key: "stornovana", phase: "order", open: false },
];

export function isInquiryStatus(v: unknown): v is InquiryStatus {
  return typeof v === "string" && v in INQUIRY_STATES;
}
export function isOrderDocStatus(v: unknown): v is OrderDocStatus {
  return typeof v === "string" && v in ORDER_STATES;
}
export function isQuoteState(v: unknown): v is QuoteState {
  return typeof v === "string" && v !== "vyprsela" && v in QUOTE_STATES;
}

/** Meta stavu fáze podle klíče (null = neznámý). */
export function stateMeta(phase: FlowPhase, key: string | null | undefined): FlowStateMeta | null {
  if (!key) return null;
  const table: Partial<Record<FlowPhase, Record<string, FlowStateMeta>>> = {
    inquiry: INQUIRY_STATES, pricing: PRICING_STATES, quote: QUOTE_STATES, order: ORDER_STATES,
    fulfilment: FULFILMENT_STATES, confirmation: CONFIRMATION_STATES, delivery: DELIVERY_STATES,
    payment: PAYMENT_STATES, purchase: PURCHASE_EXTRA_STATES,
  };
  return table[phase]?.[key] ?? null;
}

// ── Pořadí hlavního stavu (= job_stage_rank v DB) ───────────
const RANK: Record<JobStage, number> = {
  poptavka: 0, naceneni: 1, nabidka: 2, objednavka: 3, potvrzeno: 4, ve_vyrobe: 5, dodano_k_nam: 6, na_sklade: 7,
  montaz: 8, dodano_zakaznikovi: 9, fakturovano: 10, dokonceno: 11,
  pozastaveno: -1, reklamace: -1, nerealizovano: -1, zruseno: -1,
};
export function flowRank(stage: JobStage): number {
  return RANK[stage] ?? -1;
}

// ── Přechody (jen ruční; odvozené cíle tu nejsou) ───────────
export const INQUIRY_TRANSITIONS: Record<InquiryStatus, InquiryStatus[]> = {
  prijata: ["v_reseni", "ceka_na_podklady", "odmitnuta", "stazena"],
  v_reseni: ["ceka_na_podklady", "odmitnuta", "stazena"],
  ceka_na_podklady: ["v_reseni", "odmitnuta", "stazena"],
  zpracovana: [],
  odmitnuta: ["prijata", "v_reseni"],
  stazena: ["prijata", "v_reseni"],
};

/**
 * #25: rozpracovaná = schválení není potřeba (nabídka super admina) → rovnou odeslat; neschválenou
 * schvaluje jen super admin; zrušit schválení jde jen u schválené (nabídka ne-admina / AI pak skončí
 * zase v „Neschválená“ — výsledek hlásí skutečný stav).
 */
export const QUOTE_TRANSITIONS: Record<QuoteState, QuoteState[]> = {
  rozpracovana: ["odeslana"],
  ke_schvaleni: ["schvalena"],
  schvalena: ["odeslana", "rozpracovana"],
  odeslana: ["pripominky", "prijata", "zamitnuta"],
  pripominky: ["odeslana", "prijata", "zamitnuta"],
  zamitnuta: ["odeslana"],
  prijata: [],
  archivovana: [],
};

export const ORDER_TRANSITIONS: Record<OrderDocStatus, OrderDocStatus[]> = {
  dorucena: ["rozpor", "potvrzena", "stornovana"],
  rozpor: ["dorucena", "potvrzena", "stornovana"],
  potvrzena: ["aktualizovana", "stornovana"],
  aktualizovana: ["potvrzena", "stornovana"],
  stornovana: ["dorucena", "potvrzena"],
};

export function canTransition(phase: TransitionPhase, from: string | null, to: string): boolean {
  if (!from) return false;
  if (phase === "inquiry") return isInquiryStatus(from) && (INQUIRY_TRANSITIONS[from] as string[]).includes(to);
  if (phase === "quote") return isQuoteState(from) && (QUOTE_TRANSITIONS[from] as string[]).includes(to);
  return isOrderDocStatus(from) && (ORDER_TRANSITIONS[from] as string[]).includes(to);
}

/**
 * Právo potřebné k přechodu (kap. 7 #7): negativní a finanční konce, schválení a odeslání nabídky = margins,
 * obnovení stornované objednávky = delete (admin), korekce hlavního stavu = orders, jinak workflow.
 */
export function transitionFeature(phase: ReasonPhase, to: string, from?: string | null): Feature {
  if (phase === "inquiry") {
    if (to === "odmitnuta" || to === "stazena") return "margins";
    if (from === "odmitnuta" || from === "stazena") return "margins";
    return "workflow";
  }
  if (phase === "quote") {
    // #25: schválit / zrušit schválení = jen super admin; odeslat rozpracovanou či schválenou = workflow
    // (kdo smí, rozhodne quoteSendBlock); odpověď bez změny, znovuotevření a zamítnutí = margins
    if (to === "schvalena" || to === "rozpracovana") return "quote_approval";
    if (to === "odeslana") return from === "rozpracovana" || from === "schvalena" ? "workflow" : "margins";
    if (to === "zamitnuta") return "margins";
    return "workflow";
  }
  if (phase === "order") {
    if (to === "stornovana") return "margins";
    if (from === "stornovana") return "delete";
    return "workflow";
  }
  // negativní konce a finanční konce (vyfakturováno, dokončeno = zaplaceno) = margins
  return to === "nerealizovano" || to === "zruseno" || to === "fakturovano" || to === "dokonceno" ? "margins" : "orders";
}

export function reasonRequired(phase: ReasonPhase, to: string): boolean {
  if (phase === "inquiry") return to === "odmitnuta" || to === "stazena";
  if (phase === "quote") return to === "zamitnuta";
  if (phase === "order") return to === "stornovana";
  return to === "nerealizovano" || to === "zruseno";
}

/** Rychlé volby poznámek (jedno ťuknutí; jde dopsat). */
export const QUICK_NOTES = {
  /** Co chybí k nacenění. */
  waiting: ["Výkres", "3D model", "Množství", "Materiál", "Termín"],
  /** Co zákazník v objednávce změnil. */
  orderChange: ["Množství", "Termín", "Cena", "Revize výkresu", "Položka"],
  /** Jak jsme objednávku potvrdili bez dokladu z aplikace. */
  confirmedHow: ["Telefonicky", "Osobně", "Poštou", "Z jiné schránky"],
} as const;

// ── Důvody prohry / odmítnutí / storna (1.10) ───────────────
export const LOST_REASONS: Record<LostReason, {
  label: string; side: "my" | "zakaznik" | "system"; phases: ReasonPhase[];
}> = {
  nevyrabime: { label: "Nevyrábíme (technologie)", side: "my", phases: ["inquiry", "job"] },
  kapacita: { label: "Nestíháme (kapacita / termín)", side: "my", phases: ["inquiry", "job"] },
  nevyplati_se: { label: "Nevyplatí se (cena / objem)", side: "my", phases: ["inquiry", "job"] },
  duplicita: { label: "Duplicitní poptávka", side: "my", phases: ["inquiry", "job"] },
  cena: { label: "Cena", side: "zakaznik", phases: ["quote", "job"] },
  termin: { label: "Termín dodání", side: "zakaznik", phases: ["quote", "job"] },
  jiny_dodavatel: { label: "Vybral jiného dodavatele", side: "zakaznik", phases: ["quote", "order", "job"] },
  projekt_zrusen: { label: "Projekt zrušen", side: "zakaznik", phases: ["inquiry", "quote", "order", "job"] },
  bez_odezvy: { label: "Bez odezvy", side: "zakaznik", phases: ["inquiry", "quote", "job"] },
  zakaznik_stahl: { label: "Zákazník stáhl poptávku", side: "zakaznik", phases: ["inquiry", "order", "job"] },
  // 31. 10.: zrušení zakázky po zmetku („Výroba se nepovedla")
  vyroba: { label: "Výroba se nepovedla", side: "my", phases: ["job"] },
  jine: { label: "Jiný důvod", side: "system", phases: ["inquiry", "quote", "order", "job"] },
  neuvedeno: { label: "Důvod neuveden", side: "system", phases: [] },
};

export const LOST_REASON_ORDER: LostReason[] = [
  "nevyrabime", "kapacita", "nevyplati_se", "duplicita", "cena", "termin", "jiny_dodavatel", "projekt_zrusen",
  "bez_odezvy", "zakaznik_stahl", "vyroba", "jine", "neuvedeno",
];

/** „Zákazník neobjednal…" — důvody na straně zákazníka (cena, termín, jiný dodavatel, projekt zrušen, bez odpovědi, jiné). */
export const NOT_ORDERED_REASONS: LostReason[] = ["cena", "termin", "jiny_dodavatel", "projekt_zrusen", "bez_odezvy", "jine"];
/** „Nebudeme nabízet…" — odmítáme my. */
export const DECLINE_REASONS: LostReason[] = ["nevyrabime", "kapacita", "nevyplati_se", "duplicita", "jine"];

export function isLostReason(v: unknown): v is LostReason {
  return typeof v === "string" && v in LOST_REASONS;
}

/** Důvody pro dialog (bez „neuvedeno“); u poptávky podle cíle: odmítnutá = my, stažená = zákazník. */
export function lostReasonsFor(phase: ReasonPhase, to?: string): LostReason[] {
  return LOST_REASON_ORDER.filter((r) => {
    const m = LOST_REASONS[r];
    if (!m.phases.includes(phase)) return false;
    if (phase === "inquiry" && to === "odmitnuta") return m.side !== "zakaznik";
    if (phase === "inquiry" && to === "stazena") return m.side !== "my";
    if (phase === "job" && to === "zruseno") return r !== "nevyrabime" && r !== "nevyplati_se";
    if (phase === "job" && to === "nerealizovano") return r !== "vyroba";
    return true;
  });
}

export function lostReasonLabel(r: string | null | undefined): string {
  return isLostReason(r) ? LOST_REASONS[r].label : "Důvod neuveden";
}

/** Strana důvodu „my“ → poptávka odmítnutá, jinak stažená (stejně jako trigger D1). */
export function isOurReason(r: LostReason | null | undefined): boolean {
  return r === "nevyrabime" || r === "kapacita" || r === "nevyplati_se" || r === "duplicita";
}

// ── Čas (pražský den) ───────────────────────────────────────
const PRAGUE_DAY = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Prague" });

/** Dnešní den v Praze (RRRR-MM-DD) — jako app_today() v DB. */
export function pragueToday(now: Date = new Date()): string {
  return PRAGUE_DAY.format(now);
}

/** Pražský den okamžiku (timestamptz → RRRR-MM-DD); samotné datum vrátí beze změny. */
export function pragueDay(at: string | null | undefined): string | null {
  if (!at) return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(at)) return at;
  const d = new Date(at);
  return Number.isNaN(d.getTime()) ? null : PRAGUE_DAY.format(d);
}

/** Počet dní mezi dvěma dny (RRRR-MM-DD). */
export function dayDiff(from: string, to: string): number {
  const a = Date.UTC(+from.slice(0, 4), +from.slice(5, 7) - 1, +from.slice(8, 10));
  const b = Date.UTC(+to.slice(0, 4), +to.slice(5, 7) - 1, +to.slice(8, 10));
  return Math.round((b - a) / 86_400_000);
}

// ── Odvození (čisté funkce; zrcadlí SQL view job_flow_v) ────
export interface FlowFacts {
  stage: JobStage;
  inquiryStatus: InquiryStatus | null;
  orderStatus: OrderDocStatus | null;
  orderRevision: number;
  orderConfirmedRevision: number | null;
  confirmationIssuedRevision: number | null;
  confirmationSentRevision: number | null;
  itemsCount: number;
  itemsPriced: number;
  itemsDelivered: number;
  itemsPartial: number;
  lastDeliveryAt: string | null;
  partialDeliveryAt: string | null;
  productionDone: number;
  productionTotal: number;
  deliveryNoteConfirmedAt: string | null;
  invoiceNumber: string | null;
  invoiceDueDate: string | null;
  paidAt: string | null;
  paidSoFar: number;
  waitingSince: string | null;
  orderStatusChangedAt: string | null;
  pendingSupplierQuotes: number;
  lostReason: LostReason | null;
  proposal: FlowProposal | null;
  /** Pro „Naplánovat výrobu“ (minor 15). */
  hasOperations: boolean;
  hasPurchaseOrders: boolean;
  // nepovinné doplňky pro texty chipů
  orderMismatch?: OrderMismatch | null;
  waitingNote?: string | null;
  lostNote?: string | null;
  assigneeId?: string | null;
  assigneeName?: string | null;
  value?: number | null;
  // ── Předání do výroby: aktuální krok (orders.production_*, udržuje DB) ──
  /** Druh aktuálního kroku („hotovo" = vše hotové). */
  productionStep?: string | null;
  /** Kde se aktuální krok dělá (null = kdo chybí). */
  productionLocation?: string | null;
  productionStepNo?: number | null;
  /** Termín aktuálního kroku. */
  productionDue?: string | null;
  productionDueState?: string | null;
  /** Stav objednávky aktuálního kroku. */
  productionPoStatus?: PurchaseOrderStatus | null;
  /** Nejzazší termín otevřených kroků (konec výroby). */
  productionEnd?: string | null;
  /** Termín kroku s konečným termínem (zákazník). */
  productionFinalEnd?: string | null;
  /** Aktuální krok běží (null = nevíme — fakta z orders to neříkají). */
  productionRunning?: boolean | null;
  /** Konečný termín (zákazník) a požadavek zákazníka. */
  dueDate?: string | null;
  customerRequiredDate?: string | null;
  /** Otevřené objednávky u dodavatelů (vystavená / odeslaná / potvrzená) — bez práva na nákup 0. */
  openPurchaseOrders?: number;
  /** Dodané objednávky (zápis výroby při přeskočení). */
  deliveredPurchaseOrders?: number;
  // ── Výjimky v toku (migrace 20261031150000; udržuje DB) ──
  /** Stav před vedlejším stavem (pozastaveno, reklamace, nerealizováno, zrušeno) — „Pokračovat" / „Obnovit" se vrací sem. */
  sideFromStage?: JobStage | null;
  /** Proč zakázka stojí (Pozastaveno). */
  holdReason?: string | null;
  /** Vyrábí se bez objednávky zákazníka (zákazník napsal „vyrábějte"). */
  awaitingCustomerPo?: boolean;
  awaitingPoSince?: string | null;
  awaitingPoNote?: string | null;
  /** Objednávka zákazníka dorazila dodatečně (zakázka se vyráběla bez ní) — teď ji potvrdit. */
  customerPoReceivedAt?: string | null;
  customerOrderNumber?: string | null;
  /** Reklamace: otevřená (openedAt bez resolvedAt), důvod, kusy, stav před reklamací, vyřízení. */
  claimOpenedAt?: string | null;
  claimReason?: string | null;
  claimQty?: number | null;
  claimItemId?: string | null;
  claimNote?: string | null;
  claimFromStage?: JobStage | null;
  claimResolution?: string | null;
  claimResolutionNote?: string | null;
  claimResolvedAt?: string | null;
  /** Oprava zakázky (změna od zákazníka po objednávce). */
  correctedAt?: string | null;
  correctedNote?: string | null;
  /** Nepotvrzené změny revize výkresu („Nová revize"). */
  drawingChangesOpen?: number;
}

export interface QuoteFacts {
  id: string;
  number: string | null;
  revision: number;
  status: QuoteStatus;
  state: QuoteState;
  approvedBy: string | null;
  approvalRequired: boolean;
  createdBy: string | null;
  archived: boolean;
  sentAt: string | null;
  validUntil: string | null;
  aiGenerated: boolean;
  supersededBy: string | null;
  /** Rozhoduje mezi verzemi se stejnou revizí (jako created_at v DB). */
  createdAt?: string | null;
  /** Žádost o schválení (od #25 jen informace — schválení nevyžaduje). */
  approvalRequestedAt?: string | null;
  total?: number | null;
  /** #25: připravil (nebo před odesláním změnil) ne-admin → odeslat až po schválení super adminem. */
  adminApprovalRequired?: boolean;
  /** #25: super admin vrátil nabídku autorovi k přepracování (kdy a proč). */
  returnedAt?: string | null;
  returnNote?: string | null;
  /** Optimistický zámek schválení ze seznamu (položky i hlavička ho vždy posunou). */
  updatedAt?: string | null;
  ownerId?: string | null;
}

export interface FlowSnapshot {
  inquiry: InquiryStatus | null;
  pricing: PricingState | null;
  quote: QuoteDisplayState | null;
  activeQuote: QuoteFacts | null;
  order: OrderDocStatus | null;
  fulfilment: FulfilmentState | null;
  confirmation: ConfirmationState | null;
  delivery: DeliveryState | null;
  payment: PaymentState | null;
  waitingDays: number | null;
  orderedWithoutQuote: boolean;
}

/** = quote_state_of v DB (pořadí platí). */
export function quoteStateOf(
  q: Pick<QuoteFacts, "status" | "approvedBy" | "archived" | "approvalRequired"> & { feedbackAt: string | null; sentAt: string | null },
): QuoteState {
  if (q.status === "prijato") return "prijata";
  if (q.status === "zamitnuto") return "zamitnuta";
  if (q.archived) return "archivovana";
  if (q.status === "odeslano" && q.feedbackAt && (!q.sentAt || Date.parse(q.feedbackAt) >= Date.parse(q.sentAt))) return "pripominky";
  if (q.status === "odeslano") return "odeslana";
  if (q.approvedBy) return "schvalena";
  if (q.approvalRequired) return "ke_schvaleni";
  return "rozpracovana";
}

/** Zobrazený stav nabídky: odeslaná / s připomínkami po platnosti = „vypršela“. */
export function quoteDisplayState(q: Pick<QuoteFacts, "state" | "validUntil">, today: string = pragueToday()): QuoteDisplayState {
  if ((q.state === "odeslana" || q.state === "pripominky") && q.validUntil && q.validUntil < today) return "vyprsela";
  return q.state;
}

/** Aktivní nabídka zakázky: přijatá, jinak nearchivovaná s nejvyšší revizí, jinak nejnovější. */
export function activeQuote<T extends Pick<QuoteFacts, "state" | "revision" | "archived"> & { createdAt?: string | null }>(
  quotes: T[],
): T | null {
  if (!quotes.length) return null;
  const sorted = [...quotes].sort((a, b) => {
    const pa = a.state === "prijata" ? 0 : 1;
    const pb = b.state === "prijata" ? 0 : 1;
    if (pa !== pb) return pa - pb;
    if (a.archived !== b.archived) return a.archived ? 1 : -1;
    if (a.revision !== b.revision) return b.revision - a.revision;
    return (b.createdAt ?? "").localeCompare(a.createdAt ?? "");
  });
  return sorted[0];
}

const ACTIVE_ORDER: OrderDocStatus[] = ["potvrzena", "aktualizovana"];
const CLOSED_FOR_ORDER: JobStage[] = ["reklamace", "nerealizovano", "zruseno"];

function deliveredAll(f: FlowFacts): boolean {
  return f.itemsCount > 0 && f.itemsDelivered === f.itemsCount;
}

function deliveredPartial(f: FlowFacts): boolean {
  const rank = flowRank(f.stage);
  return (f.itemsCount > 0 && (f.itemsDelivered > 0 || f.itemsPartial > 0) && f.itemsDelivered < f.itemsCount)
    || (f.itemsCount === 0 && !!f.partialDeliveryAt && rank < 9);
}

export function pricingKey(f: FlowFacts): PricingState | null {
  if (f.stage !== "poptavka" && f.stage !== "naceneni") return null;
  if (f.itemsCount > 0 && f.itemsPriced === f.itemsCount) return "naceneno";
  if (f.pendingSupplierQuotes > 0) return "ceka_na_dodavatele";
  if (f.itemsPriced > 0) return "rozpracovano";
  return "ceka";
}

export function fulfilmentKey(f: FlowFacts): FulfilmentState | null {
  if (!f.orderStatus || !ACTIVE_ORDER.includes(f.orderStatus) || CLOSED_FOR_ORDER.includes(f.stage)) return null;
  const rank = flowRank(f.stage);
  if (deliveredAll(f) || (rank >= 9 && !deliveredPartial(f))) return "dokoncena";
  if (deliveredPartial(f)) return "castecne_dodana";
  if (rank >= 5 && rank <= 8) return "ve_vyrobe";
  return null;
}

export function confirmationKey(f: FlowFacts): ConfirmationState | null {
  const sent = f.confirmationSentRevision ?? 0;
  if (f.orderStatus === "potvrzena") {
    return sent >= (f.orderConfirmedRevision ?? f.orderRevision) ? "odeslano" : "bez_dokladu";
  }
  if (f.orderStatus === "dorucena" || f.orderStatus === "rozpor" || f.orderStatus === "aktualizovana") {
    return (f.confirmationIssuedRevision ?? 0) >= f.orderRevision && sent < f.orderRevision ? "vystaveno" : "k_vystaveni";
  }
  return null;
}

/**
 * Dodání pro fakturu (bez ohledu na doklad objednávky): complete = dodáno vše (i uzavřeno s menším
 * množstvím, i starší zakázka ručně posunutá na Dodáno a dál), partial = dílčí dodávka, none = nic.
 * Faktura z aplikace jen při complete (dílčí faktura na dodané kusy zatím není) — sdílí karta i server.
 */
export function invoiceDeliveryOf(
  f: Pick<FlowFacts, "stage" | "itemsCount" | "itemsDelivered" | "itemsPartial" | "partialDeliveryAt">,
): "none" | "partial" | "complete" {
  const facts = f as FlowFacts;
  if (deliveredAll(facts) || (flowRank(f.stage) >= 9 && !deliveredPartial(facts))) return "complete";
  return deliveredPartial(facts) ? "partial" : "none";
}

/** Fakturu z aplikace jde vystavit: dodáno vše, zakázka ještě fakturu nemá, Ve výrobě…Vyfakturováno. */
export function canIssueInvoice(f: FlowFacts): boolean {
  const rank = flowRank(f.stage);
  return !(f.invoiceNumber ?? "").trim() && rank >= 5 && rank <= 10 && invoiceDeliveryOf(f) === "complete";
}

export function deliveryKey(f: FlowFacts): DeliveryState | null {
  if (!f.orderStatus || CLOSED_FOR_ORDER.includes(f.stage)) return null;
  const rank = flowRank(f.stage);
  if (deliveredAll(f) || (rank >= 9 && !deliveredPartial(f))) {
    const dn = f.deliveryNoteConfirmedAt ? pragueDay(f.deliveryNoteConfirmedAt) : null;
    const last = pragueDay(f.lastDeliveryAt);
    return dn && (!last || dn >= last) ? "dl_potvrzen" : "dodano";
  }
  if (deliveredPartial(f)) return "castecne";
  if (rank >= 5 && rank <= 8
      && ((f.productionTotal > 0 && f.productionDone === f.productionTotal) || f.stage === "dodano_k_nam" || f.stage === "na_sklade")) {
    return "k_expedici";
  }
  return null;
}

export function paymentKey(f: FlowFacts, today: string = pragueToday()): PaymentState | null {
  if (f.stage === "nerealizovano" || f.stage === "zruseno") return null;
  if (f.paidAt || f.stage === "dokonceno") return "zaplaceno";
  if (f.invoiceNumber === null && !(f.paidSoFar > 0) && f.stage !== "fakturovano") return null;
  if (f.invoiceDueDate && f.invoiceDueDate < today) return "po_splatnosti";
  if (f.paidSoFar > 0) return "castecne_zaplaceno";
  return "ceka_na_uhradu";
}

/** = job_flow_v (test parity proti DB). */
export function deriveFlow(f: FlowFacts, quotes: QuoteFacts[], today: string = pragueToday()): FlowSnapshot {
  const aq = activeQuote(quotes);
  const quote = aq ? quoteDisplayState(aq, today) : null;
  let waitingDays: number | null = null;
  const sentDay = aq?.sentAt ? pragueDay(aq.sentAt) : null;
  if (f.inquiryStatus === "ceka_na_podklady" && f.waitingSince) {
    waitingDays = dayDiff(pragueDay(f.waitingSince)!, today);
  } else if (aq && (aq.state === "odeslana" || aq.state === "pripominky") && sentDay) {
    waitingDays = dayDiff(sentDay, today);
  } else if (f.orderStatus === "rozpor" && f.orderStatusChangedAt) {
    waitingDays = dayDiff(pragueDay(f.orderStatusChangedAt)!, today);
  }
  return {
    inquiry: f.inquiryStatus,
    pricing: pricingKey(f),
    quote,
    activeQuote: aq,
    order: f.orderStatus,
    fulfilment: fulfilmentKey(f),
    confirmation: confirmationKey(f),
    delivery: deliveryKey(f),
    payment: paymentKey(f, today),
    waitingDays,
    orderedWithoutQuote: flowRank(f.stage) >= 3 && quotes.length > 0 && !quotes.some((q) => q.state === "prijata"),
  };
}

// ── Průběh (pilulky) ────────────────────────────────────────
export interface Progress {
  done: number;
  total: number;
  label: string;
  /** 0–100 */
  pct: number;
}

function progress(done: number, total: number, label: string): Progress {
  return { done, total, label, pct: total > 0 ? Math.round((Math.min(done, total) / total) * 100) : 0 };
}

/** „2/3 položek“ — po položkách, nikdy součet kusů (M4). */
export function deliveryProgress(f: FlowFacts): Progress | null {
  if (f.itemsCount <= 0) return null;
  return progress(f.itemsDelivered, f.itemsCount, `${f.itemsDelivered}/${f.itemsCount} ${czPlural(f.itemsCount, "položky", "položek", "položek")}`);
}

/** „3/5 operací“. */
export function productionProgress(f: FlowFacts): Progress | null {
  if (f.productionTotal <= 0) return null;
  return progress(f.productionDone, f.productionTotal, `${f.productionDone}/${f.productionTotal} ${czPlural(f.productionTotal, "operace", "operací", "operací")}`);
}

/** Úhrady: bez práva na marže jen procenta, s právem i částky. */
export function paymentProgress(f: FlowFacts & { value: number | null }, canSeeAmounts: boolean): Progress | null {
  const value = f.value ?? 0;
  if (!(f.paidSoFar > 0) || value <= 0) return null;
  const pct = Math.min(100, Math.round((f.paidSoFar / value) * 100));
  const label = canSeeAmounts ? `${formatCzk(f.paidSoFar)} z ${formatCzk(value)}` : `${pct} %`;
  return { done: f.paidSoFar, total: value, label, pct };
}

function formatCzk(n: number): string {
  return `${new Intl.NumberFormat("cs-CZ", { maximumFractionDigits: 0 }).format(n)} Kč`;
}

/** Tvar podle počtu (1 / 2–4 / 5+). */
export function czPlural(n: number, one: string, few: string, many: string): string {
  const a = Math.abs(n);
  if (a === 1) return one;
  if (a >= 2 && a <= 4) return few;
  return many;
}

/** Čeká N dní (chip). */
export function waitingText(days: number | null | undefined): string | null {
  if (days === null || days === undefined) return null;
  if (days <= 0) return "dnes";
  return `čeká ${days} ${czPlural(days, "den", "dny", "dní")}`;
}

// ── Invarianty D1/D2 (TS zrcadlo orders_stage_change) ───────
const OPEN_INQ: InquiryStatus[] = ["prijata", "v_reseni", "ceka_na_podklady"];

export function expectedSubStates(
  stage: JobStage,
  cur: { inquiryStatus: InquiryStatus | null; orderStatus: OrderDocStatus | null; lostReason: LostReason | null; prevStage?: JobStage },
): { inquiryStatus: InquiryStatus | null; orderStatus: OrderDocStatus | null } {
  const rank = flowRank(stage);
  const changed = cur.prevStage !== undefined && cur.prevStage !== stage;
  let inq = cur.inquiryStatus;
  if (inq !== null || rank === 0 || rank === 1) {
    if (rank >= 2) inq = "zpracovana";
    else if (rank === 1) { if (inq !== "v_reseni" && inq !== "ceka_na_podklady") inq = "v_reseni"; }
    else if (rank === 0) {
      if (!inq || !OPEN_INQ.includes(inq)) inq = inq === "odmitnuta" || inq === "stazena" ? "prijata" : "v_reseni";
    } else if ((stage === "nerealizovano" || stage === "zruseno") && inq && OPEN_INQ.includes(inq)) {
      inq = isOurReason(cur.lostReason ?? "neuvedeno") ? "odmitnuta" : "stazena";
    }
  }
  let ord = cur.orderStatus;
  if (rank >= 0 && rank <= 2) ord = null;
  else if (rank === 3) {
    if (ord === null) ord = "dorucena";
    else if (changed && (ord === "potvrzena" || (ord === "stornovana" && cur.prevStage === "zruseno"))) ord = "dorucena";
  } else if (rank >= 4) {
    if (ord === null || ord === "dorucena") ord = "potvrzena";
    else if (changed && ord === "stornovana" && cur.prevStage === "zruseno") ord = "potvrzena";
  } else if (stage === "zruseno" && ord !== null) ord = "stornovana";
  return { inquiryStatus: inq, orderStatus: ord };
}

/** = flow_initial_inquiry v DB (INSERT a backfill). */
export function initialInquiryStatus(p: {
  stage: JobStage; source: string | null; inquiryDate: string | null; inquiryNumber: string | null;
  orderDate: string | null; orderNumber: string | null; pricedBy: string | null;
}): InquiryStatus | null {
  const rank = flowRank(p.stage);
  if (rank >= 3 && !p.inquiryDate && !(p.inquiryNumber ?? "").trim()) return null;
  if (rank >= 2) return "zpracovana";
  if (p.stage === "naceneni") return "v_reseni";
  if (p.stage === "poptavka") return (p.source ?? "manual") === "manual" || p.pricedBy ? "v_reseni" : "prijata";
  if (p.stage === "pozastaveno" || p.stage === "reklamace") {
    return p.stage === "reklamace" || p.orderDate || p.orderNumber ? "zpracovana" : "v_reseni";
  }
  if (p.stage === "nerealizovano" || p.stage === "zruseno") return p.orderDate || p.orderNumber ? "zpracovana" : "stazena";
  return "prijata";
}

/** = flow_initial_order v DB. */
export function initialOrderStatus(p: {
  stage: JobStage; orderDate: string | null; orderNumber: string | null; confirmedAt: string | null;
}): OrderDocStatus | null {
  const rank = flowRank(p.stage);
  if (rank >= 0 && rank <= 2) return null;
  if (p.stage === "objednavka") return "dorucena";
  if (rank >= 4 || p.stage === "reklamace") return "potvrzena";
  if (p.stage === "pozastaveno") {
    if (p.confirmedAt) return "potvrzena";
    return p.orderDate || p.orderNumber ? "dorucena" : null;
  }
  if (p.stage === "zruseno" && (p.orderDate || p.orderNumber)) return "stornovana";
  return null;
}

// ── Náhled dopadu korekce / dílčího stavu (B1 + M2) ─────────
export interface StageEffect {
  /** Nový hlavní stav (null = beze změny). */
  stage: JobStage | null;
  inquiry?: InquiryStatus | null;
  order?: OrderDocStatus | null;
  /** Čísla nabídek, které se zamítnou / archivují / přijmou. */
  quotesRejected: string[];
  quotesArchived: string[];
  quoteAccepted: string | null;
  warnings: string[];
}

export function quoteLabel(q: Pick<QuoteFacts, "number" | "revision">): string {
  const base = q.number?.trim() || "Nabídka";
  return q.revision > 1 && !/-R\d+$/i.test(base) ? `${base} r${q.revision}` : base;
}

function stageAfterSubChange(f: FlowFacts, change: { kind: "inquiry"; to: InquiryStatus } | { kind: "order"; to: OrderDocStatus }): JobStage | null {
  const rank = flowRank(f.stage);
  if (change.kind === "inquiry") {
    if ((change.to === "odmitnuta" || change.to === "stazena") && ["poptavka", "naceneni", "pozastaveno"].includes(f.stage)) return "nerealizovano";
    if ((f.inquiryStatus === "odmitnuta" || f.inquiryStatus === "stazena") && OPEN_INQ.includes(change.to)
        && (f.stage === "nerealizovano" || f.stage === "zruseno")) return "poptavka";
    return null;
  }
  const to = change.to;
  if (to === "stornovana" && f.itemsDelivered === 0 && f.itemsPartial === 0 && !f.partialDeliveryAt
      && ((rank >= 3 && rank <= 8) || f.stage === "pozastaveno")) return "zruseno";
  if (f.orderStatus === "stornovana" && f.stage === "zruseno" && to !== "stornovana") {
    return to === "dorucena" || to === "rozpor" ? "objednavka" : "potvrzeno";
  }
  if ((to === "dorucena" || to === "rozpor") && rank >= 0 && rank <= 2) return "objednavka";
  if (to === "potvrzena" && rank >= 0 && rank <= 3) return "potvrzeno";
  return null;
}

export function stageEffect(
  f: FlowFacts,
  quotes: QuoteFacts[],
  change: { kind: "stage"; to: JobStage } | { kind: "inquiry"; to: InquiryStatus } | { kind: "order"; to: OrderDocStatus },
): StageEffect {
  const out: StageEffect = { stage: null, quotesRejected: [], quotesArchived: [], quoteAccepted: null, warnings: [] };
  let target: JobStage = f.stage;
  let inquiry = f.inquiryStatus;
  let order = f.orderStatus;
  if (change.kind === "stage") {
    target = change.to;
  } else {
    const s = stageAfterSubChange(f, change);
    if (change.kind === "inquiry") inquiry = change.to;
    else order = change.to;
    if (s) target = s;
  }
  if (target !== f.stage) out.stage = target;
  const subs = expectedSubStates(target, { inquiryStatus: inquiry, orderStatus: order, lostReason: f.lostReason, prevStage: f.stage });
  if (subs.inquiryStatus !== f.inquiryStatus) out.inquiry = subs.inquiryStatus;
  if (subs.orderStatus !== f.orderStatus) out.order = subs.orderStatus;

  const oldRank = flowRank(f.stage);
  const newRank = flowRank(target);
  const open = quotes.filter((q) => !q.archived);
  if (target !== f.stage) {
    if ((target === "nerealizovano" || target === "zruseno") && f.stage !== "nerealizovano" && f.stage !== "zruseno") {
      out.quotesRejected = open.filter((q) => q.status === "odeslano").map(quoteLabel);
      out.quotesArchived = open.filter((q) => q.status === "navrh_ai" || q.status === "ke_schvaleni").map(quoteLabel);
    } else if (newRank >= 3 && oldRank >= 0 && oldRank <= 2 && !quotes.some((q) => q.status === "prijato")) {
      const sent = open.filter((q) => q.status === "odeslano");
      if (sent.length === 1) {
        out.quoteAccepted = quoteLabel(sent[0]);
        out.quotesArchived = open.filter((q) => q.id !== sent[0].id && (q.status === "navrh_ai" || q.status === "ke_schvaleni")).map(quoteLabel);
      } else if (quotes.length) {
        out.warnings.push("Objednáno bez přijaté nabídky — vyber nabídku, kterou zákazník objednal.");
      }
    }
    if (newRank >= 0 && oldRank > newRank) {
      out.warnings.push("Posun zpět: razítka pozdějších kroků (potvrzení, výroba, dodání, faktura) se vynulují.");
    }
    if (target === "dokonceno" && !f.paidAt) out.warnings.push("Zakázka se označí jako zaplacená ke dnešnímu dni.");
  }
  const keptOrder = subs.orderStatus;
  if (keptOrder === "rozpor" || keptOrder === "aktualizovana") {
    if (target !== f.stage) out.warnings.push(`Objednávka zůstává „${ORDER_STATES[keptOrder].label}“ — vyřeš ji ručně.`);
  }
  return out;
}

/** Text náhledu: „Nabídka NAB-2026-031 r2 → Zamítnutá · poptávka zůstane Zpracovaná“. */
export function stageEffectText(e: StageEffect, reason?: LostReason | null): string[] {
  const lines: string[] = [];
  const why = reason ? ` (${lostReasonLabel(reason)})` : "";
  for (const q of e.quotesRejected) lines.push(`Nabídka ${q} → Zamítnutá${why}`);
  for (const q of e.quotesArchived) lines.push(`Nabídka ${q} → Archivovaná`);
  if (e.quoteAccepted) lines.push(`Nabídka ${e.quoteAccepted} → Přijatá`);
  if (e.inquiry !== undefined) lines.push(`Poptávka → ${e.inquiry ? INQUIRY_STATES[e.inquiry].label : "bez poptávky"}`);
  if (e.order !== undefined) lines.push(`Objednávka → ${e.order ? ORDER_STATES[e.order].label : "zatím není"}`);
  return [...lines, ...e.warnings];
}

// ── Atribuce („kdo · kdy“) ──────────────────────────────────
export interface ChangeStamp {
  by: PersonRef | null;
  /** Jméno uložené v době změny (přežije smazání účtu). */
  byName: string | null;
  at: string | null;
  via: ChangeVia | null;
  kind: ActorKind;
  agent?: string | null;
  cause?: FlowCause | string | null;
  note?: string | null;
}

export interface JobStamps {
  stage: ChangeStamp | null;
  inquiry: ChangeStamp | null;
  order: ChangeStamp | null;
  confirmed: ChangeStamp | null;
  confirmationSent: ChangeStamp | null;
  deliveryNote: ChangeStamp | null;
  invoiced: ChangeStamp | null;
  paid: ChangeStamp | null;
  lost: ChangeStamp | null;
  proposal: ChangeStamp | null;
  /** Kdo a kdy dosáhl stavu — časová osa a řádek průběhu. */
  stageHistory: Partial<Record<JobStage, ChangeStamp>>;
}

export const VIA_META: Record<ChangeVia, { label: string; icon: LucideIcon }> = {
  rucne: { label: "ručně", icon: Hand },
  ai: { label: "AI", icon: Sparkles },
  foto: { label: "z fotky dokladu", icon: Camera },
  email: { label: "e-mailem", icon: Mail },
  automaticky: { label: "automaticky", icon: Cog },
  import: { label: "importem", icon: Upload },
  cron: { label: "plánovačem", icon: Clock },
  rest: { label: "přímo přes API", icon: Globe },
  db: { label: "přímým zápisem do DB", icon: Database },
};

/** = flow_cause_label v DB (test parity). */
export const CAUSE_LABELS: Record<FlowCause, string> = {
  vyroba: "výroba začala",
  platba: "platba",
  nabidka: "nabídka",
  dodani: "vše dodáno",
  poptavka: "poptávka uzavřena",
  objednavka: "objednávka",
  obnoveni: "obnoveno",
  podklady: "přišly podklady",
  potvrzeni: "potvrzení odesláno",
  uzavreni: "zakázka uzavřena",
  prijeti: "objednáno — nabídka přijata",
};

const AGENT_LABELS: Record<string, string> = {
  capture: "foto",
  "email-ingest": "e-mail",
  "ai-quote": "nabídka",
  "cron-mail": "pošta",
  cron: "plánovač",
};

const KIND_ICON: Record<ActorKind, LucideIcon> = { user: UserRoundCheck, ai: Sparkles, system: Cog };
export function actorKindIcon(kind: ActorKind): LucideIcon {
  return KIND_ICON[kind] ?? Cog;
}

/** Jméno autora — NIKDY prázdné (3.6). */
export function actorName(s: Pick<ChangeStamp, "by" | "byName" | "kind" | "via" | "agent">): string {
  const name = s.by?.name?.trim() || null;
  if (s.kind === "ai") {
    if (name) return `✨ AI za účet ${name}`;
    const agent = s.agent ? AGENT_LABELS[s.agent] ?? s.agent : null;
    return agent ? `✨ AI (${agent})` : "✨ AI";
  }
  if (name) return name;
  const stored = s.byName?.trim();
  if (stored) return `${stored} (účet zrušen)`;
  if (s.kind === "system") {
    if (s.via === "cron") return "Systém (plánovač)";
    if (s.via === "db") return "Systém · před evidencí";
    if (s.via === "automaticky") return "Automaticky";
    return "Systém";
  }
  return "Neznámý účet";
}

/** „před 5 min“, „včera 14:05“, „12. 10.“ (bez rodových sloves). */
export function relativeStampTime(at: string | null | undefined, now: Date = new Date()): string | null {
  if (!at) return null;
  // jen datum (sloupec date, např. potvrzení DL) — žádné vymyšlené „před 9 h"
  if (/^\d{4}-\d{2}-\d{2}$/.test(at)) {
    const days = dayDiff(at, pragueToday(now));
    if (days === 0) return "dnes";
    if (days === 1) return "včera";
    const [y, m, d] = at.split("-").map(Number);
    return `${d}. ${m}.${y !== Number(pragueToday(now).slice(0, 4)) ? ` ${y}` : ""}`;
  }
  const t = new Date(at);
  if (Number.isNaN(t.getTime())) return null;
  const diffMin = Math.floor((now.getTime() - t.getTime()) / 60_000);
  if (diffMin < 1) return "právě teď";
  if (diffMin < 60) return `před ${diffMin} min`;
  const hours = Math.floor(diffMin / 60);
  const dayNow = pragueToday(now);
  const dayAt = PRAGUE_DAY.format(t);
  const days = dayDiff(dayAt, dayNow);
  if (days === 0) return `před ${hours} h`;
  const time = new Intl.DateTimeFormat("cs-CZ", { timeZone: "Europe/Prague", hour: "2-digit", minute: "2-digit" }).format(t);
  if (days === 1) return `včera ${time}`;
  if (days < 7) return `před ${days} dny`;
  const sameYear = dayAt.slice(0, 4) === dayNow.slice(0, 4);
  return new Intl.DateTimeFormat("cs-CZ", {
    timeZone: "Europe/Prague", day: "numeric", month: "numeric", ...(sameYear ? {} : { year: "numeric" }),
  }).format(t);
}

/** „J. Novák · před 5 min“ (short = zkrácené jméno). */
export function stampText(s: ChangeStamp, now: Date = new Date(), opts: { short?: boolean } = {}): string {
  const who = stampWho(s, opts);
  const when = relativeStampTime(s.at, now);
  return when ? `${who} · ${when}` : who;
}

/** Jen „kdo" z razítka (short = „P. Obchodník"). */
export function stampWho(s: ChangeStamp, opts: { short?: boolean } = {}): string {
  return opts.short && s.by?.name && s.kind === "user" ? shortPersonName(s.by.name) : actorName(s);
}

/** „Petr Obchodník“ → „P. Obchodník“. */
export function shortPersonName(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length < 2) return name.trim();
  return `${parts[0][0]}. ${parts.slice(1).join(" ")}`;
}

/** Detail (menu po ťuknutí): jméno, čas cs-CZ, způsob, příčina, poznámka. */
export function stampTitle(s: ChangeStamp): string {
  const lines = [actorName(s)];
  if (s.at) {
    const d = new Date(s.at);
    if (!Number.isNaN(d.getTime())) {
      const dateOnly = /^\d{4}-\d{2}-\d{2}$/.test(s.at);
      lines.push(new Intl.DateTimeFormat("cs-CZ", { timeZone: "Europe/Prague", dateStyle: "medium", ...(dateOnly ? {} : { timeStyle: "short" }) }).format(d));
    }
  }
  if (s.via) lines.push(`Způsob: ${VIA_META[s.via]?.label ?? s.via}`);
  if (s.cause) lines.push(`Příčina: ${CAUSE_LABELS[s.cause as FlowCause] ?? s.cause}`);
  if (s.note) lines.push(`Poznámka: ${s.note}`);
  return lines.join("\n");
}

function str(v: unknown): string | null {
  return typeof v === "string" && v.trim() ? v : null;
}

const VIAS: ChangeVia[] = ["rucne", "ai", "foto", "email", "automaticky", "import", "cron", "rest", "db"];

/**
 * Razítko ze sloupců řádku: prefix „stage_changed“ → stage_changed_at/_by/_via (+ stage_change_cause/note),
 * „lost“ → lost_at/lost_by… person = embed profilu (id, full_name). Bez času i autora → null.
 */
export function stampFromRow(row: Record<string, unknown>, prefix: string, person?: PersonRef | null): ChangeStamp | null {
  const at = str(row[`${prefix}_at`]);
  const byId = str(row[`${prefix}_by`]);
  const viaRaw = str(row[`${prefix}_via`]);
  const via = viaRaw && (VIAS as string[]).includes(viaRaw) ? (viaRaw as ChangeVia) : null;
  if (!at && !byId) return null;
  const base = prefix.endsWith("_changed") ? prefix.slice(0, -"_changed".length) : prefix;
  const by = person && person.name ? person : null;
  const kind: ActorKind = via === "ai" ? "ai" : byId || by ? "user" : "system";
  return {
    by,
    byName: by?.name ?? null,
    at,
    via,
    kind,
    cause: str(row[`${base}_change_cause`]),
    note: str(row[`${base}_change_note`]),
  };
}

// ── Chipy ───────────────────────────────────────────────────
export interface PhaseChip {
  phase: FlowPhase;
  key: string;
  meta: FlowStateMeta;
  progress?: Progress | null;
  /** „čeká 3 dny“, „rev 2“, „NAB-2026-031 r2“, „objednáno 3/5“ */
  hint?: string | null;
  stamp?: ChangeStamp | null;
  ai?: boolean;
  /** Text chipu (štítek + doplněk), např. „Odmítnutá — Kapacita“. */
  label: string;
}

function chip(phase: FlowPhase, m: FlowStateMeta, extra: Partial<PhaseChip> = {}): PhaseChip {
  return { phase, key: m.key, meta: m, label: m.label, ...extra };
}

function mismatchHint(f: FlowFacts): string | null {
  const items = f.orderMismatch?.items ?? [];
  const missing = items.filter((i) => i.kind === "chybi_polozka").length;
  if (missing > 0 && f.itemsCount > 0) return `Objednáno částečně (${Math.max(0, f.itemsCount - missing)}/${f.itemsCount})`;
  if (items.length) return `${items.length} ${czPlural(items.length, "rozdíl", "rozdíly", "rozdílů")}`;
  return null;
}

function orderChip(f: FlowFacts, s: FlowSnapshot, stamps?: JobStamps | null): PhaseChip | null {
  if (!s.order) return null;
  const m = ORDER_STATES[s.order];
  const hint = s.order === "rozpor"
    ? [mismatchHint(f), f.orderMismatch?.fix_requested_at ? waitingText(dayDiff(pragueDay(f.orderMismatch.fix_requested_at)!, pragueToday())) : null].filter(Boolean).join(" · ") || null
    : (s.order === "dorucena" || s.order === "aktualizovana") && f.orderRevision > 1 ? `rev ${f.orderRevision}` : null;
  return chip("order", m, { hint, stamp: stamps?.order ?? null, label: hint && s.order !== "rozpor" ? `${m.label} (${hint})` : m.label });
}

function quoteChip(s: FlowSnapshot, stamps?: JobStamps | null): PhaseChip | null {
  if (!s.quote || !s.activeQuote) return null;
  const m = QUOTE_STATES[s.quote];
  const hint = [quoteLabel(s.activeQuote), s.quote === "odeslana" ? waitingText(s.waitingDays) : null].filter(Boolean).join(" · ");
  return chip("quote", m, { hint, ai: s.activeQuote.aiGenerated, stamp: stamps?.stageHistory.nabidka ?? null });
}

function proposalChip(f: FlowFacts, stamps?: JobStamps | null): PhaseChip | null {
  const p = f.proposal;
  if (!p) return null;
  const m: FlowStateMeta = { ...PROPOSAL_META, icon: p.kind === "ai" ? Sparkles : Hand };
  return chip("proposal", m, {
    label: `Návrh: ${p.label}`,
    hint: p.reason ? lostReasonLabel(p.reason) : p.note ?? null,
    ai: p.kind === "ai",
    stamp: stamps?.proposal ?? null,
  });
}

/**
 * Výroba z faktů zakázky (orders.production_*; zrcadlí routeHealth): aktuální krok bez kdo / termínu,
 * konec výroby po konečném termínu (o kolik dní), krok s konečným termínem s jiným datem, další krok čeká.
 */
export function productionHealth(f: FlowFacts): { unplanned: boolean; late: number | null; finalChanged: boolean; nextWaiting: boolean } {
  const total = f.productionTotal ?? 0;
  const step = f.productionStep ?? null;
  const open = total > 0 && f.productionDone < total && step !== "hotovo";
  const loc = (f.productionLocation ?? "").trim();
  const unplanned = f.stage === "ve_vyrobe" && (!open || !step || !loc || loc === "—" || !f.productionDue);
  const target = f.dueDate ?? f.customerRequiredDate ?? null;
  const late = open && f.productionEnd && target && f.productionEnd > target ? dayDiff(target, f.productionEnd) : null;
  const finalChanged = open && Boolean(f.productionFinalEnd && f.dueDate && f.productionFinalEnd !== f.dueDate);
  const nextWaiting = open && !unplanned && f.productionRunning === false;
  return { unplanned, late, finalChanged, nextWaiting };
}

/** Chip řádku Knihy — jen když přidává informaci k StageBadge (tabulka 1.11). */
export function primaryChip(f: FlowFacts, s: FlowSnapshot, stamps?: JobStamps | null): PhaseChip | null {
  const pc = proposalChip(f, stamps);
  if (pc) return pc;
  if (s.order === "rozpor" && !CLOSED_FOR_ORDER.includes(f.stage)) return orderChip(f, s, stamps);
  const rank = flowRank(f.stage);
  switch (f.stage) {
    case "poptavka": {
      if (!s.inquiry || !OPEN_INQ.includes(s.inquiry)) return null;
      const m = INQUIRY_STATES[s.inquiry];
      const by = stamps?.inquiry?.by?.name ?? null;
      // řešitel ≠ autor změny: „řeší J. Z."; je-li to tentýž účet, jméno nese razítko pod chipem
      const hint = s.inquiry === "ceka_na_podklady" ? waitingText(s.waitingDays)
        : s.inquiry === "v_reseni" && f.assigneeName && f.assigneeName !== by ? `řeší ${shortPersonName(f.assigneeName)}` : null;
      return chip("inquiry", m, { hint, stamp: stamps?.inquiry ?? null });
    }
    case "naceneni": {
      if (s.quote === "rozpracovana" || s.quote === "ke_schvaleni" || s.quote === "schvalena") return quoteChip(s, stamps);
      if (!s.pricing) return null;
      const m = PRICING_STATES[s.pricing];
      const hint = s.pricing === "rozpracovano" ? `${f.itemsPriced}/${f.itemsCount}`
        : s.pricing === "ceka_na_dodavatele" ? String(f.pendingSupplierQuotes) : null;
      return chip("pricing", m, { hint, label: hint ? `${m.label} (${hint})` : m.label });
    }
    case "nabidka":
      return s.quote === "odeslana" || s.quote === "pripominky" || s.quote === "vyprsela" ? quoteChip(s, stamps) : null;
    case "objednavka":
      return s.order === "dorucena" || s.order === "aktualizovana" ? orderChip(f, s, stamps) : null;
    case "pozastaveno":
    case "dokonceno":
    case "reklamace":
      return null;
    case "nerealizovano":
    case "zruseno": {
      const m = f.stage === "zruseno" ? CANCELLED_JOB_META : LOST_JOB_META;
      const why = lostReasonLabel(f.lostReason);
      return chip(f.stage === "zruseno" ? "order" : "inquiry", m, { label: `${m.label} — ${why}`, hint: f.lostNote ?? null, stamp: stamps?.lost ?? null });
    }
    default:
      break;
  }
  if (rank >= 4 && rank <= 8 && s.order === "aktualizovana") return orderChip(f, s, stamps);
  if (f.stage === "potvrzeno") {
    if (s.confirmation === "bez_dokladu") {
      const m = CONFIRMATION_STATES.bez_dokladu;
      return chip("confirmation", m, { hint: `rev ${f.orderConfirmedRevision ?? f.orderRevision}`, stamp: stamps?.confirmed ?? null });
    }
    // potvrzená objednávka: další krok je vždy předání do výroby (i s připraveným postupem / objednávkou z Nákupu)
    return chip("fulfilment", NO_PLAN_META);
  }
  if (rank >= 5 && rank <= 8) {
    if (s.delivery === "castecne") return chip("delivery", DELIVERY_STATES.castecne, { progress: deliveryProgress(f) });
    if (s.delivery === "k_expedici") return chip("delivery", DELIVERY_STATES.k_expedici);
    if (f.stage === "ve_vyrobe") {
      const h = productionHealth(f);
      if (h.late !== null) return chip("fulfilment", ROUTE_LATE_META, { label: `${ROUTE_LATE_META.label} (o ${h.late} ${czPlural(h.late, "den", "dny", "dní")})` });
      if (h.finalChanged) return chip("fulfilment", FINAL_CHANGED_META);
      if (h.unplanned) return chip("fulfilment", UNPLANNED_META);
      if (h.nextWaiting) return chip("fulfilment", NEXT_STEP_META);
    }
    return null;
  }
  if (f.stage === "dodano_zakaznikovi") {
    if (s.delivery === "dodano" || s.delivery === "dl_potvrzen") {
      return chip("delivery", DELIVERY_STATES[s.delivery], { stamp: s.delivery === "dl_potvrzen" ? stamps?.deliveryNote ?? null : null });
    }
    return null;
  }
  if (f.stage === "fakturovano" && s.payment && s.payment !== "zaplaceno") {
    const m = PAYMENT_STATES[s.payment];
    return chip("payment", m, { stamp: stamps?.invoiced ?? null });
  }
  return null;
}

export interface TrailStep {
  phase: FlowPhase;
  label: string;
  done: boolean;
  current: boolean;
  /** Fáze se přeskočila (objednávka bez nabídky) — ne „hotovo". */
  skipped?: boolean;
  stamp?: ChangeStamp | null;
  chip?: PhaseChip;
}

/** Jeden řádek průběhu v hlavičce detailu (M9): hotové ✓ · kdo, aktuální s chipem, budoucí ztlumené. */
export function phaseTrail(f: FlowFacts, s: FlowSnapshot, stamps: JobStamps): TrailStep[] {
  const rank = flowRank(f.stage);
  const h = stamps.stageHistory;
  const aq = s.activeQuote;
  const steps: { phase: FlowPhase; label: string; from: number; to: number; done: boolean; stamp: ChangeStamp | null }[] = [
    { phase: "inquiry", label: "Poptávka", from: 0, to: 1, done: s.inquiry === "zpracovana", stamp: stamps.inquiry },
    { phase: "quote", label: aq ? `Nabídka${aq.revision > 1 ? ` r${aq.revision}` : ""}` : "Nabídka", from: 2, to: 2,
      done: aq?.state === "prijata" || (rank >= 3 && Boolean(aq) && !s.orderedWithoutQuote), stamp: h.nabidka ?? null },
    // aktualizovaná objednávka čeká na rozhodnutí — fáze je zase aktuální (chip s akcí v hlavičce)
    { phase: "order", label: "Objednávka", from: 3, to: 4, done: s.order === "potvrzena",
      stamp: stamps.confirmed ?? stamps.order },
    { phase: "fulfilment", label: "Výroba", from: 5, to: 8, done: rank >= 9 || s.fulfilment === "dokoncena", stamp: h.ve_vyrobe ?? null },
    { phase: "delivery", label: "Dodání", from: 9, to: 9, done: s.delivery === "dl_potvrzen" || rank >= 10,
      stamp: stamps.deliveryNote ?? h.dodano_zakaznikovi ?? null },
    { phase: "payment", label: "Faktura", from: 10, to: 11, done: s.payment === "zaplaceno", stamp: stamps.paid ?? h.fakturovano ?? null },
  ];
  const pc = primaryChip(f, s, stamps);
  // fáze s hlavním stavem; je-li hotová, ale řádek Knihy má co říct (bez dokladu, rozpor…), chip ukáže ona
  const here = steps.findIndex((st) => rank >= st.from && rank <= st.to);
  const anyOpen = steps.some((st) => rank >= st.from && rank <= st.to && !st.done);
  return steps.map((st, i) => {
    const current = (rank >= st.from && rank <= st.to && !st.done) || (!anyOpen && Boolean(pc) && i === here);
    const passed = !current && (st.done || (rank > st.to && rank >= 0));
    // objednáno bez (přijaté) nabídky → nabídka „přeskočena", ne „✓ hotovo"
    const skipped = passed && st.phase === "quote" && !st.done && (!aq || s.orderedWithoutQuote);
    return {
      phase: st.phase,
      label: st.label,
      done: passed && !skipped,
      current,
      ...(skipped ? { skipped: true } : {}),
      stamp: skipped ? null : st.stamp,
      ...(current && pc ? { chip: pc } : {}),
    };
  });
}

export type FlowTab = "inquiries" | "pricing" | "quotes" | "confirmations" | "book";

/** Chipy filtru záložky s počty (counts: „fáze.klíč“ → n z getFlowCounts). */
export function chipsForTab(tab: FlowTab, counts: Record<string, number>): {
  key: string; phase: FlowPhase; label: string; count: number; palette: PaletteKey; open: boolean;
}[] {
  const n = (phase: string, key: string) => counts[`${phase}.${key}`] ?? 0;
  if (tab === "inquiries") {
    return INQUIRY_ORDER.map((k) => ({ key: k, phase: "inquiry", label: INQUIRY_STATES[k].label, count: n("inquiry", k),
      palette: INQUIRY_STATES[k].palette, open: OPEN_INQUIRY.includes(k) }));
  }
  if (tab === "pricing") {
    return PRICING_ORDER.map((k) => ({ key: k, phase: "pricing", label: PRICING_STATES[k].label, count: n("pricing", k),
      palette: PRICING_STATES[k].palette, open: true }));
  }
  if (tab === "quotes") {
    return QUOTE_ORDER.map((k) => ({ key: k, phase: "quote", label: QUOTE_STATES[k].label, count: n("quote", k),
      palette: QUOTE_STATES[k].palette, open: OPEN_QUOTE.includes(k) }));
  }
  return ORDER_TAB_CHIPS.map((c) => {
    const m = c.phase === "order" ? ORDER_STATES[c.key as OrderDocStatus] : FULFILMENT_STATES[c.key as FulfilmentState];
    return { key: c.key, phase: c.phase, label: m.label, count: n(c.phase, c.key), palette: m.palette, open: c.open };
  });
}

// ── Akce ────────────────────────────────────────────────────
export type FlowActionKey =
  | "proposal.decide" | "inquiry.take" | "inquiry.wait" | "inquiry.resume" | "inquiry.decline" | "inquiry.withdraw"
  | "inquiry.reopen" | "inquiry.propose" | "pricing.open" | "pricing.supplierPrice" | "quote.create" | "quote.edit"
  | "quote.requestApproval" | "quote.approve" | "quote.approveSend" | "quote.unapprove" | "quote.send" | "quote.markSent"
  | "quote.feedback" | "quote.answerNoChange" | "quote.accept" | "quote.reject" | "quote.propose" | "quote.reopen"
  | "quote.returnToAuthor" | "quote.newRevision" | "quote.extend" | "order.confirm" | "order.confirmOther" | "order.flagMismatch"
  | "order.resolveMismatch" | "order.requestFix" | "order.registerChange" | "order.decideChange" | "order.rejectChange"
  | "order.sendConfirmation" | "order.cancel" | "order.propose" | "order.reopen" | "production.plan" | "production.handoff"
  | "production.advance" | "production.finish" | "production.replan" | "production.sendPo" | "production.undo"
  | "purchasing.notifySuppliers" | "delivery.record"
  | "delivery.closeShort" | "delivery.partialNote" | "delivery.confirmNote" | "payment.invoice" | "payment.invoiceExternal"
  | "payment.record" | "payment.settle" | "job.correct"
  // výjimky v toku (31. 10.) — „Co se stalo?"
  | "job.notOrdered" | "job.decline" | "job.reopenLost" | "job.pause" | "job.resume" | "production.failed"
  | "claim.open" | "claim.resolve" | "claim.close" | "order.startWithoutPo" | "order.poArrived" | "order.correct"
  | "drawing.update";

export interface FlowActionMeta {
  key: FlowActionKey;
  /** Sloveso: „Převzít“, „Potvrdit objednávku“, „Zadat platbu“. */
  label: string;
  icon: LucideIcon;
  intent: "primary" | "secondary" | "danger";
  feature: Feature;
  needsReason?: boolean;
  /** direct = jeden zápis (toast „Vrátit“), dialog = otevře dialog, link = přejde jinam. */
  kind: "direct" | "dialog" | "link";
  href?: (jobId: string) => string;
}

function act(m: FlowActionMeta): FlowActionMeta {
  return m;
}

const tab = (t: string) => (jobId: string) => `/orders/${jobId}?tab=${t}`;

export const FLOW_ACTIONS: Record<FlowActionKey, FlowActionMeta> = {
  "proposal.decide": act({ key: "proposal.decide", label: "Rozhodnout návrh", icon: Hand, intent: "primary", feature: "workflow", kind: "dialog" }),
  "inquiry.take": act({ key: "inquiry.take", label: "Převzít", icon: UserRoundCheck, intent: "primary", feature: "workflow", kind: "direct" }),
  "inquiry.wait": act({ key: "inquiry.wait", label: "Čeká na podklady…", icon: FileQuestion, intent: "secondary", feature: "workflow", kind: "dialog" }),
  "inquiry.resume": act({ key: "inquiry.resume", label: "Podklady máme", icon: CircleCheck, intent: "primary", feature: "workflow", kind: "direct" }),
  "inquiry.decline": act({ key: "inquiry.decline", label: "Odmítnout poptávku…", icon: CircleX, intent: "danger", feature: "margins", needsReason: true, kind: "dialog" }),
  "inquiry.withdraw": act({ key: "inquiry.withdraw", label: "Zákazník stáhl…", icon: Undo2, intent: "danger", feature: "margins", needsReason: true, kind: "dialog" }),
  "inquiry.reopen": act({ key: "inquiry.reopen", label: "Obnovit poptávku", icon: Undo, intent: "secondary", feature: "margins", kind: "direct" }),
  "inquiry.propose": act({ key: "inquiry.propose", label: "Navrhnout odmítnutí…", icon: Hand, intent: "danger", feature: "workflow", needsReason: true, kind: "dialog" }),
  // #25: Nacenění zatím jen super admin (ostatní „Vytvořit nabídku“ ručně)
  "pricing.open": act({ key: "pricing.open", label: "Nacenit", icon: Calculator, intent: "primary", feature: "pricing", kind: "link", href: tab("items") }),
  "pricing.supplierPrice": act({ key: "pricing.supplierPrice", label: "Zadat cenu dodavatele", icon: Hourglass, intent: "primary", feature: "margins", kind: "link", href: tab("purchasing") }),
  "quote.create": act({ key: "quote.create", label: "Vytvořit nabídku", icon: FilePlus, intent: "primary", feature: "workflow", kind: "link", href: tab("quotes") }),
  "quote.edit": act({ key: "quote.edit", label: "Upravit nabídku", icon: Pencil, intent: "secondary", feature: "workflow", kind: "link", href: tab("quotes") }),
  "quote.requestApproval": act({ key: "quote.requestApproval", label: "Předat ke schválení", icon: ShieldQuestion, intent: "primary", feature: "workflow", kind: "direct" }),
  // #25: schvaluje jen super admin; odeslat smí kdo smí pracovat s tokem — konkrétně rozhodne quoteSendBlock
  "quote.approve": act({ key: "quote.approve", label: "Schválit", icon: ShieldCheck, intent: "primary", feature: "quote_approval", kind: "direct" }),
  "quote.approveSend": act({ key: "quote.approveSend", label: "Schválit a odeslat", icon: Send, intent: "primary", feature: "quote_approval", kind: "dialog" }),
  "quote.unapprove": act({ key: "quote.unapprove", label: "Vrátit k úpravě", icon: Undo, intent: "secondary", feature: "quote_approval", kind: "dialog" }),
  "quote.returnToAuthor": act({ key: "quote.returnToAuthor", label: "Vrátit k přepracování…", icon: Undo2, intent: "secondary", feature: "quote_approval", kind: "dialog" }),
  "quote.send": act({ key: "quote.send", label: "Odeslat nabídku", icon: Send, intent: "primary", feature: "workflow", kind: "dialog" }),
  "quote.markSent": act({ key: "quote.markSent", label: "Odesláno jinak…", icon: Hand, intent: "secondary", feature: "workflow", kind: "dialog" }),
  "quote.feedback": act({ key: "quote.feedback", label: "Zákazník má připomínky…", icon: MessageSquareWarning, intent: "secondary", feature: "workflow", kind: "dialog" }),
  "quote.answerNoChange": act({ key: "quote.answerNoChange", label: "Odpovědět bez změny", icon: Send, intent: "secondary", feature: "margins", kind: "direct" }),
  "quote.accept": act({ key: "quote.accept", label: "Zákazník objednal", icon: Trophy, intent: "primary", feature: "workflow", kind: "direct" }),
  "quote.reject": act({ key: "quote.reject", label: "Zamítnout nabídku…", icon: ThumbsDown, intent: "danger", feature: "margins", needsReason: true, kind: "dialog" }),
  "quote.propose": act({ key: "quote.propose", label: "Navrhnout zamítnutí…", icon: Hand, intent: "danger", feature: "workflow", needsReason: true, kind: "dialog" }),
  "quote.reopen": act({ key: "quote.reopen", label: "Zákazník se vrátil", icon: ThumbsUp, intent: "secondary", feature: "margins", kind: "direct" }),
  "quote.newRevision": act({ key: "quote.newRevision", label: "Nová verze", icon: FilePen, intent: "primary", feature: "workflow", kind: "direct" }),
  "quote.extend": act({ key: "quote.extend", label: "Prodloužit platnost", icon: CalendarPlus, intent: "primary", feature: "workflow", kind: "dialog" }),
  "order.confirm": act({ key: "order.confirm", label: "Potvrdit objednávku", icon: BadgeCheck, intent: "primary", feature: "workflow", kind: "dialog" }),
  "order.confirmOther": act({ key: "order.confirmOther", label: "Potvrzeno jinak…", icon: Handshake, intent: "secondary", feature: "workflow", kind: "dialog" }),
  "order.flagMismatch": act({ key: "order.flagMismatch", label: "Rozpor s nabídkou…", icon: GitCompare, intent: "secondary", feature: "workflow", kind: "dialog" }),
  "order.resolveMismatch": act({ key: "order.resolveMismatch", label: "Vyřešit rozpor", icon: GitCompare, intent: "primary", feature: "workflow", kind: "dialog" }),
  "order.requestFix": act({ key: "order.requestFix", label: "Požádat o opravu", icon: Mail, intent: "secondary", feature: "workflow", kind: "dialog" }),
  "order.registerChange": act({ key: "order.registerChange", label: "Zákazník změnil objednávku…", icon: RefreshCw, intent: "secondary", feature: "workflow", kind: "dialog" }),
  "order.decideChange": act({ key: "order.decideChange", label: "Potvrdit změnu", icon: BadgeCheck, intent: "primary", feature: "workflow", kind: "dialog" }),
  "order.rejectChange": act({ key: "order.rejectChange", label: "Změnu nepřijímáme…", icon: CircleX, intent: "secondary", feature: "workflow", kind: "dialog" }),
  "order.sendConfirmation": act({ key: "order.sendConfirmation", label: "Odeslat potvrzení", icon: MailCheck, intent: "primary", feature: "documents", kind: "dialog" }),
  "order.cancel": act({ key: "order.cancel", label: "Stornovat objednávku…", icon: Ban, intent: "danger", feature: "margins", needsReason: true, kind: "dialog" }),
  "order.propose": act({ key: "order.propose", label: "Navrhnout storno…", icon: Hand, intent: "danger", feature: "workflow", needsReason: true, kind: "dialog" }),
  "order.reopen": act({ key: "order.reopen", label: "Obnovit objednávku", icon: Undo, intent: "secondary", feature: "delete", kind: "direct" }),
  "production.plan": act({ key: "production.plan", label: "Naplánovat postup", icon: Factory, intent: "secondary", feature: "orders", kind: "link", href: tab("vyroba") }),
  // předání do výroby (povinně kdo + termín; objednávka dodavateli se vystaví sama)
  "production.handoff": act({ key: "production.handoff", label: "Předat do výroby…", icon: Factory, intent: "primary", feature: "orders", kind: "dialog" }),
  "production.advance": act({ key: "production.advance", label: "Posunout dál…", icon: ArrowRightCircle, intent: "primary", feature: "orders", kind: "dialog" }),
  "production.finish": act({ key: "production.finish", label: "Ukončit výrobu…", icon: Flag, intent: "secondary", feature: "orders", kind: "dialog" }),
  "production.replan": act({ key: "production.replan", label: "Přeplánovat výrobu…", icon: CalendarClock, intent: "primary", feature: "orders", kind: "dialog" }),
  "production.sendPo": act({ key: "production.sendPo", label: "Odeslat objednávku dodavateli", icon: Send, intent: "primary", feature: "margins", kind: "link", href: tab("vyroba") }),
  "production.undo": act({ key: "production.undo", label: "Vrátit předání do výroby", icon: Undo2, intent: "secondary", feature: "orders", kind: "dialog" }),
  "purchasing.notifySuppliers": act({ key: "purchasing.notifySuppliers", label: "Stornovat u dodavatelů…", icon: Ban, intent: "secondary", feature: "margins", kind: "dialog" }),
  "delivery.record": act({ key: "delivery.record", label: "Zapsat dodání a dodací list", icon: Truck, intent: "primary", feature: "workflow", kind: "dialog" }),
  "delivery.closeShort": act({ key: "delivery.closeShort", label: "Uzavřít s menším množstvím…", icon: PackageCheck, intent: "secondary", feature: "workflow", kind: "dialog" }),
  "delivery.partialNote": act({ key: "delivery.partialNote", label: "Částečná dodávka…", icon: CircleDotDashed, intent: "secondary", feature: "workflow", kind: "dialog" }),
  "delivery.confirmNote": act({ key: "delivery.confirmNote", label: "Potvrdit DL", icon: ClipboardCheck, intent: "primary", feature: "orders", kind: "dialog" }),
  // jediná cesta k faktuře: PDF s QR (řada FV) + evidence faktur + dialog odeslání jako u nabídky
  "payment.invoice": act({ key: "payment.invoice", label: "Vystavit fakturu", icon: ReceiptText, intent: "primary", feature: "margins", kind: "dialog" }),
  // faktura z jiného systému / ručně psaná: číslo, datum, splatnost (řádek v evidenci faktur bez PDF)
  "payment.invoiceExternal": act({ key: "payment.invoiceExternal", label: "Faktura vystavená mimo systém…", icon: FileSignature, intent: "secondary", feature: "margins", kind: "dialog" }),
  "payment.record": act({ key: "payment.record", label: "Zadat platbu", icon: Banknote, intent: "primary", feature: "margins", kind: "dialog" }),
  "payment.settle": act({ key: "payment.settle", label: "Zaplaceno", icon: CircleCheckBig, intent: "secondary", feature: "margins", kind: "dialog" }),
  "job.correct": act({ key: "job.correct", label: "Korekce stavu…", icon: Cog, intent: "secondary", feature: "orders", kind: "dialog" }),
  // ── výjimky v toku (31. 10.): jedno srozumitelné tlačítko pro to, co se stalo ──
  "job.notOrdered": act({ key: "job.notOrdered", label: "Zákazník neobjednal…", icon: CircleSlash, intent: "danger", feature: "margins", needsReason: true, kind: "dialog" }),
  "job.decline": act({ key: "job.decline", label: "Nebudeme nabízet…", icon: CircleX, intent: "danger", feature: "margins", needsReason: true, kind: "dialog" }),
  "job.reopenLost": act({ key: "job.reopenLost", label: "Obnovit poptávku", icon: Undo, intent: "secondary", feature: "margins", kind: "dialog" }),
  "job.pause": act({ key: "job.pause", label: "Pozastavit…", icon: PauseCircle, intent: "secondary", feature: "orders", kind: "dialog" }),
  "job.resume": act({ key: "job.resume", label: "Pokračovat", icon: PlayCircle, intent: "primary", feature: "orders", kind: "dialog" }),
  "production.failed": act({ key: "production.failed", label: "Výroba se nepovedla…", icon: PackageX, intent: "secondary", feature: "orders", kind: "dialog" }),
  "claim.open": act({ key: "claim.open", label: "Reklamace…", icon: AlertTriangle, intent: "secondary", feature: "orders", kind: "dialog" }),
  "claim.resolve": act({ key: "claim.resolve", label: "Vyřešit reklamaci…", icon: AlertTriangle, intent: "primary", feature: "orders", kind: "dialog" }),
  "claim.close": act({ key: "claim.close", label: "Reklamace vyřízena", icon: CircleCheckBig, intent: "primary", feature: "orders", kind: "dialog" }),
  "order.startWithoutPo": act({ key: "order.startWithoutPo", label: "Vyrábět bez objednávky…", icon: Factory, intent: "secondary", feature: "orders", kind: "dialog" }),
  "order.poArrived": act({ key: "order.poArrived", label: "Objednávka zákazníka dorazila…", icon: ShoppingCart, intent: "primary", feature: "workflow", kind: "dialog" }),
  "order.correct": act({ key: "order.correct", label: "Oprava zakázky…", icon: ClipboardPen, intent: "secondary", feature: "orders", kind: "dialog" }),
  "drawing.update": act({ key: "drawing.update", label: "Aktualizace výkresu…", icon: FileDiff, intent: "secondary", feature: "workflow", kind: "dialog" }),
};

/** Výjimky v toku — v menu „⋯" jako první skupina „Co se stalo?". */
export const FLOW_EXCEPTION_KEYS: readonly FlowActionKey[] = [
  "drawing.update", "order.correct", "order.startWithoutPo", "order.poArrived", "production.failed", "claim.open",
  "claim.resolve", "claim.close", "job.pause", "job.resume", "job.reopenLost", "job.notOrdered", "job.decline",
];

export interface ActionCtx {
  can: (x: Feature) => boolean;
  userId: string;
  isSuperAdmin: boolean;
  assigneeId: string | null;
  assigneeName?: string | null;
  /** Obchodník zakázky (#25 — po schválení smí nabídku odeslat i on). */
  ownerId?: string | null;
  /**
   * UI umí dialog „Vrátit k přepracování…“ (#25, 25-C) — do té doby se akce v menu nenabízí,
   * aby v menu nebyla položka bez dialogu. Server (returnQuoteToAuthor) je hotový.
   */
  withReturn?: boolean;
  /** Nabídky přihlášeného musí schválit super admin (profil; 31. 10. per uživatel). Neuvedeno = ano (kromě super admina). */
  quoteNeedsApproval?: boolean;
}

// ── Schvalování nabídek super adminem (#25) ─────────────────
/** = text výjimky DB (R7). */
export const QUOTE_AWAITS_APPROVAL = "Nabídka čeká na schválení — odeslat ji lze až po schválení.";
/** = text výjimky DB (R7 / přijetí). */
export const QUOTE_ACCEPT_BLOCKED = "Nabídka čeká na schválení — přijmout ji lze až po schválení a odeslání.";
export const QUOTE_SEND_NO_RIGHT = "Nabídku zákazníkovi odesílá obchodník, super admin, nebo autor schválené nabídky.";
/** = text výjimky DB (R3, 31. 10.). */
export const QUOTE_ADMIN_ONLY = "Nabídku schvaluje jen super admin nebo kolega s právem schvalovat nabídky — vlastní nabídku nikdo neschvaluje sám.";
export const QUOTE_ARCHIVED_SEND = "Archivovanou verzi nabídky neposíláme — platí novější verze.";
export const QUOTE_PENDING_LABEL = "Neschválená — čeká na schválení super admina";

/** Schvalovatel nabídek, který není super admin (31. 10. — „Smí schvalovat nabídky ostatních"). */
export interface QuoteApprover { id: string; name: string }

/**
 * Kdo nabídku autora schválí (texty „čeká na schválení …"): „V. Volný nebo super admin" — schvalovatelé
 * z dat (bez autora — vlastní nabídku nikdo neschvaluje), super admin vždy. null = jen super admin.
 */
export function quoteApproverWho(approvers: readonly QuoteApprover[] | null | undefined, authorId?: string | null): string | null {
  const names = (approvers ?? []).filter((a) => a.id && a.id !== authorId).map((a) => shortPersonName(a.name || "")).filter(Boolean);
  if (!names.length) return null;
  const all = [...names, "super admin"];
  return `${all.slice(0, -1).join(", ")} nebo ${all[all.length - 1]}`;
}

/** „čeká na schválení (V. Volný nebo super admin)“ / „čeká na schválení super admina“. */
export function quoteAwaitsText(who: string | null | undefined): string {
  return who ? `čeká na schválení (${who})` : "čeká na schválení super admina";
}

/** „Odeslat půjde po schválení (V. Volný nebo super admin).“ / „Odeslat půjde po schválení super adminem.“ */
export function quoteSendAfterText(who: string | null | undefined): string {
  return who ? `Odeslat půjde po schválení (${who}).` : "Odeslat půjde po schválení super adminem.";
}

/** Kdo schválí TUTO nabídku: schvalovatelé jen u nabídky, která schválení potřebuje kvůli autorovi / editorovi
 *  (AI nabídku schvaluje jen super admin). */
export function quoteApproverWhoFor(
  q: { adminApprovalRequired?: boolean | null; createdBy?: string | null } | null | undefined,
  approvers: readonly QuoteApprover[] | null | undefined,
): string | null {
  return q?.adminApprovalRequired ? quoteApproverWho(approvers, q.createdBy ?? null) : null;
}

/** Štítek čekající nabídky: „Neschválená — čeká na schválení (…)“. */
export function quotePendingLabel(who: string | null | undefined): string {
  return who ? `Neschválená — ${quoteAwaitsText(who)}` : QUOTE_PENDING_LABEL;
}

/**
 * Musí nabídky tohoto uživatele před odesláním schválit super admin? (31. 10. per uživatel)
 * Super admin nikdy; ostatní podle profilu „Nabídky musí schválit super admin" (výchozí ano).
 * TS dvojče DB funkce quote_author_needs_admin (20261030200000).
 */
export function userNeedsQuoteApproval(u: { role?: string | null; quoteNeedsApproval?: boolean | null } | null | undefined): boolean {
  if (!u) return true;
  if (u.role === "super_admin") return false;
  return u.quoteNeedsApproval !== false;
}

/** Důvody schválení (#25): AI nabídka v režimu se schválením, nebo ji připravil ne-admin.
 *  `limit` a `requested` (limit částky, žádost) #25 ruší — zůstávají jen kvůli starším volajícím (vždy false). */
export function approvalReasons(q: QuoteFacts, aiApprovalMode = true): { ai: boolean; author: boolean; limit: false; requested: false } {
  const ai = q.aiGenerated && aiApprovalMode && q.approvalRequired;
  return { ai, author: q.adminApprovalRequired === true, limit: false, requested: false };
}

/** Kontext schvalovatele: právo quote_approval + kdo je přihlášený (super admin / schvalovatel). */
export type QuoteApproverCtx = Pick<ActionCtx, "can" | "userId" | "isSuperAdmin">;

/**
 * Smí přihlášený spravovat schválení TÉTO nabídky (Schválit, Schválit a odeslat, Vrátit k úpravě,
 * Vrátit k přepracování)? Super admin vždy (i AI nabídky); kolega se „Smí schvalovat nabídky ostatních"
 * (quote_approval bez super admina) jen cizí nabídku, která schválení potřebuje kvůli autorovi / editorovi
 * (adminApprovalRequired) — vlastní nikdy. TS dvojče DB quote_user_may_approve (20261030200000).
 */
export function mayManageQuoteApproval(
  q: Pick<QuoteFacts, "createdBy" | "adminApprovalRequired">, ctx: QuoteApproverCtx,
): boolean {
  if (!ctx.can("quote_approval")) return false;
  if (ctx.isSuperAdmin) return true;
  return q.adminApprovalRequired === true && Boolean(ctx.userId) && q.createdBy !== ctx.userId;
}

/** Schválit jde neschválenou, nearchivovanou nabídku s cenou — super admin, nebo schvalovatel cizí nabídky
 *  (mayManageQuoteApproval). (Třetí parametr je pozůstatek — důvody už o schvalovateli nerozhodují.) */
export function canApproveQuote(q: QuoteFacts, ctx: QuoteApproverCtx, _reasons?: unknown): boolean {
  return mayManageQuoteApproval(q, ctx) && q.state === "ke_schvaleni" && !q.archived && !quoteUnpriced(q);
}

/** Odešla už nabídka zákazníkovi? Podle stavu (sent_at sám nestačí — u neodeslané ho stav přebíjí);
 *  zamítnutá / archivní verze a volající bez stavu podle sent_at. */
export function quoteWasSent(q: { state?: QuoteState | null; sentAt?: string | null }): boolean {
  if (q.state === "odeslana" || q.state === "pripominky" || q.state === "prijata") return true;
  if (q.state === "rozpracovana" || q.state === "ke_schvaleni" || q.state === "schvalena") return false;
  return Boolean(q.sentAt);
}

/** Část „schválení“: null = obsah smí k zákazníkovi (v jakémkoli stavu). */
export function quoteApprovalBlock(q: {
  adminApprovalRequired?: boolean; approvalRequired?: boolean; approvedBy?: unknown; sentAt?: string | null;
  state?: QuoteState | null;
}): string | null {
  if (q.adminApprovalRequired && !q.approvedBy) return QUOTE_AWAITS_APPROVAL;
  if (q.approvalRequired && !q.approvedBy && !quoteWasSent(q)) return QUOTE_AWAITS_APPROVAL;
  return null;
}

export interface QuoteSendViewer {
  can: (f: Feature) => boolean;
  userId: string;
  jobOwnerId?: string | null;
  jobAssigneeId?: string | null;
  isSuperAdmin?: boolean;
  /** Nabídky odesílatele musí schválit super admin (profil). Neuvedeno = ano (kromě super admina). */
  quoteNeedsApproval?: boolean;
}

/** Smí tento uživatel nabídku odeslat zákazníkovi? null = ano, jinak důvod (stejná pravidla jako DB). */
export function quoteSendBlock(
  q: Pick<QuoteFacts, "state" | "archived" | "createdBy" | "adminApprovalRequired" | "approvalRequired" | "approvedBy" | "sentAt">,
  viewer: QuoteSendViewer,
): string | null {
  const approval = quoteApprovalBlock(q);
  if (approval) return approval;
  if (q.archived && !viewer.isSuperAdmin) return QUOTE_ARCHIVED_SEND;
  if (q.state === "zamitnuta" && !viewer.can("margins")) return QUOTE_SEND_NO_RIGHT;
  if (viewer.can("margins")) return null;
  const me = viewer.userId;
  if (q.adminApprovalRequired && q.approvedBy && me && (me === q.createdBy || me === viewer.jobOwnerId || me === viewer.jobAssigneeId)) {
    return null;
  }
  // 31. 10.: autor bez schvalování (např. zaměstnanec s vypnutým „Nabídky musí schválit super admin")
  // odešle svou nabídku, která schválení nepotřebuje — DB: quotes_flow_before (20261030200000)
  if (!q.adminApprovalRequired && me && me === q.createdBy && !q.archived
      && !userNeedsQuoteApproval({ role: viewer.isSuperAdmin ? "super_admin" : null, quoteNeedsApproval: viewer.quoteNeedsApproval })) {
    return null;
  }
  return QUOTE_SEND_NO_RIGHT;
}

/** UI štítek „Neschválená“: neodeslaná, čeká na super admina, nearchivovaná. */
export function quoteAwaitsApproval(q: { state?: QuoteState | null; archived?: boolean }): boolean {
  return q.state === "ke_schvaleni" && !q.archived;
}

export type QuoteApprovalFlag =
  | { kind: "pending"; quoteId: string; number: string | null; label: string; short: string; title: string }
  | { kind: "returned"; quoteId: string; number: string | null; label: string; short: string; title: string; note: string | null }
  | { kind: "approved"; quoteId: string; number: string | null; label: string };

const CZ_DAY = new Intl.DateTimeFormat("cs-CZ", { timeZone: "Europe/Prague", day: "numeric", month: "numeric", year: "numeric" });

/** „23. 10. 2026“ (pražský den). */
function czDay(at: string | null | undefined): string | null {
  if (!at) return null;
  const d = new Date(/^\d{4}-\d{2}-\d{2}$/.test(at) ? `${at}T12:00:00Z` : at);
  return isNaN(d.getTime()) ? null : CZ_DAY.format(d).replace(/\s+/g, " ");
}

/** „Připravil(a) P. Obchodník · Schválil J. Semorád · 23. 10. 2026“ (autor vynechán, když schválil sám). */
export function approvedStampText(author: string | null, approver: string | null, at: string | null): string {
  const parts: string[] = [];
  const a = author?.trim() || null;
  const b = approver?.trim() || null;
  if (a && a !== b) parts.push(`Připravil(a) ${shortPersonName(a)}`);
  if (b) parts.push(`Schválil ${shortPersonName(b)}`);
  const day = czDay(at);
  if (day) parts.push(day);
  return parts.length ? parts.join(" · ") : "Schválená";
}

/**
 * Štítek schválení pro Knihu / hlavičku zakázky: pending|returned = některá otevřená verze čeká na super admina
 * (čekající má přednost před vrácenou); approved = aktivní nabídka je schválená a čeká na odeslání.
 */
export function quoteApprovalFlag(
  quotes: readonly QuoteFacts[],
  people?: { author: string | null; approver: string | null; at: string | null } | null,
  /** 31. 10.: schvalovatelé (ne super admin) — text „čeká na schválení (V. Volný nebo super admin)“. */
  approvers?: readonly QuoteApprover[] | null,
): QuoteApprovalFlag | null {
  const open = quotes.filter((q) => quoteAwaitsApproval(q));
  const pending = open.find((q) => !q.returnedAt);
  if (pending) {
    const n = pending.number?.trim() || null;
    const who = quoteApproverWhoFor(pending, approvers);
    return {
      kind: "pending", quoteId: pending.id, number: n, label: quotePendingLabel(who), short: "Neschválená",
      title: `${n ? `Nabídka ${n}` : "Nabídka"} ${quoteAwaitsText(who)} — do té doby ji nejde odeslat zákazníkovi.`,
    };
  }
  const returned = open[0];
  if (returned) {
    const n = returned.number?.trim() || null;
    const note = returned.returnNote?.trim() || null;
    const who = quoteApproverWhoFor(returned, approvers);
    return {
      kind: "returned", quoteId: returned.id, number: n, note,
      label: note ? `Vráceno k přepracování: ${note}` : "Vráceno k přepracování", short: "Vráceno",
      title: `${n ? `Nabídka ${n}` : "Nabídka"} je vrácená autorovi k přepracování${note ? ` — ${note}` : ""}. ${quoteSendAfterText(who)}`,
    };
  }
  const active = activeQuote([...quotes]);
  if (active && active.state === "schvalena") {
    return {
      kind: "approved", quoteId: active.id, number: active.number?.trim() || null,
      label: approvedStampText(people?.author ?? null, people?.approver ?? null, people?.at ?? null),
    };
  }
  return null;
}

function proposalFeature(p: FlowProposal): Feature {
  return transitionFeature(p.phase, p.to);
}

type Next = { key: FlowActionKey; label: string } | null;

function allowed(ctx: ActionCtx, key: FlowActionKey, label?: string): Next {
  return ctx.can(FLOW_ACTIONS[key].feature) ? { key, label: label ?? FLOW_ACTIONS[key].label } : null;
}

/** Nabídka bez ceny (total NULL) — odeslat ji jedním ťuknutím nejde, další krok je doplnit cenu. */
export function quoteUnpriced(q: Pick<QuoteFacts, "total" | "state"> | null | undefined): boolean {
  return Boolean(q) && q!.total === null && (q!.state === "rozpracovana" || q!.state === "ke_schvaleni" || q!.state === "schvalena");
}

/** Odesílatel pro quoteSendBlock z kontextu akcí (obchodník / řešitel zakázky). */
export function sendViewerOf(ctx: ActionCtx): QuoteSendViewer {
  return {
    can: ctx.can, userId: ctx.userId, jobOwnerId: ctx.ownerId ?? null, jobAssigneeId: ctx.assigneeId, isSuperAdmin: ctx.isSuperAdmin,
    quoteNeedsApproval: ctx.quoteNeedsApproval,
  };
}

function quoteNext(s: FlowSnapshot, ctx: ActionCtx): Next | undefined {
  const q = s.activeQuote;
  if (!q || !s.quote) return undefined;
  if (quoteUnpriced(q)) return allowed(ctx, "quote.edit", "Doplnit cenu");
  if (s.quote === "ke_schvaleni") {
    // #25: schvaluje jen super admin; vrácenou nabídku autor upraví podle připomínek
    // (vrácenou super admin primárně neschvaluje — čeká se na autora; „Schválit“ zůstává v menu)
    if (q.returnedAt && q.createdBy && q.createdBy === ctx.userId) return allowed(ctx, "quote.edit", "Upravit podle připomínek");
    if (q.returnedAt) return null;
    if (canApproveQuote(q, ctx)) return allowed(ctx, "quote.approve");
    return null;
  }
  if (s.quote === "schvalena" || s.quote === "rozpracovana") {
    // rozpracovaná = schválení není nutné (nabídka super admina); schválenou odešle obchodník nebo autor
    return quoteSendBlock(q, sendViewerOf(ctx)) === null ? allowed(ctx, "quote.send") : null;
  }
  return undefined;
}

/**
 * Ve výrobě (po přednosti dodání): chybí kdo / termín → „Doplnit kdo a termín…"; neodeslaná objednávka
 * kroku (obchodník/admin) → „Odeslat objednávku dodavateli"; ohrožený / změněný konečný termín →
 * „Přeplánovat výrobu…"; jinak „Posunout dál…" (nic neběží → „Předat do kroku…").
 */
function productionNext(f: FlowFacts, ctx: ActionCtx): Next {
  const h = productionHealth(f);
  if (h.unplanned) return allowed(ctx, "production.handoff", "Doplnit kdo a termín…");
  if ((f.productionPoStatus === "navrh" || f.productionPoStatus === "vystavena") && ctx.can("margins")) return allowed(ctx, "production.sendPo");
  if (h.late !== null || h.finalChanged) return allowed(ctx, "production.replan");
  return allowed(ctx, "production.advance", f.productionRunning === false ? "Předat do kroku…" : "Posunout dál…");
}

/** Primární tlačítko (sloveso dalšího kroku) — tabulka 1.12. */
export function nextAction(f: FlowFacts, s: FlowSnapshot, ctx: ActionCtx): Next {
  if (f.proposal && ctx.can(proposalFeature(f.proposal))) return { key: "proposal.decide", label: FLOW_ACTIONS["proposal.decide"].label };
  const rank = flowRank(f.stage);
  // reklamace: nejdřív rozhodnout (opravit / dobropis / zamítnout); oprava → předání do výroby
  if (f.stage === "reklamace") {
    return f.claimResolution === "oprava" ? allowed(ctx, "production.handoff", "Vyrobit znovu…") : allowed(ctx, "claim.resolve");
  }
  // opravené díly jsou zase u zákazníka → reklamaci uzavřít (zakázka se vrátí, kde byla)
  if (claimOpen(f) && f.claimResolution === "oprava" && rank >= 9) return allowed(ctx, "claim.close");
  // objednávka zákazníka dorazila k zakázce, která se už vyrábí → potvrdit ji s jejím číslem
  if (rank >= 4 && rank <= 8 && poArrivedUnconfirmed(f, s)) return allowed(ctx, "order.sendConfirmation", "Potvrdit objednávku");
  if (f.stage === "poptavka" || f.stage === "naceneni") {
    if (s.inquiry === "prijata") {
      const other = ctx.assigneeId && ctx.assigneeId !== ctx.userId;
      return allowed(ctx, "inquiry.take", other && ctx.assigneeName ? `Převzít od ${ctx.assigneeName}` : "Převzít");
    }
    if (s.inquiry === "ceka_na_podklady") return allowed(ctx, "inquiry.resume");
    const qn = quoteNext(s, ctx);
    if (qn !== undefined) return qn;
    if (s.pricing === "naceneno") return allowed(ctx, "quote.create");
    // #25: Nacenění jen super admin — ostatní rovnou „Vytvořit nabídku“ (ručně)
    if (s.pricing === "ceka_na_dodavatele") {
      return allowed(ctx, "pricing.supplierPrice") ?? allowed(ctx, "pricing.open") ?? allowed(ctx, "quote.create");
    }
    return allowed(ctx, "pricing.open") ?? allowed(ctx, "quote.create");
  }
  if (f.stage === "nabidka") {
    if (s.quote === "pripominky") return allowed(ctx, "quote.newRevision");
    if (s.quote === "vyprsela") return allowed(ctx, "quote.extend");
    if (s.quote === "odeslana") return allowed(ctx, "quote.accept");
    return quoteNext(s, ctx) ?? null;
  }
  if (rank >= 3 && rank <= 8) {
    if (s.order === "aktualizovana") return allowed(ctx, "order.decideChange");
    if (s.order === "rozpor") return allowed(ctx, "order.resolveMismatch");
    // vyrábí se bez objednávky zákazníka: potvrzovat zatím není co — rovnou předat do výroby
    if (s.order === "dorucena" && f.awaitingCustomerPo) return f.stage === "objednavka" ? allowed(ctx, "production.handoff") : null;
    if (s.order === "dorucena") return allowed(ctx, "order.confirm");
    // ve výrobě má přednost dodání (= chip řádku); chybějící potvrzení je pak jen v menu
    if (rank >= 5) {
      if (s.delivery === "castecne") return allowed(ctx, "delivery.record", "Dodat zbytek");
      if (s.delivery === "k_expedici") return allowed(ctx, "delivery.record", "Zapsat dodání a dodací list");
      if (f.stage === "ve_vyrobe") return productionNext(f, ctx);
      return null;
    }
    if (s.confirmation === "bez_dokladu" && !f.awaitingCustomerPo) return allowed(ctx, "order.sendConfirmation");
    // potvrzená objednávka → předání do výroby (komu a do kdy), i s připraveným postupem / objednávkou
    if (f.stage === "potvrzeno") return allowed(ctx, "production.handoff");
    return null;
  }
  if ((f.stage === "zruseno" || f.stage === "nerealizovano") && (f.openPurchaseOrders ?? 0) > 0) {
    return allowed(ctx, "purchasing.notifySuppliers", "Stornovat u dodavatelů…");
  }
  if (f.stage === "dodano_zakaznikovi") {
    // faktura hned po dodání / vystavení DL — potvrzený DL není podmínka (volitelný krok v ⋯ a v kartě);
    // bez práva na faktury (zaměstnanec) zůstává hlavním krokem „Potvrdit DL"
    if (s.delivery === "castecne") return allowed(ctx, "delivery.record", "Dodat zbytek");
    const worker = s.delivery === "dodano" ? allowed(ctx, "delivery.confirmNote") : null;
    // faktura už je (mimo systém při dílčí dodávce, starší data) → další je platba, ne druhá faktura
    if ((f.invoiceNumber ?? "").trim()) return allowed(ctx, "payment.record") ?? worker;
    if (canIssueInvoice(f)) return allowed(ctx, "payment.invoice") ?? worker;
    return worker;
  }
  if (f.stage === "fakturovano") return allowed(ctx, "payment.record");
  // pozastavená zakázka: „Pokračovat" vrátí zakázku tam, kde se zastavila (bez známého stavu → Korekce stavu)
  if (f.stage === "pozastaveno") return f.sideFromStage ? allowed(ctx, "job.resume") : allowed(ctx, "job.correct", "Pokračovat…");
  return null;
}

// ── Výjimky v toku (31. 10.) ────────────────────────────────
/** Po kolika dnech bez objednávky zákazníka ukázat „Chybí objednávka zákazníka". */
export const AWAITING_PO_REMIND_DAYS = 7;

/** Reklamace je zapsaná a nevyřízená. */
export function claimOpen(f: Pick<FlowFacts, "claimOpenedAt" | "claimResolvedAt">): boolean {
  return Boolean(f.claimOpenedAt) && !f.claimResolvedAt;
}

/** Objednávka zákazníka dorazila dodatečně (zakázka se vyráběla bez ní) a potvrzení s jejím číslem zatím neodešlo. */
export function poArrivedUnconfirmed(f: FlowFacts, s: Pick<FlowSnapshot, "confirmation">): boolean {
  return Boolean(f.customerPoReceivedAt) && !f.awaitingCustomerPo
    && (s.confirmation === "bez_dokladu" || s.confirmation === "k_vystaveni" || s.confirmation === "vystaveno");
}

/** Kolik dní se vyrábí bez objednávky zákazníka (null = nečeká). */
export function awaitingPoDays(f: Pick<FlowFacts, "awaitingCustomerPo" | "awaitingPoSince">, today: string = pragueToday()): number | null {
  if (!f.awaitingCustomerPo) return null;
  const since = pragueDay(f.awaitingPoSince ?? null);
  return since ? Math.max(0, dayDiff(since, today)) : 0;
}

/** Zboží je celé u zákazníka (stav dodání a dál, nebo dodané všechny položky). */
function deliveredToCustomer(f: FlowFacts): boolean {
  const rank = flowRank(f.stage);
  return (rank >= 9 && rank <= 11) || (rank >= 3 && rank <= 8 && deliveredAll(f));
}

/** Kam „Pokračovat" / „Obnovit" vrátí zakázku z vedlejšího stavu (null = nevíme → Korekce stavu). */
export function resumeTarget(f: Pick<FlowFacts, "stage" | "sideFromStage">): JobStage | null {
  const t = f.sideFromStage ?? null;
  if (!t || t === f.stage || flowRank(t) < 0) return null;
  return t;
}

/** Kam „Obnovit poptávku" vrátí nerealizovanou zakázku: stav před prohrou (max. Nabídka), jinak Poptávka. */
export function reopenLostTarget(f: Pick<FlowFacts, "stage" | "sideFromStage">): JobStage {
  const t = f.sideFromStage ?? null;
  const r = t ? flowRank(t) : -1;
  return t && r >= 0 && r <= 2 ? t : "poptavka";
}

/**
 * Výjimky v toku pro menu „⋯" (skupina „Co se stalo?"), Knihu (menu stavu) a stránky toku — v pořadí
 * FLOW_EXCEPTION_KEYS, jen ty, na které má uživatel právo.
 */
export function exceptionActions(f: FlowFacts, ctx: Pick<ActionCtx, "can">): FlowActionKey[] {
  const rank = flowRank(f.stage);
  const keys = new Set<FlowActionKey>();
  const closed = f.stage === "nerealizovano" || f.stage === "zruseno";
  if (!closed) keys.add("drawing.update");
  const hasOrder = rank >= 3 || ((f.stage === "pozastaveno" || f.stage === "reklamace") && Boolean(f.orderStatus));
  if (hasOrder && !closed && f.orderStatus !== "stornovana") keys.add("order.correct");
  if (rank >= 0 && rank <= 2) keys.add("order.startWithoutPo");
  if (f.awaitingCustomerPo && !closed) keys.add("order.poArrived");
  if (rank >= 5 && rank <= 8) keys.add("production.failed");
  if (f.stage !== "reklamace" && !claimOpen(f) && deliveredToCustomer(f)) keys.add("claim.open");
  if (f.stage === "reklamace") keys.add("claim.resolve");
  if (claimOpen(f) && f.claimResolution === "oprava" && f.stage !== "reklamace") keys.add("claim.close");
  if (rank >= 0 && rank <= 10) keys.add("job.pause");
  if (f.stage === "pozastaveno" && resumeTarget(f)) keys.add("job.resume");
  const preOrder = (rank >= 0 && rank <= 2) || (f.stage === "pozastaveno" && f.sideFromStage != null && flowRank(f.sideFromStage) >= 0 && flowRank(f.sideFromStage) <= 2);
  if (preOrder) {
    keys.add("job.notOrdered");
    if (rank <= 1) keys.add("job.decline");
  }
  if (f.stage === "nerealizovano") keys.add("job.reopenLost");
  return FLOW_EXCEPTION_KEYS.filter((k) => keys.has(k) && ctx.can(FLOW_ACTIONS[k].feature));
}

/** Menu „⋯“: povolené ruční přechody; bez práva „Navrhnout…“; destruktivní dole; na konci „Korekce stavu…“. */
export function menuActions(f: FlowFacts, s: FlowSnapshot, ctx: ActionCtx): FlowActionKey[] {
  const keys: FlowActionKey[] = [];
  const add = (k: FlowActionKey) => { if (!keys.includes(k)) keys.push(k); };
  const rank = flowRank(f.stage);
  const margins = ctx.can("margins");

  // poptávka
  const inq = s.inquiry;
  if (inq && inq !== "zpracovana") {
    const to = INQUIRY_TRANSITIONS[inq];
    if (to.includes("v_reseni")) add(inq === "ceka_na_podklady" ? "inquiry.resume" : inq === "prijata" ? "inquiry.take" : "inquiry.reopen");
    if (to.includes("ceka_na_podklady")) add("inquiry.wait");
    if (to.includes("odmitnuta") || to.includes("stazena")) {
      if (margins) { add("inquiry.decline"); add("inquiry.withdraw"); } else add("inquiry.propose");
    }
  }

  // nabídka
  const q = s.activeQuote;
  if (q && s.quote) {
    const st = q.state;
    if (st === "rozpracovana" || st === "ke_schvaleni" || st === "schvalena") add("quote.edit");
    // #25: neschválenou schválí super admin, 31. 10. i schvalovatel cizí nabídky („Předat ke schválení“ už není
    // potřeba — děje se samo); „Schválit a odeslat“ jen ten, kdo smí i odesílat (marže)
    if (st === "ke_schvaleni" && canApproveQuote(q, ctx)) { add("quote.approve"); if (ctx.can("margins")) add("quote.approveSend"); }
    if (st === "ke_schvaleni" && ctx.withReturn && mayManageQuoteApproval(q, ctx) && !q.returnedAt && !q.archived) add("quote.returnToAuthor");
    if ((st === "schvalena" || st === "rozpracovana") && !quoteUnpriced(q) && quoteSendBlock(q, sendViewerOf(ctx)) === null) {
      add("quote.send"); add("quote.markSent");
    }
    if (st === "schvalena" && mayManageQuoteApproval(q, ctx)) add("quote.unapprove");
    if (st === "odeslana" || st === "pripominky") {
      add("quote.accept");
      if (st === "odeslana") add("quote.feedback");
      if (st === "pripominky") add("quote.answerNoChange");
      add("quote.newRevision");
      if (s.quote === "vyprsela") add("quote.extend");
      if (margins) add("quote.reject"); else add("quote.propose");
    }
    if (st === "zamitnuta") add("quote.reopen");
  } else if (f.stage === "poptavka" || f.stage === "naceneni") {
    add("quote.create");
  }

  // objednávka
  const ord = s.order;
  // vyrábí se bez objednávky zákazníka: potvrzení až s jejím číslem („Objednávka zákazníka dorazila…")
  const awaitingPo = f.awaitingCustomerPo === true;
  if (ord && f.stage !== "nerealizovano") {
    if (ord === "dorucena" && !awaitingPo) { add("order.confirm"); add("order.confirmOther"); add("order.flagMismatch"); }
    if (ord === "rozpor") { add("order.resolveMismatch"); add("order.requestFix"); add("order.confirmOther"); }
    if (ord === "potvrzena") add("order.registerChange");
    if (ord === "aktualizovana") { add("order.decideChange"); add("order.rejectChange"); }
    if (!awaitingPo && (s.confirmation === "bez_dokladu" || s.confirmation === "k_vystaveni" || s.confirmation === "vystaveno")) add("order.sendConfirmation");
    if (ord === "stornovana") add("order.reopen");
    else if (margins) add("order.cancel");
    else add("order.propose");
  }

  // výroba, dodání, platba
  // výroba: předání (kdo + termín), plán dopředu; ve výrobě posun / ukončení / přeplánování / vrácení
  if (rank === 3 || rank === 4 || f.stage === "pozastaveno" || f.stage === "reklamace") { add("production.handoff"); add("production.plan"); }
  if (f.stage === "ve_vyrobe") {
    const h = productionHealth(f);
    if (h.unplanned) add("production.handoff");
    else add("production.advance");
    if ((f.productionTotal ?? 0) > 0) add("production.finish");
    add("production.replan");
    add("production.undo");
  }
  if ((f.stage === "zruseno" || f.stage === "nerealizovano" || f.stage === "pozastaveno") && (f.openPurchaseOrders ?? 0) > 0) add("purchasing.notifySuppliers");
  if (rank >= 5 && rank <= 9 && s.delivery !== "dl_potvrzen" && s.delivery !== "dodano") {
    if (f.itemsCount > 0) { add("delivery.record"); if (s.delivery === "castecne") add("delivery.closeShort"); }
    else add("delivery.partialNote");
  }
  if (s.delivery === "dodano") add("delivery.confirmNote");
  // faktura po dodání všeho (i bez potvrzeného DL) — tentýž dialog jako hlavní tlačítko; jen jednou
  // (vystavenou fakturu Doklady ▾ otevřou / pošlou znovu), dílčí faktura na část dodávky zatím není
  if (canIssueInvoice(f)) add("payment.invoice");
  // faktura vystavená jinde (účetní program, ručně) — číslo, datum, splatnost do evidence; jen po dodání
  if (rank >= 5 && rank <= 10 && !(f.invoiceNumber ?? "").trim() && invoiceDeliveryOf(f) !== "none") add("payment.invoiceExternal");
  if (s.payment && s.payment !== "zaplaceno") { add("payment.record"); add("payment.settle"); }
  // záloha / dílčí platba ještě před fakturou (od potvrzené objednávky po dodání) — tentýž dialog
  if (!s.payment && rank >= 4 && rank <= 9) add("payment.record");

  const allowedKeys = keys.filter((k) => ctx.can(FLOW_ACTIONS[k].feature));
  const safe = allowedKeys.filter((k) => FLOW_ACTIONS[k].intent !== "danger");
  const danger = allowedKeys.filter((k) => FLOW_ACTIONS[k].intent === "danger");
  // výjimky v toku („Co se stalo?") — menu je ukáže jako první skupinu
  const out = [...safe, ...danger, ...exceptionActions(f, ctx).filter((k) => !allowedKeys.includes(k))];
  if (ctx.can("orders")) out.push("job.correct");
  return out;
}

// ── Mapování řádků DB → fakta (sdílí datová vrstva i test parity) ──
/** Sloupce výjimek v toku (migrace 20261031150000) — Kniha, karta, akce. */
export const FLOW_EXCEPTION_COLUMNS_LIST = [
  "side_from_stage", "hold_reason", "awaiting_customer_po", "awaiting_po_since", "awaiting_po_note", "customer_po_received_at",
  "customer_order_number", "claim_opened_at", "claim_reason", "claim_qty", "claim_item_id", "claim_note", "claim_from_stage",
  "claim_resolution", "claim_resolution_note", "claim_resolved_at", "corrected_at", "corrected_note", "drawing_changes_open",
];
export const FLOW_EXCEPTION_COLUMNS = FLOW_EXCEPTION_COLUMNS_LIST.join(", ");

/** Sloupce orders potřebné pro deriveFlow / primaryChip / nextAction. */
export const FLOW_ORDER_COLUMNS = [
  "id", "status", "inquiry_status", "order_status", "order_revision", "order_confirmed_revision",
  "confirmation_issued_revision", "confirmation_sent_revision", "items_count", "items_priced", "items_delivered",
  "items_partial", "last_delivery_at", "partial_delivery_at", "production_done", "production_total",
  "delivery_note_confirmed_at", "invoice_number", "invoice_due_date", "paid_at", "paid_so_far", "waiting_since",
  "waiting_note", "order_status_changed_at", "lost_reason", "lost_note", "flow_proposal", "order_mismatch",
  "assignee_id", "value",
  // předání do výroby: aktuální krok, konec výroby, konečný termín (zákazník), objednávky u dodavatelů
  "production_step", "production_location", "production_step_no", "production_due", "production_due_state",
  "production_po_status", "production_end", "production_final_end", "due_date", "customer_required_date",
  ...FLOW_EXCEPTION_COLUMNS_LIST,
  "pos:purchase_orders!job_id(status)",
].join(", ");

/** Sloupce quotes pro QuoteFacts. */
export const FLOW_QUOTE_COLUMNS =
  "id, job_id, number, revision, status, state, approved_by, approval_required, approval_requested_at, created_by, "
  + "archived, sent_at, valid_until, ai_generated, superseded_by, created_at, total, "
  + "admin_approval_required, approval_returned_at, approval_return_note, updated_at, owner_id";

function num(v: unknown): number {
  const n = typeof v === "number" ? v : typeof v === "string" ? Number(v) : NaN;
  return Number.isFinite(n) ? n : 0;
}
function numOrNull(v: unknown): number | null {
  if (v === null || v === undefined || v === "") return null;
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : null;
}
function textOrNull(v: unknown): string | null {
  return typeof v === "string" ? v : null;
}

export function flowFactsFromRow(
  r: Record<string, unknown>,
  extra: { pendingSupplierQuotes?: number; hasOperations?: boolean; hasPurchaseOrders?: boolean; assigneeName?: string | null } = {},
): FlowFacts {
  return {
    stage: r.status as JobStage,
    inquiryStatus: isInquiryStatus(r.inquiry_status) ? r.inquiry_status : null,
    orderStatus: isOrderDocStatus(r.order_status) ? r.order_status : null,
    orderRevision: num(r.order_revision),
    orderConfirmedRevision: numOrNull(r.order_confirmed_revision),
    confirmationIssuedRevision: numOrNull(r.confirmation_issued_revision),
    confirmationSentRevision: numOrNull(r.confirmation_sent_revision),
    itemsCount: num(r.items_count),
    itemsPriced: num(r.items_priced),
    itemsDelivered: num(r.items_delivered),
    itemsPartial: num(r.items_partial),
    lastDeliveryAt: textOrNull(r.last_delivery_at),
    partialDeliveryAt: textOrNull(r.partial_delivery_at),
    productionDone: num(r.production_done),
    productionTotal: num(r.production_total),
    deliveryNoteConfirmedAt: textOrNull(r.delivery_note_confirmed_at),
    invoiceNumber: textOrNull(r.invoice_number),
    invoiceDueDate: textOrNull(r.invoice_due_date),
    paidAt: textOrNull(r.paid_at),
    paidSoFar: num(r.paid_so_far),
    waitingSince: textOrNull(r.waiting_since),
    orderStatusChangedAt: textOrNull(r.order_status_changed_at),
    pendingSupplierQuotes: extra.pendingSupplierQuotes ?? 0,
    lostReason: isLostReason(r.lost_reason) ? r.lost_reason : null,
    proposal: (r.flow_proposal as FlowProposal | null) ?? null,
    hasOperations: extra.hasOperations ?? false,
    hasPurchaseOrders: extra.hasPurchaseOrders ?? false,
    orderMismatch: (r.order_mismatch as OrderMismatch | null) ?? null,
    waitingNote: textOrNull(r.waiting_note),
    lostNote: textOrNull(r.lost_note),
    assigneeId: textOrNull(r.assignee_id),
    assigneeName: extra.assigneeName ?? null,
    value: numOrNull(r.value),
    ...productionFactsOf(r),
    ...exceptionFactsOf(r),
  };
}

const STAGE_KEYS: readonly string[] = [
  "poptavka", "naceneni", "nabidka", "objednavka", "potvrzeno", "ve_vyrobe", "dodano_k_nam", "na_sklade", "montaz",
  "dodano_zakaznikovi", "fakturovano", "dokonceno", "pozastaveno", "reklamace", "nerealizovano", "zruseno",
];
function stageOrNull(v: unknown): JobStage | null {
  return typeof v === "string" && STAGE_KEYS.includes(v) ? (v as JobStage) : null;
}

/** Fakta výjimek v toku (jen sloupce, které řádek má — starší výběry je nemusí číst). */
function exceptionFactsOf(r: Record<string, unknown>): Partial<FlowFacts> {
  const out: Partial<FlowFacts> = {};
  if ("side_from_stage" in r) out.sideFromStage = stageOrNull(r.side_from_stage);
  if ("hold_reason" in r) out.holdReason = textOrNull(r.hold_reason);
  if ("awaiting_customer_po" in r) out.awaitingCustomerPo = r.awaiting_customer_po === true;
  if ("awaiting_po_since" in r) out.awaitingPoSince = textOrNull(r.awaiting_po_since);
  if ("awaiting_po_note" in r) out.awaitingPoNote = textOrNull(r.awaiting_po_note);
  if ("customer_po_received_at" in r) out.customerPoReceivedAt = textOrNull(r.customer_po_received_at);
  if ("customer_order_number" in r) out.customerOrderNumber = textOrNull(r.customer_order_number);
  if ("claim_opened_at" in r) {
    out.claimOpenedAt = textOrNull(r.claim_opened_at);
    out.claimReason = textOrNull(r.claim_reason);
    out.claimQty = numOrNull(r.claim_qty);
    out.claimItemId = textOrNull(r.claim_item_id);
    out.claimNote = textOrNull(r.claim_note);
    out.claimFromStage = stageOrNull(r.claim_from_stage);
    out.claimResolution = textOrNull(r.claim_resolution);
    out.claimResolutionNote = textOrNull(r.claim_resolution_note);
    out.claimResolvedAt = textOrNull(r.claim_resolved_at);
  }
  if ("corrected_at" in r) {
    out.correctedAt = textOrNull(r.corrected_at);
    out.correctedNote = textOrNull(r.corrected_note);
  }
  if ("drawing_changes_open" in r) out.drawingChangesOpen = Math.max(0, Math.round(num(r.drawing_changes_open)));
  return out;
}

const PO_STATUS_KEYS: PurchaseOrderStatus[] = ["navrh", "vystavena", "odeslana", "potvrzena", "dodana", "zrusena"];

/** Fakta aktuálního kroku výroby z řádku orders (sloupce production_*; embed pos = stavy objednávek). */
function productionFactsOf(r: Record<string, unknown>): Partial<FlowFacts> {
  const out: Partial<FlowFacts> = {};
  if ("production_step" in r) out.productionStep = textOrNull(r.production_step);
  if ("production_location" in r) out.productionLocation = textOrNull(r.production_location);
  if ("production_step_no" in r) out.productionStepNo = numOrNull(r.production_step_no);
  if ("production_due" in r) out.productionDue = textOrNull(r.production_due);
  if ("production_due_state" in r) out.productionDueState = textOrNull(r.production_due_state);
  if ("production_po_status" in r) {
    const p = r.production_po_status;
    out.productionPoStatus = typeof p === "string" && (PO_STATUS_KEYS as string[]).includes(p) ? (p as PurchaseOrderStatus) : null;
  }
  if ("production_end" in r) out.productionEnd = textOrNull(r.production_end);
  if ("production_final_end" in r) out.productionFinalEnd = textOrNull(r.production_final_end);
  if ("due_date" in r) out.dueDate = textOrNull(r.due_date);
  if ("customer_required_date" in r) out.customerRequiredDate = textOrNull(r.customer_required_date);
  if (Array.isArray(r.pos)) {
    const st = (r.pos as { status?: unknown }[]).map((p) => p?.status);
    out.openPurchaseOrders = st.filter((s) => s === "vystavena" || s === "odeslana" || s === "potvrzena").length;
    out.deliveredPurchaseOrders = st.filter((s) => s === "dodana").length;
  }
  return out;
}

export function quoteFactsFromRow(r: Record<string, unknown>): QuoteFacts {
  return {
    id: String(r.id),
    number: textOrNull(r.number),
    revision: num(r.revision) || 1,
    status: r.status as QuoteStatus,
    state: isQuoteState(r.state) ? r.state : "rozpracovana",
    approvedBy: textOrNull(r.approved_by),
    approvalRequired: r.approval_required === true,
    createdBy: textOrNull(r.created_by),
    archived: r.archived === true,
    sentAt: textOrNull(r.sent_at),
    validUntil: textOrNull(r.valid_until),
    aiGenerated: r.ai_generated === true,
    supersededBy: textOrNull(r.superseded_by),
    createdAt: textOrNull(r.created_at),
    approvalRequestedAt: textOrNull(r.approval_requested_at),
    total: numOrNull(r.total),
    adminApprovalRequired: r.admin_approval_required === true,
    returnedAt: textOrNull(r.approval_returned_at),
    returnNote: textOrNull(r.approval_return_note),
    updatedAt: textOrNull(r.updated_at),
    ownerId: textOrNull(r.owner_id),
  };
}

/** Řádek job_flow_v → klíče snímku (pro porovnání s deriveFlow). */
export function snapshotKeysFromView(v: Record<string, unknown>): Omit<FlowSnapshot, "activeQuote" | "orderedWithoutQuote"> {
  return {
    inquiry: isInquiryStatus(v.inquiry_key) ? v.inquiry_key : null,
    pricing: (v.pricing_key as PricingState | null) ?? null,
    quote: (v.quote_key as QuoteDisplayState | null) ?? null,
    order: isOrderDocStatus(v.order_key) ? v.order_key : null,
    fulfilment: (v.fulfilment_key as FulfilmentState | null) ?? null,
    confirmation: (v.confirmation_key as ConfirmationState | null) ?? null,
    delivery: (v.delivery_key as DeliveryState | null) ?? null,
    payment: (v.payment_key as PaymentState | null) ?? null,
    waitingDays: numOrNull(v.waiting_days),
  };
}
