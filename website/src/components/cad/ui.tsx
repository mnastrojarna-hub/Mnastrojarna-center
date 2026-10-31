"use client";

import { useEffect, useRef, useState } from "react";
import { cn } from "@/lib/cn";
import { CadIcon, type CadIconName, type Tone } from "./cad-icons";

/** Řádek „popisek : hodnota“ v panelech a dialozích. */
export function Row({ k, v, strong, mono = true }: { k: string; v: React.ReactNode; strong?: boolean; mono?: boolean }) {
  return (
    <div className="flex items-baseline justify-between gap-3 border-b border-[#edf1f5] py-1 text-[12px] last:border-0">
      <span className="text-[#6b7785]">{k}</span>
      <span className={cn("text-right", mono && "font-mono", strong ? "text-[14px] font-bold text-[#0b1f33]" : "text-[#26303b]")}>{v}</span>
    </div>
  );
}

/** Plovoucí panel v pracovní ploše (měření, řez, analýzy…). Lze přetahovat za záhlaví. */
export function FloatPanel({
  title,
  icon,
  tone = "tool",
  onClose,
  children,
  className,
  width = 272,
  initial = { x: 12, y: 12 },
}: {
  title: string;
  icon: CadIconName;
  tone?: Tone;
  onClose?: () => void;
  children: React.ReactNode;
  className?: string;
  width?: number;
  initial?: { x: number; y: number };
}) {
  const [pos, setPos] = useState(initial);
  const drag = useRef<{ dx: number; dy: number } | null>(null);
  return (
    <div className={cn("absolute z-20 rounded-md border border-[#cfd6de] bg-white/95 shadow-xl backdrop-blur", className)} style={{ left: pos.x, top: pos.y, width }}>
      <div
        className="flex cursor-move select-none items-center gap-2 border-b border-[#e3e8ee] px-3 py-1.5"
        onPointerDown={(e) => {
          drag.current = { dx: e.clientX - pos.x, dy: e.clientY - pos.y };
          (e.target as HTMLElement).setPointerCapture?.(e.pointerId);
        }}
        onPointerMove={(e) => drag.current && setPos({ x: Math.max(0, e.clientX - drag.current.dx), y: Math.max(0, e.clientY - drag.current.dy) })}
        onPointerUp={() => (drag.current = null)}
      >
        <CadIcon name={icon} tone={tone} className="h-4 w-4" />
        <p className="flex-1 text-[12.5px] font-semibold">{title}</p>
        {onClose && (
          <button type="button" onClick={onClose} className="rounded p-0.5 text-[#6b7785] hover:bg-[#eef2f6]" aria-label="Zavřít">
            <CadIcon name="x" className="h-3.5 w-3.5" />
          </button>
        )}
      </div>
      <div className="p-3">{children}</div>
    </div>
  );
}

/** Modální dialog. */
export function Modal({ title, icon, tone = "tool", onClose, children, width = "max-w-lg", footer }: { title: string; icon: CadIconName; tone?: Tone; onClose: () => void; children: React.ReactNode; width?: string; footer?: React.ReactNode }) {
  useEffect(() => {
    const esc = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", esc);
    return () => window.removeEventListener("keydown", esc);
  }, [onClose]);
  return (
    <div className="fixed inset-0 z-[70] grid place-items-center bg-[#0b1220]/40 p-4" onClick={onClose}>
      <div className={cn("flex max-h-[88vh] w-full flex-col rounded-lg border border-[#cfd6de] bg-white shadow-2xl", width)} onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center gap-2 rounded-t-lg border-b border-[#e3e8ee] bg-gradient-to-b from-[#f7f9fb] to-[#eef2f6] px-4 py-2.5">
          <CadIcon name={icon} tone={tone} className="h-5 w-5" />
          <p className="flex-1 text-[13.5px] font-semibold">{title}</p>
          <button type="button" onClick={onClose} className="rounded p-1 text-[#6b7785] hover:bg-[#e3e9f0]" aria-label="Zavřít">
            <CadIcon name="x" className="h-4 w-4" />
          </button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto p-4">{children}</div>
        {footer && <div className="flex items-center justify-end gap-2 rounded-b-lg border-t border-[#e3e8ee] bg-[#f7f9fb] px-4 py-2.5">{footer}</div>}
      </div>
    </div>
  );
}

export function Btn({ children, onClick, primary, danger, disabled, title, className }: { children: React.ReactNode; onClick?: () => void; primary?: boolean; danger?: boolean; disabled?: boolean; title?: string; className?: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={title}
      className={cn(
        "rounded px-3 py-1.5 text-[12.5px] font-medium transition disabled:opacity-40",
        primary ? "bg-brand text-white shadow hover:bg-brand-600" : danger ? "border border-brand/40 text-brand hover:bg-brand/5" : "border border-[#cfd6de] bg-white hover:bg-[#f3f6f9]",
        className,
      )}
    >
      {children}
    </button>
  );
}

export function Toggle({ label, checked, onChange, hint }: { label: string; checked: boolean; onChange: (v: boolean) => void; hint?: string }) {
  return (
    <label className="flex cursor-pointer items-start gap-3 py-1.5">
      <span className={cn("relative mt-0.5 inline-block h-[18px] w-[32px] shrink-0 rounded-full transition", checked ? "bg-brand" : "bg-[#c9d1da]")}>
        <input type="checkbox" className="sr-only" checked={checked} onChange={(e) => onChange(e.target.checked)} />
        <span className={cn("absolute top-[2px] h-[14px] w-[14px] rounded-full bg-white shadow transition", checked ? "left-[16px]" : "left-[2px]")} />
      </span>
      <span className="text-[12.5px] leading-snug">
        {label}
        {hint && <span className="block text-[11px] text-[#6b7785]">{hint}</span>}
      </span>
    </label>
  );
}

export function Field({ label, children, hint }: { label: string; children: React.ReactNode; hint?: string }) {
  return (
    <label className="block py-1.5">
      <span className="mb-1 flex items-baseline justify-between text-[11px] font-medium uppercase tracking-wider text-[#5b6776]">
        {label}
        {hint && <span className="normal-case tracking-normal text-[#8a95a3]">{hint}</span>}
      </span>
      {children}
    </label>
  );
}

export const inputCls = "w-full rounded border border-[#cfd6de] bg-white px-2.5 py-1.5 text-[13px] outline-none focus:border-brand focus:ring-2 focus:ring-brand/15";
export const selectCls = inputCls;

/** Segmentový přepínač. */
export function Segmented<T extends string | number | boolean>({ value, options, onChange, size = "md" }: { value: T; options: { v: T; l: string; title?: string }[]; onChange: (v: T) => void; size?: "sm" | "md" }) {
  return (
    <div className="flex rounded-md bg-[#eef2f6] p-0.5">
      {options.map((o) => (
        <button
          key={String(o.v)}
          type="button"
          title={o.title}
          onClick={() => onChange(o.v)}
          className={cn("flex-1 rounded px-2 font-medium transition", size === "sm" ? "py-0.5 text-[11.5px]" : "py-1 text-[12.5px]", value === o.v ? "bg-white text-[#1f2933] shadow-sm" : "text-[#5b6776] hover:text-[#1f2933]")}
        >
          {o.l}
        </button>
      ))}
    </div>
  );
}

/** Klávesová zkratka jako štítek. */
export function Kbd({ k }: { k: string }) {
  return (
    <span className="inline-flex gap-0.5">
      {k.split("+").map((p, i) => (
        <kbd key={i} className="rounded border border-[#cfd6de] bg-[#f7f9fb] px-1.5 py-px font-mono text-[10.5px] text-[#4a5664] shadow-[0_1px_0_#cfd6de]">
          {p}
        </kbd>
      ))}
    </span>
  );
}
