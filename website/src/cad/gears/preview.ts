/**
 * Profil → lomená čára / cesta SVG (náhled v tabulce, miniatury v galerii, testy). Křivkové úseky se vyhodnocují stejným
 * kubickým splinem se zadanými derivacemi na koncích, jaký z bodů postaví jádro (GeomAPI_Interpolate).
 */
import { arcSweep, rot2, TAU } from "./num";
import type { Profile2D, Seg2, Vec2 } from "./types";

type Curve = Extract<Seg2, { t: "curve" }>;

/** vyhodnocení křivkového úseku: kubický spline přes body s derivacemi na koncích (parametr = `params`) */
export function curveEval(s: Curve): (p: number) => Vec2 {
  const n = s.pts.length - 1;
  const t = s.params;
  const h = Array.from({ length: n }, (_, i) => t[i + 1] - t[i]);
  const m: Vec2[] = s.pts.map(() => [0, 0]);
  m[0] = s.d0;
  m[n] = s.d1;
  if (n > 1) {
    // třídiagonální soustava pro derivace ve vnitřních uzlech (C2 spline)
    for (let c = 0; c < 2; c++) {
      const a: number[] = [];
      const b: number[] = [];
      const cc: number[] = [];
      const d: number[] = [];
      for (let i = 1; i < n; i++) {
        a.push(1 / h[i - 1]);
        b.push(2 * (1 / h[i - 1] + 1 / h[i]));
        cc.push(1 / h[i]);
        d.push(3 * ((s.pts[i][c] - s.pts[i - 1][c]) / (h[i - 1] * h[i - 1]) + (s.pts[i + 1][c] - s.pts[i][c]) / (h[i] * h[i])));
      }
      d[0] -= a[0] * m[0][c];
      d[n - 2] -= cc[n - 2] * m[n][c];
      for (let i = 1; i < n - 1; i++) {
        const w = a[i] / b[i - 1];
        b[i] -= w * cc[i - 1];
        d[i] -= w * d[i - 1];
      }
      const x = new Array<number>(n - 1).fill(0);
      x[n - 2] = d[n - 2] / b[n - 2];
      for (let i = n - 3; i >= 0; i--) x[i] = (d[i] - cc[i] * x[i + 1]) / b[i];
      for (let i = 1; i < n; i++) m[i][c] = x[i - 1];
    }
  }
  return (p: number): Vec2 => {
    let i = 0;
    while (i < n - 1 && p > t[i + 1]) i++;
    const u = (p - t[i]) / h[i];
    const h00 = 2 * u ** 3 - 3 * u ** 2 + 1;
    const h10 = u ** 3 - 2 * u ** 2 + u;
    const h01 = -2 * u ** 3 + 3 * u ** 2;
    const h11 = u ** 3 - u ** 2;
    return [0, 1].map((c) => h00 * s.pts[i][c] + h10 * h[i] * m[i][c] + h01 * s.pts[i + 1][c] + h11 * h[i] * m[i + 1][c]) as Vec2;
  };
}

/** body jednoho úseku od začátku (včetně) po konec (bez něj); `tol` = největší odchylka tětivy */
export function segPoints(s: Seg2, tol = 0.01): Vec2[] {
  if (s.t === "line") return [s.a];
  if (s.t === "arc") {
    const sw = arcSweep(s);
    const step = 2 * Math.acos(Math.max(-1, 1 - Math.min(tol, s.r) / s.r)) || 0.1;
    const n = Math.max(1, Math.ceil(Math.abs(sw) / step));
    return Array.from({ length: n }, (_, i) => [s.c[0] + s.r * Math.cos(s.a0 + (sw * i) / n), s.c[1] + s.r * Math.sin(s.a0 + (sw * i) / n)] as Vec2);
  }
  const f = curveEval(s);
  const out: Vec2[] = [];
  for (let i = 0; i + 1 < s.pts.length; i++) {
    const chord = Math.hypot(s.pts[i + 1][0] - s.pts[i][0], s.pts[i + 1][1] - s.pts[i][1]);
    const k = Math.max(1, Math.min(64, Math.ceil(Math.sqrt(chord / Math.max(tol, 1e-6)) / 2)));
    for (let j = 0; j < k; j++) out.push(j === 0 ? s.pts[i] : f(s.params[i] + ((s.params[i + 1] - s.params[i]) * j) / k));
  }
  return out;
}

/** posun / otočení bodů pro k-tý zub */
const place = (p: Profile2D, k: number) => (q: Vec2): Vec2 => (p.pitch ? [q[0] + k * p.pitch, q[1]] : rot2(q, (TAU * k) / p.count));

/** Celý obrys profilu jako uzavřená lomená čára (bez opakování prvního bodu). Hřeben: horní obrys všech zubů (otevřený). */
export function profilePolyline(p: Profile2D, tol = 0.01): Vec2[] {
  const one = p.tooth.flatMap((s) => segPoints(s, tol));
  const out: Vec2[] = [];
  for (let k = 0; k < p.count; k++) out.push(...one.map(place(p, k)));
  if (p.pitch) {
    const last = p.tooth[p.tooth.length - 1];
    const e = last.t === "line" ? last.b : last.t === "arc" ? ([last.c[0] + last.r * Math.cos(last.a1), last.c[1] + last.r * Math.sin(last.a1)] as Vec2) : last.pts[last.pts.length - 1];
    out.push(place(p, p.count - 1)(e));
  }
  return out;
}

/** plocha uzavřené lomené čáry (kladná proti směru hodin) */
export function polygonArea(pts: Vec2[]): number {
  let a = 0;
  for (let i = 0; i < pts.length; i++) {
    const q = pts[(i + 1) % pts.length];
    a += pts[i][0] * q[1] - q[0] * pts[i][1];
  }
  return a / 2;
}

/** Cesta SVG celého profilu (osa Y dolů → y se obrací); `scale` = px na mm. */
export function profileSvgPath(p: Profile2D, scale = 1, tol = 0.01): string {
  const pts = profilePolyline(p, tol / Math.max(scale, 1e-9));
  if (!pts.length) return "";
  const f = (v: number) => (Math.round(v * scale * 1000) / 1000).toString();
  return "M" + pts.map((q) => `${f(q[0])} ${f(-q[1])}`).join("L") + (p.pitch ? "" : "Z");
}
