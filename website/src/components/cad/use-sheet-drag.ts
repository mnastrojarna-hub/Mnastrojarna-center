"use client";

/**
 * Spodní list na mobilu – tažení dolů (dotyk i myš/pero), Zpět, Esc. Logika rozhodnutí je v sheet-drag.ts,
 * tady jsou jen posluchače DOM. Použití: bottom-sheet.tsx (BottomSheet, SheetAside) – žádné kopie jinde.
 *
 * - Úchyt a záhlaví (prvky s `data-sheet-grip`) táhnou list vždy; obsah jen dolů a jen když je posunutý nahoře,
 *   jinak se obsah normálně posouvá.
 * - List jde za prstem; po puštění se zavře (≥ 25 % výšky nebo rychlé švihnutí), jinak se vrátí na místo.
 * - Stav pro testy a styly: `data-sheet-drag` = „drag“ | „snap“ | „closing“ na prvku listu.
 */
import { useEffect, useRef, type RefObject } from "react";
import { SheetVelocity, sheetGestureStart, sheetOffset, sheetRelease, sheetStack } from "./sheet-drag";

const CLOSE_MS = 180;
const SNAP_MS = 200;

/** všechny posuvné prvky od místa dotyku po list (včetně) jsou nahoře */
function scrolledTop(target: Element | null, sheet: HTMLElement): boolean {
  for (let el: Element | null = target; el; el = el.parentElement) {
    if (el instanceof HTMLElement && el.scrollHeight > el.clientHeight + 1) {
      const oy = getComputedStyle(el).overflowY;
      if ((oy === "auto" || oy === "scroll") && el.scrollTop > 0) return false;
    }
    if (el === sheet) break;
  }
  return true;
}

/** pole formuláře v obsahu: tažení z něj patří poli (posuvník, výběr textu) */
const FIELD = "input, textarea, select, [contenteditable=true], [data-sheet-nodrag]";

export function useSheetDrag(opts: {
  /** zapnuto (např. jen na úzkém displeji) */
  enabled: boolean;
  sheetRef: RefObject<HTMLElement | null>;
  backdropRef?: RefObject<HTMLElement | null>;
  onClose: () => void;
  /** Esc zavře list (vypnout, když Esc obsluhuje už aplikace) */
  esc?: boolean;
  /** systémové Zpět zavře list (záznam v historii prohlížeče) */
  back?: boolean;
}) {
  const { enabled, sheetRef, backdropRef, esc = true, back = true } = opts;
  const closeRef = useRef(opts.onClose);
  closeRef.current = opts.onClose;

  // Zpět (historie) – jeden sdílený zásobník listů
  const releaseRef = useRef<(() => void) | null>(null);
  useEffect(() => {
    if (!enabled || !back || typeof window === "undefined") return;
    const release = sheetStack().open({ close: () => closeRef.current() });
    releaseRef.current = release;
    return () => {
      releaseRef.current = null;
      release();
    };
  }, [enabled, back]);

  // Esc
  useEffect(() => {
    if (!enabled || !esc) return;
    const on = (e: KeyboardEvent) => e.key === "Escape" && closeRef.current();
    window.addEventListener("keydown", on);
    return () => window.removeEventListener("keydown", on);
  }, [enabled, esc]);

  // tažení
  useEffect(() => {
    const sheet = sheetRef.current;
    if (!enabled || !sheet) return;
    type G = { x: number; y: number; mode: "pending" | "drag"; fromGrip: boolean; top: boolean; v: SheetVelocity; dy: number; pointer?: number };
    let g: G | null = null;
    let closing = false;
    let timer: ReturnType<typeof setTimeout> | undefined;

    const setOffset = (dy: number) => {
      const off = sheetOffset(dy);
      sheet.style.transform = off ? `translate3d(0, ${off}px, 0)` : "";
      const bd = backdropRef?.current;
      if (bd) bd.style.opacity = String(Math.max(0, 1 - Math.max(0, off) / Math.max(1, sheet.offsetHeight)));
    };
    const begin = (x: number, y: number, target: Element | null, pointer?: number): G | null => {
      if (closing) return null;
      const fromGrip = !!target?.closest("[data-sheet-grip]");
      if (!fromGrip && target?.closest(FIELD)) return null;
      return { x, y, mode: "pending", fromGrip, top: scrolledTop(target, sheet), v: new SheetVelocity(), dy: 0, pointer };
    };
    /** true = pohyb patří listu (volající zruší výchozí akci prohlížeče) */
    // t = čas události (Event.timeStamp – čas dotyku z hardwaru, nezávislý na zahlcení hlavního vlákna)
    const move = (x: number, y: number, t: number): boolean => {
      if (!g) return false;
      const dx = x - g.x;
      const dy = y - g.y;
      if (g.mode === "pending") {
        const d = sheetGestureStart({ fromGrip: g.fromGrip, scrolledTop: g.top }, dx, dy);
        if (d === "pending") return false;
        if (d === "native") {
          g = null;
          return false;
        }
        g.mode = "drag";
        g.y = y; // bez skoku o toleranci
        sheet.style.transition = "none";
        sheet.dataset.sheetDrag = "drag";
      }
      g.dy = y - g.y;
      g.v.add(t, y);
      setOffset(g.dy);
      return true;
    };
    const end = (cancel: boolean, t: number) => {
      const cur = g;
      g = null;
      if (!cur || cur.mode !== "drag") return;
      const act = cancel ? "snap" : sheetRelease(cur.dy, sheet.offsetHeight, cur.v.velocity(t));
      const bd = backdropRef?.current;
      if (act === "close") {
        closing = true;
        sheet.dataset.sheetDrag = "closing";
        sheet.style.transition = `transform ${CLOSE_MS}ms ease-in`;
        sheet.style.transform = `translate3d(0, ${sheet.offsetHeight + 24}px, 0)`;
        if (bd) {
          bd.style.transition = `opacity ${CLOSE_MS}ms ease-in`;
          bd.style.opacity = "0";
        }
        timer = setTimeout(() => closeRef.current(), CLOSE_MS);
      } else {
        sheet.dataset.sheetDrag = "snap";
        sheet.style.transition = `transform ${SNAP_MS}ms cubic-bezier(.2,.8,.2,1)`;
        sheet.style.transform = "";
        if (bd) {
          bd.style.transition = `opacity ${SNAP_MS}ms ease-out`;
          bd.style.opacity = "";
        }
        timer = setTimeout(() => {
          if (sheet.dataset.sheetDrag === "snap") delete sheet.dataset.sheetDrag;
          sheet.style.transition = "";
          if (bd) bd.style.transition = "";
        }, SNAP_MS);
      }
    };

    // dotyk: touchmove musí být „nepasivní“, aby šlo při tažení listu zastavit posun stránky / obnovení stažením
    const onTouchStart = (e: TouchEvent) => {
      if (e.touches.length !== 1) {
        if (g?.mode === "drag") end(true, e.timeStamp);
        g = null;
        return;
      }
      const t = e.touches[0];
      g = begin(t.clientX, t.clientY, e.target as Element | null);
    };
    const onTouchMove = (e: TouchEvent) => {
      if (!g || g.pointer !== undefined) return;
      const t = e.touches[0];
      if (t && move(t.clientX, t.clientY, e.timeStamp) && e.cancelable) e.preventDefault();
    };
    const onTouchEnd = (e: TouchEvent) => {
      if (g && g.pointer === undefined) end(e.type === "touchcancel", e.timeStamp);
    };
    // myš / pero: jen za úchyt nebo záhlaví (dotyk obsluhují touch* výše)
    const onPointerDown = (e: PointerEvent) => {
      if (e.pointerType === "touch" || e.button !== 0) return;
      const target = e.target as Element | null;
      if (!target?.closest("[data-sheet-grip]")) return;
      g = begin(e.clientX, e.clientY, target, e.pointerId);
    };
    const onPointerMove = (e: PointerEvent) => {
      if (!g || g.pointer !== e.pointerId) return;
      const was = g.mode;
      if (move(e.clientX, e.clientY, e.timeStamp) && was === "pending") sheet.setPointerCapture?.(e.pointerId);
    };
    const onPointerUp = (e: PointerEvent) => {
      if (!g || g.pointer !== e.pointerId) return;
      end(e.type === "pointercancel", e.timeStamp);
    };
    // klik po tažení myší (pustí se nad tlačítkem v záhlaví) nesmí nic spustit
    const onClickCapture = (e: MouseEvent) => {
      if (sheet.dataset.sheetDrag) {
        e.stopPropagation();
        e.preventDefault();
      }
    };

    sheet.addEventListener("touchstart", onTouchStart, { passive: true });
    sheet.addEventListener("touchmove", onTouchMove, { passive: false });
    sheet.addEventListener("touchend", onTouchEnd);
    sheet.addEventListener("touchcancel", onTouchEnd);
    sheet.addEventListener("pointerdown", onPointerDown);
    sheet.addEventListener("pointermove", onPointerMove);
    sheet.addEventListener("pointerup", onPointerUp);
    sheet.addEventListener("pointercancel", onPointerUp);
    sheet.addEventListener("click", onClickCapture, true);
    return () => {
      clearTimeout(timer);
      sheet.removeEventListener("touchstart", onTouchStart);
      sheet.removeEventListener("touchmove", onTouchMove);
      sheet.removeEventListener("touchend", onTouchEnd);
      sheet.removeEventListener("touchcancel", onTouchEnd);
      sheet.removeEventListener("pointerdown", onPointerDown);
      sheet.removeEventListener("pointermove", onPointerMove);
      sheet.removeEventListener("pointerup", onPointerUp);
      sheet.removeEventListener("pointercancel", onPointerUp);
      sheet.removeEventListener("click", onClickCapture, true);
      // list zůstává (např. přechod na širší displej): vrátit do klidové polohy
      sheet.style.transform = "";
      sheet.style.transition = "";
      delete sheet.dataset.sheetDrag;
    };
  }, [enabled, sheetRef, backdropRef]);
}
