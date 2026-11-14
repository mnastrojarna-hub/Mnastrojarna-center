/**
 * Softwarový renderer náhledu modelu – bez WebGL. Čistá funkce nad typovanými poli (běží i v testech bez prohlížeče):
 * pravoúhlé promítání, z-buffer v rozlišení plátna, Lambertovo stínování v barvě tělesa (Gouraud z normál vrcholů,
 * bez normál ploché), hrany nahoře s hloubkovým testem proti z-bufferu a volitelně řez rovinou (odvrácené stěny
 * viditelné řezem se kreslí barvou řezu – stejný princip jako „čepička“ řezu ve 3D okně).
 *
 * Souřadnice: Z nahoru (strojírenská konvence). Kamera je dána azimutem kolem Z a elevací nad rovinou XY.
 */
import type { Vec3 } from "./types";

export type RGB = [number, number, number];
export type SoftViewName = "iso" | "front" | "top" | "right" | "back" | "bottom" | "left";
/** Směr, ze kterého se kamera dívá: azimut kolem osy Z a elevace nad rovinou XY (radiány). */
export type SoftAngles = { az: number; el: number };
/** Báze pohledu: `right` a `up` leží v rovině obrazu, `dir` míří od modelu ke kameře. */
export type SoftBasis = { right: Vec3; up: Vec3; dir: Vec3 };
/** Kamera: báze + bod modelu uprostřed plátna + měřítko (pixelů na milimetr). */
export type SoftCamera = SoftBasis & { center: Vec3; scale: number };
/** Rovina řezu: zachová se poloprostor `normal·p + constant ≥ 0` (shodně s THREE.Plane). */
export type SoftClip = { normal: Vec3; constant: number };

/** Jedna síť k vykreslení (díl nebo komponenta sestavy). */
export type SoftItem = {
  /** x, y, z po trojicích */
  vertices: Float32Array;
  /** indexy vrcholů po trojicích (proti směru hodinových ručiček při pohledu zvenku) */
  triangles: Uint32Array;
  /** normály vrcholů (stejná délka jako `vertices`) – bez nich se stínuje plošně */
  normals?: Float32Array | null;
  /** úsečky hran: dva body (6 čísel) na úsečku */
  lines?: Float32Array | null;
  /** [start, count, faceIndex] po trojicích – jen pro barvy ploch */
  faceGroups?: Int32Array | null;
  /** barvy jednotlivých ploch (index plochy → barva) */
  faceColors?: Record<number, RGB> | null;
  /** matice umístění 4×4 po sloupcích (komponenta sestavy) */
  matrix?: ArrayLike<number> | null;
  /** jen hrany, bez výplně ploch (potlačená / zprůhledněná komponenta) */
  wire?: boolean;
  /** barva hran této sítě (výchozí `edgeColor` scény) */
  edgeColor?: RGB | null;
  color: RGB;
};

export type SoftOptions = {
  width: number;
  height: number;
  items: SoftItem[];
  camera: SoftCamera;
  /** vyplnit plochy (výchozí ano); bez výplně = drátový model */
  fill?: boolean;
  /** kreslit hrany (výchozí ano) */
  edges?: boolean;
  edgeColor?: RGB;
  /** tloušťka hran v pixelech plátna (1–3) */
  edgeWidth?: number;
  /** jednobarevná výplň bez stínování (zobrazení „skryté hrany“) */
  flatColor?: RGB | null;
  clip?: SoftClip | null;
  capColor?: RGB;
  /**
   * vynechat odvrácené stěny (výchozí ano bez řezu a bez jednobarevné výplně – shodně se 3D oknem; uzavřená tělesa
   * vypadají stejně a kreslí se zhruba dvakrát rychleji); `false` kreslí i rub ploch (otevřené plochy zezadu)
   */
  cullBackFaces?: boolean;
  /** neprůhledné pozadí; bez něj zůstane pozadí průhledné (alfa 0) */
  background?: RGB | null;
  /** výstupní pole RGBA (šířka × výška × 4) k opětovnému použití, např. `ImageData.data` */
  out?: Uint8ClampedArray | null;
  /** z-buffer (šířka × výška) k opětovnému použití */
  depth?: Float32Array | null;
};

export type SoftResult = {
  /** RGBA po řádcích shora; pozadí má alfa 0 (není-li zadáno `background`) */
  data: Uint8ClampedArray;
  width: number;
  height: number;
  /** hloubka pixelu (mm ke kameře od středu pohledu); -Infinity = pozadí */
  depth: Float32Array;
  /** doba vykreslení v ms */
  ms: number;
  /** počet trojúhelníků ve scéně */
  triangles: number;
};

const D2R = Math.PI / 180;
const ISO_DIR: Vec3 = [1, -1.15, 0.85]; // shodně s 3D oknem (viewport.tsx)

/** Úhly pojmenovaných pohledů (shodné se směry 3D okna: přední = pohled od −Y, horní = shora s +Y nahoru). */
export const VIEW_ANGLES: Record<SoftViewName, SoftAngles> = {
  iso: { az: Math.atan2(ISO_DIR[1], ISO_DIR[0]), el: Math.atan2(ISO_DIR[2], Math.hypot(ISO_DIR[0], ISO_DIR[1])) },
  front: { az: -90 * D2R, el: 0 },
  back: { az: 90 * D2R, el: 0 },
  right: { az: 0, el: 0 },
  left: { az: 180 * D2R, el: 0 },
  top: { az: -90 * D2R, el: 90 * D2R },
  bottom: { az: 90 * D2R, el: -90 * D2R },
};

const snap0 = (v: number) => (Math.abs(v) < 1e-12 ? 0 : v);

/** Báze pohledu z azimutu a elevace. */
export function basisOf(a: SoftAngles): SoftBasis {
  const ca = Math.cos(a.az);
  const sa = Math.sin(a.az);
  const ce = Math.cos(a.el);
  const se = Math.sin(a.el);
  return {
    right: [snap0(-sa), snap0(ca), 0],
    up: [snap0(-se * ca), snap0(-se * sa), snap0(ce)],
    dir: [snap0(ce * ca), snap0(ce * sa), snap0(se)],
  };
}

/** Otočení pohledu („gramofon“): azimut kolem Z, elevace omezená na ±90°. */
export function orbitAngles(a: SoftAngles, dAz: number, dEl: number): SoftAngles {
  const lim = Math.PI / 2;
  return { az: a.az + dAz, el: Math.max(-lim, Math.min(lim, a.el + dEl)) };
}

/** „#rrggbb“ / „#rgb“ → RGB (0–255); neplatný zápis → náhradní barva. */
export function hexToRgb(hex: string | null | undefined, fallback: RGB = [185, 194, 204]): RGB {
  const m = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i.exec((hex ?? "").trim());
  if (!m) return fallback;
  const h = m[1].length === 3 ? m[1].replace(/./g, (c) => c + c) : m[1];
  const n = parseInt(h, 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

/** Lineární část a posun matice umístění (po sloupcích); bez matice jednotková. */
export function affine(m: ArrayLike<number> | null | undefined): number[] {
  if (!m || m.length < 16) return [1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0];
  // [m00 m01 m02 | m10 m11 m12 | m20 m21 m22 | tx ty tz], mRC = řádek R, sloupec C
  return [m[0], m[4], m[8], m[1], m[5], m[9], m[2], m[6], m[10], m[12], m[13], m[14]];
}

/** Ohraničení scény ve světových souřadnicích (po umístění komponent); bez vrcholů null. */
export function softBounds(items: SoftItem[]): { min: Vec3; max: Vec3; center: Vec3; radius: number } | null {
  let x0 = Infinity, y0 = Infinity, z0 = Infinity, x1 = -Infinity, y1 = -Infinity, z1 = -Infinity;
  for (const it of items) {
    const V = it.vertices;
    const a = affine(it.matrix);
    for (let j = 0; j + 2 < V.length; j += 3) {
      const x = a[0] * V[j] + a[1] * V[j + 1] + a[2] * V[j + 2] + a[9];
      const y = a[3] * V[j] + a[4] * V[j + 1] + a[5] * V[j + 2] + a[10];
      const z = a[6] * V[j] + a[7] * V[j + 1] + a[8] * V[j + 2] + a[11];
      if (x < x0) x0 = x;
      if (x > x1) x1 = x;
      if (y < y0) y0 = y;
      if (y > y1) y1 = y;
      if (z < z0) z0 = z;
      if (z > z1) z1 = z;
    }
  }
  if (!(x1 >= x0)) return null;
  return { min: [x0, y0, z0], max: [x1, y1, z1], center: [(x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2], radius: Math.hypot(x1 - x0, y1 - y0, z1 - z0) / 2 || 1 };
}

/**
 * Kamera, která v daném směru pohledu vejde celou scénu do plátna (`fill` = podíl plátna, který model zabere).
 * Rozsah se bere ze skutečně promítnutých vrcholů, takže model vyplní plátno v každém pohledu.
 */
export function fitCamera(items: SoftItem[], basis: SoftBasis, width: number, height: number, fill = 0.86): SoftCamera {
  const { right: R, up: U, dir: D } = basis;
  let r0 = Infinity, r1 = -Infinity, u0 = Infinity, u1 = -Infinity, d0 = Infinity, d1 = -Infinity;
  for (const it of items) {
    const V = it.vertices;
    const a = affine(it.matrix);
    // řádky promítání složené s maticí komponenty
    const rx = R[0] * a[0] + R[1] * a[3] + R[2] * a[6], ry = R[0] * a[1] + R[1] * a[4] + R[2] * a[7], rz = R[0] * a[2] + R[1] * a[5] + R[2] * a[8], rt = R[0] * a[9] + R[1] * a[10] + R[2] * a[11];
    const ux = U[0] * a[0] + U[1] * a[3] + U[2] * a[6], uy = U[0] * a[1] + U[1] * a[4] + U[2] * a[7], uz = U[0] * a[2] + U[1] * a[5] + U[2] * a[8], ut = U[0] * a[9] + U[1] * a[10] + U[2] * a[11];
    const dx = D[0] * a[0] + D[1] * a[3] + D[2] * a[6], dy = D[0] * a[1] + D[1] * a[4] + D[2] * a[7], dz = D[0] * a[2] + D[1] * a[5] + D[2] * a[8], dt = D[0] * a[9] + D[1] * a[10] + D[2] * a[11];
    for (let j = 0; j + 2 < V.length; j += 3) {
      const x = V[j], y = V[j + 1], z = V[j + 2];
      const r = rx * x + ry * y + rz * z + rt;
      const u = ux * x + uy * y + uz * z + ut;
      const d = dx * x + dy * y + dz * z + dt;
      if (r < r0) r0 = r;
      if (r > r1) r1 = r;
      if (u < u0) u0 = u;
      if (u > u1) u1 = u;
      if (d < d0) d0 = d;
      if (d > d1) d1 = d;
    }
  }
  if (!(r1 >= r0)) return { ...basis, center: [0, 0, 0], scale: 1 };
  const rm = (r0 + r1) / 2, um = (u0 + u1) / 2, dm = (d0 + d1) / 2;
  const center: Vec3 = [R[0] * rm + U[0] * um + D[0] * dm, R[1] * rm + U[1] * um + D[1] * dm, R[2] * rm + U[2] * um + D[2] * dm];
  const need = Math.max((r1 - r0) / Math.max(1, width * fill), (u1 - u0) / Math.max(1, height * fill));
  return { ...basis, center, scale: need > 1e-12 ? 1 / need : 1 };
}

const LITTLE_ENDIAN = new Uint8Array(new Uint32Array([1]).buffer)[0] === 1;
const pack = (r: number, g: number, b: number): number => {
  const c = (v: number) => (v < 0 ? 0 : v > 255 ? 255 : Math.round(v));
  return (LITTLE_ENDIAN ? (255 << 24) | (c(b) << 16) | (c(g) << 8) | c(r) : (c(r) << 24) | (c(g) << 16) | (c(b) << 8) | 255) >>> 0;
};

// světla v souřadnicích pohledu (x doprava, y nahoru, z ke kameře): hlavní zprava shora, doplňkové zleva zdola
const L1: Vec3 = (() => {
  const l = Math.hypot(0.35, 0.55, 0.76);
  return [0.35 / l, 0.55 / l, 0.76 / l] as Vec3;
})();
const L2: Vec3 = (() => {
  const l = Math.hypot(-0.6, -0.3, 0.5);
  return [-0.6 / l, -0.3 / l, 0.5 / l] as Vec3;
})();
const AMBIENT = 0.36;
const DIFFUSE = 0.58;
const FILL = 0.14;

/** Jas plochy s jednotkovou normálou (v souřadnicích pohledu) → index 1–254 do tabulky odstínů. */
function shadeIndex(nx: number, ny: number, nz: number): number {
  const d1 = nx * L1[0] + ny * L1[1] + nz * L1[2];
  const d2 = nx * L2[0] + ny * L2[1] + nz * L2[2];
  const i = AMBIENT + DIFFUSE * (d1 > 0 ? d1 : 0) + FILL * (d2 > 0 ? d2 : 0);
  return 1 + 253 * (i > 1 ? 1 : i);
}

/** Tabulka 256 odstínů barvy (index = jas); odstíny se počítají jednou na barvu a snímek. */
function shadeLut(c: RGB): Uint32Array {
  const lut = new Uint32Array(256);
  for (let k = 0; k < 256; k++) {
    const f = (k / 254) * 1.06;
    lut[k] = pack(c[0] * f, c[1] * f, c[2] * f);
  }
  return lut;
}

// pracovní pole promítnutých vrcholů – drží se mezi snímky (jen roste), ať se při otáčení nealokuje
let scratchN = 0;
let SX = new Float32Array(0);
let SY = new Float32Array(0);
let SZ = new Float32Array(0);
let VI = new Float32Array(0);
let CD = new Float32Array(0);
function ensureScratch(n: number) {
  if (n <= scratchN) return;
  scratchN = Math.ceil(n * 1.25) + 16;
  SX = new Float32Array(scratchN);
  SY = new Float32Array(scratchN);
  SZ = new Float32Array(scratchN);
  VI = new Float32Array(scratchN);
  CD = new Float32Array(scratchN);
}

/** meze parametru úsečky při ořezu Liang–Barsky: [t0, t1] (pracovní pole, ať se na hranu nic nealokuje) */
const TT = new Float64Array(2);
/** jeden krok ořezu Liang–Barsky (podmínka pp·t ≤ q); false = úsečka je celá venku */
function lbClip(pp: number, q: number): boolean {
  if (pp === 0) return q >= 0;
  const r = q / pp;
  if (pp < 0) {
    if (r > TT[1]) return false;
    if (r > TT[0]) TT[0] = r;
  } else {
    if (r < TT[0]) return false;
    if (r < TT[1]) TT[1] = r;
  }
  return true;
}

let capN = 0;
let CAPM = new Uint8Array(0);
/** maska plochy řezu (vynulovaná) o délce alespoň n */
function capMask(n: number): Uint8Array {
  if (n > capN) {
    capN = n;
    CAPM = new Uint8Array(n);
  } else CAPM.fill(0, 0, n);
  return CAPM;
}

let nbN = 0;
let NB_MIN = new Float32Array(0);
let NB_TMP = new Float32Array(0);
let NB_BG = new Uint8Array(0);
let NB_BGT = new Uint8Array(0);
/**
 * Okolí razítka hrany pro každý pixel (x, y): okno ⟨x − 1, x + w⟩ × ⟨y − 1, y + w⟩ (w = tloušťka hrany).
 * `min` = nejmenší hloubka ploch v okně, tj. nejvzdálenější plocha od kamery (pozadí se nepočítá; samé pozadí = +∞),
 * `bg` = 1, pokud okno zasahuje do pozadí. Dva oddělené průchody (řádky, sloupce) – řádově milisekundy. Počítá se jen
 * pro pixely u vykreslené části ⟨x0, x1⟩ × ⟨y0, y1⟩: hrana nad pozadím je vidět bez dalšího testu.
 */
function neighbourhood(ZB: Float32Array, W: number, H: number, w: number, x0: number, y0: number, x1: number, y1: number): { min: Float32Array; bg: Uint8Array } {
  const n = W * H;
  if (n > nbN) {
    nbN = n;
    NB_MIN = new Float32Array(n);
    NB_TMP = new Float32Array(n);
    NB_BG = new Uint8Array(n);
    NB_BGT = new Uint8Array(n);
  }
  // počátek razítka (px0, py0) leží nejvýš o 1 px před pixelem pod hranou
  const xa = Math.max(0, x0 - 1), xb = Math.min(W - 1, x1);
  const ya = Math.max(0, y0 - 1), yb = Math.min(H - 1, y1);
  // řádky: okno ⟨x − 1, x + w⟩ (pro řádky, které čte druhý průchod)
  for (let y = Math.max(0, ya - 1), ye = Math.min(H - 1, yb + w); y <= ye; y++) {
    const row = y * W;
    for (let x = xa; x <= xb; x++) {
      const u0 = x > 0 ? x - 1 : 0;
      const u1 = x + w < W ? x + w : W - 1;
      let m = Infinity;
      let bg = 0;
      for (let u = u0; u <= u1; u++) {
        const d = ZB[row + u];
        if (d === -Infinity) bg = 1;
        else if (d < m) m = d;
      }
      NB_TMP[row + x] = m;
      NB_BGT[row + x] = bg;
    }
  }
  // sloupce: okno ⟨y − 1, y + w⟩
  for (let y = ya; y <= yb; y++) {
    const v0 = y > 0 ? y - 1 : 0;
    const v1 = y + w < H ? y + w : H - 1;
    const row = y * W;
    for (let x = xa; x <= xb; x++) {
      let m = Infinity;
      let bg = 0;
      for (let v = v0, idx = v0 * W + x; v <= v1; v++, idx += W) {
        const d = NB_TMP[idx];
        if (d < m) m = d;
        bg |= NB_BGT[idx];
      }
      NB_MIN[row + x] = m;
      NB_BG[row + x] = bg;
    }
  }
  return { min: NB_MIN, bg: NB_BG };
}

const nowMs = () => (typeof performance !== "undefined" ? performance.now() : Date.now());

/**
 * Vykreslí scénu do pole RGBA. Trojúhelníky se rastrují po řádcích (scanline) s hloubkovým testem; průsečíky hran
 * s řádkem se počítají vždy od horního vrcholu hrany, takže sousední trojúhelníky na společné hraně dávají
 * bitově stejné meze a mezi nimi nevznikají díry. Hrany se kreslí po plochách: bod hrany je vidět, pokud není
 * za všemi plochami ve svém těsném okolí (hrana na ploše projde, hrana za plochou zůstane skrytá).
 */
export function softRender(o: SoftOptions): SoftResult {
  const t0 = nowMs();
  const W = Math.max(1, Math.floor(o.width));
  const H = Math.max(1, Math.floor(o.height));
  const n = W * H;
  const data = o.out && o.out.length === n * 4 && o.out.byteOffset % 4 === 0 ? o.out : new Uint8ClampedArray(n * 4);
  const PX = new Uint32Array(data.buffer, data.byteOffset, n);
  const ZB = o.depth && o.depth.length === n ? o.depth : new Float32Array(n);
  PX.fill(o.background ? pack(o.background[0], o.background[1], o.background[2]) : 0);
  ZB.fill(-Infinity);

  const cam = o.camera;
  const R = cam.right, U = cam.up, D = cam.dir, C = cam.center;
  const s = cam.scale > 0 && Number.isFinite(cam.scale) ? cam.scale : 1;
  const hx = W / 2, hy = H / 2;
  const fill = o.fill !== false;
  const edges = o.edges !== false;
  const clip = o.clip ?? null;
  const edgeW = Math.max(1, Math.min(3, Math.round(o.edgeWidth ?? 1)));
  const capCol = pack(...(o.capColor ?? ([232, 112, 106] as RGB)));
  const flatCol = o.flatColor ? pack(...o.flatColor) : 0;
  const sceneEdgeCol = pack(...(o.edgeColor ?? ([27, 36, 48] as RGB)));
  // tolerance hloubkového testu hran: 0,05 pixelu přepočtené na hloubku (mm)
  const edgeEps = 0.05 / s;
  // odvrácené stěny se nekreslí (jako FrontSide ve 3D okně) – kromě řezu (vnitřek tělesa = plocha řezu)
  // a jednobarevné výplně „skryté hrany“ (ve 3D okně oboustranná)
  const cull = o.cullBackFaces ?? (!clip && !o.flatColor);
  let tris = 0;
  // ohraničení vykreslených pixelů (pro předvýpočet okolí hran jen tam, kde je model)
  let bX0 = W, bY0 = H, bX1 = -1, bY1 = -1;

  type Proj = { m: number[]; ax0: number; ax1: number; ax2: number; bx: number; ay0: number; ay1: number; ay2: number; by: number; az0: number; az1: number; az2: number; bz: number; flip: boolean };
  const project = (it: SoftItem): Proj => {
    const a = affine(it.matrix);
    const tx = a[9] - C[0], ty = a[10] - C[1], tz = a[11] - C[2];
    const det = a[0] * (a[4] * a[8] - a[5] * a[7]) - a[1] * (a[3] * a[8] - a[5] * a[6]) + a[2] * (a[3] * a[7] - a[4] * a[6]);
    return {
      m: a,
      ax0: s * (R[0] * a[0] + R[1] * a[3] + R[2] * a[6]), ax1: s * (R[0] * a[1] + R[1] * a[4] + R[2] * a[7]), ax2: s * (R[0] * a[2] + R[1] * a[5] + R[2] * a[8]), bx: hx + s * (R[0] * tx + R[1] * ty + R[2] * tz),
      ay0: -s * (U[0] * a[0] + U[1] * a[3] + U[2] * a[6]), ay1: -s * (U[0] * a[1] + U[1] * a[4] + U[2] * a[7]), ay2: -s * (U[0] * a[2] + U[1] * a[5] + U[2] * a[8]), by: hy - s * (U[0] * tx + U[1] * ty + U[2] * tz),
      az0: D[0] * a[0] + D[1] * a[3] + D[2] * a[6], az1: D[0] * a[1] + D[1] * a[4] + D[2] * a[7], az2: D[0] * a[2] + D[1] * a[5] + D[2] * a[8], bz: D[0] * tx + D[1] * ty + D[2] * tz,
      flip: det < 0,
    };
  };
  /** vzdálenost od roviny řezu jako lineární funkce místních souřadnic komponenty */
  const clipRow = (a: number[]) => {
    const N = clip!.normal;
    return [N[0] * a[0] + N[1] * a[3] + N[2] * a[6], N[0] * a[1] + N[1] * a[4] + N[2] * a[7], N[0] * a[2] + N[1] * a[5] + N[2] * a[8], N[0] * a[9] + N[1] * a[10] + N[2] * a[11] + clip!.constant];
  };

  // ---------- plochy ----------
  if (fill) {
    // pixely, kde je vidět vnitřek tělesa řezem (plocha řezu); po vykreslení dostanou hloubku roviny řezu
    const capm = clip ? capMask(n) : null;
    const luts = new Map<string, Uint32Array>();
    const lutOf = (c: RGB) => {
      const k = `${c[0]},${c[1]},${c[2]}`;
      let l = luts.get(k);
      if (!l) luts.set(k, (l = shadeLut(c)));
      return l;
    };
    for (const it of o.items) {
      const V = it.vertices;
      const T = it.triangles;
      const nv = Math.floor(V.length / 3);
      if (!nv || T.length < 3) continue;
      tris += Math.floor(T.length / 3);
      if (it.wire) continue;
      ensureScratch(nv);
      const p = project(it);
      for (let i = 0, j = 0; i < nv; i++, j += 3) {
        const x = V[j], y = V[j + 1], z = V[j + 2];
        SX[i] = p.ax0 * x + p.ax1 * y + p.ax2 * z + p.bx;
        SY[i] = p.ay0 * x + p.ay1 * y + p.ay2 * z + p.by;
        SZ[i] = p.az0 * x + p.az1 * y + p.az2 * z + p.bz;
      }
      if (clip) {
        const c = clipRow(p.m);
        for (let i = 0, j = 0; i < nv; i++, j += 3) CD[i] = c[0] * V[j] + c[1] * V[j + 1] + c[2] * V[j + 2] + c[3];
      }
      const NRM = it.normals && it.normals.length === V.length ? it.normals : null;
      const gouraud = !!NRM && !o.flatColor;
      if (gouraud) {
        // normála do souřadnic pohledu (ax/ay jsou násobené měřítkem a ay má obrácené znaménko)
        for (let i = 0, j = 0; i < nv; i++, j += 3) {
          const x = NRM![j], y = NRM![j + 1], z = NRM![j + 2];
          const vx = p.ax0 * x + p.ax1 * y + p.ax2 * z;
          const vy = -(p.ay0 * x + p.ay1 * y + p.ay2 * z);
          const vz = (p.az0 * x + p.az1 * y + p.az2 * z) * s;
          const l = Math.sqrt(vx * vx + vy * vy + vz * vz);
          VI[i] = l > 0 ? shadeIndex(vx / l, vy / l, vz / l) : 128;
        }
      }
      const fc = it.faceColors && it.faceGroups && it.faceGroups.length >= 3 && Object.keys(it.faceColors).length ? it.faceColors : null;
      const FG = fc ? it.faceGroups! : null;
      const groups = FG ? Math.floor(FG.length / 3) : 1;
      const baseLut = lutOf(it.color);
      const flip = p.flip;
      for (let g = 0; g < groups; g++) {
        const start = FG ? FG[g * 3] : 0;
        const end = FG ? Math.min(T.length, start + FG[g * 3 + 1]) : T.length;
        const col = FG ? fc![FG[g * 3 + 2]] : undefined;
        const lut = col ? lutOf(col) : baseLut;
        for (let t = start; t + 2 < end; t += 3) {
          const a = T[t], b = T[t + 1], c = T[t + 2];
          const x0 = SX[a], y0 = SY[a], x1 = SX[b], y1 = SY[b], x2 = SX[c], y2 = SY[c];
          let minY = y0 < y1 ? y0 : y1;
          if (y2 < minY) minY = y2;
          let maxY = y0 > y1 ? y0 : y1;
          if (y2 > maxY) maxY = y2;
          let ys = Math.ceil(minY - 0.5);
          if (ys < 0) ys = 0;
          let ye = Math.floor(maxY - 0.5);
          if (ye >= H) ye = H - 1;
          if (ys > ye) continue;
          if ((x0 < 0 && x1 < 0 && x2 < 0) || (x0 > W && x1 > W && x2 > W)) continue;
          const area = (x1 - x0) * (y2 - y0) - (x2 - x0) * (y1 - y0);
          if (!(area > 1e-9 || area < -1e-9)) continue;
          let needClip = false;
          let c0 = 0, dcdx = 0, dcdy = 0;
          const inv = 1 / area;
          if (clip) {
            c0 = CD[a];
            const c1 = CD[b], c2 = CD[c];
            if (c0 < 0 && c1 < 0 && c2 < 0) continue;
            if (c0 < 0 || c1 < 0 || c2 < 0) {
              needClip = true;
              dcdx = ((c1 - c0) * (y2 - y0) - (c2 - c0) * (y1 - y0)) * inv;
              dcdy = ((c2 - c0) * (x1 - x0) - (c1 - c0) * (x2 - x0)) * inv;
            }
          }
          // přivrácená plocha: proti směru hodin při pohledu od kamery (osa y obrazu míří dolů → záporná plocha)
          const front = area < 0 !== flip;
          if (!front && cull) continue;
          const z0 = SZ[a], z1 = SZ[b], z2 = SZ[c];
          const dzdx = ((z1 - z0) * (y2 - y0) - (z2 - z0) * (y1 - y0)) * inv;
          const dzdy = ((z2 - z0) * (x1 - x0) - (z1 - z0) * (x2 - x0)) * inv;
          let constCol = 0;
          const isCap = !front && clip ? 1 : 0;
          let useG = false;
          let i0 = 0, didx = 0, didy = 0;
          if (!front && clip) constCol = capCol;
          else if (o.flatColor) constCol = flatCol;
          else if (front && gouraud) {
            i0 = VI[a];
            const i1 = VI[b], i2 = VI[c];
            const e1 = i1 - i0, e2 = i2 - i0;
            if (e1 < 0.5 && e1 > -0.5 && e2 < 0.5 && e2 > -0.5) constCol = lut[i0 | 0];
            else {
              useG = true;
              didx = (e1 * (y2 - y0) - e2 * (y1 - y0)) * inv;
              didy = (e2 * (x1 - x0) - e1 * (x2 - x0)) * inv;
            }
          } else {
            // ploché stínování: geometrická normála v souřadnicích pohledu, natočená ke kameře
            const ex1 = x1 - x0, ey1 = y0 - y1, ez1 = (z1 - z0) * s;
            const ex2 = x2 - x0, ey2 = y0 - y2, ez2 = (z2 - z0) * s;
            let nx = ey1 * ez2 - ez1 * ey2, ny = ez1 * ex2 - ex1 * ez2, nz = ex1 * ey2 - ey1 * ex2;
            if (nz < 0) {
              nx = -nx;
              ny = -ny;
              nz = -nz;
            }
            const l = Math.sqrt(nx * nx + ny * ny + nz * nz);
            constCol = lut[l > 0 ? shadeIndex(nx / l, ny / l, nz / l) | 0 : 128];
          }
          // seřazení vrcholů podle y (horní, prostřední, dolní)
          let xa = x0, ya = y0, xb = x1, yb = y1, xc = x2, yc = y2, tmp = 0;
          if (yb < ya) {
            tmp = xa; xa = xb; xb = tmp;
            tmp = ya; ya = yb; yb = tmp;
          }
          if (yc < ya) {
            tmp = xa; xa = xc; xc = tmp;
            tmp = ya; ya = yc; yc = tmp;
          }
          if (yc < yb) {
            tmp = xb; xb = xc; xc = tmp;
            tmp = yb; yb = yc; yc = tmp;
          }
          const kL = (xc - xa) / (yc - ya);
          const k1 = yb > ya ? (xb - xa) / (yb - ya) : 0;
          const k2 = yc > yb ? (xc - xb) / (yc - yb) : 0;
          for (let y = ys; y <= ye; y++) {
            const py = y + 0.5;
            let xl = xa + (py - ya) * kL;
            let xr = py < yb ? xa + (py - ya) * k1 : yc > yb ? xb + (py - yb) * k2 : xb;
            if (xl > xr) {
              tmp = xl; xl = xr; xr = tmp;
            }
            let xs = Math.ceil(xl - 0.5);
            let xe = Math.floor(xr - 0.5);
            if (xs < 0) xs = 0;
            if (xe >= W) xe = W - 1;
            if (needClip) {
              // vzdálenost od roviny řezu ve středu pixelu x: cr + dcdx·x
              const cr = c0 + dcdx * (0.5 - x0) + dcdy * (py - y0);
              if (dcdx > 0) {
                const lim = Math.ceil(-cr / dcdx - 1e-7);
                if (lim > xs) xs = lim;
              } else if (dcdx < 0) {
                const lim = Math.floor(-cr / dcdx + 1e-7);
                if (lim < xe) xe = lim;
              } else if (cr < 0) continue;
            }
            if (xs > xe) continue;
            if (y < bY0) bY0 = y;
            if (y > bY1) bY1 = y;
            if (xs < bX0) bX0 = xs;
            if (xe > bX1) bX1 = xe;
            let z = z0 + dzdx * (xs + 0.5 - x0) + dzdy * (py - y0);
            let idx = y * W + xs;
            if (useG) {
              let ii = i0 + didx * (xs + 0.5 - x0) + didy * (py - y0);
              for (let x = xs; x <= xe; x++) {
                if (z > ZB[idx]) {
                  ZB[idx] = z;
                  PX[idx] = lut[ii < 0 ? 0 : ii > 255 ? 255 : ii | 0];
                  if (capm !== null) capm[idx] = 0;
                }
                z += dzdx;
                ii += didx;
                idx++;
              }
            } else {
              for (let x = xs; x <= xe; x++) {
                if (z > ZB[idx]) {
                  ZB[idx] = z;
                  PX[idx] = constCol;
                  if (capm !== null) capm[idx] = isCap;
                }
                z += dzdx;
                idx++;
              }
            }
          }
        }
      }
    }
    // plocha řezu leží v rovině řezu, ne na odvrácené stěně za ní: hloubka se přepíše na rovinu, aby hrany uvnitř
    // tělesa (za plochou řezu) zůstaly skryté jako ve 3D okně
    if (capm !== null && clip) {
      const N = clip.normal;
      const nd = N[0] * D[0] + N[1] * D[1] + N[2] * D[2];
      if (nd > 1e-6 || nd < -1e-6) {
        // rovina: N·(C + R·r + U·u + D·z) + c = 0, r = (x + ½ − W/2)/s, u = −(y + ½ − H/2)/s
        const nr = (N[0] * R[0] + N[1] * R[1] + N[2] * R[2]) / s;
        const nu = (N[0] * U[0] + N[1] * U[1] + N[2] * U[2]) / s;
        const k0 = N[0] * C[0] + N[1] * C[1] + N[2] * C[2] + clip.constant;
        for (let y = 0, idx = 0; y < H; y++) {
          const base = k0 - nu * (y + 0.5 - hy);
          for (let x = 0; x < W; x++, idx++) if (capm[idx]) ZB[idx] = -(base + nr * (x + 0.5 - hx)) / nd;
        }
      }
    }
  } else {
    for (const it of o.items) tris += Math.floor(it.triangles.length / 3);
  }

  // ---------- hrany ----------
  if (edges && o.items.some((it) => it.lines && it.lines.length >= 6)) {
    const x1lim = W + 2, y1lim = H + 2;
    // okolí razítka hrany: (edgeW + 2)² pixelů od (px0 − 1, py0 − 1); nejbližší plocha okolí a příznak pozadí
    // se předpočítají jednou za snímek (bez výplně je z-buffer prázdný a každá hrana je vidět)
    const NB = fill && bX1 >= bX0 ? neighbourhood(ZB, W, H, edgeW, bX0, bY0, bX1, bY1) : null;
    const NMIN = NB ? NB.min : null;
    const NBG = NB ? NB.bg : null;
    for (const it of o.items) {
      const L = it.lines;
      if (!L || L.length < 6) continue;
      const p = project(it);
      const c = clip ? clipRow(p.m) : null;
      const edgeCol = it.edgeColor ? pack(...it.edgeColor) : sceneEdgeCol;
      for (let j = 0; j + 5 < L.length; j += 6) {
        const ax = L[j], ay = L[j + 1], az = L[j + 2], bx = L[j + 3], by = L[j + 4], bz = L[j + 5];
        const xa0 = p.ax0 * ax + p.ax1 * ay + p.ax2 * az + p.bx;
        const ya0 = p.ay0 * ax + p.ay1 * ay + p.ay2 * az + p.by;
        const za0 = p.az0 * ax + p.az1 * ay + p.az2 * az + p.bz;
        const dx = p.ax0 * bx + p.ax1 * by + p.ax2 * bz + p.bx - xa0;
        const dy = p.ay0 * bx + p.ay1 * by + p.ay2 * bz + p.by - ya0;
        const dz = p.az0 * bx + p.az1 * by + p.az2 * bz + p.bz - za0;
        // ořez parametru úsečky t ∈ [t0, t1]: rovina řezu a okraje plátna (Liang–Barsky, rezerva 2 px)
        TT[0] = 0;
        TT[1] = 1;
        if (c) {
          const ca = c[0] * ax + c[1] * ay + c[2] * az + c[3];
          const cb = c[0] * bx + c[1] * by + c[2] * bz + c[3];
          if (ca < 0 && cb < 0) continue;
          if (ca < 0) TT[0] = ca / (ca - cb);
          else if (cb < 0) TT[1] = ca / (ca - cb);
        }
        if (!lbClip(-dx, xa0 + 2) || !lbClip(dx, x1lim - xa0) || !lbClip(-dy, ya0 + 2) || !lbClip(dy, y1lim - ya0)) continue;
        const t0 = TT[0], t1 = TT[1];
        if (t0 > t1) continue;
        const xa = xa0 + dx * t0, ya = ya0 + dy * t0, za = za0 + dz * t0;
        const sx = dx * (t1 - t0), sy = dy * (t1 - t0), sz = dz * (t1 - t0);
        const steps = Math.max(1, Math.ceil(Math.max(sx < 0 ? -sx : sx, sy < 0 ? -sy : sy)));
        const ix = sx / steps, iy = sy / steps, iz = sz / steps;
        let x = xa, y = ya, z = za;
        for (let k = 0; k <= steps; k++, x += ix, y += iy, z += iz) {
          const fx = Math.floor(x), fy = Math.floor(y);
          const px0 = edgeW === 1 ? fx : Math.floor(x - (edgeW - 1) / 2);
          const py0 = edgeW === 1 ? fy : Math.floor(y - (edgeW - 1) / 2);
          // viditelnost: hrana ležící na ploše (i šikmé) projde bez odsouvání ploch v hloubce – stačí, že není za
          // VŠEMI plochami v okolí razítka (okolí o 1 px širší). Sousedí-li okolí s pozadím (obrys tělesa), projde
          // jen hrana, která leží na ploše pod sebou (rozdíl hloubek odpovídá sklonu plochy) – hrany schované uvnitř
          // tělesa tak u obrysu neprosvítají.
          const nx0 = px0 - 1, ny0 = py0 - 1, nx1 = px0 + edgeW, ny1 = py0 + edgeW;
          let visible = !NMIN || nx0 < 0 || ny0 < 0 || nx1 >= W || ny1 >= H;
          if (!visible) {
            const zt = z + edgeEps + 2e-7 * (z < 0 ? -z : z);
            const own = ZB[fy * W + fx];
            const nb = py0 * W + px0;
            if (zt >= own || zt >= NMIN![nb]) visible = true;
            else if (NBG![nb]) {
              // u obrysu: přesný (pomalejší) rozbor okolí
              let step = 0;
              for (let v = ny0; v <= ny1; v++) {
                let idx = v * W + nx0;
                for (let u = nx0; u <= nx1; u++, idx++) {
                  const d = ZB[idx];
                  if (d === -Infinity) continue;
                  const ds = own > d ? own - d : d - own;
                  if (ds > step) step = ds;
                }
              }
              if (own - zt <= 1.5 * step) visible = true;
            }
          }
          if (visible) {
            for (let v = 0; v < edgeW; v++) {
              const yy = py0 + v;
              if (yy < 0 || yy >= H) continue;
              for (let u = 0; u < edgeW; u++) {
                const xx = px0 + u;
                if (xx >= 0 && xx < W) PX[yy * W + xx] = edgeCol;
              }
            }
          }
        }
      }
    }
  }
  return { data, width: W, height: H, depth: ZB, ms: nowMs() - t0, triangles: tris };
}

/** Bod modelu pod pixelem plátna v hloubce středu pohledu (pro přiblížení ke kurzoru a posun). */
export function screenToWorld(cam: SoftCamera, width: number, height: number, x: number, y: number): Vec3 {
  const r = (x - width / 2) / cam.scale;
  const u = -(y - height / 2) / cam.scale;
  return [cam.center[0] + cam.right[0] * r + cam.up[0] * u, cam.center[1] + cam.right[1] * r + cam.up[1] * u, cam.center[2] + cam.right[2] * r + cam.up[2] * u];
}
