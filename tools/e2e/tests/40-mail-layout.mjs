// E2E 40 (majitel 2. 11.): „V poště nejde dobře scrollovat. Na PC detail otevřeného mailu je potřeba … zvětšit
// a seznam … zúžit nějakým jednoduchým posuvníkem (úprava bude pak uložená okamžitě bez potvrzování jako
// defaultní pro daného uživatele)."
//  - 200 vláken + dlouhé vlákno (dlouhý text, citace, přílohy): složky, seznam a detail rolují každý sám,
//    stránka jako celek ne; hlavička vlákna s akcemi drží nahoře; načítání dalších při rolování seznamu;
//    živé obnovení (nová zpráva) pozici seznamu neposune,
//  - oddělovač seznam | detail: tažení myší → šířka hned v DB (profiles.ui_prefs), po obnovení i v novém
//    prohlížeči stejná, jiný uživatel nedotčen; klávesnice (šipky), dvojklik = výchozí; sbalení složek,
//  - šířky 1024 / 1440 / 1920 bez vodorovného rolování, telefon 390 px beze změny (seznam → detail),
//  - kompaktní Pošta (3. 11.): ≥ 10 vláken na 1366×768 / ≥ 7 na 1093×614, sbalitelné menu vlevo (uloží se), hustota,
//  - blokace po odmítnutém hesle: Otestovat připojení → další pokusy zablokované s časem; časový limit na
//    známém serveru po odmítnutí → „Hosting pravděpodobně dočasně zablokoval přihlášení…".
// Spuštění (aplikace musí znát testovací poštovní server — viz 12-mailbox-setup.mjs):
//   node tools/e2e/mail-test-server.mjs --dir <dir> --base 34000 &
//   MAIL_TEST_PROVIDERS="$(cat <dir>/providers.json)" NODE_EXTRA_CA_CERTS=<dir>/ca.crt <spusť aplikaci>
//   MAIL_TEST_DIR=<dir> E2E_BASE_URL=http://localhost:3600 [E2E_SHOTS=<dir>] node tools/e2e/tests/40-mail-layout.mjs
import fs from "node:fs";
import path from "node:path";
import { BASE, USERS, launch, newContext, login, shot, sql, test, expect, summary } from "../lib.mjs";

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), "../../..");
const SRV_DIR = process.env.MAIL_TEST_DIR ?? path.join(ROOT, ".local-supabase/mail-test");
const SRV = JSON.parse(fs.readFileSync(path.join(SRV_DIR, "server.json"), "utf8"));
const P = SRV.ports;
const SHOTS = process.env.E2E_SHOTS ?? null;
if (SHOTS) fs.mkdirSync(SHOTS, { recursive: true });

const TAG = `E2E40-${Date.now()}`;
const BOX = "d5000000-0000-0000-0000-000000000001"; // schránka obchodníka (neúplná — nestahuje se sama)
const LOCK_BOX = "zamek40@nastrojarstvi.test";
const LOCKOUT_TEXT = "Hosting pravděpodobně dočasně zablokoval přihlášení po chybných heslech. Ověř heslo ve webmailu (u hosting90 webmail.hosting90.cz) a zkus to znovu asi za hodinu.";
const obchodId = sql(`select id from profiles where email = '${USERS.obchod.email}'`);
const adminId = sql(`select id from profiles where email = '${USERS.admin.email}'`);
const prefsBefore = {
  obchod: sql(`select coalesce(ui_prefs::text, '{}') from profiles where id = '${obchodId}'`),
  admin: sql(`select coalesce(ui_prefs::text, '{}') from profiles where id = '${adminId}'`),
};
const prefOf = (id, key) => sql(`select coalesce(ui_prefs->>'${key}', '') from profiles where id = '${id}'`);

const cleanup = () => {
  sql(`delete from emails where subject like '${TAG}%' or thread_id like '${TAG}%'`);
  sql(`delete from mailboxes where email = '${LOCK_BOX}'`);
};

// ── data: 200 vláken + dlouhé vlákno (nejnovější) ──
sql(`update profiles set ui_prefs = '{}' where id in ('${obchodId}', '${adminId}')`);
sql(`insert into emails (mailbox_id, owner_id, direction, subject, from_name, from_email, to_email, body_text, snippet, received_at, category, thread_id, message_id)
  select '${BOX}', '${obchodId}', 'in', '${TAG} vlákno ' || lpad(g::text, 3, '0'), 'Zákazník ' || g, 'zakaznik' || g || '@firma.test', 'obchod@mnastrojarna.test',
         'Dobrý den, poptávka č. ' || g, 'Dobrý den, poptávka č. ' || g, now() - interval '1 day' - (g || ' minutes')::interval, 'poptavka', '${TAG}-t' || g, '<${TAG}-' || g || '@e2e>'
    from generate_series(1, 200) g`);
const longBody = (i) => [
  `Zpráva ${i} dlouhého vlákna.`,
  ...Array.from({ length: 70 }, (_, k) => `Řádek ${k + 1}: rozměr ${k * 3} mm, tolerance ±0,0${k % 9} — materiál 1.4301, výkres H-${100 + k}.`),
  "",
  "Dne 1. 11. 2026 v 10:00 Jan Novák <jan@firma.test> napsal(a):",
  ...Array.from({ length: 30 }, (_, k) => `> citovaný řádek ${k + 1}`),
].join("\n").replace(/'/g, "''");
for (let i = 1; i <= 8; i++) {
  sql(`insert into emails (mailbox_id, owner_id, direction, subject, from_name, from_email, to_email, body_text, snippet, received_at, category, thread_id, message_id, has_attachments)
    values ('${BOX}', '${obchodId}', 'in', '${TAG} DLOUHÉ vlákno', 'Jan Novák', 'jan@firma.test', 'obchod@mnastrojarna.test', '${longBody(i)}', 'Zpráva ${i}', now() - interval '${60 - i} minutes', 'poptavka', '${TAG}-long', '<${TAG}-long-${i}@e2e>', true)`);
}
const lastLong = sql(`select id from emails where thread_id = '${TAG}-long' order by received_at desc limit 1`);
sql(`insert into email_attachments (email_id, filename, mime_type, size_bytes) select '${lastLong}', 'vykres-' || g || '-velmi-dlouhy-nazev-souboru-s-revizi-B.pdf', 'application/pdf', 120000 from generate_series(1, 14) g`);

const browser = await launch();
const errors = [];
let shotNo = 0;
const snap = async (page, name, opts = {}) => {
  if (SHOTS) await page.screenshot({ path: path.join(SHOTS, `${name}.png`), ...opts });
};
const ctxOpen = async (opts = {}) => {
  const { context, errors: e } = await newContext(browser, opts);
  return { context, e };
};
const T = (name, fn) => test(name, async () => {
  const opened = [];
  const open = async (opts = {}) => {
    const c = await ctxOpen(opts);
    opened.push(c);
    return c.context;
  };
  try {
    await fn(open);
  } catch (err) {
    for (const c of opened) for (const p of c.context.pages()) await shot(p, `40-fail-${++shotNo}`).catch(() => undefined);
    throw err;
  } finally {
    for (const c of opened) {
      errors.push(...c.e);
      await c.context.close().catch(() => undefined);
    }
  }
});

async function eventually(fn, what, timeout = 20_000) {
  const t0 = Date.now();
  for (;;) {
    if (await fn()) return;
    if (Date.now() - t0 > timeout) throw new Error(`Očekávání selhalo: ${what}`);
    await new Promise((r) => setTimeout(r, 250));
  }
}

/** Rozměry a rolování sloupců Pošty. */
const panes = (page) => page.evaluate(() => {
  const q = (s) => document.querySelector(s);
  const m = (el) => (el ? { top: el.scrollTop, sh: el.scrollHeight, ch: el.clientHeight, w: Math.round(el.getBoundingClientRect().width), rect: el.getBoundingClientRect().toJSON() } : null);
  const main = document.querySelector("main");
  return {
    main: m(main),
    folders: m(q('[data-testid="mail-folders"]')),
    list: m(q('[data-testid="thread-list-scroll"]')),
    listPane: m(q('[data-testid="mail-list-pane"]')),
    detail: m(q('[data-testid="thread-pane"]')),
    split: m(q('[data-testid="mail-split"]')),
    pageW: document.documentElement.scrollWidth,
    winW: window.innerWidth,
    rows: document.querySelectorAll('[data-testid="thread-row"]').length,
  };
});

async function openInbox(page, viewport = { width: 1440, height: 900 }) {
  await page.setViewportSize(viewport);
  await page.goto(`${BASE}/inbox`);
  await page.getByTestId("thread-row").first().waitFor({ timeout: 30_000 });
}

console.log(`40 · rozložení Pošty (testovací server IMAPS ${P.imaps})`);

await T("200 vláken + dlouhé vlákno: složky, seznam a detail rolují každý sám (stránka ne), hlavička vlákna drží, další se načítají, živá pošta neposune seznam", async (open) => {
  const context = await open();
  const page = await context.newPage();
  await login(page, USERS.obchod);
  await openInbox(page);
  let s = await panes(page);
  expect(s.main.sh <= s.main.ch + 2, `stránka (main) neroluje: ${s.main.sh} > ${s.main.ch}`);
  expect(s.list.sh > s.list.ch + 500, `seznam roluje sám (${s.list.sh} / ${s.list.ch})`);
  expect(s.rows >= 50, `načteno ${s.rows} vláken`);
  // výchozí šířka: seznam ~30 % (užší než dřív), detail širší
  expect(Math.abs(s.listPane.w - Math.round((s.split.w - 12) * 0.3)) <= 4 || s.listPane.w === 260, `výchozí seznam 30 %: ${s.listPane.w} z ${s.split.w}`);
  expect(s.detail.w > s.listPane.w * 1.8, `detail širší než seznam (${s.detail.w} × ${s.listPane.w})`);

  // otevřít dlouhé vlákno (nejnovější)
  await page.locator('[data-testid="thread-row"]', { hasText: `${TAG} DLOUHÉ` }).first().locator("button").first().click();
  await page.getByTestId("thread-messages").waitFor();
  await page.getByTestId("message-attachment").first().waitFor();
  await snap(page, "40-01-detail-1440");
  s = await panes(page);
  expect(s.detail.sh > s.detail.ch + 300, `detail roluje sám (${s.detail.sh} / ${s.detail.ch})`);
  // citovaná historie sbalená, text přes celou šířku detailu
  expect(await page.getByTestId("message-quoted-toggle").count() >= 1, "tlačítko citované historie");
  expect(await page.getByTestId("message-quoted").count() === 0, "citace sbalená");
  const bodyW = await page.getByTestId("message-body").last().evaluate((el) => el.getBoundingClientRect().width);
  expect(bodyW > s.detail.w - 80, `text zprávy přes šířku detailu (${bodyW} / ${s.detail.w})`);

  // seznam odrolovat: detail ani složky se nehnou, stránka také ne; další vlákna se načtou (rolování v seznamu)
  await page.getByTestId("thread-list-scroll").evaluate((el) => { el.scrollTop = el.scrollHeight; });
  await eventually(async () => (await panes(page)).rows > 60, "další vlákna při rolování seznamu");
  s = await panes(page);
  expect(s.detail.top === 0 && s.main.top === 0 && s.folders.top === 0, `jen seznam se posunul: ${JSON.stringify({ d: s.detail.top, m: s.main.top, f: s.folders.top })}`);

  // detail odrolovat na konec: poslední příloha viditelná uvnitř sloupce; hlavička s Odpovědět nahoře
  const listTop = s.list.top;
  await page.getByTestId("thread-pane").evaluate((el) => { el.scrollTop = el.scrollHeight; });
  await page.waitForTimeout(200);
  s = await panes(page);
  expect(s.detail.top > 200, "detail odrolován");
  expect(Math.abs(s.list.top - listTop) < 2 && s.main.top === 0, "seznam ani stránka se s detailem nehnuly");
  const lastAtt = await page.getByTestId("message-attachment").last().evaluate((el) => el.getBoundingClientRect().toJSON());
  expect(lastAtt.bottom <= s.detail.rect.bottom + 1 && lastAtt.top >= s.detail.rect.top, `poslední příloha v zorném poli detailu (${lastAtt.top}–${lastAtt.bottom} v ${s.detail.rect.top}–${s.detail.rect.bottom})`);
  const head = await page.getByTestId("thread-header").evaluate((el) => el.getBoundingClientRect().toJSON());
  expect(Math.abs(head.top - s.detail.rect.top) <= 2, `hlavička vlákna drží nahoře (${head.top} × ${s.detail.rect.top})`);
  expect(await page.getByTestId("btn-reply").isVisible(), "Odpovědět vidět i po odrolování");
  // přílohy se zalamují (žádné vodorovné rolování detailu)
  expect(await page.getByTestId("thread-pane").evaluate((el) => el.scrollWidth <= el.clientWidth + 1), "detail bez vodorovného rolování");
  await snap(page, "40-02-detail-scrolled");
  await page.getByTestId("message-quoted-toggle").last().click();
  await page.getByTestId("message-quoted").first().waitFor();

  // živá pošta: nová zpráva nahoře → seznam drží stejná viditelná vlákna (bez skoku)
  await page.getByTestId("thread-list-scroll").evaluate((el) => { el.scrollTop = 1500; });
  await page.waitForTimeout(300);
  const firstVisible = () => page.evaluate(() => {
    const root = document.querySelector('[data-testid="thread-list-scroll"]').getBoundingClientRect();
    const row = [...document.querySelectorAll('[data-testid="thread-row"]')].find((r) => r.getBoundingClientRect().bottom > root.top + 4);
    return row ? { id: row.getAttribute("data-thread"), top: Math.round(row.getBoundingClientRect().top - root.top) } : null;
  });
  const before = await firstVisible();
  sql(`insert into emails (mailbox_id, owner_id, direction, subject, from_email, to_email, body_text, received_at, category, thread_id)
    values ('${BOX}', '${obchodId}', 'in', '${TAG} živá nová', 'novy@firma.test', 'obchod@mnastrojarna.test', 'nová', now(), 'poptavka', '${TAG}-live')`);
  await eventually(async () => (await page.locator('[data-testid="thread-row"]', { hasText: `${TAG} živá nová` }).count()) > 0, "nová zpráva se objeví sama (≤ 30 s)", 60_000);
  await page.waitForTimeout(300);
  const after = await firstVisible();
  expect(before?.id === after?.id && Math.abs(before.top - after.top) <= 4, `seznam neposkočil: ${JSON.stringify(before)} → ${JSON.stringify(after)}`);
  s = await panes(page);
  expect(s.detail.top > 200, "detail zůstal odrolovaný po živém obnovení");
});

let draggedWidth = 0;
await T("oddělovač: tažení → šířka hned v DB, po obnovení i v novém prohlížeči stejná; jiný uživatel nedotčen; šipky; dvojklik = výchozí; sbalené složky", async (open) => {
  const context = await open();
  const page = await context.newPage();
  await login(page, USERS.obchod);
  await openInbox(page);
  const s0 = await panes(page);
  const div = page.getByTestId("mail-divider");
  const box = await div.boundingBox();
  await page.mouse.move(box.x + box.width / 2, box.y + 200);
  await page.mouse.down();
  for (let i = 1; i <= 10; i++) await page.mouse.move(box.x + box.width / 2 + i * 9, box.y + 200);
  await page.mouse.up();
  const s1 = await panes(page);
  expect(s1.listPane.w >= s0.listPane.w + 85, `seznam se roztáhl (${s0.listPane.w} → ${s1.listPane.w})`);
  draggedWidth = s1.listPane.w;
  await eventually(() => Math.abs(Number(prefOf(obchodId, "mail.listWidth")) - draggedWidth) <= 1, `šířka ${draggedWidth} uložena v DB bez potvrzení`, 5_000);
  expect(prefOf(adminId, "mail.listWidth") === "", "admin (jiný uživatel) nedotčen");
  await snap(page, "40-03-dragged");

  // obnovení stránky: stejná šířka hned při vykreslení (bez poskočení)
  await page.reload();
  await page.getByTestId("thread-row").first().waitFor();
  const firstPaint = await page.getByTestId("mail-list-pane").evaluate((el) => Math.round(el.getBoundingClientRect().width));
  expect(Math.abs(firstPaint - draggedWidth) <= 1, `po obnovení ${firstPaint} = ${draggedWidth}`);

  // klávesnice: Tab na oddělovač, 3× šipka vlevo (−48), Shift+šipka vpravo (+64)
  await div.focus();
  for (let i = 0; i < 3; i++) await page.keyboard.press("ArrowLeft");
  await page.keyboard.press("Shift+ArrowRight");
  const kb = (await panes(page)).listPane.w;
  expect(Math.abs(kb - (draggedWidth - 48 + 64)) <= 2, `klávesnice: ${draggedWidth} → ${kb}`);
  await eventually(() => Math.abs(Number(prefOf(obchodId, "mail.listWidth")) - kb) <= 1, "šířka z klávesnice v DB", 5_000);
  expect(await div.getAttribute("aria-valuenow") === String(kb), "aria-valuenow = šířka");
  draggedWidth = kb;

  // sbalit složky (ikony) — uloží se také
  await page.getByTestId("mail-folders-toggle").click();
  await eventually(() => prefOf(obchodId, "mail.foldersCollapsed") === "true", "sbalené složky v DB", 5_000);
  const navW = await page.getByTestId("mail-folders").evaluate((el) => Math.round(el.getBoundingClientRect().width));
  expect(navW <= 60, `složky jen ikony (${navW} px)`);
  await snap(page, "40-04-folders-collapsed");

  // nový prohlížeč (jiný kontext, prázdné localStorage), stejný uživatel → stejné rozložení z DB
  const ctx2 = await open();
  const p2 = await ctx2.newPage();
  await login(p2, USERS.obchod);
  await openInbox(p2);
  const s2 = await panes(p2);
  expect(Math.abs(s2.listPane.w - draggedWidth) <= 1, `nový prohlížeč: ${s2.listPane.w} = ${draggedWidth}`);
  expect(s2.folders.w <= 60, "nový prohlížeč: složky sbalené");

  // jiný uživatel (super admin): výchozí 30 %, rozbalené složky
  const ctx3 = await open();
  const p3 = await ctx3.newPage();
  await login(p3, USERS.admin);
  await openInbox(p3);
  const s3 = await panes(p3);
  expect(Math.abs(s3.listPane.w - Math.max(260, Math.round((s3.split.w - 12) * 0.3))) <= 4, `admin výchozí šířka (${s3.listPane.w} z ${s3.split.w})`);
  expect(s3.folders.w > 120, "admin: složky rozbalené");
  expect(prefOf(adminId, "mail.listWidth") === "" && prefOf(adminId, "mail.foldersCollapsed") === "", "admin DB beze změny");

  // dvojklik = výchozí (klíč z DB pryč), složky zpět
  await div.dblclick();
  await eventually(() => prefOf(obchodId, "mail.listWidth") === "", "dvojklik smaže šířku v DB", 5_000);
  const back = await panes(page);
  expect(Math.abs(back.listPane.w - Math.max(260, Math.round((back.split.w - 12) * 0.3))) <= 4, `po dvojkliku výchozí (${back.listPane.w})`);
  await page.getByTestId("mail-folders-toggle").click();
  await eventually(() => prefOf(obchodId, "mail.foldersCollapsed") === "false", "rozbalené složky v DB", 5_000);
});

await T("šířky 1024 / 1440 / 1920: bez vodorovného rolování, seznam ≥ 260 px, detail co nejširší; dotyk na oddělovači", async (open) => {
  // bez vlastní volby (složky automaticky podle šířky okna)
  sql(`update profiles set ui_prefs = '{}' where id = '${obchodId}'`);
  const context = await open();
  const page = await context.newPage();
  await login(page, USERS.obchod);
  for (const [w, h] of [[1024, 768], [1280, 800], [1440, 900], [1920, 1080]]) {
    await openInbox(page, { width: w, height: h });
    await page.locator('[data-testid="thread-row"]', { hasText: `${TAG} DLOUHÉ` }).first().locator("button").first().click();
    await page.getByTestId("thread-messages").waitFor();
    const s = await panes(page);
    expect(s.pageW <= s.winW, `${w}: bez vodorovného rolování (${s.pageW} > ${s.winW})`);
    expect(s.listPane.w >= 259, `${w}: seznam ≥ 260 (${s.listPane.w})`);
    expect(s.detail.w >= Math.min(480, s.split.w - 12 - 260) - 2, `${w}: detail ${s.detail.w} (split ${s.split.w})`);
    expect(s.main.sh <= s.main.ch + 2 && s.list.sh > s.list.ch && s.detail.sh > s.detail.ch, `${w}: sloupce rolují samy`);
    if (w === 1024) expect(s.folders.w <= 60, `1024: složky automaticky jen ikony (${s.folders.w})`);
    if (w === 1920) expect(s.split.w > 1300, `1920: Pošta přes celou šířku (bez max-w-7xl), ${s.split.w}`);
    await snap(page, `40-05-width-${w}`);
  }
  // Firefox / Edge šířky ověřuje stejná CSS (clamp, :has) — tady Chromium; dotyk: pointer události
  await openInbox(page, { width: 1440, height: 900 });
  const box = await page.getByTestId("mail-divider").boundingBox();
  const w0 = (await panes(page)).listPane.w;
  await page.getByTestId("mail-divider").dispatchEvent("pointerdown", { pointerId: 7, pointerType: "touch", clientX: box.x + 6, clientY: box.y + 100, button: 0, isPrimary: true });
  await page.getByTestId("mail-divider").dispatchEvent("pointermove", { pointerId: 7, pointerType: "touch", clientX: box.x + 6 - 40, clientY: box.y + 100, isPrimary: true });
  await page.getByTestId("mail-divider").dispatchEvent("pointerup", { pointerId: 7, pointerType: "touch", clientX: box.x + 6 - 40, clientY: box.y + 100, isPrimary: true });
  const w1 = (await panes(page)).listPane.w;
  expect(Math.abs(w1 - Math.max(260, w0 - 40)) <= 2, `dotyk: ${w0} → ${w1}`);
  await page.getByTestId("mail-divider").dblclick();
  await eventually(() => prefOf(obchodId, "mail.listWidth") === "", "výchozí po dvojkliku", 5_000);
});

await T("kompaktní Pošta (majitel 3. 11.): ≥ 10 vláken na 1366×768, ≥ 7 na 1093×614; menu vlevo jde sbalit (uloží se); ⋯ Pohodlné / Kompaktní", async (open) => {
  sql(`update profiles set ui_prefs = '{}' where id = '${obchodId}'`);
  const context = await open();
  const page = await context.newPage();
  await login(page, USERS.obchod);
  // celé řádky vláken viditelné v seznamu (bez rolování)
  const visibleRows = () => page.evaluate(() => {
    const lr = document.querySelector('[data-testid="thread-list-scroll"]').getBoundingClientRect();
    return [...document.querySelectorAll('[data-testid="thread-row"]')].filter((r) => {
      const b = r.getBoundingClientRect();
      return b.height > 0 && b.top >= lr.top - 1 && b.bottom <= lr.bottom + 1;
    }).length;
  });
  const sidebarW = () => page.getByTestId("app-sidebar").evaluate((el) => Math.round(el.getBoundingClientRect().width));

  // bez volby: v Poště pod 1440 px menu samo jen ikony, seznam kompaktní
  await openInbox(page, { width: 1366, height: 768 });
  expect((await sidebarW()) <= 64, `1366: menu automaticky sbalené (${await sidebarW()} px)`);
  const n1366 = await visibleRows();
  expect(n1366 >= 10, `1366×768: ${n1366} vláken na obrazovce (≥ 10)`);
  expect(await page.getByTestId("btn-mail-settings").isVisible() && await page.getByTestId("mail-more").isVisible(), "lišta: ozubené kolo a ⋯");
  await snap(page, "40-10-compact-1366");
  await openInbox(page, { width: 1093, height: 614 });
  const n1093 = await visibleRows();
  expect(n1093 >= 7, `1093×614 (125 %): ${n1093} vláken (≥ 7)`);
  const s = await panes(page);
  expect(s.pageW <= s.winW && s.main.sh <= s.main.ch + 2, "1093: bez vodorovného rolování, stránka neroluje");
  await snap(page, "40-11-compact-1093");

  // rozbalit menu → uloží se hned pro uživatele, platí i na jiných stránkách; znovu sbalit
  await page.getByTestId("sidebar-toggle").click();
  await eventually(() => prefOf(obchodId, "app.sidebarCollapsed") === "false", "rozbalené menu v DB", 5_000);
  expect((await sidebarW()) >= 250, "menu rozbalené");
  expect((await visibleRows()) >= 7, "1093 s rozbaleným menu: stále ≥ 7 vláken");
  await page.getByTestId("sidebar-toggle").click();
  await eventually(() => prefOf(obchodId, "app.sidebarCollapsed") === "true", "sbalené menu v DB", 5_000);
  await page.setViewportSize({ width: 1920, height: 1080 });
  await page.goto(`${BASE}/orders`);
  await page.getByTestId("app-sidebar").waitFor();
  expect((await sidebarW()) <= 64, "uložená volba platí i jinde a na široké obrazovce");
  expect(prefOf(adminId, "app.sidebarCollapsed") === "", "jiný uživatel nedotčen");

  // hustota seznamu: ⋯ → Pohodlné (uloží se) → Kompaktní (výchozí, klíč pryč)
  await openInbox(page, { width: 1366, height: 768 });
  await page.getByTestId("mail-more").click();
  await page.getByTestId("mail-density-comfortable").click();
  await eventually(() => prefOf(obchodId, "mail.comfortable") === "true", "Pohodlné v DB", 5_000);
  const tall = await page.getByTestId("thread-row").first().evaluate((el) => el.getBoundingClientRect().height);
  expect(tall > 80, `Pohodlné: vyšší řádky (${tall} px)`);
  await page.getByTestId("mail-more").click();
  await page.getByTestId("mail-density-compact").click();
  await eventually(() => prefOf(obchodId, "mail.comfortable") === "", "Kompaktní = výchozí", 5_000);
  const short = await page.getByTestId("thread-row").first().evaluate((el) => el.getBoundingClientRect().height);
  expect(short <= 56, `Kompaktní: nízké řádky (${short} px)`);
  sql(`update profiles set ui_prefs = '{}' where id = '${obchodId}'`);
});

await T("telefon 390 px beze změny: seznam přes celou šířku, ťuknutí → detail přes obrazovku, zpět na seznam", async (open) => {
  const context = await open({ mobile: true });
  const page = await context.newPage();
  await login(page, USERS.obchod);
  await page.goto(`${BASE}/inbox`);
  await page.getByTestId("thread-row").first().waitFor({ timeout: 30_000 });
  const s = await panes(page);
  expect(s.pageW <= s.winW + 1, `390: bez vodorovného rolování (${s.pageW})`);
  expect(!(await page.getByTestId("mail-divider").isVisible()), "oddělovač na mobilu není");
  expect(s.listPane.w >= 340, `seznam přes šířku (${s.listPane.w})`);
  expect(s.main.sh > s.main.ch, "mobil: roluje stránka (jako dřív)");
  await snap(page, "40-06-mobile-list");
  await page.locator('[data-testid="thread-row"]', { hasText: `${TAG} DLOUHÉ` }).first().locator("button").first().click();
  await page.getByTestId("thread-messages").waitFor();
  const pos = await page.getByTestId("thread-pane").evaluate((el) => getComputedStyle(el).position);
  expect(pos === "fixed", `detail přes obrazovku (${pos})`);
  expect(!(await page.getByTestId("mail-list-pane").isVisible()), "seznam pod detailem skrytý");
  await snap(page, "40-07-mobile-detail");
  await page.getByRole("button", { name: "Zpět na seznam" }).click();
  await page.getByTestId("mail-list-pane").waitFor();
  expect(!(await page.getByTestId("thread-messages").isVisible().catch(() => false)), "zpět na seznamu");
});

await T("blokace po odmítnutém hesle: Otestovat připojení → další pokusy s časem zablokované; časový limit po něm = blokace hostingu", async (open) => {
  sql(`delete from mailboxes where email = '${LOCK_BOX}'`);
  const cfg = (port, pass) => JSON.stringify({
    preset: "other", incoming_protocol: "imap", imap_host: "127.0.0.1", imap_port: port, imap_tls: "tls", imap_user: LOCK_BOX, imap_password: pass,
    smtp_host: "127.0.0.1", smtp_port: port === P.blackhole ? P.blackhole : P.smtps, smtp_tls: "tls",
  });
  const lockId = sql(`insert into mailboxes (email, provider, owner_id, active, config) values ('${LOCK_BOX}', 'imap', '${obchodId}', true, '${cfg(P.imaps, "Spatne-Heslo-40")}') returning id`).split("\n")[0];
  const context = await open();
  const page = await context.newPage();
  await login(page, USERS.obchod);
  await page.goto(`${BASE}/account`);
  const card = page.getByTestId(`my-box-${LOCK_BOX}`);
  await card.waitFor({ timeout: 30_000 });
  await card.getByTestId("my-box-test").click();
  await eventually(async () => /Přihlášení odmítnuto/.test(await page.getByTestId("my-mailbox-note").innerText().catch(() => "")), "test: heslo odmítnuto", 30_000);
  await card.getByTestId("my-box-auth-lock").waitFor({ timeout: 10_000 });
  const lockText = await card.getByTestId("my-box-auth-lock").innerText();
  expect(/Heslo bylo odmítnuto[\s\S]*zkus znovu po \d{1,2}:\d{2}/.test(lockText), `důvod a čas: ${lockText}`);
  for (const id of ["my-box-test", "my-box-test-send", "my-box-sync"]) {
    expect(await card.getByTestId(id).isDisabled(), `${id} zablokované`);
    expect(/zkus znovu po/.test((await card.getByTestId(id).getAttribute("title")) ?? ""), `${id}: důvod v title`);
  }
  // API přímo (opakovaný ruční test) — bez přihlášení na server
  const r = await page.request.post(`${BASE}/api/mailboxes/my`, { data: { action: "test", mailboxId: lockId } });
  const j = await r.json();
  expect(j.authLock?.blocked === true && !j.incoming, `server test odmítne: ${JSON.stringify(j).slice(0, 200)}`);
  const sync = await (await page.request.post(`${BASE}/api/emails/sync`, { data: { mailboxId: lockId } })).json();
  expect(sync.boxes?.[0]?.skipped === "auth" && sync.boxes[0].retryAt, `ruční stažení zablokované: ${JSON.stringify(sync.boxes?.[0] ?? sync).slice(0, 200)}`);
  await snap(page, "40-08-auth-lock");

  // hodina uplynula, server mlčí (hosting zablokoval IP): známý server → vysvětlení blokace místo „špatný server nebo port"
  sql(`update mailboxes set config = '${cfg(P.blackhole, "Spatne-Heslo-40")}' where id = '${lockId}'`);
  sql(`update mailbox_status set auth_fail_at = now() - interval '61 minutes' where mailbox_id = '${lockId}'`);
  await page.reload();
  await card.waitFor();
  expect(!(await card.getByTestId("my-box-test").isDisabled()), "po hodině smí test");
  await card.getByTestId("my-box-test").click();
  await eventually(async () => (await page.getByTestId("my-mailbox-note").innerText().catch(() => "")).includes(LOCKOUT_TEXT), "hláška o blokaci hostingu", 40_000);
  const note = await page.getByTestId("my-mailbox-note").innerText();
  expect(!/špatný server nebo port/.test(note), `ne obyčejná hláška: ${note}`);
  await card.getByTestId("my-box-auth-lock").waitFor({ timeout: 10_000 });
  expect((await card.getByTestId("my-box-auth-lock").innerText()).includes(LOCKOUT_TEXT), "blokace s vysvětlením hostingu");
  expect(await card.getByTestId("my-box-test").isDisabled(), "a další test zase zablokovaný");
  await snap(page, "40-09-host-lockout");

  // Pošta: řádek stavu schránky ukáže důvod (vlastní schránka)
  await page.goto(`${BASE}/inbox`);
  await eventually(async () => (await page.getByTestId("mailbox-health").innerText().catch(() => "")).includes(LOCKOUT_TEXT), "Pošta: stav schránky s blokací", 20_000);
  sql(`delete from mailboxes where id = '${lockId}'`);
});

cleanup();
sql(`update profiles set ui_prefs = '${prefsBefore.obchod.replace(/'/g, "''")}' where id = '${obchodId}'`);
sql(`update profiles set ui_prefs = '${prefsBefore.admin.replace(/'/g, "''")}' where id = '${adminId}'`);
await browser.close();
process.exit(summary(errors) ? 0 : 1);
