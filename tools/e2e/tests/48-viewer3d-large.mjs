// E2E · Velká sestava ve 3D prohlížeči (majitel 13. 11.): „Když otevřu velkou sestavu (50–150 MB, zakázka 084),
// prohlížeč ji neumí otevřít — zůstane na ‚Čtu geometrii' navždy."
//
// Příčina: OpenCascade (WebAssembly) četlo celý STEP najednou — čas i paměť rostou rychleji než velikost
// (30 MB: > 4 min a > 2,3 GB, 150 MB: přes limit 2 GB → worker tiše spadne, kolečko se točí dál).
// Teď se velká sestava rozebere na díly, ty se čtou souběžně v několika workerech (každý díl jednou,
// výskyty se jen umístí), s průběhem „díl 120 / 850" a hlídáním zaseknutého workeru.
//
// Test vyrobí sestavu za běhu (nic velkého se necommituje), nahraje ji k zakázce, otevře v prohlížeči
// a ověří: ukazuje se průběh po dílech, model se vykreslí (plátno není prázdné), počet dílů sedí, čas.
//
//   tools/e2e/run-app.sh && node tools/e2e/tests/48-viewer3d-large.mjs
//   VIEWER_LARGE_MB=150 …           # velikost sestavy (výchozí 60 MB)
//   VIEWER_LARGE_STL_MB=150 …       # navíc binární STL dané velikosti
//   VIEWER_LARGE_HEAP_MB=1024 …     # omezená paměť JS (V8) v Chromiu (slabší PC)
//   Lokální úložiště musí pustit velký upload: STORAGE_FILE_SIZE_LIMIT=524288000 tools/local-supabase/start.sh
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { chromium } from "playwright";
import sharp from "sharp";
import { BASE, USERS, login, localEnv, sql, summary, test, expect, ARTIFACTS } from "../lib.mjs";
import { writeStepAssembly } from "../gen-step-assembly.mjs";

const PREFIX = "E2E-large3d-";
const MB = Number(process.env.VIEWER_LARGE_MB ?? 60);
const STL_MB = Number(process.env.VIEWER_LARGE_STL_MB ?? 0);
const HEAP_MB = Number(process.env.VIEWER_LARGE_HEAP_MB ?? 0);
const TIMEOUT = Number(process.env.VIEWER_LARGE_TIMEOUT_S ?? 900) * 1000;
const WORK = fs.mkdtempSync(path.join(process.env.VIEWER_LARGE_DIR ?? os.tmpdir(), "e2e-large3d-"));
const lit = (v) => (v === null || v === undefined ? "null" : `'${String(v).replace(/'/g, "''")}'`);

async function upload(jobId, filename, bytes, mime) {
  const env = localEnv();
  const storagePath = `${jobId}/${randomUUID()}-${filename.replace(/[^\w.-]+/g, "_")}`;
  const r = await fetch(`${env.NEXT_PUBLIC_SUPABASE_URL}/storage/v1/object/job-files/${storagePath}`, {
    method: "POST",
    headers: { apikey: env.SUPABASE_SECRET_KEY, authorization: `Bearer ${env.SUPABASE_SECRET_KEY}`, "content-type": mime, "x-upsert": "true" },
    body: bytes,
  });
  if (!r.ok) throw new Error(`upload ${filename} (${bytes.length} B): ${r.status} ${await r.text()} — velký upload: STORAGE_FILE_SIZE_LIMIT=524288000 tools/local-supabase/start.sh`);
  const adminId = sql(`select id from profiles where email = 'admin@local.test'`);
  return sql(`insert into job_files (job_id, kind, filename, mime_type, size_bytes, storage_path, version, archived, uploaded_by, anon_status)
    values (${lit(jobId)}, 'model_3d'::job_file_kind, ${lit(filename)}, ${lit(mime)}, ${bytes.length}, ${lit(storagePath)}, 1, false, ${lit(adminId)}, 'skipped') returning id`).split("\n")[0];
}

function cleanup() {
  const env = localEnv();
  for (const id of sql(`select id from orders where title like ${lit(`${PREFIX}%`)}`).split("\n").filter(Boolean)) {
    for (const p of sql(`select storage_path from job_files where job_id = ${lit(id)}`).split("\n").filter(Boolean)) {
      void fetch(`${env.NEXT_PUBLIC_SUPABASE_URL}/storage/v1/object/job-files/${p}`, { method: "DELETE", headers: { apikey: env.SUPABASE_SECRET_KEY, authorization: `Bearer ${env.SUPABASE_SECRET_KEY}` } }).catch(() => {});
    }
    sql(`delete from job_files where job_id = ${lit(id)}`);
    sql(`delete from orders where id = ${lit(id)}`);
  }
  sql(`delete from customers where name like ${lit(`${PREFIX}%`)}`);
}

/** Binární STL: mřížka kostek (12 trojúhelníků) do dané velikosti. */
function writeBinaryStl(file, mb) {
  const tris = Math.floor((mb * 1024 * 1024 - 84) / 50 / 12) * 12;
  const buf = Buffer.alloc(84 + tris * 50);
  buf.writeUInt32LE(tris, 80);
  const side = Math.ceil(Math.cbrt(tris / 12));
  const q = [[0, 0, 0], [1, 0, 0], [1, 1, 0], [0, 1, 0], [0, 0, 1], [1, 0, 1], [1, 1, 1], [0, 1, 1]];
  const f = [[0, 2, 1], [0, 3, 2], [4, 5, 6], [4, 6, 7], [0, 1, 5], [0, 5, 4], [1, 2, 6], [1, 6, 5], [2, 3, 7], [2, 7, 6], [3, 0, 4], [3, 4, 7]];
  let o = 84;
  for (let c = 0; c < tris / 12; c++) {
    const ox = (c % side) * 3, oy = (Math.floor(c / side) % side) * 3, oz = Math.floor(c / side / side) * 3;
    for (const t of f) {
      o += 12; // normála 0 (dopočítá se)
      for (const v of t) {
        buf.writeFloatLE(ox + q[v][0] * 2, o);
        buf.writeFloatLE(oy + q[v][1] * 2, o + 4);
        buf.writeFloatLE(oz + q[v][2] * 2, o + 8);
        o += 12;
      }
      o += 2;
    }
  }
  fs.writeFileSync(file, buf);
  return { bytes: buf.length, tris };
}

/** Plátno má vykreslený obsah (ne jednobarevné pozadí). */
async function canvasDrawn(page) {
  const png = await page.locator('[data-testid="viewer3d-canvas"] canvas').first().screenshot();
  const { channels } = await sharp(png).stats();
  return channels.slice(0, 3).reduce((s, c) => s + c.stdev, 0);
}

async function openAndMeasure(page, fileId, filename) {
  const t0 = Date.now();
  await page.goto(`${BASE}/view?${new URLSearchParams({ src: `/api/jobs/files/${fileId}`, name: filename })}`);
  await page.getByTestId("file-viewer").waitFor();
  let tDownloaded = 0;
  let maxDone = 0, total = 0, sawProgress = false;
  const stages = new Set();
  const deadline = Date.now() + TIMEOUT;
  for (;;) {
    const state = await page.evaluate(() => ({
      status: document.querySelector('[data-testid="viewer3d-status"]')?.textContent ?? null,
      error: document.querySelector('[data-testid="viewer3d-error"]')?.textContent ?? document.querySelector('[role="alert"]')?.textContent ?? null,
      stage: document.querySelector('[data-testid="viewer3d-stage"]')?.textContent ?? null,
      heap: (performance).memory?.usedJSHeapSize ?? 0,
    }));
    if (state.stage && !tDownloaded) tDownloaded = Date.now();
    if (state.stage) stages.add(state.stage.replace(/[\d\s ]+\/[\d\s ]+/, " n / N").trim());
    const m = state.stage?.match(/díl\s+([\d\s ]+)\s*\/\s*([\d\s ]+)/);
    if (m) {
      sawProgress = true;
      maxDone = Math.max(maxDone, Number(m[1].replace(/\D/g, "")));
      total = Number(m[2].replace(/\D/g, ""));
    }
    if (state.status) {
      const statsAttr = await page.getByTestId("viewer3d-root").getAttribute("data-load-stats").catch(() => null);
      return { stats: statsAttr ? JSON.parse(statsAttr) : null, ms: Date.now() - t0, downloadMs: (tDownloaded || Date.now()) - t0, status: state.status, sawProgress, maxDone, total, stages: [...stages], heapMb: Math.round(state.heap / 1048576) };
    }
    if (state.error) throw new Error(`prohlížeč hlásí chybu: ${state.error}`);
    if (Date.now() > deadline) throw new Error(`model se nenačetl do ${TIMEOUT / 1000} s (poslední krok: ${state.stage})`);
    await page.waitForTimeout(500);
  }
}

async function browserWith() {
  const args = ["--no-sandbox", "--enable-precise-memory-info"];
  if (HEAP_MB) args.push(`--js-flags=--max-old-space-size=${HEAP_MB}`);
  return chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined, args });
}

cleanup();
const adminId = sql(`select id from profiles where email = 'admin@local.test'`);
const cust = sql(`insert into customers (name, country, owner_id, payment_terms_days) values (${lit(`${PREFIX}Zákazník`)}, 'CZ', ${lit(adminId)}, 14) returning id`).split("\n")[0];
const job = sql(`insert into orders (number, title, customer_id, owner_id, created_by, status, source, inquiry_date)
  values (next_job_number(), ${lit(`${PREFIX}Zakázka 084`)}, ${lit(cust)}, ${lit(adminId)}, ${lit(adminId)}, 'poptavka'::job_stage, 'manual', app_today()) returning id`).split("\n")[0];

const stepFile = path.join(WORK, "sestava-084.stp");
const gen = writeStepAssembly(stepFile, { targetMB: MB, seed: 84 });
console.log(`  · vygenerováno ${(gen.bytes / 1048576).toFixed(1)} MB: ${gen.parts} dílů, ${gen.instances} výskytů, ${gen.faces} ploch`);
let stepId = await upload(job, "SESTAVA-084.stp", fs.readFileSync(stepFile), "application/octet-stream");
fs.rmSync(stepFile);
// poškozený velký STEP (hlavička + nesmysly) → srozumitelná chyba se stažením, ne nekonečné kolečko
const junk = Buffer.concat([Buffer.from("ISO-10303-21;\nHEADER;\nFILE_SCHEMA(('AUTOMOTIVE_DESIGN'));\nENDSEC;\nDATA;\n"), Buffer.alloc(7 * 1024 * 1024, "#1=GARBAGE((((;\n"), Buffer.from("ENDSEC;\nEND-ISO-10303-21;\n")]);
const junkId = await upload(job, "poskozeny.stp", junk, "application/octet-stream");
let stl = null;
if (STL_MB) {
  const stlFile = path.join(WORK, "velky.stl");
  const s = writeBinaryStl(stlFile, STL_MB);
  stl = { id: await upload(job, "velky.stl", fs.readFileSync(stlFile), "model/stl"), ...s };
  fs.rmSync(stlFile);
}

const browser = await browserWith();
const errors = [];
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, locale: "cs-CZ" });
ctx.on("page", (p) => {
  p.on("pageerror", (e) => errors.push(`pageerror: ${e.message}`));
  p.on("console", (m) => {
    if (m.type() === "error" && !/favicon|DevTools|hydrat/i.test(m.text())) errors.push(`console: ${m.text().slice(0, 300)}`);
  });
});
const page = await ctx.newPage();
await login(page, USERS.admin);

await test(`STEP sestava ${MB} MB: průběh po dílech, vykreslí se, počet dílů sedí`, async () => {
  const r = await openAndMeasure(page, stepId, "SESTAVA-084.stp");
  console.log(`      načteno za ${(r.ms / 1000).toFixed(1)} s (stažení ${(r.downloadMs / 1000).toFixed(1)} s), díly ${r.maxDone}/${r.total}, JS heap stránky ${r.heapMb} MB`);
  console.log(`      kroky: ${r.stages.join(" → ")}`);
  console.log(`      stav: ${r.status}`);
  console.log(`      časy (ms): ${JSON.stringify(r.stats)}`);
  expect(r.sawProgress && r.total > 0, `průběh „díl n / N" (viděno: ${r.stages.join(", ")})`);
  const parts = Number((r.status.match(/·\s*([\d\s ]+)\s*dílů/) ?? [])[1]?.replace(/\D/g, "") ?? 0);
  expect(parts === gen.instances, `počet dílů ${parts} = výskytů v sestavě ${gen.instances}`);
  expect(/STEP/.test(r.status), `formát STEP: ${r.status}`);
  await page.waitForTimeout(800);
  const stdev = await canvasDrawn(page);
  expect(stdev > 4, `plátno má vykreslený model (rozptyl barev ${stdev.toFixed(1)})`);
  await page.screenshot({ path: path.join(ARTIFACTS, "48-large-step.png") });
  // strom dílů (otevírá se na širokém displeji) se vykreslí a jde zavřít; model jde otočit
  const box = await page.getByTestId("viewer3d-canvas").boundingBox();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down({ button: "middle" });
  await page.mouse.move(box.x + box.width / 2 + 80, box.y + box.height / 2 + 30, { steps: 5 });
  await page.mouse.up({ button: "middle" });
  expect(await canvasDrawn(page) > 4, "po otočení je model pořád vidět");
  // měření na velké sestavě: křivky a plochy výskytu se dopočítají až při najetí (líná topologie)
  await page.getByTestId("tool-distance").click();
  let n = 0;
  let last = null;
  for (let dy = -150; dy <= 150 && n < 2; dy += 6) {
    for (let dx = -250; dx <= 250 && n < 2; dx += 6) {
      const x = box.x + box.width / 2 + dx, y = box.y + box.height / 2 + dy;
      if (last && Math.hypot(x - last[0], y - last[1]) < 40) continue;
      await page.mouse.move(x, y);
      if (await page.getByTestId("snap-marker").count()) {
        await page.mouse.click(x, y);
        last = [x, y];
        n++;
        await page.waitForTimeout(100);
      }
    }
  }
  expect(n === 2, `dva body s uchopením na velké sestavě (${n})`);
  await page.getByTestId("measure-item").first().waitFor({ timeout: 10_000 });
  expect(/mm/.test(await page.getByTestId("measure-item").first().innerText()), "měření na velké sestavě");
});

await test("poškozený velký STEP: chyba se stažením místo nekonečného načítání", async () => {
  await page.goto(`${BASE}/view?${new URLSearchParams({ src: `/api/jobs/files/${junkId}`, name: "poskozeny.stp" })}`);
  await page.getByTestId("viewer3d-error").waitFor({ timeout: 120_000 });
  const text = await page.getByTestId("viewer3d-error").innerText();
  expect(/nepodařilo/i.test(text), `srozumitelná chyba: ${text}`);
  expect(await page.getByTestId("viewer3d-error-download").isVisible(), "tlačítko Stáhnout");
});

if (stl) {
  await test(`binární STL ${STL_MB} MB (${stl.tris.toLocaleString("cs-CZ")} trojúhelníků) se vykreslí`, async () => {
    const r = await openAndMeasure(page, stl.id, "velky.stl");
    console.log(`      načteno za ${(r.ms / 1000).toFixed(1)} s, JS heap stránky ${r.heapMb} MB, stav: ${r.status}`);
    console.log(`      časy (ms): ${JSON.stringify(r.stats)}`);
    expect(await canvasDrawn(page) > 4, "plátno má vykreslený model");
  });
}

await browser.close();
cleanup();
fs.rmSync(WORK, { recursive: true, force: true });
const ok = summary(errors);
process.exit(ok ? 0 : 1);
