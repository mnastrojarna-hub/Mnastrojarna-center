/**
 * Příkazy 2D výkresu – registr a jejich provádění. Stejný příkaz obsluhuje GUI (klik, příkazový řádek) i agenty (text).
 *
 * Příkaz s výzvami je generátor: `yield` výzvu (bod, vzdálenost, úhel, klíčové slovo, text, výběr…) a dostane zadání.
 * Řádkový příkaz (hladina, vlastnosti, výběr, stav…) dostane celý zbytek řádku najednou.
 * Názvy: česky, anglicky, německy + zkratky AutoCADu (L, C, PL…); „_LINE“ = anglický název v každém jazyce.
 */
import { getLang, tr } from "../i18n";
import { parsePoint, type CoordCtx } from "./coords";
import { angleOf, dist, sub, unit } from "./geom";
import { kindOf, type Fmt, type KindCtx } from "./kinds";
import { spaceEntities, type DraftEntity, type DraftModel, type NewEntity, type Vec2 } from "./model";
import { parseSelection } from "./select";
import { setSelection, touch, type DraftCmdResult, type DraftSession } from "./session";
import { directDistance } from "./snap";
import { spatialIndex } from "./spatial";
import { DraftTx } from "./tx";
import { evalNumber, fmtAng, fmtLen, fmtPt, normDeg } from "./units";

/** klíčové slovo výzvy (popisky ve třech jazycích; `_id` = anglický zápis vždy) */
/** volba výzvy; `alias` = zkratky AutoCADu, které nejsou začátkem názvu (TRIM: T = cuTting edges, O = mOde, R = eRase) */
export type Kw = { id: string; cs: string; en: string; de: string; alias?: string[] };
export const kw = (id: string, cs: string, en: string, de: string, alias?: string[]): Kw => (alias?.length ? { id, cs, en, de, alias } : { id, cs, en, de });

/** náhled během výzvy (gumová čára): entity k vykreslení pro polohu kurzoru */
export type Preview = (p: Vec2) => NewEntity[];

export type Prompt =
  | { k: "point"; msg: string; base?: Vec2; kw?: Kw[]; none?: boolean; preview?: Preview; dir?: Vec2 }
  /** vzdálenost: číslo, nebo bod (vzdálenost od `base`); `pt` = bod se předá jako bod (orientace podle bodu) */
  | { k: "dist"; msg: string; base?: Vec2; kw?: Kw[]; def?: number; none?: boolean; preview?: Preview; min?: number; pt?: boolean }
  /** úhel ve stupních, nebo bod (úhel směru od `base`); `pt` = bod se předá jako bod */
  | { k: "angle"; msg: string; base?: Vec2; kw?: Kw[]; def?: number; none?: boolean; preview?: Preview; pt?: boolean }
  | { k: "int"; msg: string; def?: number; min?: number; max?: number; kw?: Kw[]; none?: boolean }
  | { k: "kw"; msg: string; kw: Kw[]; def?: string; none?: boolean }
  /** text (v GUI celý řádek včetně mezer, v textu jeden token – v uvozovkách) */
  | { k: "text"; msg: string; def?: string; none?: boolean }
  /** výběr entit (PICKFIRST: je-li už něco vybráno a příkaz to dovolí, výzva se přeskočí) */
  | { k: "select"; msg: string; filter?: (e: DraftEntity) => boolean }
  /** jedna entita (klik / id) + bod výběru */
  | { k: "entity"; msg: string; filter?: (e: DraftEntity) => boolean; kw?: Kw[]; none?: boolean };

export type Input =
  | { k: "point"; p: Vec2 }
  | { k: "num"; v: number }
  | { k: "kw"; id: string }
  | { k: "text"; s: string }
  | { k: "none" }
  | { k: "sel"; ids: string[] }
  | { k: "ent"; id: string; p: Vec2 };

export type CmdGen = Generator<Prompt, void, Input>;

/** GUI háčky (v textovém režimu chybí) */
export type DraftUiHooks = {
  /** otevře panel pracovní plochy (layers, properties… – balíky přidávají své) */
  openPanel?: (panel: string) => void;
  /** krátká zpráva v GUI */
  flash?: (msg: string) => void;
  /** uložení souboru (export, tisk) */
  download?: (name: string, data: Uint8Array | string, mime: string) => void;
  /** výběr souboru k otevření (import) */
  pickFile?: () => void;
  /** název dokumentu (výchozí název souboru) */
  docName?: () => string;
};

export type CmdCtx = {
  tx: DraftTx;
  session: DraftSession;
  /** zapíše řádek protokolu */
  log: (s: string) => void;
  /** strukturovaný výsledek (data pro agenty) */
  out: (key: string, v: unknown) => void;
  fmt: Fmt;
  /** kontext druhů entit nad aktuálním modelem transakce */
  kctx: () => KindCtx;
  /** zapamatuje poslední bod (pro @) */
  setLast: (p: Vec2) => void;
  interactive: boolean;
  ui?: DraftUiHooks;
  /** zadání bodu textem v kontextu příkazu (odkazy na entity, @) */
  parsePoint: (t: string, base?: Vec2 | null) => Vec2 | null;
};

export type CommandGroup = "draw" | "modify" | "annotate" | "layer" | "block" | "layout" | "output" | "inquiry" | "view" | "util";

export interface DraftCommandDef {
  /** kanonický anglický název (LINE, CIRCLE…) – `_LINE` funguje v každém jazyce */
  id: string;
  /** plné názvy podle jazyka (první = zobrazovaný) */
  names: { cs: string[]; en: string[]; de: string[] };
  /** zkratky (jako AutoCAD: L, C, PL…) – v každém jazyce */
  alias?: string[];
  group: CommandGroup;
  /** popis do nápovědy a návodu pro AI */
  desc: () => string;
  /** zápis textem (nápověda): např. „čára x,y x,y … [uzavřít]“ */
  usage?: () => string;
  /** příkaz s výzvami */
  run?: (c: CmdCtx) => CmdGen;
  /** řádkový příkaz: celý zbytek řádku najednou */
  line?: (c: CmdCtx, args: string[]) => void;
  /**
   * asynchronní řádkový příkaz (soubory, knihovny načítané líně – export / import DWG / DXF, tisk PDF);
   * provádí ho `runScriptAsync` (agenti) a příkazový řádek GUI. Nový dokument předá `c.out("newModel", model)`,
   * soubor ke stažení `c.out("file", { name, mime, text? | base64? })`.
   */
  async?: (c: CmdCtx, args: string[]) => Promise<void>;
  /** nemění výkres (dotazy, pohled) – nevytváří krok historie */
  readonly?: boolean;
  /** výzva výběru použije existující výběr (PICKFIRST) */
  pickfirst?: boolean;
}

const REG = new Map<string, DraftCommandDef>();
const NAMES = new Map<string, DraftCommandDef>();
const fold = (s: string) => s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/ß/g, "ss");

/** Registrace příkazu (jádro: cmd-*.ts; balíky fáze B ve svých souborech). Kolize názvu = chyba při načtení. */
export function registerCommand(def: DraftCommandDef): void {
  if (REG.has(def.id)) throw new Error(`draft command ${def.id} already registered`);
  REG.set(def.id, def);
  const all = [def.id, `_${def.id}`, ...def.names.cs, ...def.names.en, ...def.names.de, ...(def.alias ?? [])];
  for (const n of all) {
    const k = fold(n);
    const prev = NAMES.get(k);
    if (prev && prev !== def) throw new Error(`draft command name "${n}" of ${def.id} collides with ${prev.id}`);
    NAMES.set(k, def);
  }
}
/** příkaz podle názvu / zkratky (předpony AutoCADu „-“, „'“, „.“ se ignorují; „_LINE“ = anglický název) */
export const findCommand = (name: string): DraftCommandDef | undefined => NAMES.get(fold(name.replace(/^[-'.]+/, "")));
export const commands = (): DraftCommandDef[] => [...REG.values()];
/** zobrazovaný název příkazu v jazyce rozhraní */
export const cmdName = (d: DraftCommandDef) => (getLang() === "en" ? d.names.en[0] : getLang() === "de" ? d.names.de[0] : d.names.cs[0]) ?? d.id;

// ---------------------------------------------------------------- tokeny a zadání

/** rozdělení řádku na tokeny (mezery; uvozovky "…", „…“, '…' drží mezery) */
export function tokenize(line: string): string[] {
  const out: string[] = [];
  const re = /"([^"]*)"|„([^“”]*)[“”]|'([^']*)'|(\S+)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(line))) out.push(m[1] ?? m[2] ?? m[3] ?? m[4]);
  return out;
}

export const kwLabel = (k: Kw) => (getLang() === "en" ? k.en : getLang() === "de" ? k.de : k.cs);

/** klíčové slovo: přesný název v libovolném jazyce, `_id`, nebo jednoznačný začátek (nejdřív v jazyce rozhraní) */
export function matchKw(tok: string, list: Kw[] | undefined): Kw | null {
  if (!list?.length) return null;
  const t = fold(tok);
  if (!t) return null;
  for (const k of list) if (t === `_${k.id.toLowerCase()}` || t === fold(k.cs) || t === fold(k.en) || t === fold(k.de) || t === k.id.toLowerCase()) return k;
  // zkratka AutoCADu (přesná shoda, má přednost před začátkem názvu)
  for (const k of list) if (k.alias?.some((a) => fold(a) === t)) return k;
  const lang = getLang();
  const pick = (names: (k: Kw) => string[]) => {
    const hits = list.filter((k) => names(k).some((n) => fold(n).startsWith(t)));
    const ids = new Set(hits.map((h) => h.id));
    return ids.size === 1 ? hits[0] : null;
  };
  return pick((k) => [lang === "en" ? k.en : lang === "de" ? k.de : k.cs]) ?? pick((k) => [k.cs, k.en, k.de]);
}

/** text výzvy s volbami: „Zadejte další bod nebo [Zpět/Uzavřít] <10>:“ */
export function promptText(p: Prompt): string {
  const kws = "kw" in p && p.kw?.length ? ` [${p.kw.map(kwLabel).join("/")}]` : "";
  const d = promptDefault(p, 1e6);
  return `${p.msg}${kws}${d ? ` <${d}>` : ""}:`;
}

/** výchozí hodnota výzvy k zobrazení (u klíčového slova jeho název v jazyce rozhraní, ne id); "" = žádná */
export function promptDefault(p: Prompt, round = 1e4): string {
  if (!("def" in p) || p.def === undefined || p.def === "") return "";
  if (typeof p.def === "number") return String(Math.round(p.def * round) / round);
  const kw = "kw" in p ? p.kw?.find((k) => k.id === p.def) : undefined;
  return kw ? kwLabel(kw) : String(p.def);
}

export class InputError extends Error {}

export type FeedOpts = {
  /** směr pro přímé zadání vzdálenosti (GUI: ke kurzoru se ORTHO / polárním); jinak směr výzvy, jinak +X */
  dir?: Vec2 | null;
};

/** převod textového zadání na vstup výzvy (chyba = InputError s důvodem) */
export function tokenToInput(tok: string, p: Prompt, cctx: CoordCtx, opts: FeedOpts = {}): Input {
  const t = tok.trim();
  if (!t) {
    if ("def" in p && p.def !== undefined) return p.k === "kw" ? { k: "kw", id: String(p.def) } : p.k === "text" ? { k: "text", s: String(p.def) } : { k: "num", v: Number(p.def) };
    if ("none" in p && p.none) return { k: "none" };
    throw new InputError(tr("zadejte hodnotu: {0}", promptText(p)));
  }
  if (p.k === "text") return { k: "text", s: tok };
  const isNum = /^[-+(.\d]/.test(t) && !/[,<]/.test(t) && Number.isFinite(evalNumber(t));
  const k = !isNum ? matchKw(t, "kw" in p ? p.kw : undefined) : null;
  if (k) return { k: "kw", id: k.id };
  switch (p.k) {
    case "kw":
      throw new InputError(tr("neznámá volba „{0}“ – možnosti: {1}", tok, p.kw.map(kwLabel).join(", ")));
    case "int": {
      const v = evalNumber(t, true);
      if (!Number.isInteger(v)) throw new InputError(tr("očekávám celé číslo, ne „{0}“", tok));
      if ((p.min !== undefined && v < p.min) || (p.max !== undefined && v > p.max)) throw new InputError(tr("číslo musí být v rozsahu {0}–{1}", p.min ?? "−∞", p.max ?? "∞"));
      return { k: "num", v };
    }
    case "point": {
      if (isNum) {
        const base = p.base;
        if (!base) throw new InputError(tr("samotné číslo („{0}“) je vzdálenost od předchozího bodu – tady zadejte bod x,y", tok));
        const v = evalNumber(t);
        const dir = opts.dir ?? p.dir ?? [1, 0];
        return { k: "point", p: directDistance(base, dir, v) };
      }
      const pt = safePoint(t, { ...cctx, base: p.base ?? cctx.base });
      if (!pt) throw new InputError(tr("neplatný bod „{0}“ – x,y, @dx,dy, @d<úhel nebo e3.end", tok));
      return { k: "point", p: pt };
    }
    case "dist": {
      if (isNum) {
        const v = evalNumber(t);
        if (p.min !== undefined && v < p.min) throw new InputError(tr("hodnota musí být alespoň {0}", p.min));
        return { k: "num", v };
      }
      const pt = safePoint(t, { ...cctx, base: p.base ?? cctx.base });
      if (!pt) throw new InputError(tr("očekávám vzdálenost nebo bod, ne „{0}“", tok));
      if (p.pt) return { k: "point", p: pt };
      if (!p.base) throw new InputError(tr("vzdálenost bodem potřebuje výchozí bod – zadejte číslo"));
      return { k: "num", v: dist(p.base, pt) };
    }
    case "angle": {
      if (isNum || /^-?[\d.]+°$/.test(t)) return { k: "num", v: evalNumber(t.replace("°", "")) };
      const pt = safePoint(t, { ...cctx, base: p.base ?? cctx.base });
      if (!pt) throw new InputError(tr("očekávám úhel ve stupních nebo bod, ne „{0}“", tok));
      if (p.pt) return { k: "point", p: pt };
      if (!p.base) throw new InputError(tr("úhel bodem potřebuje výchozí bod – zadejte úhel ve stupních"));
      return { k: "num", v: normDeg((angleOf(sub(pt, p.base)) * 180) / Math.PI) };
    }
    case "entity": {
      const m = /^(e\d+)(?:@(.+))?$/i.exec(t);
      if (m) {
        const e = (cctx.list as DraftEntity[]).find((x) => x.id === m[1].toLowerCase());
        if (!e) throw new InputError(tr("entita {0} neexistuje", m[1]));
        if (p.filter && !p.filter(e)) throw new InputError(tr("entita {0} ({1}) tu nejde použít", e.id, kindOf(e)?.label() ?? e.type));
        const hint = m[2] ? safePoint(m[2], cctx) : null;
        return { k: "ent", id: e.id, p: hint ?? kindOf(e)?.snaps(e, { model: cctx.model })[0]?.p ?? [0, 0] };
      }
      throw new InputError(tr("zadejte entitu (id, např. e3 nebo e3@x,y), ne „{0}“", tok));
    }
    case "select":
      throw new InputError(tr("výběr se zadává slovy výběru"));
  }
  return { k: "none" };
}
function safePoint(t: string, c: CoordCtx): Vec2 | null {
  try {
    return parsePoint(t, c);
  } catch (e) {
    throw new InputError((e as Error).message);
  }
}

// ---------------------------------------------------------------- běh příkazu

export function makeFmt(m: DraftModel): Fmt {
  return { len: (v) => fmtLen(v, m.vars), ang: (d) => fmtAng(d, m.vars), pt: (p) => fmtPt(p, m.vars) };
}

export type RunOpts = { interactive?: boolean; ui?: DraftUiHooks };

/** Probíhající příkaz (GUI krok za krokem, text najednou). */
export class CmdRun {
  readonly def: DraftCommandDef;
  readonly tx: DraftTx;
  readonly session: DraftSession;
  readonly ctx: CmdCtx;
  readonly logLines: string[] = [];
  readonly data: Record<string, unknown> = {};
  prompt: Prompt | null = null;
  done = false;
  error: string | null = null;
  private gen: CmdGen | null = null;
  /** poslední bod zadaný v tomto příkazu (směr pro přímou vzdálenost) */
  private prevPt: Vec2 | null = null;
  private lastDir: Vec2 | null = null;

  constructor(def: DraftCommandDef, model: DraftModel, session: DraftSession, opts: RunOpts = {}) {
    this.def = def;
    this.session = session;
    this.tx = new DraftTx(model, session.space);
    const tx = this.tx;
    this.ctx = {
      tx,
      session,
      log: (s) => this.logLines.push(s),
      out: (k, v) => void (this.data[k] = v),
      get fmt() {
        return makeFmt(tx.model);
      },
      kctx: () => ({ model: tx.model }),
      setLast: (p) => {
        if (this.prevPt && dist(this.prevPt, p) > 1e-12) this.lastDir = unit(sub(p, this.prevPt));
        this.prevPt = p;
        session.last = p;
      },
      interactive: !!opts.interactive,
      ui: opts.ui,
      parsePoint: (t, base) => parsePoint(t, this.coordCtx(base)),
    };
  }

  /** kontext zadání bodu – model a entity se čtou až při odkazu na entitu (skript s tisíci příkazy zůstane rychlý) */
  /**
   * Výzva výběru zadaná textem: spotřebuje tokeny výběru od indexu `i` (e3 e5, vše, okno x,y x,y, hladina X …),
   * předá výběr příkazu a vrátí index dalšího tokenu (stejně v textu pro agenty i u zadání předem v GUI).
   */
  feedSelection(tokens: string[], i: number): number {
    const p = this.prompt;
    if (!p || p.k !== "select") return i;
    const c = this.coordCtx();
    const m = this.tx.model;
    const list = spaceEntities(m, this.session.space) ?? m.entities;
    const r = parseSelection(tokens, i, { model: m, list, idx: spatialIndex(list, { model: m }), session: this.session, parsePoint: (t) => parsePoint(t, c) });
    const ids = p.filter ? r.ids.filter((id) => { const e = this.tx.get(id); return !!e && p.filter!(e); }) : r.ids;
    this.feed({ k: "sel", ids });
    return r.next;
  }

  coordCtx(base?: Vec2 | null): CoordCtx {
    const tx = this.tx;
    const s = this.session;
    return {
      get model() {
        return tx.model;
      },
      get list() {
        const m = tx.model;
        return spaceEntities(m, s.space) ?? m.entities;
      },
      last: s.last,
      base: base ?? null,
    };
  }

  /** spustí příkaz (příkaz s výzvami se zastaví na první výzvě) */
  start(args?: string[]): void {
    try {
      if (this.def.line) {
        this.def.line(this.ctx, args ?? []);
        this.finish();
        return;
      }
      if (!this.def.run) throw new Error(tr("příkaz {0} nejde spustit", this.def.id));
      this.gen = this.def.run(this.ctx);
      this.step(this.gen.next());
    } catch (e) {
      this.fail(e);
    }
  }

  private step(r: IteratorResult<Prompt, void>) {
    if (r.done) {
      this.prompt = null;
      this.finish();
    } else {
      this.prompt = r.value;
      // PICKFIRST: výzva výběru s už vybranými entitami se přeskočí
      if (r.value.k === "select" && this.def.pickfirst && this.session.sel.length && !this.pickfirstUsed) {
        this.pickfirstUsed = true;
        const filt = r.value.filter;
        const ids = this.session.sel.filter((id) => {
          const e = this.tx.get(id);
          return e && (!filt || filt(e));
        });
        if (ids.length) return this.feed({ k: "sel", ids });
      }
    }
  }
  private pickfirstUsed = false;

  /** zadání pro aktuální výzvu */
  feed(inp: Input): void {
    if (this.done || !this.gen) return;
    try {
      if (inp.k === "point") this.ctx.setLast(inp.p);
      this.step(this.gen.next(inp));
    } catch (e) {
      this.fail(e);
    }
  }

  /** zadání textem (token) – chyba zadání se vrátí (GUI zopakuje výzvu), jiná chyba příkaz ukončí */
  feedText(tok: string, opts: FeedOpts = {}): string | null {
    if (!this.prompt) return null;
    try {
      const inp = tokenToInput(tok, this.prompt, this.coordCtx(this.prompt && "base" in this.prompt ? this.prompt.base : null), { dir: opts.dir ?? this.lastDir });
      this.feed(inp);
      return null;
    } catch (e) {
      if (e instanceof InputError) return e.message;
      this.fail(e);
      return this.error;
    }
  }

  /** Esc: ukončí příkaz; dosavadní změny zůstanou (jako AutoCAD – nakreslené úsečky Esc nesmaže) */
  cancel(): void {
    if (this.done) return;
    try {
      this.gen?.return();
    } catch {
      /* ignore */
    }
    this.finish(true);
  }

  private fail(e: unknown) {
    this.error = (e as Error)?.message ?? String(e);
    this.done = true;
    this.prompt = null;
  }
  private finish(cancelled = false) {
    this.done = true;
    this.prompt = null;
    void cancelled;
  }

  /** výsledek pro protokol / API */
  result(input: string): DraftCmdResult {
    return {
      cmd: this.def.id,
      input,
      ok: !this.error,
      log: [...this.logLines],
      ...(this.error ? { error: this.error } : {}),
      created: this.tx.created,
      changed: this.tx.changed,
      deleted: this.tx.deleted,
      ...(Object.keys(this.data).length ? { data: { ...this.data } } : {}),
    };
  }
}

// ---------------------------------------------------------------- skript (agenti, příkazový řádek s celým řádkem)

/**
 * Provede jeden řádek příkazu nad modelem (bez GUI): první token = příkaz, další tokeny = zadání výzev v pořadí,
 * konec řádku = Enter. Atomické: při chybě se změny příkazu zahodí. Vrací nový model a výsledek.
 */
export function runCommandLine(model: DraftModel, session: DraftSession, line: string, opts: RunOpts = {}): { model: DraftModel; result: DraftCmdResult } {
  const tokens = tokenize(line);
  const name = tokens[0] ?? "";
  const def = findCommand(name);
  // protokol neúspěšného příkazu se vrací také (varování ⚠ před chybou – např. přeskočené entity zamčené hladiny)
  let run: CmdRun | null = null;
  const fail = (msg: string, cmd = def?.id ?? name): { model: DraftModel; result: DraftCmdResult } => ({ model, result: { cmd, input: line, ok: false, log: run ? [...run.logLines] : [], error: msg, created: [], changed: [], deleted: [] } });
  if (!def) return fail(tr("neznámý příkaz „{0}“ – seznam: 2d nápověda", name), name);
  run = new CmdRun(def, model, session, opts);
  if (def.line) {
    run.start(tokens.slice(1));
  } else {
    run.start();
    let i = 1;
    let guard = 0;
    while (!run.done && guard++ < 100000) {
      const p = run.prompt;
      if (!p) break;
      if (p.k === "select") {
        try {
          i = run.feedSelection(tokens, i);
        } catch (e) {
          return fail((e as Error).message);
        }
        continue;
      }
      const has = i < tokens.length;
      const tok = has ? tokens[i++] : "";
      const err = run.feedText(tok);
      if (err) {
        run.cancel();
        return fail(has ? tr("{0} (zadání „{1}“)", err, tok) : tr("chybí zadání – {0}", promptText(p)));
      }
    }
    if (run.error) return fail(run.error);
    if (i < tokens.length) return fail(tr("nadbytečné zadání „{0}“ – příkaz {1} skončil dřív", tokens.slice(i).join(" "), def.id));
  }
  if (run.error) return fail(run.error);
  const result = run.result(line);
  const out = def.readonly ? model : run.tx.model;
  if (result.created.length) session.lastCreated = result.created;
  touch(session);
  return { model: out, result };
}

/** Výchozí výběr po příkazu výběru (pomůcka pro příkazy). */
export function selectIds(session: DraftSession, ids: string[]) {
  setSelection(session, ids);
}

/** Rozdělí text na řádky příkazů (nový řádek nebo „;“ mimo uvozovky). */
export function splitScript(text: string): string[] {
  const out: string[] = [];
  for (const raw of text.split(/\r?\n/)) {
    let cur = "";
    let q: string | null = null;
    for (const ch of raw) {
      if (q) {
        if (ch === q || (q === "„" && (ch === "“" || ch === "”"))) q = null;
        cur += ch;
      } else if (ch === '"' || ch === "'" || ch === "„") {
        q = ch;
        cur += ch;
      } else if (ch === ";") {
        if (cur.trim()) out.push(cur.trim());
        cur = "";
      } else cur += ch;
    }
    // komentář: „# …“ (mřížka a mezera – „#10,20“ je absolutní bod) nebo „// …“
    const c = cur.replace(/\s+(#\s|\/\/).*$/, "").trim();
    if (c && !/^#(\s|$)/.test(c) && !c.startsWith("//")) out.push(c);
  }
  return out;
}

/** Provede skript (více řádků / „;“) – každý příkaz atomicky, chyba jednoho nezastaví další. */
export function runScript(model: DraftModel, session: DraftSession, text: string, opts: RunOpts = {}): { model: DraftModel; results: DraftCmdResult[] } {
  let m = model;
  const results: DraftCmdResult[] = [];
  for (const line of splitScript(text)) {
    const r = runCommandLine(m, session, line, opts);
    m = r.model;
    results.push(r.result);
    keepResult(session, r.result);
  }
  return { model: m, results };
}

/** posledních 200 výsledků v relaci (protokol GUI) */
function keepResult(session: DraftSession, r: DraftCmdResult) {
  session.results.push(r);
  if (session.results.length > 200) session.results.splice(0, session.results.length - 200);
}

/** Provede jeden řádek; asynchronní příkazy (soubory) počká. */
export async function runCommandLineAsync(model: DraftModel, session: DraftSession, line: string, opts: RunOpts = {}): Promise<{ model: DraftModel; result: DraftCmdResult }> {
  const tokens = tokenize(line);
  const def = findCommand(tokens[0] ?? "");
  if (!def?.async) return runCommandLine(model, session, line, opts);
  const run = new CmdRun(def, model, session, opts);
  try {
    await def.async(run.ctx, tokens.slice(1));
  } catch (e) {
    return { model, result: { cmd: def.id, input: line, ok: false, log: [...run.logLines], error: (e as Error)?.message ?? String(e), created: [], changed: [], deleted: [] } };
  }
  const result = run.result(line);
  touch(session);
  return { model: def.readonly ? model : run.tx.model, result };
}

/** Skript s asynchronními příkazy (agenti, window.mncad.draft). */
export async function runScriptAsync(model: DraftModel, session: DraftSession, text: string, opts: RunOpts = {}): Promise<{ model: DraftModel; results: DraftCmdResult[] }> {
  let m = model;
  const results: DraftCmdResult[] = [];
  for (const line of splitScript(text)) {
    const r = await runCommandLineAsync(m, session, line, opts);
    m = r.model;
    results.push(r.result);
    keepResult(session, r.result);
  }
  return { model: m, results };
}
