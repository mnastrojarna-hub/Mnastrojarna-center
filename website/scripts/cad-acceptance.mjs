#!/usr/bin/env node
// Acceptance gate B6 (CAD-HEADLESS-NAVRH.md 10.2 / 10.4, package "acceptance"): items 1–5 of the agent's field report,
// measured on REAL runs of the BUILT CLI (public/cad/cli/<version>/mncad.mjs) as a subprocess – nothing hand-assembled.
//
//   npm run cad:acceptance [-- options]           = node scripts/cad-acceptance.mjs [options]
//   node scripts/cad-acceptance.mjs [<script> --expect FILE|JSON] [options]
//
// Cases (each run = `mncad run … --out <tmp> --formats step,pdf --share --share-store <php -S> --json`, wall time and the
// peak RSS (VmHWM of /proc/<pid>/status – the CLI job runs in worker_threads of the same process) measured outside):
//   synth      scripts/cad-harness/synth-959.txt + expected.json (generator check first: synth-tool.mjs --check), on every
//              Node of --node: components, mates ok, Σ volume (V.sum or V.union, decision 15.1), clash classes (real 0),
//              protocol ≤ 2048 B and every line in the grammar, < 120 s, ≤ 2048 MB, STEP check ok, PDF pages = sheets,
//              short link (≤ 200 chars) that reopens in Node with the same components; then the strict run: exit 0, no STOP,
//              overhead ≤ 25 % (wall, median of --runs), STEP bytes identical to the normal run
//   ops        every text op headless on the session of the synth run (--resume): stav, sestava vazby, kolize, pohyb stav,
//              výkres stav vše, kontrola sestava, kusovník, měřit těleso, export step, výkres export pdf vše, uložit,
//              sdílet úložiště – no ✗, no host.app-only, every line has a result
//   silent     repros of the "no silent change" inventory (B1 empty assembly kept, B2 27 parts, B4 counterbore + thread,
//              B5 section outside the part, B6 views that do not fit) – each behaves as decided or says so with ⚠/✗
//   script     the agent's real script (fixture 959-skript.txt, NDA – read from --fixtures, never copied): 70 / 53 /
//              5241.73 cm³ / real clashes 0 / 2048 B / 120 s (design 10.4) + outputs, link, strict consistency; every ⚠/✗ is
//              listed as a finding (triage)
//   doc        the agent's document (fixture 959-dokument.json via --open) with appended ops: the assembly is built (parts,
//              warnings of the component parts, exact envelope), outputs (one PDF of all sheets incl. embedded part sheets)
// Generic checks on every run: all distinct ⚠/✗ codes of the run are visible in the short protocol (real findings never
// pushed into the overflow), the D line of the main assembly carries m= and bbox=, a motion study gives ONE `= … motion`
// line, strict mode passes ⇔ the normal run has no ⚠/✗ (and stops on one of its codes otherwise), peak RSS vs the CLI
// default --max-mem.
//
// Options: --cli FILE (default: the current build, built when stale) · --node BIN[,BIN] (default this Node; CI: 22 and 24)
//   --only synth,ops,silent,script,doc · --runs N (strict overhead, default 1) · --no-strict · --share-store URL (external store;
//   default `php -S` with public/cad/share/index.php) · --no-share · --require-php (also when $CI is set: no PHP = FAIL)
//   --fixtures DIR (default $MNCAD_FIXTURES or website/.local/fixtures) · --expect-script / --expect-doc FILE|JSON (more
//   numbers for the real cases, kept outside the repository) · --timeout S per run (600) · --max-rss MB guard (4096)
//   --keep DIR (keep outputs) · --json FILE (verdict)
// Exit: 0 every check passed · 1 a check failed · 2 aborted (guard, crash, usage).
import { spawn, spawnSync } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import zlib from "node:zlib";
import { fileURLToPath, pathToFileURL } from "node:url";
import { load } from "./cad-harness/bundle.mjs";
import { median, runWatched } from "./cad-harness/proc.mjs";

const SELF = fileURLToPath(import.meta.url);
const WEB = path.resolve(path.dirname(SELF), "..");
const HARNESS = path.join(WEB, "scripts", "cad-harness");
const args = process.argv.slice(2);
const VALUE_OPTS = new Set(["--cli", "--node", "--only", "--runs", "--share-store", "--fixtures", "--expect", "--expect-script", "--expect-doc", "--timeout", "--max-rss", "--keep", "--json"]);
const flag = (f) => args.includes(f);
const opt = (f, d) => (args.includes(f) ? args[args.indexOf(f) + 1] : d);
const positional = args.filter((a, i) => !a.startsWith("--") && !VALUE_OPTS.has(args[i - 1]));

/** design 10.4: the agent's script in ONE call – only the numbers the design names (the document is under NDA) */
export const REAL_SCRIPT = { components: 70, mates: { total: 53, ok: 53 }, volume_cm3: 5241.73, clashes: { real: 0 }, protocolMaxBytes: 2048, maxSeconds: 120, maxRssMB: 2048, pdfTextsMin: 100 };
/** the agent's document opened with --open: same numbers (mass, envelope, pages… only from --expect-doc, outside the repo) */
export const REAL_DOC = { components: 70, mates: { total: 53, ok: 53 }, volume_cm3: 5241.73, clashes: { real: 0 }, protocolMaxBytes: 2048, maxSeconds: 120, maxRssMB: 2048 };
/** gate thresholds for the synthetic tool on top of expected.json (the A1 sheet with BOM, balloons and title block) */
const SYNTH_EXTRA = { pdfTextsMin: 100 };

/* ───────────────────────── checks ───────────────────────── */

export const results = [];
export const findings = [];
const say = (s) => (process.env.CAD_ACCEPTANCE_QUIET ? undefined : process.stderr.write(`${s}\n`));
const short = (v) => (v === undefined ? "" : typeof v === "string" ? v : JSON.stringify(v));
/** one check: ok / FAIL with details (the verdict JSON keeps all of them) */
function check(cs, name, ok, detail) {
  results.push({ case: cs, check: name, status: ok ? "ok" : "fail", ...(detail !== undefined ? { detail } : {}) });
  say(`${ok ? "ok" : "FAIL"}: [${cs}] ${name}${detail !== undefined ? ` – ${short(detail).slice(0, 400)}` : ""}`);
  return ok;
}
function skip(cs, name, why) {
  results.push({ case: cs, check: name, status: "skip", detail: why });
  say(`skip: [${cs}] ${name} – ${why}`);
}
function note(cs, name, detail) {
  results.push({ case: cs, check: name, status: "note", detail });
  say(`# [${cs}] ${name}: ${short(detail).slice(0, 600)}`);
}

/* ───────────────────────── helpers ───────────────────────── */

const readJson = (v) => (v === undefined ? undefined : fs.existsSync(v) ? JSON.parse(fs.readFileSync(v, "utf8")) : JSON.parse(v));
const sha = (file) => crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const near = (a, b, tol) => Number.isFinite(a) && Math.abs(a - b) <= tol;

function freePort() {
  return new Promise((resolve, reject) => {
    const s = net.createServer();
    s.on("error", reject);
    s.listen(0, "127.0.0.1", () => {
      const p = s.address().port;
      s.close(() => resolve(p));
    });
  });
}

/** `php -S` with the real public/cad/share/index.php (the store writes next to the document root, inside `root`) */
async function startStore(root) {
  if (spawnSync("php", ["-v"], { stdio: "ignore" }).status !== 0) return null;
  const www = path.join(root, "www");
  fs.mkdirSync(path.join(www, "cad", "share"), { recursive: true });
  fs.copyFileSync(path.join(WEB, "public", "cad", "share", "index.php"), path.join(www, "cad", "share", "index.php"));
  const port = await freePort();
  const proc = spawn("php", ["-S", `127.0.0.1:${port}`, "-t", www], { stdio: "ignore" });
  const base = `http://127.0.0.1:${port}/cad/share/`;
  for (let i = 0; i < 200; i++) {
    try {
      if ((await fetch(`${base}?ping`)).ok) return { base, stop: () => proc.kill() };
    } catch {
      /* not up yet */
    }
    await sleep(50);
  }
  proc.kill();
  return null;
}

/** the built CLI bundle: --cli, else the current build (latest.json), built now when missing or older than the sources */
async function resolveCli() {
  if (opt("--cli")) return path.resolve(opt("--cli"));
  const b = await import(pathToFileURL(path.join(WEB, "scripts", "cad-cli-build.mjs")).href);
  const outRoot = path.join(WEB, "public", "cad", "cli");
  const cur = b.currentBuild(outRoot);
  if (cur) return cur.file;
  say("# building the CLI bundle (scripts/cad-cli-build.mjs)");
  const r = await b.buildDist({ outRoot, log: (m) => say(`# ${m}`) });
  return path.join(r.dir, "mncad.mjs");
}

/** PDF: pages and text-show operators (content streams inflated) – the A1 sheet without BOM/balloons/mass had ~30 texts */
export function pdfInfo(file) {
  const b = fs.readFileSync(file);
  const s = b.toString("latin1");
  const pages = (s.match(/\/Type\s*\/Page(?![a-zA-Z])/g) ?? []).length;
  let texts = 0;
  const re = /(?<!end)stream\r?\n/g;
  let m;
  while ((m = re.exec(s))) {
    const start = m.index + m[0].length;
    const end = s.indexOf("endstream", start);
    if (end < 0) break;
    let data = b.subarray(start, end);
    try {
      data = zlib.inflateSync(data, { finishFlush: zlib.constants.Z_SYNC_FLUSH });
    } catch {
      /* not deflated */
    }
    texts += (data.toString("latin1").match(/(?:\)|>)\s*Tj|\]\s*TJ/g) ?? []).length;
    re.lastIndex = end + 9;
  }
  return { pages, texts };
}

/** one `mncad` run under the watchdog of the harness: exit, wall time, peak RSS, the JSON report */
async function mncad(node, cli, argv) {
  const res = await runWatched([cli, ...argv], { cmd: node, maxRss: Number(opt("--max-rss", 4096)), timeoutS: Number(opt("--timeout", 600)), env: { ...process.env, MNCAD_LANG: "cs" } });
  let report = null;
  try {
    report = JSON.parse(res.stdout);
  } catch {
    /* not JSON (crash, usage) */
  }
  const out = argv.includes("--out") ? argv[argv.indexOf("--out") + 1] : null;
  const run = { exit: res.code, signal: res.signal, aborted: res.aborted, wallMs: res.wallMs, peakMB: res.peakRssMB, report };
  // --keep: the JSON report and the measurement next to the outputs of the run (triage later)
  if (opt("--keep") && out) {
    fs.mkdirSync(out, { recursive: true });
    fs.writeFileSync(path.join(out, "acceptance-run.json"), `${JSON.stringify({ argv, ...run, report: report ?? res.stdout.slice(0, 20000) }, null, 1)}\n`);
  }
  return run;
}

const mainDoc = (r) => r?.docs?.find((d) => d.main) ?? [...(r?.docs ?? [])].reverse().find((d) => d.kind === "assembly");
const problems = (r) => (r?.entries ?? []).filter((e) => e.level === "warn" || e.level === "error");
const protoLines = (r) => String(r?.protocol ?? "").split("\n");

/** ⚠/✗ of a run grouped by code and document (triage list) */
function triage(cs, r) {
  const by = new Map();
  for (const e of problems(r)) {
    const k = `${e.level === "error" ? "✗" : "⚠"} ${e.code ?? "-"}${e.doc ? ` "${e.doc}"` : ""}`;
    const g = by.get(k) ?? { n: 0, lines: [], text: e.text };
    g.n += e.count ?? 1;
    for (const l of e.lines ?? [e.line]) if (l !== null && l !== undefined && g.lines.length < 8) g.lines.push(l);
    by.set(k, g);
  }
  for (const [k, g] of by) {
    const f = { case: cs, what: k, n: g.n, lines: g.lines, text: String(g.text).slice(0, 220) };
    findings.push(f);
    say(`# finding [${cs}] ${k} ×${g.n}${g.lines.length ? ` L${g.lines.join(",L")}` : ""}: ${f.text}`);
  }
}

/* ───────────────────────── assertions on one run ───────────────────────── */

/** protocol, grammar, time, memory, the main assembly against `exp`, outputs and link */
export async function checkRun(cs, run, exp, ctx) {
  const r = run.report;
  if (!check(cs, "run finished with a JSON report", !!r && !run.aborted, { exit: run.exit, signal: run.signal, aborted: run.aborted })) return false;
  check(cs, "exit 0, header OK, no ✗", run.exit === 0 && r.ok === true && r.counts.errors === 0, { exit: run.exit, ok: r.ok, counts: r.counts });
  const bytes = ctx.lib.utf8Bytes(r.protocol) + 1;
  check(cs, `protocol ≤ ${exp.protocolMaxBytes ?? 2048} B (UTF-8, real run)`, bytes <= (exp.protocolMaxBytes ?? 2048), { bytes });
  const bad = protoLines(r).filter((l) => !ctx.lib.grammarKind(l));
  check(cs, "every protocol line matches the grammar (design 4.2)", bad.length === 0, bad.length ? bad.slice(0, 3) : { lines: protoLines(r).length });
  check(cs, "header first, Σ last", /^MNCAD\/1 /.test(protoLines(r)[0]) && /^Σ /.test(protoLines(r).at(-1)), { first: protoLines(r)[0], last: protoLines(r).at(-1) });
  check(cs, `wall time < ${exp.maxSeconds ?? 120} s`, run.wallMs < (exp.maxSeconds ?? 120) * 1000, { s: +(run.wallMs / 1000).toFixed(1), jobS: +(r.ms / 1000).toFixed(1) });
  check(cs, `peak RSS ≤ ${exp.maxRssMB ?? 2048} MB`, run.peakMB <= (exp.maxRssMB ?? 2048), { peakMB: run.peakMB, reportPeakMB: r.peakMB });
  // real findings must stay visible: every distinct ⚠/✗ code (per document) of the run has a line in the short protocol
  const want = new Map();
  for (const e of problems(r)) want.set(`${e.level}|${e.code}|${e.doc ?? ""}`, e);
  const lines = protoLines(r);
  const hidden = [...want.values()].filter((e) => !lines.some((l) => l.startsWith(e.level === "error" ? "✗ " : "⚠ ") && l.includes(` ${e.code}`) && (!e.doc || l.includes(`"${e.doc.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`))));
  check(cs, "every ⚠/✗ code (per document) is visible in the short protocol", hidden.length === 0, hidden.length ? hidden.slice(0, 4).map((e) => `${e.code} "${e.doc ?? ""}" L${e.line}`) : { distinct: want.size });
  const main = mainDoc(r);
  if (exp.components !== undefined) {
    check(cs, `components = ${exp.components}`, main?.components === exp.components, { got: main?.components });
    const m = main?.mates;
    if (exp.mates) check(cs, `mates ok ${exp.mates.ok}/${exp.mates.total}`, m?.ok === exp.mates.ok && m?.total === exp.mates.total, { got: m });
    // decision 15.1: V.sum or V.union within 0.01 % (or the tolerance of expected.json); the protocol shows which one
    const tol = exp.volume_tol_cm3 ?? exp.volume_cm3 * 1e-4;
    const vs = (main?.volume_mm3 ?? NaN) / 1000;
    const vu = (main?.volume_union_mm3 ?? NaN) / 1000;
    const want2 = exp.volume_union_cm3 !== undefined ? [exp.volume_cm3, exp.volume_union_cm3] : [exp.volume_cm3];
    const hit = near(vs, exp.volume_cm3, tol) ? "V.sum" : want2.some((w) => near(vu, w, tol)) ? "V.union" : null;
    check(cs, `Σ volume ${exp.volume_cm3} cm³ (V.sum or V.union ± ${+tol.toFixed(4)})`, !!hit, { matched: hit, vSum: +vs.toFixed(3), vUnion: +vu.toFixed(3) });
    if (exp.volume_union_cm3 !== undefined) check(cs, `V.union ${exp.volume_union_cm3} cm³`, near(vu, exp.volume_union_cm3, tol), { vUnion: +vu.toFixed(3) });
    const c = main?.clashes;
    if (exp.clashes) {
      for (const k of ["total", "thread", "real", "undetermined"]) if (exp.clashes[k] !== undefined) check(cs, `clash ${k} = ${exp.clashes[k]}`, c?.[k] === exp.clashes[k], { got: c });
    }
    if (exp.mass_kg !== undefined) check(cs, `mass ${exp.mass_kg} kg`, near(main?.mass_kg, exp.mass_kg, exp.mass_tol_kg ?? 0.001), { got: main?.mass_kg });
    if (exp.bbox_mm) {
      const b = main?.bbox;
      const size = b ? [0, 1, 2].map((i) => +(b[1][i] - b[0][i]).toFixed(3)) : null;
      check(cs, `exact envelope ${exp.bbox_mm.join(" × ")} mm`, !!size && size.every((v, i) => near(v, exp.bbox_mm[i], 0.05)), { got: size });
    }
  }
  // D line of the main assembly: comps, parts, mates, V.sum, V.union, m, bbox, clash classes (finding 959 #1)
  if (main?.kind === "assembly") {
    const d = lines.find((l) => l.startsWith(`D "${main.name.replace(/"/g, '\\"')}" asm `));
    const keys = ["comp=", "parts=", "mates=", "V.sum=", "m=", "bbox="];
    check(cs, "D line of the main assembly with comp, parts, mates, V.sum, m, bbox", !!d && keys.every((k) => d.includes(` ${k}`)), d ?? "no D line");
  }
  if (exp.sheets !== undefined) {
    const sum = (r.docs ?? []).reduce((a, d) => a + (d.sheets ?? 0), 0);
    check(cs, `sheets of all documents = ${exp.sheets}`, sum === exp.sheets, { got: sum });
  }
  // outputs: STEP re-read check, PDF pages = sheets (the F line says how many sheets it holds)
  const files = r.files ?? [];
  const step = files.find((f) => f.format === "step");
  if (ctx.formats.includes("step")) {
    const ok = !!step?.path && fs.existsSync(step.path) && fs.readFileSync(step.path).subarray(0, 13).toString() === "ISO-10303-21;";
    check(cs, "STEP written, check by re-reading = ok, F line check=ok", ok && step.check?.ok === true && lines.some((l) => l.startsWith("F step ") && l.includes("check=ok")), { file: step?.name, check: step?.check?.text });
  }
  if (ctx.formats.includes("pdf")) {
    const pdfs = files.filter((f) => f.format === "pdf");
    if (check(cs, "PDF written", pdfs.length > 0 && pdfs.every((f) => f.path && fs.existsSync(f.path)), pdfs.map((f) => f.name))) {
      const info = pdfs.map((f) => ({ name: f.name, sheets: f.sheets ?? 1, ...pdfInfo(f.path) }));
      check(cs, "PDF pages = sheets (F line)", info.every((x) => x.pages === x.sheets), info);
      if (exp.pdfPages !== undefined) check(cs, `PDF of the main document: ${exp.pdfPages} pages`, info[0]?.pages === exp.pdfPages, info[0]);
      if (exp.pdfTextsMin !== undefined) check(cs, `assembly sheet with BOM, balloons, title block (≥ ${exp.pdfTextsMin} texts in the PDF)`, info[0]?.texts >= exp.pdfTextsMin, { texts: info[0]?.texts });
    }
  }
  if (ctx.share) await checkLink(cs, r, main, ctx);
  else if (ctx.shareSkip) skip(cs, "short link reopens in Node", ctx.shareSkip);
  return true;
}

/** the --share link: short (≤ 200 chars, store), O line in the protocol, reopens in Node with the same components */
async function checkLink(cs, r, main, ctx) {
  const s = r.share;
  if (!check(cs, "link: O line and JSON share", !!s && protoLines(r).some((l) => l.startsWith("O ")), s ?? "no share")) return;
  check(cs, "link is short (≤ 200 chars, mode self|store)", s.url.length <= 200 && (s.mode === "self" || s.mode === "store"), { chars: s.url.length, mode: s.mode });
  const o = await ctx.lib.openLink(s.url, ctx.share.base);
  check(cs, "link reopens in Node (openShareLink) with the same components", o.ok && (main?.kind !== "assembly" || o.components === main.components) && o.name === main?.name, o);
}

/** strict mode passes ⇔ the normal run has no ⚠/✗; otherwise STOP on one of the normal run's codes, no --formats files */
export function checkStrict(cs, normal, strict, expectClean) {
  const r = strict.report;
  if (!check(cs, "strict run finished with a JSON report", !!r && !strict.aborted, { exit: strict.exit, aborted: strict.aborted })) return;
  const dirty = problems(normal.report);
  if (expectClean !== undefined) check(cs, expectClean ? "normal run has no ⚠/✗ (a strict run must pass)" : "normal run has ⚠/✗", (dirty.length === 0) === expectClean, { problems: dirty.length });
  if (!dirty.length) check(cs, "strict run passes: exit 0, no STOP", strict.exit === 0 && !r.stopped && r.ok === true, { exit: strict.exit, stopped: r.stopped });
  else {
    const codes = new Set(dirty.map((e) => e.code));
    check(cs, "strict run stops (exit 2, STOP) on a code of the normal run, writes no --formats outputs", strict.exit === 2 && !!r.stopped && codes.has(r.stopped.code) && (r.files ?? []).length === 0, { exit: strict.exit, stopped: r.stopped, files: (r.files ?? []).length });
  }
}

/** the one-line motion summary (finding 959 #3): `= L<n> asm "<doc>" motion steps=… travel=…` */
export function checkMotion(cs, r, exp) {
  const line = protoLines(r).find((l) => /^= L\d+ asm "(?:[^"\\]|\\.)*" motion steps=/.test(l));
  if (!check(cs, "motion study: one summary line `= … motion steps=… travel=…` in the short protocol", !!line, line ?? protoLines(r).filter((l) => l.startsWith("= ")).slice(0, 4))) return;
  const travel = /travel=(\S+)/.exec(line)?.[1] ?? "";
  const groups = travel.split(",").filter(Boolean).map((g) => ({ mm: Number(g.split("mm:")[0]), n: Number(g.split(":")[1]) }));
  note(cs, "motion", { line, groups });
  for (const t of exp?.travel_mm ?? []) check(cs, `motion: a rigid group travels ${t} mm`, groups.some((g) => near(g.mm, t, 0.05)), groups);
}

/* ───────────────────────── cases ───────────────────────── */

const OUT_ARGS = (out, ctx) => ["--out", out, "--formats", ctx.formats.join(","), "--json", ...(ctx.share ? ["--share", "--share-store", ctx.share.base] : [])];

async function synthCase(node, cli, ctx) {
  const cs = `synth node ${spawnSync(node, ["--version"]).stdout.toString().trim()}`;
  const exp = { ...JSON.parse(fs.readFileSync(path.join(HARNESS, "expected.json"), "utf8")), ...SYNTH_EXTRA };
  const script = path.join(HARNESS, exp.script);
  const runs = Math.max(1, Number(opt("--runs", 1)));
  const normal = [];
  const strict = [];
  for (let i = 0; i < runs; i++) {
    for (const mode of i % 2 ? ["strict", "normal"] : ["normal", "strict"]) {
      if (mode === "strict" && flag("--no-strict")) continue;
      const out = path.join(ctx.tmp, `${cs.replace(/\W+/g, "-")}-${mode}-${i}`);
      const run = await mncad(node, cli, ["run", script, ...OUT_ARGS(out, ctx), ...(mode === "strict" ? ["--strict"] : [])]);
      run.out = out;
      say(`# [${cs}] ${mode} #${i + 1}: exit ${run.exit}, ${(run.wallMs / 1000).toFixed(1)} s, peak ${run.peakMB} MB`);
      (mode === "strict" ? strict : normal).push(run);
      ctx.peaks.push({ case: cs, mode, peakMB: run.peakMB });
    }
  }
  const n0 = normal[0];
  if (!(await checkRun(cs, n0, exp, ctx))) return null;
  check(cs, "no ⚠ in the synthetic run (expected.json: a strict run passes)", n0.report.counts.warnings === 0, problems(n0.report).slice(0, 3).map((e) => `L${e.line} ${e.code} ${e.text}`.slice(0, 200)));
  checkMotion(cs, n0.report, { travel_mm: [exp.motion.stroke_mm, exp.motion.stripperTravel_mm] });
  triage(cs, n0.report);
  if (strict.length) {
    checkStrict(cs, n0, strict[0], true);
    const nMs = median(normal.map((x) => x.wallMs));
    const sMs = median(strict.map((x) => x.wallMs));
    const over = sMs / nMs - 1;
    check(cs, `strict overhead ≤ ${exp.strictOverheadMax * 100} % (wall, median of ${runs})`, over <= exp.strictOverheadMax, { normalS: +(nMs / 1000).toFixed(1), strictS: +(sMs / 1000).toFixed(1), overhead: +over.toFixed(3) });
    const a = n0.report.files?.find((f) => f.format === "step")?.path;
    const b = strict[0].report?.files?.find((f) => f.format === "step")?.path;
    if (a && b) check(cs, "STEP byte-stable between runs (normal vs strict)", sha(a) === sha(b), { normal: sha(a).slice(0, 12), strict: sha(b).slice(0, 12) });
  } else skip(cs, "strict run", "--no-strict");
  return n0;
}

/** every text op headless on the resumed session of the synthetic run (finding 959 #2) */
async function opsCase(node, cli, ctx, synthRun) {
  const cs = "ops (headless, --resume)";
  const session = synthRun ? path.join(synthRun.out, "session.mncad-ws") : null;
  if (!session || !fs.existsSync(session)) return skip(cs, "text ops headless", "no session of the synthetic run");
  const asm = mainDoc(synthRun.report)?.name;
  const part = (synthRun.report.docs ?? []).find((d) => d.kind === "part" && d.sheets)?.name;
  const ops = [`záložka "${asm}"`, "stav", "sestava vazby", "kolize", "pohyb stav", "výkres stav vše", "kontrola sestava", "kusovník", "export step", "výkres export pdf vše", "uložit", ...(ctx.share ? ["sdílet úložiště"] : []), `záložka "${part}"`, "měřit těleso", "kontrola díry"];
  const file = path.join(ctx.tmp, "ops.txt");
  fs.writeFileSync(file, `${ops.join("\n")}\n`);
  const out = path.join(ctx.tmp, "ops-out");
  const run = await mncad(node, cli, ["run", file, "--resume", session, "--out", out, "--formats", "none", "--json", ...(ctx.share ? ["--share-store", ctx.share.base] : [])]);
  ctx.peaks.push({ case: cs, peakMB: run.peakMB });
  const r = run.report;
  if (!check(cs, "run finished with a JSON report", !!r, { exit: run.exit, aborted: run.aborted })) return;
  const errs = (r.entries ?? []).filter((e) => e.level === "error");
  check(cs, "no ✗ (no host.app-only)", errs.length === 0 && run.exit === 0, errs.slice(0, 4).map((e) => `L${e.line} ${e.code} ${e.text}`.slice(0, 200)));
  const silent = ops.map((t, i) => ({ t, line: i + 1 })).filter((o) => !(r.entries ?? []).some((e) => (e.lines ?? [e.line]).includes(o.line)));
  check(cs, "every op line has a result in the report", silent.length === 0, silent.length ? silent : { ops: ops.length });
  const fmts = new Set((r.files ?? []).map((f) => f.format));
  check(cs, "export step / výkres export pdf vše / uložit write files (F)", fmts.has("step") && fmts.has("pdf") && fmts.has("mncad"), [...fmts]);
  if (ctx.share) check(cs, "sdílet úložiště: short link (≤ 200 chars) in the report and the O line", !!r.share && r.share.url.length <= 200 && protoLines(r).some((l) => l.startsWith("O ")), r.share ?? "no share");
  check(cs, `protocol ≤ 2048 B`, ctx.lib.utf8Bytes(r.protocol) + 1 <= 2048, { bytes: ctx.lib.utf8Bytes(r.protocol) + 1 });
  triage(cs, r);
}

/**
 * Repros of the "no silent change" inventory of the 959 report (strict-silent B4, addendum of the brief): every item must
 * either behave as decided or say so with ⚠/✗ on its line – a silent result fails the gate; a ⚠ where the decision asks for
 * the real behaviour (15.3: build the counterbore of a tapped hole) is listed as a finding.
 */
async function silentCase(node, cli, ctx) {
  const cs = "no silent change (repros)";
  const L = ['nová sestava "Prázdná sestava"'];
  for (let i = 1; i <= 27; i++) L.push(`nový díl "Díl ${i}"`, `kvádr 10 10 ${i}`);
  const at = (t) => L.push(t) && L.length;
  const tabs = at("záložky");
  at('nový díl "Deska se závitem"');
  at("kvádr 60 40 20");
  const cbore = at("díra 6,8 hloubka 15 v 20 20 20 zahloubení 20 7 závit M8");
  const holes = at("kontrola díry");
  const section = at("výkres A3 pohledy přední,horní řez XZ odsazení 500");
  at('nový díl "Velký blok"');
  at("kvádr 1000 800 600");
  const fit = at("výkres A4 měřítko 1:1 pohledy přední,horní,pravý");
  const file = path.join(ctx.tmp, "silent.txt");
  fs.writeFileSync(file, `${L.join("\n")}\n`);
  const run = await mncad(node, cli, ["run", file, "--out", path.join(ctx.tmp, "silent-out"), "--formats", "none", "--json"]);
  ctx.peaks.push({ case: cs, peakMB: run.peakMB });
  const r = run.report;
  if (!check(cs, "run finished with a JSON report", !!r, { exit: run.exit })) return;
  const on = (line) => (r.entries ?? []).filter((e) => (e.lines ?? [e.line]).includes(line));
  const flagged = (line) => on(line).filter((e) => e.level === "warn" || e.level === "error");
  const text = (e) => `${e.text}\n${e.detail ?? ""}`;
  // B1: a run-created (empty) assembly is never replaced by a later `nový díl`
  check(cs, "B1: the empty run-created assembly keeps its tab after `nový díl`", on(tabs).some((e) => /Prázdná sestava/.test(text(e))) || flagged(1).length > 0, on(tabs).map((e) => text(e).slice(0, 200)));
  // B2: no tab limit – all 27 parts of one script stay open
  const names = new Set((r.docs ?? []).map((d) => d.name));
  const lost = Array.from({ length: 27 }, (_, i) => `Díl ${i + 1}`).filter((n) => !names.has(n));
  check(cs, "B2: 27× `nový díl` in one script → 27 part documents", lost.length === 0, lost.length ? { lost } : { docs: names.size });
  // B4 / decision 15.3: counterbore + thread is built; at least never silent
  const built = on(holes).some((e) => /cbore=20x7/.test(text(e)));
  const said = flagged(cbore);
  check(cs, "B4: counterbore of a tapped hole is built or reported (never silent)", built || said.length > 0, built ? "built" : said.map((e) => `${e.code}: ${e.text}`));
  if (!built && said.length) {
    findings.push({ case: cs, what: `⚠ ${said[0].code}`, n: said.length, lines: [cbore], text: "decision 15.3 asks to BUILD the counterbore of a tapped hole (counterbore + drill + thread); today it is left out with ⚠" });
    say(`# finding [${cs}] decision 15.3 not met: ${said[0].code} ${said[0].text}`);
  }
  // B5: a section plane that misses the part is ✗/⚠ in the protocol, not only in the UI
  check(cs, "B5: section plane outside the part → drawing.section-miss in the protocol", flagged(section).some((e) => e.code === "drawing.section-miss"), flagged(section).map((e) => e.code));
  // B6: views that do not fit the sheet at the scale → ⚠ in the protocol
  check(cs, "B6: views that do not fit the sheet → ⚠ drawing.* in the protocol", flagged(fit).some((e) => /^drawing\./.test(e.code ?? "")), flagged(fit).map((e) => `${e.code}: ${e.text}`.slice(0, 160)));
}

/** the agent's real script (NDA fixture) – one call, design 10.4 */
async function realScriptCase(node, cli, ctx, file) {
  const cs = "959 script";
  const exp = { ...REAL_SCRIPT, ...(readJson(opt("--expect-script")) ?? {}) };
  const out = path.join(ctx.tmp, "real-script");
  const run = await mncad(node, cli, ["run", file, ...OUT_ARGS(out, ctx)]);
  ctx.peaks.push({ case: cs, peakMB: run.peakMB });
  say(`# [${cs}] exit ${run.exit}, ${(run.wallMs / 1000).toFixed(1)} s, peak ${run.peakMB} MB`);
  if (!(await checkRun(cs, run, exp, ctx))) return null;
  if (/^pohyb /m.test(fs.readFileSync(file, "utf8"))) checkMotion(cs, run.report, exp.motion);
  triage(cs, run.report);
  if (!flag("--no-strict")) {
    const st = await mncad(node, cli, ["run", file, ...OUT_ARGS(path.join(ctx.tmp, "real-script-strict"), ctx), "--strict"]);
    ctx.peaks.push({ case: `${cs} strict`, peakMB: st.peakMB });
    checkStrict(cs, run, st);
  }
  return run;
}

/** the agent's document via --open + ops: the assembly is built and checked headless (findings 959 #1, #2, #4, #8) */
async function realDocCase(node, cli, ctx, file, scriptRun) {
  const cs = "959 document (--open)";
  const exp = { ...REAL_DOC, ...(readJson(opt("--expect-doc")) ?? {}) };
  const ops = ["kolize", "stav", "sestava vazby", "pohyb stav", "výkres stav vše", "kusovník"];
  const sf = path.join(ctx.tmp, "doc-ops.txt");
  fs.writeFileSync(sf, `${ops.join("\n")}\n`);
  const out = path.join(ctx.tmp, "real-doc");
  const run = await mncad(node, cli, ["run", sf, "--open", file, ...OUT_ARGS(out, ctx)]);
  ctx.peaks.push({ case: cs, peakMB: run.peakMB });
  say(`# [${cs}] exit ${run.exit}, ${(run.wallMs / 1000).toFixed(1)} s, peak ${run.peakMB} MB`);
  if (!(await checkRun(cs, run, exp, ctx))) return;
  const r = run.report;
  const app = (r.entries ?? []).filter((e) => e.code === "host.app-only");
  check(cs, "ops on the opened document: no host.app-only", app.length === 0, app.map((e) => e.text));
  // warnings of the component parts must surface (the CLI used to sum an opened assembly without building it)
  const partsWith = (rep) => new Set((rep?.entries ?? []).filter((e) => (e.code === "feature.warning" || e.code === "feature.failed") && e.doc).map((e) => e.doc));
  if (scriptRun?.report) {
    const want = [...partsWith(scriptRun.report)];
    const got = partsWith(r);
    check(cs, "feature ⚠/✗ of every part the script run flagged also surface for the opened document", want.every((p) => got.has(p)), { script: want, doc: [...got] });
  } else note(cs, "parts with feature ⚠/✗", [...partsWith(r)]);
  if (r.docs?.some((d) => d.kind === "assembly" && d.components)) checkMotion(cs, r, exp.motion);
  triage(cs, r);
  if (!flag("--no-strict")) {
    const st = await mncad(node, cli, ["run", sf, "--open", file, ...OUT_ARGS(path.join(ctx.tmp, "real-doc-strict"), ctx), "--strict"]);
    ctx.peaks.push({ case: `${cs} strict`, peakMB: st.peakMB });
    checkStrict(cs, run, st);
  }
}

/* ───────────────────────── main ───────────────────────── */

async function main() {
  const only = new Set(String(opt("--only", "synth,ops,silent,script,doc")).split(",").filter(Boolean));
  const nodes = String(opt("--node", process.execPath)).split(",").filter(Boolean);
  const keep = opt("--keep");
  const tmp = keep ? path.resolve(keep) : fs.mkdtempSync(path.join(os.tmpdir(), "mncad-acceptance-"));
  fs.mkdirSync(tmp, { recursive: true });
  const t0 = Date.now();
  const ctx = { tmp, formats: ["step", "pdf"], share: null, shareSkip: null, peaks: [], lib: await load("acceptance-lib.ts", { quiet: true }) };
  let store = null;
  try {
    // the generator: the committed synthetic script and expected.json match the spec (no kernel)
    const gen = spawnSync(process.execPath, [path.join(HARNESS, "synth-tool.mjs"), "--check"], { encoding: "utf8" });
    check("generator", "synth-959.txt + expected.json = synth-spec.mjs (synth-tool.mjs --check)", gen.status === 0, gen.stdout.trim() || gen.stderr.trim());
    const cli = await resolveCli();
    check("cli", "built CLI bundle", fs.existsSync(cli), path.relative(WEB, cli));
    if (!flag("--no-share")) {
      if (opt("--share-store")) ctx.share = { base: opt("--share-store").replace(/\/?$/, "/") };
      else {
        store = await startStore(tmp);
        if (store) ctx.share = { base: store.base };
        else if (flag("--require-php") || process.env.CI) check("share", "PHP for the share store (CI requires it)", false, "php -v failed");
        else ctx.shareSkip = "php is not installed (CI requires it)";
      }
    } else ctx.shareSkip = "--no-share";
    if (ctx.share) note("share", "store", ctx.share.base);
    // a positional script = one custom case with --expect
    if (positional.length) {
      const exp = readJson(opt("--expect")) ?? {};
      const run = await mncad(nodes[0], cli, ["run", path.resolve(positional[0]), ...OUT_ARGS(path.join(tmp, "custom"), ctx)]);
      ctx.peaks.push({ case: "custom", peakMB: run.peakMB });
      await checkRun("custom", run, exp, ctx);
      triage("custom", run.report);
    } else {
      let synth = null;
      if (only.has("synth")) for (const node of nodes) synth = (await synthCase(node, cli, ctx)) ?? synth;
      if (only.has("ops")) await opsCase(nodes[0], cli, ctx, synth);
      if (only.has("silent")) await silentCase(nodes[0], cli, ctx);
      const fx = path.resolve(opt("--fixtures", process.env.MNCAD_FIXTURES ?? path.join(WEB, ".local", "fixtures")));
      const scriptFile = path.join(fx, "959-skript.txt");
      const docFile = path.join(fx, "959-dokument.json");
      let scriptRun = null;
      if (only.has("script")) {
        if (fs.existsSync(scriptFile)) scriptRun = await realScriptCase(nodes[0], cli, ctx, scriptFile);
        else skip("959 script", "real script", `fixture missing (${scriptFile})`);
      }
      if (only.has("doc")) {
        if (fs.existsSync(docFile)) await realDocCase(nodes[0], cli, ctx, docFile, scriptRun);
        else skip("959 document (--open)", "real document", `fixture missing (${docFile})`);
      }
    }
    // memory: the CLI default --max-mem must not kill a legitimate run (finding 959 #7)
    const peak = Math.max(0, ...ctx.peaks.map((p) => p.peakMB));
    check("memory", "peak RSS of every run ≤ 80 % of the CLI default --max-mem 2048 MB", peak <= 0.8 * 2048, { peakMB: peak, runs: ctx.peaks });
  } finally {
    store?.stop();
    if (!keep) fs.rmSync(tmp, { recursive: true, force: true });
  }
  const failed = results.filter((x) => x.status === "fail");
  const verdict = { pass: failed.length === 0, failed: failed.length, checks: results.length, skipped: results.filter((x) => x.status === "skip").length, seconds: +((Date.now() - t0) / 1000).toFixed(1), results, findings };
  const text = `${JSON.stringify(verdict, null, 2)}\n`;
  if (opt("--json")) fs.writeFileSync(opt("--json"), text);
  process.stdout.write(text);
  say(`cad-acceptance: ${verdict.pass ? "PASS" : "FAIL"} – ${results.length - failed.length - verdict.skipped} ok, ${failed.length} FAIL, ${verdict.skipped} skip, ${findings.length} findings, ${verdict.seconds} s`);
  process.exitCode = verdict.pass ? 0 : 1;
}

if (process.argv[1] && path.resolve(process.argv[1]) === SELF) {
  main().catch((e) => {
    console.error(e?.stack ?? String(e));
    process.exitCode = 2;
  });
}
