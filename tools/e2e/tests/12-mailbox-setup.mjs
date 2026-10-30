// E2E: nastavení e-mailové schránky proti skutečnému testovacímu poštovnímu serveru
// (tools/e2e/mail-test-server.mjs — IMAP + POP3 + SMTP, certifikát vystavený na jiné jméno než „localhost").
//
// Spuštění (aplikace musí znát testovací server a jeho CA):
//   node tools/e2e/mail-test-server.mjs --dir .local-supabase/mail-test &
//   MAIL_TEST_PROVIDERS="$(cat .local-supabase/mail-test/providers.json)" \
//   NODE_EXTRA_CA_CERTS=.local-supabase/mail-test/ca.crt  <spusť aplikaci>   (např. next start -p 3500)
//   E2E_BASE_URL=http://localhost:3500 node tools/e2e/tests/12-mailbox-setup.mjs
import fs from "node:fs";
import path from "node:path";
import { BASE, USERS, launch, withContext, login, shot, sql, test, expect, summary } from "../lib.mjs";

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), "../../..");
const SRV_DIR = process.env.MAIL_TEST_DIR ?? path.join(ROOT, ".local-supabase/mail-test");
const SRV = JSON.parse(fs.readFileSync(path.join(SRV_DIR, "server.json"), "utf8"));
const P = SRV.ports;

const browser = await launch();
const errors = [];
const T = (name, fn, opts) => test(name, () => withContext(browser, errors, fn, opts));

const BOXES = ["jmeno@nastrojarstvi.test", "kolega@mnastrojarna.test", "pop@pop3only.test", "cert@jinycert.test"];
const inList = BOXES.map((b) => `'${b}'`).join(",");
const cleanup = () => {
  sql(`delete from emails where mailbox_id in (select id from mailboxes where email in (${inList}))`);
  sql(`delete from mailboxes where email in (${inList})`);
};
cleanup();
const adminId = sql(`select id from profiles where email = '${USERS.admin.email}'`);
const obchodId = sql(`select id from profiles where email = '${USERS.obchod.email}'`);
const boxId = (email) => sql(`select id from mailboxes where email = '${email}'`);
const cfg = (email, key) => sql(`select config->>'${key}' from mailboxes where email = '${email}'`);
const startedAt = sql("select now()");

console.log(`12 · nastavení schránky (testovací server IMAP ${P.imaps}/${P.imap}, POP3 ${P.pop3s}, SMTP ${P.smtps})`);

async function openSettings(page) {
  await page.goto(`${BASE}/settings`);
  await page.getByText("E-mailové schránky").first().waitFor();
  await page.waitForLoadState("networkidle"); // po hydrataci (jinak se formulář překreslí pod rukama)
  const form = page.getByTestId("mailbox-form").last();
  await form.scrollIntoViewIfNeeded();
  return form;
}

async function waitRowSynced(page, email, re = /Staženo \d+, nových \d+/) {
  const row = page.getByTestId(`mailbox-row-${email}`);
  await row.waitFor({ timeout: 30_000 });
  const msg = row.getByTestId("row-sync-msg");
  await msg.filter({ hasText: re }).waitFor({ timeout: 90_000 });
  return { row, text: await msg.innerText() };
}

await T("hosting90 předvolba: jen e-mail + heslo → „Najít nastavení automaticky“ najde server z certifikátu", async (context) => {
  const page = await context.newPage();
  await login(page, USERS.admin);
  const f = await openSettings(page);
  expect((await f.getByLabel("Poskytovatel").inputValue()) === "hosting90", "výchozí předvolba hosting90");
  await f.getByLabel("E-mail schránky").fill("jmeno@nastrojarstvi.test");
  await f.getByLabel("Heslo ke schránce").fill("Spravne-Heslo-1");
  await f.getByLabel("Vlastník schránky").selectOption(adminId);
  await f.getByTestId("detect-btn").click();
  const res = f.getByTestId("detect-result");
  await res.waitFor({ timeout: 60_000 });
  const text = await res.innerText();
  expect(/Nalezeno/.test(text), `nalezeno: ${text}`);
  expect(text.includes(`IMAP 127.0.0.1:${P.imaps} SSL/TLS`), `IMAP přes jméno z certifikátu (127.0.0.1): ${text}`);
  expect(text.includes("3 zpráv v INBOXu"), "počet zpráv v INBOXu");
  expect(text.includes(`SMTP 127.0.0.1:${P.smtps}`), `SMTP nalezen: ${text}`);
  await res.getByText(/Co se zkoušelo/).click();
  const attempts = await res.getByTestId("detect-attempts").innerText();
  expect(attempts.includes(`IMAP localhost:${P.imaps}`) && /Certifikát serveru nesedí na název localhost/.test(attempts), `tabulka pokusů ukazuje nesedící certifikát: ${attempts.slice(0, 400)}`);
  await shot(page, "12-detect-found");
  await f.getByTestId("save-btn").click();
  const { text: synced } = await waitRowSynced(page, "jmeno@nastrojarstvi.test");
  expect(/Staženo 3, nových 3/.test(synced), `po přidání se pošta rovnou stáhla: ${synced}`);
  expect(cfg("jmeno@nastrojarstvi.test", "imap_host") === "127.0.0.1", "uložen nalezený server");
  expect(cfg("jmeno@nastrojarstvi.test", "imap_port") === String(P.imaps), "uložen nalezený port");
  expect(cfg("jmeno@nastrojarstvi.test", "imap_tls") === "tls", "uloženo šifrování");
  expect(cfg("jmeno@nastrojarstvi.test", "imap_password") === "Spravne-Heslo-1", "uloženo heslo");
  expect(cfg("jmeno@nastrojarstvi.test", "smtp_host") === "127.0.0.1", "uložen SMTP");
  const id = boxId("jmeno@nastrojarstvi.test");
  expect(sql(`select count(*) from emails where mailbox_id = '${id}'`) === "3", "3 e-maily v DB");
  expect(sql(`select created_by from mailboxes where id = '${id}'`) === adminId, "autor schránky = admin");
  expect(sql(`select count(*) from audit_log where action = 'mailbox_added' and entity_id = '${id}' and actor_id = '${adminId}'`) === "1", "audit: přidání schránky s autorem");
  expect(!JSON.stringify(sql(`select diff from audit_log where action = 'mailbox_added' and entity_id = '${id}'`)).includes("Spravne-Heslo-1"), "heslo není v auditu");
  await shot(page, "12-settings-after-add");
  await page.close();
});

await T("uložená schránka: Otestovat připojení bez zadání hesla → OK po krocích; úprava bez hesla heslo nezmění", async (context) => {
  const page = await context.newPage();
  await login(page, USERS.admin);
  await openSettings(page);
  const row = page.getByTestId("mailbox-row-jmeno@nastrojarstvi.test");
  await row.getByText("heslo uloženo").first().waitFor();
  await row.getByRole("button", { name: "Upravit schránku" }).click();
  const f = page.getByTestId("mailbox-form").first();
  await f.getByTestId("password-stored").waitFor();
  expect(!(await f.getByLabel("Heslo ke schránce").isVisible().catch(() => false)), "pole hesla skryté (heslo uloženo)");
  await f.getByTestId("test-btn").click();
  const result = f.getByTestId("test-result");
  await result.waitFor({ timeout: 60_000 });
  const t = await result.innerText();
  for (const step of ["DNS", "Spojení", "Šifrování", "Přihlášení", "Schránka INBOX"]) expect(t.includes(step), `krok ${step}: ${t}`);
  expect(/Příchozí IMAP: OK/.test(t) && /Odchozí SMTP: OK/.test(t), `IMAP i SMTP OK: ${t}`);
  expect(/3 zpráv/.test(t), "počet zpráv");
  await shot(page, "12-test-ok");
  const id = boxId("jmeno@nastrojarstvi.test");
  expect(sql(`select last_test_ok from mailbox_status where mailbox_id = '${id}'`) === "t", "výsledek testu uložen ke schránce");

  await f.getByLabel("Popis schránky").fill("E2E hlavní");
  await f.getByTestId("save-btn").click();
  await page.getByText("Změny schránky uloženy.").waitFor();
  expect(sql(`select display_name from mailboxes where id = '${id}'`) === "E2E hlavní", "popis uložen");
  expect(cfg("jmeno@nastrojarstvi.test", "imap_password") === "Spravne-Heslo-1", "heslo se úpravou bez zadání hesla nezměnilo");
  expect(sql(`select updated_by from mailboxes where id = '${id}'`) === adminId, "updated_by = admin");
  expect(sql(`select count(*) from audit_log where action = 'mailbox_updated' and entity_id = '${id}' and actor_id = '${adminId}'`) !== "0", "audit úpravy s autorem");
  await page.close();
});

await T("špatné heslo → „Přihlášení odmítnuto…“, uložené heslo zůstane", async (context) => {
  const page = await context.newPage();
  await login(page, USERS.admin);
  await openSettings(page);
  await page.getByTestId("mailbox-row-jmeno@nastrojarstvi.test").getByRole("button", { name: "Upravit schránku" }).click();
  const f = page.getByTestId("mailbox-form").first();
  await f.getByRole("button", { name: "Změnit heslo" }).click();
  await f.getByLabel("Heslo ke schránce").fill("spatne-heslo");
  await f.getByTestId("test-btn").click();
  const err = f.getByTestId("diag-error").first();
  await err.waitFor({ timeout: 60_000 });
  const t = await err.innerText();
  expect(/^Přihlášení odmítnuto/.test(t) && /CELÁ e-mailová adresa/.test(t), `srozumitelná chyba: ${t}`);
  await shot(page, "12-test-bad-password");
  await f.getByRole("button", { name: "Zrušit" }).click();
  expect(cfg("jmeno@nastrojarstvi.test", "imap_password") === "Spravne-Heslo-1", "heslo beze změny");
  await page.close();
});

await T("ruční nastavení (Jiný, IMAP STARTTLS) pro obchodníka → test OK → uložit → stáhnout", async (context) => {
  const page = await context.newPage();
  await login(page, USERS.admin);
  const f = await openSettings(page);
  await f.getByLabel("Poskytovatel").selectOption("other");
  await f.getByLabel("E-mail schránky").fill("kolega@mnastrojarna.test");
  await f.getByLabel("Heslo ke schránce").fill("Kolega-Heslo-1");
  await f.getByLabel("Vlastník schránky").selectOption(obchodId);
  await f.getByLabel("Příchozí server").fill(" IMAP://127.0.0.1/ ");
  const inTls = f.getByLabel("Šifrování příchozího serveru");
  const inPort = f.getByLabel("Port příchozího serveru");
  expect((await inTls.inputValue()) === "", `výchozí šifrování „podle portu“, je „${await inTls.inputValue()}“`);
  // změna protokolu → výchozí port protokolu; změna portu → šifrování zpět „podle portu“
  await f.getByLabel("Protokol příchozí pošty").selectOption("pop3");
  expect((await inPort.inputValue()) === "995", `POP3 → port 995, je ${await inPort.inputValue()}`);
  await f.getByLabel("Protokol příchozí pošty").selectOption("imap");
  expect((await inPort.inputValue()) === "993", `IMAP → port 993, je ${await inPort.inputValue()}`);
  await inTls.selectOption("tls");
  await inPort.fill(String(P.imap));
  expect((await inTls.inputValue()) === "", `po změně portu šifrování „podle portu“ (ne SSL/TLS), je „${await inTls.inputValue()}“`);
  await inTls.selectOption("starttls");
  await f.getByLabel("Odchozí server").fill("127.0.0.1");
  await f.getByLabel("Šifrování odchozího serveru").selectOption("tls");
  await f.getByLabel("Port odchozího serveru").fill(String(P.smtp));
  expect((await f.getByLabel("Šifrování odchozího serveru").inputValue()) === "", "SMTP: po změně portu šifrování „podle portu“");
  await f.getByLabel("Šifrování odchozího serveru").selectOption("starttls");
  await f.getByTestId("test-btn").click();
  const result = f.getByTestId("test-result");
  await result.waitFor({ timeout: 60_000 });
  const t = await result.innerText();
  expect(/Příchozí IMAP: OK/.test(t) && /STARTTLS/.test(t) && /Odchozí SMTP: OK/.test(t), `ruční IMAP STARTTLS + SMTP STARTTLS OK: ${t}`);
  await f.getByTestId("save-btn").click();
  const { text } = await waitRowSynced(page, "kolega@mnastrojarna.test");
  expect(/Staženo 3, nových 3/.test(text), `stáhnuto: ${text}`);
  expect(cfg("kolega@mnastrojarna.test", "imap_host") === "127.0.0.1", "server vyčištěn (bez imap:// a lomítka)");
  expect(cfg("kolega@mnastrojarna.test", "imap_tls") === "starttls", "STARTTLS uloženo");
  expect(sql(`select owner_id from mailboxes where email = 'kolega@mnastrojarna.test'`) === obchodId, "vlastník obchodník");
  await page.close();
});

await T("POP3-only schránka (IMAP zavřený): automaticky POP3 → uložit → stáhnout bez mazání", async (context) => {
  const page = await context.newPage();
  await login(page, USERS.admin);
  const f = await openSettings(page);
  await f.getByLabel("E-mail schránky").fill("pop@pop3only.test");
  await f.getByLabel("Heslo ke schránce").fill("Pop3-Heslo-1");
  await f.getByTestId("detect-btn").click();
  const res = f.getByTestId("detect-result");
  await res.waitFor({ timeout: 60_000 });
  const text = await res.innerText();
  expect(text.includes(`POP3 127.0.0.1:${P.pop3s}`), `nalezen POP3: ${text}`);
  await f.getByTestId("save-btn").click();
  const { text: synced } = await waitRowSynced(page, "pop@pop3only.test");
  expect(/Staženo 3, nových 3/.test(synced), `POP3 staženo: ${synced}`);
  expect(cfg("pop@pop3only.test", "incoming_protocol") === "pop3", "uložen protokol POP3");
  const id = boxId("pop@pop3only.test");
  expect(sql(`select jsonb_array_length(sync_state->'pop3'->'seen') from mailbox_status where mailbox_id = '${id}'`) === "3", "UIDL stav uložen");
  await page.getByTestId("mailbox-row-pop@pop3only.test").getByText(/POP3: 127\.0\.0\.1/).waitFor();
  await page.close();
});

await T("certifikát jen na cizí jméno → nabídne potvrzení, po souhlasu najde (bez ověření jména)", async (context) => {
  const page = await context.newPage();
  await login(page, USERS.admin);
  const f = await openSettings(page);
  await f.getByLabel("E-mail schránky").fill("cert@jinycert.test");
  await f.getByLabel("Heslo ke schránce").fill("Cert-Heslo-1");
  await f.getByTestId("detect-btn").click();
  const box = f.getByTestId("confirm-mismatch");
  await box.waitFor({ timeout: 60_000 });
  const err = await f.getByTestId("detect-error").innerText();
  expect(/certifikát serveru nesedí/i.test(err) && /potvrď/.test(err), `vysvětlení: ${err}`);
  expect((await box.innerText()).includes("mail.hosting90.test"), "ukáže jméno z certifikátu");
  await shot(page, "12-confirm-mismatch");
  await box.getByRole("button", { name: /Rozumím/ }).click();
  await f.getByTestId("detect-result").filter({ hasText: "Nalezeno" }).waitFor({ timeout: 60_000 });
  const ok = await f.getByTestId("detect-result").innerText();
  expect(/bez ověření jména/.test(ok), `nalezeno s výslovným souhlasem: ${ok}`);
  await page.close();
});

await T("Přijatá pošta: Přijmout a odeslat → zprávy v seznamu, stav schránky", async (context) => {
  const id = boxId("jmeno@nastrojarstvi.test");
  sql(`delete from emails where mailbox_id = '${id}'`);
  sql(`update mailbox_status set sync_state = '{}'::jsonb where mailbox_id = '${id}'`);
  const page = await context.newPage();
  await login(page, USERS.admin);
  await page.goto(`${BASE}/inbox?schranka=${id}`);
  await page.getByRole("button", { name: /Přijmout a odeslat/ }).click();
  await page.getByText(/Přijato 3, odesláno \d+/).waitFor({ timeout: 90_000 });
  await page.getByText("Nabídka materiálu").first().waitFor({ timeout: 20_000 });
  const body = await page.locator("main").innerText();
  expect(body.includes("Objednávka 4500123") && body.includes("Poptávka hřídele 50 ks"), "zprávy jmeno@ v Přijaté poště");
  await shot(page, "12-inbox-admin");
  await page.close();
});

await T("obchodník vidí jen svou schránku (+ stav na Můj účet), nemá přístup k nastavení schránek", async (context) => {
  const page = await context.newPage();
  await login(page, USERS.obchod);
  await page.goto(`${BASE}/inbox`);
  await page.getByText("Kolega: Nabídka materiálu").first().waitFor({ timeout: 30_000 });
  const body = await page.locator("main").innerText();
  expect(body.includes("kolega@mnastrojarna.test"), "vidí svou schránku");
  expect(!body.includes("jmeno@nastrojarstvi.test") && !body.includes("pop@pop3only.test"), "nevidí cizí schránky");
  expect(!body.includes("Pop: "), "nevidí poštu POP3 schránky");
  expect(!/(^|\n)Objednávka 4500123/.test(body), "nevidí poštu jmeno@");
  const jmeno = boxId("jmeno@nastrojarstvi.test");
  const r = await page.request.post(`${BASE}/api/emails/sync`, { data: { mailboxId: jmeno } });
  const j = await r.json();
  expect(!j.configured && (j.fetched ?? 0) === 0, `cizí schránku stáhnout nejde: ${JSON.stringify(j).slice(0, 200)}`);
  const d = await page.request.post(`${BASE}/api/mailboxes/diagnose`, { data: { action: "detect", email: "jmeno@nastrojarstvi.test", password: "x" } });
  expect(d.status() === 403, `diagnostika jen pro super admina (je ${d.status()})`);
  await page.goto(`${BASE}/account`);
  // karta schránky se dočítá po vykreslení stránky — počkat na ni (jinak občas prázdný text)
  await page.locator("main").getByText("kolega@mnastrojarna.test").first().waitFor({ timeout: 20_000 }).catch(() => undefined);
  const acc = await page.locator("main").innerText();
  expect(acc.includes("kolega@mnastrojarna.test") && /staženo/.test(acc), "Můj účet: schránka a čas stažení");
  await shot(page, "12-inbox-obchod");
  await page.close();
});

await T("odmítnuté heslo: ručně se zkusí, automatické stažení při otevření pošty se znovu NEpřihlásí; po opravě hesla zase ano", async (context) => {
  const user = "kolega@mnastrojarna.test";
  const id = boxId(user);
  const logins = async () => {
    const ev = await (await fetch(`http://127.0.0.1:${P.control}/events`)).json();
    return ev.filter((e) => e.type === "auth" && e.user === user).length;
  };
  const setPassword = (pw) => sql(`update mailboxes set config = jsonb_set(config, '{imap_password}', to_jsonb('${pw}'::text)) where id = '${id}'`);
  const makeStale = () => sql(`update mailbox_status set last_sync_ok_at = now() - interval '1 hour', last_sync_attempt_at = now() - interval '1 hour' where mailbox_id = '${id}'`);
  setPassword("Heslo-Zmenene-Na-Serveru");
  const page = await context.newPage();
  const syncCalls = [];
  page.on("request", (r) => { if (r.url().includes("/api/emails/sync")) syncCalls.push(r.postData() ?? ""); });
  await login(page, USERS.obchod);
  await page.goto(`${BASE}/inbox`);
  await page.waitForLoadState("networkidle");
  const n0 = await logins();
  await page.getByRole("button", { name: /Přijmout a odeslat/ }).click();
  await page.getByText(/Přihlášení odmítnuto/).first().waitFor({ timeout: 60_000 });
  const n1 = await logins();
  expect(n1 === n0 + 1, `ruční stažení se přihlásilo jednou (${n0} → ${n1})`);
  expect(sql(`select last_sync_error_kind from mailbox_status where mailbox_id = '${id}'`) === "auth", "druh chyby uložen (auth)");

  // otevření pošty s dávno staženou schránkou: dřív automatické stažení = další špatné přihlášení
  makeStale();
  syncCalls.length = 0;
  await page.goto(`${BASE}/inbox`);
  await page.getByTestId("mailbox-health").getByText(/Heslo odmítnuto — oprav ho v Nastavení/).first().waitFor({ timeout: 20_000 });
  await page.waitForLoadState("networkidle");
  await page.waitForTimeout(1500);
  expect(syncCalls.length === 0, `automatické stažení se nespustilo (${syncCalls.length} volání)`);
  expect((await logins()) === n1, "žádný další pokus o přihlášení");
  // automatické stažení vynucené přes API (jako starší klient / druhá karta) se taky nepřihlásí
  const auto = await page.request.post(`${BASE}/api/emails/sync`, { data: { auto: true } });
  const aj = await auto.json();
  const box = (aj.boxes ?? []).find((b) => b.email === user);
  expect(box?.skipped === "auth", `automatické stažení schránku přeskočilo (${JSON.stringify(box ?? aj).slice(0, 200)})`);
  expect((await logins()) === n1, "API automatického stažení se nepřihlásilo");
  await shot(page, "12-auth-blocked-inbox");

  // admin vidí v Nastavení jasný stav
  const admin = await browser.newContext();
  const ap = await admin.newPage();
  await login(ap, USERS.admin);
  await ap.goto(`${BASE}/settings`);
  // streamovaná stránka (loading.tsx) má chvíli i skrytou kopii obsahu → první viditelný
  await ap.getByTestId(`mailbox-row-${user}`).getByTestId("auth-blocked").first().waitFor({ timeout: 20_000 });
  await admin.close();

  // oprava hesla → automatické stažení zase běží
  setPassword("Kolega-Heslo-1");
  makeStale();
  syncCalls.length = 0;
  await page.goto(`${BASE}/inbox`);
  await page.waitForLoadState("networkidle");
  await expectEventually(async () => syncCalls.some((b) => b.includes('"auto":true')), "automatické stažení po opravě hesla");
  await expectEventually(async () => (await logins()) > n1, "přihlášení po opravě hesla");
  await expectEventually(async () => sql(`select coalesce(last_sync_error_kind, '-') from mailbox_status where mailbox_id = '${id}'`) === "-", "chyba vyčištěna");
  await page.close();
});

async function expectEventually(fn, what, timeout = 30_000) {
  const t0 = Date.now();
  for (;;) {
    if (await fn()) return;
    if (Date.now() - t0 > timeout) return expect(false, what);
    await new Promise((r) => setTimeout(r, 500));
  }
}

await T("mobil: nastavení schránek a Přijatá pošta bez vodorovného přetékání", async (context) => {
  const page = await context.newPage();
  await login(page, USERS.admin);
  const f = await openSettings(page);
  await f.getByLabel("Poskytovatel").selectOption("other");
  await f.getByLabel("E-mail schránky").fill("jmeno@nastrojarstvi.test");
  await f.getByLabel("Heslo ke schránce").fill("Spravne-Heslo-1");
  await f.getByTestId("detect-btn").click();
  await f.getByTestId("detect-result").waitFor({ timeout: 60_000 });
  await f.getByTestId("detect-result").getByText(/Co se zkoušelo/).click();
  const over = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  await shot(page, "12-mobile-settings");
  expect(over <= 1, `nastavení: přetéká o ${over}px`);
  await page.goto(`${BASE}/inbox`);
  await page.getByRole("button", { name: /Přijmout a odeslat/ }).waitFor();
  const over2 = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  await shot(page, "12-mobile-inbox");
  expect(over2 <= 1, `pošta: přetéká o ${over2}px`);
  await page.close();
}, { mobile: true });

await T("úklid + audit a heslo nikdy v prohlížeči", async (context) => {
  const page = await context.newPage();
  await login(page, USERS.admin);
  await page.goto(`${BASE}/settings`);
  const html = await page.content();
  expect(!html.includes("Spravne-Heslo-1") && !html.includes("Kolega-Heslo-1"), "hesla nejsou v HTML stránky");
  const added = sql(`select count(*) from audit_log where action = 'mailbox_added' and actor_id = '${adminId}' and created_at >= '${startedAt}'`);
  expect(Number(added) >= 3, `audit přidání schránek (${added})`);
  await page.close();
  cleanup();
  expect(sql(`select count(*) from mailboxes where email in (${inList})`) === "0", "testovací schránky smazány");
});

await browser.close();
const ok = summary(errors);
process.exit(ok ? 0 : 1);
