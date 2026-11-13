/**
 * Výkresová dokumentace z 3D modelu (jako výkresové prostředí ZW3D / Inventoru):
 * pravoúhlé promítání ISO E (evropské) nebo ISO A (americké), volitelné pohledy, izometrie,
 * řez A-A se šrafováním, osy děr a válců, kóty (celkové + průměry), rohové razítko Mnástrojárny.
 * Čáry dle ISO 128: obrys 0,5 · skryté 0,25 čárkovaně · osy a kóty 0,18 · šrafy 0,18.
 * Výstup: geometrie listu (polys/texts) → SVG, DXF (R12, LTYPE/vrstvy) a PDF (src/cad/pdf.ts).
 */
import { cadLocale, tr } from "./i18n";
import * as r from "replicad";
import type { CadDoc, PlaneName, Vec2, Vec3 } from "./types";

// ---------------------------------------------------------------- typy

export type Layer = "visible" | "hidden" | "center" | "cut" | "dim" | "hatch" | "frame" | "thin" | "title";
export type Poly = { pts: Vec2[]; layer: Layer; fill?: boolean; width?: number };
export type DText = {
  x: number;
  y: number;
  s: string;
  size: number;
  anchor?: "start" | "middle" | "end";
  /** stupně, po směru hodinových ručiček (SVG) */
  rotate?: number;
  bold?: boolean;
  layer?: "dim" | "text";
  brand?: boolean;
};

export type DrawingMeta = {
  name: string;
  material: string;
  massKg?: number;
  author?: string;
  date?: string;
  number?: string;
  revision?: string;
  /** nepředepsané tolerance (např. „ISO 2768-mK“); prázdné = na výkrese se neuvádí – výrobní požadavek musí zadat uživatel */
  tolerance?: string;
  /** poznámka v patičce (např. „Nekótované rozměry dle 3D modelu (STEP)“); prázdné = nic – nedoplňuje se automaticky */
  note?: string;
  /** opracování hran (např. „srazit 0,5×45°“); prázdné = neuvádí se */
  edges?: string;
  /** závitové díry: poloměr jádrového vrtání → popis (např. „M6 hl. 12“) – místo Ø jádra se kótuje označení závitu */
  threads?: { r: number; label: string }[];
  /** kusovník (sestava) – vykreslí se nad razítkem dle ISO 7573 */
  bom?: BomItem[];
  /** komponenty sestavy pro pozice (balónky) – světový obalový kvádr každé komponenty */
  components?: BalloonItem[];
  /** tabulka revizí (vpravo nahoře) */
  revisions?: RevisionItem[];
  /** číslo listu / počet listů (razítko „List i/n“) */
  sheetIndex?: number;
  sheetCount?: number;
};

export type BalloonItem = { pos: number; name: string; bbox: [Vec3, Vec3] };
export type RevisionItem = { rev: string; date: string; note: string; author?: string };
/** Detailní pohled: kruh v pohledu `view` (střed a poloměr v souřadnicích pohledu = mm modelu), měřítko detailu a umístění na listu. */
export type DetailView = { id: string; label: string; view: string; cx: number; cy: number; r: number; scale: number; at?: Vec2 };
export type HoleRow = { tag: string; x: number; y: number; d: number; /** střed v souřadnicích pohledu */ c: Vec2; view: string };

export type BomItem = { pos: number; name: string; number?: string; qty: number; material?: string; massKg?: number; note?: string };

export type SheetName = "A4" | "A3" | "A2" | "A1" | "A0";
export type ViewKey = "front" | "top" | "left" | "right" | "back" | "bottom";
/** otočení hlavního pohledu na listu [°] po směru hodin (s ním se otočí celé promítání – soustružený díl tak může ležet osou vodorovně) */
export type ViewRotation = 0 | 90 | 180 | 270;
/** řez rovinou: `full` = celý řez, `half` = polovina pohled / polovina řez podél osy souměrnosti (vpravo od svislé osy, pod vodorovnou) */
export type SectionOpt = { plane: PlaneName; offset: number; kind?: "full" | "half" };
/** zdroj dalšího modelu na listu: komponenta sestavy (podle id), nebo dokument vložený do definice výkresu (kopie) */
export type ModelSource = { kind: "component"; compId: string } | { kind: "doc"; doc: CadDoc };
/** pohled jiného modelu na témže listu – vlastní měřítko s popiskem pod pohledem; klíč pohledu pro kóty = `m:<id>` */
export type ModelView = { id: string; name: string; source: ModelSource; view: ViewKey | "iso"; scale: "auto" | number };
export const modelViewKey = (id: string) => `m:${id}`;

export type DrawingOptions = {
  sheet: "auto" | SheetName;
  orientation: "landscape" | "portrait";
  /** "auto" nebo měřítko jako číslo (0.5 = 1:2, 2 = 2:1) */
  scale: "auto" | number;
  projection: "E" | "A";
  views: Record<ViewKey | "iso", boolean>;
  hidden: boolean;
  section: null | SectionOpt;
  centerLines: boolean;
  /** "smart" = Chytré kóty (cad/drawing-dims.ts): kóty podle prvků modelu jako upravitelné poznámky (`auto`) */
  dimensions: "none" | "overall" | "auto" | "smart";
  /** Chytré kóty: délky řetězově (výchozí) nebo od základny; `smartGen` = otisk modelu posledního generování, `smartOff` = smazané vygenerované kóty */
  dimStyle?: "chain" | "baseline";
  smartGen?: string;
  smartOff?: string[];
  /** místo navíc pro kóty mezi pohledy a kolem nich [mm] (Chytré kóty) */
  dimRoom?: number;
  /**
   * volné místo pro kóty (Chytré kóty): když se list s celým `dimRoom` nevejde, místo mezi pohledy a kolem nich se zmenší
   * až na `dimRoomMin` a pohledy smí sahat i vedle razítka – formát ani měřítko se kvůli místu pro kóty nemění. Záporná
   * hodnota (jen s `dimPads`, kde je místo pro kóty vyhrazené zvlášť) zmenší i výchozí okraj 14 mm a mezeru 24 mm.
   */
  dimRoomMin?: number;
  /** místo pro kóty vedle jednotlivých pohledů [mm listu] (Chytré kóty: podle jejich skutečného rozmístění v předchozím průchodu) */
  dimPads?: Record<string, Partial<Record<"l" | "t" | "r" | "b", number>>>;
  /** pozice komponent (balónky) – jen sestavy s meta.components */
  balloons?: boolean;
  /** kusovník nad razítkem (sestava; bez hodnoty = zobrazit, když je kusovník) – kusovník sám přichází v meta.bom */
  bomTable?: boolean;
  /** tabulka děr (souřadnice a průměry děr v půdorysu) */
  holeTable?: boolean;
  /** detailní pohledy */
  details?: DetailView[];
  /** otočení hlavního pohledu (a s ním celého promítání) */
  rotation?: ViewRotation;
  /** pohledy dalších modelů na témže listu */
  models?: ModelView[];
};

export const defaultDrawingOptions: DrawingOptions = {
  sheet: "auto",
  orientation: "landscape",
  scale: "auto",
  projection: "E",
  views: { front: true, top: true, left: true, right: false, back: false, bottom: false, iso: true },
  // skryté hrany jsou u nových výkresů vypnuté (uložené výkresy si drží své nastavení)
  hidden: false,
  section: null,
  centerLines: true,
  dimensions: "auto",
  balloons: true,
  holeTable: false,
  details: [],
  rotation: 0,
  models: [],
};

/** Umístění pohledu na listu (pro mapování kliknutí → souřadnice pohledu a zpět). */
export type PlacedView = { key: string; px: number; py: number; s: number; x0: number; y0: number; w: number; h: number; /** hrany a kružnice pohledu (souřadnice pohledu) – výběr při kótování a dohledání geometrie kót */ ents?: ViewEnt[]; /** kamera pohledu (promítnutí bodu modelu: `proj`) */ cam?: Cam };

export type DrawingResult = {
  sheet: { name: SheetName; w: number; h: number };
  /** umístěné pohledy (bez izometrie) */
  views: PlacedView[];
  scale: string;
  scaleValue: number;
  polys: Poly[];
  texts: DText[];
  svg: string;
  dxf: string;
  warnings: string[];
  /** řádky tabulky děr (je-li zapnutá) */
  holes?: HoleRow[];
  /** umístěné detailní pohledy (list: levý horní roh, velikost) */
  details?: { id: string; label: string; x: number; y: number; w: number; h: number }[];
  /** pozice (balónky) – střed kroužku na listu */
  balloons?: { pos: number; x: number; y: number }[];
  /** pohledy dalších modelů: klíč pohledu, měřítko a obdélník na listu */
  models?: { id: string; key: string; scale: string; scaleValue: number; x: number; y: number; w: number; h: number }[];
  /** automatické kóty průměrů v řadě vedle pohledu (soustružené díly): pohled a strana, na které řada leží */
  stacks?: { view: string; side: "l" | "t" | "r" | "b"; count: number }[];
};

export const SHEETS: Record<SheetName, [number, number]> = {
  A4: [297, 210],
  A3: [420, 297],
  A2: [594, 420],
  A1: [841, 594],
  A0: [1189, 841],
};
const SHEET_ORDER: SheetName[] = ["A4", "A3", "A2", "A1", "A0"];

/** Normalizovaná měřítka ISO 5455. */
export const STANDARD_SCALES = [50, 20, 10, 5, 2, 1, 1 / 2, 1 / 5, 1 / 10, 1 / 20, 1 / 50, 1 / 100, 1 / 200];
export const scaleLabel = (s: number) => (s >= 1 ? `${Math.round(s * 100) / 100}:1` : `1:${Math.round((1 / s) * 100) / 100}`);

export const VIEW_LABEL: Record<ViewKey | "iso", string> = {
  front: "Zepředu (hlavní)",
  top: "Shora",
  left: "Zleva",
  right: "Zprava",
  back: "Zezadu",
  bottom: "Zdola",
  iso: "Izometrie",
};

// ---------------------------------------------------------------- SVG path → polyline

/** Rozloží SVG path (absolutní příkazy M L H V A C Q Z) na polyline v souřadnicích SVG. */
export function pathToPolylines(d: string): Vec2[][] {
  const tokens = d.match(/[MLHVACQZmlhvacqz]|-?\d*\.?\d+(?:e[-+]?\d+)?/g) ?? [];
  const out: Vec2[][] = [];
  let cur: Vec2[] = [];
  let p: Vec2 = [0, 0];
  let start: Vec2 = [0, 0];
  let i = 0;
  let cmd = "";
  const num = () => Number(tokens[i++]);
  while (i < tokens.length) {
    if (/[A-Za-z]/.test(tokens[i])) cmd = tokens[i++].toUpperCase();
    switch (cmd) {
      case "M":
        if (cur.length > 1) out.push(cur);
        p = [num(), num()];
        start = p;
        cur = [p];
        cmd = "L";
        break;
      case "L":
        p = [num(), num()];
        cur.push(p);
        break;
      case "H":
        p = [num(), p[1]];
        cur.push(p);
        break;
      case "V":
        p = [p[0], num()];
        cur.push(p);
        break;
      case "C": {
        const c1: Vec2 = [num(), num()];
        const c2: Vec2 = [num(), num()];
        const e: Vec2 = [num(), num()];
        for (let k = 1; k <= 12; k++) {
          const t = k / 12;
          const u = 1 - t;
          cur.push([
            u * u * u * p[0] + 3 * u * u * t * c1[0] + 3 * u * t * t * c2[0] + t * t * t * e[0],
            u * u * u * p[1] + 3 * u * u * t * c1[1] + 3 * u * t * t * c2[1] + t * t * t * e[1],
          ]);
        }
        p = e;
        break;
      }
      case "Q": {
        const c: Vec2 = [num(), num()];
        const e: Vec2 = [num(), num()];
        for (let k = 1; k <= 10; k++) {
          const t = k / 10;
          const u = 1 - t;
          cur.push([u * u * p[0] + 2 * u * t * c[0] + t * t * e[0], u * u * p[1] + 2 * u * t * c[1] + t * t * e[1]]);
        }
        p = e;
        break;
      }
      case "A": {
        const rx = num();
        const ry = num();
        const rotDeg = num();
        const large = num();
        const sweep = num();
        const e: Vec2 = [num(), num()];
        cur.push(...arcToPoints(p, e, rx, ry, rotDeg, !!large, !!sweep));
        p = e;
        break;
      }
      case "Z":
        cur.push(start);
        p = start;
        break;
      default:
        i++;
    }
  }
  if (cur.length > 1) out.push(cur);
  return out;
}

/** Parametry oblouku SVG (příkaz A): střed, poloosy, počáteční úhel a rozsah (kladně = příznak sweep, v SVG po směru hodin). */
function arcGeom(p0: Vec2, p1: Vec2, rx: number, ry: number, phiDeg: number, large: boolean, sweep: boolean) {
  const phi = (phiDeg * Math.PI) / 180;
  const cos = Math.cos(phi);
  const sin = Math.sin(phi);
  const dx = (p0[0] - p1[0]) / 2;
  const dy = (p0[1] - p1[1]) / 2;
  const x1 = cos * dx + sin * dy;
  const y1 = -sin * dx + cos * dy;
  rx = Math.abs(rx);
  ry = Math.abs(ry);
  const lambda = (x1 * x1) / (rx * rx) + (y1 * y1) / (ry * ry);
  if (lambda > 1) {
    rx *= Math.sqrt(lambda);
    ry *= Math.sqrt(lambda);
  }
  const sign = large === sweep ? -1 : 1;
  const num = rx * rx * ry * ry - rx * rx * y1 * y1 - ry * ry * x1 * x1;
  const co = sign * Math.sqrt(Math.max(0, num / (rx * rx * y1 * y1 + ry * ry * x1 * x1)));
  const cx1 = (co * rx * y1) / ry;
  const cy1 = (-co * ry * x1) / rx;
  const cx = cos * cx1 - sin * cy1 + (p0[0] + p1[0]) / 2;
  const cy = sin * cx1 + cos * cy1 + (p0[1] + p1[1]) / 2;
  const ang = (ux: number, uy: number, vx: number, vy: number) => Math.atan2(ux * vy - uy * vx, ux * vx + uy * vy);
  const t1 = ang(1, 0, (x1 - cx1) / rx, (y1 - cy1) / ry);
  let dt = ang((x1 - cx1) / rx, (y1 - cy1) / ry, (-x1 - cx1) / rx, (-y1 - cy1) / ry);
  if (!sweep && dt > 0) dt -= 2 * Math.PI;
  if (sweep && dt < 0) dt += 2 * Math.PI;
  return { cx, cy, rx, ry, cos, sin, t1, dt };
}

function arcToPoints(p0: Vec2, p1: Vec2, rx: number, ry: number, phiDeg: number, large: boolean, sweep: boolean): Vec2[] {
  if (rx === 0 || ry === 0) return [p1];
  const g = arcGeom(p0, p1, rx, ry, phiDeg, large, sweep);
  const { cx, cy, cos, sin, t1, dt } = g;
  rx = g.rx;
  ry = g.ry;
  const n = Math.max(4, Math.ceil(Math.abs(dt) / (Math.PI / 24)));
  const pts: Vec2[] = [];
  for (let k = 1; k <= n; k++) {
    const t = t1 + (dt * k) / n;
    pts.push([cx + rx * Math.cos(t) * cos - ry * Math.sin(t) * sin, cy + rx * Math.cos(t) * sin + ry * Math.sin(t) * cos]);
  }
  return pts;
}

// ---------------------------------------------------------------- entity pohledu (výběr hrany / kružnice při kótování)

/**
 * Rozpoznaná entita promítnutého pohledu v souřadnicích pohledu (mm modelu, y dolů): souvislý přímý úsek čáry
 * nebo kruhový oblouk / kružnice. Vzniká přímo z cesty SVG, kterou vrací projekce (úsečky L, oblouky A, křivky C/Q),
 * ne zpětným odhadem z lomených čar – kružnice a oblouky z příkazu A tak mají přesný střed i poloměr
 * (jen obrysy zaoblení, které projekce vrací jako Bézierovy křivky, se prokládají kružnicí).
 */
export type ViewEnt =
  | { t: "line"; a: Vec2; b: Vec2; hidden?: boolean }
  | { t: "arc"; c: Vec2; r: number; /** počáteční úhel a rozsah [rad] (atan2 v souřadnicích pohledu; ±2π = celá kružnice) */ a0: number; da: number; hidden?: boolean };

const dist2 = (a: Vec2, b: Vec2) => Math.hypot(b[0] - a[0], b[1] - a[1]);
/** dovolená odchylka od přímky (výstup projekce je zaokrouhlen na 5 desetinných míst) */
const lineTol = (span: number) => 1e-3 + 1e-4 * span;
/** dovolená odchylka bodů křivky od proložené kružnice */
const arcTol = (r: number) => 3e-5 + 2e-4 * r;
const TWO_PI = 2 * Math.PI;

/** Kružnice proložená body metodou nejmenších čtverců; `dev` = největší odchylka bodů. Null = body leží na přímce. */
export function fitCircle(pts: Vec2[]): { c: Vec2; r: number; dev: number } | null {
  const n = pts.length;
  if (n < 3) return null;
  let mx = 0;
  let my = 0;
  for (const p of pts) {
    mx += p[0];
    my += p[1];
  }
  mx /= n;
  my /= n;
  let suu = 0;
  let suv = 0;
  let svv = 0;
  let suuu = 0;
  let svvv = 0;
  let suvv = 0;
  let svuu = 0;
  for (const p of pts) {
    const u = p[0] - mx;
    const v = p[1] - my;
    suu += u * u;
    suv += u * v;
    svv += v * v;
    suuu += u * u * u;
    svvv += v * v * v;
    suvv += u * v * v;
    svuu += v * u * u;
  }
  const det = suu * svv - suv * suv;
  if (Math.abs(det) < 1e-12 * Math.max(1, suu + svv) ** 2) return null;
  const bu = (suuu + suvv) / 2;
  const bv = (svvv + svuu) / 2;
  const uc = (bu * svv - bv * suv) / det;
  const vc = (bv * suu - bu * suv) / det;
  const r = Math.sqrt(uc * uc + vc * vc + (suu + svv) / n);
  const c: Vec2 = [uc + mx, vc + my];
  let dev = 0;
  for (const p of pts) dev = Math.max(dev, Math.abs(dist2(p, c) - r));
  return { c, r, dev };
}

/** úhel bodu vůči středu */
const angOf = (c: Vec2, p: Vec2) => Math.atan2(p[1] - c[1], p[0] - c[0]);
/** rozdíl úhlů v (−π, π] */
const angDiff = (a: number, b: number) => {
  let d = (b - a) % TWO_PI;
  if (d > Math.PI) d -= TWO_PI;
  if (d <= -Math.PI) d += TWO_PI;
  return d;
};

/**
 * Rozloží cestu SVG pohledu na entity pro výběr: přímé úseky (sousední kolineární kroky se spojí – i kružnice viděná
 * z boku, kterou projekce vrací jako řadu krátkých kroků tam a zpět), přesné kruhové oblouky (příkaz A se stejnými
 * poloosami; navazující oblouky téže kružnice se spojí) a oblouky proložené Bézierovými křivkami (obrysy zaoblení).
 * Obecné křivky (elipsy, spline, lomené náhrady křivek) se vynechají – nejde o hranu ani kružnici.
 */
export function pathToEntities(d: string, hidden = false): ViewEnt[] {
  const tokens = d.match(/[MLHVACQZmlhvacqz]|-?\d*\.?\d+(?:e[-+]?\d+)?/g) ?? [];
  const out: ViewEnt[] = [];
  const h = hidden ? { hidden: true } : {};
  // přímé úseky jedné souvislé části cesty (kvůli rozpoznání lomené náhrady křivky se ukládají až na jejím konci)
  type Run = { lo: Vec2; hi: Vec2; dIn: Vec2; dOut: Vec2; next: boolean };
  let runs: Run[] = [];
  let run: Run | null = null;
  let arc: { c: Vec2; r: number; a0: number; da: number } | null = null;
  let fit: { pts: Vec2[] } | null = null;

  const endRun = () => {
    if (run) runs.push(run);
    run = null;
  };
  /** uloží přímé úseky; hladký řetěz 4+ úseků (zlom < 15°) je lomená náhrada křivky → vynechá se (zůstane jen úsek výrazně delší než sousedé = hrana tečně navazující na křivku) */
  const flushRuns = () => {
    endRun();
    const keep = runs.map(() => true);
    const len = (q: Run) => dist2(q.lo, q.hi);
    const turn = (a: Vec2, b: Vec2) => Math.abs(Math.atan2(a[0] * b[1] - a[1] * b[0], a[0] * b[0] + a[1] * b[1]));
    const smooth = (k: number) => runs[k].next && turn(runs[k].dOut, runs[k + 1].dIn) < (15 * Math.PI) / 180;
    for (let a = 0; a < runs.length; ) {
      let b = a;
      while (b + 1 < runs.length && smooth(b)) b++;
      if (b - a + 1 >= 4)
        for (let k = a; k <= b; k++) {
          const near = Math.max(k > a ? len(runs[k - 1]) : 0, k < b ? len(runs[k + 1]) : 0);
          if (len(runs[k]) <= 3 * near) keep[k] = false;
        }
      a = b + 1;
    }
    runs.forEach((q, k) => {
      if (keep[k] && len(q) > 1e-6) out.push({ t: "line", a: q.lo, b: q.hi, ...h });
    });
    runs = [];
  };
  const flushArc = () => {
    if (arc && arc.r > 1e-6 && Math.abs(arc.da) > 1e-9) out.push({ t: "arc", c: arc.c, r: arc.r, a0: arc.a0, da: Math.max(-TWO_PI, Math.min(TWO_PI, arc.da)), ...h });
    arc = null;
  };
  /** oblouk proložený body křivek – jen když body na kružnici opravdu leží */
  const fitted = (pts: Vec2[]) => {
    const f = fitCircle(pts);
    if (!f || f.dev > arcTol(f.r)) return null;
    let da = 0;
    for (let k = 1; k < pts.length; k++) da += angDiff(angOf(f.c, pts[k - 1]), angOf(f.c, pts[k]));
    return { c: f.c, r: f.r, a0: angOf(f.c, pts[0]), da };
  };
  const flushFit = () => {
    if (fit) {
      const a = fitted(fit.pts);
      // jen oblouk se smysluplným rozsahem (≥ 10° a vzepětí ≥ 0,001 mm) – kratší kousek křivky poloměr spolehlivě neurčí
      if (a && Math.abs(a.da) >= (10 * Math.PI) / 180 && a.r * (1 - Math.cos(Math.min(Math.PI, Math.abs(a.da)) / 2)) >= 1e-3) {
        const r3 = Math.round(a.r * 1e3) / 1e3; // šum aproximace obrysu: poloměr na 0,001 mm
        out.push({ t: "arc", c: [Math.round(a.c[0] * 1e4) / 1e4, Math.round(a.c[1] * 1e4) / 1e4], r: Math.abs(r3 - a.r) < 5e-4 ? r3 : a.r, a0: a.a0, da: Math.max(-TWO_PI, Math.min(TWO_PI, a.da)), ...h });
      }
    }
    fit = null;
  };
  const flush = () => {
    flushRuns();
    flushArc();
    flushFit();
  };
  const lineTo = (p: Vec2, q: Vec2) => {
    flushArc();
    flushFit();
    const L = dist2(p, q);
    if (L < 1e-9) return;
    const dir: Vec2 = [(q[0] - p[0]) / L, (q[1] - p[1]) / L];
    if (run) {
      const span = dist2(run.lo, run.hi);
      const ux = (run.hi[0] - run.lo[0]) / span;
      const uy = (run.hi[1] - run.lo[1]) / span;
      const wx = q[0] - run.lo[0];
      const wy = q[1] - run.lo[1];
      if (Math.abs(ux * wy - uy * wx) <= lineTol(Math.max(span, Math.hypot(wx, wy)))) {
        // kolineární pokračování (i zpětný chod)
        const t = ux * wx + uy * wy;
        if (t < 0) run.lo = q;
        else if (t > span) run.hi = q;
        run.dOut = dir;
        return;
      }
      run.next = true;
      endRun();
    }
    run = { lo: p, hi: q, dIn: dir, dOut: dir, next: false };
  };
  const curveTo = (pts: Vec2[]) => {
    // křivka (Bézier): přímá → úsečka; jinak se zkouší kružnice společná s předchozími křivkami
    const a = pts[0];
    const b = pts[pts.length - 1];
    const L = dist2(a, b);
    if (L > 1e-9 && pts.every((q) => Math.abs((b[0] - a[0]) * (q[1] - a[1]) - (b[1] - a[1]) * (q[0] - a[0])) / L <= lineTol(L))) return lineTo(a, b);
    flushRuns();
    flushArc();
    if (fit) {
      const all = [...fit.pts, ...pts.slice(1)];
      if (fitted(all)) {
        fit.pts = all;
        return;
      }
      flushFit();
    }
    fit = { pts };
  };

  let p: Vec2 = [0, 0];
  let start: Vec2 = [0, 0];
  let i = 0;
  let cmd = "";
  const num = () => Number(tokens[i++]);
  while (i < tokens.length) {
    if (/[A-Za-z]/.test(tokens[i])) cmd = tokens[i++].toUpperCase();
    switch (cmd) {
      case "M":
        flush();
        p = [num(), num()];
        start = p;
        cmd = "L";
        break;
      case "L": {
        const q: Vec2 = [num(), num()];
        lineTo(p, q);
        p = q;
        break;
      }
      case "H": {
        const q: Vec2 = [num(), p[1]];
        lineTo(p, q);
        p = q;
        break;
      }
      case "V": {
        const q: Vec2 = [p[0], num()];
        lineTo(p, q);
        p = q;
        break;
      }
      case "C": {
        const c1: Vec2 = [num(), num()];
        const c2: Vec2 = [num(), num()];
        const e: Vec2 = [num(), num()];
        const pts: Vec2[] = [p];
        for (let k = 1; k <= 6; k++) {
          const t = k / 6;
          const u = 1 - t;
          pts.push([u * u * u * p[0] + 3 * u * u * t * c1[0] + 3 * u * t * t * c2[0] + t * t * t * e[0], u * u * u * p[1] + 3 * u * u * t * c1[1] + 3 * u * t * t * c2[1] + t * t * t * e[1]]);
        }
        curveTo(pts);
        p = e;
        break;
      }
      case "Q": {
        const c: Vec2 = [num(), num()];
        const e: Vec2 = [num(), num()];
        const pts: Vec2[] = [p];
        for (let k = 1; k <= 6; k++) {
          const t = k / 6;
          const u = 1 - t;
          pts.push([u * u * p[0] + 2 * u * t * c[0] + t * t * e[0], u * u * p[1] + 2 * u * t * c[1] + t * t * e[1]]);
        }
        curveTo(pts);
        p = e;
        break;
      }
      case "A": {
        const rx = Math.abs(num());
        const ry = Math.abs(num());
        const rotDeg = num();
        const large = num();
        const sweep = num();
        const e: Vec2 = [num(), num()];
        if (rx > 1e-9 && Math.abs(rx - ry) <= 1e-6 * rx && dist2(p, e) > 1e-9) {
          flushRuns();
          flushFit();
          const g = arcGeom(p, e, rx, ry, rotDeg, !!large, !!sweep);
          const c: Vec2 = [g.cx, g.cy];
          // navazující oblouk téže kružnice ve stejném smyslu → jeden oblouk (celá kružnice = dva půloblouky)
          if (arc && Math.abs(arc.r - g.rx) <= 1e-4 && dist2(arc.c, c) <= 1e-3 && Math.sign(arc.da) === Math.sign(g.dt)) arc.da += g.dt;
          else {
            flushArc();
            arc = { c, r: g.rx, a0: angOf(c, p), da: g.dt };
          }
        } else flush(); // elipsa (kružnice viděná šikmo) – není hrana ani kružnice
        p = e;
        break;
      }
      case "Z":
        lineTo(p, start);
        p = start;
        break;
      default:
        i++;
    }
  }
  flush();
  return out;
}

// ---------------------------------------------------------------- vektory

const dot = (a: Vec3, b: Vec3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const sub = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const add = (a: Vec3, b: Vec3): Vec3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const mul = (a: Vec3, k: number): Vec3 => [a[0] * k, a[1] * k, a[2] * k];
const cross = (a: Vec3, b: Vec3): Vec3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const len = (a: Vec3) => Math.hypot(a[0], a[1], a[2]);
const unit = (a: Vec3): Vec3 => mul(a, 1 / (len(a) || 1));
const V = (v: r.Vector): Vec3 => [v.x, v.y, v.z];

// ---------------------------------------------------------------- kamery pohledů

/** d = směr k pozorovateli, x = vodorovná osa obrazu; svislá osa = d × x. */
export type Cam = { d: Vec3; x: Vec3 };
const CAMS: Record<ViewKey | "iso", Cam> = {
  front: { d: [0, -1, 0], x: [1, 0, 0] },
  back: { d: [0, 1, 0], x: [-1, 0, 0] },
  left: { d: [-1, 0, 0], x: [0, -1, 0] }, // pohled zleva (pozorovatel v −X)
  right: { d: [1, 0, 0], x: [0, 1, 0] }, // pohled zprava (pozorovatel v +X)
  top: { d: [0, 0, 1], x: [1, 0, 0] },
  bottom: { d: [0, 0, -1], x: [1, 0, 0] },
  iso: { d: unit([1, -1, 1]), x: unit([1, 1, 0]) },
};

type View = {
  key: string;
  cam: Cam;
  polys: Poly[];
  /** hrany a kružnice pohledu pro výběr při kótování (souřadnice obrazu) */
  ents: ViewEnt[];
  /** rozsah v souřadnicích obrazu (SVG: y dolů) */
  x0: number;
  y0: number;
  w: number;
  h: number;
};

type Placed = View & { px: number; py: number; s: number };

const upOf = (c: Cam) => cross(c.d, c.x);
/** 3D bod → souřadnice obrazu (SVG, y dolů) */
export const proj = (c: Cam, p: Vec3): Vec2 => [dot(p, c.x), -dot(p, upOf(c))];
/** obraz → list */
const toSheet = (v: Placed, q: Vec2): Vec2 => [v.px + (q[0] - v.x0) * v.s, v.py + (q[1] - v.y0) * v.s];
const at = (v: Placed, p: Vec3) => toSheet(v, proj(v.cam, p));

/** kosinus a sinus otočení hlavního pohledu (přesné hodnoty – kamery zůstanou rovnoběžné s osami) */
const ROT_CS: Record<ViewRotation, [number, number]> = { 0: [1, 0], 90: [0, 1], 180: [-1, 0], 270: [0, -1] };
const asRotation = (v: unknown): ViewRotation => (v === 90 || v === 180 || v === 270 ? v : 0);
/**
 * Otočení vektoru kolem směru hlavního pohledu (osa k pozorovateli). Použité na kamery všech pohledů otočí obraz hlavního
 * pohledu na listu po směru hodin a ostatní pohledy zůstanou jeho průměty (půdorys = pohled shora na otočený hlavní pohled).
 */
function rotV(v: Vec3, rot: ViewRotation): Vec3 {
  if (!rot) return v;
  const [c, s] = ROT_CS[rot];
  const d = CAMS.front.d;
  const w = cross(d, v);
  const k = dot(d, v) * (1 - c);
  return [c * v[0] + s * w[0] + k * d[0] || 0, c * v[1] + s * w[1] + k * d[1] || 0, c * v[2] + s * w[2] + k * d[2] || 0];
}
/** kamera pohledu při daném otočení hlavního pohledu */
export const camOf = (key: ViewKey | "iso", rot: ViewRotation): Cam => (rot ? { d: rotV(CAMS[key].d, rot), x: rotV(CAMS[key].x, rot) } : CAMS[key]);

/**
 * Mezipaměť projekcí (HLR je nejdražší krok): pro totéž těleso a směr pohledu se počítá jen jednou a drží viditelné i skryté
 * hrany zároveň – zapnutí / vypnutí skrytých hran, změna listu, měřítka, razítka nebo kót už projekci znovu nespouští.
 * Klíčem je jen směr pohledu: pohled z téhož směru s jinak natočeným obrazem (otočení hlavního pohledu o 90° / 180° / 270°,
 * otočený půdorys = dřívější bokorys…) je otočením hotového obrazu v rovině, projekce se znovu nepočítá.
 * Skryté hrany se z výsledku HLR převádějí na čáry až při prvním použití.
 */
type ViewGeom = { vis: Vec2[][]; visEnts: ViewEnt[]; hid: Vec2[][] | null; hidEnts: ViewEnt[]; box: { x0: number; y0: number; w: number; h: number } };
/** výsledek HLR jednoho směru: obraz pro první použitou vodorovnou osu `x` (+ jeho otočené kopie podle osy obrazu) */
type RawView = ViewGeom & { x: Vec3; up: Vec3; hiddenSrc: r.Drawing | null; turned: Map<string, ViewGeom> };
const viewCache = new WeakMap<object, Map<string, RawView>>();
/** počet skutečně spuštěných projekcí (HLR) a řezů – pro testy mezipaměti a měření */
export const projectionStats = { hlr: 0, section: 0 };

function drawingPaths(d: r.Drawing): string[] {
  try {
    return (d.toSVGPaths() as unknown as (string | string[])[]).flat();
  } catch {
    return [];
  }
}
function pathsToGeometry(paths: string[], hidden: boolean): { lines: Vec2[][]; ents: ViewEnt[] } {
  const lines: Vec2[][] = [];
  const ents: ViewEnt[] = [];
  for (const path of paths) {
    lines.push(...pathToPolylines(path));
    try {
      ents.push(...pathToEntities(path, hidden));
    } catch {
      /* rozpoznání hran nesmí výkres shodit – v pohledu jen nepůjde vybrat hranu / kružnici */
    }
  }
  return { lines, ents };
}
/** klíč směru (bez „-0“, zaokrouhlený – kamery otočených pohledů se počítají s přesností double) */
const dirKey = (v: Vec3) => v.map((x) => k3(x, 9)).join(",");
function rawView(shape: r.Shape3D, cam: Cam): RawView {
  let m = viewCache.get(shape);
  if (!m) viewCache.set(shape, (m = new Map()));
  const ck = dirKey(cam.d);
  let v = m.get(ck);
  if (!v) {
    projectionStats.hlr++;
    const p = r.drawProjection(shape, new r.ProjectionCamera([0, 0, 0], cam.d, cam.x));
    const g = pathsToGeometry(drawingPaths(p.visible), false);
    v = { vis: g.lines, visEnts: g.ents, hiddenSrc: p.hidden, hid: null, hidEnts: [], box: extentOf(g.lines), x: cam.x, up: upOf(cam), turned: new Map() };
    m.set(ck, v);
  }
  return v;
}
/** otočení obrazu v rovině: (u, v) → (a·u − b·v, b·u + a·v) */
const turn2 = (a: number, b: number) => (q: Vec2): Vec2 => [a * q[0] - b * q[1] || 0, b * q[0] + a * q[1] || 0];
function turnEnts(ents: ViewEnt[], a: number, b: number): ViewEnt[] {
  const f = turn2(a, b);
  const th = Math.atan2(b, a);
  return ents.map((e) => (e.t === "line" ? { ...e, a: f(e.a), b: f(e.b) } : { ...e, c: f(e.c), a0: e.a0 + th }));
}
/** obraz pro kameru `cam` (týž směr jako `raw`, případně jinak natočená osa x) */
function viewGeom(raw: RawView, cam: Cam): ViewGeom {
  // x = a·x₀ + b·up₀ → obraz se otočí o úhel atan2(b, a) (osa v obrazu míří dolů: v = −p·up)
  const a = dot(cam.x, raw.x);
  const b = dot(cam.x, raw.up);
  if (Math.abs(a - 1) < 1e-12) return raw;
  const k = `${k3(a, 9)},${k3(b, 9)}`;
  let g = raw.turned.get(k);
  if (!g) {
    const f = turn2(a, b);
    const vis = raw.vis.map((l) => l.map(f));
    g = { vis, visEnts: turnEnts(raw.visEnts, a, b), hid: null, hidEnts: [], box: extentOf(vis) };
    raw.turned.set(k, g);
  }
  if (raw.hid && !g.hid) {
    const f = turn2(a, b);
    g.hid = raw.hid.map((l) => l.map(f));
    g.hidEnts = turnEnts(raw.hidEnts, a, b);
    if (!g.vis.length) g.box = extentOf(g.hid);
  }
  return g;
}
function projectView(shape: r.Shape3D, key: string, cam: Cam, withHidden: boolean, layer: Layer = "visible"): View {
  const raw = rawView(shape, cam);
  if (withHidden && !raw.hid) {
    const g = raw.hiddenSrc ? pathsToGeometry(drawingPaths(raw.hiddenSrc), true) : { lines: [], ents: [] };
    raw.hid = g.lines;
    raw.hidEnts = g.ents;
    raw.hiddenSrc = null;
    if (!raw.vis.length) raw.box = extentOf(raw.hid);
  }
  const geo = viewGeom(raw, cam);
  const polys: Poly[] = geo.vis.map((pts) => ({ pts, layer }));
  if (withHidden) for (const pts of geo.hid ?? []) polys.push({ pts, layer: "hidden" });
  // izometrie (tenká čára) se nekótuje
  const ents = layer === "visible" ? (withHidden ? [...geo.visEnts, ...geo.hidEnts] : geo.visEnts) : [];
  return { key, cam, polys, ents, ...geo.box };
}
const extentOf = (lines: Vec2[][]) => extent(lines.map((pts) => ({ pts, layer: "visible" as Layer })));

function extent(polys: Poly[]) {
  let x0 = Infinity,
    y0 = Infinity,
    x1 = -Infinity,
    y1 = -Infinity;
  for (const pl of polys)
    for (const [x, y] of pl.pts) {
      if (x < x0) x0 = x;
      if (y < y0) y0 = y;
      if (x > x1) x1 = x;
      if (y > y1) y1 = y;
    }
  if (!Number.isFinite(x0)) return { x0: 0, y0: 0, w: 0, h: 0 };
  return { x0, y0, w: x1 - x0, h: y1 - y0 };
}

// ---------------------------------------------------------------- kružnice (osy, průměry)

type Circle = { c: Vec3; r: number; a: Vec3; /** hrana ohraničuje válcovou plochu */ cyl: boolean };

/** zaokrouhlení bez „-0“ (kvůli klíčům) */
const k3 = (v: number, d: number) => (Math.abs(v) < 0.5 * 10 ** -d ? 0 : v).toFixed(d);

function circleOf(e: r.Edge): Omit<Circle, "cyl"> | null {
  if (e.geomType !== "CIRCLE" || !e.isClosed) return null;
  const p0 = V(e.pointAt(0));
  const p1 = V(e.pointAt(1 / 3));
  const p2 = V(e.pointAt(2 / 3));
  const c = circumcenter(p0, p1, p2);
  if (!c) return null;
  const a = unit(cross(sub(p1, p0), sub(p2, p0)));
  // normalizace směru osy (kvůli seskupení)
  const k = [0, 1, 2].reduce((m, i) => (Math.abs(a[i]) > Math.abs(a[m]) ? i : m), 0);
  return { c, r: len(sub(p0, c)), a: a[k] < 0 ? mul(a, -1) : a };
}

const circleKey = (c: Omit<Circle, "cyl">) => `${c.c.map((v) => k3(v, 3)).join()}|${k3(c.r, 3)}`;

const circleCache = new WeakMap<object, Circle[]>();
function circlesOf(shape: r.Shape3D): Circle[] {
  const c = circleCache.get(shape);
  if (c) return c;
  const out = circlesOfRaw(shape);
  circleCache.set(shape, out);
  return out;
}
function circlesOfRaw(shape: r.Shape3D): Circle[] {
  const out: Circle[] = [];
  const onCyl = new Set<string>();
  try {
    for (const f of shape.faces) {
      if (f.geomType !== "CYLINDRE") continue;
      for (const e of f.edges) {
        try {
          const c = circleOf(e);
          if (c) onCyl.add(circleKey(c));
        } catch {
          /* bez geometrie */
        }
      }
    }
  } catch {
    /* plochy nedostupné */
  }
  let edges: r.Edge[] = [];
  try {
    edges = shape.edges;
  } catch {
    return out;
  }
  for (const e of edges) {
    try {
      const c = circleOf(e);
      if (c) out.push({ ...c, cyl: onCyl.has(circleKey(c)) });
    } catch {
      /* hrana bez geometrie */
    }
  }
  // válcové plochy bez kruhových hran (díra vrtaná do kužele / tvarové plochy končí prostorovou křivkou): konce válce se doplní
  // jako kružnice na ose, aby díra dostala osu, kótu průměru i řádek v tabulce děr stejně jako díra v rovinné ploše
  const have = new Set(out.map(circleKey));
  for (const cy of fullCylinders(shape)) {
    for (const t of [cy.tmin, cy.tmax]) {
      const c = { c: add(cy.base, mul(cy.a, t)), r: cy.r, a: cy.a };
      const k = circleKey(c);
      if (have.has(k) || onCyl.has(k)) continue;
      have.add(k);
      out.push({ ...c, cyl: true });
    }
  }
  return out;
}

type Cylinder = { a: Vec3; /** bod osy nejblíž počátku */ base: Vec3; r: number; tmin: number; tmax: number };

/** Válcové plochy s úplným obvodem (360°; i složené ze dvou a více ploch téhož válce): osa, poloměr a rozsah podél osy. */
function fullCylinders(shape: r.Shape3D): Cylinder[] {
  type Part = Cylinder & { ang: number };
  const groups = new Map<string, Part[]>();
  let faces: r.Face[] = [];
  try {
    faces = shape.faces;
  } catch {
    return [];
  }
  for (const f of faces) {
    try {
      if (f.geomType !== "CYLINDRE") continue;
      const b = f.UVBounds;
      const du = b.uMax - b.uMin;
      if (!(du > 1e-6) || !(Math.abs(b.vMax - b.vMin) > 1e-9)) continue;
      const P = (u: number, v: number) => V(f.pointOnSurface(u, v));
      const full = du >= TWO_PI - 1e-6;
      const p0 = P(0, 0);
      const p1 = P(full ? 1 / 3 : 0.5, 0);
      const p2 = P(full ? 2 / 3 : 1, 0);
      const c0 = circumcenter(p0, p1, p2);
      if (!c0) continue;
      let a = unit(sub(P(0, 1), p0));
      const k = [0, 1, 2].reduce((m, i) => (Math.abs(a[i]) > Math.abs(a[m]) ? i : m), 0);
      if (a[k] < 0) a = mul(a, -1);
      const t0 = dot(c0, a);
      const t1 = dot(P(0, 1), a);
      const base = sub(c0, mul(a, t0));
      const rad = len(sub(p0, c0));
      const key = `${a.map((v) => k3(v, 3)).join()}|${base.map((v) => k3(v, 2)).join()}|${k3(rad, 3)}`;
      const list = groups.get(key) ?? [];
      list.push({ a, base, r: rad, tmin: Math.min(t0, t1), tmax: Math.max(t0, t1), ang: du });
      groups.set(key, list);
    } catch {
      /* plocha bez geometrie */
    }
  }
  const out: Cylinder[] = [];
  for (const list of groups.values()) {
    // části téhož válce, které se podél osy překrývají, tvoří jeden válec – úplný je, když dají dohromady celý obvod
    list.sort((x, y) => x.tmin - y.tmin);
    let cur: Part | null = null;
    const flush = () => {
      if (cur && cur.ang >= TWO_PI - 1e-3) out.push({ a: cur.a, base: cur.base, r: cur.r, tmin: cur.tmin, tmax: cur.tmax });
    };
    for (const p of list) {
      if (cur && p.tmin < cur.tmax - 1e-6) {
        cur.tmax = Math.max(cur.tmax, p.tmax);
        cur.ang += p.ang;
      } else {
        flush();
        cur = { ...p };
      }
    }
    flush();
  }
  return out;
}

function circumcenter(a: Vec3, b: Vec3, c: Vec3): Vec3 | null {
  const ab = sub(b, a);
  const ac = sub(c, a);
  const n = cross(ab, ac);
  const n2 = dot(n, n);
  if (n2 < 1e-12) return null;
  const t1 = mul(cross(n, ab), dot(ac, ac));
  const t2 = mul(cross(ac, n), dot(ab, ab));
  return add(a, mul(add(t1, t2), 1 / (2 * n2)));
}

// ---------------------------------------------------------------- řez

const PLANE_N: Record<PlaneName, Vec3> = { XY: [0, 0, 1], XZ: [0, 1, 0], YZ: [1, 0, 0] };
/** kamera řezu a strana, ze které se materiál odebere (strana pozorovatele) */
const SECTION_CAM: Record<PlaneName, Cam> = {
  XZ: CAMS.front, // pozorovatel v −Y, odebírá se y < offset
  YZ: CAMS.left, // pozorovatel v −X, odebírá se x < offset
  XY: CAMS.top, // pozorovatel v +Z, odebírá se z > offset
};

/**
 * Kamera řezu při otočeném hlavním pohledu: směr pohledu určuje rovina řezu (v modelu), natočení obrazu se bere z pohledu,
 * který se po otočení dívá stejným směrem – řez tak zůstane průmětem hlavního pohledu.
 */
function sectionCam(plane: PlaneName, rot: ViewRotation): Cam {
  const base = SECTION_CAM[plane];
  if (!rot) return base;
  for (const k of ISO_KEYS) {
    const c = camOf(k, rot);
    if (dot(c.d, base.d) > 0.999) return c;
  }
  return base;
}

/** dělicí přímka polovičního řezu v obraze (osa souměrnosti): `axis` 0 = svislá přímka u = c, 1 = vodorovná v = c */
type SplitLine = { axis: 0 | 1; c: number };
type SectionData = { view: View; loops: Vec2[][]; split?: SplitLine };

/** Osy, na kterých leží 3 a více různých průměrů (soustružený díl): směr, bod osy nejblíž počátku a počet kružnic. */
function turnedAxes(circles: Circle[]): { a: Vec3; base: Vec3; n: number }[] {
  const m = new Map<string, { a: Vec3; base: Vec3; n: number; radii: Set<string> }>();
  for (const c of circles) {
    const base = sub(c.c, mul(c.a, dot(c.c, c.a)));
    const k = `${c.a.map((v) => k3(v, 3)).join()}|${base.map((v) => k3(v, 2)).join()}`;
    const g = m.get(k) ?? { a: c.a, base, n: 0, radii: new Set<string>() };
    g.n++;
    g.radii.add((Math.round(c.r * 20) / 20).toFixed(2));
    m.set(k, g);
  }
  return [...m.values()].filter((g) => g.radii.size > 2).sort((x, y) => y.n - x.n);
}

const axisAligned = (v: Vec3) => v.filter((x) => Math.abs(x) > 1e-9).length === 1;

const sectionCache = new WeakMap<object, Map<string, SectionData | null>>();
/** těleso po odebrání části před rovinou řezu (podle odebírané oblasti) */
const cutCache = new WeakMap<object, Map<string, r.Shape3D>>();
function makeSection(shape: r.Shape3D, sec: SectionOpt, cam: Cam, circles: () => Circle[]): SectionData | null {
  let m = sectionCache.get(shape);
  if (!m) sectionCache.set(shape, (m = new Map()));
  const half = sec.kind === "half";
  const k = `${sec.plane}|${sec.offset}|${half ? "half" : "full"}|${cam.d.join(",")}|${cam.x.join(",")}`;
  if (m.has(k)) return m.get(k) ?? null;
  projectionStats.section++;
  const s = makeSectionRaw(shape, sec.plane, sec.offset, cam, half ? circles() : null);
  m.set(k, s);
  return s;
}
/** `circles` = kružnice tělesa pro poloviční řez (hledá se osa souměrnosti); null = celý řez */
function makeSectionRaw(shape: r.Shape3D, plane: PlaneName, offset: number, cam: Cam, circles: Circle[] | null): SectionData | null {
  const n = PLANE_N[plane];
  const [[x0, y0, z0], [x1, y1, z1]] = shape.boundingBox.bounds as [Vec3, Vec3];
  const pad = Math.hypot(x1 - x0, y1 - y0, z1 - z0) + 10;
  const lo: Vec3 = [x0 - pad, y0 - pad, z0 - pad];
  const hi: Vec3 = [x1 + pad, y1 + pad, z1 + pad];
  // odebíraná strana = strana pozorovatele (ve směru d)
  const viewerPositive = dot(cam.d, n) > 0;
  const k = n.indexOf(1);
  const bLo = [...lo] as Vec3;
  const bHi = [...hi] as Vec3;
  if (viewerPositive) bLo[k] = offset;
  else bHi[k] = offset;
  if (offset <= [x0, y0, z0][k] || offset >= [x1, y1, z1][k]) return null;
  let split: SplitLine | undefined;
  if (circles) {
    // poloviční řez: odebere se jen čtvrtina před rovinou řezu – vpravo od svislé osy souměrnosti, nebo pod vodorovnou
    const up = upOf(cam);
    const ax = turnedAxes(circles).find((g) => Math.abs(dot(g.a, n)) < 1e-6 && Math.abs(dot(g.base, n) - offset) < 1e-4 && axisAligned(g.a));
    const base: Vec3 = ax ? ax.base : [(x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2];
    const horizontal = ax ? Math.abs(dot(ax.a, cam.x)) > 0.5 : false;
    const m = horizontal ? mul(up, -1) : cam.x;
    const j = m.findIndex((v) => Math.abs(v) > 0.5);
    if (m[j] > 0) bLo[j] = base[j];
    else bHi[j] = base[j];
    split = horizontal ? { axis: 1, c: -dot(base, up) } : { axis: 0, c: dot(base, cam.x) };
  }
  // booleovská operace se pro tutéž odebíranou oblast nepočítá znovu (jiné natočení obrazu = jen otočení hotové projekce)
  let cuts = cutCache.get(shape);
  if (!cuts) cutCache.set(shape, (cuts = new Map()));
  const ck = `${bLo.join(",")}|${bHi.join(",")}`;
  let cut = cuts.get(ck);
  if (!cut) cuts.set(ck, (cut = shape.clone().cut(r.makeBox(bLo, bHi)) as r.Shape3D));
  const view = projectView(cut, "section", cam, false);
  if (split) {
    // hranice mezi polovinou pohledu a polovinou řezu se nekreslí obrysem – je jí osa souměrnosti (tenká čerchovaná)
    const line = split;
    view.polys = dropOnLine(view.polys, line);
    view.ents = view.ents.filter((e) => !(e.t === "line" && onLine(e.a, line) && onLine(e.b, line)));
  }
  const loops: Vec2[][] = [];
  const tol = Math.max(1e-4, pad * 1e-6);
  for (const f of cut.faces) {
    try {
      if (f.geomType !== "PLANE") continue;
      const c = V(f.center);
      if (Math.abs(dot(c, n) - offset) > tol * 10) continue;
      const fn = V(f.normalAt(f.center));
      if (Math.abs(Math.abs(dot(fn, n)) - 1) > 1e-6) continue;
      for (const e of f.edges) {
        const nseg = e.geomType === "LINE" ? 1 : 40;
        const pts: Vec2[] = [];
        for (let i = 0; i <= nseg; i++) pts.push(proj(cam, V(e.pointAt(i / nseg))));
        loops.push(pts);
      }
    } catch {
      /* plocha bez geometrie */
    }
  }
  if (!loops.length) return null;
  return { view, loops, split };
}

const onLine = (p: Vec2, l: SplitLine, tol = 1e-4) => Math.abs(p[l.axis] - l.c) < tol;
/** vynechá úseky lomených čar ležící na dělicí přímce polovičního řezu */
function dropOnLine(polys: Poly[], l: SplitLine): Poly[] {
  const out: Poly[] = [];
  for (const pl of polys) {
    if (pl.layer !== "visible" || !pl.pts.some((p) => onLine(p, l))) {
      out.push(pl);
      continue;
    }
    let cur: Vec2[] = [pl.pts[0]];
    for (let i = 1; i < pl.pts.length; i++) {
      if (onLine(pl.pts[i - 1], l) && onLine(pl.pts[i], l)) {
        if (cur.length > 1) out.push({ ...pl, pts: cur });
        cur = [pl.pts[i]];
      } else cur.push(pl.pts[i]);
    }
    if (cur.length > 1) out.push({ ...pl, pts: cur });
  }
  return out;
}

/** Šrafování 45° (ISO 128-50) – sudo-lichým pravidlem přes úsečky obrysu, v souřadnicích listu. */
export function hatch(segsPolys: Vec2[][], spacing = 2.5, angleDeg = 45): Vec2[][] {
  const a = (angleDeg * Math.PI) / 180;
  const ca = Math.cos(a);
  const sa = Math.sin(a);
  // otočit tak, aby šrafy byly vodorovné
  const rot = ([x, y]: Vec2): Vec2 => [x * ca + y * sa, -x * sa + y * ca];
  const unrot = ([x, y]: Vec2): Vec2 => [x * ca - y * sa, x * sa + y * ca];
  const segs: [Vec2, Vec2][] = [];
  let ymin = Infinity,
    ymax = -Infinity;
  for (const pl of segsPolys)
    for (let i = 1; i < pl.length; i++) {
      const p = rot(pl[i - 1]);
      const q = rot(pl[i]);
      segs.push([p, q]);
      ymin = Math.min(ymin, p[1], q[1]);
      ymax = Math.max(ymax, p[1], q[1]);
    }
  const out: Vec2[][] = [];
  if (!segs.length) return out;
  const start = Math.ceil(ymin / spacing) * spacing;
  for (let y = start; y <= ymax; y += spacing) {
    const xs: number[] = [];
    for (const [p, q] of segs) {
      if ((p[1] <= y && q[1] > y) || (q[1] <= y && p[1] > y)) xs.push(p[0] + ((y - p[1]) / (q[1] - p[1])) * (q[0] - p[0]));
    }
    xs.sort((m, n) => m - n);
    for (let i = 0; i + 1 < xs.length; i += 2) if (xs[i + 1] - xs[i] > 1e-6) out.push([unrot([xs[i], y]), unrot([xs[i + 1], y])]);
  }
  return out;
}

// ---------------------------------------------------------------- formát čísel

const fmt = (n: number) => (Math.round(n * 100) / 100).toLocaleString(cadLocale());

// ---------------------------------------------------------------- hlavní funkce

const ISO_KEYS: ViewKey[] = ["front", "top", "left", "right", "back", "bottom"];
type Slot = "center" | "above" | "below" | "left" | "right" | "far";

function slotOf(key: ViewKey, projection: "E" | "A"): Slot {
  if (key === "front") return "center";
  if (key === "back") return "far";
  if (projection === "E") return ({ top: "below", bottom: "above", left: "right", right: "left" } as const)[key];
  return ({ top: "above", bottom: "below", left: "left", right: "right" } as const)[key];
}

const M_LEFT = 20; // ISO 5457: okraj pro vazbu
const M = 10;
const TB = { w: 180, h: 38 };
let GAP = 24; // mezera mezi pohledy (místo pro kóty); chytré kóty ji zvětší (opts.dimRoom)
const DIM_ROOM = 14;
/** řada kót průměrů vedle pohledu: odstup první kótovací čáry od obrysu, rozteč čar a nejvyšší počet kót [mm listu] */
const STACK_BASE = 9;
const STACK_PITCH = 6.5;
const STACK_MAX = 16;

type Side = "l" | "t" | "r" | "b";
type Pad = Record<Side, number>;
type Rect = { x: number; y: number; w: number; h: number };
const noPad = (): Pad => ({ l: 0, t: 0, r: 0, b: 0 });
const atLeast = (p: Pad, min: number): Pad => ({ l: Math.max(p.l, min), t: Math.max(p.t, min), r: Math.max(p.r, min), b: Math.max(p.b, min) });
const inflate = (q: Rect, p: Pad): Rect => ({ x: q.x - p.l, y: q.y - p.t, w: q.w + p.l + p.r, h: q.h + p.t + p.b });
const overlaps = (a: Rect, b: Rect) => a.x < b.x + b.w - 1e-6 && b.x < a.x + a.w - 1e-6 && a.y < b.y + b.h - 1e-6 && b.y < a.y + a.h - 1e-6;
const inside = (a: Rect, b: Rect) => a.x >= b.x - 1e-6 && a.y >= b.y - 1e-6 && a.x + a.w <= b.x + b.w + 1e-6 && a.y + a.h <= b.y + b.h + 1e-6;
function boundsOf(rects: Rect[]): Rect {
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  for (const q of rects) {
    x0 = Math.min(x0, q.x);
    y0 = Math.min(y0, q.y);
    x1 = Math.max(x1, q.x + q.w);
    y1 = Math.max(y1, q.y + q.h);
  }
  return Number.isFinite(x0) ? { x: x0, y: y0, w: x1 - x0, h: y1 - y0 } : { x: 0, y: 0, w: 0, h: 0 };
}

/** pohled v mřížce promítání: sloupec (0 vlevo · 1 hlavní · 2 vpravo · 3+ další), řádek (0 nad · 1 hlavní · 2 pod) a místo na kóty vedle něj */
type Cell = { v: View; col: number; row: number; pad: Pad };
const SLOT_CELL: Record<Exclude<Slot, "far">, [number, number]> = { center: [1, 1], above: [1, 0], below: [1, 2], left: [0, 1], right: [2, 1] };

/**
 * Polohy sloupců a řádků mřížky pohledů [mm listu, od levého horního rohu prvního pohledu]. Mezi sousedními sloupci / řádky
 * je mezera GAP; kde vedle pohledu leží řada kót (pad) a v témže řádku / sloupci za ní následuje další pohled, mezera se zvětší.
 * Řada kót, za kterou žádný pohled není, mezeru nezvětšuje – využije volné pole mřížky nebo okraj listu.
 */
function gridLayout(cells: Cell[], s: number) {
  const axis = (pos: (c: Cell) => number, other: (c: Cell) => number, size: (c: Cell) => number, before: Side, after: Side) => {
    const idx = [...new Set(cells.map(pos))].sort((a, b) => a - b);
    const body = new Map<number, number>();
    for (const c of cells) body.set(pos(c), Math.max(body.get(pos(c)) ?? 0, size(c) * s));
    const at = new Map<number, number>();
    idx.forEach((j, n) => {
      let p = 0;
      for (let m = 0; m < n; m++) {
        const i = idx[m];
        let need = m === n - 1 ? GAP : -Infinity;
        for (const a of cells) {
          if (pos(a) !== i) continue;
          const b = cells.find((q) => other(q) === other(a) && pos(q) === j);
          if (!b || cells.some((q) => other(q) === other(a) && pos(q) > i && pos(q) < j)) continue;
          if (a.pad[after] + b.pad[before] > 0) need = Math.max(need, a.pad[after] + b.pad[before] + 8);
        }
        if (need > -Infinity) p = Math.max(p, at.get(i)! + body.get(i)! + need);
      }
      at.set(j, p);
    });
    return { at, body };
  };
  const cx = axis((c) => c.col, (c) => c.row, (c) => c.v.w, "l", "r");
  const cy = axis((c) => c.row, (c) => c.col, (c) => c.v.h, "t", "b");
  const rectOf = (c: Cell): Rect => ({ x: cx.at.get(c.col)! + (cx.body.get(c.col)! - c.v.w * s) / 2, y: cy.at.get(c.row)! + (cy.body.get(c.row)! - c.v.h * s) / 2, w: c.v.w * s, h: c.v.h * s });
  return { rectOf };
}

/**
 * Volné místo pro obdélník w × h uvnitř `bounds`, které nepřekrývá žádný z obsazených obdélníků. Zkouší se polohy přisazené
 * k okrajům a k obsazeným obdélníkům (a zadané zarovnané polohy `ys`); vybere se ta s nejnižším skóre. Null = nevejde se.
 */
function findSpot(bounds: Rect, occupied: Rect[], w: number, h: number, score: (x: number, y: number) => number, ys: number[] = []): Vec2 | null {
  const gap = 4;
  const xs = new Set<number>([bounds.x, bounds.x + bounds.w - w]);
  const yc = new Set<number>([bounds.y, bounds.y + bounds.h - h, ...ys]);
  for (const o of occupied) {
    xs.add(o.x + o.w + gap);
    xs.add(o.x);
    xs.add(o.x - w - gap);
    yc.add(o.y + o.h + gap);
    yc.add(o.y);
    yc.add(o.y - h - gap);
  }
  let best: Vec2 | null = null;
  let bs = Infinity;
  for (const x of xs)
    for (const y of yc) {
      const q: Rect = { x, y, w, h };
      if (!inside(q, bounds) || occupied.some((o) => overlaps(q, o))) continue;
      const sc = score(x, y);
      if (sc < bs) {
        bs = sc;
        best = [x, y];
      }
    }
  return best;
}

/** Největší volný obdélník pro obraz s poměrem stran iw × ih (izometrie): vrací místo a měřítko (nejvýš `maxScale`). */
function largestFree(bounds: Rect, occupied: Rect[], iw: number, ih: number, maxScale: number): (Rect & { s: number }) | null {
  const gap = 6;
  const xs = [bounds.x, ...occupied.map((o) => o.x + o.w + gap)];
  const ys = [bounds.y, ...occupied.map((o) => o.y + o.h + gap)];
  const right = bounds.x + bounds.w;
  const bottom = bounds.y + bounds.h;
  let best: (Rect & { s: number }) | null = null;
  for (const x0 of xs)
    for (const y0 of ys) {
      if (x0 >= right - 25 || y0 >= bottom - 25) continue;
      const x1s = [right, ...occupied.filter((o) => o.x - gap > x0 + 25).map((o) => o.x - gap)];
      for (const x1 of x1s) {
        if (x1 > right) continue;
        let y1 = bottom;
        let ok = true;
        for (const o of occupied) {
          if (o.x >= x1 - 1e-6 || o.x + o.w <= x0 + 1e-6) continue; // mimo vodorovný rozsah
          if (o.y + o.h <= y0 + 1e-6) continue; // nad
          if (o.y <= y0 + gap) {
            ok = false;
            break;
          }
          y1 = Math.min(y1, o.y - gap);
        }
        if (!ok) continue;
        const w = x1 - x0;
        const h = y1 - y0;
        if (w < 25 || h < 25) continue;
        const s = Math.min(maxScale, (w * 0.9) / iw, (h * 0.9) / ih);
        if (!best || s > best.s + 1e-9 || (Math.abs(s - best.s) <= 1e-9 && w * h > best.w * best.h)) best = { x: x0, y: y0, w, h, s };
      }
    }
  return best;
}

/** pohled mimo mřížku promítání (řez, který se do řady nevešel, pohled jiného modelu): hledá se pro něj volné místo na listu */
type Extra = { v: View; pad: Pad; /** "auto" = měřítko listu nebo nejbližší menší, při kterém se pohled vejde */ scale: "auto" | number; name?: string; alignMain?: boolean };
type Item = { v: View; pad: Pad; s: number; rect: Rect; grid: boolean; name?: string; lost?: boolean };

/** kóta celkového rozměru: pohled, strana (nahoře = šířka, vlevo = výška) */
type OverallDim = { key: string; side: "t" | "l" };
function overallPlan(has: (k: string) => boolean, modelKeys: string[]): OverallDim[] {
  const out: OverallDim[] = [];
  const front = has("front");
  let depthDone = false;
  if (front) out.push({ key: "front", side: "t" }, { key: "front", side: "l" });
  for (const k of ["left", "right"]) {
    if (!has(k) || depthDone) continue;
    out.push({ key: k, side: "t" });
    depthDone = true;
    if (!front) out.push({ key: k, side: "l" });
  }
  for (const k of ["top", "bottom"]) {
    if (!has(k)) continue;
    if (!depthDone) {
      out.push({ key: k, side: "l" });
      depthDone = true;
    }
    if (!front) out.push({ key: k, side: "t" });
    break;
  }
  for (const k of modelKeys) out.push({ key: k, side: "t" }, { key: k, side: "l" });
  return out;
}

/** řada kót průměrů soustružené osy: pohled, strana, válce od nejmenšího (nejblíž obrysu) po největší */
type StackPlan = { key: string; side: Side; a: Vec3; base: Vec3; items: { r: number; tmin: number; tmax: number }[]; /** odstup první kótovací čáry od obrysu */ base0: number; /** osa je v pohledu šikmo – kóty se kreslí přes válec */ inline?: boolean };

/** Válce na soustružených osách (3+ různých průměrů na ose): válcová plocha = dvě kružnice stejného poloměru na ose. */
function turnedCylinders(circles: Circle[]): { a: Vec3; base: Vec3; items: StackPlan["items"]; keys: string[] }[] {
  const lineKey = (c: Circle) => `${c.a.map((v) => k3(v, 3)).join()}|${sub(c.c, mul(c.a, dot(c.c, c.a))).map((v) => k3(v, 2)).join()}`;
  const lines = new Map<string, { a: Vec3; base: Vec3; radii: Set<string>; groups: Map<string, { r: number; tmin: number; tmax: number; n: number }> }>();
  for (const c of circles) {
    const k = lineKey(c);
    const g = lines.get(k) ?? { a: c.a, base: sub(c.c, mul(c.a, dot(c.c, c.a))), radii: new Set<string>(), groups: new Map() };
    g.radii.add((Math.round(c.r * 20) / 20).toFixed(2));
    if (c.cyl) {
      const t = dot(c.c, c.a);
      const rk = k3(c.r, 2);
      const q = g.groups.get(rk);
      if (q) {
        q.tmin = Math.min(q.tmin, t);
        q.tmax = Math.max(q.tmax, t);
        q.n++;
      } else g.groups.set(rk, { r: c.r, tmin: t, tmax: t, n: 1 });
    }
    lines.set(k, g);
  }
  const out: ReturnType<typeof turnedCylinders> = [];
  for (const [k, g] of lines) {
    if (g.radii.size <= 2) continue;
    const list = [...g.groups.entries()].filter(([, q]) => q.n >= 2 && q.tmax - q.tmin >= 1e-3).sort((x, y) => x[1].r - y[1].r);
    if (list.length) out.push({ a: g.a, base: g.base, items: list.map(([, q]) => ({ r: q.r, tmin: q.tmin, tmax: q.tmax })), keys: list.map(([rk]) => `${rk}|${k}`) });
  }
  return out;
}

export function makeDrawing(shape: r.Shape3D, meta: DrawingMeta, options: Partial<DrawingOptions> = {}, extra: Record<string, r.Shape3D> = {}): DrawingResult {
  const opts: DrawingOptions = { ...defaultDrawingOptions, ...options, views: { ...defaultDrawingOptions.views, ...(options.views ?? {}) } };
  const rot = asRotation(opts.rotation);
  const ROOM = opts.dimRoom ?? 0;
  const loose = opts.dimRoomMin != null;
  const ROOM_MIN = Math.min(ROOM, opts.dimRoomMin ?? ROOM);
  const warnings: string[] = [];
  const circlesAll = opts.centerLines || opts.dimensions === "auto" || opts.holeTable ? circlesOf(shape) : [];
  const holeView: ViewKey = opts.views.top ? "top" : "front";
  const holeRows = opts.holeTable ? holeRowsOf(circlesAll, holeView, camOf(holeView, rot)) : [];
  // výška pásu nad spodním okrajem: razítko + kusovník + tabulka děr
  const TBH = TB.h + bomHeight(meta.bom) + holeTableHeight(holeRows);

  // --- projekce
  const keys = ISO_KEYS.filter((k) => opts.views[k]);
  if (!keys.length) keys.push("front");
  const views = new Map<ViewKey, View>();
  for (const k of keys) {
    const v = projectView(shape, k, camOf(k, rot), opts.hidden);
    if (v.w > 0 || v.h > 0) views.set(k, v);
  }
  let section: SectionData | null = null;
  if (opts.section) {
    try {
      section = makeSection(shape, opts.section, sectionCam(opts.section.plane, rot), () => circlesOf(shape));
      if (!section) warnings.push(tr("Rovina řezu neprotíná těleso – upravte odsazení."));
    } catch {
      warnings.push(tr("Řez se nepodařilo vytvořit."));
    }
  }
  let iso: View | null = null;
  if (opts.views.iso) {
    try {
      // izometrie je názorný obraz – zůstává ve standardní poloze i při otočeném hlavním pohledu
      iso = projectView(shape, "iso", CAMS.iso, false, "thin");
      if (!iso.w) iso = null;
    } catch {
      iso = null;
    }
  }
  // pohledy dalších modelů (komponenta sestavy, vložený dokument) – každý ve vlastním měřítku
  const models: { m: ModelView; v: View; shape: r.Shape3D }[] = [];
  for (const m of opts.models ?? []) {
    const sh = extra[m.id];
    if (!sh) {
      warnings.push(tr("Model {0} se nepodařilo načíst.", m.name));
      continue;
    }
    try {
      const v = m.view === "iso" ? projectView(sh, modelViewKey(m.id), CAMS.iso, false, "thin") : projectView(sh, modelViewKey(m.id), CAMS[m.view] ?? CAMS.front, opts.hidden);
      if (v.w > 0 || v.h > 0) models.push({ m, v, shape: sh });
      else warnings.push(tr("Model {0} nemá v pohledu žádnou geometrii.", m.name));
    } catch {
      warnings.push(tr("Model {0} se nepodařilo promítnout.", m.name));
    }
  }

  // --- mřížka pohledů (sloupce left | center | right | far…, řádky above | center | below)
  const cells: Cell[] = [];
  let farCol = 3;
  for (const [k, v] of views) {
    const slot = slotOf(k, opts.projection);
    if (slot === "far") cells.push({ v, col: farCol++, row: 1, pad: noPad() });
    else cells.push({ v, col: SLOT_CELL[slot][0], row: SLOT_CELL[slot][1], pad: noPad() });
  }
  const centerView = views.get("front") ?? null;
  const sectionCell: Cell | null = section ? { v: section.view, col: farCol, row: 1, pad: noPad() } : null;
  for (const c of sectionCell ? [...cells, sectionCell] : cells) for (const [k, p] of Object.entries(opts.dimPads?.[c.v.key] ?? {})) c.pad[k as Side] = Math.max(c.pad[k as Side], (p ?? 0) + 2);
  const cellOf = (key: string) => (key === "section" ? sectionCell : cells.find((c) => c.v.key === key)) ?? null;

  // --- plán kót, které potřebují místo vedle pohledu (řady průměrů soustružených os)
  const overall = opts.dimensions === "none" ? [] : overallPlan((k) => views.has(k as ViewKey), models.filter((x) => x.m.view !== "iso").map((x) => x.v.key));
  const stacks: StackPlan[] = [];
  if (opts.dimensions === "auto") {
    const secN = opts.section && section ? PLANE_N[opts.section.plane] : null;
    for (const ax of turnedCylinders(circlesAll)) {
      const items = ax.items.slice(-STACK_MAX);
      // průměry jsou jako délky vidět v řezu, který osu obsahuje; jinak v pohledu kolmém na osu
      const inSection = !!secN && !!sectionCell && Math.abs(dot(ax.a, secN)) < 1e-3 && Math.abs(dot(ax.base, secN) - opts.section!.offset) < 1e-3;
      const cands = inSection ? [sectionCell!] : cells.filter((c) => Math.abs(dot(ax.a, c.v.cam.d)) < 1e-3);
      let best: { c: Cell; side: Side; cost: number } | null = null;
      for (const c of cands) {
        const e: Vec2 = [dot(ax.a, c.v.cam.x), -dot(ax.a, upOf(c.v.cam))];
        const horizontal = Math.abs(e[0]) > 0.999;
        if (!horizontal && Math.abs(e[1]) <= 0.999) continue; // osa šikmo v obraze
        const k = horizontal ? 0 : 1;
        const coord = (t: number) => proj(c.v.cam, add(ax.base, mul(ax.a, t)))[k];
        for (const side of (horizontal ? ["r", "l"] : ["b", "t"]) as Side[]) {
          const plus = side === "r" || side === "b";
          const edge = (k ? c.v.y0 : c.v.x0) + (plus ? (k ? c.v.h : c.v.w) : 0);
          let cost = 0;
          for (const it of items) cost += Math.min(Math.abs(edge - coord(it.tmin)), Math.abs(edge - coord(it.tmax)));
          // strana, za kterou v mřížce následuje další pohled, a strana s kótou celkového rozměru až jako poslední možnost
          const dc = side === "l" ? -1 : side === "r" ? 1 : 0;
          const dr = side === "t" ? -1 : side === "b" ? 1 : 0;
          const all = sectionCell ? [...cells, sectionCell] : cells;
          if (all.some((q) => q !== c && (dc ? q.row === c.row && (q.col - c.col) * dc > 0 : q.col === c.col && (q.row - c.row) * dr > 0))) cost += 1e9;
          if (overall.some((o) => o.key === c.v.key && o.side === side)) cost += 1e6;
          if (stacks.some((q) => q.key === c.v.key && q.side === side)) cost += 1e7;
          if (!best || cost < best.cost) best = { c, side, cost };
        }
      }
      if (best) {
        const base0 = STACK_BASE + (overall.some((o) => o.key === best!.c.v.key && o.side === best!.side) ? 8 : 0) + best.c.pad[best.side];
        stacks.push({ key: best.c.v.key, side: best.side, a: ax.a, base: ax.base, items, base0 });
        best.c.pad[best.side] = base0 + items.length * STACK_PITCH + 2;
      } else if (cands.length) stacks.push({ key: cands[0].v.key, side: "r", a: ax.a, base: ax.base, items: items.slice(-8), base0: 0, inline: true });
    }
  }

  // --- rozvržení na listu
  const sheetDims = (n: SheetName): [number, number] => {
    const [a, b] = SHEETS[n];
    return opts.orientation === "portrait" ? [b, a] : [a, b];
  };
  // místo kolem pohledů mimo mřížku: řez má nad sebou označení, pohled jiného modelu pod sebou popisek s měřítkem
  const extras: Extra[] = [];
  const secPad = (): Pad => {
    const p = sectionCell!.pad;
    return { l: Math.max(6, p.l), r: Math.max(6, p.r), b: Math.max(6, p.b), t: p.t + 14 };
  };
  for (const x of models) {
    const dims = opts.dimensions !== "none" && x.m.view !== "iso";
    extras.push({ v: x.v, pad: { l: dims ? 15 : 5, t: dims ? 15 : 5, r: 5, b: 12 }, scale: x.m.scale, name: x.m.name });
  }
  type Arrangement = { ok: boolean; items: Item[]; W: number; H: number; area: Rect; bounds: Rect; fixed: Rect[]; room: number };
  const arrange = (n: SheetName, s: number, force = false): Arrangement | null => {
    const [W, H] = sheetDims(n);
    // plocha pro pohledy: rám bez pásu razítka (kóty kolem pohledů do ní patří)
    const area: Rect = { x: M_LEFT, y: M, w: W - M_LEFT - M, h: H - 2 * M - TBH - 4 };
    const bounds: Rect = { x: M_LEFT + 4, y: M + 4, w: W - M_LEFT - M - 8, h: H - 2 * M - 8 };
    const fixed: Rect[] = [{ x: W - M - TB.w - 3, y: H - M - TBH - 12, w: TB.w + 3, h: TBH + 12 }];
    if (meta.revisions?.length) fixed.push({ x: W - M - 124 - 3, y: M, w: 127, h: 6 + (meta.revisions.length + 1) * 6 + 3 });
    const frame: Rect = { x: M_LEFT, y: M, w: W - M_LEFT - M, h: H - 2 * M };
    /** mřížka s mezerou 24 + room a okrajem DIM_ROOM + room; `loose` = pohledy smí i vedle razítka (jen ne do něj) */
    const tryGrid = (list: Cell[], room: number) => {
      GAP = 24 + room;
      const g = gridLayout(list, s);
      const rects = list.map((c) => g.rectOf(c));
      const feet = rects.map((q, i) => inflate(q, atLeast(list[i].pad, DIM_ROOM + room)));
      const ext = boundsOf(feet);
      let fits = ext.w <= area.w + 1e-6 && ext.h <= area.h + 1e-6;
      if (!fits && loose && ext.w <= frame.w + 1e-6 && ext.h <= frame.h + 1e-6) {
        const dx = area.x - ext.x;
        const dy = area.y - ext.y;
        fits = !feet.some((f) => fixed.some((q) => overlaps({ ...f, x: f.x + dx, y: f.y + dy }, q)));
      }
      return { list, rects, ext, fits };
    };
    // řez nejdřív v řadě s hlavním pohledem (promítací čáry); když se tam nevejde, hledá se pro něj volné místo na listu
    const pick = (room: number) => {
      let grid = sectionCell ? tryGrid([...cells, sectionCell], room) : tryGrid(cells, room);
      let secFree = false;
      if (sectionCell && !grid.fits) {
        const base = tryGrid(cells, room);
        if (base.fits || !force) {
          grid = base;
          secFree = true;
        }
      }
      return { grid, secFree, room };
    };
    // místo pro kóty: celé, a když se list nevejde, menší (až ROOM_MIN) – formát se kvůli místu pro kóty nezvětší
    let pk = pick(ROOM);
    for (const room of [(ROOM + ROOM_MIN) / 2, ROOM_MIN]) if (!pk.grid.fits && room < pk.room) pk = pick(room);
    const { grid, secFree } = pk;
    if (!grid.fits && !force) return null;
    let ok = grid.fits;
    const ox = area.x - grid.ext.x;
    const oy = area.y - grid.ext.y;
    const items: Item[] = grid.list.map((c, i) => ({ v: c.v, pad: c.pad, s, grid: true, rect: { ...grid.rects[i], x: grid.rects[i].x + ox, y: grid.rects[i].y + oy } }));
    const occupied = () => [...items.map((it) => inflate(it.rect, it.grid ? atLeast(it.pad, 12) : it.pad)), ...fixed];
    const main = items.find((it) => it.v.key === "front");
    const put = (e: Extra, sc: number): boolean => {
      const w = e.v.w * sc;
      const h = e.v.h * sc;
      const ys = e.alignMain && main && sameUp(e.v.cam, main.v.cam) ? [main.rect.y + (e.v.y0 - main.v.y0) * s - e.pad.t] : [];
      const spot = findSpot(bounds, occupied(), w + e.pad.l + e.pad.r, h + e.pad.t + e.pad.b, (x, y) => x - area.x + 1.2 * (y - area.y) - (ys.length && Math.abs(y - ys[0]) < 1e-6 ? 1e4 : 0), ys);
      if (!spot) return false;
      items.push({ v: e.v, pad: e.pad, s: sc, grid: false, name: e.name, rect: { x: spot[0] + e.pad.l, y: spot[1] + e.pad.t, w, h } });
      return true;
    };
    const lost = (e: Extra, sc: number) => {
      // nevešlo se: pohled se položí do levého dolního rohu a výkres na to upozorní
      const w = e.v.w * sc;
      const h = e.v.h * sc;
      items.push({ v: e.v, pad: e.pad, s: sc, grid: false, name: e.name, lost: true, rect: { x: bounds.x + e.pad.l, y: Math.max(bounds.y, bounds.y + bounds.h - h - e.pad.b), w, h } });
      ok = false;
    };
    const list: Extra[] = secFree ? [{ v: sectionCell!.v, pad: secPad(), scale: s, alignMain: true }, ...extras] : extras;
    for (const e of list) {
      const scales = e.scale === "auto" ? [s, ...STANDARD_SCALES.filter((x) => x < s - 1e-12).slice(0, 4)] : [e.scale];
      const sc = scales.find((x) => put(e, x));
      if (sc != null) continue;
      if (!force) return null;
      lost(e, scales[scales.length - 1]);
    }
    return { ok, items, W, H, area, bounds, fixed, room: pk.room };
  };
  const fits = (n: SheetName, s: number) => !!arrange(n, s);
  const bestScale = (n: SheetName) => STANDARD_SCALES.find((s) => fits(n, s)) ?? null;

  let sheet: SheetName;
  let scale: number;
  if (opts.sheet !== "auto") {
    sheet = opts.sheet;
    if (opts.scale === "auto") scale = bestScale(sheet) ?? STANDARD_SCALES[STANDARD_SCALES.length - 1];
    else {
      scale = opts.scale;
      if (!fits(sheet, scale)) warnings.push(tr("Pohledy se v měřítku {0} nevejdou na list {1}.", scaleLabel(scale), sheet));
    }
  } else if (opts.scale !== "auto") {
    scale = opts.scale;
    sheet = SHEET_ORDER.find((n) => fits(n, scale)) ?? "A0";
    if (!fits(sheet, scale)) warnings.push(tr("Pohledy se v měřítku {0} nevejdou ani na A0.", scaleLabel(scale)));
  } else {
    const pick = SHEET_ORDER.find((n) => (bestScale(n) ?? 0) >= 0.5);
    sheet = pick ?? "A0";
    scale = bestScale(sheet) ?? STANDARD_SCALES[STANDARD_SCALES.length - 1];
  }
  const arr = arrange(sheet, scale, true)!;
  const [SW, SH] = [arr.W, arr.H];

  // bez izometrie se celé rozvržení vystředí do volné plochy listu (s izometrií zůstává vlevo nahoře a izometrie dostane zbytek)
  if (!iso) {
    const foot = (it: Item) => inflate(it.rect, it.grid ? atLeast(it.pad, DIM_ROOM + arr.room) : it.pad);
    const bb = boundsOf(arr.items.map(foot));
    const dx = Math.max(0, (arr.area.w - bb.w) / 2) - (bb.x - arr.area.x);
    const dy = Math.max(0, (arr.area.h - bb.h) / 2) - (bb.y - arr.area.y);
    const moved = arr.items.map((it) => ({ ...it, rect: { ...it.rect, x: it.rect.x + dx, y: it.rect.y + dy } }));
    // pohledy mimo mřížku nesmí po posunu vyjet z rámu ani do razítka
    // (volné rozvržení: ani pohledy mřížky, které sahají vedle razítka)
    if (moved.every((it) => (it.grid && !loose) || it.lost || (inside(foot(it), it.grid ? { x: M_LEFT, y: M, w: arr.W - M_LEFT - M, h: arr.H - 2 * M } : arr.bounds) && !arr.fixed.some((f) => overlaps(foot(it), f))))) arr.items = moved;
  }

  const placed = new Map<string, Placed>();
  const itemOf = new Map<string, Item>();
  for (const it of arr.items) {
    placed.set(it.v.key, { ...it.v, px: it.rect.x, py: it.rect.y, s: it.s });
    itemOf.set(it.v.key, it);
    if (it.lost) warnings.push(it.v.key === "section" ? tr("Řez se na list nevejde – zvolte větší formát nebo menší měřítko.") : tr("Pohled modelu {0} se na list nevejde – zvolte větší formát nebo menší měřítko.", it.name ?? ""));
  }
  /** pohledy hlavního modelu (bez pohledů dalších modelů) */
  const ownViews = () => [...placed.values()].filter((p) => !p.key.startsWith("m:"));

  // přesné zarovnání pohledů do promítacích čar podle hlavního pohledu
  const main = centerView ? placed.get(centerView.key)! : null;
  if (main) {
    for (const p of ownViews()) {
      if (p === main || !itemOf.get(p.key)?.grid) continue;
      const slot = p.key === "section" ? "far" : slotOf(p.key as ViewKey, opts.projection);
      // svislá osa obrazu = Z u pohledů z boku/zezadu/řezů XZ, YZ → stejné y0
      if ((slot === "left" || slot === "right" || slot === "far") && sameUp(p.cam, main.cam)) p.py = main.py + (p.y0 - main.y0) * scale;
      // vodorovná osa = X u pohledů shora/zdola → stejné x0
      if ((slot === "above" || slot === "below") && sameX(p.cam, main.cam)) p.px = main.px + (p.x0 - main.x0) * scale;
    }
  }

  // --- geometrie listu
  const polys: Poly[] = [];
  const texts: DText[] = [];
  for (const p of placed.values()) for (const pl of p.polys) polys.push({ layer: pl.layer, pts: pl.pts.map((q) => toSheet(p, q)) });

  // řez: šrafy + označení
  const sec = placed.get("section");
  if (section && sec && opts.section) {
    const loops = section.loops.map((l) => l.map((q) => toSheet(sec, q)));
    for (const h of hatch(loops, Math.max(1.5, Math.min(4, Math.sqrt(sec.w * sec.h * scale * scale) / 25)))) polys.push({ layer: "hatch", pts: h });
    // označení nad řezem (nad řadou kót, leží-li nad pohledem)
    const above = stacks.filter((q) => q.key === "section" && q.side === "t").reduce((m, q) => Math.max(m, q.base0 + q.items.length * STACK_PITCH + 2), 0);
    texts.push({ x: sec.px + (sec.w * scale) / 2, y: sec.py - 6 - above, s: "A–A", size: 5, anchor: "middle", bold: true, layer: "text" });
    if (section.split) {
      // poloviční řez: hranicí pohledu a řezu je osa souměrnosti
      const a = toSheet(sec, section.split.axis ? [sec.x0, section.split.c] : [section.split.c, sec.y0]);
      const b = toSheet(sec, section.split.axis ? [sec.x0 + sec.w, section.split.c] : [section.split.c, sec.y0 + sec.h]);
      const u: Vec2 = section.split.axis ? [3, 0] : [0, 3];
      polys.push({ layer: "center", pts: [[a[0] - u[0], a[1] - u[1]], [b[0] + u[0], b[1] + u[1]]] });
    }
    cuttingPlane(opts.section.plane, opts.section.offset, new Map(ownViews().map((p) => [p.key, p])), polys, texts, warnings);
  }

  // pohledy dalších modelů: popisek s názvem a vlastním měřítkem
  const modelOut: NonNullable<DrawingResult["models"]> = [];
  for (const x of models) {
    const p = placed.get(x.v.key);
    if (!p) continue;
    texts.push({ x: p.px + (p.w * p.s) / 2, y: p.py + p.h * p.s + 8, s: `${x.m.name} (${scaleLabel(p.s)})`, size: 4, anchor: "middle", bold: true, layer: "text" });
    modelOut.push({ id: x.m.id, key: x.v.key, scale: scaleLabel(p.s), scaleValue: p.s, x: p.px, y: p.py, w: p.w * p.s, h: p.h * p.s });
  }

  // izometrie do největšího volného místa
  let isoRect: Rect | null = null;
  if (iso) {
    const busy = [...arr.items.map((it) => inflate(it.rect, it.grid ? atLeast(it.pad, 10) : it.pad)), ...arr.fixed];
    const best = largestFree({ x: M_LEFT + 6, y: M + 6, w: SW - M_LEFT - M - 12, h: SH - 2 * M - 12 }, busy, iso.w, iso.h, scale);
    if (best && best.s > 0) {
      const p: Placed = { ...iso, s: best.s, px: best.x + (best.w - iso.w * best.s) / 2, py: best.y + (best.h - iso.h * best.s) / 2 };
      for (const pl of p.polys) polys.push({ layer: "thin", pts: pl.pts.map((q) => toSheet(p, q)) });
      isoRect = { x: p.px, y: p.py, w: iso.w * best.s, h: iso.h * best.s };
    }
  }

  // osy a kóty
  const circles = circlesAll;
  const ortho = ownViews();
  if (opts.centerLines) {
    for (const p of ortho) centerLines(p, circles, polys);
    for (const x of models) {
      const p = placed.get(x.v.key);
      if (p && x.m.view !== "iso") centerLines(p, circlesOf(x.shape), polys);
    }
  }
  for (const o of overall) {
    const p = placed.get(o.key);
    if (!p || !(p.w > 0)) continue;
    const b = { x: p.px, y: p.py, w: p.w * p.s, h: p.h * p.s };
    if (o.side === "t") linearDim(polys, texts, [b.x, b.y], [b.x + b.w, b.y], [0, -1], 9, p.w);
    else linearDim(polys, texts, [b.x, b.y + b.h], [b.x, b.y], [-1, 0], 9, p.h);
  }
  const stackOut: NonNullable<DrawingResult["stacks"]> = [];
  if (opts.dimensions === "auto") {
    const done = new Set<string>();
    for (const st of stacks) {
      const p = placed.get(st.key);
      if (p) stackOut.push({ view: st.key, side: st.side, count: diameterStack(p, st, polys, texts, meta.threads ?? []) });
    }
    for (const ax of turnedCylinders(circles)) for (const k of ax.keys) done.add(k);
    // odkazy „n× Ø d“ se kladou mimo obrysy pohledů na místo, kde nepřekryjí žádnou čáru ani jiný text
    const occ = new Occupancy();
    for (const pl of polys) if (!pl.fill) occ.addPoly(pl.pts);
    for (const t of texts) occ.addText(t);
    for (const f of arr.fixed) occ.addRect(f);
    if (isoRect) occ.addRect(isoRect);
    const hulls = new Map<string, Vec2[]>();
    for (const p of placed.values()) hulls.set(p.key, convexHull(p.polys.filter((pl) => pl.layer !== "hidden").flatMap((pl) => pl.pts.map((q) => toSheet(p, q)))));
    holeLeaders(ortho, circles, polys, texts, meta.threads ?? [], done, occ, hulls, { x: M_LEFT + 2, y: M + 2, w: SW - M_LEFT - M - 4, h: SH - 2 * M - 4 });
  }

  // tabulka děr: značky v pohledu
  if (holeRows.length) {
    for (const h of holeRows) {
      const p = placed.get(h.view);
      if (!p) continue;
      const q = toSheet(p, h.c);
      polys.push({ layer: "dim", pts: [[q[0] - 2, q[1]], [q[0] + 2, q[1]]] }, { layer: "dim", pts: [[q[0], q[1] - 2], [q[0], q[1] + 2]] });
      texts.push({ x: q[0] + 1.2, y: q[1] - 1.2, s: h.tag, size: 2.5, layer: "dim" });
    }
  }
  // detailní pohledy
  const details: NonNullable<DrawingResult["details"]> = [];
  for (const d of opts.details ?? []) {
    const p = placed.get(d.view);
    if (!p) {
      warnings.push(tr("Detail {0}: pohled {1} není na listu.", d.label, d.view));
      continue;
    }
    const res = detailView(d, p, SW, SH, TBH, polys, texts, details);
    if (!res) warnings.push(tr("Detail {0}: v kruhu není žádná geometrie.", d.label));
  }
  // pozice (balónky) komponent sestavy
  const balloons: NonNullable<DrawingResult["balloons"]> = [];
  if (opts.balloons && meta.components?.length) {
    const mainView = centerView ? placed.get(centerView.key) : ortho[0];
    if (mainView) balloonsFor(meta.components, mainView, polys, texts, balloons, { top: M + 3, bottom: SH - M - TBH - 3, left: M_LEFT + 3, right: SW - M - 3 });
  }

  // rám, centrovací značky, razítko
  frame(SW, SH, polys);
  titleBlock(SW, SH, sheet, scale, opts.projection, meta, polys, texts, holeTableHeight(holeRows));
  let yTop = SH - M - TB.h;
  if (meta.bom?.length) {
    partsList(SW - M - TB.w, yTop, meta.bom, polys, texts);
    yTop -= bomHeight(meta.bom);
  }
  if (holeRows.length) holeTable(SW - M - TB.w, yTop, holeRows, polys, texts);
  if (meta.revisions?.length) revisionTable(SW, meta.revisions, polys, texts);

  return {
    sheet: { name: sheet, w: SW, h: SH },
    views: [...placed.values()].map((p) => ({ key: p.key, px: p.px, py: p.py, s: p.s, x0: p.x0, y0: p.y0, w: p.w, h: p.h, ents: p.ents, cam: p.cam })),
    scale: scaleLabel(scale),
    scaleValue: scale,
    polys,
    texts,
    svg: toSvg(SW, SH, polys, texts),
    dxf: toDxf(SH, polys, texts),
    warnings,
    holes: holeRows.length ? holeRows : undefined,
    details: details.length ? details : undefined,
    balloons: balloons.length ? balloons : undefined,
    models: modelOut.length ? modelOut : undefined,
    stacks: stackOut.length ? stackOut : undefined,
  };
}

const sameUp = (a: Cam, b: Cam) => Math.abs(dot(upOf(a), upOf(b)) - 1) < 1e-6;
const sameX = (a: Cam, b: Cam) => Math.abs(dot(a.x, b.x) - 1) < 1e-6;

// ---------------------------------------------------------------- kótovací prvky

function arrow(polys: Poly[], x: number, y: number, dx: number, dy: number) {
  const l = 3;
  const w = 0.55;
  polys.push({ layer: "dim", fill: true, pts: [[x, y], [x + dx * l - dy * w, y + dy * l + dx * w], [x + dx * l + dy * w, y + dy * l - dx * w], [x, y]] });
}

/** Lineární kóta mezi body p1, p2 (list), kótovací čára posunutá o `off` ve směru normály n; `label` nahradí hodnotu (označení závitu). */
function linearDim(polys: Poly[], texts: DText[], p1: Vec2, p2: Vec2, n: Vec2, off: number, value: number, prefix = "", label?: string) {
  const a: Vec2 = [p1[0] + n[0] * off, p1[1] + n[1] * off];
  const b: Vec2 = [p2[0] + n[0] * off, p2[1] + n[1] * off];
  const gap = 1;
  const over = 2;
  const ext = (p: Vec2, q: Vec2) => {
    const L = Math.hypot(q[0] - p[0], q[1] - p[1]);
    if (L < gap + 0.1) return;
    const ux = (q[0] - p[0]) / L;
    const uy = (q[1] - p[1]) / L;
    polys.push({ layer: "dim", pts: [[p[0] + ux * gap, p[1] + uy * gap], [q[0] + ux * over, q[1] + uy * over]] });
  };
  if (off !== 0) {
    ext(p1, a);
    ext(p2, b);
  }
  const span = Math.hypot(b[0] - a[0], b[1] - a[1]);
  const L = span || 1;
  const ux = (b[0] - a[0]) / L;
  const uy = (b[1] - a[1]) / L;
  if (span >= 8) {
    polys.push({ layer: "dim", pts: [a, b] });
    arrow(polys, a[0], a[1], ux, uy);
    arrow(polys, b[0], b[1], -ux, -uy);
  } else {
    // krátká kóta: šipky zvenku
    polys.push({ layer: "dim", pts: [[a[0] - ux * 5, a[1] - uy * 5], [b[0] + ux * 5, b[1] + uy * 5]] });
    arrow(polys, a[0], a[1], -ux, -uy);
    arrow(polys, b[0], b[1], ux, uy);
  }
  let ang = (Math.atan2(uy, ux) * 180) / Math.PI;
  if (ang > 90.01) ang -= 180;
  if (ang < -89.99) ang += 180;
  // text nad kótovací čárou (normála směrem „nahoru“ v listu)
  const rad = (ang * Math.PI) / 180;
  const nx = Math.sin(rad);
  const ny = -Math.cos(rad);
  texts.push({ x: (a[0] + b[0]) / 2 + nx * 1, y: (a[1] + b[1]) / 2 + ny * 1, s: label ?? prefix + fmt(value), size: 3.5, anchor: "middle", rotate: Math.abs(ang) < 1e-6 ? 0 : ang, layer: "dim" });
}

function centerLines(p: Placed, circles: Circle[], polys: Poly[]) {
  const d = p.cam.d;
  const s = p.s;
  const ext = 2.5;
  const faceOn = new Map<string, { c: Vec2; r: number }>();
  const axes = new Map<string, { a: Vec3; base: Vec3; tmin: number; tmax: number; rmax: number }>();
  for (const c of circles) {
    const ad = Math.abs(dot(c.a, d));
    if (ad > 0.999) {
      const q = at(p, c.c);
      const key = `${q[0].toFixed(2)},${q[1].toFixed(2)}`;
      const prev = faceOn.get(key);
      if (!prev || prev.r < c.r) faceOn.set(key, { c: q, r: c.r });
    } else if (ad < 1e-3) {
      // osa leží v rovině pohledu → kreslí se osa válce
      const t = dot(c.c, c.a);
      const base = sub(c.c, mul(c.a, t));
      const key = `${c.a.map((v) => k3(v, 3)).join()}|${base.map((v) => k3(v, 2)).join()}`;
      const g = axes.get(key);
      if (g) {
        g.tmin = Math.min(g.tmin, t);
        g.tmax = Math.max(g.tmax, t);
        g.rmax = Math.max(g.rmax, c.r);
      } else axes.set(key, { a: c.a, base, tmin: t, tmax: t, rmax: c.r });
    }
  }
  for (const { c, r: rad } of faceOn.values()) {
    const L = rad * s + ext;
    if (rad * s < 1) continue;
    polys.push({ layer: "center", pts: [[c[0] - L, c[1]], [c[0] + L, c[1]]] }, { layer: "center", pts: [[c[0], c[1] - L], [c[0], c[1] + L]] });
  }
  for (const g of axes.values()) {
    if (g.tmax - g.tmin < 1e-6 || g.rmax * s < 1) continue;
    const p0 = at(p, add(g.base, mul(g.a, g.tmin)));
    const p1 = at(p, add(g.base, mul(g.a, g.tmax)));
    const L = Math.hypot(p1[0] - p0[0], p1[1] - p0[1]) || 1;
    const ux = (p1[0] - p0[0]) / L;
    const uy = (p1[1] - p0[1]) / L;
    polys.push({ layer: "center", pts: [[p0[0] - ux * ext, p0[1] - uy * ext], [p1[0] + ux * ext, p1[1] + uy * ext]] });
  }
}

/** odhad šířky znaku vůči výšce písma (Roboto; číslice ≈ 0,56) – s rezervou */
const CHAR_W = 0.6;
/** Obdélník, který na listu zabírá text (osově rovnoběžný obal i pro otočený text): [x0, y0, x1, y1]. */
export function textBox(t: DText): [number, number, number, number] {
  const w = t.s.length * t.size * CHAR_W;
  const x0 = t.anchor === "middle" ? -w / 2 : t.anchor === "end" ? -w : 0;
  const rad = ((t.rotate ?? 0) * Math.PI) / 180;
  const c = Math.cos(rad);
  const s = Math.sin(rad);
  let bx0 = Infinity;
  let by0 = Infinity;
  let bx1 = -Infinity;
  let by1 = -Infinity;
  for (const [lx, ly] of [[x0, -0.8 * t.size], [x0 + w, -0.8 * t.size], [x0 + w, 0.2 * t.size], [x0, 0.2 * t.size]]) {
    const x = t.x + lx * c - ly * s;
    const y = t.y + lx * s + ly * c;
    bx0 = Math.min(bx0, x);
    by0 = Math.min(by0, y);
    bx1 = Math.max(bx1, x);
    by1 = Math.max(by1, y);
  }
  return [bx0, by0, bx1, by1];
}

/** Co už na listu je (čáry v mřížce buněk, obdélníky textů a tabulek) – dotaz, zda je obdélník volný. */
class Occupancy {
  private readonly cell = 10;
  private readonly grid = new Map<number, number[]>();
  private readonly segs: number[] = [];
  readonly rects: Rect[] = [];
  private key(cx: number, cy: number) {
    return cx * 8192 + cy;
  }
  addSeg(ax: number, ay: number, bx: number, by: number) {
    const id = this.segs.length / 4;
    this.segs.push(ax, ay, bx, by);
    // dlouhá čára se do buněk zapisuje po krocích podél ní (ne celým obalem)
    const n = Math.max(1, Math.ceil(Math.hypot(bx - ax, by - ay) / this.cell));
    let last = NaN;
    for (let i = 0; i <= n; i++) {
      const cx = Math.floor((ax + ((bx - ax) * i) / n) / this.cell);
      const cy = Math.floor((ay + ((by - ay) * i) / n) / this.cell);
      for (let dx = -1; dx <= 1; dx++)
        for (let dy = -1; dy <= 1; dy++) {
          const k = this.key(cx + dx, cy + dy);
          if (dx === 0 && dy === 0 && k === last) continue;
          const list = this.grid.get(k);
          if (!list) this.grid.set(k, [id]);
          else if (list[list.length - 1] !== id) list.push(id);
        }
      last = this.key(cx, cy);
    }
  }
  addPoly(pts: Vec2[]) {
    for (let i = 1; i < pts.length; i++) this.addSeg(pts[i - 1][0], pts[i - 1][1], pts[i][0], pts[i][1]);
  }
  addRect(q: Rect) {
    this.rects.push(q);
  }
  addText(t: DText) {
    const b = textBox(t);
    this.rects.push({ x: b[0], y: b[1], w: b[2] - b[0], h: b[3] - b[1] });
  }
  /** obdélník nepřekrývá žádný text / tabulku a neprotíná ho žádná čára */
  free(q: Rect): boolean {
    for (const o of this.rects) if (overlaps(q, o)) return false;
    const x1 = q.x + q.w;
    const y1 = q.y + q.h;
    for (let cx = Math.floor(q.x / this.cell); cx <= Math.floor(x1 / this.cell); cx++)
      for (let cy = Math.floor(q.y / this.cell); cy <= Math.floor(y1 / this.cell); cy++) {
        const list = this.grid.get(this.key(cx, cy));
        if (!list) continue;
        for (const id of list) {
          const i = id * 4;
          if (clipSegment([this.segs[i], this.segs[i + 1]], [this.segs[i + 2], this.segs[i + 3]], q.x, q.y, x1, y1)) return false;
        }
      }
    return true;
  }
  /** úsečka neprotíná žádný text / tabulku */
  clearOfTexts(a: Vec2, b: Vec2): boolean {
    for (const o of this.rects) if (clipSegment(a, b, o.x, o.y, o.x + o.w, o.y + o.h)) return false;
    return true;
  }
}

/** Konvexní obal bodů (proti směru hodin v souřadnicích s osou y nahoru; pořadí pro testy uvnitř / vně je jednotné). */
export function convexHull(pts: Vec2[]): Vec2[] {
  if (pts.length < 3) return [...pts];
  const p = [...pts].sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const cr = (o: Vec2, a: Vec2, b: Vec2) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const lower: Vec2[] = [];
  for (const q of p) {
    while (lower.length >= 2 && cr(lower[lower.length - 2], lower[lower.length - 1], q) <= 0) lower.pop();
    lower.push(q);
  }
  const upper: Vec2[] = [];
  for (let i = p.length - 1; i >= 0; i--) {
    const q = p[i];
    while (upper.length >= 2 && cr(upper[upper.length - 2], upper[upper.length - 1], q) <= 0) upper.pop();
    upper.push(q);
  }
  lower.pop();
  upper.pop();
  return [...lower, ...upper];
}
function inHull(h: Vec2[], q: Vec2): boolean {
  if (h.length < 3) return false;
  for (let i = 0; i < h.length; i++) {
    const a = h[i];
    const b = h[(i + 1) % h.length];
    if ((b[0] - a[0]) * (q[1] - a[1]) - (b[1] - a[1]) * (q[0] - a[0]) < -1e-9) return false;
  }
  return true;
}
/** obdélník zasahuje do konvexního obalu (nebo ho obsahuje) */
function hullHitsRect(h: Vec2[], q: Rect): boolean {
  if (h.length < 3) return false;
  const x1 = q.x + q.w;
  const y1 = q.y + q.h;
  if (inHull(h, [q.x, q.y]) || inHull(h, [x1, q.y]) || inHull(h, [x1, y1]) || inHull(h, [q.x, y1])) return true;
  for (let i = 0; i < h.length; i++) if (clipSegment(h[i], h[(i + 1) % h.length], q.x, q.y, x1, y1)) return true;
  return false;
}
/** vzdálenost, po které polopřímka z bodu `o` ve směru `u` opustí konvexní obal (0 = bod je vně) */
function hullExit(h: Vec2[], o: Vec2, u: Vec2): number {
  if (!inHull(h, o)) return 0;
  let best = Infinity;
  for (let i = 0; i < h.length; i++) {
    const a = h[i];
    const b = h[(i + 1) % h.length];
    const ex = b[0] - a[0];
    const ey = b[1] - a[1];
    const den = u[0] * ey - u[1] * ex;
    if (Math.abs(den) < 1e-12) continue;
    const t = ((a[0] - o[0]) * ey - (a[1] - o[1]) * ex) / den;
    const k = ((a[0] - o[0]) * u[1] - (a[1] - o[1]) * u[0]) / den;
    if (t >= 0 && k >= -1e-9 && k <= 1 + 1e-9) best = Math.min(best, t);
  }
  return Number.isFinite(best) ? best : 0;
}

/**
 * Řada kót průměrů soustružené osy vedle pohledu: kótovací čáry kolmé na osu leží mimo obrys na jedné straně pohledu,
 * nejmenší průměr nejblíž obrysu a každý další o rozteč dál (vynášecí čáry větších průměrů tak nekříží kótovací čáry menších).
 * Vrací počet zakreslených kót.
 */
function diameterStack(p: Placed, st: StackPlan, polys: Poly[], texts: DText[], threads: { r: number; label: string }[]): number {
  const perp = unit(cross(p.cam.d, st.a));
  const axisPt = (t: number) => add(st.base, mul(st.a, t));
  let n = 0;
  if (st.inline) {
    for (const it of [...st.items].reverse()) {
      if (it.r * p.s < 1.5) continue;
      const mid = axisPt((it.tmin + it.tmax) / 2);
      linearDim(polys, texts, at(p, add(mid, mul(perp, -it.r))), at(p, add(mid, mul(perp, it.r))), [0, 0], 0, 2 * it.r, "Ø");
      n++;
    }
    return n;
  }
  const horizontal = st.side === "l" || st.side === "r";
  const k = horizontal ? 0 : 1;
  const sign = st.side === "r" || st.side === "b" ? 1 : -1;
  const dir: Vec2 = horizontal ? [sign, 0] : [0, sign];
  const edge = (horizontal ? p.px : p.py) + (sign > 0 ? (horizontal ? p.w : p.h) * p.s : 0);
  for (const it of st.items) {
    if (it.r * p.s < 1.5) continue;
    // vynáší se z konce válce bližšího ke straně, na které řada leží
    const q0 = at(p, axisPt(it.tmin));
    const q1 = at(p, axisPt(it.tmax));
    const end = axisPt((q0[k] - q1[k]) * sign >= 0 ? it.tmin : it.tmax);
    const p1 = at(p, add(end, mul(perp, -it.r)));
    const p2 = at(p, add(end, mul(perp, it.r)));
    const line = edge + sign * (st.base0 + n * STACK_PITCH);
    const thread = threads.find((t) => Math.abs(t.r - it.r) < 0.03); // závit: označení místo Ø
    linearDim(polys, texts, p1, p2, dir, (line - p1[k]) * sign, 2 * it.r, "Ø", thread?.label);
    n++;
  }
  return n;
}

/**
 * Čelně viditelné kružnice (díry, čepy) – odkazová čára „n× Ø d“. Text leží mimo obrysy pohledů na místě, kde nepřekrývá
 * žádnou čáru ani jiný text; ze všech děr skupiny a směrů se vybere nejkratší odkaz.
 */
function holeLeaders(views: Placed[], circles: Circle[], polys: Poly[], texts: DText[], threads: { r: number; label: string }[], done: Set<string>, occ: Occupancy, hulls: Map<string, Vec2[]>, frame: Rect) {
  const lineKey = (c: Circle) => `${c.a.map((v) => k3(v, 3)).join()}|${sub(c.c, mul(c.a, dot(c.c, c.a))).map((v) => k3(v, 2)).join()}`;
  const radKey = (c: Circle) => `${k3(c.r, 2)}|${lineKey(c)}`;
  const radii = new Map<string, Set<string>>();
  for (const c of circles) {
    const k = lineKey(c);
    const set = radii.get(k) ?? new Set<string>();
    set.add((Math.round(c.r * 20) / 20).toFixed(2));
    radii.set(k, set);
  }
  const turned = (c: Circle) => (radii.get(lineKey(c))?.size ?? 0) > 2;
  const order = ["front", "top", "left", "right", "bottom", "back", "section"];
  const sorted = [...views].sort((a, b) => order.indexOf(a.key) - order.indexOf(b.key));
  const DIRS = [-45, -135, 45, 135, 0, 180, -90, 90].map((deg) => [Math.cos((deg * Math.PI) / 180), Math.sin((deg * Math.PI) / 180)] as Vec2);
  const STEPS = [4, 8, 13, 19, 26, 34, 44];
  for (const p of sorted) {
    const hull = hulls.get(p.key) ?? [];
    const allHulls = [...hulls.values()];
    const groups = new Map<string, Circle[]>();
    for (const c of circles) {
      if (turned(c) || !c.cyl || Math.abs(dot(c.a, p.cam.d)) < 0.999 || c.r * p.s < 1.2) continue;
      if (done.has(radKey(c))) continue;
      const gk = c.r.toFixed(2);
      const list = groups.get(gk) ?? [];
      // stejná kružnice ve stejném místě obrazu (horní a dolní hrana díry) jen jednou
      const q = at(p, c.c);
      if (!list.some((x) => Math.hypot(at(p, x.c)[0] - q[0], at(p, x.c)[1] - q[1]) < 0.01)) list.push(c);
      groups.set(gk, list);
    }
    let n = 0;
    for (const list of [...groups.values()].sort((a, b) => b[0].r - a[0].r)) {
      if (n++ >= 8) break;
      const c0 = list[0];
      for (const x of circles) if (Math.abs(x.r - c0.r) < 0.005 && Math.abs(dot(x.a, p.cam.d)) > 0.999) done.add(radKey(x));
      const thread = threads.find((t) => Math.abs(t.r - c0.r) < 0.03); // závit: označení místo Ø jádra
      const label = `${list.length > 1 ? `${list.length}× ` : ""}${thread ? thread.label : `Ø${fmt(2 * c0.r)}`}`;
      const tw = label.length * 2.05 + 2;
      const R = c0.r * p.s;
      let best: { e: Vec2; knee: Vec2; right: boolean; u: Vec2; len: number } | null = null;
      for (const c of list.slice(0, 24)) {
        const q = at(p, c.c);
        for (const u of DIRS) {
          const e: Vec2 = [q[0] + u[0] * R, q[1] + u[1] * R];
          const out = hullExit(hull, e, u);
          for (const step of STEPS) {
            const len = out + step;
            if (best && len >= best.len) break;
            const knee: Vec2 = [e[0] + u[0] * len, e[1] + u[1] * len];
            const right = u[0] >= -1e-9;
            const box: Rect = { x: right ? knee[0] : knee[0] - tw, y: knee[1] - 4.6, w: tw, h: 5.4 };
            if (!inside(box, frame) || allHulls.some((h) => hullHitsRect(h, box)) || !occ.free(box) || !occ.clearOfTexts(e, knee)) continue;
            best = { e, knee, right, u, len };
            break;
          }
        }
      }
      if (!best) {
        // nikde není volno: krátký odkaz šikmo od díry (jako dřív)
        const c = list.reduce((m, x) => (at(p, x.c)[0] - at(p, x.c)[1] > at(p, m.c)[0] - at(p, m.c)[1] ? x : m), list[0]);
        const q = at(p, c.c);
        const u = DIRS[(n - 1) % 4];
        const e: Vec2 = [q[0] + u[0] * R, q[1] + u[1] * R];
        best = { e, knee: [e[0] + u[0] * 9, e[1] + u[1] * 9], right: u[0] >= 0, u, len: 9 };
      }
      const { e, knee, right, u } = best;
      const shelf: Vec2 = [knee[0] + (right ? tw : -tw), knee[1]];
      polys.push({ layer: "dim", pts: [e, knee, shelf] });
      arrow(polys, e[0], e[1], u[0], u[1]);
      const text: DText = { x: knee[0] + (right ? 1 : -1), y: knee[1] - 1, s: label, size: 3.5, anchor: right ? "start" : "end", layer: "dim" };
      texts.push(text);
      occ.addPoly([e, knee, shelf]);
      occ.addRect({ x: Math.min(knee[0], shelf[0]), y: knee[1] - 4.6, w: tw, h: 5.4 });
    }
  }
}

/** Čára řezu A–A v nadřazeném pohledu (tenká čerchovaná se silnými konci, šipky ve směru pohledu). */
function cuttingPlane(plane: PlaneName, offset: number, placed: Map<string, Placed>, polys: Poly[], texts: DText[], warnings: string[]) {
  const n = PLANE_N[plane];
  const cam = SECTION_CAM[plane];
  const parent = [...placed.values()].find((p) => p.key !== "section" && Math.abs(dot(p.cam.d, n)) < 1e-6);
  if (!parent) {
    warnings.push(tr("Čáru řezu nelze zakreslit – zapněte pohled, ve kterém je rovina řezu vidět jako čára."));
    return;
  }
  // přímka v obraze rodiče: body p, pro které p·n = offset
  const nu = dot(n, parent.cam.x);
  const nw = dot(n, upOf(parent.cam));
  // směr přímky v obraze (u, w): kolmý na (nu, nw)
  const dir2: Vec2 = [-nw, nu];
  const p0: Vec2 = [nu * offset, nw * offset]; // bod na přímce (u, w)
  // rozsah: přes celý pohled
  const corners: Vec2[] = [
    [parent.x0, parent.y0],
    [parent.x0 + parent.w, parent.y0 + parent.h],
  ];
  const span = Math.hypot(parent.w, parent.h) / 2 + 6 / parent.s;
  const midU = (corners[0][0] + corners[1][0]) / 2;
  const midW = -(corners[0][1] + corners[1][1]) / 2;
  // projekce středu pohledu na přímku
  const t0 = (midU - p0[0]) * dir2[0] + (midW - p0[1]) * dir2[1];
  const ends: Vec2[] = [-1, 1].map((sg) => {
    const t = t0 + sg * span;
    const u = p0[0] + dir2[0] * t;
    const w = p0[1] + dir2[1] * t;
    return toSheet(parent, [u, -w]);
  });
  // ořez na obdélník pohledu + 6 mm
  const bx0 = parent.px - 6;
  const by0 = parent.py - 6;
  const bx1 = parent.px + parent.w * parent.s + 6;
  const by1 = parent.py + parent.h * parent.s + 6;
  const clip = clipSegment(ends[0], ends[1], bx0, by0, bx1, by1);
  if (!clip) {
    warnings.push(tr("Čára řezu leží mimo pohled."));
    return;
  }
  const [a, b] = clip;
  const L = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1;
  const ux = (b[0] - a[0]) / L;
  const uy = (b[1] - a[1]) / L;
  polys.push({ layer: "cut", pts: [a, b] });
  const thick = 6;
  polys.push({ layer: "cut", width: 0.5, pts: [a, [a[0] + ux * thick, a[1] + uy * thick]] });
  polys.push({ layer: "cut", width: 0.5, pts: [b, [b[0] - ux * thick, b[1] - uy * thick]] });
  // směr pohledu (od pozorovatele k materiálu) = −d řezu promítnutý do rodiče
  const vd = mul(cam.d, -1);
  let ax = dot(vd, parent.cam.x);
  let ay = -dot(vd, upOf(parent.cam));
  const al = Math.hypot(ax, ay) || 1;
  ax /= al;
  ay /= al;
  for (const e of [a, [a[0] + ux * 3, a[1] + uy * 3] as Vec2, b, [b[0] - ux * 3, b[1] - uy * 3] as Vec2].filter((_, i) => i % 2 === 1)) {
    const tip: Vec2 = [e[0] + ax * 8, e[1] + ay * 8];
    polys.push({ layer: "cut", width: 0.35, pts: [e, tip] });
    arrow(polys, tip[0], tip[1], -ax, -ay);
    texts.push({ x: tip[0] + ax * 2.5 + (ux === 0 ? 2.5 : 0), y: tip[1] + ay * 2.5 + 2, s: "A", size: 5, anchor: "middle", bold: true, layer: "text" });
  }
}

function clipSegment(p: Vec2, q: Vec2, x0: number, y0: number, x1: number, y1: number): [Vec2, Vec2] | null {
  let t0 = 0,
    t1 = 1;
  const dx = q[0] - p[0];
  const dy = q[1] - p[1];
  const chk = (pp: number, qq: number) => {
    if (pp === 0) return qq >= 0;
    const t = qq / pp;
    if (pp < 0) {
      if (t > t1) return false;
      if (t > t0) t0 = t;
    } else {
      if (t < t0) return false;
      if (t < t1) t1 = t;
    }
    return true;
  };
  if (chk(-dx, p[0] - x0) && chk(dx, x1 - p[0]) && chk(-dy, p[1] - y0) && chk(dy, y1 - p[1]))
    return [
      [p[0] + dx * t0, p[1] + dy * t0],
      [p[0] + dx * t1, p[1] + dy * t1],
    ];
  return null;
}

// ---------------------------------------------------------------- rám a razítko

function rect(polys: Poly[], x: number, y: number, w: number, h: number, layer: Layer = "frame", width?: number) {
  polys.push({ layer, width, pts: [[x, y], [x + w, y], [x + w, y + h], [x, y + h], [x, y]] });
}

function frame(W: number, H: number, polys: Poly[]) {
  rect(polys, M_LEFT, M, W - M_LEFT - M, H - 2 * M, "frame", 0.7);
  // centrovací značky (ISO 5457)
  const cxm = (M_LEFT + W - M) / 2;
  const cym = H / 2;
  polys.push({ layer: "frame", width: 0.7, pts: [[cxm, 0], [cxm, M + 5]] }, { layer: "frame", width: 0.7, pts: [[cxm, H], [cxm, H - M - 5]] });
  polys.push({ layer: "frame", width: 0.7, pts: [[0, cym], [M_LEFT + 5, cym]] }, { layer: "frame", width: 0.7, pts: [[W, cym], [W - M - 5, cym]] });
}

function projectionSymbol(polys: Poly[], x: number, y: number, projection: "E" | "A") {
  // komolý kužel: lichoběžník + dvě soustředné kružnice (ISO 5456-2), výška 8 mm
  const h = 7;
  const trap = (tx: number, wideLeft: boolean) => {
    const big = h;
    const small = h * 0.5;
    const L = 9;
    const [lh, rh] = wideLeft ? [big, small] : [small, big];
    polys.push({ layer: "title", width: 0.35, pts: [[tx, y + (h - lh) / 2], [tx + L, y + (h - rh) / 2], [tx + L, y + (h + rh) / 2], [tx, y + (h + lh) / 2], [tx, y + (h - lh) / 2]] });
    polys.push({ layer: "center", pts: [[tx - 1.5, y + h / 2], [tx + L + 1.5, y + h / 2]] });
  };
  const circ = (ccx: number) => {
    for (const rr of [h / 2, h / 4]) {
      const pts: Vec2[] = [];
      for (let i = 0; i <= 36; i++) pts.push([ccx + rr * Math.cos((i / 36) * 2 * Math.PI), y + h / 2 + rr * Math.sin((i / 36) * 2 * Math.PI)]);
      polys.push({ layer: "title", width: 0.35, pts });
    }
    polys.push({ layer: "center", pts: [[ccx - h / 2 - 1.5, y + h / 2], [ccx + h / 2 + 1.5, y + h / 2]] }, { layer: "center", pts: [[ccx, y - 1.5], [ccx, y + h + 1.5]] });
  };
  if (projection === "E") {
    trap(x, true);
    circ(x + 9 + 4 + h / 2);
  } else {
    circ(x + h / 2);
    trap(x + h + 4, false);
  }
}

function titleBlock(W: number, H: number, sheet: SheetName, scale: number, projection: "E" | "A", meta: DrawingMeta, polys: Poly[], texts: DText[], extraAbove = 0) {
  const x = W - M - TB.w;
  const y = H - M - TB.h;
  const T = (tx: number, ty: number, s: string, size: number, bold = false, brand = false) => texts.push({ x: tx, y: ty, s, size, bold, brand, layer: "text" });
  rect(polys, x, y, TB.w, TB.h, "frame", 0.7);
  const L = 55; // levý blok
  polys.push({ layer: "title", pts: [[x + L, y], [x + L, y + TB.h]] });
  // řádky pravé části
  const r1 = 13;
  const r2 = 25.5;
  polys.push({ layer: "title", pts: [[x + L, y + r1], [x + TB.w, y + r1]] }, { layer: "title", pts: [[x + L, y + r2], [x + TB.w, y + r2]] });
  const vline = (vx: number, y0: number, y1: number) => polys.push({ layer: "title", pts: [[x + vx, y + y0], [x + vx, y + y1]] });
  vline(115, r1, r2);
  for (const vx of [75, 92, 117, 145, 166]) vline(vx, r2, TB.h);
  const cell = (cx: number, cy: number, label: string, value: string, size = 3.2, bold = false) => {
    T(x + cx + 1.5, y + cy + 3.2, label, 2);
    if (value) T(x + cx + 1.5, y + cy + 3.2 + size + 2.6, value, size, bold);
  };
  // levý blok – firma
  T(x + 3, y + 8.5, "Mnástrojárna s.r.o.", 4.6, true, true);
  T(x + 3, y + 13.5, tr("Váš partner ve strojírenství"), 2.6);
  T(x + 3, y + 18, "www.mnastrojarna.cz", 2.4);
  polys.push({ layer: "title", pts: [[x, y + 21], [x + L, y + 21]] });
  T(x + 3, y + 25, tr("Promítání"), 2);
  projectionSymbol(polys, x + 4, y + 27.5, projection);
  T(x + 30, y + 33, projection === "E" ? "ISO E" : "ISO A", 3, true);
  // pravá část
  cell(L, 0, tr("Název"), (meta.name || tr("Bez názvu")).slice(0, 46), 4.2, true);
  cell(L, r1, tr("Číslo výkresu"), (meta.number ?? "").slice(0, 26), 3.4, true);
  cell(115, r1, tr("Materiál"), (meta.material ?? "").slice(0, 28));
  cell(L, r2, tr("Měřítko"), scaleLabel(scale), 3.2, true);
  cell(75, r2, tr("Formát"), sheet);
  cell(92, r2, tr("Hmotnost"), meta.massKg != null ? `${fmt(meta.massKg)} kg` : "—");
  cell(117, r2, tr("Kreslil"), (meta.author ?? "").slice(0, 16));
  cell(145, r2, tr("Datum"), meta.date ?? new Date().toLocaleDateString(cadLocale()), 2.8);
  cell(166, r2, "Rev.", meta.revision ?? "–");
  // poznámka nad razítkem a list
  const ny = y - bomHeight(meta.bom) - extraAbove;
  // výrobní požadavky (tolerance, hrany) jen když je uživatel zadal – nic se nedoplňuje automaticky
  T(x, ny - 5.5, [tr("Rozměry v mm"), meta.tolerance?.trim() ? tr("Nepředepsané tolerance {0}", meta.tolerance.trim()) : "", meta.edges?.trim() ? tr("Hrany: {0}", meta.edges.trim()) : ""].filter(Boolean).join(" · "), 2.5);
  // poznámka k modelu jen na vyžádání (razítko → „Poznámka v patičce“) – nic nenaznačuje úplnost dokumentace automaticky
  T(x, ny - 1.8, [meta.note?.trim() ?? "", tr("List {0}/{1}", meta.sheetIndex ?? 1, meta.sheetCount ?? 1)].filter(Boolean).join(" · "), 2.5);
}

// ---------------------------------------------------------------- kusovník (ISO 7573)

const BOM_ROW = 7;
/** sloupce: Pozice | Název | Číslo výkresu/normy | Ks | Materiál | Hmotnost (součet = šířka razítka) */
const BOM_COLS: [string, number][] = [
  [tr("Poz."), 12],
  [tr("Název"), 52],
  [tr("Číslo výkresu / normy"), 40],
  ["Ks", 12],
  [tr("Materiál"), 36],
  [tr("Hmotnost"), 28],
];

const bomHeight = (bom?: BomItem[]) => (bom?.length ? (bom.length + 1) * BOM_ROW : 0);

/** Kusovník nad razítkem: hlavička dole, položky rostou nahoru (poz. 1 nejníže). */
function partsList(x: number, yBottom: number, bom: BomItem[], polys: Poly[], texts: DText[]) {
  const items = [...bom].sort((a, b) => a.pos - b.pos);
  const h = (items.length + 1) * BOM_ROW;
  const y0 = yBottom - h;
  rect(polys, x, y0, TB.w, h, "frame", 0.7);
  for (let i = 1; i <= items.length; i++) {
    const yy = y0 + i * BOM_ROW;
    // silná čára nad hlavičkou
    polys.push({ layer: "title", width: i === items.length ? 0.5 : undefined, pts: [[x, yy], [x + TB.w, yy]] });
  }
  let cx = x;
  const colX: number[] = [];
  for (const [, w] of BOM_COLS) {
    colX.push(cx);
    cx += w;
    if (cx < x + TB.w - 1e-6) polys.push({ layer: "title", pts: [[cx, y0], [cx, yBottom]] });
  }
  const cellText = (col: number, rowBottom: number, s: string, bold = false, size = 2.8) => {
    const [, w] = BOM_COLS[col];
    const center = col === 0 || col === 3;
    const max = Math.floor((w - 2) / (size * 0.52));
    const str = s.length > max ? s.slice(0, Math.max(1, max - 1)) + "…" : s;
    texts.push({ x: center ? colX[col] + w / 2 : colX[col] + 1.5, y: rowBottom - 2.2, s: str, size, bold, anchor: center ? "middle" : "start", layer: "text" });
  };
  BOM_COLS.forEach(([label], i) => cellText(i, yBottom, label, true, 2.5));
  items.forEach((it, i) => {
    const rb = yBottom - (i + 1) * BOM_ROW;
    cellText(0, rb, String(it.pos));
    cellText(1, rb, it.name + (it.note ? ` (${it.note})` : ""));
    cellText(2, rb, it.number ?? "");
    cellText(3, rb, fmt(it.qty));
    cellText(4, rb, it.material ?? "");
    cellText(5, rb, it.massKg != null ? `${fmt(it.massKg)} kg` : "");
  });
}

// ---------------------------------------------------------------- tabulka děr

const HOLE_ROW = 5.5;
const HOLE_COLS: [string, number][] = [
  [tr("Značka"), 24],
  ["X", 40],
  ["Y", 40],
  ["Ø", 40],
  ["Ks", 36],
];
const holeTableHeight = (rows: HoleRow[]) => (rows.length ? (rows.length + 1) * HOLE_ROW + 4 : 0);

/** Díry v daném pohledu: kružnice ohraničující válcové plochy s osou ve směru pohledu; obě hrany téže díry = jeden řádek. */
function holeRowsOf(circles: Circle[], viewKey: string, cam: Cam): HoleRow[] {
  const seen = new Map<string, { c: Vec2; d: number }>();
  for (const c of circles) {
    if (!c.cyl) continue;
    if (Math.abs(Math.abs(dot(c.a, cam.d)) - 1) > 1e-3) continue;
    const q = proj(cam, c.c);
    const key = `${k3(q[0], 2)},${k3(q[1], 2)},${k3(c.r * 2, 2)}`;
    if (!seen.has(key)) seen.set(key, { c: q, d: Math.round(c.r * 200) / 100 });
  }
  const list = [...seen.values()].sort((a, b) => a.d - b.d || a.c[1] - b.c[1] || a.c[0] - b.c[0]);
  // počátek souřadnic = levý dolní roh obrysu v pohledu (min x, max y obrazu)
  let x0 = Infinity;
  let yMax = -Infinity;
  for (const h of list) {
    x0 = Math.min(x0, h.c[0]);
    yMax = Math.max(yMax, h.c[1]);
  }
  const diameters = [...new Set(list.map((h) => h.d))];
  const counters: Record<string, number> = {};
  return list.map((h) => {
    const letter = String.fromCharCode(65 + Math.min(25, diameters.indexOf(h.d)));
    counters[letter] = (counters[letter] ?? 0) + 1;
    return { tag: `${letter}${counters[letter]}`, x: Math.round((h.c[0] - x0) * 100) / 100, y: Math.round((yMax - h.c[1]) * 100) / 100, d: h.d, c: h.c, view: viewKey in CAMS ? viewKey : "top" };
  });
}

/** Tabulka děr nad kusovníkem/razítkem: Značka | X | Y | Ø | Ks (shodné průměry se sečtou do Ks ve sloupci „Ks“ řádku). */
function holeTable(x: number, yBottom: number, rows: HoleRow[], polys: Poly[], texts: DText[]) {
  const h = holeTableHeight(rows) - 4;
  const y0 = yBottom - 4 - h;
  rect(polys, x, y0, TB.w, h, "frame", 0.7);
  for (let i = 1; i <= rows.length; i++) polys.push({ layer: "title", width: i === 1 ? 0.5 : undefined, pts: [[x, y0 + i * HOLE_ROW], [x + TB.w, y0 + i * HOLE_ROW]] });
  let cx = x;
  const colX: number[] = [];
  for (const [, w] of HOLE_COLS) {
    colX.push(cx);
    cx += w;
    if (cx < x + TB.w - 1e-6) polys.push({ layer: "title", pts: [[cx, y0], [cx, y0 + h]] });
  }
  const cell = (col: number, rowBottom: number, s: string, bold = false) => texts.push({ x: colX[col] + HOLE_COLS[col][1] / 2, y: rowBottom - 1.6, s, size: 2.6, bold, anchor: "middle", layer: "text" });
  HOLE_COLS.forEach(([label], i) => cell(i, y0 + HOLE_ROW, i === 0 ? tr("Tabulka děr") : label, true));
  const countByD = new Map<number, number>();
  for (const r of rows) countByD.set(r.d, (countByD.get(r.d) ?? 0) + 1);
  rows.forEach((r, i) => {
    const rb = y0 + (i + 2) * HOLE_ROW;
    cell(0, rb, r.tag, true);
    cell(1, rb, fmt(r.x));
    cell(2, rb, fmt(r.y));
    cell(3, rb, `Ø${fmt(r.d)}`);
    cell(4, rb, `${countByD.get(r.d) ?? 1}×`);
  });
}

// ---------------------------------------------------------------- tabulka revizí

const REV_COLS: [string, number][] = [
  [tr("Rev."), 12],
  [tr("Datum"), 24],
  [tr("Popis změny"), 66],
  [tr("Kreslil"), 22],
];
const REV_ROW = 6;

/** Tabulka revizí v pravém horním rohu listu. */
function revisionTable(W: number, revisions: RevisionItem[], polys: Poly[], texts: DText[]) {
  const w = REV_COLS.reduce((a, [, c]) => a + c, 0);
  const x = W - M - w;
  const y = M + 6;
  const h = (revisions.length + 1) * REV_ROW;
  rect(polys, x, y, w, h, "frame", 0.7);
  for (let i = 1; i <= revisions.length; i++) polys.push({ layer: "title", width: i === 1 ? 0.5 : undefined, pts: [[x, y + i * REV_ROW], [x + w, y + i * REV_ROW]] });
  let cx = x;
  const colX: number[] = [];
  for (const [, cw] of REV_COLS) {
    colX.push(cx);
    cx += cw;
    if (cx < x + w - 1e-6) polys.push({ layer: "title", pts: [[cx, y], [cx, y + h]] });
  }
  const cell = (col: number, rowBottom: number, s: string, bold = false) => {
    const max = Math.floor((REV_COLS[col][1] - 2) / (2.6 * 0.52));
    texts.push({ x: colX[col] + 1.5, y: rowBottom - 1.8, s: s.length > max ? s.slice(0, max - 1) + "…" : s, size: 2.6, bold, layer: "text" });
  };
  REV_COLS.forEach(([label], i) => cell(i, y + REV_ROW, label, true));
  revisions.forEach((r, i) => {
    const rb = y + (i + 2) * REV_ROW;
    cell(0, rb, r.rev, true);
    cell(1, rb, r.date);
    cell(2, rb, r.note);
    cell(3, rb, r.author ?? "");
  });
}

// ---------------------------------------------------------------- detailní pohled

/** Oříznutí lomené čáry kruhem (střed c, poloměr r) – vrací části uvnitř. */
export function clipPolylineToCircle(pts: Vec2[], c: Vec2, r: number): Vec2[][] {
  const out: Vec2[][] = [];
  let cur: Vec2[] = [];
  const inside = (p: Vec2) => Math.hypot(p[0] - c[0], p[1] - c[1]) <= r + 1e-9;
  const hits = (p: Vec2, q: Vec2): number[] => {
    const dx = q[0] - p[0];
    const dy = q[1] - p[1];
    const fx = p[0] - c[0];
    const fy = p[1] - c[1];
    const a = dx * dx + dy * dy;
    if (a < 1e-18) return [];
    const b = 2 * (fx * dx + fy * dy);
    const cc = fx * fx + fy * fy - r * r;
    const disc = b * b - 4 * a * cc;
    if (disc < 0) return [];
    const sq = Math.sqrt(disc);
    return [(-b - sq) / (2 * a), (-b + sq) / (2 * a)].filter((t) => t > 0 && t < 1).sort((u, v) => u - v);
  };
  const lerp = (p: Vec2, q: Vec2, t: number): Vec2 => [p[0] + (q[0] - p[0]) * t, p[1] + (q[1] - p[1]) * t];
  for (let i = 0; i < pts.length; i++) {
    const p = pts[i];
    if (i === 0) {
      if (inside(p)) cur.push(p);
      continue;
    }
    const q = pts[i - 1];
    const ts = hits(q, p);
    let segIn = inside(q);
    let last = q;
    for (const t of ts) {
      const m = lerp(q, p, t);
      if (segIn) {
        cur.push(m);
        if (cur.length > 1) out.push(cur);
        cur = [];
      } else cur = [m];
      segIn = !segIn;
      last = m;
    }
    void last;
    if (segIn) cur.push(p);
  }
  if (cur.length > 1) out.push(cur);
  return out;
}

/** Vykreslí detailní pohled: kroužek s písmenem v rodičovském pohledu + zvětšená oříznutá kopie na listu. */
function detailView(d: DetailView, p: Placed, SW: number, SH: number, TBH: number, polys: Poly[], texts: DText[], out: NonNullable<DrawingResult["details"]>): boolean {
  const cs = toSheet(p, [d.cx, d.cy]);
  const rs = d.r * p.s;
  polys.push({ layer: "thin", pts: circlePts(cs, rs, 48) });
  texts.push({ x: cs[0] + rs * 0.75, y: cs[1] - rs * 0.75, s: d.label, size: 5, bold: true, layer: "text" });
  const clipped: { layer: Layer; pts: Vec2[] }[] = [];
  for (const pl of p.polys) for (const part of clipPolylineToCircle(pl.pts, [d.cx, d.cy], d.r)) clipped.push({ layer: pl.layer, pts: part });
  if (!clipped.length) return false;
  const size = 2 * d.r * d.scale;
  const at: Vec2 = d.at ?? [Math.min(SW - M - size - 4, p.px + p.w * p.s + 20), Math.max(M + 12, Math.min(SH - M - TBH - size - 10, p.py))];
  const map = (q: Vec2): Vec2 => [at[0] + (q[0] - (d.cx - d.r)) * d.scale, at[1] + (q[1] - (d.cy - d.r)) * d.scale];
  for (const c of clipped) polys.push({ layer: c.layer, pts: c.pts.map(map) });
  const center: Vec2 = [at[0] + size / 2, at[1] + size / 2];
  polys.push({ layer: "thin", pts: circlePts(center, size / 2, 64) });
  texts.push({ x: center[0], y: at[1] - 3, s: `${d.label} (${scaleLabel(d.scale)})`, size: 4.5, bold: true, anchor: "middle", layer: "text" });
  out.push({ id: d.id, label: d.label, x: at[0], y: at[1], w: size, h: size });
  return true;
}

// ---------------------------------------------------------------- pozice (balónky)

/**
 * Balónky s čísly pozic u hlavního pohledu s odkazy na průmět středu komponenty.
 * Řady nad a pod pohledem se použijí jen tam, kde se vejdou do rámu (a mimo razítko); jinak sloupec vlevo od pohledu.
 */
function balloonsFor(items: BalloonItem[], v: Placed, polys: Poly[], texts: DText[], out: NonNullable<DrawingResult["balloons"]>, bounds: { top: number; bottom: number; left: number; right: number }) {
  const R = 4;
  const pts = items
    .map((it) => {
      const c: Vec3 = [(it.bbox[0][0] + it.bbox[1][0]) / 2, (it.bbox[0][1] + it.bbox[1][1]) / 2, (it.bbox[0][2] + it.bbox[1][2]) / 2];
      return { pos: it.pos, q: toSheet(v, proj(v.cam, c)) };
    })
    .sort((a, b) => a.q[0] - b.q[0]);
  const n = pts.length;
  const left = v.px;
  const width = v.w * v.s;
  const clampX = (x: number) => Math.max(bounds.left + R, Math.min(bounds.right - R, x));
  const clampY = (y: number) => Math.max(bounds.top + R, Math.min(bounds.bottom - R, y));
  const aboveY = v.py - 12 - R;
  const belowY = v.py + v.h * v.s + 12 + R;
  const rows = [aboveY, belowY].filter((y) => y - R >= bounds.top && y + R <= bounds.bottom);
  const place = (b: { pos: number; q: Vec2 }, bx: number, by: number) => {
    polys.push({ layer: "dim", pts: circlePts([bx, by], R, 32) });
    texts.push({ x: bx, y: by + 1.3, s: String(b.pos), size: 3.5, anchor: "middle", bold: true, layer: "dim" });
    // odkazová čára od okraje kroužku k bodu komponenty, zakončená tečkou
    const dx = b.q[0] - bx;
    const dy = b.q[1] - by;
    const l = Math.hypot(dx, dy) || 1;
    polys.push({ layer: "dim", pts: [[bx + (dx / l) * R, by + (dy / l) * R], b.q] });
    polys.push({ layer: "dim", fill: true, pts: circlePts(b.q, 0.7, 10) });
    out.push({ pos: b.pos, x: bx, y: by });
  };
  if (rows.length) {
    const perRow = Math.ceil(n / rows.length);
    const spacing = Math.max(2 * R + 3, Math.min(14, width / Math.max(1, perRow)));
    pts.forEach((b, i) => place(b, clampX(left + Math.floor(i / rows.length) * spacing + R), rows[i % rows.length]));
    return;
  }
  // pohled sahá až k rámu nahoře i dole → sloupec vlevo od pohledu
  const bx = clampX(v.px - 12 - R);
  pts.forEach((b, i) => place(b, bx, clampY(v.py + i * (2 * R + 3) + R)));
}

/** Kusovník jako CSV pro Excel (středníky, UTF-8 s BOM, CRLF). */
export function bomToCsv(bom: BomItem[]): string {
  const q = (v: string | number | undefined) => {
    const s = v == null ? "" : String(v);
    return /[;"\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const num = (n?: number) => (n == null ? "" : String(Math.round(n * 1000) / 1000).replace(".", ","));
  const rows = [[tr("Pozice"), tr("Název"), tr("Číslo výkresu / normy"), tr("Ks"), tr("Materiál"), tr("Hmotnost [kg]"), tr("Poznámka")].join(";")];
  for (const it of [...bom].sort((a, b) => a.pos - b.pos)) rows.push([q(it.pos), q(it.name), q(it.number), num(it.qty), q(it.material), num(it.massKg), q(it.note)].join(";"));
  return "﻿" + rows.join("\r\n") + "\r\n";
}

// ---------------------------------------------------------------- SVG

const STYLE: Record<Layer, { w: number; dash?: string; color: string }> = {
  visible: { w: 0.5, color: "#111" },
  hidden: { w: 0.25, dash: "3 1.5", color: "#333" },
  center: { w: 0.18, dash: "12 3 1.5 3", color: "#333" },
  cut: { w: 0.18, dash: "12 3 1.5 3", color: "#111" },
  dim: { w: 0.18, color: "#111" },
  hatch: { w: 0.18, color: "#333" },
  frame: { w: 0.5, color: "#111" },
  thin: { w: 0.3, color: "#222" },
  title: { w: 0.25, color: "#111" },
};
export const LAYER_STYLE = STYLE;

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);

export function toSvg(W: number, H: number, polys: Poly[], texts: DText[]) {
  const f = (n: number) => (Math.round(n * 1000) / 1000).toString();
  const out: string[] = [];
  for (const p of polys) {
    const st = STYLE[p.layer];
    const pts = p.pts.map(([x, y]) => `${f(x)},${f(y)}`).join(" ");
    if (p.fill) out.push(`<polygon points="${pts}" fill="${st.color}" stroke="none"/>`);
    else {
      const dash = st.dash && p.width == null ? ` stroke-dasharray="${st.dash}"` : "";
      out.push(`<polyline fill="none" stroke="${st.color}" stroke-width="${p.width ?? st.w}"${dash} points="${pts}"/>`);
    }
  }
  for (const t of texts) {
    const rot = t.rotate ? ` transform="rotate(${f(t.rotate)} ${f(t.x)} ${f(t.y)})"` : "";
    out.push(
      `<text x="${f(t.x)}" y="${f(t.y)}" font-size="${t.size}"${t.bold ? ' font-weight="700"' : ""} text-anchor="${t.anchor ?? "start"}"${rot} fill="${t.brand ? "#E03930" : "#111"}">${esc(t.s)}</text>`,
    );
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}mm" height="${H}mm" viewBox="0 0 ${W} ${H}" font-family="Roboto, Arial, Helvetica, sans-serif" stroke-linecap="round" stroke-linejoin="round"><rect width="${W}" height="${H}" fill="#fff"/>${out.join("")}</svg>`;
}

// ---------------------------------------------------------------- DXF (R12, mm)

const DXF_LAYER: Record<Layer, string> = {
  visible: "OBRYS",
  thin: "OBRYS",
  hidden: "SKRYTE",
  center: "OSY",
  cut: "OSY",
  dim: "KOTY",
  hatch: "SRAFY",
  frame: "RAM",
  title: "RAM",
};

/** Ne-ASCII znaky jako \U+XXXX (AutoCAD, ZWCAD, LibreCAD, DraftSight). */
const dxfText = (s: string) => s.replace(/[^\x20-\x7e]/g, (c) => `\\U+${c.codePointAt(0)!.toString(16).toUpperCase().padStart(4, "0")}`);

/** DXF R12 (AC1009) – vrstvy, typy čar, textový styl; souřadnice v mm, počátek vlevo dole. */
export function toDxf(H: number, polys: Poly[], texts: DText[]) {
  const o: string[] = [];
  const add = (...kv: (string | number)[]) => {
    for (const v of kv) o.push(String(v));
  };
  const f = (n: number) => (Math.round(n * 1e4) / 1e4).toString();
  add(0, "SECTION", 2, "HEADER");
  add(9, "$ACADVER", 1, "AC1009");
  add(9, "$INSUNITS", 70, 4);
  add(9, "$MEASUREMENT", 70, 1);
  add(9, "$LTSCALE", 40, 1);
  add(9, "$DWGCODEPAGE", 3, "ANSI_1250");
  add(0, "ENDSEC");
  add(0, "SECTION", 2, "TABLES");
  // typy čar
  const ltypes: [string, string, number[]][] = [
    ["CONTINUOUS", "Solid line", []],
    ["HIDDEN", "Hidden __ __ __", [3, -1.5]],
    ["CENTER", "Center ____ _ ____ _", [12, -3, 1.5, -3]],
  ];
  add(0, "TABLE", 2, "LTYPE", 70, ltypes.length);
  for (const [name, desc, pat] of ltypes) {
    add(0, "LTYPE", 2, name, 70, 0, 3, desc, 72, 65, 73, pat.length, 40, f(pat.reduce((a, b) => a + Math.abs(b), 0)));
    for (const p of pat) add(49, f(p));
  }
  add(0, "ENDTAB");
  const layers: [string, number, string][] = [
    ["0", 7, "CONTINUOUS"],
    ["OBRYS", 7, "CONTINUOUS"],
    ["SKRYTE", 8, "HIDDEN"],
    ["OSY", 5, "CENTER"],
    ["KOTY", 3, "CONTINUOUS"],
    ["SRAFY", 9, "CONTINUOUS"],
    ["RAM", 7, "CONTINUOUS"],
    ["TEXT", 7, "CONTINUOUS"],
  ];
  add(0, "TABLE", 2, "LAYER", 70, layers.length);
  for (const [name, color, lt] of layers) add(0, "LAYER", 2, name, 70, 0, 62, color, 6, lt);
  add(0, "ENDTAB");
  add(0, "TABLE", 2, "STYLE", 70, 1);
  add(0, "STYLE", 2, "ISO", 70, 0, 40, 0, 41, 1, 50, 0, 71, 0, 42, 3.5, 3, "isocp.shx", 4, "");
  add(0, "ENDTAB");
  add(0, "ENDSEC");
  add(0, "SECTION", 2, "ENTITIES");
  for (const p of polys) {
    const layer = DXF_LAYER[p.layer];
    if (p.fill && p.pts.length >= 3) {
      const [a, b, c] = p.pts;
      add(0, "SOLID", 8, layer, 10, f(a[0]), 20, f(H - a[1]), 30, 0, 11, f(b[0]), 21, f(H - b[1]), 31, 0, 12, f(c[0]), 22, f(H - c[1]), 32, 0, 13, f(c[0]), 23, f(H - c[1]), 33, 0);
      continue;
    }
    if (p.pts.length === 2) {
      const [[x1, y1], [x2, y2]] = p.pts;
      add(0, "LINE", 8, layer, 10, f(x1), 20, f(H - y1), 30, 0, 11, f(x2), 21, f(H - y2), 31, 0);
      continue;
    }
    if (p.pts.length < 2) continue;
    // POLYLINE se souvislým generováním typu čáry (70: 128)
    add(0, "POLYLINE", 8, layer, 66, 1, 10, 0, 20, 0, 30, 0, 70, 128);
    for (const [x, y] of p.pts) add(0, "VERTEX", 8, layer, 10, f(x), 20, f(H - y), 30, 0);
    add(0, "SEQEND", 8, layer);
  }
  for (const t of texts) {
    const al = t.anchor === "middle" ? 1 : t.anchor === "end" ? 2 : 0;
    const layer = t.layer === "dim" ? "KOTY" : "TEXT";
    add(0, "TEXT", 8, layer, 10, f(t.x), 20, f(H - t.y), 30, 0, 40, f(t.size * 0.72), 1, dxfText(t.s), 50, f(-(t.rotate ?? 0)), 7, "ISO");
    if (al) add(72, al, 11, f(t.x), 21, f(H - t.y), 31, 0);
  }
  add(0, "ENDSEC", 0, "EOF");
  return o.join("\n") + "\n";
}

// ---------------- uživatelské kóty a poznámky (asociativní) ----------------

import type { DrawingAnnotation, GdtSymbol } from "./types";
import { calloutGeometry, symbolsAsGeometry } from "./drawing-symbols";

const fmtVal = (n: number) => (Math.round(n * 100) / 100).toLocaleString(cadLocale());

/** souřadnice pohledu → list; `view: "sheet"` = už v mm listu */
export function annToSheet(views: PlacedView[], view: string, q: Vec2): Vec2 {
  if (view === "sheet") return q;
  const v = views.find((x) => x.key === view);
  if (!v) return q;
  return [v.px + (q[0] - v.x0) * v.s, v.py + (q[1] - v.y0) * v.s];
}
/** list → souřadnice pohledu */
export function sheetToAnn(v: PlacedView, q: Vec2): Vec2 {
  return [(q[0] - v.px) / v.s + v.x0, (q[1] - v.py) / v.s + v.y0];
}
/** který pohled obsahuje bod listu (s okrajem) */
export function viewAt(views: PlacedView[], q: Vec2, margin = 12): PlacedView | null {
  let best: PlacedView | null = null;
  let bd = Infinity;
  for (const v of views) {
    const w = v.w * v.s;
    const h = v.h * v.s;
    const dx = Math.max(v.px - q[0], 0, q[0] - (v.px + w));
    const dy = Math.max(v.py - q[1], 0, q[1] - (v.py + h));
    const d = Math.hypot(dx, dy);
    if (d <= margin && d < bd) {
      bd = d;
      best = v;
    }
  }
  return best;
}

export const GDT_LABEL: Record<GdtSymbol, string> = {
  straight: "Přímost",
  flat: "Rovinnost",
  circ: "Kruhovitost",
  cyl: "Válcovitost",
  prof: "Tvar plochy",
  par: "Rovnoběžnost",
  perp: "Kolmost",
  angle: "Sklon",
  pos: "Poloha",
  conc: "Soustřednost",
  sym: "Souměrnost",
  runout: "Házení",
};

function arrowAt(polys: Poly[], tip: Vec2, dir: Vec2, layer: Layer = "dim") {
  const l = 3;
  const w = 0.8;
  const d = Math.hypot(dir[0], dir[1]) || 1;
  const ux = dir[0] / d;
  const uy = dir[1] / d;
  polys.push({ layer, fill: true, pts: [tip, [tip[0] - ux * l - uy * w, tip[1] - uy * l + ux * w], [tip[0] - ux * l + uy * w, tip[1] - uy * l - ux * w], tip] });
}

function circlePts(c: Vec2, r: number, n = 24): Vec2[] {
  const out: Vec2[] = [];
  for (let i = 0; i <= n; i++) out.push([c[0] + r * Math.cos((2 * Math.PI * i) / n), c[1] + r * Math.sin((2 * Math.PI * i) / n)]);
  return out;
}

/** značka geometrické tolerance ISO 1101 jako geometrie (čáry) – funguje v SVG/DXF/DWG/PDF bez speciálního písma */
function gdtGlyph(polys: Poly[], c: Vec2, sym: GdtSymbol) {
  const r = 2;
  const L = (pts: Vec2[]) => polys.push({ layer: "dim", pts });
  const [x, y] = c;
  switch (sym) {
    case "straight": L([[x - r, y], [x + r, y]]); break;
    case "flat": L([[x - r, y + r * 0.6], [x - r * 0.2, y - r * 0.6], [x + r, y - r * 0.6], [x + r * 0.2, y + r * 0.6], [x - r, y + r * 0.6]]); break;
    case "circ": L(circlePts(c, r * 0.9)); break;
    case "cyl": L(circlePts(c, r * 0.8)); L([[x - r * 1.3, y + r], [x - r * 0.8, y - r]]); L([[x + r * 0.8, y + r], [x + r * 1.3, y - r]]); break;
    case "prof": { const pts = circlePts([x, y + r * 0.3], r * 0.9).filter((p) => p[1] <= y + r * 0.35); L([[x - r * 0.9, y + r * 0.3], ...pts.sort((a, b) => a[0] - b[0]), [x + r * 0.9, y + r * 0.3], [x - r * 0.9, y + r * 0.3]]); break; }
    case "par": L([[x - r * 0.7, y + r], [x - r * 0.1, y - r]]); L([[x + r * 0.1, y + r], [x + r * 0.7, y - r]]); break;
    case "perp": L([[x - r, y + r * 0.8], [x + r, y + r * 0.8]]); L([[x, y + r * 0.8], [x, y - r]]); break;
    case "angle": L([[x - r, y + r * 0.8], [x + r, y + r * 0.8], [x - r * 0.6, y - r]]); break;
    case "pos": L(circlePts(c, r * 0.7)); L([[x - r * 1.2, y], [x + r * 1.2, y]]); L([[x, y - r * 1.2], [x, y + r * 1.2]]); break;
    case "conc": L(circlePts(c, r * 0.9)); L(circlePts(c, r * 0.45)); break;
    case "sym": L([[x - r, y - r * 0.7], [x + r, y - r * 0.7]]); L([[x - r * 0.6, y], [x + r * 0.6, y]]); L([[x - r, y + r * 0.7], [x + r, y + r * 0.7]]); break;
    case "runout": L([[x - r * 0.9, y + r], [x + r * 0.7, y - r * 0.9]]); arrowAt(polys, [x + r * 0.9, y - r], [1, -1]); break;
  }
}

// ---------------- kóta podle vybrané geometrie (kružnice → Ø / R, hrana → délka, 2 hrany → úhel, 2 body → vzdálenost) ----------------

/** Co leží pod kurzorem při kótování (souřadnice pohledu): bod, hrana, nebo kružnice / oblouk. */
export type DimPick =
  | { kind: "point"; p: Vec2 }
  | { kind: "line"; a: Vec2; b: Vec2 }
  | { kind: "circle"; c: Vec2; r: number; /** celá kružnice nebo oblouk > 180° (výchozí kóta průměr); kratší oblouk se kótuje poloměrem */ full: boolean };
/** výběr pro kótu: pohled (`"sheet"` = mm listu) + entita v jeho souřadnicích */
export type DimSel = { view: string; pick: DimPick };
export type DimAnn = Extract<DrawingAnnotation, { type: "dim" }>;
type RadialDim = Extract<DimAnn, { kind: "diameter" | "radius" }>;
/** kóta průměru / poloměru (typová zábrana – zúžení podle `kind` se dvěma hodnotami TypeScript sám neudělá) */
export const isRadialDim = (a: DimAnn): a is RadialDim => a.kind === "diameter" || a.kind === "radius";
type OmitEach<T, K extends PropertyKey> = T extends unknown ? Omit<T, K> : never;
/** nová kóta bez identifikátoru */
export type NewDim = OmitEach<DimAnn, "id">;
export type DimModes = {
  /** druh délkové kóty (auto = podle směru) */
  linear: "auto" | "aligned" | "horizontal" | "vertical";
  /** kružnice / oblouk: auto = kružnice Ø, oblouk R */
  circle: "auto" | "diameter" | "radius";
  /** Shift při kliknutí: průměr ↔ poloměr */
  invert?: boolean;
};
/** stav kóty vůči geometrii pohledu: v pořádku · geometrie v pohledu nenalezena · pohled není na listu */
export type DimStatus = "ok" | "lost" | "noView";

type ArcEnt = Extract<ViewEnt, { t: "arc" }>;
const isFull = (e: ArcEnt) => Math.abs(e.da) >= TWO_PI - 1e-9;
/** poloha úhlu `phi` na oblouku od jeho začátku [rad] (0…2π) */
const arcPos = (e: ArcEnt, phi: number) => ((((e.da > 0 ? phi - e.a0 : e.a0 - phi) % TWO_PI) + TWO_PI) % TWO_PI);
const arcPoint = (e: ArcEnt, t: number): Vec2 => [e.c[0] + e.r * Math.cos(e.a0 + e.da * t), e.c[1] + e.r * Math.sin(e.a0 + e.da * t)];

/** Úhlové pokrytí kružnice (střed c, poloměr r) oblouky pohledu [rad] – viditelné i skryté části dohromady. */
export function arcCoverage(ents: ViewEnt[], c: Vec2, r: number): number {
  const tol = 1e-3 + 1e-4 * r;
  const iv: [number, number][] = [];
  for (const e of ents) {
    if (e.t !== "arc" || Math.abs(e.r - r) > tol || dist2(e.c, c) > tol) continue;
    if (isFull(e)) return TWO_PI;
    const s = ((((e.da > 0 ? e.a0 : e.a0 + e.da) % TWO_PI) + TWO_PI) % TWO_PI);
    const l = Math.abs(e.da);
    if (s + l > TWO_PI) iv.push([s, TWO_PI], [0, s + l - TWO_PI]);
    else iv.push([s, s + l]);
  }
  iv.sort((x, y) => x[0] - y[0]);
  let total = 0;
  let end = -1;
  for (const [s, t] of iv) {
    if (s > end) total += t - s;
    else if (t > end) total += t - end;
    end = Math.max(end, t);
  }
  return Math.min(TWO_PI, total);
}

/**
 * Entita pohledu pod kurzorem `q` (souřadnice pohledu), `tol` = dosah v jednotkách pohledu.
 * Body (konce hran a oblouků, středy kružnic) mají přednost v okolí konců; uprostřed hrany / na kružnici se vybere hrana / kružnice.
 * `want`: "point" = jen body (druhý bod kóty), "line" = jen hrany (druhá hrana úhlové kóty).
 */
export function pickViewEnt(ents: ViewEnt[], q: Vec2, tol: number, want: "any" | "point" | "line" = "any"): DimPick | null {
  const curveTol = 0.6 * tol;
  const best: { p: Vec2 | null; pd: number; c: DimPick | null; cd: number; hidden: boolean; len: number } = { p: null, pd: Infinity, c: null, cd: Infinity, hidden: false, len: 0 };
  const point = (p: Vec2) => {
    const d = dist2(p, q);
    if (d <= tol && d < best.pd) {
      best.pd = d;
      best.p = p;
    }
  };
  // při stejné vzdálenosti (hrany ležící na sobě) má přednost viditelná před skrytou a delší před kratší
  const better = (d: number, hidden: boolean, len: number) => d <= curveTol && (d < best.cd - 1e-9 || (Math.abs(d - best.cd) <= 1e-9 && (best.hidden === hidden ? len > best.len + 1e-9 : !hidden)));
  const curve = (c: DimPick, d: number, hidden: boolean, len: number) => {
    best.c = c;
    best.cd = d;
    best.hidden = hidden;
    best.len = len;
  };
  for (const e of ents) {
    if (e.t === "line") {
      if (want !== "line") {
        point(e.a);
        point(e.b);
      }
      if (want === "point") continue;
      const L = dist2(e.a, e.b);
      if (L < 1e-9) continue;
      const ux = (e.b[0] - e.a[0]) / L;
      const uy = (e.b[1] - e.a[1]) / L;
      const wx = q[0] - e.a[0];
      const wy = q[1] - e.a[1];
      const t = ux * wx + uy * wy;
      const zone = want === "line" ? -curveTol : Math.min(tol, L / 3); // konce hrany patří jejím koncovým bodům
      if (t < zone || t > L - zone) continue;
      const d = Math.abs(ux * wy - uy * wx);
      if (better(d, !!e.hidden, L)) curve({ kind: "line", a: e.a, b: e.b }, d, !!e.hidden, L);
    } else {
      const full = isFull(e);
      if (want !== "line") {
        point(e.c);
        if (!full) {
          point(arcPoint(e, 0));
          point(arcPoint(e, 1));
        }
      }
      if (want !== "any") continue;
      const d = Math.abs(dist2(q, e.c) - e.r);
      const len = e.r * Math.abs(e.da);
      if (!better(d, !!e.hidden, len)) continue;
      if (!full) {
        const pos = arcPos(e, angOf(e.c, q));
        const zone = Math.min(tol, (e.r * Math.abs(e.da)) / 3) / e.r;
        if (pos < zone || pos > Math.abs(e.da) - zone) continue;
      }
      curve({ kind: "circle", c: e.c, r: e.r, full: arcCoverage(ents, e.c, e.r) > Math.PI + 1e-6 }, d, !!e.hidden, len);
    }
  }
  if (best.p && (!best.c || best.pd * 0.6 <= best.cd)) return { kind: "point", p: best.p };
  return best.c;
}

/**
 * Geometrie úhlové kóty dvou přímek A–B a A2–B2 (souřadnice listu): průsečík X, ramena r1, r2 sektoru, do kterého míří
 * směr `angDeg` (od průsečíku k místu kóty), počáteční úhel t1, orientovaný rozsah `sweep` [rad] a úhel [°]. Null = rovnoběžné.
 */
export function angleGeom(A: Vec2, B: Vec2, A2: Vec2, B2: Vec2, angDeg: number) {
  const l1 = dist2(A, B);
  const l2 = dist2(A2, B2);
  if (l1 < 1e-9 || l2 < 1e-9) return null;
  const d1: Vec2 = [(B[0] - A[0]) / l1, (B[1] - A[1]) / l1];
  const d2: Vec2 = [(B2[0] - A2[0]) / l2, (B2[1] - A2[1]) / l2];
  const cr = d1[0] * d2[1] - d1[1] * d2[0];
  if (Math.abs(cr) < 1e-6) return null;
  const t = ((A2[0] - A[0]) * d2[1] - (A2[1] - A[1]) * d2[0]) / cr;
  const X: Vec2 = [A[0] + d1[0] * t, A[1] + d1[1] * t];
  const rad = (angDeg * Math.PI) / 180;
  const p: Vec2 = [Math.cos(rad), Math.sin(rad)];
  // p = α·d1 + β·d2 → znaménka α, β určují ramena sektoru
  const al = (p[0] * d2[1] - p[1] * d2[0]) / cr;
  const be = (d1[0] * p[1] - d1[1] * p[0]) / cr;
  const r1: Vec2 = al >= 0 ? d1 : [-d1[0], -d1[1]];
  const r2: Vec2 = be >= 0 ? d2 : [-d2[0], -d2[1]];
  const t1 = Math.atan2(r1[1], r1[0]);
  const sweep = angDiff(t1, Math.atan2(r2[1], r2[0]));
  return { X, r1, r2, t1, sweep, angle: (Math.abs(sweep) * 180) / Math.PI };
}

const round2 = (n: number) => Math.round(n * 100) / 100;

/**
 * Kóta podle vybrané geometrie a místa `at` (mm listu), kam ji uživatel položil:
 * kružnice / oblouk → průměr nebo poloměr · hrana → její délka · dvě hrany → úhel (rovnoběžné → vzdálenost) · dva body → délková kóta.
 * Null = výběr není úplný nebo ho nelze okótovat.
 */
export function dimFromPicks(d: Pick<DrawingResult, "views">, sel: DimSel[], at: Vec2, m: DimModes): NewDim | null {
  const [s1, s2] = sel;
  if (!s1) return null;
  const view = s1.view;
  const S = (q: Vec2) => annToSheet(d.views, view, q);
  const local = (q: Vec2): Vec2 => {
    const v = d.views.find((x) => x.key === view);
    return view === "sheet" || !v ? q : sheetToAnn(v, q);
  };
  const linear = (a: Vec2, b: Vec2, edge: boolean): NewDim => {
    const A = S(a);
    const B = S(b);
    const dx = B[0] - A[0];
    const dy = B[1] - A[1];
    const l = Math.hypot(dx, dy);
    let kind: "aligned" | "horizontal" | "vertical";
    if (m.linear !== "auto") kind = m.linear;
    else if (edge) kind = Math.abs(dy) <= 1e-6 * l ? "horizontal" : Math.abs(dx) <= 1e-6 * l ? "vertical" : "aligned"; // délka hrany = skutečná délka
    else kind = Math.abs(dx) > 3 * Math.abs(dy) ? "horizontal" : Math.abs(dy) > 3 * Math.abs(dx) ? "vertical" : "aligned";
    if (l < 1e-6) kind = "horizontal";
    const offset = kind === "horizontal" ? at[1] - A[1] : kind === "vertical" ? at[0] - A[0] : -(dy / (l || 1)) * (at[0] - A[0]) + (dx / (l || 1)) * (at[1] - A[1]);
    return { view, type: "dim", a, b, kind, offset, ...(edge ? { edge: true } : {}) };
  };
  const p1 = s1.pick;
  if (p1.kind === "point") {
    if (!s2 || s2.pick.kind !== "point") return null;
    return linear(p1.p, s2.view === view ? s2.pick.p : local(annToSheet(d.views, s2.view, s2.pick.p)), false);
  }
  if (p1.kind === "circle") {
    const v = d.views.find((x) => x.key === view);
    if (!v) return null;
    const C = S(p1.c);
    let ux = at[0] - C[0];
    let uy = at[1] - C[1];
    const dd = Math.hypot(ux, uy);
    if (dd < 1e-6) {
      ux = 1;
      uy = -1;
    }
    const base = m.circle === "auto" ? (p1.full ? "diameter" : "radius") : m.circle;
    const kind = m.invert ? (base === "diameter" ? "radius" : "diameter") : base;
    return { view, type: "dim", kind, c: p1.c, r: p1.r, ang: round2((Math.atan2(uy, ux) * 180) / Math.PI), offset: round2(dd - p1.r * v.s) };
  }
  if (!s2 || s2.pick.kind !== "line" || s2.view !== view) return linear(p1.a, p1.b, true);
  const p2 = s2.pick;
  const A = S(p1.a);
  const B = S(p1.b);
  const A2 = S(p2.a);
  const B2 = S(p2.b);
  const g = angleGeom(A, B, A2, B2, 0);
  if (!g) {
    // rovnoběžné hrany → vzdálenost: bod první hrany nejblíž místu kóty a jeho pata na druhé hraně
    const l1 = dist2(A, B);
    const u: Vec2 = [(B[0] - A[0]) / l1, (B[1] - A[1]) / l1];
    const t = Math.max(0, Math.min(l1, (at[0] - A[0]) * u[0] + (at[1] - A[1]) * u[1]));
    const P: Vec2 = [A[0] + u[0] * t, A[1] + u[1] * t];
    const k = (P[0] - A2[0]) * u[0] + (P[1] - A2[1]) * u[1];
    const Q: Vec2 = [A2[0] + u[0] * k, A2[1] + u[1] * k];
    if (dist2(P, Q) < 1e-6) return null; // hrany na téže přímce
    return linear(local(P), local(Q), false);
  }
  const dd = dist2(g.X, at);
  const ang = dd < 1e-6 ? Math.atan2(g.r1[1] + g.r2[1], g.r1[0] + g.r2[0]) : Math.atan2(at[1] - g.X[1], at[0] - g.X[0]);
  return { view, type: "dim", kind: "angle", a: p1.a, b: p1.b, a2: p2.a, b2: p2.b, ang: round2((ang * 180) / Math.PI), offset: round2(Math.max(3, dd)) };
}

/** tolerance shody uložené kóty s geometrií pohledu [mm modelu] */
const REF_TOL = 0.01;

/** Hrana pohledu odpovídající uložené úsečce a–b: shodné konce, jinak jediná kolineární hrana, která se s ní překrývá (hrana se prodloužila / zkrátila). */
function resolveLine(ents: ViewEnt[], a: Vec2, b: Vec2): [Vec2, Vec2] | null {
  const L = dist2(a, b);
  if (L < 1e-9) return null;
  const ux = (b[0] - a[0]) / L;
  const uy = (b[1] - a[1]) / L;
  const cands: [Vec2, Vec2][] = [];
  for (const e of ents) {
    if (e.t !== "line") continue;
    if ((dist2(e.a, a) <= REF_TOL && dist2(e.b, b) <= REF_TOL) || (dist2(e.a, b) <= REF_TOL && dist2(e.b, a) <= REF_TOL)) return [a, b];
    const off = (p: Vec2) => Math.abs(ux * (p[1] - a[1]) - uy * (p[0] - a[0]));
    if (off(e.a) > REF_TOL || off(e.b) > REF_TOL) continue;
    const t0 = ux * (e.a[0] - a[0]) + uy * (e.a[1] - a[1]);
    const t1 = ux * (e.b[0] - a[0]) + uy * (e.b[1] - a[1]);
    if (Math.min(Math.max(t0, t1), L) - Math.max(Math.min(t0, t1), 0) <= REF_TOL) continue; // bez překryvu
    const c: [Vec2, Vec2] = t0 <= t1 ? [e.a, e.b] : [e.b, e.a]; // zachovat smysl a → b
    if (!cands.some((x) => dist2(x[0], c[0]) <= REF_TOL && dist2(x[1], c[1]) <= REF_TOL)) cands.push(c);
  }
  return cands.length === 1 ? cands[0] : null;
}

/** Poloměr kružnice pohledu se středem `c`: uložený, jinak jediný jiný poloměr v tomtéž středu (díra změnila průměr). */
function resolveCircle(ents: ViewEnt[], c: Vec2, r: number): number | null {
  const radii: number[] = [];
  for (const e of ents) {
    if (e.t !== "arc" || dist2(e.c, c) > REF_TOL) continue;
    if (Math.abs(e.r - r) <= REF_TOL) return r;
    if (!radii.some((x) => Math.abs(x - e.r) <= REF_TOL)) radii.push(e.r);
  }
  return radii.length === 1 ? radii[0] : null;
}

/**
 * Dohledá geometrii, na kterou se kóta váže, v aktuálním pohledu. Kóty kružnic, hran a úhlů se drží své geometrie:
 * změní-li se jednoznačně (jiný průměr v tomtéž středu, delší / kratší hrana na téže přímce), kóta ji následuje;
 * když geometrie zmizí nebo ji nelze určit jednoznačně, vrátí stav „lost“ (kóta se kreslí podle uložených údajů a v seznamu je označená).
 * Kóta dvou bodů se váže jen na souřadnice pohledu (jako dosud). Chybí-li pohled na listu, stav je „noView“.
 */
export function resolveDim(views: PlacedView[], a: DimAnn): { a: DimAnn; status: DimStatus } {
  if (a.view === "sheet") return { a, status: "ok" };
  const v = views.find((x) => x.key === a.view);
  if (!v) return { a, status: "noView" };
  if (!v.ents) return { a, status: "ok" };
  if (isRadialDim(a)) {
    const r = resolveCircle(v.ents, a.c, a.r);
    return r == null ? { a, status: "lost" } : { a: r === a.r ? a : { ...a, r }, status: "ok" };
  }
  if (a.kind === "angle") {
    const l1 = resolveLine(v.ents, a.a, a.b);
    const l2 = resolveLine(v.ents, a.a2, a.b2);
    return l1 && l2 ? { a: { ...a, a: l1[0], b: l1[1], a2: l2[0], b2: l2[1] }, status: "ok" } : { a, status: "lost" };
  }
  if (a.edge) {
    const l = resolveLine(v.ents, a.a, a.b);
    return l ? { a: { ...a, a: l[0], b: l[1] }, status: "ok" } : { a, status: "lost" };
  }
  return { a, status: "ok" };
}

/** Stav poznámek a kót vůči aktuálnímu výkresu (klíč = id): chybějící pohled, ztracená geometrie kóty. */
export function annotationStatus(d: Pick<DrawingResult, "views">, annotations: DrawingAnnotation[]): Record<string, DimStatus> {
  const out: Record<string, DimStatus> = {};
  for (const a of annotations) out[a.id] = a.type === "dim" ? resolveDim(d.views, a).status : a.view === "sheet" || d.views.some((v) => v.key === a.view) ? "ok" : "noView";
  return out;
}

/** Popisek kóty (hodnota s předponou Ø / R, úhel se °, přípona) – `value` v mm modelu nebo stupních. */
export function dimLabel(a: Pick<DimAnn, "kind" | "prefix" | "suffix" | "text">, value: number): string {
  if (a.text != null) return a.text;
  const sym = a.kind === "diameter" ? "Ø" : a.kind === "radius" ? "R" : "";
  return `${a.prefix ?? ""}${sym}${fmtVal(value)}${a.kind === "angle" ? "°" : ""}${a.suffix ?? ""}`;
}

/** Kóta průměru / poloměru: odkazová čára ve směru `ang` se šipkou na kružnici a vodorovnou policí s textem (uvnitř kružnice kótovací čára přes průměr / ze středu). */
function radialDim(polys: Poly[], texts: DText[], views: PlacedView[], a: RadialDim) {
  const v = views.find((x) => x.key === a.view);
  if (!v) return;
  const C = annToSheet(views, a.view, a.c);
  const R = a.r * v.s;
  const rad = (a.ang * Math.PI) / 180;
  const u: Vec2 = [Math.cos(rad), Math.sin(rad)];
  const E: Vec2 = [C[0] + u[0] * R, C[1] + u[1] * R];
  const K: Vec2 = [C[0] + u[0] * (R + a.offset), C[1] + u[1] * (R + a.offset)];
  const label = dimLabel(a, a.kind === "diameter" ? 2 * a.r : a.r);
  const tw = label.length * 2.05 + 2;
  const right = u[0] >= 0;
  const shelf: Vec2 = [K[0] + (right ? tw : -tw), K[1]];
  if (a.offset >= 0) {
    polys.push({ layer: "dim", pts: [E, K, shelf] });
    arrowAt(polys, E, [-u[0], -u[1]]);
  } else {
    // text uvnitř: průměr = čára přes celou kružnici se dvěma šipkami, poloměr = čára ze středu
    const E2: Vec2 = [C[0] - u[0] * R, C[1] - u[1] * R];
    polys.push({ layer: "dim", pts: [a.kind === "diameter" ? E2 : C, E] }, { layer: "dim", pts: [K, shelf] });
    arrowAt(polys, E, u);
    if (a.kind === "diameter") arrowAt(polys, E2, [-u[0], -u[1]]);
  }
  texts.push({ x: K[0] + (right ? 1 : -1), y: K[1] - 1, s: label, size: 3.5, anchor: right ? "start" : "end", layer: "dim" });
}

/** Úhlová kóta: oblouk se středem v průsečíku hran, šipky tečně k oblouku, vynášecí čáry tam, kde oblouk leží mimo hranu. */
function angularDim(polys: Poly[], texts: DText[], views: PlacedView[], a: Extract<DimAnn, { kind: "angle" }>) {
  const S = (q: Vec2) => annToSheet(views, a.view, q);
  const lines: [Vec2, Vec2][] = [
    [S(a.a), S(a.b)],
    [S(a.a2), S(a.b2)],
  ];
  const g = angleGeom(lines[0][0], lines[0][1], lines[1][0], lines[1][1], a.ang);
  if (!g) return;
  const R = Math.max(1, a.offset);
  const X = g.X;
  const n = Math.max(2, Math.ceil(g.angle / 5));
  const pts: Vec2[] = [];
  for (let k = 0; k <= n; k++) {
    const t = g.t1 + (g.sweep * k) / n;
    pts.push([X[0] + R * Math.cos(t), X[1] + R * Math.sin(t)]);
  }
  polys.push({ layer: "dim", pts });
  [g.r1, g.r2].forEach((r, i) => {
    const ts = lines[i].map((p) => (p[0] - X[0]) * r[0] + (p[1] - X[1]) * r[1]);
    const lo = Math.min(ts[0], ts[1]);
    const hi = Math.max(ts[0], ts[1]);
    const seg = (t0: number, t1: number) => {
      if (t1 - t0 > 0.1) polys.push({ layer: "dim", pts: [[X[0] + r[0] * t0, X[1] + r[1] * t0], [X[0] + r[0] * t1, X[1] + r[1] * t1]] });
    };
    if (R > hi + 1e-6) seg(hi + 1, R + 1.5);
    else if (R < lo - 1e-6) seg(R - 1.5, lo - 1);
  });
  const sg = Math.sign(g.sweep) || 1;
  const tan = (t: number): Vec2 => [-Math.sin(t) * sg, Math.cos(t) * sg]; // tečna ve smyslu oblouku
  const inside = R * Math.abs(g.sweep) > 8;
  const t2 = g.t1 + g.sweep;
  const d1 = tan(g.t1);
  const d2 = tan(t2);
  arrowAt(polys, pts[0], inside ? [-d1[0], -d1[1]] : d1);
  arrowAt(polys, pts[n], inside ? d2 : [-d2[0], -d2[1]]);
  const mid = g.t1 + g.sweep / 2;
  const mx = Math.cos(mid);
  const my = Math.sin(mid);
  texts.push({ x: X[0] + mx * (R + 2), y: X[1] + my * (R + 2.6) + 1.2, s: dimLabel(a, g.angle), size: 3.5, anchor: mx > 0.5 ? "start" : mx < -0.5 ? "end" : "middle", layer: "dim" });
}

/** Geometrie (čáry + texty v mm listu) pro uživatelské poznámky a kóty. */
export function annotationGeometry(d: Pick<DrawingResult, "views" | "scaleValue">, annotations: DrawingAnnotation[]): { polys: Poly[]; texts: DText[] } {
  const polys: Poly[] = [];
  const texts: DText[] = [];
  const S = (view: string, q: Vec2) => annToSheet(d.views, view, q);
  const modelLen = (view: string, a: Vec2, b: Vec2) => {
    const dx = b[0] - a[0];
    const dy = b[1] - a[1];
    const len = Math.hypot(dx, dy);
    return view === "sheet" ? len / d.scaleValue : len; // souřadnice pohledu jsou v mm modelu
  };
  for (const a of annotations) {
    switch (a.type) {
      case "dim": {
        // kóta hrany / kružnice / úhlu se dohledá v geometrii aktuálního pohledu; kóta pohledu, který na listu není, se nekreslí
        const rs = resolveDim(d.views, a);
        if (rs.status === "noView") break;
        const dm = rs.a;
        if (isRadialDim(dm)) {
          radialDim(polys, texts, d.views, dm);
          break;
        }
        if (dm.kind === "angle") {
          angularDim(polys, texts, d.views, dm);
          break;
        }
        const A = S(dm.view, dm.a);
        const B = S(dm.view, dm.b);
        let A2: Vec2;
        let B2: Vec2;
        let value: number;
        let u: Vec2;
        if (dm.kind === "horizontal") {
          const y = A[1] + dm.offset;
          A2 = [A[0], y];
          B2 = [B[0], y];
          value = Math.abs(modelLen(dm.view, [dm.a[0], 0], [dm.b[0], 0]));
          u = [Math.sign(B[0] - A[0]) || 1, 0];
        } else if (dm.kind === "vertical") {
          const x = A[0] + dm.offset;
          A2 = [x, A[1]];
          B2 = [x, B[1]];
          value = Math.abs(modelLen(dm.view, [0, dm.a[1]], [0, dm.b[1]]));
          u = [0, Math.sign(B[1] - A[1]) || 1];
        } else {
          const dx = B[0] - A[0];
          const dy = B[1] - A[1];
          const l = Math.hypot(dx, dy) || 1;
          u = [dx / l, dy / l];
          const n: Vec2 = [-u[1], u[0]];
          A2 = [A[0] + n[0] * dm.offset, A[1] + n[1] * dm.offset];
          B2 = [B[0] + n[0] * dm.offset, B[1] + n[1] * dm.offset];
          value = modelLen(dm.view, dm.a, dm.b);
        }
        // vynášecí čáry (s přesahem 1,5 mm) a kótovací čára
        const ext = (P: Vec2, P2: Vec2) => {
          const dx = P2[0] - P[0];
          const dy = P2[1] - P[1];
          const l = Math.hypot(dx, dy) || 1;
          polys.push({ layer: "dim", pts: [[P[0] + (dx / l) * 1, P[1] + (dy / l) * 1], [P2[0] + (dx / l) * 1.5, P2[1] + (dy / l) * 1.5]] });
        };
        ext(A, A2);
        ext(B, B2);
        polys.push({ layer: "dim", pts: [A2, B2] });
        const span = Math.hypot(B2[0] - A2[0], B2[1] - A2[1]);
        const inside = span > 8;
        arrowAt(polys, A2, inside ? [-u[0], -u[1]] : [u[0], u[1]]);
        arrowAt(polys, B2, inside ? [u[0], u[1]] : [-u[0], -u[1]]);
        const label = dimLabel(dm, value);
        let ang = (Math.atan2(u[1], u[0]) * 180) / Math.PI;
        // ISO 129-1: čitelné zdola nebo zprava – svislá kóta se píše zdola nahoru (vlevo od kótovací čáry)
        if (ang >= 90 - 1e-6) ang -= 180;
        else if (ang < -90 - 1e-6) ang += 180;
        const rad = (ang * Math.PI) / 180;
        const nx = Math.sin(rad);
        const ny = -Math.cos(rad); // kolmo „nad“ čáru (SVG y dolů)
        const mid: Vec2 = [(A2[0] + B2[0]) / 2 + nx * 1.2, (A2[1] + B2[1]) / 2 + ny * 1.2];
        texts.push({ x: mid[0], y: mid[1], s: label, size: 3.5, anchor: "middle", rotate: Math.abs(ang) < 0.01 ? undefined : ang, layer: "dim" });
        break;
      }
      case "note": {
        const at = S(a.view, a.at);
        const w = Math.max(6, a.text.length * 3.5 * 0.58 + 2);
        if (a.leader) {
          const tip = S(a.view, a.leader);
          polys.push({ layer: "dim", pts: [tip, at, [at[0] + w, at[1]]] });
          arrowAt(polys, tip, [tip[0] - at[0], tip[1] - at[1]]);
        }
        texts.push({ x: at[0] + 1, y: at[1] - 1, s: a.text, size: 3.5, layer: "text" });
        break;
      }
      case "roughness": {
        const t = S(a.view, a.at); // hrot značky leží na povrchu
        const short: Vec2 = [t[0] - 2.9, t[1] - 5];
        const long: Vec2 = [t[0] + 5.8, t[1] - 10];
        polys.push({ layer: "dim", pts: [short, t, long] });
        polys.push({ layer: "dim", pts: [long, [long[0] + 12, long[1]]] });
        texts.push({ x: long[0] + 1, y: long[1] + 4.2, s: a.ra, size: 3, layer: "text" });
        if (a.leader) {
          const tip = S(a.view, a.leader);
          polys.push({ layer: "dim", pts: [tip, t] });
          arrowAt(polys, tip, [tip[0] - t[0], tip[1] - t[1]]);
        }
        break;
      }
      case "gdt": {
        const at = S(a.view, a.at);
        const H = 7;
        const cells = [7, Math.max(9, a.value.length * 3.5 * 0.6 + 3), ...(a.datum ? [7] : [])];
        let x = at[0];
        const y = at[1];
        const rect = (w: number) => polys.push({ layer: "dim", pts: [[x, y], [x + w, y], [x + w, y + H], [x, y + H], [x, y]] });
        rect(cells[0]);
        gdtGlyph(polys, [x + cells[0] / 2, y + H / 2], a.symbol);
        x += cells[0];
        rect(cells[1]);
        texts.push({ x: x + cells[1] / 2, y: y + H / 2 + 1.25, s: a.value, size: 3.5, anchor: "middle", layer: "text" });
        x += cells[1];
        if (a.datum) {
          rect(cells[2]);
          texts.push({ x: x + cells[2] / 2, y: y + H / 2 + 1.25, s: a.datum, size: 3.5, anchor: "middle", bold: true, layer: "text" });
        }
        if (a.leader) {
          const tip = S(a.view, a.leader);
          polys.push({ layer: "dim", pts: [tip, [at[0], y + H / 2]] });
          arrowAt(polys, tip, [tip[0] - at[0], tip[1] - y - H / 2]);
        }
        break;
      }
      case "datum": {
        const at = S(a.view, a.at); // vrchol trojúhelníku na povrchu
        polys.push({ layer: "dim", fill: true, pts: [at, [at[0] - 1.8, at[1] - 3], [at[0] + 1.8, at[1] - 3], at] });
        polys.push({ layer: "dim", pts: [[at[0], at[1] - 3], [at[0], at[1] - 10]] });
        polys.push({ layer: "dim", pts: [[at[0] - 3, at[1] - 16], [at[0] + 3, at[1] - 16], [at[0] + 3, at[1] - 10], [at[0] - 3, at[1] - 10], [at[0] - 3, at[1] - 16]] });
        texts.push({ x: at[0], y: at[1] - 11.7, s: a.label, size: 3.5, anchor: "middle", bold: true, layer: "text" });
        break;
      }
      case "text": {
        const at = S(a.view, a.at);
        texts.push({ x: at[0], y: at[1], s: a.text, size: a.size || 3.5, layer: "text" });
        break;
      }
      case "callout":
        calloutGeometry(polys, texts, a, (q) => S(a.view, q));
        break;
      case "centerline":
        polys.push({ layer: "center", pts: [S(a.view, a.a), S(a.view, a.b)] });
        break;
    }
  }
  return { polys, texts };
}

/** Výkres + uživatelské poznámky → nový výsledek (polys/texts/svg/dxf přepočítané). */
export function withAnnotations(d: DrawingResult, annotations: DrawingAnnotation[]): DrawingResult {
  if (!annotations.length) return d;
  const g = symbolsAsGeometry(annotationGeometry(d, annotations)); // ↧ ⌴ ⌵ jako čáry (písmo Roboto ani DXF/DWG je nemají)
  const polys = [...d.polys, ...g.polys];
  const texts = [...d.texts, ...g.texts];
  return { ...d, polys, texts, svg: toSvg(d.sheet.w, d.sheet.h, polys, texts), dxf: toDxf(d.sheet.h, polys, texts) };
}
