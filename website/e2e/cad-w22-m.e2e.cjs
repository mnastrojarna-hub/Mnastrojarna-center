// E2E vlna 22 – balík M, etapa 1 (produkční build): výsledky pohybové studie jen pro dokument a stav, pro který vznikly
// (body 1 a 12 zprávy), motor rozsah × rychlost (bod 9), absolutní hodnota vazby × zdvih (bod 11).
//  1. formulář motoru (skutečné kliky a psaní): Začátek předvyplněný AKTUÁLNÍ hodnotou vazby (ne 0), popisky podle významu
//     (hodnota vazby × posuv od výchozí polohy), vypočtený zdvih a směr, zadání zdvihem, ⚠ při začátku ≠ aktuální hodnota,
//     rozsah × rychlost s vypočtenou dobou, chyba u záporné rychlosti proti rozsahu; seznam motorů se směrem a koncem;
//  2. panel řízený stavem: data-motion-state ok → po změně geometrie dílu „stale“ („Výsledek neplatí“, ŽÁDNÝ starý souhrn),
//     po přepnutí na jinou sestavu „unchecked“, po změně studie „stale“; window.mncad.motion() vždy výsledek nynějšího stavu;
//  3. bod 12, scénář A: dávka, která mění motory a přehrává, nesmí spočítat ani ukázat původní desetikrokovou studii;
//  4. text v prohlížeči = CLI: přesný příkaz bodu 9 česky, anglicky (/en/cad) a německy (/de/cad) – směr, konec, doba; S2 bodu 11;
//  6. opravy po kontrole: chyba výpočtu v panelu jen u svého dokumentu, data-motion-verdict (mates-ok × ok), starý dokument
//     s nepoužitým koncem motoru (⚠ při načtení, převod na rozsah × rychlost), posun dílu uvnitř podsestavy → „stale“.
// Spuštění: E2E_BASE=http://localhost:3533 node e2e/cad-w22-m.e2e.cjs [výstupní složka]   (E2E_NOGL=1 = průchod bez WebGL)
const { chromium } = require('playwright');
const ok = (c, m) => { console.log((c ? 'ok: ' : 'FAIL: ') + m); if (!c) process.exitCode = 1; };
const BASE = (process.env.E2E_BASE || 'http://localhost:3100').replace(/\/$/, '');
const NO_GL = ['--disable-3d-apis', '--disable-webgl', '--disable-webgl2', '--disable-gpu'];
const GL = ['--use-gl=swiftshader', '--enable-unsafe-swiftshader'];
const NOGL = process.env.E2E_NOGL === '1';
const SHOTS = process.argv[2] ? process.argv[2].replace(/\/?$/, '/shots/') : null;
const line = (log, re) => (String(log).split('\n').find((l) => re.test(l)) || '').trim();
const GREEN = /Vazby splněny ve všech krocích|Kolize: žádné|Kolize v pohybu|rozsah pohybu/;

async function open(b, path) {
  const ctx = await b.newContext({ viewport: { width: 1500, height: 950 }, acceptDownloads: true });
  const p = await ctx.newPage();
  p.on('dialog', (d) => d.dismiss().catch(() => {}));
  await p.goto(BASE + path, { waitUntil: 'networkidle', timeout: 300000 });
  for (const t of ['Pokračovat v práci', 'Continue working', 'Weiterarbeiten']) {
    const c0 = p.getByText(t);
    if (await c0.isVisible({ timeout: 1500 }).catch(() => false)) await c0.click();
  }
  await p.waitForFunction(() => !!(window.mncad && window.mncad.run), null, { timeout: 240000 });
  await p.waitForFunction(() => !/Načítám (CAD )?jádro|Loading the (CAD )?kernel|Kern wird geladen/.test(document.body.innerText), null, { timeout: 240000 }).catch(() => {});
  return { ctx, p };
}

(async () => {
  const b = await chromium.launch({ args: NOGL ? NO_GL : GL });
  const { p } = await open(b, '/cad');
  const errs = [];
  p.on('pageerror', (e) => errs.push(e.message));
  const run = async (text) => String(await p.evaluate((t) => window.mncad.run(t), text));
  const getDoc = () => p.evaluate(() => window.mncad.getDocument());
  const mp = p.locator('[data-motion-panel]');
  const txt = async (sel) => (await mp.locator(sel).first().innerText({ timeout: 1500 }).catch(() => '')).trim();
  const state = () => mp.getAttribute('data-motion-state', { timeout: 1500 }).catch(() => null);
  const waitState = async (s, ms = 20000) => {
    const t0 = Date.now();
    while (Date.now() - t0 < ms) {
      if ((await state()) === s) return true;
      await p.waitForTimeout(100);
    }
    return false;
  };
  const field = (k) => mp.locator(`[data-motor-field="${k}"] input`).first();
  const setField = async (k, v) => {
    const el = field(k);
    if (!(await el.count())) return false;
    await el.fill(String(v));
    await el.press('Enter');
    await p.waitForTimeout(150);
    return true;
  };
  const val = async (k) => ((await field(k).count()) ? Number((await field(k).inputValue()).replace(',', '.')) : NaN);
  const openPanel = async () => {
    if (await mp.isVisible().catch(() => false)) return;
    await p.getByRole('button', { name: 'Sestava', exact: true }).first().click().catch(() => {});
    await p.locator('button', { hasText: 'Pohybová studie' }).first().click();
    await mp.waitFor({ timeout: 15000 });
  };
  const tab = async (name) => {
    await p.locator('[role="tab"]', { hasText: name }).locator('button').first().click();
    await p.waitForFunction((n) => window.mncad.getDocument().name === n, name, { timeout: 15000 });
    await p.waitForTimeout(300);
  };

  // ── model: dva díly, dvě sestavy (neutrální názvy) ──
  let log = await run(['nový díl "Deska A"', 'kvádr 60 40 10', 'nový díl "Přidržovač"', 'kvádr 10 10 10'].join('\n'));
  log += await run(['nová sestava "Sestava A"', 'vložit "Deska A" ukotvit', 'vložit "Přidržovač" v 40 10 30', 'sestava vazba vzdálenost "Přidržovač" spodní "Deska A" horní hodnota 20 název "ZDVIH"'].join('\n'));
  log += await run(['nová sestava "Sestava B"', 'vložit "Deska A" ukotvit', 'vložit "Přidržovač" v 0 0 40', 'sestava vazba vzdálenost "Přidržovač" spodní "Deska A" horní hodnota 30 název "ZDVIH"'].join('\n'));
  ok(!/^✗/m.test(log), `model: Deska A, Přidržovač, Sestava A (mezera 20), Sestava B (mezera 30)${NOGL ? ' – bez WebGL' : ''}`);
  await tab('Sestava A');
  await openPanel();

  // ══ 1. formulář motoru (body 11 a 9) ══
  ok((await state()) === 'unchecked' && (await mp.getAttribute('data-motion-doc')) === 'Sestava A' && /Nezkontrolováno/.test(await txt('[data-motion-status]')), `panel bez výpočtu: stav „unchecked“ pro „Sestava A“ – ${await txt('[data-motion-status]')}`);
  await mp.locator('[data-motor-kind="linear"]').click();
  await p.waitForTimeout(200);
  ok((await val('from')) === 20, `bod 11: Začátek lineárního motoru předvyplněn aktuální hodnotou vazby 20 mm (dřív 0) – ${await val('from')}`);
  ok((await mp.locator('[data-motion-add]').getAttribute('data-motor-meaning')) === 'absolute' && /hodnoty vazby „ZDVIH“ \(teď 20 mm\) – ne zdvih/.test(await txt('[data-motor-meaning-text]')), `bod 11: význam polí řečen výslovně – ${await txt('[data-motor-meaning-text]')}`);
  const labels = [await field('from').getAttribute('aria-label', { timeout: 1500 }).catch(() => ''), await field('to').getAttribute('aria-label', { timeout: 1500 }).catch(() => '')];
  ok(labels[0] === 'Začátek – hodnota vazby' && labels[1] === 'Konec – hodnota vazby', `bod 11: popisky polí podle významu – ${labels.join(' / ')}`);
  if (SHOTS) await p.screenshot({ path: SHOTS + `w22-m-motor-form${NOGL ? '-nogl' : ''}.png` });
  await setField('to', -5);
  ok(/^20 → -5 mm ↓ zdvih 25 mm$/.test(await txt('[data-motor-computed]')), `bod 11: vypočtený zdvih a směr vedle polí – ${await txt('[data-motor-computed]')}`);
  await mp.locator('[data-motor-end="stroke"]').click().catch(() => {});
  await p.waitForTimeout(150);
  ok((await val('stroke')) === -25, `bod 11: přepnutí na zadání zdvihem zachová průběh (zdvih −25) – ${await val('stroke')}`);
  await setField('stroke', -10);
  ok(/^20 → 10 mm ↓ zdvih 10 mm$/.test(await txt('[data-motor-computed]')), `bod 11: zadání „začátek + relativní posun“ −10 → konec 10 – ${await txt('[data-motor-computed]')}`);
  await setField('from', 0);
  const warn = await txt('[data-motor-warning="motion.start-jump"]');
  ok(/začátek 0 mm se liší od aktuální hodnoty vazby „ZDVIH“ 20 mm – v kroku 0 díl přeskočí o 20 mm/.test(warn), `bod 11: ⚠ začátek ≠ aktuální hodnota – ${warn.slice(0, 120)}`);
  await mp.locator('[data-motor-use-current]').click().catch(() => {});
  await p.waitForTimeout(200);
  ok((await val('from')) === 20 && !(await mp.locator('[data-motor-warning]').count()), `bod 11: „Začít od aktuální hodnoty“ → začátek 20, varování zmizelo (${await val('from')})`);
  // rozsah × rychlost (bod 9): doba se počítá, záporná rychlost proti rostoucímu rozsahu je chyba
  await mp.locator('[data-motor-mode="ranged"]').click().catch(() => {});
  await setField('speed', 5);
  ok(/^20 → 10 mm ↓ zdvih 10 mm · 5 mm\/s · 2 s$/.test(await txt('[data-motor-computed]')), `bod 9: rozsah × rychlost – směr, konec a doba ve formuláři – ${await txt('[data-motor-computed]')}`);
  await setField('speed', 2);
  ok(/· 2 mm\/s · 5 s · délka studie bude 5 s$/.test(await txt('[data-motor-computed]')), `bod 9: jiná rychlost → jiná doba a oznámená délka studie – ${await txt('[data-motor-computed]')}`);
  await mp.locator('[data-motor-add]').click().catch(() => {});
  await p.waitForTimeout(500);
  let d = await getDoc();
  const m0 = d.motion && d.motion.motors[0];
  ok(!!m0 && m0.from === 20 && m0.to === 10 && m0.speed === 2 && m0.ranged === true && d.motion.duration === 5, `bod 9: Přidat motor → rozsah 20 → 10 rychlostí 2 mm/s, délka studie 5 s – ${JSON.stringify(d.motion && { m: d.motion.motors, t: d.motion.duration })}`);
  ok(/^hodnota vazby 20 → 10 mm ↓ zdvih 10 mm · 2 mm\/s · 5 s$/.test(await txt('[data-motor-range]')), `seznam motorů: význam, konec, směr, rychlost a doba – ${await txt('[data-motor-range]')}`);
  await mp.locator('[data-motor-end="to"]').click().catch(() => {});
  await setField('to', 40);
  await setField('speed', -3);
  ok(/rychlost -3 je záporná, ale rozsah 20 → 40 mm roste/.test(await txt('[data-motor-error]')) && (await mp.locator('[data-motor-add]').isDisabled().catch(() => false)), `bod 9: záporná rychlost proti rostoucímu rozsahu = chyba s vysvětlením, Přidat zakázáno – ${(await txt('[data-motor-error]')).slice(0, 90)}`);
  // zkrácená studie → ⚠ motor nedojede (nikdy potichu)
  const dur = mp.locator('input[aria-label="Délka studie"]');
  await dur.fill('2'); await dur.press('Enter'); await p.waitForTimeout(400);
  ok(/motor 1 nedojede na konec: 10 mm rychlostí 2 mm\/s trvá 5 s, studie má 2 s – skončí na 16 mm/.test(await txt('[data-motion-note="motion.motor-short"]')), `bod 9: zkrácená studie → ⚠ motor nedojede – ${(await txt('[data-motion-note="motion.motor-short"]')).slice(0, 110)}`);
  // relativní vazba: druhá sestava nemá – ověří se význam u Souososti v textové části (4)

  // ══ 2. panel řízený stavem (bod 1) ══
  log = await run('pohyb smazat\npohyb motor lineární vazba 1 20..-5 kroky 10 kolize');
  ok(/hodnota vazby 20 → -5 mm ↓ zdvih 25 mm/.test(log) && /Kolize v pohybu: kroků s kolizí \d+ z 11/.test(log), `studie A: 20 → −5, 10 kroků, kolize – ${line(log, /^Kolize v pohybu/)}`);
  await openPanel();
  ok(await waitState('ok'), `po výpočtu: stav „ok“ (${await state()})`);
  let status = await txt('[data-motion-status]');
  ok(/Výsledek platí pro „Sestava A“ v nynějším stavu · 2 komponent · 10 kroků · spočítáno \d/.test(status), `stav uvádí dokument, počet komponent a kroky – ${status}`);
  ok(GREEN.test(await txt('[data-motion-summary]')) && /Pohybová studie: 10 kroků/.test(await txt('[data-motion-summary]')), 'platný výsledek má souhrn (10 kroků, kolize v pohybu)');
  let api = await p.evaluate(() => window.mncad.motion());
  ok(api.collision && api.steps.length === 11, `mncad.motion(): kolize v kroku ${api.collision && api.collision.step}`);

  // změna geometrie dílu (polohy, vazby i studie beze změny): deska se zkrátí, pod přidržovačem už není
  log = await run('sestava upravit "Deska A"\nupravit "Kvádr 1" size=30;40;10\nsestava hotovo');
  ok(/vrácen do sestavy/.test(log), 'díl „Deska A“ zkrácen na X 0…30 (úprava v kontextu sestavy)');
  await openPanel();
  ok(await waitState('stale', 8000), `bod 1: po změně dílu stav „stale“ (${await state()})`);
  status = await txt('[data-motion-status]');
  ok(/Výsledek neplatí – od výpočtu se změnilo: geometrie dílu „Deska A“\. Nezkontrolováno/.test(status), `bod 1: „Výsledek neplatí“ a co se změnilo – ${status}`);
  const stalePanel = await mp.innerText();
  ok(!GREEN.test(stalePanel) && !(await mp.locator('[data-motion-result]').count()), `bod 1: po změně dílu ŽÁDNÝ starý souhrn ani časová osa (dřív „Kolize v pohybu…“ staré sestavy)${GREEN.test(stalePanel) ? ' – nalezeno: ' + (stalePanel.match(GREEN) || [])[0] : ''}`);
  if (SHOTS) await p.screenshot({ path: SHOTS + `w22-m-stale${NOGL ? '-nogl' : ''}.png` });
  log = await run('stav');
  ok(/Pohyb: výsledek NEPLATÍ – od výpočtu se změnilo: geometrie dílu „Deska A“/.test(log), `stav: ${line(log, /^Pohyb:/)}`);
  log = await run('pohyb stav');
  ok(/výsledek pohybové studie pro nynější stav sestavy neplatí/.test(log) && !GREEN.test(log), `pohyb stav po změně dílu: ⚠ neplatí, žádný starý souhrn – ${line(log, /neplatí/).slice(0, 100)}`);
  api = await p.evaluate(() => window.mncad.motion());
  ok(api.collision === null && !api.summary.some((l) => /Kolize v pohybu/.test(l)), `bod 1: mncad.motion() po změně dílu = nový výpočet bez kolize (dřív starý výsledek 500 mm³) – ${JSON.stringify(api.collision)}`);
  ok(await waitState('ok', 8000), 'po novém výpočtu (API) panel zase „ok“');
  ok(/Kolize: žádné ve všech krocích/.test(await txt('[data-motion-summary]')), `nový souhrn patří zkrácené desce – ${line(await txt('[data-motion-summary]'), /Kolize/)}`);

  // přepnutí na jinou sestavu: nezkontrolováno; zpět: výsledek A platí
  await tab('Sestava B');
  await openPanel();
  ok((await state()) === 'unchecked' && (await mp.getAttribute('data-motion-doc')) === 'Sestava B', `bod 1: po přepnutí na „Sestava B“ stav „unchecked“ (${await state()}, ${await mp.getAttribute('data-motion-doc').catch(() => '')})`);
  const bPanel = await mp.innerText();
  ok(!GREEN.test(bPanel) && !/Výsledek platí/.test(bPanel) && /Nezkontrolováno/.test(await txt('[data-motion-status]')), 'bod 1: panel nad sestavou B neukazuje žádný výsledek sestavy A');
  log = await run('stav');
  ok(!/Pohyb: výsledek platí/.test(log), 'stav sestavy B: žádné „výsledek platí“ (studie nespočítána)');
  await tab('Sestava A');
  await openPanel();
  ok((await waitState('ok', 5000)) && /Výsledek platí pro „Sestava A“/.test(await txt('[data-motion-status]')), 'zpět na „Sestava A“: její výsledek stále platí');
  // změna studie v panelu: počet kroků
  const steps = mp.locator('input[aria-label="Počet kroků"]');
  await steps.fill('12'); await steps.press('Enter');
  ok(await waitState('stale', 5000), `změna studie (kroky 10 → 12): stav „stale“ (${await state()})`);
  ok(/definice studie/.test(await txt('[data-motion-status]')) && !GREEN.test(await mp.innerText()), `změna studie: „neplatí – definice studie“, žádný starý souhrn – ${await txt('[data-motion-status]')}`);
  await mp.locator('[data-motion-run]').click();
  ok((await waitState('ok', 60000)) && /12 kroků/.test(await txt('[data-motion-status]')), `Vypočítat pohyb znovu → „ok“, 12 kroků – ${await txt('[data-motion-status]')}`);
  // posun komponenty textem
  await run('sestava vazba 1 hodnota=22');
  ok(await waitState('stale', 5000), `změna vazby (hodnota 22): stav „stale“ – ${(await txt('[data-motion-status]')).slice(0, 90)}`);

  // ══ 3. bod 12, scénář A: dávka mění motory a přehrává – původní desetikroková studie se nesmí spočítat ani ukázat ══
  await run('sestava vazba 1 hodnota=20\npohyb smazat\npohyb motor lineární vazba 1 20..10 kroky 10');
  await openPanel();
  ok((await waitState('ok', 8000)) && /10 kroků/.test(await txt('[data-motion-status]')), 'výchozí stav: desetikroková studie spočítaná a zobrazená');
  await p.evaluate(() => {
    window.__w22 = [];
    const snap = () => {
      const el = document.querySelector('[data-motion-panel]');
      if (!el) return;
      const step = el.querySelector('[data-motion-step]');
      const sum = el.querySelector('[data-motion-summary]');
      window.__w22.push((step ? step.textContent : '') + ' | ' + (sum ? sum.textContent.slice(0, 60) : '') + ' | ' + (el.querySelector('[data-motion-run]') || {}).textContent);
    };
    window.__w22t = setInterval(snap, 40);
  });
  log = await run('pohyb smazat\npohyb motor lineární vazba 1 20..5 kroky 40\npohyb přehrát');
  ok(/▶ přehrávání 40 kroků/.test(log), `dávka: ${line(log, /přehrávání/)}`);
  await p.waitForTimeout(2500);
  const seen = await p.evaluate(() => { clearInterval(window.__w22t); return window.__w22; });
  const old = seen.filter((s) => /krok \d+\/10\b|Pohybová studie: 10 kroků|Počítám krok \d+ z 10\b/.test(s));
  ok(old.length === 0, `bod 12: během dávky ani po ní se neobjevil výpočet / výsledek původní studie o 10 krocích (vzorků ${seen.length}, starých ${old.length}${old.length ? ': ' + old[0] : ''})`);
  ok(seen.some((s) => /krok \d+\/40/.test(s)), `bod 12: přehrává se nová studie (krok N/40) – ${seen.filter((s) => /krok \d+\/40/.test(s)).slice(-1)[0] || 'nic'}`);
  ok((await state()) === 'ok' && /40 kroků/.test(await txt('[data-motion-status]')), `bod 12: panel po dávce „ok“ pro 40 kroků – ${await txt('[data-motion-status]')}`);
  const stepNow = await txt('[data-motion-step]');
  ok(/krok \d+\/40/.test(stepNow) && !/krok 0\/40/.test(stepNow), `bod 12: přehrávání nové studie běží – ${stepNow.split('·')[0]}`);
  await run('pohyb zastavit');
  // krok textem po další změně: panel ukáže krok NOVÉHO výsledku
  log = await run('pohyb kroky 20\npohyb krok 7');
  await p.waitForTimeout(800);
  ok(/krok 7\/20/.test(await txt('[data-motion-step]')), `pohyb kroky 20 + pohyb krok 7 v jedné dávce → panel na kroku 7/20 – ${(await txt('[data-motion-step]')).split('·')[0]}`);
  // „Vypočítat pohyb“ stisknuté BĚHEM běhu textových příkazů: panel počká na konec běhu a spočítá studii dokumentu, který běh
  // zapsal (běh mění vazbu, studii sám nepočítá → bez čekání by panel zůstal „stale“ nebo spočítal stav před během)
  const during = await p.evaluate(async () => {
    const pr = window.mncad.run('sestava vazba 1 hodnota=18');
    document.querySelector('[data-motion-run]').click();
    await pr;
    return window.mncad.getDocument().mates[0].value;
  });
  const waited = await waitState('ok', 20000);
  const note = await txt('[data-motion-note="motion.start-jump"]');
  ok(during === 18 && waited && /Výsledek platí pro „Sestava A“/.test(await txt('[data-motion-status]')) && /aktuální hodnoty vazby „ZDVIH“ 18 mm/.test(note), `bod 12: výpočet spuštěný během běhu počká a platí pro dokument po běhu (vazba ${during} mm, stav ${await state()}; ${note.slice(2, 80)})`);

  // ══ 4. text v prohlížeči: bod 9 (CS) a bod 11 S2 ══
  log = await run(['nový díl "Rám"', 'kvádr 100 100 10', 'nový díl "Deska B"', 'kvádr 100 100 10'].join('\n'));
  log = await run(['nová sestava "Mechanika"', 'vložit "Rám" ukotvit', 'vložit "Deska B" v 0 0 67.5', 'sestava vazba vzdálenost "Rám" horní "Deska B" spodní hodnota 57.5 název "ZDVIH"', 'pohyb motor lineární vazba 1 57.5..27.15 rychlost 15.175', 'pohyb krok 36'].join('\n'));
  ok(/✓ motor 1: lineární motor · ZDVIH „Rám“ → „Deska B“ · hodnota vazby 57,5 → 27,15 mm ↓ zdvih 30,35 mm · 15,175 mm\/s · 2 s/.test(log), `bod 9 (cs, prohlížeč): ${line(log, /^✓ motor 1/)}`);
  ok(/Krok 36 \(t = 2 s, motory 27,15\)/.test(log) && /Deska B \[0; 0; 37,15\]/.test(log), `bod 9: motor skončí na 27,15, deska na Z 37,15 (dřív 87,85 / 97,85) – ${line(log, /^Krok 36/)}`);
  log = await run('pohyb motor lineární "Deska B" 57,5..27,15 kroky 2\npohyb krok 0\npohyb krok 2');
  ok(/hodnota vazby 57,5 → 27,15 mm ↓ zdvih 30,35 mm \(hodnota vazby je absolutní/.test(log) && /Deska B \[0; 0; 67,5\]/.test(log) && /Deska B \[0; 0; 37,15\]/.test(log) && !/Deska B \[0; 0; -/.test(log), `bod 11: motor zadaný komponentou B vazby Vzdálenost – bez obrácení znaménka (krok 0 Z 67,5, krok 2 Z 37,15; dřív −47,5 skrz rám) – ${line(log, /^✓ motor 1/).slice(0, 150)}`);
  await openPanel();
  ok((await waitState('ok', 8000)) && (await mp.getAttribute('data-motion-doc')) === 'Mechanika', 'panel: výsledek sestavy „Mechanika“');

  // ══ 5. bod 11 v panelu u vazby Souosost: hodnoty jsou posuv / natočení OD VÝCHOZÍ POLOHY – formulář to říká a začíná na 0 ══
  log = await run(['nový díl "Deska C"', 'kvádr 100 100 10', 'díra 20,2 skrz v 50 50', 'nový díl "Vodítko"', 'válec 20 120'].join('\n'));
  log += await run(['nová sestava "Vedení"', 'vložit "Deska C" ukotvit', 'vložit "Vodítko" v 50 50 -20', 'sestava vazba souosost "Vodítko" válcová "Deska C" Ø20,2 název "VEDENÍ"'].join('\n'));
  ok(!/^✗/m.test(log), 'model: sestava „Vedení“ s vazbou Souosost „VEDENÍ“');
  await openPanel();
  ok((await state()) === 'unchecked' && (await mp.getAttribute('data-motion-doc')) === 'Vedení', `nová sestava: panel „unchecked“ pro „Vedení“ (${await state()})`);
  await mp.locator('[data-motor-kind="linear"]').click();
  await p.waitForTimeout(200);
  const relText = await txt('[data-motor-meaning-text]');
  const relLabels = [await field('from').getAttribute('aria-label', { timeout: 1500 }).catch(() => ''), await field('to').getAttribute('aria-label', { timeout: 1500 }).catch(() => '')];
  ok((await mp.locator('[data-motion-add]').getAttribute('data-motor-meaning')) === 'relative' && /posuv od výchozí polohy \(0 = jak díl teď stojí\), ne hodnota vazby/.test(relText) && relLabels[0] === 'Začátek – posuv od výchozí polohy' && relLabels[1] === 'Konec – posuv od výchozí polohy' && (await val('from')) === 0, `bod 11: Souosost – pole jsou posuv od výchozí polohy, začátek 0 (${relLabels.join(' / ')}; ${relText.slice(0, 70)})`);
  await mp.locator('[data-motor-end="stroke"]').click().catch(() => {});
  await setField('stroke', -30);
  ok(/^0 → -30 mm ↓ zdvih 30 mm$/.test(await txt('[data-motor-computed]')), `bod 11: Souosost, zdvih −30 od výchozí polohy – ${await txt('[data-motor-computed]')}`);
  await setField('from', 12);
  ok(/začátek 12 mm není 0 – u vazby „VEDENÍ“ je hodnota motoru posuv \/ natočení od výchozí polohy/.test(await txt('[data-motor-warning="motion.start-jump"]')), `bod 11: Souosost, začátek ≠ 0 → ⚠ skok v kroku 0 – ${(await txt('[data-motor-warning="motion.start-jump"]')).slice(0, 110)}`);
  await mp.locator('[data-motor-use-current]').click().catch(() => {});
  await p.waitForTimeout(200);
  await mp.locator('[data-motor-add]').click().catch(() => {});
  await p.waitForTimeout(500);
  ok(/^posuv od výchozí polohy 0 → -30 mm ↓ zdvih 30 mm$/.test(await txt('[data-motor-range]')) && (await mp.locator('[data-motor]').first().getAttribute('data-motor-meaning')) === 'relative', `bod 11: seznam motorů u Souososti říká „posuv od výchozí polohy“ – ${await txt('[data-motor-range]')}`);
  await mp.locator('[data-motor-kind="rotary"]').click();
  await p.waitForTimeout(200);
  const rotLabel = await field('from').getAttribute('aria-label', { timeout: 1500 }).catch(() => '');
  ok(rotLabel === 'Začátek – natočení od výchozí polohy' && /^0 → 360° ↺ otočení 360°$/.test(await txt('[data-motor-computed]')), `bod 11: rotační motor – natočení od výchozí polohy, směr ↺ (${rotLabel}; ${await txt('[data-motor-computed]')})`);

  // ══ 6. opravy po kontrole etapy 1: chyba výpočtu jen u svého dokumentu, verdikt, starý motor s nepoužitým koncem, podsestava ══
  // a) chyba výpočtu (motor na potlačené vazbě) patří dokumentu a stavu – nad jinou sestavou ani po změně studie se neukáže
  await tab('Sestava B');
  log = await run('pohyb motor lineární vazba 1 30..20 kroky 4\nsestava vazba 1 potlačit');
  await openPanel();
  await mp.locator('[data-motion-run]').click();
  const errShown = await mp.locator('[data-motion-error]').waitFor({ timeout: 20000 }).then(() => true, () => false);
  ok(errShown && /potlačená/.test(await txt('[data-motion-error]')), `chyba výpočtu u „Sestava B“ (motor na potlačené vazbě) – ${await txt('[data-motion-error]')}`);
  await tab('Sestava A');
  await openPanel();
  ok((await mp.locator('[data-motion-error]').count()) === 0 && (await mp.getAttribute('data-motion-doc')) === 'Sestava A', 'bod 12: chyba sestavy B se nad sestavou A neukáže (dřív zůstala viset)');
  await tab('Sestava B');
  await openPanel();
  await run('pohyb kroky 6');
  await p.waitForTimeout(400);
  ok((await mp.locator('[data-motion-error]').count()) === 0, 'po změně studie sestavy B stará chyba zmizí (patřila jinému stavu)');
  // b) verdikt: kolize nekontrolovány → „mates-ok“, ne „ok“; s kontrolou kolizí bez průniku → „ok“
  await tab('Mechanika');
  await openPanel();
  log = await run('pohyb motor lineární vazba 1 57.5..27.15 rychlost 15.175\nstav');
  ok((await waitState('ok', 20000)) && (await mp.getAttribute('data-motion-verdict')) === 'mates-ok' && /kolize nekontrolovány/.test(line(log, /^Pohyb: /)), `verdikt bez kontroly kolizí: data-motion-verdict="${await mp.getAttribute('data-motion-verdict')}" – ${line(log, /^Pohyb: /)}`);
  log = await run('pohyb kolize\nstav');
  ok((await waitState('ok', 60000)) && (await mp.getAttribute('data-motion-verdict')) === 'ok' && /bez průniku těles v kontrolovaných krocích/.test(line(log, /^Pohyb: /)), `verdikt po kontrole kolizí: data-motion-verdict="${await mp.getAttribute('data-motion-verdict')}" – ${line(log, /^Pohyb: /)}`);
  // c) dokument starší verze: motor s rychlostí a uloženým koncem bez `ranged` → ⚠ při načtení, v panelu převod na rozsah × rychlost
  const legacy = await p.evaluate(() => {
    const d = window.mncad.getDocument();
    d.motion = { ...d.motion, collisions: undefined, motors: d.motion.motors.map((m) => { const x = { ...m }; delete x.ranged; return x; }) };
    return JSON.stringify(d);
  });
  log = await run(legacy);
  ok(/uložený konec 27,15 mm se nepoužívá/.test(log), `starý dokument: ⚠ motion.end-unused při načtení – ${line(log, /nepoužívá/).slice(0, 140)}`);
  await openPanel();
  const endNote = await txt('[data-motion-note="motion.end-unused"]');
  ok(/na konci studie je na 87,85 mm \(opačným směrem, než leží konec\)/.test(endNote), `panel: upozornění na nepoužitý konec – ${endNote.slice(0, 120)}`);
  await mp.locator('[data-motor-to-ranged="1"]').click().catch(() => {});
  await p.waitForTimeout(500);
  const conv = await getDoc();
  ok(conv.motion.motors[0].ranged === true && conv.motion.duration === 2 && /57,5 → 27,15 mm ↓ zdvih 30,35 mm · 15,175 mm\/s · 2 s/.test(await txt('[data-motor-range]')) && (await mp.locator('[data-motion-note="motion.end-unused"]').count()) === 0, `Převést na rozsah × rychlost: motor dojede na 27,15 a stojí – ${await txt('[data-motor-range]')}`);
  // d) podsestava: posun dílu UVNITŘ podsestavy → výsledek neplatí (panel „stale“, `stav` NEPLATÍ jmenuje podsestavu)
  log = await run(['nový díl "Doraz"', 'kvádr 10 10 5', 'nový díl "Sloupek"', 'kvádr 5 5 5'].join('\n'));
  log += await run(['nová sestava "Sestava S"', 'vložit "Deska A" ukotvit', 'vložit "Přidržovač" v 40 10 30', 'vložit "Doraz" v 0 0 50', 'vložit "Sloupek" v 20 0 50', 'sestava podsestava "Doraz" "Sloupek" jako "Skupina"', 'sestava vazba vzdálenost "Přidržovač" spodní "Deska A" horní hodnota 20', 'pohyb motor lineární vazba 1 20..5 kroky 5'].join('\n'));
  await openPanel();
  ok((await waitState('ok', 20000)) && (await mp.getAttribute('data-motion-doc')) === 'Sestava S', `podsestava: výsledek „Sestava S“ platí (${await state()})`);
  log = await run('sestava upravit "Skupina"\nsestava komponenta "Doraz" v 40 10 22\nsestava hotovo\nstav');
  ok((await waitState('stale', 8000)) && /Pohyb: výsledek NEPLATÍ – od výpočtu se změnilo: poloha, ukotvení, skrytí nebo vazby komponent v podsestavě „Skupina“/.test(log), `bod 1: posun dílu uvnitř podsestavy → „stale“ a NEPLATÍ (dřív motion=ok) – ${line(log, /^Pohyb: /).slice(0, 140)}`);
  ok(!GREEN.test(await mp.innerText()), 'podsestava: žádný starý souhrn v panelu');
  ok(errs.length === 0, 'bez chyb stránky' + (errs.length ? ': ' + errs.slice(0, 2).join(' | ') : ''));

  // ── EN a DE: stejný příkaz, protokol i panel bez českých zlomků ──
  for (const [path, cmd, re] of [
    ['/en/cad', 'motion motor linear mate 1 57.5..27.15 speed 15.175', /✓ motor 1: linear motor · ZDVIH „Deska B“ → „Rám“ · mate value 57\.5 → 27\.15 mm ↓ stroke 30\.35 mm · 15\.175 mm\/s · 2 s/],
    ['/de/cad', 'bewegung antrieb linear verknüpfung 1 57.5..27.15 geschwindigkeit 15.175', /✓ Antrieb 1: Linearantrieb · ZDVIH „Deska B“ → „Rám“ · Verknüpfungswert 57,5 → 27,15 mm ↓ Hub 30,35 mm · 15,175 mm\/s · 2 s/],
  ]) {
    const o = await open(b, path);
    const r2 = async (t) => String(await o.p.evaluate((x) => window.mncad.run(x), t));
    await r2(['nový díl "Rám"', 'kvádr 100 100 10', 'nový díl "Deska B"', 'kvádr 100 100 10'].join('\n'));
    const l2 = await r2(['nová sestava "Mechanika"', 'vložit "Rám" ukotvit', 'vložit "Deska B" v 0 0 67.5', 'sestava vazba vzdálenost "Deska B" spodní "Rám" horní hodnota 57.5 název "ZDVIH"', cmd].join('\n'));
    const ml = line(l2, /^✓ (motor|Antrieb) 1/);
    ok(re.test(l2) && !/ od \d|zdvih|hodnota vazby/.test(ml), `bod 9 (${path}): ${ml}`);
    const pan = o.p.locator('[data-motion-panel]');
    const shown = await pan.waitFor({ timeout: 15000 }).then(() => true, () => false);
    const item = shown ? (await pan.locator('[data-motor-range]').first().innerText({ timeout: 3000 }).catch(() => '')).trim() : '';
    ok(shown && /57[.,]5 → 27[.,]15 mm ↓/.test(item) && !/zdvih|hodnota vazby|rychlostí/.test(item), `panel ${path}: ${item}`);
    const st2 = shown ? (await pan.locator('[data-motion-status]').innerText({ timeout: 3000 }).catch(() => '')).trim() : '';
    ok((await pan.getAttribute('data-motion-state').catch(() => null)) === 'ok' && !/Výsledek|komponent |kroků/.test(st2), `panel ${path}: stav „ok“ přeložený – ${st2}`);
    await o.ctx.close();
  }
  await b.close();
})().catch((e) => { console.log('FAIL: výjimka ' + (e && e.stack || e)); process.exitCode = 1; });
