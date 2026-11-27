/**
 * Pružina v sestavě textem: `sestava pružina "P" mezi "A" [F3] "B" [F7] [volná L0] [blok Ln] [tuhost c]`, `… odebrat`,
 * `sestava pružiny` (stav), a přepočet délek pružin po přepočtu vazeb (cad/asm-agent.ts solveAsm). Dosedací plochu bez zadání
 * vybere nejbližší rovinná plocha komponenty kolmá na osu pružiny, obrácená k pružině (u A ve směru osy, u B proti ní).
 */
import { transformPoint, flattenAssembly, invertPlacement, type FlatComponent } from "./assembly";
import { faceShort, findComp, fold, pickFace, SPRING_USE, type AsmCmd, type CompFaceRow } from "./agent-asm";
import { springLostNote, springLostSides } from "./spring-lost";
import { compFaces, ensureBuilt, geoProvider, leafId, type AsmEnv, type AsmResult } from "./asm-agent";
import { springGeom, springWorldAxis } from "./asm-spring-geom";
import { isSpringExt } from "./springs";
import { applySpringStates, instanceLines, springComps, springDriftBetween, springLine, springLines, springSeatMates, springState, springStates, type SpringCheck } from "./asm-spring";
import { tr } from "./i18n";
import { ensureMateRefs } from "./mate-geo";
import type { AsmComponent, CadDoc, MateRef, SpringDef, Vec3 } from "./types";

const withoutSpring = (c: AsmComponent): AsmComponent => {
  const out = { ...c };
  delete out.spring;
  return out;
};
const dot = (a: Vec3, b: Vec3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const sub = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const cross = (a: Vec3, b: Vec3): Vec3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const unit = (v: Vec3): Vec3 => {
  const l = Math.hypot(v[0], v[1], v[2]) || 1;
  return [v[0] / l, v[1] / l, v[2] / l];
};

/** Doplní geometrii dosedacích ploch pružin (postaví díly, načte plochy) – potom jde délka spočítat z `geoProvider`. */
async function ensureSeatGeo(doc: CadDoc, env: AsmEnv): Promise<void> {
  const seats = springSeatMates(doc);
  if (!seats.length) return;
  const ids = new Set(seats.flatMap((m) => [m.a.leaf ?? m.a.compId, m.b.leaf ?? m.b.compId]));
  const flat = flattenAssembly(doc).filter((l) => ids.has(leafId(l)));
  await ensureBuilt(env, flat);
  const byLeaf = new Map(flat.map((l) => [leafId(l), l]));
  await ensureMateRefs(seats, (ref) => byLeaf.get(ref.leaf ?? ref.compId)?.key ?? null, env.geo, { face: env.mateFace, ent: env.mateEnt, cylFace: env.cylFace });
}

/**
 * Dosedací plochy pružin, které v dílu NEJSOU (vlna 22, bod 7 – kolo 6): dokument z vnější úpravy / jiné verze dílu (JSON, .mncad,
 * `--open`) nese číslo plochy, které postavený díl nemá (`face` ≥ počet ploch). Taková strana dostane `MateRef.lost` (why „none“) –
 * stejně jako po změně dílu v `sestava hotovo` (cad/spring-lost.ts): délka a síla se z ní nepočítají a strojové řádky nesou
 * `springs.lost=N`. Díl, který nejde postavit (počet ploch neznámý), se nemění – `stav` pak řekne „nezkontrolováno“.
 */
export async function markMissingSeats(doc: CadDoc, env: AsmEnv): Promise<{ doc: CadDoc; marked: string[] }> {
  if (doc.kind !== "assembly" || !springComps(doc).length) return { doc, marked: [] };
  const flat = flattenAssembly(doc);
  const byLeaf = new Map(flat.map((l) => [leafId(l), l]));
  const marked: string[] = [];
  const comps: AsmComponent[] = [];
  for (const c of doc.components ?? []) {
    const s = c.spring;
    if (!s) {
      comps.push(c);
      continue;
    }
    let next: SpringDef = s;
    for (const k of ["a", "b"] as const) {
      const ref = s[k];
      if (!ref || ref.lost || ref.ent) continue;
      const leaf = byLeaf.get(ref.leaf ?? ref.compId);
      if (!leaf) continue;
      const faces = (await ensureBuilt(env, [leaf])).get(leaf.key)?.metrics?.faces;
      if (typeof faces !== "number" || faces <= 0 || (ref.face >= 0 && ref.face < faces)) continue;
      next = { ...next, [k]: { ...ref, lost: { kind: "plane", origin: [0, 0, 0], normal: [0, 0, 0], why: "none" } } };
    }
    if (next !== s) marked.push(c.id);
    comps.push(next === s ? c : { ...c, spring: next });
  }
  return marked.length ? { doc: { ...doc, components: comps }, marked } : { doc, marked };
}

/** Délky pružin podle aktuálních poloh komponent (po přepočtu vazeb); beze změny vrací tentýž dokument. */
export async function refreshSprings(doc: CadDoc, env: AsmEnv): Promise<CadDoc> {
  if (doc.kind !== "assembly" || !springComps(doc).length) return doc;
  await ensureSeatGeo(doc, env);
  return applySpringStates(doc, springStates(doc, geoProvider(doc, env)));
}

/**
 * Kontrola pružin proti dosedacím plochám (vlna 22, bod 7): dokument s délkami z ploch, rozpory s uloženou délkou (`spring.stale`)
 * a zda šlo ověřit všechny pružiny (geometrie ploch k dispozici). Dokument `doc` se nemění.
 */
export async function springCheckOf(doc: CadDoc, env: AsmEnv): Promise<{ doc: CadDoc; check: SpringCheck } | null> {
  if (doc.kind !== "assembly" || !springComps(doc).length) return null;
  await ensureSeatGeo(doc, env);
  const states = springStates(doc, geoProvider(doc, env));
  const fixed = applySpringStates(doc, states);
  return { doc: fixed, check: { checked: states.length === springComps(doc).length, stale: springDriftBetween(doc, fixed) } };
}

/** Komponenty, kterých se příkaz týká: #k / přezdívka = jedna, název = všechny instance s tímto názvem (6 stejných pružin jedním řádkem). */
function targets(doc: CadDoc, ref: string): AsmComponent[] {
  const comps = doc.components ?? [];
  const same = comps.filter((c) => fold(c.name) === fold(ref.trim()));
  if (same.length > 1 && !/^#\d+$/.test(ref.trim()) && !comps.some((c) => c.alias && fold(c.alias) === fold(ref.trim()))) return same;
  return [findComp(doc, ref)];
}

/** Bod uvnitř trojúhelníku (3D, bod leží v rovině trojúhelníku – promítne se) s tolerancí `eps` v barycentrických souřadnicích. */
function inTri(p: Vec3, a: Vec3, b: Vec3, c: Vec3, eps = 1e-6): boolean {
  const v0 = sub(c, a);
  const v1 = sub(b, a);
  const v2 = sub(p, a);
  const d00 = dot(v0, v0);
  const d01 = dot(v0, v1);
  const d11 = dot(v1, v1);
  const den = d00 * d11 - d01 * d01;
  if (!(Math.abs(den) > 1e-18)) return false;
  const d02 = dot(v0, v2);
  const d12 = dot(v1, v2);
  const s = (d11 * d02 - d01 * d12) / den;
  const t = (d00 * d12 - d01 * d02) / den;
  return s >= -eps && t >= -eps && s + t <= 1 + eps;
}

/** Síť plochy dílu (souřadnice dílu): jemná síť z jádra (mateEnt), jinak trojúhelníky plochy ze sítě stavby dílu. */
async function faceTris(env: AsmEnv, leaf: FlatComponent, face: number): Promise<{ pts: Vec3[]; tris: number[] } | null> {
  const m = env.mateEnt ? await env.mateEnt(leaf.key, face, "mesh").catch(() => null) : null;
  if (m?.pts?.length && m.tris?.length) return { pts: m.pts, tris: m.tris };
  const mesh = (await ensureBuilt(env, [leaf])).get(leaf.key)?.mesh;
  if (!mesh) return null;
  const { vertices: v, triangles: t, faceGroups: g } = mesh;
  const pts: Vec3[] = [];
  const tris: number[] = [];
  for (let i = 0; i + 2 < g.length; i += 3) {
    if (g[i + 2] !== face) continue;
    for (let k = g[i]; k < Math.min(g[i] + g[i + 1], t.length); k++) {
      tris.push(pts.length);
      pts.push([v[t[k] * 3], v[t[k] * 3 + 1], v[t[k] * 3 + 2]]);
    }
  }
  return tris.length ? { pts, tris } : null;
}

/**
 * Kružnice dosednutí pružiny (poloměr `ring` kolem osy `u` se středem `center`, světové souřadnice) na ploše `face` listu `leaf`
 * (síť plochy z jádra): `cover` = podíl bodů kružnice na materiálu plochy, `around` = plocha obklopuje osu (bod osy leží v obálce
 * plochy) – cover 0 + around = osa prochází otvorem v ploše; cover 0 bez around = plocha je jinde (dno jiného zahloubení).
 * null = síť nejde načíst.
 */
async function seatCover(env: AsmEnv, leaf: FlatComponent, face: number, center: Vec3, u: Vec3, ring: number): Promise<{ cover: number; around: boolean } | null> {
  const m = await faceTris(env, leaf, face);
  if (!m) return null;
  const inv = invertPlacement(leaf.placement);
  const e1 = unit(cross(u, Math.abs(u[0]) < 0.9 ? [1, 0, 0] : [0, 1, 0]));
  const e2 = cross(u, e1);
  const N = 8;
  let hit = 0;
  const pts = m.pts;
  const t = m.tris;
  for (let k = 0; k < N; k++) {
    const a = (2 * Math.PI * k) / N;
    const w: Vec3 = [0, 1, 2].map((i) => center[i] + ring * (Math.cos(a) * e1[i] + Math.sin(a) * e2[i])) as Vec3;
    const p = transformPoint(inv, w);
    for (let i = 0; i + 2 < t.length; i += 3) {
      if (inTri(p, pts[t[i]], pts[t[i + 1]], pts[t[i + 2]])) {
        hit++;
        break;
      }
    }
  }
  // obálka plochy v souřadnicích dílu (rovinná plocha – tloušťka ~0) s tolerancí 1e-3 mm
  const c = transformPoint(inv, center);
  const lo = [Infinity, Infinity, Infinity];
  const hi = [-Infinity, -Infinity, -Infinity];
  for (const q of pts)
    for (let k = 0; k < 3; k++) {
      lo[k] = Math.min(lo[k], q[k]);
      hi[k] = Math.max(hi[k], q[k]);
    }
  return { cover: hit / N, around: [0, 1, 2].every((k) => c[k] >= lo[k] - 1e-3 && c[k] <= hi[k] + 1e-3) };
}

/**
 * Dosedací plocha bez zadání: rovinná plocha kolmá na osu, obrácená k pružině, nejblíž konci pružiny (`tWant` po ose od začátku),
 * která má pod kružnicí dosednutí pružiny materiál (alespoň polovina bodů) – plocha, kterou pružina prochází otvorem, se přeskočí
 * (959: pružiny procházejí otvory Ø20 kotevní desky a opírají se o opěrnou desku), stejně tak dno jiného zahloubení ve stejné
 * výšce (každá pružina dosedne na dno svého zahloubení). `holed` = nejbližší plocha, jejímž otvorem pružina prochází.
 */
async function autoSeat(env: AsmEnv, flat: FlatComponent[], rows: CompFaceRow[], P0: Vec3, u: Vec3, side: 1 | -1, tWant: number, ring: number): Promise<{ row: CompFaceRow | null; holed?: CompFaceRow }> {
  const cand: { r: CompFaceRow; t: number; d: number }[] = [];
  for (const r of rows) {
    if (r.kind !== "plane") continue;
    const den = dot(u, r.normal);
    if (Math.abs(den) < 0.999 || Math.sign(den) !== side) continue;
    const t = dot(sub(r.origin, P0), r.normal) / den;
    cand.push({ r, t, d: Math.abs(t - tWant) });
  }
  cand.sort((a, b) => (Math.abs(a.d - b.d) > 1e-9 ? a.d - b.d : (b.r.area ?? 0) - (a.r.area ?? 0)));
  let holed: CompFaceRow | undefined;
  for (const x of cand) {
    const leaf = flat.find((l) => leafId(l) === x.r.leafId);
    const sc = leaf ? await seatCover(env, leaf, x.r.face, [P0[0] + u[0] * x.t, P0[1] + u[1] * x.t, P0[2] + u[2] * x.t], u, ring) : null;
    if (sc === null || sc.cover >= 0.5) return { row: x.r, ...(holed ? { holed } : {}) };
    if (sc.around) holed ??= x.r;
  }
  return { row: null, ...(holed ? { holed } : {}) };
}

type SeatPick = { name: string; row: CompFaceRow; holed?: CompFaceRow };
/** „„A“ F9 rovinná +Z“ – u více instancí čísla ploch „F9/F32/F7 rovinná +Z“ (stejný popis), přeskočené otvory v závorce */
function seatSide(list: SeatPick[]): string {
  const fs = list.map((x) => faceShort(x.row));
  const tails = new Set(fs.map((f) => f.replace(/^\S+\s*/, "")));
  const nums = [...new Set(fs.map((f) => f.split(" ")[0]))];
  const faces = tails.size === 1 ? `${nums.join("/")} ${[...tails][0]}`.trim() : [...new Set(fs)].join(" / ");
  const holed = [...new Set(list.flatMap((x) => (x.holed ? [faceShort(x.holed)] : [])))];
  return `„${list[0].name}“ ${faces}${holed.length ? tr(" (přeskočena {0} – pružina jí prochází otvorem)", holed.join(" / ")) : ""}`;
}

/** Provede `sestava pružina …` / `sestava pružiny`. */
export async function applySpringCmd(d: CadDoc, cmd: Extract<AsmCmd, { k: "spring" | "springs" }>, env: AsmEnv): Promise<AsmResult> {
  const log: string[] = [];
  if (d.kind !== "assembly") throw new Error(tr("otevřený dokument „{0}“ není sestava – nejdřív „nová sestava“ nebo „záložka \"…\"“", d.name));
  if (cmd.k === "springs") {
    const doc = await refreshSprings(d, env);
    const st = springStates(doc, geoProvider(doc, env));
    if (!springComps(doc).length) log.push(tr("Pružiny: žádné – {0}", SPRING_USE()));
    else {
      log.push(tr("Pružiny ({0}):", springComps(doc).length));
      // stejné pružiny ve stejném stavu jednou „(6×)“, stejný název v různém stavu s #k / přezdívkou
      const items = springComps(doc).map((c) => {
        const s = st.find((x) => x.id === c.id);
        // ztracená dosedací plocha (po změně dílu): která, a příkaz opravy – ne obecné „chybí geometrie“ (spring-lost.ts)
        const lost = springLostSides(c.spring).length > 0;
        return { c, text: (ref: string) => (s ? ` ${springLine(s, ref, c.spring?.guided)}` : lost ? ` ${tr("⚠ pružina {0}", springLostNote(doc, c, ref))}` : ` ${tr("⚠ pružina „{0}“{1}: délku nešlo určit (chybí geometrie dosedací plochy)", c.name, ref)}`) };
      });
      log.push(...instanceLines(doc, items));
    }
    return { doc, log, changed: doc !== d };
  }
  const list = targets(d, cmd.comp);
  let doc = d;
  if (cmd.remove) {
    doc = { ...doc, components: (doc.components ?? []).map((c) => (list.some((x) => x.id === c.id) ? withoutSpring(c) : c)) };
    log.push(tr("✓ pružina odebrána: {0} (komponenta zůstává v sestavě, tvar ve volné délce)", list.map((c) => `„${c.name}“`).join(", ")));
    return { doc, log, changed: true };
  }
  const A = cmd.a !== undefined ? findComp(d, cmd.a) : null;
  const B = cmd.b !== undefined ? findComp(d, cmd.b) : null;
  if (A && B && A.id === B.id) throw new Error(tr("pružina: dosedací plochy musí být na dvou různých komponentách (A ≠ B)"));
  const rowsA = A ? (await compFaces(d, A.id, env)).rows : [];
  const rowsB = B ? (await compFaces(d, B.id, env)).rows : [];
  const ref = (c: AsmComponent, r: CompFaceRow): MateRef => ({ compId: c.id, ...(r.leafId !== c.id ? { leaf: r.leafId } : {}), face: r.face });
  const flat = flattenAssembly(d);
  const picks: { c: AsmComponent; a?: SeatPick; b?: SeatPick }[] = [];
  const noSeat = (c: AsmComponent, X: AsmComponent, holed?: CompFaceRow) =>
    new Error(
      holed
        ? tr("pružina „{0}“: osa pružiny prochází komponentou „{1}“ otvorem – plocha {2} nemá pod pružinou materiál, pružina na ní nedosedá; zadejte komponentu, o kterou se pružina opírá (např. další desku), nebo plochu F-číslem", c.name, X.name, faceShort(holed))
        : tr("pružina „{0}“: komponenta „{1}“ nemá rovinnou plochu kolmou na osu pružiny obrácenou k ní – zadejte plochu F-číslem (sestava plochy \"{1}\" rovinné)", c.name, X.name),
    );
  for (const c of list) {
    if (c.source.kind !== "part") throw new Error(tr("pružina: komponenta „{0}“ není díl (podsestava / import) – pružina potřebuje díl s prvkem Pružina", c.name));
    const g = springGeom(c.source.doc);
    if (!g && c.source.doc.features.some((x) => !x.suppressed && x.type === "ext" && isSpringExt(x.ext) && x.ext !== "spring.compression"))
      throw new Error(tr("komponenta „{0}“: pružinu mezi dosedacími plochami počítá sestava jen u tlačné pružiny (pružina tlačná …) – tažná, zkrutná a talířová pružina z tabulky zůstává dílem bez délky a síly v sestavě", c.name));
    if (!g) throw new Error(tr("komponenta „{0}“ není pružina – díl potřebuje prvek Pružina (normálie pružina d2 D20 L44 n8 · pružina D stoupání P závity N drát d) nebo trubku / válec po ose", c.name));
    if ((A && A.id === c.id) || (B && B.id === c.id)) throw new Error(tr("pružina: dosedací plocha nemůže být na samotné pružině „{0}“", c.name));
    const old = c.spring;
    if (!old && (!A || !B)) throw new Error(tr("pružina „{0}“: chybí dosedací komponenty – {1}", c.name, SPRING_USE()));
    const P0 = transformPoint(c.placement, g.base);
    const u = springWorldAxis(c, g);
    const L = old?.length ?? g.length;
    let a = old?.a;
    let b = old?.b;
    const pick: { c: AsmComponent; a?: SeatPick; b?: SeatPick } = { c };
    if (A) {
      const r = cmd.faceA ? { row: pickFace(cmd.faceA, rowsA, "plane", A.name, tr("dosedací plocha A: ")).row } : await autoSeat(env, flat, rowsA, P0, u, 1, 0, g.ring);
      if (!r.row) throw noSeat(c, A, r.holed);
      a = ref(A, r.row);
      pick.a = { name: A.name, row: r.row, ...(r.holed ? { holed: r.holed } : {}) };
    }
    if (B) {
      const r = cmd.faceB ? { row: pickFace(cmd.faceB, rowsB, "plane", B.name, tr("dosedací plocha B: ")).row } : await autoSeat(env, flat, rowsB, P0, u, -1, L, g.ring);
      if (!r.row) throw noSeat(c, B, r.holed);
      b = ref(B, r.row);
      pick.b = { name: B.name, row: r.row, ...(r.holed ? { holed: r.holed } : {}) };
    }
    const free = cmd.free ?? old?.free ?? g.free ?? g.length;
    // 0 = zrušit dřív zadanou hodnotu (délka na doraz z modelu, síla se nepočítá) – pole panelu „0 = z modelu / neuvádět“
    const solid = cmd.solid === 0 ? undefined : (cmd.solid ?? old?.solid);
    // tlačná pružina z tabulky: tuhost R z výpočtu (Ln dává model – solidOf)
    const rate = cmd.rate === 0 ? undefined : (cmd.rate ?? old?.rate ?? g.rate);
    if (solid !== undefined && solid >= free) throw new Error(tr("sestava pružina: délka na doraz {0} mm musí být menší než volná délka {1} mm", solid, free));
    // vedení dírou / kapsou (Pružina mezi díly) zůstává při změně dosedacích ploch, L0, Ln nebo tuhosti; `vedená ano|ne` ho nastaví
    const guided = cmd.guided ?? old?.guided;
    const def: SpringDef = { a: a!, b: b!, free, ...(solid !== undefined ? { solid } : {}), ...(rate !== undefined ? { rate } : {}), ...(guided !== undefined ? { guided } : {}) };
    doc = { ...doc, components: (doc.components ?? []).map((x) => (x.id === c.id ? { ...x, spring: def } : x)) };
    if (pick.a || pick.b) picks.push(pick);
  }
  await ensureSeatGeo(doc, env);
  const geo = geoProvider(doc, env);
  const states = [];
  for (const c0 of list) {
    const c = doc.components!.find((x) => x.id === c0.id)!;
    const s = springState(doc, c, geo);
    if (!s) throw new Error(tr("pružina „{0}“: délku nešlo určit – dosedací plocha je rovnoběžná s osou pružiny nebo se díl nepostavil", c.name));
    states.push(s);
  }
  // obrácené / splývající dosedací plochy: definice se neuloží (jinak by stav hlásil pružinu 0,001 mm a tvar by se postavil
  // na dorazu na druhé straně desky) – ✗ s radou prohodit A a B
  const rev = states.find((s) => !(s.seat > 1e-6));
  if (rev) throw new Error(`${tr("pružina „{0}“", rev.name)}: ${rev.note ?? ""}${tr(" – definice se neuložila")}`);
  doc = applySpringStates(doc, states);
  // dosedací plochy: jedna pružina řádkem (s #k / přezdívkou, je-li název víckrát), stejně pojmenované instance jedním řádkem „(6×)“
  // s čísly ploch „F9/F32/…“ (každá pružina na dně svého zahloubení)
  const what = (list: typeof picks) => [list.every((x) => x.a) ? seatSide(list.map((x) => x.a!)) : "", list.every((x) => x.b) ? seatSide(list.map((x) => x.b!)) : ""].filter(Boolean).join(" → ");
  const seatLog = picks.length > 1 ? [tr("  dosedací plochy pružiny „{0}“{1}: {2}", picks[0].c.name, ` (${picks.length}×)`, what(picks))] : instanceLines(doc, picks.map((x) => ({ c: x.c, text: (r: string) => tr("  dosedací plochy pružiny „{0}“{1}: {2}", x.c.name, r, what([x])) })));
  log.push(...seatLog, ...springLines(doc, states));
  return { doc, log, changed: true };
}
