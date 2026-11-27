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
//  7. etapa M2 (body 2, 7, 8): přepínač režimu studie (kinematika / kvazistatika / dynamika / auto) a úroveň simulace v panelu,
//     kvazistatika s předpětím (přidržovač 19,325), ⚠ neurčená poloha v kinematice, pružina po načtení JSON (⚠ spring.stale, 15 mm),
//     motor na mezi (stopped + odchylky), „na mezi: chyba“ → neplatný krok s rámečkem v 3D, statická úprava za mezí ⚠, preferovaná strana.
//  kolo 4 (fáze 2, bod 20 – pružina): díl změněn v záložce → klik „Obnovit z dílu“ → seznam vazeb ukazuje pružinu se ztracenou dosedací
//     plochou (data-mate-spring, data-springs-lost), nic se nepřichytí jinam, panel pružiny ✗ bez délky; oprava = Upravit pružinu → ✓.
//  kolo 5: `stav` stručně nese `springs.lost=1` v = status / D / Σ (i sestava jen s pružinou bez vazeb); „Odebrat pružinu“ v seznamu
//     vazeb jde textovým příkazem `sestava pružina #k odebrat` (✓ pružina odebrána).
// Spuštění: E2E_BASE=http://localhost:3533 node e2e/cad-w22-m.e2e.cjs [výstupní složka]   (E2E_NOGL=1 = průchod bez WebGL)
const { chromium } = require('playwright');
const ok = (c, m) => { console.log((c ? 'ok: ' : 'FAIL: ') + m); if (!c) process.exitCode = 1; };
const BASE = (process.env.E2E_BASE || 'http://localhost:3100').replace(/\/$/, '');
const NO_GL = ['--disable-3d-apis', '--disable-webgl', '--disable-webgl2', '--disable-gpu'];
const GL = ['--use-gl=swiftshader', '--enable-unsafe-swiftshader'];
const NOGL = process.env.E2E_NOGL === '1';
const SHOTS = process.argv[2] ? process.argv[2].replace(/\/?$/, '/shots/') : null;
const line = (log, re) => (String(log).split('\n').find((l) => re.test(l)) || '').trim();
// vlna 22 C2: souhrn bez průniku teď zní „Kolize: žádný průnik v N polohách“ – musí ho chytit i tento negativní test
const GREEN = /Vazby splněny ve všech krocích|Kolize: žádné|Kolize: žádný průnik|Kolize v pohybu|rozsah pohybu/;

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
  // vlna 22, M3 (bod 10): formulář motoru není trvale otevřený – „+ Nový motor“ ho otevře
  ok((await mp.locator('[data-motion-add]').count()) === 0 && (await mp.locator('[data-motor-new]').count()) === 1, 'bod 10: bez otevřeného formuláře, tlačítko „+ Nový motor“');
  await mp.locator('[data-motor-new]').click();
  await mp.locator('[data-motor-kind="linear"]').click();
  await p.waitForTimeout(200);
  ok((await val('from')) === 20, `bod 11: Začátek lineárního motoru předvyplněn aktuální hodnotou vazby 20 mm (dřív 0) – ${await val('from')}`);
  ok((await mp.locator('[data-motion-add]').getAttribute('data-motor-meaning')) === 'absolute' && /hodnoty vazby „ZDVIH“ \(teď 20 mm\) – ne zdvih/.test(await txt('[data-motor-meaning-text]')), `bod 11: význam polí řečen výslovně – ${await txt('[data-motor-meaning-text]')}`);
  const labels = [await field('from').getAttribute('aria-label', { timeout: 1500 }).catch(() => ''), await field('to').getAttribute('aria-label', { timeout: 1500 }).catch(() => '')];
  ok(labels[0] === 'Začátek – hodnota vazby' && labels[1] === 'Konec – hodnota vazby', `bod 11: popisky polí podle významu – ${labels.join(' / ')}`);
  if (SHOTS) await p.screenshot({ path: SHOTS + `w22-m-motor-form${NOGL ? '-nogl' : ''}.png` });
  await setField('to', -5);
  ok(/^20 → -5 mm ↓ zdvih 25 mm$/.test(await txt('[data-motor-computed]')), `bod 11: vypočtený zdvih a směr vedle polí – ${await txt('[data-motor-computed]')}`);
  // přepnutí čeká na skutečný stav (pole zdvihu ve formuláři), ne na pevnou pauzu – bez WebGL a pod zátěží se klik zpracuje později
  // (kolo 6: nestabilní FAIL „přepnutí na zadání zdvihem … – NaN“); klik se nepolyká, chyba kliku = FAIL kroku
  await mp.locator('[data-motor-end="stroke"]').click();
  await mp.locator('[data-motor-field="stroke"] input').first().waitFor({ state: 'visible', timeout: 15000 }).catch(() => {});
  // pole se po přepnutí přerenderuje (týž prvek input dostane hodnotu zdvihu o snímek později): čekat na ustálený stav formuláře –
  // vypočtený řádek a pole zdvihu se shodují (selže-li přepnutí, zůstane jiná hodnota a krok níže je FAIL)
  await p.waitForFunction(() => { const i = document.querySelector('[data-motor-field="stroke"] input'); return !!i && Number(String(i.value).replace(',', '.')) === -25; }, null, { timeout: 15000 }).catch(() => {});
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
  const computedBefore = await txt('[data-motor-computed]');
  await mp.locator('[data-motor-mode="ranged"]').click();
  // režim rozsah × rychlost: pole rychlosti ve formuláři (skutečný stav), pak teprve zadání
  await mp.locator('[data-motor-field="speed"] input').first().waitFor({ state: 'visible', timeout: 15000 }).catch(() => {});
  ok((await field('speed').count()) > 0, `bod 9: přepnutí na rozsah × rychlost ukáže pole rychlosti (vypočteno předtím: ${computedBefore})`);
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
  // M3 (bod 10): po přidání se formulář zavře; klik na motor v seznamu = Upravit motor 1 (předvyplněný)
  ok((await mp.locator('[data-motion-add]').count()) === 0, 'bod 10: po přidání formulář zavřený');
  await mp.locator('[data-motor-edit="1"]').click();
  ok((await mp.locator('[data-motor-form="edit"]').count()) === 1 && (await val('speed')) === 2, `bod 10: Upravit motor 1 – formulář předvyplněný (rychlost ${await val('speed')})`);
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
  ok(/Výsledek platí pro „Sestava A“ v nynějším stavu · 2 komponent · 10 kroků · r·[0-9a-f]{6} · výpočet v\d+ · spočítáno \d/.test(status), `stav uvádí dokument, počet komponent, kroky, revizi modelu a id výpočtu – ${status}`);
  // revize modelu výsledku (táž funkce jako panel Kolize) a id výpočtu ve sdíleném modelu výpočtů (body 1 a 12 – kolo 6)
  const mRev = await mp.locator('[data-motion-status]').getAttribute('data-motion-rev');
  const mRun = await mp.locator('[data-motion-status]').getAttribute('data-motion-run-id');
  ok(/^r·[0-9a-f]{6}$/.test(mRev || '') && status.includes(mRev) && /^v\d+$/.test(mRun || ''), `bod 1/12: data-motion-rev ${mRev}, data-motion-run-id ${mRun}`);
  ok(GREEN.test(await txt('[data-motion-summary]')) && /Pohybová studie: 10 kroků/.test(await txt('[data-motion-summary]')), 'platný výsledek má souhrn (10 kroků, kolize v pohybu)');
  let api = await p.evaluate(() => window.mncad.motion());
  ok(api.collision && api.steps.length === 11, `mncad.motion(): kolize v kroku ${api.collision && api.collision.step}`);
  // výpočet pohybu je záznam sdíleného modelu výpočtů: mncad.motion() vrací týž běh, computes() ho vypíše (bod 12 – kolo 6)
  const comps12 = await p.evaluate(() => window.mncad.computes());
  const mEntry = (comps12 || []).find((e) => e.id === (api.run && api.run.id));
  ok(!!api.run && api.run.id === mRun && /@r·[0-9a-f]{6}$/.test(api.run.inputRev) && api.run.inputRev.endsWith(mRev) && api.run.state === 'done' && !!mEntry && mEntry.what === 'motion', `bod 12: mncad.motion().run ${JSON.stringify(api.run)} · computes() ${mEntry ? mEntry.id + ' ' + mEntry.what + ' ' + mEntry.state : 'bez záznamu pohybu'}`);

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
  // vlna 22 C2: souhrn říká, kolik poloh se kontrolovalo („žádný průnik v 11 polohách“), ne „žádné ve všech krocích“
  ok(/Kolize: žádný průnik v 11 polohách/.test(await txt('[data-motion-summary]')), `nový souhrn patří zkrácené desce – ${line(await txt('[data-motion-summary]'), /Kolize/)}`);

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
  if (await mp.locator('[data-motor-cancel]').count()) await mp.locator('[data-motor-cancel]').click();
  await mp.locator('[data-motor-new]').click();
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
  await mp.locator('[data-motor-new]').click();
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
  // `pohyb kroky 6` studii přepočítá – s motorem na potlačené vazbě ✗ a dokument se NEZMĚNÍ: chyba dál patří témuž stavu (fáze 2)
  log = await run('pohyb kroky 6');
  await p.waitForTimeout(400);
  ok(/^✗ .*motor 1: vazba motoru je potlačená/m.test(log) && (await mp.locator('[data-motion-error]').count()) === 1, `pohyb kroky 6 s motorem na potlačené vazbě: ✗, studie beze změny, chyba platí dál – ${line(log, /^✗/)}`);
  // změna sestavy (vazba zapnuta) = jiný stav: stará chyba zmizí
  await run('sestava vazba 1 zapnout');
  await p.waitForTimeout(400);
  ok((await mp.locator('[data-motion-error]').count()) === 0, 'po změně sestavy B (vazba zapnuta) stará chyba zmizí (patřila jinému stavu)');
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

  // ── 7. etapa M2 (body 2, 7, 8): režim a úroveň studie, kvazistatika s předpětím, motor na mezi, neplatný krok, pružina po načtení ──
  const warns = [];
  p.on('console', (m) => { if (m.type() === 'warning') warns.push(m.text()); });
  await run(['nový díl "Rám M"', 'kvádr 100 100 10', 'nový díl "Deska M"', 'kvádr 100 100 10', 'nový díl "Přidržovač M"', 'kvádr 60 60 8', 'nový díl "Pružina M"', 'pružina 18 stoupání 5 závity 6 drát 2'].join('\n'));
  log = await run([
    'nová sestava "Mechanika M2"', 'vložit "Rám M" ukotvit', 'vložit "Deska M" v 0 0 67.5', 'vložit "Přidržovač M" v 20 20 34.5', 'vložit "Pružina M" v 50 50 42.5',
    'sestava vazba vzdálenost "Deska M" spodní "Rám M" horní hodnota 57.5 název "ZDVIH"',
    'sestava vazba mez-vzdálenosti "Přidržovač M" horní "Deska M" spodní min 5 max 25 název "Mez"',
    'sestava vazba mez-vzdálenosti "Přidržovač M" spodní "Rám M" horní min 0 max 500 název "Dosed"',
    'sestava vazba zámek "Pružina M" "Přidržovač M"',
    'sestava pružina "Pružina M" mezi "Přidržovač M" "Deska M" volná 32 blok 14 tuhost 20',
    'pohyb motor lineární vazba "ZDVIH" 57.5..27.15 kroky 12', 'pohyb krok 6',
  ].join('\n'));
  // a) bod 2: automaticky kvazistatika (pružina na pohyblivé komponentě) – krok 6 přidržovač 19,325 (dřív 34,5), úroveň v protokolu i panelu
  ok(/Úroveň simulace: kvazistatika/.test(log) && /Přidržovač M \[20; 20; 19,325\]/.test(log), `bod 2: kvazistatika, krok 6 přidržovač 19,325 – ${line(log, /Přidržovač M \[/)}`);
  await openPanel();
  await waitState('ok', 30000);
  const modeBox = mp.locator('[data-motion-mode]').first();
  ok((await modeBox.getAttribute('data-motion-mode')) === 'auto' && (await modeBox.getAttribute('data-motion-mode-effective')) === 'quasistatic', `panel: režim auto → kvazistatika (${await modeBox.getAttribute('data-motion-mode-effective')})`);
  ok((await mp.locator('[data-motion-level]').first().getAttribute('data-motion-level')) === 'quasistatic' && /Úroveň simulace: kvazistatika/.test(await txt('[data-motion-level]')), `panel: úroveň simulace – ${(await txt('[data-motion-level]')).slice(0, 90)}`);
  // b) přepínač režimu skutečným klikem: kinematika → úroveň kinematika, ⚠ motion.undetermined v panelu (přidržovač vazbami neurčen)
  await mp.locator('[data-motion-mode-btn="kin"]').click();
  await p.waitForTimeout(300);
  ok((await getDoc()).motion?.mode === 'kinematic' && (await mp.locator('[data-motion-level]').first().getAttribute('data-motion-level')) === 'kinematic', 'klik Kinematika: study.mode = kinematic, úroveň kinematika');
  await mp.locator('button', { hasText: /Vypočítat pohyb/ }).first().click().catch(() => {});
  await waitState('ok', 30000);
  ok((await mp.locator('[data-motion-finding="motion.undetermined"]').count()) === 1 && !/^Vazby splněny ve všech krocích$/m.test(await mp.innerText()), 'kinematika: ⚠ poloha přidržovače neurčena (ne holé „Vazby splněny“)');
  await mp.locator('[data-motion-mode-btn="auto"]').click();
  await p.waitForTimeout(300);
  ok(!(await getDoc()).motion?.mode && (await modeBox.getAttribute('data-motion-mode-effective')) === 'quasistatic', 'klik Auto: režim smazán, efektivně kvazistatika');
  // c) bod 7: externě upravený JSON (Deska o 10 mm níž, ZDVIH 47,5, spring.length 25) → ⚠ spring.stale a délka 15 z ploch
  const stale = await p.evaluate(() => {
    const d = window.mncad.getDocument();
    for (const c of d.components) if (c.name === 'Deska M') c.placement.position[2] = 57.5;
    for (const m of d.mates) if (m.name === 'ZDVIH') m.value = 47.5;
    delete d.motion;
    return JSON.stringify(d);
  });
  log = await run(`${stale}\nstav`);
  const spr = () => getDoc().then((d) => (d.components || []).find((c) => c.name === 'Pružina M')?.spring?.length);
  ok(/uložená délka 25 mm neodpovídá dosedacím plochám \(15 mm\)/.test(log) && /„Pružina M“ 15 mm .* – délka odvozená z dosedacích ploch/.test(log) && Math.abs((await spr()) - 15) < 1e-3, `bod 7: ⚠ spring.stale a stav 15 mm – ${line(log, /uložená délka/).slice(0, 120)}`);
  // GUI cesta (setDocument bez skriptu, jako otevření souboru): efekt pružin opraví délku a ohlásí ⚠ (console.warn + flash)
  await p.evaluate((j) => window.mncad.setDocument(JSON.parse(j)), stale).catch(() => {});
  await p.waitForTimeout(1500);
  ok(Math.abs((await spr()) - 15) < 1e-3, `bod 7 GUI: délka pružiny po otevření 15 mm (uloženo 25) – ${await spr()}${warns.some((w) => /spring\.stale/.test(w)) ? ' · console.warn spring.stale' : ''}`);
  // d) bod 8: pevná vazba + mez × motor – motor na mezi stojí (panel „stopped“ s odchylkami); s „chyba“ neplatný krok a rámeček v 3D
  log = await run(['nová sestava "Mechanika K"', 'vložit "Rám M" ukotvit', 'vložit "Deska M" v 0 0 67.5', 'vložit "Přidržovač M" v 0 0 34.5',
    'sestava vazba vzdálenost "Deska M" spodní "Rám M" horní hodnota 57.5 název "ZDVIH"',
    'sestava vazba vzdálenost "Přidržovač M" spodní "Rám M" horní hodnota 24.5 název "PEVNÁ"',
    'sestava vazba mez-vzdálenosti "Přidržovač M" horní "Deska M" spodní min 5 max 25 název "Mez"',
    'pohyb motor lineární vazba "ZDVIH" 57.5..27.15 kroky 12', 'pohyb krok 12'].join('\n'));
  ok(/motor 1 stojí na mezi v krocích 8–12/.test(log) && /Deska M \[0; 0; 47,5\]/.test(log) && /Přidržovač M \[0; 0; 34,5\]/.test(log), `bod 8: motor stojí na mezi, bez ujetí – ${line(log, /stojí na mezi/).slice(0, 120)}`);
  await openPanel();
  await waitState('ok', 30000);
  const scrub = mp.locator('[data-motion-scrub]');
  await scrub.fill('12').catch(() => {});
  await p.waitForTimeout(300);
  ok((await mp.locator('[data-motion-step-status="stopped"]').count()) === 1 && /na mezi min 5 mm/.test(await txt('[data-motion-step-devs]')) && (await mp.locator('[data-motion-finding="motion.motor-limit"]').count()) === 1, `panel krok 12: motor stojí na mezi + odchylky – ${(await txt('[data-motion-step-devs]')).slice(0, 120)}`);
  await mp.locator('[data-motor-atlimit]').first().selectOption('error');
  await p.waitForTimeout(300);
  ok((await getDoc()).motion?.motors?.[0]?.atLimit === 'error', 'výběr „na mezi: chyba“ zapíše motor.atLimit = error');
  await mp.locator('button', { hasText: /Vypočítat pohyb/ }).first().click().catch(() => {});
  await waitState('ok', 30000);
  await scrub.fill('12').catch(() => {});
  await p.waitForTimeout(400);
  const inv = p.locator('[data-motion-invalid]');
  ok((await mp.locator('[data-motion-step-status="invalid"]').count()) === 1 && (await inv.count()) === 1 && (await inv.getAttribute('data-motion-shows')) === '7', `neplatný krok 12: panel „invalid“, 3D rámeček ukazuje krok ${await inv.getAttribute('data-motion-shows').catch(() => '?')}`);
  // e) statická úprava za mezí: polohy beze změny, ⚠ (žádné ✓ s kompromisem)
  const before = JSON.stringify((await getDoc()).components.map((c) => c.placement));
  log = await run('sestava vazba "ZDVIH" hodnota=37.15');
  ok(/^⚠ vazba 1 .*konflikt/m.test(log) && /nejbližší dosažitelná hodnota 37,5 mm/.test(log) && JSON.stringify((await getDoc()).components.map((c) => c.placement)) === before, `bod 8 statika: ⚠ konflikt, polohy beze změny – ${line(log, /nejbližší/).slice(0, 120)}`);
  // f) preferovaná strana meze v panelu sestavy (pole existuje u meze; volba zapíše mate.prefer)
  const pref = p.locator('[data-mate-prefer]').first();
  if (await pref.count()) {
    await pref.selectOption('max');
    await p.waitForTimeout(300);
    ok((await getDoc()).mates.some((m) => m.prefer === 'max'), 'panel sestavy: Preferovaná strana max → mate.prefer');
  } else console.log('info: pole data-mate-prefer není vidět (vazba meze nerozbalená) – preferovaná strana ověřena textem v testech');
  ok(errs.length === 0, 'bez chyb stránky' + (errs.length ? ': ' + errs.slice(0, 2).join(' | ') : ''));

  // ── 8. etapa M3 (body 3, 10, 15): jedna studie s fázemi, motory v panelu (nový × upravit, dosah, osa, konflikt), tuhé skupiny ──
  await run(['nový díl "Deska F"', 'kvádr 200 200 20', 'nový díl "Plech F"', 'kvádr 120 120 2', 'nový díl "Horní F"', 'kvádr 200 200 20', 'nový díl "Razník F"', 'válec 20 38', 'nový díl "Držák F"', 'kvádr 40 40 10'].join('\n'));
  log = await run([
    'nová sestava "Cyklus F"', 'vložit "Deska F" ukotvit', 'vložit "Plech F" v 40 40 20', 'sestava vazba ukotvit "Plech F"', 'vložit "Horní F" v 0 0 100', 'vložit "Razník F" v 100 100 62', 'vložit "Držák F" v 140 140 52',
    'sestava vazba vzdálenost "Horní F" spodní "Deska F" horní hodnota 80 název "ZDVIH"', 'sestava vazba zarovnat "Horní F" +X "Deska F" +X', 'sestava vazba zarovnat "Horní F" +Y "Deska F" +Y',
    'sestava vazba zámek "Razník F" "Horní F"', 'sestava vazba zámek "Držák F" "Horní F" název "NESENÍ"', 'sestava vazba vzdálenost "Držák F" spodní "Plech F" horní hodnota 30 název "MEZERA"', 'sestava vazba "MEZERA" potlačit',
    'pohyb fáze "Nájezd"', 'pohyb fáze "Sevření" při vazba "MEZERA" <= 0 potlačit vazba "NESENÍ" zapnout vazba "MEZERA"', 'pohyb fáze "Střih" při vazba "ZDVIH" <= 40', 'pohyb fáze "Značení" při vazba "ZDVIH" <= 38', 'pohyb fáze "Návrat" při vazba "ZDVIH" >= 50 zapnout vazba "NESENÍ" potlačit vazba "MEZERA"',
    'pohyb motor lineární vazba "ZDVIH" 80..50..40..37 rychlost 50 prodleva 0,1 pak 80 rychlost 100 kroky 70',
  ].join('\n'));
  ok(/Fáze 5 „Návrat“: kroky \d+–70 · t = 1,09–1,39 s/.test(log) && !/^✗/m.test(log), `bod 3: cyklus v jedné studii, 5 fází – ${line(log, /Fáze 5 „Návrat“/)}`);
  await openPanel();
  await waitState('ok', 60000);
  const bands = mp.locator('[data-phase-band]');
  ok((await bands.count()) === 5, `bod 3: pásy fází na časové ose – ${await bands.count()}`);
  await bands.nth(1).click();
  await p.waitForTimeout(300);
  ok((await mp.locator('[data-motion-step-phase="2"]').count()) === 1, `bod 3: klik na pás „Sevření“ = první krok fáze 2 – ${await txt('[data-motion-step]')}`);
  ok((await mp.locator('[data-phase-row]').count()) === 5, 'bod 3: seznam fází v panelu');
  // pořadí: Střih o místo dolů a zpět (skutečné klíky)
  await mp.locator('[data-phase-down="3"]').click();
  await p.waitForTimeout(300);
  let ph = ((await getDoc()).motion?.phases || []).map((x) => x.name).join(',');
  ok(ph === 'Nájezd,Sevření,Značení,Střih,Návrat', `bod 3: posun fáze dolů – ${ph}`);
  await mp.locator('[data-phase-up="4"]').click();
  await p.waitForTimeout(300);
  ph = ((await getDoc()).motion?.phases || []).map((x) => x.name).join(',');
  ok(ph === 'Nájezd,Sevření,Střih,Značení,Návrat', `bod 3: posun zpět nahoru – ${ph}`);
  // nová fáze formulářem: název, začátek v čase, uložit → v dokumentu; smazat
  await mp.locator('[data-phase-new]').click();
  await mp.locator('[data-phase-name]').fill('Kontrola');
  await mp.locator('[data-phase-start]').selectOption('time');
  const tIn = mp.locator('[data-phase-form] input[aria-label="Čas začátku"]');
  await tIn.fill('1,3'); await tIn.press('Enter');
  await mp.locator('[data-phase-save]').click();
  await p.waitForTimeout(300);
  const added = ((await getDoc()).motion?.phases || []).find((x) => x.name === 'Kontrola');
  ok(!!added && added.start && Math.abs(added.start.t - 1.3) < 1e-9, `bod 3: nová fáze z panelu – ${JSON.stringify(added)}`);
  await mp.locator('[data-phase-remove="6"]').click();
  await p.waitForTimeout(300);
  ok(((await getDoc()).motion?.phases || []).length === 5, 'bod 3: smazání fáze z panelu');
  // motor: Upravit motor 1 – úseky v tabulce, zvýraznění poháněných dílů a osa se šipkou (WebGL i bez WebGL)
  await mp.locator('[data-motor-edit="1"]').click();
  ok((await mp.locator('[data-motor-form="edit"]').count()) === 1 && (await mp.locator('[data-motor-legs]').getAttribute('data-motor-legs')) === '5', `bod 3/10: Upravit motor 1 – ${await mp.locator('[data-motor-legs]').getAttribute('data-motor-legs').catch(() => '?')} úseků`);
  const main = p.locator('main[data-doc-key]');
  let hlN = null;
  for (let i = 0; i < 60 && !hlN; i++) { hlN = await main.getAttribute('data-motor-highlight'); if (!hlN) await p.waitForTimeout(200); }
  ok(hlN === '3' && /ZDVIH ↓/.test((await main.getAttribute('data-motor-axis')) || ''), `bod 10: zvýrazněno ${hlN} komponent (deska + razník + držák zámkem), osa „${await main.getAttribute('data-motor-axis')}“`);
  ok(/pohání: „Horní F“ \+ 2 díly – spolu s ním kvůli pevné vazbě \(zámku\)/.test(await txt('[data-motor-reach]')), `bod 10: panel vysvětlí díly spojené zámkem – ${(await txt('[data-motor-reach]')).slice(0, 120)}`);
  if (NOGL) {
    const lab = p.locator('[data-soft-measure-label]');
    ok((await lab.count()) >= 1 && /ZDVIH/.test((await lab.first().getAttribute('data-soft-measure-label')) || ''), `bod 10 bez WebGL: osa a popisek motoru v softwarovém náhledu – ${await lab.first().getAttribute('data-soft-measure-label').catch(() => '?')}`);
  }
  if (SHOTS) await p.screenshot({ path: SHOTS + `w22-m3-motor-axis${NOGL ? '-nogl' : ''}.png` });
  await mp.locator('[data-motor-cancel]').click();
  await p.waitForTimeout(300);
  ok((await main.getAttribute('data-motor-highlight')) === null, 'bod 10: Zrušit = zvýraznění zmizí');
  // nový motor na téže vazbě se stejným začátkem → ⚠ nahradí + „Navázat úsek“
  await mp.locator('[data-motor-new]').click();
  await mp.locator('[data-motor-kind="linear"]').click();
  await mp.locator('[data-motor-mate]').selectOption({ index: 0 });
  await p.waitForTimeout(300);
  ok((await mp.locator('[data-motor-same="1"]').count()) === 1 && /Nahradit motor 1/.test(await txt('[data-motor-save]')), `bod 10: nový motor na vazbě s motorem = ⚠ nahradí (ne potichu) – ${(await txt('[data-motor-same]')).slice(0, 90)}`);
  await mp.locator('[data-motor-append="1"]').click();
  await p.waitForTimeout(200);
  ok((await mp.locator('[data-motor-form="edit"]').count()) === 1 && (await mp.locator('[data-motor-legs]').getAttribute('data-motor-legs')) === '6', 'bod 3: Navázat úsek → úprava motoru 1 s dalším úsekem');
  await mp.locator('[data-motor-cancel]').click();
  // souhrn po tuhých skupinách, detail po dílech přepínačem
  ok((await mp.locator('[data-motion-summary]').getAttribute('data-motion-summary-mode')) === 'groups' && /„Horní F“ \+ 1 díl \(tuhá skupina – zámek \/ pevné vazby\): ΔZ −43 mm/.test(await txt('[data-motion-summary]')) && !/rozsah pohybu/.test(await txt('[data-motion-summary]')), `bod 15: souhrn po skupinách – ${(await txt('[data-motion-summary]')).slice(0, 160)}`);
  await mp.locator('[data-motion-detail]').check();
  ok(/Razník F: rozsah pohybu/.test(await txt('[data-motion-summary]')), 'bod 15: Detail po dílech na vyžádání');
  await mp.locator('[data-motion-detail]').uncheck();
  // konflikt motorů při definici v panelu (VEDENÍ × ZDVIH)
  log = await run(['nový díl "Vodítko G"', 'válec 20 120', 'nový díl "Držák G"', 'kvádr 60 60 8', 'díra 20 skrz v 30 30'].join('\n'));
  log += await run(['nová sestava "Vedení G"', 'vložit "Deska F" ukotvit', 'vložit "Vodítko G" v 50 50 -20', 'sestava vazba ukotvit "Vodítko G"', 'vložit "Držák G" v 20 20 67,5',
    'sestava vazba souosost "Držák G" Ø20 "Vodítko G" válcová název "VEDENÍ"', 'sestava vazba vzdálenost "Držák G" spodní "Deska F" horní hodnota 47,5 název "ZDVIH"', 'pohyb motor lineární vazba "ZDVIH" 47,5..27,15 kroky 4'].join('\n'));
  await openPanel();
  await mp.locator('[data-motor-new]').click();
  await mp.locator('[data-motor-kind="linear"]').click();
  // kolo 7 (bod 10): nabídka vazeb ve dvou skupinách – hodnota vazby (hlavní zdvih, předvybraná) × vedení; vazba s motorem to řekne
  const gVal = await mp.locator('[data-motor-mate] optgroup[data-motor-mate-group="value"] option').allInnerTexts();
  const gGuide = await mp.locator('[data-motor-mate] optgroup[data-motor-mate-group="guide"] option').allInnerTexts();
  const pre = await mp.locator('[data-motor-mate]').evaluate((s) => s.options[s.selectedIndex]?.text || '');
  ok(gVal.length === 1 && /ZDVIH.* – pohání motor 1/.test(gVal[0]) && gGuide.length === 1 && /VEDENÍ/.test(gGuide[0]) && /ZDVIH/.test(pre), `bod 10 (kolo 7): skupiny vazeb motoru – hodnota [${gVal.join(' | ')}] · vedení [${gGuide.join(' | ')}] · předvybráno „${pre}“`);
  const vOpt = (await mp.locator('[data-motor-mate] option').allInnerTexts()).find((o) => /VEDENÍ/.test(o));
  if (vOpt) await mp.locator('[data-motor-mate]').selectOption({ label: vOpt });
  let conf = 0;
  for (let i = 0; i < 60 && !conf; i++) { conf = await mp.locator('[data-motor-conflict="same-dof"]').count(); if (!conf) await p.waitForTimeout(200); }
  ok(conf === 1, `bod 10: ⚠ druhý motor na tomtéž stupni volnosti už ve formuláři – ${(await txt('[data-motor-conflict]')).slice(0, 120)}`);
  await mp.locator('[data-motor-cancel]').click().catch(() => {});
  ok(errs.length === 0, 'M3: bez chyb stránky' + (errs.length ? ': ' + errs.slice(0, 2).join(' | ') : ''));

  // ── fáze 2, kolo 4 (bod 20 – pružina): dosedací plocha pružiny po změně dílu v seznamu vazeb a v panelu pružiny ──
  // díl změněn v záložce, GUI „Obnovit z dílu“ (skutečný klik) = týž příkaz jako sestava hotovo: ztracená reference, nic se nepřichytí jinam
  log = await run(['nový díl "Deska S"', 'kvádr 60 40 10', 'kvádr 20 40 5 v 0 0 5 odebrat', 'nový díl "Držák S"', 'kvádr 10 10 10', 'nový díl "Pružina S"', 'pružina tlačná d 1 De 8 L0 30 n 6 konce broušené',
    'nová sestava "Sestava S"', 'vložit "Deska S" ukotvit', 'vložit "Držák S" v 5 15 30', 'vložit "Pružina S" v 10 20 5',
    'sestava vazba vzdálenost "Držák S" F5 "Deska S" F3 hodnota 25', 'sestava pružina "Pružina S" mezi "Deska S" F3 "Držák S" F5 volná 30 blok 8 tuhost 2'].join('\n'));
  ok(/^✓ (L\d+ )?pružina „Pružina S“: délka 25 mm/m.test(log) && !/^✗/m.test(log), `kolo 4: sestava s pružinou na schodu F3 – ${line(log, /pružina „Pružina S“: délka/)}${/^✗/m.test(log) ? ` · ✗: ${line(log, /^✗/)}` : ''}`);
  const springSel = () => p.evaluate(() => { const l = document.querySelector('[data-mates-list]'); const r = document.querySelector('[data-mate-spring]'); return { lost: l?.getAttribute('data-mates-lost'), springs: l?.getAttribute('data-springs-lost'), st: r?.getAttribute('data-mate-status'), side: r?.getAttribute('data-mate-lost'), text: r?.innerText || '' }; });
  ok((await springSel()).springs === '0' && (await p.locator('[data-mate-spring]').count()) === 0, 'kolo 4: před změnou dílu žádný řádek ztracené pružiny');
  await run('záložka "Deska S"');
  const featS = ((await getDoc()).features || []).map((f) => f.name);
  await run(`smazat "${featS[1]}"\nzáložka "Sestava S"`);
  await p.waitForFunction(() => window.mncad.getDocument().name === 'Sestava S', null, { timeout: 15000 });
  const treeRowS = (name) => p.locator('aside div.group').filter({ has: p.locator('span', { hasText: new RegExp(`^${name}$`) }) }).first();
  await treeRowS('Deska S').click();
  const refreshBtn = p.locator('[data-refresh-btn="all"]').first();
  ok(await refreshBtn.waitFor({ timeout: 20000 }).then(() => true, () => false), 'kolo 4: panel komponenty „Kopie je starší než díl“ s tlačítkem Obnovit z dílu');
  await refreshBtn.click();
  const lostShown = await p.waitForFunction(() => document.querySelector('[data-mates-list]')?.getAttribute('data-springs-lost') === '1', null, { timeout: 60000 }).then(() => true, () => false);
  const sp1 = await springSel();
  ok(lostShown && sp1.lost === '2' && sp1.st === 'lost' && sp1.side === 'a', `kolo 4: po „Obnovit z dílu“ seznam vazeb ukazuje pružinu se ztracenou dosedací plochou A (ztracených ${sp1.lost}, pružin ${sp1.springs}, stav ${sp1.st}, strana ${sp1.side})`);
  ok(/Pružina „Pružina S“/.test(sp1.text) && /A: dosedací plocha F3 dílu „Deska S“ – po úpravě dílu neexistuje/.test(sp1.text), `kolo 4: řádek pružiny říká, která plocha chybí – ${sp1.text.replace(/\n/g, ' | ').slice(0, 200)}`);
  ok((await p.locator('[data-mates-list] [data-mate-status="ok"]').count()) === 0, 'kolo 4: v seznamu vazeb nic zeleně (vazba i pružina ztracené)');
  const holderS = (await getDoc()).components.find((c) => c.name === 'Držák S').placement;
  ok(JSON.stringify(holderS.position) === '[5,15,30]' && holderS.rotation.every((x) => Math.abs(x) < 1e-9), `kolo 4: Držák se nepohnul ani nenatočil (${JSON.stringify(holderS)}) – dřív vazba přichycená na boční plochu −Y, natočení 90°`);
  ok(((await getDoc()).components.find((c) => c.name === 'Pružina S').spring?.a?.lost?.why) === 'none', 'kolo 4: dokument nese ztracenou referenci dosedací plochy A (otisk)');
  // kolo 5 (oponent): ztracená dosedací plocha pružiny je i ve strojových řádcích (= status, D, Σ), ne jen v lidském „Pružiny:“
  const shS = String(await p.evaluate(() => window.mncad.run('stav', { protocol: 'short' })));
  // (řádek D / Σ nese jen hlavní dokument běhu = poslední sestava záložek – to je níže Sestava R; tady stav aktivní sestavy)
  ok(/^= L\d+ status "Sestava S" asm .*\bmates=0\/1\(lost=1\).*\bsprings\.lost=1\b/m.test(shS), `kolo 5: stav (stručný protokol) „Sestava S“ nese springs.lost=1 vedle mates=0/1(lost=1) – ${line(shS, /^= L\d+ status/)}`);
  if (SHOTS) await p.screenshot({ path: SHOTS + `w22-m-r4-spring-lost${NOGL ? '-nogl' : ''}.png` });
  // klik „Zadat dosedací plochy znovu“ → panel pružiny: ✗ bez délky a síly, žádné ✓
  await p.locator('[data-spring-fix]').first().click();
  const lostPanel = p.locator('[data-asm-spring-lost]');
  ok(await lostPanel.waitFor({ timeout: 15000 }).then(() => true, () => false), 'kolo 4: klik na řádek pružiny otevře panel pružiny se ztracenou plochou');
  const lp = (await lostPanel.innerText().catch(() => '')).trim();
  ok(/^✗/.test(lp) && /dosedací plocha F3 dílu „Deska S“/.test(lp) && !/délka 25|F 10 N|✓/.test(lp), `kolo 4: panel pružiny ✗ bez uložené délky – ${lp.replace(/\n/g, ' | ').slice(0, 220)}`);
  // oprava: vazba na horní plochu textem, pružina tlačítkem Upravit pružinu (nejbližší kolmá plocha) → ✓ z nových ploch
  await run('sestava vazba 1 plocha b F6');
  await p.locator('[data-asm-spring-apply]').first().click();
  const fixed = await p.waitForFunction(() => document.querySelector('[data-mates-list]')?.getAttribute('data-springs-lost') === '0', null, { timeout: 60000 }).then(() => true, () => false);
  ok(fixed && (await p.locator('[data-mate-spring]').count()) === 0 && (await p.locator('[data-asm-spring-lost]').count()) === 0, 'kolo 4: Upravit pružinu → řádek ztracené pružiny zmizí');
  const spS = (await getDoc()).components.find((c) => c.name === 'Pružina S').spring;
  ok(spS && !spS.a.lost && spS.a.face === 5 && Math.abs((spS.length ?? 0) - 25) < 1e-6, `kolo 4: nové dosedací plochy F6 → F5, délka 25 mm (${JSON.stringify({ a: spS?.a, len: spS?.length })})`);
  const stS = (await p.locator('[data-asm-spring-state]').first().innerText().catch(() => '')).trim();
  ok(/^✓ délka 25 mm/.test(stS), `kolo 4: panel pružiny po opravě ✓ – ${stS}`);
  // kolo 5: jen pružina (bez vazby) se ztracenou dosedací plochou po sestava hotovo – strojové řádky bez falešné zelené, pak
  // „Odebrat pružinu“ v seznamu vazeb = tentýž textový příkaz jako panel pružiny (✓ pružina odebrána v hlášce, ne tichá změna)
  await run(['nový díl "Deska R"', 'kvádr 60 40 10', 'kvádr 20 40 5 v 0 0 5 odebrat', 'nový díl "Držák R"', 'kvádr 10 10 10', 'nový díl "Pružina R"', 'pružina tlačná d 1 De 8 L0 30 n 6 konce broušené'].join('\n'));
  await run('záložka "Deska R"');
  const featR = ((await getDoc()).features || []).map((f) => f.name);
  const logR = await run(['nová sestava "Sestava R"', 'vložit "Deska R" ukotvit', 'vložit "Držák R" v 5 15 30', 'vložit "Pružina R" v 10 20 5', 'sestava pružina "Pružina R" mezi "Deska R" F3 "Držák R" F5 volná 30 blok 8 tuhost 2',
    'sestava upravit "Deska R"', `smazat "${featR[1]}"`, 'sestava hotovo'].join('\n'));
  ok(featR.length === 2 && /^✗ .*pružina „Pružina R“.*ztracená reference/m.test(logR) && !/^✓ „Deska R“ vrácen/m.test(logR), `kolo 5: sestava hotovo – ✗ ztracená dosedací plocha pružiny, bez ✓ návratu – ${line(logR, /pružina „Pružina R“.*ztracená/)}`);
  const shR = String(await p.evaluate(() => window.mncad.run('stav', { protocol: 'short' })));
  const dR = line(shR, /^D "Sestava R"/);
  ok(/\bsprings\.lost=1\b/.test(dR) && !/\bmates=/.test(dR) && /^= L\d+ status "Sestava R" asm .*\bsprings\.lost=1\b/m.test(shR) && /^Σ .*\bcomp=3\b.*\bsprings\.lost=1\b/m.test(shR), `kolo 5: jen pružina – D, = status i Σ nesou springs.lost=1 (dřív čistý řádek bez značky) – ${dR} · ${line(shR, /^Σ/)}`);
  await p.waitForFunction(() => document.querySelector('[data-mates-list]')?.getAttribute('data-springs-lost') === '1', null, { timeout: 30000 }).catch(() => {});
  const rmBtn = p.locator('[data-spring-remove]').first();
  ok(await rmBtn.waitFor({ timeout: 20000 }).then(() => true, () => false), 'kolo 5: seznam vazeb sestavy bez vazeb ukazuje ztracenou pružinu s tlačítkem Odebrat pružinu');
  await rmBtn.click();
  const removedNote = await p.waitForFunction(() => /✓ pružina odebrána: „Pružina R“/.test(document.body.innerText), null, { timeout: 30000 }).then(() => true, () => false);
  const compR = (await getDoc()).components.find((c) => c.name === 'Pružina R');
  ok(removedNote && compR && !compR.spring && (await p.locator('[data-mate-spring]').count()) === 0, `kolo 5: „Odebrat pružinu“ jde textovým příkazem (hláška ✓ pružina odebrána ${removedNote ? 'ano' : 'ne'}), pružina bez definice, komponenta zůstává`);
  ok(errs.length === 0, 'kolo 4: bez chyb stránky' + (errs.length ? ': ' + errs.slice(0, 2).join(' | ') : ''));

  // ── kolo 7 (bod 8, oponent kola 7): dynamika s „na mezi chyba“ – souhrn a graf jen z platných kroků ──
  {
    const o = await open(b, '/cad');
    const r2 = async (t) => String(await o.p.evaluate((x) => window.mncad.run(x), t));
    await r2(['nový díl "Rám"', 'kvádr 100 100 10', 'nový díl "Deska A"', 'kvádr 100 100 10', 'nový díl "Přidržovač"', 'kvádr 60 60 8'].join('\n'));
    const l2 = await r2(['nová sestava "Mechanika"', 'vložit "Rám" ukotvit', 'vložit "Deska A" v 0 0 67.5', 'vložit "Přidržovač" v 0 0 34.5', 'sestava vazba vzdálenost "Deska A" spodní "Rám" horní hodnota 57.5 název "ZDVIH"', 'sestava vazba vzdálenost "Přidržovač" spodní "Rám" horní hodnota 24.5 název "PEVNÁ"', 'sestava vazba mez-vzdálenosti "Přidržovač" horní "Deska A" spodní min 5 max 25 název "Mez"', 'pohyb dynamika čas 2 krok 0.002 snímky 12', 'pohyb motor lineární vazba "ZDVIH" 57.5..27.15 rychlost 30.35 na mezi chyba'].join('\n'));
    const dz = (/„Deska A“: ΔZ −([\d,]+) mm/.exec(l2) || [])[1];
    const st = (/„Deska A“ [\d,]+ kg \([^)]*\): zdvih Z ([\d,]+) mm/.exec(l2) || [])[1];
    ok(dz && dz === st && /⚠ neplatné kroky 4–12 /.test(l2) && !/\(min 5 mm\): dotyk [\d,]+–2 s/.test(l2), `bod 8 (kolo 7): protokol dynamiky – zdvih Z ${st} mm = ΔZ −${dz} mm, ⚠ neplatné kroky, dotyk dorazu nekončí v 2 s`);
    const pan = o.p.locator('[data-motion-panel]');
    const shown = await pan.waitFor({ timeout: 30000 }).then(() => true, () => false);
    if (shown && !(await pan.locator('[data-motion-chart]').isVisible().catch(() => false))) await pan.locator('[data-motion-run]').click().catch(() => {});
    const chart = shown && (await pan.locator('[data-motion-chart]').waitFor({ timeout: 180000 }).then(() => true, () => false));
    const gaps = chart ? Number(await pan.locator('[data-motion-chart]').getAttribute('data-motion-chart-gaps')) : -1;
    const sum = shown ? await pan.locator('[data-motion-summary]').innerText({ timeout: 5000 }).catch(() => '') : '';
    ok(chart && gaps >= 9 && /neplatné kroky 4–12/.test(sum) && new RegExp(`zdvih Z ${dz} mm`).test(sum), `bod 8 (kolo 7): panel – graf bez hodnot v neplatných krocích (${gaps} mezer), souhrn „neplatné kroky 4–12“ a zdvih ${dz} mm`);
    if (SHOTS) await o.p.screenshot({ path: SHOTS + `w22-m-r7-dyn-invalid${NOGL ? '-nogl' : ''}.png` });
    await o.ctx.close();
  }

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
