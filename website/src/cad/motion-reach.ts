/**
 * Co motor skutečně pohání (vlna 22, bod 10 zprávy) – zjištěno ZKUŠEBNÍM POSUNEM řešičem studie, ne odhadem z typu vazby:
 * motor se v kroku 0 → 1 pootočí / posune o malou hodnotu (1 mm / 1°) a porovná se poloha všech komponent. Výsledek:
 *
 * - `comps` = komponenty, které se s motorem pohnou (řízený díl + díly s ním spojené zámkem / pevnými vazbami nebo vedením),
 *   `locked` = ty, které drží zámek (protokol a panel to vysvětlí: „pohybují se společně, protože jsou spojené pevnou vazbou“);
 * - `axis` = osa a směr pohybu ve světových souřadnicích (posuv: směr posunutí řízeného dílu; otáčení: osa šroubového pohybu) –
 *   panel ji kreslí šipkou ve 3D okně (WebGL i softwarový náhled);
 * - `motorConflicts` = dvojice motorů, které ve stejném čase pohánějí tentýž stupeň volnosti (zkušební posun jednoho motoru, druhý
 *   drží svou hodnotu → posun se nedá splnit; motory na různých vazbách jsou od začátku pozdějšího činné oba), motor na téže vazbě
 *   se stejným začátkem a motor, jehož stupeň volnosti drží vazby
 *   samy. Hlásí se už při definici (⚠ `motion.motor-conflict`), ne až ve výpočtu.
 */
import { rotMatrix } from "./assembly";
import { tr } from "./i18n";
import { MATE_LABEL, type GeoProvider } from "./mates";
import { motorCurrent, motorStartTime } from "./motor-model";
import { runMotion, type MotionResult } from "./motion";
import { plusParts, rigidMotionGroups } from "./motion-groups";
import type { CadDoc, Mate, MotionMotor, MotionStudy, Placement, Vec3 } from "./types";

export type MotorReach = {
  /** pořadí motoru ve studii (od 0) */
  motor: number;
  mate: string;
  /** komponenty, které se s motorem pohnou (řízený díl první) */
  comps: string[];
  /** z nich ty, které se pohybují s řízeným dílem kvůli zámku / pevné vazbě */
  locked: string[];
  /** osa a směr pohybu (světové souřadnice); `rotary` = osa otáčení */
  axis?: { origin: Vec3; dir: Vec3; rotary: boolean };
  /** motor se nepohne ani jedním směrem (stupeň volnosti drží vazby) */
  blocked?: boolean;
};
export type MotorConflict = { a: number; b: number | null; kind: "same-mate" | "same-dof" | "blocked"; text: string };

const EPS = 1e-6;
const sub = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const len = (a: Vec3) => Math.hypot(a[0], a[1], a[2]);

/** motor pro zkušební posun: z nynější hodnoty o `d` (bez okna, fáze, úseků) */
function probeMotor(mo: MotionMotor, mates: Mate[], d: number, id = mo.id): MotionMotor {
  const m = mates.find((x) => x.id === mo.mate);
  const cur = motorCurrent(mo, m);
  return { id, kind: mo.kind, mate: mo.mate, from: cur, to: cur + d };
}
/** motor, který drží nynější hodnotu */
function holdMotor(mo: MotionMotor, mates: Mate[]): MotionMotor {
  const m = mates.find((x) => x.id === mo.mate);
  const cur = motorCurrent(mo, m);
  return { id: mo.id, kind: mo.kind, mate: mo.mate, from: cur, to: cur };
}
async function probe(doc: CadDoc, geo: GeoProvider, motors: MotionMotor[]): Promise<MotionResult | null> {
  const study: MotionStudy = { motors, duration: 1, steps: 1, mode: "kinematic" };
  try {
    return await runMotion({ ...doc, motion: study }, geo, study);
  } catch {
    return null;
  }
}
/** komponenty, které se mezi krokem 0 a 1 pohnuly */
function movedOf(r: MotionResult): string[] {
  const [a, b] = [r.steps[0], r.steps[1]];
  if (!a || !b) return [];
  return r.comps.map((c) => c.id).filter((id) => a.place[id] && b.place[id] && (len(sub(b.place[id].position, a.place[id].position)) > EPS || b.place[id].rotation.some((v, k) => Math.abs(v - a.place[id].rotation[k]) > 1e-6)));
}

/** osa šroubového pohybu z polohy p0 → p1 (otáčení) / směr posunutí (posuv) */
function axisOf(p0: Placement, p1: Placement, rotary: boolean): { origin: Vec3; dir: Vec3; rotary: boolean } | undefined {
  if (!rotary) {
    const d = sub(p1.position, p0.position);
    const l = len(d);
    return l > EPS ? { origin: p0.position, dir: [d[0] / l, d[1] / l, d[2] / l], rotary: false } : undefined;
  }
  // relativní natočení R = R1·R0ᵀ → osa u a úhel θ; bod osy c = (t⊥ + cot(θ/2)·u × t⊥) / 2 (Chasles), t = p1 − R·p0
  const A = rotMatrix(p0.rotation);
  const B = rotMatrix(p1.rotation);
  const R = new Array(9).fill(0);
  for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) R[i * 3 + j] = B[i * 3] * A[j * 3] + B[i * 3 + 1] * A[j * 3 + 1] + B[i * 3 + 2] * A[j * 3 + 2];
  const ax: Vec3 = [R[7] - R[5], R[2] - R[6], R[3] - R[1]];
  const s = len(ax);
  if (s < 1e-9) return undefined;
  const u: Vec3 = [ax[0] / s, ax[1] / s, ax[2] / s];
  const th = Math.atan2(s / 2, (R[0] + R[4] + R[8] - 1) / 2);
  const p = p0.position;
  const Rp: Vec3 = [R[0] * p[0] + R[1] * p[1] + R[2] * p[2], R[3] * p[0] + R[4] * p[1] + R[5] * p[2], R[6] * p[0] + R[7] * p[1] + R[8] * p[2]];
  const t = sub(p1.position, Rp);
  const tu = t[0] * u[0] + t[1] * u[1] + t[2] * u[2];
  const tp: Vec3 = [t[0] - tu * u[0], t[1] - tu * u[1], t[2] - tu * u[2]];
  const cr: Vec3 = [u[1] * tp[2] - u[2] * tp[1], u[2] * tp[0] - u[0] * tp[2], u[0] * tp[1] - u[1] * tp[0]];
  const cot = 1 / Math.tan(th / 2);
  return { origin: [(tp[0] + cot * cr[0]) / 2, (tp[1] + cot * cr[1]) / 2, (tp[2] + cot * cr[2]) / 2], dir: u, rotary: true };
}

/** sestava s potlačenými vazbami `ids` (vazby, jejichž hodnotu určuje jiný motor) */
const freeOf = (doc: CadDoc, ids: string[]): CadDoc => (ids.length ? { ...doc, mates: (doc.mates ?? []).map((m) => (ids.includes(m.id) ? { ...m, suppressed: true } : m)) } : doc);
/** vazby ostatních motorů činných ve stejném čase – jejich hodnotu určuje motor, ne vazba */
const otherMates = (study: Pick<MotionStudy, "motors">, i: number) => study.motors.filter((m, k) => k !== i && m.mate !== study.motors[i].mate && overlaps(m, study.motors[i])).map((m) => m.mate);

/**
 * Co pohání motor `i` studie (zkušební posun 1 mm / 1° ve směru pohybu motoru, při zablokování opačně). Vazby ostatních motorů
 * se stejným začátkem se při zkoušce uvolní (jejich hodnotu určuje motor, ne vazba).
 */
export async function motorReach(doc0: CadDoc, geo: GeoProvider, study: Pick<MotionStudy, "motors">, i: number): Promise<MotorReach | null> {
  const mo = study.motors[i];
  if (!mo) return null;
  const doc = freeOf(doc0, otherMates(study, i));
  const mates = doc.mates ?? [];
  const dir = Math.sign((mo.legs?.[0]?.to ?? mo.keys?.[1]?.v ?? mo.to) - mo.from) || 1;
  for (const d of [dir, -dir]) {
    const r = await probe(doc, geo, [probeMotor(mo, mates, d)]);
    if (!r) return null;
    const moved = movedOf(r);
    if (!moved.length || r.steps[1]?.status) continue;
    const m = mates.find((x) => x.id === mo.mate);
    const lead = m && moved.includes(m.a.compId) ? m.a.compId : m && moved.includes(m.b.compId) ? m.b.compId : moved[0];
    // díly, které drží zámek s řízeným dílem (vysvětlení „pohybují se společně“)
    const g = rigidMotionGroups(r, doc).moving.find((x) => x.ids.includes(lead));
    const locked = g?.locked ? g.ids.filter((id) => id !== lead) : [];
    const order = [lead, ...moved.filter((id) => id !== lead)];
    const axis = axisOf(r.steps[0].place[lead], r.steps[1].place[lead], mo.kind === "rotary");
    // směr osy = směr, kterým motor jede (zkušební posun mohl jít opačně)
    if (axis && d !== dir) axis.dir = [-axis.dir[0], -axis.dir[1], -axis.dir[2]];
    return { motor: i, mate: mo.mate, comps: order, locked, ...(axis ? { axis } : {}) };
  }
  return { motor: i, mate: mo.mate, comps: [], locked: [], blocked: true };
}

/** stejný začátek (okno / fáze) – motor na téže vazbě nepřevezme vazbu od druhého */
const sameStart = (a: MotionMotor, b: MotionMotor) => (a.phase ?? "") === (b.phase ?? "") && Math.abs(motorStartTime(a) - motorStartTime(b)) < 1e-9;
/**
 * Časy činnosti dvou motorů se překrývají. Motor od svého začátku pohání (po konci okna drží koncovou hodnotu), dokud jeho vazbu
 * nepřevezme pozdější motor NA TÉŽE vazbě – motory na RŮZNÝCH vazbách jsou tedy od začátku pozdějšího z nich činné oba, ať se jejich
 * okna dotýkají, překrývají, nebo jdou po sobě (vlna 22, bod 10 – kolo 6: dřív se zkoušel jen stejný začátek). Na téže vazbě se
 * překrývají jen se stejným začátkem (jinak pozdější převezme vazbu).
 */
const overlaps = (a: MotionMotor, b: MotionMotor) => a.mate !== b.mate || sameStart(a, b);

/**
 * Konflikty motorů studie (definice): stejná vazba se stejným začátkem, tentýž stupeň volnosti (zkušební posun motoru `a`, motor `b`
 * drží – posun nejde splnit), motor zablokovaný vazbami. `only` = kontrolovat jen motory s tímto pořadím (nový / upravený motor).
 */
export async function motorConflicts(doc: CadDoc, geo: GeoProvider, study: Pick<MotionStudy, "motors">, only?: number): Promise<MotorConflict[]> {
  const mates = doc.mates ?? [];
  const label = (k: number) => {
    const m = mates.find((x) => x.id === study.motors[k]?.mate);
    return tr("motor {0} ({1})", k + 1, m ? (m.name ?? tr(MATE_LABEL[m.type])) : "?");
  };
  const out: MotorConflict[] = [];
  const list = study.motors.map((_, k) => k).filter((k) => only === undefined || k === only);
  for (const a of list) {
    const A = study.motors[a];
    for (let b = 0; b < study.motors.length; b++) {
      if (b === a || (only === undefined && b < a)) continue;
      const B = study.motors[b];
      if (!overlaps(A, B)) continue;
      if (A.mate === B.mate) {
        out.push({ a, b, kind: "same-mate", text: tr("{0} a {1} pohánějí tutéž vazbu od stejného okamžiku – výpočet je nesplní oba; navazující úseky zapište jedním motorem (… pak …, navázat), nebo motoru dejte jiné časové okno / fázi", label(a), label(b)) });
        continue;
      }
      // tentýž stupeň volnosti: motor a se zkusí posunout, motor b drží svou hodnotu
      const dir = Math.sign(A.to - A.from) || 1;
      let ok = false;
      for (const d of [dir, -dir]) {
        const r = await probe(doc, geo, [probeMotor(A, mates, d, "probe-a"), holdMotor(B, mates)]);
        if (r && !r.steps[1]?.status && !r.steps[1]?.conflicts.length && movedOf(r).length) {
          ok = true;
          break;
        }
      }
      if (!ok) {
        // zablokováno: je to vazbou druhého motoru? (s uvolněnou vazbou motoru b se motor a pohne → tentýž stupeň volnosti)
        const alone = await motorReach(freeOf(doc, [B.mate]), geo, { motors: [A] }, 0);
        if (alone && !alone.blocked) {
          const nm = (id: string) => doc.components?.find((c) => c.id === id)?.name ?? id;
          const who = alone.comps[0] ? `„${nm(alone.comps[0])}“` : tr("tentýž díl");
          out.push({
            a,
            b,
            kind: "same-dof",
            text: sameStart(A, B)
              ? tr("{0} pohání stejný stupeň volnosti {1} jako {2} – díl nemůže splnit oba motory najednou a výpočet je rozloží (motor na mezi / nesplněné vazby); smažte jeden motor, nebo je rozdělte do fází / časových oken", label(a), who, label(b))
              : // jiný začátek nepomůže: dřívější motor po konci svého okna dál drží koncovou hodnotu (kolo 6)
                tr("{0} pohání stejný stupeň volnosti {1} jako {2} – časy činnosti se překrývají (motor po konci svého okna dál drží koncovou hodnotu), díl nemůže splnit oba motory a výpočet je rozloží (motor na mezi / nesplněné vazby); smažte jeden motor, nebo pohyb dílu zadejte jedním motorem s úseky (… pak …, navázat)", label(a), who, label(b)),
          });
        }
      }
    }
    // motor zablokovaný: vazby ostatních motorů činných ve stejném čase jsou při zkoušce uvolněné (motorReach), takže „blocked“
    // = drží ho vazby sestavy samy. Motor, který blokuje JINÝ motor, už nahlásila větev same-dof výše – žádné druhé, nepravdivé
    // „zámek, ukotvení, mez“ (kolo 6)
    const reach = await motorReach(doc, geo, study, a);
    if (reach?.blocked && !out.some((c) => c.kind === "same-dof" && (c.a === a || c.b === a)))
      out.push({ a, b: null, kind: "blocked", text: tr("{0} se nemůže pohnout ani jedním směrem – jeho stupeň volnosti drží vazby (zámek, ukotvení, mez); potlačte blokující vazbu nebo zvolte jinou vazbu", label(a)) });
  }
  return out;
}

/** Popis dosahu motoru slovy: „pohání: „Přidržovač“ + 1 díl (zámek: „Šroub M12“) · osa −Z“ */
export function reachText(r: MotorReach, doc: CadDoc): string {
  // instance jako v kolizích a stromu (clash-report.ts compLabel): přezdívka „Kostka [K7]“, jinak „Kostka #7“ u opakovaného dílu –
  // dřív u sestavy se 100 komponentami „„Kostka“, „Kostka“, „Kostka“ a další“ (kolo 7, měření bodu 10)
  const comps = doc.components ?? [];
  const nm = (id: string) => {
    const c = comps.find((x) => x.id === id);
    if (!c) return id;
    if (c.alias) return `${c.name} [${c.alias}]`;
    return comps.filter((x) => x.name === c.name).length > 1 ? `${c.name} #${comps.indexOf(c) + 1}` : c.name;
  };
  if (r.blocked || !r.comps.length) return tr("nepohne se (stupeň volnosti drží vazby)");
  const others = r.comps.length - 1;
  const lockedTxt = r.locked.length ? tr(" – spolu s ním kvůli pevné vazbě (zámku): {0}{1}", r.locked.slice(0, 3).map((id) => `„${nm(id)}“`).join(", "), r.locked.length > 3 ? tr(" a další") : "") : "";
  const ax = r.axis ? axisWord(r.axis) : "";
  return tr("pohání: „{0}“{1}{2}{3}", nm(r.comps[0]), others ? ` ${plusParts(others)}` : "", lockedTxt, ax ? ` · ${ax}` : "");
}
/** „osa −Z“ / „osa otáčení +X“ / „směr [0,6; 0; −0,8]“ */
export function axisWord(a: { dir: Vec3; rotary: boolean }): string {
  const k = a.dir.findIndex((v) => Math.abs(Math.abs(v) - 1) < 1e-6);
  const name = k >= 0 ? `${a.dir[k] > 0 ? "+" : "−"}${"XYZ"[k]}` : `[${a.dir.map((v) => (Math.round(v * 1000) / 1000).toString()).join("; ")}]`;
  return a.rotary ? tr("osa otáčení {0}", name) : tr("směr {0}", name);
}

/** komponenty, které zvýraznit, a šipka osy pro 3D okno (panel → cad-app) */
export function reachHighlight(r: MotorReach | null, length = 40): { comps: string[]; lines: [Vec3, Vec3][]; tip: Vec3 } | null {
  if (!r || !r.comps.length) return null;
  if (!r.axis) return { comps: r.comps, lines: [], tip: [0, 0, 0] };
  const { origin: o, dir: d } = r.axis;
  const tip: Vec3 = [o[0] + d[0] * length, o[1] + d[1] * length, o[2] + d[2] * length];
  const tail: Vec3 = r.axis.rotary ? [o[0] - d[0] * length, o[1] - d[1] * length, o[2] - d[2] * length] : o;
  // hrot šipky: dvě krátké úsečky skloněné k ose (kolmice z libovolného nerovnoběžného vektoru)
  const ref: Vec3 = Math.abs(d[2]) < 0.9 ? [0, 0, 1] : [1, 0, 0];
  const n: Vec3 = [d[1] * ref[2] - d[2] * ref[1], d[2] * ref[0] - d[0] * ref[2], d[0] * ref[1] - d[1] * ref[0]];
  const nl = len(n) || 1;
  const h = length * 0.18;
  const back: Vec3 = [tip[0] - d[0] * h, tip[1] - d[1] * h, tip[2] - d[2] * h];
  const w1: Vec3 = [back[0] + (n[0] / nl) * h * 0.6, back[1] + (n[1] / nl) * h * 0.6, back[2] + (n[2] / nl) * h * 0.6];
  const w2: Vec3 = [back[0] - (n[0] / nl) * h * 0.6, back[1] - (n[1] / nl) * h * 0.6, back[2] - (n[2] / nl) * h * 0.6];
  return { comps: r.comps, lines: [[tail, tip], [tip, w1], [tip, w2]], tip };
}

