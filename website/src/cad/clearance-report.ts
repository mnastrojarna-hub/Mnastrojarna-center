/**
 * Výstupy vůle a spojitosti kontroly kolizí pohybové studie (vlna 22, bod 6): souhrn studie, záznamy s kódem, strojová pole
 * řádku `= … motion …`, sloupce CSV, `pohyb krok N`, řádek „Pohyb:“ ve `stav`, `window.mncad.motion()` a úsečka vůle ve 3D.
 * Čisté funkce nad výsledkem studie (cad/motion-clearance.ts) – stejné v prohlížeči i v CLI.
 *
 * Zásada (owner, priorita 1): „žádný průnik v N polohách“ není „bez kolizí“ a nulový průnik není „nic nedře“. Každý souhrn kolizí
 * pohybu říká, JAK se kontrolovalo (diskrétně v polohách s největším posunem mezi nimi / spojitě i mezi polohami / částečně –
 * kde ne a proč); vůle s limitem se za splněnou vydává jen tehdy, když ji zjemnění potvrdilo i mezi polohami.
 */
import { fmtNum } from "./engine/protocol";
import { betweenSteps, fmtPt, leafLabel, nf, stepHasFault } from "./clash-report";
import { tr } from "./i18n";
import { clearanceOf, stepTravel, type ClearancePair, type SweepInfo } from "./motion-clearance";
import type { CadDoc, Placement, Vec3 } from "./types";

/** výsledek studie, jak ho výstupy potřebují (MotionResult s rozšířením) */
type Res = { steps: readonly { i: number; t: number; motors: readonly number[]; place?: Record<string, Placement>; clashes?: readonly unknown[] }[]; collisionsChecked: boolean };

const mm = (v: number) => nf(v, v < 0.1 ? 4 : 3);
/** název komponenty nejvyšší úrovně / instance listu */
const compName = (doc: CadDoc, id: string) => leafLabel(doc, [id]);
const pairName = (doc: CadDoc, p: Pick<ClearancePair, "a" | "b">) => `„${compName(doc, p.a)}“ × „${compName(doc, p.b)}“`;
/** úseky kroků „0–10, 14“ */
export function stepRanges(list: readonly number[], max = 6): string {
  const xs = [...new Set(list)].sort((a, b) => a - b);
  const out: string[] = [];
  for (let i = 0; i < xs.length; ) {
    let j = i;
    while (j + 1 < xs.length && xs[j + 1] === xs[j] + 1) j++;
    out.push(i === j ? String(xs[i]) : `${xs[i]}–${xs[j]}`);
    i = j + 1;
  }
  return out.length > max ? `${out.slice(0, max).join(", ")} …` : out.join(", ");
}
/** poloha minima: „v kroku 12 (t = 0,6 s)“, „mezi kroky 17 a 18 (po přímé dráze)“, „mezi kroky 17 a 18 (poloha 17,5; t = …)“ */
function whereText(m: NonNullable<ClearancePair["min"]>): string {
  const t = nf(m.t, 3);
  // poloha minima na přímé dráze dohledaná (kolo 6): poloha, čas a motory pro panel, úsečku i protokol
  // poloha v úseku jen interpolovaná podílem dráhy (řešič ji nepotvrdil – nerovnoměrný posuv, bez řešiče): „přibližně“
  if (m.between && m.sweep && m.located && m.approxAt) return tr("mezi kroky {0} a {1} (po přímé dráze: přibližně poloha {2}, t = {3} s, motory {4} – interpolováno podílem dráhy)", m.between[0], m.between[1], nf(m.pos, 3), t, m.motors.map((v) => nf(v, 3)).join("; ") || "–");
  if (m.between && m.sweep && m.located) return tr("mezi kroky {0} a {1} (po přímé dráze: poloha {2}, t = {3} s, motory {4})", m.between[0], m.between[1], nf(m.pos, 3), t, m.motors.map((v) => nf(v, 3)).join("; ") || "–");
  if (m.between && m.sweep) return tr("mezi kroky {0} a {1} (po přímé dráze)", m.between[0], m.between[1]);
  if (m.between) return tr("mezi kroky {0} a {1} (zjemněno: poloha {2}, t = {3} s)", m.between[0], m.between[1], nf(m.pos, 3), t);
  return tr("v kroku {0} (t = {1} s)", Math.round(m.pos), t);
}

/* ───────────────────────── spojitost kontroly kolizí ───────────────────────── */

/** největší posun mezi sousedními polohami z kroků (výsledek bez údajů o spojitosti) */
function travelOf(res: Res): { d: number; turn: number } {
  let d = 0;
  let turn = 0;
  for (let i = 1; i < res.steps.length; i++) {
    const a = res.steps[i - 1].place;
    const b = res.steps[i].place;
    if (!a || !b) continue;
    const x = stepTravel(a, b);
    d = Math.max(d, x.d);
    turn = Math.max(turn, x.turn);
  }
  return { d, turn };
}

/** spojitost kontroly výsledku; výsledek bez údaje (dřívější, bez jádra) = diskrétně */
export function sweepOf(res: Res): SweepInfo {
  const s = clearanceOf(res as never).sweep;
  if (s) return s;
  const tv = travelOf(res);
  const poses = res.steps.filter((x) => x.clashes !== undefined).length || res.steps.length;
  return { mode: "discrete", poses, refined: 0, bounded: 0, swept: 0, contacts: 0, covered: 0, unproven: 0, unprovenContact: 0, unprovenAt: [], maxStep: tv.d, maxTurn: tv.turn, between: "none" };
}

/** „posun mezi polohami až 5 mm / 10°“ */
function travelText(s: SweepInfo): string {
  const parts = [s.maxStep > 1e-9 ? `${mm(s.maxStep)} mm` : "", s.maxTurn > 1e-6 ? `${nf(s.maxTurn, 2)}°` : ""].filter(Boolean);
  return parts.length ? tr("posun mezi polohami až {0}", parts.join(" / ")) : tr("bez posunu mezi polohami");
}

/**
 * Jak se kolize v pohybu kontrolovaly (věta za „Kolize: …“): spojitě i mezi polohami / částečně (kde ne a proč) / diskrétně
 * v polohách s největším posunem mezi nimi a výslovně „mezi polohami nekontrolováno“.
 */
export function sweepLabel(res: Res): string {
  const s = sweepOf(res);
  if (s.mode === "continuous") {
    const how = [s.bounded ? tr("mez posunu {0}", s.bounded) : "", s.swept ? tr("dráha posuvu {0}", s.swept) : "", s.covered ? tr("průnik už v poloze {0}", s.covered) : ""].filter(Boolean).join(", ");
    return tr("kontrolováno spojitě i mezi polohami ({0} poloh + {1} mezipoloh ze zjemnění{2})", s.poses, s.refined, how ? `; ${tr("úseky")}: ${how}` : "") + (s.between === "frames" ? tr(", mezi sousedními snímky přímou dráhou") : "");
  }
  if (s.mode === "partial") {
    const why = [s.unprovenContact ? tr("dotyk bez objemu v poloze {0}×", s.unprovenContact) : "", s.unproven - s.unprovenContact ? tr("mez zjemnění {0}×", s.unproven - s.unprovenContact) : "", s.budget ? tr("vyčerpán rozpočet zjemnění") : ""].filter(Boolean).join(", ");
    return tr("spojitě jen částečně: {0} poloh + {1} mezipoloh, mezi polohami nepotvrzeno v {2} úsecích (od kroku {3}; {4}) – tam jen v polohách", s.poses, s.refined, s.unproven, s.unprovenAt.join(", "), why);
  }
  const why = s.why === "off" ? tr(" (spojitá kontrola vypnuta – pohyb kolize spojitě)") : s.why === "no-kernel" ? tr(" (jádro bez kontroly mezi polohami)") : "";
  return tr("kontrolováno jen v {0} polohách (diskrétně, {1}) – mezi polohami nekontrolováno{2}", s.poses, travelText(s), why);
}

/** strojová pole spojitosti na konec části kolizí řádku `= … motion …` */
export function sweepKv(res: Res): string[] {
  const s = sweepOf(res);
  const n = (v: number) => fmtNum(v, 3);
  return [`clash.mode=${s.mode}`, `clash.poses=${s.poses}`, `clash.refined=${s.refined}`, `clash.maxstep=${n(s.maxStep)}mm`, ...(s.unproven ? [`clash.unproven=${s.unproven}`] : [])];
}

/* ───────────────────────── sledovaná vůle ───────────────────────── */

/** dvojice pod limitem (nejmenší první) */
const belowPairs = (pairs: readonly ClearancePair[], limit: number | null) => (limit === null ? [] : pairs.filter((p) => p.min && p.min.d < limit));
/** úseky mezi kroky pod limitem: „17 a 18“, „17 a 18, 40 a 41“ */
const segText = (segs: readonly [number, number][]) => segs.map(([a, b]) => tr("{0} a {1}", a, b)).join(", ");

/** Řádky souhrnu studie o sledované vůli (prázdné, když se vůle nesledovala). */
export function clearanceSummaryLines(res: Res, doc: CadDoc): string[] {
  const c = clearanceOf(res as never).clearance;
  if (!c) return [];
  const out: string[] = [];
  const L = c.limit;
  const refine = doc.motion?.clearance?.refine !== false;
  if (!c.pairs.length) {
    out.push(c.moving ? tr("Vůle pohyblivých dílů: žádná dvojice blíž než {0} mm v kontrolovaných polohách ({1} poloh)", mm(c.reach ?? 0), c.poses) : tr("Vůle: dvojice nejde změřit (komponenta bez tělesa nebo skrytá)"));
    return out;
  }
  const shown = c.moving ? c.pairs.slice(0, 5) : c.pairs;
  if (c.moving) out.push(tr("Vůle pohyblivých dílů: dvojic blíž než {0} mm: {1}", mm(c.reach ?? 0), c.pairs.length));
  for (const p of shown) {
    if (!p.min) continue;
    const m = p.min;
    const val = m.exact ? `${mm(m.d)} mm` : tr("nejméně {0} mm (obálky)", mm(m.d));
    const place = m.p1 && m.p2 ? ` – ${tr("místo")} ${fmtPt(m.p1)} ↔ ${fmtPt(m.p2)}` : "";
    const of = p.series.filter((v) => v !== null && v !== undefined).length;
    let lim = "";
    if (L !== null) {
      // polohy kroků pod limitem a úseky MEZI kroky zvlášť (kolo 6: minimum mezi kroky 17 a 18 se nepočítá jako „krok 18“)
      const bb = p.belowBetween ?? [];
      if (m.d < L && p.below.length) lim = tr(" · ⚠ pod limitem {0} mm v {1} z {2} poloh (kroky {3})", mm(L), p.below.length, of, stepRanges(p.below)) + (bb.length ? tr("; mezi kroky {0}", segText(bb)) : "");
      else if (m.d < L && bb.length) lim = tr(" · ⚠ pod limitem {0} mm mezi kroky {1} (v polohách kroků nad limitem)", mm(L), segText(bb));
      else if (m.d < L) lim = tr(" · ⚠ pod limitem {0} mm v {1} z {2} poloh (kroky {3})", mm(L), p.below.length, of, stepRanges(p.below)) + (m.between ? tr(" · mezi polohami") : "");
      else if (refine && !p.unproven) lim = tr(" · limit {0} mm dodržen v celém pohybu (spojitě i mezi polohami)", mm(L));
      else lim = tr(" · limit {0} mm dodržen v {1} polohách (mezi polohami nepotvrzeno)", mm(L), of);
    }
    out.push(`${tr("Vůle {0}: nejmenší {1} {2}", pairName(doc, p), val, whereText(m))}${place}${lim}`);
  }
  if (c.moving && c.pairs.length > shown.length) out.push(tr(" … a dalších {0} dvojic (pohyb vůle seznam)", c.pairs.length - shown.length));
  return out;
}

/** záznam s kódem pro protokol */
export type ClrCode = { code: string; args?: unknown[]; text?: string };

/**
 * Záznamy s kódem: ⚠ `clash.clearance` za dvojici pod limitem (kroky, minimum, místo), ⚠ `clash.uncertain` když spojitá kontrola
 * kolizí nepotvrdila úseky, ℹ `clash.discrete` když se kolize kontrolovaly jen v polohách.
 */
export function clearanceCodes(res: Res, doc: CadDoc): ClrCode[] {
  const out: ClrCode[] = [];
  const ext = clearanceOf(res as never);
  const c = ext.clearance;
  if (c && c.limit !== null) {
    for (const p of belowPairs(c.pairs, c.limit).slice(0, 8)) {
      const m = p.min!;
      const a = compName(doc, p.a);
      const b = compName(doc, p.b);
      const place = m.p1 && m.p2 ? ` – ${tr("místo")} ${fmtPt(m.p1)} ↔ ${fmtPt(m.p2)}` : "";
      const bb = p.belowBetween ?? [];
      const head = !p.below.length && bb.length
        ? tr("vůle „{0}“ × „{1}“ {2} mm < {3} mm mezi kroky {4} (nejmenší {5})", a, b, mm(m.d), mm(c.limit), segText(bb), whereText(m))
        : tr("vůle „{0}“ × „{1}“ {2} mm < {3} mm v krocích {4} (nejmenší {5})", a, b, mm(m.d), mm(c.limit), stepRanges(p.below) || "–", whereText(m)) + (bb.length ? tr("; mezi kroky {0}", segText(bb)) : "");
      out.push({ code: "clash.clearance", args: [a, b, mm(m.d), mm(c.limit)], text: `${head}${place}` });
    }
  }
  if (res.collisionsChecked) {
    const s = sweepOf(res);
    if (s.mode === "partial") out.push({ code: "clash.uncertain", args: [s.unproven], text: tr("kolize mezi polohami nepotvrzeny v {0} úsecích (od kroku {1}) – tam jen v polohách; jemnější kroky: pohyb kroky N", s.unproven, s.unprovenAt.join(", ")) });
    else if (s.mode === "discrete") out.push({ code: "clash.discrete", args: [s.poses], text: sweepLabel(res) });
  }
  return out;
}

/** strojová pole vůle na konec řádku `= … motion …` (jen se sledovanou vůlí) */
export function clearanceKv(res: Res): string[] {
  const c = clearanceOf(res as never).clearance;
  if (!c) return [];
  const n = (v: number) => fmtNum(v, 4);
  const best = c.pairs.find((p) => p.min);
  if (!best?.min) return [`clear.pairs=0`, ...(c.limit !== null ? [`clear.limit=${n(c.limit)}`] : [])];
  const m = best.min;
  const of = Math.max(0, ...c.pairs.map((p) => p.series.filter((v) => v !== null && v !== undefined).length));
  const below = c.limit === null ? null : Math.max(0, ...c.pairs.map((p) => p.below.length));
  // úseky mezi kroky pod limitem zvlášť (`clear.below` = jen polohy kroků) – pole jen když nějaký je
  const mid = c.limit === null ? 0 : Math.max(0, ...c.pairs.map((p) => p.belowBetween?.length ?? 0));
  return [
    `clear.min=${n(m.d)}${m.exact ? "" : "+"}`,
    ...(c.limit !== null ? [`clear.limit=${n(c.limit)}`, `clear.below=${below}/${of}`, ...(mid ? [`clear.below.between=${mid}`] : [])] : []),
    `clear.at=${m.between ? `${m.between[0]}-${m.between[1]}` : Math.round(m.pos)}`,
    `clear.pairs=${c.pairs.length}`,
  ];
}

/* ───────────────────────── CSV, krok, API, stav ───────────────────────── */

/** sloupce CSV „Vůle A × B [mm]“ (sledované dvojice; u pohyblivých nejvýš 8 nejbližších) */
export function clearanceCsvHead(res: Res, doc: CadDoc): string[] {
  const c = clearanceOf(res as never).clearance;
  if (!c) return [];
  return c.pairs.slice(0, 8).map((p) => tr("Vůle {0} × {1} [mm]", compName(doc, p.a), compName(doc, p.b)));
}
export function clearanceCsvCells(res: Res, i: number): string[] {
  const c = clearanceOf(res as never).clearance;
  if (!c) return [];
  return c.pairs.slice(0, 8).map((p) => {
    const v = p.series[i];
    return v === null || v === undefined ? "" : String(Math.round(v * 1e6) / 1e6).replace(".", ",");
  });
}

/** `pohyb krok N`: vůle sledovaných dvojic v kroku */
export function clearanceStepLines(res: Res, doc: CadDoc, i: number): string[] {
  const c = clearanceOf(res as never).clearance;
  if (!c) return [];
  const out: string[] = [];
  for (const p of c.pairs.slice(0, 8)) {
    const v = p.series[i];
    if (v === null || v === undefined) continue;
    const pts = p.pts[i];
    out.push(`${tr(" vůle {0}: {1} mm", pairName(doc, p), mm(v))}${c.limit !== null && v < c.limit ? tr(" ⚠ pod limitem {0} mm", mm(c.limit)) : ""}${pts ? ` – ${fmtPt(pts[0])} ↔ ${fmtPt(pts[1])}` : ""}`);
  }
  return out;
}

/** vůle pro `window.mncad.motion()`: limit, nejmenší (dvojice, krok, body), dvojice s řadou po krocích; spojitost kontroly */
export function clearanceApi(res: Res, doc: CadDoc) {
  const ext = clearanceOf(res as never);
  const c = ext.clearance;
  const s = res.collisionsChecked ? sweepOf(res) : null;
  return {
    ...(c
      ? {
          clearance: {
            limit: c.limit,
            moving: c.moving,
            min: c.pairs[0]?.min ? { ...c.pairs[0].min, a: compName(doc, c.pairs[0].a), b: compName(doc, c.pairs[0].b) } : null,
            pairs: c.pairs.map((p) => ({ a: compName(doc, p.a), b: compName(doc, p.b), min: p.min, below: p.below, ...(p.belowBetween?.length ? { belowBetween: p.belowBetween } : {}), series: p.series, unproven: p.unproven })),
            poses: c.poses,
            refined: c.refined,
          },
        }
      : {}),
    ...(s ? { sweep: s } : {}),
    ...(ext.between?.length ? { between: ext.between.map((h) => ({ k0: h.k0, k1: h.k1, pos: h.pos, t: h.t, motors: h.motors, a: compName(doc, h.a), b: compName(doc, h.b), at: h.p, clashes: h.clashes.length })) } : {}),
  };
}

/** počet sledovaných dvojic s vůlí pod limitem (verdikt `stav` motion=warn – motion-cache.ts `motionVerdict`) */
export function clearanceBelowCount(res: Res): number {
  const c = clearanceOf(res as never).clearance;
  return c ? belowPairs(c.pairs, c.limit).length : 0;
}

/** věta do řádku „Pohyb:“ ve `stav` (prázdné bez sledované vůle) */
export function clearanceStatusText(res: Res, doc: CadDoc): string {
  const c = clearanceOf(res as never).clearance;
  if (!c?.pairs.length) return "";
  const p = c.pairs[0];
  if (!p.min) return "";
  const v = p.min.exact ? `${mm(p.min.d)} mm` : tr("nejméně {0} mm", mm(p.min.d));
  const below = belowPairs(c.pairs, c.limit).length;
  return c.limit !== null && below ? tr("vůle {0} {1} < limit {2} mm (⚠ {3} dvojic)", pairName(doc, p), v, mm(c.limit), below) : tr("nejmenší vůle {0} {1}", pairName(doc, p), v);
}

/** úsečka vůle ve 3D pro krok `i`: dvojice s nejmenší vůlí v kroku (body, hodnota, pod limitem) */
export type GapGfx = { p1: Vec3; p2: Vec3; d: number; below: boolean; label: string; min: boolean };
export function gapAt(res: Res | null | undefined, doc: CadDoc, i: number): GapGfx | null {
  if (!res) return null;
  const c = clearanceOf(res as never).clearance;
  if (!c) return null;
  let best: { p: ClearancePair; d: number; pts: [Vec3, Vec3] } | null = null;
  for (const p of c.pairs) {
    const d = p.series[i];
    const pts = p.pts[i];
    if (d === null || d === undefined || !pts) continue;
    if (!best || d < best.d) best = { p, d, pts };
  }
  if (!best) return null;
  const isMin = !!best.p.min && Math.round(best.p.min.pos) === i && !best.p.min.between && Math.abs(best.p.min.d - best.d) < 1e-9;
  return { p1: best.pts[0], p2: best.pts[1], d: best.d, below: c.limit !== null && best.d < c.limit, min: isMin, label: `${isMin ? `${tr("min")} ` : ""}${mm(best.d)} mm` };
}

/** počet kontaktů se závadou nalezených mezi kroky (zjemnění) – `stav` je nesmí vynechat (jinak „bez průniku“ při průchodu) */
export function betweenFaultCount(res: Res, doc: CadDoc): number {
  const between = clearanceOf(res as never).between;
  if (!between?.length) return 0;
  return betweenSteps({ steps: [], collisionsChecked: true, between }).filter((s) => stepHasFault(doc, s)).length;
}
