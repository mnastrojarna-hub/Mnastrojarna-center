/**
 * Argumenty příkazové řádky `mncad` (CAD-HEADLESS-NAVRH.md kap. 3.1 a 3.2).
 *
 * ```
 * mncad run <skript.txt|-> [--out DIR] [--strict[=kromě kód,kód]] [--share[=model|drawing]] [--share-days N] [--share-store URL]
 *           [--formats auto|none|step,pdf,dxf,dwg,svg,stl,csv,mncad] [--doc "Název"] [--all-docs] [--open soubor…]
 *           [--files DIR] [--resume relace.mncad-ws] [--json] [--full] [--notes] [--budget 2048] [--lang cs|en|de]
 *           [--timeout 300] [--max-mem 2048] [--progress] [--no-output-on-error]
 * mncad serve [--port 8787] [--host 127.0.0.1] [--token-file F] [--jobs 1] [--max-mem 2048] [--timeout 300] [--allow-remote]
 *             [--allow-host jméno,…] [--out DIR] [--idle-timeout 900] [--lang cs|en|de]
 * mncad help [guide|commands] · mncad version · mncad selftest [--json] [--lang cs|en|de]
 * ```
 *
 * Volby jsou anglicky (zvyk příkazové řádky), texty chyb v jazyce `--lang` (jinak `MNCAD_LANG`, jinak čeština). Chyba použití
 * je `UsageError` – hlavní vlákno ji vypíše na stderr a skončí kódem 3.
 */
import { CAD_LANGS, tr, type CadLang } from "../i18n";

/** formáty výstupů `--formats` (kap. 3.1) */
export const OUT_FORMATS = ["step", "pdf", "dxf", "dwg", "svg", "stl", "csv", "mncad"] as const;
export type OutFormat = (typeof OUT_FORMATS)[number];
export type Formats = "auto" | "none" | OutFormat[];
export type StrictOpt = boolean | { except: string[] };
export type ShareView = "model" | "drawing";

export type RunArgs = {
  cmd: "run";
  /** cesta skriptu, `-` = standardní vstup */
  script: string;
  out: string;
  strict: StrictOpt;
  share: false | ShareView;
  shareDays: number;
  shareStore?: string;
  formats: Formats;
  doc?: string;
  allDocs: boolean;
  open: string[];
  files?: string;
  resume?: string;
  json: boolean;
  full: boolean;
  notes: boolean;
  budget: number;
  lang: CadLang;
  /** časový limit v sekundách (0 = bez limitu) */
  timeout: number;
  /** limit paměti v MB (0 = bez limitu) */
  maxMem: number;
  progress: boolean;
  noOutputOnError: boolean;
};
export type ServeArgs = {
  cmd: "serve";
  port: number;
  host: string;
  tokenFile?: string;
  jobs: number;
  maxMem: number;
  timeout: number;
  allowRemote: boolean;
  /** další přípustné hodnoty hlavičky Host (jen s `--allow-remote`) */
  allowHosts: string[];
  /** složka pro `return: "paths"` (bez ní jen base64) */
  out?: string;
  /** nečinné vlákno relace skončí po tolika sekundách (výchozí 15 min); relace zůstane uložená */
  idleTimeout: number;
  lang: CadLang;
};
export type HelpArgs = { cmd: "help"; topic: string[]; lang: CadLang };
export type VersionArgs = { cmd: "version"; json: boolean; lang: CadLang };
export type SelftestArgs = { cmd: "selftest"; json: boolean; lang: CadLang; timeout: number; maxMem: number };
export type CliArgs = RunArgs | ServeArgs | HelpArgs | VersionArgs | SelftestArgs;

/** Chyba použití (neznámá volba, chybějící hodnota, neplatné číslo…) → kód ukončení 3. */
export class UsageError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "UsageError";
  }
}

export const DEFAULTS = {
  out: "mncad-out",
  budget: 2048,
  timeout: 300,
  maxMem: 2048,
  shareDays: 10,
  port: 8787,
  host: "127.0.0.1",
  jobs: 1,
  idleTimeout: 900,
} as const;

const LANG_IDS = CAD_LANGS.map((l) => l.id);
const isLang = (s: string): s is CadLang => (LANG_IDS as string[]).includes(s);

/** jazyk z prostředí (`MNCAD_LANG`), jinak čeština */
export function envLang(env: Record<string, string | undefined> = typeof process !== "undefined" ? process.env : {}): CadLang {
  const v = (env.MNCAD_LANG ?? "").trim().toLowerCase();
  return isLang(v) ? v : "cs";
}

/**
 * `list` (`--open a.mncad b.step …`): první hodnota po volbě se vezme vždy (nebo hodnota za `=`), další jen dokud vypadají
 * jako dokument (`more`) – `mncad run --open sestava.mncad skript.txt` tak skript nepohltí.
 */
type Spec = { kind: "flag" } | { kind: "value" } | { kind: "list"; more: RegExp } | { kind: "optional"; values?: readonly string[] };
/** přípony vstupních dokumentů (`--open`) – argument s jinou příponou ukončí seznam a je to skript */
export const DOC_ARG_RE = /\.(mncad|json|step|stp|iges|igs|stl|dxf|dwg|pdf|svg|png|jpe?g|mncad-ws)$/i;
const RUN_SPEC: Record<string, Spec> = {
  out: { kind: "value" },
  strict: { kind: "optional" },
  share: { kind: "optional", values: ["model", "drawing", "výkres", "vykres", "zeichnung"] },
  "share-days": { kind: "value" },
  "share-store": { kind: "value" },
  formats: { kind: "value" },
  doc: { kind: "value" },
  "all-docs": { kind: "flag" },
  open: { kind: "list", more: DOC_ARG_RE },
  files: { kind: "value" },
  resume: { kind: "value" },
  json: { kind: "flag" },
  full: { kind: "flag" },
  notes: { kind: "flag" },
  budget: { kind: "value" },
  lang: { kind: "value" },
  timeout: { kind: "value" },
  "max-mem": { kind: "value" },
  progress: { kind: "flag" },
  "no-output-on-error": { kind: "flag" },
};
const SERVE_SPEC: Record<string, Spec> = {
  port: { kind: "value" },
  host: { kind: "value" },
  "token-file": { kind: "value" },
  jobs: { kind: "value" },
  "max-mem": { kind: "value" },
  timeout: { kind: "value" },
  "allow-remote": { kind: "flag" },
  "allow-host": { kind: "value" },
  out: { kind: "value" },
  "idle-timeout": { kind: "value" },
  lang: { kind: "value" },
};
const SIMPLE_SPEC: Record<string, Spec> = { json: { kind: "flag" }, lang: { kind: "value" }, timeout: { kind: "value" }, "max-mem": { kind: "value" } };

type Parsed = { opts: Map<string, string | true | string[]>; pos: string[] };

function parseOpts(argv: string[], spec: Record<string, Spec>, cmd: string): Parsed {
  const opts = new Map<string, string | true | string[]>();
  const pos: string[] = [];
  let i = 0;
  let rest = false;
  while (i < argv.length) {
    const a = argv[i++];
    if (rest || a === "-" || !a.startsWith("--")) {
      pos.push(a);
      continue;
    }
    if (a === "--") {
      rest = true;
      continue;
    }
    const eq = a.indexOf("=");
    const name = (eq >= 0 ? a.slice(2, eq) : a.slice(2)).toLowerCase();
    const inline = eq >= 0 ? a.slice(eq + 1) : undefined;
    const s = spec[name];
    if (!s) throw new UsageError(tr("neznámá volba „{0}“ příkazu {1} – mncad help", `--${name}`, cmd));
    if (opts.has(name) && s.kind !== "list") throw new UsageError(tr("volba „{0}“ je zadaná dvakrát", `--${name}`));
    if (s.kind === "flag") {
      if (inline !== undefined) throw new UsageError(tr("volba „{0}“ nemá hodnotu", `--${name}`));
      opts.set(name, true);
    } else if (s.kind === "value") {
      const v = inline ?? argv[i++];
      if (v === undefined || (inline === undefined && v.startsWith("--"))) throw new UsageError(tr("volbě „{0}“ chybí hodnota", `--${name}`));
      opts.set(name, v);
    } else if (s.kind === "optional") {
      // `--share model` i `--share=model`; samostatná hodnota jen ze seznamu, aby `--share skript.txt` nepohltilo skript
      if (inline !== undefined) opts.set(name, inline);
      else if (s.values && argv[i] !== undefined && s.values.includes(argv[i].toLowerCase())) opts.set(name, argv[i++]);
      else opts.set(name, true);
    } else {
      const list = (opts.get(name) as string[] | undefined) ?? [];
      const n0 = list.length;
      if (inline !== undefined) list.push(inline);
      else if (i < argv.length && !argv[i].startsWith("--") && argv[i] !== "-") list.push(argv[i++]);
      while (i < argv.length && !argv[i].startsWith("--") && s.more.test(argv[i])) list.push(argv[i++]);
      if (list.length === n0 || (inline !== undefined && !inline)) throw new UsageError(tr("volbě „{0}“ chybí hodnota", `--${name}`));
      opts.set(name, list);
    }
  }
  return { opts, pos };
}

/** celé číslo z volby v rozsahu ⟨min, max⟩ */
function intOpt(p: Parsed, name: string, def: number, min: number, max: number): number {
  const v = p.opts.get(name);
  if (v === undefined) return def;
  const s = String(v).trim();
  if (!/^\d+$/.test(s)) throw new UsageError(tr("volba „{0}“ potřebuje celé číslo, ne „{1}“", `--${name}`, s));
  const n = Number(s);
  if (n < min || n > max) throw new UsageError(tr("volba „{0}“: {1} je mimo rozsah {2}–{3}", `--${name}`, n, min, max));
  return n;
}

function langOpt(p: Parsed): CadLang {
  const v = p.opts.get("lang");
  if (v === undefined) return envLang();
  const s = String(v).toLowerCase();
  if (!isLang(s)) throw new UsageError(tr("neznámý jazyk „{0}“ – cs, en, de", String(v)));
  return s;
}

/** `--strict`, `--strict=kód,kód` nebo `--strict=kromě kód,kód` (EN except, DE außer) – kódy, které běh nezastaví */
export function parseStrict(v: string | true | undefined): StrictOpt {
  if (v === undefined) return false;
  if (v === true) return true;
  const s = v.trim().replace(/^(kromě|krome|except|außer|ausser)[\s:=]*/i, "");
  const except = s.split(/[\s,;]+/).filter(Boolean);
  for (const c of except) if (!/^[a-z0-9]+(?:[.-][a-z0-9]+)*$/.test(c)) throw new UsageError(tr("„{0}“ není kód hlášky (např. select.ambiguous)", c));
  return except.length ? { except } : true;
}

/** `--formats auto|none|step,pdf,…` */
export function parseFormats(v: string | undefined): Formats {
  if (v === undefined) return "auto";
  const s = v.trim().toLowerCase();
  if (s === "auto" || s === "none") return s;
  const list = s.split(/[\s,;]+/).filter(Boolean);
  if (!list.length) throw new UsageError(tr("volbě „{0}“ chybí hodnota", "--formats"));
  const out: OutFormat[] = [];
  for (const f of list) {
    const k = f === "stp" ? "step" : f;
    if (!(OUT_FORMATS as readonly string[]).includes(k)) throw new UsageError(tr("neznámý formát „{0}“ – {1}", f, ["auto", "none", ...OUT_FORMATS].join(", ")));
    if (!out.includes(k as OutFormat)) out.push(k as OutFormat);
  }
  return out;
}

function shareOpt(v: string | true | undefined): false | ShareView {
  if (v === undefined) return false;
  if (v === true) return "model";
  const s = v.toLowerCase();
  if (s === "model") return "model";
  if (["drawing", "výkres", "vykres", "zeichnung"].includes(s)) return "drawing";
  throw new UsageError(tr("volba „{0}“: neznámý pohled „{1}“ – model, drawing", "--share", v));
}

/** Rozbor `argv` (bez `node` a cesty skriptu). Vyhodí `UsageError`. */
export function parseArgs(argv: string[]): CliArgs {
  const [cmd0, ...rest] = argv;
  const cmd = (cmd0 ?? "").toLowerCase();
  if (!cmd || cmd === "help" || cmd === "--help" || cmd === "-h" || cmd === "nápověda" || cmd === "napoveda") {
    const p = parseOpts(rest, { lang: { kind: "value" } }, "help");
    return { cmd: "help", topic: p.pos, lang: langOpt(p) };
  }
  if (cmd === "version" || cmd === "--version" || cmd === "-v") {
    const p = parseOpts(rest, SIMPLE_SPEC, "version");
    if (p.pos.length) throw new UsageError(tr("nadbytečný argument „{0}“", p.pos[0]));
    return { cmd: "version", json: p.opts.has("json"), lang: langOpt(p) };
  }
  if (cmd === "selftest") {
    const p = parseOpts(rest, SIMPLE_SPEC, "selftest");
    if (p.pos.length) throw new UsageError(tr("nadbytečný argument „{0}“", p.pos[0]));
    return { cmd: "selftest", json: p.opts.has("json"), lang: langOpt(p), timeout: intOpt(p, "timeout", 120, 0, 86_400), maxMem: intOpt(p, "max-mem", DEFAULTS.maxMem, 0, 1_048_576) };
  }
  if (cmd === "run") {
    const p = parseOpts(rest, RUN_SPEC, "run");
    if (!p.pos.length) throw new UsageError(tr("chybí skript – mncad run <skript.txt|-> (mncad help)"));
    if (p.pos.length > 1) throw new UsageError(tr("nadbytečný argument „{0}“", p.pos[1]));
    const str = (n: string) => (p.opts.has(n) ? String(p.opts.get(n)) : undefined);
    const shareStore = str("share-store");
    if (shareStore !== undefined && !/^(https?:\/\/\S+|off|0|false|no)$/i.test(shareStore)) throw new UsageError(tr("volba „{0}“ potřebuje adresu http(s)://… nebo off", "--share-store"));
    const doc = str("doc");
    if (doc !== undefined && !doc.trim()) throw new UsageError(tr("volbě „{0}“ chybí hodnota", "--doc"));
    return {
      cmd: "run",
      script: p.pos[0],
      out: str("out") ?? DEFAULTS.out,
      strict: parseStrict(p.opts.get("strict") as string | true | undefined),
      share: shareOpt(p.opts.get("share") as string | true | undefined),
      shareDays: intOpt(p, "share-days", DEFAULTS.shareDays, 1, 90),
      ...(shareStore !== undefined ? { shareStore } : {}),
      formats: parseFormats(str("formats")),
      ...(doc !== undefined ? { doc: doc.trim() } : {}),
      allDocs: p.opts.has("all-docs"),
      open: (p.opts.get("open") as string[] | undefined) ?? [],
      ...(str("files") !== undefined ? { files: str("files") } : {}),
      ...(str("resume") !== undefined ? { resume: str("resume") } : {}),
      json: p.opts.has("json"),
      full: p.opts.has("full"),
      notes: p.opts.has("notes"),
      budget: intOpt(p, "budget", DEFAULTS.budget, 1, 1_048_576),
      lang: langOpt(p),
      timeout: intOpt(p, "timeout", DEFAULTS.timeout, 0, 86_400),
      maxMem: intOpt(p, "max-mem", DEFAULTS.maxMem, 0, 1_048_576),
      progress: p.opts.has("progress"),
      noOutputOnError: p.opts.has("no-output-on-error"),
    };
  }
  if (cmd === "serve") {
    const p = parseOpts(rest, SERVE_SPEC, "serve");
    if (p.pos.length) throw new UsageError(tr("nadbytečný argument „{0}“", p.pos[0]));
    const host = String(p.opts.get("host") ?? DEFAULTS.host).trim();
    if (!host) throw new UsageError(tr("volbě „{0}“ chybí hodnota", "--host"));
    const allowHosts = String(p.opts.get("allow-host") ?? "")
      .split(/[\s,]+/)
      .map((s) => s.trim().toLowerCase())
      .filter(Boolean);
    return {
      cmd: "serve",
      port: intOpt(p, "port", DEFAULTS.port, 0, 65_535),
      host,
      ...(p.opts.has("token-file") ? { tokenFile: String(p.opts.get("token-file")) } : {}),
      jobs: intOpt(p, "jobs", DEFAULTS.jobs, 1, 64),
      maxMem: intOpt(p, "max-mem", DEFAULTS.maxMem, 0, 1_048_576),
      timeout: intOpt(p, "timeout", DEFAULTS.timeout, 0, 86_400),
      allowRemote: p.opts.has("allow-remote"),
      allowHosts,
      ...(p.opts.has("out") ? { out: String(p.opts.get("out")) } : {}),
      idleTimeout: intOpt(p, "idle-timeout", DEFAULTS.idleTimeout, 1, 86_400),
      lang: langOpt(p),
    };
  }
  throw new UsageError(tr("neznámý příkaz „{0}“ – run, serve, help, version, selftest", cmd0));
}

/** nápověda k použití (lokalizovaná; názvy voleb a formátů jsou ve všech jazycích stejné) */
export function usageText(): string {
  return [
    tr("MN CAD bez prohlížeče – textový skript dovnitř; chyby s čísly řádků, měření, soubory a odkaz ven."),
    "",
    tr("Použití:"),
    "  mncad run <skript.txt|-> [--out DIR] [--formats auto|none|step,pdf,dxf,dwg,svg,stl,csv,mncad] [--json] [--full]",
    "            [--strict[=kód,…]] [--share[=model|drawing]] [--share-days N] [--share-store URL] [--doc \"…\"] [--all-docs]",
    "            [--open soubor…] [--files DIR] [--resume session.mncad-ws] [--notes] [--budget 2048] [--lang cs|en|de]",
    "            [--timeout 300] [--max-mem 2048] [--progress] [--no-output-on-error]",
    "  mncad serve [--port 8787] [--host 127.0.0.1] [--token-file F] [--jobs 1] [--max-mem 2048] [--timeout 300]",
    "              [--allow-remote --allow-host name,…] [--out DIR] [--idle-timeout 900]",
    "  mncad help [guide|commands] · mncad version · mncad selftest [--json]",
    "",
    tr("Kódy ukončení: 0 bez chyb · 1 chyby ✗ · 2 přísný režim zastaven · 3 chyba použití nebo souboru · 4 pád výpočtu · 5 časový limit · 6 limit paměti · 130 přerušeno"),
    tr("Výstupy: --out (výchozí ./mncad-out); --formats auto = STEP + .mncad hlavního dokumentu a PDF listů výkresu."),
    tr("Protokol: stručný (≤ 2 048 B, přebytek v protocol-full.txt), --json = jeden JSON objekt, --full = celý protokol."),
    tr("mncad help guide = celý návod pro AI agenty · mncad help commands = seznam textových příkazů"),
  ].join("\n");
}
