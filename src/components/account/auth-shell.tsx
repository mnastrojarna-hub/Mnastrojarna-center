import { ClipboardList, Camera, LayoutGrid } from "lucide-react";
import { Logo } from "@/components/logo";
import { cn } from "@/lib/utils";

/**
 * Společný rámec veřejných stránek (přihlášení, zapomenuté heslo, nové heslo):
 * jemný barevný přechod v barvách značky, logo, karta s formulářem.
 */

const HINTS = [
  {
    icon: ClipboardList,
    title: "Kniha zakázek",
    text: "Každá zakázka jeden barevný řádek — stav a termíny hned na očích.",
    tile: "bg-primary/10 text-primary",
  },
  {
    icon: Camera,
    title: "Vyfoť doklad",
    text: "Objednávku nebo dodací list stačí vyfotit mobilem a přiložit k zakázce.",
    tile: "bg-sky-500/10 text-sky-600 dark:text-sky-400",
  },
  {
    icon: LayoutGrid,
    title: "Vše na jednom místě",
    text: "Nabídky, výkresy, pošta, zákazníci i dodavatelé pohromadě.",
    tile: "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400",
  },
];

export function AuthShell({
  children,
  title,
  subtitle,
  showHints = false,
}: {
  children: React.ReactNode;
  title: string;
  subtitle?: string;
  showHints?: boolean;
}) {
  return (
    <div className="relative min-h-screen overflow-hidden bg-background">
      {/* Dekorativní přechody — červená značky, teplá oranžová, chladná modrá */}
      <div aria-hidden className="pointer-events-none absolute inset-0">
        <div className="absolute -left-32 -top-32 h-96 w-96 rounded-full bg-primary/15 blur-3xl dark:bg-primary/20" />
        <div className="absolute -right-24 top-1/3 h-80 w-80 rounded-full bg-amber-400/15 blur-3xl dark:bg-amber-500/10" />
        <div className="absolute -bottom-32 left-1/4 h-96 w-96 rounded-full bg-sky-400/10 blur-3xl dark:bg-sky-500/10" />
        <div className="absolute inset-0 bg-[radial-gradient(hsl(var(--foreground)/0.05)_1px,transparent_1px)] [background-size:22px_22px]" />
      </div>

      <div
        className={cn(
          "relative mx-auto flex min-h-screen w-full items-center px-4 py-10",
          showHints ? "max-w-5xl" : "max-w-md",
        )}
      >
        <div className={cn("grid w-full items-center gap-10", showHints && "md:grid-cols-[1.05fr_1fr]")}>
          {showHints && (
            <div className="order-2 space-y-6 md:order-1">
              <div className="hidden md:block">
                <Logo showSlogan className="[&_svg]:h-10 [&_svg]:w-10" />
                <h2 className="mt-6 text-3xl font-bold leading-tight tracking-tight">
                  Kancelář nástrojárny,
                  <br />
                  <span className="text-primary">která pracuje s vámi.</span>
                </h2>
                <p className="mt-3 max-w-sm text-sm text-muted-foreground">
                  Poptávky, nabídky, objednávky i dodací listy v jedné přehledné knize zakázek.
                </p>
              </div>
              <ul className="grid gap-3 sm:grid-cols-3 md:grid-cols-1">
                {HINTS.map((h) => (
                  <li
                    key={h.title}
                    className="flex items-start gap-3 rounded-xl border bg-card/70 p-3 shadow-sm backdrop-blur-sm"
                  >
                    <span className={cn("flex h-9 w-9 shrink-0 items-center justify-center rounded-lg", h.tile)}>
                      <h.icon className="h-[18px] w-[18px]" />
                    </span>
                    <span className="min-w-0">
                      <span className="block text-sm font-semibold">{h.title}</span>
                      <span className="block text-xs text-muted-foreground">{h.text}</span>
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          <div className={cn("order-1 w-full space-y-6 md:order-2", showHints && "mx-auto max-w-md")}>
            <div className={cn("flex flex-col items-center gap-2 text-center", showHints && "md:hidden")}>
              <Logo showSlogan />
            </div>
            <div className="overflow-hidden rounded-2xl border bg-card/95 shadow-xl shadow-primary/5 backdrop-blur">
              <div className="h-1.5 bg-gradient-to-r from-primary via-orange-500 to-amber-400" />
              <div className="space-y-5 p-6 sm:p-7">
                <div className="space-y-1">
                  <h1 className="text-xl font-bold tracking-tight">{title}</h1>
                  {subtitle && <p className="text-sm text-muted-foreground">{subtitle}</p>}
                </div>
                {children}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

/** Barevný banner (chyba / úspěch / info) pro veřejné stránky. */
export function AuthNotice({
  tone,
  children,
  icon: Icon,
}: {
  tone: "error" | "success" | "info" | "warning";
  children: React.ReactNode;
  icon?: React.ComponentType<{ className?: string }>;
}) {
  const styles: Record<typeof tone, string> = {
    error: "border-destructive/25 bg-destructive/10 text-destructive",
    success: "border-success/25 bg-success/10 text-success",
    info: "border-sky-500/25 bg-sky-500/10 text-sky-700 dark:text-sky-300",
    warning: "border-warning/30 bg-warning/10 text-foreground",
  };
  return (
    <div role={tone === "error" ? "alert" : "status"} className={cn("flex items-start gap-2 rounded-lg border p-3 text-sm", styles[tone])}>
      {Icon && <Icon className="mt-0.5 h-4 w-4 shrink-0" />}
      <div className="min-w-0">{children}</div>
    </div>
  );
}
