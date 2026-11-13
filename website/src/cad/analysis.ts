/**
 * Analýzy ploch nad sítí modelu (bez OCCT): křivost (barevná mapa), odhad tloušťky stěn ze sítě.
 * Čisté funkce – běží v UI i v testech.
 */
import type { MeshData } from "./types";

/**
 * Přibližná střední křivost v každém vrcholu: průměr (n_j − n_i)·(p_j − p_i)/|p_j − p_i|² přes sousedy.
 * Kladná = vypuklá, záporná = vydutá, ~0 = rovina/válec podél osy.
 */
export function vertexCurvature(mesh: MeshData): Float32Array {
  const v = mesh.vertices;
  const n = mesh.normals;
  const tri = mesh.triangles;
  const count = v.length / 3;
  const sum = new Float32Array(count);
  const cnt = new Uint16Array(count);
  const add = (a: number, b: number) => {
    const dx = v[b * 3] - v[a * 3];
    const dy = v[b * 3 + 1] - v[a * 3 + 1];
    const dz = v[b * 3 + 2] - v[a * 3 + 2];
    const l2 = dx * dx + dy * dy + dz * dz;
    if (l2 < 1e-12) return;
    const dn = (n[b * 3] - n[a * 3]) * dx + (n[b * 3 + 1] - n[a * 3 + 1]) * dy + (n[b * 3 + 2] - n[a * 3 + 2]) * dz;
    sum[a] += dn / l2;
    cnt[a]++;
  };
  for (let t = 0; t < tri.length; t += 3) {
    const [a, b, c] = [tri[t], tri[t + 1], tri[t + 2]];
    add(a, b); add(a, c); add(b, a); add(b, c); add(c, a); add(c, b);
  }
  const out = new Float32Array(count);
  for (let i = 0; i < count; i++) out[i] = cnt[i] ? sum[i] / cnt[i] : 0;
  return out;
}

/** Barvy vrcholů (RGB) pro mapu křivosti: modrá vydutá – zelená rovina – červená vypuklá; `range` = křivost pro plnou barvu (1/mm). */
export function curvatureColors(mesh: MeshData, range?: number): { colors: Float32Array; range: number; min: number; max: number } {
  const k = vertexCurvature(mesh);
  let min = Infinity;
  let max = -Infinity;
  for (const x of k) {
    if (x < min) min = x;
    if (x > max) max = x;
  }
  if (!Number.isFinite(min)) {
    min = 0;
    max = 0;
  }
  // robustní rozsah: 95. percentil absolutní hodnoty
  const abs = Array.from(k, Math.abs).sort((a, b) => a - b);
  const r = range ?? Math.max(1e-4, abs[Math.floor(abs.length * 0.95)] || 1e-3);
  const colors = new Float32Array(k.length * 3);
  for (let i = 0; i < k.length; i++) {
    const t = Math.max(-1, Math.min(1, k[i] / r)); // −1..1
    // modrá (−1) → azurová → zelená (0) → žlutá → červená (+1)
    let R = 0, G = 0, B = 0;
    if (t < -0.5) { R = 0; G = (t + 1) * 2; B = 1; }
    else if (t < 0) { R = 0; G = 1; B = -t * 2; }
    else if (t < 0.5) { R = t * 2; G = 1; B = 0; }
    else { R = 1; G = (1 - t) * 2; B = 0; }
    colors[i * 3] = 0.15 + 0.85 * R;
    colors[i * 3 + 1] = 0.15 + 0.85 * G;
    colors[i * 3 + 2] = 0.15 + 0.85 * B;
  }
  return { colors, range: r, min, max };
}

/**
 * Odhad tloušťky stěny ze sítě: pro vzorek vrcholů vyšle paprsek proti normále a najde nejbližší protější trojúhelník.
 * Vrací minimální a průměrnou tloušťku, místo nejtenčí stěny (vrchol sítě, ze kterého paprsek vyšel) a barvy vrcholů
 * (červená = pod limitem).
 */
export function wallThickness(mesh: MeshData, limit = 1, samples = 4000): { min: number; avg: number; colors: Float32Array; below: number; at: [number, number, number] | null } {
  const v = mesh.vertices;
  const n = mesh.normals;
  const tri = mesh.triangles;
  const count = v.length / 3;
  const triCount = tri.length / 3;
  const step = Math.max(1, Math.floor(count / samples));
  const thick = new Float32Array(count).fill(NaN);
  // předpočet trojúhelníků
  const tv: number[][] = [];
  for (let t = 0; t < triCount; t++) tv.push([tri[t * 3] * 3, tri[t * 3 + 1] * 3, tri[t * 3 + 2] * 3]);
  const EPS = 1e-6;
  for (let i = 0; i < count; i += step) {
    const ox = v[i * 3], oy = v[i * 3 + 1], oz = v[i * 3 + 2];
    const dx = -n[i * 3], dy = -n[i * 3 + 1], dz = -n[i * 3 + 2];
    let best = Infinity;
    for (let t = 0; t < triCount; t++) {
      const [a, b, c] = tv[t];
      if (a === i * 3 || b === i * 3 || c === i * 3) continue;
      // Möller–Trumbore
      const e1x = v[b] - v[a], e1y = v[b + 1] - v[a + 1], e1z = v[b + 2] - v[a + 2];
      const e2x = v[c] - v[a], e2y = v[c + 1] - v[a + 1], e2z = v[c + 2] - v[a + 2];
      const px = dy * e2z - dz * e2y, py = dz * e2x - dx * e2z, pz = dx * e2y - dy * e2x;
      const det = e1x * px + e1y * py + e1z * pz;
      if (det > -EPS && det < EPS) continue;
      const inv = 1 / det;
      const tx = ox - v[a], ty = oy - v[a + 1], tz = oz - v[a + 2];
      const u = (tx * px + ty * py + tz * pz) * inv;
      if (u < 0 || u > 1) continue;
      const qx = ty * e1z - tz * e1y, qy = tz * e1x - tx * e1z, qz = tx * e1y - ty * e1x;
      const w = (dx * qx + dy * qy + dz * qz) * inv;
      if (w < 0 || u + w > 1) continue;
      const dist = (e2x * qx + e2y * qy + e2z * qz) * inv;
      if (dist > 1e-3 && dist < best) best = dist;
    }
    if (Number.isFinite(best)) thick[i] = best;
  }
  let min = Infinity;
  let minAt = -1;
  let sum = 0;
  let k = 0;
  let below = 0;
  for (let i = 0; i < count; i++) {
    const x = thick[i];
    if (Number.isNaN(x)) continue;
    if (x < min) {
      min = x;
      minAt = i;
    }
    sum += x;
    k++;
    if (x < limit) below++;
  }
  const colors = new Float32Array(count * 3);
  // vrcholy bez vzorku dostanou hodnotu nejbližšího vzorkovaného vrcholu v trojúhelníku (hrubě: šíření přes trojúhelníky)
  const filled = Float32Array.from(thick);
  for (let pass = 0; pass < 3; pass++)
    for (let t = 0; t < triCount; t++) {
      const [a, b, c] = [tri[t * 3], tri[t * 3 + 1], tri[t * 3 + 2]];
      const vals = [filled[a], filled[b], filled[c]].filter((x) => !Number.isNaN(x));
      if (!vals.length) continue;
      const m = vals.reduce((s, x) => s + x, 0) / vals.length;
      for (const i of [a, b, c]) if (Number.isNaN(filled[i])) filled[i] = m;
    }
  const top = Number.isFinite(min) ? Math.max(limit * 3, min * 3) : limit * 3;
  for (let i = 0; i < count; i++) {
    const x = Number.isNaN(filled[i]) ? top : filled[i];
    const t = Math.max(0, Math.min(1, (x - limit) / (top - limit)));
    // červená (tenké) → žlutá → zelená (dost)
    colors[i * 3] = t < 0.5 ? 1 : 1 - (t - 0.5) * 2;
    colors[i * 3 + 1] = t < 0.5 ? t * 2 : 1;
    colors[i * 3 + 2] = 0.15;
  }
  return { min: Number.isFinite(min) ? min : 0, avg: k ? sum / k : 0, colors, below: k ? below / k : 0, at: minAt >= 0 ? [v[minAt * 3], v[minAt * 3 + 1], v[minAt * 3 + 2]] : null };
}
