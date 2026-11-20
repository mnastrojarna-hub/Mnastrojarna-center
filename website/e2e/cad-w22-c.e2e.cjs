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
// Etapa C2 – bod 6 (vůle a spojitá kontrola v pohybu), s WebGL i bez něj:
// 10) střižník Ø10 ve vedení Ø10,02 (korpus 74c): panel Kolize bez průniku = „Bez průniku · vůle nekontrolována“ (žádné ✓,
//     data-clash-clearance=unchecked); `pohyb vůle … min 0,05` → sekce Vůle s dvojicí a limitem, výsledek 0,01 mm pod limitem
//     (data-clearance-min / -below), graf vůle, „Na minimum“ → úsečka vůle ve 3D / v náhledu (data-gap-label „min 0,01 mm“,
//     pod limitem červená; bez WebGL červené pixely v překryvné vrstvě)
// 11) nůž přes kolík (korpus 74b): spojitě = tlačítko „Kolize mezi kroky 17 a 18“, window.mncad.motion(): between, sweep.mode
//     continuous, collisions.between=1; odškrtnout „Kolize i mezi kroky“ + Vypočítat → data-motion-sweep=discrete a text
//     „mezi polohami nekontrolováno“, žádný kontakt mezi kroky; přidání dvojice v GUI zapíše doc.motion.clearance
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

/** 10–11 (C2, bod 6): vůle v pohybu, úsečka minima, spojitě × diskrétně – s WebGL i bez něj */
async function clearanceFlow(p, tag, soft) {
  const { run, idle, panel, waitState, kolizeBtn } = helpers(p);
  const mp = p.locator('[data-motion-panel]');
  const openMotion = async () => {
    if (await mp.count()) return;
    await p.locator('button', { hasText: /^Pohybová studie$/ }).first().click().catch(() => {});
    await mp.waitFor({ timeout: 30000 }).catch(() => {});
  };
  const motionDone = () => p.waitForFunction(() => document.querySelector('[data-motion-panel]')?.getAttribute('data-motion-state') === 'ok', null, { timeout: 180000 }).then(() => true, () => false);
  // ── 10. vedení 0,01 mm ──
  const setup = corpus('74c-clearance-guide').split('\n').filter((l) => !/^(#|kolize|pohyb|stav)/.test(l)).join('\n');
  ok(!/^✗/m.test(await run(setup)), `[${tag}] 74c: sestava 6b založena`);
  await idle();
  await kolizeBtn();
  ok(await waitState('ok'), `[${tag}] kolize bez průniku → stav ok`);
  const a = await panel();
  ok(a && /Bez průniku · vůle nekontrolována/.test(a.text) && !/✓|Bez kolizí/.test(a.text), `[${tag}] panel Kolize: „Bez průniku · vůle nekontrolována“, žádné ✓\n   ${a && a.text.split('\n')[0]}`);
  ok((await p.locator('[data-clash-clearance="unchecked"]').count()) === 1, `[${tag}] panel Kolize výslovně: vůle se tu nekontroluje`);
  await run('pohyb motor lineární vazba 1 0..20 kroky 10 kolize\npohyb vůle "Střižník" "Vodítko" min 0,05');
  await idle();
  await openMotion();
  ok(await motionDone(), `[${tag}] studie s vůlí spočítána (data-motion-state=ok)`);
  const pairs = await p.locator('[data-clearance-pair]').allTextContents();
  ok(pairs.length === 1 && /Střižník/.test(pairs[0]) && /Vodítko/.test(pairs[0]), `[${tag}] sekce Vůle: sledovaná dvojice ${JSON.stringify(pairs)}`);
  const min = await p.locator('[data-clearance-min]').getAttribute('data-clearance-min').catch(() => null);
  const below = await p.locator('[data-clearance-min]').getAttribute('data-clearance-below').catch(() => null);
  ok(min === '0,01' && below === '1', `[${tag}] nejmenší vůle 0,01 mm pod limitem (min=${min}, below=${below})`);
  ok((await p.locator('[data-clearance-chart]').count()) === 1 && (await p.locator('[data-clearance-limit-line]').count()) === 1, `[${tag}] graf vůle po krocích s čarou limitu`);
  ok((await p.locator('[data-motion-sweep="continuous"]').count()) === 1, `[${tag}] štítek kontroly: spojitě i mezi polohami`);
  await p.locator('[data-clearance-jump]').click();
  await p.waitForTimeout(800);
  const gl = p.locator('[data-gap-label]').first();
  ok(await gl.isVisible().catch(() => false), `[${tag}] úsečka vůle: popisek ve ${soft ? 'softwarovém náhledu' : '3D okně'}`);
  ok(/min 0,01 mm/.test((await gl.textContent().catch(() => '')) || '') && (await gl.getAttribute('data-gap-below')) === '1', `[${tag}] popisek „min 0,01 mm“, pod limitem`);
  if (soft) {
    const red = await p.evaluate(() => {
      const c = document.querySelector('[data-soft-overlay]');
      const g = c && c.getContext('2d');
      if (!g) return 0;
      const d = g.getImageData(0, 0, c.width, c.height).data;
      let n = 0;
      for (let i = 0; i < d.length; i += 4) if (d[i + 3] > 200 && d[i] > 190 && d[i + 1] < 110 && d[i + 2] < 110) n++;
      return n;
    });
    ok(red > 0, `[${tag}] úsečka vůle nakreslená v překryvné vrstvě náhledu bez WebGL (${red} px)`);
  }
  await p.screenshot({ path: `${S}w22c-${tag}-10-clearance.png` });
  const api = await p.evaluate(() => window.mncad.motion());
  ok(api.clearance && api.clearance.limit === 0.05 && Math.abs(api.clearance.min.d - 0.01) < 1e-6 && api.clearance.pairs[0].below.length === 11, `[${tag}] window.mncad.motion().clearance: limit, minimum, kroky pod limitem`);
  // ── 11. nůž přes kolík: spojitě × diskrétně ──
  const knife = corpus('74b-clearance-knife-pin').split('\n').filter((l) => !/^(#|pohyb)/.test(l)).join('\n');
  ok(!/^✗/m.test(await run(knife + '\npohyb motor lineární vazba "POSUV" 12..192 kroky 36 kolize')), `[${tag}] 74b: sestava 6 a studie 36 kroků`);
  await idle();
  await openMotion();
  ok(await motionDone(), `[${tag}] studie nože spočítána`);
  ok((await p.locator('[data-clearance-between="17-18"]').count()) === 1, `[${tag}] „Kolize mezi kroky 17 a 18“ v panelu (dřív „Kolize: žádné ve všech krocích“)`);
  const m1 = await p.evaluate(() => window.mncad.motion());
  ok(m1.sweep && m1.sweep.mode === 'continuous' && m1.between && m1.between[0].k0 === 17 && m1.collisions && m1.collisions.between === 1 && m1.collision && m1.collision.between, `[${tag}] API: sweep.mode=continuous, between[0].k0=17, collisions.between=1, collision mezi kroky`);
  await p.locator('[data-motion-continuous]').uncheck();
  await p.waitForTimeout(400);
  await p.locator('[data-motion-run]').click();
  ok(await motionDone(), `[${tag}] diskrétně přepočítáno`);
  const sweepTxt = (await p.locator('[data-motion-sweep]').textContent().catch(() => '')) || '';
  ok((await p.locator('[data-motion-sweep="discrete"]').count()) === 1 && /mezi polohami nekontrolováno/.test(sweepTxt) && (await p.locator('[data-clearance-between]').count()) === 0, `[${tag}] diskrétně: výslovně „mezi polohami nekontrolováno“, žádný kontakt mezi kroky\n   ${sweepTxt}`);
  // přidání dvojice v GUI
  await p.locator('[data-clearance-mode="pairs"]').click();
  await p.locator('[data-clearance-comp="a"]').selectOption({ label: 'Nůž' });
  await p.locator('[data-clearance-comp="b"]').selectOption({ label: 'Kolík' });
  await p.locator('[data-clearance-add]').click().catch(() => {});
  await p.waitForTimeout(600);
  const st = await p.evaluate(() => JSON.stringify(window.mncad.doc ? window.mncad.doc().motion?.clearance ?? null : null));
  const pairs2 = await p.locator('[data-clearance-pair]').allTextContents();
  ok(pairs2.some((x) => /Nůž/.test(x) && /Kolík/.test(x)), `[${tag}] dvojice přidaná v GUI je ve studii (${pairs2.join(' | ')} ${st})`);
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

  // ── 10–11. vůle a spojitá kontrola (C2, bod 6) s WebGL ──
  {
    const cx = await b.newContext({ viewport: { width: 1430, height: 900 } });
    const pc = await cx.newPage();
    const errs = [];
    pc.on('pageerror', (e) => errs.push(e.message));
    pc.on('dialog', (d) => d.dismiss().catch(() => {}));
    await start(pc, BASE + '/cad');
    await clearanceFlow(pc, 'webgl', false);
    ok(errs.length === 0, 'C2: žádná chyba stránky: ' + errs.slice(0, 3).join(' | '));
    await cx.close();
  }

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
  await clearanceFlow(p2, 'nowebgl', true); // C2: úsečka vůle v softwarovém náhledu (majitel testoval bez WebGL)
  ok(errs2.length === 0, 'žádná chyba stránky (bez WebGL): ' + errs2.slice(0, 3).join(' | '));
  await b2.close();
  await b.close();
})().catch(async (e) => {
  console.log('ERR ' + (e && e.stack ? e.stack : e));
  process.exit(1);
});
