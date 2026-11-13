"use client";

import { tr } from "@/cad/i18n";
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

/**
 * Pás karet (ribbon) – velká a malá tlačítka, rozbalovací nabídky, popisky skupin.
 *
 * Když se pás do šířky okna nevejde (karta Skica při 1430 px), zhušťuje se sám: nejdřív malá tlačítka bez pevné šířky,
 * potom malá tlačítka jen s ikonou (popisek zůstává v bublině). Teprve když nestačí ani to, objeví se po stranách šipky
 * pro posun (místo vodorovného posuvníku, který skupiny ořezával); posouvat lze i kolečkem myši.
 */
export function Ribbon({ groups, right }: { groups: RGroup[]; right?: React.ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  /** hustota: 0 = plná, 1 = malá tlačítka bez pevné šířky, 2 = malá tlačítka jen ikonou */
  const [level, setLevel] = useState<0 | 1 | 2>(0);
  const [edge, setEdge] = useState({ left: false, right: false });
  const key = groups.map((g) => `${g.label}:${g.items.length}`).join("|");
  const measureEdges = () => {
    const el = ref.current;
    if (!el) return;
    const left = el.scrollLeft > 1;
    const rightMore = el.scrollLeft + el.clientWidth < el.scrollWidth - 1;
    setEdge((e) => (e.left === left && e.right === rightMore ? e : { left, right: rightMore }));
  };
  // jiná karta / jiné skupiny → znovu od plné hustoty
  useLayoutEffect(() => setLevel(0), [key]);
  // po každém vykreslení: nevejde-li se obsah, zhustit (nejvýš na úroveň 2) – ještě před vykreslením na obrazovku
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (el.scrollWidth > el.clientWidth + 1 && level < 2) setLevel((level + 1) as 1 | 2);
    else measureEdges();
  });
  // změna šířky okna → přeměřit od plné hustoty
  useEffect(() => {
    const el = ref.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    let w = el.clientWidth;
    const ro = new ResizeObserver(() => {
      if (Math.abs(el.clientWidth - w) < 2) return;
      w = el.clientWidth;
      setLevel(0);
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  const scrollBy = (dir: 1 | -1) => ref.current?.scrollBy({ left: dir * Math.max(160, ref.current.clientWidth * 0.6), behavior: "smooth" });
  return (
    <div className="relative shrink-0" data-ribbon data-ribbon-density={level}>
      <div
        ref={ref}
        onScroll={measureEdges}
        onWheel={(e) => {
          // kolečko myši posouvá pás vodorovně (svislý posun pás nemá)
          const el = ref.current;
          if (el && el.scrollWidth > el.clientWidth && Math.abs(e.deltaY) > Math.abs(e.deltaX)) el.scrollLeft += e.deltaY;
        }}
        className="flex h-[108px] items-stretch overflow-x-auto overflow-y-hidden overscroll-x-contain border-b border-[#d5dbe2] bg-gradient-to-b from-[#fbfcfd] to-[#eef2f6] px-1 [scrollbar-width:none] [touch-action:pan-x] [&::-webkit-scrollbar]:hidden"
      >
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
                      <SmallBtn key={it.id} it={it} level={level} />
                    ))}
                  </div>
                ))}
              </div>
              {/* název skupiny (Skica, Tvar, Vazby, Kóty…) – čitelný, ne jen šedá drobná poznámka */}
              <p className="mt-0.5 whitespace-nowrap border-t border-[#d5dbe2]/80 pb-1 pt-1 text-center text-[12px] font-semibold tracking-wide text-[#3f4a57]">{g.label}</p>
            </div>
          );
        })}
        <div className="flex-1" />
        {right}
      </div>
      {edge.left && (
        <button type="button" data-ribbon-scroll="left" aria-label={tr("Posunout pás karet doleva")} title={tr("Posunout pás karet doleva")} onClick={() => scrollBy(-1)} className="absolute inset-y-0 left-0 z-10 flex w-6 items-center justify-center border-r border-[#d5dbe2] bg-gradient-to-r from-[#eef2f6] to-[#eef2f6]/85 text-[#3f4a57] hover:text-brand">
          ‹
        </button>
      )}
      {edge.right && (
        <button type="button" data-ribbon-scroll="right" aria-label={tr("Posunout pás karet doprava")} title={tr("Posunout pás karet doprava")} onClick={() => scrollBy(1)} className="absolute inset-y-0 right-0 z-10 flex w-6 items-center justify-center border-l border-[#d5dbe2] bg-gradient-to-l from-[#eef2f6] to-[#eef2f6]/85 text-[#3f4a57] hover:text-brand">
          ›
        </button>
      )}
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

function SmallBtn({ it, level = 0 }: { it: RItem; level?: 0 | 1 | 2 }) {
  const m = useMenu();
  return (
    <div ref={m.ref} className="relative">
      <button
        type="button"
        disabled={it.disabled}
        title={tip(it)}
        onClick={() => (it.menu ? m.setOpen(!m.open) : it.onClick?.())}
        className={cn(
          "flex h-[23px] w-full items-center gap-1.5 whitespace-nowrap rounded px-1.5 text-left text-[12.5px] text-[#26303b] transition disabled:opacity-35",
          level === 0 ? "min-w-[110px]" : "min-w-0",
          it.active ? "bg-[#fde3e1] ring-1 ring-brand/40" : "hover:bg-[#e3e9f0]",
        )}
        aria-label={it.label}
      >
        <CadIcon name={it.icon} tone={it.tone} className="h-4 w-4 shrink-0" />
        {/* při nejvyšší hustotě zůstává jen ikona; název je v bublině a pro čtečky obrazovky */}
        <span className={level === 2 ? "sr-only" : "flex-1"}>{it.label}</span>
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
            {tr("Zavřít")}
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
      aria-label={tr("Rychlé příkazy pro výběr")}
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
      <button type="button" title={tr("Další příkazy (pravé tlačítko)")} onClick={onMore} className="h-8 rounded-md px-2 text-[14px] leading-none text-[#6b7785] hover:bg-[#e3e9f0]">
        ⋯
      </button>
    </div>
  );
}
