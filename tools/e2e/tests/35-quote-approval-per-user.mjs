// E2E 35 · Schvalování nabídek PER UŽIVATEL (31. 10.) — „Schvalovat nabídky bude nutné jen u Šponera — ten je
// vystaví, ale nemůže je bez schválení odeslat. Volný a superadmin je budou moci posílat a vystavovat bez schvalování."
// Super admin ve Správě uživatelů vypne obchodníkovi A „Nabídky musí schválit super admin" (štítek v seznamu,
// atribuce, audit) a zapne mu „Smí schvalovat nabídky ostatních" (31. 10.: „Volný může schvalovat nabídky
// Šponera") → A vytvoří nabídku, vystaví PDF (nic neodejde — zůstává rozpracovaná) a odešle ji až tlačítkem
// „Odeslat zákazníkovi" (bez upozornění adminům); obchodník B (výchozí = se schvalováním) dál čeká —
// „Odeslat zákazníkovi" zamčené, REST pojistka; A dostane upozornění, vidí ji v Nabídkách → Ke schválení,
// schválí ji; B ji pak odešle zákazníkovi; Můj účet podle nastavení; zapnutí schvalování zpět přepočte
// A neodeslanou nabídku na „Neschválená" a tu si A sám neschválí (UI, REST); mobil 390 px.
// Vlastní účty e2e32-*@local.test a data „E2E32-<značka>" — úklid na začátku i na konci.
import { BASE, launch, withContext, login, shot, sql, clearMail, test, expect, summary, rest, restLogin, localEnv, recipients, fileAttachments } from "../lib.mjs";
import {
  lit, userIds, eventually, waitHydrated, expectNoOverflow, waitToast, waitMail, mailsTo, removeStorageFiles, createCustomer, createJob,
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
// A = „Volný" (bez schvalování, smí schvalovat ostatní), B = „Šponer" (se schvalováním, neschvaluje)
const A = { email: `e2e32-a-${TAG.toLowerCase()}@local.test`, password: PASSWORD, name: `Adam Rychlý E2E32 ${TAG}`, short: `A. Rychlý E2E32 ${TAG}` };
const B = { email: `e2e32-b-${TAG.toLowerCase()}@local.test`, password: PASSWORD, name: `Bohdan Pečlivý E2E32 ${TAG}`, short: `B. Pečlivý E2E32 ${TAG}` };
const CUST_EMAIL = `e2e32-${TAG.toLowerCase()}@local.test`;
const st = { quoteA: null, quoteB: null, quoteA2: null };

console.log(`35 · Schvalování nabídek per uživatel (značka ${TAG})`);

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
    // upozornění „Ke schválení" (i schvalovatelům mimo test, např. Volnému) k našim nabídkám
    sql(`delete from audit_log where action = 'quote_approval_notice' and diff->>'quoteId' in (select id::text from quotes where job_id in (${inList}))`);
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
  expect(norm(await rowA.innerText()).includes("nabídky se schválením"), `A: štítek „nabídky se schválením“ (${norm(await rowA.innerText()).slice(0, 200)})`);
  expect(norm(await rowB.innerText()).includes("nabídky se schválením"), "B: štítek „nabídky se schválením“");
  expect(await rowA.locator("[data-quote-approver]").count() === 0 && await rowB.locator("[data-quote-approver]").count() === 0,
    "nikdo z nich zatím neschvaluje nabídky ostatních");
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
  // 31. 10.: druhý, nezávislý přepínač — A smí schvalovat nabídky ostatních
  const apSw = dlg.getByRole("switch", { name: "Smí schvalovat nabídky ostatních" });
  expect((await apSw.getAttribute("aria-checked")) === "false", "„Smí schvalovat nabídky ostatních“ výchozí vypnuto");
  expect(norm(await dlg.innerText()).includes("Nabídky ostatních neschvaluje."), "popis: neschvaluje");
  await apSw.click();
  expect((await apSw.getAttribute("aria-checked")) === "true", "„Smí schvalovat“ zapnuto");
  expect(norm(await dlg.innerText()).includes("vlastní ne"), "popis: schvaluje nabídky kolegů — vlastní ne");
  expect((await sw.getAttribute("aria-checked")) === "false", "přepínače jsou nezávislé (schvalování vlastních zůstává vypnuté)");
  await page.waitForTimeout(300);   // dojezd animace přepínače na snímku
  await shot(page, S("02-edit-toggle-off"));
  await dlg.getByRole("button", { name: "Uložit změny" }).click();
  await waitToast(page, new RegExp(`Uživatel ${esc(A.name)} uložen`));
  await dlg.waitFor({ state: "hidden", timeout: 10_000 });
  await eventually(async () => expect(norm(await rowA.innerText()).includes("nabídky bez schválení"), "A: štítek „nabídky bez schválení“"));
  await eventually(async () => expect(norm(await rowA.innerText()).includes("schvaluje nabídky"), "A: štítek „schvaluje nabídky“"));
  expect(norm(await rowB.innerText()).includes("nabídky se schválením"), "B pořád „nabídky se schválením“");
  expect(await rowB.locator("[data-quote-approver]").count() === 0, "B neschvaluje");

  const db = sql(`select quote_needs_approval || '|' || coalesce(quote_approval_changed_by::text, '-') || '|' || (quote_approval_changed_at is not null) from profiles where id = ${lit(A.id)}`);
  expect(db === `false|${ID.admin}|true`, `DB: A bez schvalování, změnil super admin (${db})`);
  const dbAp = sql(`select can_approve_quotes || '|' || coalesce(quote_approver_changed_by::text, '-') || '|' || (quote_approver_changed_at is not null) from profiles where id = ${lit(A.id)}`);
  expect(dbAp === `true|${ID.admin}|true`, `DB: A smí schvalovat, změnil super admin (${dbAp})`);
  expect(sql(`select quote_needs_approval || '|' || can_approve_quotes from profiles where id = ${lit(B.id)}`) === "true|false", "DB: B dál se schvalováním, neschvaluje");
  const audit = sql(`select actor_id || '|' || (diff->>'quote_needs_approval') || '|' || (diff->>'can_approve_quotes') from audit_log where action = 'user_updated' and entity_id = ${lit(A.id)} order by created_at desc limit 1`);
  expect(audit === `${ID.admin}|false|true`, `audit: user_updated quote_needs_approval=false, can_approve_quotes=true, autor super admin (${audit})`);

  // znovu otevřený dialog ukazuje uložený stav + kdo ho změnil
  await rowA.getByRole("button", { name: `Akce pro ${A.name}` }).click();
  await page.getByRole("menuitem", { name: "Upravit" }).click();
  await dlg.getByRole("heading", { name: "Upravit uživatele" }).waitFor({ timeout: 10_000 });
  expect((await dlg.getByRole("switch", { name: "Nabídky musí schválit super admin" }).getAttribute("aria-checked")) === "false", "uložený stav: vypnuto");
  expect((await dlg.getByRole("switch", { name: "Smí schvalovat nabídky ostatních" }).getAttribute("aria-checked")) === "true", "uložený stav: smí schvalovat");
  expect((norm(await dlg.innerText()).match(/Naposledy změnil\(a\) Super Admin/g) ?? []).length === 2, `atribuce u obou přepínačů (${norm(await dlg.innerText()).slice(-260)})`);
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
  const adminAp = dlg.getByRole("switch", { name: "Smí schvalovat nabídky ostatních" });
  expect(await adminAp.isDisabled() && (await adminAp.getAttribute("aria-checked")) === "true", "super admin: schvaluje vždy (zapnuto, zamčeno)");
  await dlg.getByRole("button", { name: "Zrušit" }).click();
});

await T("2 · A (bez schvalování): nová nabídka → vystavit PDF (nic neodejde, zůstává rozpracovaná) → až „Odeslat zákazníkovi“ pošle e-mail s PDF; žádné upozornění adminům", async (context) => {
  const page = await context.newPage();
  await login(page, A);
  await openJob(page, JA, "nabidky");
  const q = await createQuoteUi(page, JA, /vytvořena — teď ji odešli/);
  st.quoteA = q;
  expect(q.subtitle.includes("schválení nepotřebuje, zákazníkovi ji pošleš tlačítkem Odeslat zákazníkovi"), `editor: text bez schválení (${q.subtitle.slice(0, 200)})`);
  expect(quoteDb(q.id) === "rozpracovana|false|false|-|-", `DB: rozpracovaná bez schvalování (${quoteDb(q.id)})`);
  const ev = sql(`select message from job_events where job_id = ${lit(JA.id)} and type = 'quote' order by created_at desc limit 1`);
  expect(ev === `Nabídka ${q.number} vytvořena`, `historie bez „čeká na schválení“ (${ev})`);

  const card = quoteCard(page, q.number);
  await card.waitFor({ timeout: 10_000 });
  let t = norm(await card.innerText());
  expect(!t.includes("Neschválená") && !t.includes("Odeslat půjde po schválení"), `karta bez zámku schválení (${t.slice(0, 240)})`);
  expect(await card.getByRole("button", { name: "Schválit", exact: true }).count() === 0, "vlastní nabídku nikdo neschvaluje (nepotřebuje to)");

  // „Vystavit“ = jen PDF do Dokumentů (Doklady ▾ → Nabídka) — nic se neodešle, nabídka dál rozpracovaná
  await page.getByRole("button", { name: "Doklady (PDF)" }).first().click();
  await page.getByRole("menuitem", { name: /^Nabídka/ }).click();
  await waitToast(page, /Nabídka .*je hotový a uložený v Dokumentech/);
  await eventually(() => expect(sql(`select count(*) from job_files where quote_id = ${lit(q.id)} and kind = 'nabidka' and not archived`) === "1", "PDF nabídky vystavené"));
  await page.waitForTimeout(1500);   // případné (chybné) automatické odeslání by mělo čas proběhnout
  expect(quoteDb(q.id) === "rozpracovana|false|false|-|-", `po vystavení pořád rozpracovaná, neodeslaná (${quoteDb(q.id)})`);
  expect(sql(`select coalesce(sent_at::text, '-') from quotes where id = ${lit(q.id)}`) === "-", "sent_at prázdné");
  expect(!(await mailsTo(CUST_EMAIL)).some((m) => m.subject.includes(q.number)), "zákazníkovi nic neodešlo");
  await page.reload();
  await card.waitFor({ timeout: 15_000 });
  t = norm(await card.innerText());
  expect(t.includes("Rozpracovaná") && !t.includes("Odesláno"), `karta: Rozpracovaná, neodeslaná (${t.slice(0, 200)})`);
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
  // 31. 10.: kdo schválí — z dat (A smí schvalovat) + super admin, např. „(A. Rychlý E2E32 … nebo super admin)“
  const q = await createQuoteUi(page, JB, new RegExp(`vytvořena — čeká na schválení \\([^)]*${esc(A.short)}[^)]*super admin\\)`));
  st.quoteB = q;
  expect(new RegExp(`před odesláním ji schválí (.*, )?${esc(A.short)}(, .*)? nebo super admin`).test(q.subtitle), `editor: text se schválením (${q.subtitle.slice(0, 200)})`);
  expect(quoteDb(q.id) === "ke_schvaleni|true|true|-|-", `DB: Neschválená (${quoteDb(q.id)})`);
  const card = quoteCard(page, q.number);
  await card.waitFor({ timeout: 10_000 });
  const t = norm(await card.innerText());
  expect(t.includes("Neschválená") && new RegExp(`Odeslat půjde po schválení \\([^)]*${esc(A.short)}[^)]* nebo super admin\\)\\.`).test(t),
    `karta: Neschválená + kdo schválí (${t.slice(0, 300)})`);
  expect(new RegExp(`čeká na schválení \\([^)]*${esc(A.short)}`).test(t), "karta: Schválil — čeká na schválení (A …)");
  expect(await card.getByRole("button", { name: "Odeslat zákazníkovi" }).isDisabled(), "Odeslat zákazníkovi zamčené");
  expect(await card.getByRole("button", { name: "Schválit", exact: true }).count() === 0, "B si nabídku neschválí");
  await shot(page, S("05-b-quote-pending"));
  // obejití UI přes REST nepomůže
  const token = await restLogin(B);
  const r = await rest("PATCH", `quotes?id=eq.${q.id}`, { token, body: { status: "odeslano" } });
  expect(r.status >= 400 && JSON.stringify(r.body).includes("Nabídka čeká na schválení"), `REST odeslání neschválené: ${r.status} ${JSON.stringify(r.body).slice(0, 160)}`);
  // ani schválit sám sebe přes REST
  const self = await rest("PATCH", `quotes?id=eq.${q.id}`, { token, body: { approved_by: B.id } });
  expect(self.status >= 400 && JSON.stringify(self.body).includes("Nabídku schvaluje jen super admin nebo kolega s právem schvalovat nabídky"),
    `REST schválení sebou: ${self.status} ${JSON.stringify(self.body).slice(0, 160)}`);
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

await T("3b · A (schvalovatel) dostal upozornění, vidí nabídku B v Nabídkách → Ke schválení, schválí ji; B ji pak odešle zákazníkovi (e-mail s PDF); razítko „Schválil A“", async (context) => {
  expect(st.quoteB, "test 3 vytvořil nabídku B");
  const q = st.quoteB;
  // upozornění „Ke schválení" i schvalovateli A (e-mail + audit)
  const notice = await waitMail(A.email, (m) => String(m.subject).startsWith("Ke schválení:") && String(m.subject).includes(q.number), 20_000);
  expect(notice, "A dostal e-mail „Ke schválení: …“");
  expect(sql(`select count(*) from audit_log where action = 'quote_approval_notice' and entity_id = ${lit(A.id)} and diff->>'quoteId' = ${lit(q.id)}`) === "1",
    "audit upozornění schvalovateli");
  expect(sql(`select count(*) from audit_log where action = 'quote_approval_notice' and entity_id = ${lit(B.id)}`) === "0", "autor B upozornění nedostal");

  const page = await context.newPage();
  await login(page, A);
  await page.goto(`${BASE}/quotes`);
  const section = page.locator("main #ke-schvaleni");
  await section.waitFor({ timeout: 30_000 });
  await waitHydrated(page, `main #ke-schvaleni [data-pending-quote="${q.id}"] button`);
  const row = section.locator(`[data-pending-quote="${q.id}"]`);
  expect(await row.count() === 1, "nabídka B je v „Ke schválení“");
  expect(norm(await section.innerText()).includes("Nabídky kolegů, které potřebují schválení."), "popis sekce schvalovatele");
  expect(await section.locator(`[data-pending-quote="${st.quoteA.id}"]`).count() === 0, "vlastní nabídka A tam není");
  expect(norm(await row.innerText()).includes(`připravil(a) ${B.name}`), "řádek: připravil(a) B");
  await shot(page, S("05b-a-approval-queue"));
  await row.getByRole("button", { name: "Schválit", exact: true }).click();
  await waitToast(page, new RegExp(`Nabídka ${esc(q.number)} schválena — ${esc(B.name)} ji teď může odeslat`));
  await eventually(() => expect(quoteDb(q.id) === `schvalena|true|true|${A.id}|-`, `DB: schválil A (${quoteDb(q.id)})`));
  expect(sql(`select approved_by from orders where id = ${lit(JB.id)}`) === A.id, "zakázka: Schválil = A");
  expect(sql(`select (approved_snapshot_sha is not null) from quotes where id = ${lit(q.id)}`) === "t", "otisk schváleného obsahu");
  await page.close();

  // B: karta „Schválil A“, Odeslat zákazníkovi → e-mail s PDF
  await context.clearCookies();
  const pb = await context.newPage();
  await login(pb, B);
  await openJob(pb, JB, "nabidky");
  const card = quoteCard(pb, q.number);
  await card.waitFor({ timeout: 10_000 });
  const t = norm(await card.innerText());
  expect(t.includes("Schválená") && t.includes(A.name), `karta: Schválená, Schválil A (${t.slice(0, 300)})`);
  expect(t.includes(`Schválil ${A.short}`), `razítko „Schválil ${A.short}“ (${t.slice(0, 300)})`);
  const send = card.getByRole("button", { name: "Odeslat zákazníkovi" });
  expect(await send.isEnabled(), "B: Odeslat zákazníkovi povolené");
  await send.click();
  const dlg = pb.getByRole("dialog");
  await dlg.getByRole("heading", { name: `Odeslat nabídku ${q.number} zákazníkovi` }).waitFor({ timeout: 10_000 });
  await dlg.locator('a[href^="/api/jobs/files/"]').waitFor({ timeout: 30_000 });
  const t0 = new Date().toISOString();
  await dlg.getByRole("button", { name: "Odeslat zákazníkovi" }).click();
  await waitToast(pb, new RegExp(`Nabídka ${esc(q.number)} odeslána na`), 30_000);
  const mail = await waitMail(CUST_EMAIL, (m) => m.subject.includes(q.number) && m.receivedAt > t0);
  expect(mail, "zákazník dostal nabídku B");
  const files = fileAttachments(mail);
  expect(files.length === 1 && files[0].contentType === "application/pdf", `příloha PDF (${JSON.stringify(mail.attachments)})`);
  expect(quoteDb(q.id) === `odeslana|true|true|${A.id}|${B.id}`, `DB: odeslal B, schválil A (${quoteDb(q.id)})`);
  await shot(pb, S("05c-b-sent-after-a-approval"));
});

await T("4 · Můj účet: A „tvoje schválení nepotřebují“ + „smíš schvalovat“, B „tvoje musí schválit … super admin“", async (context) => {
  for (const [u, re] of [
    [A, /Nabídky: tvoje schválení nepotřebují — vystavíš je a zákazníkovi odešleš sám[\s\S]*Schvalování: smíš schvalovat nabídky kolegů/],
    [B, new RegExp(`Nabídky: tvoje musí před odesláním schválit (.*, )?${esc(A.short)}(, .*)? nebo super admin\\. Po schválení je odešleš sám`)],
  ]) {
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
  expect(toast.includes("1 nabídka teď čeká na schválení."), `zpráva o přepočtu (${toast})`);
  await eventually(async () => expect(norm(await rowA.innerText()).includes("nabídky se schválením"), "A: štítek zpět „nabídky se schválením“"));
  expect(norm(await rowA.innerText()).includes("schvaluje nabídky"), "A dál „schvaluje nabídky“ (přepínače jsou nezávislé)");
  expect(quoteDb(st.quoteA2) === "ke_schvaleni|true|true|-|-", `A2 teď Neschválená (${quoteDb(st.quoteA2)})`);
  expect(quoteDb(st.quoteA.id).startsWith("odeslana|"), `odeslaná nabídka A beze změny (${quoteDb(st.quoteA.id)})`);
  expect(sql(`select state_changed_by from quotes where id = ${lit(st.quoteA2)}`) === ID.admin, "změnu stavu nese super admin");
});

await T("5b · A svou nabídku, která teď schválení potřebuje, neschválí (karta, Ke schválení, REST) — schválí ji super admin", async (context) => {
  expect(st.quoteA2, "test 5 připravil nabídku A2");
  const n2 = sql(`select number from quotes where id = ${lit(st.quoteA2)}`);
  // položka s cenou (schválit jde jen nabídku s položkami)
  sql(`insert into quote_items (quote_id, position, name, quantity, unit, unit_price) values (${lit(st.quoteA2)}, 0, 'Upínka', 1, 'ks', 1000)`);
  const page = await context.newPage();
  await login(page, A);
  await openJob(page, JA, "nabidky");
  const card = quoteCard(page, n2);
  await card.waitFor({ timeout: 15_000 });
  const t = norm(await card.innerText());
  expect(t.includes("Neschválená"), `A2: Neschválená (${t.slice(0, 200)})`);
  expect(await card.getByRole("button", { name: "Schválit", exact: true }).count() === 0, "A u vlastní nabídky nemá „Schválit“");
  expect(await card.getByRole("button", { name: "Schválit a odeslat" }).count() === 0, "ani „Schválit a odeslat“");
  expect(!t.includes("čeká na tvé schválení") && !t.includes(A.short), `kdo schválí — bez A (${t.slice(0, 300)})`);
  expect(await card.getByRole("button", { name: "Odeslat zákazníkovi" }).isDisabled(), "Odeslat zákazníkovi zamčené");
  await page.goto(`${BASE}/quotes`);
  await page.locator("main #ke-schvaleni").waitFor({ timeout: 30_000 });
  expect(await page.locator(`main #ke-schvaleni [data-pending-quote="${st.quoteA2}"]`).count() === 0, "A2 není v A „Ke schválení“");
  await shot(page, S("06b-a-own-not-approvable"));
  const token = await restLogin(A);
  const r = await rest("PATCH", `quotes?id=eq.${st.quoteA2}`, { token, body: { approved_by: A.id } });
  expect(r.status >= 400 && JSON.stringify(r.body).includes("vlastní nabídku nikdo neschvaluje sám"), `REST vlastní schválení: ${r.status} ${JSON.stringify(r.body).slice(0, 200)}`);
  expect(quoteDb(st.quoteA2) === "ke_schvaleni|true|true|-|-", "A2 dál neschválená");
  // super admin ji schválí
  await context.clearCookies();
  const p2 = await context.newPage();
  await login(p2, ADMIN);
  await openJob(p2, JA, "nabidky");
  const adminCard = quoteCard(p2, n2);
  await adminCard.waitFor({ timeout: 15_000 });
  await adminCard.getByRole("button", { name: "Schválit", exact: true }).click();
  await eventually(() => expect(quoteDb(st.quoteA2) === `schvalena|true|true|${ID.admin}|-`, `A2 schválil super admin (${quoteDb(st.quoteA2)})`));
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
