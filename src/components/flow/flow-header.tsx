import Link from "next/link";
import { ChevronRight, Lightbulb, BookOpen, type LucideIcon } from "lucide-react";
import { stageMeta } from "@/lib/jobs/stages";
import { cn } from "@/lib/utils";
import { FLOW_TONES, visibleFlowSteps, type FlowStepKey, type FlowTone } from "./flow-utils";

/**
 * Hlavička stránky obchodního toku: barevná dlaždice v barvě kroku, popis, akce
 * a pod tím proužek toku „Poptávka → Nacenění → Nabídka → Objednávka → Potvrzení"
 * se zvýrazněným krokem (každý krok je odkaz). Bez stavu — renderuje se na serveru.
 */
export function FlowHeader({
  tone,
  icon: Icon,
  title,
  description,
  count,
  countLabel,
  actions,
  step,
  canPrice = false,
  children,
}: {
  /** Krok „Nacenění“ v proužku jen pro toho, kdo smí naceňovat (#25: super admin). */
  canPrice?: boolean;
  tone: FlowTone;
  icon: LucideIcon;
  title: string;
  description: React.ReactNode;
  count?: number;
  countLabel?: string;
  actions?: React.ReactNode;
  /** Zvýrazněný krok toku; bez něj se proužek nevykreslí. */
  step?: FlowStepKey | null;
  children?: React.ReactNode;
}) {
  const t = FLOW_TONES[tone];
  return (
    <section className={cn("relative overflow-hidden rounded-2xl border p-4 shadow-sm sm:p-5", t.header)}>
      <span aria-hidden className={cn("pointer-events-none absolute -right-16 -top-20 h-52 w-52 rounded-full blur-3xl", t.glow)} />
      <div className="relative flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div className="flex min-w-0 items-start gap-3">
          <span className={cn("flex h-11 w-11 shrink-0 items-center justify-center rounded-xl shadow-md sm:h-12 sm:w-12", t.tile)}>
            <Icon className="h-6 w-6" />
          </span>
          <div className="min-w-0 space-y-1">
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="text-xl font-semibold tracking-tight sm:text-2xl">{title}</h1>
              {count !== undefined && (
                <span className={cn("rounded-full px-2.5 py-0.5 text-xs font-semibold tabular-nums", t.count)}>
                  {count}
                  {countLabel ? ` ${countLabel}` : ""}
                </span>
              )}
            </div>
            <p className="max-w-2xl text-sm leading-relaxed text-muted-foreground">{description}</p>
          </div>
        </div>
        {actions && <div className="flex flex-wrap items-center gap-2 lg:max-w-[58%] lg:shrink-0 lg:justify-end">{actions}</div>}
      </div>
      {step !== undefined && step !== null && <FlowStrip current={step} canPrice={canPrice} className="relative mt-4" />}
      {children && <div className="relative mt-4">{children}</div>}
    </section>
  );
}

/** Proužek toku: aktuální krok plnou barvou, ostatní jemně; vodorovně posuvný na mobilu. */
export function FlowStrip({
  current, className, canPrice = false,
}: { current: FlowStepKey | null; className?: string; canPrice?: boolean }) {
  const steps = visibleFlowSteps(canPrice);
  const at = steps.findIndex((s) => s.key === current);
  return (
    <nav aria-label="Obchodní tok" className={cn("-mx-1 overflow-x-auto px-1 pb-1 scrollbar-thin", className)}>
      <ol className="flex w-max items-center gap-1 sm:w-auto">
        {steps.map((s, i) => {
          const m = stageMeta(s.stage);
          const Icon = m.icon;
          const active = s.key === current;
          const done = at >= 0 && i < at;
          return (
            <li key={s.key} className="flex items-center gap-1">
              {i > 0 && <ChevronRight aria-hidden className="h-4 w-4 shrink-0 text-muted-foreground/60" />}
              <Link
                href={s.href}
                aria-current={active ? "step" : undefined}
                title={`${s.label}: ${s.hint}`}
                className={cn(
                  "inline-flex items-center gap-1.5 whitespace-nowrap rounded-full px-2.5 py-1 text-xs font-medium transition hover:brightness-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                  active ? cn(m.solid, "shadow-sm ring-2 ring-offset-1 ring-offset-background", m.ring) : m.badge,
                  !active && !done && at >= 0 && "opacity-80",
                )}
              >
                <Icon className="h-3.5 w-3.5" />
                {s.label}
                {active && <span className="hidden font-normal opacity-90 sm:inline">· {s.hint}</span>}
              </Link>
            </li>
          );
        })}
        <li className="flex items-center gap-1">
          <ChevronRight aria-hidden className="h-4 w-4 shrink-0 text-muted-foreground/60" />
          <Link
            href="/orders"
            className="inline-flex items-center gap-1.5 whitespace-nowrap rounded-full border border-dashed px-2.5 py-1 text-xs font-medium text-muted-foreground transition hover:bg-accent hover:text-foreground"
          >
            <BookOpen className="h-3.5 w-3.5" /> Výroba a dodání v Knize zakázek
          </Link>
        </li>
      </ol>
    </nav>
  );
}

/** Nápověda „jak to funguje" — žárovka, krátký text. */
export function FlowHint({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <div className={cn("flex items-start gap-2.5 rounded-xl border border-amber-200/70 bg-amber-50/70 px-3 py-2.5 text-sm text-amber-950 dark:border-amber-500/20 dark:bg-amber-500/10 dark:text-amber-100", className)}>
      <Lightbulb className="mt-0.5 h-4 w-4 shrink-0 text-amber-500" />
      <div className="min-w-0 leading-relaxed">{children}</div>
    </div>
  );
}

/** Sekce stránky s barevnou ikonou v nadpisu. */
export function FlowSection({
  icon: Icon,
  iconClass,
  title,
  description,
  count,
  actions,
  children,
  className,
  id,
}: {
  icon: LucideIcon;
  /** Třídy dlaždice ikony (barva pozadí + textu). */
  iconClass: string;
  title: string;
  description?: React.ReactNode;
  count?: number;
  actions?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
  id?: string;
}) {
  return (
    <section id={id} className={cn("space-y-3", className)}>
      <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
        <div className="flex min-w-0 items-start gap-2.5">
          <span className={cn("flex h-8 w-8 shrink-0 items-center justify-center rounded-lg", iconClass)}>
            <Icon className="h-4 w-4" />
          </span>
          <div className="min-w-0">
            <h2 className="flex items-center gap-2 text-base font-semibold leading-tight">
              {title}
              {count !== undefined && (
                <span className="rounded-full bg-muted px-2 py-0.5 text-xs font-semibold tabular-nums text-muted-foreground">{count}</span>
              )}
            </h2>
            {description && <p className="mt-0.5 text-sm text-muted-foreground">{description}</p>}
          </div>
        </div>
        {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
      </div>
      {children}
    </section>
  );
}

/** Přátelský prázdný stav: co tu bude a co mám udělat. */
export function FlowEmpty({
  icon: Icon,
  iconClass,
  title,
  children,
  actions,
  className,
}: {
  icon: LucideIcon;
  iconClass: string;
  title: string;
  children?: React.ReactNode;
  actions?: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("flex flex-col items-center gap-3 rounded-2xl border border-dashed bg-card/60 px-5 py-9 text-center", className)}>
      <span className={cn("flex h-14 w-14 items-center justify-center rounded-2xl", iconClass)}>
        <Icon className="h-7 w-7" />
      </span>
      <div className="max-w-md space-y-1">
        <p className="font-semibold">{title}</p>
        {children && <div className="text-sm leading-relaxed text-muted-foreground">{children}</div>}
      </div>
      {actions && <div className="flex flex-wrap items-center justify-center gap-2 pt-1">{actions}</div>}
    </div>
  );
}

/** Odkaz „Otevřít v Knize zakázek" s předvybraným filtrem. */
export function BookLink({ href, label = "Otevřít v Knize zakázek", className }: { href: string; label?: string; className?: string }) {
  return (
    <Link
      href={href}
      className={cn(
        "inline-flex h-9 items-center gap-2 whitespace-nowrap rounded-md border border-border bg-background px-3 text-sm font-medium shadow-sm transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
        className,
      )}
    >
      <BookOpen className="h-4 w-4 text-muted-foreground" /> {label}
    </Link>
  );
}
