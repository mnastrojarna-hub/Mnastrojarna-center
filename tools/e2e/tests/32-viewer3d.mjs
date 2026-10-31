// E2E · Prohlížeč dokumentů a 3D modelů (STEP / IGES / STL / PDF / fotky) — otevření v aplikaci,
// ovládání jako ZW3D, mazání dílů se zpět / vpřed, měření, tlačítko i systémové „zpět" (i na telefonu).
//
//   tools/e2e/run-app.sh                      # aplikace proti lokálnímu stacku (port 3100)
//   node tools/e2e/tests/32-viewer3d.mjs
//   VIEWER_EXTRA_STEP=/cesta/sestava.stp …    # navíc velká sestava (strom dílů)
import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { BASE, USERS, launch, login, localEnv, sql, summary, test, expect, withContext, ARTIFACTS } from "../lib.mjs";

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), "../../..");
const FIX = path.join(ROOT, "src/lib/viewer3d/__fixtures__");
const PREFIX = "E2E-viewer-";
const lit = (v) => (v === null || v === undefined ? "null" : `'${String(v).replace(/'/g, "''")}'`);
const EXTRA = process.env.VIEWER_EXTRA_STEP; // volitelně velká sestava (např. CAx-IF as1-oc-214.stp)

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

async function minimalPdf() {
  const { PDFDocument, StandardFonts } = await import("pdf-lib");
  const doc = await PDFDocument.create();
  for (let i = 1; i <= 3; i++) {
    const page = doc.addPage([595, 842]);
    const font = await doc.embedFont(StandardFonts.Helvetica);
    page.drawText(`Vykres E2E strana ${i}`, { x: 60, y: 760, size: 28, font });
  }
  return Buffer.from(await doc.save());
}

/** 3D PDF: strana s 3D anotací a U3D proudem (testovací scéna z referenční knihovny U3D). */
async function pdfWithU3D() {
  const { PDFDocument, StandardFonts } = await import("pdf-lib");
  const doc = await PDFDocument.create();
  const page = doc.addPage([595, 842]);
  page.drawText("3D PDF E2E", { x: 60, y: 780, size: 24, font: await doc.embedFont(StandardFonts.Helvetica) });
  const u3d = fs.readFileSync(path.join(ROOT, "src/lib/viewer3d/formats/__fixtures__/u3d-surface.u3d"));
  const stream = doc.context.flateStream(u3d, { Type: "3D", Subtype: "U3D" });
  const streamRef = doc.context.register(stream);
  const annot = doc.context.register(doc.context.obj({ Type: "Annot", Subtype: "3D", Rect: [50, 100, 545, 740], "3DD": streamRef }));
  page.node.addAnnot(annot);
  return Buffer.from(await doc.save());
}

/** Sestava ze dvou kostek 20 mm vedle sebe (OBJ, dva objekty = dva díly). */
function twoCubesObj() {
  const cube = (name, ox, base) => {
    const v = [];
    for (const [x, y, z] of [[0, 0, 0], [20, 0, 0], [20, 20, 0], [0, 20, 0], [0, 0, 20], [20, 0, 20], [20, 20, 20], [0, 20, 20]]) v.push(`v ${x + ox} ${y} ${z}`);
    const f = [[1, 3, 2], [1, 4, 3], [5, 6, 7], [5, 7, 8], [1, 2, 6], [1, 6, 5], [2, 3, 7], [2, 7, 6], [3, 4, 8], [3, 8, 7], [4, 1, 5], [4, 5, 8]]
      .map((t) => `f ${t.map((i) => i + base).join(" ")}`);
    return [`o ${name}`, ...v, ...f].join("\n");
  };
  return `${cube("KostkaA", 0, 0)}\n${cube("KostkaB", 20, 8)}\n`;
}

async function setup() {
  cleanup();
  const adminId = sql(`select id from profiles where email = 'admin@local.test'`);
  const cust = sql(`insert into customers (name, country, owner_id, payment_terms_days) values (${lit(`${PREFIX}Zákazník`)}, 'CZ', ${lit(adminId)}, 14) returning id`).split("\n")[0];
  const job = sql(`insert into orders (number, title, customer_id, owner_id, created_by, status, source, inquiry_date)
    values (next_job_number(), ${lit(`${PREFIX}Zakázka`)}, ${lit(cust)}, ${lit(adminId)}, ${lit(adminId)}, 'poptavka'::job_stage, 'manual', app_today()) returning id`).split("\n")[0];
  const files = {};
  files.step = await upload(job, "KOSTKA-ZAOBLENA.step", fs.readFileSync(path.join(FIX, "rounded-cube.step")), "application/octet-stream", "model_3d");
  files.cone = await upload(job, "kuzel.STP", fs.readFileSync(path.join(FIX, "conical-surface.step")), "application/octet-stream", "model_3d");
  files.stl = await upload(job, "kostka.stl", fs.readFileSync(path.join(FIX, "cube-10mm.stl")), "model/stl", "model_3d");
  files.pdf = await upload(job, "vykres-E2E.pdf", await minimalPdf(), "application/pdf", "vykres");
  files.pair = await upload(job, "dve-kostky.obj", Buffer.from(twoCubesObj()), "text/plain", "model_3d");
  files.pdf3d = await upload(job, "plocha-3D.pdf", await pdfWithU3D(), "application/pdf", "model_3d");
  if (EXTRA && fs.existsSync(EXTRA)) files.asm = await upload(job, "SESTAVA.stp", fs.readFileSync(EXTRA), "application/octet-stream", "model_3d");
  return { job, files };
}

function cleanup() {
  const jobIds = sql(`select id from orders where title like ${lit(`${PREFIX}%`)}`).split("\n").filter(Boolean);
  for (const id of jobIds) {
    sql(`delete from job_files where job_id = ${lit(id)}`);
    sql(`delete from orders where id = ${lit(id)}`);
  }
  sql(`delete from customers where name like ${lit(`${PREFIX}%`)} and not exists (select 1 from orders o where o.customer_id = customers.id)`);
}

async function waitModel(page) {
  await page.getByTestId("viewer3d-status").waitFor({ timeout: 60_000 });
}

async function canvasBox(page) {
  return page.getByTestId("viewer3d-canvas").boundingBox();
}

const { job, files } = await setup();
if (process.env.VIEWER_SEED_ONLY) {
  // jen připravit data (ladění): vypíše id zakázky a souborů
  console.log(JSON.stringify({ job, files }));
  process.exit(0);
}
const browser = await launch();
const errors = [];

await test("desktop: Dokumenty → klik na STEP otevře 3D prohlížeč, Zpět vrátí na stejné místo", async () => {
  await withContext(browser, errors, async (ctx) => {
    const page = await ctx.newPage();
    await login(page, USERS.admin);
    await page.goto(`${BASE}/documents`);
    const link = page.getByRole("link", { name: "Otevřít KOSTKA-ZAOBLENA.step" }).first();
    await link.waitFor();
    // posunout stránku, ať jde ověřit návrat na stejné místo
    await page.evaluate(() => document.querySelector("main")?.scrollTo(0, 200));
    const scrollBefore = await page.evaluate(() => document.querySelector("main")?.scrollTop ?? 0);
    const urlBefore = page.url();
    await link.click();
    await page.getByTestId("file-viewer").waitFor();
    await waitModel(page);
    const status = await page.getByTestId("viewer3d-status").innerText();
    expect(/×/.test(status) && /mm/.test(status), `stavový řádek s rozměry: ${status}`);
    expect(/STEP/.test(status), `formát STEP ve stavu: ${status}`);
    await page.waitForTimeout(400);
    await page.screenshot({ path: path.join(ARTIFACTS, "viewer3d-desktop-step.png") });

    // ovládání: kolečko, otáčení prostředním tlačítkem, posun pravým
    const box = await canvasBox(page);
    const cx = box.x + box.width / 2;
    const cy = box.y + box.height / 2;
    await page.mouse.move(cx, cy);
    await page.mouse.wheel(0, -400);
    await page.mouse.down({ button: "middle" });
    await page.mouse.move(cx + 120, cy + 40, { steps: 6 });
    await page.mouse.up({ button: "middle" });
    await page.mouse.down({ button: "right" });
    await page.mouse.move(cx + 40, cy + 10, { steps: 4 });
    await page.mouse.up({ button: "right" });
    await page.keyboard.press("f");
    await page.waitForTimeout(450);

    // výběr dílu → karta dílu, Del smaže, Ctrl+Z vrátí, Ctrl+Y znovu smaže
    await page.mouse.click(cx, cy);
    await page.getByTestId("viewer3d-part").waitFor({ timeout: 5000 });
    const card = await page.getByTestId("viewer3d-part").innerText();
    expect(/Rozměr/.test(card) && /Objem/.test(card), `karta dílu: ${card}`);
    await page.keyboard.press("Delete");
    await page.waitForFunction(() => /skryto/.test(document.querySelector('[data-testid="viewer3d-status"]')?.textContent ?? ""));
    await page.keyboard.press("Control+z");
    await page.waitForFunction(() => !/skryto/.test(document.querySelector('[data-testid="viewer3d-status"]')?.textContent ?? ""));
    await page.getByTestId("tool-redo").click();
    await page.waitForFunction(() => /skryto/.test(document.querySelector('[data-testid="viewer3d-status"]')?.textContent ?? ""));
    await page.getByTestId("tool-showall").click();
    await page.waitForFunction(() => !/skryto/.test(document.querySelector('[data-testid="viewer3d-status"]')?.textContent ?? ""));

    // měření vzdálenosti: dva kliky s uchopením
    await page.getByTestId("tool-distance").click();
    await page.getByTestId("measure-hint").waitFor();
    await page.keyboard.press("5"); // pohled shora
    await page.waitForTimeout(450);
    const b2 = await canvasBox(page);
    await page.mouse.move(b2.x + b2.width / 2 - 30, b2.y + b2.height / 2 - 10, { steps: 3 });
    await page.waitForTimeout(150);
    await page.mouse.click(b2.x + b2.width / 2 - 30, b2.y + b2.height / 2 - 10);
    await page.mouse.move(b2.x + b2.width / 2 + 40, b2.y + b2.height / 2 + 20, { steps: 3 });
    await page.waitForTimeout(150);
    await page.mouse.click(b2.x + b2.width / 2 + 40, b2.y + b2.height / 2 + 20);
    await page.getByTestId("measure-item").first().waitFor({ timeout: 5000 });
    const meas = await page.getByTestId("measure-item").first().innerText();
    expect(/mm/.test(meas) && /ΔX/.test(meas), `výsledek měření: ${meas}`);
    await page.screenshot({ path: path.join(ARTIFACTS, "viewer3d-desktop-measure.png") });
    // Ctrl+Z vrátí i měření
    await page.keyboard.press("Control+z");
    await page.waitForFunction(() => document.querySelectorAll('[data-testid="measure-item"]').length === 0);

    // Esc: nejdřív ukončí měření, prohlížeč zůstane otevřený
    await page.keyboard.press("Escape");
    expect(await page.getByTestId("file-viewer").isVisible(), "Esc nejdřív ukončí měření");

    // Zpět → zpátky v Dokumentech na stejném místě
    await page.getByTestId("viewer-back").click();
    await page.getByTestId("file-viewer").waitFor({ state: "detached" });
    expect(page.url() === urlBefore, `URL po návratu ${page.url()} = ${urlBefore}`);
    const scrollAfter = await page.evaluate(() => document.querySelector("main")?.scrollTop ?? 0);
    expect(Math.abs(scrollAfter - scrollBefore) < 5, `posun stránky zachován (${scrollBefore} → ${scrollAfter})`);
  });
});

await test("desktop: PDF v aplikaci, prohlížečové zpět ho zavře", async () => {
  await withContext(browser, errors, async (ctx) => {
    const page = await ctx.newPage();
    await login(page, USERS.admin);
    await page.goto(`${BASE}/orders/${job}?tab=dokumenty`);
    const link = page.getByRole("link", { name: /vykres-E2E\.pdf/ }).first();
    await link.waitFor();
    const url = page.url();
    await link.click();
    await page.getByTestId("pdf-view").waitFor();
    await page.locator('[data-page="1"] canvas').waitFor();
    await page.waitForFunction(() => {
      const c = document.querySelector('[data-page="1"] canvas');
      return c && c.width > 100;
    }, null, { timeout: 20_000 });
    await page.screenshot({ path: path.join(ARTIFACTS, "viewer-pdf-desktop.png") });
    await page.goBack();
    await page.getByTestId("file-viewer").waitFor({ state: "detached" });
    expect(page.url() === url, "po zpět stále na kartě zakázky");
  });
});

await test("desktop: STL a kužel (kružnice → průměr)", async () => {
  await withContext(browser, errors, async (ctx) => {
    const page = await ctx.newPage();
    await login(page, USERS.admin);
    await page.goto(`${BASE}/documents`);
    await page.getByRole("link", { name: "Otevřít kostka.stl" }).first().click();
    await waitModel(page);
    const st = await page.getByTestId("viewer3d-status").innerText();
    expect(/10,00 × 10,00 × 10,00 mm/.test(st), `STL kostka 10 mm: ${st}`);
    await page.getByTestId("viewer-back").click();
    await page.getByTestId("file-viewer").waitFor({ state: "detached" });

    await page.getByRole("link", { name: "Otevřít kuzel.STP" }).first().click();
    await waitModel(page);
    await page.getByTestId("tool-diameter").click();
    await page.keyboard.press("1"); // zepředu
    await page.waitForTimeout(500);
    // projet řádek pixelů a kliknout tam, kde se ukáže uchopení kružnice / válce
    const b = await canvasBox(page);
    let done = false;
    for (let dy = -120; dy <= 120 && !done; dy += 12) {
      for (let dx = -200; dx <= 200 && !done; dx += 16) {
        await page.mouse.move(b.x + b.width / 2 + dx, b.y + b.height / 2 + dy);
        await page.waitForTimeout(30);
        if (await page.getByTestId("snap-marker").count()) {
          await page.mouse.click(b.x + b.width / 2 + dx, b.y + b.height / 2 + dy);
          done = true;
        }
      }
    }
    expect(done, "našlo se místo k uchopení pro průměr");
    await page.getByTestId("measure-item").first().waitFor({ timeout: 5000 });
    const txt = await page.getByTestId("measure-item").first().innerText();
    expect(/Ø|R /.test(txt), `průměr / poloměr: ${txt}`);
    await page.screenshot({ path: path.join(ARTIFACTS, "viewer3d-diameter.png") });
  });
});

await test("desktop: 3D PDF (U3D) — 3D model i stránky PDF", async () => {
  await withContext(browser, errors, async (ctx) => {
    const page = await ctx.newPage();
    await login(page, USERS.admin);
    await page.goto(`${BASE}/documents`);
    await page.getByRole("link", { name: "Otevřít plocha-3D.pdf" }).first().click();
    await waitModel(page);
    const st = await page.getByTestId("viewer3d-status").innerText();
    expect(/3D PDF/.test(st) && /mm/.test(st), `3D PDF ve stavu: ${st}`);
    await page.waitForTimeout(400);
    await page.screenshot({ path: path.join(ARTIFACTS, "viewer3d-pdf3d.png") });
    await page.getByRole("tab", { name: /Stránky/ }).click();
    await page.getByTestId("pdf-view").waitFor();
    await page.getByRole("tab", { name: /3D/ }).click();
    await page.getByTestId("viewer3d-status").waitFor();
    await page.getByTestId("viewer-back").click();
    await page.getByTestId("file-viewer").waitFor({ state: "detached" });
  });
});

await test("desktop: výběrový filtr (plocha, hrana), řez rovinou i z plochy, měření na řezu", async () => {
  await withContext(browser, errors, async (ctx) => {
    const page = await ctx.newPage();
    await login(page, USERS.admin);
    await page.goto(`${BASE}/view?src=${encodeURIComponent(`/api/jobs/files/${files.cone}`)}&name=kuzel.STP`);
    await waitModel(page);
    const box = await canvasBox(page);
    const cx = box.x + box.width / 2;
    const cy = box.y + box.height / 2;

    // filtr Plocha → klik vybere plochu a ukáže kartu (typ, plocha, souřadnice)
    await page.getByTestId("tool-filter").click();
    await page.getByTestId("filter-items").getByRole("radio", { name: /Plocha/ }).click();
    await page.getByTestId("filter-badge").waitFor();
    let face = "";
    for (let dy = -120; dy <= 120 && !face; dy += 24) {
      for (let dx = -160; dx <= 160 && !face; dx += 24) {
        await page.mouse.click(cx + dx, cy + dy);
        face = await page.getByTestId("viewer3d-entity").innerText({ timeout: 300 }).catch(() => "");
      }
    }
    expect(/plocha/i.test(face) && /X/.test(face), `karta plochy: ${face}`);

    // filtr Hrana (pravým tlačítkem) → projet a najít hranu
    await page.mouse.click(cx, cy, { button: "right" });
    await page.getByTestId("viewer3d-context").getByRole("button", { name: /^Hrana$/ }).click();
    let edgeText = "";
    for (let dx = -220; dx <= 220 && !edgeText; dx += 8) {
      await page.mouse.move(cx + dx, cy - 40);
      await page.waitForTimeout(20);
      if (await page.getByTestId("snap-marker").count()) {
        await page.mouse.click(cx + dx, cy - 40);
        edgeText = await page.getByTestId("viewer3d-entity").innerText().catch(() => "");
      }
    }
    expect(/Kružnice|Oblouk|Úsečka|Hrana/.test(edgeText), `karta hrany: ${edgeText}`);
    await page.screenshot({ path: path.join(ARTIFACTS, "viewer3d-filter-edge.png") });

    // řez rovinou XZ (zepředu) + posuvník
    await page.getByTestId("tool-section").click();
    await page.getByTestId("section-y").click();
    await page.getByTestId("section-slider").waitFor();
    await page.keyboard.press("0");
    await page.waitForTimeout(500);
    await page.screenshot({ path: path.join(ARTIFACTS, "viewer3d-section-xz.png") });
    const pos0 = await page.getByTestId("section-position").inputValue();
    await page.getByTestId("section-slider").focus();
    for (let i = 0; i < 40; i++) await page.keyboard.press("ArrowRight");
    const pos1 = await page.getByTestId("section-position").inputValue();
    expect(pos0 !== pos1, `posuvník posune řez (${pos0} → ${pos1})`);
    await page.getByTestId("section-flip").click();

    // měření na řezu: filtr Automaticky, pohled kolmo na řez, chytit střed kružnice v řezu
    await page.getByTestId("tool-filter").click();
    await page.getByTestId("filter-items").getByRole("radio", { name: /Automaticky/ }).click();
    await page.getByTestId("tool-distance").click();
    await page.getByTestId("section-y").click();
    await page.getByRole("button", { name: /Pohled kolmo/ }).click();
    await page.waitForTimeout(500);
    const kinds = new Set();
    const marker = page.getByTestId("snap-marker");
    for (let y = cy - 150; y <= cy + 150 && !(kinds.has("face") && kinds.size > 1); y += 30) {
      for (let x = cx - 200; x <= cx + 200; x += 25) {
        await page.mouse.move(x, y);
        await page.waitForTimeout(25);
        const k = (await marker.count()) ? await marker.getAttribute("data-kind", { timeout: 200 }).catch(() => null) : null;
        if (k) kinds.add(k);
        if (kinds.has("face") && kinds.size > 1) break;
      }
    }
    expect(kinds.has("face") && (kinds.has("vertex") || kinds.has("edge") || kinds.has("center")), `uchopení na řezu: ${[...kinds].join(", ")}`);
    await page.screenshot({ path: path.join(ARTIFACTS, "viewer3d-section-measure.png") });
    await page.getByTestId("section-off").click();
    await page.getByTestId("section-slider").waitFor({ state: "detached" });

    // řez z plochy (filtr Plocha → karta → „Řez touto plochou")
    await page.getByTestId("tool-select").click();
    await page.keyboard.press("0");
    await page.waitForTimeout(450);
    await page.getByTestId("tool-filter").click();
    await page.getByTestId("filter-items").getByRole("radio", { name: /Plocha/ }).click();
    let done = false;
    for (let dy = -160; dy <= 160 && !done; dy += 20) {
      for (let dx = -200; dx <= 200 && !done; dx += 20) {
        await page.mouse.click(cx + dx, cy + dy);
        if (await page.getByTestId("entity-section").count()) {
          await page.getByTestId("entity-section").click();
          done = true;
        }
      }
    }
    expect(done, "rovinná plocha → řez touto plochou");
    await page.getByTestId("section-slider").waitFor();
    expect(/Rovina plochy/.test(await page.getByTestId("section-panel").innerText()), "řez z plochy");
    await page.waitForTimeout(300);
    await page.screenshot({ path: path.join(ARTIFACTS, "viewer3d-section-face.png") });
  });
});

await test("desktop: barvy dílu a plochy (pravé tlačítko bez nabídky prohlížeče), zpět vrátí barvu", async () => {
  await withContext(browser, errors, async (ctx) => {
    const page = await ctx.newPage();
    await login(page, USERS.admin);
    await page.goto(`${BASE}/view?src=${encodeURIComponent(`/api/jobs/files/${files.step}`)}&name=KOSTKA.step`);
    await waitModel(page);
    const box = await canvasBox(page);
    const cx = box.x + box.width / 2;
    const cy = box.y + box.height / 2;
    // pravé tlačítko na díl → naše nabídka; nativní nabídka (contextmenu) je potlačená i nad ní
    await page.mouse.click(cx, cy, { button: "right" });
    await page.getByTestId("viewer3d-context").waitFor();
    const prevented = await page.evaluate(([x, y]) => {
      const el = document.elementFromPoint(x, y);
      const ev = new MouseEvent("contextmenu", { bubbles: true, cancelable: true, clientX: x, clientY: y });
      el.dispatchEvent(ev);
      return ev.defaultPrevented;
    }, [cx + 5, cy + 5]);
    expect(prevented, "nativní nabídka prohlížeče se nad prohlížečem 3D neotevře");
    await page.getByTestId("context-colors").getByRole("button", { name: "Barva #c0504d" }).first().click();
    await page.getByTestId("viewer3d-context").waitFor({ state: "detached" });
    // barva dílu: karta dílu ukáže vybranou barvu, Ctrl+Z ji vrátí
    await page.mouse.click(cx, cy);
    await page.getByTestId("viewer3d-part").waitFor();
    const ring = async (hex) => /ring-2/.test((await page.getByTestId("part-colors").getByRole("button", { name: `Barva ${hex}` }).getAttribute("class")) ?? "");
    expect(await ring("#c0504d"), "díl má zvolenou barvu");
    await page.screenshot({ path: path.join(ARTIFACTS, "viewer3d-color-part.png") });
    await page.getByTestId("part-colors").getByRole("button", { name: "Barva #9bbb59" }).click();
    expect(await ring("#9bbb59"), "nová barva z karty dílu");
    await page.keyboard.press("Control+z");
    expect(await ring("#c0504d"), "Ctrl+Z vrátí předchozí barvu");
    // odlišit plochy barevně
    await page.getByTestId("viewer3d-part").getByRole("button", { name: /Odlišit plochy/ }).click();
    await page.keyboard.press("Escape");
    await page.waitForTimeout(300);
    await page.screenshot({ path: path.join(ARTIFACTS, "viewer3d-color-faces.png") });
    // barva jedné plochy (filtr Plocha → karta plochy)
    await page.getByTestId("tool-filter").click();
    await page.getByTestId("filter-items").getByRole("radio", { name: /Plocha/ }).click();
    await page.mouse.click(cx, cy);
    await page.getByTestId("face-colors").waitFor();
    await page.getByTestId("face-colors").getByRole("button", { name: "Barva #f2c314" }).click();
    // pozadí
    await page.getByTestId("tool-display").click();
    await page.getByRole("button", { name: "Pozadí Tmavé" }).click();
    expect(/from-\[#3b4250\]/.test((await page.getByTestId("viewer3d-root").getAttribute("class")) ?? ""), "tmavé pozadí");
    await page.getByRole("button", { name: /Původní barvy/ }).click();
    await page.screenshot({ path: path.join(ARTIFACTS, "viewer3d-color-reset.png") });
  });
});

await test("desktop: materiál → hmotnost dílu a polotovaru (kulatina u rotačního dílu), přídavek, polotovar v 3D", async () => {
  await withContext(browser, errors, async (ctx) => {
    const page = await ctx.newPage();
    await login(page, USERS.admin);
    await page.goto(`${BASE}/view?src=${encodeURIComponent(`/api/jobs/files/${files.cone}`)}&name=kuzel.STP`);
    await waitModel(page);
    await page.getByTestId("tool-mass").click();
    const panel = page.getByTestId("mass-panel");
    await panel.waitFor();
    // rotační díl → kulatina
    const label = await page.getByTestId("mass-stock-label").innerText();
    expect(/^Kulatina ⌀\d+ × \d+ mm$/.test(label), `polotovar rotačního dílu: ${label}`);
    // ocel C45 → hliník: hmotnost klesne zhruba na třetinu
    await page.getByTestId("mass-material").selectOption("12050");
    const steel = await page.getByTestId("mass-part").innerText();
    await page.getByTestId("mass-material").selectOption("alu_6082");
    const alu = await page.getByTestId("mass-part").innerText();
    const kg = (t) => Number(t.replace(/[^\d,]/g, "").replace(",", "."));
    expect(kg(steel) > 0 && Math.abs(kg(alu) / kg(steel) - 2.7 / 7.85) < 0.05, `hliník vs ocel: ${alu} / ${steel}`);
    const stockAlu = kg(await page.getByTestId("mass-stock").innerText());
    expect(stockAlu > kg(alu), "polotovar je těžší než hotový díl");
    // vlastní přídavek změní rozměr polotovaru
    await page.getByTestId("mass-allowance").fill("20");
    const label2 = await page.getByTestId("mass-stock-label").innerText();
    expect(label2 !== label, `přídavek 20 mm: ${label} → ${label2}`);
    // přířez místo kulatiny
    await panel.getByRole("radio", { name: "Přířez" }).click();
    expect(/^Přířez /.test(await page.getByTestId("mass-stock-label").innerText()), "přířez");
    await page.waitForTimeout(300);
    await page.screenshot({ path: path.join(ARTIFACTS, "viewer3d-mass.png") });
    await page.getByTestId("mass-allowance").fill("");
    await panel.getByRole("radio", { name: "Auto" }).click();
    await page.waitForTimeout(300);
    await page.screenshot({ path: path.join(ARTIFACTS, "viewer3d-mass-round.png") });
  });
});

await test("desktop: rozebrání sestavy — Ctrl + tažení dílu, rozložení posuvníkem, zpět, složit", async () => {
  await withContext(browser, errors, async (ctx) => {
    const page = await ctx.newPage();
    await login(page, USERS.admin);
    await page.goto(`${BASE}/view?src=${encodeURIComponent(`/api/jobs/files/${files.pair}`)}&name=dve-kostky.obj`);
    await waitModel(page);
    const status = () => page.getByTestId("viewer3d-status").innerText();
    const size0 = (await status()).split("mm")[0];
    expect(/40,00 × 20,00 × 20,00/.test(size0) || /20,00 × 40,00/.test(size0) || /40,00/.test(size0), `sestava 40 × 20 × 20: ${size0}`);
    await page.keyboard.press("5"); // shora
    await page.waitForTimeout(500);
    const b = await canvasBox(page);
    // Ctrl + tažení levé kostky doleva
    const sx = b.x + b.width / 2 - 60;
    const sy = b.y + b.height / 2;
    await page.keyboard.down("Control");
    await page.mouse.move(sx, sy);
    await page.mouse.down();
    await page.mouse.move(sx - 80, sy, { steps: 6 });
    await page.mouse.move(sx - 160, sy, { steps: 6 });
    await page.mouse.up();
    await page.keyboard.up("Control");
    await page.waitForTimeout(200);
    const size1 = (await status()).split("mm")[0];
    expect(size1 !== size0, `po přesunu dílu je sestava větší (${size0} → ${size1})`);
    await page.screenshot({ path: path.join(ARTIFACTS, "viewer3d-move-part.png") });
    // Ctrl+Z vrátí
    await page.keyboard.press("Control+z");
    await page.waitForTimeout(150);
    expect((await status()).split("mm")[0] === size0, "Ctrl+Z vrátí díl");
    // rozložení posuvníkem
    await page.getByTestId("tool-explode").click();
    await page.getByTestId("explode-panel").waitFor();
    const slider = page.getByTestId("explode-slider");
    await slider.focus();
    for (let i = 0; i < 60; i++) await page.keyboard.press("ArrowRight");
    await page.waitForTimeout(150);
    const size2 = (await status()).split("mm")[0];
    expect(size2 !== size0, `rozložená sestava (${size0} → ${size2})`);
    await page.keyboard.press("0");
    await page.waitForTimeout(400);
    await page.screenshot({ path: path.join(ARTIFACTS, "viewer3d-explode.png") });
    // táhnutí bez Ctrl v režimu Táhnout díly
    await page.getByTestId("explode-move-tool").click();
    expect(/zapnuto/.test(await page.getByTestId("explode-move-tool").innerText()), "režim táhnutí");
    await page.getByTestId("explode-reset").click();
    await page.waitForTimeout(150);
    expect((await status()).split("mm")[0] === size0, "Složit zpět");
  });
});

if (files.asm) {
  await test("desktop: sestava — strom dílů, izolace, skrytí v stromu", async () => {
    await withContext(browser, errors, async (ctx) => {
      const page = await ctx.newPage();
      await login(page, USERS.admin);
      await page.goto(`${BASE}/documents`);
      await page.getByRole("link", { name: "Otevřít SESTAVA.stp" }).first().click();
      await waitModel(page);
      const tree = page.getByTestId("viewer3d-tree");
      if (!(await tree.count())) await page.getByTestId("tool-tree").click();
      await tree.waitFor();
      await tree.getByRole("button", { name: "Skrýt díl" }).first().click();
      await page.waitForFunction(() => /skryto/.test(document.querySelector('[data-testid="viewer3d-status"]')?.textContent ?? ""));
      await page.screenshot({ path: path.join(ARTIFACTS, "viewer3d-assembly.png") });
      await page.getByTestId("tool-showall").click();
      await page.waitForFunction(() => !/skryto/.test(document.querySelector('[data-testid="viewer3d-status"]')?.textContent ?? ""));
      // výchozí klik vybere jen jeden díl (ne celou podsestavu)
      {
        const bb = await canvasBox(page);
        let card = "";
        for (let dx = -60; dx <= 60 && !card; dx += 20) {
          await page.mouse.click(bb.x + bb.width / 2 + dx, bb.y + bb.height / 2);
          card = await page.getByTestId("viewer3d-part").innerText({ timeout: 400 }).catch(() => "");
        }
        expect(card && !/Vybráno dílů/.test(card) && /Rozměr/.test(card), `klik = jeden díl: ${card.slice(0, 60)}`);
        await page.keyboard.press("Escape");
      }
      // filtr Sestava: klik na díl vybere celou podsestavu, Delete ji smaže, Ctrl+Z vrátí
      await page.getByTestId("tool-filter").click();
      await page.getByTestId("filter-items").getByRole("radio", { name: /Sestava/ }).click();
      const b = await canvasBox(page);
      let hidden = 0;
      for (let dx = -60; dx <= 60 && !hidden; dx += 20) {
        await page.mouse.click(b.x + b.width / 2 + dx, b.y + b.height / 2);
        if (await page.getByTestId("viewer3d-part").count()) {
          await page.keyboard.press("Delete");
          const st = await page.getByTestId("viewer3d-status").innerText();
          hidden = Number(/\((\d+) skryto\)/.exec(st)?.[1] ?? 0);
        }
      }
      expect(hidden > 1, `Delete se sestavou smaže víc dílů najednou (${hidden})`);
      await page.keyboard.press("Control+z");
      await page.waitForFunction(() => !/skryto/.test(document.querySelector('[data-testid="viewer3d-status"]')?.textContent ?? ""));
    });
  });
}

await test("telefon: 3D model a PDF — lišta dole, systémové zpět zavře prohlížeč", async () => {
  await withContext(browser, errors, async (ctx) => {
    const page = await ctx.newPage();
    await login(page, USERS.admin);
    await page.goto(`${BASE}/documents`);
    const link = page.getByRole("link", { name: "Otevřít KOSTKA-ZAOBLENA.step" }).first();
    await link.waitFor();
    await link.tap();
    await waitModel(page);
    await page.waitForTimeout(400);
    // ťuknutí na díl = výběr
    const b = await canvasBox(page);
    await page.touchscreen.tap(b.x + b.width / 2, b.y + b.height / 2 - 60);
    await page.waitForTimeout(300);
    await page.screenshot({ path: path.join(ARTIFACTS, "viewer3d-mobile.png") });
    const bar = await page.getByRole("toolbar", { name: "Nástroje 3D prohlížeče" }).boundingBox();
    expect(bar && bar.y > 844 / 2, "lišta nástrojů na telefonu dole");
    await page.goBack();
    await page.getByTestId("file-viewer").waitFor({ state: "detached" });
    expect(new URL(page.url()).pathname === "/documents", "po systémovém zpět jsme v Dokumentech");

    await page.getByRole("link", { name: "Otevřít vykres-E2E.pdf" }).first().tap();
    await page.getByTestId("pdf-view").waitFor();
    await page.waitForTimeout(800);
    await page.screenshot({ path: path.join(ARTIFACTS, "viewer-pdf-mobile.png") });
    await page.getByTestId("viewer-back").tap();
    await page.getByTestId("file-viewer").waitFor({ state: "detached" });
  }, { mobile: true });
});

await test("samostatná stránka /view (nové okno) a neplatný zdroj", async () => {
  await withContext(browser, errors, async (ctx) => {
    const page = await ctx.newPage();
    await login(page, USERS.admin);
    await page.goto(`${BASE}/view?src=${encodeURIComponent(`/api/jobs/files/${files.step}`)}&name=KOSTKA-ZAOBLENA.step`);
    await waitModel(page);
    await page.goto(`${BASE}/view?src=${encodeURIComponent("https://example.com/x.pdf")}`);
    await page.getByText("Neplatný odkaz na dokument.").waitFor();
  });
});

await browser.close();
cleanup();
summary(errors);
