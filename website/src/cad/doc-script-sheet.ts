/**
 * Převodník dokument → skript (doc-script.ts), část výkresu (vlna E): všechno, co agent umí na list napsat textem, a co
 * převodník dřív nezapsal nebo jen ohlásil –
 *  - razítko celé: šablona, logo (data URL), firma, zákazník, projekt, kontroloval, schválil, polotovar, počet kusů, tepelné
 *    zpracování, povrchová úprava, tolerance úhlů a sražení, nepředepsané tolerance (i tabulka podle desetinných míst),
 *  - tabulka revizí (`výkres revize A "…" datum=… kreslil=…`, `výkres revize A značky ne`),
 *  - funkční rozměry a polohy děr Chytrých kót (`kótovat chytře funkční 80 díry tabulka`), pružiny plně / zjednodušeně,
 *  - další modely, pomocné pohledy, řezy lomenou čarou, detaily (pořadí podle písmen – po přečtení stejná písmena),
 *    částečné řezy, přerušení, zobrazení uložení a Tabulka uložení,
 *  - upravené vygenerované kóty a pozice (`výkres vygenerované skrýt|posun …`, cad/agent-drawing-gen.ts).
 * Každý řádek se před zápisem přečte stejným rozborem jako konzole (`parseAgentText`) a porovná s očekávaným povelem;
 * co zapsat nejde (volby jen z JSON – místo pro kóty, značky svarů; model ze záložky; umístění bez známé výšky listu),
 * ohlásí poznámka (ℹ v protokolu a komentář ve skriptu).
 *
 * Čistý modul bez jádra a bez prohlížeče (výšku listu s automatickým formátem dodá jádro – doc-script-fresh.ts).
 */
import { parseAgentText } from "./agent";
import type { DrawingOptions, DetailView, ModelView, RevisionItem, GenEdit, DrawingMeta } from "./drawing";
import type { AuxViewOpt, CutSectionOpt, ViewBreakOpt } from "./drawing-views";
import { tr } from "./i18n";
import type { CadDoc, DrawingDoc, Vec2 } from "./types";

/** výstup převodníku, do kterého se zapisuje (doc-script.ts Ctx) */
export type SheetOut = {
  li: 0 | 1 | 2;
  line(s: string): void;
  note(s: string): void;
  /** číslo bez exponentu (scriptNum) */
  n(v: number): string;
  /** text jako jeden token (scriptQuote) */
  q(s: string, always?: boolean): string | null;
};
type Rec = Record<string, unknown>;
type W3 = readonly [string, string, string];
const L = (cs: string, en: string, de: string): W3 => [cs, en, de];

const WD = {
  drawing: L("výkres", "drawing", "zeichnung"),
  title: L("razítko", "titleblock", "schriftfeld"),
  rev: L("revize", "revision", "revision"),
  revMarks: L("značky", "marks", "dreiecke"),
  yes: L("ano", "yes", "ja"),
  no: L("ne", "no", "nein"),
  date: L("datum", "date", "datum"),
  author: L("kreslil", "author", "ersteller"),
  functional: L("funkční", "functional", "funktional"),
  holes: L("díry", "holes", "bohrungen"),
  springs: L("pružiny", "springs", "federn"),
  springsFull: L("plně", "full", "voll"),
  springsSimple: L("zjednodušeně", "simplified", "vereinfacht"),
  model: L("model", "model", "modell"),
  view: L("pohled", "view", "ansicht"),
  scale: L("měřítko", "scale", "maßstab"),
  detail: L("detail", "detail", "detail"),
  at: L("v", "at", "bei"),
  radius: L("poloměr", "radius", "radius"),
  place: L("umístit", "place", "platzieren"),
  aux: L("pomocný", "aux", "hilfsansicht"),
  edge: L("hrana", "edge", "kante"),
  face: L("plocha", "face", "fläche"),
  dir: L("směr", "direction", "richtung"),
  along: L("podél", "along", "entlang"),
  normal: L("kolmo", "normal", "senkrecht"),
  flip: L("otočit", "flip", "umkehren"),
  section: L("řez", "section", "schnitt"),
  stepped: L("zalomený", "stepped", "abgesetzt"),
  aligned: L("natočený", "aligned", "gedreht"),
  partial: L("částečný", "partial", "teilschnitt"),
  points: L("body", "points", "punkte"),
  depth: L("hloubka", "depth", "tiefe"),
  spline: L("křivka", "spline", "kurve"),
  brk: L("přerušení", "break", "unterbrechung"),
  from: L("od", "from", "von"),
  to: L("do", "to", "bis"),
  gap: L("mezera", "gap", "lücke"),
  wave: L("vlnovka", "wave", "welle"),
  zigzag: L("cikcak", "zigzag", "zickzack"),
  fit: L("uložení", "fit", "passung"),
  show: L("zobrazení", "show", "anzeige"),
  table: L("tabulka", "table", "tabelle"),
  gen: L("vygenerované", "generated", "generiert"),
  hide: L("skrýt", "hide", "ausblenden"),
  move: L("posun", "move", "verschieben"),
};
type WK = keyof typeof WD;
const VIEW_W: Record<string, W3> = {
  front: L("přední", "front", "vorne"),
  back: L("zadní", "back", "hinten"),
  top: L("horní", "top", "oben"),
  bottom: L("spodní", "bottom", "unten"),
  left: L("levý", "left", "links"),
  right: L("pravý", "right", "rechts"),
  iso: L("iso", "iso", "iso"),
};
const HOLE_W: Record<string, W3> = { table: L("tabulka", "table", "tabelle"), ordinate: L("souřadnicově", "ordinate", "koordinaten"), chain: L("řetězově", "chain", "kette") };
const FIT_SHOW_W: Record<string, W3> = { dev: L("odchylky", "deviations", "abmasse"), limits: L("mezní", "limits", "grenzmasse"), code: L("značka", "code", "kurzzeichen") };
const TEMPLATE_W: Record<string, W3> = { iso7200: L("iso7200", "iso7200", "iso7200"), compact: L("kompaktní", "compact", "kompakt"), toolmaker: L("nástrojářská", "toolmaker", "werkzeugbau") };
/** pole razítka v pořadí zápisu (klíč údajů listu → klíč příkazu cs / en / de – cad/agent-title.ts TITLE_WORDS) */
const TITLE_FIELDS: [string, W3][] = [
  ["template", L("šablona", "template", "vorlage")],
  ["name", L("název", "name", "benennung")],
  ["number", L("číslo", "number", "nummer")],
  ["author", L("kreslil", "author", "ersteller")],
  ["checkedBy", L("kontroloval", "checked", "geprüft")],
  ["approvedBy", L("schválil", "approved", "genehmigt")],
  ["revision", L("revize", "revision", "revision")],
  ["date", L("datum", "date", "datum")],
  ["company", L("firma", "company", "unternehmen")],
  ["customer", L("zákazník", "customer", "kunde")],
  ["project", L("projekt", "project", "projekt")],
  ["stock", L("polotovar", "stock", "rohteil")],
  ["quantity", L("počet", "quantity", "menge")],
  ["heatTreatment", L("tepelné", "heat-treatment", "wärmebehandlung")],
  ["surfaceTreatment", L("povrch", "surface", "oberflächenbehandlung")],
  ["tolerance", L("nepředepsané", "general", "allgemeintoleranz")],
  ["angleTol", L("úhly", "angles", "winkel")],
  ["chamferTol", L("sražení", "chamfers", "fasen")],
  ["edges", L("hrany", "edges", "kanten")],
  ["note", L("poznámka", "note", "hinweis")],
];
/** největší logo zapsané do skriptu (data URL na řádku) */
const LOGO_MAX = 512 * 1024;
/** formáty listu (drawing.ts SHEETS – hlídá test) */
export const SCRIPT_SHEETS: Record<string, [number, number]> = { A4: [297, 210], A3: [420, 297], A2: [594, 420], A1: [841, 594], A0: [1189, 841] };
/** písmena pomocných pohledů a řezů lomenou čarou / detailů (drawing-views-agent.ts nextViewLetter, drawing-agent.ts detail) */
const VIEW_LETTERS = "BCDEFGHJKLMNPRSTUVWXYZ".split("");
const DETAIL_LETTERS = "ABCDEFGHJKLMNPRSTUVWXYZ".split("");

/** volby listu bez textového příkazu (nastavují se jen v JSON dokumentu) */
export const SHEET_JSON_ONLY = ["dimRoom", "dimRoomMin", "weldSymbols"];
/** volby listu, které zapisuje převodník (doc-script.ts + tento modul) nebo počítá aplikace sama */
const SHEET_KNOWN = new Set([
  ...["sheet", "orientation", "scale", "projection", "views", "hidden", "section", "centerLines", "dimensions", "dimStyle", "balloons", "bomTable", "holeTable", "springTable", "rotation", "zones"],
  ...["springs", "dimFunctional", "dimHoles", "details", "models", "aux", "cuts", "brokenOut", "breaks", "fitShow", "fitTable", "genEdit", "smartOff"],
  // vnitřní (zapíše je výpočet listu): otisk generování Chytrých kót, místo pro kóty po pohledech, měřítko mezery přerušení, pohled tabulky děr
  ...["smartGen", "dimPads", "breakScale", "holeTableView"],
]);
/** nastavené volby listu, které skript nepřenese (jen JSON nebo neznámé) */
export const sheetUnwritable = (o: Rec): string[] => Object.keys(o).filter((k) => o[k] !== undefined && !(Array.isArray(o[k]) && !(o[k] as unknown[]).length) && (SHEET_JSON_ONLY.includes(k) || !SHEET_KNOWN.has(k)));

const stable = (v: unknown): string => {
  if (Array.isArray(v)) return `[${v.map(stable).join(",")}]`;
  if (v && typeof v === "object")
    return `{${Object.keys(v as Rec)
      .filter((k) => (v as Rec)[k] !== undefined)
      .sort()
      .map((k) => `${JSON.stringify(k)}:${stable((v as Rec)[k])}`)
      .join(",")}}`;
  return typeof v === "number" ? (Object.is(v, -0) ? "0" : String(v)) : (JSON.stringify(v) ?? "null");
};
/** povel výkresu, který z řádku přečte konzole (null = řádek se nepřečte jako jeden povel výkresu) */
export function drawingCmdOf(line: string): Rec | null {
  try {
    const pr = parseAgentText(line);
    const op = pr.ops[0] as { k: string; cmd?: Rec } | undefined;
    return !pr.errors.length && pr.ops.length === 1 && op?.k === "drawingCmd" && op.cmd ? op.cmd : null;
  } catch {
    return null;
  }
}
const sameCmd = (line: string, want: unknown) => {
  const got = drawingCmdOf(line);
  return !!got && stable(got) === stable(want);
};
const w = (o: SheetOut, k: WK) => WD[k][o.li];
const head = (o: SheetOut) => w(o, "drawing");
const pt = (o: SheetOut, p: Vec2) => `${o.n(p[0])} ${o.n(p[1])}`;
/** bod pohledu (y dolů) ↔ bod agenta (y nahoru) – drawing-marks.ts viewToAgent */
const toAgent = (p: Vec2): Vec2 => [p[0], -p[1] || 0];
const scaleText = (o: SheetOut, s: number | "auto") => {
  if (s === "auto") return "auto";
  if (Number.isInteger(s)) return `${s}:1`;
  const inv = 1 / s;
  return Number.isInteger(inv) && 1 / inv === s ? `1:${inv}` : o.n(s);
};

/** výška listu (mm) pro převod umístění: pevný formát z voleb, automatický z jádra (`H`), jinak neznámá */
export function sheetHeight(opts: Rec, H?: number): number | undefined {
  const sh = typeof opts.sheet === "string" ? SCRIPT_SHEETS[opts.sheet] : undefined;
  if (sh) return opts.orientation === "portrait" ? sh[0] : sh[1];
  return H;
}

/* ───────────────────────── razítko a revize ───────────────────────── */

/** Tabulka revizí (před razítkem – každý řádek nastaví revizi v razítku) a razítko se všemi poli, šablonou a logem. */
export function emitTitle(o: SheetOut, doc: CadDoc, s: DrawingDoc): void {
  const meta = (s.meta ?? {}) as Partial<DrawingMeta> & Rec;
  const revs: RevisionItem[] = Array.isArray(meta.revisions) ? meta.revisions : [];
  let revAfter: string | undefined;
  for (const r of revs) {
    const rev = String(r.rev ?? "");
    const parts = [`${head(o)} ${w(o, "rev")} ${rev}`];
    const date = String(r.date ?? "");
    const nq = r.note ? o.q(r.note, true) : "";
    const dq = date ? o.q(date, true) : null;
    const aq = r.author ? o.q(r.author, true) : "";
    if (nq) parts.push(nq);
    if (dq) parts.push(`${w(o, "date")}=${dq}`);
    if (aq) parts.push(`${w(o, "author")}=${aq}`);
    const l = parts.join(" ");
    // datum aplikace bez zadání doplní dnešní, kreslil z razítka – prázdné se zapsat nedá
    const want = { k: "rev", op: "set", rev, note: r.note ?? "", date, ...(r.author ? { author: r.author } : {}) };
    if (nq === null || dq === null || aq === null || !sameCmd(l, want)) {
      o.note(tr("revizi „{0}“ listu „{1}“ nejde zapsat příkazem výkres revize (znak 1–4 písmena / číslice velkými, text na jeden řádek)", rev, s.name));
      continue;
    }
    o.line(l);
    revAfter = rev;
    if (typeof r.marks === "boolean") {
      const ml = `${head(o)} ${w(o, "rev")} ${rev} ${w(o, "revMarks")} ${w(o, r.marks ? "yes" : "no")}`;
      if (sameCmd(ml, { k: "views", cmd: { op: "rev-marks", rev, on: r.marks } })) o.line(ml);
      else o.note(tr("skrytí trojúhelníků revize „{0}“ listu „{1}“ nejde zapsat", rev, s.name));
    }
  }
  // razítko: pole, která se liší od výchozích (název = název dokumentu), šablona a nepředepsané tolerance (i tabulka)
  const parts: string[] = [];
  const want: Rec = {};
  for (const [key, words] of TITLE_FIELDS) {
    let v = meta[key];
    if (key === "template") {
      if (typeof v !== "string" || !v || v === "iso7200") continue;
      const tw = TEMPLATE_W[v];
      if (!tw) {
        o.note(tr("šablonu razítka „{0}“ listu „{1}“ nejde zapsat", String(v), s.name));
        continue;
      }
      parts.push(`${words[o.li]}=${tw[o.li]}`);
      want.template = tw[o.li];
      continue;
    }
    if (key === "revision") {
      // revizi nastavují řádky tabulky revizí (poslední) – v razítku jen jiná nebo výslovně prázdná (= poslední z tabulky)
      if (typeof v !== "string" || v === (revAfter ?? "")) continue;
    } else if (typeof v !== "string" || !v || (key === "name" && v === doc.name)) continue;
    const q = o.q(v as string, true);
    if (!q) {
      o.note(tr("údaj razítka „{0}“ listu „{1}“ nejde zapsat na řádek", key, s.name));
      continue;
    }
    parts.push(`${words[o.li]}=${q}`);
    want[key] = v;
  }
  if (parts.length) {
    const l = `${head(o)} ${w(o, "title")} ${parts.join(" ")}`;
    if (sameCmd(l, { k: "title", fields: want })) o.line(l);
    else o.note(tr("razítko listu „{0}“ se nepodařilo zapsat", s.name));
  }
  // logo: data URL na samostatném řádku (zmenší ho a obrys pro DXF / DWG spočítá aplikace znovu – stejný obrázek)
  const logo = meta.logo;
  if (logo?.src) {
    const l = `${head(o)} ${w(o, "title")} logo=${o.q(logo.src, true) ?? ""}`;
    if (logo.src.length <= LOGO_MAX && /^data:image\//i.test(logo.src) && sameCmd(l, { k: "title", fields: { logo: logo.src } })) {
      o.line(l);
      if (logo.name) o.note(tr("logo razítka „{0}“ listu „{1}“ je ve skriptu jako data URL – název souboru se nepřenáší", logo.name, s.name));
    } else o.note(tr("logo razítka listu „{0}“ nejde zapsat na řádek skriptu (data URL přes {1} kB) – vložte ho znovu: výkres razítko logo=\"soubor.png\"", s.name, Math.round(LOGO_MAX / 1024)));
  }
}

/* ───────────────────────── volby listu a kóty ───────────────────────── */

/** volby řádku `výkres …` navíc: pružiny plně / zjednodušeně (`keys` = co řádek nastavuje, kontrola rozborem) */
export function sheetLineExtra(o: SheetOut, opts: Rec): { parts: string[]; keys: string[] } {
  if (opts.springs !== "full" && opts.springs !== "simple") return { parts: [], keys: [] };
  return { parts: [`${w(o, "springs")} ${w(o, opts.springs === "full" ? "springsFull" : "springsSimple")}`], keys: ["springs"] };
}

/** konec řádku `kótovat …`: funkční rozměry a polohy děr (`funkční 26.5 74.175 díry tabulka`) */
export function dimTail(o: SheetOut, opts: Rec): string {
  let t = "";
  const fn = Array.isArray(opts.dimFunctional) ? (opts.dimFunctional as unknown[]).filter((x): x is number => typeof x === "number" && x > 0) : [];
  if (fn.length) t += ` ${w(o, "functional")} ${fn.map(o.n).join(" ")}`;
  const h = typeof opts.dimHoles === "string" ? HOLE_W[opts.dimHoles] : undefined;
  if (h) t += ` ${w(o, "holes")} ${h[o.li]}`;
  return t;
}
/** řádek `kótovat …` dává povel s funkčními rozměry a polohami děr listu */
export function dimTailOk(line: string, opts: Rec): boolean {
  const cmd = drawingCmdOf(line);
  if (!cmd || cmd.k !== "dim") return false;
  const fn = Array.isArray(opts.dimFunctional) ? (opts.dimFunctional as number[]) : [];
  return stable(cmd.functional ?? []) === stable(fn) && (cmd.holes ?? undefined) === (typeof opts.dimHoles === "string" && opts.dimHoles !== "auto" ? opts.dimHoles : undefined);
}

/* ───────────────────────── pohledy navíc ───────────────────────── */

/** odkaz na pohled listu jako text: přední… · řez (A–A) · řez B · pomocný B · "model" (`labels` = písmena po přečtení) */
function viewText(o: SheetOut, key: string, models: ModelView[], labels: Map<string, string>): string | null {
  const v = VIEW_W[key];
  if (v) return v[o.li];
  if (key === "section") return w(o, "section");
  const m = /^(aux|cut):([A-Z])$/.exec(key);
  if (m) {
    const l = labels.get(key) ?? m[2];
    return m[1] === "aux" ? `${w(o, "aux")} ${l}` : `${w(o, "section")} ${l}`;
  }
  if (key.startsWith("m:")) {
    const mv = models.find((x) => `m:${x.id}` === key);
    return mv ? o.q(mv.name, true) : null;
  }
  return null;
}
/** povel `výkres model …` v rozboru: pohled modelu na listu */
function viewRefOf(key: string, models: ModelView[], labels: Map<string, string>): string | null {
  if (VIEW_W[key] || key === "section") return key;
  const m = /^(aux|cut):([A-Z])$/.exec(key);
  if (m) return `${m[1]}:${labels.get(key) ?? m[2]}`;
  const mv = key.startsWith("m:") ? models.find((x) => `m:${x.id}` === key) : undefined;
  return mv ? `model:${mv.name}` : null;
}

/**
 * Pohledy navíc v pořadí, ve kterém je aplikace pojmenuje stejnými písmeny: další modely, pomocné pohledy, řezy lomenou čarou
 * a detaily (písmeno = první volné), částečné řezy, přerušení, zobrazení uložení a Tabulka uložení. `H` = výška listu (mm)
 * pro převod umístění („umístit x y“ od levého dolního rohu); neznámá = umístění se nezapíše (pohled dá aplikace sama).
 */
export function emitSheetViews(o: SheetOut, doc: CadDoc, s: DrawingDoc, H: number | undefined): void {
  const opts = (s.options ?? {}) as Partial<DrawingOptions>;
  const models = opts.models ?? [];
  const labels = new Map<string, string>();
  const bad = (what: string) => o.note(tr("{0} listu „{1}“ nejde zapsat textem – doplňte ho ručně", what, s.name));
  const emit = (l: string | null, want: unknown, what: string): boolean => {
    if (l !== null && sameCmd(l, want)) {
      o.line(l);
      return true;
    }
    bad(what);
    return false;
  };
  let noPlace = 0;
  const place = (at: Vec2 | undefined, dx = 0): Vec2 | undefined => {
    if (!at) return undefined;
    if (H === undefined) {
      noPlace++;
      return undefined;
    }
    return [at[0] + dx, H - (at[1] + dx)];
  };

  // další modely na listu (komponenta sestavy podle názvu; model ze záložky skript neotevře)
  for (const m of models) {
    const what = tr("model „{0}“", m.name);
    if (m.source.kind !== "component") {
      o.note(tr("model „{0}“ na listu „{1}“ je ze záložky (jiný dokument) – skript ho nepřenese; otevřete dokument a napište výkres model \"{0}\"", m.name, s.name));
      continue;
    }
    const first = (doc.components ?? []).find((c) => c.name.toLowerCase() === m.name.toLowerCase());
    if (!first || first.id !== m.source.compId) {
      o.note(tr("model „{0}“ na listu „{1}“: komponenta s tímto názvem je v sestavě víckrát nebo chybí – skript vloží první z nich", m.name, s.name));
      if (!first) continue;
    }
    const q = o.q(m.name, true);
    const vw = VIEW_W[m.view];
    const l = q && vw ? `${head(o)} ${w(o, "model")} ${q} ${w(o, "view")} ${vw[o.li]} ${w(o, "scale")} ${scaleText(o, m.scale)}` : null;
    emit(l, { k: "model", op: "add", name: m.name, view: m.view, scale: m.scale }, what);
  }

  // pomocné pohledy, řezy lomenou čarou a detaily: pořadí, ve kterém dostanou stejná písmena
  type It = { kind: "aux"; v: AuxViewOpt } | { kind: "cut"; v: CutSectionOpt } | { kind: "detail"; v: DetailView };
  const qs: It[][] = [(opts.aux ?? []).map((v) => ({ kind: "aux" as const, v })), (opts.cuts ?? []).map((v) => ({ kind: "cut" as const, v })), (opts.details ?? []).map((v) => ({ kind: "detail" as const, v }))];
  const usedView = new Set<string>();
  const usedDet = new Set<string>();
  let renamed = false;
  while (qs.some((x) => x.length)) {
    const nextView = VIEW_LETTERS.find((l) => !usedView.has(l) && !usedDet.has(l)) ?? "Z";
    const nextDet = DETAIL_LETTERS.find((l) => !usedDet.has(l)) ?? "A";
    let it = qs.find((x) => x.length && (x[0].kind === "detail" ? x[0].v.label === nextDet : x[0].v.label === nextView))?.shift();
    if (!it) {
      it = qs.find((x) => x.length)!.shift()!;
      renamed = true;
    }
    const given = it.kind === "detail" ? nextDet : nextView;
    const key = it.kind === "detail" ? `detail:${it.v.label}` : `${it.kind}:${it.v.label}`;
    labels.set(key, given);
    (it.kind === "detail" ? usedDet : usedView).add(given);
    if (it.kind === "aux") {
      const a = it.v;
      const what = tr("pomocný pohled {0}", a.label);
      const parent = a.parent ? viewText(o, a.parent, models, labels) : "";
      const at = place(a.at);
      let l: string | null = parent === null ? null : `${head(o)} ${w(o, "view")} ${w(o, "aux")}${parent ? ` ${parent}` : ""}`;
      const want: Rec = { op: "aux", ...(a.parent ? { parent: viewRefOf(a.parent, models, labels) } : {}) };
      if (a.edge) {
        const e: [Vec2, Vec2] = [toAgent(a.edge[0]), toAgent(a.edge[1])];
        l += ` ${w(o, "edge")} ${pt(o, e[0])} ${pt(o, e[1])}`;
        want.edge = e;
      }
      if (a.face != null) {
        l += ` ${w(o, "face")} F${a.face}`;
        want.face = a.face;
      }
      if (a.dir) {
        l += ` ${w(o, "dir")} ${a.dir.map(o.n).join(" ")}`;
        want.dir = a.dir;
      }
      if (a.mode) {
        l += ` ${w(o, a.mode === "along" ? "along" : "normal")}`;
        want.mode = a.mode;
      }
      if (a.flip) {
        l += ` ${w(o, "flip")}`;
        want.flip = true;
      }
      if (at) {
        l += ` ${w(o, "place")} ${pt(o, at)}`;
        want.place = at;
      }
      emit(parent === null ? null : l, { k: "views", cmd: want }, what);
    } else if (it.kind === "cut") {
      const c = it.v;
      const parent = viewText(o, c.parent, models, labels);
      const pts = c.pts.map(toAgent);
      const at = place(c.at);
      const l = parent === null ? null : `${head(o)} ${w(o, "section")} ${w(o, c.kind === "aligned" ? "aligned" : "stepped")} ${parent} ${w(o, "points")} ${pts.map((p) => pt(o, p)).join(" ")}${c.flip ? ` ${w(o, "flip")}` : ""}${at ? ` ${w(o, "place")} ${pt(o, at)}` : ""}`;
      emit(l, { k: "views", cmd: { op: "cut", kind: c.kind, parent: viewRefOf(c.parent, models, labels), pts, ...(c.flip ? { flip: true } : {}), ...(at ? { place: at } : {}) } }, tr("řez {0}–{0}", c.label));
    } else {
      const d = it.v;
      const view = viewText(o, d.view, models, labels);
      const c = toAgent([d.cx, d.cy]);
      const at = place(d.at, d.r * d.scale);
      const l = view === null ? null : `${head(o)} ${w(o, "detail")} ${view} ${w(o, "at")} ${pt(o, c)} ${w(o, "radius")} ${o.n(d.r)} ${w(o, "scale")} ${scaleText(o, d.scale)}${at ? ` ${w(o, "place")} ${pt(o, at)}` : ""}`;
      emit(l, { k: "detail", op: "add", view: viewRefOf(d.view, models, labels), at: c, r: d.r, scale: d.scale, ...(at ? { place: at } : {}) }, tr("detail {0}", d.label));
    }
  }
  if (renamed) o.note(tr("písmena pomocných pohledů, řezů a detailů listu „{0}“ dostane po přečtení skriptu aplikace znovu – po smazání některých se mohou lišit: {1}", s.name, [...labels].filter(([k, v]) => k.slice(k.indexOf(":") + 1) !== v).map(([k, v]) => `${k.slice(k.indexOf(":") + 1)} → ${v}`).join(", ") || "—"));
  if (noPlace) o.note(tr("umístění {0} pohledů / detailů listu „{1}“ s automatickým formátem se bez jádra nezapíše (výšku listu zná jen jádro – export skript v aplikaci a v CLI ho zapíše) – pohledy umístí aplikace sama", noPlace, s.name));

  // částečné řezy a přerušení
  for (const b of opts.brokenOut ?? []) {
    const view = viewText(o, b.view, models, labels);
    const pts = b.pts.map(toAgent);
    const l = view === null ? null : `${head(o)} ${w(o, "section")} ${w(o, "partial")} ${view} ${w(o, "points")} ${pts.map((p) => pt(o, p)).join(" ")} ${w(o, "depth")} ${o.n(b.depth)}${b.spline ? ` ${w(o, "spline")}` : ""}`;
    emit(l, { k: "views", cmd: { op: "bo", view: viewRefOf(b.view, models, labels), pts, depth: b.depth, ...(b.spline ? { spline: true } : {}) } }, tr("částečný řez"));
  }
  for (const b of opts.breaks ?? ([] as ViewBreakOpt[])) {
    const view = viewText(o, b.view, models, labels);
    const l = view === null ? null : `${head(o)} ${w(o, "brk")} ${view} ${b.axis} ${w(o, "from")} ${o.n(b.from)} ${w(o, "to")} ${o.n(b.to)}${b.gap !== undefined ? ` ${w(o, "gap")} ${o.n(b.gap)}` : ""}${b.style ? ` ${w(o, b.style === "wave" ? "wave" : "zigzag")}` : ""}`;
    emit(l, { k: "views", cmd: { op: "break", view: viewRefOf(b.view, models, labels), axis: b.axis, from: Math.min(b.from, b.to), to: Math.max(b.from, b.to), ...(b.gap !== undefined ? { gap: b.gap } : {}), ...(b.style ? { style: b.style } : {}) } }, tr("přerušení"));
  }
  // uložení ISO 286: zobrazení úchylek a Tabulka uložení (pole tolerance u kót se zapisují s kótami – ruční úpravy kót viz poznámky)
  if (opts.fitShow && FIT_SHOW_W[opts.fitShow]) emit(`${head(o)} ${w(o, "fit")} ${w(o, "show")} ${FIT_SHOW_W[opts.fitShow][o.li]}`, { k: "views", cmd: { op: "fit-show", show: opts.fitShow } }, tr("zobrazení uložení"));
  if (typeof opts.fitTable === "boolean") emit(`${head(o)} ${w(o, "fit")} ${w(o, "table")} ${w(o, opts.fitTable ? "yes" : "no")}`, { k: "views", cmd: { op: "fit-table", on: opts.fitTable } }, tr("Tabulka uložení"));
}

/** Upravené vygenerované kóty celkových rozměrů a pozice (po `kótovat …`, kdy na listu jsou): skryté a posunuté. */
export function emitGenEdit(o: SheetOut, s: DrawingDoc): void {
  const g = (s.options as { genEdit?: GenEdit } | undefined)?.genEdit;
  // kóty pohledů a pozice listu; kóta pohledu dalšího modelu (dim:m:<id>:…) nese id modelu, které se po přečtení změní
  const KEY = /^(dim:[a-z]+:[tl]|pos:\d+)$/;
  const off = (g?.off ?? []).filter((k) => KEY.test(k));
  const what = tr("úprava vygenerovaných kót a pozic");
  const lost = [...(g?.off ?? []), ...Object.keys(g?.move ?? {})].filter((k) => !KEY.test(k));
  if (lost.length) o.note(tr("{0} listu „{1}“ nejde zapsat textem – doplňte ho ručně", `${what} (${lost.join(", ")})`, s.name));
  if (off.length) {
    const l = `${head(o)} ${w(o, "gen")} ${w(o, "hide")} ${off.join(" ")}`;
    if (sameCmd(l, { k: "views", cmd: { op: "gen", act: "hide", keys: off } })) o.line(l);
    else o.note(tr("{0} listu „{1}“ nejde zapsat textem – doplňte ho ručně", what, s.name));
  }
  for (const [k, d] of Object.entries(g?.move ?? {})) {
    if (!KEY.test(k) || (!d[0] && !d[1])) continue;
    // uložený posun je v mm listu y dolů, příkaz píše y nahoru
    const up: Vec2 = [d[0] || 0, -d[1] || 0];
    const l = `${head(o)} ${w(o, "gen")} ${w(o, "move")} ${k} ${pt(o, up)}`;
    if (sameCmd(l, { k: "views", cmd: { op: "gen", act: "move", keys: [k], d: up } })) o.line(l);
    else o.note(tr("{0} listu „{1}“ nejde zapsat textem – doplňte ho ručně", what, s.name));
  }
}
