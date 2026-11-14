#!/usr/bin/env node
// Strict-mode overhead benchmark (design 5.3, target expected.json strictOverheadMax = 0.25; B4 strict-silent and the B6
// gate). Every variant runs in a fresh (cold) process, alternating the order between runs.
//
// Loopback mode (default – works before the headless engine exists, like probe P11):
//   node scripts/cad-harness/bench-strict.mjs [--runs 1] [--script FILE] [--skip motion,drawings] [--max-rss 3000]
//                                             [--timeout 1800] [--json FILE]
//   normal = parts built when the assembly needs them, all drawing sheets evaluated once at the end (what the export of all
//            sheets costs); strict = additionally every part built after every geometry op (incremental build cache) and
//            the sheet evaluated at the end of every block of `výkres` lines and at a sheet switch, then all sheets at the
//            end. The simulation measures cost only – it does not stop on ⚠/✗. Motion is skipped by default (identical in
//            both modes; today 40 steps with collisions exceed the machine, see bench-motion.mjs).
//            --strict-build full|shape: "full" = the worker build (status + mesh, as probe P11), "shape" = status and
//            validity only (buildShape, no tessellation) – the cheaper variant B4 can choose.
// CLI mode (once package A2/B2/B4 deliver `mncad run … --strict`):
//   node scripts/cad-harness/bench-strict.mjs --cli public/cad/cli/<ver>/mncad.mjs [--runs 3] [--script FILE]
//            [--cli-args "--formats none"] – wall time and peak RSS of `mncad run` with and without --strict; the strict
//            run must exit 0 (B6: "strict run passes").
// Verdict: overall overhead ≤ max and (loopback) the overhead without drawings and of the drawings alone ≤ max each.
// Clean: every run without ✗ and without a line a strict engine run would stop on (⚠, !, ambiguous rule-based face pick);
// CLI mode: every strict run exits 0 without STOP.
// Exit: 0 overhead ≤ max and every run clean · 1 target missed or a run failed · 2 aborted (guard / crash).
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { HARNESS, WEB, load } from "./bundle.mjs";
import { emit, exitWithParent, median, runWatched } from "./proc.mjs";

const args = process.argv.slice(2);
const flag = (f) => args.includes(f);
const opt = (f, d) => (args.includes(f) ? args[args.indexOf(f) + 1] : d);
const SELF = fileURLToPath(import.meta.url);
const defaultScript = path.join(HARNESS, "synth-959.txt");
const expected = () => JSON.parse(fs.readFileSync(path.join(HARNESS, "expected.json"), "utf8"));

/* ───────────── child (loopback) ───────────── */
async function child() {
  exitWithParent(); // never outlive the watching parent
  const strict = opt("--mode") === "strict";
  const skip = new Set(String(opt("--skip", "motion")).split(",").filter(Boolean));
  const text = fs.readFileSync(opt("--script", defaultScript), "utf8");
  const lb = await load("loopback.ts", { quiet: true });
  const t0 = Date.now();
  await lb.init(WEB);
  const initMs = Date.now() - t0;
  const s = new lb.Session();
  const strictBuild = opt("--strict-build", "full");
  const res = await s.run(text, { strict, strictBuild, drawingsAtEnd: !skip.has("drawings"), skipMotion: skip.has("motion"), skipDrawings: skip.has("drawings") });
  const byKind = {};
  for (const t of res.timing) {
    const k = t.op.startsWith("asm:mate") ? "mates" : t.op.startsWith("asm:motion") ? "motion" : t.op.startsWith("drawing") ? "drawings" : t.op === "clash" ? "clash" : ["feature", "features", "select", "entities", "constraints", "dims", "library"].includes(t.op) ? "parts" : "other";
    byKind[k] = (byKind[k] ?? 0) + t.ms;
  }
  byKind.endOfRun = res.ms - res.timing.reduce((a, t) => a + t.ms, 0);
  // the only tolerated ✗ is the parse error of `kontrola` until package B5 lands
  const errors = res.log.filter((l) => l.text.startsWith("✗") && !/„kontrola“/.test(l.text));
  // lines a strict engine run would stop on (⚠ / ! and ambiguous face picks, by op kind) – B6 requires the strict run to pass
  const warnCount = Object.values(res.warnings).reduce((a, b) => a + b, 0);
  emit({ mode: strict ? "strict" : "normal", ms: res.ms, initMs, byKind, errors: errors.length, firstErrors: errors.slice(0, 3).map((l) => `L${l.line} ${l.text.slice(0, 160)}`), warnings: res.warnings, warnCount, firstWarnings: res.warnLines.slice(0, 3).map((l) => `${l.line ? `L${l.line}` : "end"} ${l.text.slice(0, 160)}`) });
}

/* ───────────── parent ───────────── */
/**
 * Overall overhead of the strict runs (medians). With `kinds` (loopback: per-kind times of every run) the overhead is also
 * split: `withoutDrawings` = everything but the drawing sheets, `drawings` = sheet commands + the sheet evaluation at the
 * end of the run (`endOfRun`). Both must stay ≤ max – minutes of sheet projection in both modes would otherwise hide a
 * doubled geometry time behind a small overall percentage. A part below 1 s in the normal run is not judged (null).
 */
export function verdict(normal, strict, max, kinds = null) {
  const n = median(normal);
  const s = median(strict);
  const overhead = s / n - 1;
  const out = { normalMs: Math.round(n), strictMs: Math.round(s), overhead: +overhead.toFixed(4), max, ok: overhead <= max };
  if (kinds) {
    const part = (runs, pick) => median(runs.map((k) => Object.entries(k).filter(([key]) => pick(key)).reduce((a, [, v]) => a + v, 0)));
    const split = (pick) => {
      const a = part(kinds.normal, pick);
      const b = part(kinds.strict, pick);
      return { normalMs: Math.round(a), strictMs: Math.round(b), overhead: a >= 1000 ? +(b / a - 1).toFixed(4) : null };
    };
    const sheet = (k) => k === "drawings" || k === "endOfRun";
    out.withoutDrawings = split((k) => !sheet(k));
    out.drawings = split(sheet);
    out.ok = out.ok && (out.withoutDrawings.overhead ?? 0) <= max && (out.drawings.overhead ?? 0) <= max;
  }
  return out;
}

async function loopbackMode(runs, max) {
  const skip = opt("--skip", "motion");
  const out = { mode: "loopback", runs: [], skip, strictBuild: opt("--strict-build", "full") };
  for (let r = 0; r < runs; r++) {
    for (const mode of r % 2 ? ["strict", "normal"] : ["normal", "strict"]) {
      const res = await runWatched(["--max-old-space-size=2048", SELF, "--child", "--mode", mode, "--skip", skip, "--strict-build", opt("--strict-build", "full"), "--script", opt("--script", defaultScript)], {
        maxRss: Number(opt("--max-rss", 3000)),
        timeoutS: Number(opt("--timeout", 1800)),
      });
      const ev = res.events.find((e) => e.mode === mode);
      out.runs.push({ mode, run: r + 1, wallMs: res.wallMs, peakRssMB: res.peakRssMB, aborted: res.aborted, ...(ev ?? { error: `child exit ${res.code ?? res.signal}` }) });
      process.stderr.write(`${mode} #${r + 1}: ${ev ? `${ev.ms} ms, ${ev.errors} ✗, ${ev.warnCount} ⚠` : res.aborted ?? "failed"}, peak ${res.peakRssMB} MB\n`);
    }
  }
  const done = (m) => out.runs.filter((x) => x.mode === m && x.ms !== undefined);
  out.verdict = verdict(done("normal").map((x) => x.ms), done("strict").map((x) => x.ms), max, { normal: done("normal").map((x) => x.byKind), strict: done("strict").map((x) => x.byKind) });
  // clean = every run finished without ✗ and without a line a strict engine run would stop on (⚠ / ! / ambiguous pick)
  out.clean = out.runs.every((x) => x.ms !== undefined && x.errors === 0 && x.warnCount === 0 && !x.aborted);
  return out;
}

async function cliMode(cli, runs, max) {
  const out = { mode: "cli", cli, runs: [] };
  const extra = String(opt("--cli-args", "--formats none")).split(/\s+/).filter(Boolean);
  for (let r = 0; r < runs; r++) {
    for (const mode of r % 2 ? ["strict", "normal"] : ["normal", "strict"]) {
      const dir = fs.mkdtempSync(path.join(os.tmpdir(), "mncad-bench-"));
      const a = [cli, "run", opt("--script", defaultScript), "--out", dir, "--json", ...extra, ...(mode === "strict" ? ["--strict"] : [])];
      const res = await runWatched(a, { maxRss: Number(opt("--max-rss", 3000)), timeoutS: Number(opt("--timeout", 1800)) });
      let report = null;
      try {
        report = JSON.parse(res.stdout);
      } catch {
        /* not JSON */
      }
      fs.rmSync(dir, { recursive: true, force: true });
      out.runs.push({ mode, run: r + 1, ms: res.wallMs, exit: res.code, peakRssMB: res.peakRssMB, aborted: res.aborted, ok: report?.ok ?? null, stopped: report?.stopped ?? null });
      process.stderr.write(`${mode} #${r + 1}: ${res.wallMs} ms, exit ${res.code}, peak ${res.peakRssMB} MB\n`);
    }
  }
  const ms = (m) => out.runs.filter((x) => x.mode === m && !x.aborted).map((x) => x.ms);
  out.verdict = verdict(ms("normal"), ms("strict"), max);
  // B6: the strict run of the synthetic tool must pass (exit 0, no STOP)
  out.clean = out.runs.every((x) => !x.aborted && x.exit === 0 && !x.stopped);
  return out;
}

async function parent() {
  const runs = Math.max(1, Number(opt("--runs", opt("--cli") ? 3 : 1)));
  const max = Number(opt("--max-overhead", expected().strictOverheadMax));
  const out = opt("--cli") ? await cliMode(path.resolve(opt("--cli")), runs, max) : await loopbackMode(runs, max);
  out.pass = out.verdict.ok && out.clean;
  const text = `${JSON.stringify(out, null, 2)}\n`;
  if (opt("--json")) fs.writeFileSync(opt("--json"), text);
  process.stdout.write(text);
  process.exitCode = out.runs.some((x) => x.aborted) ? 2 : out.pass ? 0 : 1;
}

if (process.argv[1] && path.resolve(process.argv[1]) === SELF) {
  (flag("--child") ? child() : parent()).catch((e) => {
    console.error(e?.stack ?? String(e));
    process.exitCode = 2;
  });
}
