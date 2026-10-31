// E2E 21 · Dodací list při zápisu dodání (oprava z bety 29. 10.: „po Dodáno k nám neumí vygenerovat DL").
// Majitel: zakázka „Dodáno k nám" → další krok „Zapsat dodání a dodací list" → dílčí dodávka → výsledek
// (číslo DL, Stáhnout PDF, Poslat zákazníkovi → mail s PDF) → chip dodání odkazuje na DL → Doklady →
// „DL na zbývající položky" → druhý DL (jiné číslo) → Dodáno zákazníkovi; mobil 390 px celý průchod;
// zaměstnanec DL vystaví; Kniha nabízí stejný krok. S DL_SHOTS=<adresář> navíc screenshoty dialogu,
// výsledku a Dokumentů v 1280 / 390 px, světlý i tmavý režim.
//   E2E_BASE_URL=http://localhost:3500 DL_SHOTS=<adresář> node tools/e2e/tests/21-delivery-note.mjs
// Vlastní data „E2E-21-" (zákazník, zakázky), na konci se uklidí.
import fs from "node:fs";
import path from "node:path";
import { BASE, USERS, launch, withContext, login, shot, sql, test, expect, summary, recipients } from "../lib.mjs";
import { lit, userIds, eventually, waitHydrated, expectNoOverflow, waitMail, removeStorageFiles } from "../lib-quotes-docs-flow.mjs";

const browser = await launch();
const errors = [];
const P = "E2E-21-";
const TAG = Date.now().toString(36).toUpperCase();
const ID = userIds();
const S = (name) => `delivery-note/${name}`;
const SHOTS = process.env.DL_SHOTS || null;
if (SHOTS) fs.mkdirSync(SHOTS, { recursive: true });
const EMAIL = `e2e21-${TAG.toLowerCase()}@local.test`;
const norm = (s) => String(s ?? "").replace(/[  ]/g, " ").replace(/\s+/g, " ").trim();

console.log(`21 · Dodací list při zápisu dodání (značka ${TAG})`);

async function cleanup() {
  const jobs = sql(`select id from orders where title like ${lit(`${P}%`)}`).split("\n").filter(Boolean);
  if (jobs.length) {
    const inList = jobs.map(lit).join(",");
    const paths = sql(`select storage_path from job_files where job_id in (${inList})`).split("\n").filter(Boolean);
    await removeStorageFiles(paths);
    sql(`delete from delivery_notes where order_id in (${inList})`);
    sql(`delete from emails where order_id in (${inList}) and direction = 'out'`);
    sql(`update emails set order_id = null where order_id in (${inList})`);
    sql(`update job_files set replaced_by = null where job_id in (${inList})`);
    sql(`delete from orders where id in (${inList})`);
    sql(`delete from audit_log where diff->>'jobId' in (${inList})`);
  }
  sql(`delete from customers where name like ${lit(`${P}%`)} and not exists (select 1 from orders o where o.customer_id = customers.id)`);
  return jobs.length;
}
const left = await cleanup();
if (left) console.log(`  (úklid po minulém běhu: ${left} zakázek)`);

const CUST = sql(`insert into customers (name, country, owner_id, email, contact_person, city, street, zip, ico, delivery_address)
  values (${lit(`${P}Kovo ${TAG} s.r.o.`)}, 'CZ', ${lit(ID.obchod)}, ${lit(EMAIL)}, 'Ing. Eva Testová', 'Brno', 'Testovací 5', '602 00', '87654321',
  'Sklad Brno, Průmyslová 12, 602 00 Brno') returning id`).split("\n")[0];

let seq = 0;
/** Zakázka ve stavu `stage` (výchozí Dodáno k nám) se dvěma položkami s cenou (cena na DL nesmí být). */
function job(name, stage = "dodano_k_nam") {
  seq += 1;
  const number = `Z-E2E21-${TAG}-${seq}`;
  const id = sql(`insert into orders (number, title, status, source, owner_id, assignee_id, created_by, customer_id, customer_order_number, order_date, priority, order_status, order_revision)
    values (${lit(number)}, ${lit(`${P}${name}`)}, 'potvrzeno', 'manual', ${lit(ID.obchod)}, ${lit(ID.dilna)}, ${lit(ID.obchod)}, ${lit(CUST)}, ${lit(`PO-${TAG}`)}, current_date, 'stredni', 'potvrzena', 1)
    returning id`).split("\n")[0];
  sql(`insert into order_items (order_id, position, drawing_number, name, material, quantity, unit, unit_price) values
    (${lit(id)}, 0, ${lit(`VK-${TAG}-A`)}, 'Příruba', '11 523', 10, 'ks', 123.45), (${lit(id)}, 1, ${lit(`VK-${TAG}-B`)}, 'Hřídel', '42CrMo4', 4, 'ks', 987.65)`);
  sql(`update orders set status = ${lit(stage)} where id = ${lit(id)}`);
  return { id, number };
}
const notes = (j) => sql(`select number || '|' || coalesce(storage_path, '-') from delivery_notes where order_id = ${lit(j.id)} order by created_at`).split("\n").filter(Boolean).map((r) => r.split("|"));
const delivered = (j) => sql(`select string_agg(delivered_quantity::numeric::text, ',' order by position) from order_items where order_id = ${lit(j.id)}`);
const stage = (j) => sql(`select status from orders where id = ${lit(j.id)}`);

async function openJob(page, j, query = "") {
  await page.goto(`${BASE}/orders/${j.id}${query}`);
  await waitHydrated(page, "main button");
  await page.waitForLoadState("networkidle").catch(() => {});
}
const dialogOf = (page) => page.locator('[data-testid="delivery-dialog"]');

/** Další krok v hlavičce karty → dialog. */
async function startFromHeader(page, label = "Zapsat dodání a dodací list") {
  const btn = page.getByRole("button", { name: label, exact: true }).first();
  await btn.waitFor({ timeout: 20_000 });
  await btn.click();
  const dlg = dialogOf(page);
  await dlg.waitFor({ timeout: 15_000 });
  return dlg;
}

/** Je zakázka v záložce Knihy (hledání podle čísla; "" = výchozí Objednávky v běhu)? */
async function inBook(page, j, segment = "") {
  await page.goto(`${BASE}/orders?${segment ? `segment=${segment}&` : ""}q=${encodeURIComponent(j.number)}`);
  await page.waitForLoadState("networkidle").catch(() => {});
  await page.locator('main [aria-busy="false"]').first().waitFor({ timeout: 15_000 }).catch(() => {});
  return (await page.locator(`main a[href^="/orders/${j.id}"]`).count()) > 0;
}

async function submitAndResult(page, dlg) {
  await dlg.getByRole("button", { name: /^Zapsat dodání a dodací list/ }).click();
  const res = dlg.locator('[data-testid="delivery-note-result"]');
  await res.waitFor({ timeout: 45_000 });
  const txt = norm(await res.innerText());
  const m = /Dodací list (DL-\d{4}-\d{3,}) je vystavený/.exec(txt);
  expect(m, `výsledek nese číslo DL (${txt.slice(0, 160)})`);
  return { number: m[1], text: txt, res };
}

const A = job("majitel-desktop");

// ═════════════ 1. Dodáno k nám → Zapsat dodání a dodací list (dílčí) → PDF → poslat ═════════════
let firstDl = null;
await test("Dodáno k nám: další krok „Zapsat dodání a dodací list“ → dílčí dodávka → DL s vlastním číslem → Stáhnout PDF → Poslat zákazníkovi (mail s PDF)", () => withContext(browser, errors, async (context) => {
  const page = await context.newPage();
  await login(page, USERS.obchod);
  await openJob(page, A);
  const hint = norm(await page.locator("main").innerText());
  expect(hint.includes("Další krok: Zapsat dodání a dodací list"), "nápověda dalšího kroku zmiňuje dodací list");
  const dlg = await startFromHeader(page);
  expect(await dlg.getByRole("checkbox", { name: /Vystavit dodací list/ }).isChecked(), "„Vystavit dodací list“ je výchozí zaškrtnuté");
  // předvyplněno celým zbytkem (systém vyplní, člověk koriguje) — dílčí dodávka = jen snížit
  expect((await dlg.getByLabel("Dodávám teď — Příruba").inputValue()) === "10", "předvyplněno: Příruba 10");
  expect((await dlg.getByLabel("Dodávám teď — Hřídel").inputValue()) === "4", "předvyplněno: Hřídel 4");
  await dlg.getByLabel("Dodávám teď — Příruba").fill("6");
  await dlg.getByLabel("Dodávám teď — Hřídel").fill("");
  await dlg.getByLabel(/^Poznámka/).fill(`Paleta 1/2 ${TAG}`);
  await shot(page, S("01-dialog"));
  const { number, res } = await submitAndResult(page, dlg);
  firstDl = number;
  await shot(page, S("02-result"));
  await eventually(() => expect(delivered(A) === "6.000,0.000" || delivered(A) === "6,0", `DB: dodáno 6 / 0 (${delivered(A)})`));
  expect(stage(A) === "dodano_k_nam", "dílčí dodávka stav neposune");
  const n = notes(A);
  expect(n.length === 1 && n[0][0] === number && n[0][1] !== "-", `delivery_notes: jeden DL s PDF (${JSON.stringify(n)})`);

  // Stáhnout PDF
  const [download] = await Promise.all([page.waitForEvent("download", { timeout: 30_000 }), res.getByRole("link", { name: /Stáhnout PDF/ }).click()]);
  expect(download.suggestedFilename() === `Dodaci_list_${number}.pdf`, `název souboru (${download.suggestedFilename()})`);
  const file = await download.path();
  const head = fs.readFileSync(file).subarray(0, 4).toString("latin1");
  expect(head === "%PDF", "stažený soubor je PDF");

  // Poslat zákazníkovi
  await res.getByRole("button", { name: /Poslat zákazníkovi/ }).click();
  const send = page.getByRole("dialog").filter({ hasText: `Poslat dodací list ${number} zákazníkovi` });
  await send.waitFor({ timeout: 15_000 });
  await eventually(async () => expect((await recipients(send, "Komu")) === EMAIL, "Komu = e-mail zákazníka"), { timeout: 20_000 });
  expect((await send.getByLabel("Předmět").inputValue()).includes(number), "předmět nese číslo tohoto DL");
  const t0 = new Date().toISOString();
  await send.getByRole("button", { name: "Odeslat dodací list" }).click();
  const mail = await waitMail(EMAIL, (m) => m.receivedAt > t0 && String(m.subject).includes(number), 30_000);
  // vedle PDF jen vložené logo podpisu (grafický podpis s logem pro každého, 3dfcb3e)
  const pdfs21 = (mail?.attachments ?? []).filter((a) => a.contentType !== "image/png" || a.filename !== "mnastrojarna-logo.png");
  expect(mail && pdfs21.length === 1 && pdfs21[0].filename === `Dodaci_list_${number}.pdf`, `mail s PDF (${JSON.stringify(mail?.attachments)})`);
  await res.getByText(`Odesláno na ${EMAIL}.`).waitFor({ timeout: 15_000 });
  await res.getByRole("button", { name: "Hotovo" }).click();
  await dlg.waitFor({ state: "hidden", timeout: 10_000 });

  // chip „Částečně dodáno" odkazuje na DL
  const chip = page.locator('[data-testid="delivery-chip-link"]').first();
  await chip.waitFor({ timeout: 20_000 });
  expect(norm(await chip.innerText()).includes(number), "chip dodání ukazuje číslo DL");
  expect(/\/api\/jobs\/files\/[0-9a-f-]{36}$/.test(await chip.getAttribute("href")), "chip vede na PDF dodacího listu");

  // 31. 10.: dílčí DL → zakázka zůstává v Objednávkách (v běhu), v Dokončených ještě není
  await eventually(async () => expect(await inBook(page, A), "Kniha: po dílčím DL zůstává v Objednávkách"), { timeout: 20_000 });
  expect(!(await inBook(page, A, "dokoncene")), "Kniha: po dílčím DL ještě není v Dokončených");
}));

// ═════════════ 2. Doklady → DL na zbývající položky → druhý DL → Dodáno zákazníkovi ═════════════
await test("Doklady ▾: stáhnout vystavený DL (bez nového čísla) + „DL na zbývající položky“ → druhý DL, Dodáno zákazníkovi, chip „Dodáno“ → DL", () => withContext(browser, errors, async (context) => {
  expect(firstDl, "první DL existuje");
  const page = await context.newPage();
  await login(page, USERS.obchod);
  await openJob(page, A);
  await page.getByRole("button", { name: "Doklady (PDF)" }).click();
  const item = page.getByRole("menuitem", { name: new RegExp(`Dodací list ${firstDl}`) });
  await item.waitFor({ timeout: 10_000 });
  expect(/\/api\/jobs\/files\//.test(await item.getAttribute("href")), "položka menu stáhne vystavený DL");
  await page.getByRole("menuitem", { name: /DL na zbývající položky/ }).click();
  const dlg = dialogOf(page);
  await dlg.waitFor({ timeout: 15_000 });
  expect((await dlg.getByLabel("Dodávám teď — Příruba").inputValue()) === "4", "předvyplněný zbytek Příruby (4)");
  expect((await dlg.getByLabel("Dodávám teď — Hřídel").inputValue()) === "4", "předvyplněný zbytek Hřídele (4)");
  const { number, text } = await submitAndResult(page, dlg);
  expect(number !== firstDl, `druhý DL má vlastní číslo (${number} ≠ ${firstDl})`);
  expect(text.includes("2. dodávka — konečná"), `označení konečné dodávky (${text.slice(0, 160)})`);
  await eventually(() => expect(stage(A) === "dodano_zakaznikovi", `DB: Dodáno zákazníkovi (${stage(A)})`), { timeout: 20_000 });
  expect(notes(A).map((r) => r[0]).join(",") === `${firstDl},${number}`, "delivery_notes: dva DL v pořadí");
  await page.keyboard.press("Escape");
  await openJob(page, A);
  const chip = page.locator('[data-testid="delivery-chip-link"]').first();
  await chip.waitFor({ timeout: 20_000 });
  const ct = norm(await chip.innerText());
  expect(ct.includes("Dodáno") && ct.includes(number), `chip „Dodáno“ → poslední DL (${ct})`);
  await page.getByRole("button", { name: "Doklady (PDF)" }).click();
  expect(await page.getByRole("menuitem", { name: /^Dodací list DL-/ }).count() === 2, "Doklady: oba DL ke stažení");
  expect(await page.getByRole("menuitem", { name: /DL na zbývající položky/ }).count() === 0, "nic nezbývá → bez „DL na zbývající“");
  await page.keyboard.press("Escape");
  await shot(page, S("03-delivered"));

  // 31. 10.: DL na vše → Kniha: Dokončené, ne Objednávky v běhu (ani v Hodnotě v běhu — stejný výběr)
  await eventually(async () => expect(await inBook(page, A, "dokoncene"), "Kniha: po DL na vše je v Dokončených"), { timeout: 20_000 });
  expect(!(await inBook(page, A)), "Kniha: po DL na vše už není v Objednávkách v běhu");
}));

// ═════════════ 3. Mobil 390 px ═════════════
await test("mobil 390 px: Zapsat dodání a dodací list → rovnou potvrdit (předvyplněno vše) → výsledek, stránka nepřetéká", () => withContext(browser, errors, async (context) => {
  const M = job("majitel-mobil", "na_sklade");
  const page = await context.newPage();
  await login(page, USERS.obchod);
  await openJob(page, M);
  await expectNoOverflow(page, "karta 390 px");
  const dlg = await startFromHeader(page);
  // jedno ťuknutí: pole jsou předvyplněná celým zbytkem → rovnou „Zapsat dodání a dodací list"
  await expectNoOverflow(page, "dialog 390 px");
  await shot(page, S("04-mobile-dialog"));
  const { number, res } = await submitAndResult(page, dlg);
  expect(await res.getByRole("button", { name: /Vytisknout/ }).isVisible(), "Vytisknout je vidět");
  await expectNoOverflow(page, "výsledek 390 px");
  await shot(page, S("05-mobile-result"));
  await eventually(() => expect(stage(M) === "dodano_zakaznikovi", "na skladě → dodáno vše → Dodáno zákazníkovi"), { timeout: 20_000 });
  expect(notes(M).length === 1 && notes(M)[0][0] === number, "jeden DL");
}, { mobile: true }));

// ═════════════ 4. Zaměstnanec + Kniha ═════════════
await test("zaměstnanec: v Knize i na kartě „Zapsat dodání a dodací list“, DL vystaví a otevře", () => withContext(browser, errors, async (context) => {
  const W = job("zamestnanec");
  const page = await context.newPage();
  await login(page, USERS.dilna);
  await page.goto(`${BASE}/orders?q=${encodeURIComponent(W.number)}`);
  const row = page.locator("main").getByText(W.number).first();
  await row.waitFor({ timeout: 20_000 });
  await eventually(async () => expect(norm(await page.locator("main").innerText()).includes("Zapsat dodání a dodací list"), "Kniha: další krok s dodacím listem"));
  await openJob(page, W);
  const dlg = await startFromHeader(page);
  await dlg.getByLabel("Dodávám teď — Hřídel").fill("2");
  await dlg.getByLabel("Dodávám teď — Příruba").fill("");
  const { number, res } = await submitAndResult(page, dlg);
  const href = await res.getByRole("link", { name: /Stáhnout PDF/ }).getAttribute("href");
  const r = await page.request.get(`${BASE}${href}`, { maxRedirects: 5 });
  expect(r.status() === 200 && (await r.body()).subarray(0, 4).toString("latin1") === "%PDF", `zaměstnanec stáhne PDF (${r.status()})`);
  expect(sql(`select count(*) from delivery_notes where order_id = ${lit(W.id)} and number = ${lit(number)}`) === "1", "DL zapsán");
}));

// ═════════════ 4b. DL dodavatele není náš DL; dodáno bez DL → „DL na dodané zboží"; náhled = uložený DL ═════════════
await test("DL dodavatele se neukáže jako náš (chip, karta); dodáno bez DL → Doklady „DL na dodané zboží“ (6 ks) → chip a náhled vedou na něj", () => withContext(browser, errors, async (context) => {
  const L = job("legacy-supplier", "dodano_k_nam");
  // DL dodavatele (z fotky) + dodání zapsané bez DL (beta před opravou)
  sql(`insert into job_files (job_id, kind, filename, storage_path, version, archived, issuer, origin, uploaded_by)
    values (${lit(L.id)}, 'dodaci_list', 'DL_dodavatel_4711.pdf', ${lit(`zakazky/${L.id}/e2e21-supplier-${TAG}.pdf`)}, 1, false, 'dodavatel', 'capture', ${lit(ID.obchod)})`);
  sql(`update order_items set delivered_quantity = 6 where order_id = ${lit(L.id)} and position = 0`);
  const page = await context.newPage();
  await login(page, USERS.obchod);
  await openJob(page, L, "?tab=vyroba");
  const card = page.getByRole("region", { name: "Dodání zákazníkovi" });
  await card.waitFor({ timeout: 20_000 });
  expect(await page.locator('[data-testid="delivery-chip-link"]').count() === 0, "chip neodkazuje na DL dodavatele");
  expect(!norm(await card.innerText()).includes("DL_dodavatel_4711"), "karta dodání neukazuje DL dodavatele");
  await page.getByRole("button", { name: "Doklady (PDF)" }).click();
  const item = page.getByRole("menuitem", { name: /DL na dodané zboží/ });
  await item.waitFor({ timeout: 10_000 });
  expect(await page.getByRole("menuitem", { name: /všechny položky zakázky/ }).count() === 0, "nenabízí DL na všechny (objednané) položky");
  await item.click();
  await eventually(() => expect(notes(L).length === 1 && notes(L)[0][1].startsWith("zakazky/"), `DL dodávky uložen (${JSON.stringify(notes(L))})`), { timeout: 30_000 });
  const number = notes(L)[0][0];
  const qty = sql(`select string_agg(quantity::numeric::text, ',' order by position) from delivery_note_items i join delivery_notes n on n.id = i.delivery_note_id where n.order_id = ${lit(L.id)}`);
  expect(qty === "6.000" || qty === "6", `DL nese dodaných 6 ks, ne objednané (${qty})`);
  await page.keyboard.press("Escape");
  await openJob(page, L, "?tab=vyroba");
  const chip = page.locator('[data-testid="delivery-chip-link"]').first();
  await chip.waitFor({ timeout: 20_000 });
  expect(norm(await chip.innerText()).includes(number), `chip → náš DL ${number}`);
  const fileId = sql(`select id from job_files where job_id = ${lit(L.id)} and storage_path = (select storage_path from delivery_notes where order_id = ${lit(L.id)})`);
  const r = await page.request.get(`${BASE}/api/pdf/job/${L.id}?type=dodaci-list`, { maxRedirects: 0 });
  expect(r.status() === 307 && String(r.headers().location).endsWith(`/api/jobs/files/${fileId}`), `náhled DL = uložený DL (${r.status()} ${r.headers().location})`);
  await shot(page, S("06-legacy-delivered"));
}));

// ═════════════ 5. Screenshoty 1280 / 390 × světlý / tmavý ═════════════
if (SHOTS) {
  const CONFIGS = [
    { tag: "desktop-light", mobile: false, dark: false },
    { tag: "mobile-light", mobile: true, dark: false },
    { tag: "desktop-dark", mobile: false, dark: true },
    { tag: "mobile-dark", mobile: true, dark: true },
  ];
  for (const c of CONFIGS) {
    await test(`screenshoty ${c.tag}: dialog, výsledek, Dokumenty`, async () => {
      const J = job(`shots-${c.tag}`);
      const context = await browser.newContext(c.mobile
        ? { viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, locale: "cs-CZ", colorScheme: c.dark ? "dark" : "light" }
        : { viewport: { width: 1280, height: 860 }, locale: "cs-CZ", colorScheme: c.dark ? "dark" : "light" });
      await context.addInitScript((dark) => { try { localStorage.setItem("theme", dark ? "dark" : "light"); } catch { /* */ } }, c.dark);
      try {
        const page = await context.newPage();
        await login(page, USERS.obchod);
        await openJob(page, J);
        await page.screenshot({ path: path.join(SHOTS, `00-detail-${c.tag}.png`) });
        const dlg = await startFromHeader(page);
        await dlg.getByLabel("Dodávám teď — Příruba").fill("6");
        await dlg.getByLabel("Dodávám teď — Hřídel").fill("");
        await page.waitForTimeout(300);
        await page.screenshot({ path: path.join(SHOTS, `01-dialog-${c.tag}.png`) });
        await submitAndResult(page, dlg);
        await page.waitForTimeout(300);
        await page.screenshot({ path: path.join(SHOTS, `02-result-${c.tag}.png`) });
        await dlg.getByRole("button", { name: "Hotovo" }).click();
        await openJob(page, J, "?tab=dokumenty");
        await page.waitForTimeout(500);
        await page.screenshot({ path: path.join(SHOTS, `03-documents-${c.tag}.png`), fullPage: true });
        await openJob(page, J, "?tab=vyroba");
        await page.getByRole("region", { name: "Dodání zákazníkovi" }).scrollIntoViewIfNeeded().catch(() => {});
        await page.waitForTimeout(300);
        await page.screenshot({ path: path.join(SHOTS, `04-delivery-card-${c.tag}.png`) });
      } finally {
        await context.close();
      }
    });
  }
}

await browser.close();
// KEEP=1: data nechat (ruční kontrola PDF); úklid proběhne při dalším běhu
if (!process.env.KEEP) {
  const removed = await cleanup();
  console.log(`  (úklid: ${removed} zakázek)`);
}
const ok = summary(errors);
process.exit(ok ? 0 : 1);
