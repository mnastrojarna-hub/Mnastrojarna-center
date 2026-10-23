// E2E: super admin se odhlásí a na stejném zařízení se přihlásí jiný účet (počáteční heslo 123456).
import { BASE, USERS, launch, withContext, login, shot, sql, test, expect, summary } from "../lib.mjs";
import { devices } from "playwright";

const browser = await launch();
const errors = [];
const VIT = { email: "vit.volny@mnastrojarna.cz", password: "123456" };
const MIGRATION_HASH = "$2a$10$AifTRGwYVYUuDbg93yl6j.ZdITZdT68siI87OTWZGn78oyNcXwUxm";

console.log("13 · odhlášení super admina → přihlášení jiného účtu");

function resetVit() {
  // stav přesně podle migrace 20261022110000 (hash hesla 123456 z migrace, ne crypt())
  sql(`update auth.users set encrypted_password = '${MIGRATION_HASH}' where email = '${VIT.email}'`);
  sql(`update profiles set password_change_required = true, active = true where email = '${VIT.email}'`);
}

async function switchAccount(page, label) {
  await login(page, USERS.admin);
  await page.goto(`${BASE}/orders`);
  await page.getByRole("button", { name: "Uživatelské menu" }).click();
  await page.getByRole("menuitem", { name: /Odhlásit se/ }).click();
  await page.waitForURL(/\/login/, { timeout: 15_000 });
  await shot(page, `13-${label}-login`);
  const prefilled = await page.locator("#email").inputValue();
  expect(prefilled === "", `po odhlášení je pole e-mailu prázdné (je „${prefilled}")`);
  await page.locator("#email").fill(VIT.email);
  await page.locator("#password").fill(VIT.password);
  await Promise.all([
    page.waitForURL((u) => !u.pathname.startsWith("/login") || u.searchParams.has("error"), { timeout: 30_000 }),
    page.getByRole("button", { name: /^přihlásit se$/i }).click(),
  ]);
  const url = new URL(page.url());
  expect(!url.searchParams.has("error"), `přihlášení Víta prošlo (chyba: ${url.searchParams.get("error")})`);
  await page.getByText("Nejdřív si nastav vlastní heslo").waitFor({ timeout: 10_000 });
  await shot(page, `13-${label}-vit`);
}

await test("desktop: admin → odhlásit → Vít 123456", () =>
  withContext(browser, errors, async (context) => {
    resetVit();
    await switchAccount(await context.newPage(), "desktop");
  }));

await test("iPhone: admin → odhlásit → Vít 123456", async () => {
  const context = await browser.newContext({ ...devices["iPhone 13"] });
  try {
    resetVit();
    await switchAccount(await context.newPage(), "iphone");
  } finally {
    await context.close();
  }
});

async function submitLogin(page, email, password, { expectOk = false } = {}) {
  await page.locator("#email").fill(email);
  await page.locator("#password").fill(password);
  await Promise.all([
    page.waitForURL((u) => (!expectOk && u.searchParams.has("error")) || !u.pathname.startsWith("/login"), { timeout: 30_000 }),
    page.getByRole("button", { name: /^přihlásit se$/i }).click(),
  ]);
}

await test("špatné heslo: hláška jmenuje účet, e-mail zůstane v poli, pokus je v auditu", () =>
  withContext(browser, errors, async (context) => {
    resetVit();
    sql(`delete from audit_log where action = 'login_failed'`);
    const page = await context.newPage();
    await page.goto(`${BASE}/login`);
    await submitLogin(page, VIT.email, "spatne-heslo");
    await page.getByText(`Nesprávné heslo k účtu ${VIT.email}`).waitFor({ timeout: 10_000 });
    await page.getByText(/Nastavit heslo/).first().waitFor();
    const kept = await page.locator("#email").inputValue();
    expect(kept === VIT.email, `e-mail v poli zůstal (je „${kept}")`);
    const pw = await page.locator("#password").inputValue();
    expect(pw === "", "heslo se vymazalo");
    await shot(page, "13-wrong-password");
    const audit = sql(`select count(*) from audit_log where action = 'login_failed' and diff->>'email' = '${VIT.email}' and diff->>'reason' = 'wrong_password'`);
    expect(audit === "1", `audit login_failed (${audit})`);
    // hned potom správné heslo ze stejného formuláře
    await submitLogin(page, VIT.email, VIT.password, { expectOk: true });
    expect(!new URL(page.url()).searchParams.has("error"), "druhý pokus se správným heslem prošel");
    await page.getByText("Nejdřív si nastav vlastní heslo").waitFor({ timeout: 10_000 });
  }));

await test("neexistující účet: řekne, že účet v systému není", () =>
  withContext(browser, errors, async (context) => {
    const page = await context.newPage();
    await page.goto(`${BASE}/login`);
    await submitLogin(page, "neexistuje@mnastrojarna.cz", "123456");
    await page.getByText("Účet neexistuje@mnastrojarna.cz v systému není").waitFor({ timeout: 10_000 });
    const n = sql(`select count(*) from audit_log where action = 'login_failed' and diff->>'email' = 'neexistuje@mnastrojarna.cz'`);
    expect(n === "0", "neexistující účet se do auditu nezapisuje");
  }));

resetVit();
sql(`delete from audit_log where action = 'login_failed'`);
await browser.close();
process.exit(summary(errors) ? 0 : 1);
