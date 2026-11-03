# mnastrojarna.cz — firemní web

Nový web Mnástrojárny s.r.o. — **„Váš partner ve strojírenství“**. Samostatná Next.js 15 aplikace (nezávislá na CNC Sales OS v kořeni repozitáře), statické stránky pro maximální rychlost a SEO.

## Co web umí

- **Světlý „výkresový“ design** – bílý papír, technický rastr, ořezové značky, rohové razítko, kóty. Hero jako výkresový list s 3D dílem, odkazovými kótami a CAD kurzorem se souřadnicemi.
- **Scrollovací 3D příběh „Od polotovaru k protokolu“** – při scrollu se polotovar reálně soustruží (nůž ubírá materiál), 5osé frézování vyvrtá díry, 3D sonda změří body a objeví se měřicí protokol.
- **Kalkulačka prostoje linky** – B2B argument „prostoj stojí víc než díl“ → CTA na náhradní díly / konsignační sklad.
- **Oživené logo** z originálního vektoru logomanuálu (pásy štítu se sestaví, třísky odletí).
- **Mnástrojárna CAD (`/cad`)** – profesionální parametrický 3D/2D CAD v prohlížeči nad jádrem **OpenCascade** (replicad, WebAssembly ve web workeru), UI a ovládání po vzoru ZW3D (pás karet, správce historie, formulář prvku OK/Storno, řádek výzev, ViewCube, kontextové nabídky podle entity, schémata myši ZW3D/SolidWorks). Podrobný stav a plán: **`CAD-ROADMAP.md`**; způsoby zadání prvků (referenční systém: 8 ukončení vysunutí, 14 voleb bodu, 12 definic rovin, 10 os, 5 druhů pole, 6 + 5 variant zaoblení/zkosení, číselné zadání ve skice – srovnání s ZW3D/SolidWorks/NX): **`CAD-PLAN-ZADANI.md`**, zadání 5. vlny **`CAD-WAVE5.md`**. **Dokumentace pro uživatele** (web `/cad/dokumentace`, PDF `public/cad/mnastrojarna-cad-prirucka.pdf`, Markdown `public/cad/dokumentace.md`, `public/llms.txt`) vzniká z jednoho zdroje `src/content/cad-docs.ts`; obnova: `npm run docs:assets -- <složky se snímky>`, `npm run docs:text`, `npm run docs:pdf` (nad běžícím serverem, `DOCS_URL`).
  - **Skica:** úsečka, lomená čára, obdélník, kružnice, oblouk, elipsa, spline, mnohoúhelník, drážka, bod, osa; přichytávání (koncový bod, střed, kvadrant, průsečík, kolmo, tečně, mřížka), 13 geometrických vazeb a řídicí kóty s řešičem, oříznout/prodloužit/odsadit/zaoblit/srazit/zrcadlit/pole/rozložit, měření, DXF import/export,
  - **díl:** vysunutí (+úkos), rotace, tažení, šablonování, primitiva, díra (průvodce: zahloubení, kuželové, závit ISO), zaoblení, sražení, skořepina, úkos, rozříznutí, žebro, pružina, text, závit, pole, zrcadlení, přesun, pomocná rovina; přímé úpravy ploch (vytáhnout/zatlačit, odsadit, odstranit, zesílit), proměnné/rovnice, vazby parametrů, stavy (konfigurace),
  - **sestava:** komponenty, trvalé vazby (kontakt, zarovnat, vystředit, souosost, vzdálenost, úhel, rovnoběžně) s řešičem, pole a zrcadlení komponent, šroubový spoj do díry, podsestavy, gizmo, úprava dílu v kontextu, rozložený pohled, kontrola kolizí, kusovník (plochý/strukturovaný) + CSV, generátor rámu vstřikovací formy,
  - **knihovna normálií (Ctrl+L):** 103 rodin – šrouby, matice, podložky, kolíky, pera, pojistné kroužky, ložiska, evolventní ozubená kola, řetězová kola ISO 606, řemenice, IPE/HEA/HEB/UPN/L/jäkly/trubky/tyče, O-kroužky, pružiny, normálie forem – stačí napsat „M8x30“, „ložisko 6205“, „kolo m2 z24“, „IPE 200 L=1500“,
  - **plochy (karta Plochy, 19 příkazů):** plošné vysunutí/rotace/tažení/šablonování, rovinná a odsazená plocha, prodloužit, oříznout, sešít, záplata, uzavřít → těleso, zesílit, rozdělit, křivka průniku, promítnutí, šroubovice a tažení po šroubovici,
  - **plech (karta Plech, 12 příkazů):** parametry t/R/K, základní plech, ohyb z hrany s úlevou, lem, ohyb podle čáry, výřez, rohová úleva, prolis, rozvinout, rozvin → DXF/SVG s čarami ohybů a tabulkou ohybů,
  - **svařence (karta Svařence, 10 příkazů):** konstrukční profily po skice s pokosy, rám z profilů, desky, ořez, víčka, styčníky, svarové housenky, značky svarů ISO 2553, kusovník řezů, tabulka svarů,
  - **pokročilé modelování (18 příkazů):** proměnné, plné a řetězcové zaoblení, sražení D1×D2, úkos od dělicí roviny, zkrut, kopule, text na válci, lem/drážka, díry v bodech skici, zrcadlení prvků, pole podél křivky a výplňové, měřítko, kontrola a sjednocení geometrie, tloušťka stěn,
  - **formy:** barevná analýza úkosů, smrštění, návrh dělicí roviny, vyhazovačů a chladicích kanálů; analýza ploch (zebra, křivost, tloušťka stěn),
  - **výkresy:** listy A4–A0 (více listů), ISO E/A, řez A–A se šrafováním, detailní pohled, osy, automatické kóty, razítko, kusovník ISO 7573, balónky pozic, tabulka děr, tabulka revizí; uživatelské asociativní kóty, poznámky s odkazem, drsnosti ISO 1302, geometrické tolerance ISO 1101, základny a texty uložené v dokumentu → **PDF** (vektorové, čeština), **DXF**, **DWG R2000–R2018**, SVG,
  - **formáty:** import STEP, IGES, BREP, STL, OBJ, 3MF, glTF/GLB, PLY, OFF, DXF; export STEP, BREP, STL, 3MF, OBJ, GLB, VRML, DWG; nativní formáty (SLDPRT, IPT, Z3, CATPart…) → návod na STEP,
  - **nástroje:** výběrový filtr entit, inspektor, měření mezi entitami, řez, hmotnostní vlastnosti, paleta příkazů (Ctrl+K), nastavení (jednotky, myš, zkratky, výkres), úvodní obrazovka s nedávnými soubory, projekt `.mncad`,
  - **výrobní výkres bez nevyžádaných údajů:** nepředepsané tolerance (ISO 2768-mK) a opracování hran se na výkres nedoplňují samy – jen vyplněná pole razítka (každé zvlášť, lze smazat, tlačítko „Doplnit obvyklé“); závitové díry se kótují jako „M6 hl. 12“ s počtem místo Ø jádra; **Kontrola kót** porovná kóty na listu s historií prvků a vypíše chybějící (Ø, závity, drážky, zaoblení…), tolerance (H8, ±0,1) u kóty v poli „přípona“; nástroje Text/Poznámka/Drsnost/GD&T/Základna jsou jednorázové s viditelným stavem (volba „opakovat“); změny razítka a poznámek nepřepočítávají projekce (mezipaměť HLR i tělesa),
  - **materiál:** třída (hustota) + volné **označení do razítka** (ČSN 11 423, 1.0503) v panelu Správce i v razítku výkresu, uloženo v dokumentu (`materialName`) – přenáší se odkazem i souborem; textový příkaz `materiál …` rozliší třídu a označení a protokol to oznámí,
  - **export bez dialogu:** Nastavení → Soubory „Při ukládání a exportu se zeptat…“ (vypnuto = přímé stažení pod výchozím názvem), stav exportu (hotov + název a velikost), `window.mncad.exportFile("step")` vrací soubor jako base64; opakovaný test `e2e/cad-plate-roundtrip.e2e.cjs` (vytvořit → výkres → sdílet → znovu otevřít → STEP tam a zpět),
  - **modelování myší pro AI agenty (Ctrl+Shift+L, Nápověda → Popisky pro výběr myší):** štítky F1 / E2 / V3 na viditelných plochách, hranách a vrcholech a P1… / O ve skice leží přesně na entitě a nepřijímají kliknutí – klik na střed štítku je klik na entitu (stejná cesta jako myš, Ctrl = přidat); `title` nese význam (rovinná plocha s normálou +Z, svislá úsečka, délka, souřadnice); `window.mncad.hints()` / `clickHint("F3")`; pro člověka bez zapnutí beze změny; test „jako člověk“ `e2e/cad-human.e2e.cjs`, dříve neověřené body `e2e/cad-verify.e2e.cjs` (PDF přes poppler, vypršení odkazu, heslo, příliš velký model, STEP tam a zpět, obnova po pádu),
  - **textové rozhraní pro AI agenty a automatizaci (Ctrl+Shift+K, Nápověda → Textové příkazy):** řádkové příkazy česky/anglicky (`kvádr 100 60 20`, `díra 8,5 skrz v 20 30`, `zaoblit 2 hrany svislé`, `skořepina 2 otevřít +Z`, `pole kruhové 4`…), JSON dokumentu (všech 36 typů prvků), výběr hran a ploch pravidlem, protokol ✓/✗ s důvodem + textový stav dokumentu (rozměry, objem, prvky), `window.mncad` API (run, getDocument, setDocument, status, guide), paleta Ctrl+K nabídne „Provést příkaz“; návod a schéma pro AI `public/cad/schema-pro-ai.md` (generuje `docs:text` z `src/cad/agent-guide.ts` + typů), odkaz v llms.txt; lidské UI beze změny (`src/cad/agent.ts`, test `e2e/cad-agent.e2e.cjs`),
  - **bez WebGL nespadne:** dostupnost WebGL se ověří před spuštěním 3D okna, selhání rendereru i ztráta kontextu se zachytí (hranice chyb) a místo pádu je česká chybová obrazovka s příčinou a postupem; nabídky, nápověda, soubory, 2D skica a výkresy fungují dál; **Zkopírovat diagnostiku** (chybová obrazovka i Nápověda) = verze, prohlížeč, WebGL, jádro, chyba – bez dat dokumentu (`src/cad/diagnostics.ts`, test `e2e/cad-webgl.e2e.cjs` s vypnutým WebGL),
  - **sdílení odkazem (tlačítko Sdílet):** díl, sestava i výkres jedním odkazem pro WhatsApp / e-mail / Teams; platnost 1–90 dní, volitelné heslo; dokument je zkomprimovaný v části odkazu za `#` (na server nejde), velké importované modely volitelně do šifrovaného úložiště (`NEXT_PUBLIC_CAD_SHARE_URL/KEY`, SQL `supabase/migrations/20261103120000_cad_share.sql`),
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
