/**
 * Ovládání myší a dotykem jako v CAD (ZW3D):
 *  - kolečko = přiblížení / oddálení ke kurzoru,
 *  - prostřední tlačítko (nebo levé) tažením = otáčení kolem bodu pod kurzorem,
 *  - Shift / Ctrl + prostřední nebo levé, případně pravé tlačítko tažením = posun,
 *  - klik = výběr / měření, pravý klik = místní nabídka, dvojklik do prázdna = zobrazit vše,
 *  - dotyk: 1 prst otáčí, 2 prsty posun + přiblížení (pinch), ťuknutí = výběr, podržení = nabídka.
 */

export interface ControlsHandlers {
  beginRotate(x: number, y: number): void;
  rotate(dx: number, dy: number): void;
  pan(dx: number, dy: number): void;
  zoomAt(factor: number, x: number, y: number): void;
  endInteraction(): void;
  tap(x: number, y: number, info: { touch: boolean; additive: boolean; alt: boolean }): void;
  doubleTap(x: number, y: number): void;
  hover(x: number, y: number, info: { alt: boolean }): void;
  leave(): void;
  contextMenu(x: number, y: number, clientX: number, clientY: number): void;
}

interface Ptr {
  id: number;
  x: number;
  y: number;
  sx: number;
  sy: number;
  button: number;
  touch: boolean;
  t: number;
}

type DragMode = "rotate" | "pan" | null;

const DRAG_PX_MOUSE = 4;
const DRAG_PX_TOUCH = 9;

export class CadControls {
  private ptrs = new Map<number, Ptr>();
  private dragging = false;
  private mode: DragMode = null;
  private pinch: { dist: number; mx: number; my: number } | null = null;
  private longPress: number | null = null;
  private lastTap: { x: number; y: number; t: number } | null = null;
  private suppressTap = false;
  private disposed = false;

  constructor(private el: HTMLElement, private h: ControlsHandlers) {
    el.style.touchAction = "none";
    el.addEventListener("pointerdown", this.onDown);
    el.addEventListener("pointermove", this.onMove);
    el.addEventListener("pointerup", this.onUp);
    el.addEventListener("pointercancel", this.onCancel);
    el.addEventListener("pointerleave", this.onLeave);
    el.addEventListener("wheel", this.onWheel, { passive: false });
    el.addEventListener("contextmenu", this.onContext);
    el.addEventListener("mousedown", this.onMouseDown);
    el.addEventListener("auxclick", this.prevent);
  }

  dispose() {
    this.disposed = true;
    this.clearLongPress();
    const el = this.el;
    el.removeEventListener("pointerdown", this.onDown);
    el.removeEventListener("pointermove", this.onMove);
    el.removeEventListener("pointerup", this.onUp);
    el.removeEventListener("pointercancel", this.onCancel);
    el.removeEventListener("pointerleave", this.onLeave);
    el.removeEventListener("wheel", this.onWheel);
    el.removeEventListener("contextmenu", this.onContext);
    el.removeEventListener("mousedown", this.onMouseDown);
    el.removeEventListener("auxclick", this.prevent);
  }

  private local(e: { clientX: number; clientY: number }) {
    const r = this.el.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  }

  private prevent = (e: Event) => e.preventDefault();

  /** Prostřední tlačítko jinak zapne automatické posouvání stránky. */
  private onMouseDown = (e: MouseEvent) => {
    if (e.button === 1) e.preventDefault();
  };

  private onContext = (e: MouseEvent) => e.preventDefault();

  private clearLongPress() {
    if (this.longPress !== null) {
      window.clearTimeout(this.longPress);
      this.longPress = null;
    }
  }

  private onDown = (e: PointerEvent) => {
    if (this.disposed) return;
    const { x, y } = this.local(e);
    const touch = e.pointerType === "touch" || e.pointerType === "pen";
    try {
      this.el.setPointerCapture(e.pointerId);
    } catch {
      /* některé prohlížeče u syntetických událostí nedovolí */
    }
    this.ptrs.set(e.pointerId, { id: e.pointerId, x, y, sx: x, sy: y, button: e.button, touch, t: performance.now() });
    if (e.button === 1) e.preventDefault();

    if (touch && this.ptrs.size === 2) {
      // druhý prst → pinch (zrušit otáčení / ťuknutí)
      this.clearLongPress();
      if (this.dragging) this.h.endInteraction();
      this.dragging = true;
      this.mode = null;
      this.suppressTap = true;
      this.pinch = this.pinchState();
      return;
    }
    if (this.ptrs.size > 1) return;
    this.dragging = false;
    this.suppressTap = false;
    this.pinch = null;
    const panMod = e.shiftKey || e.ctrlKey || e.metaKey;
    this.mode = e.button === 2 ? "pan" : e.button === 0 || e.button === 1 ? (panMod ? "pan" : "rotate") : null;
    if (touch) {
      this.clearLongPress();
      this.longPress = window.setTimeout(() => {
        this.longPress = null;
        const p = this.ptrs.get(e.pointerId);
        if (p && !this.dragging) {
          this.suppressTap = true;
          this.h.contextMenu(p.x, p.y, e.clientX, e.clientY);
        }
      }, 550);
    }
  };

  private pinchState() {
    const [a, b] = [...this.ptrs.values()];
    return { dist: Math.hypot(a.x - b.x, a.y - b.y), mx: (a.x + b.x) / 2, my: (a.y + b.y) / 2 };
  }

  private onMove = (e: PointerEvent) => {
    if (this.disposed) return;
    const { x, y } = this.local(e);
    const p = this.ptrs.get(e.pointerId);
    if (!p) {
      if (e.pointerType === "mouse" && this.ptrs.size === 0) this.h.hover(x, y, { alt: e.altKey });
      return;
    }
    const lx = p.x;
    const ly = p.y;
    p.x = x;
    p.y = y;

    if (this.pinch && this.ptrs.size >= 2) {
      const now = this.pinchState();
      if (now.dist > 0 && this.pinch.dist > 0) this.h.zoomAt(this.pinch.dist / now.dist, now.mx, now.my);
      this.h.pan(now.mx - this.pinch.mx, now.my - this.pinch.my);
      this.pinch = now;
      return;
    }
    if (this.ptrs.size !== 1) return;

    if (!this.dragging) {
      const lim = p.touch ? DRAG_PX_TOUCH : DRAG_PX_MOUSE;
      if (Math.hypot(x - p.sx, y - p.sy) < lim) return;
      this.dragging = true;
      this.clearLongPress();
      if (this.mode === "rotate") this.h.beginRotate(p.sx, p.sy);
      // první pohyb od místa stisku
      this.apply(x - p.sx, y - p.sy);
      return;
    }
    this.apply(x - lx, y - ly);
  };

  private apply(dx: number, dy: number) {
    if (this.mode === "rotate") this.h.rotate(dx, dy);
    else if (this.mode === "pan") this.h.pan(dx, dy);
  }

  private onUp = (e: PointerEvent) => {
    if (this.disposed) return;
    const p = this.ptrs.get(e.pointerId);
    this.ptrs.delete(e.pointerId);
    try {
      this.el.releasePointerCapture(e.pointerId);
    } catch {
      /* už uvolněno */
    }
    this.clearLongPress();
    if (!p) return;

    if (this.ptrs.size > 0) {
      // zvednutý jeden prst z pinch → zbylý prst nic nedělá až do nového dotyku
      this.pinch = null;
      this.mode = null;
      return;
    }
    const wasDragging = this.dragging;
    this.dragging = false;
    this.pinch = null;
    this.mode = null;
    if (wasDragging) {
      this.h.endInteraction();
      return;
    }
    if (this.suppressTap) {
      this.suppressTap = false;
      return;
    }
    if (p.button === 2) {
      this.h.contextMenu(p.x, p.y, e.clientX, e.clientY);
      return;
    }
    if (p.button !== 0) return;
    const now = performance.now();
    const last = this.lastTap;
    if (last && now - last.t < 320 && Math.hypot(last.x - p.x, last.y - p.y) < (p.touch ? 24 : 8)) {
      this.lastTap = null;
      this.h.doubleTap(p.x, p.y);
      return;
    }
    this.lastTap = { x: p.x, y: p.y, t: now };
    this.h.tap(p.x, p.y, { touch: p.touch, additive: e.shiftKey || e.ctrlKey || e.metaKey, alt: e.altKey });
  };

  private onCancel = (e: PointerEvent) => {
    this.ptrs.delete(e.pointerId);
    this.clearLongPress();
    if (this.ptrs.size === 0) {
      if (this.dragging) this.h.endInteraction();
      this.dragging = false;
      this.pinch = null;
      this.mode = null;
    }
  };

  private onLeave = (e: PointerEvent) => {
    if (e.pointerType === "mouse" && this.ptrs.size === 0) this.h.leave();
  };

  private onWheel = (e: WheelEvent) => {
    e.preventDefault();
    const { x, y } = this.local(e);
    // řádky / stránky → pixely; trackpad pinch posílá ctrlKey + jemné deltaY
    const unit = e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? 400 : 1;
    const dy = Math.max(-240, Math.min(240, e.deltaY * unit));
    const factor = Math.exp(dy * (e.ctrlKey ? 0.01 : 0.0018));
    this.h.zoomAt(factor, x, y);
  };
}
