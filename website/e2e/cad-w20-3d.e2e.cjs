// E2E (vlna 20, balík 3d): výběr oknem / křížením ve 3D okně skutečným tažením myši (Playwright mouse.down/move/up).
//  – díl (WebGL): zleva doprava = okno (modrý plný obdélník, jen celé uvnitř a viditelné), zprava doleva = křížení
//    (zelený čárkovaný, i protnuté), počítadlo u obdélníku, Ctrl přidá, Alt i Ctrl+Shift odeberou, Esc zruší,
//    krátký klik dál vybírá, otáčení pravým tlačítkem beze změny, filtr Hrana, volba „Okno vybírá i skryté“,
//  – formulář Zaoblit: oknem se vyberou hrany zaoblení; Měření: dvě entity = vzdálenost, víc = součet délek,
//  – sestava: komponenty oknem i křížením, window.mncad.selectBox, rychlost na sestavě se 70 komponentami,
//  – Nastavení „Levé tlačítko táhne: otáčení“ (okno jen z prázdného místa), dotyk: dlouhý stisk a tažení,
//  – náhled bez WebGL: levé tlačítko okno, pravé otáčí.
//  – opravy po kontrole: dotyk na gizmu (dlouhý stisk a tažení = jen gizmo), řez (víčko zakrývá vnitřní hrany a vrcholy),
//    upozornění náhledu bez WebGL s aktuálními tlačítky, filtr Prvek počítá prvky, kolečko během okna v náhledu.
// Spuštění: E2E_BASE=http://localhost:3491 node e2e/cad-w20-3d.e2e.cjs <složka pro snímky>
const { chromium } = require('playwright');
const fs = require('fs');
const S = (process.argv[2] || '/tmp/e2e-w20-3d').replace(/\/?$/, '/');
fs.mkdirSync(S, { recursive: true });
const ok = (c, m) => { console.log((c ? 'ok: ' : 'FAIL: ') + m); if (!c) process.exitCode = 1; };
const BASE = (process.env.E2E_BASE || 'http://localhost:3491').replace(/\/$/, '');

async function open(b, opts = {}) {
  const ctx = await b.newContext({ viewport: { width: 1400, height: 850 }, ...opts });
  const p = await ctx.newPage();
  const errs = []; p.on('pageerror', (e) => errs.push(e.message));
  p.on('dialog', (d) => d.dismiss().catch(() => {}));
  await p.goto(BASE + '/cad', { waitUntil: 'networkidle', timeout: 300000 });
  const cont = p.getByText('Pokračovat v práci');
  if (await cont.isVisible({ timeout: 6000 }).catch(() => false)) await cont.click();
  await p.waitForFunction(() => !!window.mncad && !document.body.innerText.includes('Načítám jádro'), null, { timeout: 240000 });
  await p.waitForTimeout(1000);
  if (await cont.isVisible().catch(() => false)) await cont.click();
  return { p, ctx, errs };
}

(async () => {
  const b = await chromium.launch({ args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
  const { p, errs } = await open(b);
  const run = (t) => p.evaluate((t) => window.mncad.run(t), t);
  const idle = () => p.waitForFunction(() => !window.mncad.progress(), null, { timeout: 120000 }).catch(() => {});
  const sel = () => p.evaluate(() => window.mncad.selection());
  const canvas = () => p.locator('main canvas').first().boundingBox();
  const filter = async (f) => { await p.locator('footer select').first().selectOption(f); await p.waitForTimeout(250); };
  const esc = async () => { await p.keyboard.press('Escape'); await p.waitForTimeout(200); };
  /** skutečné tažení myší z a do b (souřadnice stránky); vrátí stav obdélníku uprostřed tažení */
  const drag = async (a, z, o = {}) => {
    const mods = o.mods || [];
    for (const m of mods) await p.keyboard.down(m);
    await p.mouse.move(a[0], a[1]);
    await p.mouse.down({ button: o.button || 'left' });
    const steps = o.steps || 12;
    for (let i = 1; i <= steps; i++) await p.mouse.move(a[0] + ((z[0] - a[0]) * i) / steps, a[1] + ((z[1] - a[1]) * i) / steps);
    await p.waitForTimeout(o.wait ?? 260);
    const mid = await p.evaluate(() => { const r = document.querySelector('[data-box-select]'); if (!r) return null; const st = getComputedStyle(r); return { kind: r.dataset.boxSelect, mode: r.dataset.boxMode, label: r.querySelector('[data-box-count]')?.textContent || '', border: st.borderTopStyle, color: st.borderTopColor }; });
    if (o.beforeUp) await o.beforeUp();
    await p.mouse.up({ button: o.button || 'left' });
    for (const m of mods) await p.keyboard.up(m);
    await p.waitForTimeout(o.after ?? 500);
    const gone = !(await p.evaluate(() => !!document.querySelector('[data-box-select]')));
    return { mid, gone };
  };
  const hash = () => p.evaluate(() => { const c = document.querySelector('main canvas'); const d = c.toDataURL('image/png'); let h = 0; for (let i = 0; i < d.length; i += 101) h = (h * 31 + d.charCodeAt(i)) | 0; return h; });
  /** popisky entit (px vůči 3D oknu) – kde je která plocha / hrana */
  const hints = async () => { await p.evaluate(() => window.mncad.hints(true)); await p.waitForTimeout(700); const h = await p.evaluate(() => window.mncad.hints()); await p.evaluate(() => window.mncad.hints(false)); await p.waitForTimeout(200); return h; };

  ok(await p.evaluate(() => !!document.querySelector('main canvas') && !document.querySelector('[data-viewport-fallback]')), 'prostředí: 3D okno s WebGL (SwiftShader)');
  await run('nový díl Okno\nkvádr 40 30 20\ndíra 8 skrz v 20 15');
  await idle();
  await p.waitForTimeout(1500);
  const st = await p.evaluate(() => window.mncad.status());
  const faces = Number((/ploch (\d+)/.exec(st) || [])[1] || 0);
  let cv = await canvas();
  const L = [cv.x + 40, cv.y + 60], R = [cv.x + cv.width - 40, cv.y + cv.height - 60];
  ok(/Okno: levé tl\./.test(await p.locator('[data-mouse-hint]').innerText()), `stavový řádek říká, jak okno funguje: „${await p.locator('[data-mouse-hint]').innerText()}“`);

  // ── A) díl: okno zleva doprava přes celý model ──
  let r = await drag(L, R);
  let s = await sel();
  ok(r.mid && r.mid.kind === 'window' && r.mid.border === 'solid' && /37, 99, 235/.test(r.mid.color), `A1 tažení zleva doprava ukáže okno (plný modrý rámeček): ${JSON.stringify(r.mid)}`);
  ok(r.mid && /\d+ ploch/.test(r.mid.label), `A1 počítadlo u obdélníku během tažení: „${r.mid && r.mid.label}“`);
  ok(r.gone && s.length >= 3 && s.every((x) => x.kind === 'face') && s.length < faces, `A1 po uvolnění vybrány jen viditelné plochy celé uvnitř: ${s.map((x) => x.id).join(' ')} (těleso má ${faces} ploch)`);
  const visFaces = s.map((x) => x.id);
  ok(/Vybráno: \d+×/.test(await p.locator('footer').innerText()) && (await p.locator('footer').innerText()).includes(`vybráno ${s.length}`), 'A1 stavový řádek ukazuje počet vybraných');
  await p.screenshot({ path: S + 'w20-3d-window.png' });

  // okno jen přes polovinu modelu nevybere nic celé uvnitř
  r = await drag(L, [cv.x + cv.width / 2, cv.y + cv.height / 2 + 20]);
  s = await sel();
  ok(s.length < visFaces.length, `A2 okno jen přes část modelu vybere jen plochy celé uvnitř (${s.length} < ${visFaces.length})`);

  // křížení zprava doleva přes horní plochu
  const h0 = await hints();
  const top = h0.find((x) => x.kind === 'face' && /\+Z/.test(x.title));
  const front = h0.find((x) => x.kind === 'face' && /-Y/.test(x.title));
  ok(!!top && !!front, `popisky ploch: horní ${top && top.id}, přední ${front && front.id}`);
  r = await drag([cv.x + top.x + 12, cv.y + top.y + 8], [cv.x + top.x - 12, cv.y + top.y - 8]);
  s = await sel();
  ok(r.mid && r.mid.kind === 'crossing' && r.mid.border === 'dashed' && /22, 163, 74/.test(r.mid.color), `A3 tažení zprava doleva = křížení (zelený čárkovaný): ${JSON.stringify(r.mid)}`);
  ok(s.length === 1 && s[0].id === top.id, `A3 křížení vybere dotčenou horní plochu: ${s.map((x) => x.id).join(' ')}`);
  // Ctrl přidá
  r = await drag([cv.x + front.x + 10, cv.y + front.y + 8], [cv.x + front.x - 10, cv.y + front.y - 8], { mods: ['Control'] });
  s = await sel();
  ok(r.mid && r.mid.mode === 'add' && /^\+ /.test(r.mid.label) && s.length === 2 && s.some((x) => x.id === top.id) && s.some((x) => x.id === front.id), `A4 Ctrl + křížení přidá: ${s.map((x) => x.id).join(' ')} (popisek „${r.mid && r.mid.label}“)`);
  // Alt odebere, Ctrl+Shift odebere
  r = await drag([cv.x + front.x + 10, cv.y + front.y + 8], [cv.x + front.x - 10, cv.y + front.y - 8], { mods: ['Alt'] });
  s = await sel();
  ok(r.mid && r.mid.mode === 'remove' && s.length === 1 && s[0].id === top.id, `A5 Alt + křížení odebere: ${s.map((x) => x.id).join(' ')}`);
  r = await drag([cv.x + top.x + 10, cv.y + top.y + 8], [cv.x + top.x - 10, cv.y + top.y - 8], { mods: ['Control', 'Shift'] });
  s = await sel();
  ok(s.length === 0, `A6 Ctrl+Shift + křížení odebere: ${s.length}`);
  // Esc zruší obdélník, výběr zůstane
  await drag(L, R);
  const before = (await sel()).length;
  r = await drag([cv.x + top.x + 12, cv.y + top.y + 8], [cv.x + top.x - 12, cv.y + top.y - 8], { beforeUp: async () => { await p.keyboard.press('Escape'); await p.waitForTimeout(150); } });
  s = await sel();
  ok(r.gone && s.length === before && before > 1, `A7 Esc během tažení zruší okno a výběr nechá (${before} → ${s.length})`);
  // krátký klik (< 5 px) dál vybírá kliknutím
  await esc();
  await drag([cv.x + top.x, cv.y + top.y], [cv.x + top.x + 3, cv.y + top.y + 1], { steps: 2 });
  s = await sel();
  ok(s.length === 1 && s[0].id === top.id, `A8 klik s pohybem do 4 px vybere plochu kliknutím: ${s.map((x) => x.id).join(' ')}`);
  // pravé tlačítko dál otáčí (ZW3D)
  const c0 = await hash();
  await drag([cv.x + cv.width / 2, cv.y + cv.height / 2], [cv.x + cv.width / 2 + 120, cv.y + cv.height / 2 + 30], { button: 'right' });
  const c1 = await hash();
  s = await sel();
  ok(c0 !== c1 && s.length === 1, 'A9 pravé tlačítko táhne = otáčení (pohled se změnil, výběr beze změny), žádný obdélník');
  await p.evaluate(() => document.querySelector('[data-soft-fit],button[title="Izometrie (domů)"]')?.click());
  await p.waitForTimeout(600);
  // filtr Hrana
  await esc();
  await filter('edge');
  await drag(L, R);
  s = await sel();
  ok(s.length >= 9 && s.every((x) => x.kind === 'edge'), `A10 filtr Hrana: okno vybere viditelné hrany (${s.length}: ${s.map((x) => x.id).join(' ')})`);
  const visEdges = s.length;
  // volba „Okno vybírá i skryté“ (Nástroje › Filtr)
  await p.getByRole('button', { name: 'Nástroje', exact: true }).first().click();
  await p.waitForTimeout(300);
  await p.getByRole('button', { name: /^Filtr: / }).first().click();
  await p.waitForTimeout(300);
  await p.getByText('Okno vybírá i skryté', { exact: true }).first().click();
  await p.waitForTimeout(300);
  await drag(L, R);
  s = await sel();
  const edgesAll = Number((/hran (\d+)/.exec(st) || [])[1] || 0);
  ok(s.length > visEdges && (!edgesAll || s.length === edgesAll), `A11 i skryté: okno vybere i zakryté hrany (${visEdges} → ${s.length}, těleso ${edgesAll || '?'} hran)`);
  await p.getByRole('button', { name: /^Filtr: / }).first().click();
  await p.waitForTimeout(300);
  await p.getByText('Okno vybírá i skryté', { exact: true }).first().click();
  await p.waitForTimeout(300);
  await esc();
  // filtr Prvek: počítadlo u obdélníku počítá prvky (Kvádr, Díra), ne plochy – stejný počet jako výběr po uvolnění
  await filter('feature');
  r = await drag(L, R, { wait: 2500, after: 2500 });
  s = await sel();
  const nf = Number((/^(\d+) prvk/.exec((r.mid && r.mid.label) || '') || [])[1] || -1);
  ok(r.mid && nf === s.length && s.length === 2 && s.every((x) => x.kind === 'feature'), `A12 filtr Prvek: počítadlo „${r.mid && r.mid.label}“ = výběr po uvolnění ${s.map((x) => x.id).join(' ')} (dřív „N ploch“)`);
  await filter('all');
  await esc();

  // ── B) formulář Zaoblit: oknem hrany zaoblení ──
  await p.getByRole('button', { name: 'Tvorba', exact: true }).first().click();
  await p.waitForTimeout(300);
  await p.getByRole('button', { name: /^Zaoblit/ }).first().click();
  await p.waitForTimeout(1500);
  const filletEdges = () => p.evaluate(() => { const f = window.mncad.getDocument().features.slice(-1)[0]; return f && f.type === 'fillet' ? f.edges : null; });
  const e0 = await filletEdges();
  // horní hrany: okno jen přes horní část modelu (křížení přes horní plochu by vzalo i boční hrany)
  await drag(L, R);
  const e1 = await filletEdges();
  ok(Array.isArray(e0) && e0.length === 0 && Array.isArray(e1) && e1.length >= 9, `B1 formulář Zaoblit: okno vybere viditelné hrany do formuláře (${JSON.stringify(e0)} → ${JSON.stringify(e1)})`);
  await drag([cv.x + top.x + 12, cv.y + top.y + 8], [cv.x + top.x - 12, cv.y + top.y - 8], { mods: ['Alt'] });
  const e2 = await filletEdges();
  ok(Array.isArray(e2) && e2.length === e1.length, `B2 Alt + křížení uvnitř horní plochy (žádná hrana) formulář nezmění (${e2 && e2.length})`);
  await drag(L, [cv.x + cv.width / 2, cv.y + cv.height - 60], { mods: ['Alt'] });
  const e3 = await filletEdges();
  ok(Array.isArray(e3) && e3.length < e1.length, `B3 Alt + okno přes levou polovinu odebere hrany z formuláře (${e1.length} → ${e3 && e3.length})`);
  await p.screenshot({ path: S + 'w20-3d-fillet.png' });
  const cancel = p.getByRole('button', { name: 'Storno' }).first();
  if (await cancel.isVisible().catch(() => false)) await cancel.click();
  await p.waitForTimeout(800);

  // Skořepina: oknem plochy, které se otevřou (formulář s výběrem ploch)
  await p.getByRole('button', { name: 'Tvorba', exact: true }).first().click();
  await p.waitForTimeout(300);
  await p.getByRole('button', { name: /^Skořepina/ }).first().click();
  await p.waitForTimeout(1500);
  const shellFaces = () => p.evaluate(() => { const f = window.mncad.getDocument().features.slice(-1)[0]; return f && f.type === 'shell' ? f.faces : null; });
  const sf0 = await shellFaces();
  await drag([cv.x + top.x + 12, cv.y + top.y + 8], [cv.x + top.x - 12, cv.y + top.y - 8]);
  const sf1 = await shellFaces();
  ok(Array.isArray(sf1) && sf1.length === 1 && 'F' + (sf1[0] + 1) === top.id, `B4 formulář Skořepina: křížení přes horní plochu ji vybere do formuláře (${JSON.stringify(sf0)} → ${JSON.stringify(sf1)})`);
  const cancel2 = p.getByRole('button', { name: 'Storno' }).first();
  if (await cancel2.isVisible().catch(() => false)) await cancel2.click();
  await p.waitForTimeout(800);

  // ── C) měření ──
  await filter('all');
  await p.locator('header').first().click({ position: { x: 5, y: 5 } }).catch(() => {});
  await p.keyboard.press('m');
  await p.waitForTimeout(600);
  await filter('edge');
  // panel Měření je vlevo nahoře – tažení zleva zdola doprava nahoru (pořád okno: x roste)
  r = await drag([cv.x + 40, cv.y + cv.height - 60], [cv.x + cv.width - 90, cv.y + 90]);
  await p.waitForTimeout(1500);
  const mtext = await p.locator('body').innerText();
  ok(r.mid && r.mid.kind === 'window' && /Vybráno oknem/.test(mtext) && /Celková délka hran/.test(mtext), `C1 měření: okno přes víc hran ukáže počet a celkovou délku hran (${(/Celková délka hran\s*([^\n]+)/.exec(mtext) || [])[1]})`);
  await p.screenshot({ path: S + 'w20-3d-measure.png' });
  await p.keyboard.press('m');
  await p.waitForTimeout(500);
  await filter('all');
  await esc();

  // ── E) Nastavení: levé tlačítko otáčí (okno jen z prázdného místa) ──
  await p.evaluate(() => window.mncad.setSettings({ leftDrag: 'orbit' }));
  await p.waitForTimeout(500);
  cv = await canvas();
  const o0 = await hash();
  r = await drag([cv.x + cv.width / 2, cv.y + cv.height / 2], [cv.x + cv.width / 2 + 100, cv.y + cv.height / 2 + 40]);
  const o1 = await hash();
  s = await sel();
  ok(!r.mid && o0 !== o1 && s.length === 0, `E1 „Levé tlačítko táhne: otáčení“: tažení z modelu otáčí, bez obdélníku (${!r.mid}, pohled ${o0 !== o1})`);
  await p.evaluate(() => document.querySelector('button[title="Izometrie (domů)"]')?.click());
  await p.waitForTimeout(700);
  r = await drag([cv.x + 25, cv.y + 40], R);
  s = await sel();
  ok(r.mid && r.mid.kind === 'window' && s.length >= 3, `E2 … z prázdného místa levé tlačítko dál táhne okno (${s.length} ploch)`);
  ok(/z prázdného místa/.test(await p.locator('[data-mouse-hint]').innerText()), 'E3 stavový řádek: okno z prázdného místa');
  await p.evaluate(() => window.mncad.setSettings({ leftDrag: 'window' }));
  await p.waitForTimeout(400);
  await esc();

  // ── H) řez: víčko řezu zakrývá vnitřní rohy (hrany a vrcholy pod víčkem se oknem nevyberou) ──
  await run('nový díl Rez\nkvádr 40 30 20');
  await idle();
  await p.waitForTimeout(1500);
  cv = await canvas();
  // panel Řez je vlevo nahoře – okno zleva zdola doprava nahoru (pořád okno: x roste)
  const HL = [cv.x + 40, cv.y + cv.height - 60], HR = [cv.x + cv.width - 90, cv.y + 90];
  await filter('edge');
  await drag(HL, HR);
  const eBefore = (await sel()).map((x) => x.id);
  await filter('vertex');
  await drag(HL, HR);
  const vBefore = (await sel()).map((x) => x.id);
  await run('řez Z 10');
  await idle();
  await p.waitForTimeout(1200);
  await filter('edge');
  r = await drag(HL, HR);
  const eAfter = (await sel()).map((x) => x.id);
  ok(eBefore.length === 9 && eAfter.length === 5 && eAfter.every((id) => eBefore.includes(id)), `H1 řez Z 10, filtr Hrana: okno vybere ${eAfter.length} hran (${eAfter.join(' ')}), jen hrany viditelné i bez řezu (${eBefore.join(' ')}); dřív i vnitřní rohy pod víčkem`);
  await filter('vertex');
  await drag(HL, HR);
  const vAfter = (await sel()).map((x) => x.id);
  ok(vAfter.length === 3 && vAfter.every((id) => vBefore.includes(id)), `H2 řez Z 10, filtr Bod: ${vAfter.join(' ')} (bez zadního spodního rohu pod víčkem; bez řezu ${vBefore.join(' ')})`);
  await p.screenshot({ path: S + 'w20-3d-section.png' });
  await run('řez vyp');
  await idle();
  await filter('all');
  await esc();

  // ── D) sestava: komponenty, selectBox, rychlost ──
  await run('nový díl Kostka\nkvádr 40 30 20');
  await idle();
  await run('nová sestava Sestava A\nvložit "Kostka" v 0 0 0\nvložit "Kostka" v 80 0 0');
  await idle();
  await p.waitForTimeout(3000);
  cv = await canvas();
  await drag(L, R);
  s = await sel();
  ok(s.length === 2 && s.every((x) => x.kind === 'component'), `D1 sestava (filtr Komponenta): okno vybere obě komponenty: ${s.map((x) => x.id).join(' ')}`);
  // podsestava: filtr Podsestava vybere oknem celou podsestavu (komponentu nejvyšší úrovně), Komponenta její díly
  await run('nová sestava Sestava P\nvložit "Kostka" v 0 0 0 jako "A"\nvložit "Kostka" v 70 0 0 jako "B"\nvložit "Kostka" v 140 0 0 jako "C"\nsestava podsestava "A" "B" jako "P"');
  await idle();
  await p.waitForTimeout(3000);
  cv = await canvas();
  await filter('subasm');
  await drag(L, R);
  s = await sel();
  ok(s.length === 2 && s.every((x) => x.kind === 'component'), `D1b filtr Podsestava: okno vybere podsestavu P a komponentu C: ${s.map((x) => x.title || x.id).join(', ')}`);
  await filter('component');
  await drag(L, R);
  s = await sel();
  ok(s.length === 3, `D1c filtr Komponenta: okno vybere 3 díly (i uvnitř podsestavy): ${s.map((x) => x.id).join(' ')}`);
  await run('sestava otevřít "P"');
  await idle();
  await p.waitForTimeout(3000);
  cv = await canvas();
  await drag(L, R);
  s = await sel();
  ok(s.length === 2 && s.every((x) => x.kind === 'component'), `D1d podsestava otevřená v záložce: okno vybere její 2 komponenty: ${s.map((x) => x.id).join(' ')}`);
  // křížení přes jednu komponentu (podle popisku její plochy ze selectBox)
  const W = cv.width, H = cv.height;
  await esc();
  const api = await p.evaluate(({ W, H }) => window.mncad.selectBox({ x0: 40, y0: 60, x1: W - 40, y1: H - 60 }), { W, H });
  const apiSel = await sel();
  ok(Array.isArray(api) && api.length === 2 && api.every((x) => x.kind === 'component') && JSON.stringify(api) === JSON.stringify(apiSel), `D2 window.mncad.selectBox (okno jako tažení myší) vrátí výběr ve tvaru selection(): ${JSON.stringify(api)}`);
  const one = await p.evaluate(({ W, H }) => window.mncad.selectBox({ x0: W / 2 + 200, y0: H / 2 + 40, x1: W / 2 - 200, y1: H / 2 - 40 }), { W, H });
  ok(one.length === 2, `D3 selectBox křížení přes střed (obě komponenty): ${one.map((x) => x.id).join(' ')}`);
  const none = await p.evaluate(() => window.mncad.selectBox({ x0: 5, y0: 5, x1: 30, y1: 30, mode: 'add' }));
  ok(none.length === 2, `D4 selectBox mode add s prázdným oknem výběr nezmění (${none.length})`);
  const bad = await p.evaluate(() => { try { window.mncad.selectBox({ x0: 1 }); return 'no error'; } catch (e) { return e.message; } });
  ok(/selectBox potřebuje obdélník/.test(bad), `D5 selectBox se špatným vstupem = srozumitelná chyba: ${bad}`);
  // rychlost: 70 komponent jemnějšího dílu (4 díry, zaoblené svislé hrany)
  await run('nový díl Detail\nkvádr 40 30 20\nzaoblit 3 hrany svislé\ndíra 8 skrz v 10 10\ndíra 8 skrz v 30 10\ndíra 8 skrz v 10 20\ndíra 8 skrz v 30 20');
  await idle();
  let big = 'nová sestava Velka';
  for (let i = 0; i < 70; i++) big += `\nvložit "Detail" v ${(i % 10) * 60} ${Math.floor(i / 10) * 50} 0`;
  await run(big);
  await idle();
  await p.waitForFunction(async () => (await window.mncad.status()).includes('70'), null, { timeout: 120000 }).catch(() => {});
  await p.waitForTimeout(5000);
  cv = await canvas();
  const perf = await p.evaluate(({ W, H }) => {
    const t0 = performance.now();
    const a = window.mncad.selectBox({ x0: 10, y0: 10, x1: W - 10, y1: H - 10 });
    const t1 = performance.now();
    return { n: a.length, ms: t1 - t0 };
  }, { W: cv.width, H: cv.height });
  ok(perf.n >= 30 && perf.ms < 200, `D6 sestava 70 komponent: okno přes celé 3D okno ${perf.n} komponent za ${perf.ms.toFixed(0)} ms (cíl < 200 ms)`);
  await filter('face');
  const perfF = await p.evaluate(({ W, H }) => { const t0 = performance.now(); const a = window.mncad.selectBox({ x0: W - 10, y0: H - 10, x1: 10, y1: 10 }); return { n: a.length, ms: performance.now() - t0 }; }, { W: cv.width, H: cv.height });
  ok(perfF.n >= 60 && perfF.ms < 200, `D7 sestava 70 komponent, filtr Plocha, křížení: ${perfF.n} ploch za ${perfF.ms.toFixed(0)} ms (cíl < 200 ms)`);
  r = await drag(L, R);
  s = await sel();
  const pm = await p.evaluate(() => { const e = window.mncad.perf(); const last = (k) => [...e].reverse().find((x) => x.stage === k); return { scene: last('ui.box.scene'), select: last('ui.box.select') }; });
  const boxMs = (pm.scene?.ms ?? 0) + (pm.select?.ms ?? 0);
  ok(s.length >= 60 && r.mid && /ploch/.test(r.mid.label) && pm.select && boxMs < 200, `D8 skutečné tažení přes 70 komponent (filtr Plocha): ${s.length} ploch, počítadlo „${r.mid && r.mid.label}“, příprava scény ${pm.scene?.ms} ms (${pm.scene?.info?.triangles} trojúhelníků) + výběr ${pm.select?.ms} ms (cíl < 200 ms)`);
  await filter('component');
  await p.screenshot({ path: S + 'w20-3d-asm70.png' });
  ok(errs.length === 0, `bez chyb stránky (${errs.slice(0, 3).join(' | ')})`);
  await p.context().close();

  // ── F) dotyk: dlouhý stisk a tažení = okno; rychlé tažení otáčí ──
  const t = await open(b, { hasTouch: true });
  await t.p.evaluate((x) => window.mncad.run(x), 'nový díl Dotyk\nkvádr 40 30 20');
  await t.p.waitForFunction(() => !window.mncad.progress(), null, { timeout: 120000 }).catch(() => {});
  await t.p.waitForTimeout(1500);
  const tb = await t.p.locator('main canvas').first().boundingBox();
  const cdp = await t.ctx.newCDPSession(t.p);
  const tp = (type, x, y) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: type === 'touchEnd' ? [] : [{ x, y, id: 1 }] });
  const thash = () => t.p.evaluate(() => { const c = document.querySelector('main canvas'); const d = c.toDataURL('image/png'); let h = 0; for (let i = 0; i < d.length; i += 101) h = (h * 31 + d.charCodeAt(i)) | 0; return h; });
  await tp('touchStart', tb.x + 40, tb.y + 60);
  await t.p.waitForTimeout(800);
  const armed = await t.p.evaluate(() => !!document.querySelector('[data-box-armed]'));
  for (let i = 1; i <= 12; i++) await tp('touchMove', tb.x + 40 + ((tb.width - 80) * i) / 12, tb.y + 60 + ((tb.height - 120) * i) / 12);
  await t.p.waitForTimeout(250);
  const tmid = await t.p.evaluate(() => document.querySelector('[data-box-select]')?.dataset.boxSelect || null);
  await tp('touchEnd', 0, 0);
  await t.p.waitForTimeout(700);
  let ts = await t.p.evaluate(() => window.mncad.selection());
  ok(armed && tmid === 'window' && ts.length >= 3 && ts.every((x) => x.kind === 'face'), `F1 dotyk: dlouhý stisk (značka ${armed}) a tažení = okno (${tmid}), vybráno ${ts.map((x) => x.id).join(' ')}`);
  await t.p.evaluate(() => window.mncad.clearSelection());
  const th0 = await thash();
  await tp('touchStart', tb.x + tb.width / 2, tb.y + tb.height / 2);
  for (let i = 1; i <= 10; i++) await tp('touchMove', tb.x + tb.width / 2 + i * 12, tb.y + tb.height / 2 + i * 4);
  await tp('touchEnd', 0, 0);
  await t.p.waitForTimeout(700);
  const th1 = await thash();
  ts = await t.p.evaluate(() => window.mncad.selection());
  ok(th0 !== th1 && ts.length === 0, 'F2 dotyk: tažení bez dlouhého stisku dál otáčí, nic nevybere');
  // dlouhý stisk bez tažení = kontextová nabídka
  await tp('touchStart', tb.x + tb.width / 2, tb.y + tb.height / 2);
  await t.p.waitForTimeout(800);
  await tp('touchEnd', 0, 0);
  await t.p.waitForTimeout(600);
  ok(await t.p.evaluate(() => !!document.querySelector('div.fixed[class*="z-[60]"]') && /Přizpůsobit/.test(document.querySelector('div.fixed[class*="z-[60]"]').innerText)), 'F3 dotyk: dlouhý stisk bez tažení otevře kontextovou nabídku');
  await t.p.keyboard.press('Escape');
  // dlouhý stisk prstem na šipce gizma a tažení = jen tažení gizmem (bez obdélníku, výběr zůstane) – oprava po kontrole
  await t.p.evaluate((x) => window.mncad.run(x), 'nový díl Kostka\nkvádr 40 30 20');
  await t.p.waitForFunction(() => !window.mncad.progress(), null, { timeout: 120000 }).catch(() => {});
  await t.p.evaluate((x) => window.mncad.run(x), 'nová sestava Sestava T\nvložit "Kostka" v 0 0 0\nvložit "Kostka" v 80 0 0');
  await t.p.waitForFunction(() => !window.mncad.progress(), null, { timeout: 120000 }).catch(() => {});
  await t.p.waitForTimeout(3000);
  await t.p.evaluate(() => window.mncad.select(['comp:#1']));
  await t.p.locator('header').first().click({ position: { x: 5, y: 5 } }).catch(() => {});
  await t.p.keyboard.press('g');
  await t.p.waitForTimeout(900);
  // šipka Z gizma: syté modré pixely plátna (osa Z míří nahoru), bod ve třetině od hrotu
  const gz = await t.p.evaluate(() => {
    const c = document.querySelector('main canvas');
    const r = c.getBoundingClientRect();
    const o = document.createElement('canvas');
    o.width = c.width; o.height = c.height;
    const g = o.getContext('2d');
    g.drawImage(c, 0, 0);
    const d = g.getImageData(0, 0, o.width, o.height).data;
    let top = Infinity, bot = -Infinity;
    const rows = new Map();
    for (let y = 0; y < o.height; y++) for (let x = 0; x < o.width; x++) {
      const i = (y * o.width + x) * 4;
      if (d[i + 2] > 200 && d[i] < 60 && d[i + 1] < 60) { top = Math.min(top, y); bot = Math.max(bot, y); if (!rows.has(y)) rows.set(y, []); rows.get(y).push(x); }
    }
    if (!Number.isFinite(top)) return null;
    let y = Math.round(top + (bot - top) * 0.3);
    while (!rows.has(y) && y < bot) y++;
    const xs = rows.get(y);
    const k = r.width / c.width;
    return { x: r.left + xs[Math.floor(xs.length / 2)] * k, y: r.top + y * k };
  });
  const place = () => t.p.evaluate(() => window.mncad.getDocument().components.map((c) => c.placement.position.map((v) => Math.round(v)).join(',')).join(' | '));
  const pl0 = await place();
  let gBox = null;
  if (gz) {
    await tp('touchStart', gz.x, gz.y);
    await t.p.waitForTimeout(800);
    for (let i = 1; i <= 12; i++) {
      await tp('touchMove', gz.x, gz.y - i * 6);
      gBox = gBox || (await t.p.evaluate(() => document.querySelector('[data-box-select]')?.dataset.boxSelect || null));
    }
    await t.p.waitForTimeout(300);
    await tp('touchEnd', 0, 0);
    await t.p.waitForTimeout(900);
  }
  const pl1 = await place();
  const gsel = (await t.p.evaluate(() => window.mncad.selection())).map((x) => x.id);
  ok(!!gz && pl1 !== pl0 && !gBox && gsel.join(' ') === 'comp:#1', `F4 dotyk: dlouhý stisk na šipce gizma a tažení posune komponentu (${pl0} → ${pl1}) bez obdélníku (${gBox}), výběr zůstane (${gsel.join(' ')})`);
  ok(t.errs.length === 0, `dotyk: bez chyb stránky (${t.errs.slice(0, 3).join(' | ')})`);
  await t.ctx.close();
  await b.close();

  // ── G) náhled bez WebGL ──
  const b2 = await chromium.launch({ args: ['--disable-3d-apis', '--disable-webgl', '--disable-webgl2', '--disable-gpu'] });
  const g = await open(b2);
  await g.p.evaluate((x) => window.mncad.run(x), 'nový díl Soft\nkvádr 40 30 20\ndíra 8 skrz v 20 15');
  await g.p.waitForFunction(() => Number(document.querySelector('[data-soft-canvas]')?.dataset.tris) >= 12, null, { timeout: 60000 }).catch(() => {});
  await g.p.waitForTimeout(1200);
  const sb = await g.p.locator('[data-soft-canvas]').boundingBox();
  const gdrag = async (a, z, button = 'left', mods = [], during = null) => {
    for (const m of mods) await g.p.keyboard.down(m);
    await g.p.mouse.move(a[0], a[1]); await g.p.mouse.down({ button });
    for (let i = 1; i <= 12; i++) await g.p.mouse.move(a[0] + ((z[0] - a[0]) * i) / 12, a[1] + ((z[1] - a[1]) * i) / 12);
    await g.p.waitForTimeout(250);
    if (during) await during();
    const mid = await g.p.evaluate(() => { const r = document.querySelector('[data-box-select]'); return r ? { kind: r.dataset.boxSelect, label: r.querySelector('[data-box-count]')?.textContent || '' } : null; });
    await g.p.mouse.up({ button });
    for (const m of mods) await g.p.keyboard.up(m);
    await g.p.waitForTimeout(500);
    return mid;
  };
  const v0 = await g.p.locator('[data-soft-canvas]').getAttribute('data-view');
  const gm = await gdrag([sb.x + 40, sb.y + 80], [sb.x + sb.width - 40, sb.y + sb.height - 60]);
  let gs = await g.p.evaluate(() => window.mncad.selection());
  const v1 = await g.p.locator('[data-soft-canvas]').getAttribute('data-view');
  ok(gm && gm.kind === 'window' && /ploch/.test(gm.label) && gs.length >= 3 && gs.every((x) => x.kind === 'face') && v0 === v1, `G1 náhled bez WebGL: okno levým tlačítkem (${JSON.stringify(gm)}) vybere ${gs.map((x) => x.id).join(' ')}, pohled ${v0}→${v1}`);
  const gm2 = await gdrag([sb.x + sb.width / 2 + 30, sb.y + sb.height / 2 + 20], [sb.x + sb.width / 2 - 30, sb.y + sb.height / 2 - 20], 'left', ['Alt']);
  const gs2 = await g.p.evaluate(() => window.mncad.selection());
  ok(gm2 && gm2.kind === 'crossing' && gs2.length < gs.length, `G2 náhled: Alt + křížení odebere dotčené (${gs.length} → ${gs2.length})`);
  await gdrag([sb.x + sb.width / 2, sb.y + sb.height / 2], [sb.x + sb.width / 2 + 120, sb.y + sb.height / 2 + 40], 'right');
  const v2 = await g.p.locator('[data-soft-canvas]').getAttribute('data-view');
  ok(v2 === 'free', `G3 náhled: pravé tlačítko táhne = otáčení (pohled ${v2})`);
  const note = (await g.p.locator('[data-soft-note]').innerText().catch(() => '')).replace(/\s+/g, ' ');
  ok(/Okno: levé tl\./.test(note) && /Otáčení: pravé tl\./.test(note) && !/tažení otáčí/.test(note) && /Klik vybere plochu, hranu nebo vrchol/.test(note), `G4 upozornění náhledu popisuje tlačítka jako stavový řádek (dřív „tažení otáčí, Shift + tažení posouvá“): ${note.slice(0, 160)}`);
  // kolečko během tažení okna pohled nemění (jako ve 3D okně) – výsledek odpovídá obdélníku na obrazovce
  await g.p.evaluate(() => document.querySelector('[data-soft-fit]')?.click());
  await g.p.waitForTimeout(600);
  await g.p.evaluate(() => window.mncad.clearSelection());
  const shash = () => g.p.evaluate(() => { const c = document.querySelector('[data-soft-canvas]'); const d = c.toDataURL('image/png'); let h = 0; for (let i = 0; i < d.length; i += 101) h = (h * 31 + d.charCodeAt(i)) | 0; return h; });
  // otisk plátna během tažení před kolečkem a po něm (obdélník je mimo plátno, výběr se kreslí až po uvolnění)
  let wh0 = 0, wh1 = 1;
  const gw = await gdrag([sb.x + 30, sb.y + 70], [sb.x + sb.width - 150, sb.y + sb.height - 60], 'left', [], async () => { wh0 = await shash(); await g.p.mouse.wheel(0, -1500); await g.p.waitForTimeout(600); wh1 = await shash(); });
  const gws = (await g.p.evaluate(() => window.mncad.selection())).map((x) => x.id).join(' ');
  const truth = await g.p.evaluate(([w, h]) => window.mncad.selectBox({ x0: 30, y0: 70, x1: w - 150, y1: h - 60 }).map((x) => x.id).join(' '), [sb.width, sb.height]);
  ok(gw && wh0 === wh1 && gws === truth && gws.length > 0, `G5 náhled: kolečko během okna pohled nezmění (${wh0 === wh1}), výběr ${gws} = selectBox stejného obdélníku ${truth}`);
  ok(g.errs.length === 0, `náhled: bez chyb stránky (${g.errs.slice(0, 3).join(' | ')})`);
  await b2.close();
})().catch((e) => { console.error(e); process.exit(1); });
