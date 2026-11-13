// E2E: mikronávody u ikon pásu karet (micro-tip.tsx, src/cad/help/tips.ts).
// Pro každou kartu pásu v dílu (vč. otevřené skici), kartu Sestava v sestavě, rozbalovací nabídky tlačítek, rychlou lištu
// u výběru a pracovní plochu výkresu: najetí myší na každé tlačítko → bublina [role=tooltip] s názvem a řádkem „co dělá“
// (ne náhrada), uvnitř okna, nepřekrývá své tlačítko. Dále: neaktivní tlačítko s důvodem, Esc, přepnutí na souseda bez
// prodlevy, fokus klávesnicí, vypnutí v Nastavení (nativní title zpět), dlouhý stisk na dotyku (bez spuštění příkazu),
// angličtina a němčina (líně načtené balíky), snímky ve světlém a tmavém prostředí.
// Spuštění: E2E_BASE=http://localhost:3100 node e2e/cad-tips.e2e.cjs <složka>   (PHASE=a|b|c pro jen část)
const { chromium } = require('playwright');
const fs = require('fs');
const S = (process.argv[2] || '/tmp/e2e').replace(/\/?$/, '/');
fs.mkdirSync(S, { recursive: true });
const BASE = (process.env.E2E_BASE || 'http://localhost:3100').replace(/\/$/, '');
const PHASE = process.env.PHASE || 'abc';
const ok = (c, m) => { console.log((c ? 'ok: ' : 'FAIL: ') + m); if (!c) process.exitCode = 1; };
const summary = [];

async function open(p, path) {
  await p.goto(BASE + path, { waitUntil: 'networkidle', timeout: 240000 });
  const c = p.getByText(/Pokračovat v práci|Continue working|Weiterarbeiten/);
  if (await c.isVisible({ timeout: 6000 }).catch(() => false)) await c.click();
  await p.waitForFunction(() => document.body.innerText.includes('OCCT') && !/Načítám jádro|Loading kernel|Lade Kern/.test(document.body.innerText), null, { timeout: 180000 });
  await p.waitForTimeout(800);
  await p.keyboard.press('Escape').catch(() => {});
}
const idle = (p) => p.waitForFunction(() => !window.mncad.progress(), null, { timeout: 120000 });
const run = async (p, text) => { await p.evaluate((t) => window.mncad.run(t), text); await idle(p); await p.waitForTimeout(500); };

/** Bublina (nebo null): druh, klíč, text, obdélník, okno, důvod, řádek „co“, název. */
const tipInfo = (p) => p.evaluate(() => {
  const t = document.querySelector('#cad-microtip[role="tooltip"]');
  if (!t) return null;
  const r = t.getBoundingClientRect();
  return { kind: t.getAttribute('data-microtip'), for: t.getAttribute('data-tip-for'), text: t.innerText, title: t.querySelector('p')?.textContent || '', vis: getComputedStyle(t).visibility, rect: { l: r.left, t: r.top, r: r.right, b: r.bottom }, vw: innerWidth, vh: innerHeight, why: t.querySelector('[data-tip-why]')?.textContent || '', what: t.querySelector('[data-tip-what]')?.textContent || '' };
});
const overlap = (a, b) => !(a.r <= b.l + 0.5 || b.r <= a.l + 0.5 || a.b <= b.t + 0.5 || b.b <= a.t + 0.5);
const inside = (i) => i.rect.l >= -0.5 && i.rect.t >= -0.5 && i.rect.r <= i.vw + 0.5 && i.rect.b <= i.vh + 0.5;
const clickTab = (p, name) => p.evaluate((n) => { const row = document.querySelector('[data-ribbon]').previousElementSibling; const b = [...row.querySelectorAll(':scope > button')].find((x) => x.innerText.trim() === n); if (!b) throw new Error('karta ' + n); b.click(); }, name);
const tabNames = (p) => p.evaluate(() => [...document.querySelector('[data-ribbon]').previousElementSibling.querySelectorAll(':scope > button')].map((x) => x.innerText.trim()));
const park = async (p) => { await p.mouse.move(3, (await p.evaluate(() => innerHeight)) - 3); await p.waitForTimeout(700); };

/**
 * Údaje k i-tému obalu s mikronávodem v kontejneru: klíč, název (z props komponenty), neaktivní, má nabídku,
 * střed (po posunu do viditelné části pásu / panelu). Vrací null, když prvek není vidět (sbalená sekce).
 */
const PREP = ([sel, i]) => {
  const el = document.querySelectorAll(sel)[i];
  if (!el) return null;
  const fiberOf = (x) => { const k = Object.keys(x).find((y) => y.startsWith('__reactFiber$')); return k ? x[k] : null; };
  let f = fiberOf(el); let spec = null;
  for (let n = 0; f && n < 10; n++, f = f.return) {
    const pr = f.memoizedProps || {};
    if (pr.it && pr.it.id) { spec = pr.it; break; }
    if (pr.e && pr.e.id) { spec = pr.e; break; }
    if (pr.tip && pr.tip.id) { spec = pr.tip; break; }
  }
  const btn = el.matches('button') ? el : el.querySelector('button');
  let r = el.getBoundingClientRect();
  if (r.width === 0 || r.height === 0) return null;
  // mimo viditelnou část posuvného pásu / panelu → posunout
  const sc = el.closest('[data-ribbon]')?.firstElementChild;
  const box = sc ? sc.getBoundingClientRect() : { left: 0, right: innerWidth, top: 0, bottom: innerHeight };
  let scrolled = false;
  if (r.left < box.left || r.right > box.right || r.top < 0 || r.bottom > innerHeight) {
    el.scrollIntoView({ block: 'nearest', inline: 'center' });
    r = el.getBoundingClientRect();
    scrolled = true; // událost scroll přijde až v dalším snímku a bublinu skryje – volající chvíli počká
  }
  const ctx = el.getAttribute('data-tip-ctx');
  const id = el.getAttribute('data-tip-id');
  return { scrolled, key: ctx ? `${ctx}/${id}` : id, id, ctx, label: spec ? spec.label : '', disabled: !!(btn && btn.disabled), menu: !!(spec && spec.menu && spec.menu.length), rect: { l: r.left, t: r.top, r: r.right, b: r.bottom }, x: r.left + r.width / 2, y: r.top + r.height / 2 };
};

/**
 * Najede myší na každé tlačítko kontejneru a zkontroluje bublinu. Vrací { checked, full, fails, items }.
 * `menus` = otevřít nabídky aktivních tlačítek a zkontrolovat i jejich položky (výsledek pod klíčem menus).
 */
async function sweep(p, sel, { menus = false, place = '' } = {}) {
  const n = await p.locator(sel).count();
  const res = { checked: 0, full: 0, disabled: 0, hidden: 0, fails: [], menuItems: { checked: 0, full: 0, fails: [] } };
  const menuBtns = [];
  for (let i = 0; i < n; i++) {
    let it = await p.evaluate(PREP, [sel, i]);
    if (!it) { res.hidden++; continue; }
    if (it.scrolled) await p.waitForTimeout(250);
    let info = null;
    for (let attempt = 0; attempt < 2 && !info; attempt++) {
      if (attempt) { await park(p); it = (await p.evaluate(PREP, [sel, i])) || it; }
      await p.mouse.move(it.x, it.y);
      const got = await p.waitForFunction((k) => { const t = document.querySelector('#cad-microtip'); return !!t && t.getAttribute('data-tip-for') === k && getComputedStyle(t).visibility !== 'hidden'; }, it.key, { timeout: 3000 }).then(() => true, () => false);
      if (got) info = await tipInfo(p);
    }
    res.checked++;
    if (it.disabled) res.disabled++;
    const problems = [];
    if (!info) problems.push('bublina se neukázala');
    else {
      if (info.kind !== 'full') problems.push('náhrada místo návodu');
      if (!info.what.trim()) problems.push('chybí řádek „co“');
      if (!info.title.trim() || (it.label && info.title.trim() !== it.label.trim())) problems.push(`název „${info.title}“ ≠ „${it.label}“`);
      if (!inside(info)) problems.push(`mimo okno ${JSON.stringify(info.rect)}`);
      if (overlap(info.rect, it.rect)) problems.push('překrývá tlačítko');
    }
    if (problems.length) res.fails.push(`${it.key}: ${problems.join(', ')}`);
    else res.full++;
    if (menus && it.menu && !it.disabled) menuBtns.push(i);
  }
  for (const i of menuBtns) {
    const it = await p.evaluate(PREP, [sel, i]);
    if (!it) continue;
    await p.mouse.click(it.x, it.y);
    const opened = await p.waitForSelector('[data-cad-menu] [data-tip-id]', { timeout: 4000 }).then(() => true, () => false);
    if (!opened) { res.menuItems.fails.push(`menu:${it.id}: nabídka se neotevřela`); continue; }
    await p.waitForTimeout(250);
    const m = await sweep(p, '[data-cad-menu] [data-tip-id]', { place: `${place} › menu:${it.id}` });
    res.menuItems.checked += m.checked;
    res.menuItems.full += m.full;
    res.menuItems.fails.push(...m.fails);
    await p.keyboard.press('Escape'); await p.waitForTimeout(150);
    if (await p.locator('[data-cad-menu]').count()) { await p.keyboard.press('Escape'); await p.waitForTimeout(150); }
    if (await p.locator('[data-cad-menu]').count()) { await park(p); await p.mouse.click(3, (await p.evaluate(() => innerHeight)) - 3); await p.waitForTimeout(200); }
  }
  await park(p);
  return res;
}

function report(place, r) {
  summary.push({ place, checked: r.checked, full: r.full, disabled: r.disabled, menuChecked: r.menuItems.checked, menuFull: r.menuItems.full });
  ok(r.checked > 0 && r.fails.length === 0, `${place}: ${r.full}/${r.checked} tlačítek s návodem (neaktivních ${r.disabled}${r.hidden ? `, skrytých ${r.hidden}` : ''})${r.fails.length ? '\n    ' + r.fails.slice(0, 12).join('\n    ') : ''}`);
  if (r.menuItems.checked || r.menuItems.fails.length) ok(r.menuItems.fails.length === 0, `${place} – položky nabídek: ${r.menuItems.full}/${r.menuItems.checked}${r.menuItems.fails.length ? '\n    ' + r.menuItems.fails.slice(0, 12).join('\n    ') : ''}`);
}

async function hoverKey(p, sel) {
  const it = await p.evaluate(PREP, [sel, 0]);
  if (it.scrolled) await p.waitForTimeout(250);
  await p.mouse.move(it.x, it.y);
  await p.waitForFunction((k) => document.querySelector('#cad-microtip')?.getAttribute('data-tip-for') === k, it.key, { timeout: 4000 }).catch(() => {});
  await p.waitForTimeout(120);
  return { it, info: await tipInfo(p) };
}

(async () => {
  const b = await chromium.launch({ args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader'] });
  const errs = [];
  let nativeDialogs = 0;
  const page = async (ctx) => { const p = await ctx.newPage(); p.on('pageerror', (e) => errs.push(e.message)); p.on('dialog', (d) => { nativeDialogs++; d.dismiss().catch(() => {}); }); return p; };

  if (PHASE.includes('a')) {
    const ctx = await b.newContext({ viewport: { width: 1430, height: 880 } });
    const p = await page(ctx);
    await open(p, '/cad');
    await run(p, 'nový díl Návody\nkvádr 60 40 20');

    // ── základní chování na jednom tlačítku ──
    const ext = '[data-ribbon] [data-tip-id="extrude"]';
    let it = await p.evaluate(PREP, [ext, 0]);
    await p.mouse.move(it.x, it.y);
    await p.waitForTimeout(120);
    ok(!(await tipInfo(p)), 'před prodlevou ~400 ms bublina ještě není');
    await p.waitForSelector('#cad-microtip', { timeout: 3000 });
    let t = await tipInfo(p);
    ok(t && t.kind === 'full' && t.title === 'Vysunout' && /Kdy použít/i.test(t.text) && /Postup/i.test(t.text) && /vysunout 10/.test(t.text), `Vysunout: plný návod s oddíly a příkazem (${t && t.what.slice(0, 60)})`);
    ok(await p.evaluate((s) => { const bt = document.querySelector(s + ' button'); return !bt.getAttribute('title') && bt.getAttribute('aria-describedby') === 'cad-microtip'; }, ext), 'tlačítko bez nativního title, aria-describedby → bublina');
    await p.screenshot({ path: S + 'tips-big-light.png' });
    const r2 = await p.evaluate(PREP, ['[data-ribbon] [data-tip-id="revolve"]', 0]);
    await p.mouse.move(r2.x, r2.y);
    await p.waitForTimeout(60);
    t = await tipInfo(p);
    ok(t && t.for === 'create/revolve', 'přejetí na sousední tlačítko přepne bublinu hned (bez nové prodlevy)');
    await p.keyboard.press('Escape'); await p.waitForTimeout(150);
    ok(!(await tipInfo(p)), 'Esc bublinu skryje');
    await p.mouse.move(r2.x + 2, r2.y + 1); await p.waitForTimeout(700);
    ok(!(await tipInfo(p)), 'po Esc se nad stejným tlačítkem do opuštění znovu neukáže');
    await park(p);

    // neaktivní tlačítko (Barva plochy bez vybrané plochy)
    const fc = await hoverKey(p, '[data-ribbon] [data-tip-id="faceColor"]');
    ok(fc.it.disabled && fc.info && fc.info.kind === 'full' && fc.info.why.length > 5, `neaktivní tlačítko ukáže návod i s důvodem („${fc.info && fc.info.why}“)`);
    await p.screenshot({ path: S + 'tips-disabled.png' });
    await park(p);

    // kliknutí bublinu zavře
    it = await p.evaluate(PREP, ['[data-ribbon] [data-tip-id="box"]', 0]);
    await p.mouse.move(it.x, it.y); await p.waitForSelector('#cad-microtip', { timeout: 3000 });
    await p.mouse.down(); await p.mouse.up(); await p.waitForTimeout(500);
    ok(!(await tipInfo(p)), 'kliknutí bublinu skryje');
    await p.keyboard.press('Escape'); await p.waitForTimeout(300);
    for (let k = 0; k < 3 && (await p.getByRole('button', { name: 'Storno', exact: true }).count()); k++) { await p.getByRole('button', { name: 'Storno', exact: true }).first().click().catch(() => {}); await p.waitForTimeout(300); }
    await park(p);

    // fokus klávesnicí
    await p.locator('[data-ribbon] [data-tip-id="cylinder"] button').first().focus().catch(() => {});
    await p.keyboard.press('Shift+Tab'); await p.keyboard.press('Tab'); await p.waitForTimeout(150);
    t = await tipInfo(p);
    ok(!!t && t.kind === 'full', `fokus klávesnicí (Tab) ukáže návod hned (${t && t.for})`);
    await p.keyboard.press('Escape'); await p.evaluate(() => document.activeElement && document.activeElement.blur());
    await park(p);

    // ── všechny karty dílu ──
    const names = await tabNames(p);
    for (const name of names) {
      await clickTab(p, name); await p.waitForTimeout(500);
      const ctxName = await p.evaluate(() => document.querySelector('[data-ribbon] [data-tip-ctx]')?.getAttribute('data-tip-ctx') || '');
      const r = await sweep(p, '[data-ribbon] [data-tip-id]', { menus: true, place: `díl › ${name}` });
      report(`díl › karta ${name} (${ctxName})`, r);
    }
    await clickTab(p, names[1]); await p.waitForTimeout(200);
    it = await p.evaluate(PREP, ['[data-ribbon] [data-tip-id]', 0]);
    await p.mouse.move(it.x, it.y); await p.waitForSelector('#cad-microtip', { timeout: 3000 }).catch(() => {});
    await clickTab(p, names[0]); await p.waitForTimeout(250);
    ok(!(await tipInfo(p)), 'změna karty bublinu skryje');
    await park(p);

    // položka nabídky – bublina vedle nabídky, snímek
    await p.locator('[data-ribbon] [data-tip-id="sketch"] button').click();
    await p.waitForSelector('[data-cad-menu] [data-tip-id="xy"]');
    const mi = await hoverKey(p, '[data-cad-menu] [data-tip-id="xy"]');
    const menuRect = await p.evaluate(() => { const r = document.querySelector('[data-cad-menu]').getBoundingClientRect(); return { l: r.left, t: r.top, r: r.right, b: r.bottom }; });
    ok(mi.info && mi.info.for === 'menu:sketch/xy' && mi.info.kind === 'full' && !overlap(mi.info.rect, menuRect), 'položka nabídky: návod vedle nabídky (nepřekrývá ji)');
    await p.screenshot({ path: S + 'tips-menu-entry.png' });

    // ── karta Skica (otevřená skica) ──
    await p.mouse.click(mi.it.x, mi.it.y); await p.waitForTimeout(1500);
    const sk = await sweep(p, '[data-ribbon] [data-tip-id]', { menus: true, place: 'díl › Skica' });
    report('díl › karta Skica (sketch)', sk);
    // nejvyšší hustota pásu (malá tlačítka jen ikonou) v užším okně
    await p.setViewportSize({ width: 1024, height: 760 }); await p.waitForTimeout(800);
    const dens = await p.evaluate(() => document.querySelector('[data-ribbon]').getAttribute('data-ribbon-density'));
    const small = await hoverKey(p, '[data-ribbon] [data-tip-id="con-perpendicular"]');
    ok(dens === '2' && small.info && small.info.kind === 'full' && inside(small.info) && !overlap(small.info.rect, small.it.rect), `malé tlačítko jen s ikonou při hustotě ${dens}: návod v okně, tlačítko nezakrývá`);
    await p.screenshot({ path: S + 'tips-small-icon.png' });
    const edge = await hoverKey(p, '[data-ribbon] [data-tip-id="snap-auto"]');
    ok(edge.info && inside(edge.info) && !overlap(edge.info.rect, edge.it.rect), 'tlačítko u pravého okraje: bublina přitažená do okna');
    await p.screenshot({ path: S + 'tips-right-edge.png' });
    await p.setViewportSize({ width: 1430, height: 880 }); await p.waitForTimeout(600);
    await park(p);
    await p.getByRole('button', { name: 'Zavřít', exact: true }).first().click().catch(() => {}); await p.waitForTimeout(800);

    // ── rychlá lišta u výběru (klik na plochu modelu) ──
    await clickTab(p, names[0]); await p.waitForTimeout(300);
    await p.evaluate(() => window.mncad.run('zobraz iso')).catch(() => {}); await p.waitForTimeout(800);
    const vp = await p.evaluate(() => { const c = document.querySelector('main canvas'); if (!c) return null; const r = c.getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width, h: r.height }; });
    let quick = false;
    if (vp) for (const [fx, fy] of [[0.5, 0.5], [0.5, 0.45], [0.55, 0.5], [0.45, 0.55], [0.5, 0.6]]) {
      await p.mouse.click(vp.x + vp.w * fx, vp.y + vp.h * fy); await p.waitForTimeout(800);
      if (await p.locator('[role="toolbar"][data-cad-menu] [data-tip-id]').count()) { quick = true; break; }
    }
    ok(quick, 'klik na plochu ukáže rychlou lištu u výběru');
    if (quick) report('díl › rychlá lišta u výběru (quick)', await sweep(p, '[role="toolbar"][data-cad-menu] [data-tip-id]', { place: 'quick' }));
    await p.keyboard.press('Escape'); await p.waitForTimeout(300);

    // ── pracovní plocha výkresu ──
    await clickTab(p, 'Výkres'); await p.waitForTimeout(300);
    await p.locator('[data-ribbon] [data-tip-id="drw"] button').click();
    await p.waitForSelector('[data-drawing-workspace] [data-tip-id]', { timeout: 60000 });
    await p.waitForFunction(() => !/Promítám pohledy/.test(document.querySelector('[data-drawing-workspace]').innerText), null, { timeout: 120000 }).catch(() => {});
    await p.waitForTimeout(1500);
    const dw = await sweep(p, '[data-drawing-workspace] [data-tip-id]', { place: 'výkres' });
    report('pracovní plocha výkresu (drawing-ws)', dw);
    await hoverKey(p, '[data-drawing-workspace] [data-tip-id="ann-dim"]');
    await p.screenshot({ path: S + 'tips-drawing.png' });
    await park(p);
    await p.locator('[data-drawing-workspace] [data-tip-id="close"] button').first().click().catch(() => {}); await p.waitForTimeout(800);

    // ── sestava: karta Sestava ──
    await run(p, 'nová sestava Návody sestava');
    await run(p, 'vložit "Návody" ukotvit').catch(() => {});
    await clickTab(p, 'Sestava').catch(() => {}); await p.waitForTimeout(500);
    const asm = await sweep(p, '[data-ribbon] [data-tip-id]', { menus: true, place: 'sestava › Sestava' });
    report('sestava › karta Sestava (asm)', asm);
    const dis = await p.evaluate(() => [...document.querySelectorAll('[data-ribbon] [data-tip-id]')].filter((w) => w.querySelector('button')?.disabled).map((w) => w.getAttribute('data-tip-id')));
    if (dis.length) {
      const d = await hoverKey(p, `[data-ribbon] [data-tip-id="${dis[0]}"]`);
      ok(d.info && d.info.kind === 'full' && d.info.why.length > 5, `sestava: neaktivní „${dis[0]}“ ukáže návod s důvodem („${d.info && d.info.why}“)`);
      await park(p);
    }
    await p.close();
    await ctx.close();
  }

  if (PHASE.includes('b')) {
    // ── tmavé prostředí: systém v tmavém režimu + pozadí Grafit ──
    const dctx = await b.newContext({ viewport: { width: 1430, height: 880 }, colorScheme: 'dark' });
    const dp = await page(dctx);
    await open(dp, '/cad');
    await run(dp, 'nový díl Tma\nkvádr 60 40 20');
    await clickTab(dp, 'Zobrazení'); await dp.waitForTimeout(300);
    await dp.locator('[data-ribbon] [data-tip-id="bg"] button').click();
    await dp.locator('[data-cad-menu] [data-tip-id="dark"] button').click(); await dp.waitForTimeout(600);
    await clickTab(dp, 'Tvorba'); await dp.waitForTimeout(300);
    const dk = await hoverKey(dp, '[data-ribbon] [data-tip-id="fillet"]');
    const colors = await dp.evaluate(() => { const t = document.querySelector('#cad-microtip'); const cs = getComputedStyle(t); return { bg: cs.backgroundColor, fg: cs.color }; });
    ok(dk.info && dk.info.kind === 'full' && /255, 255, 255/.test(colors.bg) && !/255, 255, 255/.test(colors.fg), `tmavé pozadí: bublina čitelná (pozadí ${colors.bg}, text ${colors.fg})`);
    await dp.screenshot({ path: S + 'tips-dark.png' });
    // vypnutí v Nastavení → bez bubliny, nativní title zpět
    await park(dp);
    await dp.keyboard.press('Control+,'); await dp.waitForTimeout(600);
    const toggle = dp.getByText('Mikronávody u ikon').first();
    ok(await toggle.isVisible().catch(() => false), 'Nastavení: přepínač „Mikronávody u ikon“');
    await toggle.click(); await dp.waitForTimeout(200);
    await dp.getByRole('button', { name: 'OK', exact: true }).click(); await dp.waitForTimeout(500);
    const offState = await dp.evaluate(() => ({ s: JSON.parse(localStorage.getItem('mn-cad-settings-v2') || '{}').microTips, title: document.querySelector('[data-ribbon] button')?.getAttribute('title') || '', wrappers: document.querySelectorAll('[data-ribbon] [data-tip-id]').length }));
    const vb = await dp.evaluate(() => { const e = [...document.querySelectorAll('[data-ribbon] button')].find((x) => x.innerText.trim().startsWith('Vysunout')); const r = e.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2, title: e.getAttribute('title') || '' }; });
    await dp.mouse.move(vb.x, vb.y); await dp.waitForTimeout(900);
    ok(offState.s === false && /Vysunout/.test(vb.title) && offState.wrappers === 0 && !(await tipInfo(dp)), `vypnuto: žádná bublina, nativní title zpět („${vb.title.slice(0, 40)}…“)`);
    await dp.evaluate(() => { const s = JSON.parse(localStorage.getItem('mn-cad-settings-v2')); s.microTips = true; localStorage.setItem('mn-cad-settings-v2', JSON.stringify(s)); });
    await dp.close();
    await dctx.close();

    // ── dotyk: dlouhý stisk ukáže návod a příkaz nespustí, klepnutí příkaz spustí ──
    const tctx = await b.newContext({ viewport: { width: 1180, height: 820 }, hasTouch: true });
    const tp = await page(tctx);
    await open(tp, '/cad');
    await run(tp, 'nový díl Dotyk\nkvádr 60 40 20');
    const before = await tp.evaluate(() => window.mncad.getDocument().features.length);
    const rb = await tp.evaluate(PREP, ['[data-ribbon] [data-tip-id="box"]', 0]);
    const cdp = await tctx.newCDPSession(tp);
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: rb.x, y: rb.y }] });
    await tp.waitForTimeout(900);
    const lt = await tipInfo(tp);
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await tp.waitForTimeout(900);
    const formOpen = await tp.getByRole('button', { name: 'OK', exact: true }).count();
    const after = await tp.evaluate(() => window.mncad.getDocument().features.length);
    ok(lt && lt.kind === 'full' && lt.title === 'Kvádr', 'dlouhý stisk na dotyku ukáže návod');
    ok(after === before && formOpen === 0, `dlouhý stisk příkaz nespustí (prvků ${before} → ${after}, formulář ${formOpen})`);
    ok(!!(await tipInfo(tp)), 'po zvednutí prstu návod zůstane, dokud se neklepne jinam');
    await tp.screenshot({ path: S + 'tips-touch.png' });
    await tp.touchscreen.tap(6, 700); await tp.waitForTimeout(400);
    ok(!(await tipInfo(tp)), 'klepnutí jinam návod skryje');
    await tp.touchscreen.tap(rb.x, rb.y); await tp.waitForTimeout(1200);
    const after2 = await tp.evaluate(() => window.mncad.getDocument().features.length);
    const form2 = await tp.getByRole('button', { name: 'OK', exact: true }).count();
    ok(after2 === before + 1 || form2 > 0, `běžné klepnutí příkaz spustí (prvků ${before} → ${after2}, formulář ${form2})`);
    ok(!(await tipInfo(tp)), 'po klepnutí žádná bublina');
    await tp.close();
    await tctx.close();
  }

  if (PHASE.includes('c')) {
    // ── angličtina a němčina (balíky se načtou líně) ──
    const ctx = await b.newContext({ viewport: { width: 1430, height: 880 } });
    for (const [path, cmd, title, when, run1] of [['/en/cad', 'extrude 10', 'Extrude', /When to use/i, 'new part Tips\nbox 60 40 20'], ['/de/cad', 'extrudieren 10', 'Extrudieren', /Wann verwenden/i, 'neues teil Tipps\nquader 60 40 20']]) {
      const ep = await page(ctx);
      await open(ep, path);
      await run(ep, run1).catch(() => {});
      await hoverKey(ep, '[data-ribbon] [data-tip-id="extrude"]');
      await ep.waitForTimeout(300);
      const t2 = await tipInfo(ep);
      ok(t2 && t2.kind === 'full' && t2.title === title && when.test(t2.text) && t2.text.includes(cmd), `${path}: návod v jazyce stránky (${t2 && t2.kind}: ${t2 && t2.what.slice(0, 50)})`);
      if (path === '/en/cad') await ep.screenshot({ path: S + 'tips-en.png' });
      await ep.close();
    }
    await ctx.close();
  }

  console.log('\nPřehled (tlačítka s plným návodem / zkontrolovaná):');
  for (const s of summary) console.log(`  ${s.place}: ${s.full}/${s.checked}${s.menuChecked ? ` + položky nabídek ${s.menuFull}/${s.menuChecked}` : ''}`);
  const tot = summary.reduce((a, s) => ({ c: a.c + s.checked + s.menuChecked, f: a.f + s.full + s.menuFull }), { c: 0, f: 0 });
  if (summary.length) console.log(`  celkem: ${tot.f}/${tot.c}`);
  ok(nativeDialogs === 0, `žádné nativní dialogy (${nativeDialogs})`);
  ok(errs.length === 0, 'bez chyb stránky' + (errs.length ? ': ' + errs.join(' | ').slice(0, 400) : ''));
  await b.close();
})().catch((e) => { console.error('FAIL:', e); process.exit(1); });
