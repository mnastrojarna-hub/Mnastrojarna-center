// E2E 22: obchodník i zaměstnanec (ne super admin) si sami otevřou Můj účet, změní heslo, připojí a upraví
// vlastní e-mailovou schránku a vyzkouší odeslání — na počítači i na telefonu (390 px). K tomu oprava
// produkční chyby „535 Incorrect authentication data": zastaralé vlastní SMTP heslo → odeslání projde
// heslem schránky a SMTP heslo se smaže; nastavení z Outlooku (SMTP, šifrování „Žádné").
//
// Spuštění (aplikace musí znát testovací poštovní server a jeho CA — viz 12-mailbox-setup.mjs):
//   node tools/e2e/mail-test-server.mjs --dir <dir> &
//   MAIL_TEST_PROVIDERS="$(cat <dir>/providers.json)" NODE_EXTRA_CA_CERTS=<dir>/ca.crt <spusť aplikaci>
//   MAIL_TEST_DIR=<dir> E2E_BASE_URL=http://localhost:3500 node tools/e2e/tests/22-own-account-mailbox.mjs
import fs from "node:fs";
import path from "node:path";
import { BASE, USERS, launch, withContext, login, shot, sql, test, expect, summary, localEnv } from "../lib.mjs";

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), "../../..");
const SRV_DIR = process.env.MAIL_TEST_DIR ?? path.join(ROOT, ".local-supabase/mail-test");
const SRV = JSON.parse(fs.readFileSync(path.join(SRV_DIR, "server.json"), "utf8"));
const P = SRV.ports;
const CTL = `http://127.0.0.1:${P.control}`;

const browser = await launch();
const errors = [];
let shotNo = 0;
// při chybě snímek obrazovky (artifacts/22-fail-N.png) — ať je vidět, co uživatel viděl
const T = (name, fn, opts) => test(name, () => withContext(browser, errors, async (context) => {
  try {
    await fn(context);
  } catch (err) {
    for (const p of context.pages()) await shot(p, `22-fail-${++shotNo}`).catch(() => undefined);
    throw err;
  }
}, opts));

const TAG = `e2e22-${Date.now()}`;
const START = "Pocatecni-22-heslo";
const ACC = {
  obchod: { email: `${TAG}-obchod@local.test`, role: "obchodnik", name: "Olga Obchodní", box: "obchod22@nastrojarstvi.test", boxPass: "Obchod22-Heslo-1", newPass: "Obchod-Nove-22x!" },
  dilna: { email: `${TAG}-dilna@local.test`, role: "zamestnanec", name: "Zdeněk Dílna", box: "dilna22@nastrojarstvi.test", boxPass: "Dilna22-Heslo-1", newPass: "Dilna-Nove-22x!" },
};
const boxes = Object.values(ACC).map((a) => `'${a.box}'`).join(",");
const cfg = (email, key) => sql(`select config->>'${key}' from mailboxes where email = '${email}'`);
const hasKey = (email, key) => sql(`select (config ? '${key}')::text from mailboxes where email = '${email}'`);
const smtpEvents = async (user) => (await (await fetch(`${CTL}/events`)).json()).filter((e) => e.type === "auth" && e.proto === "smtp" && e.user === user);

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

function cleanupBoxes() {
  sql(`delete from emails where mailbox_id in (select id from mailboxes where email in (${boxes}))`);
  sql(`delete from mailboxes where email in (${boxes})`);
}

// účty s počátečním heslem od super admina (vynucená změna), role obchodník / zaměstnanec
cleanupBoxes();
for (const a of Object.values(ACC)) {
  const u = await adminApi("POST", "users", { email: a.email, password: START, email_confirm: true, user_metadata: { full_name: a.name } });
  a.id = u.id ?? u.user?.id;
  sql(`update profiles set role = '${a.role}', full_name = '${a.name}', active = true, password_change_required = true where id = '${a.id}'`);
}

console.log(`22 · Můj účet bez super admina (SMTP ${P.smtps}/${P.smtp}, ovládání ${P.control})`);

async function loginAs(page, email, password) {
  await page.goto(`${BASE}/login`);
  await page.locator("#email").fill(email);
  await page.locator("#password").fill(password);
  await Promise.all([
    page.waitForURL((u) => !u.pathname.startsWith("/login"), { timeout: 30_000 }),
    page.getByRole("button", { name: /^přihlásit se$/i }).click(),
  ]);
}

async function changePassword(page, a) {
  await page.getByText("Nejdřív si nastav vlastní heslo").waitFor({ timeout: 15_000 });
  await page.getByRole("link", { name: /Nastavit vlastní heslo/ }).click();
  await page.waitForURL(/\/account/);
  await page.waitForLoadState("networkidle");
  await page.locator("#pw-current:visible").fill(START);
  await page.locator("#pw-new:visible").fill(a.newPass);
  await page.locator("#pw-confirm:visible").fill(a.newPass);
  await page.locator("#zmena-hesla:visible").getByRole("button", { name: /Změnit heslo/ }).click();
  await page.getByText(/Heslo je změněné/).first().waitFor({ timeout: 20_000 });
  expect(sql(`select password_change_required from profiles where id = '${a.id}'`) === "f", "příznak změny hesla zrušen");
}

async function noHorizontalOverflow(page, label) {
  const m = await page.evaluate(() => {
    const main = document.querySelector("main");
    return { scroll: main.scrollWidth, client: main.clientWidth, doc: document.documentElement.scrollWidth, vw: window.innerWidth };
  });
  expect(m.scroll <= m.client + 1 && m.doc <= m.vw + 1, `${label}: obsah se vejde na šířku (${JSON.stringify(m)})`);
}

async function connectBox(page, a, { outlook } = {}) {
  const form = page.locator('[data-testid="my-mailbox-form"]:visible').first();
  if (!(await form.isVisible().catch(() => false))) await page.locator('[data-testid="my-mailbox-add"]:visible').first().click();
  await form.waitFor();
  await form.getByLabel("E-mail schránky").fill(a.box);
  await form.getByLabel("Heslo ke schránce").fill(a.boxPass);
  if (outlook) {
    // nastavení opsané z Outlooku: SMTP server, port, šifrování „Žádné"
    await form.getByRole("button", { name: /Upřesnit/ }).click();
    await form.getByLabel("Odchozí server").fill("127.0.0.1");
    await form.getByLabel("Port odchozího serveru").fill(String(P.smtp));
    await form.getByLabel("Šifrování odchozího serveru").selectOption("none");
  }
  await form.getByTestId("my-mailbox-connect").click();
  const note = page.getByTestId("my-mailbox-note").filter({ hasText: /Schránka připojena/ });
  await note.filter({ hasText: /Staženo \d+/ }).waitFor({ timeout: 120_000 });
  expect(sql(`select owner_id from mailboxes where email = '${a.box}'`) === a.id, "vlastník schránky = já");
}

async function testSend(page, a) {
  const row = page.getByTestId(`my-box-${a.box}`);
  await row.getByTestId("my-box-test-send").click();
  const ok = page.getByTestId("my-mailbox-note").filter({ hasText: /Zkušební e-mail odeslán/ });
  await ok.waitFor({ timeout: 60_000 });
  return ok.innerText();
}

await T("obchodník (počítač): změna hesla → Můj účet ze menu i z postranního panelu → připojit schránku → Vyzkoušet odeslání → Upravit", async (context) => {
  const a = ACC.obchod;
  const page = await context.newPage();
  await loginAs(page, a.email, START);
  await changePassword(page, a);
  // nové heslo platí (odhlásit se, přihlásit novým)
  await context.clearCookies();
  await loginAs(page, a.email, a.newPass);
  expect(!(await page.getByText("Nejdřív si nastav vlastní heslo").isVisible().catch(() => false)), "výzva ke změně hesla zmizela");
  // Můj účet: položka v menu (Správa) i odkaz pod jménem v postranním panelu
  const nav = (await page.locator("aside nav a").allInnerTexts()).join(" | ");
  expect(nav.includes("Můj účet"), `Můj účet v menu obchodníka: ${nav}`);
  await page.getByTestId("sidebar-account").click();
  await page.waitForURL(/\/account/);
  await page.goto(`${BASE}/orders`);
  await page.getByRole("button", { name: "Uživatelské menu" }).click();
  await page.getByRole("menuitem", { name: /Můj účet a heslo/ }).click();
  await page.waitForURL(/\/account/);
  await page.waitForLoadState("networkidle");
  await page.locator("#schranka:visible").waitFor();
  await connectBox(page, a);
  expect(cfg(a.box, "smtp_host") === "127.0.0.1", "SMTP nalezen a uložen");
  const sent = await testSend(page, a);
  expect(sent.includes(`Odesláno z ${a.box}`), `odesláno z vlastní schránky: ${sent}`);
  // Upravit: nové zadání hesla → Ověřit a uložit
  await page.getByTestId(`my-box-${a.box}`).getByTestId("my-box-edit").click();
  const form = page.locator('[data-testid="my-mailbox-form"]:visible').first();
  await form.getByLabel("Popis schránky").fill("Obchod E2E 22");
  await form.getByLabel("Heslo ke schránce").fill(a.boxPass);
  await form.getByTestId("my-mailbox-connect").click();
  await page.getByTestId("my-mailbox-note").filter({ hasText: /Schránka upravena/ }).waitFor({ timeout: 120_000 });
  expect(sql(`select display_name from mailboxes where email = '${a.box}'`) === "Obchod E2E 22", "úprava uložena");
  await shot(page, "22-obchodnik-desktop");
  await page.close();
});

await T("BUG 535: zastaralé vlastní SMTP heslo → Vyzkoušet odeslání projde heslem schránky, SMTP heslo se smaže (audit)", async (context) => {
  const a = ACC.obchod;
  sql(`update mailboxes set config = config || '{"smtp_password":"Stare-SMTP-heslo"}'::jsonb where email = '${a.box}'`);
  const page = await context.newPage();
  await loginAs(page, a.email, a.newPass);
  await page.goto(`${BASE}/account#schranka`);
  await page.waitForLoadState("networkidle");
  await page.locator('[data-testid="my-box-smtp-separate"]:visible').first().waitFor();
  const before = (await smtpEvents(a.box)).length;
  const text = await testSend(page, a);
  expect(text.includes(`Odesláno z ${a.box}`), `odesláno: ${text}`);
  expect((await smtpEvents(a.box)).length - before === 2, "2 přihlášení: staré SMTP heslo (535) + heslo schránky");
  expect(hasKey(a.box, "smtp_password") === "false", "zastaralé SMTP heslo smazáno");
  const id = sql(`select id from mailboxes where email = '${a.box}'`);
  expect(sql(`select count(*) from audit_log where action = 'mailbox_smtp_password_healed' and entity_id = '${id}'`) === "1", "audit samoopravy");
  // obě hesla špatně → srozumitelná chyba: server, šifrování, AUTH, zdroj hesla, co dál
  sql(`update mailboxes set config = config || '{"smtp_password":"Stare-SMTP-heslo","imap_password":"Spatne-heslo"}'::jsonb where email = '${a.box}'`);
  await page.reload();
  await page.waitForLoadState("networkidle");
  await page.getByTestId(`my-box-${a.box}`).getByTestId("my-box-test-send").click();
  const err = page.getByTestId("my-mailbox-note").filter({ hasText: /Odeslání selhalo/ });
  await err.waitFor({ timeout: 60_000 });
  const et = await err.innerText();
  for (const part of ["Přihlášení odmítnuto", `127.0.0.1:${P.smtps} SSL/TLS`, "AUTH PLAIN", "AUTH LOGIN", "vlastní SMTP heslo", "heslo příchozí pošty", "Můj účet → Moje e-mailová schránka → Upravit"]) {
    expect(et.includes(part), `chyba obsahuje „${part}“: ${et}`);
  }
  expect(!et.includes("Stare-SMTP-heslo") && !et.includes("Spatne-heslo"), "heslo není v hlášce");
  // náprava: Upravit → zadat heslo schránky znovu → odeslání funguje, SMTP heslo pryč
  await page.getByTestId(`my-box-${a.box}`).getByTestId("my-box-edit").click();
  const form = page.locator('[data-testid="my-mailbox-form"]:visible').first();
  await form.getByLabel("Heslo ke schránce").fill(a.boxPass);
  await form.getByTestId("my-mailbox-connect").click();
  await page.getByTestId("my-mailbox-note").filter({ hasText: /Schránka upravena/ }).waitFor({ timeout: 120_000 });
  expect(hasKey(a.box, "smtp_password") === "false" && cfg(a.box, "imap_password") === a.boxPass, "Upravit: heslo schránky platí i pro SMTP");
  await testSend(page, a);
  await page.close();
});

await T("zaměstnanec (telefon 390 px): změna hesla → Menu → Můj účet → schránka s nastavením z Outlooku („Žádné“) → Vyzkoušet odeslání → Upravit", async (context) => {
  const a = ACC.dilna;
  const page = await context.newPage();
  await loginAs(page, a.email, START);
  await changePassword(page, a);
  await page.goto(`${BASE}/orders`);
  await page.getByRole("button", { name: /^Menu/ }).click();
  const menu = page.getByRole("dialog");
  await menu.getByRole("link", { name: /Můj účet/ }).click();
  await page.waitForURL(/\/account/);
  await page.waitForLoadState("networkidle");
  await noHorizontalOverflow(page, "Můj účet bez schránky");
  await connectBox(page, a, { outlook: true });
  expect(cfg(a.box, "smtp_tls") === "none" && cfg(a.box, "smtp_port") === String(P.smtp), `uloženo „Žádné“ na portu ${P.smtp}: ${cfg(a.box, "smtp_tls")} ${cfg(a.box, "smtp_port")}`);
  await noHorizontalOverflow(page, "Můj účet se schránkou");
  const before = (await smtpEvents(a.box)).length;
  const sent = await testSend(page, a);
  expect(sent.includes(`Odesláno z ${a.box}`), `odesláno: ${sent}`);
  const ev = (await smtpEvents(a.box)).slice(before);
  expect(ev.length === 1 && ev[0].secure === true, `„Žádné“: server nabídl STARTTLS → heslo šifrovaně (${JSON.stringify(ev)})`);
  await page.getByTestId(`my-box-${a.box}`).getByTestId("my-box-edit").click();
  const form = page.locator('[data-testid="my-mailbox-form"]:visible').first();
  await form.getByLabel("Popis schránky").fill("Dílna E2E 22");
  await form.getByTestId("my-mailbox-connect").click();
  await page.getByTestId("my-mailbox-note").filter({ hasText: /Schránka upravena/ }).waitFor({ timeout: 120_000 });
  expect(sql(`select display_name from mailboxes where email = '${a.box}'`) === "Dílna E2E 22", "úprava uložena");
  await noHorizontalOverflow(page, "Můj účet po úpravě");
  await shot(page, "22-zamestnanec-390");
  await page.close();
}, { mobile: true });

await T("super admin, Nastavení → Upravit: uložené vlastní SMTP heslo je vidět (zaškrtnuté), odškrtnout + Uložit ho smaže", async (context) => {
  const a = ACC.obchod;
  sql(`update mailboxes set config = config || '{"smtp_password":"Stare-SMTP-heslo"}'::jsonb where email = '${a.box}'`);
  const page = await context.newPage();
  await login(page, USERS.admin);
  await page.goto(`${BASE}/settings`);
  await page.getByText("E-mailové schránky").first().waitFor();
  await page.waitForLoadState("networkidle");
  await page.getByTestId(`mailbox-row-${a.box}`).getByRole("button", { name: "Upravit schránku" }).click();
  const f = page.getByTestId("mailbox-form").first();
  const box = f.getByTestId("smtp-separate");
  await box.waitFor();
  expect(await box.isChecked(), "zaškrtávátko „SMTP má jiné heslo“ odpovídá uloženému stavu");
  await f.getByTestId("smtp-password-stored").waitFor();
  await box.uncheck();
  await f.getByTestId("smtp-password-clear-note").waitFor();
  await shot(page, "22-admin-smtp-heslo");
  await f.getByTestId("save-btn").click();
  await page.getByText("Změny schránky uloženy.").waitFor({ timeout: 30_000 });
  expect(hasKey(a.box, "smtp_password") === "false" && cfg(a.box, "imap_password") === a.boxPass, "uložené SMTP heslo smazáno, heslo schránky zůstalo");
  await page.close();
});

cleanupBoxes();
for (const a of Object.values(ACC)) {
  if (!a.id) continue;
  sql(`delete from audit_log where actor_id = '${a.id}'`);
  await adminApi("DELETE", `users/${a.id}`).catch(() => undefined);
}
await browser.close();
process.exit(summary(errors) ? 0 : 1);
