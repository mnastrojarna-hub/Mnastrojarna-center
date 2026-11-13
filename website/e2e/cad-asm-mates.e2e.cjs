// E2E k vazbám sestavy (analýza nástrojů, bod 8 + části bodů 7 a 19):
// vazba vytvořená ze seznamů (komponenta + plocha) bez klikání do 3D, hodnota Vzdálenosti / Úhlu potvrzená až po výběru ploch
// (předvyplněná naměřená – komponenta se nepohne), úprava hodnoty v seznamu vazeb s přepočtem, vazba Ukotvit (přidat / smazat),
// Souosost nabízí jen válcové plochy, kombinace seznamu s kliknutím v modelu, směr pole komponenty (X / Y / Z, obrátit, z plochy
// v modelu), Enter potvrdí název komponenty, anglické rozhraní bez chybějících překladů.
// Spuštění: E2E_BASE=http://localhost:3203 node e2e/cad-asm-mates.e2e.cjs <složka>   (výchozí server http://localhost:3100)
const { chromium } = require('playwright');
const fs = require('fs');
const S = (process.argv[2] || '/tmp/e2e').replace(/\/?$/, '/');
fs.mkdirSync(S, { recursive: true });
const ok = (c, m) => { console.log((c ? 'ok: ' : 'FAIL: ') + m); if (!c) process.exitCode = 1; };
const BASE = (process.env.E2E_BASE || 'http://localhost:3100').replace(/\/$/, '');
const coreReady = (page) => page.waitForFunction(() => document.body.innerText.includes('OCCT') && !/Načítám jádro|Loading the OpenCascade kernel/.test(document.body.innerText), null, { timeout: 180000 });
const start = async (page, cont = 'Pokračovat v práci') => { const c = page.getByText(cont); if (await c.isVisible({ timeout: 6000 }).catch(() => false)) await c.click(); await coreReady(page); await page.waitForTimeout(800); };
const run = (p, t) => p.evaluate((t) => window.mncad.run(t), t);
const status = (p) => p.evaluate(() => window.mncad.status());
const getDoc = (p) => p.evaluate(() => window.mncad.getDocument());
const comp = (d, id) => (d.components || []).find((c) => c.id === id);
const near = (a, b, tol = 1e-3) => a.length === b.length && a.every((v, i) => Math.abs(v - b[i]) <= tol);
const envelope = (st) => (st.match(/obálka ([^·\n]*) mm/) || ['', ''])[1].trim();
/** čeká, až dokument splní podmínku (řešič vazeb běží asynchronně), a vrátí ho – i když ji nesplnil (ohlásí to následující ok) */
const docWhen = async (p, fn, timeout = 15000) => { const t0 = Date.now(); let d = await getDoc(p); while (!fn(d) && Date.now() - t0 < timeout) { await p.waitForTimeout(150); d = await getDoc(p); } return d; };

const part = (name, features) => ({ app: 'mnastrojarna-cad', version: 2, name, kind: 'part', material: 'ocel', features });
const box = (name, size, extra = []) => part(name, [{ id: 'b', name: 'Kvádr', type: 'box', size, position: [0, 0, 0], centered: false, mode: 'new' }, ...extra]);
const at = (position) => ({ position, rotation: [0, 0, 0] });
const ASM = { app: 'mnastrojarna-cad', version: 2, name: 'Vazby', kind: 'assembly', material: 'ocel', features: [], components: [
  { id: 'c1', name: 'Deska', fixed: true, source: { kind: 'part', doc: box('Deska', [100, 60, 10], [{ id: 'h', name: 'Otvor', type: 'cylinder', radius: 4.2, height: 40, position: [15, 15, -15], axis: 'Z', mode: 'cut' }]) }, placement: at([0, 0, 0]) },
  { id: 'c2', name: 'Vložka', source: { kind: 'part', doc: box('Vložka', [40, 30, 20]) }, placement: at([30, 15, 25]) },
  { id: 'c3', name: 'Blok', source: { kind: 'part', doc: box('Blok', [20, 20, 20]) }, placement: at([120, 20, 40]) },
  { id: 'c4', name: 'Klín', source: { kind: 'part', doc: box('Klín', [10, 10, 10]) }, placement: at([-40, 0, 0]) },
  { id: 'c5', name: 'Páka', source: { kind: 'part', doc: box('Páka', [30, 10, 10]) }, placement: at([0, 100, 0]) },
  { id: 'c6', name: 'Čep', source: { kind: 'part', doc: part('Čep', [{ id: 'c', name: 'Válec', type: 'cylinder', radius: 4, height: 12, position: [0, 0, 0], axis: 'Z', mode: 'new' }]) }, placement: at([150, -30, 0]) },
] };

(async () => {
  const b = await chromium.launch({ args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader'] });
  const ctx = await b.newContext({ viewport: { width: 1500, height: 950 } });
  const p = await ctx.newPage();
  const errs = []; p.on('pageerror', (e) => errs.push(e.message));
  await p.goto(BASE + '/cad', { waitUntil: 'networkidle', timeout: 240000 }); await start(p);

  const tree = p.locator('aside').first();
  const panel = p.locator('aside').filter({ hasText: 'Komponenta ·' });
  /** vybere komponentu ve stromu (pravý panel pak patří jí) */
  const select = async (name) => {
    if (await panel.getByText('Komponenta · ' + name, { exact: false }).isVisible().catch(() => false)) return;
    await tree.getByText(name, { exact: true }).first().click();
    await panel.getByText('Komponenta · ' + name, { exact: false }).waitFor({ timeout: 5000 });
  };
  const rows = (step) => panel.locator(`[data-face-list="${step}"] [data-face-row]`);
  const pickRow = async (step, text) => { const r = rows(step).filter({ hasText: text }).first(); await r.waitFor({ timeout: 20000 }); await r.click(); };
  const target = (name) => panel.locator('[data-mate-target]').selectOption({ label: name });

  let log = await run(p, JSON.stringify(ASM));
  ok(/✓ dokument „Vazby“/.test(log), 'sestava z JSON otevřena');
  await p.waitForTimeout(4000); // stavba komponent
  let st = await status(p);
  ok(/Sestava: 6 komponent/.test(st), 'stav: 6 komponent\n' + (st.match(/Sestava[^\n]*/) || [''])[0]);
  const env0 = envelope(st);

  // ── 1. Kontakt jen ze seznamů (bez kliknutí do 3D): komponenta se přisune ──
  await select('Vložka');
  await panel.locator('[data-mate-mode="mate"]').click();
  await rows('a').first().waitFor({ timeout: 20000 });
  const listA = await rows('a').allInnerTexts();
  ok(listA.length === 6 && listA.every((t) => /Plocha \d+ · rovinná · normála [+−][XYZ]/.test(t) && /střed .+ · [\d,]+ mm²/.test(t)), 'seznam ploch vybrané komponenty: 6 rovinných ploch s typem, normálou, středem a obsahem\n' + listA[0].replace(/\n/g, ' | '));
  ok(/normála [+−]Z[\s\S]*1200 mm²/.test(listA[0]), 'plochy jsou seřazené od největší (40 × 30 = 1200 mm²) a v souřadnicích sestavy\n' + listA[0].replace(/\n/g, ' | '));
  // zvýraznění plochy v modelu při najetí na řádek seznamu
  const canvas = p.locator('main canvas').first();
  const before = await canvas.screenshot();
  await rows('a').filter({ hasText: 'normála +Z' }).first().hover(); await p.waitForTimeout(500);
  const hovered = await canvas.screenshot({ path: S + 'asm-mates-hover.png' });
  ok(!before.equals(hovered), 'najetí na řádek seznamu zvýrazní plochu v modelu (obraz 3D se změnil)');
  await pickRow('a', 'normála −Z');
  await panel.locator('[data-face-chosen="a"]').waitFor({ timeout: 5000 });
  ok(/normála −Z/.test(await panel.locator('[data-face-chosen="a"]').innerText()), 'krok 1: vybraná plocha je popsaná (normála −Z) a jde změnit');
  const opts = await panel.locator('[data-mate-target] option').allInnerTexts();
  ok(opts.join('|') === 'Deska|Blok|Klín|Páka|Čep', 'krok 2: cílová komponenta se volí ze seznamu komponent sestavy (bez vybrané)\n' + opts.join(' | '));
  await target('Deska');
  await rows('b').first().waitFor({ timeout: 20000 });
  const listB = await rows('b').allInnerTexts();
  ok(listB.length === 6 && listB.every((t) => /rovinná/.test(t)), 'Kontakt nabízí u desky s otvorem jen rovinné plochy (válcová plocha otvoru chybí)\n' + listB.length);
  await p.screenshot({ path: S + 'asm-mates-picker.png' });
  await pickRow('b', 'normála +Z');
  let d = await docWhen(p, (d) => (d.mates || []).length === 1 && Math.abs(d.components.find((c) => c.id === 'c2').placement.position[2] - 10) < 1e-3);
  ok(d.mates?.length === 1 && d.mates[0].type === 'mate' && d.mates[0].a.compId === 'c2' && d.mates[0].b.compId === 'c1', 'vazba Kontakt vytvořena ze seznamů: Vložka → Deska\n' + JSON.stringify(d.mates));
  ok(near(comp(d, 'c2').placement.position, [30, 15, 10]), 'vazba komponentu přisunula: Vložka z = 25 → 10 (dosedla na desku), X a Y beze změny\n' + JSON.stringify(comp(d, 'c2').placement));
  ok((await panel.locator('[data-mate-picker]').count()) === 0, 'po vytvoření vazby se panel zadávání zavře');

  // ── 2. Vzdálenost: hodnota až po výběru ploch, předvyplněná naměřená → komponenta se nepohne; úprava v seznamu přepočítá ──
  await select('Blok');
  await panel.locator('[data-mate-mode="distance"]').click();
  await rows('a').first().waitFor({ timeout: 20000 });
  ok((await panel.locator('[data-mate-pending-value]').count()) === 0 && (await panel.locator('input[aria-label="Vzdálenost"]').count()) === 0, 'hodnota vzdálenosti se před výběrem ploch nezadává');
  await pickRow('a', 'normála −Z');
  await target('Deska');
  await pickRow('b', 'normála +Z');
  const pend = panel.locator('[data-mate-pending-value] input');
  await pend.waitFor({ timeout: 5000 });
  ok((await pend.inputValue()) === '30', 'po výběru obou ploch je pole předvyplněné naměřenou vzdáleností 30 mm (bylo: ' + (await pend.inputValue()) + ')');
  d = await getDoc(p);
  ok(d.mates.length === 1, 'vazba se nevytvoří, dokud hodnotu nepotvrdíte');
  await p.screenshot({ path: S + 'asm-mates-value.png' });
  await panel.locator('[data-mate-confirm]').click();
  d = await docWhen(p, (d) => (d.mates || []).length === 2);
  await p.waitForTimeout(1200); // přepočet vazeb
  d = await getDoc(p);
  const dist = d.mates.find((m) => m.type === 'distance');
  ok(!!dist && dist.value === 30 && dist.a.compId === 'c3' && dist.b.compId === 'c1', 'vazba Vzdálenost 30 vytvořena po potvrzení\n' + JSON.stringify(dist));
  ok(near(comp(d, 'c3').placement.position, [120, 20, 40]) && near(comp(d, 'c3').placement.rotation, [0, 0, 0]), 'výchozí (naměřená) hodnota nechala komponentu na místě\n' + JSON.stringify(comp(d, 'c3').placement));
  // úprava hodnoty existující vazby v seznamu vazeb (levý panel)
  const distRow = tree.locator(`[data-mate="${dist.id}"]`);
  const distVal = distRow.locator('input[aria-label="Vzdálenost"]');
  ok((await distVal.inputValue()) === '30', 'seznam vazeb: hodnota vzdálenosti je v editovatelném poli');
  await distVal.fill('12,5'); await distVal.press('Enter');
  d = await docWhen(p, (d) => Math.abs(d.components.find((c) => c.id === 'c3').placement.position[2] - 22.5) < 1e-3);
  ok(d.mates.find((m) => m.id === dist.id).value === 12.5 && near(comp(d, 'c3').placement.position, [120, 20, 22.5]), 'úprava hodnoty 30 → 12,5 sestavu přepočítala: Blok z = 40 → 22,5\n' + JSON.stringify(comp(d, 'c3').placement.position));
  await distVal.fill('25/2+7,5'); await distVal.press('Enter');
  d = await docWhen(p, (d) => Math.abs(d.components.find((c) => c.id === 'c3').placement.position[2] - 30) < 1e-3);
  ok(d.mates.find((m) => m.id === dist.id).value === 20 && near(comp(d, 'c3').placement.position, [120, 20, 30]), 'pole přijme výraz (25/2+7,5 = 20): Blok z = 30\n' + JSON.stringify(comp(d, 'c3').placement.position));
  ok(/bg-emerald-500/.test(await distRow.locator('span.rounded-full').first().getAttribute('class')), 'vazba je po úpravě splněná (zelená tečka)');

  // ── 3. Vzdálenost s přepsanou hodnotou potvrzenou Enterem ──
  await select('Klín');
  await panel.locator('[data-mate-mode="distance"]').click();
  await pickRow('a', 'normála +X');
  await target('Deska');
  await pickRow('b', 'normála −X');
  await pend.waitFor({ timeout: 5000 });
  ok((await pend.inputValue()) === '30', 'Klín: naměřeno 30 mm mezi bočními plochami');
  await pend.fill('5'); await pend.press('Enter');
  d = await docWhen(p, (d) => Math.abs(d.components.find((c) => c.id === 'c4').placement.position[0] + 15) < 1e-3);
  ok(d.mates.length === 3 && d.mates[2].value === 5 && near(comp(d, 'c4').placement.position, [-15, 0, 0]), 'přepsaná hodnota 5 + Enter: vazba vytvořena a Klín se přisunul na 5 mm (x = −40 → −15)\n' + JSON.stringify(comp(d, 'c4').placement.position));

  // ── 4. Úhel: naměřených 90° předvyplněno, 60° natočí komponentu ──
  await select('Páka');
  await panel.locator('[data-mate-mode="angle"]').click();
  await pickRow('a', 'normála +X');
  await target('Deska');
  await pickRow('b', 'normála +Y');
  await pend.waitFor({ timeout: 5000 });
  ok((await pend.inputValue()) === '90' && (await panel.locator('[data-mate-pending-value]').innerText()).includes('°'), 'Úhel: předvyplněno naměřených 90°');
  await pend.fill('60'); await pend.press('Enter');
  d = await docWhen(p, (d) => (d.mates || []).length === 4 && Math.abs(Math.abs(d.components.find((c) => c.id === 'c5').placement.rotation[2]) - 30) < 1e-2);
  ok(d.mates.length === 4 && d.mates[3].type === 'angle' && d.mates[3].value === 60 && near(comp(d, 'c5').placement.rotation.map(Math.abs), [0, 0, 30], 1e-2), 'Úhel 60°: Páka se natočila o 30° kolem Z\n' + JSON.stringify(comp(d, 'c5').placement));

  // ── 5. Souosost: jen válcové plochy; čep se přesune do osy otvoru ──
  await select('Čep');
  await panel.locator('[data-mate-mode="concentric"]').click();
  await rows('a').first().waitFor({ timeout: 20000 });
  const cylA = await rows('a').allInnerTexts();
  ok(cylA.length === 1 && /válcová Ø8 · osa Z/.test(cylA[0]) && /délka 12 mm/.test(cylA[0]), 'Souosost nabízí jen válcové plochy: čep má jednu (Ø8, osa Z, délka 12)\n' + cylA.join(' / ').replace(/\n/g, ' | '));
  await pickRow('a', 'válcová');
  await target('Deska');
  await rows('b').first().waitFor({ timeout: 20000 });
  const cylB = await rows('b').allInnerTexts();
  ok(cylB.length === 1 && /válcová Ø8,4 · osa Z/.test(cylB[0]) && /střed osy 15; 15; 5/.test(cylB[0]), 'deska: jen válcová plocha otvoru Ø8,4 se středem osy 15; 15; 5\n' + cylB.join(' / ').replace(/\n/g, ' | '));
  await pickRow('b', 'válcová');
  d = await docWhen(p, (d) => (d.mates || []).length === 5 && Math.abs(d.components.find((c) => c.id === 'c6').placement.position[0] - 15) < 1e-3);
  ok(d.mates.length === 5 && d.mates[4].type === 'concentric' && near(comp(d, 'c6').placement.position, [15, 15, 0]), 'Souosost ze seznamů: Čep se přesunul do osy otvoru (15; 15)\n' + JSON.stringify(comp(d, 'c6').placement.position));
  await p.waitForTimeout(800);
  st = await status(p);
  ok(!!env0 && !!envelope(st) && envelope(st) !== env0, 'textový stav: obálka sestavy se vazbami změnila (' + env0 + ' → ' + envelope(st) + ')');

  // ── 6. vazba Ukotvit: tlačítko, řádek v seznamu vazeb, smazání uvolní ──
  await select('Blok');
  await panel.locator('[data-mate-mode="fixed"]').click();
  d = await docWhen(p, (d) => (d.mates || []).some((m) => m.type === 'fixed'));
  const fx = d.mates.find((m) => m.type === 'fixed');
  ok(!!fx && fx.a.compId === 'c3' && comp(d, 'c3').fixed === true, 'Ukotvit: vazba fixed pro vybranou komponentu, komponenta je ukotvená\n' + JSON.stringify(fx));
  const fxRow = tree.locator(`[data-mate="${fx?.id}"]`);
  ok(/Ukotvit\s*Blok/.test((await fxRow.innerText()).replace(/\n/g, ' ')), 'vazba Ukotvit je v seznamu vazeb (Ukotvit · Blok)');
  ok(/border-brand/.test(await panel.locator('[data-mate-mode="fixed"]').getAttribute('class')), 'tlačítko Ukotvit je u ukotvené komponenty zvýrazněné');
  await p.screenshot({ path: S + 'asm-mates-list.png' });
  await fxRow.hover();
  await fxRow.locator('button[title="Smazat vazbu"]').click();
  d = await docWhen(p, (d) => !(d.mates || []).some((m) => m.type === 'fixed'));
  ok(!d.mates.some((m) => m.type === 'fixed') && !comp(d, 'c3').fixed && d.mates.length === 5, 'smazání vazby Ukotvit v seznamu komponentu uvolní, ostatní vazby zůstanou');

  // ── 7. seznam a 3D lze kombinovat: plocha vybrané komponenty ze seznamu, cílová kliknutím v modelu (pohled shora) ──
  await select('Blok');
  await run(p, 'zobraz horní'); await p.waitForTimeout(1500);
  const cb = await canvas.boundingBox();
  const SPOTS = [[0.5, 0.5], [0.45, 0.5], [0.55, 0.5], [0.5, 0.45], [0.5, 0.55], [0.4, 0.5], [0.6, 0.5], [0.5, 0.4], [0.5, 0.6]];
  /** kliká do modelu kolem středu okna, dokud podmínka neplatí (střed pohledu shora leží nad deskou / vložkou) */
  const clickModelUntil = async (done) => { for (const [fx2, fy2] of SPOTS) { await p.mouse.click(cb.x + cb.width * fx2, cb.y + cb.height * fy2); await p.waitForTimeout(800); if (await done()) return true; } return false; };
  await panel.locator('[data-mate-mode="parallel"]').click();
  await pickRow('a', 'normála +Z');
  await panel.locator('[data-face-chosen="a"]').waitFor({ timeout: 5000 });
  const hit = await clickModelUntil(async () => (await getDoc(p)).mates.some((m) => m.type === 'parallel'));
  d = await getDoc(p);
  const par = d.mates.find((m) => m.type === 'parallel');
  ok(hit && !!par && par.a.compId === 'c3' && par.b.compId !== 'c3', 'vazba Rovnoběžně: první plocha ze seznamu, druhá kliknutím v modelu\n' + JSON.stringify(par));
  ok(near(comp(d, 'c3').placement.position, [120, 20, 30]), 'rovnoběžné plochy: Blok zůstal na místě');

  // ── 8. pole komponenty: směr tlačítky X / Y / Z, obrácení a z plochy v modelu ──
  const dirVals = async () => (await panel.locator('[data-pattern-direction] input').evaluateAll((els) => els.map((e) => e.value))).join(' ');
  /** pole směru se překreslí o snímek později než kliknutí – chvíli počkat na očekávanou hodnotu */
  const dirBecomes = async (re) => { for (let i = 0; i < 20 && !re.test(await dirVals()); i++) await p.waitForTimeout(100); return re.test(await dirVals()); };
  ok((await dirVals()) === '1 0 0', 'pole: výchozí směr 1 0 0');
  await panel.locator('[data-pattern-dir="Y"]').click();
  ok(await dirBecomes(/^0 1 0$/), 'pole: tlačítko Y nastaví směr 0 1 0 → ' + (await dirVals()));
  await panel.locator('[data-pattern-dir="flip"]').click();
  ok(await dirBecomes(/^0 -1 0$/), 'pole: ± obrátí směr → ' + (await dirVals()));
  await panel.locator('[data-pattern-dir="face"]').click();
  ok(/Klikněte na plochu v modelu/.test(await panel.locator('[data-pattern-dir="face"]').innerText()), 'pole: „Směr z plochy v modelu…“ čeká na kliknutí do modelu');
  const picked = await clickModelUntil(async () => !/Klikněte na plochu v modelu/.test(await panel.locator('[data-pattern-dir="face"]').innerText()));
  ok(picked && (await dirBecomes(/^0 0 -?1$/)), 'pole: kliknutí na vodorovnou plochu v pohledu shora převezme její normálu (směr ±Z) → ' + (await dirVals()));
  await p.screenshot({ path: S + 'asm-mates-pattern.png' });
  const nBefore = (await getDoc(p)).components.length;
  await panel.getByRole('button', { name: /Vytvořit pole/ }).click();
  d = await docWhen(p, (d) => d.components.length === nBefore + 2);
  const copies = d.components.filter((c) => /^Blok \(/.test(c.name));
  ok(d.components.length === nBefore + 2 && copies.length === 2 && copies.every((c, i) => near([c.placement.position[0], c.placement.position[1]], [120, 20]) && Math.abs(Math.abs(c.placement.position[2] - 30) - 50 * (i + 1)) < 1e-3), 'pole 3× ve směru Z: dvě kopie po 50 mm nad sebou\n' + copies.map((c) => JSON.stringify(c.placement.position)).join(' '));

  // ── 9. Enter potvrdí název / číslo / skupinu komponenty ──
  await select('Klín');
  const nameIn = panel.locator('input[aria-label="Název"]');
  await nameIn.fill('Klín A'); await nameIn.press('Enter');
  d = await docWhen(p, (d) => d.components.find((c) => c.id === 'c4').name === 'Klín A');
  ok(comp(d, 'c4').name === 'Klín A', 'Enter v poli Název potvrdí změnu (bez opuštění pole myší)');
  const grpIn = panel.locator('input[aria-label="Skupina"]');
  await grpIn.fill('Dorazy'); await grpIn.press('Enter');
  const numIn = panel.locator('input[aria-label="Číslo / norma"]');
  await numIn.fill('QA-7'); await numIn.press('Enter');
  d = await docWhen(p, (d) => d.components.find((c) => c.id === 'c4').number === 'QA-7');
  ok(comp(d, 'c4').group === 'Dorazy' && comp(d, 'c4').number === 'QA-7', 'Enter potvrdí i Skupinu a Číslo / normu\n' + JSON.stringify({ group: comp(d, 'c4').group, number: comp(d, 'c4').number }));
  await nameIn.fill('zahodit'); await nameIn.press('Escape'); await p.waitForTimeout(400);
  ok(comp(await getDoc(p), 'c4').name === 'Klín A', 'Esc v poli Název změnu zahodí');
  await p.screenshot({ path: S + 'asm-mates-final.png' });

  // ── 10. anglické rozhraní: panel vazby přeložený, žádný chybějící klíč ──
  const e = await ctx.newPage();
  e.on('pageerror', (x) => errs.push('en: ' + x.message));
  await e.goto(BASE + '/en/cad', { waitUntil: 'networkidle', timeout: 240000 }); await start(e, 'Continue working');
  await run(e, JSON.stringify(ASM)); await e.waitForTimeout(4000);
  const etree = e.locator('aside').first();
  const epanel = e.locator('aside').filter({ hasText: 'Component ·' });
  await etree.getByText('Blok', { exact: true }).first().click();
  await epanel.locator('[data-mate-mode="distance"]').click();
  const erowsA = epanel.locator('[data-face-list="a"] [data-face-row]');
  await erowsA.first().waitFor({ timeout: 20000 });
  ok(/Face \d+ · planar · normal [+−][XYZ]/.test(await erowsA.first().innerText()) && (await epanel.getByText('1 · Face of this component').count()) === 1, 'EN: seznam ploch a krok 1 jsou anglicky\n' + (await erowsA.first().innerText()).replace(/\n/g, ' | '));
  await erowsA.filter({ hasText: 'normal −Z' }).first().click();
  await epanel.locator('[data-mate-target]').selectOption({ label: 'Deska' });
  await epanel.locator('[data-face-list="b"] [data-face-row]').filter({ hasText: 'normal +Z' }).first().click();
  await epanel.locator('[data-mate-pending-value] input').waitFor({ timeout: 5000 });
  ok((await epanel.getByRole('button', { name: 'Create mate' }).count()) === 1 && /measured/.test(await epanel.locator('[data-mate-pending-value]').innerText()), 'EN: potvrzení hodnoty („Create mate“, „measured“)');
  await epanel.locator('[data-mate-confirm]').click(); await e.waitForTimeout(1200);
  await epanel.locator('[data-mate-mode="fixed"]').click(); await e.waitForTimeout(600);
  ok(/Fix\s*Blok/.test((await etree.locator('[data-mate-type="fixed"]').innerText()).replace(/\n/g, ' ')), 'EN: vazba Ukotvit v seznamu jako „Fix“');
  await e.screenshot({ path: S + 'asm-mates-en.png' });
  const missing = await e.evaluate(() => window.mncad.missing());
  ok(missing.length === 0, 'EN: žádný chybějící překlad ' + JSON.stringify(missing.slice(0, 8)));

  ok(errs.length === 0, 'bez JS chyb ' + errs.join(' | '));
  await b.close();
})().catch((e) => { console.error('ERR', e.message); process.exit(1); });
