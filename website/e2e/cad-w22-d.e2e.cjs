// E2E vlna 22 – balík D, etapa D1 (body 22g a 19): kusovník v aplikaci BEZ WebGL (majitel testoval bez WebGL) i s ním.
//  - 22g: číslo a materiál zadané v záložce dílu AŽ PO vložení → panel komponenty ukáže „Kopie je starší než díl“
//    (data-copy-stale), Kusovník upozornění (data-bom-note="stale"); tlačítko „Obnovit z dílu“ (data-refresh-btn) = týž
//    příkaz `sestava obnovit` – pak kusovník i CSV nesou DA-001 / 1.2379 a upozornění zmizí;
//  - 19: výběr „Druh v kusovníku“ (data-supply-select) → nakupovaný; Katalogové číslo; Kusovník v oddílech
//    (data-bom-section make/standard/buy), normálie s třídou 12.9 a kolík s m6; text v konzoli dává totéž.
// Spuštění (fáze 2): bin/e2e-run <worktree>/website 3534 <out> cad-w22-d   (E2E_BASE nastaví e2e-run)
const { chromium } = require('playwright');
const ok = (c, m) => { console.log((c ? 'ok: ' : 'FAIL: ') + m); if (!c) process.exitCode = 1; };
const BASE = (process.env.E2E_BASE || 'http://localhost:3534').replace(/\/$/, '');
const CAD = BASE + '/cad';
const NO_GL = ['--disable-3d-apis', '--disable-webgl', '--disable-webgl2', '--disable-gpu'];
const line = (log, re) => (log.split('\n').find((l) => re.test(l)) || '').trim();

async function scenario(args, label) {
  const b = await chromium.launch({ args });
  const ctx = await b.newContext({ viewport: { width: 1500, height: 900 }, acceptDownloads: true });
  const p = await ctx.newPage();
  const errs = [];
  p.on('pageerror', (e) => errs.push(e.message));
  p.on('dialog', (d) => d.dismiss().catch(() => {}));
  await p.goto(CAD, { waitUntil: 'networkidle', timeout: 300000 });
  const c0 = p.getByText('Pokračovat v práci');
  if (await c0.isVisible({ timeout: 6000 }).catch(() => false)) await c0.click();
  await p.waitForFunction(() => !document.body.innerText.includes('Načítám jádro') && !document.body.innerText.includes('Načítám CAD jádro'), null, { timeout: 240000 });
  await p.waitForTimeout(1500);

  const input = p.getByLabel('Textové příkazy nebo JSON');
  const openConsole = async () => {
    await p.evaluate(() => document.activeElement && document.activeElement.blur && document.activeElement.blur());
    for (let k = 0; k < 6 && !(await input.isVisible().catch(() => false)); k++) {
      await p.keyboard.press('Control+Shift+K');
      await input.waitFor({ timeout: 15000 }).catch(() => {});
    }
    await input.waitFor({ timeout: 10000 });
  };
  const closeConsole = async () => {
    await p.getByRole('button', { name: 'Zavřít', exact: true }).last().click().catch(() => {});
    await input.waitFor({ state: 'hidden', timeout: 20000 }).catch(() => {});
  };
  const out = p.locator('[data-agent-output]');
  const run = async (text, ms = 300000) => {
    const before = await out.innerText().catch(() => '');
    await input.fill(text);
    await p.getByRole('button', { name: 'Provést', exact: true }).click();
    await p.waitForFunction((prev) => { const o = document.querySelector('[data-agent-output]'); const busy = [...document.querySelectorAll('button')].some((x) => x.textContent === 'Provádím…'); return !busy && !!o && o.textContent !== prev; }, before, { timeout: ms });
    return out.innerText();
  };
  const treeRow = (name) => p.locator('div.group.ml-3').filter({ has: p.locator('span', { hasText: new RegExp(`^${name}$`) }) }).first();
  const closeModal = async () => {
    const overlay = p.locator('div.fixed.inset-0.z-\\[70\\]');
    for (let k = 0; k < 3 && (await overlay.count()) > 0; k++) {
      await p.keyboard.press('Escape');
      await p.waitForTimeout(400);
    }
  };

  // ── 22g: metadata dílu po vložení ──
  await openConsole();
  let log = await run('nový díl "Deska A"\nkvádr 100 60 20\nnový díl "Přidržovač"\nkvádr 40 30 10\nnová sestava "Nástroj"\nvložit "Deska A" ukotvit\nvložit "Přidržovač" v 10 10 20');
  ok(/vložena do sestavy/.test(log), `${label}: sestava se dvěma komponentami`);
  log = await run('záložka "Deska A"\nmateriál 1.2379\nvýkres razítko číslo="DA-001"\nzáložka "Nástroj"\nkusovník');
  ok(/asm\.stale-copy|starší než díl/.test(log), `${label}: kusovník hlásí kopii starší než díl – ` + line(log, /starší než díl/));
  ok(/Deska A \|  \| 1 \| — \(třída Ocel\)/.test(log), `${label}: kopie z vložení je v kusovníku označená (— (třída Ocel)), ne tiché „Ocel“`);
  await closeConsole();

  // panel komponenty: odznak + Obnovit z dílu
  await treeRow('Deska A').click();
  const stale = p.locator('[data-copy-stale]');
  await stale.waitFor({ timeout: 20000 }).catch(() => {});
  ok((await stale.count()) === 1 && /číslo|materiál/.test((await stale.getAttribute('data-copy-stale')) || ''), `${label}: panel „Kopie je starší než díl“ – ` + ((await stale.getAttribute('data-copy-stale').catch(() => '')) || '–'));
  // Kusovník: upozornění se stejným textem
  await p.locator('button', { hasText: /^Kusovník/ }).first().click().catch(() => {});
  await p.waitForTimeout(1200);
  ok((await p.locator('[data-bom-note="stale"]').count()) >= 1, `${label}: okno Kusovník – upozornění na zastaralou kopii`);
  await closeModal();
  await p.locator('[data-refresh-btn="all"]').first().click();
  await p.waitForTimeout(2500);
  ok((await p.locator('[data-copy-stale]').count()) === 0, `${label}: po „Obnovit z dílu“ odznak zmizel`);
  await openConsole();
  log = await run('kusovník csv');
  ok(/Deska A \| DA-001 \| 1 \| 1\.2379/.test(log), `${label}: po obnově kusovník DA-001 / 1.2379 – ` + line(log, /Deska A \|/));
  ok(/\n1;Deska A;DA-001;1;1\.2379;/.test(log) || /1;Deska A;DA-001;1;1\.2379;/.test(log), `${label}: CSV DA-001 / 1.2379`);
  ok(!/asm\.stale-copy/.test(log), `${label}: po obnově bez ⚠ asm.stale-copy`);
  await closeConsole();

  // ── 19: druh v panelu + oddíly ──
  await treeRow('Přidržovač').click();
  const sel = p.locator('[data-supply-select]').first();
  await sel.waitFor({ timeout: 20000 });
  await sel.selectOption('buy');
  await p.waitForTimeout(800);
  const cat = p.locator('[data-supply-field="catalog"]').first();
  await cat.fill('PR-77');
  await cat.press('Enter');
  await p.waitForTimeout(800);
  ok((await p.locator('[data-supply-kind="buy"]').count()) >= 1, `${label}: druh komponenty v panelu = nakupovaný`);
  await openConsole();
  log = await run('normálie M12x40 v 50 30 20\nnormálie kolík 8x30 v 80 10 20\nkusovník');
  ok(/— Vyráběné díly —/.test(log) && /— Normálie —/.test(log) && /— Nakupované díly —/.test(log), `${label}: kusovník v oddílech`);
  ok(/ISO 4762 – M12×40 – 12\.9 \| 1 \| 12\.9/.test(log), `${label}: normálie – materiál = pevnostní třída 12.9`);
  ok(/ISO 8734 – 8×30 – m6/.test(log), `${label}: kolík si drží toleranci m6`);
  ok(/Přidržovač \| PR-77 \| 1/.test(log), `${label}: nakupovaný díl s katalogovým číslem z panelu`);
  await closeConsole();
  await p.locator('button', { hasText: /^Kusovník/ }).first().click().catch(() => {});
  await p.waitForTimeout(1200);
  const sections = await p.locator('[data-bom-section]').evaluateAll((els) => els.map((e) => e.getAttribute('data-bom-section')));
  ok(JSON.stringify(sections) === JSON.stringify(['make', 'standard', 'buy']), `${label}: okno Kusovník – oddíly ${JSON.stringify(sections)}`);
  await closeModal();

  ok(errs.length === 0, `${label}: bez chyb stránky ${errs.slice(0, 2).join(' | ')}`);
  await b.close();
}

(async () => {
  await scenario(NO_GL, 'bez WebGL');
  await scenario([], 'WebGL');
})().catch((e) => {
  console.log('FAIL: ' + (e && e.stack ? e.stack : e));
  process.exitCode = 1;
});
