// E2E 07 · Stránky toku s podrobnými stavy a „kdo to udělal“ (Balík 2).
// /inquiries: chipy s počty = DB, Převzít → V řešení · Petr Obchodník, Čeká na podklady + Vrátit,
// zaměstnanec jen navrhne odmítnutí → obchodník ✓ → Odmítnutá · autor. /quotes: AI nabídka
// Schválit (+ Vrátit), Odesláno jinak, Zákazník objednal; zaměstnanec jen navrhne zamítnutí.
// /confirmations: rozpor → Požádat o opravu → Přijmout, jak je; změna rev 2 → Změnu nepřijímáme.
// Mobil 390 px bez přetékání, autor viditelný jako text. Vlastní data „E2E-07-flow-“ (zakázky a nabídky
// s vlastními čísly; jen PDF potvrzení vezme další číslo dokladu — čítače se nikdy neresetují).
import { BASE, USERS, launch, withContext, login, shot, sql, test, expect, summary } from "../lib.mjs";
import { lit, userIds, eventually, waitHydrated, expectNoOverflow, waitToast, removeStorageFiles } from "../lib-quotes-docs-flow.mjs";

const browser = await launch();
const errors = [];
const ONLY = process.env.ONLY ? new RegExp(process.env.ONLY) : null;
const T = (name, fn, opts) => (ONLY && !ONLY.test(name) ? Promise.resolve() : test(name, () => withContext(browser, errors, fn, opts)));
const S = (name) => `flow-pages/${name}`;
const norm = (s) => String(s ?? "").replace(/[  ]/g, " ").replace(/\s+/g, " ").trim();
const PREFIX = "E2E-07-flow-";
const TAG = Date.now().toString(36).toUpperCase();
const ID = userIds();
const NAME = sql(`select full_name from profiles where id = ${lit(ID.obchod)}`);
const WORKER = sql(`select full_name from profiles where id = ${lit(ID.dilna)}`);

console.log(`07 · Stránky toku — podrobné stavy a autor (značka ${TAG})`);

// ── Vlastní data (číslo zakázky i nabídky vlastní → čítače dokladů se nespotřebují) ──
async function cleanup() {
  const ids = sql(`select id from orders where title like ${lit(`${PREFIX}%`)}`).split("\n").filter(Boolean);
  if (!ids.length) return 0;
  const inList = ids.map(lit).join(",");
  // vystavené PDF (potvrzení) z úložiště, archiv dokladů a odchozí e-maily
  await removeStorageFiles(sql(`select storage_path from job_files where job_id in (${inList}) and storage_path is not null`).split("\n").filter(Boolean));
  sql(`delete from documents where order_id in (${inList})`);
  sql(`delete from emails where order_id in (${inList}) and direction = 'out'`);
  sql(`update emails set order_id = null where order_id in (${inList})`);
  sql(`delete from approval_queue where order_id in (${inList})`);
  sql(`update job_files set quote_id = null where job_id in (${inList})`);
  sql(`update orders set quote_id = null where id in (${inList})`);
  sql(`delete from quote_items where quote_id in (select id from quotes where job_id in (${inList}))`);
  sql(`delete from quotes where job_id in (${inList})`);
  sql(`delete from orders where id in (${inList})`);
  return ids.length;
}
const left = await cleanup();
if (left) console.log(`  (úklid po minulém běhu: ${left} zakázek)`);
let seq = 0;
function job({ title, status = "poptavka", source = "email", items = 1 }) {
  seq += 1;
  const number = `Z-E2E07-${TAG}-${seq}`;
  const id = sql(`insert into orders (number, title, status, source, owner_id, created_by, inquiry_date, customer_required_date, priority)
    values (${lit(number)}, ${lit(`${PREFIX}${title} ${TAG}`)}, ${lit(status)}::job_stage, ${lit(source)}, ${lit(ID.obchod)}, ${lit(ID.obchod)}, current_date - 3, current_date + 20, 'stredni')
    returning id`).split("\n")[0];
  for (let i = 0; i < items; i++) {
    sql(`insert into order_items (order_id, position, drawing_number, name, quantity, unit, unit_price) values (${lit(id)}, ${i}, ${lit(`E07-${TAG}-${i}`)}, 'Díl', 2, 'ks', 500)`);
  }
  return { id, number };
}
function quote(j, { status = "ke_schvaleni", ai = false, sent = false }) {
  seq += 1;
  const number = `NAB-E2E07-${TAG}-${seq}`;
  const id = sql(`insert into quotes (number, job_id, status, total, currency, valid_until, revision, created_by, owner_id, ai_generated, sent_at, title)
    values (${lit(number)}, ${lit(j.id)}, ${lit(status)}::quote_status, 1000, 'CZK', current_date + 30, 1, ${lit(ID.obchod)}, ${lit(ID.obchod)}, ${ai}, ${sent ? "now()" : "null"}, 'E2E 07')
    returning id`).split("\n")[0];
  sql(`insert into quote_items (quote_id, position, name, quantity, unit, unit_price) values (${lit(id)}, 0, 'Díl', 2, 'ks', 500)`);
  return { id, number };
}

const INQ = job({ title: "poptávka převzít" });
const PROP = job({ title: "poptávka návrh" });
const AIJ = job({ title: "AI nabídka", status: "naceneni" });
const AIQ = quote(AIJ, { ai: true });
const SENTJ = job({ title: "odeslaná nabídka", status: "nabidka" });
const SENTQ = quote(SENTJ, { status: "odeslano", sent: true });

async function flowPage(page, path, title) {
  await page.goto(`${BASE}${path}`);
  await page.locator("main h1").filter({ hasText: title }).first().waitFor({ timeout: 30_000 });
  await page.waitForFunction(() => !document.querySelector('div[hidden][id^="S:"]'), null, { timeout: 30_000 });
}
const row = (page, j) => page.locator("main li").filter({ has: page.locator(`a[href="/orders/${j.id}"]`) }).first();
const quoteRow = (page, q) => page.locator("main li").filter({ has: page.locator("span.font-mono", { hasText: new RegExp(`^${q.number}$`) }) }).first();
/** Počet chipu „<štítek> N“ ve skupině. */
async function chipCount(page, group, label) {
  const b = page.getByRole("group", { name: group }).getByRole("button", { name: new RegExp(`^${label}\\s*\\d+$`) }).first();
  return Number((await b.innerText()).replace(/\D+/g, ""));
}
const dbCount = (phase, key) => Number(sql(`select coalesce(sum(n), 0) from flow_counts() where flow_phase = ${lit(phase)} and flow_key = ${lit(key)}`) || 0);
async function menu(page, scope, item) {
  await scope.getByRole("button", { name: /^Další akce/ }).click();
  await page.getByRole("menuitem", { name: item }).click();
}

// ═════════════════════════ POPTÁVKY ═════════════════════════
await T("/inquiries: chipy s počty = DB; Převzít → „V řešení · <obchodník>“ + DB autor; Čeká na podklady → Podklady máme → Vrátit", async (context) => {
  const page = await context.newPage();
  await login(page, USERS.obchod);
  await flowPage(page, "/inquiries", "Poptávky");
  await waitHydrated(page, 'main [role="group"][aria-label="Stav poptávky"] button');
  expect(await chipCount(page, "Stav poptávky", "Přijatá") === dbCount("inquiry", "prijata"), "počet Přijatá = flow_counts");
  expect(await chipCount(page, "Stav poptávky", "V řešení") === dbCount("inquiry", "v_reseni"), "počet V řešení = flow_counts");
  const r = row(page, INQ);
  await r.locator('[data-flow-state="inquiry.prijata"]').waitFor({ timeout: 10_000 });
  await shot(page, S("01-inquiries"));
  await r.getByRole("button", { name: "Převzít", exact: true }).click();
  await waitToast(page, /Poptávka převzata/);
  await eventually(async () => expect(norm(await row(page, INQ).innerText()).includes(`V řešení · ${NAME}`), "řádek: V řešení · obchodník"));
  expect(sql(`select inquiry_status || '|' || inquiry_status_changed_by || '|' || assignee_id from orders where id = ${lit(INQ.id)}`) === `v_reseni|${ID.obchod}|${ID.obchod}`, "DB: v_reseni, autor + řešitel");

  await menu(page, row(page, INQ), "Čeká na podklady…");
  const dlg = page.getByRole("dialog");
  await dlg.getByLabel(/Co chybí/).fill("Výkres v PDF");
  await dlg.getByRole("button", { name: "Čeká na podklady" }).click();
  await waitToast(page, /čeká na podklady/);
  await eventually(async () => expect(await row(page, INQ).locator('[data-flow-state="inquiry.ceka_na_podklady"]').count() === 1, "chip Čeká na podklady"));
  expect(norm(await row(page, INQ).innerText()).includes("Výkres v PDF"), "co chybí je vidět v chipu");
  await row(page, INQ).getByRole("button", { name: "Podklady máme" }).click();
  await row(page, INQ).getByRole("button", { name: "Vrátit" }).click();
  await waitToast(page, /Vráceno/);
  await eventually(() => expect(sql(`select inquiry_status || '|' || waiting_note from orders where id = ${lit(INQ.id)}`) === "ceka_na_podklady|Výkres v PDF", "Vrátit obnovil čekání i poznámku"));
  const ev = sql(`select count(*) from job_events where job_id = ${lit(INQ.id)} and type = 'status' and actor_id = ${lit(ID.obchod)}`);
  expect(Number(ev) >= 4, `historie stavů poptávky s autorem (${ev})`);
});

await T("/inquiries: zaměstnanec jen navrhne odmítnutí; obchodník ✓ → Odmítnutá — důvod · autor, filtr Odmítnutá", async (context) => {
  const page = await context.newPage();
  await login(page, USERS.dilna);
  await flowPage(page, "/inquiries", "Poptávky");
  await waitHydrated(page, `main a[href="/orders/${PROP.id}"]`);
  await row(page, PROP).getByRole("button", { name: /^Další akce/ }).click();
  expect(await page.getByRole("menuitem", { name: "Odmítnout poptávku…" }).count() === 0, "zaměstnanec nemá Odmítnout");
  await page.getByRole("menuitem", { name: "Navrhnout odmítnutí…" }).click();
  const dlg = page.getByRole("dialog");
  await dlg.getByRole("radio", { name: /Nestíháme/ }).click();
  await dlg.getByRole("button", { name: "Navrhnout" }).click();
  await waitToast(page, /Návrh odeslán/);
  await eventually(async () => expect(norm(await row(page, PROP).innerText()).includes(`Návrh: Odmítnout poptávku`), "zaměstnanec vidí svůj návrh"));
  expect(await row(page, PROP).getByRole("button", { name: /^Přijmout návrh/ }).count() === 0, "zaměstnanec nerozhoduje");

  await page.context().clearCookies();
  await login(page, USERS.obchod);
  await flowPage(page, "/inquiries", "Poptávky");
  await waitHydrated(page, `main a[href="/orders/${PROP.id}"]`);
  expect(norm(await row(page, PROP).innerText()).includes(WORKER), "u návrhu je jméno zaměstnance");
  await row(page, PROP).getByRole("button", { name: /^Přijmout návrh/ }).first().click();
  await waitToast(page, /Návrh přijat/);
  await eventually(() => expect(sql(`select status || '|' || inquiry_status || '|' || lost_reason || '|' || lost_by from orders where id = ${lit(PROP.id)}`) === `nerealizovano|odmitnuta|kapacita|${ID.obchod}`, "DB: odmítnutá, autor = obchodník"));
  await flowPage(page, "/inquiries?stav=odmitnuta", "Poptávky");
  const r = row(page, PROP);
  await r.waitFor({ timeout: 10_000 });
  const t = norm(await r.innerText());
  expect(t.includes("Odmítnutá — Nestíháme (kapacita / termín)") && t.includes(`Odmítnutá · ${NAME}`), `filtr Odmítnutá: důvod + autor (${t.slice(0, 200)})`);
  const msg = sql(`select message from job_events where job_id = ${lit(PROP.id)} and type = 'status' order by created_at desc limit 1`);
  expect(msg.includes("na návrh:") || sql(`select count(*) from job_events where job_id = ${lit(PROP.id)} and message like '%na návrh:%'`) !== "0", `historie: „na návrh: …“ (${msg})`);
});

// ═════════════════════════ NABÍDKY ═════════════════════════
await T("/quotes: AI nabídka Čeká na schválení → Schválit (+ Vrátit) → Odesláno jinak → Zákazník objednal; kdo u každého kroku", async (context) => {
  const page = await context.newPage();
  await login(page, USERS.obchod);
  await flowPage(page, "/quotes", "Nabídky");
  await waitHydrated(page, 'main [role="group"][aria-label="Stav nabídky"] button');
  expect(await chipCount(page, "Stav nabídky", "Čeká na schválení") === dbCount("quote", "ke_schvaleni"), "počet Čeká na schválení = flow_counts");
  const r = quoteRow(page, AIQ);
  await r.waitFor({ timeout: 10_000 });
  expect(await r.getAttribute("data-quote-state") === "ke_schvaleni", "AI nabídka čeká na schválení");
  expect(norm(await r.innerText()).includes("kontrola AI"), "důvod schválení: kontrola AI");
  await r.getByRole("button", { name: "Schválit", exact: true }).click();
  await waitToast(page, /schválena/);
  await eventually(async () => expect(await quoteRow(page, AIQ).getAttribute("data-quote-state") === "schvalena", "stav Schválená"));
  await quoteRow(page, AIQ).getByRole("button", { name: "Vrátit" }).click();
  await waitToast(page, /Vráceno/);
  await eventually(() => expect(sql(`select state || '|' || coalesce(approved_by::text, '-') from quotes where id = ${lit(AIQ.id)}`) === "ke_schvaleni|-", "Vrátit = zase čeká na schválení"));
  await page.reload();
  await waitHydrated(page, 'main [role="group"][aria-label="Stav nabídky"] button');
  await quoteRow(page, AIQ).getByRole("button", { name: "Schválit", exact: true }).click();
  await waitToast(page, /schválena/);
  await eventually(async () => expect(norm(await quoteRow(page, AIQ).innerText()).includes("Schváleno ·"), "kdo schválil"));
  await menu(page, quoteRow(page, AIQ), "Odesláno jinak…");
  const dlg = page.getByRole("dialog");
  await dlg.getByLabel(/Jak odešla/).fill("osobně na schůzce");
  await dlg.getByRole("button", { name: "Označit jako odeslanou" }).click();
  await waitToast(page, /označena jako odeslaná/);
  await eventually(async () => expect(norm(await quoteRow(page, AIQ).innerText()).includes("Odesláno jinak ·"), "Odesláno jinak · kdo"));
  expect(sql(`select status || '|' || sent_via || '|' || sent_by from quotes where id = ${lit(AIQ.id)}`) === `odeslano|rucne|${ID.obchod}`, "DB: odesláno ručně, kdo");
  await quoteRow(page, AIQ).getByRole("button", { name: "Zákazník objednal" }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Ano, objednal" }).click();
  await waitToast(page, /přijata/);
  await eventually(() => expect(sql(`select o.status || '|' || o.order_status || '|' || q.state || '|' || q.accepted_by from orders o join quotes q on q.job_id = o.id where q.id = ${lit(AIQ.id)}`) === `objednavka|dorucena|prijata|${ID.obchod}`, "DB: objednávka doručená, nabídka přijatá, kdo"));
  await shot(page, S("02-quotes"));
});

await T("/quotes: zaměstnanec u odeslané nabídky jen navrhne zamítnutí (bez Zamítnout)", async (context) => {
  const page = await context.newPage();
  await login(page, USERS.dilna);
  await flowPage(page, "/quotes", "Nabídky");
  await waitHydrated(page, 'main [role="group"][aria-label="Stav nabídky"] button');
  const r = quoteRow(page, SENTQ);
  await r.waitFor({ timeout: 10_000 });
  await r.getByRole("button", { name: `Další akce nabídky ${SENTQ.number}` }).click();
  expect(await page.getByRole("menuitem", { name: "Zamítnout nabídku…" }).count() === 0, "bez Zamítnout");
  expect(await page.getByRole("menuitem", { name: "Navrhnout zamítnutí…" }).count() === 1, "s Navrhnout zamítnutí");
  await page.keyboard.press("Escape");
});

// ═════════════════════════ POTVRZENÍ ═════════════════════════
await T("/confirmations: rozpor → Požádat o opravu → Přijmout, jak je (bez e-mailu) → Potvrzená · autor; změna rev 2 → Změnu nepřijímáme", async (context) => {
  const page = await context.newPage();
  await login(page, USERS.obchod);
  await flowPage(page, "/confirmations", "Potvrzení objednávek");
  await waitHydrated(page, 'main [role="group"][aria-label="Stav objednávky"] button');
  expect(await chipCount(page, "Stav objednávky", "Doručená") === dbCount("order", "dorucena"), "počet Doručená = flow_counts");
  const r = () => row(page, AIJ);
  await r().waitFor({ timeout: 10_000 });
  expect(norm(await r().innerText()).includes("Potvrdit objednávku"), "další krok: Potvrdit objednávku");
  await menu(page, r(), "Rozpor s nabídkou…");
  let dlg = page.getByRole("dialog");
  await dlg.getByLabel("Popis rozdílu 1").fill("Díl E07");
  await dlg.getByLabel("V nabídce 1").fill("2 ks");
  await dlg.getByLabel("V objednávce 1").fill("3 ks");
  await dlg.getByRole("button", { name: "Zapsat rozpor" }).click();
  await waitToast(page, /Rozpor s nabídkou zapsán/);
  await eventually(async () => expect(norm(await r().innerText()).includes("Rozpor s nabídkou · 1 rozdíl"), "chip rozporu s počtem rozdílů"));
  await r().getByRole("button", { name: "Vyřešit rozpor" }).click();
  dlg = page.getByRole("dialog");
  await dlg.getByRole("button", { name: "Požádat o opravu" }).click();
  await waitToast(page, /Žádost o opravu/);
  await eventually(async () => expect(norm(await r().innerText()).includes("oprava vyžádána"), "chip: oprava vyžádána"));
  await r().getByRole("button", { name: "Vyřešit rozpor" }).click();
  await page.getByRole("dialog").getByRole("button", { name: /Přijmout, jak je — potvrdit/ }).click();
  dlg = page.getByRole("dialog");
  await dlg.getByRole("heading", { name: `Přijmout objednávku ${AIJ.number}, jak je` }).waitFor({ timeout: 10_000 });
  const sw = dlg.getByRole("switch", { name: "Poslat potvrzení zákazníkovi e-mailem" });
  if ((await sw.getAttribute("aria-checked")) === "true") await sw.click();
  await dlg.getByRole("button", { name: "Přijmout, jak je" }).click();
  await waitToast(page, /potvrzena/, 30_000);
  // bez e-mailu: potvrzeno, potvrzení zatím neodešlo (žádný falešný fakt „odesláno")
  await eventually(() => expect(sql(`select status || '|' || order_status || '|' || confirmed_by || '|' || coalesce(confirmation_sent_via, '-') from orders where id = ${lit(AIJ.id)}`) === `potvrzeno|potvrzena|${ID.obchod}|-`, "DB: potvrzeno bez odeslání, kdo"));
  await flowPage(page, "/confirmations?stav=potvrzena", "Potvrzení objednávek");
  await r().waitFor({ timeout: 10_000 });
  expect(norm(await r().innerText()).includes(`Potvrzená · ${NAME}`), "filtr Potvrzená: kdo potvrdil");

  await menu(page, r(), "Zákazník změnil objednávku…");
  dlg = page.getByRole("dialog");
  await dlg.getByLabel(/Co se změnilo/).fill("Množství E07 ze 2 na 4 ks");
  await dlg.getByRole("button", { name: "Zapsat změnu" }).click();
  await waitToast(page, /rev 2/);
  await flowPage(page, "/confirmations", "Potvrzení objednávek");
  await r().waitFor({ timeout: 10_000 });
  expect(norm(await r().innerText()).includes(`Aktualizovaná rev 2 · ${NAME}`), "řádek: Aktualizovaná rev 2 · kdo");
  await r().getByRole("button", { name: "Potvrdit změnu" }).click();
  dlg = page.getByRole("dialog");
  expect(norm(await dlg.innerText()).includes("Množství E07 ze 2 na 4 ks"), "dialog ukazuje změnu");
  await dlg.getByRole("button", { name: "Změnu nepřijímáme…" }).click();
  await dlg.getByLabel(/Proč změnu nepřijímáme/).fill("materiál je nařezaný");
  await dlg.getByRole("button", { name: "Změnu nepřijímáme" }).click();
  await waitToast(page, /Změna nepřijata/);
  await eventually(() => expect(sql(`select order_status || '|' || order_revision || '|' || order_confirmed_revision from orders where id = ${lit(AIJ.id)}`) === "potvrzena|2|1", "DB: změna rev 2 odmítnuta"));
  await shot(page, S("03-confirmations"));
});

// ═════════════════════════ MOBIL ═════════════════════════
await T("mobil 390 px: stránky toku bez přetékání, chipy posuvné, autor viditelný jako text", async (context) => {
  const page = await context.newPage();
  await login(page, USERS.obchod);
  for (const [path, title] of [["/inquiries", "Poptávky"], ["/pricing", "Nacenění"], ["/quotes", "Nabídky"], ["/confirmations?stav=potvrzena", "Potvrzení objednávek"]]) {
    await flowPage(page, path, title);
    await expectNoOverflow(page, path);
  }
  await flowPage(page, "/inquiries", "Poptávky");
  const stamp = row(page, INQ).locator("button[aria-label$='— podrobnosti']").first();
  expect(await stamp.isVisible(), "autor je vidět i na mobilu");
  const box = await row(page, INQ).getByRole("button", { name: /^Další akce/ }).boundingBox();
  expect(box && box.height >= 43, `menu ⋯ má na mobilu aspoň 44 px (${box?.height})`);
  await shot(page, S("04-mobile-inquiries"));
}, { mobile: true });

await cleanup();
await browser.close();
process.exit(summary(errors) ? 0 : 1);
