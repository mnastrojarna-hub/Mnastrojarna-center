# mnastrojarna.cz — firemní web

Nový web Mnástrojárny s.r.o. — **„Váš partner ve strojírenství“**. Samostatná Next.js 15 aplikace (nezávislá na CNC Sales OS v kořeni repozitáře), statické stránky pro maximální rychlost a SEO.

## Co web umí

- **Světlý „výkresový“ design** – bílý papír, technický rastr, ořezové značky, rohové razítko, kóty. Hero jako výkresový list s 3D dílem, odkazovými kótami a CAD kurzorem se souřadnicemi.
- **Scrollovací 3D příběh „Od polotovaru k protokolu“** – při scrollu se polotovar reálně soustruží (nůž ubírá materiál), 5osé frézování vyvrtá díry, 3D sonda změří body a objeví se měřicí protokol.
- **Kalkulačka prostoje linky** – B2B argument „prostoj stojí víc než díl“ → CTA na náhradní díly / konsignační sklad.
- **Oživené logo** z originálního vektoru logomanuálu (pásy štítu se sestaví, třísky odletí).
- **Mnástrojárna CAD (`/cad`)** – plnohodnotný parametrický 3D/2D CAD v prohlížeči nad jádrem **OpenCascade** (replicad, WebAssembly ve web workeru):
  - skicář (úsečka, obdélník se zaoblením, kružnice, oblouk 3 body, mnohoúhelník, drážka), přichytávání, přesné rozměry číslem, výrazy (`25/2`),
  - prvky: vysunutí (symetrické, opačně), rotace, kvádr/válec/trubka/kužel/koule, díra se zahloubením (kliknutím na plochu), zaoblení a sražení vybraných hran, skořepina, lineární/kruhové pole, zrcadlení, import STEP,
  - strom prvků (úpravy, potlačení, mazání), zpět/vpřed, automatické ukládání, projekt `.mncad`,
  - export **STEP**, **STL**, **2D výkres** (pohledy ISO E, izometrie, kóty, razítko) do **PDF / DXF / SVG**, DXF přímo ze skici,
  - „Poptat výrobu“ předá model jako STEP do poptávky.
- **Poptávkový formulář ve 3 krocích** s kvalifikací leadů (pod 50 000 Kč nelze odeslat, IČO + ARES, skóre A/B/C, přílohy, NDA, antispam) a 3D náhledem přiloženého STEP.
- **SEO**: metadata a canonical, JSON-LD (Organization/LocalBusiness, Service, FAQPage, BreadcrumbList, WebApplication), sitemap, robots, OG obrázek, 301 ze všech starých URL.
- **Měření konverzí**: GA4 / Google Ads s Consent Mode (`rfq_start`, `rfq_step`, `generate_lead`, `cad_open`, `cad_feature`, `cad_export`, `cad_to_rfq`).

## Archiv zakázek

`/zakazky` (EN `/en/projects`, DE `/de/projekte`) – skutečné fotografie z dílny, data v **`src/content/cases.ts`**.
Popisy zatím vycházejí jen z toho, co je na fotkách vidět. U každé zakázky lze doplnit `brief` (zadání), `solution` (řešení),
`result` (výsledek), rok a technologie ve všech třech jazycích – web je automaticky zobrazí.
Nová zakázka: fotky do `public/img/zakazky/<slug>/1.jpg, 2.jpg…` a záznam do `CASES`.

## Pohyb a animace

GSAP + ScrollTrigger + SplitText a plynulý scroll Lenis (`src/components/motion.tsx`), řízené data-atributy:
`data-split` (nadpis po řádcích), `data-img` (odkrytí fotky), `data-speed` (paralaxa), `data-scrub-text` (rozsvěcování slov),
`data-hscroll` (vodorovný scroll), `data-draw` (kreslení kót), `data-magnetic`, `data-cursor="Popisek"` (vlastní kurzor).
Vše respektuje `prefers-reduced-motion`.

## Jazykové verze (CZ / EN / DE)

| Jazyk | Adresy | Příklad |
| --- | --- | --- |
| Čeština (výchozí) | bez prefixu | `/sluzby/nastrojarstvi` |
| Angličtina | `/en/…` | `/en/services/toolmaking` |
| Němčina | `/de/…` | `/de/leistungen/werkzeugbau` |

- Každý jazyk má **vlastní SEO adresy**, vlastní `<html lang>`, `hreflang` alternativy (cs-CZ, en, de, x-default) a sitemapu.
- Přepínač jazyků v hlavičce vede na **stejnou stránku** v jiném jazyce.
- Poptávka v EN/DE: hlášky v daném jazyce, rozpočty v CZK s přepočtem na EUR, zahraniční VAT ID, potvrzovací e-mail zákazníkovi v jeho jazyce. Interní e-mail obchodníkovi zůstává česky (s údajem „Jazyk webu“).
- Online CAD (`/cad`) má zatím jen české rozhraní (EN/DE stránky na to upozorňují).

**Kde jsou texty:**
- `src/content/cs.ts` – český slovník (zdroj), `en.ts`, `de.ts` – překlady se stejnou strukturou (hlídá TypeScript i test). Text v `*hvězdičkách*` se v nadpisech zobrazí červeně.
- `src/content/site.ts` – jazykově nezávislá fakta: kontakty, IČO, tým, stroje, **reference**.
- `src/i18n/config.ts` – tabulka lokalizovaných adres. Při změně adresy přejmenujte i odpovídající složku v `src/app/(en|de|cs)` – test `routes.test.ts` nesoulad odhalí.

## Reference

Stránka Reference (`/reference`, `/en/references`, `/de/referenzen`) a sekce na úvodní stránce zobrazují:
- loga a případové studie z pole `REFERENCES` v `src/content/site.ts` – **doplňte jen se souhlasem klienta**:

```ts
export const REFERENCES: Reference[] = [
  {
    id: "firma-x",
    client: "Firma X a.s.",
    logo: "/references/firma-x.svg",      // soubor do public/references/
    country: "CZ",
    services: ["nahradni-dily-pro-vyrobni-linky", "cnc-obrabeni"],
    text: {
      cs: { title: "Náhradní válce pro balicí linku", summary: "…", result: "…" },
      en: { title: "Spare rollers for a packaging line", summary: "…" },
      de: { title: "Ersatzwalzen für eine Verpackungslinie", summary: "…" },
    },
  },
];
```

- dokud je pole prázdné: obory, ve kterých pracujeme, a blok „Reference na vyžádání“ (žádné vymyšlené údaje).

## Vývoj

```bash
cd website
npm install
npm run dev        # http://localhost:3100
npm run typecheck && npm run lint && npm test && npm run build
```

Bez nastaveného SMTP/webhooku se poptávka v dev režimu jen vypíše do konzole.

E2E testy (běžící server na :3100):

```bash
node e2e/hook-server.cjs /tmp/hook.json &
LEAD_WEBHOOK_URL=http://localhost:3999/ npm run build && LEAD_WEBHOOK_URL=http://localhost:3999/ npm start &
mkdir -p /tmp/e2e/shots && HOOK_FILE=/tmp/hook.json node e2e/rfq.e2e.cjs /tmp/e2e src/lib/__fixtures__/cube.stp
node e2e/cad.e2e.cjs /tmp/e2e   # CAD: skica → vysunutí → zaoblení → díra → STEP/DXF/SVG → poptávka
node e2e/i18n.e2e.cjs /tmp/e2e  # jazyky: přepínač, anglická poptávka (VAT ID), mobil
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
