"use client";

import * as React from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Loader2 } from "lucide-react";
import { CountChips, type CountChip } from "@/components/flow-status/count-chips";
import { STATE_PARAM, stateParamValue } from "./flow-state";

/**
 * Chipy dílčích stavů s počty (z DB) — výběr jde do URL (?stav=a,b), stránka se načte
 * na serveru znovu. Výchozí výběr „Otevřené“ = bez parametru; prázdný výběr = výchozí.
 */
export function FlowStateFilter({
  chips, selected, fallback, label,
}: {
  chips: CountChip[];
  selected: string[];
  fallback: string[];
  label?: string;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const [pending, startTransition] = React.useTransition();
  const [local, setLocal] = React.useState(selected);
  React.useEffect(() => setLocal(selected), [selected]);

  function change(keys: string[]) {
    const next = keys.length ? keys : [...fallback];
    setLocal(next);
    const sp = new URLSearchParams(params?.toString() ?? "");
    const value = stateParamValue(next, fallback);
    if (value) sp.set(STATE_PARAM, value);
    else sp.delete(STATE_PARAM);
    sp.delete("job");
    const qs = sp.toString().replace(/%2C/g, ",");
    startTransition(() => router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false }));
  }

  return (
    <div className="relative" aria-busy={pending}>
      <CountChips chips={chips} selected={local} onChange={change} label={label} />
      {pending && (
        <Loader2 className="absolute right-0 top-1/2 hidden h-4 w-4 -translate-y-1/2 animate-spin text-muted-foreground sm:block" aria-hidden />
      )}
    </div>
  );
}
