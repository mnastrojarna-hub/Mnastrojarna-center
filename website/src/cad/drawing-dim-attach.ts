/**
 * Ruční kóty po změně modelu (vlna 22, bod 20 – výkres; kolo 3 fáze 2): kóta, kterou zadal uživatel (ne Chytré kóty), se
 * váže na geometrii pohledu (hrana, kružnice, úhel dvou hran, dva body přichycené k vrcholům). Po změně modelu:
 * - geometrie zmizela / nejde určit jednoznačně (`lost`) – kóta se kreslí podle uložených bodů a „visí“ mimo díl;
 * - kóta se přichytila ke změněné geometrii (`moved` – zkrácená hrana, jiný průměr v tomtéž středu): na listu je jiná
 *   hodnota, než uživatel zadal;
 * - pohled kóty na listu není (`noView`) – kóta se nekreslí.
 * Dřív to vidělo jen okno výkresu (oranžová značka u ztracené kóty); `výkres stav` psal uloženou hodnotu („60 *“ na dílu
 * délky 30) a vyhodnocení listu hlásilo „✓ bez nálezů“. Teď ⚠ `drawing.dim-detached` s id kóty, hodnotou a radou –
 * ve `výkres stav`, při vyhodnocení listu (konec bloku / běhu) i při exportu. Potvrzení přichycené kóty: `výkres upravit aN …`
 * (uloží nynější geometrii), jinak `výkres smazat aN`.
 */
import { resolveDim, pickViewEnt, type DimAnn, type DrawingOptions, type PlacedView } from "./drawing";
import type { DrawingIssue } from "./drawing-issues";
import { annViewName, dimValue, shortId } from "./drawing-marks";
import { dimLabel } from "./drawing";
import { tr } from "./i18n";
import type { DrawingAnnotation, Vec2 } from "./types";

export type DimAttachState = "lost" | "moved" | "noView";
export type DimAttach = {
  /** index poznámky v seznamu listu (id `a<n+1>`) */
  index: number;
  ann: DimAnn;
  state: DimAttachState;
  /** hodnota, kterou kóta měla (uložené body) a kterou má teď na listu (přichycená geometrie) */
  was: number;
  now: number;
};

/** tolerance shody bodů [mm modelu] – jako dohledání kót v cad/drawing.ts */
const TOL = 0.01;
const near = (a: Vec2, b: Vec2) => Math.hypot(a[0] - b[0], a[1] - b[1]) <= TOL;

/** bod kóty dvou bodů leží na vrcholu pohledu (konec hrany, střed kružnice) */
function onVertex(v: PlacedView, p: Vec2): boolean {
  const pk = pickViewEnt(v.ents ?? [], p, TOL, "point");
  return !!pk && pk.kind === "point" && near(pk.p, p);
}

/** změnila se poloha kóty po dohledání geometrie (jiný průměr, jiné konce hrany) */
function moved(a: DimAnn, b: DimAnn): boolean {
  if (a === b) return false;
  if ("r" in a && "r" in b) return Math.abs(a.r - b.r) > TOL || !near(a.c, b.c);
  if (a.kind === "angle" && b.kind === "angle") return !near(a.a, b.a) || !near(a.b, b.b) || !near(a.a2, b.a2) || !near(a.b2, b.b2);
  if ("a" in a && "a" in b) return !near(a.a, b.a) || !near(a.b, b.b);
  return false;
}

/**
 * Ruční kóty listu, které po změně modelu neodpovídají geometrii (Chytré kóty se přegenerují samy, kóty listu „sheet“
 * nemají geometrii). `anns` = poznámky listu v pořadí `výkres stav` (id a1, a2…).
 */
export function userDimAttach(views: PlacedView[], anns: readonly DrawingAnnotation[]): DimAttach[] {
  const out: DimAttach[] = [];
  anns.forEach((a, index) => {
    if (a.type !== "dim" || a.auto || a.view === "sheet") return;
    const rs = resolveDim(views, a);
    const was = dimValue(views, a);
    if (rs.status === "noView") return void out.push({ index, ann: a, state: "noView", was, now: was });
    if (rs.status === "lost") return void out.push({ index, ann: a, state: "lost", was, now: was });
    const v = views.find((x) => x.key === a.view);
    // kóta dvou bodů přichycených k vrcholům (`geo`): oba body musí být pořád vrcholy pohledu
    if (v?.ents && "geo" in a && a.geo && "a" in a && (!onVertex(v, a.a) || !onVertex(v, a.b))) return void out.push({ index, ann: a, state: "lost", was, now: was });
    if (moved(a, rs.a)) out.push({ index, ann: a, state: "moved", was, now: dimValue(views, rs.a) });
  });
  return out;
}

/** kóta s uloženou geometrií, kterou kóta teď na listu má (potvrzení přichycené kóty – `výkres upravit aN …`) */
export function settleDim(views: PlacedView[], a: DimAnn): DimAnn {
  const rs = resolveDim(views, a);
  return rs.status === "ok" ? rs.a : a;
}

/** popisek kóty pro výpis: hodnota na listu, u přichycené i zadaná hodnota */
export function attachLabel(x: DimAttach): string {
  const now = dimLabel(x.ann, x.now);
  return x.state === "moved" ? tr("{0} (zadáno {1})", now, dimLabel(x.ann, x.was)) : now;
}

/** text jedné kóty do hlášení: „a4 60 (přední) – hrana ani body už v pohledu nejsou“ */
function itemText(x: DimAttach, o?: Partial<DrawingOptions>): string {
  const head = `${shortId(x.index)} ${dimLabel(x.ann, x.was)} (${annViewName(x.ann.view, o)})`;
  if (x.state === "noView") return tr("{0} – pohled kóty na listu není, kóta se nekreslí", head);
  if (x.state === "lost") return tr("{0} – geometrie, ke které se kóta váže, v pohledu není; kóta se kreslí podle uložených bodů", head);
  return tr("{0} – přichycena ke změněné geometrii, na listu teď {1}", head, dimLabel(x.ann, x.now));
}

/** text hlášení ⚠ drawing.dim-detached (null = všechny ruční kóty odpovídají geometrii) */
export function dimAttachText(list: readonly DimAttach[], o?: Partial<DrawingOptions>): string | null {
  if (!list.length) return null;
  const items = list.slice(0, 6).map((x) => itemText(x, o)).join("; ") + (list.length > 6 ? tr("; a dalších {0}", list.length - 6) : "");
  const mv = list.find((x) => x.state === "moved");
  const gone = list.find((x) => x.state !== "moved");
  const fix = [mv ? tr("přichycenou kótu zkontrolujte a potvrďte (výkres upravit {0} odsazení=…)", shortId(mv.index)) : "", gone ? tr("kótu bez geometrie vložte znovu nebo smažte (výkres smazat {0})", shortId(gone.index)) : ""].filter(Boolean).join("; ");
  return tr("ruční kóty po změně modelu neodpovídají geometrii ({0}): {1} – {2}", list.length, items, fix);
}

/** hlášení listu ⚠ drawing.dim-detached (vyhodnocení listu, `výkres stav`, export) */
export function dimAttachIssue(views: PlacedView[], anns: readonly DrawingAnnotation[], o?: Partial<DrawingOptions>, sheetId?: string): DrawingIssue | null {
  const list = userDimAttach(views, anns);
  const text = dimAttachText(list, o);
  if (!text) return null;
  return { level: "warn", code: "drawing.dim-detached", kind: "dim-detached", text, ...(sheetId ? { sheetId } : {}), data: { dims: list.map((x) => ({ id: shortId(x.index), state: x.state, was: x.was, now: x.now })) } };
}
