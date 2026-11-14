/**
 * BALÍK 1 (edit) – POLE (obdélníkové, polární, po dráze – neasociativní kopie), ROZDĚLIT (DIVIDE) a ROZMĚŘIT (MEASURE):
 * body nebo bloky v rovnoměrných délkových odstupech po objektu.
 */
import { tr } from "../../i18n";
import { registerCommand, type CmdCtx, type CmdGen, type Input, type Prompt } from "../commands";
import { add, angleOf, boxUnion, deg, emptyBox, isEmptyBox, mul, rad, xfMove, xfMul, xfRotate, type Affine } from "../geom";
import { entityBox } from "../kinds";
import type { DraftEntity, NewEntity, Vec2 } from "../model";
import { nearEnd } from "./cut";
import { editCurve, type EC } from "./param";
import { doneSel, editState, EK, entityAfterSelect, kc, nothing, pickObjects, transformIds, unlocked, askKw } from "./shared";

/** obálka výběru */
function selBox(c: CmdCtx, ids: string[]) {
  let b = emptyBox();
  for (const id of ids) {
    const e = c.tx.get(id);
    const eb = e && entityBox(e, kc(c));
    if (eb) b = boxUnion(b, eb);
  }
  return isEmptyBox(b) ? null : b;
}

/** kopie výběru pro každou transformaci (vynechá identitu) */
function copies(c: CmdCtx, ids: string[], xfs: Affine[]): number {
  let n = 0;
  for (const m of xfs) n += transformIds(c, ids, m, true).length;
  return n;
}

// ---------------------------------------------------------------- obdélníkové

/** transformace obdélníkového pole (bez položky 0,0) */
export function rectXfs(cols: number, rows: number, dx: number, dy: number, angDeg = 0): Affine[] {
  const out: Affine[] = [];
  const a = rad(angDeg);
  const u: Vec2 = [Math.cos(a), Math.sin(a)];
  const v: Vec2 = [-Math.sin(a), Math.cos(a)];
  for (let j = 0; j < rows; j++)
    for (let i = 0; i < cols; i++) {
      if (!i && !j) continue;
      const d = add(mul(u, i * dx), mul(v, j * dy));
      out.push(xfMove(d[0], d[1]));
    }
  return out;
}

function* rectArray(c: CmdCtx, ids: string[]): Generator<Prompt, void, Input> {
  const st = editState(c);
  const b = selBox(c, ids);
  const w = b ? b.x1 - b.x0 : 10;
  const h = b ? b.y1 - b.y0 : 10;
  const cols = yield { k: "int", msg: tr("Zadejte počet sloupců"), def: st.arrCols, min: 1, max: 100000 };
  if (cols.k !== "num") return;
  const rows = yield { k: "int", msg: tr("Zadejte počet řádků"), def: st.arrRows, min: 1, max: 100000 };
  if (rows.k !== "num") return;
  if (cols.v * rows.v > 100000) throw new Error(tr("pole by mělo víc než 100 000 položek"));
  st.arrCols = cols.v;
  st.arrRows = rows.v;
  const dx = yield { k: "dist", msg: tr("Zadejte vzdálenost sloupců"), def: Math.round(w * 1.5 * 1e6) / 1e6 || 10 };
  if (dx.k !== "num") return;
  const dy = yield { k: "dist", msg: tr("Zadejte vzdálenost řádků"), def: Math.round(h * 1.5 * 1e6) / 1e6 || 10 };
  if (dy.k !== "num") return;
  const an = yield { k: "angle", msg: tr("Zadejte úhel pole"), def: 0 };
  const ang = an.k === "num" ? an.v : 0;
  const n = copies(c, ids, rectXfs(cols.v, rows.v, dx.v, dy.v, ang));
  c.out("items", cols.v * rows.v);
  c.log(tr("✓ obdélníkové pole {0} × {1}: {2} nových entit", cols.v, rows.v, n));
}

// ---------------------------------------------------------------- polární

/** transformace polárního pole: n položek, vyplněný úhel [°] (360 = celý kruh), otáčet položky */
export function polarXfs(center: Vec2, n: number, fillDeg: number, rotate: boolean, ref: Vec2): Affine[] {
  const full = Math.abs(Math.abs(fillDeg) - 360) < 1e-9;
  const step = full ? fillDeg / n : fillDeg / (n - 1);
  const out: Affine[] = [];
  for (let k = 1; k < n; k++) {
    const m = xfRotate(rad(step * k), center);
    if (rotate) out.push(m);
    else {
      // bez otáčení: posun referenčního bodu výběru na otočenou polohu
      const r = [m[0] * ref[0] + m[2] * ref[1] + m[4], m[1] * ref[0] + m[3] * ref[1] + m[5]];
      out.push(xfMove(r[0] - ref[0], r[1] - ref[1]));
    }
  }
  return out;
}

function* polarArray(c: CmdCtx, ids: string[]): Generator<Prompt, void, Input> {
  const st = editState(c);
  const ce = yield { k: "point", msg: tr("Zadejte střed pole") };
  if (ce.k !== "point") return;
  const C = ce.p;
  const cnt = yield { k: "int", msg: tr("Zadejte počet položek"), def: st.arrPolarN, min: 2, max: 100000 };
  if (cnt.k !== "num") return;
  st.arrPolarN = cnt.v;
  const f = yield { k: "angle", msg: tr("Zadejte úhel vyplnění (+ proti směru hodin, − po směru)"), def: st.arrFill };
  if (f.k !== "num") return;
  if (Math.abs(f.v) < 1e-9 || Math.abs(f.v) > 360 + 1e-9) throw new Error(tr("úhel vyplnění musí být v rozsahu −360° až 360° (ne 0)"));
  st.arrFill = f.v;
  const r = yield* askKw(tr("Otáčet položky pole?"), [EK.yes, EK.no], "yes");
  const rot = !(r.k === "kw" && r.id === "no");
  const b = selBox(c, ids);
  const ref: Vec2 = b ? [(b.x0 + b.x1) / 2, (b.y0 + b.y1) / 2] : C;
  const xfs = polarXfs(C, cnt.v, f.v, rot, ref);
  const n = copies(c, ids, xfs);
  const full = Math.abs(Math.abs(f.v) - 360) < 1e-9;
  c.out("items", cnt.v);
  c.out("step", full ? f.v / cnt.v : f.v / (cnt.v - 1));
  c.log(tr("✓ polární pole {0} položek po {1}: {2} nových entit", cnt.v, c.fmt.ang(full ? f.v / cnt.v : f.v / (cnt.v - 1)), n));
}

// ---------------------------------------------------------------- po dráze

const isPath = (c: CmdCtx) => (e: DraftEntity) => {
  const ec = editCurve(e, kc(c));
  return !!ec && Number.isFinite(ec.lo) && Number.isFinite(ec.hi);
};

/** transformace pole po dráze: položky v délkách `s` od začátku, základní bod B, zarovnat s tečnou */
export function pathXfs(ec: EC, s: number[], B: Vec2, align: boolean): Affine[] {
  const u0 = ec.lo;
  const t0 = angleOf(ec.tan(u0));
  return s.map((len) => {
    const u = ec.atLen(u0, len);
    const P = ec.at(u);
    const mv = xfMove(P[0] - B[0], P[1] - B[1]);
    return align ? xfMul(xfRotate(angleOf(ec.tan(u)) - t0, P), mv) : mv;
  });
}

function* pathArray(c: CmdCtx, ids: string[]): Generator<Prompt, void, Input> {
  const p = yield* entityAfterSelect(c, tr("Vyberte dráhu"), isPath(c));
  if (p.k !== "ent") return;
  const path = c.tx.get(p.id)!;
  if (ids.includes(path.id)) throw new Error(tr("dráha nesmí být mezi kopírovanými objekty"));
  const ec = editCurve(path, kc(c))!;
  const L = ec.len(ec.lo, ec.hi);
  let B = ec.at(ec.lo);
  let method = "divide";
  for (;;) {
    const m = yield* askKw(tr("Metoda rozmístění"), [EK.divide, EK.measure, EK.base], method);
    if (m.k !== "kw") return;
    if (m.id === "base") {
      const b = yield { k: "point", msg: tr("Zadejte základní bod") };
      if (b.k === "point") B = b.p;
      continue;
    }
    method = m.id;
    break;
  }
  let s: number[] = [];
  if (method === "divide") {
    const n = yield { k: "int", msg: tr("Zadejte počet položek po dráze"), def: 6, min: 2, max: 100000 };
    if (n.k !== "num") return;
    const step = ec.periodic ? L / n.v : L / (n.v - 1);
    for (let i = 1; i < n.v; i++) s.push(step * i);
  } else {
    const d = yield { k: "dist", msg: tr("Zadejte vzdálenost položek"), min: 1e-9, def: L / 5 };
    if (d.k !== "num") return;
    for (let x = d.v; x <= L + 1e-9 * Math.max(1, L); x += d.v) s.push(Math.min(x, L));
    if (s.length > 100000) throw new Error(tr("pole by mělo víc než 100 000 položek"));
  }
  if (ec.periodic) s = s.filter((x) => x < L - 1e-9);
  const a = yield* askKw(tr("Zarovnat položky s dráhou?"), [EK.yes, EK.no], "yes");
  const align = !(a.k === "kw" && a.id === "no");
  const n = copies(c, ids, pathXfs(ec, s, B, align));
  c.out("items", s.length + 1);
  c.log(tr("✓ pole po dráze {0}: {1} položek, {2} nových entit", path.id, s.length + 1, n));
}

// ---------------------------------------------------------------- příkazy

registerCommand({
  id: "ARRAY",
  names: { cs: ["pole"], en: ["array"], de: ["reihe"] },
  alias: ["AR"],
  group: "modify",
  desc: () => tr("pole kopií vybraných entit: obdélníkové (sloupce, řádky, vzdálenosti, úhel), polární (střed, počet, úhel vyplnění, otáčet) nebo po dráze (rozdělit / měřit, zarovnat)"),
  usage: () => tr("pole e1 obdélníkové 4 3 20 15 | pole e1 polární 0,0 6 360 ano | pole e1 dráha e5 rozdělit 8 ano"),
  run: function* (c): CmdGen {
    const ids = unlocked(c, yield* pickObjects(c, tr("Vyberte objekty pole")));
    if (!ids.length) return nothing(c);
    const t = yield* askKw(tr("Typ pole"), [EK.rect, EK.polar, EK.path], "rectangular");
    if (t.k !== "kw") return;
    if (t.id === "polar") yield* polarArray(c, ids);
    else if (t.id === "path") yield* pathArray(c, ids);
    else yield* rectArray(c, ids);
    doneSel(c);
  },
});

registerCommand({
  id: "ARRAYRECT",
  names: { cs: ["pole-obdélníkové", "pole-obdelnikove"], en: ["arrayrect"], de: ["reiherechteck", "reihe-rechteckig"] },
  group: "modify",
  desc: () => tr("obdélníkové pole: počet sloupců a řádků, vzdálenost sloupců a řádků (záporná = opačný směr), úhel pole"),
  usage: () => tr("pole-obdélníkové e1 4 3 25 20 [úhel]"),
  run: function* (c): CmdGen {
    const ids = unlocked(c, yield* pickObjects(c, tr("Vyberte objekty pole")));
    if (!ids.length) return nothing(c);
    yield* rectArray(c, ids);
    doneSel(c);
  },
});

registerCommand({
  id: "ARRAYPOLAR",
  names: { cs: ["pole-polární", "pole-polarni"], en: ["arraypolar"], de: ["reihepolar", "reihe-polar"] },
  group: "modify",
  desc: () => tr("polární pole kolem středu: počet položek, úhel vyplnění (360 = rovnoměrně po kruhu), otáčet položky"),
  usage: () => tr("pole-polární e1 0,0 6 [360] [ano | ne]"),
  run: function* (c): CmdGen {
    const ids = unlocked(c, yield* pickObjects(c, tr("Vyberte objekty pole")));
    if (!ids.length) return nothing(c);
    yield* polarArray(c, ids);
    doneSel(c);
  },
});

registerCommand({
  id: "ARRAYPATH",
  names: { cs: ["pole-po-dráze", "pole-po-draze"], en: ["arraypath"], de: ["reihepfad", "reihe-pfad"] },
  group: "modify",
  desc: () => tr("pole po dráze (úsečka, oblouk, křivka, spline, elipsa): Rozdělit = počet položek, Měřit = vzdálenost; základní bod = začátek dráhy; zarovnat s tečnou"),
  usage: () => tr("pole-po-dráze e1 \"\" e5 rozdělit 8 ano | pole-po-dráze e1 e5@0,0 měřit 25 ne"),
  run: function* (c): CmdGen {
    const ids = unlocked(c, yield* pickObjects(c, tr("Vyberte objekty pole")));
    if (!ids.length) return nothing(c);
    yield* pathArray(c, ids);
    doneSel(c);
  },
});

// ---------------------------------------------------------------- ROZDĚLIT / ROZMĚŘIT

/** body (+ směr) na objektu: n dílů (DIVIDE) nebo po délce d od konce u bodu výběru (MEASURE) */
export function divideMarks(ec: EC, n: number): { p: Vec2; t: Vec2 }[] {
  const L = ec.len(ec.lo, ec.hi);
  const out: { p: Vec2; t: Vec2 }[] = [];
  const k0 = ec.periodic ? 0 : 1;
  for (let k = k0; k < n; k++) {
    const u = ec.atLen(ec.lo, (L * k) / n);
    out.push({ p: ec.at(u), t: ec.tan(u) });
  }
  return out;
}
export function measureMarks(ec: EC, d: number, fromEnd: boolean): { p: Vec2; t: Vec2 }[] {
  const L = ec.len(ec.lo, ec.hi);
  const out: { p: Vec2; t: Vec2 }[] = [];
  for (let s = d; s < L - 1e-9 * Math.max(1, L) || (Math.abs(s - L) <= 1e-9 * Math.max(1, L) && !ec.periodic); s += d) {
    if (out.length > 100000) break;
    const u = ec.atLen(ec.lo, fromEnd ? L - s : s);
    out.push({ p: ec.at(u), t: ec.tan(u) });
  }
  return out;
}

function* marks(c: CmdCtx, measure: boolean): CmdGen {
  const s = yield { k: "entity", msg: measure ? tr("Vyberte objekt k rozměření") : tr("Vyberte objekt k rozdělení"), filter: isPath(c) };
  if (s.k !== "ent") return;
  const e = c.tx.get(s.id)!;
  const ec = editCurve(e, kc(c))!;
  let block: string | null = null;
  let align = true;
  let val: number | null = null;
  for (;;) {
    const v: Input = measure ? yield { k: "dist", msg: tr("Zadejte délku úseku nebo"), kw: [EK.block], min: 1e-9 } : yield { k: "int", msg: tr("Zadejte počet dílů nebo"), kw: [EK.block], min: 2, max: 32767 };
    if (v.k === "num") {
      val = v.v;
      break;
    }
    if (v.k !== "kw") return;
    const nm = yield { k: "text", msg: tr("Zadejte název bloku") };
    if (nm.k !== "text" || !nm.s.trim()) return;
    const b = (c.tx.model.blocks ?? []).find((x) => x.name.toLowerCase() === nm.s.trim().toLowerCase());
    if (!b) throw new Error(tr("blok „{0}“ ve výkresu není", nm.s));
    block = b.name;
    const a = yield* askKw(tr("Zarovnat blok s objektem?"), [EK.yes, EK.no], "yes");
    align = !(a.k === "kw" && a.id === "no");
  }
  const fromEnd = measure && !ec.periodic && nearEnd(ec, s.p) === 1;
  const pts = measure ? measureMarks(ec, val, fromEnd) : divideMarks(ec, val);
  for (const m of pts) {
    if (block) c.tx.add({ type: "insert", block, p: m.p, sx: 1, sy: 1, rot: align ? ((deg(angleOf(m.t)) % 360) + 360) % 360 : 0 } as NewEntity);
    else c.tx.add({ type: "point", p: m.p } as NewEntity);
  }
  c.out("points", pts.map((m) => m.p));
  c.log(tr("✓ {0}: {1} {2}", e.id, pts.length, block ? tr("bloků {0}", block) : tr("bodů")));
}

registerCommand({
  id: "DIVIDE",
  names: { cs: ["rozdělit", "rozdelit"], en: ["divide"], de: ["teilen"] },
  alias: ["DIV"],
  group: "modify",
  desc: () => tr("rozdělí objekt na N stejně dlouhých dílů: na hranice dílů vloží body (nebo bloky, zarovnané s objektem)"),
  usage: () => tr("rozdělit e1 5 | rozdělit e1 blok ŠROUB ano 8"),
  run: (c) => marks(c, false),
});

registerCommand({
  id: "MEASURE",
  names: { cs: ["rozměřit", "rozmerit"], en: ["measure"], de: ["messen"] },
  alias: ["ME"],
  group: "modify",
  desc: () => tr("rozměří objekt úseky dané délky od konce u bodu výběru: vloží body (nebo bloky)"),
  usage: () => tr("rozměřit e1@0,0 25 | rozměřit e1 blok ŠROUB ne 40"),
  run: (c) => marks(c, true),
});

