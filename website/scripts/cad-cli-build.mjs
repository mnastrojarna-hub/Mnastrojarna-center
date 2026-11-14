#!/usr/bin/env node
/**
 * Svazek CLI `mncad` (CAD-HEADLESS-NAVRH.md kap. 3.6) – rolldown, `platform: "node"`, minifikovaný, jen `node:` externí.
 *
 *   node scripts/cad-cli-build.mjs [--out public/cad/cli] [--keep 2] [--no-tgz] [--if-stale] [--quiet]
 *   node scripts/cad-cli-build.mjs --if-stale --run <argumenty mncad…>      (npm run mncad -- run skript.txt --out /tmp/x)
 *
 * Výstup (generuje se v `prebuild`, je v .gitignore – jako public/vendor/occt-*):
 *   public/cad/cli/<verze>/  mncad.mjs, replicad_single.wasm (vedle svazku – emscripten ho hledá u import.meta.url),
 *                            fonts/Roboto-{Regular,Bold}.ttf, package.json (bin mncad, engines node >=22),
 *                            THIRD_PARTY_LICENSES.txt, README.txt, mncad-<verze>.tgz (npx), SHA256SUMS
 *   public/cad/cli/latest.json, public/cad/cli/README.txt  (bez mezipaměti – gen-htaccess.mjs)
 * Verze = <základ>-<prvních 8 znaků SHA-256 svazku a WASM>; ponechají se 2 nejnovější verze (statický hosting, 23 MB WASM).
 *
 * Hranice (kap. 2.2): sestavení SELŽE, je-li v grafu modulů svazku `src/cad/client.ts` (prohlížečový Web Worker) nebo
 * cokoli ze `src/components/**` – ESLint pravidlo nechytí dynamický import, tato kontrola ano.
 */
import crypto from "node:crypto";
import fs from "node:fs";
import { builtinModules, createRequire } from "node:module";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";
import zlib from "node:zlib";

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SRC = path.join(ROOT, "src");
export const BASE_VERSION = "0.1.0";
const ENTRY_ID = "\0mncad-entry";
const MAIN_TS = path.join(SRC, "cad", "cli", "main.ts");
const VERSION_DIR = /^\d+\.\d+\.\d+-[0-9a-f]{8}$/;

/** moduly, které ve svazku CLI být nesmí (prohlížečový klient jádra, UI komponenty) */
export function forbiddenModules(ids, src = SRC) {
  const norm = (id) => id.replace(/\\/g, "/").replace(/\?.*$/, "");
  const client = norm(path.join(src, "cad", "client.ts"));
  const comps = norm(path.join(src, "components")) + "/";
  return ids.map(norm).filter((id) => id === client || id.startsWith(comps) || /\/src\/cad\/client\.(ts|js)$/.test(id) || /\/src\/components\//.test(id));
}

const BUILTIN = new Set(builtinModules.flatMap((m) => [m, `node:${m}`]));

/**
 * Sestaví svazek do `outFile`. `entry` = vstupní modul (výchozí virtuální vstup, který zavolá `boot()` z cli/main.ts).
 * Vrací seznam modulů grafu; při zakázaném modulu vyhodí chybu (a soubor nezapíše).
 */
export async function bundle({ outFile, entryCode, minify = true, src = SRC } = {}) {
  const require = createRequire(path.join(ROOT, "package.json"));
  const { build } = await import(pathToFileURL(require.resolve("rolldown")).href);
  let moduleIds = [];
  let externals = [];
  const warnings = [];
  const t0 = Date.now();
  await build({
    input: ENTRY_ID,
    platform: "node",
    cwd: ROOT,
    resolve: { alias: { "@": src } },
    external: (id) => BUILTIN.has(id) || id.startsWith("node:"),
    logLevel: "warn",
    onLog(level, log) {
      if (level === "warn") warnings.push(log.message);
    },
    plugins: [
      {
        name: "mncad-entry",
        resolveId(id) {
          return id === ENTRY_ID ? ENTRY_ID : null;
        },
        load(id) {
          if (id !== ENTRY_ID) return null;
          return entryCode ?? `import { boot } from ${JSON.stringify(MAIN_TS)};\nvoid boot();\n`;
        },
      },
      {
        name: "mncad-boundary",
        generateBundle(_o, out) {
          moduleIds = Object.values(out).flatMap((c) => (c.type === "chunk" ? c.moduleIds : []));
          // externí importy (bez vlastních souborů výstupu – rolldown u vložených dynamických importů uvádí i sebe)
          const own = new Set(Object.keys(out));
          externals = [...new Set(Object.values(out).flatMap((c) => (c.type === "chunk" ? [...c.imports, ...c.dynamicImports] : [])))].filter((x) => !own.has(x)).sort();
          const bad = forbiddenModules(moduleIds, src);
          if (bad.length) this.error(`mncad: zakázané moduly ve svazku CLI (CAD-HEADLESS-NAVRH 2.2): ${bad.map((b) => path.relative(ROOT, b)).join(", ")}`);
        },
      },
    ],
    output: { file: outFile, format: "esm", codeSplitting: false, minify, banner: "#!/usr/bin/env node", comments: { legal: false } },
  });
  return { moduleIds, externals, warnings, ms: Date.now() - t0, bytes: fs.statSync(outFile).size };
}

/* ───────────────────────── tar (ustar) + gzip ───────────────────────── */

function octal(n, len) {
  return n.toString(8).padStart(len - 1, "0") + "\0";
}
/** archiv ustar: `entries` = { name, data, mode }; pevný čas pro opakovatelnost */
export function makeTar(entries, mtime = 1_700_000_000) {
  const blocks = [];
  for (const e of entries) {
    const name = Buffer.from(e.name, "utf8");
    if (name.length > 100) throw new Error(`tar: name too long ${e.name}`);
    const h = Buffer.alloc(512, 0);
    name.copy(h, 0);
    h.write(octal(e.mode ?? 0o644, 8), 100, "ascii");
    h.write(octal(0, 8), 108, "ascii");
    h.write(octal(0, 8), 116, "ascii");
    h.write(octal(e.data.length, 12), 124, "ascii");
    h.write(octal(mtime, 12), 136, "ascii");
    h.write("        ", 148, "ascii");
    h.write("0", 156, "ascii");
    h.write("ustar\0", 257, "ascii");
    h.write("00", 263, "ascii");
    let sum = 0;
    for (const b of h) sum += b;
    h.write(sum.toString(8).padStart(6, "0") + "\0 ", 148, "ascii");
    blocks.push(h, e.data);
    const pad = (512 - (e.data.length % 512)) % 512;
    if (pad) blocks.push(Buffer.alloc(pad, 0));
  }
  blocks.push(Buffer.alloc(1024, 0));
  return Buffer.concat(blocks);
}

/* ───────────────────────── licence ───────────────────────── */

/** balíky npm ve svazku (podle cest modulů) */
export function packagesOf(moduleIds) {
  const out = new Map();
  for (const id of moduleIds) {
    const m = /^(.*\/node_modules\/)((?:@[^/]+\/)?[^/]+)\//.exec(id.replace(/\\/g, "/"));
    if (m && !out.has(m[2])) out.set(m[2], m[1] + m[2]);
  }
  return [...out.entries()].sort((a, b) => a[0].localeCompare(b[0]));
}

function licenseText(moduleIds) {
  const parts = [
    "MN CAD CLI (mncad) – licence knihoven třetích stran / third-party licenses",
    "",
    "OpenCascade (replicad-opencascadejs) is licensed under LGPL-2.1 and ships as the separate, replaceable file",
    "replicad_single.wasm next to mncad.mjs. You may replace it with your own build of the same interface.",
    "",
    "Roboto (fonts/Roboto-Regular.ttf, fonts/Roboto-Bold.ttf) – Copyright Google LLC, Apache License 2.0",
    "(https://www.apache.org/licenses/LICENSE-2.0).",
    "",
  ];
  for (const [name, dir] of packagesOf(moduleIds)) {
    let pkg = {};
    try {
      pkg = JSON.parse(fs.readFileSync(path.join(dir, "package.json"), "utf8"));
    } catch {
      /* bez package.json */
    }
    const lic = fs.existsSync(dir) ? fs.readdirSync(dir).find((f) => /^(licen[cs]e|copying)(\.|$)/i.test(f)) : undefined;
    parts.push("=".repeat(100), `${name}@${pkg.version ?? "?"} – ${typeof pkg.license === "string" ? pkg.license : JSON.stringify(pkg.license ?? "unknown")}`, "=".repeat(100));
    parts.push(lic ? fs.readFileSync(path.join(dir, lic), "utf8").trim() : "(license file not included in the package)", "");
  }
  return parts.join("\n");
}

function readme(version) {
  return [
    `mncad ${version} – MN CAD bez prohlížeče / MN CAD without a browser`,
    "",
    "Požadavky: Node.js 22 nebo novější. Requirements: Node.js 22 or newer.",
    "",
    "Spuštění / Run:",
    `  npx -y https://www.mnastrojarna.cz/cad/cli/${version}/mncad-${version}.tgz run skript.txt --out out`,
    "  nebo stáhněte mncad.mjs, replicad_single.wasm a fonts/ do jedné složky / or download them into one folder:",
    "  node mncad.mjs run skript.txt --out out [--strict] [--share] [--formats step,pdf] [--json]",
    "  node mncad.mjs serve        (místní HTTP API / local HTTP API, token v ~/.config/mncad/token)",
    "  node mncad.mjs help · node mncad.mjs help guide · node mncad.mjs selftest",
    "",
    "Kódy ukončení / exit codes: 0 OK · 1 ✗ · 2 strict STOP · 3 usage/file · 4 crash · 5 timeout · 6 memory · 130 interrupted",
    "Ověření / verify: sha256sum -c SHA256SUMS",
    "Licence / licenses: THIRD_PARTY_LICENSES.txt (OpenCascade LGPL-2.1 jako samostatný soubor WASM).",
    "",
  ].join("\n");
}

const sha256 = (buf) => crypto.createHash("sha256").update(buf).digest("hex");

/** nejnovější čas změny souboru pod `dirs` */
function newestMtime(dirs) {
  let max = 0;
  const walk = (p) => {
    let st;
    try {
      st = fs.statSync(p);
    } catch {
      return;
    }
    if (st.isDirectory()) {
      for (const f of fs.readdirSync(p)) if (f !== "node_modules" && !f.startsWith(".")) walk(path.join(p, f));
    } else if (st.mtimeMs > max) max = st.mtimeMs;
  };
  for (const d of dirs) walk(d);
  return max;
}

/** aktuální sestavení (latest.json) – null, když chybí nebo je starší než zdroje */
export function currentBuild(outRoot) {
  try {
    const latest = JSON.parse(fs.readFileSync(path.join(outRoot, "latest.json"), "utf8"));
    const file = path.join(outRoot, latest.version, "mncad.mjs");
    if (!fs.existsSync(file)) return null;
    const built = fs.statSync(file).mtimeMs;
    if (newestMtime([SRC, path.join(ROOT, "package-lock.json"), fileURLToPath(import.meta.url)]) > built) return null;
    return { version: latest.version, file };
  } catch {
    return null;
  }
}

/** Celé sestavení distribuce do `outRoot` (výchozí public/cad/cli). */
export async function buildDist({ outRoot = path.join(ROOT, "public", "cad", "cli"), keep = 2, tgz = true, log = console.log } = {}) {
  fs.mkdirSync(outRoot, { recursive: true });
  const tmp = fs.mkdtempSync(path.join(outRoot, ".build-"));
  try {
    const tmpFile = path.join(tmp, "mncad.mjs");
    const b = await bundle({ outFile: tmpFile });
    const require = createRequire(path.join(ROOT, "package.json"));
    const wasmSrc = path.join(path.dirname(require.resolve("replicad-opencascadejs/package.json")), "dist", "replicad_single.wasm");
    const js = fs.readFileSync(tmpFile);
    const wasm = fs.readFileSync(wasmSrc);
    const version = `${BASE_VERSION}-${sha256(Buffer.concat([js, wasm])).slice(0, 8)}`;
    const dir = path.join(outRoot, version);
    const files = new Map();
    files.set("mncad.mjs", { data: js, mode: 0o755 });
    files.set("replicad_single.wasm", { data: wasm });
    for (const f of ["Roboto-Regular.ttf", "Roboto-Bold.ttf"]) files.set(`fonts/${f}`, { data: fs.readFileSync(path.join(ROOT, "public", "fonts", f)) });
    const pkg = {
      name: "mncad",
      version,
      description: "MN CAD without a browser: text script in; errors with line numbers, measurements, files and a link out.",
      type: "module",
      bin: { mncad: "mncad.mjs" },
      engines: { node: ">=22" },
      license: "SEE LICENSE IN THIRD_PARTY_LICENSES.txt",
      homepage: "https://www.mnastrojarna.cz/cad",
      files: ["mncad.mjs", "replicad_single.wasm", "fonts/", "THIRD_PARTY_LICENSES.txt", "README.txt"],
    };
    files.set("package.json", { data: Buffer.from(JSON.stringify(pkg, null, 2) + "\n") });
    files.set("THIRD_PARTY_LICENSES.txt", { data: Buffer.from(licenseText(b.moduleIds)) });
    files.set("README.txt", { data: Buffer.from(readme(version)) });
    const tgzName = `mncad-${version}.tgz`;
    if (tgz) {
      const tar = makeTar([...files.entries()].map(([name, f]) => ({ name: `package/${name}`, data: f.data, mode: f.mode ?? 0o644 })));
      files.set(tgzName, { data: zlib.gzipSync(tar, { level: 9 }) });
    }
    const sums = [...files.entries()].map(([name, f]) => `${sha256(f.data)}  ${name}`).join("\n") + "\n";
    files.set("SHA256SUMS", { data: Buffer.from(sums) });
    // zápis do dočasné složky a přejmenování (žádná napůl zapsaná verze)
    const stage = path.join(tmp, "stage");
    for (const [name, f] of files) {
      const p = path.join(stage, name);
      fs.mkdirSync(path.dirname(p), { recursive: true });
      fs.writeFileSync(p, f.data, { mode: f.mode ?? 0o644 });
    }
    fs.rmSync(dir, { recursive: true, force: true });
    fs.renameSync(stage, dir);
    const latest = {
      version,
      path: `${version}/`,
      bundle: `${version}/mncad.mjs`,
      tgz: tgz ? `${version}/${tgzName}` : null,
      node: ">=22",
      files: Object.fromEntries([...files.entries()].map(([name, f]) => [name, { bytes: f.data.length, sha256: sha256(f.data) }])),
      built: new Date().toISOString(),
    };
    fs.writeFileSync(path.join(outRoot, "latest.json"), JSON.stringify(latest, null, 2) + "\n");
    fs.writeFileSync(path.join(outRoot, "README.txt"), readme(version));
    // staré verze pryč (ponechat `keep` nejnovějších)
    const versions = fs
      .readdirSync(outRoot)
      .filter((d) => VERSION_DIR.test(d) && fs.statSync(path.join(outRoot, d)).isDirectory())
      .sort((x, y) => (x === version ? -1 : y === version ? 1 : fs.statSync(path.join(outRoot, y)).mtimeMs - fs.statSync(path.join(outRoot, x)).mtimeMs));
    for (const old of versions.slice(Math.max(1, keep))) fs.rmSync(path.join(outRoot, old), { recursive: true, force: true });
    log(`[cad-cli] ${path.relative(ROOT, dir)}: mncad.mjs ${js.length} B, WASM ${wasm.length} B, ${b.moduleIds.length} modulů, ${b.ms} ms${tgz ? `, ${tgzName} ${files.get(tgzName).data.length} B` : ""}`);
    for (const w of b.warnings.slice(0, 5)) log(`[cad-cli] varování: ${w.split("\n")[0]}`);
    return { version, dir, moduleIds: b.moduleIds, bytes: js.length, ms: b.ms };
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

/**
 * Argumenty skriptu sestavení: volby sestavení jen PŘED `--run`; vše za `--run` patří `mncad` (`npm run mncad -- run
 * skript.txt --out DIR` → `--out` je výstupní složka běhu, ne distribuce).
 */
export function parseBuildArgs(argv) {
  const runAt = argv.indexOf("--run");
  const own = runAt >= 0 ? argv.slice(0, runAt) : argv;
  const val = (n, d) => {
    const i = own.indexOf(n);
    return i >= 0 && own[i + 1] !== undefined ? own[i + 1] : d;
  };
  const has = (n) => own.includes(n);
  return {
    outRoot: path.resolve(val("--out", path.join(ROOT, "public", "cad", "cli"))),
    keep: Number(val("--keep", "2")) || 2,
    ifStale: has("--if-stale"),
    tgz: !has("--no-tgz"),
    quiet: has("--quiet"),
    run: runAt >= 0 ? argv.slice(runAt + 1) : null,
  };
}

async function cli(argv) {
  const o = parseBuildArgs(argv);
  let file = o.ifStale ? currentBuild(o.outRoot)?.file : null;
  if (!file) {
    const res = await buildDist({ outRoot: o.outRoot, keep: o.keep, tgz: o.tgz, log: o.quiet || o.run ? () => undefined : console.log });
    file = path.join(res.dir, "mncad.mjs");
  }
  if (!o.run) return 0;
  // npm run mncad -- …: spustit sestavený svazek; Ctrl+C dostane i potomek (stejná skupina procesů), rodič jen čeká
  const child = spawn(process.execPath, [file, ...o.run], { stdio: "inherit" });
  for (const s of ["SIGINT", "SIGTERM"]) process.on(s, () => undefined);
  return await new Promise((resolve) => child.on("exit", (code, sig) => resolve(code ?? (sig ? 128 + (sig === "SIGINT" ? 2 : 15) : 1))));
}

if (process.argv[1] && fs.realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)) {
  cli(process.argv.slice(2)).then(
    (code) => (process.exitCode = code),
    (e) => {
      console.error(`[cad-cli] sestavení selhalo: ${e?.message ?? e}`);
      process.exitCode = 1;
    },
  );
}
