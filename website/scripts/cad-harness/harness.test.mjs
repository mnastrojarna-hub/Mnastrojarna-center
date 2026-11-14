// Tests of the acceptance harness (package A4 harness-gen). Run (from website/): node --test scripts/cad-harness/harness.test.mjs
// (a directory argument is not accepted by `node --test` on Node 22/24). Fast by default: one small OCCT loopback run
// (part sheet) and a few short child processes. CAD_HARNESS_KERNEL=1 adds the kernel check of the whole tool
// (synth-tool.mjs --verify --no-drawings, ~20 s, ~0.8 GB): analytic volumes vs the kernel, 70 components, 53/53 mates,
// 30 clash pairs = screw × tapped hole, no line a strict run would stop on.
import assert from "node:assert/strict";
import { execFileSync, spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { pathToFileURL } from "node:url";
import { HARNESS, WEB, bundle, load } from "./bundle.mjs";
import * as spec from "./synth-spec.mjs";
import { splitScript, analyse, verdict as motionVerdict, loadExpect } from "./bench-motion.mjs";
import { verdict } from "./bench-strict.mjs";
import { runWatched, median, alive } from "./proc.mjs";
import { restLineOffset, sheetSummary, pickFace } from "./synth-tool.mjs";

const SCRIPT = fs.readFileSync(path.join(HARNESS, "synth-959.txt"), "utf8");
const EXP = JSON.parse(fs.readFileSync(path.join(HARNESS, "expected.json"), "utf8"));
const lines = SCRIPT.trimEnd().split("\n");
const count = (re) => lines.filter((l) => re.test(l)).length;

test("synth-959.txt has the content of design 10.1", () => {
  assert.ok(lines.length >= 380 && lines.length <= 420, `~400 lines, got ${lines.length}`);
  assert.equal(count(/^nový díl /) + count(/^normálie /), 19, "19 parts");
  assert.equal(count(/^normálie /), 5, "pillar, bush, pin, spring, washer from the library");
  assert.equal(count(/^normálie podložka M8 ISO 7089$/), 1, "washers (design 10.1: podložky)");
  assert.equal(count(/^vložit /), 70);
  assert.equal(count(/^sestava vazba /), 53);
  assert.equal(count(/^sestava vazba zámek /), 38, "rigid lock groups");
  assert.equal(count(/^sestava vazba mez vzdálenosti /), 2);
  assert.equal(count(/^sestava vazba souosost /), 8);
  assert.equal(count(/^sestava vazba kontakt /), 4);
  assert.equal(count(/^pohyb motor lineární vazba 12 167\.\.117 kroky 40$/), 1);
  assert.equal(count(/^pohyb kolize$/), 1);
  assert.equal(count(/^výkres A1 /), 1);
  // A1 assembly sheet + 3 part sheets IN THE PART DOCUMENTS (a sheet of the assembly document always projects the assembly)
  assert.equal(count(/^výkres list nový /), 0);
  assert.equal(count(/^výkres model /), 0);
  assert.equal(count(/^výkres A3( měřítko 1:2)? pohledy přední,horní,iso$/), 3);
  assert.equal(count(/^kótovat chytře$/), 3, "Chytré kóty on every part sheet");
  for (const k of spec.PART_SHEETS) {
    const i = lines.indexOf(`záložka "${spec.NAMES[k]}"`);
    assert.ok(i > lines.indexOf("výkres A1 pohledy přední,horní,iso") && lines[i + 1].startsWith("výkres A3 ") && lines[i + 2] === "kótovat chytře", spec.NAMES[k]);
  }
  assert.equal(lines[lines.indexOf("kolize") - 1], `záložka "${spec.NAMES.asm}"`, "kolize runs on the assembly tab");
  assert.equal(count(/^výkres řez /), 1);
  assert.equal(count(/^výkres kusovník ano$/), 1);
  assert.equal(count(/^výkres balónky ano$/), 1);
  assert.equal(count(/^výkres razítko /), 4);
  assert.equal(count(/^kolize$/), 1);
  assert.equal(count(/^kontrola sestava$/), 1);
  assert.equal(count(/^měřit těleso$/), 3);
  assert.equal(lines.at(-1), "stav");
  assert.equal(count(/^závit M(10|8) délka /), 3, "cosmetic thread of each ISO 4762 screw");
  assert.ok(count(/^díra .* závit M10 /) === 24 && count(/^díra .* závit M8 /) === 6, "24 M10 + 6 M8 tapped holes");
  // design 10.1: ISO 4762 M8/M10 only
  assert.deepEqual([...new Set(lines.filter((l) => /^nový díl "Šroub /.test(l)).map((l) => /M\d+/.exec(l)[0]))].sort(), ["M10", "M8"]);
  assert.ok(!/\bM6\b/.test(SCRIPT));
  assert.ok(count(/^srazit .* hrany svislé$/) >= 8, "chamfered plates");
  assert.equal(count(/^text "959-01-00" /), 1, "text plate");
  // hole face numbers are literal (first kernel pass), no placeholder left
  assert.ok(!/\{F:/.test(SCRIPT));
  assert.equal(count(/^sestava vazba .* F\d+/), 15);
});

test("the 12th mate is the motor's distance mate", () => {
  const mates = lines.filter((l) => l.startsWith("sestava vazba "));
  assert.match(mates[spec.DRIVE_MATE - 1], /^sestava vazba vzdálenost ".*Horní deska" F\d+ ".*Základová deska" F\d+ 167$/);
});

test("every mate face is a resolved F-number or a diameter – no side rule a strict run would flag as ambiguous", () => {
  // design 5.2 row 13: `horní` among several upward faces picks the extreme one with "F2 z 5 vyhovujících" → ⚠ select.ambiguous
  const words = /^(zámek|souosost|kontakt|vzdálenost|mez|vzdálenosti|F\d+|Ø\d+(,\d+)?|\d+(,\d+)?(\.\.\d+(,\d+)?)?)$/;
  for (const l of lines.filter((x) => x.startsWith("sestava vazba "))) {
    const rest = l.slice("sestava vazba ".length).replace(/"[^"]*"/g, " ").trim().split(/\s+/);
    assert.ok(rest.every((w) => words.test(w)), l);
  }
  // the first pass matches each plane by normal and height (anyXY) and refuses a non-unique match
  const rows = [
    { face: 0, kind: "plane", normal: [0, 0, 1], origin: [10, 10, 40] },
    { face: 1, kind: "plane", normal: [0, 0, 1], origin: [30, 30, 32] },
    { face: 2, kind: "plane", normal: [0, 0, -1], origin: [10, 10, 0] },
  ];
  assert.equal(pickFace(rows, { id: "top", kind: "plane", normal: [0, 0, 1], at: [0, 0, 40], anyXY: true }), 1);
  assert.throws(() => pickFace([...rows, { face: 3, kind: "plane", normal: [0, 0, 1], origin: [90, 9, 40] }], { id: "top", kind: "plane", normal: [0, 0, 1], at: [0, 0, 40], anyXY: true }), /2 candidates/);
});

test("every screw ends inside the thread of its tapped hole (thread depth, not only hole depth)", () => {
  // a B5 classifier may use the thread depth for the thread band (design 6.3) – the tip must stay inside it
  const sections = new Map();
  let cur = null;
  for (const l of lines) {
    const m = /^nový díl "(.*)"$/.exec(l);
    if (m) sections.set((cur = m[1]), []);
    else if (cur && l.startsWith("díra ")) sections.get(cur).push(l);
  }
  for (const t of EXP.threadPairs) {
    assert.ok(t.engaged_mm + 0.5 <= t.threadDepth_mm, `${t.screw} into ${t.part}: engaged ${t.engaged_mm} vs thread ${t.threadDepth_mm}`);
    assert.ok(t.threadDepth_mm < t.holeDepth_mm);
    const size = /M\d+/.exec(t.screw)[0];
    const holes = sections.get(t.part).filter((l) => l.includes(` hloubka ${t.holeDepth_mm} `) && l.endsWith(`závit ${size} hloubka-závitu ${t.threadDepth_mm}`));
    assert.equal(holes.length, t.n, `${t.part}: ${t.n}× ${size} hole ${t.holeDepth_mm}/${t.threadDepth_mm}`);
  }
  assert.equal(EXP.threadPairs.reduce((a, t) => a + t.n, 0), EXP.clashes.thread);
});

test("verify report lines are lines of synth-959.txt", () => {
  const off = restLineOffset(EXP.faces);
  // the CAD parser trims the text: parsed line j of the rest = file line off + j
  const parsed = spec.restScript(EXP.faces).trim().split("\n");
  parsed.forEach((l, j) => assert.equal(lines[off + j], l, `rest line ${j + 1}`));
  assert.equal(lines[off + parsed.indexOf("kolize")], "kolize");
  assert.deepEqual(sheetSummary("Výkres „List 1“: list A3 na šířku · měřítko 2:1 · pohledy: přední, horní, izometrie · kóty: Chytré kóty (řetězově)\nKóty a popisy (9, z toho vygenerovaných 9):"), { dims: 9, views: ["přední", "horní", "izometrie"] });
});

test("part sheet in the part document: part views only, Chytré kóty generated (loopback, small parts)", async () => {
  const lb = await load("loopback.ts", { quiet: true });
  await lb.init(WEB);
  const s = new lb.Session();
  const head = `nový díl "Deska"\nkvádr 100 60 20\nsrazit 1 hrany svislé\ndíra 10 skrz v 20 20 20\ndíra 8,5 hloubka 15 v 70 30 20 závit M10 hloubka-závitu 12\nnový díl "Kolík"\nválec 10 40\nnová sestava "S"\nvložit "Deska" v 0 0 0 ukotvit\nvložit "Kolík" v 20 20 -10\nvýkres A1 pohledy přední,horní,iso`;
  const r = await s.run(`${head}\nzáložka "Deska"\nvýkres A3 pohledy přední,horní,iso\nkótovat chytře\nvýkres stav`);
  assert.equal(r.errors, 0, r.log.map((l) => l.text).join("\n"));
  const sum = sheetSummary(r.log.map((l) => l.text).join("\n"));
  assert.deepEqual(sum.views, ["přední", "horní", "izometrie"]);
  assert.ok(sum.dims > 0, JSON.stringify(sum));
  assert.equal(s.doc("Deska").drawings.length, 1);
  assert.equal(s.doc("S").drawings.length, 1);
  // the old construct (a second sheet of the ASSEMBLY + `výkres model`) projects the whole assembly and has no dimensions
  const s2 = new lb.Session();
  const r2 = await s2.run(`${head}\nvýkres list nový "Deska"\nvýkres A3 pohledy iso\nvýkres model "Deska" pohled horní\nvýkres stav`);
  const old = sheetSummary(r2.log.map((l) => l.text).join("\n"));
  assert.deepEqual(old.views, ["přední", "Deska", "izometrie"]);
  assert.equal(old.dims, 0);
});

test("expected.json follows the package contract", () => {
  assert.equal(EXP.components, 70);
  assert.deepEqual(EXP.mates, { total: 53, ok: 53 });
  assert.equal(EXP.clashes.real, 0);
  assert.equal(EXP.clashes.thread, 30);
  assert.equal(EXP.sheets, 4);
  assert.equal(EXP.protocolMaxBytes, 2048);
  assert.equal(EXP.maxSeconds, 120);
  assert.equal(EXP.maxRssMB, 2048);
  assert.equal(EXP.strictOverheadMax, 0.25);
  assert.equal(EXP.volume_tol_cm3, 0.01);
  assert.equal(typeof EXP.volume_cm3, "number");
  assert.ok(EXP.volume_union_cm3 < EXP.volume_cm3);
  assert.equal(EXP.lines, lines.length);
  const sum = Object.entries(EXP.componentCounts).reduce((s, [k, n]) => s + n * EXP.partVolumes_mm3[k], 0) / 1000;
  assert.ok(Math.abs(sum - EXP.volume_cm3) < 0.001, `Σ parts ${sum} vs ${EXP.volume_cm3}`);
});

test("committed files are up to date with the generator (synth-tool.mjs --check)", () => {
  assert.equal(spec.script(EXP.faces), SCRIPT);
  assert.equal(`${JSON.stringify(spec.expected(EXP.faces), null, 2)}\n`, fs.readFileSync(path.join(HARNESS, "expected.json"), "utf8"));
  const r = spawnSync(process.execPath, [path.join(HARNESS, "synth-tool.mjs"), "--check"], { encoding: "utf8" });
  assert.equal(r.status, 0, r.stdout + r.stderr);
});

test("analytic formulas agree with independent numeric integration", () => {
  const { ring, blind, cyl } = spec.formulas;
  // triangle with legs c at a circular edge, revolved: ∫₀ᶜ 2π(r ∓ u)(c − u) du by the midpoint rule
  const num = (r, c, concave) => {
    const N = 200000;
    let v = 0;
    for (let i = 0; i < N; i++) {
      const u = ((i + 0.5) * c) / N;
      v += 2 * Math.PI * (concave ? r + u : r - u) * (c - u) * (c / N);
    }
    return v;
  };
  for (const [r, c, concave] of [[5, 0.5, false], [16, 1, false], [12, 1, true]]) {
    const a = ring(r, c, concave);
    assert.ok(Math.abs(a - num(r, c, concave)) < 1e-9 * a + 1e-12, `ring ${r} ${c} ${concave}: ${a} vs ${num(r, c, concave)}`);
  }
  // blind hole: cylinder + cone of height r / tan(59°), numeric disc sum
  const d = 8.5;
  const h = 30;
  const tip = (d / 2) / Math.tan((118 * Math.PI) / 360);
  let v = cyl(d, h);
  const N = 100000;
  for (let i = 0; i < N; i++) v += Math.PI * ((d / 2) * (1 - (i + 0.5) / N)) ** 2 * (tip / N);
  assert.ok(Math.abs(blind(d, h) - v) < 1e-6);
});

test("text area: exact Bézier integral = densely flattened outline", async () => {
  const { createRequire } = await import("node:module");
  const require = createRequire(path.join(spec.WEB, "package.json"));
  const opentype = require("opentype.js");
  const buf = fs.readFileSync(path.join(spec.WEB, "public", "fonts", "Roboto-Bold.ttf"));
  const font = opentype.parse(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength));
  const cmds = font.getPath(spec.TEXT, 0, 0, 6, {}).commands;
  let area = 0;
  let poly = [];
  const flush = () => {
    for (let i = 0; i < poly.length; i++) {
      const [x1, y1] = poly[i];
      const [x2, y2] = poly[(i + 1) % poly.length];
      area += x1 * y2 - x2 * y1;
    }
    poly = [];
  };
  let p = null;
  for (const c of cmds) {
    if (c.type === "M") {
      if (poly.length) flush();
      p = [c.x, c.y];
      poly.push(p);
    } else if (c.type === "L") poly.push((p = [c.x, c.y]));
    else if (c.type === "Q") {
      const p0 = p;
      for (let k = 1; k <= 400; k++) {
        const t = k / 400;
        poly.push([(1 - t) ** 2 * p0[0] + 2 * (1 - t) * t * c.x1 + t * t * c.x, (1 - t) ** 2 * p0[1] + 2 * (1 - t) * t * c.y1 + t * t * c.y]);
      }
      p = [c.x, c.y];
    } else if (c.type === "Z" && poly.length) flush();
  }
  if (poly.length) flush();
  const flat = Math.abs(area) / 2;
  assert.ok(Math.abs(flat - spec.textArea(spec.TEXT, 6)) / flat < 1e-5, `${flat} vs ${spec.textArea(spec.TEXT, 6)}`);
  assert.ok(flat > 20 && flat < 200);
});

test("every line parses with the CAD parser; only `kontrola` waits for package B5", async () => {
  const file = await bundle("parse-check.ts", { quiet: true });
  const out = JSON.parse(execFileSync(process.execPath, [file, path.join(HARNESS, "synth-959.txt")], { encoding: "utf8" }));
  assert.deepEqual(out.errors.map((e) => e.text), ["kontrola sestava"]);
  assert.equal(out.kinds.insert, 70);
  assert.equal(out.kinds.library, 5);
  assert.equal(out.kinds.measure, 3);
  assert.equal(out.kinds.clash, 1);
});

test("bench-motion: script split and motion analysis", () => {
  const sp = splitScript(SCRIPT, 4);
  assert.equal(sp.motor, "pohyb motor lineární vazba 12 167..117 kroky 4");
  assert.ok(sp.collisions);
  assert.ok(!sp.before.split("\n").some((l) => l.startsWith("pohyb ")) && sp.before.split("\n").length === sp.motionLine - 1);
  assert.deepEqual(EXP.motion.guided, [spec.NAMES.top, spec.NAMES.stripper]);
  assert.equal(EXP.motion.stroke_mm, 50);
  assert.equal(EXP.motion.stripperTravel_mm, 20);
  assert.equal(EXP.motion.clashesPerStep, 30);
  const asm = { components: [{ id: "t", name: "T", placement: { position: [0, 0, 207], rotation: [0, 0, 0] } }, { id: "s", name: "S", placement: { position: [0, 0, 106], rotation: [0, 0, 0] } }, { id: "b", name: "B" }, { id: "x", name: "X" }] };
  const exp = { motion: { guided: ["T", "S"], stroke_mm: 25, stripperTravel_mm: 6, clashesPerStep: 1 }, threadPairs: [{ screw: "X", part: "B" }] };
  const steps = (place, clashes) => ({ conflictSteps: 0, collisionsChecked: true, steps: [{ place: {}, clashes: [{ a: "x", b: "b", volume: 1 }] }, { place, clashes }] });
  const a = analyse(steps({ t: { position: [0.2, 0, 182] }, s: { position: [0, 0, 100] } }, [{ a: "t", b: "s", volume: 3 }]), asm, exp);
  assert.deepEqual(a.guided.map((g) => [g.travelZ_mm, g.driftXY_mm, g.rotation_deg]), [[25, 0.2, 0], [6, 0, 0]]);
  assert.equal(a.maxDrift_mm, 0.2);
  assert.deepEqual(a.clashesPerStep, [1, 1]);
  assert.equal(a.nonThreadClashSteps, 1);
  assert.equal(a.threadMismatchSteps, 1, "step 1 lost the screw pair");
  assert.deepEqual(a.firstNonThread, ["T × S 3.0mm3"]);
  // a rotated top plate and a stripper that slides sideways are drift (P7: "a natáčí se"); XY of the top stays put
  const b = analyse(steps({ t: { position: [0, 0, 182], rotation: [0, 0, 30] }, s: { position: [800, 0, 100], rotation: [0, 0, 0] } }, [{ a: "x", b: "b", volume: 1 }]), asm, exp);
  assert.equal(b.guided[0].driftXY_mm, 0);
  assert.equal(b.maxRotation_deg, 30);
  assert.equal(b.maxDrift_mm, 800);
  assert.equal(b.threadMismatchSteps, 0);
  const vb = motionVerdict({ col: { ms: 1000, calls: 41, ...b }, peakRssMB: 500, exp });
  assert.equal(vb.verdict.noDrift, false);
  assert.equal(vb.pass, false);
  // steps that LOSE the thread pairs (0 instead of 30 per step) fail although no foreign pair appears
  const lost = analyse({ conflictSteps: 0, collisionsChecked: true, steps: [{ place: {}, clashes: [] }, { place: { t: { position: [0, 0, 182] }, s: { position: [0, 0, 100] } }, clashes: [] }] }, asm, { ...exp, motion: { ...exp.motion, clashesPerStep: 30 } });
  assert.equal(lost.nonThreadClashSteps, 0);
  assert.equal(lost.threadMismatchSteps, 2);
  assert.equal(motionVerdict({ col: { ms: 1000, calls: 41, ...lost }, peakRssMB: 500, exp }).verdict.threadPairsEveryStep, false);
  // a foreign script (no expectations, other names): measured, checks that need expectations are null – no crash
  const f = analyse({ conflictSteps: 0, collisionsChecked: true, steps: [{ place: {}, clashes: [] }] }, { components: [{ id: "q", name: "Q", placement: { position: [0, 0, 0] } }] }, {});
  assert.deepEqual([f.guided, f.maxDrift_mm, f.nonThreadClashSteps, f.threadMismatchSteps], [[], null, null, null]);
  const vf = motionVerdict({ col: { ms: 1000, calls: 41, ...f }, peakRssMB: 500, exp: {} });
  assert.deepEqual([vf.verdict.noDrift, vf.verdict.strokeOk, vf.verdict.onlyThreadClashes, vf.pass], [null, null, null, true]);
  assert.deepEqual(loadExpect(path.join(os.tmpdir(), "foreign.txt")), {});
  assert.equal(loadExpect(path.join(HARNESS, "synth-959.txt")).components, 70);
});

test("bench-motion verdict: extrapolation to 41 interference calls (time and memory), --no-collisions", () => {
  const exp = { motion: { guided: ["T"], stroke_mm: 50 }, threadPairs: [] };
  const top = { name: "T", found: true, travelZ_mm: 50, driftXY_mm: 0, rotation_deg: 0 };
  const run = { conflictSteps: 0, guided: [top], maxDrift_mm: 0, maxRotation_deg: 0, nonThreadClashSteps: 0, threadMismatchSteps: null };
  // --steps 2: 3 calls in 19,2 s → 41 calls ≈ 262 s (not 40/2 × 19,2 = 384 s); RSS 507 → 572 → 640 MB: +66,5 MB per call
  const v = motionVerdict({ col: { ms: 19199, calls: 3, ...run }, peakRssMB: 640, stepRss: [507, 572, 640], exp }).verdict;
  assert.equal(v.seconds40, 262.4);
  assert.equal(v.rssGrowthPerCallMB, 66.5);
  assert.equal(v.rssMB40, 640 + Math.round(66.5 * 38));
  assert.equal(v.memoryOk, false, "a short run must not report memoryOk for a configuration that grows past 1.5 GB");
  assert.equal(v.extrapolated, true);
  const full = motionVerdict({ col: { ms: 40000, calls: 41, ...run }, peakRssMB: 900, stepRss: [800, 900], exp });
  assert.deepEqual([full.verdict.extrapolated, full.verdict.timeOk, full.verdict.memoryOk, full.pass], [false, true, true, true]);
  // without collisions: the motion checks decide, there is no time target
  const nc = motionVerdict({ motion: run, peakRssMB: 600, exp });
  assert.deepEqual([nc.verdict.collisions, nc.verdict.timeOk, nc.verdict.noConflicts, nc.verdict.noDrift, nc.verdict.strokeOk, nc.pass], ["skipped", null, true, true, true, true]);
  assert.equal(motionVerdict({ motion: { ...run, conflictSteps: 3 }, peakRssMB: 600, exp }).pass, false);
});

test("watchdog: memory guard and timeout kill the child", async () => {
  const hog = await runWatched(["-e", "const a=[];setInterval(()=>{const b=Buffer.alloc(64<<20,1);a.push(b)},20)"], { maxRss: 400, timeoutS: 20 });
  assert.match(hog.aborted ?? "", /memory guard/);
  assert.equal(hog.signal, "SIGKILL");
  const t0 = Date.now();
  const slow = await runWatched(["-e", "setTimeout(()=>{},30000)"], { maxRss: 4000, timeoutS: 1 });
  assert.match(slow.aborted ?? "", /timeout/);
  assert.ok(Date.now() - t0 < 3000);
  const ok = await runWatched(["-e", "process.stdout.write('@@'+JSON.stringify({a:1})+'\\n')"], { maxRss: 4000, timeoutS: 10 });
  assert.deepEqual(ok.events, [{ a: 1 }]);
  assert.equal(ok.code, 0);
  assert.ok(ok.peakRssMB > 0 || ok.wallMs < 250);
});

test("watchdog: a terminated or killed bench takes its watched child down (no orphan)", async () => {
  const proc = pathToFileURL(path.join(HARNESS, "proc.mjs")).href;
  // the child blocks its main thread like a long synchronous OCCT call; only the worker-thread watchdog can still act
  const childCode = `import { exitWithParent, emit } from ${JSON.stringify(proc)}; exitWithParent(100); emit({ pid: process.pid }); Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 60000);`;
  const parentCode = `import { runWatched } from ${JSON.stringify(proc)}; await runWatched(["--input-type=module", "-e", ${JSON.stringify(childCode)}], { onEvent: (e) => process.stdout.write("@@" + JSON.stringify(e) + "\\n") });`;
  for (const sig of ["SIGTERM", "SIGKILL"]) {
    const parent = spawn(process.execPath, ["--input-type=module", "-e", parentCode], { stdio: ["ignore", "pipe", "inherit"] });
    const pid = await new Promise((res, rej) => {
      let buf = "";
      parent.stdout.on("data", (d) => {
        buf += d;
        const m = /@@(\{.*\})/.exec(buf);
        if (m) res(JSON.parse(m[1]).pid);
      });
      setTimeout(() => rej(new Error("no child pid")), 15000);
    });
    assert.ok(alive(pid));
    parent.kill(sig);
    const t0 = Date.now();
    while (alive(pid) && Date.now() - t0 < 5000) await new Promise((r) => setTimeout(r, 50));
    assert.equal(alive(pid), false, `child still running ${Date.now() - t0} ms after ${sig} of the parent`);
  }
});

test("bench-strict: a run with ⚠ lines is not clean (loopback)", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "mncad-warn-"));
  // `díra … v 50 50 10` lies outside the 10 mm box: the build leaves the body unchanged → ⚠ in the strict run
  fs.writeFileSync(path.join(dir, "warn.txt"), 'nový díl "A"\nkvádr 10 10 10\ndíra 2 hloubka 3 v 50 50 10\nnový díl "B"\nkvádr 10 10 10\n');
  const r = spawnSync(process.execPath, [path.join(HARNESS, "bench-strict.mjs"), "--script", path.join(dir, "warn.txt"), "--skip", "motion,drawings", "--max-overhead", "100"], { encoding: "utf8", timeout: 120000 });
  const rep = JSON.parse(r.stdout);
  const strict = rep.runs.find((x) => x.mode === "strict");
  assert.ok(strict.warnCount > 0, JSON.stringify(strict));
  assert.equal(rep.clean, false);
  assert.equal(rep.pass, false);
  assert.equal(r.status, 1);
  fs.rmSync(dir, { recursive: true, force: true });
});

test("the documented test command points at an existing file", () => {
  const head = fs.readFileSync(path.join(HARNESS, "harness.test.mjs"), "utf8").split("\n")[0];
  const m = /Run \(from website\/\): node --test (\S+)/.exec(head);
  assert.ok(m && fs.statSync(path.join(WEB, m[1])).isFile(), head);
});

test("bench-strict: verdict and CLI mode against a stub mncad", () => {
  assert.deepEqual(verdict([100, 120, 110], [130, 140, 125], 0.25), { normalMs: 110, strictMs: 130, overhead: 0.1818, max: 0.25, ok: true });
  // the overall overhead must not hide a doubled geometry time behind minutes of sheet projection (both parts ≤ max)
  const kinds = { normal: [{ parts: 10000, mates: 10000, drawings: 300000, endOfRun: 100000 }], strict: [{ parts: 30000, mates: 10000, drawings: 300000, endOfRun: 100000 }] };
  const split = verdict([420000], [440000], 0.25, kinds);
  assert.equal(split.overhead, 0.0476);
  assert.deepEqual(split.withoutDrawings, { normalMs: 20000, strictMs: 40000, overhead: 1 });
  assert.equal(split.ok, false);
  // parts below 1 s are not judged (no sheets → no drawing overhead from noise)
  assert.equal(verdict([20000], [22000], 0.25, { normal: [{ parts: 19900, endOfRun: 69 }], strict: [{ parts: 21800, endOfRun: 114 }] }).drawings.overhead, null);
  assert.equal(verdict([100], [130], 0.25).ok, false);
  assert.equal(median([3, 1, 2, 10]), 2.5);
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "mncad-stub-"));
  const stub = (file, normalMs, strictMs, strictExit = 0) =>
    fs.writeFileSync(
      path.join(dir, file),
      `const s=process.argv.includes("--strict");const ms=s?${strictMs}:${normalMs};Atomics.wait(new Int32Array(new SharedArrayBuffer(4)),0,0,ms);` +
        `process.stdout.write(JSON.stringify({v:1,ok:true,strict:s,stopped:s&&${strictExit}===2?{line:1,code:"x"}:undefined}));process.exitCode=s?${strictExit}:0;`,
    );
  // sleeps long enough that process start-up noise (±0.1 s on the shared machine) stays far below the 25 % threshold
  stub("fast.mjs", 1200, 1320);
  stub("slow.mjs", 1200, 2400);
  stub("stop.mjs", 1200, 1250, 2);
  const run = (f) => spawnSync(process.execPath, [path.join(HARNESS, "bench-strict.mjs"), "--cli", path.join(dir, f), "--runs", "2"], { encoding: "utf8" });
  const fast = run("fast.mjs");
  assert.equal(fast.status, 0, fast.stdout + fast.stderr);
  const rep = JSON.parse(fast.stdout);
  assert.equal(rep.mode, "cli");
  assert.equal(rep.runs.length, 4);
  assert.ok(rep.verdict.overhead > 0 && rep.verdict.overhead < 0.25, JSON.stringify(rep.verdict));
  assert.equal(run("slow.mjs").status, 1, "overhead ~100 % fails");
  const stop = run("stop.mjs");
  assert.equal(stop.status, 1, "a strict STOP (exit 2) is not a pass");
  assert.equal(JSON.parse(stop.stdout).clean, false);
  fs.rmSync(dir, { recursive: true, force: true });
});

test("kernel: analytic volumes, 70/53, clash pairs (CAD_HARNESS_KERNEL=1)", { skip: !process.env.CAD_HARNESS_KERNEL }, () => {
  const r = spawnSync(process.execPath, ["--max-old-space-size=2048", path.join(HARNESS, "synth-tool.mjs"), "--verify", "--no-drawings"], { encoding: "utf8", timeout: 900000 });
  const rep = JSON.parse(r.stdout);
  assert.equal(rep.ok, true, JSON.stringify(rep.checks.filter((c) => c.pass === false), null, 1));
});
