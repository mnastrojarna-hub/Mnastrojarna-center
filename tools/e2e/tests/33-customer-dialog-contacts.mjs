// E2E 33 · Kontakty a „Kam posílat" přímo v dialogu zákazníka (majitel 31. 10.: „Pořád nemůžu přidat více kontaktů
// a mailů pro určité případy, jako jsou faktury, DL, komunikace a tak." — v okně „Upravit zákazníka" byl jen jeden
// kontakt a vzory polí vypadaly jako data).
//  1. karta zákazníka → Upravit: tři kontaktní osoby (jméno, pozice, e-mail, telefon, ★ hlavní) a „Kam posílat":
//     Faktury = A, Dodací listy = B, Běžná komunikace = C → Uložit změny → DB (jedna transakce, audit);
//     znovu otevřít → vše načtené; žádné vzory, které vypadají jako data;
//  2. faktura jde na A (důvod „Fakturační e-mail zákazníka (A)"), mail opravdu odejde;
//  3. dodací list jde na B (důvod „E-mail pro dodací listy (B)") — i když zakázka má kontaktní osobu; mail odejde;
//  4. 390 px: dialog bez vodorovného přetékání, přidání osoby a účelu funguje.
//   E2E_BASE_URL=http://localhost:3600 [CUSTDLG_SHOTS=<adresář>] node tools/e2e/tests/33-customer-dialog-contacts.mjs
// Vlastní data „E2E-33-" (zákazník, zakázky, e-maily), na začátku i na konci se uklidí.
import fs from "node:fs";
import path from "node:path";
import { BASE, USERS, launch, withContext, login, shot, sql, test, expect, summary, recipients } from "../lib.mjs";
import { lit, userIds, eventually, waitHydrated, expectNoOverflow, waitMail, removeStorageFiles, createJob } from "../lib-quotes-docs-flow.mjs";

const browser = await launch();
const errors = [];
const P = "E2E-33-";
const TAG = Date.now().toString(36).toLowerCase();
const ID = userIds();
const S = (name) => `customer-dialog/${name}`;
const SHOTS = process.env.CUSTDLG_SHOTS || null;
if (SHOTS) fs.mkdirSync(SHOTS, { recursive: true });
const DOM = `kovo-e2e33-${TAG}.test`;
const A = { name: "Alena Účetní", position: "účetní", email: `alena@${DOM}`, phone: "+420 777 330 001" };
const B = { name: "Bohumil Skladník", position: "příjem zboží", email: `sklad@${DOM}`, phone: "+420 777 330 002" };
const C = { name: "Cyril Nákupčí", position: "nákupčí", email: `cyril@${DOM}`, phone: "+420 777 330 003" };
const JOB_CONTACT = `vedouci@${DOM}`;
const norm = (s) => String(s ?? "").replace(/[  ]/g, " ").replace(/\s+/g, " ").trim();
const T = (name, fn, opts) => test(name, () => withContext(browser, errors, fn, opts));
const FAKE = /@|\+420|\d{3}|s\.r\.o|a\.s\.|\.cz\b|Hala|Brno|Praha|Nov[aá]k/;

console.log(`33 · Dialog zákazníka: kontakty a Kam posílat (značka ${TAG})`);

async function cleanup() {
  const jobs = sql(`select id from orders where title like ${lit(`${P}%`)}`).split("\n").filter(Boolean);
  if (jobs.length) {
    const inList = jobs.map(lit).join(",");
    const paths = sql(`select storage_path from job_files where job_id in (${inList})`).split("\n").filter(Boolean);
    await removeStorageFiles(paths);
    sql(`delete from delivery_notes where order_id in (${inList})`);
    sql(`delete from documents where order_id in (${inList})`);
    sql(`delete from invoices where order_id in (${inList})`);
    sql(`delete from emails where order_id in (${inList})`);
    sql(`update job_files set replaced_by = null where job_id in (${inList})`);
    sql(`delete from orders where id in (${inList})`);
    sql(`delete from audit_log where diff->>'jobId' in (${inList})`);
  }
  sql(`delete from contact_tone where email like '%@kovo-e2e33-%'`);
  sql(`delete from customers where name like ${lit(`${P}%`)}`);
  return jobs.length;
}
await cleanup();

// ── data: zákazník jen s e-mailem firmy (bez kontaktů a účelů), zakázka k fakturaci a zakázka k dodání ──
const CUST = sql(`insert into customers (name, country, owner_id, email, city, street, zip, ico, payment_terms_days)
  values (${lit(`${P}Kovo ${TAG} s.r.o.`)}, 'CZ', ${lit(ID.obchod)}, ${lit(`info@${DOM}`)}, 'Brno', 'Testovací 33', '602 00', '87654333', 14) returning id`).split("\n")[0];
const IJ = createJob({ title: `${P}Faktura ${TAG}`, status: "dodano_zakaznikovi", customerId: CUST, ownerId: ID.obchod, cpo: `PO-${TAG}`, items: [{ name: "Hřídel H7", qty: 4, price: 1000 }] });
// zakázka „Dodáno k nám" s kontaktní osobou zakázky — DL má přesto jít na Dodací listy
const DLJ = (() => {
  const number = `Z-E2E33-${TAG}`;
  const id = sql(`insert into orders (number, title, status, source, owner_id, assignee_id, created_by, customer_id, customer_order_number, order_date, priority, order_status, order_revision, customer_contact, customer_contact_email)
    values (${lit(number)}, ${lit(`${P}Dodání ${TAG}`)}, 'potvrzeno', 'manual', ${lit(ID.obchod)}, ${lit(ID.dilna)}, ${lit(ID.obchod)}, ${lit(CUST)}, ${lit(`PO-${TAG}-2`)}, current_date, 'stredni', 'potvrzena', 1, 'Vedoucí Výroby', ${lit(JOB_CONTACT)})
    returning id`).split("\n")[0];
  sql(`insert into order_items (order_id, position, drawing_number, name, material, quantity, unit, unit_price) values
    (${lit(id)}, 0, ${lit(`VK-${TAG}-A`)}, 'Příruba', '11 523', 10, 'ks', 123.45)`);
  sql(`update orders set status = 'dodano_k_nam' where id = ${lit(id)}`);
  return { id, number };
})();

const roleRows = () => sql(`select r.role || ':' || coalesce(k.email, r.email) || ':' || (case when r.is_default then 't' else 'f' end)
  from party_role_emails r left join customer_contacts k on k.id = r.contact_id where r.customer_id = ${lit(CUST)} order by 1`).split("\n").filter(Boolean);
const contactRows = () => sql(`select name || '|' || coalesce(position, '') || '|' || coalesce(email, '') || '|' || coalesce(phone, '') || '|' || is_primary
  from customer_contacts where customer_id = ${lit(CUST)} order by name`).split("\n").filter(Boolean);

async function snap(page, name, opts = {}) {
  if (!SHOTS) return;
  await page.waitForTimeout(300);
  await page.screenshot({ path: path.join(SHOTS, `${name}.png`), fullPage: false, ...opts });
}

async function openDialog(page) {
  await page.goto(`${BASE}/customers/${CUST}`);
  await page.locator('[data-testid="role-emails"]:visible').first().waitFor({ timeout: 30_000 });
  await waitHydrated(page, '[data-testid="role-emails"] button');
  await page.getByRole("button", { name: "Upravit", exact: true }).first().click();
  const dlg = page.getByTestId("customer-dialog");
  await dlg.waitFor({ timeout: 15_000 });
  // adresář se načte při otevření
  await dlg.getByLabel("1. kontakt — jméno").waitFor({ timeout: 20_000 });
  return dlg;
}

async function fillContact(dlg, n, c) {
  await dlg.getByLabel(`${n}. kontakt — jméno`).fill(c.name);
  await dlg.getByLabel(`${n}. kontakt — pozice`).fill(c.position);
  await dlg.getByLabel(`${n}. kontakt — e-mail`).fill(c.email);
  await dlg.getByLabel(`${n}. kontakt — telefon`).fill(c.phone); // přechod do dalšího pole zavře našeptávač
}

async function assignRole(dlg, role, label, person) {
  const box = dlg.getByTestId(`role-${role}`);
  await box.getByRole("button", { name: `Přidat e-mail: ${label}` }).click();
  await box.getByTestId("role-add-contact").filter({ hasText: person.name }).click();
  await box.getByTestId("role-entry").filter({ hasText: person.name }).waitFor({ timeout: 10_000 });
  // formulář přidání (zůstal otevřený pro další osobu) zavřít
  const cancel = box.getByRole("button", { name: "Zrušit" });
  if (await cancel.count()) await cancel.click();
}

/** Obsah dialogu se vejde na šířku (posuvná oblast nemá vodorovný přesah — dlouhé e-maily se zkrátí). */
async function expectDialogFits(dlg, where) {
  const m = await dlg.locator("form > div").first().evaluate((el) => ({ sw: el.scrollWidth, cw: el.clientWidth }));
  expect(m.sw <= m.cw + 1, `${where}: obsah dialogu bez vodorovného přesahu (${m.sw} > ${m.cw})`);
}

async function placeholdersOf(scope) {
  return scope.locator("input[placeholder], textarea[placeholder]").evaluateAll((els) => els.map((e) => e.getAttribute("placeholder")).filter(Boolean));
}

// ═════════════ 1. Dialog: tři osoby + Kam posílat ═════════════
await T("Upravit zákazníka: 3 kontaktní osoby + Faktury = A, Dodací listy = B, Běžná komunikace = C → Uložit → DB; znovu otevřít = načteno; vzory jen nápověda", async (context) => {
  const page = await context.newPage();
  await login(page, USERS.obchod);
  const dlg = await openDialog(page);
  const text = norm(await dlg.innerText());
  expect(!text.includes("Další kontaktní osoby přidáš na kartě zákazníka"), "žádné odkazování na kartu");
  for (const s of ["Kontaktní osoby", "Kam posílat", "Faktury", "Dodací listy", "Nabídky", "Objednávky / potvrzení", "Běžná komunikace"]) {
    expect(text.includes(s), `dialog obsahuje „${s}"`);
  }
  const ph = await placeholdersOf(dlg);
  const fake = ph.filter((p) => FAKE.test(p));
  expect(fake.length === 0, `žádné vzory, které vypadají jako data (${JSON.stringify(fake)})`);
  expect(ph.includes("web") && ph.includes("adresa skladu, jen když se liší od sídla"), `neutrální nápovědy (${JSON.stringify(ph)})`);
  const italic = await dlg.getByLabel("Web").evaluate((el) => getComputedStyle(el, "::placeholder").fontStyle);
  expect(italic === "italic", `nápověda kurzívou (${italic})`);

  await fillContact(dlg, 1, A);
  await dlg.getByRole("button", { name: "Přidat kontaktní osobu" }).click();
  await fillContact(dlg, 2, B);
  await dlg.getByRole("button", { name: "Přidat kontaktní osobu" }).click();
  await fillContact(dlg, 3, C);
  // první osoba je hlavní (★)
  expect((await dlg.getByRole("button", { name: `${A.name}: hlavní kontakt` }).getAttribute("aria-pressed")) === "true", "A = hlavní kontakt");
  await snap(page, "desktop-01-contacts");

  await assignRole(dlg, "fakturace", "Faktury", A);
  await assignRole(dlg, "dodaci_listy", "Dodací listy", B);
  await assignRole(dlg, "komunikace", "Běžná komunikace", C);
  // u osoby je vidět, k čemu se používá
  const rowB = dlg.getByTestId("party-contact").filter({ has: page.getByLabel("2. kontakt — jméno") });
  expect(norm(await rowB.innerText()).includes("Dodací listy"), "u Bohumila štítek Dodací listy");
  expect(roleRows().length === 0, "nic se neuložilo před Uložit");
  await expectDialogFits(dlg, "desktop");
  await dlg.getByTestId("role-emails").scrollIntoViewIfNeeded();
  await snap(page, "desktop-02-kam-posilat");
  await shot(page, S("01-dialog-filled"));

  await dlg.getByRole("button", { name: "Uložit změny" }).click();
  await dlg.waitFor({ state: "hidden", timeout: 20_000 });
  await eventually(() => expect(JSON.stringify(roleRows()) === JSON.stringify([`dodaci_listy:${B.email}:t`, `fakturace:${A.email}:t`, `komunikace:${C.email}:t`]), `účely uložené (${roleRows()})`));
  const cr = contactRows();
  expect(JSON.stringify(cr) === JSON.stringify([
    `${A.name}|${A.position}|${A.email}|${A.phone}|true`, `${B.name}|${B.position}|${B.email}|${B.phone}|false`, `${C.name}|${C.position}|${C.email}|${C.phone}|false`,
  ]), `kontakty uložené (${cr})`);
  expect(sql(`select count(*) from audit_log where action = 'party_book_saved' and entity_id = ${lit(CUST)}`) === "1", "audit: party_book_saved");
  expect(sql(`select count(*) from customer_contacts where customer_id = ${lit(CUST)} and created_by = ${lit(ID.obchod)}`) === "3", "kdo kontakty založil (created_by)");
  expect(sql(`select contact_person from customers where id = ${lit(CUST)}`) === A.name, "Kontaktní osoba firmy = hlavní kontakt");

  // karta: panely ukazují totéž
  await eventually(async () => expect(norm(await page.locator('[data-testid="role-dodaci_listy"]:visible').first().innerText()).includes(B.email), "karta: Dodací listy = B"));

  // znovu otevřít: vše načtené
  const again = await openDialog(page);
  await eventually(async () => expect((await again.getByLabel("3. kontakt — e-mail").inputValue()) === C.email, "znovu otevřeno: 3 osoby"));
  expect((await again.getByTestId("role-fakturace").getByTestId("role-entry").getAttribute("data-email")) === A.email, "znovu otevřeno: Faktury = A");
  await again.getByRole("button", { name: "Zrušit" }).click();
  await again.waitFor({ state: "hidden", timeout: 10_000 });
});

// ═════════════ 2. Faktura → A ═════════════
await T("faktura: Komu = A (Faktury), důvod „Fakturační e-mail zákazníka (Alena Účetní)“; Vystavit a odeslat → mail Aleně", async (context) => {
  const page = await context.newPage();
  await login(page, USERS.obchod);
  await page.goto(`${BASE}/orders/${IJ.id}?tab=vyroba`);
  await waitHydrated(page, 'main section[aria-label="Zakázka"] button[aria-label^="Stav zakázky:"]');
  await page.locator('main section[aria-label="Zakázka"]').getByRole("button", { name: "Vystavit fakturu", exact: true }).click();
  const dlg = page.getByRole("dialog").filter({ hasText: "Vystavit fakturu" });
  await dlg.locator('[data-testid="send-pending-attachment"]').waitFor({ timeout: 45_000 });
  await eventually(async () => expect((await recipients(dlg, "Komu")) === A.email, `Komu = A (${await recipients(dlg, "Komu")})`), { timeout: 20_000 });
  const reason = norm(await dlg.getByTestId("recipient-reason").innerText());
  expect(reason.startsWith(`Fakturační e-mail zákazníka (${A.name})`), `důvod (${reason})`);
  await snap(page, "desktop-03-invoice-send");
  const t0 = new Date().toISOString();
  await dlg.getByRole("button", { name: "Vystavit a odeslat" }).click();
  const mail = await waitMail(A.email, (m) => m.receivedAt > t0 && /Faktura/.test(String(m.subject)), 60_000);
  expect(mail, "faktura odešla Aleně");
  expect(!(await waitMail(B.email, (m) => m.receivedAt > t0 && /Faktura/.test(String(m.subject)), 2_000)), "faktura nešla skladu");
  await shot(page, S("02-invoice-sent"));
});

// ═════════════ 3. Dodací list → B ═════════════
await T("dodací list: Komu = B (Dodací listy, přednost před kontaktem zakázky), důvod „E-mail pro dodací listy (Bohumil Skladník)“; mail odejde", async (context) => {
  const page = await context.newPage();
  await login(page, USERS.obchod);
  await page.goto(`${BASE}/orders/${DLJ.id}`);
  await waitHydrated(page, "main button");
  await page.waitForLoadState("networkidle").catch(() => {});
  const btn = page.getByRole("button", { name: "Zapsat dodání a dodací list", exact: true }).first();
  await btn.waitFor({ timeout: 20_000 });
  await btn.click();
  const dd = page.locator('[data-testid="delivery-dialog"]');
  await dd.waitFor({ timeout: 15_000 });
  await dd.getByRole("button", { name: /^Zapsat dodání a dodací list/ }).click();
  const res = dd.locator('[data-testid="delivery-note-result"]');
  await res.waitFor({ timeout: 45_000 });
  const m = /Dodací list (DL-\d{4}-\d{3,}) je vystavený/.exec(norm(await res.innerText()));
  expect(m, "DL vystavený");
  await res.getByRole("button", { name: /Poslat zákazníkovi/ }).click();
  const send = page.getByRole("dialog").filter({ hasText: `Poslat dodací list ${m?.[1]} zákazníkovi` });
  await send.waitFor({ timeout: 15_000 });
  await eventually(async () => expect((await recipients(send, "Komu")) === B.email, `Komu = B (${await recipients(send, "Komu")})`), { timeout: 20_000 });
  const reason = norm(await send.getByTestId("recipient-reason").innerText());
  expect(reason === `E-mail pro dodací listy (${B.name})`, `důvod (${reason})`);
  await snap(page, "desktop-04-dl-send");
  const t0 = new Date().toISOString();
  await send.getByRole("button", { name: "Odeslat dodací list" }).click();
  const mail = await waitMail(B.email, (x) => x.receivedAt > t0 && String(x.subject).includes(m?.[1] ?? "DL-"), 45_000);
  expect(mail, "DL odešel skladníkovi");
  expect(!(await waitMail(JOB_CONTACT, (x) => x.receivedAt > t0, 2_000)), "DL nešel kontaktu zakázky");
  await shot(page, S("03-dl-sent"));
});

// ═════════════ 4. Mobil 390 px ═════════════
await T("390 px: dialog s kontakty a Kam posílat bez vodorovného přetékání; přidat osobu a účel jde, Zrušit zahodí", async (context) => {
  const page = await context.newPage();
  await login(page, USERS.obchod);
  const dlg = await openDialog(page);
  await eventually(async () => expect((await dlg.getByLabel("3. kontakt — e-mail").inputValue()) === C.email, "390: načteno"));
  await expectNoOverflow(page, "dialog zákazníka 390");
  await snap(page, "mobile-01-dialog-top");
  await dlg.getByLabel("1. kontakt — jméno").scrollIntoViewIfNeeded();
  await snap(page, "mobile-02-contacts");
  await dlg.getByRole("button", { name: "Přidat kontaktní osobu" }).click();
  await dlg.getByLabel("4. kontakt — jméno").fill("Dana Kvalita");
  await dlg.getByLabel("4. kontakt — e-mail").fill(`dana@${DOM}`);
  await dlg.getByLabel("4. kontakt — pozice").fill("kvalita");
  const nab = dlg.getByTestId("role-nabidky");
  await nab.getByRole("button", { name: "Přidat e-mail: Nabídky" }).click();
  await nab.getByLabel("Nový e-mail: Nabídky").fill(`rfq@${DOM}`);
  await nab.getByRole("button", { name: "Přidat", exact: true }).click();
  await nab.getByTestId("role-entry").filter({ hasText: `rfq@${DOM}` }).waitFor({ timeout: 10_000 });
  await expectNoOverflow(page, "dialog zákazníka 390 po přidání");
  await expectDialogFits(dlg, "390 s dlouhými e-maily");
  await dlg.getByTestId("role-emails").scrollIntoViewIfNeeded();
  await snap(page, "mobile-03-kam-posilat");
  await shot(page, S("04-mobile"));
  // Zrušit s neuloženými změnami → potvrzení → nic se neuloží
  page.once("dialog", (d) => void d.accept());
  await dlg.getByRole("button", { name: "Zrušit" }).click();
  await dlg.waitFor({ state: "hidden", timeout: 10_000 });
  expect(contactRows().length === 3 && !roleRows().some((r) => r.startsWith("nabidky:")), "zrušené změny se neuložily");
}, { mobile: true });

// ═════════════ 5. Dodavatel: stejný editor ═════════════
await T("Upravit dodavatele: kontaktní osoba + Objednávky (bez Dodacích listů) → Uložit → DB", async (context) => {
  const SUP = sql(`insert into suppliers (name, email) values (${lit(`${P}Kalírna ${TAG}`)}, ${lit(`info@sup-${DOM}`)}) returning id`).split("\n")[0];
  try {
    const page = await context.newPage();
    await login(page, USERS.obchod);
    await page.goto(`${BASE}/suppliers`);
    await waitHydrated(page, "main button");
    const search = page.locator("main input[placeholder^='Hledej']").first();
    if (await search.count()) await search.fill(`Kalírna ${TAG}`);
    await page.getByRole("button", { name: `Upravit ${P}Kalírna ${TAG}` }).first().click();
    const dlg = page.getByRole("dialog").filter({ hasText: "Upravit dodavatele" });
    await dlg.getByLabel("1. kontakt — jméno").waitFor({ timeout: 20_000 });
    expect(await dlg.getByTestId("role-dodaci_listy").count() === 0, "dodavatel nemá účel Dodací listy");
    await fillContact(dlg, 1, { name: "Ota Objednávky", position: "obchod", email: `ota@sup-${DOM}`, phone: "+420 777 330 009" });
    await assignRole(dlg, "nakup", "Objednávky", { name: "Ota Objednávky" });
    const ph = (await placeholdersOf(dlg)).filter((p) => FAKE.test(p));
    expect(ph.length === 0, `dodavatel: žádné vzory jako data (${JSON.stringify(ph)})`);
    await dlg.getByRole("button", { name: "Uložit změny" }).click();
    await dlg.waitFor({ state: "hidden", timeout: 20_000 });
    await eventually(() => expect(sql(`select r.role || ':' || k.email from party_role_emails r join supplier_contacts k on k.id = r.supplier_contact_id where r.supplier_id = ${lit(SUP)}`) === `nakup:ota@sup-${DOM}`, "dodavatel: Objednávky = Ota"));
  } finally {
    sql(`delete from suppliers where id = ${lit(SUP)}`);
  }
});

const cleaned = await cleanup();
console.log(`  (úklid: ${cleaned} zakázek)`);
await browser.close();
process.exit(summary(errors) ? 0 : 1);
