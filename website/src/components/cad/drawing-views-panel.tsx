"use client";

/**
 * Výkresové prostředí – další pohledy a řezy (vlna 7): nástroje na listu (pomocný pohled z hrany, zalomený a natočený
 * řez, částečný řez, přerušení), seznamy s úpravami, uložení ISO 286 (zobrazení úchylek, Tabulka uložení, výběr pole
 * tolerance u kóty), trojúhelníky revizí a zóny listu. Stav listu drží výkresové prostředí (drawing-workspace.tsx) –
 * tady jsou jen nástroje a ovládací prvky; jádro je v cad/drawing-views.ts a cad/drawing-fits.ts.
 */
import { tr } from "@/cad/i18n";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { annToSheet, pickViewEnt, sheetToAnn, VIEW_LABEL, type DrawingMeta, type DrawingOptions, type DrawingResult, type PlacedView, type RevisionItem, type ViewKey } from "@/cad/drawing";
import { describeFit, fitSuffix, HOLE_LETTERS, parseFit, PREFERRED_FITS, SHAFT_LETTERS, type FitShow } from "@/cad/drawing-fits";
import { splitSuffix } from "@/cad/drawing-agent";
import { dimValue } from "@/cad/drawing-marks";
import { nextViewLetter, viewNameOf } from "@/cad/drawing-views-agent";
import { uid, type DrawingAnnotation, type Vec2 } from "@/cad/types";
import { cn } from "@/lib/cn";
import { TipBox, microTipsEnabled } from "./micro-tip";

export type ViewTool = "aux" | "stepped" | "aligned" | "bo" | "break";
const TOOLS: { id: ViewTool; label: () => string; hint: () => string }[] = [
  { id: "aux", label: () => tr("Pomocný pohled"), hint: () => tr("pohled kolmo na šikmou plochu: klik na její hranu v pohledu, pak umístění (Enter = zarovnaně)") },
  { id: "stepped", label: () => tr("Zalomený řez"), hint: () => tr("body čáry řezu v pohledu (úseky se přichytí vodorovně / svisle), Enter = hotovo") },
  { id: "aligned", label: () => tr("Natočený řez"), hint: () => tr("3 body: konec hlavního ramena, vrchol (osa otočení), konec šikmého ramena") },
  { id: "bo", label: () => tr("Částečný řez"), hint: () => tr("body oblasti v pohledu (≥ 3), Enter nebo klik na první bod = hotovo") },
  { id: "break", label: () => tr("Přerušení"), hint: () => tr("2 kliky v pohledu: začátek a konec vynechané části (směr podle delšího posunu)") },
];
const PRINCIPAL = new Set(["front", "top", "left", "right", "back", "bottom"]);
const fmt = (n: number) => String(Math.round(n * 100) / 100).replace(".", ",");

type Params = {
  res: DrawingResult | null;
  opts: DrawingOptions;
  set: <K extends keyof DrawingOptions>(k: K, v: DrawingOptions[K]) => void;
  flash: (m: string) => void;
  /** px náhledu na mm listu */
  zoom: number;
  /** spuštění nástroje vypne nástroj kót / poznámek */
  onStart: () => void;
};

/** Nástroje dalších pohledů na listu: stav rozpracovaného zadání, kliknutí, Enter / Esc a překryv. */
export function useViewTools(p: Params) {
  const [tool, setToolRaw] = useState<ViewTool | null>(null);
  const [view, setView] = useState<string | null>(null);
  const [pts, setPts] = useState<Vec2[]>([]);
  const [edge, setEdge] = useState<[Vec2, Vec2] | null>(null);
  const [hover, setHover] = useState<Vec2 | null>(null);
  const [depth, setDepth] = useState(10);
  const [spline, setSpline] = useState(true);
  const [gap, setGap] = useState(8);
  const [style, setStyle] = useState<"zigzag" | "wave">("zigzag");
  const reset = () => {
    setView(null);
    setPts([]);
    setEdge(null);
  };
  const setTool = (t: ViewTool | null) => {
    reset();
    setToolRaw(t);
    if (t) p.onStart();
  };
  const views = p.res?.views ?? [];
  const tol = 10 / Math.max(0.1, p.zoom);
  const allowed = (k: string) => (tool === "bo" ? PRINCIPAL.has(k) : PRINCIPAL.has(k) || k === "section");
  /** pohled pod kurzorem; u čáry řezu a přerušení i kousek vedle pohledu (čára řezu začíná mimo obrys) – nejbližší pohled */
  const viewUnder = (q: Vec2, margin = tol): PlacedView | null => {
    let best: PlacedView | null = null;
    let bd = Infinity;
    for (const v of views) {
      if (!allowed(v.key)) continue;
      const d = Math.hypot(Math.max(v.px - q[0], 0, q[0] - (v.px + v.w * v.s)), Math.max(v.py - q[1], 0, q[1] - (v.py + v.h * v.s)));
      if (d <= margin && d < bd) {
        bd = d;
        best = v;
      }
    }
    return best;
  };
  const pv = view ? views.find((v) => v.key === view) ?? null : null;
  /** vodorovné / svislé úseky zalomeného řezu (do ~10°) */
  const ortho = (last: Vec2 | undefined, q: Vec2): Vec2 => {
    if (!last || tool !== "stepped") return q;
    const dx = q[0] - last[0];
    const dy = q[1] - last[1];
    if (Math.abs(dy) < Math.abs(dx) * 0.18) return [q[0], last[1]];
    if (Math.abs(dx) < Math.abs(dy) * 0.18) return [last[0], q[1]];
    return q;
  };
  const done = (msg: string) => {
    p.flash(msg);
    setTool(null);
  };
  const createAux = (at?: Vec2) => {
    if (!view || !edge) return;
    const label = nextViewLetter(p.opts);
    p.set("aux", [...(p.opts.aux ?? []), { id: uid(), label, parent: view, edge, ...(at ? { at } : {}) }]);
    done(tr("Pomocný pohled {0} vložen.", label));
  };
  const createCut = (kind: "stepped" | "aligned", list: Vec2[]) => {
    if (!view) return;
    const label = nextViewLetter(p.opts);
    p.set("cuts", [...(p.opts.cuts ?? []), { id: uid(), label, parent: view, kind, pts: list }]);
    done(tr("Řez {0}–{0} vložen.", label));
  };
  const createBo = (list: Vec2[]) => {
    if (!view) return;
    p.set("brokenOut", [...(p.opts.brokenOut ?? []), { id: uid(), view, pts: list, depth, ...(spline ? { spline: true } : {}) }]);
    done(tr("Částečný řez vložen."));
  };
  const createBreak = (a: Vec2, b: Vec2) => {
    if (!view) return;
    const horiz = Math.abs(b[0] - a[0]) >= Math.abs(b[1] - a[1]);
    // osa x = souřadnice pohledu u, osa y = souřadnice nahoru (−v)
    const [f, t] = horiz ? [a[0], b[0]] : [-a[1], -b[1]];
    if (Math.abs(t - f) < 1e-3) return p.flash(tr("Přerušení: zvolte dva různé body."));
    p.set("breaks", [...(p.opts.breaks ?? []), { id: uid(), view, axis: horiz ? "x" : "y", from: Math.min(f, t), to: Math.max(f, t), gap, style }]);
    done(tr("Přerušení vloženo."));
  };
  const click = (q: Vec2) => {
    if (!tool || !p.res) return;
    if (tool === "aux") {
      if (edge) return createAux(q);
      const v = viewUnder(q);
      const pick = v ? pickViewEnt(v.ents ?? [], sheetToAnn(v, q), tol / v.s, "line") : null;
      if (!v || pick?.kind !== "line") return p.flash(tr("Klikněte na hranu šikmé plochy v pohledu."));
      setView(v.key);
      setEdge([pick.a, pick.b]);
      return;
    }
    const v0 = pv ?? viewUnder(q, Math.max(tol, 20));
    if (!v0) return p.flash(tr("Klikněte do pohledu."));
    if (!view) setView(v0.key);
    const local = ortho(pts[pts.length - 1], sheetToAnn(v0, q));
    // částečný řez: klik na první bod uzavře oblast
    if (tool === "bo" && pts.length >= 3) {
      const first = annToSheet(views, v0.key, pts[0]);
      if (Math.hypot(first[0] - q[0], first[1] - q[1]) < tol) return createBo(pts);
    }
    const next = [...pts, local];
    if (tool === "aligned" && next.length === 3) return createCut("aligned", next);
    if (tool === "break" && next.length === 2) return createBreak(next[0], next[1]);
    setPts(next);
  };
  /** Enter: dokončit zadání; vrací true, když ho nástroj zpracoval */
  const finish = (): boolean => {
    if (!tool) return false;
    if (tool === "aux" && edge) createAux();
    else if (tool === "stepped" && pts.length >= 2) createCut("stepped", pts);
    else if (tool === "bo" && pts.length >= 3) createBo(pts);
    else p.flash(tr("Zadání ještě není úplné."));
    return true;
  };
  /** Esc: zrušit rozpracované zadání, druhý Esc nástroj vypne */
  const cancel = (): boolean => {
    if (!tool) return false;
    if (pts.length || edge) reset();
    else setTool(null);
    return true;
  };
  const move = (q: Vec2 | null) => setHover(q);
  const step = tool === "aux" ? (edge ? 1 : 0) : pts.length;
  const hint = tool ? `${TOOLS.find((t) => t.id === tool)!.hint()} (${step})` : "";
  return { tool, setTool, click, finish, cancel, move, hint, view, pts, edge, hover, depth, setDepth, spline, setSpline, gap, setGap, style, setStyle, ortho };
}
export type ViewTools = ReturnType<typeof useViewTools>;

/** Překryv nástroje na listu (mm listu): vybraná hrana, body čáry řezu / oblasti a pomocná čára ke kurzoru. */
export function ViewToolsOverlay({ vt, res, tf }: { vt: ViewTools; res: DrawingResult; tf: { x: number; y: number; z: number } }) {
  if (!vt.tool) return null;
  const S = (q: Vec2) => (vt.view ? annToSheet(res.views, vt.view, q) : q);
  const pts = vt.pts.map(S);
  const pv = vt.view ? res.views.find((v) => v.key === vt.view) : null;
  let hover = vt.hover;
  if (hover && pv && vt.pts.length) hover = annToSheet(res.views, pv.key, vt.ortho(vt.pts[vt.pts.length - 1], sheetToAnn(pv, hover)));
  const w = 1 / tf.z;
  return (
    <svg data-view-tool-overlay className="pointer-events-none absolute left-0 top-0 overflow-visible" width={res.sheet.w * tf.z} height={res.sheet.h * tf.z} style={{ transform: `translate(${tf.x}px,${tf.y}px)` }} viewBox={`0 0 ${res.sheet.w} ${res.sheet.h}`}>
      {vt.edge && <polyline points={vt.edge.map(S).map((q) => q.join(",")).join(" ")} fill="none" stroke="#E03930" strokeWidth={3 * w} />}
      {pts.length > 0 && <polyline points={[...pts, ...(hover ? [hover] : [])].map((q) => q.join(",")).join(" ")} fill="none" stroke="#E03930" strokeWidth={1.5 * w} strokeDasharray={`${4 * w} ${3 * w}`} />}
      {pts.map((q, i) => (
        <circle key={i} cx={q[0]} cy={q[1]} r={3 * w} fill="#E03930" />
      ))}
      {hover && <circle cx={hover[0]} cy={hover[1]} r={3 * w} fill="none" stroke="#f59e0b" strokeWidth={w} />}
    </svg>
  );
}

const inputCls = "w-full rounded-md border border-ink-700/15 bg-white px-2 py-1 text-[12.5px] outline-none focus:border-brand";
function Num({ value, onChange, title, w = "w-14" }: { value: number; onChange: (n: number) => void; title?: string; w?: string }) {
  const [t, setT] = useState(fmt(value));
  useEffect(() => setT(fmt(value)), [value]);
  const commit = () => {
    const n = Number(t.replace(",", "."));
    if (Number.isFinite(n)) onChange(n);
    else setT(fmt(value));
  };
  return <input title={title} aria-label={title} className={cn("rounded border border-ink-700/15 px-1 py-0.5 font-mono text-[11px]", w)} value={t} inputMode="decimal" onChange={(e) => setT(e.target.value)} onBlur={commit} onKeyDown={(e) => e.key === "Enter" && commit()} />;
}
function Tick({ checked, onChange, children, title }: { checked: boolean; onChange: (v: boolean) => void; children: React.ReactNode; title?: string }) {
  return (
    <label title={title} className="flex shrink-0 cursor-pointer items-center gap-1 text-[11px] text-ink-700/70">
      <input type="checkbox" className="h-3 w-3 accent-[#E03930]" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      {children}
    </label>
  );
}
const Del = ({ onClick, title }: { onClick: () => void; title: string }) => (
  <button type="button" title={title} onClick={onClick} className="ml-auto shrink-0 px-1 text-ink-700/40 hover:text-brand">
    ×
  </button>
);
const viewLabel = (k: string) => (VIEW_LABEL[k as ViewKey] ? tr(VIEW_LABEL[k as ViewKey]) : viewNameOf(k));

/** Sekce „Pomocné pohledy a řezy“: tlačítka nástrojů, nápověda a seznamy s úpravami. */
export function ViewToolsSection({ vt, opts, set }: { vt: ViewTools; opts: DrawingOptions; set: Params["set"] }) {
  const upd = <K extends "aux" | "cuts" | "brokenOut" | "breaks">(k: K, i: number, patch: Partial<NonNullable<DrawingOptions[K]>[number]>) => set(k, (opts[k] ?? []).map((x, j) => (j === i ? { ...x, ...patch } : x)) as DrawingOptions[K]);
  const del = <K extends "aux" | "cuts" | "brokenOut" | "breaks">(k: K, i: number) => set(k, (opts[k] ?? []).filter((_, j) => j !== i) as DrawingOptions[K]);
  return (
    <section data-view-tools className="space-y-2 border-b border-ink-700/10 px-4 py-3">
      <h3 className="text-[10.5px] font-semibold uppercase tracking-[0.16em] text-ink-700/45">{tr("Pomocné pohledy a řezy")}</h3>
      <div className="grid grid-cols-2 gap-1">
        {TOOLS.map((t) => (
          // mikronávod: klíč „drawing-ws/vt-<id>“ (src/cad/help/tips)
          <TipBox key={t.id} tip={{ id: `vt-${t.id}`, ctx: "drawing-ws", label: t.label(), hint: t.hint() }} className="flex">
            <button type="button" data-view-tool={t.id} title={microTipsEnabled() ? undefined : t.hint()} onClick={() => vt.setTool(vt.tool === t.id ? null : t.id)} className={cn("w-full rounded-md border px-1 py-1.5 text-[11.5px] leading-tight", vt.tool === t.id ? "border-brand bg-brand/10 font-semibold text-brand" : "border-ink-700/15 hover:bg-steel-100")}>
              {t.label()}
            </button>
          </TipBox>
        ))}
      </div>
      {vt.tool && (
        <div data-view-tool-active className="rounded-md border border-brand/30 bg-brand/5 px-2 py-1 text-[11px] leading-snug">
          <strong className="text-brand">{TOOLS.find((t) => t.id === vt.tool)!.label()}</strong> · {vt.hint} · {tr("Esc ruší")}
          {vt.tool === "bo" && (
            <div className="mt-1 flex items-center gap-2">
              <span>{tr("Hloubka")}</span>
              <Num value={vt.depth} onChange={(n) => vt.setDepth(Math.max(0.1, n))} title={tr("Hloubka částečného řezu od přední strany [mm]")} />
              <Tick checked={vt.spline} onChange={vt.setSpline}>{tr("hladká hranice")}</Tick>
            </div>
          )}
          {vt.tool === "break" && (
            <div className="mt-1 flex items-center gap-2">
              <span>{tr("Mezera")}</span>
              <Num value={vt.gap} onChange={(n) => vt.setGap(Math.max(1, n))} title={tr("Mezera mezi částmi na listu [mm]")} />
              <Tick checked={vt.style === "wave"} onChange={(v) => vt.setStyle(v ? "wave" : "zigzag")}>{tr("vlnovka")}</Tick>
            </div>
          )}
          {(vt.tool === "stepped" || vt.tool === "bo" || (vt.tool === "aux" && vt.edge)) && (
            <button type="button" data-view-tool-finish onClick={() => vt.finish()} className="mt-1 rounded border border-brand/40 px-2 py-0.5 text-brand hover:bg-brand/10">
              {tr("Hotovo (Enter)")}
            </button>
          )}
        </div>
      )}
      {(opts.aux ?? []).map((a, i) => (
        <div key={a.id} data-aux-row={a.label} className="flex items-center gap-2 text-[12px]">
          <span className="w-16 shrink-0 font-semibold">{tr("Pohled {0}", a.label)}</span>
          <span className="min-w-0 truncate text-ink-700/55">{a.parent ? viewLabel(a.parent) : a.face != null ? `F${a.face}` : tr("směr")}</span>
          {a.edge && (
            <Tick checked={a.mode === "along"} onChange={(v) => upd("aux", i, { mode: v ? "along" : "normal" })} title={tr("Pohled podél hrany místo kolmo na ni")}>
              {tr("podél")}
            </Tick>
          )}
          <Tick checked={!!a.flip} onChange={(v) => upd("aux", i, { flip: v })} title={tr("Pohled z opačné strany")}>
            {tr("otočit")}
          </Tick>
          <Del title={tr("Smazat pohled")} onClick={() => del("aux", i)} />
        </div>
      ))}
      {(opts.cuts ?? []).map((c, i) => (
        <div key={c.id} data-cut-row={c.label} className="flex items-center gap-2 text-[12px]">
          <span className="w-16 shrink-0 font-semibold">{`${c.label}–${c.label}`}</span>
          <span className="min-w-0 truncate text-ink-700/55">
            {c.kind === "stepped" ? tr("zalomený") : tr("natočený")} · {viewLabel(c.parent)}
          </span>
          <Tick checked={!!c.flip} onChange={(v) => upd("cuts", i, { flip: v })} title={tr("Pohled na řez z druhé strany")}>
            {tr("otočit")}
          </Tick>
          <Del title={tr("Smazat řez")} onClick={() => del("cuts", i)} />
        </div>
      ))}
      {(opts.brokenOut ?? []).map((b, i) => (
        <div key={b.id} data-bo-row={i + 1} className="flex items-center gap-2 text-[12px]">
          <span className="w-16 shrink-0 font-semibold">{tr("Částečný {0}", i + 1)}</span>
          <span className="min-w-0 truncate text-ink-700/55">{viewLabel(b.view)}</span>
          <Num value={b.depth} onChange={(n) => upd("brokenOut", i, { depth: Math.max(0.1, n) })} title={tr("Hloubka částečného řezu od přední strany [mm]")} w="w-12" />
          <Tick checked={!!b.spline} onChange={(v) => upd("brokenOut", i, { spline: v })} title={tr("Hladká hranice (křivka od ruky)")}>
            {tr("křivka")}
          </Tick>
          <Del title={tr("Smazat částečný řez")} onClick={() => del("brokenOut", i)} />
        </div>
      ))}
      {(opts.breaks ?? []).map((b, i) => (
        <div key={b.id} data-break-row={i + 1} className="flex flex-wrap items-center gap-1.5 text-[12px]">
          <span className="w-16 shrink-0 font-semibold">{tr("Přerušení {0}", i + 1)}</span>
          <span className="text-ink-700/55">
            {viewLabel(b.view)} {b.axis}
          </span>
          <Num value={b.from} onChange={(n) => upd("breaks", i, { from: n })} title={tr("Začátek vynechané části [mm modelu]")} w="w-12" />
          <span>…</span>
          <Num value={b.to} onChange={(n) => upd("breaks", i, { to: n })} title={tr("Konec vynechané části [mm modelu]")} w="w-12" />
          <Tick checked={b.style === "wave"} onChange={(v) => upd("breaks", i, { style: v ? "wave" : "zigzag" })} title={tr("Vlnovka místo cikcaku")}>
            {tr("vlna")}
          </Tick>
          <Del title={tr("Smazat přerušení")} onClick={() => del("breaks", i)} />
        </div>
      ))}
      {!opts.aux?.length && !opts.cuts?.length && !opts.brokenOut?.length && !opts.breaks?.length && !vt.tool && (
        <p className="text-[10.5px] leading-snug text-ink-700/50">{tr("Pomocný pohled ukáže šikmou plochu ve skutečném tvaru; zalomený a natočený řez vedou čáru řezu přes několik prvků; přerušení zkrátí dlouhý díl – kóty drží skutečnou délku.")}</p>
      )}
    </section>
  );
}

/** Sekce „Uložení, revize a zóny“: zobrazení úchylek, Tabulka uložení, zóny listu, trojúhelníky revizí a dotaz na uložení. */
export function FitsSection({ opts, set, meta, setMeta }: { opts: DrawingOptions; set: Params["set"]; meta: DrawingMeta; setMeta: (p: Partial<DrawingMeta>) => void }) {
  const [q, setQ] = useState({ size: "40", code: "H7/g6" });
  let info = "";
  try {
    info = describeFit(Number(q.size.replace(",", ".")), q.code);
  } catch (e) {
    info = (e as Error).message;
  }
  const revs: RevisionItem[] = meta.revisions ?? [];
  return (
    <section data-fits-section className="space-y-2 border-b border-ink-700/10 px-4 py-3">
      <h3 className="text-[10.5px] font-semibold uppercase tracking-[0.16em] text-ink-700/45">{tr("Uložení, revize a zóny")}</h3>
      <div>
        <span className="mb-0.5 block text-[11px] text-ink-700/55">{tr("Kóty s polem tolerance (H7, g6)")}</span>
        <div className="flex rounded-md bg-steel-100 p-0.5" data-fit-show>
          {(["code", "dev", "limits"] as FitShow[]).map((v) => (
            <button key={v} type="button" onClick={() => set("fitShow", v)} className={cn("flex-1 rounded px-1.5 py-1 text-[11.5px]", (opts.fitShow ?? "dev") === v ? "bg-white font-semibold shadow-sm" : "text-ink-700/60")}>
              {v === "code" ? tr("Značka") : v === "dev" ? tr("+ úchylky") : tr("+ mezní")}
            </button>
          ))}
        </div>
      </div>
      <label className="flex cursor-pointer items-center gap-2 rounded px-1 py-0.5 hover:bg-steel-100">
        <input type="checkbox" data-fit-table className="h-3.5 w-3.5 accent-[#E03930]" checked={!!opts.fitTable} onChange={(e) => set("fitTable", e.target.checked)} />
        <span className="text-[12px]">{tr("Tabulka uložení na listu")}</span>
      </label>
      <label className="flex cursor-pointer items-center gap-2 rounded px-1 py-0.5 hover:bg-steel-100">
        <input type="checkbox" data-zones className="h-3.5 w-3.5 accent-[#E03930]" checked={!!opts.zones} onChange={(e) => set("zones", e.target.checked)} />
        <span className="text-[12px]">{tr("Zóny listu (ISO 5457) a sloupec Zóna v revizích")}</span>
      </label>
      {revs.length > 0 && (
        <div className="flex flex-wrap items-center gap-2 text-[11.5px]">
          <span className="text-ink-700/55">{tr("Trojúhelníky revizí:")}</span>
          {revs.map((r, i) => (
            <Tick key={i} checked={r.marks !== false} onChange={(v) => setMeta({ revisions: revs.map((x, k) => (k === i ? { ...x, marks: v } : x)) })} title={tr("Kreslit trojúhelník revize {0} u změněných kót (revizi kótě přiřadíte v seznamu kót)", r.rev)}>
              {r.rev || "?"}
            </Tick>
          ))}
        </div>
      )}
      <div className="rounded-md bg-steel-100/60 p-2">
        <span className="mb-1 block text-[11px] text-ink-700/55">{tr("Dotaz na uložení")}</span>
        <div className="flex gap-1">
          <input aria-label={tr("Jmenovitý rozměr [mm]")} className={cn(inputCls, "w-16 font-mono")} value={q.size} onChange={(e) => setQ({ ...q, size: e.target.value })} />
          <input aria-label={tr("Uložení (H7/g6)")} className={cn(inputCls, "font-mono")} value={q.code} onChange={(e) => setQ({ ...q, code: e.target.value })} />
        </div>
        <p data-fit-info className="mt-1 text-[10.5px] leading-snug text-ink-700/70">{info}</p>
      </div>
    </section>
  );
}

/** poznámka s revizí (prázdná = bez trojúhelníku) */
function withRev(a: DrawingAnnotation, rev: string): DrawingAnnotation {
  if (rev) return { ...a, rev };
  const { rev: _r, ...rest } = a;
  void _r;
  return rest as DrawingAnnotation;
}

/** Pole tolerance a revize u kóty / popisu díry v seznamu kót: tlačítko výběru uložení ISO 286 a výběr revize. */
export function AnnFitRev({ a, res, revisions, onChange }: { a: DrawingAnnotation; res: DrawingResult | null; revisions: RevisionItem[]; onChange: (next: DrawingAnnotation) => void }) {
  const [open, setOpen] = useState<null | { x: number; y: number }>(null);
  const size = !res ? 0 : a.type === "dim" && a.kind !== "angle" && a.prefix !== "M" && a.prefix !== "(" && a.text == null ? dimValue(res.views, a) : a.type === "callout" ? Number(/Ø(\d+(?:[.,]\d+)?)/.exec(a.lines[0] ?? "")?.[1]?.replace(",", ".") ?? 0) : 0;
  const current = a.type === "dim" ? splitSuffix(a).user.trim() : a.type === "callout" ? (a.tol ?? "").trim() : "";
  const fit = current && parseFit(current) ? current : "";
  const apply = (code: string | null, show?: FitShow | "") => {
    let next: DrawingAnnotation = a;
    if (a.type === "dim") {
      const p = splitSuffix(a);
      next = { ...a, suffix: code ? `${p.head}${code}${p.tail}` : p.head + p.tail || undefined };
    } else if (a.type === "callout") next = { ...a, tol: code ?? undefined };
    if (show !== undefined) {
      const { tolShow: _t, ...rest } = next;
      void _t;
      next = (show ? { ...rest, tolShow: show } : rest) as DrawingAnnotation;
    }
    onChange(next);
    setOpen(null);
  };
  return (
    <>
      {size > 0 && (
        <button
          type="button"
          data-fit-open
          title={tr("Uložení ISO 286 (pole tolerance a úchylky)")}
          onClick={(e) => {
            const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
            setOpen(open ? null : { x: r.right + 6, y: r.top });
          }}
          className={cn("shrink-0 rounded border px-1 py-0.5 font-mono text-[10px]", fit ? "border-brand/40 text-brand" : "border-ink-700/15 text-ink-700/55 hover:text-brand")}
        >
          {fit || "ISO"}
        </button>
      )}
      {revisions.length > 0 && (
        <select data-ann-rev aria-label={tr("Revize změny (trojúhelník)")} title={tr("Revize, ve které se údaj změnil – trojúhelník u kóty")} value={a.rev ?? ""} onChange={(e) => onChange(withRev(a, e.target.value))} className="w-9 shrink-0 rounded border border-ink-700/15 bg-white px-0 py-0.5 text-[10.5px]">
          <option value="">–</option>
          {revisions.map((r) => (
            <option key={r.rev} value={r.rev}>
              {r.rev}
            </option>
          ))}
        </select>
      )}
      {open && <FitPicker x={open.x} y={open.y} size={size} hole={a.type === "callout" || (a.type === "dim" && a.kind === "diameter")} value={fit} show={a.tolShow ?? ""} onApply={apply} onClose={() => setOpen(null)} />}
    </>
  );
}

/** Výběr pole tolerance ISO 286: díra / hřídel, písmeno, stupeň IT, doporučená uložení, náhled úchylek a zobrazení. */
function FitPicker({ x, y, size, hole: hole0, value, show: show0, onApply, onClose }: { x: number; y: number; size: number; hole: boolean; value: string; show: FitShow | ""; onApply: (code: string | null, show?: FitShow | "") => void; onClose: () => void }) {
  const f = parseFit(value);
  const z0 = f?.hole ?? f?.shaft;
  const [hole, setHole] = useState(z0 ? z0.hole : hole0);
  const [letter, setLetter] = useState(z0?.letter ?? (hole0 ? "H" : "h"));
  const [grade, setGrade] = useState(z0?.grade ?? (hole0 ? 7 : 6));
  const [pair, setPair] = useState(f?.hole && f?.shaft ? value : "");
  const [show, setShow] = useState<FitShow | "">(show0);
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ x, y });
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    setPos({ x: Math.max(8, Math.min(x, window.innerWidth - r.width - 8)), y: Math.max(8, Math.min(y, window.innerHeight - r.height - 8)) });
  }, [x, y]);
  const code = pair || `${letter}${grade}`;
  let preview = "";
  try {
    preview = describeFit(size, code);
  } catch (e) {
    preview = (e as Error).message;
  }
  const dev = fitSuffix(size, code, show || "dev");
  const letters = hole ? HOLE_LETTERS : SHAFT_LETTERS;
  const sel = "rounded border border-ink-700/15 bg-white px-1 py-0.5 text-[12px]";
  return (
    <div ref={ref} data-fit-picker className="fixed z-50 w-72 rounded-lg border border-ink-700/15 bg-white p-3 text-[12px] shadow-2xl" style={{ left: pos.x, top: pos.y }} onKeyDown={(e) => e.key === "Escape" && onClose()}>
      <p className="mb-2 font-semibold">{tr("Uložení ISO 286 – Ø{0}", fmt(size))}</p>
      <div className="mb-2 flex rounded-md bg-steel-100 p-0.5">
        {[true, false].map((h) => (
          <button
            key={String(h)}
            type="button"
            onClick={() => {
              setHole(h);
              setPair("");
              setLetter(h ? letter.toUpperCase() : letter.toLowerCase());
            }}
            className={cn("flex-1 rounded px-1.5 py-1 text-[11.5px]", hole === h && !pair ? "bg-white font-semibold shadow-sm" : "text-ink-700/60")}
          >
            {h ? tr("Díra (velká)") : tr("Hřídel (malá)")}
          </button>
        ))}
      </div>
      <div className="mb-2 flex items-center gap-2">
        <select data-fit-letter aria-label={tr("Základní úchylka")} className={sel} value={letter} onChange={(e) => (setLetter(e.target.value), setPair(""))}>
          {letters.map((l) => (
            <option key={l} value={l}>
              {l}
            </option>
          ))}
        </select>
        <select data-fit-grade aria-label={tr("Stupeň přesnosti IT")} className={sel} value={grade} onChange={(e) => (setGrade(Number(e.target.value)), setPair(""))}>
          {Array.from({ length: 18 }, (_, i) => i + 1).map((g) => (
            <option key={g} value={g}>
              {`IT${g}`}
            </option>
          ))}
        </select>
        <span className="font-mono text-[12px] font-semibold text-brand">{code}</span>
      </div>
      <div className="mb-2 flex flex-wrap gap-1">
        {PREFERRED_FITS.slice(0, 12).map((p) => (
          <button key={p} type="button" onClick={() => setPair(p)} className={cn("rounded border px-1 py-0.5 font-mono text-[10.5px]", pair === p ? "border-brand bg-brand/10 text-brand" : "border-ink-700/15 hover:bg-steel-100")}>
            {p}
          </button>
        ))}
      </div>
      <p data-fit-preview className="mb-2 min-h-[2.4em] text-[11px] leading-snug text-ink-700/70">
        {preview}
        {dev ? ` · ${tr("na výkrese")} ${code} ${dev}` : ""}
      </p>
      <label className="mb-2 flex items-center gap-2 text-[11.5px]">
        <span className="text-ink-700/55">{tr("Zobrazení")}</span>
        <select aria-label={tr("Zobrazení úchylek u kóty")} className={sel} value={show} onChange={(e) => setShow(e.target.value as FitShow | "")}>
          <option value="">{tr("podle listu")}</option>
          <option value="code">{tr("jen značka")}</option>
          <option value="dev">{tr("úchylky")}</option>
          <option value="limits">{tr("mezní rozměry")}</option>
        </select>
      </label>
      <div className="flex justify-end gap-1.5">
        {value && (
          <button type="button" onClick={() => onApply(null, "")} className="rounded-md border border-ink-700/15 px-2 py-1 text-[11.5px] hover:bg-steel-100">
            {tr("Odebrat")}
          </button>
        )}
        <button type="button" onClick={onClose} className="rounded-md border border-ink-700/15 px-2 py-1 text-[11.5px] hover:bg-steel-100">
          {tr("Zrušit")}
        </button>
        <button type="button" data-fit-apply onClick={() => onApply(code, show)} className="rounded-md bg-brand px-3 py-1 text-[11.5px] font-medium text-white hover:bg-brand-600">
          {tr("Použít")}
        </button>
      </div>
    </div>
  );
}
