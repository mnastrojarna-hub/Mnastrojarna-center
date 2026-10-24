import * as React from "react";
import { cn } from "@/lib/utils";
import { CHIP_BASE, CHIP_ICON, FLOW_PALETTE, pillHueOf, type FlowStateMeta, type PhaseChip, type Progress } from "@/lib/jobs/flow-status";
import { ShieldAlert } from "lucide-react";
import { ProgressPill } from "./progress-pill";
import { APPROVAL_TONE } from "./quote-approval-flag";

export interface StateChipProps {
  meta: FlowStateMeta;
  /** Text chipu (výchozí meta.label), např. „Odmítnutá — Kapacita". */
  label?: string;
  /** Doplněk za tečkou: „čeká 3 dny", „rev 2", „NAB-2026-031 r2". */
  hint?: string | null;
  progress?: Progress | null;
  /** Vytvořila / navrhla AI → ✨. */
  ai?: boolean;
  size?: "sm" | "xs";
  /** Krátký štítek (mobil). */
  short?: boolean;
  /** Chip je tlačítko jen s onClick (otevře menu stavu). */
  onClick?: (e: React.MouseEvent<HTMLButtonElement>) => void;
  className?: string;
}

/**
 * Chip dílčího stavu: odstín fáze + styl podle tónu + ikona + text (barva nikdy nenese význam
 * sama — WCAG 1.4.1). Tlačítkem je jen tehdy, když má onClick.
 */
export const StateChip = React.forwardRef<HTMLButtonElement & HTMLSpanElement, StateChipProps>(function StateChip(
  { meta, label, hint, progress, ai, size = "sm", short, onClick, className, ...rest },
  ref,
) {
  // #25: „Neschválená“ všude výrazně jako štítek schválení (jantarová + štít) — fialová by vypadala jako „Schválená“
  const pendingApproval = meta.phase === "quote" && meta.key === "ke_schvaleni";
  const Icon = pendingApproval ? ShieldAlert : meta.icon;
  const text = short ? meta.short : label ?? meta.label;
  const classes = cn(
    CHIP_BASE,
    pendingApproval ? APPROVAL_TONE.pending : FLOW_PALETTE[meta.palette].badge,
    size === "xs" && "px-1.5 text-[11px]",
    onClick && "cursor-pointer transition-opacity hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
    className,
  );
  const body = (
    <>
      <Icon className={CHIP_ICON} aria-hidden />
      <span className="truncate">{text}</span>
      {ai && <span aria-label="AI" title="Připravila AI">✨</span>}
      {hint && <span className="font-normal opacity-80">· {hint}</span>}
      {progress && <ProgressPill progress={progress} hue={pillHueOf(meta.palette)} className="ml-0.5" />}
    </>
  );
  const title = [label ?? meta.label, hint, progress?.label].filter(Boolean).join(" · ");
  if (onClick) {
    return (
      <button ref={ref} type="button" onClick={onClick} className={classes} title={meta.description} aria-label={title} {...rest}>
        {body}
      </button>
    );
  }
  return (
    <span ref={ref} className={classes} title={meta.description} {...rest}>
      {body}
    </span>
  );
});

/** Chip z PhaseChip (primaryChip, phaseTrail). */
export function FlowStatusChip({
  chip, size, short, onClick, className,
}: {
  chip: PhaseChip;
  size?: "sm" | "xs";
  short?: boolean;
  onClick?: (e: React.MouseEvent<HTMLButtonElement>) => void;
  className?: string;
}) {
  return (
    <StateChip
      meta={chip.meta}
      label={chip.label}
      hint={chip.hint}
      progress={chip.progress}
      ai={chip.ai}
      size={size}
      short={short}
      onClick={onClick}
      className={className}
    />
  );
}
