/**
 * Sestavy: umístění komponent, kusovník (BOM), rozložený pohled, zarovnání ploch a generátory
 * normálií a rámu vstřikovací formy. Čisté funkce – běží v prohlížeči i v testech.
 */
import { emptyDoc, uid, type AsmComponent, type CadDoc, type ComponentSource, type Feature, type Placement, type Vec3 } from "./types";

// ---------------- matice ----------------

export type Mat3 = [number, number, number, number, number, number, number, number, number]; // po řádcích

const rad = (d: number) => (d * Math.PI) / 180;
const deg = (r: number) => Math.round(((r * 180) / Math.PI) * 1e6) / 1e6;

export function mul3(a: Mat3, b: Mat3): Mat3 {
  const r = new Array(9).fill(0) as Mat3;
  for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) for (let k = 0; k < 3; k++) r[i * 3 + j] += a[i * 3 + k] * b[k * 3 + j];
  return r;
}
export function apply3(m: Mat3, v: Vec3): Vec3 {
  return [m[0] * v[0] + m[1] * v[1] + m[2] * v[2], m[3] * v[0] + m[4] * v[1] + m[5] * v[2], m[6] * v[0] + m[7] * v[1] + m[8] * v[2]];
}

/** Rotace z Eulerových úhlů XYZ (jako three.js „XYZ“): R = Rx·Ry·Rz. */
export function rotMatrix([rx, ry, rz]: Vec3): Mat3 {
  const [a, b, c] = [rad(rx), rad(ry), rad(rz)];
  const X: Mat3 = [1, 0, 0, 0, Math.cos(a), -Math.sin(a), 0, Math.sin(a), Math.cos(a)];
  const Y: Mat3 = [Math.cos(b), 0, Math.sin(b), 0, 1, 0, -Math.sin(b), 0, Math.cos(b)];
  const Z: Mat3 = [Math.cos(c), -Math.sin(c), 0, Math.sin(c), Math.cos(c), 0, 0, 0, 1];
  return mul3(mul3(X, Y), Z);
}

/** Eulerovy úhly XYZ z rotační matice (inverze k rotMatrix). */
export function eulerXYZ(m: Mat3): Vec3 {
  const m13 = Math.max(-1, Math.min(1, m[2]));
  const y = Math.asin(m13);
  let x: number;
  let z: number;
  if (Math.abs(m13) < 0.9999999) {
    x = Math.atan2(-m[5], m[8]);
    z = Math.atan2(-m[1], m[0]);
  } else {
    x = Math.atan2(m[7], m[4]);
    z = 0;
  }
  return [deg(x), deg(y), deg(z)];
}

/** Matice 4×4 po sloupcích (three.js Matrix4.fromArray). */
export function placementMatrix(p: Placement): number[] {
  const r = rotMatrix(p.rotation);
  return [r[0], r[3], r[6], 0, r[1], r[4], r[7], 0, r[2], r[5], r[8], 0, p.position[0], p.position[1], p.position[2], 1];
}

export function transformPoint(p: Placement, v: Vec3): Vec3 {
  const r = apply3(rotMatrix(p.rotation), v);
  return [r[0] + p.position[0], r[1] + p.position[1], r[2] + p.position[2]];
}

const dot = (a: Vec3, b: Vec3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a: Vec3, b: Vec3): Vec3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const norm = (a: Vec3): Vec3 => {
  const l = Math.hypot(...a) || 1;
  return [a[0] / l, a[1] / l, a[2] / l];
};

/** Nejmenší rotace, která převede směr a na směr b. */
export function rotationBetween(a: Vec3, b: Vec3): Mat3 {
  const u = norm(a);
  const v = norm(b);
  const c = dot(u, v);
  if (c > 1 - 1e-9) return [1, 0, 0, 0, 1, 0, 0, 0, 1];
  if (c < -1 + 1e-9) {
    // 180° kolem libovolné kolmé osy
    const ax = norm(Math.abs(u[0]) < 0.9 ? cross(u, [1, 0, 0]) : cross(u, [0, 1, 0]));
    const [x, y, z] = ax;
    return [2 * x * x - 1, 2 * x * y, 2 * x * z, 2 * x * y, 2 * y * y - 1, 2 * y * z, 2 * x * z, 2 * y * z, 2 * z * z - 1];
  }
  const w = cross(u, v);
  const k = 1 / (1 + c);
  return [
    w[0] * w[0] * k + c, w[0] * w[1] * k - w[2], w[0] * w[2] * k + w[1],
    w[1] * w[0] * k + w[2], w[1] * w[1] * k + c, w[1] * w[2] * k - w[0],
    w[2] * w[0] * k - w[1], w[2] * w[1] * k + w[0], w[2] * w[2] * k + c,
  ];
}

/**
 * Zarovnání plochy pohyblivé komponenty na cílovou plochu (vazba „Kontakt“ ze ZW3D/Inventoru):
 * normály proti sobě, plochy v jedné rovině. `center` navíc ztotožní středy ploch.
 * Plocha pohyblivé komponenty je v jejích lokálních souřadnicích, cíl ve světových.
 */
export function alignFaces(placement: Placement, local: { origin: Vec3; normal: Vec3 }, target: { origin: Vec3; normal: Vec3 }, mode: "mate" | "flush" | "center" = "mate"): Placement {
  const R = rotMatrix(placement.rotation);
  const nWorld = apply3(R, local.normal);
  const want: Vec3 = mode === "flush" ? norm(target.normal) : (norm(target.normal).map((x) => -x) as Vec3);
  const Q = rotationBetween(nWorld, want);
  const R2 = mul3(Q, R);
  const rotation = eulerXYZ(R2);
  const oRot = apply3(R2, local.origin);
  let position: Vec3;
  if (mode === "center") {
    position = [target.origin[0] - oRot[0], target.origin[1] - oRot[1], target.origin[2] - oRot[2]];
  } else {
    const cur: Vec3 = [oRot[0] + placement.position[0], oRot[1] + placement.position[1], oRot[2] + placement.position[2]];
    const n = norm(target.normal);
    const d = dot([target.origin[0] - cur[0], target.origin[1] - cur[1], target.origin[2] - cur[2]], n);
    position = [placement.position[0] + n[0] * d, placement.position[1] + n[1] * d, placement.position[2] + n[2] * d];
  }
  return { position: position.map((v) => Math.round(v * 1e6) / 1e6) as Vec3, rotation };
}

// ---------------- identita zdroje (cache, kusovník) ----------------

/** Rychlý hash obsahu zdroje – stejné díly sdílí síť (instancování) a sčítají se v kusovníku. */
export function sourceKey(s: ComponentSource): string {
  const str = s.kind === "part" ? JSON.stringify({ f: s.doc.features, v: s.doc.variables, b: s.doc.bindings, c: s.doc.activeConfig, cf: s.doc.configs }) : `${s.format}:${s.data.length}:${s.data.slice(0, 2048)}:${s.data.slice(-2048)}`;
  let h1 = 0x811c9dc5;
  let h2 = 0x01000193;
  for (let i = 0; i < str.length; i++) {
    const c = str.charCodeAt(i);
    h1 = Math.imul(h1 ^ c, 16777619);
    h2 = Math.imul(h2 ^ c, 2246822519);
  }
  return (h1 >>> 0).toString(36) + (h2 >>> 0).toString(36) + str.length.toString(36);
}

// ---------------- kusovník ----------------

export type BomRow = { pos: number; name: string; number?: string; qty: number; material?: string; massKg?: number; group?: string; ids: string[] };

export function computeBom(asm: CadDoc, info: (c: AsmComponent) => { material?: string; massKg?: number }): BomRow[] {
  const rows = new Map<string, BomRow>();
  for (const c of asm.components ?? []) {
    const key = `${sourceKey(c.source)}|${c.name}|${c.number ?? ""}`;
    const r = rows.get(key);
    if (r) {
      r.qty++;
      r.ids.push(c.id);
    } else {
      const i = info(c);
      rows.set(key, { pos: 0, name: c.name, number: c.number, qty: 1, material: i.material, massKg: i.massKg, group: c.group, ids: [c.id] });
    }
  }
  const order = ["Desky", "Tvarové díly", "Vedení", "Vyhazování", "Normálie"];
  const list = [...rows.values()].sort((a, b) => {
    const ga = order.indexOf(a.group ?? "");
    const gb = order.indexOf(b.group ?? "");
    return (ga < 0 ? 99 : ga) - (gb < 0 ? 99 : gb);
  });
  list.forEach((r, i) => (r.pos = i + 1));
  return list;
}

export function bomCsv(rows: BomRow[]): string {
  const esc = (s: string | number | undefined) => {
    const t = s == null ? "" : String(s);
    return /[;"\n]/.test(t) ? `"${t.replace(/"/g, '""')}"` : t;
  };
  const head = ["Pozice", "Název", "Číslo výkresu / norma", "Ks", "Materiál", "Hmotnost 1 ks [kg]", "Hmotnost celkem [kg]", "Skupina"];
  const lines = rows.map((r) =>
    [r.pos, r.name, r.number, r.qty, r.material, r.massKg != null ? r.massKg.toFixed(3).replace(".", ",") : "", r.massKg != null ? (r.massKg * r.qty).toFixed(3).replace(".", ",") : "", r.group].map(esc).join(";"),
  );
  return "﻿" + [head.join(";"), ...lines].join("\r\n") + "\r\n";
}

// ---------------- sestava ----------------

export function emptyAssembly(name = "Nová sestava"): CadDoc {
  return { ...emptyDoc(name), kind: "assembly", components: [] };
}

export function partComponent(doc: CadDoc, placement: Partial<Placement> = {}, extra: Partial<AsmComponent> = {}): AsmComponent {
  return {
    id: uid(),
    name: doc.name,
    source: { kind: "part", doc: { ...doc, kind: "part" } },
    placement: { position: placement.position ?? [0, 0, 0], rotation: placement.rotation ?? [0, 0, 0] },
    ...extra,
  };
}

/** Posun komponent pro rozložený pohled (od středu sestavy, násobek vzdálenosti). */
export function explodeOffset(center: Vec3, compCenter: Vec3, factor: number, axis: "radial" | "Z" = "radial"): Vec3 {
  if (axis === "Z") return [0, 0, (compCenter[2] - center[2]) * factor];
  return [(compCenter[0] - center[0]) * factor, (compCenter[1] - center[1]) * factor, (compCenter[2] - center[2]) * factor];
}

// ---------------- normálie (parametrické díly) ----------------

const sk = (id: string, name: string, plane: Extract<Feature, { type: "sketch" }>["plane"], entities: Extract<Feature, { type: "sketch" }>["entities"]): Feature => ({ id, name, type: "sketch", plane, entities });
const part = (name: string, material: string, features: Feature[], number?: string): CadDoc => ({ ...emptyDoc(name), material, features, kind: "part", props: number ? { number } : undefined });

/** Válcový imbusový šroub ISO 4762 (zjednodušený, bez závitu). */
export const ISO4762: Record<string, { k: number; dk: number; s: number; t: number }> = {
  M4: { k: 4, dk: 7, s: 3, t: 2 },
  M5: { k: 5, dk: 8.5, s: 4, t: 2.5 },
  M6: { k: 6, dk: 10, s: 5, t: 3 },
  M8: { k: 8, dk: 13, s: 6, t: 4 },
  M10: { k: 10, dk: 16, s: 8, t: 5 },
  M12: { k: 12, dk: 18, s: 10, t: 6 },
  M16: { k: 16, dk: 24, s: 14, t: 8 },
  M20: { k: 20, dk: 30, s: 17, t: 10 },
};

export function screwISO4762(size: keyof typeof ISO4762 | string, length: number): CadDoc {
  const d = Number(String(size).replace(/\D/g, "")) || 8;
  const g = ISO4762[size as string] ?? ISO4762.M8;
  const hex = uid();
  return part(`Šroub ${size}×${length}`, "ocel", [
    { id: uid(), name: "Dřík", type: "cylinder", radius: d / 2, height: length, position: [0, 0, -length], axis: "Z", mode: "new" },
    { id: uid(), name: "Hlava", type: "cylinder", radius: g.dk / 2, height: g.k, position: [0, 0, 0], axis: "Z", mode: "add" },
    sk(hex, "Šestihran", { kind: "base", name: "XY", offset: g.k }, [{ id: uid(), type: "polygon", cx: 0, cy: 0, r: g.s / Math.sqrt(3), sides: 6, angle: 0 }]),
    { id: uid(), name: "Imbus", type: "extrude", sketchId: hex, distance: g.t, symmetric: false, reverse: true, mode: "cut" },
    { id: uid(), name: "Sražení", type: "chamfer", distance: Math.max(0.3, d * 0.08), edges: "all" },
  ], `ISO 4762 – ${size}×${length} – 12.9`);
}

/** Vodicí sloupek (typ s osazením, jako HASCO Z00 / Meusburger E1000 – zjednodušeně). */
export function guidePillar(d: number, length: number, collar = 8): CadDoc {
  return part(`Vodicí sloupek Ø${d}×${length}`, "1.7131", [
    { id: uid(), name: "Dřík", type: "cylinder", radius: d / 2, height: length, position: [0, 0, 0], axis: "Z", mode: "new" },
    { id: uid(), name: "Límec", type: "cylinder", radius: d / 2 + 4, height: collar, position: [0, 0, 0], axis: "Z", mode: "add" },
    { id: uid(), name: "Náběh", type: "chamfer", distance: 1, edges: "all" },
  ], `Vodicí sloupek Ø${d}×${length}`);
}

/** Vodicí pouzdro s límcem. */
export function guideBush(d: number, length: number, collar = 8): CadDoc {
  return part(`Vodicí pouzdro Ø${d}×${length}`, "1.7131", [
    { id: uid(), name: "Tělo", type: "tube", outer: d + 8, inner: d, height: length, position: [0, 0, 0], axis: "Z", mode: "new" },
    { id: uid(), name: "Límec", type: "tube", outer: d + 16, inner: d, height: collar, position: [0, 0, length - collar], axis: "Z", mode: "add" },
  ], `Vodicí pouzdro Ø${d}×${length}`);
}

/** Vyhazovač s válcovou hlavou (DIN ISO 8694 / 6751 – zjednodušeně). */
export function ejectorPin(d: number, length: number): CadDoc {
  const dh = d <= 3 ? d + 3 : d <= 6 ? d + 4 : d + 6;
  const kh = d <= 6 ? 3 : 5;
  return part(`Vyhazovač Ø${d}×${length}`, "1.2516", [
    { id: uid(), name: "Hlava", type: "cylinder", radius: dh / 2, height: kh, position: [0, 0, 0], axis: "Z", mode: "new" },
    { id: uid(), name: "Dřík", type: "cylinder", radius: d / 2, height: length, position: [0, 0, kh], axis: "Z", mode: "add" },
  ], `ISO 8694 – Ø${d}×${length}`);
}

/** Středicí kroužek. */
export function locatingRing(d = 100, h = 10): CadDoc {
  return part(`Středicí kroužek Ø${d}`, "ocel", [
    { id: uid(), name: "Kroužek", type: "tube", outer: d, inner: 36, height: h, position: [0, 0, 0], axis: "Z", mode: "new" },
    { id: uid(), name: "Sražení", type: "chamfer", distance: 1, edges: "all" },
  ], `Středicí kroužek Ø${d}`);
}

// ---------------- rám formy ----------------

export type MoldBaseParams = {
  width: number; // X
  length: number; // Y
  clamp: number; // upínací desky
  aPlate: number; // tvarová deska pevná
  bPlate: number; // tvarová deska pohyblivá
  support: number; // opěrná deska
  spacer: number; // výška rozpěrek
  spacerWidth: number;
  ejector: number; // vyhazovací deska
  retainer: number; // kotevní deska vyhazovačů
  pillar: number; // průměr vodicích sloupků
  cavity: { w: number; l: number; depth: number } | null; // dutina v desce A
  material: string;
};

export const defaultMoldBase: MoldBaseParams = {
  width: 296,
  length: 346,
  clamp: 27,
  aPlate: 56,
  bPlate: 56,
  support: 36,
  spacer: 96,
  spacerWidth: 56,
  ejector: 22,
  retainer: 17,
  pillar: 24,
  cavity: { w: 140, l: 180, depth: 30 },
  material: "1.2311",
};

function plate(name: string, w: number, l: number, t: number, holes: { x: number; y: number; d: number; cb?: [number, number]; bottom?: boolean }[], material: string, extra: Feature[] = [], number?: string): CadDoc {
  const f: Feature[] = [{ id: uid(), name: "Deska", type: "box", size: [w, l, t], position: [0, 0, t / 2], centered: true, mode: "new" }];
  for (const h of holes)
    f.push({ id: uid(), name: `Díra Ø${h.d}`, type: "hole", position: [h.x, h.y, h.bottom ? 0 : t], axis: "Z", flip: !!h.bottom, diameter: h.d, depth: 0, cbDiameter: h.cb?.[0] ?? 0, cbDepth: h.cb?.[1] ?? 0, kind: h.cb ? "counterbore" : "simple" });
  f.push(...extra);
  f.push({ id: uid(), name: "Sražení hran", type: "chamfer", distance: 1, edges: "all" });
  return part(name, material, f, number);
}

/**
 * Rám vstřikovací formy (dvoudeskový, standardní stavba jako HASCO/Meusburger) – sestava desek,
 * rozpěrek, vyhazovacího paketu, vodicích sloupků/pouzder, šroubů a vyhazovačů.
 */
export function moldBase(p: MoldBaseParams = defaultMoldBase, name = "Rám formy"): CadDoc {
  const W = p.width;
  const L = p.length;
  const inset = Math.max(p.pillar * 1.3, p.pillar / 2 + 20); // osa vodicích sloupků od okraje (min. 12 mm stěna u pouzdra)
  const ex = W / 2 - inset;
  const ey = L / 2 - inset - 6;
  const guides = [
    [-ex, -ey],
    [ex, -ey],
    [-ex, ey],
    [ex, ey + 6], // posunutý sloupek – ochrana proti obrácené montáži
  ];
  const screwX = W / 2 - p.spacerWidth / 2;
  const screws = [
    [-screwX, -L / 2 + 30],
    [screwX, -L / 2 + 30],
    [-screwX, L / 2 - 30],
    [screwX, L / 2 - 30],
  ];
  const comps: AsmComponent[] = [];
  const add = (doc: CadDoc, z: number, group: string, rot: Vec3 = [0, 0, 0], xy: [number, number] = [0, 0], color?: string) =>
    comps.push(partComponent(doc, { position: [xy[0], xy[1], z], rotation: rot }, { group, number: doc.props?.number, color, fixed: comps.length === 0 }));

  let z = 0;
  // pohyblivá strana (zdola)
  const clampB = plate("Upínací deska pohyblivá", W + 50, L, p.clamp, [{ x: 0, y: 0, d: 40 }, ...screws.map(([x, y]) => ({ x, y, d: 13.5, cb: [20, 13] as [number, number], bottom: true }))], p.material, [], "D-01");
  add(clampB, z, "Desky", [0, 0, 0], [0, 0], "#7d8a99");
  z += p.clamp;
  const spacer = plate("Rozpěrka", p.spacerWidth, L, p.spacer, [], p.material, [], "D-02");
  add(spacer, z, "Desky", [0, 0, 0], [-(W / 2 - p.spacerWidth / 2), 0], "#8f9cab");
  add(spacer, z, "Desky", [0, 0, 0], [W / 2 - p.spacerWidth / 2, 0], "#8f9cab");
  const ew = W - 2 * p.spacerWidth - 4;
  const pins = [
    [-ew / 4, -L / 5],
    [ew / 4, -L / 5],
    [-ew / 4, L / 5],
    [ew / 4, L / 5],
  ];
  const ejPlate = plate("Vyhazovací deska", ew, L - 40, p.ejector, [], p.material, [], "D-03");
  add(ejPlate, z + 4, "Vyhazování", [0, 0, 0], [0, 0], "#b08b5a");
  const retainer = plate("Kotevní deska vyhazovačů", ew, L - 40, p.retainer, pins.map(([x, y]) => ({ x, y, d: 6.2, cb: [11, 5] as [number, number] })), p.material, [], "D-04");
  add(retainer, z + 4 + p.ejector, "Vyhazování", [0, 0, 0], [0, 0], "#c49b65");
  z += p.spacer;
  const support = plate("Opěrná deska", W, L, p.support, [...guides.map(([x, y]) => ({ x, y, d: p.pillar + 8.2 })), ...pins.map(([x, y]) => ({ x, y, d: 6.5 }))], p.material, [], "D-05");
  add(support, z, "Desky", [0, 0, 0], [0, 0], "#9aa7b5");
  z += p.support;
  const bExtra: Feature[] = [];
  const bPlate = plate("Tvarová deska pohyblivá", W, L, p.bPlate, [...guides.map(([x, y]) => ({ x, y, d: p.pillar + 0.2 })), ...pins.map(([x, y]) => ({ x, y, d: 6.1 }))], p.material, bExtra, "D-06");
  add(bPlate, z, "Desky", [0, 0, 0], [0, 0], "#5f87b3");
  const parting = z + p.bPlate;
  z = parting;
  const aExtra: Feature[] = p.cavity
    ? [{ id: uid(), name: "Dutina", type: "box", size: [p.cavity.w, p.cavity.l, p.cavity.depth], position: [0, 0, p.cavity.depth / 2], centered: true, mode: "cut" }]
    : [];
  const aPlate = plate("Tvarová deska pevná", W, L, p.aPlate, guides.map(([x, y]) => ({ x, y, d: p.pillar + 8.2 })), p.material, aExtra, "D-07");
  add(aPlate, z, "Desky", [0, 0, 0], [0, 0], "#e0b24a");
  z += p.aPlate;
  const clampA = plate("Upínací deska pevná", W + 50, L, p.clamp, [{ x: 0, y: 0, d: 36 }, ...screws.map(([x, y]) => ({ x, y, d: 13.5, cb: [20, 13] as [number, number] }))], p.material, [], "D-08");
  add(clampA, z, "Desky", [0, 0, 0], [0, 0], "#7d8a99");
  const top = z + p.clamp;
  add(locatingRing(100, 10), top, "Normálie", [0, 0, 0], [0, 0], "#3a3f45");

  // vedení: sloupky v desce B (z dělicí roviny dolů) a pouzdra v desce A
  const pillarLen = p.bPlate + p.aPlate - 6;
  const pillarDoc = guidePillar(p.pillar, pillarLen);
  const bushDoc = guideBush(p.pillar, p.aPlate);
  for (const [x, y] of guides) {
    add(pillarDoc, parting - p.bPlate + 0.001, "Vedení", [0, 0, 0], [x, y], "#d6d9dd");
    add(bushDoc, parting, "Vedení", [0, 0, 0], [x, y], "#c9a46a");
  }
  // šrouby (spodní upínací deska → opěrná deska), hlavou dolů
  const screwLen = Math.round((p.clamp - 13 + p.spacer + Math.min(20, p.support * 0.5)) / 5) * 5;
  const screwDoc = screwISO4762("M12", screwLen);
  for (const [x, y] of screws) add(screwDoc, 13, "Normálie", [180, 0, 0], [x, y], "#3a3f45");
  // vyhazovače
  const pinLen = Math.round((p.spacer - 4 - p.ejector + p.support + p.bPlate - (p.cavity ? 0 : 0)) / 5) * 5;
  const pinDoc = ejectorPin(6, pinLen);
  for (const [x, y] of pins) add(pinDoc, p.clamp + 4 + p.ejector, "Vyhazování", [0, 0, 0], [x, y], "#e03930");

  return { ...emptyAssembly(name), components: comps, material: p.material, props: { number: "SF-001", note: `Rám ${W}×${L}` } };
}
