// E2E: 3D prohlížeč → poptávka → ARES → odeslání na webhook.
// Spuštění: node e2e/hook-server (viz README) + LEAD_WEBHOOK_URL=http://localhost:3999/ npm start, pak:
// node e2e/rfq.e2e.cjs <složka pro screenshoty, musí obsahovat shots/> src/lib/__fixtures__/cube.stp
const { chromium } = require('playwright');
const S = process.argv[2], FIX = process.argv[3];
const ok = (c, m) => { if (!c) { console.error('FAIL: ' + m); process.exitCode = 1; } else console.log('ok: ' + m); };
(async () => {
  const b = await chromium.launch({ args: ['--use-gl=swiftshader', '--enable-webgl', '--ignore-gpu-blocklist'] });
  const page = await b.newPage({ viewport: { width: 1280, height: 900 } });
  const errs = [];
  page.on('pageerror', e => errs.push(e.message));

  // 1) 3D prohlížeč → poptávka
  await page.goto('http://localhost:3100/3d-prohlizec', { waitUntil: 'networkidle' });
  await page.setInputFiles('input[type=file]', FIX);
  await page.getByText('Gabarit (mm)').waitFor({ timeout: 30000 });
  const dims = await page.locator('text=Gabarit (mm)').locator('xpath=..').innerText();
  ok(/×/.test(dims), '3D prohlížeč změřil model: ' + dims.replace(/\n/g, ' '));
  await page.screenshot({ path: S + '/shots/e2e-viewer.png' });
  await page.getByRole('button', { name: /Poptat výrobu tohoto dílu/ }).click();
  await page.waitForURL(/poptavka/);

  // 2) krok 1
  await page.getByRole('button', { name: 'Pokračovat' }).click();
  ok(await page.getByText('Vyberte alespoň jednu oblast.').isVisible(), 'validace kroku 1');
  await page.getByRole('button', { name: 'CNC obrábění', exact: true }).click();
  await page.getByLabel('Méně než 50 000 Kč').check();
  ok(await page.getByText(/menší zakázky a opravy bohužel/).isVisible(), 'zakázka pod 50 tis. je odmítnuta');
  ok(await page.getByRole('button', { name: 'Pokračovat' }).isDisabled(), 'tlačítko zablokováno pod 50 tis.');
  await page.getByLabel('200 tis. – 1 mil. Kč').check();
  await page.locator('#description').fill('Sada 20 ks hřídelí pro balicí linku, materiál 42CrMo4, kalení + broušení.');
  await page.getByRole('button', { name: 'Pokračovat' }).click();

  // 3) krok 2 — soubor z prohlížeče je předaný
  ok(await page.getByText(/cube\.stp/).first().isVisible(), 'soubor z 3D prohlížeče je v poptávce');
  await page.getByText('Gabarit (mm)').waitFor({ timeout: 30000 });
  await page.getByRole('button', { name: 'Pokračovat' }).click();

  // 4) krok 3 — ARES
  await page.locator('#ico').fill('04304080');
  await page.waitForFunction(() => document.querySelector('#company')?.value?.length > 3, null, { timeout: 15000 });
  ok(true, 'ARES doplnil firmu: ' + await page.locator('#company').inputValue());
  await page.locator('#name').fill('Test Testovič');
  await page.locator('#email').fill('test@firma-test.cz');
  await page.getByRole('button', { name: /Odeslat poptávku/ }).click();
  ok(await page.getByText(/Bez souhlasu nemůžeme/).isVisible(), 'vyžaduje souhlas GDPR');
  await page.locator('input[type=checkbox]').last().check();
  await page.waitForTimeout(3000); // antispam min. 3 s
  await page.getByRole('button', { name: /Odeslat poptávku/ }).click();
  await page.getByText('Poptávka odeslána').waitFor({ timeout: 20000 });
  ok(true, 'poptávka odeslána');
  await page.screenshot({ path: S + '/shots/e2e-done.png' });
  const hook = JSON.parse(require('fs').readFileSync((process.env.HOOK_FILE || S + '/hook.json'), 'utf8'));
  ok(hook.lead.company && hook.company?.name, 'webhook přijal lead: ' + hook.lead.company + ' / skóre ' + hook.score.grade + ' ' + hook.score.score);
  ok(hook.files[0]?.name === 'cube.stp', 'příloha dorazila');
  ok(/mm/.test(hook.lead.cad), 'souhrn 3D modelu: ' + hook.lead.cad);
  ok(errs.length === 0, 'žádné JS chyby ' + errs.join('|'));
  await b.close();
})().catch(e => { console.error(e); process.exit(1); });
