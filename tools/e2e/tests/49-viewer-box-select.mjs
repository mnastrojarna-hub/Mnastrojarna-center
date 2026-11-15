// E2E · Výběr oknem v prohlížeči 3D i 2D (majitel 14. 11.): „Prohlížeč v systému pro 3D a 2D neumí vybrat
// oknem, tedy více prvků naráz." + „měly by jít i mazat" (jen v prohlížeči, originál se nemění).
//
// Ovládání: tlačítko „Oknem" (B) → levé tlačítko / prst tažením kreslí obdélník; bez režimu Alt + táhnout.
// Doprava = okno (jen celé uvnitř), doleva = křížení (vše, čeho se dotkne); Shift = přidat, Ctrl = odebrat.
//
//   tools/e2e/run-app.sh && node tools/e2e/tests/49-viewer-box-select.mjs
//   VIEWER_BOX_MB=8 …   # velikost generované STEP sestavy (výchozí 3 MB)
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { BASE, USERS, launch, login, localEnv, sql, summary, test, expect, withContext, ARTIFACTS } from "../lib.mjs";
import { writeStepAssembly } from "../gen-step-assembly.mjs";

const PREFIX = "E2E-boxsel-";
const MB = Number(process.env.VIEWER_BOX_MB ?? 3);
const lit = (v) => (v === null || v === undefined ? "null" : `'${String(v).replace(/'/g, "''")}'`);

async function upload(jobId, filename, bytes, mime, kind) {
  const env = localEnv();
  const storagePath = `${jobId}/${randomUUID()}-${filename.replace(/[^\w.-]+/g, "_")}`;
  const r = await fetch(`${env.NEXT_PUBLIC_SUPABASE_URL}/storage/v1/object/job-files/${storagePath}`, {
    method: "POST",
    headers: { apikey: env.SUPABASE_SECRET_KEY, authorization: `Bearer ${env.SUPABASE_SECRET_KEY}`, "content-type": mime, "x-upsert": "true" },
    body: bytes,
  });
  if (!r.ok) throw new Error(`upload ${filename}: ${r.status} ${await r.text()}`);
  const adminId = sql(`select id from profiles where email = 'admin@local.test'`);
  return sql(`insert into job_files (job_id, kind, filename, mime_type, size_bytes, storage_path, version, archived, uploaded_by, anon_status)
    values (${lit(jobId)}, ${lit(kind)}::job_file_kind, ${lit(filename)}, ${lit(mime)}, ${bytes.length}, ${lit(storagePath)}, 1, false, ${lit(adminId)}, 'skipped') returning id`).split("\n")[0];
}

/** Čtyři kostky 20 mm v řadě po ose X (mezera 10 mm): x = 0, 30, 60, 90. */
function fourCubesObj() {
  const out = [];
  let base = 0;
  for (let k = 0; k < 4; k++) {
    const ox = k * 30;
    out.push(`o Kostka${k + 1}`);
    for (const [x, y, z] of [[0, 0, 0], [20, 0, 0], [20, 20, 0], [0, 20, 0], [0, 0, 20], [20, 0, 20], [20, 20, 20], [0, 20, 20]]) out.push(`v ${x + ox} ${y} ${z}`);
    for (const t of [[1, 3, 2], [1, 4, 3], [5, 6, 7], [5, 7, 8], [1, 2, 6], [1, 6, 5], [2, 3, 7], [2, 7, 6], [3, 4, 8], [3, 8, 7], [4, 1, 5], [4, 5, 8]]) {
      out.push(`f ${t.map((i) => i + base).join(" ")}`);
    }
    base += 8;
  }
  return `${out.join("\n")}\n`;
}

/** Deska 100 × 50 (4 úsečky) s otvorem Ø20 na hladině KONTURA, vpravo šikmá čára na hladině POMOCNA. */
function plateDxf() {
  const g = (...p) => { const o = []; for (let i = 0; i < p.length; i += 2) o.push(String(p[i]), String(p[i + 1])); return o.join("\n"); };
  return [
    g(0, "SECTION", 2, "HEADER", 9, "$ACADVER", 1, "AC1021", 9, "$INSUNITS", 70, 4, 0, "ENDSEC"),
    g(0, "SECTION", 2, "TABLES", 0, "TABLE", 2, "LAYER", 70, 2,
      0, "LAYER", 2, "KONTURA", 70, 0, 62, 7, 6, "CONTINUOUS", 0, "LAYER", 2, "POMOCNA", 70, 0, 62, 1, 6, "CONTINUOUS", 0, "ENDTAB", 0, "ENDSEC"),
    g(0, "SECTION", 2, "ENTITIES",
      0, "LINE", 8, "KONTURA", 10, 0, 20, 0, 30, 0, 11, 100, 21, 0, 31, 0,
      0, "LINE", 8, "KONTURA", 10, 100, 20, 0, 30, 0, 11, 100, 21, 50, 31, 0,
      0, "LINE", 8, "KONTURA", 10, 100, 20, 50, 30, 0, 11, 0, 21, 50, 31, 0,
      0, "LINE", 8, "KONTURA", 10, 0, 20, 50, 30, 0, 11, 0, 21, 0, 31, 0,
      0, "CIRCLE", 8, "KONTURA", 10, 50, 20, 25, 30, 0, 40, 10,
      0, "LINE", 8, "POMOCNA", 10, 200, 20, 0, 30, 0, 11, 300, 21, 50, 31, 0,
      0, "ENDSEC", 0, "EOF"),
  ].join("\n");
}

function cleanup() {
  for (const id of sql(`select id from orders where title like ${lit(`${PREFIX}%`)}`).split("\n").filter(Boolean)) {
    sql(`delete from job_files where job_id = ${lit(id)}`);
    sql(`delete from orders where id = ${lit(id)}`);
  }
  sql(`delete from customers where name like ${lit(`${PREFIX}%`)} and not exists (select 1 from orders o where o.customer_id = customers.id)`);
}

cleanup();
const adminId = sql(`select id from profiles where email = 'admin@local.test'`);
const cust = sql(`insert into customers (name, country, owner_id, payment_terms_days) values (${lit(`${PREFIX}Zákazník`)}, 'CZ', ${lit(adminId)}, 14) returning id`).split("\n")[0];
const job = sql(`insert into orders (number, title, customer_id, owner_id, created_by, status, source, inquiry_date)
  values (next_job_number(), ${lit(`${PREFIX}Zakázka`)}, ${lit(cust)}, ${lit(adminId)}, ${lit(adminId)}, 'poptavka'::job_stage, 'manual', app_today()) returning id`).split("\n")[0];
const files = {};
files.cubes = await upload(job, "CTYRI-KOSTKY.obj", Buffer.from(fourCubesObj()), "text/plain", "model_3d");
files.plate = await upload(job, "DESKA-BOX.dxf", Buffer.from(plateDxf()), "application/dxf", "vykres");
const work = fs.mkdtempSync(path.join(os.tmpdir(), "e2e-boxsel-"));
const stepFile = path.join(work, "sestava.stp");
const gen = writeStepAssembly(stepFile, { targetMB: MB, seed: 49 });
files.asm = await upload(job, "SESTAVA-BOX.stp", fs.readFileSync(stepFile), "application/octet-stream", "model_3d");
fs.rmSync(work, { recursive: true, force: true });
console.log(`  · STEP sestava ${(gen.bytes / 1048576).toFixed(1)} MB: ${gen.instances} výskytů`);

async function open(page, id, name) {
  await page.goto(`${BASE}/view?${new URLSearchParams({ src: `/api/jobs/files/${id}`, name })}`);
  await page.getByTestId("viewer3d-status").waitFor({ timeout: 120_000 });
  // strom dílů / hladin (otevírá se sám na širokém displeji) by zakrýval levou část plátna
  if (await page.getByTestId("viewer3d-tree").count()) await page.getByTestId("tool-tree").click();
  await page.waitForTimeout(300);
}

/** Světové souřadnice → pixely stránky pro pohled „celý model" (stejný výpočet jako engine.fitHeight). */
async function mapper(page, box) {
  const b = await page.getByTestId("viewer3d-canvas").boundingBox();
  const cx = (box.x0 + box.x1) / 2;
  const cy = (box.y0 + box.y1) / 2;
  const h = Math.max(box.y1 - box.y0, (box.x1 - box.x0) / (b.width / b.height)) * 1.14;
  const wpp = h / b.height;
  return { b, at: (x, y) => [b.x + b.width / 2 + (x - cx) / wpp, b.y + b.height / 2 - (y - cy) / wpp] };
}

async function drag(page, [x0, y0], [x1, y1], mods = []) {
  for (const m of mods) await page.keyboard.down(m);
  await page.mouse.move(x0, y0);
  await page.mouse.down();
  await page.mouse.move((x0 + x1) / 2, (y0 + y1) / 2, { steps: 4 });
  await page.mouse.move(x1, y1, { steps: 4 });
  await page.mouse.up();
  for (const m of mods) await page.keyboard.up(m);
}

const partCount = (page) => page.getByTestId("viewer3d-part").getAttribute("data-count").then(Number).catch(() => 0);
const status = (page) => page.getByTestId("viewer3d-status").innerText();

const browser = await launch();
const errors = [];

await test("3D: okno vybere jen kostky celé uvnitř, křížení i dotčené, Shift přidá, Ctrl odebere, Izolovat / Smazat / Zpět", async () => {
  await withContext(browser, errors, async (ctx) => {
    const page = await ctx.newPage();
    await login(page, USERS.admin);
    await open(page, files.cubes, "CTYRI-KOSTKY.obj");
    expect(/4 díly/.test(await status(page)), `4 díly: ${await status(page)}`);
    await page.keyboard.press("5"); // shora: X doprava, kostky v řadě
    await page.waitForTimeout(500);
    // svislá osa obrazovky = výška kostek (0–20), střed 10
    const m = await mapper(page, { x0: 0, x1: 110, y0: 0, y1: 20 });
    await page.getByTestId("tool-box").click();
    expect(await page.getByTestId("viewer3d-root").getAttribute("data-box-mode") === "1", "režim Oknem zapnutý");
    expect(/Výběr oknem/.test(await page.getByTestId("filter-badge").innerText()), "nápověda režimu");

    // okno zleva doprava přes kostky 1 a 2 celé (a kousek kostky 3 → ta ne)
    const p1 = m.at(-4, -6), p2 = m.at(64, 26);
    await page.mouse.move(...p1);
    await page.mouse.down();
    await page.mouse.move(...m.at(30, 10), { steps: 3 });
    const rectMode = await page.getByTestId("box-select-rect").getAttribute("data-mode");
    await page.mouse.move(...p2, { steps: 3 });
    await page.screenshot({ path: path.join(ARTIFACTS, "49-3d-window-drag.png") });
    await page.mouse.up();
    expect(rectMode === "window", `obdélník doprava = okno (${rectMode})`);
    await page.getByTestId("viewer3d-part").waitFor();
    expect(await partCount(page) === 2, `okno: 2 kostky (${await partCount(page)})`);
    const names = await page.getByTestId("parts-selection-names").innerText();
    expect(/Kostka1/.test(names) && /Kostka2/.test(names) && !/Kostka3/.test(names), `seznam vybraných: ${names}`);
    expect(/Rozměr výběru/.test(await page.getByTestId("parts-selection").innerText()), "rozměr výběru");
    expect(await page.getByTestId("box-select-rect").count() === 0, "obdélník po puštění zmizí");

    // křížení zprava doleva přes mezeru mezi 2 a 3 + kousek obou → kostky 2 a 3
    await drag(page, m.at(64, 26), m.at(46, -6));
    expect(await partCount(page) === 2, `křížení: 2 kostky (${await partCount(page)})`);
    const n2 = await page.getByTestId("parts-selection-names").innerText();
    expect(/Kostka2/.test(n2) && /Kostka3/.test(n2), `křížení vybralo 2 a 3: ${n2}`);
    // křížení jen v mezeře (nic se nedotkne) → nic
    await drag(page, m.at(57, 26), m.at(53, -6));
    expect(await page.getByTestId("viewer3d-part").count() === 0, "křížení v mezeře nevybere nic");
    // Shift přidá, Ctrl odebere
    await drag(page, m.at(-4, -6), m.at(24, 26));
    await drag(page, m.at(86, -6), m.at(114, 26), ["Shift"]);
    expect(await partCount(page) === 2, `Shift přidá (1 + 4): ${await partCount(page)}`);
    await drag(page, m.at(-4, -6), m.at(114, 26), ["Shift"]);
    expect(await partCount(page) === 4, `Shift přidá vše: ${await partCount(page)}`);
    await drag(page, m.at(26, -6), m.at(84, 26), ["Control"]);
    expect(await partCount(page) === 2, `Ctrl odebere 2 a 3: ${await partCount(page)}`);
    // Izolovat → 2 skryté; Obnovit vše
    await page.getByTestId("part-isolate").click();
    await page.waitForFunction(() => /2 skryto/.test(document.querySelector('[data-testid="viewer3d-status"]')?.textContent ?? ""));
    await page.getByTestId("tool-showall").click();
    await page.waitForFunction(() => !/skryto/.test(document.querySelector('[data-testid="viewer3d-status"]')?.textContent ?? ""));
    // Smazat vybrané (Del) → zpět Ctrl+Z
    await drag(page, m.at(-4, -6), m.at(54, 26));
    expect(await partCount(page) === 2, "znovu 2 kostky");
    await page.keyboard.press("Delete");
    await page.waitForFunction(() => /2 skryto/.test(document.querySelector('[data-testid="viewer3d-status"]')?.textContent ?? ""));
    await page.keyboard.press("Control+z");
    await page.waitForFunction(() => !/skryto/.test(document.querySelector('[data-testid="viewer3d-status"]')?.textContent ?? ""));
    // Esc zruší výběr, další Esc vypne režim Oknem, prohlížeč zůstává
    await drag(page, m.at(-4, -6), m.at(24, 26));
    await page.keyboard.press("Escape");
    expect(await page.getByTestId("viewer3d-part").count() === 0, "Esc zruší výběr");
    await page.keyboard.press("Escape");
    expect(await page.getByTestId("viewer3d-root").getAttribute("data-box-mode") === null, "druhé Esc vypne režim Oknem");
    expect(await page.getByTestId("file-viewer").isVisible(), "prohlížeč otevřený");

    // bez režimu: levé tažení otáčí (žádný výběr), Alt + tažení = výběr oknem
    await page.keyboard.press("5");
    await page.waitForTimeout(450);
    await drag(page, m.at(-4, -6), m.at(54, 26), ["Alt"]);
    expect(await partCount(page) === 2, `Alt + tažení = okno (${await partCount(page)})`);
    await page.keyboard.press("Escape");
    await drag(page, m.at(-4, -6), m.at(54, 26));
    expect(await page.getByTestId("viewer3d-part").count() === 0, "levé tažení bez režimu nevybírá (otáčí)");
    // klik na díl pořád vybere jeden díl
    await page.keyboard.press("5");
    await page.waitForTimeout(450);
    await page.mouse.click(...m.at(40, 10));
    await page.getByTestId("viewer3d-part").waitFor();
    expect(await partCount(page) === 1, "klik = jeden díl");
  });
});

await test(`3D: STEP sestava (${gen.instances} výskytů) — okno přes celé plátno = všechny díly, okno ⊂ křížení, rychle`, async () => {
  await withContext(browser, errors, async (ctx) => {
    const page = await ctx.newPage();
    await login(page, USERS.admin);
    await open(page, files.asm, "SESTAVA-BOX.stp");
    const total = Number(((await status(page)).match(/·\s*([\d\s ]+)\s*dílů/) ?? [])[1]?.replace(/\D/g, "") ?? 0);
    expect(total === gen.instances, `počet dílů ${total} = ${gen.instances}`);
    await page.keyboard.press("-");
    await page.keyboard.press("-");
    await page.waitForTimeout(300);
    const b = await page.getByTestId("viewer3d-canvas").boundingBox();
    await page.keyboard.press("b");
    let t0 = Date.now();
    await drag(page, [b.x + 4, b.y + b.height - 4], [b.x + b.width - 4, b.y + 4]);
    await page.getByTestId("viewer3d-part").waitFor();
    const tAll = Date.now() - t0;
    expect(await partCount(page) === total, `okno přes celé plátno: ${await partCount(page)} = ${total}`);
    // levá polovina: okno ⊂ křížení
    const L = [b.x + 4, b.y + b.height - 4], R = [b.x + b.width / 2, b.y + 4];
    await page.keyboard.press("Escape");
    t0 = Date.now();
    await drag(page, L, R);
    const win = await partCount(page);
    const tWin = Date.now() - t0;
    await page.keyboard.press("Escape");
    t0 = Date.now();
    await drag(page, R, L);
    const cross = await partCount(page);
    const tCross = Date.now() - t0;
    console.log(`      okno vše ${tAll} ms, okno vlevo ${win} (${tWin} ms), křížení vlevo ${cross} (${tCross} ms) z ${total}`);
    expect(win <= cross && cross > 0 && cross < total, `okno ${win} ≤ křížení ${cross} < ${total}`);
    expect(Math.max(tAll, tWin, tCross) < 5000, "výběr do 5 s i s režií testu");
    // izolovat křížení → zbytek skrytý
    await page.keyboard.press("i");
    await page.waitForFunction((want) => (document.querySelector('[data-testid="viewer3d-status"]')?.textContent ?? "").replace(/\s/g, "").includes(want), `${total - cross}skryto`, { timeout: 10_000 }).catch(() => null);
    const st = (await status(page)).replace(/\s/g, "");
    expect(st.includes(`${total - cross}skryto`), `izolace: ${st}`);
    await page.screenshot({ path: path.join(ARTIFACTS, "49-3d-step-isolate.png") });
  });
});

await test("2D DXF: okno vybere obrys (4 úsečky + kružnice, délka obrysu), křížení dotčené, Ctrl odebere, Smazat + Zpět, upravené PDF", async () => {
  await withContext(browser, errors, async (ctx) => {
    const page = await ctx.newPage();
    await login(page, USERS.admin);
    await open(page, files.plate, "DESKA-BOX.dxf");
    const m = await mapper(page, { x0: 0, x1: 300, y0: 0, y1: 50 });
    await page.getByTestId("tool-box").click();
    const card = page.getByTestId("viewer2d-selection");
    const count = () => card.getAttribute("data-count").then(Number).catch(() => 0);
    const length = () => card.getAttribute("data-length").then(Number).catch(() => 0);

    await drag(page, m.at(-5, -5), m.at(105, 55));
    await card.waitFor();
    expect(await count() === 5, `okno: 5 prvků (${await count()})`);
    expect(Math.abs((await length()) - (300 + 2 * Math.PI * 10)) < 0.2, `délka obrysu ≈ 362,8 mm (${await length()})`);
    const kinds = await page.getByTestId("viewer2d-selection-kinds").innerText();
    expect(/4 úsečky/.test(kinds) && /1 kružnice/.test(kinds), `druhy: ${kinds}`);
    expect(/1× Ø20/.test(await card.innerText()), `průměr otvoru: ${await card.innerText()}`);
    await page.screenshot({ path: path.join(ARTIFACTS, "49-2d-window.png") });

    // křížení zprava doleva přes pravou hranu desky: pravá úsečka + horní a dolní (končí v x = 100)
    await drag(page, m.at(110, 60), m.at(95, -6));
    expect(await count() === 3, `křížení: 3 úsečky (${await count()})`);
    expect(Math.abs((await length()) - 250) < 0.01, `délka 100 + 50 + 100 (${await length()})`);
    // Ctrl + okno kolem kružnice odebere jen ji
    await drag(page, m.at(-5, -5), m.at(105, 55));
    await drag(page, m.at(36, 11), m.at(64, 39), ["Control"]);
    expect(await count() === 4, `Ctrl odebere kružnici (${await count()})`);
    // Shift + klik na kružnici (prvek ve výběru) ji z výběru odebere
    await page.keyboard.press("Escape"); // zruší výběr
    await drag(page, m.at(-5, -5), m.at(105, 55));
    await page.keyboard.down("Shift");
    await page.mouse.click(...m.at(60, 25));
    await page.keyboard.up("Shift");
    expect(await count() === 4, `Shift + klik odebere prvek pod kurzorem (${await count()})`);

    // smazat vybrané (4 úsečky) → jen v prohlížeči; nový výběr oknem najde jen kružnici
    await page.getByTestId("items-delete").click();
    await page.getByTestId("viewer2d-deleted").waitFor();
    expect(/smazáno 4 prvky/.test(await page.getByTestId("viewer2d-deleted").innerText()), "stav: smazáno 4 prvky");
    // úpravy jdou z prohlížeče do hlavičky (efekt po vykreslení) → počkat
    await page.waitForFunction(() => document.querySelector('[data-testid="viewer-convert-pdf"]')?.getAttribute("data-edited") === "1", null, { timeout: 5000 }).catch(() => null);
    expect(await page.getByTestId("viewer-convert-pdf").getAttribute("data-edited") === "1", "tlačítko PDF = upravený výkres");
    expect(/Uložit upravené PDF/.test(await page.getByTestId("viewer-convert-pdf").innerText()), "popisek Uložit upravené PDF");
    await drag(page, m.at(-5, -5), m.at(105, 55));
    expect(await count() === 1, `po smazání okno najde jen kružnici (${await count()})`);
    await page.screenshot({ path: path.join(ARTIFACTS, "49-2d-deleted.png") });
    await page.keyboard.press("Escape");
    // Zpět vrátí smazané
    await page.keyboard.press("Control+z");
    await page.waitForFunction(() => !document.querySelector('[data-testid="viewer2d-deleted"]'));
    await page.waitForFunction(() => !document.querySelector('[data-testid="viewer-convert-pdf"]')?.hasAttribute("data-edited"), null, { timeout: 5000 }).catch(() => null);
    expect(await page.getByTestId("viewer-convert-pdf").getAttribute("data-edited") === null, "po Zpět bez úprav");
    await drag(page, m.at(-5, -5), m.at(105, 55));
    expect(await count() === 5, `po Zpět zase 5 prvků (${await count()})`);
    // smazat kružnici (Del) a pomocnou čáru, Obnovit vše vrátí obojí
    await drag(page, m.at(36, 11), m.at(64, 39));
    await page.keyboard.press("Delete");
    await drag(page, m.at(310, 60), m.at(290, -6));
    expect(await count() === 1, "křížení vybralo pomocnou čáru");
    await page.keyboard.press("Delete");
    expect(/smazáno 2 prvky/.test(await page.getByTestId("viewer2d-deleted").innerText()), "smazáno 2 prvky");
    await page.getByTestId("tool-showall").click();
    await page.waitForFunction(() => !document.querySelector('[data-testid="viewer2d-deleted"]'));

    // upravené PDF: smazat otvor → „Uložit upravené PDF" → nová kopie k zakázce, originál beze změny
    await drag(page, m.at(36, 11), m.at(64, 39));
    await page.keyboard.press("Delete");
    await page.waitForFunction(() => document.querySelector('[data-testid="viewer-convert-pdf"]')?.getAttribute("data-edited") === "1", null, { timeout: 5000 });
    await page.getByTestId("viewer-convert-pdf").click();
    await page.getByTestId("pdf-view").waitFor({ timeout: 60_000 });
    const row = sql(`select filename || '|' || coalesce(note, '') || '|' || coalesce(source_file_id::text, '') from job_files where job_id = ${lit(job)} and filename like 'DESKA-BOX%.pdf' and not archived`);
    expect(row === `DESKA-BOX (upraveno).pdf|Upravená kopie z DESKA-BOX.dxf (smazáno prvků: 1) — originál beze změny|${files.plate}`, `upravená kopie: ${row}`);
    expect(sql(`select count(*) from job_files where id = ${lit(files.plate)} and not archived`) === "1", "originál DXF zůstává");
  });
});

await test("telefon: tlačítko Oknem + tah prstem vybere prvky výkresu", async () => {
  await withContext(browser, errors, async (ctx) => {
    const page = await ctx.newPage();
    await login(page, USERS.admin);
    await open(page, files.plate, "DESKA-BOX.dxf");
    const m = await mapper(page, { x0: 0, x1: 300, y0: 0, y1: 50 });
    await page.getByTestId("tool-box").tap();
    expect(await page.getByTestId("tool-box").getAttribute("aria-pressed") === "true" && await page.getByTestId("tool-select").getAttribute("aria-pressed") === "false", "lišta: Oknem zapnuté, Výběr ne");
    // tah prstem: syntetické pointer události (dotyk) na plátno
    const [x0, y0] = m.at(-5, -5);
    const [x1, y1] = m.at(105, 55);
    await page.evaluate(({ x0, y0, x1, y1 }) => {
      const el = document.querySelector('[data-testid="viewer3d-canvas"] canvas');
      const ev = (type, x, y) => el.dispatchEvent(new PointerEvent(type, { pointerId: 7, pointerType: "touch", isPrimary: true, clientX: x, clientY: y, bubbles: true, button: 0, buttons: type === "pointerup" ? 0 : 1 }));
      ev("pointerdown", x0, y0);
      for (let i = 1; i <= 8; i++) ev("pointermove", x0 + ((x1 - x0) * i) / 8, y0 + ((y1 - y0) * i) / 8);
      ev("pointerup", x1, y1);
    }, { x0, y0, x1, y1 });
    await page.getByTestId("viewer2d-selection").waitFor();
    const n = Number(await page.getByTestId("viewer2d-selection").getAttribute("data-count"));
    expect(n === 5, `tah prstem: 5 prvků (${n})`);
    await page.waitForTimeout(400);
    await page.screenshot({ path: path.join(ARTIFACTS, "49-mobile-2d.png") });
  }, { mobile: true });
});

await browser.close();
cleanup();
const ok = summary(errors);
process.exit(ok ? 0 : 1);
