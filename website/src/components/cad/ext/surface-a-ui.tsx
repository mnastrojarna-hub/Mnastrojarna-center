"use client";

/**
 * UI ploch třídy A (7. vlna): ikony, panel „Návaznost a křivost hran“ (analýza G0/G1/G2 s obarvením hran, hřebeny
 * křivosti, zebra a mapa křivosti) a formulář řídicích bodů (CV) se sítí bodů v 3D okně, výběrem bodu, posunem
 * čísly i gizmem. Výpočty běží ve workeru (cad.surfA → surf-query.ts).
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { tr } from "@/cad/i18n";
import { cad } from "@/cad/client";
import type { EdgeContinuity, CvInfo } from "@/cad/surf-a";
import type { SurfQueryResult } from "@/cad/surf-query";
import type { CadDoc, Vec3 } from "@/cad/types";
import { cn } from "@/lib/cn";
import { docBefore } from "../entity-multi-pick";
import { Field, PickInfo } from "../props";
import { FloatPanel } from "../ui";
import { combOverlay, continuityOverlay, cvOverlay } from "../surf-a-host";
import { setCvGizmo, setSurfOverlay, setSurfPanel } from "../surf-overlay";
import { registerIcon } from "./icons";
import { registerExtUi, type ExtFormProps } from "./registry";

// ───────── ikony ─────────
const I: Record<string, React.ReactNode> = {
  "surf-fill": (
    <>
      <path d="M4 7c4-3 12-3 16 0v10c-4 3-12 3-16 0z" opacity=".45" />
      <path d="M8 10c2.5-1.5 5.5-1.5 8 0v4c-2.5 1.5-5.5 1.5-8 0z" fill="currentColor" fillOpacity=".25" />
    </>
  ),
  "surf-blend": (
    <>
      <path d="M3 18V8" />
      <path d="M21 18V8" />
      <path d="M3 8c0-4 18-4 18 0" strokeDasharray="2 1.5" />
      <path d="M3 18c0-4 18-4 18 0" opacity=".5" />
    </>
  ),
  "surf-extend-g": (
    <>
      <path d="M3 17c3-6 6-8 10-9" />
      <path d="M13 8c3-1 5-1 8 1" strokeDasharray="2 1.5" />
      <path d="M18 6l3 3-3.5 1.5" />
    </>
  ),
  "surf-cv": (
    <>
      <path d="M4 16c4-6 12-6 16 0" />
      <path d="M4 16L8 6l8 0 4 10" strokeDasharray="1.5 1.5" opacity=".6" />
      <circle cx="8" cy="6" r="1.6" fill="currentColor" />
      <circle cx="16" cy="6" r="1.6" fill="currentColor" />
    </>
  ),
  "surf-analysis": (
    <>
      <path d="M3 18c4-8 14-8 18 0" />
      <path d="M6 15v-4M9 13V8M12 12V6M15 13V8M18 15v-4" opacity=".6" />
    </>
  ),
};
for (const [name, node] of Object.entries(I)) registerIcon(name, node);

// ───────── akce: panel analýzy ─────────
registerExtUi("surf.analysis", { action: () => setSurfPanel(true) });

const CLS_COLOR: Record<EdgeContinuity["cls"], string> = { G2: "#16a34a", G1: "#eab308", G0: "#ea580c", gap: "#dc2626", free: "#7c3aed" };
const clsText = (c: EdgeContinuity["cls"]) => (c === "gap" ? tr("mezera") : c === "free" ? tr("volná") : c);
const f3 = (v: number, d = 3) => String(Math.round(v * 10 ** d) / 10 ** d).replace(".", ",");

/** Panel „Návaznost a křivost hran“ (vykresluje cad-app, otevírá tlačítko na kartě Plochy). */
export function SurfAnalysisPanel({ doc, selEdges, surfaceMode, onSurface }: { doc: CadDoc; selEdges: number[]; surfaceMode: string; onSurface: (mode: "none" | "zebra" | "curvature") => void }) {
  const [res, setRes] = useState<Extract<SurfQueryResult, { kind: "continuity" }> | null>(null);
  const [combs, setCombs] = useState<Extract<SurfQueryResult, { kind: "comb" }> | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [scale, setScale] = useState(0);
  const run = async (fn: () => Promise<void>) => {
    setBusy(true);
    setErr(null);
    try {
      await fn();
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const analyze = (edges: number[]) =>
    run(async () => {
      const r = await cad.surfA({ kind: "continuity", edges }, doc);
      if (r.kind !== "continuity") return;
      setRes(r);
      setCombs(null);
      setSurfOverlay(continuityOverlay(r));
    });
  const comb = (edges: number[]) =>
    run(async () => {
      const r = await cad.surfA({ kind: "comb", edges, scale: scale > 0 ? scale : undefined }, doc);
      if (r.kind !== "comb") return;
      setCombs(r);
      setSurfOverlay(combOverlay(r));
    });
  const counts = useMemo(() => {
    const m: Record<string, number> = {};
    for (const c of res?.items ?? []) m[c.cls] = (m[c.cls] ?? 0) + 1;
    return m;
  }, [res]);
  const btn = "rounded border border-[#cfd6de] px-2 py-1 text-[11.5px] font-medium hover:bg-[#eef2f6] disabled:opacity-40";
  return (
    <FloatPanel title={tr("Návaznost a křivost hran")} icon="surf-analysis" tone="view" width={330} initial={{ x: 12, y: 60 }} onClose={() => setSurfPanel(false)}>
      <div data-surf-analysis className="space-y-2 text-[12px]">
        <p className="text-[11px] leading-snug text-[#6b7785]">{tr("Vyberte hrany v modelu (nebo nic = všechny). G0 = mezera ≤ 0,01 mm, G1 = úhel normál ≤ 0,1°, G2 = rozdíl křivostí ≤ 5 %.")}</p>
        <div className="flex flex-wrap gap-1.5">
          <button type="button" data-surf-act="sel" className={btn} disabled={busy || !selEdges.length} onClick={() => analyze(selEdges)}>
            {tr("Návaznost vybraných ({0})", selEdges.length)}
          </button>
          <button type="button" data-surf-act="all" className={btn} disabled={busy} onClick={() => analyze([])}>
            {tr("Všechny hrany")}
          </button>
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          <button type="button" data-surf-act="comb" className={btn} disabled={busy} onClick={() => comb(selEdges)}>
            {selEdges.length ? tr("Hřebeny vybraných hran") : tr("Hřebeny zakřivených hran")}
          </button>
          <label className="flex items-center gap-1 text-[11px] text-[#6b7785]">
            {tr("Měřítko")}
            <input type="number" min={0} step={10} value={scale} onChange={(e) => setScale(Math.max(0, Number(e.target.value) || 0))} className="h-6 w-16 rounded border border-[#cfd6de] px-1 text-right font-mono text-[11px]" title={tr("0 = automaticky")} />
          </label>
        </div>
        <div className="flex flex-wrap gap-1.5">
          {(["zebra", "curvature", "none"] as const).map((m) => (
            <button key={m} type="button" data-surf-map={m} className={cn(btn, surfaceMode === m && "border-[#0e7490] bg-[#ecfeff] text-[#0e7490]")} onClick={() => onSurface(m)}>
              {m === "zebra" ? tr("Zebra") : m === "curvature" ? tr("Mapa křivosti") : tr("Bez mapy")}
            </button>
          ))}
          <button type="button" className={btn} onClick={() => setSurfOverlay(null)}>
            {tr("Skrýt barvy a hřebeny")}
          </button>
        </div>
        {busy && <p className="text-[11px] text-[#2563eb]">{tr("Počítám…")}</p>}
        {err && <p className="text-[11px] text-[#b91c1c]">{err}</p>}
        {res && (
          <div data-surf-result>
            <div className="mb-1 flex flex-wrap gap-1">
              {(["G2", "G1", "G0", "gap", "free"] as const).map((k) => (
                <span key={k} className="flex items-center gap-1 rounded bg-[#f1f4f7] px-1.5 py-0.5 text-[10.5px]">
                  <span className="inline-block h-2 w-2 rounded-full" style={{ background: CLS_COLOR[k] }} />
                  {clsText(k)} {counts[k] ?? 0}
                </span>
              ))}
            </div>
            <div className="max-h-56 overflow-auto rounded border border-[#e3e8ee]">
              <table className="w-full font-mono text-[10.5px]">
                <thead className="sticky top-0 bg-[#f7f9fb] text-[#6b7785]">
                  <tr>
                    <th className="px-1 text-left">{tr("Hrana")}</th>
                    <th className="px-1 text-left">{tr("Třída")}</th>
                    <th className="px-1 text-right">G0 mm</th>
                    <th className="px-1 text-right">G1 °</th>
                    <th className="px-1 text-right">Δk 1/mm</th>
                  </tr>
                </thead>
                <tbody>
                  {res.items.slice(0, 300).map((c) => (
                    <tr key={c.edge} data-surf-edge={c.edge + 1} data-cls={c.cls} className="border-t border-[#edf1f5]">
                      <td className="px-1">E{c.edge + 1}</td>
                      <td className="px-1">
                        <span className="mr-1 inline-block h-2 w-2 rounded-full" style={{ background: CLS_COLOR[c.cls] }} />
                        {clsText(c.cls)}
                      </td>
                      <td className="px-1 text-right">{c.cls === "free" ? "–" : f3(c.g0, 4)}</td>
                      <td className="px-1 text-right">{c.cls === "free" ? "–" : f3(c.g1, 3)}</td>
                      <td className="px-1 text-right">{c.cls === "free" ? "–" : f3(c.g2, 5)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
        {combs && (
          <div data-surf-combs className="max-h-40 overflow-auto rounded border border-[#e3e8ee] p-1 font-mono text-[10.5px]">
            {combs.combs.length === 0 && <p>{tr("Žádná zakřivená hrana.")}</p>}
            {combs.combs.slice(0, 100).map((c) => (
              <p key={c.edge}>
                E{c.edge + 1}: k {f3(c.kMin, 5)} – {f3(c.kMax, 5)} 1/mm{c.kMax > 1e-9 ? ` (R ≥ ${f3(1 / c.kMax, 2)} mm)` : ""}
              </p>
            ))}
          </div>
        )}
      </div>
    </FloatPanel>
  );
}

// ───────── formulář řídicích bodů (CV) ─────────
type Move = { i: number; j: number; d: Vec3 };
type RowMove = { dir: "u" | "v"; index: number; d: Vec3 };
const asMoves = (v: unknown): Move[] => (Array.isArray(v) ? (v as Move[]).filter((m) => m && typeof m.i === "number" && typeof m.j === "number" && Array.isArray(m.d)) : []);
const asRows = (v: unknown): RowMove[] => (Array.isArray(v) ? (v as RowMove[]).filter((m) => m && (m.dir === "u" || m.dir === "v") && typeof m.index === "number" && Array.isArray(m.d)) : []);
const add3 = (a: Vec3, b: Vec3): Vec3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const r3 = (v: number) => Math.round(v * 1000) / 1000;

function VecInputs({ value, onChange, label }: { value: Vec3; onChange: (v: Vec3) => void; label: string }) {
  return (
    <div className="flex items-center gap-1" aria-label={label}>
      {(["X", "Y", "Z"] as const).map((ax, k) => (
        <label key={ax} className="flex items-center gap-0.5 text-[10.5px] text-[#6b7785]">
          {ax}
          <input
            type="number"
            step={0.5}
            data-cv-vec={ax}
            value={value[k]}
            onChange={(e) => {
              const n = Number(e.target.value);
              if (!Number.isFinite(n)) return;
              const next = [...value] as Vec3;
              next[k] = n;
              onChange(next);
            }}
            className="h-6 w-14 rounded border border-[#cfd6de] px-1 text-right font-mono text-[11px]"
          />
        </label>
      ))}
    </div>
  );
}

function CvForm({ f, doc, onChange }: ExtFormProps) {
  const d = f.data ?? {};
  const faces = Array.isArray(d.faces) ? (d.faces as number[]) : [];
  const face = faces[0];
  const gridU = Math.round(Number(d.gridU) || 0);
  const gridV = Math.round(Number(d.gridV) || 0);
  const grid: [number, number] | null = gridU > 0 || gridV > 0 ? [Math.max(2, gridU || 4), Math.max(2, gridV || 4)] : null;
  const moves = asMoves(d.moves);
  const rows = asRows(d.rows);
  const [info, setInfo] = useState<CvInfo | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [sel, setSel] = useState<[number, number] | null>(null);
  const [drag, setDrag] = useState(false);
  const [row, setRow] = useState<RowMove>({ dir: "u", index: 1, d: [0, 0, 1] });
  const before = useMemo(() => docBefore(doc, f), [doc, f]);
  const beforeKey = JSON.stringify(before.features);
  // načtení CV plochy před prvkem (síť po zjemnění)
  useEffect(() => {
    if (face === undefined) {
      setInfo(null);
      return;
    }
    let dead = false;
    cad.surfA({ kind: "cv", face, grid }, before).then(
      (r) => !dead && r.kind === "cv" && (setInfo(r.info), setErr(null)),
      (e) => !dead && (setInfo(null), setErr((e as Error).message)),
    );
    return () => {
      dead = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [face, gridU, gridV, beforeKey]);
  const moveOf = (i: number, j: number): Vec3 => moves.find((m) => m.i === i && m.j === j)?.d ?? [0, 0, 0];
  const setMove = (i: number, j: number, v: Vec3) => {
    const rest = moves.filter((m) => !(m.i === i && m.j === j));
    onChange({ moves: v.some((x) => Math.abs(x) > 1e-12) ? [...rest, { i, j, d: v.map(r3) as Vec3 }] : rest });
  };
  // síť CV v 3D okně: vybraný bod červeně, posunuté oranžově (na nové poloze)
  useEffect(() => {
    if (!info) {
      setSurfOverlay(null);
      return;
    }
    const shown: CvInfo = { ...info, poles: info.poles.map((rw, u) => rw.map((p, v) => {
      let q = add3(p, moveOf(u + 1, v + 1));
      for (const rm of rows) if ((rm.dir === "u" && rm.index === u + 1) || (rm.dir === "v" && rm.index === v + 1)) q = add3(q, rm.d);
      return q;
    })) };
    const moved = new Set([...moves.map((m) => `${m.i},${m.j}`)]);
    setSurfOverlay(cvOverlay(shown, sel, moved));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [info, sel, JSON.stringify(moves), JSON.stringify(rows)]);
  // gizmo pro vybraný bod: konec tažení přičte posun k vektoru bodu
  const latest = useRef({ moves, onChange });
  latest.current = { moves, onChange };
  useEffect(() => {
    if (!drag || !sel || !info) {
      setCvGizmo(null);
      return;
    }
    const base = info.poles[sel[0] - 1]?.[sel[1] - 1];
    if (!base) return;
    const cur = moveOf(sel[0], sel[1]);
    setCvGizmo({
      at: add3(base, cur),
      onMove: (delta) => {
        const ms = latest.current.moves;
        const old = ms.find((m) => m.i === sel[0] && m.j === sel[1])?.d ?? [0, 0, 0];
        const next = add3(old, delta).map(r3) as Vec3;
        latest.current.onChange({ moves: [...ms.filter((m) => !(m.i === sel[0] && m.j === sel[1])), { i: sel[0], j: sel[1], d: next }] });
      },
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [drag, sel, info, JSON.stringify(moves)]);
  useEffect(
    () => () => {
      setSurfOverlay(null);
      setCvGizmo(null);
    },
    [],
  );
  const num = "h-6 w-14 rounded border border-[#cfd6de] px-1 text-right font-mono text-[11px]";
  return (
    <div data-cv-form className="space-y-2.5 text-[12.5px]">
      <div className="space-y-1">
        <p className="text-[12.5px] font-medium">{tr("Plocha")}</p>
        <PickInfo n={faces.length} what={tr("ploch")} hint={tr("volná plocha (karta Plochy) – klik v modelu")} onClear={() => onChange({ faces: [] })} list={{ doc, f, kind: "faces", value: faces, onChange: (x) => onChange({ faces: x.slice(-1) }) }} />
      </div>
      <Field label={tr("Síť řídicích bodů (u × v, 0 = původní)")}>
        <div className="flex items-center gap-1.5">
          <input type="number" min={0} max={40} data-cv-grid="u" value={gridU} onChange={(e) => onChange({ gridU: Math.max(0, Math.min(40, Math.round(Number(e.target.value) || 0))) })} className={num} />
          <span>×</span>
          <input type="number" min={0} max={40} data-cv-grid="v" value={gridV} onChange={(e) => onChange({ gridV: Math.max(0, Math.min(40, Math.round(Number(e.target.value) || 0))) })} className={num} />
          <span className="text-[11px] text-[#6b7785]">{tr("zjemnění je přesné (stupeň 3, vložení uzlů)")}</span>
        </div>
      </Field>
      {err && <p className="text-[11.5px] text-[#b91c1c]">{err}</p>}
      {info && (
        <>
          <p className="text-[11.5px] text-[#6b7785]" data-cv-info={`${info.nu}x${info.nv}`}>
            {tr("{0} × {1} řídicích bodů, stupeň {2} × {3}", info.nu, info.nv, info.udeg, info.vdeg)}
            {!info.exact && " · " + tr("plocha není B-spline – síť je proložení (přibližně)")}
          </p>
          <div className="max-h-44 overflow-auto rounded border border-[#e3e8ee] p-1">
            <div className="grid gap-0.5" style={{ gridTemplateColumns: `repeat(${info.nv}, minmax(2.2rem, 1fr))` }}>
              {info.poles.flatMap((rw, u) =>
                rw.map((_, v) => {
                  const key = `${u + 1},${v + 1}`;
                  const isSel = sel?.[0] === u + 1 && sel?.[1] === v + 1;
                  const moved = moves.some((m) => m.i === u + 1 && m.j === v + 1);
                  return (
                    <button key={key} type="button" data-cv={key} onClick={() => setSel([u + 1, v + 1])} className={cn("rounded px-0.5 py-0.5 font-mono text-[10px]", isSel ? "bg-[#e03930] text-white" : moved ? "bg-[#fef3c7] text-[#92400e]" : "bg-[#f1f4f7] hover:bg-[#e2e8f0]")}>
                      {u + 1} {v + 1}
                    </button>
                  );
                }),
              )}
            </div>
          </div>
          {sel && info.poles[sel[0] - 1]?.[sel[1] - 1] && (
            <div className="space-y-1 rounded border border-[#e3e8ee] p-1.5" data-cv-selected={`${sel[0]},${sel[1]}`}>
              <p className="font-mono text-[11px]">
                CV [{sel[0]} {sel[1]}] = ({info.poles[sel[0] - 1][sel[1] - 1].map((x) => f3(x, 3)).join("; ")})
              </p>
              <VecInputs label={tr("Posun bodu")} value={moveOf(sel[0], sel[1])} onChange={(v) => setMove(sel[0], sel[1], v)} />
              <label className="flex items-center gap-1.5 text-[11.5px]">
                <input type="checkbox" data-cv-drag checked={drag} onChange={(e) => setDrag(e.target.checked)} className="accent-[#E03930]" />
                {tr("Táhnout bod v 3D okně (gizmo)")}
              </label>
            </div>
          )}
        </>
      )}
      <div className="space-y-1">
        <p className="text-[12.5px] font-medium">{tr("Posun řady CV")}</p>
        <div className="flex flex-wrap items-center gap-1">
          <select value={row.dir} onChange={(e) => setRow({ ...row, dir: e.target.value as "u" | "v" })} className="h-6 rounded border border-[#cfd6de] text-[11px]" aria-label={tr("Směr řady")}>
            <option value="u">u</option>
            <option value="v">v</option>
          </select>
          <input type="number" min={1} value={row.index} onChange={(e) => setRow({ ...row, index: Math.max(1, Math.round(Number(e.target.value) || 1)) })} className={num} aria-label={tr("Číslo řady")} />
          <VecInputs label={tr("Posun řady")} value={row.d} onChange={(v) => setRow({ ...row, d: v })} />
          <button type="button" data-cv-addrow className="rounded border border-[#cfd6de] px-2 py-0.5 text-[11px] hover:bg-[#eef2f6]" onClick={() => onChange({ rows: [...rows, row] })}>
            {tr("Přidat")}
          </button>
        </div>
      </div>
      {(moves.length > 0 || rows.length > 0) && (
        <ul className="space-y-0.5 font-mono text-[11px]" data-cv-list>
          {moves.map((m) => (
            <li key={`m${m.i},${m.j}`} className="flex items-center justify-between">
              <span>
                CV [{m.i} {m.j}] → ({m.d.map((x) => f3(x)).join("; ")})
              </span>
              <button type="button" className="text-[#b91c1c]" aria-label={tr("Odebrat")} onClick={() => setMove(m.i, m.j, [0, 0, 0])}>
                ×
              </button>
            </li>
          ))}
          {rows.map((rm, k) => (
            <li key={`r${k}`} className="flex items-center justify-between">
              <span>
                {tr("řada")} {rm.dir} {rm.index} → ({rm.d.map((x) => f3(x)).join("; ")})
              </span>
              <button type="button" className="text-[#b91c1c]" aria-label={tr("Odebrat")} onClick={() => onChange({ rows: rows.filter((_, i) => i !== k) })}>
                ×
              </button>
            </li>
          ))}
        </ul>
      )}
      <p className="text-[11px] leading-snug text-[#6b7785]">{tr("Ořezaná plocha (otvory, neobdélníkový obrys) se po úpravě vrátí v celém rozsahu parametrů. Plochy, které nejsou B-spline, se převedou prokladem sítí (rovina přesně).")}</p>
    </div>
  );
}
registerExtUi("surf.cv", { Form: CvForm });

export {};
