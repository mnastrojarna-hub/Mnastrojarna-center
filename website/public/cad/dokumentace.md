# Mnástrojárna CAD – kompletní dokumentace a návod k obsluze

> Kompletní návod k online 3D/2D CADu Mnástrojárna CAD: ovládání, skicování s vazbami, tvorba dílů (vysunutí, rotace, díry, zaoblení, pole), plochy, plech, svařence, sestavy a vazby, výkresy do PDF/DXF/DWG, knihovna 103 rodin normálií, import a export STEP, IGES, STL, 3MF, DXF. Zdarma v prohlížeči, bez instalace, česky.

- Aplikace: https://www.mnastrojarna.cz/cad
- Webová dokumentace: https://www.mnastrojarna.cz/cad/dokumentace
- Příručka PDF: https://www.mnastrojarna.cz/cad/mnastrojarna-cad-prirucka.pdf
- Verze: 5. vlna (listopad 2026), aktualizováno 2026-11-03
- Jazyk: čeština · Licence: zdarma, bez registrace · Vydavatel: Mnástrojárna s.r.o., https://www.mnastrojarna.cz

## Hlavní funkce

- Parametrické 3D modelování s historií prvků (vysunutí 8 ukončení, rotace, tažení, šablonování, díry podle ISO 273, závity, zaoblení 6 variant, sražení 5 variant, úkos, skořepina, žebro, pružina, text, pole 5 druhů, zrcadlení, přímé úpravy)
- Skica s řešičem vazeb: 13 vazeb, 8 kót, automatické vazby, číselné zadání u kurzoru, stav určenosti, ořez, odsazení, projekce hran
- Referenční systém zadání: 14 voleb bodu, 8 směrů, 12 definic rovin, 10 os, pomocná rovina / osa / bod / souřadný systém
- Plochy (19 příkazů), plech s rozvinem DXF (12), svařence a rámy z profilů (10)
- Sestavy: komponenty, podsestavy, vazby, kolize, kusovník, rozložený pohled, průvodce rámem vstřikovací formy
- Výkresy: pohledy, řez, detail, kóty, drsnosti, geometrické tolerance, tabulka děr, kusovník; export PDF, DXF, DWG R2000–R2018, SVG
- Knihovna 103 rodin normálií ve 13 skupinách zadávaných textem
- Import STEP, IGES, BREP, STL, OBJ, 3MF, glTF, PLY, OFF, DXF; export STEP, BREP, STL, 3MF, OBJ, GLB, VRML
- Formařské nástroje: analýza úkosů, zebra, křivost, tloušťka stěn, smrštění, vyhazovače, chlazení
- Proměnné, rovnice a stavy (konfigurace), paleta příkazů, nastavitelné klávesové zkratky, dotykové ovládání
- Sdílení odkazem: díl, sestava i výkres jedním tlačítkem (WhatsApp, e-mail, Teams), platnost 1–90 dní, volitelné heslo; dokument je jen v odkazu, na serveru nic
- Rozhraní pro AI agenty a automatizaci: konzole Textové příkazy (česky/anglicky/německy), JSON formát dokumentu se schématem, JavaScript API window.mncad, výběr hran a ploch pravidlem, textová zpětná vazba

## Obsah

- 1. Co je Mnástrojárna CAD
- 2. Rychlý start – první díl za pět minut
- 3. Obrazovka a ovládání
- 4. Zadávání hodnot a odkazů na geometrii
- 5. Skica
- 6. Tvorba těles – prvky a jejich možnosti
- 7. Plochy (plošné modelování)
- 8. Plech
- 9. Svařence a ocelové konstrukce
- 10. Knihovna normálií
- 11. Sestavy
- 12. Formařské nástroje
- 13. Výkresy
- 14. Analýza a měření
- 15. Proměnné, rovnice a stavy dílu
- 16. Soubory, import a export
- 17. Sdílení odkazem
- 18. Nastavení
- 19. Klávesové zkratky
- 20. Mobil a dotykové ovládání
- 21. Pro AI agenty a automatizaci
- 22. Omezení a poctivé srovnání s desktopovými CADy
- 23. Vaše data a soukromí
- 24. Slovníček pojmů
- 25. Historie verzí
- Časté otázky

## 1. Co je Mnástrojárna CAD

Profesionální parametrický 3D a 2D CAD, který běží přímo ve webovém prohlížeči – bez instalace, bez registrace a zdarma. Vytvořila ho nástrojárna Mnástrojárna s.r.o. pro konstruktéry, údržbu, vývojáře a studenty, kteří potřebují rychle vymodelovat díl, sestavu nebo výkres a případně rovnou poptat výrobu.

![Úvodní obrazovka Mnástrojárna CAD s nedávnými soubory a rychlými akcemi](https://www.mnastrojarna.cz/cad/docs/start.webp)

*Úvodní obrazovka: Nový díl, Nová sestava, Nový výkres, nedávné soubory s náhledy, otevřít / importovat, knihovna normálií.*

Jádrem je geometrický modelář OpenCascade (OCCT) přeložený do WebAssembly – stejná třída jádra jako u desktopových CADů. Počítá ve vašem prohlížeči (ve webovém workeru, aby uživatelské rozhraní zůstalo plynulé). Modely se neodesílají na server a ve výchozím nastavení se neukládají ani do prohlížeče – rozpracovaná práce žije jen v otevřené kartě a v souborech, které si uložíte do svého počítače (.mncad, STEP). To je důležité pro dokumentaci pod NDA.

### Co umí

- Díly: skica s vazbami a kótami → vysunutí, rotace, tažení, šablonování, díry (průvodce), závity, zaoblení, sražení, úkosy, skořepina, žebra, pružiny, text, přímé úpravy ploch, pole 5 druhů, zrcadlení, proměnné a stavy (konfigurace).
- Plochy: plošné vysunutí a rotace, tažení a šablonování ploch, odsazení, prodloužení, ořez, sešití, uzavření do tělesa, záplaty, křivky průniku, šroubovice.
- Plech: základní plech, ohyby z hrany, lemy, ohyb podle čáry, výřezy, rohové úlevy, prolisy, rozvin do DXF/SVG, tabulka ohybů.
- Svařence: konstrukční profily (IPE, HEB, UPN, L, jäkl, trubky), rámy z profilů, desky, ořezy, víčka, styčníky, svarové housenky a značky, kusovník řezů.
- Sestavy: komponenty, podsestavy, vazby, kontrola kolizí, kusovník, rozložený pohled, průvodce rámem vstřikovací formy.
- Výkresy: pohledy, řezy, detaily, kóty, drsnosti, geometrické tolerance, tabulky děr, kusovník s pozicemi, razítko; export PDF, DXF, DWG (R2000–R2018) a SVG.
- Knihovna normálií: 103 rodin ve 13 skupinách (šrouby, matice, podložky, kolíky, pera, ložiska, ozubená a řetězová kola, řemenice, ocelové a hliníkové profily, pružiny, O-kroužky, normálie forem, lineární technika, pneumatika, potrubí) – stačí napsat „ISO 4762 M8x30“ nebo „IPE 200 1500“.
- Import a export: STEP, IGES, BREP (přesná geometrie), STL, OBJ, 3MF, glTF/GLB, PLY, OFF (sítě), DXF (skici a výkresy), DWG (výkresy); u nativních formátů (SolidWorks, Inventor, ZW3D, CATIA, Creo, Fusion…) poradí, jak je převést.
- Formařské nástroje: analýza úkosů, zebra pruhy, mapa křivosti, tloušťka stěn, smrštění podle materiálu, návrh vyhazovačů a chladicích kanálů, dělicí rovina, rám formy s normáliemi.

### Požadavky

- Moderní prohlížeč s WebGL 2 a WebAssembly: Chrome, Edge, Firefox, Safari (desktop i mobil). Doporučeno 8 GB RAM pro větší sestavy.
- Myš s kolečkem pro pohodlné otáčení; na dotykovém zařízení funguje jeden prst = otáčení, dva prsty = posun a přiblížení, dlouhý stisk = kontextová nabídka.
- Spuštění: otevřete adresu mnastrojarna.cz/cad. Jádro (asi 10 MB) se stáhne jen poprvé, pak se načítá z mezipaměti.

> Tip: Celý program je česky, včetně chybových hlášek, které vždy říkají, co udělat jinak („Vyberte rovinnou plochu…“, „Vzdálenost musí být kladná…“).

## 2. Rychlý start – první díl za pět minut

Postup, který vás provede od prázdného dílu k výkresu v PDF a souboru STEP.

1. Nový díl: program se otevře s prázdným dílem (tři základní roviny XY, XZ, YZ, mřížka vypnutá); na úvodní obrazovce jsou tři šablony – Nový díl, Nová sestava, Nový výkres (otevře díl ze souboru a rovnou založí výkres).
2. Skica: v pásu Tvorba → Skica vyberte rovinu (XY = půdorys). Klávesou r nakreslete obdélník dvěma kliky, nebo začněte psát čísla: 60 Tab 40 Enter vytvoří obdélník 60 × 40 mm i s kótami.
3. Dokončit skicu (tlačítko vpravo nahoře nebo Enter). Program rovnou nabídne Vysunutí – zadejte výšku (např. 20) a potvrďte Enter.
4. Díra: h nebo Tvorba → Díra; klikněte na horní plochu – bod a osa se doplní samy. Zvolte typ (vrtaná, válcové / kuželové zahloubení, závit), např. „Pro šroub M8“, ukončení „Skrz vše“, Enter.
5. Zaoblení: b, klikněte na hrany, zadejte poloměr, Enter. Hrany lze vybírat i přes filtr výběru „Hrana“ ve stavovém řádku.
6. Výkres: pás Výkres → Nový výkres. Vznikne list s pohledy a izometrií; doplňte kóty a drsnosti, pak PDF (nebo DXF/DWG).
7. Export: Soubor → Export 3D → STEP pro jiný CAD nebo CAM; Uložit projekt (.mncad) uchová celou historii prvků. Při každém uložení a exportu se program zeptá, kam a pod jakým názvem soubor uložit (v Chrome a Edge systémovým dialogem; další Ctrl+S ukládá do téhož souboru, Uložit jako… se zeptá znovu). Tlačítko Poptat výrobu připraví STEP a e-mail naší nástrojárně.

![Formulář vysunutí s ukončením K ploše a rozbalenou sekcí Začátek, směr, tenká stěna](https://www.mnastrojarna.cz/cad/docs/vysunuti.webp)

*Formulář prvku: hodnoty lze psát, vybírat klikem v modelu nebo zvolit pravým tlačítkem z nabídky způsobů zadání.*

## 3. Obrazovka a ovládání

Rozložení vychází ze ZW3D a SolidWorks: pás karet nahoře, správce historie vlevo, 3D okno uprostřed, formulář prvku vpravo a řádek výzev dole.

![Pás karet Tvorba: Skica, Tvar, Primitiva, Konstrukční prvky, Úpravy, Přímé úpravy, Základní editace, Reference, Knihovna](https://www.mnastrojarna.cz/cad/docs/ribbon-tvorba.webp)

### Titulní lišta

Logo (zpět na web), rychlé akce Nový díl / Otevřít / Uložit, Zpět / Znovu (Ctrl+Z, Ctrl+Y), záložky otevřených dokumentů, stav jádra (OCCT · doba poslední stavby v ms), přepínač světlého/tmavého vzhledu a tlačítko Poptat výrobu.

### Záložky dokumentů

V jednom okně může být otevřeno více dílů, sestav a výkresů najednou – každý ve vlastní záložce (ikona krychle = díl, vrstvy = sestava, list = výkres). Název aktivní záložky lze přepsat přímo v ní. + otevře nový díl, × (nebo prostřední tlačítko myši) záložku zavře, Nový výkres otevře výkres jako další záložku vedle svého dílu. Záložky se pamatují i po obnovení stránky; dokumenty jsou uložené v nedávných souborech.

### Pás karet (ribbon)

Tlačítka jsou seskupená a každá skupina má pod sebou název (Skica, Tvar, Primitiva, Konstrukční prvky, Úpravy…; ve skice Uchopení, Kreslení, Úpravy, Vazby, Kóty, Nástroje). Popisek tlačítka i název skupiny jsou psané čitelným písmem; po najetí myší se zobrazí nápověda s klávesovou zkratkou.

| Záložka | Obsah |
| --- | --- |
| Soubor | Nový díl / sestava, otevřít a importovat, uložit projekt, export 3D, výkres, rám vstřikovací formy, ukázkové díly, knihovna normálií, nastavení, klávesové zkratky, poptávka výroby. |
| Tvorba | Skica (11 způsobů volby roviny), Vysunout, Rotovat, Tažení, Šablonovat, Text; Kvádr, Válec, Trubka, Kužel, Koule; Díra, Závit, Rozříznout, Žebro, Pružina; Zaoblit, Srazit, Úkos, Skořepina; Vytáhnout / Zatlačit, Odsadit, Odstranit plochu, Zesílit, Barva plochy; Pole, Zrcadlit, Přesunout / otočit; Rovina, Osa, Bod, Souřadný systém; Normálie; pokročilé úpravy (proměnné a plné zaoblení, zaoblení řetězce, sražení D1×D2 / D×úhel, zrcadlení prvků, pole podél křivky, výplňové pole, zkrut, kopule, text na válci, úkos od dělicí roviny, lem / drážka, měřítko v bodě, díry v bodech, znovu použít nástroj). |
| Plochy | 19 příkazů plošného modelování (viz kapitola 7). |
| Plech | 12 příkazů plechových dílů včetně rozvinu (kapitola 8). |
| Svařence | 10 příkazů pro rámy z profilů, svary a kusovník řezů (kapitola 9). |
| Nástroje | Měřit, Vlastnosti, Hmotnost, Řez, Proměnné, Stavy dílu, Formařské nástroje, Kontrola geometrie, Sjednotit plochy, Tloušťka stěn. |
| Zobrazení | Pohledy (izometrie, přední, horní, pravý, zadní, spodní, levý), styl zobrazení, kamera (přizpůsobit, perspektiva / pravoúhlá), mřížka a osy, barva tělesa, pozadí, schéma myši (ZW3D / SolidWorks / touchpad). |
| Výkres | Nový výkres a výkresová dokumentace (kapitola 13). |
| Data | Nastavení, paleta příkazů, úvodní obrazovka, otevřít / import, uložit, export, sestavy, ukázky. |
| Skica | Zobrazí se při otevřené skice: uchopení, kreslení, vazby, kóty, úpravy, DXF (kapitola 5). |

### Správce historie (vlevo)

Záložka Historie ukazuje strom prvků v pořadí stavby: kliknutím prvek vyberete, dvojklikem nebo ikonou tužky upravíte, pravým tlačítkem otevřete nabídku (přejmenovat, potlačit, smazat, přesunout, vrátit se před prvek). Prvek s chybou má červený vykřičník a pod ním srozumitelnou hlášku. Záložka Proměnné spravuje parametry a rovnice, záložka Stavy konfigurace dílu. U sestavy je zde strom komponent a podsestav.

### 3D okno

- Navigační krychle (ViewCube) vpravo nahoře: klik na stěnu / hranu / roh = pohled, ikona domečku = izometrie.
- Osový kříž vlevo dole, mřížka v základní rovině, informační štítky dole (rozměry obalového kvádru, objem, hmotnost podle materiálu).
- Výběr: klik vybere entitu podle filtru (Vše / Prvek / Plocha / Hrana / Bod / Těleso; v sestavě Komponenta / Podsestava). Ctrl+klik přidává do výběru, Esc ruší.
- Mini lišta: po výběru plochy, hrany, bodu nebo tělesa se u kurzoru objeví 3–4 nejčastější příkazy (např. plocha → Nová skica na ploše, Vytáhnout / Zatlačit, Odsadit plochu, Odstranit plochu); „⋯“ otevře úplnou kontextovou nabídku.
- Pravé tlačítko: kontextová nabídka podle entity (zaoblit hranu, skica na ploše, měřit odsud, barva plochy, vlastnosti…) plus pohledy, styl a filtr výběru.
- Inspektor: po výběru jedné entity se vpravo dole ukáže panel s údaji (typ plochy, obsah, střed, normála, poloměr, osa; u hrany délka, typ křivky; u tělesa objem, povrch, hmotnost, těžiště).

![Mini lišta u kurzoru po kliknutí na válcovou plochu a inspektor s údaji o ploše](https://www.mnastrojarna.cz/cad/docs/mini-lista.webp)

*Mini lišta a inspektor plochy – nejčastější příkazy na jeden klik, údaje bez hledání v nabídkách.*

### Formulář prvku (vpravo)

Každý prvek má formulář s názvem, parametry a tlačítky OK (Enter) a Storno (Esc). Během úprav se model živě přepočítává; u prvků pracujících s plochami nebo hranami se zobrazuje stav před prvkem, aby šlo pohodlně vybírat. Číselná pole přijímají výrazy (25/2, 10+5*2) i proměnné (=d*3, viz kapitola 15). Pokročilé volby jsou sbalené v sekci „Začátek, směr, tenká stěna…“.

### Řádek výzev a stavový řádek (dole)

Vlevo program říká, co očekává („Zaoblení: klikáním vyberte hrany v modelu (vybráno 3) · nebo „Ze seznamu / pravidlem…“ ve formuláři · Enter = OK“), vpravo je filtr výběru, počet vybraných entit, souřadnice kurzoru, jednotky a schéma myši.

### Průběh a zrušení výpočtu

Trvá-li výpočet déle než vteřinu, objeví se u spodního okraje ukazatel „Počítám prvek 5/11: Pole 1“ s časem tohoto kroku a celkovým časem. Tlačítko Zrušit výpočet okamžitě ukončí: čekala-li na výpočet jen poslední úprava, vrátí se zpět (Ctrl+Y ji obnoví); u právě otevřeného souboru zůstane dokument beze změny a stav jádra v horní liště nabídne „Výpočet zrušen · přepočítat“. Jádro si pamatuje stav po jednotlivých prvcích, takže přidaný prvek nebo úprava posledního prvku nepřepočítává celou historii.

### Paleta příkazů

![Paleta příkazů Ctrl+K s fulltextovým hledáním příkazů](https://www.mnastrojarna.cz/cad/docs/paleta.webp)

*Paleta příkazů (Ctrl+K): napište část názvu – „dír“, „zaobl“, „rozvin“ – a potvrďte Enter.*

Ctrl+K otevře vyhledávání přes všechny příkazy, ukázky, nastavení i knihovnu. Funguje bez diakritiky a toleruje překlepy.

### Ovládání myší

| Schéma | Otáčení | Posun | Přiblížení |
| --- | --- | --- | --- |
| ZW3D (výchozí) | pravé tlačítko | prostřední tlačítko | kolečko (k místu pod kurzorem) |
| SolidWorks | prostřední tlačítko | Ctrl + prostřední | kolečko |
| Touchpad | levé tlačítko (tažení) | pravé tlačítko | kolečko / gesto |

Schéma se přepíná v Zobrazení → Ovládání myši nebo v Nastavení → Myš a ovládání. Tam je i obrácení kolečka a přiblížení ke kurzoru.

### Když se 3D okno nespustí (WebGL)

3D zobrazení potřebuje WebGL – hardwarově akcelerovanou grafiku prohlížeče. Když ji prohlížeč neposkytne (vypnutá grafická akcelerace, vzdálená plocha nebo virtuální stroj bez grafické karty, zastaralý ovladač, firemní zásady), program nespadne: místo modelu zobrazí česky příčinu a postup a ostatní části – nabídky, nápověda, soubory, 2D skica, výkresy – fungují dál. Jádro OCCT model počítá i bez 3D okna.

- Chrome / Edge: Nastavení → Systém → „Použít grafickou akceleraci, je-li k dispozici“, restart prohlížeče; stav ukáže chrome://gpu nebo edge://gpu.
- Firefox: Nastavení → Obecné → Výkon → doporučená nastavení výkonu; about:config → webgl.disabled = false.
- Vzdálená plocha (RDP), Citrix nebo virtuální stroj: otevřete CAD přímo na počítači s grafickou kartou.
- Aktualizujte ovladač grafické karty, zkuste jiný prohlížeč v aktuální verzi nebo jiné zařízení.
- Zkopírovat diagnostiku (na chybové obrazovce i v Nápovědě) zkopíruje verzi programu, prohlížeč, stav WebGL, stav jádra a chybové hlášení – bez jakýchkoli dat dokumentu – k poslání podpoře.

## 4. Zadávání hodnot a odkazů na geometrii

To, co odlišuje profesionální CAD od jednoduchých modelářů, je počet způsobů, jak každý příkaz „nakrmit“. V Mnástrojárna CAD má každé pole bodu, směru, roviny nebo osy stejné možnosti jako v ZW3D nebo SolidWorks.

![Nabídka pravého tlačítka v poli bodu se čtrnácti způsoby zadání](https://www.mnastrojarna.cz/cad/docs/volby-bodu.webp)

*Pole odkazu: pravé tlačítko (nebo „⋯“) nabídne všechny způsoby zadání bodu.*

### Pole odkazu

- Klik v modelu: klikněte do pole (zvýrazní se a ve stavovém řádku je výzva) a pak na vrchol, hranu nebo plochu v 3D okně. Filtr výběru se přepne sám podle toho, co pole očekává. U polí bodu se při najetí na hranu nabídnou uchopovací body (koncové, střed, střed kružnice) – stačí kliknout na značku.
- Psaní: tlačítko xyz přijme souřadnice 10; 20; 0 (oddělovač středník, čárka nebo mezera) nebo relativně @5; 0; 0 od posledního zadaného bodu.
- Nabídka „⋯“ / pravé tlačítko: další způsoby zadání (níže), „Použít aktuální výběr“, „Vybrat ze seznamu…“ a „Vymazat“. Na dotykovém zařízení nabídku otevře dlouhý stisk.
- Otisk entity: odkaz si pamatuje typ, střed a velikost vybrané plochy či hrany. Když později změníte dřívější prvek a indexy se přečíslují, odkaz se znovu najde podle otisku – prvky se nerozbíjejí.

### Způsoby zadání bodu (14 + 3)

| Volba | Co se vybírá | Výsledek |
| --- | --- | --- |
| Vrchol / koncový bod | vrchol tělesa | bod ve vrcholu |
| Střed hrany · Začátek hrany · Konec hrany | hrana | bod v polovině délky / na začátku / na konci |
| Střed kružnice / oblouku | kruhová hrana | střed kružnice |
| Střed plochy | plocha | těžiště plochy (u válce bod na ose) |
| Bod na hraně v % délky | hrana + procento | bod v zadané části délky |
| Střed mezi dvěma body | 2 body | aritmetický střed |
| Mezi dvěma body (poměr) | 2 body + poměr 0–1 | bod na spojnici |
| Odsazený bod podél hrany | bod + hrana + vzdálenost | bod posunutý ve směru hrany |
| Průmět bodu na plochu | bod + plocha | kolmý průmět (u válce na osu) |
| Průsečík hrany s plochou | přímá hrana + plocha | průsečík přímky s rovinou |
| Počátek souřadnic | — | 0; 0; 0 |
| Zadat souřadnice… | čísla | X; Y; Z nebo @dx; dy; dz |
| Bod skici · Pomocný bod · Ze seznamu | entita skici / prvek Bod / seznam entit | asociativní odkaz |

### Způsoby zadání směru (8)

Kolmo na rovinu (normála), osa X / Y / Z, podél hrany nebo osy válcové plochy, dvěma body, normála plochy, vektor čísly, pod úhlem od normály (kolem osy Y skici), tečna křivky.

### Definice roviny (12) – pro skicu, pomocnou rovinu, zrcadlení, řez i úkos

Základní rovina + odsazení · rovnoběžně s plochou (+ odsazení, obráceně) · třemi body · bodem a přímkou · bodem a normálou · pod úhlem k ploše kolem hrany · střední mezi dvěma plochami (u různoběžných půlicí) · tečně k válci · kolmo na křivku v bodě · dvěma hranami · pomocná rovina (+ odsazení) · vlastní (počátek, normála, osa X). Rovina je asociativní – posune-li se plocha, na které skica leží, přepočítá se i skica a vše, co na ní stojí.

![Formulář pomocné roviny s definicí Pod úhlem k ploše kolem hrany](https://www.mnastrojarna.cz/cad/docs/rovina-pod-uhlem.webp)

*Pomocná rovina pod úhlem k ploše kolem hrany – jedna z dvanácti definic.*

### Osa (10)

Osa Y nebo X skici, čára ve skici, hrana modelu, osa válcové plochy, dva body, globální osa, normála pomocné roviny, průsečnice dvou rovin, pomocná osa nebo osa Z souřadného systému.

### Výběr ze seznamu

![Dialog Vybrat ze seznamu se záložkami Vrcholy, Hrany, Plochy a hledáním](https://www.mnastrojarna.cz/cad/docs/vyber-ze-seznamu.webp)

*Všechny plochy, hrany a vrcholy tělesa s typem, středem a rozměrem – s filtrem a hledáním. Hodí se u malých entit a na mobilu.*

### Hrany a plochy prvku: ze seznamu, pravidlem, z výběru

U zaoblení, sražení, skořepiny, úkosu, přímých úprav a prvků rozšíření se hrany a plochy vybírají klikáním v modelu – nebo bez klikání. Odkaz „Ze seznamu / pravidlem…“ ve formuláři otevře seznam všech hran nebo ploch tělesa před prvkem s popisem (typ, směr, velikost, poloha), hledáním a zaškrtávátky. Do pole Pravidlo lze napsat totéž co v textových příkazech: svislé, horní kruhové, +Z, poloměr 5, boční, největší. „+ aktuální výběr“ přidá entity vybrané v modelu před otevřením formuláře a „Popis vybraných“ vypíše, co přesně je vybráno, s možností jednotlivé entity odebrat.

### Dotaz na hodnotu

Kde program potřebuje jedno číslo (odsazení roviny skici, poměr na hraně), zeptá se vlastním dialogem: lze napsat číslo s desetinnou čárkou, výraz (25/2) i proměnnou dílu, Enter potvrdí, Esc zruší.

## 5. Skica

Skica je 2D profil na rovině, ze kterého vznikají tělesa. Skicář má vlastní pás karet, uchopení, automatické vazby, kóty a číselné zadání u kurzoru.

![Pás karet Skica: uchopení, kreslení, vazby, kóty a úpravy](https://www.mnastrojarna.cz/cad/docs/skica-pas.webp)

### Založení skici

Tvorba → Skica nabídne: rovinu XY (půdorys), XZ (nárys), YZ (bokorys), rovinnou plochu modelu (klikněte na ni), XY / XZ / YZ s odsazením, rovnoběžně s vybranou plochou s odsazením, střední rovinu mezi dvěma plochami, rovinu třemi vybranými vrcholy a všechny pomocné roviny dokumentu. Existující skicu otevřete dvojklikem v historii; v jejím formuláři lze rovinu změnit na kteroukoli z 12 asociativních definic.

### Nástroje kreslení

| Nástroj | Klávesa | Zadání |
| --- | --- | --- |
| Úsečka · Lomená čára | l · k | dva body; nebo délka + úhel (50<45), x;y, @dx;dy; pravé tlačítko ukončí řetěz |
| Osa (pomocná přímka) | x | dva body |
| Obdélník · ze středu · 3 body | r | dva rohy; střed + roh; dva body základny + výška (natočený); nebo šířka × výška (30x20) |
| Kružnice · 2 body · 3 body | c | střed + poloměr / průměr (přepínač Ø/R); průměr dvěma body; tři body |
| Oblouk 3 body · středem · tečný | a | začátek, bod, konec; střed, začátek, konec (poloměr + úhel); tečný z konce úsečky |
| Elipsa | e | střed, poloosa a + úhel, poloosa b |
| Spline | n | řídicí body (hladká interpolační křivka) |
| Bod | b | bod (např. pro pole podle skici nebo díry v bodech) |
| Mnohoúhelník | p | střed, poloměr vepsaný / opsaný, počet stran |
| Drážka · Drážka obloukem | s | délka + úhel + šířka; poloměr + úhel + šířka |

### Číselné zadání u kurzoru

![Kreslení úsečky s plovoucím polem Délka a Úhel u kurzoru a automatickými vazbami](https://www.mnastrojarna.cz/cad/docs/skica-zadani.webp)

*Prostě začněte psát: Délka 50, Tab, Úhel 30, Enter. Zámek podrží hodnotu, dokud měníte druhou.*

- Po prvním kliku (nebo hned) pište hodnoty do plovoucího pole: Tab přepne na další pole a hodnotu zamkne, Enter potvrdí, Esc zruší, Backspace maže. Šedé hodnoty ukazují živou polohu kurzoru.
- První bod každého nástroje přijímá x;y absolutně nebo @dx;dy relativně k poslednímu bodu; fungují výrazy (2*10+5).
- Kótovat při kreslení (přepínač „Kóty“): hodnoty zadané číslem rovnou vloží řídicí kótu (délka úsečky, Ø/R kružnice, šířka × výška obdélníku, R mnohoúhelníku).
- d nad vybranou entitou vloží kótu okamžitě; další klik ji umístí.

### Uchopení (11 druhů)

Koncový bod, střed úsečky, střed křivky, kvadrant kružnice, průsečík, na křivce, kolmo, tečně, mřížka (krok nastavitelný), počátek a zarovnání (vodítka). Každé jde vypnout přepínačem ve skupině Uchopení v pásu nebo v panelu skicáře. Program ukáže značku uchopení u kurzoru.

### Automatické vazby

Při kreslení program rozpozná a s náhledem (žlutá ikona u kurzoru) vloží vazby vodorovně, svisle (do 3°), rovnoběžně, kolmo k sousední úsečce, tečně při navázání na oblouk, totožnost konce s existujícím bodem, bod na křivce a střed. Přepínač „AV“ / Nastavení → Skica → Automatické vazby.

### Vazby (13) a kóty (8)

Vazby: vodorovně, svisle, totožnost, rovnoběžně, kolmo, tečně, stejná velikost, pevně, soustředně, ve středu, bod na křivce, symetrie, kolineárně. Kóty: vzdálenost, vodorovná, svislá, poloměr, průměr, úhel, délka, délka oblouku – řídicí (mění geometrii) nebo referenční. Kótu upravíte dvojklikem, do hodnoty lze napsat výraz nebo proměnnou.

### Stav určenosti

Řešič vazeb (Levenberg–Marquardt) po každé změně spočítá stupně volnosti: modrá entita je nedourčená, černá plně určená, červená přeurčená nebo v konfliktu. Štítek dole říká „Nedourčeno (N st. volnosti)“, „Plně určeno“ nebo „Přeurčeno – nadbytečné vazby (n)“ a nadbytečnou vazbu označí.

### Úpravy

- Oříznout (t): klik na část křivky mezi průsečíky ji smaže; tažením se ořízne vše, přes co kurzor přejede (výkonný ořez).
- Prodloužit k nejbližší křivce, Rozdělit v bodě (kružnici dvěma body).
- Odsadit (o): entitu nebo celý řetězec o vzdálenost (klikem nebo číslem), strana podle kurzoru; úsečka–oblouk se řeší průsečíkem nebo spojovacím obloukem.
- Zaoblit roh / Srazit roh číslem, Zrcadlit podle osy, Přesunout / Kopírovat / Otočit / Měřítko, Lineární a kruhové pole entit, Rozložit složené tvary na úsečky a oblouky.
- Pomocná geometrie: přepne entitu na konstrukční (čárkovaně, netvoří profil) a zpět.
- Promítnout hrany modelu: hrany ležící v rovině skici (±0,01 mm) nebo všechny viditelné jako kolmý průmět – vznikne normální nebo pomocná geometrie, plně určená (jako „převést entity“).
- Import a export DXF: skicu lze načíst z DXF a uložit do DXF (např. pro řezání laserem).

![Kontextová nabídka pravého tlačítka ve skice s vazbami a kótami pro vybranou entitu](https://www.mnastrojarna.cz/cad/docs/skica-kontext.webp)

*Pravé tlačítko ve skice: vazby a kóty nabízené podle vybrané entity.*

### Zadání z klávesnice a ze schránky

Bod zadaný souřadnicemi x;y (nebo vyplněním polí X a Y) zůstane tam, kam jste ho napsali – dostane vazbu Pevně. Pevný je i bod zadaný relativně @dx;dy nebo délka<úhel od pevného bodu; nadbytečné vazby se nepřidávají, takže skica zadaná jen čísly hlásí Plně určeno. Body položené myší se chovají jako dřív. Leží-li napsaný bod mimo viditelnou část plátna, pohled se sám oddálí. Spline ukazuje průběh křivky už během zadávání bodů.

Seznam souřadnic ze schránky: Ctrl+V vloží body z Excelu nebo z textu (0 0, 10 5, 20;0, 30,5 8) – čísla se čtou po dvojicích X Y, desetinná čárka i tečka, oddělovač mezera, středník, tabulátor nebo nový řádek. Při nástroji Úsečka vznikne řetěz úseček, při Lomené čáře lomená čára, při Spline spline, jinak lomená čára; hlášení řekne, kolik bodů se přečetlo, při lichém počtu čísel se nic nevloží. Totéž umí Skica → Nástroje → Body ze seznamu….

### Podklad: obrázek nebo PDF

Skica → Nástroje → Podklad… vloží pod geometrii obrázek (PNG, JPG, i snímek obrazovky přes Ctrl+V) nebo stránku PDF. Podklad se ukládá s dokumentem; velké obrázky se zmenší na nejvýše 2000 px delší strany. V panelu podkladu nastavíte krytí, skrytí, natočení a šířku v mm, podklad posunete tažením (režim Posunout) a měřítko nastavíte kalibrací: Kalibrovat měřítko, klik na dva body se známou vzdáleností a zadání skutečné vzdálenosti. Stránka PDF se vkládá ve skutečné velikosti, u vícestránkového PDF lze přepínat stránky.

U vektorového PDF (výkres z CADu) tlačítko Převést čáry na entity skici vloží úsečky, oblouky, kružnice a křivky stránky jako entity skici v aktuálním měřítku a poloze podkladu (volitelně jako pomocnou geometrii); naskenované PDF lze jen obkreslit. Po znovuotevření dokumentu je pro převod čar potřeba PDF vybrat znovu (v dokumentu je uložen jen obrázek stránky).

### Dokončení

Dokončit skicu (Enter) zavře skicář. Je-li v Nastavení zapnuto „Po dokončení skici rovnou nabídnout vysunutí“, otevře se formulář vysunutí; Esc jej zruší a skica zůstane k dispozici pro jiné prvky. Skica může obsahovat více uzavřených profilů i otvory (vnoření se rozpozná automaticky).

## 6. Tvorba těles – prvky a jejich možnosti

Každý prvek je uložený v historii s parametry a lze ho kdykoli upravit, potlačit, přesunout nebo smazat. Booleovský režim Přidat / Odebrat / Průnik (a Nové těleso) je u všech tvarových prvků.

### Vysunutí (E)

| Volba | Možnosti |
| --- | --- |
| Ukončení (směr 1 a nezávisle směr 2) | Na vzdálenost · Skrz vše · K dalšímu (první stěna tělesa) · K vrcholu · K ploše (rovinné i zakřivené) · Odsazeně od plochy · K tělesu · Střední rovina (symetricky) |
| Začátek | Rovina skici · Odsazení od roviny · Od plochy · Od vrcholu |
| Směr | Kolmo na skicu · Osa X/Y/Z · Podél hrany / osy válce · Dvěma body · Normála plochy · Vektor · Pod úhlem · Tečna |
| Tenká stěna | Ven · Dovnitř · Na střed · Dvě tloušťky; funguje i pro otevřený profil (čára se stane stěnou) |
| Další | Úkos ±44° (obrys se zužuje, otvory rozšiřují), Kroucení (°), Měřítko konce (ZW3D smrštit / rozšířit), Jen vnější obrys (ignorovat otvory), Opačný směr |

### Rotace

Osa 10 způsoby (viz kap. 4), úhel 0,01–360°, jeden směr / střední rovina / dva směry s různými úhly, tenká stěna.

### Tažení

Profil = uzavřená skica nebo kružnice bez skici (zadáte jen průměr), dráha = skica s úsečkami, oblouky nebo lomenou čarou. Orientace profilu: sledovat dráhu, Frenet, pevná. Volitelně vodicí křivka, kroucení ve stupních nebo otáčkách, měřítko na konci, tenká stěna, přechod v rozích pravoúhlý / zaoblený / transformovaný.

![Formulář tažení s kruhovým profilem bez skici, orientací profilu a pokročilými volbami](https://www.mnastrojarna.cz/cad/docs/tazeni.webp)

*Tažení kružnicí bez skici – např. trubka nebo kabel podél dráhy.*

### Šablonování

Dva a více profilů v různých rovinách (hladce nebo přímkově), do bodu (kužel, jehlan), uzavřené, okrajové podmínky na začátku a konci (kolmo na profil / zadaný směr s délkou náběhu), osová křivka, vodicí křivka, tenká stěna. Otvory se šablonují, mají-li všechny profily stejný počet.

### Text

Vystouplý nebo gravírovaný text (písmo Roboto) na libovolné rovině (12 definic) s polohou odkazem; v pokročilých úpravách i text na válci.

### Primitiva

Kvádr, Válec, Trubka, Kužel, Koule – poloha čísly nebo odkazem (vrchol, střed kružnice, odvozený bod…), osa X/Y/Z nebo libovolným směrem.

### Díra (H) – průvodce

![Formulář díry s typem, řadou ISO 273, ukončením K dalšímu a polohami děr](https://www.mnastrojarna.cz/cad/docs/dira.webp)

*Průvodce dírou: typ, norma, ukončení, více poloh naráz, osa libovolným směrem.*

- Typ: vrtaná, válcové zahloubení (pro ISO 4762), kuželové zahloubení (úhel 90°), závitová (M2–M48, vrtá se jádrový průměr; závit se uvede ve výkrese).
- Pro šroub: průchozí díra podle ISO 273 v řadě jemná / střední / hrubá; rozměry zahloubení podle normy.
- Ukončení: slepá (úhel špičky vrtáku nastavitelný, výchozí 118°), skrz vše, k dalšímu, k ploše (+ odsazení), k vrcholu / bodu, odsazeně od plochy.
- Skrz vše vrtá od zadaného bodu jen ve směru vrtání – materiál nad bodem (například protější příruba) zůstane. Volba Skrz oběma směry provrtá celé těleso na obě strany. Když díra ve směru vrtání žádný materiál nezasáhne, prvek dostane upozornění ⚠.
- Poloha: klik na plochu (bod i osa se doplní podle normály), nebo více poloh z vrcholů, středů kružnic, bodů skici a pomocných bodů – jedna díra se vyvrtá všude naráz. Osa libovolným směrem (8 způsobů).
- Pokročilé úpravy obsahují i Díry v bodech (díry podle bodů skici).

### Závit

Vnější metrický závit na válcové ploše: kosmetický (jen ve výkrese, doporučeno pro výrobu) nebo modelovaný (drážky pro 3D tisk a vizualizaci), poloha odkazem.

### Rozříznout, Žebro, Pružina

Rozříznout libovolnou rovinou (12 definic) s volbou ponechané strany. Žebro z otevřené skici s tloušťkou, směrem (kolmo / v rovině) a dotažením k tělesu. Pružina / šroubovice s poloměrem, stoupáním, počtem závitů a průměrem drátu, poloha a osa odkazem.

### Zaoblení (B) – 6 variant

![Formulář zaoblení s druhem Plný rádius a výběrem bočních a prostřední plochy](https://www.mnastrojarna.cz/cad/docs/zaobleni-plny.webp)

*Plný rádius: poloměr se dopočítá z vzdálenosti bočních ploch.*

- Konstantní poloměr na vybraných nebo všech hranách.
- R1 → R2: poloměr se mění lineárně podél hrany (tlačítko Prohodit).
- Tabulka: jiný poloměr (na začátku i konci) pro každou vybranou hranu.
- Plocha–plocha: zaoblí hrany společné dvěma sadám ploch.
- Plný rádius: boční plocha 1, prostřední, boční plocha 2 → plný oblouk.
- Tečné řetězení: výběr se rozšíří po tečně navazujících hranách.

### Sražení (N) – 5 variant

Stejné vzdálenosti · D1 × D2 (s referenční plochou) · D × úhel · sražení vrcholu třemi vzdálenostmi · tečné řetězení.

### Úkos

Úhel ±44°, neutrální rovina kteroukoli z 12 definic nebo směr tahu (neutrální rovina se odvodí), tečné řetězení ploch. V pokročilých úpravách úkos od dělicí roviny.

### Skořepina

Tloušťka dovnitř nebo ven (ostré vnější hrany), otevřené plochy klikem, rozdílná tloušťka vybraných rovinných stěn.

### Přímé úpravy (bez historie skic)

Vytáhnout / Zatlačit plochy o vzdálenost nebo k vrcholu / k ploše / odsazeně od plochy, Odsadit plochu, Odstranit plochu (zacelí těleso – odstraní zaoblení, díry), Zesílit plochy na skořepinu, Barva plochy. Hodí se i pro importované modely STEP bez historie.

### Pole – 5 druhů

![Formulář pole s druhem Výplň, obrysem ze skici, rozložením a okrajem](https://www.mnastrojarna.cz/cad/docs/pole-vypln.webp)

*Výplňové pole: díry vyplní obrys skici v mřížce, střídavě nebo kruhově.*

- Lineární: směr čísly nebo odkazem (hrana, 2 body, osa…), krok nebo celková délka, mřížka ve dvou směrech, střídavé řady, vynechané kusy (zaškrtávací mřížka).
- Kruhové: osa odkazem (hrana, válec, 2 body, pomocná osa), rovnoměrně nebo krok, symetricky na obě strany, s natáčením nebo jen posun, vynechané kusy.
- Po křivce: podél skici (úsečky, oblouky, kružnice), rovnoměrně nebo s roztečí, natáčení podle tečny.
- Podle skici: kopie v bodech skici.
- Výplňové: vyplní uzavřený obrys skici (mřížka / střídavě / kruhově) s okrajem.
- Společné: více zdrojových prvků naráz, jedna booleovská operace pro rychlost, limit 400 kusů. V pokročilých úpravách i Zrcadlit prvky, Měřítko v bodě a Znovu použít nástroj.

### Zrcadlit, Přesunout / otočit

Zrcadlení podle základní roviny s posunem nebo kterékoli z 12 definic, s ponecháním originálu. Transformace tělesa: posun čísly nebo z bodu do bodu, otočení kolem osy X/Y/Z nebo hrany / osy válce / dvou bodů / pomocné osy, měřítko se středem odkazem; tažení gizmem přímo v 3D okně (G u tělesa či komponenty, R přepíná posun / otočení).

Zrcadlit lze i jen vybrané prvky (díry, výstupky): ve formuláři zvolte „Vybrané prvky“ a zaškrtněte je – těleso zůstane a prvky se na druhé straně roviny zopakují.

### Více těles v dílu

Díl může obsahovat několik samostatných těles. Vždy jedno je aktivní – s ním pracují nové prvky. Další těleso vznikne operací Nové těleso u vysunutí, rotace nebo primitiva, nebo nástroji ve skupině Tvorba → Tělesa: Rozdělit na tělesa (rovina rozdělí těleso na dvě), Kopie tělesa (posunutá kopie) a Sloučit tělesa (sjednotit, odebrat nebo průnik dvou těles, volitelně s ponecháním nástroje). Jakmile má díl víc těles, správce historie ukáže jejich seznam s objemy – kliknutím se těleso stane aktivním – a formuláře prvků nabídnou pole Těleso, kterým prvek zamíříte na jiné než aktivní těleso.

### Reference: Rovina, Osa, Bod, Souřadný systém

![Formulář pomocné osy s definicí Globální osa a živým popisem vyřešené osy](https://www.mnastrojarna.cz/cad/docs/pomocna-osa.webp)

*Pomocná geometrie se zobrazuje v 3D okně a slouží jako odkaz v dalších prvcích.*

Pomocná rovina (12 definic), osa (10 způsobů včetně průsečnice dvou rovin), bod (všechny způsoby zadání bodu) a souřadný systém (počátek + směry X a Z). Nevytvářejí geometrii, ale lze na ně odkazovat: osa rotace, osa kruhového pole, poloha díry, rovina skici.

### Pokročilé tvary

Zkrut tělesa kolem osy, Kopule na ploše, Text na válci, Lem / drážka podél hran. Dostupné v pásu Tvorba (skupiny Pokročilé úpravy, Pokročilé tvary, Pole a kopie) a v paletě příkazů.

### Otisky vybraných hran a ploch

Zaoblení, sražení, skořepina, úkos, přímé úpravy (Vytáhnout / Zatlačit, Odsadit plochu, Odstranit plochu, Zesílit) a prvky rozšíření s výběrem ploch či hran si u každé vybrané entity pamatují kromě čísla i její otisk – typ, střed a velikost na tělese před prvkem. Otisk se uloží sám při výběru klikem, ze seznamu, pravidlem, tlačítkem + aktuální výběr i v textovém příkazu (zaoblit 2 hrany svislé). Když později upravíte dřívější prvek historie a hrany či plochy se přečíslují, prvek najde stejnou hranu nebo plochu jako předtím. Nenajde-li ji, použije původní číslo a ve stromu se u něj objeví ⚠ s vysvětlením. Starší dokumenty bez otisků se staví přesně jako dřív.

### Díra „K tělesu“

Ukončení díry nabízí stejné varianty jako vysunutí: na vzdálenost, skrz vše, k dalšímu, k ploše, k vrcholu, odsazeně od plochy a K tělesu – díra vrtá od zadaného bodu po první stěnu stávajícího tělesa a dál nepokračuje (u dutého dílu provrtá jen horní stěnu). Textově díra 10 k tělesu v 30 20 40.

### Směr a osa u prvků rozšíření

Prvky rozšíření, které mají směr nebo osu (plošné vysunutí a rotace, šroubovice, výřez a lem plechu…), je zadávají stejně jako vestavěné prvky: vektorem, nebo odkazem na hranu, osu či normálu plochy. Starší dokumenty s osou X/Y/Z nebo vektorem se otevřou beze změny. Stejné pole má i směr vytažení u analýzy úkosů formy, vyhazovače a chlazení a směr pole komponent v sestavě.

Šest prvků rozšíření, které jen opakovaly vestavěné funkce s chudším zadáním (proměnné a plné zaoblení, sražení D1×D2, pole podél křivky, výplňové pole, díry v bodech), už není v pásu karet ani v paletě příkazů. Staré dokumenty s nimi se dál staví a ve formuláři je odkaz na vestavěný ekvivalent, např. „Totéž umí vestavěné Zaoblení, druh Plný“.

## 7. Plochy (plošné modelování)

Devatenáct příkazů pro tvarově složité díly, opravy importovaných modelů a práci s volnými plochami.

![Pás karet Plochy: Plochy, Úpravy ploch, Těleso ↔ plocha, Křivky](https://www.mnastrojarna.cz/cad/docs/ribbon-plochy.webp)

| Skupina | Příkazy |
| --- | --- |
| Plochy | Plošné vysunutí · Plošná rotace · Rovinná plocha (z uzavřené skici) · Tažení plochy · Šablonování ploch |
| Úpravy ploch | Odsazená plocha · Prodloužit plochu · Oříznout rovinou · Oříznout skicou · Sešít plochy · Záplata z hran |
| Těleso ↔ plocha | Uzavřít do tělesa (z uzavřené skořepiny ploch) · Zesílit plochu · Rozdělit těleso plochou · Nahradit plochu (posun) |
| Křivky | Křivka průniku · Promítnout skicu na plochu · Šroubovice · Tažení po šroubovici |

> Volné plochy se zobrazují jako tenké skořepiny; booleovské operace vyžadují uzavřené těleso – použijte Sešít plochy a Uzavřít do tělesa. Chyba „Operace vrátila prázdné těleso“ obvykle znamená právě neuzavřenou skořepinu.

## 8. Plech

Modelování plechových dílů s ohyby a rozvinem pro laser, vysekávání a ohraňování.

![Pás karet Plech: Parametry plechu, Základní plech, Ohyby, Výřez, Rohová úleva, Prolis, Rozvin](https://www.mnastrojarna.cz/cad/docs/ribbon-plech.webp)

- Parametry plechu: tloušťka, vnitřní poloměr ohybu, faktor K (neutrální osa) – platí pro celý díl.
- Základní plech z uzavřené skici; Ohyb z hrany (Shift+F) s délkou, úhlem a polohou; Lem podél hrany; Ohyb podle čáry ve skice.
- Výřez skicou skrz plech, Rohová úleva, Prolis (žebro) pro vyztužení.
- Rozvinout zobrazí rozvinutý tvar s čarami ohybů; Rozvin → DXF / SVG exportuje obrys (hladina OBRYS) a ohyby pro výrobu; Tabulka ohybů vypíše úhly, poloměry a odpočty.

## 9. Svařence a ocelové konstrukce

Rámy, stojany a konstrukce z válcovaných a uzavřených profilů včetně svarů a výkazu řezů.

![Pás karet Svařence: Konstrukční profil, Rám z profilů, Deska, Ořezat rovinou, Víčko, Styčník, Svarová housenka, Značka svaru, Kusovník řezů, Tabulka svarů](https://www.mnastrojarna.cz/cad/docs/ribbon-svarence.webp)

- Konstrukční profil (Shift+W) podél skici: IPE, HEA/HEB, UPN, úhelník L, jäkl čtvercový / obdélníkový, trubka, plochá a čtvercová tyč – rozměry podle norem z knihovny.
- Rám z profilů vytvoří celý rám z obdélníkového půdorysu jedním příkazem; Deska (patka, příruba) s dírami.
- Ořezat rovinou profily na pokos, Víčko uzavře konec profilu, Styčník spojí profily v uzlu.
- Svarová housenka koutového svaru podél hran a Značka svaru (do výkresu).
- Kusovník řezů: délky, úhly řezů a hmotnosti po profilech (pro pilu a nákup), Tabulka svarů.

## 10. Knihovna normálií

103 rodin normalizovaných dílů ve 13 skupinách. Díl vznikne napsáním označení – rozměry se doplní z tabulek norem.

![Knihovna normálií: rozpoznané čelní ozubené kolo m2 z24 s parametry a náhledem](https://www.mnastrojarna.cz/cad/docs/knihovna-ozubene-kolo.webp)

*Napište „ozubené kolo m2 z24“ – knihovna rozpozná rodinu, doplní parametry a ukáže náhled.*

Otevření: Ctrl+L, pás Tvorba → Normálie, nebo paleta. Do pole napište označení: ISO 4762 M8x30, DIN 933 M10x40, 6205 2RS, 30206, IPE 200 1500, jäkl 40x40x3 2000, ozubené kolo m2 z24, řetězové kolo 08B z17, HTD 5M 30, vodicí sloupek 24x150, pružina 2x20x50, O-kroužek 20x2. Výsledek lze vložit jako nový díl, přidat do sestavy (s automatickou vazbou šroubu do díry) nebo upravit parametry ručně. Oblíbené a nedávné položky zůstávají uložené.

| Skupina | Rodiny |
| --- | --- |
| Spojovací materiál | šrouby ISO 4762 / 7380 / 10642 (válcová, půlkulatá, zápustná hlava s vnitřním šestihranem), šrouby s křížovou drážkou, šestihranné šrouby a matice, pojistné a přírubové matice, křídlová matice, pružné a zubové podložky, podložky, závitová tyč, šroub s okem, nýt, samořezný šroub |
| Kolíky a pera | válcový, pružný a kuželový kolík, těsné a úsečové pero, závlačka |
| Pojistné kroužky | vnější a vnitřní Seeger |
| Ložiska | kuličková jednořadá, kuželíková, axiální, jehlová HK, ložisková tělesa UCP, kluzná pouzdra |
| Ozubení a řetězy | čelní kola s přímými a šikmými zuby, vnitřní ozubení, ozubený hřeben, kuželová kola, šnek a šnekové kolo, řetězová kola pro válečkové řetězy |
| Řemenice | ozubené řemenice HTD, klínové řemenice |
| Ocelové profily a trubky | IPE, HEA/HEB, UPN, L, jäkl, trubky, ploché a čtvercové tyče |
| Pružiny a těsnění | tlačné, tažné, zkrutné a talířové pružiny, plynová vzpěra, O-kroužky |
| Normálie forem | vodicí sloupky a pouzdra (s límcem i bez), vyhazovače válcové, ploché a trubkové, vratné kolíky, středicí kroužek, vtoková vložka, kanál, sedlo trysky, opěrný sloupek, dosedka, šikmý čep, temperační spojka, datumovka |
| Lineární technika | kolejnice HGR, kuličkový šroub SFU s maticí, vodicí tyče W, domečky SHF, lineární pouzdra LM a SC |
| Pneumatika a hydraulika | válce ISO 15552 a ISO 6432, nástrčná šroubení |
| Hliníkové profily | konstrukční profily s T-drážkou, T-matice, úhelníky |
| Potrubí a příruby | závitové trubky, příruby PN16 EN 1092-1, hadicové nátrubky |

![Knihovna normálií: profil IPE 200 délky 1500 mm s tabulkou rozměrů](https://www.mnastrojarna.cz/cad/docs/knihovna-ipe.webp)

*Ocelové profily s tabulkou rozměrů podle normy.*

## 11. Sestavy

Sestava skládá díly a podsestavy, drží je vazbami, kontroluje kolize a vytváří kusovník.

![Sestava rámu vstřikovací formy s deskami, vodicími sloupky a pouzdry](https://www.mnastrojarna.cz/cad/docs/sestava-ram-formy.webp)

*Rám vstřikovací formy vytvořený průvodcem – desky, vodicí sloupky a pouzdra, vyhazovací paket.*

- Nová sestava nebo Sestava z aktuálního dílu (Soubor / pás Sestava). Komponenty: Vložit díl / model (soubor .mncad, STEP, STL…), Normálie z knihovny, kopie dílů; podsestavy lze vytvořit z vybraných komponent (Ctrl+klik), rozpustit nebo otevřít.
- Strom vlevo: skrýt / zobrazit, barva, přejmenovat, zafixovat, duplikovat, zrcadlit, kruhové / lineární pole komponent, upravit díl v kontextu.
- Přesun: gizmo (G) se šipkami pro posun a oblouky pro otočení; přesné hodnoty ve formuláři komponenty.
- Vazby: Kontakt (shodné plochy), Zarovnat (rovnoběžně v rovině), Vystředit / Soustředně (válce), Vzdálenost, Úhel, Rovnoběžně, Pevně. Vazby jsou trvalé – při změně polohy se přepočítají; stav ukazuje strom. Šroub z knihovny vložený klikem do díry dostane vazby automaticky.
- Kolize: kontrola průniků všech dílů (i v podsestavách) se zvýrazněním a objemem průniku.
- Kusovník: položky, počty, materiál, hmotnost; export CSV; pozice se přenášejí do výkresu.
- Rozložený pohled s nastavitelným odstupem pro prezentaci a montážní návody.
- Rám vstřikovací formy: průvodce podle rozměrů dutiny vygeneruje desky, vodicí sloupky a pouzdra, středicí kroužek, vyhazovací paket a dosedky jako plnou sestavu s normáliemi.
- Export sestavy do STEP (jeden soubor) a výkres sestavy s kusovníkem a pozicemi.

### Vazby krok za krokem

Vyberte komponentu a zvolte typ vazby (karta Sestava nebo panel komponenty). Panel vazby vás provede kroky: 1 · plocha této komponenty, 2 · cílová komponenta a její plocha. Plochu vyberete kliknutím v modelu, nebo ze seznamu v panelu – oba způsoby lze kombinovat a vybranou plochu vrátíte tlačítkem Změnit. Seznam nabízí jen plochy, které vazba umí (Souosost válcové a kuželové, ostatní vazby rovinné), u každé uvádí typ, směr normály nebo osy, polohu a velikost a při najetí myší plochu v modelu zvýrazní. U vazeb Vzdálenost a Úhel se hodnota zadává až po výběru obou ploch: pole je předvyplněné právě naměřenou hodnotou, takže pouhým potvrzením (Enter) se komponenty nepohnou; přepsáním hodnoty se komponenta přisune nebo natočí. Hotové vazby jsou v seznamu Vazby pod stromem komponent – hodnotu tam můžete kdykoli přepsat (i výrazem, např. 25/2), vazbu otočit, potlačit nebo smazat a sestava se ihned přepočítá. Tlačítko Ukotvit přidá vazbu Ukotvit: komponenta zůstane na místě a ostatní vazby hýbou druhou komponentou. U pole komponenty zadáte směr tlačítky X / Y / Z, obrátíte ho (±) nebo ho převezmete z plochy v modelu.

![Kusovník sestavy s pozicemi, počty, materiálem a hmotností](https://www.mnastrojarna.cz/cad/docs/sestava-kusovnik.webp)

*Kusovník sestavy – export do CSV, pozice do výkresu.*

## 12. Formařské nástroje

Nástroje pro konstrukci vstřikovacích forem a lisovacích nástrojů, které jinak najdete jen v drahých modulech.

![Barevná mapa úkosů na výlisku s nastavením směru tahu a minimálního úkosu](https://www.mnastrojarna.cz/cad/docs/formy-ukosy.webp)

*Analýza úkosů: zelená vyhovuje, červená pod minimálním úkosem, žlutá svislé stěny.*

- Úkosy: barevná mapa podle směru tahu a minimálního úhlu, výpis problémových ploch.
- Plochy: zebra pruhy (hladkost navazování), mapa křivosti, tloušťka stěn s limitem (odhalí tenká a tlustá místa výlisku).
- Smrštění: zvětšení dutiny podle materiálu – PP, PE-HD, ABS, PC, PA6, PA66 GF30, POM, PMMA, PS, TPE (nebo vlastní %).
- Vyhazovače: návrh rozmístění podle půdorysu, vložení jako díry nebo jako díly do sestavy.
- Chlazení: návrh temperačního okruhu (průměr kanálu, hloubka pod dutinou, počet větví, přesah).
- Dělicí rovina: návrh výšky dělení; Rozdělit těleso a Nahradit plochu pro tvarové vložky.
- Rám formy (kapitola 11) a normálie forem (kapitola 10).

## 13. Výkresy

Výrobní výkres z modelu nebo sestavy během minuty – pohledy, kóty, tolerance, razítko a export do PDF, DXF, DWG nebo SVG.

![Výkresový prostor s pohledy, izometrií, razítkem a nástroji pro kóty, poznámky, drsnosti a geometrické tolerance](https://www.mnastrojarna.cz/cad/docs/vykres.webp)

*Výkres: pohledy podle ISO (evropské promítání) nebo americké, razítko s názvem, materiálem, hmotností, autorem a tolerancemi.*

- Pohledy: přední, horní, levý, pravý, zadní, spodní a izometrie – zapínají se přepínači; měřítko a formát listu A4–A0 automaticky nebo ručně; promítání E (evropské) / A (americké).
- Řez rovinou s šrafováním, Detail (zvětšený výřez), tabulka děr, skryté hrany čárkovaně.
- Anotace: kóta (zarovnaná, vodorovná, svislá, s předponou / příponou / textem), poznámka s odkazovou čarou, drsnost Ra, geometrická tolerance (rovinnost, válcovitost, kolmost, rovnoběžnost, souosost, házení…), základna, volný text. Kóty se umisťují tažením.
- Sestavy: kusovník na listu, pozice s odkazovými čarami, více listů.
- Razítko: název, číslo, materiál, hmotnost, měřítko, autor (Nastavení → Výkres), nepředepsané tolerance (ISO 2768-mK výchozí), datum, logo.
- Export: PDF (vektorový), DXF a DWG (verze R2000 až R2018, otevře AutoCAD, ZWCAD, BricsCAD, DraftSight), SVG. Výkres je uložený v projektu .mncad a při změně modelu se aktualizuje.

### Kóty podle vybrané geometrie

Nástroj Kóta (D) pozná, na co klikáte: kliknutím na kružnici vznikne kóta průměru Ø, na oblouk (zaoblení) kóta poloměru R – klávesa Shift nebo přepínač „Kružnice: Auto / Ø / R“ volbu obrátí. Kliknutím doprostřed hrany se okótuje její délka, kliknutím na druhou hranu úhel mezi nimi (u rovnoběžných hran jejich vzdálenost). Dva body (konce hran, středy děr) dají délkovou kótu. Pod kurzorem se zvýrazní, co by se vybralo, a po výběru se kóta kreslí u kurzoru jako náhled. Po umístění se u kurzoru otevře malé pole: do něj napíšete toleranci nebo příponu (H7, ±0,1) a případně odsazení kóty – Enter potvrdí. Kóty kružnic, hran a úhlů se drží své geometrie: změní-li se průměr díry nebo délka hrany, hodnota se přepočítá sama; když geometrie z pohledu zmizí, kóta se v seznamu označí ⚠. List výkresu se přejmenuje dvojklikem přímo na záložce.

> Pro CAM a laser exportujte DXF (skica, rozvin nebo výkres); pro zákazníky a výrobu PDF; pro úpravy v 2D CADu DWG.

### Rozvržení listu, otočení pohledu, poloviční řez, další modely

Zapnutí řezu nemění formát listu: když se pohledy vejdou, řez se položí do volného místa. Větší formát nebo menší měřítko se nabídne, jen když se pohledy opravdu nevejdou. Volba Otočení hlavního pohledu (0°, 90°, 180°, 270°) otočí hlavní pohled i celé promítání, takže soustružený díl může ležet osou vodorovně; kóty vybírané z geometrie fungují i v otočeném pohledu. V sekci Řez A–A lze zvolit Poloviční řez (polovina pohled, polovina řez podle osy souměrnosti). Skryté hrany jsou u nového výkresu vypnuté; uložené výkresy si své nastavení ponechají.

Sekce Další modely na listu přidá na tentýž list pohled jiného modelu: u sestavy libovolnou komponentu, u dílu i sestavy jiný dokument ze souboru .mncad. Každý model má vlastní pohled a měřítko v popisku, např. „Čep (1:1)“. Pohledy se promítají jen jednou pro každý směr – zapnutí řezu, skrytých hran, otočení nebo změna razítka a kót projekci znovu nespouští.

### Chytré kóty

Nový výkres se kótuje automaticky podle prvků modelu, ne podle každé promítnuté čáry. Každý funkční rozměr je na listu jen jednou, kóty stojí v úhledných řadách mimo obrys (první 8 mm od obrysu, další po 7 mm, kratší blíž dílu) a texty se čtou zdola nebo zprava. Co se na list čistě nevejde, se nekreslí přes sebe, ale ohlásí se ve stavu výkresu.

- Soustružené díly: průměry osazení naskládané po straně (nejmenší nejblíž dílu), délky osazení v jedné řetězové řadě, celková délka ve vnější řadě; nejdelší článek řetězu je pomocná kóta v závorce, aby řetězec nebyl uzavřený. Zápich šířkou a průměrem, vnější závit označením (M20×1,5) a délkou, sražení a zaoblení jedním popisem s počtem (1,5×45°, 2× R1).
- Hranolové díly: celkové rozměry jednou, polohy děr od levé a spodní hrany v pohledu, kde jsou díry kružnice; souměrné díry od osy souměrnosti, kruhové pole roztečnou kružnicí s poznámkou „rovnoměrně“.
- Díry: každá skupina stejných děr má jeden popis s odkazem sestavený z parametrů díry – 4× M8 ↧10 / Ø6,8 ↧14, 6× Ø11 skrz / ⌴ Ø18 ↧11, ⌵ Ø12,4 × 90°. Značky ↧ ⌴ ⌵ se v náhledu, PDF, DXF, DWG i SVG kreslí čarami.
- Vygenerované kóty jsou běžné upravitelné kóty: lze jim dopsat toleranci, posunout je nebo smazat. Při změně modelu se přepočítají a vlastní kóty zůstanou. V nastavení kót lze přepnout řetězově / od základny, tlačítko Přegenerovat kóty je vytvoří znovu a ponechá tolerance i vlastní kóty.
- Textem: výkres A3 na šířku pohledy přední,horní,iso, kótovat [řetězově|od základny], výkres tolerance Ø30 h6, výkres nepředepsané ISO 2768-mK, výkres stav (přehled kót po pohledech, duplicity, chybějící rozměry; pro skripty window.mncad.drawingStatus()).

## 14. Analýza a měření

![Měření vzdálenosti mezi dvěma entitami s kótou v 3D okně a tabulkou výsledků](https://www.mnastrojarna.cz/cad/docs/mereni.webp)

*Měření mezi entitami: vzdálenost, úhel, poloměr, délka, přímo v 3D okně.*

- Měřit (M): klikněte na jednu nebo dvě entity (bod, hrana, plocha, těleso) – vzdálenost (nejkratší), úhel, poloměr, délka, plocha; výsledek zůstane jako kóta v okně. Při najetí na hranu se nabídnou body k uchopení – koncové body, střed hrany a střed kružnice / oblouku (červený kosočtverec) – takže změříte např. rozteč děr od středu ke středu.
- Vlastnosti / inspektor: typ plochy (rovinná, válcová, kuželová, kulová, toroidní, B-spline…), normála, osa, poloměr, obsah; u tělesa objem, povrch, hmotnost, těžiště, počet ploch a hran.
- Hmotnost: materiál z 12 položek (ocel, nerez, hliník, mosaz, měď, titan, POM, nástrojové oceli 1.2311, 1.2343, 1.2738, 1.1730, 1.7131) nebo vlastní hustota.
- Řez (X): rovina řezu záložkami X / Y / Z, Plocha (rovina vybrané rovinné plochy, posun od ní) nebo Vektor (normála nx; ny; nz); poloha posuvníkem nebo číslem v mm (i výraz, např. 50/2), Otočit stranu ponechá druhou část.
- Kontrola geometrie: nalezne neplatné plochy a otevřené hrany importovaných modelů; Sjednotit plochy slučuje rozdělené plochy; Tloušťka stěn s barevnou mapou.

### Porovnání s referenčním modelem

Nástroje → Analýza → Porovnat s referencí kontroluje vlastní model proti 3D modelu zákazníka. Načtěte STEP nebo BREP (přesná geometrie); IGES, STL, OBJ, 3MF, PLY, OFF a glTF se převedou na síť a přesnost je omezená sítí. Výsledek ukazuje objem modelu a reference, rozdíl a dva jednostranné rozdíly v cm³: navíc v modelu (v referenci je drážka, díra nebo kapsa, kterou model nemá) a chybí v modelu. Seznam rozdílových oblastí je seřazený podle objemu (objem, rozměr, střed, charakteristické plochy, např. „v modelu chybí drážka / zápich R12,50“); drobné slupky z nepřesností se sčítají zvlášť jako numerický šum. Kliknutím se oblast zvýrazní a pohled se na ni přiblíží.

Barevná mapa odchylek obarví model podle vzdálenosti od povrchu reference: zelená = v toleranci, žlutá → červená = odchylka až do hodnoty „Červená od“; přesnost mapy je uvedena v legendě. Je-li reference jinak umístěná, zvolte Středy, Automaticky (24 otočení po 90°) nebo ruční otočení a posun. Report se exportuje jako CSV nebo text. Dlouhý výpočet ukazuje průběh a jde zrušit.

### Náhled bez WebGL

Když prohlížeč nemůže spustit 3D okno (stará grafická karta, vzdálená plocha, akcelerace zakázaná správcem), zobrazí se místo něj zjednodušený softwarově kreslený náhled modelu. Tlačítky přepnete pohled (Izometrie, Přední, Zadní, Horní, Spodní, Levý, Pravý), Přizpůsobit vrátí celý model do okna, + / − nebo kolečko přibližují, tažení otáčí a Shift + tažení posouvá. Funguje styl zobrazení, řez i sestavy. Plochy a hrany se v náhledu kliknutím nevybírají – použijte seznamy ve formulářích (Ze seznamu…) nebo textové příkazy. Příčinu a postup nápravy ukáže tlačítko Proč nevidím 3D?.

## 15. Proměnné, rovnice a stavy dílu

- Proměnné (záložka vlevo): název, hodnota nebo výraz (L/2, sqrt(a^2+b^2), max(d, 10)), jednotka a popis. Funkce: sin, cos, tan, sqrt, abs, min, max, round, floor, ceil, pi…
- Navázání parametru: do kteréhokoli číselného pole napište =výraz (např. =d*3) – pole se přepočítá při každé změně proměnné. Vazba se ukládá s dokumentem a zobrazuje ikonou u pole.
- Stavy (konfigurace): varianty dílu s jinými hodnotami proměnných a potlačenými prvky (např. „s přírubou / bez příruby“, velikosti M8 / M10). Aktivní stav se přepíná ve správci; výkres a export respektují aktivní stav.
- Nedávné soubory a rozpracovaná práce: ve výchozím režimu se nic neukládá (ochrana dokumentace). Zapnete-li v Nastavení → Soubory šifrované úložiště s heslem, ukládá se rozpracovaný model, záložky a nedávné soubory s náhledy (až 12) do tohoto prohlížeče zašifrovaně (AES-256) – bez hesla je nikdo nepřečte; odemčení platí do zavření karty.

## 16. Soubory, import a export

![Nabídka Soubor: nový díl, otevřít, uložit projekt, export 3D, výkres, sestavy, ukázky, knihovna, nastavení](https://www.mnastrojarna.cz/cad/docs/menu-soubor.webp)

*Nabídka Soubor.*

| Formát | Import | Export | Poznámka |
| --- | --- | --- | --- |
| Mnástrojárna projekt (.mncad) | ano | ano | úplná historie prvků, skici, proměnné, stavy, výkresy, sestava; při uložení se program zeptá na místo a název (Uložit / Uložit jako…) |
| STEP (.step/.stp) AP214 | ano | ano | přesná geometrie; doporučený formát pro výměnu se SolidWorks, Inventor, ZW3D, CATIA, Creo, Fusion, CAM |
| IGES (.igs/.iges) | ano | — | starší přesný formát |
| BREP (.brep) | ano | ano | nativní formát OpenCascade |
| STL (.stl) | ano | ano | 3D tisk, síť |
| 3MF (.3mf) | ano | ano | 3D tisk s jednotkami a barvami |
| OBJ · glTF/GLB · PLY · OFF | ano | OBJ, GLB | vizualizace, web, AR |
| VRML (.wrl) | — | ano | starší prohlížeče |
| DXF | skica | skica, rozvin, výkres | laser, CAM, 2D CAD |
| DWG | — | výkres (R2000–R2018) | AutoCAD a kompatibilní |
| SVG · PDF | — | výkres, rozvin | dokumentace, tisk |

Přetažení myší: soubory lze přetáhnout přímo do okna CADu – z průzkumníka, z plochy i jako přílohu z Outlooku. Každý model se otevře ve vlastní záložce (v sestavě se vloží jako komponenta), DXF se načte jako skica. Tlačítko Otevřít / importovat (Ctrl+O) a úvodní obrazovka dělají totéž.

Nativní formáty (SLDPRT, SLDASM, IPT, IAM, Z3, CATPART, PRT, X_T, F3D, SKP, 3DM, IFC, JT, SAT…) prohlížeč otevřít nemůže – program je rozpozná a ukáže přesný postup, jak soubor ve zdrojovém CADu uložit jako STEP. Síťové formáty se importují jako těleso ze sítě (lze měřit, řezat, exportovat; booleovské operace fungují omezeně).

Poptat výrobu: tlačítko v titulní liště připraví STEP aktuálního dílu a předvyplněný e-mail pro nástrojárnu Mnástrojárna (prototypy, náhradní díly, nástroje, přípravky, 1–99 ks).

### Velké soubory a sestavy STEP

Po výběru nebo přetažení souboru se dole zobrazí průběh (co se čte, díl k z n, uplynulý čas a tlačítko Zrušit). Hláška o úspěchu se objeví až ve chvíli, kdy je model skutečně vidět, a pohled se na model sám přizpůsobí, i když leží daleko od počátku. Neúplný (useknutý), prázdný nebo poškozený soubor ohlásí srozumitelnou chybu místo prázdného okna.

- Sestava STEP od 1 MB se otevře v lehkém režimu jako sestava: díly se vyříznou podle stromu výrobku (názvy, barvy, opakované výskyty sdílejí data, jednotky mm / m / palce se převedou na mm) a načítají se po dávkách s hrubší sítí – první obraz je vidět během několika sekund (zkušební sestava 47,5 MB se 148 díly a 321 výskyty: první obraz asi za 3 s, celá asi za 37 s). Objem a plocha dílů v lehkém režimu se počítají ze sítě.
- Chcete-li na dílu modelovat, zvolte v nabídce komponenty Otevřít jako díl – otevře se v nové záložce s přesnou geometrií. Je-li otevřená sestava, vloží se soubor STEP jako podsestava.
- Jednodílné a malé soubory STEP se otevírají jako dosud (prvek Import v dílu); velmi složitá tělesa (nad 1000 ploch) dostanou přiměřeně hrubší síť a rychlý výpočet obálky.
- Data importovaných souborů drží karta v paměti jen jednou, dokument obsahuje jen odkaz. Při uložení projektu .mncad a při sdílení odkazem se data vloží (každý díl jednou), takže uložený projekt je samostatný. Automaticky uložený dokument a nedávné soubory importovaná data neobsahují – otevřete znovu původní soubor nebo uložený .mncad.
- Dojde-li jádru paměť nebo spadne-li, program to ohlásí a jádro spustí znovu. Jádro má k dispozici nejvýš 4 GB paměti; sestava 47,5 MB jako jedno přesné těleso potřebuje asi 1,5 GB, v lehkém režimu asi 350 MB.

## 17. Sdílení odkazem

Jedno tlačítko a díl, sestava nebo výkres je u kolegy, zákazníka či dodavatele – kdekoli na světě, bez instalace a registrace. Odkaz pošlete WhatsAppem, e-mailem, přes Teams nebo jakkoli jinak.

Tlačítko Sdílet je v horní liště vedle Nápovědy, v nabídce Soubor → Sdílet odkazem… a v paletě příkazů (Ctrl+K → „sdílet“). Dialog vytvoří odkaz okamžitě s výchozí platností 10 dní – stačí Kopírovat odkaz a vložit ho do zprávy, nebo použít tlačítka WhatsApp, E-mail či Sdílet… (systémová nabídka na mobilu: Teams, Messenger, Signal…). Tlačítko Kopírovat zprávu zkopíruje hotový text s názvem dílu, platností a odkazem.

![Dialog Sdílet odkazem: platnost 10 dní, heslo, odesílatel, hotový odkaz a tlačítka Kopírovat odkaz, WhatsApp, E-mail](https://www.mnastrojarna.cz/cad/docs/sdileni.webp)

*Dialog Sdílet odkazem: odkaz je hotový hned po otevření; volby platnosti, hesla a odesílatele ho přegenerují.*

### Co příjemce uvidí

![Sdílený díl otevřený u příjemce s pruhem Sdílený dokument od Vít Volný, platí do data, snímek](https://www.mnastrojarna.cz/cad/docs/sdileni-prijemce.webp)

*U příjemce: díl se otevře v nové záložce s pruhem „Sdílený dokument“ – vidí odesílatele i platnost, může měřit, řezat a uložit kopii.*

- Odkaz otevře Mnástrojárna CAD v prohlížeči (Chrome, Edge, Firefox, Safari, i na mobilu) se snímkem dokumentu: lze otáčet, měřit, řezat, procházet historii prvků, prohlížet výkresy, exportovat STEP nebo uložit kopii .mncad.
- Nad pracovní plochou je pruh „Sdílený dokument od … · platí do …“. Jde o snímek – úpravy příjemce se vám nepromítnou a vaše pozdější úpravy se do odkazu nedostanou; v takovém případě pošlete nový odkaz.
- Stejný odkaz může otevřít libovolný počet lidí současně (například technolog, nákupčí a dodavatel na třech místech).
- Sdílíte-li z výkresové záložky, příjemci se po otevření rovnou zobrazí výkres; model s historií má také.
- Otevřený sdílený dokument přežije obnovení stránky (F5) v téže kartě; po zavření karty je pryč – nic se neukládá.

### Platnost, heslo, odesílatel

- Platnost 1, 7, 10, 30 nebo 90 dní, případně bez omezení. Po vypršení se odkaz neotevře („Platnost sdíleného odkazu vypršela“) – dokument prostě sdílejte znovu.
- Heslo (volitelné): bez něj je odkaz nečitelný. Heslo pošlete jiným kanálem (SMS, telefon); příjemce ho zadá při otevření.
- Odesílatel: jméno nebo firma, které příjemce uvidí v pruhu nad modelem. Program si ho pamatuje pro příště.

### Jak je to s ochranou dokumentace (NDA)

Dokument je zkomprimovaný přímo v odkazu, v části za znakem „#“. Tuto část prohlížeč nikdy neposílá na server – ani na hosting webu, ani do měření návštěvnosti; po otevření ji program z adresy hned odstraní, takže nezůstane v historii prohlížeče. Dokument tedy existuje jen ve zprávě, kterou sami pošlete, a v paměti karty příjemce. U příjemce platí výchozí režim bez ukládání.

Velké modely (importovaná geometrie STEP/BREP, rozsáhlé sestavy) se do odkazu nevejdou – dialog na to upozorní. Pro ně lze zapnout šifrované úložiště sdílení: dokument se zašifruje (AES-256) ještě v prohlížeči, na server jde jen šifrovaný soubor a klíč je pouze v odkazu; soubor se po vypršení platnosti smaže. Bez úložiště pošlete soubor .mncad nebo STEP klasicky jako přílohu.

| Situace | Doporučení |
| --- | --- |
| Parametrický díl nebo sestava | Odkaz (jednotky až desítky kB) – WhatsApp, e-mail, Teams, Slack |
| Dlouhý odkaz (nad 8 kB) | Kopírovat odkaz a vložit do zprávy; SMS odkaz nepřenese |
| Importovaný STEP, velká sestava | Šifrované úložiště sdílení, nebo soubor .mncad / STEP jako příloha |
| Citlivá dokumentace | Heslo + krátká platnost; heslo pošlete jiným kanálem |
| Živá porada nad modelem | Všichni otevřou týž odkaz; změny pošlete jako nový odkaz nebo sdílejte obrazovku |

> Odkaz je snímek: kdo ho má, otevře dokument do konce platnosti. Pro citlivé díly použijte heslo a kratší platnost.

## 18. Nastavení

![Dialog Nastavení se záložkami Obecné, Zobrazení, Myš a ovládání, Skica, Výkres, Soubory a Klávesové zkratky](https://www.mnastrojarna.cz/cad/docs/nastaveni.webp)

*Nastavení (Ctrl+,) – sedm záložek, změny se ukládají v prohlížeči.*

| Záložka | Volby |
| --- | --- |
| Obecné | délkové jednotky, desetinná místa (délky, úhly), potvrzovat mazání, po dokončení skici nabídnout vysunutí, úvodní obrazovka, výchozí materiál |
| Zobrazení | výchozí styl (stínovaný s hranami / drátový / průhledný), pozadí, kvalita sítě, tloušťka hran, pravoúhlé promítání, mřížka a osy, ViewCube, osový kříž, informační štítky, světlý / tmavý vzhled |
| Myš a ovládání | schéma ZW3D / SolidWorks / touchpad, přiblížení ke kurzoru, obrácení kolečka |
| Skica | přichytávání k mřížce, krok mřížky, automatické vazby, zobrazování značek vazeb |
| Výkres | autor do razítka, výchozí formát listu, promítání E / A, nepředepsané tolerance (ISO 2768) |
| Soubory | rozpracovaná práce v prohlížeči: neukládat (výchozí) nebo šifrované úložiště s heslem; vymazání všeho uloženého; počet nedávných souborů |
| Klávesové zkratky | každou zkratku lze přemapovat; obnovit výchozí |

## 19. Klávesové zkratky

| Zkratka | Akce |
| --- | --- |
| Ctrl+K | paleta příkazů |
| Ctrl+L | knihovna normálií |
| Ctrl+, | nastavení |
| Ctrl+S / Ctrl+O | uložit projekt / otevřít |
| Ctrl+Z / Ctrl+Y | zpět / znovu |
| S | nová skica – na vybrané rovinné ploše hned, jinak nabídne roviny |
| E | vysunutí |
| H | díra |
| B | zaoblení (vybrané hrany použije rovnou) |
| N | sražení (vybrané hrany použije rovnou) |
| M | měřit |
| X | řez |
| G | gizmo přesunu tělesa / komponenty (R přepne otočení) |
| 0 · 1 · 2 · 3 · 4 · 5 · 6 | izometrie · přední · horní · pravý · zadní · spodní · levý |
| F | přizpůsobit pohled |
| P | perspektiva / pravoúhlá |
| Enter / Esc | OK / Storno prvku; Esc opustí textové pole a pak zruší výběr; ve skice dokončit / zrušit krok |
| Delete | smazat upravovaný nebo vybraný prvek, vybranou plochu (Odstranit plochu), komponentu sestavy nebo entitu skici – stejně jako tlačítko Smazat v pásu |
| Ctrl+klik | přidat do výběru |
| Skica: l k x r c a e n b p s | úsečka · lomená čára · osa · obdélník · kružnice · oblouk · elipsa · spline · bod · mnohoúhelník · drážka |
| Skica: t o d m v | oříznout · odsadit · kóta · měřit · výběr |
| Skica: Tab / Enter | další pole číselného zadání (zámek) / potvrdit |
| Shift+F · Shift+W | ohyb z hrany (plech) · konstrukční profil (svařence) |

Zkratky 3D i nástrojů skici se mění v Nastavení → Klávesové zkratky (skupiny „3D model“ a „Skica“ – stejnou klávesu lze mít v obou). Přehled Klávesové zkratky a ovládání (nabídka Nápověda) vždy ukazuje aktuální nastavení.

## 20. Mobil a dotykové ovládání

![Mnástrojárna CAD na mobilním telefonu: nabídka Skica jako spodní list](https://www.mnastrojarna.cz/cad/docs/mobil.webp)

*Na telefonu se nabídky a formuláře otevírají jako spodní listy s velkými tlačítky.*

- Jeden prst otáčí, dva prsty posouvají a přibližují, dlouhý stisk otevře kontextovou nabídku (jako pravé tlačítko).
- Rozbalovací nabídky pásu a formuláře prvků se otevírají jako spodní listy, takže model zůstává vidět; výběr entit do pole odkazu funguje dotykem, dlouhý stisk na poli nabídne způsoby zadání a výběr ze seznamu.
- Záložky otevřených dokumentů (díly, sestavy, výkresy) mají na telefonu vlastní řádek pod horní lištou, takže jsou vždy vidět. Tlačítko s počtem dokumentů vpravo otevře seznam všech otevřených záložek s přepnutím, novou záložkou a zavřením. Výkres se otevírá pod tímto řádkem – mezi dílem a výkresem lze přepínat kdykoli.
- Skica dotykem: jeden prst dělá totéž co levé tlačítko myši (klepnutím kreslíte a vybíráte, tažením přesouváte entity, úchyty a kóty – tažení začne až po posunutí prstu asi o 8 px). Dlouhý stisk na místě otevře stejnou kontextovou nabídku jako pravé tlačítko a ukončí rozkreslený krok. Dvěma prsty skicu posouváte a roztažením nebo sevřením přibližujete.
- Pás karet se při nedostatku místa sám zhustí (malá tlačítka bez pevné šířky, potom jen ikony s popiskem v bublině) a místo posuvníku má po stranách šipky; posouvá se i prstem. Paleta příkazů a knihovna fungují stejně jako na počítači. Pro produktivní práci doporučujeme tablet s klávesnicí nebo počítač.

## 21. Pro AI agenty a automatizaci

Vše, co jde v CADu udělat myší, jde udělat i textem. Konzole Textové příkazy, JSON formát dokumentu a JavaScript API dávají AI agentům (ChatGPT Agent, Claude, vlastní skripty) přístup ke všemu – a zpětnou vazbu jako text, bez čtení obrázku. Pro člověka se nic nemění: stejná obrazovka, stejné nabídky.

### Konzole Textové příkazy

Nápověda → Textové příkazy, zkratka Ctrl+Shift+K, nebo paleta Ctrl+K → „text“. Do pole se napíší příkazy (jeden na řádek, česky i anglicky) nebo JSON, tlačítko Provést (Ctrl+Enter) je vykoná a protokol ukáže ✓ / ✗ s důvodem pro každý řádek plus textový stav dokumentu: rozměry v X/Y/Z, objem, počet ploch a hran, seznam prvků se stavem a chybami. Příkazy se připojují k otevřenému dokumentu; „smazat poslední“ vrátí poslední prvek. Paleta Ctrl+K přímo nabídne „Provést příkaz“, když do ní napíšete platný příkaz (např. „díra 8,5 skrz v 20 30“).

| Příkaz | Význam |
| --- | --- |
| nový díl [název] · nová sestava | nový dokument v nové záložce |
| kvádr X Y Z [střed] [v x y z] · válec D H [osa Z] · koule D · kužel D1 D2 H · trubka D d H | primitiva (průměry); „odebrat“, „průnik“, „nové“ = booleovský režim |
| skica XY\|XZ\|YZ [odsazení N]: kružnice 165; obdélník 60 40 … | skica s entitami (obdélník, kružnice, mnohoúhelník, drážka, úsečka, čára, bod, elipsa; „pomocná“ = konstrukční) |
| vysunout H [symetricky] [skrz] [odebrat] [úkos a] · rotovat [úhel] [osa X\|Y\|Z] | tvarové prvky z poslední skici |
| díra D [hloubka H\|skrz] v x y [z] [zahloubení D2 H2] [kuželové D2] [závit M8] | bez z = na horní plochu tělesa |
| zaoblit R [hrany svislé\|horní\|kruhové\|+Z…] · srazit C [hrany …] · skořepina T [otevřít +Z] | výběr hran a ploch pravidlem – bez klikání do 3D |
| pole N rozteč P [směr X] [N2 rozteč P2 směr Y] · pole kruhové N · zrcadlit YZ · text "ABC" výška 8 hloubka 1 v x y | pole, zrcadlení, nápis |
| závit M18×1,5 délka 20 v x y z [vnitřní] [modelovat] · kolize | katalogový závit (hrubé i jemné stoupání, vnější / v díře) · kontrola kolizí sestavy do protokolu |
| oblouk x1 y1 xm ym x2 y2 · spline x y … · čára x1 y1 x2 y2 r 5 x3 y3 … | ve skice: oblouk třemi body, hladká křivka, „r N“ za bodem čáry zaoblí roh |
| skica počátek x y z normála nx ny nz [osax …] | skica na obecné rovině |
| díra D skrz [obousměrně] … · díra D … směr vx vy vz · díra D … sklon 13,5 · díra D skrz v x y z v x y z | díra skrz jen ve směru vrtání / na obě strany · šikmá díra · více děr naráz |
| rotovat [úhel] [odebrat\|přidat\|průnik\|nové] | rotace s booleovským režimem (vysoustružení profilu) |
| těleso 2 · rozdělit XY odsazení 10 jako Spodek · kopie těleso 2 posun 0 0 30 · sloučit 1 2 odebrat | více těles v dílu; „… nové těleso Název“ a „… těleso 2“ u prvků |
| prvek <typ\|rozšíření> klíč=hodnota … | kterýkoli typ prvku i prvek rozšíření bez JSON, např. prvek adv.twist sketch=$last height=30 angle=45 |
| normálie M8x30 · vložit "Hřídel" v 0 0 10 ukotvit · výkres | díl z knihovny · komponenta sestavy z otevřené záložky · výkres dokumentu |
| stav · smazat poslední · zobraz iso | zpětná vazba a správa; stav prvku ✓ / ⚠ / ✗ se vypíše až po výpočtu (u delších prvků s časem), řádek Geometrie říká, zda je výsledek platné těleso |
| { … } / [ … ] | JSON: celý dokument .mncad, pole prvků nebo jeden prvek – všech 36 typů prvků včetně ploch, plechu, sestav; jeden prvek na jednom řádku lze míchat s textovými příkazy (např. tažení po šroubovici) |

### Příklad: příruba DN50 sedmi řádky

nový díl Příruba DN50 · skica XY: kružnice 165 · vysunout 18 · trubka 88 61 30 v 0 0 18 · díra 18 skrz v 62,5 0 · pole kruhové 4 · srazit 1,5. Protokol pak vrátí rozměry 165 × 165 × 48 mm a objem – agent si ověří shodu s výkresem bez obrázku.

### JSON a JavaScript API

- JSON dokumentu (formát .mncad) dává přístup ke všem typům prvků a sestavám; id a name lze vynechat, sketchId: "$last" odkazuje na poslední skicu. Vložit ho lze do konzole, přes Soubor → Otevřít nebo přetažením.
- Vstup se zpracuje po řádcích: řádek s JSON prvku může stát kdekoli, i jako první. Protokol je v pořadí řádků vstupu a stav dokumentu se vypíše jednou na konci.
- Během výpočtu vrací window.mncad.progress() počítaný prvek a čas, window.mncad.cancel() výpočet zruší (dokument zůstane beze změny).
- window.mncad pro skripty a rozšíření: run(text), getDocument(), setDocument(json), status(), drawingStatus(), perf() (časy kroků načítání), guide(), commands(), openConsole(), exportFile("step") (soubor jako base64 bez dialogu) – pro Playwright, Selenium nebo Claude in Chrome. Kdo chce i z nabídek ukládat bez dialogu, zapne v Nastavení → Soubory přímé stažení pod výchozím názvem.
- Úplný návod se schématem (TypeScript typy přímo ze zdrojového kódu): /cad/schema-pro-ai.md – stačí ho dát agentovi do zadání (tlačítko „Kopírovat návod pro AI“ v konzoli). Odkaz je i v llms.txt webu.
- Modelování myší jako člověk: Nápověda → „Popisky pro výběr myší“ (Ctrl+Shift+L) zobrazí na viditelných plochách, hranách a vrcholech štítky F1 / E2 / V3 (ve skice P1… a O v počátku). Štítek leží přesně na entitě a nepřijímá kliknutí – klik na jeho střed je klik na entitu. Agent, který ovládá prohlížeč, tak klikne na „plochu s normálou +Z“ bez trefování pixelů; člověku se bez zapnutí nic nemění.
- Všechny prvky stránky mají textové popisky (title / aria-label) a historie prvků je textový seznam, takže agent, který čte stránku místo obrázku, se orientuje. Nic z toho neodesílá data mimo prohlížeč – ochrana dokumentace platí beze změny.

> Doporučený postup pro agenta: otevřít /cad → Nápověda → Textové příkazy → vložit příkazy → Provést → přečíst protokol a stav → opravit řádky ✗ → export STEP / výkres / sdílení odkazem.

### Skica, vazby a výkres textem

- Entity zadané textem dostávají ve skice id e1, e2… (protokol i stav je vypíší se souřadnicemi). Odkazy: e3 celá entita, e3.a / e3.b konce, e3.střed, e3.p1 bod lomené čáry, počátek.
- vazba kolmo e1 e2, vazba shodně e1.a počátek, kóta délka e1 80, kóta průměr e2 Ø20 (řídicí; referenční jen měří). Po každém řádku se skica vyřeší a protokol napíše Plně určeno / Nedourčeno (N st. volnosti) / Přeurčeno.
- skica plocha F6: … (číslo jako u popisků Ctrl+Shift+L, nebo horní, +X), odsazení N, obráceně; skica rovina "Rovina 1": … na pomocné rovině.
- Výkres: výkres A3 …, kótovat, výkres tolerance Ø40 h6, výkres stav / window.mncad.drawingStatus(). Návod pro AI obsahuje pravidla kótování a tři vzorové příklady (hřídel, příruba, deska).
- Podle předlohy vždy kontrola 1:1: návod pro AI ukládá agentům před modelováním vypsat všechny kóty předlohy, chybějící kótu nevymýšlet, ale zeptat se (odhadnout z měřítka, nebo ji někdo doplní), a na konci porovnat model a výkres s předlohou kótu po kótě a plochu po ploše a odhady vypsat v závěrečné zprávě.

## 22. Omezení a poctivé srovnání s desktopovými CADy

Cílem je plnohodnotný CAD pro díly, sestavy a výkresy v prohlížeči. Zde je, kde dnes stojíme vůči ZW3D, SolidWorks, Inventor, Fusion 360 a Onshape.

| Oblast | Mnástrojárna CAD | Desktopová špička |
| --- | --- | --- |
| Skica | číselné zadání u kurzoru, 13 vazeb + 8 kót, automatické vazby, stav určenosti, ořez / odsazení / projekce | srovnatelné; navíc spline s tečnami, bloky, vazba poměru |
| Zadání prvků | 14 voleb bodu, 8 směrů, 12 rovin, 10 os, 8 ukončení vysunutí | srovnatelné |
| Tvarové prvky | vysunutí, rotace, tažení, šablonování, díry, zaoblení 6 variant, sražení 5, pole 5 druhů, skořepina, úkos, žebro, přímé úpravy | navíc setback zaoblení, eliptické zaoblení, úkos s dělicí křivkou, variabilní pole z tabulky |
| Plochy | 19 příkazů | více nástrojů pro třídu A (křivostní návaznost, úprava řídicích bodů) |
| Plech / svařence | 12 / 10 příkazů, rozvin DXF, kusovník řezů | navíc formovací nástroje, křížové zlomy, konfigurátory profilů |
| Sestavy | komponenty, podsestavy, 7 druhů vazeb, kolize, kusovník, rozložený pohled, rám formy | 18 druhů vazeb vč. mechanických (ozubení, vačka, šroub), pohybové studie |
| Výkresy | 7 pohledů, řez, detail, kóty, drsnosti, GD&T, tabulka děr, kusovník, PDF / DXF / DWG / SVG | navíc pomocné, zalomené a částečné řezy, přerušené pohledy, tolerance uložení, revizní tabulky |
| Formáty | STEP, IGES, BREP, STL, 3MF, OBJ, glTF, PLY, OFF, DXF, DWG | navíc nativní formáty konkurence (přes překladače) |
| Knihovna | 103 rodin normálií textem | větší katalogy (Toolbox, Content Center), výrobci |
| Výkon | díly a sestavy desítek až stovek komponent v prohlížeči | velké sestavy tisíců dílů |
| Cena a instalace | zdarma, bez instalace, data v prohlížeči | licence v řádu desítek až stovek tisíc Kč ročně |

Známá omezení: setback a skutečně asymetrické (eliptické) zaoblení, dělicí křivka a stupňovitý úkos, periodický (hladký) uzavřený loft a spline s tečnami nejsou k dispozici – jádro OpenCascade je nenabízí nebo vyžadují vlastní konstrukci. Okrajové podmínky šablonování se aproximují pomocným řezem. Výkresy z DWG byly ověřeny zápisem a zpětným čtením; u exotických verzí AutoCADu doporučujeme kontrolu. Plán dalšího vývoje (vazby sestav, další druhy pohledů výkresu) je veřejný v souboru CAD-ROADMAP.

## 23. Vaše data a soukromí

- Modelování, výpočty i export probíhají ve vašem prohlížeči; soubory se na server neodesílají. Výjimkou je tlačítko Poptat výrobu, které připraví e-mail – odesíláte ho sami.
- Výchozí režim „neukládat“ (NDA): modely, výkresy ani jejich názvy se do prohlížeče neukládají. Rozpracovaná práce existuje jen v otevřené kartě a v souborech, které si uložíte do svého počítače tlačítkem Uložit (kam a pod jakým názvem si vyberete). Po zavření karty v prohlížeči nic nezůstane; při zavírání s neuloženými změnami prohlížeč varuje. Dokumenty uložené staršími verzemi programu se při prvním spuštění smažou.
- Volitelné šifrované úložiště: kdo chce mít nedávné soubory a obnovu rozpracované práce, zapne v Nastavení → Soubory úložiště s heslem. Data se ukládají zašifrovaně (AES-GCM 256, klíč z hesla přes PBKDF2) jen v tomto prohlížeči na tomto počítači – bez hesla je nepřečte ani jiný uživatel téhož PC. Odemčení platí do zavření karty; „Vypnout a smazat uložené“ vše odstraní.
- Nastavení programu (jednotky, myš, zkratky, formát listu) se ukládá nešifrovaně – neobsahuje žádná data z dokumentů.
- Anonymní statistika použití (otevření aplikace, typ prvku) neobsahuje geometrii ani názvy souborů. Podrobnosti v zásadách ochrany osobních údajů na webu.

## 24. Slovníček pojmů

| Pojem | Význam |
| --- | --- |
| Prvek (feature) | jeden krok historie modelu – skica, vysunutí, díra… – s parametry, které lze kdykoli změnit. |
| Skica | 2D profil na rovině tvořený úsečkami, oblouky, kružnicemi… s vazbami a kótami. |
| Vazba | geometrický vztah (vodorovně, tečně, soustředně…) nebo vztah mezi komponentami sestavy. |
| Kóta řídicí / referenční | řídicí mění geometrii, referenční jen zobrazuje hodnotu. |
| Plně určená skica | všechny entity mají nulové stupně volnosti – geometrie je jednoznačná. |
| Booleovská operace | Přidat (sjednocení), Odebrat (rozdíl), Průnik; Nové těleso = bez sloučení. |
| Odkaz (reference) | vazba parametru na geometrii (vrchol, hrana, plocha, rovina) místo pevného čísla; s otiskem přežije změny historie. |
| Pomocná geometrie | rovina, osa, bod, souřadný systém bez hmoty – slouží jako odkaz. |
| Tenká stěna | profil se nevysune jako plný, ale jako stěna dané tloušťky. |
| Rozvin | plechový díl rozložený do roviny s čarami ohybů. |
| Kusovník (BOM) | seznam položek sestavy s počty, materiálem a hmotností. |
| STEP | neutrální přesný formát pro výměnu 3D modelů mezi CADy (ISO 10303). |
| OCCT | OpenCascade Technology – otevřené geometrické jádro, na kterém Mnástrojárna CAD běží. |

## 25. Historie verzí

| Vlna | Obsah |
| --- | --- |
| 1.–2. (2026) | jádro OCCT v prohlížeči, skica s řešičem vazeb, základní prvky, výkresy PDF/DXF, sestavy, rám formy, proměnné a stavy, import/export |
| 3. | plochy (19), plech (12), svařence (10), pokročilé modelování, knihovna 103 rodin, výkresy s anotacemi a DWG, vazby sestav, formařské analýzy, nastavení a zkratky |
| 4. | výběr entit a inspektor, měření mezi entitami, kontextové nabídky, gizmo, barvy ploch, podsestavy, SEO a výkon webu |
| 5. (listopad 2026) | referenční systém zadání (ukončení, směry, roviny, osy, odkazy s otiskem), 6 + 5 variant zaoblení a sražení, 5 druhů pole, tažení a šablonování s vodicími křivkami, pomocná osa / bod / souřadný systém, výběr ze seznamu, číselné zadání a automatické vazby ve skice, mini lišta, dotykové ovládání, tato dokumentace |
| 5. – zpětná vazba z testu 3. 11. 2026 (III) | náběh závitu jako u závitového kalibru (vybroušený hřbet prvního závitu, plynule do plného profilu); pás karet: větší písmo tlačítek a výrazné názvy skupin (Skica, Tvar, Primitiva, Kreslení, Vazby, Kóty…) |
| 5. – zpětná vazba z testu 3. 11. 2026 (II) | poctivý stav prvku: po každém prvku kontrola objemu/topologie a platnosti geometrie (⚠ „prvek těleso nezměnil“, „neplatná geometrie“, ✗ skořepina beze změny), řádek Geometrie ve stavu, protokol agenta s výsledkem až po výpočtu; závity s jemným stoupáním (M18×1,5), vnitřní závit v díře (prvek Závit i tažení po šroubovici se stranou a náběhem); tažení po spline jako hladká B-spline (forma zůstane solidem); kusovník s označením materiálu a číslem dílu, balónky uvnitř rámu, stav sestavy a kolize v textovém stavu; žádná ztráta rychlých změn ve formuláři ani formátu výkresu; kontrola kót pro rotační díly; poznámka v patičce jen na vyžádání |
| 6. (12. 11. 2026) – test na výkresu oběžného kola a analýza nástrojů | díra skrz jen ve směru vrtání (+ volba oběma směry), průběh výpočtu po prvcích a tlačítko Zrušit, desetkrát rychlejší jádro u dílů s mnoha rotačními plochami a mezipaměť stavby, JSON na prvním řádku konzole; více těles v dílu (Rozdělit, Kopie, Sloučit, Nové těleso); textové příkazy pro všechny prvky (příkaz prvek, oblouk, spline, zaoblení rohu, šikmá díra, tělesa, normálie, vložit, výkres); výběr hran a ploch ze seznamu a pravidlem; vlastní dotaz na hodnotu místo systémového okna; rovina a bod odkazem u prvků rozšíření; vazby sestav ze seznamu ploch; kóty výkresu podle geometrie; dotyk ve skice a nastavitelné zkratky skici; samozhušťovací pás karet |
| 7. (13. 11. 2026) – dokončení testu oběžného kola a analýzy | skica z klávesnice (pevné body, Ctrl+V seznamu souřadnic, živý spline), podklad obrázek/PDF s kalibrací a převodem vektorového PDF na entity; výkres: otočení pohledu, řez bez změny formátu, poloviční řez, více modelů na listu, rychlejší promítání, chytré kóty podle prvků (řetězové kóty, popisy děr ↧ ⌴ ⌵, závity) a textové příkazy výkresu; porovnání s referenčním STEP s mapou odchylek; vazby a kóty skici textem, skica na ploše; otisky vybraných hran a ploch, díra K tělesu; směr a osa odkazem u prvků rozšíření, skryté duplicitní prvky; náhled bez WebGL, řez číslem, rovinou z plochy a obecnou normálou; velké sestavy STEP v lehkém režimu, hláška o úspěchu až po zobrazení modelu |
| 5. – dodatky (listopad 2026) | sdílení odkazem (WhatsApp, e-mail, Teams; platnost 1–90 dní, heslo, šifrované úložiště pro velké modely), ochrana dokumentace (NDA): bez ukládání do prohlížeče / šifrované úložiště s heslem, záložky více dokumentů (díly, sestavy, výkresy) i na mobilu, dokumentace a příručka PDF v hlavním menu webu a v Nápovědě programu |

## Časté otázky

**Je Mnástrojárna CAD opravdu zdarma a bez registrace?**

Ano. Otevřete mnastrojarna.cz/cad a modelujete. Žádný účet, žádná instalace, žádné omezení počtu dílů. Provozuje ho nástrojárna Mnástrojárna s.r.o.; výdělek máme z výroby dílů, kterou si u nás můžete rovnou poptat, ale nemusíte.

**Umí otevřít soubory ze SolidWorks, Inventoru nebo ZW3D?**

Přímo nativní formáty (SLDPRT, IPT, Z3…) otevřít nelze – jsou uzavřené. Program vám u každého z nich ukáže, jak soubor ve zdrojovém CADu uložit jako STEP; STEP, IGES a BREP otevře s přesnou geometrií a lze na ně navazovat dalšími prvky (díry, zaoblení, přímé úpravy).

**Jak udělám výrobní výkres do PDF nebo DWG?**

Pás Výkres → Nový výkres. Zvolte pohledy a formát listu, doplňte kóty, drsnosti a tolerance tažením, případně řez a detail, a stiskněte PDF, DXF nebo DWG. U sestavy se přidá kusovník s pozicemi.

**Zvládne sestavy a velké rámy forem?**

Ano – komponenty, podsestavy, vazby, kolize, kusovník, rozložený pohled a průvodce rámem vstřikovací formy s normáliemi. Komfortně zvládá sestavy o desítkách až stovkách komponent; výkon závisí na vašem počítači.

**Jak vložím šroub M8×30 nebo profil IPE 200?**

Stiskněte Ctrl+L a napište „ISO 4762 M8x30“ nebo „IPE 200 1500“. Knihovna má 103 rodin normálií (šrouby, matice, podložky, kolíky, ložiska, ozubená a řetězová kola, řemenice, profily, pružiny, normálie forem, lineární technika, pneumatika, potrubí).

**Je rozhraní i v angličtině nebo němčině?**

Ano. Anglická verze běží na mnastrojarna.cz/en/cad, německá na mnastrojarna.cz/de/cad; přepnout lze také v Nastavení → Jazyk rozhraní (volba se pamatuje v prohlížeči). Přeložené jsou pás karet, formuláře, hlášky jádra, knihovna normálií, razítko výkresu i textové příkazy – konzole rozumí příkazům česky, anglicky i německy (např. „box 100 60 12“, „quader 100 60 12“). Dokumentace je zatím česky; stránky /en/cad/documentation a /de/cad/dokumentation shrnují ovládání.

**Funguje na mobilu a tabletu?**

Ano. Nabídky a formuláře se na telefonu otevírají jako spodní listy, model otáčíte prstem, dlouhý stisk nahrazuje pravé tlačítko. Pro delší práci doporučujeme počítač nebo tablet s klávesnicí.

**Funguje offline?**

Po prvním načtení běží výpočty i export lokálně v prohlížeči. Pro načtení aplikace a knihovny písem je potřeba připojení; rozpracovanou práci si ukládejte do souboru (ve výchozím režimu se v prohlížeči nic neuchovává).

**Kde jsou moje soubory uložené? Uvidí je někdo jiný?**

Jen tam, kam si je sami uložíte (.mncad, STEP, PDF…). Ve výchozím režimu CAD do prohlížeče nic neukládá – po zavření karty rozpracovaná práce zmizí, takže dokumentaci pod NDA neuvidí nikdo další ani na sdíleném počítači. Kdo chce obnovu práce a nedávné soubory, zapne šifrované úložiště s heslem; bez hesla jsou data nečitelná. Na server nic neposíláme – s výjimkou e-mailu, který sami odešlete tlačítkem Poptat výrobu.

**Co znamená, že odkazy „přežijí změnu historie“?**

Když vyberete plochu nebo hranu jako cíl (např. vysunutí k ploše), program si uloží její otisk – typ, střed, velikost. Změníte-li dřívější prvek a plochy se přečíslují, odkaz se znovu najde podle otisku a prvek se nerozbije.

**Jak zadám délku a úhel úsečky číslem?**

Ve skice stiskněte l, klikněte na první bod a začněte psát: 50, Tab, 30, Enter – vznikne úsečka 50 mm pod 30° i s kótou (je-li zapnuto Kótovat při kreslení). Fungují také zápisy 50<30, x;y a @dx;dy.

**Umí plechové díly a rozvin?**

Ano – záložka Plech: základní plech, ohyby z hrany, lemy, ohyb podle čáry, výřezy, rohové úlevy, prolisy; Rozvinout a export rozvinu do DXF/SVG, tabulka ohybů.

**Lze CAD použít komerčně a pro výuku?**

Ano, bez omezení. Výstupy (STEP, PDF, DXF, DWG) jsou vaše. Školy a kroužky vítáme – dokumentace a program jsou kompletně česky.

**Jak poptám výrobu dílu?**

Tlačítkem Poptat výrobu v titulní liště: připraví se STEP aktuálního dílu a e-mail s předvyplněným předmětem. Vyrábíme prototypy, náhradní díly do jednoúčelových strojů, nástroje a přípravky, typicky 1–99 ks, včetně konsignace.

**Co dělat, když prvek zčervená s chybou?**

Klikněte na prvek v historii – pod ním je česká hláška, co je špatně (např. příliš velký poloměr zaoblení, otevřený profil skici, cílová plocha za rovinou skici). Upravte parametr nebo výběr; ostatní prvky se přestaví automaticky.

**Jak pošlu díl kolegovi nebo zákazníkovi, aby se na něj jen podíval?**

Tlačítko Sdílet (horní lišta) → Kopírovat odkaz, nebo rovnou WhatsApp / E-mail. Příjemce odkaz otevře v prohlížeči bez instalace – vidí snímek dílu, sestavy i výkresů, může měřit, řezat a uložit si kopii. Platnost nastavíte na 1–90 dní (výchozí 10), volitelně s heslem. Dokument je uložený jen v odkazu (část za #, kterou prohlížeč neposílá na server); velké importované modely jdou do šifrovaného úložiště nebo jako příloha .mncad/STEP.

**Program hlásí „3D okno nelze spustit“ – co s tím?**

Prohlížeč neposkytl WebGL (grafickou akceleraci), kterou 3D zobrazení potřebuje. Zapněte v prohlížeči grafickou akceleraci (Chrome/Edge: Nastavení → Systém; Firefox: Výkon) a restartujte ho, nepracujte přes vzdálenou plochu či virtuální stroj, aktualizujte ovladač grafiky, případně zkuste jiný prohlížeč nebo zařízení. Zbytek programu (nabídky, soubory, 2D skica, výkresy) funguje dál; tlačítko Zkopírovat diagnostiku připraví pro podporu údaje o prostředí bez dat dokumentu.

**Může CAD ovládat AI agent (ChatGPT Agent, Claude) nebo skript?**

Ano. Nápověda → Textové příkazy (Ctrl+Shift+K): příkazy jako „kvádr 100 60 20“, „díra 8,5 skrz v 20 30“, „zaoblit 2 hrany svislé“ nebo rovnou JSON dokumentu; protokol vrátí ✓/✗ s důvodem a textový stav dokumentu (rozměry, objem, prvky), takže agent nepotřebuje číst obrázek. Pro skripty je k dispozici window.mncad (run, getDocument, setDocument, status). Návod a úplné schéma: /cad/schema-pro-ai.md. Pro člověka se nic nemění.

**Proč výkres neuvádí ISO 2768 ani sražení hran? Dříve tam byly.**

Výrobní požadavky jsou konkrétní technické údaje, které by na výkres neměly přijít bez vědomí konstruktéra. Výkres proto standardně uvádí jen „Rozměry v mm“; nepředepsané tolerance (např. ISO 2768-mK) a opracování hran (např. srazit 0,5×45°) vyplníte v razítku – každé zvlášť, kdykoli lze smazat. Tlačítko „Doplnit obvyklé“ je vyplní jedním klikem.

**Jak dostanu do razítka materiál jako „ČSN 11 423“, když v nabídce je jen Ocel, Nerez…?**

Nabídka Materiál určuje třídu (hustotu) pro hmotnost. Pod ní je pole „Označení materiálu (razítko)“ – volný text, který se uloží do dokumentu, přenese sdíleným odkazem i souborem .mncad a zobrazí v razítku výkresu. Stejné pole je přímo v razítku výkresu. Textový příkaz „materiál ČSN 11 423“ dělá totéž a protokol napíše, podle které třídy se počítá hustota.

**Prvek je zelený, ale model se nezměnil / STEP se nedá uložit. Proč?**

To už nenastává: po každém prvku program porovná objem a topologii tělesa a zkontroluje platnost geometrie (BRepCheck). Prvek, který těleso nezměnil (nástroj mimo těleso), nebo jehož výsledek má sebeprotínající plochy, dostane oranžové ⚠ s vysvětlením v historii, ve formuláři i ve stavovém řádku; operace, kterou jádro neprovede (např. skořepina přes zaoblené plochy), skončí červeně a těleso zůstane. Stav dokumentu (konzole „stav“) má řádek Geometrie: platná / neplatná / bez objemového tělesa.

**Jak udělám jemný závit M18×1,5 nebo závit v díře?**

Prvek Závit přijímá hrubé i jemné stoupání (nabídka nebo text „M18×1,5“); zaškrtnutí Vnitřní závit (v díře) ho umístí do díry (kružnice jádra se pak kótuje M18×1,5). Díra se závitem má stejnou nabídku a jádro dopočítá. Skutečnou šroubovici dá Plochy → Tažení po šroubovici: profil Závit 60°, volba Vnější (na válci) / Vnitřní (v díře), poloměr = povrch, kde závit začíná, hloubka jde do materiálu; Náběh (otáček) vybrousí hřbet prvního závitu jako u závitového kalibru – od začátku až na dno drážky, během zadaných otáček se zvedá do plného profilu. Na výkrese se modelované závity kreslí zjednodušeně podle ISO 6410 – hladký válec / díra s označením M18×1,5 (přesná projekce šroubovice by trvala minuty); ve STEP je skutečná šroubovice.

**Stačí automatické kótování pro výrobní výkres?**

Ne – „Auto + Ø“ je pomocný základ (celkové rozměry, průměry děr, závity). Funkční kóty, tolerance (H8, g6, ±0,1) a drsnosti doplní konstruktér – tolerance z geometrie odvodit nelze. Tlačítko „Kontrola kót“ ve výkresu porovná kóty na listu s historií prvků (u rotačních dílů průměry a délky osazení, závity, drážky, zaoblení; délka průchozího řezu se nenabízí) a vypíše, co chybí; toleranci zapíšete u kóty do pole „přípona“. Poznámka „Nekótované rozměry dle 3D modelu“ se na výkres nedoplňuje sama – zapnete ji v razítku (Poznámka v patičce).
