/**
 * Pružina mezi díly jedním krokem (vlna 21): dosedací plocha A a B (rovina, nebo díra / kapsa = válcová plocha a protější plocha) →
 * osa pružiny z plochy nebo osy díry, změřená vzdálenost dosedacích ploch, předvyplněná tabulka pružiny (d, De, L0, n, materiál →
 * tuhost, délka na doraz, síla), vložení dílu pružiny jako komponenty se zámkem ke komponentě A a definicí pružiny (SpringDef,
 * cad/asm-spring.ts) – u díry vzoru do všech děr stejného průměru a osy („do děr vzoru“: 6 pružin stírače jedním příkazem).
 *
 * Text: `sestava pružina nová [d 2] [De 20] [L0 35] [n 6] [tuhost c] [blok Ln] mezi "A" F3 "B" F7 [v x y z] [do děr vzoru] [název "P"]`
 *       a `sestava pružina "P" mezi "A" "B" … do děr vzoru` (kopie existující pružiny do ostatních děr vzoru). GUI (Sestava › Pružina
 * mezi díly, components/cad/springs/spring-between.tsx) skládá tentýž příkaz – dosedací plochy, délku i sílu počítá jedna cesta
 * (cad/asm-spring-agent.ts applySpringCmd).
 *
 * Výpočet v tabulce (EN 13906-1 – úplný výpočet pružiny z tabulky `@/cad/springs`, kontrola v pracovním bodě cad/asm-spring-check.ts):
 *   D = De − d,  R = G·d⁴ / (8·D³·n)  [N/mm],  nt = n + 2 (přiložené konce),  Ln = nt·d (broušené konce),  F = R·(L0 − L),
 *   nejmenší pracovní délka Ln + Sa, napětí τ (statická kontrola) a τk = k·τ při montáži a na dorazu vůči τzul = 0,5·Rm(d), vzpěr
 *   (u díry vedená – `SpringDef.guided`, protokol pohybu pak vzpěr nehlásí). Vše počítá výpočet pružiny z tabulky `@/cad/springs`.
 *   G: patentovaný drát SH/DH (EN 10270-1) 81 500 N/mm², VDSiCr (EN 10270-2) 79 500 N/mm², nerez 1.4310 (EN 10270-3) 70 000 N/mm².
 *   Příklad 2 × 20 × 44, n = 8: D = 18, R = 81 500·16 / (8·5 832·8) = 3,494 N/mm, Ln = 10·2 = 20 mm.
 */
import { composePlacement, eulerXYZ, invertPlacement, rotationBetween, transformPoint } from "./assembly";
import { faceShort, findComp, fmt, pickFace, SPRING_USE, type AsmCmd, type CompFaceRow } from "./agent-asm";
import { compFaces, type AsmEnv, type AsmResult } from "./asm-agent";
import { springGeom, springWorldAxis } from "./asm-spring-geom";
import { applySpringCmd } from "./asm-spring-agent";
import { springCheck, wireOfSpec } from "./asm-spring-check";
import { calcCompression, materialLabel, SPRING_MATERIALS, WIRE_MATERIALS } from "./springs";
import { tr } from "./i18n";
import { emptyDoc, uid, type AsmComponent, type CadDoc, type Mate, type Placement, type Vec3 } from "./types";

/**
 * Materiály drátu tabulky (EN 10270-1 / -2 / -3) – z výpočtu pružin `@/cad/springs` (G, E, ρ, Rm(d)); popisek v jazyce rozhraní.
 */
export const SPRING_WIRE_MATERIALS = () => WIRE_MATERIALS.map((id) => ({ id, G: SPRING_MATERIALS[id].G, rho: SPRING_MATERIALS[id].rho, label: materialLabel(id) }));
export type SpringSpec = { d: number; De: number; L0: number; n: number; material?: string };
export type SpringLite = {
  D: number;
  R: number;
  nt: number;
  Ln: number;
  /** stoupání činných závitů ve volném stavu (tvar balíku part: závěrné závity přiložené) */
  pitch: number;
  massKg: number;
  /** nejmenší součet mezer Sa a nejmenší pracovní délka Ln + Sa [mm] */
  Sa: number;
  Lmin: number;
  /** napětí bez korekce τ (statická kontrola) a s korekcí τk při montáži (je-li vzdálenost ploch) a na dorazu Ln [MPa] */
  tauSeat?: number;
  taukSeat?: number;
  tauLn: number;
  taukLn: number;
  /** dovolené τzul = 0,5·Rm [MPa] */
  tauzul: number;
  /** kritický zdvih vzpěru [mm] (Infinity = nevybočí) */
  sK: number;
  /** upozornění (⚠); `bad` = pružina nejde vyrobit (L0 ≤ Ln, De ≤ d) – Vytvořit se odmítne */
  issues: string[];
  bad: boolean;
};

const r1 = (v: number) => Math.round(v * 10) / 10;
const r05 = (v: number) => Math.round(v * 2) / 2;

/**
 * Spočtené řádky tabulky (EN 13906-1 – výpočet pružiny z tabulky `@/cad/springs`, kontrola v pracovním bodě cad/asm-spring-check.ts):
 * `seat` = vzdálenost dosedacích ploch (montážní délka), `guided` = pružina v díře / kapse (vedená – vzpěr se nehlásí).
 */
export function springLite(s: SpringSpec, seat?: number, guided?: boolean): SpringLite {
  const issues: string[] = [];
  const D = s.De - s.d;
  const w = wireOfSpec(s);
  const { nt, Ln } = w;
  if (!(D > 0) || !(s.d > 0) || !(s.n > 0)) {
    issues.push(tr("vnější průměr De musí být větší než drát d"));
    return { D, R: 0, nt, Ln, pitch: 0, massKg: 0, Sa: 0, Lmin: Ln, tauLn: 0, taukLn: 0, tauzul: 0, sK: Infinity, issues, bad: true };
  }
  const v = calcCompression({ d: s.d, De: s.De, L0: s.L0, n: s.n, ends: "ground", material: s.material ?? "SH" }).v;
  const R = v.R ?? 0;
  let bad = false;
  if (D / s.d < 4 || D / s.d > 20) issues.push(tr("poměr vinutí D/d = {0} je mimo doporučených 4 až 20", fmt(D / s.d, 2)));
  // pevnost, mezery, vzpěr a L0 > Ln (cad/asm-spring-check.ts nad výpočtem `@/cad/springs`)
  const chk = springCheck(w, { ...(seat !== undefined && seat < s.L0 ? { L: seat } : {}), guided });
  for (const x of chk.issues) {
    if (x.level === "error") bad = true;
    issues.push(x.text);
  }
  if (seat !== undefined && seat <= Ln) issues.push(tr("vzdálenost dosedacích ploch {0} mm je pod délkou na doraz Ln {1} mm – zmenšete n nebo d", fmt(seat, 3), fmt(Ln, 3)));
  if (seat !== undefined && seat >= s.L0) issues.push(tr("pružina nedosedá – L0 {0} mm není větší než vzdálenost ploch {1} mm", fmt(s.L0, 3), fmt(seat, 3)));
  return { D, R, nt, Ln, pitch: v.p ?? 0, massKg: v.mass ?? 0, Sa: chk.Sa, Lmin: chk.Lmin, ...(chk.tauWork !== undefined ? { tauSeat: chk.tauWork, taukSeat: chk.taukWork } : {}), tauLn: chk.tauLn, taukLn: chk.taukLn, tauzul: chk.tauzul, sK: chk.sK, issues, bad };
}

/**
 * Předvyplněná tabulka z dosedacích ploch: De podle díry (vůle 0,5 mm, nejvýš 5 %), d ≈ De/10, L0 = 1,15 × vzdálenost ploch
 * (předpětí 15 %), n ze stoupání ≈ 0,29·D (jako DIN 2095 2 × 20 × 44, n = 8).
 */
export function springDefaults(seat: number, holeD?: number): SpringSpec {
  const De = holeD ? Math.max(2, Math.floor((holeD - Math.max(0.5, holeD * 0.05)) * 2) / 2) : 20;
  const d = Math.max(0.5, r1(De / 10));
  const L0 = Math.max(Math.ceil(seat * 1.15), Math.ceil(seat + 2 * d));
  const D = De - d;
  const n = Math.max(2, r05((L0 - 2 * d) / (0.29 * D)));
  return { d, De, L0, n, material: "SH" };
}

/**
 * Díl pružiny: tabulková tlačná pružina `spring.compression` (broušené konce, výpočet a tvar `@/cad/springs`) – stejný prvek
 * v prohlížeči i v příkazové řádce (dřív záviselo na tom, zda je rozšíření zaregistrované). Osa +Z, začátek v počátku; materiál
 * drátu je v datech prvku (tabulka, `pružina tabulka`, kontrola v pohybu), materiál dílu nerez u 1.4310 (hustota, kusovník).
 */
export function springPartDoc(s: SpringSpec, name: string): CadDoc {
  const material = s.material === "1.4310" ? "nerez" : "ocel";
  return { ...emptyDoc(name), material, features: [{ id: uid(), name: tr("Tlačná pružina"), type: "ext", ext: "spring.compression", data: { d: s.d, De: s.De, L0: s.L0, n: s.n, ends: "ground", material: s.material ?? "SH", at: [0, 0, 0], axis: "Z", mode: "new" } }] };
}

const dot = (a: Vec3, b: Vec3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const sub = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const add = (a: Vec3, b: Vec3, k = 1): Vec3 => [a[0] + b[0] * k, a[1] + b[1] * k, a[2] + b[2] * k];
const len = (a: Vec3) => Math.hypot(a[0], a[1], a[2]);
const perp = (v: Vec3, u: Vec3): Vec3 => add(v, u, -dot(v, u));
const rv = (v: Vec3): Vec3 => v.map((x) => Math.round(x * 1e6) / 1e6 || 0) as Vec3;

/** Díry vzoru: válcové plochy komponenty se stejným průměrem, rovnoběžnou osou a délkou jako `hole` (včetně `hole`), seřazené. */
export function patternHoles(rows: CompFaceRow[], hole: CompFaceRow): CompFaceRow[] {
  const u = hole.normal;
  const out = rows.filter((r) => r.kind === "cylinder" && !r.cone && Math.abs((r.radius ?? 0) - (hole.radius ?? 0)) < 0.01 && Math.abs(Math.abs(dot(r.normal, u)) - 1) < 1e-4 && Math.abs((r.length ?? 0) - (hole.length ?? 0)) < 0.01 && Math.abs(dot(sub(r.origin, hole.origin), u)) < 0.01 && r.leafId === hole.leafId);
  // jedna díra = jedna osa (válcová plocha může být rozdělená na dvě poloviny se stejnou osou)
  const uniq: CompFaceRow[] = [];
  for (const r of out) if (!uniq.some((x) => len(perp(sub(x.origin, r.origin), u)) < 0.01)) uniq.push(r);
  return uniq.sort((a, b) => a.origin[0] - b.origin[0] || a.origin[1] - b.origin[1] || a.origin[2] - b.origin[2]);
}

/** Název nové pružiny: „Pružina 2×20×35“, při shodě se jménem v sestavě „… (2)“. */
function uniqueName(doc: CadDoc, want: string): string {
  const names = new Set((doc.components ?? []).map((c) => c.name));
  if (!names.has(want)) return want;
  for (let k = 2; ; k++) if (!names.has(`${want} (${k})`)) return `${want} (${k})`;
}
/** pružiny komponent `ids` vedené dírou / kapsou (`SpringDef.guided`) */
const markGuided = (doc: CadDoc, ids: string[]): CadDoc => ({ ...doc, components: (doc.components ?? []).map((c) => (c.spring && ids.includes(c.id) ? { ...c, spring: { ...c.spring, guided: true } } : c)) });
const refOf = (doc: CadDoc, c: AsmComponent) => `#${(doc.components ?? []).findIndex((x) => x.id === c.id) + 1}`;
const lockTo = (spring: AsmComponent, A: AsmComponent): Mate => ({ id: uid(), type: "lock", name: tr("Zámek pružiny"), a: { compId: spring.id, face: -1 }, b: { compId: A.id, face: -1 }, rel: composePlacement(invertPlacement(A.placement), spring.placement) });

type SpringCmd = Extract<AsmCmd, { k: "spring" }>;

/** `sestava pružina nová … mezi "A" F… "B" F… [do děr vzoru]` – nová pružina z tabulky mezi dvěma komponentami. */
export async function applySpringNew(d: CadDoc, cmd: SpringCmd, env: AsmEnv): Promise<AsmResult> {
  if (d.kind !== "assembly") throw new Error(tr("otevřený dokument „{0}“ není sestava – nejdřív „nová sestava“ nebo „záložka \"…\"“", d.name));
  if (cmd.a === undefined || cmd.b === undefined) throw new Error(tr("nová pružina: zadejte dosedací komponenty – {0}", SPRING_NEW_USE()));
  const A = findComp(d, cmd.a);
  const B = findComp(d, cmd.b);
  if (A.id === B.id) throw new Error(tr("pružina: dosedací plochy musí být na dvou různých komponentách (A ≠ B)"));
  if (!cmd.faceA && !cmd.faceB) throw new Error(tr("nová pružina: zadejte aspoň jednu plochu (díru A nebo dosedací rovinu) – {0}", SPRING_NEW_USE()));
  const rowsA = (await compFaces(d, A.id, env)).rows;
  const rowsB = (await compFaces(d, B.id, env)).rows;
  const fA = cmd.faceA ? pickFace(cmd.faceA, rowsA, null, A.name, tr("dosedací plocha A: ")).row : null;
  const fB = cmd.faceB ? pickFace(cmd.faceB, rowsB, null, B.name, tr("dosedací plocha B: ")).row : null;
  const hole = fA?.kind === "cylinder" ? fA : fB?.kind === "cylinder" ? fB : null;
  // směr osy u: od A k B (rovina A směřuje k pružině = u, rovina B proti ní = −u, jinak podle středů ploch)
  let u: Vec3;
  if (fA?.kind === "plane") u = fA.normal;
  else if (fB?.kind === "plane") u = [-fB.normal[0], -fB.normal[1], -fB.normal[2]];
  else {
    const n = hole!.normal;
    const toB = sub(fB?.origin ?? B.placement.position, fA?.origin ?? A.placement.position);
    u = dot(toB, n) >= 0 ? n : [-n[0], -n[1], -n[2]];
  }
  if (hole && Math.abs(Math.abs(dot(hole.normal, u)) - 1) > 1e-3) throw new Error(tr("nová pružina: osa díry {0} není kolmá na dosedací rovinu – vyberte protější rovinnou plochu", faceShort(hole)));
  if (fA?.kind === "plane" && fB?.kind === "plane" && dot(fA.normal, fB.normal) > -0.999) throw new Error(tr("nová pružina: dosedací roviny {0} a {1} nejsou protilehlé rovnoběžné plochy", faceShort(fA), faceShort(fB)));
  // bod osy: díra (osa), jinak zadaný bod „v x y z“ nebo střed roviny A promítnutý
  const axisPt: Vec3 = hole ? hole.origin : cmd.create?.at ?? fA?.origin ?? fB!.origin;
  // začátek pružiny na straně A: rovina A, nebo konec díry A dál od B (dno kapsy), u díry B bod na rovině A / ploše A
  let tA: number;
  if (fA?.kind === "plane") tA = dot(sub(fA.origin, axisPt), fA.normal) / dot(u, fA.normal);
  else if (fA?.kind === "cylinder") tA = dot(sub(fA.origin, axisPt), u) - (fA.length ?? 0) / 2;
  else tA = dot(sub(hole!.origin, axisPt), u) - 1e3; // jen díra B bez plochy A – plochu A najde autoSeat po ose
  const P0 = add(axisPt, u, tA);
  // vzdálenost dosedacích ploch (odhad pro tabulku): rovina B, nebo dno díry B
  const tB = fB?.kind === "plane" ? dot(sub(fB.origin, P0), fB.normal) / dot(u, fB.normal) : fB?.kind === "cylinder" ? dot(sub(fB.origin, P0), u) + (fB.length ?? 0) / 2 : NaN;
  const seat = Number.isFinite(tB) && tB > 0 ? tB : undefined;
  const def = springDefaults(seat ?? 30, hole ? 2 * (hole.radius ?? 0) : undefined);
  const spec: SpringSpec = { d: cmd.create?.d ?? def.d, De: cmd.create?.De ?? def.De, L0: cmd.free ?? def.L0, n: cmd.create?.n ?? def.n, material: cmd.create?.material ?? "SH" };
  if (!(spec.d > 0 && spec.De > spec.d && spec.L0 > 0 && spec.n > 0)) throw new Error(tr("nová pružina: rozměry musí být kladné a De větší než d – {0}", SPRING_NEW_USE()));
  const calc = springLite(spec, seat, !!hole);
  if (calc.bad) throw new Error(tr("nová pružina: {0}", calc.issues.join(" · ")));
  // díry vzoru (stejný Ø, osa a délka na téže komponentě)
  const holes = cmd.holes && hole ? patternHoles(hole === fA ? rowsA : rowsB, hole) : hole ? [hole] : [];
  if (cmd.holes && !hole) throw new Error(tr("do děr vzoru: vyberte díru (válcovou plochu) na komponentě A nebo B"));
  const starts = holes.length ? holes.map((h) => add(P0, perp(sub(h.origin, hole!.origin), u))) : [P0];
  const name = uniqueName(d, cmd.create?.name ?? `${tr("Pružina")} ${fmt(spec.d)}×${fmt(spec.De)}×${fmt(spec.L0)}`);
  const part = springPartDoc(spec, name);
  const rotation = eulerXYZ(rotationBetween([0, 0, 1], u)).map((v) => Math.round(v * 1e9) / 1e9 || 0) as Vec3;
  const comps: AsmComponent[] = starts.map((p) => ({ id: uid(), name, source: { kind: "part", doc: part }, placement: { position: rv(p), rotation } as Placement, group: "Pružiny", color: "#8a94a3" }));
  const doc0: CadDoc = { ...d, components: [...(d.components ?? []), ...comps], mates: [...(d.mates ?? []), ...comps.map((c) => lockTo(c, A))] };
  const log = [
    tr("✓ nová pružina „{0}“ {1}× · d {2} · De {3} · L0 {4} · n {5} · R {6} N/mm · Ln {7} mm{8} – zámek ke komponentě „{9}“", name, comps.length, fmt(spec.d), fmt(spec.De), fmt(spec.L0), fmt(spec.n), fmt(calc.R, 3), fmt(calc.Ln, 3), holes.length > 1 ? tr(" · do děr {0} Ø{1}", holes.map((h) => faceShort(h).split(" ")[0]).join("/"), fmt(2 * (hole!.radius ?? 0))) : "", A.name),
    ...calc.issues.map((t) => `⚠ ${t}`),
  ];
  // dosedací plochy, délka a síla jednou cestou (sestava pružina): rovina = zadaná plocha, díra = dno kapsy po ose (autoSeat)
  const r = await applySpringCmd(doc0, { k: "spring", comp: name, a: refOf(doc0, A), ...(fA?.kind === "plane" ? { faceA: cmd.faceA } : {}), b: refOf(doc0, B), ...(fB?.kind === "plane" ? { faceB: cmd.faceB } : {}), free: spec.L0, solid: cmd.solid ?? calc.Ln, rate: cmd.rate ?? Math.round(calc.R * 1000) / 1000 }, env);
  // pružina v díře / kapse je vedená – protokol pohybu pak vzpěr nehlásí (springMotionCheck)
  return { ...r, doc: hole ? markGuided(r.doc, comps.map((c) => c.id)) : r.doc, log: [...log, ...r.log], changed: true };
}

/** `sestava pružina "P" mezi "A" … do děr vzoru` – kopie pružiny do ostatních děr vzoru komponenty A (díra souosá s pružinou). */
export async function applySpringPattern(d: CadDoc, cmd: SpringCmd, env: AsmEnv): Promise<AsmResult> {
  const c = findComp(d, cmd.comp);
  if (c.source.kind !== "part") throw new Error(tr("pružina: komponenta „{0}“ není díl (podsestava / import) – pružina potřebuje díl s prvkem Pružina", c.name));
  const g = springGeom(c.source.doc);
  if (!g) throw new Error(tr("komponenta „{0}“ není pružina – díl potřebuje prvek Pružina (normálie pružina d2 D20 L44 n8 · pružina D stoupání P závity N drát d) nebo trubku / válec po ose", c.name));
  const Aref = cmd.a ?? (c.spring ? refOf(d, (d.components ?? []).find((x) => x.id === c.spring!.a.compId)!) : undefined);
  if (!Aref) throw new Error(tr("do děr vzoru: zadejte komponentu s dírami – {0}", SPRING_USE()));
  const A = findComp(d, Aref);
  const rowsA = (await compFaces(d, A.id, env)).rows;
  const P0 = transformPoint(c.placement, g.base);
  const u = springWorldAxis(c, g);
  // díra souosá s pružinou
  const own = rowsA.filter((r) => r.kind === "cylinder" && Math.abs(Math.abs(dot(r.normal, u)) - 1) < 1e-3 && len(perp(sub(r.origin, P0), u)) < Math.max(0.05, (r.radius ?? 0) * 0.02)).sort((a, b) => (b.radius ?? 0) - (a.radius ?? 0))[0];
  if (!own) throw new Error(tr("do děr vzoru: pružina „{0}“ nestojí v díře komponenty „{1}“ (osa pružiny neleží v ose žádné válcové plochy)", c.name, A.name));
  const others = patternHoles(rowsA, own).filter((h) => len(perp(sub(h.origin, own.origin), u)) > 0.01);
  const lock = (d.mates ?? []).find((m) => m.type === "lock" && !m.suppressed && ((m.a.compId === c.id && m.b.compId === A.id) || (m.b.compId === c.id && m.a.compId === A.id)));
  const comps: AsmComponent[] = others.map((h) => {
    const dp = perp(sub(h.origin, own.origin), u);
    const { spring: _s, alias: _a, ...rest } = c;
    void _s;
    void _a;
    return { ...rest, id: uid(), placement: { position: rv(add(c.placement.position, dp)), rotation: c.placement.rotation } };
  });
  const doc0: CadDoc = { ...d, components: [...(d.components ?? []), ...comps], mates: [...(d.mates ?? []), ...(lock ? comps.map((x) => lockTo(x, A)) : [])] };
  // všechny instance se stejným názvem (původní + kopie) jedním příkazem
  // kopie převezmou L0, Ln a tuhost původní pružiny (nezadané v příkazu)
  const def = c.spring;
  const r = await applySpringCmd(doc0, { ...cmd, holes: undefined, comp: c.name, ...(cmd.free === undefined && def ? { free: def.free } : {}), ...(cmd.solid === undefined && def?.solid !== undefined ? { solid: def.solid } : {}), ...(cmd.rate === undefined && def?.rate !== undefined ? { rate: def.rate } : {}) }, env);
  // kopie stojí v dírách vzoru – jsou vedené (jako pružina, ze které vznikly, stojí-li v díře)
  return {
    ...r,
    doc: markGuided(r.doc, [c.id, ...comps.map((x) => x.id)]),
    log: [tr("✓ pružina „{0}“ do děr vzoru {1} Ø{2} komponenty „{3}“: +{4} kopií{5}", c.name, [own, ...others].map((h) => faceShort(h).split(" ")[0]).join("/"), fmt(2 * (own.radius ?? 0)), A.name, comps.length, lock ? tr(" (zámek k „{0}“)", A.name) : ""), ...r.log], changed: true };
}

export const SPRING_NEW_USE = () => tr("sestava pružina nová [d 2] [De 20] [L0 35] [n 6] [tuhost c] [blok Ln] mezi \"Horní deska\" F12 \"Stírací deska\" F3 [v x y z] [do děr vzoru] [název \"P\"]");

/** `sestava pružina nápověda` – přehled příkazů pružin v sestavě a v pohybu (GUI: Sestava › Pružina mezi díly). */
export function springHelpLines(): string[] {
  return [
    tr("Pružina v sestavě – příkazy (GUI: Sestava › Pružina mezi díly):"),
    `  ${SPRING_NEW_USE()}`,
    `  ${tr("– nová pružina z tabulky: osa z díry / roviny, L0 = 1,15 × vzdálenost ploch; materiál SH | DH | VDSiCr | 1.4310")}`,
    `  ${SPRING_USE()}`,
    `  ${tr("sestava pružina \"P\" mezi \"A\" \"B\" do děr vzoru – kopie pružiny do ostatních děr vzoru komponenty A")}`,
    `  ${tr("Tabulka i protokol pohybu počítají podle EN 13906-1 (výpočet pružiny z tabulky): tuhost R = G·d⁴ / (8·D³·n), délku na doraz Ln, nejmenší pracovní délku Ln + Sa (dotyk závitů), napětí τ vůči τzul = 0,5·Rm (statická kontrola; τk = k·τ přísnější rada pro opakované zatížení) a vzpěr (v díře vedená).")}`,
    `  ${tr("Pohyb: pohyb motor … (kinematika) · pohyb dynamika čas 0,5 krok 0,0005 [gravitace -Z] [tlumení 0,05] [odraz 0,2] – síly pružin hýbou díly; pružina bez tuhosti dostane tuhost z geometrie dílu.")}`,
  ];
}
