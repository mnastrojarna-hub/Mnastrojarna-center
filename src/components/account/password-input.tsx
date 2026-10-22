"use client";

import * as React from "react";
import { Eye, EyeOff } from "lucide-react";
import { Input } from "@/components/ui/input";
import { passwordStrength, MIN_PASSWORD_LENGTH } from "@/components/users/password-tools";
import { cn } from "@/lib/utils";

/** Pole pro heslo s tlačítkem Zobrazit / Skrýt a volitelným ukazatelem síly. */
export const PasswordInput = React.forwardRef<
  HTMLInputElement,
  Omit<React.InputHTMLAttributes<HTMLInputElement>, "type"> & {
    showStrength?: boolean;
    /** Řízené zobrazení (např. heslo + potvrzení zároveň). */
    visible?: boolean;
    onVisibleChange?: (v: boolean) => void;
  }
>(({ className, showStrength, visible, onVisibleChange, ...props }, ref) => {
  const [ownVisible, setOwnVisible] = React.useState(false);
  const shown = visible ?? ownVisible;
  const toggle = () => {
    const v = !shown;
    if (onVisibleChange) onVisibleChange(v);
    else setOwnVisible(v);
  };
  const value = typeof props.value === "string" ? props.value : "";
  const strength = passwordStrength(value);

  return (
    <div className="space-y-1.5">
      <div className="relative">
        <Input
          ref={ref}
          type={shown ? "text" : "password"}
          className={cn("pr-10", className)}
          autoCapitalize="none"
          autoCorrect="off"
          spellCheck={false}
          {...props}
        />
        <button
          type="button"
          onClick={toggle}
          className="absolute inset-y-0 right-0 flex w-10 items-center justify-center rounded-r-md text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          aria-label={shown ? "Skrýt heslo" : "Zobrazit heslo"}
          title={shown ? "Skrýt heslo" : "Zobrazit heslo"}
          tabIndex={-1}
        >
          {shown ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
        </button>
      </div>
      {showStrength && (
        <div className="flex items-center gap-2">
          <div className="flex flex-1 gap-1" aria-hidden>
            {[1, 2, 3, 4].map((i) => (
              <div
                key={i}
                className={cn(
                  "h-1.5 flex-1 rounded-full transition-colors",
                  strength.score >= i ? strength.color : "bg-muted",
                )}
              />
            ))}
          </div>
          <span className="w-28 text-right text-[11px] text-muted-foreground">
            {value ? strength.label : `min. ${MIN_PASSWORD_LENGTH} znaků`}
          </span>
        </div>
      )}
    </div>
  );
});
PasswordInput.displayName = "PasswordInput";
