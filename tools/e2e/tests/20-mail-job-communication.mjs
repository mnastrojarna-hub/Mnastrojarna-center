// E2E 20: Pošta B — komunikace k zakázce. Nabídka odeslaná z karty zakázky (Komunikace → Nová zpráva)
// → zákazník odpoví „prosím kalit, a 30 ks místo 20" → po stažení K zakázce, přiřazeno vláknem (✨ AI),
// složka „K zakázkám" seskupená po zakázkách, položka kalení + 30 ks s odznakem „nadřazeno výkresu",
// vrácení jedním ťuknutím, historie „Z e-mailu od …" + štítek z e-mailu; nejasný e-mail = „Patří k …?"
// a potvrzení jedním ťuknutím; zaměstnanec poštu zakázky nevidí; mobil bez vodorovného přetékání.
//
// Spuštění (aplikace musí znát testovací server a jeho CA — viz 12-mailbox-setup.mjs / 18-mail-inbox.mjs):
//   node tools/e2e/mail-test-server.mjs --dir .local-supabase/mail-test --base 25000 &
//   MAIL_TEST_PROVIDERS="$(cat .local-supabase/mail-test/providers.json)" NODE_EXTRA_CA_CERTS=.local-supabase/mail-test/ca.crt <spusť aplikaci>
//   E2E_BASE_URL=http://localhost:3600 [E2E_SHOTS=<adresář>] node tools/e2e/tests/20-mail-job-communication.mjs
import fs from "node:fs";
import path from "node:path";
import { BASE, USERS, launch, withContext, login, sql, test, expect, summary } from "../lib.mjs";

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), "../../..");
const SRV_DIR = process.env.MAIL_TEST_DIR ?? path.join(ROOT, ".local-supabase/mail-test");
const SRV = JSON.parse(fs.readFileSync(path.join(SRV_DIR, "server.json"), "utf8"));
const CTL = `http://127.0.0.1:${SRV.ports.control}`;
const SHOTS = process.env.E2E_SHOTS ?? null;
if (SHOTS) fs.mkdirSync(SHOTS, { recursive: true });

const BOX = "zakazky@nastrojarstvi.test";
const PASS = "Zakazky-Heslo-1";
const TAG = `e2e20${Date.now()}`;
const DOM = `strojmetal-${TAG}.test`;
const CUST_MAIL = `dvorak@${DOM}`;
const DN = `H-200-${TAG}`;

const browser = await launch();
const errors = [];
const T = (name, fn, opts) => test(name, () => withContext(browser, errors, fn, opts));
const q = (s) => s.replace(/'/g, "''");
/** insert … returning id (psql vypíše i „INSERT 0 1") */
const sqlId = (s) => sql(s).split("\n")[0].trim();
/** Viditelná kopie (streamovaná stránka s loading.tsx má chvíli i skrytou kopii obsahu). */
const vis = (page, id) => page.locator(`[data-testid="${id}"]:visible`).first();

const boxId = () => sql(`select id from mailboxes where email = '${BOX}'`);
// i zbytky dřívějších běhů (přerušený test) — všechny zakázky / zákazníci „e2e20…"
const jobsOf = () => sql(`select coalesce(string_agg(id::text, ','), '') from orders where title like '% e2e20%'`).split(",").filter(Boolean);
const cleanup = () => {
  for (const j of jobsOf()) {
    sql(`delete from job_mail_changes where job_id = '${j}'`);
    sql(`delete from email_job_suggestions where job_id = '${j}'`);
    sql(`update emails set order_id = null where order_id = '${j}'`);
    sql(`delete from job_files where job_id = '${j}'`);
    sql(`delete from drawings where job_id = '${j}'`);
    sql(`delete from orders where id = '${j}'`);
  }
  sql(`delete from email_job_suggestions where thread_id in (select thread_id from emails where mailbox_id in (select id from mailboxes where email = '${BOX}'))`);
  sql(`delete from email_shares where thread_id in (select thread_id from emails where mailbox_id in (select id from mailboxes where email = '${BOX}'))`);
  sql(`delete from emails where mailbox_id in (select id from mailboxes where email = '${BOX}')`);
  sql(`delete from mailboxes where email = '${BOX}'`);
  sql(`delete from customers where name like 'Strojmetal e2e20%'`);
};
cleanup();
const adminId = sql(`select id from profiles where email = '${USERS.admin.email}'`);
const ctl = async (p, opts) => (await fetch(`${CTL}${p}`, opts)).json();
const addMsg = (m) => ctl(`/message?user=${encodeURIComponent(BOX)}`, { method: "POST", body: JSON.stringify(m) });
// celý zdroj (podpis s vloženým logem posune přílohy za prvních 4000 znaků)
const sentRaw = async () => (await ctl("/sent?full=1")).map((s) => s.raw);
// režimy Pošty B = plná automatika (výchozí z migrace; nezávisle na ručních změnách v lokální DB)
sql(`insert into automation_settings (module, mode, enabled) values ('mail_job_link', 'full', true), ('mail_job_changes', 'full', true) on conflict (module) do update set mode = 'full', enabled = true`);

console.log(`20 · komunikace k zakázce (testovací server IMAP ${SRV.ports.imaps}, SMTP ${SRV.ports.smtps}, ovládání ${SRV.ports.control})`);

async function eventually(fn, what, timeout = 60_000) {
  const t0 = Date.now();
  for (;;) {
    if (await fn()) return;
    if (Date.now() - t0 > timeout) throw new Error(`Očekávání selhalo: ${what}`);
    await new Promise((r) => setTimeout(r, 500));
  }
}

const customerId = sqlId(`insert into customers (name, email, owner_id) values ('Strojmetal ${TAG}', 'nakup@${DOM}', '${adminId}') returning id`);
function newJob(title, drawing, qty) {
  const number = sql("select next_job_number()");
  const id = sqlId(`insert into orders (number, title, status, customer_id, owner_id, created_by, customer_contact, customer_contact_email)
    values ('${number}', '${q(title)} ${TAG}', 'nabidka', '${customerId}', '${adminId}', '${adminId}', 'Jan Dvořák', '${CUST_MAIL}') returning id`);
  const dr = sqlId(`insert into drawings (drawing_number, revision, customer_id, quantity, heat_status, surface_status, job_id)
    values ('${drawing}', 'A', '${customerId}', ${qty}, 'bez', 'bez', '${id}') returning id`);
  const item = sqlId(`insert into order_items (order_id, position, drawing_number, name, quantity, unit, material, heat_status, surface_status, drawing_id)
    values ('${id}', 0, '${drawing}', 'Hřídel', ${qty}, 'ks', '11 523', 'bez', 'bez', '${dr}') returning id`);
  return { id, number, item };
}

let job1;
let job2;

async function openInbox(page, folder = "inbox") {
  await page.goto(`${BASE}/inbox${folder === "inbox" ? "" : `?slozka=${folder}`}`);
  await page.getByTestId("mail-folders").first().waitFor();
  await page.waitForLoadState("networkidle");
}

async function syncNow(page) {
  await page.getByRole("button", { name: /Přijmout a odeslat/ }).click();
  await page.getByTestId("sync-msg").filter({ hasText: /Přijato|Staženo|nových|stahuji|nic nového/i }).first().waitFor({ timeout: 90_000 }).catch(() => undefined);
  await page.waitForLoadState("networkidle");
}

async function openThread(page, subject) {
  const row = page.getByTestId("thread-row").filter({ hasText: subject }).first();
  await row.waitFor({ timeout: 30_000 });
  await row.locator("button").first().click();
  await page.getByTestId("thread-view").filter({ hasText: subject }).last().waitFor({ timeout: 20_000 });
  await page.getByTestId("thread-message").first().waitFor({ timeout: 20_000 });
}

await T("schránka obchodníka v Můj účet (stará pošta se stáhne, nic se nepřiřadí)", async (context) => {
  const page = await context.newPage();
  await login(page, USERS.admin);
  await page.goto(`${BASE}/account#schranka`);
  await page.waitForLoadState("networkidle");
  const form = page.locator('[data-testid="my-mailbox-form"]:visible').first();
  await form.waitFor();
  await form.getByLabel("E-mail schránky").fill(BOX);
  await form.getByLabel("Heslo ke schránce").fill(PASS);
  await form.getByTestId("my-mailbox-connect").click();
  await page.getByTestId("my-mailbox-note").filter({ hasText: /Schránka připojena/ }).waitFor({ timeout: 120_000 });
  expect(sql(`select owner_id from mailboxes where email = '${BOX}'`) === adminId, "vlastník schránky = já");
  expect(sql(`select count(*) from emails where mailbox_id = '${boxId()}' and order_id is not null`) === "0", "stará pošta bez zakázky");
  job1 = newJob("Hřídel H-200", DN, 20);
  await page.close();
});

let quoteMid = "";
await T("Komunikace zakázky → Nová zpráva (na kontakt zakázky) → odpověď zákazníka „prosím kalit, a 30 ks místo 20“ → K zakázce, přiřazeno vláknem, položka přebita", async (context) => {
  const page = await context.newPage();
  await login(page, USERS.admin);
  await page.goto(`${BASE}/orders/${job1.id}?tab=komunikace`);
  await vis(page, "job-communication").waitFor({ timeout: 30_000 });
  await vis(page, "job-mail-empty").waitFor();
  await vis(page, "job-compose").click();
  const dlg = page.getByTestId("compose-dialog");
  await dlg.waitFor();
  await dlg.getByTestId("compose-from").filter({ hasText: BOX }).waitFor({ timeout: 20_000 });
  const chips = await dlg.getByTestId("recipient-chip").allInnerTexts();
  expect(chips.join(" ").includes(CUST_MAIL), `Komu = kontakt zakázky: ${chips}`);
  expect((await dlg.getByLabel("Předmět").inputValue()).startsWith(job1.number), "předmět s číslem zakázky");
  await dlg.getByLabel("Text zprávy").fill(`Dobrý den, posíláme nabídku na 20 ks ${DN}.`);
  const before = (await sentRaw()).length;
  await dlg.getByTestId("compose-send").click();
  await dlg.waitFor({ state: "detached", timeout: 60_000 });
  await eventually(async () => (await sentRaw()).length === before + 1, "SMTP přijal zprávu", 30_000);
  quoteMid = /^Message-ID: (<[^>]+>)/m.exec((await sentRaw()).at(-1))?.[1] ?? "";
  expect(sql(`select order_id from emails where message_id = '${quoteMid}'`) === job1.id, "odeslaná zpráva patří k zakázce");
  const subject = sql(`select subject from emails where message_id = '${quoteMid}'`);

  await new Promise((r) => setTimeout(r, 1100));
  await addMsg({
    subject: `Re: ${subject}`, from: `Jan Dvořák <${CUST_MAIL}>`, inReplyTo: quoteMid, references: quoteMid,
    body: `Dobrý den,\n\nnabídku ${TAG} akceptujeme, prosím kalit, a 30 ks místo 20.\n\nS pozdravem\nJan Dvořák\n\n> Dobrý den, posíláme nabídku na 20 ks ${DN}.`,
  });
  await openInbox(page);
  await syncNow(page);
  const reply = () => sql(`select coalesce(order_id::text, '') || '|' || category || '|' || coalesce(job_link_actor, '') from emails where mailbox_id = '${boxId()}' and subject = '${q(`Re: ${subject}`)}'`);
  await eventually(async () => reply() === `${job1.id}|k_zakazce|ai`, "odpověď přiřazena (K zakázce, AI)", 60_000).catch((e) => {
    throw new Error(`${e.message}: ${reply() || "(nestaženo)"} · ${sql(`select coalesce(string_agg(subject || ' / ' || coalesce(thread_id, '') || ' / ' || coalesce(in_reply_to, ''), ' ; '), '') from emails where mailbox_id = '${boxId()}' and received_at > now() - interval '10 minutes'`)}`);
  });
  expect(sql(`select quantity::int || '|' || heat_treatment from order_items where id = '${job1.item}'`) === "30|kalení", "položka: 30 ks + kalení");

  // složka K zakázkám: skupina zakázky + chip
  await page.getByTestId("folder-jobs").click();
  await page.getByTestId("job-group").filter({ hasText: job1.number }).first().waitFor({ timeout: 20_000 });
  await openThread(page, `Re: ${subject}`);
  const bar = page.getByTestId("job-link-bar").last();
  await bar.getByTestId("thread-job-open").filter({ hasText: job1.number }).waitFor();
  expect((await bar.getByTestId("thread-job-source").innerText()).includes("přiřazeno automaticky"), "zdroj přiřazení");
  await page.close();
});

await T("nejasný e-mail (dvě otevřené zakázky firmy) → „Patří k …?“ → Ano jedním ťuknutím", async (context) => {
  const page = await context.newPage();
  await login(page, USERS.admin);
  job2 = newJob("Příruba P-20", `P-20-${TAG}`, 5);
  await addMsg({ subject: `Dotaz ${TAG}`, from: `Jan Dvořák <${CUST_MAIL}>`, body: "Dobrý den, kdy to bude hotové?" });
  await addMsg({ subject: `Druhý dotaz ${TAG}`, from: `Jan Dvořák <${CUST_MAIL}>`, body: "A ještě: jaká bude cena dopravy?" });
  await openInbox(page, "jobs");
  await syncNow(page);
  await page.goto(`${BASE}/inbox?slozka=jobs`);
  await page.waitForLoadState("networkidle");
  const row = page.getByTestId("thread-row").filter({ hasText: `Dotaz ${TAG}` }).filter({ hasNotText: "Druhý" }).first();
  // stejně jisté zakázky firmy → návrh zakázky s nejčerstvější komunikací (job1 má poštu), ne nejvyššího čísla
  const want = job1;
  await row.getByTestId("row-suggestion").filter({ hasText: want.number }).waitFor({ timeout: 30_000 });
  await openThread(page, `Dotaz ${TAG}`);
  const sugg = page.getByTestId("thread-suggestion").last();
  await sugg.waitFor();
  const yes = sugg.getByTestId("thread-suggestion-yes");
  expect(await yes.isEnabled(), "Ano je aktivní");
  await yes.click();
  // živé obnovení vlákna může tlačítko vyměnit těsně před kliknutím → kliknout znovu, dokud návrh visí
  await eventually(async () => {
    if (sql(`select coalesce(order_id::text, '') from emails where mailbox_id = '${boxId()}' and subject = 'Dotaz ${TAG}'`) === want.id) return true;
    if ((await yes.count()) && (await yes.isVisible().catch(() => false)) && (await yes.isEnabled().catch(() => false))) await yes.click({ timeout: 2000 }).catch(() => undefined);
    return false;
  }, "přiřazeno k Z-… (ručně)", 30_000);
  await page.getByTestId("thread-job-open").filter({ hasText: want.number }).last().waitFor({ timeout: 20_000 });
  expect(sql(`select job_link_actor from emails where subject = 'Dotaz ${TAG}'`) === "user", "potvrdil člověk");
  await page.close();
});

await T("karta zakázky: Komunikace (vlákno + změny), Položky (odznak, vrácení), Historie (Z e-mailu + štítek)", async (context) => {
  const page = await context.newPage();
  await login(page, USERS.admin);
  await page.goto(`${BASE}/orders/${job1.id}?tab=komunikace`);
  await vis(page, "job-threads").waitFor({ timeout: 30_000 });
  expect((await vis(page, "job-threads").getByTestId("thread-row").count()) >= 1, "vlákno v Komunikaci");
  const changes = vis(page, "job-mail-changes");
  await changes.waitFor();
  expect((await changes.innerText()).includes("Tepelné zpracování: kalení"), "změna z e-mailu v Komunikaci");
  // návrh štítku → jedním ťuknutím
  await changes.getByTestId("mail-change").filter({ hasText: "Návrh štítku: kalení" }).getByTestId("change-apply").click();
  await eventually(async () => sql(`select array_to_string(tags, ',') from orders where id = '${job1.id}'`).includes("kalení"), "štítek z e-mailu", 20_000);
  // otevřít vlákno přímo z Komunikace
  await vis(page, "job-threads").getByTestId("thread-row").first().locator("button").first().click();
  await page.getByTestId("thread-view").waitFor({ timeout: 20_000 });
  await page.getByTestId("job-thread-back").click();

  // Položky: pokyn zákazníka nadřazený výkresu, vrátit počet
  await page.goto(`${BASE}/orders/${job1.id}?tab=polozky`);
  const panel = vis(page, "mail-overrides");
  await panel.waitFor({ timeout: 30_000 });
  const badge = await panel.getByTestId("override-badge").first().innerText();
  expect(/Pokyn zákazníka z e-mailu \d{1,2}\. \d{1,2}\. \d{4} — nadřazeno výkresu/.test(badge), `odznak: ${badge}`);
  expect((await panel.getByTestId("override-drawing").allInnerTexts()).includes("bez TZ"), "hodnota výkresu přeškrtnutá");
  await panel.locator('[data-testid="mail-override"][data-field="quantity"]').getByTestId("override-undo").click();
  await eventually(async () => sql(`select quantity::int from order_items where id = '${job1.item}'`) === "20", "vráceno na 20 ks", 20_000);
  await panel.locator('[data-testid="mail-override"][data-field="quantity"][data-status="undone"]').waitFor({ state: "detached", timeout: 20_000 }).catch(() => undefined);

  // Historie: „Z e-mailu od …" a štítek jako poznámka
  await page.goto(`${BASE}/orders/${job1.id}?tab=historie`);
  await vis(page, "history-mail-event").waitFor({ timeout: 30_000 });
  const hist = await page.locator("ol").last().innerText();
  expect(/Z e-mailu od Jan Dvořák: Tepelné zpracování: kalení/.test(hist), "historie: kalení z e-mailu");
  expect(/Vráceno: Počet kusů/.test(hist), "historie: vrácení");
  await vis(page, "history-note").waitFor();
  await page.close();
});

await T("zaměstnanec (bez schránky) poštu zakázky nevidí — ani ve složce K zakázkám", async (context) => {
  const page = await context.newPage();
  await login(page, USERS.dilna);
  await page.goto(`${BASE}/inbox?slozka=jobs`);
  await page.getByTestId("mail-folders").first().waitFor();
  await page.waitForLoadState("networkidle");
  expect(!(await page.content()).includes(`nabídku ${TAG}`), "cizí pošta není vidět");
  await page.goto(`${BASE}/orders/${job1.id}?tab=komunikace`);
  await vis(page, "job-communication").waitFor({ timeout: 30_000 });
  expect((await vis(page, "job-threads").count()) === 0, "bez vláken");
  expect(!(await page.content()).includes(`nabídku ${TAG}`), "bez citace e-mailu");
  await page.close();
});

await T("mobil 390 px: K zakázkám a Komunikace bez vodorovného přetékání", async (context) => {
  const page = await context.newPage();
  await login(page, USERS.admin);
  for (const url of [`${BASE}/inbox?slozka=jobs`, `${BASE}/orders/${job1.id}?tab=komunikace`]) {
    await page.goto(url);
    await page.waitForLoadState("networkidle");
    const over = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(over <= 1, `${url}: přetéká o ${over} px`);
  }
  await page.close();
}, { mobile: true });

// ── Screenshoty (1280 / 390 px, světlý / tmavý) ──
if (SHOTS) {
  await test("screenshoty Pošty B", async () => {
    // čekající návrh pro snímek vlákna s návrhem
    await addMsg({ subject: `Upřesnění ${TAG}`, from: `Jan Dvořák <${CUST_MAIL}>`, body: "Dobrý den, prosím ještě o informaci k termínu." });
    for (const [w, h] of [[1280, 900], [390, 844]]) {
      for (const theme of ["light", "dark"]) {
        const ctx = await browser.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: w < 500 ? 2 : 1, isMobile: w < 500, hasTouch: w < 500, locale: "cs-CZ", colorScheme: theme });
        await ctx.addInitScript((t) => { try { localStorage.setItem("theme", t); } catch {} }, theme);
        const page = await ctx.newPage();
        const name = (s) => path.join(SHOTS, `${s}-${w}-${theme}.png`);
        await login(page, USERS.admin);
        await openInbox(page, "jobs");
        if (w === 1280 && theme === "light") await syncNow(page);
        await page.goto(`${BASE}/inbox?slozka=jobs`);
        await page.getByTestId("job-group").first().waitFor({ timeout: 30_000 });
        await page.waitForTimeout(400);
        await page.screenshot({ path: name("posta-k-zakazkam") });
        await openThread(page, `nabídku ${TAG} akceptujeme`);
        await page.getByTestId("job-link-bar").last().scrollIntoViewIfNeeded();
        await page.screenshot({ path: name("vlakno-zakazka") });
        // „Změnit" → výběr zakázky: nahoře otevřené zakázky firmy odesílatele (review #16: odsazení, × mimo hledání)
        await page.getByTestId("thread-job-change").last().click();
        const picker = page.getByTestId("job-picker");
        await picker.getByTestId("job-picker-item").first().waitFor({ timeout: 20_000 });
        const firstItems = await picker.getByTestId("job-picker-item").allInnerTexts();
        expect(firstItems.length >= 2 && firstItems.slice(0, 2).every((t) => t.includes(`Strojmetal ${TAG}`)), `výběr: nahoře zakázky zákazníka (${firstItems.slice(0, 3).join(" | ")})`);
        await page.waitForTimeout(300);
        await page.screenshot({ path: name("vyber-zakazky") });
        await page.keyboard.press("Escape");
        await picker.waitFor({ state: "hidden", timeout: 10_000 });
        if (w < 500) await page.getByRole("button", { name: "Zpět na seznam" }).click().catch(() => undefined);
        await openThread(page, `Upřesnění ${TAG}`).catch(() => undefined);
        await page.getByTestId("thread-suggestion").last().scrollIntoViewIfNeeded().catch(() => undefined);
        await page.screenshot({ path: name("vlakno-navrh") });
        await page.goto(`${BASE}/orders/${job1.id}?tab=komunikace`);
        await vis(page, "job-communication").waitFor({ timeout: 30_000 });
        await vis(page, "job-communication").scrollIntoViewIfNeeded();
        await page.screenshot({ path: name("zakazka-komunikace"), fullPage: w < 500 });
        await page.goto(`${BASE}/orders/${job1.id}?tab=historie`);
        await vis(page, "history-mail-event").waitFor({ timeout: 30_000 });
        await vis(page, "history-mail-event").scrollIntoViewIfNeeded();
        await page.screenshot({ path: name("zakazka-historie"), fullPage: w < 500 });
        await page.goto(`${BASE}/orders/${job1.id}?tab=polozky`);
        await vis(page, "mail-overrides").waitFor({ timeout: 30_000 });
        await vis(page, "mail-overrides").scrollIntoViewIfNeeded();
        await page.screenshot({ path: name("polozka-pokyn-z-emailu"), fullPage: w < 500 });
        // režimy Pošty B v Ladění AI (review #10)
        await page.goto(`${BASE}/tuning`);
        const mode = page.getByText("Pokyny zákazníka z e-mailu do položek").first();
        await mode.waitFor({ timeout: 30_000 });
        await mode.scrollIntoViewIfNeeded();
        await page.screenshot({ path: name("rezimy-automatiky") });
        await ctx.close();
      }
    }
  });
}

await test("úklid", async () => {
  if (process.env.E2E_KEEP) return;
  cleanup();
  expect(sql(`select count(*) from mailboxes where email = '${BOX}'`) === "0", "schránka smazána");
});

await browser.close();
const ok = summary(errors);
process.exit(ok ? 0 : 1);
