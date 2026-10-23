// E2E 08 · Nákup, audit a „kdo co posunul" (Balík 3).
// /purchasing: potvrzená objednávka → „Převzít zboží" → převzato 1/2 položek (chip Částečně dodaná,
// krok „Převzato 1/2 položek · autor", filtr Částečně dodané) → „Převzít zbytek" → Dodána · autor;
// zrušení jedním ťuknutím s důvodem (Zrušena — důvod · autor). /settings: limit schválení nabídek
// → /settings/audit „Změněno nastavení" s autorem, filtr osoba / entita / období. AI přehled:
// „Co kdo dnes posunul". Mobil 390 px bez přetékání. Foto dokladů (revize objednávky, DL dodavatele,
// náš DL, rozpor s nabídkou) ověřují integrační testy capture-flow / capture-batch-service.
// Vlastní data „E2E-08-" (zakázky i objednávky s vlastními čísly — čítače dokladů se nespotřebují).
import { BASE, USERS, launch, withContext, login, shot, sql, test, expect, summary } from "../lib.mjs";
import { lit, userIds, eventually, waitHydrated, expectNoOverflow, waitToast } from "../lib-quotes-docs-flow.mjs";

const browser = await launch();
const errors = [];
const ONLY = process.env.ONLY ? new RegExp(process.env.ONLY) : null;
const T = (name, fn, opts) => (ONLY && !ONLY.test(name) ? Promise.resolve() : test(name, () => withContext(browser, errors, fn, opts)));
const S = (name) => `purchasing-audit/${name}`;
const norm = (s) => String(s ?? "").replace(/[  ]/g, " ").replace(/\s+/g, " ").trim();
const PREFIX = "E2E-08-";
const TAG = Date.now().toString(36).toUpperCase();
const ID = userIds();
const ADMIN = sql(`select full_name from profiles where id = ${lit(ID.admin)}`);
const SHORT = (name) => { const p = name.trim().split(/\s+/); return p.length < 2 ? name : `${p[0][0]}. ${p.slice(1).join(" ")}`; };
const LIMIT_BEFORE = sql(`select coalesce(value, '') from integration_settings where key = 'quote_approval_limit'`);
const LIMIT_EXISTED = sql(`select count(*) from integration_settings where key = 'quote_approval_limit'`) === "1";

console.log(`08 · Nákup, audit, kdo co posunul (značka ${TAG})`);

function cleanup() {
  const ids = sql(`select id from orders where title like ${lit(`${PREFIX}%`)}`).split("\n").filter(Boolean);
  if (!ids.length) return 0;
  const inList = ids.map(lit).join(",");
  sql(`delete from job_operations where job_id in (${inList})`);
  sql(`delete from purchase_orders where job_id in (${inList})`);
  sql(`delete from orders where id in (${inList})`);
  sql(`delete from audit_log where entity_id in (${inList}) or diff->>'jobId' in (${inList})`);
  sql(`delete from audit_log where diff::text like '%OV-E2E08-%' or diff::text like '%Z-E2E08-%'`);
  return ids.length;
}
function restoreLimit() {
  if (LIMIT_EXISTED) sql(`update integration_settings set value = ${LIMIT_BEFORE ? lit(LIMIT_BEFORE) : "null"} where key = 'quote_approval_limit'`);
  else sql(`delete from integration_settings where key = 'quote_approval_limit'`);
}
const left = cleanup();
if (left) console.log(`  (úklid po minulém běhu: ${left} zakázek)`);

let seq = 0;
function job(title, status = "ve_vyrobe") {
  seq += 1;
  const number = `Z-E2E08-${TAG}-${seq}`;
  const id = sql(`insert into orders (number, title, status, source, owner_id, created_by, inquiry_date, order_date, priority)
    values (${lit(number)}, ${lit(`${PREFIX}${title} ${TAG}`)}, ${lit(status)}::job_stage, 'manual', ${lit(ID.obchod)}, ${lit(ID.obchod)}, current_date - 10, current_date - 5, 'stredni')
    returning id`).split("\n")[0];
  return { id, number };
}
function po(j, k, items, status = "potvrzena") {
  const number = `OV-E2E08-${TAG}-${k}`;
  const id = sql(`insert into purchase_orders (job_id, number, status, total, required_date, created_by)
    values (${lit(j.id)}, ${lit(number)}, ${lit(status)}::purchase_order_status, 1000, current_date + 14, ${lit(ID.admin)}) returning id`).split("\n")[0];
  items.forEach(([dwg, qty], i) => {
    sql(`insert into purchase_order_items (purchase_order_id, position, drawing_number, name, quantity, unit, unit_price)
      values (${lit(id)}, ${i}, ${lit(dwg)}, 'Díl', ${qty}, 'ks', 10)`);
  });
  return { id, number };
}

const JOB = job("převzetí");
const RECV = po(JOB, "R", [["E08-A", 10], ["E08-B", 4]]);
const CANCEL = po(JOB, "Z", [["E08-C", 1]], "odeslana");

async function purchasingPage(page, query = "") {
  await page.goto(`${BASE}/purchasing${query}`);
  await page.locator("main h1").filter({ hasText: "Objednávky dodavatelům" }).first().waitFor({ timeout: 30_000 });
  await waitHydrated(page, "main input[aria-label='Hledat objednávky']");
}
const poRow = (page, p) => page.locator("main li").filter({ has: page.locator("span.font-mono", { hasText: new RegExp(`^${p.number}$`) }) }).first();

// ═════════════════════════ NÁKUP ═════════════════════════
await T("/purchasing: Převzít zboží → 1/2 položek (chip, krok s autorem, filtr) → Převzít zbytek → Dodána · autor", async (context) => {
  const page = await context.newPage();
  await login(page, USERS.admin);
  await purchasingPage(page, `?q=${encodeURIComponent(RECV.number)}`);
  const r = () => poRow(page, RECV);
  await r().waitFor({ timeout: 10_000 });
  expect(norm(await r().innerText()).includes(`Vystavena · ${SHORT(ADMIN)}`), "krok Vystavena s autorem ze sloupce created_by");
  await r().getByRole("button", { name: "Převzít zboží" }).click();
  let dlg = page.getByRole("dialog");
  await dlg.getByLabel("Převzaté množství — E08-B").fill("1");
  await dlg.getByRole("button", { name: "Uložit převzetí" }).click();
  await waitToast(page, /Převzato 1\/2 položek/);
  await eventually(async () => expect(norm(await r().innerText()).includes("Částečně dodaná"), "chip Částečně dodaná"));
  const t = norm(await r().innerText());
  expect(t.includes("1/2 položek") && t.includes(`Převzato 1/2 položek · ${SHORT(ADMIN)}`), `průběh + kdo převzal (${t.slice(0, 240)})`);
  expect(sql(`select string_agg(received_quantity::text || ':' || coalesce(received_changed_by::text, '-'), ',' order by position) from purchase_order_items where purchase_order_id = ${lit(RECV.id)}`)
    === `10.000:${ID.admin},1.000:${ID.admin}`, "DB: převzaté množství a autor po položkách");
  await shot(page, S("01-partial"));

  await purchasingPage(page, "?stav=castecne");
  await eventually(async () => expect(await poRow(page, RECV).count() === 1, "filtr Částečně dodané ukazuje objednávku"));

  await purchasingPage(page, `?q=${encodeURIComponent(RECV.number)}`);
  await r().getByRole("button", { name: "Převzít zbytek" }).click();
  dlg = page.getByRole("dialog");
  await dlg.getByRole("button", { name: "Uložit převzetí" }).click();
  await waitToast(page, /převzata celá/);
  await eventually(() => expect(sql(`select status || '|' || delivered_by from purchase_orders where id = ${lit(RECV.id)}`) === `dodana|${ID.admin}`, "DB: dodaná, kdo"));
  await page.reload();
  await waitHydrated(page, "main input[aria-label='Hledat objednávky']");
  await eventually(async () => expect(norm(await r().innerText()).includes(`Dodána k nám · ${SHORT(ADMIN)}`), "krok Dodána k nám s autorem"));
});

await T("/purchasing: Zrušit objednávku jedním ťuknutím s důvodem → Zrušena — důvod · autor", async (context) => {
  const page = await context.newPage();
  await login(page, USERS.admin);
  await purchasingPage(page, `?stav=vse&q=${encodeURIComponent(CANCEL.number)}`);
  const r = () => poRow(page, CANCEL);
  await r().waitFor({ timeout: 10_000 });
  await r().getByRole("button", { name: `Další akce objednávky ${CANCEL.number}` }).click();
  await page.getByRole("menuitem", { name: "Zrušit objednávku…" }).click();
  const dlg = page.getByRole("dialog");
  await dlg.getByRole("radio", { name: "Objednáno jinde" }).click();
  await dlg.getByRole("button", { name: "Zrušit objednávku" }).click();
  await waitToast(page, /zrušena/);
  expect(sql(`select status || '|' || cancel_reason || '|' || cancelled_by from purchase_orders where id = ${lit(CANCEL.id)}`) === `zrusena|Objednáno jinde|${ID.admin}`, "DB: zrušená, důvod, kdo");
  await purchasingPage(page, `?stav=zrusena&q=${encodeURIComponent(CANCEL.number)}`);
  await eventually(async () => expect(norm(await r().innerText()).includes(`Zrušena — Objednáno jinde · ${SHORT(ADMIN)}`), "krok Zrušena — důvod · autor"));
});

// ═════════════════════════ AUDIT ═════════════════════════
await T("/settings: limit schválení nabídek → /settings/audit „Změněno nastavení“ s autorem; filtr osoba / entita / období", async (context) => {
  const page = await context.newPage();
  await login(page, USERS.admin);
  try {
    await page.goto(`${BASE}/settings`);
    await page.locator("main h1").filter({ hasText: "Nastavení" }).first().waitFor({ timeout: 30_000 });
    await waitHydrated(page, "main input[placeholder='nevyplněno = vypnuto']");
    const value = String(500_000 + (Date.now() % 1000));
    await page.locator("main input[placeholder='nevyplněno = vypnuto']").fill(value);
    await page.getByRole("button", { name: "Uložit limit" }).click();
    await waitToast(page, /Limit uložen/);
    expect(sql(`select value from integration_settings where key = 'quote_approval_limit'`) === value, "DB: limit uložen");

    await page.goto(`${BASE}/settings/audit?osoba=${ID.admin}&entita=integration_settings&obdobi=dnes`);
    await page.locator("main h1").filter({ hasText: "Audit" }).first().waitFor({ timeout: 30_000 });
    const first = page.locator('main ol[aria-label="Záznamy auditu"] > li').first();
    await first.waitFor({ timeout: 10_000 });
    const t = norm(await first.innerText());
    expect(t.includes("Změněno nastavení") && t.includes(`→ ${value}`) && t.includes(ADMIN), `záznam s autorem a změnou (${t.slice(0, 200)})`);
    expect(await page.getByLabel("Osoba").inputValue() === ID.admin, "filtr osoby z adresy");
    // jiná osoba → záznam zmizí
    await waitHydrated(page, "main select[aria-label='Osoba']");
    await page.getByLabel("Osoba").selectOption({ value: "system" });
    await eventually(async () => expect(!norm(await page.locator("main").innerText()).includes(`→ ${value}`), "filtr Systém záznam admina nezobrazí"));
    await shot(page, S("02-audit"));
  } finally {
    restoreLimit();
  }
});

await T("AI přehled: „Co kdo dnes posunul“ ukazuje autora dnešních posunů", async (context) => {
  sql(`update orders set status = 'dodano_k_nam' where id = ${lit(JOB.id)} and status <> 'dodano_k_nam'`);
  const page = await context.newPage();
  await login(page, USERS.admin);
  await page.goto(`${BASE}/dashboard`);
  const panel = page.locator('main section[aria-label="Co kdo dnes posunul"]').first();
  await panel.waitFor({ timeout: 30_000 });
  await page.waitForFunction(() => !document.querySelector('div[hidden][id^="S:"]'), null, { timeout: 30_000 });
  const t = norm(await panel.innerText());
  expect(/změn stavů dnes/.test(t), `počet dnešních změn (${t.slice(0, 160)})`);
  expect(t.includes(ADMIN) || t.includes("Automaticky / systém") || t.includes("✨ AI"), "skupina podle autora");
});

// ═════════════════════════ MOBIL ═════════════════════════
await T("mobil 390 px: Nákup a Audit bez přetékání, autor viditelný jako text", async (context) => {
  const page = await context.newPage();
  await login(page, USERS.admin);
  await purchasingPage(page, `?stav=vse&q=${encodeURIComponent(RECV.number)}`);
  await expectNoOverflow(page, "/purchasing");
  const stamp = poRow(page, RECV).locator("button[aria-label$='— podrobnosti']").first();
  expect(await stamp.isVisible(), "autor kroku je vidět i na mobilu");
  await page.goto(`${BASE}/settings/audit`);
  await page.locator("main h1").filter({ hasText: "Audit" }).first().waitFor({ timeout: 30_000 });
  await expectNoOverflow(page, "/settings/audit");
  await shot(page, S("03-mobile-audit"));
}, { mobile: true });

cleanup();
restoreLimit();
await browser.close();
process.exit(summary(errors) ? 0 : 1);
