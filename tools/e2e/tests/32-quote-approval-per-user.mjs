// E2E 32 · Schvalování nabídek PER UŽIVATEL (31. 10.) — „Schvalovat nabídky bude nutné jen u Šponera — ten je
// vystaví, ale nemůže je bez schválení odeslat. Volný a superadmin je budou moci posílat a vystavovat bez schvalování."
// Super admin ve Správě uživatelů vypne obchodníkovi A „Nabídky musí schválit super admin" (štítek v seznamu,
// atribuce, audit) → A vytvoří nabídku a rovnou ji odešle e-mailem s PDF (bez upozornění adminům); obchodník B
// (výchozí = se schvalováním) dál čeká — „Odeslat zákazníkovi" zamčené, REST pojistka; Můj účet podle nastavení;
// zapnutí zpět přepočte A neodeslanou nabídku na „Neschválená"; mobil 390 px.
// Vlastní účty e2e32-*@local.test a data „E2E32-<značka>" — úklid na začátku i na konci.
import { BASE, launch, withContext, login, shot, sql, clearMail, test, expect, summary, rest, restLogin, localEnv, recipients, fileAttachments } from "../lib.mjs";
import {
  lit, userIds, eventually, waitHydrated, expectNoOverflow, waitToast, waitMail, removeStorageFiles, createCustomer, createJob,
} from "../lib-quotes-docs-flow.mjs";

const browser = await launch();
const errors = [];
const ONLY = process.env.ONLY ? new RegExp(process.env.ONLY) : null;
const T = (name, fn, opts) => (ONLY && !ONLY.test(name) ? Promise.resolve() : test(name, () => withContext(browser, errors, fn, opts)));
const S = (name) => `quote-approval-per-user/${name}`;
const norm = (s) => String(s ?? "").replace(/[  ]/g, " ").replace(/\s+/g, " ").trim();
const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const TAG = Date.now().toString(36).toUpperCase();
const PREFIX = "E2E32-";
const ID = userIds();
const ADMIN = { email: "admin@local.test", password: "Admin123!" };
const PASSWORD = "E2e32-Heslo-1!";
const A = { email: `e2e32-a-${TAG.toLowerCase()}@local.test`, password: PASSWORD, name: `Adam Rychlý E2E32 ${TAG}` };
const B = { email: `e2e32-b-${TAG.toLowerCase()}@local.test`, password: PASSWORD, name: `Bohdan Pečlivý E2E32 ${TAG}` };
const CUST_EMAIL = `e2e32-${TAG.toLowerCase()}@local.test`;
const st = { quoteA: null, quoteB: null, quoteA2: null };

console.log(`32 · Schvalování nabídek per uživatel (značka ${TAG})`);

async function adminApi(method, p, body) {
  const env = localEnv();
  const r = await fetch(`${env.NEXT_PUBLIC_SUPABASE_URL}/auth/v1/admin/${p}`, {
    method,
    headers: { apikey: env.SUPABASE_SECRET_KEY, authorization: `Bearer ${env.SUPABASE_SECRET_KEY}`, "content-type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(`GoTrue ${method} ${p}: ${r.status} ${JSON.stringify(j).slice(0, 200)}`);
  return j;
}

// ── Úklid (i po minulém běhu) ────────────────────────────────
async function cleanup() {
  const ids = sql(`select id from orders where title like ${lit(`${PREFIX}%`)}`).split("\n").filter(Boolean);
  if (ids.length) {
    const inList = ids.map(lit).join(",");
    await removeStorageFiles(sql(`select storage_path from job_files where job_id in (${inList}) and storage_path is not null`).split("\n").filter(Boolean));
    sql(`delete from documents where order_id in (${inList})`);
    sql(`delete from emails where order_id in (${inList})`);
    sql(`delete from approval_queue where order_id in (${inList})`);
    sql(`update orders set quote_id = null, email_id = null where id in (${inList})`);
    sql(`update job_files set quote_id = null where job_id in (${inList})`);
    sql(`delete from job_files where job_id in (${inList})`);
    sql(`delete from quote_items where quote_id in (select id from quotes where job_id in (${inList}))`);
    sql(`delete from quotes where job_id in (${inList})`);
    sql(`delete from orders where id in (${inList})`);
  }
  sql(`delete from customers where name like ${lit(`${PREFIX}%`)}`);
  const users = sql(`select id from auth.users where email like 'e2e32-%@local.test'`).split("\n").filter(Boolean);
  for (const uid of users) {
    sql(`delete from audit_log where entity_id = ${lit(uid)}`);
    await adminApi("DELETE", `users/${uid}`).catch(() => sql(`delete from auth.users where id = ${lit(uid)}`));
  }
  return ids.length + users.length;
}
const left = await cleanup();
if (left) console.log(`  (úklid po minulém běhu: ${left} záznamů)`);

// ── Fixtury: dva obchodníci (výchozí = se schvalováním), zákazník, dvě zakázky v nacenění ──
async function makeUser(u) {
  const r = await adminApi("POST", "users", { email: u.email, password: u.password, email_confirm: true, user_metadata: { full_name: u.name } });
  const uid = r.id ?? r.user?.id;
  sql(`update profiles set role = 'obchodnik', full_name = ${lit(u.name)}, active = true, password_change_required = false where id = ${lit(uid)}`);
  return uid;
}
A.id = await makeUser(A);
B.id = await makeUser(B);
expect(sql(`select string_agg(quote_needs_approval::text, ',' order by full_name) from profiles where id in (${lit(A.id)}, ${lit(B.id)})`) === "true,true",
  "noví obchodníci: výchozí = nabídky schvaluje super admin");
await clearMail(CUST_EMAIL);
const CUST = createCustomer({ name: `${PREFIX}Kovo ${TAG} s.r.o.`, email: CUST_EMAIL, ownerId: A.id });
const items = (k) => [
  { drawing: `E32-${TAG}-${k}1`, name: "Upínka", material: "1.2379", qty: 4, price: null },
  { drawing: `E32-${TAG}-${k}2`, name: "Čep", material: "C45", qty: 10, price: null },
];
const JA = createJob({ title: `${PREFIX}A bez schvalování ${TAG}`, status: "naceneni", customerId: CUST.id, ownerId: A.id, reqDays: 25, contact: "Ing. Eva Testová", items: items("A") });
const JB = createJob({ title: `${PREFIX}B se schvalováním ${TAG}`, status: "naceneni", customerId: CUST.id, ownerId: B.id, reqDays: 25, contact: "Ing. Eva Testová", items: items("B") });

// ── Pomocníci UI ─────────────────────────────────────────────
async function openUsers(page) {
  await page.goto(`${BASE}/users`);
  await page.locator("main h1").filter({ hasText: "Uživatelé" }).first().waitFor({ timeout: 30_000 });
  await waitHydrated(page, 'main input[aria-label="Hledat uživatele"]');
}
const userRow = (page, name) => page.locator("main li").filter({ hasText: name }).first();
async function openJob(page, job, tab) {
  await page.goto(`${BASE}/orders/${job.id}${tab ? `?tab=${tab}` : ""}`);
  await page.locator('main section[aria-label="Zakázka"]').waitFor({ timeout: 30_000 });
  await waitHydrated(page, 'main section[aria-label="Zakázka"] button[aria-label^="Stav zakázky:"]');
}
const activePanel = (page) => page.locator("main [role=tabpanel][data-state=active]");
const quoteCard = (page, number) =>
  activePanel(page).locator("article").filter({ has: page.locator("span.font-mono", { hasText: new RegExp(`^${esc(number)}$`) }) });
/** Nová nabídka z položek zakázky přes editor; vrací { id, number, subtitle }. */
async function createQuoteUi(page, job, toast) {
  const panel = activePanel(page);
  await panel.getByRole("button", { name: "Vytvořit nabídku z 2 položek" }).click();
  const dlg = page.getByRole("dialog");
  await dlg.getByRole("heading", { name: "Nová nabídka" }).waitFor({ timeout: 10_000 });
  // podnadpis editoru (text o schválení) — celý text dialogu
  const subtitle = norm(await dlg.innerText());
  const table = dlg.locator("table");
  await table.locator('input[aria-label="Cena za MJ"]').nth(0).fill("1250");
  await table.locator('input[aria-label="Cena za MJ"]').nth(1).fill("90");
  await dlg.getByRole("button", { name: "Vytvořit nabídku", exact: true }).click();
  await waitToast(page, toast);
  await dlg.waitFor({ state: "hidden", timeout: 10_000 });
  const row = await eventually(() => {
    const r = sql(`select id || '|' || number from quotes where job_id = ${lit(job.id)} and not archived order by created_at desc limit 1`);
    expect(r, "nabídka v DB");
    return r.split("|");
  });
  return { id: row[0], number: row[1], subtitle };
}
const quoteDb = (id) => sql(`select state || '|' || admin_approval_required || '|' || approval_required || '|' || coalesce(approved_by::text, '-') || '|' || coalesce(sent_by::text, '-') from quotes where id = ${lit(id)}`);

// ═════════════════════════ TESTY ═════════════════════════

await T("1 · super admin: Správa uživatelů — u A vypne „Nabídky musí schválit super admin“ (štítek, atribuce, DB, audit); B a super admin beze změny", async (context) => {
  const page = await context.newPage();
  await login(page, ADMIN);
  await openUsers(page);
  await page.getByLabel("Hledat uživatele").fill("E2E32");
  const rowA = userRow(page, A.name);
  const rowB = userRow(page, B.name);
  await rowA.waitFor({ timeout: 10_000 });
  expect(norm(await rowA.innerText()).includes("schvaluje admin"), `A: štítek „schvaluje admin“ (${norm(await rowA.innerText()).slice(0, 200)})`);
  expect(norm(await rowB.innerText()).includes("schvaluje admin"), "B: štítek „schvaluje admin“");
  await shot(page, S("01-users-before"));

  // štítek otevře Upravit s přepínačem
  await rowA.locator('button[data-quote-approval="on"]').click();
  const dlg = page.getByRole("dialog");
  await dlg.getByRole("heading", { name: "Upravit uživatele" }).waitFor({ timeout: 10_000 });
  const sw = dlg.getByRole("switch", { name: "Nabídky musí schválit super admin" });
  expect((await sw.getAttribute("aria-checked")) === "true", "přepínač zapnutý (výchozí)");
  expect(norm(await dlg.innerText()).includes("odešle až po schválení super adminem"), "popis: odešle až po schválení");
  await sw.click();
  expect((await sw.getAttribute("aria-checked")) === "false", "přepínač vypnutý");
  expect(norm(await dlg.innerText()).includes("vystavuje i odesílá zákazníkovi sám, bez schválení"), "popis: bez schválení");
  expect((await sw.getAttribute("data-state")) === "unchecked", "přepínač vizuálně vypnutý (data-state)");
  await page.waitForTimeout(300);   // dojezd animace přepínače na snímku
  await shot(page, S("02-edit-toggle-off"));
  await dlg.getByRole("button", { name: "Uložit změny" }).click();
  await waitToast(page, new RegExp(`Uživatel ${esc(A.name)} uložen`));
  await dlg.waitFor({ state: "hidden", timeout: 10_000 });
  await eventually(async () => expect(norm(await rowA.innerText()).includes("nabídky bez schválení"), "A: štítek „nabídky bez schválení“"));
  expect(norm(await rowB.innerText()).includes("schvaluje admin"), "B pořád „schvaluje admin“");

  const db = sql(`select quote_needs_approval || '|' || coalesce(quote_approval_changed_by::text, '-') || '|' || (quote_approval_changed_at is not null) from profiles where id = ${lit(A.id)}`);
  expect(db === `false|${ID.admin}|true`, `DB: A bez schvalování, změnil super admin (${db})`);
  expect(sql(`select quote_needs_approval from profiles where id = ${lit(B.id)}`) === "t", "DB: B dál se schvalováním");
  const audit = sql(`select actor_id || '|' || (diff->>'quote_needs_approval') from audit_log where action = 'user_updated' and entity_id = ${lit(A.id)} order by created_at desc limit 1`);
  expect(audit === `${ID.admin}|false`, `audit: user_updated quote_needs_approval=false, autor super admin (${audit})`);

  // znovu otevřený dialog ukazuje uložený stav + kdo ho změnil
  await rowA.getByRole("button", { name: `Akce pro ${A.name}` }).click();
  await page.getByRole("menuitem", { name: "Upravit" }).click();
  await dlg.getByRole("heading", { name: "Upravit uživatele" }).waitFor({ timeout: 10_000 });
  expect((await dlg.getByRole("switch", { name: "Nabídky musí schválit super admin" }).getAttribute("aria-checked")) === "false", "uložený stav: vypnuto");
  expect(norm(await dlg.innerText()).includes("Naposledy změnil(a) Super Admin"), `atribuce v dialogu (${norm(await dlg.innerText()).slice(-200)})`);
  await dlg.getByRole("button", { name: "Zrušit" }).click();

  // super admin: štítek nemá, přepínač zamčený
  await page.getByLabel("Hledat uživatele").fill("Super Admin");
  const rowAdmin = userRow(page, "admin@local.test");
  await rowAdmin.waitFor({ timeout: 10_000 });
  expect(await rowAdmin.locator("[data-quote-approval]").count() === 0, "super admin bez štítku schvalování");
  await rowAdmin.getByRole("button", { name: /^Akce pro / }).click();
  await page.getByRole("menuitem", { name: "Upravit" }).click();
  await dlg.getByRole("heading", { name: "Upravit uživatele" }).waitFor({ timeout: 10_000 });
  const adminSw = dlg.getByRole("switch", { name: "Nabídky musí schválit super admin" });
  expect(await adminSw.isDisabled() && (await adminSw.getAttribute("aria-checked")) === "false", "super admin: přepínač vypnutý a zamčený");
  expect(norm(await dlg.innerText()).includes("Super admin schválení nepotřebuje"), "super admin: vysvětlení");
  await dlg.getByRole("button", { name: "Zrušit" }).click();
});

await T("2 · A (bez schvalování): nová nabídka rovnou k odeslání → Odeslat zákazníkovi → e-mail s PDF, stav Odeslaná, žádné upozornění adminům", async (context) => {
  const page = await context.newPage();
  await login(page, A);
  await openJob(page, JA, "nabidky");
  const q = await createQuoteUi(page, JA, /vytvořena — teď ji odešli/);
  st.quoteA = q;
  expect(q.subtitle.includes("pak ji rovnou odešleš (bez schválení)"), `editor: text bez schválení (${q.subtitle.slice(0, 200)})`);
  expect(quoteDb(q.id) === "rozpracovana|false|false|-|-", `DB: rozpracovaná bez schvalování (${quoteDb(q.id)})`);
  const ev = sql(`select message from job_events where job_id = ${lit(JA.id)} and type = 'quote' order by created_at desc limit 1`);
  expect(ev === `Nabídka ${q.number} vytvořena`, `historie bez „čeká na schválení“ (${ev})`);

  const card = quoteCard(page, q.number);
  await card.waitFor({ timeout: 10_000 });
  const t = norm(await card.innerText());
  expect(!t.includes("Neschválená") && !t.includes("Odeslat půjde po schválení"), `karta bez zámku schválení (${t.slice(0, 240)})`);
  const send = card.getByRole("button", { name: "Odeslat zákazníkovi" });
  expect(await send.isEnabled(), "Odeslat zákazníkovi povolené");
  await shot(page, S("03-a-quote-ready"));
  await send.click();
  const dlg = page.getByRole("dialog");
  await dlg.getByRole("heading", { name: `Odeslat nabídku ${q.number} zákazníkovi` }).waitFor({ timeout: 10_000 });
  await dlg.locator('a[href^="/api/jobs/files/"]').waitFor({ timeout: 30_000 });
  expect((await recipients(dlg, "Komu")) === CUST_EMAIL, `Komu = e-mail zákazníka (${await recipients(dlg, "Komu")})`);
  const t0 = new Date().toISOString();
  await dlg.getByRole("button", { name: "Odeslat zákazníkovi" }).click();
  await waitToast(page, new RegExp(`Nabídka ${esc(q.number)} odeslána na`), 30_000);
  await dlg.waitFor({ state: "hidden", timeout: 10_000 });
  const mail = await waitMail(CUST_EMAIL, (m) => m.subject.includes(q.number) && m.receivedAt > t0);
  expect(mail, "zákazník dostal e-mail s nabídkou");
  const files = fileAttachments(mail);
  expect(files.length === 1 && files[0].contentType === "application/pdf", `příloha PDF (${JSON.stringify(mail.attachments)})`);
  expect(quoteDb(q.id) === `odeslana|false|false|-|${A.id}`, `DB: odeslaná autorem A bez schválení (${quoteDb(q.id)})`);
  expect(sql(`select count(*) from audit_log where action = 'quote_approval_notice' and diff->>'quoteId' = ${lit(q.id)}`) === "0",
    "super adminům nic neodešlo (nabídka schválení nepotřebuje)");
  await shot(page, S("04-a-quote-sent"));
});

await T("3 · B (se schvalováním): nabídka Neschválená, Odeslat zákazníkovi zamčené s vysvětlením; REST pojistka; super admin ji vidí ke schválení", async (context) => {
  const page = await context.newPage();
  await login(page, B);
  await openJob(page, JB, "nabidky");
  const q = await createQuoteUi(page, JB, /vytvořena — čeká na schválení super admina/);
  st.quoteB = q;
  expect(q.subtitle.includes("před odesláním ji schválí super admin"), `editor: text se schválením (${q.subtitle.slice(0, 200)})`);
  expect(quoteDb(q.id) === "ke_schvaleni|true|true|-|-", `DB: Neschválená (${quoteDb(q.id)})`);
  const card = quoteCard(page, q.number);
  await card.waitFor({ timeout: 10_000 });
  const t = norm(await card.innerText());
  expect(t.includes("Neschválená") && t.includes("Odeslat půjde po schválení super adminem."), `karta: Neschválená + vysvětlení (${t.slice(0, 240)})`);
  expect(await card.getByRole("button", { name: "Odeslat zákazníkovi" }).isDisabled(), "Odeslat zákazníkovi zamčené");
  await shot(page, S("05-b-quote-pending"));
  // obejití UI přes REST nepomůže
  const token = await restLogin(B);
  const r = await rest("PATCH", `quotes?id=eq.${q.id}`, { token, body: { status: "odeslano" } });
  expect(r.status >= 400 && JSON.stringify(r.body).includes("Nabídka čeká na schválení"), `REST odeslání neschválené: ${r.status} ${JSON.stringify(r.body).slice(0, 160)}`);
  expect(quoteDb(q.id).startsWith("ke_schvaleni|"), "stav beze změny");

  // super admin ji má v Nabídkách ke schválení
  await context.clearCookies();
  const p2 = await context.newPage();
  await login(p2, ADMIN);
  await openJob(p2, JB, "nabidky");
  const adminCard = quoteCard(p2, q.number);
  await adminCard.waitFor({ timeout: 10_000 });
  expect(await adminCard.getByRole("button", { name: "Schválit", exact: true }).count() === 1, "super admin má „Schválit“");
});

await T("4 · Můj účet: A „tvoje schválení nepotřebují“, B „tvoje musí schválit super admin“", async (context) => {
  for (const [u, re] of [[A, /Nabídky: tvoje schválení super adminem nepotřebují/], [B, /Nabídky: tvoje musí před odesláním schválit super admin/]]) {
    const page = await context.newPage();
    await login(page, u);
    await page.goto(`${BASE}/account`);
    await page.locator("main").getByText(/Co vidím|Co vidíš/).first().waitFor({ timeout: 30_000 }).catch(() => undefined);
    const text = norm(await page.locator("main").innerText());
    expect(re.test(text), `${u.name}: ${re} (${(text.match(/Nabídky[^.]*\./) ?? [""])[0]})`);
    await page.close();
    await context.clearCookies();
  }
});

await T("5 · super admin A schvalování zase zapne → jeho neodeslaná nabídka je Neschválená (zpráva o přepočtu); odeslaná beze změny", async (context) => {
  expect(st.quoteA, "test 2 odeslal nabídku A");
  // druhá (neodeslaná) nabídka A — server s autorem A, bez schvalování = rozpracovaná
  const n2 = `E2E32-${TAG}-A2`;
  st.quoteA2 = sql(`insert into quotes (number, job_id, customer_id, status, total, currency, valid_until, revision, created_by, owner_id, title)
    values (${lit(n2)}, ${lit(JA.id)}, ${lit(CUST.id)}, 'ke_schvaleni', 1000, 'CZK', app_today() + 30, 2, ${lit(A.id)}, ${lit(A.id)}, ${lit(JA.title)}) returning id`).split("\n")[0];
  expect(quoteDb(st.quoteA2) === "rozpracovana|false|false|-|-", `A2 rozpracovaná (${quoteDb(st.quoteA2)})`);
  const page = await context.newPage();
  await login(page, ADMIN);
  await openUsers(page);
  await page.getByLabel("Hledat uživatele").fill("E2E32");
  const rowA = userRow(page, A.name);
  await rowA.locator('button[data-quote-approval="off"]').click();
  const dlg = page.getByRole("dialog");
  await dlg.getByRole("heading", { name: "Upravit uživatele" }).waitFor({ timeout: 10_000 });
  await dlg.getByRole("switch", { name: "Nabídky musí schválit super admin" }).click();
  await dlg.getByRole("button", { name: "Uložit změny" }).click();
  const toast = await waitToast(page, new RegExp(`Uživatel ${esc(A.name)} uložen`));
  expect(toast.includes("1 nabídka teď čeká na schválení super admina"), `zpráva o přepočtu (${toast})`);
  await eventually(async () => expect(norm(await rowA.innerText()).includes("schvaluje admin"), "A: štítek zpět „schvaluje admin“"));
  expect(quoteDb(st.quoteA2) === "ke_schvaleni|true|true|-|-", `A2 teď Neschválená (${quoteDb(st.quoteA2)})`);
  expect(quoteDb(st.quoteA.id).startsWith("odeslana|"), `odeslaná nabídka A beze změny (${quoteDb(st.quoteA.id)})`);
  expect(sql(`select state_changed_by from quotes where id = ${lit(st.quoteA2)}`) === ID.admin, "změnu stavu nese super admin");
});

await T("mobil 390 px: Správa uživatelů — štítek a přepínač v Upravit bez přetékání", async (context) => {
  const page = await context.newPage();
  await login(page, ADMIN);
  await openUsers(page);
  await page.getByLabel("Hledat uživatele").fill("E2E32");
  const rowB = userRow(page, B.name);
  await rowB.waitFor({ timeout: 10_000 });
  await expectNoOverflow(page, "/users mobil");
  await rowB.locator('button[data-quote-approval="on"]').click();
  const dlg = page.getByRole("dialog");
  await dlg.getByRole("heading", { name: "Upravit uživatele" }).waitFor({ timeout: 10_000 });
  const sw = dlg.getByRole("switch", { name: "Nabídky musí schválit super admin" });
  await sw.scrollIntoViewIfNeeded();
  expect(await sw.isVisible(), "přepínač vidět na mobilu");
  await expectNoOverflow(page, "Upravit uživatele mobil");
  await shot(page, S("06-mobile-edit"));
  await dlg.getByRole("button", { name: "Zrušit" }).click();
}, { mobile: true });

// ── Úklid ────────────────────────────────────────────────────
await test("úklid vlastních dat (zakázky, nabídky, účty)", async () => {
  await cleanup();
  expect(sql(`select count(*) from orders where title like ${lit(`${PREFIX}%`)}`) === "0", "zakázky smazané");
  expect(sql(`select count(*) from auth.users where email like 'e2e32-%@local.test'`) === "0", "účty smazané");
});

await browser.close();
process.exit(summary(errors) ? 0 : 1);
