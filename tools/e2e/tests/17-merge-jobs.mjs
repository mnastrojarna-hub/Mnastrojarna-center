// E2E: Sloučit zakázky (#24). Reprodukce duplicit z dávky focení: Z-…-013 (objednávka zákazníka
// 8000060875 / GPO84339 + výkres F00N603W84 + STEP EM72231CJ0000 + fotka) a Z-…-014 (jen naše odeslaná
// nabídka 136/026). Obchodník v detailu: „⋯" → „Sloučit s jinou zakázkou…" → návrh (stejný zákazník) →
// náhled (co se přesune, stav, přijetí nabídky) → Sloučit → cíl s bannerem; starý odkaz přesměruje.
// Screenshoty desktop 1280 + mobil 390, světlý + tmavý režim → MERGE_SHOTS.
//   E2E_BASE_URL=http://localhost:3500 MERGE_SHOTS=<adresář> node tools/e2e/tests/17-merge-jobs.mjs
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { BASE, USERS, expect, launch, login, sql, summary, test } from "../lib.mjs";

const SHOTS = process.env.MERGE_SHOTS || path.join(os.tmpdir(), "merge-shots");
fs.mkdirSync(SHOTS, { recursive: true });
const STAMP = Date.now().toString(36).toUpperCase();
const PREFIX = `Z-E2E-MERGE-${STAMP}`;
const lit = (v) => `'${String(v).replace(/'/g, "''")}'`;

function cleanup(prefix = "Z-E2E-MERGE-") {
  const ids = sql(`select id from orders where number like ${lit(`${prefix}%`)}`).split("\n").filter(Boolean);
  if (ids.length) {
    const inList = ids.map(lit).join(",");
    sql(`delete from job_merges where target_id in (${inList}) or source_id in (${inList})`);
    sql(`update orders set merged_into_id = null, quote_id = null where id in (${inList})`);
    sql(`delete from emails where order_id in (${inList})`);
    sql(`update job_files set quote_id = null where job_id in (${inList})`);
    sql(`delete from job_files where job_id in (${inList})`);
    sql(`delete from quote_items where quote_id in (select id from quotes where job_id in (${inList}))`);
    sql(`delete from quotes where job_id in (${inList})`);
    sql(`delete from commission_entries where order_id in (${inList})`);
    sql(`delete from orders where id in (${inList})`);
    sql(`delete from audit_log where entity_id in (${inList}) or diff->>'jobId' in (${inList})`);
  }
  sql(`delete from customers where name like 'E2E Bosch Merge %' and not exists (select 1 from orders o where o.customer_id = customers.id)`);
  return ids.length;
}
const left = cleanup();
if (left) console.log(`  (úklid po minulém běhu: ${left} zakázek)`);

const sales = sql(`select id from profiles where email = ${lit(USERS.obchod.email)}`);
let n = 0;

/** Dvojice duplicit jako z rozbité dávky: zákazník zapsaný dvakrát (stejné IČO, jiný název), výkres
 *  u nabídky s mezerami („F00N 603 W84"), obě zakázky ze stejného focení. */
function seedPair(tag) {
  n += 1;
  const cust = sql(`insert into customers (name, ico, owner_id) values (${lit(`E2E Bosch Merge ${STAMP} ${tag}`)}, '26345323', ${lit(sales)}) returning id`).split("\n")[0];
  const cust2 = sql(`insert into customers (name, ico, owner_id) values (${lit(`E2E Bosch Merge ${STAMP} ${tag} s.r.o.`)}, '26345323', ${lit(sales)}) returning id`).split("\n")[0];
  const cap = `e2e-merge-${STAMP.toLowerCase()}-${n}`;
  const orderNo = `${PREFIX}-${String(n * 2 - 1).padStart(3, "0")}`;
  const quoteNo = `${PREFIX}-${String(n * 2).padStart(3, "0")}`;
  const order = sql(`insert into orders (number, title, status, source, owner_id, created_by, customer_id, customer_order_number, customer_inquiry_number,
      order_date, customer_required_date, value, capture_key)
    values (${lit(orderNo)}, 'F00N603W84 — objednávka', 'objednavka', 'foto', ${lit(sales)}, ${lit(sales)}, ${lit(cust)}, '8000060875', 'GPO84339',
      current_date, current_date + 40, 48000, ${lit(`${cap}:g1`)}) returning id`).split("\n")[0];
  const quoteJob = sql(`insert into orders (number, title, status, source, owner_id, created_by, customer_id, inquiry_date, note, customer_contact, capture_key, value)
    values (${lit(quoteNo)}, 'Nabídka 136/026 — Těleso', 'poptavka', 'foto', ${lit(sales)}, ${lit(sales)}, ${lit(cust2)}, current_date - 20,
      'Termín z nabídky 6 týdnů.', 'Ing. Novák', ${lit(`${cap}:g2`)}, 75000) returning id`).split("\n")[0];
  sql(`insert into order_items (order_id, position, drawing_number, name, quantity, unit) values (${lit(order)}, 0, 'F00N603W84', 'Těleso', 40, 'ks')`);
  sql(`insert into order_items (order_id, position, drawing_number, name, quantity, unit, unit_price) values
      (${lit(quoteJob)}, 0, 'F00N 603 W84', 'Těleso', 50, 'ks', 1200), (${lit(quoteJob)}, 1, 'EM72231CJ0000', 'Víko', 50, 'ks', 300)`);
  const file = (job, kind, name, issuer, sha) => sql(`insert into job_files (job_id, kind, filename, title, storage_path, origin, issuer, content_sha256, mime_type)
      values (${lit(job)}, ${lit(kind)}, ${lit(name)}, ${lit(name)}, ${lit(`e2e-merge/${STAMP}/${tag}/${kind}-${name}`)}, 'capture', ${issuer ? lit(issuer) : "null"},
      ${lit(`${sha}-${STAMP}-${tag}`)}, 'application/pdf') returning id`).split("\n")[0];
  file(order, "objednavka", "8000060875.pdf", "zakaznik", "obj");
  file(order, "vykres", "F00N603W84.pdf", "zakaznik", "drw");
  file(order, "model_3d", "EM72231CJ0000.step", "zakaznik", "stp");
  file(order, "foto", "foto.jpg", null, "foto");
  const quoteFile = file(quoteJob, "nabidka", "136-026.pdf", "my", "nab");
  const quote = sql(`insert into quotes (number, customer_id, status, job_id, total, title, owner_id, lead_time_days)
      values (${lit(`136/026-${STAMP}-${tag}`)}, ${lit(cust2)}, 'odeslano', ${lit(quoteJob)}, 75000, 'Nabídka 136/026', ${lit(sales)}, 42) returning id`).split("\n")[0];
  sql(`update job_files set quote_id = ${lit(quote)} where id = ${lit(quoteFile)}`);
  return { order, quoteJob, orderNo, quoteNo, quote };
}

const CONFIGS = [
  { tag: "desktop-light", mobile: false, dark: false },
  { tag: "mobile-light", mobile: true, dark: false },
  { tag: "desktop-dark", mobile: false, dark: true },
  { tag: "mobile-dark", mobile: true, dark: true },
];
const browser = await launch();
const errors = [];

async function ctxFor(c) {
  const context = await browser.newContext(c.mobile
    ? { viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, locale: "cs-CZ", colorScheme: c.dark ? "dark" : "light" }
    : { viewport: { width: 1280, height: 860 }, locale: "cs-CZ", colorScheme: c.dark ? "dark" : "light" });
  await context.addInitScript((dark) => { try { localStorage.setItem("theme", dark ? "dark" : "light"); } catch { /* */ } }, c.dark);
  context.on("page", (p) => {
    p.on("pageerror", (e) => errors.push(`pageerror ${p.url()}: ${e.message}`));
    p.on("response", (r) => { if (r.status() >= 500) errors.push(`HTTP ${r.status()} ${r.url()}`); });
  });
  return context;
}
const shotPath = (name, c) => path.join(SHOTS, `${name}-${c.tag}.png`);

for (const c of CONFIGS) {
  const first = c.tag === "desktop-light";
  await test(`${c.tag}: ⋯ → Sloučit s jinou zakázkou… → návrh → náhled → sloučit → banner${first ? " + přesměrování" : ""}`, async () => {
    const pair = seedPair(c.tag);
    expect(sql(`select status from orders where id = ${lit(pair.quoteJob)}`) === "nabidka", "odeslaná nabídka posunula duplicitu do Nabídka odeslaná");
    const context = await ctxFor(c);
    const page = await context.newPage();
    try {
      await login(page, USERS.obchod);
      // jako v reálném případě: obchodník je na duplicitě s nabídkou (Z-014) a hledá dvojče s objednávkou
      await page.goto(`${BASE}/orders/${pair.quoteJob}`);
      await page.getByRole("button", { name: "Další akce" }).first().click();
      await page.getByRole("menuitem", { name: /Sloučit s jinou zakázkou/ }).click();
      const dialog = page.getByRole("dialog");
      await dialog.waitFor();
      const cand = dialog.getByTestId("merge-candidate").filter({ hasText: pair.orderNo }).first();
      await cand.waitFor({ timeout: 20_000 });
      // první návrh = dvojče: ze stejného focení, stejný výkres (jinak zapsaný), stejný zákazník (druhý záznam, stejné IČO)
      const firstCand = dialog.getByTestId("merge-candidate").first();
      expect((await firstCand.innerText()).includes(pair.orderNo), "dvojče je první návrh");
      const chips = await firstCand.getByTestId("merge-candidate-reasons").innerText();
      expect(/stejné focení/.test(chips) && /stejný výkres/.test(chips) && /stejný zákazník/.test(chips), `čipy důvodů: ${chips}`);
      await page.waitForTimeout(300);
      await page.screenshot({ path: shotPath("01-vyber", c) });

      // hledání podle čísla výkresu najde i jinak zapsaný výkres („F00N 603 W84" × „F00N603W84")
      await dialog.getByPlaceholder(/Číslo, zákazník/).fill("F00N 603W84");
      await dialog.getByTestId("merge-candidate").filter({ hasText: pair.orderNo }).first().waitFor({ timeout: 20_000 });
      expect(!(await dialog.getByText("Nic nenalezeno").count()), "hledání výkresu něco najde");
      await dialog.getByTestId("merge-candidate").filter({ hasText: pair.orderNo }).first().click();

      // druhá zakázka je dál (Objednávka) → dialog sám ponechá ji a řekne proč
      const target = dialog.getByTestId("merge-target");
      await page.waitForFunction((no) => document.querySelector("[data-testid=merge-target]")?.textContent?.includes(no), pair.orderNo, { timeout: 20_000 });
      expect((await target.innerText()).includes(pair.orderNo), "zůstane objednávka (automaticky prohozeno)");
      expect((await dialog.getByTestId("merge-source").innerText()).includes(pair.quoteNo), "sloučí se nabídka");
      expect(/Ponechám/.test(await dialog.getByTestId("merge-auto-swap").innerText()), "vysvětlení automatického prohození");
      const body = await dialog.innerText();
      expect(/1 nabídka/.test(body), "náhled: 1 nabídka");
      expect(/1 položka se stejným výkresem/.test(body), "náhled: položka se stejným výkresem se spojí");
      expect(/se označí jako přijatá/.test(body), "náhled: nabídka se přijme");
      expect(/Poznámka/.test(body) && /doplní se/.test(body), "náhled: poznámka se doplní");
      expect(/48\s000 Kč/.test(body) && !/48,000\.00/.test(body), "náhled: částka česky (48 000 Kč)");
      expect(/Název zakázky/.test(body), "náhled: název zakázky mezi hodnotami");
      expect(/Zákazník je zapsaný dvakrát/.test(body), "náhled: zákazník zapsaný dvakrát");
      await page.waitForTimeout(300);
      await page.screenshot({ path: shotPath("02-nahled", c) });
      if (c.mobile) {
        await dialog.getByText(/Hodnoty \(vyhrává/).scrollIntoViewIfNeeded();
        await page.screenshot({ path: shotPath("02b-nahled-hodnoty", c) });
      }

      // prohodit směr a zpět (náhled se přepočítá)
      await dialog.getByTestId("merge-swap").click();
      await page.waitForFunction((no) => document.querySelector("[data-testid=merge-target]")?.textContent?.includes(no), pair.quoteNo, { timeout: 20_000 });
      expect(/Tip: prohoď směr/.test(await dialog.innerText()), "obrácený směr: upozornění, že druhá zakázka je dál");
      await dialog.getByTestId("merge-swap").click();
      await page.waitForFunction((no) => document.querySelector("[data-testid=merge-target]")?.textContent?.includes(no), pair.orderNo, { timeout: 20_000 });

      await Promise.all([
        page.waitForURL((u) => u.pathname === `/orders/${pair.order}` && u.searchParams.get("slouceno") === pair.quoteNo, { timeout: 30_000 }),
        dialog.getByTestId("merge-confirm").click(),
      ]);
      const banner = page.getByTestId("merge-banner").locator("visible=true").first();
      await banner.waitFor({ timeout: 20_000 });
      expect((await banner.innerText()).includes(pair.quoteNo), "banner se zdrojem");
      await page.waitForTimeout(400);
      expect(await page.getByTestId("merge-banner").locator("visible=true").count() === 1, "právě jeden viditelný banner");
      expect((await banner.innerText()).includes("Zobrazit původní zakázku"), "banner: odkaz na původní zakázku");
      expect(/1 položka spojena/.test(await banner.innerText()), "banner: položka se stejným výkresem spojena (ne přesunuta)");
      await page.screenshot({ path: shotPath("03-po-slouceni", c) });

      // historie cíle: přesunuté záznamy říkají, odkud jsou
      await page.getByRole("tab", { name: /Historie/ }).first().click();
      const chip = page.getByTestId("event-merged-from").locator("visible=true").first();
      await chip.waitFor({ timeout: 15_000 });
      expect((await chip.innerText()).includes(pair.quoteNo), "historie: čip „ze Z-…“");
      await chip.scrollIntoViewIfNeeded();
      await page.waitForTimeout(200);
      await page.screenshot({ path: shotPath("03b-historie", c) });

      // DB: vše u cíle, zdroj uzavřený s odkazem, nabídka přijatá
      expect(sql(`select merged_into_id from orders where id = ${lit(pair.quoteJob)}`) === pair.order, "zdroj má odkaz na cíl");
      expect(sql(`select status || '|' || lost_reason from orders where id = ${lit(pair.quoteJob)}`) === "zruseno|duplicita", "zdroj: Zrušeno — duplicitní");
      expect(sql(`select status || '|' || job_id from quotes where id = ${lit(pair.quote)}`) === `prijato|${pair.order}`, "nabídka přijatá a u cíle");
      expect(sql(`select count(*) from job_files where job_id = ${lit(pair.order)}`) === "5", "5 dokumentů u cíle");
      expect(sql(`select items_count from orders where id = ${lit(pair.order)}`) === "2", "2 položky (shodný výkres spojen)");
      expect(sql(`select count(*) from job_events where job_id = ${lit(pair.order)} and message like 'Sloučeno ze zakázky ${pair.quoteNo} (Petr Obchodník)%'`) === "1",
        "historie cíle: Sloučeno ze zakázky … (Petr Obchodník)");

      if (first) {
        // starý odkaz na zdroj → cíl s bannerem
        await page.goto(`${BASE}/orders/${pair.quoteJob}`);
        await page.waitForURL((u) => u.pathname === `/orders/${pair.order}` && u.searchParams.get("presmerovano") === "1", { timeout: 30_000 });
        const b2 = page.getByTestId("merge-banner").locator("visible=true").first();
        await b2.waitFor({ timeout: 20_000 });
        expect(/byla sloučena sem/.test(await b2.innerText()), "banner po přesměrování");
        await page.screenshot({ path: shotPath("04-presmerovani", c) });
        // původní zakázka jde otevřít jen pro čtení (historie)
        await Promise.all([
          page.waitForURL((u) => u.pathname === `/orders/${pair.quoteJob}` && u.searchParams.get("historie") === "1", { timeout: 30_000 }),
          b2.getByRole("link", { name: /Zobrazit původní zakázku/ }).click(),
        ]);
        const sb = page.getByTestId("merged-source-banner").locator("visible=true").first();
        await sb.waitFor({ timeout: 20_000 });
        expect(/Jen pro čtení/.test(await sb.innerText()) && (await sb.innerText()).includes(pair.orderNo), "původní zakázka: jen pro čtení, odkaz na cíl");
        await page.screenshot({ path: shotPath("05-puvodni", c) });
        // Kniha zakázek sloučený zdroj nenabízí
        await page.goto(`${BASE}/orders?segment=vse&q=${encodeURIComponent(PREFIX)}`);
        await page.waitForLoadState("networkidle").catch(() => undefined);
        const text = await page.locator("main").innerText();
        expect(text.includes(pair.orderNo) && !text.includes(pair.quoteNo), "Kniha: cíl ano, sloučený zdroj ne");
      }
    } finally {
      await context.close();
    }
  });
}

await test("zaměstnanec v menu sloučení nemá", async () => {
  const pair = seedPair("worker");
  const context = await ctxFor(CONFIGS[0]);
  const page = await context.newPage();
  try {
    await login(page, USERS.dilna);
    await page.goto(`${BASE}/orders/${pair.order}`);
    await page.locator("h1, [aria-label=Zakázka]").first().waitFor({ timeout: 20_000 });
    const more = page.getByRole("button", { name: "Další akce" });
    if (await more.count()) {
      await more.first().click();
      expect(await page.getByRole("menuitem", { name: /Sloučit/ }).count() === 0, "bez položky Sloučit");
    }
  } finally {
    await context.close();
  }
});

await browser.close();
cleanup(PREFIX);
const ok = summary(errors);
console.log(`Screenshoty: ${SHOTS}`);
process.exit(ok ? 0 : 1);
