// E2E: přihlášení, menu dle rolí, ochrana stránek a API, obnova hesla kódem,
// správa uživatelů (super admin), pošta per uživatel.
import { BASE, USERS, launch, withContext, login, shot, clearMail, latestMail, sql, test, expect, summary } from "../lib.mjs";

const browser = await launch();
const errors = [];
/** Každý test běží v čistém kontextu. */
const T = (name, fn) => test(name, () => withContext(browser, errors, fn));

async function navTexts(page) {
  return (await page.locator("aside nav a").allInnerTexts()).map((t) => t.replace(/\s+\d+$/, "").trim());
}

console.log("01 · přihlášení, role, obnova hesla, uživatelé, pošta");

await T("nepřihlášený → /login, API vrací 401", async (context) => {
  const page = await context.newPage();
  await page.goto(`${BASE}/orders`);
  expect(page.url().includes("/login"), `přesměrování na login, je ${page.url()}`);
  expect(await page.getByText("Zapomenuté heslo?").isVisible(), "odkaz Zapomenuté heslo");
  await shot(page, "01-login");
  const r = await page.request.get(`${BASE}/api/search`);
  expect(r.status() === 401, `API /api/search bez přihlášení = 401, je ${r.status()}`);
  await page.close();
});

await T("super admin: přihlášení → Kniha zakázek, plné menu", async (context) => {
  const page = await context.newPage();
  await login(page, USERS.admin);
  expect(new URL(page.url()).pathname === "/orders", `po přihlášení /orders, je ${page.url()}`);
  const nav = await navTexts(page);
  for (const item of ["Kniha zakázek", "Uživatelé", "AI Asistent", "Archiv výkresů", "Znalostní DB", "Nastavení", "Přijatá pošta"]) {
    expect(nav.some((t) => t.includes(item)), `admin vidí „${item}" (menu: ${nav.join(", ")})`);
  }
  await shot(page, "01-admin-orders");
  await page.close();
  await context.clearCookies();
});

await T("obchodník: bez AI, výkresů, znalostí, nastavení a uživatelů", async (context) => {
  const page = await context.newPage();
  await login(page, USERS.obchod);
  const nav = await navTexts(page);
  for (const item of ["Kniha zakázek", "Zákazníci", "Dodavatelé", "Přijatá pošta", "Provize"]) {
    expect(nav.some((t) => t.includes(item)), `obchodník vidí „${item}"`);
  }
  for (const item of ["AI Asistent", "Archiv výkresů", "Znalostní DB", "Nastavení", "Uživatelé", "AI přehled", "Ladění"]) {
    expect(!nav.some((t) => t.includes(item)), `obchodník NEvidí „${item}" (menu: ${nav.join(", ")})`);
  }
  // stránky za skeletonem (loading.tsx) přesměrují po načtení kostry — počkej na URL
  await page.goto(`${BASE}/users`);
  await page.waitForURL(/pristup=users/, { timeout: 10_000 });
  expect(!(await page.locator("main").innerText()).includes("obchod@local.test"), "seznam uživatelů se neukázal");
  await page.goto(`${BASE}/settings`);
  await page.waitForURL(/pristup=settings/, { timeout: 10_000 });
  const r = await page.request.post(`${BASE}/api/emails/categorize`, { data: {} });
  expect(r.status() === 403, `AI kategorizace pro obchodníka = 403, je ${r.status()}`);
  await page.close();
  await context.clearCookies();
});

await T("zaměstnanec: bez provizí", async (context) => {
  const page = await context.newPage();
  await login(page, USERS.dilna);
  const nav = await navTexts(page);
  expect(!nav.some((t) => t.includes("Provize")), "zaměstnanec nevidí Provize");
  expect(nav.some((t) => t.includes("Kniha zakázek")), "zaměstnanec vidí Knihu zakázek");
  await shot(page, "01-dilna-orders");
  await page.close();
  await context.clearCookies();
});

await T("pošta: obchodník vidí jen svou schránku, admin vše", async (context) => {
  const page = await context.newPage();
  await login(page, USERS.obchod);
  await page.goto(`${BASE}/inbox`);
  await page.waitForLoadState("networkidle");
  const body = await page.locator("main").innerText();
  expect(body.includes("upínky VK-2291"), "obchodník vidí e-mail ze své schránky");
  expect(!body.includes("PO-4500021877"), "obchodník NEvidí e-mail z firemní schránky");
  expect(!body.includes("Kalení čepů"), "obchodník NEvidí e-mail dílny");
  await shot(page, "01-inbox-obchod");
  await page.close();
  await context.clearCookies();

  const p2 = await context.newPage();
  await login(p2, USERS.admin);
  await p2.goto(`${BASE}/inbox`);
  await p2.waitForLoadState("networkidle");
  const all = await p2.locator("main").innerText();
  expect(all.includes("upínky VK-2291") && all.includes("PO-4500021877") && all.includes("Kalení čepů"), "admin vidí poštu všech schránek");
  await shot(p2, "01-inbox-admin");
  await p2.close();
  await context.clearCookies();
});

await T("zapomenuté heslo: kód z e-mailu → nové heslo → přihlášen", async (context) => {
  await clearMail(USERS.dilna.email);
  sql(`delete from password_reset_codes where email = '${USERS.dilna.email}'`); // limit 3 kódy / 15 min
  const page = await context.newPage();
  await page.goto(`${BASE}/login`);
  await page.getByText("Zapomenuté heslo?").click();
  await page.waitForURL(/forgot-password/);
  await page.getByLabel("E-mail k účtu").fill(USERS.dilna.email);
  await page.getByRole("button", { name: /Poslat kód/ }).click();
  const mail = await latestMail(USERS.dilna.email);
  expect(mail && mail.otp, `přišel e-mail s kódem (${JSON.stringify(mail)?.slice(0, 200)})`);
  expect(!/Reset Your Password/i.test(mail.subject), `e-mail z firemního SMTP (vlastní šablona), ne ze Supabase: ${mail.subject}`);
  await shot(page, "01-forgot-code-step");
  // špatný kód
  await page.getByLabel("Kód z e-mailu").fill(mail.otp === "000000" ? "111111" : "000000");
  await page.getByLabel("Nové heslo", { exact: true }).fill("NoveHeslo123!");
  await page.getByLabel("Nové heslo znovu").fill("NoveHeslo123!");
  await page.getByRole("button", { name: /Nastavit nové heslo/ }).click();
  await page.getByText(/nesouhlasí/i).first().waitFor({ timeout: 10_000 });
  // správný kód
  await page.getByLabel("Kód z e-mailu").fill(mail.otp);
  await Promise.all([
    page.waitForURL((u) => u.pathname.startsWith("/orders") || u.pathname.startsWith("/login"), { timeout: 30_000 }),
    page.getByRole("button", { name: /Nastavit nové heslo/ }).click(),
  ]);
  expect(new URL(page.url()).pathname === "/orders", `po resetu přihlášen v /orders, je ${page.url()}`);
  await page.close();
  await context.clearCookies();
  // nové heslo funguje
  const p2 = await context.newPage();
  await login(p2, { ...USERS.dilna, password: "NoveHeslo123!" });
  expect(new URL(p2.url()).pathname === "/orders", "přihlášení novým heslem");
  await p2.close();
  await context.clearCookies();
  // zpět na původní heslo (pro další testy)
  sql(`update auth.users set encrypted_password = crypt('${USERS.dilna.password}', gen_salt('bf')) where email = '${USERS.dilna.email}'`);
});

await T("uživatelé: admin založí účet, nový uživatel se přihlásí", async (context) => {
  const email = `novy.${Date.now()}@local.test`;
  const page = await context.newPage();
  await login(page, USERS.admin);
  await page.goto(`${BASE}/users`);
  await shot(page, "01-users");
  await page.getByRole("button", { name: /Přidat uživatele/ }).first().click();
  await page.getByLabel("Jméno a příjmení").fill("Tomáš Nový");
  await page.getByLabel("E-mail (přihlašovací jméno)").fill(email);
  await page.getByLabel("Heslo", { exact: true }).fill("TestHeslo123!");
  await page.getByRole("radiogroup", { name: "Role" }).getByText("Zaměstnanec", { exact: true }).click();
  await page.getByRole("button", { name: /Vytvořit účet/ }).click();
  await page.getByText(/Účet je připraven/).waitFor({ timeout: 15_000 });
  await shot(page, "01-users-created");
  await page.close();
  await context.clearCookies();
  const p2 = await context.newPage();
  await login(p2, { email, password: "TestHeslo123!" });
  expect(new URL(p2.url()).pathname === "/orders", `nový uživatel přihlášen, je ${p2.url()}`);
  const role = sql(`select role || ',' || active from profiles where email = '${email}'`);
  expect(role === "zamestnanec,true", `profil zaměstnanec + aktivní, je ${role}`);
  await p2.close();
  await context.clearCookies();
  sql(`delete from auth.users where email = '${email}'`);
});

await T("registrace bez pozvánky = neaktivní účet bez přístupu", async (context) => {
  const email = `cizi.${Date.now()}@local.test`;
  const env = Object.fromEntries(
    (await import("node:fs")).readFileSync(new URL("../../../.local-supabase/env", import.meta.url), "utf8")
      .split("\n").filter((l) => l.includes("=")).map((l) => [l.slice(0, l.indexOf("=")), l.slice(l.indexOf("=") + 1)]),
  );
  const r = await fetch(`${env.NEXT_PUBLIC_SUPABASE_URL}/auth/v1/signup`, {
    method: "POST",
    headers: { apikey: env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY, "content-type": "application/json" },
    body: JSON.stringify({ email, password: "Hacker123!", data: { role: "super_admin" } }),
  });
  expect(r.ok, `signup přes API (${r.status})`);
  const prof = sql(`select role || ',' || active from profiles where email = '${email}'`);
  expect(prof === "zamestnanec,false", `samoregistrace = neaktivní zaměstnanec, je ${prof}`);
  const page = await context.newPage();
  await page.goto(`${BASE}/login`);
  await page.getByLabel(/e-mail/i).first().fill(email);
  await page.getByLabel(/^heslo/i).first().fill("Hacker123!");
  await page.getByRole("button", { name: /přihlásit/i }).click();
  await page.waitForTimeout(2500);
  expect(new URL(page.url()).pathname === "/login", `neaktivní zůstává na loginu, je ${page.url()}`);
  expect((await page.locator("body").innerText()).includes("není aktivní"), "hláška o neaktivním účtu");
  await page.close();
  await context.clearCookies();
  sql(`delete from auth.users where email = '${email}'`);
});

await browser.close();
process.exit(summary(errors) ? 0 : 1);
