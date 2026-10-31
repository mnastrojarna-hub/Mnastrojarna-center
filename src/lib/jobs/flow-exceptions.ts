import {
  AlertTriangle, CircleSlash, ClipboardPen, Factory, FileDiff, PauseCircle, ShoppingCart, type LucideIcon,
} from "lucide-react";
import type { ClaimReason, ClaimResolution, JobStage } from "@/lib/supabase/database.types";
import {
  AWAITING_PO_REMIND_DAYS, awaitingPoDays, claimOpen, czPlural, lostReasonLabel, pragueDay, pragueToday,
  type FlowFacts, type PaletteKey,
} from "@/lib/jobs/flow-status";

/**
 * Výjimky v toku zakázky (majitel 31. 10.) — čistá logika sdílená serverem i klientem: důvody
 * (reklamace, pauza, zmetek), štítky řádku Knihy / hlavičky („Bez objednávky", „Reklamace",
 * „Nová revize výkresu", „Opraveno …"), filtr Knihy „Výjimky" a rozdíl opravy zakázky.
 */

// ── Důvody ─────────────────────────────────────────────────
export const CLAIM_REASONS: Record<ClaimReason, string> = {
  rozmery: "Rozměry / tolerance",
  material: "Vada materiálu",
  povrch: "Povrch / úprava",
  mnozstvi: "Chybné množství",
  poskozeni: "Poškození při dopravě",
  jine: "Jiné",
};
export const CLAIM_REASON_ORDER: ClaimReason[] = ["rozmery", "material", "povrch", "mnozstvi", "poskozeni", "jine"];

export function isClaimReason(v: unknown): v is ClaimReason {
  return typeof v === "string" && v in CLAIM_REASONS;
}

export const CLAIM_RESOLUTIONS: Record<ClaimResolution, { label: string; hint: string }> = {
  oprava: { label: "Opravit / vyrobit znovu", hint: "Díly se opraví nebo vyrobí znovu — zakázka jde do výroby, pak se znovu dodá." },
  dobropis: { label: "Uznáno — dobropis", hint: "Reklamaci uznáváme a řešíme dobropisem (zapíše se jen poznámka)." },
  zamitnuto: { label: "Zamítnuto", hint: "Reklamaci neuznáváme — důvod uvidíš v historii." },
};

export function isClaimResolution(v: unknown): v is ClaimResolution {
  return typeof v === "string" && v in CLAIM_RESOLUTIONS;
}

/** Proč zakázka stojí — rychlé volby (jde dopsat). */
export const HOLD_REASONS = ["Čeká na zákazníka", "Čeká na materiál", "Čeká na dodavatele", "Kapacita", "Změna výkresu"] as const;

/** Výroba se nepovedla — rychlé volby. */
export const FAILURE_REASONS = ["Chyba výroby", "Rozměry mimo toleranci", "Vada materiálu", "Poškození", "Jiné"] as const;

/** Co dál po zmetku. */
export type FailureNext = "remake" | "short" | "cancel";
export const FAILURE_NEXT: Record<FailureNext, { label: string; hint: string }> = {
  remake: { label: "Vyrobit znovu", hint: "Zpět do výroby — nový krok, historie zůstává (případně nová objednávka dodavateli)." },
  short: { label: "Dodat jen dobré kusy", hint: "Zmetky se nevyrábí znovu — při dodání položku uzavřeš s menším množstvím." },
  cancel: { label: "Zrušit zakázku", hint: "Zakázka se uzavře jako zrušená s důvodem „Výroba se nepovedla“." },
};

/** „Vyrábět bez objednávky" — jak zákazník dal pokyn. */
export const START_WITHOUT_PO_NOTES = ["Zákazník napsal „vyrábějte“ e-mailem", "Telefonicky", "Osobně", "Objednávka dorazí později"] as const;

/** Oprava zakázky — co se změnilo (rychlé volby důvodu). */
export const CORRECTION_NOTES = ["Zákazník změnil množství", "Nový termín", "Změna ceny", "Položka navíc / ubyla", "Jiná dodací adresa"] as const;

// ── Štítky (řádek Knihy, hlavička) ──────────────────────────
export type ExceptionFlagKey = "bez_po" | "chybi_po" | "po_dorazila" | "reklamace" | "pozastaveno" | "vykres" | "opraveno" | "duvod";

export interface ExceptionFlag {
  key: ExceptionFlagKey;
  label: string;
  /** Krátký text (úzký sloupec). */
  short: string;
  title: string;
  icon: LucideIcon;
  palette: PaletteKey;
}

function czDay(at: string | null | undefined): string | null {
  const d = pragueDay(at ?? null);
  if (!d) return null;
  const [, m, day] = d.split("-").map(Number);
  return `${day}. ${m}.`;
}

/**
 * Štítky výjimek zakázky (v pořadí důležitosti): nová revize výkresu, reklamace, chybí / bez objednávky
 * zákazníka, objednávka dorazila (potvrdit), pozastaveno, opraveno. Zrušené / nerealizované = důvod.
 */
export function exceptionFlags(f: FlowFacts, today: string = pragueToday()): ExceptionFlag[] {
  const out: ExceptionFlag[] = [];
  const drawings = f.drawingChangesOpen ?? 0;
  if (drawings > 0) {
    out.push({
      key: "vykres", label: drawings > 1 ? `Nová revize výkresu (${drawings})` : "Nová revize výkresu", short: "Nová revize",
      title: "Přišla nová revize výkresu — otevři zakázku a potvrď „Beru na vědomí“ (nabídka, dodavatelé, výroba).",
      icon: FileDiff, palette: "rose.problem",
    });
  }
  if (claimOpen(f) || f.stage === "reklamace") {
    const reason = f.claimReason && isClaimReason(f.claimReason) ? CLAIM_REASONS[f.claimReason] : null;
    const qty = f.claimQty ? `${f.claimQty} ks` : null;
    const how = f.claimResolution && isClaimResolution(f.claimResolution) ? CLAIM_RESOLUTIONS[f.claimResolution].label : null;
    out.push({
      key: "reklamace", label: ["Reklamace", reason, qty].filter(Boolean).join(" · "), short: "Reklamace",
      title: [`Zákazník reklamuje${reason ? ` — ${reason}` : ""}${qty ? ` (${qty})` : ""}.`, f.claimNote, how ? `Řešení: ${how}.` : null].filter(Boolean).join(" "),
      icon: AlertTriangle, palette: "rose.problem",
    });
  }
  const days = awaitingPoDays(f, today);
  if (days !== null) {
    const late = days >= AWAITING_PO_REMIND_DAYS;
    out.push({
      key: late ? "chybi_po" : "bez_po",
      label: late ? `Chybí objednávka zákazníka (${days} ${czPlural(days, "den", "dny", "dní")})` : "Bez objednávky — čeká na objednávku zákazníka",
      short: late ? "Chybí objednávka" : "Bez objednávky",
      title: `Vyrábí se bez objednávky zákazníka${f.awaitingPoNote ? ` (${f.awaitingPoNote})` : ""}. Jakmile objednávka dorazí, spáruje se a potvrdíš ji s jejím číslem.`,
      icon: ShoppingCart, palette: late ? "rose.problem" : "amber.wait",
    });
  } else if (f.customerPoReceivedAt && !f.awaitingCustomerPo && (f.confirmationSentRevision ?? 0) < Math.max(1, f.orderConfirmedRevision ?? f.orderRevision ?? 1)
             && f.orderStatus !== "stornovana" && f.stage !== "nerealizovano" && f.stage !== "zruseno") {
    out.push({
      key: "po_dorazila", label: `Objednávka dorazila${f.customerOrderNumber ? ` (${f.customerOrderNumber})` : ""} — potvrdit`, short: "Potvrdit objednávku",
      title: "Objednávka zákazníka dorazila dodatečně — pošli zákazníkovi potvrzení s jejím číslem.",
      icon: ShoppingCart, palette: "indigo.action",
    });
  }
  if (f.stage === "pozastaveno") {
    out.push({
      key: "pozastaveno", label: f.holdReason ? `Pozastaveno — ${f.holdReason}` : "Pozastaveno", short: "Pozastaveno",
      title: `Zakázka stojí${f.holdReason ? `: ${f.holdReason}` : ""}. „Pokračovat“ ji vrátí tam, kde byla.`,
      icon: PauseCircle, palette: "muted.archive",
    });
  }
  if (f.correctedAt) {
    const day = czDay(f.correctedAt);
    out.push({
      key: "opraveno", label: `Opraveno${day ? ` ${day}` : ""}`, short: "Opraveno",
      title: `Zakázka opravena${day ? ` ${day}` : ""}${f.correctedNote ? ` — ${f.correctedNote}` : ""}.`,
      icon: ClipboardPen, palette: "amber.work",
    });
  }
  void today;
  return out;
}

// ── Filtr Knihy „Výjimky" ───────────────────────────────────
export type ExceptionFilterKey = "bez_po" | "reklamace" | "pozastaveno" | "vykres" | "opraveno";
export const EXCEPTION_FILTERS: { key: ExceptionFilterKey; label: string; icon: LucideIcon }[] = [
  { key: "bez_po", label: "Bez objednávky", icon: ShoppingCart },
  { key: "reklamace", label: "Reklamace", icon: AlertTriangle },
  { key: "pozastaveno", label: "Pozastaveno", icon: PauseCircle },
  { key: "vykres", label: "Nová revize výkresu", icon: FileDiff },
  { key: "opraveno", label: "Opraveno", icon: ClipboardPen },
];

export function isExceptionFilter(v: unknown): v is ExceptionFilterKey {
  return typeof v === "string" && EXCEPTION_FILTERS.some((x) => x.key === v);
}

/** Patří zakázka do filtru výjimky? (bez faktů toku — jen stav) */
export function matchesException(j: { stage: JobStage; flow?: FlowFacts | null }, key: ExceptionFilterKey): boolean {
  const f = j.flow ?? null;
  switch (key) {
    case "bez_po": return Boolean(f?.awaitingCustomerPo);
    case "reklamace": return j.stage === "reklamace" || Boolean(f && claimOpen(f));
    case "pozastaveno": return j.stage === "pozastaveno";
    case "vykres": return (f?.drawingChangesOpen ?? 0) > 0;
    case "opraveno": return Boolean(f?.correctedAt);
    default: return false;
  }
}

/** Důvody v záložce Nerealizované & zrušené (chipy) — štítek důvodu zakázky. */
export function lostReasonChipLabel(reason: string | null | undefined): string {
  return lostReasonLabel(reason);
}

// ── Oprava zakázky: rozdíl ──────────────────────────────────
export interface CorrectionItem { id: string; label: string; quantity: number; unitPrice: number | null; unit?: string | null }
export interface CorrectionChange { field: string; label: string; from: string | number | null; to: string | number | null }

/** Rozdíl opravy (položky — množství, cena; termín; poznámka k dodání) pro revizi objednávky a historii. */
export function correctionDiff(
  before: { items: CorrectionItem[]; dueDate: string | null; deliveryNote?: string | null },
  after: { items: { id: string; quantity: number; unitPrice?: number | null }[]; dueDate: string | null; deliveryNote?: string | null },
  opts: { prices: boolean },
): CorrectionChange[] {
  const out: CorrectionChange[] = [];
  const prev = new Map(before.items.map((i) => [i.id, i]));
  for (const a of after.items) {
    const b = prev.get(a.id);
    if (!b) continue;
    if (Math.abs(Number(a.quantity) - Number(b.quantity)) > 1e-9) {
      out.push({ field: `item:${a.id}:quantity`, label: `${b.label} — množství`, from: b.quantity, to: a.quantity });
    }
    if (opts.prices && a.unitPrice !== undefined && (a.unitPrice ?? null) !== (b.unitPrice ?? null)
        && !(a.unitPrice !== null && b.unitPrice !== null && Math.abs(Number(a.unitPrice) - Number(b.unitPrice)) < 0.005)) {
      out.push({ field: `item:${a.id}:unit_price`, label: `${b.label} — cena / ks`, from: b.unitPrice, to: a.unitPrice ?? null });
    }
  }
  if ((after.dueDate ?? null) !== (before.dueDate ?? null)) out.push({ field: "due_date", label: "Termín dodání", from: before.dueDate, to: after.dueDate });
  const dn = (after.deliveryNote ?? "").trim() || null;
  if (dn && dn !== ((before.deliveryNote ?? "").trim() || null)) out.push({ field: "delivery_address", label: "Dodací adresa / pokyny", from: before.deliveryNote ?? null, to: dn });
  return out;
}

/** „Kusů 120 → 150; Termín 12. 11. → 20. 11." (historie). */
export function correctionSummary(changes: CorrectionChange[]): string {
  const fmt = (v: string | number | null) => {
    if (v === null || v === undefined || v === "") return "—";
    if (typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v)) return czDay(v) ?? v;
    return String(v);
  };
  return changes.map((c) => `${c.label}: ${fmt(c.from)} → ${fmt(c.to)}`).join("; ");
}

/** Ikony výjimek pro dlaždice přehledu. */
export const EXCEPTION_TILE_ICONS: Record<ExceptionFilterKey | "chybi_po" | "nerealizovano", LucideIcon> = {
  bez_po: ShoppingCart, chybi_po: Factory, reklamace: AlertTriangle, pozastaveno: PauseCircle, vykres: FileDiff,
  opraveno: ClipboardPen, nerealizovano: CircleSlash,
};
