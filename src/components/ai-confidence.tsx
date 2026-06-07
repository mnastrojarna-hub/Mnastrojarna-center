import { Sparkles } from "lucide-react";
import { cn } from "@/lib/utils";

export function AiConfidence({ value, className }: { value: number; className?: string }) {
  const pct = Math.round(value * 100);
  const tone =
    pct >= 95 ? "text-success" : pct >= 85 ? "text-primary" : "text-warning";
  return (
    <span className={cn("inline-flex items-center gap-1 text-xs font-medium", tone, className)}>
      <Sparkles className="h-3 w-3" />
      {pct}% AI
    </span>
  );
}
