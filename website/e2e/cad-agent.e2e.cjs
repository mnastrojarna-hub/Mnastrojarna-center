// E2E: CAD ovládaný výhradně textem jako AI agent – konzole Textové příkazy (Ctrl+Shift+K), příkazy česky/anglicky,
// pravidla pro hrany/plochy, chyby s důvodem, stav dokumentu jako text, JSON dokument, window.mncad API, paleta.
// Lidské UI zůstává stejné (ověřují ostatní sady). Spuštění (server na :3100): node e2e/cad-agent.e2e.cjs <složka>
const { chromium } = require('playwright');
const fs = require('fs');
const S = (process.argv[2] || '/tmp/e2e').replace(/\/?$/, '/');
fs.mkdirSync(S, { recursive: true });
const ok = (c, m) => { console.log((c ? 'ok: ' : 'FAIL: ') + m); if (!c) process.exitCode = 1; };
const CAD = 'http://localhost:3100/cad';
const coreReady = (page) => page.waitForFunction(() => document.body.innerText.includes('OCCT') && !document.body.innerText.includes('Načítám jádro'), null, { timeout: 120000 });

(async () => {
  const b = await chromium.launch({ args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader'] });
  const ctx = await b.newContext({ viewport: { width: 1400, height: 850 } });
  await ctx.grantPermissions(['clipboard-read', 'clipboard-write']);
  const p = await ctx.newPage();
  const errs = []; p.on('pageerror', (e) => errs.push(e.message));
  await p.goto(CAD, { waitUntil: 'networkidle', timeout: 180000 });
  const c = p.getByText('Pokračovat v práci');
  if (await c.isVisible({ timeout: 6000 }).catch(() => false)) await c.click();
  await coreReady(p); await p.waitForTimeout(800);

  // ── otevření konzole klávesou, přes Nápovědu ──
  await p.keyboard.press('Control+Shift+K'); await p.waitForTimeout(500);
  const dlg = p.locator('div.fixed.z-\\[70\\]');
  const input = dlg.getByLabel('Textové příkazy nebo JSON');
  ok(await input.isVisible(), 'Ctrl+Shift+K otevře konzoli Textové příkazy');
  await dlg.getByRole('button', { name: 'Zavřít', exact: true }).last().click(); await p.waitForTimeout(300);
  await p.getByRole('button', { name: 'Nápověda' }).click(); await p.waitForTimeout(300);
  await p.getByRole('button', { name: /Textové příkazy – pro AI agenty/ }).click(); await p.waitForTimeout(400);
  ok(await input.isVisible(), 'Nápověda → Textové příkazy otevře konzoli');

  // ── příruba čistě textem ──
  const out = dlg.locator('[data-agent-output]');
  const run = async (text) => {
    const clear = dlg.getByRole('button', { name: 'Vymazat', exact: true });
    if (await clear.isEnabled().catch(() => false)) await clear.click(); // jinak by se četl předchozí protokol
    await input.fill(text); await input.press('Control+Enter');
    await p.waitForFunction(() => { const o = document.querySelector('[data-agent-output]'); return !!o && /Dokument:/.test(o.textContent || ''); }, null, { timeout: 90000 });
    await p.waitForTimeout(300);
    return out.innerText();
  };
  let log = await run(`nový díl Příruba DN50
materiál nerez
skica XY: kružnice 165
vysunout 18
trubka 88 61 30 v 0 0 18
díra 18 skrz v 62,5 0
pole kruhové 4
srazit 1,5
stav`);
  ok(/✓ nový díl „Příruba DN50“/.test(log), 'protokol: nový díl');
  const bad = (l) => l.split('\n').filter((x) => x.startsWith('✗'));
  ok(bad(log).length === 0, 'příruba: žádný řádek se nezdařil' + (bad(log).length ? '\n' + bad(log).join('\n') : ''));
  ok(/Rozměry: 165 × 165 × 48 mm/.test(log), 'stav: rozměry 165 × 165 × 48 mm (díra bez z šla na horní plochu, pole 4×)');
  ok(/objem 4\d\d,\d+ cm³/.test(log), 'stav: objem (' + (log.match(/objem [^·]+/) || [''])[0] + ')');
  ok(/Díra 1 \[hole/.test(log) && /Ø18 skrz v \[62,5; 0; 18\]/.test(log), 'stav: díra bez z umístěná na povrch tělesa v daném místě (příruba z=18, ne náboj z=48)');
  ok(/materiál Nerez \(7\.95 g\/cm³\)/.test(log), 'stav: materiál Nerez (třída s hustotou)');
  await p.screenshot({ path: S + 'agent-console.png' });
  await dlg.getByRole('button', { name: 'Zavřít', exact: true }).last().click(); await p.waitForTimeout(500);
  ok(/Díra 1/.test(await p.locator('aside').first().innerText()) && (await p.locator('[role=tab][aria-selected="true"] input').inputValue()) === 'Příruba DN50', 'díl je otevřený v nové záložce s historií prvků (člověk vidí totéž co vždy)');

  // ── pravidla hran/ploch, chyby s důvodem, undo ──
  await p.keyboard.press('Control+Shift+K'); await p.waitForTimeout(400);
  log = await run(`nový díl Deska
kvádr 100 60 20
zaoblit 3 hrany svislé
díra 8,5 skrz v 20 30 zahloubení 15 5
srazit 1 hrany horní kruhové
blabla 5
stav`);
  ok(/✓ Zaoblení 1 \(fillet\) – 4 hran podle pravidla „svisle“/.test(log), 'zaoblit hrany svislé → 4 svislé hrany kvádru' + (/4 hran podle pravidla „svisle“/.test(log) ? '' : '\n' + bad(log).join('\n') + '\n' + (log.match(/Zaoblení 1[^\n]*/) || [''])[0]));
  ok(/✓ Sražení 1 \(chamfer\) – \d+ hran podle pravidla „horni kruhove“/.test(log), 'srazit hrany horní kruhové → kruhové hrany zahloubení nahoře');
  ok(/✗ řádek 6: neznámý příkaz „blabla“/.test(log), 'neznámý příkaz: chyba s číslem řádku a nápovědou');
  ok(/Rozměry: 100 × 60 × 20 mm/.test(log) && bad(log).length === 1, 'deska 100 × 60 × 20 postavena, jediná chyba je neznámý příkaz');
  log = await run(`nový díl Krabička
kvádr 60 40 30
skořepina 2 otevřít +Z
stav`);
  ok(/✓ Skořepina 1 \(shell\) – otevřeno ploch: 1/.test(log) && /\(2 ✓, 0 ✗\)/.test(log), 'skořepina otevřít +Z → 1 plocha, stavba v pořádku' + (bad(log).length ? '\n' + bad(log).join('\n') : ''));
  log = await run(`smazat poslední
stav`);
  ok(/✓ odstraněn prvek „Skořepina 1“/.test(log) && !/Skořepina 1 \[shell/.test(log), 'smazat poslední odebere skořepinu');
  log = await run(`zaoblit 2 hrany modré`);
  ok(/✗ řádek 1: neznámé pravidlo pro hrany „modr[eé]“/.test(log), 'neznámé pravidlo hran: srozumitelná chyba' + '\n' + bad(log).join('\n'));
  log = await run(`zaoblit 500`);
  ok(bad(log).length > 0 && /Zaoblení/.test(bad(log).join(' ')), 'chyba jádra (zaoblení R500 na 60 mm krabičce) je v protokolu s důvodem: ' + bad(log).join(' | '));
  log = await run(`smazat poslední`);
  ok(/✓ odstraněn prvek „Zaoblení/.test(log), 'chybný prvek lze odstranit příkazem smazat poslední');

  // ── JSON dokument + anglické příkazy + palette ──
  log = await run(JSON.stringify({ app: 'mnastrojarna-cad', version: 2, name: 'Z JSON', material: 'hlinik', features: [{ type: 'sketch', plane: { kind: 'base', name: 'XY', offset: 0 }, entities: [{ type: 'rect', cx: 25, cy: 15, w: 50, h: 30, r: 0, angle: 0 }] }, { type: 'extrude', sketchId: '$last', distance: 10, symmetric: false, reverse: false, mode: 'new' }, { type: 'fillet', radius: 2 }] }));
  ok(/✓ dokument „Z JSON“ \(3 prvků\)/.test(log) && /Rozměry: 50 × 30 × 10 mm/.test(log), 'JSON dokument: otevřen v nové záložce, \\$last a výchozí pole doplněny');
  log = await run(`cylinder 12 30 axis Z at 25 15 0 cut
status`);
  ok(/✓ Válec 1 \(cylinder\)/.test(log) && /Z -?0…10/.test(log) && /objem 1[0-4],\d+ cm³/.test(log), 'anglický příkaz cut: válec odečten od desky (objem klesl pod 15 cm³)' + '\n' + (log.match(/Rozměry[^\n]*/) || [''])[0]);
  await dlg.getByRole('button', { name: 'Kopírovat návod pro AI' }).click(); await p.waitForTimeout(400);
  const guide = await p.evaluate(() => navigator.clipboard.readText()).catch(() => '');
  ok(/# Mnástrojárna CAD – rozhraní pro AI agenty/.test(guide) && /window\.mncad/.test(guide), 'Kopírovat návod pro AI → návod ve schránce');
  await dlg.getByRole('button', { name: 'Kopírovat dokument (JSON)' }).click(); await p.waitForTimeout(400);
  const json = await p.evaluate(() => navigator.clipboard.readText()).catch(() => '');
  ok(/"app": "mnastrojarna-cad"/.test(json) && /"cylinder"/.test(json), 'Kopírovat dokument (JSON) → platný .mncad ve schránce');
  await dlg.getByRole('button', { name: 'Zavřít', exact: true }).last().click(); await p.waitForTimeout(300);

  // ── window.mncad API ──
  const api = await p.evaluate(async () => {
    const m = window.mncad;
    if (!m) return { ok: false };
    const log = await m.run('box 30 30 30 name Kostka\nfillet 5');
    const doc = m.getDocument();
    const st = await m.status();
    return { ok: true, version: m.version, cmds: m.commands().length, guide: m.guide().length, log, docName: doc.name, n: doc.features.length, st };
  });
  ok(api.ok && api.version === 1 && api.cmds > 15 && api.guide > 1000, 'window.mncad: version, commands, guide');
  ok(/✓ Kostka \(box\)/.test(api.log) && /✓ Zaoblení \d+ \(fillet\)/.test(api.log), 'window.mncad.run provede příkazy a vrátí protokol');
  ok(api.n >= 5 && /Prvky:/.test(api.st), 'window.mncad.getDocument / status');
  const setLog = await p.evaluate(() => window.mncad.setDocument({ app: 'mnastrojarna-cad', version: 2, name: 'API díl', material: 'ocel', features: [{ type: 'sphere', radius: 10 }] }));
  ok(/✓ dokument „API díl“/.test(setLog) && /Rozměry: 20 × 20 × 20 mm/.test(setLog), 'window.mncad.setDocument otevře dokument z objektu');

  // ── paleta: platný příkaz nabídne Provést ──
  await p.keyboard.press('Control+K'); await p.waitForTimeout(400);
  await p.keyboard.type('kvádr 40 20 10 v 0 0 20'); await p.waitForTimeout(400);
  const runItem = p.getByRole('button', { name: /Provést příkaz: kvádr 40 20 10/ }).first();
  ok(await runItem.isVisible().catch(() => false), 'paleta Ctrl+K nabízí „Provést příkaz“ pro platný textový příkaz');
  await runItem.click(); await p.waitForTimeout(2500);
  ok(/Kvádr/.test(await p.locator('aside').first().innerText()), 'příkaz z palety přidal kvádr do historie');

  // ── mobil: konzole použitelná ──
  const m = await b.newPage({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  await m.goto(CAD, { waitUntil: 'networkidle', timeout: 180000 });
  const start = m.locator('div.fixed.z-\\[65\\]');
  if (await start.isVisible({ timeout: 6000 }).catch(() => false)) { await start.getByRole('button', { name: /Textové příkazy \(AI\)/ }).click(); } else { await m.waitForFunction(() => !document.body.innerText.includes('Načítám jádro'), null, { timeout: 120000 }); await m.evaluate(() => window.mncad && window.mncad.openConsole()); }
  await m.waitForTimeout(600);
  ok(await m.getByLabel('Textové příkazy nebo JSON').isVisible(), 'mobil: konzole z úvodní obrazovky / API');
  await m.screenshot({ path: S + 'agent-mobile.png' });

  ok(errs.length === 0, 'bez JS chyb ' + errs.join(' | '));
  await b.close();
})().catch((e) => { console.error('ERR', e.message); process.exit(1); });
