#!/usr/bin/env node
// Motion + collision benchmark on the synthetic tool (design 7.2 target, measured by A3 motion-clash and the B6 gate):
// `pohyb motor lineární vazba 12 167..117 kroky 40` without collisions, then `pohyb kolize` (every step runs the kernel
// interference). Runs through the loopback worker like the probes, in a CHILD process watched by this process: RSS is
// sampled from /proc/<pid>/status every 250 ms and the child is killed above --max-rss (default 3000 MB – the shared
// machine; today's code path grows ~0.6 MB per exact intersection, P7) or after --timeout seconds.
//
//   node scripts/cad-harness/bench-motion.mjs [--steps 40] [--no-collisions] [--max-rss 3000] [--timeout 900]
//                                             [--script FILE [--expect expected.json]] [--json FILE]
// Exit: 0 all targets met · 1 a target missed · 2 aborted (memory guard / timeout / crash).
// Targets (design 7.2.6): 40 steps with collisions ≤ 45 s and ≤ 1.5 GB (a shorter run is extrapolated to 41 interference
// calls, time and memory, and marked); no conflict steps; the guided parts (top plate, stripper) move only along Z (XY drift
// ≤ 0.01 mm, no rotation) by the expected stroke / travel; every step holds exactly the screw × tapped hole pairs of
// expected.json and nothing else. --no-collisions checks the motion part only (no time target). A foreign --script without
// --expect is measured, and the checks that need expectations are reported as null.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { HARNESS, WEB, load } from "./bundle.mjs";
import { emit, exitWithParent, runWatched } from "./proc.mjs";

const args = process.argv.slice(2);
const flag = (f) => args.includes(f);
const opt = (f, d) => (args.includes(f) ? args[args.indexOf(f) + 1] : d);
export const TARGET = { steps: 40, seconds: 45, rssMB: 1536, driftMM: 0.01, rotationDeg: 0.01 };

/** split the script at the first motion line; `steps` rewrites `kroky N` of the motor line */
export function splitScript(text, steps) {
  const lines = text.split("\n");
  const i = lines.findIndex((l) => /^pohyb\s/.test(l.trim()));
  if (i < 0) throw new Error("the script has no `pohyb` line");
  const motion = [];
  let j = i;
  for (; j < lines.length && (/^pohyb\s/.test(lines[j].trim()) || !lines[j].trim()); j++) if (lines[j].trim()) motion.push(lines[j].trim());
  const motor = motion.find((l) => /\bmotor\b/.test(l));
  if (!motor) throw new Error("no `pohyb motor` line");
  const m = steps ? motor.replace(/\bkroky\s+\d+/, `kroky ${steps}`) : motor;
  return { before: lines.slice(0, i).join("\n"), motor: m, collisions: motion.some((l) => /^pohyb\s+kolize\s*$/.test(l)), motionLine: i + 1 };
}

const wrap = (a) => ((((a + 180) % 360) + 360) % 360) - 180;

/**
 * Analysis of the motion result.
 * Guided parts (exp.motion.guided – the top plate and the stripper, each on two parallel `souosost`): Z travel, XY drift
 * and rotation drift (largest change of a placement angle) over all steps – they may only move along Z (design 7.2.4).
 * Clashes per step: pairs classified by exp.threadPairs (screw × tapped hole); every step must hold exactly
 * exp.motion.clashesPerStep thread pairs (the screws move with their rigid groups – a step that LOSES pairs, e.g. an
 * incremental cache dropping them, is as wrong as one that gains a foreign pair).
 * Without expectations (a foreign --script) every check that needs them is null (not checked).
 */
export function analyse(res, asm, exp = {}) {
  const name = new Map(asm.components.map((c) => [c.id, c.name]));
  const comp = (nm) => asm.components.find((c) => c.name === nm);
  const place = (st, c) => st.place[c.id] ?? c.placement;
  const guided = (exp.motion?.guided ?? []).map((nm) => {
    const c = comp(nm);
    if (!c) return { name: nm, found: false };
    const p0 = c.placement.position;
    const r0 = c.placement.rotation ?? [0, 0, 0];
    let drift = 0;
    let rot = 0;
    let zmin = p0[2];
    for (const st of res.steps) {
      const { position: p, rotation: r = [0, 0, 0] } = place(st, c);
      drift = Math.max(drift, Math.hypot(p[0] - p0[0], p[1] - p0[1]));
      rot = Math.max(rot, ...r.map((a, i) => Math.abs(wrap(a - r0[i]))));
      zmin = Math.min(zmin, p[2]);
    }
    return { name: nm, found: true, travelZ_mm: +(p0[2] - zmin).toFixed(3), driftXY_mm: +drift.toFixed(4), rotation_deg: +rot.toFixed(4) };
  });
  const pairs = exp.threadPairs ?? null;
  const isThread = (a, b) => pairs.some((t) => (a === t.screw && b === t.part) || (b === t.screw && a === t.part));
  const want = exp.motion?.clashesPerStep ?? null;
  const perStep = res.steps.map((st) => {
    const cl = st.clashes ?? [];
    if (!pairs) return { total: cl.length, thread: null, other: null, otherPairs: [] };
    const other = cl.filter((x) => !isThread(name.get(x.a), name.get(x.b)));
    return { total: cl.length, thread: cl.length - other.length, other: other.length, otherPairs: other.slice(0, 3).map((x) => `${name.get(x.a)} × ${name.get(x.b)} ${x.volume.toFixed(1)}mm3`) };
  });
  const found = guided.filter((g) => g.found);
  return {
    steps: res.steps.length - 1,
    conflictSteps: res.conflictSteps,
    guided,
    maxDrift_mm: found.length ? Math.max(...found.map((g) => g.driftXY_mm)) : null,
    maxRotation_deg: found.length ? Math.max(...found.map((g) => g.rotation_deg)) : null,
    collisionsChecked: res.collisionsChecked,
    clashesPerStep: perStep.map((x) => x.total),
    nonThreadClashSteps: pairs ? perStep.filter((x) => x.other > 0).length : null,
    // steps whose thread-pair count differs from the expectation (lost or extra screw × tapped hole pairs)
    threadMismatchSteps: pairs && want !== null ? perStep.filter((x) => x.thread !== want).length : null,
    firstNonThread: perStep.find((x) => x.other > 0)?.otherPairs ?? null,
  };
}

/**
 * Verdict of one run. Collisions: N steps run N + 1 interference calls (step 0 included), so the time is scaled by
 * 41 / calls; memory grows per call (P7: ~63 MB), so the peak is extrapolated by the per-call RSS growth of the run to
 * 41 calls – both marked `extrapolated` when the run had fewer steps. Checks that need expectations are null when
 * missing and do not count; `pass` = every non-null check true.
 */
export function verdict({ col, motion, peakRssMB, stepRss = [], exp = {}, target = TARGET }) {
  const a = col ?? motion;
  const m = exp.motion ?? {};
  const g = (nm) => a.guided?.find((x) => x.name === nm && x.found);
  const top = g(m.guided?.[0]);
  const stripper = g(m.guided?.[1]);
  const near = (x, y) => (x == null || y == null ? null : Math.abs(x - y) <= target.driftMM);
  const v = {
    noConflicts: a.conflictSteps === 0,
    noDrift: a.maxDrift_mm == null ? null : a.maxDrift_mm <= target.driftMM && a.maxRotation_deg <= target.rotationDeg,
    strokeOk: m.stroke_mm == null || !top ? null : near(top.travelZ_mm, m.stroke_mm) && (m.stripperTravel_mm == null || !stripper || near(stripper.travelZ_mm, m.stripperTravel_mm)),
  };
  if (col) {
    const calls = Math.max(1, col.calls);
    const scale = (target.steps + 1) / calls;
    const perCall = stepRss.length > 1 ? Math.max(0, (stepRss[stepRss.length - 1] - stepRss[0]) / (stepRss.length - 1)) : 0;
    const rss41 = peakRssMB + perCall * Math.max(0, target.steps + 1 - calls);
    Object.assign(v, {
      seconds40: +((col.ms / 1000) * scale).toFixed(1),
      rssMB40: Math.round(rss41),
      rssGrowthPerCallMB: +perCall.toFixed(1),
      extrapolated: calls !== target.steps + 1,
      timeOk: (col.ms / 1000) * scale <= target.seconds,
      memoryOk: rss41 <= target.rssMB,
      onlyThreadClashes: a.nonThreadClashSteps == null ? null : a.nonThreadClashSteps === 0,
      threadPairsEveryStep: a.threadMismatchSteps == null ? null : a.threadMismatchSteps === 0,
    });
  } else Object.assign(v, { collisions: "skipped", timeOk: null });
  const checks = ["noConflicts", "noDrift", "strokeOk", "timeOk", "memoryOk", "onlyThreadClashes", "threadPairsEveryStep"].filter((k) => k in v);
  return { verdict: v, pass: checks.every((k) => v[k] !== false) && checks.some((k) => v[k] === true) };
}

/** expectations: --expect FILE, else expected.json when the script is the synthetic tool, else none (foreign script) */
export function loadExpect(scriptPath, expectPath) {
  if (expectPath) return JSON.parse(fs.readFileSync(expectPath, "utf8"));
  if (path.resolve(scriptPath) === path.join(HARNESS, "synth-959.txt")) return JSON.parse(fs.readFileSync(path.join(HARNESS, "expected.json"), "utf8"));
  return {};
}

/* ───────────── child: run in the loopback and report ───────────── */
async function child() {
  exitWithParent(); // never outlive the watching parent (SIGKILL / OOM of the bench)
  const scriptPath = opt("--script", path.join(HARNESS, "synth-959.txt"));
  const exp = loadExpect(scriptPath, opt("--expect"));
  const parts = splitScript(fs.readFileSync(scriptPath, "utf8"), Number(opt("--steps", 0)) || null);
  const lb = await load("loopback.ts", { quiet: true });
  const t0 = Date.now();
  await lb.init(WEB);
  const s = new lb.Session();
  const setup = await s.run(parts.before);
  emit({ phase: "setup", ms: Date.now() - t0, errors: setup.errors, rssMB: lb.rssMB(), heapMB: lb.heapMB() });
  let t = Date.now();
  const r1 = await s.run(parts.motor);
  const asm = s.assembly();
  const noCol = { ms: Date.now() - t, rssMB: lb.rssMB(), heapMB: lb.heapMB(), log: r1.log.map((l) => l.text).filter((x) => /⚠|✗/.test(x)).slice(0, 4), ...analyse(s.motion(asm), asm, exp) };
  emit({ phase: "motion", ...noCol });
  if (flag("--no-collisions") || !parts.collisions) return emit({ phase: "done", collisions: false });
  s.interferenceCalls.length = 0;
  const calls = s.interferenceCalls;
  const push = calls.push.bind(calls);
  calls.push = (c) => (emit({ phase: "step", k: calls.length, ...c }), push(c));
  t = Date.now();
  const r2 = await s.run("pohyb kolize");
  const asm2 = s.assembly();
  const ms = Date.now() - t;
  emit({ phase: "collisions", ms, calls: calls.length, interferenceMs: calls.reduce((a, c) => a + c.ms, 0), rssMB: lb.rssMB(), heapMB: lb.heapMB(), heapGrowthMB: calls.length ? calls[calls.length - 1].heapMB - calls[0].heapMB : 0, log: r2.log.map((l) => l.text).filter((x) => /⚠|✗/.test(x)).slice(0, 4), ...analyse(s.motion(asm2), asm2, exp) });
  emit({ phase: "done", collisions: true });
}

/* ───────────── parent: watchdog + report ───────────── */
async function parent() {
  const script = opt("--script", path.join(HARNESS, "synth-959.txt"));
  const childArgs = ["--steps", opt("--steps", "40"), "--script", script, ...(opt("--expect") ? ["--expect", opt("--expect")] : [])];
  if (flag("--no-collisions")) childArgs.push("--no-collisions");
  const r = await runWatched(["--max-old-space-size=2048", fileURLToPath(import.meta.url), "--child", ...childArgs], {
    maxRss: Number(opt("--max-rss", 3000)),
    timeoutS: Number(opt("--timeout", 900)),
    onEvent: (e) => process.stderr.write(e.phase === "step" ? `  step ${e.k}: ${e.ms} ms, ${e.pairs} pairs, rss ${Math.round(e.rssMB)} MB, wasm ${Math.round(e.heapMB)} MB\n` : `${e.phase}${e.ms !== undefined ? ` ${e.ms} ms` : ""}\n`),
  });
  const ev = (ph) => r.events.find((e) => e.phase === ph);
  const exp = loadExpect(script, opt("--expect"));
  const report = {
    steps: Number(opt("--steps", 40)),
    expectations: exp.motion ? "expected.json" : "none (foreign script: drift, stroke and clash classes not checked)",
    setup: ev("setup"),
    motion: ev("motion"),
    collisions: ev("collisions") ?? null,
    peakRssMB: r.peakRssMB,
    wallMs: r.wallMs,
    aborted: r.aborted ?? (ev("done") ? null : `child exit ${r.code ?? r.signal}`),
    target: TARGET,
  };
  if (ev("motion")) {
    const stepRss = r.events.filter((e) => e.phase === "step").map((e) => e.rssMB);
    Object.assign(report, verdict({ col: ev("collisions"), motion: ev("motion"), peakRssMB: r.peakRssMB, stepRss, exp }));
  } else report.pass = false;
  const out = `${JSON.stringify(report, null, 2)}\n`;
  if (opt("--json")) fs.writeFileSync(opt("--json"), out);
  process.stdout.write(out);
  process.exitCode = report.aborted ? 2 : report.pass ? 0 : 1;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  (flag("--child") ? child() : parent()).catch((e) => {
    console.error(e?.stack ?? String(e));
    process.exitCode = 2;
  });
}
