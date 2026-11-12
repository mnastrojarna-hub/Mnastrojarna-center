# Mnástrojárna CAD – rozhraní pro AI agenty a automatizaci

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
3. **JavaScript API `window.mncad`** (pro Playwright, Selenium, rozšíření prohlížeče, Claude in Chrome…):
   `await window.mncad.run(text)` provede příkazy / JSON a vrátí protokol; `window.mncad.getDocument()` vrátí
   dokument; `await window.mncad.setDocument(docOrJson)` ho nahradí; `await window.mncad.status()` vrátí stav
   jako text; `window.mncad.guide()` vrátí tento návod; `window.mncad.commands()` seznam příkazů;
   `window.mncad.openConsole()` otevře konzoli; `await window.mncad.exportFile("step")` (step, stl, brep, obj, glb,
   3mf, wrl, mncad) vrátí `{ name, mime, bytes, base64 }` **bez dialogu** – pro agenty a skripty, které potřebují soubor;
   `window.mncad.progress()` vrátí průběh běžícího výpočtu (`{ label, index, total, name, seconds }` nebo `null`) a
   `window.mncad.cancel()` ho zruší (dokument zůstane ve stavu před výpočtem).

Všechny rozměry jsou v **milimetrech**, úhly ve stupních, desetinná čárka i tečka jsou povolené, „Ø“ před číslem
se ignoruje. Souřadný systém: Z nahoru, XY je půdorys. Počátek je v rohu kvádru (bez „střed“) nebo ve středu válce.

## Řádkové příkazy (česky i anglicky, jeden příkaz na řádek, `#` = komentář)

| Příkaz | Význam |
| --- | --- |
| `nový díl [název]` / `nová sestava [název]` | nový dokument v nové záložce |
| `název …`, `materiál …`, `barva #hex` | popis dokumentu |
| `kvádr X Y Z [střed] [v x y z] [odebrat]` | kvádr; roh v počátku, „střed“ = vystředit |
| `válec D H [osa X|Y|Z] [v x y z] [odebrat]` | válec průměr × výška, osa Z |
| `koule D [v x y z]` · `kužel D1 D2 H` · `trubka D d H` | další primitiva (průměry) |
| `skica XY|XZ|YZ [odsazení N]: entita; entita…` | skica na základní rovině; entity i na dalších řádcích |
| `skica počátek x y z normála nx ny nz [osax ux uy uz]: …` | skica na obecné rovině (viz „Souřadnice skici ve 3D“) |
| `obdélník W H [v x y]` / `obdélník W H roh x y` | obdélník středem (výchozí počátek) nebo rohem |
| `kružnice D [v x y]` / `kružnice poloměr r` | kružnice |
| `mnohoúhelník N D [v x y]` · `drážka L W [úhel a]` · `úsečka x1 y1 x2 y2` · `bod x y` · `elipsa rx ry` | další entity; předpona `pomocná` = konstrukční |
| `čára x1 y1 x2 y2 [r N] x3 y3 … [uzavřít]` | lomená čára; `r N` za bodem zaoblí tento roh poloměrem N (vzniknou úsečky a tečné oblouky) |
| `oblouk x1 y1 xm ym x2 y2` | oblouk třemi body: začátek, bod na oblouku, konec |
| `spline x1 y1 x2 y2 x3 y3 … [uzavřít]` | hladká křivka přes zadané body |
| `vysunout H [symetricky] [skrz] [odebrat|přidat|průnik|nové] [obráceně] [úkos a]` | vysune poslední skicu |
| `rotovat [úhel] [osa X|Y|Z] [odebrat|přidat|průnik|nové]` | orotuje poslední skicu (výchozí osa Y skici, 360°); `odebrat` = vysoustružit profil z tělesa |
| `díra D [hloubka H|skrz [obousměrně]] v x y [z] [osa Z] [zahloubení D2 H2] [kuželové D2] [závit M8]` | bez z = díra začíná na povrchu tělesa v daném místě (zjistí se ze sítě modelu) a vrtá dolů; `skrz` vrtá **od zadaného bodu jen ve směru vrtání** (materiál nad bodem zůstane), `obousměrně` na obě strany; `závit M6` vrtá jádro |
| `díra D … směr vx vy vz` · `díra D … sklon úhel [směr +X]` | šikmá díra: `směr` = směr vrtání vektorem; `sklon` = odklon od osy díry (výchozí k +X u osy Z) |
| `díra D skrz v x1 y1 z1 v x2 y2 z2 …` | více děr jedním příkazem (každá poloha třemi souřadnicemi) |
| `zaoblit R [hrany vše|horní|spodní|svislé|vodorovné|kruhové|rovné|+Z|-Z|+X|-X|+Y|-Y] [poloměr N] [delší N] [kratší N]` | pravidla lze kombinovat: `hrany horní kruhové` |
| `srazit C [hrany …]` | sražení hran, stejná pravidla |
| `skořepina T [otevřít +Z|horní|boční|největší]` | vydlabání; otevřené plochy pravidlem |
| `pole N rozteč P [směr X|Y|Z] [N2 rozteč P2 směr Y]` · `pole kruhové N [úhel 360] [osa Z] [v cx cy cz]` | pole posledního prvku |
| `zrcadlit XY|XZ|YZ [odsazení N]` | zrcadlení tělesa |
| `text "ABC" výška H hloubka D v x y [z] [gravírovat]` | nápis vystouplý / gravírovaný |
| `těleso N` · `rozdělit XY|XZ|YZ [odsazení N] [jako Název]` · `kopie [těleso N] [posun dx dy dz] [jako Název]` · `sloučit <cíl> <nástroj> [odebrat|průnik] [ponechat]` | více těles v dílu (viz níže) |
| `prvek <typ|rozšíření> klíč=hodnota …` | kterýkoli typ prvku i prvek rozšíření bez JSON (viz níže) |
| `normálie <označení> [v x y z]` | díl z knihovny (M8x30, ložisko 6204, pero 8x7x40): v dílu nová záložka, v sestavě komponenta |
| `vložit "název záložky" [v x y z] [otočení rx ry rz] [ukotvit]` | sestava: vloží díl z otevřené záložky jako komponentu |
| `výkres` | otevře výkres otevřeného dokumentu v záložce |
| `smazat poslední` · `stav` · `zobraz iso|přední|horní…` · `kolize` | správa; kolize = kontrola průniků komponent sestavy |

Booleovský režim: první tvarový prvek vytvoří těleso, další se **přidávají**; `odebrat` odečte, `průnik` ponechá
průnik, `nové` založí další samostatné těleso. Pravidla hran/ploch se vyhodnocují na aktuálním tělese (před
příkazem) – pořadí příkazů je tedy důležité. Stejné příkazy fungují anglicky (box, hole, arc, spline, body, combine,
feature…) a německy (quader, bohrung, bogen, körper, kombinieren, element…); seznam vypíše hláška o neznámém příkazu.

### Vstup: řádky a JSON lze míchat

Vstup se zpracuje **po řádcích**. Řádek, který je celý JSON (`{ … }` nebo `[ … ]`), přidá prvek nebo prvky a může
stát kdekoli – i jako první řádek, za kterým následují textové příkazy. Jako jeden JSON se vstup bere jen tehdy, když
se tak dá přečíst celý (dokument .mncad, pole prvků, JSON rozepsaný na více řádků). Protokol je v pořadí řádků
vstupu, stav dokumentu se vypíše jednou na konci (`stav` uprostřed vstupu vypíše stav v tom okamžiku).

### Souřadnice skici ve 3D

Bod skici `(u; v)` leží ve 3D v bodě `počátek + u·X_skici + v·Y_skici`, kde `Y_skici = normála × X_skici`:

| Rovina | počátek | X skici | Y skici | normála (směr vysunutí) | bod (u; v) ve 3D |
| --- | --- | --- | --- | --- | --- |
| `XY` [odsazení d] | (0; 0; d) | +X | +Y | +Z | (u; v; d) |
| `XZ` [odsazení d] | (0; −d; 0) | +X | +Z | −Y | (u; −d; v) |
| `YZ` [odsazení d] | (d; 0; 0) | +Y | +Z | +X | (d; u; v) |
| obecná: `počátek o`, `normála n`, `osax x` | o | x (kolmo na n) | n × x | n | o + u·x + v·(n × x) |

- `rotovat` otáčí kolem osy **Y skici** procházející počátkem skici (`osa X` = kolem osy X skici). U skici v rovině
  XZ je tedy osou rotace osa **Z** modelu a souřadnice `u` profilu je poloměr – tak se kreslí soustružené díly
  (profil `skica XZ: čára r1 z1 r2 z2 … uzavřít`, pak `rotovat`).
- `vysunout H` jde ve směru normály (u roviny XZ směrem −Y), `obráceně` opačně, `symetricky` na obě strany.
- U obecné roviny se bez `osax` zvolí X skici kolmo na normálu co nejblíž ose X modelu (u normály ±X ose Y). V JSON je
  to `"plane": { "kind": "custom", "origin": [x,y,z], "normal": [nx,ny,nz], "xDir": [ux,uy,uz] }`.

### Více těles v dílu

Díl má vždy jedno **aktivní těleso**, se kterým pracují prvky, a libovolný počet dalších těles (výchozí názvy
„Těleso 1“, „Těleso 2“…; v příkazech stačí číslo).

- `válec 30 40 v 50 30 20 nové těleso Čep` – prvek s `nové` založí další těleso (název je volitelný) a to se stane aktivním.
- `těleso 1` – další prvky pracují s Tělesem 1; `díra 8 skrz v 20 30 20 těleso 1` – jen tento prvek.
- `rozdělit XY odsazení 10 jako Spodek` – rovina rozdělí aktivní těleso; strana ve směru normály zůstane, opačná je nové těleso.
- `kopie těleso Spodek posun 0 0 -30 jako Kopie` – další těleso jako posunutá kopie.
- `sloučit 1 Čep [odebrat|průnik] [ponechat]` – sjednotí (odečte, pronikne) nástrojové těleso do cílového; `ponechat` nástroj nezruší.
- `stav` vypíše řádek `Tělesa:` s názvy, objemy a označením aktivního. V JSON jsou to prvky `splitBodies`, `copyBody`,
  `combine`, pole `body` u prvku (cílové těleso) a `"mode": "new"` s novým názvem v `body` (nové těleso).

### Obecný příkaz `prvek` – všechny typy bez JSON

`prvek <typ> klíč=hodnota klíč=hodnota …` vytvoří prvek kteréhokoli typu (sweep, loft, draft, transform, datum, rib,
spring…) i prvek rozšíření (`prvek sheet.bend …`, `prvek "Zkrut" …` – id nebo popisek z pásu karet).

- Klíče jsou pole prvku ze schématu níže; u rozšíření klíč parametru nebo jeho český popisek. `název="…"` pojmenuje prvek.
- Hodnoty: číslo (`12,5`), `ano` / `ne`, seznam `10;0;5`, text v uvozovkách, JSON (`planeDef={"kind":"base","name":"XY","offset":12}`).
- Skici a prvky se zadávají názvem (`profileId="Skica 1"`) nebo `$last`; plochy a hrany čísly (`faces=1;4;5`) nebo
  pravidlem (`faces=boční`, `edges=horní;kruhové`).
- Neznámý klíč nebo typ skončí chybou s výčtem platných – tak lze parametry zjistit.

```
skica XY: obdélník 20 20
prvek adv.twist sketch=$last height=30 angle=45
prvek chamfer distance=1 edges=horní;rovné
```

### Průběh a zrušení výpočtu

Během delšího výpočtu ukazuje program u spodního okraje „Počítám prvek k/n: název · čas“ s tlačítkem **Zrušit**; totéž
vrací `window.mncad.progress()` a `window.mncad.cancel()`. Zrušený běh konzole dokument nezmění. Po výpočtu je
v protokolu u delších prvků čas (`✓ Pole 1 (pattern) · 7,9 s`) a celkový čas. Jádro si pamatuje stav po prvcích:
další příkaz přidaný na konec historie přepočítá jen nový prvek.

### Příklad – příruba DN50 (6 řádků)

```
nový díl Příruba DN50
skica XY: kružnice 165
vysunout 18
trubka 88 61 30 v 0 0 18
díra 18 skrz v 62,5 0
pole kruhové 4
srazit 1,5
```

### Příklad – deska s drážkou a zahloubenými dírami

```
kvádr 120 80 15 název Deska
skica XY odsazení 15: drážka 60 12 v 60 40
vysunout 8 odebrat obráceně
díra 8,5 skrz v 15 15 zahloubení 15 9
pole 2 rozteč 90 směr X 2 rozteč 50 směr Y
zaoblit 3 hrany svislé
srazit 0,5 hrany horní
stav
```

## JSON (formát .mncad) – přístup ke všemu

Dokument je JSON objekt:

```json
{ "app": "mnastrojarna-cad", "version": 2, "name": "Deska", "material": "ocel",
  "features": [
    { "type": "sketch", "plane": { "kind": "base", "name": "XY", "offset": 0 },
      "entities": [ { "type": "rect", "cx": 50, "cy": 25, "w": 100, "h": 50, "r": 0, "angle": 0 } ] },
    { "type": "extrude", "sketchId": "$last", "distance": 20, "symmetric": false, "reverse": false, "mode": "new" },
    { "type": "hole", "position": [30, 25, 20], "axis": "Z", "flip": false, "diameter": 18, "depth": 0, "cbDiameter": 0, "cbDepth": 0 }
  ] }
```

- `id` a `name` prvků lze vynechat (doplní se); `sketchId` / `featureId` může být `"$last"` (poslední skica /
  prvek) nebo id dřívějšího prvku. Pole `[ {…}, {…} ]` nebo jeden objekt `{ "type": … }` se **připojí** k otevřenému
  dokumentu; objekt s `"app": "mnastrojarna-cad"` otevře **nový** dokument.
- Materiál: `ocel`, `nerez`, `hlinik`, `mosaz`, `med`, `plast`, `titan`, `litina`, `bronz` (viz nabídka
  Materiál v programu).
- Typy prvků (`type`): sketch, extrude, revolve, box, cylinder, sphere, cone, tube, hole, fillet, chamfer, shell,
  pattern (linear | circular | curve | sketch | fill), mirror, import, sweep, loft, draft, split, transform, datum, text,
  pushPull, deleteFace, offsetFace, rib, spring, thicken, thread, ext, combine, splitBodies, copyBody, datumAxis,
  datumPoint, csys. Přesná pole každého typu jsou v příloze **Úplné schéma** níže (TypeScript typy přímo ze
  zdrojového kódu – ty jsou vždy platné).
- Odkazy na geometrii (`Ref`): `{ "kind": "xyz", "p": [x,y,z] }`, `{ "kind": "face" | "edge" | "vertex", "index": n }`,
  `{ "kind": "sketchPt", "sketchId": "…", "entityId": "…", "k": "center" }`, odvozené body (`derived`: mid, between,
  offset, project, intersect, percent). Indexy ploch/hran získáte z textového stavu (`stav`) nebo zkouškou –
  pro agenty je jednodušší použít textové příkazy s pravidly (`hrany svislé`, `otevřít +Z`).
- Sestava: `"kind": "assembly"`, `"components": [ { "name": "Díl", "source": { "kind": "part", "doc": { …dokument dílu… } },
  "placement": { "position": [0,0,0], "rotation": [0,0,0] } } ]`, vazby `"mates"`.

## Modelování myší jako člověk (pro agenty s ovládáním prohlížeče)

Kdo chce CAD ovládat jako uživatel – klikat na pás karet, kreslit skicu, vybírat plochy a hrany – nemusí trefovat
pixely v 3D okně:

1. **Popisky pro výběr** (Nápověda → „Popisky pro výběr myší“, **Ctrl+Shift+L**, nebo `window.mncad.hints(true)`):
   na viditelných plochách, hranách a vrcholech se zobrazí štítky **F1, E2, V3**. Štítek leží přesně na entitě a
   nepřijímá kliknutí – **klik na střed štítku = klik na entitu** (stejná cesta jako myš, včetně Ctrl pro přidání
   k výběru). Štítek má v `title` popis (rovinná / zakřivená plocha, normála +Z, svislá úsečka, délka, souřadnice
   vrcholu), takže lze vybírat podle významu („plocha s normálou +Z“). `window.mncad.hints()` vrátí seznam
   štítků se souřadnicemi, `window.mncad.clickHint("F3")` na štítek klikne za vás.
2. Ve **skice** jsou při zapnutých popiscích štítky **P1, P2…** na koncových bodech, středech a rozích entit a **O**
   v počátku; kurzor má v levém dolním rohu souřadnice X · Y. Rozměry lze vždy zadat číselně: po prvním kliku
   napište `60 Tab 40 Enter`.
3. Pás karet, nabídky a formuláře prvků jsou běžné prvky stránky s názvy (title / aria-label). Formulář prvku má
   pole s popisky, `Enter` = OK, `Esc` = Storno. Stavový řádek dole říká, co je vybráno a co příkaz očekává.
4. Po každém kroku lze stav ověřit textem (`stav` v konzoli nebo `window.mncad.status()`) – není nutné číst
   obrázek.

## Materiál, výkres a export – co je dobré vědět

- `materiál ocel|nerez|hliník|mosaz|měď|plast|titan|litina|bronz` nastaví **třídu materiálu (hustotu)** pro hmotnost.
  Jakýkoli jiný text (`materiál ČSN 11 423`, `materiál 1.0503`) se uloží jako **označení materiálu do razítka**
  a hustota zůstává podle třídy – protokol to vždy napíše. V JSON jsou to pole `material` (id třídy) a `materialName`.
- Výkres **nedoplňuje žádné výrobní požadavky sám**: nepředepsané tolerance (např. ISO 2768-mK) a opracování hran
  (např. srazit 0,5×45°) se na list dostanou jen vyplněním polí v razítku (každé zvlášť, lze smazat). Výchozí text je
  jen „Rozměry v mm“.
- Závitové díry (`díra 5 závit M6 hloubka 12`) se na výkrese kótují jako `M6 hl. 12` (s počtem), ne jako Ø jádra.
- Automatické kóty („Auto + Ø“) jsou pomocný základ. Tlačítko **Kontrola kót** ve výkresu porovná kóty na listu
  s historií prvků a vypíše, co chybí (Ø, závity, drážky, zaoblení…); tolerance (H8, ±0,1) se píší u kóty do pole
  „přípona“.
- Ukládání a export se standardně ptají na místo a název (systémový dialog – pro agenta „blokující“). V Nastavení →
  Soubory lze zapnout **přímé stažení pod výchozím názvem**; pro skripty je nejjednodušší `window.mncad.exportFile()`.

## Stav prvku: ✓ / ⚠ / ✗ – co znamená

- Výsledek prvku se v protokolu vypíše **až po výpočtu** (řádek „→ … přidán“ jen potvrzuje zařazení do historie).
- **✓** = výsledek je platné objemové těleso a operace se projevila (objem nebo topologie se změnily).
- **⚠** = prvek se zpracoval, ale výsledek si žádá pozornost: *„Prvek těleso nezměnil“* (nástroj leží mimo těleso
  nebo se s ním nepřekrývá – zkontrolujte polohu, poloměr, stranu) nebo *„Výsledek má neplatnou geometrii“*
  (sebeprotínající plochy – typicky profil tečný k povrchu; export STEP pak může selhat). V historii je prvek
  oranžový, ve stavovém řádku je čip „prvek s upozorněním“ / „neplatná geometrie“.
- **✗** = operace selhala, těleso zůstalo jako před prvkem (např. skořepina, kterou jádro neumí, tažení bez objemu).
- Řádek **Geometrie:** ve `stav` říká „platná · 1 těleso“, nebo „NEPLATNÁ“ / „ŽÁDNÉ objemové těleso (jen plochy)“.
  Pokles objemu ani „1 těleso“ samy o sobě správnost nedokazují – rozhoduje tento řádek a nepřítomnost ⚠.

## Závity – jak je zadat správně

- Katalogový závit: `závit M18×1,5 délka 20 v 0 0 10 [osa Z] [vnitřní] [modelovat]` – hrubé i jemné stoupání
  (M18×1,5, M10×1,25; jiné stoupání se dopočítá). Bez `modelovat` je kosmetický: geometrie se nemění, na výkrese
  se kružnice válce (nebo jádra díry u `vnitřní`) kótuje označením. S `modelovat` vzniknou zjednodušené drážky.
- Díra se závitem: `díra 5 závit M18×1,5 hloubka 20 v x y` – jádro (Ø16,5) se dopočítá z označení.
- Skutečná šroubovice (Plochy → Tažení po šroubovici, JSON `{"type":"ext","ext":"surf.helixSweep","data":{…}}`):
  `profile: "thread60"`, `side: "internal"` pro závit **v díře** (poloměr = poloměr díry / jádra, hloubka jde
  do stěny) nebo `"external"` pro závit **na válci** (poloměr = poloměr válce), `pitch`, `turns`, `mode: "cut"`,
  volitelně `leadIn` (náběh jako u závitového kalibru: hřbet prvního závitu je od začátku vybroušený až na dno drážky
  a během N otáček se zvedá do plného profilu – drážka sama je plná od začátku).
  Příklad matice M18×1,5 s jádrem Ø16,4: `radius: 8.2, depth: 0.8, pitch: 1.5, turns: 12, side: "internal"`.
  JSON prvku na jednom řádku lze míchat s textovými příkazy (`trubka 42 16,4 30`, další řádek `{"type":"ext",…}`, `stav`).
  Špička profilu nesmí být tečná k povrchu (např. radius 9 + depth 0,8 u díry Ø16,4) – takový výsledek je ⚠.
- Na **výkrese** se modelované závity kreslí zjednodušeně (ISO 6410): hladký válec / díra s označením „M18×1,5 dl. 18“;
  skutečná šroubovice je jen v 3D a ve STEP (přesná projekce šroubovice by trvala minuty).

## Zpětná vazba a doporučený postup pro agenta

1. Otevřete https://www.mnastrojarna.cz/cad, zavřete úvodní obrazovku (Pokračovat v práci / Esc).
2. Nápověda → Textové příkazy (Ctrl+Shift+K). Vložte příkazy, Provést.
3. Přečtěte protokol: řádky ✗ mají důvod (např. „žádná hrana neodpovídá pravidlu“, „Hloubka díry musí být
   kladná“). Opravte a spusťte znovu jen opravené řádky – příkazy se **připojují** k dokumentu; `smazat poslední`
   vrátí poslední prvek.
4. `stav` vrátí rozměry (X/Y/Z rozsah), objem, řádek Geometrie (platná / neplatná / bez tělesa), počet ploch a hran
   a seznam prvků se stavem ✓ / ⚠ / ✗ – podle toho ověřte, že model odpovídá výkresu (např. 165 × 165 × 48 mm).
   U sestavy přibude řádek Sestava (komponenty, obálka, objem, hmotnost) a Kolize (`kolize` spustí kontrolu).
5. Výstupy: Soubor → Export 3D (STEP, STL…), Výkres → PDF/DXF/DWG, Sdílet odkazem (odkaz pro lidi), Uložit
   projekt (.mncad). Tyto akce otevírají systémový dialog uložení – to je jediné místo, kde je potřeba klik.

Historie prvků v levém panelu, formuláře, nabídky i pás karet mají textové popisky (title/aria-label), takže
fungují i s čtečkou stránky. Konzole má textové pole s popiskem „Textové příkazy nebo JSON“ a výstup s popiskem
„Protokol“ (`data-agent-output`).

## Omezení

- Pravidla hran/ploch pracují s polohou vůči obálce tělesa (horní = nejvyšší Z apod.) a s typem křivky; u složitých
  tvarů raději zadejte geometrii tak, aby pravidla byla jednoznačná, nebo použijte JSON s indexy.
- Konzole nepřistupuje k souborům na disku (bezpečnost prohlížeče) – import STEP udělá člověk přetažením souboru.
- Dokumentace pro lidi: https://www.mnastrojarna.cz/cad/dokumentace (PDF: /cad/mnastrojarna-cad-prirucka.pdf).

## Úplné schéma (TypeScript typy ze zdrojového kódu)

Dokument `.mncad` je `CadDoc`; `features` je pole `Feature`. Volitelná pole lze vynechat.

```ts
export type Vec2 = [number, number];
export type Vec3 = [number, number, number];

export type PlaneName = "XY" | "XZ" | "YZ";
/** Rovina skici: základní rovina s odsazením, nebo obecná rovina (např. z plochy modelu). */
export type SketchPlane =
  | { kind: "base"; name: PlaneName; offset: number }
  | { kind: "custom"; origin: Vec3; normal: Vec3; xDir: Vec3; label?: string };

import { tr } from "./i18n";
import type { AxisDef, Direction, Extent, PlaneDef, Ref, StartFrom, Thin } from "./refs";
export type { AxisDef, Direction, Extent, PlaneDef, Ref, StartFrom, Thin } from "./refs";

/** Ukončení díry. */
export type HoleEnd =
  | { kind: "blind" }
  | { kind: "throughAll" }
  | { kind: "toNext" }
  | { kind: "toFace"; ref: Ref; offset?: number }
  /** dno v úrovni bodu (vrchol, střed hrany, bod skici…) měřeno podél osy díry */
  | { kind: "toVertex"; ref: Ref }
  /** dno ve vzdálenosti `d` před plochou (totéž co „k ploše“ s odsazením – stejný zápis jako u vysunutí) */
  | { kind: "offsetFromFace"; ref: Ref; d: number };
/** Řada průchozích děr ISO 273 (jemná / střední / hrubá). */
export type HoleFit = "fine" | "medium" | "coarse";

/** Entita skici. `construction` = pomocná geometrie (nevytváří profil). */
export type SketchEntity = { construction?: boolean } & (
  | { id: string; type: "rect"; cx: number; cy: number; w: number; h: number; r: number; angle: number }
  | { id: string; type: "circle"; cx: number; cy: number; r: number }
  | { id: string; type: "polygon"; cx: number; cy: number; r: number; sides: number; angle: number }
  | { id: string; type: "slot"; cx: number; cy: number; length: number; width: number; angle: number }
  | { id: string; type: "polyline"; points: Vec2[]; closed: boolean }
  | { id: string; type: "arc"; a: Vec2; b: Vec2; c: Vec2 } // oblouk třemi body (a → c přes b)
  | { id: string; type: "line"; a: Vec2; b: Vec2 }
  | { id: string; type: "point"; p: Vec2 }
  | { id: string; type: "ellipse"; cx: number; cy: number; rx: number; ry: number; angle: number }
  /** hladká křivka (interpolační spline přes body) */
  | { id: string; type: "spline"; points: Vec2[]; closed: boolean }
);

/** Odkaz na charakteristický bod/část entity skici: „a“, „b“, „c“ (konce/body), „center“, „p3“ (bod lomené čáry), „self“ (celá entita). */
export type SketchRef = { e: string; k: string };

/** Geometrická vazba ve skice (řeší ji numerický řešič). */
export type SketchConstraint = {
  id: string;
  type: "horizontal" | "vertical" | "coincident" | "parallel" | "perpendicular" | "tangent" | "equal" | "fixed" | "concentric" | "midpoint" | "pointOnCurve" | "symmetric" | "collinear";
  refs: SketchRef[];
  /** cílové hodnoty u vazby „fixed“ (souřadnice bodu nebo parametry entity) */
  value?: number[];
};

/** Kóta ve skice. Řídicí (driving) kóta mění geometrii, referenční jen ukazuje hodnotu. */
export type SketchDim = {
  id: string;
  type: "distance" | "horizontal" | "vertical" | "radius" | "diameter" | "angle" | "length" | "arcLength";
  refs: SketchRef[];
  value: number;
  driving: boolean;
  /** posun popisku kóty od geometrie (mm ve skice) */
  offset?: Vec2;
};

export type BoolMode = "new" | "add" | "cut" | "intersect";
export type Axis = "X" | "Y" | "Z";

/** Typ díry (jako průvodce dírou v ZW3D/Inventoru). */
export type HoleKind = "simple" | "counterbore" | "countersink" | "tapped";

/** Formáty, které jádro umí načíst jako těleso (ostatní se před uložením převedou na STL). */
export type KernelImportFormat = "step" | "brep" | "stl";
/** Formáty 3D exportu. */
export type ExportFormat = "step" | "stl" | "brep" | "obj" | "glb" | "3mf" | "wrl";

/** Cílové těleso prvku (`body`): název tělesa v dílu; chybí-li, použije se aktivní (naposledy vytvořené/upravené) těleso. */
export type Feature = { id: string; name: string; suppressed?: boolean; body?: string } & (
  /** `planeDef` = asociativní definice roviny (15 způsobů); `plane` je její poslední vyřešená podoba (pro UI a stavbu bez tělesa). */
  | { type: "sketch"; plane: SketchPlane; entities: SketchEntity[]; constraints?: SketchConstraint[]; dims?: SketchDim[]; planeDef?: PlaneDef }
  /**
   * Vysunutí. Ukončení `extent` (slepé / skrz vše / k dalšímu / k vrcholu / k ploše / odsazeně / k tělesu / střední rovina),
   * nezávislý druhý směr `extent2`, začátek `from`, směr `dir`, tenká stěna `thin`, kroucení `twist` (°), změna měřítka na konci
   * `endScale` (ZW3D smrštit/rozšířit), `outerOnly` = ignorovat otvory profilu. Starší pole `distance/symmetric` platí, když `extent` chybí.
   */
  | { type: "extrude"; sketchId: string; distance: number; symmetric: boolean; reverse: boolean; mode: BoolMode; draftAngle?: number; extent?: Extent; extent2?: Extent; from?: StartFrom; dir?: Direction; thin?: Thin; twist?: number; endScale?: number; outerOnly?: boolean }
  /** Rotace. Osa `axisDef` (8 způsobů; starší `axis` = osa skici), druhý směr `angle2`, `symmetric` (střední rovina), tenká stěna. */
  | { type: "revolve"; sketchId: string; angle: number; axis: "x" | "y"; mode: BoolMode; axisDef?: AxisDef; angle2?: number; symmetric?: boolean; thin?: Thin }
  /** Primitiva: `positionRef` = poloha odkazem (má přednost před `position`), `dirDef` = osa libovolným směrem (má přednost před `axis`). */
  | { type: "box"; size: Vec3; position: Vec3; centered: boolean; mode: BoolMode; positionRef?: Ref; dirDef?: Direction }
  | { type: "cylinder"; radius: number; height: number; position: Vec3; axis: Axis; mode: BoolMode; positionRef?: Ref; dirDef?: Direction }
  | { type: "sphere"; radius: number; position: Vec3; mode: BoolMode; positionRef?: Ref }
  | { type: "cone"; radius1: number; radius2: number; height: number; position: Vec3; axis: Axis; mode: BoolMode; positionRef?: Ref; dirDef?: Direction }
  | { type: "tube"; outer: number; inner: number; height: number; position: Vec3; axis: Axis; mode: BoolMode; positionRef?: Ref; dirDef?: Direction }
  | {
      type: "hole";
      position: Vec3;
      axis: Axis;
      flip: boolean;
      diameter: number;
      depth: number; // 0 = skrz
      /** díra „skrz“ vrtá od zadaného bodu jen ve směru vrtání; `bothWays` = oběma směry (skrz celé těleso) */
      bothWays?: boolean;
      cbDiameter: number; // 0 = bez zahloubení
      cbDepth: number;
      /** výchozí "simple" (nebo "counterbore", pokud cbDiameter > 0) */
      kind?: HoleKind;
      /** kuželové zahloubení: průměr a vrcholový úhel (90°) */
      csDiameter?: number;
      csAngle?: number;
      /** závit, např. "M8" (u kind = "tapped" se vrtá jádrový průměr) */
      thread?: string;
      threadDepth?: number;
      /** ukončení (chybí-li: depth > 0 = slepá, jinak skrz) */
      end?: HoleEnd;
      /** více poloh naráz (odkazy na vrcholy, středy kružnic, body skici…); chybí-li, platí `position` */
      points?: Ref[];
      /** osa díry libovolným směrem (chybí-li, platí `axis`) */
      dirDef?: Direction;
      /** úhel špičky vrtáku (°), výchozí 118 */
      tipAngle?: number;
      /** řada ISO 273 pro průchozí díru (informativní – průměr se dopočítá v UI) */
      fit?: HoleFit;
    }
  /** Zaoblení: `kind` konstantní / asymetrické (r2) / proměnné (radii: poloměr podle indexu hrany) / plocha–plocha / plné; `tangentChain` = šířit po tečných hranách. */
  | { type: "fillet"; radius: number; edges: number[] | "all"; kind?: "constant" | "asymmetric" | "variable" | "faceFace" | "fullRound"; r2?: number; radii?: Record<string, number>; radii2?: Record<string, number>; faces?: number[]; faces2?: number[]; faceRefs?: Ref[]; faceRefs2?: Ref[]; faceRefsMid?: Ref[]; tangentChain?: boolean; setback?: number }
  /** Zkosení: stejné vzdálenosti / dvě vzdálenosti (d2 + referenční plocha) / vzdálenost + úhel / vrchol (3 vzdálenosti). */
  | { type: "chamfer"; distance: number; edges: number[] | "all"; kind?: "equal" | "twoDistances" | "distanceAngle" | "vertex"; d2?: number; d3?: number; angle?: number; faceRef?: Ref; vertices?: number[]; vertexRefs?: Ref[]; tangentChain?: boolean }
  /** Skořepina: `thicknesses` = jiná tloušťka pro vybrané plochy (index → mm), `outward` = zesílit ven. */
  | { type: "shell"; thickness: number; faces: number[]; thicknesses?: Record<string, number>; outward?: boolean }
  | {
      type: "pattern";
      featureId: string;
      kind: "linear";
      count: number;
      spacing: number;
      direction: Vec3;
      /** druhý směr (mřížka) */
      count2?: number;
      spacing2?: number;
      direction2?: Vec3;
      /** směr podle hrany / osy / dvou bodů (má přednost před `direction`) */
      dirDef?: Direction;
      dirDef2?: Direction;
      /** přeskočené instance (index a*count2+b) */
      skip?: number[];
      /** rozteč jako celková délka „až k referenci“ (místo kroku) */
      spacingMode?: "step" | "total";
      /** střídavé řady (každá druhá řada posunutá o půl kroku) */
      stagger?: boolean;
      /** opakovat jen zdrojové těleso (bez booleovské operace) – rychlejší náhled */
      geometryOnly?: boolean;
      /** více zdrojových prvků naráz */
      featureIds?: string[];
    }
  | { type: "pattern"; featureId: string; kind: "circular"; count: number; angle: number; axis: Axis; center: Vec3; axisDef?: AxisDef; skip?: number[]; symmetric?: boolean; equalSpacing?: boolean; radial?: boolean; featureIds?: string[]; geometryOnly?: boolean }
  /** Pole po křivce (skica s otevřenou/uzavřenou křivkou), podle bodů skici, nebo výplňové (plocha / skica obrysu). */
  | { type: "pattern"; featureId: string; kind: "curve"; count: number; sketchId: string; align: "tangent" | "fixed"; spacing?: number; skip?: number[]; featureIds?: string[]; geometryOnly?: boolean }
  | { type: "pattern"; featureId: string; kind: "sketch"; sketchId: string; skip?: number[]; featureIds?: string[]; geometryOnly?: boolean }
  | { type: "pattern"; featureId: string; kind: "fill"; sketchId: string; spacing: number; margin: number; layout: "grid" | "stagger" | "circular"; skip?: number[]; featureIds?: string[]; geometryOnly?: boolean }
  | { type: "mirror"; plane: PlaneName; offset: number; keepOriginal: boolean; planeDef?: PlaneDef; featureIds?: string[] }
  | { type: "import"; fileName: string; format: KernelImportFormat | "iges"; data: string /* base64 */ }
  /** Tažení profilu po křivce (profil = uzavřená skica, dráha = skica s otevřenou/uzavřenou křivkou). */
  | { type: "sweep"; profileId: string; pathId: string; mode: BoolMode; frenet: boolean; guideId?: string; twist?: number; twistTurns?: number; thin?: Thin; circleRadius?: number; keepNormal?: boolean; transition?: "right" | "round" | "transformed"; scaleEnd?: number }
  /** Šablonování mezi 2+ skicami (profily v různých rovinách). */
  | { type: "loft"; sketchIds: string[]; ruled: boolean; mode: BoolMode; guideIds?: string[]; centerlineId?: string; closed?: boolean; startCond?: "none" | "normal" | "direction"; endCond?: "none" | "normal" | "direction"; startDir?: Direction; endDir?: Direction; startLen?: number; endLen?: number; thin?: Thin; startPoint?: Ref; endPoint?: Ref }
  /** Úkos vybraných ploch vůči neutrální rovině (`planeDef` = libovolná rovina; `pull` = směr tahu; `partingSketchId` = dělicí křivka). */
  | { type: "draft"; angle: number; faces: number[]; plane: PlaneName; offset: number; planeDef?: PlaneDef; pull?: Direction; partingSketchId?: string; tangentChain?: boolean; step?: boolean }
  /** Rozříznutí tělesa rovinou, ponechá se jedna strana (`planeDef` = libovolná rovina, `faceRef` = řez plochou). */
  | { type: "split"; plane: PlaneName; offset: number; keep: "positive" | "negative"; planeDef?: PlaneDef; faceRef?: Ref }
  /** Přesun / otočení / měřítko tělesa. */
  | { type: "transform"; translate: Vec3; rotateAxis: Axis; rotateAngle: number; scale: number; translateRef?: { a: Ref; b: Ref }; rotateAxisDef?: AxisDef; centerRef?: Ref }
  /** Pomocná (referenční) rovina – nevytváří geometrii, slouží pro skici. */
  | { type: "datum"; origin: Vec3; normal: Vec3; xDir: Vec3; size: number; planeDef?: PlaneDef }
  /** Text – vystouplý (add) nebo gravírovaný (cut) do tělesa. */
  | { type: "text"; text: string; height: number; depth: number; plane: SketchPlane; position: Vec2; angle: number; mode: "add" | "cut"; positionRef?: Ref; planeDef?: PlaneDef }
  /** Přímé úpravy: posunout (vytáhnout/zatlačit) vybrané plochy o vzdálenost podél normály (`extent` = k vrcholu / k ploše / odsazeně od plochy). */
  | { type: "pushPull"; faces: number[]; distance: number; extent?: Extent }
  /** Přímé úpravy: odstranit plochy (např. zaoblení, díry) a zacelit těleso. */
  | { type: "deleteFace"; faces: number[] }
  /** Přímé úpravy: odsadit plochy (offset) – kladně ven, záporně dovnitř. */
  | { type: "offsetFace"; faces: number[]; distance: number }
  /** Žebro z otevřené skici (čára) s tloušťkou, dotažené k tělesu. */
  | { type: "rib"; sketchId: string; thickness: number; direction: "normal" | "inPlane"; flip: boolean }
  /** Šroubovice / pružina (tažení kruhového průřezu po šroubovici). */
  | { type: "spring"; radius: number; pitch: number; turns: number; wire: number; position: Vec3; axis: Axis; mode: BoolMode; positionRef?: Ref; dirDef?: Direction }
  /** Zesílení (thicken) vybraných ploch na skořepinu dané tloušťky. */
  | { type: "thicken"; faces: number[]; thickness: number; mode: BoolMode }
  /** Vnější závit na válcové ploše (kosmetický = jen ve výkrese, modelovaný = šroubovice). */
  /** závit na válci (vnější) nebo v díře (`internal`); `modeled` = drážky v geometrii, jinak kosmetický (jen výkres); označení i s jemným stoupáním („M18×1,5“) */
  | { type: "thread"; designation: string; position: Vec3; axis: Axis; length: number; modeled: boolean; internal?: boolean; positionRef?: Ref; dirDef?: Direction }
  /** Prvek z modulu rozšíření (plochy, plech, pokročilé modelování…) – definice v `cad/ext/registry.ts`, data podle modulu. */
  | { type: "ext"; ext: string; data: Record<string, unknown> }
  /** Více těles: booleovská operace dvou těles dílu (výsledek do `target`, `tool` se volitelně ponechá). */
  | { type: "combine"; target: string; tool: string; op: "add" | "cut" | "intersect"; keepTool: boolean }
  /** Více těles: rozříznutí tělesa rovinou na dvě samostatná tělesa (kladná strana si nechá název, záporná = `nameB`). */
  | { type: "splitBodies"; plane: PlaneName; offset: number; nameB?: string; planeDef?: PlaneDef }
  /** Více těles: kopie tělesa jako nové těleso s posunutím. */
  | { type: "copyBody"; source: string; translate: Vec3; newName?: string }
  /** Pomocná osa – nevytváří geometrii; `def` = způsob zadání (hrana, válec, 2 body, globální osa, pomocná rovina, průsečnice dvou rovin…), `length` = délka zobrazení. */
  | { type: "datumAxis"; def: AxisDef; length: number }
  /** Pomocný bod – nevytváří geometrii; `ref` = libovolný způsob zadání bodu (vrchol, střed hrany, střed kružnice, průsečík…). */
  | { type: "datumPoint"; ref: Ref }
  /** Souřadný systém – počátek + směr X + směr Z (X se ortogonalizuje vůči Z); `size` = velikost zobrazení. */
  | { type: "csys"; origin: Ref; xDir: Direction; zDir: Direction; size?: number }
);

export type CadDoc = {
  app: "mnastrojarna-cad";
  version: 1 | 2;
  name: string;
  /** třída materiálu (hustota) – id z tabulky MATERIALS (ocel, nerez, hlinik…) */
  material: string;
  /** označení materiálu do razítka (volný text, např. „ČSN 11 423“, „1.0503“, „EN AW-6082“) – nezávislé na hustotě */
  materialName?: string;
  features: Feature[];
  /** barva tělesa (#rrggbb) */
  color?: string;
  /** proměnné / rovnice */
  variables?: Variable[];
  /** vazby parametrů na výrazy: klíč „featureId:cesta“ (např. „x1:distance“, „b1:size.0“) → výraz */
  bindings?: Record<string, string>;
  /** stavy (konfigurace) */
  configs?: Config[];
  activeConfig?: string | null;
  /** popisové údaje (razítko výkresu) */
  props?: { number?: string; author?: string; revision?: string; note?: string };
  /** „part“ (výchozí) = díl z historie prvků; „assembly“ = sestava z komponent */
  kind?: "part" | "assembly";
  /** komponenty sestavy */
  components?: AsmComponent[];
  /** barvy jednotlivých ploch výsledného tělesa (index plochy → #rrggbb) */
  faceColors?: Record<number, string>;
  /** výkresy uložené v dokumentu (volby listu, razítko, uživatelské kóty a poznámky) – asociativní s modelem */
  drawings?: DrawingDoc[];
  /** trvalé vazby sestavy (řeší se při změně polohy komponent) */
  mates?: Mate[];
  /** metadata těles dílu (barva, skrytí) – název = klíč tělesa z historie */
  bodies?: BodyMeta[];
  /** těleso, do kterého mají nové prvky směřovat (bez hodnoty = naposledy upravené) */
  activeBody?: string | null;
};

export type Sig = { t: string; c: Vec3; s: number };

/** Místo na hraně: začátek, konec, střed délky, střed kružnice/oblouku, nebo parametr 0–1. */
export type EdgeAt = "start" | "end" | "mid" | "center" | { t: number };

export type DerivedOp =
  | "mid" // střed mezi body (průměr)
  | "between" // bod mezi dvěma body v poměru v (0–1)
  | "offset" // bod + směr × v
  | "project" // kolmý průmět bodu do roviny plochy / na osu
  | "intersect" // průsečík přímky (hrana / směr) s rovinou (plocha)
  | "percent"; // bod v procentech délky hrany

export type Ref =
  | { kind: "xyz"; p: Vec3 }
  | { kind: "vertex"; index: number; sig?: Sig }
  | { kind: "edge"; index: number; at?: EdgeAt; sig?: Sig }
  | { kind: "face"; index: number; sig?: Sig }
  /** charakteristický bod entity skici (klíče jako u SketchRef: a, b, c, mid, center, p0…) */
  | { kind: "sketchPt"; sketchId: string; entityId: string; k: string }
  /** pomocná rovina (datum) – počátek / normála */
  | { kind: "datum"; featureId: string }
  /** počátek souřadnic nebo osa souřadnicového systému */
  | { kind: "csys"; axis?: Axis }
  /** pomocná osa (prvek datumAxis, nebo osa Z souřadného systému csys) – bod na ose + směr */
  | { kind: "datumAxis"; featureId: string }
  /** pomocný bod (prvek datumPoint, nebo počátek souřadného systému csys) */
  | { kind: "datumPoint"; featureId: string }
  | { kind: "derived"; op: DerivedOp; args: Ref[]; v?: number };

/** Ukončení vysunutí / díry / rotace (jako SolidWorks „End Condition“, NX „Limits“, ZW3D „End E“). */
export type Extent =
  | { kind: "blind"; d: number }
  | { kind: "throughAll" }
  | { kind: "toNext" }
  | { kind: "toVertex"; ref: Ref }
  | { kind: "toFace"; ref: Ref; offset?: number }
  | { kind: "offsetFromFace"; ref: Ref; d: number }
  | { kind: "toBody" }
  | { kind: "midPlane"; d: number };

export type ExtentKind = Extent["kind"];

/** Směr (vysunutí, osa díry, směr pole…). */
export type Direction =
  | { kind: "normal" } // normála roviny skici / plochy
  | { kind: "axis"; axis: Axis }
  | { kind: "edge"; ref: Ref } // podél hrany / osy válce
  | { kind: "twoPoints"; a: Ref; b: Ref }
  | { kind: "faceNormal"; ref: Ref }
  | { kind: "vector"; v: Vec3 }
  | { kind: "angle"; deg: number } // natočení od normály v rovině skici (kolem osy Y skici)
  | { kind: "tangent"; ref: Ref }; // tečna hrany v bodě

/** Začátek vysunutí (SolidWorks „From“). */
export type StartFrom = { kind: "sketchPlane" } | { kind: "offset"; d: number } | { kind: "face"; ref: Ref } | { kind: "vertex"; ref: Ref };

/** Tenká stěna (SolidWorks „Thin Feature“, ZW3D „Offset → Thicken“). */
export type Thin = { side: "one" | "two" | "mid" | "in"; t1: number; t2?: number };

/** Osa rotace. */
export type AxisDef =
  | { kind: "sketchX" }
  | { kind: "sketchY" }
  | { kind: "sketchLine"; entityId: string }
  | { kind: "edge"; ref: Ref }
  | { kind: "twoPoints"; a: Ref; b: Ref }
  | { kind: "global"; axis: Axis }
  | { kind: "cylFace"; ref: Ref }
  | { kind: "datum"; featureId: string }
  /** průsečnice dvou rovin (rovinné plochy / pomocné roviny) */
  | { kind: "twoPlanes"; a: Ref; b: Ref }
  /** pomocná osa (prvek datumAxis / osa Z csys) */
  | { kind: "datumAxis"; featureId: string };

/** Definice roviny – 15 způsobů jako u referenční geometrie špičkových CADů. */
export type PlaneDef =
  | { kind: "base"; name: PlaneName; offset: number }
  | { kind: "face"; ref: Ref; offset?: number; flip?: boolean }
  | { kind: "threePoints"; a: Ref; b: Ref; c: Ref }
  | { kind: "pointLine"; p: Ref; line: Ref } // bod + přímka (hrana) ležící v rovině
  | { kind: "pointNormal"; p: Ref; dir: Direction } // bod + normála
  | { kind: "angle"; face: Ref; edge: Ref; deg: number } // rovina otočená kolem hrany od plochy
  | { kind: "mid"; a: Ref; b: Ref } // střední mezi dvěma rovnoběžnými plochami (jinak půlicí)
  | { kind: "tangentCyl"; face: Ref; through: Ref } // tečná k válci, rovnoběžná s rovinou/plochou `through`
  | { kind: "normalToCurve"; curve: Ref; at: Ref } // kolmá na hranu v bodě
  | { kind: "twoEdges"; a: Ref; b: Ref } // dvě rovnoběžné / různoběžné hrany
  | { kind: "datum"; featureId: string; offset?: number }
  | { kind: "custom"; origin: Vec3; normal: Vec3; xDir: Vec3 };

/** Rovina odvozená od zadání `PlaneDef` (výsledek řešení). */
```
