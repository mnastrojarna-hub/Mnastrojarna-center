# mnastrojarna.cz — firemní web

Nový web Mnástrojárny s.r.o. — **„Váš partner ve strojírenství“**. Samostatná Next.js 15 aplikace (nezávislá na CNC Sales OS v kořeni repozitáře), statické stránky pro maximální rychlost a SEO.

## Co web umí

- **Světlý „výkresový“ design** – bílý papír, technický rastr, ořezové značky, rohové razítko, kóty. Hero jako výkresový list s 3D dílem, odkazovými kótami a CAD kurzorem se souřadnicemi.
- **Scrollovací 3D příběh „Od polotovaru k protokolu“** – při scrollu se polotovar reálně soustruží (nůž ubírá materiál), 5osé frézování vyvrtá díry, 3D sonda změří body a objeví se měřicí protokol.
- **Kalkulačka prostoje linky** – B2B argument „prostoj stojí víc než díl“ → CTA na náhradní díly / konsignační sklad.
- **Oživené logo** z originálního vektoru logomanuálu (pásy štítu se sestaví, třísky odletí).
- **Mnástrojárna CAD (`/cad`)** – profesionální parametrický 3D/2D CAD v prohlížeči nad jádrem **OpenCascade** (replicad, WebAssembly ve web workeru), UI a ovládání po vzoru ZW3D (pás karet, správce historie, formulář prvku OK/Storno, řádek výzev, ViewCube, kontextové nabídky podle entity, schémata myši ZW3D/SolidWorks). Podrobný stav a plán: **`CAD-ROADMAP.md`**.
  - **Skica:** úsečka, lomená čára, obdélník, kružnice, oblouk, elipsa, spline, mnohoúhelník, drážka, bod, osa; přichytávání (koncový bod, střed, kvadrant, průsečík, kolmo, tečně, mřížka), 13 geometrických vazeb a řídicí kóty s řešičem, oříznout/prodloužit/odsadit/zaoblit/srazit/zrcadlit/pole/rozložit, měření, DXF import/export,
  - **díl:** vysunutí (+úkos), rotace, tažení, šablonování, primitiva, díra (průvodce: zahloubení, kuželové, závit ISO), zaoblení, sražení, skořepina, úkos, rozříznutí, žebro, pružina, text, závit, pole, zrcadlení, přesun, pomocná rovina; přímé úpravy ploch (vytáhnout/zatlačit, odsadit, odstranit, zesílit), proměnné/rovnice, vazby parametrů, stavy (konfigurace),
  - **sestava:** komponenty, vazby Kontakt/Zarovnat/Vystředit, podsestavy, gizmo, úprava dílu v kontextu, rozložený pohled, kontrola kolizí, kusovník (plochý/strukturovaný) + CSV, generátor rámu vstřikovací formy,
  - **knihovna normálií (Ctrl+L):** 46 rodin – šrouby, matice, podložky, kolíky, pera, pojistné kroužky, ložiska, evolventní ozubená kola, řetězová kola ISO 606, řemenice, IPE/HEA/HEB/UPN/L/jäkly/trubky/tyče, O-kroužky, pružiny, normálie forem – stačí napsat „M8x30“, „ložisko 6205“, „kolo m2 z24“, „IPE 200 L=1500“,
  - **formy:** barevná analýza úkosů, smrštění, návrh dělicí roviny, vyhazovačů a chladicích kanálů,
  - **výkresy:** listy A4–A0, ISO E/A, řez A–A se šrafováním, osy, kóty, razítko, kusovník ISO 7573 → **PDF** (vektorové, čeština), **DXF**, **DWG R2000–R2018**, SVG,
  - **formáty:** import STEP, IGES, BREP, STL, OBJ, 3MF, glTF/GLB, PLY, OFF, DXF; export STEP, BREP, STL, 3MF, OBJ, GLB, VRML, DWG; nativní formáty (SLDPRT, IPT, Z3, CATPart…) → návod na STEP,
  - **nástroje:** výběrový filtr entit, inspektor, měření mezi entitami, řez, hmotnostní vlastnosti, paleta příkazů (Ctrl+K), nastavení (jednotky, myš, zkratky, výkres), úvodní obrazovka s nedávnými soubory, projekt `.mncad`,
  - „Poptat výrobu“ uloží model jako STEP a otevře e-mail obchodníkovi (Vít Volný) – soubor stačí přiložit.
- **Kontakt bez formuláře** – všechna CTA („Poptat výrobu“, kalkulačky, služby, CAD) otevírají e-mail s předvyplněným předmětem přímo primárnímu kontaktu **Vítu Volnému** (`SALES` v `src/content/site.ts`); technolog Dominik Šponer je uveden jako druhý kontakt. Staré URL poptávky (`/poptavka`, `/en/request-a-quote`, `/de/anfrage`) přesměrují 301 na kontakt.
- **SEO**: metadata a canonical, JSON-LD (Organization/LocalBusiness, Service, FAQPage, BreadcrumbList, WebApplication), sitemap, robots, OG obrázek, 301 ze všech starých URL.
- **Měření konverzí**: GA4 / Google Ads s Consent Mode (`cad_open`, `cad_feature`, `cad_export`, `cad_to_rfq`; kliky na `mailto:`/`tel:` lze měřit v GA4 jako odchozí odkazy).

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

E2E testy (běžící server na :3100):

```bash
npm run build && npm start &
mkdir -p /tmp/e2e/shots
node e2e/cad.e2e.cjs /tmp/e2e   # CAD: úvod → ukázka → skica+vysunutí → paleta → měření → knihovna → výkres PDF/DXF/DWG/SVG → rám formy → kusovník → STEP
node e2e/i18n.e2e.cjs /tmp/e2e  # jazyky: přepínač, přesměrování poptávky, kontakt V. Volný, mobil
```

## Nasazení na Vercel

1. Vercel → **Add New Project** → stejný GitHub repozitář.
2. **Root Directory: `website`** (Framework: Next.js, Node 22).
3. Environment Variables podle `.env.example` (vše volitelné – GA4, Search Console).
4. Domains: `www.mnastrojarna.cz` (+ přesměrování `mnastrojarna.cz` → `www`).
5. Po spuštění: Google Search Console → odeslat `https://www.mnastrojarna.cz/sitemap.xml`.

Poptávky chodí e-mailem přímo do schránky Víta Volného, takže je **CNC Sales OS** (IMAP / Microsoft 365 synchronizace) převezme jako poptávku — web nepotřebuje žádný backend ani SMTP.

## Doplnit

- Fotografie týmu → `public/team/*.jpg` a pole `photo` v `TEAM` (`src/content/site.ts`).
- Fotky dílny a vyrobených dílů (staré fotky mají nízké rozlišení).
