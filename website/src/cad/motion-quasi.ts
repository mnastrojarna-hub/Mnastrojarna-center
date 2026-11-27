/**
 * Kvazistatika a priorita podmínek pohybu sestavy (vlna 22, body 2 a 8 zprávy). Čisté funkce bez jádra nad řešičem cad/mates-kin.ts.
 *
 * **Členy kroku** (`StepTerms`):
 * - **tvrdé** (`hard`) – vazby (ukotvení, zámky, kontakty, zarovnání, souosost, pevné vzdálenosti a úhly, meze jako jednostranné
 *   zbytky) a délka pružiny na doraz Ln (jednostranný doraz `spring:<id>`); nikdy se neobětují pohonu ani preferenci;
 * - **pohon** (`drive`) – hodnota motoru (u absolutní vazby mezera / poloha vazby, u ostatních posuv / natočení od výchozí polohy);
 * - **měkké** (`soft`) – kvazistatika: energie pružin ½·c·(L0 − L)² (pružina jen tlačí – nad L0 je energie nulová); kinematika
 *   i statický přepočet: preferovaná strana meze (`Mate.prefer`).
 *
 * **Krok** (`solveStep`): (A) tvrdé + pohon (váha K) + měkké, pak úklid tvrdé + pohon přesně (nejmenší změna) → splněno = hotovo.
 * Jinak (B) z poslední platné polohy: tvrdé s vahou K, pohon s vahou 1 → motor dojede jen kam tvrdé podmínky dovolí; zbytky tvrdých
 * členů v tomto optimu jsou úměrné Lagrangeovým multiplikátorům → blokující množina (které meze a vazby motor zastavily); úklid
 * tvrdými přesně. Motor na mezi `stop` = krok v této poloze (motor stojí), `error` = krok neplatný, zůstane poslední platná poloha.
 * Neplatí-li ani samotné tvrdé podmínky (vazby si odporují i bez motoru), krok je neplatný (poslední platná poloha) a hlásí se
 * porušené vazby s odchylkami. Kompromis nejmenších čtverců se stejnými vahami (ujetí a naklopení tuhých dílů) se nikdy nevydává.
 *
 * Kvazistatický krok je minimum energie v prostoru tvrdých podmínek – nezávisí na předchozím kroku, směru přehrávání ani historii
 * úprav (předchozí krok je jen počáteční odhad). Statický přepočet (`equilibrate`) používá totéž pro dokument.
 */
import { springComps, solidOf } from "./asm-spring";
import { springGeom } from "./asm-spring-geom";
import { apply3, mul3 } from "./assembly";
import { getLang, tr } from "./i18n";
import { MATE_LABEL, type GeoProvider } from "./mates";
import { cross, DEG, dot, expRot, kinResidual, L, len, poseOf, solvePoses, sub, syncGroups, toWorld, unit, worldOf, add, type KinCtx, type Pose, type RigidGroups, type SolveVar } from "./mates-kin";
import type { CadDoc, Mate, MateRef, Vec3 } from "./types";

/** mez splnění podmínky [mm] (stejná jako dřívější hlášení konfliktu) */
export const CONFLICT_TOL = 1e-3;
/** váha tvrdých podmínek proti pohonu a měkkým členům */
const K = 1e3;
/** váha preferované strany meze (≪ pružiny, ≫ regularizace řešiče μ = 1e-6) */
const W_PREF = 0.1;

const norm = (r: number[]) => Math.sqrt(r.reduce((s, v) => s + v * v, 0));
const perpPart = (v: Vec3, n: Vec3): Vec3 => sub(v, [n[0] * dot(v, n), n[1] * dot(v, n), n[2] * dot(v, n)]);
const wgeo = (ctx: KinCtx, ref: MateRef | undefined) => {
  if (!ref) return null;
  const P = ctx.pose(ref.compId);
  const g = P ? ctx.geo(ref) : null;
  return P && g ? worldOf(P, g) : null;
};
const fmt = (v: number, d = 3) => {
  const s = String(Math.round(v * 10 ** d) / 10 ** d || 0);
  return getLang() === "en" ? s : s.replace(".", ",");
};

/* ───────────────────────── meze a preferovaná strana ───────────────────────── */

/** Mez: Mez vzdálenosti, Mez úhlu a Drážka bez polohy (poloha v drážce mezi konci). */
export const isLimitMate = (m: Pick<Mate, "type" | "value">) => m.type === "limitDistance" || m.type === "limitAngle" || (m.type === "slot" && m.value === undefined);

/** Hodnota meze v nynějších polohách (mezera mm / úhel ° / poloha v drážce mm) a její meze; null = chybí geometrie. */
export function limitGap(m: Mate, ctx: KinCtx): { g: number; min?: number; max?: number; unit: "mm" | "°" } | null {
  const A = wgeo(ctx, m.a);
  const B = wgeo(ctx, m.b);
  if (!A || !B) return null;
  if (m.type === "limitDistance") return { g: dot(sub(A.origin, B.origin), B.normal), min: m.min, max: m.max, unit: "mm" };
  if (m.type === "limitAngle") return { g: Math.atan2(len(cross(A.normal, B.normal)), dot(A.normal, B.normal)) * DEG, min: m.min, max: m.max, unit: "°" };
  if (m.type === "slot" && m.value === undefined) {
    const C = wgeo(ctx, m.c);
    if (!C) return null;
    const n = B.normal;
    const b0 = perpPart(B.origin, n);
    const span = sub(perpPart(C.origin, n), b0);
    const l = len(span);
    if (l < 1e-9) return null;
    return { g: dot(sub(perpPart(A.origin, n), b0), unit(span)), min: 0, max: l, unit: "mm" };
  }
  return null;
}

/** Měkké členy preferované strany mezí: táhnou hodnotu meze k zvolené mezi (tvrdá mez ji tam zastaví). */
export function preferTerms(mates: Mate[], ctx: KinCtx): Term[] {
  return mates
    .filter((m) => !m.suppressed && m.prefer && isLimitMate(m))
    .map((m) => ({
      id: `prefer:${m.id}`,
      r: () => {
        const x = limitGap(m, ctx);
        const target = x ? (m.prefer === "max" ? x.max : x.min) : undefined;
        return [x && target !== undefined ? W_PREF * (x.g - target) * (x.unit === "°" ? L / DEG : 1) : 0];
      },
    }));
}

/* ───────────────────────── pružiny ───────────────────────── */

/** Pružina pro řešič: vzdálenost dosedacích ploch v nynějších polohách (po ose pružiny, jako cad/asm-spring.ts springState). */
export type SpringTerm = { id: string; name: string; seats: [string, string]; free: number; solid?: number; rate: number; rateGiven: boolean; seat: () => number | null };

export function springTerms(doc: CadDoc, ctx: KinCtx): SpringTerm[] {
  const out: SpringTerm[] = [];
  for (const c of springComps(doc)) {
    const s = c.spring!;
    if (c.source.kind !== "part") continue;
    const g = springGeom(c.source.doc);
    if (!g) continue;
    const solid = solidOf(c);
    const own = poseOf(c.placement);
    const seat = () => {
      const P: Pose = ctx.pose(c.id) ?? own;
      const P0 = toWorld(P, g.base);
      const u = unit(apply3(P.R, g.axis));
      const tOf = (ref: MateRef): number | null => {
        const w = wgeo(ctx, ref);
        if (!w) return null;
        if (w.kind === "plane") {
          const den = dot(u, w.normal);
          if (Math.abs(den) < 0.05) return null;
          return dot(sub(w.origin, P0), w.normal) / den;
        }
        return dot(sub(w.origin, P0), u);
      };
      const a = tOf(s.a);
      const b = tOf(s.b);
      return a === null || b === null ? null : b - a;
    };
    out.push({ id: c.id, name: c.name, seats: [s.a.compId, s.b.compId], free: s.free, ...(solid !== undefined ? { solid } : {}), rate: s.rate && s.rate > 0 ? s.rate : 1, rateGiven: !!(s.rate && s.rate > 0), seat });
  }
  return out;
}

/** tvrdý doraz pružiny: vzdálenost ploch nesmí klesnout pod délku na doraz Ln (`spring:<id>`) */
export const springStopTerm = (s: SpringTerm): Term => ({
  id: `spring:${s.id}`,
  r: () => {
    const x = s.seat();
    return [x !== null && s.solid !== undefined && x < s.solid ? x - s.solid : 0];
  },
  lim: { g: s.seat, ...(s.solid !== undefined ? { min: s.solid } : {}), eq: () => [] },
});

/** Tvrdý člen vazby; u meze (Mez vzdálenosti / úhlu, Drážka bez polohy) s popisem pro aktivní množinu. */
export function mateTerm(m: Mate, ctx: KinCtx, r: () => number[] = () => kinResidual(m, ctx) ?? []): Term {
  if (!isLimitMate(m)) return { id: m.id, r };
  const x0 = limitGap(m, ctx);
  return {
    id: m.id,
    r,
    lim: { g: () => limitGap(m, ctx)?.g ?? null, ...(x0?.min !== undefined ? { min: x0.min } : {}), ...(x0?.max !== undefined ? { max: x0.max } : {}), eq: () => eqResidual(m, ctx), k: x0?.unit === "°" ? L / DEG : 1 },
  };
}
/** energie pružiny ½·c·(L0 − L)² jako zbytek √c·(L0 − L); pružina jen tlačí (nad L0 nic) */
export const springEnergyTerm = (s: SpringTerm): Term => ({
  id: `energy:${s.id}`,
  r: () => {
    const x = s.seat();
    return [x !== null ? Math.sqrt(s.rate) * Math.max(0, s.free - x) : 0];
  },
});

/* ───────────────────────── krok s prioritou ───────────────────────── */

/**
 * Člen kroku: `r` = vektor zbytků (0 = splněno). Jednostranná mez (`lim`): hodnota `g` (mezera mm / úhel ° / poloha v drážce /
 * vzdálenost dosedacích ploch pružiny), meze, `eq` = rovnostní část zbytku bez jednostranného členu (orientace ploch) a `k` = zbytek
 * na jednotku hodnoty (u úhlu L/DEG). Řešič s měkkými členy s ní pracuje jako s aktivní množinou (aktivní mez = rovnost, neaktivní =
 * jen orientace) – jednostranný zbytek se zlomem by Levenbergův–Marquardtův řešič neustále přeskakoval a nedokonvergoval.
 */
export type Term = { id: string; r: () => number[]; lim?: { g: () => number | null; min?: number; max?: number; eq: () => number[]; k?: number } };
export type StepTerms = { hard: Term[]; drive: Term[]; soft: Term[] };
export type StepOutcome<T = unknown> = {
  status: "ok" | "stopped" | "invalid";
  /** proč krok neprošel: motor nedosáhne hodnoty (`motor`), nebo si tvrdé podmínky odporují samy (`mates`) */
  cause?: "motor" | "mates";
  /** konfliktní množina: blokující tvrdé členy (motor na mezi) nebo porušené tvrdé členy (vazby si odporují) – id členů */
  blocking: string[];
  /** pohony, které nedosáhly hodnoty (id členu) */
  short: string[];
  /** popis odchylek (`describe`) v poloze, ke které se konflikt vztahuje (dosažitelná poloha / kompromis tvrdých podmínek) */
  info?: T;
};

const vec = (ts: Term[], k = 1) => () => ts.flatMap((t) => (k === 1 ? t.r() : t.r().map((v) => v * k)));
const worst = (ts: Term[]) => ts.reduce((m, t) => Math.max(m, norm(t.r())), 0);
const energy = (ts: Term[]) => ts.reduce((s, t) => s + t.r().reduce((a, v) => a + v * v, 0), 0);
/** člen, který drží nynější hodnotu zbytku členu `t` (zbytek − zbytek teď) */
const heldOf = (t: Term): Term => {
  const r0 = t.r();
  return { id: t.id, r: () => t.r().map((v, i) => v - (r0[i] ?? 0)) };
};

/**
 * Nejmenší změna od polohy `from`, která dá tytéž hodnoty měkkých členů jako nynější poloha (fáze 2, bod 2): penalizační úloha
 * s měkkým členem, který tvrdé podmínky nedovolí splnit (preference meze proti pevné vazbě, pružina proti dorazu), nemá v nedourčených
 * stupních volnosti (posuv v rovině, natočení kolem normály) dno – optimum „uklouzne“ o metry s nepatrným náklonem a úklid tvrdými
 * podmínkami pak ujetí nechá (tvrdé splněné, „Vazby splněny“ – falešná zelená). Měkké členy určují jen svou hodnotu (mezeru, délku
 * pružiny), ne volné stupně volnosti: poloha = `from` + nejmenší změna na tytéž hodnoty. Nepovede-li se (tvrdé / `keep` nesplněné
 * nebo znatelně vyšší energie), zůstane nynější poloha (vrací false).
 */
function leastChange(poses: Map<string, Pose>, vars: SolveVar[], from: Map<string, Pose>, hard: Term[], keep: Term[], soft: Term[], o: { maxIter: number; groups?: RigidGroups }): boolean {
  const cur = new Map(poses);
  const e0 = energy(soft);
  const held = soft.map(heldOf);
  for (const [k, v] of from) poses.set(k, v);
  solvePoses(poses, vars, () => [...vec(hard)(), ...vec(keep)(), ...vec(held)()], o);
  // energie smí být vyšší jen o numerický šum řešiče (polohy ~1e-7 mm): jinak by nová poloha nebyla stejně dobré optimum
  if (worst(hard) <= CONFLICT_TOL && worst(keep) <= CONFLICT_TOL && energy(soft) <= e0 * (1 + 1e-4) + 1e-6) return true;
  for (const [k, v] of cur) poses.set(k, v);
  return false;
}

/**
 * Krok s prioritou tvrdé ≫ pohon ≫ měkké (viz hlavička modulu). `poses` = počáteční odhad (předchozí krok / dokument) – po návratu
 * výsledná poloha kroku (u neplatného kroku nezměněná = poslední platná). `describe(ids)` se zavolá v poloze konfliktu.
 */
export function solveStep<T = unknown>(
  poses: Map<string, Pose>,
  vars: SolveVar[],
  T: StepTerms,
  o: { groups?: RigidGroups; atLimit?: "stop" | "error" | ((short: string[]) => "stop" | "error"); maxIter?: number; describe?: (ids: string[], short: string[]) => T } = {},
): StepOutcome<T> {
  const snap = new Map(poses);
  const restore = () => {
    for (const [k, v] of snap) poses.set(k, v);
  };
  const it = o.maxIter ?? 60;
  const groups = o.groups;
  const soft = T.soft.length > 0;
  const hard = vec(T.hard);
  const drive = vec(T.drive);
  // (A) vše najednou: bez měkkých členů přesně dřívější krok kinematiky (tvrdé + pohon stejnou vahou)
  let cleaned = false;
  if (soft) {
    settle(poses, vars, T.hard, (H) => () => [...vec(H, K)(), ...vec(T.drive, K)(), ...vec(T.soft)()], { maxIter: it + 60, groups });
    solvePoses(poses, vars, () => [...hard(), ...drive()], { maxIter: it, groups });
    // úklid jednostrannými mezemi nedokonverguje přesně, když měkký člen (pružina stovek N) tlačí díl přes mez, která se právě stala
    // aktivní (přidržovač dosedá na rám): zbytek ~1e-3 mm a krok by vyšel jako „motor na mezi – žádáno 32,208, dosaženo 32,209“.
    // Úklid s aktivní množinou mezí (rovnost na dosažené mezi) bez měkkých členů dá přesnou polohu (kolo 6)
    if (worst(T.hard) > CONFLICT_TOL || worst(T.drive) > CONFLICT_TOL) {
      settle(poses, vars, T.hard, (H) => () => [...vec(H)(), ...drive()], { maxIter: it + 60, groups });
      cleaned = true;
    }
  } else solvePoses(poses, vars, () => [...hard(), ...drive()], { maxIter: it, groups });
  if (worst(T.hard) <= CONFLICT_TOL && worst(T.drive) <= CONFLICT_TOL) {
    // měkké členy neurčují volné stupně volnosti: poloha = nejmenší změna od počátečního odhadu na tytéž hodnoty měkkých členů
    const least = soft ? leastChange(poses, vars, snap, T.hard, T.drive, T.soft, { maxIter: it, groups }) : true;
    // Poloha z úklidu (výše) platí, jen když ji dá i nejmenší změna od počátečního odhadu. Penalizační optimum s pružinou bez dna
    // v nedourčených stupních volnosti „uklouzne“ o desítky metrů (deska jen se vzdáleností k rámu: Y +31 560 mm, pružina 30,082
    // místo 30 mm); úklid tvrdé podmínky splní i tam, nejmenší změna ale ne – pak rozhodne větev (B) jako před kolem 6
    if (least || !cleaned) return { status: "ok", blocking: [], short: [] };
  }
  // (B) z poslední platné polohy: tvrdé podmínky s přednostní vahou, pohon dojede, kam smí
  restore();
  settle(poses, vars, T.hard, (H) => () => [...vec(H, K)(), ...drive(), ...(soft ? vec(T.soft, 1 / K)() : [])], { maxIter: it + 60, groups });
  // multiplikátory ∝ zbytkům tvrdých členů v penalizačním optimu: nenulové = meze / vazby, které motor zastavily
  const lam = T.hard.map((t) => ({ id: t.id, n: norm(t.r()) }));
  // úklid tvrdými podmínkami přesně (penalizační optimum je o ~1e-5 mm za mezí) → dosažená hodnota motoru přesně na mezi
  solvePoses(poses, vars, hard, { maxIter: it, groups });
  // pohon drží dosaženou hodnotu; poloha = nejmenší změna od poslední platné polohy (žádné ujetí volných stupňů volnosti
  // penalizačním kompromisem), která splní tvrdé podmínky a dosaženou hodnotu motoru
  const held: Term[] = T.drive.map((t) => {
    const r0 = t.r();
    return { id: t.id, r: () => t.r().map((v, i) => v - (r0[i] ?? 0)) };
  });
  const atB = new Map(poses);
  restore();
  solvePoses(poses, vars, () => [...hard(), ...vec(held)()], { maxIter: it, groups });
  if (worst(T.hard) > CONFLICT_TOL || worst(held) > CONFLICT_TOL) {
    for (const [k, v] of atB) poses.set(k, v);
    solvePoses(poses, vars, hard, { maxIter: it, groups });
  }
  if (worst(T.hard) <= CONFLICT_TOL) {
    // vedení, která nesou jen moment mimoosé síly (souosost u mimoosé pružiny), mají multiplikátor o řád menší – nehlásí se
    const mx = lam.reduce((m, x) => Math.max(m, x.n), 0);
    const blocking = lam.filter((x) => x.n > Math.max(1e-10, 0.25 * mx)).map((x) => x.id);
    const short = T.drive.filter((t) => norm(t.r()) > CONFLICT_TOL).map((t) => t.id);
    const mode = typeof o.atLimit === "function" ? o.atLimit(short) : (o.atLimit ?? "stop");
    if (mode === "stop") {
      if (soft) {
        // rovnováha měkkých členů při stojícím motoru: pohon drží dosaženou hodnotu
        const held2 = T.drive.map((t) => {
          const r0 = t.r();
          return { id: t.id, r: () => t.r().map((v, i) => v - (r0[i] ?? 0)) };
        });
        const atStop = new Map(poses);
        settle(poses, vars, T.hard, (H) => () => [...vec(H, K)(), ...vec(held2, K)(), ...vec(T.soft)()], { maxIter: it + 60, groups });
        solvePoses(poses, vars, () => [...hard(), ...vec(held2)()], { maxIter: it, groups });
        // velká síla měkkého členu (pružina u dorazu ~ stovky N) proti konečné váze tvrdých členů: penalizační úloha nemá v nedourčených
        // stupních volnosti (posuv desky v rovině) dno – deska „ujede“ o desítky metrů s nepatrným náklonem a úklid tvrdé podmínky už
        // nesplní. Taková poloha není rovnováha, ale numerický artefakt (bod 8: tuhé díly se nesmějí rozjet ani naklonit) → zůstane
        // poloha zastavení (tvrdé podmínky splněné, motor na dosažené hodnotě, nejmenší změna od posledního platného kroku)
        if (worst(T.hard) > CONFLICT_TOL || worst(held2) > CONFLICT_TOL) for (const [k, v] of atStop) poses.set(k, v);
        else leastChange(poses, vars, atStop, T.hard, held2, T.soft, { maxIter: it, groups });
      }
      return { status: "stopped", cause: "motor", blocking, short, ...(o.describe ? { info: o.describe(blocking, short) } : {}) };
    }
    const info = o.describe?.(blocking, short);
    restore();
    return { status: "invalid", cause: "motor", blocking, short, ...(info !== undefined ? { info } : {}) };
  }
  // tvrdé podmínky si odporují samy: porušené v kompromisu samotných tvrdých podmínek
  const viol = T.hard.filter((t) => norm(t.r()) > CONFLICT_TOL).map((t) => t.id);
  const info = o.describe?.(viol, []);
  restore();
  return { status: "invalid", cause: "mates", blocking: viol, short: [], ...(info !== undefined ? { info } : {}) };
}

/** mez rozhodnutí aktivní množiny [mm]: penalizační posun u síly ~1 N je řádu 1e-6 mm */
const ACT_EPS = 1e-7;

/**
 * Řešení s aktivní množinou mezí: aktivní mez = rovnost na své mezi, neaktivní = jen orientační část. Po každém řešení se porušené
 * neaktivní meze aktivují a aktivní, které díl táhnou (penalizační zbytek na „vnitřní“ straně = měkké členy chtějí dovnitř), uvolní;
 * opakuje se, dokud se množina mění (nejvýš 12×). Polohy jsou pak penalizačním optimem; přesně je splní úklid tvrdými členy.
 */
function settle(poses: Map<string, Pose>, vars: SolveVar[], hardT: Term[], build: (hard: Term[]) => () => number[], o: { maxIter: number; groups?: RigidGroups }): void {
  const lims = hardT.filter((t) => t.lim);
  if (!lims.length) {
    solvePoses(poses, vars, build(hardT), o);
    return;
  }
  const active = new Map<string, "min" | "max">();
  for (const t of lims) {
    const x = t.lim!.g();
    if (x === null) continue;
    if (t.lim!.min !== undefined && x <= t.lim!.min + 1e-6) active.set(t.id, "min");
    else if (t.lim!.max !== undefined && x >= t.lim!.max - 1e-6) active.set(t.id, "max");
  }
  const as = (t: Term): Term => {
    if (!t.lim) return t;
    const L0 = t.lim;
    const side = active.get(t.id);
    const k = L0.k ?? 1;
    const bound = side === "min" ? L0.min : side === "max" ? L0.max : undefined;
    return {
      id: t.id,
      r: () => {
        const x = bound !== undefined ? L0.g() : null;
        return [...L0.eq(), x !== null && bound !== undefined ? (x - bound) * k : 0];
      },
    };
  };
  for (let round = 0; round < 12; round++) {
    solvePoses(poses, vars, build(hardT.map(as)), o);
    let changed = false;
    for (const t of lims) {
      const x = t.lim!.g();
      if (x === null) continue;
      const { min, max } = t.lim!;
      const side = active.get(t.id);
      if (!side) {
        if (min !== undefined && x < min - ACT_EPS) active.set(t.id, "min");
        else if (max !== undefined && x > max + ACT_EPS) active.set(t.id, "max");
        else continue;
        changed = true;
      } else if (side === "max" ? x < max! - ACT_EPS : x > min! + ACT_EPS) {
        active.delete(t.id);
        changed = true;
      }
    }
    if (!changed) break;
  }
}

/* ───────────────────────── neurčená poloha v mezi ───────────────────────── */

/** Cholesky A = LLᵀ (husté n×n po řádcích, A souměrná pozitivně definitní); null = selhalo. */
function cholesky(A: Float64Array, n: number): Float64Array | null {
  const Lm = new Float64Array(n * n);
  for (let i = 0; i < n; i++)
    for (let j = 0; j <= i; j++) {
      let s = A[i * n + j];
      for (let k = 0; k < j; k++) s -= Lm[i * n + k] * Lm[j * n + k];
      if (i === j) {
        if (!(s > 0)) return null;
        Lm[i * n + i] = Math.sqrt(s);
      } else Lm[i * n + j] = s / Lm[j * n + j];
    }
  return Lm;
}
function cholSolve(Lm: Float64Array, b: Float64Array, n: number): Float64Array {
  const y = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    let s = b[i];
    for (let k = 0; k < i; k++) s -= Lm[i * n + k] * y[k];
    y[i] = s / Lm[i * n + i];
  }
  const x = new Float64Array(n);
  for (let i = n - 1; i >= 0; i--) {
    let s = y[i];
    for (let k = i + 1; k < n; k++) s -= Lm[k * n + i] * x[k];
    x[i] = s / Lm[i * n + i];
  }
  return x;
}

/**
 * Meze, jejichž hodnotu ostatní vazby (rovnosti) a motory neurčují: gradient hodnoty meze má složku v nulovém prostoru Jacobiánu
 * rovností (díl se smí v mezi volně posunout). `eq` = zbytky rovností (vazby bez jednostranných částí mezí + pohony), `gaps` = hodnoty
 * mezí. Numericky: z = ε·(JᵀJ + εI)⁻¹·∇g → ∇g·z / |∇g|² ≈ 1 ve volném směru, ≈ 0, je-li hodnota určena. Polohy se nemění.
 */
export function freeLimits(poses: Map<string, Pose>, vars: SolveVar[], eq: () => number[], gaps: { id: string; g: () => number }[], groups?: RigidGroups): string[] {
  const n = vars.length * 6;
  if (!n || !gaps.length) return [];
  const base = vars.map((v) => poses.get(v.id)!);
  const snap = new Map(poses);
  const apply = (x: Float64Array) => {
    vars.forEach((v, i) => {
      const P = base[i];
      const E = expRot([x[i * 6] / L, x[i * 6 + 1] / L, x[i * 6 + 2] / L]);
      poses.set(v.id, { R: mul3(E, P.R), p: add(add(apply3(E, sub(P.p, v.pivot)), v.pivot), [x[i * 6 + 3], x[i * 6 + 4], x[i * 6 + 5]]) });
    });
    if (groups) syncGroups(poses, groups, vars.map((v) => v.id));
  };
  const h = 1e-6;
  const x = new Float64Array(n);
  apply(x);
  const r0 = eq();
  const g0 = gaps.map((g) => g.g());
  const m = r0.length;
  const J = new Float64Array(m * n);
  const G = gaps.map(() => new Float64Array(n));
  for (let j = 0; j < n; j++) {
    x[j] = h;
    apply(x);
    const r = eq();
    for (let i = 0; i < m; i++) J[i * n + j] = ((r[i] ?? 0) - r0[i]) / h;
    gaps.forEach((g, k) => (G[k][j] = (g.g() - g0[k]) / h));
    x[j] = 0;
  }
  for (const [k, v] of snap) poses.set(k, v);
  const A = new Float64Array(n * n);
  let tr0 = 0;
  for (let i = 0; i < m; i++)
    for (let a = 0; a < n; a++) {
      const ja = J[i * n + a];
      if (!ja) continue;
      for (let b = a; b < n; b++) A[a * n + b] += ja * J[i * n + b];
    }
  for (let a = 0; a < n; a++) {
    for (let b = 0; b < a; b++) A[a * n + b] = A[b * n + a];
    tr0 = Math.max(tr0, A[a * n + a]);
  }
  const eps = 1e-8 * Math.max(1, tr0);
  for (let a = 0; a < n; a++) A[a * n + a] += eps;
  const Lm = cholesky(A, n);
  if (!Lm) return [];
  const out: string[] = [];
  gaps.forEach((g, k) => {
    const gk = G[k];
    const g2 = gk.reduce((s, v) => s + v * v, 0);
    if (g2 < 1e-12) return;
    const z = cholSolve(Lm, gk, n);
    let s = 0;
    for (let a = 0; a < n; a++) s += gk[a] * z[a];
    if ((eps * s) / g2 > 0.5) out.push(g.id);
  });
  return out;
}

/** rovnostní část zbytku vazby: u mezí bez jednostranného členu (poslední složka), jinak celý zbytek */
export function eqResidual(m: Mate, ctx: KinCtx): number[] {
  const r = kinResidual(m, ctx) ?? [];
  return isLimitMate(m) ? r.slice(0, -1) : r;
}

/* ───────────────────────── odchylky vazeb (protokol konfliktu) ───────────────────────── */

/** Odchylka podmínky v dané poloze: hodnota vazby / meze / délka pružiny, zadaná hodnota nebo meze a odchylka (0 = splněno). */
export type MateDev = { id: string; label: string; kind: "value" | "limit" | "spring" | "other"; value?: number; want?: number; min?: number; max?: number; dev: number; unit: "mm" | "°"; /** odchylka pohonu motoru (pořadí ve studii od 0) */ motor?: number };

/** Odchylka vazby `m` v poloze `ctx` (`label` = název do textu). */
export function mateDev(m: Mate, ctx: KinCtx, label: string): MateDev {
  if (isLimitMate(m)) {
    const x = limitGap(m, ctx);
    if (x) {
      const dev = x.min !== undefined && x.g < x.min ? x.g - x.min : x.max !== undefined && x.g > x.max ? x.g - x.max : 0;
      return { id: m.id, label, kind: "limit", value: x.g, ...(x.min !== undefined ? { min: x.min } : {}), ...(x.max !== undefined ? { max: x.max } : {}), dev, unit: x.unit };
    }
  }
  if (m.type === "distance" || m.type === "angle") {
    const A = wgeo(ctx, m.a);
    const B = wgeo(ctx, m.b);
    if (A && B) {
      // mezera = výška plochy A nad rovinou B po normále B (jako zbytek vazby; `flip` mění jen orientaci ploch)
      const value = m.type === "distance" ? dot(sub(A.origin, B.origin), B.normal) : Math.atan2(len(cross(A.normal, B.normal)), dot(A.normal, B.normal)) * DEG;
      const want = m.type === "angle" ? Math.abs(m.value ?? 0) : (m.value ?? 0);
      return { id: m.id, label, kind: "value", value, want, dev: value - want, unit: m.type === "angle" ? "°" : "mm" };
    }
  }
  const r = kinResidual(m, ctx);
  return { id: m.id, label, kind: "other", dev: r ? norm(r) : Infinity, unit: "mm" };
}

/** odchylka dorazu pružiny (Ln) */
export function springDev(s: SpringTerm, label: string): MateDev {
  const x = s.seat();
  return { id: `spring:${s.id}`, label, kind: "spring", ...(x !== null ? { value: x } : {}), ...(s.solid !== undefined ? { min: s.solid } : {}), dev: x !== null && s.solid !== undefined && x < s.solid ? x - s.solid : 0, unit: "mm" };
}

/**
 * Text odchylky: „„Mez“ 5 mm – na mezi min 5 mm (doraz)“, „„Mez“ 2,77 mm < min 5 mm (−2,23 mm)“, „„PEVNÁ“ 24,5 mm (zadáno 24,5 mm)“,
 * „pružina „P“ 14 mm – na délce na doraz Ln 14 mm“, „„Souosost …“ odchylka 0,12 mm“.
 */
export function devText(d: MateDev): string {
  const u = d.unit === "°" ? "°" : " mm";
  const v = (x: number) => `${fmt(x)}${u}`;
  const at = (b: number | undefined) => b !== undefined && d.value !== undefined && Math.abs(d.value - b) < 1e-4;
  if (d.kind === "limit" || d.kind === "spring") {
    const head = d.kind === "spring" ? tr("pružina „{0}“", d.label) : `„${d.label}“`;
    if (d.value === undefined) return tr("{0}: geometrie chybí", head);
    if (d.min !== undefined && d.value < d.min - 1e-4) return tr("{0} {1} < min {2} ({3})", head, v(d.value), v(d.min), `${fmt(d.dev)}${u}`);
    if (d.max !== undefined && d.value > d.max + 1e-4) return tr("{0} {1} > max {2} (+{3})", head, v(d.value), v(d.max), `${fmt(d.dev)}${u}`);
    if (d.kind === "spring" && at(d.min)) return tr("{0} {1} – na délce na doraz Ln {2}", head, v(d.value), v(d.min!));
    if (at(d.min)) return tr("{0} {1} – na mezi min {2} (doraz)", head, v(d.value), v(d.min!));
    if (at(d.max)) return tr("{0} {1} – na mezi max {2} (doraz)", head, v(d.value), v(d.max!));
    return tr("{0} {1} v mezích ⟨{2}; {3}⟩", head, v(d.value), d.min !== undefined ? fmt(d.min) : "−∞", d.max !== undefined ? fmt(d.max) : "∞");
  }
  if (d.kind === "value" && d.value !== undefined && d.want !== undefined) {
    if (Math.abs(d.dev) <= CONFLICT_TOL) return tr("„{0}“ {1} (splněno)", d.label, v(d.value));
    return tr("„{0}“ {1} místo {2} ({3})", d.label, v(d.value), v(d.want), `${d.dev > 0 ? "+" : ""}${fmt(d.dev)}${u}`);
  }
  return Number.isFinite(d.dev) && d.dev <= CONFLICT_TOL ? tr("„{0}“ (splněno)", d.label) : tr("„{0}“ odchylka {1}", d.label, Number.isFinite(d.dev) ? `${fmt(d.dev)} mm` : "?");
}

/** popis vazby do hlášení: „Mez „Přidržovač“ → „Deska A““ (název vazby, jinak druh) */
export const mateName = (m: Mate, comp: (id: string) => string) => `${m.name ?? tr(MATE_LABEL[m.type])} ${comp(m.a.compId)} → ${comp(m.b.compId)}`;

/** Geometrie pro statický přepočet (tentýž typ jako řešič vazeb). */
export type { GeoProvider };
