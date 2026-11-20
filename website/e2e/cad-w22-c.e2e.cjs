// E2E (vlna 22, balík C, etapa C1 – bod 5 zprávy majitele) na produkčním sestavení: třídy kolizí všude – panel Kolize,
// zvýraznění, panel pohybu, window.mncad.motion(), `stav`, pravidla pracovního kontaktu (text i tlačítko v panelu).
//  1) sestava se šrouby v závitu (S1, S3), hlavou S2 zapuštěnou do přidržovače a bokem hlavy S3 v plechu: tlačítko Kolize →
//     titulek „Kolize (5) · skutečné 2 · šroub v závitu 3“, přepínače tříd s počty, závady rozbalené, závity sbalené,
//     položka s instancí [S2] a místem [50; 30; 28,5]; zvýraznění jen listů se závadou (ne šroub S1, ne deska)
//  2) filtr: klik na „šroub v závitu“ ukáže skupiny závitu; klik na „skutečná kolize“ je skryje
//  3) opakované nálezy: 4 stejné nárazy = jedna skupina „4×“ (data-clash-n=4)
//  4) jádrová díra bez prvku závitu: „nevyhodnotitelné“ s nápovědou; tlačítko „Je to závit“ → pravidlo, třída šroub v závitu
//  5) pracovní kontakt: „Pracovní kontakt…“ → okno „při hodnotě motoru / vazby“ → Uložit → třída pracovní kontakt; pravidlo
//     v seznamu pravidel, × ho odebere (zpět skutečná kolize)
//  6) pohyb uvnitř podsestavy: panel pohybu bez „⚠ … Horní skupina × Horní skupina“, štítek kroku bez „· kolize“ (jen závit);
//     window.mncad.motion().collision = null; studie s dorazem: collision = první skutečná (krok 9, „Šroub M12 [S2]“)
//  7) `stav` / `kolize seznam`: třídy a instance stejně jako v panelu (text = GUI)
//  8) EN a DE: titulek a přepínače tříd přeložené
//  9) totéž (1–2) v náhledu bez WebGL (majitel testoval bez WebGL)
// Spuštění: E2E_BASE=http://localhost:3535 node e2e/cad-w22-c.e2e.cjs <složka pro výstupy>
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');
const S = (process.argv[2] || '/tmp/e2e-w22-c').replace(/\/?$/, '/');
fs.mkdirSync(S, { recursive: true });
const ok = (c, m) => { console.log((c ? 'ok: ' : 'FAIL: ') + m); if (!c) process.exitCode = 1; };
const BASE = (process.env.E2E_BASE || 'http://localhost:3535').replace(/\/$/, '');
const CORPUS = path.resolve(__dirname, '../src/cad/engine/__corpus__');
/** skript korpusu bez oddělovačů běhů (komentáře) – stejná repro jako engine a CLI */
const corpus = (n) => fs.readFileSync(path.join(CORPUS, n + '.txt'), 'utf8');

const start = async (p, url) => {
  await p.goto(url, { waitUntil: 'networkidle', timeout: 300000 });
  const c = p.getByText(/Pokračovat v práci|Continue working|Weiterarbeiten/);
  if (await c.isVisible({ timeout: 6000 }).catch(() => false)) await c.click();
  await p.waitForFunction(() => !!window.mncad && !document.body.innerText.includes('Načítám jádro') && !document.body.innerText.includes('Načítám CAD jádro'), null, { timeout: 240000 });
  await p.waitForTimeout(1200);
};

/** pomocníci nad stránkou */
const helpers = (p) => {
  const run = (t, o) => p.evaluate(([t, o]) => window.mncad.run(t, o), [t, o]);
  const status = () => p.evaluate(() => window.mncad.status());
  const idle = () => p.waitForFunction(() => !window.mncad.progress(), null, { timeout: 180000 });
  const panel = () =>
    p.evaluate(() => {
      const el = document.querySelector('[data-clash-panel]');
      if (!el) return null;
      const a = (k) => el.getAttribute(k);
      return {
        state: a('data-clash-state'),
        real: a('data-clash-real'),
        thread: a('data-clash-thread'),
        undetermined: a('data-clash-undetermined'),
        work: a('data-clash-work'),
        touch: a('data-clash-touch'),
        groups: a('data-clash-groups'),
        hl: (a('data-clash-hl') || '').split(' ').filter(Boolean),
        filters: [...el.querySelectorAll('[data-clash-filter]')].map((b) => ({ cls: b.getAttribute('data-clash-filter'), on: b.getAttribute('aria-pressed') === 'true', text: b.textContent })),
        shown: [...el.querySelectorAll('[data-clash-group]')].map((g) => ({ cls: g.getAttribute('data-clash-cls'), n: Number(g.getAttribute('data-clash-n')), text: g.innerText })),
        title: el.closest('[role=dialog], .fixed, div')?.parentElement?.innerText.split('\n')[0] || '',
        text: el.parentElement.parentElement.innerText,
      };
    });
  const waitState = (st) => p.waitForFunction((s) => document.querySelector('[data-clash-panel]')?.getAttribute('data-clash-state') === s, st, { timeout: 90000 }).then(() => true, () => false);
  const kolizeBtn = async () => {
    await p.getByRole('button', { name: /^(Sestava|Assembly|Baugruppe)$/ }).first().click().catch(() => {});
    await p.getByRole('button', { name: /^(Kolize|Interference|Kollisionen?)$/ }).first().click();
  };
  return { run, status, idle, panel, waitState, kolizeBtn };
};

/** 1–2: panel tříd, filtr, zvýraznění – s WebGL i bez něj */
async function classesFlow(p, tag) {
  const { run, status, idle, panel, waitState, kolizeBtn } = helpers(p);
  const log = await run(corpus('70-clash-classes').replace(/^(kolize|stav|kolize seznam.*)$/gm, ''));
  ok(!/^✗/m.test(log), `[${tag}] sestava 5 založena textem bez chyby`);
  await idle();
  await p.waitForTimeout(1500);
  await kolizeBtn();
  ok(await waitState('clash'), `[${tag}] tlačítko Kolize → panel ve stavu clash`);
  await p.waitForFunction(() => document.querySelector('[data-clash-panel]')?.getAttribute('data-clash-real') !== null, null, { timeout: 60000 }).catch(() => {});
  const a = await panel();
  ok(a && a.real === '2' && a.thread === '3', `[${tag}] počty tříd: skutečné 2, šroub v závitu 3 (${a && [a.real, a.thread].join('/')})`);
  ok(a && /Kolize \(5\) · skutečné 2 · šroub v závitu 3/.test(a.text) && !/Bez kolizí|✓/.test(a.text.split('\n')[0]), `[${tag}] titulek s třídami, žádné ✓\n   ${a && a.text.split('\n')[0]}`);
  ok(a && a.filters.some((f) => f.cls === 'real' && f.on) && a.filters.some((f) => f.cls === 'thread' && !f.on), `[${tag}] přepínače: skutečné zapnuté, závit vypnutý (${a && JSON.stringify(a.filters.map((f) => [f.cls, f.on]))})`);
  ok(a && a.shown.length === 2 && a.shown.every((g) => g.cls === 'real'), `[${tag}] zobrazené jen 2 skupiny skutečných kolizí (${a && a.shown.map((g) => g.cls).join(',')})`);
  ok(a && a.shown.some((g) => /Šroub M12 \[S2\]/.test(g.text) && /\[50; 30; 28,5\]/.test(g.text)), `[${tag}] položka s instancí [S2] a místem [50; 30; 28,5]\n   ${a && a.shown.map((g) => g.text.replace(/\n/g, ' ')).join(' | ')}`);
  // zvýraznění: listy se závadou (přidržovač, S2, plech, S3), ne deska ani S1 (jen v závitu)
  ok(a && a.hl.length === 4, `[${tag}] zvýrazněné 4 listy se závadou (${a && a.hl.length})`);
  const ids = await p.evaluate(() => {
    const d = window.mncad.getDocument();
    return Object.fromEntries((d.components || []).map((c) => [c.alias || c.name, c.id]));
  });
  ok(a && !a.hl.includes(ids['S1']) && !a.hl.includes(ids['Deska A']), `[${tag}] šroub S1 a deska (jen závit) nesvítí`);
  await p.screenshot({ path: `${S}w22c-${tag}-1-classes.png` });

  // 2. filtr: závit zapnout → přibudou skupiny závitu; skutečné vypnout → zmizí
  await p.locator('[data-clash-filter="thread"]').click();
  const b = await panel();
  ok(b && b.shown.some((g) => g.cls === 'thread'), `[${tag}] filtr „šroub v závitu“ ukáže skupiny závitu (${b && b.shown.map((g) => g.cls).join(',')})`);
  await p.locator('[data-clash-filter="real"]').click();
  const c = await panel();
  ok(c && c.shown.length > 0 && c.shown.every((g) => g.cls === 'thread'), `[${tag}] filtr bez „skutečné“: jen závit (${c && c.shown.map((g) => g.cls).join(',')})`);
  await p.locator('[data-clash-filter="real"]').click();
  // 7. text = GUI
  const st = await status();
  ok(/^Kolize: 5 – skutečné 2: Přidržovač × Šroub M12 \[S2\] \(365,2 mm³\) v místě \[50; 30; 28,5\]/m.test(st) && /šroub v závitu 3/.test(st), `[${tag}] stav: třídy a instance jako panel\n   ${(/^Kolize: .*$/m.exec(st) || [''])[0]}`);
}

(async () => {
  const browsers = [];
  const b = await chromium.launch({ args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader'] });
  browsers.push(b);
  const ctx = await b.newContext({ viewport: { width: 1430, height: 880 } });
  const p = await ctx.newPage();
  const errs = [];
  p.on('pageerror', (e) => errs.push(e.message));
  p.on('dialog', (d) => d.dismiss().catch(() => {}));
  await start(p, BASE + '/cad');
  const { run, idle, panel, waitState, kolizeBtn } = helpers(p);

  // ── 1–2 + 7 ──
  await classesFlow(p, 'webgl');

  // ── 3. opakované nálezy ──
  await run(corpus('72-clash-group').replace(/^(kolize|clash list.*|kollision liste.*|stav)$/gm, ''));
  await idle();
  await kolizeBtn();
  ok(await waitState('clash'), '3: sestava 5G – panel ve stavu clash');
  const g = await panel();
  ok(g && g.shown.length === 1 && g.shown[0].n === 4 && /4× .*Přidržovač.*Šroub M12.*#3, #4, #5, #6/.test(g.shown[0].text), `3: jedna skupina 4× s instancemi\n   ${g && g.shown.map((x) => x.text.replace(/\n/g, ' ')).join(' | ')}`);

  // ── 4. jádrová díra bez prvku závitu → nevyhodnotitelné + „Je to závit“ ──
  await run('nový díl "Deska C"\nkvádr 100 60 20\ndíra 10,2 hloubka 18 v 20 30\nnový díl "Šroub M12"\nválec 12 18\nválec 18 12 v 0 0 18\nnová sestava "Sestava 5P"\nvložit "Deska C" ukotvit\nvložit "Šroub M12" v 20 30 12 jako "S1"');
  await idle();
  await kolizeBtn();
  ok(await waitState('clash'), '4: sestava 5P – panel ve stavu clash');
  const u = await panel();
  ok(u && u.undetermined === '1' && u.real === '0' && u.shown.some((x) => x.cls === 'undetermined' && /bez prvku závitu/.test(x.text)), `4: nevyhodnotitelné s nápovědou, ne skutečná kolize\n   ${u && u.shown.map((x) => x.text.replace(/\n/g, ' ')).join(' | ')}`);
  await p.locator('[data-clash-rule-add="thread"]').first().click();
  await p.waitForFunction(() => document.querySelector('[data-clash-panel]')?.getAttribute('data-clash-thread') === '1', null, { timeout: 30000 }).catch(() => {});
  const u2 = await panel();
  ok(u2 && u2.state === 'clash' && u2.thread === '1' && u2.undetermined === '0', `4: „Je to závit“ → pravidlo, třída šroub v závitu, výsledek dál platí (stav ${u2 && u2.state})`);
  const doc4 = await p.evaluate(() => window.mncad.getDocument());
  ok((doc4.clashRules || []).length === 1 && doc4.clashRules[0].kind === 'thread', '4: pravidlo závit uložené v dokumentu (clashRules)');

  // ── 5. pracovní kontakt z panelu ──
  await run(corpus('74-clash-work-rule').replace(/^(kolize.*|pohyb.*|kollision.*|clash.*|stav)$/gm, ''));
  await idle();
  await kolizeBtn();
  ok(await waitState('clash'), '5: sestava Střih – panel ve stavu clash');
  const w0 = await panel();
  ok(w0 && w0.real === '1', `5: razník × plech = skutečná kolize bez pravidla (${w0 && w0.real})`);
  await p.locator('[data-clash-rule-add="work"]').first().click();
  await p.locator('[data-clash-rule-mode]').selectOption('mate');
  await p.locator('[data-clash-rule-v0]').fill('26');
  await p.locator('[data-clash-rule-v1]').fill('24');
  await p.locator('[data-clash-rule-save]').click();
  await p.waitForFunction(() => document.querySelector('[data-clash-panel]')?.getAttribute('data-clash-work') === '1', null, { timeout: 30000 }).catch(() => {});
  const w1 = await panel();
  ok(w1 && w1.work === '1' && w1.real === '0' && w1.hl.length === 0, `5: pracovní kontakt v okně hodnoty vazby 26–24 → ℹ, nic nesvítí (${w1 && [w1.work, w1.real, w1.hl.length].join('/')})`);
  ok(w1 && /pracovní kontakt/.test(w1.text) && /ZDVIH/.test(w1.text), '5: pravidlo vypsané v panelu (ZDVIH)');
  await p.locator('[data-clash-rules] summary').click().catch(() => {});
  await p.locator('[data-clash-rule-del]').first().click();
  await p.waitForFunction(() => document.querySelector('[data-clash-panel]')?.getAttribute('data-clash-real') === '1', null, { timeout: 30000 }).catch(() => {});
  const w2 = await panel();
  ok(w2 && w2.real === '1' && w2.work === '0', `5: × odebere pravidlo → zpět skutečná kolize (${w2 && [w2.real, w2.work].join('/')})`);

  // ── 6. pohyb uvnitř podsestavy a se skutečným nárazem ──
  const mlog = await run(corpus('73-clash-motion-sub').split('#--- run')[0] + '\n' + corpus('73-clash-motion-sub').split('#--- run')[1]);
  await idle();
  ok(!/Horní skupina“ × „Horní skupina/.test(mlog) && /clash\.steps=0\/6|kroků s kolizí 0 z 6/.test(mlog), `6: pohyb v podsestavě – šroub v závitu, žádný ⚠ „Horní skupina × Horní skupina“`);
  const api1 = await p.evaluate(() => window.mncad.motion());
  ok(api1 && api1.collision === null && api1.collisions && api1.collisions.thread === 2 && api1.collisions.steps === 0, `6: mncad.motion().collision = null (jen závit), collisions ${api1 && JSON.stringify(api1.collisions)}`);
  ok(api1 && api1.steps[0].clashList && api1.steps[0].clashList.every((c) => c.cls === 'thread') && /Horní skupina › Šroub M12 \[S1\]/.test(JSON.stringify(api1.steps[0].clashList)), '6: kroky API s třídou a popisem listu v podsestavě');
  const stepLbl = await p.locator('[data-motion-step]').first().innerText().catch(() => '');
  ok(!/· kolize/.test(stepLbl), `6: štítek kroku bez „· kolize“ (jen závit): ${stepLbl}`);
  const sum1 = await p.locator('[data-motion-summary]').first().innerText().catch(() => '');
  ok(/kroků s kolizí 0 z 6/.test(sum1) && !/první kolize/.test(sum1), `6: souhrn panelu pohybu podle tříd\n   ${sum1.split('\n')[0] || sum1}`);
  await run(corpus('73-clash-motion-sub').split('#--- run')[0] + '\n' + corpus('73-clash-motion-sub').split('#--- run')[2]);
  await idle();
  const api2 = await p.evaluate(() => window.mncad.motion());
  ok(api2 && api2.collision && api2.collision.step === 9 && api2.collision.b === 'Šroub M12 [S2]' && api2.collision.cls === 'real' && Array.isArray(api2.collision.at), `6: collision = první skutečná (krok 9, S2, místo) ${api2 && JSON.stringify(api2.collision)}`);
  ok(api2 && api2.collisions.steps === 7 && api2.collisions.of === 16, `6: kroků s kolizí 7 z 16 (${api2 && JSON.stringify(api2.collisions)})`);
  await p.screenshot({ path: `${S}w22c-6-motion.png` });
  ok(errs.length === 0, 'žádná chyba stránky: ' + errs.slice(0, 3).join(' | '));
  await ctx.close();

  // ── 8. EN / DE ──
  for (const [lang, title, cls] of [['en', /Interferences \(5\) · real 2 · screw in thread 3/, /screw in thread 3/], ['de', /Kollision\w* \(5\) · echte 2 · Schraube im Gewinde 3/, /Schraube im Gewinde 3/]]) {
    const cx = await b.newContext({ viewport: { width: 1430, height: 880 } });
    const pe = await cx.newPage();
    pe.on('dialog', (d) => d.dismiss().catch(() => {}));
    await start(pe, `${BASE}/${lang}/cad`);
    const h = helpers(pe);
    await h.run(corpus('70-clash-classes').replace(/^(kolize seznam.*|stav)$/gm, ''));
    await h.idle();
    ok(await h.waitState('clash'), `${lang.toUpperCase()}: příkaz kolize → panel ve stavu clash`);
    const t = await h.panel();
    ok(t && title.test(t.text) && t.filters.some((f) => cls.test(f.text)), `${lang.toUpperCase()}: titulek a přepínače přeložené\n   ${t && t.text.split('\n')[0]}`);
    await cx.close();
  }

  // ── 9. bez WebGL ──
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
  await classesFlow(p2, 'nowebgl');
  ok(errs2.length === 0, 'žádná chyba stránky (bez WebGL): ' + errs2.slice(0, 3).join(' | '));
  await b2.close();
  await b.close();
})().catch(async (e) => {
  console.log('ERR ' + (e && e.stack ? e.stack : e));
  process.exit(1);
});
