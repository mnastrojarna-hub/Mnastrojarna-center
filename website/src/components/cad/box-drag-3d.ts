/**
 * Tažení obdélníku výběru oknem nad 3D oknem (WebGL i náhled bez WebGL) – jen DOM, bez Reactu a bez three.js.
 *
 * – Myš / pero: stisk levého tlačítka, který 3D okno přijme (`accept`), a tažení o víc než 4 px = obdélník; kratší
 *   pohyb zůstává klikem (výběr kliknutím obsluhuje 3D okno samo). Zleva doprava = okno (modrý plný rámeček),
 *   zprava doleva = křížení (zelený čárkovaný). Uvolnění dokončí výběr (`finish`), Esc ho zruší.
 * – Dotyk: dlouhý stisk (550 ms) bez pohybu a pak tažení = obdélník; dlouhý stisk bez tažení = kontextová nabídka
 *   (`longPress`, po zvednutí prstu). Pohyb dřív než za 550 ms nechá otáčení beze změny, druhý prst výběr zruší
 *   (posun a přiblížení dvěma prsty fungují jako dřív).
 * – Počítadlo u obdélníku (`preview`, např. „12 ploch · 30 hran“) se přepočítává nejvýš ~10× za sekundu.
 *
 * Posluchače jsou v zachytávací fázi na hostiteli plátna, takže proběhnou dřív než posluchače plátna (OrbitControls,
 * výběr kliknutím). Událost se nezastavuje (OrbitControls musí vidět i uvolnění); 3D okno se po uvolnění zeptá
 * `consume(e)`, zda gesto patřilo výběru oknem.
 */
import { boxModeOf, type BoxMode } from "./box-pick-3d";
import type { BoxRect } from "@/cad/box-select";

export type BoxAccept = { box: boolean; longPress: boolean };
export type BoxDragHooks = {
  /** smí stisk začít výběr oknem / dlouhý stisk (dotyk)? */
  accept: (e: PointerEvent) => BoxAccept;
  /** text počítadla pro obdélník (souřadnice v CSS px plátna); null = bez počítadla */
  preview?: (rect: BoxRect, crossing: boolean, mode: BoxMode) => string | null;
  /** konec tažení: výběr oknem */
  finish: (rect: BoxRect, crossing: boolean, mode: BoxMode) => void;
  /** dlouhý stisk prstem bez tažení (kontextová nabídka) */
  longPress?: (e: PointerEvent) => void;
  /** začátek / konec gesta (3D okno vypne otáčení OrbitControls) */
  busy?: (on: boolean) => void;
};
export type BoxDrag = {
  /** patří ukazatel výběru oknem (3D okno ho nemá otáčet)? */
  owns: (pointerId: number) => boolean;
  /** uvolnění ukončilo výběr oknem nebo dlouhý stisk – 3D okno ho nemá brát jako klik */
  consume: (e: PointerEvent) => boolean;
  /** je obdélník právě vidět? */
  active: () => boolean;
  /** přepočítat počítadlo (např. po dohledání prvků pro filtr Prvek) */
  refresh: () => void;
  cancel: () => void;
  dispose: () => void;
};

const MOVE_PX = 4;
const TOUCH_MOVE_PX = 8;
const LONG_MS = 550;

type State = {
  id: number;
  touch: boolean;
  phase: "pending" | "armed" | "active";
  box: boolean;
  longPress: boolean;
  /** začátek v klientských souřadnicích */
  sx: number;
  sy: number;
  cx: number;
  cy: number;
  mode: BoxMode;
  timer: ReturnType<typeof setTimeout> | null;
  busy: boolean;
};

/** Připojí výběr oknem k hostiteli `host` (rodič plátna); souřadnice obdélníku se počítají vůči `target()` (plátno). */
export function attachBoxDrag(host: HTMLElement, target: () => HTMLElement | null, hooks: BoxDragHooks): BoxDrag {
  let st: State | null = null;
  let rectEl: HTMLDivElement | null = null;
  let labelEl: HTMLDivElement | null = null;
  let markEl: HTMLDivElement | null = null;
  const consumed = new Set<number>();
  let swallowTouch = false;
  let pvTimer: ReturnType<typeof setTimeout> | null = null;
  let pvLast = 0;
  let pvCost = 0;

  const origin = () => (target() ?? host).getBoundingClientRect();
  const local = (x: number, y: number, r: DOMRect) => [x - r.left, y - r.top] as const;
  const rectOf = (s: State): BoxRect => {
    const r = origin();
    const [x0, y0] = local(s.sx, s.sy, r);
    const [x1, y1] = local(s.cx, s.cy, r);
    return { x0, y0, x1, y1 };
  };
  const crossingOf = (s: State) => s.cx < s.sx;

  const setBusy = (s: State, on: boolean) => {
    if (s.busy === on) return;
    s.busy = on;
    hooks.busy?.(on);
  };
  const removeEls = () => {
    rectEl?.remove();
    markEl?.remove();
    rectEl = labelEl = markEl = null;
    const t = target();
    if (t) t.style.cursor = "";
  };
  const end = () => {
    if (!st) return;
    if (st.timer) clearTimeout(st.timer);
    if (pvTimer) clearTimeout(pvTimer);
    pvTimer = null;
    const s = st;
    st = null;
    removeEls();
    setBusy(s, false);
  };

  const draw = () => {
    if (!st || st.phase !== "active") return;
    const hr = host.getBoundingClientRect();
    const crossing = crossingOf(st);
    if (!rectEl) {
      rectEl = document.createElement("div");
      rectEl.style.cssText = "position:absolute;pointer-events:none;z-index:30;box-sizing:border-box;";
      labelEl = document.createElement("div");
      labelEl.dataset.boxCount = "";
      labelEl.style.cssText = "position:absolute;left:100%;top:100%;margin:4px 0 0 4px;white-space:nowrap;border-radius:4px;padding:1px 6px;font:600 11px/16px Roboto,Arial,sans-serif;color:#fff;box-shadow:0 1px 3px rgba(0,0,0,.25);";
      rectEl.appendChild(labelEl);
      host.appendChild(rectEl);
      const t = target();
      if (t) t.style.cursor = "crosshair";
    }
    const x0 = Math.min(st.sx, st.cx) - hr.left, y0 = Math.min(st.sy, st.cy) - hr.top;
    rectEl.dataset.boxSelect = crossing ? "crossing" : "window";
    rectEl.dataset.boxMode = st.mode;
    rectEl.style.left = `${x0}px`;
    rectEl.style.top = `${y0}px`;
    rectEl.style.width = `${Math.abs(st.cx - st.sx)}px`;
    rectEl.style.height = `${Math.abs(st.cy - st.sy)}px`;
    rectEl.style.border = crossing ? "1.5px dashed #16a34a" : "1.5px solid #2563eb";
    rectEl.style.background = crossing ? "rgba(22,163,74,0.08)" : "rgba(37,99,235,0.08)";
    if (labelEl) {
      labelEl.style.background = crossing ? "#15803d" : "#1d4ed8";
      // popisek u kurzoru: vlevo, táhne-li se doleva; nahoře, táhne-li se nahoru
      labelEl.style.left = st.cx < st.sx ? "auto" : "100%";
      labelEl.style.right = st.cx < st.sx ? "100%" : "auto";
      labelEl.style.top = st.cy < st.sy ? "auto" : "100%";
      labelEl.style.bottom = st.cy < st.sy ? "100%" : "auto";
      labelEl.style.margin = `${st.cy < st.sy ? 0 : 4}px ${st.cx < st.sx ? 4 : 0}px ${st.cy < st.sy ? 4 : 0}px ${st.cx < st.sx ? 0 : 4}px`;
    }
    schedulePreview();
  };
  const runPreview = () => {
    pvTimer = null;
    if (!st || st.phase !== "active" || !hooks.preview || !labelEl) return;
    const t0 = performance.now();
    let text: string | null = null;
    try {
      text = hooks.preview(rectOf(st), crossingOf(st), st.mode);
    } catch {
      text = null;
    }
    pvCost = performance.now() - t0;
    pvLast = performance.now();
    if (labelEl) {
      labelEl.textContent = text ?? "";
      labelEl.style.display = text ? "block" : "none";
    }
  };
  const schedulePreview = () => {
    if (pvTimer || !hooks.preview) return;
    const gap = Math.max(90, pvCost * 3);
    const wait = Math.max(0, gap - (performance.now() - pvLast));
    pvTimer = setTimeout(runPreview, wait);
  };

  const onDown = (e: PointerEvent) => {
    if (st) {
      // druhý prst: výběr oknem končí, gesto patří posunu / přiblížení; stejný ukazatel = nedokončené gesto (ztracené uvolnění)
      const other = e.pointerId !== st.id;
      end();
      if (other) return;
    }
    const touch = e.pointerType === "touch";
    if (!touch && e.button !== 0) return;
    // jen stisk na plátně (ne na tlačítkách a panelech nad ním)
    if (e.target !== target()) return;
    const acc = hooks.accept(e);
    if (!acc.box && !(touch && acc.longPress)) return;
    st = { id: e.pointerId, touch, phase: "pending", box: acc.box, longPress: touch && acc.longPress, sx: e.clientX, sy: e.clientY, cx: e.clientX, cy: e.clientY, mode: boxModeOf(e), timer: null, busy: false };
    if (!touch) {
      // myš: otáčení levým tlačítkem (volba „otáčení“) se vypne hned – okno začalo na prázdném místě
      setBusy(st, true);
      try {
        (target() ?? host).setPointerCapture?.(e.pointerId);
      } catch {
        /* syntetická událost bez aktivního ukazatele */
      }
      return;
    }
    const s = st;
    s.timer = setTimeout(() => {
      s.timer = null;
      if (st !== s) return;
      s.phase = "armed";
      setBusy(s, true);
      // značka v místě stisku: teď lze táhnout obdélník (nebo zvednout prst = nabídka)
      if (s.box) {
        const hr = host.getBoundingClientRect();
        markEl = document.createElement("div");
        markEl.dataset.boxArmed = "";
        markEl.style.cssText = `position:absolute;pointer-events:none;z-index:30;left:${s.sx - hr.left - 9}px;top:${s.sy - hr.top - 9}px;width:18px;height:18px;border-radius:50%;border:2px solid #2563eb;background:rgba(37,99,235,.15);`;
        host.appendChild(markEl);
      }
    }, LONG_MS);
  };
  const onMove = (e: PointerEvent) => {
    if (!st || e.pointerId !== st.id) return;
    st.cx = e.clientX;
    st.cy = e.clientY;
    st.mode = boxModeOf(e);
    const dist = Math.hypot(st.cx - st.sx, st.cy - st.sy);
    if (st.phase === "pending") {
      if (st.touch) {
        // pohyb před dlouhým stiskem = otáčení / posun jako dřív
        if (dist > TOUCH_MOVE_PX) end();
        return;
      }
      if (dist <= MOVE_PX) return;
      st.phase = "active";
    } else if (st.phase === "armed") {
      if (dist <= TOUCH_MOVE_PX || !st.box) return;
      markEl?.remove();
      markEl = null;
      st.phase = "active";
    }
    draw();
  };
  const onUp = (e: PointerEvent) => {
    if (!st || e.pointerId !== st.id) return;
    const s = st;
    s.cx = e.clientX;
    s.cy = e.clientY;
    if (s.phase === "active") {
      s.mode = boxModeOf(e);
      const r = rectOf(s);
      const crossing = crossingOf(s);
      consumed.add(e.pointerId);
      swallowTouch = s.touch;
      try {
        hooks.finish(r, crossing, s.mode); // ještě během gesta (scéna výběru z tažení platí)
      } finally {
        end();
      }
      return;
    }
    if (s.phase === "armed") {
      consumed.add(e.pointerId);
      swallowTouch = true;
      end();
      if (s.longPress) hooks.longPress?.(e);
      return;
    }
    end(); // krátký stisk = klik (obslouží 3D okno)
  };
  const onCancel = (e: PointerEvent) => {
    if (st && e.pointerId === st.id) end();
  };
  const onKey = (e: KeyboardEvent) => {
    if (e.key !== "Escape" || !st || st.phase === "pending") return;
    // Esc zruší jen obdélník (ne výběr ani otevřený formulář); uvolnění pak není klik
    e.preventDefault();
    e.stopImmediatePropagation();
    consumed.add(st.id);
    end();
  };
  const onTouchEnd = (e: TouchEvent) => {
    // po výběru oknem / dlouhém stisku potlačit náhradní mouse/click události (zavřely by nabídku, klikly by do modelu)
    if (swallowTouch) {
      swallowTouch = false;
      if (e.cancelable) e.preventDefault();
    }
  };
  const onLost = (e: PointerEvent) => {
    // ztráta zachycení ukazatele bez uvolnění (okno prohlížeče ztratilo fokus) – zrušit
    if (st && e.pointerId === st.id && st.phase !== "active" && !st.touch) end();
  };

  host.addEventListener("pointerdown", onDown, true);
  host.addEventListener("pointermove", onMove, true);
  host.addEventListener("pointerup", onUp, true);
  host.addEventListener("pointercancel", onCancel, true);
  host.addEventListener("lostpointercapture", onLost, true);
  host.addEventListener("touchend", onTouchEnd, { capture: true, passive: false });
  window.addEventListener("keydown", onKey, true);

  return {
    owns: (id) => !!st && st.id === id && (st.phase !== "pending" || !st.touch),
    consume: (e) => consumed.delete(e.pointerId),
    active: () => !!st && st.phase === "active",
    refresh: () => {
      if (st?.phase === "active") schedulePreview();
    },
    cancel: end,
    dispose: () => {
      end();
      host.removeEventListener("pointerdown", onDown, true);
      host.removeEventListener("pointermove", onMove, true);
      host.removeEventListener("pointerup", onUp, true);
      host.removeEventListener("pointercancel", onCancel, true);
      host.removeEventListener("lostpointercapture", onLost, true);
      host.removeEventListener("touchend", onTouchEnd, true);
      window.removeEventListener("keydown", onKey, true);
    },
  };
}
