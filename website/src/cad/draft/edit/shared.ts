/**
 * BALÍK 1 (edit) – společné pomůcky upravovacích příkazů: klíčová slova voleb (cs / en / de), výběr objektů
 * s PICKFIRST, zamčené hladiny, převzetí vlastností zdroje, transformace výběru (posun, otočení, měřítko, zrcadlení),
 * kroky „Zpět“ uvnitř příkazu a stav kláves Shift z GUI.
 */
import { tr } from "../../i18n";
import { kw, kwLabel, matchKw, type CmdCtx, type Input, type Kw, type Prompt } from "../commands";
import type { Affine } from "../geom";
import { kindLabel, kindOf, type KindCtx } from "../kinds";
import { findLayer } from "../layers";
import { entityById, spaceEntities, withSpaceEntities, type DraftEntity, type NewEntity } from "../model";
import { setSelection, type DraftSession } from "../session";

/** klíčová slova voleb upravovacích příkazů */
export const EK = {
  yes: kw("yes", "Ano", "Yes", "Ja"),
  no: kw("no", "Ne", "No", "Nein"),
  copy: kw("copy", "Kopie", "Copy", "Kopieren"),
  reference: kw("reference", "Reference", "Reference", "Bezug"),
  points: kw("points", "Body", "Points", "Punkte"),
  displacement: kw("displacement", "Posunutí", "Displacement", "Verschiebung"),
  mode: kw("mode", "Režim", "Mode", "Modus", ["o"]),
  single: kw("single", "Jednou", "Single", "Einzeln"),
  multiple: kw("multiple", "Vícekrát", "Multiple", "Mehrfach", ["m"]),
  array: kw("array", "Pole", "Array", "Reihe"),
  fit: kw("fit", "Přizpůsobit", "Fit", "Einpassen"),
  fitCurve: kw("fit", "Proložit", "Fit", "Kurve"),
  exit: kw("exit", "Konec", "Exit", "Beenden"),
  undo: kw("undo", "Zpět", "Undo", "Zurück"),
  through: kw("through", "Bodem", "Through", "Durch"),
  erase: kw("erase", "Smazat", "Erase", "Löschen", ["r"]),
  layer: kw("layer", "Hladina", "Layer", "Layer"),
  source: kw("source", "Zdroj", "Source", "Quelle"),
  current: kw("current", "Aktuální", "Current", "Aktuell"),
  fence: kw("fence", "Plot", "Fence", "Zaun"),
  crossing: kw("crossing", "Křížení", "Crossing", "Kreuzen"),
  edge: kw("edge", "Hrana", "Edge", "Kante", ["e"]),
  extend: kw("extend", "Prodloužit", "Extend", "Dehnen"),
  noextend: kw("noextend", "Neprodlužovat", "No-extend", "Nicht-dehnen"),
  quick: kw("quick", "Rychlý", "Quick", "Schnell"),
  standard: kw("standard", "Standardní", "Standard", "Standard"),
  trim: kw("trim", "Oříznout", "Trim", "Stutzen"),
  notrim: kw("notrim", "Neoříznout", "No-trim", "Nicht-stutzen"),
  radius: kw("radius", "Poloměr", "Radius", "Radius"),
  polyline: kw("polyline", "Křivka", "Polyline", "Polylinie"),
  distance: kw("distance", "Vzdálenost", "Distance", "Abstand"),
  angle: kw("angle", "Úhel", "Angle", "Winkel"),
  method: kw("method", "Metoda", "Method", "Methode", ["e"]),
  first: kw("first", "První", "First", "Erster"),
  delta: kw("delta", "Delta", "Delta", "Delta"),
  percent: kw("percent", "Procenta", "Percent", "Prozent"),
  total: kw("total", "Celkem", "Total", "Gesamt"),
  dynamic: kw("dynamic", "Dynamicky", "Dynamic", "Dynamisch"),
  close: kw("close", "Uzavřít", "Close", "Schließen"),
  open: kw("open", "Otevřít", "Open", "Öffnen"),
  join: kw("join", "Spojit", "Join", "Verbinden"),
  width: kw("width", "Šířka", "Width", "Breite"),
  spline: kw("spline", "Spline", "Spline", "Spline"),
  decurve: kw("decurve", "Vyrovnat", "Decurve", "Kurve-löschen"),
  reverse: kw("reverse", "Obrátit", "Reverse", "Umkehren"),
  insertv: kw("insertvertex", "Vložit-vrchol", "Insert-vertex", "Scheitel-einfügen"),
  removev: kw("removevertex", "Odebrat-vrchol", "Remove-vertex", "Scheitel-entfernen"),
  movev: kw("movevertex", "Posunout-bod", "Move-point", "Punkt-schieben"),
  refine: kw("refine", "Zjemnit", "Refine", "Verfeinern"),
  elevate: kw("elevate", "Zvýšit-stupeň", "Elevate-order", "Ordnung-erhöhen"),
  rect: kw("rectangular", "Obdélníkové", "Rectangular", "Rechteckig"),
  polar: kw("polar", "Polární", "Polar", "Polar"),
  path: kw("path", "Dráha", "Path", "Pfad"),
  divide: kw("divide", "Rozdělit", "Divide", "Teilen"),
  measure: kw("measure", "Měřit", "Measure", "Messen"),
  base: kw("base", "Základní-bod", "Base-point", "Basispunkt"),
  block: kw("block", "Blok", "Block", "Block"),
  align: kw("align", "Zarovnat", "Align", "Ausrichten"),
  settings: kw("settings", "Nastavení", "Settings", "Einstellungen"),
  above: kw("above", "Nad-objekty", "Above", "Über"),
  under: kw("under", "Pod-objekty", "Under", "Unter"),
  front: kw("front", "Dopředu", "Front", "Vorne"),
  back: kw("back", "Dozadu", "Back", "Hinten"),
  cpolygon: kw("cpolygon", "Mnohoúhelník", "CPolygon", "KPolygon"),
  done: kw("done", "Hotovo", "Done", "Fertig"),
  stretch: kw("stretch", "Protáhnout", "Stretch", "Strecken"),
  move: kw("move", "Posun", "Move", "Schieben"),
  rotate: kw("rotate", "Otočit", "Rotate", "Drehen"),
  scale: kw("scale", "Měřítko", "Scale", "Varia"),
  mirror: kw("mirror", "Zrcadlit", "Mirror", "Spiegeln"),
  all: kw("all", "Vše", "All", "Alle"),
  none: kw("none", "Nic", "None", "Keine"),
  tolerance: kw("tolerance", "Tolerance", "Tolerance", "Toleranz"),
  ignore: kw("ignore", "Ignorovat", "Ignore", "Ignorieren"),
  merge: kw("merge", "Sloučit", "Merge", "Zusammenführen"),
};

/**
 * Výzva s volbami a výchozí volbou: výchozí se zobrazí v jazyce rozhraní („<Ne>“, ne id „<no>“) a vrácený vstup má
 * vždy id volby (Enter vrátí popisek výchozí volby – převede se zpět na id).
 */
export function* askKw(msg: string, kws: Kw[], defId?: string, none = false): Generator<Prompt, Input, Input> {
  const d = defId !== undefined ? kws.find((k) => k.id === defId) : undefined;
  const r: Input = yield { k: "kw", msg, kw: kws, ...(d ? { def: kwLabel(d) } : {}), ...(none ? { none: true } : {}) };
  if (r.k === "kw" && !kws.some((k) => k.id === r.id)) {
    const m = matchKw(r.id, kws);
    if (m) return { k: "kw", id: m.id };
  }
  return r;
}

const KCTX = new WeakMap<CmdCtx, KindCtx>();
/**
 * Kontext druhů entit pro výpočty upravovacích příkazů. `c.kctx()` vrací `{ model: tx.model }` a po každé změně
 * tak znovu sestaví celý seznam entit (O(n)) – v cyklu přes výběr 10 000 entit by to bylo O(n²) (posun všeho 6 s).
 * Druhy entit z kontextu čtou jen tabulky (textové a kótovací styly, bloky, typy čar, proměnné), které upravovací
 * příkazy nemění (POŘADÍ mění jen pořadí entit, na konci), proto stačí jeden kontext na běh příkazu.
 */
export function kc(c: CmdCtx): KindCtx {
  let k = KCTX.get(c);
  if (!k) KCTX.set(c, (k = c.kctx()));
  return k;
}

/** stav kláves z GUI (Shift u OŘÍZNOUT / PRODLOUŽIT = opačná operace, Shift u ZAOBLIT = poloměr 0) – nastavuje ui-edit.tsx */
export const MOD = { shift: false };

/**
 * Volba předvybraná tlačítkem pásu (Pořadí ▾ → Dopředu…): příkaz si ji vezme hned při spuštění (a smaže), použije ji
 * po výběru objektů místo dotazu. Předané tokeny by bez předchozího výběru skončily ve výzvě výběru.
 */
export const PRESET: { draworder?: string } = {};

/**
 * VÝCHOZÍ hodnoty voleb, které příkazy pamatují mezi spuštěními (jako systémové proměnné AutoCADu FILLETRAD,
 * CHAMFERA…, OFFSETDIST, EDGEMODE, TRIMEXTENDMODE). Každý výkres (relace) má vlastní kopii – viz `editState`:
 * poloměr zaoblení z jednoho výkresu nebo z jiné relace agenta tak neovlivní příkaz v jiném výkresu.
 */
export const EDIT_STATE = {
  /** FILLETRAD */
  filletRad: 0,
  /** TRIMMODE: zaoblení / zkosení ořezává */
  trimMode: true,
  /** CHAMFERA, CHAMFERB, CHAMFERC (délka), CHAMFERD (úhel), CHAMMODE */
  chamA: 0,
  chamB: 0,
  chamLen: 0,
  chamAng: 0,
  chamByAngle: false,
  /** OFFSETDIST (−1 = Bodem), OFFSETERASE, vrstva (zdroj / aktuální) */
  offsetDist: 1,
  offsetThrough: false,
  offsetErase: false,
  offsetLayerCurrent: false,
  /** EDGEMODE (prodloužené hrany), TRIMEXTENDMODE (rychlý režim) */
  edgeExtend: false,
  quick: true,
  /** LENGTHEN */
  lenMode: "delta" as "delta" | "percent" | "total" | "dynamic",
  lenDelta: 10,
  lenDeltaAngle: null as number | null,
  lenPercent: 100,
  lenTotal: 100,
  lenTotalAngle: null as number | null,
  /** pole */
  arrCols: 4,
  arrRows: 3,
  arrPolarN: 6,
  arrFill: 360,
  /** MATCHPROP – přenášené vlastnosti */
  match: { color: true, layer: true, linetype: true, ltscale: true, lineweight: true, transparency: true, text: true, polyline: true, dim: true, hatch: true } as Record<string, boolean>,
};

export type EditState = typeof EDIT_STATE;
const STATES = new WeakMap<DraftSession, EditState>();
/** volby úprav výkresu (relace) – při prvním použití kopie výchozích `EDIT_STATE` */
export function editStateOf(s: DraftSession): EditState {
  let st = STATES.get(s);
  if (!st) STATES.set(s, (st = { ...EDIT_STATE, match: { ...EDIT_STATE.match } }));
  return st;
}
/** volby úprav výkresu, ve kterém příkaz běží */
export const editState = (c: CmdCtx): EditState => editStateOf(c.session);

/** Výběr objektů s PICKFIRST: v GUI použije předem vybrané; v textu prázdný výběr = aktuální výběr relace. */
export function* pickObjects(c: CmdCtx, msg: string, filter?: (e: DraftEntity) => boolean): Generator<Prompt, string[], Input> {
  const ok = (id: string) => {
    const e = c.tx.get(id);
    return !!e && (!filter || filter(e));
  };
  if (c.interactive && c.session.sel.length) {
    const ids = c.session.sel.filter(ok);
    if (ids.length) return ids;
  }
  const s = yield { k: "select", msg, filter };
  let ids = s.k === "sel" ? s.ids.filter(ok) : [];
  if (!ids.length && !c.interactive) ids = c.session.sel.filter(ok);
  return ids;
}

/**
 * Jeden objekt po výběru (dráha pole…): v textu výběr končí prvním tokenem, který není výběrem – prázdný token `""`
 * (Enter) se tu přeskočí, takže `pole-po-dráze e2 "" e1 …` i `pole-po-dráze e2 e1@0,0 …` fungují.
 */
export function* entityAfterSelect(c: CmdCtx, msg: string, filter?: (e: DraftEntity) => boolean): Generator<Prompt, Input, Input> {
  for (let i = 0; ; i++) {
    const r = yield { k: "entity", msg, filter, none: true };
    if (r.k !== "none" || i > 0 || c.interactive) return r;
  }
}

/** id vynechaná funkcí `unlocked` (zamčené hladiny) v běhu příkazu – chyba „nic nevybráno“ je uvede */
const LOCKED = new WeakMap<CmdCtx, string[]>();

/**
 * Nic nevybráno: v textu chyba (agent se dozví důvod), v GUI jen zpráva. Vyřadila-li výběr zamčená hladina, chyba
 * to řekne (neúspěšný výsledek příkazu protokol nenese – důvod musí být v chybě).
 */
export function nothing(c: CmdCtx, msg = tr("nic nevybráno")): void {
  const locked = LOCKED.get(c);
  const full = locked?.length ? tr("{0} – na zamčené hladině: {1}", msg, locked.join(", ")) : msg;
  if (!c.interactive) throw new Error(full);
  c.log(full);
}

/** rozdělí id na upravitelné a na zamčených hladinách (ty ohlásí) */
export function unlocked(c: CmdCtx, ids: string[]): string[] {
  const out: string[] = [];
  const locked: string[] = [];
  for (const id of ids) {
    const e = c.tx.get(id);
    if (!e) continue;
    if (findLayer(kc(c).model, e.layer)?.locked) locked.push(id);
    else out.push(id);
  }
  if (locked.length) {
    c.log(tr("⚠ na zamčené hladině (beze změny): {0}", locked.join(", ")));
    LOCKED.set(c, [...(LOCKED.get(c) ?? []), ...locked]);
  }
  return out;
}
export const isLocked = (c: CmdCtx, e: DraftEntity) => !!findLayer(kc(c).model, e.layer)?.locked;

/** po dokončení úpravy v GUI zruší výběr (jako AutoCAD – zůstane jako „předchozí“) */
export function doneSel(c: CmdCtx) {
  if (c.interactive && c.session.sel.length) setSelection(c.session, []);
}

/** vlastnosti entity, které převezme odvozená entita (hladina, barva, typ, tloušťka, měřítko, průhlednost, XDATA bez handle) */
export function styleOf(e: DraftEntity): Partial<DraftEntity> {
  const s: Record<string, unknown> = { layer: e.layer };
  if (e.color !== undefined) s.color = e.color;
  if (e.linetype !== undefined) s.linetype = e.linetype;
  if (e.lineweight !== undefined) s.lineweight = e.lineweight;
  if (e.ltscale !== undefined) s.ltscale = e.ltscale;
  if (e.transparency !== undefined) s.transparency = e.transparency;
  if (e.ext?.xdata) s.ext = { xdata: e.ext.xdata };
  return s as Partial<DraftEntity>;
}

/** entita bez id a handle (kopie) */
export function asNew(e: DraftEntity): NewEntity {
  const { id: _id, ext, ...rest } = e as DraftEntity & { ext?: DraftEntity["ext"] };
  void _id;
  const o = rest as Record<string, unknown>;
  if (ext?.xdata) o.ext = { xdata: ext.xdata };
  return o as unknown as NewEntity;
}

/**
 * Přidá entitu přesně s danými vlastnostmi (bez doplnění CECOLOR / CELTYPE, které `tx.add` přidá novým entitám –
 * kopie entity „DleHladiny“ má zůstat „DleHladiny“).
 */
export function addExact(c: CmdCtx, ne: NewEntity): string {
  const id = c.tx.add(ne);
  c.tx.put({ ...(ne as object), id, layer: c.tx.get(id)!.layer } as DraftEntity);
  return id;
}

/** odvozená entita se stylem zdroje (geometrie `geom`) */
export function addDerived(c: CmdCtx, src: DraftEntity, geom: NewEntity, layer?: string): string {
  return addExact(c, { ...styleOf(src), ...(geom as object), ...(layer ? { layer } : {}) } as NewEntity);
}

/** nahradí geometrii entity (stejné id a vlastnosti); typ smí změnit (úsečka → křivka) */
export function replaceGeom(c: CmdCtx, src: DraftEntity, geom: NewEntity) {
  const base: Record<string, unknown> = { ...styleOf(src), id: src.id };
  if (src.ext) base.ext = src.ext;
  c.tx.put({ ...base, ...(geom as object), id: src.id, layer: src.layer } as DraftEntity);
}

/** obraz entity v transformaci (null = druh transformaci nepodporuje – např. text při nestejném měřítku) */
export function xfEntity(c: CmdCtx, e: DraftEntity, m: Affine): DraftEntity | null {
  const k = kindOf(e);
  if (!k) return null;
  try {
    return k.transform(e, m, kc(c));
  } catch {
    return null;
  }
}

/**
 * Transformace výběru: `copy` = nové entity (vrací jejich id), jinak změna na místě. Entity, které se transformovat
 * nedají, ohlásí. Vrací id výsledných entit.
 */
export function transformIds(c: CmdCtx, ids: string[], m: Affine, copy: boolean): string[] {
  const out: string[] = [];
  const bad: string[] = [];
  for (const id of ids) {
    const e = c.tx.get(id);
    if (!e) continue;
    const n = xfEntity(c, e, m);
    if (!n) {
      bad.push(`${id} (${kindLabel(e.type)})`);
      continue;
    }
    if (copy) out.push(addExact(c, asNew(n)));
    else {
      c.tx.put({ ...n, id: e.id, layer: e.layer } as DraftEntity);
      out.push(id);
    }
  }
  if (bad.length) c.log(tr("⚠ nelze transformovat: {0}", bad.join(", ")));
  return out;
}

/** náhled transformace výběru (gumová čára) – nejvýš 400 entit */
export function previewXf(c: CmdCtx, ids: string[], m: Affine): NewEntity[] {
  const out: NewEntity[] = [];
  for (const id of ids.slice(0, 400)) {
    const e = c.tx.get(id);
    if (!e) continue;
    const n = xfEntity(c, e, m);
    if (n) out.push(asNew(n));
  }
  return out;
}

/**
 * Kroky uvnitř příkazu pro volbu Zpět (OŘÍZNOUT, PRODLOUŽIT, ZAOBLIT…): každá změna se zapíše s původním stavem
 * a `undo` ji vrátí (vytvořené smaže, změněné vrátí, smazané obnoví na původním místě v pořadí kreslení se stejným id).
 */
type StepRec = { old: DraftEntity | null; idx?: number; wasCreated?: boolean };
export class Steps {
  private stack: { put: Map<string, StepRec> }[] = [];
  private cur: Map<string, StepRec> | null = null;
  constructor(private c: CmdCtx) {}
  begin() {
    this.cur = new Map();
  }
  commit() {
    if (this.cur && this.cur.size) this.stack.push({ put: this.cur });
    this.cur = null;
  }
  private note(id: string) {
    if (!this.cur || this.cur.has(id)) return;
    this.cur.set(id, { old: this.c.tx.get(id) ?? null });
  }
  put(e: DraftEntity) {
    this.note(e.id);
    this.c.tx.put(e);
  }
  replace(src: DraftEntity, geom: NewEntity) {
    this.note(src.id);
    replaceGeom(this.c, src, geom);
  }
  add(src: DraftEntity, geom: NewEntity, layer?: string): string {
    const id = addDerived(this.c, src, geom, layer);
    if (this.cur) this.cur.set(id, { old: null });
    return id;
  }
  addNew(ne: NewEntity): string {
    const id = addExact(this.c, ne);
    if (this.cur) this.cur.set(id, { old: null });
    return id;
  }
  remove(id: string) {
    this.note(id);
    const r = this.cur?.get(id);
    if (r && r.old && r.idx === undefined) {
      // místo v pořadí kreslení a původ (entita výkresu / vytvořená tímto příkazem) pro obnovení
      r.idx = this.c.tx.entities.findIndex((e) => e.id === id);
      r.wasCreated = this.c.tx.created.includes(id);
    }
    this.c.tx.remove(id);
  }
  /** entita vytvořená mimo Steps (transformIds s kopií) patří do aktuálního kroku */
  created(id: string) {
    if (this.cur) this.cur.set(id, { old: null });
  }
  get size() {
    return this.stack.length;
  }
  /** vrátí poslední krok; false = není co vracet */
  undo(): boolean {
    const s = this.stack.pop();
    if (!s) return false;
    for (const [id, r] of [...s.put.entries()].reverse()) {
      const now = this.c.tx.get(id);
      if (!r.old) {
        if (now) this.c.tx.remove(id, true);
      } else if (now) this.c.tx.put(r.old, true);
      else if (r.wasCreated || r.idx === undefined || r.idx < 0 || !restoreEntity(this.c, r.old, r.idx)) addExact(this.c, { ...(r.old as object) } as NewEntity);
    }
    return true;
  }
}

/** Vrátí smazanou entitu výkresu na její místo v pořadí kreslení se stejným id (DraftTx.restore opraví evidenci). */
function restoreEntity(c: CmdCtx, e: DraftEntity, idx: number): boolean {
  return c.tx.restore(e, idx);
}

/** protokol: „✓ Posun: 3 entity“ */
export const logDone = (c: CmdCtx, what: string, n: number) => c.log(tr("✓ {0}: {1} entit", what, n));
