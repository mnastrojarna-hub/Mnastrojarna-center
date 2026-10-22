import * as React from "react";
import { ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * Nativní výběr ve stylu aplikace — na mobilu otevře systémový seznam
 * (velké cíle, žádné překrývání), na desktopu funguje klávesnicí.
 */
export const NativeSelect = React.forwardRef<
  HTMLSelectElement,
  React.SelectHTMLAttributes<HTMLSelectElement> & {
    icon?: React.ReactNode;
    /** Zvýraznit (aktivní filtr). */
    active?: boolean;
    wrapperClassName?: string;
  }
>(function NativeSelect({ icon, active, className, wrapperClassName, children, ...props }, ref) {
  return (
    <div className={cn("relative flex w-full min-w-0 items-center", wrapperClassName)}>
      {icon && (
        <span className="pointer-events-none absolute left-2.5 flex items-center text-muted-foreground [&_svg]:h-4 [&_svg]:w-4">
          {icon}
        </span>
      )}
      <select
        ref={ref}
        className={cn(
          "h-9 w-full min-w-0 cursor-pointer appearance-none truncate rounded-md border border-input bg-background pr-8 text-sm shadow-sm transition-colors",
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 focus-visible:ring-offset-background disabled:cursor-not-allowed disabled:opacity-50",
          icon ? "pl-8" : "pl-3",
          active && "border-primary/40 bg-accent font-medium text-accent-foreground",
          className,
        )}
        {...props}
      >
        {children}
      </select>
      <ChevronDown className="pointer-events-none absolute right-2.5 h-4 w-4 text-muted-foreground" />
    </div>
  );
});
