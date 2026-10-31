# mnastrojarna.cz — firemní web

Nový web Mnástrojárny s.r.o. — **„Váš partner ve strojírenství“**. Samostatná Next.js 15 aplikace (nezávislá na CNC Sales OS v kořeni repozitáře), statické stránky pro maximální rychlost a SEO.

## Co web umí

- **Hero se 3D scénou** (three.js): obráběný díl, fréza kreslí zářící dráhu nástroje, jiskry, bloom; respektuje `prefers-reduced-motion`, na mobilu odlehčené.
- **Oživené logo** z originálního vektoru logomanuálu — štít se sestaví po pásech, třísky odletí, červená záře.
- **Poptávkový formulář ve 3 krocích** s kvalifikací leadů:
  - zakázky pod 50 000 Kč jsou slušně odmítnuty (nejde odeslat),
  - povinné IČO / VAT ID (kontrolní součet + automatické doplnění firmy z **ARES**),
  - upozornění na freemail, skóre leadu **A/B/C** v předmětu e-mailu,
  - přílohy (PDF/STEP/DXF/DWG/IGES/STL… do 4 MB) nebo odkaz na úložiště, volba NDA,
  - antispam: honeypot, minimální doba vyplnění, rate-limit.
- **Online 3D prohlížeč STEP/IGES/STL** (`/3d-prohlizec`) — OpenCascade ve WebAssembly, vše lokálně v prohlížeči; gabarit, objem, povrch, hmotnost v 7 materiálech; jedním klikem do poptávky (SEO magnet + přidaná hodnota).
- **SEO**: metadata a canonical na každé stránce, JSON-LD (Organization/LocalBusiness, Service, FAQPage, BreadcrumbList, WebApplication), `sitemap.xml`, `robots.txt`, OG obrázek, **301 přesměrování všech starých URL** (`/cz/...`).
- **Měření konverzí**: GA4 / Google Ads s Consent Mode — spouští se až po souhlasu; události `rfq_start`, `rfq_step`, `generate_lead`, `cad_viewer_open`, `cad_viewer_to_rfq`.

Veškerý obsah (služby, stroje, tým, FAQ, kontakty) je v jednom souboru: **`src/content/site.ts`**.

## Vývoj

```bash
cd website
npm install
npm run dev        # http://localhost:3100
npm run typecheck && npm run lint && npm test && npm run build
```

Bez nastaveného SMTP/webhooku se poptávka v dev režimu jen vypíše do konzole.

E2E test (3D prohlížeč → poptávka → ARES → odeslání):

```bash
node e2e/hook-server.cjs /tmp/hook.json &
LEAD_WEBHOOK_URL=http://localhost:3999/ npm run build && LEAD_WEBHOOK_URL=http://localhost:3999/ npm start &
mkdir -p /tmp/e2e/shots && HOOK_FILE=/tmp/hook.json node e2e/rfq.e2e.cjs /tmp/e2e src/lib/__fixtures__/cube.stp
```

## Nasazení na Vercel

1. Vercel → **Add New Project** → stejný GitHub repozitář.
2. **Root Directory: `website`** (Framework: Next.js, Node 22).
3. Environment Variables podle `.env.example` (minimálně `SMTP_*` + `LEAD_TO`).
4. Domains: `www.mnastrojarna.cz` (+ přesměrování `mnastrojarna.cz` → `www`).
5. Po spuštění: Google Search Console → odeslat `https://www.mnastrojarna.cz/sitemap.xml`.

Poptávky chodí e-mailem do firemní schránky, takže je **CNC Sales OS** (IMAP synchronizace) automaticky převezme jako poptávku — není potřeba další integrace.

## Doplnit

- Fotografie týmu → `public/team/*.jpg` a pole `photo` v `TEAM` (`src/content/site.ts`).
- Fotky dílny a vyrobených dílů (staré fotky mají nízké rozlišení).
