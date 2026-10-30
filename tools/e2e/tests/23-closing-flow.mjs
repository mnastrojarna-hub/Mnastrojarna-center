// E2E 23 · Konec toku (A2, beta 29. 10.): „nefunguje ani vytvoření faktury … chybí tam vytvoření PDFka a odeslání
// úplně stejně, jako je to u nabídky", „když mám něco ve výrobě, nemám možnost kliknout a vygenerovat dodací list".
// Majitel (obchodník): zakázka Ve výrobě → „Zapsat dodání a dodací list" (z výroby) → Dodáno zákazníkovi →
// hlavní „Vystavit fakturu" (bez potvrzeného DL) → návrh e-mailu („Zrušit" nic nevystaví) → „Vystavit a odeslat"
// (PDF s QR, mail s PDF) → Vyfakturováno → znovu otevřít = jen poslat znovu → „Zadat platbu" → Dokončeno.
// Desktop i 390 px. Záloha nikdy nezmizí (ochrana triggeru), jde i před fakturou. Dílčí dodávka / nic dodáno =
// žádná faktura (ani odkazem). Zaměstnanec fakturu nevidí ani neotevře.
// S CLOSING_SHOTS=<adresář> navíc screenshoty karty v každém kroku, dialogu odeslání, platby a Doklady ▾
// v 1280 / 390 px, světlý i tmavý režim.
//   E2E_BASE_URL=http://localhost:3500 CLOSING_SHOTS=<adresář> node tools/e2e/tests/23-closing-flow.mjs
// Vlastní data „E2E-23-" (zákazník, zakázky), na konci se uklidí.
import fs from "node:fs";
import path from "node:path";
import { BASE, USERS, launch, withContext, login, shot, sql, test, expect, summary, recipients } from "../lib.mjs";
import { lit, userIds, eventually, waitHydrated, expectNoOverflow, waitMail, waitToast, removeStorageFiles } from "../lib-quotes-docs-flow.mjs";

const browser = await launch();
const errors = [];
const P = "E2E-23-";
const TAG = Date.now().toString(36).toUpperCase();
const ID = userIds();
const S = (name) => `closing-flow/${name}`;
const SHOTS = process.env.CLOSING_SHOTS || null;
if (SHOTS) fs.mkdirSync(SHOTS, { recursive: true });
const EMAIL = `e2e23-${TAG.toLowerCase()}@local.test`;
const norm = (s) => String(s ?? "").replace(/[  ]/g, " ").replace(/\s+/g, " ").trim();

console.log(`23 · Konec toku: DL → faktura → platba (značka ${TAG})`);

async function cleanup() {
  const jobs = sql(`select id from orders where title like ${lit(`${P}%`)}`).split("\n").filter(Boolean);
  if (jobs.length) {
    const inList = jobs.map(lit).join(",");
    const paths = sql(`select storage_path from job_files where job_id in (${inList})`).split("\n").filter(Boolean);
    await removeStorageFiles(paths);
    sql(`delete from documents where order_id in (${inList})`);
    sql(`delete from delivery_notes where order_id in (${inList})`);
    sql(`delete from invoices where order_id in (${inList})`);
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

const CUST = sql(`insert into customers (name, country, owner_id, email, contact_person, city, street, zip, ico, payment_terms_days)
  values (${lit(`${P}Strojírny ${TAG} s.r.o.`)}, 'CZ', ${lit(ID.obchod)}, ${lit(EMAIL)}, 'Ing. Eva Testová', 'Brno', 'Testovací 5', '602 00', '87654321', 30)
  returning id`).split("\n")[0];

let seq = 0;
/**
 * Zakázka Ve výrobě s běžícím krokem (U nás) a dvěma oceněnými položkami — hlavní tlačítko je posun výroby,
 * dodání a DL jsou na kartě výroby a v ⋯. stage ≠ ve_vyrobe = zakázka rovnou v daném stavu (bez kroku).
 */
function job(name, stage = "ve_vyrobe") {
  seq += 1;
  const number = `Z-E2E23-${TAG}-${seq}`;
  const id = sql(`insert into orders (number, title, status, source, owner_id, assignee_id, created_by, customer_id, customer_order_number, order_date, priority, order_status, order_revision, value, due_date)
    values (${lit(number)}, ${lit(`${P}${name}`)}, 'potvrzeno', 'manual', ${lit(ID.obchod)}, ${lit(ID.dilna)}, ${lit(ID.obchod)}, ${lit(CUST)}, ${lit(`PO-${TAG}`)}, app_today() - 3, 'stredni', 'potvrzena', 1, 10000, app_today() + 20)
    returning id`).split("\n")[0];
  sql(`insert into order_items (order_id, position, drawing_number, name, material, quantity, unit, unit_price) values
    (${lit(id)}, 0, ${lit(`VYK-${TAG}-A`)}, 'Příruba DN50', '11 523', 10, 'ks', 600), (${lit(id)}, 1, ${lit(`VYK-${TAG}-B`)}, 'Hřídel H7', '42CrMo4', 4, 'ks', 1000)`);
  sql(`update orders set status = ${lit(stage)} where id = ${lit(id)}`);
  if (stage === "ve_vyrobe") {
    sql(`insert into job_operations (job_id, kind, status, position, in_house, planned_end, started_at) values (${lit(id)}, 'vyroba', 'probiha', 0, true, app_today() + 5, now())`);
  }
  return { id, number };
}
const row = (j) => {
  const [status, inv, invDate, due, paidAt, soFar] = sql(`select status || '|' || coalesce(invoice_number,'-') || '|' || coalesce(invoice_date::text,'-') || '|' || coalesce(invoice_due_date::text,'-') || '|' || coalesce(paid_at::text,'-') || '|' || paid_so_far from orders where id = ${lit(j.id)}`).split("|");
  return { status, inv, invDate, due, paidAt, soFar: Number(soFar) };
};
const notesCount = (j) => Number(sql(`select count(*) from delivery_notes where order_id = ${lit(j.id)} and storage_path like 'zakazky/%'`));

const header = (page) => page.locator('main section[aria-label="Zakázka"]');
const nextBtn = (page, label) => header(page).getByRole("button", { name: label, exact: true });
async function openJob(page, j, query = "") {
  await page.goto(`${BASE}/orders/${j.id}${query}`);
  await waitHydrated(page, 'main section[aria-label="Zakázka"] button[aria-label^="Stav zakázky:"]');
  await page.waitForLoadState("networkidle").catch(() => {});
}
async function snap(page, name) {
  if (!SHOTS) return;
  await page.waitForTimeout(250);
  await page.screenshot({ path: path.join(SHOTS, `${name}.png`) });
}

/** DL z Ve výrobě: dialog „Ukončit výrobu" (výroba ještě běží) → „Zapsat dodání bez ukončení kroků" → dodání → DL. */
async function deliverAll(page, dlg) {
  const plain = dlg.locator('[data-testid="handoff-plain-move"]');
  const submitDelivery = dlg.getByRole("button", { name: /^Zapsat dodání a dodací list/ });
  await Promise.race([plain.waitFor({ timeout: 30_000 }), submitDelivery.waitFor({ timeout: 30_000 })]).catch(() => {});
  if (await plain.isVisible().catch(() => false)) {
    expect(norm(await dlg.innerText()).includes("Výroba ještě běží"), "upozornění: výroba ještě běží");
    await plain.click();
  }
  const delivery = page.locator('[data-testid="delivery-dialog"]');
  await delivery.waitFor({ timeout: 20_000 });
  expect((await delivery.getByLabel("Dodávám teď — Příruba DN50").inputValue()) === "10", "předvyplněno vše (Příruba 10)");
  await delivery.getByRole("button", { name: /^Zapsat dodání a dodací list/ }).click();
  const res = delivery.locator('[data-testid="delivery-note-result"]');
  await res.waitFor({ timeout: 45_000 });
  const m = /Dodací list (DL-\d{4}-\d{3,}) je vystavený/.exec(norm(await res.innerText()));
  expect(m, "výsledek nese číslo DL");
  return { number: m[1], res, delivery };
}

const invoiceFiles = (j) => sql(`select string_agg(version::text || ':' || archived, ',' order by version) from job_files where job_id = ${lit(j.id)} and kind = 'faktura'`);

/** Hlavní „Vystavit fakturu" → dialog odeslání: jen návrh e-mailu (Komu předvyplněno), faktura ještě nevznikla. */
async function openInvoice(page) {
  await nextBtn(page, "Vystavit fakturu").click();
  const dlg = page.getByRole("dialog").filter({ hasText: "Vystavit fakturu a poslat zákazníkovi" });
  await dlg.waitFor({ timeout: 15_000 });
  const pending = dlg.locator('[data-testid="send-pending-attachment"]');
  await pending.waitFor({ timeout: 45_000 });
  await eventually(async () => expect((await recipients(dlg, "Komu")) === EMAIL, "Komu = e-mail zákazníka"), { timeout: 20_000 });
  return { dlg, pending };
}

// ═════════════ 1. Majitel, desktop: Ve výrobě → DL → faktura (PDF + e-mail) → platba → Dokončeno ═════════════
const A = job("majitel-desktop");
await test("desktop: Ve výrobě → „Zapsat dodání a dodací list“ z výroby → Dodáno → „Vystavit fakturu“ (bez potvrzeného DL) → PDF → odeslat → „Zadat platbu“ → Dokončeno", () => withContext(browser, errors, async (context) => {
  const page = await context.newPage();
  await login(page, USERS.obchod);
  await openJob(page, A, "?tab=vyroba");
  // hlavní tlačítko je posun výroby; dodání + DL je vidět i tak (souhrn výroby, karta Dodání, ⋯)
  expect(await nextBtn(page, "Zapsat dodání a dodací list").count() === 0, "ve výrobě není dodání hlavním tlačítkem (běží krok)");
  // review A2 #10: na Technologii jen JEDNO tlačítko „Zapsat dodání a dodací list" (karta Dodání, plán sk. 2);
  // souhrn výroby nahoře na kartu jen odkáže (na mobilu je níž)
  const shortcut = page.locator('[data-testid="summary-delivery"]');
  await shortcut.waitFor({ timeout: 20_000 });
  expect(norm(await shortcut.innerText()).includes("Dodání zákazníkovi ↓"), "souhrn výroby: odkaz na kartu Dodání");
  const panel = page.locator("main [role=tabpanel][data-state=active]");
  expect(await panel.getByRole("button", { name: /^Zapsat dodání a dodací list/ }).count() === 1, "Technologie: jedno tlačítko DL");
  const dcard = page.getByRole("region", { name: "Dodání zákazníkovi" });
  await shot(page, S("01-ve-vyrobe"));
  await shortcut.click();
  await dcard.getByRole("button", { name: /^Zapsat dodání a dodací list/ }).click();
  const { number: dl, res, delivery } = await deliverAll(page, page.getByRole("dialog"));
  await shot(page, S("02-dl-result"));
  await res.getByRole("button", { name: "Hotovo" }).click();
  await delivery.waitFor({ state: "hidden", timeout: 10_000 });
  await eventually(() => expect(row(A).status === "dodano_zakaznikovi", `100 % dodáno → Dodáno zákazníkovi (${row(A).status})`), { timeout: 20_000 });
  expect(notesCount(A) === 1, "jeden DL");

  // Dodáno → hlavní „Vystavit fakturu" hned (potvrzený DL není podmínka); karta jen odkazuje nahoru
  await openJob(page, A, "?tab=vyroba");
  await nextBtn(page, "Vystavit fakturu").waitFor({ timeout: 20_000 });
  const closing = page.getByRole("region", { name: "Dodání, faktura a platba" });
  const ct = norm(await closing.innerText());
  expect(ct.includes(`Dodáno — ${dl}`) && ct.includes("nepovinné") && ct.includes("Fakturu vystavíš tlačítkem Vystavit fakturu nahoře"), `karta: DL hotový, potvrzení nepovinné, faktura nahoře (${ct.slice(0, 300)})`);
  expect(!/Zapsat fakturu|Označit zaplaceno|Zrušit úhradu/.test(ct), "žádné staré cesty (Zapsat fakturu / Označit zaplaceno / Zrušit úhradu)");
  await shot(page, S("03-dodano"));

  // review A2 #5: otevření dialogu ani „Zrušit" nic nevystaví (číslo, PDF, evidence, stav)
  const fvBefore = Number(sql(`select coalesce((select counter from doc_counters where doc_type = 'FV'), 0)`));
  const first = await openInvoice(page);
  const preview = await page.request.get(`${BASE}${await first.pending.getByRole("link", { name: /Náhled bez uložení/ }).getAttribute("href")}`);
  expect(preview.status() === 200 && (await preview.body()).subarray(0, 4).toString("latin1") === "%PDF", "náhled faktury bez uložení");
  expect((await first.dlg.getByLabel("Předmět").inputValue()).includes("[číslo faktury]"), "předmět: číslo se přidělí při vystavení");
  expect(await first.dlg.getByRole("button", { name: "Vystavit, neposílat" }).isVisible(), "volba „Vystavit, neposílat“");
  expect(row(A).inv === "-" && invoiceFiles(A) === "" && row(A).status === "dodano_zakaznikovi", `otevřením nic nevzniklo (${JSON.stringify(row(A))})`);
  await first.dlg.getByRole("button", { name: "Zrušit" }).click();
  await first.dlg.waitFor({ state: "hidden", timeout: 10_000 });
  await page.waitForTimeout(800);
  expect(row(A).inv === "-" && invoiceFiles(A) === "" && row(A).status === "dodano_zakaznikovi", `„Zrušit“ nic nevystavilo (${JSON.stringify(row(A))})`);
  expect(Number(sql(`select coalesce((select counter from doc_counters where doc_type = 'FV'), 0)`)) === fvBefore, "číslo z řady FV se nespotřebovalo");

  // faktura: návrh e-mailu jako u nabídky → „Vystavit a odeslat" (PDF s QR v příloze)
  const { dlg } = await openInvoice(page);
  await shot(page, S("04-invoice-send"));
  const t0 = new Date().toISOString();
  await dlg.getByRole("button", { name: "Vystavit a odeslat" }).click();
  await dlg.waitFor({ state: "hidden", timeout: 45_000 });
  const fv = row(A).inv;
  expect(/^FV-\d{4}-\d{3,}$/.test(fv), `číslo faktury z řady FV (${fv})`);
  const mail = await waitMail(EMAIL, (m) => m.receivedAt > t0 && String(m.subject).includes(fv), 30_000);
  // vedle PDF jen vložené logo podpisu (grafický podpis s logem pro každého, 3dfcb3e)
  const pdfs23 = (mail?.attachments ?? []).filter((a) => a.contentType !== "image/png" || a.filename !== "mnastrojarna-logo.png");
  expect(mail && pdfs23.length === 1 && pdfs23[0].filename === `Faktura_${fv}.pdf`, `mail s PDF faktury (${JSON.stringify(mail?.attachments)})`);
  expect(!String(mail?.subject).includes("[číslo faktury]") && !String(mail?.text ?? "").includes("[číslo faktury]"), "v e-mailu přidělené číslo (žádná značka)");
  await waitToast(page, new RegExp(`Faktura ${fv} odeslána na`), 20_000);
  await eventually(() => {
    const r = row(A);
    expect(r.status === "fakturovano" && r.inv === fv && r.invDate !== "-" && r.due !== "-", `DB: Vyfakturováno, číslo, datum a splatnost (${JSON.stringify(r)})`);
  });
  const inv = sql(`select status || '|' || due_date from invoices where number = ${lit(fv)}`);
  expect(inv === `odeslana|${row(A).due}`, `evidence faktur: odeslaná, stejná splatnost (${inv})`);
  const stageEv = sql(`select message from job_events where job_id = ${lit(A.id)} and type = 'stage' order by created_at desc limit 1`);
  expect(stageEv.startsWith("Stav: Dodáno zákazníkovi → Vyfakturováno"), `historie: Dodáno → Vyfakturováno (${stageEv})`);
  // review A2 #1: odkaz „Vystavit fakturu" (/documents, tabule) u vystavené faktury = jen poslat znovu, nic nového
  const before = row(A);
  await openJob(page, A, "?akce=payment.invoice");
  const resend = page.getByRole("dialog").filter({ hasText: `Poslat fakturu ${fv} zákazníkovi` });
  await resend.waitFor({ timeout: 20_000 });
  await resend.locator('a[href^="/api/jobs/files/"]').waitFor({ timeout: 30_000 });
  await page.keyboard.press("Escape");
  await page.waitForTimeout(800);
  expect(invoiceFiles(A) === "1:false", `žádná nová verze PDF (${invoiceFiles(A)})`);
  expect(JSON.stringify(row(A)) === JSON.stringify(before), `datum a splatnost beze změny (${JSON.stringify(row(A))})`);

  // Vyfakturováno → „Zadat platbu" → Doplatit zbytek → Zaplaceno → Dokončeno
  await openJob(page, A, "?tab=vyroba");
  const closing2 = page.getByRole("region", { name: "Dodání, faktura a platba" });
  await eventually(async () => expect(norm(await closing2.innerText()).includes(fv), "karta: číslo faktury + PDF"));
  expect(await closing2.locator('a[href^="/api/jobs/files/"]').filter({ hasText: "PDF" }).count() === 1, "karta: odkaz na PDF faktury");
  await shot(page, S("05-vyfakturovano"));
  await nextBtn(page, "Zadat platbu").click();
  const pay = page.getByRole("dialog").filter({ hasText: "Zadat platbu" });
  await pay.waitFor({ timeout: 10_000 });
  await pay.getByRole("button", { name: /Doplatit zbytek/ }).click();
  expect(await pay.getByRole("switch").isChecked(), "doplatek vyrovnává zakázku");
  await shot(page, S("06-payment"));
  await pay.getByRole("button", { name: "Zaplaceno" }).click();
  await eventually(() => expect(row(A).status === "dokonceno" && row(A).paidAt !== "-", `DB: Dokončeno, zaplaceno (${JSON.stringify(row(A))})`), { timeout: 20_000 });
  await openJob(page, A, "?tab=vyroba");
  await page.getByText("Zakázka dokončena ✓").waitFor({ timeout: 15_000 });
  // review A2 #12: po faktuře je nepovinný potvrzený DL jen malý odkaz
  const done = norm(await page.getByRole("region", { name: "Dodání, faktura a platba" }).innerText());
  expect(done.includes("Nahrát potvrzený DL (nepovinné)") && !done.includes("Potvrdit bez souboru"), `dokončeno: potvrzený DL jen odkaz (${done.slice(0, 200)})`);
  await shot(page, S("07-dokonceno"));
}));

// ═════════════ 2. Mobil 390 px: ⋯ → dodání, hlavní tlačítka, nic nepřetéká ═════════════
await test("mobil 390 px: ⋯ „Zapsat dodání a dodací list“ ve výrobě → Vystavit fakturu → Vystavit, neposílat → Zadat platbu → Dokončeno; nic nepřetéká", () => withContext(browser, errors, async (context) => {
  const M = job("majitel-mobil");
  const page = await context.newPage();
  await login(page, USERS.obchod);
  await openJob(page, M);
  await expectNoOverflow(page, "karta ve výrobě 390 px");
  await header(page).getByRole("button", { name: "Akce se stavem" }).click();
  await page.getByRole("menuitem", { name: "Zapsat dodání a dodací list" }).click();
  const { res, delivery } = await deliverAll(page, page.getByRole("dialog"));
  await expectNoOverflow(page, "výsledek DL 390 px");
  await res.getByRole("button", { name: "Hotovo" }).click();
  await delivery.waitFor({ state: "hidden", timeout: 10_000 });
  await eventually(() => expect(row(M).status === "dodano_zakaznikovi", "Dodáno zákazníkovi"), { timeout: 20_000 });
  await openJob(page, M);
  const { dlg } = await openInvoice(page);
  await expectNoOverflow(page, "dialog faktury 390 px");
  await dlg.getByRole("button", { name: "Vystavit, neposílat" }).click();
  await waitToast(page, /Faktura FV-\S+ je vystavená a uložená/, 20_000);
  await eventually(() => expect(row(M).status === "fakturovano", "Vyfakturováno (jen uloženo, neodesláno)"));
  expect(sql(`select status from invoices where order_id = ${lit(M.id)}`) === "vystavena", "faktura vystavená, ne odeslaná");
  // Doklady ▾: vystavená faktura → Otevřít / Poslat znovu (žádné nové číslo)
  await openJob(page, M);
  await page.getByRole("button", { name: "Doklady (PDF)" }).click();
  await page.getByRole("menuitem", { name: /Poslat fakturu znovu/ }).waitFor({ timeout: 10_000 });
  expect(await page.getByRole("menuitem", { name: /^Faktura FV-/ }).count() === 1, "Doklady: Faktura FV-… otevřít PDF");
  await page.keyboard.press("Escape");
  await nextBtn(page, "Zadat platbu").click();
  const pay = page.getByRole("dialog").filter({ hasText: "Zadat platbu" });
  await pay.getByRole("button", { name: /Doplatit zbytek/ }).click();
  await expectNoOverflow(page, "platba 390 px");
  await pay.getByRole("button", { name: "Zaplaceno" }).click();
  await eventually(() => expect(row(M).status === "dokonceno", "Dokončeno"), { timeout: 20_000 });
}, { mobile: true }));

// ═════════════ 3. Záloha nikdy nezmizí ═════════════
await test("záloha: „Zadat platbu“ 3 000 v kartě, pak starý přímý zápis úhrady (orders.paid_*) → záloha zůstane, karta: „Odebrat“ u úhrad, žádné „Zrušit úhradu“", () => withContext(browser, errors, async (context) => {
  const D = job("zaloha", "dodano_zakaznikovi");
  sql(`update orders set invoice_number = ${lit(`FV-E2E23-${TAG}`)}, invoice_date = app_today(), status = 'fakturovano' where id = ${lit(D.id)}`);
  await eventually(() => expect(row(D).status === "fakturovano", `faktura zapsaná → Vyfakturováno (${row(D).status})`));
  const page = await context.newPage();
  await login(page, USERS.obchod);
  await openJob(page, D, "?tab=vyroba");
  const closing = page.getByRole("region", { name: "Dodání, faktura a platba" });
  await closing.getByRole("button", { name: "Zadat platbu" }).click();
  const pay = page.getByRole("dialog").filter({ hasText: "Zadat platbu" });
  await pay.getByLabel("Částka bez DPH").fill("3000");
  await pay.getByRole("button", { name: "Zapsat úhradu" }).click();
  await eventually(() => expect(row(D).soFar === 3000 && row(D).status === "fakturovano", `záloha 3 000 (${JSON.stringify(row(D))})`));
  // stará cesta (dřív tlačítko „Zaplaceno" v kartě): zápis celé částky přímo do zakázky
  sql(`update orders set paid_at = app_today(), paid_amount = 10000 where id = ${lit(D.id)}`);
  const pays = sql(`select string_agg(amount::numeric::text || ':' || settles || ':' || via, ',' order by created_at) from job_payments where job_id = ${lit(D.id)}`);
  expect(/^3000(\.00)?:false:[a-z]+,7000(\.00)?:true:automaticky$/.test(pays), `záloha zůstala + doplatek 7 000 (${pays})`);
  await eventually(() => expect(row(D).status === "dokonceno" && row(D).soFar === 10000, `Dokončeno, zaplaceno 10 000 (${JSON.stringify(row(D))})`));
  // zrušení úhrady zápisem do zakázky smaže jen automatický doplatek
  sql(`update orders set paid_at = null, paid_amount = null where id = ${lit(D.id)}`);
  expect(sql(`select string_agg(amount::numeric::text, ',') from job_payments where job_id = ${lit(D.id)}`).replace(/\.00/g, "") === "3000", "záloha 3 000 zůstala");
  await openJob(page, D, "?tab=vyroba");
  const t = norm(await page.getByRole("region", { name: "Dodání, faktura a platba" }).innerText());
  expect(t.includes("Odebrat") && !t.includes("Zrušit úhradu") && !t.includes("Označit zaplaceno"), `karta: Odebrat u úhrady, bez hromadného rušení (${t.slice(0, 300)})`);
  await shot(page, S("08-deposit"));
}));

// ═════════════ 4. Zaměstnanec: fakturu nevidí, hlavní krok „Potvrdit DL" ═════════════
await test("zaměstnanec: v Dodáno zákazníkovi hlavní „Potvrdit DL“, v Doklady ▾ žádná faktura; náhled faktury 403", () => withContext(browser, errors, async (context) => {
  const W = job("zamestnanec", "dodano_zakaznikovi");
  const page = await context.newPage();
  await login(page, USERS.dilna);
  await openJob(page, W);
  await nextBtn(page, "Potvrdit DL").waitFor({ timeout: 20_000 });
  expect(await nextBtn(page, "Vystavit fakturu").count() === 0, "bez „Vystavit fakturu“");
  await page.getByRole("button", { name: "Doklady (PDF)" }).click();
  await page.getByRole("menuitem").first().waitFor({ timeout: 10_000 });
  expect(await page.getByRole("menuitem", { name: /Faktura/ }).count() === 0, "Doklady: bez faktury");
  await page.keyboard.press("Escape");
  const r = await page.request.get(`${BASE}/api/pdf/job/${W.id}?type=faktura`);
  expect(r.status() === 403, `náhled faktury zaměstnanci 403 (${r.status()})`);
  // review A2 #9: vystavenou fakturu zaměstnanec v kartě neotevře (odkaz chybí, soubor 403)
  const sales = await context.browser().newContext({ viewport: { width: 1280, height: 860 }, locale: "cs-CZ" });
  try {
    const sp = await sales.newPage();
    await login(sp, USERS.obchod);
    await openJob(sp, W);
    const { dlg } = await openInvoice(sp);
    await dlg.getByRole("button", { name: "Vystavit, neposílat" }).click();
    await eventually(() => expect(row(W).status === "fakturovano", "Vyfakturováno"), { timeout: 30_000 });
  } finally {
    await sales.close();
  }
  const fvFile = sql(`select id from job_files where job_id = ${lit(W.id)} and kind = 'faktura' and not archived`);
  await openJob(page, W, "?tab=vyroba");
  const card = page.getByRole("region", { name: "Dodání, faktura a platba" });
  await eventually(async () => expect(norm(await card.innerText()).includes(row(W).inv), "karta: číslo faktury"));
  expect(await card.locator(`a[href="/api/jobs/files/${fvFile}"]`).count() === 0, "karta: bez odkazu na PDF faktury");
  const f = await page.request.get(`${BASE}/api/jobs/files/${fvFile}`, { maxRedirects: 0 });
  expect(f.status() === 403, `PDF faktury zaměstnanci 403 (${f.status()})`);
}));

// ═════════════ 4b. Záloha ve výrobě, dílčí dodávka bez faktury ═════════════
// review A2 #8: zálohu jde zapsat i před fakturou (karta + ⋯); review A2 #2/#4: dílčí dodávka / nic dodáno = žádná
// faktura z aplikace (ani hlavní tlačítko, ani ⋯, Doklady ▾ nebo odkaz ?akce=)
await test("ve výrobě: záloha „Zadat platbu“ před fakturou; dílčí dodávka → žádná faktura (⋯, Doklady, ?akce=)", () => withContext(browser, errors, async (context) => {
  const Z = job("zaloha-ve-vyrobe");
  const page = await context.newPage();
  await login(page, USERS.obchod);
  await openJob(page, Z);
  await header(page).getByRole("button", { name: "Akce se stavem" }).click();
  await page.getByRole("menuitem", { name: "Zadat platbu" }).waitFor({ timeout: 10_000 });
  expect(await page.getByRole("menuitem", { name: "Vystavit fakturu" }).count() === 0, "⋯: bez faktury (nic nedodáno)");
  expect(await page.getByRole("menuitem", { name: /Faktura vystavená mimo systém/ }).count() === 0, "⋯: bez faktury mimo systém (nic nedodáno)");
  await page.getByRole("menuitem", { name: "Zadat platbu" }).click();
  const pay = page.getByRole("dialog").filter({ hasText: "Zadat platbu" });
  await pay.getByLabel("Částka bez DPH").fill("2000");
  await pay.getByRole("button", { name: "Zapsat úhradu" }).click();
  await eventually(() => expect(row(Z).soFar === 2000 && row(Z).status === "ve_vyrobe", `záloha 2 000, stav Ve výrobě (${JSON.stringify(row(Z))})`), { timeout: 20_000 });
  // dílčí dodávka (Příruba 10/10, Hřídel 0/4)
  sql(`update order_items set delivered_quantity = quantity where order_id = ${lit(Z.id)} and position = 0`);
  await openJob(page, Z, "?tab=vyroba");
  const card = norm(await page.getByRole("region", { name: "Dodání, faktura a platba" }).innerText());
  expect(card.includes("Fakturu vystavíš, až bude dodáno vše") && !card.includes("Vystavit fakturu"), `karta: faktura až po dodání všeho (${card.slice(0, 300)})`);
  await page.getByRole("button", { name: "Doklady (PDF)" }).click();
  await page.getByRole("menuitem").first().waitFor({ timeout: 10_000 });
  expect(await page.getByRole("menuitem", { name: /Faktura/ }).count() === 0, "Doklady: bez faktury při dílčí dodávce");
  await page.keyboard.press("Escape");
  await openJob(page, Z, "?akce=payment.invoice");
  await waitToast(page, /Vystavit fakturu“ teď u této zakázky není k dispozici/, 15_000);
  expect(await page.getByRole("dialog").filter({ hasText: "Vystavit fakturu a poslat zákazníkovi" }).count() === 0, "odkaz ?akce= fakturu neotevřel");
  expect(row(Z).inv === "-" && invoiceFiles(Z) === "", "žádná faktura");
  await shot(page, S("08b-partial-no-invoice"));
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
    await test(`screenshoty ${c.tag}: karta Ve výrobě / Dodáno / Vyfakturováno / Dokončeno, odeslání, platba, Doklady ▾`, async () => {
      const J = job(`shots-${c.tag}`);
      const context = await browser.newContext(c.mobile
        ? { viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, locale: "cs-CZ", colorScheme: c.dark ? "dark" : "light" }
        : { viewport: { width: 1280, height: 860 }, locale: "cs-CZ", colorScheme: c.dark ? "dark" : "light" });
      await context.addInitScript((dark) => { try { localStorage.setItem("theme", dark ? "dark" : "light"); } catch { /* */ } }, c.dark);
      try {
        const page = await context.newPage();
        await login(page, USERS.obchod);
        await openJob(page, J);
        await snap(page, `01-ve-vyrobe-${c.tag}`);
        await openJob(page, J, "?tab=vyroba");
        await snap(page, `02-ve-vyrobe-technologie-${c.tag}`);
        await page.getByRole("region", { name: "Dodání zákazníkovi" }).getByRole("button", { name: /^Zapsat dodání a dodací list/ }).click();
        const { res, delivery } = await deliverAll(page, page.getByRole("dialog"));
        await res.getByRole("button", { name: "Hotovo" }).click();
        await delivery.waitFor({ state: "hidden", timeout: 10_000 });
        await eventually(() => expect(row(J).status === "dodano_zakaznikovi", "Dodáno"), { timeout: 20_000 });
        await openJob(page, J);
        await snap(page, `03-dodano-${c.tag}`);
        await page.getByRole("button", { name: "Doklady (PDF)" }).click();
        await page.getByRole("menuitem").first().waitFor({ timeout: 10_000 });
        await snap(page, `04-doklady-${c.tag}`);
        await page.keyboard.press("Escape");
        await openJob(page, J, "?tab=vyroba");
        await page.getByRole("region", { name: "Dodání, faktura a platba" }).scrollIntoViewIfNeeded().catch(() => {});
        await snap(page, `05-dodano-karta-${c.tag}`);
        const { dlg } = await openInvoice(page);
        await snap(page, `06-odeslani-faktury-${c.tag}`);
        await dlg.getByRole("button", { name: "Vystavit, neposílat" }).click();
        await eventually(() => expect(row(J).status === "fakturovano", "Vyfakturováno"));
        await openJob(page, J);
        await snap(page, `07-vyfakturovano-${c.tag}`);
        await openJob(page, J, "?tab=vyroba");
        await page.getByRole("region", { name: "Dodání, faktura a platba" }).scrollIntoViewIfNeeded().catch(() => {});
        await snap(page, `08-vyfakturovano-karta-${c.tag}`);
        await nextBtn(page, "Zadat platbu").click();
        const pay = page.getByRole("dialog").filter({ hasText: "Zadat platbu" });
        await pay.waitFor({ timeout: 10_000 });
        await snap(page, `09-platba-${c.tag}`);
        await pay.getByRole("button", { name: /Doplatit zbytek/ }).click();
        await pay.getByRole("button", { name: "Zaplaceno" }).click();
        await eventually(() => expect(row(J).status === "dokonceno", "Dokončeno"), { timeout: 20_000 });
        await openJob(page, J);
        await snap(page, `10-dokonceno-${c.tag}`);
        await openJob(page, J, "?tab=vyroba");
        await page.getByRole("region", { name: "Dodání, faktura a platba" }).scrollIntoViewIfNeeded().catch(() => {});
        await snap(page, `11-dokonceno-karta-${c.tag}`);
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
