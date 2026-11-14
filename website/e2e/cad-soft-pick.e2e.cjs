// E2E: výběr kliknutím v náhledu bez WebGL (softwarový náhled) – AI agent v prohlížeči bez WebGL musí umět vybírat
// plochy, hrany a vrcholy myší stejně jako ve 3D okně.
//  – klik na plochu → window.mncad.selection() ji obsahuje, plocha je v náhledu zvýrazněná, objeví se rychlá lišta,
//  – Ctrl + klik na hranu ji přidá (a znovu odebere), najetí zvýrazní hranu v překryvné vrstvě,
//  – Zaoblit převezme vybranou hranu → OK → objem klesne; ve formuláři klik na hranu přidá další;
//    „+ aktuální výběr“ ve formuláři převezme hranu vybranou kliknutím,
//  – skica na ploše vybrané kliknutím, měření dvou ploch, popisky F/E/V + clickHint, textový příkaz „vyber“,
//  – sestava: klik vybere komponentu, filtr Plocha vrátí plochu komponenty (id komponenty),
//  – oprava po kontrole: popisky leží v celých pixelech mimo upozornění a panely (skutečný klik zaokrouhlený na pixel
//    vybere popsanou entitu, i s řezem), text „vyber E3;E7“, varování u textového zaoblení při vybraných hranách,
//    „zaoblit 3 hrany E2“, id #2:F3 u stejných komponent, rada řezu sestavy (filtr Plocha), kurzor při tažení,
//    velká síť: index se při přibližování nestaví na každý pohyb myši, popisky bez dlouhých úloh,
//  – žádné systémové dialogy, žádné chyby stránky.
// Spuštění: E2E_BASE=http://localhost:3363 node e2e/cad-soft-pick.e2e.cjs <složka pro výstupy>
const { chromium } = require('playwright');
const fs = require('fs');
const S = (process.argv[2] || '/tmp/e2e').replace(/\/?$/, '/');
fs.mkdirSync(S, { recursive: true });
const ok = (c, m) => { console.log((c ? 'ok: ' : 'FAIL: ') + m); if (!c) process.exitCode = 1; };
const BASE = (process.env.E2E_BASE || 'http://localhost:3100').replace(/\/$/, '');
const near = (a, b, tol) => Math.abs(a - b) <= tol;

(async () => {
  const b = await chromium.launch({ args: ['--disable-3d-apis', '--disable-webgl', '--disable-webgl2', '--disable-gpu'] });
  const ctx = await b.newContext({ viewport: { width: 1400, height: 850 } });
  const p = await ctx.newPage();
  const errs = []; p.on('pageerror', (e) => errs.push(e.message));
  let dialogs = 0; p.on('dialog', (d) => { dialogs++; d.dismiss().catch(() => {}); });
  await p.goto(BASE + '/cad', { waitUntil: 'networkidle', timeout: 180000 });
  const cont = p.getByText('Pokračovat v práci');
  if (await cont.isVisible({ timeout: 6000 }).catch(() => false)) await cont.click();
  await p.waitForFunction(() => !!window.mncad && !document.body.innerText.includes('Načítám jádro'), null, { timeout: 120000 });
  await p.waitForTimeout(1000);
  // úvodní obrazovka se může objevit až po načtení jádra (pomalý první překlad) – zavřít
  if (await cont.isVisible().catch(() => false)) await cont.click();
  const run = (t) => p.evaluate((t) => window.mncad.run(t), t);
  const idle = () => p.waitForFunction(() => !window.mncad.progress(), null, { timeout: 60000 }).catch(() => {});
  const sel = () => p.evaluate(() => window.mncad.selection());
  const doc = () => p.evaluate(() => window.mncad.getDocument());
  const vol = async () => { const m = (await p.evaluate(() => window.mncad.status())).match(/objem ([\d\s  ,]+) cm³/); return m ? parseFloat(m[1].replace(/[^\d,]/g, '').replace(',', '.')) * 1000 : NaN; };
  const canvasBox = () => p.locator('[data-soft-canvas]').boundingBox();
  const hints = async () => { await p.evaluate(() => window.mncad.hints(true)); await p.waitForTimeout(500); return p.evaluate(() => window.mncad.hints()); };
  const hintsOff = () => p.evaluate(() => window.mncad.hints(false));
  /** skutečný klik myší na bod náhledu (souřadnice vůči plátnu) */
  const clickAt = async (x, y, mods = []) => {
    const bb = await canvasBox();
    for (const m of mods) await p.keyboard.down(m);
    await p.mouse.click(bb.x + x, bb.y + y);
    for (const m of mods) await p.keyboard.up(m);
    await p.waitForTimeout(450);
  };
  /** pixel softwarového náhledu (CSS souřadnice → plátno) */
  const pixel = (x, y, sel = '[data-soft-canvas]') => p.evaluate(({ x, y, sel }) => {
    const c = document.querySelector(sel);
    const r = c.getBoundingClientRect();
    const px = Math.round((x * c.width) / r.width), py = Math.round((y * c.height) / r.height);
    return [...c.getContext('2d').getImageData(px, py, 1, 1).data];
  }, { x, y, sel });
  const view = async (v) => { await p.locator(`[data-soft-view="${v}"]`).click(); await p.waitForTimeout(350); };
  /** popisky, které zakrývá jiný prvek stránky (skutečný klik by na plátno nedopadl) */
  const coveredHints = (hl) => p.evaluate((hl) => { const c = document.querySelector('[data-soft-canvas]'); const r = c.getBoundingClientRect(); return hl.filter((h) => document.elementFromPoint(r.left + h.x, r.top + h.y) !== c).map((h) => { const el = document.elementFromPoint(r.left + h.x, r.top + h.y); return `${h.id}(${el ? el.tagName + (el.closest('[data-soft-note]') ? '[note]' : '') : 'null'})`; }); }, hl);
  /** skutečný klik myší (souřadnice stránky zaokrouhlené na celé pixely) na každý popisek → vybere právě jeho entitu? */
  const clickEachHint = async (hl) => {
    const wrong = [];
    for (const h of hl) {
      await p.keyboard.press('Escape');
      await p.waitForTimeout(60);
      const bb = await canvasBox();
      await p.mouse.click(Math.round(bb.x + h.x), Math.round(bb.y + h.y));
      await p.waitForTimeout(150);
      const s = await sel();
      if (!(s.length === 1 && s[0].id === h.id)) wrong.push(`${h.id}->${s.map((x) => x.id).join('+') || 'nic'}`);
    }
    await p.keyboard.press('Escape');
    await p.waitForTimeout(100);
    return wrong;
  };
  const leave = async () => { await p.locator('header').first().click({ position: { x: 5, y: 5 } }).catch(() => {}); await p.waitForTimeout(250); };

  ok(await p.evaluate(() => !document.createElement('canvas').getContext('webgl') && !document.createElement('canvas').getContext('webgl2')), 'prostředí: WebGL je v prohlížeči vypnuté');
  ok((await p.locator('[data-viewport-fallback]').getAttribute('data-viewport-fallback')) === 'soft', 'v 3D okně je softwarový náhled');
  const note = await p.locator('[data-soft-note]').innerText();
  ok(/Klik vybere plochu, hranu nebo vrchol/.test(note) && /vyber F3 E2/.test(note) && /window\.mncad\.select/.test(note) && /--enable-unsafe-swiftshader/.test(note) && !/nefunguje/.test(note), 'upozornění: klik vybírá, text „vyber“ a window.mncad.select, přepínače Chromu pro WebGL');
  const why = await (async () => { await p.locator('[data-soft-why]').click(); await p.waitForTimeout(300); const t = await p.locator('[data-viewport-help]').innerText(); await p.locator('[data-viewport-help]').getByRole('button', { name: 'Zpět k náhledu' }).click(); await p.waitForTimeout(200); return t; })();
  ok(/výběr ploch, hran a vrcholů kliknutím fungují/.test(why) && /--disable-software-rasterizer/.test(why) && /SwiftShader/.test(why), 'Proč nevidím 3D? – co v náhledu funguje a jak zapnout WebGL v automatizaci');

  await run('nový díl Výběr\nkvádr 40 30 20');
  await idle();
  await p.waitForFunction(() => Number(document.querySelector('[data-soft-canvas]')?.dataset.tris) === 12, null, { timeout: 30000 });
  const v0 = await vol();
  ok(near(v0, 24000, 1), `kvádr 40 × 30 × 20: objem ${v0} mm³`);

  // ── 0) popisky pro skutečný klik: celé pixely, nic pod upozorněním (oprava po kontrole) ──
  const nb = await p.locator('[data-soft-note]').boundingBox();
  ok(!!nb && nb.height <= 125, `upozornění náhledu je otevřené a nízké (${nb && Math.round(nb.height)} px; dřív 149 px)`);
  for (const v of ['iso', 'front', 'top']) {
    await view(v);
    const hl = await hints();
    await hintsOff();
    const cov = await coveredHints(hl);
    const wrong = await clickEachHint(hl);
    ok(hl.length >= 7 && hl.every((h) => Number.isInteger(h.x) && Number.isInteger(h.y)) && cov.length === 0 && wrong.length === 0, `${v} s otevřeným upozorněním: ${hl.length} popisků v celých pixelech, zakrytých ${cov.length} ${cov.join(' ')}, klik zaokrouhlený na pixel vybere popsanou entitu (chybně ${wrong.length} ${wrong.join(' ')})`);
  }
  // po zavření upozornění se popisky vrátí i na místa, která zakrývalo (bez změny pohledu)
  await view('iso');
  const withNote = (await hints()).length;
  await p.locator('[data-soft-note] button').click();
  await p.waitForTimeout(300);
  const noNote = await p.evaluate(() => window.mncad.hints());
  await hintsOff();
  ok(noNote.length === 19 && noNote.length > withNote, `zavřené upozornění: popisky všech 19 viditelných entit (s upozorněním ${withNote})`);

  // ── 1) klik na horní plochu (pohled shora, střed plátna) ──
  await view('top');
  let bb = await canvasBox();
  const cx = bb.width / 2, cy = bb.height / 2;
  const before = await pixel(cx, cy);
  await clickAt(cx, cy);
  let s = await sel();
  let hs = await hints();
  const topHint = hs.find((h) => h.kind === 'face' && /\+Z/.test(h.title));
  ok(s.length === 1 && s[0].kind === 'face' && !!topHint && s[0].id === topHint.id, `klik na střed horního pohledu vybere horní plochu (${JSON.stringify(s)}, popisek ${topHint && topHint.id})`);
  await hintsOff();
  await p.waitForTimeout(300);
  const after = await pixel(cx, cy);
  ok(after[0] > after[2] + 40 && after[0] > before[0] - 5 && after[2] < before[2] - 30, `vybraná plocha je v náhledu zvýrazněná barvou výběru (${before.slice(0, 3)} → ${after.slice(0, 3)})`);
  ok(await p.getByRole('toolbar', { name: 'Rychlé příkazy pro výběr' }).isVisible().catch(() => false), 'po kliknutí se u kurzoru objeví rychlá lišta příkazů (jako ve 3D)');
  const status = await p.locator('footer').first().innerText().catch(() => '');
  await p.screenshot({ path: S + 'soft-pick-face.png' });

  // pravé tlačítko na ploše (bez tažení) → kontextová nabídka entity, jako ve 3D okně
  await p.mouse.click(bb.x + cx, bb.y + cy, { button: 'right' });
  await p.waitForTimeout(450);
  ok(await p.getByText('Nová skica na ploše').first().isVisible().catch(() => false) && !(await p.getByRole('toolbar', { name: 'Rychlé příkazy pro výběr' }).isVisible().catch(() => false)), 'pravé tlačítko na ploše otevře kontextovou nabídku entity');
  await p.keyboard.press('Escape');
  await p.waitForTimeout(250);
  // klik mimo model zruší výběr
  await clickAt(30, bb.height - 60);
  ok((await sel()).length === 0, 'klik mimo model zruší výběr');

  // ── 2) izometrie: plocha, Ctrl + klik na hranu, vrchol, najetí ──
  await view('iso');
  hs = await hints();
  const front = hs.find((h) => h.kind === 'face' && /-Y/.test(h.title));
  const edge = hs.find((h) => h.kind === 'edge' && /vodorovná/.test(h.title));
  const edge2 = hs.filter((h) => h.kind === 'edge' && /vodorovná/.test(h.title))[1];
  const vert = hs.find((h) => h.kind === 'vertex');
  ok(hs.filter((h) => h.kind === 'face').length === 3 && hs.filter((h) => h.kind === 'edge').length === 9 && hs.filter((h) => h.kind === 'vertex').length === 7, `popisky v izometrii: 3 plochy, 9 hran, 7 vrcholů (zakryté nemají popisek) – ${hs.map((h) => h.id).join(' ')}`);
  ok(!!(await p.locator('[data-hints] [data-hint]').count()), 'popisky jsou v náhledu vidět jako štítky');
  await p.screenshot({ path: S + 'soft-pick-hints.png' });
  await hintsOff();
  await clickAt(front.x, front.y);
  await clickAt(edge.x, edge.y, ['Control']);
  s = await sel();
  ok(s.length === 2 && s[0].id === front.id && s[1].kind === 'edge' && s[1].id === edge.id, `klik na plochu + Ctrl + klik na hranu → výběr ${s.map((x) => x.id).join(', ')} (čekáno ${front.id}, ${edge.id})`);
  // hrana výběru je v překryvné vrstvě červená
  const ov = await pixel(edge.x, edge.y, '[data-soft-overlay]');
  ok(ov[3] > 0 && ov[0] > 180 && ov[1] < 120, `vybraná hrana je zvýrazněná (překryvná vrstva ${ov})`);
  await clickAt(edge.x, edge.y, ['Control']);
  s = await sel();
  ok(s.length === 1 && s[0].id === front.id, 'druhý Ctrl + klik na tutéž hranu ji z výběru odebere');
  await clickAt(vert.x, vert.y, ['Shift']);
  s = await sel();
  ok(s.length === 2 && s[1].kind === 'vertex' && s[1].id === vert.id, `Shift + klik na vrchol ho přidá (${s.map((x) => x.id).join(', ')})`);
  // najetí myší na hranu → oranžová v překryvné vrstvě, kurzor ruka
  await p.mouse.move(bb.x + edge2.x, bb.y + edge2.y);
  await p.waitForTimeout(400);
  const hov = await pixel(edge2.x, edge2.y, '[data-soft-overlay]');
  const cur = await p.locator('[data-soft-canvas]').evaluate((c) => c.style.cursor);
  ok(hov[3] > 0 && hov[0] > 200 && hov[1] > 120 && hov[2] < 80 && cur === 'pointer', `najetí na hranu ji zvýrazní (${hov}) a kurzor je ruka`);
  const coords = await p.locator('footer').first().innerText();
  ok(/X\s*[\d,.-]+\s*· Y/.test(coords), 'stavový řádek ukazuje souřadnice bodu pod kurzorem');
  await leave();

  // ── 3) Zaoblit z výběru → OK → objem klesne; ve formuláři klik na další hranu ──
  await clickAt(edge.x, edge.y);
  s = await sel();
  ok(s.length === 1 && s[0].id === edge.id, `klik na hranu (bez Ctrl) vybere jen ji (${s.map((x) => x.id)})`);
  await p.getByRole('button', { name: 'Zaoblit', exact: true }).first().click();
  await p.waitForTimeout(700);
  let f = (await doc()).features.slice(-1)[0];
  ok(f.type === 'fillet' && JSON.stringify(f.edges) === JSON.stringify([s[0].index]), `Zaoblit převezme hranu vybranou kliknutím (${JSON.stringify(f.edges)})`);
  ok((await p.locator('[data-soft-viewport]').getAttribute('data-soft-pick')) === 'edges', 'formulář zaoblení přepne náhled do výběru hran');
  const rad = p.locator('input[aria-label="Poloměr"]').first();
  await rad.fill('3');
  await rad.press('Enter');
  await p.waitForTimeout(300);
  // formulář mohl změnit velikost náhledu – polohy hran znovu z popisků
  hs = await hints();
  await hintsOff();
  const e1 = hs.find((h) => h.id === edge.id);
  const e2 = hs.find((h) => h.id === edge2.id);
  ok(!!e1 && !!e2, `hrany ${edge.id} a ${edge2.id} mají ve formuláři popisky`);
  const len = (h) => Number((h.title.match(/délka ≈ ([\d.,]+)/) || [0, '0'])[1].replace(',', '.'));
  // klik na další hranu ve formuláři ji přidá (výběr hran pro formulář)
  await clickAt(e2.x, e2.y);
  f = (await doc()).features.slice(-1)[0];
  ok(f.edges.length === 2 && f.edges.includes(edge2.index), `klik na hranu v otevřeném formuláři ji přidá k zaoblení (${JSON.stringify(f.edges)})`);
  const ovSel = await pixel(e2.x, e2.y, '[data-soft-overlay]');
  ok(ovSel[3] > 0 && ovSel[0] > 180 && ovSel[1] < 120, `hrana zaoblení je v náhledu zvýrazněná (${ovSel})`);
  await clickAt(e2.x, e2.y);
  f = (await doc()).features.slice(-1)[0];
  ok(f.edges.length === 1, 'druhý klik ji z formuláře odebere');
  await p.getByRole('button', { name: 'OK', exact: true }).click();
  await idle();
  await p.waitForTimeout(800);
  const v1 = await vol();
  const cut = (1 - Math.PI / 4) * 9 * len(e1); // úbytek zaoblení R3 na hraně (stav ukazuje objem na 0,01 cm³)
  ok(len(e1) > 0 && near(v0 - v1, cut, 12), `OK → objem klesl o ${(v0 - v1).toFixed(1)} mm³ (čekáno ≈ ${cut.toFixed(1)} – zaoblení R3 na hraně ${len(e1)} mm)`);

  // „+ aktuální výběr“: hrana vybraná kliknutím → otevřené zaoblení ji převezme
  await leave();
  hs = await hints();
  await hintsOff();
  const edge3 = hs.find((h) => h.kind === 'edge' && /svislá/.test(h.title));
  await clickAt(edge3.x, edge3.y);
  s = await sel();
  ok(s.length === 1 && s[0].kind === 'edge', `klik vybere svislou hranu ${s.map((x) => x.id)}`);
  await p.getByText(/^Zaoblení 1$/).first().click();
  await p.waitForTimeout(700);
  const add = p.locator('[data-pick-add-selection]');
  ok(await add.isVisible().catch(() => false), 'formulář zaoblení nabízí „+ aktuální výběr (1)“');
  await add.click();
  await p.waitForTimeout(400);
  f = (await doc()).features.slice(-1)[0];
  ok(f.edges.length === 2 && f.edges.includes(s[0].index), `„+ aktuální výběr“ přidá hranu vybranou kliknutím (${JSON.stringify(f.edges)})`);
  await p.getByRole('button', { name: 'OK', exact: true }).click();
  await idle();
  await p.waitForTimeout(800);
  const v2 = await vol();
  ok(v2 < v1 - 15, `po přidání druhé hrany objem dál klesl (${v1.toFixed(1)} → ${v2.toFixed(1)} mm³)`);
  await p.screenshot({ path: S + 'soft-pick-fillet.png' });

  // ── 4) skica na ploše vybrané kliknutím ──
  await leave();
  await view('top');
  await p.getByRole('button', { name: /^Skica/ }).first().click();
  await p.waitForTimeout(400);
  await p.getByText('Na rovinné ploše modelu…').first().click();
  await p.waitForTimeout(400);
  ok((await p.locator('[data-soft-viewport]').getAttribute('data-soft-pick')) === 'face-plane', 'Skica → Na rovinné ploše: náhled čeká na klik na plochu');
  bb = await canvasBox();
  await clickAt(bb.width / 2, bb.height / 2);
  await p.waitForTimeout(800);
  f = (await doc()).features.slice(-1)[0];
  ok(f.type === 'sketch' && f.plane.kind === 'custom' && near(f.plane.origin[2], 20, 1e-6) && near(Math.abs(f.plane.normal[2]), 1, 1e-6), `klik na horní plochu založí skicu na ní (${JSON.stringify(f.plane).slice(0, 160)})`);
  await p.getByRole('button', { name: 'Zavřít', exact: true }).first().click().catch(() => {});
  await p.waitForTimeout(600);
  if ((await doc()).features.slice(-1)[0].type === 'sketch') await run('smazat poslední');
  await idle();

  // ── 5) měření: dvě rovnoběžné plochy kliknutím ──
  await view('front');
  await p.keyboard.press('m').catch(() => {});
  await p.waitForTimeout(300);
  let measuring = await p.getByText('Měření', { exact: true }).first().isVisible().catch(() => false);
  if (!measuring) {
    await p.getByRole('button', { name: /^Měření|^Měřit/ }).first().click().catch(() => {});
    await p.waitForTimeout(300);
    measuring = await p.getByText('Měření', { exact: true }).first().isVisible().catch(() => false);
  }
  if (measuring) {
    bb = await canvasBox();
    await clickAt(bb.width / 2, bb.height / 2); // přední plocha
    await view('back');
    await clickAt(bb.width / 2, bb.height / 2); // zadní plocha
    const panel = await p.locator('main').innerText();
    ok(/30[,.]?0*\s*mm/.test(panel), 'měření: klik na přední a zadní plochu → vzdálenost 30 mm');
    await p.keyboard.press('Escape');
    await p.waitForTimeout(300);
  } else ok(false, 'měření se nepodařilo otevřít');
  await leave();

  // ── 6) popisky + clickHint, textový příkaz vyber ──
  await view('iso');
  hs = await hints();
  const fh = hs.find((h) => h.kind === 'face');
  ok(await p.evaluate((id) => window.mncad.clickHint(id), fh.id), 'clickHint vrací true');
  await p.waitForTimeout(400);
  s = await sel();
  ok(s.length === 1 && s[0].id === fh.id, `clickHint(${fh.id}) vybere plochu v náhledu (${s.map((x) => x.id)})`);
  await hintsOff();
  const log = await run('vyber F1 E2 V3');
  s = await sel();
  ok(s.map((x) => x.id).join(',') === 'F1,E2,V3' && /F1, E2, V3/.test(String(log)), `textový příkaz „vyber F1 E2 V3“ (${s.map((x) => x.id)}; ${String(log).slice(0, 120)})`);
  await run('vyber F4 přidat');
  s = await sel();
  ok(s.length === 4 && s[3].id === 'F4', '„vyber F4 přidat“ přidá k výběru');
  const shown = await run('vyber');
  ok(/Výběr: F1, E2, V3 \[[-\d,.; ]+\], F4/.test(String(shown)), 'samotné „vyber“ vypíše výběr (vrchol se souřadnicemi): ' + String(shown).split('\n')[0]);
  await run('vyber nic');
  ok((await sel()).length === 0, '„vyber nic“ výběr zruší');
  const bad = await run('vyber F99');
  ok(/F99 v tělese není/.test(String(bad)), 'neexistující plocha → srozumitelná chyba: ' + String(bad).slice(0, 120));

  // ── 6b) oprava po kontrole: text vyber E3;E7, varování textového zaoblení, čísla hran, panel, řez, kurzor ──
  await run('nový díl Text\nkvádr 40 30 20');
  await idle();
  await p.waitForFunction(() => Number(document.querySelector('[data-soft-canvas]')?.dataset.tris) === 12, null, { timeout: 30000 });
  await run('vyber E3;E7');
  s = await sel();
  ok(s.map((x) => x.id).join(',') === 'E3,E7', `„vyber E3;E7“ – id oddělená středníkem (${s.map((x) => x.id)})`);
  const lg = String(await run('vyber E2'));
  ok(/textové příkazy výběr nečtou/.test(lg) && /zaoblit 2 hrany E2/.test(lg) && !/převezmou ho formuláře prvků/.test(lg), 'protokol „vyber E2“ neslibuje, že textové zaoblit výběr převezme, a ukáže zápis čísly: ' + lg.split('\n')[0]);
  const nf = (await doc()).features.length;
  const lgAll = String(await run('zaoblit 1'));
  let ff = (await doc()).features.slice(-1)[0];
  ok(ff.type === 'fillet' && ff.edges === 'all' && /! Zaoblení \d+: zpracují se všechny hrany – vybrané hrany \(E2\) textové příkazy nečtou; jen vybrané: zaoblit 1 hrany E2/.test(lgAll), 'textové „zaoblit 1“ při vybrané hraně: všechny hrany + varování v protokolu (žádná tichá změna)');
  await run('smazat poslední');
  await idle();
  const vt0 = await vol();
  await run('zaoblit 3 hrany E2');
  await idle();
  await p.waitForTimeout(500);
  ff = (await doc()).features.slice(-1)[0];
  const vt1 = await vol();
  ok(ff.type === 'fillet' && JSON.stringify(ff.edges) === '[1]' && (await doc()).features.length === nf + 1 && vt1 < vt0 - 50 && vt1 > vt0 - 400, `„zaoblit 3 hrany E2“ zaoblí jen hranu E2 (${JSON.stringify(ff.edges)}, objem ${vt0} → ${vt1} mm³)`);
  const badNo = String(await run('zaoblit 1 hrany E99'));
  ok(/E99 v tělese není/.test(badNo), 'číslo hrany mimo těleso → srozumitelná chyba: ' + badNo.slice(0, 100));
  await run('smazat poslední');
  await idle();
  // panel vlastností vybrané entity nezakryje popisky
  await view('iso');
  await run('vyber F2');
  await p.waitForTimeout(700);
  let hl = await hints();
  await hintsOff();
  let cov = await coveredHints(hl);
  ok(hl.length >= 7 && cov.length === 0, `s vybranou plochou (panel vlastností otevřený): ${hl.length} popisků, žádný pod panelem či lištou (${cov.join(' ')})`);
  await run('vyber nic');
  // řez Z 10: hrany rozříznuté rovinou – popisky mimo hranici řezu, klik celým pixelem vybere popsanou entitu
  await run('řez Z 10');
  await p.waitForTimeout(600);
  await view('iso');
  hl = await hints();
  await hintsOff();
  const wrongSec = await clickEachHint(hl);
  ok(hl.length >= 7 && wrongSec.length === 0, `řez Z 10, izometrie: ${hl.length} popisků, klik zaokrouhlený na pixel vybere popsanou entitu (chybně ${wrongSec.join(' ')})`);
  await run('řez vyp');
  await p.waitForTimeout(400);
  // kurzor: tažení začaté na modelu ukazuje „ruku“ (grabbing), ne „pointer“ z najetí
  bb = await canvasBox();
  await p.mouse.move(bb.x + bb.width / 2, bb.y + bb.height / 2);
  await p.waitForTimeout(250);
  const curHover = await p.locator('[data-soft-canvas]').evaluate((c) => getComputedStyle(c).cursor);
  await p.mouse.down();
  for (let i = 1; i <= 6; i++) await p.mouse.move(bb.x + bb.width / 2 + i * 10, bb.y + bb.height / 2 + i * 3);
  const curDrag = await p.locator('[data-soft-canvas]').evaluate((c) => getComputedStyle(c).cursor);
  await p.mouse.up();
  ok(curHover === 'pointer' && curDrag === 'grabbing', `kurzor: najetí na model ${curHover}, tažení z modelu ${curDrag}`);
  await view('iso');

  // ── 7) sestava: klik vybere komponentu, filtr Plocha vrátí plochu komponenty ──
  await run('nový díl Kostka\nkvádr 40 30 20');
  await idle();
  await run('nová sestava Sestava A\nvložit "Kostka" v 0 0 0\nvložit "Kostka" v 80 0 0');
  await p.waitForFunction(() => Number(document.querySelector('[data-soft-canvas]')?.dataset.tris) >= 24, null, { timeout: 60000 }).catch(() => {});
  await p.waitForTimeout(1800);
  await view('top');
  bb = await canvasBox();
  // dva kvádry vedle sebe (x 0–40 a 80–120): střed pravého je ve 4/5 šířky obrysu
  // obrys modelu v náhledu (po otevření panelu komponenty se náhled zúží – polohy se počítají znovu)
  const boxes = async () => {
    await p.waitForTimeout(400);
    const cs = await p.evaluate(() => { const c = document.querySelector('[data-soft-canvas]'); const r = c.getBoundingClientRect(); const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data; let x0 = 1e9, x1 = -1, y0 = 1e9, y1 = -1; for (let i = 0, k = 0; i < d.length; i += 4, k++) { if (!d[i + 3]) continue; const x = k % c.width, y = (k / c.width) | 0; if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; } const s = r.width / c.width; return { x0: x0 * s, x1: x1 * s, y0: y0 * s, y1: y1 * s }; });
    return { rx: cs.x0 + (cs.x1 - cs.x0) * (100 / 120), lx: cs.x0 + (cs.x1 - cs.x0) * (20 / 120), ry: (cs.y0 + cs.y1) / 2 };
  };
  let { rx, lx, ry } = await boxes();
  await clickAt(rx, ry);
  s = await sel();
  ok(s.length === 1 && s[0].kind === 'component', `sestava: klik vybere komponentu (${JSON.stringify(s)})`);
  const right = s[0] && s[0].compId;
  // filtr výběru Plocha (stavový řádek): klik vybere plochu komponenty s id komponenty
  const filt = p.locator('footer select').filter({ has: p.locator('option[value="face"]') }).first();
  await filt.selectOption('face');
  ({ rx, lx, ry } = await boxes());
  await clickAt(rx, ry);
  s = await sel();
  ok(s.length === 1 && s[0].kind === 'face' && /^#[12]:F\d+$/.test(s[0].id) && s[0].compId === right, `sestava, filtr Plocha: klik vybere plochu komponenty – dvě stejné komponenty mají id #1 / #2 (${JSON.stringify(s)})`);
  ({ rx, lx, ry } = await boxes());
  await clickAt(lx, ry);
  const sl = await sel();
  ok(sl.length === 1 && sl[0].kind === 'face' && sl[0].compId && sl[0].compId !== right && sl[0].id !== s[0].id, `klik na levý kvádr vybere plochu druhé komponenty s jiným id (${sl[0] && sl[0].id} vs ${s[0] && s[0].id})`);
  // id z výběru projde zpět textem na tutéž instanci; víceznačný název je chyba s výčtem
  await run('vyber ' + s[0].id);
  const back = await sel();
  ok(back.length === 1 && back[0].compId === right && back[0].id === s[0].id, `„vyber ${s[0].id}“ vybere tutéž instanci (${JSON.stringify(back)})`);
  const amb = String(await run('vyber Kostka:F3'));
  ok(/„Kostka“ je v sestavě 2× – zadejte pořadí: #1, #2/.test(amb), 'víceznačný název komponenty → chyba s výčtem #1, #2: ' + amb.slice(0, 120));
  const msr = String(await run('měřit #1:F1 #2:F1'));
  ok(!/✗ řádek/.test(msr) && /#1:F1 \(rovina\) ↔ #2:F1 \(rovina\): vzdálenost 80 mm/.test(msr), 'měřit s id #1:F1 #2:F1 (stejné komponenty) – ' + msr.split('\n').slice(0, 2).join(' / ').slice(0, 140));
  await run('vyber nic');
  await filt.selectOption('component');
  // vazba Kontakt kliknutím: plocha pohyblivé komponenty, pak plocha cílové
  ({ rx, lx, ry } = await boxes());
  await clickAt(rx, ry);
  const panel = p.locator('aside').filter({ hasText: 'Komponenta ·' });
  await panel.locator('[data-mate-mode="mate"]').click();
  await p.waitForTimeout(400);
  ok((await p.locator('[data-soft-viewport]').getAttribute('data-soft-pick')) === 'asmFace', 'vazba: náhled čeká na klik na plochu komponenty');
  ({ rx, lx, ry } = await boxes());
  await clickAt(rx, ry);
  await p.waitForTimeout(800);
  ok(await panel.locator('[data-face-chosen="a"]').isVisible().catch(() => false), 'vazba krok 1: klik na plochu pohyblivé komponenty ji zvolí');
  await clickAt(lx, ry);
  const md = await p.waitForFunction(() => (window.mncad.getDocument().mates || []).length === 1, null, { timeout: 15000 }).then(() => doc()).catch(() => doc());
  const mt = (md.mates || [])[0];
  ok(!!mt && mt.a.compId === right && mt.b.compId !== right, `vazba vytvořená dvěma kliky v náhledu bez WebGL (${JSON.stringify(mt)})`);
  await p.screenshot({ path: S + 'soft-pick-asm.png' });

  // řez sestavy plochou: rada říká, že je třeba filtr Plocha; klik s filtrem Komponenta ohlásí výběr celé komponenty
  await p.keyboard.press('Escape');
  await run('vyber nic');
  await run('řez Z 15');
  await p.waitForTimeout(500);
  await p.locator('[data-section-tab="face"]').click();
  await p.waitForTimeout(300);
  const w0 = await p.locator('[data-section-wait]').innerText().catch(() => '');
  ok(/přepněte filtr výběru na Plocha/.test(w0), 'řez sestavy, záložka Plocha: rada říká přepnout filtr výběru na Plocha – ' + w0.slice(0, 90));
  await view('front');
  await p.waitForTimeout(400);
  const plane0 = await p.locator('[data-section-controls]').getAttribute('data-section-plane');
  // střed prvního souvislého úseku modelu v prostřední řádce náhledu, kam klik dopadne na plátno (komponenty se po
  // vazbě mohly posunout; levou část může zakrývat panel řezu)
  const [lx2, fy] = await p.evaluate(() => {
    const c = document.querySelector('[data-soft-canvas]'); const r = c.getBoundingClientRect(); const s = r.width / c.width;
    for (let k = 3; k <= 9; k++) {
      // řádky od středu dolů a nahoru (model po vazbě může ležet mimo střed)
      for (const y of [Math.round((c.height * k) / 12), Math.round((c.height * (12 - k)) / 12)]) {
        const d = c.getContext('2d').getImageData(0, y, c.width, 1).data;
        const runs = []; let a = -1;
        for (let x = 0; x <= c.width; x++) { const on = x < c.width && d[x * 4 + 3]; if (on && a < 0) a = x; if (!on && a >= 0) { runs.push([a, x - 1]); a = -1; } }
        const hit = runs.filter(([u, v]) => v - u > 20).map(([u, v]) => ((u + v) / 2) * s).find((x) => document.elementFromPoint(r.left + x, r.top + y * s) === c);
        if (hit !== undefined) return [hit, y * s];
      }
    }
    return [-1, -1];
  });
  await clickAt(lx2, fy);
  const w1 = await p.locator('[data-section-wait]').innerText().catch(() => '');
  const sw1 = await sel();
  await p.screenshot({ path: S + 'soft-pick-asm-section.png' });
  ok(/Vybrána je celá komponenta/.test(w1), `klik s filtrem Komponenta (${Math.round(lx2)}, ${Math.round(fy)} → ${sw1.map((x) => x.id)}): panel řekne, že je vybraná celá komponenta – ` + w1.slice(0, 80));
  await filt.selectOption('face');
  await clickAt(lx2, fy);
  const plane1 = await p.locator('[data-section-controls]').getAttribute('data-section-plane');
  ok(plane1 !== plane0 && !(await p.locator('[data-section-wait]').isVisible().catch(() => false)), `s filtrem Plocha klik položí rovinu řezu na plochu komponenty (${plane0} → ${plane1})`);
  await filt.selectOption('component');
  await run('řez vyp');
  await p.waitForTimeout(300);

  // ── 8) velká síť (≈ 800 tisíc trojúhelníků): index výběru a popisky bez zamrzání (oprava po kontrole) ──
  if (process.env.E2E_SKIP_BIG !== '1') {
    await run('nový díl Deska\nkvádr 200 200 10\ndíra 4 skrz v 5 5 10\npole 20 rozteč 10 směr X 20 rozteč 10 směr Y\nzaoblit 1');
    await idle();
    await p.waitForFunction(() => Number(document.querySelector('[data-soft-canvas]')?.dataset.tris) > 300000, null, { timeout: 600000 });
    await p.waitForTimeout(2500);
    const big = await p.evaluate(async () => {
      const c = document.querySelector('[data-soft-canvas]'); const b = c.getBoundingClientRect();
      const wheel = (dy) => c.dispatchEvent(new WheelEvent('wheel', { clientX: b.left + b.width / 2, clientY: b.top + b.height / 2, deltaY: dy, bubbles: true, cancelable: true }));
      const move = (k) => { const t0 = performance.now(); c.dispatchEvent(new PointerEvent('pointermove', { clientX: b.left + b.width / 2 + k, clientY: b.top + b.height / 2 + k, bubbles: true, pointerType: 'mouse', pointerId: 1 })); return performance.now() - t0; };
      const raf2 = () => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
      move(1); // první najetí postaví index
      const firstIx = Number(c.dataset.pickMs);
      // přibližování po krocích s pohybem myši mezi nimi: index se během pohybu pohledu nestaví
      const moves = [];
      for (let i = 0; i < 4; i++) { wheel(-40); await new Promise((r) => setTimeout(r, 30)); moves.push(move(2 + i)); }
      await new Promise((r) => setTimeout(r, 1500));
      // popisky zapnuté: jeden krok kolečka → dlouhé úlohy hlavního vlákna
      window.mncad.hints(true);
      await new Promise((r) => setTimeout(r, 6000));
      const tasks = []; const po = new PerformanceObserver((l) => { for (const e of l.getEntries()) tasks.push(Math.round(e.duration)); }); po.observe({ type: 'longtask' });
      wheel(-60);
      let n = 0; const t0 = performance.now();
      while (performance.now() - t0 < 15000) { await new Promise((r) => setTimeout(r, 250)); n = document.querySelectorAll('[data-hint]').length; if (n > 50 && performance.now() - t0 > 1500) break; }
      const arrive = performance.now() - t0;
      po.disconnect();
      wheel(-30); await raf2();
      const h0 = performance.now(); const hl = window.mncad.hints(); const hintsMs = performance.now() - h0;
      window.mncad.hints(false);
      return { tris: Number(c.dataset.tris), firstIx, moves: moves.map((x) => Math.round(x * 10) / 10), tasks, n, arrive: Math.round(arrive), hintsMs: Math.round(hintsMs), hl: hl.length };
    });
    ok(big.tris > 300000 && Math.max(...big.moves) < 25, `velká síť ${big.tris} trojúhelníků: při přibližování se index nestaví na každý pohyb myši (pohyby ${big.moves.join(', ')} ms; první stavba ${big.firstIx} ms)`);
    ok(big.n > 50 && big.tasks.every((t) => t < 800), `popisky zapnuté, krok kolečka: dlouhé úlohy ${JSON.stringify(big.tasks)} ms (dřív až 2601 ms), ${big.n} popisků za ${big.arrive} ms`);
    ok(big.hl > 50 && big.hintsMs < 2000, `window.mncad.hints() po přiblížení: ${big.hl} popisků za ${big.hintsMs} ms (dřív 2376 ms)`);
  }

  ok(dialogs === 0, `žádné systémové dialogy (${dialogs})`);
  ok(errs.length === 0, 'žádná nezachycená JS chyba: ' + errs.join(' | '));
  void status;
  await b.close();
})().catch((e) => { console.error('ERR', e.message); process.exit(1); });
