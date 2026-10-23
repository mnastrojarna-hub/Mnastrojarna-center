import { StateChip } from "@/components/flow-status/state-chip";
import { stateMeta } from "@/lib/jobs/flow-status";
import type { ChipData } from "./flow-state";

/** Chip dílčího stavu ze serializovatelných dat (meta + ikonu dohledá podle fáze a klíče). */
export function FlowChip({ chip, size, className }: { chip: ChipData | null | undefined; size?: "sm" | "xs"; className?: string }) {
  if (!chip) return null;
  const meta = stateMeta(chip.phase, chip.key);
  if (!meta) return null;
  return (
    <StateChip
      meta={meta}
      label={chip.label}
      hint={chip.hint}
      progress={chip.progress}
      ai={chip.ai}
      size={size}
      className={className}
      data-flow-state={`${chip.phase}.${chip.key}`}
    />
  );
}
