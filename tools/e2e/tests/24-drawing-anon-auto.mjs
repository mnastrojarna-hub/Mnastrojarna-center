// Anonymizace se spustí SAMA hned po nahrání výkresu do existující zakázky (oprava „nahrané dodatečně
// se točí a nedoběhne"): bez jediného kliknutí na „Anonymizovat", bez plánovače, a i když interní
// rozvětvení nefunguje (APP_URL na nedosažitelné adrese — jako chráněné nasazení Vercelu).
// Desktop: první výkres do existující poptávky; mobil: druhý výkres později do téže zakázky.
// Nastavení ukáže stav zpracování na pozadí.
//   E2E_BASE_URL=http://localhost:3500 ANON_SHOTS=<adresář> node tools/e2e/tests/24-drawing-anon-auto.mjs
// Server: AI_FAKE_ANON=<prázdný adresář> (neutrální testovací AI), volitelně APP_URL=http://127.0.0.1:9.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { PDFDocument, StandardFonts, rgb } from "pdf-lib";
import { BASE, USERS, expect, launch, login, sql, summary, test } from "../lib.mjs";

const SHOTS = process.env.ANON_SHOTS || path.join(os.tmpdir(), "anon-auto-shots");
fs.mkdirSync(SHOTS, { recursive: true });
const STAMP = Date.now().toString(36).toUpperCase();
const NUMBER = `Z-E2E-ANONAUTO24-${STAMP}`;

async function drawingPdf(no) {
  const doc = await PDFDocument.create();
  doc.setAuthor("Jan Novák");
  const helv = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const W = 1190.55, H = 841.89;
  const p = doc.addPage([W, H]);
  p.drawRectangle({ x: 20, y: 20, width: W - 40, height: H - 40, borderColor: rgb(0, 0, 0), borderWidth: 1.2 });
  const tbx = W - 540, tby = 20;
  p.drawRectangle({ x: tbx, y: tby, width: 520, height: 170, borderColor: rgb(0, 0, 0), borderWidth: 1 });
  const t = (s, x, y, size = 8, f = helv) => p.drawText(s, { x, y, size, font: f, color: rgb(0, 0, 0) });
  t("STROJMETAL a.s.", tbx + 50, tby + 150, 12, bold);
  t("Kreslil:", tbx + 5, tby + 122, 7); t("J. Novak", tbx + 50, tby + 122);
  t("Material:", tbx + 265, tby + 92, 7); t("1.4301", tbx + 305, tby + 92);
  t("Cislo vykresu:", tbx + 5, tby + 30, 7); t(no, tbx + 135, tby + 28, 14, bold);
  t("C:\\Projekty\\Strojmetal\\" + no + ".dwg", 30, 26, 6);
  p.drawRectangle({ x: 200, y: 360, width: 420, height: 120, borderColor: rgb(0, 0, 0), borderWidth: 0.7 });
  t("420 ±0,1", 390, 334, 9);
  return new Uint8Array(await doc.save());
}

function cleanup() {
  sql(`delete from anon_send_queue where job_id in (select id from orders where number like 'Z-E2E-ANONAUTO24-%')`);
  sql(`delete from drawing_anon_usage_log where subject_id in (select f.id from job_files f join orders o on o.id = f.job_id where o.number like 'Z-E2E-ANONAUTO24-%')`);
  sql(`delete from job_files where job_id in (select id from orders where number like 'Z-E2E-ANONAUTO24-%')`);
  sql(`delete from orders where number like 'Z-E2E-ANONAUTO24-%'`);
}
cleanup();

const adminId = sql(`select id from profiles where email='${USERS.admin.email}'`);
const jobId = sql(`insert into orders (number, title, source, status, owner_id) values ('${NUMBER}', 'Poptávka — výkres dodatečně (E2E)', 'manual', 'poptavka', '${adminId}') returning id`).split("\n")[0];
const files = [];
for (const no of ["D-5678-01", "D-5678-02"]) {
  const fp = path.join(os.tmpdir(), `${no}-${STAMP}.pdf`);
  fs.writeFileSync(fp, await drawingPdf(no));
  files.push({ no, fp, name: path.basename(fp) });
}

const browser = await launch();
const errors = [];

/** Nahraje výkres v Dokumentech zakázky a čeká na hotovou anonymizaci — bez kliknutí na „Anonymizovat". */
async function uploadAndWait(page, f, tag) {
  const manual = [];
  const nudges = [];
  page.on("request", (r) => {
    const u = new URL(r.url());
    if (r.method() === "POST" && u.pathname === "/api/drawings/anonymize") manual.push(u.pathname);
    if (r.method() === "POST" && u.pathname === "/api/drawings/anonymize/process") nudges.push(u.pathname);
  });
  await page.goto(`${BASE}/orders/${jobId}?tab=dokumenty`);
  // vstup dropzóny „Přetáhni sem soubory" v Dokumentech (ne tlačítko v hlavičce)
  const input = page.getByText("Přetáhni sem soubory nebo je vyber").locator("visible=true").first()
    .locator("xpath=ancestor::div[contains(@class,'border-dashed')][1]").locator("input[type=file]");
  await input.waitFor({ state: "attached", timeout: 30_000 });
  const t0 = Date.now();
  await input.setInputFiles(f.fp);
  const row = page.locator("li", { hasText: f.name }).locator("visible=true").first();
  await row.waitFor({ timeout: 60_000 }).catch(async (e) => {
    await page.screenshot({ path: path.join(SHOTS, `24-${tag}-chyba.png`), fullPage: true });
    throw e;
  });
  // odznak se objeví „Anonymizuje se…" a během čekání se sám změní na hotovo / ke kontrole
  await page.waitForFunction((name) => {
    const li = [...document.querySelectorAll("li")].find((x) => x.offsetParent !== null && (x.textContent ?? "").includes(name));
    const st = li?.querySelector("[data-anon-status]")?.getAttribute("data-anon-status");
    return st === "done" || st === "review" || st === "failed";
  }, f.name, { timeout: 150_000 });
  const st = await row.locator("[data-anon-status]").first().getAttribute("data-anon-status");
  console.log(`    ${tag}: ${f.name} → ${st} za ${Math.round((Date.now() - t0) / 1000)} s (šťouchnutí: ${nudges.length})`);
  expect(st === "done" || st === "review", `${tag}: výkres anonymizován (${st})`);
  expect(manual.length === 0, `${tag}: bez ručního „Anonymizovat" (${manual.length})`);
  expect(nudges.length >= 1, `${tag}: prohlížeč šťouchl do fronty po nahrání`);
  const db = sql(`select anon_status || '|' || coalesce(anon_via, '') || '|' || coalesce(anon_actor_kind, '') from job_files where job_id='${jobId}' and filename='${f.name}' and not archived`);
  expect(/^(done|review)\|automaticky\|(ai|system)$/.test(db), `${tag}: DB stav automatiky (${db})`);
  await row.evaluate((el) => el.scrollIntoView({ block: "center" }));
  await page.screenshot({ path: path.join(SHOTS, `24-${tag}.png`) });
}

await test("desktop: výkres nahraný do existující poptávky se anonymizuje sám", async () => {
  const context = await browser.newContext({ viewport: { width: 1280, height: 860 }, locale: "cs-CZ" });
  context.on("page", (p) => {
    p.on("pageerror", (e) => errors.push(`pageerror ${p.url()}: ${e.message}`));
    p.on("response", (r) => { if (r.status() >= 500) errors.push(`HTTP ${r.status()} ${r.url()}`); });
  });
  const page = await context.newPage();
  try {
    await login(page, USERS.admin);
    await uploadAndWait(page, files[0], "desktop");
  } finally {
    await context.close();
  }
});

await test("mobil: další výkres později do téže zakázky — také sám, bez tlačítka", async () => {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, locale: "cs-CZ" });
  context.on("page", (p) => {
    p.on("pageerror", (e) => errors.push(`pageerror ${p.url()}: ${e.message}`));
    p.on("response", (r) => { if (r.status() >= 500) errors.push(`HTTP ${r.status()} ${r.url()}`); });
  });
  const page = await context.newPage();
  try {
    await login(page, USERS.admin);
    await uploadAndWait(page, files[1], "mobil");
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow <= 1, `bez vodorovného posunu (${overflow} px)`);
  } finally {
    await context.close();
  }
});

await test("Nastavení: řádek o stavu zpracování na pozadí", async () => {
  const context = await browser.newContext({ viewport: { width: 1280, height: 860 }, locale: "cs-CZ" });
  const page = await context.newPage();
  try {
    await login(page, USERS.admin);
    await page.goto(`${BASE}/settings`);
    const line = page.getByTestId("anon-runner-status").locator("visible=true").first();
    await line.waitFor({ timeout: 30_000 });
    const tone = await line.getAttribute("data-tone");
    const text = await line.innerText();
    console.log(`    Nastavení (${tone}): ${text.slice(0, 220)}`);
    if (!process.env.E2E_EXPECT_CRON) expect(tone === "warn" && /CRON_SECRET/.test(text), "bez CRON_SECRET varování");
    if (process.env.E2E_EXPECT_UNREACHABLE) expect(/nedostupná|nefunguje/.test(text), "nedosažitelná adresa ohlášena");
    await line.scrollIntoViewIfNeeded();
    await page.screenshot({ path: path.join(SHOTS, "24-nastaveni.png") });
  } finally {
    await context.close();
  }
});

await browser.close();
for (const f of files) { try { fs.unlinkSync(f.fp); } catch { /* */ } }
if (!process.env.ANON_KEEP) cleanup();
const ok = summary(errors);
process.exit(ok ? 0 : 1);
