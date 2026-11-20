// E2E (vlna 19, balík text): kola a ozubení TEXTEM na produkčním sestavení (window.mncad.run = konzole Textové příkazy):
//  – všechny řádky ze zadání: kolo čelní … díra 20 pero náboj 40 15 [polotovar], kolo šikmé … beta 15 pravé, kolo hřeben,
//    kolo řetězové 08B z 19 řady 2, kolo cykloidní, kolo hypoidní, soukolí čelní m 2 z1 20 z2 60 a 81 (3 záložky, vazba ok),
//  – anglicky (gear spur …) a německy (rad stirnrad …) stejná data, kolo tabulka (15,433 a 52,951), kolo nápověda čelní,
//  – výkres tabulka ozubení ano → SVG / DXF / PDF obsahují tabulku (PDF text přes pdf.js), přepínač „Tabulka ozubení“ ve výkrese,
//  – dokument → skript (window.mncad.script) zapíše `kolo …` a skript postaví stejná data a stejný objem.
// Spuštění (produkční build): E2E_BASE=http://localhost:3463 node e2e/cad-w19-text.e2e.cjs <složka pro snímky>
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');
const S = (process.argv[2] || '/tmp/e2e-w19-text').replace(/\/?$/, '/');
fs.mkdirSync(S, { recursive: true });
const ok = (c, m) => { console.log((c ? 'ok: ' : 'FAIL: ') + m); if (!c) process.exitCode = 1; };
const BASE = (process.env.E2E_BASE || 'http://localhost:3463').replace(/\/$/, '');

async function open(b, p0 = '/cad') {
  const ctx = await b.newContext({ viewport: { width: 1430, height: 900 }, acceptDownloads: true });
  const p = await ctx.newPage();
  const errs = []; p.on('pageerror', (e) => errs.push(e.message));
  p.on('dialog', (d) => d.dismiss().catch(() => {}));
  await p.goto(BASE + p0, { waitUntil: 'networkidle', timeout: 300000 });
  const cont = p.getByText(/Pokračovat v práci|Continue working/);
  if (await cont.isVisible({ timeout: 6000 }).catch(() => false)) await cont.click();
  await p.waitForFunction(() => !!window.mncad && !/Načítám jádro|Loading kernel/.test(document.body.innerText), null, { timeout: 240000 });
  await p.waitForTimeout(1000);
  if (await cont.isVisible().catch(() => false)) await cont.click();
  return { p, ctx, errs };
}
/** text PDF přes pdf.js (stejná knihovna jako aplikace) */
async function pdfText(base64) {
  const pdfjs = await import(path.resolve(__dirname, '../node_modules/pdfjs-dist/legacy/build/pdf.mjs'));
  const doc = await pdfjs.getDocument({ data: new Uint8Array(Buffer.from(base64, 'base64')), disableFontFace: true, useSystemFonts: false }).promise;
  let out = '';
  for (let i = 1; i <= doc.numPages; i++) out += (await (await doc.getPage(i)).getTextContent()).items.map((x) => x.str).join(' ') + '\n';
  return out;
}

(async () => {
  const b = await chromium.launch({ args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
  try {
  {
    let { p, errs } = await open(b);
    const pageErrs = [];
    // nová stránka mezi oddíly – desítky záložek s koly by na sdíleném stroji vyčerpaly paměť prohlížeče
    const fresh = async () => { pageErrs.push(...errs); await p.context().close(); ({ p, errs } = await open(b)); };
    const run = (t) => p.evaluate((t) => window.mncad.run(t), t);
    const idle = async () => { await p.waitForTimeout(300); await p.waitForFunction(() => !window.mncad.progress(), null, { timeout: 180000 }).catch(() => {}); await p.waitForTimeout(300); };
    const status = () => p.evaluate(() => window.mncad.status());
    const doc = () => p.evaluate(() => window.mncad.getDocument());
    const vol = async () => { const m = (await status()).match(/objem ([\d\s  ,]+) cm³/); return m ? parseFloat(m[1].replace(/[^\d,]/g, '').replace(',', '.')) : NaN; };
    const one = async (label, text, re) => {
      const t0 = Date.now();
      const out = String(await run(text));
      await idle();
      const st = await status();
      const good = /prvků 1 \(1 ✓, 0 ✗\)/.test(st) && /Geometrie: platná/.test(st) && !/^\s*✗/m.test(out) && (!re || re.test(st));
      ok(good, `${label} → 1 ✓, platná geometrie (${Date.now() - t0} ms)${good ? '' : `\n${out.slice(0, 600)}\n${st.slice(0, 600)}`}`);
      return { out, st };
    };

    // ── 1. řádky ze zadání (CS) ──
    let r = await one('kolo čelní m 2 z 24 b 20 x 0,2 úhel 20 díra 20 pero náboj 40 15', 'nový díl "Kolo A"\nkolo čelní m 2 z 24 b 20 x 0,2 úhel 20 díra 20 pero náboj 40 15', /čelní m2 z24 x0,2 b20 · d 48/);
    let f = (await doc()).features[0];
    ok(f.ext === 'gear.spur' && f.name === 'Ozubené kolo m2 z24' && f.data.x === 0.2 && f.data.bore === 20 && f.data.keyway === true && f.data.hubD === 40 && f.data.hubL === 15 && f.data.alpha === 20, 'data prvku: x 0,2 · díra 20 · pero · náboj Ø40 × 15 · α 20 · název „Ozubené kolo m2 z24“');
    r = await one('… polotovar (jen soustružené tělo)', 'nový díl Polotovar\nkolo čelní m 2 z 24 b 20 díra 20 pero náboj 40 15 polotovar');
    ok((await doc()).features[0].data.out === 'blank' && /polotovar/.test(r.st), 'polotovar: výstup blank, stav „polotovar“');
    await one('kolo šikmé m 2 z 30 b 20 beta 15 pravé', 'nový díl Šikmé\nkolo šikmé m 2 z 30 b 20 beta 15 pravé', /šikmé m2 z30 β15° pravý/);
    await one('kolo hřeben m 2 z 40 b 20 h 20', 'nový díl Hřeben\nkolo hřeben m 2 z 40 b 20 h 20', /hřeben/);
    await one('kolo řetězové 08B z 19 řady 2', 'nový díl Řetězka\nkolo řetězové 08B z 19 řady 2', /řetězové 08B-2 z19 · d 77,159/);
    await one('kolo cykloidní m 1 z 60 protikolo 8', 'nový díl Cykloidní\nkolo cykloidní m 1 z 60 protikolo 8');
    await one('kolo hypoidní z1 11 z2 41 de2 200 e 25', 'nový díl Hypoid\nkolo hypoidní z1 11 z2 41 de2 200 e 25');

    // ── 2. chyby lidsky ──
    let out = String(await run('kolo čelní m 2 z 24 modrá'));
    ok(/neznámé slovo „modrá“ – řádky: .*popis: kolo nápověda čelní/.test(out), 'neznámé slovo → ✗ se seznamem slov řádků a odkazem na nápovědu');

    await fresh();
    // ── 3. soukolí → 3 záložky, sestava se 2 komponentami a vazbou ozubení ──
    let t0 = Date.now();
    out = String(await run('soukolí čelní m 2 z1 20 z2 60 a 81'));
    await idle();
    let st = await status();
    ok(/Vazby: 1 \(1 ok\)/.test(st) && /2 komponent/.test(st) && /x₁ 0,3668/.test(out) && /ε_α 1,5199/.test(out), `soukolí čelní m 2 z1 20 z2 60 a 81: sestava 2 komponenty, vazba ozubení ok, x₁ 0,3668, ε_α 1,5199 (${Date.now() - t0} ms)`);
    const tabs = await p.evaluate(() => window.mncad.tabs());
    ok(['Pastorek m2 z20', 'Kolo m2 z60', 'Soukolí m2 z20/z60'].every((n) => JSON.stringify(tabs).includes(n)), 'záložky „Pastorek m2 z20“, „Kolo m2 z60“, „Soukolí m2 z20/z60“');
    const asm = await doc();
    ok(asm.kind === 'assembly' && asm.components.length === 2 && asm.mates[0].type === 'gear', 'sestava: 2 komponenty a vazba typu gear');
    await p.screenshot({ path: S + 'w19-text-pair.png' });

    // ── 4. EN / DE: stejná data ──
    await run('nový díl CS\nkolo čelní m 2 z 24 b 20 díra 20 pero náboj 40 15 obě strany'); await idle();
    const dCs = (await doc()).features[0].data;
    await run('nový díl EN\ngear spur m 2 z 24 b 20 bore 20 keyway hub 40 15 both sides'); await idle();
    const dEn = (await doc()).features[0].data;
    await run('nový díl DE\nrad stirnrad m 2 z 24 b 20 bohrung 20 nut nabe 40 15 beide seiten'); await idle();
    const dDe = (await doc()).features[0].data;
    ok(JSON.stringify(dCs) === JSON.stringify(dEn) && JSON.stringify(dCs) === JSON.stringify(dDe), 'kolo / gear / rad: stejná data prvku v CS, EN i DE');
    // dva běhy: nová záložka hned po stavbě šikmého kola na přetíženém stroji narazí na 5s limit přepnutí záložky aplikace
    out = String(await run('gear helical m 2 z 30 beta 15 left'));
    await idle();
    const out2 = String(await run('gearpair spur m 2 z1 20 z2 60'));
    await idle();
    ok(!/^\s*✗/m.test(out) && !/^\s*✗/m.test(out2) && /Soukolí „/.test(out2), `EN: gear helical … left a gearpair spur … bez chyby${/^\s*✗/m.test(out + out2) ? `\n${(out + out2).split('\n').filter((l) => /✗/.test(l)).join('\n')}` : ''}`);

    await fresh();
    // ── 5. kolo tabulka, kolo nápověda, stav ──
    await run('nový díl Tabulka\nkolo čelní m 2 z 24 b 20'); await idle();
    out = String(await run('kolo tabulka'));
    ok(/Tabulka ozubení – Ozubené kolo m2 z24/.test(out) && /15,433/.test(out) && /52,951/.test(out), 'kolo tabulka: W3 15,433 a M_dK 52,951');
    out = String(await run('kolo nápověda čelní'));
    ok(/m <číslo> \(modul\) – Modul mₙ \[mm\], povinné/.test(out) && /Příklad: kolo čelní m 2 z 24/.test(out), 'kolo nápověda čelní: řádky tabulky se slovy, jednotkami a příkladem');
    st = await status();
    ok(/čelní m2 z24 x0 b20 · d 48 · dₐ 52 · W3 15,433/.test(st), 'stav: jeden řádek se souhrnem kola');

    // ── 6. výkres s tabulkou ozubení: SVG, DXF, PDF + přepínač ve výkrese ──
    t0 = Date.now();
    out = String(await run('výkres A3 tabulka ozubení ano'));
    await idle();
    const ex = (fmt) => p.evaluate((fmt) => window.mncad.exportDrawing(fmt).then((r) => ({ ...r, text: fmt === 'svg' || fmt === 'dxf' ? new TextDecoder().decode(Uint8Array.from(atob(r.base64), (c) => c.charCodeAt(0))) : '' })), fmt);
    const svg = await ex('svg');
    ok(svg.text.includes('Tabulka ozubení – Ozubené kolo m2 z24') && svg.text.includes('15,433 mm') && svg.text.includes('52,951 mm'), `výkres tabulka ozubení ano → SVG obsahuje tabulku (${Date.now() - t0} ms)`);
    const dxf = await ex('dxf');
    ok(dxf.text.includes('15,433 mm') && dxf.text.includes('52,951 mm'), 'DXF obsahuje řádky W a M');
    const pdf = await ex('pdf');
    const ptxt = await pdfText(pdf.base64);
    ok(/Tabulka ozubení – Ozubené kolo m2 z24/.test(ptxt) && /15,433 mm/.test(ptxt), 'PDF obsahuje tabulku ozubení s řádkem W (text přes pdf.js)');
    const dst = await p.evaluate(() => window.mncad.drawingStatus());
    ok(/Tabulka ozubení: Ozubené kolo m2 z24 – mₙ 2 mm, z 24/.test(dst), 'výkres stav: řádek „Tabulka ozubení: …“');
    // výkres v aplikaci: přepínač „Tabulka ozubení“ (jen díl s kolem)
    const chk = p.getByText('Tabulka ozubení (modul, z, průměry, W, M)').first();
    if (!(await chk.isVisible({ timeout: 3000 }).catch(() => false))) {
      await run('výkres'); await p.waitForTimeout(1500);
      for (const name of ['Výkres', 'Listy a pohledy', 'List']) {
        if (await chk.isVisible({ timeout: 1000 }).catch(() => false)) break;
        await p.getByText(name, { exact: true }).first().click({ timeout: 2000 }).catch(() => {});
        await p.waitForTimeout(600);
      }
    }
    const vis = await chk.isVisible({ timeout: 15000 }).catch(() => false);
    const checked = vis ? await chk.locator('xpath=ancestor-or-self::label[1]//input').first().isChecked().catch(() => null) : null;
    ok(vis && checked !== false, `ve výkrese je přepínač „Tabulka ozubení“ (zapnutý: ${checked})`);
    await p.screenshot({ path: S + 'w19-text-drawing.png' });
    await p.keyboard.press('Escape').catch(() => {});

    pageErrs.push(...errs);
    ok(!pageErrs.length, `bez chyb stránky 1–6 (${pageErrs.slice(0, 3).join(' | ')})`);
    await p.context().close();
  }
  {
    // ── 7. dokument → skript → stejný model (nová stránka – předchozí záložky zabírají paměť sdíleného stroje) ──
    const { p, errs } = await open(b);
    const run = (t) => p.evaluate((t) => window.mncad.run(t), t);
    const idle = async () => { await p.waitForTimeout(300); await p.waitForFunction(() => !window.mncad.progress(), null, { timeout: 180000 }).catch(() => {}); await p.waitForTimeout(300); };
    const status = () => p.evaluate(() => window.mncad.status());
    const doc = () => p.evaluate(() => window.mncad.getDocument());
    const vol = async () => { const m = (await status()).match(/objem ([\d\s  ,]+) cm³/); return m ? parseFloat(m[1].replace(/[^\d,]/g, '').replace(',', '.')) : NaN; };
    let out;
    await run('nový díl "Skript kol"\nkolo šikmé m 1,5 z 30 b 12 beta 15 levé díra 10\nkolo řetězové 08B z 17 v 70 0 0'); await idle();
    const orig = await doc();
    const v0 = await vol();
    const script = await p.evaluate(() => window.mncad.script());
    ok(/^kolo šikmé m 1.5 z 30 b 12 beta 15 levé díra 10$/m.test(script) && /^kolo řetězové 08B z 17 v 70 0 0$/m.test(script) && !/prvek gear\./.test(script), 'window.mncad.script(): kola zapsaná vlastním příkazem „kolo …“');
    out = String(await run(script));
    await idle();
    const back = await doc();
    const v1 = await vol();
    ok(!/^\s*✗/m.test(out) && JSON.stringify(back.features.map((x) => [x.name, x.data])) === JSON.stringify(orig.features.map((x) => [x.name, x.data])) && Math.abs(v1 - v0) < 0.01, `skript → stejné prvky, data a objem (${v0} / ${v1} cm³)`);

    ok(!errs.length, `bez chyb stránky 7 (${errs.slice(0, 3).join(' | ')})`);
  }
  } catch (e) {
    ok(false, `výjimka: ${e && e.stack ? e.stack : e}`);
  } finally {
    await b.close();
  }
})();
