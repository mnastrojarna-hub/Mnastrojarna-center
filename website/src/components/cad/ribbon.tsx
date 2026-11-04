"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
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
    <div className="flex h-[108px] shrink-0 items-stretch overflow-x-auto overflow-y-hidden overscroll-x-contain border-b border-[#d5dbe2] bg-gradient-to-b from-[#fbfcfd] to-[#eef2f6] px-1 [scrollbar-width:thin] [touch-action:pan-x]">
      {groups.map((g) => {
        const big = g.items.slice(0, g.big ?? g.items.length);
        const small = g.items.slice(g.big ?? g.items.length);
        const cols: RItem[][] = [];
        for (let i = 0; i < small.length; i += 3) cols.push(small.slice(i, i + 3));
        return (
          <div key={g.label} data-ribbon-group={g.label} className="flex shrink-0 flex-col border-r border-[#d5dbe2] px-1.5 pt-1.5 last:border-r-0">
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
            {/* název skupiny (Skica, Tvar, Vazby, Kóty…) – čitelný, ne jen šedá drobná poznámka */}
            <p className="mt-0.5 border-t border-[#d5dbe2]/80 pb-1 pt-1 text-center text-[12px] font-semibold tracking-wide text-[#3f4a57]">{g.label}</p>
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
      const t = e.target as Node | null;
      if (ref.current?.contains(t)) return;
      if (t instanceof Element && t.closest("[data-cad-menu]")) return; // nabídka v portálu
      setOpen(false);
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
          "flex h-[70px] w-[72px] flex-col items-center justify-start gap-1 rounded-md px-1 pt-1.5 text-[12.5px] font-medium leading-[1.15] text-[#26303b] transition disabled:opacity-35",
          it.active ? "bg-[#fde3e1] ring-1 ring-brand/40" : "hover:bg-[#e3e9f0]",
        )}
      >
        <CadIcon name={it.icon} tone={it.tone} className="h-7 w-7" />
        <span className="line-clamp-2 text-center">
          {it.label}
          {it.menu && <span className="ml-0.5 inline-block text-[8px] text-[#6b7785]">▼</span>}
        </span>
      </button>
      {it.menu && m.open && <Dropdown entries={it.menu} close={() => m.setOpen(false)} anchor={m.ref.current} />}
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
          "flex h-[23px] w-full min-w-[110px] items-center gap-1.5 whitespace-nowrap rounded px-1.5 text-left text-[12.5px] text-[#26303b] transition disabled:opacity-35",
          it.active ? "bg-[#fde3e1] ring-1 ring-brand/40" : "hover:bg-[#e3e9f0]",
        )}
      >
        <CadIcon name={it.icon} tone={it.tone} className="h-4 w-4 shrink-0" />
        <span className="flex-1">{it.label}</span>
        {it.menu && <span className="text-[8px] text-[#6b7785]">▼</span>}
      </button>
      {it.menu && m.open && <Dropdown entries={it.menu} close={() => m.setOpen(false)} anchor={m.ref.current} />}
    </div>
  );
}

export function Dropdown({ entries, close, className, anchor }: { entries: RMenuEntry[]; close: () => void; className?: string; anchor?: HTMLElement | null }) {
  const list = entries.map((e, i) =>
    "divider" in e ? (
      <div key={i} className="my-1 border-t border-[#e6eaef]">
        {e.label && <p className="px-3 pb-0.5 pt-1.5 text-[11px] font-semibold uppercase tracking-wider text-[#6b7785]">{e.label}</p>}
      </div>
    ) : (
      <button
        key={e.id}
        type="button"
        disabled={e.disabled}
        title={e.hint}
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
  );
  if (!anchor) {
    return <div className={cn("absolute left-0 top-full z-50 mt-0.5 min-w-[220px] rounded-md border border-[#cfd6de] bg-white py-1 shadow-[0_12px_32px_-8px_rgba(15,23,42,.35)]", className)}>{list}</div>;
  }
  return (
    <Floating anchor={anchor} close={close}>
      {list}
    </Floating>
  );
}

/** Plovoucí nabídka v portálu (mimo posuvný/oříznutý pás): na počítači pod tlačítkem a vždy uvnitř okna,
 *  na úzkém displeji (mobil) jako spodní list přes celou šířku s velkými cíli pro dotyk. */
function Floating({ anchor, close, children }: { anchor: HTMLElement; close: () => void; children: React.ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  const closeRef = useRef(close);
  closeRef.current = close;
  const [pos, setPos] = useState<{ left: number; top: number } | "sheet" | null>(null);
  useLayoutEffect(() => {
    const place = () => {
      if (window.innerWidth < 640) return setPos("sheet");
      const r = anchor.getBoundingClientRect();
      const w = ref.current?.offsetWidth ?? 240;
      const h = ref.current?.offsetHeight ?? 200;
      const left = Math.max(8, Math.min(r.left, window.innerWidth - w - 8));
      let top = r.bottom + 2;
      if (top + h > window.innerHeight - 8) top = Math.max(8, r.top - h - 2);
      setPos({ left, top });
    };
    place();
    const onScroll = (e: Event) => {
      // při posunu pásu/okna nabídku přemístit k tlačítku; zavřít jen když tlačítko zmizí z obrazovky
      const t = e.target as Node | Document | null;
      if (!t || ref.current?.contains(t as Node)) return;
      const scrolled = t instanceof Document ? t.documentElement : (t as Node);
      if (!scrolled.contains(anchor)) return;
      const r = anchor.getBoundingClientRect();
      if (r.bottom < 0 || r.top > window.innerHeight || r.right < 0 || r.left > window.innerWidth) closeRef.current();
      else place();
    };
    const esc = (e: KeyboardEvent) => e.key === "Escape" && closeRef.current();
    window.addEventListener("resize", place);
    window.addEventListener("scroll", onScroll, true);
    window.addEventListener("keydown", esc);
    return () => {
      window.removeEventListener("resize", place);
      window.removeEventListener("scroll", onScroll, true);
      window.removeEventListener("keydown", esc);
    };
  }, [anchor]);
  if (typeof document === "undefined") return null;
  if (pos === "sheet") {
    return createPortal(
      <>
        <div className="fixed inset-0 z-[94] bg-black/30" aria-hidden />
        <div
          ref={ref}
          data-cad-menu
          role="menu"
          className="fixed inset-x-0 bottom-0 z-[95] max-h-[70vh] overflow-y-auto rounded-t-2xl border-t border-[#cfd6de] bg-white pb-[max(8px,env(safe-area-inset-bottom))] shadow-[0_-12px_32px_-8px_rgba(15,23,42,.35)]"
        >
          <div className="mx-auto mb-1 mt-2 h-1 w-10 rounded-full bg-[#cfd6de]" />
          <div className="py-1 [&_button]:min-h-[44px] [&_button]:text-[14px]">{children}</div>
          <button type="button" onClick={close} className="mx-3 mt-1 h-11 w-[calc(100%-24px)] rounded-lg bg-[#eef2f6] text-[14px] font-medium text-[#26303b]">
            Zavřít
          </button>
        </div>
      </>,
      document.body,
    );
  }
  return createPortal(
    <div
      ref={ref}
      data-cad-menu
      role="menu"
      className="fixed z-[95] max-h-[calc(100vh-16px)] min-w-[220px] overflow-y-auto rounded-md border border-[#cfd6de] bg-white py-1 shadow-[0_12px_32px_-8px_rgba(15,23,42,.35)]"
      style={pos ? { left: pos.left, top: pos.top } : { left: 0, top: 0, visibility: "hidden" }}
    >
      {children}
    </div>,
    document.body,
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
    <div
      ref={ref}
      className="fixed z-[60]"
      style={{ left: pos.x, top: pos.y }}
      onContextMenu={(e) => e.preventDefault()}
    >
      <Dropdown entries={entries} close={close} className="relative left-auto top-auto mt-0" />
    </div>
  );
}

/** Kontextová mini lišta u kurzoru (jako v ZW3D/SolidWorks): nejčastější příkazy pro vybranou entitu na jeden klik. */
export function HudBar({ x, y, entries, onMore, onClose, max = 4 }: { x: number; y: number; entries: RMenuEntry[]; onMore: () => void; onClose: () => void; max?: number }) {
  const items = entries.filter((e): e is RItem => !("divider" in e) && !e.disabled).slice(0, max);
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ left: x + 12, top: y + 14 });
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const w = el.offsetWidth;
    const h = el.offsetHeight;
    setPos({ left: Math.max(8, Math.min(x + 12, window.innerWidth - w - 8)), top: y + 14 + h > window.innerHeight - 8 ? Math.max(8, y - h - 10) : y + 14 });
  }, [x, y]);
  if (!items.length) return null;
  return (
    <div
      ref={ref}
      data-cad-menu
      role="toolbar"
      aria-label="Rychlé příkazy pro výběr"
      className="fixed z-[58] flex items-center gap-0.5 rounded-lg border border-[#cfd6de] bg-white/95 p-1 shadow-[0_8px_24px_-8px_rgba(15,23,42,.35)] backdrop-blur"
      style={pos}
      onPointerDown={(e) => e.stopPropagation()}
    >
      {items.map((it) => (
        <button
          key={it.id}
          type="button"
          title={tip(it)}
          onClick={() => {
            onClose();
            it.onClick?.();
          }}
          className="flex h-8 items-center gap-1.5 rounded-md px-2 text-[12.5px] text-[#26303b] hover:bg-[#e3e9f0]"
        >
          <CadIcon name={it.icon} tone={it.tone} className="h-5 w-5" />
          <span className="hidden sm:inline">{it.label}</span>
        </button>
      ))}
      <button type="button" title="Další příkazy (pravé tlačítko)" onClick={onMore} className="h-8 rounded-md px-2 text-[14px] leading-none text-[#6b7785] hover:bg-[#e3e9f0]">
        ⋯
      </button>
    </div>
  );
}
