import * as React from "react";
import { specChips, type DrawingSpecView } from "@/lib/jobs/drawing-spec";
import { cn } from "@/lib/utils";

/**
 * Kompaktní štítky z výkresu: skupina materiálu, „≈ X kg polotovar" / „X kg", „Kaleno 55 HRC",
 * „Nitridace 700 HV", „Černění"; „bez TZ" / „bez PÚ" tlumeně, „TZ nezjištěno" oranžově.
 * compact = jen skupina materiálu (řádek Knihy). Bez údajů nic nevykreslí.
 */
export function DrawingSpecChips({
  spec, compact, className, testId = "drawing-spec-chips",
}: {
  spec: DrawingSpecView | null | undefined;
  compact?: boolean;
  className?: string;
  testId?: string;
}) {
  const chips = specChips(spec, { compact });
  if (!chips.length) return null;
  return (
    <span className={cn("flex flex-wrap items-center gap-1", className)} data-testid={testId}>
      {chips.map((c) => (
        <span
          key={c.key}
          title={c.title}
          data-chip={c.key}
          data-tone={c.tone}
          className={cn("inline-flex max-w-full items-center truncate rounded px-1.5 py-0.5 text-[10px] font-semibold leading-tight", c.className)}
        >
          {c.label}
        </span>
      ))}
    </span>
  );
}
