// E2E 46 · Pošta → speciální stav zakázky (majitel 9. 11.: „Stejně by to mělo tyto stavy umět přečíst z pošty
// a automaticky přiřadit k zakázkám" + „samozřejmě s korekcí"). Režim „se schválením" (výchozí), bez AI (pravidla).
//  1. Reklamace: e-mail zákazníka „reklamujeme … nesedí rozměry" přiřazený k dodané zakázce → ve vlákně návrh
//     „Přepnout zakázku do Reklamace" → zakázka v Reklamaci → „Vrátit" ve vlákně → zpět Dodáno (AI se učí).
//  2. Pozastavení: „pozastavte prosím výrobu" → fronta „AI akce ke schválení" na Přehledu → Upravit… důvod →
//     Pozastavit → historie zakázky: událost s odkazem na e-mail a „Vrátit" → zpět Ve výrobě.
//   E2E_BASE_URL=http://localhost:3930 node tools/e2e/tests/46-mail-stage-signal.mjs
// Vlastní data „E2E-46-" (zákazník, zakázky, e-maily bez schránky), na konci se uklidí.
import { BASE, USERS, launch, withContext, login, sql, test, expect, summary } from "../lib.mjs";

const browser = await launch();
const errors = [];
const T = (name, fn, opts) => test(name, () => withContext(browser, errors, fn, opts));
const P = "E2E-46-";
const TAG = Date.now().toString(36);
const DOM = `e2e46-${TAG}.test`;
const lit = (s) => `'${String(s).replace(/'/g, "''")}'`;
const one = (q) => sql(q).split("\n")[0].trim();

function cleanup() {
  const jobs = sql(`select id from orders where title like ${lit(`${P}%`)}`).split("\n").filter(Boolean);
  if (jobs.length) {
    const inList = jobs.map(lit).join(",");
    sql(`delete from approval_queue where order_id in (${inList})`);
    sql(`delete from job_mail_stage_signals where job_id in (${inList})`);
    sql(`delete from job_mail_changes where job_id in (${inList})`);
    sql(`delete from email_job_suggestions where job_id in (${inList})`);
    sql(`update emails set order_id = null where order_id in (${inList})`);
    sql(`delete from orders where id in (${inList})`);
  }
  sql(`delete from emails where from_email like '%@e2e46-%'`);
  sql(`delete from ai_corrections where agent_key = 'mail_stage' and context like '%${P}%'`);
  sql(`delete from customers where name like ${lit(`${P}%`)} and not exists (select 1 from orders o where o.customer_id = customers.id)`);
}
cleanup();
sql(`insert into automation_settings (module, mode) values ('mail_job_stage', 'approval') on conflict (module) do update set mode = 'approval', enabled = true`);

const OWNER = one(`select id from profiles where email = ${lit(USERS.obchod?.email ?? USERS.admin.email)}`);
const CUST = one(`insert into customers (name, country, owner_id, email) values (${lit(`${P}Strojírny ${TAG}`)}, 'CZ', ${lit(OWNER)}, ${lit(`nakup@${DOM}`)}) returning id`);

let seq = 0;
function job(stage) {
  seq += 1;
  const number = `Z-E2E46-${TAG}-${seq}`;
  const id = one(`insert into orders (number, title, status, source, owner_id, created_by, customer_id, inquiry_date, customer_order_number, order_date)
    values (${lit(number)}, ${lit(`${P}Zakázka ${seq}`)}, 'poptavka', 'manual', ${lit(OWNER)}, ${lit(OWNER)}, ${lit(CUST)}, app_today() - 10, ${lit(`PO-${TAG}-${seq}`)}, app_today() - 5) returning id`);
  sql(`insert into order_items (order_id, position, drawing_number, name, quantity, unit) values (${lit(id)}, 0, 'F0N603W88', 'Příruba', 10, 'ks')`);
  sql(`update orders set status = ${lit(stage)} where id = ${lit(id)}`);
  return { id, number };
}
/** Příchozí e-mail zákazníka (bez schránky = pošta firemního účtu, vidí ji super admin), zatím bez zakázky. */
function mail(subject, body) {
  return one(`insert into emails (direction, from_email, from_name, customer_id, category, subject, body_text, snippet, received_at, message_id, is_read)
    values ('in', ${lit(`jan@${DOM}`)}, 'Jan Dvořák', ${lit(CUST)}, 'ostatni', ${lit(subject)}, ${lit(body)}, ${lit(body.slice(0, 120))}, now(), ${lit(`<${TAG}-${Math.random().toString(36).slice(2)}@${DOM}>`)}, false) returning id`);
}
const stage = (j) => one(`select status from orders where id = ${lit(j.id)}`);
async function until(fn, what, ms = 20_000) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (fn()) return;
    await new Promise((r) => setTimeout(r, 400));
  }
  expect(false, what);
}

async function openThread(page, subject) {
  await page.goto(`${BASE}/inbox?slozka=all`);
  const row = page.getByTestId("thread-row").filter({ hasText: subject }).first();
  await row.waitFor({ timeout: 30_000 });
  await row.locator("button").first().click();
  await page.getByTestId("thread-view").filter({ hasText: subject }).last().waitFor({ timeout: 20_000 });
}
/** „Přiřadit k zakázce" ve vlákně → výběr zakázky podle čísla. */
async function assign(page, number) {
  const view = page.getByTestId("thread-view").last();
  const direct = view.locator('[data-action="job.assign"]');
  if (await direct.count()) await direct.first().click();
  else {
    await view.getByTestId("mail-actions-more").first().click();
    await page.getByTestId("mail-action-job.assign").first().click();
  }
  const picker = page.getByTestId("job-picker");
  await picker.waitFor({ timeout: 10_000 });
  await picker.getByTestId("job-picker-search").fill(number);
  await picker.getByTestId("job-picker-item").filter({ hasText: number }).first().click();
  await picker.waitFor({ state: "hidden", timeout: 10_000 });
}

const subjA = `Reklamace dodávky ${TAG}`;
const subjB = `Pozastavení ${TAG}`;
const A = job("dodano_zakaznikovi");
const B = job("ve_vyrobe");
const mA = mail(subjA, "Dobrý den,\nreklamujeme díly z poslední dodávky — nesedí rozměry dle výkresu, průměr 20h7 je mimo toleranci.\n\nS pozdravem\nJan Dvořák");
const mB = mail(subjB, "Dobrý den,\npozastavte prosím výrobu, čekáme na novou revizi výkresu od konstrukce.\n\nDěkuji, Jan Dvořák");
console.log(`46 · Pošta → speciální stav zakázky (značka ${TAG})`);

await T("reklamace z e-mailu: návrh ve vlákně → Přepnout zakázku do Reklamace → Vrátit", async (context) => {
  const page = await context.newPage();
  await login(page, USERS.admin);
  await openThread(page, subjA);
  await assign(page, A.number);
  const pending = page.locator('[data-testid="mail-stage-pending"]:visible').first();
  await pending.waitFor({ timeout: 30_000 });
  expect((await pending.getAttribute("data-kind")) === "reklamace", "návrh = reklamace");
  expect(stage(A) === "dodano_zakaznikovi", "zakázka zatím beze změny (režim se schválením)");
  expect(one(`select count(*) from approval_queue where order_id = ${lit(A.id)} and type = 'job_stage' and status = 'pending'`) === "1", "položka fronty ke schválení");
  const btn = pending.getByTestId("mail-stage-confirm");
  expect(/Přepnout zakázku do Reklamace/.test(await btn.innerText()), "tlačítko „Přepnout zakázku do Reklamace“");
  await btn.click();
  await until(() => stage(A) === "reklamace", "zakázka v Reklamaci");
  expect(one(`select claim_reason from orders where id = ${lit(A.id)}`) === "rozmery", "druh reklamace = rozměry");
  expect(one(`select status from approval_queue where order_id = ${lit(A.id)} and type = 'job_stage'`) === "approved", "fronta vyřízená");
  const applied = page.locator('[data-testid="mail-stage-applied"]:visible').first();
  await applied.waitFor({ timeout: 20_000 });
  await applied.getByTestId("mail-stage-undo").click();
  await until(() => stage(A) === "dodano_zakaznikovi", "Vrátit → zpět Dodáno zákazníkovi");
  expect(one(`select count(*) from job_events where job_id = ${lit(A.id)} and data->>'note' like 'Korekce: přepnutí z pošty chybně — vráceno na%'`) === "1", "historie: jedna korekce");
  expect(Number(one(`select count(*) from ai_corrections where agent_key = 'mail_stage' and context like '%${A.number}%'`)) >= 1, "korekce uložená pro učení AI");
});

await T("pozastavení: fronta na Přehledu → Upravit… → Pozastavit; historie zakázky → Vrátit", async (context) => {
  const page = await context.newPage();
  await login(page, USERS.admin);
  await openThread(page, subjB);
  await assign(page, B.number);
  await page.locator('[data-testid="mail-stage-pending"]:visible').first().waitFor({ timeout: 30_000 });
  await page.goto(`${BASE}/dashboard`);
  const row = page.getByTestId("approval-job-stage").filter({ hasText: B.number }).first();
  await row.waitFor({ timeout: 30_000 });
  expect((await row.innerText()).includes(`naznačuje pozastavení zakázky ${B.number}`), "titulek návrhu");
  await row.getByTestId("mail-stage-pending").waitFor({ timeout: 20_000 });
  await row.getByTestId("mail-stage-edit").click();
  await row.getByTestId("stage-choice-reason").fill("Čeká na novou revizi výkresu (konstrukce)");
  await row.getByTestId("mail-stage-confirm").click();
  await until(() => stage(B) === "pozastaveno", "zakázka pozastavená");
  expect(one(`select hold_reason from orders where id = ${lit(B.id)}`) === "Čeká na novou revizi výkresu (konstrukce)", "důvod upravený ve frontě");
  await page.goto(`${BASE}/orders/${B.id}?tab=historie`);
  const ev = page.locator('[data-testid="history-mail-stage-event"]:visible').first();
  await ev.waitFor({ timeout: 30_000 });
  const link = ev.getByTestId("history-mail-stage-email");
  expect((await link.getAttribute("href"))?.includes("/inbox?vlakno="), "odkaz na e-mail");
  await ev.getByTestId("mail-stage-undo").click();
  await until(() => stage(B) === "ve_vyrobe", "Vrátit z historie → zpět Ve výrobě");
  expect(one(`select status from job_mail_stage_signals where job_id = ${lit(B.id)}`) === "undone", "signál vrácený");
});

void mA;
void mB;
await test("úklid", async () => {
  if (process.env.E2E_KEEP) return;
  cleanup();
});
await browser.close();
summary(errors);
