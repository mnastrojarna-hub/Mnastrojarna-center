import { Archive, Bot, CheckCircle2, Hourglass, Send, XCircle, type LucideIcon } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { StageBadge } from "@/components/jobs/stage-badge";
import { STAGE_ORDER, STAGES, isJobStage } from "@/lib/jobs/stages";
import { categoryStyle } from "@/lib/email/visibility";
import { quoteStatusLabel } from "@/lib/data/labels";
import type { JobStage, QuoteStatus } from "@/lib/supabase/database.types";
import { cn } from "@/lib/utils";

/**
 * Barevné odznaky: kategorie e-mailu, stav zakázky (= StageBadge z Knihy zakázek)
 * a stav nabídky. Přijímají kód z DB i český popisek (starší volající).
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

export interface QuoteStatusStyle {
  label: string;
  icon: LucideIcon;
  badge: string;
}

export const QUOTE_STATUS_STYLE: Record<QuoteStatus, QuoteStatusStyle> = {
  navrh_ai: {
    label: quoteStatusLabel.navrh_ai, icon: Bot,
    badge: "bg-fuchsia-100 text-fuchsia-800 dark:bg-fuchsia-500/15 dark:text-fuchsia-300",
  },
  ke_schvaleni: {
    label: quoteStatusLabel.ke_schvaleni, icon: Hourglass,
    badge: "bg-amber-100 text-amber-800 dark:bg-amber-500/15 dark:text-amber-300",
  },
  odeslano: {
    label: quoteStatusLabel.odeslano, icon: Send,
    badge: "bg-violet-100 text-violet-800 dark:bg-violet-500/15 dark:text-violet-300",
  },
  prijato: {
    label: quoteStatusLabel.prijato, icon: CheckCircle2,
    badge: "bg-green-100 text-green-800 dark:bg-green-500/15 dark:text-green-300",
  },
  zamitnuto: {
    label: quoteStatusLabel.zamitnuto, icon: XCircle,
    badge: "bg-red-100 text-red-700 dark:bg-red-500/15 dark:text-red-300",
  },
};

function quoteStatusOf(status: string): QuoteStatus | null {
  if (status in QUOTE_STATUS_STYLE) return status as QuoteStatus;
  const hit = (Object.keys(QUOTE_STATUS_STYLE) as QuoteStatus[]).find((k) => QUOTE_STATUS_STYLE[k].label === status);
  return hit ?? null;
}

/** Stav nabídky — kód (ke_schvaleni) nebo popisek („Ke schválení"); archivovaná verze šedě. */
export function QuoteStatusBadge({ status, archived = false, className }: { status: string; archived?: boolean; className?: string }) {
  const key = quoteStatusOf(status);
  if (archived) {
    return (
      <span className={cn("inline-flex shrink-0 items-center gap-1 whitespace-nowrap rounded-full bg-muted px-2 py-0.5 text-xs font-medium text-muted-foreground", className)}>
        <Archive className="h-3 w-3" /> Archiv
      </span>
    );
  }
  if (!key) return <Badge variant="secondary" className={className}>{status}</Badge>;
  const st = QUOTE_STATUS_STYLE[key];
  const Icon = st.icon;
  return (
    <span className={cn("inline-flex shrink-0 items-center gap-1 whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-medium", st.badge, className)}>
      <Icon className="h-3 w-3" />
      {st.label}
    </span>
  );
}
