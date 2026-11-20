/**
 * Pružina v sestavě – stav (čisté funkce bez jádra): délka z dosedacích ploch, síla, kontrola délky na doraz, protokol.
 *
 * Délka L = vzdálenost dosedací plochy A (začátek pružiny) a B (konec) měřená po ose pružiny: rovinná plocha se protne osou,
 * jiná plocha / hrana / vrchol se na osu promítne. Začátek pružiny se posune na plochu A (`offset`). Nad volnou délkou L0 pružina
 * nedosedá – tvar zůstane volný (L = L0) a protokol hlásí mezeru ⚠; pod délkou na doraz Ln je to ✗ (tvar zůstane na dorazu).
 * Síla F = c · (L0 − L), když je zadaná tuhost c [N/mm]. Geometrie dosedacích ploch je v souřadnicích komponenty nejvyšší
 * úrovně (GeoProvider jako u vazeb), polohy komponent z dokumentu (u pohybové studie z kroku).
 */
import { instanceRef, transformPoint } from "./assembly";
import { springMotionCheck } from "./asm-spring-check";
import { springGeom, springPosRound, springRound, springShapeLen, springWorldAxis } from "./asm-spring-geom";
import { getLang, tr } from "./i18n";
import { worldGeo, type GeoProvider } from "./mates";
import type { AsmComponent, CadDoc, Mate, Vec3 } from "./types";

export type SpringLevel = "ok" | "warn" | "error";
/** Stav jedné pružiny: `seat` = vzdálenost dosedacích ploch, `length` = délka tvaru (≤ L0), `offset` = posun začátku na plochu A. */
export type SpringState = {
  id: string;
  name: string;
  seat: number;
  length: number;
  offset: number;
  free: number;
  solid?: number;
  rate?: number;
  /** N (jen se zadanou tuhostí) */
  force?: number;
  level: SpringLevel;
  /** důvod ⚠ / ✗ (do protokolu) */
  note?: string;
};
/** stav pružiny v kroku pohybové studie (MotionStep.springs) */
export type SpringStep = { length: number; offset: number; seat: number; force?: number; level: SpringLevel };

const fmt = (n: number, d = 2): string => {
  if (!Number.isFinite(n)) return "–";
  const s = String(Math.round(n * 10 ** d) / 10 ** d || 0);
  return getLang() === "en" ? s : s.replace(".", ",");
};
const dot = (a: Vec3, b: Vec3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const sub = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];

/** Komponenty s definovanou pružinou (obě dosedací komponenty v sestavě – odebraná dosedací komponenta pružinu vypne). */
export const springComps = (doc: CadDoc): AsmComponent[] => {
  const comps = doc.components ?? [];
  const ids = new Set(comps.map((c) => c.id));
  return comps.filter((c) => !!c.spring && c.source.kind === "part" && ids.has(c.spring.a.compId) && ids.has(c.spring.b.compId));
};

/**
 * Řádky pro pružiny, kde `text(ref)` vloží za název odkaz na instance: stejný název ve stejném stavu = jeden řádek „(6×)“ bez
 * odkazu; stejný název v různých stavech (nebo jen některé instance s tímto názvem) = řádek pro každý stav s odkazy „ #35, #36“
 * / „ [K3]“ – stejně pojmenované pružiny v různém stavu se v protokolu nesmí splést.
 */
export function instanceLines(doc: CadDoc, items: { c: AsmComponent; text: (ref: string) => string }[]): string[] {
  const byName = new Map<string, typeof items>();
  for (const it of items) byName.set(it.c.name, [...(byName.get(it.c.name) ?? []), it]);
  const out: string[] = [];
  const times = (line: string, n: number) => (n > 1 ? `${line} (${n}×)` : line);
  for (const [name, list] of byName) {
    const groups = new Map<string, typeof items>();
    for (const it of list) groups.set(it.text(""), [...(groups.get(it.text("")) ?? []), it]);
    const total = (doc.components ?? []).filter((x) => x.name === name).length;
    if (groups.size === 1 && list.length === total) {
      out.push(times([...groups.keys()][0], list.length));
      continue;
    }
    for (const g of groups.values()) out.push(times(g[0].text(` ${g.map((it) => instanceRef(doc, it.c)).join(", ")}`), g.length));
  }
  return out;
}

/** Pomocné „vazby“ s dosedacími plochami – jen pro doplnění geometrie ploch (ensureMateRefs), do dokumentu se neukládají. */
export function springSeatMates(doc: CadDoc): Mate[] {
  return springComps(doc).map((c) => ({ id: `spring:${c.id}`, type: "flush", a: { ...c.spring!.a }, b: { ...c.spring!.b } }) as Mate);
}

/** Délka na doraz: zadaná, jinak z modelu (prvek Pružina: (závity + 1) · drát). */
export const solidOf = (c: AsmComponent): number | undefined => c.spring?.solid ?? (c.source.kind === "part" ? springGeom(c.source.doc)?.solid : undefined);

/** Úroveň a poznámka z délky (bez geometrie – i pro uloženou délku ve stavu dokumentu). */
export function springVerdict(seat: number, free: number, solid?: number): { level: SpringLevel; note?: string } {
  if (!(seat > 1e-6)) return { level: "error", note: tr("dosedací plochy jsou v obráceném pořadí nebo splývají (vzdálenost {0} mm) – prohoďte A a B", fmt(seat, 3)) };
  if (solid !== undefined && seat < solid - 1e-6) return { level: "error", note: tr("stlačena pod délku na doraz Ln {0} mm (vzdálenost ploch {1} mm, chybí {2} mm)", fmt(solid, 3), fmt(seat, 3), fmt(solid - seat, 3)) };
  if (seat > free + 1e-6) return { level: "warn", note: tr("nedosedá – vzdálenost ploch {0} mm je větší než volná délka L0 {1} mm (mezera {2} mm)", fmt(seat, 3), fmt(free, 3), fmt(seat - free, 3)) };
  return { level: "ok" };
}

/**
 * Stav pružiny komponenty `c` v sestavě `doc` (polohy komponent z dokumentu). null = komponenta nemá pružinu nebo chybí geometrie
 * dosedací plochy (díl se ještě staví) – pak zůstává uložená délka.
 */
export function springState(doc: CadDoc, c: AsmComponent, geo: GeoProvider): SpringState | null {
  const s = c.spring;
  if (!s || c.source.kind !== "part") return null;
  const g = springGeom(c.source.doc);
  if (!g) return null;
  const comps = doc.components ?? [];
  const placeOf = (id: string) => comps.find((x) => x.id === id)?.placement;
  const P0 = transformPoint(c.placement, g.base);
  const u = springWorldAxis(c, g);
  const tOf = (ref: SpringDefRef): number | null => {
    const pl = placeOf(ref.compId);
    const loc = geo(ref);
    if (!pl || !loc) return null;
    const w = worldGeo(pl, loc);
    if (w.kind === "plane") {
      const den = dot(u, w.normal);
      if (Math.abs(den) < 0.05) return null; // rovina rovnoběžná s osou – nelze dosednout
      return dot(sub(w.origin, P0), w.normal) / den;
    }
    return dot(sub(w.origin, P0), u);
  };
  const tA = tOf(s.a);
  const tB = tOf(s.b);
  if (tA === null || tB === null) return null;
  const seat = springRound(tB - tA);
  const solid = solidOf(c);
  const v = springVerdict(seat, s.free, solid);
  // tvar: nad L0 zůstane volný (mezera), pod dorazem se tvar sám omezí (asm-spring-geom springDocAt); délka tvaru z nezaokrouhlené
  // vzdálenosti ploch zaokrouhlená dolů a začátek přesně na ploše A (springShapeLen / springPosRound) – pružina dosedá bez průniku
  const length = springShapeLen(Math.max(1e-3, Math.min(tB - tA, s.free)));
  const force = s.rate !== undefined ? s.rate * (s.free - length) : undefined;
  return { id: c.id, name: c.name, seat, length, offset: springPosRound(tA), free: s.free, ...(solid !== undefined ? { solid } : {}), ...(s.rate !== undefined ? { rate: s.rate } : {}), ...(force !== undefined ? { force } : {}), level: v.level, ...(v.note ? { note: v.note } : {}) };
}
type SpringDefRef = NonNullable<AsmComponent["spring"]>["a"];

/** Stavy všech pružin sestavy (bez těch, kde chybí geometrie). */
export function springStates(doc: CadDoc, geo: GeoProvider): SpringState[] {
  return springComps(doc)
    .map((c) => springState(doc, c, geo))
    .filter((x): x is SpringState => !!x);
}

/** Sestava s délkou a posunem pružin ze stavů (stejný dokument, když se nic nezměnilo). */
export function applySpringStates(doc: CadDoc, states: Pick<SpringState, "id" | "length" | "offset" | "seat">[]): CadDoc {
  if (!states.length) return doc;
  const by = new Map(states.map((s) => [s.id, s]));
  let changed = false;
  const components = (doc.components ?? []).map((c) => {
    const s = by.get(c.id);
    if (!s || !c.spring) return c;
    if (c.spring.length === s.length && (c.spring.offset ?? 0) === s.offset && c.spring.seat === s.seat) return c;
    changed = true;
    return { ...c, spring: { ...c.spring, length: s.length, offset: s.offset, seat: s.seat } };
  });
  return changed ? { ...doc, components } : doc;
}

/** Sestava s délkami pružin podle poloh komponent v dokumentu (po přepočtu vazeb v aplikaci). */
export const withSprings = (doc: CadDoc, geo: GeoProvider): CadDoc => (springComps(doc).length ? applySpringStates(doc, springStates(doc, geo)) : doc);

/**
 * Rozpor uložené (odvozené) délky pružiny s dosedacími plochami (vlna 22, bod 7): ŘÍDÍ polohy komponent a plochy, `length` /
 * `offset` / `seat` jsou jen mezipaměť posledního přepočtu. `stored` = uložená délka, `derived` = délka z ploch v nynějších
 * polohách; nad 0,01 mm (délka nebo poloha začátku) je to rozpor – po načtení dokumentu se ohlásí ⚠ `spring.stale` a délka se
 * odvodí znovu. Pružina bez uložené délky (ještě nepřepočtená) rozpor nemá.
 */
export type SpringDrift = { id: string; name: string; stored: number; derived: number; seat: number; offset: number };
export const SPRING_DRIFT_EPS = 0.01;
/** Rozpor mezi dokumentem `before` a týmž dokumentem s délkami pružin z ploch `after` (applySpringStates / refreshSprings). */
export function springDriftBetween(before: CadDoc, after: CadDoc): SpringDrift[] {
  const out: SpringDrift[] = [];
  const by = new Map((after.components ?? []).map((c) => [c.id, c] as const));
  for (const c of springComps(before)) {
    const s = c.spring!;
    const a = by.get(c.id)?.spring;
    if (!a || s.length === undefined || a.length === undefined) continue;
    const dl = Math.abs(s.length - a.length);
    const doff = Math.abs((s.offset ?? 0) - (a.offset ?? 0));
    if (dl > SPRING_DRIFT_EPS || doff > SPRING_DRIFT_EPS) out.push({ id: c.id, name: c.name, stored: s.length, derived: a.length, seat: a.seat ?? a.length, offset: (a.offset ?? 0) - (s.offset ?? 0) });
  }
  return out;
}
/** Rozpor uložené délky pružin s dosedacími plochami v polohách dokumentu (čistá funkce – geometrie ploch od volajícího). */
export const springDrift = (doc: CadDoc, geo: GeoProvider): SpringDrift[] => springDriftBetween(doc, withSprings(doc, geo));
/** Věta hlášení ⚠ spring.stale (stejná v protokolu, konzoli i v aplikaci). */
export function springDriftText(d: SpringDrift): string {
  if (Math.abs(d.stored - d.derived) <= SPRING_DRIFT_EPS)
    return tr("pružina „{0}“: uložená poloha začátku neodpovídá dosedací ploše (posun {1} mm, délka {2} mm) – odvozeno z ploch", d.name, fmt(d.offset, 3), fmt(d.derived, 3));
  return tr("pružina „{0}“: uložená délka {1} mm neodpovídá dosedacím plochám ({2} mm) – délka odvozena z ploch; řídí polohy komponent, uložená délka je jen odvozená hodnota", d.name, fmt(d.stored, 3), fmt(d.derived, 3));
}
/** argumenty krátkého textu kódu `spring.stale` (registr kódů) */
export const springDriftArgs = (d: SpringDrift): string[] => [d.name, `${fmt(d.stored, 3)} mm`, `${fmt(d.derived, 3)} mm`];

/** Stav kroku pohybové studie (MotionStep.springs). */
export function springSteps(doc: CadDoc, geo: GeoProvider): Record<string, SpringStep> {
  const out: Record<string, SpringStep> = {};
  for (const s of springStates(doc, geo)) out[s.id] = { length: s.length, offset: s.offset, seat: s.seat, ...(s.force !== undefined ? { force: s.force } : {}), level: s.level };
  return out;
}

const mark = (l: SpringLevel) => (l === "error" ? "✗" : l === "warn" ? "⚠" : "✓");

/**
 * Řádek protokolu pružiny: „✓ pružina „P1“: délka 38 mm (L0 44 · Ln 20 · zdvih 6 mm) · síla 150 N (c 25 N/mm) · vedená“;
 * `ref` = „ #3“ za název, `guided` = vedení dírou / kapsou z definice (`sestava pružina … vedená ano|ne`; nezadané se nepíše).
 */
export function springLine(s: SpringState, ref = "", guided?: boolean): string {
  const parts = [tr("délka {0} mm", fmt(s.length, 3)), `L0 ${fmt(s.free, 3)}`];
  if (s.solid !== undefined) parts.push(`Ln ${fmt(s.solid, 3)}`);
  parts.push(tr("stlačení {0} mm", fmt(s.free - s.length, 3)));
  const force = s.force !== undefined ? ` · ${tr("síla {0} N (c {1} N/mm)", fmt(s.force, 1), fmt(s.rate!, 3))}` : "";
  const guide = guided === undefined ? "" : ` · ${guided ? tr("vedená") : tr("nevedená")}`;
  return `${mark(s.level)} ${tr("pružina „{0}“", s.name)}${ref}: ${parts.join(" · ")}${force}${guide}${s.note ? ` – ${s.note}` : ""}`;
}

/** Řádky protokolu pro stavy pružin (stejný název a stav jednou s „(6×)“, jinak s #k / přezdívkou); `indent` před řádkem. */
export function springLines(doc: CadDoc, states: SpringState[], indent = ""): string[] {
  const items = states.flatMap((s) => {
    const c = (doc.components ?? []).find((x) => x.id === s.id);
    return c ? [{ c, text: (ref: string) => `${indent}${springLine(s, ref, c.spring?.guided)}` }] : [];
  });
  return instanceLines(doc, items);
}

/**
 * Kontrola pružin pro `stav` (vlna 22, bod 7): `checked` = délka každé pružiny ověřena proti dosedacím plochám v nynějších polohách,
 * `stale` = pružiny, jejichž uložená délka plochám neodpovídá (ty se vypíšou ⚠ s délkou z ploch).
 */
export type SpringCheck = { checked: boolean; stale: SpringDrift[] };

/**
 * Řádky stavu dokumentu: „Pružiny: „P1“ 38 mm (L0 44) · F 150 N ✓ · …“. Bez `check` jen z uložené délky (dosavadní tvar); s kontrolou
 * proti plochám dovětek „délka z dosedacích ploch“ (řídí polohy komponent), rozpor ⚠ s odvozenou délkou, a když kontrola neproběhla
 * (chybí geometrie), bez ✓ s dovětkem „uložená délka, nezkontrolováno“.
 */
export function springStatusLine(doc: CadDoc, check?: SpringCheck): string | null {
  const base = springStatusLine0(doc);
  if (!base || !check) return base;
  if (check.stale.length) return `${base} – ⚠ ${check.stale.map(springDriftText).join("; ")}`;
  if (!check.checked) return `${base.replace(/ ✓/g, "")} – ${tr("uložená délka, s dosedacími plochami nezkontrolováno")}`;
  return `${base} – ${tr("délka odvozená z dosedacích ploch (řídí polohy komponent)")}`;
}

/** dosavadní řádek z uložené délky (bez geometrie) */
function springStatusLine0(doc: CadDoc): string | null {
  const list = springComps(doc);
  if (!list.length) return null;
  const items = list.map((c) => ({
    c,
    text: (ref: string) => {
      const s = c.spring!;
      if (s.length === undefined) return tr("„{0}“{1} – délka zatím nespočtena (sestava pružina / přepočet vazeb)", c.name, ref);
      const solid = solidOf(c);
      const v = springVerdict(s.seat ?? s.length, s.free, solid);
      const f = s.rate !== undefined ? ` · F ${fmt(s.rate * (s.free - s.length), 1)} N` : "";
      return `„${c.name}“${ref} ${fmt(s.length, 3)} mm (L0 ${fmt(s.free, 3)}${solid !== undefined ? ` · Ln ${fmt(solid, 3)}` : ""})${f} ${mark(v.level)}`;
    },
  }));
  // stejné pružiny ve stejném stavu (např. 6 pružin stírače) jednou s počtem „(6×)“, různé stavy s #k / přezdívkou
  return tr("Pružiny: {0}", instanceLines(doc, items).join(" · "));
}

/**
 * Souhrn pružin v pohybové studii: rozsah délky a síly, kroky pod délkou na doraz (✗) a bez dosednutí (⚠).
 * `steps` = MotionStep[] (jen pole `springs`), `t` = časy kroků.
 */
export function springMotionLines(doc: CadDoc, steps: { i: number; t: number; springs?: Record<string, SpringStep> }[]): string[] {
  const items: { c: AsmComponent; text: (ref: string) => string }[] = [];
  for (const c of springComps(doc)) {
    const rows = steps.map((s) => ({ i: s.i, st: s.springs?.[c.id] })).filter((r): r is { i: number; st: SpringStep } => !!r.st);
    if (!rows.length) {
      items.push({ c, text: (ref) => tr("⚠ pružina „{0}“{1}: délku nešlo určit (chybí geometrie dosedací plochy)", c.name, ref) });
      continue;
    }
    const L = rows.map((r) => r.st.length);
    const seat = rows.map((r) => r.st.seat);
    const bad = rows.filter((r) => r.st.level === "error");
    const loose = rows.filter((r) => r.st.level === "warn");
    const solid = solidOf(c);
    const fr = rows.filter((r) => r.st.force !== undefined).map((r) => r.st.force!);
    const range = (a: number[], d = 3) => (Math.abs(a[0] - a[a.length - 1]) < 1e-9 ? fmt(a[0], d) : `${fmt(a[0], d)} → ${fmt(a[a.length - 1], d)}`);
    const span = (list: typeof rows) => (!list.length ? "" : list[0].i === list[list.length - 1].i ? `${list[0].i}` : `${list[0].i}–${list[list.length - 1].i}`);
    let body = `: ${tr("délka {0} mm", range(L))} (min ${fmt(Math.min(...L), 3)} · L0 ${fmt(c.spring!.free, 3)}${solid !== undefined ? ` · Ln ${fmt(solid, 3)}` : ""})`;
    if (fr.length) body += ` · ${tr("síla {0} N (max {1} N)", range(fr, 1), fmt(Math.max(...fr), 1))}`;
    const head = (ref: string) => `${tr("pružina „{0}“", c.name)}${ref}`;
    // pevnost, nejmenší mezery a vzpěr při nejkratší dosažené délce (EN 13906-1, cad/asm-spring-check.ts)
    const chk = springMotionCheck(c, Math.min(...L))?.issues.map((x) => x.text) ?? [];
    const more = chk.length ? `; ${chk.join("; ")}` : "";
    if (bad.length) items.push({ c, text: (ref) => `✗ ${head(ref)}${body} – ${tr("pod délkou na doraz v krocích {0} (vzdálenost ploch min {1} mm)", span(bad), fmt(Math.min(...seat), 3))}${more}` });
    else if (loose.length) items.push({ c, text: (ref) => `⚠ ${head(ref)}${body} – ${tr("nedosedá v krocích {0} (mezera max {1} mm)", span(loose), fmt(Math.max(...seat) - c.spring!.free, 3))}${more}` });
    else if (chk.length) items.push({ c, text: (ref) => `⚠ ${head(ref)}${body} – ${chk.join("; ")}` });
    else items.push({ c, text: (ref) => `✓ ${head(ref)}${body}` });
  }
  // stejné pružiny ve stejném průběhu jednou „(6×)“; stejný název v různém průběhu s #k / přezdívkou
  return instanceLines(doc, items);
}
