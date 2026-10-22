// E2E: účet s počátečním heslem od admina → vynucená změna hesla po prvním přihlášení.
import { BASE, launch, withContext, login, shot, sql, test, expect, summary } from "../lib.mjs";

const browser = await launch();
const errors = [];
const T = (name, fn) => test(name, () => withContext(browser, errors, fn));
const VIT = { email: "vit.volny@mnastrojarna.cz", password: "123456" };

console.log("02 · počáteční heslo a vynucená změna");

await T("Vít: přihlášení heslem 123456 → výzva ke změně → nové heslo → normální práce", async (context) => {
  // výchozí stav dle migrace (pro opakované běhy)
  sql(`update auth.users set encrypted_password = crypt('123456', gen_salt('bf')) where email = '${VIT.email}'`);
  sql(`update profiles set password_change_required = true where email = '${VIT.email}'`);
  const page = await context.newPage();
  await login(page, VIT);
  await page.getByText("Nejdřív si nastav vlastní heslo").waitFor({ timeout: 10_000 });
  await shot(page, "02-gate");
  const nav = (await page.locator("aside nav a").allInnerTexts()).join(" | ");
  expect(nav.includes("Provize") && !nav.includes("Uživatelé"), `Vít je obchodník (menu: ${nav})`);
  await page.getByRole("link", { name: /Nastavit vlastní heslo/ }).click();
  await page.waitForURL(/\/account/);
  await page.locator("#pw-current").fill("123456");
  await page.locator("#pw-new").fill("VitNoveHeslo2026!");
  await page.locator("#pw-confirm").fill("VitNoveHeslo2026!");
  await page.locator("#zmena-hesla").getByRole("button", { name: /Změnit heslo/ }).click();
  await page.getByText(/Heslo je změněné/).waitFor({ timeout: 15_000 });
  const flag = sql(`select password_change_required from profiles where email = '${VIT.email}'`);
  expect(flag === "f", `příznak zrušen, je ${flag}`);
  await page.goto(`${BASE}/orders`);
  await page.waitForTimeout(800);
  expect(!(await page.getByText("Nejdřív si nastav vlastní heslo").isVisible()), "výzva zmizela");
  await shot(page, "02-after");
  // zpět do výchozího stavu
  sql(`update auth.users set encrypted_password = crypt('123456', gen_salt('bf')) where email = '${VIT.email}'`);
  sql(`update profiles set password_change_required = true where email = '${VIT.email}'`);
});

await T("Dominik: technolog = zaměstnanec, bez provizí, s výzvou ke změně hesla", async (context) => {
  const page = await context.newPage();
  await login(page, { email: "dominik.sponer@mnastrojarna.cz", password: "123456" });
  await page.getByText("Nejdřív si nastav vlastní heslo").waitFor({ timeout: 10_000 });
  const nav = (await page.locator("aside nav a").allInnerTexts()).join(" | ");
  expect(!nav.includes("Provize") && nav.includes("Kniha zakázek"), `menu technologa: ${nav}`);
});

await browser.close();
process.exit(summary(errors) ? 0 : 1);
