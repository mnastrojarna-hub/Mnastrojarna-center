/**
 * Náhradní geometrie poznámek pro zápis do DWG / DXF: obsah anonymního bloku kóty (*D…) – kótovací a vynášecí čáry,
 * šipky, text – a rozklad MTEXT / odkazu / tolerance / šrafy na entity R12. Použije se, jen když druh entity
 * (balík 2 – annot) nedodá vlastní `explode` (ten má přednost, aby soubor vypadal stejně jako výkres v aplikaci).
 * Styl: ISO-25 (DIMTXT 2,5, DIMASZ 2,5, DIMEXE 1,25, DIMEXO 0,625, DIMGAP 0,625, DIMDEC 2, DIMDSEP „,“, DIMTAD 1).
 */
import type { DDimension, DLeader, DMText, DTolerance } from "../annot/types";
import type { DraftDimStyle, DraftModel, NewEntity, Vec2 } from "../model";
import { mtextPlain, norm360 } from "./common";

export const ISO25: Required<Pick<DraftDimStyle, "dimscale" | "dimtxt" | "dimasz" | "dimexe" | "dimexo" | "dimgap" | "dimdec" | "dimadec" | "dimlfac" | "dimtad" | "dimzin" | "dimdsep" | "dimcen" | "dimpost">> = {
  dimscale: 1,
  dimtxt: 2.5,
  dimasz: 2.5,
  dimexe: 1.25,
  dimexo: 0.625,
  dimgap: 0.625,
  dimdec: 2,
  dimadec: 0,
  dimlfac: 1,
  dimtad: 1,
  dimzin: 8,
  dimdsep: ",",
  dimcen: 2.5,
  dimpost: "",
};
export type DimStyleR = DraftDimStyle & typeof ISO25;

/** kótovací styl entity: ISO-25 ← styl z modelu ← přepsání u kóty */
export function dimStyleOf(model: DraftModel, name: string | undefined, overrides?: Partial<DraftDimStyle>): DimStyleR {
  const n = (name ?? model.vars.dimstyle ?? "ISO-25").toLowerCase();
  const st = model.dimStyles?.find((d) => d.name.toLowerCase() === n) ?? model.dimStyles?.[0];
  const clean = (o: object | undefined) => Object.fromEntries(Object.entries(o ?? {}).filter(([, v]) => v !== undefined));
  return { ...ISO25, ...clean(st), ...clean(overrides), name: st?.name ?? name ?? "ISO-25" } as DimStyleR;
}

const add = (a: Vec2, b: Vec2): Vec2 => [a[0] + b[0], a[1] + b[1]];
const sub = (a: Vec2, b: Vec2): Vec2 => [a[0] - b[0], a[1] - b[1]];
const mul = (a: Vec2, k: number): Vec2 => [a[0] * k, a[1] * k];
const dot = (a: Vec2, b: Vec2) => a[0] * b[0] + a[1] * b[1];
const len = (a: Vec2) => Math.hypot(a[0], a[1]);
const unit = (a: Vec2): Vec2 => {
  const l = len(a) || 1;
  return [a[0] / l, a[1] / l];
};
const perp = (a: Vec2): Vec2 => [-a[1], a[0]];
const angOf = (a: Vec2) => Math.atan2(a[1], a[0]);
const dirOf = (r: number): Vec2 => [Math.cos(r), Math.sin(r)];
const R2D = 180 / Math.PI;

/** číslo podle stylu: DIMDEC, DIMDSEP, DIMZIN (8 = bez koncových nul), DIMLFAC, DIMRND */
export function fmtDim(v: number, st: DimStyleR, angular = false): string {
  const dec = angular ? st.dimadec ?? 0 : st.dimdec;
  let x = angular ? v : v * (st.dimlfac || 1);
  if (st.dimrnd && st.dimrnd > 0) x = Math.round(x / st.dimrnd) * st.dimrnd;
  let s = x.toFixed(Math.max(0, Math.min(8, dec)));
  const zin = angular ? st.dimazin ?? 0 : st.dimzin;
  if (zin & 8 || (angular && zin & 2)) s = s.includes(".") ? s.replace(/0+$/, "").replace(/\.$/, "") : s;
  if (zin & 4 && /^-?0\./.test(s)) s = s.replace(/^(-?)0\./, "$1.");
  if (s === "-0") s = "0";
  return s.replace(".", angular ? "." : st.dimdsep || ".");
}

/** text kóty: přepis (`<>` = naměřená hodnota), jinak předpona + hodnota + DIMPOST */
export function dimText(e: DDimension, value: string, st: DimStyleR): string {
  const post = st.dimpost && st.dimpost.includes("<>") ? st.dimpost.replace("<>", value) : value + (st.dimpost ?? "");
  if (e.text === undefined || e.text === "") return post;
  return e.text.replace(/<>/g, post);
}

type Out = NewEntity[];
const line = (a: Vec2, b: Vec2): NewEntity => ({ type: "line", a, b }) as NewEntity;
/** plná šipka: trojúhelník (SOLID) se špičkou v `tip` směřující proti `dir` */
function arrow(out: Out, tip: Vec2, dir: Vec2, size: number) {
  if (size <= 0) return;
  const d = unit(dir);
  const n = perp(d);
  const back = add(tip, mul(d, size));
  const w = size / 6;
  const a = add(back, mul(n, w));
  const b = add(back, mul(n, -w));
  out.push({ type: "hatch", pattern: "SOLID", solid: true, scale: 1, angle: 0, loops: [{ pts: [tip, a, b], outer: true }], ext: { dxf: "SOLID" } } as NewEntity);
}
function textAt(out: Out, s: string, p: Vec2, h: number, rotRad: number, valign: "middle" | "bottom" = "middle") {
  let r = norm360(rotRad * R2D);
  if (r > 90.0001 && r <= 270.0001) r = norm360(r - 180); // čitelný text
  out.push({ type: "text", p, h, s, rot: r, halign: "center", valign } as NewEntity);
}

/** Geometrie kóty (obsah bloku *D) ve světových souřadnicích. */
export function dimensionGeometry(e: DDimension, model: DraftModel): { ents: NewEntity[]; measurement: number } {
  const st = dimStyleOf(model, e.style, e.overrides);
  const k = st.dimscale || 1;
  const txt = st.dimtxt * k;
  const asz = st.dimasz * k;
  const exe = st.dimexe * k;
  const exo = st.dimexo * k;
  const gap = st.dimgap * k;
  const out: Out = [];
  let meas = 0;
  const z: Vec2 = [0, 0];
  switch (e.kind) {
    case "linear":
    case "aligned": {
      const p1 = e.p1 ?? z;
      const p2 = e.p2 ?? z;
      const lp = e.line ?? p2;
      const dir: Vec2 = e.kind === "aligned" ? unit(sub(p2, p1)) : dirOf(((e.rot ?? 0) * Math.PI) / 180);
      const n = perp(dir);
      // průměty bodů na kótovací čáru procházející `lp`
      const q1 = add(lp, mul(dir, dot(sub(p1, lp), dir)));
      const q2 = add(lp, mul(dir, dot(sub(p2, lp), dir)));
      meas = Math.abs(dot(sub(q2, q1), dir));
      for (const [p, q] of [[p1, q1], [p2, q2]] as [Vec2, Vec2][]) {
        const v = sub(q, p);
        const L = len(v);
        if (L > 1e-12) {
          const u = mul(v, 1 / L);
          out.push(line(add(p, mul(u, Math.min(exo, L))), add(q, mul(u, exe))));
        }
      }
      out.push(line(q1, q2));
      const u = unit(sub(q2, q1));
      if (len(sub(q2, q1)) > 1e-12) {
        arrow(out, q1, u, asz);
        arrow(out, q2, mul(u, -1), asz);
      }
      const mid = mul(add(q1, q2), 0.5);
      const side = dot(n, sub(lp, p1)) >= 0 ? 1 : -1;
      const tp = e.textPos ?? add(mid, mul(n, side * (st.dimtad ? gap + txt / 2 : 0)));
      textAt(out, dimText(e, fmtDim(meas, st), st), tp, txt, angOf(u));
      break;
    }
    case "radius":
    case "diameter": {
      const isR = e.kind === "radius";
      const chord = e.chord ?? z;
      const c = isR ? e.center ?? z : mul(add(chord, e.far ?? chord), 0.5);
      const r = len(sub(chord, c));
      meas = isR ? r : 2 * r;
      const u = unit(sub(chord, c));
      const from = isR ? c : e.far ?? c;
      out.push(line(from, chord));
      arrow(out, chord, mul(u, -1), asz);
      if (!isR) arrow(out, from, u, asz);
      const tp = e.textPos ?? add(c, mul(u, r / 2));
      textAt(out, (isR ? "R" : "Ø") + dimText(e, fmtDim(meas, st), st), add(tp, mul(perp(u), gap + txt / 2)), txt, angOf(u));
      break;
    }
    case "angular":
    case "angular3": {
      let v: Vec2, a1: Vec2, a2: Vec2;
      if (e.kind === "angular3") {
        v = e.vertex ?? z;
        a1 = e.p1 ?? z;
        a2 = e.p2 ?? z;
      } else {
        const [s1, e1] = e.l1 ?? [z, z];
        const [s2, e2] = e.l2 ?? [z, z];
        // průsečík přímek
        const d1 = sub(e1, s1);
        const d2 = sub(e2, s2);
        const den = d1[0] * d2[1] - d1[1] * d2[0];
        const t = Math.abs(den) < 1e-15 ? 0 : ((s2[0] - s1[0]) * d2[1] - (s2[1] - s1[1]) * d2[0]) / den;
        v = add(s1, mul(d1, t));
        a1 = len(sub(e1, v)) > len(sub(s1, v)) ? e1 : s1;
        a2 = len(sub(e2, v)) > len(sub(s2, v)) ? e2 : s2;
      }
      const arcP = e.arc ?? add(v, mul(unit(add(unit(sub(a1, v)), unit(sub(a2, v)))), len(sub(a1, v))));
      const R = len(sub(arcP, v));
      let t1 = angOf(sub(a1, v));
      let t2 = angOf(sub(a2, v));
      const ta = angOf(sub(arcP, v));
      const ccwSpan = (from: number, to: number) => (((to - from) % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI);
      if (ccwSpan(t1, ta) > ccwSpan(t1, t2)) [t1, t2] = [t2, t1];
      const span = ccwSpan(t1, t2);
      meas = span * R2D;
      out.push({ type: "arc", c: v, r: R, a0: norm360(t1 * R2D), a1: norm360(t2 * R2D) } as NewEntity);
      for (const [t, p] of [[t1, a1], [t2, a2]] as [number, Vec2][]) {
        const d = len(sub(p, v));
        if (R > d + 1e-9) out.push(line(add(v, mul(dirOf(t), d + exo)), add(v, mul(dirOf(t), R + exe))));
      }
      const e1p = add(v, mul(dirOf(t1), R));
      const e2p = add(v, mul(dirOf(t2), R));
      arrow(out, e1p, dirOf(t1 + Math.PI / 2), asz);
      arrow(out, e2p, dirOf(t2 - Math.PI / 2), asz);
      const tm = t1 + span / 2;
      const tp = e.textPos ?? add(v, mul(dirOf(tm), R + gap + txt / 2));
      textAt(out, dimText(e, fmtDim(meas, st, true) + "°", st), tp, txt, tm - Math.PI / 2);
      break;
    }
    case "ordinate": {
      const o = e.origin ?? z;
      const f = e.p1 ?? z;
      const l = e.p2 ?? f;
      meas = Math.abs(e.xAxis ? f[0] - o[0] : f[1] - o[1]);
      out.push(line(f, l));
      const u = unit(sub(l, f));
      textAt(out, dimText(e, fmtDim(meas, st), st), add(l, mul(u, gap + txt)), txt, e.xAxis ? Math.PI / 2 : 0);
      break;
    }
    case "arc": {
      const c = e.center ?? z;
      const p1 = e.p1 ?? z;
      const p2 = e.p2 ?? z;
      const arcP = e.arc ?? p1;
      const R = len(sub(arcP, c));
      const r0 = len(sub(p1, c));
      let t1 = angOf(sub(p1, c));
      let t2 = angOf(sub(p2, c));
      const ta = angOf(sub(arcP, c));
      const ccwSpan = (from: number, to: number) => (((to - from) % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI);
      if (ccwSpan(t1, ta) > ccwSpan(t1, t2)) [t1, t2] = [t2, t1];
      const span = ccwSpan(t1, t2);
      meas = span * r0;
      out.push({ type: "arc", c, r: R, a0: norm360(t1 * R2D), a1: norm360(t2 * R2D) } as NewEntity);
      out.push(line(add(c, mul(dirOf(t1), r0 + exo)), add(c, mul(dirOf(t1), R + exe))));
      out.push(line(add(c, mul(dirOf(t2), r0 + exo)), add(c, mul(dirOf(t2), R + exe))));
      arrow(out, add(c, mul(dirOf(t1), R)), dirOf(t1 + Math.PI / 2), asz);
      arrow(out, add(c, mul(dirOf(t2), R)), dirOf(t2 - Math.PI / 2), asz);
      const tm = t1 + span / 2;
      textAt(out, "⌒" + dimText(e, fmtDim(meas, st), st), e.textPos ?? add(c, mul(dirOf(tm), R + gap + txt / 2)), txt, tm - Math.PI / 2);
      break;
    }
  }
  return { ents: out, measurement: meas };
}

/** MTEXT → řádky TEXT (R12): připojení 1–9, řádkování 5/3 × výška × faktor, natočení */
export function mtextAsText(e: DMText): NewEntity[] {
  const lines = mtextPlain(e.s);
  const h = e.h;
  const step = (5 / 3) * h * (e.lineSpacing ?? 1);
  const a = ((e.rot ?? 0) * Math.PI) / 180;
  const dir: Vec2 = [Math.cos(a), Math.sin(a)];
  const up = perp(dir);
  const att = e.attach ?? 1;
  const col = (att - 1) % 3; // 0 vlevo, 1 střed, 2 vpravo
  const row = Math.floor((att - 1) / 3); // 0 nahoře, 1 uprostřed, 2 dole
  const total = h + step * (lines.length - 1);
  const top = row === 0 ? 0 : row === 1 ? total / 2 : total;
  const halign = (["left", "center", "right"] as const)[col];
  return lines.map((s, i) => {
    const off = top - h - i * step;
    const p = add(e.p, mul(up, off));
    return { type: "text", p, h, s, rot: e.rot ?? 0, halign, ...(e.style ? { style: e.style } : {}) } as NewEntity;
  });
}

/** odkaz (LEADER) → křivka + šipka + text (R12 / náhradní geometrie) */
export function leaderGeometry(e: DLeader, model: DraftModel): NewEntity[] {
  const st = dimStyleOf(model, undefined);
  const out: Out = [];
  if (e.pts.length >= 2) {
    out.push({ type: "polyline", pts: e.pts } as NewEntity);
    if (e.arrow !== "_NONE") arrow(out, e.pts[0], sub(e.pts[1], e.pts[0]), e.arrowSize ?? st.dimasz * (st.dimscale || 1));
  }
  if (e.text) {
    const last = e.pts[e.pts.length - 1] ?? [0, 0];
    out.push(...mtextAsText({ type: "mtext", id: "", layer: "0", p: e.textPos ?? last, h: e.textH ?? st.dimtxt, w: 0, s: e.text, attach: 4 }));
  }
  return out;
}

/** tolerance (TOLERANCE) → rámeček s textem (R12 / náhradní geometrie) */
/** znaky písma gdt.shx (malá písmena) → značky Unicode (náhrada, když buňka obsahuje i jiný text malými písmeny) */
const GDT_UNI: Record<string, string> = { a: "∠", b: "⊥", c: "⏥", d: "⌓", e: "○", f: "∥", g: "⌭", h: "↗", i: "⌯", j: "⌖", k: "⌒", l: "Ⓛ", m: "Ⓜ", n: "Ø", p: "Ⓟ", r: "◎", s: "Ⓢ", t: "⌰", u: "⏤" };

/**
 * Rámeček tolerance (TOLERANCE) → texty a čáry (R12). Buňka se značkami {\Fgdt;x} se zapíše jedním textem
 * s příznakem `gdt` (zapisovač mu dá styl s písmem gdt.shx – malá písmena jsou značky, číslice a velká písmena běžné
 * znaky, jako v AutoCADu); obsahuje-li buňka i jiný text malými písmeny, značky se nahradí znaky Unicode.
 */
export function toleranceGeometry(e: DTolerance): NewEntity[] {
  const cellsText = e.s.split(/%%v/i).map((x) => {
    const gdt = /\{\\Fgdt;[a-z]+\}/i.test(x);
    const rest = mtextPlain(x.replace(/\{\\Fgdt;[a-z]+\}/gi, "")).join(" ");
    if (gdt && !/[a-z]/.test(rest)) return { s: mtextPlain(x.replace(/\{\\Fgdt;([a-z]+)\}/gi, (_m, l: string) => l.toLowerCase())).join(" ").trim(), gdt: true };
    return { s: mtextPlain(x.replace(/\{\\Fgdt;([a-z]+)\}/gi, (_m, l: string) => [...l.toLowerCase()].map((c) => GDT_UNI[c] ?? c).join(""))).join(" ").trim(), gdt: false };
  });
  const parts = cellsText.map((c) => c.s);
  const h = e.h;
  const a = ((e.rot ?? 0) * Math.PI) / 180;
  const dir: Vec2 = [Math.cos(a), Math.sin(a)];
  const up = perp(dir);
  const out: Out = [];
  let x = 0;
  const H = 2 * h;
  const cells: number[] = [];
  for (const [i, p] of parts.entries()) {
    const w = Math.max(H, (p.length * 0.8 + 1) * h);
    cells.push(w);
    out.push({ type: "text", p: add(e.p, add(mul(dir, x + w / 2), mul(up, -H / 2))), h, s: p, rot: e.rot ?? 0, halign: "middle", ...(cellsText[i].gdt ? { gdt: true } : {}) } as NewEntity);
    x += w;
  }
  const P = (u: number, v: number) => add(e.p, add(mul(dir, u), mul(up, v)));
  out.push({ type: "polyline", pts: [P(0, 0), P(x, 0), P(x, -H), P(0, -H)], closed: true } as NewEntity);
  let xx = 0;
  for (const w of cells.slice(0, -1)) {
    xx += w;
    out.push(line(P(xx, 0), P(xx, -H)));
  }
  return out;
}
