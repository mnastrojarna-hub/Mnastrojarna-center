import Link from "next/link";
import { Send } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * „Poptat dodavatele" u karty poptávky / nacenění (Poptávky, Nacenění): otevře kartu zakázky v Nákupu
 * s dialogem poptávkového kola (?akce=rfq.create). Jen s právem „rfq" (hlídá stránka).
 */
export function RfqListLink({ jobId, className }: { jobId: string; className?: string }) {
  return (
    <Link
      href={`/orders/${jobId}?tab=nakup&akce=rfq.create`}
      aria-label="Poptat dodavatele"
      title="Poptat dodavatele — anonymní poptávka 2–5 dodavatelům"
      className={cn(
        "inline-flex min-h-11 shrink-0 items-center justify-center gap-1.5 rounded-md border border-orange-300 bg-orange-50 px-3 text-xs font-semibold text-orange-800 shadow-sm transition hover:bg-orange-100 sm:min-h-9 dark:border-orange-500/40 dark:bg-orange-500/10 dark:text-orange-200",
        className,
      )}
      data-testid="rfq-list-link"
    >
      <Send className="h-4 w-4" aria-hidden /> Poptat
    </Link>
  );
}
