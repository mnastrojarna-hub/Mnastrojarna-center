# CAD – vlna 24: plán (jen plán, nic z toho ještě není opraveno)

Založeno 28. 11. 2026. Tento soubor je **pracovní zadání pro další kolo** (po obnovení limitu). Kdo podle něj pracuje, čte ho celý
a postupuje po balících v kapitole 7. Předchozí rozdělaná práce (vlna 22 kolo 7b, vlna 23 kolo 5) je v `PREDANI-CAD.md`,
kapitola „Průběžný stav“ – ta se dokončuje **před** balíky této vlny, pokud není řečeno jinak.

Obsah: 1. zadání majitele · 2. závazný výklad (pravidla R8–R14) · 3. co už v kódu je · 4. nálezy z reportů ·
5. vlastní pozorování výstupního výkresu · 6. zásady ovládání (UX) · 7. balíky práce · 8. pořadí · 9. co je potřeba od majitele ·
10. příjem dalších reportů.

---

## 1. Zadání majitele (28. 11. 2026, doslova zkráceno jen o výplň)

> Když někdo kótuje, jakýkoliv agent, který použije nástroj na CAD, musí vždy dokótovat celý. Když dělá výkres, musí vždy všechno
> dokótovat. A každý rozměr musí dle technických značek správně zatolerovat. Buď to bude volný rozměr a budou tam všeobecné
> tolerance netolerovaných rozměrů (ISO 2768…), a zbytek bude dotolerovaný; stejně tak tam budou obecné tolerance geometrie,
> povrchu, úhlů či pozic děr. Obecně to tam musí být. Za druhé by měl mít tendenci používat standardní uložení (H, f, g a podobně).
> Stejně tak tolerance závitů. Nikdy nesmí být jakýkoliv díl nedokótovaný. Vždy tam musí být 100 % kót.
>
> Pokud jakýkoliv agent bude překreslovat výkres – z fotky, z modelu nebo odkudkoliv – musí vždy provést kontrolu: udělá kontrolní
> výkres, zakótuje přesně to, co je na původním výkresu, a poté kontroluje otrocky kótu po kótě, originál versus nová, a tím ověří
> geometrii. Je to jediný způsob, jak ověřit geometrii. Včetně všech odrážek, textů, povrchových a tepelných úprav. To samé kusovník
> v sestavách. U každého dílu kótu po kótě 1 : 1 na kontrolním výkrese versus originální výkres. Tohle musí dělat každý agent,
> který použije nástroj na CAD. Stejně jako všechna ostatní pravidla pro agenty. Jinak ty výkresy nejsou technické.
>
> Reporty jsou z poslední nasazené verze, testováno myší a klávesnicí. Zatím nic neopravovat. Všechno přečíst, analyzovat a začlenit
> do plánu, podle kterého se bude pracovat po resetu limitu. Aby to bylo pro uživatele snadné: uživatel minimum píše, nebude
> vypisovat souřadnice – chce kliknout, zanést, označit, vybrat. Přijdou další reporty; někde bude průnik problémů, někde
> ojedinělé problémy. Všechno zapracovat do jasného, detailně rozpracovaného plánu.

---

## 2. Závazný výklad – pravidla R8–R14 (navazují na R1–R7 vlny 23, `S/w23/req.md`)

Platí pro **každou cestu agenta** (textové příkazy v konzoli, CLI `mncad`, HTTP, řádek JSON dokumentu, `window.mncad.*`).
Člověk v GUI dostane stejné kontroly jako nabídku a panel, ale nástroj mu nic nezakazuje (stejně jako u R6).
Porušení = `✗` a odmítnutý export; nikdy `✓`. V přísném režimu STOP. Žádná falešná zelená (R7).

| # | Pravidlo | Co přesně znamená „splněno“ |
| --- | --- | --- |
| **R8** | **100 % kót.** Výkres dílu od agenta je úplně zakótovaný. | Kontrola úplnosti kót: velikosti n/n, polohy n/n, každý prvek modelu (díra, závit, drážka, sražení, zaoblení, osazení, kapsa, výřez) má všechny rozměry a polohu k základně. Kontrola jde **z geometrie** (asociativní kóta na entitě), ne z hledání čísla v textu. Nedokótovaný výkres agent nevyexportuje. |
| **R9** | **Každý rozměr je tolerovaný.** | a) V hlavičce jsou vždy: obecné tolerance délek a úhlů (výchozí ISO 2768-1 m), obecné geometrické tolerance (výchozí ISO 2768-2 K, volitelně ISO 22081), obecná drsnost, hrany (ISO 13715). b) Každá kóta je buď „volná“ (kryta a), nebo má vlastní toleranci (uložení ISO 286, mezní úchylky, ±). c) Funkční prvky nesmí zůstat volné: průměr díry/čepu určeného k lícování, šířka drážky pro pero, rozteč a poloha děr s funkcí, vzdálenost os – ty mají toleranci nebo polohovou toleranci. Chybí-li a) → `✗`. |
| **R10** | **Standardní uložení.** | Agent u lícovaných prvků volí přednostní uložení ISO 286 (díry H7/H8/H11, hřídele f7/g6/h6/k6/n6/p6/s6, drážky P9/N9/JS9, D10 …). Číselná ± tolerance na lícovaném průměru místo uložení = `⚠ drawing.fit-nonstandard` s nápovědou nejbližšího přednostního uložení (ne `✗` – „mít tendenci“). |
| **R11** | **Tolerance závitů.** | Každý závit na výkresu má označení včetně toleranční třídy (výchozí 6H vnitřní, 6g vnější) a u jemných stoupání i stoupání. Závit bez třídy od agenta = `✗` s nápovědou. Průměry mimo katalog (např. M60×2) musí jít zadat. |
| **R12** | **Překreslení = kontrolní výkres a protokol 1 : 1.** | Když agent pracuje podle předlohy (fotka, sken, PDF/DWG, cizí model), musí: 1) zapsat **soupis předlohy** – každou kótu, toleranci, značku drsnosti, text, odkaz, tepelnou a povrchovou úpravu, položku razítka a řádek kusovníku; 2) na kontrolním výkresu zakótovat **tytéž kóty na týchž místech** jako předloha, hodnotou z geometrie; 3) spustit porovnání položku po položce: `SHODA / NESHODA / CHYBÍ / NEČITELNÉ V PŘEDLOZE`; 4) přiložit protokol. Bez protokolu nebo s `NESHODA`/`CHYBÍ` není výstup `✓` a nese označení „pracovní – neověřeno“. `NEČITELNÉ` je povolený stav, ale musí být vypsaný. U sestav totéž pro každý díl a pro kusovník. |
| **R13** | **Přepis není shoda.** | Položka je `SHODA` jen tehdy, když hodnota pochází z modelu (kóta na entitě, parametr prvku), ne z ručně přepsaného textu kóty. Ručně přepsaná hodnota = `✗` (už dnes: text kóty bez hodnoty). Tolerance je strukturovaný údaj kóty, ne volná přípona. |
| **R14** | **Platí pro všechny agenty a je to v návodu.** | Pravidla R1–R14 jsou v návodu pro AI (`agent-guide.ts`, `schema-pro-ai.md`, tahák), v nápovědě CLI a vynucuje je nástroj. Návod sám nestačí. |

Výchozí rozhodnutí (aby se nečekalo na dotaz; majitel může změnit):
- Obecné tolerance: výchozí zápis v hlavičce „ISO 2768-mK“. Norma ISO 2768-2 je sice nahrazena ISO 22081, ale v dílnách se dál používá; ISO 22081 bude volba.
- Polohy děr: výchozí je kótování od základen s obecnou tolerancí; u roztečí s funkcí (šrouby, kolíky) `⚠`, pokud nemají toleranci nebo polohovou toleranci.
- Sestavový list: úplnost kót se kontroluje na výkresech dílů; sestavový list musí mít celkové a připojovací rozměry, kusovník a pozice. Svařenec kreslený jedním listem se kontroluje jako díl (všechny díly svařence na listu).
- Nakupované a normalizované díly se nekótují.

---

## 3. Co už v kódu je a kde jsou mezery

| Oblast | Soubory | Stav | Mezera proti R8–R14 |
| --- | --- | --- | --- |
| Kontrola úplnosti kót | `website/src/cad/dim-check.ts`, `components/cad/dim-check-panel.tsx`, `engine/sheet-eval.ts` | existuje (`expectedDims`, `dimCheck`, kód `dims-incomplete`) | `presentDims(texts)` páruje **podle čísla v textu**, ne podle entity → přepsaný text projde, stejné číslo na jiném prvku projde. Dnes jen `⚠`, export povolen. Na listu sestavy vrací „rozměry dílů se kontrolují na výkresech dílů“ (`drawing-agent.ts:556`, `:1179`). |
| Tolerance kót | `cad/drawing-fits.ts` (ISO 286), `agent-drawing.ts`, `drawing-views-panel.tsx` | uložení umí; `výkres kontrola tolerancí` (vlna 15) | V GUI test psal H8 a ±0,1 jako **ruční příponu** → nestrukturované. Chybí pravidlo „funkční prvek nesmí být volný“ a doporučení přednostních uložení. |
| Obecné tolerance v hlavičce | `components/cad/drawing-title-panel.tsx`, `cad/settings.ts`, `cad/drawing.ts` | pole pro ISO 2768 existuje, vlna 23 přidala tvrdost, drsnost, hrany | Není povinné. Chybí obecná geometrická tolerance jako samostatný údaj a kontrola „hlavička úplná“. |
| Závity | `cad/thread-spec.ts` (katalog M2–M48), `components/cad/props.tsx`, `forms/more-forms.tsx` | třída závitu jde zapsat | Katalog končí M48; kosmetický režim uloží neznámý závit bez geometrie, geometrický ho odmítne (rozpor). Třída není povinná. |
| Předloha a porovnání | `cad/reference/*` (`extract.ts`, `compare.ts`, `bom.ts`, `pdf.ts`, `run.ts`), `engine/ops/reference.ts` | umí vytáhnout kóty z DWG/DXF/vektorového PDF a porovnat s modelem | Neumí předlohu z **fotografie** (soupis musí zapsat agent ručně), nemá stav položky po položce v GUI, nevynucuje se, neporovnává texty, drsnosti, razítko. |
| Pravidla poznámek (vlna 23) | `cad/drawing-notes-rules.ts` (`auditDoc`), `drawing-agent.ts` | hotovo kola 1–5 (obcházení ještě ne všechna) | Sem se doplní R8–R11 jako další nálezy auditu. |

---

## 4. Nálezy z reportů (stav: přijato, neopraveno)

Zdroje: **GUI-A** = report „rekonstrukce dvou čelistí ze skenu STL“ (PDF, 5 stran, 28. 11.). **GUI-B** = zip „svařenec z fotografií
starého výkresu“ (report MD/PDF, kontrolní CSV 67 položek, výkres PDF/DXF, 2× `.mncad`, 2× STEP, kusovník CSV, 3 fotografie předlohy).
Oba testy: jen myš a klávesnice v prohlížeči, bez konzole; prostředí bez WebGL (softwarový náhled).
Podklady zákazníků se **nikdy necommitují** (viz kapitola 9).

Priorita: P1 = špatné číslo nebo neplatný výstup, P2 = funkce nejde použít nebo dává špatný výsledek bez varování, P3 = obsluha.

### 4.1 Geometrie, export, výkres – správnost

| ID | P | Nález | Reprodukce | Očekávání a regresní test | Kde hledat |
| --- | --- | --- | --- | --- | --- |
| **A1** | P1 | Automatická celková kóta oblouku je špatně: 41,55 místo 42,000 (druhý díl 46,511 místo 46,957). Rozdíl 0,45 mm. | Díl s velkým rádiusem R250 oříznutým na ±112 mm, pohled shora, chytré nebo celkové kóty. | Celkové kóty z přesné geometrie v soustavě pohledu (extrém křivky), ne z bodů segmentované projekce. Test: oblouk R250 oříznutý na X±112 a X±128 – maximum Y přesně, i když vrchol není mezi vzorky. | `cad/drawing-dims.ts`, `cad/drawing.ts` (obálka pohledu), jádro projekce |
| **A2 + B01** | P1 | STEP po exportu neprojde přesnou kontrolou, ač model v CADu ano. A: 1 z 16 ploch (torus). B: 6 z 87 a 6 z 75 ploch, po přepočtu tolerancí 3. Objem i obálka sedí, rychlá kontrola projde. | Otevřít `.mncad` → Soubor → STEP AP214 → export s automatickým načtením zpět. | Platný model se exportuje tak, aby zpětné načtení bylo přesně platné; jinak ověřená oprava. V protokolu **čísla vadných ploch a hran**. Výstraha musí zůstat, nesmí ji přebít zelená podle objemu. Test: round-trip obou typů (torus z rotace; svařenec se sloučenými tělesy). | `cad/formats/export.ts`, `cad/validity.ts`, `cad/check.ts`, jádro (zápis p-křivek, tolerance) |
| **A3** | P2 | Oblouk R250 je v PDF složený z viditelných úseček, ve středu vodorovný úsek. Přepnutí Zobrazení → Jemná nic nezmění. | Export výkresu PDF dílu s velkým rádiusem. | Analytické oblouky v PDF/DXF/SVG, nebo adaptivní dělení podle měřítka listu (tětivová odchylka ≤ 0,02 mm na papíře). Změna kvality zneplatní mezipaměť projekce. | `cad/drawing.ts`, `cad/drawing-export.ts`, jádro HLR |
| **A4** | P2 | Rotace s úhlem −360 se přijme a tiše změní objem (zmizí část odebrání). | Rotace 2: 360 → −360. | Buď záporný směr se stejným výsledkem, nebo odmítnutí s hláškou. Test na −360, −90, 0, 720. | `components/cad/props.tsx` (rotace), jádro revolve |
| **A5** | P2 | Import STL s 390 tisíci trojúhelníky: po 204 s bez náhledu a bez chyby (zrušeno). 43 tisíc trojúhelníků trvá 35 s. | Soubor → otevřít hustý STL. | Lehký režim „referenční síť“ (jen zobrazení a měření, bez převodu na B-rep), průběh v procentech, průběžný náhled. Cíl: 400 tisíc trojúhelníků do 10 s. | `cad/formats/import-core.ts`, `cad-app.tsx` |
| **B02** | P1 | Závit M60×2 nejde: katalog končí M48, geometrický režim ho odmítne, kosmetický uloží bez geometrie. „Tažení po šroubovici“ s poloměrem 29 neudělá nic, s 30 varuje a doporučí 29. | Díra / Závit → M60×2; Tažení po šroubovici podle reportu. | Vlastní jmenovitý průměr, stoupání, třída, délka v GUI. Stejná validace kosmetického a geometrického režimu. Odstranit rozpor v doporučení. Rozšířit katalog (ISO 261 do M100, jemná stoupání). | `cad/thread-spec.ts`, `components/cad/props.tsx`, `forms/more-forms.tsx`, helix sweep |
| **B03** | P1 | Koutový svar po oblouku (styk patky a válce, hrana kružnice R42,5) odmítnut: „Hrana není vnitřní (konkávní) a nedotýká se jiného dílu“. Rovné svary fungují. | Sloučený díl, Svařence → koutový svar → oblouková hrana. | Svar na kruhovém sedle; hláška ukáže konkrétní hranu, sousední plochy a důvod. Test před sloučením i po něm. | `cad/ext/weld-kernel.ts` |
| **B04** | P2 | Značka svaru je jen v dílu, v sestavě a na výkresu sestavy není. Trojúhelník Unicode v poznámce se v PDF ztratil. | Výkres sestavy → značka svaru. | Značka ISO 2553 na výkresu sestavy (typ, a/z, strana, obvodový a montážní symbol, délka). Symboly spolehlivě v PDF/DXF/DWG; znak mimo písmo = `⚠`, ne tiché vypuštění. | `cad/drawing-welds.ts`, `drawing-export.ts` (písma) |
| **A9 + B07d** | P2 | Rádiusová kóta na krátkém oblouku: šipka míří na neviditelné pokračování kružnice mimo oblouk (R4, R80). | Kóta rádiusu, popisek umístit mimo úhel oblouku. | Konec odkazové čáry jen na viditelném úseku oblouku; mimo něj zalomit. | `cad/drawing-marks.ts`, `drawing-workspace.tsx` |
| **A10** | P3 | Materiál „NEURČEN“ a výkres přesto uvádí hmotnost z výchozí oceli. | Razítko: materiál volným textem. | Bez potvrzené hustoty hmotnost neuvádět (pomlčka) nebo ji označit „orientačně pro 7,85“. | `drawing-title-panel.tsx`, `cad/drawing.ts` |
| **B-hm** | P3 | Hmotnost modelu se liší od předlohy (+2 % a −37 %). Není chyba CADu, ale kontrolní protokol ji musí umět vykázat. | – | Položka „hmotnost“ v protokolu R12 s tolerancí shody. | balík K2 |

### 4.2 Sestava a svařenec

| ID | P | Nález | Očekávání | Kde hledat |
| --- | --- | --- | --- | --- |
| **B05** | P1 | Úprava dílu v kontextu sestavy: po přejmenování dokumentu (a změně materiálu) zmizel modrý pruh a „Zpět do sestavy“, Zpět to neobnovilo. Jednou, nezopakováno. | Kontext úpravy přežije přejmenování i změnu materiálu. Test: e2e s přejmenováním. | `components/cad/cad-app.tsx`, `cad/mate-remap.ts` |
| **B08** | P1 | Kontrola úplnosti kót na listu sestavy jen řekne „kontroluje se na výkresech dílů“. | Viz R8: u svařence na jednom listu kontrola všech dílů s výpisem nekótovaných prvků; u sestavy kontrola, že každý vyráběný díl **má** svůj úplný výkres. | `drawing-agent.ts:556`, `dim-check-panel.tsx` |
| **B09** | P2 | Chybí přímá cesta „sestava → jeden svařený díl“. Obcházelo se kopií a ručním překreslením. | Akce „Svařenec / odvozený díl ze sestavy“ s vazbou na zdroj (změna dílu se promítne). | sestava, více těles |
| **B10a** | P2 | Kusovník při různých názvech instancí převzal „Nový díl“. | Oddělit název dílu, název instance a položku kusovníku; kusovník bere díl. | `cad/reference/bom.ts`, kusovník sestavy |
| **B10b** | P3 | Panel komponenty: rozsáhlá „Pružina mezi komponentami“ odsouvá polohu dílu dolů. | Sbalit, polohu nahoře. | `components/cad/asm-panel.tsx` |
| **B-kol** | P2 | Kolize 2× 953 mm³ po opravě průměrů – správně nalezeno. Sjednocení průnik tiše odečte. | Při slučování těles s průnikem `⚠` s objemem průniku. | sloučení těles |

### 4.3 Obsluha (GUI)

| ID | P | Nález | Očekávání | Kde hledat |
| --- | --- | --- | --- | --- |
| **A6** | P3 | Výběr více hran pro Zaoblení: seznam se zaškrtávátky se po každém výběru zavře a přestaví. | Seznam zůstane otevřený do potvrzení, drží posun a fokus. | `forms/fillet-form.tsx`, `ref-field.tsx` |
| **B07e** | P3 | V seznamu svarových hran je výběr vzdálených řádků nespolehlivý, pomáhá jen filtr. | Stejná oprava jako A6; řádek při najetí zvýrazní hranu v modelu. | `ref-field.tsx` |
| **A7** | P2 | Po dokončení skici se nabídne vysunutí; při přechodu na Rotovat se rozpracované vysunutí samo potvrdí. | Rozpracovaný příkaz se nikdy nepotvrdí sám. Přechod na jiný nástroj ho zahodí (nebo se zeptá). | `cad/settings.ts` (auto vysunutí), `cad-app.tsx` |
| **A8** | P2 | Rychlé psaní do pole při přestavování formuláře ztrácí znaky a mezery. Varování nad formulářem posouvá prvky. | Pole drží fokus a hodnotu při překreslení; varování má vyhrazené místo a nic neposouvá. | formuláře obecně |
| **B06** | P3 | Zrcadlení: pole „Posunutí roviny“ u volby Základní rovina nefunguje; funguje až „Základní rovina + odsazení“, kde se hodnota vynuluje. | Jedno pole, jeden význam, hodnota přežije změnu režimu. | `components/cad/props.tsx` |
| **B07a** | P2 | Kótování: klik na Ø85 bere sousední Ø90. | Předzvýraznění kandidáta s popisem („kružnice Ø85“), cyklování kandidátů klávesou Tab nebo kolečkem, lupa. | `drawing-workspace.tsx` |
| **B07b** | P2 | V detailu místo kružnice vznikla volná délka 61,806; kóta mezi špatně chycenými středy 200,553. | Kóta v detailu je asociativní; uchopení středu má vlastní značku a přednost. | `drawing-workspace.tsx` |
| **B07c** | P2 | Hloubka 10: vybraly se hrany místo vrcholů → nabídl úhel 90°. | Chytrá kóta nabídne varianty (vzdálenost / úhel / hloubka díry) a u díry rovnou „hloubka“. | `agent-drawing.ts`, `drawing-workspace.tsx` |
| **B07f** | P3 | Krátké kóty 2 a 4 se musely ručně odsadit o 18 mm. | Automatické umístění krátkých kót vně s šipkami zvenku. | rozvržení kót |
| **B10c** | P2 | „+ XYZ“ nejdřív přidá bod 0;0;0, zadání chce další klik; původní pole „Bod na povrchu“ přestane platit. | Výchozí je **klik do modelu**. Číselný editor se otevře rovnou a je jasné, které pole řídí geometrii. | `components/cad/ref-field.tsx` |
| **B10d** | P2 | Hlášky v GUI radí textové příkazy. | V GUI hláška nabídne tlačítko nebo cestu v nabídce; textový příkaz jen v konzoli. | hlášky jádra (`tr(...)` s příkazy) |
| **B10e** | P3 | Náhled a objem chvíli ukazují předchozí výpočet. | Viditelný stav „počítám“, staré hodnoty zešednou. | `validity-chip.tsx`, náhled |
| **B10f** | P3 | A3 při 1 : 2 se nevešlo, až A2. | Automatický návrh formátu a měřítka při založení výkresu a varování při přetečení. | založení výkresu |

### 4.4 Průniky mezi reporty

| Téma | Kde se objevilo | Závěr |
| --- | --- | --- |
| STEP není po exportu přesně platný | A2, B01 (dva různé modely, tři soubory) | Systémová chyba zápisu, ne jeden model. Nejvyšší priorita. |
| Rádiusová kóta ukazuje mimo oblouk | A9, B07d | Jedna oprava. |
| Seznam pro výběr hran | A6, B07e | Jedna oprava společné komponenty. |
| Úplnost kót a tolerance | B08, kontrolní CSV (7 položek „kóta chybí“), R8/R9 | Jádro vlny 24. |
| Závity | B02, položky 23–26 a 33–36 CSV, R11 | Katalog + třída + kóta hloubky. |
| Materiál a hmotnost | A10, B10a, položky 63–67 CSV | Hmotnost jen s potvrzenou hustotou; protokol ji porovná. |
| Uživatel neumí vybrat správnou entitu | B07a–c, položky 07, 08, 36, 41, 45, 46 CSV | Kóty chyběly, protože **nešly naklikat**. Výběr entit je předpoklad R8. |

---

## 5. Vlastní pozorování výsledného výkresu (svařenec, A2, 1 : 2) proti předloze

Výkres prošel v aplikaci „0 překryvů, 0 křížení“, a přesto není strojařský. To je mezera kontrol.

| ID | Pozorování | Co má nástroj dělat |
| --- | --- | --- |
| C1 | Detail A (1 : 1) nemá jedinou kótu; koncový zápich, sražení 30°/45°, 2, 5, 39, 44 z předlohy v něm chybí. | Detail bez kóty = `⚠`. Kontrola R12 ho vykáže jako `CHYBÍ`. |
| C2 | Poznámky jsou rozházené po listu (dole vlevo „Technologie…“, uprostřed „Neoznačené svary…“), odkazové čáry jdou přes půl listu a přes izometrii. | Poznámky jen v bloku nad hlavičkou (R4), odkaz nesmí křížit jiný pohled; délka odkazu omezená. |
| C3 | Hlavní pohled je plný skrytých hran; předloha používá částečné řezy. | Nabídnout „částečný řez“ a „polovina pohled / polovina řez“ jedním klikem; skryté hrany výchozí vypnuté u pohledů, kde je řez. |
| C4 | Průměry (Ø85, Ø60,5) kótované odkazem v čelním pohledu na soustředné kružnice. | Průměry rotačních ploch kótovat přednostně v podélném pohledu nebo řezu; na soustředných kružnicích `⚠`. |
| C5 | V hlavičce chybí obecné tolerance, obecná drsnost, hrany. Drsnost Ra 12,5 je volná značka v pohledu. | R9a; obecná drsnost do hlavičky se značkou „(√)“. |
| C6 | Kóty namačkané u pravého konce (5 (2×), 39, 44) a krátké kóty 2, 4. | Automatické řazení kótových řad (nejkratší nejblíž), krátké kóty se šipkami zvenku. |
| C7 | Izometrie zabírá čtvrtinu listu, kótované pohledy jsou stísněné. | Rozvržení: izometrie menším měřítkem, prostor přednostně kótovaným pohledům. |
| C8 | Tolerance (H8, ±0,1, ±0,2) byly psané jako přípona textu. | Tolerance vybírat z nabídky u kóty (uložení / úchylky / ±), strukturovaně (R13). |
| C9 | Kontrolní tabulka 67 položek vznikla **mimo CAD**, ručně. | To je přesně R12 – musí to být funkce CADu (balík K2). |
| C10 | 7 položek „parametr sedí, kóta chybí“ (200, 200, 2, 82, 65, 65, hloubka 10), 4 položky nemodelované (drážka 12 P9, koncové profily), 1 nevyřešená (46). | Protokol je má vykázat sám; nedokótovaný výkres není hotový. |
| C11 | Řez A–A: šrafy v pořádku, ale značka drsnosti Ra 0,4 leží uvnitř díry. | Značka drsnosti se přichytává na obrys nebo na odkaz, ne do volné plochy. |

---

## 6. Zásady ovládání (UX) – podle nich se projde celá aplikace

Majitel: „Uživatel nebude vypisovat souřadnice. Chce kliknout, zanést, označit, vybrat.“

| # | Zásada | Jak se ověří |
| --- | --- | --- |
| U1 | **Poloha se zadává kliknutím** na geometrii (bod, hrana, střed, osa, plocha). Číslo se píše jen pro vzdálenost, úhel a rozměr. XYZ je až poslední možnost, schovaná pod „Přesně…“. | Každý formulář s polem souřadnic má i výběr klikem a ten je výchozí. |
| U2 | **Výběr je jistý**: předzvýraznění s popisem entity, cyklování překrývajících se kandidátů (Tab / kolečko), filtr druhu entity, lupa v hustých místech. | e2e se skutečnými kliky v hustém pohledu. |
| U3 | **Seznamy pro více položek zůstávají otevřené** do potvrzení, drží posun a fokus; najetí na řádek zvýrazní entitu. | e2e: vybrat 5 hran bez znovuotevření. |
| U4 | **Formulář se nehýbe**: varování mají vyhrazené místo, pole drží fokus a hodnotu při překreslení, žádná ztráta znaků při rychlém psaní. | e2e: psaní 30 znaků při přepočtu. |
| U5 | **Nic se nepotvrdí samo.** Rozpracovaný příkaz se při přechodu jinam zahodí nebo se zeptá. | e2e: skica → nabídka vysunutí → Rotovat. |
| U6 | **Jedno pole, jeden význam.** Neúčinná pole se skryjí; hodnota přežije změnu režimu. | Průchod všech formulářů s přepínačem režimu. |
| U7 | **Hlášky mluví jazykem GUI.** Žádné textové příkazy v hláškách pro člověka; místo nich tlačítko „Opravit“ nebo cesta v nabídce. | Průchod všech hlášek jádra. |
| U8 | **Stav výpočtu je vidět.** „Počítám“, staré hodnoty šedé, průběh u dlouhých operací, zrušení funguje. | – |
| U9 | **Chytrá kóta**: jeden nástroj, podle kliknutého pozná průměr / rádius / vzdálenost / úhel / hloubku a nabídne varianty; tolerance a uložení z nabídky. | e2e kótování dílu jen myší. |
| U10 | **Výkres se zakládá sám správně**: návrh formátu a měřítka, pohledy, hlavička s obecnými tolerancemi z nastavení, tlačítko „Dokótovat“ a panel „Co chybí“ s klikem na prvek. | – |
| U11 | **Výchozí hodnoty z kontextu**: materiál z dílu, norma tolerance z nastavení firmy, třída závitu 6H/6g, uložení H7. | – |
| U12 | **Každá akce má cestu myší.** Co jde textem, jde i klikem (svařenec ze sestavy, značka svaru v sestavě, vlastní závit). | Porovnání seznamu textových příkazů s nabídkami. |

Postup auditu (balík K11): 1) mapa všech nástrojů pásu karet a formulářů; 2) každý projít podle U1–U12 skutečnou myší a klávesnicí
(e2e, ne volání API); 3) nálezy do tabulky; 4) opravy po skupinách; 5) nezávislý oponent zopakuje průchod.

---

## 7. Balíky práce

Každý balík: nejdřív reprodukce na aktuálním `main`, pak oprava u příčiny, regresní test, e2e myší a klávesnicí, oponent, zápis.
Pravidla práce platí stejná jako dosud: žádné falešné zelené, podklady zákazníků se necommitují, neutrální názvy.

### K1 – Pravidla R8–R11 v nástroji (jádro vlny)
1. `dim-check.ts`: párování kót **podle entity** (asociace kóty na hranu, plochu, prvek), ne podle čísla v textu. `expectedDims` doplnit o sražení, zaoblení, zápichy, drážky, polohy děr k základnám, hloubky.
2. Nový audit „úplnost a tolerance“ vedle `auditDoc` (`drawing-notes-rules.ts`): kódy `drawing.dims-incomplete` (agent: `✗`), `drawing.title-tolerances-missing` (`✗`), `drawing.dim-untoleranced-functional` (`⚠`/`✗` podle prvku), `drawing.fit-nonstandard` (`⚠`), `drawing.thread-class-missing` (`✗`), `drawing.detail-without-dims` (`⚠`).
3. Hlavička: povinná pole obecných tolerancí (délky a úhly, geometrie), obecná drsnost, hrany; výchozí z Nastavení firmy. Agent bez nich neexportuje.
4. Tolerance jako strukturovaný údaj kóty (uložení / úchylky / ± / mezní rozměry); přípona textem se u agenta nepočítá.
5. Přednostní uložení: tabulka ISO 286 přednostních uložení a nápověda nejbližšího.
6. Příkazy pro agenta: `výkres dokótovat` (doplní chybějící), `výkres kontrola úplnosti`, `výkres tolerance <kóta> H7`, vše i v GUI (panel „Co chybí“).
7. Sestavový list a svařenec (B08).
8. Návod pro AI, tahák, nápověda CLI, `schema-pro-ai.md`, překlady.
Akceptace: korpus 10 dílů – agent bez dokótování nedostane export; po `výkres dokótovat` je n/n a oponent nenajde nekótovaný prvek; přepsaný text kóty neprojde.

### K2 – Kontrolní výkres a protokol 1 : 1 (R12, R13)
1. Datový model „soupis předlohy“: položky `kóta | tolerance | drsnost | text | odkaz | úprava | razítko | kusovník | hmotnost`, každá s ID, hodnotou, pohledem, čitelností (`jisté / pravděpodobné / nečitelné`).
2. Zdroje soupisu: a) automaticky z DWG/DXF/vektorového PDF (`reference/extract.ts` už umí kóty; doplnit texty, drsnosti, razítko); b) ručně u fotografie – agent příkazem `předloha položka …`, člověk klikáním do obrázku předlohy vedle výkresu.
3. Kontrolní výkres: list, na který se podle soupisu vloží stejné kóty na stejné entity (hodnota z geometrie).
4. Porovnání položku po položce, stavy `SHODA / NESHODA / CHYBÍ / NEČITELNÉ`, u kót tolerance shody; kusovník řádek po řádku; hmotnost.
5. GUI panel „Kontrola podle předlohy“: tabulka, klik na řádek zvýrazní kótu na výkresu i místo v předloze, filtr na neshody.
6. Výstup: protokol CSV a PDF (stejný tvar jako ruční tabulka 67 položek z testu GUI-B), vodoznak „pracovní – neověřeno“, dokud nejsou všechny položky `SHODA` nebo `NEČITELNÉ`.
7. Vynucení u agenta: dokument s předlohou (příkaz `předloha …`, podklad ve skice, import cizího výkresu) bez protokolu neexportuje jako hotový.
Akceptace: na svařenci z testu GUI-B dá nástroj sám tutéž tabulku (67 položek, stejné stavy) jako ruční CSV.

### K3 – Kóty: správná čísla a umístění (A1, A9, B07, C4, C6, C11)
Přesné extrémy křivek; rádiusová kóta na viditelném úseku; výběr entit (U2); chytrá kóta (U9); řazení kótových řad; krátké kóty; přichycení značek drsnosti.

### K4 – STEP přesně platný po exportu (A2, B01)
Reprodukce na torusu z rotace a na sloučeném svařenci; hledat ve způsobu zápisu (p-křivky, tolerance, `SameParameter`), ne obcházet; protokol s čísly ploch a hran; round-trip test v korpusu.

### K5 – Oblouky ve výkresu (A3)
Analytické oblouky nebo adaptivní dělení; zneplatnění mezipaměti při změně kvality; kontrola v PDF, DXF, SVG.

### K6 – Závity (B02, R11)
Vlastní průměr a stoupání, katalog do M100, třída povinná, shodná validace režimů, oprava „Tažení po šroubovici“ (poloměr 29 bez účinku, rozpor doporučení), kóta hloubky závitu jedním klikem.

### K7 – Svary (B03, B04)
Koutový svar po oblouku a na sedle; hláška s důvodem; značka ISO 2553 na výkresu sestavy; symboly v PDF.

### K8 – Sestava a svařenec (B05, B09, B10a, B10b, kolize při slučování)
Kontext úpravy; odvozený díl ze sestavy; názvy v kusovníku; panel komponenty; `⚠` při slučování s průnikem.

### K9 – Formuláře (A4, A6, A7, A8, A10, B06, B10c–f)
Podle zásad U3–U8. Společné komponenty opravit jednou (`ref-field.tsx`, formulářový rám).

### K10 – Import husté sítě (A5)
Referenční síť bez převodu na B-rep, průběh, cíl 400 tisíc trojúhelníků do 10 s.

### K11 – Audit ovládání celé aplikace (U1–U12)
Viz kapitola 6. Výstup: tabulka nálezů a opravy.

### K12 – Výkres jako strojařský (C1–C3, C5, C7)
Částečný řez jedním klikem, skryté hrany, rozvržení s předností kótovaných pohledů, poznámky jen nad hlavičkou i u člověka jako výchozí umístění.

---

## 8. Pořadí

| Krok | Co | Proč teď |
| --- | --- | --- |
| 0 | Dokončit rozdělané: vlna 22 kolo 7b (stopy g, v, d), 3 selhání e2e (`cad-w22-d` 2×, `cad-w22-v` 1×), vlna 23 kolo 5 (obcházení), celá zkouška, `CAD-M1-OPRAVY.md`. | Jinak se nové změny míchají s nedokončenými. Viz `PREDANI-CAD.md`. |
| 1 | K4 (STEP) a K3/A1 (špatná čísla kót). | P1: neplatný výstup a špatné číslo na výkresu. |
| 2 | K1 (R8–R11). | Hlavní požadavek majitele. Potřebuje K3 (výběr entit, asociace). |
| 3 | K2 (protokol 1 : 1). | Staví na K1 a na `reference/*`. |
| 4 | K6, K7, K8. | Bez nich nejde svařenec z testu dokončit. |
| 5 | K9, K5, K10, K12. | Obsluha a vzhled. |
| 6 | K11 audit ovládání + zapracování dalších reportů. | Průběžně doplňovat. |
| 7 | Závěrečná zkouška: oba testy GUI-A a GUI-B zopakovat od nuly myší a klávesnicí a porovnat s reporty. | Jediný důkaz, že nálezy zmizely. |

Rozsah: 12 balíků, z toho K1 a K2 velké (každý několik kol oprav a oponentur), ostatní střední až malé.

---

## 9. Co je potřeba od majitele

- **Reprodukční soubory nahrát znovu** na začátku dalšího kola (kontejner se mezitím smaže): zip testu svařence (`.mncad` sestavy a sloučeného dílu, STEP, výkres, kontrolní CSV, fotografie) a `.mncad` obou čelistí (v prvním reportu byly jen odkazy; soubor s neplatným STEP je potřeba pro K4).
- Podklady zákazníků (fotografie předlohy, modely) zůstanou jen v `website/.local/` a ve scratchpadu. Do repozitáře, testů ani commitů nepůjdou; testy si vytvoří náhradní neutrální geometrii se stejnou vlastností (torus z rotace, oblouk R250 oříznutý, sedlo na válci).
- Rozhodnutí, která mají výchozí hodnotu v kapitole 2 (lze změnit jednou větou): norma obecných tolerancí v hlavičce; zda má být nestandardní tolerance na lícovaném průměru chyba, nebo jen upozornění; jak přísně u poloh děr.

---

## 10. Příjem dalších reportů

Každý nový report se zapíše sem a jeho nálezy se zařadí do kapitoly 4 (nové ID), do průniků 4.4 a do balíku v kapitole 7.

| Datum | Podklad | Stav |
| --- | --- | --- |
| 28. 11. | GUI-A: report „rekonstrukce čelistí ze skenu“ (PDF, 5 stran) | zapracováno: A1–A10 |
| 28. 11. | GUI-B: zip „svařenec z fotografií“ (report, CSV 67 položek, výkres, modely) | zapracováno: B01–B10, C1–C11 |
| 28. 11. | Zadání majitele: úplné kótování, tolerance, uložení, závity, kontrolní výkres | zapracováno: R8–R14, K1, K2 |
| – | Hlavní report (majitel ohlásil) | čeká se |
