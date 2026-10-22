// Pomocné funkce E2E testů (Playwright bez test runneru — jednoduché a čitelné).
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { chromium } from "playwright";

export const BASE = process.env.E2E_BASE_URL ?? "http://localhost:3100";
export const MAIL_API = process.env.LOCAL_MAIL_API ?? "http://127.0.0.1:54324";
export const ARTIFACTS = process.env.E2E_ARTIFACTS ?? path.resolve(path.dirname(new URL(import.meta.url).pathname), "artifacts");
const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), "../..");

export const USERS = {
  admin: { email: "admin@local.test", password: "Admin123!", name: "Super Admin" },
  obchod: { email: "obchod@local.test", password: "Obchod123!", name: "Petr Obchodník" },
  dilna: { email: "dilna@local.test", password: "Dilna123!", name: "Jana Zaměstnanec" },
};

fs.mkdirSync(ARTIFACTS, { recursive: true });

/** SQL do lokální DB (psql). */
export function sql(query) {
  return execFileSync(path.join(ROOT, "tools/local-supabase/psql.sh"), ["-At", "-c", query], { encoding: "utf8" }).trim();
}

export async function launch() {
  const browser = await chromium.launch({
    executablePath: process.env.CHROMIUM_PATH || undefined,
    args: ["--no-sandbox"],
  });
  return browser;
}

/** Nový kontext s logováním chyb z konzole a sítě. */
export async function newContext(browser, { mobile = false } = {}) {
  const context = await browser.newContext(
    mobile
      ? { viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, locale: "cs-CZ" }
      : { viewport: { width: 1440, height: 900 }, locale: "cs-CZ" },
  );
  const errors = [];
  context.on("page", (p) => watchPage(p, errors));
  return { context, errors };
}

function watchPage(page, errors) {
  page.on("pageerror", (e) => errors.push(`pageerror ${page.url()}: ${e.message}`));
  page.on("console", (m) => {
    if (m.type() === "error" && !/favicon|Download the React DevTools|hydrat/i.test(m.text())) {
      errors.push(`console ${page.url()}: ${m.text().slice(0, 300)}`);
    }
  });
  page.on("response", (r) => {
    if (r.status() >= 500) errors.push(`HTTP ${r.status()} ${r.url()}`);
  });
}

/** Test v čistém kontextu prohlížeče (vlastní cookies) — chyba jednoho testu neovlivní další. */
export async function withContext(browser, errors, fn, opts = {}) {
  const { context, errors: ctxErrors } = await newContext(browser, opts);
  try {
    await fn(context);
  } finally {
    errors.push(...ctxErrors);
    await context.close();
  }
}

export async function login(page, user) {
  await page.goto(`${BASE}/login`);
  await page.getByLabel(/e-mail/i).first().fill(user.email);
  await page.getByLabel(/^heslo/i).first().fill(user.password);
  await Promise.all([
    page.waitForURL((u) => !u.pathname.startsWith("/login"), { timeout: 30_000 }),
    page.getByRole("button", { name: /přihlásit/i }).click(),
  ]);
}

export async function shot(page, name) {
  const file = path.join(ARTIFACTS, `${name}.png`);
  await page.screenshot({ path: file, fullPage: true });
  return file;
}

export async function clearMail(to) {
  await fetch(`${MAIL_API}/messages${to ? `?to=${encodeURIComponent(to)}` : ""}`, { method: "DELETE" }).catch(() => {});
}

export async function latestMail(to, waitMs = 15_000) {
  const r = await fetch(`${MAIL_API}/messages/latest?to=${encodeURIComponent(to)}&wait=${waitMs}`);
  if (!r.ok) return null;
  return r.json();
}

// ── Mini runner ────────────────────────────────────────────
const results = [];
export async function test(name, fn) {
  const t0 = Date.now();
  try {
    await fn();
    results.push({ name, ok: true, ms: Date.now() - t0 });
    console.log(`  ✓ ${name} (${Date.now() - t0} ms)`);
  } catch (err) {
    results.push({ name, ok: false, ms: Date.now() - t0, error: String(err?.stack ?? err) });
    console.log(`  ✗ ${name}\n      ${String(err?.message ?? err).split("\n").slice(0, 6).join("\n      ")}`);
  }
}

export function expect(cond, message) {
  if (!cond) throw new Error(`Očekávání selhalo: ${message}`);
}

export function summary(extraErrors = []) {
  const failed = results.filter((r) => !r.ok);
  console.log(`\n${results.length - failed.length}/${results.length} testů prošlo`);
  if (extraErrors.length) {
    console.log(`\nChyby v prohlížeči (${extraErrors.length}):`);
    for (const e of [...new Set(extraErrors)].slice(0, 40)) console.log(`  · ${e}`);
  }
  fs.writeFileSync(path.join(ARTIFACTS, "results.json"), JSON.stringify({ results, browserErrors: extraErrors }, null, 2));
  return failed.length === 0;
}
