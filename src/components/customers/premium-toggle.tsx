"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Loader2, TriangleAlert } from "lucide-react";
import { Switch } from "@/components/ui/switch";
import { setCustomerPremium } from "@/app/actions/crm";
import { cn } from "@/lib/utils";

/**
 * Přepínač „Prémiový zákazník" v kartě zákazníka (9. 11.). Uloží se hned; všechny zakázky zákazníka se
 * zvýrazní / přestanou zvýrazňovat okamžitě (příznak se čte živě ze zákazníka). Smí každý, kdo smí zákazníka upravit.
 */
export function PremiumToggle({ customerId, value, className }: { customerId: string; value: boolean; className?: string }) {
  const router = useRouter();
  const [on, setOn] = React.useState(value);
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [, startTransition] = React.useTransition();

  React.useEffect(() => {
    if (!busy) setOn(value);
  }, [value, busy]);

  async function change(next: boolean) {
    if (busy) return;
    setOn(next);
    setBusy(true);
    setError(null);
    const res = await setCustomerPremium(customerId, next);
    setBusy(false);
    if (!res.ok) {
      setOn(!next);
      setError(res.error ?? "Uložení se nepovedlo.");
      return;
    }
    startTransition(() => router.refresh());
  }

  const id = `premium-${customerId}`;
  return (
    <div className={cn("space-y-1", className)}>
      <label
        htmlFor={id}
        className={cn(
          "inline-flex cursor-pointer select-none items-center gap-2 rounded-full border px-2.5 py-1 text-xs font-semibold transition",
          on
            ? "border-red-600 bg-red-600 text-white shadow-sm shadow-red-600/25 dark:border-red-500"
            : "border-border bg-background/80 text-foreground hover:bg-accent",
        )}
        title="Všechny zakázky prémiového zákazníka jsou v Knize zakázek a všude jinde výrazně označené „Pozor, prémiový zákazník“."
      >
        <TriangleAlert className={cn("h-3.5 w-3.5", on ? "text-white" : "text-red-600 dark:text-red-400")} aria-hidden />
        Prémiový zákazník
        <Switch
          id={id}
          checked={on}
          disabled={busy}
          onCheckedChange={(v) => void change(v)}
          aria-label="Prémiový zákazník"
          data-testid="premium-toggle"
          className={cn(on && "data-[state=checked]:bg-white/90 [&>span]:bg-red-600")}
        />
        {busy && <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />}
      </label>
      {error && <p role="alert" className="text-xs text-destructive">{error}</p>}
    </div>
  );
}
