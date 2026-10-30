// E2E 25: Pošta D (úpravy z bety 29. 10.) — kategorie zpět (štítek, čipy filtru v každé složce, oprava
// jedním ťuknutím u přijaté i odeslané), jedna položka „Pošta" (/sent → složka Odeslané), grafický
// podpis s logem v Pošta → Nastavení pošty (ozubené kolo, odkaz z Můj účet) a odeslaná zpráva na
// testovacím SMTP: HTML podpis s vloženým logem (cid) právě jednou — i v odpovědi na vlastní zprávu
// s podpisem v citaci. Mobil 390 px: horní lišta nepřetéká, Odhlásit / motiv / Můj účet v Menu.
//
// Spuštění (aplikace musí znát testovací poštovní server a jeho CA — viz 12-mailbox-setup.mjs):
//   node tools/e2e/mail-test-server.mjs --dir <dir> --base 34000 &
//   MAIL_TEST_PROVIDERS="$(cat <dir>/providers.json)" NODE_EXTRA_CA_CERTS=<dir>/ca.crt <spusť aplikaci>
//   MAIL_TEST_DIR=<dir> E2E_BASE_URL=http://localhost:3600 [E2E_SHOTS=<adresář>] node tools/e2e/tests/25-mail-polish.mjs
import fs from "node:fs";
import path from "node:path";
import { BASE, USERS, launch, withContext, login, shot, sql, test, expect, summary } from "../lib.mjs";

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), "../../..");
const SRV_DIR = process.env.MAIL_TEST_DIR ?? path.join(ROOT, ".local-supabase/mail-test");
const SRV = JSON.parse(fs.readFileSync(path.join(SRV_DIR, "server.json"), "utf8"));
const CTL = `http://127.0.0.1:${SRV.ports.control}`;
const SHOTS = process.env.E2E_SHOTS ?? null;
if (SHOTS) fs.mkdirSync(SHOTS, { recursive: true });

const BOX = "podpis25@nastrojarstvi.test";
const PASS = "Podpis25-Heslo-1";
const TAG = `E2E25-${Date.now()}`;
const ROLE = `obchodní ředitel ${TAG}`;
const CID = "podpis-logo@mnastrojarna.cz";

const browser = await launch();
const errors = [];
let shotNo = 0;
const T = (name, fn, opts) => test(name, () => withContext(browser, errors, async (context) => {
  try {
    await fn(context);
  } catch (err) {
    for (const p of context.pages()) await shot(p, `25-fail-${++shotNo}`).catch(() => undefined);
    throw err;
  }
}, opts));
const snap = async (page, name, opts = {}) => {
  if (SHOTS) await page.screenshot({ path: path.join(SHOTS, `${name}.png`), ...opts });
};

const adminId = sql(`select id from profiles where email = '${USERS.admin.email}'`);
// podpis admina vrátit po testu (sdílená lokální DB, další E2E počítají s výchozím)
const savedSignatures = sql(`select coalesce(mail_signatures::text, '') from profiles where id = '${adminId}'`);
const cleanup = () => {
  sql(`delete from email_shares where thread_id in (select thread_id from emails where mailbox_id in (select id from mailboxes where email = '${BOX}'))`);
  sql(`delete from emails where mailbox_id in (select id from mailboxes where email = '${BOX}')`);
  sql(`delete from mailboxes where email = '${BOX}'`);
};
cleanup();

const ctl = async (p, opts) => (await fetch(`${CTL}${p}`, opts)).json();
const sentAll = async () => ctl("/sent?full=1");
const addMsg = (m) => ctl(`/message?user=${encodeURIComponent(BOX)}`, { method: "POST", body: JSON.stringify(m) });

console.log(`25 · pošta D (testovací server SMTP ${SRV.ports.smtps}, ovládání ${SRV.ports.control})`);

async function eventually(fn, what, timeout = 60_000) {
  const t0 = Date.now();
  for (;;) {
    if (await fn()) return;
    if (Date.now() - t0 > timeout) throw new Error(`Očekávání selhalo: ${what}`);
    await new Promise((r) => setTimeout(r, 500));
  }
}

// ── MIME (bez závislostí): části zprávy, dekódování QP / base64 ──
function decode(body, enc) {
  if (/base64/i.test(enc)) return Buffer.from(body.replace(/[^A-Za-z0-9+/=]/g, ""), "base64");
  if (/quoted-printable/i.test(enc)) {
    return Buffer.from(body.replace(/=\r?\n/g, "").replace(/=([0-9A-Fa-f]{2})/g, (_, h) => String.fromCharCode(parseInt(h, 16))), "latin1");
  }
  return Buffer.from(body, "latin1");
}
function leaves(raw) {
  const i = raw.search(/\r?\n\r?\n/);
  const head = i < 0 ? raw : raw.slice(0, i);
  const body = i < 0 ? "" : raw.slice(i).replace(/^\r?\n\r?\n/, "");
  const h = head.replace(/\r?\n[ \t]+/g, " ");
  const ct = /^content-type:\s*([^;\r\n]+)/im.exec(h)?.[1]?.trim().toLowerCase() ?? "text/plain";
  const boundary = /boundary="?([^";\r\n]+)"?/i.exec(h)?.[1];
  if (ct.startsWith("multipart/") && boundary) {
    return body.split(`--${boundary}`).slice(1).filter((p) => !p.startsWith("--")).flatMap((p) => leaves(p.replace(/^\r?\n/, "")));
  }
  const enc = /^content-transfer-encoding:\s*(\S+)/im.exec(h)?.[1] ?? "7bit";
  return [{ ct, cid: /^content-id:\s*(<[^>]+>)/im.exec(h)?.[1] ?? null, data: decode(body, enc) }];
}
function analyze(raw) {
  const ls = leaves(raw);
  return {
    html: ls.filter((l) => l.ct === "text/html").map((l) => l.data.toString("utf8")).join("\n"),
    text: ls.filter((l) => l.ct === "text/plain").map((l) => l.data.toString("utf8")).join("\n"),
    images: ls.filter((l) => l.ct.startsWith("image/")),
  };
}
const count = (hay, needle) => hay.split(needle).length - 1;
/** Předmět z hlavičky (encoded-words B i Q, i rozdělené na víc řádků). */
const subjectOf = (raw) => {
  const m = (/^Subject: (.+(?:\r?\n[ \t].+)*)/m.exec(raw)?.[1] ?? "").replace(/\r?\n[ \t]+/g, " ");
  // sousední encoded-words se spojí (vícebajtový znak může být rozdělený mezi dvě slova)
  return m.replace(/(?:=\?[^?]+\?[BQ]\?[^?]*\?=\s*)+/gi, (seq) => {
    const bytes = [...seq.matchAll(/=\?[^?]+\?([BQ])\?([^?]*)\?=/gi)].map(([, enc, txt]) => (enc.toUpperCase() === "B"
      ? Buffer.from(txt, "base64")
      : Buffer.from(txt.replace(/_/g, " ").replace(/=([0-9A-Fa-f]{2})/g, (_x, h) => String.fromCharCode(parseInt(h, 16))), "latin1")));
    return Buffer.concat(bytes).toString("utf8") + (/\s$/.test(seq) ? " " : "");
  });
};
const sentWith = async (needle) => (await sentAll()).map((s) => s.raw).filter((r) => subjectOf(r).includes(needle));

/** Ověří podpis v odeslané zprávě: HTML s grafickým podpisem a logem (cid) právě jednou + textová verze. */
function expectSignedOnce(raw, label) {
  const a = analyze(raw);
  expect(count(raw.replace(/\r?\n[ \t]+/g, " "), `Content-ID: <${CID}>`) === 1, `${label}: logo vložené jednou (Content-ID)`);
  expect(a.images.length === 1 && a.images[0].data.subarray(1, 4).toString() === "PNG", `${label}: jeden obrázek PNG (${a.images.length})`);
  expect(count(a.html, `cid:${CID}`) === 1, `${label}: HTML odkazuje logo jednou (${count(a.html, `cid:${CID}`)})`);
  expect(count(a.html, 'data-mn-signature="1"') === 1, `${label}: grafický podpis jednou`);
  expect(a.html.includes(ROLE), `${label}: pozice z Nastavení pošty v HTML`);
  expect(a.text.includes(ROLE), `${label}: textová verze podpisu`);
  return a;
}

async function openInbox(page) {
  await page.goto(`${BASE}/inbox`);
  await page.getByTestId("mail-folders").first().waitFor();
  await page.waitForLoadState("networkidle");
}
const rowOf = (page, subject) => page.getByTestId("thread-row").filter({ hasText: subject }).first();
/** Otevře vlákno řádku (`expectText` = text, který otevřené vlákno musí obsahovat; výchozí předmět). */
async function openThread(page, subject, expectText = subject) {
  const row = rowOf(page, subject);
  await row.waitFor({ timeout: 30_000 });
  await row.locator("button").first().click();
  await page.getByTestId("thread-view").filter({ hasText: expectText }).last().waitFor({ timeout: 20_000 });
  await page.getByTestId("thread-message").first().waitFor({ timeout: 20_000 });
}
async function search(page, q) {
  // streamovaná stránka (loading.tsx) může mít chvíli i skrytou kopii obsahu
  await page.locator('[data-testid="mail-search"]:visible').first().fill(q);
  await page.waitForTimeout(700);
  await page.waitForLoadState("networkidle");
}

// ── 1) schránka ──
await T("Můj účet: připojím schránku → pošta stažena; podpis má v Můj účet jen odkaz do Pošty", async (context) => {
  const page = await context.newPage();
  await login(page, USERS.admin);
  await page.goto(`${BASE}/account#schranka`);
  await page.waitForLoadState("networkidle");
  const form = page.locator('[data-testid="my-mailbox-form"]:visible').first();
  if (!(await form.isVisible().catch(() => false))) await page.locator('[data-testid="my-mailbox-add"]:visible').first().click();
  await form.waitFor();
  await form.getByLabel("E-mail schránky").fill(BOX);
  await form.getByLabel("Heslo ke schránce").fill(PASS);
  await form.getByTestId("my-mailbox-connect").click();
  await page.getByTestId("my-mailbox-note").filter({ hasText: /Schránka připojena/ }).filter({ hasText: /Staženo \d+/ }).waitFor({ timeout: 120_000 });
  expect(sql(`select owner_id from mailboxes where email = '${BOX}'`) === adminId, "vlastník = admin");
  const link = page.locator('[data-testid="account-signature-link"]:visible').first();
  await link.waitFor();
  expect(!(await page.locator("textarea[aria-label='Podpis e-mailu']").count()), "starý textový formulář podpisu v Můj účet není");
  await link.getByRole("link", { name: /Nastavení pošty/ }).click();
  await page.waitForURL(/\/inbox/);
  await page.getByTestId("mail-settings-panel").waitFor({ timeout: 20_000 });
  expect(!new URL(page.url()).searchParams.has("nastaveni"), "parametr ?nastaveni z adresy zmizel");
  await page.close();
});

// ── 2) kategorie u přijaté ──
await T("Pošta: jedna položka v menu, štítek kategorie u každé zprávy, čipy filtru, oprava jedním ťuknutím (přijatá)", async (context) => {
  const page = await context.newPage();
  await login(page, USERS.admin);
  await openInbox(page);
  const nav = (await page.locator("aside nav a").allInnerTexts()).join(" | ");
  expect(/Pošta/.test(nav) && !/Odeslaná pošta|Přijatá pošta/.test(nav), `menu: jen „Pošta" (${nav.slice(0, 300)})`);
  expect((await page.locator("main h1").first().innerText()).trim() === "Pošta", "nadpis Pošta");
  await page.getByTestId("category-chips").waitFor();
  await search(page, "Podpis25:");
  const subj = "Podpis25: Nabídka materiálu";
  const row = rowOf(page, subj);
  await row.waitFor({ timeout: 30_000 });
  const picker = row.getByTestId("category-picker");
  expect((await picker.getAttribute("data-category")) === "Nabídka dodavatele", `štítek z pravidel: ${await picker.getAttribute("data-category")}`);
  // každý řádek má štítek
  const rows = await page.getByTestId("thread-row").count();
  const pills = await page.getByTestId("thread-list").getByTestId("category-picker").count();
  expect(rows > 0 && pills === rows, `štítek u každého řádku (${pills}/${rows})`);
  await snap(page, "posta-desktop-1440");
  // oprava: ťuk na štítek → Faktura
  await picker.click();
  await page.getByTestId("category-option-faktura").click();
  await eventually(async () => sql(`select category || '|' || coalesce(category_set_by::text, '') from emails where subject = '${subj}' and mailbox_id = (select id from mailboxes where email = '${BOX}')`) === `faktura|${adminId}`, "kategorie uložena s autorem", 15_000);
  expect(sql(`select count(*) from ai_corrections where created_by = '${adminId}' and corrected_value = 'Faktura' and context like '%${subj}%'`) !== "0", "korekce pro AI uložena");
  // filtr: čip Faktura → řádek tam je; čip Poptávka → není
  await page.getByTestId("category-chip-faktura").click();
  await rowOf(page, subj).waitFor({ timeout: 15_000 });
  await page.getByTestId("category-chip-poptavka").click();
  await rowOf(page, "Podpis25: Poptávka hřídele 50 ks").waitFor({ timeout: 15_000 });
  await eventually(async () => !(await rowOf(page, subj).isVisible().catch(() => false)), "Poptávka: řádek Faktury zmizel", 10_000);
  await page.getByTestId("category-chip-all").click();
  // obnovení stránky: oprava drží
  await page.reload();
  await page.getByTestId("mail-folders").first().waitFor();
  await search(page, subj);
  expect((await rowOf(page, subj).getByTestId("category-picker").getAttribute("data-category")) === "Faktura", "po obnovení Faktura");
  // ve složce K zakázkám čip „K zakázce" není (to je složka sama)
  await page.getByTestId("folder-jobs").click();
  await page.waitForLoadState("networkidle");
  expect(!(await page.getByTestId("category-chip-k_zakazce").count()), "K zakázkám bez čipu K zakázce");
  await page.close();
});

// ── 3) podpis v Nastavení pošty ──
await T("Nastavení pošty (ozubené kolo): výchozí Firemní, živý náhled s logem, upravím pozici a uložím pro svou schránku", async (context) => {
  const page = await context.newPage();
  await login(page, USERS.admin);
  await openInbox(page);
  await page.getByTestId("btn-mail-settings").click();
  const panel = page.getByTestId("mail-settings-panel");
  // ozubené kolo otevře záložku Schránka (servery a heslo); podpis je vedlejší záložka
  await panel.getByTestId("mail-settings-mailboxes").waitFor({ timeout: 20_000 });
  await panel.getByTestId("mail-settings-tab-podpis").click();
  await panel.getByTestId("signature-editor").waitFor({ timeout: 20_000 });
  const boxes = panel.getByTestId("signature-mailboxes");
  if (await boxes.count()) {
    await boxes.getByRole("radio", { name: new RegExp(BOX.replace(/[.@]/g, "\\$&")) }).click();
    await panel.getByTestId("mail-settings-mailbox").filter({ hasText: BOX }).waitFor({ timeout: 15_000 });
  }
  const firemni = panel.locator('[data-variant="firemni"]');
  expect((await firemni.getAttribute("aria-checked")) === "true", "výchozí varianta Firemní");
  for (const v of ["kompaktni", "vizitka"]) expect(await panel.locator(`[data-variant="${v}"]`).count() === 1, `varianta ${v} k výběru`);
  const frame = panel.getByTestId("signature-preview").frameLocator("iframe");
  await frame.locator('img[src*="mnastrojarna-email-logo"]').waitFor({ timeout: 10_000 });
  expect((await frame.locator("body").innerText()).includes("Mnástrojárna s.r.o."), "název firmy podle logomanuálu v náhledu");
  await panel.getByLabel("Pozice").fill(ROLE);
  await eventually(async () => (await frame.locator("body").innerText().catch(() => "")).includes(ROLE), "živý náhled ukazuje pozici", 10_000);
  await snap(page, "nastaveni-posty-desktop-1440");
  await panel.getByTestId("signature-save").click();
  await panel.getByTestId("signature-status").filter({ hasText: "Podpis uložen." }).waitFor({ timeout: 15_000 });
  expect(sql(`select mail_signatures->'mailboxes'->'${BOX}'->>'role' from profiles where id = '${adminId}'`) === ROLE, "uloženo pro schránku");
  expect(sql(`select mail_signatures->'mailboxes'->'${BOX}'->>'variant' from profiles where id = '${adminId}'`) === "firemni", "varianta Firemní");
  await page.close();
});

// ── 4) odeslání: podpis jednou, kategorie u odeslané ──
await T("nová zpráva: podpis v okně (dá se upravit) → na SMTP HTML s logem právě jednou; Odeslané: štítek + oprava + filtr", async (context) => {
  const page = await context.newPage();
  await login(page, USERS.admin);
  await openInbox(page);
  await page.getByTestId("btn-compose").click();
  const dlg = page.getByTestId("compose-dialog");
  await dlg.waitFor();
  await page.getByTestId("compose-from").filter({ hasText: /Odešle se z/ }).waitFor({ timeout: 20_000 });
  const from = await page.getByTestId("compose-from").innerText();
  const body = dlg.getByLabel("Text zprávy");
  await eventually(async () => (await body.inputValue()).includes("S pozdravem"), "podpis vložený do okna psaní", 15_000);
  // admin má víc schránek — zprávu napíšeme jako odpověď ze schránky BOX níže; tady stačí, že podpis je v okně
  expect((await body.inputValue()).split("S pozdravem").length === 2, "podpis v okně jednou");
  await page.keyboard.press("Escape");
  await dlg.waitFor({ state: "detached" }).catch(() => undefined);

  // odpověď na poptávku ze schránky BOX (podpis této schránky)
  await search(page, "Podpis25: Poptávka hřídele");
  await openThread(page, "Podpis25: Poptávka hřídele 50 ks");
  await page.getByTestId("btn-reply").click();
  await dlg.waitFor();
  await page.getByTestId("compose-from").filter({ hasText: BOX }).waitFor({ timeout: 20_000 });
  await eventually(async () => (await body.inputValue()).includes(ROLE), "podpis schránky (s pozicí) v odpovědi", 15_000);
  expect(count(await body.inputValue(), ROLE) === 1, "podpis v okně jednou");
  await body.press("Control+Home");
  await body.type(`Dobrý den, nabídku pošleme zítra. ${TAG}`);
  await dlg.getByLabel("Předmět").fill(`Re: Poptávka ${TAG}`);
  if (SHOTS) await snap(page, "psani-s-podpisem-desktop-1440");
  await dlg.getByTestId("compose-send").click();
  await page.getByTestId("sync-msg").filter({ hasText: new RegExp(`Odesláno z ${BOX.replace(/[.@]/g, "\\$&")}`) }).waitFor({ timeout: 60_000 });
  await eventually(async () => (await sentWith(`Re: Poptávka ${TAG}`)).length === 1, "SMTP přijal odpověď", 30_000);
  const raw = (await sentWith(`Re: Poptávka ${TAG}`))[0];
  const a = expectSignedOnce(raw, "odpověď");
  expect(a.html.includes(`nabídku pošleme zítra. ${TAG}`), "text zprávy v HTML");
  expect(a.html.includes("<blockquote"), "citace původní zprávy");
  if (SHOTS) {
    // e-mail tak, jak ho uvidí zákazník (HTML ze SMTP, logo z přílohy)
    const p2 = await context.newPage();
    await p2.setViewportSize({ width: 900, height: 900 });
    const logo = a.images[0].data.toString("base64");
    await p2.setContent(a.html.split(`cid:${CID}`).join(`data:image/png;base64,${logo}`));
    await snap(p2, "odeslany-email-html-desktop", { fullPage: true });
    await p2.setViewportSize({ width: 390, height: 844 });
    await snap(p2, "odeslany-email-html-390", { fullPage: true });
    await p2.close();
  }
  expect(sql(`select category from emails where subject = 'Re: Poptávka ${TAG}' and direction = 'out'`) === "poptavka", "odeslaná: kategorie převzatá z poptávky");
  expect(sql(`select (body_html like '%/brand/mnastrojarna-email-logo@2x.png%' and body_html not like '%cid:%')::text from emails where subject = 'Re: Poptávka ${TAG}' and direction = 'out'`) === "true", "v aplikaci logo z webu, ne cid");

  // Odeslané: štítek u odeslané, oprava ťuknutím, filtr čipem
  await search(page, "");
  await page.getByTestId("folder-sent").click();
  await search(page, TAG);
  const row = rowOf(page, `Re: Poptávka ${TAG}`);
  await row.waitFor({ timeout: 20_000 });
  const picker = row.getByTestId("category-picker");
  expect((await picker.getAttribute("data-category")) === "Poptávka", `štítek odeslané: ${await picker.getAttribute("data-category")}`);
  await picker.click();
  expect(!(await page.getByTestId("category-option-spam").count()), "odeslaná nemůže být spam");
  await page.getByTestId("category-option-objednavka").click();
  await eventually(async () => sql(`select category || '|' || coalesce(category_set_by::text, '') from emails where subject = 'Re: Poptávka ${TAG}' and direction = 'out'`) === `objednavka|${adminId}`, "oprava odeslané uložena", 15_000);
  await page.getByTestId("category-chip-objednavka").click();
  await rowOf(page, `Re: Poptávka ${TAG}`).waitFor({ timeout: 15_000 });
  await page.getByTestId("category-chip-faktura").click();
  await eventually(async () => !(await rowOf(page, `Re: Poptávka ${TAG}`).isVisible().catch(() => false)), "filtr Faktura odeslanou Objednávku skryje", 10_000);
  await page.getByTestId("category-chip-all").click();

  // vlákno: zpráva „jak odešla" s grafickým podpisem
  await openThread(page, `Re: Poptávka ${TAG}`, TAG);
  const out = page.getByTestId("thread-message").filter({ hasText: TAG }).last();
  await out.getByTestId("message-as-sent").click();
  // (text zprávy se nahradí rámem — filtr podle textu už zprávu nenajde)
  const frame = page.getByTestId("message-sent-html").first().locator("iframe");
  await frame.waitFor();
  await eventually(async () => (await frame.evaluate((f) => {
    const img = f.contentDocument?.querySelector('img[src*="mnastrojarna-email-logo"]');
    return Boolean(img && img.complete && img.naturalWidth > 0);
  }).catch(() => false)), "zpráva „jak odešla“ s logem z webu aplikace", 15_000);
  await snap(page, "odeslana-zprava-desktop-1440");
  await page.close();
});

await T("odpověď na vlastní zprávu (podpis v citaci) → grafický podpis s logem stále jen jednou", async (context) => {
  const page = await context.newPage();
  await login(page, USERS.admin);
  await openInbox(page);
  await page.getByTestId("folder-sent").click();
  await search(page, TAG);
  await openThread(page, `Re: Poptávka ${TAG}`, TAG);
  const out = page.getByTestId("thread-message").filter({ hasText: `nabídku pošleme zítra. ${TAG}` }).last();
  if (!(await out.getByTestId("message-reply").isVisible().catch(() => false))) await out.locator("button").first().click();
  await out.getByTestId("message-reply").click();
  const dlg = page.getByTestId("compose-dialog");
  await dlg.waitFor();
  await page.getByTestId("compose-from").filter({ hasText: BOX }).waitFor({ timeout: 20_000 });
  const body = dlg.getByLabel("Text zprávy");
  await eventually(async () => count(await body.inputValue(), ROLE) === 2, "nový podpis + podpis v citaci původní zprávy", 15_000);
  await body.press("Control+Home");
  await body.type(`Doplnění ${TAG}`);
  await dlg.getByLabel("Předmět").fill(`Re: Doplnění ${TAG}`);
  await dlg.getByTestId("compose-send").click();
  await page.getByTestId("sync-msg").filter({ hasText: /Odesláno z/ }).waitFor({ timeout: 60_000 });
  await eventually(async () => (await sentWith(`Re: Doplnění ${TAG}`)).length === 1, "SMTP přijal druhou odpověď", 30_000);
  const a = expectSignedOnce((await sentWith(`Re: Doplnění ${TAG}`))[0], "odpověď na vlastní zprávu");
  expect(count(a.text, ROLE) === 2, "text: podpis + citovaný podpis (citace se nemění)");
  await page.close();
});

// ── 5) /sent → složka Odeslané ──
await T("/sent → Pošta, složka Odeslané (stará záložka funguje, v menu svítí Pošta)", async (context) => {
  const page = await context.newPage();
  await login(page, USERS.admin);
  await page.goto(`${BASE}/sent`);
  await page.waitForURL(/\/inbox\?slozka=sent/, { timeout: 15_000 });
  await page.getByTestId("folder-sent").and(page.locator('[aria-current="page"]')).first().waitFor({ timeout: 15_000 });
  const active = await page.locator('aside nav a[aria-current="page"], aside nav a.bg-primary\\/10').allInnerTexts().catch(() => []);
  expect(active.join(" ").includes("Pošta") || (await page.locator('aside nav a[href="/inbox"]').count()) === 1, `aktivní Pošta (${active})`);
  expect(!(await page.locator('aside nav a[href="/sent"]').count()), "v menu není /sent");
  await page.close();
});

// ── 6) mobil 390 px ──
await T("mobil 390 px: horní lišta nepřetéká, Menu nese Můj účet / motiv / Odhlásit; Pošta s čipy a Nastavení pošty", async (context) => {
  const page = await context.newPage();
  await login(page, USERS.admin);
  await page.goto(`${BASE}/orders`);
  await page.waitForLoadState("networkidle");
  const over = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(over <= 1, `stránka přetéká o ${over}px`);
  const header = page.locator("header").first();
  const hb = await header.boundingBox();
  const kids = await header.evaluate((h) => [...h.querySelectorAll("*")].filter((e) => e.getClientRects().length && getComputedStyle(e).visibility !== "hidden").map((e) => e.getBoundingClientRect().right));
  expect(hb && Math.max(...kids) <= hb.x + hb.width + 1, `horní lišta nepřetéká (${Math.max(...kids)} > ${hb?.width})`);
  expect(!(await page.getByTestId("topbar-account").isVisible()), "účet a motiv nejsou v horní liště na telefonu");
  await page.getByRole("button", { name: /^Menu/ }).click();
  const acc = page.getByTestId("mobile-menu-account");
  await acc.waitFor();
  expect(await page.getByRole("dialog").getByRole("link", { name: /Můj účet/ }).isVisible(), "Můj účet v Menu");
  expect(await acc.getByTestId("mobile-menu-signout").isVisible(), "Odhlásit v Menu");
  await acc.getByText("Super Admin").first().waitFor();
  const wasDark = await page.evaluate(() => document.documentElement.classList.contains("dark"));
  await acc.getByTestId("mobile-menu-theme").click();
  await eventually(async () => (await page.evaluate(() => document.documentElement.classList.contains("dark"))) !== wasDark, "motiv přepnut z Menu", 5_000);
  await snap(page, "mobilni-menu-390");
  await acc.getByTestId("mobile-menu-theme").click();
  await eventually(async () => (await page.evaluate(() => document.documentElement.classList.contains("dark"))) === wasDark, "motiv zpět", 5_000);
  const menuText = await page.getByRole("dialog").innerText();
  expect(!/Odeslaná pošta|Přijatá pošta/.test(menuText), "v Menu jen Pošta");
  await page.keyboard.press("Escape");

  await openInbox(page);
  await page.getByTestId("category-chips").waitFor();
  const over2 = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(over2 <= 1, `Pošta přetéká o ${over2}px`);
  await search(page, "Podpis25:");
  await rowOf(page, "Podpis25: Poptávka hřídele 50 ks").waitFor({ timeout: 20_000 });
  await snap(page, "posta-390");
  await page.getByTestId("btn-mail-settings").click();
  const panel = page.getByTestId("mail-settings-panel");
  await panel.getByTestId("mail-settings-mailboxes").waitFor({ timeout: 20_000 });
  await panel.getByTestId("mail-settings-tab-podpis").click();
  await panel.getByTestId("signature-editor").waitFor({ timeout: 20_000 });
  const pb = await panel.boundingBox();
  expect(pb && pb.width >= 385, `Nastavení pošty přes celou šířku (${pb?.width})`);
  const over3 = await panel.evaluate((el) => el.scrollWidth - el.clientWidth);
  expect(over3 <= 1, `panel přetéká o ${over3}px`);
  await snap(page, "nastaveni-posty-390");
  await page.keyboard.press("Escape");
  await panel.waitFor({ state: "detached" }).catch(() => undefined);

  // odeslaná zpráva na telefonu (vlákno teď končí druhou odpovědí „Re: Doplnění …")
  await page.getByTestId("folder-sent").click();
  await search(page, TAG);
  await openThread(page, TAG, TAG);
  const out = page.getByTestId("thread-message").filter({ hasText: `nabídku pošleme zítra. ${TAG}` }).first();
  if (!(await out.getByTestId("message-as-sent").isVisible().catch(() => false))) await out.locator("button").first().click();
  await out.getByTestId("message-as-sent").click();
  await page.getByTestId("message-sent-html").first().waitFor();
  await page.waitForTimeout(800);
  await snap(page, "odeslana-zprava-390");

  // Odhlásit z Menu
  await page.getByTestId("thread-pane").getByRole("button", { name: "Zpět na seznam" }).click().catch(() => undefined);
  await page.getByRole("button", { name: /^Menu/ }).click();
  await page.getByTestId("mobile-menu-signout").click();
  await page.waitForURL(/\/login/, { timeout: 15_000 });
  await page.close();
}, { mobile: true });

cleanup();
sql(`update profiles set mail_signatures = ${savedSignatures ? `'${savedSignatures.replace(/'/g, "''")}'::jsonb` : "null"} where id = '${adminId}'`);
await browser.close();
const ok = summary(errors);
process.exit(ok ? 0 : 1);
