/**
 * Dotykové ovládání 2D skicáře – čistá matematika gest (bez DOM a Reactu, testováno ve sketch-touch.test.ts).
 *
 * Pohled skici: `cx, cy` = bod skici [mm] uprostřed plátna, `scale` = px na mm; osa Y skici míří nahoru,
 * osa Y plátna dolů. Polohy prstů jsou v px vůči levému hornímu rohu plátna.
 */

export type SketchView = { cx: number; cy: number; scale: number };
export type CanvasSize = { w: number; h: number };
type Pt = [number, number];

/** dlouhý stisk prstem / perem = pravé tlačítko myši */
export const LONG_PRESS_MS = 500;
/** o kolik px se smí prst při dlouhém stisku / klepnutí pohnout (zároveň mrtvá zóna tažení prstem) */
export const TOUCH_SLOP_PX = 8;
/** totéž pro myš (klik bez tahu) */
export const MOUSE_SLOP_PX = 4;
/** meze přiblížení skici (px na mm) – stejné jako u kolečka myši */
export const SCALE_MIN = 0.01;
export const SCALE_MAX = 800;

export const clampScale = (s: number) => Math.min(SCALE_MAX, Math.max(SCALE_MIN, s));

/** px na plátně → mm ve skice */
export function canvasToMm(view: SketchView, size: CanvasSize, p: Pt): Pt {
  return [view.cx + (p[0] - size.w / 2) / view.scale, view.cy - (p[1] - size.h / 2) / view.scale];
}

/** mm ve skice → px na plátně */
export function mmToCanvas(view: SketchView, size: CanvasSize, p: Pt): Pt {
  return [size.w / 2 + (p[0] - view.cx) * view.scale, size.h / 2 - (p[1] - view.cy) * view.scale];
}

/** Posunul se ukazatel od místa stisku aspoň o `slop` px? */
export function movedBeyond(from: Pt, to: Pt, slop: number): boolean {
  return Math.hypot(to[0] - from[0], to[1] - from[1]) >= slop;
}

/** Tolerance „kliknutí bez tahu“ podle druhu ukazatele (prst a pero se při klepnutí pohnou víc než myš). */
export const clickSlop = (pointerType: string) => (pointerType === "touch" || pointerType === "pen" ? TOUCH_SLOP_PX : MOUSE_SLOP_PX);

/**
 * Pohled po gestu dvěma prsty. `a0, b0` = polohy prstů na začátku gesta (při pohledu `view0`), `a1, b1` = teď.
 * Bod skici, který byl na začátku uprostřed mezi prsty, zůstává uprostřed mezi prsty: změna rozteče prstů
 * přibližuje / oddaluje kolem středu sevření, společný pohyb obou prstů skicu posouvá. Počítá se vždy od
 * začátku gesta (ne po krocích), takže se chyby nesčítají a vrácení prstů vrátí původní pohled.
 */
export function pinchView(view0: SketchView, size: CanvasSize, a0: Pt, b0: Pt, a1: Pt, b1: Pt): SketchView {
  const d0 = Math.hypot(b0[0] - a0[0], b0[1] - a0[1]);
  const d1 = Math.hypot(b1[0] - a1[0], b1[1] - a1[1]);
  // prsty téměř na sobě: poměr roztečí by byl nespolehlivý → jen posun
  const k = d0 > 1 && d1 > 1 ? d1 / d0 : 1;
  const scale = clampScale(view0.scale * k);
  const c0: Pt = [(a0[0] + b0[0]) / 2, (a0[1] + b0[1]) / 2];
  const c1: Pt = [(a1[0] + b1[0]) / 2, (a1[1] + b1[1]) / 2];
  const m = canvasToMm(view0, size, c0);
  return { scale, cx: m[0] - (c1[0] - size.w / 2) / scale, cy: m[1] + (c1[1] - size.h / 2) / scale };
}

/**
 * Časovač dlouhého stisku: `start` při stisku prstu / pera, `move` při pohybu (zruší se, když se ukazatel
 * vzdálí aspoň o `slop` px), `cancel` při zvednutí, druhém prstu nebo přerušení. Po uplynutí `ms` zavolá `fire`
 * s místem stisku – jen jednou.
 */
export class LongPress {
  private timer: ReturnType<typeof setTimeout> | null = null;
  private id = -1;
  private at: Pt = [0, 0];
  constructor(
    private readonly ms = LONG_PRESS_MS,
    private readonly slop = TOUCH_SLOP_PX,
  ) {}
  /** čeká se na dlouhý stisk? */
  get pending() {
    return this.timer !== null;
  }
  start(pointerId: number, at: Pt, fire: (at: Pt) => void) {
    this.cancel();
    this.id = pointerId;
    this.at = at;
    this.timer = setTimeout(() => {
      this.timer = null;
      fire(at);
    }, this.ms);
  }
  move(pointerId: number, p: Pt) {
    if (this.timer !== null && pointerId === this.id && movedBeyond(this.at, p, this.slop)) this.cancel();
  }
  cancel() {
    if (this.timer !== null) clearTimeout(this.timer);
    this.timer = null;
  }
}

/**
 * Sledování prstů na plátně. Jeden prst = levé tlačítko myši; druhý prst zahájí gesto dvěma prsty (posun + zoom)
 * a rozpracovanou akci prvního prstu ruší; po gestu se zbylé prsty až do zvednutí všech ignorují (aby zbylý prst
 * po sevření nezačal kreslit nebo táhnout).
 */
export class TouchTracker {
  private pts = new Map<number, Pt>();
  private pair: { ids: [number, number]; a: Pt; b: Pt } | null = null;
  private dead = false;

  /** počet prstů na plátně */
  get count() {
    return this.pts.size;
  }
  /** probíhá gesto dvěma prsty */
  get pinching() {
    return this.pair !== null;
  }
  /** události prstů se mají až do zvednutí všech ignorovat (po gestu, dlouhém stisku nebo zrušení) */
  get swallowed() {
    return this.dead;
  }
  /** zbytek tohoto doteku už nemá nic dělat (např. po dlouhém stisku) */
  swallow() {
    if (this.pts.size) this.dead = true;
  }
  /**
   * Prst dosedl. Vrací `"first"` (první prst – chová se jako levé tlačítko), `"second"` (na plátně jsou právě
   * dva prsty → začíná gesto dvěma prsty: volající zruší akci prvního prstu a zapamatuje si pohled; platí i pro
   * prst vrácený po přerušeném gestu) nebo `"ignore"` (třetí a další prst).
   */
  down(id: number, p: Pt): "first" | "second" | "ignore" {
    const fresh = this.pts.size === 0;
    this.pts.set(id, p);
    if (fresh) {
      this.pair = null;
      this.dead = false;
      return "first";
    }
    if (this.pts.size === 2 && !this.pair) {
      const [i, j] = [...this.pts.keys()] as [number, number];
      this.pair = { ids: [i, j], a: this.pts.get(i)!, b: this.pts.get(j)! };
      this.dead = true;
      return "second";
    }
    this.dead = true;
    return "ignore";
  }
  /** Prst se pohnul. Při gestu dvěma prsty vrací výchozí a aktuální polohy obou prstů (pro `pinchView`), jinak null. */
  move(id: number, p: Pt): { a0: Pt; b0: Pt; a1: Pt; b1: Pt } | null {
    if (!this.pts.has(id)) return null;
    this.pts.set(id, p);
    const g = this.pair;
    if (!g) return null;
    const a1 = this.pts.get(g.ids[0]);
    const b1 = this.pts.get(g.ids[1]);
    return a1 && b1 ? { a0: g.a, b0: g.b, a1, b1 } : null;
  }
  /** Prst se zvedl (nebo byl dotyk přerušen). Vrací true, když už na plátně žádný prst není. */
  up(id: number): boolean {
    this.pts.delete(id);
    if (this.pair && this.pair.ids.includes(id)) this.pair = null;
    if (this.pts.size === 0) {
      this.pair = null;
      return true;
    }
    return false;
  }
  /** zapomenout vše (odchod ze skici) */
  reset() {
    this.pts.clear();
    this.pair = null;
    this.dead = false;
  }
}
