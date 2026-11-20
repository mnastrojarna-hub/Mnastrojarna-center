/**
 * Výstupy z textové konzole – agent, který umí jen psát do konzole (nebo `window.mncad.run`), dokončí celou práci
 * v CADu bez systémových oken:
 *  - `uložit [název]` (EN save, DE speichern) – projekt .mncad,
 *  - `export step|stl|brep|obj|glb|3mf|wrl|mncad [název] [bez kontroly]` (EN export, DE exportieren) – 3D model,
 *  - `výkres export pdf|dxf|dwg|svg|csv|png [list N|vše] [název]` – výkres (list),
 *  - `skica export dxf [skica] [jako název]` – skica jako DXF,
 *  - `sdílet [model|výkres] [dní N|bez omezení] [heslo X] [od "Jméno"]` (EN share, DE freigeben – „teilen“ je rozdělit
 *    tělesa) – sdílený odkaz,
 *  - `odkaz` (EN/DE link) – znovu vypíše poslední odkaz,
 *  - `export skript [cs|en|de] [název]` (EN export script, DE export skript) – dokument jako textové příkazy
 *    `<název>.mncad.txt` (cad/doc-script.ts).
 * Soubory se z konzole vždy stahují přímo (žádný dialog „Uložit jako“) a protokol napíše název, velikost a formát;
 * u STEP / BREP i kontrolu: soubor se znovu načte jádrem a porovná s modelem (tělesa, objem, obálka).
 *
 * Čisté funkce (rozbor řádku, názvy souborů, vyhodnocení kontroly) – testy v Node; provedení
 * `components/cad/agent-out-host.ts`.
 */
import { cadLocale, tr } from "./i18n";
import type { Vec3 } from "./types";
import { parseOutputsLine, type OutputsCmd } from "./agent-outputs";
import { partsText, solidVerdict, type SolidParts, type SolidStats } from "./solid-export";

export type Export3dFormat = "step" | "stl" | "brep" | "obj" | "glb" | "3mf" | "wrl" | "mncad";
export type OutDrawingFormat = "pdf" | "dxf" | "dwg" | "svg" | "csv" | "png";

/**
 * Doručení souboru (balík B3): bez volby se soubor stáhne / zapíše hostitelem (prohlížeč: Stažené, CLI: `--out`);
 * „base64“ = soubor se nezapíše, jeho obsah jde do protokolu (řádek `BASE64 …` konzole, `= … file` s `detail` v plném
 * protokolu a JSON); „link“ (`… odkaz`) = soubor se zašifruje a nahraje do úložiště odkazů, protokol vypíše odkaz na
 * stránku, která ho dešifruje a nabídne ke stažení (share-file.ts) – obojí pro agenta v prohlížeči v cloudu, který ke
 * staženým souborům nedosáhne.
 */
export type OutDelivery = "base64" | "link";
export type OutCmd =
  /** projekt .mncad */
  | { kind: "save"; name?: string; deliver?: OutDelivery }
  /** 3D model (mncad = projekt jako u „uložit“); check false = bez kontroly znovunačtením (STEP / BREP) */
  | { kind: "export"; format: Export3dFormat; name?: string; check?: false; deliver?: OutDelivery }
  /**
   * výkres: list číslem / názvem, „all“ = všechny listy aktivního výkresu jedním souborem, „doc“ = všechny listy všech
   * výkresů dokumentu a u sestavy i výkresy dílů uložené v komponentách (každý zdrojový díl jednou); bez listu aktivní list
   */
  | { kind: "drawing"; format: OutDrawingFormat; sheet?: number | string | "all" | "doc"; name?: string; deliver?: OutDelivery }
  /** skica jako DXF (bez názvu otevřená, jinak poslední skica) */
  | { kind: "sketch"; sketch?: string; name?: string; deliver?: OutDelivery }
  /**
   * sdílený odkaz; days null = bez omezení; mode „store“ = jen krátký odkaz přes úložiště (nedostupné úložiště = ✗),
   * `orLink` = při selhání úložiště dlouhý odkaz s ⚠ (`sdílet úložiště nebo odkaz`)
   */
  | { kind: "share"; view?: "model" | "drawing"; days?: number | null; password?: string; from?: string; mode?: "link" | "store"; orLink?: true }
  /**
   * znovu vypsat poslední odkaz; `verify` (vlna 22, bod 16: `odkaz ověřit [<odkaz|kód>] [heslo X]`) = odkaz otevřít jako
   * příjemce a vypsat režim, platnost a obsah, nebo důvod, proč se neotevře (useknutý / poškozený / heslo / platnost…)
   */
  | { kind: "link"; verify?: { url?: string; password?: string } }
  /** dokument jako textový skript `.mncad.txt` (cad/doc-script.ts); lang = jazyk klíčových slov (bez hodnoty jazyk rozhraní) */
  | { kind: "script"; name?: string; lang?: "cs" | "en" | "de"; deliver?: OutDelivery }
  /** výstupy dokumentu: záznamy exportů, zastaralé výstupy, přepočítat vše (vlna 22, bod 20 – agent-outputs.ts) */
  | OutputsCmd;
export type OutOp = { k: "out"; cmd: OutCmd; line: number };

/* ───────────────────────── slova (CS / EN / DE) ───────────────────────── */
const fold = (s: string) => s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/ß/g, "ss");
const W = (...w: string[]) => new Set(w.map(fold));
const SAVE = W("uložit", "ulož", "uložení", "save", "speichern", "sichern");
const EXPORT = W("export", "exportovat", "exportuj", "exportieren", "exportiere");
// DE „teilen“ NE: je to rozdělit tělesa (splitbodies, agent.ts) – sdílení je „freigeben“
const SHARE = W("sdílet", "sdílej", "sdílení", "share", "freigeben");
const LINK = W("odkaz", "link");
/** `odkaz ověřit` (EN `link verify`, DE `link prüfen`) */
const VERIFY = W("ověřit", "ověř", "zkontrolovat", "verify", "check", "prüfen", "pruefen", "überprüfen", "ueberpruefen");
const SCRIPT = W("skript", "skriptu", "script", "textový-skript");
const DRAWING = W("výkres", "drawing", "zeichnung");
const SKETCH = W("skica", "skicu", "náčrt", "sketch", "skizze");
/** slovo před vlastním názvem souboru (lze vynechat) */
const NAME_KW = W("jako", "název", "soubor", "as", "name", "file", "als", "datei");
const SHEET_KW = W("list", "sheet", "blatt");
const ALL = W("vše", "všechny", "všechno", "all", "alle");
const MODEL = W("model", "díl", "part", "modell", "teil");
const DAYS = W("dní", "dny", "den", "dnů", "days", "day", "tage", "tag", "tagen", "platnost", "validity", "gültigkeit");
const UNLIMITED = W("neomezeně", "neomezene", "navždy", "unlimited", "forever", "unbegrenzt", "dauerhaft");
const NO = W("bez", "without", "no", "ohne", "kein");
const LIMIT = W("omezení", "limitu", "limit", "expiry", "ablauf", "begrenzung");
const PASSWORD = W("heslo", "heslem", "password", "passwort", "kennwort");
const FROM = W("od", "odesílatel", "from", "sender", "von", "absender");
const STORE = W("úložiště", "úložišti", "store", "storage", "speicher");
const LINK_MODE = W("odkazem", "inline");
/** „sdílet úložiště nebo odkaz“ */
const OR = W("nebo", "or", "oder");
/** `výkres export pdf dokument` – všechny listy dokumentu i výkresy dílů z komponent sestavy */
const DOC_SCOPE = W("dokument", "document");
const BASE64 = W("base64", "b64");
/** „bez kontroly“ u exportu STEP / BREP (dvě slova: NO + CHECK, nebo jedno NOCHECK) */
const CHECK = W("kontroly", "kontrola", "ověření", "check", "verification", "prüfung", "pruefung", "kontrolle");
const NOCHECK = W("nocheck", "bezkontroly", "ohneprüfung");

const FORMAT_ALIAS: Record<string, Export3dFormat | OutDrawingFormat> = {
  step: "step", stp: "step", stl: "stl", brep: "brep", brp: "brep", obj: "obj", glb: "glb", gltf: "glb", "3mf": "3mf", wrl: "wrl", vrml: "wrl", mncad: "mncad", projekt: "mncad", project: "mncad",
  pdf: "pdf", dxf: "dxf", dwg: "dwg", svg: "svg", csv: "csv", png: "png",
};
export const EXPORT_3D: Export3dFormat[] = ["step", "stl", "brep", "obj", "glb", "3mf", "wrl", "mncad"];
export const OUT_DRAWING: OutDrawingFormat[] = ["pdf", "dxf", "dwg", "svg", "csv", "png"];
/** přípony souboru, které formát přijme v zadaném názvu (jinak se přípona doplní) */
export const FORMAT_EXT: Record<Export3dFormat | OutDrawingFormat, string[]> = {
  step: ["step", "stp"], stl: ["stl"], brep: ["brep", "brp"], obj: ["obj"], glb: ["glb"], "3mf": ["3mf"], wrl: ["wrl"], mncad: ["mncad"],
  pdf: ["pdf"], dxf: ["dxf"], dwg: ["dwg"], svg: ["svg"], csv: ["csv"], png: ["png"],
};

/* ───────────────────────── zápisy pro chybové hlášky ───────────────────────── */
export const outUsage = {
  save: () => tr("uložit [název] – projekt .mncad se stáhne bez dialogu"),
  export: () => tr("export step|stl|brep|obj|glb|3mf|wrl|mncad [název] [bez kontroly]"),
  drawing: () => tr("výkres export pdf|dxf|dwg|svg|csv|png [list N|vše] [název]"),
  sketch: () => tr("skica export dxf [\"Skica 1\"] [jako název]"),
  share: () => tr("sdílet [model|výkres] [dní N|bez omezení] [heslo X] [od \"Jméno\"]"),
};

const isNum = (t: string) => /^[+-]?(\d+[.,]?\d*|[.,]\d+)$/.test(t);
const toNum = (t: string) => parseFloat(t.replace(",", "."));

/** číslo listu: celé číslo od 1 (1,5 se nezaokrouhlí – agent by nevěděl, který list dostal) */
function sheetNo(v: string): number {
  const n = toNum(v);
  if (!Number.isInteger(n) || n < 1) throw new Error(tr("výkres export: listy se číslují celými čísly od 1 – „{0}“", v));
  return n;
}

/**
 * Slova řádku (stejně jako `tokenize` v agent.ts: "…", „…“, '…' nebo bez mezer) a příznak, které byly v uvozovkách –
 * slovo v uvozovkách je vždy název (soubor „base64“, „odkaz“), nikdy klíčové slovo.
 */
export function outTokens(line: string): [string[], boolean[]] {
  const tokens: string[] = [];
  const quoted: boolean[] = [];
  const re = /"([^"]*)"|„([^“]*)“|'([^']*)'|(\S+)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(line))) {
    tokens.push(m[1] ?? m[2] ?? m[3] ?? m[4]);
    quoted.push(m[4] === undefined);
  }
  return [tokens, quoted];
}

/** zbytek řádku a příznaky uvozovek jeho slov (stejná délka, mění se spolu) */
type Rest = { w: string[]; q: boolean[] };
const restOf = (t: string[], tq: boolean[], from: number): Rest => ({ w: t.slice(from), q: tq.slice(from) });
const cut = (r: Rest, start: number, n: number) => {
  r.w.splice(start, n);
  r.q.splice(start, n);
};

/** „bez kontroly“ na začátku nebo na konci zbytku řádku (ne uprostřed názvu souboru, ne v uvozovkách) → odebere a vrátí true */
function takeNoCheck(r: Rest): boolean {
  let hit = false;
  const at = (i: number) => (r.q[i] ? "" : fold(r.w[i] ?? ""));
  for (;;) {
    const n = r.w.length;
    if (NOCHECK.has(at(0))) cut(r, 0, 1);
    else if (NO.has(at(0)) && CHECK.has(at(1))) cut(r, 0, 2);
    else if (NOCHECK.has(at(n - 1))) cut(r, n - 1, 1);
    else if (n >= 2 && NO.has(at(n - 2)) && CHECK.has(at(n - 1))) cut(r, n - 2, 2);
    else return hit;
    hit = true;
  }
}

/**
 * „base64“ / „odkaz“ (EN, DE „link“) bez uvozovek na konci zbytku řádku → odebere a vrátí doručení; před ním nesmí stát
 * „jako“ (`jako base64`, `jako odkaz` = název souboru) a v uvozovkách je to vždy název (`uložit "base64"`)
 */
function takeDelivery(r: Rest): OutDelivery | undefined {
  const n = r.w.length;
  if (!n || r.q[n - 1]) return undefined;
  const last = fold(r.w[n - 1]);
  const before = r.q[n - 2] ? "" : fold(r.w[n - 2] ?? "");
  if (NAME_KW.has(before)) return undefined;
  const d: OutDelivery | undefined = BASE64.has(last) ? "base64" : LINK.has(last) ? "link" : undefined;
  if (d) cut(r, n - 1, 1);
  return d;
}

/** zbytek řádku jako název souboru (bez úvodního „jako“ / „název“ mimo uvozovky) */
function nameOf(rest: Rest): string | undefined {
  const r = rest.w.length && !rest.q[0] && NAME_KW.has(fold(rest.w[0])) ? rest.w.slice(1) : rest.w;
  const s = r.join(" ").trim();
  return s || undefined;
}

/**
 * Rozbor řádku (všechna slova včetně prvního; uvozovky už odstraněné, `quoted[i]` = slovo i bylo v uvozovkách –
 * `outTokens`). Vrací null, když řádek není výstupním příkazem; chybný zápis výstupního příkazu vyhodí chybu se
 * správným zápisem.
 */
export function parseOutLine(tokens: string[], quoted: readonly boolean[] = []): OutCmd | null {
  const keep = tokens.map((_, i) => i).filter((i) => tokens[i] !== "");
  const t = keep.map((i) => tokens[i]);
  const tq = keep.map((i) => !!quoted[i]);
  if (!t.length) return null;
  const h = fold(t[0]);
  const second = fold(t[1] ?? "");
  // exporty · výstupy [zastaralé] · přepočítat vše (vlna 22, bod 20)
  const oc = parseOutputsLine(t, tq);
  if (oc) return oc;

  if (SAVE.has(h)) {
    const rest = restOf(t, tq, 1);
    const deliver = takeDelivery(rest);
    const name = nameOf(rest);
    return { kind: "save", ...(name ? { name } : {}), ...(deliver ? { deliver } : {}) };
  }

  if (EXPORT.has(h)) {
    const raw = t[1];
    if (!raw) throw new Error(tr("export potřebuje formát: {0}", outUsage.export()));
    if (SCRIPT.has(fold(raw))) {
      // export skript [cs|en|de] [název] [base64|odkaz] – dokument jako textové příkazy (cad/doc-script.ts)
      const rest = restOf(t, tq, 2);
      const lang = rest.w.length && !rest.q[0] && /^(cs|en|de)$/i.test(rest.w[0]) ? (rest.w[0].toLowerCase() as "cs" | "en" | "de") : undefined;
      if (lang) cut(rest, 0, 1);
      const deliver = takeDelivery(rest);
      const name = nameOf(rest);
      return { kind: "script", ...(name ? { name } : {}), ...(lang ? { lang } : {}), ...(deliver ? { deliver } : {}) };
    }
    const f = FORMAT_ALIAS[fold(raw).replace(/^\./, "")];
    if (f === "dxf") throw new Error(tr("export dxf: výkres → „výkres export dxf“, skica → „skica export dxf“"));
    if (f && (OUT_DRAWING as string[]).includes(f)) throw new Error(tr("export {0}: výkres se exportuje příkazem „výkres export {0}“ (nejdřív „výkres A3 …“)", f));
    if (!f) throw new Error(tr("export: neznámý formát „{0}“ – {1}", raw, outUsage.export()));
    const rest = restOf(t, tq, 2);
    let deliver = takeDelivery(rest);
    const noCheck = takeNoCheck(rest);
    deliver ??= takeDelivery(rest);
    const name = nameOf(rest);
    return { kind: "export", format: f as Export3dFormat, ...(name ? { name } : {}), ...(noCheck ? { check: false as const } : {}), ...(deliver ? { deliver } : {}) };
  }

  if (DRAWING.has(h) && EXPORT.has(second)) {
    const raw = t[2];
    if (!raw) throw new Error(tr("výkres export potřebuje formát: {0}", outUsage.drawing()));
    const f = FORMAT_ALIAS[fold(raw).replace(/^\./, "")];
    if (!f || !(OUT_DRAWING as string[]).includes(f)) throw new Error(tr("výkres export: neznámý formát „{0}“ – {1}", raw, outUsage.drawing()));
    let sheet: number | string | "all" | "doc" | undefined;
    const rest: Rest = { w: [], q: [] };
    for (let i = 3; i < t.length; i++) {
      const w = tq[i] ? "" : fold(t[i]); // v uvozovkách = název, ne klíčové slovo
      if (SHEET_KW.has(w)) {
        const v = t[i + 1];
        if (!v) throw new Error(tr("výkres export: za „{0}“ chybí číslo nebo název listu – {1}", t[i], outUsage.drawing()));
        sheet = ALL.has(fold(v)) ? "all" : isNum(v) ? sheetNo(v) : v;
        i++;
      } else if (ALL.has(w)) sheet = "all";
      else if (DOC_SCOPE.has(w)) sheet = "doc";
      // holé číslo před názvem = číslo listu („výkres export pdf 2“); číselný název souboru: „jako 2“
      else if (sheet === undefined && !tq[i] && isNum(t[i])) sheet = sheetNo(t[i]);
      else {
        rest.w.push(...t.slice(i));
        rest.q.push(...tq.slice(i));
        break;
      }
    }
    const deliver = takeDelivery(rest);
    const name = nameOf(rest);
    return { kind: "drawing", format: f as OutDrawingFormat, ...(sheet !== undefined ? { sheet } : {}), ...(name ? { name } : {}), ...(deliver ? { deliver } : {}) };
  }

  if (SKETCH.has(h) && EXPORT.has(second)) {
    const raw = t[2];
    if (!raw || fold(raw).replace(/^\./, "") !== "dxf") throw new Error(tr("skica se exportuje jen do DXF: {0}", outUsage.sketch()));
    const rest = restOf(t, tq, 3);
    const deliver = takeDelivery(rest);
    const k = rest.w.findIndex((x, i) => !rest.q[i] && NAME_KW.has(fold(x)));
    const sk = (k >= 0 ? rest.w.slice(0, k) : rest.w).join(" ").trim();
    const name = k >= 0 ? nameOf({ w: rest.w.slice(k), q: rest.q.slice(k) }) : undefined;
    return { kind: "sketch", ...(sk ? { sketch: sk } : {}), ...(name ? { name } : {}), ...(deliver ? { deliver } : {}) };
  }

  if (SHARE.has(h)) {
    const cmd: Extract<OutCmd, { kind: "share" }> = { kind: "share" };
    for (let i = 1; i < t.length; i++) {
      const w = fold(t[i]);
      const next = t[i + 1];
      if (MODEL.has(w)) cmd.view = "model";
      else if (DRAWING.has(w)) cmd.view = "drawing";
      else if (UNLIMITED.has(w)) cmd.days = null;
      else if (NO.has(w) && next && LIMIT.has(fold(next))) {
        cmd.days = null;
        i++;
      } else if (DAYS.has(w) && next && isNum(next)) {
        cmd.days = toNum(next);
        i++;
      } else if (isNum(t[i])) {
        cmd.days = toNum(t[i]);
        if (next && DAYS.has(fold(next))) i++;
      } else if (PASSWORD.has(w)) {
        if (!next) throw new Error(tr("sdílet: za „{0}“ chybí heslo – {1}", t[i], outUsage.share()));
        cmd.password = next;
        i++;
      } else if (FROM.has(w)) {
        if (!next) throw new Error(tr("sdílet: za „{0}“ chybí jméno odesílatele – {1}", t[i], outUsage.share()));
        cmd.from = next;
        i++;
      } else if (STORE.has(w)) cmd.mode = "store";
      else if (OR.has(w) && next && (LINK.has(fold(next)) || LINK_MODE.has(fold(next)))) {
        cmd.orLink = true; // úložiště, a když selže, dlouhý odkaz s ⚠
        i++;
      } else if (LINK_MODE.has(w)) cmd.mode = "link";
      else throw new Error(tr("sdílet: neznámé slovo „{0}“ – {1}", t[i], outUsage.share()));
    }
    if (cmd.orLink && cmd.mode === "link") delete cmd.orLink; // „odkazem nebo odkaz“ – už je to odkaz
    if (typeof cmd.days === "number" && !(cmd.days > 0 && cmd.days <= 3650)) throw new Error(tr("sdílet: platnost je 1 až 3650 dní, nebo „bez omezení“ – {0}", outUsage.share()));
    return cmd;
  }

  if (LINK.has(h)) {
    if (t.length > 1 && VERIFY.has(fold(t[1]))) {
      const v: { url?: string; password?: string } = {};
      for (let i = 2; i < t.length; i++) {
        if (!tq[i] && PASSWORD.has(fold(t[i]))) {
          if (!t[i + 1]) throw new Error(tr("odkaz ověřit: za „{0}“ chybí heslo", t[i]));
          v.password = t[++i];
        } else if (v.url === undefined) v.url = t[i];
        else v.url += ` ${t[i]}`; // kód po skupinách „Ab3k Z9xQ 2m“
      }
      return { kind: "link", verify: v };
    }
    if (t.length > 1) throw new Error(tr("odkaz nemá další volby – vypíše poslední sdílený odkaz („odkaz ověřit [odkaz] [heslo X]“ ho ověří); nový vytvoří „sdílet“"));
    return { kind: "link" };
  }
  return null;
}

/* ───────────────────────── názvy souborů a velikosti ───────────────────────── */
/**
 * Název staženého souboru: zadaný název (bez znaků, které souborové systémy nepřijmou) nebo výchozí; přípona formátu
 * se doplní, když chybí (`exts[0]`), zadaná povolená přípona (např. .stp u STEP) zůstane.
 */
export function outFileName(given: string | undefined, fallback: string, exts: string[]): string {
  const clean = (given ?? "")
    .replace(/[\\/:*?"<>|\u0000-\u001f]+/g, "_")
    .replace(/^[.\s]+|[.\s]+$/g, "")
    .slice(0, 120);
  const base = clean || fallback;
  const m = /\.([a-z0-9]+)$/i.exec(base);
  return m && exts.includes(m[1].toLowerCase()) ? base : `${base}.${exts[0]}`;
}

const num = (v: number, d: number) => v.toLocaleString(cadLocale(), { minimumFractionDigits: d, maximumFractionDigits: d });
/** velikost souboru pro protokol: 812 B, 12,3 kB, 1,4 MB */
export function fmtBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${num(n / 1024, n < 10 * 1024 ? 1 : 0)} kB`;
  return `${num(n / 1048576, 1)} MB`;
}

/** popis formátu do protokolu */
export function formatLabel(f: Export3dFormat | OutDrawingFormat | "sketch-dxf"): string {
  switch (f) {
    case "step":
      return "STEP AP214";
    case "brep":
      return "OpenCascade BREP";
    case "stl":
      return tr("STL (síť)");
    case "3mf":
      return tr("3MF (síť)");
    case "obj":
      return tr("Wavefront OBJ (síť)");
    case "glb":
      return tr("glTF binární (síť)");
    case "wrl":
      return tr("VRML (síť)");
    case "mncad":
      return tr("projekt Mnástrojárna CAD (.mncad)");
    case "pdf":
      return tr("výkres PDF");
    case "dxf":
      return tr("výkres DXF");
    case "dwg":
      return tr("výkres DWG");
    case "svg":
      return tr("výkres SVG");
    case "csv":
      return tr("kusovník CSV");
    case "png":
      return tr("náhled listu PNG");
    case "sketch-dxf":
      return tr("skica DXF");
  }
}

/** řádek protokolu o staženém souboru */
export function fileLogLine(what: string, name: string, bytes: number, format: string): string {
  return tr("✓ {0}: {1} · {2} · {3} – staženo (bez dialogu)", what, name, fmtBytes(bytes), format);
}

/* ───────────────────────── kontrola exportu (STEP / BREP) ───────────────────────── */
/**
 * Míry modelu / znovu načteného souboru. `volume` = objem jen objemových těles (22c – skořepiny a plochy objem nemají);
 * `free` = plochy mimo tělesa, `freeShells` / `freeFaces` / `shells` / `closedShells` = složení (export-verify.ts),
 * `valid` = BRepCheck tvaru (rychlá metoda; null / chybí = nezkontrolováno).
 */
export type ShapeStats = { solids?: number; volume: number; bbox: [Vec3, Vec3]; free?: number; freeShells?: number; closedFree?: number; freeFaces?: number; shells?: number; closedShells?: number; valid?: boolean | null };
/**
 * Výsledek kontroly: `ok` = věrná kopie objemového modelu; `level` / `code` = jak ji hlásit (✗ out.no-solid – soubor bez
 * tělesa, ⚠ out.free-surfaces – volné plochy vedle tělesa, ⚠ / ✗ out.check-failed – soubor se od modelu liší / nenačetl se).
 */
export type ExportCheck = { ok: boolean; line: string; volumeDiffPct: number; bboxDiff: number; solidsOk: boolean; level?: "ok" | "warn" | "error"; code?: "out.no-solid" | "out.free-surfaces" | "out.check-failed" };

/** povolená relativní odchylka objemu (B-rep se přenáší přesně, rozdíl je jen numerický) */
export const CHECK_VOLUME_REL = 1e-3;

/**
 * Porovná model se souborem znovu načteným jádrem: počet objemových těles, plochy mimo tělesa, platnost, objem těles a
 * obálku. Jedna věta do protokolu, aby agent bez prohlížeče souboru věděl, co soubor obsahuje:
 *  - soubor bez objemového tělesa → ✗ `out.no-solid` (nikdy „věrná kopie“, ani když model je stejně jen plochy – 22c);
 *  - soubor se od modelu liší (tělesa, plochy mimo tělesa, platnost, objem, obálka) → ⚠ `out.check-failed`;
 *  - soubor odpovídá modelu, ale vedle těles nese volné skořepiny / plochy → ⚠ `out.free-surfaces` s počty;
 *  - jinak ✓ „… → věrná kopie modelu“.
 * `parts` = komponenty sestavy bez tělesa / s volnými plochami (jména do hlášky).
 */
export function exportCheck(model: ShapeStats, file: ShapeStats, label = "STEP", parts?: SolidParts): ExportCheck {
  const size = (b: [Vec3, Vec3]) => [0, 1, 2].map((i) => b[1][i] - b[0][i]);
  const diag = Math.hypot(...size(model.bbox));
  const bboxDiff = Math.max(...[0, 1].flatMap((k) => [0, 1, 2].map((i) => Math.abs(model.bbox[k][i] - file.bbox[k][i]))));
  const bboxTol = Math.max(0.01, diag * 1e-5);
  const volumeDiffPct = model.volume > 0 ? (Math.abs(file.volume - model.volume) / model.volume) * 100 : file.volume > 0 ? 100 : 0;
  const solidsOk = model.solids === undefined || file.solids === undefined || model.solids === file.solids;
  const vol = (v: number) => `${num(v, v >= 1000 ? 0 : 2)} mm³`;
  const dims = size(file.bbox).map((v) => num(v, 2)).join(" × ");
  const base = { volumeDiffPct, bboxDiff, solidsOk };
  // 22c: soubor bez objemového tělesa není objemový export – bez ohledu na to, že odpovídá modelu z ploch
  if (file.solids === 0) {
    const v = solidVerdict(statsOf(file), label, "file", parts)!;
    return { ...base, ok: false, level: "error", code: "out.no-solid", line: `✗ ${tr("kontrola {0}: {1}", label, v.body)}` };
  }
  const freeM = model.free ?? (model.freeShells !== undefined || model.freeFaces !== undefined ? (model.freeShells ?? 0) + (model.freeFaces ?? 0) : undefined);
  const freeF = file.free ?? (file.freeShells !== undefined || file.freeFaces !== undefined ? (file.freeShells ?? 0) + (file.freeFaces ?? 0) : undefined);
  const freeOk = freeM === undefined || freeF === undefined || freeM === freeF;
  const validOk = file.valid !== false || model.valid === false;
  const volOk = volumeDiffPct <= CHECK_VOLUME_REL * 100;
  const boxOk = bboxDiff <= bboxTol;
  const solids = file.solids === undefined ? "" : tr("těles: {0}, ", file.solids);
  if (!(solidsOk && freeOk && validOk && volOk && boxOk)) {
    const why: string[] = [];
    if (!solidsOk) why.push(tr("těles {0} (model {1})", file.solids ?? 0, model.solids ?? 0));
    if (!freeOk) why.push(tr("ploch mimo tělesa {0} (model {1})", freeF ?? 0, freeM ?? 0));
    if (!validOk) why.push(tr("po načtení neplatné (BRepCheck), model platný"));
    if (!volOk) why.push(tr("objem {0} (model {1}, rozdíl {2} %)", vol(file.volume), vol(model.volume), num(volumeDiffPct, 3)));
    if (!boxOk) why.push(tr("obálka {0} mm (model {1} mm, odchylka {2} mm)", dims, size(model.bbox).map((v) => num(v, 2)).join(" × "), num(bboxDiff, 3)));
    return { ...base, ok: false, level: "warn", code: "out.check-failed", line: tr("⚠ kontrola {0}: soubor se od modelu liší – {1}; zkontrolujte prvky s ⚠ / ✗ (stav) a export zopakujte", label, why.join(", ")) + partsText(parts) };
  }
  // odpovídá modelu, ale volné skořepiny / plochy vedle těles nejsou objemový model → ⚠ s počty (a jmény komponent)
  const fv = solidVerdict(statsOf(file), label, "file", parts);
  if (fv) return { ...base, ok: false, level: "warn", code: "out.free-surfaces", line: `⚠ ${tr("kontrola {0}: {1}", label, fv.body)}` };
  return {
    ...base,
    ok: true,
    level: "ok",
    line: tr("✓ kontrola {0}: soubor znovu načten jádrem – {1}objem {2} (rozdíl {3} %), obálka {4} mm (odchylka {5} mm) → věrná kopie modelu", label, solids, vol(file.volume), num(volumeDiffPct, 4), dims, num(bboxDiff, 4)),
  };
}

/** složení souboru / modelu pro `solidVerdict` */
const statsOf = (s: ShapeStats): SolidStats => ({ solids: s.solids ?? 0, ...(s.free !== undefined ? { free: s.free } : {}), ...(s.freeShells !== undefined ? { freeShells: s.freeShells } : {}), ...(s.freeFaces !== undefined ? { freeFaces: s.freeFaces } : {}), ...(s.shells !== undefined ? { shells: s.shells } : {}), ...(s.closedShells !== undefined ? { closedShells: s.closedShells } : {}), ...(s.closedFree !== undefined ? { closedFree: s.closedFree } : {}) });

/** kontrola, kterou nešlo provést (soubor se nenačetl) */
export function checkFailed(label: string, why: string): ExportCheck {
  return { ok: false, volumeDiffPct: NaN, bboxDiff: NaN, solidsOk: false, level: "error", code: "out.check-failed", line: tr("✗ kontrola {0}: soubor se nepodařilo znovu načíst – {1}", label, why) };
}

/* ───────────────────────── window.mncad ───────────────────────── */
/** stažený soubor: název, MIME, velikost, formát, řádky protokolu (jako v konzoli), kontrola STEP / BREP */
export type OutFileInfo = { name: string; mime: string; bytes: number; format: string; log: string[]; check?: ExportCheck; warning?: string; /** revize modelu souboru (vlna 22, bod 12) */ modelRev?: string };
export type MncadOutApi = {
  /** uloží projekt .mncad přímo do Stažených (bez dialogu, jako příkaz „uložit [název]“); vrátí název, velikost a protokol */
  save: (name?: string) => Promise<OutFileInfo>;
  /**
   * otevřený dokument jako textový skript (stejné příkazy jako konzole – cad/doc-script.ts): díly, sestava s polohami a vazbami,
   * pohybová studie, výkresy; `lang` = jazyk klíčových slov a rozhraní, pro které je skript určen (výchozí jazyk rozhraní),
   * `names: "all"` = název u každého prvku. Čísla vybraných hran a ploch před zápisem ověří jádro podle otisků (proto Promise);
   * `sigs: "keep"` = bez ověření, prvky s otisky výběru zapsat i s nimi (obecný příkaz / JSON)
   */
  script: (opts?: { lang?: "cs" | "en" | "de"; names?: "auto" | "all"; sigs?: "drop" | "keep"; comments?: boolean }) => Promise<string>;
};

/* ───────────────────────── nápověda příkazů ───────────────────────── */
/** Řádky nápovědy příkazů (AGENT_COMMANDS). */
export const OUT_COMMANDS: { cmd: string; en: string; de: string; desc: string }[] = [
  {
    cmd: "uložit [název]",
    en: "save",
    de: "speichern",
    desc: tr("projekt .mncad se stáhne rovnou (bez dialogu „Uložit jako“); protokol napíše název souboru, velikost a počet prvků; také window.mncad.save(název)"),
  },
  {
    cmd: "export step|stl|brep|obj|glb|3mf|wrl|mncad [název] [bez kontroly]",
    en: "export",
    de: "exportieren",
    desc: tr("3D model se stáhne bez dialogu; u STEP a BREP kontrola: soubor se znovu načte jádrem a porovná s modelem (tělesa, plochy mimo tělesa, platnost, objem, obálka) → „věrná kopie modelu“ jen s objemovým tělesem; bez tělesa ✗ out.no-solid, volné plochy vedle tělesa ⚠ out.free-surfaces (i u STL / 3MF a „bez kontroly“ podle modelu); „bez kontroly“ vynechá zpětné čtení"),
  },
  {
    cmd: "export skript [cs|en|de] [název]",
    en: "export script",
    de: "export skript",
    desc: tr("dokument jako textový skript <název>.mncad.txt (díly, sestava s polohami a vazbami, pohyb, výkresy) – stejné příkazy jako konzole, k úpravě a novému spuštění; protokol napíše počet řádků, velikost a pokrytí (vlastní příkaz / prvek / JSON); také window.mncad.script()"),
  },
  {
    cmd: "výkres export pdf|dxf|dwg|svg|csv|png [list N|N|vše] [název]",
    en: "drawing export pdf",
    de: "zeichnung export pdf",
    desc: tr("list výkresu jako soubor bez dialogu (bez listu aktivní, „vše“ = každý list zvlášť); výkres nejdřív „výkres A3 …“ a „kótovat“"),
  },
  {
    cmd: "skica export dxf [\"Skica 1\"] [jako název]",
    en: "sketch export dxf",
    de: "skizze export dxf",
    desc: tr("skica jako DXF bez dialogu (bez názvu otevřená, jinak poslední skica)"),
  },
  {
    cmd: "sdílet [model|výkres] [dní N|bez omezení] [heslo X] [od \"Jméno\"] · odkaz",
    en: "share, link",
    de: "freigeben, link",
    desc: tr("sdílený odkaz (jako tlačítko Sdílet odkazem): ADRESA SE VYPÍŠE DO PROTOKOLU (a zkopíruje do schránky, když to prohlížeč dovolí); výchozí platnost 10 dní; „odkaz“ vypíše poslední odkaz znovu"),
  },
  {
    cmd: "odkaz ověřit · odkaz ověřit https://mnastrojarna.cz/s#Ab3kZ9xQ2m · odkaz ověřit <odkaz> heslo X",
    en: "link verify",
    de: "link prüfen",
    desc: tr("otevře sdílený odkaz jako příjemce a nic nezmění: ✓ s režimem, platností a obsahem (komponenty, díly, listy, přílohy), nebo ✗ s důvodem – useknutý, změněný, heslo, platnost, nenalezen; bez odkazu ověří poslední odkaz běhu"),
  },
  {
    cmd: "výkres export pdf dokument · export step base64 · export step odkaz · sdílet úložiště nebo odkaz",
    en: "drawing export pdf document · export step base64 · export step link · share store or link",
    de: "zeichnung export pdf dokument · exportieren step base64 · exportieren step link · freigeben speicher oder link",
    desc: tr("„dokument“ = všechny listy všech výkresů a u sestavy i výkresy dílů z komponent (každý díl jednou) v jednom PDF, stejné jako --formats auto v CLI; „base64“ za uložit / export / výkres export / skica export = soubor se nestáhne, obsah jde do protokolu (řádek BASE64, nejvýš 2 MB); „odkaz“ = soubor zašifrovaný v úložišti odkazů, protokol vypíše odkaz na stránku ke stažení; „sdílet úložiště“ = jen krátký odkaz (nedostupné úložiště = ✗), „nebo odkaz“ = jinak dlouhý odkaz s ⚠"),
  },
  {
    cmd: "exporty [vymazat] · výstupy [zastaralé] · přepočítat vše",
    en: "exports [clear] · outputs [stale] · recompute all",
    de: "exporte [löschen] · ausgaben [veraltet] · alles neu berechnen",
    desc: tr("záznamy exportů v dokumentu (formát, soubor, revize modelu r·…, čas; po změně modelu ⚠ zastaralé s příkazem, který export zopakuje); seznam zastaralých výstupů (vydané listy, exporty, analýzy, kopie dílů v sestavě); přepočítat vše = obnoví kopie dílů, stav vazeb, kolize, pohyb a listy a vypíše, co musí udělat člověk (nová revize listu, nový export)"),
  },
];
