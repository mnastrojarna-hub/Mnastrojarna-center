// E2E 37 · Výjimky v toku (majitel 31. 10.): „chybí tlačítka … zákazník neobjednal, nepovede se výroba, reklamace,
// vyrábějte bez objednávky … aktualizace výkresu … oprava zakázky". Jedno srozumitelné tlačítko ve skupině
// „Co se stalo?" (⋯ karty, menu stavu v Knize), zakázka se sama uklidí do správné záložky Knihy, vše v historii s autorem.
//  1. Zákazník neobjednal (důvod) → Nerealizované & zrušené s chipem důvodu → Obnovit poptávku.
//  2. Výroba se nepovedla (390 px) → zmetek v historii → Vyrobit znovu = předání do výroby.
//  3. Reklamace z vyfakturované → Objednávky (Reklamace) → Vyřešit: dobropis → zpět Vyfakturováno.
//  4. Vyrábět bez objednávky (390 px) → předání, štítek „Bez objednávky", filtr Knihy → objednávka dorazila → Potvrdit.
//  5. Pozastavit z Knihy (menu stavu „Co se stalo?") → Pokračovat vrátí stav.
//  6. Aktualizace výkresu → banner (objednávka u dodavatele, Poslat dodavateli novou revizi) → Beru na vědomí.
//  7. Oprava zakázky → revize + „Poslat opravené potvrzení".
// S FLOWEXC_SHOTS=<adresář> screenshoty dialogů a tlačítek (desktop i 390 px).
//   E2E_BASE_URL=http://localhost:3900 FLOWEXC_SHOTS=<adresář> node tools/e2e/tests/36-flow-exceptions.mjs
// Vlastní data „E2E-36-" (zákazník, dodavatel, zakázky), na konci se uklidí.
import fs from "node:fs";
import path from "node:path";
import { BASE, USERS, launch, withContext, login, sql, test, expect, summary, recipients } from "../lib.mjs";
import { lit, userIds, eventually, waitHydrated, expectNoOverflow, waitToast, removeStorageFiles } from "../lib-quotes-docs-flow.mjs";

const browser = await launch();
const errors = [];
const P = "E2E-36-";
const TAG = Date.now().toString(36).toUpperCase();
const ID = userIds();
const SHOTS = process.env.FLOWEXC_SHOTS || null;
if (SHOTS) fs.mkdirSync(SHOTS, { recursive: true });
const norm = (s) => String(s ?? "").replace(/[  ]/g, " ").replace(/\s+/g, " ").trim();

console.log(`37 · Výjimky v toku (značka ${TAG})`);

async function cleanup() {
  const jobs = sql(`select id from orders where title like ${lit(`${P}%`)}`).split("\n").filter(Boolean);
  if (jobs.length) {
    const inList = jobs.map(lit).join(",");
    const paths = sql(`select storage_path from job_files where job_id in (${inList})`).split("\n").filter(Boolean);
    await removeStorageFiles(paths);
    sql(`delete from job_drawing_changes where job_id in (${inList})`);
    sql(`delete from purchase_orders where job_id in (${inList})`);
    sql(`update job_files set replaced_by = null where job_id in (${inList})`);
    sql(`delete from emails where order_id in (${inList}) and direction = 'out'`);
    sql(`update emails set order_id = null where order_id in (${inList})`);
    sql(`delete from orders where id in (${inList})`);
    sql(`delete from audit_log where diff->>'jobId' in (${inList})`);
  }
  sql(`delete from customers where name like ${lit(`${P}%`)} and not exists (select 1 from orders o where o.customer_id = customers.id)`);
  sql(`delete from suppliers where name like ${lit(`${P}%`)} and not exists (select 1 from purchase_orders p where p.supplier_id = suppliers.id)`);
  return jobs.length;
}
const left = await cleanup();
if (left) console.log(`  (úklid po minulém běhu: ${left} zakázek)`);

const CUST = sql(`insert into customers (name, country, owner_id, email, contact_person, city) values (${lit(`${P}Strojírny ${TAG} s.r.o.`)}, 'CZ', ${lit(ID.obchod)}, ${lit(`e2e36-${TAG.toLowerCase()}@local.test`)}, 'Ing. Eva Testová', 'Brno') returning id`).split("\n")[0];
const SUP = sql(`insert into suppliers (name, email) values (${lit(`${P}Kooperant ${TAG}`)}, ${lit(`kooperant36-${TAG.toLowerCase()}@local.test`)}) returning id`).split("\n")[0];

let seq = 0;
/** Zakázka v daném stavu s jednou oceněnou položkou (výkres F0N603W88 rev. 02). */
function job(name, stage, extra = "") {
  seq += 1;
  const number = `Z-E2E36-${TAG}-${seq}`;
  const order = !["poptavka", "naceneni", "nabidka"].includes(stage);
  const id = sql(`insert into orders (number, title, status, source, owner_id, created_by, customer_id, inquiry_date, priority, value, due_date
      ${order ? ", customer_order_number, order_date" : ""})
    values (${lit(number)}, ${lit(`${P}${name}`)}, 'poptavka', 'manual', ${lit(ID.obchod)}, ${lit(ID.obchod)}, ${lit(CUST)}, app_today() - 10, 'stredni', 1000, app_today() + 20
      ${order ? `, ${lit(`PO-${TAG}-${seq}`)}, app_today() - 5` : ""})
    returning id`).split("\n")[0];
  const item = sql(`insert into order_items (order_id, position, drawing_number, revision, name, material, quantity, unit, unit_price)
    values (${lit(id)}, 0, 'F0N603W88', '02', 'Příruba DN50', '11 523', 10, 'ks', 100) returning id`).split("\n")[0];
  if (stage !== "poptavka") sql(`update orders set status = ${lit(stage)} ${extra} where id = ${lit(id)}`);
  return { id, number, item };
}
const st = (j) => sql(`select status from orders where id = ${lit(j.id)}`);
const col = (j, c) => sql(`select coalesce(${c}::text, '-') from orders where id = ${lit(j.id)}`);

const header = (page) => page.locator('main section[aria-label="Zakázka"]');
async function openJob(page, j, query = "") {
  await page.goto(`${BASE}/orders/${j.id}${query}`);
  await waitHydrated(page, 'main section[aria-label="Zakázka"] button[aria-label^="Stav zakázky:"]');
  await page.waitForLoadState("networkidle").catch(() => {});
}
async function snap(page, name) {
  if (!SHOTS) return;
  await page.waitForTimeout(300);
  await page.screenshot({ path: path.join(SHOTS, `${name}.png`) });
}
/** ⋯ karty → skupina „Co se stalo?" → akce. */
async function happened(page, label) {
  await header(page).getByRole("button", { name: "Akce se stavem" }).click();
  const menu = page.getByRole("menu");
  await menu.waitFor({ timeout: 10_000 });
  // štítek skupiny je verzálkami (CSS) — innerText vrací „CO SE STALO?"
  expect(/co se stalo\?/i.test(norm(await menu.innerText())), "menu ⋯ má skupinu „Co se stalo?“");
  await menu.getByRole("menuitem", { name: label }).click();
}
const dialog = (page, text) => page.getByRole("dialog").filter({ hasText: text });

// ═════════════ 1. Zákazník neobjednal → Nerealizované → Obnovit ═════════════
const J1 = job("neobjednal", "nabidka");
const Q1 = sql(`insert into quotes (number, job_id, status, sent_at, total, revision, owner_id, created_by, approved_by, valid_until)
  values (${lit(`NAB-E2E36-${TAG}`)}, ${lit(J1.id)}, 'odeslano', now() - interval '20 days', 1000, 1, ${lit(ID.obchod)}, ${lit(ID.admin)}, ${lit(ID.admin)}, app_today() - 3) returning id`).split("\n")[0];
await test("desktop: nabídka (vypršelá) → „Zákazník neobjednal…“ s důvodem → Nerealizované & zrušené (chip důvodu) → „Obnovit poptávku“", () => withContext(browser, errors, async (context) => {
  const page = await context.newPage();
  await login(page, USERS.obchod);
  expect(st(J1) === "nabidka", `výchozí stav Nabídka (${st(J1)})`);
  await openJob(page, J1);
  await happened(page, "Zákazník neobjednal…");
  const dlg = dialog(page, "Zákazník neobjednal");
  await dlg.waitFor({ timeout: 10_000 });
  const t = norm(await dlg.innerText());
  for (const r of ["Cena", "Termín dodání", "Vybral jiného dodavatele", "Projekt zrušen", "Bez odezvy", "Jiný důvod"]) expect(t.includes(r), `důvod „${r}“`);
  expect(t.includes("Zakázka → Nerealizováno") && t.includes("→ Zamítnutá"), `náhled dopadu (${t.slice(0, 300)})`);
  await dlg.getByRole("radio", { name: "Cena" }).click();
  await dlg.getByRole("textbox").fill("o 20 % dráž než konkurence");
  await snap(page, "01-zakaznik-neobjednal-dialog");
  await dlg.getByRole("button", { name: "Zákazník neobjednal" }).click();
  await waitToast(page, /Zákazník neobjednal/);
  await eventually(() => expect(st(J1) === "nerealizovano", `→ Nerealizováno (${st(J1)})`));
  expect(col(J1, "lost_reason") === "cena" && col(J1, "lost_note") === "o 20 % dráž než konkurence", "důvod a poznámka u zakázky");
  expect(sql(`select status from quotes where id = ${lit(Q1)}`) === "zamitnuto", "odeslaná nabídka zamítnutá");
  const ev = sql(`select a.full_name || '|' || e.message from job_events e join profiles a on a.id = e.actor_id where e.job_id = ${lit(J1.id)} and e.type = 'stage' order by e.created_at desc limit 1`);
  expect(ev.startsWith(`${USERS.obchod.name}|Stav: Nabídka odeslaná → Nerealizováno`) && ev.includes("Cena"), `historie s autorem a důvodem (${ev})`);

  // Kniha: záložka Nerealizované & zrušené — chip důvodu a řádek „Nerealizováno — Cena"
  await page.goto(`${BASE}/orders?segment=nerealizovane&q=${encodeURIComponent(J1.number)}`);
  const chips = page.locator('[data-testid="lost-reason-chips"]');
  await chips.waitFor({ timeout: 15_000 });
  await chips.getByRole("button", { name: /^Cena/ }).click();
  await page.waitForURL(/duvod=cena/, { timeout: 15_000 });
  await eventually(async () => expect(norm(await page.locator("main ul[role=list]").innerText()).includes("Nerealizováno — Cena"), "řádek: Nerealizováno — Cena"));
  await snap(page, "01b-kniha-nerealizovane-duvod");

  // Obnovit poptávku
  await openJob(page, J1);
  await happened(page, "Obnovit poptávku");
  const re = dialog(page, "Obnovit poptávku");
  await re.waitFor({ timeout: 10_000 });
  expect(norm(await re.innerText()).includes("Nabídka odeslaná"), "obnovení vrátí do Nabídky");
  await snap(page, "01c-obnovit-poptavku");
  await re.getByRole("button", { name: "Obnovit poptávku" }).click();
  await eventually(() => expect(st(J1) === "nabidka" && col(J1, "lost_reason") === "-", `obnoveno → Nabídka (${st(J1)})`));
  expect(sql(`select status from quotes where id = ${lit(Q1)}`) === "odeslano", "nabídka zase odeslaná");
}));

// ═════════════ 2. Výroba se nepovedla (390 px) ═════════════
const J2 = job("zmetek", "potvrzeno");
sql(`update orders set status = 've_vyrobe' where id = ${lit(J2.id)}`);
sql(`insert into job_operations (job_id, kind, status, position, in_house, planned_end, started_at) values (${lit(J2.id)}, 'vyroba', 'probiha', 0, true, app_today() + 5, now())`);
await test("390 px: ve výrobě → „Výroba se nepovedla…“ (2 ks zmetek, Vyrobit znovu) → historie + předání do výroby", () => withContext(browser, errors, async (context) => {
  const page = await context.newPage();
  await login(page, USERS.dilna);
  await openJob(page, J2);
  await happened(page, "Výroba se nepovedla…");
  const dlg = dialog(page, "Výroba se nepovedla");
  await dlg.waitFor({ timeout: 10_000 });
  await dlg.getByRole("radio", { name: "Chyba výroby" }).click();
  await dlg.getByLabel("Zmetků (ks)").fill("2");
  await dlg.getByRole("radio", { name: "Vyrobit znovu" }).click();
  expect(await dlg.getByRole("radio", { name: "Zrušit zakázku" }).count() === 0, "zaměstnanec zakázku nezruší");
  await expectNoOverflow(page, "dialog Výroba se nepovedla 390 px");
  await snap(page, "02-vyroba-se-nepovedla-390");
  await dlg.getByRole("button", { name: "Zapsat a vyrobit znovu" }).click();
  // navazuje předání do výroby (plán) — tentýž dialog jako „Přeplánovat výrobu…"
  await eventually(async () => expect(await page.getByRole("dialog").count() >= 1 && !(await dialog(page, "Výroba se nepovedla").count()), "otevřel se dialog výroby"), { timeout: 20_000 });
  await snap(page, "02b-vyrobit-znovu-predani-390");
  const ev = sql(`select message from job_events where job_id = ${lit(J2.id)} and data->>'exception' = 'production_failed' and actor_id = ${lit(ID.dilna)}`);
  expect(ev.includes("Výroba se nepovedla") && ev.includes("2 ks z 10") && ev.includes("Vyrobit znovu"), `historie zmetku (${ev})`);
  expect(st(J2) === "ve_vyrobe", "zakázka zůstává ve výrobě");
}, { mobile: true }));

// ═════════════ 3. Reklamace ═════════════
const J3 = job("reklamace", "potvrzeno");
sql(`update order_items set delivered_quantity = 10 where id = ${lit(J3.item)}`);
sql(`update orders set status = 'fakturovano', invoice_number = ${lit(`FV-E2E36-${TAG}`)} where id = ${lit(J3.id)}`);
await test("desktop: vyfakturovaná → „Reklamace…“ (důvod, kusy, popis) → Objednávky se štítkem → „Vyřešit reklamaci…“ dobropis → zpět Vyfakturováno", () => withContext(browser, errors, async (context) => {
  const page = await context.newPage();
  await login(page, USERS.obchod);
  await openJob(page, J3);
  await happened(page, "Reklamace…");
  const dlg = dialog(page, "Zákazník reklamuje");
  await dlg.waitFor({ timeout: 10_000 });
  await dlg.getByRole("radio", { name: "Rozměry / tolerance" }).click();
  await dlg.getByLabel("Kusů").fill("3");
  await dlg.getByLabel("Co zákazník reklamuje (povinné)").fill("3 ks mimo toleranci díry Ø12");
  await snap(page, "03-reklamace-dialog");
  await dlg.getByRole("button", { name: "Zapsat reklamaci" }).click();
  await eventually(() => expect(st(J3) === "reklamace", `→ Reklamace (${st(J3)})`));
  expect(col(J3, "claim_from_stage") === "fakturovano" && col(J3, "claim_reason") === "rozmery", "zapamatován stav před reklamací");
  await openJob(page, J3);
  const banner = page.locator('[data-testid="claim-banner"]');
  await banner.waitFor({ timeout: 15_000 });
  expect(norm(await banner.innerText()).includes("Rozměry / tolerance · 3 ks"), "banner reklamace");
  // Kniha → Objednávky (reklamace je zase v běhu), filtr Výjimky „Reklamace"
  await page.goto(`${BASE}/orders?vyjimka=reklamace&q=${encodeURIComponent(J3.number)}`);
  await eventually(async () => expect(norm(await page.locator("main ul[role=list]").innerText()).includes(J3.number), "Kniha → Objednávky: zakázka s reklamací"));
  expect(await page.locator('[data-testid="exception-chips"] button[aria-pressed="true"]').filter({ hasText: "Reklamace" }).count() === 1, "aktivní chip Reklamace");
  await snap(page, "03b-kniha-reklamace");
  await openJob(page, J3);
  await header(page).getByRole("button", { name: "Vyřešit reklamaci…" }).click();
  const res = dialog(page, "Vyřešit reklamaci");
  await res.waitFor({ timeout: 10_000 });
  await res.getByRole("radio", { name: "Uznáno — dobropis" }).click();
  expect(norm(await res.innerText()).includes("Vyfakturováno"), "návrat do Vyfakturováno");
  await res.getByRole("textbox").fill("DOB-2026-001");
  await snap(page, "03c-vyresit-reklamaci");
  await res.getByRole("button", { name: "Uložit" }).click();
  await eventually(() => expect(st(J3) === "fakturovano" && col(J3, "claim_resolution") === "dobropis", `vyřízeno dobropisem → Vyfakturováno (${st(J3)})`));
  expect(col(J3, "invoice_number") === `FV-E2E36-${TAG}`, "faktura zůstala");
}));

// ═════════════ 4. Vyrábět bez objednávky (390 px + desktop) ═════════════
const J4 = job("bez-objednavky", "poptavka");
await test("390 px: poptávka → „Vyrábět bez objednávky…“ → předání do výroby → štítek „Bez objednávky“, Kniha filtr → objednávka dorazila → „Potvrdit objednávku“", () => withContext(browser, errors, async (context) => {
  const page = await context.newPage();
  await login(page, USERS.obchod);
  await openJob(page, J4);
  await happened(page, "Vyrábět bez objednávky…");
  const dlg = dialog(page, "Vyrábět bez objednávky");
  await dlg.waitFor({ timeout: 10_000 });
  await dlg.getByRole("button", { name: "Zákazník napsal „vyrábějte“ e-mailem" }).click();
  await expectNoOverflow(page, "dialog Vyrábět bez objednávky 390 px");
  await snap(page, "04-vyrabet-bez-objednavky-390");
  await dlg.getByRole("button", { name: "Vyrábět — předat do výroby" }).click();
  await eventually(() => expect(st(J4) === "objednavka" && col(J4, "awaiting_customer_po") === "true", `→ Objednávka s příznakem (${st(J4)})`));
  // navazuje dialog předání do výroby (kdo + termín)
  await eventually(async () => expect(!(await dialog(page, "Vyrábět bez objednávky").count()) && (await page.getByRole("dialog").count()) >= 1, "předání do výroby"), { timeout: 20_000 });
  await snap(page, "04b-predani-390");
  await page.keyboard.press("Escape");
  await openJob(page, J4);
  const banner = page.locator('[data-testid="awaiting-po-banner"]');
  await banner.waitFor({ timeout: 15_000 });
  expect(norm(await banner.innerText()).includes("Vyrábí se bez objednávky zákazníka"), "banner Bez objednávky");
  expect(await header(page).getByRole("button", { name: "Potvrdit objednávku" }).count() === 0, "potvrzení se nevyžaduje");
  await expectNoOverflow(page, "karta bez objednávky 390 px");
  await snap(page, "04c-karta-bez-objednavky-390");
  // Kniha: štítek řádku + filtr Výjimky „Bez objednávky"
  await page.goto(`${BASE}/orders?q=${encodeURIComponent(J4.number)}`);
  const chip = page.locator('[data-testid="exception-chips"]').getByRole("button", { name: /Bez objednávky/ });
  await chip.waitFor({ timeout: 15_000 });
  await chip.click();
  await page.waitForURL(/vyjimka=bez_po/, { timeout: 15_000 });
  await eventually(async () => {
    const t = norm(await page.locator("main ul[role=list]").innerText());
    expect(t.includes(J4.number) && t.includes("Bez objednávky"), `řádek se štítkem Bez objednávky (${t.slice(0, 200)})`);
  });
  await expectNoOverflow(page, "Kniha Bez objednávky 390 px");
  await snap(page, "04d-kniha-bez-objednavky-390");
  // objednávka dorazila (ručně) → potvrdit s jejím číslem
  await openJob(page, J4);
  await banner.getByRole("button", { name: "Objednávka dorazila…" }).click();
  const po = dialog(page, "Objednávka zákazníka dorazila");
  await po.waitFor({ timeout: 10_000 });
  await po.getByLabel("Číslo objednávky zákazníka").fill(`PO-36-${TAG}`);
  await snap(page, "04e-objednavka-dorazila-390");
  await po.getByRole("button", { name: "Zapsat objednávku" }).click();
  await po.locator('[data-testid="po-arrived-done"]').waitFor({ timeout: 15_000 });
  await eventually(() => expect(col(J4, "awaiting_customer_po") === "false" && col(J4, "customer_order_number") === `PO-36-${TAG}`, "příznak zmizel, číslo zapsáno"));
  await po.getByRole("button", { name: "Potvrdit objednávku" }).click();
  await eventually(async () => expect(await page.getByRole("dialog").filter({ hasText: `PO-36-${TAG}` }).count() >= 1, "potvrzení objednávky s jejím číslem"), { timeout: 20_000 });
  await snap(page, "04f-potvrdit-objednavku-390");
  const ev = sql(`select count(*) from job_events where job_id = ${lit(J4.id)} and data->>'exception' = 'po_received' and actor_id = ${lit(ID.obchod)}`);
  expect(ev === "1", `historie: objednávka dorazila (${ev})`);
}, { mobile: true }));

// ═════════════ 5. Pozastavit z Knihy → Pokračovat ═════════════
const J5 = job("pauza", "potvrzeno");
await test("desktop: Kniha → menu stavu „Co se stalo?“ → „Pozastavit…“ (důvod) → štítek → „Pokračovat“ vrátí Potvrzenou objednávku", () => withContext(browser, errors, async (context) => {
  const page = await context.newPage();
  await login(page, USERS.obchod);
  await page.goto(`${BASE}/orders?q=${encodeURIComponent(J5.number)}`);
  const rowEl = page.locator("main ul[role=list] > li").filter({ hasText: J5.number });
  await rowEl.waitFor({ timeout: 15_000 });
  await waitHydrated(page, "main ul[role=list] button[aria-label^='Stav zakázky:']");
  await rowEl.getByRole("button", { name: /^Stav zakázky:/ }).click();
  const menu = page.getByRole("menu");
  await menu.waitFor({ timeout: 10_000 });
  expect(norm(await menu.innerText()).includes("Co se stalo?"), "menu stavu v Knize má „Co se stalo?“");
  await snap(page, "05-kniha-co-se-stalo");
  await menu.getByRole("menuitem", { name: "Pozastavit…" }).click();
  const dlg = dialog(page, "Pozastavit zakázku");
  await dlg.waitFor({ timeout: 20_000 });
  await dlg.getByRole("button", { name: "Čeká na materiál" }).click();
  await snap(page, "05b-pozastavit-dialog");
  await dlg.getByRole("button", { name: "Pozastavit" }).click();
  await eventually(() => expect(st(J5) === "pozastaveno" && col(J5, "side_from_stage") === "potvrzeno", `→ Pozastaveno (${st(J5)})`));
  await openJob(page, J5);
  await eventually(async () => expect(norm(await header(page).innerText()).includes("Pozastaveno — Čeká na materiál"), "štítek s důvodem"));
  await header(page).getByRole("button", { name: "Pokračovat", exact: true }).click();
  const go = dialog(page, "Pokračovat v zakázce");
  await go.waitFor({ timeout: 10_000 });
  expect(norm(await go.innerText()).includes("Potvrzená objednávka"), "vrátí do Potvrzená objednávka");
  await snap(page, "05c-pokracovat");
  await go.getByRole("button", { name: /^Pokračovat — / }).click();
  await eventually(() => expect(st(J5) === "potvrzeno", `→ zpět Potvrzeno (${st(J5)})`));
}));

// ═════════════ 6. Aktualizace výkresu ═════════════
const J6 = job("vykres", "potvrzeno");
sql(`update orders set status = 've_vyrobe' where id = ${lit(J6.id)}`);
const PO6 = sql(`insert into purchase_orders (job_id, supplier_id, status, number, sent_at) values (${lit(J6.id)}, ${lit(SUP)}, 'odeslana', ${lit(`OV-E2E36-${TAG}`)}, now()) returning id`).split("\n")[0];
sql(`insert into purchase_order_items (purchase_order_id, position, drawing_number, name, quantity, unit, order_item_id) values (${lit(PO6)}, 0, 'F0N603W88', 'Příruba DN50', 10, 'ks', ${lit(J6.item)})`);
const PDF = Buffer.from("%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj 2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj 3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 200 200]>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF\n");
for (const mobile of [false, true]) {
  await test(`${mobile ? "390 px" : "desktop"}: „Aktualizace výkresu…“ → výrazný banner (objednávka u dodavatele) → „Poslat dodavateli novou revizi“ → štítek v Knize → „Beru na vědomí“`, () => withContext(browser, errors, async (context) => {
    const page = await context.newPage();
    await login(page, USERS.obchod);
    const rev = mobile ? "04" : "03";
    await openJob(page, J6);
    await happened(page, "Aktualizace výkresu…");
    const dlg = dialog(page, "Aktualizace výkresu");
    await dlg.waitFor({ timeout: 10_000 });
    expect((await dlg.getByLabel(/^Nová revize/).inputValue()) === rev, `navržená revize ${rev}`);
    await dlg.locator('input[type="file"]').setInputFiles({ name: `F0N603W88_${rev}.pdf`, mimeType: "application/pdf", buffer: PDF });
    await dlg.getByLabel("Co se změnilo (nepovinné)").fill("změna tolerance díry");
    if (mobile) await expectNoOverflow(page, "dialog Aktualizace výkresu 390 px");
    await snap(page, `06-aktualizace-vykresu${mobile ? "-390" : ""}`);
    await dlg.getByRole("button", { name: "Zapsat novou revizi" }).click();
    await eventually(() => expect(sql(`select revision from order_items where id = ${lit(J6.item)}`) === rev, "revize položky"), { timeout: 30_000 });
    expect(col(J6, "drawing_changes_open") === "1", "štítek Nová revize na zakázce");
    await openJob(page, J6);
    const banner = page.locator('[data-testid="drawing-change-banner"]');
    await banner.waitFor({ timeout: 15_000 });
    const bt = norm(await banner.innerText());
    expect(bt.includes(`Nová revize výkresu F0N603W88: ${mobile ? "03" : "02"} → ${rev}`) && bt.includes(USERS.obchod.name), `banner (${bt.slice(0, 200)})`);
    expect(bt.includes(`Objednávka OV-E2E36-${TAG}`) && bt.includes("Díly jsou ve výrobě podle staré revize"), `dopad: objednávka u dodavatele + výroba (${bt})`);
    if (mobile) await expectNoOverflow(page, "banner revize 390 px");
    await snap(page, `06b-banner-nova-revize${mobile ? "-390" : ""}`);
    if (!mobile) {
      await banner.getByRole("button", { name: "Poslat dodavateli novou revizi" }).click();
      const compose = page.getByRole("dialog").filter({ hasText: "Nová zpráva" });
      await compose.waitFor({ timeout: 15_000 });
      await eventually(async () => expect((await recipients(compose, "Komu")).includes(`kooperant36-${TAG.toLowerCase()}@local.test`), "Komu = e-mail dodavatele"));
      expect((await compose.getByLabel("Předmět").inputValue()).includes(`Změna výkresu F0N603W88 — rev. ${rev}`), "předmět");
      expect(norm(await compose.innerText()).includes(`F0N603W88_${rev}.pdf`), "příloha = nová revize");
      await snap(page, "06c-poslat-dodavateli");
      await page.keyboard.press("Escape");
      await eventually(() => expect(sql(`select drawing_changed_at is not null from purchase_orders where id = ${lit(PO6)}`) === "t", "objednávka označena „změna výkresu“"));
      // položky: rev. změněna
      await openJob(page, J6, "?tab=polozky");
      const strip = page.locator('[data-testid="drawing-revisions"]');
      await strip.waitFor({ timeout: 15_000 });
      expect(norm(await strip.innerText()).includes(`rev. změněna (02 → ${rev})`), "položka: rev. změněna");
      // Kniha: štítek Nová revize
      await page.goto(`${BASE}/orders?q=${encodeURIComponent(J6.number)}`);
      await eventually(async () => expect(await page.locator('main ul[role=list] [data-flag="vykres"]').count() >= 1, "Kniha: štítek Nová revize"));
      await snap(page, "06d-kniha-nova-revize");
      await openJob(page, J6);
    }
    await page.locator('[data-testid="drawing-change-banner"]').getByRole("button", { name: "Beru na vědomí" }).click();
    await eventually(() => expect(col(J6, "drawing_changes_open") === "0", "vzato na vědomí"));
    const ack = sql(`select a.full_name from job_drawing_changes c join profiles a on a.id = c.acknowledged_by where c.job_id = ${lit(J6.id)} and c.rev_to = ${lit(rev)}`);
    expect(ack === USERS.obchod.name, `kdo vzal na vědomí (${ack})`);
    await eventually(async () => expect(await page.locator('[data-testid="drawing-change-banner"]').count() === 0, "banner zmizel"));
  }, { mobile }));
}

// ═════════════ 7. Oprava zakázky ═════════════
const J7 = job("oprava", "potvrzeno", `, confirmation_sent_at = now(), confirmation_sent_revision = 1`);
await test("desktop: „Oprava zakázky…“ (množství + termín, důvod) → revize + hodnota → „Opraveno“ → „Poslat opravené potvrzení“", () => withContext(browser, errors, async (context) => {
  const page = await context.newPage();
  await login(page, USERS.obchod);
  await openJob(page, J7);
  await happened(page, "Oprava zakázky…");
  const dlg = dialog(page, "Oprava zakázky");
  await dlg.waitFor({ timeout: 10_000 });
  await dlg.getByRole("button", { name: "Zákazník změnil množství" }).click();
  await dlg.getByLabel("Množství F0N603W88 (rev. 02)").fill("15");
  await snap(page, "07-oprava-zakazky");
  await dlg.getByRole("button", { name: "Uložit opravu" }).click();
  const done = page.locator('[data-testid="correction-done"]');
  await done.waitFor({ timeout: 20_000 });
  expect(norm(await done.innerText()).includes("množství: 10 → 15"), "souhrn změn");
  expect(col(J7, "order_revision") === "2" && col(J7, "order_confirmed_revision") === "2" && Number(col(J7, "value")) === 1500, `revize 2 přijatá, hodnota 1500 (${col(J7, "value")})`);
  await snap(page, "07b-oprava-hotovo");
  await done.getByRole("button", { name: "Poslat opravené potvrzení" }).click();
  await eventually(async () => expect(await page.getByRole("dialog").count() >= 1 && !(await page.locator('[data-testid="correction-done"]').count()), "dialog potvrzení"), { timeout: 15_000 });
  await page.keyboard.press("Escape");
  await openJob(page, J7);
  await eventually(async () => expect(norm(await header(page).innerText()).includes("Opraveno"), "štítek Opraveno"));
  const ev = sql(`select count(*) from job_events where job_id = ${lit(J7.id)} and data->>'exception' = 'correction' and actor_id = ${lit(ID.obchod)}`);
  expect(ev === "1", "historie opravy s autorem");
}));

await cleanup();
await browser.close();
process.exit(summary(errors) ? 0 : 1);
