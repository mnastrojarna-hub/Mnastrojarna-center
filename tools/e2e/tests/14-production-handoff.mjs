// E2E 14 · Předání do výroby (WP3 — UI, bez hlídání v DB).
// Požadavek majitele: přesun do výroby se musí zeptat „komu to zadávám" a bez toho nepustí dál; víc kroků
// (Výroba 1 → Tepelné zpracování → …, Posunout dál, Ukončit výrobu); každý krok má termín a je jasné, jestli
// jde o mezitermín (s dodavatelem / částečným dodavatelem), nebo konečný termín zákazníka; kdo to dělá je
// povinné, předvyplní se nejlevnější firma z nabídek (jen potvrdím / vyplním ručně); při předání vznikne
// automatická objednávka dodavateli a vygeneruje se PDF.
// Scénáře 1–15 (spec I.4) + 16 „Přesunout bez dodavatele a termínu" (hlídání předání je zatím vypnuté —
// majitel 29. 10.), 17 Technologie → poznámky pro dodavatele v PDF a e-mailu objednávky, 18 nabídka telefonem,
// 24 „Výroba 2" nikdy nedostane kompletní dodávku (i zaměstnanec), 25 Vrátit předání do stavu před předáním,
// 26 mobil 390 px světlý + tmavý (karta kroku, Ukončit výrobu, Technologie po přesunu bez předání).
// Vlastní data „E2E-14-"; na konci se uklidí.
import { BASE, USERS, launch, withContext, login, shot, sql, test, expect, summary } from "../lib.mjs";
import { lit, userIds, eventually, waitHydrated, expectNoOverflow, isoDays, removeStorageFiles, mailsTo, waitMail } from "../lib-quotes-docs-flow.mjs";

const browser = await launch();
const errors = [];
const ONLY = process.env.ONLY ? new RegExp(process.env.ONLY) : null;
const T = (name, fn, opts) => (ONLY && !ONLY.test(name) ? Promise.resolve() : test(name, () => withContext(browser, errors, fn, opts)));
const S = (name) => `production-handoff/${name}`;
const norm = (s) => String(s ?? "").replace(/[  ]/g, " ").replace(/\s+/g, " ").trim();
const P = "E2E-14-";
const TAG = Date.now().toString(36).toUpperCase();
const ID = userIds();
const NAME = { obchod: "Petr Obchodník", dilna: "Jana Zaměstnanec", admin: "Super Admin" };

console.log(`14 · Předání do výroby (značka ${TAG})`);

// ── Úklid ────────────────────────────────────────────────────
async function cleanup() {
  const jobs = sql(`select id from orders where title like ${lit(`${P}%`)}`).split("\n").filter(Boolean);
  if (jobs.length) {
    const inList = jobs.map(lit).join(",");
    const paths = sql(`select storage_path from job_files where job_id in (${inList}) and storage_path is not null`).split("\n").filter(Boolean);
    await removeStorageFiles(paths);
    sql(`delete from approval_queue where order_id in (${inList})`);
    sql(`delete from emails where order_id in (${inList}) and direction = 'out'`);
    sql(`update emails set order_id = null where order_id in (${inList})`);
    sql(`update job_operations set purchase_order_id = null where job_id in (${inList})`);
    sql(`delete from purchase_order_items where purchase_order_id in (select id from purchase_orders where job_id in (${inList}))`);
    sql(`delete from purchase_orders where job_id in (${inList})`);
    sql(`delete from job_operations where job_id in (${inList})`);
    sql(`delete from production_handoffs where job_id in (${inList})`);
    sql(`delete from supplier_quote_items where supplier_quote_id in (select id from supplier_quotes where job_id in (${inList}))`);
    sql(`delete from supplier_quotes where job_id in (${inList})`);
    sql(`delete from orders where id in (${inList})`);
    sql(`delete from audit_log where entity_id::text in (${inList}) or diff->>'jobId' in (${inList})`);
  }
  const sups = sql(`select id from suppliers where name like ${lit(`${P}%`)}`).split("\n").filter(Boolean);
  if (sups.length) {
    const inList = sups.map(lit).join(",");
    sql(`delete from suppliers where id in (${inList}) and not exists (select 1 from purchase_orders p where p.supplier_id = suppliers.id)`);
  }
  sql(`delete from customers where name like ${lit(`${P}%`)} and not exists (select 1 from orders o where o.customer_id = customers.id)`);
  return jobs.length;
}
const left = await cleanup();
if (left) console.log(`  (úklid po minulém běhu: ${left} zakázek)`);
const MODE_BEFORE = sql(`select mode from automation_settings where module = 'purchase_order'`) || null;
const setMode = (m) => sql(`insert into automation_settings (module, mode, enabled) values ('purchase_order', ${lit(m)}, true)
  on conflict (module) do update set mode = excluded.mode, enabled = true`);
setMode("approval");

// ── Data ─────────────────────────────────────────────────────
const tl = TAG.toLowerCase();
const CUST = sql(`insert into customers (name, country, owner_id, email) values (${lit(`${P}Strojírny Hradec ${TAG}`)}, 'CZ', ${lit(ID.obchod)}, ${lit(`e2e14-${tl}-cust@local.test`)}) returning id`).split("\n")[0];
function supplier(name, tech, email) {
  return sql(`insert into suppliers (name, email, technologies) values (${lit(`${P}${name} ${TAG} s.r.o.`)}, ${lit(email)}, ${lit(`{${tech}}`)}::text[]) returning id`).split("\n")[0];
}
const HRUBY = supplier("Kovoobrábění Hrubý", "soustruzeni", `e2e14-${tl}-hruby@local.test`);
const NOVAK = supplier("Frézy Novák", "frezovani_3osy", `e2e14-${tl}-novak@local.test`);
const LEVNA = supplier("Levná Fréza", "frezovani_3osy", `e2e14-${tl}-levna@local.test`);
const TEPKAL = supplier("TepKal", "tepelne_zpracovani", `e2e14-${tl}-tepkal@local.test`);
const SUP_NAME = Object.fromEntries([[HRUBY, "Kovoobrábění Hrubý"], [NOVAK, "Frézy Novák"], [LEVNA, "Levná Fréza"], [TEPKAL, "TepKal"]].map(([k, v]) => [k, `${P}${v} ${TAG} s.r.o.`]));
const MAIL = { novak: `e2e14-${tl}-novak@local.test`, tepkal: `e2e14-${tl}-tepkal@local.test`, hruby: `e2e14-${tl}-hruby@local.test` };

let seq = 0;
/**
 * Zakázka s vlastním číslem (nespotřebuje čítač) a díly; heat = kalení na prvním dílu. Výchozí konečný termín
 * za 40 dní: Novák (3 týdny) + doprava + kalení (5 dní) se vejde v každý den v týdnu (za 30 dní padal o víkendu o den).
 */
function job(title, { status = "potvrzeno", due = 40, owner = ID.obchod, items = [["PR-20", "Příruba", 2, "kalit 58–60 HRC"], ["PR-21", "Pouzdro", 1, null]] } = {}) {
  seq += 1;
  const number = `Z-E2E14-${TAG}-${seq}`;
  const id = sql(`insert into orders (number, title, status, source, owner_id, created_by, customer_id, order_date, due_date, value, currency)
    values (${lit(number)}, ${lit(`${P}${title} ${TAG}`)}, ${lit(status)}::job_stage, 'manual', ${lit(owner)}, ${lit(owner)}, ${lit(CUST)}, current_date - 3,
      ${due === null ? "null" : `current_date + ${due}`}, 60000, 'CZK') returning id`).split("\n")[0];
  const itemIds = items.map(([dn, name, qty, heat], i) => sql(`insert into order_items (order_id, position, drawing_number, name, material, material_designation, quantity, unit, heat_treatment)
    values (${lit(id)}, ${i}, ${lit(`${dn}-${TAG}`)}, ${lit(name)}, '1.2379', '1.2379', ${qty}, 'ks', ${lit(heat)}) returning id`).split("\n")[0]);
  return { id, number, items: itemIds, dn: items.map(([dn]) => `${dn}-${TAG}`) };
}
/** Nabídka dodavatele s položkami (ceny za kus). */
function quote(j, sup, prices, { lead = 14, kinds = null, selected = false, valid = 30, note = null } = {}) {
  const total = prices.reduce((s, p, i) => (p === null ? s : s + p * [2, 1][i]), 0);
  const id = sql(`insert into supplier_quotes (job_id, supplier_id, number, currency, lead_time_days, source, total, selected, valid_until, note, operation_kinds, quote_date)
    values (${lit(j.id)}, ${lit(sup)}, ${lit(`NAB-${TAG}-${Math.random().toString(36).slice(2, 7)}`)}, 'CZK', ${lead}, 'manual', ${total || "null"}, ${selected},
      current_date + ${valid}, ${lit(note)}, ${kinds ? `${lit(`{${kinds}}`)}::text[]` : "null"}, current_date - 1) returning id`).split("\n")[0];
  prices.forEach((p, i) => {
    if (p === undefined) return;
    sql(`insert into supplier_quote_items (supplier_quote_id, position, drawing_number, name, quantity, unit, unit_price)
      values (${lit(id)}, ${i}, ${lit(j.dn[i])}, 'díl', ${[2, 1][i]}, 'ks', ${p === null ? "null" : p})`);
  });
  return id;
}

// A: hlavní zakázka (Hrubý komplet 15 000 vybraný v Nákupu, Novák obrábění 12 200, prošlá levnější, TepKal kalení 2 100)
const A = job("hlavní");
quote(A, HRUBY, [5000, 5000], { kinds: "kompletni_dodavka", selected: true, lead: 25 });
quote(A, NOVAK, [4000, 4200], { lead: 21, note: "frézování" });
quote(A, LEVNA, [3000, 3000], { lead: 10, valid: -10, note: "frézování" });
const qTep = sql(`insert into supplier_quotes (job_id, supplier_id, number, currency, lead_time_days, source, total, valid_until, operation_kinds, note)
  values (${lit(A.id)}, ${lit(TEPKAL)}, ${lit(`NAB-${TAG}-tep`)}, 'CZK', 5, 'manual', 2100, current_date + 30, '{tepelne_zpracovani}'::text[], 'kalení') returning id`).split("\n")[0];
sql(`insert into supplier_quote_items (supplier_quote_id, position, drawing_number, name, quantity, unit, unit_price) values (${lit(qTep)}, 0, ${lit(A.dn[0])}, 'Příruba — kalení', 2, 'ks', 1050)`);
// B: pro zaměstnance
const B = job("zaměstnanec");
quote(B, NOVAK, [4000, 4200], { lead: 21, note: "frézování" });
// C: starší zakázka ve výrobě — běžící krok bez termínu
const C = job("legacy", { status: "ve_vyrobe" });
sql(`insert into job_operations (job_id, kind, status, position, in_house, started_at) values (${lit(C.id)}, 'soustruzeni', 'probiha', 0, false, now() - interval '2 days')`);
// D: objednávka z Nákupu (nenavázaná na krok)
const D = job("z Nákupu");
const qD = quote(D, NOVAK, [4000, 4200], { lead: 21, note: "frézování" });
const PO_D = sql(`insert into purchase_orders (job_id, supplier_id, supplier_quote_id, number, status, order_date, required_date, currency, total, created_by)
  values (${lit(D.id)}, ${lit(NOVAK)}, ${lit(qD)}, ${lit(`OV-E2E14-${TAG}`)}, 'vystavena', current_date, current_date + 21, 'CZK', 12200, ${lit(ID.obchod)}) returning id`).split("\n")[0];
sql(`insert into purchase_order_items (purchase_order_id, position, drawing_number, name, quantity, unit, unit_price, order_item_id)
  values (${lit(PO_D)}, 0, ${lit(D.dn[0])}, 'Příruba', 2, 'ks', 4000, ${lit(D.items[0])}), (${lit(PO_D)}, 1, ${lit(D.dn[1])}, 'Pouzdro', 1, 'ks', 4200, ${lit(D.items[1])})`);
// E: pozdní postup (konečný termín za 5 dní, nabídka na 3 týdny)
const E = job("pozdě", { due: 5 });
quote(E, NOVAK, [4000, 4200], { lead: 21, note: "frézování" });
// F, G: plná automatika — bezpečná (ceny) a nebezpečná (bez cen)
const F = job("automatika", { items: [["PR-30", "Deska", 2, null]] });
quote(F, NOVAK, [4000], { lead: 14, note: "frézování" });
const G = job("bez ceny", { items: [["PR-40", "Deska", 2, null]] });
quote(G, NOVAK, [null], { lead: 14, note: "frézování" });

// ── Pomocníci ────────────────────────────────────────────────
const one = (q) => sql(q).split("\n")[0] ?? "";
const json = (q) => { const r = sql(q); return r ? JSON.parse(r) : null; };
const ops = (j) => json(`select coalesce(json_agg(o order by o.position, o.created_at), '[]')::text from job_operations o where job_id = ${lit(j.id)}`);
const pos = (j) => json(`select coalesce(json_agg(p order by p.created_at), '[]')::text from purchase_orders p where job_id = ${lit(j.id)}`);
const queue = (j) => json(`select coalesce(json_agg(q order by q.created_at), '[]')::text from approval_queue q where order_id = ${lit(j.id)}`);
const stage = (j) => one(`select status from orders where id = ${lit(j.id)}`);
const dialog = (page) => page.locator('[data-testid="handoff-dialog"]');
const submit = (page) => dialog(page).locator('[data-testid="handoff-submit"]');

async function openJob(page, j, query = "") {
  await page.goto(`${BASE}/orders/${j.id}${query}`);
  await page.locator('main section[aria-label="Zakázka"]').waitFor({ timeout: 20_000 });
  await waitHydrated(page, 'main section[aria-label="Zakázka"] button[aria-label^="Stav zakázky:"]');
}
/** Otevře předání tlačítkem dalšího kroku v hlavičce. */
async function openHandoffFromNext(page, label = "Předat do výroby…") {
  await page.locator('main section[aria-label="Zakázka"]').getByRole("button", { name: label, exact: true }).first().click();
  await submit(page).waitFor({ timeout: 20_000 });
}
async function dialogText(page) {
  return norm(await dialog(page).innerText());
}
async function waitResult(page) {
  await dialog(page).locator('[data-testid="handoff-result"]').waitFor({ timeout: 40_000 });
}

// ── 1. Korekce → Ve výrobě = povinné předání ─────────────────
await T("1 · korekce na Ve výrobě otevře „Předat do výroby“ (komu + do kdy); bez termínu nepustí dál", async (ctx) => {
  const page = await ctx.newPage();
  await login(page, USERS.obchod);
  await openJob(page, A);
  await page.locator('main section[aria-label="Zakázka"] button[aria-label^="Stav zakázky:"]').first().click();
  await page.getByRole("menuitem", { name: /Ve výrobě/ }).click();
  await submit(page).waitFor({ timeout: 20_000 });
  const t = await dialogText(page);
  expect(/Předat do výroby/.test(t), "titulek „Předat do výroby“");
  expect(t.includes("komu to zadáváš a do kdy"), "podtitulek „komu to zadáváš a do kdy“");
  // popisky polí jsou kapitálkami (innerText vrací velká písmena)
  expect(/kdo to dělá \*/i.test(t) && /termín kroku \*/i.test(t), "kdo a termín jsou povinné (*)");
  expect(!(await submit(page).isDisabled()), "předvyplněné předání jde rovnou potvrdit");
  // bez termínu nepustí
  const date = dialog(page).locator('input[type="date"]').first();
  const before = await date.inputValue();
  await date.fill("");
  await eventually(async () => expect(await submit(page).isDisabled(), "bez termínu je „Předat do výroby“ vypnuté"));
  await date.fill(before);
  await eventually(async () => expect(!(await submit(page).isDisabled()), "s termínem zase jde potvrdit"));
  await shot(page, S("1-dialog"));
  await dialog(page).getByRole("button", { name: "Zrušit" }).click();
  expect(stage(A) === "potvrzeno", "zavřením se nic nezměnilo");
  expect(ops(A).length === 0 && pos(A).length === 0, "žádné kroky ani objednávky");
});

// ── 2 + 3 + 4. Nejlevnější nabídka, předání, objednávka + PDF, dvojklik ──
let poA = null;
await T("2–4 · nejlevnější nabídka primárně (i proti vybrané v Nákupu), termín z nabídky; předání: 2 kroky, objednávka s PDF, fronta, historie; dvojklik = jedna objednávka", async (ctx) => {
  const page = await ctx.newPage();
  await login(page, USERS.obchod);
  await openJob(page, A);
  await openHandoffFromNext(page);
  const t = await dialogText(page);
  expect(t.includes("Nejlevnější postup:") && t.includes("14 300 Kč") && t.includes("15 000 Kč"), `banner postupu (${t.slice(0, 400)})`);
  expect(t.includes(`Nejlevnější nabídka: ${SUP_NAME[NOVAK]} — 12 200 Kč, termín 3 týdny`), "primárně Novák (nejlevnější), i když je v Nákupu vybraný Hrubý");
  expect(t.includes("Předvyplnila AI"), "„Předvyplnila AI“");
  expect(t.includes("Mezitermín · odhad — zatím nedohodnuto"), "mezitermín, odhad");
  expect(t.includes("Konečný termín (zákazník)") && t.includes("dohodnuto se zákazníkem"), "konečný termín zákazníka nahoře");
  expect(t.includes(`Vytvoří se objednávka OV-… pro ${SUP_NAME[NOVAK]} (PDF)`), "náhled objednávky");
  expect(t.includes("Objednávka se vystaví, až díl půjde do tohoto kroku"), "kalení: objednávka až při předání kroku");
  expect(t.includes("Díly: 1 ze 2"), "kalení jen díl s kalením");
  const date = await dialog(page).locator('input[type="date"]').first().inputValue();
  expect(date >= isoDays(21) && date <= isoDays(24), `termín z nabídky = dnes + 3 týdny (${date})`);
  // další nabídky: prošlá „vypršela", vybraná v Nákupu
  await dialog(page).getByRole("button", { name: /Další nabídky/ }).first().click();
  const t2 = await dialogText(page);
  expect(t2.includes("vypršela"), "prošlá nabídka má štítek „vypršela“");
  expect(t2.includes("Vybraná v Nákupu"), "vybraná v Nákupu je jen alternativa");
  await shot(page, S("2-dialog-plan"));
  // dvojklik = jedna objednávka (token)
  await submit(page).dblclick();
  await waitResult(page);
  const r = await dialogText(page);
  expect(r.includes("Předáno do výroby ✓"), "výsledek „Předáno do výroby ✓“");
  expect(/OV-[^ ]+ · .*Frézy Novák.* · PDF ✓ · čeká na odeslání/.test(r), `řádek objednávky v výsledku (${r.slice(0, 300)})`);
  await shot(page, S("3-result"));
  const o = ops(A);
  expect(o.length === 2, `2 kroky (${o.length})`);
  expect(o[0].status === "probiha" && o[0].supplier_id === NOVAK && o[0].deadline_state === "odhad", "krok 1 Novák běží, termín odhad");
  expect(o[1].kind === "tepelne_zpracovani" && o[1].status === "ceka" && o[1].supplier_id === TEPKAL && (o[1].order_item_ids ?? []).length === 1, "krok 2 kalení TepKal jen 1 díl");
  const p = pos(A);
  expect(p.length === 1, `právě jedna objednávka i po dvojkliku (${p.length})`);
  poA = p[0];
  expect(p[0].status === "vystavena" && p[0].file_id && p[0].created_by === ID.obchod && Number(p[0].total) === 12200, "objednávka vystavená s PDF, autor obchodník, cena z nabídky");
  const q = queue(A);
  expect(q.length === 1 && q[0].status === "pending" && q[0].type === "purchase_order", "fronta ke schválení");
  expect(stage(A) === "ve_vyrobe", "zakázka je ve výrobě");
  const ev = json(`select json_agg(json_build_object('m', message, 'n', actor_name))::text from job_events where job_id = ${lit(A.id)}`);
  expect(ev.some((e) => e.m.startsWith("Předáno do výroby:") && e.n === NAME.obchod), "historie: „Předáno do výroby:“ (Petr Obchodník)");
  expect(ev.some((e) => e.m.startsWith("Vystavena objednávka OV-") && e.n === NAME.obchod), "historie: „Vystavena objednávka OV-“ (Petr Obchodník)");
  await dialog(page).getByRole("button", { name: "Hotovo" }).click();
  await page.getByRole("tab", { name: /^Historie/ }).click();
  await eventually(async () => {
    const h = norm(await page.locator("main [role=tabpanel][data-state=active]").innerText());
    expect(h.includes("Předáno do výroby:") && h.includes("Vystavena objednávka OV-"), "Historie v UI");
  });
});

// ── 5. Kniha a tabule ────────────────────────────────────────
await T("5 · Kniha: „Krok 1/2 · Výroba 1 · … · do …“ s tečkou „Objednávka neodeslána“; tabule s mezititulkem; 390 px bez přetékání", async (ctx) => {
  const page = await ctx.newPage();
  await login(page, USERS.obchod);
  await page.goto(`${BASE}/orders?q=${encodeURIComponent(A.number)}`);
  const line = page.locator('[data-testid="production-line"]:visible').first();
  await line.waitFor({ timeout: 20_000 });
  const lt = norm(await line.innerText());
  expect(/Krok 1\/2 · Výroba 1 · E2E-14-Frézy Novák .* · do \d+\. \d+\./.test(lt), `řádek knihy (${lt})`);
  expect(await page.locator('[aria-label="Objednávka neodeslána"]').count() > 0, "oranžová tečka „Objednávka neodeslána“");
  await page.goto(`${BASE}/orders?q=${encodeURIComponent(A.number)}&view=tabule`);
  await page.locator('[data-testid="board-step-group"]').first().waitFor({ timeout: 20_000 });
  const g = norm(await page.locator('[data-testid="board-step-group"]').first().innerText());
  expect(/Výroba \(1\)/i.test(g), `mezititulek tabule (${g})`);
  await shot(page, S("5-board"));
}, {});
await T("5b · Kniha na mobilu 390 px", async (ctx) => {
  const page = await ctx.newPage();
  await login(page, USERS.obchod);
  await page.goto(`${BASE}/orders?q=${encodeURIComponent(A.number)}`);
  await page.locator('[data-testid="production-line"]:visible').first().waitFor({ timeout: 20_000 });
  await expectNoOverflow(page, "Kniha 390 px");
  await shot(page, S("5-book-mobile"));
}, { mobile: true });

// ── 6. Zaměstnanec ───────────────────────────────────────────
await T("6 · zaměstnanec předá bez cen: žádné „Kč“, objednávka vystaví server (autor dílna), čeká na schválení", async (ctx) => {
  const page = await ctx.newPage();
  await login(page, USERS.dilna);
  await openJob(page, B);
  await openHandoffFromNext(page);
  const t = await dialogText(page);
  expect(!t.includes("Kč"), "v dialogu žádná cena");
  expect(t.includes("Doporučeno podle nabídek"), "„Doporučeno podle nabídek“");
  expect(!t.includes("Rovnou odeslat"), "bez „Rovnou odeslat“");
  expect(!t.includes("Převzato od"), "bez převzetí");
  await submit(page).click();
  await waitResult(page);
  const r = await dialogText(page);
  expect(r.includes("Odešle obchodník nebo admin") && !r.includes("Kč"), "výsledek: odešle obchodník nebo admin, bez cen");
  const p = pos(B);
  expect(p.length === 1 && p[0].created_by === ID.dilna && p[0].status === "vystavena", "objednávka vystavená, autor zaměstnanec");
  expect(queue(B)[0]?.status === "pending", "čeká ve frontě");
});

// ── 7. Pozdní postup ─────────────────────────────────────────
await T("7 · postup končí po konečném termínu → varování a „Vím o tom“ (jinak nepustí)", async (ctx) => {
  const page = await ctx.newPage();
  await login(page, USERS.obchod);
  await openJob(page, E);
  await openHandoffFromNext(page);
  const t = await dialogText(page);
  expect(/Výroba skončí .* po konečném termínu \(zákazník\)/.test(t), `varování last_after_final (${t.slice(-600)})`);
  expect(await submit(page).isDisabled(), "bez „Vím o tom“ nejde předat");
  await dialog(page).getByText("Vím o tom — termín se zákazníkem domluvím.").click();
  await eventually(async () => expect(!(await submit(page).isDisabled()), "po „Vím o tom“ jde předat"));
  await shot(page, S("7-late"));
  await submit(page).click();
  await waitResult(page);
  expect(stage(E) === "ve_vyrobe", "předáno i po termínu (vědomě)");
});

// ── 8. Posunout dál s částečným převzetím ────────────────────
await T("8 · „Hotovo — posunout dál…“: převzato 1 z 2 ks → „Poslat dál i bez zbytku“, objednávka TepKal na 1 ks", async (ctx) => {
  const page = await ctx.newPage();
  await login(page, USERS.obchod);
  await openJob(page, A, "?tab=vyroba");
  await page.getByRole("button", { name: "Hotovo — posunout dál…" }).first().click();
  await submit(page).waitFor({ timeout: 20_000 });
  const t = await dialogText(page);
  expect(t.includes("kam díl jde dál?") && t.includes("Další krok: Tepelné zpracování"), `posunout dál (${t.slice(0, 300)})`);
  expect(t.includes("Převzato od"), "převzetí od dodavatele");
  await dialog(page).getByLabel(`Převzato ${A.dn[0]}`).fill("1");
  await dialog(page).getByText("Poslat dál i bez zbytku — zbytek dorazí později").click();
  await shot(page, S("8-advance"));
  await submit(page).click();
  await waitResult(page);
  const items = json(`select json_agg(json_build_object('dn', drawing_number, 'r', received_quantity, 'q', quantity))::text from purchase_order_items where purchase_order_id = ${lit(poA.id)}`);
  expect(Number(items.find((i) => i.dn === A.dn[0]).r) === 1, "převzato 1 ks");
  const o = ops(A);
  expect(o[0].status === "hotovo" && o[1].status === "probiha", "krok 1 hotový, kalení běží");
  const p = pos(A);
  const tep = p.find((x) => x.supplier_id === TEPKAL);
  expect(tep, "objednávka TepKal vystavená");
  const tq = one(`select quantity from purchase_order_items where purchase_order_id = ${lit(tep.id)}`);
  expect(Number(tq) === 1, `TepKal objednávka na převzatý 1 ks (${tq})`);
  expect(pos(A).find((x) => x.id === poA.id).status !== "dodana", "objednávka Novák zůstává otevřená (zbytek)");
  const ev = json(`select json_agg(message)::text from job_events where job_id = ${lit(A.id)}`);
  expect(ev.some((m) => /Převzato od .*1\/2 ks/.test(m)), "historie: převzato 1/2 ks");
});

// ── 9. Schválení ve frontě adminem → ze schránky obchodníka ──
await T("9 · super admin schválí objednávku v AI přehledu → e-mail s PDF ze schránky obchodníka zakázky", async (ctx) => {
  const page = await ctx.newPage();
  await login(page, USERS.admin);
  await page.goto(`${BASE}/dashboard`);
  const tep = pos(A).find((x) => x.supplier_id === TEPKAL);
  // řádek fronty = nejbližší rámeček kolem titulku objednávky
  const row = page.getByText(`Objednávka ${tep.number}`, { exact: false }).first()
    .locator('xpath=ancestor::div[contains(@class,"rounded-lg") and contains(@class,"border") and contains(@class,"bg-card")][1]');
  await row.waitFor({ timeout: 20_000 });
  const rt = norm(await row.innerText());
  const ownerBox = one(`select email from mailboxes where owner_id = ${lit(ID.obchod)} order by created_at limit 1`);
  expect(rt.includes("Odešle se z:") && (!ownerBox || rt.includes(ownerBox)), `„Odešle se z: ${ownerBox}“ (${rt})`);
  expect(rt.includes("Otevřít PDF"), "„Otevřít PDF“");
  await shot(page, S("9-queue"));
  const t0 = Date.now();
  await row.getByRole("button", { name: "Odeslat objednávku" }).click();
  const mail = await waitMail(MAIL.tepkal, (m) => m.subject.includes(tep.number) && Date.parse(m.receivedAt) >= t0 - 5000, 30_000);
  expect(mail, "e-mail dodavateli dorazil");
  expect(mail.attachments?.some((a) => a.contentType === "application/pdf"), "PDF v příloze");
  expect(!ownerBox || String(mail.envelopeFrom ?? mail.from).includes(ownerBox), `odesláno ze schránky obchodníka (${mail.from} / ${mail.envelopeFrom})`);
  await eventually(async () => expect(pos(A).find((x) => x.id === tep.id).status === "odeslana", "objednávka odeslaná"));
});

// ── 10. Plná automatika ──────────────────────────────────────
await T("10 · plná automatika: bezpečná objednávka odejde sama; bez ceny čeká ve frontě s důvodem", async (ctx) => {
  setMode("full");
  try {
    const page = await ctx.newPage();
    await login(page, USERS.obchod);
    await openJob(page, F);
    await openHandoffFromNext(page);
    expect((await dialogText(page)).includes("Plná automatika — objednávka odejde dodavateli sama"), "dialog: odejde sama (plná automatika)");
    await submit(page).click();
    await waitResult(page);
    expect((await dialogText(page)).includes("odesláno"), "výsledek: odesláno");
    await eventually(async () => expect(pos(F)[0]?.status === "odeslana", "objednávka F odeslaná"));
    await openJob(page, G);
    await openHandoffFromNext(page);
    await submit(page).click();
    await waitResult(page);
    const q = queue(G)[0];
    expect(q && q.status === "pending" && /Neodesláno automaticky: .*bez ceny/.test(q.summary), `G čeká s důvodem (${q?.summary})`);
  } finally {
    setMode("approval");
  }
});

// ── 11. Potvrzený termín ─────────────────────────────────────
await T("11 · dodavatel potvrdí jiný termín → krok se posune a ukáže „potvrdil …“", async (ctx) => {
  const p = pos(F)[0];
  const confirmed = one(`select (current_date + 20)::text`);
  sql(`update purchase_orders set status = 'potvrzena', confirmed_date = ${lit(confirmed)} where id = ${lit(p.id)}`);
  await eventually(async () => expect(ops(F)[0].planned_end === confirmed && ops(F)[0].deadline_state === "potvrzeno", "krok má potvrzený termín"));
  const page = await ctx.newPage();
  await login(page, USERS.obchod);
  await openJob(page, F, "?tab=vyroba");
  const chip = page.locator('[data-testid="step-deadline"]').first();
  await chip.waitFor({ timeout: 20_000 });
  const ct = norm(await chip.innerText());
  expect(/potvrdil|potvrzeno/.test(ct), `štítek „potvrdil …“ (${ct})`);
});

// ── 12. Ukončit výrobu ───────────────────────────────────────
await T("12 · „Ukončit výrobu…“ → Dodáno k nám (převzato vše)", async (ctx) => {
  const page = await ctx.newPage();
  await login(page, USERS.obchod);
  await openJob(page, F, "?tab=vyroba");
  await page.getByRole("button", { name: "Výroba — další akce" }).click();
  await page.getByRole("menuitem", { name: "Ukončit výrobu…" }).click();
  await submit(page).waitFor({ timeout: 20_000 });
  expect((await dialogText(page)).includes("Díly jsou u nás — připravit k expedici"), "cíl „Díly jsou u nás“");
  await submit(page).click();
  await eventually(async () => expect(stage(F) === "dodano_k_nam", `stav Dodáno k nám (${stage(F)})`), { timeout: 30_000 });
  expect(ops(F)[0].status === "hotovo", "krok hotový");
});

// ── 13. Starší zakázka ve výrobě ─────────────────────────────
await T("13 · starší zakázka ve výrobě: „Doplnit kdo a termín…“ upraví běžící krok, stav zůstává", async (ctx) => {
  const page = await ctx.newPage();
  await login(page, USERS.obchod);
  await openJob(page, C, "?tab=vyroba");
  const banner = page.locator('[data-testid="handoff-legacy"]');
  await banner.waitFor({ timeout: 20_000 });
  expect(norm(await banner.innerText()).includes("Zakázka je ve výrobě, ale chybí, kdo to dělá a termín."), "banner chybějícího předání");
  await banner.getByRole("button", { name: "Doplnit kdo a termín…" }).click();
  await submit(page).waitFor({ timeout: 20_000 });
  await dialog(page).getByRole("button", { name: "U nás" }).first().click();
  await dialog(page).locator('input[type="date"]').first().fill(isoDays(7));
  await dialog(page).getByRole("button", { name: "Uložit předání" }).click();
  await eventually(async () => {
    const o = ops(C)[0];
    expect(o.in_house === true && o.planned_end === isoDays(7) && o.status === "probiha", "běžící krok má kdo + termín, stav kroku beze změny");
  }, { timeout: 30_000 });
  expect(stage(C) === "ve_vyrobe", "stav zakázky beze změny");
});

// ── 14. Objednávka z Nákupu se použije ───────────────────────
await T("14 · zakázka s objednávkou z Nákupu: „Použije se vystavená objednávka …“, žádná druhá", async (ctx) => {
  const page = await ctx.newPage();
  await login(page, USERS.obchod);
  await openJob(page, D);
  await openHandoffFromNext(page);
  expect((await dialogText(page)).includes(`Použije se vystavená objednávka OV-E2E14-${TAG}`), "použije se vystavená objednávka");
  await submit(page).click();
  // bez nové objednávky se dialog zavře rovnou (výsledek jen oznámením)
  await eventually(async () => expect(stage(D) === "ve_vyrobe", "předáno"), { timeout: 30_000 });
  expect(pos(D).length === 1, `jedna objednávka celkem (${pos(D).length})`);
  expect(ops(D)[0].purchase_order_id === PO_D, "krok navázaný na objednávku z Nákupu");
});

// ── 15. Vrátit předání ───────────────────────────────────────
await T("15 · „Vrátit předání do výroby“ → zpět Potvrzená objednávka, neodeslaná objednávka zrušena", async (ctx) => {
  const page = await ctx.newPage();
  await login(page, USERS.obchod);
  await openJob(page, B, "?tab=vyroba");
  await page.getByRole("button", { name: "Výroba — další akce" }).click();
  await page.getByRole("menuitem", { name: "Vrátit předání do výroby" }).click();
  await submit(page).waitFor({ timeout: 20_000 });
  await submit(page).click();
  await eventually(async () => expect(stage(B) === "potvrzeno", `stav zpět (${stage(B)})`), { timeout: 30_000 });
  expect(pos(B)[0].status === "zrusena", "objednávka zrušena");
  expect(ops(B).every((o) => o.status === "ceka"), "kroky zpět na Čeká");
});

// ── 16. Bez hlídání (majitel 29. 10.: „bez dodavatele a termínu to nepustí — tohle zatím zruš") ──
const H = job("bez předání");
await T("16 · „Přesunout bez dodavatele a termínu“: stav postaru (v historii kdo), chybějící kdo + termín jen upozornění (Technologie + Kniha)", async (ctx) => {
  const page = await ctx.newPage();
  await login(page, USERS.obchod);
  await openJob(page, H);
  await page.locator('main section[aria-label="Zakázka"] button[aria-label^="Stav zakázky:"]').first().click();
  await page.getByRole("menuitem", { name: /Ve výrobě/ }).click();
  await submit(page).waitFor({ timeout: 20_000 });
  const move = dialog(page).locator('[data-testid="handoff-plain-move"]');
  expect(norm(await move.innerText()) === "Přesunout bez dodavatele a termínu", "druhotná akce „Přesunout bez dodavatele a termínu“");
  await move.click();
  await eventually(async () => expect(stage(H) === "ve_vyrobe", `přesunuto postaru (${stage(H)})`), { timeout: 30_000 });
  expect(ops(H).length === 0 && pos(H).length === 0, "bez kroků a objednávek");
  const row = json(`select json_build_object('note', stage_change_note, 'by', stage_changed_by)::text from orders where id = ${lit(H.id)}`);
  expect(row.by === ID.obchod && /bez dodavatele a termínu/.test(row.note ?? ""), `v historii kdo a proč (${JSON.stringify(row)})`);
  await openJob(page, H, "?tab=vyroba");
  const banner = page.locator('[data-testid="handoff-legacy"]');
  await banner.waitFor({ timeout: 20_000 });
  expect(norm(await banner.innerText()).includes("chybí, kdo to dělá a termín"), "Technologie: upozornění chybí kdo a termín");
  // jediná výzva = banner (žádný starý prázdný stav „Jak se zakázka vyrobí?“ pod ním)
  expect(await page.getByText("Jak se zakázka vyrobí?").count() === 0 && await page.getByText("Nebo poskládej sám").count() === 0, "bez druhé výzvy prázdného stavu");
  expect(await page.getByRole("tab", { name: /^Technologie/ }).count() > 0, "záložka se jmenuje „Technologie“");
  await page.goto(`${BASE}/orders?q=${encodeURIComponent(H.number)}`);
  const line = page.locator('[data-testid="production-line"]:visible').first();
  await line.waitFor({ timeout: 20_000 });
  expect(/Chybí kdo a termín/.test(norm(await line.innerText())), `Kniha: „Chybí kdo a termín“ (${norm(await line.innerText())})`);
});

// ── 17. Technologie → poznámka pro dodavatele do objednávky (PDF + e-mail) ──
const TJ = job("technologie", { items: [["PR-50", "Hřídel", 2, null], ["PR-51", "Kolík", 1, null]] });
quote(TJ, NOVAK, [4000, 4200], { lead: 21, note: "frézování" });
await T("17 · Technologie: postup / kompletně zadáno / poznámka pro dodavatele → v dialogu předání → v PDF objednávky u položky a v e-mailu", async (ctx) => {
  const page = await ctx.newPage();
  await login(page, USERS.obchod);
  await openJob(page, TJ, "?tab=vyroba");
  const cards = page.locator('main [role=tabpanel][data-state=active] [data-testid="tech-item"]');
  await cards.first().waitFor({ timeout: 20_000 });
  expect(await cards.count() === 2, "karta technologie pro každou položku");
  await cards.nth(0).getByLabel("Technologický postup (nepovinné)").fill("1. soustružit načisto\n2. frézovat drážku");
  await cards.nth(0).locator('[data-testid="tech-supplier-note"]').fill("pozor popsat na čele");
  await cards.nth(0).locator('[data-testid="tech-save"]').click();
  await eventually(async () => expect(one(`select supplier_note from order_items where id = ${lit(TJ.items[0])}`) === "pozor popsat na čele", "poznámka uložená k položce"));
  await cards.nth(1).getByRole("radio", { name: "Kompletně zadáno" }).click();
  await cards.nth(1).getByLabel("Bez technologie — kompletně zadáno firmě").fill("Frézy Novák");
  await cards.nth(1).locator('[data-testid="tech-save"]').click();
  await eventually(async () => expect(one(`select tech_complete::text || '|' || coalesce(tech_complete_by, '') from order_items where id = ${lit(TJ.items[1])}`) === "true|Frézy Novák", "kompletně zadáno uložené"));
  await page.reload();
  const section = page.locator('main [role=tabpanel][data-state=active] [data-testid="technology-section"]');
  await section.waitFor({ timeout: 20_000 });
  const sec = norm(await section.innerText());
  expect(sec.includes("Technologický postup (2 řádky)") && sec.includes("Bez technologie — kompletně zadáno Frézy Novák"), `stav technologie (${sec.slice(0, 300)})`);
  await shot(page, S("17-technologie"));
  // předání: poznámka je vidět u kroku a jde upravit
  await page.locator('main section[aria-label="Zakázka"]').getByRole("button", { name: "Předat do výroby…", exact: true }).first().click();
  await submit(page).waitFor({ timeout: 20_000 });
  const notes = dialog(page).locator('[data-testid="handoff-item-notes"]').first();
  await notes.locator("input").first().waitFor({ timeout: 10_000 });
  expect(await notes.locator("input").first().inputValue() === "pozor popsat na čele", "dialog: poznámka pro dodavatele u dílu kroku (předvyplněná z Technologie)");
  // poznámky jsou rozbalené (díl kroku už poznámku má) → druhý díl doplním přímo v dialogu
  const inputs = notes.locator("input");
  expect(await inputs.count() === 2, `poznámka u obou dílů kroku (${await inputs.count()})`);
  if (await inputs.count() > 1) await inputs.nth(1).fill("změna materiálu na 1.4301");
  await shot(page, S("17-dialog-notes"));
  await submit(page).click();
  await waitResult(page);
  const p = pos(TJ)[0];
  const its = json(`select json_agg(json_build_object('dn', drawing_number, 'note', note) order by position)::text from purchase_order_items where purchase_order_id = ${lit(p.id)}`);
  expect(/^Pozor: popsat na čele/.test(its[0].note ?? ""), `položka 1 objednávky: „Pozor: popsat na čele“ (${its[0].note})`);
  if (await inputs.count() > 1) expect(/^Pozor: změna materiálu na 1\.4301/.test(its[1].note ?? ""), `položka 2 z dialogu (${its[1].note})`);
  // PDF objednávky: text u položky
  const r = await page.request.get(`${BASE}/api/jobs/files/${p.file_id}`);
  expect(r.status() === 200, `PDF objednávky (${r.status()})`);
  const { writeFileSync } = await import("node:fs");
  const { execFileSync } = await import("node:child_process");
  const tmp = `/tmp/e2e14-${tl}-po.pdf`;
  writeFileSync(tmp, await r.body());
  const txt = norm(execFileSync("pdftotext", ["-layout", tmp, "-"]).toString("utf8"));
  expect(txt.includes("Pozor: popsat na čele"), `PDF obsahuje „Pozor: popsat na čele“ (${txt.slice(0, 400)})`);
  const q = queue(TJ)[0];
  expect(String(q?.payload?.body ?? "").includes(`– ${TJ.dn[0]}: popsat na čele`), "e-mail dodavateli: souhrn poznámek u položek");
});

// ── 18. Nabídka telefonem ────────────────────────────────────
const PJ = job("telefon", { items: [["PR-60", "Deska", 2, null]] });
await T("18 · „Nabídka telefonem…“: nová firma, cena, lhůta → nabídka dodavatele (telefon), krok i objednávka z ní", async (ctx) => {
  const page = await ctx.newPage();
  await login(page, USERS.obchod);
  await openJob(page, PJ);
  await openHandoffFromNext(page);
  // zakázka bez nabídky: kdo se dá zapsat podle nabídky telefonem
  expect(!(await dialogText(page)).includes("Nejlevnější nabídka"), "bez nabídky dodavatele");
  await dialog(page).locator('[data-testid="handoff-phone-open"]').first().click();
  const form = dialog(page).locator('[data-testid="handoff-phone-form"]');
  await form.getByLabel("Firma *").fill(`${P}Telefon CNC ${TAG} s.r.o.`);
  await form.getByLabel("Cena bez DPH (díly kroku)").fill("9 800");
  await form.getByLabel("Lhůta (dní)").fill("10");
  await form.getByLabel("Poznámka (kdo volal, co slíbil)").fill("volal p. Dvořák");
  await shot(page, S("18-phone"));
  await form.locator('[data-testid="handoff-phone-save"]').click();
  await eventually(async () => {
    const err = (await form.count()) ? norm(await form.locator('[role="alert"]').allInnerTexts().then((a) => a.join(" "))) : "";
    expect((await form.count()) === 0, `formulář se zavřel — nabídka zapsaná a vybraná u kroku${err ? ` (chyba: ${err})` : ""}`);
  }, { timeout: 20_000 });
  const t = await dialogText(page);
  expect(t.includes(`${P}Telefon CNC ${TAG} s.r.o. — 9 800 Kč, termín 10 dní`), `kdo + cena + lhůta (${t.slice(t.indexOf("KDO TO DĚLÁ"), t.indexOf("KDO TO DĚLÁ") + 700)})`);
  const date = await dialog(page).locator('input[type="date"]').first().inputValue();
  // dnes + 10 dní (víkend → nejbližší pracovní den)
  expect(date >= isoDays(10) && date <= isoDays(12), `termín z nabídky telefonem (${date})`);
  await submit(page).click();
  await waitResult(page);
  const sq = json(`select json_build_object('id', id, 'source', source, 'total', total, 'lead', lead_time_days, 'sup', supplier_id)::text from supplier_quotes where job_id = ${lit(PJ.id)}`);
  expect(sq.source === "telefon" && Number(sq.total) === 9800 && sq.lead === 10, `nabídka dodavatele ze zdroje telefon (${JSON.stringify(sq)})`);
  const p = pos(PJ)[0];
  expect(p && p.supplier_id === sq.sup && p.supplier_quote_id === sq.id && Number(p.total) === 9800, "objednávka z nabídky telefonem");
  expect(ops(PJ)[0].supplier_quote_id === sq.id, "krok navázaný na nabídku telefonem");
});

// ── 19–23: review WP3 ────────────────────────────────────────
// 19. Výroba → TZ → Výroba u stejné firmy: přidaná „Výroba 2" nepřevezme nabídku Výroby 1 (cena by byla dvakrát)
const RJ = job("tři kroky", { due: 60 });
const qRJ = quote(RJ, NOVAK, [4000, 4200], { lead: 21, note: "frézování" });
const qRJt = sql(`insert into supplier_quotes (job_id, supplier_id, number, currency, lead_time_days, source, total, valid_until, operation_kinds, note)
  values (${lit(RJ.id)}, ${lit(TEPKAL)}, ${lit(`NAB-${TAG}-rjt`)}, 'CZK', 5, 'manual', 2100, current_date + 30, '{tepelne_zpracovani}'::text[], 'kalení') returning id`).split("\n")[0];
sql(`insert into supplier_quote_items (supplier_quote_id, position, drawing_number, name, quantity, unit, unit_price) values (${lit(qRJt)}, 0, ${lit(RJ.dn[0])}, 'Příruba — kalení', 2, 'ks', 1050)`);
await T("19 · Výroba → Tepelné zpracování → Výroba u stejné firmy: druhé obrábění bez nabídky Výroby 1 („stejná firma — cena dle nové nabídky“)", async (ctx) => {
  const page = await ctx.newPage();
  await login(page, USERS.obchod);
  await openJob(page, RJ);
  await openHandoffFromNext(page);
  await dialog(page).locator('[data-testid="handoff-add-step"]').click();
  await page.getByRole("menuitem", { name: "Výroba", exact: true }).click();
  await eventually(async () => expect((await dialogText(page)).includes("Krok 3/3 · Výroba 2"), "přidaný krok 3/3 · Výroba 2"));
  const t = await dialogText(page);
  const k3 = t.slice(t.indexOf("Krok 3/3 · Výroba 2"));
  // další výroba: nic se nepředvyplní (Výroba 1/2/3 bývá u různých firem) — nápověda + stejná firma jako volba
  expect(/Díly už dělá krok 1 \(Výroba 1\)/.test(k3), `krok 3: kdo prázdný s nápovědou (${k3.slice(0, 400)})`);
  expect(/Stejná firma jako krok 1( \(Výroba 1\))? — cena dle nové nabídky/.test(k3), `krok 3: stejná firma bez ceny jako volba (${k3.slice(0, 400)})`);
  expect(!/Krok 3\/3 · Výroba 2[^]*Nejlevnější nabídka: .*12 200 Kč/.test(t), "krok 3 nemá „Nejlevnější nabídka … 12 200 Kč“");
  const card3 = dialog(page).locator('section[aria-label^="Krok 3/3"]');
  await card3.getByRole("button", { name: /Stejná firma jako krok 1/ }).first().click();
  // varování: nabídku téže firmy už má krok 1 → tady se díly objednají znovu (bez ceny)
  await eventually(async () => expect(/už má krok 1 \(Výroba 1\) — tady se díly objednají znovu/.test(norm(await card3.innerText())), "varování u stejné firmy"));
  await card3.locator('[data-testid="handoff-overlap-warning"]').scrollIntoViewIfNeeded();
  await shot(page, S("19-three-steps-same-firm"));
  await submit(page).click();
  await waitResult(page);
  const o = ops(RJ);
  expect(o.length === 3 && o[0].supplier_quote_id === qRJ && o[2].supplier_id === NOVAK && o[2].supplier_quote_id === null,
    `krok 3 Novák bez nabídky kroku 1 (${o.map((x) => `${x.kind}:${x.supplier_quote_id}`).join(", ")})`);
  expect(pos(RJ).length === 1 && Number(pos(RJ)[0].total) === 12200, "zatím jen objednávka kroku 1 (12 200)");
});

// 20. Nabídka telefonem pro krok s víc díly: cena za kus u každého dílu → objednávka s cenami položek
const PM = job("telefon víc dílů");
await T("20 · „Nabídka telefonem…“ u kroku se 2 díly: cena za kus u každého dílu, součet; objednávka s cenami položek (ne 0 Kč)", async (ctx) => {
  const page = await ctx.newPage();
  await login(page, USERS.obchod);
  await openJob(page, PM);
  await openHandoffFromNext(page);
  await dialog(page).locator('[data-testid="handoff-phone-open"]').first().click();
  const form = dialog(page).locator('[data-testid="handoff-phone-form"]');
  await form.getByLabel("Firma *").fill(SUP_NAME[HRUBY]);
  const parts = form.locator('[data-testid="handoff-phone-part-prices"]');
  await parts.waitFor({ timeout: 10_000 });
  expect(await form.getByLabel("Cena bez DPH (díly kroku)").count() === 0, "u víc dílů není jedna celková cena");
  await form.getByLabel(`Cena za kus — ${PM.dn[0]}`).fill("4 000");
  await form.getByLabel(`Cena za kus — ${PM.dn[1]}`).fill("4200");
  await form.getByLabel("Lhůta (dní)").fill("10");
  await eventually(async () => expect(norm(await form.locator('[data-testid="handoff-phone-sum"]').innerText()).includes("Celkem 12 200 Kč"), "součet za díly"));
  await shot(page, S("20-phone-parts"));
  await form.locator('[data-testid="handoff-phone-save"]').click();
  await eventually(async () => expect((await form.count()) === 0, "nabídka zapsaná"), { timeout: 20_000 });
  const t = await dialogText(page);
  expect(t.includes("2 položky · 12 200 Kč"), `náhled objednávky s cenou položek (${t.slice(t.indexOf("OBJEDNÁVKA DODAVATELI"), t.indexOf("OBJEDNÁVKA DODAVATELI") + 300)})`);
  expect(!t.includes("bez ceny — dodavatel je nacení"), "žádná položka bez ceny");
  await submit(page).click();
  await waitResult(page);
  const p = pos(PM)[0];
  const its = json(`select json_agg(unit_price order by position)::text from purchase_order_items where purchase_order_id = ${lit(p.id)}`);
  expect(Number(p.total) === 12200 && its.map(Number).join(",") === "4000,4200", `objednávka s cenami položek (${p.total}; ${its})`);
});

// 21. Před výrobou: menu kroku nepřesune zakázku do výroby bez dialogu; celá zakázka kompletně zadána jedním ťuknutím
const MJ = job("menu kroku");
sql(`insert into job_operations (job_id, kind, status, position, in_house, supplier_id, planned_end) values (${lit(MJ.id)}, 'vyroba', 'ceka', 0, false, ${lit(NOVAK)}, current_date + 14)`);
await T("21 · před výrobou: menu kroku = „Předat do výroby…“ / „Už vyrobeno — zapsat výrobu…“ (ne „Rovnou hotovo“); „Celá zakázka kompletně zadána {firma}“", async (ctx) => {
  const page = await ctx.newPage();
  await login(page, USERS.obchod);
  await openJob(page, MJ, "?tab=vyroba");
  const panel = page.locator("main [role=tabpanel][data-state=active]");
  await panel.getByRole("button", { name: /^Další akce: / }).first().click();
  const items = norm((await page.getByRole("menuitem").allInnerTexts()).join(" | "));
  expect(items.includes("Předat do výroby…") && items.includes("Už vyrobeno — zapsat výrobu…"), `menu kroku (${items})`);
  expect(!items.includes("Rovnou hotovo") && !items.includes("Nahlásit problém"), `bez „Rovnou hotovo“ / „Nahlásit problém“ (${items})`);
  await shot(page, S("21-step-menu-before-production"));
  await page.getByRole("menuitem", { name: "Předat do výroby…" }).click();
  await submit(page).waitFor({ timeout: 20_000 });
  await dialog(page).getByRole("button", { name: "Zrušit" }).click();
  expect(stage(MJ) === "potvrzeno" && ops(MJ)[0].status === "ceka", "menu nic nepřesunulo");
  // celá zakázka kompletně zadána firmě z kroku
  const btn = panel.locator('[data-testid="tech-whole-job-btn"]');
  await btn.waitFor({ timeout: 10_000 });
  expect(norm(await btn.innerText()) === `Celá zakázka kompletně zadána ${SUP_NAME[NOVAK]}`, `tlačítko (${norm(await btn.innerText())})`);
  await btn.click();
  await eventually(() => expect(one(`select string_agg(tech_complete::text || ':' || coalesce(tech_complete_by, ''), ',' order by position) from order_items where order_id = ${lit(MJ.id)}`)
    === `true:${SUP_NAME[NOVAK]},true:${SUP_NAME[NOVAK]}`, "obě položky kompletně zadané firmě"));
  await panel.locator('[data-testid="tech-whole-job"]').getByText("Celá zakázka kompletně zadána").waitFor({ timeout: 15_000 });
  await shot(page, S("21-whole-job-complete"));
});

await T("21b · Technologie na mobilu 390 px: „Celá zakázka kompletně zadána …“ se zalomí, stránka do šířky nepřetéká", async (ctx) => {
  const page = await ctx.newPage();
  await login(page, USERS.obchod);
  await openJob(page, MJ, "?tab=vyroba");
  const w = page.locator('main [role=tabpanel][data-state=active] [data-testid="tech-whole-job"]');
  await w.waitFor({ timeout: 20_000 });
  await w.scrollIntoViewIfNeeded();
  await expectNoOverflow(page, "Technologie 390 px");
  const box = await w.boundingBox();
  expect(box && box.x + box.width <= 390, `blok celé zakázky v šířce obrazovky (${JSON.stringify(box)})`);
  await shot(page, S("21b-whole-job-mobile"));
}, { mobile: true });

// 22. Zapsat dodání během výroby: nejdřív Ukončit výrobu (zbylý krok + neodeslaná objednávka), pak dodání
const VJ = job("dodání ve výrobě", { status: "ve_vyrobe" });
sql(`insert into job_operations (job_id, kind, status, position, in_house, planned_end, started_at) values (${lit(VJ.id)}, 'vyroba', 'probiha', 0, true, current_date + 5, now())`);
const PO_V = sql(`insert into purchase_orders (job_id, supplier_id, number, status, order_date, required_date, currency, total, created_by)
  values (${lit(VJ.id)}, ${lit(TEPKAL)}, ${lit(`OV-E2E14V-${TAG}`)}, 'vystavena', current_date, current_date + 12, 'CZK', 2100, ${lit(ID.obchod)}) returning id`).split("\n")[0];
sql(`insert into job_operations (job_id, kind, status, position, in_house, supplier_id, planned_end, purchase_order_id) values (${lit(VJ.id)}, 'tepelne_zpracovani', 'ceka', 1, false, ${lit(TEPKAL)}, current_date + 12, ${lit(PO_V)})`);
await T("22 · „Zapsat dodání“ ve výrobě s otevřenými kroky → nejdřív „Ukončit výrobu“ (zbylý krok přeskočen, neodeslaná objednávka zrušena), pak dodání", async (ctx) => {
  const page = await ctx.newPage();
  await login(page, USERS.obchod);
  await openJob(page, VJ, "?tab=vyroba");
  await page.getByRole("region", { name: "Dodání zákazníkovi" }).getByRole("button", { name: "Zapsat dodání" }).click();
  await submit(page).waitFor({ timeout: 20_000 });
  const t = await dialogText(page);
  expect(t.includes("Výroba ještě běží") && t.includes("Ukončit výrobu"), `nejdřív ukončit výrobu (${t.slice(0, 300)})`);
  expect(norm(await dialog(page).locator('[data-testid="handoff-plain-move"]').innerText()) === "Zapsat dodání bez ukončení kroků", "druhotná akce — dodání postaru");
  await dialog(page).getByLabel("Proč končíš dřív? *").fill("dodavatel posílá rovnou zákazníkovi");
  await shot(page, S("22-delivery-finish-first"));
  await submit(page).click();
  // po ukončení výroby se rovnou otevře dodání zákazníkovi
  const delivery = page.getByRole("dialog");
  await delivery.getByRole("button", { name: /^Vše — / }).first().waitFor({ timeout: 40_000 });
  expect(ops(VJ).map((o) => o.status).join(",") === "hotovo,preskoceno", `kroky: hotovo + přeskočeno (${ops(VJ).map((o) => o.status)})`);
  expect(pos(VJ)[0].status === "zrusena", "neodeslaná objednávka dalšího kroku zrušena");
  for (const b of await delivery.getByRole("button", { name: /^Vše — / }).all()) await b.click();
  await delivery.getByRole("button", { name: "Zapsat dodání" }).click();
  await eventually(async () => expect(stage(VJ) === "dodano_zakaznikovi", `dodáno zákazníkovi (${stage(VJ)})`), { timeout: 30_000 });
});

// 23. Po přesunu bez předání: jedno tlačítko v hlavičce, jeden dialog = krok běží + objednávka; Kniha = detail u čekajícího kroku
const SJ = job("doplnění");
quote(SJ, NOVAK, [4000, 4200], { lead: 21, note: "frézování" });
const WJ = job("čekající krok", { status: "ve_vyrobe" });
sql(`insert into job_operations (job_id, kind, status, position, in_house, finished_at) values (${lit(WJ.id)}, 'vyroba', 'hotovo', 0, true, now())`);
sql(`insert into job_operations (job_id, kind, status, position, in_house, supplier_id, planned_end) values (${lit(WJ.id)}, 'tepelne_zpracovani', 'ceka', 1, false, ${lit(TEPKAL)}, current_date + 9)`);
await T("23 · po „Přesunout bez…“: v hlavičce jen jedno „Doplnit kdo a termín…“, jeden dialog spustí krok + vystaví objednávku; Kniha = detail („Předat do kroku…“)", async (ctx) => {
  const page = await ctx.newPage();
  await login(page, USERS.obchod);
  await openJob(page, SJ);
  await page.locator('main section[aria-label="Zakázka"] button[aria-label^="Stav zakázky:"]').first().click();
  await page.getByRole("menuitem", { name: /Ve výrobě/ }).click();
  await submit(page).waitFor({ timeout: 20_000 });
  await dialog(page).locator('[data-testid="handoff-plain-move"]').click();
  await eventually(async () => expect(stage(SJ) === "ve_vyrobe", "přesunuto bez předání"), { timeout: 30_000 });
  await openJob(page, SJ);
  const header = page.locator('main section[aria-label="Zakázka"]');
  await eventually(async () => {
    const n = await header.getByRole("button", { name: "Doplnit kdo a termín…", exact: true }).count();
    expect(n === 1, `„Doplnit kdo a termín…“ v hlavičce jen jednou (${n}×)`);
  });
  expect(await page.locator('[data-testid="chip-handoff"]').count() === 0, "bez druhého chipu „Doplnit kdo a termín…“");
  await shot(page, S("23-header-after-skip"));
  await header.getByRole("button", { name: "Doplnit kdo a termín…", exact: true }).click();
  await submit(page).waitFor({ timeout: 20_000 });
  const t = await dialogText(page);
  expect(t.includes("Začíná teď") && t.includes(`Vytvoří se objednávka OV-… pro ${SUP_NAME[NOVAK]} (PDF)`), `doplnění spustí krok a vystaví objednávku (${t.slice(0, 500)})`);
  await submit(page).click();
  await waitResult(page);
  expect(ops(SJ).length === 1 && ops(SJ)[0].status === "probiha", "krok běží");
  expect(pos(SJ).length === 1 && pos(SJ)[0].status === "vystavena", "objednávka vystavená");
  // Kniha: čekající krok bez běžícího = stejně jako detail
  await page.goto(`${BASE}/orders?q=${encodeURIComponent(WJ.number)}`);
  const row = page.locator("main ul[role=list] > li").filter({ has: page.locator(`a[href="/orders/${WJ.id}"]`) }).first();
  await row.waitFor({ timeout: 20_000 });
  const rt = norm(await row.innerText());
  expect(rt.includes("Předat do kroku…") && !rt.includes("Posunout dál…"), `Kniha: „Předat do kroku…“ (${rt.slice(0, 300)})`);
  await row.scrollIntoViewIfNeeded();
  await shot(page, S("23-book-waiting-step"));
  await openJob(page, WJ);
  const ht = norm(await page.locator('main section[aria-label="Zakázka"]').innerText());
  expect(ht.includes("Předat do kroku…"), "detail: „Předat do kroku…“");
});

// ── 24–26: follow-up WP3 ─────────────────────────────────────
/** Světlý / tmavý motiv bez načtení stránky (otevřený dialog zůstane). */
async function setTheme(page, dark) {
  await page.evaluate((d) => {
    try { localStorage.setItem("theme", d ? "dark" : "light"); } catch { /* bez úložiště */ }
    document.documentElement.classList.toggle("dark", d);
    document.documentElement.classList.toggle("light", !d);
    document.documentElement.style.colorScheme = d ? "dark" : "light";
  }, dark);
}
async function addVyroba2(page) {
  await dialog(page).locator('[data-testid="handoff-add-step"]').click();
  await page.getByRole("menuitem", { name: "Výroba", exact: true }).click();
  await eventually(async () => expect((await dialogText(page)).includes("Krok 3/3 · Výroba 2"), "přidaný krok 3/3 · Výroba 2"));
  return dialog(page).locator('section[aria-label^="Krok 3/3"]');
}

// 24. Krok 1 z nabídky + „Výroba 2": kompletní dodávka (Hrubý 15 000, vybraná v Nákupu) se nikdy nepředvyplní
const KJ = job("komplet a výroba 2", { due: 60 });
const qKJ = quote(KJ, HRUBY, [5000, 5000], { kinds: "kompletni_dodavka", selected: true, lead: 25 });
const qKJn = quote(KJ, NOVAK, [4000, 4200], { lead: 21, note: "frézování" });
const qKJt = sql(`insert into supplier_quotes (job_id, supplier_id, number, currency, lead_time_days, source, total, valid_until, operation_kinds, note)
  values (${lit(KJ.id)}, ${lit(TEPKAL)}, ${lit(`NAB-${TAG}-kjt`)}, 'CZK', 5, 'manual', 2100, current_date + 30, '{tepelne_zpracovani}'::text[], 'kalení') returning id`).split("\n")[0];
sql(`insert into supplier_quote_items (supplier_quote_id, position, drawing_number, name, quantity, unit, unit_price) values (${lit(qKJt)}, 0, ${lit(KJ.dn[0])}, 'Příruba — kalení', 2, 'ks', 1050)`);
await T("24a · zaměstnanec 390 px: krok 1 z nabídky Nováka + „Výroba 2“ → žádná „Jediná nabídka: Hrubý“, kdo prázdný s nápovědou, žádné „Kč“", async (ctx) => {
  const page = await ctx.newPage();
  await login(page, USERS.dilna);
  await openJob(page, KJ);
  await openHandoffFromNext(page);
  expect((await dialogText(page)).includes(SUP_NAME[NOVAK]), "krok 1 = Novák z nabídky");
  const card3 = await addVyroba2(page);
  const k3 = norm(await card3.innerText());
  expect(k3.includes("Díly už dělá krok 1 (Výroba 1)"), `nápověda u prázdného kdo (${k3.slice(0, 400)})`);
  expect(!k3.includes(SUP_NAME[HRUBY]) && !/Jediná nabídka|Doporučeno podle nabídek|nejlevnější/.test(k3), `kompletní dodávka není návrh (${k3.slice(0, 400)})`);
  expect(!(await dialogText(page)).includes("Kč"), "zaměstnanec nevidí ceny");
  await card3.locator('[data-testid="handoff-who-hint"]').scrollIntoViewIfNeeded();
  await expectNoOverflow(page, "dialog předání 390 px");
  await shot(page, S("24a-vyroba2-worker-light"));
  await setTheme(page, true);
  await shot(page, S("24a-vyroba2-worker-dark"));
  await setTheme(page, false);
  await dialog(page).getByRole("button", { name: "Zrušit" }).click();
  expect(ops(KJ).length === 0 && pos(KJ).length === 0, "nic nevzniklo");
}, { mobile: true });

await T("24b · obchodník: „Výroba 2“ bez kompletní dodávky; ručně Hrubý → varování „má nabídku na kompletní dodávku“; předání nepřipíše nabídku Hrubého", async (ctx) => {
  const page = await ctx.newPage();
  await login(page, USERS.obchod);
  await openJob(page, KJ);
  await openHandoffFromNext(page);
  const card3 = await addVyroba2(page);
  const k3 = norm(await card3.innerText());
  expect(k3.includes("Díly už dělá krok 1 (Výroba 1)") && !k3.includes("15 000") && !k3.includes("Jediná nabídka"), `bez kompletní dodávky (${k3.slice(0, 400)})`);
  // ručně firma s kompletní nabídkou → varování (bez cen)
  await card3.getByRole("button", { name: "Jiná firma…" }).click();
  await card3.getByPlaceholder("Hledej dodavatele, nebo napiš název firmy…").fill("Kovoobrábění Hrubý");
  await card3.getByRole("option").filter({ hasText: SUP_NAME[HRUBY] }).first().getByRole("button").click();
  const warn = card3.locator('[data-testid="handoff-overlap-warning"]');
  await warn.waitFor({ timeout: 10_000 });
  const w = norm(await warn.innerText());
  expect(/má nabídku na kompletní dodávku .* díly dělá i krok 1 \(Výroba 1\)\. Obrábění by se objednalo dvakrát\./.test(w) && !w.includes("Kč"), `varování (${w})`);
  await warn.scrollIntoViewIfNeeded();
  await shot(page, S("24b-overlap-warning"));
  await submit(page).click();
  await waitResult(page);
  const o = ops(KJ);
  expect(o.length === 3 && o[0].supplier_quote_id === qKJn && o[2].supplier_id === HRUBY && o[2].supplier_quote_id === null,
    `krok 3 Hrubý bez kompletní nabídky (${o.map((x) => `${x.kind}:${x.supplier_quote_id}`).join(", ")})`);
  expect(!o.some((x) => x.supplier_quote_id === qKJ), "kompletní nabídka u žádného kroku");
  expect(pos(KJ).length === 1 && Number(pos(KJ)[0].total) === 12200, "jen objednávka kroku 1 (12 200)");
});

// 25. Vrátit předání = zpět do stavu před předáním (ne vždy Potvrzená): menu postupu (Objednávka) i akce toku (Reklamace)
const UJ = job("vrácení z objednávky", { status: "objednavka" });
quote(UJ, NOVAK, [4000, 4200], { lead: 21, note: "frézování" });
const RJ2 = job("vrácení z reklamace", { status: "reklamace" });
quote(RJ2, NOVAK, [4000, 4200], { lead: 21, note: "frézování" });
async function handoffFromTech(page, j) {
  await openJob(page, j, "?tab=vyroba");
  await page.locator('main [role=tabpanel][data-state=active] [data-testid="handoff-empty"]').getByRole("button", { name: "Předat do výroby…" }).click();
  await submit(page).waitFor({ timeout: 20_000 });
  await submit(page).click();
  await waitResult(page);
  await eventually(async () => expect(stage(j) === "ve_vyrobe", `předáno (${stage(j)})`), { timeout: 30_000 });
}
await T("25 · „Vrátit předání“ vrací do stavu před předáním: z menu postupu → Objednávka („Jen přesunout stav“ kroky ponechá); z akcí toku → Reklamace", async (ctx) => {
  const page = await ctx.newPage();
  await login(page, USERS.obchod);
  await handoffFromTech(page, UJ);
  await openJob(page, UJ, "?tab=vyroba");
  await page.getByRole("button", { name: "Výroba — další akce" }).click();
  await page.getByRole("menuitem", { name: "Vrátit předání do výroby" }).click();
  await submit(page).waitFor({ timeout: 20_000 });
  const t = await dialogText(page);
  expect(t.includes("zakázka do stavu před předáním: Objednávka"), `cíl Objednávka (${t.slice(0, 300)})`);
  const move = dialog(page).locator('[data-testid="handoff-plain-move"]');
  expect(norm(await move.innerText()) === "Jen přesunout stav na „Objednávka“ (kroky a objednávky zůstanou)", `odkaz (${norm(await move.innerText())})`);
  await shot(page, S("25-undo-to-objednavka"));
  await move.click();
  await eventually(async () => expect(stage(UJ) === "objednavka", `zpět Objednávka, ne Potvrzená (${stage(UJ)})`), { timeout: 30_000 });
  expect(ops(UJ).length === 2 && ops(UJ)[0].status === "probiha" && pos(UJ).length === 1 && pos(UJ)[0].status !== "zrusena",
    `kroky a objednávky zůstaly (${ops(UJ).map((x) => x.status).join(",")}; ${pos(UJ).map((x) => x.status).join(",")})`);
  // akce toku (⋯ Akce se stavem) — skutečné vrácení do Reklamace
  await handoffFromTech(page, RJ2);
  await openJob(page, RJ2);
  await page.locator('main section[aria-label="Zakázka"]').getByRole("button", { name: "Akce se stavem" }).first().click();
  await page.getByRole("menuitem", { name: "Vrátit předání do výroby" }).click();
  await submit(page).waitFor({ timeout: 20_000 });
  const t2 = await dialogText(page);
  expect(t2.includes("zakázka do stavu před předáním: Reklamace") && t2.includes("Jen přesunout stav na „Reklamace“"), `cíl Reklamace (${t2.slice(0, 300)})`);
  await submit(page).click();
  await eventually(async () => expect(stage(RJ2) === "reklamace", `skutečné vrácení do Reklamace (${stage(RJ2)})`), { timeout: 30_000 });
  expect(pos(RJ2)[0].status === "zrusena" && ops(RJ2).every((x) => x.status === "ceka"), "neodeslaná objednávka zrušena, kroky čekají");
});

// 26. Mobil 390 px, světlý + tmavý: karta kroku (celé jméno, role pod ním), Ukončit výrobu (bez červené chyby předem), Technologie po přesunu bez předání
const FJ = job("mobil ukončení", { status: "ve_vyrobe" });
sql(`insert into job_operations (job_id, kind, status, position, in_house, supplier_id, planned_end, started_at) values (${lit(FJ.id)}, 'vyroba', 'probiha', 0, false, ${lit(NOVAK)}, current_date + 9, now())`);
sql(`insert into job_operations (job_id, kind, status, position, in_house, supplier_id, planned_end) values (${lit(FJ.id)}, 'tepelne_zpracovani', 'ceka', 1, false, ${lit(TEPKAL)}, current_date + 14)`);
await T("26 · 390 px světlý + tmavý: karta kroku s celým jménem firmy, „Ukončit výrobu“ bez červené chyby předem, Technologie po přesunu bez předání jen s bannerem", async (ctx) => {
  const page = await ctx.newPage();
  await login(page, USERS.obchod);
  await openJob(page, FJ, "?tab=vyroba");
  const who = page.locator('main [role=tabpanel][data-state=active] [data-testid="operation-who"]').first();
  await who.waitFor({ timeout: 20_000 });
  const wt = norm(await who.innerText());
  expect(wt.includes(SUP_NAME[NOVAK]) && wt.includes("částečný dodavatel") && !wt.includes("(částečný dodavatel)"), `celé jméno + role pod ním (${wt})`);
  const cut = await who.locator("span.block").first().evaluate((el) => el.scrollWidth > el.clientWidth + 1);
  expect(!cut, "jméno firmy není oříznuté");
  await expectNoOverflow(page, "Technologie 390 px");
  await who.scrollIntoViewIfNeeded();
  await shot(page, S("26-step-card-light"));
  await setTheme(page, true);
  await shot(page, S("26-step-card-dark"));
  await setTheme(page, false);
  await page.getByRole("button", { name: "Výroba — další akce" }).click();
  await page.getByRole("menuitem", { name: "Ukončit výrobu…" }).click();
  await submit(page).waitFor({ timeout: 20_000 });
  const t = await dialogText(page);
  expect(t.includes("Proč končíš dřív? *") && !t.includes("Napiš, proč končíš"), `bez červené chyby, dokud uživatel nic neudělal (${t.slice(0, 500)})`);
  expect(await submit(page).isDisabled(), "bez důvodu nejde ukončit");
  await shot(page, S("26-finish-light"));
  await setTheme(page, true);
  await shot(page, S("26-finish-dark"));
  await setTheme(page, false);
  await dialog(page).getByLabel("Proč končíš dřív? *").fill("kalení odpadá");
  expect(!(await submit(page).isDisabled()), "s důvodem jde ukončit");
  await dialog(page).getByRole("button", { name: "Zrušit" }).click();
  // Technologie po přesunu bez předání (zakázka H ze scénáře 16, jinak vlastní)
  const plain = stage(H) === "ve_vyrobe" && ops(H).length === 0 ? H : job("bez předání mobil", { status: "ve_vyrobe" });
  await openJob(page, plain, "?tab=vyroba");
  const banner = page.locator('[data-testid="handoff-legacy"]');
  await banner.waitFor({ timeout: 20_000 });
  expect(await page.getByText("Jak se zakázka vyrobí?").count() === 0, "jen banner, bez prázdného stavu");
  await expectNoOverflow(page, "Technologie bez postupu 390 px");
  await banner.scrollIntoViewIfNeeded();
  await shot(page, S("26-technologie-plain-light"));
  await setTheme(page, true);
  await shot(page, S("26-technologie-plain-dark"));
  await setTheme(page, false);
}, { mobile: true });

// 27. Přehled → karta „Technologie" (majitel 30. 10.: „ukazuje strašně málo, strohé až zavádějící"): kroky v pořadí,
// kdo je dělá, stav kroku (čeká na nabídku / ve výrobě + objednávka), termín a jeden další krok na správné místo
const OVQ = job("přehled nacenění", { status: "naceneni" });
quote(OVQ, NOVAK, [4000, 4200], { lead: 21, kinds: "frezovani" });
quote(OVQ, TEPKAL, [null, undefined], { lead: 5, kinds: "tepelne_zpracovani" });
sql(`update order_items set supplier_note = 'pozor popsat na čele' where id = ${lit(OVQ.items[0])}`);
sql(`insert into job_operations (job_id, kind, status, position, in_house, supplier_id) values (${lit(OVQ.id)}, 'frezovani', 'ceka', 0, false, ${lit(NOVAK)})`);
sql(`insert into job_operations (job_id, kind, status, position, in_house) values (${lit(OVQ.id)}, 'tepelne_zpracovani', 'ceka', 1, false)`);
const OVP = job("přehled ve výrobě", { status: "ve_vyrobe" });
const OVP_PO = sql(`insert into purchase_orders (job_id, supplier_id, number, status, order_date, currency, total, sent_at)
  values (${lit(OVP.id)}, ${lit(NOVAK)}, ${lit(`OV-E2E14-${TAG}-27`)}, 'odeslana', current_date - 2, 'CZK', 12200, now() - interval '2 days') returning id`).split("\n")[0];
sql(`insert into job_operations (job_id, kind, status, position, in_house, supplier_id, planned_end, started_at, purchase_order_id, deadline_state)
  values (${lit(OVP.id)}, 'frezovani', 'probiha', 0, false, ${lit(NOVAK)}, current_date + 9, now() - interval '1 day', ${lit(OVP_PO)}, 'pozadovano')`);
sql(`insert into job_operations (job_id, kind, status, position, in_house, planned_end, ends_at_customer_date, deadline_state)
  values (${lit(OVP.id)}, 'brouseni', 'ceka', 1, true, current_date + 40, true, 'plan')`);
const techCard = (page) => page.locator('main [role=tabpanel][data-state=active] [data-testid="tech-card"]');
await T("27 · Přehled → karta Technologie: kroky v pořadí, kdo, stav (čeká na nabídku / ve výrobě + objednávka), termín, další krok vede na správné místo; zaměstnanec bez cen", async (ctx) => {
  const page = await ctx.newPage();
  await login(page, USERS.obchod);
  // nacenění: frézování u Nováka (nabídka s cenou), kalení — firma nevybraná, TepKal ještě neposlal cenu
  await openJob(page, OVQ);
  const card = techCard(page);
  await card.waitFor({ timeout: 20_000 });
  const steps = card.locator('[data-testid="tech-step"]');
  expect(await steps.count() === 2, `dva kroky (${await steps.count()})`);
  const s1 = norm(await steps.nth(0).innerText());
  const s2 = norm(await steps.nth(1).innerText());
  expect(s1.includes("1. Frézování") && s1.includes(SUP_NAME[NOVAK]) && s1.includes("Nabídka s cenou") && s1.includes("12 200 Kč"), `krok 1: firma, stav, cena z nabídky (${s1})`);
  expect(s2.includes("2. Tepelné zpracování") && s2.includes(`Poptáno: ${SUP_NAME[TEPKAL]}`) && s2.includes("Čeká na nabídku dodavatele") && !s2.includes("Nevybráno"),
    `krok 2: čeká na nabídku TepKal, ne „bez dodavatele“ (${s2})`);
  expect(norm(await card.innerText()).includes("Pro dodavatele: pozor popsat na čele"), "poznámka pro dodavatele u položky");
  expect(await page.locator('[data-testid="step-suppliers"]').count() === 1, "Dodavatel & peníze: firmy kroků místo „Vyrábíme sami“");
  await card.scrollIntoViewIfNeeded();
  await shot(page, S("27-tech-card-naceneni"));
  const nextBtn = card.locator('[data-testid="tech-next"]');
  expect(norm(await nextBtn.innerText()) === "Zadat cenu dodavatele", `další krok (${norm(await nextBtn.innerText())})`);
  await nextBtn.click();
  await eventually(async () => expect(await page.getByRole("tab", { name: /^Nákup & marže/, selected: true }).count() === 1, "→ záložka Nákup & marže"));
  // ve výrobě: běží u Nováka s odeslanou objednávkou, broušení u nás s konečným termínem → „Posunout dál…" otevře předání
  await openJob(page, OVP);
  await card.waitFor({ timeout: 20_000 });
  const v1 = norm(await card.locator('[data-testid="tech-step"]').nth(0).innerText());
  expect(v1.includes(SUP_NAME[NOVAK]) && v1.includes("Ve výrobě u dodavatele") && v1.includes(`OV-E2E14-${TAG}-27 · odeslána`) && /do \d+\. \d+\. · čeká na potvrzení/.test(v1),
    `krok 1: ve výrobě, objednávka, termín (${v1})`);
  const v2 = norm(await card.locator('[data-testid="tech-step"]').nth(1).innerText());
  expect(v2.includes("U nás") && /konečný \d+\. \d+\./.test(v2), `krok 2 u nás s konečným termínem (${v2})`);
  const vNext = card.locator('[data-testid="tech-next"]');
  expect(norm(await vNext.innerText()) === "Posunout dál…", `další krok ve výrobě (${norm(await vNext.innerText())})`);
  await vNext.click();
  await submit(page).waitFor({ timeout: 20_000 });
  await page.keyboard.press("Escape");
  // zaměstnanec: kroky a stavy ano, ceny ne
  const p2 = await ctx.newPage();
  await ctx.clearCookies();
  await login(p2, USERS.dilna);
  await openJob(p2, OVQ);
  const wcard = techCard(p2);
  await wcard.waitFor({ timeout: 20_000 });
  const wt = norm(await wcard.innerText());
  expect(wt.includes("1. Frézování") && wt.includes(SUP_NAME[NOVAK]) && !wt.includes("Kč"), `zaměstnanec: kroky bez cen (${wt.slice(0, 300)})`);
});
await T("27b · karta Technologie na mobilu 390 px: sbalené kroky, rozbalení podrobností, stránka nepřetéká", async (ctx) => {
  const page = await ctx.newPage();
  await login(page, USERS.obchod);
  await openJob(page, OVP);
  const card = techCard(page);
  await card.waitFor({ timeout: 20_000 });
  const details = card.locator('[data-testid="tech-step-details"]').first();
  expect(!(await details.isVisible()), "podrobnosti kroku sbalené");
  await card.locator('[data-testid="tech-group-toggle"]').first().click();
  await eventually(async () => expect(await details.isVisible(), "po rozbalení vidět objednávku / náklad"));
  await expectNoOverflow(page, "Přehled Technologie 390 px");
  await card.scrollIntoViewIfNeeded();
  await shot(page, S("27b-tech-card-mobile"));
}, { mobile: true });

const ok = summary(errors.filter((e) => !/HTTP 5\d\d .*\/_next\/|favicon/.test(e)));
if (!process.env.KEEP) await cleanup();
if (MODE_BEFORE) setMode(MODE_BEFORE);
await browser.close();
process.exit(ok ? 0 : 1);
