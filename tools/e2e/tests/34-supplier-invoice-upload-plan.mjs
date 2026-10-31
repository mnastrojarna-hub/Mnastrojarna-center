// E2E 34: Zanést fakturu + Platební plán (zadání majitele 31. 10.).
//  · obchodník zanese PDF faktury → „Faktura zapsána ✓" s hlavičkou z AI (dodavatel, číslo, částka, splatnost),
//    seznam Faktur dodavatelů nevidí; ZIP odmítne; stejná faktura znovu = „už je zapsaná (kdy, kdo)";
//    dodací list = „Tohle nevypadá jako faktura" (Přesto zapsat / Zrušit)
//  · Pošta (390 px): „Zapsat fakturu dodavatele" → Zanést fakturu s přílohou e-mailu předvybranou → zapsáno
//  · super admin vidí obě faktury; Platební plán: „Franta Vomáčka 12 500 Kč pozítří" pod správným dnem se
//    součty, nezaplacená faktura ve sbalené nápovědě, Zaplaceno → součty bez něj; řádek s fakturou → nabídka
//    označit i fakturu zaplacenou; 390 px bez vodorovného přetečení. Screenshoty → PAYPLAN_SHOTS.
//   E2E_BASE_URL=http://localhost:3600 PAYPLAN_SHOTS=<adresář> node tools/e2e/tests/34-supplier-invoice-upload-plan.mjs
// Server musí běžet s AI_FAKE_CAPTURE (fixture batch/sinv-g34.json, sinv-g35.json, sinv-g38.json).
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { BASE, USERS, expect, launch, localEnv, login, sql, summary, test } from "../lib.mjs";

const SHOTS = process.env.PAYPLAN_SHOTS || path.join(os.tmpdir(), "payplan-shots");
fs.mkdirSync(SHOTS, { recursive: true });
const STAMP = Date.now().toString(36);
const ICO = "27999934";
const SUBJECT = `E2E34 Faktura FV-34-2026-002 ${STAMP}`;
const PAYEE = `E2E34 Franta Vomáčka ${STAMP}`;
const lit = (v) => (v === null || v === undefined ? "null" : `'${String(v).replace(/'/g, "''")}'`);
const norm = (s) => String(s ?? "").replace(/[\s  ]+/g, " ").trim();

const pdfBuffer = (seed) => Buffer.from(`%PDF-1.4\n% E2E34 ${seed}\n1 0 obj << /Type /Catalog >> endobj\ntrailer << /Root 1 0 R >>\n%%EOF\n`);
const INVOICE_PDF = { name: `faktura-frezarna-${STAMP}__faktura_dodavatel-g34.pdf`, mimeType: "application/pdf", buffer: pdfBuffer(`inv-${STAMP}`) };
const DL_PDF = { name: `dodaci-list-${STAMP}__faktura_dodavatel-g35.pdf`, mimeType: "application/pdf", buffer: pdfBuffer(`dl-${STAMP}`) };
const ZIP = { name: `faktury-${STAMP}.zip`, mimeType: "application/zip", buffer: Buffer.from([0x50, 0x4b, 0x03, 0x04, 0, 0, 0, 0]) };

async function storage(method, bucket, p, body, contentType) {
  const env = localEnv();
  const url = method === "DELETE" ? `${env.NEXT_PUBLIC_SUPABASE_URL}/storage/v1/object/${bucket}` : `${env.NEXT_PUBLIC_SUPABASE_URL}/storage/v1/object/${bucket}/${p}`;
  const res = await fetch(url, {
    method,
    headers: { apikey: env.SUPABASE_SECRET_KEY, authorization: `Bearer ${env.SUPABASE_SECRET_KEY}`, "content-type": contentType, "x-upsert": "true" },
    body: method === "DELETE" ? JSON.stringify({ prefixes: p }) : body,
  });
  if (!res.ok && method !== "DELETE") throw new Error(`storage ${method} ${p}: ${res.status} ${await res.text()}`);
}

async function cleanup() {
  const ids = sql(`select id from supplier_invoices where supplier_key = '${ICO}' or number like 'FV-34-%' or number = 'DL-34-0077'`).split("\n").filter(Boolean);
  if (ids.length) {
    const inList = ids.map(lit).join(",");
    const files = sql(`select storage_path from supplier_invoice_files where invoice_id in (${inList})`).split("\n").filter(Boolean);
    if (files.length) await storage("DELETE", "supplier-invoices", files, null, "application/json").catch(() => {});
    sql(`delete from supplier_payment_plan where invoice_id in (${inList})`);
    sql(`delete from approval_queue where type::text = 'supplier_invoice' and payload->>'invoiceId' in (${inList})`);
    sql(`delete from supplier_invoices where id in (${inList}) and duplicate_of_id is not null`);
    sql(`delete from supplier_invoices where id in (${inList})`);
  }
  sql(`delete from supplier_payment_plan where payee like 'E2E34 %'`);
  sql(`delete from suppliers where ico = '${ICO}'`);
  const mails = sql(`select id from emails where subject like 'E2E34 %'`).split("\n").filter(Boolean);
  if (mails.length) {
    const atts = sql(`select storage_path from email_attachments where email_id in (${mails.map(lit).join(",")}) and storage_path is not null`).split("\n").filter(Boolean);
    if (atts.length) await storage("DELETE", "documents", atts, null, "application/json").catch(() => {});
    sql(`delete from emails where id in (${mails.map(lit).join(",")})`);
  }
}
await cleanup();
sql(`update automation_settings set mode = 'approval' where module = 'supplier_invoice'`);
sql(`update integration_settings set value = 'super_admin' where key = 'supplier_invoices_visibility'`);

const TODAY = sql(`select (now() at time zone 'Europe/Prague')::date`);
const dayPlus = (n) => sql(`select ((now() at time zone 'Europe/Prague')::date + ${n})::text`);
const OBCHOD = sql(`select id from profiles where email = ${lit(USERS.obchod.email)}`);
const ADMIN = sql(`select id from profiles where email = ${lit(USERS.admin.email)}`);

// e-mail obchodníka s fakturou v příloze (+ logo podpisu, které se nenabízí)
const MAIL_PDF = pdfBuffer(`mail-${STAMP}`);
const mailPath = `e2e34/${STAMP}/faktura.pdf`;
await storage("POST", "documents", mailPath, MAIL_PDF, "application/pdf");
const EMAIL_ID = sql(`insert into emails (owner_id, direction, from_name, from_email, to_email, subject, body_text, snippet, category, message_id, thread_id, received_at, has_attachments)
  values (${lit(OBCHOD)}, 'in', 'E2E Frézárna Plán', 'fakturace@e2e-27999934.cz', 'obchod@local.test', ${lit(SUBJECT)}, 'Dobrý den, v příloze posíláme fakturu.',
  'Dobrý den, v příloze posíláme fakturu.', 'faktura', ${lit(`<${STAMP}@e2e34>`)}, ${lit(`e2e34-${STAMP}`)}, now(), true) returning id`).split("\n")[0].trim();
sql(`insert into email_attachments (email_id, filename, mime_type, size_bytes, storage_path) values
  (${lit(EMAIL_ID)}, 'logo.png', 'image/png', 2048, ${lit(`e2e34/${STAMP}/logo.png`)}),
  (${lit(EMAIL_ID)}, 'faktura-posta__faktura_dodavatel-g38.pdf', 'application/pdf', ${MAIL_PDF.length}, ${lit(mailPath)})`);

const ctxOpts = (mobile) => (mobile
  ? { viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, locale: "cs-CZ" }
  : { viewport: { width: 1280, height: 860 }, locale: "cs-CZ" });

const browser = await launch();
const errors = [];
async function ctx(user, { mobile = false } = {}) {
  const context = await browser.newContext(ctxOpts(mobile));
  const page = await context.newPage();
  page.on("pageerror", (e) => errors.push(`pageerror ${page.url()}: ${e.message}`));
  page.on("console", (m) => { if (m.type() === "error" && !/favicon|DevTools|hydrat/i.test(m.text())) errors.push(`console ${page.url()}: ${m.text().slice(0, 300)}`); });
  page.on("response", (r) => { if (r.status() >= 500) errors.push(`HTTP ${r.status()} ${r.url()}`); });
  await login(page, user);
  return { context, page };
}
async function snap(page, name) {
  await page.waitForTimeout(250);
  await page.screenshot({ path: path.join(SHOTS, `${name}.png`), fullPage: true });
}
async function noOverflow(page, where) {
  const w = await page.evaluate(() => {
    const main = document.querySelector("main");
    return Math.max(document.documentElement.scrollWidth - window.innerWidth, main ? main.scrollWidth - main.clientWidth : 0);
  });
  expect(w <= 1, `${where}: vodorovné přetečení o ${w} px`);
}
async function eventually(fn, timeout = 20_000) {
  const t0 = Date.now();
  let last;
  while (Date.now() - t0 < timeout) {
    last = await fn();
    if (last) return last;
    await new Promise((r) => setTimeout(r, 300));
  }
  return last;
}
async function softGoto(page, url) {
  try {
    return await page.goto(url);
  } catch (e) {
    if (!/ERR_ABORTED|interrupted/i.test(String(e?.message ?? e))) throw e;
    await page.waitForLoadState("load").catch(() => {});
    return null;
  }
}
async function zanest(page, file) {
  const main = page.locator("main");
  await main.getByTestId("invoice-file-input").setInputFiles(file);
  await main.getByTestId("invoice-upload-submit").click();
  await main.locator('[data-testid="invoice-upload-done"], [data-testid="invoice-not-invoice"], [data-testid="invoice-upload-error"]').first().waitFor({ timeout: 45_000 });
}

await test("obchodník zanese PDF: „Faktura zapsána ✓“ s dodavatelem, číslem, částkou a splatností; seznam faktur nevidí", async () => {
  const { context, page } = await ctx(USERS.obchod);
  try {
    await page.goto(`${BASE}/supplier-invoices/upload`);
    const main = page.locator("main");
    await main.getByTestId("invoice-uploader").waitFor({ timeout: 20_000 });
    expect(norm(await main.locator("h1").first().textContent()) === "Zanést fakturu", "nadpis Zanést fakturu");
    await snap(page, "01-upload-desktop");
    await zanest(page, INVOICE_PDF);
    const done = main.getByTestId("invoice-upload-done");
    expect((await done.getAttribute("data-kind")) === "recorded", `výsledek: ${norm(await main.textContent()).slice(0, 300)}`);
    expect(norm(await main.getByTestId("invoice-upload-message").textContent()) === "Faktura zapsána ✓", "titulek potvrzení");
    const head = norm(await main.getByTestId("invoice-upload-head").textContent());
    for (const s of ["E2E Frézárna Plán s.r.o.", "FV-34-2026-001", "12 100 Kč", "12. 11. 2026"]) expect(head.includes(s), `potvrzení obsahuje „${s}“: ${head}`);
    expect((await main.getByRole("link", { name: /Otevřít fakturu/ }).count()) === 0, "obchodník má odkaz na fakturu");
    await snap(page, "02-upload-recorded-desktop");
    const row = sql(`select si.status || '|' || si.uploaded_by || '|' || coalesce(s.ico, '') || '|' || si.total_gross || '|' || si.due_date
      from supplier_invoices si left join suppliers s on s.id = si.supplier_id where si.supplier_key = '${ICO}' and si.number = 'FV-34-2026-001'`);
    expect(row === `ke_kontrole|${OBCHOD}|${ICO}|12100.00|2026-11-12`, `faktura v DB: ${row}`);
    expect(sql(`select count(*) from approval_queue where type::text = 'supplier_invoice' and status = 'pending' and payload->>'invoiceId' = (select id::text from supplier_invoices where number = 'FV-34-2026-001')`) === "1", "řádek fronty pro super admina");
    // seznam Faktur dodavatelů nevidí (ani v menu)
    await softGoto(page, `${BASE}/supplier-invoices`);
    await page.waitForLoadState("networkidle").catch(() => {});
    expect((await page.locator("main").getByTestId("invoice-list").count()) === 0, "obchodník otevřel seznam faktur");
    expect(!(await page.content()).includes('href="/supplier-invoices"'), "obchodník má v menu Faktury dodavatelů");
    await softGoto(page, `${BASE}/supplier-invoices/plan`);
    await page.waitForLoadState("networkidle").catch(() => {});
    expect((await page.locator("main").getByTestId("payment-plan").count()) === 0, "obchodník otevřel platební plán");
  } finally {
    await context.close();
  }
});

await test("ZIP odmítne česky; stejná faktura znovu = „už je zapsaná (kdy, kdo)“; dodací list = „Tohle nevypadá jako faktura“", async () => {
  const { context, page } = await ctx(USERS.obchod);
  try {
    await page.goto(`${BASE}/supplier-invoices/upload`);
    const main = page.locator("main");
    await main.getByTestId("invoice-uploader").waitFor({ timeout: 20_000 });
    await main.getByTestId("invoice-file-input").setInputFiles(ZIP);
    const err = norm(await main.getByTestId("invoice-upload-error").textContent());
    expect(/není faktura v PDF ani obrázek/.test(err), `ZIP: ${err}`);
    expect((await main.getByTestId("invoice-upload-submit").count()) === 0, "ZIP šel vybrat k zapsání");
    await snap(page, "03-upload-zip-rejected");
    await zanest(page, INVOICE_PDF);
    const done = main.getByTestId("invoice-upload-done");
    expect((await done.getAttribute("data-kind")) === "duplicate", "druhé zanesení není duplicita");
    const msg = norm(await main.getByTestId("invoice-upload-message").textContent());
    expect(/^Tahle faktura už je zapsaná \(\d{1,2}\. \d{1,2}\. \d{4}, Petr Obchodník\)\.$/.test(msg), `duplicita: ${msg}`);
    expect(sql(`select count(*) from supplier_invoices where supplier_key = '${ICO}'`) === "1", "duplicita založila fakturu");
    await snap(page, "04-upload-duplicate");
    await main.getByTestId("invoice-upload-again").click();
    await zanest(page, DL_PDF);
    const ni = main.getByTestId("invoice-not-invoice");
    expect(/dodací list/.test(norm(await ni.textContent())), "nepoznal dodací list");
    expect((await ni.getByTestId("invoice-force").count()) === 1, "chybí Přesto zapsat");
    await snap(page, "05-upload-not-invoice");
    await ni.getByTestId("invoice-force-cancel").click();
    await main.getByTestId("invoice-file-input").waitFor({ state: "attached" });
    expect(sql(`select count(*) from supplier_invoices where number = 'DL-34-0077'`) === "0", "dodací list se zapsal");
  } finally {
    await context.close();
  }
});

await test("Pošta (390 px): Zapsat fakturu dodavatele → příloha předvybraná → Zanést fakturu → zapsáno", async () => {
  const { context, page } = await ctx(USERS.obchod, { mobile: true });
  try {
    await page.goto(`${BASE}/inbox`);
    await page.locator('[data-testid="mail-search"]:visible').first().waitFor({ timeout: 30_000 });
    await page.locator('[data-testid="mail-search"]:visible').first().fill(STAMP);
    await page.waitForTimeout(700);
    await page.waitForLoadState("networkidle");
    const row = page.getByTestId("thread-row").filter({ hasText: "E2E34 Faktura" }).first();
    await row.waitFor({ timeout: 30_000 });
    await row.locator("button").first().click();
    const view = page.getByTestId("thread-view").filter({ hasText: "E2E34 Faktura" }).last();
    await view.waitFor({ timeout: 20_000 });
    const action = view.getByTestId("mail-primary-action").first();
    await action.waitFor({ timeout: 20_000 });
    expect((await action.getAttribute("data-action")) === "invoice.record", `hlavní akce: ${await action.getAttribute("data-action")}`);
    await Promise.all([page.waitForURL(/\/supplier-invoices\/upload\?email=/, { timeout: 30_000 }), action.click()]);
    const main = page.locator("main");
    await main.getByTestId("invoice-email-source").waitFor({ timeout: 20_000 });
    const atts = main.getByTestId("invoice-email-attachment");
    expect((await atts.count()) === 1, `nabízené přílohy: ${await atts.count()} (logo se nenabízí)`);
    expect(await atts.first().locator("input[type=radio]").isChecked(), "příloha není předvybraná");
    await noOverflow(page, "Zanést fakturu z Pošty 390");
    await snap(page, "06-posta-preselected-390");
    await main.getByTestId("invoice-email-submit").click();
    const done = main.getByTestId("invoice-upload-done");
    await done.waitFor({ timeout: 45_000 });
    expect((await done.getAttribute("data-kind")) === "recorded", `výsledek z Pošty: ${norm(await done.textContent())}`);
    const head = norm(await main.getByTestId("invoice-upload-head").textContent());
    expect(head.includes("FV-34-2026-002") && head.includes("4 840 Kč"), `hlavička z Pošty: ${head}`);
    await noOverflow(page, "potvrzení 390");
    await snap(page, "07-posta-recorded-390");
    const r = sql(`select source || '|' || coalesce(email_id::text, '') || '|' || coalesce(capture_key, '') from supplier_invoices where number = 'FV-34-2026-002'`);
    expect(r.startsWith(`email|${EMAIL_ID}|email:`), `faktura z e-mailu: ${r}`);
  } finally {
    await context.close();
  }
});

await test("super admin: obě faktury v seznamu (záložky Faktury · Platební plán)", async () => {
  const { context, page } = await ctx(USERS.admin);
  try {
    await page.goto(`${BASE}/supplier-invoices`);
    const main = page.locator("main");
    await main.getByTestId("invoice-list").waitFor({ timeout: 20_000 });
    await main.getByTestId("invoice-tabs").waitFor();
    for (const n of ["FV-34-2026-001", "FV-34-2026-002"]) {
      await main.getByTestId("invoice-card").filter({ hasText: n }).first().waitFor({ timeout: 10_000 });
    }
    await snap(page, "08-admin-list-tabs");
  } finally {
    await context.close();
  }
});

const openPlanSum = (day) => Number(sql(`select coalesce(sum(amount), 0) from supplier_payment_plan where paid_at is null and currency = 'CZK'${day ? ` and due_on = '${day}'` : ""}`));
const czk = (n) => `${Math.round(n).toLocaleString("cs-CZ").replace(/[\s ]/g, " ")} Kč`;

await test("Platební plán: Franta Vomáčka 12 500 Kč pozítří → pod správným dnem se součty; faktura ve sbalené nápovědě; Zaplaceno odečte", async () => {
  // nezaplacená faktura se splatností za 3 dny → v nápovědě (ne v plánu)
  sql(`update supplier_invoices set due_date = '${dayPlus(3)}' where number = 'FV-34-2026-001'`);
  const { context, page } = await ctx(USERS.admin);
  try {
    await page.goto(`${BASE}/supplier-invoices/plan`);
    const main = page.locator("main");
    await main.getByTestId("payment-plan").waitFor({ timeout: 20_000 });
    expect((await main.getByTestId("invoice-tab-plan").getAttribute("aria-current")) === "page", "záložka Platební plán");
    const form = main.getByTestId("plan-form");
    await form.getByTestId("plan-payee").fill(PAYEE);
    await form.getByTestId("plan-amount").fill("12 500");
    await form.getByTestId("plan-quick-pozitri").click();
    await form.getByTestId("plan-note").press("Enter");
    const day = main.locator(`[data-testid="plan-day"][data-day="${dayPlus(2)}"]`);
    const row = day.getByTestId("plan-row").filter({ hasText: PAYEE });
    await row.waitFor({ timeout: 15_000 });
    expect(norm(await row.getByTestId("plan-row-amount").textContent()) === "12 500 Kč", "částka řádku");
    const dbRow = sql(`select amount || '|' || due_on || '|' || created_by from supplier_payment_plan where payee = ${lit(PAYEE)}`);
    expect(dbRow === `12500.00|${dayPlus(2)}|${ADMIN}`, `řádek v DB: ${dbRow}`);
    const label = norm(await day.getByTestId("plan-day-label").textContent());
    expect(!/Dnes|Zítra/.test(label) && /\d{1,2}\. \d{1,2}\./.test(label), `popisek dne: ${label}`);
    expect(norm(await day.getByTestId("plan-day-total").textContent()) === czk(openPlanSum(dayPlus(2))), "součet dne");
    expect(norm(await main.getByTestId("plan-total").textContent()).startsWith(czk(openPlanSum(null))), `celkem: ${norm(await main.getByTestId("plan-total").textContent())}`);
    // nápověda: nezaplacená faktura do 14 dní — sbalená, v součtech není
    const hint = main.getByTestId("plan-invoices-hint");
    expect(!(await hint.evaluate((d) => d.open)), "nápověda faktur je rozbalená");
    await hint.locator("summary").click();
    await hint.getByTestId("plan-invoice-hint").filter({ hasText: "FV-34-2026-001" }).waitFor({ timeout: 5_000 });
    await snap(page, "09-plan-desktop");
    // druhý řádek s odkazem na fakturu (vyhledání → předvyplní komu / částku / splatnost)
    await form.getByTestId("plan-link-invoice").click();
    await form.getByTestId("plan-invoice-search").fill("FV-34-2026-001");
    await form.getByTestId("plan-invoice-option").filter({ hasText: "FV-34-2026-001" }).first().click();
    expect((await form.getByTestId("plan-payee").inputValue()) === "E2E Frézárna Plán s.r.o.", "komu z faktury");
    expect(norm(await form.getByTestId("plan-amount").inputValue()) === "12 100", `částka z faktury: ${await form.getByTestId("plan-amount").inputValue()}`);
    await form.getByTestId("plan-payee").fill(`E2E34 Frézárna ${STAMP}`);
    await form.getByTestId("plan-submit").click();
    const linked = main.getByTestId("plan-row").filter({ hasText: `E2E34 Frézárna ${STAMP}` });
    await linked.waitFor({ timeout: 15_000 });
    expect(norm(await linked.getByTestId("plan-row-invoice").textContent()).includes("FV-34-2026-001"), "odkaz na fakturu v řádku");
    // Zaplaceno: řádek zmizí z dne, součty bez něj
    const before = openPlanSum(null);
    await row.getByTestId("plan-row-paid").click();
    await row.waitFor({ state: "detached", timeout: 15_000 });
    const paid = await eventually(() => {
      const r = sql(`select paid_at || '|' || paid_by from supplier_payment_plan where payee = ${lit(PAYEE)}`);
      return r === `${TODAY}|${ADMIN}` ? r : null;
    });
    expect(paid, `zaplaceno v DB: ${sql(`select coalesce(paid_at::text, '-') from supplier_payment_plan where payee = ${lit(PAYEE)}`)}`);
    expect(openPlanSum(null) === before - 12500, "součet v DB");
    expect(norm(await main.getByTestId("plan-total").textContent()).startsWith(czk(before - 12500)), `celkem po zaplacení: ${norm(await main.getByTestId("plan-total").textContent())}`);
    expect(/Zaplacené za posledních 30 dní \(\d+\)/.test(norm(await main.getByTestId("plan-paid").textContent())), "sekce zaplacených");
    // řádek s fakturou: Zaplaceno nabídne označit i fakturu (nevnucuje)
    await linked.getByTestId("plan-row-paid").click();
    const offer = main.getByTestId("plan-offer-invoice");
    await offer.waitFor({ timeout: 15_000 });
    expect(sql(`select payment_status from supplier_invoices where number = 'FV-34-2026-001'`) === "nezaplaceno", "faktura se označila sama");
    await snap(page, "10-plan-paid-offer");
    await offer.getByTestId("plan-offer-yes").click();
    const invPaid = await eventually(() => (sql(`select payment_status from supplier_invoices where number = 'FV-34-2026-001'`) === "zaplaceno" ? true : null));
    expect(invPaid, "faktura se neoznačila zaplacená");
  } finally {
    await context.close();
  }
});

await test("Platební plán a Zanést fakturu na 390 px: bez vodorovného přetečení", async () => {
  sql(`insert into supplier_payment_plan (payee, amount, due_on, created_by) values (${lit(`E2E34 Po termínu ${STAMP}`)}, 800, '${dayPlus(-2)}', ${lit(ADMIN)})`);
  const { context, page } = await ctx(USERS.admin, { mobile: true });
  try {
    await page.goto(`${BASE}/supplier-invoices/plan`);
    const main = page.locator("main");
    await main.getByTestId("payment-plan").waitFor({ timeout: 20_000 });
    const overdue = main.locator('[data-testid="plan-day"][data-day="overdue"]');
    await overdue.waitFor({ timeout: 10_000 });
    expect(/Po termínu/.test(norm(await overdue.textContent())), "skupina Po termínu");
    await noOverflow(page, "platební plán 390");
    await snap(page, "11-plan-390");
    await page.goto(`${BASE}/supplier-invoices/upload`);
    await main.getByTestId("invoice-uploader").waitFor({ timeout: 20_000 });
    await noOverflow(page, "zanést fakturu 390");
    await snap(page, "12-upload-390");
  } finally {
    await context.close();
  }
});

await browser.close();
if (!process.env.PAYPLAN_KEEP) await cleanup();
const ok = summary(errors);
process.exit(ok ? 0 : 1);
