import { stageMeta } from "@/lib/jobs/stages";
import { FILE_KINDS } from "@/lib/jobs/file-kinds";
import type { JobStage, JobFileKind } from "@/lib/supabase/database.types";
import { cn } from "@/lib/utils";

/** Barevný odznak stavu zakázky (ikona + popisek). Sdílí kniha, detail i stránky toku. */
export function StageBadge({
  stage,
  size = "sm",
  short = false,
  className,
}: {
  stage: JobStage;
  size?: "xs" | "sm" | "md";
  short?: boolean;
  className?: string;
}) {
  const m = stageMeta(stage);
  const Icon = m.icon;
  return (
    <span
      title={m.description}
      className={cn(
        "inline-flex shrink-0 items-center gap-1 whitespace-nowrap rounded-full font-medium",
        size === "xs" && "px-1.5 py-0.5 text-[10px]",
        size === "sm" && "px-2 py-0.5 text-xs",
        size === "md" && "px-3 py-1 text-sm",
        m.badge,
        className,
      )}
    >
      <Icon className={cn(size === "md" ? "h-4 w-4" : "h-3 w-3")} />
      {short ? m.short : m.label}
    </span>
  );
}

/** Barevná tečka stavu. */
export function StageDot({ stage, className }: { stage: JobStage; className?: string }) {
  return <span className={cn("inline-block h-2.5 w-2.5 shrink-0 rounded-full", stageMeta(stage).dot, className)} />;
}

/** Barevný odznak druhu dokumentu zakázky. */
export function FileKindBadge({ kind, className }: { kind: JobFileKind; className?: string }) {
  const m = FILE_KINDS[kind] ?? FILE_KINDS.ostatni;
  const Icon = m.icon;
  return (
    <span className={cn("inline-flex shrink-0 items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium", m.badge, className)}>
      <Icon className="h-3 w-3" />
      {m.label}
    </span>
  );
}
