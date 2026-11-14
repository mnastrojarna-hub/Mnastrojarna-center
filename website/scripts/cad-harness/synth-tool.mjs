#!/usr/bin/env node
// Synthetic acceptance tool generator (design CAD-HEADLESS-NAVRH.md 10.1, package A4 harness-gen).
//
//   node scripts/cad-harness/synth-tool.mjs [--out DIR]   first kernel pass (parts + placement through the loopback worker),
//                                                         hole face numbers via compFaces → DIR/synth-959.txt + DIR/expected.json
//   node scripts/cad-harness/synth-tool.mjs --check       no kernel: re-compose the script from the face numbers stored in the
//                                                         committed expected.json and compare both files byte by byte (exit 1)
//   node scripts/cad-harness/synth-tool.mjs --verify      generate in memory, then run the rest of the script (mates, drawings,
//                                                         clash; motion skipped – bench-motion.mjs) and compare the kernel with
//                                                         expected.json: components, mates ok, per-part volumes, Σ volume, clash
//                                                         pairs and overlap volumes, union volume, no line a strict run would
//                                                         stop on (⚠, !, ambiguous face pick), sheets per document; every sheet
//                                                         is then evaluated like an export (`výkres stav`) and timed, and each
//                                                         part sheet must show the part only with Chytré kóty > 0. Line numbers
//                                                         in the report are lines of synth-959.txt. JSON report on stdout.
//   --json FILE  also write the verify report to FILE · --no-drawings  skip the `výkres` ops and the sheet evaluation (the
//   A1 assembly sheet costs minutes of hidden-line projection, almost all of it in the 4 helical springs – measured)
//
// The kernel is the UNCHANGED src/cad/cad.worker.ts in a loopback (like the w14 probes) – no dependency on the headless engine.
import fs from "node:fs";
import path from "node:path";
import { HARNESS, WEB, load } from "./bundle.mjs";
import { procMem } from "./proc.mjs";
import * as spec from "./synth-spec.mjs";

const args = process.argv.slice(2);
const flag = (f) => args.includes(f);
const opt = (f, d) => (args.includes(f) ? args[args.indexOf(f) + 1] : d);
const OUT = path.resolve(opt("--out", HARNESS));
const SCRIPT = "synth-959.txt";
const EXPECTED = "expected.json";
const json = (o) => `${JSON.stringify(o, null, 2)}\n`;

/** match a lookup (cylinder Ø / plane normal + point, assembly coordinates) to exactly one face row of the component */
export function pickFace(rows, q) {
  const hits = rows.filter((r) => {
    if (r.kind !== q.kind || r.cone) return false;
    const dxy = Math.hypot(r.origin[0] - q.at[0], r.origin[1] - q.at[1]);
    if (q.kind === "cylinder") return Math.abs(2 * (r.radius ?? 0) - q.dia) < 0.005 && dxy < 0.05;
    const dot = r.normal[0] * q.normal[0] + r.normal[1] * q.normal[1] + r.normal[2] * q.normal[2];
    return dot > 0.9999 && Math.abs(r.origin[2] - q.at[2]) < 0.01 && (q.anyXY || dxy < 0.5);
  });
  if (hits.length !== 1) throw new Error(`face ${q.id}: ${hits.length} candidates (${q.kind} ${q.dia ?? q.normal} at ${q.anyXY ? `z ${q.at[2]}` : q.at})`);
  return hits[0].face + 1;
}

/** first pass: parts + placement in the loopback, then the face numbers */
export async function firstPass(lb, session) {
  const t0 = Date.now();
  const res = await session.run(spec.partsScript());
  if (res.errors) throw new Error(`first pass: ${res.errors} errors\n${res.log.filter((l) => l.text.startsWith("✗")).map((l) => `L${l.line} ${l.text}`).join("\n")}`);
  const asm = session.assembly();
  const comps = asm.components ?? [];
  const faces = {};
  const rowsOf = new Map();
  for (const q of spec.faceLookups()) {
    const c = comps[q.comp - 1];
    if (!rowsOf.has(c.id)) rowsOf.set(c.id, (await session.compFaces(asm, c.id)).rows);
    faces[q.id] = pickFace(rowsOf.get(c.id), q);
  }
  return { faces, ms: Date.now() - t0, components: comps.length };
}

/**
 * File line of a line of the rest script as the CAD parser numbers it. parseAgentText trims the text, so the leading
 * blank lines of the rest are dropped: rest line j (parsed) = file line partsLines + leading blanks + j.
 */
export function restLineOffset(faces) {
  return spec.partsScript().split("\n").length + spec.restScript(faces).split("\n").findIndex((l) => l.trim());
}

/** "Kóty a popisy (9, z toho vygenerovaných 9)" and the view list of a `výkres stav` text */
export function sheetSummary(text) {
  const dims = /Kóty a popisy \((\d+)/.exec(text);
  const views = /· pohledy: ([^·\n]+?)\s*(?:·|\n|$)/.exec(text);
  return { dims: dims ? Number(dims[1]) : null, views: views ? views[1].split(", ").map((v) => v.trim()) : null };
}

async function verify(lb, session, faces) {
  const exp = spec.expected(faces);
  const P = spec.parts();
  const report = { ok: true, checks: [], timing: {} };
  const check = (name, ok, detail) => {
    report.checks.push({ name, pass: ok, ...detail });
    if (!ok) report.ok = false;
  };
  const off = restLineOffset(faces);
  const at = (l) => (l.line ? `L${l.line + off}` : "end");
  const t0 = Date.now();
  const rest = await session.run(spec.restScript(faces), { skipMotion: true, skipDrawings: flag("--no-drawings"), onOp: (t) => (peak.heap = Math.max(peak.heap, t.heapMB)) });
  report.timing.restMs = Date.now() - t0;
  const errs = rest.log.filter((l) => l.text.startsWith("✗"));
  // `kontrola sestava` is a parse error until package B5 (check-compare) lands – the only tolerated one
  const unexpected = errs.filter((l) => !/„kontrola“/.test(l.text));
  check("script runs without ✗ (kontrola is B5)", unexpected.length === 0, { errors: unexpected.slice(0, 8).map((l) => `${at(l)} ${l.text.slice(0, 200)}`), kontrolaPending: errs.length - unexpected.length });
  // lines a strict engine run (B4) would stop on: ⚠ / ! lines and ambiguous rule-based face picks (design 5.2 #13)
  report.warnings = rest.warnings;
  check("strict-clean: no ⚠/! lines and no ambiguous face pick", rest.warnLines.length === 0, { count: rest.warnLines.length, first: rest.warnLines.slice(0, 5).map((l) => `${at(l)} ${l.text.slice(0, 200)}`) });
  const asm = session.assembly();
  const comps = asm.components ?? [];
  check("components", comps.length === exp.components, { got: comps.length, want: exp.components });
  const status = Object.values(session.mateStatus.get(asm.name) ?? {});
  const okMates = status.filter((s) => s === "ok").length;
  check("mates ok", (asm.mates ?? []).length === exp.mates.total && okMates === exp.mates.ok, { total: (asm.mates ?? []).length, okCount: okMates, want: exp.mates });
  if (flag("--no-drawings")) report.checks.push({ name: "sheets", pass: null, skipped: "--no-drawings" });
  else {
    // sheets of every document (the part sheets live in the part documents)
    const byDoc = Object.fromEntries(session.tabs.filter((t) => t.doc.drawings?.length).map((t) => [t.doc.name, t.doc.drawings.length]));
    const total = Object.values(byDoc).reduce((a, b) => a + b, 0);
    const sorted = (o) => JSON.stringify(Object.entries(o).sort(([a], [b]) => a.localeCompare(b)));
    check("sheets (per document)", total === exp.sheets && sorted(byDoc) === sorted(exp.sheetsByDoc), { got: byDoc, want: exp.sheetsByDoc });
    // evaluate every sheet like an export does (`výkres stav` computes the sheet in the kernel) and time it
    report.timing.sheetsMs = {};
    const parts = [];
    for (const name of Object.keys(exp.sheetsByDoc)) {
      const t1 = Date.now();
      const r = await session.run(`záložka "${name}"\nvýkres stav`);
      report.timing.sheetsMs[name] = Date.now() - t1;
      const text = r.log.map((l) => l.text).join("\n");
      const sum = sheetSummary(text);
      const warn = text.split("\n").filter((l) => /^\s*[⚠!✗]/.test(l)).map((l) => l.trim().slice(0, 160));
      if (name !== exp.assembly) parts.push({ part: name, ...sum, warnings: warn });
      else report.assemblySheet = { ...sum, warnings: warn };
    }
    // a part sheet shows the part only (no assembly projection) and carries generated Chytré kóty
    const want = ["přední", "horní", "izometrie"];
    check("part sheets: part views only, Chytré kóty > 0", parts.every((p) => p.dims > 0 && JSON.stringify(p.views) === JSON.stringify(want)), { parts });
    // a strict run evaluates the sheets after every block of `výkres` lines and stops on their ⚠ / ! (design 5.3)
    const sheetWarn = [...parts.flatMap((p) => p.warnings.map((w) => `${p.part}: ${w}`)), ...(report.assemblySheet?.warnings ?? []).map((w) => `${exp.assembly}: ${w}`)];
    check("sheets evaluate without ⚠ / !", sheetWarn.length === 0, { warnings: sheetWarn.slice(0, 8) });
  }
  // per-part volumes: kernel (exact BRep measure of every leaf) vs analytic
  await session.ensureLeaves(asm);
  const perPart = [];
  let sum = 0;
  const byName = new Map(Object.values(P).map((p) => [p.name, p]));
  for (const c of comps) {
    const v = session.partVolume(c);
    sum += v ?? NaN;
    if (perPart.some((x) => x.part === c.name)) continue;
    const want = byName.get(c.name)?.volume;
    perPart.push({ part: c.name, kernel_mm3: v, analytic_mm3: want, diff_mm3: v - want });
  }
  const worst = perPart.reduce((a, b) => (Math.abs(b.diff_mm3) > Math.abs(a.diff_mm3) ? b : a));
  check("part volumes (|kernel − analytic| ≤ 0.5 mm³)", perPart.every((x) => Math.abs(x.diff_mm3) <= 0.5), { worst: worst.part, worst_mm3: worst.diff_mm3, parts: perPart });
  check("Σ volume", Math.abs(sum / 1000 - exp.volume_cm3) <= exp.volume_tol_cm3, { kernel_cm3: sum / 1000, want_cm3: exp.volume_cm3, diff_cm3: sum / 1000 - exp.volume_cm3 });
  // static clash list: only screw × tapped hole pairs, each with the analytic overlap
  const clash = session.clash ?? [];
  const nameOf = new Map(comps.map((c) => [c.id, c.name]));
  const pairs = clash.map((x) => ({ a: nameOf.get(x.a), b: nameOf.get(x.b), volume: x.volume }));
  const tp = exp.threadPairs;
  const classify = (p) => tp.find((t) => (p.a === t.screw && p.b === t.part) || (p.b === t.screw && p.a === t.part));
  const foreign = pairs.filter((p) => !classify(p));
  const badVol = pairs.filter((p) => classify(p) && Math.abs(p.volume - classify(p).overlap_mm3) > 0.05);
  check("clash pairs = screw × tapped hole only", pairs.length === exp.clashes.thread && foreign.length === 0, { got: pairs.length, want: exp.clashes.thread, foreign: foreign.slice(0, 8) });
  check("clash overlap volumes (± 0.05 mm³)", badVol.length === 0, { bad: badVol.slice(0, 8), sample: pairs.slice(0, 2) });
  const union = (sum - clash.reduce((s, x) => s + x.volume, 0)) / 1000;
  check("union volume (Σ − overlaps)", Math.abs(union - exp.volume_union_cm3) <= exp.volume_tol_cm3, { kernel_cm3: union, want_cm3: exp.volume_union_cm3 });
  report.timing.totalMs = Date.now() - T0;
  report.peakRssMB = Math.round(procMem()?.hwm ?? 0); // VmHWM: exact peak even across long synchronous OCCT calls
  report.peakWasmMB = Math.round(peak.heap);
  // line = line of synth-959.txt
  report.slowOps = rest.timing.sort((a, b) => b.ms - a.ms).slice(0, 6).map((t) => ({ line: t.line + off, op: t.op, ms: t.ms }));
  return report;
}

const T0 = Date.now();
const peak = { heap: 0 };
async function main() {
  if (flag("--check")) {
    const exp0 = JSON.parse(fs.readFileSync(path.join(OUT, EXPECTED), "utf8"));
    const text = spec.script(exp0.faces);
    const want = json(spec.expected(exp0.faces));
    const okS = fs.readFileSync(path.join(OUT, SCRIPT), "utf8") === text;
    const okE = fs.readFileSync(path.join(OUT, EXPECTED), "utf8") === want;
    console.log(JSON.stringify({ check: okS && okE, script: okS, expected: okE }));
    process.exitCode = okS && okE ? 0 : 1;
    return;
  }
  const lb = await load("loopback.ts", { quiet: true });
  const initMs = await lb.init(WEB);
  const session = new lb.Session();
  const fp = await firstPass(lb, session);
  if (flag("--verify")) {
    const rep = await verify(lb, session, fp.faces);
    rep.timing.initMs = initMs;
    rep.timing.firstPassMs = fp.ms;
    const out = json(rep);
    if (opt("--json")) fs.writeFileSync(opt("--json"), out);
    process.stdout.write(out);
    process.exitCode = rep.ok ? 0 : 1;
    return;
  }
  const exp = spec.expected(fp.faces);
  fs.mkdirSync(OUT, { recursive: true });
  fs.writeFileSync(path.join(OUT, SCRIPT), spec.script(fp.faces));
  fs.writeFileSync(path.join(OUT, EXPECTED), json(exp));
  console.log(JSON.stringify({ wrote: [path.join(OUT, SCRIPT), path.join(OUT, EXPECTED)], lines: exp.lines, components: exp.components, mates: exp.mates.total, volume_cm3: exp.volume_cm3, faces: fp.faces, firstPassMs: fp.ms, initMs }));
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(new URL(import.meta.url).pathname)) {
  main().catch((e) => {
    console.error(e?.stack ?? String(e));
    process.exitCode = 3;
  });
}
