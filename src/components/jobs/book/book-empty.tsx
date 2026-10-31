import { Ban, CircleCheckBig, LayoutList, MessageSquareQuote, SearchX, ShoppingCart, Camera, PenLine, type LucideIcon } from "lucide-react";
import { CaptureButton } from "@/components/jobs/capture/capture-button";
import { NewJobDialog } from "@/components/jobs/new-job-dialog";
import { ResetFiltersButton } from "@/components/jobs/book/book-reset";
import type { BookSegmentKey } from "@/components/jobs/book/book-params";
import type { JobStage } from "@/lib/supabase/database.types";
import type { JobFormOptions } from "@/lib/jobs/types";
import { cn } from "@/lib/utils";

/** Přátelské prázdné stavy — vysvětlí, co dělat dál. */

const EMPTY: Record<BookSegmentKey, { icon: LucideIcon; tone: string; title: string; text: string; actions: boolean }> = {
  objednavky: {
    icon: ShoppingCart, tone: "bg-orange-100 text-orange-600 dark:bg-orange-500/15 dark:text-orange-300",
    title: "Zatím žádné objednávky",
    text: "Vyfoť objednávku zákazníka a AI ji zařadí sama, nebo založ zakázku ručně.",
    actions: true,
  },
  poptavky: {
    icon: MessageSquareQuote, tone: "bg-sky-100 text-sky-600 dark:bg-sky-500/15 dark:text-sky-300",
    title: "Žádné otevřené poptávky ani nabídky",
    text: "Poptávka z e-mailu nebo z fotky se objeví tady. Cenu dává člověk — AI se jen učí.",
    actions: true,
  },
  dokoncene: {
    icon: CircleCheckBig, tone: "bg-slate-200 text-slate-600 dark:bg-slate-500/20 dark:text-slate-300",
    title: "Zatím nic dokončeného",
    text: "Zakázka se sem přesune, jakmile vystavíš dodací list na celou dodávku (Dodáno zákazníkovi), a zůstane tu i po faktuře a zaplacení.",
    actions: false,
  },
  nerealizovane: {
    icon: Ban, tone: "bg-stone-200 text-stone-600 dark:bg-stone-500/20 dark:text-stone-300",
    title: "Žádné nerealizované ani zrušené zakázky",
    text: "Sem patří prohrané nabídky a zrušené zakázky. Prázdno je tu dobrá zpráva.",
    actions: false,
  },
  vse: {
    icon: LayoutList, tone: "bg-primary/10 text-primary",
    title: "Kniha zakázek je zatím prázdná",
    text: "Začni vyfocením prvního dokladu (poptávka, objednávka…) — AI z něj založí zakázku. Nebo ji založ ručně.",
    actions: true,
  },
};

export function BookEmpty({
  segment,
  filtered,
  options,
  defaultStage,
  userId,
}: {
  segment: BookSegmentKey;
  filtered: boolean;
  options: JobFormOptions;
  defaultStage: JobStage;
  userId: string;
}) {
  if (filtered) {
    return (
      <EmptyFrame icon={SearchX} tone="bg-amber-100 text-amber-600 dark:bg-amber-500/15 dark:text-amber-300" title="Nic tomu neodpovídá">
        <p>Zkus jiné slovo (číslo zakázky, zákazník, číslo objednávky zákazníka, výkres) nebo zruš filtry.</p>
        <div className="mt-4 flex justify-center">
          <ResetFiltersButton />
        </div>
      </EmptyFrame>
    );
  }
  const e = EMPTY[segment];
  return (
    <EmptyFrame icon={e.icon} tone={e.tone} title={e.title}>
      <p>{e.text}</p>
      {e.actions && (
        <>
          <div className="mt-5 flex flex-col items-stretch justify-center gap-2 sm:flex-row sm:items-center">
            <CaptureButton label="Vyfotit doklad" size="lg" />
            <NewJobDialog options={options} initial={{ stage: defaultStage, ownerId: userId }} variant="outline" size="lg" />
          </div>
          <ul className="mx-auto mt-5 grid max-w-md gap-2 text-left text-xs text-muted-foreground sm:grid-cols-2">
            <li className="flex items-start gap-2 rounded-lg bg-rose-50 p-2.5 dark:bg-rose-500/10">
              <Camera className="mt-0.5 h-4 w-4 shrink-0 text-rose-500" />
              <span><strong className="text-foreground">Vyfoť doklad</strong> — AI pozná, co to je, najde zákazníka i zakázku a vše předvyplní.</span>
            </li>
            <li className="flex items-start gap-2 rounded-lg bg-muted p-2.5">
              <PenLine className="mt-0.5 h-4 w-4 shrink-0 text-foreground/70" />
              <span><strong className="text-foreground">Ručně</strong> — vyplň formulář, AI se z toho učí.</span>
            </li>
          </ul>
        </>
      )}
    </EmptyFrame>
  );
}

function EmptyFrame({ icon: Icon, tone, title, children }: { icon: LucideIcon; tone: string; title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-xl border border-dashed bg-card px-6 py-12 text-center text-sm text-muted-foreground">
      <span className={cn("mx-auto flex h-14 w-14 items-center justify-center rounded-2xl", tone)}>
        <Icon className="h-7 w-7" />
      </span>
      <h3 className="mt-4 text-base font-semibold text-foreground">{title}</h3>
      <div className="mx-auto mt-1 max-w-md">{children}</div>
    </div>
  );
}
