// E2E 10 · Podrobné stavy celého obchodního toku a „kdo to udělal" (integrace Balíků 0–3).
// Jedna zakázka projde z UI všemi fázemi: poptávka (Převzít, Čeká na podklady, Podklady máme) →
// nacenění (/pricing) → nabídka (Odeslat e-mailem, návrh zaměstnance ✕, Zákazník objednal) →
// objednávka (Potvrdit, Zákazník změnil = Aktualizovaná rev 2, Potvrdit změnu, Korekce stavu
// s náhledem) → dodání 1/2 a zbytek → faktura → úhrada částečná a vyrovnání → objednávka
// dodavateli (potvrzení, převzetí 1/2, zbytek). U každého kroku ověří DB (dílčí stavy, job_stage
// jen dopředu, job_events s actor_id + actor_name, sloupce *_by) a jméno účtu v UI (hlavička,
// chipy, historie, mobil 390 px). Dál role (zaměstnanec jen navrhne, obchodník rozhodne), počty
// chipů v záložkách toku a v Knize (= flow_counts), filtr „Změnil" a podvrh atribuce přes REST.
// Vlastní data „E2E-10-" s vlastními čísly zakázek a objednávek; na konci se uklidí.
import { BASE, USERS, launch, withContext, login, shot, sql, test, expect, summary, rest, restLogin } from "../lib.mjs";
import {
  lit, userIds, eventually, waitHydrated, expectNoOverflow, waitToast, removeStorageFiles,
} from "../lib-quotes-docs-flow.mjs";

const browser = await launch();
const errors = [];
const ONLY = process.env.ONLY ? new RegExp(process.env.ONLY) : null;
const T = (name, fn, opts) => (ONLY && !ONLY.test(name) ? Promise.resolve() : test(name, () => withContext(browser, errors, fn, opts)));
const S = (name) => `flow-statuses/${name}`;
const norm = (s) => String(s ?? "").replace(/[  ]/g, " ").replace(/\s+/g, " ").trim();
const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const P = "E2E-10-";
const TAG = Date.now().toString(36).toUpperCase();
const ID = userIds();
const NAME = { obchod: "Petr Obchodník", dilna: "Jana Zaměstnanec", admin: "Super Admin" };
const SHORT = { obchod: "P. Obchodník", dilna: "J. Zaměstnanec", admin: "S. Admin" };
const RANK = {
  poptavka: 0, naceneni: 1, nabidka: 2, objednavka: 3, potvrzeno: 4, ve_vyrobe: 5, dodano_k_nam: 6, na_sklade: 7, montaz: 8,
  dodano_zakaznikovi: 9, fakturovano: 10, dokonceno: 11,
};

console.log(`10 · Podrobné stavy toku a autor každé změny (značka ${TAG})`);

// ── Vlastní data ─────────────────────────────────────────────
async function cleanup() {
  const jobs = sql(`select id from orders where title like ${lit(`${P}%`)}`).split("\n").filter(Boolean);
  const custs = sql(`select id from customers where name like ${lit(`${P}%`)}`).split("\n").filter(Boolean);
  if (jobs.length) {
    const inList = jobs.map(lit).join(",");
    const paths = sql(`select storage_path from job_files where job_id in (${inList}) and storage_path is not null
      union all select storage_path from invoices where order_id in (${inList}) and storage_path is not null`).split("\n").filter(Boolean);
    await removeStorageFiles(paths);
    sql(`delete from purchase_order_items where purchase_order_id in (select id from purchase_orders where job_id in (${inList}))`);
    sql(`delete from purchase_orders where job_id in (${inList})`);
    sql(`delete from documents where order_id in (${inList})`);
    sql(`delete from delivery_notes where order_id in (${inList})`); // DL dodávek (order_id on delete set null)
    sql(`delete from invoices where order_id in (${inList})`);
    sql(`delete from emails where order_id in (${inList}) and direction = 'out'`);
    sql(`update emails set order_id = null where order_id in (${inList})`);
    sql(`delete from approval_queue where order_id in (${inList})`);
    sql(`update orders set quote_id = null where id in (${inList})`);
    sql(`update job_files set quote_id = null where job_id in (${inList})`);
    sql(`delete from quote_items where quote_id in (select id from quotes where job_id in (${inList}))`);
    sql(`delete from quotes where job_id in (${inList})`);
    sql(`delete from orders where id in (${inList})`);
    sql(`delete from audit_log where entity_id::text in (${inList}) or diff->>'jobId' in (${inList})`);
  }
  if (custs.length) {
    const inList = custs.map(lit).join(",");
    sql(`delete from customer_contacts where customer_id in (${inList})`);
    sql(`delete from customers where id in (${inList}) and not exists (select 1 from orders o where o.customer_id = customers.id)`);
  }
  return { jobs: jobs.length, customers: custs.length };
}
const left = await cleanup();
if (left.jobs || left.customers) console.log(`  (úklid po minulém běhu: ${left.jobs} zakázek, ${left.customers} zákazníků)`);

const EMAIL = `e2e10-${TAG.toLowerCase()}@local.test`;
const CUST = (() => {
  const id = sql(`insert into customers (name, country, owner_id, payment_terms_days, email, contact_person, city, street, zip, ico)
    values (${lit(`${P}Kovo ${TAG} s.r.o.`)}, 'CZ', ${lit(ID.obchod)}, 14, ${lit(EMAIL)}, 'Ing. Eva Testová', 'Brno', 'Testovací 5', '602 00', '87654321')
    returning id`).split("\n")[0];
  return { id };
})();

let seq = 0;
/** Poptávka z e-mailu, nikdo ji nepřevzal (vlastní číslo — čítač zakázek se nespotřebuje). */
function inquiry(title, items) {
  seq += 1;
  const number = `Z-E2E10-${TAG}-${seq}`;
  const id = sql(`insert into orders (number, title, status, source, owner_id, created_by, customer_id, inquiry_date, customer_required_date, priority)
    values (${lit(number)}, ${lit(`${P}${title} ${TAG}`)}, 'poptavka', 'email', ${lit(ID.obchod)}, ${lit(ID.obchod)}, ${lit(CUST.id)}, current_date - 1, current_date + 30, 'stredni')
    returning id`).split("\n")[0];
  sql(`update orders set inquiry_status = 'prijata', assignee_id = null where id = ${lit(id)}`);
  items.forEach((it, i) => {
    sql(`insert into order_items (order_id, position, drawing_number, name, material, quantity, unit)
      values (${lit(id)}, ${i}, ${lit(it.drawing)}, ${lit(it.name)}, 'C45', ${it.qty}, 'ks')`);
  });
  return { id, number };
}
const J = inquiry("celý tok", [
  { drawing: `E10-A-${TAG}`, name: `Deska A ${TAG}`, qty: 2 },
  { drawing: `E10-B-${TAG}`, name: `Čep B ${TAG}`, qty: 3 },
]);
const R = inquiry("odmítnutí na návrh", [{ drawing: `E10-R-${TAG}`, name: "Hřídel R", qty: 1 }]);
const T0 = sql("select now()");

// ── Pomocníci ────────────────────────────────────────────────
const row = (job) => JSON.parse(sql(`select row_to_json(o)::text from orders o where id = ${lit(job.id)}`));
const flowRow = (job) => JSON.parse(sql(`select row_to_json(v)::text from job_flow_v v where id = ${lit(job.id)}`));
/** Poslední události zakázky (typ, zpráva, autor, jméno, druh, způsob). */
function lastEvent(job, where) {
  const r = sql(`select json_build_object('type', type, 'message', message, 'actor', actor_id, 'name', actor_name, 'kind', actor_kind, 'via', via, 'data', data)::text
    from job_events where job_id = ${lit(job.id)} and ${where} order by created_at desc, id desc limit 1`);
  return r ? JSON.parse(r) : null;
}
function expectEvent(ev, { actor, startsWith, includes, via }) {
  expect(ev, `událost existuje (${startsWith ?? includes})`);
  if (startsWith) expect(ev.message.startsWith(startsWith), `zpráva „${startsWith}…" (${ev.message})`);
  if (includes) expect(ev.message.includes(includes), `zpráva obsahuje „${includes}" (${ev.message})`);
  expect(ev.actor === ID[actor] && ev.name === NAME[actor], `autor události ${NAME[actor]} (${ev.actor} / ${ev.name})`);
  if (via) expect(ev.via === via, `způsob ${via} (${ev.via})`);
}
const header = (page) => page.locator('main section[aria-label="Zakázka"]');
async function openJob(page, job, query = "") {
  await page.goto(`${BASE}/orders/${job.id}${query}`);
  await header(page).waitFor({ timeout: 20_000 });
  await waitHydrated(page, 'main section[aria-label="Zakázka"] button[aria-label^="Stav zakázky:"]');
}
/** Primární tlačítko dalšího kroku v hlavičce (sloveso). */
const nextBtn = (page, label) => header(page).getByRole("button", { name: label, exact: true });
/** Razítko „kdo · kdy" (text viditelný na všech šířkách, ťuknutím detail). */
const stamp = (scope, re) => scope.getByRole("button", { name: re });
/** Dodání během výroby s otevřeným krokem: dialog „Ukončit výrobu" → „Zapsat dodání bez ukončení kroků" (postaru). */
async function skipFinish(dlg) {
  const plain = dlg.locator('[data-testid="handoff-plain-move"]');
  const delivery = dlg.getByRole("button", { name: /^Vše — / }).first();
  await Promise.race([plain.waitFor({ timeout: 25_000 }), delivery.waitFor({ timeout: 25_000 })]).catch(() => {});
  if (await plain.isVisible().catch(() => false)) {
    expect(norm(await dlg.innerText()).includes("Výroba ještě běží"), "upozornění: výroba ještě běží");
    expect(norm(await plain.innerText()) === "Zapsat dodání bez ukončení kroků", "druhotná akce dodání bez ukončení");
    await plain.click();
    await delivery.waitFor({ timeout: 15_000 });
  }
}

async function stateMenu(page, item) {
  await header(page).getByRole("button", { name: "Akce se stavem" }).click();
  await page.getByRole("menuitem", { name: item }).click();
}
async function menuItems(page) {
  await header(page).getByRole("button", { name: "Akce se stavem" }).click();
  const items = (await page.getByRole("menuitem").allInnerTexts()).map(norm);
  await page.keyboard.press("Escape");
  return items;
}
async function openTab(page, name) {
  await page.getByRole("tab", { name: new RegExp(`^${name}`) }).click();
  await page.waitForFunction((n) => document.querySelector('main [role=tab][aria-selected="true"]')?.textContent?.trim().startsWith(n), name, { timeout: 10_000 });
}
const historyText = async (page) => norm(await page.locator("main [role=tabpanel][data-state=active]").innerText());
const flowCount = (phase, key) => Number(sql(`select coalesce(sum(n), 0) from flow_counts(null, 30) where flow_phase = ${lit(phase)} and flow_key = ${lit(key)}`));
async function chipCount(page, group, label) {
  const btn = page.locator(`main [role=group][aria-label="${group}"] button[aria-pressed]`).filter({ hasText: new RegExp(`^\\s*${esc(label)}\\s*\\d+\\s*$`) });
  return Number(/(\d+)\s*$/.exec(norm(await btn.innerText()))[1]);
}

// ═════════════════════════ 1. POPTÁVKA ═════════════════════════
await T("poptávka: Převzít → V řešení · Petr Obchodník; Čeká na podklady (co chybí) → Podklady máme; DB + Historie s autorem", async (context) => {
  const page = await context.newPage();
  await login(page, USERS.obchod);
  await openJob(page, J);
  expect(norm(await header(page).innerText()).includes("Přijatá"), "hlavička: Přijatá");
  await nextBtn(page, "Převzít").click();
  await eventually(() => {
    const o = row(J);
    expect(o.inquiry_status === "v_reseni" && o.assignee_id === ID.obchod && o.inquiry_status_changed_by === ID.obchod, `DB: V řešení, řešitel a autor obchodník (${o.inquiry_status}, ${o.assignee_id})`);
  });
  expectEvent(lastEvent(J, "type = 'status'"), { actor: "obchod", startsWith: "Poptávka: Přijatá → V řešení" });
  await page.reload();
  await waitHydrated(page, 'main section[aria-label="Zakázka"] button[aria-label^="Stav zakázky:"]');
  await eventually(async () => {
    expect(norm(await header(page).innerText()).includes("V řešení"), "hlavička: V řešení");
    expect(await stamp(header(page), /Petr Obchodník.* — podrobnosti$/).first().isVisible(), "hlavička: razítko Petr Obchodník");
  });
  // Čeká na podklady — co chybí je povinné
  await stateMenu(page, "Čeká na podklady…");
  const dlg = page.getByRole("dialog");
  await dlg.getByRole("heading", { name: "Čeká na podklady" }).waitFor({ timeout: 10_000 });
  const confirm = dlg.getByRole("button", { name: "Čeká na podklady" });
  expect(await confirm.isDisabled(), "bez popisu, co chybí, nejde potvrdit");
  await dlg.getByRole("textbox").fill(`Výkres ve STEP ${TAG}`);
  await confirm.click();
  await eventually(() => {
    const o = row(J);
    expect(o.inquiry_status === "ceka_na_podklady" && o.waiting_note === `Výkres ve STEP ${TAG}` && o.waiting_since, `DB: čeká na podklady + co chybí (${o.inquiry_status})`);
  });
  expectEvent(lastEvent(J, "type = 'status'"), { actor: "obchod", startsWith: `Poptávka: V řešení → Čeká na podklady — Výkres ve STEP ${TAG}` });
  expect(flowRow(J).inquiry_key === "ceka_na_podklady", "job_flow_v: ceka_na_podklady");
  await eventually(async () => expect(await nextBtn(page, "Podklady máme").isVisible(), "další krok: Podklady máme"));
  await nextBtn(page, "Podklady máme").click();
  await eventually(() => expect(row(J).inquiry_status === "v_reseni", "DB: zase V řešení"));
  expect(row(J).status === "poptavka", "hlavní stav se dílčím stavem poptávky nezměnil");
  await openTab(page, "Historie");
  await eventually(async () => {
    const t = await historyText(page);
    expect(t.includes("Poptávka: Přijatá → V řešení") && t.includes("Čeká na podklady") && t.includes(NAME.obchod), `Historie: dílčí stavy se jménem (${t.slice(0, 300)})`);
  });
  await shot(page, S("01-inquiry"));
});

// ═════════════════════════ 2. NACENĚNÍ ═════════════════════════
await T("nacenění: /pricing (jen super admin) uloží ceny → Nacenění (jen dopředu) + nacenil; obchodník v kartě „Vytvořit nabídku“ → Neschválená · autor", async (context) => {
  const page = await context.newPage();
  // #25: Nacenění jen super admin — obchodníka stránka vrátí do Knihy s vysvětlením
  await login(page, USERS.obchod);
  await page.goto(`${BASE}/pricing?job=${J.id}`);
  await page.waitForURL(/\/orders\?pristup=pricing/, { timeout: 20_000 });
  await withContext(browser, errors, async (ac) => {
    const ap = await ac.newPage();
    await login(ap, USERS.admin);
    await ap.goto(`${BASE}/pricing?job=${J.id}`);
    const li = ap.locator(`main li#job-${J.id}`);
    await li.waitFor({ timeout: 20_000 });
    await waitHydrated(ap, `li#job-${J.id} button[aria-expanded]`);
    const lt = norm(await li.innerText());
    expect(lt.includes("V řešení") && (lt.includes(SHORT.obchod) || lt.includes(NAME.obchod)), `karta Nacenění: V řešení + kdo (${lt.slice(0, 300)})`);
    await li.getByLabel("Položka 1: prodejní cena za kus").fill("1500");
    await li.getByLabel("Položka 2: prodejní cena za kus").fill("400");
    await li.getByRole("button", { name: "Uložit nacenění" }).click();
    await li.getByText("Uloženo — AI se z tvých cen učí.").waitFor({ timeout: 20_000 });
  });
  await eventually(() => {
    const o = row(J);
    expect(o.status === "naceneni" && o.priced_by === ID.admin && o.stage_changed_by === ID.admin, `DB: Nacenění, nacenil a posunul super admin (${o.status})`);
  });
  expectEvent(lastEvent(J, "type = 'stage'"), { actor: "admin", startsWith: "Stav: Poptávka → Nacenění" });
  expect(flowRow(J).pricing_key === "naceneno" && row(J).inquiry_status === "v_reseni", "job_flow_v: Naceněno, poptávka V řešení");
  // nabídku připraví obchodník ručně v kartě zakázky (záložka Nabídky)
  await openJob(page, J, "?tab=nabidky");
  const panel = page.locator("main [role=tabpanel][data-state=active]");
  await panel.getByRole("button", { name: "Vytvořit nabídku z 2 položek" }).click();
  const dlg = page.getByRole("dialog");
  await dlg.getByRole("heading", { name: "Nová nabídka" }).waitFor({ timeout: 10_000 });
  const prices = dlg.locator('table input[aria-label="Cena za MJ"]');
  await prices.nth(0).fill("1500");
  await prices.nth(1).fill("400");
  await dlg.getByLabel(/Dodací lhůta/).fill("20");
  await dlg.getByRole("button", { name: "Vytvořit nabídku", exact: true }).click();
  await eventually(() => expect(sql(`select count(*) from quotes where job_id = ${lit(J.id)}`) === "1", "nabídka vytvořená"));
  const q = sql(`select state || '|' || created_by || '|' || coalesce(state_changed_by::text, '-') || '|' || approval_required from quotes where job_id = ${lit(J.id)}`);
  // #25: nabídku obchodníka schvaluje super admin → Neschválená
  expect(q === `ke_schvaleni|${ID.obchod}|${ID.obchod}|true`, `DB nabídka: Neschválená, zadal obchodník, čeká na super admina (${q})`);
  await shot(page, S("02-pricing"));
});

// ═════════════════════════ 3. NABÍDKA ═════════════════════════
await T("nabídka: „Odesláno jinak…“ s poznámkou → Odeslaná · autor, zakázka jen dopředu na Nabídku, poptávka Zpracovaná", async (context) => {
  // e-mailem odesílá nabídku E2E 05; tady stav nezávisle na poštovním serveru
  // #25: nejdřív ji schválí super admin (obchodník ji do té doby odeslat nemůže)
  const page = await context.newPage();
  await login(page, USERS.obchod);
  await openJob(page, J);
  expect(await nextBtn(page, "Odeslat nabídku").count() === 0, "neschválenou nabídku obchodník neodešle");
  await withContext(browser, errors, async (ac) => {
    const ap = await ac.newPage();
    await login(ap, USERS.admin);
    await openJob(ap, J);
    await nextBtn(ap, "Schválit").click();
    await eventually(() => expect(sql(`select state || '|' || approved_by from quotes where job_id = ${lit(J.id)}`) === `schvalena|${ID.admin}`, "DB: schválil super admin"));
  });
  await page.reload();
  await waitHydrated(page, 'main section[aria-label="Zakázka"] button[aria-label^="Stav zakázky:"]');
  await eventually(async () => expect(await nextBtn(page, "Odeslat nabídku").isVisible(), "další krok po schválení: Odeslat nabídku (obchodník)"));
  await stateMenu(page, "Odesláno jinak…");
  const dlg = page.getByRole("dialog");
  await dlg.getByRole("heading", { name: /^Odesláno jinak — / }).waitFor({ timeout: 10_000 });
  await dlg.getByRole("textbox").fill(`předáno osobně ${TAG}`);
  await dlg.getByRole("button", { name: "Označit jako odeslanou" }).click();
  await eventually(() => {
    const o = row(J);
    const q = sql(`select state || '|' || sent_by || '|' || sent_via from quotes where job_id = ${lit(J.id)}`);
    expect(o.status === "nabidka" && o.inquiry_status === "zpracovana" && q === `odeslana|${ID.obchod}|rucne`, `DB: Nabídka, poptávka Zpracovaná, nabídka Odeslaná jinak (${o.status}, ${o.inquiry_status}, ${q})`);
  });
  expectEvent(lastEvent(J, "type = 'stage'"), { actor: "obchod", startsWith: "Stav: Nacenění → Nabídka odeslaná", via: "automaticky" });
  expectEvent(lastEvent(J, "type = 'quote'"), { actor: "obchod", includes: `odeslána zákazníkovi (jinak než e-mailem) — předáno osobně ${TAG}` });
  // jen jedna událost o odeslání (3.4 bez duplicit)
  expect(sql(`select count(*) from job_events where job_id = ${lit(J.id)} and type in ('quote', 'email') and message ilike '%odeslán%'`) === "1", "právě jedna událost odeslání");
  await page.reload();
  await waitHydrated(page, 'main section[aria-label="Zakázka"] button[aria-label^="Stav zakázky:"]');
  await eventually(async () => expect(await stamp(header(page), /Petr Obchodník.* — podrobnosti$/).first().isVisible(), "hlavička: kdo stav změnil"));
  await shot(page, S("03-quote-sent"));
});

await T("role: zaměstnanec u nabídky jen navrhne zamítnutí (bez ✓/✕); obchodník návrh ✕ zahodí — vše s autorem", async (context) => {
  const page = await context.newPage();
  await login(page, USERS.dilna);
  await openJob(page, J);
  const items = await menuItems(page);
  expect(items.some((t) => t.startsWith("Navrhnout zamítnutí")) && !items.some((t) => t.startsWith("Zamítnout nabídku")), `zaměstnanec: jen „Navrhnout zamítnutí…" (${items.join(" | ")})`);
  await stateMenu(page, "Navrhnout zamítnutí…");
  const dlg = page.getByRole("dialog");
  await dlg.getByRole("radio", { name: "Cena", exact: true }).click();
  await dlg.getByRole("textbox").fill("Zákazník psal, že je to drahé");
  await dlg.getByRole("button", { name: "Odeslat návrh" }).click();
  await eventually(() => {
    const o = row(J);
    expect(o.flow_proposal?.to === "zamitnuta" && o.flow_proposal?.reason === "cena" && o.flow_proposal_by === ID.dilna, `DB: návrh od zaměstnankyně (${JSON.stringify(o.flow_proposal)})`);
  });
  expect(sql(`select state from quotes where job_id = ${lit(J.id)}`) === "odeslana", "nabídka se návrhem nezměnila");
  expectEvent(lastEvent(J, "type = 'status' and entity = 'proposal'"), { actor: "dilna", includes: "Návrh" });
  await page.reload();
  await waitHydrated(page, 'main section[aria-label="Zakázka"] button[aria-label^="Stav zakázky:"]');
  const chip = header(page).getByText(/^Návrh: /).first();
  await chip.waitFor({ timeout: 10_000 });
  expect(await header(page).getByRole("button", { name: /^Přijmout návrh/ }).count() === 0, "zaměstnanec nemá ✓ (nerozhoduje)");
  await shot(page, S("04-proposal-dilna"));
});

await T("role: obchodník vidí návrh se jménem navrhovatele a ✕ ho zahodí; Zákazník objednal → Objednávka Doručená · autor", async (context) => {
  const page = await context.newPage();
  await login(page, USERS.obchod);
  await openJob(page, J);
  const hdr = norm(await header(page).innerText());
  expect(hdr.includes("Návrh:") && hdr.includes(NAME.dilna), `hlavička: návrh se jménem navrhovatele (${hdr.slice(0, 300)})`);
  await header(page).getByRole("button", { name: /^Zamítnout návrh/ }).first().click();
  await eventually(() => expect(row(J).flow_proposal === null, "DB: návrh zahozen"));
  expectEvent(lastEvent(J, "type = 'status' and entity = 'proposal'"), { actor: "obchod", includes: "Návrh" });
  await page.reload();
  await waitHydrated(page, 'main section[aria-label="Zakázka"] button[aria-label^="Stav zakázky:"]');
  await nextBtn(page, "Zákazník objednal").click();
  await eventually(() => {
    const o = row(J);
    const q = sql(`select state || '|' || coalesce(accepted_by::text, '-') from quotes where job_id = ${lit(J.id)}`);
    expect(o.status === "objednavka" && o.order_status === "dorucena" && o.order_revision === 1 && o.order_status_changed_by === ID.obchod && q === `prijata|${ID.obchod}`,
      `DB: Objednávka Doručená rev 1, nabídka Přijatá, autor obchodník (${o.status}, ${o.order_status}, ${q})`);
  });
  expectEvent(lastEvent(J, "type = 'stage'"), { actor: "obchod", startsWith: "Stav: Nabídka odeslaná → Objednávka", via: "automaticky" });
  await eventually(async () => expect(await nextBtn(page, "Potvrdit objednávku").isVisible(), "další krok: Potvrdit objednávku"));
});

// ═════════════════════════ 4. OBJEDNÁVKA ═════════════════════════
await T("objednávka: Potvrdit → Zákazník změnil (Aktualizovaná rev 2) → Potvrdit změnu; DB revize + autor", async (context) => {
  const page = await context.newPage();
  await login(page, USERS.obchod);
  await openJob(page, J);
  await nextBtn(page, "Potvrdit objednávku").click();
  let dlg = page.getByRole("dialog");
  await dlg.waitFor({ timeout: 10_000 });
  const mailSw = dlg.getByRole("switch", { name: "Poslat potvrzení zákazníkovi e-mailem" });
  if ((await mailSw.getAttribute("aria-checked")) === "true") await mailSw.click();
  await dlg.getByRole("button", { name: "Potvrdit objednávku" }).click();
  await eventually(() => {
    const o = row(J);
    expect(o.status === "potvrzeno" && o.order_status === "potvrzena" && o.confirmed_by === ID.obchod && o.confirmation_issued_by === ID.obchod,
      `DB: Potvrzená, potvrdil a vystavil obchodník (${o.status}, ${o.order_status}, ${o.confirmed_by})`);
  }, { timeout: 25_000 });
  expectEvent(lastEvent(J, "type = 'status' and data->>'field' = 'order_status'"), { actor: "obchod", startsWith: "Objednávka: Doručená → Potvrzená" });
  await page.reload();
  await waitHydrated(page, 'main section[aria-label="Zakázka"] button[aria-label^="Stav zakázky:"]');
  // zákazník poslal změnu už potvrzené objednávky
  await stateMenu(page, "Zákazník změnil objednávku…");
  dlg = page.getByRole("dialog");
  await dlg.getByRole("heading", { name: "Zákazník změnil objednávku" }).waitFor({ timeout: 10_000 });
  await dlg.getByRole("textbox").fill(`Čep B 3 → 4 ks ${TAG}`);
  await dlg.getByRole("button", { name: "Zapsat změnu" }).click();
  await eventually(() => {
    const o = row(J);
    expect(o.order_status === "aktualizovana" && o.order_revision === 2 && o.status === "potvrzeno", `DB: Aktualizovaná rev 2, hlavní stav beze změny (${o.order_status}, ${o.order_revision}, ${o.status})`);
  });
  const rev = sql(`select decision || '|' || coalesce(created_by::text, '-') from job_order_revisions where job_id = ${lit(J.id)} and revision = 2`);
  expect(rev === `ceka|${ID.obchod}`, `revize 2 čeká na rozhodnutí, zapsal obchodník (${rev})`);
  expectEvent(lastEvent(J, "type = 'status' and data->>'field' = 'order_status'"), { actor: "obchod", startsWith: "Objednávka: Potvrzená → Aktualizovaná (rev 2)" });
  await page.reload();
  await waitHydrated(page, 'main section[aria-label="Zakázka"] button[aria-label^="Stav zakázky:"]');
  expect(norm(await header(page).innerText()).includes("Aktualizovaná"), "hlavička: chip Aktualizovaná");
  await nextBtn(page, "Potvrdit změnu").click();
  dlg = page.getByRole("dialog");
  await dlg.getByRole("heading", { name: "Potvrdit změnu objednávky (rev 2)" }).waitFor({ timeout: 10_000 });
  expect(norm(await dlg.innerText()).includes(`Čep B 3 → 4 ks ${TAG}`), "dialog ukazuje, co se mění");
  await dlg.getByRole("button", { name: "Potvrdit změnu" }).click();
  await eventually(() => {
    const o = row(J);
    expect(o.order_status === "potvrzena" && o.order_confirmed_revision === 2, `DB: Potvrzená rev 2 (${o.order_status}, ${o.order_confirmed_revision})`);
  });
  // navazuje nabídka odeslat potvrzení k rev 2 — teď ne
  await page.keyboard.press("Escape");
  const dec = sql(`select decision || '|' || coalesce(decided_by::text, '-') from job_order_revisions where job_id = ${lit(J.id)} and revision = 2`);
  expect(dec === `prijata|${ID.obchod}`, `revize 2 přijata, rozhodl obchodník (${dec})`);
  expectEvent(lastEvent(J, "type = 'status' and data->>'field' = 'order_status'"), { actor: "obchod", startsWith: "Objednávka: Aktualizovaná → Potvrzená (rev 2) — změna přijata" });
  expect(flowRow(J).confirmation_key === "bez_dokladu", "potvrzení rev 2 zatím neodešlo (bez dokladu)");
});

await T("korekce stavu na Ve výrobě = předání do výroby (kdo + termín) + poznámka; událost s poznámkou a autorem (ruční)", async (context) => {
  const page = await context.newPage();
  await login(page, USERS.obchod);
  await openJob(page, J);
  const before = row(J).stage_changed_at;
  await header(page).getByRole("button", { name: /^Stav zakázky: / }).click();
  await page.getByRole("menuitem", { name: /^Ve výrobě/ }).click();
  // přesun do výroby se ptá, komu to zadávám a do kdy (WP3) — „U nás", ať další kroky testu nemají objednávku navíc
  const dlg = page.locator('[data-testid="handoff-dialog"]');
  await dlg.locator('[data-testid="handoff-submit"]').waitFor({ timeout: 20_000 });
  expect(norm(await dlg.innerText()).includes("komu to zadáváš a do kdy"), "dialog předání do výroby");
  await dlg.getByRole("button", { name: "U nás" }).first().click();
  await dlg.locator('input[type="date"]').first().fill(sql(`select (current_date + 7)::text`));
  await dlg.getByLabel("Poznámka k předání (nepovinné)").fill(`Výroba začala ${TAG}`);
  await dlg.locator('[data-testid="handoff-submit"]').click();
  await eventually(() => {
    const o = row(J);
    expect(o.status === "ve_vyrobe" && o.stage_changed_by === ID.obchod && o.stage_changed_via === "rucne" && o.stage_changed_at !== before, `DB: Ve výrobě, ručně, obchodník (${o.status}, ${o.stage_changed_via})`);
  }, { timeout: 25_000 });
  const ev = lastEvent(J, "type = 'stage'");
  expectEvent(ev, { actor: "obchod", startsWith: "Stav: Potvrzená objednávka → Ve výrobě", via: "rucne" });
  expect(ev.message.includes(`Výroba začala ${TAG}`), `poznámka předání ve změně stavu (${ev.message})`);
  // kdo + termín: souhrn předání („Předáno do výroby: 1) Výroba · U nás · do …") se stejným autorem
  expectEvent(lastEvent(J, "message like 'Předáno do výroby:%'"), { actor: "obchod", includes: "U nás" });
});

// ═════════════════════════ 5. DODÁNÍ ═════════════════════════
await T("dodání: 1/2 položek → Částečně dodáno (stav se neposune) → zbytek → Dodáno zákazníkovi automaticky · autor", async (context) => {
  const page = await context.newPage();
  await login(page, USERS.obchod);
  await openJob(page, J, "?tab=vyroba");
  const card = page.getByRole("region", { name: "Dodání zákazníkovi" });
  await card.getByRole("button", { name: "Zapsat dodání" }).click();
  let dlg = page.getByRole("dialog");
  // výroba ještě běží (krok U nás) → nejdřív „Ukončit výrobu"; tady dodání postaru (částečné dodání během výroby)
  await skipFinish(dlg);
  await dlg.getByRole("button", { name: `Vše — Deska A ${TAG}` }).click();
  await dlg.getByLabel(`Dodávám teď — Čep B ${TAG}`).fill(""); // předvyplněný zbytek → dílčí dodávka jen Desky A
  await dlg.getByRole("button", { name: "Zapsat dodání" }).click();
  await eventually(() => {
    const o = row(J);
    expect(Number(o.items_delivered) === 1 && o.status === "ve_vyrobe", `DB: 1/2 dodáno, stav Ve výrobě (${o.items_delivered}, ${o.status})`);
  });
  const by = sql(`select string_agg(coalesce(delivered_changed_by::text, '-'), ',' order by position) from order_items where order_id = ${lit(J.id)}`);
  expect(by === `${ID.obchod},-`, `kdo zapsal dodání po položkách (${by})`);
  expect(flowRow(J).delivery_key === "castecne", "job_flow_v: částečně dodáno");
  expectEvent(lastEvent(J, "type = 'field'"), { actor: "obchod", includes: "Dodáno" });
  // Kniha: řádek ukazuje částečné dodání
  await page.goto(`${BASE}/orders?q=${encodeURIComponent(J.number)}`);
  const bookRow = page.locator("main ul[role=list] > li").filter({ has: page.locator(`a[href="/orders/${J.id}"]`) });
  await bookRow.waitFor({ timeout: 15_000 });
  const bt = norm(await bookRow.innerText());
  expect(bt.includes("Částečně dodáno") && bt.includes("1/2 položek"), `Kniha: Částečně dodáno 1/2 položek (${bt.slice(0, 200)})`);
  // zbytek
  await openJob(page, J, "?tab=vyroba");
  // A2 (sk. 2): hlavička ukazuje „Dodat zbytek" → karta Dodání stejné tlačítko podruhé nenabízí (jen odkáže nahoru)
  await nextBtn(page, "Dodat zbytek").click();
  dlg = page.getByRole("dialog");
  await skipFinish(dlg);
  await dlg.getByRole("button", { name: `Vše — Čep B ${TAG}` }).click();
  await dlg.getByRole("button", { name: "Zapsat dodání" }).click();
  await eventually(() => {
    const o = row(J);
    expect(Number(o.items_delivered) === 2 && o.status === "dodano_zakaznikovi", `DB: vše dodáno → Dodáno zákazníkovi (${o.items_delivered}, ${o.status})`);
  });
  expectEvent(lastEvent(J, "type = 'stage'"), { actor: "obchod", startsWith: "Stav: Ve výrobě → Dodáno zákazníkovi", via: "automaticky" });
  await shot(page, S("05-delivered"));
});

// ═════════════════════════ 6. FAKTURA A ÚHRADY ═════════════════════════
await T("faktura → Vyfakturováno · autor; úhrada částečná (bez posunu, bez částky v historii) → vyrovnání → Dokončeno automaticky", async (context) => {
  const page = await context.newPage();
  await login(page, USERS.obchod);
  await openJob(page, J);
  // A2 (sk. 1): faktura = hlavní tlačítko „Vystavit fakturu" hned po dodání (potvrzený DL není podmínka)
  // → PDF + dialog odeslání jako u nabídky; tady „Vystavit, neposílat" (odeslání testuje E2E 23)
  await nextBtn(page, "Vystavit fakturu").click();
  const inv = page.getByRole("dialog");
  const force = inv.getByRole("button", { name: "Přesto vystavit" });
  const save = inv.getByRole("button", { name: "Vystavit, neposílat" });
  await Promise.race([force.waitFor({ timeout: 30_000 }), save.waitFor({ timeout: 30_000 })]).catch(() => {});
  if (await force.isVisible().catch(() => false)) await force.click();
  await save.click({ timeout: 30_000 });
  await waitToast(page, /Faktura FV-\S+ je vystaven/, 30_000);
  await eventually(() => {
    const o = row(J);
    expect(o.status === "fakturovano" && o.invoiced_by === ID.obchod, `DB: Vyfakturováno, fakturoval obchodník (${o.status}, ${o.invoiced_by})`);
  });
  expectEvent(lastEvent(J, "type = 'stage'"), { actor: "obchod", startsWith: "Stav: Dodáno zákazníkovi → Vyfakturováno" });
  await page.reload();
  await waitHydrated(page, 'main section[aria-label="Zakázka"] button[aria-label^="Stav zakázky:"]');
  // dílčí úhrada
  await nextBtn(page, "Zadat platbu").click();
  let dlg = page.getByRole("dialog");
  await dlg.getByLabel("Částka bez DPH").fill("1000");
  await dlg.getByRole("button", { name: "Zapsat úhradu" }).click();
  await eventually(() => {
    const o = row(J);
    expect(Number(o.paid_so_far) === 1000 && o.paid_at === null && o.status === "fakturovano", `DB: zaplaceno 1000, nevyrovnáno, stav Vyfakturováno (${o.paid_so_far}, ${o.paid_at}, ${o.status})`);
  });
  const pay = sql(`select amount || '|' || settles || '|' || recorded_by || '|' || recorded_name from job_payments where job_id = ${lit(J.id)}`);
  expect(pay === `1000.00|false|${ID.obchod}|${NAME.obchod}`, `job_payments: částka, nevyrovnává, kdo zapsal (${pay})`);
  expect(flowRow(J).payment_key === "castecne_zaplaceno", "job_flow_v: částečně zaplaceno");
  const payEv = lastEvent(J, "type = 'field' and message ilike '%úhrad%'");
  expectEvent(payEv, { actor: "obchod", includes: "úhrad" });
  expect(!/1\s?000/.test(payEv.message), `v historii není částka (${payEv.message})`);
  // vyrovnání
  await page.reload();
  await waitHydrated(page, 'main section[aria-label="Zakázka"] button[aria-label^="Stav zakázky:"]');
  await nextBtn(page, "Zadat platbu").click();
  dlg = page.getByRole("dialog");
  await dlg.getByRole("switch").click();
  await dlg.getByRole("button", { name: "Zaplaceno" }).click();
  await eventually(() => {
    const o = row(J);
    expect(o.paid_at && o.status === "dokonceno", `DB: vyrovnáno → Dokončeno (${o.paid_at}, ${o.status})`);
  });
  expectEvent(lastEvent(J, "type = 'stage'"), { actor: "obchod", startsWith: "Stav: Vyfakturováno → Dokončeno", via: "automaticky" });
  expect(flowRow(J).payment_key === "zaplaceno", "job_flow_v: zaplaceno");
  await openTab(page, "Historie");
  await eventually(async () => {
    const t = await historyText(page);
    expect(t.includes("Dokončeno") && t.includes(NAME.obchod), "Historie: Dokončeno se jménem");
  });
  await shot(page, S("06-paid"));
});

// ═════════════════════════ 7. OBJEDNÁVKA DODAVATELI ═════════════════════════
const PO = (() => {
  const number = `OV-E2E10-${TAG}`;
  const id = sql(`insert into purchase_orders (job_id, number, status, total, required_date, created_by, supplier_id)
    values (${lit(J.id)}, ${lit(number)}, 'odeslana', 1000, current_date + 14, ${lit(ID.obchod)}, 'd4000000-0000-0000-0000-000000000001') returning id`).split("\n")[0];
  [["E10-PO-A", 5], ["E10-PO-B", 2]].forEach(([dwg, qty], i) => {
    sql(`insert into purchase_order_items (purchase_order_id, position, drawing_number, name, quantity, unit, unit_price)
      values (${lit(id)}, ${i}, ${lit(dwg)}, 'Díl', ${qty}, 'ks', 10)`);
  });
  return { id, number };
})();

await T("objednávka dodavateli: Dodavatel potvrdil → Převzít 1/2 → zbytek → Dodána k nám; razítka se jménem, DB *_by", async (context) => {
  const page = await context.newPage();
  await login(page, USERS.obchod);
  const open = async () => {
    await page.goto(`${BASE}/purchasing?stav=vse&q=${encodeURIComponent(PO.number)}`);
    await waitHydrated(page, "main input[aria-label='Hledat objednávky']");
  };
  const r = () => page.locator("main li").filter({ has: page.locator("span.font-mono", { hasText: new RegExp(`^${esc(PO.number)}$`) }) }).first();
  await open();
  await r().waitFor({ timeout: 15_000 });
  await r().getByRole("button", { name: "Dodavatel potvrdil" }).click();
  let dlg = page.getByRole("dialog");
  await dlg.getByRole("button", { name: "Uložit potvrzení" }).click();
  await eventually(() => expect(sql(`select status || '|' || confirmed_by from purchase_orders where id = ${lit(PO.id)}`) === `potvrzena|${ID.obchod}`, "DB: potvrzena, kdo"));
  await eventually(async () => expect(norm(await r().innerText()).includes(`Potvrzena dodavatelem · ${SHORT.obchod}`), "razítko Potvrzena dodavatelem · P. Obchodník"));
  await r().getByRole("button", { name: "Převzít zboží" }).click();
  dlg = page.getByRole("dialog");
  await dlg.getByLabel("Převzaté množství — E10-PO-B").fill("0");
  await dlg.getByRole("button", { name: "Uložit převzetí" }).click();
  await eventually(() => {
    const it = sql(`select string_agg(received_quantity::text || ':' || coalesce(received_changed_by::text, '-'), ',' order by position) from purchase_order_items where purchase_order_id = ${lit(PO.id)}`);
    expect(it.startsWith(`5.000:${ID.obchod}`), `DB: převzato po položkách s autorem (${it})`);
  });
  await eventually(async () => {
    const t = norm(await r().innerText());
    expect(t.includes("Částečně dodaná") && t.includes(`Převzato 1/2 položek · ${SHORT.obchod}`), `řádek: částečně dodaná + kdo převzal (${t.slice(0, 260)})`);
  });
  await r().getByRole("button", { name: "Převzít zbytek" }).click();
  dlg = page.getByRole("dialog");
  await dlg.getByRole("button", { name: "Uložit převzetí" }).click();
  await eventually(() => expect(sql(`select status || '|' || delivered_by from purchase_orders where id = ${lit(PO.id)}`) === `dodana|${ID.obchod}`, "DB: dodána, kdo"));
  await open();
  await eventually(async () => expect(norm(await r().innerText()).includes(`Dodána k nám · ${SHORT.obchod}`), "razítko Dodána k nám · P. Obchodník"));
  expect(row(J).status === "dokonceno", "dokončená zakázka se dodávkou od dodavatele nevrátila (jen dopředu)");
  await shot(page, S("07-purchasing"));
});

// ═════════════════════════ 8. ROLE U POPTÁVKY ═════════════════════════
await T("role: zaměstnanec u poptávky jen navrhne odmítnutí; obchodník ✓ rozhodne → Odmítnutá — Kapacita, „na návrh: Jana“, Nerealizováno", async (context) => {
  const page = await context.newPage();
  await login(page, USERS.dilna);
  await openJob(page, R);
  const items = await menuItems(page);
  expect(items.some((t) => t.startsWith("Navrhnout odmítnutí")) && !items.some((t) => t.startsWith("Odmítnout poptávku")), `zaměstnanec: jen návrh (${items.join(" | ")})`);
  await stateMenu(page, "Navrhnout odmítnutí…");
  const dlg = page.getByRole("dialog");
  await dlg.getByRole("radio", { name: /^Nestíháme/ }).click();
  await dlg.getByRole("button", { name: "Odeslat návrh" }).click();
  await eventually(() => {
    const o = row(R);
    expect(o.flow_proposal?.to === "odmitnuta" && o.flow_proposal?.reason === "kapacita" && o.flow_proposal_by === ID.dilna && o.inquiry_status === "prijata",
      `DB: návrh odmítnutí od zaměstnankyně, poptávka beze změny (${JSON.stringify(o.flow_proposal)}, ${o.inquiry_status})`);
  });
  // obchodník rozhodne na stránce Poptávky
  const obchod = await context.browser().newContext({ viewport: { width: 1440, height: 900 }, locale: "cs-CZ" });
  try {
    const p2 = await obchod.newPage();
    await login(p2, USERS.obchod);
    await p2.goto(`${BASE}/inquiries`);
    const li = p2.locator("main li").filter({ has: p2.locator(`a[href="/orders/${R.id}"]`) }).first();
    await li.waitFor({ timeout: 15_000 });
    await waitHydrated(p2, "main li button");
    const lt = norm(await li.innerText());
    expect(lt.includes("Návrh:") && (lt.includes(NAME.dilna) || lt.includes(SHORT.dilna)), `řádek poptávky: návrh se jménem navrhovatele (${lt.slice(0, 260)})`);
    await li.getByRole("button", { name: /^Přijmout návrh/ }).click();
    await eventually(() => {
      const o = row(R);
      expect(o.inquiry_status === "odmitnuta" && o.lost_reason === "kapacita" && o.status === "nerealizovano" && o.inquiry_status_changed_by === ID.obchod && o.flow_proposal === null,
        `DB: Odmítnutá — kapacita, Nerealizováno, rozhodl obchodník (${o.inquiry_status}, ${o.status}, ${o.inquiry_status_changed_by})`);
    });
    const ev = lastEvent(R, "type = 'status' and data->>'field' = 'inquiry_status'");
    expectEvent(ev, { actor: "obchod", startsWith: "Poptávka: Přijatá → Odmítnutá — Nestíháme" });
    expect(sql(`select count(*) from job_events where job_id = ${lit(R.id)} and message like ${lit(`%na návrh: ${NAME.dilna}%`)}`) !== "0", "historie: „na návrh: Jana Zaměstnanec“");
    await shot(p2, S("08-inquiry-proposal-accepted"));
  } finally {
    await obchod.close();
  }
});

// ═════════════════════════ 9. FILTRY A POČTY ═════════════════════════
await T("filtry a počty: chipy /inquiries, /quotes, /confirmations a Knihy = flow_counts; filtr Změnil = Petr Obchodník", async (context) => {
  const page = await context.newPage();
  await login(page, USERS.admin);
  await page.goto(`${BASE}/inquiries`);
  await waitHydrated(page, 'main [role=group][aria-label="Stav poptávky"] button');
  for (const [label, key] of [["Přijatá", "prijata"], ["V řešení", "v_reseni"]]) {
    expect(await chipCount(page, "Stav poptávky", label) === flowCount("inquiry", key), `/inquiries: ${label} = flow_counts`);
  }
  await page.goto(`${BASE}/quotes`);
  await waitHydrated(page, 'main [role=group][aria-label="Stav nabídky"] button');
  for (const [label, key] of [["Rozpracovaná", "rozpracovana"], ["Odeslaná", "odeslana"]]) {
    expect(await chipCount(page, "Stav nabídky", label) === flowCount("quote", key), `/quotes: ${label} = flow_counts`);
  }
  await page.goto(`${BASE}/confirmations`);
  await waitHydrated(page, 'main [role=group][aria-label="Stav objednávky"] button');
  expect(await chipCount(page, "Stav objednávky", "Doručená") === flowCount("order", "dorucena"), "/confirmations: Doručená = flow_counts");
  await page.goto(`${BASE}/orders?segment=objednavky`);
  await waitHydrated(page, 'main [role=group][aria-label="Stav objednávky"] button');
  expect(await chipCount(page, "Stav objednávky", "Doručená") === flowCount("order", "dorucena"), "Kniha Objednávky: Doručená = flow_counts");
  await page.goto(`${BASE}/orders?segment=poptavky`);
  await waitHydrated(page, 'main [role=group][aria-label="Stav poptávky"] button');
  expect(await chipCount(page, "Stav poptávky", "Přijatá") === flowCount("inquiry", "prijata"), "Kniha Poptávky: Přijatá = flow_counts");
  // filtr „Změnil" v Knize (Dokončené): J posunul Petr
  await page.goto(`${BASE}/orders?segment=dokoncene&zmenil=${ID.obchod}&q=${encodeURIComponent(J.number)}`);
  const li = page.locator("main ul[role=list] > li").filter({ has: page.locator(`a[href="/orders/${J.id}"]`) });
  await li.waitFor({ timeout: 15_000 });
  await page.goto(`${BASE}/orders?segment=dokoncene&zmenil=${ID.dilna}&q=${encodeURIComponent(J.number)}`);
  await page.waitForLoadState("networkidle");
  await page.locator('main [aria-busy="false"]').first().waitFor({ timeout: 15_000 }).catch(() => {});
  expect(await page.locator(`main a[href="/orders/${J.id}"]`).count() === 0, "filtr Změnil = Jana: zakázka J není (posouval ji Petr)");
  await shot(page, S("09-filters"));
});

// ═════════════════════════ 10. PODVRH ATRIBUCE ═════════════════════════
await T("REST: anon klíč s podvrženou x-actor-id nic nezapíše; přihlášený s podvrženou hlavičkou/actor_id = zapíše se on sám", async () => {
  const fakeHeaders = { "x-actor-id": ID.admin, "x-actor-kind": "user", "x-actor-via": "rucne" };
  // anonym: úprava zakázky i zápis události odmítnuty / bez účinku
  const noteBefore = row(J).note;
  const a1 = await rest("PATCH", `orders?id=eq.${J.id}`, { body: { note: `podvrh ${TAG}` }, headers: fakeHeaders });
  expect(a1.status >= 400 || (Array.isArray(a1.body) && a1.body.length === 0), `anon PATCH orders bez účinku (${a1.status})`);
  expect(row(J).note === noteBefore, "poznámka zakázky se nezměnila");
  const a2 = await rest("POST", "job_events", { body: { job_id: J.id, type: "comment", message: `podvrh anon ${TAG}`, actor_id: ID.admin }, headers: fakeHeaders });
  expect(a2.status >= 400, `anon INSERT job_events odmítnut (${a2.status})`);
  expect(sql(`select count(*) from job_events where message = ${lit(`podvrh anon ${TAG}`)}`) === "0", "žádná podvržená událost");
  // přihlášený obchodník s podvrženou hlavičkou i actor_id → autorem je on
  const token = await restLogin(USERS.obchod);
  const s1 = await rest("POST", "job_events", {
    token, headers: fakeHeaders,
    body: { job_id: J.id, type: "comment", message: `podvrh session ${TAG}`, actor_id: ID.admin, actor_kind: "ai", data: { auto: true, origin: "db" } },
  });
  if (s1.status < 300) {
    const ev = JSON.parse(sql(`select json_build_object('actor', actor_id, 'kind', actor_kind, 'via', via, 'name', actor_name, 'data', data)::text from job_events where message = ${lit(`podvrh session ${TAG}`)}`));
    expect(ev.actor === ID.obchod && ev.kind === "user" && ev.via === "rest" && ev.name === NAME.obchod, `podvržený autor přepsán na přihlášeného (${JSON.stringify(ev)})`);
    expect(!("auto" in (ev.data ?? {})) && !("origin" in (ev.data ?? {})), `rezervované klíče z data odstraněny (${JSON.stringify(ev.data)})`);
  } else {
    expect(s1.status === 401 || s1.status === 403, `zápis události přes REST odmítnut (${s1.status})`);
  }
  // atribuční sloupec přes REST nejde přepsat (app_keep)
  const s2 = await rest("PATCH", `orders?id=eq.${J.id}`, { token, headers: fakeHeaders, body: { stage_changed_by: ID.admin, inquiry_status_changed_by: ID.dilna } });
  const o = row(J);
  expect(o.stage_changed_by === ID.obchod && o.inquiry_status_changed_by === ID.obchod, `atribuce zůstala (${s2.status}: ${o.stage_changed_by}, ${o.inquiry_status_changed_by})`);
});

// ═════════════════════════ 11. MOBIL ═════════════════════════
await T("mobil 390 px: hlavička, průběh a historie ukazují jméno účtu; Kniha a Poptávky bez vodorovného posunu", async (context) => {
  const page = await context.newPage();
  await login(page, USERS.obchod);
  await openJob(page, J);
  await expectNoOverflow(page, "karta 390 px");
  const st = stamp(header(page), /Petr Obchodník.* — podrobnosti$/).first();
  expect(await st.isVisible(), "razítko autora stavu je vidět i na mobilu");
  expect(norm(await st.innerText()).includes(SHORT.obchod) || norm(await st.innerText()).includes(NAME.obchod), "razítko je čitelný text se jménem");
  await st.click();
  await eventually(async () => expect(await page.getByRole("menu").isVisible(), "ťuknutí otevře podrobnosti (kdo, kdy, způsob)"));
  expect(norm(await page.getByRole("menu").innerText()).includes(NAME.obchod), "podrobnosti: celé jméno");
  await page.keyboard.press("Escape");
  await openTab(page, "Historie");
  await eventually(async () => {
    const t = await historyText(page);
    expect(t.includes(NAME.obchod) && t.includes("Dokončeno"), "historie na mobilu se jménem");
  });
  await expectNoOverflow(page, "historie 390 px");
  await page.goto(`${BASE}/orders?segment=poptavky&q=${encodeURIComponent(TAG)}`);
  await page.locator("main").waitFor();
  await expectNoOverflow(page, "Kniha 390 px");
  await page.goto(`${BASE}/inquiries`);
  await page.locator("main h1").first().waitFor({ timeout: 15_000 });
  await expectNoOverflow(page, "Poptávky 390 px");
  await shot(page, S("11-mobile"));
}, { mobile: true });

// ═════════════════════════ 12. INVARIANTY ═════════════════════════
await T("invarianty: každá událost zakázek má autora se jménem; automatické posuny jen dopředu; *_by vyplněné", async () => {
  const ids = [J.id, R.id].map(lit).join(",");
  const anon = sql(`select count(*) from job_events where job_id in (${ids}) and created_at > ${lit(T0)}::timestamptz and (actor_id is null or coalesce(actor_name, '') = '')`);
  expect(anon === "0", `události bez autora/jména: ${anon}`);
  const autos = sql(`select string_agg((data->>'from') || '>' || (data->>'to') || '>' || actor_kind, ',') from job_events where job_id in (${ids}) and type = 'stage' and (data->>'auto')::boolean`).split(",").filter(Boolean);
  expect(autos.length >= 4, `automatické posuny proběhly (${autos.join(" ")})`);
  for (const a of autos) {
    const [from, to, kind] = a.split(">");
    // negativní konec jen jako důsledek rozhodnutí člověka (odmítnutí poptávky na kroku A), nikdy automatika sama
    if (to === "nerealizovano" || to === "zruseno") expect(kind === "user", `uzavření zakázky jen rozhodnutím člověka: ${a}`);
    else expect(RANK[to] > RANK[from], `automatický posun jen dopředu: ${a}`);
  }
  const o = row(J);
  // #25: nacenil super admin (Nacenění jen on), ostatní kroky obchodník
  expect(o.priced_by === ID.admin, `priced_by = super admin (${o.priced_by})`);
  for (const col of ["stage_changed_by", "inquiry_status_changed_by", "order_status_changed_by", "confirmed_by", "invoiced_by"]) {
    expect(o[col] === ID.obchod, `${col} = obchodník (${o[col]})`);
  }
});

const done = await cleanup();
console.log(`  (úklid: ${done.jobs} zakázek, ${done.customers} zákazníků)`);
await browser.close();
process.exit(summary(errors) ? 0 : 1);
