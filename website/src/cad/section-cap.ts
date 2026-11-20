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
 */
import { tr } from "./i18n";

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

/** šrafy čela v pixelech obrazovky (CSS px): čáry pod úhlem `angle` (° od vodorovné, proti směru hodin), rozteč `step` */
export type CapHatch = {
  angle: number;
  step: number;
  width: number;
  /** normála čar šraf v obrazovce (y nahoru): pixel patří čáře, když (x·nx + y·ny) mod step < width */
  nx: number;
  ny: number;
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
};

/** barva kolidující komponenty – shodně s tělem ve 3D okně i v softwarovém náhledu */
export const CLASH_HEX = "#ff3b30";
/** výchozí barva komponenty bez barvy (cad-app) */
export const DEFAULT_COMP_HEX = "#b9c2cc";
const ANTRACIT: RGB = [39, 36, 37];
const SELECTION: RGB = [224, 57, 48];
const PAPER: RGB = [247, 248, 249];

/** vzory šraf: úhel čar (°) a rozteč (CSS px); každé dva se liší úhlem */
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

/**
 * Vzhled čela řezu komponenty; null = čelo se nekreslí (drátový model, skořepina bez objemu).
 * `pattern` = vzor z `assignCapPatterns` (bez něj podle id).
 */
export function capStyle(c: CapInput, display: CapDisplay | undefined, pattern?: number): CapStyle | null {
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
  const a = (pat.angle * Math.PI) / 180;
  const nx = Math.abs(Math.sin(a)) < 1e-12 ? 0 : -Math.sin(a);
  const ny = Math.abs(Math.cos(a)) < 1e-12 ? 0 : Math.cos(a);
  return {
    fill,
    hex: rgbHex(fill),
    hatch: { angle: pat.angle, step: pat.step, width: CAP_HATCH_WIDTH, nx, ny, color: line, hex: rgbHex(line) },
    opacity: bodyOpacity(c, display),
    pattern: k,
  };
}

/** čela všech komponent v pořadí seznamu (null = bez čela) – jedno rozhodnutí pro WebGL i softwarový náhled */
export function capStyles(list: readonly CapInput[], display: CapDisplay | undefined): (CapStyle | null)[] {
  const pats = assignCapPatterns(list.map((c) => c.id));
  return list.map((c) => capStyle(c, display, pats.get(c.id)));
}

/**
 * Softwarový náhled nemá průhlednost: tlumená komponenta je jen v hranách (bez výplně), čelo proto nemá; ostatní čela jsou
 * neprůhledná (styl Průhledný kreslí softwarový náhled plně).
 */
export function softCapStyles(list: readonly CapInput[], display: CapDisplay | undefined): (CapStyle | null)[] {
  return capStyles(list, display).map((s, i) => (s && !list[i].dim ? { ...s, opacity: 1 } : null));
}

/** bod obrazovky (x, y nahoru, CSS px) patří čáře šraf? – sdílené s testy; GPU počítá totéž v shaderu */
export function onHatch(h: Pick<CapHatch, "nx" | "ny" | "step" | "width">, x: number, y: number, scale = 1): boolean {
  const step = h.step * scale;
  if (!(step > 0)) return false;
  const v = x * h.nx + y * h.ny;
  return v - step * Math.floor(v / step) < h.width * scale;
}

/**
 * Věta o čelech pro odpověď textového příkazu `řez` v sestavě (stejné pravidlo jako `capStyle`); popisuje, co okno kreslí –
 * není to kontrola obrazu. Prázdná = bez komponent.
 */
export function capSummary(components: number, display: CapDisplay | undefined): string {
  if (components <= 0) return "";
  if (display === "wireframe") return tr("čela řezu se v drátovém zobrazení nekreslí");
  return tr("čela řezu: každá komponenta s objemem (barva komponenty, šrafy)");
}
