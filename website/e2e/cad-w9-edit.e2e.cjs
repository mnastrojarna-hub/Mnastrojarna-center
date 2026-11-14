// E2E: 2D CAD – balík 1 edit (úpravy, vlna 9 fáze B): karta Úpravy, OŘÍZNOUT klikem (přesně na průsečíku),
// Shift + klik = prodloužit, ZAOBLIT s volbou Poloměr z příkazového řádku, POSUN s PICKFIRST z pásu a s uchopením,
// zpět = jeden krok, táhnutí úchopu s uchopením na koncový bod, klik na úchop → ÚCHOP (mezera = další režim),
// Esc zruší táhnutí, textové příkazy přes window.mncad.draft (pole, ekvidistanta, zamčená hladina, EN / DE názvy).
// Spuštění (server na :3381): E2E_BASE=http://localhost:3381 node e2e/cad-w9-edit.e2e.cjs <složka>
const { chromium } = require('playwright');
const fs = require('fs');
const S = (process.argv[2] || '/tmp/e2e').replace(/\/?$/, '/');
fs.mkdirSync(S, { recursive: true });
const ok = (c, m) => { console.log((c ? 'ok: ' : 'FAIL: ') + m); if (!c) process.exitCode = 1; };
const BASE = (process.env.E2E_BASE || 'http://localhost:3381').replace(/\/$/, '');
const near = (a, b, eps = 1e-9) => Math.abs(a - b) <= eps;
const P = (q, x, y, eps = 1e-9) => !!q && near(q[0], x, eps) && near(q[1], y, eps);

(async () => {
  const b = await chromium.launch({ args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader'] });
  const ctx = await b.newContext({ viewport: { width: 1430, height: 880 } });
  const p = await ctx.newPage();
  const errs = []; p.on('pageerror', (e) => errs.push(e.message));
  const cerrs = []; p.on('console', (m) => { if (m.type() === 'error') cerrs.push(m.text().slice(0, 400)); });
  await p.goto(BASE + '/cad', { waitUntil: 'networkidle', timeout: 240000 });
  await p.waitForFunction(() => !!window.mncad, null, { timeout: 180000 });
  const c = p.getByText('Pokračovat v práci');
  if (await c.isVisible({ timeout: 5000 }).catch(() => false)) await c.click();
  await p.keyboard.press('Escape');
  await p.waitForTimeout(500);
  const doc = () => p.evaluate(() => window.mncad.getDocument());
  const ents = async () => (await doc()).draft.entities;
  const ent = async (id) => (await ents()).find((e) => e.id === id);
  const prompt = async () => (await p.textContent('[data-draft-prompt]')) || '';

  // ── nový 2D výkres a výchozí geometrie textem ──
  await p.getByRole('button', { name: 'Soubor', exact: true }).click();
  await p.getByText('Nový 2D výkres', { exact: true }).first().click();
  await p.waitForSelector('[data-draft-workspace]', { timeout: 90000 });
  await p.waitForTimeout(800);
  let r = await p.evaluate(() => window.mncad.draft('čára 0,0 100,0; čára 50,-30 50,30; čára 0,40 100,40; čára 0,20 30,20; zoom okno -20,-50 140,70'));
  ok(r.ok && r.status.entities === 4, `výchozí geometrie: 4 úsečky (${JSON.stringify(r.results.map((q) => [q.cmd, q.ok]))})`);
  await p.waitForTimeout(500);
  const box = await p.locator('[data-draft-canvas]').boundingBox();
  const scr = async (X, Y) => { const v = JSON.parse(await p.getAttribute('[data-draft-canvas]', 'data-view')); return [box.x + (X - v.cx) * v.scale + v.w / 2, box.y + v.h / 2 - (Y - v.cy) * v.scale]; };
  const click = async (X, Y) => { const [x, y] = await scr(X, Y); await p.mouse.move(x - 3, y + 3); await p.mouse.move(x, y); await p.waitForTimeout(120); await p.mouse.click(x, y); await p.waitForTimeout(200); };

  // ── karta Úpravy ──
  await p.locator('[data-draft-tab="modify"]').click();
  await p.waitForTimeout(300);
  const rb = (t) => p.locator('[data-draft-workspace] [data-ribbon] button').filter({ hasText: t }).first();
  const vis = [];
  for (const t of ['Posun', 'Kopie', 'Otočit', 'Zrcadlit', 'Oříznout', 'Zaoblit', 'Ekvidistanta', 'Obdélníkové', 'Polární', 'Přenést vlastnosti']) if (await rb(t).count()) vis.push(t);
  ok(vis.length === 10, `karta Úpravy: skupiny Upravit, Pole, Uspořádat (${vis.join(', ')})`);
  await p.screenshot({ path: S + 'w9-edit-ribbon.png' });

  // ── OŘÍZNOUT klikem: e1 na hraně e2 přesně ──
  await rb('Oříznout').click();
  await p.waitForTimeout(300);
  ok(/Oříznout objekt/.test(await prompt()), `OŘÍZNOUT z pásu: výzva „${await prompt()}“`);
  await click(80, 0);
  // během příkazu se ukazuje rozpracovaný výsledek, do dokumentu se zapíše až po Enter (jeden krok historie)
  let e1 = await ent('e1');
  ok(P(e1.b, 100, 0), 'během OŘÍZNOUT dokument ještě beze změny (zápis po skončení příkazu)');
  // Shift + klik = prodloužit e4 k hraně e2
  const [sx, sy] = await scr(27, 20);
  await p.mouse.move(sx, sy); await p.waitForTimeout(100);
  await p.keyboard.down('Shift');
  await p.mouse.click(sx, sy);
  await p.keyboard.up('Shift');
  await p.waitForTimeout(250);
  await p.keyboard.press('Enter');
  await p.waitForTimeout(400);
  e1 = await ent('e1');
  ok(P(e1.a, 0, 0) && P(e1.b, 50, 0), `klik na pravou část e1 → oříznuto přesně v 50,0 (${JSON.stringify([e1.a, e1.b])})`);
  const e4 = await ent('e4');
  ok(P(e4.b, 50, 20), `Shift + klik během OŘÍZNOUT prodlouží e4 přesně na 50,20 (${JSON.stringify(e4.b)})`);
  await p.screenshot({ path: S + 'w9-edit-trim.png' });

  // ── ZAOBLIT: příkazový řádek, volba Poloměr tlačítkem, dva kliky ──
  await p.keyboard.type('f');
  await p.keyboard.press('Space');
  await p.waitForTimeout(250);
  await p.locator('[data-kw="radius"]').first().click();
  await p.waitForTimeout(200);
  await p.keyboard.type('10'); await p.keyboard.press('Enter');
  await p.waitForTimeout(200);
  await click(20, 0);
  await click(50, -20);
  await p.waitForTimeout(300);
  let all = await ents();
  const arc = all.find((e) => e.type === 'arc');
  e1 = await ent('e1');
  const e2 = await ent('e2');
  ok(arc && near(arc.r, 10) && P(arc.c, 40, -10) && P(e1.b, 40, 0) && P(e2.b, 50, -10) && P(e2.a, 50, -30), `ZAOBLIT R10: oblouk se středem 40,-10, úsečky oříznuté na body dotyku (${JSON.stringify({ arc: arc && [arc.c, arc.r], e1: e1.b, e2: [e2.a, e2.b] })})`);

  // ── POSUN s PICKFIRST: výběr klikem, tlačítko pásu, uchopení koncového bodu, @0,10 ──
  await click(70, 40);
  ok((await p.evaluate(() => window.mncad.draft('stav'))).status.selection.length === 1, 'klik na e3 ji vybere');
  await rb('Posun').click();
  await p.waitForTimeout(300);
  ok(/základní bod/.test(await prompt()), `POSUN s výběrem přeskočí výběr (PICKFIRST): „${await prompt()}“`);
  await click(100.7, 40.6);
  await p.keyboard.type('@0,10'); await p.keyboard.press('Enter');
  await p.waitForTimeout(400);
  let e3 = await ent('e3');
  ok(P(e3.a, 0, 50) && P(e3.b, 100, 50), `posun o @0,10 z uchopeného koncového bodu (${JSON.stringify([e3.a, e3.b])})`);
  await p.evaluate(() => window.mncad.run('2d zpět'));
  await p.waitForTimeout(500);
  e3 = await ent('e3');
  ok(P(e3.a, 0, 40) && P(e3.b, 100, 40), 'zpět vrátí celý POSUN jedním krokem');

  // ── úchopy: táhnutí koncového úchopu s uchopením na konec e4 ──
  await click(70, 40);
  let [gx, gy] = await scr(100, 40);
  await p.mouse.move(gx + 3, gy + 3); await p.mouse.move(gx, gy); await p.waitForTimeout(200);
  await p.screenshot({ path: S + 'w9-edit-grip-hover.png' });
  await p.mouse.down();
  const [tx, ty] = await scr(50.4, 20.5);
  for (let i = 1; i <= 8; i++) { await p.mouse.move(gx + ((tx - gx) * i) / 8, gy + ((ty - gy) * i) / 8); await p.waitForTimeout(40); }
  await p.waitForTimeout(150);
  await p.screenshot({ path: S + 'w9-edit-grip-drag.png' });
  await p.mouse.up();
  await p.waitForTimeout(600);
  e3 = await ent('e3');
  ok(P(e3.a, 0, 40) && P(e3.b, 50, 20), `táhnutí úchopu: konec e3 přesně na koncový bod e4 50,20 (${JSON.stringify([e3.a, e3.b])})`);

  // ── klik na úchop → ÚCHOP: mezera = POSUN, @0,-5 ──
  [gx, gy] = await scr(0, 40);
  await p.mouse.move(gx + 2, gy + 2); await p.mouse.move(gx, gy); await p.waitForTimeout(200);
  await p.mouse.click(gx, gy);
  await p.waitForTimeout(400);
  const pr1 = await prompt();
  await p.keyboard.press('Space');
  await p.waitForTimeout(250);
  const pr2 = await prompt();
  ok(/PROTÁHNOUT/.test(pr1) && /POSUN/.test(pr2), `klik na úchop: „${pr1}“ → mezera → „${pr2}“`);
  await p.keyboard.type('@0,-5'); await p.keyboard.press('Enter');
  await p.waitForTimeout(400);
  e3 = await ent('e3');
  ok(P(e3.a, 0, 35) && P(e3.b, 50, 15), `úchop v režimu POSUN o @0,-5 (${JSON.stringify([e3.a, e3.b])})`);

  // ── Esc zruší táhnutí úchopu ──
  const before = JSON.stringify(await ent('e3'));
  [gx, gy] = await scr(0, 35);
  await p.mouse.move(gx + 2, gy + 2); await p.mouse.move(gx, gy); await p.waitForTimeout(150);
  await p.mouse.down();
  await p.mouse.move(gx + 40, gy - 40, { steps: 5 });
  await p.keyboard.press('Escape');
  await p.mouse.up();
  await p.waitForTimeout(400);
  ok(JSON.stringify(await ent('e3')) === before, 'Esc během táhnutí úchopu – beze změny');
  await p.keyboard.press('Escape');

  // ── textové příkazy (agenti): pole, ekvidistanta, zamčená hladina, EN / DE ──
  r = await p.evaluate(() => window.mncad.draft('kružnice 100,-40 3; pole-polární poslední 80,-40 6 360 ano'));
  all = await ents();
  const circ = all.filter((e) => e.type === 'circle');
  const angs = circ.map((q) => ((Math.atan2(q.c[1] + 40, q.c[0] - 80) * 180) / Math.PI + 360) % 360).sort((a, b2) => a - b2);
  ok(r.ok && circ.length === 6 && angs.every((a, i) => near(a, i * 60, 1e-9)) && r.results[1].created.length === 5, `pole-polární 6×: úhly ${angs.map((a) => a.toFixed(6)).join(', ')}`);
  r = await p.evaluate(() => window.mncad.draft('ekvidistanta 5 e1 20,10'));
  const off = await ent(r.results[0].created[0]);
  ok(r.ok && off && P(off.a, 0, 5) && P(off.b, 40, 5), `ekvidistanta 5 textem (created ${JSON.stringify(r.results[0].created)})`);
  r = await p.evaluate(() => window.mncad.draft('hladina nová Z zamknout; vlastnosti e4 hladina Z; posun e4 e1 0,0 0,100'));
  const e4b = await ent('e4');
  ok(r.ok && P(e4b.a, 0, 20) && r.results[2].log.join(' ').includes('zamčené'), `zamčená hladina: e4 zůstane, protokol ⚠ (${r.results[2].log.join(' | ')})`);
  r = await p.evaluate(() => window.mncad.draft('move e1 0,0 0,-1; schieben e1 0,0 0,1; offset 1 e1 20,-5'));
  ok(r.ok && r.results.length === 3 && r.results[2].created.length === 1, 'anglické a německé názvy příkazů (move, schieben, offset)');
  const bad = await p.evaluate(() => window.mncad.draft('oříznout e99@1,1'));
  ok(!bad.ok && /e99/.test(bad.results[0].error), `chybné zadání: ok false s důvodem (${bad.results[0].error})`);
  // ── GUI: EKVIDISTANTA z příkazového řádku (vzdálenost 7, klik na objekt, klik na stranu, Enter) ──
  r = await p.evaluate(() => window.mncad.draft('vyber nic; čára 300,0 400,0; zoom okno 280,-120 420,60'));
  const L = r.results[1].created[0];
  await p.waitForTimeout(500);
  const n0 = (await ents()).length;
  await p.keyboard.type('o'); await p.keyboard.press('Space'); await p.waitForTimeout(250);
  await p.keyboard.type('7'); await p.keyboard.press('Enter'); await p.waitForTimeout(250);
  await click(350, 0);
  await click(350, 30);
  await p.keyboard.press('Enter'); await p.waitForTimeout(500);
  all = await ents();
  const off7 = all.find((e) => e.type === 'line' && P(e.a, 300, 7) && P(e.b, 400, 7));
  ok(all.length === n0 + 1 && !!off7, `EKVIDISTANTA v GUI: vzdálenost 7, klik na objekt a na stranu → úsečka 300,7–400,7 (${all.length - n0} nová)`);

  // ── GUI: KOPIE vícenásobná s PICKFIRST z pásu, dva cíle, Enter; Ctrl+Z vrátí obě kopie jedním krokem ──
  await click(330, 0);
  await rb('Kopie').click(); await p.waitForTimeout(300);
  ok(/základní bod/i.test(await prompt()), `KOPIE s výběrem: „${await prompt()}“`);
  await p.keyboard.type('300,0'); await p.keyboard.press('Enter'); await p.waitForTimeout(200);
  await p.keyboard.type('300,-20'); await p.keyboard.press('Enter'); await p.waitForTimeout(200);
  await p.keyboard.type('300,-40'); await p.keyboard.press('Enter'); await p.waitForTimeout(200);
  await p.keyboard.press('Enter'); await p.waitForTimeout(500);
  all = await ents();
  const cps = all.filter((e) => e.type === 'line' && (P(e.a, 300, -20) && P(e.b, 400, -20) || P(e.a, 300, -40) && P(e.b, 400, -40)));
  ok(cps.length === 2, `KOPIE vícenásobná: 2 kopie přesně o 0,-20 a 0,-40 (${cps.length})`);
  await p.evaluate(() => window.mncad.run('2d zpět'));
  await p.waitForTimeout(500);
  all = await ents();
  ok(all.filter((e) => e.type === 'line' && (P(e.a, 300, -20) || P(e.a, 300, -40))).length === 0 && all.length === n0 + 1, 'zpět odebere obě kopie jedním krokem');

  // ── úchop: klik na koncový úchop, mezera 2× (PROTÁHNOUT → POSUN → OTOČIT), úhel 90 ──
  await click(330, 0);
  [gx, gy] = await scr(400, 0);
  await p.mouse.move(gx + 2, gy + 2); await p.mouse.move(gx, gy); await p.waitForTimeout(200);
  await p.mouse.click(gx, gy); await p.waitForTimeout(400);
  await p.keyboard.press('Space'); await p.waitForTimeout(200);
  await p.keyboard.press('Space'); await p.waitForTimeout(250);
  const prRot = await prompt();
  await p.keyboard.type('90'); await p.keyboard.press('Enter'); await p.waitForTimeout(500);
  const Lr = await ent(L);
  ok(/OTOČIT/.test(prRot) && P(Lr.a, 400, -100, 1e-9) && P(Lr.b, 400, 0, 1e-9), `úchop: mezera 2× = OTOČIT „${prRot.slice(0, 40)}…“, 90° kolem úchopu → ${JSON.stringify([Lr.a, Lr.b])}`);
  await p.keyboard.press('Escape');

  // ── Pořadí ▾ → Dopředu BEZ výběru: volba přežije výzvu výběru (dřív „nadbytečné zadání _front“ a pak <back>) ──
  r = await p.evaluate(() => window.mncad.draft('vyber nic; čára 500,0 600,0; čára 500,5 600,5; čára 500,10 600,10; zoom okno 480,-20 620,30'));
  const [o1, o2, o3] = r.results.slice(1, 4).map((q) => q.created[0]);
  await p.waitForTimeout(500);
  await p.keyboard.press('Escape');
  await rb('Pořadí').click(); await p.waitForTimeout(250);
  await p.locator('[data-cad-menu]').getByText('Dopředu', { exact: true }).first().click(); await p.waitForTimeout(350);
  const prO = await prompt();
  const logO = (await p.textContent('[data-draft-log]')) || '';
  await click(550, 0);
  await p.keyboard.press('Enter'); await p.waitForTimeout(500);
  const ordIds = (await ents()).map((e) => e.id).filter((id) => [o1, o2, o3].includes(id));
  ok(ordIds.join() === [o2, o3, o1].join() && !/nadbytečné/.test(logO), `Pořadí ▾ → Dopředu bez výběru: výzva „${prO}“, po výběru a Enter pořadí ${ordIds.join(',')}`);

  // ── výzvy: volby jen jednou a všechna tlačítka voleb klikatelná při šířce 1430 px (TRIM / EXTEND Zpět, CHAMFER Oříznout/Metoda/Vícekrát) ──
  const kwHit = async (id) => {
    const loc = p.locator(`[data-draft-prompt] [data-kw="${id}"]`).first();
    if (!(await loc.count())) return false;
    const bb = await loc.boundingBox();
    if (!bb) return false;
    return p.evaluate(([x, y, k]) => { const el = document.elementFromPoint(x, y); return !!el && !!el.closest(`[data-kw="${k}"]`); }, [bb.x + bb.width / 2, bb.y + bb.height / 2, id]);
  };
  for (const [cmd, kws] of [['tr', ['cuttingedges', 'fence', 'crossing', 'mode', 'edge', 'erase', 'extend', 'undo']], ['ex', ['boundaryedges', 'fence', 'crossing', 'mode', 'edge', 'trim', 'undo']], ['cha', ['undo', 'polyline', 'distance', 'angle', 'trim', 'method', 'multiple']], ['f', ['undo', 'polyline', 'radius', 'trim', 'multiple']]]) {
    await p.keyboard.press('Escape');
    await p.locator('[data-draft-input]').click();
    await p.keyboard.type(cmd); await p.keyboard.press('Space'); await p.waitForTimeout(300);
    const t = await prompt();
    const hits = [];
    for (const k of kws) hits.push([k, await kwHit(k)]);
    const miss = hits.filter(([, h]) => !h).map(([k]) => k);
    ok((t.match(/\[/g) || []).length === 1 && !miss.length, `${cmd.toUpperCase()}: výzva s volbami jednou „${t}“, nekliknutelné: ${miss.join(', ') || 'žádné'}`);
  }
  await p.locator('[data-draft-prompt] [data-kw="undo"]').first().click({ timeout: 5000 }).then(() => ok(true, 'ZAOBLIT: klik na [Zpět] v příkazovém řádku projde (dřív „span intercepts pointer events“)'), (e) => ok(false, 'klik na [Zpět]: ' + e.message.slice(0, 120)));
  await p.keyboard.press('Escape');

  // ── výchozí volba v jazyce rozhraní: ZRCADLIT „<Ne>“, ne „<no>“ ──
  await p.evaluate((id) => window.mncad.draft('vyber ' + id), o1);
  await p.waitForTimeout(300);
  await p.locator('[data-draft-input]').click();
  await p.keyboard.type('mi'); await p.keyboard.press('Space'); await p.waitForTimeout(300);
  await p.keyboard.type('700,0'); await p.keyboard.press('Enter'); await p.waitForTimeout(200);
  await p.keyboard.type('700,10'); await p.keyboard.press('Enter'); await p.waitForTimeout(300);
  const prM = await prompt();
  const nM = (await ents()).length;
  await p.keyboard.press('Enter'); await p.waitForTimeout(500);
  ok(/<Ne>/.test(prM) && !/<no>/.test(prM) && (await ents()).length === nM + 1, `ZRCADLIT: výchozí volba česky „${prM}“, Enter = ponechat zdroj (+1 entita)`);
  await p.keyboard.press('Escape');

  await p.screenshot({ path: S + 'w9-edit-final.png' });

  ok(!errs.length, `bez chyb stránky (${errs.slice(0, 3).join(' | ')})`);
  // známá vada jádra (draft-panels.tsx, PropsPanel: řádky geometrie bez `key`) – není v souborech balíku, hlášeno integrátorovi
  const coreKnown = (t) => /unique "key" prop/.test(t) && /PropsPanel/.test(t);
  const own = cerrs.filter((t) => !coreKnown(t));
  ok(!own.length, `bez chyb v konzoli (např. duplicitní klíče React) (${own.slice(0, 3).join(' | ')})${cerrs.length > own.length ? ` – vyňato ${cerrs.length - own.length}× známé varování jádra PropsPanel bez key` : ''}`);
  await b.close();
})().catch((e) => { console.log('FAIL: výjimka ' + (e && e.stack || e)); process.exit(1); });
