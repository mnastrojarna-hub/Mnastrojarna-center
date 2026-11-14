// E2E „jako člověk“: díl namodelovaný výhradně myší a klávesnicí v běžném UI (pás karet, skica, formuláře prvků,
// výběr ploch a hran přes popisky F1 / E2) – bez textových příkazů a bez JSON. Textový stav se čte jen pro ověření.
// Spuštění (server na :3100): node e2e/cad-human.e2e.cjs <složka>
const { chromium } = require('playwright');
const fs = require('fs');
const S = (process.argv[2] || '/tmp/e2e').replace(/\/?$/, '/');
fs.mkdirSync(S, { recursive: true });
const ok = (c, m) => { console.log((c ? 'ok: ' : 'FAIL: ') + m); if (!c) process.exitCode = 1; };
const CAD = (process.env.E2E_BASE || 'http://localhost:3100') + '/cad';
const status = (p) => p.evaluate(() => window.mncad.status());
const volumeOf = (st) => parseFloat(((st.match(/objem ([\d,]+) cm³/) || [, '0'])[1]).replace(',', '.'));
/** střed štítku podle predikátu nad jeho popisem (title) – klik tam = klik na entitu */
const hintCenter = async (p, pred) => {
  const list = await p.evaluate(() => [...document.querySelectorAll('[data-hint]')].map((el) => { const r = el.getBoundingClientRect(); return { id: el.dataset.hint, kind: el.dataset.kind, title: el.title, x: r.left + r.width / 2, y: r.top + r.height / 2 }; }));
  return list.filter(pred);
};

(async () => {
  const b = await chromium.launch({ args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader'] });
  const p = await b.newPage({ viewport: { width: 1600, height: 950 } });
  const errs = []; p.on('pageerror', (e) => errs.push(e.message));
  await p.goto(CAD, { waitUntil: 'networkidle', timeout: 180000 });
  // úvodní obrazovka: Nový díl klikem
  const start = p.locator('div.fixed.z-\\[65\\]');
  if (await start.isVisible({ timeout: 6000 }).catch(() => false)) await start.getByRole('button', { name: /Nový díl/ }).first().click();
  await p.waitForFunction(() => document.body.innerText.includes('OCCT') && !document.body.innerText.includes('Načítám jádro'), null, { timeout: 120000 });
  await p.waitForTimeout(800);

  // ── skica obdélníku myší: Tvorba → Skica → Rovina XY → obdélník (klávesa r) dva kliky ──
  await p.getByRole('button', { name: 'Tvorba', exact: true }).click();
  await p.getByRole('button', { name: /^Skica/ }).first().click();
  await p.getByRole('button', { name: /Rovina XY/ }).click();
  await p.waitForTimeout(800);
  // popisky zapnuté klávesou – ve skice štítek O v počátku
  await p.keyboard.press('Control+Shift+L'); await p.waitForTimeout(500);
  const origin = await p.locator('[data-sketch-hint="O"]').boundingBox().catch(() => null);
  ok(!!origin, 'skica: popisek O v počátku je vidět');
  await p.keyboard.press('r');
  const cx = origin ? origin.x + origin.width / 2 : 800;
  const cy = origin ? origin.y + origin.height / 2 : 500;
  await p.mouse.click(cx, cy);           // 1. roh v počátku
  await p.keyboard.type('100'); await p.keyboard.press('Tab'); await p.keyboard.type('60'); await p.keyboard.press('Enter'); // rozměry číselně
  await p.waitForFunction(() => document.querySelectorAll('[data-sketch-hint]').length >= 5, null, { timeout: 8000 }).catch(() => {});
  const pts = await p.locator('[data-sketch-hint]').count();
  ok(pts >= 3, `skica: obdélník má štítky bodů (${pts} viditelných – střed, rohy, počátek)`);
  await p.screenshot({ path: S + 'human-sketch.png' });
  await p.getByRole('button', { name: /Dokončit skicu/ }).click();
  await p.waitForTimeout(1500);
  ok((await p.locator('text=/Vysunutí \\d/').count()) > 0, 'po skice se nabídlo vysunutí');
  // výška vysunutí: první číselné pole formuláře
  const dist = p.getByLabel(/^(Výška|Vzdálenost|Hloubka)/).first();
  await dist.fill('20'); await p.keyboard.press('Enter'); await p.waitForTimeout(1800);
  let st = await status(p);
  ok(/Rozměry: 100 × 60 × 20 mm/.test(st), 'vysunutí 100 × 60 × 20 mm (skica myší + číselné zadání)\n' + (st.match(/Rozměry[^\n]*/) || [''])[0]);
  await p.screenshot({ path: S + 'human-extrude.png' });

  // ── díra: pás Tvorba → Díra → klik na štítek horní plochy (normála +Z) → Enter ──
  await p.waitForTimeout(600);
  let faces = await hintCenter(p, (h) => h.kind === 'face' && /normála \+Z/.test(h.title));
  ok(faces.length === 1, `popisky: horní plocha má štítek s normálou +Z (${faces.map((f) => f.id).join(',')})`);
  await p.getByRole('button', { name: 'Díra', exact: true }).first().click(); await p.waitForTimeout(600);
  faces = await hintCenter(p, (h) => h.kind === 'face' && /normála \+Z/.test(h.title)); // štítky se po otevření formuláře přepočítají (užší 3D okno)
  await p.mouse.click(faces[0].x, faces[0].y); await p.waitForTimeout(800);
  await p.keyboard.press('Enter'); await p.waitForTimeout(1800);
  st = await status(p);
  ok(/Díra 1 \[hole/.test(st) && !/✗/.test(st.split('Prvky:')[1] || ''), 'díra vložena klikem na štítek plochy\n' + (st.match(/Díra 1[^\n]*/) || [''])[0]);
  const volHole = volumeOf(st);
  ok(volHole < 120, `objem po díře ${volHole} cm³ (< 120)`);

  // ── zaoblení: Zaoblit → klik na 4 svislé hrany přes štítky (Ctrl = přidat) → poloměr → Enter ──
  await p.waitForTimeout(600);
  let edges = await hintCenter(p, (h) => h.kind === 'edge' && /svislá úsečka/.test(h.title));
  ok(edges.length >= 2, `popisky: svislé hrany mají štítky (${edges.length} viditelných)`);
  await p.getByRole('button', { name: 'Zaoblit', exact: true }).first().click(); await p.waitForTimeout(600);
  edges = await hintCenter(p, (h) => h.kind === 'edge' && /svislá úsečka/.test(h.title));
  const picked = [];
  for (let i = 0; i < Math.min(2, edges.length); i++) {
    await p.mouse.click(edges[i].x, edges[i].y); await p.waitForTimeout(500); // klik na štítek hrany = klik na hranu (přidá do výběru)
    picked.push(((await p.locator('body').innerText()).match(/(\d+) hran vybráno/) || [, '?'])[1]);
  }
  ok(picked[picked.length - 1] === '2', `formulář zaoblení hlásí 2 vybrané hrany (po klicích: ${picked.join(' → ')}; štítky ${edges.slice(0, 2).map((e) => `${e.id}@${Math.round(e.x)},${Math.round(e.y)}`).join(' ')})`);
  const rad = p.getByLabel(/^Poloměr/).first();
  await rad.fill('5'); await p.keyboard.press('Enter'); await p.waitForTimeout(1800);
  st = await status(p);
  ok(/Zaoblení 1 \[fillet[^\n]*✓/.test(st), 'zaoblení hran vybraných přes štítky\n' + (st.match(/Zaoblení 1[^\n]*/) || [''])[0]);
  ok(volumeOf(st) < volHole, `objem po zaoblení ${volumeOf(st)} cm³ klesl`);
  await p.screenshot({ path: S + 'human-fillet.png' });

  // ── výběr podle štítku přes API (pro skripty) a klik Ctrl ──
  await p.keyboard.press('Escape'); await p.waitForTimeout(300);
  const list = await p.evaluate(() => window.mncad.hints());
  ok(list.length > 5 && list.every((h) => h.id && h.title && h.x > 0), `window.mncad.hints() vrací ${list.length} štítků se souřadnicemi`);
  await p.keyboard.press('Escape'); await p.waitForTimeout(400);
  faces = await hintCenter(p, (h) => h.kind === 'face' && /normála \+Z/.test(h.title));
  await p.mouse.click(faces[0].x, faces[0].y); await p.waitForTimeout(500);
  const selText = await p.locator('body').innerText();
  ok(/Vybráno: 1× plocha/.test(selText), 'klik na štítek horní plochy ji vybere (stavový řádek: Vybráno: 1× plocha)');
  const clicked = await p.evaluate(() => { const f = window.mncad.hints().find((h) => /normála \+Z/.test(h.title)); return f ? window.mncad.clickHint(f.id) : false; });
  await p.waitForTimeout(500);
  ok(clicked, 'window.mncad.clickHint našel štítek a odeslal klik stejnou cestou jako myš');
  // vypnutí popisků: člověk vidí totéž co dřív
  await p.keyboard.press('Control+Shift+L'); await p.waitForTimeout(300);
  ok((await p.locator('[data-hint]').count()) === 0, 'Ctrl+Shift+L popisky vypne – bez nich je obrazovka jako dřív');

  ok(errs.length === 0, 'bez JS chyb ' + errs.join(' | '));
  await b.close();
})().catch((e) => { console.error('ERR', e.message); process.exit(1); });
