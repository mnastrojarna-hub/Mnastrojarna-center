// E2E 05 · Nabídky, doklady (PDF + e-mail) a stránky obchodního toku.
// Karta zakázky → záložka Nabídky (nová, schválení, PDF náhled, odeslání e-mailem,
// nová verze, úprava, archiv, přijetí, zamítnutí), „Doklady ▾" (potvrzení s neoceněnou
// položkou, verze, dodací list, faktura), stránky toku /inquiries, /pricing, /quotes,
// /confirmations, /documents (super admin, obchodník, zaměstnanec) a mobil 390 px.
// Vlastní data mají prefix „E2E-quotes-docs-flow-" a na konci se uklidí.
import { BASE, USERS, launch, withContext, login, shot, sql, clearMail, test, expect, summary, rest as restCall, restLogin, recipients, setRecipients } from "../lib.mjs";
import {
  PREFIX, TAG, lit, userIds, eventually, waitHydrated, expectNoOverflow, waitToast, alertTexts, isoDays,
  fetchPdf, expectPdf, mailsTo, waitMail, createCustomer, createJob, createQuote, cleanupOwnData,
} from "../lib-quotes-docs-flow.mjs";

const browser = await launch();
const errors = [];
/** ONLY=regex spustí jen vybrané testy (ladění). */
const ONLY = process.env.ONLY ? new RegExp(process.env.ONLY) : null;
const T = (name, fn, opts) => (ONLY && !ONLY.test(name) ? Promise.resolve() : test(name, () => withContext(browser, errors, fn, opts)));
const S = (name) => `quotes-docs-flow/${name}`;
const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const norm = (s) => String(s ?? "").replace(/[  ]/g, " ").replace(/\s+/g, " ").trim();
const num = (v) => Number(v);
/** UX postřehy během běhu (vypíšou se na konci). */
const notes = [];

console.log(`05 · Nabídky, doklady a stránky toku (značka ${TAG})`);

// ── Vlastní data ─────────────────────────────────────────────
const leftovers = await cleanupOwnData();
if (leftovers.jobs || leftovers.customers) console.log(`  (úklid po minulém běhu: ${leftovers.jobs} zakázek, ${leftovers.customers} zákazníků)`);
const ID = userIds();
const CUST_EMAIL = `e2e-flow-${TAG.toLowerCase()}@local.test`;
await clearMail(CUST_EMAIL);
const CUST = createCustomer({ name: `${PREFIX}Kovo ${TAG} s.r.o.`, email: CUST_EMAIL, ownerId: ID.obchod });
/** Unikátní nákupní cena — zaměstnanec ji nesmí nikde dostat (ani v datech stránky). */
const PURCHASE = 4817.29;
const PURCHASE_RE = /4\s?817[.,]29/;

const Q1 = createJob({
  title: `${PREFIX}Q1 nabídky ${TAG}`, status: "naceneni", customerId: CUST.id, ownerId: ID.obchod, reqDays: 25, contact: "Ing. Eva Testová",
  items: [
    { drawing: `QDF-${TAG}-A`, rev: "B", name: "Upínka VK", material: "1.2379", qty: 4, price: null, purchase: PURCHASE },
    { drawing: `QDF-${TAG}-B`, name: "Čep D12", material: "C45", qty: 10, price: null },
  ],
});
const Q2 = createJob({ title: `${PREFIX}Q2 zamítnutí ${TAG}`, status: "nabidka", customerId: CUST.id, ownerId: ID.obchod, reqDays: 30 });
const Q2Q = createQuote(Q2, {
  number: `E2EQDF-${TAG}-Q2`, status: "odeslano", approvedBy: ID.obchod, createdBy: ID.obchod, customerId: CUST.id, sent: true,
  items: [{ drawing: `QDF-${TAG}-Q2`, name: "Deska Q2", qty: 2, price: 2500 }],
});
const D1 = createJob({
  title: `${PREFIX}D1 doklady ${TAG}`, status: "objednavka", customerId: CUST.id, ownerId: ID.obchod, cpo: `QDF-PO-${TAG}`, dueDays: 20,
  items: [
    { drawing: `QDF-${TAG}-D1A`, name: "Pouzdro D1", material: "1.2343", qty: 2, price: 1500 },
    { drawing: `QDF-${TAG}-D1B`, name: "Kolík D1 (bez ceny)", qty: 1, price: null },
  ],
});
const C1 = createJob({
  title: `${PREFIX}C1 potvrzení e-mailem ${TAG}`, status: "objednavka", customerId: CUST.id, ownerId: ID.obchod, cpo: `QDF-C1-${TAG}`, reqDays: 18, value: 2970,
  items: [{ drawing: `QDF-${TAG}-C1`, name: "Vložka C1", qty: 3, price: 990 }],
});
const C2 = createJob({
  title: `${PREFIX}C2 potvrzení bez e-mailu ${TAG}`, status: "objednavka", customerId: CUST.id, ownerId: ID.obchod, reqDays: 30, value: 1800,
  items: [{ drawing: `QDF-${TAG}-C2`, name: "Vložka C2", qty: 2, price: 900 }],
});
const B1 = createJob({ title: `${PREFIX}B1 board ${TAG}`, status: "naceneni", customerId: CUST.id, ownerId: ID.obchod, reqDays: 25 });
const B1Q = createQuote(B1, {
  number: `E2EQDF-${TAG}-B1`, status: "ke_schvaleni", createdBy: ID.obchod, customerId: CUST.id, approvalRequested: true,
  items: [{ drawing: `QDF-${TAG}-B1`, name: "Hřídel B1", qty: 5, price: 1200 }],
});
const B2 = createJob({ title: `${PREFIX}B2 board zamítnutí ${TAG}`, status: "nabidka", customerId: CUST.id, ownerId: ID.obchod });
const B2Q = createQuote(B2, {
  number: `E2EQDF-${TAG}-B2`, status: "odeslano", approvedBy: ID.admin, createdBy: ID.admin, customerId: CUST.id, sent: true,
  items: [{ drawing: `QDF-${TAG}-B2`, name: "Hřídel B2", qty: 1, price: 7300 }],
});
const P1 = createJob({
  title: `${PREFIX}P1 nacenění ${TAG}`, status: "poptavka", customerId: CUST.id, ownerId: ID.obchod, reqDays: 30, cinq: `RFQ-P1-${TAG}`,
  items: [{ drawing: `QDF-${TAG}-P1`, name: "Deska P1", material: "1.2379", qty: 6, price: null, purchase: PURCHASE }],
});
const DOC1 = createJob({
  title: `${PREFIX}DOC1 panel ${TAG}`, status: "objednavka", customerId: CUST.id, ownerId: ID.obchod, cpo: `QDF-DOC-${TAG}`, dueDays: 15, value: 4200,
  items: [{ drawing: `QDF-${TAG}-DOC`, name: "Matrice DOC1", qty: 2, price: 2100 }],
});
const INQ_TITLE = `${PREFIX}poptávka ${TAG}`;
const INQ_CUSTOMER = `${PREFIX}Nový zákazník ${TAG}`;

/** Stav sdílený mezi testy (čísla nabídek a dokladů). */
const st = { q1: null, r2: null, p1Quote: null };

// ── Pomocníci UI ─────────────────────────────────────────────
async function openJob(page, user, job, tab) {
  await login(page, user);
  await page.goto(`${BASE}/orders/${job.id}${tab ? `?tab=${tab}` : ""}`);
  await page.locator('main section[aria-label="Zakázka"]').waitFor({ timeout: 20_000 });
  await waitHydrated(page, 'main section[aria-label="Zakázka"] button[aria-label^="Stav zakázky:"]');
}
const activePanel = (page) => page.locator("main [role=tabpanel][data-state=active]");
/** Karta nabídky v záložce Nabídky (číslo přesně). */
const quoteCard = (page, number) =>
  activePanel(page).locator("article").filter({ has: page.locator("span.font-mono", { hasText: new RegExp(`^${esc(number)}$`) }) });
async function openTab(page, name) {
  await page.getByRole("tab", { name: new RegExp(`^${name}`) }).click();
  await page.waitForFunction((n) => {
    const el = document.querySelector('main [role=tab][aria-selected="true"]');
    return el && el.textContent.trim().startsWith(n);
  }, name, { timeout: 10_000 });
}
async function quoteMenu(page, card, item) {
  await card.getByRole("button", { name: "Další akce nabídky" }).click();
  await page.getByRole("menuitem", { name: item }).click();
}
/** #25: nabídku obchodníka schvaluje jen super admin — v samostatném kontextu (vlastní přihlášení). */
async function approveInDetailAsAdmin(job, number) {
  await withContext(browser, errors, async (ac) => {
    const ap = await ac.newPage();
    await openJob(ap, USERS.admin, job, "nabidky");
    const c = quoteCard(ap, number);
    await c.getByRole("button", { name: "Schválit", exact: true }).click();
    await waitToast(ap, /schválena/);
    await eventually(async () => expect(await c.getByRole("button", { name: "Schválit", exact: true }).count() === 0, "schváleno super adminem"));
  });
}
async function flowPage(page, path, title) {
  await page.goto(`${BASE}${path}`);
  await page.locator("main h1").filter({ hasText: title }).first().waitFor({ timeout: 20_000 });
  await page.waitForFunction(() => !document.querySelector('div[hidden][id^="S:"]'), null, { timeout: 20_000 });
}
const jobRow = (page, job) => page.locator("main li").filter({ has: page.locator(`a[href="/orders/${job.id}"]`) }).first();
const sentEvents = (jobId) =>
  sql(`select type || ': ' || message from job_events where job_id = ${lit(jobId)} and type in ('quote','email') and message ilike '%odeslán%' order by created_at`)
    .split("\n").filter(Boolean);

// ═════════════════════════ PDF API ═════════════════════════

await T("PDF API: náhled nabídky i dokladů → 200 application/pdf %PDF, nic se neukládá; bez přihlášení 401, cizí nabídka 404, neznámý typ 400", async (context) => {
  const page = await context.newPage();
  const anon = await fetchPdf(page.request, `${BASE}/api/pdf/job/${Q2.id}?type=nabidka&quoteId=${Q2Q.id}`);
  expect(anon.status === 401, `bez přihlášení 401, je ${anon.status}`);
  await login(page, USERS.obchod);
  const filesBefore = sql(`select count(*) from job_files where job_id in (${lit(Q2.id)}, ${lit(D1.id)})`);
  const q = await fetchPdf(page.request, `${BASE}/api/pdf/job/${Q2.id}?type=nabidka&quoteId=${Q2Q.id}`);
  expectPdf(q, "náhled nabídky");
  expect(/inline/.test(q.disposition) && /\.pdf"/.test(q.disposition), `Content-Disposition inline + .pdf (${q.disposition})`);
  for (const type of ["potvrzeni", "dodaci-list", "faktura"]) {
    expectPdf(await fetchPdf(page.request, `${BASE}/api/pdf/job/${D1.id}?type=${type}`), `náhled ${type}`);
  }
  const dl = await fetchPdf(page.request, `${BASE}/api/pdf/job/${D1.id}?type=dodaci-list&download=1`);
  expect(/attachment/.test(dl.disposition), `download=1 → attachment (${dl.disposition})`);
  const foreign = await fetchPdf(page.request, `${BASE}/api/pdf/job/${Q1.id}?type=nabidka&quoteId=${Q2Q.id}`);
  expect(foreign.status === 404, `nabídka jiné zakázky → 404, je ${foreign.status}`);
  const noQuote = await fetchPdf(page.request, `${BASE}/api/pdf/job/${Q1.id}?type=nabidka`);
  expect(noQuote.status === 404, `zakázka bez nabídky → 404, je ${noQuote.status}`);
  const bad = await fetchPdf(page.request, `${BASE}/api/pdf/job/${D1.id}?type=xyz`);
  expect(bad.status === 400, `neznámý typ → 400, je ${bad.status}`);
  const badId = await fetchPdf(page.request, `${BASE}/api/pdf/job/nic?type=faktura`);
  expect(badId.status === 404, `neplatné id → 404, je ${badId.status}`);
  expect(sql(`select count(*) from job_files where job_id in (${lit(Q2.id)}, ${lit(D1.id)})`) === filesBefore, "náhled nic neuložil do Dokumentů");
  const nums = sql(`select coalesce(delivery_note_number,'-') || '|' || coalesce(invoice_number,'-') from orders where id = ${lit(D1.id)}`);
  expect(nums === "-|-", `náhled nespotřeboval čísla DL/FV (${nums})`);
});

// ═════════════════════════ KARTA ZAKÁZKY · NABÍDKY ═════════════════════════

await T("detail Nabídky: nová nabídka z položek (ceny, platnost, lhůta) → NAB-…, Neschválená, „Zadal“ obchodník, DB", async (context) => {
  const page = await context.newPage();
  await openJob(page, USERS.obchod, Q1, "nabidky");
  const panel = activePanel(page);
  await panel.getByText("Zatím žádná nabídka").waitFor({ timeout: 10_000 });
  await panel.getByRole("button", { name: "Vytvořit nabídku z 2 položek" }).click();
  const dlg = page.getByRole("dialog");
  await dlg.getByRole("heading", { name: "Nová nabídka" }).waitFor({ timeout: 10_000 });
  const table = dlg.locator("table");
  const drawings = await table.locator('input[aria-label="Číslo výkresu"]').evaluateAll((els) => els.map((e) => e.value));
  expect(JSON.stringify(drawings) === JSON.stringify([`QDF-${TAG}-A`, `QDF-${TAG}-B`]), `předvyplněné výkresy z položek (${drawings})`);
  const qty = await table.locator('input[aria-label="Množství"]').evaluateAll((els) => els.map((e) => e.value));
  expect(qty[0] === "4" && qty[1] === "10", `předvyplněné počty (${qty})`);
  const purchase = await table.locator('input[aria-label="Nákupní cena za MJ"]').first().inputValue();
  expect(/4\s?817[.,]29/.test(purchase), `obchodník vidí nákupní cenu z položky (${purchase})`);
  const validInput = dlg.locator('input[type="date"]');
  expect((await validInput.inputValue()) === isoDays(30), `výchozí platnost +30 dní (${await validInput.inputValue()})`);
  const lead = dlg.getByLabel(/Dodací lhůta/);
  expect((await lead.inputValue()) === "25", `lhůta předvyplněná podle požadovaného termínu (25), je ${await lead.inputValue()}`);
  const paymentTerms = await dlg.getByLabel("Platební podmínky").inputValue();
  expect(paymentTerms.includes("14 dní"), `platební podmínky ze splatnosti zákazníka (${paymentTerms})`);
  await table.locator('input[aria-label="Cena za MJ"]').nth(0).fill("1250,50");
  await table.locator('input[aria-label="Cena za MJ"]').nth(1).fill("89");
  await validInput.fill(isoDays(21));
  await lead.fill("18");
  await dlg.getByLabel("Poznámka na nabídce").fill(`Poznámka E2E ${TAG}`);
  await shot(page, S("01-quote-editor"));
  await dlg.getByRole("button", { name: "Vytvořit nabídku", exact: true }).click();
  // #25 (§13): obchodníkova nabídka čeká na super admina
  await waitToast(page, /vytvořena — čeká na schválení super admina/);

  const row = await eventually(() => {
    const r = sql(`select id || '|' || number || '|' || status || '|' || total || '|' || valid_until || '|' || lead_time_days || '|' || created_by || '|' || coalesce(approved_by::text,'-') || '|' || revision || '|' || (case when archived then 't' else 'f' end) || '|' || coalesce(note,'')
      from quotes where job_id = ${lit(Q1.id)}`);
    expect(r, "nabídka v DB");
    return r.split("|");
  });
  const [qid, number, status, total, valid, leadDays, createdBy, approvedBy, revision, archived, note] = row;
  st.q1 = { id: qid, number };
  expect(/^NAB-\d{4}-\d+$/.test(number), `číslo NAB-RRRR-NNN (${number})`);
  expect(status === "ke_schvaleni" && approvedBy === "-", `stav ke_schvaleni, neschváleno (${status}, ${approvedBy})`);
  // #25: nabídku kohokoli kromě super admina musí schválit super admin → Neschválená
  const qs = sql(`select state || '|' || approval_required || '|' || admin_approval_required || '|' || coalesce(state_changed_by::text, '-') from quotes where id = ${lit(qid)}`);
  expect(qs === `ke_schvaleni|true|true|${ID.obchod}`, `quotes.state Neschválená (čeká na super admina), autor obchodník (${qs})`);
  expect(num(total) === 5892, `celkem 4×1250,50 + 10×89 = 5892 (${total})`);
  expect(valid === isoDays(21) && leadDays === "18", `platnost ${valid}, lhůta ${leadDays}`);
  expect(createdBy === ID.obchod && revision === "1" && archived === "f", `zadal obchodník, rev 1, ne archiv (${createdBy}, ${revision}, ${archived})`);
  expect(note === `Poznámka E2E ${TAG}`, `poznámka uložena (${note})`);
  const items = sql(`select drawing_number || '|' || quantity || '|' || unit_price || '|' || coalesce(purchase_unit_price::text,'-') from quote_items where quote_id = ${lit(qid)} order by position`).split("\n");
  expect(items.length === 2 && num(items[0].split("|")[2]) === 1250.5 && num(items[0].split("|")[3]) === PURCHASE, `položky nabídky (${items.join(" ; ")})`);
  expect(sql(`select priced_by from orders where id = ${lit(Q1.id)}`) === ID.obchod, "zakázka: nacenil = obchodník (první nacenená nabídka)");
  const ev = sql(`select message || '|' || actor_id from job_events where job_id = ${lit(Q1.id)} and type = 'quote' order by created_at desc limit 1`);
  expect(ev === `Nabídka ${number} vytvořena — čeká na schválení super admina|${ID.obchod}`, `historie: ${ev}`);

  const card = quoteCard(page, number);
  await card.waitFor({ timeout: 10_000 });
  const t = norm(await card.innerText());
  for (const s of ["rev. 1", "Neschválená", "Petr Obchodník", "čeká na schválení", "5 892", "18 dní"]) expect(t.includes(s), `karta nabídky obsahuje „${s}" (${t.slice(0, 300)})`);
  // kdo stav nastavil — razítko u stavu karty (jméno, ne prázdné)
  expect(await card.getByRole("button", { name: /^Neschválená: Petr Obchodník.* — podrobnosti$/ }).isVisible(), "razítko stavu: Neschválená · Petr Obchodník");
  // #25: odeslat půjde až po schválení super adminem; obchodník sám neschvaluje
  // #25 (§7): tlačítko zůstává vidět, ale zamčené s vysvětlením
  const sendBtn = card.getByRole("button", { name: "Odeslat zákazníkovi" });
  expect(await sendBtn.count() === 1 && await sendBtn.isDisabled(), "neschválenou nabídku nejde odeslat (tlačítko zamčené)");
  expect(t.includes("Odeslat půjde po schválení super adminem."), "vysvětlení u zamčeného odeslání");
  expect(await card.getByRole("button", { name: "Schválit", exact: true }).count() === 0, "obchodník nabídku neschvaluje (jen super admin)");
  expect(/Nabídky\s*1/.test(await page.getByRole("tab", { name: /^Nabídky/ }).innerText()), "záložka Nabídky ukazuje 1");
  await shot(page, S("02-quote-created"));
});

await T("detail Nabídky: schválení super adminem → „Schválil“ + datum, orders.approved_by, odeslání odemčeno", async (context) => {
  expect(st.q1, "předchozí test vytvořil nabídku");
  const page = await context.newPage();
  await openJob(page, USERS.admin, Q1, "nabidky");
  const card = quoteCard(page, st.q1.number);
  await card.getByRole("button", { name: "Schválit", exact: true }).click();
  await waitToast(page, /schválena — Petr Obchodník ji teď může odeslat/);
  await eventually(async () => {
    const t = norm(await card.innerText());
    expect(t.includes("Super Admin") && !t.includes("čeká na schválení"), `karta: Schválil Super Admin (${t.slice(0, 300)})`);
  });
  expect(await card.getByRole("button", { name: "Schválit", exact: true }).count() === 0, "tlačítko Schválit zmizelo");
  expect(await card.getByRole("button", { name: "Odeslat zákazníkovi" }).isEnabled(), "Odeslat zákazníkovi je povolené");
  const db = sql(`select q.approved_by || '|' || (q.approved_at is not null) || '|' || q.status || '|' || o.approved_by || '|' || q.state || '|' || q.state_changed_by from quotes q join orders o on o.id = q.job_id where q.id = ${lit(st.q1.id)}`);
  expect(db === `${ID.admin}|true|ke_schvaleni|${ID.admin}|schvalena|${ID.admin}`, `DB schválení: ${db}`);
  expect(await card.getByRole("button", { name: /^Schválená: Super Admin.* — podrobnosti$/ }).isVisible(), "razítko stavu: Schválená · Super Admin");
  const ev = sql(`select message || '|' || actor_id from job_events where job_id = ${lit(Q1.id)} and type = 'quote' order by created_at desc limit 1`);
  expect(ev === `Nabídka ${st.q1.number} schválena — připravil(a) Petr Obchodník|${ID.admin}`, `historie: ${ev}`);
  await shot(page, S("03-quote-approved"));
});

await T("detail Nabídky: PDF náhled z karty → 200 application/pdf %PDF, náhled nic neukládá", async (context) => {
  expect(st.q1, "nabídka existuje");
  const page = await context.newPage();
  await openJob(page, USERS.obchod, Q1, "nabidky");
  const card = quoteCard(page, st.q1.number);
  const href = await card.getByRole("link", { name: "PDF náhled" }).getAttribute("href");
  expect(href === `/api/pdf/job/${Q1.id}?type=nabidka&quoteId=${st.q1.id}`, `odkaz PDF náhledu (${href})`);
  const link = card.getByRole("link", { name: "PDF náhled" });
  expect((await link.getAttribute("target")) === "_blank" && /noopener/.test((await link.getAttribute("rel")) ?? ""), "odkaz otevírá nový panel (target=_blank, noopener)");
  // nový panel se otevře; headless Chromium u PDF prohlížeče adresu nehlásí (":"), obsah ověří fetch níže
  const [popup] = await Promise.all([page.waitForEvent("popup", { timeout: 10_000 }), link.click()]);
  expect(popup.url() !== page.url(), `PDF se otevřelo v novém panelu, karta zůstala (${popup.url()})`);
  await popup.close();
  expectPdf(await fetchPdf(page.request, `${BASE}${href}`), "PDF náhled nabídky");
  expect(sql(`select count(*) from job_files where job_id = ${lit(Q1.id)}`) === "0", "náhled nic neuložil do Dokumentů");
});

await T("detail Nabídky: odeslání e-mailem — dialog předvyplněný, mail s PDF přílohou, stav Odesláno, zakázka → Nabídka odeslaná", async (context) => {
  expect(st.q1, "nabídka existuje");
  const page = await context.newPage();
  await openJob(page, USERS.obchod, Q1, "nabidky");
  const card = quoteCard(page, st.q1.number);
  await card.getByRole("button", { name: "Odeslat zákazníkovi" }).click();
  const dlg = page.getByRole("dialog");
  await dlg.getByRole("heading", { name: `Odeslat nabídku ${st.q1.number} zákazníkovi` }).waitFor({ timeout: 10_000 });
  const chip = dlg.locator('a[href^="/api/jobs/files/"]');
  await chip.waitFor({ timeout: 30_000 });
  const chipText = norm(await chip.innerText());
  expect(chipText.includes(".pdf") && chipText.includes(st.q1.number.replace(/^NAB-/, "")), `příloha PDF s číslem nabídky (${chipText})`);
  const to = await recipients(dlg, "Komu");
  const subject = await dlg.getByLabel("Předmět").inputValue();
  const body = await dlg.getByLabel("Text e-mailu").inputValue();
  expect(to === CUST_EMAIL, `Komu = e-mail zákazníka (${to})`);
  expect(subject.includes(st.q1.number), `předmět obsahuje číslo nabídky (${subject})`);
  expect(body.length > 40 && body.includes(st.q1.number), `text e-mailu předvyplněný s číslem nabídky (${body.slice(0, 120)})`);
  const pdfFile = sql(`select id || '|' || kind || '|' || coalesce(quote_id::text,'-') || '|' || version from job_files where job_id = ${lit(Q1.id)}`);
  expect(pdfFile.split("|")[1] === "nabidka" && pdfFile.split("|")[2] === st.q1.id, `PDF nabídky uložené k zakázce s quote_id (${pdfFile})`);
  // neplatná adresa → hláška, nic neodejde
  await setRecipients(dlg, "Komu", "neplatna-adresa");
  await dlg.getByRole("button", { name: "Odeslat zákazníkovi" }).click();
  await dlg.getByText(/Neplatná e-mailová adresa/).waitFor({ timeout: 5_000 });
  await setRecipients(dlg, "Komu", CUST_EMAIL);
  await shot(page, S("04-quote-send-dialog"));
  const t0 = new Date().toISOString();
  await dlg.getByRole("button", { name: "Odeslat zákazníkovi" }).click();
  await waitToast(page, new RegExp(`Nabídka ${esc(st.q1.number)} odeslána na`), 30_000);
  await dlg.waitFor({ state: "hidden", timeout: 10_000 });

  const mail = await waitMail(CUST_EMAIL, (m) => m.subject.includes(st.q1.number) && m.receivedAt > t0);
  expect(mail, "mail catcher přijal e-mail s nabídkou");
  expect(mail.attachments?.length === 1, `jedna příloha (${JSON.stringify(mail.attachments)})`);
  expect(mail.attachments[0].contentType === "application/pdf" && /\.pdf$/i.test(mail.attachments[0].filename), `příloha PDF (${JSON.stringify(mail.attachments[0])})`);
  expect(mail.attachments[0].size > 1500, "příloha není prázdná");
  expect(mail.text.includes(st.q1.number), "text e-mailu s číslem nabídky");
  expect((await mailsTo(CUST_EMAIL)).filter((m) => m.subject.includes(st.q1.number)).length === 1, "odešel právě jeden e-mail");

  await eventually(() => {
    const db = sql(`select q.status || '|' || (q.sent_at is not null) || '|' || o.status from quotes q join orders o on o.id = q.job_id where q.id = ${lit(st.q1.id)}`);
    expect(db === "odeslano|true|nabidka", `DB: nabídka odesláno + sent_at, zakázka nabidka (${db})`);
  });
  const out = sql(`select count(*) || '|' || coalesce(max(owner_id::text),'-') from emails where order_id = ${lit(Q1.id)} and direction = 'out' and subject like ${lit(`%${st.q1.number}%`)}`);
  expect(out === `1|${ID.obchod}`, `odeslaná pošta: 1 záznam, odesílatel obchodník (${out})`);
  const stage = sql(`select message || '|' || actor_id || '|' || actor_name || '|' || via from job_events where job_id = ${lit(Q1.id)} and type = 'stage' order by created_at desc limit 1`);
  expect(stage.startsWith("Stav: Nacenění → Nabídka odeslaná") && stage.endsWith(`|${ID.obchod}|Petr Obchodník|automaticky`), `historie: posun stavu automaticky, spustil obchodník (${stage})`);
  const qdb = sql(`select state || '|' || sent_by || '|' || sent_via from quotes where id = ${lit(st.q1.id)}`);
  expect(qdb === `odeslana|${ID.obchod}|email`, `DB: Odeslaná e-mailem, odeslal obchodník (${qdb})`);
  await eventually(async () => {
    const t = norm(await card.innerText());
    expect(t.includes("Odesláno"), `karta: stav Odesláno (${t.slice(0, 200)})`);
  });
  expect(await card.getByRole("button", { name: "Odeslat znovu" }).isVisible(), "tlačítko Odeslat znovu");
  expect(await page.locator('main section[aria-label="Zakázka"]').getByRole("button", { name: "Stav zakázky: Nabídka odeslaná — změnit" }).isVisible(), "hlavička: Nabídka odeslaná");
  await shot(page, S("05-quote-sent"));
});

await T("historie: odeslání nabídky z karty = JEN JEDNA událost „odeslána“ (DB i záložka Historie)", async (context) => {
  expect(st.q1, "nabídka odeslaná");
  const ev = sentEventsOf(Q1.id);
  const page = await context.newPage();
  await openJob(page, USERS.obchod, Q1, "historie");
  const items = activePanel(page).locator("ol > li").filter({ hasText: /Odeslána nabídka|odeslána zákazníkovi/ });
  await items.first().waitFor({ timeout: 10_000 });
  const ui = (await items.allInnerTexts()).map(norm);
  await shot(page, S("06-history-sent"));
  expect(ev.length === 1, `v DB právě 1 událost odeslání, je ${ev.length}: ${ev.join(" ‖ ")}`);
  expect(ui.length === 1, `v záložce Historie právě 1 položka odeslání, je ${ui.length}: ${ui.join(" ‖ ")}`);
});

await T("detail Nabídky: nová verze (R2) → stará archivována, „Starší verze (1)“, rev. 2 neschválená", async (context) => {
  expect(st.q1, "nabídka existuje");
  const page = await context.newPage();
  await openJob(page, USERS.obchod, Q1, "nabidky");
  await quoteMenu(page, quoteCard(page, st.q1.number), "Nová verze (stará se archivuje)");
  await waitToast(page, /Vytvořena nová verze nabídky/);
  const r2 = `${st.q1.number}-R2`;
  const card = quoteCard(page, r2);
  await card.waitFor({ timeout: 10_000 });
  const t = norm(await card.innerText());
  // #25: nová verze od obchodníka = znovu Neschválená
  for (const s of ["rev. 2", "Neschválená", "čeká na schválení", "5 892", "Petr Obchodník"]) expect(t.includes(s), `karta R2 obsahuje „${s}" (${t.slice(0, 250)})`);
  expect(await quoteCard(page, st.q1.number).count() === 0, "původní verze není mezi aktuálními");
  const older = activePanel(page).getByRole("button", { name: "Starší verze (1)" });
  expect(await older.isVisible(), "odkaz Starší verze (1)");
  await older.click();
  const old = quoteCard(page, st.q1.number);
  await old.waitFor({ timeout: 5_000 });
  expect(/archiv/i.test(norm(await old.innerText())), "stará verze je v archivu (Archivovaná)");
  const db = sql(`select number || '|' || revision || '|' || status || '|' || (case when archived then 't' else 'f' end) || '|' || coalesce(approved_by::text,'-') || '|' || total || '|' || created_by || '|' || id
    from quotes where job_id = ${lit(Q1.id)} order by revision`).split("\n");
  expect(db.length === 2, `2 nabídky v DB (${db.join(" ; ")})`);
  const [o, n] = db.map((r) => r.split("|"));
  expect(o[3] === "t" && o[2] === "odeslano", `stará: archivována, stav odesláno (${db[0]})`);
  const states = sql(`select string_agg(state, ',' order by revision) from quotes where job_id = ${lit(Q1.id)}`);
  expect(states === "archivovana,ke_schvaleni", `podrobné stavy verzí: archivovaná, neschválená (${states})`);
  expect(n[0] === r2 && n[1] === "2" && n[2] === "ke_schvaleni" && n[3] === "f" && n[4] === "-" && num(n[5]) === 5892 && n[6] === ID.obchod, `nová verze (${db[1]})`);
  st.r2 = { id: n[7], number: r2 };
  expect(sql(`select count(*) from quote_items where quote_id = ${lit(st.r2.id)}`) === "2", "položky zkopírované do nové verze");
  const ev = sql(`select message from job_events where job_id = ${lit(Q1.id)} and type = 'quote' order by created_at desc limit 1`);
  expect(ev === `Nová verze nabídky ${r2} (verze 2) — ${st.q1.number} archivována — čeká na schválení super admina`, `historie: ${ev}`);
  expect(/Nabídky\s*1/.test(await page.getByRole("tab", { name: /^Nabídky/ }).innerText()), "záložka Nabídky počítá jen aktuální (1)");
  await shot(page, S("07-quote-revision"));
});

await T("detail Nabídky: úprava verze (cena) → nový součet v DB i na kartě", async (context) => {
  expect(st.r2, "R2 existuje");
  const page = await context.newPage();
  await openJob(page, USERS.obchod, Q1, "nabidky");
  await quoteMenu(page, quoteCard(page, st.r2.number), "Upravit nabídku");
  const dlg = page.getByRole("dialog");
  await dlg.getByRole("heading", { name: `Upravit nabídku ${st.r2.number}` }).waitFor({ timeout: 10_000 });
  await dlg.locator('table input[aria-label="Cena za MJ"]').first().fill("1200");
  await dlg.getByRole("button", { name: "Uložit nabídku" }).click();
  await waitToast(page, new RegExp(`Nabídka ${esc(st.r2.number)} uložena`));
  await eventually(() => {
    const tot = sql(`select total from quotes where id = ${lit(st.r2.id)}`);
    expect(num(tot) === 5690, `DB total 4×1200 + 10×89 = 5690 (${tot})`);
  });
  await eventually(async () => expect(norm(await quoteCard(page, st.r2.number).innerText()).includes("5 690"), "karta ukazuje 5 690"));
});

await T("detail Nabídky: archivace a obnovení verze z archivu", async (context) => {
  expect(st.r2, "R2 existuje");
  const page = await context.newPage();
  await openJob(page, USERS.obchod, Q1, "nabidky");
  await quoteMenu(page, quoteCard(page, st.r2.number), "Archivovat");
  await waitToast(page, new RegExp(`Nabídka ${esc(st.r2.number)} archivována`));
  await activePanel(page).getByText("Zatím žádná nabídka").waitFor({ timeout: 10_000 });
  expect(sql(`select archived from quotes where id = ${lit(st.r2.id)}`) === "t", "DB: R2 archivována");
  const older = activePanel(page).getByRole("button", { name: "Starší verze (2)" });
  await older.click();
  await shot(page, S("08-quote-all-archived"));
  await quoteMenu(page, quoteCard(page, st.r2.number), "Obnovit z archivu");
  await waitToast(page, new RegExp(`Nabídka ${esc(st.r2.number)} obnovena`));
  await eventually(() => expect(sql(`select archived from quotes where id = ${lit(st.r2.id)}`) === "f", "DB: R2 obnovena"));
  await eventually(async () => expect(await activePanel(page).getByText("Zatím žádná nabídka").count() === 0, "prázdný stav zmizel"));
  const evs = sql(`select string_agg(message, ' ; ' order by created_at) from (select message, created_at from job_events where job_id = ${lit(Q1.id)} and type = 'quote' order by created_at desc limit 2) x`);
  expect(evs === `Nabídka ${st.r2.number} archivována ; Nabídka ${st.r2.number} obnovena z archivu`, `historie: ${evs}`);
});

await T("detail Nabídky: přijetí — super admin schválí R2, „Odesláno jinak“, „Přijata zákazníkem“ → Přijatá, zakázka Objednávka, hodnota = nabídka, orders.quote_id", async (context) => {
  expect(st.r2, "R2 existuje");
  // #25: R2 schválí super admin, obchodník ji pak odešle
  await approveInDetailAsAdmin(Q1, st.r2.number);
  const page = await context.newPage();
  await openJob(page, USERS.obchod, Q1, "nabidky");
  const card = quoteCard(page, st.r2.number);
  expect(await card.getByRole("button", { name: "Schválit", exact: true }).count() === 0, "schváleno");
  // přijmout jde jen odeslanou nabídku (1.3) — tady odešla osobně
  await quoteMenu(page, card, "Odesláno jinak…");
  const sentDlg = page.getByRole("dialog");
  await sentDlg.getByRole("heading", { name: `Odesláno jinak — ${st.r2.number}` }).waitFor({ timeout: 10_000 });
  await sentDlg.getByRole("textbox").fill(`předáno osobně ${TAG}`);
  await sentDlg.getByRole("button", { name: "Označit jako odeslanou" }).click();
  await waitToast(page, new RegExp(`Nabídka ${esc(st.r2.number)} označena jako odeslaná`));
  await eventually(() => {
    const q = sql(`select state || '|' || sent_via || '|' || sent_by from quotes where id = ${lit(st.r2.id)}`);
    expect(q === `odeslana|rucne|${ID.obchod}`, `DB: Odeslaná jinak, odeslal obchodník (${q})`);
  });
  const sentEv = sql(`select message || '|' || actor_id from job_events where job_id = ${lit(Q1.id)} and type = 'quote' order by created_at desc limit 1`);
  expect(sentEv === `Nabídka ${st.r2.number} odeslána zákazníkovi (jinak než e-mailem) — předáno osobně ${TAG}|${ID.obchod}`, `historie: odesláno jinak s poznámkou (${sentEv})`);
  await card.getByRole("button", { name: "Přijata zákazníkem" }).click();
  const dlg = page.getByRole("dialog");
  await dlg.getByRole("heading", { name: `Zákazník přijal nabídku ${st.r2.number}?` }).waitFor({ timeout: 10_000 });
  expect(norm(await dlg.innerText()).includes("5 690"), "dialog uvádí novou hodnotu zakázky");
  await dlg.getByRole("button", { name: "Ano, přijata" }).click();
  await waitToast(page, /přijata — zakázka je teď Objednávka/);
  await eventually(() => {
    const db = sql(`select q.status || '|' || o.status || '|' || o.value || '|' || coalesce(o.quote_id::text,'-') || '|' || q.state || '|' || coalesce(o.order_status, '-') from quotes q join orders o on o.id = q.job_id where q.id = ${lit(st.r2.id)}`).split("|");
    expect(db[0] === "prijato" && db[1] === "objednavka" && num(db[2]) === 5690 && db[3] === st.r2.id && db[4] === "prijata" && db[5] === "dorucena", `DB přijetí (+ objednávka Doručená): ${db.join("|")}`);
  });
  await eventually(async () => expect(norm(await card.innerText()).includes("Přijatá — platí pro zakázku"), "karta: Přijatá — platí pro zakázku"));
  expect(await page.locator('main section[aria-label="Zakázka"]').getByRole("button", { name: "Stav zakázky: Objednávka — změnit" }).isVisible(), "hlavička: Objednávka");
  const ev = sql(`select message || '|' || actor_id from job_events where job_id = ${lit(Q1.id)} and type = 'quote' order by created_at desc limit 1`);
  expect(ev === `Nabídka ${st.r2.number} přijata zákazníkem|${ID.obchod}`, `historie: ${ev}`);
  await shot(page, S("09-quote-accepted"));
});

await T("detail Nabídky: zamítnutí s důvodem (super admin) → Zamítnuto, rejected_reason, historie", async (context) => {
  const page = await context.newPage();
  await openJob(page, USERS.admin, Q2, "nabidky");
  const card = quoteCard(page, Q2Q.number);
  await quoteMenu(page, card, "Zákazník nabídku zamítl…");
  const dlg = page.getByRole("dialog");
  await dlg.getByRole("heading", { name: `Zákazník nabídku zamítl — ${Q2Q.number}` }).waitFor({ timeout: 10_000 });
  expect(norm(await dlg.innerText()).includes("Zakázka → Nerealizováno"), "náhled dopadu: jediná otevřená nabídka → zakázka Nerealizováno");
  const confirm = dlg.getByRole("button", { name: "Zamítnuta" });
  expect(await confirm.isDisabled(), "bez důvodu nejde potvrdit");
  await dlg.getByRole("radio", { name: "Cena", exact: true }).click();
  await dlg.getByRole("textbox").fill("Konkurence o 12 % levnější");
  await shot(page, S("10-quote-reject-dialog"));
  await confirm.click();
  await waitToast(page, new RegExp(`Nabídka ${esc(Q2Q.number)} zamítnuta`));
  await eventually(() => {
    const db = sql(`select q.status || '|' || q.state || '|' || coalesce(q.lost_reason,'-') || '|' || coalesce(q.rejected_reason,'-') || '|' || coalesce(q.state_changed_by::text,'-') || '|' || o.status || '|' || coalesce(o.lost_reason,'-')
      from quotes q join orders o on o.id = q.job_id where q.id = ${lit(Q2Q.id)}`);
    expect(db === `zamitnuto|zamitnuta|cena|Konkurence o 12 % levnější|${ID.admin}|nerealizovano|cena`, `DB: ${db}`);
  });
  await eventually(async () => expect(norm(await card.innerText()).includes("Zamítnutá"), "karta: Zamítnutá"));
  expect(await card.getByRole("button", { name: "Přijata zákazníkem" }).count() === 0, "zamítnutou nabídku už nelze přijmout");
  const ev = sql(`select message || '|' || actor_id from job_events where job_id = ${lit(Q2.id)} and type = 'quote' order by created_at desc limit 1`);
  expect(ev === `Nabídka ${Q2Q.number} zamítnuta — Cena: Konkurence o 12 % levnější|${ID.admin}`, `historie: ${ev}`);
  const stage = sql(`select message || '|' || actor_id from job_events where job_id = ${lit(Q2.id)} and type = 'stage' order by created_at desc limit 1`);
  expect(stage.startsWith("Stav: Nabídka odeslaná → Nerealizováno") && stage.endsWith(`|${ID.admin}`), `historie: zakázka uzavřena s autorem (${stage})`);
});

// ═════════════════════════ KARTA ZAKÁZKY · DOKLADY ▾ ═════════════════════════

async function issueFromMenu(page, label) {
  await page.getByRole("button", { name: "Doklady (PDF)" }).click();
  await page.getByRole("menuitem", { name: new RegExp(`^${label}`) }).click();
}
const filesOf = (jobId, kind) =>
  sql(`select id || '|' || version || '|' || (case when archived then 't' else 'f' end) || '|' || filename || '|' || coalesce(replaced_by::text,'-') || '|' || coalesce(uploaded_by::text,'-')
    from job_files where job_id = ${lit(jobId)} and kind = ${lit(kind)} order by version`).split("\n").filter(Boolean).map((r) => r.split("|"));

await T("Doklady ▾: Potvrzení s neoceněnou položkou → dialog „Přesto vystavit“ → PDF v Dokumentech (v1), historie", async (context) => {
  const page = await context.newPage();
  await openJob(page, USERS.obchod, D1);
  await issueFromMenu(page, "Potvrzení objednávky");
  const dlg = page.getByRole("dialog");
  await dlg.getByRole("heading", { name: "Doklad má položky bez ceny" }).waitFor({ timeout: 15_000 });
  expect(norm(await dlg.innerText()).includes("1 položka nemá cenu"), `dialog: 1 položka nemá cenu (${norm(await dlg.innerText()).slice(0, 200)})`);
  expect(filesOf(D1.id, "potvrzeni").length === 0, "bez potvrzení se nic nevystavilo");
  await shot(page, S("11-docs-unpriced-dialog"));
  await dlg.getByRole("button", { name: "Přesto vystavit" }).click();
  const toast = await waitToast(page, /Potvrzení objednávky POT-\S+ je hotový a uložený v Dokumentech/, 30_000);
  const files = await eventually(() => {
    const f = filesOf(D1.id, "potvrzeni");
    expect(f.length === 1, `1 potvrzení v DB (${f.length})`);
    return f;
  });
  expect(files[0][1] === "1" && files[0][2] === "f" && /\.pdf$/.test(files[0][3]) && files[0][5] === ID.obchod, `v1, aktuální, .pdf, nahrál obchodník (${files[0].join("|")})`);
  const ev = sql(`select message || '|' || actor_id from job_events where job_id = ${lit(D1.id)} and type = 'file' order by created_at desc limit 1`);
  expect(/^Vystaveno potvrzení objednávky POT-\S+ \(PDF\)\|/.test(ev) && ev.endsWith(ID.obchod), `historie: ${ev}`);
  const pdf = await fetchPdf(page.request, `${BASE}/api/jobs/files/${files[0][0]}`);
  expectPdf(pdf, "uložené potvrzení");
  expect(toast.includes("Otevřít PDF"), "toast nabízí Otevřít PDF");
  await openTab(page, "Dokumenty");
  const group = activePanel(page).locator("section").filter({ hasText: "Potvrzení" }).first();
  await group.waitFor({ timeout: 10_000 });
  expect(norm(await group.innerText()).includes("v1"), "Dokumenty: potvrzení v1");
  await shot(page, S("12-docs-confirmation-v1"));
});

await T("Doklady ▾: Potvrzení podruhé → v2, v1 v archivu (nahrazeno v2)", async (context) => {
  const page = await context.newPage();
  await openJob(page, USERS.obchod, D1);
  await issueFromMenu(page, "Potvrzení objednávky");
  const dlg = page.getByRole("dialog");
  await dlg.getByRole("heading", { name: "Doklad má položky bez ceny" }).waitFor({ timeout: 15_000 });
  await dlg.getByRole("button", { name: "Přesto vystavit" }).click();
  await waitToast(page, /Potvrzení objednávky POT-\S+ je hotový/, 30_000);
  const files = await eventually(() => {
    const f = filesOf(D1.id, "potvrzeni");
    expect(f.length === 2, `2 verze potvrzení (${f.length})`);
    return f;
  });
  expect(files[0][2] === "t" && files[0][4] === files[1][0], `v1 archivována a nahrazena v2 (${files[0].join("|")})`);
  expect(files[1][1] === "2" && files[1][2] === "f" && files[1][3] === files[0][3], `v2 aktuální, stejný název souboru (${files[1].join("|")})`);
  const ev = sql(`select message from job_events where job_id = ${lit(D1.id)} and type = 'file' order by created_at desc limit 1`);
  expect(/— verze 2$/.test(ev), `historie: … — verze 2 (${ev})`);
  await openTab(page, "Dokumenty");
  const group = activePanel(page).locator("section").filter({ hasText: "Potvrzení" }).first();
  await eventually(async () => expect(norm(await group.innerText()).includes("1 v archivu"), `skupina: 1 v archivu (${norm(await group.innerText()).slice(0, 120)})`));
});

// A2 (sk. 2): DL vzniká jen se zápisem dodání — Doklady ▾ → Dodací list otevře tentýž dialog jako hlavní
// „Zapsat dodání a dodací list" (dřív samostatný DL „na celou zakázku" bez dodávky = druhé číslo / úložiště)
await T("Doklady ▾: Dodací list → zápis dodání (předvyplněno vše) → DL-RRRR-NNN, orders.delivery_note_number, uložen v Dokumentech", async (context) => {
  const page = await context.newPage();
  await openJob(page, USERS.obchod, D1);
  await issueFromMenu(page, "Dodací list");
  const dlg = page.getByRole("dialog");
  await dlg.getByRole("button", { name: /^Zapsat dodání a dodací list/ }).click();
  const result = dlg.locator('[data-testid="delivery-note-result"]');
  await result.waitFor({ timeout: 30_000 });
  const dl = /DL-\d{4}-\d+/.exec(await result.innerText())[0];
  expect(await page.getByRole("heading", { name: "Doklad má položky bez ceny" }).count() === 0, "dodací list se na ceny neptá");
  await dlg.getByRole("button", { name: "Hotovo" }).click();
  await eventually(() => expect(sql(`select status from orders where id = ${lit(D1.id)}`) === "dodano_zakaznikovi", "vše dodáno → Dodáno zákazníkovi"));
  await eventually(() => expect(sql(`select delivery_note_number from orders where id = ${lit(D1.id)}`) === dl, `orders.delivery_note_number = ${dl}`));
  const f = filesOf(D1.id, "dodaci_list");
  expect(f.length === 1 && f[0][1] === "1" && f[0][3].includes(dl.replace(/^DL-/, "")), `job_files dodací list v1 (${f.map((x) => x.join("|")).join(" ; ")})`);
  expectPdf(await fetchPdf(page.request, `${BASE}/api/jobs/files/${f[0][0]}`), "uložený dodací list");
});

// A2 (sk. 1, 9): Doklady ▾ → Faktura = tentýž dialog jako hlavní „Vystavit fakturu" (PDF + odeslání jako u nabídky);
// neoceněná položka → „Přesto vystavit" v dialogu, pak „Vystavit, neposílat" (faktura vznikne až tímto tlačítkem)
await T("Doklady ▾: Faktura (neoceněná položka → Přesto vystavit → Vystavit, neposílat) → FV-…, evidence faktur + archiv dokladů, zakázka Vyfakturováno", async (context) => {
  const page = await context.newPage();
  await openJob(page, USERS.obchod, D1);
  await issueFromMenu(page, "Faktura");
  const dlg = page.getByRole("dialog");
  await dlg.getByRole("heading", { name: "Vystavit fakturu a poslat zákazníkovi" }).waitFor({ timeout: 15_000 });
  await dlg.getByRole("button", { name: "Přesto vystavit" }).waitFor({ timeout: 20_000 });
  expect(sql(`select coalesce(invoice_number,'-') from orders where id = ${lit(D1.id)}`) === "-", "bez potvrzení se číslo faktury nespotřebovalo");
  await dlg.getByRole("button", { name: "Přesto vystavit" }).click();
  await dlg.getByRole("button", { name: "Vystavit, neposílat" }).waitFor({ timeout: 30_000 });
  // review A2 #5: ani „Přesto vystavit" fakturu nevystaví — vznikne až tlačítkem
  expect(sql(`select coalesce(invoice_number,'-') from orders where id = ${lit(D1.id)}`) === "-", "před vystavením bez čísla faktury");
  await dlg.getByRole("button", { name: "Vystavit, neposílat" }).click();
  const toast = await waitToast(page, /Faktura FV-\S+ je vystaven/, 30_000);
  const fv = /FV-[\w-]+/.exec(toast)[0];
  await eventually(() => {
    const o = sql(`select coalesce(invoice_number,'-') || '|' || status from orders where id = ${lit(D1.id)}`);
    expect(o === `${fv}|fakturovano`, `orders: číslo faktury + Vyfakturováno (${o})`);
  });
  const inv = sql(`select number || '|' || status || '|' || total || '|' || coalesce(variable_symbol,'-') || '|' || (storage_path is not null) from invoices where order_id = ${lit(D1.id)}`);
  expect(inv.startsWith(`${fv}|vystavena|`) && num(inv.split("|")[2]) === 3630 && inv.endsWith("|true"), `invoices: ${inv} (3000 + 21 % DPH = 3630)`);
  const doc = sql(`select doc_type || '|' || number from documents where order_id = ${lit(D1.id)}`);
  expect(doc === `faktura|${fv}`, `archiv dokladů: ${doc}`);
  const f = filesOf(D1.id, "faktura");
  expect(f.length === 1 && f[0][1] === "1", `job_files faktura v1 (${f.length})`);
  expectPdf(await fetchPdf(page.request, `${BASE}/api/jobs/files/${f[0][0]}`), "uložená faktura");
  const stage = sql(`select message || '|' || actor_id || '|' || actor_name from job_events where job_id = ${lit(D1.id)} and type = 'stage' order by created_at desc limit 1`);
  // DL výše zapsal dodání všeho → zakázka šla přes „Dodáno zákazníkovi" (dřív DL bez dodání stav neměnil)
  expect(stage.startsWith("Stav: Dodáno zákazníkovi → Vyfakturováno") && stage.includes(fv) && stage.endsWith(`|${ID.obchod}|Petr Obchodník`), `historie stavu s číslem faktury a autorem: ${stage}`);
  // A2: datum a splatnost faktury i na zakázce (hlídání „po splatnosti") = splatnost z evidence faktur
  const due = sql(`select o.invoice_date || '|' || o.invoice_due_date || '|' || i.due_date from orders o join invoices i on i.number = o.invoice_number where o.id = ${lit(D1.id)}`).split("|");
  expect(due[0] && due[1] && due[1] === due[2], `orders.invoice_due_date = invoices.due_date (${due.join("|")})`);
  expect(sql(`select coalesce(invoiced_by::text, '-') from orders where id = ${lit(D1.id)}`) === ID.obchod, "orders.invoiced_by = obchodník");
  await eventually(async () => {
    await page.reload();
    await page.locator('main section[aria-label="Zakázka"]').waitFor({ timeout: 15_000 });
    expect(await page.locator('main section[aria-label="Zakázka"]').getByRole("button", { name: "Stav zakázky: Vyfakturováno — změnit" }).isVisible(), "hlavička: Vyfakturováno");
  });
  await openTab(page, "Dokumenty");
  await shot(page, S("13-docs-all-issued"));
});

await T("detail: vystavený doklad (potvrzení) jde z karty zakázky poslat zákazníkovi e-mailem", async (context) => {
  const page = await context.newPage();
  await openJob(page, USERS.obchod, D1, "dokumenty");
  const group = activePanel(page).locator("section").filter({ hasText: "Potvrzení" }).first();
  await group.waitFor({ timeout: 10_000 });
  await group.getByRole("button", { name: "Další akce dokumentu" }).first().click();
  await shot(page, S("14-docs-row-menu"));
  await page.getByRole("menuitem", { name: "Poslat zákazníkovi e-mailem…" }).click();
  const dlg = page.getByRole("dialog");
  await dlg.getByRole("heading", { name: "Poslat potvrzení objednávky zákazníkovi" }).waitFor({ timeout: 10_000 });
  await eventually(async () => expect((await recipients(dlg, "Komu")) === CUST_EMAIL, "Komu = e-mail zákazníka"), { timeout: 20_000 });
  const subject = await dlg.getByLabel("Předmět").inputValue();
  expect(/Potvrzení objednávky/.test(subject), `předmět potvrzení (${subject})`);
  const filesBefore = filesOf(D1.id, "potvrzeni").length;
  const t0 = new Date().toISOString();
  await dlg.getByRole("button", { name: "Odeslat potvrzení objednávky" }).click();
  await waitToast(page, new RegExp(`odesláno na ${esc(CUST_EMAIL)}`), 30_000);
  const mail = await waitMail(CUST_EMAIL, (m) => /Potvrzení objednávky/.test(m.subject) && m.receivedAt > t0);
  expect(mail && mail.attachments?.length === 1 && mail.attachments[0].contentType === "application/pdf", "e-mail s PDF potvrzení v příloze");
  expect(filesOf(D1.id, "potvrzeni").length === filesBefore, "odeslal se existující doklad — nová verze nevznikla");
  await eventually(() => {
    const o = sql(`select coalesce(confirmation_sent_by::text, '-') || '|' || coalesce(confirmation_sent_via, '-') from orders where id = ${lit(D1.id)}`);
    expect(o === `${ID.obchod}|email`, `DB: potvrzení odeslal obchodník e-mailem (${o})`);
  });
  const ev = sql(`select message || '|' || actor_id || '|' || actor_name from job_events where job_id = ${lit(D1.id)} and type = 'email' order by created_at desc limit 1`);
  expect(ev.includes(CUST_EMAIL) && ev.endsWith(`|${ID.obchod}|Petr Obchodník`), `historie: e-mail s autorem (${ev})`);
});

// ═════════════════════════ STRÁNKY TOKU ═════════════════════════

await T("/inquiries: rychlá poptávka — validace, nový zákazník → karta zakázky v Poptávce, v seznamu s „Vytvořit nabídku“", async (context) => {
  const page = await context.newPage();
  await login(page, USERS.obchod);
  await flowPage(page, "/inquiries", "Poptávky");
  await waitHydrated(page, "main button");
  await page.locator("main").getByRole("button", { name: "Nová poptávka" }).first().click();
  const dlg = page.getByRole("dialog");
  await dlg.getByRole("heading", { name: "Nová poptávka" }).waitFor({ timeout: 10_000 });
  await dlg.getByRole("button", { name: "Založit poptávku" }).click();
  await dlg.getByText(/Napiš, co zákazník poptává/).waitFor({ timeout: 5_000 });
  await dlg.getByRole("combobox").fill(INQ_CUSTOMER);
  await dlg.getByLabel("Co poptává").fill(INQ_TITLE);
  await dlg.getByLabel("Číslo výkresu").fill(`QDF-${TAG}-NEW`);
  await dlg.getByLabel("Kusů").fill("0");
  await dlg.getByRole("button", { name: "Založit poptávku" }).click();
  await dlg.getByText("Počet kusů musí být kladné číslo.").waitFor({ timeout: 5_000 });
  await dlg.getByLabel("Kusů").fill("12");
  await dlg.getByLabel("Požadovaný termín").fill(isoDays(40));
  await dlg.getByLabel("Č. poptávky zákazníka").fill(`RFQ-${TAG}`);
  await dlg.getByLabel("Poznámka").fill("Povrch černěný, tolerance h7");
  await shot(page, S("20-inquiry-dialog"));
  await Promise.all([
    page.waitForURL(/\/orders\/[0-9a-f-]{36}/, { timeout: 30_000 }),
    dlg.getByRole("button", { name: "Založit poptávku" }).click(),
  ]);
  const jobId = /\/orders\/([0-9a-f-]{36})/.exec(page.url())[1];
  const row = sql(`select o.status || '|' || o.created_by || '|' || o.owner_id || '|' || c.name || '|' || coalesce(o.customer_inquiry_number,'-') || '|' || coalesce(o.customer_required_date::text,'-') || '|' || coalesce(o.inquiry_date::text,'-') || '|' || coalesce(o.note,'-') || '|' || o.number
    from orders o left join customers c on c.id = o.customer_id where o.id = ${lit(jobId)}`).split("|");
  expect(row[0] === "poptavka" && row[1] === ID.obchod && row[2] === ID.obchod, `zakázka: poptávka, založil a vlastní obchodník (${row.slice(0, 3)})`);
  expect(row[3] === INQ_CUSTOMER, `založen nový zákazník „${INQ_CUSTOMER}" (${row[3]})`);
  expect(row[4] === `RFQ-${TAG}` && row[5] === isoDays(40) && row[6] === isoDays(0), `č. poptávky, požadovaný termín, datum poptávky (${row.slice(4, 7)})`);
  expect(row[7] === "Povrch černěný, tolerance h7", `poznámka (${row[7]})`);
  const item = sql(`select drawing_number || '|' || quantity || '|' || name from order_items where order_id = ${lit(jobId)}`);
  expect(item.split("|")[0] === `QDF-${TAG}-NEW` && num(item.split("|")[1]) === 12 && item.split("|")[2] === INQ_TITLE, `položka (${item})`);
  const created = sql(`select data->>'customerCreated' from job_events where job_id = ${lit(jobId)} and type = 'created'`);
  expect(created === "true", `historie: zákazník založen (${created})`);
  await page.locator('main section[aria-label="Zakázka"]').getByRole("button", { name: "Stav zakázky: Poptávka — změnit" }).waitFor({ timeout: 15_000 });
  // zpět na seznam poptávek
  await flowPage(page, "/inquiries", "Poptávky");
  const li = jobRow(page, { id: jobId });
  await li.waitFor({ timeout: 10_000 });
  expect(norm(await li.innerText()).includes(row[8]), "poptávka je v seznamu");
  // #25: Nacenění jen super admin — obchodník rovnou „Vytvořit nabídku“ (editor nabídky v kartě zakázky)
  expect(await li.getByRole("link", { name: "Nacenit" }).count() === 0, "obchodník nemá „Nacenit“");
  expect((await li.getByRole("link", { name: "Vytvořit nabídku" }).getAttribute("href")) === `/orders/${jobId}?tab=nabidky&nova=1`, "Vytvořit nabídku vede do editoru nabídky");
  await shot(page, S("21-inquiries-list"));
});

await T("/pricing?job=<id>: otevře zakázku, validace, „Uložit nacenění“ → Nacenění + nacenil; „Vytvořit nabídku z ceny“ → NAB, platnost, lhůta", async (context) => {
  const page = await context.newPage();
  // #25: Nacenění jen super admin — obchodníka stránka vrátí do Knihy s vysvětlením
  await login(page, USERS.obchod);
  await page.goto(`${BASE}/pricing?job=${P1.id}`);
  await page.waitForURL(/\/orders\?pristup=pricing/, { timeout: 20_000 });
  await page.context().clearCookies();
  await login(page, USERS.admin);
  await flowPage(page, `/pricing?job=${P1.id}`, "Nacenění");
  const li = page.locator(`main li#job-${P1.id}`);
  await li.waitFor({ timeout: 10_000 });
  const toggle = li.locator("button[aria-expanded]").first();
  expect((await toggle.getAttribute("aria-expanded")) === "true", "zakázka z odkazu je rozbalená");
  await waitHydrated(page, `li#job-${P1.id} button[aria-expanded]`);
  const price = li.getByLabel("Položka 1: prodejní cena za kus");
  const purchase = li.getByLabel("Položka 1: nákupní cena za kus");
  expect(/4\s?817,29/.test(await purchase.inputValue()), `super admin vidí nákup (${await purchase.inputValue()})`);
  await li.getByRole("button", { name: "Vytvořit nabídku z ceny" }).click();
  await li.getByText(/Doplň prodejní cenu u všech položek \(chybí u 1\)/).waitFor({ timeout: 5_000 });
  await price.fill("abc");
  expect((await price.getAttribute("aria-invalid")) === "true", "neplatná cena je označená");
  await li.getByRole("button", { name: "Uložit nacenění" }).click();
  await li.getByText("Položka 1: neplatná prodejní cena.").waitFor({ timeout: 5_000 });
  await price.fill("6 400");
  await eventually(async () => {
    const t = norm(await li.innerText());
    expect(t.includes("38 400") && t.includes("24,7 %"), `součet 6×6400 = 38 400, marže 24,7 % (${t.slice(-400)})`);
  });
  await shot(page, S("22-pricing-open"));
  await li.getByRole("button", { name: "Uložit nacenění" }).click();
  await li.getByText("Uloženo — AI se z tvých cen učí.").waitFor({ timeout: 20_000 });
  await eventually(() => {
    const o = sql(`select o.status || '|' || coalesce(o.priced_by::text,'-') || '|' || o.value || '|' || i.unit_price || '|' || coalesce(i.purchase_unit_price::text,'-')
      from orders o join order_items i on i.order_id = o.id where o.id = ${lit(P1.id)}`).split("|");
    expect(o[0] === "naceneni" && o[1] === ID.admin && num(o[2]) === 38400 && num(o[3]) === 6400 && num(o[4]) === PURCHASE, `DB po uložení: ${o.join("|")}`);
  });
  await li.getByLabel("Dodací lhůta (dní)").fill("15");
  await li.getByLabel("Platnost nabídky (dní)").fill("45");
  await li.getByRole("button", { name: "Vytvořit nabídku z ceny" }).click();
  const status = li.locator('[role="status"]').filter({ hasText: /Nabídka NAB-\S+ je vytvořená/ });
  await status.waitFor({ timeout: 20_000 });
  const nab = /NAB-[\w-]+/.exec(await status.innerText())[0];
  st.p1Quote = nab;
  expect((await status.getByRole("link", { name: "Otevřít nabídku" }).getAttribute("href")) === `/orders/${P1.id}?tab=nabidky`, "odkaz na nabídku v kartě");
  expect((await status.getByRole("link", { name: /Další krok v Nabídkách/ }).getAttribute("href")) === "/quotes", "odkaz na /quotes");
  const q = sql(`select number || '|' || status || '|' || total || '|' || valid_until || '|' || lead_time_days || '|' || created_by from quotes where job_id = ${lit(P1.id)}`);
  expect(q === `${nab}|ke_schvaleni|${q.split("|")[2]}|${isoDays(45)}|15|${ID.admin}` && num(q.split("|")[2]) === 38400, `DB nabídka: ${q}`);
  await shot(page, S("23-pricing-quote-created"));
});

/** Chip stavu „<štítek> N“ na /quotes a jeho počet. */
const quoteChip = (page, label) => page.locator('main [role=group][aria-label="Stav nabídky"] button[aria-pressed]').filter({ hasText: new RegExp(`^\\s*${esc(label)}\\s*\\d+\\s*$`) });
const quoteChipNum = async (page, label) => Number(/(\d+)\s*$/.exec(norm(await quoteChip(page, label).innerText()))[1]);
/** Počet nabídek v podrobném stavu podle DB (stejně jako flow_counts pro admina). */
const quoteCountDb = (key) => Number(sql(`select coalesce(sum(n), 0) from flow_counts(null, 30) where flow_phase = 'quote' and flow_key = ${lit(key)}`));
/** V „Více ▾“ zaškrtne uzavřené stavy (Přijatá, Zamítnutá, Archivovaná). */
async function quoteMore(page, labels) {
  await page.locator('main [role=group][aria-label="Stav nabídky"]').getByRole("button", { name: /^Více|Přijatá|Zamítnutá|Archivovaná/ }).last().click();
  for (const l of labels) await page.getByRole("menuitemcheckbox", { name: new RegExp(`^${esc(l)}`) }).click();
  await page.keyboard.press("Escape");
}
// #25: sekce „Ke schválení“ (super admin) má vlastní řádky [data-pending-quote] — nejsou součástí tabule
const quoteRows = (page) => page.locator("main ul > li:not([data-pending-quote])").filter({ has: page.locator("span.font-mono") });
const quoteNums = async (page) => quoteRows(page).locator("span.font-mono.text-sm").allInnerTexts();

await T("/quotes: počty chipů = DB, hledání, filtr Neschválená, archiv; kdo zadal / schválil / odeslal", async (context) => {
  const page = await context.newPage();
  await login(page, USERS.admin);
  await flowPage(page, "/quotes", "Nabídky");
  await waitHydrated(page, 'main input[aria-label="Hledat v nabídkách"]');
  await eventually(async () => {
    try {
      for (const [label, key] of [["Rozpracovaná", "rozpracovana"], ["Neschválená", "ke_schvaleni"], ["Schválená", "schvalena"], ["Odeslaná", "odeslana"]]) {
        const db = quoteCountDb(key);
        expect((await quoteChipNum(page, label)) === db, `chip ${label} = flow_counts ${db}`);
      }
    } catch (err) {
      await page.reload();
      await waitHydrated(page, 'main input[aria-label="Hledat v nabídkách"]');
      throw err;
    }
  }, { timeout: 20_000 });
  await shot(page, S("30-quotes-board"));
  const search = page.locator('main input[aria-label="Hledat v nabídkách"]');
  await search.fill(`E2EQDF-${TAG}`);
  // výchozí „Otevřené“: B1 (čeká na schválení) a B2 (odeslaná); zamítnutá Q2 je ve „Více“
  await eventually(async () => {
    const nums = await quoteNums(page);
    expect(nums.length === 2 && nums.includes(B1Q.number) && nums.includes(B2Q.number), `otevřené vlastní nabídky: B1 + B2 (${nums})`);
  });
  await quoteMore(page, ["Zamítnutá"]);
  await eventually(async () => {
    const nums = await quoteNums(page);
    expect(nums.length === 3 && nums.includes(Q2Q.number), `+ Zamítnutá: i Q2 (${nums})`);
  });
  const q2t = norm(await quoteRows(page).filter({ hasText: Q2Q.number }).innerText());
  expect(q2t.includes("Zamítnuto — Cena") && q2t.includes("S. Admin"), `řádek Q2: Zamítnuto — Cena · S. Admin (${q2t.slice(0, 260)})`);
  // jedno ťuknutí na „Otevřené“ a pak na stav = jen ten stav
  await quoteChip(page, "Otevřené").click();
  await quoteChip(page, "Neschválená").click();
  await eventually(async () => {
    const nums = await quoteNums(page);
    expect(nums.length === 1 && nums[0] === B1Q.number, `filtr Neschválená: jen B1 (${nums})`);
  });
  expect(new URL(page.url()).searchParams.get("stav") === "ke_schvaleni", `filtr je v adrese (?stav=ke_schvaleni) (${page.url()})`);
  const bt = norm(await quoteRows(page).filter({ hasText: B1Q.number }).innerText());
  // #25: důvod „žádost o schválení“ zanikl (nabídky ne-adminů čekají na super admina vždy)
  expect(bt.includes("Zadáno · P. Obchodník") && bt.includes("čeká na tvé schválení — odeslat půjde po schválení") /* super admin: schvaluje sám (review #25-C) */ && bt.includes(B1.number),
    `řádek B1: kdo zadal, neschváleno, zakázka (${bt.slice(0, 300)})`);
  await quoteChip(page, "Otevřené").click();
  // archiv: původní verze Q1 je archivovaná, R2 přijatá
  expect(st.q1 && st.r2, "Q1 + R2 existují");
  await search.fill(st.q1.number);
  await eventually(async () => expect((await quoteNums(page)).length === 0, "mezi otevřenými nic (R2 přijatá, Q1 archiv)"));
  await quoteMore(page, ["Přijatá", "Archivovaná"]);
  await eventually(async () => {
    const nums = await quoteNums(page);
    expect(nums.length === 2 && nums.includes(st.q1.number) && nums.includes(st.r2.number), `Přijatá + Archivovaná: R2 i původní verze (${nums})`);
  });
  const r2t = norm(await quoteRows(page).filter({ hasText: st.r2.number }).innerText());
  for (const x of ["verze 2", "Přijatá", "Schváleno · S. Admin", "Odesláno jinak · P. Obchodník", "Přijato · P. Obchodník"]) {
    expect(r2t.includes(x), `řádek R2 obsahuje „${x}“ (${r2t.slice(0, 300)})`);
  }
  const q1t = norm(await quoteRows(page).filter({ hasText: new RegExp(`${esc(st.q1.number)}(?!-R2)`) }).first().innerText());
  expect(q1t.includes("Archivovaná") && q1t.includes("Odesláno e-mailem · P. Obchodník"), `původní verze: Archivovaná, odeslaná e-mailem (${q1t.slice(0, 260)})`);
  await shot(page, S("31-quotes-search-archive"));
});

await T("/quotes: nabídku čekající na schválení nelze odeslat (stejně jako v kartě zakázky)", async (context) => {
  const page = await context.newPage();
  await login(page, USERS.obchod);
  await flowPage(page, "/quotes", "Nabídky");
  await waitHydrated(page, 'main input[aria-label="Hledat v nabídkách"]');
  await page.locator('main input[aria-label="Hledat v nabídkách"]').fill(B1Q.number);
  const row = page.locator("main ul > li").filter({ hasText: B1Q.number }).first();
  await row.waitFor({ timeout: 10_000 });
  expect(sql(`select coalesce(approved_by::text,'-') || '|' || state || '|' || approval_required from quotes where id = ${lit(B1Q.id)}`) === "-|ke_schvaleni|true", "B1 čeká na schválení");
  // #25: obchodník neschvaluje (jen super admin) — žádný další krok k odeslání
  expect(await row.getByRole("button", { name: "Schválit", exact: true }).count() === 0, "obchodník nemá Schválit");
  const send = row.getByRole("button", { name: /^Odeslat nabídku$|^Schválit a odeslat$/ });
  const offered = (await send.count()) > 0 && (await send.first().isEnabled());
  await row.getByRole("button", { name: `Další akce nabídky ${B1Q.number}` }).click();
  const items = (await page.getByRole("menuitem").allInnerTexts()).map(norm);
  await page.keyboard.press("Escape");
  await shot(page, S("32-quotes-unapproved-row"));
  expect(!offered && !items.some((t) => /^Odeslat nabídku|^Odesláno jinak/.test(t)), `odeslání neschválené nabídky se nenabízí (menu: ${items.join(", ")})`);
  // ani obejitím UI (REST s přihlášením obchodníka): DB odmítne odeslat neschválenou nabídku
  const token = await restLogin(USERS.obchod);
  const r = await restCall("PATCH", `quotes?id=eq.${B1Q.id}`, { token, body: { status: "odeslano", sent_at: new Date().toISOString() } });
  expect(r.status >= 400 && /čeká na schválení/i.test(JSON.stringify(r.body)), `REST: DB odmítne odeslání bez schválení (${r.status} ${JSON.stringify(r.body).slice(0, 160)})`);
  expect(sql(`select status || '|' || state from quotes where id = ${lit(B1Q.id)}`) === "ke_schvaleni|ke_schvaleni", "nabídka zůstala neodeslaná");
});

await T("/quotes: super admin Schválit → obchodník Odeslat nabídku (dialog předvyplněný, mail s PDF) → Zákazník objednal → zakázka Objednávka", async (context) => {
  // #25: schvaluje super admin (ze seznamu), odesílá obchodník
  await withContext(browser, errors, async (ac) => {
    const ap = await ac.newPage();
    await login(ap, USERS.admin);
    await flowPage(ap, "/quotes", "Nabídky");
    await waitHydrated(ap, 'main input[aria-label="Hledat v nabídkách"]');
    await ap.locator('main input[aria-label="Hledat v nabídkách"]').fill(B1Q.number);
    const ar = ap.locator("main ul > li:not([data-pending-quote])").filter({ hasText: B1Q.number }).first();
    await ar.waitFor({ timeout: 10_000 });
    // #25: i v sekci „Ke schválení“ nahoře (stejná nabídka)
    expect(await ap.locator(`[data-pending-quote="${B1Q.id}"]`).count() === 1, "B1 je v sekci Ke schválení");
    await ar.getByRole("button", { name: "Schválit", exact: true }).click();
    await waitToast(ap, new RegExp(`Nabídka ${esc(B1Q.number)} schválena — Petr Obchodník ji teď může odeslat`));
    await eventually(async () => expect(norm(await ar.innerText()).includes("Schváleno · S. Admin"), "řádek: Schváleno · S. Admin"));
  });
  expect(sql(`select approved_by || '|' || state || '|' || state_changed_by from quotes where id = ${lit(B1Q.id)}`) === `${ID.admin}|schvalena|${ID.admin}`, "DB: schválil super admin, stav Schválená");
  const page = await context.newPage();
  await login(page, USERS.obchod);
  await flowPage(page, "/quotes", "Nabídky");
  await waitHydrated(page, 'main input[aria-label="Hledat v nabídkách"]');
  await page.locator('main input[aria-label="Hledat v nabídkách"]').fill(B1Q.number);
  const row = page.locator("main ul > li").filter({ hasText: B1Q.number }).first();
  await row.waitFor({ timeout: 10_000 });
  await row.getByRole("button", { name: "Odeslat nabídku" }).click();
  const dlg = page.getByRole("dialog");
  await dlg.getByRole("heading", { name: `Odeslat nabídku ${B1Q.number} zákazníkovi` }).waitFor({ timeout: 10_000 });
  await dlg.locator('a[href^="/api/jobs/files/"]').waitFor({ timeout: 30_000 });
  await eventually(async () => expect((await recipients(dlg, "Komu")) === CUST_EMAIL, "Komu = e-mail zákazníka"));
  const subject = await dlg.getByLabel("Předmět").inputValue();
  expect(subject.includes(B1Q.number), `předmět s číslem nabídky (${subject})`);
  expect((await dlg.getByLabel("Text e-mailu").inputValue()).length > 40, "text e-mailu předvyplněný");
  await shot(page, S("33-quotes-send-dialog"));
  const t0 = new Date().toISOString();
  await dlg.getByRole("button", { name: "Odeslat nabídku" }).click();
  await waitToast(page, new RegExp(`Nabídka ${esc(B1Q.number)} odeslána na`), 30_000);
  const mail = await waitMail(CUST_EMAIL, (m) => m.subject.includes(B1Q.number) && m.receivedAt > t0);
  expect(mail && mail.attachments?.length === 1 && mail.attachments[0].contentType === "application/pdf", `mail s PDF přílohou (${JSON.stringify(mail?.attachments)})`);
  await eventually(() => {
    const db = sql(`select q.status || '|' || (q.sent_at is not null) || '|' || o.status || '|' || q.state || '|' || q.sent_by || '|' || q.sent_via from quotes q join orders o on o.id = q.job_id where q.id = ${lit(B1Q.id)}`);
    expect(db === `odeslano|true|nabidka|odeslana|${ID.obchod}|email`, `DB po odeslání: ${db}`);
  });
  await eventually(async () => expect(norm(await row.innerText()).includes("Odesláno e-mailem · P. Obchodník"), "řádek: Odesláno e-mailem · P. Obchodník"));
  await row.getByRole("button", { name: "Zákazník objednal" }).click();
  const acc = page.getByRole("dialog");
  await acc.getByRole("heading", { name: `Zákazník objednal podle ${B1Q.number}?` }).waitFor({ timeout: 10_000 });
  await acc.getByRole("button", { name: "Ano, objednal" }).click();
  await waitToast(page, /přijata — zakázka čeká na potvrzení objednávky/);
  await eventually(() => {
    const db = sql(`select q.status || '|' || o.status || '|' || coalesce(o.quote_id::text,'-') || '|' || o.value || '|' || q.state || '|' || coalesce(o.order_status, '-') || '|' || coalesce(q.accepted_by::text, '-') from quotes q join orders o on o.id = q.job_id where q.id = ${lit(B1Q.id)}`).split("|");
    expect(db[0] === "prijato" && db[1] === "objednavka" && db[2] === B1Q.id && num(db[3]) === 6000 && db[4] === "prijata" && db[5] === "dorucena" && db[6] === ID.obchod, `DB po přijetí: ${db.join("|")}`);
  });
  const stage = sql(`select message || '|' || actor_id from job_events where job_id = ${lit(B1.id)} and type = 'stage' order by created_at desc limit 1`);
  expect(stage.startsWith("Stav: Nabídka odeslaná → Objednávka") && stage.endsWith(`|${ID.obchod}`), `historie: posun na Objednávku s autorem (${stage})`);
  const ev = sentEventsOf(B1.id);
  expect(ev.length === 1, `historie B1: právě 1 událost odeslání, je ${ev.length}: ${ev.join(" ‖ ")}`);
});

await T("/quotes: „Zamítnout nabídku…“ z menu s důvodem (zakázka se uzavře), pak Archivovat", async (context) => {
  const page = await context.newPage();
  await login(page, USERS.admin);
  await flowPage(page, "/quotes", "Nabídky");
  await waitHydrated(page, 'main input[aria-label="Hledat v nabídkách"]');
  await page.locator('main input[aria-label="Hledat v nabídkách"]').fill(B2Q.number);
  const row = page.locator("main ul > li").filter({ hasText: B2Q.number }).first();
  await row.waitFor({ timeout: 10_000 });
  await row.getByRole("button", { name: `Další akce nabídky ${B2Q.number}` }).click();
  await page.getByRole("menuitem", { name: "Zamítnout nabídku…" }).click();
  const dlg = page.getByRole("dialog");
  await dlg.getByRole("heading", { name: `Zamítnout nabídku ${B2Q.number}` }).waitFor({ timeout: 10_000 });
  expect(norm(await dlg.innerText()).includes("Zakázka se uzavře jako Nerealizovaná"), "náhled dopadu na zakázku");
  await dlg.getByRole("radio", { name: /^Vybral jiného dodavatele/ }).click();
  await dlg.locator("textarea").fill("Objednali jinde");
  await dlg.getByRole("button", { name: "Zamítnout", exact: true }).click();
  await waitToast(page, new RegExp(`${esc(B2Q.number)} zamítnuta`));
  await eventually(() => {
    const db = sql(`select q.status || '|' || q.lost_reason || '|' || q.rejected_reason || '|' || q.state_changed_by || '|' || o.status from quotes q join orders o on o.id = q.job_id where q.id = ${lit(B2Q.id)}`);
    expect(db === `zamitnuto|jiny_dodavatel|Objednali jinde|${ID.admin}|nerealizovano`, `DB: zamítnuto + důvod + autor, zakázka Nerealizováno (${db})`);
  });
  // zamítnutá je uzavřená — ve „Více ▾ Zamítnutá“ s autorem
  await quoteMore(page, ["Zamítnutá"]);
  await eventually(async () => {
    const t = norm(await row.innerText());
    expect(t.includes("Zamítnuto — Vybral jiného dodavatele · S. Admin") && t.includes("Objednali jinde"), `řádek: Zamítnuto s důvodem a autorem (${t.slice(0, 260)})`);
  });
  await row.getByRole("button", { name: `Další akce nabídky ${B2Q.number}` }).click();
  await page.getByRole("menuitem", { name: "Archivovat" }).click();
  await waitToast(page, new RegExp(`Nabídka ${esc(B2Q.number)} archivována`));
  await eventually(() => expect(sql(`select archived from quotes where id = ${lit(B2Q.id)}`) === "t", "DB: archivována"));
  await row.getByRole("button", { name: `Další akce nabídky ${B2Q.number}` }).click();
  expect(await page.getByRole("menuitem", { name: "Obnovit z archivu" }).isVisible(), "archivovanou jde obnovit");
  await page.keyboard.press("Escape");
});

await T("/confirmations: Potvrdit objednávku → termín, e-mail s PDF → Potvrzená objednávka, due_date, jedna změna stavu", async (context) => {
  const page = await context.newPage();
  await login(page, USERS.obchod);
  await flowPage(page, "/confirmations", "Potvrzení objednávek");
  const li = jobRow(page, C1);
  await li.waitFor({ timeout: 10_000 });
  await waitHydrated(page, "main li button");
  await li.getByRole("button", { name: "Potvrdit objednávku" }).click();
  const dlg = page.getByRole("dialog");
  await dlg.getByRole("heading", { name: `Potvrdit objednávku ${C1.number}` }).waitFor({ timeout: 10_000 });
  const date = dlg.locator('input[type="date"]');
  expect((await date.inputValue()) === isoDays(18), `termín předvyplněný požadavkem zákazníka (${await date.inputValue()})`);
  const sw = dlg.getByRole("switch", { name: "Poslat potvrzení zákazníkovi e-mailem" });
  expect((await sw.getAttribute("aria-checked")) === "true", "e-mail zapnutý (zákazník má e-mail)");
  expect(norm(await dlg.innerText()).includes(CUST_EMAIL), "dialog ukazuje adresu zákazníka");
  await date.fill(isoDays(22));
  await dlg.locator("textarea").fill("Dodání v jedné dávce");
  await shot(page, S("40-confirm-dialog"));
  await dlg.getByRole("button", { name: "Vystavit a pokračovat k e-mailu" }).click();
  await dlg.getByRole("heading", { name: `Poslat potvrzení zakázky ${C1.number}` }).waitFor({ timeout: 30_000 });
  await dlg.locator('a[href^="/api/jobs/files/"]').waitFor({ timeout: 10_000 });
  expect((await recipients(dlg, "Komu")) === CUST_EMAIL, "Komu předvyplněno");
  const subject = await dlg.getByLabel("Předmět").inputValue();
  expect(/Potvrzení/i.test(subject), `předmět potvrzení (${subject})`);
  await shot(page, S("41-confirm-mail-step"));
  const t0 = new Date().toISOString();
  await dlg.getByRole("button", { name: "Odeslat potvrzení" }).click();
  const toast = await waitToast(page, new RegExp(`Objednávka ${esc(C1.number)} potvrzena — potvrzení POT-\\S+ odešlo na`), 30_000);
  expect(toast.includes(CUST_EMAIL), `toast s adresou (${toast})`);
  const mail = await waitMail(CUST_EMAIL, (m) => m.receivedAt > t0 && m.subject === subject);
  expect(mail && mail.attachments?.length === 1 && mail.attachments[0].contentType === "application/pdf", `mail s PDF potvrzení (${JSON.stringify(mail?.attachments)})`);
  await eventually(() => {
    const o = sql(`select status || '|' || coalesce(due_date::text,'-') || '|' || (confirmed_at is not null) from orders where id = ${lit(C1.id)}`);
    expect(o === `potvrzeno|${isoDays(22)}|true`, `DB: potvrzeno, termín, confirmed_at (${o})`);
  });
  expect(filesOf(C1.id, "potvrzeni").length === 1, "potvrzení uložené v Dokumentech (1×)");
  const stages = sql(`select count(*) from job_events where job_id = ${lit(C1.id)} and type = 'stage' and data->>'to' = 'potvrzeno'`);
  expect(stages === "1", `jedna změna stavu na Potvrzeno (${stages})`);
  const mails = sql(`select count(*) from job_events where job_id = ${lit(C1.id)} and type = 'email'`);
  expect(mails === "1", `jedna událost odeslání e-mailu (${mails})`);
  await eventually(async () => {
    await page.reload();
    await page.locator("main h1").filter({ hasText: "Potvrzení objednávek" }).waitFor();
    const waiting = page.locator("main section").filter({ has: page.getByRole("heading", { name: "Čeká na potvrzení" }) });
    expect(await waiting.locator(`a[href="/orders/${C1.id}"]`).count() === 0, "C1 už nečeká na potvrzení");
  });
});

await T("/confirmations: jen vystavit PDF bez e-mailu (super admin) → Potvrzená objednávka, žádný e-mail", async (context) => {
  const page = await context.newPage();
  await login(page, USERS.admin);
  await flowPage(page, "/confirmations", "Potvrzení objednávek");
  const li = jobRow(page, C2);
  await li.waitFor({ timeout: 10_000 });
  await waitHydrated(page, "main li button");
  await li.getByRole("button", { name: "Potvrdit objednávku" }).click();
  const dlg = page.getByRole("dialog");
  await dlg.getByRole("heading", { name: `Potvrdit objednávku ${C2.number}` }).waitFor({ timeout: 10_000 });
  await dlg.getByRole("switch", { name: "Poslat potvrzení zákazníkovi e-mailem" }).click();
  await dlg.getByText("Jen vystavit PDF").waitFor();
  const t0 = new Date().toISOString();
  await dlg.getByRole("button", { name: "Potvrdit objednávku" }).click();
  await waitToast(page, new RegExp(`Objednávka ${esc(C2.number)} potvrzena — potvrzení POT-\\S+ je v Dokumentech`), 30_000);
  await eventually(() => expect(sql(`select status from orders where id = ${lit(C2.id)}`) === "potvrzeno", "DB: potvrzeno"));
  expect(filesOf(C2.id, "potvrzeni").length === 1, "PDF potvrzení uložené");
  await new Promise((r) => setTimeout(r, 1500));
  const sent = (await mailsTo(CUST_EMAIL)).filter((m) => m.receivedAt > t0);
  expect(sent.length === 0, `žádný e-mail neodešel (${sent.map((m) => m.subject)})`);
  const actor = sql(`select actor_id from job_events where job_id = ${lit(C2.id)} and type = 'stage' order by created_at desc limit 1`);
  expect(actor === ID.admin, "změnu stavu provedl super admin");
});

await T("/documents: prohlížeč — hledání, počty, filtr druhu, archiv verzí, odkaz do karty, PDF", async (context) => {
  const page = await context.newPage();
  await login(page, USERS.obchod);
  await flowPage(page, "/documents", "Dokumenty");
  await waitHydrated(page, 'main input[aria-label="Hledat v dokumentech"]');
  const cards = page.locator("main ul.grid > li");
  await page.locator('main input[aria-label="Hledat v dokumentech"]').fill(`D1 doklady ${TAG}`);
  const current = Number(sql(`select count(*) from job_files where job_id = ${lit(D1.id)} and not archived`));
  const all = Number(sql(`select count(*) from job_files where job_id = ${lit(D1.id)}`));
  expect(current === 3 && all === 4, `D1 má 3 aktuální + 1 archivovaný dokument (${current}/${all})`);
  await eventually(async () => {
    const texts = (await cards.allInnerTexts()).map(norm);
    expect(texts.length === current && texts.every((t) => t.includes(D1.number)), `hledání: ${current} karet D1 (${texts.length})`);
  });
  await shot(page, S("50-documents-search"));
  await page.locator("main").getByRole("switch", { name: "Zobrazit archivované" }).click();
  await eventually(async () => {
    const texts = (await cards.allInnerTexts()).map(norm);
    expect(texts.length === all && texts.filter((t) => t.includes("archiv")).length === 1, `s archivem ${all} karet, 1 archivní (${texts.length})`);
  });
  await page.locator("main button[aria-pressed]").filter({ hasText: /^\s*Faktura\s*\d+\s*$/ }).click();
  await eventually(async () => {
    const texts = (await cards.allInnerTexts()).map(norm);
    expect(texts.length === 1 && texts[0].includes("Faktura"), `filtr Faktura: 1 karta (${texts.length})`);
  });
  const card = cards.first();
  expect((await card.locator(`a[href="/orders/${D1.id}?tab=dokumenty"]`).count()) === 1, "číslo zakázky vede do karty (záložka Dokumenty)");
  const href = await card.locator('a[href^="/api/jobs/files/"]').first().getAttribute("href");
  expectPdf(await fetchPdf(page.request, `${BASE}${href}`), "faktura z prohlížeče");
  await shot(page, S("51-documents-filter-faktura"));
});

await T("/documents: vystavit doklad z panelu (potvrzení) → Hotovo, Poslat zákazníkovi → mail s PDF, Potvrzená; pak Dodací list", async (context) => {
  const page = await context.newPage();
  await login(page, USERS.obchod);
  await flowPage(page, "/documents", "Dokumenty");
  const panel = page.locator("main #vystavit");
  await waitHydrated(page, "main #vystavit input[role=combobox]");
  await panel.getByRole("combobox").fill(DOC1.number);
  await panel.getByRole("option").filter({ hasText: DOC1.number }).first().click();
  const kindBtn = (label) => panel.getByRole("button", { name: new RegExp(`^${label}`) });
  await eventually(async () => expect((await kindBtn("Potvrzení objednávky").getAttribute("aria-pressed")) === "true", "navržený druh pro Objednávku = Potvrzení"));
  const preview = await panel.getByRole("link", { name: "Náhled bez uložení" }).getAttribute("href");
  expect(preview === `/api/pdf/job/${DOC1.id}?type=potvrzeni`, `náhled bez uložení (${preview})`);
  expectPdf(await fetchPdf(page.request, `${BASE}${preview}`), "náhled potvrzení z panelu");
  await panel.getByRole("button", { name: "Vystavit PDF" }).click();
  const done = panel.locator('[role="status"]').filter({ hasText: /Hotovo: Potvrzení objednávky POT-/ });
  await done.waitFor({ timeout: 30_000 });
  expect(filesOf(DOC1.id, "potvrzeni").length === 1, "potvrzení uložené k zakázce");
  await shot(page, S("52-documents-issued"));
  await done.getByRole("button", { name: "Poslat zákazníkovi" }).click();
  const dlg = page.getByRole("dialog");
  await dlg.getByRole("heading", { name: /Poslat potvrzení objednávky POT-\S+ zákazníkovi/ }).waitFor({ timeout: 10_000 });
  await eventually(async () => expect((await recipients(dlg, "Komu")) === CUST_EMAIL, "Komu předvyplněno"), { timeout: 20_000 });
  const subject = await dlg.getByLabel("Předmět").inputValue();
  // předmět potvrzení nese číslo objednávky zákazníka (podle něj si ji zákazník spáruje), číslo POT je v PDF
  expect(subject.startsWith(`Potvrzení objednávky č. QDF-DOC-${TAG}`), `předmět s číslem objednávky zákazníka (${subject})`);
  expect(filesOf(DOC1.id, "potvrzeni").length === 1, "odeslání existujícího PDF nevytvořilo novou verzi");
  const t0 = new Date().toISOString();
  await dlg.getByRole("button", { name: "Odeslat potvrzení objednávky" }).click();
  await dlg.waitFor({ state: "hidden", timeout: 30_000 });
  const mail = await waitMail(CUST_EMAIL, (m) => m.receivedAt > t0 && m.subject === subject);
  expect(mail && mail.attachments?.length === 1 && mail.attachments[0].contentType === "application/pdf", `mail s PDF (${JSON.stringify(mail?.attachments)})`);
  await eventually(() => expect(sql(`select status from orders where id = ${lit(DOC1.id)}`) === "potvrzeno", "DB: Potvrzená objednávka"));
  // zpětná vazba po odeslání (UX)
  await panel.locator('[role="status"]').filter({ hasText: `Odesláno na ${CUST_EMAIL}.` }).waitFor({ timeout: 10_000 });
  expect(sql(`select coalesce(confirmation_sent_by::text, '-') || '|' || coalesce(confirmation_sent_via, '-') from orders where id = ${lit(DOC1.id)}`) === `${ID.obchod}|email`, "DB: potvrzení odeslal obchodník e-mailem");
  // dodací list: bez dodávky nevzniká (A2 sk. 2) — panel vysvětlí a vede do karty na „Zapsat dodání a dodací list"
  await kindBtn("Dodací list").click();
  await panel.getByRole("button", { name: "Vystavit PDF" }).click();
  await panel.locator('[role="alert"]').filter({ hasText: "Dodací list vzniká se zápisem dodání" }).waitFor({ timeout: 30_000 });
  expect(sql(`select coalesce(delivery_note_number, '-') from orders where id = ${lit(DOC1.id)}`) === "-", "bez dodání se číslo DL nespotřebovalo");
  const toCard = panel.getByRole("link", { name: /Zapsat dodání a dodací list/ });
  expect((await toCard.getAttribute("href")) === `/orders/${DOC1.id}?tab=vyroba&akce=delivery.record`, "odkaz do karty na zápis dodání");
  await shot(page, S("53-documents-dl"));
  await toCard.click();
  const ddlg = page.getByRole("dialog");
  await ddlg.getByRole("button", { name: /^Zapsat dodání a dodací list/ }).click({ timeout: 30_000 });
  const dl = ddlg.locator('[data-testid="delivery-note-result"]');
  await dl.waitFor({ timeout: 30_000 });
  const dlNum = /DL-\d{4}-\d+/.exec(await dl.innerText())[0];
  await eventually(() => expect(sql(`select delivery_note_number from orders where id = ${lit(DOC1.id)}`) === dlNum, `orders.delivery_note_number = ${dlNum}`));
});

await T("stránky toku renderují pro super admina i obchodníka (nadpis, žádná chybová hláška)", async (context) => {
  for (const user of [USERS.admin, USERS.obchod]) {
    const page = await context.newPage();
    await login(page, user);
    // #25: Nacenění jen super admin; Objednávky dodavatelům oba (právo na nákupní ceny)
    const flowPages = [["/inquiries", "Poptávky"], ["/pricing", "Nacenění"], ["/quotes", "Nabídky"], ["/confirmations", "Potvrzení objednávek"], ["/documents", "Dokumenty"], ["/purchasing", "Objednávky dodavatelům"]]
      .filter(([path]) => user === USERS.admin || path !== "/pricing");
    for (const [path, title] of flowPages) {
      const r = await page.goto(`${BASE}${path}`);
      expect(r.status() === 200, `${user.email} ${path}: HTTP 200 (${r.status()})`);
      await page.locator("main h1").filter({ hasText: title }).first().waitFor({ timeout: 20_000 });
      const alerts = await alertTexts(page);
      expect(alerts.length === 0, `${user.email} ${path}: žádná chybová hláška (${alerts.join(" | ")})`);
    }
    await page.close();
    await context.clearCookies();
  }
});

await T("zaměstnanec: stránky toku bez nákupních cen a marží (ani v datech stránky); super admin je vidí", async (context) => {
  const page = await context.newPage();
  await login(page, USERS.dilna);
  // #25: Nacenění jen super admin → zaměstnanec skončí v Knize s vysvětlením (nákupní ceny tam nejsou)
  await page.goto(`${BASE}/pricing?job=${P1.id}`);
  await page.waitForURL(/\/orders\?pristup=pricing/, { timeout: 20_000 });
  expect(!PURCHASE_RE.test(norm(await page.content())), "zaměstnanec /pricing → Kniha bez nákupní ceny");
  // #25-C: Objednávky dodavatelům vidí každý — zaměstnanec přehled bez cen a bez akcí
  const pr = await page.goto(`${BASE}/purchasing`);
  expect(pr.status() === 200 && new URL(page.url()).pathname === "/purchasing", `zaměstnanec /purchasing: otevře se (${page.url()})`);
  await page.locator("main h1").filter({ hasText: "Objednávky dodavatelům" }).first().waitFor({ timeout: 20_000 });
  await page.waitForFunction(() => !document.querySelector('div[hidden][id^="S:"]'), null, { timeout: 20_000 });
  expect(!PURCHASE_RE.test(norm(await page.content())), "zaměstnanec /purchasing: bez nákupní ceny v HTML/datech");
  const pages = [["/inquiries", "Poptávky"], ["/quotes", "Nabídky"], ["/confirmations", "Potvrzení objednávek"], ["/documents", "Dokumenty"], [`/orders/${P1.id}?tab=nabidky`, null]];
  for (const [path, title] of pages) {
    const r = await page.goto(`${BASE}${path}`);
    expect(r.status() === 200, `zaměstnanec ${path}: HTTP 200 (${r.status()})`);
    if (title) await page.locator("main h1").filter({ hasText: title }).first().waitFor({ timeout: 20_000 });
    else await page.locator('main section[aria-label="Zakázka"]').waitFor({ timeout: 20_000 });
    await page.waitForFunction(() => !document.querySelector('div[hidden][id^="S:"]'), null, { timeout: 20_000 });
    const html = norm(await page.content());
    expect(!PURCHASE_RE.test(html), `zaměstnanec ${path}: v HTML/datech stránky není nákupní cena ${PURCHASE}`);
    if (path.startsWith("/pricing")) {
      const t = norm(await page.locator("main").innerText());
      expect(!/Nákup \/ ks/i.test(t) && !/marž/i.test(t), "Nacenění zaměstnance: bez sloupce Nákup a marže");
      expect(await page.locator(`main li#job-${P1.id}`).getByLabel("Položka 1: nákupní cena za kus").count() === 0, "bez pole nákupní ceny");
      expect(await page.locator(`main li#job-${P1.id}`).getByLabel("Položka 1: prodejní cena za kus").count() === 1, "prodejní cenu zaměstnanec vidí");
      await shot(page, S("60-dilna-pricing"));
    }
    if (path.startsWith("/orders")) {
      const tabs = (await page.getByRole("tab").allInnerTexts()).map((t) => t.split("\n")[0].trim());
      expect(!tabs.some((t) => t.startsWith("Nákup")), `karta: bez záložky Nákup & marže (${tabs.join(", ")})`);
    }
  }
  await page.close();
  await context.clearCookies();
  // kontrola testu: super admin nákupní cenu na Nacenění vidí (data stránky ji obsahují)
  const p2 = await context.newPage();
  await login(p2, USERS.admin);
  await p2.goto(`${BASE}/pricing?job=${P1.id}`);
  await p2.locator(`main li#job-${P1.id}`).getByLabel("Položka 1: nákupní cena za kus").waitFor({ timeout: 20_000 });
  expect(PURCHASE_RE.test(norm(await p2.content())), "super admin: nákupní cena v datech stránky je (kontrola, že test umí cenu najít)");
});

await T("mobil 390 px: 5 stránek toku bez vodorovného přetékání (+ rozbalené nacenění, dialog poptávky, nabídky v kartě)", async (context) => {
  const page = await context.newPage();
  await login(page, USERS.obchod);
  // #25: Nacenění jen super admin — obchodník ho na mobilu nemá (viz test /pricing výše)
  for (const [path, title, name] of [
    ["/inquiries", "Poptávky", "70-m-inquiries"],
    ["/quotes", "Nabídky", "72-m-quotes"],
    ["/confirmations", "Potvrzení objednávek", "73-m-confirmations"],
    ["/documents", "Dokumenty", "74-m-documents"],
  ]) {
    await flowPage(page, path, title);
    await page.waitForLoadState("networkidle").catch(() => {});
    await expectNoOverflow(page, `mobil ${path}`);
    await shot(page, S(name));
  }
  // dialog rychlé poptávky
  await flowPage(page, "/inquiries", "Poptávky");
  await waitHydrated(page, "main button");
  await page.locator("main").getByRole("button", { name: "Nová poptávka" }).first().click();
  const dlg = page.getByRole("dialog");
  await dlg.getByRole("heading", { name: "Nová poptávka" }).waitFor({ timeout: 10_000 });
  const box = await dlg.boundingBox();
  expect(box && box.x >= 0 && box.x + box.width <= 391, `dialog poptávky je celý na šířku obrazovky (${JSON.stringify(box)})`);
  await shot(page, S("75-m-inquiry-dialog"));
  await page.keyboard.press("Escape");
  // karta zakázky — nabídky
  await page.goto(`${BASE}/orders/${Q1.id}?tab=nabidky`);
  await page.locator('main section[aria-label="Zakázka"]').waitFor({ timeout: 20_000 });
  await page.waitForLoadState("networkidle").catch(() => {});
  await expectNoOverflow(page, "mobil karta zakázky / Nabídky");
  await shot(page, S("76-m-job-quotes"));
}, { mobile: true });

// ═════════════════════════ ÚKLID ═════════════════════════
await browser.close();
const cleaned = await cleanupOwnData();
const rest = sql(`select (select count(*) from orders where title like ${lit(`${PREFIX}%`)}) || '/' || (select count(*) from customers where name like ${lit(`${PREFIX}%`)})`);
console.log(`\n  úklid: ${cleaned.jobs} zakázek, ${cleaned.customers} zákazníků (zbývá ${rest})`);
await clearMail(CUST_EMAIL);
if (notes.length) {
  console.log("\nUX postřehy:");
  for (const n of notes) console.log(`  · ${n}`);
}
process.exit(summary(errors) ? 0 : 1);

function sentEventsOf(jobId) {
  return sentEvents(jobId);
}
