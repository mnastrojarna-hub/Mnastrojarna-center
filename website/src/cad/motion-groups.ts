/**
 * Tuhé skupiny pohybové studie (vlna 22, body 15 a 10 zprávy): komponenty, jejichž vzájemná poloha se po celou studii nemění
 * (zámek, pevné vazby, nebo prostě stejný pohyb), tvoří JEDNU položku souhrnu – „„Horní deska“ + 20 dílů (tuhá skupina – zámek):
 * ΔZ −30 mm“ místo 21 řádků. Skupina se pozná podle **neměnné vzájemné polohy s tolerancí** (relativní poloha člena vůči
 * vedoucímu dílu skupiny v každém kroku = v kroku 0 do 1e-6 · max(1, zdvih) mm a 1e-7 rad), ne podle zaokrouhleného posunutí:
 * dřívější `Math.round(Δ · 1000)` rozdělil jednu skupinu na „58 + 1“, když posunutí leželo na hranici ,5 (−22,7625 ×
 * −22,762500000000003). Zámky (`rigidGroups` řešiče, cad/mates-kin.ts) dávají jen název kořene a vysvětlení „zámek“.
 *
 * Natáčející se skupina se pozná stejně (relativní poloha je neměnná i při otáčení celku); natočení se měří úhlem mezi maticemi
 * vůči kroku 0 (`rotationAngleDeg`, B11 – žádné falešné „natáčí se“ u čistého posuvu dílu otočeného o 180°).
 */
import { rotMatrix } from "./assembly";
import { tr } from "./i18n";
import { rigidGroups } from "./mates-kin";
import { motorNum } from "./motor-model";
import type { CadDoc, Mate, Placement, Vec3 } from "./types";

/** pod tímto úhlem [°] se komponenta za natáčenou nepovažuje (stejné jako cad/motion.ts `ROT_EPS_DEG`) */
const ROT_EPS_DEG = 1e-4;
/** komponenta s menším posunutím [mm] stojí */
const STILL_MM = 1e-3;

/** výsledek studie potřebný pro skupiny (cad/motion.ts MotionResult – bez cyklického importu) */
type StepsLike = { steps: { place: Record<string, Placement> }[]; comps: { id: string; name: string }[]; motors?: { mate: string }[]; mates?: Mate[] };

export type RigidGroup = {
  /** vedoucí komponenta (název skupiny): kořen zámků, komponenta poháněné vazby, jinak první v pořadí dokumentu */
  root: string;
  /** jméno vedoucí komponenty (komponenta dokumentu, jinak výsledek studie, jinak id) – strojový řádek `groups=` (kolo 7) */
  name: string;
  ids: string[];
  n: number;
  /** posunutí v kroku největšího vychýlení (znaménko a osy) a na konci studie [mm] */
  delta: Vec3;
  end: Vec3;
  /** největší vzdálenost od výchozí polohy [mm] */
  travel: number;
  /** největší natočení vůči kroku 0 [°] (0 = čistý posuv) */
  turn: number;
  /** skupinu drží zámek (pevná vazba) – jinak se díly jen hýbou stejně */
  locked: boolean;
};
export type RigidGroups = { moving: RigidGroup[]; still: string[] };

type M4 = { R: number[]; p: Vec3 };
const m4 = (pl: Placement): M4 => ({ R: rotMatrix(pl.rotation), p: pl.position });
/** poloha `b` v souřadnicích `a`: Rᵃᵀ·Rᵇ, Rᵃᵀ·(pᵇ − pᵃ) */
function relOf(a: M4, b: M4): M4 {
  const A = a.R;
  const B = b.R;
  const R = new Array(9).fill(0);
  for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) R[i * 3 + j] = A[0 * 3 + i] * B[0 * 3 + j] + A[1 * 3 + i] * B[1 * 3 + j] + A[2 * 3 + i] * B[2 * 3 + j];
  const d = [b.p[0] - a.p[0], b.p[1] - a.p[1], b.p[2] - a.p[2]];
  const p: Vec3 = [A[0] * d[0] + A[3] * d[1] + A[6] * d[2], A[1] * d[0] + A[4] * d[1] + A[7] * d[2], A[2] * d[0] + A[5] * d[1] + A[8] * d[2]];
  return { R, p };
}
function angleDeg(A: number[], B: number[]): number {
  let f = 0;
  for (let i = 0; i < 9; i++) f += (A[i] - B[i]) ** 2;
  return (2 * Math.asin(Math.min(1, Math.sqrt(f) / (2 * Math.SQRT2))) * 180) / Math.PI;
}

/**
 * Tuhé skupiny výsledku studie. `doc` (volitelně) dodá zámky a poháněné vazby pro název a vysvětlení skupiny. Pořadí: počet
 * komponent sestupně, pak zdvih. Komponenty bez polohy v krocích se vynechají.
 */
export function rigidMotionGroups(res: StepsLike, doc?: Pick<CadDoc, "components" | "mates">): RigidGroups {
  const steps = res.steps;
  const ids = res.comps.map((c) => c.id).filter((id) => steps.length && steps.every((s) => s.place[id]));
  const first = steps[0];
  if (!first) return { moving: [], still: res.comps.map((c) => c.id) };
  const series = new Map(ids.map((id) => [id, steps.map((s) => m4(s.place[id]))] as const));
  // pohyb každé komponenty: posunutí od kroku 0, největší vychýlení, natočení
  const info = new Map<string, { travel: number; delta: Vec3; end: Vec3; turn: number }>();
  for (const id of ids) {
    const sr = series.get(id)!;
    const p0 = sr[0].p;
    let travel = 0;
    let delta: Vec3 = [0, 0, 0];
    let turn = 0;
    for (const x of sr) {
      const d: Vec3 = [x.p[0] - p0[0], x.p[1] - p0[1], x.p[2] - p0[2]];
      const h = Math.hypot(d[0], d[1], d[2]);
      if (h > travel + 1e-12) {
        travel = h;
        delta = d;
      }
      turn = Math.max(turn, angleDeg(sr[0].R, x.R));
    }
    const pe = sr[sr.length - 1].p;
    info.set(id, { travel, delta, end: [pe[0] - p0[0], pe[1] - p0[1], pe[2] - p0[2]], turn });
  }
  const isStill = (id: string) => info.get(id)!.travel < STILL_MM && info.get(id)!.turn <= ROT_EPS_DEG;
  // zámky: kořen skupiny řešiče (název) a příznak „zámek“
  const mates = (res.mates ?? doc?.mates ?? []).filter((m) => !m.suppressed);
  const lockG = rigidGroups(mates, ids, () => false);
  const lockedPair = (a: string, b: string) => {
    const ra = lockG.rootOf.get(a);
    return ra !== undefined && ra === lockG.rootOf.get(b);
  };
  const driven = new Set((res.motors ?? []).flatMap((mo) => {
    const m = mates.find((x) => x.id === mo.mate);
    return m ? [m.a.compId, m.b.compId] : [];
  }));
  // shlukování podle neměnné vzájemné polohy (vedoucí = první komponenta skupiny v pořadí)
  const leaders: { id: string; members: string[]; tol: number }[] = [];
  const still: string[] = [];
  for (const id of ids) {
    if (isStill(id)) {
      still.push(id);
      continue;
    }
    const si = series.get(id)!;
    let placed = false;
    for (const L of leaders) {
      const sl = series.get(L.id)!;
      const r0 = relOf(sl[0], si[0]);
      let same = true;
      for (let k = 1; k < sl.length && same; k++) {
        const r = relOf(sl[k], si[k]);
        if (Math.hypot(r.p[0] - r0.p[0], r.p[1] - r0.p[1], r.p[2] - r0.p[2]) > L.tol) same = false;
        else for (let q = 0; q < 9; q++) if (Math.abs(r.R[q] - r0.R[q]) > 1e-7) same = false;
      }
      if (same) {
        L.members.push(id);
        placed = true;
        break;
      }
    }
    if (!placed) leaders.push({ id, members: [id], tol: 1e-6 * Math.max(1, info.get(id)!.travel) });
  }
  const order = new Map((doc?.components ?? res.comps).map((c, i) => [c.id, i] as const));
  const moving: RigidGroup[] = leaders.map((L) => {
    const mem = [...L.members].sort((a, b) => (order.get(a) ?? 0) - (order.get(b) ?? 0));
    // název: kořen zámků, jinak komponenta poháněné vazby, jinak první v pořadí dokumentu
    const lockRoot = mem.map((id) => lockG.rootOf.get(id)).find((r): r is string => !!r && mem.includes(r));
    const root = lockRoot ?? mem.find((id) => driven.has(id)) ?? mem[0];
    const locked = mem.length > 1 && mem.some((a) => mem.some((b) => a !== b && lockedPair(a, b)));
    const x = info.get(root)!;
    const name = doc?.components?.find((c) => c.id === root)?.name ?? res.comps.find((c) => c.id === root)?.name ?? root;
    return { root, name, ids: mem, n: mem.length, delta: x.delta, end: x.end, travel: x.travel, turn: Math.max(...mem.map((id) => info.get(id)!.turn)), locked };
  });
  moving.sort((a, b) => b.n - a.n || b.travel - a.travel);
  return { moving, still };
}

/** „+ 1 díl“ / „+ 3 díly“ / „+ 20 dílů“ (EN „+ 1 part“ / „+ 20 parts“) */
export function plusParts(n: number): string {
  if (n === 1) return tr("+ {0} díl", n);
  if (n >= 2 && n <= 4) return tr("+ {0} díly", n);
  return tr("+ {0} dílů", n);
}

/** „ΔZ −30,35 mm“ / „ΔX +5 · ΔZ −30 mm“ – osy s posunutím nad 0,001 mm */
export function deltaText(d: Vec3): string {
  const axes = ["X", "Y", "Z"]
    .map((a, k) => ({ a, v: d[k] }))
    .filter((x) => Math.abs(x.v) >= STILL_MM)
    .map((x) => `Δ${x.a} ${x.v > 0 ? "+" : "−"}${motorNum(Math.abs(x.v), 3)}`);
  return axes.length ? `${axes.join(" · ")} mm` : "Δ 0 mm";
}

/**
 * Řádky souhrnu po tuhých skupinách (výchozí výstup protokolu, konzole i panelu): jeden řádek na skupinu, pak „stojí“. Detail po
 * dílech je `pohyb detail` (cad/motion.ts `motionSummary(…, { detail: true })`).
 */
export function groupLines(g: RigidGroups, name: (id: string) => string): string[] {
  const out: string[] = [];
  for (const x of g.moving) {
    // názvy v uvozovkách „…“ jako ostatní řádky souhrnu (motorText) – ve všech jazycích
    const who = x.n > 1 ? `„${name(x.root)}“ ${plusParts(x.n - 1)}` : `„${name(x.root)}“`;
    const why = x.n > 1 ? (x.locked ? tr(" (tuhá skupina – zámek / pevné vazby)") : tr(" (tuhá skupina – stejný pohyb)")) : "";
    const back = Math.hypot(...x.end) < STILL_MM && x.travel >= STILL_MM ? tr(" · na konci zpět ve výchozí poloze") : Math.hypot(x.end[0] - x.delta[0], x.end[1] - x.delta[1], x.end[2] - x.delta[2]) >= STILL_MM ? tr(" · na konci {0}", deltaText(x.end)) : "";
    const turn = x.turn > ROT_EPS_DEG ? tr(" · natáčí se {0}°", motorNum(x.turn, 3)) : "";
    out.push(` ${who}${why}: ${deltaText(x.delta)}${back}${turn}`);
  }
  if (g.still.length) {
    const names = g.still.slice(0, 3).map((id) => `„${name(id)}“`).join(", ");
    out.push(tr(" stojí: {0} ({1}{2})", g.still.length, names, g.still.length > 3 ? tr(" a další") : ""));
  }
  return out;
}

/**
 * Jméno do strojového pole: znaky, které by rozbily `klíč=hodnota` / seznam položek (mezera, čárka, dvojtečka, rovnítko,
 * uvozovky, %, řídicí znaky), se zapíšou jako v URL (`Horní deska` → `Horní%20deska`); písmena s diakritikou zůstanou.
 */
export const kvName = (s: string): string => s.replace(/[%\s,:="'\\\u0000-\u001f]/g, (c) => encodeURIComponent(c));

/**
 * Strojové pole skupin na konci řádku `= … motion …` (vlna 22, bod 15): `groups=<n>:<osy>:<kořen>` po skupinách s posuvem
 * (stejné skupiny jako `travel=`), osy jako `z-30.35` / `x+5z-30` (posunutí v kroku největšího vychýlení, desetinná tečka),
 * kořen = jméno vedoucí komponenty skupiny (kolo 7: dřív řádek neříkal, KTERÁ skupina se hýbe – jen počet dílů) zapsané
 * `kvName` (mezera = %20). Čtenáři, kteří berou jen první dvě části `n:osy` (scripts/cad-acceptance.mjs), čtou dál beze změny.
 */
export function groupsKv(g: RigidGroups): string[] {
  const list = g.moving.filter((x) => x.turn <= ROT_EPS_DEG);
  if (!list.length) return [];
  const n = (v: number) => String(Math.round(v * 1000) / 1000 || 0);
  const ax = (d: Vec3) =>
    ["x", "y", "z"]
      .map((a, k) => (Math.abs(d[k]) >= STILL_MM ? `${a}${d[k] > 0 ? "+" : "-"}${n(Math.abs(d[k]))}` : ""))
      .join("") || "0";
  return [`groups=${list.map((x) => `${x.n}:${ax(x.delta)}:${kvName(x.name)}`).join(",")}`];
}
