// Pomocníci suite 05 · Nabídky, doklady (PDF + e-mail) a stránky obchodního toku.
// Vlastní data mají prefix „E2E-quotes-docs-flow-" a na konci se uklidí.
// Jen testovací kód — aplikaci nemění.
import fs from "node:fs";
import path from "node:path";
import { sql, expect, MAIL_API } from "./lib.mjs";

export const PREFIX = "E2E-quotes-docs-flow-";
/** Unikátní značka běhu. */
export const TAG = Date.now().toString(36).toUpperCase();
export const TAG_LC = TAG.toLowerCase();

/** SQL literál. */
export const lit = (v) => (v === null || v === undefined ? "null" : `'${String(v).replace(/'/g, "''")}'`);

let cachedIds = null;
export function userIds() {
  if (cachedIds) return cachedIds;
  const rows = sql(`select email || '=' || id from profiles where email in ('admin@local.test','obchod@local.test','dilna@local.test')`).split("\n");
  const m = Object.fromEntries(rows.map((r) => r.split("=")));
  cachedIds = { admin: m["admin@local.test"], obchod: m["obchod@local.test"], dilna: m["dilna@local.test"] };
  return cachedIds;
}

/** Opakuje kontrolu, dokud neprojde. */
export async function eventually(fn, { timeout = 15_000, interval = 300 } = {}) {
  const t0 = Date.now();
  let last;
  for (;;) {
    try {
      return await fn();
    } catch (err) {
      last = err;
      if (Date.now() - t0 > timeout) throw last;
      await new Promise((r) => setTimeout(r, interval));
    }
  }
}

/** Počká na hydrataci prvku a konec streamování (kliknutí před hydratací se ztrácí). */
export async function waitHydrated(page, css, timeout = 20_000) {
  await page.waitForFunction((sel) => {
    const el = document.querySelector(sel);
    if (!el) return false;
    if (document.querySelector('div[hidden][id^="S:"]')) return false;
    return Object.keys(el).some((k) => k.startsWith("__reactProps"));
  }, css, { timeout });
}

/** Stránka nepřetéká do strany. */
export async function expectNoOverflow(page, where) {
  const o = await page.evaluate(() => {
    const iw = window.innerWidth;
    const sw = document.documentElement.scrollWidth;
    // co přečnívá (pro report)
    const wide = [...document.querySelectorAll("body *")]
      .filter((el) => {
        const r = el.getBoundingClientRect();
        return r.width > 0 && r.right > iw + 1 && getComputedStyle(el).position !== "fixed";
      })
      .slice(0, 3)
      .map((el) => `${el.tagName.toLowerCase()}.${String(el.className).slice(0, 60)} (right ${Math.round(el.getBoundingClientRect().right)})`);
    return { sw, iw, wide };
  });
  expect(o.sw <= o.iw + 1, `${where}: stránka nepřetéká do strany (scrollWidth ${o.sw} > innerWidth ${o.iw}; ${o.wide.join(" | ")})`);
}

/** Toast (role=status / alert) s textem. */
export async function waitToast(page, re, timeout = 20_000) {
  const t = page.locator('[role="status"], [role="alert"]').filter({ hasText: re }).first();
  await t.waitFor({ state: "visible", timeout });
  return (await t.innerText()).replace(/\s+/g, " ").trim();
}

/** Žádná chybová hláška (role=alert) neobsahuje text. */
export async function alertTexts(page) {
  return (await page.locator('[role="alert"]').allInnerTexts()).map((t) => t.replace(/\s+/g, " ").trim()).filter(Boolean);
}

/** ISO datum (Praha) + n dní. */
export function isoDays(n) {
  const now = new Date(new Date().toLocaleString("en-US", { timeZone: "Europe/Prague" }));
  now.setDate(now.getDate() + n);
  const p = (x) => String(x).padStart(2, "0");
  return `${now.getFullYear()}-${p(now.getMonth() + 1)}-${p(now.getDate())}`;
}

// ── PDF ──────────────────────────────────────────────────────
/** GET přes cookies kontextu → {status, type, disposition, head, size}. */
export async function fetchPdf(request, url) {
  const r = await request.get(url, { maxRedirects: 5 });
  const body = await r.body().catch(() => Buffer.alloc(0));
  return {
    status: r.status(),
    type: r.headers()["content-type"] ?? "",
    disposition: r.headers()["content-disposition"] ?? "",
    head: body.subarray(0, 5).toString("latin1"),
    size: body.length,
    text: r.status() >= 400 ? body.toString("utf8").slice(0, 200) : "",
  };
}

export function expectPdf(res, what) {
  expect(res.status === 200, `${what}: HTTP 200, je ${res.status} ${res.text}`);
  expect(res.type.startsWith("application/pdf"), `${what}: Content-Type application/pdf, je „${res.type}"`);
  expect(res.head.startsWith("%PDF"), `${what}: tělo začíná %PDF, je „${res.head}"`);
  expect(res.size > 1500, `${what}: PDF má rozumnou velikost (${res.size} B)`);
}

// ── Pošta (mail catcher) ─────────────────────────────────────
export async function mailsTo(to) {
  const r = await fetch(`${MAIL_API}/messages?to=${encodeURIComponent(to)}`).catch(() => null);
  if (!r?.ok) return [];
  return r.json();
}

/** Počká na zprávu pro adresáta, která splní podmínku. */
export async function waitMail(to, pred, timeout = 20_000) {
  const t0 = Date.now();
  for (;;) {
    const found = (await mailsTo(to)).filter(pred);
    if (found.length) return found[found.length - 1];
    if (Date.now() - t0 > timeout) return null;
    await new Promise((r) => setTimeout(r, 400));
  }
}

// ── Vlastní data (SQL) ───────────────────────────────────────
export function createCustomer({ name, email, ownerId, contact = "Ing. Eva Testová", paymentDays = 14 }) {
  const row = sql(`insert into customers (name, country, owner_id, payment_terms_days, email, contact_person, city, street, zip, ico)
    values (${lit(name)}, 'CZ', ${lit(ownerId)}, ${paymentDays}, ${lit(email)}, ${lit(contact)}, 'Brno', 'Testovací 5', '602 00', '12345678')
    returning id || '|' || coalesce(customer_number, '')`).split("\n")[0];
  const [id, number] = row.split("|");
  return { id, name, number, email };
}

/** Zakázka přes SQL (číslo z next_job_number — čítač se nikdy neresetuje). */
export function createJob(f) {
  const cols = {
    number: "next_job_number()",
    title: lit(f.title),
    status: `${lit(f.status ?? "objednavka")}::job_stage`,
    customer_id: lit(f.customerId ?? null),
    owner_id: lit(f.ownerId ?? null),
    created_by: lit(f.ownerId ?? null),
    customer_order_number: lit(f.cpo ?? null),
    customer_inquiry_number: lit(f.cinq ?? null),
    // data i očekávání v jednom pásmu: pražský den (app_today), ne UTC current_date — jinak 23:00–24:00 UTC posun o den
    due_date: f.dueDays === undefined ? "null" : `app_today() + ${Number(f.dueDays)}`,
    customer_required_date: f.reqDays === undefined ? "null" : `app_today() + ${Number(f.reqDays)}`,
    order_date: f.status && !["poptavka", "naceneni", "nabidka"].includes(f.status) ? "app_today() - 2" : "null",
    inquiry_date: "app_today() - 5",
    value: f.value === undefined ? "null" : String(f.value),
    purchase_cost: f.purchaseCost === undefined ? "null" : String(f.purchaseCost),
    priority: `${lit(f.priority ?? "stredni")}::priority_level`,
    source: lit("manual"),
    customer_contact: lit(f.contact ?? null),
  };
  const row = sql(`insert into orders (${Object.keys(cols).join(", ")}) values (${Object.values(cols).join(", ")}) returning id || '|' || number`).split("\n")[0];
  const [id, number] = row.split("|");
  sql(`insert into job_events (job_id, type, message, data, actor_id) values (${lit(id)}, 'created', 'Zakázka založena', '{}', ${lit(f.ownerId ?? null)})`);
  (f.items ?? []).forEach((it, i) => {
    sql(`insert into order_items (order_id, position, drawing_number, revision, name, material, quantity, unit, unit_price, purchase_unit_price)
      values (${lit(id)}, ${i}, ${lit(it.drawing ?? null)}, ${lit(it.rev ?? null)}, ${lit(it.name ?? null)}, ${lit(it.material ?? null)},
      ${Number(it.qty ?? 1)}, 'ks', ${it.price ?? "null"}, ${it.purchase ?? "null"})`);
  });
  return { id, number, title: f.title };
}

/** Nabídka přes SQL s vlastním číslem (nespotřebuje čítač NAB). */
export function createQuote(job, { number, status = "ke_schvaleni", approvedBy = null, createdBy, customerId, items = [], validDays = 30, sent = false, approvalRequested = false }) {
  const total = items.reduce((s, it) => (it.price === null || it.price === undefined ? s : s + it.price * (it.qty ?? 1)), 0) || null;
  // approvalRequested: autor požádal o schválení → podrobný stav „Čeká na schválení“
  const id = sql(`insert into quotes (number, job_id, customer_id, status, total, currency, valid_until, revision, created_by, owner_id, approved_by, approved_at, lead_time_days, archived, sent_at, title, approval_requested_at, approval_requested_by)
    values (${lit(number)}, ${lit(job.id)}, ${lit(customerId)}, ${lit(status)}::quote_status, ${total ?? "null"}, 'CZK', app_today() + ${validDays}, 1, ${lit(createdBy)}, ${lit(createdBy)},
      ${lit(approvedBy)}, ${approvedBy ? "now()" : "null"}, 14, false, ${sent ? "now()" : "null"}, ${lit(job.title)},
      ${approvalRequested ? "now()" : "null"}, ${approvalRequested ? lit(createdBy) : "null"})
    returning id`).split("\n")[0];
  items.forEach((it, i) => {
    sql(`insert into quote_items (quote_id, position, drawing_number, name, quantity, unit, unit_price, purchase_unit_price)
      values (${lit(id)}, ${i}, ${lit(it.drawing ?? null)}, ${lit(it.name ?? null)}, ${Number(it.qty ?? 1)}, 'ks', ${it.price ?? "null"}, ${it.purchase ?? "null"})`);
  });
  return { id, number };
}

function localEnv() {
  const file = path.resolve(path.dirname(new URL(import.meta.url).pathname), "../../.local-supabase/env");
  try {
    return Object.fromEntries(fs.readFileSync(file, "utf8").split("\n").filter((l) => l.includes("="))
      .map((l) => [l.slice(0, l.indexOf("=")), l.slice(l.indexOf("=") + 1)]));
  } catch {
    return {};
  }
}

/** Smaže soubory z úložiště job-files (přes Storage API). */
export async function removeStorageFiles(paths) {
  if (!paths.length) return true;
  const env = localEnv();
  if (!env.NEXT_PUBLIC_SUPABASE_URL || !env.SUPABASE_SECRET_KEY) return false;
  const r = await fetch(`${env.NEXT_PUBLIC_SUPABASE_URL}/storage/v1/object/job-files`, {
    method: "DELETE",
    headers: { apikey: env.SUPABASE_SECRET_KEY, authorization: `Bearer ${env.SUPABASE_SECRET_KEY}`, "content-type": "application/json" },
    body: JSON.stringify({ prefixes: paths }),
  }).catch(() => null);
  return Boolean(r?.ok);
}

/**
 * Úklid vlastních dat (prefix): soubory v úložišti, odeslané e-maily, faktury a archiv
 * dokladů, nabídky, zakázky (kaskáda položek / historie / souborů), zákazníci.
 */
export async function cleanupOwnData() {
  const like = `${PREFIX}%`;
  const jobIds = sql(`select id from orders where title like ${lit(like)}`).split("\n").filter(Boolean);
  const custIds = sql(`select id from customers where name like ${lit(like)}`).split("\n").filter(Boolean);
  if (jobIds.length) {
    const inList = jobIds.map(lit).join(",");
    const paths = sql(`select storage_path from job_files where job_id in (${inList}) and storage_path is not null`).split("\n").filter(Boolean);
    await removeStorageFiles(paths);
    sql(`delete from documents where order_id in (${inList})`);
    sql(`delete from delivery_notes where order_id in (${inList})`); // DL dodávek (order_id on delete set null)
    sql(`delete from invoices where order_id in (${inList})`);
    sql(`delete from emails where order_id in (${inList}) and direction = 'out'`);
    sql(`update emails set order_id = null where order_id in (${inList})`);
    sql(`delete from approval_queue where order_id in (${inList})`);
    sql(`update orders set quote_id = null where id in (${inList})`);
    sql(`update job_files set quote_id = null where job_id in (${inList})`);
    sql(`delete from quote_items where quote_id in (select id from quotes where job_id in (${inList}))`);
    sql(`delete from quotes where job_id in (${inList})`);
    sql(`delete from orders where id in (${inList})`);
  }
  if (custIds.length) {
    const inList = custIds.map(lit).join(",");
    sql(`delete from customer_contacts where customer_id in (${inList})`);
    sql(`delete from customers where id in (${inList}) and not exists (select 1 from orders o where o.customer_id = customers.id)`);
  }
  return { jobs: jobIds.length, customers: custIds.length };
}
