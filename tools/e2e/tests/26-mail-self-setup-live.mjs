// E2E 26 (Pošta E, zpětná vazba 30. 10. — „U Víta Volného nejde v poště nastavení prokliknout"):
//  - obchodník (ne super admin) otevře Pošta → Nastavení pošty → Schránka a SÁM si nastaví schránku:
//    e-mail, heslo, příchozí IMAP (server, port, šifrování), odchozí SMTP (server, port, šifrování),
//    Otestovat připojení (příjem + odesílání), uložit — bez odchodu z Pošty,
//  - zpráva vhozená do testovací schránky se v otevřené Poště objeví SAMA (bez kliknutí, ≤ 30 s interval),
//  - „Přijmout a odeslat" (místo „Stáhnout poštu"): odešle zprávu čekající v K odeslání a přijme novou,
//  - telefon 390 px: vše proklikatelné, nic nepřetéká,
//  - výkres zákazníka dodavateli (dokument zakázky i příloha přeposílaného e-mailu) jen anonymizovaný.
// Spuštění (aplikace musí znát testovací poštovní server a jeho CA — viz 12-mailbox-setup.mjs):
//   node tools/e2e/mail-test-server.mjs --dir <dir> &
//   MAIL_TEST_PROVIDERS="$(cat <dir>/providers.json)" NODE_EXTRA_CA_CERTS=<dir>/ca.crt <spusť aplikaci>
//   MAIL_TEST_DIR=<dir> E2E_BASE_URL=http://localhost:3600 [E2E_SHOTS=<dir>] node tools/e2e/tests/26-mail-self-setup-live.mjs
import fs from "node:fs";
import path from "node:path";
import { BASE, launch, withContext, shot, sql, test, expect, summary, localEnv } from "../lib.mjs";

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), "../../..");
const SRV_DIR = process.env.MAIL_TEST_DIR ?? path.join(ROOT, ".local-supabase/mail-test");
const SRV = JSON.parse(fs.readFileSync(path.join(SRV_DIR, "server.json"), "utf8"));
const P = SRV.ports;
const CTL = `http://127.0.0.1:${P.control}`;
const SHOTS = process.env.E2E_SHOTS ?? null;
if (SHOTS) fs.mkdirSync(SHOTS, { recursive: true });

const BOX = "vit26@nastrojarstvi.test";
const BOX_PASS = "Vit26-Heslo-1";
const TAG = `E2E26-${Date.now()}`;
const USER = { email: `${TAG.toLowerCase()}-vit@local.test`, password: "Vit26-Prihlaseni-1!", name: "Vít Volný (E2E 26)" };

const browser = await launch();
const errors = [];
let shotNo = 0;
const T = (name, fn, opts) => test(name, () => withContext(browser, errors, async (context) => {
  try {
    await fn(context);
  } catch (err) {
    for (const p of context.pages()) await shot(p, `26-fail-${++shotNo}`).catch(() => undefined);
    throw err;
  }
}, opts));
const snap = async (page, name, opts = {}) => {
  if (SHOTS) await page.screenshot({ path: path.join(SHOTS, `${name}.png`), ...opts });
};
const ctl = async (p, opts) => (await fetch(`${CTL}${p}`, opts)).json();
const addMsg = (m) => ctl(`/message?user=${encodeURIComponent(BOX)}`, { method: "POST", body: JSON.stringify(m) });

async function eventually(fn, what, timeout = 60_000) {
  const t0 = Date.now();
  for (;;) {
    if (await fn()) return Date.now() - t0;
    if (Date.now() - t0 > timeout) throw new Error(`Očekávání selhalo: ${what}`);
    await new Promise((r) => setTimeout(r, 500));
  }
}

async function adminApi(method, p, body) {
  const env = localEnv();
  const r = await fetch(`${env.NEXT_PUBLIC_SUPABASE_URL}/auth/v1/admin/${p}`, {
    method,
    headers: { apikey: env.SUPABASE_SECRET_KEY, authorization: `Bearer ${env.SUPABASE_SECRET_KEY}`, "content-type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(`GoTrue ${method} ${p}: ${r.status} ${JSON.stringify(j).slice(0, 200)}`);
  return j;
}

const cleanup = () => {
  sql(`delete from mail_outbox where created_by in (select id from profiles where email like 'e2e26-%')`);
  // zakázky a faktury dodavatelů založené z pošty testu (hlavní akce zprávy)
  sql(`delete from supplier_invoices where email_id in (select id from emails where mailbox_id in (select id from mailboxes where email = '${BOX}'))`);
  const jobs = sql(`select coalesce(string_agg(distinct '''' || order_id || '''', ','), '') from emails where order_id is not null and mailbox_id in (select id from mailboxes where email = '${BOX}')`);
  if (jobs) {
    for (const q of [
      `update emails set order_id = null where order_id in (${jobs})`, `delete from job_files where job_id in (${jobs})`,
      `delete from order_items where order_id in (${jobs})`, `delete from quotes where job_id in (${jobs})`, `delete from orders where id in (${jobs})`,
    ]) {
      try { sql(q); } catch (err) { console.log(`    (úklid: ${String(err.message ?? err).split("\n")[0]})`); }
    }
  }
  sql(`delete from emails where mailbox_id in (select id from mailboxes where email = '${BOX}')`);
  sql(`delete from emails where owner_id in (select id from profiles where email like 'e2e26-%')`);
  sql(`delete from mailboxes where email = '${BOX}'`);
};
cleanup();
const u = await adminApi("POST", "users", { email: USER.email, password: USER.password, email_confirm: true, user_metadata: { full_name: USER.name } });
const uid = u.id ?? u.user?.id;
sql(`update profiles set role = 'obchodnik', full_name = '${USER.name}', active = true, password_change_required = false where id = '${uid}'`);

console.log(`26 · Pošta E: obchodník si nastaví schránku v Poště (IMAP ${P.imaps}, SMTP ${P.smtps}, ovládání ${P.control})`);

async function loginAs(page) {
  await page.goto(`${BASE}/login`);
  await page.locator("#email").fill(USER.email);
  await page.locator("#password").fill(USER.password);
  await Promise.all([
    page.waitForURL((x) => !x.pathname.startsWith("/login"), { timeout: 30_000 }),
    page.getByRole("button", { name: /^přihlásit se$/i }).click(),
  ]);
}

async function noOverflow(page, label) {
  const m = await page.evaluate(() => ({ doc: document.documentElement.scrollWidth, vw: window.innerWidth }));
  expect(m.doc <= m.vw + 1, `${label}: nic nepřetéká do strany (${JSON.stringify(m)})`);
}

const rowOf = (page, subject) => page.getByTestId("thread-row").filter({ hasText: subject }).first();

await T("obchodník: Pošta → Nastavení pošty → Schránka → servery ručně (IMAP + SMTP) → Otestovat → uložit, bez odchodu z Pošty", async (context) => {
  const page = await context.newPage();
  await loginAs(page);
  await page.goto(`${BASE}/inbox`);
  // první požadavek na čerstvě spuštěný server bývá pomalý (studený start) → delší čekání
  await page.getByTestId("mail-folders").first().waitFor({ timeout: 90_000 });
  await page.waitForLoadState("networkidle");
  // bez schránky: Přijmout a odeslat ani Připojit schránku nejsou mrtvé — otevřou Nastavení pošty
  await page.getByTestId("btn-send-receive").click({ timeout: 60_000 });
  const panel = page.getByTestId("mail-settings-panel");
  await panel.getByTestId("mail-settings-mailboxes").waitFor({ timeout: 20_000 });
  expect((await panel.getByTestId("mail-settings-tab-schranka").getAttribute("aria-selected")) === "true", "otevřena záložka Schránka");
  await page.keyboard.press("Escape");
  await panel.waitFor({ state: "detached" });
  await page.getByTestId("btn-mail-settings").click();
  await panel.getByTestId("mail-settings-mailboxes").waitFor({ timeout: 20_000 });
  const form = panel.getByTestId("my-mailbox-form");
  await form.waitFor();
  await form.getByLabel("E-mail schránky").fill(BOX);
  await form.getByLabel("Heslo ke schránce").fill(BOX_PASS);
  await form.getByTestId("my-mailbox-advanced").click();
  await form.getByLabel("Příchozí server").fill("127.0.0.1");
  await form.getByLabel("Port příchozího serveru").fill(String(P.imaps));
  await form.getByLabel("Šifrování příchozího serveru").selectOption("tls");
  await form.getByLabel("Uživatelské jméno", { exact: true }).fill(BOX);
  await form.getByLabel("Odchozí server").fill("127.0.0.1");
  await form.getByLabel("Port odchozího serveru").fill(String(P.smtps));
  await form.getByLabel("Šifrování odchozího serveru").selectOption("tls");
  await form.getByTestId("my-mailbox-test").click();
  const res = form.getByTestId("my-mailbox-test-result");
  await res.waitFor({ timeout: 60_000 });
  const rt = await res.innerText();
  expect(/Příjem:\s*OK/.test(rt) && /Odesílání \(SMTP\):\s*OK/.test(rt), `test příjmu i odesílání: ${rt}`);
  expect(sql(`select count(*) from mailboxes where email = '${BOX}'`) === "0", "test nic neuložil");
  await snap(page, "nastaveni-posty-obchodnik-desktop");
  await form.getByTestId("my-mailbox-connect").click();
  await panel.getByTestId("my-mailbox-note").filter({ hasText: /Schránka připojena/ }).filter({ hasText: /Staženo \d+/ }).waitFor({ timeout: 120_000 });
  expect(sql(`select owner_id from mailboxes where email = '${BOX}'`) === uid, "vlastník schránky = obchodník");
  const cfg = JSON.parse(sql(`select (config - 'imap_password')::text from mailboxes where email = '${BOX}'`));
  expect(cfg.imap_host === "127.0.0.1" && cfg.imap_port === P.imaps && cfg.imap_tls === "tls" && cfg.smtp_host === "127.0.0.1" && cfg.smtp_port === P.smtps && cfg.smtp_tls === "tls",
    `uloženo přesně vyplněné: ${JSON.stringify(cfg)}`);
  await panel.locator(`[data-testid="my-box-${BOX}"]`).waitFor();
  await panel.locator(`[data-testid="my-box-${BOX}"]`).getByTestId("my-box-test-send").click();
  await panel.getByTestId("my-mailbox-note").filter({ hasText: /Zkušební e-mail odeslán/ }).waitFor({ timeout: 60_000 });
  expect(new URL(page.url()).pathname === "/inbox", `pořád v Poště (${page.url()})`);
  await snap(page, "nastaveni-posty-obchodnik-desktop-ulozeno");
  await page.keyboard.press("Escape");
  await panel.waitFor({ state: "detached" });
  // po zavření: Pošta ví o schránce a ukazuje stažené zprávy
  await page.getByText("Tvoje schránka:").waitFor({ timeout: 20_000 });
  await rowOf(page, "Vit26: Poptávka hřídele 50 ks").waitFor({ timeout: 30_000 });
  await page.close();
});

await T("živá pošta: nová zpráva se v otevřené Poště objeví sama (bez kliknutí), stav „Aktualizováno před …“", async (context) => {
  const page = await context.newPage();
  await loginAs(page);
  await page.goto(`${BASE}/inbox`);
  await page.waitForLoadState("networkidle");
  await page.getByTestId("thread-list").first().waitFor({ timeout: 30_000 });
  await page.getByTestId("mail-updated").filter({ hasText: /Aktualizováno/ }).waitFor({ timeout: 45_000 });
  const subject = `Živě ${TAG}`;
  await new Promise((r) => setTimeout(r, 1000));
  await addMsg({ subject, body: "Přišlo samo, nikdo neklikl.", from: "Jan Dvořák <dvorak@strojmetal.test>" });
  const t0 = Date.now();
  await rowOf(page, subject).waitFor({ timeout: 80_000 });
  const ms = Date.now() - t0;
  console.log(`    zpráva se objevila sama za ${Math.round(ms / 1000)} s`);
  expect(ms < 80_000, `objevila se do 80 s (${ms} ms)`);
  const label = await page.getByTestId("mail-updated").innerText();
  expect(/Aktualizováno (právě teď|před \d+ s)/.test(label), `stav živé pošty: ${label}`);
  await snap(page, "posta-obchodnik-desktop");
  await page.close();
});

await T("Přijmout a odeslat: zpráva z K odeslání (dřív neodešla — špatné heslo) odejde po opravě + přijme novou", async (context) => {
  const page = await context.newPage();
  await loginAs(page);
  await page.goto(`${BASE}/inbox`);
  await page.waitForLoadState("networkidle");
  await page.getByTestId("thread-list").first().waitFor({ timeout: 30_000 });
  // heslo se na serveru „změnilo" → odeslání selže, zpráva se uloží do K odeslání
  sql(`update mailboxes set config = jsonb_set(config, '{imap_password}', to_jsonb('Spatne-heslo-26'::text)) where email = '${BOX}'`);
  const subject = `Nabídka ${TAG}`;
  await page.getByTestId("btn-compose").first().click();
  const dlg = page.getByTestId("compose-dialog");
  await dlg.locator("#compose-to").fill("zakaznik@firma.test");
  await dlg.locator("#compose-to").press("Enter");
  await dlg.getByLabel("Předmět").fill(subject);
  await dlg.getByLabel("Text zprávy").fill("Dobrý den, posíláme nabídku.");
  await dlg.getByTestId("compose-send").click();
  const err = dlg.getByTestId("compose-error");
  await err.waitFor({ timeout: 60_000 });
  const et = await err.innerText();
  expect(/K odeslání/.test(et), `zpráva se neztratila: ${et}`);
  await dlg.getByTestId("compose-open-settings").waitFor();
  await dlg.getByRole("button", { name: "Zrušit" }).click();
  await page.getByTestId("outbox-bar").filter({ hasText: /1 zpráva čeká na odeslání/ }).waitFor({ timeout: 20_000 });
  expect(sql(`select count(*) from mail_outbox where created_by = '${uid}' and status = 'failed'`) === "1", "ve frontě K odeslání");
  // oprava hesla přímo v Poště: Nastavení pošty → Upravit → heslo → Ověřit a uložit
  await page.getByTestId("btn-mail-settings").click();
  const panel = page.getByTestId("mail-settings-panel");
  await panel.locator(`[data-testid="my-box-${BOX}"]`).getByTestId("my-box-edit").click();
  const form = panel.getByTestId("my-mailbox-form");
  expect((await form.getByLabel("Odchozí server").inputValue()) === "127.0.0.1", "servery předvyplněné");
  await form.getByLabel("Heslo ke schránce").fill(BOX_PASS);
  await form.getByTestId("my-mailbox-connect").click();
  await panel.getByTestId("my-mailbox-note").filter({ hasText: /Schránka upravena/ }).waitFor({ timeout: 120_000 });
  await page.keyboard.press("Escape");
  await panel.waitFor({ state: "detached" });
  // nová příchozí + Přijmout a odeslat
  const inSubject = `Odpověď ${TAG}`;
  await addMsg({ subject: inSubject, body: "Díky.", from: "Eva <eva@firma.test>" });
  const sentBefore = (await ctl("/sent")).length;
  await page.getByTestId("btn-send-receive").click();
  const msg = page.getByTestId("sync-msg").filter({ hasText: /Přijato \d+, odesláno 1\./ });
  await msg.waitFor({ timeout: 120_000 });
  console.log(`    ${await msg.innerText()}`);
  const sent = await ctl("/sent");
  expect(sent.length === sentBefore + 1 && sent.at(-1).raw.includes(TAG), "SMTP server zprávu dostal");
  expect(sql(`select status from mail_outbox where created_by = '${uid}'`) === "sent", "fronta: odesláno");
  await page.getByTestId("outbox-bar").waitFor({ state: "detached", timeout: 15_000 });
  await rowOf(page, inSubject).waitFor({ timeout: 30_000 });
  await page.getByTestId("folder-sent").click();
  await rowOf(page, subject).waitFor({ timeout: 30_000 });
  await page.close();
});

await T("vlákna a hlavní akce: dvě „Poptávka Brisk“ = dvě vlákna; poptávka → Vytvořit nabídku (editor nabídky), faktura → Zapsat fakturu dodavatele, oprava kategorie přepne tlačítko", async (context) => {
  sql(`update mailboxes set config = jsonb_set(config, '{imap_password}', to_jsonb('${BOX_PASS}'::text)) where email = '${BOX}'`);
  const S = `Poptávka Brisk ${TAG}`;
  const from = "Nákup Brisk <nakup@brisk.test>";
  const a1 = await addMsg({ subject: S, body: "Dobrý den, poptáváme 50 ks pouzder dle výkresu BR-100, termín do konce měsíce.", from });
  await addMsg({ subject: `Re: ${S}`, body: "Upřesnění: materiál 11SMnPb30.", from, inReplyTo: a1.messageId, references: a1.messageId });
  await addMsg({ subject: S, body: "Dobrý den, nová poptávka: 200 ks čepů dle výkresu BR-555.", from });
  await addMsg({
    subject: `Faktura ${TAG}`, body: "V příloze faktura za materiál.", from: "Účtárna <fakturace@dodavatel.test>",
    attachments: [{ filename: `faktura-${TAG}.pdf`, contentType: "application/pdf", base64: Buffer.from("%PDF-1.4 faktura E2E 26").toString("base64") }],
  });
  const page = await context.newPage();
  await loginAs(page);
  await page.goto(`${BASE}/inbox`);
  await page.waitForLoadState("networkidle");
  await page.getByTestId("btn-send-receive").click();
  await page.getByTestId("sync-msg").filter({ hasText: /Přijato \d+/ }).waitFor({ timeout: 90_000 });
  await page.getByTestId("mail-search").fill(`Brisk ${TAG}`);
  await eventually(async () => (await page.getByTestId("thread-row").filter({ hasText: S }).count()) === 2, "dvě vlákna „Poptávka Brisk“ (stejný předmět, jiná poptávka)", 20_000);
  const counts = await page.getByTestId("thread-row").filter({ hasText: S }).evaluateAll((els) => els.map((e) => e.querySelector('[aria-label$="zpráv"]')?.textContent ?? "1"));
  expect(counts.sort().join(",") === "1,2", `odpověď s hlavičkami ve vlákně první poptávky (${counts})`);
  // rychlá akce v řádku: Vytvořit nabídku
  const single = page.getByTestId("thread-row").filter({ hasText: S }).filter({ hasNot: page.locator('[aria-label$="zpráv"]') }).first();
  expect((await single.getByTestId("row-action").getAttribute("data-action")) === "quote.create", "řádek poptávky: Vytvořit nabídku");
  await single.locator("button").first().click();
  const view = page.getByTestId("thread-view");
  await view.waitFor();
  const main = view.getByTestId("mail-primary-action");
  await main.waitFor({ timeout: 20_000 });
  expect((await main.getAttribute("data-action")) === "quote.create" && (await main.innerText()).includes("Vytvořit nabídku"), "detail poptávky: Vytvořit nabídku");
  expect(!(await view.getByText("Založit zakázku", { exact: true }).isVisible().catch(() => false)), "Založit zakázku není hlavní tlačítko");
  await snap(page, "posta-poptavka-detail");
  await main.click();
  await page.waitForURL(/\/orders\/[0-9a-f-]+\?tab=nabidky/, { timeout: 30_000 });
  await page.getByRole("dialog").filter({ hasText: /Vytvořit nabídku|Nová nabídka/ }).first().waitFor({ timeout: 20_000 });
  const jobStage = sql(`select status from orders where id = (select order_id from emails where subject = '${S}' and body_text like '%BR-555%' limit 1)`);
  expect(jobStage === "poptavka", `zakázka z poptávky ve stavu poptávka (${jobStage})`);
  // faktura dodavatele
  await page.goto(`${BASE}/inbox`);
  await page.waitForLoadState("networkidle");
  await page.getByTestId("mail-search").fill(`Faktura ${TAG}`);
  const inv = page.getByTestId("thread-row").filter({ hasText: `Faktura ${TAG}` }).first();
  await inv.waitFor({ timeout: 20_000 });
  await inv.locator("button").first().click();
  const imain = view.getByTestId("mail-primary-action");
  await imain.waitFor({ timeout: 20_000 });
  expect((await imain.innerText()).includes("Zapsat fakturu dodavatele"), "detail faktury: Zapsat fakturu dodavatele");
  await snap(page, "posta-faktura-detail");
  // oprava kategorie → tlačítko se hned přepne
  await view.getByTestId("category-picker").first().click();
  await page.getByTestId("category-option-poptavka").click();
  await eventually(async () => (await view.getByTestId("mail-primary-action").getAttribute("data-action")) === "quote.create", "po opravě na Poptávka: Vytvořit nabídku", 10_000);
  await view.getByTestId("category-picker").first().click();
  await page.getByTestId("category-option-faktura").click();
  await eventually(async () => (await view.getByTestId("mail-primary-action").getAttribute("data-action")) === "invoice.record", "zpět Faktura: Zapsat fakturu", 10_000);
  await view.getByTestId("mail-primary-action").click();
  await view.getByTestId("thread-notice").filter({ hasText: /Faktur/ }).waitFor({ timeout: 60_000 });
  const invEmail = sql(`select id from emails where subject = 'Faktura ${TAG}' limit 1`);
  expect(Number(sql(`select count(*) from supplier_invoices where email_id = '${invEmail}'`)) >= 1, "faktura ve Fakturách dodavatelů");
  expect(sql(`select coalesce(order_id::text, '') from emails where id = '${invEmail}'`) === "", "faktura nezaložila zakázku");
  await page.close();
});

await T("výkres zákazníka v odpovědi dodavateli: neanonymizovaný se zablokuje s hláškou, „Odeslat bez tohoto výkresu“ odešle zbytek", async (context) => {
  const S = `Poptávka Brisk ${TAG}`;
  const jobId = sql(`select order_id from emails where subject = '${S}' and body_text like '%BR-555%' and order_id is not null limit 1`);
  expect(Boolean(jobId), "zakázka z poptávky (předchozí krok)");
  const fname = `vykres-BR-555-${TAG}.pdf`;
  sql(`insert into job_files (job_id, kind, filename, mime_type, storage_path, origin) values ('${jobId}', 'vykres', '${fname}', 'application/pdf', '${jobId}/${fname}', 'upload')`);
  sql(`update job_files set anon_status = 'pending', anon_path = null, anon_sha256 = null where job_id = '${jobId}' and filename = '${fname}'`);
  const page = await context.newPage();
  await loginAs(page);
  await page.goto(`${BASE}/inbox`);
  await page.waitForLoadState("networkidle");
  await page.getByTestId("mail-search").fill(`Brisk ${TAG}`);
  const row = page.getByTestId("thread-row").filter({ hasText: S }).filter({ has: page.getByTestId("row-job-chip") }).first();
  await row.waitFor({ timeout: 20_000 });
  await row.locator("button").first().click();
  await page.getByTestId("btn-reply").click();
  const dlg = page.getByTestId("compose-dialog");
  await dlg.waitFor();
  for (const b of await dlg.getByRole("button", { name: /^Odebrat .*@/ }).all()) await b.click();
  await dlg.locator("#compose-to").fill(`kalirna@dodavatel-${TAG.toLowerCase()}.test`);
  await dlg.locator("#compose-to").press("Enter");
  await dlg.getByRole("button", { name: /Z dokumentů zakázky/ }).click({ timeout: 20_000 });
  await dlg.getByTestId("compose-job-files").getByText(fname).click();
  const sentBefore = (await ctl("/sent")).length;
  await dlg.getByTestId("compose-send").click();
  const blocked = dlg.getByTestId("compose-blocked");
  await blocked.waitFor({ timeout: 30_000 });
  const bt = await blocked.innerText();
  expect(/Výkres ještě není anonymizovaný/.test(bt), `hláška: ${bt}`);
  expect(!(await dlg.getByTestId("compose-send-original").count()), "obchodník nemá „Poslat originál“");
  expect((await ctl("/sent")).length === sentBefore, "nic neodešlo");
  await snap(page, "posta-vykres-blokovan");
  await dlg.getByTestId("compose-send-without").click();
  await page.getByTestId("sync-msg").filter({ hasText: /Odesláno/ }).waitFor({ timeout: 60_000 });
  const sent = await ctl("/sent?full=1");
  expect(sent.length === sentBefore + 1 && !sent.at(-1).raw.includes(fname), "odešlo bez výkresu zákazníka");
  await page.close();
});

await T("přeposlání e-mailu zákazníka s výkresem dodavateli: výkres se anonymizuje na požádání a do té doby zablokuje, „Odeslat bez tohoto výkresu“ odešle zbytek", async (context) => {
  sql(`update mailboxes set config = jsonb_set(config, '{imap_password}', to_jsonb('${BOX_PASS}'::text)) where email = '${BOX}'`);
  const S = `Výkres k přeposlání ${TAG}`;
  const fname = `vykres-FW-${TAG}.pdf`;
  await addMsg({
    subject: S, body: "Dobrý den, v příloze výkres příruby.", from: "Petr Nákup <nakup@zakaznik-fw.test>",
    attachments: [{ filename: fname, contentType: "application/pdf", base64: Buffer.from(`%PDF-1.4 vykres zakaznika ${TAG} ${"x".repeat(20_000)}`).toString("base64") }],
  });
  const page = await context.newPage();
  await loginAs(page);
  await page.goto(`${BASE}/inbox`);
  await page.waitForLoadState("networkidle");
  await page.getByTestId("btn-send-receive").click();
  await page.getByTestId("sync-msg").filter({ hasText: /Přijato \d+/ }).waitFor({ timeout: 90_000 });
  await page.getByTestId("mail-search").fill(TAG);
  const row = rowOf(page, S);
  await row.waitFor({ timeout: 20_000 });
  await row.locator("button").first().click();
  await page.getByTestId("message-attachment").filter({ hasText: fname }).waitFor({ timeout: 20_000 });
  await page.getByTestId("btn-forward").click();
  const dlg = page.getByTestId("compose-dialog");
  await dlg.getByTestId("compose-attachments").filter({ hasText: fname }).waitFor({ timeout: 20_000 });
  await dlg.locator("#compose-to").fill(`kalirna@dodavatel-fw-${TAG.toLowerCase()}.test`);
  await dlg.locator("#compose-to").press("Enter");
  const sentBefore = (await ctl("/sent")).length;
  await dlg.getByTestId("compose-send").click();
  const blocked = dlg.getByTestId("compose-blocked");
  await blocked.waitFor({ timeout: 30_000 });
  const bt = await blocked.innerText();
  expect(/Výkres ještě není anonymizovaný/.test(bt) && bt.includes(fname), `hláška: ${bt}`);
  expect(!(await dlg.getByTestId("compose-send-original").count()), "obchodník nemá „Poslat originál“");
  expect((await ctl("/sent")).length === sentBefore, "nic neodešlo");
  // řádek vzniká s anon_via = email; šťouchnutí ho hned zpracuje jako ruční běh (via → „rucne") — testovací
  // „PDF" není čitelné, takže s opraveným pdf.js (904ff35) doběhne do „nelze" dřív, než se sem test dostane
  const adhoc = sql(`select a.anon_via || '|' || coalesce(l.diff->>'source', '') from drawing_anon_adhoc a left join audit_log l on l.entity_id = a.id::text and l.action = 'drawing_anon_adhoc' where a.user_id = '${uid}' and a.filename = '${fname}'`).split("\n").filter(Boolean);
  expect(adhoc.length === 1 && /^(email|rucne)\|email_forward$/.test(adhoc[0]), `výkres zařazen k anonymizaci na požádání (${adhoc.join(", ")})`);
  await snap(page, "posta-preposlani-vykres-blokovan");
  await dlg.getByTestId("compose-send-without").click();
  await page.getByTestId("sync-msg").filter({ hasText: /Odesláno/ }).waitFor({ timeout: 60_000 });
  const sent = await ctl("/sent?full=1");
  expect(sent.length === sentBefore + 1 && !sent.at(-1).raw.includes(fname), "přeposláno bez výkresu zákazníka");
  await page.close();
});

await T("telefon 390 px: Pošta s Přijmout a odeslat, Nastavení pošty → Schránka → Upravit, vše proklikatelné, nic nepřetéká", async (context) => {
  // nezávisle na předchozím testu: platné heslo schránky
  sql(`update mailboxes set config = jsonb_set(config, '{imap_password}', to_jsonb('${BOX_PASS}'::text)) where email = '${BOX}'`);
  const page = await context.newPage();
  await loginAs(page);
  await page.goto(`${BASE}/inbox`);
  await page.waitForLoadState("networkidle");
  await page.getByTestId("thread-list").first().waitFor({ timeout: 30_000 });
  await noOverflow(page, "Pošta 390");
  await page.getByTestId("btn-send-receive").click();
  await page.getByTestId("sync-msg").filter({ hasText: /Přijato \d+, odesláno \d+/ }).waitFor({ timeout: 90_000 });
  await snap(page, "posta-obchodnik-390");
  await page.getByTestId("btn-mail-settings").click();
  const panel = page.getByTestId("mail-settings-panel");
  await panel.locator(`[data-testid="my-box-${BOX}"]`).waitFor({ timeout: 20_000 });
  const pb = await panel.boundingBox();
  expect(pb && pb.width >= 385, `panel přes celou šířku (${pb?.width})`);
  await panel.locator(`[data-testid="my-box-${BOX}"]`).getByTestId("my-box-test").click();
  await panel.getByTestId("my-mailbox-note").filter({ hasText: /Příjem OK/ }).waitFor({ timeout: 60_000 });
  await panel.locator(`[data-testid="my-box-${BOX}"]`).getByTestId("my-box-edit").click();
  const form = panel.getByTestId("my-mailbox-form");
  await form.getByLabel("Šifrování odchozího serveru").waitFor();
  const over = await panel.evaluate((el) => Math.max(el.scrollWidth - el.clientWidth, ...Array.from(el.querySelectorAll("[role=tabpanel]")).map((p) => p.scrollWidth - p.clientWidth)));
  expect(over <= 1, `panel přetéká o ${over}px`);
  await form.getByTestId("my-mailbox-smtp-separate").check();
  await form.getByLabel("Heslo SMTP").waitFor();
  await form.getByTestId("my-mailbox-smtp-separate").uncheck();
  await snap(page, "nastaveni-posty-obchodnik-390", { fullPage: true });
  await form.getByTestId("my-mailbox-test").click();
  await form.getByTestId("my-mailbox-test-result").filter({ hasText: /Příjem:\s*OK/ }).waitFor({ timeout: 60_000 });
  await panel.getByTestId("mail-settings-tab-podpis").click();
  await panel.getByTestId("signature-editor").waitFor({ timeout: 20_000 });
  await panel.getByRole("button", { name: "heslo a servery v záložce Schránka" }).click();
  await panel.getByTestId("mail-settings-mailboxes").waitFor();
  await panel.getByRole("button", { name: "Zavřít" }).first().click();
  await panel.waitFor({ state: "detached" });
  await noOverflow(page, "Pošta po zavření nastavení");
  await page.close();
}, { mobile: true });

cleanup();
await adminApi("DELETE", `users/${uid}`).catch(() => undefined);
await browser.close();
const ok = summary(errors);
process.exit(ok ? 0 : 1);
