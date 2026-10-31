/**
 * Výpočty měření v prohlížeči 3D (čisté funkce, mm). Uchopené body nesou, odkud pocházejí
 * (roh, střed kružnice, střed hrany, bod na hraně, bod na ploše) — podle toho se počítá
 * kolmá vzdálenost rovin, úhel hran / ploch, průměr díry atd.
 */
import type { Vec3 } from "./topology";

export type SnapKind = "vertex" | "center" | "midpoint" | "edge" | "face";

export const SNAP_LABEL: Record<SnapKind, string> = {
  vertex: "Roh",
  center: "Střed",
  midpoint: "Střed hrany",
  edge: "Na hraně",
  face: "Na ploše",
};

/** Geometrie, na kterou se uchopilo (pro chytřejší výsledky). */
export interface SnapGeometry {
  /** Rovina plochy / osa válce. */
  plane?: { normal: Vec3; point: Vec3 };
  cylinder?: { axis: Vec3; point: Vec3; radius: number };
  /** Přímka hrany (bod + jednotkový směr). */
  line?: { point: Vec3; dir: Vec3; length: number };
  /** Kružnice / oblouk. */
  circle?: { center: Vec3; normal: Vec3; radius: number; full: boolean };
  /** Index plochy v topologii dílu (pro zvýraznění). */
  faceIndex?: number;
  /** Plocha plochy (mm²). */
  faceArea?: number;
  /** Délka hrany (mm). */
  curveLength?: number;
  /** Bod leží na vybarvené ploše řezu. */
  sectionCap?: boolean;
}

export interface SnapPoint {
  kind: SnapKind;
  point: Vec3;
  part: number;
  geometry?: SnapGeometry;
}

export type MeasureMode = "distance" | "diameter" | "angle";

export interface MeasureLine {
  label: string;
  value: string;
  primary?: boolean;
}

export interface Measurement {
  id: number;
  mode: MeasureMode;
  /** Body ke kreslení (úsečka mezi nimi / střed + bod). */
  points: Vec3[];
  /** Kde ukázat popisek. */
  anchor: Vec3;
  /** Krátký text do 3D popisku. */
  short: string;
  lines: MeasureLine[];
}

const sub = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const add = (a: Vec3, b: Vec3): Vec3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const scale = (a: Vec3, s: number): Vec3 => [a[0] * s, a[1] * s, a[2] * s];
const dot = (a: Vec3, b: Vec3): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a: Vec3, b: Vec3): Vec3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const length = (a: Vec3): number => Math.hypot(a[0], a[1], a[2]);
const unit = (a: Vec3): Vec3 => {
  const l = length(a);
  return l > 0 ? scale(a, 1 / l) : [0, 0, 0];
};

/** Formát délky v mm (čeština: desetinná čárka, mezera v tisících). */
export function fmtMm(v: number, digits = 3): string {
  const s = Math.abs(v) >= 1000 ? v.toFixed(Math.min(digits, 2)) : v.toFixed(digits);
  const [int, dec] = s.split(".");
  const grouped = int.replace(/\B(?=(\d{3})+(?!\d))/g, " ");
  return `${dec ? `${grouped},${dec}` : grouped} mm`;
}

export function fmtDeg(v: number): string {
  return `${v.toFixed(2).replace(".", ",")}°`;
}

/** Úhel mezi směry (0–90° pro přímky, kde nezáleží na orientaci). */
export function angleBetween(a: Vec3, b: Vec3, undirected = true): number {
  const c = dot(unit(a), unit(b));
  const v = Math.acos(Math.max(-1, Math.min(1, undirected ? Math.abs(c) : c)));
  return (v * 180) / Math.PI;
}

/** Kolmá vzdálenost bodu od roviny. */
export function pointPlaneDistance(p: Vec3, plane: { normal: Vec3; point: Vec3 }): number {
  return Math.abs(dot(sub(p, plane.point), unit(plane.normal)));
}

/** Nejkratší vzdálenost dvou přímek (rovnoběžné → vzdálenost bodu od přímky). */
export function lineLineDistance(a: { point: Vec3; dir: Vec3 }, b: { point: Vec3; dir: Vec3 }): number {
  const n = cross(a.dir, b.dir);
  const w = sub(b.point, a.point);
  if (length(n) < 1e-9) {
    const d = unit(a.dir);
    return length(sub(w, scale(d, dot(w, d))));
  }
  return Math.abs(dot(w, unit(n)));
}

let nextId = 1;

/** Vzdálenost dvou uchopených míst (+ kolmá vzdálenost rovin / os, když dává smysl). */
export function measureDistance(a: SnapPoint, b: SnapPoint): Measurement {
  const d = sub(b.point, a.point);
  const dist = length(d);
  const lines: MeasureLine[] = [];
  let points: Vec3[] = [a.point, b.point];
  let short = fmtMm(dist);

  const pa = a.kind === "face" ? a.geometry?.plane : undefined;
  const pb = b.kind === "face" ? b.geometry?.plane : undefined;
  const ca = a.geometry?.cylinder;
  const cb = b.geometry?.cylinder;

  if (pa && pb && angleBetween(pa.normal, pb.normal) < 0.05) {
    // dvě rovnoběžné roviny → kolmá vzdálenost (hlavní hodnota)
    const perp = pointPlaneDistance(b.point, pa);
    const foot = sub(b.point, scale(unit(pa.normal), dot(sub(b.point, pa.point), unit(pa.normal))));
    points = [foot, b.point];
    short = fmtMm(perp);
    lines.push({ label: "Vzdálenost rovin", value: fmtMm(perp), primary: true });
    lines.push({ label: "Vzdálenost bodů", value: fmtMm(dist) });
  } else if (pa && pb) {
    lines.push({ label: "Vzdálenost bodů", value: fmtMm(dist), primary: true });
    lines.push({ label: "Úhel ploch", value: fmtDeg(angleBetween(pa.normal, pb.normal, false)) });
  } else if (ca && cb && a.kind === "face" && b.kind === "face" && angleBetween(ca.axis, cb.axis) < 0.05) {
    // dvě rovnoběžné díry / čepy → rozteč os
    const axisDist = lineLineDistance({ point: ca.point, dir: ca.axis }, { point: cb.point, dir: cb.axis });
    short = fmtMm(axisDist);
    lines.push({ label: "Rozteč os", value: fmtMm(axisDist), primary: true });
    lines.push({ label: "Ø 1 / Ø 2", value: `${fmtMm(ca.radius * 2)} / ${fmtMm(cb.radius * 2)}` });
  } else {
    lines.push({ label: "Vzdálenost", value: fmtMm(dist), primary: true });
    const plane = pa ?? pb;
    const other = pa ? b : a;
    if (plane && other.kind !== "face") {
      lines.push({ label: "Kolmo k rovině", value: fmtMm(pointPlaneDistance(other.point, plane)) });
    }
  }
  lines.push({ label: "ΔX", value: fmtMm(Math.abs(d[0])) });
  lines.push({ label: "ΔY", value: fmtMm(Math.abs(d[1])) });
  lines.push({ label: "ΔZ", value: fmtMm(Math.abs(d[2])) });
  const anchor = scale(add(points[0], points[1]), 0.5);
  return { id: nextId++, mode: "distance", points, anchor, short, lines };
}

/** Průměr / poloměr kružnice, oblouku nebo válcové plochy. */
export function measureDiameter(s: SnapPoint): Measurement | null {
  const c = s.geometry?.circle;
  const cyl = s.geometry?.cylinder;
  if (c) {
    const lines: MeasureLine[] = [
      { label: "Průměr", value: `Ø ${fmtMm(c.radius * 2)}`, primary: true },
      { label: "Poloměr", value: `R ${fmtMm(c.radius)}` },
      { label: "Střed", value: c.center.map((x) => x.toFixed(3).replace(".", ",")).join("; ") },
    ];
    const edgePoint = s.kind === "edge" || s.kind === "center" ? s.point : s.point;
    const radial = sub(edgePoint, c.center);
    const onCircle = length(radial) > 1e-9 ? add(c.center, scale(unit(radial), c.radius)) : edgePoint;
    return {
      id: nextId++, mode: "diameter", points: [c.center, onCircle], anchor: onCircle,
      short: c.full ? `Ø ${fmtMm(c.radius * 2)}` : `R ${fmtMm(c.radius)}`, lines,
    };
  }
  if (cyl) {
    // patka kolmice z bodu na osu = střed v rovině bodu
    const ax = unit(cyl.axis);
    const center = add(cyl.point, scale(ax, dot(sub(s.point, cyl.point), ax)));
    return {
      id: nextId++, mode: "diameter", points: [center, s.point], anchor: s.point,
      short: `Ø ${fmtMm(cyl.radius * 2)}`,
      lines: [
        { label: "Průměr válce", value: `Ø ${fmtMm(cyl.radius * 2)}`, primary: true },
        { label: "Poloměr", value: `R ${fmtMm(cyl.radius)}` },
      ],
    };
  }
  return null;
}

/** Směr pro úhel: přímka hrany nebo normála roviny. */
function direction(s: SnapPoint): { dir: Vec3; what: "line" | "plane" } | null {
  if (s.geometry?.line) return { dir: s.geometry.line.dir, what: "line" };
  if (s.geometry?.plane) return { dir: s.geometry.plane.normal, what: "plane" };
  if (s.geometry?.cylinder) return { dir: s.geometry.cylinder.axis, what: "line" };
  return null;
}

/** Úhel dvou hran / ploch / os. */
export function measureAngle(a: SnapPoint, b: SnapPoint): Measurement | null {
  const da = direction(a);
  const db = direction(b);
  if (!da || !db) return null;
  let deg: number;
  if (da.what === db.what) {
    // hrana–hrana: 0–90°; rovina–rovina: úhel normál (0–180)
    deg = da.what === "line" ? angleBetween(da.dir, db.dir) : angleBetween(da.dir, db.dir, false);
  } else {
    // hrana vůči rovině: 90° − úhel k normále
    deg = 90 - angleBetween(da.dir, db.dir);
  }
  const anchor = scale(add(a.point, b.point), 0.5);
  return {
    id: nextId++, mode: "angle", points: [a.point, b.point], anchor, short: fmtDeg(deg),
    lines: [
      { label: "Úhel", value: fmtDeg(deg), primary: true },
      { label: "Doplněk", value: fmtDeg(180 - deg) },
    ],
  };
}

/** Objem (uzavřená síť) a povrch dílu — pro informace o dílu (hmotnost z objemu). */
export function meshVolumeArea(positions: Float32Array, indices: Uint32Array | null | undefined): { volume: number; area: number } {
  const tri = indices ? indices.length / 3 : positions.length / 9;
  let vol = 0;
  let area = 0;
  for (let t = 0; t < tri; t++) {
    const a = (indices ? indices[t * 3] : t * 3) * 3;
    const b = (indices ? indices[t * 3 + 1] : t * 3 + 1) * 3;
    const c = (indices ? indices[t * 3 + 2] : t * 3 + 2) * 3;
    const ax = positions[a], ay = positions[a + 1], az = positions[a + 2];
    const bx = positions[b], by = positions[b + 1], bz = positions[b + 2];
    const cx = positions[c], cy = positions[c + 1], cz = positions[c + 2];
    vol += (ax * (by * cz - bz * cy) - ay * (bx * cz - bz * cx) + az * (bx * cy - by * cx)) / 6;
    const ux = bx - ax, uy = by - ay, uz = bz - az;
    const vx = cx - ax, vy = cy - ay, vz = cz - az;
    area += Math.hypot(uy * vz - uz * vy, uz * vx - ux * vz, ux * vy - uy * vx) / 2;
  }
  return { volume: Math.abs(vol), area };
}

/** Hmotnost z objemu (mm³) pro ocel 7,85 g/cm³. */
export function steelMassKg(volumeMm3: number): number {
  return (volumeMm3 / 1000) * 7.85 / 1000;
}
