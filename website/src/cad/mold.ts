/**
 * Formařské nástroje: analýza úkosů, smrštění materiálu, návrh vyhazovačů a chladicích kanálů.
 * Čisté funkce nad sítí modelu (MeshData) – běží v UI i v testech, bez OCCT.
 */
import type { CadDoc, Feature, MeshData, Vec3 } from "./types";
import { uid } from "./types";

// ---------------- smrštění ----------------

/** Typická lineární smrštění vstřikovaných materiálů [%] (střed rozsahu dle výrobců granulátů). */
export const SHRINKAGE: { id: string; label: string; pct: number }[] = [
  { id: "pp", label: "PP (polypropylen)", pct: 1.5 },
  { id: "pe-hd", label: "PE-HD", pct: 2.0 },
  { id: "abs", label: "ABS", pct: 0.55 },
  { id: "pc", label: "PC (polykarbonát)", pct: 0.65 },
  { id: "pa6", label: "PA6 (silon)", pct: 1.2 },
  { id: "pa66-gf30", label: "PA66 GF30", pct: 0.5 },
  { id: "pom", label: "POM", pct: 2.0 },
  { id: "pmma", label: "PMMA (plexisklo)", pct: 0.45 },
  { id: "ps", label: "PS (polystyren)", pct: 0.5 },
  { id: "tpe", label: "TPE", pct: 1.5 },
];

/** Měřítko dutiny formy pro dané smrštění: díl × (1 + s/100). */
export const shrinkageScale = (pct: number) => 1 + pct / 100;

/** Přidá do historie dílu transformaci měřítka „Smrštění“ (dutina formy = zvětšený díl). */
export function applyShrinkage(doc: CadDoc, pct: number): CadDoc {
  const scale = Math.round(shrinkageScale(pct) * 1e6) / 1e6;
  const f: Feature = { id: uid(), name: `Smrštění +${pct} %`, type: "transform", translate: [0, 0, 0], rotateAxis: "Z", rotateAngle: 0, scale };
  return { ...doc, features: [...doc.features, f] };
}

// ---------------- analýza úkosů ----------------

export type DraftClass = 0 | 1 | 2 | 3; // 0 = ok (≥ min), 1 = malý úkos (0..min), 2 = svislá stěna (~0°), 3 = podkos (negativní)

export type DraftResult = {
  /** třída pro každý trojúhelník sítě */
  classes: Uint8Array;
  /** plocha [mm²] v každé třídě */
  areas: [number, number, number, number];
  /** podíl plochy s podkosem (0–1) */
  undercutRatio: number;
  /** úhel úkosu [°] pro každý trojúhelník (kladný = ve směru vyhození) */
  angles: Float32Array;
};

export const DRAFT_COLORS: Record<DraftClass, string> = { 0: "#2f9e44", 1: "#f5c518", 2: "#f97316", 3: "#e03930" };
export const DRAFT_LABELS: Record<DraftClass, string> = { 0: "Dostatečný úkos", 1: "Malý úkos", 2: "Svislá stěna", 3: "Podkos (nelze vyhodit)" };

/**
 * Klasifikace úkosů: úhel mezi normálou plochy a rovinou kolmou na směr vyhození.
 * `pull` je směr otevírání formy (typicky +Z), `minDeg` požadovaný úkos (typ. 0,5–3°).
 */
export function draftAnalysis(mesh: MeshData, pull: Vec3 = [0, 0, 1], minDeg = 1): DraftResult {
  const len = Math.hypot(...pull) || 1;
  const p: Vec3 = [pull[0] / len, pull[1] / len, pull[2] / len];
  const tri = mesh.triangles;
  const v = mesh.vertices;
  const n = tri.length / 3;
  const classes = new Uint8Array(n);
  const angles = new Float32Array(n);
  const areas: [number, number, number, number] = [0, 0, 0, 0];
  const zeroTol = 0.05; // ± tolerance „svislé“ stěny [°]
  for (let t = 0; t < n; t++) {
    const [a, b, c] = [tri[t * 3] * 3, tri[t * 3 + 1] * 3, tri[t * 3 + 2] * 3];
    const ux = v[b] - v[a];
    const uy = v[b + 1] - v[a + 1];
    const uz = v[b + 2] - v[a + 2];
    const wx = v[c] - v[a];
    const wy = v[c + 1] - v[a + 1];
    const wz = v[c + 2] - v[a + 2];
    const nx = uy * wz - uz * wy;
    const ny = uz * wx - ux * wz;
    const nz = ux * wy - uy * wx;
    const nl = Math.hypot(nx, ny, nz);
    const area = nl / 2;
    if (!nl) continue;
    const dot = (nx * p[0] + ny * p[1] + nz * p[2]) / nl;
    const draft = 90 - (Math.acos(Math.max(-1, Math.min(1, dot))) * 180) / Math.PI; // >0 směrem vyhození
    angles[t] = draft;
    // plochy kolmé na směr vyhození (dno/víko, |draft| → 90°) jsou v pořádku
    let cls: DraftClass;
    if (draft >= minDeg || draft > 80) cls = 0;
    else if (draft > zeroTol) cls = 1;
    else if (draft >= -zeroTol) cls = 2;
    else if (draft < -80) cls = 0; // spodní čela kolmá na osu – formálně podkos vůči jedné polovině, řeší druhá strana formy
    else cls = 3;
    classes[t] = cls;
    areas[cls] += area;
  }
  const total = areas[0] + areas[1] + areas[2] + areas[3] || 1;
  return { classes, areas, undercutRatio: areas[3] / total, angles };
}

/** Barvy vrcholů (RGB po trojicích) pro zobrazení analýzy úkosů v three.js. */
export function draftVertexColors(mesh: MeshData, res: DraftResult): Float32Array {
  const colors = new Float32Array(mesh.vertices.length);
  const tri = mesh.triangles;
  const rgb: Record<number, [number, number, number]> = {};
  for (const k of [0, 1, 2, 3] as DraftClass[]) {
    const h = DRAFT_COLORS[k];
    rgb[k] = [parseInt(h.slice(1, 3), 16) / 255, parseInt(h.slice(3, 5), 16) / 255, parseInt(h.slice(5, 7), 16) / 255];
  }
  for (let t = 0; t < res.classes.length; t++) {
    const c = rgb[res.classes[t]];
    for (let k = 0; k < 3; k++) {
      const vi = tri[t * 3 + k] * 3;
      colors[vi] = c[0];
      colors[vi + 1] = c[1];
      colors[vi + 2] = c[2];
    }
  }
  return colors;
}

// ---------------- vyhazovače ----------------

export type EjectorSuggestion = { x: number; y: number; d: number };

/**
 * Návrh rozmístění vyhazovačů: pravidelná mřížka uvnitř půdorysu dílu (bbox v rovině XY),
 * s odstupem od okraje a roztečí podle velikosti. Vrací pozice v souřadnicích dílu.
 */
export function suggestEjectors(bbox: [Vec3, Vec3], opts: { margin?: number; maxSpacing?: number; diameter?: number } = {}): EjectorSuggestion[] {
  const [min, max] = bbox;
  const w = max[0] - min[0];
  const l = max[1] - min[1];
  const d = opts.diameter ?? (Math.min(w, l) < 60 ? 3 : Math.min(w, l) < 150 ? 5 : 8);
  const margin = opts.margin ?? Math.max(6, d * 1.5);
  const innerW = w - 2 * margin;
  const innerL = l - 2 * margin;
  if (innerW <= 0 || innerL <= 0) return [{ x: (min[0] + max[0]) / 2, y: (min[1] + max[1]) / 2, d }];
  const spacing = opts.maxSpacing ?? Math.max(25, Math.min(80, Math.max(innerW, innerL) / 3));
  const nx = Math.max(2, Math.ceil(innerW / spacing) + 1);
  const ny = Math.max(2, Math.ceil(innerL / spacing) + 1);
  const out: EjectorSuggestion[] = [];
  for (let i = 0; i < nx; i++)
    for (let j = 0; j < ny; j++) out.push({ x: min[0] + margin + (innerW * i) / (nx - 1), y: min[1] + margin + (innerL * j) / (ny - 1), d });
  return out;
}

// ---------------- chladicí kanály ----------------

export type CoolingParams = {
  /** půdorys dutiny (bbox dílu) */
  bbox: [Vec3, Vec3];
  /** průměr kanálu */
  diameter: number;
  /** vzdálenost osy kanálů od dutiny (z) */
  depth: number;
  /** počet větví (řad) */
  rows: number;
  /** přesah za okraj dutiny (napojení) */
  overhang: number;
};

export const defaultCooling = (bbox: [Vec3, Vec3]): CoolingParams => {
  const d = Math.max(6, Math.min(12, Math.round((bbox[1][0] - bbox[0][0]) / 25)));
  return { bbox, diameter: d, depth: Math.max(15, d * 2.5), rows: Math.max(2, Math.round((bbox[1][1] - bbox[0][1]) / 50)), overhang: 30 };
};

/**
 * Vygeneruje díl „Chladicí okruh“ – rovnoběžné vrtané kanály pod dutinou propojené
 * příčnými vrty (meandr). Vloží se jako komponenta do sestavy formy, nebo jako
 * negativ (mode "cut") do desky.
 */
export function coolingCircuit(p: CoolingParams, name = "Chladicí okruh"): CadDoc {
  const [min, max] = p.bbox;
  const z = min[2] - p.depth;
  const x0 = min[0] - p.overhang;
  const x1 = max[0] + p.overhang;
  const features: Feature[] = [];
  const ys: number[] = [];
  for (let i = 0; i < p.rows; i++) ys.push(p.rows === 1 ? (min[1] + max[1]) / 2 : min[1] + ((max[1] - min[1]) * i) / (p.rows - 1));
  ys.forEach((y, i) => {
    features.push({ id: uid(), name: `Kanál ${i + 1}`, type: "cylinder", radius: p.diameter / 2, height: x1 - x0, position: [x0, y, z], axis: "X", mode: i === 0 ? "new" : "add" });
  });
  // propojky střídavě na koncích (meandr)
  for (let i = 0; i + 1 < ys.length; i++) {
    const x = i % 2 === 0 ? x1 - p.diameter : x0 + p.diameter;
    features.push({ id: uid(), name: `Propojka ${i + 1}`, type: "cylinder", radius: p.diameter / 2, height: ys[i + 1] - ys[i], position: [x, ys[i], z], axis: "Y", mode: "add" });
  }
  return { app: "mnastrojarna-cad", version: 2, name, material: "ocel", features, color: "#1c7ed6", props: { note: `Ø${p.diameter} mm, ${p.rows} větví` } };
}

// ---------------- dělicí rovina (odhad) ----------------

/**
 * Odhad výšky dělicí roviny: z-souřadnice s největším obvodem průřezu (siluety).
 * Prochází trojúhelníky a hledá z, kde je největší obrys – prakticky největší průmět.
 */
export function suggestPartingZ(mesh: MeshData, samples = 40): { z: number; perimeter: number } {
  const v = mesh.vertices;
  let zMin = Infinity;
  let zMax = -Infinity;
  for (let i = 2; i < v.length; i += 3) {
    if (v[i] < zMin) zMin = v[i];
    if (v[i] > zMax) zMax = v[i];
  }
  if (!Number.isFinite(zMin) || zMax - zMin < 1e-6) return { z: 0, perimeter: 0 };
  const tri = mesh.triangles;
  let best = { z: zMin, perimeter: 0 };
  for (let s = 0; s <= samples; s++) {
    const z = zMin + ((zMax - zMin) * s) / samples;
    let per = 0;
    for (let t = 0; t < tri.length; t += 3) {
      // délka průsečíku trojúhelníku s rovinou z
      const idx = [tri[t] * 3, tri[t + 1] * 3, tri[t + 2] * 3];
      const pts: [number, number][] = [];
      for (let e = 0; e < 3; e++) {
        const a = idx[e];
        const b = idx[(e + 1) % 3];
        const za = v[a + 2];
        const zb = v[b + 2];
        if ((za <= z && zb > z) || (zb <= z && za > z)) {
          const f = (z - za) / (zb - za);
          pts.push([v[a] + (v[b] - v[a]) * f, v[a + 1] + (v[b + 1] - v[a + 1]) * f]);
        }
      }
      if (pts.length === 2) per += Math.hypot(pts[1][0] - pts[0][0], pts[1][1] - pts[0][1]);
    }
    if (per > best.perimeter) best = { z, perimeter: per };
  }
  return best;
}
