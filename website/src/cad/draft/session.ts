/**
 * Relace 2D výkresu (neukládá se do dokumentu): výběr, předchozí výběr, poslední vytvořené entity, poslední bod,
 * prostor (model / rozvržení), požadavek na pohled od textových příkazů a protokol posledních výsledků pro API.
 * Jedna relace na výkres (klíč = `DraftModel.id`); GUI se přihlásí k odběru změn.
 */
import type { Box } from "./geom";
import type { DraftModel, DraftSpace, Vec2 } from "./model";
import { entityById, spaceEntities } from "./model";

export type ZoomRequest = { kind: "extents" } | { kind: "window"; box: Box } | { kind: "center"; c: Vec2; h: number } | { kind: "scale"; k: number };

/** výsledek jednoho příkazu (protokol pro agenty, window.mncad.draft) */
export type DraftCmdResult = {
  /** kanonický název příkazu (LINE, CIRCLE, LAYER…) */
  cmd: string;
  /** zadaný text příkazu */
  input: string;
  ok: boolean;
  log: string[];
  error?: string;
  created: string[];
  changed: string[];
  deleted: string[];
  /** strukturovaná data (měření, výpis, stav…) */
  data?: Record<string, unknown>;
};

export type DraftSession = {
  key: string;
  sel: string[];
  prevSel: string[];
  lastCreated: string[];
  last: Vec2 | null;
  space: DraftSpace;
  zoom: ZoomRequest | null;
  /** výsledky příkazů od posledního vyzvednutí (window.mncad.draft) */
  results: DraftCmdResult[];
  /** naposledy spuštěný příkaz (Enter na prázdném řádku ho zopakuje) */
  lastCmd: string | null;
  /** verze relace – zvýší se při každé změně (GUI překreslí) */
  ver: number;
};

const sessions = new Map<string, DraftSession>();
const listeners = new Set<() => void>();

export function sessionFor(m: DraftModel | string): DraftSession {
  const key = typeof m === "string" ? m : m.id;
  let s = sessions.get(key);
  if (!s) {
    s = { key, sel: [], prevSel: [], lastCreated: [], last: null, space: "model", zoom: null, results: [], lastCmd: null, ver: 0 };
    sessions.set(key, s);
  }
  return s;
}

export function touch(s: DraftSession) {
  s.ver++;
  for (const l of listeners) l();
}
export function subscribe(fn: () => void): () => void {
  listeners.add(fn);
  return () => void listeners.delete(fn);
}

/** nastaví výběr (předchozí se zapamatuje pro „předchozí“) */
export function setSelection(s: DraftSession, ids: string[]) {
  const uniq = [...new Set(ids)];
  if (uniq.length === s.sel.length && uniq.every((x, i) => x === s.sel[i])) return;
  if (s.sel.length) s.prevSel = s.sel;
  s.sel = uniq;
  touch(s);
}

/** odebere z výběru entity, které už v prostoru nejsou (po smazání, zpět…) */
export function pruneSelection(s: DraftSession, m: DraftModel) {
  const list = spaceEntities(m, s.space) ?? m.entities;
  const keep = s.sel.filter((id) => entityById(list, id));
  if (keep.length !== s.sel.length) {
    s.sel = keep;
    touch(s);
  }
}

/** vyzvedne a vyprázdní protokol výsledků */
export function takeResults(s: DraftSession): DraftCmdResult[] {
  const r = s.results;
  s.results = [];
  return r;
}
