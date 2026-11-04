/**
 * Návod pro AI agenty a automatizaci (Markdown). Bez importů – čte ho i Node skript (scripts/cad-docs-text.mjs),
 * který z něj vyrábí public/cad/schema-pro-ai.md a doplňuje odkaz do llms.txt. Stejný text nabízí konzole
 * „Textové příkazy“ tlačítkem „Zkopírovat návod pro AI“.
 */
export const AGENT_GUIDE = `# Mnástrojárna CAD – rozhraní pro AI agenty a automatizaci

Mnástrojárna CAD (https://www.mnastrojarna.cz/cad) je parametrický 3D/2D CAD v prohlížeči. Kromě myši ho lze
kompletně ovládat **textem** – to je určeno pro AI agenty (ChatGPT Agent, Claude, vlastní skripty) i pro lidi, kteří
raději píší. Vše, co jde udělat myší, jde udělat textem; textem navíc jde zadat i to, co by vyžadovalo přesné klikání
do 3D okna (výběr hran a ploch pravidlem).

## Tři cesty, jak CAD ovládat textem

1. **Konzole „Textové příkazy“ v programu** – nabídka Nápověda → Textové příkazy (klávesa Ctrl+Shift+K, nebo paleta
   Ctrl+K → „text“). Do textového pole se vloží příkazy nebo JSON, tlačítko **Provést** (Ctrl+Enter) je vykoná.
   Pod polem je **protokol**: každý řádek ✓ / ✗ s důvodem, a textový **stav dokumentu** (rozměry, objem, prvky,
   chyby). Agent tedy dostane zpětnou vazbu jako text, bez nutnosti číst obrázek.
2. **JSON dokumentu** – celý díl jako JSON (formát souboru .mncad) vložený do konzole, otevřený přes Soubor →
   Otevřít, nebo přetažený do okna. Dává přístup ke **všem 36 typům prvků** včetně těch, které nemají textový příkaz
   (tažení, šablonování, úkos, plochy, plech, sestavy…).
3. **JavaScript API \`window.mncad\`** (pro Playwright, Selenium, rozšíření prohlížeče, Claude in Chrome…):
   \`await window.mncad.run(text)\` provede příkazy / JSON a vrátí protokol; \`window.mncad.getDocument()\` vrátí
   dokument; \`await window.mncad.setDocument(docOrJson)\` ho nahradí; \`await window.mncad.status()\` vrátí stav
   jako text; \`window.mncad.guide()\` vrátí tento návod; \`window.mncad.commands()\` seznam příkazů;
   \`window.mncad.openConsole()\` otevře konzoli; \`await window.mncad.exportFile("step")\` (step, stl, brep, obj, glb,
   3mf, wrl, mncad) vrátí \`{ name, mime, bytes, base64 }\` **bez dialogu** – pro agenty a skripty, které potřebují soubor.

Všechny rozměry jsou v **milimetrech**, úhly ve stupních, desetinná čárka i tečka jsou povolené, „Ø“ před číslem
se ignoruje. Souřadný systém: Z nahoru, XY je půdorys. Počátek je v rohu kvádru (bez „střed“) nebo ve středu válce.

## Řádkové příkazy (česky i anglicky, jeden příkaz na řádek, \`#\` = komentář)

| Příkaz | Význam |
| --- | --- |
| \`nový díl [název]\` / \`nová sestava [název]\` | nový dokument v nové záložce |
| \`název …\`, \`materiál …\`, \`barva #hex\` | popis dokumentu |
| \`kvádr X Y Z [střed] [v x y z] [odebrat]\` | kvádr; roh v počátku, „střed“ = vystředit |
| \`válec D H [osa X|Y|Z] [v x y z] [odebrat]\` | válec průměr × výška, osa Z |
| \`koule D [v x y z]\` · \`kužel D1 D2 H\` · \`trubka D d H\` | další primitiva (průměry) |
| \`skica XY|XZ|YZ [odsazení N]: entita; entita…\` | skica; entity i na dalších řádcích |
| \`obdélník W H [v x y]\` / \`obdélník W H roh x y\` | obdélník středem (výchozí počátek) nebo rohem |
| \`kružnice D [v x y]\` / \`kružnice poloměr r\` | kružnice |
| \`mnohoúhelník N D [v x y]\` · \`drážka L W [úhel a]\` · \`úsečka x1 y1 x2 y2\` · \`čára x1 y1 x2 y2 … [uzavřít]\` · \`bod x y\` · \`elipsa rx ry\` | další entity; předpona \`pomocná\` = konstrukční |
| \`vysunout H [symetricky] [skrz] [odebrat|přidat|průnik|nové] [obráceně] [úkos a]\` | vysune poslední skicu |
| \`rotovat [úhel] [osa X|Y|Z]\` | orotuje poslední skicu (výchozí osa Y skici, 360°) |
| \`díra D [hloubka H|skrz] v x y [z] [osa Z] [zahloubení D2 H2] [kuželové D2] [závit M8]\` | bez z = díra začíná na povrchu tělesa v daném místě (zjistí se ze sítě modelu) a vrtá dolů; \`závit M6\` vrtá jádro |
| \`zaoblit R [hrany vše|horní|spodní|svislé|vodorovné|kruhové|rovné|+Z|-Z|+X|-X|+Y|-Y] [poloměr N] [delší N] [kratší N]\` | pravidla lze kombinovat: \`hrany horní kruhové\` |
| \`srazit C [hrany …]\` | sražení hran, stejná pravidla |
| \`skořepina T [otevřít +Z|horní|boční|největší]\` | vydlabání; otevřené plochy pravidlem |
| \`pole N rozteč P [směr X|Y|Z] [N2 rozteč P2 směr Y]\` · \`pole kruhové N [úhel 360] [osa Z] [v cx cy cz]\` | pole posledního prvku |
| \`zrcadlit XY|XZ|YZ [odsazení N]\` | zrcadlení tělesa |
| \`text "ABC" výška H hloubka D v x y [z] [gravírovat]\` | nápis vystouplý / gravírovaný |
| \`smazat poslední\` · \`stav\` · \`zobraz iso|přední|horní…\` | správa |

Booleovský režim: první tvarový prvek vytvoří těleso, další se **přidávají**; \`odebrat\` odečte, \`průnik\` ponechá
průnik, \`nové\` založí další samostatné těleso. Pravidla hran/ploch se vyhodnocují na aktuálním tělese (před
příkazem) – pořadí příkazů je tedy důležité.

### Příklad – příruba DN50 (6 řádků)

\`\`\`
nový díl Příruba DN50
skica XY: kružnice 165
vysunout 18
trubka 88 61 30 v 0 0 18
díra 18 skrz v 62,5 0
pole kruhové 4
srazit 1,5
\`\`\`

### Příklad – deska s drážkou a zahloubenými dírami

\`\`\`
kvádr 120 80 15 název Deska
skica XY odsazení 15: drážka 60 12 v 60 40
vysunout 8 odebrat obráceně
díra 8,5 skrz v 15 15 zahloubení 15 9
pole 2 rozteč 90 směr X 2 rozteč 50 směr Y
zaoblit 3 hrany svislé
srazit 0,5 hrany horní
stav
\`\`\`

## JSON (formát .mncad) – přístup ke všemu

Dokument je JSON objekt:

\`\`\`json
{ "app": "mnastrojarna-cad", "version": 2, "name": "Deska", "material": "ocel",
  "features": [
    { "type": "sketch", "plane": { "kind": "base", "name": "XY", "offset": 0 },
      "entities": [ { "type": "rect", "cx": 50, "cy": 25, "w": 100, "h": 50, "r": 0, "angle": 0 } ] },
    { "type": "extrude", "sketchId": "$last", "distance": 20, "symmetric": false, "reverse": false, "mode": "new" },
    { "type": "hole", "position": [30, 25, 20], "axis": "Z", "flip": false, "diameter": 18, "depth": 0, "cbDiameter": 0, "cbDepth": 0 }
  ] }
\`\`\`

- \`id\` a \`name\` prvků lze vynechat (doplní se); \`sketchId\` / \`featureId\` může být \`"$last"\` (poslední skica /
  prvek) nebo id dřívějšího prvku. Pole \`[ {…}, {…} ]\` nebo jeden objekt \`{ "type": … }\` se **připojí** k otevřenému
  dokumentu; objekt s \`"app": "mnastrojarna-cad"\` otevře **nový** dokument.
- Materiál: \`ocel\`, \`nerez\`, \`hlinik\`, \`mosaz\`, \`med\`, \`plast\`, \`titan\`, \`litina\`, \`bronz\` (viz nabídka
  Materiál v programu).
- Typy prvků (\`type\`): sketch, extrude, revolve, box, cylinder, sphere, cone, tube, hole, fillet, chamfer, shell,
  pattern (linear | circular | curve | sketch | fill), mirror, import, sweep, loft, draft, split, transform, datum, text,
  pushPull, deleteFace, offsetFace, rib, spring, thicken, thread, ext, combine, splitBodies, copyBody, datumAxis,
  datumPoint, csys. Přesná pole každého typu jsou v příloze **Úplné schéma** níže (TypeScript typy přímo ze
  zdrojového kódu – ty jsou vždy platné).
- Odkazy na geometrii (\`Ref\`): \`{ "kind": "xyz", "p": [x,y,z] }\`, \`{ "kind": "face" | "edge" | "vertex", "index": n }\`,
  \`{ "kind": "sketchPt", "sketchId": "…", "entityId": "…", "k": "center" }\`, odvozené body (\`derived\`: mid, between,
  offset, project, intersect, percent). Indexy ploch/hran získáte z textového stavu (\`stav\`) nebo zkouškou –
  pro agenty je jednodušší použít textové příkazy s pravidly (\`hrany svislé\`, \`otevřít +Z\`).
- Sestava: \`"kind": "assembly"\`, \`"components": [ { "name": "Díl", "source": { "kind": "part", "doc": { …dokument dílu… } },
  "placement": { "position": [0,0,0], "rotation": [0,0,0] } } ]\`, vazby \`"mates"\`.

## Modelování myší jako člověk (pro agenty s ovládáním prohlížeče)

Kdo chce CAD ovládat jako uživatel – klikat na pás karet, kreslit skicu, vybírat plochy a hrany – nemusí trefovat
pixely v 3D okně:

1. **Popisky pro výběr** (Nápověda → „Popisky pro výběr myší“, **Ctrl+Shift+L**, nebo \`window.mncad.hints(true)\`):
   na viditelných plochách, hranách a vrcholech se zobrazí štítky **F1, E2, V3**. Štítek leží přesně na entitě a
   nepřijímá kliknutí – **klik na střed štítku = klik na entitu** (stejná cesta jako myš, včetně Ctrl pro přidání
   k výběru). Štítek má v \`title\` popis (rovinná / zakřivená plocha, normála +Z, svislá úsečka, délka, souřadnice
   vrcholu), takže lze vybírat podle významu („plocha s normálou +Z“). \`window.mncad.hints()\` vrátí seznam
   štítků se souřadnicemi, \`window.mncad.clickHint("F3")\` na štítek klikne za vás.
2. Ve **skice** jsou při zapnutých popiscích štítky **P1, P2…** na koncových bodech, středech a rozích entit a **O**
   v počátku; kurzor má v levém dolním rohu souřadnice X · Y. Rozměry lze vždy zadat číselně: po prvním kliku
   napište \`60 Tab 40 Enter\`.
3. Pás karet, nabídky a formuláře prvků jsou běžné prvky stránky s názvy (title / aria-label). Formulář prvku má
   pole s popisky, \`Enter\` = OK, \`Esc\` = Storno. Stavový řádek dole říká, co je vybráno a co příkaz očekává.
4. Po každém kroku lze stav ověřit textem (\`stav\` v konzoli nebo \`window.mncad.status()\`) – není nutné číst
   obrázek.

## Materiál, výkres a export – co je dobré vědět

- \`materiál ocel|nerez|hliník|mosaz|měď|plast|titan|litina|bronz\` nastaví **třídu materiálu (hustotu)** pro hmotnost.
  Jakýkoli jiný text (\`materiál ČSN 11 423\`, \`materiál 1.0503\`) se uloží jako **označení materiálu do razítka**
  a hustota zůstává podle třídy – protokol to vždy napíše. V JSON jsou to pole \`material\` (id třídy) a \`materialName\`.
- Výkres **nedoplňuje žádné výrobní požadavky sám**: nepředepsané tolerance (např. ISO 2768-mK) a opracování hran
  (např. srazit 0,5×45°) se na list dostanou jen vyplněním polí v razítku (každé zvlášť, lze smazat). Výchozí text je
  jen „Rozměry v mm“.
- Závitové díry (\`díra 5 závit M6 hloubka 12\`) se na výkrese kótují jako \`M6 hl. 12\` (s počtem), ne jako Ø jádra.
- Automatické kóty („Auto + Ø“) jsou pomocný základ. Tlačítko **Kontrola kót** ve výkresu porovná kóty na listu
  s historií prvků a vypíše, co chybí (Ø, závity, drážky, zaoblení…); tolerance (H8, ±0,1) se píší u kóty do pole
  „přípona“.
- Ukládání a export se standardně ptají na místo a název (systémový dialog – pro agenta „blokující“). V Nastavení →
  Soubory lze zapnout **přímé stažení pod výchozím názvem**; pro skripty je nejjednodušší \`window.mncad.exportFile()\`.

## Stav prvku: ✓ / ⚠ / ✗ – co znamená

- Výsledek prvku se v protokolu vypíše **až po výpočtu** (řádek „→ … přidán“ jen potvrzuje zařazení do historie).
- **✓** = výsledek je platné objemové těleso a operace se projevila (objem nebo topologie se změnily).
- **⚠** = prvek se zpracoval, ale výsledek si žádá pozornost: *„Prvek těleso nezměnil“* (nástroj leží mimo těleso
  nebo se s ním nepřekrývá – zkontrolujte polohu, poloměr, stranu) nebo *„Výsledek má neplatnou geometrii“*
  (sebeprotínající plochy – typicky profil tečný k povrchu; export STEP pak může selhat). V historii je prvek
  oranžový, ve stavovém řádku je čip „prvek s upozorněním“ / „neplatná geometrie“.
- **✗** = operace selhala, těleso zůstalo jako před prvkem (např. skořepina, kterou jádro neumí, tažení bez objemu).
- Řádek **Geometrie:** ve \`stav\` říká „platná · 1 těleso“, nebo „NEPLATNÁ“ / „ŽÁDNÉ objemové těleso (jen plochy)“.
  Pokles objemu ani „1 těleso“ samy o sobě správnost nedokazují – rozhoduje tento řádek a nepřítomnost ⚠.

## Závity – jak je zadat správně

- Katalogový závit: \`závit M18×1,5 délka 20 v 0 0 10 [osa Z] [vnitřní] [modelovat]\` – hrubé i jemné stoupání
  (M18×1,5, M10×1,25; jiné stoupání se dopočítá). Bez \`modelovat\` je kosmetický: geometrie se nemění, na výkrese
  se kružnice válce (nebo jádra díry u \`vnitřní\`) kótuje označením. S \`modelovat\` vzniknou zjednodušené drážky.
- Díra se závitem: \`díra 5 závit M18×1,5 hloubka 20 v x y\` – jádro (Ø16,5) se dopočítá z označení.
- Skutečná šroubovice (Plochy → Tažení po šroubovici, JSON \`{"type":"ext","ext":"surf.helixSweep","data":{…}}\`):
  \`profile: "thread60"\`, \`side: "internal"\` pro závit **v díře** (poloměr = poloměr díry / jádra, hloubka jde
  do stěny) nebo \`"external"\` pro závit **na válci** (poloměr = poloměr válce), \`pitch\`, \`turns\`, \`mode: "cut"\`,
  volitelně \`leadIn\` (náběh: během prvních N otáček hloubka roste od nuly – odstraní ostrý neúplný začátek).
  Příklad matice M18×1,5 s jádrem Ø16,4: \`radius: 8.2, depth: 0.8, pitch: 1.5, turns: 12, side: "internal"\`.
  JSON prvku na jednom řádku lze míchat s textovými příkazy (\`trubka 42 16,4 30\`, další řádek \`{"type":"ext",…}\`, \`stav\`).
  Špička profilu nesmí být tečná k povrchu (např. radius 9 + depth 0,8 u díry Ø16,4) – takový výsledek je ⚠.
- Na **výkrese** se modelované závity kreslí zjednodušeně (ISO 6410): hladký válec / díra s označením „M18×1,5 dl. 18“;
  skutečná šroubovice je jen v 3D a ve STEP (přesná projekce šroubovice by trvala minuty).

## Zpětná vazba a doporučený postup pro agenta

1. Otevřete https://www.mnastrojarna.cz/cad, zavřete úvodní obrazovku (Pokračovat v práci / Esc).
2. Nápověda → Textové příkazy (Ctrl+Shift+K). Vložte příkazy, Provést.
3. Přečtěte protokol: řádky ✗ mají důvod (např. „žádná hrana neodpovídá pravidlu“, „Hloubka díry musí být
   kladná“). Opravte a spusťte znovu jen opravené řádky – příkazy se **připojují** k dokumentu; \`smazat poslední\`
   vrátí poslední prvek.
4. \`stav\` vrátí rozměry (X/Y/Z rozsah), objem, řádek Geometrie (platná / neplatná / bez tělesa), počet ploch a hran
   a seznam prvků se stavem ✓ / ⚠ / ✗ – podle toho ověřte, že model odpovídá výkresu (např. 165 × 165 × 48 mm).
   U sestavy přibude řádek Sestava (komponenty, obálka, objem, hmotnost) a Kolize (\`kolize\` spustí kontrolu).
5. Výstupy: Soubor → Export 3D (STEP, STL…), Výkres → PDF/DXF/DWG, Sdílet odkazem (odkaz pro lidi), Uložit
   projekt (.mncad). Tyto akce otevírají systémový dialog uložení – to je jediné místo, kde je potřeba klik.

Historie prvků v levém panelu, formuláře, nabídky i pás karet mají textové popisky (title/aria-label), takže
fungují i s čtečkou stránky. Konzole má textové pole s popiskem „Textové příkazy nebo JSON“ a výstup s popiskem
„Protokol“ (\`data-agent-output\`).

## Omezení

- Pravidla hran/ploch pracují s polohou vůči obálce tělesa (horní = nejvyšší Z apod.) a s typem křivky; u složitých
  tvarů raději zadejte geometrii tak, aby pravidla byla jednoznačná, nebo použijte JSON s indexy.
- Konzole nepřistupuje k souborům na disku (bezpečnost prohlížeče) – import STEP udělá člověk přetažením souboru.
- Dokumentace pro lidi: https://www.mnastrojarna.cz/cad/dokumentace (PDF: /cad/mnastrojarna-cad-prirucka.pdf).
`;
