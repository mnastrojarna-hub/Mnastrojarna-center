// E2E 36 · Nový zákazník / dodavatel z dokladu — jen firma, žádná zakázka (majitel 31. 10.: „…vyfotit třeba jenom mail
// nebo objednávku nebo fakturu… zanese jenom zákazníka. Nebo jenom vypíše IČO a v ARESu dohledá zbytek… Obdobně u dodavatelů…
// založit v zákaznících jenom zákazníka a v dodavatelích jenom dodavatele, ne zakázku.")
//  1. Zákazníci → Nový zákazník → Nahrát (screenshot e-mailu) → AI (fixture party-customer) + ARES (fixture) → formulář:
//     název / IČO / DIČ / sídlo z ARES, e-mail / telefon / web / splatnost / naše číslo dodavatele z dokladu, kontakt Jana
//     (náš člověk ne), Kam posílat: Faktury + Objednávky → Založit → karta; DB: zákazník, kontakt, účely, ŽÁDNÁ zakázka,
//     nahrané soubory smazané;
//  2. obchodník: napíše jen IČO → ARES sám doplní název, DIČ, adresu + upozornění „už v adresáři je"; Založit → duplicita
//     odmítnuta; neplatné IČO → hláška o kontrolní číslici;
//  3. vložený text (podpis z e-mailu) → stejné vyplnění;
//  4. Dodavatelé → Nový dodavatel → Nahrát .eml bez IČO → kandidáti z ARES → výběr → IČO, DIČ, adresa; štítky technologie /
//     materiály / certifikace; kontakt + Poptávky → Založit; DB: dodavatel, ŽÁDNÁ zakázka;
//  5. Upravit zákazníka: „Doplnit z dokladu" je sbalené a doplní jen prázdná pole (název zůstane);
//  6. 390 px: panel v dialogu bez vodorovného přetékání.
//   E2E_BASE_URL=http://localhost:3100 [PARTY_SHOTS=<adresář>] node tools/e2e/tests/36-party-from-document.mjs
// Data: firmy s IČO 25037684 (fixture ARES) / e-maily @strojmetal-e2e.test — na začátku i na konci se uklidí.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { BASE, USERS, launch, withContext, login, sql, test, expect, summary } from "../lib.mjs";
import { lit, userIds, eventually, waitHydrated } from "../lib-quotes-docs-flow.mjs";

const browser = await launch();
const errors = [];
const ICO = "25037684";
const ARES_NAME = "Strojmetal Aluminium Forging a.s.";
const DOM = "strojmetal-e2e.test";
const ID = userIds();
const SHOTS = process.env.PARTY_SHOTS || null;
if (SHOTS) fs.mkdirSync(SHOTS, { recursive: true });
const T = (name, fn, opts) => test(name, () => withContext(browser, errors, fn, opts));
const norm = (s) => String(s ?? "").replace(/[  ]/g, " ").replace(/\s+/g, " ").trim();

console.log("36 · Nový zákazník / dodavatel z dokladu (jen firma, žádná zakázka)");

// ── podklady (obsah čte fixture AI — tady jde o cestu souboru aplikací) ──
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), "e2e36-"));
const PNG = path.join(TMP, "screenshot-emailu.png");
// 1×1 px PNG
fs.writeFileSync(PNG, Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==", "base64"));
const EML = path.join(TMP, "kooperace-kaleni.eml");
fs.writeFileSync(EML, [
  `From: Karel Kalič <karel@${DOM}>`,
  "To: obchod@mnastrojarna.cz",
  "Subject: Kooperace - kalení",
  "MIME-Version: 1.0",
  "Content-Type: text/plain; charset=utf-8",
  "Content-Transfer-Encoding: 8bit",
  "",
  "Dobrý den, posíláme kontakt pro poptávky kalení a kování.",
  "",
  "--",
  "Karel Kalič, vedoucí kalírny",
  `kooperace@${DOM}`,
  "",
].join("\r\n"));

function cleanup() {
  const cust = sql(`select id from customers where ico = ${lit(ICO)} or email like ${lit(`%@${DOM}`)}`).split("\n").filter(Boolean);
  if (cust.length) {
    const inList = cust.map(lit).join(",");
    sql(`delete from party_role_emails where customer_id in (${inList})`);
    sql(`delete from customer_contacts where customer_id in (${inList})`);
    sql(`delete from customers where id in (${inList})`);
  }
  const sup = sql(`select id from suppliers where ico = ${lit(ICO)} or email like ${lit(`%@${DOM}`)}`).split("\n").filter(Boolean);
  if (sup.length) {
    const inList = sup.map(lit).join(",");
    sql(`delete from party_role_emails where supplier_id in (${inList})`);
    sql(`delete from supplier_contacts where supplier_id in (${inList})`);
    sql(`delete from suppliers where id in (${inList})`);
  }
}
cleanup();

const ordersCount = () => Number(sql("select count(*) from orders"));
const captureCount = (uid) => Number(sql(`select count(*) from storage.objects where bucket_id = 'job-files' and name like ${lit(`capture/${uid}/%`)}`));
const ORDERS_BEFORE = ordersCount();

async function snap(page, name) {
  if (!SHOTS) return;
  await page.waitForTimeout(300);
  await page.screenshot({ path: path.join(SHOTS, `${name}.png`), fullPage: false });
}

async function openNewCustomer(page) {
  await page.goto(`${BASE}/customers`);
  const btn = page.getByRole("button", { name: "Nový zákazník" }).first();
  await btn.waitFor({ timeout: 30_000 });
  await waitHydrated(page, "main button");
  await btn.click();
  const dlg = page.getByTestId("customer-dialog");
  await dlg.waitFor({ timeout: 15_000 });
  await dlg.getByTestId("party-autofill").waitFor({ timeout: 15_000 });
  await dlg.getByLabel("1. kontakt — jméno").waitFor({ timeout: 20_000 });
  return dlg;
}

async function waitDone(dlg) {
  await eventually(async () => {
    const err = dlg.getByTestId("party-autofill-error");
    if (await err.count()) throw Object.assign(new Error(`chyba čtení: ${await err.innerText()}`), { fatal: true });
    expect(await dlg.getByTestId("party-autofill-done").count(), "čtení dokončeno");
  }, { timeout: 60_000 }).catch((e) => { throw e; });
  return norm(await dlg.getByTestId("party-autofill-summary").innerText());
}

const val = (dlg, id) => dlg.locator(`#${id}`).inputValue();

// ═════════════ 1. Nový zákazník z fotky ═════════════
await T("Nový zákazník → Nahrát screenshot e-mailu → AI + ARES vyplní firmu, kontakt a účely → Založit → jen zákazník, žádná zakázka", async (context) => {
  const page = await context.newPage();
  await login(page, USERS.admin);
  const before = captureCount(ID.admin);
  const dlg = await openNewCustomer(page);
  const text = norm(await dlg.innerText());
  for (const s of ["Vyplnit z dokladu", "Vyfotit", "Nahrát", "Vložit text", "AI vyplní jen zákazníka — žádnou zakázku"]) expect(text.includes(s), `panel obsahuje „${s}"`);
  await snap(page, "1-panel");
  await dlg.getByTestId("party-autofill-file").setInputFiles(PNG);
  const sum = await waitDone(dlg);
  expect(/Vyplněno: .*název.*IČO.*DIČ.*1 kontaktní osoba.*2 e-maily podle účelu/.test(sum), `souhrn vyplnění (${sum})`);
  const ares = dlg.getByTestId("party-autofill-ares");
  expect((await ares.getAttribute("data-status")) === "found", `ARES podle IČO (${await ares.getAttribute("data-status")})`);
  // úřední údaje z ARES (doklad měl název velkými a bez DIČ)
  expect((await val(dlg, "cust-name")) === ARES_NAME, `název z ARES (${await val(dlg, "cust-name")})`);
  expect((await val(dlg, "cust-ico")) === ICO, "IČO");
  expect((await val(dlg, "cust-dic")) === `CZ${ICO}`, `DIČ z ARES (${await val(dlg, "cust-dic")})`);
  expect((await val(dlg, "cust-street")) === "Ringhofferova 66", "ulice");
  expect((await val(dlg, "cust-city")) === "Kamenice", "město");
  expect((await val(dlg, "cust-zip")) === "251 68", "PSČ");
  expect((await dlg.locator("#cust-name").getAttribute("data-filled")) === "ares", "název zvýrazněný jako ARES");
  // z dokladu
  expect((await val(dlg, "cust-email")) === `info@${DOM}`, `e-mail firmy (${await val(dlg, "cust-email")})`);
  expect((await val(dlg, "cust-phone")) === "+420 323 600 100", "telefon");
  expect((await val(dlg, "cust-website")) === `www.${DOM}`, "web");
  expect((await val(dlg, "cust-paymentTermsDays")) === "45", "splatnost");
  expect((await val(dlg, "cust-supplierNumberAtCustomer")) === "D-4711", "naše číslo dodavatele");
  expect((await dlg.locator("#cust-phone").getAttribute("data-filled")) === "ai", "telefon zvýrazněný jako AI");
  // kontakt: Jana ano, náš Petr (@mnastrojarna.cz) ne
  expect((await dlg.getByLabel("1. kontakt — jméno").inputValue()) === "Jana Nákupčí", "kontakt Jana");
  expect((await dlg.getByLabel("1. kontakt — e-mail").inputValue()) === `jana.nakupci@${DOM}`, "e-mail Jany");
  expect(!(await dlg.getByLabel("2. kontakt — jméno").count()), "náš člověk se do kontaktů nedostal");
  expect(!(await dlg.getByTestId("party-duplicate").count()), "nový zákazník = bez upozornění na duplicitu");
  await snap(page, "1-vyplneno");
  // soubor z capture/ je po přečtení pryč
  await eventually(async () => expect(captureCount(ID.admin) === before, `nahrané soubory smazané (${captureCount(ID.admin)} ≠ ${before})`));

  await Promise.all([
    page.waitForURL(/\/customers\/[0-9a-f-]{36}/, { timeout: 30_000 }),
    dlg.getByRole("button", { name: "Založit zákazníka" }).click(),
  ]);
  const row = sql(`select name || '|' || ico || '|' || dic || '|' || street || '|' || city || '|' || zip || '|' || email || '|' || payment_terms_days || '|' || supplier_number_at_customer
    from customers where ico = ${lit(ICO)}`).split("\n").filter(Boolean);
  expect(row.length === 1, `právě jeden zákazník (${row.length})`);
  expect(row[0] === `${ARES_NAME}|${ICO}|CZ${ICO}|Ringhofferova 66|Kamenice|251 68|info@${DOM}|45|D-4711`, `řádek zákazníka (${row[0]})`);
  const cid = sql(`select id from customers where ico = ${lit(ICO)}`);
  expect(page.url().endsWith(cid), "otevřela se karta nového zákazníka");
  const contacts = sql(`select name || '|' || coalesce(position,'') || '|' || email || '|' || is_primary from customer_contacts where customer_id = ${lit(cid)} order by name`);
  expect(contacts === `Jana Nákupčí|nákupčí|jana.nakupci@${DOM}|true`, `kontakt v DB (${contacts})`);
  const roles = sql(`select r.role || ':' || coalesce(k.email, r.email) from party_role_emails r left join customer_contacts k on k.id = r.contact_id
    where r.customer_id = ${lit(cid)} order by 1`).split("\n").filter(Boolean);
  expect(JSON.stringify(roles) === JSON.stringify([`fakturace:faktury@${DOM}`, `nakup:jana.nakupci@${DOM}`]), `účely v DB (${JSON.stringify(roles)})`);
  expect(ordersCount() === ORDERS_BEFORE, `žádná nová zakázka (${ordersCount()} ≠ ${ORDERS_BEFORE})`);
  expect(sql(`select count(*) from orders where customer_id = ${lit(cid)}`) === "0", "zákazník nemá žádnou zakázku");
  expect(sql(`select count(*) from audit_log where entity = 'customers' and entity_id = ${lit(cid)} and action = 'customer_created'`) === "1", "audit založení");
});

// ═════════════ 2. Jen IČO → ARES, duplicita ═════════════
await T("Obchodník: napíše jen IČO → ARES doplní název, DIČ, adresu + upozorní, že zákazník už je; uložení duplicity odmítnuto; chybné IČO", async (context) => {
  const page = await context.newPage();
  await login(page, USERS.obchod);
  const dlg = await openNewCustomer(page);
  await dlg.locator("#cust-ico").fill("12345678");
  await dlg.getByTestId("cust-ares").click();
  await eventually(async () => expect(/kontrolní číslici/.test(await dlg.getByTestId("ares-note").innerText()), "chybné IČO = hláška"));
  await dlg.locator("#cust-ico").fill(ICO);
  // bez názvu se ARES zeptá sám
  await eventually(async () => expect((await val(dlg, "cust-name")) === ARES_NAME, `název z ARES (${await val(dlg, "cust-name")})`));
  expect((await val(dlg, "cust-dic")) === `CZ${ICO}`, "DIČ");
  expect((await val(dlg, "cust-street")) === "Ringhofferova 66", "ulice");
  expect(/Doplněno z ARES/.test(await dlg.getByTestId("ares-note").innerText()), "poznámka u IČO");
  const dup = dlg.getByTestId("party-duplicate");
  await dup.waitFor({ timeout: 10_000 });
  expect(/už v adresáři je.*Strojmetal Aluminium Forging/.test(norm(await dup.innerText())), `upozornění na duplicitu (${norm(await dup.innerText())})`);
  await snap(page, "2-ico-ares");
  await dlg.getByRole("button", { name: "Založit zákazníka" }).click();
  const err = dlg.getByTestId("customer-dialog-error");
  await err.waitFor({ timeout: 15_000 });
  expect(/už v adresáři je/.test(await err.innerText()), "uložení duplicity odmítnuto");
  expect(sql(`select count(*) from customers where ico = ${lit(ICO)}`) === "1", "pořád jen jeden zákazník");
});

// ═════════════ 3. Vložený text ═════════════
await T("Vložit text (podpis z e-mailu) → vyplní stejně; upozornění na existujícího zákazníka s odkazem", async (context) => {
  const page = await context.newPage();
  await login(page, USERS.admin);
  page.on("dialog", (d) => d.accept());
  const dlg = await openNewCustomer(page);
  await dlg.getByTestId("party-autofill-text-btn").click();
  await dlg.getByTestId("party-autofill-text").fill(`Jana Nákupčí\nnákupčí\nStrojmetal Aluminium Forging a.s., IČ ${ICO}\njana.nakupci@${DOM}`);
  await dlg.getByTestId("party-autofill-text-submit").click();
  const sum = await waitDone(dlg);
  expect(/název/.test(sum), `souhrn (${sum})`);
  expect((await val(dlg, "cust-name")) === ARES_NAME, "název");
  const link = dlg.getByTestId("party-duplicate").getByRole("link", { name: "Otevřít existujícího" });
  const cid = sql(`select id from customers where ico = ${lit(ICO)}`);
  expect((await link.getAttribute("href")) === `/customers/${cid}`, "odkaz na existujícího zákazníka");
  await dlg.getByRole("button", { name: "Zrušit" }).last().click();
  await eventually(async () => expect(!(await page.getByTestId("customer-dialog").count()), "dialog zavřený bez uložení"));
  expect(sql(`select count(*) from customers where ico = ${lit(ICO)}`) === "1", "nic nového");
});

// ═════════════ 4. Dodavatel z e-mailu bez IČO ═════════════
await T("Nový dodavatel → Nahrát .eml bez IČO → výběr z ARES → IČO, DIČ, adresa, štítky, kontakt, Poptávky → Založit → jen dodavatel", async (context) => {
  const page = await context.newPage();
  await login(page, USERS.admin);
  await page.goto(`${BASE}/suppliers`);
  const btn = page.getByRole("button", { name: "Nový dodavatel" }).first();
  await btn.waitFor({ timeout: 30_000 });
  await waitHydrated(page, "main button");
  await btn.click();
  const dlg = page.getByTestId("supplier-dialog");
  await dlg.getByTestId("party-autofill").waitFor({ timeout: 15_000 });
  await dlg.getByLabel("1. kontakt — jméno").waitFor({ timeout: 20_000 });
  expect(norm(await dlg.innerText()).includes("AI vyplní jen dodavatele — žádnou zakázku"), "panel u dodavatele");
  await dlg.getByTestId("party-autofill-file").setInputFiles(EML);
  await waitDone(dlg);
  expect((await dlg.getByTestId("party-autofill-ares").getAttribute("data-status")) === "choose", "bez IČO → výběr z ARES");
  const cands = dlg.getByTestId("party-autofill-candidates").locator("button");
  expect((await cands.count()) === 3, `3 kandidáti (${await cands.count()})`);
  await snap(page, "4-kandidati");
  await cands.filter({ hasText: ARES_NAME }).click();
  await eventually(async () => expect((await val(dlg, "sup-ico")) === ICO, `IČO z ARES (${await val(dlg, "sup-ico")})`));
  expect((await val(dlg, "sup-name")) === ARES_NAME, "název");
  expect((await val(dlg, "sup-dic")) === `CZ${ICO}`, "DIČ");
  expect((await val(dlg, "sup-address")) === "Ringhofferova 66, 251 68 Kamenice", `adresa (${await val(dlg, "sup-address")})`);
  expect((await val(dlg, "sup-email")) === `kooperace@${DOM}`, "e-mail");
  expect((await dlg.getByTestId("party-autofill-ares").getAttribute("data-status")) === "picked", "vybraná firma");
  const tags = norm(await dlg.innerText());
  for (const t of ["kalení", "kování", "hliník", "ISO 9001"]) expect(tags.includes(t), `štítek ${t}`);
  expect((await dlg.getByLabel("1. kontakt — jméno").inputValue()) === "Karel Kalič", "kontakt Karel");
  await snap(page, "4-dodavatel");
  await dlg.getByRole("button", { name: "Založit dodavatele" }).click();
  await eventually(async () => expect(sql(`select count(*) from suppliers where ico = ${lit(ICO)}`) === "1", "dodavatel založen"), { timeout: 20_000 });
  const sid = sql(`select id from suppliers where ico = ${lit(ICO)}`);
  const row = sql(`select name || '|' || dic || '|' || address || '|' || email || '|' || array_to_string(technologies, ',') || '|' || array_to_string(materials, ',') || '|' || array_to_string(certifications, ',')
    from suppliers where id = ${lit(sid)}`);
  expect(row === `${ARES_NAME}|CZ${ICO}|Ringhofferova 66, 251 68 Kamenice|kooperace@${DOM}|kalení,kování|hliník|ISO 9001`, `řádek dodavatele (${row})`);
  const contact = sql(`select name || '|' || email from supplier_contacts where supplier_id = ${lit(sid)}`);
  expect(contact === `Karel Kalič|karel@${DOM}`, `kontakt dodavatele (${contact})`);
  const roles = sql(`select role || ':' || coalesce(email, '') from party_role_emails where supplier_id = ${lit(sid)}`);
  expect(roles === `nabidky:kooperace@${DOM}`, `Poptávky (${roles})`);
  expect(ordersCount() === ORDERS_BEFORE, "žádná nová zakázka");
});

// ═════════════ 5. Úprava: jen prázdná pole ═════════════
await T("Upravit zákazníka: „Doplnit z dokladu“ sbalené, doplní jen prázdná pole — název z adresáře zůstane", async (context) => {
  const cid = sql(`select id from customers where ico = ${lit(ICO)}`);
  sql(`update customers set name = 'Strojmetal (náš název)', phone = null where id = ${lit(cid)}`);
  const page = await context.newPage();
  await login(page, USERS.admin);
  page.on("dialog", (d) => d.accept());
  await page.goto(`${BASE}/customers/${cid}`);
  await page.locator('[data-testid="role-emails"]:visible').first().waitFor({ timeout: 30_000 });
  await waitHydrated(page, '[data-testid="role-emails"] button');
  await page.getByRole("button", { name: "Upravit", exact: true }).first().click();
  const dlg = page.getByTestId("customer-dialog");
  await dlg.getByLabel("1. kontakt — jméno").waitFor({ timeout: 20_000 });
  expect(!(await dlg.getByTestId("party-autofill").count()), "u úpravy panel sbalený");
  await dlg.getByTestId("party-autofill-expand").click();
  await dlg.getByTestId("party-autofill-text-btn").click();
  await dlg.getByTestId("party-autofill-text").fill(`Strojmetal, IČ ${ICO}, tel. +420 323 600 100`);
  await dlg.getByTestId("party-autofill-text-submit").click();
  const sum = await waitDone(dlg);
  expect((await val(dlg, "cust-name")) === "Strojmetal (náš název)", "název nepřepsán");
  expect((await val(dlg, "cust-phone")) === "+420 323 600 100", "prázdný telefon doplněn");
  expect(/telefon/.test(sum) && !/název/.test(sum), `souhrn jen doplněných polí (${sum})`);
  expect(!(await dlg.getByTestId("party-duplicate").count()), "sám sebe za duplicitu nepovažuje");
  expect(!(await dlg.getByLabel("2. kontakt — jméno").count()), "Jana se nezdvojila");
  await dlg.getByRole("button", { name: "Zrušit" }).last().click();
});

// ═════════════ 6. Mobil ═════════════
await T("390 px: panel v dialogu Nový zákazník bez vodorovného přetékání", async (context) => {
  const page = await context.newPage();
  await login(page, USERS.obchod);
  const dlg = await openNewCustomer(page);
  for (const id of ["party-autofill-camera-btn", "party-autofill-file-btn", "party-autofill-text-btn"]) {
    expect(await dlg.getByTestId(id).isVisible(), `${id} viditelné`);
  }
  const m = await dlg.locator("form > div").first().evaluate((el) => ({ sw: el.scrollWidth, cw: el.clientWidth }));
  expect(m.sw <= m.cw + 1, `obsah dialogu bez vodorovného přesahu (${m.sw} > ${m.cw})`);
  const ico = await dlg.locator("#cust-ico").boundingBox();
  const btn = await dlg.getByTestId("cust-ares").boundingBox();
  expect(ico && btn && ico.width > 80 && Math.abs(ico.y - btn.y) < 6, "IČO a ARES na jednom řádku");
  await snap(page, "6-mobil");
}, { mobile: true });

cleanup();
fs.rmSync(TMP, { recursive: true, force: true });
await browser.close();
const ok = summary(errors);
process.exit(ok ? 0 : 1);
