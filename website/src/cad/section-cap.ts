/**
 * Vlna 22 (zpráva 20. 11., „řez v sestavě – nevidím čela těles, jen povrchy“): vzhled čela řezu komponenty sestavy.
 *
 * Čistá funkce bez three.js – stejné rozhodnutí používá 3D okno (WebGL, `components/cad/section-cap-gl.ts`), softwarový
 * náhled (`soft-render.ts` přes `viewport-soft.tsx`), snímky a video pohybové studie (kreslí totéž plátno) i věta textového
 * příkazu `řez`. Čelo = plocha řezu v rovině řezu, kde rovina prochází tělesem:
 *  - barva odvozená z barvy komponenty (kolize = červená jako tělo), tmavší než povrch, s šrafami jako technický řez –
 *    sousední komponenty dostanou různý vzor šraf (úhel × rozteč) a mírně jiný odstín výplně, aby šly rozlišit i se stejnou barvou;
 *  - zobrazení „skryté hrany“ = bílá výplň a antracitové šrafy (výkresový vzhled);
 *  - průhlednost čela = průhlednost těla (tlumená komponenta 0,18, styl Průhledný 0,3, vlastní opacity);
 *  - bez čela: drátový model, skořepina bez objemu (`solid === false` – rub plochy není vnitřek tělesa), skrytá komponenta
 *    (do seznamu se vůbec nedostane).
 *
 * Kolo 7: šrafy jsou vázané na MODEL (rozteč v mm, směr v rovině řezu v souřadnicích komponenty – při otáčení, přiblížení
 * i přehrávání studie se šrafy hýbou s komponentou, dřív „plavaly“ v pixelech obrazovky); tloušťka čáry zůstává v pixelech
 * (čitelná v každém přiblížení). Čelo má obrys (`outline`, průsečnice roviny se sítí – `section-contour.ts`).
 */
import { tr } from "./i18n";
import type { Vec3 } from "./types";

export type RGB = [number, number, number];
/** styl zobrazení 3D okna (shodně s `DisplayMode` ve viewport.tsx – zde bez závislosti na komponentách) */
export type CapDisplay = "shadedEdges" | "shaded" | "wireframe" | "hiddenLine" | "xray";

/** komponenta sestavy, jak ji dostává 3D okno (podmnožina `AsmView`) */
export type CapInput = {
  id: string;
  color: string;
  clash?: boolean;
  dim?: boolean;
  opacity?: number;
  selected?: boolean;
  /** false = síť nemá objem (jen plochy / skořepina) – čelo by se kreslilo na rubu plochy */
  solid?: boolean;
};

/**
 * Šrafy čela vázané na model: čáry pod úhlem `angle` (° v rovině řezu, viz `hatchAxis`) s roztečí `stepMm` (mm v souřadnicích
 * komponenty); `step` = rozteč vzoru v jednotkách modulu (`capHatchModule`), `width` = tloušťka čáry v CSS px.
 */
export type CapHatch = {
  angle: number;
  step: number;
  /** rozteč čar v mm (step × modul šraf scény) */
  stepMm: number;
  width: number;
  color: RGB;
  hex: string;
};

export type CapStyle = {
  fill: RGB;
  /** výplň jako #rrggbb */
  hex: string;
  hatch: CapHatch;
  /** 1 = neprůhledné; < 1 = průhledné čelo (nezapisuje hloubku, nezakrývá výběr) */
  opacity: number;
  /** vzor šraf 0–7 (rozlišení sousedních komponent) */
  pattern: number;
  /** obrys čela (průsečnice roviny řezu s tělesem) */
  outline: RGB;
  outlineHex: string;
};

/** barva kolidující komponenty – shodně s tělem ve 3D okně i v softwarovém náhledu */
export const CLASH_HEX = "#ff3b30";
/** výchozí barva komponenty bez barvy (cad-app) */
export const DEFAULT_COMP_HEX = "#b9c2cc";
const ANTRACIT: RGB = [39, 36, 37];
const SELECTION: RGB = [224, 57, 48];
const PAPER: RGB = [247, 248, 249];
/** obrys čela řezu (kolo 7) */
const OUTLINE: RGB = [17, 17, 17];

/** vzory šraf: úhel čar (°) a rozteč (jednotky modulu šraf, při přizpůsobení pohledu ≈ CSS px); každé dva se liší úhlem */
export const CAP_PATTERNS: readonly { angle: number; step: number }[] = [
  { angle: 45, step: 8 },
  { angle: 135, step: 8 },
  { angle: 60, step: 11 },
  { angle: 120, step: 11 },
  { angle: 30, step: 8 },
  { angle: 150, step: 11 },
  { angle: 75, step: 8 },
  { angle: 105, step: 11 },
];
/** tloušťka čáry šraf (CSS px) */
export const CAP_HATCH_WIDTH = 1;

const clamp255 = (v: number) => Math.max(0, Math.min(255, Math.round(v)));
const mix = (a: RGB, b: RGB, t: number): RGB => [clamp255(a[0] + (b[0] - a[0]) * t), clamp255(a[1] + (b[1] - a[1]) * t), clamp255(a[2] + (b[2] - a[2]) * t)];
export const rgbHex = (c: RGB) => "#" + c.map((v) => clamp255(v).toString(16).padStart(2, "0")).join("");
/** #rgb / #rrggbb → RGB; neplatný zápis = výchozí barva komponenty */
export function parseHex(hex: string | null | undefined): RGB {
  let h = (hex ?? "").trim().replace(/^#/, "");
  if (/^[0-9a-f]{3}$/i.test(h)) h = h.replace(/./g, (c) => c + c);
  if (!/^[0-9a-f]{6}$/i.test(h)) return parseHex(DEFAULT_COMP_HEX);
  return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
}

/** FNV-1a – stabilní číslo z id komponenty (vzor se nemění s pořadím ani se skrytím jiných komponent) */
function hash(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}

/**
 * Vzor šraf pro každou komponentu: přednostně podle id (stabilní), při shodě další volný vzor – do osmi komponent má každá
 * jiný vzor, u větších sestav se vzory opakují (rozlišení pak dává i odstín výplně a barva komponenty).
 */
export function assignCapPatterns(ids: readonly string[]): Map<string, number> {
  const out = new Map<string, number>();
  const used = new Set<number>();
  const n = CAP_PATTERNS.length;
  for (const id of ids) {
    if (out.has(id)) continue;
    const pref = hash(id) % n;
    let k = pref;
    if (used.size < n) {
      for (let i = 0; i < n; i++) {
        const c = (pref + i) % n;
        if (!used.has(c)) {
          k = c;
          break;
        }
      }
    }
    used.add(k);
    out.set(id, k);
  }
  return out;
}

/** průhlednost těla komponenty ve 3D okně (čelo má stejnou) */
export function bodyOpacity(c: Pick<CapInput, "dim" | "opacity">, display: CapDisplay | undefined): number {
  return c.dim ? 0.18 : display === "xray" ? 0.3 : (c.opacity ?? 1);
}

/** výchozí modul šraf (mm na jednotku rozteče vzoru), když rozměr scény není znám */
export const CAP_MODULE_DEFAULT = 0.5;
const NICE = [1, 2, 5];
/**
 * Modul šraf (mm na jednotku rozteče vzoru) z rozměru scény `extent` (mm, největší rozměr obálky): po přizpůsobení pohledu má
 * vzor rozteč 8 zhruba 8 px jako dřív (plátno ≈ 700 px na celou scénu); zaokrouhleno na řadu 1–2–5 (rozteč v „hezkých“ mm).
 */
export function capHatchModule(extent: number): number {
  if (!(extent > 0) || !Number.isFinite(extent)) return CAP_MODULE_DEFAULT;
  const raw = extent / 700;
  const e = Math.floor(Math.log10(raw));
  const base = raw / 10 ** e;
  const k = NICE.find((n) => n >= base - 1e-9) ?? 10;
  return Math.round(k * 10 ** e * 1e9) / 1e9;
}

/** komponenta pro modul šraf: síť (vrcholy v místních souřadnicích) a matice umístění */
export type CapModuleInput = { id: string; key?: string; mesh: { vertices: ArrayLike<number> }; matrix?: ArrayLike<number> | null };
const LOCAL_BOX = new WeakMap<object, [number, number, number, number, number, number]>();
const MODULE_OF = new Map<string, number>();
/** obálka sítě v místních souřadnicích (počítá se jednou na síť) */
function localBox(v: ArrayLike<number>): [number, number, number, number, number, number] {
  const hit = LOCAL_BOX.get(v as object);
  if (hit) return hit;
  let x0 = Infinity, y0 = Infinity, z0 = Infinity, x1 = -Infinity, y1 = -Infinity, z1 = -Infinity;
  for (let j = 0; j + 2 < v.length; j += 3) {
    const x = v[j], y = v[j + 1], z = v[j + 2];
    if (x < x0) x0 = x;
    if (x > x1) x1 = x;
    if (y < y0) y0 = y;
    if (y > y1) y1 = y;
    if (z < z0) z0 = z;
    if (z > z1) z1 = z;
  }
  const b: [number, number, number, number, number, number] = [x0, y0, z0, x1, y1, z1];
  LOCAL_BOX.set(v as object, b);
  return b;
}
/**
 * Modul šraf sestavy: z obálky komponent (rohy místních obálek přes matice). Pro tutéž sestavu (stejné komponenty a sítě) se
 * modul zapamatuje při prvním výpočtu – při přehrávání studie, tažení gizmem ani rozložení se rozteč šraf nemění skokem.
 * 3D okno i softwarový náhled volají totéž, takže mají stejnou rozteč.
 */
export function capModule(list: readonly CapModuleInput[]): number {
  if (!list.length) return CAP_MODULE_DEFAULT;
  const id = list.map((c) => `${c.id}:${c.key ?? ""}:${c.mesh.vertices.length}`).join("|");
  const hit = MODULE_OF.get(id);
  if (hit !== undefined) return hit;
  let x0 = Infinity, y0 = Infinity, z0 = Infinity, x1 = -Infinity, y1 = -Infinity, z1 = -Infinity;
  for (const c of list) {
    const b = localBox(c.mesh.vertices);
    if (!(b[3] >= b[0])) continue;
    const m = c.matrix && c.matrix.length >= 16 ? c.matrix : null;
    for (let k = 0; k < 8; k++) {
      const x = k & 1 ? b[3] : b[0], y = k & 2 ? b[4] : b[1], z = k & 4 ? b[5] : b[2];
      const wx = m ? m[0] * x + m[4] * y + m[8] * z + m[12] : x;
      const wy = m ? m[1] * x + m[5] * y + m[9] * z + m[13] : y;
      const wz = m ? m[2] * x + m[6] * y + m[10] * z + m[14] : z;
      if (wx < x0) x0 = wx;
      if (wx > x1) x1 = wx;
      if (wy < y0) y0 = wy;
      if (wy > y1) y1 = wy;
      if (wz < z0) z0 = wz;
      if (wz > z1) z1 = wz;
    }
  }
  const mod = x1 >= x0 ? capHatchModule(Math.max(x1 - x0, y1 - y0, z1 - z0)) : CAP_MODULE_DEFAULT;
  if (MODULE_OF.size > 64) MODULE_OF.clear();
  MODULE_OF.set(id, mod);
  return mod;
}

/**
 * Směr šraf v rovině řezu: vektor `h` (místní souřadnice komponenty, |h| = 1 / rozteč) – bod p čela leží na čáře šraf, když
 * zlomková část h·p je menší než tloušťka čáry přepočtená na stejné jednotky. Báze roviny je stabilní (jen z normály):
 * e2 = průmět osy Z do roviny (u vodorovné roviny osa Y), e1 = n × e2; čáry svírají s e1 úhel `angle`.
 */
export function hatchAxis(normal: Vec3, angleDeg: number, stepMm: number): Vec3 {
  const l = Math.hypot(normal[0], normal[1], normal[2]);
  if (!(l > 0) || !(stepMm > 0)) return [0, 0, 0];
  const n: Vec3 = [normal[0] / l, normal[1] / l, normal[2] / l];
  const ref: Vec3 = Math.abs(n[2]) < 0.9 ? [0, 0, 1] : [0, 1, 0];
  const dr = ref[0] * n[0] + ref[1] * n[1] + ref[2] * n[2];
  let e2: Vec3 = [ref[0] - dr * n[0], ref[1] - dr * n[1], ref[2] - dr * n[2]];
  const l2 = Math.hypot(e2[0], e2[1], e2[2]);
  e2 = [e2[0] / l2, e2[1] / l2, e2[2] / l2];
  const e1: Vec3 = [n[1] * e2[2] - n[2] * e2[1], n[2] * e2[0] - n[0] * e2[2], n[0] * e2[1] - n[1] * e2[0]];
  const a = (angleDeg * Math.PI) / 180;
  const s = Math.sin(a), c = Math.cos(a);
  // normála čar v rovině: kolmá na směr čar (cos a·e1 + sin a·e2)
  return [(-s * e1[0] + c * e2[0]) / stepMm, (-s * e1[1] + c * e2[1]) / stepMm, (-s * e1[2] + c * e2[2]) / stepMm];
}

/**
 * Šrafy čela ve SVĚTOVÝCH souřadnicích pro komponentu s maticí `m` (4×4 po sloupcích) a rovinou řezu s normálou `normal`
 * (svět): hodnota šraf v bodě p (svět) = g·p + g0; čára, když zlomková část < tloušťka × |∇| (obojí renderery). Pro tutéž
 * komponentu a rovinu je výsledek v místních souřadnicích komponenty stejný, ať je komponenta kdekoli – šrafy jedou s ní.
 */
export function hatchWorld(m: ArrayLike<number> | null | undefined, normal: Vec3, angleDeg: number, stepMm: number): { g: Vec3; g0: number } {
  const M = m && m.length >= 16 ? m : [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
  // místní normála roviny = Aᵀ·n (rovina se transformuje transponovanou maticí)
  const nl: Vec3 = [M[0] * normal[0] + M[1] * normal[1] + M[2] * normal[2], M[4] * normal[0] + M[5] * normal[1] + M[6] * normal[2], M[8] * normal[0] + M[9] * normal[1] + M[10] * normal[2]];
  const h = hatchAxis(nl, angleDeg, stepMm);
  // v = h·A⁻¹(p − t) → g = A⁻ᵀ·h, g0 = −g·t
  const a00 = M[0], a01 = M[4], a02 = M[8], a10 = M[1], a11 = M[5], a12 = M[9], a20 = M[2], a21 = M[6], a22 = M[10];
  const c00 = a11 * a22 - a12 * a21, c01 = a12 * a20 - a10 * a22, c02 = a10 * a21 - a11 * a20;
  const det = a00 * c00 + a01 * c01 + a02 * c02;
  if (!(Math.abs(det) > 1e-18)) return { g: [0, 0, 0], g0: 0 };
  const c10 = a02 * a21 - a01 * a22, c11 = a00 * a22 - a02 * a20, c12 = a01 * a20 - a00 * a21;
  const c20 = a01 * a12 - a02 * a11, c21 = a02 * a10 - a00 * a12, c22 = a00 * a11 - a01 * a10;
  // A⁻¹ = adj(A)/det, adj = transponované kofaktory → A⁻ᵀ = kofaktory/det (řádek i = kofaktory C_i·)
  const g: Vec3 = [(c00 * h[0] + c01 * h[1] + c02 * h[2]) / det, (c10 * h[0] + c11 * h[1] + c12 * h[2]) / det, (c20 * h[0] + c21 * h[1] + c22 * h[2]) / det];
  return { g, g0: -(g[0] * M[12] + g[1] * M[13] + g[2] * M[14]) };
}

/** bod čela s hodnotou šraf `v` leží na čáře šraf? `fw` = změna v na pixel (|∇v|), `width` = tloušťka čáry v pixelech */
export function onModelHatch(v: number, fw: number, width: number): boolean {
  return v - Math.floor(v) < width * fw;
}

/**
 * Vzhled čela řezu komponenty; null = čelo se nekreslí (drátový model, skořepina bez objemu).
 * `pattern` = vzor z `assignCapPatterns` (bez něj podle id), `module` = modul šraf scény (`capModule`, mm na jednotku rozteče).
 */
export function capStyle(c: CapInput, display: CapDisplay | undefined, pattern?: number, module = CAP_MODULE_DEFAULT): CapStyle | null {
  if (display === "wireframe" || c.solid === false) return null;
  const k = ((pattern ?? hash(c.id) % CAP_PATTERNS.length) % CAP_PATTERNS.length + CAP_PATTERNS.length) % CAP_PATTERNS.length;
  const pat = CAP_PATTERNS[k];
  const base = parseHex(c.clash ? CLASH_HEX : c.color);
  let fill: RGB;
  let line: RGB;
  if (display === "hiddenLine") {
    fill = PAPER;
    line = ANTRACIT;
  } else {
    // tmavší než povrch (rozliší čelo od osvětlené plochy), odstín výplně se střídá podle vzoru
    fill = mix(base, ANTRACIT, [0.3, 0.4, 0.5][k % 3]);
    line = mix(base, ANTRACIT, 0.8);
  }
  if (c.selected) fill = mix(fill, SELECTION, 0.3);
  // obrys čela: neutrální téměř černá čára hranice řezu (odlišná od šraf, které nesou odstín komponenty); výkresový vzhled antracit
  const outline = display === "hiddenLine" ? ANTRACIT : OUTLINE;
  const mod = module > 0 && Number.isFinite(module) ? module : CAP_MODULE_DEFAULT;
  return {
    fill,
    hex: rgbHex(fill),
    hatch: { angle: pat.angle, step: pat.step, stepMm: Math.round(pat.step * mod * 1e9) / 1e9, width: CAP_HATCH_WIDTH, color: line, hex: rgbHex(line) },
    opacity: bodyOpacity(c, display),
    pattern: k,
    outline,
    outlineHex: rgbHex(outline),
  };
}

/**
 * Čela všech komponent v pořadí seznamu (null = bez čela) – jedno rozhodnutí pro WebGL i softwarový náhled; `module` = modul
 * šraf scény (`capModule`).
 */
export function capStyles(list: readonly CapInput[], display: CapDisplay | undefined, module = CAP_MODULE_DEFAULT): (CapStyle | null)[] {
  const pats = assignCapPatterns(list.map((c) => c.id));
  return list.map((c) => capStyle(c, display, pats.get(c.id), module));
}

/**
 * Čela pro softwarový náhled – kolo 7: náhled umí průhlednost (prolnutí barvy po neprůhledných plochách), takže čelo má
 * stejnou průhlednost jako ve 3D okně (tlumená 0,18, Průhledný 0,3, vlastní). Ponecháno jako samostatná funkce (jedno místo
 * pro případné rozdíly rendererů).
 */
export function softCapStyles(list: readonly CapInput[], display: CapDisplay | undefined, module = CAP_MODULE_DEFAULT): (CapStyle | null)[] {
  return capStyles(list, display, module);
}

/**
 * Věta o čelech pro odpověď textového příkazu `řez` v sestavě (stejné pravidlo jako `capStyle`); popisuje, co okno kreslí –
 * není to kontrola obrazu. Prázdná = bez komponent.
 */
export function capSummary(components: number, display: CapDisplay | undefined): string {
  if (components <= 0) return "";
  if (display === "wireframe") return tr("čela řezu se v drátovém zobrazení nekreslí");
  return tr("čela řezu: každá komponenta s objemem (barva komponenty, šrafy vázané na model, obrys)");
}
