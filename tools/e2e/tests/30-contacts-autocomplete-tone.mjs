// E2E 30 · Kontakty (majitel 30. 10.): „kdekoliv zadávám mail musí mi to nabízet maily uložené v adresáři … případně
// z mailu z konverzací", „v kartě zákazníka budou maily pro faktury, … nabídky … a dle toho to musí reálně pak posílat",
// „ke každé osobě potřebuji nastavit tykání vykání … Volný si tyká s Pavel Novák z Bosch ale Šponer ne".
//  1. karta zákazníka: kontakt má jméno, pozici, telefon, e-mail; nový kontakt — e-mail z konverzace (našeptávač doplní
//     jméno); E-maily podle účelu: Fakturace = adresa, Nabídky = kontaktní osoba Pavel Novák;
//  2. okno psaní (A = obchodník): „nov" → Pavel Novák (firma, pozice, účel) → štítek, oslovení „Dobrý den, pane Nováku,";
//     návrh z dřívější pošty „Ahoj Pavle" → „Ano, tykáme" → „Ahoj Pavle,"; AI návrh odpovědi „Ahoj Pavle,";
//     B (super admin) stejnému kontaktu vyká → AI návrh „Dobrý den, pane Nováku,";
//  3. nabídka jde na e-mail pro nabídky (Pavel, s tykáním A), faktura na fakturační e-mail; v Kopii našeptávač
//     z konverzace; oba e-maily opravdu odejdou (mail catcher);
//  4. 390 px bez vodorovného přetékání.
//   E2E_BASE_URL=http://localhost:3600 [CONTACTS_SHOTS=<adresář>] node tools/e2e/tests/30-contacts-autocomplete-tone.mjs
// Vlastní data „E2E-30-" (zákazník, kontakty, zakázky, e-maily), na začátku i na konci se uklidí.
import fs from "node:fs";
import path from "node:path";
import { BASE, USERS, launch, withContext, login, shot, sql, test, expect, summary, recipients } from "../lib.mjs";
import { lit, userIds, eventually, waitHydrated, expectNoOverflow, waitMail, removeStorageFiles, createJob, createQuote } from "../lib-quotes-docs-flow.mjs";

const browser = await launch();
const errors = [];
const P = "E2E-30-";
const TAG = Date.now().toString(36).toLowerCase();
const ID = userIds();
const S = (name) => `contacts/${name}`;
const SHOTS = process.env.CONTACTS_SHOTS || null;
if (SHOTS) fs.mkdirSync(SHOTS, { recursive: true });
const DOM = `bosch-e2e30-${TAG}.test`;
const PAVEL = `pavel.novak@${DOM}`;
const EVA = `eva@${DOM}`;
const JANA = `jana.k@${DOM}`;
const FAKT = `faktury@${DOM}`;
const SUBJ = `E2E30-${TAG} Poptávka přírub`;
const norm = (s) => String(s ?? "").replace(/[  ]/g, " ").replace(/\s+/g, " ").trim();
const T = (name, fn, opts) => test(name, () => withContext(browser, errors, fn, opts));

console.log(`30 · Kontakty: našeptávač, e-maily podle účelu, tykání (značka ${TAG})`);

async function cleanup() {
  const jobs = sql(`select id from orders where title like ${lit(`${P}%`)}`).split("\n").filter(Boolean);
  if (jobs.length) {
    const inList = jobs.map(lit).join(",");
    const paths = sql(`select storage_path from job_files where job_id in (${inList})`).split("\n").filter(Boolean);
    await removeStorageFiles(paths);
    sql(`delete from documents where order_id in (${inList})`);
    sql(`delete from invoices where order_id in (${inList})`);
    sql(`delete from emails where order_id in (${inList})`);
    sql(`update job_files set replaced_by = null where job_id in (${inList})`);
    sql(`delete from quotes where job_id in (${inList})`);
    sql(`delete from orders where id in (${inList})`);
  }
  sql(`delete from emails where subject like '%E2E30-%'`);
  sql(`delete from contact_tone where email like '%@bosch-e2e30-%'`);
  sql(`delete from customers where name like ${lit(`${P}%`)}`);
  return jobs.length;
}
await cleanup();

// ── data ──
const CUST = sql(`insert into customers (name, country, owner_id, email, city, street, zip, ico, payment_terms_days)
  values (${lit(`${P}Bosch ${TAG} s.r.o.`)}, 'CZ', ${lit(ID.obchod)}, ${lit(`info@${DOM}`)}, 'Brno', 'Testovací 5', '602 00', '87654321', 30) returning id`).split("\n")[0];
sql(`insert into customer_contacts (customer_id, name, position, email, phone, is_primary) values
  (${lit(CUST)}, 'Pavel Novák', 'nákupčí', ${lit(PAVEL)}, '+420 777 300 300', true),
  (${lit(CUST)}, 'Eva Účetní', 'účetní', ${lit(EVA)}, '+420 777 300 301', false)`);
// konverzace: Pavel psal obchodníkovi (v kopii konstruktérka), obchodník mu dřív odpověděl tykáním
sql(`insert into emails (owner_id, direction, from_name, from_email, to_email, cc_email, subject, body_text, snippet, category, message_id, received_at, customer_id) values
  (${lit(ID.obchod)}, 'in', 'Pavel Novák', ${lit(PAVEL)}, 'obchod@local.test', ${lit(`Jana Konstruktérová <${JANA}>`)}, ${lit(SUBJ)},
   'Dobrý den, poptáváme 40 ks přírub DN50 dle výkresu. Termín do konce měsíce.', 'Dobrý den, poptáváme 40 ks přírub', 'poptavka', ${lit(`<${TAG}-in@e2e30>`)}, now() - interval '1 hour', ${lit(CUST)}),
  (${lit(ID.obchod)}, 'out', 'Petr Obchodník', 'obchod@local.test', ${lit(`Pavel Novák <${PAVEL}>`)}, null, ${lit(`Re: E2E30-${TAG} starší`)},
   'Ahoj Pavle,\nposílám ti výkres, dej vědět.\n\n> Dobrý den', 'Ahoj Pavle, posílám ti výkres', 'ostatni', ${lit(`<${TAG}-out@e2e30>`)}, now() - interval '20 days', ${lit(CUST)})`);
// nabídka (schválená) bez kontaktu zakázky → jde na e-mail pro nabídky; zakázka dodaná → faktura
const QJ = createJob({ title: `${P}Nabídka ${TAG}`, status: "nabidka", customerId: CUST, ownerId: ID.obchod, items: [{ name: "Příruba DN50", qty: 40, price: 600 }] });
const Q = createQuote(QJ, { number: `NAB-E2E30-${TAG}`, createdBy: ID.obchod, customerId: CUST, approvedBy: ID.admin, items: [{ name: "Příruba DN50", qty: 40, price: 600 }] });
const IJ = createJob({ title: `${P}Faktura ${TAG}`, status: "dodano_zakaznikovi", customerId: CUST, ownerId: ID.obchod, cpo: `PO-${TAG}`, items: [{ name: "Hřídel H7", qty: 4, price: 1000 }] });

const roleRows = () => sql(`select r.role || ':' || coalesce(r.email, k.email) || ':' || (case when r.is_default then 't' else 'f' end)
  from party_role_emails r left join customer_contacts k on k.id = r.contact_id where r.customer_id = ${lit(CUST)} order by r.role`).split("\n").filter(Boolean);
const tone = (userId) => sql(`select address from contact_tone where user_id = ${lit(userId)} and email = ${lit(PAVEL)}`);

async function snap(page, name) {
  if (!SHOTS) return;
  await page.waitForTimeout(300);
  await page.screenshot({ path: path.join(SHOTS, `${name}.png`), fullPage: false });
}
async function openCustomer(page) {
  await page.goto(`${BASE}/customers/${CUST}`);
  // streamovaná stránka má chvíli i skrytou kopii obsahu → viditelná + konec streamování
  await page.locator('[data-testid="role-emails"]:visible').first().waitFor({ timeout: 30_000 });
  await waitHydrated(page, '[data-testid="role-emails"] button');
}
async function openInbox(page) {
  await page.goto(`${BASE}/inbox`);
  await page.locator('[data-testid="mail-search"]:visible').first().waitFor({ timeout: 30_000 });
  await waitHydrated(page, '[data-testid="btn-compose"]');
}
async function openThread(page) {
  await page.locator('[data-testid="mail-search"]:visible').first().fill(`E2E30-${TAG}`);
  await page.waitForTimeout(700);
  await page.waitForLoadState("networkidle");
  const row = page.getByTestId("thread-row").filter({ hasText: "Poptávka přírub" }).first();
  await row.waitFor({ timeout: 30_000 });
  await row.locator("button").first().click();
  await page.getByTestId("thread-view").filter({ hasText: "Poptávka přírub" }).last().waitFor({ timeout: 20_000 });
}
const suggestion = (scope, email) => scope.locator(`[data-testid="recipient-suggestion"][data-email="${email}"]`).first();

// ═════════════ 1. Karta zákazníka ═════════════
await T("karta zákazníka: kontakt = jméno, pozice, telefon, e-mail; nový kontakt — e-mail z konverzace doplní jméno; Fakturace (adresa) a Nabídky (Pavel)", async (context) => {
  const page = await context.newPage();
  await login(page, USERS.obchod);
  await openCustomer(page);
  const pavel = page.locator('[data-testid="contact-card"]').filter({ hasText: "Pavel Novák" });
  const t = norm(await pavel.innerText());
  for (const s of ["Pavel Novák", "nákupčí", PAVEL, "+420 777 300 300", "Já a tento kontakt", "Vykáme"]) expect(t.includes(s), `karta Pavla obsahuje „${s}" (${t})`);
  expect((await pavel.locator('[data-testid="contact-tone"]').getAttribute("data-address")) === "vy", "výchozí vykání");

  // nový kontakt: e-mail z konverzace (kopie zprávy) → jméno se doplní samo
  await page.getByRole("button", { name: "Přidat kontaktní osobu" }).click();
  const form = page.getByRole("group", { name: "Nová kontaktní osoba" });
  const email = form.getByLabel("E-mail");
  await email.fill("jana.k");
  await suggestion(page, JANA).waitFor({ timeout: 15_000 });
  const sText = norm(await suggestion(page, JANA).innerText());
  expect(sText.includes("Jana Konstruktérová") && /v poště/.test(sText), `návrh z konverzace (${sText})`);
  await snap(page, "desktop-01-contact-email-suggest");
  await suggestion(page, JANA).click();
  expect((await email.inputValue()) === JANA, "e-mail vybraný z návrhu");
  expect((await form.getByLabel("Jméno").inputValue()) === "Jana Konstruktérová", "jméno doplněné z konverzace");
  await form.getByLabel("Pozice").fill("konstruktérka");
  await form.getByLabel("Telefon").fill("+420 777 300 302");
  await form.getByRole("button", { name: "Uložit kontakt" }).click();
  await eventually(() => expect(sql(`select name || '|' || position || '|' || phone from customer_contacts where customer_id = ${lit(CUST)} and email = ${lit(JANA)}`) === "Jana Konstruktérová|konstruktérka|+420 777 300 302", "kontakt uložen"));

  // Faktury = samotná adresa, Nabídky = kontaktní osoba Pavel
  const fakt = page.getByTestId("role-fakturace").first();
  await fakt.getByRole("button", { name: "Přidat e-mail: Faktury" }).click();
  await fakt.getByLabel("Nový e-mail: Faktury").fill(FAKT);
  await fakt.getByRole("button", { name: "Přidat", exact: true }).click();
  await eventually(() => expect(roleRows().includes(`fakturace:${FAKT}:t`), `Fakturace uložena (${roleRows()})`));
  const nab = page.getByTestId("role-nabidky").first();
  await nab.getByRole("button", { name: "Přidat e-mail: Nabídky" }).click();
  await nab.getByTestId("role-add-contact").filter({ hasText: "Pavel Novák" }).click();
  await eventually(() => expect(roleRows().includes(`nabidky:${PAVEL}:t`), `Nabídky = Pavel (${roleRows()})`));
  await nab.getByTestId("role-entry").filter({ hasText: "Pavel Novák" }).waitFor({ timeout: 15_000 });
  // štítek účelu u kontaktu
  await eventually(async () => expect(norm(await pavel.innerText()).includes("Nabídky"), "u Pavla štítek Nabídky"));
  await page.getByTestId("role-emails").first().scrollIntoViewIfNeeded();
  await snap(page, "desktop-02-customer-roles");
  await pavel.scrollIntoViewIfNeeded();
  await snap(page, "desktop-03-customer-contacts");
  await shot(page, S("01-customer-card"));
});

// ═════════════ 2. Okno psaní: našeptávač + tykání ═════════════
await T("A (obchodník): Nová zpráva — „nov“ → Pavel Novák (firma, pozice, účel) → oslovení „Dobrý den, pane Nováku,“; návrh z pošty → „Ano, tykáme“ → „Ahoj Pavle,“", async (context) => {
  const page = await context.newPage();
  await login(page, USERS.obchod);
  await openInbox(page);
  await page.getByTestId("btn-compose").first().click();
  const dlg = page.getByTestId("compose-dialog");
  await dlg.waitFor();
  const to = dlg.locator("#compose-to");
  await to.fill("nov");
  await suggestion(dlg, PAVEL).waitFor({ timeout: 15_000 });
  const sText = norm(await suggestion(dlg, PAVEL).innerText());
  expect(sText.includes("Pavel Novák") && sText.includes(`${P}Bosch`) && sText.includes("nákupčí") && sText.includes("Nabídky"), `návrh: jméno, firma, pozice, účel (${sText})`);
  await snap(page, "desktop-04-compose-suggestions");
  await to.press("Enter"); // první návrh (Pavel) — psaní + Enter
  await eventually(async () => expect((await recipients(dlg, "Komu")) === PAVEL, `Komu = Pavel (${await recipients(dlg, "Komu")})`));
  const chip = norm(await dlg.getByTestId("recipient-chip").first().innerText());
  expect(chip.includes("Pavel Novák"), `štítek se jménem (${chip})`);
  const body = dlg.getByLabel("Text zprávy");
  await eventually(async () => expect((await body.inputValue()).startsWith("Dobrý den, pane Nováku,"), `oslovení vykáním (${(await body.inputValue()).slice(0, 60)})`), { timeout: 20_000 });
  // AI návrh tónu z mé dřívější pošty → jedním klepnutím tykáme
  const sug = dlg.getByTestId("tone-suggestion");
  await sug.waitFor({ timeout: 15_000 });
  expect(norm(await sug.innerText()).includes("Ahoj Pavle"), "návrh: dřív „Ahoj Pavle“");
  await snap(page, "desktop-05-compose-tone-suggestion");
  await sug.getByRole("button", { name: "Ano, tykáme" }).click();
  await eventually(() => expect(tone(ID.obchod) === "ty", "A: tykání uloženo"));
  await eventually(async () => expect((await body.inputValue()).startsWith("Ahoj Pavle,"), `oslovení po přepnutí (${(await body.inputValue()).slice(0, 40)})`));
  expect((await dlg.getByTestId("tone-toggle").getAttribute("data-address")) === "ty", "přepínač: Tykáme");
  // přepnutí zpět a znovu (jedno klepnutí, uloží se)
  await dlg.getByTestId("tone-toggle").getByRole("button", { name: "Vykáme" }).click();
  await eventually(async () => expect((await body.inputValue()).startsWith("Dobrý den, pane Nováku,") && tone(ID.obchod) === "vy", "zpět na vykání"));
  await dlg.getByTestId("tone-toggle").getByRole("button", { name: "Tykáme" }).click();
  await eventually(async () => expect((await body.inputValue()).startsWith("Ahoj Pavle,") && tone(ID.obchod) === "ty", "znovu tykání"));
  await snap(page, "desktop-06-compose-tone-ty");
  await shot(page, S("02-compose-tone"));
  // vložení víc adres najednou
  const cc = dlg.getByRole("button", { name: /Kopie \/ skrytá kopie/ });
  await cc.click();
  await dlg.locator("#compose-cc").fill(`${EVA}; ${JANA}`);
  await dlg.locator("#compose-cc").press("Enter");
  await eventually(async () => expect((await recipients(dlg, "Kopie")) === `${EVA}, ${JANA}`, `Kopie = 2 adresy (${await recipients(dlg, "Kopie")})`));
  await page.keyboard.press("Escape");
});

await T("A: odpověď Pavlovi — AI návrh odpovědi začíná „Ahoj Pavle,“ (A tyká)", async (context) => {
  const page = await context.newPage();
  await login(page, USERS.obchod);
  await openInbox(page);
  await openThread(page);
  await page.getByTestId("btn-reply").first().click();
  const dlg = page.getByTestId("compose-dialog");
  await dlg.waitFor();
  await eventually(async () => expect((await recipients(dlg, "Komu")) === PAVEL, "Komu = Pavel"));
  await dlg.getByTestId("compose-ai-draft").click();
  const body = dlg.getByLabel("Text zprávy");
  await eventually(async () => expect((await body.inputValue()).startsWith("Ahoj Pavle,\n"), `AI návrh s tykáním (${(await body.inputValue()).slice(0, 80)})`), { timeout: 60_000 });
  expect(!/\bVám\b|\bVaši\b/.test((await body.inputValue()).split("\n-- ")[0].split("napsal")[0]), "návrh bez vykání");
  await snap(page, "desktop-07-reply-ai-draft-ty");
  await page.keyboard.press("Escape");
});

await T("B (super admin) vyká stejnému kontaktu — AI návrh „Dobrý den, pane Nováku,“; A zůstává tykání", async (context) => {
  const page = await context.newPage();
  await login(page, USERS.admin);
  await openInbox(page);
  await openThread(page);
  await page.getByTestId("btn-reply").first().click();
  const dlg = page.getByTestId("compose-dialog");
  await dlg.waitFor();
  await eventually(async () => expect((await recipients(dlg, "Komu")) === PAVEL, "Komu = Pavel"));
  const toggle = dlg.getByTestId("tone-toggle");
  await eventually(async () => expect((await toggle.getAttribute("data-address")) === "vy", "B: výchozí vykání"));
  expect(await dlg.getByTestId("tone-suggestion").count() === 0, "B nemá návrh (Pavlovi nikdy netykal)");
  await dlg.getByTestId("compose-ai-draft").click();
  const body = dlg.getByLabel("Text zprávy");
  await eventually(async () => expect((await body.inputValue()).startsWith("Dobrý den, pane Nováku,\n"), `AI návrh s vykáním (${(await body.inputValue()).slice(0, 80)})`), { timeout: 60_000 });
  expect(tone(ID.admin) === "" && tone(ID.obchod) === "ty", "B nic neuložil, A má dál tykání");
  await snap(page, "desktop-08-reply-ai-draft-vy");
  await page.keyboard.press("Escape");
});

// ═════════════ 3. Odeslání podle účelu ═════════════
await T("B (super admin): nabídka — Komu = Pavel (e-mail pro nabídky), text „Dobrý den, pane Nováku,“ (B vyká); jen otevřít", async (context) => {
  const page = await context.newPage();
  await login(page, USERS.admin);
  await page.goto(`${BASE}/orders/${QJ.id}?tab=nabidky`);
  await waitHydrated(page, 'main section[aria-label="Zakázka"] button[aria-label^="Stav zakázky:"]');
  const card = page.locator("main [role=tabpanel][data-state=active] article").filter({ hasText: Q.number }).first();
  await card.getByRole("button", { name: "Odeslat zákazníkovi" }).click();
  const dlg = page.getByRole("dialog").filter({ hasText: `Odeslat nabídku ${Q.number}` });
  await dlg.locator('a[href^="/api/jobs/files/"]').waitFor({ timeout: 45_000 });
  await eventually(async () => expect((await recipients(dlg, "Komu")) === PAVEL, "Komu = Pavel"), { timeout: 20_000 });
  await eventually(async () => expect((await dlg.getByLabel("Text e-mailu").inputValue()).startsWith("Dobrý den, pane Nováku,\n\nděkujeme za Vaši poptávku"), "text s vykáním B"), { timeout: 20_000 });
  await page.keyboard.press("Escape");
});

await T("nabídka: Komu = e-mail pro nabídky (Pavel, s důvodem), text „Ahoj Pavle,“; Kopie z našeptávače; e-mail odejde Pavlovi", async (context) => {
  const page = await context.newPage();
  await login(page, USERS.obchod);
  await page.goto(`${BASE}/orders/${QJ.id}?tab=nabidky`);
  await waitHydrated(page, 'main section[aria-label="Zakázka"] button[aria-label^="Stav zakázky:"]');
  const card = page.locator("main [role=tabpanel][data-state=active] article").filter({ hasText: Q.number }).first();
  await card.getByRole("button", { name: "Odeslat zákazníkovi" }).click();
  const dlg = page.getByRole("dialog").filter({ hasText: `Odeslat nabídku ${Q.number}` });
  await dlg.locator('a[href^="/api/jobs/files/"]').waitFor({ timeout: 45_000 });
  await eventually(async () => expect((await recipients(dlg, "Komu")) === PAVEL, `Komu = Pavel (${await recipients(dlg, "Komu")})`), { timeout: 20_000 });
  const reason = norm(await dlg.getByTestId("recipient-reason").innerText());
  expect(reason === "E-mail zákazníka pro nabídky (Pavel Novák)", `důvod adresy (${reason})`);
  const body = await dlg.getByLabel("Text e-mailu").inputValue();
  expect(body.startsWith("Ahoj Pavle,\n\ndíky za tvou poptávku"), `text s tykáním A (${body.slice(0, 80)})`);
  // Kopie: našeptávač s adresami zákazníka zakázky (fakturační s účelem)
  const ccInput = dlg.locator("#quote-mail-cc");
  await ccInput.fill("fakt");
  await suggestion(dlg, FAKT).waitFor({ timeout: 15_000 });
  expect(norm(await suggestion(dlg, FAKT).innerText()).includes("Faktury"), "návrh nese účel Faktury");
  await snap(page, "desktop-09-quote-send");
  await suggestion(dlg, FAKT).click();
  await eventually(async () => expect((await recipients(dlg, "Kopie")) === FAKT, "Kopie = fakturační"));
  const t0 = new Date().toISOString();
  await dlg.getByRole("button", { name: "Odeslat zákazníkovi" }).click();
  const mail = await waitMail(PAVEL, (m) => m.receivedAt > t0 && String(m.subject).includes(Q.number), 45_000);
  expect(mail, "nabídka odešla Pavlovi");
  expect(String(mail.text ?? "").startsWith("Ahoj Pavle,"), `odeslaný text začíná „Ahoj Pavle,“ (${String(mail.text ?? "").slice(0, 40)})`);
  expect(await waitMail(FAKT, (m) => m.receivedAt > t0 && String(m.subject).includes(Q.number), 15_000), "kopie na fakturační e-mail");
  await shot(page, S("03-quote-sent"));
});


await T("faktura: Komu = fakturační e-mail (důvod „Fakturační e-mail zákazníka“), Kopie z konverzace; „Vystavit a odeslat“ → mail na fakturaci", async (context) => {
  const page = await context.newPage();
  await login(page, USERS.obchod);
  await page.goto(`${BASE}/orders/${IJ.id}?tab=vyroba`);
  await waitHydrated(page, 'main section[aria-label="Zakázka"] button[aria-label^="Stav zakázky:"]');
  await page.locator('main section[aria-label="Zakázka"]').getByRole("button", { name: "Vystavit fakturu", exact: true }).click();
  const dlg = page.getByRole("dialog").filter({ hasText: "Vystavit fakturu" });
  await dlg.locator('[data-testid="send-pending-attachment"]').waitFor({ timeout: 45_000 });
  await eventually(async () => expect((await recipients(dlg, "Komu")) === FAKT, `Komu = fakturace (${await recipients(dlg, "Komu")})`), { timeout: 20_000 });
  const reason = norm(await dlg.getByTestId("recipient-reason").innerText());
  expect(reason.startsWith("Fakturační e-mail zákazníka"), `důvod (${reason})`);
  // kopie: adresa z konverzace
  const ccInput = dlg.locator("#doc-mail-cc");
  await ccInput.fill("jana");
  await suggestion(dlg, JANA).waitFor({ timeout: 15_000 });
  await suggestion(dlg, JANA).click();
  await eventually(async () => expect((await recipients(dlg, "Kopie")) === JANA, "Kopie = Jana"));
  await snap(page, "desktop-10-invoice-send");
  const t0 = new Date().toISOString();
  await dlg.getByRole("button", { name: "Vystavit a odeslat" }).click();
  const mail = await waitMail(FAKT, (m) => m.receivedAt > t0 && /Faktura/.test(String(m.subject)), 60_000);
  expect(mail && (mail.attachments ?? []).filter((a) => a.contentType === "application/pdf" && /^Faktura_/.test(a.filename)).length === 1, `faktura odešla na fakturační e-mail s PDF (${JSON.stringify(mail?.attachments ?? null)})`);
  expect(await waitMail(JANA, (m) => m.receivedAt > t0 && /Faktura/.test(String(m.subject)), 15_000), "kopie Janě");
  expect(String(mail.text ?? "").startsWith("Dobrý den,"), "fakturační adresa bez jména → „Dobrý den,“");
  await shot(page, S("04-invoice-sent"));
});

// ═════════════ 4. Mobil 390 px ═════════════
await T("390 px: karta zákazníka (kontakty, účely) a okno psaní s návrhy bez vodorovného přetékání", async (context) => {
  const page = await context.newPage();
  await login(page, USERS.obchod);
  await openCustomer(page);
  await expectNoOverflow(page, "karta zákazníka 390");
  await page.locator('[data-testid="contact-card"]').filter({ hasText: "Pavel Novák" }).scrollIntoViewIfNeeded();
  const pavel = page.locator('[data-testid="contact-card"]').filter({ hasText: "Pavel Novák" });
  await eventually(async () => expect((await pavel.locator('[data-testid="contact-tone"]').getAttribute("data-address")) === "ty", "390: A tyká Pavlovi"));
  await snap(page, "mobile-01-customer-contacts");
  await page.getByTestId("role-emails").first().scrollIntoViewIfNeeded();
  await snap(page, "mobile-02-customer-roles");
  await openInbox(page);
  await page.getByTestId("btn-compose").first().click();
  const dlg = page.getByTestId("compose-dialog");
  await dlg.waitFor();
  await dlg.locator("#compose-to").fill("pav");
  await suggestion(dlg, PAVEL).waitFor({ timeout: 15_000 });
  await expectNoOverflow(page, "okno psaní 390");
  await snap(page, "mobile-03-compose-suggestions");
  await suggestion(dlg, PAVEL).tap();
  const body = dlg.getByLabel("Text zprávy");
  await eventually(async () => expect((await body.inputValue()).startsWith("Ahoj Pavle,"), "390: oslovení A"), { timeout: 20_000 });
  await snap(page, "mobile-04-compose-tone");
  await expectNoOverflow(page, "okno psaní 390 se štítkem");
}, { mobile: true });

const cleaned = await cleanup();
console.log(`  (úklid: ${cleaned} zakázek)`);
await browser.close();
process.exit(summary(errors) ? 0 : 1);
