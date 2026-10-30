// E2E 18: Pošta A — vlastní schránka v Můj účet, stažení celé schránky s průběhem, vlákna, odpověď,
// přeposlání s přílohou, nová zpráva (Komu/Kopie), Odeslané (+ kopie na serveru), vlaječka, priorita
// (filtr), „Vyzkoušet odeslání", předání kolegovi (odznak, poznámka, viditelnost).
//
// Spuštění (aplikace musí znát testovací server a jeho CA — viz 12-mailbox-setup.mjs):
//   node tools/e2e/mail-test-server.mjs --dir .local-supabase/mail-test --base 25000 &
//   MAIL_TEST_PROVIDERS="$(cat .local-supabase/mail-test/providers.json)" NODE_EXTRA_CA_CERTS=.local-supabase/mail-test/ca.crt \
//   MAIL_SYNC_MAX_PER_CALL=60 <spusť aplikaci>   (60 zpráv na volání → průběh „Staženo X z Y" po dávkách)
//   E2E_BASE_URL=http://localhost:3600 [E2E_SHOTS=<adresář>] node tools/e2e/tests/18-mail-inbox.mjs
import fs from "node:fs";
import path from "node:path";
import { BASE, USERS, launch, withContext, login, shot, sql, test, expect, summary } from "../lib.mjs";

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), "../../..");
const SRV_DIR = process.env.MAIL_TEST_DIR ?? path.join(ROOT, ".local-supabase/mail-test");
const SRV = JSON.parse(fs.readFileSync(path.join(SRV_DIR, "server.json"), "utf8"));
const CTL = `http://127.0.0.1:${SRV.ports.control}`;
const SHOTS = process.env.E2E_SHOTS ?? null;
if (SHOTS) fs.mkdirSync(SHOTS, { recursive: true });

const BOX = "posta@nastrojarstvi.test";
const PASS = "Posta-Heslo-1";
const TAG = `E2E18-${Date.now()}`;

const browser = await launch();
const errors = [];
const T = (name, fn, opts) => test(name, () => withContext(browser, errors, fn, opts));

const boxId = () => sql(`select id from mailboxes where email = '${BOX}'`);
const cleanup = () => {
  sql(`delete from email_shares where thread_id in (select thread_id from emails where mailbox_id in (select id from mailboxes where email = '${BOX}'))`);
  sql(`delete from emails where mailbox_id in (select id from mailboxes where email = '${BOX}')`);
  sql(`delete from mailboxes where email = '${BOX}'`);
};
cleanup();
const adminId = sql(`select id from profiles where email = '${USERS.admin.email}'`);
const obchodId = sql(`select id from profiles where email = '${USERS.obchod.email}'`);
const ctl = async (p, opts) => (await fetch(`${CTL}${p}`, opts)).json();
const addMany = (count, prefix = `Archiv ${TAG}`) => ctl(`/add?user=${encodeURIComponent(BOX)}&count=${count}&prefix=${encodeURIComponent(prefix)}`, { method: "POST" });
const addMsg = (m) => ctl(`/message?user=${encodeURIComponent(BOX)}`, { method: "POST", body: JSON.stringify(m) });
// celý zdroj (podpis s vloženým logem posune přílohy za prvních 4000 znaků)
const sentRaw = async () => (await ctl("/sent?full=1")).map((s) => s.raw);
const sentFolder = async () => ctl(`/folder?user=${encodeURIComponent(BOX)}&name=Sent`);

console.log(`18 · pošta (testovací server IMAP ${SRV.ports.imaps}, SMTP ${SRV.ports.smtps}, ovládání ${SRV.ports.control})`);

async function eventually(fn, what, timeout = 60_000) {
  const t0 = Date.now();
  for (;;) {
    if (await fn()) return;
    if (Date.now() - t0 > timeout) throw new Error(`Očekávání selhalo: ${what}`);
    await new Promise((r) => setTimeout(r, 500));
  }
}

async function openInbox(page, q) {
  await page.goto(`${BASE}/inbox`);
  await page.getByTestId("mail-folders").first().waitFor();
  await page.waitForLoadState("networkidle");
  if (q) {
    await page.getByTestId("mail-search").fill(q);
    await page.waitForTimeout(700);
    await page.waitForLoadState("networkidle");
  }
}

async function openThread(page, subject) {
  const row = page.getByTestId("thread-row").filter({ hasText: subject }).first();
  await row.waitFor({ timeout: 30_000 });
  await row.locator("button").first().click();
  await page.getByTestId("thread-view").filter({ hasText: subject }).last().waitFor({ timeout: 20_000 });
  await page.getByTestId("thread-message").first().waitFor({ timeout: 20_000 });
}

await addMany(150);

await T("Můj účet: připojím si schránku sám (e-mail + heslo) → IMAP i SMTP nalezeno → stáhne CELOU schránku po dávkách s průběhem", async (context) => {
  const page = await context.newPage();
  await login(page, USERS.admin);
  await page.goto(`${BASE}/account#schranka`);
  await page.waitForLoadState("networkidle"); // streamovaná stránka (loading.tsx) má chvíli i skrytou kopii obsahu
  const form = page.locator('[data-testid="my-mailbox-form"]:visible').first();
  await form.waitFor();
  await form.getByLabel("E-mail schránky").fill(BOX);
  await form.getByLabel("Heslo ke schránce").fill(PASS);
  if (SHOTS) await page.getByTestId("my-mailbox").screenshot({ path: path.join(SHOTS, "ucet-schranka-formular-1280-light.png") });
  await form.getByTestId("my-mailbox-connect").click();
  const progress = page.getByTestId("my-mailbox-progress");
  await progress.waitFor({ timeout: 90_000 });
  const seen = new Set();
  await eventually(async () => {
    const t = await progress.innerText().catch(() => "");
    const m = /Staženo ([\d\s ]+) z ([\d\s ]+)/.exec(t);
    if (m) seen.add(m[1].replace(/\D/g, ""));
    return !(await progress.isVisible().catch(() => false));
  }, "stahování doběhlo", 180_000);
  const note = await page.getByTestId("my-mailbox-note").innerText();
  expect(/Schránka připojena/.test(note) && /Staženo \d+, nových \d+/.test(note), `hotovo: ${note}`);
  const id = boxId();
  expect(sql(`select owner_id from mailboxes where id = '${id}'`) === adminId, "vlastník = já");
  expect(sql(`select config->>'smtp_host' from mailboxes where id = '${id}'`) === "127.0.0.1", "SMTP uložen");
  const n = Number(sql(`select count(*) from emails where mailbox_id = '${id}' and direction = 'in'`));
  expect(n >= 153, `staženo vše (${n})`);
  expect(seen.size >= 2, `průběh po dávkách (${[...seen].join(", ")})`);
  const row = page.getByTestId(`my-box-${BOX}`);
  const rt = await row.innerText();
  expect(rt.includes("Příjem: IMAP 127.0.0.1") && rt.includes("Odesílání: SMTP 127.0.0.1"), `řádek schránky: ${rt}`);
  expect(!(await page.content()).includes(PASS), "heslo není v HTML");
  // Vyzkoušet odeslání
  const before = (await sentFolder()).length;
  await row.getByTestId("my-box-test-send").click();
  await page.getByTestId("my-mailbox-note").filter({ hasText: /Zkušební e-mail odeslán/ }).waitFor({ timeout: 60_000 });
  expect((await sentFolder()).length === before + 1, "kopie zkušebního e-mailu v Odeslaných na serveru");
  await page.close();
});

await T("vlákno + odpověď z aplikace → odchozí ve vlákně, kopie v Odeslaných; odpověď zákazníka se zařadí do stejného vlákna", async (context) => {
  const page = await context.newPage();
  await login(page, USERS.admin);
  await openInbox(page, "Poptávka hřídele");
  await openThread(page, "Posta: Poptávka hřídele 50 ks");
  // odpověď na PŮVODNÍ poptávku (vlákno může mít i starší odpovědi z dřívějších běhů testovacího serveru)
  const c0 = await page.getByTestId("thread-message").count();
  const first = page.getByTestId("thread-message").first();
  if (c0 > 1) await first.locator("button").first().click();
  await first.getByRole("button", { name: "Odpovědět na tuto zprávu" }).click();
  const dlg = page.getByTestId("compose-dialog");
  await dlg.waitFor();
  await dlg.getByTestId("compose-from").filter({ hasText: BOX }).waitFor({ timeout: 20_000 });
  const chips = await dlg.getByTestId("recipient-chip").allInnerTexts();
  expect(chips.join(" ").includes("dvorak@strojmetal.test"), `Komu = odesílatel: ${chips}`);
  const body = dlg.getByLabel("Text zprávy");
  await eventually(async () => /napsal\(a\):\n> Dobrý den/.test(await body.inputValue()), "citace původní zprávy", 10_000).catch(async (e) => {
    throw new Error(`${e.message}: ${JSON.stringify((await body.inputValue()).slice(0, 300))}`);
  });
  await body.press("Control+Home");
  await body.type(`Dobrý den, nabídku pošleme zítra. ${TAG}`);
  const sentBefore = (await sentRaw()).length;
  await dlg.getByTestId("compose-send").click();
  await page.getByTestId("sync-msg").filter({ hasText: /Odesláno z posta@nastrojarstvi\.test/ }).waitFor({ timeout: 60_000 });
  const raws = await sentRaw();
  expect(raws.length === sentBefore + 1, "SMTP přijal odpověď");
  const raw = raws.at(-1);
  expect(/^In-Reply-To: <e2e-1\.postanastrojarstvitest@nastrojarstvi\.test>/m.test(raw), `In-Reply-To: ${raw.slice(0, 500)}`);
  const mid = /^Message-ID: (<[^>]+>)/m.exec(raw)?.[1];
  expect((await sentFolder()).some((m) => m.messageId === mid), "kopie odpovědi v Odeslaných (APPEND)");
  const id = boxId();
  const tid = sql(`select thread_id from emails where mailbox_id = '${id}' and subject = 'Posta: Poptávka hřídele 50 ks'`);
  expect(sql(`select thread_id || '|' || direction || '|' || owner_id from emails where message_id = '${mid}'`) === `${tid}|out|${adminId}`, "odchozí ve vlákně, autor admin");
  await page.getByTestId("thread-message").filter({ hasText: TAG }).waitFor({ timeout: 20_000 });
  // zákazník odpoví → Stáhnout poštu → 3 zprávy ve vlákně
  await new Promise((r) => setTimeout(r, 1100));
  await addMsg({ subject: "Re: Posta: Poptávka hřídele 50 ks", body: `Děkujeme ${TAG}`, from: "Jan Dvořák <dvorak@strojmetal.test>", inReplyTo: mid, references: `<e2e-1.postanastrojarstvitest@nastrojarstvi.test> ${mid}` });
  await page.getByRole("button", { name: /Stáhnout poštu/ }).click();
  // stáhne tlačítko, nebo dřív živá pošta na pozadí (každou minutu) — výsledek je stejný
  await page.getByTestId("sync-msg").filter({ hasText: /Staženo \d+, nových \d+/ }).waitFor({ timeout: 90_000 });
  await eventually(async () => sql(`select count(*) from emails where mailbox_id = '${id}' and thread_id = '${tid}'`) === String(c0 + 2), "odpověď zákazníka ve vlákně (DB)", 60_000);
  await eventually(async () => (await page.getByTestId("thread-message").count()) === c0 + 2, "vlákno má o 2 zprávy víc (moje odpověď + odpověď zákazníka)", 30_000);
  const dirs = await page.getByTestId("thread-message").evaluateAll((els) => els.map((e) => e.getAttribute("data-direction")));
  expect(dirs[0] === "in" && dirs.slice(-2).join(",") === "out,in", `pořadí od nejstarší: ${dirs}`);
  if (SHOTS) {
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.screenshot({ path: path.join(SHOTS, "vlakno-1280-light.png"), fullPage: false });
  }
  await page.close();
});

await T("přeposlání s původní přílohou + nová zpráva (Komu/Kopie/Skrytá) → Odeslané", async (context) => {
  const page = await context.newPage();
  await login(page, USERS.admin);
  await addMsg({ subject: `Výkres ${TAG}`, body: "V příloze výkres.", from: "Eva <eva@firma.test>", attachments: [{ filename: "vykres-H200.pdf", contentType: "application/pdf", base64: Buffer.from("%PDF-1.4 H200").toString("base64") }] });
  await openInbox(page);
  await page.getByRole("button", { name: /Stáhnout poštu/ }).click();
  await page.getByTestId("sync-msg").filter({ hasText: /Staženo/ }).waitFor({ timeout: 90_000 });
  await page.getByTestId("mail-search").fill(`Výkres ${TAG}`);
  await page.waitForTimeout(700);
  await openThread(page, `Výkres ${TAG}`);
  await page.getByTestId("message-attachment").filter({ hasText: "vykres-H200.pdf" }).waitFor();
  await page.getByTestId("btn-forward").click();
  const dlg = page.getByTestId("compose-dialog");
  await dlg.getByTestId("compose-attachments").filter({ hasText: "vykres-H200.pdf" }).waitFor();
  await dlg.locator("#compose-to").fill("technolog@nekde.test");
  await dlg.locator("#compose-to").press("Enter");
  const f0 = (await sentRaw()).length;
  await dlg.getByTestId("compose-send").click();
  await dlg.waitFor({ state: "detached", timeout: 60_000 });
  await eventually(async () => (await sentRaw()).length === f0 + 1, "SMTP přijal přeposlání", 30_000);
  const fwd = (await sentRaw()).at(-1);
  expect(/Subject: Fwd: Výkres|Subject: =\?UTF-8\?/.test(fwd) && fwd.includes("vykres-H200.pdf"), "přeposláno s přílohou");

  await page.getByTestId("btn-compose").click();
  const nd = page.getByTestId("compose-dialog");
  await nd.locator("#compose-to").fill("novy@zakaznik.test,");
  await nd.getByText("Kopie / skrytá kopie").click();
  await nd.locator("#compose-cc").fill("eva@firma.test");
  await nd.locator("#compose-cc").press("Enter");
  await nd.locator("#compose-bcc").fill("archiv@my.test");
  await nd.locator("#compose-bcc").press("Enter");
  await nd.getByLabel("Předmět").fill(`Nová ${TAG}`);
  await nd.getByLabel("Text zprávy").fill("Dobrý den, posíláme novinky.");
  if (SHOTS) await page.screenshot({ path: path.join(SHOTS, "nova-zprava-1280-light.png") });
  const n0 = (await sentRaw()).length;
  await nd.getByTestId("compose-send").click();
  await nd.waitFor({ state: "detached", timeout: 60_000 });
  await eventually(async () => (await sentRaw()).length === n0 + 1, "SMTP přijal novou zprávu", 30_000);
  const raw = (await sentRaw()).at(-1);
  expect(/^Cc: eva@firma\.test/m.test(raw) && !/^Bcc:/m.test(raw), "Kopie v hlavičce, skrytá ne");
  await page.getByTestId("mail-search").fill("");
  await page.getByTestId("folder-sent").click();
  await page.getByTestId("thread-row").filter({ hasText: `Nová ${TAG}` }).first().waitFor({ timeout: 20_000 });
  const sentList = await page.getByTestId("thread-list").innerText();
  expect(sentList.includes(`Nová ${TAG}`) && sentList.includes("Posta: Poptávka hřídele"), "Odeslané: nová zpráva i odpověď");
  await page.close();
});

await T("vlaječka a priorita jedním ťuknutím → složka Označené, filtr P1", async (context) => {
  const page = await context.newPage();
  await login(page, USERS.admin);
  await openInbox(page, "Objednávka 4500123");
  const row = page.getByTestId("thread-row").filter({ hasText: "Posta: Objednávka 4500123" }).first();
  await row.waitFor();
  await row.getByTestId("row-flag").click();
  await eventually(async () => (await row.getAttribute("data-flagged")) === "1", "vlaječka v řádku");
  await row.getByTestId("priority-select").click();
  await page.getByTestId("priority-option-1").click();
  await eventually(async () => (await row.getAttribute("data-priority")) === "1", "priorita 1 v řádku");
  const id = boxId();
  await eventually(async () => sql(`select flagged || '|' || flagged_by || '|' || priority_rank || '|' || priority_set_by from emails where mailbox_id = '${id}' and subject = 'Posta: Objednávka 4500123'`) === `true|${adminId}|1|${adminId}`, "uloženo s autorem");
  await page.getByTestId("mail-search").fill("");
  await page.waitForTimeout(600);
  await page.getByTestId("folder-flagged").click();
  await page.getByTestId("thread-row").filter({ hasText: "Posta: Objednávka 4500123" }).waitFor({ timeout: 20_000 });
  await page.getByTestId("folder-inbox").click();
  await page.getByTestId("mail-filters-toggle").click();
  await page.getByTestId("filter-priority-1").click();
  await page.waitForTimeout(800);
  await page.waitForLoadState("networkidle");
  const rows = await page.getByTestId("thread-row").allInnerTexts();
  expect(rows.length >= 1 && rows.every((r) => !r.includes("Archiv")) && rows.some((r) => r.includes("Objednávka 4500123")), `filtr P1: ${rows.length} řádků`);
  await page.close();
});

await T("předat kolegovi: poznámka → kolega ji vidí ve své poště s odznakem; jinou poštu schránky nevidí", async (context) => {
  const page = await context.newPage();
  await login(page, USERS.admin);
  await openInbox(page, "Nabídka materiálu");
  await openThread(page, "Posta: Nabídka materiálu");
  await page.getByTestId("btn-share").click();
  const dlg = page.getByTestId("share-dialog");
  await dlg.getByTestId(`share-user-${USERS.obchod.email}`).click();
  await dlg.getByLabel("Poznámka pro kolegu").fill(`Prosím ověř cenu ${TAG}`);
  if (SHOTS) await page.screenshot({ path: path.join(SHOTS, "predat-kolegovi-1280-light.png") });
  await dlg.getByTestId("share-submit").click();
  await page.getByText(/Předáno kolegovi/).waitFor({ timeout: 20_000 });
  expect(sql(`select count(*) from email_shares where shared_with = '${obchodId}' and shared_by = '${adminId}' and note like '%${TAG}%'`) === "1", "předání uloženo s autorem");
  await page.close();
  await context.clearCookies();

  const p2 = await context.newPage();
  await login(p2, USERS.obchod);
  await p2.goto(`${BASE}/inbox`);
  await p2.getByTestId("thread-row").filter({ hasText: "Posta: Nabídka materiálu" }).first().waitFor({ timeout: 30_000 });
  const main = await p2.locator("main").innerText();
  expect(main.includes(`Prosím ověř cenu ${TAG}`) && /Od Super Admin/.test(main), "kolega vidí poznámku");
  expect(!main.includes("Posta: Objednávka 4500123") && !main.includes(`Archiv ${TAG}`), "kolega nevidí jinou poštu schránky");
  const nav = await p2.locator("aside").innerText().catch(() => "");
  expect(/Pošta\s*\n?\s*\d+/.test(nav), `odznak nepřečtených v menu: ${nav.slice(0, 200)}`);
  // cizí vlákno ani schránku přes API nedostane
  const sync = await p2.request.post(`${BASE}/api/emails/sync`, { data: { mailboxId: boxId() } });
  expect(((await sync.json()).fetched ?? 0) === 0, "cizí schránku nestáhne");
  const my = await (await p2.request.get(`${BASE}/api/mailboxes/my`)).json();
  expect(!JSON.stringify(my).includes(BOX) && !JSON.stringify(my).includes(PASS), "cizí schránka ani heslo v Můj účet");
  await p2.close();
});

await T("mobil 390 px: seznam → vlákno přes celou obrazovku, bez vodorovného přetékání", async (context) => {
  const page = await context.newPage();
  await login(page, USERS.admin);
  await openInbox(page, "Poptávka hřídele");
  const over = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(over <= 1, `seznam přetéká o ${over}px`);
  await openThread(page, "Posta: Poptávka hřídele 50 ks");
  expect(!(await page.getByTestId("thread-list").isVisible()), "na mobilu je vidět jen vlákno");
  const over2 = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(over2 <= 1, `vlákno přetéká o ${over2}px`);
  await page.getByTestId("btn-reply").click();
  await page.getByTestId("compose-dialog").waitFor();
  const box = await page.getByTestId("compose-dialog").boundingBox();
  expect(box && box.width >= 380, `okno psaní přes celou šířku (${box?.width})`);
  await page.close();
}, { mobile: true });

// ── Opravy z review: nic se samo nepřečte, Přeposlat = přijatá zpráva, celé jméno, /sent → Odeslané ──
await T("review: otevření pošty nic samo nepřečte; Přeposlat bere přijatou zprávu s přílohou; celé jméno odesílatele; /sent → Odeslané", async (context) => {
  const page = await context.newPage();
  await page.setViewportSize({ width: 1280, height: 900 });
  await login(page, USERS.admin);
  await addMsg({ subject: `Nepřečtené ${TAG}`, body: "Nová zpráva, nikdo ji ještě neotevřel.", from: "Jan <jan@zakaznik.test>" });
  await openInbox(page);
  await page.getByRole("button", { name: /Stáhnout poštu/ }).click();
  await page.getByTestId("sync-msg").filter({ hasText: /Staženo/ }).waitFor({ timeout: 90_000 });
  await page.getByTestId("thread-row").filter({ hasText: `Nepřečtené ${TAG}` }).first().waitFor({ timeout: 20_000 });
  await page.waitForTimeout(2500);
  expect(await page.getByText("Vyber e-mail vlevo.").isVisible(), "žádné vlákno se samo neotevře");
  expect(sql(`select is_read from emails where subject = 'Nepřečtené ${TAG}'`) === "f", "nový e-mail zůstal nepřečtený bez kliknutí");
  expect(await page.getByTestId("thread-row").filter({ hasText: `Nepřečtené ${TAG}` }).first().getAttribute("data-unread") === "1", "řádek nepřečtený");
  await openThread(page, `Nepřečtené ${TAG}`);
  await eventually(async () => sql(`select is_read from emails where subject = 'Nepřečtené ${TAG}'`) === "t", "přečteno až po kliknutí", 15_000);

  // Přeposlat ve vlákně, kde je poslední zpráva naše (Fwd) → přeposílá se přijatá zpráva s výkresem
  await page.getByTestId("mail-search").fill(`Výkres ${TAG}`);
  await page.waitForTimeout(800);
  await openThread(page, `Výkres ${TAG}`);
  await eventually(async () => (await page.getByTestId("thread-message").count()) >= 2, "vlákno obsahuje i odeslané přeposlání", 20_000);
  expect(await page.getByTestId("thread-message").last().getAttribute("data-direction") === "out", "poslední zpráva vlákna je naše");
  await page.getByTestId("btn-forward").click();
  const dlg = page.getByTestId("compose-dialog");
  await dlg.getByTestId("compose-attachments").filter({ hasText: "vykres-H200.pdf" }).waitFor({ timeout: 10_000 });
  if (SHOTS) await page.screenshot({ path: path.join(SHOTS, "review-preposlat-1280-light.png") });
  await page.keyboard.press("Escape");
  await dlg.waitFor({ state: "detached" }).catch(() => undefined);
  // jméno odesílatele odeslané zprávy není useknuté („S…")
  const cut = await page.getByTestId("message-who").evaluateAll((els) => els.filter((e) => e.scrollWidth > e.clientWidth + 1).map((e) => e.textContent));
  expect(cut.length === 0, `jména odesílatelů celá (${JSON.stringify(cut)})`);
  if (SHOTS) await page.screenshot({ path: path.join(SHOTS, "review-vlakno-1280-light.png") });

  // stará stránka Odeslaná pošta → složka Odeslané
  await page.goto(`${BASE}/sent`);
  await page.waitForURL(/\/inbox\?slozka=sent/, { timeout: 15_000 });
  await page.getByTestId("folder-sent").and(page.locator('[aria-current="page"]')).first().waitFor({ timeout: 15_000 });
  await page.close();
});

await T("review (mobil): načtení seznamu nic nepřečte; detail až po ťuknutí, Zpět ho zavře", async (context) => {
  const page = await context.newPage();
  await login(page, USERS.admin);
  await addMsg({ subject: `Mobil ${TAG}`, body: "Zpráva pro mobil.", from: "Eva <eva@firma.test>" });
  await openInbox(page);
  await page.getByRole("button", { name: /Stáhnout poštu/ }).click();
  await page.getByTestId("sync-msg").filter({ hasText: /Staženo/ }).waitFor({ timeout: 90_000 });
  const row = page.getByTestId("thread-row").filter({ hasText: `Mobil ${TAG}` }).first();
  await row.waitFor({ timeout: 20_000 });
  await page.waitForTimeout(2500);
  expect(sql(`select is_read from emails where subject = 'Mobil ${TAG}'`) === "f", "mobil: seznam nic nepřečetl");
  expect(await page.getByTestId("thread-view").count() === 0, "mobil: skrytý detail se nenačítá");
  const top = await page.getByTestId("thread-row").first().boundingBox();
  expect(top && top.y < 844 * 0.5, `první vlákno v horní polovině obrazovky (y = ${top?.y})`);
  if (SHOTS) await page.screenshot({ path: path.join(SHOTS, "review-mobil-seznam-390-light.png") });
  await row.locator("button").first().click();
  await page.getByTestId("thread-view").first().waitFor({ timeout: 20_000 });
  await eventually(async () => sql(`select is_read from emails where subject = 'Mobil ${TAG}'`) === "t", "přečteno po ťuknutí", 15_000);
  await page.getByRole("button", { name: "Zpět na seznam" }).click();
  await page.getByTestId("thread-view").waitFor({ state: "detached", timeout: 10_000 });
  await page.close();
}, { mobile: true });

// ── Screenshoty (1280 / 390 px, světlý / tmavý) ──
if (SHOTS) {
  await test("screenshoty pošty", async () => {
    for (const [w, h] of [[1280, 900], [390, 844]]) {
      for (const theme of ["light", "dark"]) {
        const ctx = await browser.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: w < 500 ? 2 : 1, isMobile: w < 500, hasTouch: w < 500, locale: "cs-CZ", colorScheme: theme });
        await ctx.addInitScript((t) => { try { localStorage.setItem("theme", t); } catch {} }, theme);
        const page = await ctx.newPage();
        const name = (s) => path.join(SHOTS, `${s}-${w}-${theme}.png`);
        await login(page, USERS.admin);
        // průběh stahování
        await addMany(130, `Dávka ${w}${theme}`);
        await page.goto(`${BASE}/inbox`);
        await page.getByTestId("mail-folders").first().waitFor();
        await page.getByRole("button", { name: /Stáhnout poštu/ }).click();
        const prog = page.getByTestId("sync-progress").filter({ hasText: /Staženo [\d\s ]+ z/ });
        await prog.waitFor({ timeout: 60_000 }).then(() => page.screenshot({ path: name("stahovani-prubeh") })).catch(() => undefined);
        await page.getByTestId("sync-msg").waitFor({ timeout: 120_000 }).catch(() => undefined);
        // přehled (složky, vlaječky, priority)
        await page.screenshot({ path: name("posta-seznam") });
        await page.getByTestId("mail-search").fill("Poptávka hřídele");
        await page.waitForTimeout(800);
        await openThread(page, "Posta: Poptávka hřídele 50 ks");
        await page.screenshot({ path: name("posta-vlakno") });
        await page.getByTestId("btn-reply").click();
        await page.getByTestId("compose-dialog").waitFor();
        await page.waitForTimeout(600);
        await page.screenshot({ path: name("posta-odpoved") });
        await page.keyboard.press("Escape");
        await page.getByTestId("compose-dialog").waitFor({ state: "detached" }).catch(() => undefined);
        await page.getByTestId("btn-share").click();
        await page.getByTestId("share-dialog").getByTestId(`share-user-${USERS.obchod.email}`).waitFor();
        await page.screenshot({ path: name("posta-predat") });
        await page.keyboard.press("Escape");
        await page.goto(`${BASE}/inbox?slozka=sent`);
        await page.getByTestId("thread-row").first().waitFor({ timeout: 20_000 });
        await page.screenshot({ path: name("posta-odeslane") });
        await page.goto(`${BASE}/account#schranka`);
        await page.waitForLoadState("networkidle");
        await page.locator(`[data-testid="my-box-${BOX}"]:visible`).first().waitFor();
        await page.locator('[data-testid="my-mailbox"]:visible').first().scrollIntoViewIfNeeded();
        await page.screenshot({ path: name("ucet-schranka") });
        await ctx.close();
      }
    }
  });
}

await test("úklid", async () => {
  cleanup();
  expect(sql(`select count(*) from mailboxes where email = '${BOX}'`) === "0", "schránka smazána");
});

await browser.close();
const ok = summary(errors);
process.exit(ok ? 0 : 1);
