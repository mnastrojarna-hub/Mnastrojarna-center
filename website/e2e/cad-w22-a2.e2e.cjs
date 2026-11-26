// E2E (vlna 22, balík A, etapa A2 – bod 20 zprávy majitele, část vazby, a 22i pro `sestava hotovo`) na produkčním sestavení:
// ztracená reference vazby se po změně dílu v kontextu sestavy HLÁSÍ a nikdy se tiše nepřipojí na jinou plochu.
//  1) sestava „Sestava A“: Deska A se schodem, Přidržovač na schodu (vazba Kontakt F5 → F3), Kolize ok
//  2) GUI: strom → pravým na „Deska A“ → Upravit díl (v kontextu) → smazat schod (Kvádr 2) → tlačítko „← Zpět do sestavy“
//     (dřív bez jakékoli kontroly – vazba se pak tiše přichytila na boční plochu −Y a Přidržovač se otočil o 90°)
//  3) očekáváno: seznam vazeb data-mates-lost=1, vazba data-mate-status="lost" (červeně „ztracená reference“, nikdy zelená),
//     Přidržovač stojí [5; 10; 5] bez natočení, oznámení „POZOR: ztracené reference vazeb: 1“ (bez ✓), panel Kolize „neplatí“,
//     textový stav „Vazby: 1 (1 ztracená reference)“ a `mates=0/1(lost=1)` – stejné jako `sestava hotovo` textem
//  4) oprava v GUI: „Vybrat plochu znovu“ → výběr ze seznamu ploch (data-repick-face, funguje i bez WebGL) → vazba ok, Přidržovač
//     dosedne na horní plochu (Z = 10); krok zpět → zase ztracená; „Smazat vazbu“ → vazba pryč
//  5) totéž bez WebGL (majitel testoval bez WebGL) a anglické rozhraní (texty „lost reference“)
// Spuštění: E2E_BASE=http://localhost:3531 node e2e/cad-w22-a2.e2e.cjs <složka pro výstupy>
const { chromium } = require('playwright');
const fs = require('fs');
const S = (process.argv[2] || '/tmp/e2e-w22-a2').replace(/\/?$/, '/');
fs.mkdirSync(S, { recursive: true });
const ok = (c, m) => { console.log((c ? 'ok: ' : 'FAIL: ') + m); if (!c) process.exitCode = 1; };
const BASE = (process.env.E2E_BASE || 'http://localhost:3531').replace(/\/$/, '');

const SETUP = [
  'nový díl "Deska A"', 'kvádr 60 40 10', 'kvádr 20 40 5 v 0 0 5 odebrat',
  'nový díl "Přidržovač"', 'kvádr 10 10 10',
  'nová sestava "Sestava A"', 'vložit "Deska A" ukotvit', 'vložit "Přidržovač" v 5 10 30',
  'sestava vazba kontakt "Přidržovač" spodní "Deska A" F3',
].join('\n');

const start = async (p, url) => {
  await p.goto(url, { waitUntil: 'networkidle', timeout: 300000 });
  const c = p.getByText(/Pokračovat v práci|Continue working/);
  if (await c.isVisible({ timeout: 6000 }).catch(() => false)) await c.click();
  await p.waitForFunction(() => !!window.mncad && !document.body.innerText.includes('Načítám jádro') && !document.body.innerText.includes('Načítám CAD jádro'), null, { timeout: 240000 });
  await p.waitForTimeout(1200);
};

/** jeden průchod 1–4 – s WebGL, bez WebGL i v angličtině (`en` = texty rozhraní) */
async function flow(p, tag, en = false) {
  const run = (t, o) => p.evaluate(([t, o]) => window.mncad.run(t, o), [t, o]);
  const idle = () => p.waitForFunction(() => !window.mncad.progress(), null, { timeout: 120000 });
  const holder = () => p.evaluate(() => window.mncad.getDocument().components.find((c) => c.name === 'Přidržovač').placement);
  const mates = () => p.evaluate(() => ({ lost: document.querySelector('[data-mates-list]')?.getAttribute('data-mates-lost'), st: [...document.querySelectorAll('[data-mate]')].map((m) => m.getAttribute('data-mate-status')), side: document.querySelector('[data-mate]')?.getAttribute('data-mate-lost'), text: document.querySelector('[data-mates-list]')?.innerText || '' }));
  const waitMate = (want) => p.waitForFunction((w) => document.querySelector('[data-mate]')?.getAttribute('data-mate-status') === w, want, { timeout: 60000 }).then(() => true, () => false);
  const clashState = () => p.evaluate(() => document.querySelector('[data-clash-panel]')?.getAttribute('data-clash-state'));
  const treeRow = (name) => p.locator('aside div.group').filter({ has: p.locator('span', { hasText: new RegExp(`^${name}$`) }) }).first();

  const log = await run(SETUP);
  // fáze 2: Přidržovač stojí NA schodu (x 5–15 nad odebraným pásem x 0–20) – dřív x = 40 nad plnou deskou = skutečný průnik 500 mm³
  const mateOk = en ? /✓ mate Contact „Přidržovač“ F5 → „Deska A“ F3: ok/ : /✓ vazba Kontakt „Přidržovač“ F5 → „Deska A“ F3: ok/;
  ok(mateOk.test(log) && !/^✗/m.test(log), `[${tag}] sestava s vazbou Kontakt na schod F3 založena textem`);
  await idle();
  ok(await waitMate('ok'), `[${tag}] vazba v seznamu vazeb splněna`);
  const pos0 = await holder();
  ok(JSON.stringify(pos0.position) === '[5,10,5]', `[${tag}] Přidržovač na schodu [5; 10; 5] (${JSON.stringify(pos0.position)})`);
  await run('kolize');
  await idle();
  const c0 = await p.waitForFunction(() => document.querySelector('[data-clash-panel]')?.getAttribute('data-clash-state'), null, { timeout: 60000 }).then((h) => h.jsonValue(), () => null);
  ok(c0 === 'ok', `[${tag}] kontrola kolizí před úpravou: ok (${c0})`);

  // ── 2. GUI: úprava dílu v kontextu sestavy, smazání schodu, „← Zpět do sestavy“ ──
  await treeRow('Deska A').click({ button: 'right' });
  await p.waitForTimeout(400);
  await p.getByText(en ? /Edit part \(in context\)/ : /Upravit díl \(v kontextu\)/).first().click();
  await p.locator('[data-back-to-asm]').waitFor({ timeout: 30000 });
  ok(true, `[${tag}] úprava „Deska A“ v kontextu sestavy (pruh s tlačítkem Zpět do sestavy)`);
  const del = await run(en ? 'smazat "Box 2"' : 'smazat "Kvádr 2"');
  ok(!/^✗/m.test(del), `[${tag}] schod smazán v kontextu sestavy\n   ${del.split('\n')[0]}`);
  await idle();
  await p.locator('[data-back-to-asm]').click();
  const lostOk = await p.waitForFunction(() => document.querySelector('[data-mates-list]')?.getAttribute('data-mates-lost') === '1', null, { timeout: 60000 }).then(() => true, () => false);
  ok(lostOk, `[${tag}] po „Zpět do sestavy“: seznam vazeb data-mates-lost=1`);
  const m1 = await mates();
  ok(m1.st.length === 1 && m1.st[0] === 'lost' && m1.side === 'b', `[${tag}] vazba data-mate-status="lost", ztracená strana B (stav ${JSON.stringify(m1.st)}, strana ${m1.side})`);
  ok((await p.locator('[data-mate-status="ok"]').count()) === 0, `[${tag}] žádná zelená „splněno“ u ztracené vazby`);
  ok(en ? /lost reference/i.test(m1.text) : /ztracená reference/.test(m1.text), `[${tag}] text seznamu vazeb hlásí ztracenou referenci\n   ${m1.text.replace(/\n/g, ' | ').slice(0, 300)}`);
  const pos1 = await holder();
  ok(JSON.stringify(pos1.position) === '[5,10,5]' && pos1.rotation.every((x) => Math.abs(x) < 1e-9), `[${tag}] Přidržovač se nepohnul ani nenatočil (${JSON.stringify(pos1)}) – dřív přichycen na boční plochu −Y a natočen o 90°`);
  const body = await p.evaluate(() => document.body.innerText);
  ok(en ? /WARNING: lost mate references: 1/.test(body) : /POZOR: ztracené reference vazeb: 1/.test(body), `[${tag}] oznámení po návratu hlásí ztracenou referenci (bez ✓)`);
  ok(!/vazby 1\/1 ok|mates 1\/1 ok/.test(body), `[${tag}] nikde „vazby 1/1 ok“`);
  ok(await p.waitForFunction(() => document.querySelector('[data-clash-panel]')?.getAttribute('data-clash-state') === 'stale', null, { timeout: 30000 }).then(() => true, () => false), `[${tag}] panel Kolize po změně dílu „neplatí“ (${await clashState()})`);
  const st = await run('stav', { protocol: 'short' });
  ok(/mates=0\/1\(lost=1\)/.test(st), `[${tag}] textový stav mates=0/1(lost=1)\n   ${(st.split('\n').find((l) => / status /.test(l)) || '').slice(0, 200)}`);
  const full = await p.evaluate(() => window.mncad.status());
  ok(en ? /Mates: 1 \(1 lost reference\)/.test(full) : /Vazby: 1 \(1 ztracená reference\)/.test(full), `[${tag}] stav dokumentu: vazba se ztracenou referencí`);
  await p.screenshot({ path: `${S}w22a2-${tag}-1-lost.png` });

  // ── 4. oprava: Vybrat plochu znovu → seznam ploch (bez klikání do 3D) ──
  await p.locator('[data-mate-repick]').first().click();
  await p.locator('[data-repick-panel]').waitFor({ timeout: 15000 });
  await p.waitForFunction(() => (document.querySelector('[data-repick-face]')?.options.length ?? 0) > 1, null, { timeout: 30000 });
  const opts = await p.evaluate(() => [...document.querySelector('[data-repick-face]').options].map((o) => ({ v: o.value, t: o.textContent })));
  const top = opts.find((o) => /^F6\b/.test(o.t || '') || /\|5$/.test(o.v));
  ok(!!top, `[${tag}] seznam ploch komponenty Deska A nabízí horní plochu F6 (${opts.map((o) => o.t).join(', ').slice(0, 200)})`);
  if (top) await p.locator('[data-repick-face]').selectOption(top.v);
  ok(await waitMate('ok'), `[${tag}] po výběru F6 vazba zase splněna`);
  const pos2 = await holder();
  ok(JSON.stringify(pos2.position) === '[5,10,10]', `[${tag}] Přidržovač dosedl na horní plochu Z = 10 (${JSON.stringify(pos2.position)})`);
  ok((await mates()).lost === '0', `[${tag}] data-mates-lost=0 po opravě`);
  // krok zpět → vazba zase ztracená; Smazat vazbu → vazba pryč
  await p.evaluate(() => window.mncad.undo(1));
  ok(await waitMate('lost'), `[${tag}] krok zpět: vazba zase ztracená (žádná zelená z opraveného stavu)`);
  await p.locator('[data-mate-delete]').first().click();
  ok(await p.waitForFunction(() => !document.querySelector('[data-mate]'), null, { timeout: 30000 }).then(() => true, () => false), `[${tag}] „Smazat vazbu“ ztracenou vazbu odstranila`);
  await p.screenshot({ path: `${S}w22a2-${tag}-2-fixed.png` });
}

/**
 * Fáze 2, kolo 4 (bod 20): ztracená HRANA vazby – oprava v GUI jedním tlačítkem, ne jen textem. Dřív seznam vazeb nabízel
 * „Vybrat plochu znovu“ jen pro plochy; u hrany zbylo „Smazat vazbu“ a příkaz `sestava vazba 1 plocha b E2`.
 * Vazba Shodně „Přidržovač B“ V1 → „Deska B“ E11 (vnitřní hrana schodu) → schod smazán → ztracená hrana → „Vybrat hranu znovu“ →
 * seznam hran dílu (data-repick-ent, i bez WebGL) → E2 → vazba zase ok, odkaz B = E2 (hrana), bez ztráty.
 */
async function edgeFlow(p, tag) {
  const run = (t, o) => p.evaluate(([t, o]) => window.mncad.run(t, o), [t, o]);
  const idle = () => p.waitForFunction(() => !window.mncad.progress(), null, { timeout: 120000 });
  const log = await run([
    'nový díl "Deska B"', 'kvádr 60 40 10', 'kvádr 20 40 5 v 0 0 5 odebrat',
    'nový díl "Přidržovač B"', 'kvádr 10 10 10',
    'nová sestava "Sestava B"', 'vložit "Deska B" ukotvit', 'vložit "Přidržovač B" v 5 10 30',
    'sestava vazba shodně "Přidržovač B" V1 "Deska B" E11',
  ].join('\n'));
  ok(/✓ vazba Shodně „Přidržovač B“ V1 → „Deska B“ E11: ok/.test(log), `[${tag}] hrana: vazba Shodně V1 → E11 (hrana schodu) založena`);
  const edit = await run(['sestava upravit "Deska B"', 'smazat "Kvádr 2"', 'sestava hotovo'].join('\n'));
  ok(/ztracená reference B E11[^\n]*vyberte hranu znovu/.test(edit), `[${tag}] hrana: po smazání schodu ✗ ztracená hrana E11 s radou „vyberte hranu znovu“\n   ${(edit.split('\n').find((l) => /E11/.test(l) && /^✗/.test(l)) || '').slice(0, 260)}`);
  await idle();
  const lostOk = await p.waitForFunction(() => document.querySelector('[data-mates-list]')?.getAttribute('data-mates-lost') === '1', null, { timeout: 60000 }).then(() => true, () => false);
  const btn = p.locator('[data-mate-repick-ent="edge"]').first();
  const label = lostOk ? ((await btn.textContent().catch(() => '')) || '').trim() : '';
  ok(lostOk && label === 'Vybrat hranu znovu', `[${tag}] hrana: seznam vazeb nabízí jedním klikem „Vybrat hranu znovu“ (tlačítko: „${label}“)`);
  if (!lostOk) return;
  await btn.click();
  await p.locator('[data-repick-panel]').waitFor({ timeout: 15000 });
  await p.waitForFunction(() => (document.querySelector('[data-repick-ent="edge"]')?.options.length ?? 0) > 1, null, { timeout: 60000 });
  const opts = await p.evaluate(() => [...document.querySelector('[data-repick-ent="edge"]').options].map((o) => ({ v: o.value, t: o.textContent })));
  const e2 = opts.find((o) => /^E2 · hrana – úsečka · \[0; 0; 10\]–\[0; 40; 10\]/.test(o.t || ''));
  ok(!!e2 && !opts.some((o) => /\[20; 0; 5\]/.test(o.t || '')), `[${tag}] hrana: seznam hran dílu nabízí E2 [0; 0; 10]–[0; 40; 10] a nenabízí zmizelou hranu schodu (${opts.length - 1} hran: ${opts.slice(1, 4).map((o) => o.t).join(' | ')})`);
  if (!e2) return;
  await p.locator('[data-repick-ent="edge"]').selectOption(e2.v);
  const okNow = await p.waitForFunction(() => document.querySelector('[data-mate]')?.getAttribute('data-mate-status') === 'ok', null, { timeout: 60000 }).then(() => true, () => false);
  const ref = await p.evaluate(() => window.mncad.getDocument().mates[0].b);
  ok(okNow && ref.ent === 'edge' && ref.face === 1 && !ref.lost, `[${tag}] hrana: po výběru E2 vazba zase splněna, odkaz B = hrana E2 bez ztráty (${JSON.stringify(ref).slice(0, 160)})`);
  const list = await run('sestava vazby');
  ok(/Vazby sestavy „Sestava B“: 1 \(1 ok\)/.test(list), `[${tag}] hrana: text sestava vazby = 1 ok (GUI = text)`);
  await p.screenshot({ path: `${S}w22a2-${tag}-3-edge.png` });
}

const browsers = [];
(async () => {
  const b = await chromium.launch({ args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader'] });
  browsers.push(b);
  const ctx = await b.newContext({ viewport: { width: 1430, height: 880 } });
  const p = await ctx.newPage();
  const errs = [];
  p.on('pageerror', (e) => errs.push(e.message));
  p.on('dialog', (d) => d.dismiss().catch(() => {}));
  await start(p, BASE + '/cad');
  await flow(p, 'webgl');
  await edgeFlow(p, 'webgl');
  ok(errs.length === 0, 'žádná chyba stránky (WebGL): ' + errs.slice(0, 3).join(' | '));
  await ctx.close();

  // ── anglické rozhraní ──
  const ctxE = await b.newContext({ viewport: { width: 1430, height: 880 } });
  const pe = await ctxE.newPage();
  pe.on('dialog', (d) => d.dismiss().catch(() => {}));
  await start(pe, BASE + '/en/cad');
  await flow(pe, 'en', true);
  await ctxE.close();

  // ── bez WebGL (softwarový náhled) – majitel testoval bez WebGL ──
  const b2 = await chromium.launch({ args: ['--disable-gpu', '--disable-webgl', '--disable-webgl2', '--disable-3d-apis'] });
  browsers.push(b2);
  const ctx2 = await b2.newContext({ viewport: { width: 1430, height: 880 } });
  const p2 = await ctx2.newPage();
  const errs2 = [];
  p2.on('pageerror', (e) => errs2.push(e.message));
  p2.on('dialog', (d) => d.dismiss().catch(() => {}));
  await start(p2, BASE + '/cad');
  const noGl = await p2.evaluate(() => { try { const c = document.createElement('canvas'); return !(c.getContext('webgl2') || c.getContext('webgl')); } catch { return true; } });
  ok(noGl, 'druhý průchod běží bez WebGL (softwarový náhled)');
  await flow(p2, 'nowebgl');
  await edgeFlow(p2, 'nowebgl');
  ok(errs2.length === 0, 'žádná chyba stránky (bez WebGL): ' + errs2.slice(0, 3).join(' | '));
  await b2.close();
  await b.close();
})().catch(async (e) => {
  console.log('ERR ' + (e && e.stack ? e.stack : e));
  for (const x of browsers) await x.close().catch(() => {});
  process.exit(1);
});
