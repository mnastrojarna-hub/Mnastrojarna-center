/**
 * Swipe mezi výkresy v prohlížeči: vodorovný tah jedním prstem. Nesmí bojovat s přiblížením a posunem —
 * přiblížený obrázek (data-zoomed) a vodorovně posuvné PDF přepnou jen tahem od okraje, ke kterému je
 * obsah už doposunutý; dva prsty (pinch) swipe ruší.
 */

export interface SwipePoint {
  x: number;
  y: number;
  t: number;
}

/** Nejkratší tah (px), poměr vodorovně : svisle a nejdelší doba (ms). */
export const SWIPE_MIN_PX = 56;
const SWIPE_RATIO = 1.6;
const SWIPE_MAX_MS = 900;

/** 1 = další (prst doleva), -1 = předchozí (prst doprava), 0 = nic. */
export function swipeDirection(start: SwipePoint, end: SwipePoint): 1 | -1 | 0 {
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  if (end.t - start.t > SWIPE_MAX_MS) return 0;
  if (Math.abs(dx) < SWIPE_MIN_PX || Math.abs(dx) < Math.abs(dy) * SWIPE_RATIO) return 0;
  return dx < 0 ? 1 : -1;
}

/** Stav posuvného obsahu pod prstem na začátku tahu. */
export interface SwipeGate {
  /** Přiblížený obrázek — swipe vypnutý. */
  zoomed: boolean;
  /** Vodorovně posuvný obsah (přiblížené PDF): je doposunutý vlevo / vpravo? null = neposouvá se. */
  scroll: { atStart: boolean; atEnd: boolean; left: number } | null;
}

/** Smí tah ve směru `dir` přepnout výkres (scrollLeft na konci tahu = endLeft)? */
export function swipeAllowed(gate: SwipeGate, dir: 1 | -1, endLeft: number | null): boolean {
  if (gate.zoomed) return false;
  if (!gate.scroll) return true;
  // obsah se tahem posunul → byl to posun, ne swipe
  if (endLeft !== null && Math.abs(endLeft - gate.scroll.left) > 2) return false;
  return dir === 1 ? gate.scroll.atEnd : gate.scroll.atStart;
}

/** Stav pod prstem: hledá od cíle doteku nahoru po kořen prohlížeče. */
export function swipeGateOf(target: EventTarget | null, root: Element): { gate: SwipeGate; scroller: Element | null } {
  let zoomed = false;
  let scroller: Element | null = null;
  for (let el = target instanceof Element ? target : null; el && el !== root; el = el.parentElement) {
    if (el.getAttribute("data-zoomed") === "1") zoomed = true;
    if (!scroller && el.scrollWidth > el.clientWidth + 2) {
      const ox = typeof getComputedStyle === "function" ? getComputedStyle(el).overflowX : "auto";
      if (ox === "auto" || ox === "scroll") scroller = el;
    }
  }
  if (!scroller) return { gate: { zoomed, scroll: null }, scroller: null };
  const max = scroller.scrollWidth - scroller.clientWidth;
  return {
    gate: { zoomed, scroll: { atStart: scroller.scrollLeft <= 2, atEnd: scroller.scrollLeft >= max - 2, left: scroller.scrollLeft } },
    scroller,
  };
}
