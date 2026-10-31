import { CHIP_BASE, CHIP_ICON, FLOW_PALETTE, type FlowFacts } from "@/lib/jobs/flow-status";
import { exceptionFlags, type ExceptionFlag, type ExceptionFlagKey } from "@/lib/jobs/flow-exceptions";
import { cn } from "@/lib/utils";

/** Štítek výjimky v toku („Nová revize výkresu", „Bez objednávky", „Reklamace", „Opraveno …"). */
export function ExceptionFlagChip({ flag, size = "sm", short, className }: { flag: ExceptionFlag; size?: "xs" | "sm"; short?: boolean; className?: string }) {
  const p = FLOW_PALETTE[flag.palette];
  const Icon = flag.icon;
  return (
    <span title={flag.title} data-flag={flag.key} className={cn(CHIP_BASE, p.badge, size === "xs" && "px-1.5 py-0 text-[11px]", "max-w-full", className)}>
      <Icon className={CHIP_ICON} aria-hidden />
      <span className="truncate">{short ? flag.short : flag.label}</span>
    </span>
  );
}

/** Štítky výjimek řádku Knihy (bez „Pozastaveno" a „Reklamace" ve stejnojmenném stavu — to říká barva stavu). */
export function RowExceptionFlags({ flow, stage, today, short, className, skip = [] }: {
  flow: FlowFacts | null | undefined; stage: string; today?: string; short?: boolean; className?: string; skip?: ExceptionFlagKey[];
}) {
  if (!flow) return null;
  const flags = exceptionFlags({ ...flow, stage: flow.stage ?? (stage as FlowFacts["stage"]) }, today)
    .filter((f) => !skip.includes(f.key) && !(f.key === "pozastaveno" && !flow.holdReason) && !(f.key === "reklamace" && stage === "reklamace" && !flow.claimReason));
  if (!flags.length) return null;
  return (
    <span className={cn("flex min-w-0 max-w-full flex-wrap gap-1", className)} data-testid="row-exception-flags">
      {flags.map((f) => <ExceptionFlagChip key={f.key} flag={f} size="xs" short={short} />)}
    </span>
  );
}
