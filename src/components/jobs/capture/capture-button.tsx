"use client";

// DOČASNÝ STUB — plnou implementaci (dialog s fotoaparátem, AI čtení, párování,
// ruční vyplnění) dodá modul „capture". Rozhraní (props) je závazné.

import { Camera } from "lucide-react";
import { Button, type ButtonProps } from "@/components/ui/button";

export interface CaptureButtonProps {
  /** Nahrát doklad ke konkrétní zakázce (detail). Bez jobId = AI zakázku najde / založí. */
  jobId?: string;
  label?: string;
  variant?: ButtonProps["variant"];
  size?: ButtonProps["size"];
  className?: string;
  /** Otevřít dialog hned po načtení (např. /orders?capture=1 z mobilní lišty). */
  autoOpen?: boolean;
}

export function CaptureButton({ label = "Vyfotit doklad", variant = "send", size, className }: CaptureButtonProps) {
  return (
    <Button type="button" variant={variant} size={size} className={className} disabled>
      <Camera className="h-4 w-4" /> {label}
    </Button>
  );
}
