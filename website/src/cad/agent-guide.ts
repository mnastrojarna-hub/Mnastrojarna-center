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
   3mf, wrl, mncad) vrátí \`{ name, mime, bytes, base64 }\` **bez dialogu** – pro agenty a skripty, které potřebují soubor;
   \`window.mncad.progress()\` vrátí průběh běžícího výpočtu (\`{ label, index, total, name, seconds }\` nebo \`null\`) a
   \`window.mncad.cancel()\` ho zruší (dokument zůstane ve stavu před výpočtem).

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
| \`skica XY|XZ|YZ [odsazení N]: entita; entita…\` | skica na základní rovině; entity i na dalších řádcích |
| \`skica počátek x y z normála nx ny nz [osax ux uy uz]: …\` | skica na obecné rovině (viz „Souřadnice skici ve 3D“) |
| \`skica plocha F3|horní|+X [odsazení N] [obráceně]: …\` · \`skica rovina "Rovina 1" [odsazení N]: …\` | skica na rovinné ploše modelu (číslem nebo pravidlem) nebo na pomocné rovině – viz „Vazby a kóty ve skice textem“ |
| \`obdélník W H [v x y]\` / \`obdélník W H roh x y\` | obdélník středem (výchozí počátek) nebo rohem |
| \`kružnice D [v x y]\` / \`kružnice poloměr r\` | kružnice |
| \`mnohoúhelník N D [v x y]\` · \`drážka L W [úhel a]\` · \`úsečka x1 y1 x2 y2\` · \`bod x y\` · \`elipsa rx ry\` | další entity; předpona \`pomocná\` = konstrukční |
| \`čára x1 y1 x2 y2 [r N] x3 y3 … [uzavřít]\` | lomená čára; \`r N\` za bodem zaoblí tento roh poloměrem N (vzniknou úsečky a tečné oblouky) |
| \`oblouk x1 y1 xm ym x2 y2\` | oblouk třemi body: začátek, bod na oblouku, konec |
| \`spline x1 y1 x2 y2 x3 y3 … [uzavřít]\` | hladká křivka přes zadané body |
| \`vazba <druh> <odkaz> [<odkaz> …]; <druh> …\` | vazba ve skice (vodorovně, kolmo, tečně, shodně…); odkazy na entity \`e1\`, \`e1.a\`, \`počátek\` |
| \`kóta <druh> <odkaz> [<odkaz>] <hodnota> [referenční]; …\` | kóta ve skice (délka, vzdálenost, vodorovně, svisle, poloměr, průměr, úhel, délka oblouku) |
| \`vysunout H [symetricky] [skrz] [odebrat|přidat|průnik|nové] [obráceně] [úkos a]\` | vysune poslední skicu |
| \`rotovat [úhel] [osa X|Y|Z] [odebrat|přidat|průnik|nové]\` | orotuje poslední skicu (výchozí osa Y skici, 360°); \`odebrat\` = vysoustružit profil z tělesa |
| \`díra D [hloubka H|skrz [obousměrně]|k tělesu] v x y [z] [osa Z] [zahloubení D2 H2] [kuželové D2] [závit M8 [hloubka-závitu T]]\` | bez z = díra začíná na povrchu tělesa v daném místě (zjistí se ze sítě modelu) a vrtá dolů; \`skrz\` vrtá **od zadaného bodu jen ve směru vrtání** (materiál nad bodem zůstane), \`obousměrně\` na obě strany; \`k tělesu\` (EN \`to body\`, DE \`bis Körper\`) vrtá po první stěnu stávajícího tělesa – projde první stěnou ve směru vrtání a dál nepokračuje (např. jen horní stěnou dutého dílu), jako ukončení „K tělesu“ u vysunutí; \`závit M6\` vrtá jádro, \`hloubka\` = hloubka vrtání, \`hloubka-závitu\` = užitečná délka závitu (výkres pak ukáže „M8 ↧10“ + „Ø6,8 ↧14“) |
| \`díra D … směr vx vy vz\` · \`díra D … sklon úhel [směr +X]\` | šikmá díra: \`směr\` = směr vrtání vektorem; \`sklon\` = odklon od osy díry (výchozí k +X u osy Z) |
| \`díra D skrz v x1 y1 z1 v x2 y2 z2 …\` | více děr jedním příkazem (každá poloha třemi souřadnicemi) |
| \`zaoblit R [hrany vše|horní|spodní|svislé|vodorovné|kruhové|rovné|+Z|-Z|+X|-X|+Y|-Y] [poloměr N] [delší N] [kratší N]\` | pravidla lze kombinovat: \`hrany horní kruhové\` |
| \`srazit C [hrany …]\` | sražení hran, stejná pravidla |
| \`skořepina T [otevřít +Z|horní|boční|největší]\` | vydlabání; otevřené plochy pravidlem |
| \`pole N rozteč P [směr X|Y|Z] [N2 rozteč P2 směr Y]\` · \`pole kruhové N [úhel 360] [osa Z] [v cx cy cz]\` | pole posledního prvku |
| \`zrcadlit XY|XZ|YZ [odsazení N]\` | zrcadlení tělesa |
| \`text "ABC" výška H hloubka D v x y [z] [gravírovat]\` | nápis vystouplý / gravírovaný |
| \`těleso N\` · \`rozdělit XY|XZ|YZ [odsazení N] [jako Název]\` · \`kopie [těleso N] [posun dx dy dz] [jako Název]\` · \`sloučit <cíl> <nástroj> [odebrat|průnik] [ponechat]\` | více těles v dílu (viz níže) |
| \`prvek <typ|rozšíření> klíč=hodnota …\` | kterýkoli typ prvku i prvek rozšíření bez JSON (viz níže) |
| \`normálie <označení> [v x y z]\` | díl z knihovny (M8x30, ložisko 6204, pero 8x7x40): v dílu nová záložka, v sestavě komponenta |
| \`vložit "název záložky" [v x y z] [otočení rx ry rz] [ukotvit]\` | sestava: vloží díl z otevřené záložky jako komponentu |
| \`výkres\` | otevře výkres otevřeného dokumentu v záložce |
| \`výkres [A4|A3|A2|A1|A0] [na šířku|na výšku] [měřítko 1:2|auto] [pohledy přední,horní,levý,pravý,zadní,spodní,iso] [řez XZ|YZ|XY [odsazení N]|ne] [skryté ano|ne] [osy ano|ne] [tabulka děr ano|ne] [promítání E|A]\` | volby prvního listu výkresu (založí ho, chybí-li) a otevře výkres |
| \`kótovat [chytře|celkově|nic] [řetězově|od základny]\` | Chytré kóty podle prvků modelu (viz „Výkres a kóty“) – nahradí jen vygenerované kóty |
| \`výkres tolerance <kóta> <tolerance>\` · \`výkres poznámka "…"\` · \`výkres nepředepsané ISO 2768-mK\` · \`výkres hrany ISO 13715 …\` · \`výkres drsnost Ra 3,2\` | tolerance ke kótě podle popisku (\`Ø40 h6\`, \`25 ±0,1\`, \`M8 6H\`); údaje u razítka |
| \`výkres stav\` | textový stav výkresu: list, měřítko, pohledy, všechny kóty po pohledech, duplicity, chybějící rozměry, co se nevešlo (také \`window.mncad.drawingStatus()\`) |
| \`smazat poslední\` · \`stav\` · \`zobraz iso|přední|horní…\` · \`kolize\` | správa; kolize = kontrola průniků komponent sestavy |

Booleovský režim: první tvarový prvek vytvoří těleso, další se **přidávají**; \`odebrat\` odečte, \`průnik\` ponechá
průnik, \`nové\` založí další samostatné těleso. Pravidla hran/ploch se vyhodnocují na aktuálním tělese (před
příkazem) – pořadí příkazů je tedy důležité. Stejné příkazy fungují anglicky (box, hole, arc, spline, body, combine,
feature…) a německy (quader, bohrung, bogen, körper, kombinieren, element…); seznam vypíše hláška o neznámém příkazu.

### Vstup: řádky a JSON lze míchat

Vstup se zpracuje **po řádcích**. Řádek, který je celý JSON (\`{ … }\` nebo \`[ … ]\`), přidá prvek nebo prvky a může
stát kdekoli – i jako první řádek, za kterým následují textové příkazy. Jako jeden JSON se vstup bere jen tehdy, když
se tak dá přečíst celý (dokument .mncad, pole prvků, JSON rozepsaný na více řádků). Protokol je v pořadí řádků
vstupu, stav dokumentu se vypíše jednou na konci (\`stav\` uprostřed vstupu vypíše stav v tom okamžiku).

### Souřadnice skici ve 3D

Bod skici \`(u; v)\` leží ve 3D v bodě \`počátek + u·X_skici + v·Y_skici\`, kde \`Y_skici = normála × X_skici\`:

| Rovina | počátek | X skici | Y skici | normála (směr vysunutí) | bod (u; v) ve 3D |
| --- | --- | --- | --- | --- | --- |
| \`XY\` [odsazení d] | (0; 0; d) | +X | +Y | +Z | (u; v; d) |
| \`XZ\` [odsazení d] | (0; −d; 0) | +X | +Z | −Y | (u; −d; v) |
| \`YZ\` [odsazení d] | (d; 0; 0) | +Y | +Z | +X | (d; u; v) |
| obecná: \`počátek o\`, \`normála n\`, \`osax x\` | o | x (kolmo na n) | n × x | n | o + u·x + v·(n × x) |

- \`rotovat\` otáčí kolem osy **Y skici** procházející počátkem skici (\`osa X\` = kolem osy X skici). U skici v rovině
  XZ je tedy osou rotace osa **Z** modelu a souřadnice \`u\` profilu je poloměr – tak se kreslí soustružené díly
  (profil \`skica XZ: čára r1 z1 r2 z2 … uzavřít\`, pak \`rotovat\`).
- \`vysunout H\` jde ve směru normály (u roviny XZ směrem −Y), \`obráceně\` opačně, \`symetricky\` na obě strany.
- U obecné roviny se bez \`osax\` zvolí X skici kolmo na normálu co nejblíž ose X modelu (u normály ±X ose Y). V JSON je
  to \`"plane": { "kind": "custom", "origin": [x,y,z], "normal": [nx,ny,nz], "xDir": [ux,uy,uz] }\`.

### Vazby a kóty ve skice textem

Entity zadané textem dostanou ve skice krátká id **e1, e2, e3…** v pořadí vzniku (protokol je u každého řádku vypíše,
např. \`✓ 4 entity do skici „Skica 1“ (e1–e4)\`; \`stav\` je u skici vypíše i se souřadnicemi – u skic do 40 entit).
Na ně odkazují vazby a kóty:

- \`e3\` = celá entita (úsečka, kružnice, oblouk, obdélník…); u kružnice / oblouku na místě bodu = její střed.
- Body: \`e3.a\` / \`e3.b\` = začátek / konec úsečky, u oblouku \`a\` začátek, \`b\` bod na oblouku, \`c\` konec;
  \`e3.střed\` (\`center\`) = střed kružnice, oblouku, obdélníku, drážky, u úsečky její polovina; \`e3.začátek\` / \`e3.konec\`;
  \`e3.p0\`, \`e3.p1\`… = body lomené čáry / spline (od nuly); \`e3.c0\`…\`c3\` = rohy obdélníku (c0 vlevo dole, proti směru
  hodin); \`e3.e0\` / \`e3.e1\` = středy konců drážky; \`počátek\` (\`origin\`, \`O\`) = počátek skice.
- Strany: \`e3.s0\`…\`s3\` = strany obdélníku (s0 dole, s1 vpravo, s2 nahoře, s3 vlevo), \`e3.g0\`… = úseky lomené čáry.

| Vazba (\`vazba …\`) | Odkazy |
| --- | --- |
| \`vodorovně\` / \`svisle\` | úsečka, nebo dva body |
| \`shodně\` (\`totožně\`) | dva body; \`shodně e1.a počátek\` = bod pevně v počátku |
| \`rovnoběžně\` · \`kolmo\` · \`kolineárně\` | dvě úsečky |
| \`tečně\` | úsečka a kružnice / oblouk, nebo dvě kružnice / oblouky |
| \`stejně\` | dvě úsečky (délka), nebo dvě kružnice / oblouky (poloměr) |
| \`pevně\` | bod (\`pevně e1.a\` = na místě, \`pevně e1.a 10 20\` = na souřadnice), nebo celá entita |
| \`soustředně\` | dvě kružnice / oblouky, nebo kružnice a bod (i \`počátek\`) |
| \`středem\` | bod a úsečka (bod v polovině úsečky) |
| \`na křivce\` | bod a úsečka / kružnice / oblouk |
| \`symetricky\` | dva body a osa (úsečka) |

| Kóta (\`kóta …\`) | Odkazy a hodnota |
| --- | --- |
| \`délka\` | úsečka nebo strana (\`e2.s0\`), délka v mm |
| \`vzdálenost\` | dva body, bod a úsečka, nebo dvě rovnoběžné úsečky |
| \`vodorovně\` / \`svisle\` | dva body (i \`počátek\`), nebo úsečka (= její konce); vzdálenost v X / Y |
| \`poloměr\` / \`průměr\` | kružnice nebo oblouk (u drážky poloměr = půl šířky); hodnota i \`R10\` / \`Ø20\` |
| \`úhel\` | dvě úsečky, 0–180° |
| \`délka oblouku\` | oblouk |

- Anglicky \`constraint horizontal e1\`, \`dim length e1 50\`; německy \`bedingung waagerecht e1\`, \`bemaßung länge e1 50\`
  (druhy: horizontal/waagerecht, vertical/senkrecht, coincident/deckungsgleich, parallel, perpendicular/rechtwinklig,
  tangent/tangential, equal/gleich, fixed/fest, concentric/konzentrisch, midpoint/mittelpunkt, onCurve/aufKurve,
  symmetric/symmetrisch, collinear/kollinear; length/Länge, distance/Abstand, radius, diameter/Durchmesser, angle/Winkel,
  arcLength/Bogenlänge). Více vazeb nebo kót na jednom řádku oddělte středníkem.
- Kóta je **řídicí** (změní geometrii); \`referenční\` (\`reference\`, \`Referenz\`) jen měří a hodnotu lze vynechat.
- Po každém řádku \`vazba\` / \`kóta\` (a na konci bloku skici, přibyly-li entity) se skica **vyřeší** a protokol napíše
  stav jako skicář: \`Plně určeno\`, \`Nedourčeno (N st. volnosti)\` nebo ⚠ \`Přeurčeno – konflikt / nadbytečné vazby\` s výčtem
  vazeb v rozporu (⚠ jen u skici přeurčené už předem, např. z JSON).
- Vazba nebo kóta, která by skicu **přeurčila** (je v rozporu s dosavadními, nebo nadbytečná), se **nepřidá**: protokol
  napíše \`✗ kóta délka e1 20 ve skice „Skica 1“ nepřidána – v rozporu s dosavadními vazbami a kótami\` (nebo
  \`– nadbytečná: …\`) a ostatní položky téhož řádku se přidají. Jen měřící kótu zapíšete s \`referenční\`. Uložené vazby
  a kóty opravíte ve skicáři (klik na značku vazby nebo kótu, Delete) nebo v JSON (pole \`constraints\` a \`dims\` skici).
- Vazby, kóty a entity mimo blok skici jdou do skici **otevřené ve skicáři** (pokud ten vstup nezaložil vlastní skicu),
  jinak do poslední skice dokumentu.
- Chybný odkaz skončí chybou s očekávaným zápisem na řádku, kde je (\`✗ řádek 7: vazba kolmo: „e5“ je kružnice / oblouk,
  čeká se úsečka – zápis: vazba kolmo e1 e2 (dvě úsečky)\`); takový řádek nic nepřidá.
- Vazba \`tečně\` mezi úsečkou a obloukem, které už sdílejí koncový bod (\`shodně\`), se vyhodnotí jako nadbytečná a nepřidá
  se – drážku kreslete entitou \`drážka\`, zaoblený roh \`čára … r N\`, případně tečnost vynechte.

**Skica na ploše modelu nebo na pomocné rovině:** \`skica plocha F6: …\` – číslo plochy jako popisky pro výběr
(\`window.mncad.hints()\`, Ctrl+Shift+L; F1 = první plocha), nebo pravidlem jako u skořepiny: \`skica plocha horní\`,
\`skica plocha +X\`, \`skica plocha spodní\` (pravidlo musí vybrat právě jednu rovinnou plochu, jinak chyba vypíše rovinné
plochy s normálami a středy). \`odsazení N\` posune rovinu po normále, \`obráceně\` otočí normálu. \`skica rovina "Rovina 1"
[odsazení N]\` = pomocná rovina (prvek datum) podle názvu. Rovina je **asociativní** (při změně modelu se přepočítá; plocha
má otisk, takže ji najde i po změně číslování). Počátek skici na ploše je ve **středu plochy**, normála míří ven z tělesa;
protokol vypíše počátek, normálu a osu X skici (\`✓ Skica 2 na ploše F6 (horni) – rovina: počátek [40; 25; 20], normála +Z,
osa X skici …\`), \`vysunout\` jde po normále (ven), \`vysunout 5 odebrat obráceně\` řeže do tělesa.

\`\`\`
# 1) obdélník ze čtyř úseček, plně určený, 80 × 50 od počátku → objem 40 cm³
skica XY
úsečka 0 0 60 0
úsečka 60 0 60 40
úsečka 60 40 0 40
úsečka 0 40 0 0
vazba shodně e1.b e2.a; shodně e2.b e3.a; shodně e3.b e4.a; shodně e4.b e1.a
vazba vodorovně e1; vodorovně e3; svisle e2; svisle e4
vazba shodně e1.a počátek
kóta délka e1 80; délka e2 50
vysunout 10
\`\`\`

\`\`\`
# 2) drážka: střed v počátku, vodorovně, rozteč středů 30, šířka 12 (celková délka 42)
skica XY
drážka 40 10 v 10 3
vazba shodně e1.střed počátek; vodorovně e1.e0 e1.e1
kóta vzdálenost e1.e0 e1.e1 30; poloměr e1 6
\`\`\`

\`\`\`
# 3) kružnice Ø20 tečná k úsečce délky 50, střed 25 mm od začátku úsečky
skica XY
úsečka 0 0 50 0
kružnice 20 v 25 12
vazba vodorovně e1; pevně e1.a
vazba tečně e1 e2
kóta délka e1 50; průměr e2 Ø20; vodorovně e1.a e2.střed 25
\`\`\`

\`\`\`
# 4) kvádr, čep Ø12 × 8 uprostřed horní plochy a kapsa 30 × 10 hloubky 2 uprostřed boku +X
kvádr 80 50 20
skica plocha horní: kružnice 12
vazba soustředně e1 počátek
vysunout 8
skica plocha +X: obdélník 30 10
vazba shodně e1.střed počátek; vodorovně e1.s0
kóta délka e1.s0 30; délka e1.s1 10
vysunout 2 odebrat obráceně
\`\`\`

### Více těles v dílu

Díl má vždy jedno **aktivní těleso**, se kterým pracují prvky, a libovolný počet dalších těles (výchozí názvy
„Těleso 1“, „Těleso 2“…; v příkazech stačí číslo).

- \`válec 30 40 v 50 30 20 nové těleso Čep\` – prvek s \`nové\` založí další těleso (název je volitelný) a to se stane aktivním.
- \`těleso 1\` – další prvky pracují s Tělesem 1; \`díra 8 skrz v 20 30 20 těleso 1\` – jen tento prvek.
- \`rozdělit XY odsazení 10 jako Spodek\` – rovina rozdělí aktivní těleso; strana ve směru normály zůstane, opačná je nové těleso.
- \`kopie těleso Spodek posun 0 0 -30 jako Kopie\` – další těleso jako posunutá kopie.
- \`sloučit 1 Čep [odebrat|průnik] [ponechat]\` – sjednotí (odečte, pronikne) nástrojové těleso do cílového; \`ponechat\` nástroj nezruší.
- \`stav\` vypíše řádek \`Tělesa:\` s názvy, objemy a označením aktivního. V JSON jsou to prvky \`splitBodies\`, \`copyBody\`,
  \`combine\`, pole \`body\` u prvku (cílové těleso) a \`"mode": "new"\` s novým názvem v \`body\` (nové těleso).

### Obecný příkaz \`prvek\` – všechny typy bez JSON

\`prvek <typ> klíč=hodnota klíč=hodnota …\` vytvoří prvek kteréhokoli typu (sweep, loft, draft, transform, datum, rib,
spring…) i prvek rozšíření (\`prvek sheet.bend …\`, \`prvek "Zkrut" …\` – id nebo popisek z pásu karet).

- Klíče jsou pole prvku ze schématu níže; u rozšíření klíč parametru nebo jeho český popisek. \`název="…"\` pojmenuje prvek.
- Hodnoty: číslo (\`12,5\`), \`ano\` / \`ne\`, seznam \`10;0;5\`, text v uvozovkách, JSON (\`planeDef={"kind":"base","name":"XY","offset":12}\`).
- Skici a prvky se zadávají názvem (\`profileId="Skica 1"\`) nebo \`$last\`; plochy a hrany čísly (\`faces=1;4;5\`) nebo
  pravidlem (\`faces=boční\`, \`edges=horní;kruhové\`).
- Neznámý klíč nebo typ skončí chybou s výčtem platných – tak lze parametry zjistit.
- Směr a osa u rozšíření (\`surf.helix\` / \`surf.helixSweep\` \`axis\`, \`sheet.relief\` \`axis\`, \`surf.extrude\` \`dir\`,
  \`surf.revolve\` \`axis\`): \`axis=X\`, \`axis=-Z\`, vektor \`axis=1;0;1\`, nebo JSON odkaz
  (\`axis={"kind":"edge","ref":{"kind":"edge","index":3}}\` = podél hrany 4 / osy válce, \`{"kind":"faceNormal","ref":{"kind":"face","index":5}}\`
  = normála plochy 6). U \`surf.revolve\` je \`axis=x\` / \`axis=y\` osa skici, \`axis=X|Y|Z\` globální osa, JSON \`AxisDef\`
  (\`{"kind":"cylFace","ref":{"kind":"face","index":2}}\`). Starší zápis \`"axis": "Z"\` v JSON platí dál.
- Prvky \`adv.varFillet\`, \`adv.fullRound\`, \`adv.chamfer2\`, \`adv.curvePattern\`, \`adv.fillPattern\` a \`adv.holesAtPoints\` jsou
  starší duplicity – na pásu karet už nejsou, staré dokumenty i \`prvek …\` je dál postaví. Pro nové díly použijte
  vestavěné \`zaoblit\` (druh R1 → R2 / plný), \`srazit\` (D1 × D2 / D × úhel), \`pole\` (po křivce / výplň / podle skici) a \`díra\`.

\`\`\`
skica XY: obdélník 20 20
prvek adv.twist sketch=$last height=30 angle=45
prvek chamfer distance=1 edges=horní;rovné
\`\`\`

### Průběh a zrušení výpočtu

Během delšího výpočtu ukazuje program u spodního okraje „Počítám prvek k/n: název · čas“ s tlačítkem **Zrušit**; totéž
vrací \`window.mncad.progress()\` a \`window.mncad.cancel()\`. Zrušený běh konzole dokument nezmění. Po výpočtu je
v protokolu u delších prvků čas (\`✓ Pole 1 (pattern) · 7,9 s\`) a celkový čas. Jádro si pamatuje stav po prvcích:
další příkaz přidaný na konec historie přepočítá jen nový prvek.

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
- Výběr hran/ploch indexy (\`edges\`, \`faces\`, \`faces2\`, \`vertices\`, u rozšíření \`data.faces\` / \`data.edges\`) může nést
  **otisky** \`edgeSigs\` / \`faceSigs\` / \`faceSigs2\` / \`vertexSigs\` (u rozšíření \`data.facesSigs\` …): mapa „index → otisk
  { t: typ, c: střed, s: délka / plocha, r: poloměr válce / koule / kružnice, n: počet hran / ploch / vrcholů tělesa }“ entity
  tělesa před prvkem. Program je doplní sám při výběru v modelu, ze seznamu i pravidlem v textovém příkazu; při stavbě se
  podle nich indexy znovu najdou, když úprava dřívějšího prvku hrany/plochy přečísluje. Změna rozměru bez změny topologie
  (stejné \`n\`) ponechá index bez varování; ⚠ s původním indexem jen tehdy, když se topologie změnila a entita podle otisku
  nenašla. V ručně psaném JSON je lze vynechat.
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
- Závitové díry (\`díra 5 závit M6 hloubka 12\`) se na výkrese kótují popisem \`M6 ↧12\` (s počtem), ne jako Ø jádra.
- Nové výkresy mají **Chytré kóty** (kótování podle prvků, viz další kapitola). Tlačítko **Kontrola kót** ve výkresu
  porovná kóty na listu s historií prvků a vypíše, co chybí; totéž je v \`výkres stav\`. Tolerance (H8, ±0,1) se píší
  příkazem \`výkres tolerance\` nebo u kóty do pole „přípona“.
- Ukládání a export se standardně ptají na místo a název (systémový dialog – pro agenta „blokující“). V Nastavení →
  Soubory lze zapnout **přímé stažení pod výchozím názvem**; pro skripty je nejjednodušší \`window.mncad.exportFile()\`.

## Výkres a kóty – postup a pravidla pro AI

Výkres se kótuje **podle prvků modelu** (Chytré kóty), ne podle každé promítnuté čáry. Každý funkční rozměr je na listu
právě jednou, kóty stojí v úhledných řadách mimo obrys a díry mají jeden popis se značkami. Agent kóty **nepíše ručně**
– nechá je vygenerovat příkazem \`kótovat\`, zkontroluje je příkazem \`výkres stav\` a doplní jen tolerance.

### Postup (vždy v tomto pořadí)

1. **Model** textovými příkazy, \`stav\` → Geometrie: platná, žádné ✗ / ⚠. Díry dělejte příkazem \`díra\` (ne vysunutím
   kružnic) – jen tak výkres zná závit, hloubku, zahloubení a počet děr.
2. **List a pohledy:** \`výkres A3 na šířku pohledy přední,horní,iso\`. Pohledy volte podle dílu:
   rotační díl s osou X → \`přední,levý\` (osa vodorovně, čelní pohled pro díry v čele); díry shora → \`horní\`;
   díry zespodu → \`spodní\`; vnitřní tvary (vrtání, osazení uvnitř) → \`řez XZ odsazení 0\` (řez osou).
3. **Kóty:** \`kótovat\` (= chytře, řetězově) nebo \`kótovat od základny\`. Protokol vypíše počet kót podle pohledů
   a co se nevešlo.
4. **Kontrola:** \`výkres stav\` – musí platit „Duplicity: žádné“ a „Kontrola kót: všech … je na listu“. Řádek
   „Vynecháno“ říká proč (např. „zapněte pohled spodní“, „zapněte řez osou“, „nevešlo se“ → \`výkres A2\` nebo jiné
   měřítko) – opravte a spusťte \`kótovat\` znovu.
5. **Tolerance** jen na funkční rozměry: \`výkres tolerance Ø30 h6\`, \`výkres tolerance 42 ±0,05\`,
   \`výkres tolerance M20 6g\`, \`výkres tolerance Ø50 H7\` (kóta se najde podle popisku; nejednoznačná → chyba se seznamem).
   **Pomocná kóta v závorce** („(50)“ – nejdelší článek řetězu) se netoleruje (ISO 129-1): příkaz ji odmítne a vypíše
   ostatní články řetězu – tolerujte některý z nich. Tolerance zůstane u kóty i po změně modelu, dokud kóta existuje
   (průměr podle hodnoty, délka podle polohy čel); zmizí-li kóta, tolerance se ztratí – zkontrolujte \`výkres stav\`.
6. **Razítko:** \`výkres nepředepsané ISO 2768-mK\`, \`výkres hrany ISO 13715 -0,3\`, \`výkres drsnost Ra 3,2\`,
   \`výkres poznámka "…"\`.
7. \`výkres stav\` naposledy, pak export (výkres → PDF / DXF / DWG / SVG).

### Pravidla Chytrých kót (ČSN EN ISO 129-1) – kontrolní seznam

- Každý funkční rozměr **jednou** – žádná kóta dvakrát (ani v jiném pohledu), **žádný uzavřený řetězec**: řetěz délek
  + celková délka → nejdelší článek je pomocná kóta v závorce „(50)“.
- Prvek se kótuje v pohledu, kde je vidět ve skutečném tvaru; **nikdy na skryté (čárkované) hraně** – vnitřní tvary v řezu.
- **Rotační díl** (osa vodorovně): průměry osazení naskládané na straně (nejmenší nejblíž dílu, rozestup 7 mm), délky
  osazení **řetězově na jedné čáře**, celková délka ve vnější řadě (\`kótovat od základny\` = všechny délky od jednoho čela);
  zápich šířkou (v řetězu) a Ø popisem; sražení „1,5×45°“ a zaoblení „R1“ jednou s počtem „2×“; vnější závit
  „M20×1,5“ místo Ø a zvlášť délka závitu. Příčná díra: poloha podél osy **od bližšího čela**, radiálně od osy.
- Další modely na listu (komponenta, vložený soubor) se Chytrými kótami nekótují – kóty patří jen pohledům hlavního dílu.
- **Hranolový díl:** celkové rozměry délka × šířka × výška jednou; polohy děr od základních hran (levá / spodní) v pohledu,
  kde jsou díry kružnicemi; souměrně rozmístěné díry roztečí od osy souměrnosti; kruhové pole roztečnou kružnicí „Ø120“
  na osové kružnici + „rovnoměrně“ (nebo úhel).
- **Díry – jeden popis s odkazem na skupinu stejných děr** (z parametrů příkazu \`díra\` a počtu z pole):
  \`4× Ø8,5 skrz\` · \`4× Ø8,5 ↧12\` · \`4× M8 ↧10\` + \`Ø6,8 ↧14\` (hloubka závitu / hloubka vrtání) ·
  \`6× Ø11 skrz\` + \`⌴ Ø18 ↧11\` (válcové zahloubení) · \`4× Ø6,6 skrz\` + \`⌵ Ø12,4 × 90°\` (kuželové zahloubení).
  Značky: ↧ hloubka, ⌴ válcové zahloubení, ⌵ kuželové zahloubení, Ø průměr – na listu i v PDF / DXF / DWG se kreslí čarami.
- Rozmístění: kóty mimo obrys v řadách rovnoběžných s hranami (1. řada 8 mm, další po 7 mm), kratší blíž dílu,
  texty vodorovně nebo zdola nahoru (čitelné zdola / zprava), odkazy popisů pod 45°, žádný text přes jiný text nebo obrys.
  Co se čistě nevejde, se **vynechá a nahlásí** (\`výkres stav\` → Vynecháno) – nikdy se nekreslí přes sebe.
- Počet kót odpovídá počtu rozměrů („očekávaných rozměrů N“ v protokolu \`kótovat\`) – výrazně víc kót = chyba.

### Čemu se vyhnout (anti-vzory)

- **Nepište kóty jako JSON se souřadnicemi** (\`drawings[].annotations\`), když to umí \`kótovat\` – ruční kóty se nehlídají.
- Nekótujte rozměr dvakrát (jednou v předním a znovu v horním pohledu, Ø jako průměr i jako délku).
- Nekótujte skryté hrany; nekótujte každou promítnutou čáru; žádné kóty „do všech směrů“ a šikmo (kromě skutečně šikmých ploch).
- Žádný uzavřený řetězec (všechny články + celková délka bez závorky).
- Nemíchejte řetěz a kóty od základny u téhož prvku; závit nekótujte jako Ø jádra.
- Díry nemodelujte vysunutím kružnic, když jde o díru (výkres pak nezná závit, hloubku ani počet).

### Příklad A – hřídel s osazením, závitem, sražením, zápichem a zaoblením

\`\`\`
nový díl Hřídel
skica XZ: čára 0 0 0 10 30 10 30 8,5 33 8,5 33 15 83 15 83 20 98 20 98 12,5 140 12,5 140 0 uzavřít
rotovat osa X
zaoblit 1 hrany kruhové poloměr 12,5
srazit 1,5 hrany -X kruhové
závit M20×1,5 délka 25 v 0 0 0 osa X
výkres A3 na šířku pohledy přední,levý,iso
kótovat
výkres tolerance Ø30 h6
výkres nepředepsané ISO 2768-mK
výkres stav
\`\`\`

Hotový výkres ukazuje (přední pohled, osa vodorovně): průměry \`M20×1,5\`, \`Ø30\` (vlevo), \`Ø40\`, \`Ø25\` (vpravo),
zápich \`Ø17\` popisem; řetěz délek \`30\` · \`3\` · \`(50)\` · \`15\` · \`42\`, celková délka \`140\`, délka závitu \`25\`;
\`1,5×45°\`, \`2× R1\`. Celkem 14 kót, žádná duplicita, Kontrola kót bez chybějících.

### Příklad B – příruba s roztečnou kružnicí zahloubených děr a středovým otvorem

\`\`\`
nový díl Příruba
válec 160 20
díra 50 skrz v 0 0 20
díra 11 skrz v 60 0 20 zahloubení 18 11
pole kruhové 6
srazit 1 hrany kruhové poloměr 80
výkres A3 na šířku pohledy přední,horní,iso
kótovat
výkres tolerance Ø50 H7
výkres stav
\`\`\`

Hotový výkres: přední pohled \`Ø160\`, tloušťka \`20\`, \`2× 1×45°\`; horní pohled \`Ø50 skrz\` (s tolerancí \`Ø50H7 skrz\`),
roztečná kružnice \`Ø120\` (čerchovaná osová kružnice), popis děr \`6× Ø11 skrz rovnoměrně\` + \`⌴ Ø18 ↧11\`.

### Příklad C – deska se slepými závitovými dírami, průchozími dírami a kapsou

\`\`\`
nový díl Deska
kvádr 120 80 20
skica XY odsazení 20: obdélník 50 30 v 60 40 zaoblení-rohů 5
vysunout 8 odebrat obráceně
díra 6,8 závit M8 hloubka 14 hloubka-závitu 10 v 15 15
pole 2 rozteč 90 směr X 2 rozteč 50 směr Y
díra 8,5 skrz v 60 10
pole 2 rozteč 60 směr Y
výkres A3 na šířku pohledy přední,horní,iso
kótovat
výkres tolerance 90 ±0,05
výkres stav
\`\`\`

Hotový výkres (horní pohled = půdorys s dírami): \`4× M8 ↧10\` + \`Ø6,8 ↧14\`, \`2× Ø8,5 skrz\`; rozteče od os souměrnosti
\`90\` a \`50\` (závitové díry), \`60\` (průchozí díry); kapsa \`50\` × \`30\`, hloubka \`↧8\`, \`4× R5\` (kapsa je uprostřed – bez
polohových kót); celkové \`120\` × \`80\`; v předním pohledu tloušťka \`20\`.

## Model nebo výkres podle předlohy – kontrola 1:1 (povinné)

Když podle předlohy (výkres PDF, obrázek, ruční skica, 3D model zákazníka) stavíte model nebo překreslujete výkres,
výsledek musí předloze odpovídat **1:1 – plocha po ploše, kóta po kótě**, samozřejmě s ohledem na zadání. Nejčastější
chyby jsou nepřesnost (zaokrouhlení, záměna průměru a poloměru, posunutá díra, prohozená strana) a rozměr „dopočítaný od oka“.

### 1. Před modelováním – soupis kót předlohy

- Projděte předlohu pohled po pohledu a vypište **všechny** kóty do tabulky: číslo · prvek (osazení, díra, drážka,
  sražení…) · hodnota přesně, jak je napsaná (desetinná místa, \`Ø\` / \`R\` / \`M\`, počet \`4×\`) · tolerance · pohled.
- Spočítejte prvky: osazení, díry (po skupinách), drážky, závity, sražení, zaoblení.
- Ověřte, že soupis je úplný a uzavřený: řetěz délek = celková délka, rozteč × počet = rozsah, průměry na sebe navazují,
  každá díra má průměr, hloubku a polohu ve dvou směrech.
- Co chybí nebo je nejasné, si poznamenejte – **nikdy to nedoplňujte potichu**.

### 2. Chybí kóta? Zeptejte se

- Rozměr nevymýšlejte. Zastavte se a zeptejte se zadavatele, například:
  „Na výkrese chybí šířka drážky na Ø40 (přední pohled). Mám ji odhadnout z měřítka výkresu (1:2 → asi 6 mm,
  přesnost asi ±0,5 mm), nebo ji doplníte?“
- Odhad z měřítka jen se souhlasem: změřte ho na předloze v měřítku listu (u podkladu ve skice nejdřív **Kalibrovat
  měřítko**), zaokrouhlete rozumně a odhad viditelně označte – v modelu proměnnou s názvem \`odhad_…\`, na výkrese
  \`výkres poznámka "Rozměry označené ≈ jsou odhadnuty z měřítka – ověřit"\`.
- Běžíte-li bez člověka a zeptat se nejde, odhad použijte, ale v závěrečné zprávě ho uveďte jako **první bod**.

### 3. Po dokončení – kontrola 1:1 (vždy, i když vše hlásí ✓)

Model:

- \`stav\` → rozměry X / Y / Z, objem, počet ploch a seznam prvků s parametry. Porovnejte celkové rozměry (a hmotnost nebo
  objem, uvádí-li je předloha).
- **Kóta po kótě:** ke každému řádku soupisu najděte prvek v modelu a porovnejte hodnotu **přesně** – odchylka ani
  v setinách není „skoro dobře“.
- **Plocha po ploše:** počet děr, osazení a drážek musí sedět; s popisky \`F1\` / \`E2\` (\`window.mncad.hints()\`) ověřte
  polohu a stranu (díra na správné straně, drážka na správném osazení, závit na správném konci).
- Je-li k dispozici 3D model zákazníka (STEP), použijte Nástroje → **Porovnat s referencí**: rozdíl objemů a seznam
  rozdílových oblastí musí být prázdný (jen numerický šum).

Výkres:

- \`výkres stav\` → kóty po pohledech. Porovnejte se soupisem předlohy řádek po řádku: každá kóta předlohy je na výkrese
  se stejnou hodnotou a tolerancí, žádná nechybí, žádná nepřebývá, „Duplicity: žádné“.
- Stejné pohledy, řezy, měřítko a formát jako předloha (pokud zadání neříká jinak) a stejné razítko (materiál, číslo
  výkresu, nepředepsané tolerance, drsnost).

### 4. Závěrečná zpráva

- Tabulka: kóta předlohy · hodnota v modelu / na výkrese · ✓ nebo odchylka.
- Odchylky, které zadání výslovně požaduje (jiný materiál, zjednodušení…), označte jako **záměrné**.
- Seznam odhadnutých rozměrů a kdo je má potvrdit; otevřené otázky.
- Napište „odpovídá předloze 1:1“ jen tehdy, když jsou všechny řádky ✓ a žádný odhad nezůstal nepotvrzený.

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
  volitelně \`leadIn\` (náběh jako u závitového kalibru: hřbet prvního závitu je od začátku vybroušený až na dno drážky
  a během N otáček se zvedá do plného profilu – drážka sama je plná od začátku).
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
   Pracujete-li podle předlohy, na konci vždy proveďte **kontrolu 1:1** (oddíl „Model nebo výkres podle předlohy“).
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
