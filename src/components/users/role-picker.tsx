"use client";

import { Crown, Briefcase, Wrench, Check } from "lucide-react";
import { ROLE_LABELS, ROLE_DESCRIPTIONS } from "@/lib/auth/permissions";
import { ROLE_ORDER, ROLE_STYLES } from "@/components/users/user-style";
import type { UserRole } from "@/lib/supabase/database.types";
import { cn } from "@/lib/utils";

const ROLE_ICONS: Record<UserRole, React.ComponentType<{ className?: string }>> = {
  super_admin: Crown,
  obchodnik: Briefcase,
  zamestnanec: Wrench,
};

/** Výběr role jako barevné karty s vysvětlením, co role vidí. */
export function RolePicker({
  value,
  onChange,
  disabled,
  name = "role",
}: {
  value: UserRole;
  onChange: (role: UserRole) => void;
  disabled?: boolean;
  name?: string;
}) {
  return (
    <div role="radiogroup" aria-label="Role" className="grid gap-2">
      {ROLE_ORDER.map((role) => {
        const Icon = ROLE_ICONS[role];
        const selected = value === role;
        const style = ROLE_STYLES[role];
        return (
          <label
            key={role}
            className={cn(
              "flex cursor-pointer items-start gap-3 rounded-lg border p-3 transition-colors",
              selected ? style.soft : "hover:bg-muted/60",
              selected && "ring-1 ring-inset",
              selected && role === "super_admin" && "ring-primary/40",
              selected && role === "obchodnik" && "ring-blue-500/40",
              selected && role === "zamestnanec" && "ring-emerald-500/40",
              disabled && "cursor-not-allowed opacity-60",
            )}
          >
            <input
              type="radio"
              name={name}
              value={role}
              checked={selected}
              onChange={() => onChange(role)}
              disabled={disabled}
              className="sr-only"
            />
            <span className={cn("flex h-8 w-8 shrink-0 items-center justify-center rounded-md", style.badge)}>
              <Icon className="h-4 w-4" />
            </span>
            <span className="min-w-0 flex-1">
              <span className={cn("block text-sm font-semibold", selected && style.text)}>{ROLE_LABELS[role]}</span>
              <span className="block text-xs text-muted-foreground">{ROLE_DESCRIPTIONS[role]}</span>
            </span>
            <span
              className={cn(
                "mt-1 flex h-4 w-4 shrink-0 items-center justify-center rounded-full border",
                selected ? cn("border-transparent text-white", style.dot) : "border-input",
              )}
              aria-hidden
            >
              {selected && <Check className="h-3 w-3" />}
            </span>
          </label>
        );
      })}
    </div>
  );
}
