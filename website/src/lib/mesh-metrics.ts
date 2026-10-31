/** Geometrické veličiny trojúhelníkové sítě (mm). Čisté funkce — testováno ve vitestu. */

export type RawMesh = { position: Float32Array | number[]; index?: Uint32Array | number[] | null };

export type Metrics = {
  size: [number, number, number];
  min: [number, number, number];
  max: [number, number, number];
  /** mm³ (absolutní hodnota — funguje i pro opačně orientované sítě) */
  volume: number;
  /** mm² */
  area: number;
  triangles: number;
};

export function meshMetrics(meshes: RawMesh[]): Metrics {
  const min: [number, number, number] = [Infinity, Infinity, Infinity];
  const max: [number, number, number] = [-Infinity, -Infinity, -Infinity];
  let vol = 0;
  let area = 0;
  let tris = 0;
  for (const m of meshes) {
    const p = m.position;
    for (let i = 0; i < p.length; i += 3) {
      for (let k = 0; k < 3; k++) {
        const v = p[i + k];
        if (v < min[k]) min[k] = v;
        if (v > max[k]) max[k] = v;
      }
    }
    const idx = m.index && m.index.length ? m.index : null;
    const n = idx ? idx.length : p.length / 3;
    let meshVol = 0;
    for (let t = 0; t + 2 < n; t += 3) {
      const a = (idx ? idx[t] : t) * 3;
      const b = (idx ? idx[t + 1] : t + 1) * 3;
      const c = (idx ? idx[t + 2] : t + 2) * 3;
      const ax = p[a], ay = p[a + 1], az = p[a + 2];
      const bx = p[b], by = p[b + 1], bz = p[b + 2];
      const cx = p[c], cy = p[c + 1], cz = p[c + 2];
      // objem: součet orientovaných čtyřstěnů s počátkem
      meshVol += (ax * (by * cz - bz * cy) - ay * (bx * cz - bz * cx) + az * (bx * cy - by * cx)) / 6;
      // plocha: |AB × AC| / 2
      const ux = bx - ax, uy = by - ay, uz = bz - az;
      const vx = cx - ax, vy = cy - ay, vz = cz - az;
      const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
      area += Math.sqrt(nx * nx + ny * ny + nz * nz) / 2;
      tris++;
    }
    vol += Math.abs(meshVol);
  }
  if (!Number.isFinite(min[0])) {
    return { size: [0, 0, 0], min: [0, 0, 0], max: [0, 0, 0], volume: 0, area: 0, triangles: 0 };
  }
  return {
    size: [max[0] - min[0], max[1] - min[1], max[2] - min[2]],
    min,
    max,
    volume: vol,
    area,
    triangles: tris,
  };
}

/** Hustoty v g/cm³. */
export const MATERIALS = [
  { id: "ocel", label: "Ocel", density: 7.85 },
  { id: "nerez", label: "Nerez", density: 7.95 },
  { id: "hlinik", label: "Hliník", density: 2.7 },
  { id: "mosaz", label: "Mosaz", density: 8.5 },
  { id: "med", label: "Měď", density: 8.96 },
  { id: "titan", label: "Titan", density: 4.43 },
  { id: "pom", label: "POM (plast)", density: 1.41 },
] as const;

/** Hmotnost v kg z objemu v mm³ a hustoty v g/cm³. */
export function massKg(volumeMm3: number, density: number) {
  return (volumeMm3 / 1000) * density / 1000;
}

export function fmtNum(n: number, digits = 1) {
  return n.toLocaleString("cs-CZ", { minimumFractionDigits: digits, maximumFractionDigits: digits });
}
