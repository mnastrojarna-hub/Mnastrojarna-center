/**
 * Průvodce „Kola a ozubení“ – čistý stav a plány vytvoření (bez Reactu a DOM, testy v Node).
 *
 * Stav: obrazovka (galerie → tabulka druhu → soukolí), data každého druhu (celá tabulka = výchozí hodnoty druhu + to, co
 * uživatel změnil), výstup (hotové kolo | polotovar | zuby do tělesa), operace a cíl. Reducer `wizardReducer` je jediné
 * místo, které stav mění; plány `planCreate` / `planPair` vrací buď nový dokument (prvek do otevřeného dílu), nebo
 * textový skript z EXISTUJÍCÍCH příkazů (`nový díl`, `materiál`, `prvek gear.*`, sestava ze soukolí) – GUI ≡ text.
 */
import { bodiesAt, nextBodyName } from "@/cad/bodies";
import { GEAR_KINDS, KINDS, PAIR_ROWS, gearDataRows, gearKeyValues, gearValidate, pairDefaults, pairScript, solvePair, type GearData, type GearDataRow, type GearKind, type GearRow, type Issue, type PairKind, type PairResult } from "@/cad/gears";
import { tr } from "@/cad/i18n";
import { uid, type CadDoc, type Feature } from "@/cad/types";

export type View = "gallery" | "table" | "pair";
export type OutMode = "wheel" | "blank" | "teeth";
/** operace s aktivním tělesem dílu: nové těleso | přidat | odebrat */
export type Op = "new" | "add" | "cut";
/** kam kolo přijde: do otevřeného dílu | jako nový díl (nová záložka) */
export type Target = "this" | "new";

export type WizardState = {
  view: View;
  kind: GearKind;
  /** celá tabulka každého druhu, který uživatel otevřel (výchozí hodnoty + změny) */
  values: Partial<Record<GearKind, GearData>>;
  out: OutMode;
  op: Op;
  target: Target;
  pairKind: PairKind;
  pairValues: Partial<Record<PairKind, GearData>>;
};

export type WizardAction =
  | { t: "gallery" }
  /** výběr druhu v galerii; `init` = naposledy použité hodnoty (localStorage) nebo předvyplnění z knihovny */
  | { t: "pick"; kind: GearKind; init?: GearData }
  /** změna řádků tabulky aktuálního druhu; `undefined` = vrátit výchozí hodnotu řádku */
  | { t: "set"; patch: GearData }
  | { t: "reset" }
  | { t: "out"; out: OutMode }
  | { t: "op"; op: Op }
  | { t: "target"; target: Target }
  /** obrazovka soukolí (druh soukolí; bez druhu = podle aktuálního kola, s jeho modulem a počtem zubů) */
  | { t: "pair"; kind?: PairKind }
  | { t: "pairSet"; patch: GearData }
  | { t: "pairReset" };

/** Klíče umístění a výstupu – nejsou v tabulce průvodce (řeší je patička) a neukládají se jako „naposledy použité“. */
export const PLACE_KEYS = ["out", "mode", "positionRef", "position", "axis", "turn"] as const;
/** řádky, které průvodce v tabulce neukazuje (výstup a operace jsou v patičce, odkaz polohy jen ve formuláři úprav) */
const WIZARD_HIDDEN = new Set(["out", "mode", "positionRef"]);

export const defaultsOf = (kind: GearKind): GearData => KINDS[kind].defaults();

/** druh soukolí, který k druhu kola patří */
export function pairKindOf(kind: GearKind): PairKind {
  switch (kind) {
    case "wormwheel":
      return "worm";
    case "ratchet":
      return "spur";
    default:
      return kind;
  }
}

/** Počáteční stav. `kind` = rovnou tabulka druhu (knihovna, „Vytvořit a další“), `pair` = rovnou soukolí. */
export function initState(o: { kind?: GearKind; data?: GearData; pair?: boolean | PairKind } = {}): WizardState {
  const kind = o.kind ?? "spur";
  const s: WizardState = { view: "gallery", kind, values: {}, out: "wheel", op: "new", target: "this", pairKind: pairKindOf(kind), pairValues: {} };
  if (o.kind) {
    s.view = "table";
    s.values[kind] = { ...defaultsOf(kind), ...(o.data ?? {}) };
    const out = o.data?.out;
    if (out === "blank" || out === "teeth" || out === "wheel") s.out = out;
  }
  if (o.pair) {
    s.view = "pair";
    if (typeof o.pair === "string") s.pairKind = o.pair;
  }
  return s;
}

/** data aktuálního druhu (celá tabulka) */
export const currentData = (s: WizardState): GearData => s.values[s.kind] ?? defaultsOf(s.kind);
/** data aktuálního druhu soukolí (jen zadané řádky; chybějící doplní solvePair z výchozích) */
export const currentPair = (s: WizardState): GearData => s.pairValues[s.pairKind] ?? pairDefaults(s.pairKind);

/** soukolí předvyplněné z kola, na kterém uživatel právě je (modul, počet zubů pastorku, šířka, úhly) */
export function seedPair(pk: PairKind, kind: GearKind, d: GearData | undefined): GearData {
  const out = pairDefaults(pk);
  if (!d || pairKindOf(kind) !== pk) return out;
  const has = (k: string) => PAIR_ROWS[pk].some((r) => r.key === k);
  for (const k of ["m", "alpha", "beta", "hand", "b", "chain", "profile", "rows", "w", "q", "N", "pinCircle", "pinD", "e"]) if (has(k) && d[k] !== undefined) out[k] = d[k];
  if (has("z1") && typeof d.z === "number" && kind !== "wormwheel" && kind !== "internal") out.z1 = d.z;
  if (kind === "internal" && typeof d.z === "number") out.z2 = d.z;
  if (kind === "wormwheel" && typeof d.z === "number") out.z2 = d.z;
  if (kind === "wormwheel" && typeof d.z1 === "number") out.z1 = d.z1;
  return out;
}

export function wizardReducer(s: WizardState, a: WizardAction): WizardState {
  switch (a.t) {
    case "gallery":
      return { ...s, view: "gallery" };
    case "pick": {
      const values = { ...s.values };
      if (a.init) values[a.kind] = { ...defaultsOf(a.kind), ...a.init };
      else values[a.kind] ??= defaultsOf(a.kind);
      return { ...s, view: "table", kind: a.kind, values, pairKind: pairKindOf(a.kind) };
    }
    case "set": {
      const def = defaultsOf(s.kind);
      const next = { ...currentData(s) };
      for (const [k, v] of Object.entries(a.patch)) {
        if (v === undefined) {
          if (k in def) next[k] = def[k];
          else delete next[k];
        } else next[k] = v;
      }
      return { ...s, values: { ...s.values, [s.kind]: next } };
    }
    case "reset":
      return { ...s, values: { ...s.values, [s.kind]: defaultsOf(s.kind) } };
    case "out":
      return { ...s, out: a.out };
    case "op":
      return { ...s, op: a.op };
    case "target":
      return { ...s, target: a.target };
    case "pair": {
      const pk = a.kind ?? pairKindOf(s.kind);
      const pairValues = { ...s.pairValues };
      pairValues[pk] ??= seedPair(pk, s.kind, s.view === "table" ? s.values[s.kind] : undefined);
      return { ...s, view: "pair", pairKind: pk, pairValues };
    }
    case "pairSet": {
      const next = { ...currentPair(s) };
      const def = pairDefaults(s.pairKind);
      for (const [k, v] of Object.entries(a.patch)) {
        if (v === undefined) next[k] = def[k];
        else next[k] = v;
      }
      return { ...s, pairValues: { ...s.pairValues, [s.pairKind]: next } };
    }
    case "pairReset":
      return { ...s, pairValues: { ...s.pairValues, [s.pairKind]: pairDefaults(s.pairKind) } };
    default:
      return s;
  }
}

// ---------------- tabulka ----------------

export type GroupId = GearRow["group"];
/** skupiny řádků tabulky v pořadí; `open` = rozbalená na začátku */
export const TABLE_GROUPS: { id: GroupId; label: () => string; open: boolean }[] = [
  { id: "basic", label: () => tr("Základní"), open: true },
  { id: "teeth", label: () => tr("Ozubení"), open: true },
  { id: "body", label: () => tr("Tělo kola"), open: false },
  { id: "place", label: () => tr("Umístění a výstup"), open: false },
  { id: "advanced", label: () => tr("Další"), open: false },
];

export const rowVisible = (r: GearRow, d: GearData) => !r.when || r.when(d);

/** Řádky tabulky po skupinách: povinné řádky první (a tučně), skryté podle `when`; průvodce vynechá výstup / operaci / odkaz. */
export function tableRows(rows: GearRow[], d: GearData, mode: "wizard" | "edit"): { id: GroupId; label: string; open: boolean; rows: GearRow[] }[] {
  const vis = rows.filter((r) => rowVisible(r, d) && !(mode === "wizard" && WIZARD_HIDDEN.has(r.key)));
  return TABLE_GROUPS.map((g) => {
    const inG = vis.filter((r) => r.group === g.id);
    return { id: g.id, label: g.label(), open: g.open, rows: [...inG.filter((r) => r.required), ...inG.filter((r) => !r.required)] };
  }).filter((g) => g.rows.length > 0);
}

/** Kontrola + spočtené řádky bez výjimek (neplatné číslo v poli nesmí shodit průvodce). */
export function evaluate(kind: GearKind, d: GearData): { ok: boolean; issues: Issue[]; rows: GearDataRow[] } {
  const ext = KINDS[kind].ext;
  let issues: Issue[];
  try {
    issues = gearValidate(ext, d).issues;
  } catch (e) {
    return { ok: false, issues: [{ level: "error", code: "exception", text: (e as Error).message }], rows: [] };
  }
  const ok = !issues.some((x) => x.level === "error");
  let rows: GearDataRow[] = [];
  if (ok)
    try {
      rows = gearDataRows(ext, d);
    } catch (e) {
      return { ok: false, issues: [...issues, { level: "error", code: "exception", text: (e as Error).message }], rows: [] };
    }
  return { ok, issues, rows };
}

/** název prvku kola („Ozubené kolo m2 z24“) */
export function gearName(kind: GearKind, d: GearData): string {
  const def = KINDS[kind];
  try {
    return def.name(def.read({ ...def.defaults(), ...d }));
  } catch {
    return def.label;
  }
}

/** souhrn pod náhledem (stejný řádek jako `stav`) */
export function gearLine(kind: GearKind, d: GearData): string {
  const def = KINDS[kind];
  try {
    const i = def.read({ ...def.defaults(), ...d });
    return def.summary(i, def.compute(i));
  } catch {
    return def.short;
  }
}

// ---------------- vytvoření ----------------

/** dokument je díl (ne sestava, ne 2D výkres) */
export const isPart = (doc: CadDoc) => (doc.kind ?? "part") === "part" && !doc.draft;
/** díl už má těleso (nějaký prvek s geometrií) */
export const partHasBody = (doc: CadDoc) => isPart(doc) && bodiesAt(doc).started;

/** výchozí název dokumentu (nový díl bez názvu) */
const defaultName = (n: string) => !n.trim() || /^(nový díl|díl|new part|part|neues teil|teil)(\s*\(?\d+\)?)?$/i.test(n.trim());

/** volný název prvku v historii („…“, „… (2)“) */
function freeName(doc: CadDoc, name: string): string {
  const used = new Set(doc.features.map((f) => f.name));
  if (!used.has(name)) return name;
  for (let n = 2; ; n++) if (!used.has(`${name} (${n})`)) return `${name} (${n})`;
}

export type CreateInput = { kind: GearKind; data: GearData; out: OutMode; op: Op; target: Target };
export type CreatePlan =
  | { kind: "commit"; doc: CadDoc; feature: Feature; name: string }
  | { kind: "text"; script: string; name: string }
  | { kind: "error"; text: string };

/** Data prvku tak, jak se uloží: celá tabulka + výstup + operace (zuby do tělesa vždy odebírají). */
export function featureData(c: CreateInput, hasBody: boolean): GearData {
  const data: GearData = { ...defaultsOf(c.kind), ...c.data, out: c.out };
  data.mode = c.out === "teeth" ? "cut" : !hasBody ? "new" : c.op;
  return data;
}

/**
 * Plán vytvoření: otevřený díl + cíl „do tohoto dílu“ → prvek na konec historie (nové těleso dostane další volný název
 * „Těleso N“, prázdný díl převezme název kola); jinak (sestava, 2D výkres, cíl „nový díl“) → skript existujících příkazů
 * `nový díl "…"` · `materiál ocel` · `prvek gear.<druh> klíč=hodnota … name="…"`.
 */
export function planCreate(doc: CadDoc, c: CreateInput): CreatePlan {
  const def = KINDS[c.kind];
  const v = evaluate(c.kind, c.data);
  const bad = v.issues.find((x) => x.level === "error");
  if (bad) return { kind: "error", text: bad.text };
  const name = gearName(c.kind, c.data);
  if (c.target === "this" && isPart(doc)) {
    const hasBody = partHasBody(doc);
    if (c.out === "teeth" && !hasBody) return { kind: "error", text: tr("Zuby do tělesa potřebují těleso – nejdřív vytvořte polotovar (výstup Polotovar) nebo jiný tvar.") };
    const data = featureData(c, hasBody);
    const empty = !doc.features.some((f) => f.type !== "datum" && f.type !== "datumAxis" && f.type !== "datumPoint" && f.type !== "csys");
    const fname = freeName(doc, name);
    const feature = { id: uid(), name: fname, type: "ext", ext: def.ext, data, ...(hasBody && data.mode === "new" ? { body: nextBodyName(bodiesAt(doc).names) } : {}) } as Feature;
    // prázdný díl s výchozím názvem („Nový díl 2“, „Díl 1“…) převezme název kola; vlastní název uživatele zůstane
    const next: CadDoc = { ...doc, ...(empty && defaultName(doc.name) ? { name } : {}), ...(doc.material ? {} : { material: "ocel" }), features: [...doc.features, feature] };
    return { kind: "commit", doc: next, feature, name: fname };
  }
  if (c.out === "teeth") return { kind: "error", text: tr("Zuby do tělesa jdou jen do otevřeného dílu s tělesem.") };
  const data = featureData(c, false);
  const kv = gearKeyValues(def.ext, data);
  const q = (s: string) => `"${s.replace(/"/g, "'")}"`;
  return { kind: "text", script: [`nový díl ${q(name)}`, "materiál ocel", `prvek ${def.ext}${kv ? ` ${kv}` : ""} name=${q(name)}`].join("\n"), name };
}

/** Soukolí: výsledek řešení a skript existujících příkazů (dva díly, sestava, vložení, vazba). */
export function planPair(kind: PairKind, values: GearData): { res: PairResult; script: string[] } {
  let res: PairResult;
  try {
    res = solvePair({ kind, values });
  } catch (e) {
    res = { ok: false, issues: [{ level: "error", code: "exception", text: (e as Error).message }], rows: [], wheels: [{ ext: "gear.spur", name: "", data: {} }, { ext: "gear.spur", name: "", data: {} }], placement: [{ at: [0, 0, 0], rot: [0, 0, 0] }, { at: [0, 0, 0], rot: [0, 0, 0] }], mate: { kind: "gear", flip: false, faceA: "", faceB: "" }, asmName: "" };
  }
  return { res, script: res.ok ? pairScript(res) : [] };
}

/** ✗ řádky protokolu textového běhu (chyby, které má průvodce ukázat) */
export const protocolErrors = (log: string): string[] =>
  log
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l.startsWith("✗"));

// ---------------- naposledy použité hodnoty ----------------

const STORE = (k: GearKind) => `mncad.gears.${k}`;

/** jen hodnoty odlišné od výchozích, bez umístění a výstupu */
export function storable(kind: GearKind, d: GearData): GearData {
  const def = defaultsOf(kind);
  const out: GearData = {};
  for (const [k, v] of Object.entries(d)) {
    if ((PLACE_KEYS as readonly string[]).includes(k) || v === undefined) continue;
    if (JSON.stringify(v) !== JSON.stringify(def[k])) out[k] = v;
  }
  return out;
}
/** naposledy použité hodnoty druhu (prohlížeč; v soukromém okně nic) */
export function loadLast(kind: GearKind): GearData | undefined {
  try {
    const raw = globalThis.localStorage?.getItem(STORE(kind));
    if (!raw) return undefined;
    const v = JSON.parse(raw) as unknown;
    if (!v || typeof v !== "object" || Array.isArray(v)) return undefined;
    const keys = new Set(Object.keys(defaultsOf(kind)));
    return Object.fromEntries(Object.entries(v as GearData).filter(([k]) => keys.has(k) && !(PLACE_KEYS as readonly string[]).includes(k)));
  } catch {
    return undefined;
  }
}
export function saveLast(kind: GearKind, d: GearData) {
  try {
    globalThis.localStorage?.setItem(STORE(kind), JSON.stringify(storable(kind, d)));
  } catch {
    /* úložiště prohlížeče nedostupné – nic se neděje */
  }
}

// ---------------- knihovna normálií → tabulka ----------------

const n = (v: unknown, d = 0) => {
  if (v === undefined || v === null || (typeof v === "string" && !v.trim())) return d;
  const x = typeof v === "number" ? v : Number(String(v).replace(",", "."));
  return Number.isFinite(x) ? x : d;
};
/** společné řádky těla z knihovny (díra, pero, náboj) */
const libBody = (v: Record<string, unknown>): GearData => {
  const bore = n(v.bore);
  const hub = n(v.hub);
  const hubL = n(v.hubL);
  return { ...(bore > 0 ? { bore, keyway: v.keyway !== false } : {}), ...(hub > 0 && hubL > 0 ? { hubD: hub, hubL } : {}) };
};

/**
 * Rodina knihovny normálií (stará „Ozubení a řetězy“, „Řemenice“) → druh a předvyplněná tabulka průvodce.
 * null = rodina nemá odpovídající druh (klínová řemenice).
 */
export function libraryToGear(familyId: string, v: Record<string, unknown>): { kind: GearKind; data: GearData } | null {
  switch (familyId) {
    case "gear":
      return { kind: "spur", data: { m: n(v.m, 2), z: Math.round(n(v.z, 24)), b: n(v.b, 20), x: n(v.x), alpha: n(v.alpha, 20), ...libBody(v) } };
    case "gearInternal": {
      const m = n(v.m, 2);
      const z = Math.round(n(v.z, 60));
      return { kind: "internal", data: { m, z, b: n(v.b, 20), rimD: Math.round((m * z + 2.5 * m + 2 * n(v.rim, 8)) * 10) / 10 } };
    }
    case "rack":
      return { kind: "rack", data: { m: n(v.m, 2), z: Math.round(n(v.n, 40)), b: n(v.b, 20), h: n(v.h, 20) } };
    case "sprocket":
      return { kind: "sprocket", data: { chain: String(v.chain ?? "08B"), z: Math.round(n(v.z, 19)), rows: Math.round(n(v.rows, 1)), ...libBody(v) } };
    case "htd":
      return { kind: "pulley", data: { profile: String(v.profile ?? "5M"), z: Math.round(n(v.z, 32)), w: n(v.w, 15), flanges: v.flanges !== false, ...libBody(v) } };
    case "gearHelical":
      return { kind: "helical", data: { m: n(v.mn, 2), z: Math.round(n(v.z, 20)), beta: n(v.beta, 15), hand: v.hand === "L" ? "left" : "right", b: n(v.b, 20), ...libBody(v) } };
    case "gearBevel": {
      const z = Math.round(n(v.z, 20));
      const delta = n(v.delta, 45);
      return { kind: "bevel", data: { m: n(v.m, 2), z, zMate: Math.max(5, Math.round(z / Math.tan((delta * Math.PI) / 180))), b: n(v.b, 12), ...libBody(v) } };
    }
    case "worm":
      return { kind: "worm", data: { m: n(v.m, 2), q: n(v.q, 10), z1: Math.round(n(v.starts, 1)), L: n(v.l, 40), ...(n(v.shaft) > 0 ? { shaftD: n(v.shaft), shaftL: n(v.shaftL, 30) } : {}) } };
    case "wormWheel":
      return { kind: "wormwheel", data: { m: n(v.m, 2), z: Math.round(n(v.z, 30)), q: n(v.q, 10), b: n(v.b, 16), ...libBody(v) } };
    default:
      return null;
  }
}

/** všechny druhy v pořadí galerie (skupiny) */
export const GALLERY: { label: () => string; kinds: GearKind[] }[] = [
  { label: () => tr("Čelní a hřeben"), kinds: ["spur", "helical", "herringbone", "internal", "rack"] },
  { label: () => tr("Kuželová a šneková"), kinds: ["bevel", "hypoid", "worm", "wormwheel"] },
  { label: () => tr("Cykloidní"), kinds: ["cycloid", "cyclodisc"] },
  { label: () => tr("Řetěz, řemen, rohatka"), kinds: ["sprocket", "pulley", "ratchet"] },
];
/** kontrola úplnosti galerie (test) */
export const galleryKinds = () => GALLERY.flatMap((g) => g.kinds);
export { GEAR_KINDS };
