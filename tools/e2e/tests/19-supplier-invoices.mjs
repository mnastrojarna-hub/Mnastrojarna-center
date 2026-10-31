// E2E: Faktury dodavatelů. Zaměstnanec na mobilu (390 px) zanese fakturu → „Faktura zapsána ✓" s hlavičkou
// (31. 10.) a seznam ani detail faktur nevidí. Super admin ji otevře (AI už navrhla rozdělení podle
// OV-2099-901 a dopravu do režie), položku „Kalení — sdružené zakázky" rozdělí 600 / 400 na dvě zakázky
// (Rozdělit → částka → zbytek se dopočítá), uloží a potvrdí, označí zaplaceno. Zakázka v Nákupu ukáže
// skutečný náklad z faktury. Režim „všichni vidí faktury" — obchodník vidí, zaplaceno nemění.
// Dodavatelé → „Přiložit fakturu" založí dodavatele z hlavičky.
// Screenshoty desktop 1280 + mobil 390, světlý + tmavý → SINV_SHOTS.
//   E2E_BASE_URL=http://localhost:3500 SINV_SHOTS=<adresář> node tools/e2e/tests/19-supplier-invoices.mjs
// Server musí běžet s AI_FAKE_CAPTURE (fixture batch/sinv.json a sinv-g2.json).
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { BASE, USERS, expect, launch, localEnv, login, sql, summary, test } from "../lib.mjs";
import { pngFile } from "../lib-capture.mjs";

const SHOTS = process.env.SINV_SHOTS || path.join(os.tmpdir(), "inv-shots");
fs.mkdirSync(SHOTS, { recursive: true });
const STAMP = Date.now().toString(36).toUpperCase();
const PREFIX = "Z-E2E-SINV-";
const PO_NUMBER = "OV-2099-901";
const HRUBY = "d4000000-0000-0000-0000-000000000001";
const lit = (v) => (v === null || v === undefined ? "null" : `'${String(v).replace(/'/g, "''")}'`);
const INVOICE_WHERE = "(supplier_key = '25874411' and number_norm = 'FA20260815') or supplier_key = '27999990' or number like 'E2E-SINV-%'";
const RECORDED = "Faktura zapsána ✓";

async function removeBucket(bucket, paths) {
  const list = paths.filter(Boolean);
  if (!list.length) return;
  const env = localEnv();
  try {
    await fetch(`${env.NEXT_PUBLIC_SUPABASE_URL}/storage/v1/object/${bucket}`, {
      method: "DELETE",
      headers: { apikey: env.SUPABASE_SECRET_KEY, authorization: `Bearer ${env.SUPABASE_SECRET_KEY}`, "content-type": "application/json" },
      body: JSON.stringify({ prefixes: list }),
    });
  } catch { /* úklid je best-effort */ }
}

async function cleanup() {
  const ids = sql(`select id from supplier_invoices where ${INVOICE_WHERE}`).split("\n").filter(Boolean);
  if (ids.length) {
    const inList = ids.map(lit).join(",");
    const files = sql(`select storage_path from supplier_invoice_files where invoice_id in (${inList})`).split("\n").filter(Boolean);
    await removeBucket("supplier-invoices", files);
    sql(`delete from approval_queue where type::text = 'supplier_invoice' and payload->>'invoiceId' in (${inList})`);
    // nejdřív duplicity (smazání originálu by jim vynulovalo odkaz → dvě stejné faktury = unikátní index)
    sql(`delete from supplier_invoices where id in (${inList}) and duplicate_of_id is not null`);
    sql(`delete from supplier_invoices where id in (${inList})`);
    sql(`delete from audit_log where entity_id in (${inList})`);
  }
  sql(`delete from purchase_orders where number = ${lit(PO_NUMBER)}`);
  // focení z testu (dávka u zakázky A, přeznačené foto): relace a stránky v capture/
  const caps = sql(`select id from capture_sessions where data::text like '%E2E-SINV-CAP%'`).split("\n").filter(Boolean);
  for (const c of caps) {
    const pages = sql(`select coalesce(string_agg(f->>'path', E'\\n'), '') from capture_sessions, jsonb_array_elements(data->'files') f where id = ${lit(c)}`).split("\n").filter(Boolean);
    await removeBucket("job-files", pages);
    sql(`delete from capture_sessions where id = ${lit(c)}`);
  }
  const jobs = sql(`select id from orders where number like ${lit(`${PREFIX}%`)}`).split("\n").filter(Boolean);
  if (jobs.length) {
    const inList = jobs.map(lit).join(",");
    await removeBucket("job-files", sql(`select storage_path from job_files where job_id in (${inList})`).split("\n").filter(Boolean));
    sql(`delete from commission_entries where order_id in (${inList})`);
    sql(`delete from job_events where job_id in (${inList})`);
    sql(`delete from orders where id in (${inList})`);
  }
  sql(`delete from suppliers where ico = '27999990'`);
  sql(`update integration_settings set value = 'super_admin' where key = 'supplier_invoices_visibility'`);
  sql(`update automation_settings set mode = 'approval' where module = 'supplier_invoice'`);
  return ids.length + jobs.length;
}

const left = await cleanup();
if (left) console.log(`  (úklid po minulém běhu: ${left} záznamů)`);

const sales = sql(`select id from profiles where email = ${lit(USERS.obchod.email)}`);
const customer = sql(`select id from customers order by created_at limit 1`) || null;
function mkJob(suffix, title) {
  return sql(`insert into orders (number, title, customer_id, status, owner_id, created_by, source, value, order_date)
    values (${lit(`${PREFIX}${STAMP}-${suffix}`)}, ${lit(title)}, ${lit(customer)}, 'potvrzeno', ${lit(sales)}, ${lit(sales)}, 'manual', 100000, '2026-10-20') returning id`).split("\n")[0].trim();
}
const jobA = mkJob("A", "Příruby DN80 (E2E faktury)");
const jobB = mkJob("B", "Hřídele kalené (E2E faktury)");
const numA = `${PREFIX}${STAMP}-A`;
const numB = `${PREFIX}${STAMP}-B`;
sql(`insert into purchase_orders (job_id, supplier_id, number, status, total) values (${lit(jobA)}, ${lit(HRUBY)}, ${lit(PO_NUMBER)}, 'potvrzena', 30000)`);

const INVOICE_FILE = pngFile(`faktura-hruby-${STAMP}__faktura_dodavatel.png`, 7);
const ctxOpts = (mobile, dark) => (mobile
  ? { viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, locale: "cs-CZ", colorScheme: dark ? "dark" : "light" }
  : { viewport: { width: 1280, height: 860 }, locale: "cs-CZ", colorScheme: dark ? "dark" : "light" });

const browser = await launch();
const errors = [];
async function ctx(user, { mobile = false, dark = false } = {}) {
  const context = await browser.newContext(ctxOpts(mobile, dark));
  await context.addInitScript((d) => { try { localStorage.setItem("theme", d ? "dark" : "light"); } catch { /* */ } }, dark);
  const page = await context.newPage();
  page.on("pageerror", (e) => errors.push(`pageerror ${page.url()}: ${e.message}`));
  page.on("console", (m) => { if (m.type() === "error" && !/favicon|DevTools|hydrat/i.test(m.text())) errors.push(`console ${page.url()}: ${m.text().slice(0, 300)}`); });
  page.on("response", (r) => { if (r.status() >= 500) errors.push(`HTTP ${r.status()} ${r.url()}`); });
  await login(page, user);
  return { context, page };
}
async function snap(page, name) {
  await page.waitForTimeout(250);
  const file = path.join(SHOTS, `${name}.png`);
  await page.screenshot({ path: file, fullPage: true });
  return file;
}
async function noOverflow(page, where) {
  // dokument i hlavní posuvná oblast (main má overflow-y-auto → přetečení by se posouvalo uvnitř)
  const w = await page.evaluate(() => {
    const main = document.querySelector("main");
    return Math.max(document.documentElement.scrollWidth - window.innerWidth, main ? main.scrollWidth - main.clientWidth : 0);
  });
  expect(w <= 1, `${where}: vodorovné přetečení o ${w} px`);
}
/** goto, které snese přesměrování (zakázaná stránka → redirect přeruší původní navigaci). */
async function softGoto(page, url) {
  try {
    return await page.goto(url);
  } catch (e) {
    if (!/ERR_ABORTED|interrupted/i.test(String(e?.message ?? e))) throw e;
    await page.waitForLoadState("load").catch(() => {});
    return null;
  }
}
async function eventually(fn, timeout = 30_000) {
  const t0 = Date.now();
  let last;
  while (Date.now() - t0 < timeout) {
    last = await fn();
    if (last) return last;
    await new Promise((r) => setTimeout(r, 400));
  }
  return last;
}
const invoiceRow = () => sql(`select id || '|' || status || '|' || coalesce(supplier_id::text, '') || '|' || coalesce(payment_status, '') from supplier_invoices where supplier_key = '25874411' and number_norm = 'FA20260815' and duplicate_of_id is null`);

async function uploadAsWorker(page, shotName) {
  await page.goto(`${BASE}/supplier-invoices/upload`);
  await page.locator("main").getByTestId("invoice-uploader").waitFor({ timeout: 20_000 });
  await page.locator("main").getByTestId("invoice-file-input").setInputFiles(INVOICE_FILE);
  await page.locator("main").getByTestId("invoice-upload-submit").click();
  await page.locator("main").getByTestId("invoice-upload-done").waitFor({ timeout: 45_000 });
  const msg = (await page.locator("main").getByTestId("invoice-upload-message").textContent())?.trim();
  if (shotName) await snap(page, shotName);
  return msg;
}

let invoiceId = null;

await test("zaměstnanec (390 px): Zanést fakturu → „Faktura zapsána ✓“ s hlavičkou (31. 10.); seznam ani detail nevidí", async () => {
  const { context, page } = await ctx(USERS.dilna, { mobile: true });
  try {
    await page.goto(`${BASE}/supplier-invoices/upload`);
    await page.locator("main").getByTestId("invoice-uploader").waitFor({ timeout: 20_000 });
    await noOverflow(page, "upload 390");
    await snap(page, "01-worker-upload-mobile-light");
    const msg = await uploadAsWorker(page, "02-worker-thanks-mobile-light");
    expect(msg === RECORDED, `potvrzení: „${msg}“`);
    // 31. 10.: nahrávající vidí potvrzení s hlavičkou (dodavatel, číslo, částka, splatnost) — nic dalšího
    const body = await page.locator("main").getByTestId("invoice-upload-done").textContent();
    expect(/FA-2026-0815/.test(body ?? "") && /Hrubý/.test(body ?? "") && /38\s?115/.test(body ?? ""), `potvrzení bez hlavičky: ${body}`);
    expect((await page.locator("main").getByRole("link", { name: /Otevřít fakturu/ }).count()) === 0, "zaměstnanec má odkaz na fakturu");
    // seznam faktur a soubor faktury jsou pro zaměstnance zavřené
    const row = await eventually(() => invoiceRow());
    expect(row, "faktura v DB nevznikla");
    invoiceId = row.split("|")[0];
    const res = await softGoto(page, `${BASE}/supplier-invoices`);
    await page.waitForLoadState("networkidle").catch(() => {});
    expect(!/\/supplier-invoices$/.test(new URL(page.url()).pathname) || (res && res.status() >= 400) || (await page.locator("main").getByTestId("invoice-list").count()) === 0, "zaměstnanec otevřel seznam faktur");
    await softGoto(page, `${BASE}/supplier-invoices/${invoiceId}`);
    await page.waitForLoadState("networkidle").catch(() => {});
    expect((await page.locator("main").getByTestId("invoice-title").count()) === 0, "zaměstnanec otevřel detail faktury");
    const fileId = sql(`select id from supplier_invoice_files where invoice_id = ${lit(invoiceId)} limit 1`);
    const f = await page.request.get(`${BASE}/api/supplier-invoices/files/${fileId}`, { maxRedirects: 0 });
    expect(f.status() === 403, `soubor faktury pro zaměstnance: HTTP ${f.status()}`);
    // menu: „Nahrát fakturu" ano, „Faktury dodavatelů" ne
    await page.goto(`${BASE}/dashboard`);
    const html = await page.content();
    expect(!html.includes('href="/supplier-invoices"'), "zaměstnanec má v menu Faktury dodavatelů");
  } finally {
    await context.close();
  }
});

await test("AI přečetla fakturu: dodavatel Hrubý, 3 položky, návrhy (OV-2099-901 → zakázka A, doprava → režie), ke kontrole", async () => {
  expect(invoiceId, "chybí faktura z předchozího kroku");
  const row = await eventually(() => {
    const r = sql(`select status || '|' || coalesce(supplier_id::text, '') || '|' || (select count(*) from supplier_invoice_items where invoice_id = ${lit(invoiceId)}) from supplier_invoices where id = ${lit(invoiceId)}`);
    return r.startsWith("ke_kontrole|") ? r : null;
  }, 60_000);
  expect(row, `faktura se nezpracovala: ${sql(`select status from supplier_invoices where id = ${lit(invoiceId)}`)}`);
  const [, supplier, items] = row.split("|");
  expect(supplier === HRUBY, `dodavatel ${supplier}`);
  expect(items === "3", `položek ${items}`);
  const allocs = sql(`select a.target || ':' || coalesce(o.number, a.overhead_category) || ':' || a.amount::numeric(12,2) || ':' || a.ai_suggested || ':' || (a.confirmed_at is not null)
    from supplier_invoice_allocations a join supplier_invoice_items i on i.id = a.item_id left join orders o on o.id = a.job_id
    where a.invoice_id = ${lit(invoiceId)} order by i.position, a.amount desc`).split("\n").filter(Boolean);
  expect(allocs.includes(`job:${numA}:30000.00:true:false`), `návrh pro OV-2099-901: ${allocs.join(", ")}`);
  expect(allocs.includes("rezie:doprava:500.00:true:false"), `návrh dopravy: ${allocs.join(", ")}`);
  const queue = sql(`select count(*) from approval_queue where type::text = 'supplier_invoice' and payload->>'invoiceId' = ${lit(invoiceId)} and status = 'pending'`);
  expect(queue === "1", `fronta ke schválení: ${queue}`);
  // řádek fronty: krátký titulek kdo + číslo + částka (na mobilu čitelný), souhrn s částkou
  const qt = sql(`select title || '|' || summary from approval_queue where type::text = 'supplier_invoice' and payload->>'invoiceId' = ${lit(invoiceId)} and status = 'pending'`);
  expect(/^[^|]*Hrubý[^|]* · č\. FA-2026-0815 · 31\s500 Kč\|.*31\s500 Kč bez DPH/.test(qt), `fronta: ${qt}`);
  {
    const q = await ctx(USERS.admin, { mobile: true, dark: true });
    try {
      await q.page.goto(`${BASE}/dashboard`);
      const row = q.page.locator("main").getByText("č. FA-2026-0815", { exact: false }).first();
      await row.waitFor({ timeout: 20_000 });
      await row.scrollIntoViewIfNeeded();
      await noOverflow(q.page, "dashboard fronta 390");
      await snap(q.page, "15-queue-mobile-dark");
    } finally {
      await q.context.close();
    }
  }
  // druhé nahrání stejného souboru = žádná nová faktura
  const { context, page } = await ctx(USERS.dilna, { mobile: true, dark: true });
  try {
    const msg = await uploadAsWorker(page, "03-worker-thanks-mobile-dark");
    expect(/^Tahle faktura už je zapsaná \(.+\)\.$/.test(msg ?? ""), `podruhé: ${msg}`);
    const n = sql(`select count(*) from supplier_invoices where ${INVOICE_WHERE}`);
    expect(n === "1", `stejný soubor znovu → ${n} faktur`);
  } finally {
    await context.close();
  }
});

await test("super admin: seznam → detail → položku rozdělí 600 / 400 (dvě klepnutí), uloží a potvrdí, zaplaceno", async () => {
  const { context, page } = await ctx(USERS.admin);
  try {
    await page.goto(`${BASE}/supplier-invoices`);
    await page.locator("main").getByTestId("invoice-list").waitFor({ timeout: 20_000 });
    const card = page.locator("main").getByTestId("invoice-card").filter({ hasText: "FA-2026-0815" });
    await card.first().waitFor({ timeout: 10_000 });
    await page.locator("main").getByTestId("invoice-totals").waitFor();
    await snap(page, "10-list-desktop-light");
    await card.first().click();
    await page.locator("main").getByTestId("invoice-title").waitFor({ timeout: 20_000 });
    expect(/Ke kontrole/i.test(await page.locator("main").getByTestId("invoice-status").textContent()), "stav není Ke kontrole");
    const item = page.locator("main").getByTestId("invoice-item").filter({ hasText: "Kalení" });
    await item.waitFor();
    // případný návrh AI u této položky pryč — rozdělíme ručně
    while (await item.getByTestId("allocation-row").count()) {
      await item.getByTestId("allocation-row").first().locator('button[aria-label="Smazat řádek"]:visible').click();
    }
    // 1. klepnutí: „Na zakázku" = celá částka → zakázka A
    await item.getByTestId("item-split").click();
    const rows = item.getByTestId("allocation-row");
    await rows.first().getByTestId("job-picker-input").fill(numA);
    await rows.first().getByTestId("job-picker-option").filter({ hasText: numA }).first().click();
    // 2. klepnutí: „Rozdělit" → druhý řádek dopočítává zbytek; napíšu 600 → druhý 400
    await item.getByTestId("item-split").click();
    expect((await rows.count()) === 2, "po Rozdělit nejsou dva řádky");
    await rows.nth(0).getByTestId("allocation-amount").fill("600");
    const second = await rows.nth(1).getByTestId("allocation-amount").inputValue();
    expect(/^400(,00)?$/.test(second.replace(/\s/g, "")), `zbytek se nedopočítal: „${second}“`);
    await rows.nth(1).getByTestId("job-picker-input").fill(numB);
    await rows.nth(1).getByTestId("job-picker-option").filter({ hasText: numB }).first().click();
    expect(/rozděleno celé/.test(await item.getByTestId("item-remainder").textContent()), "položka není rozdělená celá");
    expect(/vše rozděleno/.test(await page.locator("main").getByTestId("invoice-unallocated").textContent()), "faktura není rozdělená celá");
    await snap(page, "11-detail-split-desktop-light");
    await page.locator("main").getByTestId("invoice-save").click();
    const done = await eventually(() => {
      const r = sql(`select status from supplier_invoices where id = ${lit(invoiceId)}`);
      return r === "zpracovano" ? r : null;
    }, 20_000);
    expect(done, `po uložení stav ${sql(`select status from supplier_invoices where id = ${lit(invoiceId)}`)}`);
    const pending = sql(`select count(*) from supplier_invoice_allocations where invoice_id = ${lit(invoiceId)} and confirmed_at is null`);
    expect(pending === "0", `nepotvrzené řádky: ${pending}`);
    const split = sql(`select string_agg(o.number || '=' || a.amount::numeric(12,2), ',' order by a.amount desc) from supplier_invoice_allocations a
      join supplier_invoice_items i on i.id = a.item_id join orders o on o.id = a.job_id where a.invoice_id = ${lit(invoiceId)} and i.text like 'Kalení%'`);
    expect(split === `${numA}=600.00,${numB}=400.00`, `rozdělení v DB: ${split}`);
    const queue = sql(`select status from approval_queue where type::text = 'supplier_invoice' and payload->>'invoiceId' = ${lit(invoiceId)}`);
    expect(queue !== "pending", `fronta zůstala čekat: ${queue}`);
    await page.locator("main").getByTestId("invoice-savebar").waitFor({ state: "detached", timeout: 10_000 });
    // zaplaceno (jen super admin)
    await page.locator("main").getByTestId("pay-zaplaceno").click();
    const paid = await eventually(() => (sql(`select payment_status from supplier_invoices where id = ${lit(invoiceId)}`) === "zaplaceno" ? true : null), 10_000);
    expect(paid, "zaplaceno se neuložilo");
    await page.locator("main").getByTestId("invoice-payment").filter({ hasText: /Zaplaceno/ }).waitFor({ timeout: 10_000 });
    await snap(page, "12-detail-done-desktop-light");
  } finally {
    await context.close();
  }
});

await test("zakázka A: Nákup ukazuje fakturu jako skutečný náklad (30 000 + 600, ne objednávku 2×)", async () => {
  const cost = sql(`select cost::numeric(12,2) || '|' || known from job_cost(${lit(jobA)})`);
  expect(cost === "30600.00|true", `job_cost A: ${cost}`);
  const costB = sql(`select cost::numeric(12,2) from job_cost(${lit(jobB)})`);
  expect(costB === "400.00", `job_cost B: ${costB}`);
  const { context, page } = await ctx(USERS.admin);
  try {
    await page.goto(`${BASE}/orders/${jobA}?tab=nakup`);
    const block = page.locator("main").getByTestId("job-supplier-invoices");
    await block.waitFor({ timeout: 25_000 });
    expect((await block.getByTestId("job-invoice-row").count()) === 2, "řádky faktur u zakázky A");
    const total = (await block.getByTestId("job-invoices-total").textContent()).replace(/\s/g, "");
    expect(/30600/.test(total), `součet u zakázky: ${total}`);
    await block.scrollIntoViewIfNeeded();
    await snap(page, "20-job-costs-desktop-light");
  } finally {
    await context.close();
  }
  // obchodník (vlastník zakázky) blok faktur nevidí (režim jen super admin)
  const s = await ctx(USERS.obchod);
  try {
    await s.page.goto(`${BASE}/orders/${jobA}?tab=nakup`);
    await s.page.waitForLoadState("networkidle");
    await s.page.waitForTimeout(800);
    expect((await s.page.locator("main").getByTestId("job-supplier-invoices").count()) === 0, "obchodník vidí faktury dodavatelů");
  } finally {
    await s.context.close();
  }
});

async function setVisibility(mode, shotName) {
  const { context, page } = await ctx(USERS.admin);
  try {
    await page.goto(`${BASE}/supplier-invoices`);
    const sw = page.locator("main").getByTestId("invoice-visibility");
    await sw.waitFor({ timeout: 20_000 });
    const btn = sw.getByRole("button", { name: mode === "all" ? /Všichni vidí faktury/ : /Jen super admin/ });
    await btn.click();
    await expectPressed(btn);
    const v = await eventually(() => (sql(`select value from integration_settings where key = 'supplier_invoices_visibility'`) === mode ? mode : null), 10_000);
    expect(v === mode, `přepínač viditelnosti neuložil ${mode}`);
    if (shotName) await snap(page, shotName);
  } finally {
    await context.close();
  }
}
async function expectPressed(btn) {
  const t0 = Date.now();
  while (Date.now() - t0 < 10_000) {
    if ((await btn.getAttribute("aria-pressed")) === "true") return;
    await new Promise((r) => setTimeout(r, 200));
  }
  throw new Error("přepínač se nepřepnul");
}

await test("režim „všichni vidí faktury“: obchodník vidí seznam i detail, zaplaceno nemění; zpět jen super admin", async () => {
  await setVisibility("all", "13-visibility-all-desktop-light");
  try {
    const { context, page } = await ctx(USERS.obchod);
    try {
      // nastavení drží server až 30 s v cache (stejně jako ostatní přepínače) → zkoušet do 40 s
      const card = page.locator("main").getByTestId("invoice-card").filter({ hasText: "FA-2026-0815" }).first();
      const seen = await eventually(async () => {
        await softGoto(page, `${BASE}/supplier-invoices`);
        return (await card.isVisible().catch(() => false)) || (await card.waitFor({ timeout: 2_000 }).then(() => true, () => false));
      }, 40_000);
      expect(seen, "obchodník v režimu „všichni“ nevidí seznam faktur");
      await snap(page, "14-sales-list-all-mode-desktop-light");
      await page.goto(`${BASE}/supplier-invoices/${invoiceId}`);
      await page.locator("main").getByTestId("invoice-title").waitFor({ timeout: 20_000 });
      expect((await page.locator("main").getByTestId("invoice-paid-card").count()) === 0, "obchodník vidí kartu Úhrada");
      expect((await page.locator("main").getByTestId("pay-zaplaceno").count()) === 0, "obchodník může měnit zaplaceno");
      // vidí, ale neupravuje (rozdělení mění náklady a provize zakázek ostatních) — jen super admin
      await page.locator("main").getByTestId("invoice-item").first().waitFor({ timeout: 10_000 });
      for (const id of ["item-split", "item-overhead", "invoice-savebar", "invoice-confirm-ai", "invoice-po-final"]) {
        const n = await page.locator("main").getByTestId(id).count();
        const off = id === "invoice-po-final" ? await page.locator("main").getByTestId(id).evaluateAll((els) => els.every((e) => e.disabled)) : n === 0;
        expect(off, `obchodník v režimu „všichni“ může upravovat (${id})`);
      }
      for (const label of ["Upravit položky", "Zamítnout", "Přečíst znovu (AI)"]) {
        expect((await page.locator("main").getByRole("button", { name: label }).count()) === 0, `obchodník má tlačítko ${label}`);
      }
      await snap(page, "14b-sales-detail-all-mode-desktop-light");
    } finally {
      await context.close();
    }
  } finally {
    await setVisibility("super_admin");
  }
  const { context, page } = await ctx(USERS.obchod);
  try {
    const hidden = await eventually(async () => {
      await softGoto(page, `${BASE}/supplier-invoices/${invoiceId}`);
      await page.waitForLoadState("networkidle").catch(() => {});
      return (await page.locator("main").getByTestId("invoice-title").count()) === 0;
    }, 40_000);
    expect(hidden, "po přepnutí zpět obchodník pořád vidí fakturu");
  } finally {
    await context.close();
  }
});

await test("Dodavatelé → Přiložit fakturu: AI z hlavičky založí dodavatele (E2E Kalírna Nová, IČO 27999990)", async () => {
  const { context, page } = await ctx(USERS.admin);
  try {
    await page.goto(`${BASE}/suppliers`);
    await page.locator("main").getByTestId("supplier-from-invoice").click();
    const dialog = page.getByRole("dialog");
    await dialog.getByTestId("invoice-uploader").waitFor({ timeout: 10_000 });
    // výchozí: faktura se uloží i do Faktur dodavatelů (kdo dialogem odevzdává fakturu, neztratí ji); tady jen dodavatel
    const keep = dialog.getByTestId("supplier-from-invoice-with-invoice");
    expect(await keep.isChecked(), "„Uložit i fakturu“ není výchozí");
    await keep.uncheck();
    await dialog.getByTestId("invoice-file-input").setInputFiles(pngFile(`kalirna-${STAMP}__faktura_dodavatel-g2.png`, 11));
    await snap(page, "30-supplier-from-invoice-desktop-light");
    await dialog.getByTestId("invoice-upload-submit").click();
    const done = dialog.getByTestId("supplier-from-invoice-done");
    await done.waitFor({ timeout: 45_000 });
    expect(/Založen nový dodavatel E2E Kalírna Nová/.test(await done.textContent()), `výsledek: ${await done.textContent()}`);
    await snap(page, "31-supplier-from-invoice-done-desktop-light");
    const sup = sql(`select name || '|' || coalesce(dic, '') from suppliers where ico = '27999990'`);
    expect(sup.startsWith("E2E Kalírna Nová"), `dodavatel v DB: ${sup}`);
    const inv = sql(`select count(*) from supplier_invoices where supplier_key = '27999990'`);
    expect(inv === "0", `bez zaškrtnutí vznikla faktura: ${inv}`);
  } finally {
    await context.close();
  }
});

await test("faktura v EUR bez kurzu: banner „Chybí kurz“, náklad zakázky neúplný; „Načíst kurz ČNB“ ho dopočítá", async () => {
  const num = `E2E-SINV-EUR-${STAMP}`;
  const id = sql(`insert into supplier_invoices (supplier_id, supplier_ico, supplier_name, number, currency, total_net, total_vat, total_gross, status, source, issue_date, taxable_date)
    values (${lit(HRUBY)}, '25874411', 'Kovoobrábění Hrubý s.r.o.', ${lit(num)}, 'EUR', 240, 50.4, 290.4, 'ke_kontrole', 'upload', '2026-10-20', '2026-10-20') returning id`).split("\n")[0].trim();
  const item = sql(`insert into supplier_invoice_items (invoice_id, position, text, amount) values (${lit(id)}, 0, 'Broušení hřídelí', 240) returning id`).split("\n")[0].trim();
  sql(`insert into supplier_invoice_allocations (invoice_id, item_id, target, job_id, amount, confirmed_at) values (${lit(id)}, ${lit(item)}, 'job', ${lit(jobB)}, 240, now())`);
  const before = sql(`select cost::numeric(12,2) || '|' || known from job_cost(${lit(jobB)})`);
  expect(before === "400.00|false", `job_cost B bez kurzu (nikdy 240 Kč): ${before}`);
  const { context, page } = await ctx(USERS.admin);
  try {
    await page.goto(`${BASE}/supplier-invoices/${id}`);
    const banner = page.locator("main").getByTestId("invoice-missing-rate");
    await banner.waitFor({ timeout: 20_000 });
    expect(/Chybí kurz EUR — doplň/.test(await banner.textContent()), "banner chybí kurz");
    await snap(page, "16-missing-rate-desktop-light");
    await page.goto(`${BASE}/orders/${jobB}?tab=nakup`);
    const block = page.locator("main").getByTestId("job-supplier-invoices");
    await block.waitFor({ timeout: 25_000 });
    expect(/chybí kurz — nepočítá se/.test(await block.textContent()), "blok zakázky neukazuje chybějící kurz");
    expect(/kurz EUR u faktury/.test(await page.locator("main").textContent()), "náklad zakázky neříká, že chybí kurz");
    await block.scrollIntoViewIfNeeded();
    await snap(page, "17-job-missing-rate-desktop-light");
    await page.goto(`${BASE}/supplier-invoices/${id}`);
    await page.locator("main").getByTestId("invoice-fill-rate").click();
    await banner.waitFor({ state: "detached", timeout: 20_000 });
    const after = sql(`select cost::numeric(12,2) || '|' || known from job_cost(${lit(jobB)})`);
    expect(after === "6280.00|true", `job_cost B s kurzem ČNB 24,5: ${after}`);
    expect(sql(`select status from supplier_invoices where id = ${lit(id)}`) === "zpracovano", "s kurzem není zpracovaná");
  } finally {
    await context.close();
    sql(`delete from supplier_invoices where id = ${lit(id)}`);
  }
});

await test("dílčí faktura na objednávku 30 000: náklad zůstane 30 000; „Faktura konečná“ → skutečnost 10 000 (i provize)", async () => {
  const job = mkJob("PO", "Příruby — dílčí faktura (E2E)");
  const po = sql(`insert into purchase_orders (job_id, supplier_id, number, status, total) values (${lit(job)}, ${lit(HRUBY)}, 'OV-2099-977', 'potvrzena', 30000) returning id`).split("\n")[0].trim();
  const inv = sql(`insert into supplier_invoices (supplier_id, supplier_ico, supplier_name, number, currency, total_net, total_vat, total_gross, status, source, issue_date)
    values (${lit(HRUBY)}, '25874411', 'Kovoobrábění Hrubý s.r.o.', ${lit(`E2E-SINV-PART-${STAMP}`)}, 'CZK', 10000, 2100, 12100, 'ke_kontrole', 'upload', '2026-10-25') returning id`).split("\n")[0].trim();
  const item = sql(`insert into supplier_invoice_items (invoice_id, position, text, amount) values (${lit(inv)}, 0, 'Soustružení — 1. část dle obj. OV-2099-977', 10000) returning id`).split("\n")[0].trim();
  sql(`insert into supplier_invoice_allocations (invoice_id, item_id, target, job_id, purchase_order_id, amount, confirmed_at) values (${lit(inv)}, ${lit(item)}, 'job', ${lit(job)}, ${lit(po)}, 10000, now())`);
  const cost = () => sql(`select cost::numeric(12,2) || '|' || known from job_cost(${lit(job)})`);
  const commission = () => sql(`select coalesce(cost::numeric(12,2)::text, '-') from commission_entries where order_id = ${lit(job)}`);
  try {
    expect(cost() === "30000.00|true", `dílčí faktura snížila náklad: ${cost()}`);
    expect(commission() === "30000.00", `provize počítá s nákladem ${commission()}`);
    for (const v of [{ tag: "mobile-dark", mobile: true, dark: true }, { tag: "desktop-light", mobile: false, dark: false }]) {
      const { context, page } = await ctx(USERS.admin, v);
      try {
        await page.goto(`${BASE}/supplier-invoices/${inv}`);
        const card = page.locator("main").getByTestId("invoice-po-invoicing");
        await card.waitFor({ timeout: 20_000 });
        expect(/dílčí — do nákladu zatím jde objednávka/.test(await card.textContent()), "karta neříká „dílčí“");
        await card.scrollIntoViewIfNeeded();
        if (v.mobile) await noOverflow(page, "karta objednávek 390");
        await snap(page, `18-po-partial-${v.tag}`);
        if (!v.mobile) {
          await card.getByTestId("invoice-po-final").click();
          await card.getByText("vyfakturováno celé — do nákladu jde faktura").waitFor({ timeout: 15_000 });
          expect(cost() === "10000.00|true", `konečná faktura: ${cost()}`);
          expect(commission() === "10000.00", `provize po konečné faktuře: ${commission()}`);
          await card.scrollIntoViewIfNeeded();
          await snap(page, "18-po-final-desktop-light");
          await page.goto(`${BASE}/orders/${job}?tab=nakup`);
          const block = page.locator("main").getByTestId("job-supplier-invoices");
          await block.waitFor({ timeout: 25_000 });
          expect(/\(celá\)/.test(await block.getByTestId("job-invoice-po").first().textContent()), "blok zakázky neukazuje celou objednávku");
          await block.scrollIntoViewIfNeeded();
          await snap(page, "18-po-final-job-desktop-light");
        }
      } finally {
        await context.close();
      }
    }
  } finally {
    sql(`delete from supplier_invoices where id = ${lit(inv)}`);
    sql(`delete from purchase_orders where id = ${lit(po)}`);
  }
});

await test("foto přeznačené na „Faktura — od dodavatele“ (390 px): formulář bez zakázky, „Uložit fakturu“ → Faktury dodavatelů", async () => {
  const { context, page } = await ctx(USERS.admin, { mobile: true });
  try {
    await page.goto(`${BASE}/orders`);
    await page.getByRole("button", { name: "Vyfotit doklad", exact: true }).first().click();
    await page.getByTestId("capture-files-input").setInputFiles(pngFile(`E2E-SINV-CAP-foto-${STAMP}.png`, 31));
    const read = page.getByTestId("capture-read");
    await eventually(async () => (await read.isEnabled().catch(() => false)) || null, 30_000);
    const [resp] = await Promise.all([
      page.waitForResponse((r) => r.url().includes("/api/jobs/capture/analyze"), { timeout: 90_000 }),
      read.click(),
    ]);
    const body = await resp.json().catch(() => ({}));
    expect(body.ok && body.model, `čtení: ${JSON.stringify(body).slice(0, 200)}`);
    await page.getByTestId("capture-save").waitFor({ timeout: 30_000 });
    expect(/Uložit do knihy/.test(await page.getByTestId("capture-save").innerText()), "objednávka má Uložit do knihy");
    await page.getByRole("button", { name: "Faktura — od dodavatele" }).click();
    await page.getByTestId("capture-invoice-note").waitFor({ timeout: 10_000 });
    const dlg = page.getByRole("dialog");
    expect((await dlg.getByText("Ke které zakázce?").count()) === 0, "u faktury dodavatele se ptá na zakázku");
    expect((await dlg.getByText("Doklad se přiloží k zakázce do Dokumentů.").count()) === 0, "u faktury dodavatele „přiloží k zakázce“");
    expect(/Uložit fakturu/.test(await page.getByTestId("capture-save").innerText()), "tlačítko není Uložit fakturu");
    await snap(page, "40-capture-chip-invoice-mobile-light");
    const [ap] = await Promise.all([
      page.waitForResponse((r) => r.url().includes("/api/jobs/capture/apply"), { timeout: 60_000 }),
      page.getByTestId("capture-save").click(),
    ]);
    const res = await ap.json().catch(() => ({}));
    expect(res.ok && res.supplierInvoice, `uložení: ${JSON.stringify(res).slice(0, 200)}`);
    await page.getByTestId("capture-result-headline").waitFor({ timeout: 30_000 });
    await snap(page, "41-capture-chip-invoice-done-mobile-light");
    const key = `single:${body.model.captureId}`;
    const row = await eventually(() => {
      const r = sql(`select status || '|' || coalesce(supplier_id::text, '') || '|' || (select string_agg(text, ' / ' order by position) from supplier_invoice_items i where i.invoice_id = s.id) from supplier_invoices s where capture_key = ${lit(key)}`);
      return r.startsWith("ke_kontrole|") ? r : null;
    }, 30_000);
    expect(row && row.includes(HRUBY) && /Výroba přírub/.test(row) && !/Upínka/.test(row), `faktura z přeznačeného fota: ${row}`);
  } finally {
    await context.close();
  }
});

await test("dávka u zakázky (Přidat doklad): objednávka k zakázce, faktura → Faktury dodavatelů; titulek to říká, návrh na tuto zakázku", async () => {
  const { context, page } = await ctx(USERS.admin);
  try {
    await page.goto(`${BASE}/orders/${jobA}`);
    await page.getByRole("button", { name: "Přidat doklad (foto)" }).first().click();
    await page.getByTestId("capture-files-input").setInputFiles([
      pngFile(`E2E-SINV-CAP-${STAMP}__objednavka_zakaznik.png`, 41), pngFile(`E2E-SINV-CAP-${STAMP}__faktura_dodavatel-g2.png`, 42),
    ]);
    const read = page.getByTestId("capture-read");
    await eventually(async () => (await read.isEnabled().catch(() => false)) || null, 30_000);
    await read.click();
    const cont = page.getByTestId("capture-sort-continue");
    await cont.waitFor({ timeout: 90_000 });
    await eventually(async () => (await cont.isEnabled().catch(() => false)) || null, 90_000);
    await cont.click();
    await page.getByTestId("capture-batch-summary").waitFor({ timeout: 120_000 });
    const save = page.getByTestId("capture-save");
    await eventually(async () => (await save.isEnabled().catch(() => false)) || null, 30_000);
    const [ap] = await Promise.all([
      page.waitForResponse((r) => r.url().includes("/api/jobs/capture/batch/apply"), { timeout: 120_000 }),
      save.click(),
    ]);
    const res = await ap.json().catch(() => ({}));
    expect(res.ok, `uložení dávky: ${JSON.stringify(res).slice(0, 300)}`);
    const head = (await page.getByTestId("capture-result-headline").textContent())?.trim() ?? "";
    expect(/1 faktura → Faktury dodavatelů/.test(head) && !/Uloženy 2 doklady/.test(head), `titulek: ${head}`);
    await snap(page, "42-batch-from-job-done-desktop-light");
    const inv = res.docs.find((d) => d.supplierInvoice);
    expect(inv?.supplierInvoiceId, "chybí odkaz na fakturu");
    const prop = await eventually(() => {
      const r = sql(`select coalesce(string_agg(coalesce(o.number, a.overhead_category) || ':' || a.ai_reason, ', '), '') from supplier_invoice_allocations a left join orders o on o.id = a.job_id where a.invoice_id = ${lit(inv.supplierInvoiceId)}`);
      return r || null;
    }, 30_000);
    expect(prop && prop.includes(`${numA}:doklad nahraný u zakázky ${numA}`), `návrh na zakázku, ze které se fotí: ${prop}`);
  } finally {
    await context.close();
  }
});

await test("screenshoty: seznam, detail, nákup zakázky, nahrání — desktop 1280 + mobil 390, světlý + tmavý", async () => {
  const variants = [
    { tag: "desktop-dark", mobile: false, dark: true },
    { tag: "mobile-light", mobile: true, dark: false },
    { tag: "mobile-dark", mobile: true, dark: true },
  ];
  for (const v of variants) {
    const { context, page } = await ctx(USERS.admin, v);
    try {
      await page.goto(`${BASE}/supplier-invoices`);
      await page.locator("main").getByTestId("invoice-card").first().waitFor({ timeout: 20_000 });
      if (v.mobile) {
        await noOverflow(page, `seznam ${v.tag}`);
        // filtry dodavatel / zakázka / období schované pod „Filtry" → první faktura bez posouvání
        const box = await page.locator("main").getByTestId("invoice-card").first().boundingBox();
        expect(box && box.y < 844 - 60, `první faktura pod ohybem (y=${box?.y})`);
        expect(await page.locator("main").getByTestId("invoice-filters-toggle").isVisible(), "chybí tlačítko Filtry");
        expect(!(await page.locator("main").getByRole("combobox", { name: "Dodavatel" }).isVisible()), "filtr dodavatele není schovaný");
        if (v.tag === "mobile-dark") {
          // klik bez scrollIntoView (Playwright by jinak posunul vodorovně lištu, která na 390 px přetéká — mimo faktury)
          await page.locator("main").getByTestId("invoice-filters-toggle").evaluate((e) => e.click());
          await page.locator("main").getByRole("combobox", { name: "Dodavatel" }).waitFor({ timeout: 5_000 });
          await snap(page, "10b-list-filters-open-mobile-dark");
          await page.locator("main").getByTestId("invoice-filters-toggle").evaluate((e) => e.click());
        }
      }
      await snap(page, `10-list-${v.tag}`);
      await page.goto(`${BASE}/supplier-invoices/${invoiceId}`);
      await page.locator("main").getByTestId("invoice-title").waitFor({ timeout: 20_000 });
      if (v.mobile) await noOverflow(page, `detail ${v.tag}`);
      await snap(page, `12-detail-done-${v.tag}`);
      await page.goto(`${BASE}/orders/${jobA}?tab=nakup`);
      await page.locator("main").getByTestId("job-supplier-invoices").waitFor({ timeout: 25_000 });
      await page.locator("main").getByTestId("job-supplier-invoices").scrollIntoViewIfNeeded();
      if (v.mobile) await noOverflow(page, `nákup ${v.tag}`);
      await snap(page, `20-job-costs-${v.tag}`);
      await page.goto(`${BASE}/supplier-invoices/upload`);
      await page.locator("main").getByTestId("invoice-uploader").waitFor({ timeout: 20_000 });
      await snap(page, `04-admin-upload-${v.tag}`);
    } finally {
      await context.close();
    }
  }
  // detail s rozdělenou položkou (neuložené rozdělení) na mobilu
  const { context, page } = await ctx(USERS.admin, { mobile: true });
  try {
    await page.goto(`${BASE}/supplier-invoices/${invoiceId}`);
    const item = page.locator("main").getByTestId("invoice-item").filter({ hasText: "Výroba přírub" });
    await item.waitFor({ timeout: 20_000 });
    await item.getByTestId("item-split").click();
    await item.getByTestId("allocation-row").nth(0).getByTestId("allocation-amount").fill("10 000");
    await item.getByTestId("allocation-row").nth(1).scrollIntoViewIfNeeded();
    const second = await item.getByTestId("allocation-row").nth(1).getByTestId("allocation-amount").inputValue();
    expect(/^20000(,00)?$/.test(second.replace(/\s/g, "")), `10 000 sem → zbytek ${second}`);
    await noOverflow(page, "detail rozdělení 390");
    await snap(page, "11-detail-split-mobile-light");
  } finally {
    await context.close();
  }
  const w = await ctx(USERS.dilna, { mobile: false, dark: true });
  try {
    await uploadAsWorker(w.page, "02-worker-thanks-desktop-dark");
  } finally {
    await w.context.close();
  }
  const d = await ctx(USERS.admin, { mobile: true, dark: true });
  try {
    await d.page.goto(`${BASE}/suppliers`);
    await d.page.locator("main").getByTestId("supplier-from-invoice").click();
    await d.page.getByRole("dialog").getByTestId("invoice-uploader").waitFor({ timeout: 10_000 });
    await noOverflow(d.page, "dodavatel z faktury 390");
    await snap(d.page, "30-supplier-from-invoice-mobile-dark");
  } finally {
    await d.context.close();
  }
});

await browser.close();
if (!process.env.SINV_KEEP) await cleanup();
summary(errors);
