// E2E 38 · Tisk dokumentů přímo ze systému (majitel 31. 10.: „musí jít snadno vytisknout z mobilu i z počítače —
// vyberu tiskárnu a vytisknu"). Tlačítko „Tisknout" u dokumentů → tisková stránka /print (PDF po stranách jako
// obrázky přes pdf.js, obrázky přímo) → window.print() (v testu zachycené). Počítač: skrytý rám bez opuštění
// stránky; telefon (iPhone UA, 390 px): přechod na tiskovou stránku s „Tisknout" a „Zpět".
// Pokrývá: nabídku (PDF z /api/pdf/job), dodací list, fakturu, nahraný obrázek a PDF v Dokumentech, 10stránkové
// PDF, A3 na šířku, DXF (vypnuté s nápovědou), prohlížeč souborů (tlačítko + Ctrl+P), 3D „Tisknout pohled",
// Archiv výkresů (soubor zakázky i výkres jen v archivu), přílohu e-mailu, anonymní kopii pro dodavatele (route),
// tiskové médium bez lišt aplikace (emulateMedia + skutečné PDF tisku Chromia: počet a orientace stran).
//
//   E2E_BASE_URL=http://localhost:3500 PRINT_SHOTS=<adresář> node tools/e2e/tests/38-print.mjs
// Vlastní data „E2E-38-" (zákazník, zakázka, výkresy, e-mail), na konci se uklidí.
import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { BASE, USERS, launch, login, localEnv, sql, summary, test, expect, ARTIFACTS } from "../lib.mjs";
import { lit, userIds, eventually, waitHydrated, expectNoOverflow, createCustomer, createJob, createQuote } from "../lib-quotes-docs-flow.mjs";

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), "../../..");
const P = "E2E-38-";
const TAG = Date.now().toString(36).toUpperCase();
const ID = userIds();
const SHOTS = process.env.PRINT_SHOTS || path.join(ARTIFACTS, "print");
fs.mkdirSync(SHOTS, { recursive: true });
const browser = await launch();
const errors = [];
const IPHONE_UA = "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1";

console.log(`38 · Tisk dokumentů (značka ${TAG})`);

// ── data ────────────────────────────────────────────────
async function cleanup() {
  const jobs = sql(`select id from orders where title like ${lit(`${P}%`)}`).split("\n").filter(Boolean);
  const env = localEnv();
  const del = async (bucket, paths) => {
    if (!paths.length) return;
    await fetch(`${env.NEXT_PUBLIC_SUPABASE_URL}/storage/v1/object/${bucket}`, {
      method: "DELETE", headers: { apikey: env.SUPABASE_SECRET_KEY, authorization: `Bearer ${env.SUPABASE_SECRET_KEY}`, "content-type": "application/json" },
      body: JSON.stringify({ prefixes: paths }),
    }).catch(() => {});
  };
  if (jobs.length) {
    const inList = jobs.map(lit).join(",");
    await del("job-files", sql(`select storage_path from job_files where job_id in (${inList})`).split("\n").filter(Boolean));
    sql(`delete from drawings where job_id in (${inList})`);
    sql(`update job_files set replaced_by = null where job_id in (${inList})`);
    sql(`delete from quotes where job_id in (${inList})`);
    sql(`delete from orders where id in (${inList})`);
  }
  await del("documents", sql(`select storage_path from drawings where drawing_number like ${lit(`${P}%`)} and storage_path is not null`).split("\n").filter(Boolean));
  sql(`delete from drawings where drawing_number like ${lit(`${P}%`)}`);
  await del("documents", sql(`select a.storage_path from email_attachments a join emails e on e.id = a.email_id where e.subject like ${lit(`${P}%`)}`).split("\n").filter(Boolean));
  sql(`delete from emails where subject like ${lit(`${P}%`)}`);
  sql(`delete from customers where name like ${lit(`${P}%`)} and not exists (select 1 from orders o where o.customer_id = customers.id)`);
  return jobs.length;
}

async function put(bucket, storagePath, bytes, mime) {
  const env = localEnv();
  const r = await fetch(`${env.NEXT_PUBLIC_SUPABASE_URL}/storage/v1/object/${bucket}/${storagePath}`, {
    method: "POST",
    headers: { apikey: env.SUPABASE_SECRET_KEY, authorization: `Bearer ${env.SUPABASE_SECRET_KEY}`, "content-type": mime, "x-upsert": "true" },
    body: bytes,
  });
  if (!r.ok) throw new Error(`upload ${storagePath}: ${r.status} ${await r.text()}`);
}

async function upload(jobId, filename, bytes, mime, kind) {
  const storagePath = `${jobId}/${randomUUID()}-${filename.replace(/[^\w.-]+/g, "_")}`;
  await put("job-files", storagePath, bytes, mime);
  return sql(`insert into job_files (job_id, kind, filename, mime_type, size_bytes, storage_path, version, archived, uploaded_by, anon_status)
    values (${lit(jobId)}, ${lit(kind)}::job_file_kind, ${lit(filename)}, ${lit(mime)}, ${bytes.length}, ${lit(storagePath)}, 1, false, ${lit(ID.admin)}, 'skipped') returning id`).split("\n")[0];
}

async function pdf(pages, { size = [595, 842], label = "Strana" } = {}) {
  const { PDFDocument, StandardFonts, rgb } = await import("pdf-lib");
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  for (let i = 1; i <= pages; i++) {
    const page = doc.addPage(size);
    page.drawRectangle({ x: 20, y: 20, width: size[0] - 40, height: size[1] - 40, borderColor: rgb(0.88, 0.22, 0.19), borderWidth: 2 });
    // standardní písmo PDF umí jen WinAnsi → bez diakritiky
    page.drawText(`${label.normalize("NFD").replace(/[̀-ͯ]/g, "")} ${i} / ${pages}`, { x: 60, y: size[1] - 90, size: 30, font });
  }
  return Buffer.from(await doc.save());
}

async function png(width, height, text) {
  const sharp = (await import("sharp")).default;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}"><rect width="100%" height="100%" fill="#fff"/><rect x="10" y="10" width="${width - 20}" height="${height - 20}" fill="none" stroke="#E03930" stroke-width="8"/><text x="60" y="160" font-size="90" font-family="sans-serif">${text}</text></svg>`;
  return sharp(Buffer.from(svg)).png().toBuffer();
}

const left = await cleanup();
if (left) console.log(`  (úklid po minulém běhu: ${left} zakázek)`);

const cust = createCustomer({ name: `${P}Kovo ${TAG} s.r.o.`, email: `e2e38-${TAG.toLowerCase()}@local.test`, ownerId: ID.admin });
const JOB = createJob({
  title: `${P}Tisk ${TAG}`, status: "ve_vyrobe", customerId: cust.id, ownerId: ID.admin, cpo: `PO-${TAG}`,
  items: [{ drawing: `VK-${TAG}-1`, name: "Příruba", qty: 10, price: 250 }, { drawing: `VK-${TAG}-2`, name: "Hřídel", qty: 4, price: 990 }],
});
const QUOTE = createQuote(JOB, {
  number: `NAB-E2E38-${TAG}`, status: "odeslano", sent: true, approvedBy: ID.admin, createdBy: ID.admin, customerId: cust.id,
  items: [{ drawing: `VK-${TAG}-1`, name: "Příruba", qty: 10, price: 250 }],
});

const F = {}; // id souborů zakázky
const NAMES = {
  dl: `Dodaci_list_DL-E2E38-${TAG}.pdf`, inv: `Faktura_FV-E2E38-${TAG}.pdf`, img: `foto-dilu-${TAG}.png`, pdf10: `vykres-10-stran-${TAG}.pdf`,
  a3: `vykres-A3-${TAG}.pdf`, dxf: `vykres-${TAG}.dxf`, stl: `kostka-${TAG}.stl`, order: `objednavka-zakaznika-${TAG}.pdf`,
};

// ── zachycení tisku: window.print v každém rámu zapíše stav stran do top.__printLog ──
async function stubPrint(context) {
  await context.addInitScript(() => {
    window.print = function () {
      const imgs = [...document.querySelectorAll("#mn-print-out img")];
      const rec = {
        url: location.pathname + location.search, frame: window !== window.top, mode: document.documentElement.getAttribute("data-mn-print"),
        imgs: imgs.length, sizes: imgs.map((i) => [i.naturalWidth, i.naturalHeight]), complete: imgs.every((i) => i.complete && i.naturalWidth > 0),
        orient: imgs.map((i) => i.parentElement?.getAttribute("data-orient")), style: document.getElementById("mn-print-page-style")?.textContent ?? "",
        text: Boolean(document.querySelector("#mn-print-out .mn-print-text")),
      };
      try {
        (window.top.__printLog ||= []).push(rec);
      } catch {
        (window.__printLog ||= []).push(rec);
      }
    };
  });
}

async function desktop(fn) {
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, locale: "cs-CZ" });
  watch(context);
  await stubPrint(context);
  try {
    const page = await context.newPage();
    await login(page, USERS.admin);
    await fn(page, context);
  } finally {
    await context.close();
  }
}

async function iphone(fn) {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, userAgent: IPHONE_UA, locale: "cs-CZ" });
  watch(context);
  await stubPrint(context);
  try {
    const page = await context.newPage();
    await login(page, USERS.admin);
    await fn(page, context);
  } finally {
    await context.close();
  }
}

function watch(context) {
  context.on("page", (p) => {
    p.on("pageerror", (e) => errors.push(`pageerror ${p.url()}: ${e.message}`));
    p.on("response", (r) => { if (r.status() >= 500) errors.push(`HTTP ${r.status()} ${r.url()}`); });
  });
}

const log = (page) => page.evaluate(() => window.__printLog ?? []);
async function waitPrints(page, n, timeout = 45_000) {
  await page.waitForFunction((k) => (window.__printLog ?? []).length >= k, n, { timeout });
  return log(page);
}

async function openDocs(page) {
  await page.goto(`${BASE}/orders/${JOB.id}?tab=dokumenty`);
  await waitHydrated(page, "main button");
  await page.locator("main li").filter({ hasText: NAMES.pdf10 }).first().waitFor({ timeout: 30_000 });
}
const row = (page, name) => page.locator("main li").filter({ hasText: name }).first();
const shot = async (page, name, full = false) => {
  await page.waitForTimeout(400); // náběhová animace stránky
  await page.screenshot({ path: path.join(SHOTS, `${name}.png`), fullPage: full });
};

/** Klik na „Tisknout" na počítači → skrytý rám s tiskovou stránkou → zachycený tisk. */
async function printFromDesktop(page, button, expectSrc) {
  const before = (await log(page)).length;
  await button.click();
  const all = await waitPrints(page, before + 1);
  const rec = all[all.length - 1];
  expect(rec.frame === true && rec.mode === "embed", `tisk ze skrytého rámu (${JSON.stringify({ frame: rec.frame, mode: rec.mode })})`);
  expect(rec.url.startsWith("/print?"), `rám = tisková stránka (${rec.url})`);
  if (expectSrc) expect(new URL(rec.url, BASE).searchParams.get("src")?.includes(expectSrc), `zdroj ${expectSrc} (${rec.url})`);
  expect(rec.complete, "všechny strany načtené před tiskem");
  // stránka aplikace zůstala (žádná navigace)
  expect(new URL(page.url()).pathname !== "/print", "aplikace zůstala na stránce");
  return rec;
}

// ═════════════ příprava souborů (PDF dokladů vykreslí server) ═════════════
await test("příprava: doklady z /api/pdf/job (DL, faktura), PDF 10 stran, A3 na šířku, fotka, DXF, STL, výkresy, e-mail", async () => {
  const context = await browser.newContext();
  const page = await context.newPage();
  await login(page, USERS.admin);
  const get = async (type) => {
    const r = await page.request.get(`${BASE}/api/pdf/job/${JOB.id}?type=${type}`);
    expect(r.ok(), `/api/pdf/job ${type} → ${r.status()}`);
    return Buffer.from(await r.body());
  };
  F.dl = await upload(JOB.id, NAMES.dl, await get("dodaci-list"), "application/pdf", "dodaci_list");
  F.inv = await upload(JOB.id, NAMES.inv, await get("faktura"), "application/pdf", "faktura");
  await context.close();
  F.order = await upload(JOB.id, NAMES.order, await pdf(2, { label: "Objednávka" }), "application/pdf", "objednavka");
  F.pdf10 = await upload(JOB.id, NAMES.pdf10, await pdf(10, { label: "Výkres" }), "application/pdf", "vykres");
  F.a3 = await upload(JOB.id, NAMES.a3, await pdf(1, { size: [1191, 842], label: "A3 na šířku" }), "application/pdf", "vykres");
  F.img = await upload(JOB.id, NAMES.img, await png(1600, 1000, "Fotka dílu"), "image/png", "foto");
  F.dxf = await upload(JOB.id, NAMES.dxf, Buffer.from("0\nSECTION\n2\nHEADER\n0\nENDSEC\n0\nEOF\n"), "application/dxf", "vykres");
  F.stl = await upload(JOB.id, NAMES.stl, fs.readFileSync(path.join(ROOT, "src/lib/viewer3d/__fixtures__/cube-10mm.stl")), "model/stl", "model_3d");
  // Archiv výkresů: výkres ze zakázky (soubor zakázky) a výkres jen v archivu (úložiště documents)
  sql(`insert into drawings (drawing_number, revision, customer_id, file_type, job_id, job_file_id, uploaded_by)
    values (${lit(`${P}JOB-${TAG}`)}, 'A', ${lit(cust.id)}, 'PDF', ${lit(JOB.id)}, ${lit(F.a3)}, ${lit(ID.admin)})`);
  const archPath = `drawings/e2e38-${TAG}-${randomUUID()}.pdf`;
  await put("documents", archPath, await pdf(2, { label: "Archiv" }), "application/pdf");
  sql(`insert into drawings (drawing_number, revision, customer_id, file_type, storage_path, storage_bucket, uploaded_by)
    values (${lit(`${P}ARCH-${TAG}`)}, 'B', ${lit(cust.id)}, 'PDF', ${lit(archPath)}, 'documents', ${lit(ID.admin)})`);
  sql(`insert into drawings (drawing_number, revision, customer_id, file_type, uploaded_by)
    values (${lit(`${P}DXF-${TAG}`)}, 'A', ${lit(cust.id)}, 'DXF', ${lit(ID.admin)})`);
  // test tisku — anonymizace výkresů se nespouští (jinak by fronta zpracovávala testovací výkres)
  sql(`update drawings set anon_status = 'skipped' where drawing_number like ${lit(`${P}%${TAG}`)}`);
  // příloha e-mailu (PDF + fotka) v úložišti documents
  const mail = sql(`insert into emails (owner_id, direction, subject, from_email, to_email, received_at, category, has_attachments)
    values (${lit(ID.admin)}, 'in', ${lit(`${P}Výkres ${TAG}`)}, 'eva@firma.test', 'admin@local.test', now(), 'poptavka', true) returning id`).split("\n")[0];
  const attPdf = `mail/e2e38-${TAG}-${randomUUID()}.pdf`;
  const attImg = `mail/e2e38-${TAG}-${randomUUID()}.png`;
  await put("documents", attPdf, await pdf(3, { label: "Příloha" }), "application/pdf");
  await put("documents", attImg, await png(1000, 1400, "Foto"), "image/png");
  F.attPdf = sql(`insert into email_attachments (email_id, filename, mime_type, size_bytes, storage_path) values (${lit(mail)}, 'vykres-z-mailu.pdf', 'application/pdf', 1000, ${lit(attPdf)}) returning id`).split("\n")[0];
  F.attImg = sql(`insert into email_attachments (email_id, filename, mime_type, size_bytes, storage_path) values (${lit(mail)}, 'foto-z-mailu.png', 'image/png', 1000, ${lit(attImg)}) returning id`).split("\n")[0];
});

// ═════════════ počítač ═════════════
await test("počítač · Dokumenty: Tisknout u každého dokumentu; PDF 10 stran → 10 obrázků A4 ~200 dpi, dialog tisku bez opuštění stránky", () => desktop(async (page) => {
  await openDocs(page);
  for (const n of [NAMES.dl, NAMES.inv, NAMES.img, NAMES.pdf10, NAMES.a3, NAMES.order]) {
    expect(await row(page, n).getByTestId("print-button").first().isVisible(), `Tisknout u ${n}`);
  }
  await row(page, NAMES.order).scrollIntoViewIfNeeded();
  await page.evaluate(() => document.querySelector("main")?.scrollBy(0, 200));
  await shot(page, "01-desktop-dokumenty");
  const rec = await printFromDesktop(page, row(page, NAMES.pdf10).getByTestId("print-button").first(), `/api/jobs/files/${F.pdf10}`);
  expect(rec.imgs === 10, `10 stran (${rec.imgs})`);
  expect(rec.sizes.every(([w, h]) => w >= 1600 && w <= 1700 && h >= 2280 && h <= 2400), `A4 ≈ 200 dpi (${JSON.stringify(rec.sizes[0])})`);
  expect(rec.orient.every((o) => o === "portrait") && /size:portrait/.test(rec.style), "na výšku");
  // rám po tisku zmizí
  await eventually(async () => expect((await page.locator('iframe[data-testid="print-frame"]').count()) === 0, "rám uklizen"), { timeout: 10_000 });
}));

await test("počítač · dodací list, faktura, objednávka zákazníka, fotka (na šířku) a A3 na šířku z Dokumentů", () => desktop(async (page) => {
  await openDocs(page);
  let rec = await printFromDesktop(page, row(page, NAMES.dl).getByTestId("print-button").first(), `/api/jobs/files/${F.dl}`);
  expect(rec.imgs >= 1 && rec.sizes[0][0] > 1500, `DL vykreslen (${JSON.stringify(rec.sizes)})`);
  rec = await printFromDesktop(page, row(page, NAMES.inv).getByTestId("print-button").first(), `/api/jobs/files/${F.inv}`);
  expect(rec.imgs >= 1, "faktura vykreslena");
  rec = await printFromDesktop(page, row(page, NAMES.order).getByTestId("print-button").first(), `/api/jobs/files/${F.order}`);
  expect(rec.imgs === 2, `objednávka zákazníka 2 strany (${rec.imgs})`);
  rec = await printFromDesktop(page, row(page, NAMES.img).getByTestId("print-button").first(), `/api/jobs/files/${F.img}`);
  expect(rec.imgs === 1 && rec.sizes[0][0] === 1600 && rec.sizes[0][1] === 1000, `fotka v plném rozlišení (${JSON.stringify(rec.sizes)})`);
  expect(rec.orient[0] === "landscape" && /size:landscape/.test(rec.style), `fotka na šířku (${rec.style})`);
  rec = await printFromDesktop(page, row(page, NAMES.a3).getByTestId("print-button").first(), `/api/jobs/files/${F.a3}`);
  expect(rec.orient[0] === "landscape" && /size:landscape/.test(rec.style), "A3 na šířku → papír na šířku");
  expect(rec.sizes[0][0] >= 3200 && rec.sizes[0][1] >= 2250, `A3 ≈ 200 dpi (${JSON.stringify(rec.sizes[0])})`);
  // DXF: vypnuté s nápovědou
  const dxf = row(page, NAMES.dxf).getByTestId("print-button").first();
  expect((await dxf.getAttribute("aria-disabled")) === "true", "DXF Tisknout vypnuté");
  expect(/DXF vytiskneš po uložení jako PDF/.test((await dxf.getAttribute("title")) ?? ""), "DXF nápověda");
  await dxf.scrollIntoViewIfNeeded();
  await shot(page, "01b-desktop-dxf");
  // aria-disabled: Playwright ho bere jako vypnuté → klepnutí vynutit (uživatel dostane nápovědu)
  await dxf.click({ force: true });
  await page.getByTestId("print-toast").filter({ hasText: "DXF vytiskneš po uložení jako PDF" }).waitFor({ timeout: 5_000 });
  // STL (3D model): v řádku vypnuté s odkazem na „Tisknout pohled"
  expect((await row(page, NAMES.stl).getByTestId("print-button").first().getAttribute("aria-disabled")) === "true", "STL Tisknout vypnuté");
}));

await test("počítač · nabídka: „Tisknout“ v záložce Nabídky tiskne PDF nabídky (/api/pdf/job)", () => desktop(async (page) => {
  await page.goto(`${BASE}/orders/${JOB.id}?tab=nabidky`);
  await waitHydrated(page, "main button");
  const btn = page.locator(`[data-testid="print-button"][data-print-href*="quoteId=${QUOTE.id}"]`).first();
  await btn.waitFor({ timeout: 30_000 });
  await btn.scrollIntoViewIfNeeded();
  await shot(page, "02-desktop-nabidky");
  const rec = await printFromDesktop(page, btn, `/api/pdf/job/${JOB.id}`);
  expect(rec.imgs >= 1 && rec.sizes[0][0] > 1500, `nabídka vykreslena (${JSON.stringify(rec.sizes)})`);
  // přehled Nabídky: „Tisknout" vedle „PDF"
  await page.goto(`${BASE}/quotes`);
  const board = page.locator(`[data-testid="print-button"][data-print-href*="quoteId=${QUOTE.id}"]`).first();
  await board.waitFor({ timeout: 30_000 });
  await waitHydrated(page, `[data-testid="print-button"][data-print-href*="quoteId=${QUOTE.id}"]`);
  await board.scrollIntoViewIfNeeded();
  await shot(page, "02b-desktop-prehled-nabidek");
  const r2 = await printFromDesktop(page, board, `quoteId=${QUOTE.id}`);
  expect(r2.imgs >= 1, "nabídka z přehledu Nabídky");
}));

await test("počítač · prohlížeč souborů: Tisknout v liště i Ctrl+P tisknou dokument (ne stránku aplikace)", () => desktop(async (page) => {
  await openDocs(page);
  await row(page, NAMES.order).getByRole("link", { name: NAMES.order }).first().click();
  const viewer = page.getByTestId("file-viewer");
  await viewer.waitFor({ timeout: 20_000 });
  await page.getByTestId("pdf-view").locator("canvas").first().waitFor({ timeout: 20_000 });
  await shot(page, "03-desktop-prohlizec");
  let before = (await log(page)).length;
  await page.getByTestId("viewer-print").click();
  let all = await waitPrints(page, before + 1);
  let rec = all.at(-1);
  expect(rec.frame === false && rec.mode === "hidden" && rec.imgs === 2 && rec.complete, `tlačítko v prohlížeči: 2 strany v aplikaci (${JSON.stringify(rec)})`);
  // Ctrl+P
  await page.waitForFunction(() => !document.getElementById("mn-print-out") || document.documentElement.getAttribute("data-mn-print") === "hidden", null, { timeout: 5_000 }).catch(() => {});
  before = (await log(page)).length;
  await page.keyboard.press("Control+p");
  all = await waitPrints(page, before + 1);
  rec = all.at(-1);
  expect(rec.imgs === 2 && rec.mode === "hidden", `Ctrl+P = dokument (${JSON.stringify({ imgs: rec.imgs, mode: rec.mode })})`);
  // tiskové médium v aplikaci: viditelné jen strany dokumentu
  const vis = await page.evaluate(() => {
    const out = document.getElementById("mn-print-out");
    return { out: Boolean(out), outImgs: out?.querySelectorAll("img").length ?? 0 };
  });
  expect(vis.out && vis.outImgs === 2, "strany v #mn-print-out");
  await page.emulateMedia({ media: "print" });
  const printVis = await page.evaluate(() => [...document.body.children].filter((el) => el.id !== "mn-print-out" && getComputedStyle(el).display !== "none").map((el) => el.tagName + "#" + el.id));
  await page.emulateMedia({ media: "screen" });
  expect(printVis.length === 0, `při tisku z aplikace nic kromě dokumentu (${printVis.join(", ")})`);
}));

await test("počítač · 3D model: „Tisknout pohled“ vytiskne snímek pohledu", () => desktop(async (page) => {
  await openDocs(page);
  await row(page, NAMES.stl).getByRole("link", { name: NAMES.stl }).first().click();
  const tool = page.getByTestId("tool-print");
  await tool.waitFor({ timeout: 60_000 });
  const before = (await log(page)).length;
  await tool.click();
  const all = await waitPrints(page, before + 1);
  const rec = all.at(-1);
  expect(rec.imgs === 1 && rec.complete && rec.sizes[0][0] > 200, `snímek pohledu (${JSON.stringify(rec.sizes)})`);
  await shot(page, "04-desktop-3d-tisk-pohledu");
}));

await test("počítač · Archiv výkresů: výkres ze zakázky i výkres jen v archivu; DXF vypnuté", () => desktop(async (page) => {
  await page.goto(`${BASE}/drawings?q=${encodeURIComponent(`${P}`)}`);
  const li = (n) => page.locator("main li").filter({ hasText: n }).first();
  await li(`${P}JOB-${TAG}`).waitFor({ timeout: 30_000 });
  await waitHydrated(page, '[data-testid="drawing-print"]');
  await shot(page, "05-desktop-archiv-vykresu");
  let rec = await printFromDesktop(page, li(`${P}JOB-${TAG}`).getByTestId("drawing-print"), `/api/jobs/files/${F.a3}`);
  expect(rec.imgs === 1 && rec.orient[0] === "landscape", "výkres ze zakázky (A3 na šířku)");
  rec = await printFromDesktop(page, li(`${P}ARCH-${TAG}`).getByTestId("drawing-print"), "/preview?table=drawings");
  expect(rec.imgs === 2, `výkres jen v archivu: 2 strany ze serverového náhledu (${rec.imgs})`);
  expect((await li(`${P}DXF-${TAG}`).getByTestId("drawing-print").getAttribute("aria-disabled")) === "true", "DXF výkres vypnuté");
}));

await test("počítač · tisková stránka: příloha e-mailu (PDF, fotka), faktura z /api/pdf; tiskové médium bez lišt; PDF tisku = počet a orientace stran", () => desktop(async (page) => {
  // nová stránka = nový záznam tisku (log je na stránce)
  const open = async (src, name) => {
    await page.goto(`${BASE}/print?src=${encodeURIComponent(src)}${name ? `&name=${encodeURIComponent(name)}` : ""}`);
    await page.locator('[data-testid="print-toolbar"][data-print-ready="1"]').waitFor({ timeout: 45_000 });
    const all = await waitPrints(page, 1);
    expect(all.length === 1, `tisk se otevřel právě jednou (${all.length})`);
    return all.at(-1);
  };
  let rec = await open(`/api/emails/attachment/${F.attPdf}`, "vykres-z-mailu.pdf");
  expect(rec.frame === false && rec.mode === "page" && rec.imgs === 3, `příloha PDF 3 strany (${rec.imgs})`);
  rec = await open(`/api/emails/attachment/${F.attImg}`, "foto-z-mailu.png");
  expect(rec.imgs === 1 && rec.orient[0] === "portrait", "příloha fotka");
  rec = await open(`/api/pdf/job/${JOB.id}?type=faktura`, null);
  expect(rec.imgs >= 1, "faktura (náhled) z /api/pdf");
  // zakázaná / cizí adresa
  await page.goto(`${BASE}/print?src=${encodeURIComponent("https://evil.example/x.pdf")}`);
  await page.getByTestId("print-invalid").waitFor({ timeout: 15_000 });
  // 10 stran: obrazovka, tiskové médium, skutečné PDF tisku (Chromium)
  rec = await open(`/api/jobs/files/${F.pdf10}`, NAMES.pdf10);
  expect(rec.imgs === 10, "10 stran");
  await shot(page, "06-desktop-tiskova-stranka");
  await page.emulateMedia({ media: "print" });
  const vis = await page.evaluate(() => ({
    others: [...document.body.children].filter((el) => el.id !== "mn-print-out" && getComputedStyle(el).display !== "none").map((el) => el.tagName),
    toolbar: getComputedStyle(document.querySelector('[data-testid="print-toolbar"]')).display,
    pages: [...document.querySelectorAll(".mn-print-page")].map((p) => p.getBoundingClientRect().height),
  }));
  await shot(page, "07-desktop-tiskove-medium");
  // page.pdf() = skutečný tisk Chromia (tiskové CSS); emulace obrazovky by ho přebila
  await page.emulateMedia({ media: null });
  expect(vis.others.length === 0, `tiskové médium: žádné lišty aplikace (${vis.others.join(", ")})`);
  expect(vis.pages.length === 10, "10 stran v tiskovém médiu");
  const pdfOut = await page.pdf({ preferCSSPageSize: true, printBackground: true });
  const pageCount = (pdfOut.toString("latin1").match(/\/Type\s*\/Page[^s]/g) ?? []).length;
  expect(pageCount === 10, `PDF tisku má 10 stran (${pageCount})`);
  // A3 na šířku → tisk na šířku
  await open(`/api/jobs/files/${F.a3}`, NAMES.a3);
  const a3 = await page.pdf({ preferCSSPageSize: true });
  const box = /\/MediaBox\s*\[\s*0\s+0\s+([\d.]+)\s+([\d.]+)\s*\]/.exec(a3.toString("latin1"));
  expect(box && Number(box[1]) > Number(box[2]), `PDF tisku A3 na šířku (${box?.slice(1).join(" × ")})`);
  expect((a3.toString("latin1").match(/\/Type\s*\/Page[^s]/g) ?? []).length === 1, "jedna strana (žádná prázdná navíc)");
}));

// ═════════════ telefon (iPhone, 390 px) ═════════════
await test("iPhone 390 px · Dokumenty → Tisknout → tisková stránka (strany, Tisknout, Zpět), tisk se otevře sám", () => iphone(async (page) => {
  await openDocs(page);
  await expectNoOverflow(page, "Dokumenty 390 px");
  const btn = row(page, NAMES.dl).getByTestId("print-button").first();
  await btn.scrollIntoViewIfNeeded();
  await shot(page, "08-iphone-dokumenty");
  await Promise.all([page.waitForURL((u) => u.pathname === "/print", { timeout: 20_000 }), btn.click()]);
  await page.locator('[data-testid="print-toolbar"][data-print-ready="1"]').waitFor({ timeout: 45_000 });
  const all = await waitPrints(page, 1);
  const rec = all.at(-1);
  expect(rec.frame === false && rec.mode === "page" && rec.imgs >= 1 && rec.complete, `tisková stránka na telefonu (${JSON.stringify({ mode: rec.mode, imgs: rec.imgs })})`);
  // telefon: nižší rozlišení (paměť) — A4 při 150 dpi
  expect(rec.sizes[0][0] >= 1200 && rec.sizes[0][0] <= 1300, `150 dpi na telefonu (${JSON.stringify(rec.sizes[0])})`);
  expect(await page.getByTestId("print-now").isVisible(), "Tisknout vidět");
  expect(await page.getByTestId("print-back").isVisible(), "Zpět vidět");
  await expectNoOverflow(page, "tisková stránka 390 px");
  await shot(page, "09-iphone-tiskova-stranka");
  await page.getByTestId("print-now").click();
  await waitPrints(page, 2);
  await page.emulateMedia({ media: "print" });
  await shot(page, "10-iphone-tiskove-medium");
  const others = await page.evaluate(() => [...document.body.children].filter((el) => el.id !== "mn-print-out" && getComputedStyle(el).display !== "none").length);
  await page.emulateMedia({ media: "screen" });
  expect(others === 0, "tiskové médium bez lišt i na telefonu");
  await Promise.all([page.waitForURL((u) => u.pathname === `/orders/${JOB.id}`, { timeout: 20_000 }), page.getByTestId("print-back").click()]);
}));

await test("iPhone 390 px · 10stránkové PDF a fotka; prohlížeč souborů → Tisknout = tisková stránka", () => iphone(async (page) => {
  await page.goto(`${BASE}/print?src=${encodeURIComponent(`/api/jobs/files/${F.pdf10}`)}&name=${encodeURIComponent(NAMES.pdf10)}`);
  await page.locator('[data-testid="print-toolbar"][data-print-ready="1"]').waitFor({ timeout: 60_000 });
  let rec = (await waitPrints(page, 1)).at(-1);
  expect(rec.imgs === 10 && rec.complete, `10 stran na telefonu (${rec.imgs})`);
  expect((await page.getByTestId("print-status").innerText()).includes("10 stran"), "stav „10 stran“");
  await openDocs(page);
  await row(page, NAMES.pdf10).getByRole("link", { name: NAMES.pdf10 }).first().click();
  await page.getByTestId("file-viewer").waitFor({ timeout: 20_000 });
  await page.getByTestId("pdf-view").locator("canvas").first().waitFor({ timeout: 20_000 });
  await page.waitForTimeout(500);
  await shot(page, "11-iphone-prohlizec");
  await Promise.all([page.waitForURL((u) => u.pathname === "/print", { timeout: 20_000 }), page.getByTestId("viewer-print").click()]);
  await page.locator('[data-testid="print-toolbar"][data-print-ready="1"]').waitFor({ timeout: 60_000 });
  rec = (await waitPrints(page, 1)).at(-1);
  expect(rec.imgs === 10, "z prohlížeče 10 stran");
  await page.getByTestId("print-back").click();
  await page.waitForURL((u) => u.pathname === `/orders/${JOB.id}`, { timeout: 20_000 });
}));

const ok = summary(errors.filter((e) => !/favicon/.test(e)));
const removed = await cleanup();
console.log(`  (úklid: ${removed} zakázek)`);
await browser.close();
process.exit(ok ? 0 : 1);
