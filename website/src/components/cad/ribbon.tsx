"use client";

import { useEffect, useRef, useState } from "react";
import { cn } from "@/lib/cn";
import { CadIcon, type CadIconName, type Tone } from "./cad-icons";

export type RItem = {
  id: string;
  label: string;
  icon: CadIconName;
  tone?: Tone;
  onClick?: () => void;
  active?: boolean;
  disabled?: boolean;
  kbd?: string;
  hint?: string;
  /** rozbalovací nabídka */
  menu?: RMenuEntry[];
};
export type RMenuEntry = RItem | { divider: true; label?: string };
/** Skupina pásu: první `big` položek jsou velká tlačítka, zbytek malá ve sloupcích po třech. */
export type RGroup = { label: string; big?: number; items: RItem[] };

/** Pás karet (ribbon) – velká a malá tlačítka, rozbalovací nabídky, popisky skupin. */
export function Ribbon({ groups, right }: { groups: RGroup[]; right?: React.ReactNode }) {
  return (
    <div className="flex h-[92px] shrink-0 items-stretch overflow-x-auto border-b border-[#d5dbe2] bg-gradient-to-b from-[#fbfcfd] to-[#eef2f6] px-1 [scrollbar-width:thin]">
      {groups.map((g) => {
        const big = g.items.slice(0, g.big ?? g.items.length);
        const small = g.items.slice(g.big ?? g.items.length);
        const cols: RItem[][] = [];
        for (let i = 0; i < small.length; i += 3) cols.push(small.slice(i, i + 3));
        return (
          <div key={g.label} className="flex shrink-0 flex-col border-r border-[#d5dbe2] px-1.5 pt-1.5 last:border-r-0">
            <div className="flex flex-1 items-start gap-0.5">
              {big.map((it) => (
                <BigBtn key={it.id} it={it} />
              ))}
              {cols.map((c, i) => (
                <div key={i} className="flex flex-col gap-px">
                  {c.map((it) => (
                    <SmallBtn key={it.id} it={it} />
                  ))}
                </div>
              ))}
            </div>
            <p className="pb-1 pt-0.5 text-center text-[10px] text-[#6b7785]">{g.label}</p>
          </div>
        );
      })}
      <div className="flex-1" />
      {right}
    </div>
  );
}

function useMenu() {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    };
    window.addEventListener("pointerdown", close);
    return () => window.removeEventListener("pointerdown", close);
  }, [open]);
  return { open, setOpen, ref };
}

function tip(it: RItem) {
  return [it.label, it.kbd ? `(${it.kbd})` : "", it.hint ? `– ${it.hint}` : ""].filter(Boolean).join(" ");
}

function BigBtn({ it }: { it: RItem }) {
  const m = useMenu();
  return (
    <div ref={m.ref} className="relative">
      <button
        type="button"
        disabled={it.disabled}
        title={tip(it)}
        onClick={() => (it.menu ? m.setOpen(!m.open) : it.onClick?.())}
        className={cn(
          "flex h-[64px] w-[62px] flex-col items-center justify-start gap-1 rounded-md px-1 pt-1.5 text-[11px] leading-[1.1] text-[#26303b] transition disabled:opacity-35",
          it.active ? "bg-[#fde3e1] ring-1 ring-brand/40" : "hover:bg-[#e3e9f0]",
        )}
      >
        <CadIcon name={it.icon} tone={it.tone} className="h-7 w-7" />
        <span className="line-clamp-2 text-center">
          {it.label}
          {it.menu && <span className="ml-0.5 inline-block text-[8px] text-[#6b7785]">▼</span>}
        </span>
      </button>
      {it.menu && m.open && <Dropdown entries={it.menu} close={() => m.setOpen(false)} />}
    </div>
  );
}

function SmallBtn({ it }: { it: RItem }) {
  const m = useMenu();
  return (
    <div ref={m.ref} className="relative">
      <button
        type="button"
        disabled={it.disabled}
        title={tip(it)}
        onClick={() => (it.menu ? m.setOpen(!m.open) : it.onClick?.())}
        className={cn(
          "flex h-[21px] w-full min-w-[96px] items-center gap-1.5 whitespace-nowrap rounded px-1.5 text-left text-[11.5px] text-[#26303b] transition disabled:opacity-35",
          it.active ? "bg-[#fde3e1] ring-1 ring-brand/40" : "hover:bg-[#e3e9f0]",
        )}
      >
        <CadIcon name={it.icon} tone={it.tone} className="h-4 w-4 shrink-0" />
        <span className="flex-1">{it.label}</span>
        {it.menu && <span className="text-[8px] text-[#6b7785]">▼</span>}
      </button>
      {it.menu && m.open && <Dropdown entries={it.menu} close={() => m.setOpen(false)} />}
    </div>
  );
}

export function Dropdown({ entries, close, className }: { entries: RMenuEntry[]; close: () => void; className?: string }) {
  return (
    <div className={cn("absolute left-0 top-full z-50 mt-0.5 min-w-[220px] rounded-md border border-[#cfd6de] bg-white py-1 shadow-[0_12px_32px_-8px_rgba(15,23,42,.35)]", className)}>
      {entries.map((e, i) =>
        "divider" in e ? (
          <div key={i} className="my-1 border-t border-[#e6eaef]">
            {e.label && <p className="px-3 pb-0.5 pt-1.5 text-[10px] font-semibold uppercase tracking-wider text-[#8a95a3]">{e.label}</p>}
          </div>
        ) : (
          <button
            key={e.id}
            type="button"
            disabled={e.disabled}
            onClick={() => {
              close();
              e.onClick?.();
            }}
            className={cn("flex w-full items-center gap-2.5 px-3 py-1.5 text-left text-[12.5px] text-[#26303b] hover:bg-[#eaf0f6] disabled:opacity-40", e.active && "font-semibold text-brand")}
          >
            <CadIcon name={e.icon} tone={e.tone} className="h-4 w-4 shrink-0" />
            <span className="flex-1">{e.label}</span>
            {e.kbd && <span className="font-mono text-[10px] text-[#8a95a3]">{e.kbd}</span>}
          </button>
        ),
      )}
    </div>
  );
}

/** Plovoucí kontextové menu (pravé tlačítko). */
export function ContextMenu({ x, y, entries, close }: { x: number; y: number; entries: RMenuEntry[]; close: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ x, y });
  useEffect(() => {
    const el = ref.current;
    if (el) {
      const r = el.getBoundingClientRect();
      setPos({ x: Math.min(x, window.innerWidth - r.width - 8), y: Math.min(y, window.innerHeight - r.height - 8) });
    }
    const off = (e: Event) => {
      if (!ref.current?.contains(e.target as Node)) close();
    };
    const esc = (e: KeyboardEvent) => e.key === "Escape" && close();
    window.addEventListener("pointerdown", off);
    window.addEventListener("keydown", esc);
    window.addEventListener("wheel", close, { passive: true });
    return () => {
      window.removeEventListener("pointerdown", off);
      window.removeEventListener("keydown", esc);
      window.removeEventListener("wheel", close);
    };
  }, [x, y, close]);
  return (
    <div ref={ref} className="fixed z-[60]" style={{ left: pos.x, top: pos.y }} onContextMenu={(e) => e.preventDefault()}>
      <Dropdown entries={entries} close={close} className="relative left-auto top-auto mt-0" />
    </div>
  );
}
