// Pomocníci suite 03 · Kniha zakázek a karta zakázky (vlastní data s prefixem „E2E-book-").
import fs from "node:fs";
import path from "node:path";
import { sql, expect } from "./lib.mjs";

export const PREFIX = "E2E-book-";
/** Unikátní značka běhu (vlastní data se nepletou s daty jiných testů). */
export const TAG = Date.now().toString(36).toUpperCase();

export const STAGE_LABELS = {
  poptavka: "Poptávka",
  naceneni: "Nacenění",
  nabidka: "Nabídka odeslaná",
  objednavka: "Objednávka",
  potvrzeno: "Potvrzená objednávka",
  ve_vyrobe: "Ve výrobě",
  dodano_k_nam: "Dodáno k nám",
  na_sklade: "Na skladě",
  montaz: "Montáž",
  dodano_zakaznikovi: "Dodáno zákazníkovi",
  fakturovano: "Vyfakturováno",
  dokonceno: "Dokončeno",
  pozastaveno: "Pozastaveno",
  reklamace: "Reklamace",
  nerealizovano: "Nerealizováno",
  zruseno: "Zrušeno",
};
export const LABEL_TO_STAGE = Object.fromEntries(Object.entries(STAGE_LABELS).map(([k, v]) => [v, k]));
export const ALL_STAGES = Object.keys(STAGE_LABELS);

/** Stavy toku před dodáním (stages.ts PRE_DELIVERY_STAGES). */
export const PRE_DELIVERY = ["objednavka", "potvrzeno", "ve_vyrobe", "dodano_k_nam", "na_sklade", "montaz"];
/** Zboží u zákazníka podle stavu (stages.ts DELIVERED_STAGES). */
export const DONE = ["dodano_zakaznikovi", "fakturovano", "dokonceno"];

/** Stavy záložek (chipy, sloupce tabule) — 31. 10.: Objednávky jen do vystavení DL, Dokončené od DL. */
export const SEGMENTS = {
  objednavky: [...PRE_DELIVERY, "pozastaveno", "reklamace"],
  poptavky: ["poptavka", "naceneni", "nabidka"],
  dokoncene: DONE,
  nerealizovane: ["nerealizovano", "zruseno"],
  vse: ALL_STAGES,
};
/** Stavy řádků v záložce: v Dokončených i stav před dodáním, když je dodáno vše (stav se neposunul). */
export const SEGMENT_ROWS = { ...SEGMENTS, dokoncene: [...PRE_DELIVERY, ...DONE] };

/** SQL: zboží je u zákazníka (= isDeliveredToCustomer v stages.ts). */
export const DELIVERED_SQL = `(status::text in (${DONE.map((s) => `'${s}'`).join(",")}) or (status::text in (${PRE_DELIVERY.map((s) => `'${s}'`).join(",")}) and items_count > 0 and items_delivered >= items_count))`;

/** SQL podmínka záložky Knihy (stejně jako bookParamsToFilters + filterJobs; volitelně jen stav `stage`). */
export function segmentWhere(key, stage = null) {
  const only = stage ? ` and status::text = '${stage}'` : "";
  const base = "merged_into_id is null";
  if (key === "objednavky") return `${base} and status::text in (${SEGMENTS.objednavky.map((s) => `'${s}'`).join(",")}) and not ${DELIVERED_SQL}${only}`;
  if (key === "dokoncene") return `${base} and ${DELIVERED_SQL}${only}`;
  return `${base} and status::text in (${SEGMENTS[key].map((s) => `'${s}'`).join(",")})${only}`;
}

/** Počet zakázek v záložce podle DB (volitelně jen stav = počet na chipu). */
export function dbSegmentCount(key, stage = null) {
  return Number(sql(`select count(*) from orders where ${segmentWhere(key, stage)}`));
}

/** Hodnota v běhu podle DB = součet orders.value objednávek v běhu (bez DL na vše). */
export function dbRunningValue() {
  return Number(sql(`select coalesce(round(sum(value), 2), 0) from orders where ${segmentWhere("objednavky")}`));
}

/** Barva plného chipu stavu (shoda se stages.ts → „solid"). */
export const STAGE_SOLID = {
  objednavka: "bg-orange-500", potvrzeno: "bg-indigo-500", ve_vyrobe: "bg-yellow-500", dodano_k_nam: "bg-cyan-500",
  na_sklade: "bg-teal-500", montaz: "bg-fuchsia-500", dodano_zakaznikovi: "bg-green-600", fakturovano: "bg-emerald-600",
  pozastaveno: "bg-zinc-500", reklamace: "bg-pink-600", poptavka: "bg-sky-500", naceneni: "bg-amber-500",
  nabidka: "bg-violet-500", dokonceno: "bg-slate-600", nerealizovano: "bg-stone-500", zruseno: "bg-red-600",
};
export const STAGE_DOT = {
  objednavka: "bg-orange-500", potvrzeno: "bg-indigo-500", ve_vyrobe: "bg-yellow-500", dodano_k_nam: "bg-cyan-500",
  na_sklade: "bg-teal-500", montaz: "bg-fuchsia-500", dodano_zakaznikovi: "bg-green-500", fakturovano: "bg-emerald-600",
  pozastaveno: "bg-zinc-400", reklamace: "bg-pink-500", poptavka: "bg-sky-500", naceneni: "bg-amber-500",
  nabidka: "bg-violet-500", dokonceno: "bg-slate-500", nerealizovano: "bg-stone-400", zruseno: "bg-red-500",
};

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

/** Opakuje kontrolu, dokud neprojde (UI se překresluje přes transition / router.refresh). */
export async function eventually(fn, { timeout = 12_000, interval = 250 } = {}) {
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

/**
 * Počká na hydrataci prvku (React připojí __reactProps…) a na konec streamování
 * (žádná skrytá kopie div#S:…[hidden]) — kliknutí před hydratací se ztrácí.
 */
export async function waitHydrated(page, css, timeout = 15_000) {
  await page.waitForFunction((sel) => {
    const el = document.querySelector(sel);
    if (!el) return false;
    if (document.querySelector('div[hidden][id^="S:"]')) return false;
    return Object.keys(el).some((k) => k.startsWith("__reactProps"));
  }, css, { timeout });
}

/** Počká, až je kniha hydratovaná a dokončila přechod (BookPending aria-busy=false). */
export async function bookIdle(page) {
  await page.waitForLoadState("domcontentloaded");
  await waitHydrated(page, 'main input[aria-label="Hledat v knize zakázek"]');
  await page.waitForFunction(() => {
    const el = document.querySelector("main [aria-busy]");
    return Boolean(el) && el.getAttribute("aria-busy") === "false";
  }, null, { timeout: 15_000 });
}

/** Řádky knihy (pohled Řádky): číslo, stav, zákazník. */
export async function readRows(page) {
  return page.locator("main ul[role=list] > li").evaluateAll((lis) =>
    lis
      .map((li) => {
        const a = li.querySelector('a[href^="/orders/"]');
        const btn = li.querySelector('button[aria-label^="Stav zakázky:"]');
        const cust = li.querySelector('a[href^="/customers/"]');
        if (!a || !btn) return null;
        const label = (btn.getAttribute("aria-label") ?? "").replace(/^Stav zakázky:\s*/, "").replace(/\s*—\s*změnit$/, "");
        return { number: a.textContent.trim(), href: a.getAttribute("href"), stageLabel: label, customer: cust?.textContent.trim() ?? null, text: li.innerText };
      })
      .filter(Boolean),
  );
}

export function rowStages(rows) {
  return rows.map((r) => LABEL_TO_STAGE[r.stageLabel] ?? `?${r.stageLabel}`);
}

/** Text „N zakázek · …" nad seznamem → N. */
export async function shownCount(page) {
  const p = page.locator("main p").filter({ has: page.locator("strong") }).filter({ hasText: /zakáz(ka|ky|ek) ·/ }).first();
  const t = await p.innerText();
  const m = /(\d+)\s+zakáz/.exec(t);
  return m ? Number(m[1]) : NaN;
}

/** Počet zakázek ve stavech podle DB. */
export function dbCount(stages) {
  return Number(sql(`select count(*) from orders where status::text in (${stages.map(lit).join(",")})`));
}

/** Stránka nepřetéká do strany. */
export async function overflow(page) {
  return page.evaluate(() => ({ sw: document.documentElement.scrollWidth, iw: window.innerWidth }));
}
export async function expectNoOverflow(page, where) {
  const o = await overflow(page);
  expect(o.sw <= o.iw + 1, `${where}: stránka nepřetéká do strany (scrollWidth ${o.sw} > innerWidth ${o.iw})`);
}

/** Prvek je celý vidět ve viewportu (vodorovně) a má nenulovou velikost. */
export async function expectInViewport(page, locator, what) {
  await locator.waitFor({ state: "visible", timeout: 10_000 });
  const box = await locator.boundingBox();
  const vw = page.viewportSize()?.width ?? 0;
  expect(box && box.width > 0 && box.height > 0, `${what}: má rozměr`);
  expect(box.x >= -1 && box.x + box.width <= vw + 1, `${what}: je celé ve viewportu (x ${Math.round(box.x)}, w ${Math.round(box.width)}, viewport ${vw})`);
}

// ── Vlastní data (SQL) ───────────────────────────────────────
/** Založí zákazníka s prefixem; vrací {id, name, number}. */
export function createCustomer(name, ownerId) {
  const row = sql(`insert into customers (name, country, owner_id, payment_terms_days) values (${lit(name)}, 'CZ', ${lit(ownerId)}, 14) returning id || '|' || customer_number`).split("\n")[0];
  const [id, number] = row.split("|");
  return { id, name, number };
}

/** Založí zakázku přes SQL (číslo z next_job_number, nic se neresetuje); vrací {id, number}. */
export function createJob(f) {
  const cols = {
    number: "next_job_number()",
    title: lit(f.title),
    status: `${lit(f.status ?? "objednavka")}::job_stage`,
    customer_id: lit(f.customerId ?? null),
    owner_id: lit(f.ownerId ?? null),
    created_by: lit(f.createdBy ?? f.ownerId ?? null),
    assignee_id: lit(f.assigneeId ?? null),
    supplier_id: lit(f.supplierId ?? null),
    customer_order_number: lit(f.cpo ?? null),
    customer_inquiry_number: lit(f.cinq ?? null),
    due_date: f.dueDays === undefined ? "null" : `current_date + ${Number(f.dueDays)}`,
    customer_required_date: f.reqDays === undefined ? "null" : `current_date + ${Number(f.reqDays)}`,
    value: f.value === undefined ? "null" : String(f.value),
    purchase_cost: f.purchaseCost === undefined ? "null" : String(f.purchaseCost),
    priority: `${lit(f.priority ?? "stredni")}::priority_level`,
    source: lit("manual"),
    invoice_number: lit(f.invoiceNumber ?? null),
    invoice_date: f.invoiceDays === undefined ? "null" : `current_date + ${Number(f.invoiceDays)}`,
    invoice_due_date: f.invoiceDueDays === undefined ? "null" : `current_date + ${Number(f.invoiceDueDays)}`,
    note: lit(f.note ?? null),
  };
  const row = sql(`insert into orders (${Object.keys(cols).join(", ")}) values (${Object.values(cols).join(", ")}) returning id || '|' || number`).split("\n")[0];
  const [id, number] = row.split("|");
  sql(`insert into job_events (job_id, type, message, data, actor_id) values (${lit(id)}, 'created', 'Zakázka založena', '{}', ${lit(f.ownerId ?? null)})`);
  // it.delivered = dodáno (vložení položky stav neposouvá — „stav se neposunul" jako u starších dat)
  (f.items ?? []).forEach((it, i) => {
    sql(`insert into order_items (order_id, position, drawing_number, revision, name, material, quantity, unit, unit_price, purchase_unit_price, delivered_quantity)
      values (${lit(id)}, ${i}, ${lit(it.drawing ?? null)}, ${lit(it.rev ?? null)}, ${lit(it.name ?? null)}, ${lit(it.material ?? null)},
      ${Number(it.qty ?? 1)}, ${lit(it.unit ?? "ks")}, ${it.price ?? "null"}, ${it.purchase ?? "null"}, ${Number(it.delivered ?? 0)})`);
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

/** Smaže soubory z úložiště (přes Storage API — přímý DELETE ze storage.objects DB zakazuje). */
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

/** Úklid vlastních dat: soubory v úložišti, nabídky, zakázky (kaskáda položek/historie/souborů), zákazníci. */
export async function cleanupOwnData() {
  const like = `${PREFIX}%`;
  const jobIds = sql(`select id from orders where title like ${lit(like)}`).split("\n").filter(Boolean);
  if (jobIds.length) {
    const inList = jobIds.map(lit).join(",");
    const paths = sql(`select storage_path from job_files where job_id in (${inList}) and storage_path is not null`).split("\n").filter(Boolean);
    await removeStorageFiles(paths);
    sql(`delete from delivery_notes where order_id in (${inList})`); // DL dodávek (order_id on delete set null)
    sql(`update orders set quote_id = null where id in (${inList})`);
    sql(`delete from quote_items where quote_id in (select id from quotes where job_id in (${inList}))`);
    sql(`delete from quotes where job_id in (${inList})`);
    sql(`update emails set order_id = null where order_id in (${inList})`);
    sql(`delete from approval_queue where order_id in (${inList})`);
    sql(`delete from orders where id in (${inList})`);
  }
  const custIds = sql(`select id from customers where name like ${lit(like)}`).split("\n").filter(Boolean);
  if (custIds.length) {
    const inList = custIds.map(lit).join(",");
    sql(`delete from customer_contacts where customer_id in (${inList})`);
    sql(`delete from customers where id in (${inList}) and not exists (select 1 from orders o where o.customer_id = customers.id)`);
  }
  return { jobs: jobIds.length, customers: custIds.length };
}
