"use client";

import * as React from "react";
import { cn } from "@/lib/utils";

/**
 * Drobné stavební kameny formulářů adresáře (zákazníci, dodavatelé):
 * pole s popiskem, nápovědou a chybou + barevná hlavička sekce.
 */

export function Field({
  id,
  label,
  required,
  hint,
  error,
  className,
  children,
}: {
  id: string;
  label: string;
  required?: boolean;
  hint?: React.ReactNode;
  error?: string;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <div className={cn("space-y-1.5", className)}>
      <label htmlFor={id} className="text-sm font-medium">
        {label}
        {required && <span className="text-destructive"> *</span>}
      </label>
      {children}
      {error ? (
        <p id={`${id}-error`} className="text-xs font-medium text-destructive">{error}</p>
      ) : hint ? (
        <p className="text-xs text-muted-foreground">{hint}</p>
      ) : null}
    </div>
  );
}

export function FormSection({
  icon,
  tone,
  title,
  hint,
  children,
}: {
  icon: React.ReactNode;
  /** Třídy kroužku ikony (pozadí + text). */
  tone: string;
  title: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <section className="space-y-3">
      <div className="flex items-center gap-2.5">
        <span className={cn("flex h-7 w-7 shrink-0 items-center justify-center rounded-lg [&_svg]:h-4 [&_svg]:w-4", tone)}>{icon}</span>
        <div className="min-w-0">
          <h3 className="text-sm font-semibold leading-tight">{title}</h3>
          {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
        </div>
      </div>
      {/* grid-cols-1 = minmax(0, 1fr): dlouhý obsah (e-mail v řádku) sloupec na mobilu nerozšíří */}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">{children}</div>
    </section>
  );
}

/** Nativní výběr ve stylu Input (na mobilu systémový seznam). */
export const SelectInput = React.forwardRef<HTMLSelectElement, React.SelectHTMLAttributes<HTMLSelectElement>>(
  function SelectInput({ className, children, ...props }, ref) {
    return (
      <select
        ref={ref}
        className={cn(
          "flex h-9 w-full cursor-pointer rounded-md border border-input bg-background px-3 py-1 text-sm shadow-sm transition-colors",
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 focus-visible:ring-offset-background disabled:cursor-not-allowed disabled:opacity-50",
          className,
        )}
        {...props}
      >
        {children}
      </select>
    );
  },
);
