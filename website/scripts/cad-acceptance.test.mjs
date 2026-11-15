// Tests of the B6 gate's assertions without the kernel (scripts/cad-acceptance.mjs). Run from website/:
//   node --test scripts/cad-acceptance.test.mjs
// A canned RunReport (shape of `mncad run --json`) with real files on disk must pass checkRun; each defect the gate exists
// for (protocol over budget, a hidden ⚠ code, PDF pages ≠ sheets, a missing D-line key, a strict run that passes despite
// ⚠, no motion summary line) must make exactly the corresponding check fail.
process.env.CAD_ACCEPTANCE_QUIET = "1";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import { test } from "node:test";
import { load } from "./cad-harness/bundle.mjs";
import { checkMotion, checkRun, checkStrict, pdfInfo, REAL_SCRIPT, results } from "./cad-acceptance.mjs";

const require = createRequire(import.meta.url);
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "cad-acceptance-test-"));
process.on("exit", () => fs.rmSync(tmp, { recursive: true, force: true }));
const lib = await load("acceptance-lib.ts", { quiet: true });

/** two-page PDF with texts (jsPDF, as the CLI writes it – compressed content streams) */
function pdf(file, pages, textsPerPage) {
  const { jsPDF } = require("jspdf");
  const d = new jsPDF({ compress: true });
  for (let p = 0; p < pages; p++) {
    if (p) d.addPage();
    for (let i = 0; i < textsPerPage; i++) d.text(`Poz. ${i + 1}`, 10, 10 + i * 4);
  }
  fs.writeFileSync(file, Buffer.from(d.output("arraybuffer")));
  return file;
}
const step = (file) => (fs.writeFileSync(file, "ISO-10303-21;\nHEADER;\nENDSEC;\n"), file);

const ASM = "959-01-00 Střižný nástroj";
function report() {
  const protocol = [
    "MNCAD/1 OK lines=398 ops=359 err=0 warn=1 note=245 t=37.2",
    `⚠ L377 drawing.warning "${ASM}": list List 1: vynecháno: 220: nevešlo se čistě na list (horní)`,
    `= L364 asm "${ASM}" motion steps=40 t=2 motors=1 conflicts=0 travel=50mm:36,20mm:1 static=33`,
    `D "${ASM}" asm comp=70 parts=19 mates=53/53 V.sum=8375.26cm3 V.union=8363.69cm3 m=65.75kg bbox=320x220x304 clash=30(thread=30,real=0) sheets=1`,
    `F step "${ASM}.step" 2133820B check=ok`,
    `F pdf "${ASM} výkres.pdf" 206720B sheets=2`,
    `Σ docs=20 comp=70 mates=53/53 V.sum=8375.26cm3 V.union=8363.69cm3 clash=thread:30,real:0 files=2 t=37.2 mem=1226MB`,
  ].join("\n");
  return {
    v: 1,
    ok: true,
    ms: 37200,
    counts: { lines: 398, ops: 359, ok: 356, notes: 245, warnings: 1, errors: 0 },
    entries: [{ line: 377, level: "warn", code: "drawing.warning", doc: ASM, text: "list List 1: vynecháno: 220: nevešlo se čistě na list (horní)" }],
    docs: [{ ref: ASM, name: ASM, kind: "assembly", main: true, components: 70, parts: 19, mates: { total: 53, ok: 53, conflict: 0, missing: 0, suppressed: 0 }, volume_mm3: 8375264, volume_union_mm3: 8363690, mass_kg: 65.746, bbox: [[0, 0, 0], [320, 220, 304]], clashes: { total: 30, thread: 30, underhead: 0, real: 0, undetermined: 0 }, sheets: 2 }],
    files: [
      { name: `${ASM}.step`, format: "step", bytes: 2133820, doc: ASM, path: step(path.join(tmp, "a.step")), check: { ok: true, text: "kontrola STEP" } },
      { name: `${ASM} výkres.pdf`, format: "pdf", bytes: 206720, doc: ASM, path: pdf(path.join(tmp, "a.pdf"), 2, 60), sheets: 2 },
    ],
    peakMB: 1226,
    protocol,
  };
}
const EXP = { components: 70, mates: { total: 53, ok: 53 }, volume_cm3: 8375.264, volume_union_cm3: 8363.69, volume_tol_cm3: 0.01, clashes: { real: 0, thread: 30 }, sheets: 2, protocolMaxBytes: 2048, maxSeconds: 120, maxRssMB: 2048, pdfTextsMin: 100 };
const ctx = { lib, formats: ["step", "pdf"], share: null, shareSkip: null };
const run = (r, o = {}) => ({ exit: 0, signal: null, aborted: null, wallMs: 38400, peakMB: 1232, report: r, ...o });

/** checks of one checkRun call: name → status */
async function statuses(r, o, exp = EXP) {
  const before = results.length;
  await checkRun("t", run(r, o), exp, ctx);
  return Object.fromEntries(results.slice(before).map((x) => [x.check, x.status]));
}
const failed = (st) => Object.entries(st).filter(([, v]) => v === "fail").map(([k]) => k);

test("pdfInfo: pages and text operators of a compressed jsPDF file", () => {
  assert.deepEqual(pdfInfo(pdf(path.join(tmp, "p.pdf"), 3, 7)), { pages: 3, texts: 21 });
});

test("a good report passes every check", async () => {
  const st = await statuses(report());
  assert.deepEqual(failed(st), []);
  assert.ok(Object.keys(st).length >= 20, Object.keys(st).join("\n"));
});

test("each defect fails exactly its check", async () => {
  const big = report();
  big.protocol = big.protocol.replace(/^Σ/m, `${"⚠ L1 msg.warn x\n".repeat(150)}Σ`);
  assert.ok(failed(await statuses(big)).some((k) => /protocol ≤ 2048 B/.test(k)));

  const hidden = report();
  hidden.entries.push({ line: 390, level: "warn", code: "clash.real", doc: ASM, text: "v pohybu …" });
  assert.deepEqual(failed(await statuses(hidden)), ["every ⚠/✗ code (per document) is visible in the short protocol"]);

  const pages = report();
  pages.files[1].sheets = 3;
  assert.deepEqual(failed(await statuses(pages)), ["PDF pages = sheets (F line)"]);

  const noBbox = report();
  noBbox.protocol = noBbox.protocol.replace(" bbox=320x220x304", "");
  assert.deepEqual(failed(await statuses(noBbox)), ["D line of the main assembly with comp, parts, mates, V.sum, m, bbox"]);

  const vol = report();
  vol.docs[0].volume_mm3 = 8380000;
  vol.docs[0].volume_union_mm3 = 8370000;
  assert.deepEqual(failed(await statuses(vol)).sort(), ["Σ volume 8375.264 cm³ (V.sum or V.union ± 0.01)", "V.union 8363.69 cm³"].sort());

  assert.deepEqual(failed(await statuses(report(), { wallMs: 121000 })), ["wall time < 120 s"]);
  assert.deepEqual(failed(await statuses(report(), { peakMB: 2100 })), ["peak RSS ≤ 2048 MB"]);
  const grammar = report();
  grammar.protocol = grammar.protocol.replace(/^F pdf/m, "F PDF");
  assert.deepEqual(failed(await statuses(grammar)), ["every protocol line matches the grammar (design 4.2)"]);
});

test("strict consistency: ⚠ in the normal run → the strict run must stop on one of its codes and write nothing", () => {
  const before = results.length;
  const normal = run(report());
  checkStrict("t", normal, run({ ...report(), ok: false, stopped: { line: 377, code: "drawing.warning" }, files: [] }, { exit: 2 }));
  checkStrict("t", normal, run(report(), { exit: 0 })); // passes despite ⚠ – the gate must fail it
  const st = results.slice(before).map((x) => x.status);
  assert.deepEqual(st, ["ok", "ok", "ok", "fail"]);
});

test("motion: the one-line summary with rigid-group travel", () => {
  const before = results.length;
  checkMotion("t", report(), { travel_mm: [50, 20] });
  checkMotion("t", { ...report(), protocol: report().protocol.replace(/^= L364 .*$/m, "") }, {});
  assert.deepEqual(
    results.slice(before).filter((x) => x.status !== "note").map((x) => x.status),
    ["ok", "ok", "ok", "fail"],
  );
});

test("the real-script expectation is the one of design 10.4 (70 / 53 / 5241.73 cm³ / real 0 / 2048 B / 120 s)", () => {
  assert.equal(REAL_SCRIPT.components, 70);
  assert.deepEqual(REAL_SCRIPT.mates, { total: 53, ok: 53 });
  assert.equal(REAL_SCRIPT.volume_cm3, 5241.73);
  assert.deepEqual(REAL_SCRIPT.clashes, { real: 0 });
  assert.equal(REAL_SCRIPT.protocolMaxBytes, 2048);
  assert.equal(REAL_SCRIPT.maxSeconds, 120);
});
