// E2E 06 · Podrobné stavy v Knize zakázek a na kartě zakázky (Balík 1).
// Převzít poptávku z řádku → „V řešení · Petr Obchodník"; odmítnutí s důvodem z menu stavu
// → Historie s autorem; korekce stavu s náhledem dopadu (bez „Posunout"); dodání 1/2 položek
// → „Částečně dodáno 1/2 položek"; mobil 375 px bez vodorovného posunu, autor viditelný.
// Vlastní data mají prefix „E2E-book-06-" a na konci se uklidí.
import { BASE, USERS, launch, withContext, login, shot, sql, test, expect, summary } from "../lib.mjs";
import { PREFIX, TAG, lit, userIds, eventually, bookIdle, expectNoOverflow, createCustomer, createJob, cleanupOwnData, waitHydrated } from "../lib-book-detail.mjs";

const browser = await launch();
const errors = [];
const ONLY = process.env.ONLY ? new RegExp(process.env.ONLY) : null;
const T = (name, fn, opts) => (ONLY && !ONLY.test(name) ? Promise.resolve() : test(name, () => withContext(browser, errors, fn, opts)));
const S = (name) => `flow-book-detail/${name}`;
const P = `${PREFIX}06-`;

console.log(`06 · Podrobné stavy v Knize a kartě zakázky (značka ${TAG})`);

await cleanupOwnData();
const ID = userIds();
const CUST = createCustomer(`${P}Kovo ${TAG} s.r.o.`, ID.obchod);

// poptávka z e-mailu, nikdo ji nepřevzal
const INQ = createJob({ title: `${P}INQ poptávka ${TAG}`, status: "poptavka", customerId: CUST.id, ownerId: ID.obchod, cinq: `E2E6-RFQ-${TAG}` });
sql(`update orders set source = 'email', inquiry_status = 'prijata', assignee_id = null where id = ${lit(INQ.id)}`);
// poptávka k odmítnutí
const REJ = createJob({ title: `${P}REJ poptávka ${TAG}`, status: "poptavka", customerId: CUST.id, ownerId: ID.obchod });
// zakázka ve výrobě se dvěma položkami (dodání po položkách)
const DEL = createJob({
  title: `${P}DEL dodání ${TAG}`, status: "ve_vyrobe", customerId: CUST.id, ownerId: ID.obchod, cpo: `E2E6-PO-${TAG}`, value: 4000,
  items: [
    { drawing: `E2E6-A-${TAG}`, name: "Deska A", qty: 2, price: 1000 },
    { drawing: `E2E6-B-${TAG}`, name: "Deska B", qty: 2, price: 1000 },
  ],
});
// nabídka odeslaná → korekce do Nerealizováno s náhledem dopadu
const KOR = createJob({ title: `${P}KOR nabídka ${TAG}`, status: "nabidka", customerId: CUST.id, ownerId: ID.obchod });
sql(`insert into quotes (number, job_id, status, sent_at, total, revision, valid_until, owner_id, customer_id)
  values (${lit(`E2E6-NAB-${TAG}`)}, ${lit(KOR.id)}, 'odeslano', now(), 1000, 1, current_date + 30, ${lit(ID.obchod)}, ${lit(CUST.id)})`);

const rowOf = (page, job) => page.locator("main ul[role=list] > li").filter({ has: page.locator(`a[href="/orders/${job.id}"]`) });
const row = (job) => sql(`select row_to_json(o)::text from orders o where id = ${lit(job.id)}`);
const J = (job) => JSON.parse(row(job));

async function openBook(page, user, query) {
  await login(page, user);
  await page.goto(`${BASE}/orders${query}`);
  await bookIdle(page);
}

async function openJob(page, job, query = "") {
  await page.goto(`${BASE}/orders/${job.id}${query}`);
  await page.waitForLoadState("domcontentloaded");
  await waitHydrated(page, 'main button[aria-label^="Stav zakázky:"]');
}

await T("kniha: obchodník převezme poptávku z řádku → „V řešení · Petr Obchodník“ + autor v DB", async (context) => {
  const page = await context.newPage();
  await openBook(page, USERS.obchod, `?segment=poptavky&q=${encodeURIComponent(TAG)}`);
  const r = rowOf(page, INQ);
  await r.waitFor();
  expect((await r.innerText()).includes("Přijatá"), "řádek ukazuje Přijatá");
  expect(!(await r.innerText()).includes("Posunout"), "v řádku není „Posunout“");
  await r.getByRole("button", { name: "Převzít" }).click();
  await eventually(async () => {
    const t = await rowOf(page, INQ).innerText();
    // řešitel = autor převzetí → jméno nese razítko pod chipem („P. Obchodník · právě teď")
    expect(t.includes("V řešení") && /(Petr|P\.) Obchodník/.test(t), `řádek po převzetí: ${t.replace(/\s+/g, " ").slice(0, 400)}`);
  });
  const j = J(INQ);
  expect(j.inquiry_status === "v_reseni" && j.assignee_id === ID.obchod && j.inquiry_status_changed_by === ID.obchod, "DB: v_reseni, řešitel a autor = obchodník");
  // chipy poptávky v segmentu s počty
  const chips = page.locator('main [role=group][aria-label="Stav poptávky"]');
  expect(await chips.isVisible(), "chipy stavů poptávky");
  await shot(page, S("01-take"));
});

await T("karta: menu stavu → Odmítnout poptávku s důvodem → Nerealizováno, Historie s autorem", async (context) => {
  const page = await context.newPage();
  await login(page, USERS.obchod);
  await openJob(page, REJ);
  expect(!(await page.locator("main").innerText()).includes("Posunout:"), "karta nemá „Posunout“");
  await page.getByRole("button", { name: "Akce se stavem" }).click();
  await page.getByRole("menuitem", { name: /Odmítnout poptávku/ }).click();
  const dlg = page.getByRole("dialog");
  await dlg.getByRole("radio", { name: /Nestíháme/ }).click();
  await dlg.getByRole("button", { name: "Odmítnout poptávku" }).click();
  await eventually(() => expect(J(REJ).status === "nerealizovano", "DB: zakázka nerealizovaná"));
  const j = J(REJ);
  expect(j.inquiry_status === "odmitnuta" && j.lost_reason === "kapacita" && j.lost_by === ID.obchod, "DB: odmítnutá, důvod kapacita, kdo = obchodník");
  await openJob(page, REJ, "?tab=historie");
  const hist = page.getByRole("tabpanel");
  await eventually(async () => {
    const t = await hist.innerText();
    expect(t.includes("Poptávka: V řešení → Odmítnutá — Nestíháme (kapacita / termín)"), "Historie: dílčí stav s důvodem");
    expect(t.includes("Petr Obchodník"), "Historie: autor");
  });
  await shot(page, S("02-decline-history"));
});

await T("karta: korekce stavu ukáže dopad na nabídku a vyžádá důvod", async (context) => {
  const page = await context.newPage();
  await login(page, USERS.obchod);
  await openJob(page, KOR);
  await page.getByRole("button", { name: /^Stav zakázky:/ }).first().click();
  await page.getByRole("menuitem", { name: /Nerealizováno/ }).click();
  const dlg = page.getByRole("dialog");
  await eventually(async () => expect((await dlg.innerText()).includes(`Nabídka E2E6-NAB-${TAG} → Zamítnutá`), "náhled dopadu na nabídku"));
  expect(await dlg.getByRole("button", { name: "Uzavřít: Nerealizováno" }).isDisabled(), "bez důvodu nejde potvrdit");
  await dlg.getByRole("radio", { name: "Cena", exact: true }).click();
  await dlg.getByRole("button", { name: "Uzavřít: Nerealizováno" }).click();
  await eventually(() => expect(J(KOR).status === "nerealizovano", "DB: nerealizováno"));
  const q = sql(`select state || '|' || coalesce(lost_reason, '') from quotes where job_id = ${lit(KOR.id)}`);
  expect(q === "zamitnuta|cena", `nabídka zamítnutá s důvodem (${q})`);
  expect(J(KOR).stage_changed_by === ID.obchod, "DB: korekci provedl obchodník");
});

await T("výroba: zapsat dodání 1 ze 2 položek → „Částečně dodáno 1/2 položek“ v kartě i řádku", async (context) => {
  const page = await context.newPage();
  await login(page, USERS.obchod);
  await openJob(page, DEL, "?tab=vyroba");
  const card = page.getByRole("region", { name: "Dodání zákazníkovi" });
  await card.getByRole("button", { name: "Zapsat dodání" }).click();
  const dlg = page.getByRole("dialog");
  await dlg.getByRole("button", { name: "Vše — Deska A" }).click();
  await dlg.getByRole("button", { name: "Zapsat dodání" }).click();
  await eventually(() => expect(Number(J(DEL).items_delivered) === 1, "DB: 1 položka dodaná"));
  expect(J(DEL).status === "ve_vyrobe", "stav se při částečném dodání neposunul");
  await page.goto(`${BASE}/orders?q=${encodeURIComponent(`${P}DEL`)}`);
  await bookIdle(page);
  const t = await rowOf(page, DEL).innerText();
  expect(t.includes("Částečně dodáno") && t.includes("1/2 položek"), `řádek: ${t.slice(0, 240)}`);
  await shot(page, S("03-partial-delivery"));
});

await T("mobil 375 px: autor stavu viditelný, chipy se posouvají, stránka se do šířky neroluje", async (context) => {
  const page = await context.newPage();
  await page.setViewportSize({ width: 375, height: 812 });
  await openBook(page, USERS.obchod, `?segment=poptavky&q=${encodeURIComponent(TAG)}`);
  await expectNoOverflow(page, "Kniha 375 px");
  const r = rowOf(page, INQ);
  const stampBtn = r.getByRole("button", { name: /podrobnosti$/ }).first();
  await stampBtn.waitFor({ state: "visible", timeout: 10_000 }).catch(() => {});
  expect(await stampBtn.isVisible(), "autor poslední změny je vidět i na mobilu");
  await stampBtn.click();
  await eventually(async () => expect(await page.getByRole("menu").isVisible(), "ťuknutí otevře detail autora"));
  await page.keyboard.press("Escape");
  await openJob(page, DEL);
  await expectNoOverflow(page, "Karta 375 px");
  await shot(page, S("04-mobile"));
}, { mobile: true });

const left = await cleanupOwnData();
console.log(`  (úklid: ${left.jobs} zakázek, ${left.customers} zákazníků)`);
await browser.close();
process.exit(summary(errors) ? 0 : 1);
