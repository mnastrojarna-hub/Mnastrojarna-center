/**
 * Předloha v protokolu konzole: stav (listy, pohledy, měřítka, počty, rozpory), výtah po druzích, výsledek porovnání
 * a kontroly kót. Řádky začínají ✓ / ⚠ / ✗ / „·“ (výčet) – krátké, aby se protokol dal číst strojově.
 */
import { cadLocale, tr } from "../i18n";
import { viewName, type RefExtractWhat } from "./parse";
import type { RefState } from "./store";
import type { RefCompare, RefDim, RefDimCheck, RefExtract } from "./types";

const loc = () => cadLocale();
/** číslo s nejvýš `d` desetinnými místy (bez koncových nul) */
export const nf = (v: number, d = 3) => (Number.isFinite(v) ? v.toLocaleString(loc(), { maximumFractionDigits: d, useGrouping: false }) : "?");
const pt = (p: [number, number] | number[]) => `${nf(p[0], 1)}; ${nf(p[1], 1)}`;
const kb = (n: number) => (n < 1024 ? `${n} B` : `${nf(n / 1024, n < 10240 ? 1 : 0)} kB`);
const MAX = 40;

/** počty podle klíče („3× A2, 7× A3“) */
const counts = (xs: string[]) => {
  const m = new Map<string, number>();
  for (const x of xs) m.set(x, (m.get(x) ?? 0) + 1);
  return [...m].map(([k, n]) => `${n}× ${k}`).join(", ");
};

export function dimLabel(d: RefDim): string {
  const tol = d.tol ? ` (${d.tol.upper >= 0 ? "+" : ""}${nf(d.tol.upper)}/${d.tol.lower >= 0 ? "+" : ""}${nf(d.tol.lower)})` : "";
  return `${d.count && !/^\d+\s*[x×*]/i.test(d.text) ? `${d.count}× ` : ""}${d.text}${d.tol && !/[±{]|[+-]\d/.test(d.text) ? tol : ""}`;
}

/**
 * `předloha stav`; `model` = otisk aktuálního modelu (run.ts modelPrint) – uložené výsledky porovnání a kontroly kót
 * z jiného stavu modelu se označí jako zastaralé (důkaz shody platí jen pro model, se kterým se porovnávalo).
 */
export function statusLines(st: RefState, model?: string): string[] {
  const ex = st.extract;
  const out: string[] = [];
  const bom = ex.boms[0];
  const bomRows = bom?.rows ?? [];
  const qty = bomRows.filter((r) => (r.qty ?? 0) > 0);
  const sym = (k: string) => ex.symbols.filter((s) => s.kind === k).length;
  out.push(
    tr("✓ předloha „{0}“ ({1}{2}, {3}): listy {4} ({5}), pohledy {6}, kóty {7}, díry a normálie {8}, pozice {9}, razítka {10}", ex.name, ex.format.toUpperCase(), st.version ? ` ${st.version}` : "", kb(st.info.bytes), ex.sheets.length, counts(ex.sheets.map((s) => s.size)) || "—", ex.views.length, ex.dims.length, ex.holes.length, ex.balloons.length, ex.titles.length),
  );
  if (bom) out.push(tr("· kusovník (list {0}): pozice {1}, řádky s počtem {2}, celkem {3} ks", bom.sheet, bomRows.length, qty.length, nf(qty.reduce((s, r) => s + (r.qty ?? 0), 0), 2)));
  out.push(tr("· kóty: {0} s tolerancí, {1} s uložením, {2} informativních, {3} Ø, {4} závitů, {5} sražení; značky: drsnost {6}, tolerance tvaru {7}, základny {8}, řezy {9}, popisky pohledů {10}", ex.dims.filter((d) => d.tol).length, ex.dims.filter((d) => d.fit).length, ex.dims.filter((d) => d.reference).length, ex.dims.filter((d) => d.dia).length, ex.dims.filter((d) => d.thread).length, ex.dims.filter((d) => d.chamfer).length, sym("roughness"), sym("fcf"), sym("datum"), sym("section"), sym("label")));
  for (const s of ex.sheets.slice(0, 20)) {
    const t = s.title;
    const vs = ex.views.filter((v) => v.sheet === s.n);
    out.push(tr("· list {0}: {1} {2}{3}, pohledy {4}{5}", s.n, s.size, s.scale ?? "?", t?.name ? ` „${t.name}“` : "", vs.length, t?.number ? tr(", číslo výkresu {0}", t.number) : "") + (t?.pos ? tr(", pozice {0}", t.pos) : ""));
  }
  if (ex.sheets.length > 20) out.push(tr("· … dalších {0} listů – předloha výtah listy", ex.sheets.length - 20));
  // kontrola text kóty = geometrie
  const bad = ex.dims.filter((d) => d.check === "mismatch");
  const rounded = ex.dims.filter((d) => d.check === "rounded");
  if (bad.length) out.push(tr("✗ text kóty ≠ geometrie: {0} – {1}", bad.length, bad.slice(0, 4).map((d) => tr("list {0} kóta {1}: text {2}, geometrie {3}", d.sheet, d.id, d.text, nf(d.measured ?? NaN, 4))).join("; ")));
  else out.push(tr("✓ text kóty = geometrie u všech {0} kót s číslem", ex.dims.filter((d) => d.check !== "none").length));
  if (rounded.length) out.push(tr("· zaokrouhlený text (geometrie má víc desetinných míst): {0} kót – předloha výtah kóty", rounded.length));
  const other = ex.contradictions.filter((c) => c.kind !== "dim-text");
  for (const c of other.slice(0, 8)) out.push(c.kind === "hole-dim" ? tr("⚠ možný rozpor: {0}", c.text) : tr("✗ rozpor: {0}", c.text));
  if (other.length > 8) out.push(tr("· … dalších {0} rozporů – předloha výtah rozpory", other.length - 8));
  if (Object.keys(ex.skipped).length) out.push(tr("⚠ nepřevedené objekty předlohy: {0}", Object.entries(ex.skipped).map(([k, v]) => `${k} ${v}`).join(", ")));
  const ch = st.info.checks;
  const stale = (m?: string) => model !== undefined && m !== model;
  const staleNote = () => tr(" – ZASTARALÉ: model se od té doby změnil, zopakujte");
  if (ch?.compare)
    for (const [v, c] of Object.entries(ch.compare)) {
      const old = stale(c.model);
      const mark = old ? "⚠" : c.coverage >= 99.5 && c.modelCoverage >= 99.5 ? "✓" : "·";
      out.push(`${mark} ${tr("poslední porovnání ({0}): pohled {1} × předloha {2}: pokrytí {3} % / model {4} %", c.at, viewName(v), c.refView, nf(c.coverage, 1), nf(c.modelCoverage, 1))}${old ? staleNote() : ""}`);
    }
  if (ch?.dims) {
    const old = stale(ch.dims.model);
    const mark = old ? "⚠" : ch.dims.bad ? "✗" : ch.dims.skipped || !ch.dims.ok ? "·" : "✓";
    out.push(`${mark} ${tr("poslední kontrola kót ({0}{1}): {2} ✓, {3} ✗, {4} bez bodu v modelu, {5} nekontrolováno", ch.dims.at, ch.dims.sheet ? tr(", list {0}", ch.dims.sheet) : "", ch.dims.ok, ch.dims.bad, ch.dims.skipped, ch.dims.unchecked ?? 0)}${old ? staleNote() : ""}`);
  }
  return out;
}

const inScope = (o: { sheet?: number; view?: string }) => (x: { sheet: number; view?: string }) => (o.sheet === undefined || x.sheet === o.sheet) && (o.view === undefined || x.view === o.view);

/** `předloha výtah …` */
export function extractLines(ex: RefExtract, what: RefExtractWhat, o: { sheet?: number; view?: string; all?: boolean } = {}): string[] {
  const out: string[] = [];
  const lim = o.all ? 100000 : MAX;
  const more = (n: number, hint: string) => (n > lim ? [tr("· … dalších {0} – {1} vše", n - lim, hint)] : []);
  const scope = inScope(o);
  if (what === "all") {
    out.push(...extractLines(ex, "sheets", o).slice(0, 25), ...extractLines(ex, "views", o).slice(0, 15));
    out.push(tr("· podrobně: předloha výtah kóty | díry | kusovník | razítko | poznámky | značky | pozice | rozpory [list N] [pohled N.M] [vše]"));
    return out;
  }
  if (what === "sheets") {
    for (const s of ex.sheets.filter((x) => o.sheet === undefined || x.n === o.sheet)) out.push(tr("list {0}: {1} {2}×{3} mm, měřítko {4}, rámeček [{5}] – [{6}] ({7})", s.n, s.size, nf(s.w, 1), nf(s.h, 1), s.scale ?? "?", pt([s.frame.x0, s.frame.y0]), pt([s.frame.x1, s.frame.y1]), s.source));
    return out;
  }
  if (what === "views") {
    const vs = ex.views.filter((v) => (o.sheet === undefined || v.sheet === o.sheet) && (o.view === undefined || v.id === o.view));
    const from = (f?: string) => ({ dims: tr("z kót"), "sheet-dims": tr("z kót listu"), sheet: tr("z měřítka listu"), default: tr("výchozí – bez kót a měřítka; porovnat … měřítko 1:N") })[f ?? "default"] ?? "";
    for (const v of vs.slice(0, lim)) out.push(tr("pohled {0}{1}: {2} × {3} mm (geometrie {4}:1 {5}), vlevo dole [{6}], {7} entit", v.id, v.label ? ` ${v.label}` : "", nf(v.w / v.geomScale, 2), nf(v.h / v.geomScale, 2), nf(v.geomScale, 4), from(v.scaleFrom), pt([v.box.x0, v.box.y0]), v.count));
    out.push(...more(vs.length, tr("předloha výtah pohledy")));
    return out;
  }
  if (what === "dims") {
    const ds = ex.dims.filter(scope);
    for (const d of ds.slice(0, lim)) {
      const mark = d.check === "mismatch" ? "✗" : d.check === "rounded" ? "≈" : "·";
      const extra = [d.fit ? tr("uložení {0}", d.fit) : "", d.reference ? tr("informativní") : "", d.thread ? tr("závit {0}", d.thread) : "", d.chamfer ? tr("sražení {0}×{1}°", nf(d.chamfer.size), nf(d.chamfer.angle)) : ""].filter(Boolean).join(", ");
      out.push(`${mark} ${tr("{0} {1}: {2}{3} · změřeno {4} · [{5}]{6}", d.view ?? `${d.sheet}.?`, d.id, dimLabel(d), extra ? ` (${extra})` : "", d.measured !== undefined ? nf(d.measured, 4) : "?", pt(d.at), d.kind === "ordinate" || d.kind === "linear" ? "" : ` ${d.kind}`)}`);
    }
    out.push(...more(ds.length, tr("předloha výtah kóty")));
    return out;
  }
  if (what === "holes") {
    const hs = ex.holes.filter(scope);
    const grp = new Map<string, { n: number; first: (typeof hs)[number] }>();
    for (const h of hs) {
      const k = `${h.view ?? h.sheet}|${h.kind}|${h.desig ?? ""}|${h.dias.join("/")}|${h.side ?? ""}`;
      const g = grp.get(k);
      if (g) g.n++;
      else grp.set(k, { n: 1, first: h });
    }
    const rows = [...grp.values()];
    for (const { n, first: h } of rows.slice(0, lim)) out.push(tr("{0}× {1} {2}{3}{4} – pohled {5}, první [{6}]", n, holeKind(h.kind), h.desig ? `„${h.desig}“ ` : "", h.dias.length ? `Ø${h.dias.map((x) => nf(x)).join("/")}` : "", h.side ? tr(" (pohled normálie {0})", h.side) : "", h.view ?? `${h.sheet}.?`, h.center ? pt(h.center) : "?"));
    out.push(...more(rows.length, tr("předloha výtah díry")));
    return out;
  }
  if (what === "bom") {
    for (const b of ex.boms.filter((x) => o.sheet === undefined || x.sheet === o.sheet)) {
      out.push(tr("kusovník (list {0}): {1}", b.sheet, b.header.join(" | ")));
      // sloupce v pořadí hlavičky předlohy (jako vytištěná tabulka); buňky bez hlavičky na konec
      const extra = [...new Set(b.rows.flatMap((r) => Object.keys(r.cells)).filter((k) => !b.header.includes(k)))];
      for (const r of b.rows.slice(0, lim)) out.push([...b.header, ...extra].map((h) => r.cells[h] ?? "").join(" | ").replace(/( \| )+$/, ""));
      out.push(...more(b.rows.length, tr("předloha výtah kusovník")));
    }
    if (!ex.boms.length) out.push(tr("· kusovník v předloze není"));
    return out;
  }
  if (what === "title") {
    for (const t of ex.titles.filter((x) => o.sheet === undefined || x.sheet === o.sheet).slice(0, lim)) out.push(tr("list {0}{1}: {2}", t.sheet, t.block ? ` (${t.block})` : "", Object.entries(t.fields).map(([k, v]) => `${k}=${v}`).join(" · ")));
    if (!ex.titles.length) out.push(tr("· razítka (bloky s atributy) v předloze nejsou"));
    return out;
  }
  if (what === "notes") {
    const ns = ex.notes.filter((n) => o.sheet === undefined || n.sheet === o.sheet);
    for (const n of ns.slice(0, lim)) out.push(tr("list {0} [{1}]: {2}", n.sheet, pt(n.at), n.text));
    out.push(...more(ns.length, tr("předloha výtah poznámky")));
    return out;
  }
  if (what === "symbols") {
    const ss = ex.symbols.filter((s) => o.sheet === undefined || s.sheet === o.sheet);
    for (const s of ss.slice(0, lim)) out.push(tr("list {0} {1} [{2}]: {3}", s.sheet, symKind(s.kind), pt(s.at), s.text));
    out.push(...more(ss.length, tr("předloha výtah značky")));
    return out;
  }
  if (what === "balloons") {
    const bs = ex.balloons.filter((b) => o.sheet === undefined || b.sheet === o.sheet);
    for (const b of bs.slice(0, lim)) out.push(tr("list {0} pozice {1} [{2}]{3}", b.sheet, b.pos, pt(b.at), b.target ? tr(" → [{0}]{1}", pt(b.target), b.linked ? tr(" (značka dílu)") : "") : ""));
    out.push(...more(bs.length, tr("předloha výtah pozice")));
    return out;
  }
  // rozpory
  for (const c of ex.contradictions.filter((x) => o.sheet === undefined || x.sheet === o.sheet)) out.push(`${c.kind === "hole-dim" ? "⚠" : "✗"} ${c.text}`);
  const r = ex.dims.filter((d) => d.check === "rounded" && (o.sheet === undefined || d.sheet === o.sheet));
  if (r.length) out.push(tr("· zaokrouhlené texty kót ({0}): {1}", r.length, r.slice(0, o.all ? 1000 : 12).map((d) => `${d.text} = ${nf(d.measured ?? NaN, 6)}`).join(", ") + (r.length > 12 && !o.all ? " …" : "")));
  if (!out.length) out.push(tr("✓ rozpory v předloze nenalezeny"));
  return out;
}

const holeKind = (k: string) =>
  ({ thread: tr("závit"), bore: tr("vrtání"), counterbore: tr("zahloubení"), countersink: tr("kuželové zahloubení"), blind: tr("slepá díra"), screw: tr("šroub"), pin: tr("kolík"), nut: tr("matice"), washer: tr("podložka"), part: tr("normálie"), circle: tr("kružnice") })[k] ?? k;
const symKind = (k: string) => ({ roughness: tr("drsnost"), fcf: tr("tolerance tvaru"), datum: tr("základna"), section: tr("řez"), label: tr("popisek") })[k] ?? k;

/** `porovnat předloha pohled …` */
/** značka výsledku porovnání: ✓ obě pokrytí ≥ 99,5 %, ⚠ obě ≥ 90 %, jinak ✗ (i model s dírami / tělesy navíc, které předloha nemá) */
export const compareMark = (c: { coverage: number; modelCoverage: number }) => (c.coverage >= 99.5 && c.modelCoverage >= 99.5 ? "✓" : c.coverage >= 90 && c.modelCoverage >= 90 ? "⚠" : "✗");

export function compareLines(c: RefCompare, svgName?: string): string[] {
  const out = [
    tr("{0} porovnání pohled {1} × předloha {2} (tolerance {3} mm): předloha pokryta modelem {4} %, model pokryt předlohou {5} % (délky {6} / {7} mm; sesouhlasení otočení {8}°{9}, posun {10})", compareMark(c), c.view, c.refView, nf(c.tolerance), nf(c.coverage, 1), nf(c.modelCoverage, 1), nf(c.refLength, 1), nf(c.modelLength, 1), c.align.rot, c.align.mirror ? tr(", zrcadleně") : "", `${nf(c.align.dx, 3)}; ${nf(c.align.dy, 3)}`),
  ];
  if (c.scale !== undefined) out.push(tr("· měřítko geometrie pohledu předlohy zadané příkazem: {0} jednotek výkresu na 1 mm", nf(c.scale, 4)));
  if (c.forced) out.push(tr("· pohled předlohy zadaný ručně – bez kontroly velikosti"));
  if (c.visibleOnly) out.push(tr("· pohled předlohy nemá skryté hrany – porovnány jen viditelné hrany modelu (se skrytými: porovnat … se skrytými)"));
  if (c.threadLength) out.push(tr("· závity normálií: {0} mm předlohy (jádro d1) se shoduje s vrtákem modelu jen v toleranci {1} mm", nf(c.threadLength, 1), nf(c.threadTol ?? 0.15)));
  for (const m of c.mismatches.slice(0, 10)) out.push(m.side === "ref" ? tr("· chybí v modelu: úsek předlohy {0} mm u [{1}] (od levého dolního rohu pohledu), odchylka až {2} mm", nf(m.length, 2), pt(m.at), nf(m.dist, 3)) : tr("· navíc v modelu: úsek {0} mm u [{1}], odchylka až {2} mm", nf(m.length, 2), pt(m.at), nf(m.dist, 3)));
  if (svgName) out.push(tr("· obrázek překryvu: {0} ({1})", svgName, kb(c.svg.length)));
  return out;
}

/** `kontrola kót`: ✓ jen když se změřily všechny kontrolovatelné kóty a sedí; ⚠ když nějaká kóta nemá bod v modelu */
export function dimCheckLines(view: string, refView: string, rs: RefDimCheck[]): string[] {
  const ok = rs.filter((r) => r.ok);
  const bad = rs.filter((r) => !r.ok && r.how !== "none" && r.how !== "unchecked");
  const none = rs.filter((r) => r.how === "none");
  const un = rs.filter((r) => r.how === "unchecked");
  const mark = bad.length ? "✗" : none.length || !ok.length ? "⚠" : "✓";
  const out = [tr("{0} kontrola kót předlohy {1} × model (pohled {2}): {3} ✓, {4} ✗, {5} bez bodu v modelu, {6} nekontrolováno (úhel, závit, sražení)", mark, refView, view, ok.length, bad.length, none.length, un.length)];
  for (const r of bad.slice(0, 20)) out.push(tr("✗ kóta {0} „{1}“ [{2}]: model {3}", r.dim.id, dimLabel(r.dim), pt(r.dim.at), nf(r.model ?? NaN, 4)) + (r.note ? ` – ${r.note}` : ""));
  if (bad.length > 20) out.push(tr("· … dalších {0} ✗", bad.length - 20));
  for (const r of none.slice(0, 10)) out.push(tr("⚠ kóta {0} „{1}“ [{2}]: bod kóty v modelu nenalezen", r.dim.id, dimLabel(r.dim), pt(r.dim.at)));
  if (none.length > 10) out.push(tr("· … dalších {0} bez bodu", none.length - 10));
  for (const r of ok.filter((x) => x.how !== "value" || x.note).slice(0, 10)) out.push(tr("· kóta {0} „{1}“: model {2} – {3}", r.dim.id, dimLabel(r.dim), nf(r.model ?? NaN, 4), r.note ?? ""));
  return out;
}
