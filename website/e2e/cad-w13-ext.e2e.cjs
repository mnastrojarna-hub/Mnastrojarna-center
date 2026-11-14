// E2E 13. vlna, balík „ext“: formuláře prvků rozšíření po opravách chyb 18–25.
//  18 Uzavřít do tělesa: nový prvek má v datech Přidat (= formulář); starší „new“ formulář ukáže jako „Nahradit tělesa“
//  20 Lem: Úhel uzavření jen u Kapky, Délka lemu u Kapky zašedlá s dopočtenou délkou
//  22 Zrcadlit prvky: pole Rovina odkazem a prvek rozšíření (Zkrut) v seznamu; zrcadlení zkrutu odebere podruhé
//  24 Ohyb z hrany: šířka / hloubka úlevy zašedlé bez druhu úlevy, po volbě Obdélník aktivní
//  25 /de/cad: nástroj skici „Skalieren“ (ne „Maßstab“); „bedingung senkrecht e1 e2“ = kolmo
// Nálezy kontroly (2. kolo):
//  K1 Zrcadlit prvky all=ano bez základního tělesa (zkrut 79,05 → 78,11 cm³, díra 78,99 → 77,98 cm³)
//  K2 /de/cad výkres: protokol „vertikal“ a „zeichnung maß vertikal …“ projde
//  K3 starší Kapka bez closeAngle: pole Úhel uzavření ukáže 30 (dřív 0)
//  K4 3D Rozvinout s úlevou ohybu hlásí varování
//  K5 Konstrukční profil jako samostatná tělesa v seznamu Zrcadlit prvky není
//  K6 prvek adv.mirrorFeatures features="Zkrut" (název) projde a uloží id
//  K7 kopule Průnik na ploše s dírou uprostřed vyklene plochu (ne celá vrstva)
// Spuštění: E2E_BASE=http://localhost:3403 node e2e/cad-w13-ext.e2e.cjs <složka>
const { chromium } = require('playwright');
const fs = require('fs');
const S = (process.argv[2] || '/tmp/e2e').replace(/\/?$/, '/');
fs.mkdirSync(S, { recursive: true });
let fails = 0;
const ok = (c, m) => { console.log((c ? 'ok: ' : 'FAIL: ') + m); if (!c) { fails++; process.exitCode = 1; } };
const BASE = (process.env.E2E_BASE || 'http://localhost:3100').replace(/\/$/, '');

async function open(b, path) {
  const ctx = await b.newContext({ viewport: { width: 1430, height: 900 } });
  const p = await ctx.newPage();
  const errs = [];
  p.on('pageerror', (e) => errs.push(e.message));
  p.on('dialog', (d) => d.dismiss().catch(() => {}));
  await p.goto(BASE + path, { waitUntil: 'networkidle', timeout: 300000 });
  const c = p.getByText(/Pokračovat v práci|Weiterarbeiten|Continue/);
  if (await c.first().isVisible({ timeout: 8000 }).catch(() => false)) await c.first().click();
  await p.waitForFunction(() => document.body.innerText.includes('OCCT') && !/Načítám jádro|Lade Kern|Loading kernel/.test(document.body.innerText), null, { timeout: 240000 });
  await p.waitForTimeout(800);
  return { ctx, p, errs };
}

(async () => {
  const b = await chromium.launch({ args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader'] });
  {
    const { ctx, p, errs } = await open(b, '/cad');
    const run = (text) => p.evaluate((t) => window.mncad.run(t), text);
    const doc = () => p.evaluate(() => window.mncad.getDocument());
    const idle = async () => { await p.waitForTimeout(250); await p.waitForFunction(() => !window.mncad.progress(), null, { timeout: 120000 }); await p.waitForTimeout(250); };
    const status = () => p.evaluate(() => window.mncad.status());
    const vol = async () => { const m = (await status()).match(/objem ([\d\s  ,]+) cm³/); return m ? parseFloat(m[1].replace(/[^\d,]/g, '').replace(',', '.')) : NaN; };
    const last = async () => (await doc()).features.slice(-1)[0];
    const tab = (name) => p.getByRole('button', { name, exact: true }).click();
    const ribbon = (re) => p.locator('[data-ribbon]').getByRole('button', { name: re }).first().click();
    /** stav přepínače (Seg) pod popiskem: popisky voleb a aktivní volba */
    const seg = async (label) => {
      const btns = p.locator(`xpath=//p[normalize-space()="${label}"]/following-sibling::div[1]//button`);
      const texts = await btns.allInnerTexts();
      const cls = await btns.evaluateAll((bs) => bs.map((x) => x.className));
      return { texts, active: texts[cls.findIndex((c) => /bg-white/.test(c))] };
    };
    const okBtn = () => p.getByRole('button', { name: 'OK', exact: true }).click();
    /** otevře formulář prvku z historie (klik, případně dvojklik) – `probe` = text, který formulář ukazuje */
    const openFeature = async (name, probe) => {
      await p.getByText(name, { exact: true }).first().click(); await p.waitForTimeout(800);
      if (!(await p.getByText(probe, { exact: true }).first().isVisible().catch(() => false))) { await p.getByText(name, { exact: true }).first().dblclick(); await p.waitForTimeout(800); }
    };

    // ── 18. Uzavřít do tělesa: data = formulář ──
    await run('nový díl Ext13\nkvádr 10 10 10'); await idle();
    await tab('Plochy'); await p.waitForTimeout(400);
    await ribbon(/Uzavřít do tělesa/); await p.waitForTimeout(900);
    let s = await seg('Operace');
    let f = await last();
    ok(f.ext === 'surf.close' && f.data.mode === 'add' && s.active === 'Přidat', `18: nový prvek Uzavřít do tělesa – data mode=${f.data.mode}, formulář ukazuje ${s.active} (${s.texts.join(' / ')})`);
    ok(!s.texts.includes('Nahradit tělesa'), '18: bez staršího „new“ formulář nenabízí Nahradit tělesa');
    await okBtn(); await idle();
    const legacy = await doc();
    const li = legacy.features.findIndex((x) => x.ext === 'surf.close');
    ok(li >= 0, '18: prvek Uzavřít do tělesa zůstal v historii po OK');
    legacy.features[li].data.mode = 'new';
    await p.evaluate((d) => window.mncad.setDocument(d), legacy); await idle();
    await openFeature(f.name, 'Operace');
    await p.screenshot({ path: S + 'w13-close-legacy.png' });
    s = await seg('Operace');
    ok(s.active === 'Nahradit tělesa' && s.texts.length === 4, `18: starší dokument s mode „new“ – formulář ukáže skutečný stav: ${s.active} (${s.texts.join(' / ')})`);
    await p.locator('xpath=//p[normalize-space()="Operace"]/following-sibling::div[1]//button[normalize-space()="Přidat"]').click(); await p.waitForTimeout(400);
    f = (await doc()).features.find((x) => x.ext === 'surf.close');
    ok(f && f.data.mode === 'add', '18: klik na Přidat uloží mode=add');
    await p.keyboard.press('Escape'); await p.waitForTimeout(300);

    // ── 22. Zrcadlit prvky: rovina odkazem + zkrut v seznamu ──
    await run('nový díl Zrcadlo\nkvádr 100 40 20\nskica XY: obdélník 10 10 v 20 20\nprvek adv.twist sketch=$last height=10 angle=45 mode=cut'); await idle();
    const v1 = await vol();
    const twist = await last();
    await tab('Tvorba'); await p.waitForTimeout(400);
    await ribbon(/^Zrcadlit prvky/); await p.waitForTimeout(900);
    ok(await p.getByText('Rovina odkazem', { exact: true }).first().isVisible(), '22: formulář Zrcadlit prvky má pole „Rovina odkazem“');
    const item = p.locator('label', { hasText: twist.name }).locator('input[type=checkbox]');
    ok((await item.count()) === 1, `22: seznam Prvky k zrcadlení nabízí prvek rozšíření „${twist.name}“`);
    await item.check(); await p.waitForTimeout(300);
    const offs = p.locator('xpath=//span[normalize-space()="Odsazení roviny [mm]"]/following-sibling::input');
    await offs.fill('50'); await offs.press('Tab'); await p.waitForTimeout(300);
    await okBtn(); await idle();
    const v2 = await vol();
    f = await last();
    ok(f.ext === 'adv.mirrorFeatures' && f.data.features.includes(twist.id) && Math.abs((80 - v2) - 2 * (80 - v1)) < 0.02 && v2 < v1 - 0.5, `22: zrcadlený zkrut odebral podruhé: ${v1} → ${v2} cm³`);
    ok(/, 0 ✗\)/.test(await status()), '22: bez chyb prvků');
    await p.screenshot({ path: S + 'w13-mirror.png' });

    // ── 20 + 24. Lem a Ohyb z hrany: zašedlá pole podle volby ──
    await run('nový díl Plech13\nskica XY: obdélník 100 60\nprvek sheet.base sketchId=$last t=2'); await idle();
    await tab('Plech'); await p.waitForTimeout(400);
    await ribbon(/^Lem/); await p.waitForTimeout(900);
    const off = (key) => p.locator(`fieldset[data-field="${key}"]`).getAttribute('data-off');
    ok((await off('closeAngle')) === '1' && (await off('length')) === null, '20: otevřený lem – Úhel uzavření zašedlý, Délka lemu aktivní');
    await p.locator('xpath=//p[normalize-space()="Typ lemu"]/following-sibling::div[1]//button[normalize-space()="Kapka"]').click(); await p.waitForTimeout(500);
    const lenNote = await p.locator('fieldset[data-field="length"]').innerText();
    ok((await off('closeAngle')) === null && (await off('length')) === '1' && /rameno se dotáhne k plechu – [\d,]+ mm/.test(lenNote), `20: Kapka – Úhel uzavření aktivní, Délka lemu zašedlá: „${lenNote.replace(/\s+/g, ' ').slice(0, 90)}“`);
    f = await last();
    ok(f.ext === 'sheet.hem' && f.data.kind === 'teardrop' && f.data.closeAngle === 30, '20: data lemu: kind=teardrop, closeAngle=30');
    await p.screenshot({ path: S + 'w13-hem.png' });
    await p.keyboard.press('Escape'); await p.waitForTimeout(300);
    await ribbon(/^Ohyb z hrany/); await p.waitForTimeout(900);
    ok((await off('reliefWidth')) === '1' && (await off('reliefDepth')) === '1', '24: bez úlevy jsou Šířka a Hloubka úlevy zašedlé');
    await p.locator('xpath=//p[normalize-space()="Úleva ohybu"]/following-sibling::div[1]//button[normalize-space()="Obdélník"]').click(); await p.waitForTimeout(500);
    const depthNote = await p.locator('fieldset[data-field="reliefDepth"]').innerText();
    ok((await off('reliefWidth')) === null && (await off('reliefDepth')) === null && /0 = tloušťka plechu \(2 mm\)/.test(depthNote), `24: Obdélník – pole aktivní, hloubka vysvětlí 0 = t: „${depthNote.replace(/\s+/g, ' ').slice(0, 80)}“`);
    await p.screenshot({ path: S + 'w13-flange.png' });
    await p.keyboard.press('Escape'); await p.waitForTimeout(300);

    // ── K1. Zrcadlit prvky all=ano: základní těleso se nezrcadlí, původní kapsy zůstanou ──
    await run('nový díl P3\nkvádr 100 40 20\nskica XY: obdélník 10 10 v 20 20\nprvek adv.twist sketch=$last height=10 angle=45 mode=cut'); await idle();
    const k1a = await vol();
    await run('prvek adv.mirrorFeatures all=ano plane=YZ offset=50'); await idle();
    const k1b = await vol();
    ok(Math.abs(k1a - 79.05) < 0.01 && Math.abs(k1b - 78.11) < 0.01, `K1: zkrut + all=ano: ${k1a} → ${k1b} cm³ (očekáváno 79,05 → 78,11; dřív zůstalo 79,05)`);
    await run('nový díl P3h\nkvádr 100 40 20\ndíra 8 skrz v 20 20'); await idle();
    const k1c = await vol();
    await run('prvek adv.mirrorFeatures all=ano plane=YZ offset=50'); await idle();
    const k1d = await vol();
    ok(Math.abs(k1c - 78.99) < 0.01 && Math.abs(k1d - 77.98) < 0.015, `K1: díra + all=ano: ${k1c} → ${k1d} cm³ (očekáváno 78,99 → 77,98)`);

    // ── K6. features názvem ──
    await run('nový díl V22\nkvádr 100 40 20\nskica XY: obdélník 10 10 v 20 20\nprvek adv.twist sketch=$last height=10 angle=45 mode=cut'); await idle();
    const k6tw = await last();
    const k6a = await vol();
    const k6out = await run(`prvek adv.mirrorFeatures features="${k6tw.name}" plane=YZ offset=50`); await idle();
    const k6f = await last();
    const k6b = await vol();
    ok(k6f.ext === 'adv.mirrorFeatures' && JSON.stringify(k6f.data.features) === JSON.stringify([k6tw.id]) && Math.abs((80 - k6b) - 2 * (80 - k6a)) < 0.02, `K6: features="${k6tw.name}" → data.features=${JSON.stringify(k6f.data.features)}, ${k6a} → ${k6b} cm³`);
    ok(!/^\s*✗/m.test(String(k6out)), 'K6: protokol bez řádku ✗');

    // ── K5. profil jako samostatná tělesa se k zrcadlení nenabízí ──
    await run('nový díl V22w\nskica XY: úsečka 0 0 100 0\nprvek weld.member sketchId=$last separate=ano'); await idle();
    const k5m = await last();
    await tab('Tvorba'); await p.waitForTimeout(400);
    await ribbon(/^Zrcadlit prvky/); await p.waitForTimeout(900);
    const k5list = await p.locator('label', { hasText: k5m.name }).locator('input[type=checkbox]').count();
    ok(k5m.ext === 'weld.member' && k5list === 0, `K5: „${k5m.name}“ (separate=ano) v seznamu Prvky k zrcadlení není (${k5list})`);
    await p.keyboard.press('Escape'); await p.waitForTimeout(300);

    // ── K7. kopule Průnik na ploše s dírou uprostřed ──
    await run('nový díl Dhole\nkvádr 40 40 20 střed\ndíra 10 skrz v 0 0'); await idle();
    const k7a = await vol();
    const k7out = await run('prvek adv.dome faces=horní height=5 mode=intersect'); await idle();
    const k7b = await vol();
    const k7rem = (1600 * 5 - (2 / 3) * Math.PI * 400 * 5) / 1000; // 3,81 cm³ jako bez díry
    ok(Math.abs(k7a - 30.43) < 0.01 && Math.abs((k7a - k7b) - k7rem) < 0.05 && !/^\s*✗/m.test(String(k7out)), `K7: ${k7a} → ${k7b} cm³ (odebráno ${(k7a - k7b).toFixed(2)}, očekáváno ≈ ${k7rem.toFixed(2)}; dřív 22,82 = celá vrstva)`);

    // ── K3 + K4. plech: starší kapka bez closeAngle; Rozvinout s úlevou ──
    await run('nový díl Plech20b\nskica XY: obdélník 100 60\nprvek sheet.base sketchId=$last t=2\nprvek sheet.hem edges=3 length=8 kind=teardrop radius=1 closeAngle=30'); await idle();
    const k3v30 = await vol();
    const k3doc = await doc();
    const hi = k3doc.features.findIndex((x) => x.ext === 'sheet.hem');
    delete k3doc.features[hi].data.closeAngle;
    await p.evaluate((d) => window.mncad.setDocument(d), k3doc); await idle();
    const k3v = await vol();
    await openFeature(k3doc.features[hi].name, 'Typ lemu');
    const k3val = await p.locator('fieldset[data-field="closeAngle"] input').first().inputValue().catch(() => '?');
    const k3off = await p.locator('fieldset[data-field="closeAngle"]').getAttribute('data-off').catch(() => '?');
    ok(k3v === k3v30 && k3val === '30' && k3off === null, `K3: kapka bez closeAngle staví ${k3v} cm³ (= s 30° ${k3v30}), formulář ukazuje ${k3val} (dřív 0)`);
    await p.keyboard.press('Escape'); await p.waitForTimeout(300);
    await run('nový díl U24\nskica XY: obdélník 100 60\nprvek sheet.base sketchId=$last t=2\nprvek sheet.flange edges=9 length=20 angle=90 radius=0 relief=rect reliefWidth=4 reliefDepth=5\nprvek sheet.unfold'); await idle();
    const k4st = await status();
    const k4line = (k4st.split('\n').find((l) => /Rozvinout/.test(l)) || '').trim();
    ok(/⚠/.test(k4line) && /úleva ohybu se v rozvinu nekreslí/.test(k4st), `K4: Rozvinout hlásí varování: „${k4line.slice(0, 120)}“`);

    ok(errs.length === 0, `/cad bez chyb stránky ${JSON.stringify(errs).slice(0, 200)}`);
    await ctx.close();
  }

  // ── 25. /de/cad ──
  {
    const { ctx, p, errs } = await open(b, '/de/cad');
    const out = await p.evaluate(() => window.mncad.run('neues teil Senk\nskizze XY\nlinie 0 0 10 0\nlinie 0 0 3 8\nbedingung senkrecht e1 e2'));
    const text = typeof out === 'string' ? out : JSON.stringify(out);
    const d = await p.evaluate(() => window.mncad.getDocument());
    const sk = d.features.filter((x) => x.type === 'sketch').pop();
    const cons = (sk && sk.constraints) || [];
    ok(cons.some((c) => c.type === 'perpendicular') && !cons.some((c) => c.type === 'vertical'), `25: „bedingung senkrecht e1 e2“ = kolmo (${cons.map((c) => c.type).join(', ')})`);
    ok(/senkrecht e1 e2/.test(text), '25: protokol vypíše „senkrecht e1 e2“ (zapsatelné zpět)');
    const old = await p.evaluate(() => window.mncad.run('skizze XY\nlinie 0 0 0 10\nbedingung senkrecht e1'));
    ok(/vertikal/.test(typeof old === 'string' ? old : JSON.stringify(old)), '25: starý zápis „senkrecht e1“ skončí radou „vertikal“');
    await p.getByRole('button', { name: /^(Erstellen)$/ }).click().catch(() => {});
    await p.getByRole('button', { name: /^Skizze/ }).first().click().catch(() => {});
    await p.getByRole('button', { name: /Ebene XY/ }).click({ timeout: 4000 }).catch(() => {});
    let opened = await p.waitForSelector('[data-sketch-canvas]', { timeout: 8000 }).then(() => true, () => false);
    if (!opened) { await p.keyboard.press('s'); opened = await p.waitForSelector('[data-sketch-canvas]', { timeout: 8000 }).then(() => true, () => false); }
    await p.waitForTimeout(600);
    const labels = await p.locator('[data-ribbon] button[aria-label]').evaluateAll((bs) => bs.map((x) => x.getAttribute('aria-label')));
    ok(opened && labels.some((l) => /^Skalieren/.test(l)) && !labels.some((l) => /^Maßstab/.test(l)), `25: Skizzenband: „Skalieren“ statt „Maßstab“ (${labels.filter((l) => /Skal|Maßst/.test(l)).join(', ')})`);
    await p.screenshot({ path: S + 'w13-de-sketch.png' });
    await p.keyboard.press('Escape').catch(() => {}); await p.waitForTimeout(300);
    // K2: výkresová kóta – protokol píše „vertikal“ a to samé slovo parser výkresu přijme
    const t1 = String(await p.evaluate(() => window.mncad.run('neues teil Z25\nquader 100 60 20\nzeichnung maß senkrecht ansicht vorne 0 0 0 20')));
    const t2 = String(await p.evaluate(() => window.mncad.run('zeichnung maß vertikal ansicht vorne 100 0 100 20')));
    ok(/^✓ Maß 20 \(.*vertikal/m.test(t1) && !/^\s*✗/m.test(t1), `K2: protokol svislé kóty: „${(t1.split('\n').find((l) => /Maß 20/.test(l)) || t1).trim().slice(0, 90)}“`);
    ok(/^✓ Maß 20/m.test(t2) && !/^\s*✗/m.test(t2), `K2: „zeichnung maß vertikal …“ projde: „${(t2.split('\n').find((l) => /Maß/.test(l)) || t2).trim().slice(0, 90)}“`);
    ok(errs.length === 0, `/de/cad bez chyb stránky ${JSON.stringify(errs).slice(0, 200)}`);
    await ctx.close();
  }
  await b.close();
  console.log(fails ? `FAIL: ${fails} kontrol selhalo` : 'ok: vše prošlo');
})().catch((e) => { console.log('FAIL: ' + (e && e.stack || e)); process.exit(1); });
