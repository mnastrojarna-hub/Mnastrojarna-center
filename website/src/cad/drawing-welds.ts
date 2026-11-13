/**
 * Značky svarů na výkrese (ISO 2553) generované z 3D svarů: každý svar dílu (housenka, tupý svar s úpravou, děrový,
 * bodový – výsledek stavby ve stavu prvku `status.data.weld`) i ruční Značka svaru s hranou dostane odkazovou čáru se šipkou
 * ke spoji v pohledu, kde je spoj nejlépe vidět (průřez svaru = pohled podél spoje), referenční čáru a značku s velikostí,
 * délkou × počtem (roztečí), oboustranností, svarem kolem, montážním svarem a metodou. Ruční značky bez hrany se vypíšou
 * pod sebe vlevo dole. Kreslí se do čar a textů listu – tedy do SVG, DXF, DWG i PDF.
 */
import { tr } from "./i18n";
import type { DText, Poly } from "./drawing";
import type { CadDoc, FeatureStatus, Vec2, Vec3 } from "./types";
import { weldInfoOf } from "./ext/weld-table";
import { symbolData, symbolText, weldSymbolGeometry, type SymbolData, type SymbolKind } from "./ext/weld-symbol";
import type { WeldAnchor, WeldInfo } from "./ext/weld-calc";

export type WeldMark = { id: string; label: string; sym: SymbolData; anchor: WeldAnchor | null };

const PREP_KIND: Record<string, SymbolKind> = { I: "I", V: "V", Y: "Y", X: "X", U: "U", UU: "UU", HV: "halfV", HY: "HY", K: "K", J: "J", JJ: "JJ" };

/** Značka svaru ISO 2553 z výsledku 3D svaru. */
export function symbolOfWeld(w: WeldInfo): SymbolData {
  const base: SymbolData = { kind: "fillet", size: 0, length: 0, pitch: 0, allAround: !!w.allAround, field: !!w.field, otherSide: false, note: "", ...(w.process ? { process: w.process } : {}) };
  switch (w.kind) {
    case "fillet":
      return { ...base, kind: "fillet", size: Math.round((w.sizeLabel === "z" ? (w.z ?? w.size) : (w.a ?? w.size)) * 10) / 10, prefix: w.sizeLabel === "z" ? "z" : "a", ...(w.segLen && w.pitch ? { length: w.segLen, pitch: w.pitch, count: Math.max(1, Math.round(w.count / (w.both ? 2 : 1))) } : {}), ...(w.both ? { both: true } : {}) };
    case "groove":
      return { ...base, kind: PREP_KIND[w.prep ?? "V"] ?? "V", size: Math.round((w.t ?? w.size) * 10) / 10, prefix: "s", ...(w.angle ? { angle: w.angle } : {}), ...(w.g ? { gap: Math.round(w.g * 10) / 10 } : {}), ...(w.c ? { rootFace: w.c } : {}), ...(w.backing ? { backing: true } : {}) };
    case "plug":
      return { ...base, kind: "plug", size: w.size, prefix: "Ø", ...(w.count > 1 ? { count: w.count, pitch: w.pitch ?? 0 } : {}) };
    case "slot":
      return { ...base, kind: "plug", size: w.size, prefix: "c", length: w.slotLen ?? 0, ...(w.count > 1 ? { count: w.count, pitch: w.pitch ?? 0 } : {}) };
    case "spot":
      return { ...base, kind: "spot", size: w.size, prefix: "Ø", ...(w.count > 1 ? { count: w.count, pitch: w.pitch ?? 0 } : {}) };
  }
}

/** Má díl svary (prvky karty Svařence s výsledkem pro výkres)? */
export const hasWelds = (doc: CadDoc) => doc.kind !== "assembly" && doc.features.some((f) => f.type === "ext" && !f.suppressed && (f.ext === "weld.bead" || f.ext === "weld.groove" || f.ext === "weld.plug" || f.ext === "weld.spot" || f.ext === "weld.symbol"));

/** Značky svarů dílu z dokumentu a stavu prvků po stavbě (v pořadí historie). */
export function weldMarksOf(doc: CadDoc, status: FeatureStatus[] | null | undefined): WeldMark[] {
  const st = new Map((status ?? []).map((s) => [s.id, s]));
  const out: WeldMark[] = [];
  for (const f of doc.features) {
    if (f.type !== "ext" || f.suppressed || !f.ext.startsWith("weld.")) continue;
    const s = st.get(f.id);
    if (s?.ok === false) continue;
    if (f.ext === "weld.symbol") {
      const a = (s?.data as { weldMark?: { anchors?: WeldAnchor[] } } | undefined)?.weldMark?.anchors?.[0] ?? null;
      out.push({ id: f.id, label: f.name, sym: symbolData(f.data ?? {}), anchor: a });
      continue;
    }
    const w = weldInfoOf(s);
    if (!w) continue;
    out.push({ id: f.id, label: f.name, sym: symbolOfWeld(w), anchor: w.anchors?.[0] ?? null });
  }
  return out;
}

/** Pohled listu pro značky: kamera (směr pohledu), obdélník na listu a promítnutí bodu modelu na list. */
export type WeldView = { key: string; d: Vec3; rect: [number, number, number, number]; at: (p: Vec3) => Vec2 };
type Rect = { x: number; y: number; w: number; h: number };
const hit = (a: Rect, b: Rect) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
const dot = (a: Vec3, b: Vec3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
/** úsečka A–B protíná obdélník (Liang–Barsky) */
function segHitsRect(A: Vec2, B: Vec2, r: Rect): boolean {
  let t0 = 0;
  let t1 = 1;
  const dx = B[0] - A[0];
  const dy = B[1] - A[1];
  const clip = (p: number, q: number) => {
    if (Math.abs(p) < 1e-12) return q >= 0;
    const t = q / p;
    if (p < 0) {
      if (t > t1) return false;
      if (t > t0) t0 = t;
    } else {
      if (t < t0) return false;
      if (t < t1) t1 = t;
    }
    return true;
  };
  return clip(-dx, A[0] - r.x) && clip(dx, r.x + r.w - A[0]) && clip(-dy, A[1] - r.y) && clip(dy, r.y + r.h - A[1]) && t0 <= t1;
}

/**
 * Nakreslí značky do listu. `views` = pravoúhlé pohledy (bez izometrie), `busy` = obsazená místa (pohledy, razítko, tabulky),
 * `bounds` = vnitřek rámu. Vrací počet umístěných značek a texty legendy (ruční značky bez hrany).
 */
export function weldSymbolsOnSheet(marks: WeldMark[], views: WeldView[], polys: Poly[], texts: DText[], bounds: { left: number; right: number; top: number; bottom: number }, busy: Rect[] = []): { placed: number; legend: number } {
  const used: Rect[] = [];
  let placed = 0;
  const legend: WeldMark[] = [];
  const L = 30;
  for (const m of marks) {
    if (!m.anchor || !views.length) {
      legend.push(m);
      continue;
    }
    const a = m.anchor;
    // pohled, ve kterém je vidět průřez svaru (pohled podél spoje); jinak první
    const v = [...views].sort((p, q) => Math.abs(dot(q.d, a.dir)) - Math.abs(dot(p.d, a.dir)))[0];
    const tip = v.at(a.p);
    const [rx, ry, rw, rh] = v.rect;
    const cx = rx + rw / 2;
    const cy = ry + rh / 2;
    // směr odkazu: ven ze svaru (průmět), jinak od středu pohledu
    const q = v.at([a.p[0] + a.out[0] * 10, a.p[1] + a.out[1] * 10, a.p[2] + a.out[2] * 10]);
    let dx = q[0] - tip[0];
    let dy = q[1] - tip[1];
    if (Math.hypot(dx, dy) < 1e-6) {
      dx = tip[0] - cx;
      dy = tip[1] - cy;
    }
    if (Math.hypot(dx, dy) < 1e-6) dy = -1;
    const l = Math.hypot(dx, dy);
    dx /= l;
    dy /= l;
    // ze šipky šikmo ven z obdélníku pohledu (+ 10 mm)
    const exit = (t: number) => {
      const x = tip[0] + dx * t;
      const y = tip[1] + dy * t;
      return x < rx || x > rx + rw || y < ry || y > ry + rh;
    };
    let t = 0;
    while (t < 400 && !exit(t)) t += 1;
    let knee: Vec2 = [tip[0] + dx * (t + 10), tip[1] + dy * (t + 10)];
    let flip = knee[0] < cx;
    const rectOf = (k: Vec2, f: boolean): Rect => ({ x: f ? k[0] - L - 12 : k[0] - 3, y: k[1] - 10, w: L + 15, h: 17 });
    // v rámu a bez překryvu s jinou značkou / pohledem (posun po 9 mm svisle)
    // odkazová čára nesmí křížit jiný pohled
    const others = views.filter((o) => o !== v).map((o) => ({ x: o.rect[0], y: o.rect[1], w: o.rect[2], h: o.rect[3] }));
    const fit = (k: Vec2, f: boolean, from: Vec2 = tip) => {
      const rr = rectOf(k, f);
      return rr.x >= bounds.left && rr.x + rr.w <= bounds.right && rr.y >= bounds.top && rr.y + rr.h <= bounds.bottom && !used.some((u) => hit(u, rr)) && !busy.some((u) => hit(u, rr)) && !others.some((o) => segHitsRect(from, k, o));
    };
    let ok = false;
    let tipAt = tip;
    let sym = m.sym;
    // nejdřív dál ve směru odkazu (ven ze svaru); u tupého svaru i z druhé strany spoje (šipka na kořen = značka „druhá strana“);
    // pak svisle kolem
    const back = a.depth && a.depth > 0 ? v.at([a.p[0] - a.out[0] * a.depth, a.p[1] - a.out[1] * a.depth, a.p[2] - a.out[2] * a.depth]) : null;
    let tb = 0;
    if (back) while (tb < 400 && !(back[0] - dx * tb < rx || back[0] - dx * tb > rx + rw || back[1] - dy * tb < ry || back[1] - dy * tb > ry + rh)) tb += 1;
    const tries: { k: Vec2; other: boolean }[] = [];
    for (let j = 0; j < 14; j++) tries.push({ k: [tip[0] + dx * (t + 10 + j * 7), tip[1] + dy * (t + 10 + j * 7)], other: false });
    if (back) for (let j = 0; j < 14; j++) tries.push({ k: [back[0] - dx * (tb + 10 + j * 7), back[1] - dy * (tb + 10 + j * 7)], other: true });
    for (let k = 1; k < 24; k++) tries.push({ k: [knee[0], knee[1] + (k % 2 ? -1 : 1) * Math.ceil(k / 2) * 9], other: false });
    for (const tr0 of tries) {
      const kk = tr0.k;
      for (const f of [kk[0] < cx, kk[0] >= cx]) {
        if (fit(kk, f, tr0.other && back ? back : tip)) {
          knee = kk;
          flip = f;
          ok = true;
          if (tr0.other && back) {
            tipAt = back;
            sym = { ...m.sym, otherSide: !m.sym.otherSide };
          }
          break;
        }
      }
      if (ok) break;
    }
    if (!ok) {
      knee = [Math.max(bounds.left + L + 14, Math.min(bounds.right - L - 14, knee[0])), Math.max(bounds.top + 10, Math.min(bounds.bottom - 8, knee[1]))];
    }
    used.push(rectOf(knee, flip));
    const g = weldSymbolGeometry(sym, knee, tipAt, { flip, len: L });
    polys.push(...g.polys);
    texts.push(...g.texts);
    placed++;
  }
  // ruční značky bez umístění: seznam vlevo dole
  if (legend.length) {
    let y = bounds.bottom - 4 - (legend.length - 1) * 5;
    texts.push({ x: bounds.left + 2, y: y - 5, s: tr("Svary:"), size: 2.5, bold: true, layer: "text" });
    for (const m of legend) {
      texts.push({ x: bounds.left + 2, y, s: `${m.label}: ${symbolText(m.sym)}`, size: 2.5, layer: "text" });
      y += 5;
    }
  }
  return { placed, legend: legend.length };
}
