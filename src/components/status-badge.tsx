import { Badge } from "@/components/ui/badge";
import { StateChip } from "@/components/flow-status/state-chip";
import { StageBadge } from "@/components/jobs/stage-badge";
import { STAGE_ORDER, STAGES, isJobStage } from "@/lib/jobs/stages";
import { categoryStyle } from "@/lib/email/visibility";
import { quoteStateFromStatus, quoteStatusLabel } from "@/lib/data/labels";
import { QUOTE_STATES } from "@/lib/jobs/flow-status";
import type { JobStage, QuoteState } from "@/lib/supabase/database.types";
import { cn } from "@/lib/utils";

/**
 * Barevné odznaky: kategorie e-mailu, stav zakázky (= StageBadge z Knihy zakázek)
 * a stav nabídky (= QUOTE_STATES). Přijímají kód z DB i český popisek (starší volající).
 */

export function CategoryBadge({ category, className }: { category: string; className?: string }) {
  const st = categoryStyle(category);
  const Icon = st.icon;
  return (
    <span className={cn("inline-flex shrink-0 items-center gap-1 whitespace-nowrap rounded-full border px-2 py-0.5 text-xs font-medium", st.chip, className)}>
      <Icon className="h-3 w-3" />
      {st.label}
    </span>
  );
}

/** Stav zakázky — kód (objednavka) nebo popisek („Objednávka"). */
export function OrderStatusBadge({ status, className }: { status: string; className?: string }) {
  const stage: JobStage | undefined = isJobStage(status) ? status : STAGE_ORDER.find((s) => STAGES[s].label === status);
  if (stage) return <StageBadge stage={stage} className={className} />;
  return <Badge variant="secondary" className={className}>{status}</Badge>;
}

/** Popisky staršího výpisu nabídek (před QUOTE_STATES) → status. */
const LEGACY_LABELS: Record<string, string> = {
  "Návrh AI": "navrh_ai", "Ke schválení": "ke_schvaleni", "Odesláno": "odeslano", "Přijato": "prijato", "Zamítnuto": "zamitnuto",
};

/** Popisek → kód stavu (starší volající posílají český popisek ze status nebo ze state). */
function quoteStateOfText(status: string, archived: boolean, state?: string | null): QuoteState | "vyprsela" | null {
  if (state === "vyprsela") return "vyprsela";
  const direct = quoteStateFromStatus(LEGACY_LABELS[status] ?? status, { state, archived });
  if (direct) return direct;
  const byStatusLabel = (Object.keys(quoteStatusLabel) as (keyof typeof quoteStatusLabel)[]).find((k) => quoteStatusLabel[k] === status);
  if (byStatusLabel) return quoteStateFromStatus(byStatusLabel, { archived });
  const byStateLabel = (Object.keys(QUOTE_STATES) as (keyof typeof QUOTE_STATES)[]).find((k) => QUOTE_STATES[k].label === status || k === status);
  return byStateLabel ?? null;
}

/**
 * Stav nabídky — jediná definice stavů je QUOTE_STATES (lib/jobs/flow-status). Přijímá
 * quotes.state, starší status (ke_schvaleni) i český popisek; archivovaná verze šedě.
 */
export function QuoteStatusBadge({
  status, state, archived = false, ai, className,
}: {
  status: string;
  /** quotes.state (nebo „vyprsela“) — má přednost před status. */
  state?: string | null;
  archived?: boolean;
  /** Připravila AI → ✨. */
  ai?: boolean;
  className?: string;
}) {
  const key = quoteStateOfText(status, archived, state);
  if (!key) return <Badge variant="secondary" className={className}>{status}</Badge>;
  return <StateChip meta={QUOTE_STATES[key]} ai={ai ?? status === "navrh_ai"} className={className} />;
}
