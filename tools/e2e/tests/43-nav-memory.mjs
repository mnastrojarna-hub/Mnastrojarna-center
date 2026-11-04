// E2E 43 · Paměť navigace (majitel 4. 11.): filtry, hledání a vybraná složka / vlákno žijí v adrese, Zpět z detailu
// vrátí tentýž seznam (filtr, hledání i posun ±50 px), položka menu si pamatuje poslední stav. Prohlížeč PDF se
// kolečkem nezavře a stránka pod ním stojí; Esc / Zpět ho zavře na stejném místě. Počítač 1366×768 i telefon 390 px.
//   E2E_BASE_URL=http://localhost:3970 NAV_SHOTS=<adresář> node tools/e2e/tests/43-nav-memory.mjs
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { PDFDocument, StandardFonts, rgb } from "pdf-lib";
import { BASE, USERS, expect, launch, localEnv, login, sql, summary, test, withContext } from "../lib.mjs";

const SHOTS = process.env.NAV_SHOTS || path.join(os.tmpdir(), "nav-memory-shots");
fs.mkdirSync(SHOTS, { recursive: true });
const env = localEnv();
const TAG = Date.now().toString(36).toUpperCase();
const PREFIX = "Z-E2E43-";
const BOX = "e2e43@nastrojarstvi.test";
const q = (s) => String(s).replace(/'/g, "''");
const browser = await launch();
const errors = [];
const T = (name, fn, opts) => test(name, () => withContext(browser, errors, fn, opts));

console.log(`43 · Paměť navigace (značka ${TAG})`);

function cleanup() {
  const ids = sql(`select id from orders where number like '${PREFIX}%'`).split("\n").filter(Boolean);
  if (ids.length) {
    const list = ids.map((i) => `'${i}'`).join(",");
    sql(`delete from anon_send_queue where job_id in (${list})`);
    sql(`delete from job_files where job_id in (${list})`);
    sql(`delete from order_items where order_id in (${list})`);
    sql(`delete from orders where id in (${list})`);
  }
  sql(`delete from email_shares where thread_id in (select thread_id from emails where mailbox_id in (select id from mailboxes where email = '${BOX}'))`);
  sql(`delete from emails where mailbox_id in (select id from mailboxes where email = '${BOX}')`);
  sql(`delete from mailboxes where email = '${BOX}'`);
  sql(`delete from customers where name like 'E2E43 %'`);
}
cleanup();

const adminId = sql(`select id from profiles where email='${USERS.admin.email}'`);
// 26 zakázek (poptávky i objednávky) — seznam delší než obrazovka i na počítači
const JOBS = 26;
const jobIds = [];
for (let i = 1; i <= JOBS; i++) {
  const n = String(i).padStart(2, "0");
  const status = i % 2 ? "objednavka" : "poptavka";
  jobIds.push(sql(`insert into orders (number, title, source, status, owner_id, created_by, inquiry_date, priority)
    values ('${PREFIX}${TAG}-${n}', 'Paměť navigace ${TAG} díl ${n}', 'manual', '${status}', '${adminId}', '${adminId}', current_date, 'stredni') returning id`).split("\n")[0]);
}
// výkres PDF (3 strany) u první zakázky — prohlížeč
async function drawingPdf() {
  const doc = await PDFDocument.create();
  const helv = await doc.embedFont(StandardFonts.HelveticaBold);
  for (let i = 1; i <= 3; i++) {
    const p = doc.addPage([842, 595]);
    p.drawRectangle({ x: 20, y: 20, width: 802, height: 555, borderColor: rgb(0, 0, 0), borderWidth: 1.2 });
    p.drawText(`E2E43 ${TAG} strana ${i}`, { x: 220, y: 300, size: 26, font: helv });
  }
  return new Uint8Array(await doc.save());
}
const pdfBytes = await drawingPdf();
const pdfName = `E2E43-${TAG}.pdf`;
const storagePath = `zakazky/${jobIds[0]}/${randomUUID()}-${pdfName}`;
{
  const r = await fetch(`${env.NEXT_PUBLIC_SUPABASE_URL}/storage/v1/object/job-files/${storagePath}`, {
    method: "POST", headers: { authorization: `Bearer ${env.SUPABASE_SECRET_KEY}`, apikey: env.SUPABASE_SECRET_KEY, "content-type": "application/pdf", "x-upsert": "true" }, body: pdfBytes,
  });
  if (!r.ok) throw new Error(`upload PDF: ${r.status} ${await r.text()}`);
  sql(`insert into job_files (job_id, kind, filename, mime_type, size_bytes, storage_path, origin, issuer, uploaded_by)
    values ('${jobIds[0]}', 'vykres', '${pdfName}', 'application/pdf', ${pdfBytes.length}, '${q(storagePath)}', 'upload', 'zakaznik', '${adminId}')`);
}
// schránka s 30 vlákny: 24 poptávek (vyfiltrovaný seznam delší než panel na počítači) + 6 ostatních
const boxId = sql(`insert into mailboxes (provider, email, display_name, config, active, owner_id)
  values ('imap', '${BOX}', 'E2E43 schránka', '{}'::jsonb, true, '${adminId}') returning id`).split("\n")[0];
const MAILS = 30;
const INQUIRIES = 24;
for (let i = 1; i <= MAILS; i++) {
  const n = String(i).padStart(2, "0");
  const cat = i <= INQUIRIES ? "poptavka" : "ostatni";
  sql(`insert into emails (mailbox_id, direction, from_name, from_email, to_email, subject, snippet, body_text, category, priority, is_read, received_at)
    values ('${boxId}', 'in', 'Zákazník ${n}', 'z${n}@e2e43.test', '${BOX}', 'E2E43 ${TAG} zpráva ${n}', 'Text zprávy ${n}', 'Dobrý den, zpráva ${n}.', '${cat}', 'stredni', true, now() - interval '${i} minutes')`);
}
// 14 zákazníků — seznam delší než obrazovka
for (let i = 1; i <= 14; i++) {
  const n = String(i).padStart(2, "0");
  sql(`insert into customers (name, owner_id, country) values ('E2E43 Firma ${n} ${TAG}', '${adminId}', 'CZ')`);
}

const mainTop = (page) => page.evaluate(() => document.querySelector("main")?.scrollTop ?? 0);
const scrollMain = (page, y) => page.evaluate((v) => document.querySelector("main")?.scrollTo(0, v), y);
/** Úvodní animace obsahu (animate-fade-in) doběhne — jinak Playwright klik „nestabilní“ prvek posune sám. */
const settle = (page) => page.evaluate(() =>
  Promise.all((document.querySelector("main")?.getAnimations({ subtree: true }) ?? [])
    .filter((a) => a.effect?.getTiming().iterations !== Infinity)
    .map((a) => a.finished.catch(() => null))),
);
const near = (a, b, tol = 50) => Math.abs(a - b) <= tol;
/** Čekání na adresu s vlastním popisem v chybě (jinak jen „Timeout exceeded“). */
async function waitUrl(page, test, what, timeout = 20_000) {
  await page.waitForURL(test, { timeout }).catch(() => { throw new Error(`${what} — adresa je ${page.url()}`); });
}
const shot = (page, name) => page.screenshot({ path: path.join(SHOTS, `${name}.png`) });

async function knihaScenario(page, label) {
  await page.goto(`${BASE}/orders`);
  await page.getByLabel("Hledat v knize zakázek").waitFor({ timeout: 20_000 });
  await settle(page);
  // telefon: záložky rolují vodorovně — Vše je vpravo; klik během dojezdu stránky se může ztratit → zopakovat
  for (let i = 0; i < 3; i++) {
    await page.getByRole("link", { name: /^Vše/ }).first().click();
    if (await page.waitForURL(/segment=vse/, { timeout: 5_000 }).then(() => true, () => false)) break;
  }
  await waitUrl(page, /segment=vse/, "záložka Vše v adrese");
  await page.getByLabel("Hledat v knize zakázek").fill(`E2E43-${TAG}`);
  await waitUrl(page, (u) => u.searchParams.get("q") === `E2E43-${TAG}`, "hledání v adrese");
  await page.waitForLoadState("networkidle");
  await settle(page);
  const rows = page.locator(`a[href^="/orders/"]:has-text("${PREFIX}${TAG}")`);
  await rows.first().waitFor({ timeout: 20_000 });
  expect(await rows.count() >= JOBS, `vyfiltrováno ${JOBS} zakázek (${await rows.count()})`);
  const height = await page.evaluate(() => document.querySelector("main")?.scrollHeight ?? 0);
  const target = Math.round(height / 2);
  await scrollMain(page, target);
  await page.waitForTimeout(400);
  const before = await mainTop(page);
  expect(before > 100, `seznam posunutý doprostřed (${before})`);
  const url = page.url();
  await shot(page, `${label}-1-kniha-filtr`);
  // zakázka uprostřed obrazovky
  const mid = page.locator(`a[href^="/orders/"]:has-text("${PREFIX}${TAG}")`).nth(12);
  await mid.scrollIntoViewIfNeeded();
  await page.waitForTimeout(200);
  const beforeClick = await mainTop(page);
  const href = await mid.getAttribute("href");
  await mid.click();
  await waitUrl(page, (u) => u.pathname === href.split("?")[0], `otevření karty ${href}`);
  await page.getByText(`Paměť navigace ${TAG}`).first().waitFor({ timeout: 20_000 });
  await shot(page, `${label}-2-karta`);
  await page.goBack();
  await waitUrl(page, (u) => u.pathname === "/orders", "Zpět do knihy");
  await page.getByLabel("Hledat v knize zakázek").waitFor({ timeout: 20_000 });
  await page.waitForTimeout(900);
  expect(page.url() === url, `adresa s filtry (${page.url()} ≠ ${url})`);
  expect((await page.getByLabel("Hledat v knize zakázek").inputValue()) === `E2E43-${TAG}`, "hledání v poli zůstalo");
  expect(await page.getByRole("link", { name: /^Vše/ }).first().getAttribute("aria-current") === "page", "záložka Vše je dál aktivní");
  // počítač: Zrušit filtry v liště; telefon: pod tlačítkem „Filtry" (s počtem)
  if (label === "desktop") expect(await page.getByRole("button", { name: /Zrušit filtry/ }).first().isVisible(), "tlačítko Zrušit filtry je vidět");
  else expect(await page.locator('button:has-text("Zrušit filtry")').count() >= 1, "tlačítko Zrušit filtry je v liště filtrů (pod „Filtry“)");
  const after = await mainTop(page);
  expect(near(after, beforeClick), `posun obnoven (${beforeClick} → ${after})`);
  await shot(page, `${label}-3-zpet`);
  // paměť pro menu: odkaz „Kniha zakázek" nese poslední filtry
  const menuHref = await page.locator('a[href^="/orders"]').filter({ hasText: "Kniha zakázek" }).first().getAttribute("href").catch(() => null);
  if (menuHref) expect(menuHref.includes(`q=E2E43-${TAG}`), `odkaz menu s posledními filtry (${menuHref})`);
  // ještě jednou Zpět → kniha bez filtrů (nic se „nemaže po jednom“)
  await page.goBack();
  await page.waitForTimeout(900);
  expect(!page.url().includes("q=") && !page.url().includes("segment=vse"), `druhé Zpět opustí filtry (${page.url()})`);
}

await T("Kniha (počítač 1366×768): filtr + hledání + posun → karta → Zpět = stejný filtr, hledání, posun; menu si stav pamatuje", async (context) => {
  const page = await context.newPage();
  await page.setViewportSize({ width: 1366, height: 768 });
  await login(page, USERS.admin);
  await knihaScenario(page, "desktop");
});

await T("Kniha (telefon 390 px): totéž přes systémové Zpět", async (context) => {
  const page = await context.newPage();
  await login(page, USERS.admin);
  await knihaScenario(page, "mobil");
}, { mobile: true });

await T("Pošta (počítač): kategorie + hledání + posun seznamu → vlákno → odkaz pryč → Zpět = vše obnoveno vč. posunu panelu", async (context) => {
  const page = await context.newPage();
  await page.setViewportSize({ width: 1366, height: 768 });
  await login(page, USERS.admin);
  await page.goto(`${BASE}/inbox`);
  await page.getByTestId("mail-folders").first().waitFor();
  await page.getByTestId("category-chip-poptavka").click();
  await page.getByTestId("mail-search").fill(`E2E43 ${TAG}`);
  await page.waitForURL((u) => u.searchParams.get("q") === `E2E43 ${TAG}` && u.searchParams.get("kategorie") === "poptavka", { timeout: 15_000 });
  const rows = page.getByTestId("thread-row").filter({ hasText: `E2E43 ${TAG}` });
  // až dorazí vyfiltrovaný seznam (ten úvodní ze serveru je bez kategorie a hledání)
  await page.waitForFunction((n) => document.querySelectorAll('[data-testid="thread-row"]').length === n, INQUIRIES, { timeout: 20_000 });
  expect(await rows.count() === INQUIRIES, `jen poptávky ${TAG} (${await rows.count()})`);
  const list = page.getByTestId("thread-list-scroll");
  const listH = await list.evaluate((el) => el.scrollHeight - el.clientHeight);
  expect(listH > 100, `seznam vláken roluje (${listH})`);
  await list.evaluate((el) => el.scrollTo(0, Math.round((el.scrollHeight - el.clientHeight) / 2)));
  await page.waitForTimeout(400);
  const listBefore = await list.evaluate((el) => el.scrollTop);
  // vlákno uprostřed
  const row = rows.nth(6);
  await row.locator("button").first().click();
  await page.getByTestId("thread-view").filter({ hasText: `E2E43 ${TAG}` }).first().waitFor({ timeout: 20_000 });
  await page.waitForURL((u) => Boolean(u.searchParams.get("vlakno")), { timeout: 10_000 });
  const url = page.url();
  await shot(page, "desktop-4-posta-vlakno");
  // pryč z Pošty (menu) a zpět
  await page.locator("aside a, nav a").filter({ hasText: "Kniha zakázek" }).first().click();
  await waitUrl(page, (u) => u.pathname === "/orders", "menu → Kniha zakázek");
  await page.getByLabel("Hledat v knize zakázek").waitFor({ timeout: 20_000 });
  await page.waitForLoadState("networkidle");
  await settle(page);
  await page.goBack();
  await waitUrl(page, (u) => u.pathname === "/inbox", "Zpět do Pošty");
  await page.getByTestId("thread-view").filter({ hasText: `E2E43 ${TAG}` }).first().waitFor({ timeout: 20_000 });
  await page.waitForTimeout(900);
  expect(page.url() === url, `adresa Pošty obnovena (${page.url()})`);
  await shot(page, "desktop-5a-posta-po-zpet");
  expect((await page.getByTestId("mail-search").inputValue()) === `E2E43 ${TAG}`, "hledání v poli zůstalo");
  expect(await page.getByTestId("category-chip-poptavka").getAttribute("aria-pressed") === "true", "kategorie Poptávka zůstala");
  await page.waitForFunction((n) => document.querySelectorAll('[data-testid="thread-row"]').length === n, INQUIRIES, { timeout: 20_000 });
  const listAfter = await page.getByTestId("thread-list-scroll").evaluate((el) => el.scrollTop);
  expect(near(listAfter, listBefore), `posun seznamu obnoven (${listBefore} → ${listAfter})`);
  await shot(page, "desktop-5-posta-zpet");
});

await T("Pošta (telefon): otevřené vlákno = položka historie, Zpět ho zavře a vrátí seznam na stejné místo", async (context) => {
  const page = await context.newPage();
  await login(page, USERS.admin);
  await page.goto(`${BASE}/inbox?q=${encodeURIComponent(`E2E43 ${TAG}`)}`);
  await page.getByTestId("mail-folders").first().waitFor();
  const rows = page.getByTestId("thread-row").filter({ hasText: `E2E43 ${TAG}` });
  await page.waitForFunction((n) => document.querySelectorAll('[data-testid="thread-row"]').length === n, MAILS, { timeout: 20_000 });
  expect((await page.getByTestId("mail-search").inputValue()) === `E2E43 ${TAG}`, "hledání z adresy v poli");
  await settle(page);
  const row = rows.nth(14);
  await row.scrollIntoViewIfNeeded();
  await page.waitForTimeout(300);
  const before = await mainTop(page);
  expect(before > 100, `seznam posunutý (${before})`);
  await shot(page, "mobil-4-posta-seznam");
  await row.locator("button").first().click();
  await page.getByTestId("thread-view").filter({ hasText: `E2E43 ${TAG}` }).first().waitFor({ timeout: 20_000 });
  expect(page.url().includes("detail=1"), `vlákno v adrese (${page.url()})`);
  await shot(page, "mobil-5-posta-vlakno");
  await page.goBack();
  await page.waitForTimeout(900);
  expect(!page.url().includes("detail=1") && page.url().includes("q="), `Zpět zavřelo vlákno, hledání zůstalo (${page.url()})`);
  expect(await page.getByTestId("thread-view").count() === 0, "vlákno zavřené");
  await page.waitForFunction((n) => document.querySelectorAll('[data-testid="thread-row"]').length === n, MAILS, { timeout: 20_000 });
  await page.waitForTimeout(500);
  const after = await mainTop(page);
  expect(near(after, before), `posun seznamu obnoven (${before} → ${after})`);
  await shot(page, "mobil-6-posta-zpet");
}, { mobile: true });

async function viewerScenario(page, label) {
  await page.goto(`${BASE}/orders/${jobIds[0]}?tab=dokumenty`);
  const link = page.getByRole("link", { name: `Otevřít ${pdfName}` }).first();
  await link.waitFor({ timeout: 30_000 });
  await settle(page);
  await link.scrollIntoViewIfNeeded();
  await page.waitForTimeout(300);
  const before = await mainTop(page);
  await page.evaluate(() => { window.__pops = 0; window.addEventListener("popstate", () => { window.__pops++; }); });
  await link.click();
  const layer = page.getByTestId("file-viewer-layer");
  await layer.waitFor({ timeout: 15_000 });
  await layer.locator("canvas").first().waitFor({ timeout: 30_000 });
  const vp = page.viewportSize();
  await page.mouse.move(Math.round(vp.width / 2), Math.round(vp.height / 2));
  for (let i = 0; i < 20; i++) {
    await page.mouse.wheel(0, 160);
    await page.waitForTimeout(40);
  }
  await page.waitForTimeout(500);
  expect(await layer.count() === 1, "prohlížeč po 20× kolečku zůstal otevřený");
  expect(await page.evaluate(() => window.__pops) === 0, "kolečko nevyvolalo popstate");
  const pdfTop = await page.getByTestId("pdf-view").evaluate((el) => el.scrollTop);
  expect(pdfTop > 0, `kolečko roluje PDF (${pdfTop})`);
  expect((await mainTop(page)) === before, `stránka pod prohlížečem stojí (${before} → ${await mainTop(page)})`);
  await shot(page, `${label}-6-pdf-po-kolecku`);
  if (label === "desktop") await page.keyboard.press("Escape");
  else await page.getByTestId("viewer-back").click();
  await layer.waitFor({ state: "detached", timeout: 10_000 });
  await page.waitForTimeout(400);
  expect((await mainTop(page)) === before, `po zavření stejná pozice (${before} → ${await mainTop(page)})`);
  expect(page.url().includes("tab=dokumenty"), `adresa karty beze změny (${page.url()})`);
  await shot(page, `${label}-7-pdf-zavreno`);
}

await T("Karta zakázky (počítač): PDF v prohlížeči — 20× kolečko ho nezavře, stránka pod ním stojí; Esc zavře na stejném místě", async (context) => {
  const page = await context.newPage();
  await page.setViewportSize({ width: 1366, height: 768 });
  await login(page, USERS.admin);
  await viewerScenario(page, "desktop");
});

await T("Karta zakázky (telefon): PDF v prohlížeči — kolečko ho nezavře, Zpět v prohlížeči vrátí stejné místo", async (context) => {
  const page = await context.newPage();
  await login(page, USERS.admin);
  await viewerScenario(page, "mobil");
}, { mobile: true });

await T("Zákazníci: filtr + hledání + posun → karta zákazníka → Zpět = obnoveno; „Všichni zákazníci“ nese poslední stav", async (context) => {
  const page = await context.newPage();
  await page.setViewportSize({ width: 1366, height: 768 });
  await login(page, USERS.admin);
  await page.goto(`${BASE}/customers`);
  await page.getByLabel("Hledat zákazníka").fill(`E2E43`);
  await page.waitForURL((u) => u.searchParams.get("q") === "E2E43", { timeout: 15_000 });
  const cards = page.locator('a[href^="/customers/"]').filter({ hasText: "E2E43 Firma" });
  await cards.first().waitFor({ timeout: 20_000 });
  expect(await cards.count() === 14, `14 zákazníků E2E43 (${await cards.count()})`);
  await settle(page);
  const height = await page.evaluate(() => document.querySelector("main")?.scrollHeight ?? 0);
  await scrollMain(page, Math.round(height / 2));
  await page.waitForTimeout(400);
  const card = cards.nth(7);
  await card.scrollIntoViewIfNeeded();
  await page.waitForTimeout(200);
  const before = await mainTop(page);
  expect(before > 100, `seznam posunutý (${before})`);
  const url = page.url();
  await shot(page, "desktop-8-zakaznici");
  await card.click();
  await page.waitForURL(/\/customers\/[0-9a-f-]+$/, { timeout: 20_000 });
  await page.getByText("Všichni zákazníci").first().waitFor({ timeout: 20_000 });
  const backHref = await page.getByRole("link", { name: /Všichni zákazníci/ }).first().getAttribute("href");
  expect(backHref.includes("q=E2E43"), `odkaz zpět nese hledání (${backHref})`);
  await page.goBack();
  await page.waitForURL((u) => u.pathname === "/customers", { timeout: 20_000 });
  await cards.first().waitFor({ timeout: 20_000 });
  await page.waitForTimeout(900);
  expect(page.url() === url, `adresa obnovena (${page.url()})`);
  expect((await page.getByLabel("Hledat zákazníka").inputValue()) === "E2E43", "hledání v poli zůstalo");
  const after = await mainTop(page);
  expect(near(after, before), `posun obnoven (${before} → ${after})`);
  await shot(page, "desktop-9-zakaznici-zpet");
});

cleanup();
await browser.close();
const ok = summary(errors);
process.exit(ok ? 0 : 1);
