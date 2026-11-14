/**
 * Výstupy z textové konzole – agent, který umí jen psát do konzole (nebo `window.mncad.run`), dokončí celou práci
 * v CADu bez systémových oken:
 *  - `uložit [název]` (EN save, DE speichern) – projekt .mncad,
 *  - `export step|stl|brep|obj|glb|3mf|wrl|mncad [název] [bez kontroly]` (EN export, DE exportieren) – 3D model,
 *  - `výkres export pdf|dxf|dwg|svg|csv|png [list N|vše] [název]` – výkres (list),
 *  - `skica export dxf [skica] [jako název]` – skica jako DXF,
 *  - `sdílet [model|výkres] [dní N|bez omezení] [heslo X] [od "Jméno"]` (EN share, DE freigeben – „teilen“ je rozdělit
 *    tělesa) – sdílený odkaz,
 *  - `odkaz` (EN/DE link) – znovu vypíše poslední odkaz.
 * Soubory se z konzole vždy stahují přímo (žádný dialog „Uložit jako“) a protokol napíše název, velikost a formát;
 * u STEP / BREP i kontrolu: soubor se znovu načte jádrem a porovná s modelem (tělesa, objem, obálka).
 *
 * Čisté funkce (rozbor řádku, názvy souborů, vyhodnocení kontroly) – testy v Node; provedení
 * `components/cad/agent-out-host.ts`.
 */
import { cadLocale, tr } from "./i18n";
import type { Vec3 } from "./types";

export type Export3dFormat = "step" | "stl" | "brep" | "obj" | "glb" | "3mf" | "wrl" | "mncad";
export type OutDrawingFormat = "pdf" | "dxf" | "dwg" | "svg" | "csv" | "png";

export type OutCmd =
  /** projekt .mncad */
  | { kind: "save"; name?: string }
  /** 3D model (mncad = projekt jako u „uložit“); check false = bez kontroly znovunačtením (STEP / BREP) */
  | { kind: "export"; format: Export3dFormat; name?: string; check?: false }
  /** výkres: list číslem / názvem, „all“ = každý list zvlášť; bez listu aktivní list */
  | { kind: "drawing"; format: OutDrawingFormat; sheet?: number | string | "all"; name?: string }
  /** skica jako DXF (bez názvu otevřená, jinak poslední skica) */
  | { kind: "sketch"; sketch?: string; name?: string }
  /** sdílený odkaz; days null = bez omezení */
  | { kind: "share"; view?: "model" | "drawing"; days?: number | null; password?: string; from?: string; mode?: "link" | "store" }
  /** znovu vypsat poslední odkaz */
  | { kind: "link" };
export type OutOp = { k: "out"; cmd: OutCmd; line: number };

/* ───────────────────────── slova (CS / EN / DE) ───────────────────────── */
const fold = (s: string) => s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/ß/g, "ss");
const W = (...w: string[]) => new Set(w.map(fold));
const SAVE = W("uložit", "ulož", "uložení", "save", "speichern", "sichern");
const EXPORT = W("export", "exportovat", "exportuj", "exportieren", "exportiere");
// DE „teilen“ NE: je to rozdělit tělesa (splitbodies, agent.ts) – sdílení je „freigeben“
const SHARE = W("sdílet", "sdílej", "sdílení", "share", "freigeben");
const LINK = W("odkaz", "link");
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

/** „bez kontroly“ na začátku nebo na konci zbytku řádku (ne uprostřed názvu souboru) → odebere a vrátí true */
function takeNoCheck(rest: string[]): boolean {
  let hit = false;
  const at = (i: number) => fold(rest[i] ?? "");
  for (;;) {
    if (NOCHECK.has(at(0))) rest.splice(0, 1);
    else if (NO.has(at(0)) && CHECK.has(at(1))) rest.splice(0, 2);
    else if (NOCHECK.has(at(rest.length - 1))) rest.splice(-1, 1);
    else if (rest.length >= 2 && NO.has(at(rest.length - 2)) && CHECK.has(at(rest.length - 1))) rest.splice(-2, 2);
    else return hit;
    hit = true;
  }
}

/** zbytek řádku jako název souboru (bez úvodního „jako“ / „název“) */
function nameOf(rest: string[]): string | undefined {
  const r = rest.length && NAME_KW.has(fold(rest[0])) ? rest.slice(1) : rest;
  const s = r.join(" ").trim();
  return s || undefined;
}

/**
 * Rozbor řádku (všechna slova včetně prvního; uvozovky už odstraněné). Vrací null, když řádek není výstupním
 * příkazem; chybný zápis výstupního příkazu vyhodí chybu se správným zápisem.
 */
export function parseOutLine(tokens: string[]): OutCmd | null {
  const t = tokens.filter((x) => x !== "");
  if (!t.length) return null;
  const h = fold(t[0]);
  const second = fold(t[1] ?? "");

  if (SAVE.has(h)) {
    const name = nameOf(t.slice(1));
    return { kind: "save", ...(name ? { name } : {}) };
  }

  if (EXPORT.has(h)) {
    const raw = t[1];
    if (!raw) throw new Error(tr("export potřebuje formát: {0}", outUsage.export()));
    const f = FORMAT_ALIAS[fold(raw).replace(/^\./, "")];
    if (f === "dxf") throw new Error(tr("export dxf: výkres → „výkres export dxf“, skica → „skica export dxf“"));
    if (f && (OUT_DRAWING as string[]).includes(f)) throw new Error(tr("export {0}: výkres se exportuje příkazem „výkres export {0}“ (nejdřív „výkres A3 …“)", f));
    if (!f) throw new Error(tr("export: neznámý formát „{0}“ – {1}", raw, outUsage.export()));
    const rest = t.slice(2);
    const noCheck = takeNoCheck(rest);
    const name = nameOf(rest);
    return { kind: "export", format: f as Export3dFormat, ...(name ? { name } : {}), ...(noCheck ? { check: false as const } : {}) };
  }

  if (DRAWING.has(h) && EXPORT.has(second)) {
    const raw = t[2];
    if (!raw) throw new Error(tr("výkres export potřebuje formát: {0}", outUsage.drawing()));
    const f = FORMAT_ALIAS[fold(raw).replace(/^\./, "")];
    if (!f || !(OUT_DRAWING as string[]).includes(f)) throw new Error(tr("výkres export: neznámý formát „{0}“ – {1}", raw, outUsage.drawing()));
    let sheet: number | string | "all" | undefined;
    const rest: string[] = [];
    for (let i = 3; i < t.length; i++) {
      const w = fold(t[i]);
      if (SHEET_KW.has(w)) {
        const v = t[i + 1];
        if (!v) throw new Error(tr("výkres export: za „{0}“ chybí číslo nebo název listu – {1}", t[i], outUsage.drawing()));
        sheet = ALL.has(fold(v)) ? "all" : isNum(v) ? sheetNo(v) : v;
        i++;
      } else if (ALL.has(w)) sheet = "all";
      // holé číslo před názvem = číslo listu („výkres export pdf 2“); číselný název souboru: „jako 2“
      else if (sheet === undefined && isNum(t[i])) sheet = sheetNo(t[i]);
      else {
        rest.push(...t.slice(i));
        break;
      }
    }
    const name = nameOf(rest);
    return { kind: "drawing", format: f as OutDrawingFormat, ...(sheet !== undefined ? { sheet } : {}), ...(name ? { name } : {}) };
  }

  if (SKETCH.has(h) && EXPORT.has(second)) {
    const raw = t[2];
    if (!raw || fold(raw).replace(/^\./, "") !== "dxf") throw new Error(tr("skica se exportuje jen do DXF: {0}", outUsage.sketch()));
    const rest = t.slice(3);
    const k = rest.findIndex((x) => NAME_KW.has(fold(x)));
    const sk = (k >= 0 ? rest.slice(0, k) : rest).join(" ").trim();
    const name = k >= 0 ? nameOf(rest.slice(k)) : undefined;
    return { kind: "sketch", ...(sk ? { sketch: sk } : {}), ...(name ? { name } : {}) };
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
      else if (LINK_MODE.has(w)) cmd.mode = "link";
      else throw new Error(tr("sdílet: neznámé slovo „{0}“ – {1}", t[i], outUsage.share()));
    }
    if (typeof cmd.days === "number" && !(cmd.days > 0 && cmd.days <= 3650)) throw new Error(tr("sdílet: platnost je 1 až 3650 dní, nebo „bez omezení“ – {0}", outUsage.share()));
    return cmd;
  }

  if (LINK.has(h)) {
    if (t.length > 1) throw new Error(tr("odkaz nemá další volby – vypíše poslední sdílený odkaz; nový vytvoří „sdílet“"));
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
export type ShapeStats = { solids?: number; volume: number; bbox: [Vec3, Vec3] };
export type ExportCheck = { ok: boolean; line: string; volumeDiffPct: number; bboxDiff: number; solidsOk: boolean };

/** povolená relativní odchylka objemu (B-rep se přenáší přesně, rozdíl je jen numerický) */
export const CHECK_VOLUME_REL = 1e-3;

/**
 * Porovná model se souborem znovu načteným jádrem: počet objemových těles, objem a obálku. Jedna věta do protokolu
 * (✓ věrná kopie / ⚠ v čem se liší), aby agent bez prohlížeče souboru věděl, že soubor odpovídá modelu.
 */
export function exportCheck(model: ShapeStats, file: ShapeStats, label = "STEP"): ExportCheck {
  const size = (b: [Vec3, Vec3]) => [0, 1, 2].map((i) => b[1][i] - b[0][i]);
  const diag = Math.hypot(...size(model.bbox));
  const bboxDiff = Math.max(...[0, 1].flatMap((k) => [0, 1, 2].map((i) => Math.abs(model.bbox[k][i] - file.bbox[k][i]))));
  const bboxTol = Math.max(0.01, diag * 1e-5);
  const volumeDiffPct = model.volume > 0 ? (Math.abs(file.volume - model.volume) / model.volume) * 100 : file.volume > 0 ? 100 : 0;
  const solidsOk = model.solids === undefined || file.solids === undefined || model.solids === file.solids;
  const volOk = volumeDiffPct <= CHECK_VOLUME_REL * 100;
  const boxOk = bboxDiff <= bboxTol;
  const ok = solidsOk && volOk && boxOk;
  const vol = (v: number) => `${num(v, v >= 1000 ? 0 : 2)} mm³`;
  const dims = size(file.bbox).map((v) => num(v, 2)).join(" × ");
  const solids = file.solids === undefined ? "" : tr("těles: {0}, ", file.solids);
  if (ok)
    return {
      ok,
      volumeDiffPct,
      bboxDiff,
      solidsOk,
      line: tr("✓ kontrola {0}: soubor znovu načten jádrem – {1}objem {2} (rozdíl {3} %), obálka {4} mm (odchylka {5} mm) → věrná kopie modelu", label, solids, vol(file.volume), num(volumeDiffPct, 4), dims, num(bboxDiff, 4)),
    };
  const why: string[] = [];
  if (!solidsOk) why.push(tr("těles {0} (model {1})", file.solids ?? 0, model.solids ?? 0));
  if (!volOk) why.push(tr("objem {0} (model {1}, rozdíl {2} %)", vol(file.volume), vol(model.volume), num(volumeDiffPct, 3)));
  if (!boxOk) why.push(tr("obálka {0} mm (model {1} mm, odchylka {2} mm)", dims, size(model.bbox).map((v) => num(v, 2)).join(" × "), num(bboxDiff, 3)));
  return { ok, volumeDiffPct, bboxDiff, solidsOk, line: tr("⚠ kontrola {0}: soubor se od modelu liší – {1}; zkontrolujte prvky s ⚠ / ✗ (stav) a export zopakujte", label, why.join(", ")) };
}

/** kontrola, kterou nešlo provést (soubor se nenačetl) */
export function checkFailed(label: string, why: string): ExportCheck {
  return { ok: false, volumeDiffPct: NaN, bboxDiff: NaN, solidsOk: false, line: tr("✗ kontrola {0}: soubor se nepodařilo znovu načíst – {1}", label, why) };
}

/* ───────────────────────── window.mncad ───────────────────────── */
/** stažený soubor: název, MIME, velikost, formát, řádky protokolu (jako v konzoli), kontrola STEP / BREP */
export type OutFileInfo = { name: string; mime: string; bytes: number; format: string; log: string[]; check?: ExportCheck; warning?: string };
export type MncadOutApi = {
  /** uloží projekt .mncad přímo do Stažených (bez dialogu, jako příkaz „uložit [název]“); vrátí název, velikost a protokol */
  save: (name?: string) => Promise<OutFileInfo>;
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
    desc: tr("3D model se stáhne bez dialogu; u STEP a BREP kontrola: soubor se znovu načte jádrem a porovná s modelem (tělesa, objem, obálka) → „věrná kopie modelu“; „bez kontroly“ ji vynechá"),
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
];
