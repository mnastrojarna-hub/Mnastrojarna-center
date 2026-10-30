// E2E: objednávka bez čísel výkresů k zakázce, která položky už má (majitel 30. 10., Z-2026-022 —
// „AI při nahrání očividně nahrála dvě položky duplicitně"). Server MUSÍ běžet s
//   AI_FAKE_CAPTURE=<repo>/src/lib/jobs/__fixtures__/capture/objednavka-bez-vykresu.json
// (2 řádky „Unašeč upravený 142/026" 4 ks á 18 630, „Matice upravená 142/026" 8 ks á 9 620, celkem 151 480).
//  1) screenshot: objednávka se k zakázce SPÁRUJE → 2 položky, součet = objednávka, nic nepřibude
//  2) nejistý řádek (jiný název položky) → otázka s kontrolou součtu, bez odpovědi neuloží, „Ano" spáruje
//  3) stará data: banner „Vypadá to na duplicitní položky (2) — Sloučit" → 2 položky, odkazy přesunuté
//  4) mobil 390 px: banner i otázka bez přetékání
// Vlastní data: zakázky E2E-PAIR-<běh>; vše se po sobě uklidí.
import fs from "node:fs";
import path from "node:path";
import { ARTIFACTS, BASE, USERS, launch, newContext, login, shot, sql, test, expect, summary } from "../lib.mjs";
import {
  captureDialog, clientBuildLacksSupabaseEnv, deleteJobDeep, insertItem, insertJob, installEnvShim, noHorizontalOverflow,
  pngFile, q, removeStorage, sqlJson, userId,
} from "../lib-capture.mjs";

const OUT = process.env.PAIRING_SHOTS ?? path.join(ARTIFACTS, "pairing");
fs.mkdirSync(OUT, { recursive: true });
const RUN = Date.now().toString(36);
const STROJMETAL = "d2000000-0000-0000-0000-000000000001";
const ADMIN_ID = userId(USERS.admin.email);

const browser = await launch();
const errors = [];
const cleanup = { jobs: new Set(), storagePaths: new Set() };

let needShim = false;
{
  const { context } = await newContext(browser);
  const page = await context.newPage();
  await login(page, USERS.admin);
  await page.goto(`${BASE}/orders`);
  await page.waitForLoadState("networkidle");
  needShim = await clientBuildLacksSupabaseEnv(page);
  await context.close();
}

async function inContext(fn, opts = {}) {
  const { context, errors: ctxErrors } = await newContext(browser, opts);
  if (needShim) await installEnvShim(context);
  try {
    await fn(context);
  } finally {
    errors.push(...ctxErrors);
    await context.close();
  }
}
const T = (name, fn, opts) => test(name, () => inContext(fn, opts));
const snap = async (page, name, focus = null) => {
  if (focus) {
    await focus.first().scrollIntoViewIfNeeded().catch(() => undefined);
    await page.waitForTimeout(300);
  }
  await page.screenshot({ path: path.join(OUT, `${name}.png`), fullPage: !focus });
  await shot(page, `pairing-${name}`).catch(() => undefined);
};

async function waitEnabled(locator, timeout = 30_000) {
  const t0 = Date.now();
  while (Date.now() - t0 < timeout) {
    if (await locator.isVisible().catch(() => false) && await locator.isEnabled().catch(() => false)) return;
    await new Promise((r) => setTimeout(r, 150));
  }
  throw new Error(`Prvek nebyl povolen do ${timeout} ms`);
}

/** Zakázka jako ve screenshotu (položky z poptávky / výkresů, hodnota = rozpočet objednávky). */
function seedJob(letter, { names = ["Unašeč upravený", "Matice upravená"], duplicates = false } = {}) {
  const number = `E2E-PAIR-${letter}-${RUN}`;
  const id = insertJob({ number, title: `${number} Unašeč + matice`, customerId: STROJMETAL, stage: "ve_vyrobe", ownerId: ADMIN_ID, extra: { value: 151480, currency: "CZK" } });
  cleanup.jobs.add(id);
  insertItem(id, { position: 0, drawingNumber: "F0N603W88", revision: "02", name: names[0], material: "14220", quantity: 4, unitPrice: 18630 });
  insertItem(id, { position: 1, drawingNumber: "EM7223CL0000", revision: "02", name: names[1], material: "14220", quantity: 8, unitPrice: 9620 });
  if (duplicates) {
    sql(`insert into order_items (order_id, position, name, description, quantity, unit, unit_price) values
      (${q(id)}, 2, 'Unašeč upravený', 'Unašeč upravený 142/026', 4, 'ks', 18630),
      (${q(id)}, 3, 'Matice upravená', 'Matice upravená 142/026', 8, 'ks', 9620)`);
  }
  return { id, number };
}

const itemRows = (jobId) => sqlJson(`select json_agg(i order by position) from (select id, position, drawing_number, revision, material, name, description, quantity::float as quantity, unit_price::float as unit_price from order_items where order_id = ${q(jobId)}) i`) ?? [];
const total = (rows) => rows.reduce((s, r) => s + r.quantity * r.unit_price, 0);

async function captureOnJob(page, job, file) {
  await page.goto(`${BASE}/orders/${job.id}`);
  // desktop „Přidat doklad (foto)", mobil „Foto"
  await page.getByRole("button", { name: /^(Přidat doklad \(foto\)|Foto)$/ }).locator("visible=true").first().click();
  const dlg = captureDialog(page);
  await dlg.waitFor();
  await page.getByTestId("capture-files-input").setInputFiles([pngFile(file, 7)]);
  await waitEnabled(page.getByTestId("capture-read"));
  const [resp] = await Promise.all([
    page.waitForResponse((r) => r.url().includes("/api/jobs/capture/analyze"), { timeout: 90_000 }),
    page.getByTestId("capture-read").click(),
  ]);
  const body = await resp.json().catch(() => ({}));
  expect(body.ok, `analyze ok (${JSON.stringify(body).slice(0, 300)})`);
  await page.getByTestId("capture-save").waitFor({ timeout: 30_000 });
  return { dlg, model: body.model };
}

async function save(page) {
  const [resp] = await Promise.all([
    page.waitForResponse((r) => r.url().includes("/api/jobs/capture/apply"), { timeout: 60_000 }),
    page.getByTestId("capture-save").click(),
  ]);
  return resp.json().catch(() => ({}));
}

function trackFiles(jobId) {
  const f = sqlJson(`select json_agg(f) from (select storage_path from job_files where job_id = ${q(jobId)}) f`) ?? [];
  f.forEach((x) => cleanup.storagePaths.add(x.storage_path));
}

// ═════════════════════════════════════════════════════════════
await T("screenshot Z-2026-022: objednávka bez čísel výkresů se spáruje → 2 položky, součet = objednávka 151 480", async (context) => {
  const job = seedJob("A");
  const page = await context.newPage();
  await login(page, USERS.admin);
  const { dlg, model } = await captureOnJob(page, job, `pair-a-${RUN}.png`);
  expect(model.initial.items.length === 0, `žádný nový řádek (${JSON.stringify(model.initial.items).slice(0, 300)})`);
  expect(model.initial.merges.length === 2, `2 doplnění existujících položek (${model.initial.merges.length})`);
  const t = await dlg.innerText();
  expect(/Doplnit k položce F0N603W88 Unašeč upravený/.test(t) && /Doplnit k položce EM7223CL0000 Matice upravená/.test(t), "kontrola: doplnění k položkám s výkresem");
  expect(!(await page.getByTestId("pair-questions").count()), "bez otázky (vše jisté)");
  await snap(page, "a-review-desktop", dlg.getByText("Položky", { exact: true }));
  const res = await save(page);
  expect(res.ok && res.created === false, `uloženo k zakázce (${JSON.stringify(res).slice(0, 200)})`);
  trackFiles(job.id);
  const rows = itemRows(job.id);
  expect(rows.length === 2, `2 položky (${rows.length})`);
  expect(total(rows) === 151480, `součet = objednávka (${total(rows)})`);
  expect(rows.every((r) => r.drawing_number && r.revision === "02" && r.material === "14220"), "číslo výkresu, revize, materiál zůstaly");
  expect(rows[0].description === "Unašeč upravený 142/026", `text řádku objednávky u položky (${rows[0].description})`);
  await page.getByRole("button", { name: "Hotovo" }).click().catch(() => undefined);
  await page.goto(`${BASE}/orders/${job.id}?tab=polozky`);
  await page.getByRole("tab", { name: /Položky/ }).click();
  await page.locator("input[aria-label=\"Číslo výkresu\"]:visible").first().waitFor({ timeout: 15_000 });
  expect(!(await page.getByTestId("duplicate-items").count()), "žádný banner duplicit");
  await snap(page, "a-items-after-desktop");
  await page.close();
});

await T("nejistý řádek: otázka „Řádek objednávky … = položka 1 F0N603W88?“ se součtem, bez odpovědi neuloží, „Ano“ spáruje", async (context) => {
  const job = seedJob("B", { names: ["Díl A", "Matice upravená"] });
  const page = await context.newPage();
  await login(page, USERS.admin);
  await captureOnJob(page, job, `pair-b-${RUN}.png`);
  const qbox = page.getByTestId("pair-questions");
  await qbox.waitFor({ timeout: 10_000 });
  const qt = await qbox.innerText();
  expect(/Řádek objednávky „Unašeč upravený“ = položka 1 F0N603W88 rev\. 02 Díl A\?/.test(qt), `otázka: ${qt}`);
  expect(/Součet položek 226\s000,00\sKč ≠ objednávka 151\s480,00\sKč/.test(qt), `kontrola součtu v otázce: ${qt}`);
  await snap(page, "b-question-desktop", qbox);
  // bez odpovědi uložit nejde
  await page.getByTestId("capture-save").click();
  await page.getByText(/Rozhodni u řádku „Unašeč upravený“/).first().waitFor({ timeout: 10_000 });
  expect(itemRows(job.id).length === 2, "nic nepřibylo");
  await page.getByTestId("pair-yes").click();
  expect(!(await page.getByTestId("pair-questions").count()), "otázka zmizela");
  const res = await save(page);
  expect(res.ok, `uloženo (${JSON.stringify(res).slice(0, 200)})`);
  trackFiles(job.id);
  const rows = itemRows(job.id);
  expect(rows.length === 2 && total(rows) === 151480, `2 položky, součet = objednávka (${rows.length}, ${total(rows)})`);
  expect(rows[0].description === "Unašeč upravený 142/026", "řádek zapsán k položce 1");
  await page.close();
});

await T("stará data: banner „Vypadá to na duplicitní položky (2) — Sloučit“ → 2 položky, odkazy na duplicitu přesunuté, historie", async (context) => {
  const job = seedJob("C", { duplicates: true });
  const before = itemRows(job.id);
  expect(before.length === 4 && total(before) === 302960, `seed: 4 položky, 2× součet (${total(before)})`);
  const poId = sql(`insert into purchase_orders (job_id) values (${q(job.id)}) returning id`).split("\n")[0].trim();
  sql(`insert into purchase_order_items (purchase_order_id, order_item_id, name, quantity) values (${q(poId)}, ${q(before[2].id)}, 'Unašeč', 4)`);
  const page = await context.newPage();
  await login(page, USERS.admin);
  await page.goto(`${BASE}/orders/${job.id}`);
  await page.getByRole("tab", { name: /Položky/ }).click();
  const banner = page.getByTestId("duplicate-items");
  await banner.waitFor({ timeout: 15_000 });
  const bt = await banner.innerText();
  expect(/Vypadá to na duplicitní položky \(2\)/.test(bt), `banner: ${bt}`);
  expect(/F0N603W88/.test(bt) && /EM7223CL0000/.test(bt), "banner jmenuje položky s výkresem");
  await snap(page, "c-duplicates-before-desktop");
  await page.getByTestId("duplicate-merge").click();
  await banner.waitFor({ state: "detached", timeout: 20_000 });
  const rows = itemRows(job.id);
  expect(rows.length === 2 && rows.every((r) => r.drawing_number), `zůstaly 2 položky s výkresem (${JSON.stringify(rows)})`);
  expect(total(rows) === 151480, "součet = objednávka");
  expect(sql(`select order_item_id from purchase_order_items where purchase_order_id = ${q(poId)}`) === before[0].id, "objednávka dodavateli přesunuta na položku s výkresem");
  const ev = sqlJson(`select json_agg(e) from (select actor_id, message from job_events where job_id = ${q(job.id)} and message like 'Sloučeny duplicitní položky%') e`) ?? [];
  expect(ev.length === 1 && ev[0].actor_id === ADMIN_ID, `historie s autorem (${JSON.stringify(ev)})`);
  expect(Number(sql(`select value from orders where id = ${q(job.id)}`)) === 151480, "hodnota zakázky = součet");
  await snap(page, "c-duplicates-after-desktop");
  sql(`delete from purchase_orders where id = ${q(poId)}`);
  await page.close();
});

await T("mobil 390 px: banner duplicit a otázka párování bez přetékání, prázdná pole bez ukázkových hodnot", async (context) => {
  const job = seedJob("D", { duplicates: true });
  const page = await context.newPage();
  await login(page, USERS.admin);
  await page.goto(`${BASE}/orders/${job.id}`);
  await page.getByRole("tab", { name: /Položky/ }).click();
  await page.getByTestId("duplicate-items").waitFor({ timeout: 15_000 });
  const ov1 = await noHorizontalOverflow(page);
  expect(ov1.ok, `Položky s bannerem bez přetékání do strany (${ov1.scroll} > ${ov1.inner})`);
  const ph = await page.locator("input[placeholder]").evaluateAll((els) => els.map((e) => e.getAttribute("placeholder")));
  expect(!ph.some((p) => /VK-1234|1\.2379|^A$/.test(p ?? "")), `žádné ukázkové hodnoty v prázdných polích (${[...new Set(ph)].join(", ")})`);
  await snap(page, "d-duplicates-390");
  await page.getByTestId("duplicate-merge").click();
  await page.getByTestId("duplicate-items").waitFor({ state: "detached", timeout: 20_000 });
  await snap(page, "d-after-merge-390");

  const job2 = seedJob("E", { names: ["Díl A", "Matice upravená"] });
  await captureOnJob(page, job2, `pair-e-${RUN}.png`);
  await page.getByTestId("pair-questions").waitFor({ timeout: 10_000 });
  const ov2 = await noHorizontalOverflow(page);
  expect(ov2.ok, `otázka bez přetékání (${ov2.scroll} > ${ov2.inner})`);
  await snap(page, "e-question-390", page.getByTestId("pair-questions"));
  await page.getByTestId("pair-new").click();
  const res = await save(page);
  expect(res.ok, "„Je to nová položka“ uloží řádek jako novou položku");
  trackFiles(job2.id);
  expect(itemRows(job2.id).length === 3, "3 položky (člověk řekl, že je nová)");
  await page.close();
}, { mobile: true });

// ── úklid ──
for (const id of cleanup.jobs) await deleteJobDeep(id).catch((e) => console.log(`  ! úklid zakázky ${id}: ${e.message}`));
await removeStorage([...cleanup.storagePaths]);
await browser.close();
process.exit(summary(errors) ? 0 : 1);
