"use client";

import * as React from "react";
import { Check, ChevronDown, FileText, Sparkles } from "lucide-react";
import { money } from "@/lib/jobs/production-suggest";
import type { HandoffPlan, WhoSuggestion } from "@/lib/jobs/production-handoff-types";
import { cn } from "@/lib/utils";
import { alternativeLine, badgeText, suggestionLine, whoKey } from "./handoff-model";

/** Štítek „✦ Předvyplnila AI" (vše v dialogu je návrh — člověk jen potvrdí nebo opraví). */
export function AiLabel({ className, text = "Předvyplnila AI" }: { className?: string; text?: string }) {
  return (
    <span className={cn("inline-flex items-center gap-1 rounded-full bg-violet-100 px-2 py-0.5 text-[11px] font-semibold text-violet-800 dark:bg-violet-500/15 dark:text-violet-300", className)}>
      <Sparkles className="h-3 w-3" /> {text}
    </span>
  );
}

/**
 * Banner postupu: „Nejlevnější postup: Novák + TepKal 14 300 Kč (kompletně u Hrubý 15 000 Kč)"
 * s „Použít: …" pro jinou variantu; bez práva na ceny jen „Doporučený postup podle nabídek: …".
 */
export function SuggestionBanner({
  plan, currency, onUseRoute, busyRoute,
}: {
  plan: HandoffPlan;
  currency: string;
  onUseRoute?: (key: string) => void;
  busyRoute?: string | null;
}) {
  const prices = plan.permissions.canSeePrices;
  const chosen = plan.routes.find((r) => r.selected) ?? null;
  const others = plan.routes.filter((r) => !r.selected && r.complete);
  const chips = plan.client?.routeChips ?? [];
  let text: string;
  if (chosen && (plan.routeSource === "nabidky")) {
    text = prices && chosen.total !== null
      ? `Nejlevnější postup: ${chosen.label} ${money(chosen.total, currency)}${others.length ? ` (${others.map((o) => `${o.label}${o.total !== null ? ` ${money(o.total, currency)}` : ""}`).join(", ")})` : ""}`
      : `Doporučený postup podle nabídek: ${chosen.label}`;
  } else if (plan.routeSource === "planovane") {
    text = "Podle připraveného postupu — zkontroluj a potvrď.";
  } else {
    text = "Předvyplnila AI podle nabídek dodavatelů a výkresu — zkontroluj a potvrď.";
  }
  if (plan.kind !== "predani" && plan.kind !== "plan") return null;
  return (
    <div className="space-y-1.5 rounded-xl border border-violet-200 bg-violet-50/70 px-3 py-2.5 text-sm dark:border-violet-500/30 dark:bg-violet-500/10">
      <p className="flex items-start gap-1.5 font-medium text-violet-950 dark:text-violet-100">
        <Sparkles className="mt-0.5 h-4 w-4 shrink-0 text-violet-600 dark:text-violet-300" aria-hidden />
        <span className="min-w-0">{text}</span>
      </p>
      {(others.length > 0 || chips.length > 0) && (
        <div className="flex flex-wrap items-center gap-1.5 pl-5">
          {onUseRoute && others.map((o) => (
            <button
              key={o.key}
              type="button"
              onClick={() => onUseRoute(o.key)}
              disabled={Boolean(busyRoute)}
              className="inline-flex h-8 items-center rounded-full border border-violet-300 bg-background px-3 text-xs font-semibold text-violet-800 transition hover:bg-violet-100 disabled:opacity-60 dark:border-violet-500/40 dark:text-violet-200 dark:hover:bg-violet-500/15"
            >
              {busyRoute === o.key ? "Načítám…" : `Použít: ${o.label}`}
            </button>
          ))}
          {chips.map((c) => (
            <span key={c} className="rounded-full bg-violet-100 px-2 py-0.5 text-[11px] font-medium text-violet-800 dark:bg-violet-500/15 dark:text-violet-200">{c}</span>
          ))}
        </div>
      )}
      {plan.pendingCapturedQuotes > 0 && (
        <p className="pl-5 text-xs text-violet-900/80 dark:text-violet-200/80">
          {plan.pendingCapturedQuotes} {plan.pendingCapturedQuotes === 1 ? "vyfocená nabídka čeká" : "vyfocené nabídky čekají"} na zapsání do Nákupu
        </p>
      )}
    </div>
  );
}

function Badges({ s }: { s: WhoSuggestion }) {
  if (!s.badges.length) return null;
  return (
    <span className="flex flex-wrap gap-1">
      {s.badges.map((b) => (
        <span
          key={b}
          className={cn(
            "rounded-full px-1.5 py-0.5 text-[10.5px] font-semibold",
            b === "vyprsela" || b === "jina_mena" || b === "za_kg" ? "bg-amber-100 text-amber-800 dark:bg-amber-500/15 dark:text-amber-300"
              : b === "vybrana" ? "bg-sky-100 text-sky-800 dark:bg-sky-500/15 dark:text-sky-300"
                : b === "cast" ? "bg-orange-100 text-orange-800 dark:bg-orange-500/15 dark:text-orange-300"
                  : "bg-green-100 text-green-800 dark:bg-green-500/15 dark:text-green-300",
          )}
        >
          {badgeText(b, s)}
        </span>
      ))}
    </span>
  );
}

/** Hlavní návrh kdo (nejlevnější nabídka / vystavená objednávka / historie) — jedním ťuknutím vybráno. */
export function PrimaryCard({
  s, selected, canSeePrices, date, onPick,
}: { s: WhoSuggestion; selected: boolean; canSeePrices: boolean; date?: string | null; onPick: () => void }) {
  const line = suggestionLine(s, { canSeePrices, date });
  return (
    <button
      type="button"
      onClick={onPick}
      aria-pressed={selected}
      className={cn(
        "flex w-full items-start gap-2.5 rounded-xl border-2 px-3 py-2.5 text-left transition",
        selected ? "border-green-500 bg-green-50/70 dark:bg-green-500/10" : "border-border bg-background hover:border-green-400",
      )}
    >
      <span className={cn("mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full border-2", selected ? "border-green-600 bg-green-600 text-white" : "border-muted-foreground/40")}>
        {selected && <Check className="h-3 w-3" strokeWidth={3} />}
      </span>
      <span className="min-w-0 flex-1 space-y-1">
        <span className="block text-sm font-semibold leading-snug" data-testid="handoff-primary">{line}</span>
        {s.source !== "nejlevnejsi_nabidka" && s.source !== "objednavka" && s.reason && (
          <span className="block text-xs text-muted-foreground">{s.reason}</span>
        )}
        {s.coverage && s.coverage.uncovered.length > 0 && (
          <span className="block text-xs text-orange-700 dark:text-orange-300">Nabídka pokrývá {s.coverage.matched} z {s.coverage.total} dílů (chybí {s.coverage.uncovered.join(", ")})</span>
        )}
        {s.expired && <span className="block text-xs text-amber-700 dark:text-amber-300">Nabídka vypršela — ověř cenu u dodavatele.</span>}
        <Badges s={s} />
      </span>
      {selected && <span className="shrink-0 self-center text-xs font-semibold text-green-700 dark:text-green-400">✓ vybráno</span>}
    </button>
  );
}

/** Další nabídky (sbalené): „{Firma} — 13 900 Kč (+1 500 Kč) · 10. 11." + štítky; ťuk = vybrat. */
export function AlternativesList({
  items, current, canSeePrices, onPick, defaultOpen,
}: {
  items: WhoSuggestion[];
  current: string;
  canSeePrices: boolean;
  onPick: (s: WhoSuggestion) => void;
  defaultOpen?: boolean;
}) {
  const [open, setOpen] = React.useState(Boolean(defaultOpen));
  if (!items.length) return null;
  return (
    <div className="min-w-0">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="inline-flex h-9 items-center gap-1 rounded-full px-2 text-xs font-semibold text-sky-700 hover:bg-sky-50 dark:text-sky-400 dark:hover:bg-sky-500/10"
      >
        Další nabídky ({items.length}) <ChevronDown className={cn("h-3.5 w-3.5 transition-transform", open && "rotate-180")} />
      </button>
      {open && (
        <ul className="mt-1 space-y-1">
          {items.map((s) => {
            const on = whoKey(s.who) === current;
            return (
              <li key={`${s.supplierQuoteId ?? ""}:${whoKey(s.who)}:${s.source}`}>
                <button
                  type="button"
                  onClick={() => onPick(s)}
                  aria-pressed={on}
                  className={cn("flex w-full flex-col gap-1 rounded-lg border px-2.5 py-2 text-left text-sm transition hover:bg-accent", on && "border-green-500 bg-green-50/60 dark:bg-green-500/10")}
                >
                  <span className="flex min-w-0 items-start gap-1.5">
                    {s.purchaseOrder ? <FileText className="mt-0.5 h-3.5 w-3.5 shrink-0 text-lime-600" /> : null}
                    <span className="min-w-0 flex-1 font-medium">{alternativeLine(s, canSeePrices)}</span>
                    {on && <Check className="h-4 w-4 shrink-0 text-green-600" />}
                  </span>
                  {s.source !== "nejlevnejsi_nabidka" && s.reason && s.reason !== "Další nabídka" && <span className="text-xs text-muted-foreground">{s.reason}</span>}
                  <Badges s={s} />
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
