"use client";

/**
 * Živý náhled pružiny z boku (bez jádra): střednice drátu ze `springPathOf` promítnutá do roviny XZ jako tlustá čára (zadní
 * polovina závitů světlejší), broušené konce oříznuté rovinami 0 a L0, kóty L0 / De / d. Talířová pružina = řez sloupcem.
 */
import { useMemo } from "react";
import { tr } from "@/cad/i18n";
import { discOf, discSection, fmt, kindOfExt, springCalc, springPathOf, type SpringData } from "@/cad/springs";

const W = 240;
const H = 300;
const PAD = 34;

export function SpringPreview({ ext, data, small }: { ext: string; data: SpringData; small?: boolean }) {
  const view = useMemo(() => {
    const k = kindOfExt(ext);
    if (!k) return null;
    const c = springCalc(ext, data);
    if (k.kind === "disc") {
      const o = discOf(data);
      if (!o) return null;
      const polys: [number, number][][] = [];
      let z = 0;
      for (let i = 0; i < o.ns; i++) {
        for (let j = 0; j < o.np; j++) polys.push(discSection({ De: o.De, Di: o.Di, t: o.t, h0: o.h0, z: z + j * o.t, up: i % 2 === 0 }));
        z += o.h0 + o.np * o.t;
      }
      return { kind: k.kind, polys, lines: [] as { a: [number, number]; b: [number, number]; back: boolean }[], d: o.t, xmin: -o.De / 2, xmax: o.De / 2, zmin: 0, zmax: z, L: z, De: o.De, clip: null as [number, number] | null, c };
    }
    const p = springPathOf(ext, data, undefined, small ? 16 : 28);
    if (!p) return null;
    const lines: { a: [number, number]; b: [number, number]; back: boolean }[] = [];
    let xmin = Infinity;
    let xmax = -Infinity;
    let zmin = Infinity;
    let zmax = -Infinity;
    for (let i = 1; i < p.pts.length; i++) {
      const a = p.pts[i - 1];
      const b = p.pts[i];
      lines.push({ a: [a[0], a[2]], b: [b[0], b[2]], back: (a[1] + b[1]) / 2 < 0 });
    }
    for (const q of p.pts) {
      xmin = Math.min(xmin, q[0] - p.d / 2);
      xmax = Math.max(xmax, q[0] + p.d / 2);
      zmin = Math.min(zmin, q[2] - p.d / 2);
      zmax = Math.max(zmax, q[2] + p.d / 2);
    }
    if (p.clip) {
      zmin = Math.max(zmin, p.clip[0]);
      zmax = Math.min(zmax, p.clip[1]);
    }
    const De = c.v.De ?? xmax - xmin;
    return { kind: k.kind, polys: [] as [number, number][][], lines, d: p.d, xmin, xmax, zmin, zmax, L: c.v.L0, De, clip: p.clip ?? null, c };
  }, [ext, data, small]);
  const w = small ? 88 : W;
  const h = small ? 110 : H;
  const pad = small ? 6 : PAD;
  if (!view) return <div className="grid place-items-center text-[11px] text-[#6b7785]" style={{ width: w, height: h }}>{small ? "" : tr("Doplňte rozměry – náhled se ukáže tady.")}</div>;
  const sx = (w - 2 * pad) / Math.max(1e-6, view.xmax - view.xmin);
  const sz = (h - 2 * pad) / Math.max(1e-6, view.zmax - view.zmin);
  const s = Math.min(sx, sz);
  const cx = w / 2 - ((view.xmin + view.xmax) / 2) * s;
  const cz = h / 2 + ((view.zmin + view.zmax) / 2) * s;
  const X = (x: number) => cx + x * s;
  const Z = (z: number) => cz - z * s;
  const clipId = `spclip-${Math.round(view.L ?? 0)}-${Math.round(view.De ?? 0)}-${small ? 1 : 0}`;
  return (
    <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`} data-spring-preview className="select-none">
      {view.clip && (
        <defs>
          <clipPath id={clipId}>
            <rect x={0} y={Z(view.clip[1])} width={w} height={Z(view.clip[0]) - Z(view.clip[1])} />
          </clipPath>
        </defs>
      )}
      <g clipPath={view.clip ? `url(#${clipId})` : undefined} strokeLinecap="round">
        {view.lines
          .filter((l) => l.back)
          .map((l, i) => (
            <line key={`b${i}`} x1={X(l.a[0])} y1={Z(l.a[1])} x2={X(l.b[0])} y2={Z(l.b[1])} stroke="#9aa6b2" strokeWidth={Math.max(1, view.d * s)} />
          ))}
        {view.lines
          .filter((l) => !l.back)
          .map((l, i) => (
            <line key={`f${i}`} x1={X(l.a[0])} y1={Z(l.a[1])} x2={X(l.b[0])} y2={Z(l.b[1])} stroke="#4b5866" strokeWidth={Math.max(1, view.d * s)} />
          ))}
        {view.polys.map((pg, i) => (
          <g key={i}>
            <polygon points={pg.map(([r, z]) => `${X(r)},${Z(z)}`).join(" ")} fill="#6b7785" stroke="#26303b" strokeWidth={0.6} />
            <polygon points={pg.map(([r, z]) => `${X(-r)},${Z(z)}`).join(" ")} fill="#6b7785" stroke="#26303b" strokeWidth={0.6} />
          </g>
        ))}
      </g>
      {!small && view.clip && (
        <g stroke="#E03930" strokeWidth={1}>
          <line x1={X(view.xmin) - 6} y1={Z(view.clip[0])} x2={X(view.xmax) + 6} y2={Z(view.clip[0])} />
          <line x1={X(view.xmin) - 6} y1={Z(view.clip[1])} x2={X(view.xmax) + 6} y2={Z(view.clip[1])} />
        </g>
      )}
      {!small && view.L !== undefined && (
        <g fontSize={10.5} fill="#26303b" stroke="none">
          {/* kóta L0 vpravo */}
          <line x1={X(view.xmax) + 14} y1={Z(view.kind === "extension" ? 0 : view.zmin)} x2={X(view.xmax) + 14} y2={Z(view.kind === "extension" ? view.L : view.zmax)} stroke="#26303b" strokeWidth={0.8} markerStart="none" />
          <text x={X(view.xmax) + 17} y={(Z(view.zmin) + Z(view.zmax)) / 2} dominantBaseline="middle">
            {`L0 ${fmt(view.L)}`}
          </text>
          {/* kóta De dole */}
          <line x1={X(-view.De / 2)} y1={h - 12} x2={X(view.De / 2)} y2={h - 12} stroke="#26303b" strokeWidth={0.8} />
          <text x={w / 2} y={h - 2} textAnchor="middle">
            {`${view.kind === "disc" ? "De" : "De"} ${fmt(view.De)}`}
          </text>
          <text x={4} y={12}>{`${view.kind === "disc" ? "t" : "d"} ${fmt(view.d)}`}</text>
        </g>
      )}
    </svg>
  );
}
