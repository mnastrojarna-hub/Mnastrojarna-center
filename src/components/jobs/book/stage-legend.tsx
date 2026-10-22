import { ChevronDown, Palette, AlertTriangle, Flame, Camera, Sparkles, Mail } from "lucide-react";
import { StageBadge } from "@/components/jobs/stage-badge";
import { STAGE_ORDER, SIDE_STAGES, stageMeta } from "@/lib/jobs/stages";
import { DEADLINE_BADGE, type DeadlineState } from "@/lib/jobs/deadlines";
import { cn } from "@/lib/utils";

/** Rozbalovací nápověda „Jak číst barvy" — stavy, termíny a ikony v knize. */

const DEADLINES: { state: DeadlineState; label: string; text: string }[] = [
  { state: "ok", label: "za 12 dní", text: "v pohodě, víc než týden" },
  { state: "soon", label: "za 3 dny", text: "termín do 7 dní" },
  { state: "today", label: "dnes", text: "termín je dnes" },
  { state: "overdue", label: "2 dny po termínu", text: "po termínu, ještě v toleranci" },
  { state: "critical", label: "9 dní po termínu", text: "po maximálním tolerovaném termínu" },
  { state: "none", label: "bez termínu", text: "termín zatím není" },
  { state: "done", label: "splněno", text: "dodáno / uzavřeno" },
];

export function StageLegend({ className }: { className?: string }) {
  const flow = STAGE_ORDER.filter((s) => !SIDE_STAGES.includes(s));
  return (
    <details className={cn("group rounded-xl border bg-card", className)}>
      <summary className="flex cursor-pointer list-none items-center gap-2 rounded-xl px-4 py-3 text-sm font-medium hover:bg-muted/50 [&::-webkit-details-marker]:hidden">
        <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-gradient-to-br from-sky-500 via-violet-500 to-orange-500 text-white">
          <Palette className="h-4 w-4" />
        </span>
        Jak číst barvy
        <span className="text-xs font-normal text-muted-foreground">— každý stav má svou barvu</span>
        <ChevronDown className="ml-auto h-4 w-4 text-muted-foreground transition-transform group-open:rotate-180" />
      </summary>
      <div className="grid gap-6 border-t px-4 py-4 lg:grid-cols-[2fr_1fr]">
        <div className="space-y-4">
          <section>
            <h4 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Tok zakázky (zleva doprava)</h4>
            <ol className="grid gap-2 sm:grid-cols-2">
              {flow.map((s, i) => (
                <li key={s} className="flex items-start gap-2">
                  <span className="mt-0.5 w-4 shrink-0 text-right text-[11px] font-semibold tabular-nums text-muted-foreground">{i + 1}.</span>
                  <span className="min-w-0">
                    <StageBadge stage={s} />
                    <span className="mt-0.5 block text-xs text-muted-foreground">{stageMeta(s).description}</span>
                  </span>
                </li>
              ))}
            </ol>
          </section>
          <section>
            <h4 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Speciální stavy</h4>
            <ul className="grid gap-2 sm:grid-cols-2">
              {SIDE_STAGES.map((s) => (
                <li key={s} className="min-w-0">
                  <StageBadge stage={s} />
                  <span className="mt-0.5 block text-xs text-muted-foreground">{stageMeta(s).description}</span>
                </li>
              ))}
            </ul>
          </section>
        </div>
        <div className="space-y-4">
          <section>
            <h4 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Termíny</h4>
            <ul className="space-y-1.5">
              {DEADLINES.map((d) => (
                <li key={d.state} className="flex items-center gap-2 text-xs">
                  <span className={cn("w-28 shrink-0 whitespace-nowrap rounded-full px-1.5 py-0.5 text-center text-[10.5px] font-semibold", DEADLINE_BADGE[d.state])}>
                    {d.label}
                  </span>
                  <span className="text-muted-foreground">{d.text}</span>
                </li>
              ))}
            </ul>
            <p className="mt-2 text-[11px] text-muted-foreground">
              Hlídá se potvrzený termín zákazníkovi, jinak požadovaný termín zákazníka.
            </p>
          </section>
          <section>
            <h4 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Ikony</h4>
            <ul className="space-y-1.5 text-xs text-muted-foreground">
              <li className="flex items-center gap-2"><Flame className="h-4 w-4 text-red-500" /> vysoká priorita</li>
              <li className="flex items-center gap-2"><AlertTriangle className="h-4 w-4 text-amber-500" /> dodavatel slíbil později než náš termín</li>
              <li className="flex items-center gap-2"><Camera className="h-4 w-4 text-rose-500" /> založeno z fotky dokladu</li>
              <li className="flex items-center gap-2"><Mail className="h-4 w-4 text-cyan-600" /> založeno z e-mailu</li>
              <li className="flex items-center gap-2"><Sparkles className="h-4 w-4 text-violet-500" /> údaje vyplnila AI — zkontroluj</li>
            </ul>
          </section>
        </div>
      </div>
    </details>
  );
}
