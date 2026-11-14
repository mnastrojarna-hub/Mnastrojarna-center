// E2E (vlna 13, balík docs): chyby tlačítek sestavy, výkresu a skici nalezené při psaní mikronávodů.
//  13 Podsestava › Vytvořit z vybraných: bez výběru neaktivní s důvodem; počítá výběr ve stromu (klik, Ctrl+klik).
//  13b Ve 3D okně: klik + Ctrl+klik přidá, další Ctrl+klik komponentu ubere – nezůstane vybraná ve stromu ani v podsestavě.
//  14 Podsestava › Otevřít v nové záložce (kopie) = nová záložka; Upravit v kontextu = úprava v téže záložce; pravé tlačítko
//     na podsestavě ve stromu nabízí totéž co ve 3D okně.
//  15 Výkres › Nový výkres podruhé založí Výkres 2 (doc.drawings +1) – v dílu i v sestavě (15a); Otevřít výkres ▼; přepínač
//     výkresů a + Výkres; Ctrl+Z hned po + Výkres vrátí jen nový výkres.
//  16 Skica › Import DXF… přidá entity do OTEVŘENÉ skice (dialog: jednotky, posun, hladiny), Ctrl+Z vrátí; žádná nová záložka;
//     Esc zavře dialog prvním stiskem.
//  17 Export výkresu s více listy: volba Listy k exportu (výchozí všechny), PDF vícestránkové, DXF ZIP, Tisk všech listů
//     (v automatizaci = PDF všech listů ke stažení, bez dialogu tisku); text `výkres export pdf vše` (protokol výstupů
//     konzole) a window.mncad.exportDrawing("pdf", { sheet: "all" }); název souboru s názvem výkresu.
// Spuštění: E2E_BASE=http://localhost:3402 node e2e/cad-w13-docs.e2e.cjs <složka> [soubor.dxf]   (ONLY=13,13b,14,15,15a,16,17)
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');
const S = (process.argv[2] || '/tmp/e2e').replace(/\/?$/, '/');
fs.mkdirSync(S, { recursive: true });
const BASE = (process.env.E2E_BASE || 'http://localhost:3100').replace(/\/$/, '');
const ONLY = (process.env.ONLY || '13,13b,14,15,15a,16,17').split(',');
const ok = (c, m) => { console.log((c ? 'ok: ' : 'FAIL: ') + m); if (!c) process.exitCode = 1; };

// DXF pro import do skici: 2 úsečky na hladině OBRYS, kružnice na hladině OSY, mm
const DXF = process.argv[3] || path.join(S, 'w13-import.dxf');
if (!process.argv[3]) fs.writeFileSync(DXF, ['0', 'SECTION', '2', 'HEADER', '9', '$INSUNITS', '70', '4', '0', 'ENDSEC', '0', 'SECTION', '2', 'ENTITIES', '0', 'LINE', '8', 'OBRYS', '10', '0', '20', '0', '11', '50', '21', '0', '0', 'LINE', '8', 'OBRYS', '10', '50', '20', '0', '11', '50', '21', '30', '0', 'CIRCLE', '8', 'OSY', '10', '25', '20', '15', '40', '5', '0', 'ENDSEC', '0', 'EOF', ''].join('\n'));

async function open(p) {
  await p.goto(BASE + '/cad', { waitUntil: 'networkidle', timeout: 240000 });
  const c = p.getByText(/Pokračovat v práci/);
  if (await c.isVisible({ timeout: 6000 }).catch(() => false)) await c.click();
  await p.waitForFunction(() => document.body.innerText.includes('OCCT') && !/Načítám jádro/.test(document.body.innerText), null, { timeout: 180000 });
  await p.waitForTimeout(800);
  await p.keyboard.press('Escape').catch(() => {});
}
const idle = (p) => p.waitForFunction(() => !window.mncad.progress(), null, { timeout: 120000 });
const run = async (p, t) => { const r = await p.evaluate((x) => window.mncad.run(x), t); await idle(p); await p.waitForTimeout(600); return r; };
const clickTab = (p, n) => p.evaluate((n) => { const row = document.querySelector('[data-ribbon]').previousElementSibling; const b = [...row.querySelectorAll(':scope > button')].find((x) => x.innerText.trim() === n); if (!b) throw new Error('karta ' + n); b.click(); }, n);
const ribbonBtn = (p, l) => p.evaluate((l) => { const b = [...document.querySelectorAll('[data-ribbon] button')].find((x) => (x.getAttribute('aria-label') || x.innerText).replace('▼', '').trim() === l); return b ? { disabled: b.disabled } : null; }, l);
const clickRibbon = (p, l) => p.evaluate((l) => { const b = [...document.querySelectorAll('[data-ribbon] button')].find((x) => (x.getAttribute('aria-label') || x.innerText).replace('▼', '').trim() === l); if (!b) throw new Error('tlačítko ' + l); b.click(); }, l);
const menuItems = (p) => p.evaluate(() => [...document.querySelectorAll('[data-cad-menu] button')].map((x) => ({ t: x.innerText.trim(), d: x.disabled })));
const clickMenu = (p, l) => p.evaluate((l) => { const b = [...document.querySelectorAll('[data-cad-menu] button')].find((x) => x.innerText.trim().startsWith(l)); if (!b) throw new Error('položka ' + l); b.click(); }, l);
const bodyHas = (p, re) => p.evaluate((s) => new RegExp(s).test(document.body.innerText), re.source);
const doc = (p) => p.evaluate(() => window.mncad.getDocument());
const tabs = (p) => p.evaluate(() => window.mncad.tabs());
const treeRow = (p, name, nth = 0) => p.locator('aside div.group').filter({ has: p.locator('span', { hasText: new RegExp(`^${name}$`) }) }).nth(nth);
const treeHl = (p) => p.evaluate(() => [...document.querySelectorAll('aside div.group')].filter((x) => x.className.includes('bg-[#dbe7f5]')).map((x) => x.innerText.trim().split('\n')[0]));
const ctxItems = (p) => p.evaluate(() => [...document.querySelectorAll('div.fixed.z-\\[60\\] button')].map((x) => ({ t: x.innerText.trim().split('\n')[0], d: x.disabled })));
/** střed komponent ve 3D okně podle barvy (modrá / zelená / purpurová) – snímek okna rozebraný v prohlížeči */
async function colorBlobs(p) {
  const r = await p.evaluate(() => { const c = [...document.querySelectorAll('canvas')].sort((a, b) => b.width * b.height - a.width * a.height)[0]; const q = c.getBoundingClientRect(); return { x: q.left, y: q.top, w: q.width, h: q.height }; });
  const png = await p.screenshot({ clip: { x: r.x, y: r.y, width: r.w, height: r.h } });
  return p.evaluate(async ({ b64, r }) => {
    const img = new Image();
    img.src = 'data:image/png;base64,' + b64;
    await img.decode();
    const c = document.createElement('canvas');
    c.width = img.width; c.height = img.height;
    const g = c.getContext('2d');
    g.drawImage(img, 0, 0);
    const px = g.getImageData(0, 0, c.width, c.height).data;
    const k = r.w / c.width;
    const pts = { blue: [], green: [], magenta: [] };
    for (let y = 0; y < c.height; y += 2) for (let x = 0; x < c.width; x += 2) {
      const i = (y * c.width + x) * 4; const R = px[i] / 255, G = px[i + 1] / 255, B = px[i + 2] / 255;
      const mx = Math.max(R, G, B), d = mx - Math.min(R, G, B);
      if (mx < 0.35 || d / mx < 0.18) continue;
      let hh = mx === R ? ((G - B) / d) % 6 : mx === G ? (B - R) / d + 2 : (R - G) / d + 4;
      hh = (hh * 60 + 360) % 360;
      const t = hh > 225 && hh < 262 && d / mx > 0.25 ? 'blue' : hh > 90 && hh < 150 ? 'green' : hh > 280 && hh < 330 ? 'magenta' : null;
      if (t) pts[t].push([x, y]);
    }
    const med = (a) => { const s = [...a].sort((u, v) => u - v); return s[s.length >> 1]; };
    return Object.fromEntries(Object.entries(pts).map(([n, l]) => [n, l.length > 50 ? { x: r.x + med(l.map((q) => q[0])) * k, y: r.y + med(l.map((q) => q[1])) * k } : null]));
  }, { b64: png.toString('base64'), r });
}
const pdfPages = (buf) => (buf.toString('latin1').match(/\/Type \/Page\b(?!s)/g) || []).length;
const zipNames = (buf) => { const out = []; for (let i = 0; i + 46 < buf.length; i++) if (buf.readUInt32LE(i) === 0x02014b50) { const n = buf.readUInt16LE(i + 28); out.push(buf.slice(i + 46, i + 46 + n).toString('utf8')); } return out; };

(async () => {
  const b = await chromium.launch({ args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader'] });
  const ctx = await b.newContext({ viewport: { width: 1500, height: 950 }, acceptDownloads: true });
  // ukládání bez dialogu „Uložit jako“ (Nastavení › Soubory) – export jde přímo ke stažení
  await ctx.addInitScript(() => { try { const k = 'mn-cad-settings-v2'; const s = JSON.parse(localStorage.getItem(k) || '{"rev":3}'); s.askWhereToSave = false; localStorage.setItem(k, JSON.stringify(s)); } catch {} });
  const p = await ctx.newPage();
  const errs = [];
  p.on('pageerror', (e) => errs.push(e.message));
  await open(p);

  if (ONLY.includes('13') || ONLY.includes('14')) {
    await run(p, 'nový díl Čep\nválec 10 30');
    await run(p, 'nový díl Deska\nkvádr 40 30 10');
    await run(p, 'nová sestava Test\nvložit "Deska" ukotvit\nvložit "Čep" v 60 0 0\nvložit "Čep" v 120 0 0');
    await clickTab(p, 'Sestava'); await p.waitForTimeout(400);
    // ── 13 ──
    await clickRibbon(p, 'Podsestava'); await p.waitForTimeout(300);
    let m = await menuItems(p);
    const mk0 = m.find((x) => x.t.startsWith('Vytvořit z vybraných'));
    ok(mk0 && mk0.d, '13: bez výběru je „Vytvořit z vybraných“ neaktivní ' + JSON.stringify(mk0));
    await p.keyboard.press('Escape'); await p.waitForTimeout(200);
    await treeRow(p, 'Čep', 0).click(); await p.waitForTimeout(300);
    await clickRibbon(p, 'Podsestava'); await p.waitForTimeout(300);
    m = await menuItems(p);
    ok(m.some((x) => x.t === 'Vytvořit z vybraných' && !x.d), '13: komponenta vybraná jen ve stromu → položka aktivní ' + JSON.stringify(m.map((x) => x.t)));
    await clickRibbon(p, 'Podsestava'); await p.waitForTimeout(300); // zavřít nabídku (Esc by zrušil i výběr)
    await treeRow(p, 'Deska').click({ modifiers: ['Control'] }); await p.waitForTimeout(300);
    const hl = await p.evaluate(() => [...document.querySelectorAll('aside div.group')].filter((x) => x.className.includes('bg-[#dbe7f5]')).map((x) => x.innerText.trim().split('\n')[0]));
    ok(hl.length === 2, '13: Ctrl+klik ve stromu – zvýrazněné řádky ' + JSON.stringify(hl));
    await clickRibbon(p, 'Podsestava'); await p.waitForTimeout(300);
    m = await menuItems(p);
    ok(m.some((x) => x.t === 'Vytvořit z vybraných (2)' && !x.d), '13: Ctrl+klik ve stromu přidá druhou komponentu – „Vytvořit z vybraných (2)“');
    await clickMenu(p, 'Vytvořit z vybraných'); await p.waitForTimeout(800);
    let d = await doc(p);
    const sub = d.components.find((c) => c.source.kind === 'asm');
    ok(d.components.length === 2 && sub && sub.source.doc.components.map((c) => c.name).sort().join(',') === 'Deska,Čep', '13: podsestava z výběru ve stromu: ' + d.components.map((c) => c.name + ':' + c.source.kind).join(', '));
    ok(!(await bodyHas(p, /Vyberte komponenty \(filtr/)), '13: žádná hláška „Vyberte komponenty (filtr…)“');
    // ── 14 ──
    if (ONLY.includes('14')) {
      // pravé tlačítko na podsestavě ve stromu = stejné příkazy podsestavy jako ve 3D okně (ne „Upravit díl“)
      await treeRow(p, sub.name).click({ button: 'right' }); await p.waitForTimeout(500);
      const cm = await ctxItems(p);
      const has = (t) => cm.some((x) => x.t === t && !x.d);
      ok(has('Upravit podsestavu v kontextu') && has('Otevřít v nové záložce (kopie)') && has('Rozpustit podsestavu') && has('Uložit podsestavu (.mncad)') && !cm.some((x) => /^Upravit díl|^Uložit díl/.test(x.t)), '14: pravé tlačítko na podsestavě ve stromu ' + JSON.stringify(cm.map((x) => x.t + (x.d ? '(off)' : ''))));
      await p.keyboard.press('Escape'); await p.waitForTimeout(300);
      await treeRow(p, sub.name).click(); await p.waitForTimeout(300);
      await clickRibbon(p, 'Podsestava'); await p.waitForTimeout(300);
      m = await menuItems(p);
      ok(m.some((x) => x.t === 'Otevřít v nové záložce (kopie)' && !x.d) && m.some((x) => x.t === 'Upravit v kontextu' && !x.d), '14: nabídka má Otevřít v nové záložce (kopie) a Upravit v kontextu: ' + JSON.stringify(m.map((x) => x.t)));
      const t0 = await tabs(p);
      await clickMenu(p, 'Otevřít v nové záložce'); await p.waitForTimeout(1500);
      const t1 = await tabs(p);
      const act = t1.find((t) => t.active);
      ok(t1.length === t0.length + 1 && act && act.kind === 'assembly' && act.title === sub.name, `14: Otevřít v nové záložce → záložek ${t0.length} → ${t1.length}, aktivní ${act && act.kind}:${act && act.title}`);
      ok(!(await bodyHas(p, /Úprava podsestavy/)) && (await bodyHas(p, /otevřena v nové záložce jako kopie/)), '14: bez pruhu Úprava podsestavy, hláška o kopii');
      ok((await doc(p)).components.length === 2, '14: kopie podsestavy má své 2 komponenty');
      await p.evaluate(() => window.mncad.activateTab('Test')); await p.waitForTimeout(1500);
      await treeRow(p, sub.name).click(); await p.waitForTimeout(300);
      await clickRibbon(p, 'Podsestava'); await p.waitForTimeout(300);
      await clickMenu(p, 'Upravit v kontextu'); await p.waitForTimeout(1200);
      ok((await tabs(p)).length === t1.length && (await bodyHas(p, /Úprava podsestavy/)), '14: Upravit v kontextu → stejná záložka, pruh Úprava podsestavy');
      await p.screenshot({ path: S + 'w13-14-edit.png' });
    }
  }

  if (ONLY.includes('13b') || ONLY.includes('15a')) {
    await run(p, 'nový díl Kolík\nválec 10 30');
    await run(p, 'nový díl Základna\nkvádr 40 30 10');
    await run(p, 'nová sestava Sestava3D\nvložit "Základna" ukotvit\nvložit "Kolík" v 60 0 0\nvložit "Kolík" v 120 0 0');
    await p.evaluate(async () => { const d = window.mncad.getDocument(); ['#1040ff', '#10d040', '#ff20ff'].forEach((col, i) => (d.components[i].color = col)); await window.mncad.setDocument(d, { inPlace: true }); });
    await idle(p); await p.waitForTimeout(1200);
    await run(p, 'zobraz horní');
    await clickTab(p, 'Sestava'); await p.waitForTimeout(400);
    if (ONLY.includes('13b')) {
      // ── 13b: výběr ve 3D okně ──
      await treeRow(p, 'Kolík', 1).click(); await p.waitForTimeout(1500); // panel komponenty otevřený = stálé rozvržení okna
      const bl = await colorBlobs(p);
      ok(bl.blue && bl.green && bl.magenta, '13b: komponenty nalezené ve 3D okně ' + JSON.stringify(bl));
      if (bl.blue && bl.green) {
        const mk = async () => { await clickRibbon(p, 'Podsestava'); await p.waitForTimeout(300); const m = (await menuItems(p))[0]; await clickRibbon(p, 'Podsestava'); await p.waitForTimeout(300); return m; };
        const ctrl = async (pt) => { await p.keyboard.down('Control'); await p.mouse.click(pt.x, pt.y); await p.keyboard.up('Control'); await p.waitForTimeout(600); };
        await p.mouse.click(bl.blue.x, bl.blue.y); await p.waitForTimeout(600);
        ok((await treeHl(p)).join() === 'Základna', '13b: klik ve 3D vybere Základnu ' + JSON.stringify(await treeHl(p)));
        await ctrl(bl.green);
        const m1 = await mk();
        ok(m1.t === 'Vytvořit z vybraných (2)' && !m1.d && (await treeHl(p)).join() === 'Základna,Kolík', '13b: Ctrl+klik ve 3D přidá Kolík → ' + JSON.stringify(m1) + ' ' + JSON.stringify(await treeHl(p)));
        await ctrl(bl.green);
        const m2 = await mk();
        const hl = await treeHl(p);
        ok(m2.t === 'Vytvořit z vybraných' && !m2.d && hl.join() === 'Základna' && (await bodyHas(p, /vybráno 1/)), '13b: další Ctrl+klik Kolík ubere – menu ' + JSON.stringify(m2) + ', strom ' + JSON.stringify(hl));
        await clickRibbon(p, 'Podsestava'); await p.waitForTimeout(300);
        await clickMenu(p, 'Vytvořit z vybraných'); await p.waitForTimeout(1200);
        const sub = (await doc(p)).components.find((c) => c.source.kind === 'asm');
        ok(sub && sub.source.doc.components.map((c) => c.name).join() === 'Základna', '13b: podsestava jen z toho, co zůstalo vybrané: ' + JSON.stringify(sub && sub.source.doc.components.map((c) => c.name)));
        await p.screenshot({ path: S + 'w13-13b-3d.png' });
      }
    }
    if (ONLY.includes('15a')) {
      // ── 15a: Nový výkres v sestavě – výkres se uloží hned, druhý Nový výkres = Výkres 2 ──
      await clickTab(p, 'Výkres'); await p.waitForTimeout(300);
      ok((await ribbonBtn(p, 'Otevřít výkres'))?.disabled === true, '15a: sestava bez výkresu – Otevřít výkres neaktivní');
      await clickRibbon(p, 'Nový výkres');
      await p.waitForSelector('[data-drawing-workspace]', { timeout: 60000 }); await p.waitForTimeout(1500);
      let d = await doc(p);
      ok(d.kind === 'assembly' && d.drawings?.length === 1, '15a: 1. Nový výkres v sestavě → výkres uložen hned: ' + JSON.stringify((d.drawings || []).map((s) => [s.drawing || '', s.name])));
      await p.locator('[data-drawing-workspace] header button', { hasText: /^Zavřít$/ }).click(); await p.waitForTimeout(1500);
      await p.evaluate(() => window.mncad.activateTab('Sestava3D')); await p.waitForTimeout(1500);
      await clickTab(p, 'Výkres'); await p.waitForTimeout(300);
      ok((await ribbonBtn(p, 'Otevřít výkres'))?.disabled === false, '15a: Otevřít výkres je po zavření výkresu aktivní');
      await clickRibbon(p, 'Nový výkres');
      await p.waitForSelector('[data-drawing-workspace]', { timeout: 60000 }); await p.waitForTimeout(3000);
      d = await doc(p);
      const sel = await p.evaluate(() => document.querySelector('[data-drawing-select]')?.value ?? null);
      ok(d.drawings?.length === 2 && d.drawings[1].drawing === 'Výkres 2' && sel === 'Výkres 2', '15a: 2. Nový výkres v sestavě → Výkres 2 ' + JSON.stringify((d.drawings || []).map((s) => [s.drawing || '', s.name])) + ' přepínač ' + sel);
      await p.screenshot({ path: S + 'w13-15a-asm.png' });
      await p.keyboard.press('Escape'); await p.waitForTimeout(1500);
    }
  }

  if (ONLY.includes('15') || ONLY.includes('17')) {
    await run(p, 'nový díl Hřídel\nválec 20 60');
    await p.waitForTimeout(1500);
    await clickTab(p, 'Výkres'); await p.waitForTimeout(300);
    ok((await ribbonBtn(p, 'Otevřít výkres'))?.disabled === true, '15: Otevřít výkres je bez výkresu neaktivní');
    await clickRibbon(p, 'Nový výkres');
    await p.waitForSelector('[data-drawing-workspace]', { timeout: 60000 }); await p.waitForTimeout(6000);
    let d = await doc(p);
    ok(d.drawings?.length === 1, '15: 1. Nový výkres → 1 list výkresu ' + (d.drawings || []).length);
    await p.evaluate(() => window.mncad.activateTab('Hřídel')); await p.waitForTimeout(1500);
    await clickTab(p, 'Výkres'); await p.waitForTimeout(300);
    ok((await ribbonBtn(p, 'Otevřít výkres'))?.disabled === false, '15: Otevřít výkres je s výkresem aktivní');
    await clickRibbon(p, 'Nový výkres');
    await p.waitForSelector('[data-drawing-workspace]', { timeout: 60000 }); await p.waitForTimeout(5000);
    d = await doc(p);
    ok(d.drawings?.length === 2 && d.drawings[1].drawing === 'Výkres 2', '15: 2. Nový výkres → další výkres „Výkres 2“: ' + JSON.stringify((d.drawings || []).map((s) => [s.drawing || '', s.name])));
    const sel = await p.evaluate(() => { const s = document.querySelector('[data-drawing-select]'); return s ? { v: s.value, o: [...s.options].map((x) => x.text) } : null; });
    ok(sel && sel.v === 'Výkres 2' && sel.o.join(',') === 'Výkres 1,Výkres 2', '15: přepínač výkresů v liště listů ' + JSON.stringify(sel));
    await p.screenshot({ path: S + 'w13-15-drawing2.png' });
    await p.selectOption('[data-drawing-select]', ''); await p.waitForTimeout(3000);
    ok(await p.evaluate(() => document.querySelector('[data-drawing-select]').value === ''), '15: přepnutí na Výkres 1');
    await p.click('[data-drawing-add]'); await p.waitForTimeout(3000);
    d = await doc(p);
    ok(d.drawings?.length === 3 && d.drawings[2].drawing === 'Výkres 3' && (await p.evaluate(() => document.querySelector('[data-drawing-select]').value)) === 'Výkres 3', '15: + Výkres → Výkres 3 ' + JSON.stringify((d.drawings || []).map((s) => s.drawing || '')));
    // Ctrl+Z hned po + Výkres vrátí jen nový výkres (model zůstane), Ctrl+Y ho vrátí
    const feats = d.features.map((f) => f.name).join();
    await p.mouse.click(700, 520); await p.waitForTimeout(300);
    await p.keyboard.press('Control+z'); await p.waitForTimeout(2500);
    d = await doc(p);
    ok(d.drawings?.length === 2 && d.features.map((f) => f.name).join() === feats && (await p.evaluate(() => !!document.querySelector('[data-drawing-workspace]'))), '15: Ctrl+Z po + Výkres → výkresy ' + JSON.stringify((d.drawings || []).map((s) => s.drawing || '')) + ', prvky ' + d.features.map((f) => f.name).join());
    await p.keyboard.press('Control+y'); await p.waitForTimeout(2500);
    d = await doc(p);
    ok(d.drawings?.length === 3 && d.drawings[2].drawing === 'Výkres 3', '15: Ctrl+Y vrátí Výkres 3 ' + JSON.stringify((d.drawings || []).map((s) => s.drawing || '')));
    const st = await run(p, 'výkres výkresy');
    ok(/Výkresy \(3\): 1 „Výkres 1“ 1 list · 2 „Výkres 2“ 1 list · 3 „Výkres 3“ 1 list \(aktivní\)/.test(st), '15: text výkres výkresy: ' + (st.match(/Výkresy[^\n]*/) || [''])[0]);
    await run(p, 'výkres výkresy 1'); await p.waitForTimeout(2500);
    ok((await p.evaluate(() => document.querySelector('[data-drawing-select]')?.value)) === '', '15: text výkres výkresy 1 přepne otevřený výkres na Výkres 1');
    await p.keyboard.press('Escape'); await p.waitForTimeout(1500);
    await p.evaluate(() => window.mncad.activateTab('Hřídel')); await p.waitForTimeout(1500);
    await clickTab(p, 'Výkres'); await p.waitForTimeout(300);
    await clickRibbon(p, 'Otevřít výkres'); await p.waitForTimeout(300);
    const om = await menuItems(p);
    ok(om.filter((x) => /^Výkres \d · 1 list$/.test(x.t)).length === 3, '15: Otevřít výkres ▼ nabízí 3 výkresy ' + JSON.stringify(om.map((x) => x.t)));
    await clickMenu(p, 'Výkres 2'); await p.waitForSelector('[data-drawing-workspace]', { timeout: 60000 }); await p.waitForTimeout(4000);
    ok((await p.evaluate(() => document.querySelector('[data-drawing-select]')?.value)) === 'Výkres 2', '15: Otevřít výkres › Výkres 2 otevře výkres 2');

    if (ONLY.includes('17')) {
      // Výkres 2: druhý list → volba Listy k exportu, export všech listů
      await p.getByRole('button', { name: '+ List' }).click(); await p.waitForTimeout(5000);
      const rng = await p.evaluate(() => { const s = document.querySelector('[data-export-sheets]'); return s ? { v: s.value, o: [...s.options].map((x) => x.text) } : null; });
      ok(rng && rng.v === 'all' && rng.o[0] === 'Všechny listy (2)', '17: volba Listy k exportu, výchozí všechny ' + JSON.stringify(rng));
      let dl = p.waitForEvent('download', { timeout: 120000 });
      await p.getByRole('button', { name: 'PDF', exact: true }).click();
      let f = await dl;
      let buf = fs.readFileSync(await f.path());
      ok(f.suggestedFilename() === 'Hridel_Vykres_2_vykres.pdf' && pdfPages(buf) === 2, `17: PDF všech listů (Výkres 2) → ${f.suggestedFilename()}, stran ${pdfPages(buf)}`);
      dl = p.waitForEvent('download', { timeout: 120000 });
      await p.getByRole('button', { name: 'DXF', exact: true }).click();
      f = await dl;
      buf = fs.readFileSync(await f.path());
      ok(f.suggestedFilename() === 'Hridel_Vykres_2_vykres_dxf_listy.zip' && zipNames(buf).join() === 'Hridel_Vykres_2_list1_List_1.dxf,Hridel_Vykres_2_list2_List_2.dxf', `17: DXF všech listů → ${f.suggestedFilename()} ${JSON.stringify(zipNames(buf))}`);
      // tisk: Playwright = automatizace (navigator.webdriver, lib/automation.ts) → Tisk neotevře dialog tisku (skrytý rámec
      // s print()), ale stáhne PDF všech listů aktivního výkresu (jedna stránka na list) – stejný soubor jako tlačítko PDF
      await p.evaluate(() => { window.__frames = 0; new MutationObserver((ms) => ms.forEach((m) => m.addedNodes.forEach((n) => { if (n.nodeName === 'IFRAME') window.__frames++; }))).observe(document.body, { childList: true }); });
      dl = p.waitForEvent('download', { timeout: 120000 });
      await p.getByRole('button', { name: 'Tisk', exact: true }).click();
      f = await dl.catch(() => null);
      buf = f ? fs.readFileSync(await f.path()) : Buffer.alloc(0);
      const frames = await p.evaluate(() => window.__frames);
      ok(f && f.suggestedFilename() === 'Hridel_Vykres_2_vykres.pdf' && pdfPages(buf) === 2 && frames === 0, `17: Tisk všech listů (automatizace) → PDF ${f && f.suggestedFilename()}, stran ${pdfPages(buf)}, tiskových rámců ${frames}`);
      await p.selectOption('[data-export-sheets]', 'active'); await p.waitForTimeout(300);
      dl = p.waitForEvent('download', { timeout: 120000 });
      await p.getByRole('button', { name: 'DXF', exact: true }).click();
      f = await dl;
      ok(f.suggestedFilename() === 'Hridel_Vykres_2_vykres.dxf', '17: Aktivní list → jeden DXF ' + f.suggestedFilename());
      await p.selectOption('[data-export-sheets]', 'all'); await p.waitForTimeout(300);
      // API a text
      const api = await p.evaluate(async () => { const r = await window.mncad.exportDrawing('pdf', { sheet: 'all' }); return { name: r.name, sheets: r.sheets, pages: (atob(r.base64).match(/\/Type \/Page\b(?!s)/g) || []).length }; });
      ok(api.sheets === 2 && api.pages === 2, '17: exportDrawing("pdf", { sheet: "all" }) ' + JSON.stringify(api));
      // text: výstupní příkazy konzole (cad/agent-out.ts, agent-out-host.ts) – všechny listy jedním souborem jako v GUI,
      // protokol „✓ výkres PDF, listů 2: <soubor> · <velikost> · výkres PDF – staženo (bez dialogu)“
      dl = p.waitForEvent('download', { timeout: 120000 });
      const log = await run(p, 'výkres export pdf vše');
      f = await dl.catch(() => null);
      const txtPages = f ? pdfPages(fs.readFileSync(await f.path())) : 0;
      ok(/✓ výkres PDF, listů 2: Hridel_Vykres_2_vykres\.pdf · [\d\s,.]+ (B|kB|MB) · výkres PDF – staženo \(bez dialogu\)/.test(log) && f && f.suggestedFilename() === 'Hridel_Vykres_2_vykres.pdf' && txtPages === 2, '17: text výkres export pdf vše → ' + ((log.match(/✓ výkres[^\n]*/) || [''])[0]) + ' · stažení ' + (f && f.suggestedFilename()) + `, stran ${txtPages}`);
      // jiný výkres téhož dílu = jiný soubor (nepřepíše export Výkresu 2)
      await p.selectOption('[data-drawing-select]', ''); await p.waitForTimeout(4000);
      dl = p.waitForEvent('download', { timeout: 120000 });
      await p.getByRole('button', { name: 'PDF', exact: true }).click();
      f = await dl;
      ok(f.suggestedFilename() === 'Hridel_Vykres_1_vykres.pdf', '17: PDF Výkresu 1 → ' + f.suggestedFilename());
      await p.screenshot({ path: S + 'w13-17-export.png' });
      await p.keyboard.press('Escape'); await p.waitForTimeout(1500);
    }
  }

  if (ONLY.includes('16')) {
    await run(p, 'nový díl Plech');
    await clickTab(p, 'Tvorba'); await p.waitForTimeout(300);
    await clickRibbon(p, 'Skica'); await p.waitForTimeout(400);
    await clickMenu(p, 'Rovina XY'); await p.waitForTimeout(1500);
    const sk = () => p.evaluate(() => window.mncad.getDocument().features.filter((f) => f.type === 'sketch').map((f) => f.entities.length));
    const t0 = (await tabs(p)).length;
    const fc = p.waitForEvent('filechooser', { timeout: 10000 }).catch(() => null);
    await clickRibbon(p, 'Import DXF…');
    const ch = await fc;
    ok(!!ch, '16: Import DXF… otevře výběr souboru');
    if (ch) {
      await ch.setFiles(DXF);
      await p.waitForSelector('[data-dxf-import]', { timeout: 10000 }).catch(() => {});
      const info = await p.evaluate(() => ({ layers: [...document.querySelectorAll('[data-dxf-layer]')].map((x) => x.getAttribute('data-dxf-layer')), sum: document.querySelector('[data-dxf-import-summary]')?.innerText || '' }));
      ok(info.layers.join(',') === 'OBRYS,OSY' && /Přidá se entit: 3 · 50 × 30 mm/.test(info.sum), '16: dialog importu – hladiny a souhrn ' + JSON.stringify(info));
      await p.click('[data-dxf-layer="OSY"]');
      await p.getByText('Levý dolní roh do počátku skici').click();
      await p.fill('[data-dxf-dx]', '10');
      await p.waitForTimeout(300);
      const sum2 = await p.evaluate(() => document.querySelector('[data-dxf-import-summary]')?.innerText || '');
      ok(/Přidá se entit: 2 · 50 × 30 mm · X 10…60, Y 0…30/.test(sum2), '16: bez hladiny OSY, roh do počátku + posun X 10 → ' + sum2);
      await p.click('[data-dxf-import-ok]'); await p.waitForTimeout(1200);
      const t1 = await tabs(p);
      const after = await sk();
      ok(t1.length === t0 && after.join(',') === '2' && (await doc(p)).name === 'Plech', `16: entity v otevřené skice (${JSON.stringify(after)}), záložek ${t0} → ${t1.length}`);
      ok(await bodyHas(p, /Do skici přidáno entit: 2 z „w13-import\.dxf“|Do skici přidáno entit: 2 z „[^“]+\.dxf“/), '16: hláška s počtem přidaných entit');
      const ents = await p.evaluate(() => window.mncad.getDocument().features.find((f) => f.type === 'sketch').entities.map((e) => e.type === 'line' ? [e.a, e.b] : e.type));
      ok(JSON.stringify(ents) === JSON.stringify([[[10, 0], [60, 0]], [[60, 0], [60, 30]]]), '16: souřadnice po posunu ' + JSON.stringify(ents));
      await p.screenshot({ path: S + 'w13-16-dxf.png' });
      await p.evaluate(() => window.mncad.undo()); await p.waitForTimeout(800);
      ok((await sk()).join(',') === '0', '16: Ctrl+Z (undo) vrátí celý import → ' + JSON.stringify(await sk()));
      // Esc zavře dialog hned prvním stiskem (fokus mimo dialog) a skica zůstane otevřená
      const fc2 = p.waitForEvent('filechooser', { timeout: 10000 }).catch(() => null);
      await clickRibbon(p, 'Import DXF…');
      const ch2 = await fc2;
      if (ch2) {
        await ch2.setFiles(DXF);
        await p.waitForSelector('[data-dxf-import]', { timeout: 10000 }).catch(() => {});
        await p.waitForTimeout(300);
        await p.keyboard.press('Escape'); await p.waitForTimeout(600);
        ok(!(await p.$('[data-dxf-import]')) && (await sk()).join(',') === '0' && (await ribbonBtn(p, 'Import DXF…')) !== null, '16: první Esc zavře dialog Import DXF, skica zůstane otevřená');
      } else ok(false, '16: druhý výběr souboru');
    }
  }

  ok(!errs.length, 'bez chyb stránky ' + errs.slice(0, 3).join(' | '));
  await b.close();
})().catch((e) => { console.error('FAIL:', e.message); process.exit(1); });
