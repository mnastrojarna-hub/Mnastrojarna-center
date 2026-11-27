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
// Etapa C3 – bod 4 (procesní vrstva: střih a otisk během pohybu), s WebGL i bez něj:
// 12) razník Ø20 × plech 1 mm (korpus 74d): `pohyb proces střih` → panel pohybu oddíl Procesní vrstva s operací, věta „geometrická
//     aproximace … ne simulace materiálu“; krok 0 = data-process-state=full (plný plech, žádná náhrada sítě), krok 19 = engaged
//     (157 mm³), krok 21 = pierced, data-process-scrapped=1, data-process-removed≈314,159; 3D okno / softwarový náhled ukazuje plech
//     po střihu a odpad (main[data-process-view] ≥ 2, síť „proc:…“); úroveň „kinematika + geometrická aproximace“; window.mncad
//     .motion().process (stav po krocích, removed); pracovní záběr bez štítku „· kolize“; přidání operace otisk v GUI zapíše
//     doc.motion.process; export PNG snímků obsahuje plech po operaci (snímek kroku 21 se liší od kroku 0); druhý střih do téže díry
//     = celkem 314 mm³ jednou, odpad 1, main[data-process-combined]=1 (kombinovaný stav obrobku, ne síť poslední operace)
// 13) kolo 6 (body 4 a 6): korpus 74i – střižník projde plechem během JEDNOHO kroku → panel v kroku 1 data-process-state=pierced,
//     314 mm³, plech po střihu ve 3D / náhledu (síť z požadavku s mezipolohami – stejný klíč jako výpočet); korpus 74j – otisk + střih:
//     krok 6 „děrovaný + v záběru“ (data-process-engaged=1); korpus 74h – vůle 0,03 mm mezi kroky 17 a 18: řádek s polohou v úseku,
//     ⚠ pod limitem (data-clearance-below=1), nikdy „dodržen v celém pohybu“; „Na minimum“ skočí na nejbližší krok úseku
// 14) kolo 7: klik na nález v panelu Kolize přiblíží 3D okno / softwarový náhled na místo průniku (cíl kamery = místo průniku
//     data-clash-at → data-clash-focused); korpus 74l – podmínka operace `při motor 1 <= 5` splněná uprostřed kroku, bez kolizí:
//     krok 1 data-process-state=pierced 314 mm³ (dřív „nezasáhl“, plný)
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

/** 12 (C3, bod 4): procesní vrstva – střih plechu během pohybu, stav výrobku, plech po střihu ve 3D / náhledu */
async function processFlow(p, tag, soft) {
  const { run, idle } = helpers(p);
  const mp = p.locator('[data-motion-panel]');
  const openMotion = async () => {
    if (await mp.count()) return;
    await p.locator('button', { hasText: /^Pohybová studie$/ }).first().click().catch(() => {});
    await mp.waitFor({ timeout: 30000 }).catch(() => {});
  };
  const motionDone = () => p.waitForFunction(() => document.querySelector('[data-motion-panel]')?.getAttribute('data-motion-state') === 'ok', null, { timeout: 240000 }).then(() => true, () => false);
  const setup = corpus('74d-process-cut').split('\n').filter((l) => !/^(#|pohyb (krok|proces|stav)|stav)/.test(l)).join('\n');
  ok(!/^✗/m.test(await run(setup)), `[${tag}] 74d: lis s razníkem a plechem, studie 48 kroků`);
  const log = await run('pohyb proces střih "Razník" "Plech"');
  ok(!/^✗/m.test(log) && /geometrická aproximace/.test(log) && /odebráno 314,1\d* mm³/.test(log), `[${tag}] pohyb proces střih: protokol s úrovní a odebraným objemem`);
  await idle();
  await openMotion();
  ok(await motionDone(), `[${tag}] studie s procesní vrstvou spočítána`);
  ok((await p.locator('[data-process-op]').count()) === 1, `[${tag}] panel: oddíl Procesní vrstva s 1 operací`);
  const note = (await p.locator('[data-process-level-note]').textContent().catch(() => '')) || '';
  ok(/geometrická aproximace/.test(note) && /není to simulace materiálu/.test(note), `[${tag}] panel: věta o úrovni (geometrická aproximace, ne simulace materiálu)`);
  const lvl = await p.locator('[data-motion-level]').textContent().catch(() => '');
  ok(/kinematika \+ geometrická aproximace/.test(lvl || ''), `[${tag}] štítek úrovně „kinematika + geometrická aproximace“\n   ${lvl}`);
  const state = () => p.evaluate(() => {
    const el = document.querySelector('[data-process-state]');
    const main = document.querySelector('main[data-process-view]') || document.querySelector('[data-process-view]');
    return el ? { state: el.getAttribute('data-process-state'), removed: Number(el.getAttribute('data-process-removed')), scrap: Number(el.getAttribute('data-process-scrapped')), view: main ? Number(main.getAttribute('data-process-view')) : 0 } : null;
  });
  const step = async (n) => {
    await run(`pohyb krok ${n}`);
    await p.waitForTimeout(1200);
  };
  await step(0);
  const s0 = await state();
  ok(s0 && s0.state === 'full' && s0.removed === 0 && s0.view === 0, `[${tag}] krok 0: plný plech, žádná náhrada sítě (${JSON.stringify(s0)})`);
  await p.screenshot({ path: `${S}w22c-${tag}-12-step0.png` });
  await step(19);
  const s19 = await state();
  ok(s19 && s19.state === 'engaged' && Math.abs(s19.removed - 157.08) < 2 && s19.view >= 1, `[${tag}] krok 19: v záběru, odebráno ≈157 mm³, síť plechu nahrazena (${JSON.stringify(s19)})`);
  await step(21);
  const s21 = await state();
  ok(s21 && s21.state === 'pierced' && Math.abs(s21.removed - 314.159) < 3.2 && s21.scrap === 1 && s21.view >= 2, `[${tag}] krok 21: děrovaný, 314,16 mm³ ± 1 %, odpad 1 – plech i odpad ve ${soft ? 'softwarovém náhledu' : '3D okně'} (${JSON.stringify(s21)})`);
  ok((await p.locator('[data-motion-step-flag], [data-motion-panel] .text-brand', { hasText: /kolize/ }).count()) === 0, `[${tag}] pracovní záběr: krok bez štítku „· kolize“`);
  await p.screenshot({ path: `${S}w22c-${tag}-12-step21.png` });
  const api = await p.evaluate(() => window.mncad.motion());
  ok(api.process && api.process.level === 'geometric-approximation' && Math.abs(api.process.ops[0].removed - 314.159) < 3.2 && api.process.ops[0].through && api.process.steps[0].states[0].state === 'full' && api.process.steps[21].states[0].state === 'pierced', `[${tag}] window.mncad.motion().process: úroveň, removed, prostřižení, stav po krocích`);
  ok(!api.collision && api.collisions && api.collisions.real === 0 && api.collisions.work === 1, `[${tag}] API: žádná skutečná kolize, pracovní kontakt 1 (${JSON.stringify(api.collisions)})`);
  // dokument se nemění: plech v dokumentu má dál plný objem (restart = plný)
  await step(0);
  ok((await state())?.state === 'full', `[${tag}] návrat na krok 0 = plný plech`);
  // GUI: přidat otisk
  await p.locator('[data-process-new-kind="imprint"]').click();
  await p.locator('[data-process-tool]').selectOption({ label: 'Razník' });
  await p.locator('[data-process-target]').selectOption({ label: 'Plech' });
  await p.locator('[data-process-depth] input').first().fill('0,3');
  await p.locator('[data-process-depth] input').first().press('Enter').catch(() => {});
  await p.locator('[data-process-add]').click();
  await p.waitForTimeout(800);
  const ops = await p.evaluate(() => (window.mncad.getDocument().motion?.process || []).map((o) => [o.kind, o.depth]));
  ok(ops.length === 2 && ops[1][0] === 'imprint' && Math.abs(ops[1][1] - 0.3) < 1e-9, `[${tag}] otisk přidaný v GUI je ve studii (${JSON.stringify(ops)})`);
  await p.locator('[data-process-remove="2"]').click();
  await p.waitForTimeout(400);
  // fáze 2 kolo 3: druhý střih tímtéž razníkem do téže díry – obrobek po OBOU operacích (sjednocení): 314 mm³ jednou, odpad 1,
  // 3D / náhled ukazuje kombinovaný stav (síť „proc:…:c…“); dřív removed=628 a jen síť poslední operace
  const two = await run('pohyb proces střih "Razník" "Plech" název "střih znovu"');
  ok(!/^✗/m.test(two) && /„Plech“: 2 operací, celkem odebráno 314,1\d* mm³/.test(two), `[${tag}] dva střihy do téže díry: celkem 314 mm³ jednou (sjednocení), ne součet\n   ${(two.match(/.*operací.*/g) || []).join(' | ')}`);
  await idle();
  ok(await motionDone(), `[${tag}] studie se 2 operacemi spočítána`);
  await step(21);
  const c21 = await p.evaluate(() => {
    const el = document.querySelector('[data-process-state]');
    const main = document.querySelector('main[data-process-combined]') || document.querySelector('[data-process-combined]');
    return el ? { state: el.getAttribute('data-process-state'), removed: Number(el.getAttribute('data-process-removed')), scrap: Number(el.getAttribute('data-process-scrapped')), combined: main ? Number(main.getAttribute('data-process-combined')) : 0 } : null;
  });
  ok(c21 && c21.state === 'pierced' && Math.abs(c21.removed - 314.159) < 3.2 && c21.scrap === 1 && c21.combined === 1, `[${tag}] krok 21 se 2 operacemi: děrovaný, 314 mm³ jednou, odpad 1, ${soft ? 'náhled' : '3D okno'} ukazuje plech po obou operacích (${JSON.stringify(c21)})`);
  await run('pohyb proces 2 smazat');
  await idle();
  // export PNG po krocích: snímek kroku 21 se liší od kroku 0 (plech po střihu je v exportu)
  if (!soft) {
    const dl = p.waitForEvent('download', { timeout: 240000 }).catch(() => null);
    await p.locator('[data-motion-export="png"]').click().catch(() => {});
    const d = await dl;
    ok(!!d, `[${tag}] export snímků PNG proběhl (${d ? d.suggestedFilename() : 'bez stažení'})`);
    if (d) await d.saveAs(`${S}w22c-${tag}-12-frames.zip`).catch(() => {});
  }
}

/** 13 (kolo 6): záběr mezi kroky, děrovaný + v záběru, vůle mezi kroky zvlášť – s WebGL i bez něj */
async function round6Flow(p, tag, soft) {
  const { run, idle } = helpers(p);
  const mp = p.locator('[data-motion-panel]');
  const openMotion = async () => {
    if (await mp.count()) return;
    await p.locator('button', { hasText: /^Pohybová studie$/ }).first().click().catch(() => {});
    await mp.waitFor({ timeout: 30000 }).catch(() => {});
  };
  const motionDone = () => p.waitForFunction(() => document.querySelector('[data-motion-panel]')?.getAttribute('data-motion-state') === 'ok', null, { timeout: 240000 }).then(() => true, () => false);
  const state = () => p.evaluate(() => {
    const el = document.querySelector('[data-process-state]');
    const main = document.querySelector('main[data-process-view]') || document.querySelector('[data-process-view]');
    return el ? { state: el.getAttribute('data-process-state'), engaged: el.getAttribute('data-process-engaged'), text: el.textContent, removed: Number(el.getAttribute('data-process-removed')), scrap: Number(el.getAttribute('data-process-scrapped')), view: main ? Number(main.getAttribute('data-process-view')) : 0 } : null;
  });
  const step = async (n) => {
    await run(`pohyb krok ${n}`);
    await p.waitForTimeout(1200);
  };
  // 74i: jeden krok, nástroj projde plechem mezi kroky (dřív „bez záběru – nezasáhl“, stav plný)
  const jump = await run(corpus('74i-process-between'));
  ok(!/^✗/m.test(jump) && /záběr od mezipolohy mezi kroky 0 a 1/.test(jump) && !/nezasáhl/.test(jump), `[${tag}] 74i: střih spočítaný v mezipolohách, ne „nezasáhl“`);
  await idle();
  await openMotion();
  ok(await motionDone(), `[${tag}] 74i: studie spočítána`);
  await step(1);
  const j1 = await state();
  ok(j1 && j1.state === 'pierced' && Math.abs(j1.removed - 314.159) < 3.2 && j1.scrap === 1 && j1.view >= 1, `[${tag}] 74i krok 1: děrovaný, 314 mm³, plech po střihu ve ${soft ? 'softwarovém náhledu' : '3D okně'} (${JSON.stringify(j1)})`);
  await p.screenshot({ path: `${S}w22c-${tag}-13-jump.png` });
  // 74j: otisk + prostřižený střih → „děrovaný + v záběru“ (dřív „v záběru“)
  const imp = await run(corpus('74j-process-imprint-depth'));
  ok(!/^✗/m.test(imp) && /otisk do „Plech“ 0,1 mm z požadovaných 0,3 mm/.test(imp), `[${tag}] 74j: ℹ otisk 0,1 z 0,3 mm`);
  await idle();
  ok(await motionDone(), `[${tag}] 74j: studie Lis B spočítána`);
  await step(6);
  const k6 = await state();
  ok(k6 && k6.state === 'pierced' && k6.engaged === '1' && /děrovaný \+ v záběru/.test(k6.text || ''), `[${tag}] 74j krok 6: děrovaný + v záběru (${JSON.stringify(k6)})`);
  // 74h: vůle mezi kroky 17 a 18 – zvlášť, s polohou v úseku; nikdy „dodržen v celém pohybu“
  const clr = await run(corpus('74h-clearance-pin-side').split('\n').filter((l) => !/^(pohyb vůle smazat|pohyb vůle "Kolík"|pohyb stav|pohyb krok)/.test(l)).join('\n'));
  ok(!/^✗/m.test(clr), `[${tag}] 74h: sestava a vůle bez chyby`);
  await idle();
  ok(await motionDone(), `[${tag}] 74h: studie spočítána`);
  const box = await p.evaluate(() => {
    const el = document.querySelector('[data-clearance-min]');
    return el ? { min: el.getAttribute('data-clearance-min'), below: el.getAttribute('data-clearance-below'), text: el.textContent, jump: document.querySelector('[data-clearance-jump]')?.textContent || '' } : null;
  });
  ok(box && box.below === '1' && /mezi kroky 17 a 18 \(po přímé dráze: poloha 17,/.test(box.text) && /pod limitem 0,05 mm mezi kroky 17 a 18/.test(box.text) && !/dodržen/.test(box.text), `[${tag}] 74h panel: 0,03 mm mezi kroky 17 a 18 s polohou, ⚠ pod limitem, bez „dodržen“ (${box && box.min} · ${box && box.text.slice(0, 200)})`);
  ok(box && /krok 1[78]\)/.test(box.jump), `[${tag}] 74h: „Na minimum“ míří do úseku 17–18 (${box && box.jump})`);
  await p.screenshot({ path: `${S}w22c-${tag}-13-clearance.png` });
}

/** 14 (kolo 7, body 5 a 4): přiblížení na místo průniku z panelu Kolize; začátek operace uprostřed kroku – s WebGL i bez něj */
async function round7Flow(p, tag, soft) {
  const { run, idle, waitState } = helpers(p);
  const log = await run(corpus('70-clash-classes').replace(/^(kolize|stav|kolize seznam.*)$/gm, ''));
  ok(!/^✗/m.test(log), `[${tag}] kolo 7: sestava 5 založena textem`);
  await idle();
  await p.waitForTimeout(1200);
  await run('kolize'); // příkaz kolize otevře panel s novým výsledkem zobrazeného dokumentu
  await idle();
  ok(await waitState('clash'), `[${tag}] kolo 7: panel Kolize ve stavu clash`);
  const btn = p.locator('[data-clash-group] button[data-clash-at]').first();
  const at = (await btn.getAttribute('data-clash-at').catch(() => null)) || '';
  ok(/^-?[\d.]+;-?[\d.]+;-?[\d.]+$/.test(at), `[${tag}] kolo 7: položka nese místo průniku (${at})`);
  const before = await p.evaluate(() => document.querySelector('[data-clash-panel]')?.getAttribute('data-clash-focused') || '');
  await btn.click();
  await p.waitForFunction(() => !!document.querySelector('[data-clash-panel]')?.getAttribute('data-clash-focused'), null, { timeout: 15000 }).catch(() => {});
  const foc = await p.evaluate(() => document.querySelector('[data-clash-panel]')?.getAttribute('data-clash-focused') || '');
  const a = at.split(';').map(Number);
  const f = foc.split(';').map(Number);
  ok(!before && f.length === 3 && a.length === 3 && f.every((v, i) => Math.abs(v - a[i]) < 0.01), `[${tag}] kolo 7: klik přiblížil ${soft ? 'softwarový náhled' : '3D okno'} na místo průniku (cíl kamery ${foc} = místo ${at})`);
  await p.screenshot({ path: `${S}w22c-${tag}-14-focus.png` });

  const mp = p.locator('[data-motion-panel]');
  const mid = await run(corpus('74l-process-start-mid'));
  ok(!/^✗/m.test(mid) && /removed=314\.1\d* scrap=1 through=1|odebráno 314,1/.test(mid) && !/nezasáhl/.test(mid), `[${tag}] kolo 7 · 74l: začátek uprostřed kroku – střih spočítán, ne „nezasáhl“`);
  await idle();
  if (!(await mp.count())) {
    await p.locator('button', { hasText: /^Pohybová studie$/ }).first().click().catch(() => {});
    await mp.waitFor({ timeout: 30000 }).catch(() => {});
  }
  await p.waitForFunction(() => document.querySelector('[data-motion-panel]')?.getAttribute('data-motion-state') === 'ok', null, { timeout: 240000 }).catch(() => {});
  await run('pohyb krok 1');
  await p.waitForTimeout(1200);
  const st = await p.evaluate(() => {
    const el = document.querySelector('[data-process-state]');
    return el ? { state: el.getAttribute('data-process-state'), removed: Number(el.getAttribute('data-process-removed')), text: el.textContent } : null;
  });
  ok(st && st.state === 'pierced' && Math.abs(st.removed - 314.159) < 3.2 && !/plný/.test(st.text || ''), `[${tag}] kolo 7 · 74l krok 1: děrovaný 314 mm³ (${JSON.stringify(st)})`);
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
  // seznam pravidel je ve sbaleném oddílu „Pravidla kolizí (N)“ – souhrn ukáže počet, po rozbalení text pravidla
  ok(w1 && /Pravidla kolizí \(1\)/.test(w1.text), '5: souhrn „Pravidla kolizí (1)“ v panelu');
  await p.locator('[data-clash-rules] summary').click().catch(() => {});
  const ruleTxt = (await p.locator('[data-clash-rule]').first().innerText().catch(() => '')) || '';
  ok(/pracovní kontakt/.test(ruleTxt) && /ZDVIH/.test(ruleTxt), `5: pravidlo vypsané v panelu (ZDVIH) – ${ruleTxt}`);
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
  // dvojice je neuspořádaná (pořadí a/b dává pořadí listů v jádře) – musí to být doraz × šroub S2
  ok(api2 && api2.collision && api2.collision.step === 9 && [api2.collision.a, api2.collision.b].sort().join(' × ') === 'Doraz × Šroub M12 [S2]' && api2.collision.cls === 'real' && api2.collision.volume > 0 && Array.isArray(api2.collision.at), `6: collision = první skutečná (krok 9, S2, místo) ${api2 && JSON.stringify(api2.collision)}`);
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
    await processFlow(pc, 'webgl', false); // C3: procesní vrstva (bod 4)
    ok(errs.length === 0, 'C3: žádná chyba stránky: ' + errs.slice(0, 3).join(' | '));
    await round6Flow(pc, 'webgl', false); // kolo 6: záběr mezi kroky, děrovaný + v záběru, vůle mezi kroky
    ok(errs.length === 0, 'kolo 6: žádná chyba stránky: ' + errs.slice(0, 3).join(' | '));
    await round7Flow(pc, 'webgl', false); // kolo 7: přiblížení na místo průniku, začátek operace uprostřed kroku
    ok(errs.length === 0, 'kolo 7: žádná chyba stránky: ' + errs.slice(0, 3).join(' | '));
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
  await processFlow(p2, 'nowebgl', true); // C3: plech po střihu a odpad v softwarovém náhledu
  await round6Flow(p2, 'nowebgl', true); // kolo 6 bez WebGL
  await round7Flow(p2, 'nowebgl', true); // kolo 7 bez WebGL
  ok(errs2.length === 0, 'žádná chyba stránky (bez WebGL): ' + errs2.slice(0, 3).join(' | '));
  await b2.close();
  await b.close();
})().catch(async (e) => {
  console.log('ERR ' + (e && e.stack ? e.stack : e));
  process.exit(1);
});
