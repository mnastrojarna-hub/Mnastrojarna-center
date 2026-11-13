/**
 * Provedení textových příkazů výkresu vlny 7 (cad/agent-drawing-views.ts) nad aktivním listem: pomocné pohledy, řezy
 * lomenou čarou, částečné řezy, přerušení, zobrazení uložení a Tabulka uložení, trojúhelníky revizí a zóny listu.
 * Každá změna se ověří přepočtem listu (pohled na listu / varování výkresu) a výsledek se vrátí do protokolu agenta.
 * Řádky stavu výkresu (`výkres stav`, `window.mncad.drawingStatus()`) pro tyto prvky dává `viewsStatusLines`.
 */
import type { ViewsCmd } from "./agent-drawing-views";
import { annotationGeometry, scaleLabel, viewExtent, zoneOf, type DrawingMeta, type DrawingOptions, type DrawingResult, type PlacedView, type RevisionItem } from "./drawing";
import { describeFit, fitRows, type FitShow } from "./drawing-fits";
import { annLabel, agentToSheet, agentToView, findView, resolveAnns, viewToAgent } from "./drawing-marks";
import type { AuxViewOpt, BrokenOutOpt, CutSectionOpt, ViewBreakOpt } from "./drawing-views";
import { tr } from "./i18n";
import { uid, type CadDoc, type DrawingAnnotation, type DrawingDoc, type Vec2 } from "./types";

const fmtN = (n: number) => String(Math.round(n * 100) / 100).replace(".", ",").replace(/^-/, "−");
const fmtP = (p: Vec2) => `[${fmtN(p[0])}; ${fmtN(p[1])}]`;
const opt = (s: DrawingDoc) => s.options as Partial<DrawingOptions>;
/** písmena pohledů a řezů (bez A – řez A–A, bez I, O, Q – ISO 128) */
const LETTERS = "BCDEFGHJKLMNPRSTUVWXYZ".split("");
const PRINCIPAL = new Set(["front", "top", "left", "right", "back", "bottom"]);
const showName = (v: FitShow) => (v === "code" ? tr("značka") : v === "dev" ? tr("úchylky") : tr("mezní rozměry"));

/** další volné písmeno pro pomocný pohled / řez (unikátní na listu včetně detailů) */
export function nextViewLetter(o: Partial<DrawingOptions>): string {
  const used = new Set([...(o.aux ?? []).map((x) => x.label), ...(o.cuts ?? []).map((x) => x.label), ...(o.details ?? []).map((x) => x.label)]);
  return LETTERS.find((l) => !used.has(l)) ?? "Z";
}

/** hrana pohledu, na které leží oba body (do 0,5 mm) – hrana se převezme přesně; jinak null */
function snapEdge(v: PlacedView, a: Vec2, b: Vec2): [Vec2, Vec2] | null {
  const tol = 0.5;
  let best: [Vec2, Vec2] | null = null;
  let bl = 0;
  for (const e of v.ents ?? []) {
    if (e.t !== "line") continue;
    const L = Math.hypot(e.b[0] - e.a[0], e.b[1] - e.a[1]);
    if (L < 1e-9) continue;
    const u: Vec2 = [(e.b[0] - e.a[0]) / L, (e.b[1] - e.a[1]) / L];
    const off = (p: Vec2) => Math.abs((p[0] - e.a[0]) * u[1] - (p[1] - e.a[1]) * u[0]);
    const t = (p: Vec2) => (p[0] - e.a[0]) * u[0] + (p[1] - e.a[1]) * u[1];
    if (off(a) > tol || off(b) > tol) continue;
    if (Math.min(t(a), t(b)) < -tol || Math.max(t(a), t(b)) > L + tol) continue;
    if (L > bl) {
      bl = L;
      best = [e.a, e.b];
    }
  }
  return best;
}

export type ViewsCtx = {
  doc: CadDoc;
  sheet: () => DrawingDoc;
  put: (s: DrawingDoc) => void;
  /** přepočet aktivního listu (s doplněním Chytrých kót) */
  compute: () => Promise<DrawingResult>;
};

/** Provede příkaz nad aktivním listem; vrátí řádky protokolu, zda se list změnil a zda otevřít výkres. */
export async function applyViewsCmd(ctx: ViewsCtx, cmd: ViewsCmd): Promise<{ log: string[]; changed: boolean; open: boolean }> {
  const log: string[] = [];
  const setOpts = (patch: Partial<DrawingOptions>) => ctx.put({ ...ctx.sheet(), options: { ...ctx.sheet().options, ...patch } as Record<string, unknown> });
  const o = () => opt(ctx.sheet());
  const warnFor = (res: DrawingResult, re: RegExp) => res.warnings.filter((w) => re.test(w));
  switch (cmd.op) {
    case "aux": {
      const res = await ctx.compute();
      const H = res.sheet.h;
      let parent: string | undefined;
      let edge: [Vec2, Vec2] | undefined;
      let how = "";
      if (cmd.parent) {
        const v = findView(res, o(), cmd.parent);
        if (!v.cam) throw new Error(tr("pohled {0} nemá směr promítání", cmd.parent));
        parent = v.key;
        if (cmd.edge) {
          const a = agentToView(cmd.edge[0]);
          const b = agentToView(cmd.edge[1]);
          const snapped = snapEdge(v, a, b);
          edge = snapped ?? [a, b];
          how = snapped ? tr("hrana pohledu {0}–{1}", fmtP(viewToAgent(snapped[0])), fmtP(viewToAgent(snapped[1]))) : tr("zadaná čára {0}–{1} (není hranou pohledu)", fmtP(cmd.edge[0]), fmtP(cmd.edge[1]));
        }
      }
      const label = nextViewLetter(o());
      const entry: AuxViewOpt = {
        id: uid(),
        label,
        ...(parent ? { parent } : {}),
        ...(edge ? { edge } : {}),
        ...(cmd.mode ? { mode: cmd.mode } : {}),
        ...(cmd.face != null ? { face: cmd.face } : {}),
        ...(cmd.dir ? { dir: cmd.dir } : {}),
        ...(cmd.flip ? { flip: true } : {}),
        ...(cmd.place ? { at: agentToSheet(H, cmd.place) } : {}),
      };
      if (!how) how = cmd.face != null ? tr("plocha F{0}", cmd.face) : tr("směr {0}", (cmd.dir ?? []).map(fmtN).join(" "));
      setOpts({ aux: [...(o().aux ?? []), entry] });
      const chk = await ctx.compute();
      const p = chk.extraViews?.find((x) => x.key === `aux:${label}`);
      const w = warnFor(chk, new RegExp(`Pohled ${label}\\b`));
      log.push(p ? tr("✓ pomocný pohled {0} (z pohledu {1}, {2}, {3}) – na listu x {4}…{5}, y {6}…{7}; souřadnice pohledu: výkres stav", label, viewNameOf(p.parent), cmd.mode === "along" ? tr("podél hrany") : tr("kolmo"), how, fmtN(p.x), fmtN(p.x + p.w), fmtN(chk.sheet.h - (p.y + p.h)), fmtN(chk.sheet.h - p.y)) : tr("⚠ pomocný pohled {0} uložen, ale na listu není: {1}", label, w.join("; ") || "—"));
      return { log, changed: true, open: true };
    }
    case "aux-del": {
      const list = o().aux ?? [];
      if (!list.some((x) => x.label === cmd.label)) throw new Error(tr("pomocný pohled {0} na listu není – pomocné pohledy: {1}", cmd.label, list.map((x) => x.label).join(", ") || "—"));
      setOpts({ aux: list.filter((x) => x.label !== cmd.label) });
      log.push(tr("✓ pomocný pohled {0} smazán", cmd.label));
      return { log, changed: true, open: false };
    }
    case "cut": {
      const res = await ctx.compute();
      const v = findView(res, o(), cmd.parent);
      if (!v.cam) throw new Error(tr("pohled {0} nemá směr promítání", cmd.parent));
      const label = nextViewLetter(o());
      const entry: CutSectionOpt = { id: uid(), label, parent: v.key, kind: cmd.kind, pts: cmd.pts.map(agentToView), ...(cmd.flip ? { flip: true } : {}), ...(cmd.place ? { at: agentToSheet(res.sheet.h, cmd.place) } : {}) };
      setOpts({ cuts: [...(o().cuts ?? []), entry] });
      const chk = await ctx.compute();
      const p = chk.extraViews?.find((x) => x.key === `cut:${label}`);
      const w = warnFor(chk, new RegExp(`Řez ${label}–${label}`));
      const kind = cmd.kind === "stepped" ? tr("zalomený") : tr("natočený");
      log.push(p ? tr("✓ řez {0}–{0} {1} (pohled {2}, {3} bodů) – na listu x {4}…{5}, y {6}…{7}", label, kind, viewNameOf(v.key), cmd.pts.length, fmtN(p.x), fmtN(p.x + p.w), fmtN(chk.sheet.h - (p.y + p.h)), fmtN(chk.sheet.h - p.y)) : tr("⚠ řez {0}–{0} uložen, ale na listu není: {1}", label, w.join("; ") || "—"));
      return { log, changed: true, open: true };
    }
    case "cut-del": {
      const list = o().cuts ?? [];
      if (!list.some((x) => x.label === cmd.label)) throw new Error(tr("řez {0}–{0} na listu není – řezy lomenou čarou: {1}", cmd.label, list.map((x) => x.label).join(", ") || "—"));
      setOpts({ cuts: list.filter((x) => x.label !== cmd.label) });
      log.push(tr("✓ řez {0}–{0} smazán", cmd.label));
      return { log, changed: true, open: false };
    }
    case "bo": {
      const res = await ctx.compute();
      const v = findView(res, o(), cmd.view);
      if (!PRINCIPAL.has(v.key)) throw new Error(tr("částečný řez jde do pravoúhlého pohledu (přední, horní, levý, pravý, zadní, spodní)"));
      const entry: BrokenOutOpt = { id: uid(), view: v.key, pts: cmd.pts.map(agentToView), depth: cmd.depth, ...(cmd.spline ? { spline: true } : {}) };
      const list = [...(o().brokenOut ?? []), entry];
      setOpts({ brokenOut: list });
      const chk = await ctx.compute();
      const w = warnFor(chk, /Částečný řez/);
      log.push(w.length ? tr("⚠ částečný řez {0} uložen, ale: {1}", list.length, w.join("; ")) : tr("✓ částečný řez {0} v pohledu {1}: oblast {2} bodů{3}, hloubka {4} mm od přední strany", list.length, viewNameOf(v.key), cmd.pts.length, cmd.spline ? tr(" (hladká křivka)") : "", fmtN(cmd.depth)));
      return { log, changed: true, open: true };
    }
    case "bo-del": {
      const list = o().brokenOut ?? [];
      if (!list.length) throw new Error(tr("na listu není žádný částečný řez"));
      if (cmd.which !== "all" && cmd.which > list.length) throw new Error(tr("částečný řez {0} na listu není – je jich {1}", cmd.which, list.length));
      setOpts({ brokenOut: cmd.which === "all" ? [] : list.filter((_, i) => i !== (cmd.which as number) - 1) });
      log.push(cmd.which === "all" ? tr("✓ smazány všechny částečné řezy ({0})", list.length) : tr("✓ částečný řez {0} smazán", cmd.which));
      return { log, changed: true, open: false };
    }
    case "break": {
      const res = await ctx.compute();
      const v = findView(res, o(), cmd.view);
      if (!PRINCIPAL.has(v.key) && v.key !== "section") throw new Error(tr("přerušení jde do pravoúhlého pohledu nebo řezu A–A"));
      const entry: ViewBreakOpt = { id: uid(), view: v.key, axis: cmd.axis, from: cmd.from, to: cmd.to, ...(cmd.gap !== undefined ? { gap: cmd.gap } : {}), ...(cmd.style ? { style: cmd.style } : {}) };
      const list = [...(o().breaks ?? []), entry];
      setOpts({ breaks: list });
      const chk = await ctx.compute();
      const p = chk.views.find((x) => x.key === v.key);
      const w = warnFor(chk, /Přerušení/);
      const e = p ? viewExtent(p) : null;
      const along = cmd.axis === "x";
      log.push(
        w.length || !p?.brk
          ? tr("⚠ přerušení {0} uloženo, ale: {1}", list.length, w.join("; ") || tr("pohled není přerušený"))
          : tr("✓ přerušení {0} v pohledu {1} ({2} {3}…{4}): na listu {5} mm místo {6} mm, kóty přes přerušení drží skutečnou délku", list.length, viewNameOf(v.key), cmd.axis, fmtN(cmd.from), fmtN(cmd.to), fmtN((along ? p.w : p.h) * p.s), fmtN(((along ? e!.x1 - e!.x0 : e!.y1 - e!.y0) * p.s))),
      );
      return { log, changed: true, open: true };
    }
    case "break-del": {
      const list = o().breaks ?? [];
      if (!list.length) throw new Error(tr("na listu není žádné přerušení"));
      if (cmd.which !== "all" && cmd.which > list.length) throw new Error(tr("přerušení {0} na listu není – je jich {1}", cmd.which, list.length));
      setOpts({ breaks: cmd.which === "all" ? [] : list.filter((_, i) => i !== (cmd.which as number) - 1) });
      log.push(cmd.which === "all" ? tr("✓ smazána všechna přerušení ({0})", list.length) : tr("✓ přerušení {0} smazáno", cmd.which));
      return { log, changed: true, open: false };
    }
    case "fit-show":
      setOpts({ fitShow: cmd.show });
      log.push(tr("✓ uložení na listu: {0}", showName(cmd.show)));
      return { log, changed: true, open: true };
    case "fit-table": {
      setOpts({ fitTable: cmd.on });
      if (!cmd.on) {
        log.push(tr("✓ Tabulka uložení vypnuta"));
        return { log, changed: true, open: true };
      }
      const res = await ctx.compute();
      const rows = fitRows(annotationGeometry(res, ctx.sheet().annotations).fits);
      log.push(rows.length ? tr("✓ Tabulka uložení: {0} řádků – {1}", rows.length, rows.map((r) => `${r.label} ${r.code} ${r.upper}/${r.lower}`).join(" · ")) : tr("✓ Tabulka uložení zapnuta – zatím žádná kóta s polem tolerance (výkres uložení Ø40 H7)"));
      return { log, changed: true, open: true };
    }
    case "fit-query":
      log.push(describeFit(cmd.size, cmd.code));
      return { log, changed: false, open: false };
    case "fit-set":
      throw new Error(tr("výkres uložení <kóta> <pole> se provádí jako výkres tolerance"));
    case "rev-mark":
    case "rev-unmark": {
      const res = await ctx.compute();
      const s = ctx.sheet();
      const anns = s.annotations;
      if (cmd.op === "rev-mark") {
        const revs = (s.meta as Partial<DrawingMeta>).revisions ?? [];
        if (!revs.some((r) => r.rev.toUpperCase() === cmd.rev)) throw new Error(tr("revize {0} v tabulce není – nejdřív výkres revize {0} \"popis změny\" (revize: {1})", cmd.rev, revs.map((r) => r.rev).join(", ") || "—"));
      }
      const hit = new Set<number>();
      for (const t of cmd.targets) {
        const ix = resolveAnns(res.views, anns, t);
        if (!ix.length) throw new Error(tr("„{0}“ na listu není – kóty a značky ukáže výkres stav", t));
        ix.forEach((i) => hit.add(i));
      }
      const next = anns.map((a, i): DrawingAnnotation => {
        if (!hit.has(i)) return a;
        if (cmd.op === "rev-mark") return { ...a, rev: cmd.rev };
        const { rev: _r, ...rest } = a;
        void _r;
        return rest as DrawingAnnotation;
      });
      ctx.put({ ...s, annotations: next });
      const names = [...hit].map((i) => annLabel(res.views, anns[i])).join(", ");
      log.push(cmd.op === "rev-mark" ? tr("✓ trojúhelník revize {0} u: {1}", cmd.rev, names) : tr("✓ trojúhelník revize odebrán u: {0}", names));
      return { log, changed: true, open: true };
    }
    case "rev-marks": {
      const s = ctx.sheet();
      const m = s.meta as Partial<DrawingMeta>;
      const revs: RevisionItem[] = [...(m.revisions ?? [])];
      const i = revs.findIndex((r) => r.rev.toUpperCase() === cmd.rev);
      if (i < 0) throw new Error(tr("revize {0} v tabulce není – revize: {1}", cmd.rev, revs.map((r) => r.rev).join(", ") || "—"));
      revs[i] = { ...revs[i], marks: cmd.on };
      ctx.put({ ...s, meta: { ...m, revisions: revs } as Record<string, unknown> });
      log.push(cmd.on ? tr("✓ revize {0}: trojúhelníky u změněných kót se kreslí", cmd.rev) : tr("✓ revize {0}: trojúhelníky se nekreslí", cmd.rev));
      return { log, changed: true, open: true };
    }
    case "zones":
      setOpts({ zones: cmd.on });
      log.push(cmd.on ? tr("✓ zóny listu zapnuty (ISO 5457) – tabulka revizí má sloupec Zóna") : tr("✓ zóny listu vypnuty"));
      return { log, changed: true, open: true };
  }
}

/** název pohledu pro protokol */
export function viewNameOf(k: string): string {
  // názvy pohledů jako v ostatních příkazech výkresu (VIEW_CS)
  const CS: Record<string, string> = { front: "přední", top: "horní", left: "levý", right: "pravý", back: "zadní", bottom: "spodní" };
  if (k.startsWith("aux:")) return tr("pohled {0}", k.slice(4));
  if (k.startsWith("cut:")) return tr("řez {0}–{0}", k.slice(4));
  if (k === "section") return tr("řez {0}–{0}", "A");
  return tr(CS[k] ?? k);
}

/** Řádky stavu výkresu: pomocné pohledy, řezy lomenou čarou, částečné řezy, přerušení, uložení, zóny a trojúhelníky revizí. */
export function viewsStatusLines(res: DrawingResult, o: Partial<DrawingOptions>, anns: DrawingAnnotation[], meta: Partial<DrawingMeta>): string[] {
  const L: string[] = [];
  const H = res.sheet.h;
  const at = (key: string) => {
    const p = res.extraViews?.find((x) => x.key === key);
    return p ? tr(" · na listu x {0}…{1}, y {2}…{3}{4}", fmtN(p.x), fmtN(p.x + p.w), fmtN(H - (p.y + p.h)), fmtN(H - p.y), (() => {
      const v = res.views.find((x) => x.key === key);
      return v && Math.abs(v.s - res.scaleValue) > 1e-9 ? ` (${scaleLabel(v.s)})` : "";
    })()) : tr(" · není na listu");
  };
  if (o.aux?.length)
    L.push(tr("Pomocné pohledy: {0}", o.aux.map((a) => `${a.label} (${a.edge ? tr("{0}, hrana {1}–{2}", viewNameOf(a.parent ?? ""), fmtP(viewToAgent(a.edge[0])), fmtP(viewToAgent(a.edge[1]))) : a.face != null ? tr("plocha F{0}", a.face) : tr("směr {0}", (a.dir ?? []).map(fmtN).join(" "))}${a.mode === "along" ? tr(", podél") : ""}${a.flip ? tr(", otočeno") : ""})${at(`aux:${a.label}`)}`).join(" · ")));
  if (o.cuts?.length) L.push(tr("Řezy lomenou čarou: {0}", o.cuts.map((c) => `${c.label}–${c.label} ${c.kind === "stepped" ? tr("zalomený") : tr("natočený")} (${viewNameOf(c.parent)}: ${c.pts.map((q) => fmtP(viewToAgent(q))).join(" ")})${at(`cut:${c.label}`)}`).join(" · ")));
  if (o.brokenOut?.length) L.push(tr("Částečné řezy: {0}", o.brokenOut.map((b, i) => tr("{0} {1} hloubka {2} ({3} bodů{4})", i + 1, viewNameOf(b.view), fmtN(b.depth), b.pts.length, b.spline ? tr(", křivka") : "")).join(" · ")));
  if (o.breaks?.length)
    L.push(tr("Přerušení: {0}", o.breaks.map((b, i) => {
      const v = res.views.find((x) => x.key === b.view);
      const e = v ? viewExtent(v) : null;
      const shown = v && e ? tr(" – na listu {0} místo {1} mm", fmtN((b.axis === "x" ? v.w : v.h) * v.s), fmtN((b.axis === "x" ? e.x1 - e.x0 : e.y1 - e.y0) * v.s)) : "";
      return `${i + 1} ${viewNameOf(b.view)} ${b.axis} ${fmtN(b.from)}…${fmtN(b.to)}${b.style === "wave" ? tr(" vlnovka") : ""}${shown}`;
    }).join(" · ")));
  const fits = fitRows(annotationGeometry(res, anns).fits);
  if (fits.length || o.fitTable || o.fitShow)
    L.push(tr("Uložení ISO 286 (zobrazení {0}, tabulka {1}): {2}", showName(o.fitShow ?? "dev"), o.fitTable ? tr("ano") : tr("ne"), fits.map((r) => `${r.label} ${r.code} ${r.upper}/${r.lower} (${r.min}…${r.max})`).join(" · ") || "—"));
  const marks = anns.filter((a) => a.rev);
  if (res.zones || marks.length) {
    const g = annotationGeometry(res, marks);
    const zone = (rev: string) => (res.zones ? [...new Set(g.marks.filter((m) => m.rev === rev).map((m) => zoneOf(res.zones!, m.at)))].filter(Boolean).join(", ") : "");
    const byRev = new Map<string, string[]>();
    for (const a of marks) byRev.set(a.rev!, [...(byRev.get(a.rev!) ?? []), annLabel(res.views, a)]);
    const hidden = new Set((meta.revisions ?? []).filter((r) => r.marks === false).map((r) => r.rev));
    L.push(tr("Zóny listu: {0} · trojúhelníky revizí: {1}", res.zones ? `${res.zones.cols} × ${res.zones.rows}` : tr("ne"), [...byRev].map(([r, l]) => `${r}${hidden.has(r) ? tr(" (skryté)") : ""}: ${l.join(", ")}${zone(r) ? ` (${zone(r)})` : ""}`).join(" · ") || "—"));
  }
  return L;
}
