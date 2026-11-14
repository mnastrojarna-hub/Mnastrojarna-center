/**
 * Zjednodušené pružiny na listu výkresu (ISO 2162-1): obrys vinutí kreslí skrytí hran z obalu (drawing-doc.ts
 * `drawingDoc` – trubka přes vnější a vnitřní průměr po volné délce), osu pružiny `centerLines` z jeho kružnic a tady
 * se doplní čerchované osy drátu na středním průměru (vnitřní závity se nekreslí – představují je osy průřezů drátu).
 * Osy drátu se kreslí jen podél té části obrysu, kterou skrytí hran ponechalo viditelnou: pružina zakrytá deskou
 * sestavy nedostane čáry přes desku. Pohled podél osy (kružnice) dostane jen obrys a osový kříž. Čisté funkce bez jádra.
 */
import type { SpringMark } from "./drawing-doc";
import type { Vec2, Vec3 } from "./types";

type Cam = { d: Vec3; x: Vec3 };
type Poly = { pts: Vec2[]; layer: string };

const dot = (a: Vec3, b: Vec3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a: Vec3, b: Vec3): Vec3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
/** 3D bod → souřadnice obrazu (SVG, y dolů) – shodně s `proj` v drawing.ts */
const proj = (c: Cam, p: Vec3): Vec2 => {
  const up = cross(c.d, c.x);
  return [dot(p, c.x), -dot(p, up)];
};

/** Sjednocení intervalů (seřazené, překryv / mezera do `gap` se spojí). */
export function mergeSpans(spans: [number, number][], gap = 0): [number, number][] {
  const s = spans.filter(([a, b]) => b > a).sort((x, y) => x[0] - y[0]);
  const out: [number, number][] = [];
  for (const [a, b] of s) {
    const last = out[out.length - 1];
    if (last && a <= last[1] + gap) last[1] = Math.max(last[1], b);
    else out.push([a, b]);
  }
  return out;
}

/**
 * Viditelné úseky přímky obrysu (bod `q0`, jednotkový směr `u`, délka `len`, souřadnice obrazu) podle čar pohledu: úsečky
 * viditelných čar, které na přímce leží (do `tol`), dají interval parametru podél přímky.
 */
export function visibleSpans(polys: Poly[], q0: Vec2, u: Vec2, len: number, tol: number): [number, number][] {
  const n: Vec2 = [-u[1], u[0]];
  const spans: [number, number][] = [];
  for (const pl of polys) {
    if (pl.layer !== "visible") continue;
    const pts = pl.pts;
    for (let i = 1; i < pts.length; i++) {
      const a = pts[i - 1];
      const b = pts[i];
      const da = (a[0] - q0[0]) * n[0] + (a[1] - q0[1]) * n[1];
      const db = (b[0] - q0[0]) * n[0] + (b[1] - q0[1]) * n[1];
      if (Math.abs(da) > tol || Math.abs(db) > tol) continue;
      const ta = (a[0] - q0[0]) * u[0] + (a[1] - q0[1]) * u[1];
      const tb = (b[0] - q0[0]) * u[0] + (b[1] - q0[1]) * u[1];
      const lo = Math.max(0, Math.min(ta, tb));
      const hi = Math.min(len, Math.max(ta, tb));
      if (hi > lo) spans.push([lo, hi]);
    }
  }
  return mergeSpans(spans, tol);
}

/**
 * Čerchované osy drátu zjednodušených pružin v jednom pohledu (souřadnice obrazu → list přes `toSheet`). Kreslí se jen
 * v pohledech, ve kterých osa pružiny leží v rovině obrazu, a jen podél viditelných úseků obrysu na téže straně osy.
 * `minLen` = nejkratší kreslený úsek v mm modelu.
 */
export function springWireLines(cam: Cam, viewPolys: Poly[], marks: SpringMark[], toSheet: (q: Vec2) => Vec2, minLen = 0.5): Vec2[][] {
  const out: Vec2[][] = [];
  // pružiny za sebou (stejná osa v obrazu) dají tytéž čáry – každá se kreslí jednou
  const seen = new Set<string>();
  for (const m of marks) {
    if (Math.abs(dot(m.a, cam.d)) > 1e-3 || !(m.len > 0) || !(m.r > 0)) continue;
    const q0 = proj(cam, m.p);
    const q1 = proj(cam, [m.p[0] + m.a[0] * m.len, m.p[1] + m.a[1] * m.len, m.p[2] + m.a[2] * m.len]);
    const L = Math.hypot(q1[0] - q0[0], q1[1] - q0[1]);
    if (!(L > 1e-9)) continue;
    const u: Vec2 = [(q1[0] - q0[0]) / L, (q1[1] - q0[1]) / L];
    const n: Vec2 = [-u[1], u[0]];
    const tol = Math.max(0.01, 1e-5 * (L + m.ro));
    for (const side of [1, -1]) {
      const edge: Vec2 = [q0[0] + n[0] * m.ro * side, q0[1] + n[1] * m.ro * side];
      for (const [a, b] of visibleSpans(viewPolys, edge, u, L, tol)) {
        if (b - a < minLen) continue;
        const at = (t: number): Vec2 => [q0[0] + u[0] * t + n[0] * m.r * side, q0[1] + u[1] * t + n[1] * m.r * side];
        const line: Vec2[] = [toSheet(at(a)), toSheet(at(b))];
        const key = line.map((q) => `${q[0].toFixed(3)},${q[1].toFixed(3)}`).join(";");
        if (seen.has(key)) continue;
        seen.add(key);
        out.push(line);
      }
    }
  }
  return out;
}

/**
 * Leží rovinná řezná plocha (body jejích hran, 3D) celá v obalu vinutí některé zjednodušené pružiny? Takovou plochu řez
 * nešrafuje: zjednodušená pružina (ISO 2162-1) je i v řezu jen obrys a osy drátu – šrafovaný obal by vypadal jako pouzdro.
 * Plocha, která obal přesahuje (pružina srostlá s tělesem), se šrafuje celá.
 */
export function inSpringEnvelope(pts: Vec3[], marks: SpringMark[], tol: number): boolean {
  if (!pts.length) return false;
  return marks.some((m) =>
    pts.every((q) => {
      const w: Vec3 = [q[0] - m.p[0], q[1] - m.p[1], q[2] - m.p[2]];
      const t = dot(w, m.a);
      if (t < -tol || t > m.len + tol) return false;
      const rad = Math.hypot(w[0] - m.a[0] * t, w[1] - m.a[1] * t, w[2] - m.a[2] * t);
      return rad >= m.ri - tol && rad <= m.ro + tol;
    }),
  );
}
