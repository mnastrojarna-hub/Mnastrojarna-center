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
 * co zapsat nejde (volby jen z JSON – místo pro kóty, značky svarů; model ze záložky; pohled, jehož základní pohled na listu
 * není), ohlásí poznámka (ℹ v protokolu a komentář ve skriptu).
 *
 * Skript se píše proti stavu, který bude mít dokument PŘI ČTENÍ skriptu (kontrola vlny E):
 *  - razítko: nový list (`výkres list nový`) převezme údaje aktivního listu, první list výkresu popisové údaje dokumentu –
 *    zapisuje se rozdíl proti tomu (i vyprázdnění: `číslo=""`, `šablona=iso7200`, `logo=ne`), a popisové údaje dokumentu
 *    (číslo, kreslil, revize) se na konci dorovnají (`TitleState`),
 *  - pohledy navíc: nejdřív pohled, na který se odkazuje, pak pohled z něj (písmena podle toho, jak je aplikace přidělí),
 *  - umístění na listu s automatickým formátem od levého horního rohu (`umístit x y odshora`) – výška listu se při čtení mění,
 *  - upravené vygenerované kóty a pozice jen ty, které na listu jsou (klíče ověří jádro – doc-script-fresh.ts).
 *
 * Čistý modul bez jádra a bez prohlížeče.
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
  sheet: L("list", "sheet", "blatt"),
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
  placeTop: L("odshora", "from-top", "von-oben"),
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

/** výška listu (mm) s pevným formátem; automatický formát = undefined (výška se mění s pohledy – umístění se píše „odshora“) */
export function sheetHeight(opts: Rec): number | undefined {
  const sh = typeof opts.sheet === "string" ? SCRIPT_SHEETS[opts.sheet] : undefined;
  return sh ? (opts.orientation === "portrait" ? sh[0] : sh[1]) : undefined;
}
/** pohledy listu zapnuté ve volbách (výchozí drawing.ts defaultDrawingOptions.views – hlídá test) */
export const SCRIPT_DEFAULT_VIEWS: Record<string, boolean> = { front: true, top: true, left: true, right: false, back: false, bottom: false, iso: true };
const viewsOn = (opts: Rec): Record<string, boolean> => ({ ...SCRIPT_DEFAULT_VIEWS, ...((opts.views as Record<string, boolean> | undefined) ?? {}) });

/* ───────────────────────── razítko a revize ───────────────────────── */

const str = (v: unknown): string => (typeof v === "string" ? v : "");
/** údaje razítka, které nový list převezme z aktivního (title-block.ts INHERITED_TITLE – hlídá test) */
export const SCRIPT_INHERITED_TITLE = ["name", "number", "author", "revision", "date", "tolerance", "tolTable", "template", "logo", "company", "customer", "project", "checkedBy", "approvedBy", "quantity", "stock", "heatTreatment", "surfaceTreatment", "angleTol", "chamferTol", "edges"];
/** popisové údaje dokumentu, které nastavuje řádek razítka (drawing-agent.ts case "title") */
const PROP_KEYS = ["number", "author", "revision"] as const;
type PropKey = (typeof PROP_KEYS)[number];

/**
 * Stav razítek při čtení skriptu – co dokument ponese po řádcích zapsaných dosud. Skript se píše proti němu: zapisuje se
 * jen to, co se od něj liší (i vyprázdnění zděděného pole), a na konci se dorovnají popisové údaje dokumentu.
 */
export type TitleState = {
  /** název dokumentu po přečtení skriptu (název záložky – výchozí název razítka) */
  docName: string;
  /** popisové údaje dokumentu (`doc.props`): nastavuje je `výkres razítko číslo= kreslil= revize=` */
  props: Record<PropKey, string>;
  /** zapsané listy: údaje razítka po přečtení, výkres (pořadové číslo) a pořadí listu v něm (`výkres list N`) */
  sheets: { name: string; meta: Rec; set: number; pos: number }[];
};
export const titleState = (docName: string): TitleState => ({ docName, props: { number: "", author: "", revision: "" }, sheets: [] });

/**
 * Údaje razítka listu hned po jeho založení při čtení skriptu: `new` = první list výkresu (drawing-agent.ts newSheet: název
 * dokumentu a jeho popisové údaje; výchozí šablona ISO 7200), `sheet` = `výkres list nový` (převezme údaje aktivního =
 * naposledy zapsaného listu, title-block.ts inheritTitle), `same` = list se založit nepodařilo, řádky míří na předchozí.
 */
function titleBase(st: TitleState, how: "new" | "sheet" | "same"): Rec {
  const prev = st.sheets[st.sheets.length - 1]?.meta;
  if (!prev || how === "new") return { name: st.docName, number: st.props.number, author: st.props.author, revision: st.props.revision, tolerance: "" };
  if (how === "same") return { ...prev };
  const m: Rec = {};
  for (const k of SCRIPT_INHERITED_TITLE) if (prev[k] !== undefined) m[k] = prev[k];
  return { ...m, name: prev.name ?? st.docName, number: prev.number ?? "", author: prev.author ?? "", revision: prev.revision ?? "", date: prev.date ?? "", tolerance: prev.tolerance ?? "" };
}

/**
 * Tabulka revizí (před razítkem – každý řádek nastaví revizi v razítku) a razítko: pole, šablona a logo, které se liší od
 * toho, co list ponese při čtení skriptu (`how` – viz titleBase); list se zapíše do stavu `st`.
 */
export function emitTitle(o: SheetOut, doc: CadDoc, s: DrawingDoc, st: TitleState, how: "new" | "sheet" | "same" = "new"): void {
  const meta = (s.meta ?? {}) as Partial<DrawingMeta> & Rec;
  /** údaje listu po řádcích zapsaných dosud */
  const M = titleBase(st, how);
  const last = st.sheets[st.sheets.length - 1];
  const at = how === "same" && last ? last : how === "sheet" && last ? { set: last.set, pos: st.sheets.filter((x) => x.set === last.set).length + 1 } : { set: (last?.set ?? 0) + 1, pos: 1 };
  const revs: RevisionItem[] = Array.isArray(meta.revisions) ? meta.revisions : [];
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
    M.revision = rev;
    // řádek revize bez autora dostane při čtení autora z razítka listu (zděděného z předchozího listu) – prázdného zapsat nejde
    if (!r.author && str(M.author)) o.note(tr("revize „{0}“ listu „{1}“ nemá autora – po přečtení skriptu dostane autora z razítka („{2}“)", rev, s.name, str(M.author)));
    if (typeof r.marks === "boolean") {
      const ml = `${head(o)} ${w(o, "rev")} ${rev} ${w(o, "revMarks")} ${w(o, r.marks ? "yes" : "no")}`;
      if (sameCmd(ml, { k: "views", cmd: { op: "rev-marks", rev, on: r.marks } })) o.line(ml);
      else o.note(tr("skrytí trojúhelníků revize „{0}“ listu „{1}“ nejde zapsat", rev, s.name));
    }
  }
  // razítko: pole, která se liší od stavu listu při čtení (zděděné pole i vyprázdnit), šablona, nepředepsané tolerance (i tabulka)
  const parts: string[] = [];
  const want: Rec = {};
  const set: Rec = {};
  for (const [key, words] of TITLE_FIELDS) {
    if (key === "template") {
      const v = str(meta.template) || "iso7200";
      if (v === (str(M.template) || "iso7200")) continue;
      const tw = TEMPLATE_W[v];
      if (!tw) {
        o.note(tr("šablonu razítka „{0}“ listu „{1}“ nejde zapsat", v, s.name));
        continue;
      }
      parts.push(`${words[o.li]}=${tw[o.li]}`);
      want.template = tw[o.li];
      set.template = v === "iso7200" ? undefined : v;
      continue;
    }
    let v = str(meta[key]);
    if (key === "name") {
      // prázdný název = název dokumentu (drawing-agent.ts sheetMeta); díl sestavy se ve skriptu může jmenovat jinak (záložka)
      if ((v || doc.name) === (str(M.name) || st.docName)) continue;
      v = v || (doc.name === st.docName ? "" : doc.name);
    } else if (v === str(M[key])) continue; // revizi nastavily řádky tabulky revizí (poslední)
    const q = o.q(v, true);
    if (!q) {
      o.note(tr("údaj razítka „{0}“ listu „{1}“ nejde zapsat na řádek", key, s.name));
      continue;
    }
    parts.push(`${words[o.li]}=${q}`);
    want[key] = v;
    set[key] = v;
    if (key === "tolerance") set.tolTable = meta.tolTable;
  }
  // popisové údaje dokumentu (číslo, kreslil, revize – výchozí pro nový výkres, ukládají se se souborem) nastavuje jen řádek
  // razítka: pole, které má list stejné jako dokument a dokument by ho po přečtení neměl, se zapíše také (pro list beze změny)
  for (const key of PROP_KEYS) {
    const v = str(doc.props?.[key]);
    if (key in want || st.props[key] === v || str(meta[key]) !== v) continue;
    const q = o.q(v, true);
    const words = TITLE_FIELDS.find(([k]) => k === key)![1];
    if (!q) continue;
    parts.push(`${words[o.li]}=${q}`);
    want[key] = v;
  }
  if (parts.length) {
    const l = `${head(o)} ${w(o, "title")} ${parts.join(" ")}`;
    if (sameCmd(l, { k: "title", fields: want })) {
      o.line(l);
      Object.assign(M, set);
      for (const key of PROP_KEYS) if (key in want) st.props[key] = str(want[key]);
    } else o.note(tr("razítko listu „{0}“ se nepodařilo zapsat", s.name));
  }
  // logo: data URL na samostatném řádku (zmenší ho a obrys pro DXF / DWG spočítá aplikace znovu – stejný obrázek);
  // logo převzaté z předchozího listu se znovu nepíše, zděděné logo listu bez loga se odstraní
  const logo = meta.logo;
  const cur = str((M.logo as { src?: unknown } | undefined)?.src);
  if (logo?.src && logo.src !== cur) {
    const l = `${head(o)} ${w(o, "title")} logo=${o.q(logo.src, true) ?? ""}`;
    if (logo.src.length <= LOGO_MAX && /^data:image\//i.test(logo.src) && sameCmd(l, { k: "title", fields: { logo: logo.src } })) {
      o.line(l);
      M.logo = logo;
      if (logo.name) o.note(tr("logo razítka „{0}“ listu „{1}“ je ve skriptu jako data URL – název souboru se nepřenáší", logo.name, s.name));
    } else o.note(tr("logo razítka listu „{0}“ nejde zapsat na řádek skriptu (data URL přes {1} kB) – vložte ho znovu: výkres razítko logo=\"soubor.png\"", s.name, Math.round(LOGO_MAX / 1024)));
  } else if (!logo?.src && cur) {
    const l = `${head(o)} ${w(o, "title")} logo=${w(o, "no")}`;
    if (sameCmd(l, { k: "title", fields: { logo: w(o, "no") } })) {
      o.line(l);
      delete M.logo;
    } else o.note(tr("razítko listu „{0}“ se nepodařilo zapsat", s.name));
  }
  if (how === "same" && last) last.meta = M;
  else st.sheets.push({ name: s.name, meta: M, ...at });
}

/**
 * Popisové údaje dokumentu (číslo, kreslil, revize) po všech listech: liší-li se od toho, co nastavily řádky razítek, zapíše
 * se řádek razítka na listu aktivního výkresu, který má pole stejné jako dokument (pro list beze změny), a aktivní zůstane
 * poslední list. Co dorovnat nejde (žádný list takové pole nemá), ohlásí poznámka.
 */
export function emitDocProps(o: SheetOut, doc: CadDoc, st: TitleState): void {
  const last = st.sheets[st.sheets.length - 1];
  if (!last) return;
  const want = (k: PropKey) => str(doc.props?.[k]);
  let open = PROP_KEYS.filter((k) => st.props[k] !== want(k));
  let moved = false;
  for (const sh of st.sheets) {
    if (!open.length) break;
    if (sh === last || sh.set !== last.set) continue;
    const keys = open.filter((k) => str(sh.meta[k]) === want(k) && o.q(want(k), true));
    if (!keys.length) continue;
    const sel = `${head(o)} ${w(o, "sheet")} ${sh.pos}`;
    const fields = Object.fromEntries(keys.map((k) => [k, want(k)]));
    const l = `${head(o)} ${w(o, "title")} ${keys.map((k) => `${TITLE_FIELDS.find(([x]) => x === k)![1][o.li]}=${o.q(want(k), true)}`).join(" ")}`;
    if (!sameCmd(sel, { k: "sheet", op: "select", ref: sh.pos }) || !sameCmd(l, { k: "title", fields })) continue;
    o.line(sel);
    o.line(l);
    moved = true;
    for (const k of keys) st.props[k] = want(k);
    open = open.filter((k) => !keys.includes(k));
  }
  const back = `${head(o)} ${w(o, "sheet")} ${last.pos}`;
  if (moved && sameCmd(back, { k: "sheet", op: "select", ref: last.pos })) o.line(back);
  if (open.length) o.note(tr("popisové údaje dokumentu „{0}“ ({1}) se liší od razítek listů – po přečtení skriptu je dokument ponese podle razítka ({2})", doc.name, open.map((k) => `${TITLE_FIELDS.find(([x]) => x === k)![1][o.li]} „${want(k)}“`).join(", "), open.map((k) => `„${st.props[k]}“`).join(", ")));
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
/** název pohledu do poznámky (pohled, který na listu není) */
function viewLabel(o: SheetOut, key: string, models: ModelView[]): string {
  return viewText(o, key, models, new Map()) ?? key;
}

/**
 * Pohledy navíc tak, aby je aplikace při čtení přijala a pojmenovala: další modely, pak pomocné pohledy, řezy lomenou čarou
 * a detaily v pořadí „nejdřív pohled, na který se odkazuje“ (pomocný pohled z řezu C až po řezu C) – z připravených se bere
 * ten, který dostane stejné písmeno jako v dokumentu (písmeno = první volné), jinak první v pořadí a písmena se ohlásí.
 * Pohled, řez, detail, částečný řez a přerušení, jejichž základní pohled na listu není (vypnutý pohled, smazaný řez –
 * aplikace je drží, ale nekreslí), se vynechají s poznámkou. Umístění: pevný formát od levého dolního rohu („umístit x y“),
 * automatický formát od levého horního („umístit x y odshora“ – výška listu se při čtení mění s každým dalším pohledem).
 */
export function emitSheetViews(o: SheetOut, doc: CadDoc, s: DrawingDoc): void {
  const opts = (s.options ?? {}) as Partial<DrawingOptions>;
  const models = opts.models ?? [];
  const H = sheetHeight(opts as Rec);
  const labels = new Map<string, string>();
  const bad = (what: string) => o.note(tr("{0} listu „{1}“ nejde zapsat textem – doplňte ho ručně", what, s.name));
  /** řádek, který rozbor přečte jako `want`; jinak poznámka a null */
  const checked = (l: string | null, want: unknown, what: string): string | null => {
    if (l !== null && sameCmd(l, want)) return l;
    bad(what);
    return null;
  };
  const emit = (l: string | null, want: unknown, what: string): boolean => {
    const ok = checked(l, want, what);
    if (ok !== null) o.line(ok);
    return ok !== null;
  };
  type Place = { p: Vec2; top: boolean };
  const place = (at: Vec2 | undefined, dx = 0): Place | undefined => (!at ? undefined : H === undefined ? { p: [at[0] + dx, at[1] + dx], top: true } : { p: [at[0] + dx, H - (at[1] + dx)], top: false });
  const placeText = (pl: Place | undefined) => (pl ? ` ${w(o, "place")} ${pt(o, pl.p)}${pl.top ? ` ${w(o, "placeTop")}` : ""}` : "");
  const placeWant = (pl: Place | undefined): Rec => (pl ? { place: pl.p, ...(pl.top ? { placeTop: true } : {}) } : {});
  // pohledy, které na listu při čtení budou: zapnuté pravoúhlé pohledy, řez A–A, zapsané modely a pohledy / řezy zapsané níže
  const on = viewsOn(opts as Rec);
  const onSheet = new Set<string>(Object.keys(VIEW_W).filter((k) => k !== "iso" && on[k]));
  if (opts.section) onSheet.add("section");
  const gone = (what: string, base: string) => o.note(tr("{0} listu „{1}“ visí na pohledu, který na listu není ({2}) – na listu se nekreslí a skript ho vynechá", what, s.name, viewLabel(o, base, models)));

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
    if (emit(l, { k: "model", op: "add", name: m.name, view: m.view, scale: m.scale }, what)) onSheet.add(`m:${m.id}`);
  }

  // pomocné pohledy, řezy lomenou čarou a detaily: nejdřív pohled, na který se odkazuje; písmena jako v dokumentu, jde-li to
  type It = { kind: "aux"; v: AuxViewOpt; base?: string } | { kind: "cut"; v: CutSectionOpt; base?: string } | { kind: "detail"; v: DetailView; base?: string };
  const keyOf = (it: It) => `${it.kind}:${it.v.label}`;
  const whatOf = (it: It) => (it.kind === "aux" ? tr("pomocný pohled {0}", it.v.label) : it.kind === "cut" ? tr("řez {0}–{0}", it.v.label) : tr("detail {0}", it.v.label));
  let pending: It[] = [
    ...(opts.aux ?? []).map((v): It => ({ kind: "aux", v, base: v.parent })),
    ...(opts.cuts ?? []).map((v): It => ({ kind: "cut", v, base: v.parent })),
    ...(opts.details ?? []).map((v): It => ({ kind: "detail", v, base: v.view })),
  ];
  /** písmena, která aplikace dá při čtení: pomocný pohled / řez = první volné mimo pohledy i detaily, detail = první volné mimo detaily */
  const letters = () => {
    const uv = new Set<string>();
    const ud = new Set<string>();
    return {
      next: (detail: boolean) => (detail ? (DETAIL_LETTERS.find((l) => !ud.has(l)) ?? "A") : (VIEW_LETTERS.find((l) => !uv.has(l) && !ud.has(l)) ?? "Z")),
      use: (detail: boolean, l: string) => (detail ? ud : uv).add(l),
    };
  };
  // 1) výběr a písmena: z připravených (pohled, na který se odkazuje, už je zapsaný) ten, který dostane své písmeno, jinak první
  const base0 = new Set(onSheet);
  const planned: { it: It; line: string; given: string }[] = [];
  const lt = letters();
  let renamed = false;
  while (pending.length) {
    const ready = pending.filter((it) => !it.base || onSheet.has(it.base));
    if (!ready.length) break;
    let it = ready.find((x) => x.v.label === lt.next(x.kind === "detail"));
    if (!it) {
      it = ready[0];
      renamed = true;
    }
    pending = pending.filter((x) => x !== it);
    const given = lt.next(it.kind === "detail");
    const key = keyOf(it);
    let ok: string | null = null;
    if (it.kind === "aux") {
      const a = it.v;
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
      l += placeText(at);
      ok = checked(parent === null ? null : l, { k: "views", cmd: { ...want, ...placeWant(at) } }, whatOf(it));
    } else if (it.kind === "cut") {
      const c = it.v;
      const parent = viewText(o, c.parent, models, labels);
      const pts = c.pts.map(toAgent);
      const at = place(c.at);
      const l = parent === null ? null : `${head(o)} ${w(o, "section")} ${w(o, c.kind === "aligned" ? "aligned" : "stepped")} ${parent} ${w(o, "points")} ${pts.map((p) => pt(o, p)).join(" ")}${c.flip ? ` ${w(o, "flip")}` : ""}${placeText(at)}`;
      ok = checked(l, { k: "views", cmd: { op: "cut", kind: c.kind, parent: viewRefOf(c.parent, models, labels), pts, ...(c.flip ? { flip: true } : {}), ...placeWant(at) } }, whatOf(it));
    } else {
      const d = it.v;
      const view = viewText(o, d.view, models, labels);
      const c = toAgent([d.cx, d.cy]);
      const at = place(d.at, d.r * d.scale);
      const l = view === null ? null : `${head(o)} ${w(o, "detail")} ${view} ${w(o, "at")} ${pt(o, c)} ${w(o, "radius")} ${o.n(d.r)} ${w(o, "scale")} ${scaleText(o, d.scale)}${placeText(at)}`;
      ok = checked(l, { k: "detail", op: "add", view: viewRefOf(d.view, models, labels), at: c, r: d.r, scale: d.scale, ...placeWant(at) }, whatOf(it));
    }
    if (ok === null) continue;
    // zapsaný pohled dostane při čtení písmeno `given` – pohledy a detaily z něj se na něj odkazují tímto písmenem
    labels.set(key, given);
    lt.use(it.kind === "detail", given);
    if (it.kind !== "detail") onSheet.add(key);
    planned.push({ it, line: ok, given });
  }
  for (const it of pending) gone(whatOf(it), it.base ?? "");
  // 2) pořadí zápisu: tentýž výběr znovu, ale nad písmeny, která pohledy při čtení dostanou (`given`) – tak je vybere i druhý
  //    export (dokument po přečtení skriptu), takže zapíše stejné řádky ve stejném pořadí. Písmena jsou stejná: pohled /
  //    detail s písmenem, které právě přijde na řadu, je vždy připravený; kdyby ne, zůstane pořadí z kroku 1.
  const order: typeof planned = [];
  const lt2 = letters();
  const on2 = new Set(base0);
  const kinds = ["aux", "cut", "detail"];
  let rest = [...planned].sort((a, b) => kinds.indexOf(a.it.kind) - kinds.indexOf(b.it.kind));
  while (rest.length) {
    const p = rest.find((x) => (!x.it.base || on2.has(x.it.base)) && x.given === lt2.next(x.it.kind === "detail"));
    if (!p) break;
    rest = rest.filter((x) => x !== p);
    lt2.use(p.it.kind === "detail", p.given);
    if (p.it.kind !== "detail") on2.add(keyOf(p.it));
    order.push(p);
  }
  for (const p of rest.length ? planned : order) o.line(p.line);
  if (renamed) o.note(tr("písmena pomocných pohledů, řezů a detailů listu „{0}“ dostane po přečtení skriptu aplikace znovu – po smazání některých se mohou lišit: {1}", s.name, [...labels].filter(([k, v]) => k.slice(k.indexOf(":") + 1) !== v).map(([k, v]) => `${k.slice(k.indexOf(":") + 1)} → ${v}`).join(", ") || "—"));

  // částečné řezy a přerušení
  for (const b of opts.brokenOut ?? []) {
    if (!onSheet.has(b.view)) {
      gone(tr("částečný řez"), b.view);
      continue;
    }
    const view = viewText(o, b.view, models, labels);
    const pts = b.pts.map(toAgent);
    const l = view === null ? null : `${head(o)} ${w(o, "section")} ${w(o, "partial")} ${view} ${w(o, "points")} ${pts.map((p) => pt(o, p)).join(" ")} ${w(o, "depth")} ${o.n(b.depth)}${b.spline ? ` ${w(o, "spline")}` : ""}`;
    emit(l, { k: "views", cmd: { op: "bo", view: viewRefOf(b.view, models, labels), pts, depth: b.depth, ...(b.spline ? { spline: true } : {}) } }, tr("částečný řez"));
  }
  for (const b of opts.breaks ?? ([] as ViewBreakOpt[])) {
    if (!onSheet.has(b.view)) {
      gone(tr("přerušení"), b.view);
      continue;
    }
    const view = viewText(o, b.view, models, labels);
    const l = view === null ? null : `${head(o)} ${w(o, "brk")} ${view} ${b.axis} ${w(o, "from")} ${o.n(b.from)} ${w(o, "to")} ${o.n(b.to)}${b.gap !== undefined ? ` ${w(o, "gap")} ${o.n(b.gap)}` : ""}${b.style ? ` ${w(o, b.style === "wave" ? "wave" : "zigzag")}` : ""}`;
    emit(l, { k: "views", cmd: { op: "break", view: viewRefOf(b.view, models, labels), axis: b.axis, from: Math.min(b.from, b.to), to: Math.max(b.from, b.to), ...(b.gap !== undefined ? { gap: b.gap } : {}), ...(b.style ? { style: b.style } : {}) } }, tr("přerušení"));
  }
  // uložení ISO 286: zobrazení úchylek a Tabulka uložení (pole tolerance u kót se zapisují s kótami – ruční úpravy kót viz poznámky)
  if (opts.fitShow && FIT_SHOW_W[opts.fitShow]) emit(`${head(o)} ${w(o, "fit")} ${w(o, "show")} ${FIT_SHOW_W[opts.fitShow][o.li]}`, { k: "views", cmd: { op: "fit-show", show: opts.fitShow } }, tr("zobrazení uložení"));
  if (typeof opts.fitTable === "boolean") emit(`${head(o)} ${w(o, "fit")} ${w(o, "table")} ${w(o, opts.fitTable ? "yes" : "no")}`, { k: "views", cmd: { op: "fit-table", on: opts.fitTable } }, tr("Tabulka uložení"));
}

/** klíče vygenerovaných objektů, které skript umí zapsat: kóty pohledů listu a pozice (kóta pohledu dalšího modelu nese id modelu, které se po přečtení změní) */
const GEN_KEY = /^(dim:[a-z]+:[tl]|pos:\d+)$/;
/**
 * Klíč vygenerovaného objektu, který na listu podle voleb být nemůže (bez jádra): kóta celkového rozměru vypnutého pohledu,
 * kóty u voleb bez nich (kótovat nic; Chytré kóty dílu mají vlastní), pozice mimo sestavu nebo s vypnutými balónky.
 */
function genKeyImpossible(doc: CadDoc, opts: Rec, k: string): boolean {
  const m = /^dim:([a-z]+):[tl]$/.exec(k);
  if (m) {
    const mode = typeof opts.dimensions === "string" ? opts.dimensions : "auto";
    return !viewsOn(opts)[m[1]] || m[1] === "iso" || mode === "none" || (mode === "smart" && doc.kind !== "assembly");
  }
  return doc.kind !== "assembly" || opts.balloons === false;
}

/**
 * Upravené vygenerované kóty celkových rozměrů a pozice (po `kótovat …`, kdy na listu jsou): skryté a posunuté. Zapíší se jen
 * klíče, které na listu jsou – `valid` = klíče listu spočítané jádrem (doc-script-fresh.ts `genKeys`); úprava objektu, který
 * už na listu není (vypnutý pohled, jiné kóty, odebraná komponenta – aplikace ji drží dál), by řádek při čtení odmítl, proto
 * se vynechá s poznámkou. Bez jádra se vynechají klíče, které na listu podle voleb být nemohou, ostatní se zapíší po jednom
 * řádku (odmítnutý řádek pak nevezme s sebou platné klíče) a poznámka řekne, že ověřené nejsou.
 */
export function emitGenEdit(o: SheetOut, doc: CadDoc, s: DrawingDoc, valid?: readonly string[]): void {
  const g = (s.options as { genEdit?: GenEdit } | undefined)?.genEdit;
  const all = [...(g?.off ?? []), ...Object.keys(g?.move ?? {}).filter((k) => g!.move![k][0] || g!.move![k][1])];
  if (!all.length) return;
  const what = tr("úprava vygenerovaných kót a pozic");
  const lost = all.filter((k) => !GEN_KEY.test(k));
  if (lost.length) o.note(tr("{0} listu „{1}“ nejde zapsat textem – doplňte ho ručně", `${what} (${lost.join(", ")})`, s.name));
  const here = (k: string) => (valid ? valid.includes(k) : !genKeyImpossible(doc, (s.options ?? {}) as Rec, k));
  const stale = all.filter((k) => GEN_KEY.test(k) && !here(k));
  if (stale.length) o.note(tr("úpravy vygenerovaných kót a pozic listu „{0}“, které už na listu nejsou ({1}), skript vynechá", s.name, [...new Set(stale)].join(", ")));
  const ok = (k: string) => GEN_KEY.test(k) && here(k);
  const off = (g?.off ?? []).filter(ok);
  const fail = () => o.note(tr("{0} listu „{1}“ nejde zapsat textem – doplňte ho ručně", what, s.name));
  for (const keys of valid ? [off] : off.map((k) => [k])) {
    if (!keys.length) continue;
    const l = `${head(o)} ${w(o, "gen")} ${w(o, "hide")} ${keys.join(" ")}`;
    if (sameCmd(l, { k: "views", cmd: { op: "gen", act: "hide", keys } })) o.line(l);
    else fail();
  }
  let moved = 0;
  for (const [k, d] of Object.entries(g?.move ?? {})) {
    if (!ok(k) || (!d[0] && !d[1])) continue;
    // uložený posun je v mm listu y dolů, příkaz píše y nahoru
    const up: Vec2 = [d[0] || 0, -d[1] || 0];
    const l = `${head(o)} ${w(o, "gen")} ${w(o, "move")} ${k} ${pt(o, up)}`;
    if (sameCmd(l, { k: "views", cmd: { op: "gen", act: "move", keys: [k], d: up } })) {
      o.line(l);
      moved++;
    } else fail();
  }
  if (!valid && off.length + moved) o.note(tr("úpravy vygenerovaných kót a pozic listu „{0}“ nejsou ověřené jádrem – řádek s klíčem, který na listu není, aplikace při čtení odmítne (export skript v aplikaci a v CLI klíče ověřuje jádrem)", s.name));
}
