import { cn } from "@/lib/utils";

/**
 * Přátelský prázdný stav — barevná ikona, co tu bude a co udělat dál.
 * Bez stavu (renderuje server i klient); ikonu předává volající jako prvek.
 */
export function FriendlyEmpty({
  icon,
  tone = "bg-primary/10 text-primary",
  title,
  children,
  actions,
  className,
  compact = false,
}: {
  icon: React.ReactNode;
  /** Třídy kroužku ikony (pozadí + text). */
  tone?: string;
  title: string;
  children?: React.ReactNode;
  actions?: React.ReactNode;
  className?: string;
  compact?: boolean;
}) {
  return (
    <div
      className={cn(
        "flex flex-col items-center rounded-2xl border border-dashed bg-card/60 text-center",
        compact ? "gap-2 px-4 py-6" : "gap-3 px-6 py-10",
        className,
      )}
    >
      <span
        className={cn(
          "flex items-center justify-center rounded-2xl",
          compact ? "h-10 w-10 [&_svg]:h-5 [&_svg]:w-5" : "h-14 w-14 [&_svg]:h-7 [&_svg]:w-7",
          tone,
        )}
      >
        {icon}
      </span>
      <div className="max-w-md space-y-1">
        <p className={cn("font-semibold", compact ? "text-sm" : "text-base")}>{title}</p>
        {children && <div className="text-sm text-muted-foreground">{children}</div>}
      </div>
      {actions && <div className="mt-1 flex flex-col items-stretch justify-center gap-2 sm:flex-row sm:items-center">{actions}</div>}
    </div>
  );
}
