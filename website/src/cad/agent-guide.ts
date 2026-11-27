/**
 * Návod pro AI agenty a automatizaci (Markdown). Bez importů – čte ho i Node skript (scripts/cad-docs-text.mjs),
 * který z něj vyrábí public/cad/schema-pro-ai.md a doplňuje odkaz do llms.txt. Stejný text nabízí konzole
 * „Textové příkazy“ tlačítkem „Zkopírovat návod pro AI“.
 */
export const AGENT_GUIDE = `# Mnástrojárna CAD – rozhraní pro AI agenty a automatizaci

> **Začněte tahákem (≤ 5 kB):** https://www.mnastrojarna.cz/cad/tahak.md (EN tahak.en.md, DE tahak.de.md), v konzoli
> \`nápověda tahák\` (EN \`help cheatsheet\`, DE \`hilfe spickzettel\`), v CLI \`mncad help cheat\`. **Hledání v tomto návodu,
> v tabulce příkazů a v příručce:** \`nápověda hledat záložky\` (EN \`help search tabs\`, DE \`hilfe suchen registerkarten\`;
> také \`nápověda <slova>\`), v CLI \`mncad help search <slova>\` – 5–8 nejlepších oddílů s příkazy, bez diakritiky i s překlepem.

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
   \`await window.mncad.run(text)\` provede příkazy / JSON a vrátí protokol (\`{ protocol: "short" }\` = stručný protokol
   MNCAD/1 jako CLI); \`window.mncad.getDocument()\` vrátí
   dokument; \`await window.mncad.setDocument(docOrJson)\` ho otevře v nové záložce (\`{ inPlace: true }\` = nahradí otevřený
   dokument jako jeden krok historie); \`await window.mncad.undo(n)\` / \`redo(n)\` / \`history()\` = historie Zpět / Znovu;
   \`await window.mncad.status()\` vrátí stav
   jako text; \`window.mncad.guide()\` vrátí tento návod; \`window.mncad.commands()\` seznam příkazů;
   \`window.mncad.openConsole()\` otevře konzoli; \`await window.mncad.exportFile("step")\` (step, stl, brep, obj, glb,
   3mf, wrl, mncad) vrátí \`{ name, mime, bytes, base64 }\` **bez dialogu** – pro agenty a skripty, které potřebují soubor;
   \`await window.mncad.save("název")\` stáhne projekt .mncad bez dialogu (jako příkaz \`uložit\`) a vrátí
   \`{ name, mime, bytes, format, log }\`;
   \`await window.mncad.measure("F3", "F7")\` změří jako příkaz \`měřit\` a vrátí řádky + čísla (viz „Měření“);
   \`window.mncad.progress()\` vrátí průběh běžícího výpočtu (\`{ label, index, total, name, seconds }\` nebo \`null\`) a
   \`window.mncad.cancel()\` ho zruší (dokument zůstane ve stavu před výpočtem). **Běhy:** \`run\` se řadí do fronty (nikdy
   dva běhy najednou), \`window.mncad.runs()\` vrátí běhy a úlohy exportu (\`{ id: "r12", kind, state, inputRev, phase,
   phases, ms, result }\`, stav \`queued | running | done | cancelled | error\`), \`window.mncad.cancelRun(id?)\` běh zruší,
   \`run(text, { signal })\` přijme \`AbortSignal\`, \`await window.mncad.idle()\` počká na dokončený stav;
   \`window.mncad.computes(kind?)\` vrátí výpočty aplikace (stavba modelu, vazby, kolize, měření: \`{ id: "v7", what, state,
   inputRev }\`, pozdní výsledek staršího výpočtu = \`superseded\`). Každé volání
   \`window.mncad\` nejdřív zapíše rozepsané pole a list výkresu; \`save\`, \`exportFile\`, \`exportDrawing\`, \`share\` počkají
   na doběhnutí běhů a stavby (viz „Průběh a zrušení výpočtu“).

**Když textový příkaz něco neumí, \`prvek nápověda <typ>\` ukáže všechna pole pro \`prvek <typ> …\`** (EN \`feature help\`,
DE \`element hilfe\`; typ i slovem příkazu – \`nápověda díra\`, \`nápověda kužel\`, u rozšíření id: \`prvek nápověda sheet.bend\`):
název, druh hodnoty a ukázka zápisu, jednotka, povolené hodnoty, výchozí / povinné, význam a zápis vlastním textovým příkazem
(„jen prvek / upravit / JSON“ = vlastní zápis nemá). \`prvek nápověda\` bez typu vypíše přehled všech typů a polí, která jdou
zadat jen přes \`prvek\` / \`upravit\`. **Hledání:** \`nápověda hledat <slova>\` (i \`nápověda <slova>\`, když slovo není typ prvku)
prohledá tento návod, tabulku příkazů i příručku /cad/dokumentace a vypíše 5–8 nejlepších oddílů (název + příkazy + věta,
≤ 1,5 kB; ve stručném protokolu \`= L3 help hits=6 q="záložky"\` a výsledky na pokračovacích řádcích – stejný řádek je
i na začátku výpisu v konzoli prohlížeče). Víc hledání v jednom běhu si stručný protokol dělí: každé má svůj řádek
\`= L<n> help hits=3 of=8 q="…"\` s méně výsledky (všechny jsou v plném protokolu); dlouhý dotaz je v \`q\` zkrácený na 80 B.
\`nápověda tahák\` vypíše tahák nejčastějších příkazů – jeho příkazy jdou za sebou jako jeden skript.

Všechny rozměry jsou v **milimetrech**, úhly ve stupních, desetinná čárka i tečka jsou povolené, „Ø“ před číslem
se ignoruje. Souřadný systém: Z nahoru, XY je půdorys. Počátek je v rohu kvádru (bez „střed“) nebo ve středu válce.

## Řádkové příkazy (česky i anglicky, jeden příkaz na řádek, \`#\` = komentář)

| Příkaz | Význam |
| --- | --- |
| \`nový díl [název] [znovu\|nový]\` / \`nová sestava [název] [znovu\|nový]\` | nový dokument v nové záložce; opakovaný běh použije záložku stejného názvu, kterou založil dřívější běh (ℹ \`doc.reused\`; otevřený soubor / JSON téhož názvu ne – ℹ \`doc.name-taken\`), \`nový\` = vždy nová záložka, \`znovu\` = převzít i otevřenou |
| \`název …\`, \`materiál …\`, \`barva #hex\` | popis dokumentu |
| \`kvádr X Y Z [střed] [v x y z] [osa …] [odebrat|průnik|nové]\` | kvádr; roh v poloze, „střed“ = poloha je střed kvádru; \`osa\` natočí osu Z kvádru |
| \`válec D H [v x y z] [osa X|Y|Z|-Z|x y z|hrana E3|plocha F2|"Osa 1"] [odebrat|průnik|nové]\` | válec průměr × výška; poloha = střed podstavy, roste ve směru osy |
| \`koule D [v x y z]\` · \`kužel D1 D2 H [v …] [osa …]\` · \`trubka D d H [v …] [osa …]\` – vše i \`[odebrat|průnik|nové]\` | další primitiva (průměry; u kužele D2 = 0 → špička) |
| \`pružina D stoupání P závity N|délka L drát d [v …] [osa …]\` | šroubovitá pružina (D = střední průměr) |
| \`… na V3 | na střed hrany E2 | na střed kružnice E5 | na střed plochy F3 | na bod "Bod 1" | na mezi V1 V5\` · \`… osa hrana E3 | osa plocha F2 | osa body V1 V5 [obráceně]\` | poloha a osa **odkazem** u všech primitiv i u \`závit\` – viz „Primitiva – poloha a osa odkazem“ |
| \`skica XY|XZ|YZ [odsazení N]: entita; entita…\` | skica na základní rovině; entity i na dalších řádcích |
| \`skica počátek x y z normála nx ny nz [osax ux uy uz]: …\` | skica na obecné rovině (viz „Souřadnice skici ve 3D“) |
| \`skica plocha F3|horní|+X [odsazení N] [obráceně]: …\` · \`skica rovina "Rovina 1" [odsazení N]: …\` | skica na rovinné ploše modelu (číslem nebo pravidlem) nebo na pomocné rovině – viz „Vazby a kóty ve skice textem“ |
| \`obdélník W H [v x y]\` / \`obdélník W H roh x y\` | obdélník středem (výchozí počátek) nebo rohem |
| \`kružnice D [v x y]\` / \`kružnice poloměr r\` | kružnice |
| \`mnohoúhelník N D [v x y]\` · \`drážka L W [úhel a]\` · \`úsečka x1 y1 x2 y2\` · \`bod x y\` · \`elipsa rx ry\` | další entity; předpona \`pomocná\` = konstrukční |
| \`čára x1 y1 x2 y2 [r N] x3 y3 … [uzavřít|otevřená]\` | lomená čára; \`r N\` za bodem zaoblí tento roh poloměrem N (vzniknou úsečky a tečné oblouky); kdy se uzavře – viz „Profil ze skici textem – uzavřené obrysy“ |
| \`oblouk x1 y1 xm ym x2 y2\` | oblouk třemi body: začátek, bod na oblouku, konec |
| \`spline x1 y1 x2 y2 x3 y3 … [uzavřít]\` | hladká křivka přes zadané body |
| \`vazba <druh> <odkaz> [<odkaz> …]; <druh> …\` | vazba ve skice (vodorovně, kolmo, tečně, shodně…); odkazy na entity \`e1\`, \`e1.a\`, \`počátek\` |
| \`kóta <druh> <odkaz> [<odkaz>] <hodnota> [referenční]; …\` | kóta ve skice (délka, vzdálenost, vodorovně, svisle, poloměr, průměr, úhel, délka oblouku) |
| \`vysunout H|výška H [směr x y z|směr +X|směr hrana E3|směr osa "Osa 1"|směr plocha F2|směr body V1 V2] [sklon a [k +X|k x y z]] [symetricky] [skrz|k tělesu|k dalšímu|k ploše F3 [odsazení N]|k rovině "Rovina 1"|k vrcholu V3] [odebrat|přidat|průnik|nové] [obráceně] [úkos a [dovnitř|ven] [břit N] [ostré rohy|zaoblené rohy]]\` | vysune poslední skicu; šikmo (\`sklon 25 k +X\` = propad), úkos dovnitř / ven s břitem (střižnice) – viz „Šikmé vysunutí, úkos dovnitř / ven a břit“ |
| \`rotovat [úhel] [osa X|Y|Z] [odebrat|přidat|průnik|nové]\` | orotuje poslední skicu (výchozí osa Y skici, 360°); \`odebrat\` = vysoustružit profil z tělesa |
| \`díra D [hloubka H [dno ploché | hrot 118]|skrz [obousměrně]|k tělesu] v x y [z] [v x y [z] …] [osa Z] [zahloubení D2 H2 | kuželové D2] [závit M8 [hloubka-závitu T] [jádro | vrták [N]]]\` | bez z = díra začíná na povrchu tělesa v daném místě (zjistí se ze sítě modelu) a vrtá dolů; \`skrz\` vrtá **od zadaného bodu jen ve směru vrtání** (materiál nad bodem zůstane), \`obousměrně\` na obě strany; \`k tělesu\` (EN \`to body\`, DE \`bis Körper\`) vrtá po první stěnu stávajícího tělesa – projde první stěnou ve směru vrtání a dál nepokračuje (např. jen horní stěnou dutého dílu), jako ukončení „K tělesu“ u vysunutí; \`závit M6\` vrtá tabulkový vrták (viz další řádek), \`hloubka\` = hloubka vrtání, \`hloubka-závitu\` = užitečná délka závitu (výkres pak ukáže „M8 ↧10“ + „Ø6,8 ↧14“, u průchozí díry „M8 ↧12“ + „Ø6,8 skrz“; stav „…, délka závitu 12“) |
| \`díra závit M8 hloubka 20 v x y\` · \`díra 6,647 závit M8 …\` · \`díra závit M8 … jádro\` · \`díra závit M8 … vrták 6,7\` | **průměr vrtáku závitové díry**: bez průměru = tabulkový vrták (M8 → Ø6,8, jemný M18×1,5 → Ø16,5); **zadaný průměr má přednost** (protokol: „vrták Ø6,647 zadán ručně (tabulkový 6,8)“); jmenovitý průměr (\`díra 8 závit M8\`) i nesmyslně malé zástupné číslo (pod D1 − P, např. \`díra 5 závit M18×1,5\` ze starších zápisů) = tabulkový vrták s poznámkou v protokolu; \`jádro\` (EN \`core\`/\`minor\`, DE \`Kern\`) = malý průměr vnitřního závitu D1 = D − 1,082532·P podle ISO 965-1 (M8 → 6,647, M12 → 10,106, M18×1,5 → 16,376); \`vrták\` (EN \`drill\`, DE \`Bohrer\`) = tabulkový, \`vrták 6,7\` = vlastní; vrták větší než závit = chyba. Označení \`M8\` lze psát i bez slova \`závit\`. Výkres u jiného než tabulkového vrtáku uvede i řádek vrtáku („M8 ↧20“ + „Ø6,647 ↧20“), stav ukáže „(vrták = jádro D1 Ø6,647)“. V JSON je to pole \`tapDrill\`: \`"table"\` (nebo chybí) / \`"minor"\` / \`"custom"\` + \`diameter\` – v JSON bez \`tapDrill: "custom"\` se \`diameter\` závitové díry nepoužije (stavba to ohlásí ⚠). \`upravit "Díra 1" diameter=6,647\` a \`prvek hole … kind=tapped thread=M8 diameter=6,647\` platí jako text (zadaný průměr má přednost, \`tapDrill\` se doplní); \`tapDrill=\` přijme jen \`table\` / \`minor\` / \`custom\` (i \`tabulkový\` / \`jádro\` / \`vlastní\`); změna závitu (\`thread=M10\`, formulář) ponechá vlastní vrták, jen když se k novému závitu hodí (D1 − P až pod D), jinak vrtá tabulkový s poznámkou. Volby díry pište **před** \`název\` – vše za \`název\` až do další volby je název (\`… název M8\` je díra pojmenovaná M8, ne závit) |
| \`díra D hloubka H dno ploché\` · \`díra D hloubka H hrot 120\` | **dno slepé díry**: výchozí kužel hrotu vrtáku 118°; \`hrot N\` (EN \`tip\`, DE \`Spitze\`) = jiný vrcholový úhel 60–170°; \`dno ploché\` / \`ploché dno\` (EN \`flat bottom\`, DE \`flacher Grund\`) = rovné dno bez kužele (sedlo pružiny, frézované dno; v JSON \`tipAngle: 180\`); také \`ploché\`, \`s plochým dnem\`, \`bez hrotu\`, \`dno=ploché\`, \`dno kužel 120\` (EN \`flat\`, \`without tip\`, DE \`ohne Spitze\`); slovo podobné volbě dna, kterému CAD nerozumí, je chyba řádku. Hloubka H je vždy hloubka válcové části (u plochého dna celá hloubka). Platí i pro závitovou a zahloubenou díru; u díry skrz / k tělesu je to chyba; úhel mimo 60–170° je chyba i v \`upravit\` / \`prvek\` (v JSON jádro úhel ořízne a ohlásí ⚠, stav i výkres ukazují použitý úhel). \`měřit díry\` vypíše „dno ploché“ (i se souosou dírou ze dna) nebo „hrot 118° (ke špičce …)“, výkres u plochého dna připíše „(ploché dno)“ |
| \`díra D … směr vx vy vz\` · \`díra D … sklon úhel [směr +X]\` | šikmá díra: \`směr\` = směr vrtání vektorem; \`sklon\` = odklon od osy díry (výchozí k +X u osy Z). Stav ukáže skutečný směr vrtání: „osa Z“ bez dalšího = výchozí shora dolů (−Z, u osy X −X, u osy Y −Y); jinak „…, osa Z, vrtá +Z“ (\`směr 0 0 1\`, \`obráceně\`) nebo „…, osa Z, směr vrtání [0,707; 0; -0,707]“ (šikmá díra) |
| \`díra D skrz v x1 y1 [z1] v x2 y2 [z2] …\` | více děr jedním příkazem: **každé \`v\` = jedna poloha** (EN \`at\`, DE \`bei\`); 2 čísla = dvě souřadnice napříč osou vrtání (osa Z: x y, osa X: y z, osa Y: x z) a díra začíná na povrchu tělesa právě v tomto místě (jako u jedné polohy), 3 čísla = x y z přesně; polohy lze míchat (\`v 10 20 v 30 20 5\`), čísla se mezi polohami nikdy nepřelévají; poloha s 1 nebo 4 a více čísly je chyba řádku („díra: poloha 2 „v 15,1“ – počet čísel 1 …“) a nevznikne žádná díra. Stav vypíše všechny polohy bez zkracování, i 20 a víc („· polohy (3): [10; 20; 30] [30; 20; 30] [30; 20; 5]“) |
| \`díra 6,8 skrz v 15,1 -30 v 15,1 -90 zahloubení 20 7 závit M8\` · \`díra závit M8 hloubka 20 kuželové 10 v x y\` | **závitová díra se zahloubením** = zahloubení + vrták + závit (sedlo pružiny nad závitem, sražení vstupu); EN \`counterbore 20 7 thread M8\` / \`countersink 10\`, DE \`senkung 20 7 gewinde M8\` / \`kegelsenkung 10\`. Vrták podle pravidel závitové díry (tabulkový / zadaný / \`jádro\`), hloubky se měří od povrchu (zahloubení 0–7, vrták po hloubku díry). Výkres: „M8 skrz“ + „Ø6,8 skrz“ + „⌴ Ø20 ↧7“ (kuželové „⌵ Ø10 × 90°“), stav „M8 skrz (vrták Ø6,8) zahl. Ø20×7“, \`měřit díry\` ukáže zahloubení Ø20 (slepá, hloubka 7) a vrták Ø6,8, kontrola kót čeká závit, vrták, Ø a hloubku zahloubení. Zahloubení menší než závit (\`zahloubení 7,5 3 závit M8\`) postaví, ale výsledek stavby hlásí ⚠; \`zahloubení\` i \`kuželové\` najednou = chyba řádku. JSON: \`{ "type": "hole", "kind": "tapped", "thread": "M8", "head": "counterbore", "cbDiameter": 20, "cbDepth": 7, … }\` (\`"head": "countersink"\` + \`csDiameter\`, \`csAngle\`); \`prvek hole kind=counterbore thread=M8 …\` i \`upravit "Díra 1" thread=M8\` nebo \`upravit "Díra 1" kind=tapped thread=M8\` u zahloubené díry udělá totéž (protokol to oznámí, zahloubení se nikdy tiše nezahodí), \`head=\` přijme counterbore | countersink | none (i \`zahloubení\` / \`kuželové\`, DE \`Senkung\` = válcové jako v textu, \`Kegelsenkung\` = kuželové); \`head=none\` smaže i uložené rozměry zahloubení. Závitová díra bez \`head\` zahloubení nemá (geometrie starších dokumentů beze změny), ale má-li uložené \`cbDiameter\`/\`cbDepth\` (dřívější zápis \`zahloubení 20 7 závit M8\`), stavba hlásí ⚠ „Uložené zahloubení Ø20×7 se nevrtá …“ a stav „(uložené zahl. Ø20×7 se nevrtá – chybí head)“ – opravíte \`upravit "Díra 1" head=counterbore\` (zahloubit) nebo \`head=none\` (smazat). ⚠ jen při zahloubení menším než závit (Ø8 u M8 je v pořádku) |
| \`zaoblit R [hrany vše|horní|spodní|svislé|vodorovné|kruhové|rovné|+Z|-Z|+X|-X|+Y|-Y] [poloměr N] [delší N] [kratší N]\` | pravidla lze kombinovat: \`hrany horní kruhové\` |
| \`srazit C [hrany …]\` | sražení hran, stejná pravidla |
| \`zaoblit R hrany <pravidlo> setback S [vrchol V3 S2]\` | zaoblení se setbackem: ve vrcholu se 3+ zaoblenými hranami skončí zaoblení S od vrcholu a roh uzavře hladká záplata (G1) – viz „Zaoblení se setbackem, eliptické zaoblení a úkos s dělicí křivkou“ |
| \`zaoblit eliptické D1 D2 hrany <pravidlo> [rho 0,5]\` | eliptické / kuželosečkové zaoblení: D1 na první (horní) ploše, D2 na druhé |
| \`úkos A plochy <pravidlo|F1 F2…> [dělicí "Skica 2"] [stupňovitý] [směr +Z]\` · \`úkos A plochy boční [rovina XY] [odsazení N]\` | úkos ploch; s dělicí křivkou na obě strany od dělicí čáry, \`stupňovitý\` = každý úsek od vlastní roviny |
| \`skořepina T [otevřít +Z|horní|boční|největší]\` | vydlabání; otevřené plochy pravidlem |
| \`pole N rozteč P [směr X|Y|Z] [N2 rozteč P2 směr Y]\` · \`pole kruhové N [úhel 360] [osa Z] [v cx cy cz]\` | pole posledního prvku |
| \`zrcadlit XY|XZ|YZ [odsazení N]\` | zrcadlení tělesa |
| \`text "ABC" výška H hloubka D v x y [z] [gravírovat]\` | nápis vystouplý / gravírovaný |
| \`těleso N\` · \`rozdělit XY|XZ|YZ [odsazení N] [jako Název]\` · \`kopie [těleso N] [posun dx dy dz] [jako Název]\` · \`sloučit <cíl> <nástroj> [odebrat|průnik] [ponechat]\` | více těles v dílu (viz níže) |
| \`prvek <typ|rozšíření> klíč=hodnota …\` | kterýkoli typ prvku i prvek rozšíření bez JSON (viz níže) |
| \`normálie <označení> [v x y z]\` | díl z knihovny (M8x30, ložisko 6204, pero 8x7x40): v dílu nová záložka, v sestavě komponenta |
| \`vložit "název záložky" [v x y z] [otočení rx ry rz] [ukotvit] [jako "K48"]\` | sestava: vloží díl z otevřené záložky jako komponentu; \`jako\` (EN \`as\`, DE \`als\`) = přezdívka instance pro vazby místo #k |
| \`sestava\` · \`sestava plochy "Čep" [rovinné|válcové]\` · \`sestava vazba <druh> "A" <plocha> "B" <plocha> [hodnota N] [obráceně]\` · \`sestava vazby\` · \`sestava vazba 2 hodnota=5|obráceně|potlačit|zapnout|smazat\` · \`sestava vazba 2 plocha b F6\` | sestava textem: komponenty, plochy pro vazby, trvalé vazby a jejich správa (viz „Sestava textem“) |
| \`sestava vazba ozubení|šroub|hřeben|vačka|kardan|kolmo|tečně|shodně|symetricky|šířka|dráha|drážka|závěs|zámek|mez … "A" <F|E|V> "B" <F|E|V> [poměr|stoupání|min|max]\` · \`pohyb motor rotační "Klika" 0..360 krok 5 [kolize]\` · \`pohyb stav|krok N|přehrát|export csv\` | pokročilé a mechanické vazby (23 druhů) a pohybová studie (viz „Pokročilé a mechanické vazby, pohybová studie“) |
| \`sestava komponenta "X" [v x y z] [otočení …] [posun …] [ukotvit|uvolnit] [skrýt|zobrazit] [barva #hex] [název "…"] [číslo "…"] [skupina "…"] [materiál …] [přezdívka "…"]\` · \`sestava odebrat|duplikovat|izolovat "X"\` · \`sestava zobrazit vše\` | vlastnosti komponenty jako v panelu |
| \`sestava pružina "P" mezi "A" [F3] "B" [F7] [volná L0] [blok Ln] [tuhost c] [vedená ano|ne]\` · \`sestava pružina "P" odebrat\` · \`sestava pružiny\` | pružina mezi komponentami: délka podle dosedacích ploch při přepočtu vazeb i v pohybové studii, síla, kontrola dorazu (viz „Pružina v sestavě“) |
| \`sestava pružina nová [d 2] [De 20] [L0 35] [n 6] [tuhost c] [blok Ln] mezi "A" Ø21 "B" horní [v x y z] [do děr vzoru] [název "P"]\` · \`sestava pružina "P" mezi "A" "B" do děr vzoru\` | nová pružina z tabulky mezi díly (osa z díry / roviny, zámek k A) a kopie do všech děr vzoru (viz „Pružina v sestavě“) |
| \`pohyb dynamika [čas T] [krok dt] [gravitace -Z\|vyp] [tlumení c] [odraz e]\` · \`pohyb hmotnost "X" kg\` · \`pohyb síla vazba N F\` · \`pohyb kinematika\` | dynamická pohybová studie: síly pružin, gravitace a zadané síly hýbou díly, dorazy s odrazem (viz „Dynamika“) |
| \`pohyb kvazistatika\` · \`pohyb kinematika\` · \`pohyb automaticky\` · \`pohyb motor … na mezi stop\|chyba\` · \`sestava vazba N preferovat min\|max\|ne\` | režim a úroveň studie, motor na mezi, preferovaná strana meze (viz „Režim studie, priorita podmínek“) |
| \`sestava pole "X" N rozteč P [směr Y]\` · \`sestava pole "X" kruhové N [osa Z] [v cx cy cz]\` · \`sestava zrcadlit "X" YZ\` · \`sestava šroub "Deska" Ø9 [matice] [bez podložky]\` | pole, zrcadlení, šroubový spoj do díry |
| \`sestava podsestava "A" "B" [jako "…"]\` · \`sestava rozpustit "P"\` · \`sestava upravit "X"\` … \`sestava hotovo\` · \`sestava otevřít "X"\` | podsestavy, úprava dílu v kontextu sestavy |
| \`kusovník [strukturovaně] [csv]\` · \`rám formy [šířka délka] [dutina X Y H] …\` · \`záložky\` · \`záložka "název"|N\` · \`zavřít záložku\` | kusovník do protokolu, rám vstřikovací formy, záložky dokumentů |
| \`výkres\` | otevře výkres otevřeného dokumentu v záložce |
| \`výkres [A4|A3|A2|A1|A0] [na šířku|na výšku] [měřítko 1:2|auto] [pohledy přední,horní,levý,pravý,zadní,spodní,iso] [řez XZ|YZ|XY [odsazení N]|ne] [skryté ano|ne] [osy ano|ne] [tabulka děr ano|ne] [promítání E|A]\` | volby aktivního listu výkresu (\`výkres list N\`; bez něj první list – založí ho, chybí-li) a otevře výkres; **odsazení řezu jako u skici** (podél normály roviny: \`řez XZ odsazení 57\` = rovina Y = −57 jako \`skica XZ odsazení 57\`; XY → Z = N, YZ → X = N); rovina mimo těleso = ✗ s rozsahem odsazení, \`⚠ Pohledy se v měřítku … nevejdou na list …\` při volbách listu; tabulka děr obsahuje jen díry (vnitřní – konkávní – válcové plochy), vnější válce soustruženého dílu (hřídel, osazení) v ní nejsou; jedna díra = jeden řádek (zahloubení nad vrtákem se sloučí: „M8 ⌴Ø20“), bere díry s osou ve směru pohledu shora, a nevidí-li tam žádnou, pohled listu s nejvíc dírami; \`výkres stav\` vypíše „Tabulka děr (pohled horní, 3): A1 M8 Ø6,8 ⌴Ø20 [20; 80] · …“ (X; Y od levého dolního rohu obrysu pohledu, jako souřadnicové kóty) a díry s jinou osou, které v tabulce nejsou |
| \`kótovat [chytře|celkově|nic] [řetězově|od základny] [funkční 26,5 74,175] [díry tabulka|souřadnicově|řetězově]\` | Chytré kóty podle prvků modelu (viz „Výkres a kóty“) – nahradí jen vygenerované kóty; \`funkční\` = rozměry, které nikdy nebudou pomocné „(…)“; \`díry\` = polohy děr tabulkou / souřadnicovými kótami / od hran (výchozí auto) |
| \`výkres tolerance <kóta> <tolerance> [pohled <p>]\` · \`výkres kontrola tolerancí\` · \`výkres poznámka "…"\` · \`výkres nepředepsané ISO 2768-mK\` · \`výkres hrany ISO 13715 …\` · \`výkres drsnost Ra 3,2\` | tolerance ke kótě podle **číselné hodnoty modelu** (\`74,175 -0,005\`, \`Ø40 h6\`, \`M8 6H\`) nebo id (\`a12\`); kontrola funkčních rozměrů bez tolerance; údaje u razítka |
| \`výkres kontrola kót\` · \`výkres doplnit kóty [polohy\|velikosti\|vše\|3 5]\` · \`funkční F7 [H7]\` · \`funkční "Díra 1" [±0,02]\` · \`základna A F3\` · \`funkční [zrušit …]\` (EN \`drawing check dims\`, \`drawing complete dims\`, \`functional\`, \`functional datum A F3\`; DE \`zeichnung prüfen maße\`, \`zeichnung maße ergänzen\`, \`funktional\`, \`bezug A F3\`) | kontrola kót pro výrobu po položkách (✓ / ◐ / ✗ / – nezkontrolováno, čísla položek): velikosti a polohy prvků výsledného dílu podle geometrie kót, pomocná tělesa se nekótují; doplnění navržených kót; funkční prvky a základny v modelu (velikost, poloha od základny, tolerance) |
| \`výkres stav\` | textový stav výkresu: list, měřítko, pohledy, všechny kóty po pohledech, duplicity, chybějící rozměry, co se nevešlo (také \`window.mncad.drawingStatus()\`) |
| \`měřit F3|E5|V2 [F7|E9|V8|x y z]\` · \`měřit těleso|díry|válce\` · \`měřit plocha|hrany <pravidlo>\` | měření pro kontrolu modelu (viz „Měření“); také \`window.mncad.measure()\` |
| \`výkres list 2\` · \`výkres list nový "Detail"\` · \`výkres list přejmenovat 2 "…"\` · \`výkres list smazat 2\` · \`výkres stav [list N|vše]\` | listy výkresu – další příkazy výkresu pracují s vybraným listem (viz „Výkres textem: listy, značky, kóty, export“) |
| \`výkres nový ["Montážní"]\` · \`výkres výkresy\` · \`výkres výkresy 2\` · \`výkres výkresy přejmenovat 2 "…"\` · \`výkres výkresy smazat 2\` | další výkres téhož dílu (Výkres 2…) s vlastními listy; čísla listů, razítko „List 1/2“ a \`vše\` platí uvnitř aktivního výkresu |
| \`výkres export pdf|dxf|dwg|svg|csv|png [vše|list N] [R2018]\` | soubor výkresu (v aplikaci se uloží / stáhne); \`vše\` = všechny listy aktivního výkresu: PDF vícestránkové, DXF / DWG / SVG / PNG jako ZIP s jedním souborem na list |
| \`výkres razítko číslo="MN-1" kreslil="AI" …\` · \`výkres revize B "popis"\` · \`výkres otočení 90\` · \`výkres řez XZ poloviční\` · \`výkres kusovník ano\` · \`výkres balónky ne\` · \`kótovat základní\` | razítko, revize a další volby listu |
| \`výkres pohled pomocný přední hrana x1 y1 x2 y2\` · \`výkres řez zalomený|natočený|částečný …\` · \`výkres přerušení přední x od 50 do 250\` · \`výkres uložení Ø40 H7\` · \`výkres revize značka B na Ø40\` · \`výkres zóny ano\` | pomocný pohled, řezy lomenou čarou, částečný řez, přerušený pohled, uložení ISO 286 s Tabulkou uložení, trojúhelníky revizí a zóny (viz „Pomocné pohledy, řezy lomenou čarou, přerušení, uložení a revize“) |
| \`výkres značka drsnost Ra 1,6 na Ø40\` · \`výkres kóta vodorovně pohled přední x1 y1 x2 y2\` · \`výkres upravit a3 odsazení=8\` · \`výkres smazat a3\` · \`výkres detail přední v x y poloměr r\` · \`výkres model "Hřídel"\` | značky, ruční kóty, úpravy, detaily a další modely – vše, co jde ve výkrese myší; export \`window.mncad.exportDrawing("pdf")\` |
| \`kolo čelní|šikmé|šípové|vnitřní|hřeben|kuželové|hypoidní|šnek|šnekové|cykloidní|cyklodisk|řetězové|řemenice|rohatka m 2 z 24 … [díra 20 pero] [náboj 40 15] [polotovar|zuby]\` · \`kolo tabulka [vše|"název"]\` · \`kolo nápověda [druh]\` | ozubené kolo z tabulky (jeden prvek „Ozubené kolo …“), tabulka ozubení do protokolu, řádky tabulky druhu (viz „Kola a ozubení“) |
| \`soukolí čelní m 2 z1 20 z2 60 [a 81] [x1 …] [x2 …] [vůle 0,05] [díra1 12] [díra2 20]\` · \`výkres tabulka ozubení ano|ne\` | soukolí: dva díly + sestava s vazbou ozubení ve správném záběru, posunutí z osové vzdálenosti; tabulka ozubení na výkrese |
| \`smazat poslední\` · \`stav\` · \`zobraz iso|přední|horní…\` · \`kolize\` · \`kolize seznam [třída]\` · \`kolize pravidlo pracovní "A" "B" [kroky 10..20]\` · \`kolize tolerance 0,01\` | správa; kolize = kontrola průniků komponent sestavy po třídách (viz „Třídy, místo a pravidla kolizí“) |
| \`uložit [název]\` · \`export step|stl|brep|obj|glb|3mf|wrl|mncad [název]\` · \`výkres export pdf|dxf|dwg|svg|csv|png [list N|vše] [název]\` · \`skica export dxf ["Skica 1"]\` | výstupy **bez dialogu** – soubor se rovnou stáhne, protokol napíše název, velikost a formát; u STEP / BREP kontrolu „věrná kopie modelu“ (viz „Výstupy z konzole bez dialogů“) |
| \`sdílet [model|výkres] [dní N|bez omezení] [heslo X] [od "Jméno"]\` · \`odkaz\` · \`odkaz ověřit [odkaz] [heslo X]\` | sdílený odkaz – konzole vypíše řádek \`URL: …\`, CLI / JSON výpis \`= L<n> link … url=… mode=… exp=… content=…\` (každý odkaz běhu) a řádek \`O\`; \`odkaz\` ho vypíše znovu, \`odkaz ověřit\` ho otevře jako příjemce a vypíše režim, platnost a obsah (nebo proč se neotevře) |
| \`upravit\` · \`potlačit\` / \`zapnout\` · \`smazat <prvek>\` · \`přejmenovat\` · \`přesunout\` · \`duplikovat\` · \`zpět\` / \`znovu\` · \`proměnná\` · \`konfigurace\` · \`skica "Skica 1"\` · \`entita\` · \`kóta k1\` · \`odsadit\` · \`promítnout hrany\` | úpravy hotového modelu a skici na místě – viz „Úpravy existujícího modelu“ |
| \`zobraz stínovaný|hrany|drátový|skryté|průhledný|přizpůsobit\` · \`řez X|Y|Z [poloha] [obráceně]\` · \`řez vyp\` | styl 3D okna a řez modelem (viz „Soubory, obraz, výstupy a analýzy“) |
| \`barva plochy F3 [F5 …]|<pravidlo> #rrggbb|výchozí\` · \`akce <id|popisek>\` | barva ploch; akce rozšíření bez prvku (rozvin DXF / SVG, tabulka ohybů, kusovník řezů, tabulka svarů, tloušťka stěn, skica DXF) |
| \`analýza úkosů|tloušťky|křivosti|zebra|vyp\` · \`dělicí rovina\` · \`vyhazovače …\` · \`chlazení …\` · \`smrštění 0,5\` | formařské nástroje a analýzy jako text |

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
- \`vysunout H\` jde ve směru normály (u roviny XZ směrem −Y), \`obráceně\` opačně, \`symetricky\` na obě strany; šikmo
  \`směr …\` / \`sklon …\` (viz „Šikmé vysunutí, úkos dovnitř / ven a břit“).
- U obecné roviny se bez \`osax\` zvolí X skici kolmo na normálu co nejblíž ose X modelu (u normály ±X ose Y). V JSON je
  to \`"plane": { "kind": "custom", "origin": [x,y,z], "normal": [nx,ny,nz], "xDir": [ux,uy,uz] }\`.

### Profil ze skici textem – uzavřené obrysy

Vysunout, rotovat nebo táhnout jde jen **uzavřený obrys**: řetěz entit, kde každý konec navazuje přesně na konec další
entity (úsečka, oblouk, spline, lomená čára), nebo uzavřený tvar (obdélník, kružnice, mnohoúhelník, drážka, elipsa,
uzavřená čára). Kdy je \`čára\` (lomená čára, i se zaoblenými rohy \`r N\`) uzavřená:

1. \`uzavřít\` (EN \`close\`, DE \`schließen\`) a \`otevřená\` (EN \`open\`, DE \`offen\`) platí **vždy** (slovo smí stát kdekoli).
2. První bod = poslední bod → uzavřená (opakovaný bod se vynechá).
3. Jinak rozhodne **celá skica**: tvoří-li čára s dalšími entitami **uzavřený obrys** (oba její konce propojuje řetěz
   jiných entit – úseček, oblouků, splinů, čar; konce do 0,05 mm), je **otevřená** – je částí obrysu složeného z více
   entit. Jinak se uzavře (samostatný obrys, jako dřív) a protokol napíše
   \`ℹ čára e3 uzavřena – konce nebyly napojené; „otevřená“ ji nechá otevřenou\` (navazuje-li jen jedním koncem, třeba
   lopatky z jednoho středu: \`… uzavřena – navazuje na e2, ale uzavřený obrys s nimi netvoří …\`). Čára, kterou by
   uzavírací úsek křížil nebo překrýval (neplatný obrys), zůstane otevřená (\`ℹ čára e1 je otevřená – uzavírací úsek by ji
   křížil nebo překrýval v [30; 15] …\`). Vznikne-li obrys až **pozdějším řádkem** nebo úpravou \`entita …\`, čára se
   otevře (\`ℹ čára e1 otevřena – na její konce nově navazuje e3\`) – obrys tedy smíte psát po řádcích v libovolném
   pořadí. Pomocné entity (\`pomocná …\`) rozhodují jen mezi sebou.
4. Jako **dráha** (tažení – dráha i vodicí křivka, žebro, plechové žebro, pole podél křivky, dělicí čára úkosu) se
   automatické uzavření **nepoužije**: osamocená \`čára 0 0 0 50 r 10 50 50\` je tam otevřená křivka (L se zaobleným
   rohem); uzavřenou dráhu napište s \`uzavřít\`.

Stav skici (\`stav\`) u každé čáry vypíše \`otevřená\` / \`↺ uzavřená\` / \`↺ uzavřená automaticky\` a řádek **profil:** –
\`profil: 1 uzavřený obrys (e1–e3) ✓\`, nebo \`profil: … · ⚠ problémů N:\` a pod ním každý problém zvlášť s id entit a
souřadnicemi: \`otevřený konec e5 v [10; 20]\`, \`mezera 0,02 mm mezi e1 [20; 10] a e2 [20,02; 10]\`, \`e2 kříží e7 v [x; y]\`,
\`e3 kříží sama sebe v [x; y]\`, \`e5 se dotýká e2 v [x; y]\` (konec uprostřed jiné entity), \`e1 a e5 se překrývají v úseku …\`,
\`e1 a e5 jsou duplicitní\`, \`v bodě [x; y] se stýká 3 konců\` (větvení), \`e1 byla uzavřena automaticky a její uzavírací
úsek kříží e2\`, \`otevřený konec e2 v [20; 10] leží na obrysu e1 – e2 do žádného obrysu nepatří; e1 je uzavřená čára –
má-li být částí obrysu s e2, napište u ní „otevřená“\` (entita visí na obrysu, ale profil ji nepoužije). Selže-li
vysunutí / rotace / tažení, chyba prvku (✗) obsahuje tytéž důvody (\`Profil skici „Skica 1“: otevřený konec e1 v [0; 40];
…\`); projde-li prvek s vadným profilem (křížení, překryv, mezera, entita s koncem na obrysu, která do něj nepatří…),
dostane ⚠ se stejným popisem – **✓ bez ⚠ znamená, že profil použil všechny křivky skici**. Opravte souřadnice
(\`entita e4 a=0;40\`), uzavření (\`entita e1 uzavřená=ne\`), smažte duplicitu (\`smazat e5\`) nebo doplňte chybějící entitu.
U velkých skic se počítá nejvýš 500 problémů (\`problémů 500+\`) a průsečíky se nehledají nad 4000 úseků.

Profil z úseček, oblouků a lomených čar (po řádcích; obě čáry zůstanou otevřené, vznikne jeden obrys, 13,21 cm³):

\`\`\`
nový díl Úhelník
skica XY
čára 0 0 80 0 80 10 20 10
oblouk 20 10 12,928932 12,928932 10 20
čára 10 20 10 60 0 60 0 0
vysunout 10
stav
\`\`\`

Osamocená čára jako samostatný obrys (uzavře se automaticky; jistější je napsat \`uzavřít\`):

\`\`\`
nový díl Trojúhelník
skica XY: čára 0 0 60 0 60 40
vysunout 5
stav
\`\`\`

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
  (druhy: horizontal/waagerecht, vertical/vertikal, coincident/deckungsgleich, parallel, perpendicular/senkrecht (i rechtwinklig),
  tangent/tangential, equal/gleich, fixed/fest, concentric/konzentrisch, midpoint/mittelpunkt, onCurve/aufKurve,
  symmetric/symmetrisch, collinear/kollinear; length/Länge, distance/Abstand, radius, diameter/Durchmesser, angle/Winkel,
  arcLength/Bogenlänge). Více vazeb nebo kót na jednom řádku oddělte středníkem.
- Německy je \`senkrecht\` **kolmo** (jako tlačítko „Senkrecht“): \`bedingung senkrecht e1 e2\`; svisle je \`vertikal\`
  (\`bedingung vertikal e2\`, \`bedingung vertikal e1.a e2.b\`). Starší skript s \`senkrecht e1\` (jedna úsečka) nebo
  \`senkrecht e1.a e2.b\` (dva body) skončí na řádku ✗ s radou napsat \`vertikal\` – nic se nezamění potichu. U kót
  \`bemaßung senkrecht …\` dál znamená svislou kótu (kolmá kóta neexistuje), protokol píše \`vertikal\`; totéž ve výkresu
  (\`zeichnung maß vertikal|senkrecht ansicht vorne …\`).
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

### Šikmé vysunutí, úkos dovnitř / ven a břit – \`vysunout …\`

EN \`extrude 20 tilt 25 toward +X\`, \`extrude through cut reverse draft 2 out land 3\`; DE \`extrudieren 20 neigung 25 nach +X\`,
\`extrudieren durch abziehen umkehren schräge 2 außen steg 3\`. Neznámé slovo za \`vysunout\` je chyba (nic se tiše nevynechá) –
také volba jiného příkazu (\`úhel 25\` → použijte \`sklon 25\`, \`odsazení 5\` bez \`k ploše\`, \`v x y\`, \`poloměr\`…), přebytečné číslo
(\`vysunout 20 30\`) a délka zadaná dvakrát (\`vysunout 20 výška 15\`).

**Směr** (výchozí = normála skici). Odkaz se píše **vždy za slovo \`směr\`** – samotné \`hrana E3\`, \`osa "Osa 1"\`, \`plocha F2\`
nebo \`body V1 V5\` je chyba s nápovědou (jinak by je obecný rozbor vzal jako hrany zaoblení, název tělesa…):

| Zápis | Směr |
| --- | --- |
| \`směr 1 0 1\` · \`směr +X\` · \`směr -Y\` | vektor / osa modelu (EN \`direction\`, DE \`richtung\`) |
| \`směr hrana E3\` (také \`podél hrany E3\`, \`směr E3\`) | podél přímé hrany nebo osy válcové plochy E3 (EN \`edge\`, DE \`kante\`) |
| \`směr plocha F2\` (také \`směr F2\`) | normála plochy F2 (EN \`face\`, DE \`fläche\`) |
| \`směr osa "Osa 1"\` | podél pomocné osy podle názvu (EN \`axis "Axis 1"\`, DE \`achse "Achse 1"\`); \`směr osa Z\` = osa modelu |
| \`směr body V1 V5\` | od vrcholu V1 k V5 (EN \`points\`, DE \`punkte\`) |
| \`sklon 25 [k +X | k 1 1 0]\` | **propad**: normála skici skloněná o 25° směrem k zadanému směru (globální, promítne se do roviny skici; bez \`k\` = k ose X skici, u skici XY tedy totéž jako \`k +X\` i s \`obráceně\`). EN \`tilt 25 toward +X\`, DE \`neigung 25 nach +X\`; \`sklon 25 směr +X\` znamená totéž (jako u díry) |

- **Délka**: číslo za \`vysunout\` (i \`hloubka H\`) se měří **podél směru** (jako v desktopových CADech); \`výška H\` (EN \`height\`,
  DE \`höhe\`) = **kolmo na rovinu skici** – délka podél směru je pak H / cos(sklon). Objem šikmého hranolu = plocha profilu ×
  výška kolmo. Ve formuláři je to zaškrtávátko „Vzdálenost kolmo na skicu (výška)“ (zobrazí se u šikmého směru).
- \`obráceně\` u \`sklon …\` (s \`k\` i bez) vysune na druhou stranu skici a stranu sklonu zachová (konec je posunutý k +X);
  u ostatních směrů obrátí celý směr. \`symetricky\` = na obě strany podél směru; s úkosem zůstane obrys skici v rovině
  skici a obě poloviny se od ní zužují (\`ven\`: rozšiřují), každá s vlastním břitem – \`vysunout 20 symetricky úkos 5\` na
  čtverci 20 = 2 × komolý jehlan výšky 10 (7 320,5 mm³). (Starší JSON bez \`draftCorners\` se staví jako dřív – úkos od
  spodního konce.)
- Ukončení platí i šikmo: \`skrz\`, \`k tělesu\` (po první stěnu), \`k dalšímu\`, \`k ploše F3 [odsazení N]\` (rovinná plocha
  přesně řezem), \`k rovině "Rovina 1"\` (pomocná rovina podle názvu), \`k vrcholu V3\` (konec v rovině bodu rovnoběžné se
  skicou; u šikmého směru to text uloží jako \`"normalHeight": true\` – starší JSON bez pole končí v průmětu bodu do směru). EN \`to body | to next | to face F3 [offset N] | to plane "…" | to vertex V3\`, DE \`bis körper | bis nächste |
  bis fläche F3 [versatz N] | bis ebene "…" | bis punkt V3\`. Směr ve stavu: \`20 mm, cut, směr sklon 25° k +X, výška kolmo na skicu\`.
- Směr nesmí ležet v rovině skici (\`✗ Směr vysunutí nesmí ležet v rovině skici.\`).

**Úkos** \`úkos a [dovnitř|ven]\` (EN \`draft a [in|out]\`, DE \`schräge a [innen|außen]\`), |a| < 45°:

| Zápis | Vnější obrys profilu | Otvory v profilu (vnitřní smyčky) | Přidání (výstupek) | Odebrání (otvor / kapsa) |
| --- | --- | --- | --- | --- |
| \`úkos 2\` = \`úkos 2 dovnitř\` (+) | se od roviny skici **zužuje** | se rozšiřují | stěny se naklánějí do materiálu (úkos výstupku formy) | otvor se do hloubky **zužuje** |
| \`úkos -2\` = \`úkos 2 ven\` (−) | se **rozšiřuje** | se zužují | těleso se od skici rozšiřuje | otvor se do hloubky **rozšiřuje** – odlehčení (vůle) střižnice |

- Slovo \`dovnitř\` / \`ven\` určí znaménko bez ohledu na zapsané (\`úkos -2 dovnitř\` = +2). Otvory v profilu se odsazují
  opačně než vnější obrys, aby všechny stěny měly stejný sklon vůči materiálu (u desky s otvorem a úkosem dovnitř se deska
  zužuje a otvor rozšiřuje).
- \`břit N\` (EN \`land N\`, DE \`steg N\`) = prvních N mm (kolmo od roviny skici) je rovných, teprve potom začne úkos. Odsazení obrysu
  ve výšce h = max(0, h − N) · tan(a). Břit musí být kratší než výška vysunutí.
- Rohy: nový úkos má **ostré rohy** (rovinné stěny, průsečík odsazených stran – jako v desktopových CADech, objem = komolý
  jehlan; smyčka z úseček se staví z rovinných ploch, takže \`měřit F11\` ukáže normálu a \`měřit F11 F8\` úhel, na stěnu jde
  položit \`skica plocha F11\` a STEP nese roviny); \`zaoblené rohy\` (EN \`round corners\`, DE \`runde ecken\`) zaoblí rohy, od kterých se obrys vzdaluje, poloměrem rovným
  odsazení (= starší chování; v JSON bez pole \`draftCorners\`). Oblouky a kružnice v profilu se odsazují vždy soustředně.
- Úkos funguje i u šikmého směru: obrys se odsadí v rovině skici o výška · tan(a) a posune podél směru (objem jako u kolmého).
  Úkos nelze kombinovat s tenkou stěnou ani s ukončením k zakřivené ploše (chyba – použijte rovinnou plochu, pomocnou rovinu
  nebo \`k dalšímu\`).
- Úkos s ukončením odkazem: \`k ploše F3 [odsazení N]\` / \`k rovině "…"\` rovnoběžnou se skicou = přesně slepé vysunutí do té
  výšky (odsazení obrysu se počítá ze skutečné hloubky), u šikmé roviny nástroj končí kousek za ní a rovina ho ořízne;
  \`k dalšímu\` / \`k tělesu\` najde hloubku rovný nástroj a úkos se počítá od roviny skici po nalezenou stěnu; \`skrz\`
  končí kousek za tělesem (aspoň za břitem – deska tenčí než břit má rovný otvor). Míří-li nástroj od tělesa (zapomenuté
  \`obráceně\`), je to chyba „nástroj míří od tělesa (zkuste … obráceně)“. Chyba „Úkos … je pro tento profil příliš velký“
  uvádí skutečnou výšku od roviny skici, ve které by obrys zanikl.
- JSON / \`prvek extrude\`: \`"draftAngle": -2\` (+ dovnitř, − ven), \`"draftLand": 3\`, \`"draftCorners": "sharp" | "round"\`,
  \`"dir": { "kind": "angle", "deg": 25, "toward": [1, 0, 0] }\` (bez \`k\`: \`"keepSide": true\` – \`obráceně\` zachová stranu
  sklonu; starší JSON bez \`toward\` i \`keepSide\` obrátí celý směr), \`"normalHeight": true\`. \`upravit "Vysunutí 1"
  draftCorners=ostré|zaoblené|sharp|round\`, \`draftLand=3\`, \`normalHeight=ano\` – jiné hodnoty jsou chyba. Ve formuláři Vysunutí → „Začátek,
  směr, tenká stěna, úkos…“: Úkos (°) + přepínač Dovnitř / Ven, Břit (rovná část), Ostré rohy; směr „Pod úhlem od normály“ +
  „Směrem k“. Do pole Úkos lze napsat i záporné číslo (= Ven, přepínač se přepne).

#### Příklad – Střižnice – otvor s břitem a odlehčením 2°

Otvor střižnice má od střižné (horní) plochy rovný **břit** 3 mm a pod ním **odlehčení 2°**, aby výstřižek volně propadl.
Skica leží na střižné ploše, řez jde dolů (\`obráceně\`) skrz desku, \`ven\` = otvor se do hloubky rozšiřuje:

\`\`\`
nový díl Střižnice
kvádr 120 80 25 název Deska
skica XY odsazení 25: obdélník 40 20 v 60 40
vysunout skrz odebrat obráceně úkos 2 ven břit 3
stav
\`\`\`

Odebraný objem = 40 · 20 · 3 (břit) + komolý jehlan 40 × 20 → (40 + 2·22·tan 2°) × (20 + 2·22·tan 2°) na výšce 22 mm
= 2 400 + 18 631,4 = 21 031,4 mm³ (deska 240 000 → objem 218 968,6 mm³); \`stav\` vypíše \`skrz vše, cut, úkos 2° ven (obrys se rozšiřuje), břit 3 mm, ostré rohy\`.
Kruhový otvor: \`kružnice 20 v 60 40\` místo obdélníku (válec Ø20 × 3 + komolý kužel). Na ploše modelu: \`skica plocha horní:
obdélník 40 20\` a týž řádek \`vysunout skrz odebrat obráceně úkos 2 ven břit 3\`.

#### Příklad – propad pod 25°

\`\`\`
kvádr 80 60 20
skica XY odsazení 20: obdélník 20 10 v 30 30
vysunout skrz odebrat obráceně sklon 25 k +X
\`\`\`

Otvor 20 × 10 projde deskou šikmo (stěny rovnoběžné se směrem, dolní ústí posunuté o 20 · tan 25° = 9,3 mm k +X), odebraný
objem = 20 · 10 · 20 = 4 000 mm³. Se zúžením / rozšířením stačí přidat \`úkos 1 ven\`.

### Měření – \`měřit\` (EN \`measure\`, DE \`messen\`)

Měří hotový model (stav po předchozích řádcích vstupu); výsledek je **jeden řádek protokolu na měření**, délky v mm
(nejvýš 3 desetinná místa, desetinná čárka jako ve \`stav\`), úhly ve stupních. Plochy, hrany a vrcholy se číslují jako
popisky pro výběr (\`F1\` = první plocha, \`E2\`, \`V3\` – \`window.mncad.hints()\`, Ctrl+Shift+L); neexistující číslo vrátí
chybu s platným rozsahem („těleso má 10 ploch (F1 až F10)“).

| Zápis | Výsledek |
| --- | --- |
| \`měřit F3\` | typ plochy, plocha mm², normála (rovina) nebo Ø / R, osa a úsek osy s délkou (válec – „díra“ / „vnější válec“), vrcholový úhel (kužel), těžiště plochy |
| \`měřit E5\` · \`měřit V2\` | hrana: typ, délka, začátek a konec, směr (úsečka) nebo Ø, střed, osa, úhel oblouku (kružnice); vrchol: souřadnice |
| \`měřit F3 F7\` · \`měřit E2 E9\` · \`měřit F3 E5\` · \`měřit V1 V8\` | nejmenší vzdálenost, ΔX/ΔY/ΔZ, nejbližší body; dvě roviny: úhel normál, „rovnoběžné“ + **vzdálenost rovin** / „kolmé“; dvě díry, válce nebo kružnice: **vzdálenost os** (rozteč), úhel os, vzdálenost středů |
| \`měřit V1 x y z\` · \`měřit F3 bod x y z\` | vzdálenost entity od bodu |
| \`měřit těleso\` | obálka (X/Y/Z od…do), objem, povrch, hmotnost podle materiálu, těžiště, počet ploch / hran / vrcholů |
| \`měřit díry\` | všechny válcové díry po skupinách průměru: Ø, vstup (střed na povrchu), skrz + délka / slepá + hloubka, osa / směr vrtání, čísla ploch |
| \`měřit válce\` | vnější válce (osazení, čepy): Ø, délka, osa, od…do |
| \`měřit plocha horní\` · \`měřit hrany kruhové poloměr 4\` | všechny plochy / hrany podle pravidla jako u \`skořepina\` / \`zaoblit\`, každá na řádku |
| \`měřit Hřídel:F3 Deska:F1\` · \`měřit Deska:díry\` | v sestavě: komponenta podle názvu (s mezerou v uvozovkách: \`"Víko A":F2\`), světové souřadnice; pravidla jen v dílu |

\`await window.mncad.measure("F3", "F7")\` (také \`measure("V1", [0, 0, 50])\`, \`measure("díry")\`, \`measure("Hřídel:F3")\`)
vrátí \`{ ok, kind, lines, distance, angle, radius, diameter, area, length, volume, points, report }\` – \`lines\` jsou řádky
protokolu, \`report\` celý výsledek s čísly (u děr \`report.holes[]\` s \`diameter\`, \`entry\`, \`through\`, \`depth\`, \`axis\`, u slepé díry \`bottom\` = \`"flat"\` | \`"cone"\`,
u kužele \`tipAngle\` (vrcholový úhel °) a \`tipDepth\` (hloubka ke špičce, mm; chybí u kužele propíchnutého souosou dírou));
při chybě \`{ ok: false, error }\`. Příklad:

\`\`\`
kvádr 100 60 20
díra 8 skrz v 20 30 20
díra 6 hloubka 10 v 50 52 20
měřit díry          # Díry: 2 – Ø 6 mm × 1, Ø 8 mm × 1 · D1 Ø 6 mm: vstup [50; 52; 20] · slepá, hloubka 10 mm · směr vrtání −Z …
měřit těleso        # Těleso: obálka 100 × 60 × 20 mm …
měřit plocha horní  # F… rovinná plocha · normála +Z …
\`\`\`

### Primitiva – poloha a osa odkazem, pružina

Kvádr, válec, koule, kužel, trubka, pružina i závit mají **stejné volby jako formulář**: polohu, osu, operaci a těleso.

- **Poloha** čísly \`v x y z\`, nebo **odkazem** (asociativně – počítá se na tělese před prvkem, čísla jako popisky pro výběr):
  \`na V3\` (vrchol), \`na střed hrany E2\`, \`na střed kružnice E5\` (střed kruhové hrany – ústí díry, čep), \`na střed plochy F3\`
  (u válcové plochy bod na její ose), \`na začátek|konec hrany E2\`, \`na bod "Bod 1"\` (pomocný bod názvem), \`na mezi V1 V5\`
  (střed mezi dvěma body), \`na počátek\`. EN \`at V3\`, \`at mid edge E2\`, \`at center circle E5\`, \`at center face F3\`, \`at point "P1"\`;
  DE \`bei V3\`, \`bei mitte kante E2\`, \`bei mittelpunkt kreis E5\`, \`bei mitte fläche F3\`, \`bei punkt "P1"\`.
- **Osa** (\`osa\` = \`směr\`): \`osa X|Y|Z\`, \`osa -Z\`, vektor \`osa 0 0,5 -0,866\` (právě tři čísla), \`osa hrana E3\` (přímá hrana;
  u kruhové hrany osa kružnice jejím středem), \`osa plocha F2\` (normála rovinné plochy, osa válcové), \`osa "Osa 1"\` (pomocná osa
  názvem), \`osa body V1 V5\` (od V1 k V5; EN \`axis points V1 V5\`, DE \`achse punkte V1 V5\`);
  \`obráceně\` otočí osu X|Y|Z, vektor i dva body. Válec, kužel, trubka a pružina rostou od polohy **ve směru osy**. Koule osu nemá.
  Smysl osy z hrany / válcové plochy určuje geometrie (nelze ho otočit slovem \`obráceně\`) – kde záleží na smyslu (kužel, závit do
  díry), použijte \`osa -Z\`, vektor nebo \`osa body V1 V5\`.
- **Kvádr s osou**: rozměr Z kvádru jde po ose; natočení je nejkratší otočení osy +Z do osy kolem polohy (rohu, se \`střed\` středu
  kvádru). Pro \`kvádr X Y Z\` s rohem v počátku: \`osa -Z\` (180° kolem X) → X 0…X, Y −Y…0, Z −Z…0 · \`osa X\` → X 0…Z, Y 0…Y, Z −X…0 ·
  \`osa -X\` → X −Z…0, Y 0…Y, Z 0…X · \`osa Y\` → X 0…X, Y 0…Z, Z −Y…0 · \`osa -Y\` → X 0…X, Y −Z…0, Z 0…Y. Kapsu shora proto
  zadejte bez osy rohem dna (\`kvádr 20 10 5 v 40 30 15 odebrat\` v desce výšky 20) nebo středem (\`kvádr 20 10 10 střed v 50 35 20 odebrat\`).
- **Kvádr a „střed“**: \`střed\` bez \`v\` / \`na\` před sebou = vystředit; odkaz hned za ním je poloha středu:
  \`kvádr 10 10 10 střed F1\` = střed kvádru ve středu plochy F1, \`… střed V3\` = střed ve vrcholu V3 (totéž co \`střed na V3\`);
  \`kvádr 10 10 10 na střed plochy F1\` = **roh** ve středu plochy.
- **Operace**: \`přidat\` (výchozí) | \`odebrat\` | \`průnik\` | \`nové [těleso "Název"]\` – jen jedna (dvě různé = chyba);
  \`těleso "Název"\` = cílové těleso prvku. U \`nové\` se odkazy polohy a osy (\`na střed plochy F8\`, \`osa hrana E3\`) počítají na
  tělese, ze kterého se nové zakládá (pružina do sedla jako samostatné těleso).
- Neznámé nebo nepatřičné slovo je **chyba** (dřív se tiše ignorovalo – \`kužel … směr 1 0 1\` pak stál svisle).
- \`stav\` vypíše polohu i osu na tisíciny: \`Ø12→Ø0 × 6 mm, cut, podstava střed kružnice E5, osa [0; 0; -1]\`.
- **Výkres**: \`válec D H … odebrat\` je pro Chytré kóty díra – popis \`Ø6,8 ↧16\` nebo \`Ø10 skrz\` (hloubka z geometrie), \`kužel … odebrat\`
  v ústí takové díry přidá \`⌵ Ø12 × 90°\` a vnitřní \`závit\` souosý s dírou z ní udělá závitovou díru \`M8 ↧12\` + \`Ø6,8 ↧16\` (vrták jiný
  než tabulkový, který se k závitu hodí – jádro D1 Ø6,647, zadaný Ø6,7 –, se vypíše skutečným průměrem; průměr, který k závitu
  nepatří, dá hlášení „závit v popisu doplňte ručně“). Vnější závit odkazem i po libovolné ose dostane popis \`M20\` a délku.
  Kosmetický závit s chybným odkazem je chyba prvku (✗), ne tichý úspěch.

\`\`\`
kvádr 100 100 60 v -50 -50 0
kužel 20 0 25 v 0 0 70 osa 0 0,5 -0,866 odebrat     # kuželové sedlo pro šikmý hrot: osa skloněná 30° od -Z k +Y, podstava nad deskou
válec 10 150 v -50 0 -40 osa 1 0 1 odebrat          # válcový otvor podél vektoru 1 0 1 (šikmý průchod deskou)
kvádr 20 20 20 střed v 25 -25 60 odebrat            # kvádr vystředěný v bodě: kapsa 20 × 20 × 10 v horní ploše
válec 6,8 16 v 30 30 60 osa -Z odebrat              # díra vrtáku M8 hl. 16 shora; horní kružnice díry = E17 (měřit hrany kruhové)
kužel 12 0 6 na střed kružnice E17 osa -Z odebrat   # zahloubení 90° v ústí díry; Ø12 v horní ploše je pak E17
závit M8 délka 12 na střed kružnice E17 osa -Z vnitřní  # kosmetický vnitřní závit; výkres: „M8 ↧12“ + „Ø6,8 ↧16“
válec 25 15 v -30 -30 60 osa -Z odebrat             # sedlo pružiny Ø25 hl. 15; dno sedla = F15 (měřit plochy rovinné)
pružina 22 stoupání 4 závity 5 drát 2 na střed plochy F15 nové těleso "Pružina"   # pružina v sedle jako samostatné těleso
\`\`\`

### Odkazy u rotace, pole, zrcadlení a sražení; hrany a plochy čísly

- \`rotovat [úhel] osa hrana E3 | osa plocha F7 | osa "Osa 1" | osa body V1 V5 [symetricky]\` – osa rotace modelem (osa válcové
  plochy, pomocná osa…); \`osa X|Y|Z\` = globální osa jako dřív.
- \`pole N rozteč P směr hrana E3 | směr body V1 V5 | směr osa "Osa 1" [N2 rozteč P2 směr …]\` – směr řady odkazem;
  \`pole kruhové N [úhel A] osa hrana E3 | osa plocha F7 | osa "Osa 1"\` – osa kruhového pole odkazem (např. osa náboje): kruhová
  hrana = osa kružnice jejím středem, plocha jen válcová / kuželová (rovinná plocha osu nemá – chyba; střed kruhové rovinné plochy
  zadejte její kruhovou hranou).
- \`zrcadlit plocha F3 [odsazení N]\` · \`zrcadlit rovina "Rovina 1" [odsazení N]\` – rovina zrcadlení plochou / pomocnou rovinou.
- \`srazit D úhel A plocha F3 [hrany …]\` · \`srazit D1 D2 plocha F3 [hrany …]\` – vzdálenost + úhel, nebo dvě vzdálenosti; D / D1 se
  měří na referenční ploše F3 (bez \`hrany\` = všechny hrany té plochy).
- \`zaoblit 2 hrany E3 E7\` · \`srazit 1 hrany E5\` · \`skořepina 2 otevřít F3 F5\` · \`úkos 3 plochy F2 F4\` – hrany a plochy **čísly**
  (popisky pro výběr) místo pravidla; s dalšími slovy pravidla se čísla zužují (\`hrany E2,E9,E10 svislé\` = jen svislé z nich).
- Co dál jde jen přes \`prvek\` / \`upravit\` (proměnný poloměr zaoblení, přeskočené instance pole, tenká stěna, ukončení druhého
  směru…), ukáže \`prvek nápověda\` (přehled) a \`prvek nápověda <typ>\` (pole s „jen prvek / upravit / JSON“).

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
- Neznámý klíč nebo typ skončí chybou s výčtem platných. **Všechna pole typu** vypíše \`prvek nápověda <typ>\` (název, druh
  hodnoty s ukázkou, jednotka, povolené hodnoty, výchozí / povinné, význam, textový zápis) – zdrojem je tabulka svázaná
  s TypeScript typy, takže je vždy úplná; u rozšíření \`prvek nápověda sheet.bend\` vypíše jeho parametry a výchozí hodnoty.
- Směr a osa u rozšíření (\`surf.helix\` / \`surf.helixSweep\` \`axis\`, \`sheet.relief\` \`axis\`, \`surf.extrude\` \`dir\`,
  \`surf.revolve\` \`axis\`): \`axis=X\`, \`axis=-Z\`, vektor \`axis=1;0;1\`, nebo JSON odkaz
  (\`axis={"kind":"edge","ref":{"kind":"edge","index":3}}\` = podél hrany 4 / osy válce, \`{"kind":"faceNormal","ref":{"kind":"face","index":5}}\`
  = normála plochy 6). U \`surf.revolve\` je \`axis=x\` / \`axis=y\` osa skici, \`axis=X|Y|Z\` globální osa, JSON \`AxisDef\`
  (\`{"kind":"cylFace","ref":{"kind":"face","index":2}}\`). Starší zápis \`"axis": "Z"\` v JSON platí dál.
- Operace rozšíření \`mode=add|cut|intersect\`: \`surf.close\` a \`surf.thicken\` mají výchozí \`add\` (s tělesem v dílu se sloučí);
  starší JSON s \`"mode": "new"\` dál tělesa nahradí (formulář ukáže volbu „Nahradit tělesa“). \`adv.dome mode=intersect\` plochu
  vyklene dovnitř (vrchol v rovině plochy, okraj o \`height\` níž). \`adv.check strict=ne\` kontroluje jen topologii.
- \`prvek sheet.hem edges=… kind=teardrop radius=1 closeAngle=30\` = lem Kapka (ohyb 180° + úhel, rameno šikmo k plechu,
  délka ramene se dopočítá); \`sheet.flange relief=rect|obround reliefWidth=… reliefDepth=…\` platí pro obě polohy materiálu,
  \`reliefDepth=0\` = tloušťka plechu. \`surf.offset faces=… keepOriginal=ne\` vybrané volné plochy nahradí odsazenými.
- \`adv.mirrorFeatures features="Zkrut"\` (název, id nebo \`$last\`; více prvků \`features=["Zkrut","Díra 1"]\`) zrcadlí i prvky
  rozšíření s nástrojovým tělesem (\`adv.twist\`, \`adv.dome\`, \`adv.textOnCyl\`, \`adv.lipGroove\`, \`adv.holesAtPoints\`,
  \`surf.helixSweep\`, \`weld.member\` bez \`separate\`); rovina \`plane=XY|XZ|YZ offset=…\` nebo odkazem \`planeDef={…}\` (má
  přednost). \`all=ano\` = všechny dřívější prvky s nástrojem KROMĚ toho, který těleso založil (zrcadlený základ by zaplnil
  dřívější kapsy a díry); celé těleso zrcadlí vestavěné \`zrcadlit\`. \`adv.dome\` s \`radius=0\` bere poloměr k vnějšímu obrysu
  plochy (díry se nepočítají); kopule celá nad dírou / mimo plochu skončí chybou. \`sheet.unfold\` hlásí ⚠, co rozvin vynechal.
- Prvky \`adv.varFillet\`, \`adv.fullRound\`, \`adv.chamfer2\`, \`adv.curvePattern\`, \`adv.fillPattern\` a \`adv.holesAtPoints\` jsou
  starší duplicity – na pásu karet už nejsou, staré dokumenty i \`prvek …\` je dál postaví. Pro nové díly použijte
  vestavěné \`zaoblit\` (druh R1 → R2 / plný), \`srazit\` (D1 × D2 / D × úhel), \`pole\` (po křivce / výplň / podle skici) a \`díra\`.

\`\`\`
skica XY: obdélník 20 20
prvek adv.twist sketch=$last height=30 angle=45
prvek chamfer distance=1 edges=horní;rovné
\`\`\`

### Zaoblení se setbackem, eliptické zaoblení a úkos s dělicí křivkou

Tři tvary pro formy a lité / obráběné díly (EN \`fillet … setback\`, \`fillet elliptical\`, \`draft … parting … stepped\`;
DE \`verrunden … rückversatz\`, \`verrunden elliptisch\`, \`schräge … trennlinie … gestuft\`). V JSON / \`prvek\` jsou to běžné
prvky \`fillet\` (pole \`kind\`) a \`draft\` (pole \`partingSketchId\`, \`step\`).

- **Setback** – \`zaoblit 3 hrany <pravidlo> setback 5\`: ve vrcholu, kde se stýkají aspoň tři vybrané hrany (roh kvádru),
  zaoblení skončí 5 mm od vrcholu podél každé hrany a roh uzavře hladká N-stranná záplata tečná (G1) k zaoblením i
  k plochám rohu. Setback musí být ≥ poloměr (= poloměr ≈ běžný kulový roh; větší = plošší, rozlehlejší roh). Jiná hodnota
  pro jeden vrchol: \`vrchol V3 8\` (číslo vrcholu jako popisek pro výběr) nebo \`vrchol x y z 8\`. JSON:
  \`{"type":"fillet","kind":"setback","radius":3,"setback":5,"setbacks":[{"at":{"kind":"vertex","index":2},"d":8}],"edges":[…]}\`.
  Přesně pro rohy z rovinných ploch a přímých hran; jiné rohy dostanou běžný roh a prvek hlásí ⚠.
- **Eliptické / kuželosečkové** – \`zaoblit eliptické 4 2 hrany horní\`: průřez je oblouk elipsy tečný k oběma plochám,
  D1 = 4 mm se odměří na **první** ploše (s normálou nejvíc nahoru: +Z, pak +Y, +X – u horní hrany kvádru tedy na
  horní ploše), D2 = 2 mm na druhé. \`rho 0,5\` = kuželosečka (parabola; < 0,5 plošší, > 0,5 ostřejší). JSON:
  \`{"type":"fillet","kind":"conic","radius":4,"r2":2,"rho":0.5,"faceRefs":[{"kind":"face","index":3}],"edges":[…]}\`
  (\`faceRefs\` = plocha pro D1). Přímá hrana mezi rovinami a kruhová hrana se stálým průřezem (rovina ⟂ osa, souosý
  válec) jsou přesné – odebraný průřez rovné hrany = D1·D2·(1 − π/4); jiné hrany jsou proložené šablonováním (⚠).
  Vnitřní (konkávní) hrana materiál přidá.
- **Úkos s dělicí křivkou** – \`úkos 3 plochy boční dělicí "Skica 2"\`: části vybraných ploch nad dělicí křivkou se zkosí ve
  směru tahu (\`směr +Z\`, výchozí normála roviny XY), části pod ní proti němu – díl je v dělicí čáře nejširší a obě poloviny
  formy jdou vyjmout. Skica **kolmá na tah** (\`skica XY odsazení 10: …\`) = rovinná dělicí křivka, její rovina je neutrální
  rovinou obou stran (přesně). Skica **rovnoběžná s tahem** (\`skica XZ: čára 0 10 30 10 30 20 60 20\`) = profil dělicí čáry
  promítnutý podél normály skici přes celý díl; křivka musí postupovat jedním směrem, konce se samy prodlouží za díl
  (ve směru krajního úseku). Automatické uzavření osamocené \`čáry\` (i se zaoblenými rohy \`r N\`) se u dělicí čáry
  nepoužije a uzavírací úsek výslovně uzavřené čáry se vynechá – dělicí čára je vždy otevřená křivka.
  Přímé úseky drží dělicí čáru přesně, oblouky / spline se rozdělí na rovinné úseky (⚠ přibližně), svislé skoky jsou stupně.
- **Stupňovitý úkos** – \`… dělicí "Skica 2" stupňovitý\`: každý úsek dělicí čáry se zkosí od vlastní roviny kolmé na tah
  (výška úseku, u šikmého jeho střed) a sousední úseky spojí stupňové plochy – klasický stupňovitý úkos formy.

\`\`\`
nový díl Forma
kvádr 60 40 30
skica XZ: čára 0 10 30 10 30 20 60 20
úkos 3 plochy boční dělicí "Skica 1" stupňovitý
stav
\`\`\`

\`\`\`
nový díl Kryt
kvádr 60 40 20
zaoblit 3 setback 6                  # všechny hrany, 8 rohů uzavře záplata
nový díl Lišta
kvádr 60 40 20
zaoblit eliptické 4 2 hrany horní    # 4 mm po horní ploše, 2 mm dolů po boku
\`\`\`

Stav (\`stav\`) u prvků vypíše např. \`R3, setback 6, hrany vše\`, \`eliptické D1 4 × D2 2, hrany 1\`,
\`3°, ploch 4, dělicí křivka „Skica 1“, stupňovitý\`; přibližné výsledky mají ⚠ s vysvětlením.

### Úpravy existujícího modelu – upravit, potlačit, smazat, přesunout, zpět / znovu, proměnné, konfigurace

Hotový díl se upravuje **na místě** (stejná záložka, historie Zpět funguje) – není potřeba \`getDocument()\` → ruční úprava
JSON → \`setDocument()\`. Prvek se zadává názvem v uvozovkách (\`"Díra 1"\`), id ze stavu, \`$last\` (poslední prvek) nebo
\`@3\` (3. prvek historie); více prvků za sebou mezerou nebo středníkem. Slova fungují česky, anglicky i německy.

| Příkaz | Význam |
| --- | --- |
| \`upravit <prvek> klíč=hodnota …\` (EN \`edit\`, DE \`bearbeiten\`; \`změnit\` / \`modify\` / \`ändern\`) | změní parametry prvku; klíče = pole prvku jako u \`prvek\` (\`diameter\`, \`size.0\`, \`extent={"kind":"toNext"}\`, \`sketchId="Skica 2"\`, \`mode=odebrat\`, \`název="…"\`), u rozšíření klíč nebo popisek parametru (\`úhel=90\`); bez klíčů vypíše parametry prvku |
| \`upravit <prvek> {JSON záplata}\` | sloučí JSON do prvku (\`null\` pole odstraní) – \`upravit "Pole 1" {"count": 6, "skip": [2]}\` |
| \`upravit <prvek> plochy / hrany\` | \`edges=1;4\` (indexy jako u \`prvek\`), \`edges=E3;E7\` (popisky pro výběr), \`edges=vše\`, nebo pravidlem \`edges=horní;kruhové\` – pravidlo se vyhodnotí na tělese **před** prvkem a otisky výběru se spočtou znovu |
| \`upravit <prvek> klíč==výraz\` | vazba parametru na proměnné (jako „=d*2“ v poli formuláře): \`upravit "Vysunutí 1" distance==h*2\`; číslo (\`distance=20\`) vazbu zruší |
| \`potlačit <prvek> […]\` · \`zapnout <prvek> […]\` (EN \`suppress\` / \`unsuppress\`, DE \`unterdrücken\` / \`aktivieren\`) | potlačený prvek se nestaví |
| \`smazat <prvek> […]\` (EN \`delete\` / \`remove\`, DE \`löschen\` / \`entfernen\`) | smaže konkrétní prvky; protokol vypíše prvky, které na ně odkazovaly (\`⚠ na smazané odkazují: Pole 1 (featureId)\`), a po výpočtu jejich ✗; \`smazat\` / \`smazat poslední\` = poslední prvek |
| \`přejmenovat <prvek> na <název>\` (EN \`rename … to …\`, DE \`umbenennen … zu|in …\`) | nový název prvku |
| \`přesunout <prvek> před|za <prvek>\` · \`… nahoru|dolů [N]\` · \`… na začátek|konec\` (EN \`move … before|after|up|down\`, DE \`verschieben … vor|nach|hoch|runter\`) | pořadí v historii; skica a jiné použité prvky musí zůstat **před** prvky, které je používají – jinak \`✗ … „Vysunutí 1“ používá „Skica 1“ (sketchId)\` a nic se nezmění |
| \`duplikovat <prvek> [jako "Název"]\` (EN \`duplicate … as\`, DE \`duplizieren … als\`) | kopie hned za originálem |
| \`zpět [N]\` · \`znovu [N]\` (EN \`undo\` / \`redo\`, DE \`rückgängig\` / \`wiederherstellen\`) | **kroky historie** dokumentu jako Ctrl+Z / Ctrl+Y; jeden běh \`run\` (jeden vstup konzole) = jeden krok. Pozor: dříve \`zpět\` mazalo poslední prvek – to je teď \`smazat poslední\` |
| \`proměnná d = 20 [poznámka "…"]\` · \`proměnná h = d*1,5\` · \`proměnná smazat d\` · \`proměnné\` (EN \`variable|var\`, \`variables\`; DE \`variable\`, \`variablen\`) | proměnné dílu; chybný výraz (neznámá proměnná, cyklus) se nezapíše; \`proměnné\` vypíše hodnoty, chyby a vazby parametrů |
| \`konfigurace "Krátká" t=10 [potlačit "Díra 1";"Pole 1"]\` · \`konfigurace aktivní "Krátká"|žádná\` · \`konfigurace smazat "Krátká"\` · \`konfigurace\` (EN \`config … suppress\`, \`config active\`, \`config delete\`; DE \`konfiguration … unterdrücken\`, \`konfiguration aktiv\`, \`konfiguration löschen\`; také \`varianta\`) | stavy dílu (varianty): hodnoty proměnných a potlačené prvky; založení konfiguraci neaktivuje |

\`stav\` vypíše navíc řádky \`Vazby parametrů: Vysunutí 1.distance = h*2 (= 40)\` a \`Konfigurace: Krátká (aktivní), Dlouhá\`.
Protokol úpravy: \`→ Díra 1: diameter 8,5 → 10, depth 0 → 12 – výsledek po výpočtu níže\` (ℹ \`op.accepted\` = příkaz
přijat, to ještě není výsledek) a po výpočtu ✓ / ⚠ / ✗ upraveného prvku **na řádku úpravy**. ⚠ / ✗ prvků, které úprava
(smazání, přesun, proměnná, konfigurace, entita nebo kóta skici, zpět) rozbila, jdou také na řádek té úpravy; řádek, který
má ⚠ / ✗, nedostane žádné ✓ (prvek, který je sám v pořádku, je tam ℹ \`feature.built\`). Poslední úprava běhu, po které
žádný prvek nezměnil stav (smazání, proměnná, konfigurace, zpět), dostane na svém řádku výsledek přepočtu celého
dokumentu: \`✓ dokument „Deska“ postaven: prvků 4, bez ⚠ a ✗ · těleso platné\`; dřívější úpravy bez vlastního výsledku
mají ℹ \`op.superseded\` (jejich mezistav se nestavěl). Příkaz, po kterém se nic nepřepočítává
(přejmenování, smazání posledního prvku, proměnná v dílu bez prvků, zpět o právě přidaný prvek), je hned ✓. Neznámý klíč skončí chybou s výčtem parametrů prvku (\`„diametr“ není parametr prvku „Díra 1“ (hole) – parametry: …\`).

**Úprava existující skici.** \`skica "Skica 1"\` (EN \`sketch "…"\`, DE \`skizze "…"\`; bez roviny, jen název v uvozovkách) znovu
otevře hotovou skicu jako cíl dalších řádků – entity, \`vazba\`, \`kóta\` i níže uvedené úpravy jdou do ní (i na jednom řádku:
\`skica "Skica 1": kružnice 10 v 0 0\`). Bez bloku jdou úpravy do skici otevřené ve skicáři, jinak do poslední skici.
\`stav\` u skici vypíše vazby a kóty s čísly: \`vazby: v1 kolmo e1 e2 · v2 vodorovně e1\`, \`kóty: k1 délka e1 = 60 · k2 průměr e3 = 20 referenční\`.

| Příkaz ve skice | Význam |
| --- | --- |
| \`entita e3 klíč=hodnota …\` (EN \`entity\`, DE \`objekt\`) | souřadnice a rozměry entity: \`entita e3 cx=10 cy=5 r=4\`, \`entita e3 průměr=20\`, \`entita e3 střed=10;5\`, \`entita e1 a=0;0 b=60;0\`, \`entita e2 w=40 h=20 úhel=15\`, \`entita e4 p2=10;5\` (bod lomené čáry), \`entita e2 pomocná=ano\`; po řádku se skica vyřeší (vazby mohou entitu vrátit – protokol vypíše výsledek) |
| \`smazat e3 [e4 …]\` · \`smazat v1\` · \`smazat k2\` | smaže entity (i s jejich vazbami a kótami), vazby a kóty podle čísla; čísla se pak přečíslují (\`stav\`) – mažte více položek jedním řádkem |
| \`kóta k1 65\` · \`kóta k1 referenční\` · \`kóta k1 řídicí\` (EN \`dim k1 65\`, \`reference\` / \`driving\`; DE \`bemaßung k1 …\`, \`referenz\` / \`steuernd\`) | nová hodnota kóty (změní geometrii), přepnutí řídicí ↔ referenční; kóta, která by skicu přeurčila, se nezmění (✗ s důvodem) |
| \`odsadit e1 [e2 …] 5 [ven|dovnitř|vlevo|vpravo] [řetězec]\` (EN \`offset … out|in|left|right chain\`, DE \`versetzen … außen|innen kette\`) | odsazená kopie entity; \`řetězec\` = celý navazující řetězec úseček a oblouků (u uzavřeného obrysu \`ven\` = větší obrys); nové entity dostanou další id |
| \`promítnout hrany E3;E7\` · \`promítnout hrany vše\` · \`promítnout hrany\` [\`pomocné\`] (EN \`project edges … construction\`, DE \`projizieren kanten … hilfs\`) | průmět hran tělesa před skicou do roviny skici (E čísla jako popisky pro výběr); bez čísel jen hrany ležící v rovině skici |

Oříznutí, prodloužení, rozdělení, zaoblení / sražení rohu, přesun, otočení, zrcadlení, měřítko a pole entit nemají vlastní
příkaz: výsledek zapište příkazy \`entita\` (nové souřadnice), \`smazat e…\` a novými entitami (\`úsečka\`, \`oblouk\` + \`vazba tečně\`).

\`\`\`
# příruba z příkladu níže: větší díry, výška přes proměnnou, varianta bez děr, oprava a návrat
upravit "Díra 1" diameter=20
proměnná t = 18
upravit "Vysunutí 1" distance==t
konfigurace "Bez děr" t=12 potlačit "Díra 1";"Pole 1"
konfigurace aktivní "Bez děr"
přejmenovat "Díra 1" na "Díra šroubu"
skica "Skica 1"
entita e1 průměr=170
stav
\`\`\`

**API:** \`await window.mncad.undo(n?)\` / \`await window.mncad.redo(n?)\` (vrátí protokol + stav), \`window.mncad.history()\` →
\`{ undo, redo }\` (počet kroků), \`await window.mncad.setDocument(doc, { inPlace: true })\` nahradí dokument **aktivní záložky**
jako jeden krok historie (bez \`inPlace\` se dokument otevře v nové záložce) – univerzální únik pro změny bez vlastního příkazu.

### Sestava textem – plochy, vazby, komponenty, kusovník, záložky

Sestava se dá postavit a ověřit celá textem, bez klikání do 3D (anglicky \`assembly …\`, německy \`baugruppe …\`):

1. Díly jako záložky (\`nový díl Deska\` …), pak \`nová sestava\` a \`vložit "Deska" ukotvit\`, \`vložit "Čep" v 100 0 0\`.
2. \`sestava plochy "Čep" [rovinné|válcové]\` vypíše plochy komponenty v **souřadnicích sestavy**: \`F3 · rovinná · normála −Z ·
   střed [40; 30; 10] · 122,5 mm²\`, \`F2 · válcová Ø10 · osa Z · střed osy […] · délka 30 mm\` (u dílu v podsestavě \`Díl › F3\`,
   odkaz \`F3@Díl\`). Číslo F je stejné jako u popisků pro výběr (F1 = první plocha dílu).
3. \`sestava vazba <druh> "A" <plocha A> "B" <plocha B> [hodnota N] [obráceně] [název "…"]\` – druh \`kontakt\`, \`zarovnat\`,
   \`vystředit\` (kontakt + středy, také \`kontakt … střed\`), \`souosost\` (válcové plochy), \`vzdálenost\`, \`úhel\`, \`rovnoběžně\`;
   \`sestava vazba ukotvit "A"\`. Plocha = \`F12\` nebo pravidlo: \`+Z|-X|…\`, \`horní|spodní\` (= ±Z) – rovinná plocha s touto
   normálou (u souososti osa v tomto směru), více ploch → krajní ve směru; \`největší|nejmenší\`; \`válcová|rovinná\`; \`Ø8\` / \`R4\`.
   Pohybuje se komponenta A (je-li ukotvená, pak B). Vzdálenost / Úhel bez hodnoty = naměřená (komponenty zůstanou).
   Protokol napíše stav vazby (ok / konflikt) a novou polohu: \`✓ vazba Souosost „Čep“ F2 → „Deska“ F7: ok · „Čep“ poloha [40; 30; 0]\`.
4. \`sestava vazby\` – očíslovaný výpis (druh, komponenty a plochy, hodnota, stav); \`sestava vazba 3 hodnota=8\`,
   \`… obráceně\`, \`… potlačit\`, \`… zapnout\`, \`… smazat\` (číslo nebo název vazby). Po každé změně se vazby přepočítají.
5. \`sestava\` (bez podpříkazu) vypíše komponenty \`#1 Deska · díl · poloha [0; 0; 0] · ukotvená ⚓\`; komponentu lze zadat
   názvem, pořadím \`#2\` nebo **přezdívkou**: \`vložit "Šroub M6x20" v … jako "K48"\` (EN \`insert … as "K48"\`, DE
   \`einfügen … als "K48"\`) nebo \`sestava komponenta #25 přezdívka "K48"\` (EN \`alias\`; prázdná \`přezdívka ""\` ji zruší) –
   pak \`sestava vazba zámek "K48" "Upínací deska"\`. Název záložky i přezdívka v uvozovkách jsou doslovné – jde i
   \`vložit "D" jako "H"\` (bez uvozovek by se \`D\`, \`H\`, \`V\` četly jako volby průměr / výška / poloha). Přezdívka je jednoznačná (ne „#…“, ne název jiné komponenty; komponentu
   nejde přejmenovat na přezdívku jiné), ve výpisu, ve stromu a ve vazbách v hranatých závorkách \`#25 Šroub M6x20 [K48]\`,
   \`Zámek „Šroub M6x20“ [K48] → „Upínací deska“\`; kopie (\`sestava duplikovat|pole|zrcadlit\`, Duplikovat v panelu) přezdívku
   nepřebírají. Kusovník ji nepoužívá. \`stav\` u sestavy obsahuje řádky
   \`Komponenty: Deska [0; 0; 0] ⚓ · Čep [40; 30; -20]\`, \`Vazby: 2 (2 ok)\` a \`Sestava: 70 komponent … · obálka X × Y × Z mm\` –
   obálka je **přesná** obálka těles všech viditelných listových dílů v jejich umístění (jádro, ne síť, bez skic a pomocné
   geometrie; i natočené díly, např. otočení 0 0 20).
6. \`sestava komponenta "Čep" v x y z | posun dx dy dz | otočení rx ry rz | pootočit X 90 | ukotvit | uvolnit | skrýt | zobrazit |
   barva #hex | název "…" | číslo "…" | skupina "…" | materiál ocel\` (třída hustoty, jiný text = označení do kusovníku;
   třída po označení jako u dílu: označení zůstává, odporuje-li mu, \`→ … v razítku zůstává – patří jiné třídě\` + ⚠, ne ✓);
   po přesunu se vazby přepočítají (přesunutá komponenta drží). \`sestava odebrat "X"\` (i s jejími vazbami),
   \`sestava duplikovat "X" [posun 50 0 0]\`, \`sestava izolovat "X"\`, \`sestava zobrazit vše\`.
7. \`sestava pole "X" 4 rozteč 25 [směr Y|dx dy dz]\`, \`sestava pole "X" kruhové 6 [úhel 360] [osa Z] [v cx cy cz]\` (kopie
   „X (2)“…), \`sestava zrcadlit "X" YZ [odsazení N]\`, \`sestava šroub "Deska" Ø9|F8 [matice] [bez podložky] [obráceně]\` –
   šroub ISO 4762 podle průměru díry, délka podle tloušťky, hlava nahoře (\`obráceně\` = dole), vazba Souosost.
8. \`sestava podsestava "A" "B" [jako "Vedení"]\` (vazby se převedou), \`sestava rozpustit "Vedení"\`;
   \`sestava upravit "Čep"\` → další řádky pracují s dílem (\`díra 3 skrz v 0 0\`…) → \`sestava hotovo\` vrátí díl do sestavy
   (změna platí pro všechny stejné komponenty); \`sestava otevřít "Čep"\` = kopie v nové záložce.
   **Reference vazeb po změně dílu:** \`sestava hotovo\` (i tlačítko „← Zpět do sestavy“ – stejná kontrola) ověří každou plochu /
   hranu vazeb do změněného dílu podle geometrie: táž plocha s jiným číslem = ℹ \`mate.renumbered\` (F3 → F5; „táž rovina, plocha
   změnila velikost“ jen tehdy, když se nová plocha PŘEKRÝVÁ s otiskem staré – druhý schod na téže rovině jinde není táž plocha),
   plocha, která zmizela nebo po změně odpovídá víc plochám = ✗ \`mate.lost\` – **nikdy se tiše nepřipojí jinam**: vazba je mimo řešení,
   komponenta se kvůli ní nehýbe, stav „ztracená reference“, \`mates=0/1(lost=1)\`, souhrn \`sestava hotovo\` je bez ✓
   („→ … vrácen … – stav vazeb níže“). Oprava: \`sestava vazba 1 plocha b F6\` (nová plocha strany B, F-číslo nebo pravidlo
   jako u nové vazby; bez strany = ztracená strana) nebo \`sestava vazba 1 smazat\`; ztracená hrana / vrchol = táž entita
   číslem \`sestava vazba 1 plocha b E2\` / \`… V3\` (v aplikaci „Vybrat hranu / vrchol znovu“ – seznam hran / vrcholů dílu);
   vrátí-li další úprava tutéž plochu, reference se obnoví (ℹ \`mate.restored\`). Totéž platí pro \`sestava obnovit\` (díl změněný v záložce, GUI „Obnovit z dílu“) a pro
   **dosedací plochy pružin**: ztracená dosedací plocha = ✗ \`mate.lost\` s názvem pružiny, řádek „pružina „P“ … – ztracená reference: …“
   ve výpisu \`sestava vazby\` (hlavička „· pružiny se ztracenou dosedací plochou: N“), \`sestava pružiny\` / \`stav\` bez délky, síly a ✓
   („délka a síla nezkontrolovány“), strojově \`springs.lost=N\` v řádku \`D\`, \`= … status\` a \`Σ\`;
   oprava \`sestava pružina "P" mezi "Deska A" F6 "Přidržovač" F5\` nebo \`… odebrat\`.
9. \`kusovník [strukturovaně] [csv]\` – tabulka \`Poz. | Název | Číslo / norma | Ks | Materiál | kg/ks\`; \`kolize\` = průniky.
   Řádky se tvoří podle **zdroje** (stejný vložený díl = jeden řádek, kusy se sečtou) – přejmenovaná instance („… -1“) ani přezdívka
   řádek nerozdělí; jiné číslo výkresu (\`číslo "…"\`) je jiná položka. Název řádku = společný název instancí, jinak název dílu.
   **Druh položky** (vlna 22): vyráběný / normálie / nakupovaný – kusovník je v oddílech (\`— Vyráběné díly —\`, \`— Normálie —\`,
   \`— Nakupované díly —\`), CSV má sloupce Druh, Norma, Rozměr, Třída / tolerance, Katalogové číslo, Výrobce a desetinný oddělovač
   podle jazyka (čeština a němčina čárka, angličtina tečka). Výchozí druh: normálie z knihovny = normálie (materiál = pevnostní třída
   12.9, kolík „dle normy“ a tolerance m6 v označení), importovaný STEP bez prvků = nakupovaný, vlastní díl = vyráběný. Zadání:
   v dílu \`druh nakupovaný katalog "SFJ8-30" výrobce "…"\`, na komponentě \`sestava komponenta "X" druh normálie|nakupovaný|vyráběný|auto
   [katalog "…"] [výrobce "…"] [rozměr "…"] [třída "…"]\`. Vyráběný díl bez čísla výkresu nebo bez označení materiálu (v kusovníku
   \`— (třída Ocel)\`) = ⚠ \`bom.make-incomplete\`; výkresy (\`--formats pdf\`, \`výkres export pdf dokument\`) se přibalují jen u vyráběných dílů.
   **Kopie dílu:** \`vložit\` uloží kopii dílu; číslo, materiál, geometrie nebo výkres změněné v záložce dílu PO vložení se do sestavy
   samy nepromítnou – kusovník, list sestavy a \`stav\` to hlásí ⚠ \`asm.stale-copy\` s příkazem \`sestava obnovit "Deska A"\` (\`vše\`,
   \`údaje\` = jen číslo, materiál a druh). Obnova zachová polohu, vazby (čísla ploch se převedou podle geometrie) a přezdívku; číslo
   zadané na komponentě zůstane. GUI: panel komponenty → „Obnovit z dílu“, Kusovník → „Obnovit z dílů“ (týž příkaz).
10. \`rám formy 296 346 [deska-a 56] [deska-b 56] [upínací 27] [opěrná 36] [rozpěrky 96] [šířka-rozpěrek 56] [vyhazovací 22]
    [kotevní 17] [sloupky 24] [dutina 140 180 30 | bez dutiny] [materiál 1.2311]\` – rám formy v nové záložce.
11. \`záložky\` (výpis), \`záložka "Čep"\` / \`záložka 2\` (další řádky pracují s ní), \`zavřít záložku ["…"]\`.

API: \`await window.mncad.bom({ structured })\` → \`{ rows: [{ pos, name, number, qty, material, massKg, level }], text, csv }\`;
\`window.mncad.tabs()\` → \`[{ id, title, kind: "part"|"assembly"|"drawing", active }]\`; \`window.mncad.activateTab("Čep" | 2)\`
a \`window.mncad.closeTab(["Čep" | 2])\` vrátí \`true\` / \`false\` (přepnutí se projeví po vykreslení – pak \`getDocument()\`).

\`\`\`
nový díl Deska
kvádr 80 60 10
díra 10,5 skrz v 40 30
díra 9 skrz v 20 15
nový díl Čep
válec 10 30
válec 16 5 v 0 0 30
nová sestava Čep v desce
vložit "Deska" ukotvit
vložit "Čep" v 100 0 0
sestava vazba souosost "Čep" Ø10 "Deska" Ø10,5
sestava vazba kontakt "Čep" -Z největší "Deska" horní
sestava šroub "Deska" Ø9 matice
kolize
kusovník
\`\`\`

### Pokročilé a mechanické vazby, pohybová studie – \`sestava vazba …\`, \`pohyb …\`

Vedle 7 základních vazeb (kontakt, zarovnat, souosost, vzdálenost, úhel, rovnoběžně, ukotvit) je 16 dalších – celkem 23 druhů.
Entita komponenty: \`F12\` = plocha, \`E5\` = hrana, \`V3\` = vrchol (čísla z \`sestava plochy\` / \`měřit\`), u dílu v podsestavě
\`F3@Díl\`; nebo pravidlo \`+Z|-X|horní|spodní|největší|nejmenší|rovinná|válcová|koule|kružnice|úsečka|Ø8|R4\`.

| Druh (CS / EN / DE) | Entity A → B | Volby |
|---|---|---|
| \`kolmo\` / perpendicular / senkrecht | rovina / osa → rovina / osa | – |
| \`tečně\` / tangent / tangential | rovina, válec, koule → rovina, válec, koule | \`obráceně\` = vnitřní dotyk |
| \`shodně\` / coincident / koinzident | vrchol, střed koule / kružnice, osa, rovina → totéž | – |
| \`symetricky\` / symmetric / symmetrisch | plocha → protější plocha, \`rovina "C" F3\` (rovina souměrnosti) | \`obráceně\` |
| \`šířka\` / width / breite | 2 plochy jazýčku (nebo čep) → 2 stěny drážky: \`"A" F1 F2 "B" F5 F6\` | – |
| \`dráha\` / path / pfad | vrchol / střed → hrana (úsečka, kružnice, křivka) | – |
| \`drážka\` / slot / langloch | čep (válec) → 2 válcové konce drážky: \`"Čep" Ø8 "Deska" F7 F8\` | \`poloha N\` (mm od 1. konce) |
| \`závěs\` / hinge / scharnier | válec [+ dosedací rovina] → válec [+ rovina] | bez rovin drží osovou polohu |
| \`zámek\` / lock / sperren | jen komponenty \`"A" "B"\` | – |
| \`mez vzdálenosti\` / limit distance / abstandsgrenze | rovina / bod → rovina | \`min N max N\`, \`od N do M\`, \`N..M\` |
| \`mez úhlu\` / limit angle / winkelgrenze | rovina / osa → rovina / osa | \`min N max N\` [°] |
| \`ozubení\` / gear / zahnrad | osa kola A → osa kola B | \`poměr N\` (otáčky A : B) nebo \`zuby zA zB\`; \`vnitřní\` = stejný smysl |
| \`hřeben\` / rack / zahnstange | osa pastorku → rovina zubů / hrana hřebenu | \`dráha N\` (mm na otáčku) nebo \`modul m zuby z\` (= π·m·z) |
| \`šroub\` / screw / schraube | válec → válec (souosost + stoupání) | \`stoupání P\`; \`levý\` = levý závit |
| \`vačka\` / cam / nocken | zdvihátko (rovina, váleček, koule, vrchol) → plocha vačky | síť plochy s odchylkou 0,002 mm |
| \`kardan\` / universal / kardangelenk | vstupní hřídel → výstupní hřídel | tan θ2 = tan θ1 / cos β, nula = poloha při vytvoření |

Bez entity se u Ozubení / Šroubu / Kardanu vezme osa z vazby Závěs / Souosost komponenty (jinak největší válec), bez hodnoty
poměr poloměrů os, hrubé stoupání ISO podle průměru, u Hřebenu 2π·r pastorku. Mechanické vazby si při prvním řešení zapamatují
výchozí natočení / posuv (\`phase\`) a dál drží vztah přírůstků. Hodnotu a meze lze měnit: \`sestava vazba 3 poměr 2\`,
\`sestava vazba 4 min 0 max 25\`. Řešič: sekvenční průchod (původní vazby přesně jako dřív) + globální Levenberg–Marquardt přes
polohy komponent (uzavřené smyčky klika–ojnice–píst, převody).

**Pohybová studie** (\`pohyb\`, EN \`motion\`, DE \`bewegung\`): motor na vazbě, kroky, výpočet poloh všech komponent v každém kroku.

- \`pohyb motor rotační "Klika" 0..360 krok 5 [kolize] [stopa "Ojnice" bod 60 0 0]\` – rotační motor na vazbě Závěs / Souosost /
  Šroub komponenty (vztaženo k protějšku vazby, ukotvený má přednost; motor na komponentě B vazby obrátí znaménko natočení /
  posuvu, protokol to napíše). \`krok 5\` = 73 kroků po 5°, \`kroky N\` = počet, \`čas T\` = délka [s].
- \`pohyb motor lineární vazba 3 10..40\` – lineární motor. **Význam hodnot podle vazby** (protokol i panel ho vždy píšou):
  Vzdálenost a Drážka s polohou = **hodnota vazby** (absolutní mezera / poloha – \`57,5..27,15\` = z mezery 57,5 na 27,15, zdvih
  30,35; znaménko se neobrací, ani když je motor zadán komponentou B vazby); Souosost / Dráha / Šroub / Drážka bez polohy a každý
  rotační motor = **posuv / natočení od výchozí polohy** (0 = jak díl stojí; \`0..-30,35\` = o 30,35 mm proti směru osy).
- **Zdvih místo konce:** \`pohyb motor lineární vazba "ZDVIH" zdvih -30,35\` (EN \`stroke\`, DE \`hub\`; rotační i \`otočení 90\`) = konec
  o Δ od začátku; bez \`od A\` začíná motor na aktuální hodnotě vazby (Vzdálenost) / na 0 (posuv). \`od 57,5 zdvih -30,35\` = totéž
  s výslovným začátkem. Zdvih není „konec“: \`0..30,35\` na vazbě s mezerou 57,5 znamená skok na mezeru 0 → ⚠ \`motion.start-jump\`.
- **Rozsah × rychlost:** \`pohyb motor lineární vazba 1 57,5..27,15 rychlost 15,175\` (rotační \`0..720 ot/min 60\`) = z 57,5 na 27,15
  rychlostí 15,175 mm/s, **na konci motor stojí**; délka studie = |do − od| / rychlost (2 s). Rychlost je velikost – směr dává
  rozsah (\`27..57 rychlost -5\` je chyba). Se zadaným \`čas T\`: kratší než jízda = chyba s vysvětlením, delší = motor po dojetí
  stojí. Později zkrácená studie = ⚠ \`motion.motor-short\`; druhý motor s delší jízdou studii prodlouží (⚠
  \`motion.duration-extended\`); jediný motor bez \`čas\` změní dřív zadanou délku studie jen s ℹ \`motion.duration-set\` a dynamickou
  studii nezkracuje. **Jen rychlost** (\`rychlost 5\`, \`od 40 rychlost -5\`, \`ot/min 60\`) = od začátku bez konce,
  znaménko = směr. Popis motoru: \`hodnota vazby 57,5 → 27,15 mm ↓ zdvih 30,35 mm · 15,175 mm/s · 2 s\` (↓ hodnota klesá, ↑ roste,
  ↺ / ↻ natočení). Mezera Vzdálenosti pod nulou bez kontroly kolizí = ⚠ \`motion.gap-negative\` (plochy se prostoupí).
- **Starší dokumenty a skripty:** zápis \`A..B rychlost V\` dřív znamenal jízdu od A bez konce (B se nepoužilo); dnes je to rozsah ×
  rychlost. Dřívější význam zapíšete \`od A rychlost V\`. Uložený motor s rychlostí a nepoužitým koncem (dokument starší verze) dá
  ⚠ \`motion.end-unused\` při načtení i při výpočtu (kam motor opravdu dojede, i opačným směrem); převod na rozsah × rychlost =
  znovu zadat \`pohyb motor … A..B rychlost V\` (v panelu tlačítko „Převést na rozsah × rychlost“), převod do skriptu to uvede v poznámce.
- **Motory na strojovém řádku** (i ve stručném protokolu): na konci \`= … motion …\` jedno pole na motor
  \`m<i>=<průběh>:<začátek>><konec>:<směr>\` – průběh \`range\` | \`back\` (\`55>25>55\`) | \`ranged\` | \`open\` (konec = hodnota na konci
  studie), směr \`+\` roste / \`-\` klesá / \`+-\` \`-+\` tam a zpět; např. \`m1=ranged:57.5>27.15:-\`. Pole nese ZADANÝ rozsah; motor,
  který ve zkrácené studii na konec nedojede (⚠ \`motion.motor-short\`), má navíc na konci řádku \`m<i>.end=<hodnota na konci studie>\`
  (např. \`m1.end=42.325\`) – skutečný dojezd, stejně jako \`travel=\`.
- **Vazba pro motor – hlavní zdvih × vedení:** Vzdálenost a Drážka s polohou = motor řídí HODNOTU vazby (řádek motoru „hodnota
  vazby 57,5 → 27,15 mm ↓ zdvih 30,35 mm“); Souosost, Drážka bez polohy, Dráha, Šroub = vedení, motor posouvá / natáčí od výchozí
  polohy („posuv od výchozí polohy“). Formulář motoru v panelu nabízí vazby v těchto dvou skupinách (předvybraná první vazba
  s hodnotou) a u vazby, kterou už motor pohání, dopíše „– pohání motor N“; druhý motor na témže stupni volnosti = ⚠
  \`motion.motor-conflict\`.
- **Režim studie a úroveň simulace (vlna 22, bod 2):** \`pohyb kinematika\` = polohy jen z vazeb a motorů (pružiny se měří, netlačí);
  díl, kterého polohu vazby neurčují (volný v mezi – stírací deska, přidržovač), zůstává, kde byl, a posune ho jen doraz meze → ⚠
  \`motion.undetermined\` a souhrn místo „Vazby splněny ve všech krocích“ napíše „⚠ vazby splněny …, ale polohu „X“ neurčují“.
  \`pohyb kvazistatika\` = v každém kroku **rovnováha** pružin (energie ½·c·(L0 − L)², pružina jen tlačí) a jednostranných kontaktů
  (meze vazeb, délka pružiny na doraz Ln) – nezávisle na předchozím kroku, směru přehrávání i historii úprav (přidržovač s předpětím
  na horní mezi, dokud nedosedne: Z = max(10; Z_deska − 33)). \`pohyb dynamika\` = přechodový děj. \`pohyb automaticky\` (výchozí) =
  kvazistatika, když na pohyblivou komponentu dosedá pružina, jinak kinematika. Každý protokol studie má řádek \`Úroveň simulace:
  kvazistatika – … (zvoleno automaticky: …)\` a strojový řádek končí \`level=kin|quasi|dyn\` (\`anim\`, \`+geo\` doplní fáze / procesní
  vrstva). JSON: \`motion.mode: "kinematic" | "quasistatic" | "dynamic"\` (chybí = automaticky).
  Kolo 6: kinematika s preferovanou stranou meze, kterou v sestavě přebila rovnováha pružiny, začne jinde než sestava → ⚠
  \`motion.start-jump\` „krok 0 se liší od polohy v sestavě: „Přidržovač“ 11 mm …“ (a souhrn bez „Vazby splněny“); pružina na
  dorazu Ln ve všech krocích = ⚠, ne ✓. Kvazistatika, jejíž krok 0 (rovnováha pružin) je jinde než uložená poloha, to řekne také
  (⚠ \`motion.start-jump\` „… uložená poloha není v rovnováze pružin …“). Nevedený díl (jen rovinné vazby – posuv v rovině
  a natočení nic neurčuje), který moment mimoosé pružiny v kvazistatice posouval / natáčel, drží nejmenší změnu od polohy, kdy se
  stal nevedeným (bez sčítání malých posunů) → ⚠ \`motion.undetermined\` „díl „X“ není veden – moment pružiny …“. Dynamika startuje
  z polohy dokumentu (přechodový děj, např. puštění přidržovače na doraz); jen když začátek motoru skáče proti hodnotě vazby
  v sestavě, startuje z kvazistatické rovnováhy v okamžiku začátku motoru (krok 0 = krok 0 kvazistatiky) a řekne to ⚠
  \`motion.start-jump\` krok 0.
- **Priorita podmínek a motor na mezi (bod 8):** tvrdé podmínky (ukotvení, zámky, kontakty, zarovnání, souosost, pevné vzdálenosti,
  meze, Ln pružin) > hodnota motoru > preference. Nesplnitelný krok se nikdy nevyřeší kompromisem (ujetí a naklopení desek):
  \`na mezi stop\` (výchozí; EN \`at limit stop\`, DE \`an grenze stopp\`) = motor stojí na poslední dosažitelné hodnotě, krok má
  fyzikální polohu → ⚠ \`motion.motor-limit\` „motor 1 stojí na mezi v krocích 8–12: žádáno 37,267 → 27,15 mm, dosaženo 37,5 mm –
  brání: „Mez“ 5 mm – na mezi min 5 mm (doraz); „PEVNÁ“ 24,5 mm (splněno); příčina: …“; \`na mezi chyba\` (EN \`error\`, DE
  \`fehler\`; JSON motoru \`atLimit: "error"\`) = kroky neplatné, \`place\` = poslední platný krok, ⚠ \`motion.invalid\`. Volba platí
  pro každý motor zvlášť (i v dynamice: motor, který díl porušené meze nepohání, se jí neřídí) a zastavení je směrové – když profil
  couvne na dosažitelnou stranu (zpětný zdvih), motor se znovu rozjede a „stojí na mezi“ hlásí jen kroky, kdy opravdu stál. Vazby, které si
  odporují i bez motoru = neplatné kroky s příčinou „vazby si odporují“. Kód \`motion.conflict\` po vazbách a úsecích zůstává; souhrn
  vypíše nejvýš tři odchylky, \`pohyb krok N\` všechny („konflikt: …“). Strojově \`stopped=N invalid=N undetermined=N\` před \`level=\`.
  Panel: krok „motor stojí na mezi“ / „NEŘEŠITELNÝ krok – zobrazen krok 7“, 3D okno neplatného kroku červeně orámované
  (\`data-motion-invalid\`). Délka pružiny na doraz Ln je doraz i v kinematice (dřív pružina „prošla“ a jen řádek pružiny byl ✗).
  „Nesplněné vazby: N“ a \`motion.conflict\` počítají jen skutečně porušené vazby a pohony; vazba, která motor zastavila a je splněná
  (pevná vzdálenost, mez na dorazu), je v \`pohyb krok N\` „brání: …“. V **dynamice** platí \`na mezi stop\` (výchozí) i \`chyba\` také:
  mez porušená předepsaným pohybem motoru zastaví motory na poslední platné hodnotě (⚠ \`motion.motor-limit\`), resp. snímky za mezí
  jsou neplatné (⚠ \`motion.invalid\`, zobrazena poslední platná poloha) – všechny snímky, dokud motor žádá jinou hodnotu než
  v posledním platném snímku, i když za mezí už stojí (dojel). Stav integrátoru za mezí je nefyzikální: blok Dynamika bere zdvih, v max,
  a max, dotyky dorazů, síly pružin a energii jen z platných kroků (⚠ „neplatné kroky 4–12 … jen z platných kroků“, energie „v posledním
  platném kroku (t = …)“), neplatný snímek nemá \`dyn\` (CSV prázdné buňky, graf mezera). Zastavený motor je v dynamice stejně jako v kinematice nesplněný pohon:
  \`conflicts=N\`, „nesplněné vazby v N krocích“ a \`motion.conflict\` vazby motoru, nikdy „Vazby splněny ve všech krocích“.
  \`motion.motor-limit\` u profilu, který za mezí dojel a couvl, dopíše nejzazší žádanou hodnotu („žádáno 37,226 → 37,348 mm
  (nejdál 27,15 mm)“).
- **Preferovaná strana meze:** \`sestava vazba "Mez" preferovat max\` (EN \`prefer\`, DE \`bevorzugen\`; \`ne\` = zrušit; JSON
  \`prefer: "min" | "max"\`) u Meze vzdálenosti / úhlu a Drážky bez polohy: kinematika i přepočet vazeb drží díl u této meze, když ho
  ostatní vazby neurčují; pevnou vazbu, ukotvení, kontakt ani motor nepřebije. Výpis vazby končí „· preferuje max“.
- **Statický přepočet (úpravy vazeb a poloh):** díly volné v mezi se posunou do rovnováhy pružin a preferovaných stran (stejný
  dokument nezávisle na historii – ZDVIH 27,15 a zpět 57,5 = výchozí poloha; řádek „rovnováha pružin … posunula: …“); při načtení
  a zjišťování stavu se dokument nehýbe. Úprava, kterou nelze splnit, **nezapíše kompromis**: polohy zůstanou, řádek začíná ⚠ (ne ✓)
  a ⚠ \`mate.conflict\` uvede „nejbližší dosažitelná hodnota 37,5 mm (zadáno 37,15 mm) – brání: …“.
- **Jedna studie s fázemi (vlna 22, bod 3)** – nájezd, sevření, střih, značení a návrat v JEDNOM dokumentu:
  **úseky motoru** \`pohyb motor lineární vazba "ZDVIH" 80..50..40..37 rychlost 50 prodleva 0,1 pak 80 rychlost 100\` (mezipolohy
  \`A..B..C\`, \`pak B [čas T | rychlost V]\`, \`prodleva T\`, \`od A pak B čas T …\`; úseky bez času vyplní okno / zbytek studie stejnou
  rychlostí), **klíčové polohy** \`klíče 0:57,5 0,3:40 0,6:27,15 1:57,5\` (čas od začátku motoru), **časové okno** \`okno 0,2..0,6\` (nebo
  \`od 0,2 s do 0,6 s\`), **fáze motoru** \`fáze "Návrat"\` (motor začne s fází). Na téže vazbě pohání motor, který začal nejpozději;
  další motor na téže vazbě se stejným začátkem ji **nahradí s ℹ \`motion.motor-replaced\`**, \`navázat\` (EN \`append\`, DE \`anhängen\`)
  připojí úseky za dosavadní motor. **Fáze:** \`pohyb fáze "Sevření" při vazba "MEZERA" <= 0 potlačit vazba "NESENÍ" zapnout vazba
  "MEZERA" [kinematika|kvazistatika]\` (EN \`motion phase "Clamp" when mate … <= 0 suppress mate … enable mate …\`, DE \`bewegung phase
  "Klemmen" wenn verknüpfung … <= 0 unterdrücken … aktivieren …\`); podmínka \`při vazba N <=|>= v\` (Vzdálenost = hodnota vazby, jinak
  posuv od výchozí polohy), \`při motor N >= v\`, \`od T s\`; bez podmínky = první fáze od začátku, další po dojetí motorů předchozí fáze.
  Okamžik podmínky se zpřesní mezi kroky (± 0,001); **zapnutá vazba zachytí polohu v tom okamžiku** (zámek drží díly, jak právě jsou).
  Podmínka hodnoty je **hrana**: platí-li už v okamžiku začátku předchozí fáze, fáze počká, až přestane platit a znovu začne.
  \`pohyb fáze N upravit|smazat|nahoru|dolů\`, \`pohyb fáze\` = výpis, \`pohyb událost při …\` = fáze bez názvu. Protokol po fázích:
  \`Fáze 2 „Sevření“: kroky 31–40 · t = 0,6–0,794 s · začátek: vazba „MEZERA“ ≤ 0 · kinematika · nesplněné vazby 0\`; fáze, která
  nenastala = ⚠ \`motion.phase-unreached\`; motor fáze, jehož začátek nesedí na hodnotu vazby v okamžiku začátku = ⚠ \`motion.start-jump\`.
  Podmínka na Mezi vzdálenosti / úhlu měří mezeru meze; podmínku na vazbě bez hodnoty (zámek, shoda, rovnoběžnost …) odmítne už
  \`pohyb fáze\` (✗ „nejde měřit“). Fáze, která čeká na předchozí nezačatou fázi, to řekne („čeká na předchozí fázi „X“, která nezačala“).
  Strojově na konci řádku \`phases=<nastalé>/<všechny>\`, motor s úseky \`m1=keys:80>50>40>37>80:---+\`. Dynamika po fázích zatím není.
  Restart = vždy z dokumentu (studie dokument nemění); fáze a úseky jdou i do převodu dokument → skript.
- **Procesní vrstva – střih a otisk řízený pohybem (vlna 22, bod 4):** \`pohyb proces střih "Razník" "Plech"\` (EN \`motion process cut\`,
  DE \`bewegung prozess schnitt\`) – v každém kroku se PŮVODNÍ obrobek protne s nástrojem v poloze kroku, průniky se sčítají (postupný
  střih), po prostřižení se odebraný materiál oddělí jako **odpad** (\`odpad padá\` – s nástrojem, pak volný pád, výchozí | \`s nástrojem\` |
  \`zůstane\`); \`pohyb proces ražení "Razník" "Plech" hloubka 0,3\` (EN \`imprint … depth 0.3\`, DE \`prägen … tiefe 0,3\`) = otisk s řízenou
  hloubkou; \`hloubka\` u střihu = nástřih. Začátek: bez podmínky od dotyku (poloha), \`od 0,5 s\`, \`při motor 1 <= 1\`, \`při vazba "ZDVIH" <= 1\`
  (vazba poháněná motorem) nebo \`fáze "Střih"\`. \`pohyb proces\` = seznam a výsledek, \`pohyb proces 2 smazat\`, \`pohyb proces smazat\`.
  Protokol: \`Procesní vrstva: geometrická aproximace – booleovské odebrání …; není to simulace materiálu (žádné síly, otřep, odpružení ani
  tok materiálu)\`, \`střih 1 „Razník“ → „Plech“: záběr od kroku 19 … · prostřiženo v kroku 21 … · odebráno 314,159 mm³ · hloubka 1 mm · odpad
  1 ks\`, \`Stav výrobku „Plech“: plný (kroky 0–18) → v záběru (kroky 19–20) → děrovaný (kroky 21–48)\`; úroveň \`kinematika + geometrická
  aproximace\`, strojově \`level=kin+geo … proc=1 removed=314.159 scrap=1 through=21\` na konci řádku. Pracovní záběr nástroje do obrobku od
  začátku operace = ℹ \`clash.work\` (pravidlo „proces střih 1“, jeden model s \`kolize pravidlo pracovní\`), nikdy ⚠ clash.real; nástroj,
  který obrobek nezasáhne = ⚠ \`motion.process-miss\`; neprostřiženo = ℹ \`motion.process-partial\` (i otisk mělčí než zadaná hloubka:
  \`otisk do „Plech“ 0,1 mm z požadovaných 0,3 mm\`); strop 48 booleovských operací na operaci = ℹ \`motion.process-approx\`. Krok delší
  než polovina nástroje ve směru pohybu (razník projde plechem mezi dvěma kroky): procesní vrstva doplní mezipolohy z řešiče
  (\`záběr od mezipolohy mezi kroky 0 a 1 (t = 0,667 s)\`); začátek operace uprostřed kroku (\`při motor 1 <= 5\`) = úsek od polohy
  v okamžiku začátku; hodnota motoru mezi kroky se bere z profilu motoru (kosinus u \`tam a zpět\`), takže začátek v úvrati mezi kroky
  (\`kroky 21 tam a zpět\` + \`při motor 1 <= -45\`) nastane v t = 1 s, ne „nenastal“; obrat motoru uvnitř kroku je vždy mezipolohou (jediný krok
  tam a zpět: razník plechem projde); profil nesedí na kroky = „začátek … mezi kroky nezjištěn“ (⚠ \`motion.process-between\`), strop mezipoloh se posuzuje pro každou operaci zvlášť (jiná operace obrobku nezjištěna → \`odebráno nejméně …\`, kv \`removed=…+\`); nejdou-li spočítat (dynamika, řešič bez řešení), úsek by potřeboval víc než 64 mezipoloh
  (tenký nástroj, dlouhý krok) nebo spojitá kontrola kolizí najde nástroj × obrobek mezi kroky a procesní vrstva ne = ⚠ \`motion.process-between\`
  „výsledek procesu nezjištěn“ s důvodem a stav výrobku \`nezjištěn\`, nikdy „plný“ ani „nezasáhl“. Víc operací: hotový výsledek má přednost – \`děrovaný + v záběru\`. \`pohyb krok N\` vypíše stav výrobku a hloubku zásahu; \`stav\` stav na konci. Dokument se NEMĚNÍ:
  krok 0 / restart = plný obrobek (výsledek je odvozený výsledek studie). Obrobek i nástroj = díl (ne podsestava). Víc operací na
  TÉMŽE obrobku se kombinuje: stav obrobku = obrobek − sjednocení odebraných objemů všech operací v kroku (druhý střih do téže díry
  nic nepřidá: \`proc=2 removed=314.159 scrap=1\`, řádek \`„Plech“: 2 operací, celkem odebráno 314,159 mm³ (sjednocení …; součet
  operací 628,319 mm³)\`), 3D ukáže obrobek po všech operacích; bez kombinace z jádra jen dolní mez \`removed=…+\` a ⚠.
  Zápis události \`pohyb událost při vazba "ZDVIH" <= 1 odeber "Razník" z "Plech"\` = totéž jako střih s podmínkou. \`pohyb úroveň\`
  (EN \`motion level\`) vypíše úroveň; úroveň se příkazem nevolí (geometrická aproximace = procesní operace).
- **Motory při definici (bod 10):** po \`pohyb motor …\` řádek \`pohání: „Přidržovač“ + 1 díl – spolu s ním kvůli pevné vazbě (zámku):
  „Šroub M12“ · směr −Z\` (zkušební posun řešičem); druhý motor na tomtéž stupni volnosti = ⚠ \`motion.motor-conflict\` hned při zadání
  (ne až ve výpočtu) – i když mají motory jiná časová okna / fáze (motor po konci okna dál drží svou hodnotu); přijetí takového motoru
  je \`→ motor 2 přijat, ale je v konfliktu (motion.motor-conflict)\` (ℹ), ne ✓, a \`motion.motor-limit\` uvede „brání: motor 1 (ZDVIH) –
  tentýž stupeň volnosti“; motor, kterým nejde pohnout (stupeň volnosti drží vazby), také. Panel: „+ Nový motor“ × „Upravit motor N“
  (klik na motor v seznamu), řízené díly zvýrazněné a osa se šipkou směru ve 3D okně (i bez WebGL).
- **Souhrn po tuhých skupinách (bod 15):** výchozí výpis pohybu = jeden řádek na skupinu dílů se stále stejnou vzájemnou polohou
  (tolerance, žádné „58 + 1“ ze zaokrouhlení): \` „Horní deska“ + 20 dílů (tuhá skupina – zámek / pevné vazby): ΔZ −30 mm\`, pak
  \` stojí: 1 („Deska A“)\` a nesplněné vazby; po dílech \`pohyb detail\` / \`pohyb stav detail\` (EN \`motion detail\`). Strojově na konci
  řádku \`groups=21:z-30,1:z-24.75\` (počet dílů : osy ± posunutí v kroku největšího vychýlení).
- \`pohyb\` / \`pohyb stav\` – definice a souhrn (pohyb tuhých skupin, kolize po třídách – první skutečná, nesplněné vazby); \`pohyb krok 12\` – polohy
  v kroku; \`pohyb export csv\` – tabulka (krok; čas; motory; X Y Z RX RY RZ každé komponenty; stopa; kolize) přímo v protokolu;
  \`pohyb přehrát [smyčka]\`, \`pohyb zastavit\`, \`pohyb export png|webm\` (snímky ZIP / video z 3D okna, jen v aplikaci);
  \`pohyb kroky 48 čas 2 kolize vyp\`, \`pohyb motor smazat 1\`, \`pohyb smazat\`.
- API: \`await window.mncad.motion('motor rotační "Klika" 0..360 krok 5')\` (text = volitelný příkaz \`pohyb …\` předem) vrátí
  \`{ steps: [{ step, t, motors, comps: { "Píst": { position, rotation } }, trace?, clashes?, conflicts }], summary, collision, csv }\`;
  klíč v \`comps\` = instance: název, u stejně pojmenovaných komponent \`"Šroub #12"\` (pořadí) nebo \`"Šroub [K48]"\` (přezdívka) –
  každá komponenta má svůj záznam (stejně sloupce CSV).
- Studie se ukládá do sestavy (\`motion\` v JSON; rozsah × rychlost má u motoru \`ranged: true\`) a v \`stav\` je řádek
  „Pohybová studie: …“.
- **Výsledek platí jen pro stav sestavy, pro který vznikl** (dokument + geometrie a konfigurace dílů + polohy, i komponent uvnitř
  podsestav + vazby + studie; u dynamiky i materiál dílů). Po změně čehokoli z toho: \`stav\` píše „Pohyb: výsledek NEPLATÍ – od
  výpočtu se změnilo: geometrie dílu „Deska A““ (strojově \`motion=stale motion.stale=1\`, nespočítáno \`motion=-\`), \`pohyb stav\` dá
  ⚠ \`motion.stale\` bez souhrnu (řádek \`= … motion steps=5 t=2 motors=1 motion.stale=1 m1=…\`) a nepřepočítává; \`pohyb spustit\`,
  \`pohyb krok N\`, \`pohyb export\`, \`pohyb přehrát\` a \`window.mncad.motion()\` přepočítají (ℹ \`motion.recomputed\` řekne, co se
  změnilo) – starý výsledek se nikdy nevrací jako platný. Platný výsledek: \`motion=ok\` JEN když se kolize v krocích opravdu
  kontrolovaly bez průniku a k motorům není upozornění; \`motion=mates-ok\` = vazby splněny, kolize nekontrolovány; \`warn\` = ⚠ k motorům
  (skok začátku, motor nedojede, mezera pod nulou, nepoužitý konec), ⚠ procesní vrstvy nebo sledovaná vůle pod limitem; \`conflict\` / \`clash\` = nesplněné vazby / průnik. Dva výpočty
  téhož stavu (panel + text, dvakrát API) se spojí v jeden. Panel studie má stav \`data-motion-state="ok|stale|unchecked|running"\` a
  verdikt \`data-motion-verdict\`.
- Natočení v souhrnu (\` · natáčí se 30°\`) = největší úhel mezi natočením v kroku a výchozím natočením (krok 0) – porovnávají se
  matice, ne Eulerovy úhly: komponenta vložená s \`otočení 180 0 0\`, která se jen posouvá, „natáčí se“ nehlásí.

**Pružina v sestavě** (\`sestava pružina\`, EN \`assembly spring\`, DE \`baugruppe feder\`): komponenta s prvkem Pružina
(\`normálie pružina d2 D20 L44 n8\` = DIN 2095, DE \`normteil feder d2 D20 L44 n8\`, nebo vlastní díl
\`pružina 18 stoupání 5,25 závity 8 drát 2\`; zjednodušeně i trubka / válec) mezi dvěma komponentami. Délka L = vzdálenost dosedací
plochy A (strana začátku pružiny) a B po ose pružiny; začátek pružiny se posune na plochu A. Bez zadané plochy se vezme nejbližší
rovinná plocha komponenty kolmá na osu pružiny, obrácená k ní (u A ve směru osy, u B proti ní) **a s materiálem pod pružinou** –
plocha, kterou pružina prochází otvorem (díra Ø ≥ průměr pružiny), se přeskočí; když jiná není, příkaz skončí ✗ „osa pružiny
prochází komponentou „…“ otvorem“ – zadejte komponentu, o kterou se pružina opravdu opírá (např. další desku), nebo plochu \`F12\` /
pravidlem jako u vazeb. Polohu napříč (osu) určuje umístění pružiny (\`vložit … v x y z\`, \`sestava vazba zámek #k "A"\`).

- \`sestava pružina "P" mezi "A" "B" volná 44 blok 20 tuhost 25\` (EN \`between … and … free 44 solid 20 rate 25\`, DE
  \`zwischen … und … frei 44 block 20 steifigkeit 25\`) – \`volná\` = L0 (výchozí délka modelu), \`blok\` = délka na doraz Ln (výchozí
  (závity + 1) · drát), \`tuhost\` = c [N/mm]; \`blok 0\` / \`tuhost 0\` dřív zadanou hodnotu zruší (doraz z modelu, bez síly).
  \`vedená ano|ne\` (EN \`guided yes|no\`, DE \`geführt ja|nein\`) = pružina vedená dírou / kapsou nebo trnem (vzpěr se pak
  nehlásí; „Pružina mezi díly“ do díry ji nastaví sama) – řádek pružiny i \`sestava pružiny\` končí „· vedená“ / „· nevedená“.
  Stejný název = všechny instance (6 pružin jedním řádkem), \`#k\` / přezdívka = jedna. Protokol: stejné pružiny ve stejném
  stavu jeden řádek s počtem \`(6×)\`, stejný název v různém stavu řádek pro každý stav s \`#k\` / \`[přezdívka]\`
  (\`✓ pružina „P“ #3: …\`, \`⚠ pružina „P“ [P2]: …\`).
- ✗ = stlačena pod délku na doraz (\`… – stlačena pod délku na doraz Ln 20 mm (vzdálenost ploch 18 mm, chybí 2 mm)\`), ⚠ = nedosedá
  (vzdálenost ploch > L0 – tvar zůstane volný, napíše mezeru). Bez tuhosti se síla nepíše. Plochy v obráceném pořadí (B pod A) =
  ✗ „prohoďte A a B“ a definice se **neuloží**.
- Délka se přepočítá při každém přepočtu vazeb (\`sestava vazba …\`, \`sestava vazba 3 hodnota=…\`), při přesunu komponenty (i v sestavě
  bez vazeb – \`sestava komponenta "B" v …\`, gizmo, panel) a v každém kroku pohybové studie; souhrn studie má řádek
  \` ✓|⚠|✗ pružina „…“: délka 38 → 32 mm (min 32 · L0 44 · Ln 20) · síla 150 → 300 N (max 300 N)\` (✗ s kroky pod dorazem),
  \`pohyb export csv\` přidá sloupce \`<pružina> L [mm]\` a \`<pružina> F [N]\`, \`window.mncad.motion()\` vrátí v kroku
  \`springs: { "<pružina>": { length, seat, force, level } }\`. Klíče \`springs\` i \`comps\` jsou podle **instance**: název, u
  stejných názvů \`"P #3"\` (pořadí) nebo \`"P [P2]"\` (přezdívka). Kolize v kroku počítají s pružinou v délce kroku.
- **Řídicí × odvozené (vlna 22, bod 7):** ŘÍDÍ polohy komponent, dosedací plochy A/B a L0 / Ln / tuhost; \`length\`, \`offset\` a
  \`seat\` v JSON jsou jen odvozená mezipaměť. Po načtení dokumentu (řádek JSON, \`otevřít\`, CLI \`--open\`, \`window.mncad.setDocument\`,
  Soubor › Otevřít v aplikaci) se délka odvodí z ploch v nynějších polohách; rozpor nad 0,01 mm = ⚠ \`spring.stale\` „pružina „P“:
  uložená délka 25 mm neodpovídá dosedacím plochám (15 mm) – délka odvozena z ploch“ a oprava jedním krokem historie (zpět ji vrátí).
  Dosedací plocha, kterou díl nemá (číslo plochy mimo díl), se při načtení označí jako ztracená: ⚠ \`spring.lost\` na řádku načtení
  i při každém \`stav\` (přísný režim zastaví), řádek D / \`= … status\` / Σ nesou \`springs.lost=1\`.
  \`stav\` ověří délku proti plochám: \`Pružiny: „P“ 15 mm (L0 32 · Ln 14) · F 340 N ✓ – délka odvozená z dosedacích ploch (řídí
  polohy komponent)\`, rozpor ⚠ s oběma délkami, bez geometrie „uložená délka, s dosedacími plochami nezkontrolováno“ (bez ✓).
  Kolize, STEP, výkres i 3D pracují s délkou z ploch.
- \`sestava pružiny\` – stav všech pružin; \`stav\` má řádek \`Pružiny: „P“ 38 mm (L0 44 · Ln 20) · F 150 N ✓ (6×)\`;
  \`sestava pružina "P" odebrat\` – definice pryč, tvar ve volné délce. \`sestava odebrat "A"\` (dosedací komponenta) odebere i
  definice pružin, které na ní dosedaly (\`pružiny bez dosedací komponenty …\`).
- Tvar: v jádře (export STEP / BREP, kolize, objem, výkres, zobrazení po přepočtu) se díl pružiny staví **přesně v aktuální délce** –
  mění se stoupání (počet závitů a drát zůstávají), u trubky / válce výška; při přehrávání pohybové studie v okně se síť drátu
  spočítá v délce kroku (vlna 21: stoupání činných závitů se mění, drát zůstává kulatý, závěrné závity přiložené, broušené konce
  rovinné v 0 a L; mezipaměť podle délky na 0,01 mm) – jen trubka / válec se protáhne po ose. V kusovníku (\`kusovník\`, panel Kusovník, tabulka na výkrese) je pružina
  jedna položka podle zdroje bez ohledu na délku; hmotnost = těleso v aktuální délce (stejně jako \`stav\`).
- V aplikaci: panel komponenty › Pružina mezi komponentami (Dosedá na A, Stlačuje B, L0, Ln, c) – provede tentýž příkaz.
- **Nová pružina mezi díly** (vlna 21; Sestava › Pohyb › Pružina mezi díly – klik / seznam ploch A a B, tabulka, Vytvořit):
  \`sestava pružina nová [d 2] [De 20] [L0 35] [n 6] [materiál SH|DH|VDSiCr|1.4310] [tuhost c] [blok Ln] mezi "A" <plocha> "B" <plocha>
  [v x y z] [do děr vzoru] [název "P"]\` (EN \`assembly spring new … between … all holes\`, DE \`baugruppe feder neu … zwischen …
  alle bohrungen\`). Plocha A = díra / kapsa (válcová plocha, \`Ø21\`, \`F12\`) nebo rovina, B = protější rovina (\`horní\`, \`F3\`)
  nebo díra. Osa = osa díry, u dvou rovin normála (bod osy \`v x y z\`, jinak střed roviny A). Začátek pružiny na dně kapsy (u díry
  A konec dál od B, dosedací plochu pak najde pravidlo s materiálem pod pružinou), vzdálenost dosedacích ploch se změří. Chybějící
  rozměry se předvyplní: De podle díry (vůle 5 %, nejméně 0,5 mm), d ≈ De/10, L0 = 1,15 × vzdálenost (předpětí 15 %), n ze stoupání
  ≈ 0,29·D. Tuhost a Ln se spočtou podle EN 13906-1: \`R = G·d⁴ / (8·D³·n)\` (G: SH/DH 81 500, VDSiCr 79 500, 1.4310 70 000 N/mm²),
  \`nt = n + 2\`, \`Ln = nt·d\`; tabulka a protokol navíc kontrolují (stejné vzorce jako tabulková pružina balíku part): nejmenší
  pracovní délku \`Ln + Sa\`, \`Sa = (0,0015·D²/d + 0,1·d)·n\` (pod ní ⚠ „závity se dotýkají“), napětí \`τ = 8·D·F/(π·d³)\` při montáži
  a na dorazu vůči \`τzul = 0,5·Rm(d)\` – statická kontrola EN 13906-1 bez korekce, stejně jako výpočet tabulkové pružiny
  (⚠ „napětí 163 % dovoleného …“); korigované \`τk = k·τ\`, \`k = (w + 0,5)/(w − 0,75)\`, \`w = D/d\` nad τzul dá přísnější ⚠ „napětí
  s korekcí k … – staticky vyhoví“ (opakované zatížení stírače) – a vzpěr (kritický zdvih sK, ν = 0,5; pružina v díře / kapse je vedená
  a vzpěr se nehlásí ani v souhrnu pohybu). L0 ≤ Ln nebo De ≤ d = ✗, pružina se nevytvoří. Stejné kontroly dělá souhrn
  pružin kinematické i dynamické studie při nejkratší dosažené délce (\` ⚠ pružina „P“: délka … – pracovní délka 20 mm je pod
  nejmenší přípustnou Ln + Sa = 22,22 mm …\`) – jen u drátové pružiny, jejíž zadaná tuhost odpovídá geometrii dílu (±10 %; jinak
  je díl jen náhradní tvar jiné pružiny). \`sestava pružina nápověda\` vypíše přehled příkazů. Díl pružiny = tabulková tlačná pružina \`spring.compression\` (broušené konce,
  materiál drátu v datech prvku – \`pružina tabulka\` v dílu pružiny vypíše celý výpočet) v aplikaci i v příkazové řádce; komponenta dostane \`zámek\` ke komponentě A a definici pružiny tímtéž
  výpočtem jako \`sestava pružina\`. \`do děr vzoru\` = do všech děr stejného Ø, osy a hloubky na stejném dílu (6 pružin stírače jedním
  řádkem); u existující pružiny \`sestava pružina "P" mezi "A" "B" do děr vzoru\` zkopíruje pružinu (i se zámkem) do ostatních děr
  vzoru díry, ve které stojí. Protokol: \`✓ nová pružina „Pružina 2×19,5×41“ 4× · d 2 · De 19,5 · L0 41 · n 7,5 · R 4,055 N/mm ·
  Ln 19 mm · do děr F7/F8/F9/F10 Ø21 – zámek ke komponentě „Horní deska“\` a stav pružin \`(4×)\`.

Příklad (sestava: „Vodicí deska“ dole, nad ní „Kotevní deska“ s otvory Ø20, kterými pružiny procházejí, nahoře „Opěrná deska“
s vazbou Vzdálenost „ZDVIH“ 38 k vodicí desce; 2× „Pružina R20“ = trubka Ø20/Ø10 × 38 stojící na vodicí desce):

\`\`\`
sestava pružina "Pružina R20" mezi "Vodicí deska" "Opěrná deska" volná 44 blok 20 tuhost 25
pohyb motor lineární vazba "ZDVIH" 38..32 kroky 6
pohyb
\`\`\`

Protokol: \`✓ pružina „Pružina R20“: délka 38 mm · L0 44 · Ln 20 · stlačení 6 mm · síla 150 N (c 25 N/mm) (2×)\` a v souhrnu
studie \` ✓ pružina „Pružina R20“: délka 38 → 32 mm (min 32 · L0 44 · Ln 20) · síla 150 → 300 N (max 300 N) (2×)\`. Se „Kotevní
deska“ místo „Opěrná deska“ skončí řádek ✗ (pružiny procházejí jejími otvory a na ní nedosedají).

**Dynamika** (vlna 21; Pohybová studie › Dynamika, \`pohyb dynamika\`, EN \`motion dynamics\`, DE \`bewegung dynamik\`): díly se
hýbou silami – pružiny (F = c·(L0 − L) jen při dosednutí, + tlumič \`tlumení\` [N·s/mm] paralelně k pružině), gravitace (výchozí
−Z, 9,81 m/s²), zadaná síla / moment na vazbě – po stupních volnosti, které nechávají vazby (posuv po Souososti / Drážce / mezi
rovinami, natočení na Závěsu; i několik nezávislých). Motory na jiných vazbách pohánějí jako v kinematice (předepsaný pohyb).
Meze vazeb (Mez vzdálenosti min/max, Mez úhlu, konce Drážky) a délka pružiny na doraz Ln jsou **dorazy**: díl se zastaví,
rychlost do dorazu se nahradí odrazem −e·v (\`odraz e\`, 0 = zůstane ležet). Tělesa = tuhé skupiny ze zámků; hmotnost = objem dílů ×
hustota materiálu, těžiště a setrvačnost ze sítě (\`pohyb hmotnost "X" 2,4\` přepíše, \`auto\` vrátí). Integrace: rychlostní Verlet
s projekcí na vazby (RATTLE), pevný krok \`krok dt\` [s]; záznam ≤ 400 snímků (\`snímky N\`). S \`kolize\` se kolize kontrolují
jen v \`kroky\` rovnoměrně rozložených snímcích (+ poslední; výchozí 36 jako kinematika, \`pohyb kroky N\` zhustí) – souhrn
\`Kolize v pohybu: kroků s kolizí K z N\` (jen kroky se skutečnou kolizí) a \` kolize kontrolovány v N snímcích z 334 (každý 10. a poslední)\`, \`clash.steps=K/N\`;
mezi kontrolovanými snímky se kontroluje spojitě přes zaznamenané snímky (viz „Vůle a spojitá kontrola v pohybu“);
ostatní snímky \`pohyb krok\` / CSV označí „nekontrolováno“. Kinematická studie zůstává výchozí –
\`pohyb kinematika\` přepne zpět (nastavení dynamiky zůstane).

- \`pohyb dynamika čas 0,5 krok 0,0005 gravitace -Z tlumení 0,05 odraz 0,2\` – zapne a spočítá; \`gravitace vyp|+Y|0 0 -1\`.
- \`pohyb hmotnost "Stírací deska" 2,4\` · \`pohyb síla vazba 3 120\` [N] · \`pohyb moment vazba "Klika" 5\` [N·m] (kladná hodnota
  zvětšuje hodnotu vazby: vzdálenost / posuv / natočení A vůči B) · \`… smazat\`.
- Motor \`tam a zpět\` (EN \`there and back\`, DE \`hin und zurück\`): od → do → od sinusově (výstředníkový lis), i v kinematice.
- Protokol (navíc k souhrnu studie): \`Dynamika: 0,5 s · krok 0,5 ms · 1000 kroků · gravitace −Z · …\`, tělesa \` „Stírací deska“
  2,4 kg (zadaná): zdvih Z 15 mm · v max 0,19 m/s · a max … m/s²\`, \` Největší síla pružiny: „P“ 85,9 N v t = 0,238 s\`, dorazy
  \` doraz „Matrice …“ (min 0 mm): dotyk 0,125–0,375 s · nárazy 0,188 m/s (t = 0,125 s)\`, \`  návrat na doraz v t = 0,375 s\`,
  energie (bez motorů \`Kontrola energie: odchylka 0,01 % z 0,04 J (největší pohybová energie nebo práce sil; …)\` – vztaženo
  k největší kinetické energii, polohová energie tíže od výchozí polohy, takže výsledek nezávisí na umístění modelu; s motorem jen
  začátek / konec). \`v max\` a \`a max\` jsou ze všech integračních kroků, \`a max\` bez rázu na dorazu (náraz = skok rychlosti,
  hlásí řádek dorazu \`nárazy … m/s\`).
- Pružina bez tuhosti (\`sestava pružina "P" … \` bez \`tuhost\`, panel bez c) dostane v dynamice tuhost z geometrie dílu
  (\` pružina „P“: tuhost 4,974 N/mm z geometrie dílu (EN 13906-1 …)\`); díl bez drátu (trubka / válec) bez tuhosti ⚠ nepůsobí.
- Integrace RATTLE: polovina rázu s reakcemi vazeb, oprava polohy hmotnostně váženě ve směru reakce vazby (SHAKE) a stejná oprava
  do rychlosti – i natočení na čepu se zatížením mimo těžiště (kyvadlo, páka na pružinách, moment na Závěsu) drží energii (kyvadlo
  T/400: amplituda 8,7156 mm beze změny přes 10 kmitů) a poloha odpovídá rychlosti (moment 1 N·m: θ = τ·t²/(2·I) přesně).
- \`pohyb export csv\` přidá sloupce \`<těleso> těžiště Z [mm]; <těleso> vZ [mm/s]; <těleso> aZ [m/s²]\` (hlavní osa pohybu);
  \`window.mncad.motion({ mode: "dynamic", duration: 0.5, dt: 0.0005, gravity: "-Z", damping: 0.05, restitution: 0.2,
  masses: { "Stírací deska": 2.4 }, forces: [{ mate: 3, value: 120 }] })\` vrátí kroky s \`dyn: { "<těleso>": { p, v, a } }\` (mm, mm/s,
  mm/s²) a \`dynamic: { bodies, springMax, contacts: [{ label, bound, limit, intervals, impacts }], energy }\`. Panel: přepínač
  Kinematika / Dynamika, nastavení, hmotnosti, síly, graf (poloha, rychlost, zrychlení, síla pružin) s ukazatelem kroku.
- Stejně v aplikaci i v příkazové řádce (\`mncad run\`, HTTP): \`sestava pružina nová … do děr vzoru\`, \`pohyb dynamika | hmotnost | síla |
  moment\`, motor \`tam a zpět\` a \`pohyb stav\` běží v enginu; stručný protokol má strojový řádek studie
  \`= … motion … mode=dyn bodies=2 spring.max=107N@0.24s stops=2 return=0.375s [drift=…%]\`, \`pohyb export csv\` zapíše soubor se
  sloupci dynamiky a STEP sestavy obsahuje pružiny jako skutečná tělesa v aktuální délce. Jen v aplikaci zůstává panel s grafem,
  přehrání a snímky (\`pohyb přehrát\` ℹ \`ui.no-view\`, \`pohyb export png|webm\` ✗ \`host.app-only\`).
- Pohledy studie a video s pevným časováním (vlna 22): \`pohyb pohled uložit "Řez pružinami" řez Y 50 kamera přední\` uloží do studie
  pohled (kamera: pojmenovaný pohled, nebo \`směr dx dy dz cíl x y z výška H\`; řez osou, \`řez normála …\`, nebo \`bez řezu\`),
  \`pohyb pohled "Řez pružinami"\` ho zvolí pro přehrávání a export (v CLI ℹ \`ui.no-view\`, dokument si volbu pamatuje),
  \`pohyb pohledy\` vypíše uložené. \`pohyb video rychlost 0,25 fps 30\` (nebo \`délka 5\`, \`pohled "A" "B"\` = synchronní dlaždice,
  \`anotace vyp\`) uloží volby a vypíše plán \`video 2,6 s = 4 × délka studie 0,65 s · rychlost 0,25× · 30 fps · 78 snímků
  (tolerance ±1 snímek = ±0,033 s)\` se strojovým řádkem \`= … video seconds=2.6 study=0.65 fps=30 frames=78 speed=0.25 ratio=4\`.
  \`pohyb export webm|png [tytéž volby]\` exportuje snímky s časovou značkou i/fps (žádný záznam obrazovky): délka videa = délka
  studie / rychlost ± 1 snímek nezávisle na počtu kroků a rychlosti vykreslení; aplikace soubor zpětně přečte a obraz zkontroluje
  (✗ když se nemění, ⚠ část snímků). PNG bez voleb = snímek na každý vypočtený krok. Anotace (čas, krok, motory, vůle z kontroly
  vůle) jsou v okně i vypálené v obraze; \`pohyb anotace vyp\` je vypne. \`window.mncad.motion().video\` vrátí plán
  \`{ seconds, study, fps, frames, speed, ratio, tol, views, annot, text }\`.

Příklad 1 – střižník: horní deska se 4 kapsami Ø21 hl. 10 dolů 30 mm a zpět, stírací deska na 4 pružinách dosedne na matrici:

\`\`\`
nová sestava Střižník
vložit "Spodní deska" ukotvit
vložit "Stírací deska" v 0 0 45
vložit "Horní deska" v 0 0 85
sestava vazba vzdálenost "Horní deska" spodní "Spodní deska" horní hodnota 55 název "LIS"
sestava vazba mez-vzdálenosti "Stírací deska" horní "Horní deska" spodní min 5 max 25 název "Doraz stírače"
sestava vazba mez-vzdálenosti "Stírací deska" spodní "Spodní deska" horní min 0 max 500 název "Matrice"
sestava pružina nová mezi "Horní deska" Ø21 "Stírací deska" horní do děr vzoru
pohyb motor lineární vazba "LIS" 55..25 tam a zpět
pohyb hmotnost "Stírací deska" 2,4
pohyb dynamika čas 0,5 krok 0,0005 gravitace -Z tlumení 0,05 odraz 0,2
\`\`\`

Výsledek: 4 pružiny 2 × 19,5 × 41 (R 4,055 N/mm, Ln 19) v délce 35 mm; stírač dosedne na matrici v t = 0,125 s (LIS 40),
pružiny se stlačí na 20 mm (největší síla ≈ 85 N na pružinu), návrat na doraz v t = 0,375 s. Souhrn pružin hlásí ⚠ „pracovní
délka 20 mm je pod nejmenší přípustnou Ln + Sa = 22,22 mm … – závity se dotýkají“: předvyplněná pružina (n 7,5) na zdvih 15 mm
nestačí. Se \`sestava pružina nová n 6 mezi "Horní deska" Ø21 "Stírací deska" horní do děr vzoru\` (Ln 16, Ln + Sa 18,58 mm,
R 5,069 N/mm, 106 N na pružinu, τ 60 % dovoleného, τk 69 %) je souhrn ✓.

Příklad 2 – pérový kolík zaskočí do díry (bez motoru): pouzdro s vývrtem Ø8,2 (dno z = 5), kolík Ø8 × 30 zatlačený 14 mm nad dnem
(pružina stlačená na 14 mm), zdvih 13…24 mm:

\`\`\`
nová sestava Západka
vložit "Pouzdro" ukotvit
vložit "Kolík" v 15 15 19
sestava vazba souosost "Kolík" "Pouzdro"
sestava vazba mez-vzdálenosti "Kolík" spodní "Pouzdro" nejmenší +Z min 13 max 24 název "Zdvih"
sestava pružina nová d 0,8 De 7 L0 30 n 11 mezi "Pouzdro" nejmenší +Z "Kolík" spodní
pohyb dynamika čas 0,02 krok 0,00002 gravitace -Z
\`\`\`

Pružina 0,8 × 7 × 30, n 11 (SH): R = 81 500·0,8⁴ / (8·6,2³·11) = 1,592 N/mm, Ln = 13·0,8 = 10,4 mm, Ln + Sa = 12,07 mm < 14 mm,
při montáži 25,5 N a τ = 786 MPa = 68 % τzul (Rm 2 310; τk = 926 MPa = 80 %), na dorazu Ln τn 83 % (τkn 98 %) – bez ⚠. Výsledek: kolík 11,8 g vystřelí z délky
pružiny 14 mm na doraz 24 mm za 3,24 ms rychlostí ≈ 5,42 m/s (\` doraz „Zdvih Kolík → Pouzdro“ (max 24 mm): dotyk … · nárazy
5,42 m/s\`); analyticky L(t) = 30 − 16·cos(ω·t), ω = √(R/m) = 367 rad/s → 3,24 ms, energie ½·R·(16² − 6²) − m·g·10 mm = ½·m·v²
→ 5,42 m/s.

\`\`\`
nová sestava Klikový mechanismus
vložit "Rám" ukotvit
vložit "Klika"
vložit "Ojnice"
vložit "Píst"
sestava vazba závěs "Klika" Ø10 -Z "Rám" Ø10 +Z
sestava vazba souosost "Ojnice" F3 "Klika" Ø6
sestava vazba souosost "Ojnice" F4 "Píst" Ø6
sestava vazba zarovnat "Píst" +Y "Rám" F5
sestava vazba kontakt "Píst" -Z "Rám" +Z
pohyb motor rotační "Klika" 0..360 krok 5 kolize stopa "Ojnice" bod 30 0 0
pohyb krok 18
pohyb export csv
\`\`\`

\`\`\`
sestava vazba závěs "Kolo1" Ø10 "Rám" F1
sestava vazba závěs "Kolo2" Ø10 "Rám" F2
sestava vazba ozubení "Kolo1" "Kolo2" zuby 20 40
sestava vazba šroub "Matice" "Šroub" stoupání 1,5
sestava vazba vačka "Zdvihátko" -Y "Vačka" F3
pohyb motor rotační "Kolo1" 0..720 kroky 144
\`\`\`

### Spline s tečnami, hladké uzavřené šablonování a plochy třídy A

**Spline s tečnami** (v řádku skici): úhel tečny ve stupních od osy X skici, váha = velikost tečny (1 = přirozená,
větší = křivka se u bodu déle drží směru). Body se číslují od \`p0\`; tečna jde zadat u kteréhokoli bodu, „vyp“ ji zruší.
Křivka je přesně ta, kterou postaví jádro (interpolace s tečnými podmínkami) – ve skicáři je u bodu úchyt tečny
(kroužek, tažením se mění úhel i váha) a panel s úhly a vahami u vybraného splinu.

\`\`\`
skica XZ: spline 0 0 50 20 100 0 tečna-začátek 30 tečna-konec -30
spline 0 0 40 30 80 0 120 20 tečna p1 0 váha p1 1,5        # tečna ve vnitřním bodě p1
entita e1 tečna-konec=-45 váha-konec=2 tečna-p1=vyp        # úprava existujícího splinu (skica "Skica 1")
\`\`\`
EN: \`tangent-start 30\`, \`tangent-end -30\`, \`tangent p1 0\`, \`weight-start 1.5\`, \`weight p1 2\`; DE: \`tangente-anfang\`,
\`tangente-ende\`, \`tangente p1\`, \`gewicht-anfang\`, \`gewicht p1\`. Ve stavu: \`e1 spline 3 b. … tečny p0 30°, p2 −30°\`.

**Hladké uzavřené šablonování** (Uzavřený hladce): profily tvoří uzavřenou smyčku a plocha je periodická přes všechny
profily – bez hrany ve švu (C2). Profily se prokládají hladce, ostré rohy profilů se zaoblí (odchylku ohlásí ⚠).

\`\`\`
prvek loft sketchIds=["Skica 1","Skica 2","Skica 3","Skica 4"] closed=ano smooth=ano
\`\`\`

**Plochy třídy A** (karta Plochy, skupina „Plochy třídy A“). Hrany a plochy se zadávají čísly \`E3\` / \`F3\` jako
popisky pro výběr (\`window.mncad.hints()\`). Plochy se přidají jako volné plochy (sešít = jedna skořepina s okolím).

| Příkaz | Význam |
| --- | --- |
| \`výplň E3 E4 E5 [G0\|G1\|G2] [sešít]\` | N-stranná výplň otvoru, návaznost na plochy, kterým hrany patří (výchozí G1) |
| \`přechod E3 E7 [G1\|G2] [G1\|G2] [napětí 1 1,5] [obrátit] [sešít]\` | přechodová plocha mezi dvěma hranami ploch; napětí = délka tečny (1 = přirozená); „obrátit“ = opačný směr 2. hrany |
| \`prodloužit plochu E5 [E6 …] 10 [G1\|G2]\` | plocha pokračuje přes hranu: G1 tečně (rovně), G2 i s křivostí; sešije se s původní plochou |
| \`plocha F3 cv\` | seznam řídicích bodů (CV) B-spline plochy: \`[u v] (x; y; z)\` |
| \`plocha F3 cv [síť 4 4] 2 3 posun 0 0 1,5\` | posun CV [u=2, v=3] o vektor; „síť“ = přesné zjemnění (stupeň 3, vložení uzlů) |
| \`plocha F3 cv řada u 2 posun 0 0 1\` | posun celé řady CV (u nebo v, od 1); více posunů lze psát za sebou v jednom řádku |
| \`analýza návaznosti [E3 E5 …] [zobrazit]\` | G0 mezera (mm), G1 úhel normál (°), G2 rozdíl křivostí napříč hranou (1/mm) a třída; bez hran všechny |
| \`analýza hřebenu [E3 …] [měřítko 50] [zobrazit]\` | hřebeny křivosti hran: křivost min/max, nejmenší poloměr; „zobrazit“ = hřebeny v 3D okně |

EN: \`fill\`, \`blend … tension\`, \`extend surface\`, \`face F3 cv 2 3 move 0 0 1.5\`, \`face F3 cv row u 2 move …\`,
\`grid 4 4\`, \`analyze continuity\`, \`analyze comb … scale 50 show\`; DE: \`füllen\`, \`übergang … spannung\`,
\`verlängern fläche\`, \`fläche F3 cv 2 3 verschieben …\`, \`reihe\`, \`netz\`, \`analyse stetigkeit\`, \`analyse kamm\`.
Obecně: \`prvek surf.fill edges=2;3;4 continuity=G2\`, \`prvek surf.blend edges=2;6 contA=G2 tensionA=1,2\`,
\`prvek surf.extendEdge edges=4 length=10 continuity=G1\`, \`prvek surf.cv faces=2 gridU=4 gridV=4 moves=[{"i":2,"j":3,"d":[0,0,1.5]}]\`
(v obecném příkazu \`prvek\` a v JSON jsou hrany / plochy indexy od 0 – E3 = 2, F3 = 2; řídicí body [i j] jsou od 1).

Třídy návaznosti: **G2** = mezera ≤ 0,01 mm, úhel ≤ 0,1° a rozdíl křivostí ≤ 5 % (min. 0,0001 1/mm), **G1** = tečně,
**G0** = jen dotyk (ostrá hrana), **mezera**, **volná hrana** (bez sousední plochy). Nesešité plochy se párují podle
polohy hran (\`nesešité\` v protokolu). Ukázka protokolu:

\`\`\`
✓ návaznost 2 hran: G2 2 · G1 0 · G0 0 · mezera 0 · volné 0
  E9 (F1|F3, nesešité): G2 · mezera 0 mm · úhel 0,002° · Δk 0,00004 1/mm (k 0,02 / 0,02)
\`\`\`

Co je přesné a co přibližné: výplň je operátor jádra (dosažená tečnost se ověří, nad 0,1° ⚠); přechod a prodloužení
jsou Hermitovy pásy proložené B-spline – návaznost je přesná ve vzorkovacích bodech (33 podél hrany) a mezi nimi se
ověřuje analýzou; CV úprava je přesná u B-spline ploch, jiné plochy se převedou prokladem (rovina přesně) a ořezaná
plocha se vrátí v celém rozsahu parametrů (⚠).

### Průběh a zrušení výpočtu

Během delšího výpočtu ukazuje program u spodního okraje „Počítám prvek k/n: název · čas“ s tlačítkem **Zrušit**; totéž
vrací \`window.mncad.progress()\` a \`window.mncad.cancel()\`. Zrušený běh konzole dokument nezmění. Po výpočtu je
v protokolu u delších prvků čas (\`✓ Pole 1 (pattern) · 7,9 s\`) a celkový čas. Jádro si pamatuje stav po prvcích:
další příkaz přidaný na konec historie přepočítá jen nový prvek.

**Běhy mají id a stav (vlna 22).** Každý běh textových příkazů (konzole, \`window.mncad.run\`, \`mncad run\`, \`POST /run\`)
a každý export je běh s **id** (\`r12\`, serve \`j3\`) a **revizí vstupu** (\`<klíč dokumentu>@r·a1b2c3\`); stavy
**čeká → počítá → dokončeno | zrušeno | chyba** (\`queued | running | done | cancelled | error\`). Běhy se řadí do jedné
fronty – druhý \`run\` počká na první, nikdy neběží souběžně. Id je v JSON (\`run: { id, inputRev, state }\`), v HTTP
hlavičce \`x-mncad-run\` a na konci řádku Σ (\`… run=r12\`); hlavička \`MNCAD/1 …\` se nemění. Konzole ukazuje „Běh r12:
počítá“, během běhu místo protokolu „Probíhá běh r12…“ a předchozí protokol jen sbalený jako **Předchozí běh r11** – starý
protokol se nikdy nečte jako výsledek nového běhu (atributy \`data-run-id\`, \`data-run-state\` u výstupu); tlačítko
**Zrušit běh** (i po zavření a novém otevření konzole). Zrušený čekající běh se neprovede vůbec, běžící skončí
✗ \`run.cancelled\` před dalším řádkem; zapsal-li běh před zrušením jiný dokument (přechod \`nový díl\` / \`záložka\`), dokumenty, které
založil, se zahodí a dokumenty zapsané do dřívějších záložek vyjmenuje ✗ \`run.cancelled-partial\` (nikdy „beze změny“). Pozdní výsledek staršího výpočtu (stavba modelu, přepočet vazeb, kontrola kolizí,
měření, pokyny pohybové studie z běhu) nikdy nepřepíše novější – pokyny \`pohyb přehrát\` se panelu doručí až po zápisu
dokumentu běhu.

**Uložit, export a sdílet pracují s dokončeným stavem:** nejdřív se zapíše rozepsané pole (napsaná hodnota bez opuštění pole)
a rozepsaný list výkresu, pak se počká na běhy a stavbu modelu (u spodního okraje „Čekám na dokončení výpočtu…“ se
**Zrušit**). Soubor .mncad nese \`modelRev\` (\`r·a1b2c3\`, revize modelu, ze které vznikl), řádek F exportu \`rev=r·a1b2c3\`.

**Export je úloha s fázemi:** přestavba modelu → převod (STEP…) → **kontrola zpětným načtením** (STEP / BREP, stejná jako
textové \`export step\` – i export z menu) → zápis souboru. Seznam **Exporty** vpravo dole drží stav, fázi, čas, soubor,
velikost, kontrolu a revizi modelu i po konci (\`data-export-job\`, \`data-export-state\`); úlohu jde zrušit – soubor, který
už založil dialog „Uložit jako“, se odstraní. \`window.mncad.exportFile\` vrací \`{ …, modelRev, check, job }\`, průběh
ukazuje \`window.mncad.exports()\`. CLI \`--progress\` vypisuje fáze jménem (\`  export:step: převod do STEP\`,
\`  build: síť modelu\`; „přestavba modelu“ před řádky \`build i/n\`). Zásah hlídače (✗ \`run.timeout\` / \`run.memory\` /
\`run.cancelled\`) nese poslední fázi a průběh: „časový limit 10 s vypršel (ve fázi: přestavba modelu, 2/2)“, \`data.phase\`
(model | convert | verify | write), \`data.progress\` (\`build 2/2 …\`). Soubor STEP nese revizi v hlavičce (\`FILE_DESCRIPTION(('Open CASCADE Model','MNCAD model revision
r\\X\\B7a1b2c3'),…)\`). Záznam exportu v dokumentu (\`exporty\`, panel Výstupy) nese úlohu – stav, čas \`⏱ 0,4 s\`, fáze a
kontrolu (\`kontrola ✓\` jen s provedenou kontrolou) – a revizi EXPORTOVANÉHO modelu: změní-li se model během exportu,
záznam je hned zastaralý. Selhání převodu řekne fázi, zprávu jádra a stav modelu (těleso, prvky s chybou).

### Plech – tvářecí nástroje a křížový zlom (\`plech …\`, EN \`sheet …\`, DE \`blech …\`)

Tvářecí nástroj se umisťuje na **rovinnou plochu plechu** (bez \`plocha …\` = horní plocha základního plechu; za
křížovým zlomem ploška, na které leží první bod) do jednoho nebo více bodů. Tvarovaná oblast je **skořepina tloušťky
plechu** (vnitřní poloměr R, vnější R + t; \`poloměr 0\` = automaticky poloměr plechu, zmenšený, aby se vešel) vytlačená
\`nahoru\` (od plochy, výchozí) nebo \`dolů\`. Kde nástroj materiál prostřihne (žaluzie, výstřih, můstek, vodítko, lem
díry), je plech skutečně otevřený (štěrbina 0,1·t, min. 0,1 mm). Body \`v x y\` jsou souřadnice v rovině plochy (u
vodorovné plochy x, y; u plochy kolmé na Y x, z; kolmé na X y, z), \`v x y z\` = bod v prostoru promítnutý na plochu;
více bodů \`v 0 0 v 30 0\` nebo \`v 0 0; 30 0\`. Natočení (\`natočení 90\`) je kolem normály plochy od osy X (u ploch
kolmých na X od osy Y). Nástroj musí ležet celý na rovné ploše (ne přes okraj, otvor, ohyb ani jiný nástroj) – jinak ✗
s důvodem. Rozvin tvářené nástroje **nerozvíjí** (jako SolidWorks): \`akce sheet.dxf\` / \`sheet.svg\` je kreslí ve vrstvě
**FORM** (obrys tvarované oblasti, štěrbiny, středová značka, popis T1, T2…; u lemu díry orientační předděr) a \`akce
tabulka ohybů\` je vypíše v oddílu „Tvarování“.

| Nástroj (CS / EN / DE) | Čísla za názvem | Klíčová slova |
|---|---|---|
| \`žaluzie\` / \`louvre\` / \`kieme\` | délka šířka výška | \`vlevo\` / \`vpravo\` = otevřená strana (vlevo od osy natočení) |
| \`prolis\` / \`dimple\` / \`napf\` | průměr hloubka [úhel stěny] | \`úhel 60\` (od roviny plechu, 90 = svisle), \`ostrý\` |
| \`žebro\` / \`bead\` / \`sicke\` | šířka výška [úhel stěny] | \`skica "Dráha"\` (úsečky, lomené čáry, oblouky, kružnice; bez = poslední skica; automaticky uzavřená čára je tu otevřená, uzavřenou dráhu napište s \`uzavřít\`) |
| \`výstřih\` / \`lance\` / \`lasche\` | délka šířka výška [úhel náběhu] | otevřený konec ve směru +X natočení |
| \`můstek\` / \`bridge\` / \`brücke\` | délka šířka výška [úhel náběhu] | boky prostřižené, konce spojené |
| \`lem díry\` / \`collar\` / \`durchzug\` | průměr díry výška límce | límec od plochy plechu |
| \`vodítko\` / \`card guide\` / \`kartenführung\` | délka šířka mezera [úhel] | \`mezera 1,6\` = mezera pro desku pod můstkem |
| \`křížový zlom\` / \`cross break\` / \`kreuzbruch\` | [úhel] | \`F3\` panel, \`úhel 1,5\`, \`nahoru\` / \`dolů\` |

\`\`\`
nový díl Kryt
skica XY: obdélník 120 80
prvek sheet.base sketchId=$last t=1,5 r=1
plech tvarování žaluzie 40 8 4 v -30 0 v 0 0 v 30 0 natočení 90   # tři žaluzie, délka podél Y, otevřené k −X
plech prolis 12 2 v 45 -15 v 45 15                               # dva prolisy Ø12 hloubky 2
plech lem díry 8 3 v -45 -25 dolů                                # protažený otvor s límcem dolů
skica XY odsazení 1,5: úsečka -50 30 50 30
plech žebro 6 2 skica $last                                      # žebro podél úsečky na horní ploše
plech křížový zlom úhel 1,5                                      # horní plocha základu, vyklenutí nahoru
stav
akce sheet.dxf
\`\`\`

- Zlom a nástroje: křížový zlom zadaný **po** nástrojích je obejde (nástroje zůstanou v rovině panelu); nástroje zadané
  **po** zlomu se položí na plošku zlomu, na které leží bod.
- \`stav\` vypíše u nástroje např. \`žaluzie 40 × 8 × 4 mm, otevřená vlevo · nahoru · horní plocha základu · 3 b.: [-30; 0] …\`.
- Obecný příkaz: \`prvek sheet.louvre points=[[0,0],[30,0]] length=40 width=8 height=4 rotation=90 open=right\`,
  \`prvek sheet.dimple points=10;20 diameter=12 height=2 wallAngle=45 rounded=ne\`, \`prvek sheet.bead sketchId=$last width=6\`,
  \`prvek sheet.crossbreak face=3 angle=2 direction=down\` (\`face\` = index plochy od 0, F3 = 2), úpravy \`upravit "Žaluzie 1" points=[[0,0]]\`.
- Výkres: úhlopříčky křížového zlomu jsou hrany modelu (kreslí se v pohledech), poznámka \`KŘÍŽOVÝ ZLOM 1,5° nahoru\` se doplní
  do patičky nad razítkem. Ohraňování a tváření nástroji pro výrobu (lis, nástroj) zůstává na technologovi – model je
  geometricky přesná skořepina, tenčení materiálu se nemodeluje.

### Svary – koutové, tupé s úpravou, děrové, bodové (\`svar …\`, EN \`weld …\`, DE \`schweißnaht …\` / \`naht …\`)

Svary jsou prvky karty Svařence. Každý svar vytvoří **svarový kov jako samostatné těleso** „Svar 1“, „Svar 2“… (obarvené
jako svar; u housenky volba \`sloučit\` = připojit k dílu jako dřív) a do stavu prvku zapíše výsledek: délku, průřez, objem,
**hmotnost svarového kovu** (hustota materiálu dílu, jinak 7,85 g/cm³) a **odhad přídavného materiálu** = hmotnost / účinnost
navaření (135 MAG / 131 MIG 0,9; 111 obalená elektroda 0,6; 136 0,85; 141 TIG 0,98; 121 0,99; \`účinnost 0,8\` přepíše).
\`stav\` vypíše výsledek pod prvkem (\`→ tupý V s10 · délka 200 mm · průřez 74,56 mm² · … · svarový kov 0,117 kg …\`),
\`svar tabulka\` (= \`akce tabulka svarů\`) vypíše tabulku všech svarů se součty. Kusovník řezů svary nemění.

**Spoj se zadává** (indexy = popisky F1 / E1 zobrazeného modelu přes všechna tělesa, aktivní těleso první –
\`window.mncad.hints()\`; nebo pravidlem jako u zaoblení na aktivním tělese; nebo **bodem** \`hrana u x y z\` / \`plocha u x y z\`
= nejbližší hrana / plocha do 1 mm – nejspolehlivější pro agenty):
- tupý svar – **plocha** = čelo připravovaného dílu, které se dotýká druhého dílu (konec plechu u druhého plechu, spodní čelo
  stojiny na pásnici); **hrana** = hrana tohoto čela na straně svaru (strana šipky; spodní hrana = svar zespodu), nebo
  **vnitřní kout** sloučeného tělesa (T / rohový spoj, připravuje se svislá stěna, \`obráceně\` = druhá stěna; tloušťka stěny
  se změří, \`t 10\` ji zadá). Mezera v modelu se pozná (do 15 mm); větší než zadaná se použije skutečná. Druh spoje (tupý /
  T / rohový) se pozná z polohy druhého dílu.
- koutový svar – hrana koutu: vnitřní hrana sloučeného tělesa, nebo hrana dílu, který stojí na jiném tělese (spodní hrana
  stojiny); \`oboustranně\` = i kout na druhé straně stěny, \`kolem\` = celá uzavřená smyčka (profil / trubka na desce, rovné
  hrany i oblouky, rohy se vyplní).
- děrový, žlábkový a bodový svar – horní plocha horního plechu přeplátování; řada \`počet\` × \`rozteč\` vystředěná podél delší
  (\`kratší\`) strany plochy, \`posun N\`.

| Úprava ISO 9692-1 | Slovo | Výchozí (úhel / otupení c / mezera b / R) | Průřez drážky (bez převýšení) |
|---|---|---|---|
| I | \`I\` | – / 0 / 2 | b·t |
| V | \`V\` | α 60° / 1 / 2 | b·t + (t−c)²·tg(α/2) |
| Y (V s velkým otupením) | \`Y\` | α 60° / 3 / 1 | jako V |
| X (oboustranný V) | \`X\`, \`2V\` | α 60° / 2 / 2 | b·t + 2·h²·tg(α/2), h = (t−c)/2 |
| U / 2U | \`U\`, \`2U\` | β 10° / 2 / 0 / R 6 | b·t + 2·U(t−c) / b·t + 4·U(h) |
| ½V (HV) / ½Y (HY) | \`½V\`, \`1/2V\`, \`HV\` / \`½Y\`, \`HY\` | β 45° / 1 (3) / 2 (1) | b·t + (t−c)²·tg β / 2 |
| K (oboustranný ½V) | \`K\` | β 45° / 2 / 2 | b·t + h²·tg β |
| J / 2J | \`J\`, \`2J\` | β 10° / 2 / 0 / R 6 | b·t + U(t−c) / b·t + 2·U(h) |

U(H) = R²/2·(π/2 − β − sin β cos β) + R cos β·H′ + H′² tg β / 2, H′ = H − R(1 − sin β). Úhel za úpravou (\`V 60\`, \`½V 45\`)
je u V / Y / X celkový úhel rozevření α, u ostatních úhel úkosu / boku β. Převýšení housenky \`převýšení 1,5\` (výchozí 1,5 mm,
přesah 1 mm přes hrany úkosu; u X / K / 2U / 2J na obou stranách), převýšení kořene \`kořen 1\` (jen s mezerou),
\`podložka\` = těleso „Podložka k“ 25 × 5 mm pod kořenem (jen tupý spoj). Souměrné úpravy (I, V, Y, X, U, 2U) se vyříznou do
obou dílů, jednostranné (½V, ½Y, K, J, 2J) jen do vybraného dílu.

\`\`\`
nový díl Tupý spoj
kvádr 100 200 10 v -100 0 0                       # deska A (Těleso 1)
kvádr 100 200 10 v 2 0 0 nové                     # deska B (Těleso 2), mezera 2 mm
těleso 1
svar tupý V 60 otupení 1 mezera 2 plocha +X       # čelo desky A u desky B → V do obou desek, Svar 1
svar tabulka
\`\`\`

\`\`\`
nový díl T spoj
kvádr 200 100 12 v -100 0 0                       # pásnice
kvádr 10 100 80 v -5 0 12                         # stojina (sloučí se)
svar koutový a5 hrana u 5 50 12 oboustranně metoda 135   # a5 z obou stran stojiny = 2 × 25 mm² × 100 mm
svar ½V 45 otupení 1 mezera 0 hrana u -5 50 12 převýšení 1   # nebo úkos do stojiny (vnitřní kout)
stav
\`\`\`

\`\`\`
svar koutový z7 hrany E12;E14 přerušovaný 50/100           # rameno 7 (a ≈ 4,95), úseky 50 po 100
svar koutový a4 hrana u 20 0 10 kolem                       # kolem profilu na desce
svar X 60 otupení 2 mezera 2 plocha F7                     # oboustranný V, housenka z obou stran
svar U R6 úhel 10 otupení 2 plocha F7
svar děrový Ø12 počet 3 rozteč 50 plocha u 150 50 18
svar žlábkový 30×10 počet 2 rozteč 60 plocha F9
svar bodový Ø6 rozteč 40 počet 5 plocha F9 metoda 21
\`\`\`

- EN: \`weld fillet a5 edges E7;E9 both sides all around intermittent 50/100 field process 135\`, \`weld butt V 60 root face 1
  gap 2 edge E7 backing\`, \`weld HV 45 face F3\`, \`weld plug Ø12 count 2 pitch 60 face F3\`, \`weld spot Ø6 pitch 40 face F3\`,
  \`weld table\`. DE: \`schweißnaht kehlnaht a5 kanten E7 beidseitig ringsum unterbrochen 50/100 baustelle\`, \`naht stumpf V 60
  steg 1 spalt 2 kante E7 badsicherung\`, \`naht lochnaht Ø12 …\`, \`naht punkt Ø6 teilung 40 …\`, \`naht tabelle\`.
- Obecný příkaz: \`prvek weld.groove prep=K faces=2 angle=45 rootFace=2 gap=2 cap=1 process=135\`, \`prvek weld.groove
  prep=HV edgeAt=[[5,50,12]]\`, \`prvek weld.bead edges=6;8 a=5 measure=a both=ano\`, \`prvek weld.plug faces=8 d=12 n=3
  pitch=50\`, \`prvek weld.spot faceAt=[[100,50,18]] d=6 n=5 pitch=40\` (indexy od 0: F3 = 2). Klíče tupého svaru: \`prep\`,
  \`angle\`, \`rootFace\`, \`gap\`, \`radius\`, \`cap\`, \`root\`, \`backing\`, \`t\`, \`flip\`, \`field\`, \`process\`, \`eff\`.
- Výkres: z každého svaru se automaticky nakreslí **značka ISO 2553** (šipka ke spoji v pohledu podél spoje, referenční
  čára s čárkovanou identifikační čarou, značka druhu, velikost a / z / s / Ø, délka × počet (rozteč), oboustranný,
  kolem, montážní, \`M\` podložka, metoda ve vidličce) – v SVG, DXF, DWG i PDF. Ruční „Značka svaru“ s hranou se umístí
  stejně, bez hrany se vypíše do seznamu „Svary:“ vlevo dole.
- Omezení: tupý svar s úpravou jen po **rovné** spáře (čelo musí mít rovnou hranu), šikmý T spoj (≠ 90°) jen koutovým
  svarem; koutová housenka po rovných hranách a obloucích (ne po obecné křivce); bodové svary jsou značky (tenké
  terčíky Ø d na ploše, bez hmotnosti), čočka svaru uvnitř plechů se nemodeluje.

### Pružiny z tabulky – tlačná, tažná, zkrutná, talířová (\`pružina …\`, EN \`spring …\`, DE \`feder …\`)

Jeden řádek = jeden prvek historie \`spring.compression\` | \`spring.extension\` | \`spring.torsion\` | \`spring.disc\` se **stejnou
tabulkou** jako průvodce Tvorba › Pružina (Ctrl+K „Pružina“, knihovna Pružiny): zadáte pár řádků, zbytek se dopočítá a vypíše.
Značky jsou citlivé na velikost písmen (\`d\` drát ≠ \`D\` střední průměr); stačí jeden z průměrů \`D | De | Di\` a jeden z \`n | nt\`,
místo délky \`L1 / L2\` lze sílu \`F1 / F2\` (poslední zadaná alternativa platí).

- **Tlačná (EN 13906-1)**: \`pružina tlačná d 2 De 20 L0 50 n 8 [konce broušené|přiložené|otevřené] [materiál SH|DH|VDSiCr|1.4310]
  [L1 40] [L2 30] [uložení 0,5|0,7|1|2] [levé]\`. Spočte tuhost R = G·d⁴/(8·D³·n), nt, Ln (broušené nt·d), nejmenší součet mezer Sa,
  síly při L1 / L2 / Ln, napětí τ2 a τn proti τzul = 0,5·Rm(d) (statická kontrola EN 13906-1 bez korekce), korekci k
  (Bergsträsser) a τk2 = k·τ2 (nad τzul přísnější ⚠ pro opakované zatížení – „staticky vyhoví“), vzpěr (uložení ν), vlastní frekvenci,
  hmotnost a délku drátu. Tvar: přiložené závěrné závity s plynulým přechodem, **broušené konce = rovinné plochy kolmé na osu
  v 0 a L0**, Ø tělesa = De – díl tedy měří jako skutečná pružina (\`měřit těleso\`).
- **Tažná (EN 13906-2)**: \`pružina tažná d 1,6 De 12 n 12 F0 5 [očka německé|poloviční|boční] [očko2 …] [natočení 90] [L2 50]\` –
  vnitřní okraje oček v 0 a L0 = Lk + LH1 + LH2 (německé očko LH = Di); síla F = F0 + R·(L − L0); největší délka Ln (τk = 0,45·Rm).
- **Zkrutná (EN 13906-3)**: \`pružina zkrutná d 2 De 20 n 6,25 [ramena tečná|radiální|osová] [ramena 25] [rameno1 … l1 …] [a2 60 | M2 450]\`
  – úhlová tuhost RM = E·d⁴/(3667·D·nef) [N·mm/°], napětí σq proti 0,7·Rm, vnitřní průměr při natočení (trn ≤ 0,9 ×).
- **Talířová (DIN 2093)**: \`pružina talířová řada A|B|C De 40 [sloupec 4 2] [L2 19,2]\` (\`řada vlastní De … Di … t … h0 …\`) – sloupec
  4 talíře za sebou × 2 v sobě, síla podle Almena–László, varování nad 75 % h0.
- **Umístění** (všechny druhy): \`v x y z\`, \`osa X|Y|Z|-Z\` nebo vektor \`osa 0 0 -1\`, \`tvar 35\` = tvar stlačené tlačné pružiny
  (stoupání činných závitů se zmenší, výpočet zůstává pro L0), \`přidat|odebrat|průnik|nové\`, \`název "…"\`.
- **Výsledek**: protokol vypíše souhrn a varování česky (\`⚠ při stlačení na L2 je napětí 112 % dovoleného\`, \`⚠ pružina se vybočí –
  použijte trn nebo vedení\`); stejná varování má prvek ve stromu (⚠) a \`stav\`. Chyba zadání (L0 pod Ln, L2 pod dorazem, chybí
  drát…) je ✗ u řádku. \`pružina tabulka\` vypíše spočtené řádky poslední pružiny dílu (\`pružina tabulka "Název"\` pojmenované,
  \`pružina tabulka vše\` všech), \`pružina nápověda [druh]\` řádky
  tabulky se slovy CS / EN / DE. Na výkrese \`výkres tabulka pružiny ano\` přidá k razítku tabulku údajů podle EN ISO 2162-2.
- Starý zápis \`pružina D stoupání P závity N drát d\` (stálé stoupání, otevřené konce) zůstává pro obecné šroubovice.

### Příklad – stírací pružiny střižného nástroje (tlačná, broušené konce)

\`\`\`
nový díl Stírací pružina
pružina tlačná d 2,5 De 20 L0 45 n 7 konce broušené materiál DH L1 40 L2 33
pružina tabulka
měřit těleso
\`\`\`

Protokol: \`tlačná d 2,5 · De 20 · L0 45 · n 7 · R 10,608 N/mm · Ln 22,5 mm · F2 127,3 N\`; \`pružina tabulka\` vypíše mimo jiné
\`nejmenší pracovní délka Ln + Sa: 25,54 mm\`, \`napětí τ2 při L2 (statická kontrola): 363 MPa (39 %)\`,
\`napětí τk2 = k · τ2 (opakované zatížení): 436 MPa (46 %)\` a \`kritický zdvih vzpěru sK: nevybočí\`.
\`měřit těleso\` ukáže obálku 20 × 20 × 45 mm (Ø = De, délka = L0). Při L2 pod Ln + Sa nebo napětí nad τzul přijde ⚠ s konkrétním
číslem – zvětšete L0, přidejte závity nebo silnější drát. Do sestavy: \`nová sestava\`, \`vložit "Stírací pružina"\` a
\`sestava pružina "Stírací pružina" mezi "Deska" "Stírač"\` – volná délka L0, délka na doraz Ln a tuhost R se u tlačné pružiny
z tabulky převezmou bez zadání (\`volná / blok / tuhost\` je přepíší); tažná, zkrutná a talířová pružina z tabulky zůstává v sestavě
dílem bez délky a síly (\`sestava pružina\` to ohlásí).

### Příklad – tažná pružina upínky a sloupec talířových pružin

\`\`\`
nový díl Upínka – pružiny
pružina tažná d 1,6 De 12 n 12,5 F0 5 očka německé L2 50 název "Tažná"
pružina talířová řada A De 40 sloupec 4 1 L2 11,4 v 60 0 0 název "Talíře"
pružina tabulka "Talíře"
\`\`\`

Tažná: natočení oček 180° (n = 12,5), L0 = Lk + 2·Di = 21,6 + 2 · 8,8 = 39,2 mm, při 50 mm F2 = F0 + R·(50 − 39,2) = 56,3 N.
Talíře A 40: L0 = 4·(h0 + t) = 12,6 mm, při 11,4 mm zdvih talíře 0,3 mm (33 % h0) a síla 3069 N; \`L2 19\` (víc než L0) by byl
✗ „délka L2 19 mm je větší než volná výška sloupce L0 12,6 mm“.

### Kola a ozubení – \`kolo …\`, \`soukolí …\` (EN \`gear …\` / \`gearpair …\`, DE \`rad …\` / \`radpaar …\`)

Každé kolo je **jeden prvek historie** „Ozubené kolo m2 z24“ (rozšíření \`gear.<druh>\`), jehož data jsou **jedna tabulka** –
stejná jako v průvodci „Kola a ozubení“ a ve formuláři úprav (změna z nebo m → model se přestaví). Text čte slova řádků
tabulky; co nezadáte, má rozumnou výchozí hodnotu (protokol napíše, které povinné řádky zůstaly výchozí). Popis všech řádků
druhu (slovo, jednotka, výchozí hodnota, rozsah, norma) vypíše \`kolo nápověda <druh>\`, přehled druhů \`kolo nápověda\`.

| Druh (\`kolo <druh>\`) | Prvek | Povinné řádky (výchozí) | Norma |
|---|---|---|---|
| \`čelní\` (přímé zuby) · \`šikmé\` (\`beta 15 pravé|levé\`) · \`šípové\` (\`drážka 6\`) | gear.spur / helical / herringbone | \`m 2 z 24 b 20\` | ISO 53, ISO 54, ISO 21771, DIN 3960 |
| \`vnitřní\` (věnec) | gear.internal | \`m 2 z 60 věnec 0\` (0 = auto) | ISO 21771 |
| \`hřeben\` (lineární ozubení, i šikmý \`beta\`) | gear.rack | \`m 2 z 40 h 20\` (h = výška celkem) | ISO 53 |
| \`kuželové\` (\`beta 35\` = zakřivené zuby) · \`hypoidní\` (\`pastorek|talíř\`, \`z1 z2 de2 e\`) | gear.bevel / hypoid | \`m 2 z 20 protikolo 20\` · \`z1 11 z2 41 de2 200 e 25\` | ISO 23509 |
| \`šnek\` (ZA) · \`šnekové\` (kolo) | gear.worm / wormwheel | \`m 2 q 10 l 0\` · \`m 2 z 30 q 10\` | DIN 3975 |
| \`cykloidní\` (hodinové kolo / \`pastorek\` s lístky) · \`cyklodisk\` (kotouč reduktoru / \`věnec\` s čepy) | gear.cycloid / cyclodisc | \`m 1 z 30 protikolo 8\` · \`n 10 dp 60 čep 6 e 1,5\` | BS 978-2 |
| \`řetězové\` (\`08B\`, \`10B\` … \`24B\`, ANSI \`40\` … \`80\`) | gear.sprocket | \`08B z 19\`, \`řady 1–3\` | ISO 606 |
| \`řemenice\` (HTD \`3M\`…\`14M\`, \`T5\`, \`T10\`) · \`rohatka\` | gear.pulley / ratchet | \`5M z 32\` · \`z 24 da 60\` | ISO 13050, DIN 7721 |

**Zápis:** \`slovo hodnota\` (\`m 2\`, \`z 24\`, \`úhel 20\`, \`x 0,2\`), zkráceně \`m2 z24 b20\` i \`m=2 z=24\`, desetinná čárka i tečka,
\`°\` a \`mm\` za číslem nevadí. Složené zápisy těla kola: \`díra 20 [pero]\` (drážka DIN 6885-1), \`náboj 40 15 [obě strany|dole]\`
(řetězové kolo typ \`B\` / \`C\`), \`díry 6 12 [80]\` (odlehčovací: počet, Ø, roztečná Ø), \`stojina 6\`, \`sražení 0,5\`, \`šroub M5\`.
Výstup: \`polotovar\` = jen soustružené tělo Ø dₐ × b s nábojem a dírou (bez zubů), \`zuby\` = zubové mezery vyříznuté do
aktivního tělesa (operace Odebrat). Operace: v dílu, který už těleso má, vznikne kolo jako **nové těleso**; \`přidat\` = sloučit
s aktivním tělesem. Poloha \`v x y z\`, osa \`osa X|Y|Z|x y z\`, natočení zubů \`natočení 7,5\`, název \`název "Pastorek"\`.

**Soukolí** \`soukolí <druh> …\` (druhy čelní, šikmé, šípové, vnitřní, hřeben, kuželové, hypoidní, šnek, cykloidní, cyklodisk,
řetězové, řemenice) založí **dva díly s koly, novou sestavu, vloží obě kola ve správném záběru a spojí je vazbou ozubení**
(hřeben: vazba hřeben) – stejnými existujícími příkazy, jaké vypíše průvodce (\`nový díl\`, \`prvek gear.*\`, \`nová sestava\`,
\`vložit\`, \`sestava vazba ozubení\`). Zadaná osová vzdálenost \`a\` → součet posunutí Σx se dopočítá a rozdělí podle DIN 3992
(\`x1\`, \`x2\` přepíšou, \`auto ne\` vypne dělení), hlava se zkrátí na hlavovou vůli 0,25·m; \`vůle\` = celková boční vůle
(výchozí 0,04·m), \`díra1\` / \`díra2\` (výchozí asi čtvrtina roztečného průměru). Protokol vypíše převod, a_w, α_w, Σx, x1/x2,
ε_α, ε_β a varování (podřezání, špičatý zub, interference, malé ε_α). Sestava nemá rám – kola jsou volná, drží je jen vazba
ozubení; pro pohybovou studii vložte rám a vazby závěs (příklad 2).

**Tabulka ozubení:** \`kolo tabulka\` vypíše tabulku posledního kola aktivního dílu (\`vše\` = všech kol, \`"název"\` = jednoho):
modul, z, základní profil, α, β a smysl, x, průměry d / dₐ / d_f / d_b, výšku zubu, tloušťku zubu, rozměr přes zuby W_k (k),
rozměr přes kuličky M_dK (D_M), u soukolí z protikola a osovou vzdálenost; řetězové kolo p, d₁, d, dₐ, d_f, M_R. Funguje i bez
prohlížeče (CLI \`mncad run\`). V sestavě je to ✗ – přepněte na záložku dílu. \`stav\` má u každého kola jeden řádek
(\`čelní m2 z24 x0 b20 · d 48 · dₐ 52 · W3 15,433 · díra 20 pero · kolo\`). **Na výkres:** \`výkres tabulka ozubení ano\`
(EN \`drawing gear table yes\`, DE \`zeichnung verzahnungstabelle ja\`; ve výkrese přepínač „Tabulka ozubení“) – tabulka nad
razítkem (nad kusovníkem a tabulkou děr), 110 mm na kolo, nejvýš dvě kola vedle sebe; v SVG, PDF, DXF i DWG; \`výkres stav\`
ji vypíše řádkem „Tabulka ozubení: …“. Překryv s pohledy = ⚠ (větší list nebo menší měřítko). Umístění se odchyluje od
ISO 1340 (pravý horní roh drží tabulka revizí); zjednodušené zobrazení ozubení podle ISO 2203 výkres nekreslí (pohledy
ukazují skutečné zuby).

#### Příklad 1 – čelní kolo s nábojem, tabulka ozubení a výkres
\`\`\`
nový díl "Kolo z24"
kolo čelní m 2 z 24 b 20 díra 20 pero náboj 40 15     # d 48 · dₐ 52 · W3 15,433 · M_dK 52,951
kolo tabulka
výkres A3 tabulka ozubení ano
výkres stav
výkres export pdf
\`\`\`

#### Příklad 2 – soukolí s posunutím na osovou vzdálenost 81 a pohybová studie
\`\`\`
nový díl Rám
kvádr 140 60 10 v -30 -30 -10                     # deska pod koly
díra 10 skrz v 0 0                                 # osa pastorku (Ø díry kola 1)
díra 30 skrz v 81 0                                # osa kola (a = 81)
soukolí čelní m 2 z1 20 z2 60 a 81 b 20           # → x1 0,3668 · x2 0,1558 · ε_α 1,52 + sestava „Soukolí m2 z20/z60“
vložit "Rám" ukotvit
sestava vazba závěs "Pastorek m2 z20" Ø10 "Rám" Ø10
sestava vazba závěs "Kolo m2 z60" Ø30 "Rám" Ø30
pohyb motor rotační "Pastorek m2 z20" 0..360 krok 10
pohyb stav
\`\`\`

#### Příklad 3 – řetězové kolo 08B duplex a kotouč cykloidního reduktoru s věncem
\`\`\`
nový díl Řetězka
kolo řetězové 08B z 19 řady 2 díra 25 pero náboj 50 25 B
kolo tabulka
nový díl "Kotouč reduktoru"
kolo cyklodisk n 10 dp 60 čep 6 e 1,5 b 8 ložisko 20
nový díl "Věnec reduktoru"
kolo cyklodisk n 10 dp 60 čep 6 e 1,5 b 8 věnec
\`\`\`

- EN: \`gear spur m 2 z 24 b 20 bore 20 keyway hub 40 15 both sides\`, \`gear helical m 2 z 30 beta 15 left\`, \`gear sprocket 08B z 19
  strands 2\`, \`gear table all\`, \`gear help spur\`, \`gearpair spur m 2 z1 20 z2 60 a 81\`. DE: \`rad stirnrad m 2 z 24 bohrung 20 nut
  nabe 40 15 beide seiten\`, \`rad schräg … beta 15 links\`, \`rad kettenrad 08B z 19 reihen 2\`, \`rad tabelle alle\`,
  \`radpaar stirnrad m 2 z1 20 z2 60 a 81\`. Česká slova platí v každém jazyce rozhraní.
- Obecný příkaz: \`prvek gear.spur m=2 z=24 b=20 bore=20 keyway=ano hubD=40 hubL=15\` dává stejná data (klíče řádků tabulky,
  \`prvek nápověda gear.spur\`). Dokument → skript zapisuje kola zpět příkazem \`kolo …\` (jen hodnoty odlišné od výchozích
  a povinné řádky); kolo s polohou odkazem nebo jiným tělesem zapíše obecným \`prvek gear.*\`.

| Druh | Přesně | Přibližně / nemodeluje se |
|---|---|---|
| čelní, šikmé, šípové | evolventa (B-spline ≤ 4·10⁻⁵ mm), trochoida paty z nástroje se zaoblením 0,38·m, podřezání, šroubovice | vrchol šípu ostrý, bez modifikace hlavy a podélné modifikace |
| vnitřní | evolventa | zaoblení paty oblouk 0,3·m (skutečné dává obrážecí nůž), kolize hlav pravidlem a 2D kontrolou |
| hřeben | celý profil ISO 53 | – |
| kuželové přímé | sférická evolventa, úhly kuželů | zaoblení paty |
| kuželové zakřivené, hypoidní | roztečné kužele, střední úhly sklonu, oblouk stopy zubu | tvar boku jmenovitý (ne obálkový, ne sdružený) – pro zástavbu, hmotnost a výkres, ne pro výrobu ozubení |
| šnek (ZA) / šnekové kolo | šroubová plocha, osový profil / profil ve střední rovině, hrdlo | boky kola mimo střední rovinu (bez obálky šneku); jiné tvary boku a globoidní šnek se nenabízejí |
| cykloidní, cyklodisk | epicykloida, hypocykloida, ekvidistanta epitrochoidy | proporce BS 978-2 jen jako výchozí hodnoty |
| řetězové | oblouky ISO 606, průměry | boční sražení zubu zjednodušené |
| řemenice | rozteč, průměry | tvar drážky HTD (oblouk + zaoblení) |

Mimo rozsah: pevnostní výpočet (ISO 6336), stupně přesnosti (ISO 1328) kromě jmenovité boční vůle, modifikace boků, planetové
soukolí jedním příkazem, rám soukolí, zjednodušené zobrazení ISO 2203 na výkrese.

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

### Příklad – sedlo pružiny (ploché dno) a závit s vrtákem z výkresu

\`\`\`
kvádr 80 50 30 název Kostka
# sedlo pružiny Ø12,5 hloubky 15 s rovným dnem, pod ním průchozí Ø6,6 pro vedení
díra 12,5 hloubka 15 dno ploché v 20 25
díra 6,6 skrz v 20 25 15
# závit M8 s vrtákem podle výkresu (jádro 6,647) – zadaný průměr má přednost před tabulkovým 6,8
díra 6,647 závit M8 hloubka 20 hloubka-závitu 16 v 60 25
# totéž bez opisování čísla: díra závit M8 hloubka 20 hloubka-závitu 16 jádro v 60 25
měřit díry
stav
\`\`\`

\`měřit díry\` ukáže u sedla „slepá, hloubka 15 mm · směr vrtání −Z · dno ploché“, u závitu „Ø 6,647 mm … hrot 118°
(ke špičce 21,997 mm)“; stav
„M8 hl. 20 (vrták Ø6,647 zadán ručně)“; výkres „Ø12,5 ↧15 (ploché dno)“ a „M8 ↧16“ + „Ø6,647 ↧20“.

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

## 2D výkres (2D CAD jako AutoCAD) – \`2d …\`, \`window.mncad.draft()\`

Samostatný druh dokumentu **2D výkres** (\`kind: "draft"\`, model v \`doc.draft\`): modelový prostor v jednotkách
výkresu (výchozí mm), hladiny, typy čar, tloušťky, barvy ACI / pravé, ByLayer / ByBlock, uchopení, příkazový řádek.
Každý řádek začíná \`2d\` (EN také \`draft\`, DE také \`zeichnen\`); za předponou je **stejný příkaz jako na příkazovém
řádku 2D výkresu** (CZ / EN / DE název nebo zkratka AutoCADu: L, C, A, PL, REC, POL, EL, SPL, XL, PO, DT, E, LA, LT…).
Více příkazů na řádku odděluje \`;\`. Zadání výzev jdou za sebou, konec řádku = Enter. Každý příkaz je atomický
(chyba = nic se nezapíše, další řádky pokračují) a každý běh je jeden krok historie (\`2d zpět\` / \`2d znovu\`).

**Body:** \`x,y\` · \`@dx,dy\` (relativně k poslednímu bodu) · \`@d<úhel\` · \`d<úhel\` (polárně od počátku) · \`#x,y\` · \`@\`
· samotné číslo = vzdálenost ve směru předchozího úseku · desetinná **tečka** (čárka odděluje x a y) · výrazy \`100/3\`.
**Přesné body entit** (uchopení textem): \`e3.start\` \`e3.end\` \`e3.mid\` \`e3.cen\` \`e3.q1\`–\`q4\` \`e3.v2\` (vrchol křivky)
\`e3.ins\` · průsečík \`x(e1,e2)\` / \`x(e1,e2,2)\` / \`x(e1,e2,x,y)\` · \`per(e3)\` pata kolmice z předchozího bodu · \`tan(e3[,k])\`
bod dotyku tečny · \`nea(e3,x,y)\` nejbližší bod. Id entit (\`e12\`) vrací protokol (\`✓ Úsečka: e1, e2\`) i \`2d stav\`.

| Příkaz (cs · en) | Zápis |
|---|---|
| nový · new | \`2d nový Deska [mm / cm / m / in]\` – nová záložka s 2D výkresem |
| čára · line (L) | \`2d čára 0,0 100,0 @0,50 @-100,0 uzavřít\` (\`zpět\` vrátí úsek) |
| křivka · pline (PL) | \`2d křivka 0,0 100,0 oblouk 100,50 úsečka 0,50 uzavřít\` · \`šířka 2 2\` · \`oblouk druhý x,y x,y\` |
| kružnice · circle (C) | \`2d kružnice 50,25 20\` · \`… průměr 40\` · \`3b p1 p2 p3\` · \`2b p1 p2\` · \`ttp e1@x,y e2@x,y r\` |
| oblouk · arc (A) | \`2d oblouk p1 p2 p3\` · \`p1 střed c p2\` · \`p1 střed c úhel 90\` · \`p1 konec p2 poloměr r\` · \`střed c p1 p2\` |
| obdélník · rectang (REC) | \`2d obdélník 0,0 @100,50\` · \`zaoblení 5 …\` · \`zkosení 5 5 …\` · \`natočení 30 …\` · \`x,y rozměry 100 50\` |
| mnohoúhelník · polygon (POL) | \`2d mnohoúhelník 6 0,0 vepsaný 20\` · \`opsaný\` · \`hrana p1 p2\` |
| elipsa · ellipse (EL) | \`2d elipsa -50,0 50,0 20\` · \`střed c p b\` · \`oblouk střed c p b 0 180\` |
| spline (SPL) | \`2d spline 0,0 10,10 20,0 30,10 [uzavřít]\` · \`spline metoda řídicí …\` · \`stupeň 2\` |
| přímka · xline (XL), polopřímka · ray | \`2d přímka 0,0 1,1\` · \`vodorovně p\` · \`svisle p\` · \`úhel 30 p\` · \`osa v a b\` · \`odsazení 10 e3 x,y\` |
| bod · point (PO) | \`2d bod 1,1 2,2\` (vzhled \`2d proměnná pdmode 3\`) |
| text (DT) | \`2d text 10,10 5 0 "Obsah"\` (bod, výška, úhel, text) · \`text zarovnání mc x,y 5 0 "…"\` |
| mtext (MT, T) | \`2d mtext 10,10 @80,-20 "1. řádek\\P2. řádek"\` (rohy rámečku = šířka zalamování) · \`mtext výška 5 zarovnání mc x,y šířka 0 "…"\` · kódy \`{\\C1;červeně}\` \`{\\H0.7x;…}\` \`\\S1/2;\` \`%%c\` Ø \`%%d\` ° \`%%p\` ± |
| styl-textu · style (ST) | \`2d styl-textu nový ISO písmo isocp.shx výška 0 šířka 0.8\` · \`aktuální ISO\` · \`upravit ISO sklon 15\` · \`přejmenovat A B\` · \`smazat A\` · bez voleb = výpis |
| upravit-text · textedit (ED) | \`2d upravit-text e5 "Nový text"\` (text, mtext, odkaz, tolerance, drsnost) · kóta: \`"<> H7"\` (\`<>\` = naměřená hodnota), \`"<>"\` = zpět na hodnotu |
| kóta · dim | chytrá kóta podle objektu: \`2d kóta e3 50,-15\` (úsečka → délka, kružnice → Ø, oblouk → R) · \`kóta body p1 p2 poloha\` · \`kóta úhlová …\` |
| kóta-lineární · dimlinear (DLI) | \`2d kóta-lineární 0,0 100,0 50,-15\` (orientace podle polohy) · \`… svisle x,y\` · \`… natočit 30 x,y\` · \`… text "<> H7" x,y\` · \`kóta-lineární "" e3 x,y\` (objekt) |
| kóta-zarovnaná · dimaligned (DAL) | \`2d kóta-zarovnaná 0,0 30,40 -10,50\` |
| kóta-úhlová · dimangular (DAN) | \`2d kóta-úhlová e1 e2 40,15\` (poloha oblouku vybere jeden ze 4 úhlů) · \`kóta-úhlová e5 x,y\` (oblouk) · \`kóta-úhlová "" vrchol p1 p2 x,y\` (i přes 180°) |
| kóta-poloměr · dimradius (DRA), kóta-průměr · dimdiameter (DDI) | \`2d kóta-poloměr e3 40,30\` · \`kóta-průměr e3 60,40\` (poloha = text uvnitř / vně) · \`kóta-poloměr zalomená e3 střed poloha zalomení\` |
| kóta-oblouku · dimarc (DAR), kóta-souřadnicová · dimordinate (DOR) | \`2d kóta-oblouku e4 0,60\` · \`… část p1 p2 x,y\` · \`kóta-souřadnicová 50,20 50,60\` (X; vodorovně = Y) · \`… xbáze / ybáze / počátek x,y\` |
| kóta-základnicová · dimbaseline (DBA), kóta-řetězová · dimcontinue (DCO) | po kótě: \`2d kóta-základnicová 150,0 200,0\` (rozestup DIMDLI) · \`kóta-řetězová 150,0 200,0\` · \`vybrat e7\` jiná výchozí kóta |
| kótovací-styl · dimstyle (D, DST) | \`2d kótovací-styl nový Strojní z ISO-25 dimtxt 3.5 dimdec 1\` · \`aktuální Strojní\` · \`upravit Strojní dimtol 1 dimtp 0.1 dimtm 0.05\` · \`přepsat e5 dimdec 3\` · \`použít Strojní e5 e6\` · \`vypsat\` · \`měřítko-poznámek 1:50\` |
| značka-středu · centermark (CM) | \`2d značka-středu e3 e4\` (kříž + osy CENTER) · \`velikost 5\` · \`osa e1 e2\` (osa mezi úsečkami) |
| odkaz · mleader (MLD, LE) | \`2d odkaz 10,10 30,25 "Sražení 1×45°"\` (šipka, zalomení, text) · \`odkaz šipka tečka …\` · \`… bod x,y …\` (další vrchol) · \`… ""\` bez textu |
| tolerance (TOL) | \`2d tolerance poloha ø0.05M A,B,C 120,40\` (charakteristika, hodnota, základny nebo \`-\`, bod) · \`tolerance řetězec "{\\Fgdt;j}%%v0.1%%vA" x,y\` |
| šrafa · hatch (H, BH) | \`2d šrafa 50,25\` (vnitřní bod; ostrovy) · \`šrafa vzor ANSI37 měřítko 2 úhel 0 x,y\` · \`šrafa plná objekty e1 e2\` · \`… uživatelský měřítko 3 dvojitá\` · \`… přechod lineární 1 5\` · \`… ostrovy vnější\` · plocha v \`data.area\` |
| upravit-šrafu · hatchedit (HE) | \`2d upravit-šrafu e7 vzor ANSI37 měřítko 2 úhel 30\` · \`… ostrovy ignorovat\` · \`… hranice\` (z asociativních objektů) |
| revizní-obláček · revcloud, drsnost · surfsym | \`2d revizní-obláček 0,0 100,50\` (oblouky ven) · \`… objekt e3\` · \`… obrátit …\` (oblouky dovnitř) · \`2d drsnost 50,0 0 "Ra 1,6"\` (bod na povrchu, směr) · \`drsnost druh bez-úběru postup "broušeno" …\` |
| hladina · layer (LA) | \`2d hladina nová OSY barva 1 typčáry CENTER tloušťka 0.25 [popis "…"]\` · \`aktuální OSY\` · \`vytvořit X\` (+aktuální) · \`OSY vypnout\` (zapnout, zmrazit, rozmrazit, zamknout, odemknout, netisk, tisk) · \`* rozmrazit\` · \`přejmenovat A B\` · \`smazat OSY přesunout-na 0\` |
| typčáry · linetype | \`2d typčáry načíst CENTER2 HIDDENX2\` · \`načíst vše\` · \`aktuální DASHED\` · měřítko \`2d měřítkočar 0.5\` |
| vlastnosti · properties | \`2d vlastnosti e3 e5 hladina OSY barva 5 typčáry DASHED tloušťka 0.5 měřítkočáry 2\` (bez id = výběr; \`barva ByLayer\` vrátí výchozí) |
| nastavit · set | geometrie jako panel vlastností: \`2d nastavit e3 r 25 c 10,10\` · \`nastavit e7 s "Nový text" h 5\` · \`nastavit e2 length=120\` |
| vyber · select | \`2d vyber hladina OSY typ circle\` · \`okno x,y x,y\` · \`křížení x,y x,y\` · \`vše\` · \`poslední\` · \`předchozí\` · \`výběr odebrat e3\` · \`nic\` |
| výběr oknem myší (GUI) | skica, 2D výkres i výkres dílu: tažení zleva doprava = okno (celé uvnitř), zprava doleva = křížení (i protnuté); bez modifikátoru nahradí (ve výzvě „Vyberte objekty“ přidá), Ctrl/Shift přidá, Ctrl+Shift/Alt odebere, Esc zruší jen okno; ve výkresu sestavy / dílu jdou vybrat i vygenerované kóty celkových rozměrů a pozice (Delete skryje, tažení posune – volba listu \`genEdit\`, „Obnovit vygenerované“ vrátí) · textem \`2d vyber o x,y x,y\` / \`k x,y x,y\` (en \`w\`/\`c\`, de \`f\`/\`k\`) · plátno 2D výkresu po okně nastaví \`data-boxsel\` = \`{n, mode, crossing, ms, total}\` |
| smazat · erase (E) | \`2d smazat e3 e5\` · \`smazat hladina OSY\` · \`smazat\` (výběr) |
| posun · move (M) | \`2d posun e3 e5 0,0 100,50\` (základní a cílový bod) · \`posun vše posunutí 10,0\` · \`posun 0,0 @25<45\` (vybrané) |
| kopie · copy (CO) | \`2d kopie e3 0,0 50,0 100,0\` (více cílů) · \`kopie e3 0,0 pole 5 20,0\` (5 v řadě) · \`… pole 5 přizpůsobit 100,0\` |
| otočit · rotate (RO) | \`2d otočit e3 0,0 90\` · \`otočit e3 0,0 kopie 45\` · \`otočit e3 0,0 reference 30 90\` · \`… reference e3.start e3.end 0\` |
| změnit-měřítko · scale (SC) | \`2d změnit-měřítko e3 0,0 2\` · \`… kopie 0.5\` · \`… reference 40 100\` (stávající → nová délka) |
| zrcadlit · mirror (MI) | \`2d zrcadlit e3 e5 0,0 0,100\` (kopie) · \`… ano\` (smazat zdroj); text čitelný dle \`proměnná mirrtext\` |
| zarovnat-objekty · align (AL) | \`2d zarovnat-objekty e3 s1 d1 s2 d2 [ano = i měřítko]\` |
| protáhnout · stretch (S) | \`2d protáhnout 90,-10 120,60 0,0 @20,0\` (křížící okno, základní a cílový bod) · \`protáhnout mnohoúhelník p1 p2 p3 hotovo …\` |
| úchop · gripedit | úprava úchopem: \`2d úchop e3 100,0 150,20\` (protáhnout úchop) · \`… e3.end posun @10,0\` · \`… otočit 90\` · \`… měřítko 2\` · \`… zrcadlit p\` · \`""\` = další režim · \`kopie\` |
| ekvidistanta · offset (O) | \`2d ekvidistanta 5 e1 0,100\` (vzdálenost, objekt, bod na straně) · \`ekvidistanta bodem e1 50,30\` · \`ekvidistanta smazat ano 5 …\` · \`hladina aktuální\` (EN: \`2d offset …\`, ne „draft offset“) |
| oříznout · trim (TR) | \`2d oříznout e1@50,0\` (bod výběru = odebíraný díl; rychlý režim: hrany = vše) · \`oříznout řezné-hrany e5 e6 e1@50,0\` · \`plot p1 p2 hotovo\` · \`křížení p1 p2\` · \`hrana prodloužit\` · \`prodloužit e2@x,y\` (jednou opačně) · volby celým názvem nebo jednoznačným začátkem v cs / en / de (\`řez\`, \`cut\`, \`schn\`) – i písmena AutoCADu (TRIM: T řezné hrany, O režim, R smazat, E hrana; CHAMFER: E metoda, M vícekrát) · \`řezné-hrany\` platí jen pro tento běh, \`režim\` a poloměr / vzdálenosti zaoblení a zkosení si pamatuje každý výkres zvlášť |
| prodloužit · extend (EX) | \`2d prodloužit e1@95,0\` (konec u bodu výběru k nejbližší hranici) · \`prodloužit hraniční-hrany e5 e1@95,0\` · \`hrana prodloužit …\` |
| zaoblit · fillet (F) | \`2d zaoblit poloměr 5 e1@10,0 e2@0,10\` · \`zaoblit poloměr 0 e1 e2\` (roh) · \`zaoblit poloměr 3 křivka e4\` (všechny vrcholy) · \`zaoblit oříznout neoříznout poloměr 5 e1 e2\` (bez oříznutí; volba Oříznout se ptá na režim) · \`zaoblit vícekrát …\` |
| zkosit · chamfer (CHA) | \`2d zkosit vzdálenost 5 5 e1@10,0 e2@0,10\` · \`zkosit úhel 5 30 e1 e2\` · \`zkosit vzdálenost 2 2 křivka e4\` |
| přerušit · break (BR) | \`2d přerušit e1@20,0 60,0\` (vyjme část) · \`přerušit e1 první 20,0 60,0\` · \`přerušit-v-bodě e1 50,0\` (rozdělí na dvě) |
| spojit · join (J) | \`2d spojit e1 e2 e3\` (kolineární úsečky → úsečka, oblouky jedné kružnice → oblouk / kružnice, navazující → křivka, se splajnem → spline) |
| rozložit · explode (X) | \`2d rozložit e3\` (křivka → úsečky a oblouky; blok, kóta, šrafa → části) |
| pole · array (AR) | \`2d pole e1 obdélníkové 4 3 20 15 [úhel]\` · \`pole e1 polární 0,0 6 360 ano\` · \`pole e1 dráha e5 rozdělit 8 ano\` · \`pole-po-dráze e1 "" e5 …\` (\`""\` ukončí výběr) · \`pole-obdélníkové\` \`pole-polární\` \`pole-po-dráze\` přímo |
| prodloužení · lengthen (LEN) | \`2d prodloužení delta 10 e1@95,0\` · \`celkem 120 …\` · \`procenta 50 …\` · \`delta úhel 30 e4@x,y\` (oblouk) · \`prodloužení e1\` (výpis délky) |
| upravit-křivku · pedit (PE) | \`2d upravit-křivku e3 uzavřít\` · \`… šířka 0.5\` · \`… proložit\` · \`… spline\` · \`… vyrovnat\` · \`… obrátit\` · \`… vložit-vrchol x,y\` · \`… odebrat-vrchol x,y\` · \`upravit-křivku e1 ano spojit e2 e3\` (úsečku převede) · \`upravit-křivku více e1 e2 ano proložit\` (\`ano\` = převést úsečky / oblouky / splajny – otázka padne jen, jsou-li ve výběru; samé křivky: \`upravit-křivku více e1 e2 proložit\`) · \`vyrovnat\` vrátí vrcholy před Proložit / Spline |
| upravit-spline · splinedit (SPE) | \`2d upravit-spline e3 uzavřít\` · \`… posunout-bod 2 10,5\` · \`… zjemnit x,y\` · \`… zvýšit-stupeň 4\` · \`… křivka 0.01\` (na křivku) · \`… obrátit\` · \`… spojit e4\` |
| přenést-vlastnosti · matchprop (MA) | \`2d přenést-vlastnosti e1 e2 e3\` (zdroj, cíle) · \`přenést-vlastnosti nastavení nic hladina "" e1 e5\` (jen hladina) |
| pořadí · draworder (DR) | \`2d pořadí e3 dopředu\` · \`dozadu\` · \`nad-objekty e7\` · \`pod-objekty e7\` |
| odstranit-duplicity · overkill | \`2d odstranit-duplicity vše\` · \`… tolerance 0.001\` · \`… ignorovat barva hladina ""\` · \`… sloučit ne\` |
| rozdělit · divide (DIV), rozměřit · measure (ME) | \`2d rozdělit e1 5\` (body na hranicích dílů) · \`rozměřit e1@0,0 25\` (od konce u bodu) · \`… blok ŠROUB ano 8\` |
| obrátit · reverse | \`2d obrátit e3\` (směr úsečky, křivky, splajnu) |
| dotazy | \`2d vzdálenost p1 p2\` · \`plocha p1 p2 p3 …\` / \`plocha objekt e3\` · \`souřadnice x(e1,e2)\` · \`výpis e3\` · \`stav\` · \`rozsah\` |
| proměnná · setvar | \`2d proměnná cecolor 1\` · \`celtype\` \`celweight\` \`clayer\` \`ltscale\` \`textsize\` \`pdmode\` \`luprec\` \`insunits\` \`mirrtext\` \`psltscale\` (0 / 1, vzor čar ve výřezech) … · \`jednotky mm přesnost 3\` |
| zoom | \`2d zoom rozsah\` · \`zoom okno x,y x,y\` · \`zoom střed x,y výška\` |
| blok · block (B) | \`2d blok ŠROUB 0,0 e1 e2 e3\` (název, bod vložení, objekty; \`převést\` = nahradit vložením – výchozí, \`ponechat\`, \`smazat\`) · stejný název = předefinovat (vložení se obnoví) · \`blok ?\` seznam bloků v \`data.blocks\` |
| vložit · insert (I) | \`2d vložit ŠROUB 100,50\` · \`vložit ŠROUB 100,50 2 2 45\` (měřítko X, Y, natočení; záporné měřítko = zrcadlení) · \`… 1 1 0 "M8" "V-001"\` hodnoty atributů v pořadí definic · \`vložit ŠROUB pole 3 2 20 15 0,0\` (MINSERT) · id vložení v \`data.insert\` |
| upravit-blok · bedit (BE), zavřít-blok · bclose | \`2d upravit-blok ŠROUB\` → další příkazy kreslí a upravují obsah bloku (počátek = bod vložení; nový název = nový blok) → \`2d zavřít-blok\` (uložit, vložení se obnoví) · \`zavřít-blok zahodit\` |
| definice-atributu · attdef (ATT) | \`2d definice-atributu CISLO "Číslo dílu" "001" 2,2 3.5 0\` (značka, výzva, výchozí hodnota, bod, výška, úhel) · režimy před značkou: \`neviditelný\` \`konstantní\` \`ověřit\` \`předvolba\` · \`… zarovnání mc …\` |
| upravit-atributy · attedit (ATE) | \`2d upravit-atributy e7 CISLO=V-002 "NAZEV=Hřídel 2"\` · bez dvojic = výpis (\`data.attributes\`) · také \`2d nastavit e7 att.CISLO=V-003\` |
| extrahovat-atributy · attext | \`2d extrahovat-atributy [blok ŠTÍTEK] [výběr] [oddělovač ,] [název kusovník]\` → CSV (id, blok, hladina, X, Y, natočení, měřítka, prostor, hodnoty) v \`data.file.text\`, řádky v \`data.rows\` |
| uložit-blok · wblock (W) | \`2d uložit-blok ŠROUB [dxf / dwg / mncad / záložka] [verze R2013] [název X]\` · \`uložit-blok výběr dxf\` · \`uložit-blok * mncad\` (celý výkres) – bod vložení = 0,0; soubor v \`data.file\` |
| vyčistit · purge (PU) | \`2d vyčistit\` (nepoužité bloky i vnořené, hladiny, typy čar, textové a kótovací styly) · \`vyčistit bloky\` · \`vyčistit hladiny STARÁ\` · co se smazalo: \`data.purged\` |
| rozvržení · layout (LO) | \`2d rozvržení nové Výroba A3 [na-výšku] [měřítko 1:5] [bez-razítka] [bez-rámečku] [bez-výřezu] NAZEV=Hřídel CISLO_VYKRESU=V-1\` (list s rámečkem ISO 5457, razítkem ISO 7200 a výřezem; papír v mm, počátek v levém dolním rohu listu – s okraji tisku v rohu tisknutelné plochy) · \`rozvržení nastavit Výroba\` · \`rozvržení model\` · \`kopírovat\` · \`přejmenovat A B\` · \`smazat A\` · \`rozvržení\` = seznam s výřezy a měřítky v \`data.layouts\` |
| vzhled-stránky · pagesetup | \`2d vzhled-stránky A2 na-šířku\` (rámeček se vymění, razítko přesune) · \`styl mono / barva / šedá\` · \`tloušťky ne\` · \`okraje 5,5,5,5\` (netisknutelný okraj – obsah listu zůstane na místě, tisk ho ořízne) · \`dpi 300\` · \`psltscale 0\` (vzor čar ve výřezech v jednotkách modelu; výchozí 1 = v mm papíru, obrazovka i tisk stejně) |
| výřez · mview (MV) | v rozvržení: \`2d výřez 25,60 405,282 1:5\` (rohy na papíře, měřítko; \`vejít\` = model přesně) · \`výřez vejít 1:10\` (kreslicí plocha listu) · \`výřez dva svisle vejít 1:2\` · \`tři\` / \`čtyři\` · \`mnohoúhelník p1 p2 p3 "" 1:5\` · \`objekt e3 1:5\` · \`výřez měřítko e7 1:20\` · \`výřez střed e7 120,40\` (střed pohledu = bod modelu, i \`@10,0\` od středu; v GUI klik do výřezu) · hladina výřezu řídí jen rám (vypnutá / zmrazená = výřez bez rámu, obsah zůstane) · \`zamknout\` / \`odemknout\` / \`zapnout\` / \`vypnout e7\` · také \`2d nastavit e7 scale=1:50 locked=1\` |
| modelový-prostor · mspace (MS), papírový-prostor · pspace (PS) | \`2d modelový-prostor [e7]\` = další příkazy kreslí v modelu přes výřez (souřadnice modelu) · \`2d papírový-prostor\` zpět na list |
| hladiny-výřezu · vplayer | \`2d hladiny-výřezu zmrazit KÓTY,OSY výřez e7\` (jen v tomto výřezu; \`*\` = vše, \`vše\` = všechny výřezy) · \`rozmrazit …\` · \`reset výřez e7\` · \`seznam\` |
| tisk · plot (Ctrl+P), export-pdf | \`2d tisk\` (aktuální rozvržení 1:1 do PDF – vektorově, tloušťky v mm, přesné měřítko) · \`tisk rozvržení Výroba mono\` · \`tisk model okno 0,0 200,100 A4 měřítko 1:2\` · \`tisk png dpi 300\` · \`tisk svg\` · \`2d export-pdf [mono]\` = všechna rozvržení, jedno PDF · soubor v \`data.file\` (\`base64\` / \`text\`), stránky v \`data.plot\` (\`w\`, \`h\`, \`ratio\`) |
| export · dxfout (DWG / DXF) | \`2d export dxf verze R12\` (jen DXF; elipsy / splajny jako POLYLINE s odchylkou ≤ 0,005 mm, MTEXT jako TEXT, šrafy rozložené, názvy velkými písmeny bez diakritiky – kolize se přejmenují s varováním) · \`export dxf verze R2000 binární\` · \`export dwg verze R2018 název "Deska"\` – verze R2000, R2004, R2007, R2010, R2013, R2018 (také AC1015…AC1032); soubor v \`results[].data.file\` = \`{ name, mime, bytes, version, text \| base64, warnings? }\` |
| import · dxfin (DWG / DXF) | \`2d import "deska.dwg" <base64>\` = nová záložka; přehled v \`results[].data.import\` (\`format, version, entities, layers, blocks, layouts, converted, kept, skipped, warnings\`) · \`2d import "rám.dxf" <base64> sloučit\` (en \`merge\`, de \`einfügen\`) = obsah do otevřeného výkresu: nová id, chybějící hladiny / styly / bloky se doplní, jiné jednotky (INSUNITS) se převedou měřítkem, anonymní bloky (*D, *U…) se stejným názvem se přejmenují, vložené entity jsou vybrané (kromě zamčených / zmrazených / vypnutých hladin), \`data.merge\` |
| soubory DWG / DXF (API) | \`await window.mncad.importFile({ name: "x.dwg", base64 })\` = 2D výkres v nové záložce (\`as\`: auto / tab / draft – draft jen pro DXF / DWG; \`{ as: "sketch" }\` = DXF i DWG do 3D skici) · \`window.mncad.draftImport({ name, base64 \| text })\` · čte DWG R2000–R2018, DXF R12–R2018 ASCII i binární |
| nápověda · help | \`2d nápověda\` (všechny příkazy s popisem) · \`2d nápověda kružnice\` |

**API:** \`await window.mncad.draft("čára 0,0 100,0; kružnice 50,0 20")\` (předpona \`2d\` se doplní) vrací
\`{ ok, log, results: [{ cmd, input, ok, error?, log, created, changed, deleted, data? }], status, doc }\`;
\`status\` = jednotky, rozsah, počty entit podle druhu, hladiny (barva, typ, tloušťka, stav, počet entit), výběr.
Dotazy vrací čísla v \`data\` (\`distance\`, \`angle\`, \`dx\`, \`dy\`, \`area\`, \`perimeter\`, \`point\`, \`entities\`…).
Poloha pohledu pro klikání myší: atribut \`data-view\` prvku \`[data-draft-canvas]\` (\`x = (X − cx)·scale + w/2\`,
\`y = h/2 − (Y − cy)·scale\` v pixelech plátna).

Příklad – deska 100 × 50 s osami a dírou:
\`\`\`
2d nový Deska
2d hladina nová OBRYS barva 7 tloušťka 0.5; hladina nová OSY barva 1 typčáry CENTER tloušťka 0.25
2d hladina aktuální OBRYS; obdélník 0,0 @100,50; kružnice 50,25 průměr 20
2d hladina aktuální OSY; čára 45,25 55,25; čára 50,20 50,30
2d stav
\`\`\`

**Poznámky 2D (balík annot):** text MTEXT a tolerance pište **v uvozovkách** (kódy obsahují \`;\`, který jinak dělí
příkazy). Kóty jsou asociativní na definiční body – \`2d nastavit e5 p2 120,0\` nebo úchop přepočítá hodnotu; hodnotu
formátuje kótovací styl (ISO-25: DIMDEC 2, desetinná čárka, bez koncových nul → \`100\`; \`dimdec 3 dimzin 0\` → \`100,000\`).
Výsledek kóty: \`results[].data.measurement\` (mm / °) a \`data.dimensions[{ id, kind, measured, text }]\`; šrafa
\`data.area\`; tolerance \`data.tolerance.plain\`. Vlastnosti panelu jsou i textem: \`2d nastavit e5 text "<> H7" dimdec 3\`
(přepsání u kóty), \`2d nastavit e7 pattern ANSI37 scale 2\` (šrafa). Měřítko poznámek: anotativní kóty / texty mají
velikost na papíře × \`kótovací-styl měřítko-poznámek 1:50\` (uloží CANNOSCALE = papír : skutečnost = 0,02 jako AutoCAD;
kóta se stylem DIMANNO je anotativní, výřez rozvržení ji kreslí ve svém měřítku). Kótovací styl se při první kótě
uloží se všemi proměnnými (ISO-25: DIMTXT 2,5, DIMASZ 2,5, DIMDSEP „,“) – export DWG / DXF je nepřepíše palcovými.

Příklad – okótovaná příruba se šrafou, odkazem, tolerancí a drsností:
\`\`\`
2d nový Příruba
2d obdélník 0,0 @120,80; kružnice 60,40 15; kružnice 20,20 4; kružnice 100,20 4
2d hladina nová KÓTY barva 3; hladina aktuální KÓTY
2d kótovací-styl nový Výrobní z ISO-25 dimtxt 3.5 dimdec 1
2d kóta-lineární 0,0 120,0 60,-15; kóta-lineární 0,0 0,80 -15,40; kóta-průměr e2 85,60
2d kóta-lineární 0,0 20,0 10,-30; kóta-řetězová 100,0 120,0
2d šrafa vzor ANSI31 60,5
2d odkaz 100,20 125,95 "2× díra ø8"; tolerance poloha ø0.1 A 130,40; drsnost 60,80 0 "Ra 3,2"
2d stav
\`\`\`

**Úpravy 2D (balík edit):** výběr objektů je na začátku příkazu (\`e3 e5\`, \`vše\`, \`poslední\`, \`předchozí\`,
\`okno x,y x,y\`, \`křížení x,y x,y\`, \`hladina X\`, \`typ line\`); bez výběru se použije aktuální výběr (\`2d vyber …\`).
Výběr končí prvním slovem, které výběrem není – následuje-li výzva na jeden objekt (dráha pole), oddělte ho \`""\`
(Enter) nebo zadejte objekt s bodem \`e5@x,y\`. U ořezu, prodloužení, zaoblení a přerušení rozhoduje **bod výběru**
\`e3@x,y\` (který díl se odebere, který konec se prodlouží, která strana zůstane). Každý příkaz = jeden krok historie,
entity na zamčených hladinách se přeskočí (⚠ v protokolu). Vytvořené / změněné / smazané id jsou v \`results[].created /
changed / deleted\`; měření v \`data\` (\`displacement\`, \`angle\`, \`factor\`, \`length\`, \`items\`, \`points\`, \`removed\`).

Příklad – úpravy (deska se zaoblenými rohy, otvory polárním polem, ekvidistanta):
\`\`\`
2d nový Příruba
2d obdélník 0,0 @120,80; kružnice 60,65 4
2d zaoblit poloměr 10 křivka e1
2d pole e2 polární 60,40 6 360 ano
2d ekvidistanta 3 e1 60,40
2d stav
\`\`\`

Příklad – výkres pro dodavatele jako DWG a pro CAM jako DXF R12, zpět a vložení do jiného výkresu:
\`\`\`
2d nový Příruba mm
2d hladina nová OBRYS barva 7 tloušťka 0.5; hladina aktuální OBRYS
2d kružnice 0,0 průměr 120; kružnice 0,0 průměr 60; kružnice 45,0 průměr 11
2d export dwg verze R2013 název "Priruba"
2d export dxf verze R12 název "Priruba-CAM"
\`\`\`
V JavaScriptu: \`const f = (await window.mncad.draft('export dwg verze R2013 název "Priruba"')).results[0].data.file\`
(\`f.name\` = "Priruba.dwg", \`f.base64\`); otevření zpět \`await window.mncad.importFile({ name: f.name, base64: f.base64 }, { as: "draft" })\`;
vložení do jiného otevřeného výkresu \`await window.mncad.draft('import "' + f.name + '" ' + f.base64 + ' sloučit')\` (3 kružnice, nová id).

Příklad – blok, rozvržení A3 s razítkem, výřez 1:1 a tisk PDF (rozměr na papíře = rozměr modelu × měřítko):
\`\`\`
2d nový Příruba
2d hladina nová OBRYS tloušťka 0.5; hladina aktuální OBRYS
2d kružnice 0,0 průměr 120; kružnice 0,0 průměr 60
2d kružnice 45,0 průměr 11; blok DÍRA 45,0 okno 35,-10 55,10; vložit DÍRA -45,0; vložit DÍRA 0,45 1 1 90
2d rozvržení nové Výroba A3 NAZEV=Příruba CISLO_VYKRESU=P-001 MATERIAL=S235
2d výřez měřítko vše 1:1
2d tisk mono název Priruba
\`\`\`
Výsledek: \`results[].data.layout\` (id, formát A3 420 × 297), výřez v měřítku 1:1 (atribut MERITKO razítka se
přepíše), PDF v \`data.file.base64\` – kružnice Ø120 má na papíře průměr přesně 120 mm, čáry hladiny OBRYS 0,5 mm.

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
  dokumentu; objekt s \`"app": "mnastrojarna-cad"\` otevře **nový** dokument (\`setDocument(doc, { inPlace: true })\` nahradí
  otevřený dokument jedním krokem historie).
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

## Výstupy z konzole bez dialogů – uložit, export, výkres, sdílet

Agent, který umí jen psát do konzole (nebo volat \`window.mncad.run\`) a klikat, dokončí celou práci **uvnitř CADu** –
uložení, export, výkres i sdílený odkaz. Výstupní příkazy nikdy neotevřou systémový dialog („Uložit jako“, dotaz na
název): soubor se rovnou stáhne do složky Stažené pod výchozím nebo zadaným názvem a protokol napíše **název souboru,
velikost a formát**. Příkazy lze psát za modelovací řádky v témže vstupu – pracují s dokumentem v tom stavu, v jakém
je na jejich řádku.

| Příkaz (EN · DE) | Co udělá |
| --- | --- |
| \`uložit [název]\` (\`save\` · \`speichern\`) | projekt .mncad (bez názvu podle dílu: \`Konzola.mncad\`); kontrola, že soubor jde znovu otevřít (počet prvků) |
| \`export step|stl|brep|obj|glb|3mf|wrl|mncad [název] [bez kontroly]\` (\`export\` · \`exportieren\`) | 3D model; u **STEP a BREP kontrola**: stažený soubor se znovu načte jádrem a porovná s modelem – počet těles, objem (rozdíl v %) a obálka (odchylka v mm); bez sítě, opakovaný export nezměněného modelu ji nepočítá znovu; \`bez kontroly\` (\`no check\` · \`ohne prüfung\`) ji vynechá |
| \`výkres export pdf|dxf|dwg|svg|csv|png [list N|N|vše] [název]\` (\`drawing export\` · \`zeichnung export\`) | list výkresu (bez listu aktivní; \`list 2\` i holé \`2\` = list 2, jen celá čísla od 1; \`vše\` = každý list zvlášť, \`…_list2.pdf\`; číselný název souboru: \`jako 2\`); výkres nejdřív \`výkres A3 …\` a \`kótovat\` |
| \`skica export dxf ["Skica 1"] [jako název]\` (\`sketch export dxf\` · \`skizze export dxf\`) | skica jako DXF (bez názvu otevřená, jinak poslední skica) |
| \`sdílet [model|výkres] [dní N|bez omezení] [heslo X] [od "Jméno"]\` (\`share\` · \`freigeben\` – německé \`teilen\` je rozdělit tělesa) | sdílený odkaz jako tlačítko Sdílet odkazem (výchozí 10 dní, bez hesla); **adresa je v konzoli prohlížeče na řádku \`URL: …\`**, ve stručném / plném protokolu a JSON (CLI, \`protocol: "short"\`) ve výpisu \`= L<n> link "<dokument>" url=… mode=… exp=… content=…\` a na řádku \`O\`; zkopíruje se do schránky, když to prohlížeč dovolí (na schránku se nikdy nečeká) |
| \`odkaz ověřit [<odkaz>|<kód>] [heslo X]\` (\`link verify\` · \`link prüfen\`) | otevře odkaz jako příjemce (stažení z úložiště webu odkazu, dešifrování, kontrola dokumentu a platnosti) a vypíše \`✓ odkaz se otevře (…): <obsah>\` + \`= L<n> link url=… ok=1 mode=… exp=… content=…\`, jinak ✗ \`share.link-broken\` s důvodem \`truncated\` (useknutý), \`corrupt\` (změněný), \`password\`, \`expired\`, \`notfound\`, \`network\`; bez odkazu = poslední odkaz běhu. Kód bez \`#\` nebo celý odkaz (\`#\` za mezerou je komentář) |
| \`odkaz\` (\`link\`) | vypíše poslední sdílený odkaz znovu |
| \`exporty [vymazat]\` (\`exports [clear]\` · \`exporte [löschen]\`) | **záznamy exportů v dokumentu** (vlna 22, bod 20): každý \`export …\`, \`výkres export …\`, \`skica export dxf\` i export tlačítkem zapíše formát, soubor, revizi modelu \`r·a1b2c3\` a čas; po změně modelu je záznam „⚠ ZASTARALÝ“ s příkazem, který export zopakuje (soubor na disku se sám nepřepisuje); záznamy se ukládají s dokumentem (.mncad, sdílení); \`zpět\` / Ctrl+Z záznam nesmaže (soubor existuje) – k vrácenému modelu je ZASTARALÝ, \`exporty vymazat\` Zpět vrátí |
| \`výstupy [zastaralé]\` (\`outputs [stale]\` · \`ausgaben [veraltet]\`) · \`zastaralé\` | přehled výstupů dokumentu: vydání každého listu, exporty a **seznam zastaralých výstupů** – vydané listy ze starší revize modelu, exporty ze starší revize, uložené analýzy, které pro nynější stav neplatí (kolize, stav vazeb, pohyb, měření, porovnání), kopie dílů v sestavě starší než díl; u každé položky příkaz, který ji opraví |
| \`přepočítat vše\` (\`recompute all\` · \`alles neu berechnen\`) | přepočítá, co jde bez člověka: kopie dílů v sestavě (\`sestava obnovit vše\` – list sestavy s kusovníkem pak ukáže obnovené údaje), stav vazeb, \`kolize\`, \`pohyb spustit\`, všechny listy; vypíše, co **musí udělat člověk**: vydaný list ze starší revize (\`výkres vydat B\`), nový export, zopakovat měření / porovnání. Nikdy sám nevydává revizi ani nepřepisuje soubory. GUI: panel „Zastaralé výstupy“ v rohu 3D okna s tlačítkem „Přepočítat vše“ (týž příkaz) |

\`\`\`
uložit
# ✓ uloženo: Konzola.mncad · 1,9 kB · projekt Mnástrojárna CAD (.mncad) – staženo (bez dialogu)
#   ✓ kontrola: projekt jde znovu otevřít – „Konzola“, 5 prvků
export step
# ℹ export STEP: Konzola.step · 41 kB · STEP AP214 – staženo (bez dialogu) · kontrola níže
#   ✓ kontrola STEP: soubor znovu načten jádrem – těles: 1, objem 46 701 mm³ (rozdíl 0,0000 %), obálka 80,00 × 50,00 × 12,00 mm (odchylka 0,0000 mm) → věrná kopie modelu
výkres A3 na šířku pohledy přední,horní,iso
kótovat
výkres export pdf
# ✓ výkres PDF: Konzola_vykres.pdf · 83 kB · výkres PDF – staženo (bez dialogu)
sdílet
# ✓ sdílený odkaz vytvořen – „Konzola“ (model), platí do: 23. 11. 2026, bez hesla, 1,3 kB v úložišti
# URL: https://mnastrojarna.cz/s#Ab3kZ9xQ2m
#   kód k přečtení nebo opsání: Ab3k Z9xQ 2m (36 znaků odkazu)
#   obsah odkazu: díl „Konzola“ – prvků 5, listů výkresu 1, příloh 0
#   (zkopírováno do schránky)
\`\`\`

(Text výše je **konzole prohlížeče**. V CLI a ve \`window.mncad.run(text, { protocol: "short" })\` má každý odkaz výpis
\`= L<n> link …\` a poslední odkaz řádek \`O\` – příklad níže v oddílu „Sdílení“.)

- Kontrola STEP / BREP: \`✓ … věrná kopie modelu\` = soubor obsahuje totéž těleso (objem do 0,1 %, obálka do 0,01 mm) a po
  načtení projde přesnou kontrolou platnosti; \`⚠ … NEPROJDE přesnou kontrolou platnosti\` (\`out.reload-invalid\`) = míry
  sedí, ale soubor po načtení přesnou kontrolou neprojde; \`✓ … → odpovídá modelu; platnost souboru jen rychlou kontrolou\`
  = přesná kontrola souboru neproběhla (nad 400 ploch).
  \`⚠ kontrola STEP: soubor se od modelu liší – …\` napíše, co nesedí (tělesa, objem, obálka) – opravte prvky s ⚠ / ✗
  (\`stav\`) a export zopakujte. \`✗ kontrola …: soubor se nepodařilo znovu načíst\` = soubor je poškozený nebo prázdný.
- Chybný zápis skončí řádkem ✗ se správným zápisem (\`export pdf\` → „výkres se exportuje příkazem výkres export pdf“).
- Prohlížeč se může po několika staženích za sebou zeptat „Stáhnout více souborů?“ – to je lišta prohlížeče, ne dialog
  CADu; povolte ji jednou pro tuto stránku.

### Prohlížeč ovládaný automatizací – žádná systémová okna

Když prohlížeč ovládá automatizace (\`navigator.webdriver === true\` – Playwright, Selenium, Puppeteer, WebDriver BiDi)
nebo má adresa příznak **\`?agent=1\`** (např. \`https://www.mnastrojarna.cz/cad?agent=1\` pro rozšíření prohlížeče,
které webdriver nenastavuje), CAD neotevře žádné systémové okno, na kterém by automatizace uvízla:

- **Tlačítka** Uložit projekt, Uložit jako, Ctrl+S, Soubor ▸ export 3D, export výkresu (PDF / DXF / DWG…), CSV porovnání
  stahují rovnou pod výchozím názvem (bez dialogu „Uložit jako“). Člověk bez automatizace dialog dál dostane; trvale ho
  vypne Nastavení → Soubory (\`window.mncad.setSettings({ askWhereToSave: false })\`).
- **Dotazy a potvrzení** jsou dialogy na stránce (nikdy \`window.prompt\` / \`confirm\` / \`alert\`): překrytí
  \`[data-ask="number|text|confirm"]\`, nadpis \`[data-ask-title]\`, text \`[data-ask-body]\`, pole \`[data-ask-input]\`,
  chyba \`[data-ask-error]\`, tlačítka \`[data-ask-ok]\` a \`[data-ask-cancel]\`. Fokus je po otevření v poli (u potvrzení
  na OK) – **Enter = OK, Esc = zrušit**. Např. Delete s vybraným tělesem → potvrzení „Smazat celé těleso…“.
  Enter / Esc platí pro dotaz, i když fokus do něj ještě nepřešel; dokud je dotaz otevřený, klávesové zkratky CADu
  (Delete, Ctrl+S…) se neprovedou – jako u systémového okna.
- Zavření karty s neuloženou prací se v automatizaci **neptá** (žádný dotaz beforeunload).
- **Tisk** ve výkresovém prostředí v automatizaci neotevře dialog tisku, ale stáhne stejný list jako PDF.
- Příznak \`?agent=1\` si karta pamatuje i po přechodu na jinou adresu (přepnutí jazyka \`/cad\` → \`/en/cad\`); vypne ho
  \`?agent=0\`.
- Zbývají jen tlačítka, která otevírají okno systému nebo jiného programu – v automatizaci je **nepoužívejte**: výběr
  souboru u Otevřít (soubor předejte \`window.mncad.importFile({ name, base64 })\`), v dialogu sdílení „Sdílet…“
  (systémová nabídka sdílení) a „E-mail“ (otevře poštovní program, prohlížeč se na něj ptá) – místo nich příkaz
  \`sdílet\` a adresa z řádku \`URL: …\`.

## Dokument → textový skript, kontrola tam a zpět

Opačný směr k textovým příkazům: otevřený dokument (vzniklý klikáním, z JSON nebo dřívějším skriptem) se vypíše jako
TENTÝŽ model v textových příkazech – k učení jazyka, úpravě a novému spuštění, porovnání verzí.

\`\`\`
export skript                 # stáhne <název>.mncad.txt; protokol: řádky, velikost, pokrytí, poznámky
export skript en "forma-v2"   # klíčová slova anglicky (cs | en | de), vlastní název souboru
\`\`\`

JavaScript: \`await window.mncad.script()\` vrátí text (\`{ lang: "en", names: "all", sigs: "keep" }\` = volby). V nabídce:
Data ▸ Export ▸ Textový skript (.txt).

- **Co skript obsahuje:** každý díl jako blok \`nový díl "…"\` (materiál, proměnné, skici s entitami / vazbami / kótami, prvky
  vlastními příkazy, výkresy), u sestavy pak \`nová sestava "…"\`, \`vložit "díl" v x y z otočení rx ry rz [ukotvit]\` pro každou
  komponentu (stejný díl se zapíše jednou a vloží N×), vazby \`sestava vazba … #1 F3 #2 F7\` (komponenty pořadím \`#k\`;
  závěs / šířka / drážka i s druhými plochami, symetricky s \`rovina #1 F1\`), pohybovou studii a listy výkresu.
  Zapíše vše, co jde napsat textem (vlna E): přezdívky komponent (\`vložit "Šroub" … jako "K48"\`), pružiny mezi díly
  (\`sestava pružina #4 mezi #3 F9 #2 F6 volná 41 blok 16 tuhost 5.069 vedená ano\` – i z „Pružiny mezi díly“ do děr vzoru),
  dynamiku pohybu (\`pohyb hmotnost\`, \`pohyb síla|moment\`, \`pohyb dynamika čas … krok … gravitace 0 -0.6 -0.8 …\`, u kinematické
  studie s nastavením dynamiky ještě \`pohyb kinematika\`), celé razítko (šablona, logo jako data URL, firma, zákazník,
  projekt, kontroloval, schválil, polotovar, počet, tepelné, povrch, úhly, sražení, nepředepsané i tabulkou podle desetinných
  míst), tabulku revizí (\`výkres revize A "…" datum=… kreslil=…\`, \`výkres revize A značky ne\`), funkční kóty a polohy děr
  (\`kótovat chytře funkční 80 díry tabulka\`), \`pružiny plně\`, další modely, pomocné pohledy, řezy lomenou čarou a detaily
  (nejdřív pohled, na který se odkazuje – pomocný pohled z řezu C až po řezu C; písmena jako v dokumentu, jde-li to, jinak
  je protokol vypíše „C → B“; umístění na listu s pevným formátem \`umístit x y\` od levého dolního rohu, na listu
  s automatickým formátem \`umístit x y odshora\` od levého horního – výška takového listu se při čtení mění s každým
  dalším pohledem), částečné řezy, přerušení, \`výkres uložení zobrazení … / tabulka ano\` a upravené vygenerované kóty
  celkových rozměrů a pozice (\`výkres vygenerované skrýt dim:front:t\`, \`výkres vygenerované posun pos:1 5 -3\` – jen ty,
  které na listu jsou: klíče ověří jádro, úpravu objektu, který už na listu není, skript vynechá a ohlásí).
  Razítko se píše proti stavu při čtení: \`výkres list nový\` převezme razítko aktivního listu, proto má další list jen
  řádek s tím, co se liší – i vyprázdnění (\`výkres razítko šablona=iso7200 číslo="" zákazník=""\`, \`logo=ne\`); popisové
  údaje dokumentu (číslo, kreslil, revize) se na konci dorovnají (\`výkres list 1\` · \`výkres razítko číslo="…"\` · \`výkres list 2\`).
- **Přesnost:** každý řádek prvku se před zápisem přečte stejným rozborem jako konzole, doplní nad prvky tak, jak budou
  v dokumentu PO PŘEČTENÍ skriptu (nová id), a porovná s původním prvkem. Co vlastní příkaz neumí, zapíše se obecným
  \`prvek <typ> klíč=hodnota\`, a co ani ten, jako jednořádkový JSON – protokol napíše pokrytí („183 prvků: 183 vlastním
  příkazem, 0 obecným příkazem „prvek“, 0 jako JSON“).
- **Odkazy na dřívější prvky:** poslední skica / prvek (\`$last\`), jinak název – \`zrcadlit rovina "Rovina 1"\`,
  \`rotovat 90 osa "Osa 1"\`, \`vysunout k rovině "Rovina 1"\`, \`koule 8 na bod "Bod 1"\`, \`prvek extrude sketchId="Skica 2"\`.
  Prvek, na který se odkazuje názvem, má název ve skriptu vždy výslovně. Potlačení, vazba parametru a přejmenování míří
  na poslední prvek: \`potlačit poslední\`, \`upravit poslední size.2==t\` (výraz s mezerami \`size.1="=b + 25"\`),
  \`přejmenovat poslední na "Díra 1"\` (dva prvky stejného názvu); konfigurace na název nebo \`@pořadí\`.
- **Čísla hran a ploch:** výběr prvku má v dokumentu otisky; po úpravě historie (prvek přesunutý nebo vložený před výběr)
  uložená čísla neplatí a aplikace entity hledá podle otisku. Export proto čísla nejdřív ověří jádrem a zapíše platná
  (\`zaoblit 4 hrany E3 E5 E9 E11\`, \`skica plocha F9\`). S \`sigs: "keep"\` se jádro vynechá a prvky s otisky se zapíší
  i s nimi obecným příkazem.
- **Jazyk:** \`export skript en\` / \`{ lang: "en" }\` píše anglická klíčová slova a počítá s anglickým rozhraním:
  automatický název („Kvádr 1“ / „Box 1“ / „Quader 1“) se vynechá jen tehdy, když by ho rozhraní toho jazyka přidělilo samo
  – český dokument má v anglickém skriptu názvy výslovně a po přečtení v /en/cad jsou stejné. Český skript přečtený
  v jiném jazyce rozhraní dá stejnou geometrii, vazby parametrů, potlačení i konfigurace; liší se jen automatické názvy
  prvků, na které se nic neodkazuje (\`names: "all"\` píše název u každého prvku).
- **Názvy dokumentů a texty:** díl „Nový díl“ / sestava „Nová sestava“ má za \`nový díl "Nový díl"\` ještě řádek
  \`název "Nový díl"\` – výchozí název aplikace jinak čísluje („Nový díl 2“) a \`vložit\` by minulo. Text s „#“ nebo „//“
  patří do uvozovek (\`nový díl "Držák # levý"\`) – komentář se hledá jen mimo uvozovky.
- **Kontrola tam a zpět (doporučený postup):** \`const t = await window.mncad.script()\` → \`await window.mncad.run(t)\` (nová
  záložka) → \`měřit těleso\` / \`stav\` v obou záložkách: objem a obálka každého dílu, počet komponent a „Vazby: N splněno“
  musí být stejné.
- **Co se nepřenáší** (protokol to vypíše řádky ℹ a skript totéž v komentářích \`# ℹ …\` za hlavičkou): volby listu bez
  textového příkazu (\`dimRoom\`, \`weldSymbols\` – jen JSON), model na listu ze záložky (jiného dokumentu), pružina nebo
  vazba s plochou v podsestavě; pohled, řez, detail, částečný řez a přerušení, jejichž základní pohled na listu není
  (vypnutý pohled – aplikace je drží, ale nekreslí); vygenerované kóty výkresu vznikají znovu příkazem \`kótovat chytře\`
  (nová id; kóty, které jste smazali, smaže skript znovu – \`výkres smazat a3 a8\`), jejich ruční úpravy (tolerance)
  a ruční kóty / značky je třeba doplnit (\`výkres tolerance …\`); komponenty z importovaných souborů a podsestavy; barvy
  těles a ploch, podklady skic; 2D výkres se zapíše jako jeden řádek JSON.

### Vygenerované kóty celkových rozměrů a pozice textem

Kóty celkových rozměrů pohledů (\`kótovat celkově\` / \`základní\`) a pozice (balónky) sestavy, které jde ve výkresu vybrat
myší (Delete skryje, tažení posune), jdou upravit i textem – klíč \`dim:<pohled>:t\` (kóta nahoře), \`dim:<pohled>:l\` (vlevo),
\`pos:<číslo>\` (pozice):

\`\`\`
výkres vygenerované                       # klíče listu a dosavadní úpravy
výkres vygenerované skrýt dim:front:t pos:3
výkres vygenerované zobrazit pos:3
výkres vygenerované posun pos:1 5 -3      # mm listu, y nahoru; kóta se posouvá jen kolmo k sobě
výkres vygenerované obnovit               # vše na výchozí místo (s klíči jen ty; klíč, který na listu ani mezi úpravami není = ✗)
\`\`\`

EN \`drawing generated hide|show|move|restore\`, DE \`zeichnung generiert ausblenden|einblenden|verschieben|wiederherstellen\`.
\`výkres stav\` vypíše řádek „Vygenerované kóty a pozice upravené: …“.

### Čitelný výkres sestavy – pozice po pohledech, kusovník, překryvy (vlna 22, bod 17)

Pozice (balónky) se rozmístí po obvodu pohledů – nejdřív první řada kolem všech pohledů, pak další řady; pozice jde
k pohledu, kde ji nezakrývají jiné komponenty (pole desek: půdorys), co se k jednomu pohledu nevejde, přejde k dalšímu.
Balónek nikdy neleží přes jiný balónek, text, kótu, tabulku, razítko, jiný pohled ani rám a odkazová čára nevede přes
cizí balónek; výměny dvojic snižují křížení odkazů. Kusovník: krátký nad razítkem, dlouhý ve sloupcích vlevo od razítka,
nebo na samostatném listu – pohledy se kvůli němu nikdy tiše nezmenší (⚠ „Pohledy zmenšeny na … kvůli kusovníku“,
⚠ \`drawing.bom-overflow\`, když se nevejde ani ve sloupcích).

\`\`\`
výkres pozice                              # pozice po pohledech, ručně / zamčené, překryvy a křížení odkazů
výkres pozice pohled horní 1-12,15         # pozice 1–12 a 15 k půdorysu (pohled auto = zpět automaticky)
výkres pozice zamknout 7                   # poloha na listu zůstane i po změně modelu (= výkres vygenerované zamknout pos:7)
výkres vygenerované posun pos:7 5 -3       # ruční posun (zamčená pozice se posune i se zámkem)
výkres kusovník sloupce                    # nad | sloupce | auto; výkres kusovník list = samostatný list „Kusovník“
\`\`\`

Kontrola překryvů celého listu (\`výkres stav\` řádek „Překryvy na listu“, konec běhu ⚠ \`drawing.overlap\` s počtem a radou,
řádek D \`overlaps=\` jen po kontrole všech listů): balónek × balónek / text / tabulka / rám / geometrie pohledu, odkazová
čára × balónek, text × text (kóty × kóty), text × geometrie, tabulka × pohled, text přes rám. „Překryvy 0“ znamená, že
kontrola proběhla nad tímto listem; bez ní se píše „nezkontrolováno“. Ruční odsazení / posun vygenerované kóty
(\`výkres upravit "100" odsazení=30\`, tažení myší) přežije přepočet po změně modelu.

### Šablony hlavičky s logem (vlna 22, bod 22j)

\`výkres hlavička uložit "Firma" výchozí\` uloží razítko aktivního listu (druh, logo, firma, kreslil / kontroloval / schválil,
nepředepsané tolerance) jako pojmenovanou šablonu – do Nastavení (v CLI jen pro tento běh) i do dokumentu (jde s ním do
.mncad, sdíleného odkazu a skriptu; skript zapíše u výchozí šablony i \`výchozí\`); s poli (\`… šablona=nástrojářská logo="logo.svg" firma="…"\`) vznikne šablona z polí. \`výkres hlavička použít "Firma"\`
nebo \`výkres razítko šablona="Firma"\` dá razítko listu podle šablony, nové listy převezmou výchozí. Logo SVG zůstane vektorem
(SVG / PDF výkresu), náhled a obrys pro DXF / DWG se spočítají i bez prohlížeče; v CLI se logo bere názvem souboru ze \`--files\`.

## Soubory, obraz, výstupy a analýzy – API pro agenty

Vše z tohoto oddílu funguje bez dialogů a bez klikání; textové příkazy píší do protokolu jeden řádek ✓ / ✗ s výsledkem.

**Soubory.** \`await window.mncad.importFile({ name: "dil.step", base64 })\` (nebo \`{ name, text }\` u DXF / .mncad, nebo
objekt \`File\`) otevře soubor **stejnou cestou jako Otevřít / přetažení** – STEP (i sestavy), IGES, BREP, STL, OBJ, 3MF,
glTF/GLB, PLY, OFF, DXF, DWG, .mncad. Volba \`{ as: "auto" | "tab" | "component" | "sketch" | "draft" }\`: auto = jako Otevřít (v otevřené
sestavě se díl vloží jako komponenta), tab = samostatný dokument v záložce (prázdnou záložku použije, jinak otevře novou),
component = do otevřené sestavy (Sestava ▸ Vložit díl),
sketch = DXF do otevřené skici, jinak jako nová skica v otevřeném dílu (Skica ▸ Import DXF; DWG se převede na DXF),
draft = 2D výkres v nové záložce – **DXF a DWG se s auto / tab / draft otevřou jako 2D výkres** (jako Otevřít). Slib se splní až po
dokončení importu a výpočtu a vrátí protokol + stav dokumentu; chyba (nepodporovaný formát, prázdný soubor) = výjimka
s důvodem. Export skici do DXF: \`await window.mncad.exportFile("dxf", { sketch: "Skica 1" })\` (výchozí otevřená, jinak
poslední skica).

**Obraz.** \`await window.mncad.screenshot({ view: "iso", display: "shadedEdges", width: 1200, hints: true })\` vrátí
\`{ mime: "image/png", width, height, base64 }\` – snímek 3D okna; při otevřené skice snímek skicáře (\`target: "3d"\`
vynutí 3D okno). Volby: \`view\` iso | front | top | right | back | bottom | left | current, \`display\` shadedEdges |
shaded | wireframe | hiddenLine | xray, \`fit\`, \`hints\` (popisky F1 / E2 / V3 do obrázku), \`section: { axis: "X", offset:
25, flip: true }\` (\`null\` = bez řezu), \`explode\` (sestava 0–3), \`background\` white | current. Dočasný pohled, styl
i řez se po snímku vrátí. Funguje i bez WebGL (zjednodušený náhled). V sestavě má v řezu každá komponenta s objemem
čelo řezu (barva komponenty + šrafy, sousední díly se liší; i bez WebGL, ve snímku a ve videu studie; čelo se nevybírá),
odpověď \`řez\` to uvádí. Trvale textem:

\`\`\`
zobraz drátový            # stínovaný | hrany | skryté | průhledný (EN view wireframe, DE ansicht drahtmodell)
zobraz přizpůsobit        # EN view fit, DE ansicht einpassen
řez X 25 obráceně         # rovina kolmá na X v 25 mm; bez polohy = střed modelu (EN section x 25 flip, DE schnitt x 25 umkehren)
řez vyp                   # EN section off, DE schnitt aus
barva plochy F3 F5 #e03930   # nebo pravidlem: barva plochy horní modrá · barva plochy válcové výchozí
\`\`\`

**Výběr.** \`window.mncad.select(["F3", "E2"])\` vybere entity stejně jako klik (bez trefování, bez ohledu na filtr a na
limit popisků), v sestavě \`"comp:Čep"\` nebo \`"Čep:F3"\`, prvek historie \`"feature:Díra 1"\`; \`{ additive: true }\` přidá
k výběru. \`window.mncad.selection()\` vrátí výběr (\`{ id: "F3", kind: "face", index: 2 }\` – id jako popisky a příkaz
\`měřit\`), \`window.mncad.clearSelection()\` ho zruší (Esc). Textem v konzoli: \`vyber F3 E2\` (jako klik; id lze
oddělit i \`;\` nebo \`,\`), \`vyber F4 přidat\` (jako Ctrl + klik), \`vyber Čep:F3\` / \`vyber comp:Čep\` v sestavě,
\`vyber nic\` (zruší), samotné \`vyber\` výběr vypíše (EN \`select F3 E2 / select F4 add / select none\`, DE
\`auswählen …\`). Je-li v sestavě víc stejně pojmenovaných komponent (dvakrát vložený díl), id je pořadí komponenty:
\`#2:F3\`, \`comp:#2\` (vrací je i \`selection()\` po kliknutí, platí i pro \`měřit\`); samotný víceznačný název
skončí chybou s výčtem. Výběr převezmou **tlačítka** Zaoblit / Sražení / Skica na pásu karet a „+ aktuální výběr“
v otevřeném formuláři prvku – **textové příkazy výběr nečtou**: \`zaoblit 3\` bez \`hrany\` zaoblí všechny hrany
(je-li vybraná hrana, protokol na to upozorní řádkem „! … zpracují se všechny hrany …“).
Vybrané entity v nich zadejte čísly: \`zaoblit 3 hrany E2;E5\`, \`srazit 1 hrany E2\`, \`skořepina 2 otevřít F3\`,
\`skica plocha F3: …\` (čísla lze kombinovat s pravidlem: \`hrany E2;E5;E9 svislé\`).
**Výběr oknem** (jako tažení levým tlačítkem ve 3D okně): \`window.mncad.selectBox({ x0, y0, x1, y1, crossing?, mode? })\`
– obdélník v px 3D okna (jako \`hints()\`), zleva doprava = okno (jen celé uvnitř), zprava doleva nebo \`crossing: true\`
= křížení (i protnuté), \`mode\` replace | add | remove; podle filtru výběru (Vše = plochy dílu / komponenty sestavy),
jen viditelné entity (volba filtru „Okno vybírá i skryté“ i zakryté); vrátí výběr jako \`selection()\`.

**Výstupy.** \`await window.mncad.action("sheet.dxf")\` spustí akci rozšíření (tlačítko bez prvku v historii) a vrátí
\`{ log, files: [{ name, mime, bytes, base64 }] }\` – Rozvin → DXF / SVG, Tabulka ohybů, Kusovník řezů (+ CSV), Tabulka
svarů, Tloušťka stěn, \`sketch.dxf\`. Textem \`akce tabulka ohybů\` (EN \`action bend table\`, DE \`aktion biegetabelle\`)
– text okna jde do protokolu. \`prvek sheet.dxf\` skončí chybou s odkazem na \`akce\`.
\`await window.mncad.share({ days: 10, password, from, view: "model" | "drawing", mode: "link" | "store" | "self" })\`
vytvoří sdílený odkaz (jako tlačítko Sdílet odkazem) a vrátí \`{ url, mode, bytes, exp, message, chars, code?, note? }\`.
Výchozí je **nejkratší odkaz** \`https://mnastrojarna.cz/s#Ab3kZ9xQ2m\` (\`mode: "self"\`, \`chars\` 36; \`/en/s\`, \`/de/s\`
pro další jazyky): za \`#\` je jen desetimístný kód (\`code\`; base58 bez 0 O I l – dá se přečíst nahlas nebo opsat).
Dokument se v prohlížeči zašifruje (AES-256-GCM) a nahraje do úložiště na webu (\`/cad/share/\`); id v úložišti i klíč se
z kódu odvodí pomalým výpočtem (PBKDF2, 1 200 000 iterací, ~0,3–1 s), kód se na server nikdy neposílá. S heslem se klíč
odvodí z kódu + hesla – odkaz zůstává stejně krátký a samotný kód dokument neotevře. Platnost 1–90 dní, po ní se obsah
smaže. Odkaz, který přestal platit (vypršel, odesílatel ho zneplatnil), už pod stejným kódem nikdy neožije – ani s jiným
obsahem. Sdílení potřebuje stránku na \`https://\` (na \`http://\` prohlížeč šifrování nedovolí; stránka se sdíleným
odkazem na https přejde sama). \`mode: "store"\` = Supabase (je-li nastavené), \`"link"\` = celý dokument v odkazu
(dlouhý, bez serveru). Když úložiště neodpovídá nebo je \`days: null\`, vrátí se \`mode: "link"\` a \`note\` říká proč.
Velké modely (importovaný STEP) do 25 MB po kompresi; nad limit = výjimka s velikostí a limitem. **Tvary odkazu** (všechny
otevřete \`page.goto(url)\`): \`/s#<KÓD>\` nebo \`/cad#<KÓD>\` (kód; \`/s\` jen přesměruje na \`/cad?kod=1\` a parametr
z adresy hned zmizí), starší \`/cad#q=<id>.<klíč>\` (úložiště, klíč v odkazu – otevírá se dál), \`/cad#s=1d.…\` (dokument
v odkazu), \`/cad#r=…\` (Supabase). Znaky přilepené za odkaz (tečka, závorka, uvozovky…) nevadí. Kód lze zadat i ručně:
\`…/s\` bez kódu otevře dialog „Otevřít sdílený dokument“ (i nabídka Soubor → Otevřít sdílený dokument… a pole na úvodní
obrazovce); přijme kód i po skupinách (\`Ab3k Z9xQ 2m\`) nebo celý odkaz či zprávu s odkazem. Kód jde také dopsat za adresu
otevřeného CADu (\`…/cad#Ab3kZ9xQ2m\`). Chybný kód (jiná délka, znak 0 / O / I / l, jiná velikost písmen) dostane
vysvětlení a pole k opravě.
\`await window.mncad.compare({ name: "zakaznik.step", base64 }, { tolerance: 0.1, align: "auto", show: true })\` porovná
díl s referenčním modelem a vrátí \`{ ok, text, csv, regions: [{ n, side: "extra" | "missing", volume, center, hint }] }\`;
\`show\` zobrazí barevnou mapu odchylek (pro \`screenshot\`), \`ok\` = žádná rozdílová oblast a odchylky v toleranci.

**Nastavení.** \`window.mncad.settings()\` vrátí nastavení, \`window.mncad.setSettings({ askWhereToSave: false })\` změní jen
klíče, které mění chování a výstup: askWhereToSave, meshQuality, units, decimals, angleDecimals, defaultMaterial, author,
sheet, projection, tolerance, confirmDelete, autoExtrude, autoConstraints, snapGrid, gridStep, display, ortho, showGrid,
bg (neznámý klíč nebo hodnota = chyba). Zkratky, jazyk a úložiště API nemění.

**Formařské nástroje a analýzy textem** (díl; směr vyhození \`směr +Z | -X | vx vy vz\`, výchozí +Z):

\`\`\`
analýza úkosů směr +Z min 1 zobrazit
# ✓ Úkosy (směr vyhození +Z, min. 1°): Dostatečný 82,1 % · Malý 6,0 % · Svislá stěna 9,8 % · Podkos 2,1 % – nelze vyhodit bez posuvných čelistí
analýza tloušťky limit 2  # nejtenčí stěna a místo [x; y; z], průměr, % vzorků pod limitem
analýza křivosti          # min / max 1/mm a nejmenší poloměr
analýza zebra · analýza vyp   # „zobrazit“ zapne barevnou mapu v 3D okně (pro screenshot), „analýza vyp“ ji vypne
dělicí rovina             # Z s největším obvodem průřezu; nastaví řez v této výšce
vyhazovače Ø 6 rozteč 60 díry      # polohy; „díry“ = díry do dílu, „sestava“ = nová sestava s vyhazovači
chlazení Ø8 hloubka 15 větve 4 přesah 10 díl   # „díl“ = vrty do dílu, „sestava“ = díl + chladicí okruh
smrštění 0,5              # nebo materiálem: smrštění ABS – měřítko dutiny formy jako prvek Přesun
\`\`\`

EN: \`analyze draft direction +Z min 1 show\`, \`analyze thickness limit 2\`, \`analyze curvature\`, \`analyze off\`,
\`parting plane\`, \`ejectors d 6 spacing 60 holes|assembly\`, \`cooling d8 depth 15 rows 4 overhang 10 part|assembly\`,
\`shrinkage 0.5\`. DE: \`analyse formschräge richtung +Z min 1 anzeigen\`, \`analyse wandstärke grenze 2\`, \`analyse krümmung\`,
\`analyse aus\`, \`trennebene\`, \`auswerfer ø 6 teilung 60 bohrungen|baugruppe\`, \`kühlung ø8 tiefe 15 reihen 4 überstand 10
teil|baugruppe\`, \`schwindung 0,5\`.

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
5. **Prohlížeč bez WebGL** (headless Chrome bez grafiky, vypnutá akcelerace): místo 3D okna se kreslí **softwarový
   náhled** (\`[data-viewport-fallback="soft"]\`, plátno \`[data-soft-canvas]\`). Horní lišta hlásí neutrálně (ne jako chybu)
   **„Softwarové zobrazení – WebGL není dostupné“** (\`[data-env-status="soft"]\`, klik ukáže omezení) a vedle dál stav
   jádra a přepočtu (\`[data-core-status]\`: \`loading|ready|busy|stale|error\`) – omezení prostředí není chyba modelu.
   Náhled nekreslí: perspektivu (je pravoúhlý), gizmo přesunu, skici a pomocné roviny v modelu, mřížku, analýzy ploch
   (zebra, úkosy, tloušťka, křivost), barevnou mapu odchylek, duchy porovnání, grafiku měření a stopu bodu pohybové studie,
   hřebeny křivosti / řídicí body ploch třídy A a průhlednost – čísla dávají text a panely (\`analýza …\`, \`měřit\`,
   \`porovnat\`, \`pohyb stav\`); seznam je pod „Proč nevidím 3D?“ (\`[data-soft-limit]\`, cad/soft-view.ts).
   Výběr v něm funguje stejně jako ve 3D okně: **klik** vybere plochu (nejbližší ke kameře), hranu (do ~6 px, jen
   viditelnou) nebo vrchol (do ~7 px), **Ctrl / Shift + klik** přidá či odebere, platí filtr výběru (stavový řádek),
   kliknuté hrany a plochy berou formuláře prvků (Zaoblit, Skořepina, „+ aktuální výběr“), skica na ploše, měření,
   řez rovinou plochy i vazby sestav (plocha komponenty). Najetí entitu zvýrazní oranžově, vybraná je červená, po
   kliknutí se objeví rychlá lišta příkazů. Popisky (\`window.mncad.hints(true)\`) mají v náhledu celočíselné souřadnice
   (vůči plátnu \`[data-soft-canvas]\`) a leží jen tam, kde klik – i o 1 px vedle (zaokrouhlení) – vybere právě jejich entitu
   a kam klik opravdu dopadne na plátno (ne pod upozorněním náhledu, panelem vlastností vybrané entity ani lištou);
   entity bez takového místa (zakryté, příliš malé) popisek nemají. \`clickHint\` funguje. Náhled je pravoúhlý (bez
   perspektivy), otáčí se tažením, posouvá Shift + tažením, pohledy jsou tlačítka nahoře (\`[data-soft-view="top"]\`).
   Bez myši: \`vyber F3 E2\` nebo \`window.mncad.select(["F3", "E2"])\`.
   **Plné 3D v automatizovaném Chromu:** WebGL vypne přepínač \`--disable-software-rasterizer\` (a \`--disable-webgl\`,
   \`--disable-3d-apis\`) – ten nepoužívejte a přidejte \`--enable-unsafe-swiftshader\` (Playwright:
   \`chromium.launch({ args: ["--enable-unsafe-swiftshader"] })\`, případně \`--use-angle=swiftshader\`); WebGL pak
   běží softwarově přes SwiftShader. Ověřeno s Playwright Chromium 153 (headless): bez přepínačů i s nimi WebGL 2 přes
   SwiftShader; s \`--disable-software-rasterizer\` WebGL chybí i s \`--enable-unsafe-swiftshader\`. Novější Chrome bez
   GPU vyžaduje pro SwiftShader právě \`--enable-unsafe-swiftshader\`. Zda 3D běží:
   \`!!document.createElement("canvas").getContext("webgl2")\`.

## Materiál, výkres a export – co je dobré vědět

- \`materiál ocel|nerez|hliník|mosaz|měď|plast|titan|litina|bronz\` nastaví **třídu materiálu (hustotu)** pro hmotnost.
  Jakýkoli jiný text se uloží jako **označení materiálu do razítka**. Pozná-li se z označení třída (\`materiál ČSN 11 423\`,
  \`materiál 1.0503\`, \`S235JR\`, \`C45\` → ocel; \`EN AW-6082\` → hliník; \`1.4301\` → nerez; \`CuZn39Pb3\` → mosaz),
  nastaví se i hustota podle ní: \`✓ materiál „ČSN 11 423“ = označení do razítka, třída „Ocel“ (7.85 g/cm³)\` (ℹ
  \`material.class\`). Nepozná-li se (\`materiál XY-123\`), hustota zůstává podle dosavadní třídy a protokol to napíše
  (\`→ materiál „XY-123“ uložen jako označení do razítka …\` + ⚠ \`material.density-assumed\` – nikdy ✓). Totéž pravidlo a tytéž
  kódy platí pro \`sestava komponenta "X" materiál "…"\` (\`→ komponenta „X“: materiál „XY-123“ uložen jako označení …\` + ⚠; ✓ jen
  pro ostatní změny téhož příkazu) i pro pole „Označení materiálu (razítko)“ a pole Materiál v razítku výkresu (ℹ / ⚠ pod polem). V JSON jsou to pole \`material\` (id třídy) a \`materialName\`.
- Výkres **nedoplňuje žádné výrobní požadavky sám**: nepředepsané tolerance (např. ISO 2768-mK) a opracování hran
  (např. srazit 0,5×45°) se na list dostanou jen vyplněním polí v razítku (každé zvlášť, lze smazat). Výchozí text je
  jen „Rozměry v mm“.
- Závitové díry (\`díra závit M6 hloubka 12\`) se na výkrese kótují popisem \`M6 ↧12\` (s počtem), ne jako Ø jádra; vrták
  jiný než tabulkový (\`jádro\`, zadaný průměr) má vlastní řádek \`Ø6,647 ↧12\`, ploché dno poznámku \`(ploché dno)\`.
- Nové výkresy mají **Chytré kóty** (kótování podle prvků, viz další kapitola). Tlačítko **Kontrola kót** ve výkresu
  porovná kóty na listu s VÝSLEDNÝM dílem a vypíše, co chybí; totéž je v \`výkres stav\` a podrobně \`výkres kontrola kót\`.
  Tolerance (H8, ±0,1) se píší příkazem \`výkres tolerance\` nebo u kóty do pole „přípona“.
- **Kontrola kót pro výrobu** (vlna 22, bod 18): řádek \`Kontrola kót: velikosti a/b · polohy c/d – chybí: … · pomocná tělesa
  (nekótují se): … · tolerance … · nezkontrolováno: …\` – nikdy „kompletní“. Očekává se velikost **i poloha** děr (po
  skupinách stejných děr s počtem \`2×\` – jedna \`Ø8\` nesplní dvě díry), odebraných kvádrů a válců (kapsa, okno, drážka) a
  obrysů skic na základních rovinách; kóta se k prvku přiřadí **podle geometrie** (konce kóty na souřadnici prvku, osa
  souměrnosti středem prvku, tabulka děr), hloubka díry jen z popisu té díry (\`↧10\`) nebo z kóty na díře od vstupu.
  Těleso spotřebované \`sloučit … odebrat\` (nástroj) se nekótuje – kontroluje se výsledný tvar (okno 30 × 20 a jeho
  poloha, ne výška nástroje). Chybí-li něco: ⚠ \`drawing.dims-incomplete\` ve \`výkres stav\`, na konci běhu a při exportu.
  \`výkres doplnit kóty [polohy|velikosti|vše|3 5]\` přidá navržené kóty (od hrany dílu / základny; v GUI „Přidat kótu“).
- **Funkční prvky a základny** v modelu: \`funkční F7 H7\` (plocha, změří se), \`funkční "Díra 1" ±0,02\` (prvek),
  \`základna A F3\` / \`funkční základna A F3\` (rovinná plocha), \`funkční\` = výpis, \`funkční zrušit …\` (EN \`functional\`,
  \`functional datum A F3\`, DE \`funktional\`, \`bezug A F3\`; GUI: pravé tlačítko na plochu → Označit jako funkční / základnu).
  Kontrola kót u funkčního prvku chce velikost, polohu **od základny** na téže ose a toleranci na kótě (předepsaná musí
  sedět) – bez tolerance ⚠ \`drawing.tolerance-missing\`; přesná tolerance (≤ IT7 / pásmo ≤ 0,05) na rozměru, který funkční
  není = ℹ \`drawing.tol-nonfunctional\` (přetolerování). Bez vyznačení: „tolerance neověřeny (funkční prvky nevyznačeny)“.
- Ukládání a export z **konzole** (\`uložit\`, \`export step\`, \`výkres export pdf\`, \`sdílet\`) se nikdy neptají – soubor se
  rovnou stáhne. Tlačítka se člověka ptají na místo a název (systémový dialog), v prohlížeči ovládaném automatizací
  (\`navigator.webdriver\`, \`?agent=1\`) stahují rovnou; trvale to zapne Nastavení → Soubory (přímé stažení). Pro skripty
  vrací \`window.mncad.exportFile()\` soubor jako base64.

## Výkres a kóty – postup a pravidla pro AI

Výkres se kótuje **podle prvků modelu** (Chytré kóty), ne podle každé promítnuté čáry. Každý funkční rozměr je na listu
právě jednou, kóty stojí v úhledných řadách mimo obrys a díry mají jeden popis se značkami. Agent kóty **nepíše ručně**
– nechá je vygenerovat příkazem \`kótovat\`, zkontroluje je příkazem \`výkres stav\` a doplní jen tolerance.

### Postup (vždy v tomto pořadí)

1. **Model** textovými příkazy, \`stav\` → Geometrie: platná, žádné ✗ / ⚠. Díry dělejte příkazem \`díra\` (ne vysunutím
   kružnic) – jen tak výkres zná závit, hloubku, zahloubení a počet děr.
2. **List a pohledy:** \`výkres A3 na šířku pohledy přední,horní,iso\`. Pohledy volte podle dílu:
   rotační díl s osou X → \`přední,levý\` (osa vodorovně, čelní pohled pro díry v čele); díry shora → \`horní\`;
   díry zespodu → \`spodní\`; vnitřní tvary (vrtání, osazení uvnitř) → \`řez XZ odsazení 0\` (řez osou). Odsazení řezu se
   měří **stejně jako u skici** – podél normály roviny skici: \`řez XZ odsazení 57\` je rovina Y = −57 (jako \`skica XZ odsazení
   57\`), \`řez XY odsazení 10\` je Z = 10, \`řez YZ odsazení 10\` je X = 10. Protokol to ukáže („řez XZ odsazení 57 (rovina
   Y = -57)“); rovina mimo těleso = řádek ✗ s rozsahem odsazení, které těleso protne (rozsah je otevřený – rovina přímo na
   ploše tělesa řez nedá; hláška dá i příklad uvnitř). (Výkresy uložené před touto změnou mají v odsazení souřadnici osy
   a staví se beze změny – \`výkres stav\` je označí „starší řez uložený souřadnicí Y = -57“ a ukáže odsazení v dnešní
   konvenci i hotový příkaz \`výkres řez XZ odsazení 57\`; kopírujte odsazení z něj.) Starší skripty psaly číslo jako
   souřadnici osy (\`řez XZ odsazení -57\` = Y = −57): když takové číslo v dnešním výkladu těleso mine a jako souřadnice ho
   protne, řez se vyloží postaru, uloží v dnešní konvenci a protokol to řekne řádkem \`⚠ řez XZ odsazení -57: … dnes pište:
   výkres řez XZ odsazení 57\`. Číslo platné v dnešním výkladu se nikdy nepřekládá. Řádek má kód \`drawing.section-legacy\`
   (automatický výklad vstupu) – v přísném režimu je to ✗ a běh zastaví, proto ve skriptech pište odsazení vždy v dnešní konvenci.
3. **Kóty:** \`kótovat\` (= chytře, řetězově) nebo \`kótovat od základny\`. Protokol vypíše počet kót podle pohledů
   a co se nevešlo. Rozměry, které jsou funkční (budou tolerované), řekněte hned: \`kótovat funkční 26,5 74,175\` – ty nikdy
   nebudou pomocnou kótou v závorce (seznam i se středníkem jako v poli formuláře: \`kótovat funkční 50; 30\`). Desky
   s mnoha dírami: od 12 poloh (různých souřadnic x a y středů) přejdou polohy děr samy na **souřadnicové kóty** od levého
   dolního rohu (0 v rohu, hodnoty v jedné řadě; více druhů děr v pohledu = značka skupiny A, B … u každé díry i v popisu
   „11× Ø8 skrz (A)“), a když se nevejdou ani ty, na **tabulku děr**; ručně \`kótovat díry tabulka|souřadnicově|řetězově\`.
   Tabulka děr je na listu jedna – v pohledu, kde jsou díry vidět (i levý / pravý / zadní); jsou-li díry ve dvou pohledech,
   dostane ji pohled s víc dírami a druhý souřadnicové kóty. Jedna poloha = jeden řádek („Ø8 ⌴Ø14“, závit „M8“), přes
   16 řádků dva sloupce; překryje-li tabulka na plném listu pohled, protokol to řekne (⚠ → větší list / měřítko auto).
   \`kótovat díry souřadnicově|řetězově\` tabulku děr listu vypne (polohy by byly dvakrát), \`kótovat díry tabulka\` ji zapne.
4. **Kontrola:** \`výkres stav\` – musí platit „Duplicity: žádné“ a „Kontrola kót: velikosti n/n · polohy m/m“ bez „chybí“
   (a bez ⚠ \`drawing.dims-incomplete\`); i pak kontrola zná jen rozměry z historie a vyznačené funkční prvky – funkční
   plochy a základny vyznačte (\`funkční …\`, \`základna …\`) a tolerance zkontrolujte (\`výkres kontrola kót\`). Řádek
   „Vynecháno“ říká proč (např. „zapněte pohled spodní“, „zapněte řez osou“, „nevešlo se“ → \`výkres A2\` nebo jiné
   měřítko) – opravte a spusťte \`kótovat\` znovu. Každý chybějící rozměr Kontroly kót má svůj řádek „Vynecháno“:
   šikmá díra / skica ve šikmé rovině → „kótujte v pomocném pohledu … (\`výkres pohled pomocný směr dx dy dz\`)“, obecný
   obrys skici (lomená čára, oblouky, elipsa) a rotační prvek hranolového dílu → ruční kóty (\`výkres kóta …\`). Díra
   zespodu bez pohledu spodní se okótuje na skrytých kružnicích pohledu shora s poznámkou „ze spodní strany“ (čistší je
   zapnout pohled spodní). Kvádry přidané / odebrané k dílu (osazení, okna) dostanou rozměry a polohu samy; rozměr
   základního kvádru, který plyne z celkového rozměru a osazení, je pomocný „(15)“.
5. **Tolerance** jen na funkční rozměry: \`výkres tolerance Ø30 h6\`, \`výkres tolerance 42 ±0,05\`,
   \`výkres tolerance M20 6g\`, \`výkres tolerance Ø50 H7\`. Kóta se najde **číselnou hodnotou modelu** (±0,000001 – kóty
   nesou až 3 desetinná místa modelu, \`74,175\`, ne zaokrouhlené \`74,18\`), druhem (Ø, M, R) nebo id z \`výkres stav\`
   (\`výkres tolerance a12 -0,005\`); nejednoznačná → chyba se seznamem id, zúžit jde i pohledem (\`… pohled horní\`).
   **Pomocná kóta v závorce** („(50)“ – nejdelší článek řetězu) se netoleruje (ISO 129-1): tolerance na ní rozměr udělá
   **funkčním** – řetěz se přepočte a pomocnou kótou se stane jiný článek (protokol ho jmenuje). Jsou-li funkční všechny
   články i celková délka (přeurčený řetěz), pomocnou kótou bude funkční rozměr **bez tolerance** (protokol to řekne);
   mají-li toleranci všechny ostatní, je to ✗ s radou (jeden rozměr musí zůstat pomocný). Ruční náhradní kóta starších
   dokumentů se stejnou hodnotou jako pomocná kóta se při převodu odstraní (protokol: „odstraněna ruční náhradní kóta …“).
   Desetinnou tečku v toleranci (\`-0.005\` ze skriptu) zapíše český / německý list čárkou. Tolerance zůstane u kóty
   i po změně modelu, dokud kóta existuje (průměr podle hodnoty, délka podle polohy čel); zmizí-li kóta, tolerance se
   ztratí – zkontrolujte \`výkres stav\`. \`výkres kontrola tolerancí\` vypíše funkční rozměry, které toleranci nemají;
   tolerované kóty předlohy kontroluje až po připojení předlohy (balík předlohy) – bez ní hlavička řekne „předloha není
   připojena – kóty předlohy se nekontrolují“.
6. **Razítko (vše klíčové sem, ne do poznámek):** \`výkres nepředepsané ISO 2768-mK\`, \`výkres hrany ISO 13715 -0,3\`,
   \`výkres drsnost Ra 3,2\`, \`výkres razítko tepelné="kalit a popustit" tvrdost="58–60 HRC" povrch="černit"\` – viz
   „Výkres strojařsky“ níže (nad razítkem nejvýš 5 krátkých řádků, popis plochy odkazem z modelu).
7. \`výkres stav\` naposledy, pak export (výkres → PDF / DXF / DWG / SVG).

### Pravidla Chytrých kót (ČSN EN ISO 129-1) – kontrolní seznam

- Každý funkční rozměr **jednou** – žádná kóta dvakrát (ani v jiném pohledu), **žádný uzavřený řetězec**: řetěz délek
  + celková délka → nejdelší článek, který není funkční (\`kótovat … funkční …\`), je pomocná kóta v závorce „(50)“;
  jsou-li funkční všechny články, je pomocná celková délka (je-li funkční i ta, funkční rozměr bez tolerance).
- Prvek se kótuje v pohledu, kde je vidět ve skutečném tvaru; **nikdy na skryté (čárkované) hraně** – vnitřní tvary v řezu
  (jediná výjimka: díra zespodu, když list nemá pohled spodní – popis na skryté kružnici nese „ze spodní strany“).
- **Rotační díl** (osa vodorovně): průměry osazení naskládané na straně (nejmenší nejblíž dílu, rozestup 7 mm), délky
  osazení **řetězově na jedné čáře**, celková délka ve vnější řadě (\`kótovat od základny\` = všechny délky od jednoho čela);
  zápich šířkou (v řetězu) a Ø popisem; sražení „1,5×45°“ a zaoblení „R1“ jednou s počtem „2×“; vnější závit
  „M20×1,5“ místo Ø a zvlášť délka závitu. Příčná díra: poloha podél osy **od bližšího čela**, radiálně od osy.
- Další modely na listu (komponenta, vložený soubor) se Chytrými kótami nekótují – kóty patří jen pohledům hlavního dílu.
- **Hranolový díl:** celkové rozměry délka × šířka × výška jednou; polohy děr od základních hran (levá / spodní) v pohledu,
  kde jsou díry kružnicemi; souměrně rozmístěné díry roztečí od osy souměrnosti; kruhové pole roztečnou kružnicí „Ø120“
  na osové kružnici + „rovnoměrně“ (nebo úhel). **Mnoho děr** (od 12 poloh, nebo když se kóty od hran nevejdou):
  souřadnicové kóty od levého dolního rohu obrysu – „0“ v rohu, ke každé poloze vynášecí čára a hodnota na jejím konci
  (blízké hodnoty se rozestoupí zalomením), poslední hodnota je celkový rozměr; nevejdou-li se, tabulka děr (značka,
  X, Y od téhož rohu, Ø) – nikdy „! vynecháno“ u poloh děr.
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
\`1,5×45°\`, \`2× R1\`. Celkem 14 kót, žádná duplicita, Kontrola kót bez „chybí“ (tolerance neověřeny, dokud nejsou funkční prvky vyznačené).

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

### Příklad F – funkční rozměry, tolerance hodnotou a kontrola tolerancí

\`\`\`
nový díl Hřídel
skica XZ: čára 0 0 0 10 30 10 30 8,5 33 8,5 33 15 83 15 83 20 98 20 98 12,5 140 12,5 140 0 uzavřít
rotovat osa X
výkres A3 na šířku pohledy přední,levý,iso
kótovat funkční 50 30
výkres tolerance 50 -0,1
výkres kontrola tolerancí
\`\`\`

Řetěz délek je \`30\` · \`3\` · \`50-0,1\` · \`15\` · \`(42)\` – funkční \`50\` už není v závorce, pomocnou kótou je nejdelší
nefunkční článek \`(42)\`. Kontrola tolerancí vypíše \`⚠ kontrola tolerancí: bez tolerance 1 z 2 funkčních rozměrů …\` a řádek
\`⚠ 30 (funkční): kóta bez tolerance a6 30 (přední) – výkres tolerance a6 …\`. Deska s 20 a více nepravidelnými dírami
dostane po \`kótovat\` souřadnicové kóty (protokol: „· polohy děr souřadnicově (horní)“), \`kótovat díry tabulka\` tabulku děr.

### Výkres textem: listy, značky, kóty, export

Vše, co jde ve výkresovém prostředí myší, jde i textem (anglicky \`drawing …\`, německy \`zeichnung …\`). Příkazy
výkresu pracují s **aktivním listem**: \`výkres list 2\` / \`výkres list "Detail"\` ho přepne (a výkres se otevře na
něm), \`výkres list nový "Detail"\` založí nový list a přepne na něj; \`výkres list A3\` dál znamená formát listu.
U více listů protokol u každého ✓ připíše, se kterým listem příkaz pracoval. Popisek značky se sám umístí na první
volné místo u cíle; když se nová kóta nebo značka přesto překrývá s jiným textem nebo přesahuje rámeček listu, protokol
to ohlásí řádkem \`!\` s radou (\`výkres upravit a7 odsazení=…\`, \`posun="dx dy"\`).

**Souřadnice.** \`výkres stav\` vypíše řádek „Souřadnice“: pro každý pohled rozsah v **mm modelu v rovině pohledu**
(y nahoru; přední = X, Z · horní = X, Y · levý = −Y, Z) a jeho polohu na listu, např.
\`přední (x = X, y = Z): x −50…50, y 0…20 mm · 1:1 · na listu x 40…140, y 237…257\`. V těchto souřadnicích se zadávají
body značek a ruční kóty (\`pohled přední v 10 20\`); bod se přichytí ke konci hrany, hraně nebo kružnici jako myš.
Místo na listu (text, umístění detailu) je v **mm listu od levého dolního rohu** (jako v DXF). Řádek „Id“ dává krátká
id kót a značek (\`a1 100 (přední) · a2 Ø40 (horní) · …\`) pro \`výkres upravit / smazat\` a \`značka … na a2\`; po smazání se
id dalších poznámek posunou – po změně si stav vypište znovu.

| Příkaz | Význam |
| --- | --- |
| \`výkres razítko název="…" číslo="MN-1" kreslil="AI" revize=A datum="13.11.2026" materiál="ČSN 11 523"\` | razítko listu (+ \`nepředepsané=\`, \`hrany=\`, \`poznámka=\`); číslo, kreslil a revize se uloží i do dokumentu |
| \`výkres razítko kontroloval="…" schválil="…" zákazník="…" projekt="…" polotovar="…" počet=4 tepelné="kalit a popustit" tvrdost="58–60 HRC" povrch="černit" drsnost="Ra 3,2" úhly="±0°30′" sražení="±0,2" firma="…"\` | další pole razítka (en checked/approved/customer/project/stock/quantity/heat/hardness/surface/roughness/angles/chamfers/company, de geprüft/genehmigt/kunde/projekt/rohteil/menge/wärmebehandlung/härte/oberflächenbehandlung/rauheit/winkel/fasen/firma); technické údaje (tepelné zpracování, tvrdost, povrch, hrany, nepředepsané tolerance, drsnost) jsou vždy v buňkách razítka – ISO 7200 a kompaktní šablona dostanou technický pás razítka (+10 mm); ostatní pole, která šablona nemá, se vypíšou v patičce nad razítkem |
| \`výkres razítko šablona=iso7200|kompaktní|nástrojářská\` | šablona razítka listu: ISO 7200 (výchozí, 180×38), kompaktní (180×27), nástrojářská (180×64, všechna pole); výchozí pro nové listy v Nastavení → Výkres |
| \`výkres razítko logo="firma.png"\` · \`… logo="data:image/png;base64,…"\` · \`… logo=ne\` | logo do razítka: soubor připojený v konzoli (**Připojit soubor…**, název bez cesty; název bez přípony, který odpovídá více souborům, vrátí ✗ se seznamem) nebo data URL PNG/JPEG/SVG, v CLI soubor ze složky \`--files\`; zmenší se na nejvýš 600×300 px; SVG/PDF ho vloží jako obrázek (logo SVG jako vektor), DXF/DWG jako vyplněný obrys (SOLID) |
| \`výkres nepředepsané ISO 2768-mK\` · \`… mK\` · \`… f H\` · \`… desetinná\` · \`… desetinná ±0,1 ±0,1 ±0,01 ±0,005\` · \`… X. ±0,1 / X.X ±0,1 / X.XX ±0,01 / X.XXX ±0,005\` · \`… X.XX=±0,02\` · \`… ne\` | nepředepsané tolerance: třída ISO 2768-1 (f/m/c/v, platí i pro úhly a sražení) + ISO 2768-2 (H/K/L), nebo tabulka podle počtu desetinných míst (X. / X.X / X.XX / X.XXX; hodnoty oddělené mezerou, „/“, „·“ nebo „;“, s popisky i bez – i jak je CAD sám vypisuje); \`ne\` = zrušit. Export výkresu **dílu** bez nich vrátí ⚠ „Výkres nemá nepředepsané tolerance …“ |
| \`výkres revize B "Přidána díra Ø8" [datum …] [kreslil …]\` · \`výkres revize smazat B\` | tabulka revizí; poslední revize se zapíše do razítka |
| \`výkres vydat [B] ["popis změny"] [datum …] [vše]\` · \`výkres vydat zrušit [vše]\` (\`drawing issue\` · \`zeichnung freigeben\`) | **vydání listu** (vlna 22, bod 20): písmeno revize + revize modelu \`r·a1b2c3\` + datum; chybí-li revize v tabulce, přidá se („první vydání“ / „změna modelu r·… → r·…“); bez písmena = revize z razítka, u zastaralého vydaného listu další písmeno. Po změně modelu – i jen čísla, materiálu, názvu nebo druhu položky dílu (údaje razítka a kusovníku; „model je teď r·… se změněnými údaji dílu“, STEP/STL tím nezastará) – je vydaný list **zastaralý**: \`výkres stav\` („⚠ Vydání: rev. A z modelu r·… – model je teď r·…“), \`stav\`, konec běhu, řádek D (\`stale=drawing\`) a GUI (odznak na záložce listu, pruh „Vydat novou revizi“) to hlásí ⚠ \`drawing.stale\`; export listu se starým písmenem po změně = ⚠ (přísný režim ✗ a soubor se nezapíše). Vydání je rozhodnutí člověka – export ani \`přepočítat vše\` list nevydává. Patička razítka nese „Model r·…“, PDF předmět „Model r·… · rev. A“, DXF komentář 999, DWG vlastnosti souboru (předmět, klíčová slova, číslo revize; R2004 a novější) |
| \`výkres otočení 0|90|180|270\` · \`výkres řez XZ odsazení 0 poloviční|celý\` · \`výkres kusovník ano|ne\` · \`výkres balónky ano|ne\` | otočení hlavního pohledu, poloviční řez, kusovník nad razítkem a pozice komponent (sestava) |
| \`výkres pružiny zjednodušeně|plně\` | pružiny se na výkrese kreslí zjednodušeně podle ISO 2162-1: obrys vinutí (vnější a vnitřní průměr přes volnou délku), osa a čerchované osy drátu na středním průměru jen tam, kde je obrys vidět; v řezu se obal nešrafuje (jen obrys a osy drátu). Pružina = prvek Pružina nebo Tažení po šroubovici s profilem Kruh, který je **prvním materiálem svého tělesa** (normálie pružin, \`pružina …\` jako první prvek dílu, \`… nové těleso "Pružina"\`, i jako komponenty sestavy); těleso pak smí už jen odebírat (zabroušené konce) nebo přidat jiný tvar (očka, ramena). Šroubovice přidaná na existující těleso (chod šneku, oblý závit na hřídeli, pružina přidaná do pouzdra) se kreslí vždy přesně, stejně jako šroubovicová drážka (odebrání) – samostatnou pružinu proto zakládejte jako \`nové těleso\`. Chytré kóty čtou skutečný tvar (obal pružiny nekótují jako díru). \`plně\` = skutečná šroubovice – skrytí hran trvá u každé pružiny desítky sekund (A1 sestava se 4 pružinami: minuty). Stav listu (\`výkres stav\`) uvádí ve Volbách, jak se pružiny kreslí, jen když list nějakou pružinu má. |
| \`kótovat základní\` | kóty „Auto + Ø“ zapečené do pohledů (jen pomocný základ – místo Chytrých kót) |
| \`výkres značka poznámka "Lapovat" pohled přední v 20 12\` | krátká poznámka (≤ 40 znaků, heslovitě) s odkazovou čarou na hranu pohledu – raději \`poznámka F7 "Lapovat"\` v modelu (výkres ji převezme; odkaz jen na výkrese = ⚠ \`drawing.note-not-model\`); na kótu nebo volný bod = ✗ \`drawing.note-free-leader\`; tepelné zpracování / tvrdost / povrch u odkazu = ✗ (razítko nebo \`úprava F7 …\`) |
| \`výkres značka drsnost Ra 1,6 na Ø40\` · \`… drsnost Ra 0,8 pohled přední v 0 20\` | značka drsnosti na kótu nebo na povrch (bod pohledu) |
| \`výkres značka tolerance kolmost 0,02 A na Ø40\` | rámeček ISO 1101: přímost, rovinnost, kruhovitost, válcovitost, profil, rovnoběžnost, kolmost, sklon, poloha, souosost, souměrnost, házení (+ hodnota, základna) |
| \`výkres značka základna A pohled horní v -50 0\` | základna (bez písmene další volné) |
| \`výkres značka text "Odmastit" v 20 30 [výška 3,5]\` | volný text na hlavním listu (mm listu, písmo ≤ 5 mm) – nejvýš 5 krátkých heslovitých řádků v celém dokumentu; údaj razítka v textu se přesune do razítka (ℹ \`drawing.note-to-title\`), věta / překročení = ✗ |
| \`… posun dx dy\` | posun popisku značky od cíle [mm listu] |
| \`výkres kóta vodorovně|svisle|šikmo pohled přední x1 y1 x2 y2 [odsazení 10] [text "…"]\` | ruční kóta dvou bodů; konce jedné hrany = kóta hrany (sleduje změny modelu); kladné odsazení = ven z pohledu |
| \`výkres kóta průměr|poloměr pohled horní střed x y [r R] [úhel 45]\` · \`výkres kóta úhel pohled přední x1 y1 x2 y2 x3 y3 x4 y4\` | kóta kružnice (dohledá se podle středu a poloměru) a úhlu dvou hran (mezi směry 1→2 a 3→4) |
| \`výkres upravit a3 odsazení=8 přípona="H7" text="(20)"\` · \`výkres upravit a5 posun="5 -3"\` | úprava kóty / značky (také \`hodnota=\`, \`základna=\`, \`výška=\`; \`posun\` přesune popisek značky v mm listu); cíl id nebo popisek |
| \`výkres smazat a3 a5\` · \`výkres smazat "Ra 1,6"\` · \`výkres smazat vlastní\` · \`výkres smazat vše\` | smazání; smazané vygenerované kóty se při přegenerování nevrátí |
| \`výkres detail přední v 45 10 poloměr 5 [měřítko 4:1] [umístit 330 200]\` · \`výkres detail A měřítko 5:1\` · \`výkres detail smazat A\` | detailní pohled (střed v mm modelu, umístění středu v mm listu od levého dolního rohu; \`umístit 330 97 odshora\` = od levého horního rohu – nezávisí na výšce listu, která se u automatického formátu mění s dalšími pohledy; en \`from-top\`, de \`von-oben\`) |
| \`výkres model "Hřídel" [pohled horní] [měřítko 1:2]\` · \`výkres model smazat "Hřídel"\` | další model na listu: komponenta sestavy nebo otevřená záložka |
| \`výkres stav list 2\` · \`výkres stav vše\` | stav zvoleného / všech listů (přehled listů, souřadnice, id, razítko, revize) |

**Razítko textem – ověření.** \`výkres razítko\` (bez polí) i \`výkres stav\` vypíší kromě řádku „Razítko: …“ také
\`Šablona razítka: … · promítání ISO E – značka ISO 5456-2 (1. kvadrant, kružnice vpravo) · logo „firma.png“ 240×80 px\`,
\`Další pole razítka: …\` (u pole mimo šablonu „(v patičce)“), \`Nepředepsané tolerance: ISO 2768-mK (…)\` nebo
\`Nepředepsané tolerance: nezadané – export výkresu dílu je ohlásí …\` (samotný export pak vrátí ⚠) a \`Razítko bez zkracování textu: Název 2 řádky 3,1 mm · Kreslil písmo 2,6 mm\`
(dlouhé texty se zmenší do 2 mm a zalomí uvnitř buňky – nic se nezkracuje; pod 2 mm řádek ⚠ s radou; platí i pro materiál
z dokumentu). Revize v razítku je poslední revize z tabulky revizí, když pole revize není vyplněné – řádek „Razítko: …“ ji pak
uvede jako „revize B (z tabulky revizí)“; revize zadaná v poli, která v tabulce není, dá ⚠ (při zadání !). Promítání se kreslí normalizovanou značkou (komolý kužel
a kružnice), ne textem „ISO E“.

**Export bez dialogu** (JavaScript API): \`await window.mncad.exportDrawing("pdf" | "dxf" | "dwg" | "svg" | "csv" | "png",
{ sheet: 2, dwgVersion: "R2018", width: 2000 })\` vrátí \`{ name, mime, bytes, base64, width?, height?, warnings? }\` –
\`{ sheet: "all" }\` = všechny listy aktivního výkresu (PDF jedna stránka na list, ostatní formáty ZIP, výsledek navíc
\`sheets\` a \`files\`; DXF R12 rozvržení nezná a DWG se zapisuje do modelového prostoru, proto soubor na list) –
stejný výpočet jako tlačítka ve výkresu (DWG R2000–R2018, DXF R12, kusovník CSV jen u sestavy). **PNG** je náhled listu
(rastr, výchozí šířka 2000 px) – agent si tak výkres prohlédne. \`await window.mncad.drawingStatus({ sheet: "all" })\` = \`výkres stav vše\`.

### Příklad D – druhý list, značky, razítko a export

\`\`\`
nový díl Příruba
válec 100 20
díra 40 skrz v 0 0 20
výkres A3 na šířku pohledy přední,horní,iso
kótovat
výkres značka drsnost Ra 1,6 na Ø40
výkres značka tolerance kolmost 0,02 A na Ø40
výkres značka základna A pohled přední v 0 0
výkres razítko číslo="MN-2026-001" kreslil="AI" materiál="ČSN 11 523"
výkres revize A "první vydání"
výkres list nový "Detail"
výkres pohledy přední měřítko 2:1
výkres detail přední v 45 10 poloměr 5 měřítko 5:1
výkres stav vše
\`\`\`

Pak \`window.mncad.exportDrawing("pdf", { sheet: "all" })\` (oba listy v jednom PDF) a \`exportDrawing("png", { sheet: 2 })\` pro
kontrolu očima; totéž textem \`výkres export pdf vše\`. Druhý výkres téhož dílu (např. montážní) založí \`výkres nový "Montážní"\` –
má vlastní listy a \`výkres výkresy 1\` vrátí práci na první výkres.

### Výkres strojařsky – razítko, odkazy, nejvýš 5 řádků (pravidlo pro každého agenta)

Majitel: „Musí to být strojařský, ne slohové cvičení.“ Platí pro **každou textovou cestu** – jazyk mncad v konzoli, CLI,
HTTP, \`window.mncad.run\`, JSON dokument ve skriptu / \`setDocument\`, 2D výkres \`2d …\`, i výchozí list \`--formats\`.
Člověk v GUI výkresu (nástroje Text / Poznámka / Kóta, panel Razítko, tabulka revizí, příkazový řádek 2D editoru) omezen
není – dostane jen nenápadnou radu.

**Původ textu:** co agent v tomto běhu vytvoří nebo změní (příkaz, JSON dokument na řádku, \`setDocument\`) = **agent** →
porušení ✗ a export listu se odmítne. Text ze souboru otevřeného z disku (\`otevřít\` uloženého .mncad / .json, CLI
\`--open\`, HTTP open), který běh nezměnil = **načtený** → nikdy ✗ a export neblokuje (archivní výkres člověka jde agentem
exportovat), ale list dostane ⚠ \`drawing.notes-loaded\` místo ✓. Jakmile agent načtený text upraví, je jeho (✗).
\`"by":"user"\` v souboru nekoupí víc než ⚠. Text, který soubor nese jako agentův (\`"by":"agent"\` – soubor uložil agent,
i v běhu, který skončil ✗), zůstane agentův: \`uložit\` + \`otevřít\` ani \`--open\` v dalším běhu porušení nevyperou.

1. **Klíčové údaje vždy v razítku:** materiál, tepelné zpracování, tvrdost, povrchová úprava, hrany (ISO 13715),
   nepředepsané tolerance (ISO 2768 / ISO 22081), obecná drsnost – \`výkres razítko tepelné="…" tvrdost="58–60 HRC"
   povrch="…" hrany="…" drsnost="Ra 3,2"\`, \`výkres nepředepsané ISO 2768-mK\`. Hodnota buňky heslovitě (≤ 32 znaků).
   Poznámka, která je takovým údajem („Kalit 58 HRC“, „HRC 58-62“, „Ra=1,6“, „N7“, „C0,5“, „Fazeta 0,5“, „RAL 9005“, „KTL“,
   „Brunýrovat“, „Tol. ±0,1“, „Volné míry ±0,2“, „DIN ISO 2768 mittel“, „IT12“, „Mat. 11 523“, „Ck45“, „AISI 304“, „Hardox
   450“, „PA6“, „CHT 0,8 mm“, „Rohy zaoblit R1“, „Vanadis 23“, „Böhler K110“, „X5CrNi18-10“, „DIN 7168 m“, „HV 650“ →
   „650 HV“, „Black oxide“), se do razítka přesune sama (ℹ \`drawing.note-to-title\`) – ve stejném tvaru,
   jaký přijme \`výkres razítko\` (tvrdost „58-62 HRC“); údaj uprostřed věty nebo neúplný („ISO 2768“ bez třídy, „Tvrdit
   58-60“ bez jednotky, „Allgemeintoleranz“ bez normy) = ✗ \`drawing.note-title-data\`. Každá buňka nese hodnotu **svého
   druhu**: tepelné = tepelné zpracování, povrch = povrchová úprava, hrany = stav hran, úhly / sražení = tolerance (±, °),
   polotovar = rozměr a druh (ne tvrdost, ne úprava); pokyn („Konzervovat olejem“, „Zabalit do VCI“, „Měrný protokol“)
   nepatří do žádné buňky (✗, i \`výkres razítko …=\`). Buňka, která už nese jinou hodnotu, se nepřepíše (⚠ \`drawing.title-conflict\`, ukáže obě);
   materiál jiný než materiál modelu = ✗ (zdroj je model: \`materiál …\`). \`materiál 1.2379 kalený na 58-60 HRC\` se
   rozdělí (materiál do modelu, tvrdost a tepelné zpracování do razítka listů; bez výkresu ✗ s radou).
   Totéž hlídají **všechny kanály**: kóta (text, předpona, přípona – slovo „kalit“ / „černit“ stačí), popis díry, značka
   drsnosti, revize, název dílu / listu / výkresu a volné buňky razítka (zákazník, projekt, kontroloval …: jméno / číslo,
   ne pokyn „Odmastit“ / „Zabalit“).
2. **Místní popis = odkaz se šipkou na plochu, text je v MODELU:** \`poznámka F7 "Brousit"\` (EN \`note\`, DE \`hinweis\`) –
   výkres ho sám kreslí odkazovou čarou (šipka na hranu plochy viděné z boku, tečka na ploše viděné zepředu); změna textu
   v modelu = změna na výkrese. Nejvýš 8 místních popisů v dokumentu (✗ \`drawing.leaders-limit\`). Odkaz jen na výkrese
   (\`výkres značka poznámka "…" pohled přední v x y\` na hraně) = ⚠ \`drawing.note-not-model\`; na kótu nebo volný bod = ✗.
3. **Oblastní tepelná / povrchová úprava = tlustá čerchovaná čára (ISO 128, 04.2):** \`úprava F3 tepelná "58+2 HRC" od 10
   do 40\` (EN \`treatment F3 heat … from 10 to 40\`, DE \`behandlung F3 wärme … von 10 bis 40\`) – čára rovnoběžně nad
   plochou, kóta rozsahu, značka Z1 a vysvětlivka „Z1 tepelná: 58+2 HRC“ dole (počítá se do 5 řádků – i když výkres ještě
   není; stejný předpis = jedna vysvětlivka „Z1, Z2 …“). Rozsah mimo plochu = ⚠ \`drawing.pmi-range\`.
4. **Nad razítkem nejvýš 5 řádků volného textu v celém dokumentu** (všechny výkresy a listy dohromady), řádek ≤ 60 znaků,
   ≤ 8 slov, písmo ≤ 5 mm, heslovitě – žádné věty, souvětí ani „pokud není uvedeno jinak“; věta rozdělená na řádky (řádek
   končí čárkou / začíná spojkou) je věta. Víc = ✗ \`drawing.notes-limit\`, věta = ✗ \`drawing.note-style\`. Počítá se každý
   kanál, který čtenář vidí: poznámky, texty, vysvětlivky úprav, řádky popisů s odkazem, které nejsou označením díry /
   závitu / sražení („Brousit jemně“, „1) Rovinnost hlídat 2x“ – číslo v řádku ho technickým nedělá), kóta se slovy
   v textu / předponě / příponě („100 lapovat“ = 1 řádek), 2D TEXT / MTEXT / atributy / text v blocích × počet vložení
   (razítko rozvržení se pozná podle obsahu, ne podle jména bloku). Krátké slovo není výjimka – štítkem je jen „A-A“,
   „Řez A-A“, „Detail B“, pozice „12“, oblast „Z1“, měřítko. **Revize** = popis změny („Ø20 → Ø22“, „změna: doplněna díra Ø9“),
   pokyn v revizi = ✗ i se „změna:“ / „→“, nejvýš 5 řádků revize od agenta. **Kóta**, jejíž text nahradil hodnotu slovy, = ✗ a kontrola kót ji za
   kótu velikosti nepočítá. **Značka drsnosti** nese hodnotu Ra / Rz (+ nejvýš 1 slovo způsobu výroby); slova bez hodnoty = ✗.
   Popisy s odkazem a značky drsnosti se slovy se počítají do 8 místních popisů. Ve 2D totéž: značka drsnosti
   (\`2d drsnost\`) hodnota + nejvýš 1 slovo postupu, rámeček tolerance (\`2d tolerance\`) jen značka, hodnota a základny.
   Popis plochy v modelu (\`poznámka F7 "…"\`) je technický údaj – pokyn („Odmastit“) ✗ hned u příkazu.
5. **Žádný list ani výkres jen s poznámkami** a žádné dělení „výkres + poznámky“ (v žádném pořadí): hlavní list = list
   s největší plochou pohledů dílu v rozumném měřítku vážené počtem kót (žeton 1:10 s jednou kótou ani kopie pohledů bez kót
   hlavním listem není); volný text jinde = ✗ \`drawing.notes-sheet\`. Výkres, jehož název / číslo odkazuje na poznámky nebo
   jiný díl („Technické požadavky“, „Poznámky“, „MN-1/2“), a dokument jen s textem (těleso jen z primitiv do 5 mm nebo bez
   jediné kóty + poznámky – velikost nerozhoduje) = ✗; list agenta, který jen opakuje
   pohledy jiného listu a nese text = ✗ \`drawing.sheet-duplicate\` (prázdná kopie ⚠). Název dílu je údaj razítka: krátce, žádná věta ani pokyn (\`nový díl
   "…"\` jinak ✗; výchozí list \`--formats\` jde stejnou kontrolou).
6. **Kontrola:** \`výkres stav\` ukáže „Údaje razítka (technické, v buňkách) …“, „Poznámky nad razítkem: N/5 řádků (agent …,
   ručně …) · místní popisy N/8“ a „Z modelu: …“; \`stav\` dílu „Popisy ploch (N): F7 „Brousit“ …“ (i ve stromu prvků).
   Vyhodnocení listu hlásí porušení agenta ✗ (i u textu z JSON na řádku), export listu s porušením agenta se odmítne;
   načtený soubor ⚠ \`drawing.notes-loaded\`; „✓ … bez nálezů (… poznámky a razítko)“ jen bez nich. 2D výkres: text, který
   pravidla porušuje, příkaz \`2d …\` nepřijme, export ho nezapíše, \`2d stav\` ukáže „Poznámky nad razítkem: N/5“; údaje celého
   dílu patří do technického pásu razítka rozvržení (atributy TEPELNE, TVRDOST, POVRCH, HRANY, TOLERANCE, DRSNOST).

\`\`\`
nový díl "Deska"
kvádr 100 60 12
díra 9 skrz v 50 30
materiál 1.2379
výkres A3 měřítko 1:1 pohledy přední,horní,iso
kótovat chytře
výkres nepředepsané ISO 2768-mK
výkres razítko číslo="MN-1" tepelné="kalit a popustit" tvrdost="58–60 HRC" povrch="černit" hrany="ISO 13715 -0,3" drsnost="Ra 3,2"
poznámka F2 "Brousit"
úprava F3 tepelná "62+2 HRC" od 10 do 40
výkres značka text "Odmastit" v 30 120
výkres stav
\`\`\`

### Pomocné pohledy, řezy lomenou čarou, přerušení, uložení a revize

Body se zadávají jako u ostatních příkazů výkresu v **mm modelu v rovině pohledu** (y nahoru – rozsahy pohledů ukáže
\`výkres stav\`), umístění na listu v mm listu od levého dolního rohu. Nové pohledy dostanou písmeno (B, C… – A patří
řezu A–A) a značky na ně míří jako na ostatní pohledy: \`pohled B v x y\` (pomocný), \`řez B v x y\` (řez lomenou čarou).

| Příkaz | Význam |
| --- | --- |
| \`výkres pohled pomocný přední hrana 40 50 100 15,36\` | **pomocný pohled** (POHLED B, metoda šipky ISO 128-30) kolmo na šikmou plochu, která je v rodičovském pohledu vidět jako hrana – plocha ve skutečném tvaru; bod hrany se přichytí k hraně pohledu |
| \`… hrana … podél\` · \`… otočit\` · \`… umístit 330 120\` · \`… umístit 330 177 odshora\` | pohled podél hrany · z opačné strany · střed pohledu na zadané místo listu od levého dolního rohu, s \`odshora\` od levého horního (jinak zarovnaně s rodičem: ISO E po šipce, A proti ní) |
| \`výkres pohled pomocný plocha F7\` · \`výkres pohled pomocný směr 0,5 0 0,87\` | směr podle rovinné plochy (číslo F z \`měřit\`) nebo vektoru k pozorovateli; rodič se vybere sám (pohled, ve kterém je plocha vidět z boku) |
| \`výkres řez zalomený horní body -70 -10 -20 -10 -20 10 70 10\` | **zalomený řez** (ŘEZ B–B): rovnoběžné úseky spojené skoky; skoky se v řezu nekreslí, šrafy jen v rovinách úseků |
| \`výkres řez natočený horní body 60 0 0 0 -30 52\` | **natočený řez**: konec hlavního ramena, vrchol (osa otočení), konec šikmého ramena – šikmé rameno se otočí do roviny hlavního (příruby, rozteče děr) |
| \`… otočit\` · \`výkres řez smazat B\` | pohled na řez z druhé strany (šipky obráceně) · smazání |
| \`výkres řez částečný přední body -25 5 25 5 25 45 -25 45 hloubka 30 křivka\` | **částečný řez**: v oblasti pohledu se odebere materiál do hloubky od přední strany, řezná plocha se šrafuje, hranice tenkou čarou od ruky (\`křivka\` = hladká) · \`výkres řez částečný smazat 1|vše\` |
| \`výkres přerušení přední x od 50 do 250 [mezera 8] [vlnovka]\` | **přerušený pohled**: střední část se vynechá, části se přisunou (i v pohledech ve stejné promítací čáře), čáry přerušení cikcak / vlnovka; kóty přes přerušení i \`výkres stav\` drží **skutečnou délku** · \`výkres přerušení smazat 1|vše\` |
| \`výkres uložení Ø40 H7\` · \`výkres uložení Ø12 skrz H7\` · \`výkres uložení Ø25 H7/k6\` | pole tolerance **ISO 286** ke kótě nebo popisu díry (kontrola, že pole pro rozměr existuje); u kóty se zobrazí úchylky \`(+0,025/0)\` – \`výkres tolerance Ø40 H7\` funguje stejně (bez kontroly) |
| \`… zobrazení odchylky|mezní|značka\` · \`výkres uložení zobrazení mezní\` | úchylky, mezní rozměry \`(40,025/40,000)\` nebo jen značka – u jedné kóty / na celém listu |
| \`výkres uložení tabulka ano\` | **Tabulka uložení** na volném místě listu: kóta, pole, horní a dolní úchylka, max. a min. rozměr |
| \`výkres uložení dotaz 40 H7/g6\` | jen dotaz: úchylky díry a hřídele, vůle / přesah a druh uložení (s vůlí, přechodné, s přesahem) |
| \`výkres revize značka B na Ø40, 25\` · \`výkres revize značka smazat na Ø40\` · \`výkres revize B značky ne\` | **trojúhelník revize** u změněných kót (revize musí být v tabulce: \`výkres revize B "…"\`); kreslení trojúhelníků lze vypnout pro jednu revizi |
| \`výkres zóny ano\` | zóny listu ISO 5457 (písmena a čísla na okraji rámu) – tabulka revizí dostane sloupec **Zóna** s polohou trojúhelníků |

\`výkres stav\` vypíše řádky „Pomocné pohledy“, „Řezy lomenou čarou“, „Částečné řezy“, „Přerušení“ (zkrácení na listu
proti skutečné délce), „Uložení ISO 286“ (každá kóta s polem tolerance, úchylky a mezní rozměry) a „Zóny listu ·
trojúhelníky revizí“. Všechno se exportuje do PDF, DXF, DWG, SVG i PNG (\`window.mncad.exportDrawing\`).

### Příklad E – zalomený řez, uložení, revize se zónou

\`\`\`
nový díl Deska se třemi dírami
kvádr 120 60 20 střed
díra 10 skrz v -40 -10 20
díra 12 skrz v 0 10 20
díra 8 skrz v 40 -10 20
výkres A3 na šířku pohledy přední,horní
kótovat
výkres řez zalomený horní body -70 -10 -20 -10 -20 10 20 10 20 -10 70 -10
výkres uložení Ø12 skrz H7
výkres uložení tabulka ano
výkres revize B "Díra Ø12 H7"
výkres revize značka B na Ø12
výkres zóny ano
výkres stav
\`\`\`

Řez B–B prochází všemi třemi dírami (šrafy jen v řezných plochách, mezery Ø10, Ø12 a Ø8); popis díry má úchylky
\`(+0,018/0)\` a je v Tabulce uložení; u popisu je trojúhelník revize B a v tabulce revizí jeho zóna.

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
  \`výkres poznámka "≈ rozměry odhadem – ověřit"\` (krátce, heslovitě – jeden z nejvýš 5 řádků nad razítkem).
- Běžíte-li bez člověka a zeptat se nejde, odhad použijte, ale v závěrečné zprávě ho uveďte jako **první bod**.

### 3. Po dokončení – kontrola 1:1 (vždy, i když vše hlásí ✓)

Model:

- \`stav\` → rozměry X / Y / Z, objem, počet ploch a seznam prvků s parametry. Porovnejte celkové rozměry (a hmotnost nebo
  objem, uvádí-li je předloha).
- **Kóta po kótě:** ke každému řádku soupisu najděte prvek v modelu a porovnejte hodnotu **přesně** – odchylka ani
  v setinách není „skoro dobře“. Hodnotu **změřte** na hotovém modelu, ne jen v parametrech prvku: tloušťka / délka
  osazení \`měřit F3 F7\` (řádek „rovnoběžné · vzdálenost rovin“), průměr \`měřit F5\` nebo \`měřit válce\`, úhel
  \`měřit F2 F6\`, rozteč dvou děr \`měřit F8 F9\` („vzdálenost os“), poloha díry od boční plochy \`měřit F8 F1\` (válcová
  plocha díry × rovina: „vzdálenost od roviny“ se měří od osy díry).
- **Díry:** \`měřit díry\` – počet v každé skupině Ø, průměr, skrz / slepá s hloubkou a **střed vstupu** každé díry
  porovnejte s tabulkou děr nebo kótami polohy předlohy (souřadnice od počátku modelu = od základny kótování).
- **Plocha po ploše:** počet děr, osazení a drážek musí sedět; s popisky \`F1\` / \`E2\` (\`window.mncad.hints()\`) ověřte
  polohu a stranu (díra na správné straně, drážka na správném osazení, závit na správném konci); \`měřit plocha horní\`
  a podobná pravidla vypíšou čísla a polohy ploch bez obrázku.
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

## Předloha v dokumentu: DWG / DXF / PDF zákazníka – výtah a kontrola 1:1 textem

Výkres zákazníka se připojí k dokumentu jako **předloha** – CAD z něj vytáhne listy, pohledy, kóty a vše ostatní
a umí ho porovnat s modelem. Soubor nejdřív připojte: konzole Textové příkazy → **Připojit soubor…** (prohlížeč bez
\`window.mncad\` – výběr souboru), nebo \`window.mncad.attach("vykres.dwg", base64)\`; menší soubor jde i přímo
\`předloha "deska.dxf" data:application/dxf;base64,…\`.

| Příkaz (EN · DE) | Co udělá |
| --- | --- |
| \`předloha "výkres.dwg"\` (\`reference\` · \`vorlage\`) | připojí předlohu (DWG R2000–R2018, DXF, vektorové PDF) k dokumentu a vypíše stav; AutoCAD Mechanical (normálie STDPART2D, kusovník, pozice, drsnost, tolerance tvaru, základny, řezy) se převede, nic se neztratí potichu (poznámka importu) |
| \`předloha stav\` (\`reference status\` · \`vorlage status\`) | listy (formát, měřítko, razítko), počty pohledů / kót / děr / pozic, **text kóty = geometrie** (✗ = text lže, ≈ = zaokrouhlený), rozpory, poslední porovnání a kontrola kót |
| \`předloha výtah kóty|díry|kusovník|razítko|poznámky|značky|pozice|pohledy|listy|rozpory [list N] [pohled N.M] [vše]\` (\`reference extract dims|holes|bom|title|notes|symbols|balloons|views|sheets|contradictions\` · \`vorlage auszug maße|bohrungen|stückliste|schriftfeld|notizen|symbole|positionen|ansichten|blätter|widersprüche\`) | strukturovaný výtah: kóta = pohled, text, tolerance, uložení, počet, změřená hodnota, poloha; díry podle druhu (závit, vrtání, zahloubení, šroub, kolík) s označením normy; kusovník po řádcích; razítka po polích; nejvýš 40 řádků, \`vše\` = celý |
| \`porovnat předloha pohled přední [N.M] [list N] [tolerance 0,06] [měřítko 1:2] [se skrytými \| bez skrytých] [otočení 90] [zrcadlit] [posun dx dy]\` (\`compare reference view front\` · \`vergleichen vorlage ansicht vorne\`; i \`porovnat s předlohou …\`) | pohled modelu (promítnutý jako ve výkrese) proti pohledu předlohy: **pokrytí %** oběma směry v toleranci, úseky mimo toleranci s polohou od levého dolního rohu pohledu předlohy, obrázek SVG překryvu se stáhne. Bez N.M se vezme pohled předlohy, který nejlépe sedí; zadaný N.M se porovná bez kontroly velikosti. Porovnává se jen **obrys tělesa**: osy, kóty, šrafy, tenké čáry (tloušťka pod 0,7 × obrysu, AM_4 / AM_5 / AM_8, KOTY, SRAFY…), konstrukční značky (AM_9) a ¾ kružnice závitu se nepočítají. Pohled předlohy bez skrytých hran → jen viditelné hrany modelu. Jádro závitu d1 předlohy proti vrtáku modelu platí v toleranci 0,15 mm (řádek „závity normálií“). \`měřítko 1:2\` = měřítko pohledu, když ho předloha neříká (pohled bez kót, \`předloha výtah pohledy\` ukáže, odkud měřítko je) |
| \`předloha kontrola kót [pohled přední] [N.M] [list N] [měřítko 1:2]\` (zkráceně \`kontrola kót\`; \`reference check dimensions\` · \`vorlage maße prüfen\`) | každá kóta předlohy se změří v modelu mezi stejnými body (délky, rozteče děr, Ø, R; bod ve **virtuálním rohu** sražené / zaoblené hrany se vezme na přímce hrany): ✓ = hodnota modelu = text kóty (± 0,005) nebo text je jen zaokrouhlená geometrie předlohy, ✗ = jiná hodnota (i když model odpovídá geometrii předlohy, jejíž text jí odporuje – „předloha si odporuje“, ověřit u zákazníka), ⚠ = bod kóty v modelu nenalezen. Úhly, závity a sražení se nekontrolují (počet „nekontrolováno“). U výkresu více dílů se kontroluje **jen list, který modelu odpovídá** (řádek „kontrolován list N“); jiný list: \`list N\`. Pozor: kontrola kót **vlastního výkresu** (očekávané rozměry na listu, tlačítko Kontrola kót / Maßprüfung) je řádek „Kontrola kót“ ve \`výkres stav\` |
| \`předloha otevřít\` · \`předloha odebrat\` | předloha jako 2D výkres v nové záložce (prohlížení) · odebrat z dokumentu |

Pohledy předlohy mají čísla \`list.pořadí\` (\`14.2\` = list 14, druhý pohled shora zleva); polohy jsou
souřadnice výkresu předlohy. Listy se najdou i bez bloku formátu (rámeček z čar nebo křivky velikosti A0–A4). Dokument
si pamatuje název a otisk souboru a výsledky kontrol s **otiskem modelu** – \`předloha stav\` je po změně modelu
označí „⚠ … ZASTARALÉ“ (zopakujte). Soubor sám se neukládá – po obnovení stránky ho připojte znovu. Značky:
porovnání ✓ = obě pokrytí ≥ 99,5 %, ⚠ = obě ≥ 90 %, ✗ = jinak (i model s dírami navíc); kontrola kót ✓ = vše změřeno
a sedí. Model označte za hotový, až \`porovnat předloha\` dává u všech pohledů ✓ (zbylé úseky „chybí / navíc“
projděte – předloha nemusí kreslit malá sražení) a \`předloha kontrola kót\` ✓ bez ✗ a bez ⚠.

\`\`\`
předloha "deska.dxf"
# ✓ připojeno: předloha „deska.dxf“ (DXF, 35 kB): listy 1 (1× A3), pohledy 2, kóty 7, díry a normálie 5, pozice 1, razítka 1
# ✗ text kóty ≠ geometrie: 1 – list 1 kóta BA: text 19.8, geometrie 20
# ✗ rozpor: pozice 1: kusovník „20*80*125“, razítko listu 1 „20*80*120“
porovnat předloha pohled horní
# ✓ porovnání pohled horní × předloha 1.1 (tolerance 0,06 mm): předloha pokryta modelem 100 %, model pokryt předlohou 100 % …
předloha kontrola kót
# ✓ kontrola kót předlohy 1.1 × model (pohled horní): 6 ✓, 0 ✗, 0 bez bodu v modelu, 0 nekontrolováno (úhel, závit, sražení)
# ✗ kóta BA „19.8“ […]: model 20 – předloha si odporuje: text 19.8, geometrie předlohy 20 – …
\`\`\`

## Žádné tiché změny a přísný režim (\`přísně\`, EN \`strict\`, DE \`streng\`)

Cokoli, co by změnilo výsledek oproti napsanému, má v protokolu **⚠ s kódem**; co nejde provést, je **✗**; co je bez
účinku jen kvůli prostředí nebo neškodná normalizace, je **ℹ** (jen se počítá). Kód je stejný v cs/en/de, agent podle něj
třídí. Nejčastější:

| Kód | Kdy | Co udělat |
| --- | --- | --- |
| \`parse.unused\` ⚠ | slovo nebo číslo navíc, které příkaz nepřečetl (\`rotovat 90 úhel 180\`, \`díra 5 skrz v 10 10 nesmysl\`) | odstranit / opravit zápis |
| \`parse.coord-missing\` ⚠ | poloha s méně souřadnicemi (\`vložit "A" v 10 20\` → z = 0, \`normálie M8x30 v 5\` → y = z = 0; díra s jedním číslem polohy \`v 10\` je ✗ řádku – díra má \`v x y\` nebo \`v x y z\`) | zadat všechny tři |
| \`parse.axis\` ✗ | neznámá osa (\`osa W\`, \`rotovat osa 1\`) – řádek se neprovede | osa X / Y / Z, šikmo \`směr vx vy vz\` |
| \`parse.conflict\` ⚠ | odporující si volby: \`hloubka 10 skrz\`, \`vysunout 10 skrz\`, \`odebrat přidat\` | nechat jen jednu |
| \`hole.depth-default\` ⚠ | díra bez \`hloubka\` / \`skrz\` / \`k tělesu\` = skrz | napsat \`skrz\` nebo hloubku |
| \`hole.conflict\` ⚠ | (už se nehlásí) \`zahloubení\` i \`kuželové\` najednou je ✗ – řádek se neprovede | jedno z nich |
| \`hole.cbore-dropped\` ⚠ | (už se nehlásí) \`díra … zahloubení 20 7 závit M8\` postaví zahloubení + vrták + závit; kód zůstává kvůli starším protokolům | |
| \`hole.tap-diameter\` ⚠ | zadaný průměr závitové díry nahrazen tabulkovým vrtákem (\`díra 8 závit M8\`) | vrták zadat \`vrták 6,7\` |
| \`hole.no-surface\` ⚠ | díra \`v x y\` bez z mimo povrch tělesa – začíná na obálce | zadat z |
| \`select.fallback\` ⚠ / \`select.ambiguous\` ⚠ | pravidlo plochy nenašlo plochu na obálce / našlo víc ploch | plochu číslem F3 |
| \`name.renamed\` ⚠ / \`name.renamed-auto\` ℹ | obsazený název prvku přečíslován („Díra 1“ → „Díra 2“) | jiný název |
| \`material.density-assumed\` ⚠ / \`material.class\` ℹ | \`materiál X\` jen označením: hustota zůstává / třída z označení (EN AW-* → hliník, 1.4xxx → nerez, 1.0xxx–1.3xxx, ČSN 1x xxx, S235, C45 → ocel, CuZn → mosaz) | \`materiál hlinik\` + označení |
| \`asm.stale-copy\` ⚠ | díl změněný po \`vložit\` (prvek, číslo, materiál, druh, výkres) – komponenta je kopie, změna se do sestavy sama nepromítne; hlásí se na řádku změny i u \`kusovník\`, listu sestavy a \`stav\` | \`sestava obnovit "X"\` (\`vše\`, \`údaje\`) |
| \`mate.lost\` ✗ / ⚠ | plocha / hrana vazby po úpravě dílu neexistuje nebo není jednoznačná – vazba je mimo řešení, komponenta stojí (✗ u kroku, který ji ztratil; ⚠ při \`stav\` a na konci běhu nad otevřeným dokumentem se ztracenou referencí – přísný režim zastaví) | \`sestava vazba N plocha b <plocha>\` / \`sestava vazba N smazat\` |
| \`mate.renumbered\` ℹ / \`mate.restored\` ℹ | táž plocha má po úpravě dílu jiné číslo / ztracená plocha je zpět (přesná shoda) | – |
| \`bom.make-incomplete\` ⚠ / \`bom.docs\` ℹ | vyráběný díl bez čísla výkresu, výkresu nebo označení materiálu / souhrn dokumentace u výstupů sestavy („vyráběné 2 (bez výkresu 1), normálie 2, nakupované 0“) | \`výkres razítko číslo=…\` a \`materiál …\` v dílu, \`sestava obnovit\`, \`druh nakupovaný\` |
| \`clash.thread\` ℹ, \`clash.underhead\` ℹ / \`clash.real\` ⚠ | \`kolize\`, \`kontrola sestava\` i \`pohyb … kolize\` (v poloze kroku) třídí stejně – geometricky v jádře (oddíl **Kolize šroub × závit** níže): šroub v závitové díře (průnik souosý s dírou v mezikruží díry) / prstenec u vstupu díry / skutečná kolize (i šroub v plném materiálu vedle děr, šroub mimo osu); v pohybu jeden ⚠ za každou dvojici dílů (první krok, počet kroků) | jen \`clash.real\` řešit; \`pohyb krok N\` vypíše kolize kroku |
| \`clash.undetermined\` ⚠ / \`clash.hidden\` ℹ | dvojici jádro nevyhodnotilo (booleovská operace selhala) nebo závit má neznámé označení (G 1/4, UNC…) / skryté komponenty se nekontrolují | závit zadat metricky (\`závit M10\`) |
| \`clash.touch\` ℹ / \`clash.work\` ℹ / \`clash.stale\` ⚠ | dotyk – průnik tenčí než \`kolize tolerance\` (výchozí 0,01 mm) / pracovní kontakt podle pravidla \`kolize pravidlo pracovní …\` v okně operace / \`kolize seznam\` nad kontrolou z dřívějšího stavu sestavy | dotyk a pracovní kontakt nejsou závada; \`clash.stale\` → \`kolize\` znovu; jádrová díra bez závitu = \`clash.undetermined\` s nápovědou (\`díra … závit M12\` nebo \`kolize pravidlo závit\`) |
| \`clash.clearance\` ⚠ / \`clash.uncertain\` ⚠ / \`clash.discrete\` ℹ | vůle sledované dvojice pod limitem \`pohyb vůle … min L\` / kolize mezi polohami nepotvrzeny (dotyk bez objemu při natáčení, mez zjemnění) / kolize kontrolovány jen v polohách (\`pohyb kolize diskrétně\`) | vůle: místo a kroky v textu, \`pohyb krok N\`; nepotvrzeno: jemnější kroky \`pohyb kroky N\`; diskrétně: \`pohyb kolize spojitě\` |
| \`feature.warning\` ⚠ / \`feature.failed\` ✗ / \`feature.unverified\` ⚠ | výsledek stavby prvku; prvek bez výsledku stavby **nikdy není ✓** | |
| \`thread.tip-tangent\` / \`thread.no-reach\` / \`thread.wrong-side\` / \`thread.pitch-nonstandard\` ⚠ | závit: špička profilu tečná k povrchu, drážka celá v materiálu (skrytý kanál), drážka ústí do povrchu jen špičkou, stoupání mimo ISO 261 – text = hláška prvku | \`přísně kromě thread.pitch-nonstandard\` |
| \`geom.exact-invalid\` ⚠ | přesná kontrola platnosti před exportem STEP / BREP našla vadné plochy | |
| \`out.reload-invalid\` ⚠ | soubor STEP / BREP odpovídá modelu (tělesa, objem, obálka), ale po zpětném načtení neprojde přesnou kontrolou platnosti, model ano; příčinu řádek píše jen změřenou rozborem znovu načteného souboru: (a) po přepočtu tolerancí projde s tolerancí do meze → „geometrie souboru odpovídá“, (b) projde nad mezí → „shoda nepotvrzena“, (c) neprojde a odchylka křivek od ploch je v souboru stejná jako v modelu → „zápis odchylku nezvětšil“, (d) v souboru větší → „vadu přinesl zápis nebo čtení“, (e) „příčina nezjištěna“ (viz „Přesná kontrola“ u stavu prvku); „věrná kopie“ se nenapíše, řádek F \`check=fail\`. V přísném režimu (\`--strict\`, \`přísně\`) se soubor kontroluje před zápisem a **nezapíše se** („soubor nezapsán (přísný režim zastaví běh) – …“, žádný řádek F, \`files=0\`), běh zastaví | soubor ověřit v cílovém CADu; \`přísně kromě out.reload-invalid\`, když to víte (pak se soubor zapíše) |
| \`out.no-solid\` ✗ / \`out.free-surfaces\` ⚠ | objemový export (STEP, BREP, STL, 3MF) modelu bez objemového tělesa (jen plochy / skořepina – i uzavřená skořepina bez „Uzavřít do tělesa“) / s volnými skořepinami či plochami vedle těles (u sestavy se jmény komponent); bez přísného režimu se soubor zapíše (řádek zápisu ℹ, ne ✓), „věrná kopie modelu“ se nenapíše, řádek F \`check=fail\`; v přísném režimu (\`--strict\`, \`přísně\`) se soubor **nezapíše** – složení modelu je známé před zápisem („soubor nezapsán (přísný režim zastaví běh) – …“, žádný řádek F, \`files=0\`) a běh zastaví | \`prvek surf.close\` (Plochy → Uzavřít do tělesa), \`prvek surf.thicken\`, volnou plochu smazat / potlačit |
| \`op.accepted\` ℹ / \`op.superseded\` ℹ / \`feature.unchecked\`, \`doc.unchecked\` ℹ / \`feature.built\` ℹ / \`feature.suppressed\` ℹ | příkaz přijat – výsledek přijde až po stavbě modelu / vyhodnocení listu výkresu; stav modelu po příkazu se samostatně nestavěl (následovala další změna – ověřen je až stav po uvedeném řádku); prvek (načtený dokument) vznikl, ale platnost tělesa se po něm nekontrolovala (důvod v textu); prvek vznikl, ale týž příkaz má ⚠/✗ jiného prvku; prvek je potlačený (přímo nebo konfigurací) a nestavěl se – **nic z toho není ✓** | u \`feature.unchecked\` zkontrolovat díl jinak (menší těleso, export STEP s kontrolou) |
| \`drawing.section-miss\` ✗ / \`drawing.warning\`, \`drawing.overlap\` ⚠ | rovina řezu neprotíná těleso (řez nevznikne) / varování listu (pohledy se v měřítku nevejdou, vynechané Chytré kóty, ztracené ruční úpravy kót) / překryv nebo přesah rámečku popisku, značky či kóty – hlásí se **na konci bloku** příkazů \`výkres …\` (opravený v témže bloku \`výkres upravit … posun=\` se nehlásí), na řádku příkazu, který ho způsobil | odsazení řezu, měřítko, formát, \`výkres upravit aN posun="dx dy"\` |
| \`drawing.section-legacy\` ⚠ (přísně ✗) | odsazení řezu ve starším zápisu (souřadnice osy), které dnešní výklad mine – vyloženo postaru | psát odsazení jako u skici (\`dnes pište: …\` v hlášce) |
| \`drawing.tolerance-missing\` ⚠ | \`výkres kontrola tolerancí\`: funkční rozměr / tolerovaná kóta předlohy bez tolerance (jeden řádek za rozměr) | \`výkres tolerance aN …\` |
| \`drawing.bom-overflow\` ⚠ | kusovník se na list nevejde ani ve sloupcích (počet chybějících řádků); \`drawing.overlap\` ⚠ navíc hlásí překryvy celého listu (balónky, odkazové čáry × balónky, kotvy jiných pozic pod 1 mm a kóty, texty, kóty, geometrie, tabulky, rám) s počtem po druzích | větší formát, \`výkres kusovník list\`, \`výkres pozice pohled …\`, \`výkres pozice zamknout …\` |
| \`drawing.dims-incomplete\` ⚠ | kontrola kót (bod 18): na listu chybí velikost nebo poloha prvku výsledného dílu (díra, skupina děr s počtem, kapsa / okno, obrys skici) – \`výkres stav\`, konec běhu, export listu | \`výkres doplnit kóty\`, \`výkres kóta …\`, podrobně \`výkres kontrola kót\` |
| \`drawing.dim-detached\` ⚠ | ruční kóta (ne Chytré kóty) po změně modelu neodpovídá geometrii pohledu: hrana / kružnice / vrcholy zmizely (kóta visí podle uložených bodů), nebo se kóta přichytila ke změněné geometrii (\`výkres stav\` ukáže „30 (zadáno 60) * ⚠“); pohled kóty není na listu – \`výkres stav\`, konec bloku / běhu (místo „✓ list vyhodnocen bez nálezů“), export listu | potvrdit přichycenou kótu \`výkres upravit aN odsazení=…\`, jinak \`výkres smazat aN\` |
| \`drawing.tol-nonfunctional\` ℹ | přesná tolerance (≤ IT7 / pásmo ≤ 0,05) na kótě, která nesplňuje žádný vyznačený funkční prvek (přetolerování) | vyznačit prvek \`funkční …\`, nebo toleranci uvolnit |
| \`drawing.stale\` ⚠ | vydaný list (\`výkres vydat\`) neodpovídá nynější revizi modelu: \`výkres stav\`, \`stav\`, konec běhu, který model změnil; export listu se starým písmenem revize a nové vydání se stejným písmenem po změně (v přísném režimu ✗, export se nezapíše) | \`výkres vydat B\` (nová revize), přehled \`výstupy zastaralé\` |
| \`param.clamped\` ⚠ | hodnota mimo rozsah ořezána (úhel kuželového zahloubení 30–170°, hrot 60–170°, úhel stěny 5–90°) | |
| \`geom.approx\` ℹ / \`geom.volume-failed\` ⚠ | objem ze sítě (velké těleso) / objem se nepodařilo změřit (0) | |
| \`tab.settle-timeout\` ✗ | aplikace nepřepnula záložku do 5 s | zopakovat |

Každý dokument, do kterého běh přidal prvky, se **postaví dřív, než se jeho prvky ohlásí** – i díl, ze kterého běh odešel
(\`nový díl\`, \`záložka\`); jeho výsledky se počítají jako komponenta sestavy, takže pozdější \`vložit\` + vazby ho nestaví
znovu. Totéž platí pro dokument **načtený celý** (JSON na řádku skriptu, v CLI \`--open\`): ✗/⚠ jeho prvků mají řádek JSON
(\`--open\` bez řádku \`L-\`), i když běh přejde na jiný dokument – výsledek (OK / FAIL) nezávisí na \`--formats\`.
Selhaný prvek dílu upravovaného v kontextu sestavy je jeden ✗ \`feature.failed\` na řádku prvku (ne další ✗ u
\`sestava hotovo\`).

**Listy výkresu v protokolu:** každý list, který běh měnil, se na konci běhu spočítá v konečném stavu – varování listu
(řez mimo těleso ✗, pohledy se nevejdou ⚠ …) jsou v protokolu i bez exportu a v konzoli prohlížeče stejně jako v CLI;
\`výkres stav\` je kóduje na svém řádku. Export PDF téhož listu ho nepočítá znovu (paměť výsledků listu).

**Přísný režim** – \`přísně\` (od toho řádku), \`přísně vyp\`, \`přísně kromě kód,kód\` (výjimky, i předpona \`hole.\`); v CLI
\`--strict\` / \`--strict=kromě kód,…\` (i předpona \`--strict=hole.\`), v HTTP \`strict: true\`. O zastavení rozhoduje **řádek
záznamu**: ⚠ na řádku před \`přísně\` nebo za \`přísně vyp\` nezastaví, záznam bez řádku (závěrečná stavba, výstupy) podle stavu na
konci skriptu – konzole prohlížeče i CLI dají pro týž skript stejný výsledek. Platí i v konzoli prohlížeče:

- chyba nebo varování **rozboru** (✗/⚠ na přísném řádku): neprovede se nic, vypíšou se všechny;
- za běhu **první ⚠ nebo ✗ zastaví** (konzole: „■ přísný režim: zastaveno na řádku N (kód)“, CLI hlavička \`STOP\`, JSON
  \`stopped\`, kód ukončení 2); dokumenty postavené do té chvíle zůstávají v relaci, výstupy \`--formats\` se nezapíšou;
- model se staví **po každé operaci**, která ho změnila (bez sítě, přírůstkově) – zastaví se na řádku prvku;
- list výkresu se spočítá **po bloku** po sobě jdoucích příkazů \`výkres …\` (a při \`výkres list …\`), varování listu jdou na
  řádek posledního příkazu bloku – mezistav \`výkres A1\` před \`výkres měřítko 1:5\` nezastaví;
- ℹ nezastaví nikdy (šrouby v závitu \`clash.thread\` tedy přísný běh nástroje nezastaví);
- STOP = žádné soubory \`--formats\` ani odkaz \`--share\` (i když STOP přijde až po posledním řádku – konzole „■ přísný
  režim: STOP – kód na řádku N“); výslovný \`export step|brep|stl|3mf\`, jehož nález (\`out.no-solid\`, \`out.free-surfaces\`,
  \`out.reload-invalid\`, \`out.check-failed\`, \`geom.exact-invalid\`) běh zastaví, soubor **nezapíše** (žádný řádek F, fáze
  průběhu bez „zápisu“); po STOP se poslední \`stav\` neprovedl, výpis \`= status\` chybí.

\`\`\`
přísně kromě select.ambiguous
nový díl Deska
kvádr 100 60 10
díra 8 skrz v 20 20
díra 8 v 80 40            # ⚠ hole.depth-default už při rozboru → STOP L5, neprovede se nic
\`\`\`

## Stav prvku: ✓ / ⚠ / ✗ – co znamená

- Výsledek prvku se v protokolu vypíše **až po výpočtu**. Řádek „→ … – výsledek po výpočtu níže“ (ℹ \`op.accepted\`) jen
  potvrzuje přijetí příkazu – u nového prvku, u úpravy (\`upravit\`, \`smazat\`, \`přesunout\`, \`proměnná\`, \`konfigurace\`,
  entita / kóta skici, \`zpět\`), u příkazů výkresu („… – výsledek po vyhodnocení listu níže“; pak ✓ „list … vyhodnocen bez
  nálezů“ nebo ✗ / ⚠ listu) i u načtení dokumentu s prvky (JSON na řádku, \`otevřít\`, \`--open\`: po ověřovací stavbě na
  řádku načtení ✗ / ⚠ vadného prvku, nebo ✓ „dokument … postaven: prvků N, bez ⚠ a ✗ · těleso platné“; ℹ \`doc.unchecked\`,
  když se platnost tělesa nekontrolovala). Běžný (ne přísný) běh staví model jednou na konci – ověřen je tedy stav po
  POSLEDNÍ změně. Řádek, po kterém přišla další změna a který nemá výsledek žádného prvku, dostane ℹ \`op.superseded\`
  („stav modelu po tomto příkazu se samostatně nestavěl – ověřen je až stav po řádku N“): mezistav není ✓ ani ✗, jen
  nezkontrolovaný. Kdo chce výsledek po každém řádku, pustí běh \`přísně\` (staví po každé operaci). **Žádný řádek
  nedostane ✓ a později ✗.**
- Stav má čtyři oddělené úrovně: **přijato** (ℹ) → **vznik prvku** (✗ \`feature.failed\`, když stavitel selže) → **účinek
  booleovské operace** proti nástroji („úběr 352,1 mm³ (>99 % nástroje)“, „přidáno 2000 mm³ (celý nástroj)“; žádný účinek =
  ⚠) → **konečné těleso** („těleso platné“, „2 těles, platná“, „žádné objemové těleso“, nebo „těleso nezkontrolováno (důvod)“).
  Řádek výsledku je nese všechny: \`✓ Díra 1 (hole) · úběr 125,7 mm³ (12 % nástroje) · těleso platné\`; JSON má totéž
  strojově v \`entries[].data.levels\` (\`built\`, \`effect {op, level: none|partial|full|changed, dV_mm3, tool_mm3}\`,
  \`body {solids, free, valid: true|false|"unchecked"}\`).
- Platnost tělesa se po prvku kontroluje do 400 ploch, větší těleso až na konci stavby (do 1000 ploch); nad to se
  nekontroluje vůbec (těleso se měří ze sítě). Prvek bez kontroly **není ✓**, ale ℹ \`feature.unchecked\` s důvodem; řádek D
  a \`= status\` pak mají \`valid=unchecked\` (jinak \`solids=N valid=1|0\`) a prvek se nepočítá do prvního čísla \`feat=\`
  (✓), ale do \`unchecked=N\`. Plochy mimo objemová tělesa (volné plochy, pláště vedle tělesa) hlásí \`free=N\`.
- Po stavbě proběhne **rychlá** kontrola platnosti (BRepCheck; odchylka hran od ploch jen v několika bodech) – řádek Geometrie
  ve \`stav\` končí „· rychlá kontrola“. **Přesnou** kontrolu (odchylka počítaná přesně) spustí \`kontrola přesně\` (EN \`check
  exact\`, DE \`prüfen genau\`; v aplikaci čip „platné · rychlá kontrola“ ve stavovém řádku) a sama proběhne před exportem
  STEP / BREP do 400 ploch („✓ těleso: přesná kontrola platnosti … – platné“, vada = ⚠ \`geom.exact-invalid\`, nad limit ℹ
  s důvodem). Výsledek platí pro tutéž geometrii: Geometrie pak končí „· přesná kontrola“, řádek D nese \`vcheck=exact\`
  (bez klíče = rychlá kontrola), JSON \`docs[].validCheck\` = \`exact\` | \`fast\`. Model se kvůli exportu neupravuje
  (žádné „opravy tolerancí“) – STEP je přesně model. Přesně se kontroluje i soubor po zpětném načtení (do 400 ploch); když
  neprojde (model ano), je to ⚠ \`out.reload-invalid\`, ne „věrná kopie“. Příčinu řádek uvede jen doloženou rozborem
  znovu načteného souboru (model se nemění): tolerance hran a vrcholů souboru se přepočtou (BRepLib) a přesná kontrola se
  zopakuje. (a) „… po přepočtu … projde s tolerancí nejvýše X mm (mez Y mm = největší tolerance modelu) → geometrie souboru
  odpovídá“ = vadné byly jen tolerance po načtení – jen s tolerancí do meze (mez nejvýš 0,001 mm), jinak (b) „… projde, ale
  s tolerancí X (mez Y) – shoda geometrie souboru s modelem nepotvrzena“. (c) Neprojde-li ani po přepočtu, změří se odchylka
  křivek hran od ploch v souboru i v modelu (stejný počet vzorků na hranu, čísla v řádku): stejná a na vadných plochách nad
  tolerancí hran → „zápis odchylku nezvětšil, čtečka STEP a přepočet tolerance hran podhodnotí“ (přepočet vzorkuje – typicky
  závit z prvku Závit; soubor je tak přesný jako model, jen tolerance po načtení jsou malé); (d) v souboru větší → „vadu přinesl
  zápis nebo čtení souboru“; (e) jinak „příčina nezjištěna“. Ve všech případech ⚠ a řádek F \`check=fail\` – výchozí čtečka
  soubor přesnou kontrolou odmítne; ověřte ho v cílovém CADu (ten tolerance při načtení obvykle opraví).
- Potlačený prvek (\`potlačit\`, nebo potlačený aktivní konfigurací) se nestaví: má ℹ \`feature.suppressed\` („potlačen – nestaví
  se“), nikdy ✓; ve výpisu \`stav\` „ℹ (potlačen)“ a počet „N ℹ potlačeno“, v řádku D \`off=N\` (nepočítá se do \`feat=\` mezi ✓).
- Prvek objemového typu (primitiva, vysunutí, díra, zaoblení, pole, prvky rozšíření s operací přidat / odebrat a všechny
  prvky rozšíření mimo kartu Plochy – plech, svařence, pružiny, pokročilé prvky), po kterém nezůstalo objemové těleso
  nebo přibyly volné plochy, je ✗ u toho prvku („má dát objemové těleso, ale výsledek je jen plocha / plášť“) a těleso
  zůstane jako před ním. Prvky ploch (\`surf.*\` bez operace) plochu dát smějí – jejich stav říká „žádné objemové těleso“.
- **✓** = výsledek je platné objemové těleso a operace se projevila (objem nebo topologie se změnily).
- **⚠** = prvek se zpracoval, ale výsledek si žádá pozornost:
  - *„Prvek těleso nezměnil“* / *„Prvek objem tělesa nezměnil (jen rozdělil plochy)“* – nástroj leží mimo těleso, jen se
    ho dotýká, nebo jádro operaci u téměř tečných ploch neprovedlo. Zkontrolujte polohu, poloměr, stranu.
  - *„Výsledek má neplatnou geometrii – vznikla u prvku „…““* – typicky profil tečný k povrchu; export STEP pak může
    selhat. Toto varování stojí **jen u prvního prvku, po kterém je těleso neplatné**, a říká, co je vadné (hrana
    \`E12\` s bodem, plochy \`F7\`) a co změnit. Každý další prvek postavený na takovém tělese má ⚠ *„Těleso je neplatné
    už od prvku „…““* – opravte prvek, který je v něm jmenovaný, ne ten, u kterého to čtete.
  - *„Výsledek operace neodpovídá průniku tělesa s nástrojem“* / *„…závisí na toleranci výpočtu“* / *„…neodpovídá
    nástroji“* – jádro operaci u téměř tečných ploch spočítalo jinak, než vychází kontrolní výpočet (v hlášce jsou obě
    hodnoty v mm³). Těleso je platné, ale objem prvku nemusí sedět: posuňte nástroj tak, aby plochy tělesa jasně
    protínal (aspoň o 0,01 mm), nebo aby s nimi splýval přesně.
  V historii je prvek oranžový, ve stavovém řádku je čip „prvek s upozorněním“ / „neplatná geometrie“.
- Tečné a souběžné plochy (klín odlehčení tečný ke kuželu v rohu, hrana nástroje přesně na stěně otvoru): operace se
  počítá přesně; když přesný výsledek nese příznak vady (vrchol s tolerancí nad 0,0005 mm, neplatná geometrie, úběr,
  který se neprovedl), zopakuje se s tolerancí 1e-7 × rozměr modelu (0,00001 až 0,0001 mm), s 10× a se 100× větší a
  výsledek se přijme, jen když se dvě tolerance shodnou a potvrdí ho kontrolní výpočet. Díl se zadním odlehčením břitu
  se tak postaví platně se souřadnicemi i směrovými vektory rovin (\`normála\`, \`osax\`) na 4 až 6 desetinných míst.
  Chyba objemu roste s hrubším zaokrouhlením – na syntetické střižnici 60 × 40 × 12 mm v 89 natočeních: do 0,002 mm³ při
  6 místech u všeho, do 0,3 mm³ při vektorech na 6 a souřadnicích na 5 míst, do 0,08 mm³ při 5 místech u všeho, do
  0,17 mm³ při 4 místech; při 3 místech kolem 1 mm³ a těleso bývá občas neplatné. U 1 až 4 natočení z 89 (6 míst) zůstane
  ⚠ u řezu, který jádro neprovede přesně ani s tolerancí (takový prvek ✓ nedostane). Pište proto vektory **na 6 míst** a souřadnice
  aspoň na 5; když u prvku zůstane ⚠, nechte profil plochu protnout s přesahem aspoň 0,01 mm, nebo rovinu zadejte úhlem
  či odkazem na plochu.
- Skoro-dotyk se nikdy „nezaokrouhluje“: dvě díry, které se překrývají o 0,00001 mm, kanál, který prorazí plochu
  o 0,00001 mm, nebo nálitek s mezerou 0,00001 mm se postaví přesně tak, jak jsou zadané.
- **✗** = operace selhala, těleso zůstalo jako před prvkem (např. skořepina, kterou jádro neumí, tažení bez objemu).
- Řádek **Geometrie:** ve \`stav\` říká „platná · 1 těleso“, „NEPLATNÁ“ / „ŽÁDNÉ objemové těleso (jen plochy)“, nebo
  „nezkontrolováno (důvod)“ – kontrola, která neproběhla, se nikdy nevypíše jako platná.
  Pokles objemu ani „1 těleso“ samy o sobě správnost nedokazují – rozhoduje tento řádek a nepřítomnost ⚠.

## Závity – jak je zadat správně

- Katalogový závit: \`závit M18×1,5 délka 20 v 0 0 10 [osa Z] [vnitřní] [modelovat | šroubovice]\` – hrubé i jemné stoupání
  (M18×1,5, M10×1,25; označení i s mezerami „m18 x 1,5“, × / x / X, čárka i tečka; CS / EN \`thread\` / DE \`gewinde\`).
  Bez volby je kosmetický: geometrie se nemění, na výkrese se kružnice válce (nebo jádra díry u \`vnitřní\`) kótuje
  označením. \`modelovat\` = zjednodušené soustružené drážky (bez stoupání), \`šroubovice\` (EN \`helix\`, DE \`schraubenlinie\`)
  = **skutečná šroubovice** z označení – stejné jádro i čísla jako Tažení po šroubovici níže (vnější: povrch Ø d, hloubka
  0,6134·P; vnitřní: povrch D1/2, hloubka 0,5413·P do stěny, špička na d/2 – díra vrtaná vrtákem závitu Ø16,5 u M18×1,5).
  Jemné stoupání CAD umí v obou cestách; stoupání mimo řadu ISO 261 (např. M18×3 nebo M18×1,25 – řada M18 je 2,5 / 2 /
  1,5 / 1) se postaví, ale dostane ⚠ \`thread.pitch-nonstandard\` (i u díry se závitem a u kosmetického závitu).
- Díra se závitem: \`díra závit M18×1,5 hloubka 20 v x y\` – vrták (Ø16,5) se dopočítá z označení; zadaný průměr
  (\`díra 16,4 závit M18×1,5 …\`) má přednost, \`jádro\` = D1 podle ISO 965-1 (16,376).
- Skutečná šroubovice (Plochy → Tažení po šroubovici, JSON \`{"type":"ext","ext":"surf.helixSweep","data":{…}}\`):
  \`profile: "thread60"\`, \`side: "internal"\` pro závit **v díře** (poloměr = poloměr díry / jádra, hloubka jde
  do stěny) nebo \`"external"\` pro závit **na válci** (poloměr = poloměr válce), \`pitch\`, \`turns\`, \`mode: "cut"\`,
  volitelně \`leadIn\` (náběh jako u závitového kalibru: hřbet prvního závitu je od začátku vybroušený až na dno drážky
  a během N otáček se zvedá do plného profilu – drážka sama je plná od začátku).
  Příklad matice M18×1,5 s jádrem Ø16,4: \`radius: 8.2, depth: 0.8, pitch: 1.5, turns: 12, side: "internal"\`.
  Závit z katalogu místo čísel: \`prvek surf.helixSweep profile=thread60 thread=M18×1,5 side=internal turns=12 mode=cut\`
  (\`thread\` vyplní poloměr, stoupání a hloubku podle strany – zadané radius / pitch / depth se pak nepoužijí).
  JSON prvku na jednom řádku lze míchat s textovými příkazy (\`trubka 42 16,4 30\`, další řádek \`{"type":"ext",…}\`, \`stav\`).
  Program ověří, že drážka řeže povrch, na kterém závit vzniká (body profilu ve 12 místech šroubovice proti tělesu před
  prvkem): špička tečná k povrchu (radius 9 + depth 0,8 u díry Ø16,4) = ⚠ \`thread.tip-tangent\`; drážka celá v materiálu
  (side=internal s radius 9 v díře Ø16,4 – skrytý kanál) = ⚠ \`thread.no-reach\`; drážka ústí do povrchu jen špičkou
  (obrácená strana, radius 9 + depth 0,82 u díry Ø16,4) = ⚠ \`thread.wrong-side\`. Hláška radí side a radius podle nalezeného
  povrchu. Drážka, která odebrala celý nástroj (žádná část profilu ve vzduchu), je ⚠ \`thread.no-reach\` vždy.
- Na **výkrese** se modelované závity kreslí zjednodušeně (ISO 6410): hladký válec / díra s označením „M18×1,5 dl. 18“;
  skutečná šroubovice je jen v 3D a ve STEP (přesná projekce šroubovice by trvala minuty).

## Zpětná vazba a doporučený postup pro agenta

1. Otevřete https://www.mnastrojarna.cz/cad, zavřete úvodní obrazovku (Pokračovat v práci / Esc).
2. Nápověda → Textové příkazy (Ctrl+Shift+K). Vložte příkazy, Provést.
3. Přečtěte protokol: řádky ✗ mají důvod (např. „žádná hrana neodpovídá pravidlu“, „Hloubka díry musí být
   kladná“). Opravte a spusťte znovu jen opravené řádky – příkazy se **připojují** k dokumentu; chybný prvek opravíte
   \`upravit "Díra 1" diameter=10\`, \`smazat "Díra 1"\` ho smaže, \`smazat poslední\` smaže poslední prvek a \`zpět\` vrátí
   celý poslední běh (krok historie).
4. \`stav\` vrátí rozměry (X/Y/Z rozsah), objem, řádek Geometrie (platná / neplatná / bez tělesa), počet ploch a hran
   a seznam prvků se stavem ✓ / ⚠ / ✗ – podle toho ověřte, že model odpovídá výkresu (např. 165 × 165 × 48 mm).
   Jednotlivé rozměry, díry a polohy ověříte příkazem \`měřit\` (oddíl „Měření“).
   Pracujete-li podle předlohy, na konci vždy proveďte **kontrolu 1:1** (oddíl „Model nebo výkres podle předlohy“).
   U sestavy přibude řádek Sestava (komponenty, obálka, objem, hmotnost) a Kolize (\`kolize\` spustí kontrolu).
5. Výstupy přímo z konzole, bez dialogů a bez klikání: \`uložit\`, \`export step\` (s kontrolou „věrná kopie modelu“),
   \`výkres export pdf\`, \`sdílet\` (adresa na řádku \`URL: …\`) – viz „Výstupy z konzole bez dialogů“. Stejná místa
   v nabídce Soubor (Export 3D, Výkres → PDF/DXF/DWG, Sdílet odkazem, Uložit projekt) v automatizaci také stahují rovnou.

Historie prvků v levém panelu, formuláře, nabídky i pás karet mají textové popisky (title/aria-label), takže
fungují i s čtečkou stránky. Konzole má textové pole s popiskem „Textové příkazy nebo JSON“ a výstup s popiskem
„Protokol“ (\`data-agent-output\`).

## Omezení

- Pravidla hran/ploch pracují s polohou vůči obálce tělesa (horní = nejvyšší Z apod.) a s typem křivky; u složitých
  tvarů raději zadejte geometrii tak, aby pravidla byla jednoznačná, nebo použijte JSON s indexy.
- Konzole nepřistupuje k souborům na disku (bezpečnost prohlížeče) – soubor předá skript přes \`window.mncad.importFile()\`
  (obsah jako base64 / text), nebo ho člověk přetáhne do okna.
- Dokumentace pro lidi: https://www.mnastrojarna.cz/cad/dokumentace (PDF: /cad/mnastrojarna-cad-prirucka.pdf).

## Jeden engine v prohlížeči i bez něj (CLI \`mncad\`, HTTP \`mncad serve\`)

Textové příkazy provádí vždy tentýž engine (\`engine/run.ts\` + obsluhy \`engine/ops/*\`): konzole a \`window.mncad.run\`
v aplikaci, \`mncad run skript.txt\` i \`POST /run\` dávají stejné výsledky (stejné prvky, čísla, hlášky). Rozdíl je jen
v hostiteli:

- **Příkazy pro 3D okno** (\`zobraz …\`, \`řez …\`, \`vyber …\`, otevření výkresu \`výkres\`, \`pohyb přehrát\`) mají
  v CLI/HTTP jen záznam ℹ \`ui.no-view\` („bez 3D okna nemá příkaz účinek“) – nic se nezmění, běh pokračuje.
- **Výstupy textem** (\`uložit\`, \`export …\`, \`výkres export …\`, \`skica export dxf\`, \`sdílet\`, \`odkaz\`) fungují v CLI/HTTP
  stejně jako v aplikaci: soubor jde do \`--out\` (HTTP \`files\`), řádek F – viz „Výstupy textem – soubory, PDF všech
  listů, base64, odkazy“ na konci. Navíc volby \`--formats step,pdf,…\` a \`--share\` (HTTP \`formats\`, \`share\`).
- **Akce jen pro aplikaci** (\`akce …\`, \`barva plochy\`, analýzy a formařské nástroje, \`výkres export png\`, export snímků
  pohybu) dávají v CLI/HTTP ✗ \`host.app-only\` – nikdy tiše. Výjimka: \`pružina tabulka …\` (= \`akce spring.table\`) čte jen
  dokument, provádí ji engine i v CLI/HTTP (řádek \`= … api … springs=1 name=… R=…N/mm Ln=…mm …\`).
- **Úlohy HTTP** (\`mncad serve\`): každý \`POST /run\` je úloha s id (\`j<n>\`, nebo vlastní \`"id": "…"\` v těle – pak ji lze
  zrušit ještě před odpovědí); \`GET /runs\` a \`GET /run/<id>\` vrátí stav (čeká ve frontě relace / počítá / dokončeno /
  zrušeno / chyba), \`DELETE /run/<id>\` úlohu zruší: čekající se neprovede, běžící se přeruší ukončením vlákna (odpověď
  jejího \`POST /run\` = protokol ✗ \`run.cancelled\`, relace zůstane ve stavu před úlohou).
- **\`otevřít "soubor"\`** (EN \`open\`, DE \`öffnen\`) otevře dokument ze vstupních souborů v nové záložce: v CLI soubory
  ve složce \`--files\` a ve složce skriptu, v HTTP klíče \`files\`. Formáty .mncad / JSON, STEP (velká sestava se rozdělí na
  díly jádrem), BREP, STL, OBJ, 3MF, DXF jako skica. Chybějící soubor = ✗ \`file.missing\` se seznamem dostupných.
  Totéž dělá volba \`--open soubor\` (HTTP \`open: [...]\`) ještě před skriptem.

\`\`\`
otevřít "deska.mncad"
zaoblit 1 hrany svislé
otevřít "kryt.step"
stav
\`\`\`

Chování, na které se lze spolehnout (v aplikaci i v CLI):

- Dokument vytvořený během (\`nový díl\`, \`nová sestava\`, JSON, normálie, \`otevřít\`) dostane **vlastní záložku** a nikdy
  nepřepíše jiný dokument – ani prázdnou sestavu z dřívějšího běhu konzole (prázdnou záložku znovu použije jen úvodní
  prázdný díl, do kterého žádný běh nezapsal). Skript lze tedy posílat po částech.
- **Opakovaný běh téhož skriptu** (\`window.mncad.run\` dvakrát, konzole, CLI \`--resume relace\`) nezaloží druhou sadu
  záložek. Platí pro **každý** dokument běhu – \`nový díl\`, \`nová sestava\`, \`normálie\`, \`otevřít\`, JSON dokument
  (\`window.mncad.setDocument\`), \`2d nový\`, rám formy, \`předloha otevřít\`: záložku stejného názvu a druhu, kterou
  **dřívější běh** založil **stejným druhem příkazu**, běh převezme – nahradí její obsah (jeden krok historie – \`zpět\` ho
  vrátí) a ohlásí to (✓ „… – znovu použitá záložka“ a ℹ \`doc.reused\`); stejné záložky, stejné objemy, žádné „Kvádr 2“.
  Druhy jsou dva: dokument **vytvořený** příkazem (\`nový díl\`, \`nová sestava\`, normálie, \`2d nový\`, rám formy…) a dokument
  **načtený** zvenku (\`otevřít\`, JSON / \`setDocument\`, \`předloha otevřít\`). Záložku jiného druhu běh nepřepíše –
  \`nový díl "Deska"\` nikdy nenahradí otevřený soubor „Deska“ ani ruční práci, \`--open\` nebo záložku z jiné karty
  prohlížeče: dokument jde do nové záložky a ℹ \`doc.name-taken\` to řekne. Volba na konci řádku \`nový díl\` / \`nová sestava\`:
  \`nový díl "A" nový\` (EN \`new\`, DE \`neu\`) = vždy nová záložka, \`nový díl "A" znovu\` (EN \`again\`, DE \`erneut\`) =
  převzít i záložku jiného druhu. Dokument s výchozím názvem (\`nový díl\` bez názvu, JSON bez názvu, „Nový díl 2“) se
  nepřevezme nikdy – pro opakovatelné skripty **pojmenujte každý dokument** a začněte jím každý blok (příkazy bez
  \`nový díl\` se přidají do otevřeného dokumentu). Převzetí je vidět vždy: ℹ \`doc.reused\` / \`doc.name-taken\` jsou ve
  stručném protokolu i bez \`--notes\` – víc dokumentů jedním řádkem s počtem a názvy
  (\`ℹ L1,L3,L5 ×3 doc.reused záložky z dřívějšího běhu použité znovu – …: „Deska“, „Čep“, „S“\`; s \`--notes\`, v plném
  protokolu a v JSON každý dokument zvlášť) – a Σ má \`reused=<n>\` / \`name-taken=<n>\`. V prohlížeči si aplikace
  záložky běhů pamatuje i po obnovení stránky v téže kartě (jen jejich id v sessionStorage).
- Každý dokument, který běh založil nebo změnil, se na konci postaví a změří (díl se znovu nestaví, výsledek je z ověření
  dílu během) a má řádek \`D\` s čísly (\`feat=\`, \`V=\`, \`m=\`, \`bbox=\`) v **plném** protokolu (\`--full\`,
  \`protocol: "full"\`) a v JSON (\`docs\`); prázdný dokument běhu (prázdná sestava) také. **Stručný** protokol (CLI výchozí,
  \`protocol: "short"\`) vypíše řádek \`D\` jen hlavního dokumentu a dokumentů s ✗ / ⚠ – čísla jiného dílu tedy čtěte z plného
  protokolu nebo JSON. Řádek \`D\` hlavního dokumentu má v rozpočtu 2 kB přednost před výpisy \`=\` (ustoupí jen ✗, ⚠ a \`F\`/\`O\`),
  takže ho mnoho měření nevytlačí do \`protocol-full.txt\`. Dokumenty dřívějších běhů relace beze změny se nestaví (\`V=-\`). Vedlejší dokument běhu bez tělesa
  (jen skica – profil, dráha) není chyba (\`V=-\`); ✗ \`build.failed\` „model nemá těleso“ dostane jen hlavní dokument.
- **Stručný protokol i v prohlížeči:** \`await window.mncad.run(text, { protocol: "short" })\` (nebo jen
  \`run(text, "short")\`) vrátí tentýž protokol MNCAD/1 jako \`mncad run … --formats none\` (≤ 2 kB, řádky D, F souborů, které
  skript zapsal – \`export step\` i s \`check=ok\`, Σ \`files=\`; liší se jen \`t=\`, \`slow=\`, \`mem=\` a id běhu \`run=\`); \`"full"\` = plný
  protokol, \`"json"\` = RunReport (s \`full\`), \`budget\` (celé číslo 1–1048576, jen \`short\` / \`json\`) a \`notes\`
  (true / false, ne u \`console\`) jako \`--budget\` / \`--notes\`, výchozí (\`"console"\`) = text konzole. Neznámá volba nebo
  hodnota (\`protocoll\`, \`budget: -5\`) je chyba, ne tichý jiný výstup. Značka přebytku \`… in protocol-full.txt\` znamená
  v prohlížeči: celý protokol vrátí \`protocol: "full"\`. Výchozí \`window.mncad.run(text)\` vrací dál text konzole
  (skripty agentů se nemění) – stručný protokol si vyžádejte \`{ protocol: "short" }\`.
- **Konzole Textové příkazy (vlna 22):** po běhu ukáže **souhrn** (stručný protokol MNCAD/1, přepínač **Stručný souhrn**
  je výchozí zapnutý a pamatuje se), **Detail** = plný text konzole (\`[data-agent-output]\`, i když je souhrn vidět),
  **Záznamy** = každý záznam s rozbalitelným detailem a **filtrem** (✗ chyby, ⚠ varování, obojí; dokument; text – díl,
  vazba, kód, id). **Historie běhů**: nový „Provést“ předchozí protokol nepřepíše – seznam „r3 · 12:41:05 · ✓12 ⚠2 ✗1 ·
  první řádek“ (posledních 20, \`[data-run-history-item]\`). **Stáhnout JSON** = \`mncad-run-r3.json\` (jako \`--json\`
  s plným protokolem). **Stabilní id záznamů**: každý záznam má v JSON \`id\` = \`L<řádek>.<kód>\` (\`L36.motion\`,
  \`L12.ok#2\` pro druhý stejný na řádku, \`L-.share.rejected\` bez řádku) – opakovaný běh téhož skriptu dá tatáž id;
  úplná reference je \`<run.id>:<id>\` (\`r3:L36.motion\`, \`[data-entry-id]\`). \`sestava pole\` vypíše souhrn (počet, první
  a poslední kopie s polohou), polohy všech kopií \`sestava komponenty\`.
- \`vložit "Díl"\` a \`výkres model "Díl"\` berou **aktuální** dokument záložky (i změněný v dřívějším běhu) pod jeho
  aktuálním názvem; po \`název "B"\` už starý název neplatí.
- Stav sestavy (řádek „Sestava: … obálka, objem Σ, hmotnost Σ“), stav vazeb, kusovník a kolize se počítají z dílů
  postavených v jádře **před** výpisem – i u sestavy vytvořené v témže běhu a hned v prvním \`stav\`. Sestava otevřená
  z JSON / relace bez příkazu vazby: stav vazeb se přepočítá sám („Vazby: 2 (2 ok)“). Totéž vrací \`window.mncad.status()\`.
- Stav vazeb a výsledek \`kolize\` patří **dokumentu** (id záložky), ne názvu: přejmenování ho zachová, jiná sestava
  (i téhož názvu) ho nepřebírá.
- Po restartu jádra (pád WASM, zrušený výpočet) se mezipaměti sestavy vyprázdní (ℹ \`asm.kernel-restarted\` u \`stav\`,
  \`kolize\`, \`výkres\` i příkazů sestavy) a díly se postaví znovu; plocha dílu, kterou jádro ani po novém postavení
  nevrátí, je ✗ \`asm.face-missing\`.
- \`pohyb export csv\` v CLI/HTTP zapíše soubor \`<sestava>-pohyb.csv\` (řádek F); výpis CSV zůstává i v protokolu.

Výpisy \`=\` stručného protokolu CLI/HTTP mají strojovou část **stejnou v cs/en/de** (\`= <řádek> <druh> "<dokument>"
<klíč=hodnota …>\`; čísla s tečkou, jednotka přilepená, vektory \`x,y,z\`, rozměry \`AxBxC\`, názvy v uvozovkách):

\`\`\`
= L11 measure "Uložení" comp="Čep" V=2.356cm3 m=0.0185kg area=1099.557mm2 bbox=10x10x30 min=35,25,10 max=45,35,40 com=40,30,25 rho=7.85 faces=3 edges=3 vertices=2 solids=1
= L12 measure "Uložení" a=Deska:F7 b=Deska:F3 dist=0mm angle=90deg angle.kind=linePlane parallel=0 perpendicular=1
= L14 drawing "Uložení" sheet=1/1 format=A3 orient=landscape scale=auto
= L15 status "Uložení" asm comp=2 parts=2 mates=2/2 V.sum=49.49cm3 m=0.39kg bbox=80x60x40 clash=-
= L2 asm "A" lines=2
  Záložky (1):
  1. A · díl · aktivní
\`\`\`

Pohybová studie (\`pohyb motor …\`, \`pohyb stav\`, \`pohyb spustit\`) má ve stručném protokolu **jeden** řádek – kroky, zdvih
tuhých skupin (komponenty, které se pohybují spolu: \`<zdvih>mm:<počet komponent>\`), stojící a natáčející se komponenty
a třídy kolizí v krocích, na konci motory (průběh, začátek > konec, směr); rozsah pohybu každé komponenty je v plném protokolu:

\`\`\`
= L364 asm "Střižný nástroj" motion steps=40 t=2 motors=1 conflicts=0 travel=50mm:36,20mm:1 static=33 clash.steps=41/41 thread=30 real=1 first.real=3 m1=range:0>-50:-
⚠ L364 clash.real "Střižný nástroj": v pohybu „Horní deska“ × „Pružina“ od kroku 3 (t = 0,15 s): kroků 38, dvojic komponent 4, …
\`\`\`

Řádek \`D\` sestavy v CLI/HTTP nese komponenty, různé díly, vazby, \`V.sum\`, \`V.union\`, hmotnost, **přesnou** obálku
(\`bbox=320x220x304\` – natočené díly změřené jádrem, ne rohy jejich lokálních obálek) a třídy kolizí. Sestava se před
souhrnem postaví celá – i otevřená z JSON / \`--open\` / relace: ⚠/✗ prvků dílů jejích komponent jdou do protokolu (jednou
na díl a prvek) a přísný režim na nich zastaví. Stručný protokol slučuje hlášky jednoho dílu se stejnou hláškou a jiným
prvkem do jednoho řádku (\`⚠ L76-L90 ×8 feature.warning "Matrice": 8 prvků: Výsledek má neplatnou geometrii … –
„Rotace 1, Vysunutí 2, …“\`) a stejně varování listů výkresu (\`… drawing.warning "Sestava": 5 listů: N ručních úprav kót
se nepodařilo přiřadit … – „01 Deska: 1, …“\`); plný protokol a JSON mají každý prvek / list zvlášť.

\`status\` má tytéž klíče jako řádek \`D\` (u dílu \`feat=✓/⚠/✗ V= m= bbox= solids= valid=1|0|unchecked\`, podle stavu
\`free=N\` – plochy mimo tělesa – a \`unchecked=N\` – prvky bez kontroly platnosti, které nejsou v \`feat\` mezi ✓; \`off=N\` – potlačené prvky). Výpis bez strojových údajů
(nápověda, záložky, kusovník, vazby, CSV) má v prvním řádku jen \`lines=<n>\` a jeho řádky jsou odsazené pod ním – to je
volný text v jazyce běhu. Lokalizovaný text měření a stavu (jako v konzoli) je v \`--full\` / \`protocol-full.txt\` a v JSON
\`entries[].detail\`; \`entries[].text\` je strojová část.

## Výstupy textem – soubory, PDF všech listů, base64, odkazy (aplikace, CLI, HTTP)

Výstupní příkazy provádí engine stejně v konzoli aplikace, v \`mncad run\` i v \`POST /run\`; liší se jen, kam soubor
jde: v aplikaci stažení bez dialogu (Stažené), v CLI do \`--out\` (řádek \`F <formát> "<soubor>" <bajty>B …\`, JSON
\`files[]\` s cestou a SHA-256), v HTTP do \`files\` odpovědi (\`return: "base64"\`). Názvy jsou bez diakritiky
(\`Deska.step\`, \`Deska_vykres.pdf\`); existující soubor v \`--out\` se nepřepíše – nový dostane „ (2)“ (ℹ \`out.renamed\`).

- **STEP / BREP** se po zápisu znovu načte jádrem a porovná s modelem (tělesa, plochy mimo tělesa, platnost, objem
  těles, obálka); řádek zápisu je ℹ „export STEP: … – zapsáno, kontrola níže“ (konzole „· kontrola níže“), ✓ nese jen
  kontrola; v přísném režimu proběhne kontrola před zápisem a soubor, jehož nález běh zastaví, se nezapíše (ani soubor
  bez tělesa / s volnými plochami, ani ⚠ \`out.reload-invalid\` – „soubor nezapsán (přísný režim zastaví běh) – …“): řádek F \`check=ok|fail\`, při rozdílu ⚠ \`out.check-failed\` (soubor nejde načíst = ✗). „→ věrná kopie
  modelu“ je **jen** soubor, který po načtení projde i **přesnou** kontrolou platnosti (do 400 ploch; jinak ✓ „→ odpovídá
  modelu; platnost souboru jen rychlou kontrolou …“), jinak ⚠ \`out.reload-invalid\` s počtem vadných ploch, a jen soubor
  s ≥ 1 objemovým tělesem a bez volných ploch: soubor bez tělesa = ✗ \`out.no-solid\` (i když
  odpovídá modelu z ploch), volné skořepiny / plochy vedle tělesa = ⚠ \`out.free-surfaces\` s počty (u sestavy jména
  komponent). STL / 3MF a \`export step bez kontroly\` soubor zpětně nečtou – posoudí složení modelu (stejné kódy). Objem a
  hmotnost (\`stav\`, řádek D, JSON, \`měřit těleso\`) jsou jen z těles: díl bez tělesa má \`V=- m=-\` a „objem –“. STEP má **stejné bajty při stejném modelu** (pevný čas
  \`2000-01-01T00:00:00\` v hlavičce, výchozí názvy produktů a výskytů sestavy bez pořadí exportu) – \`files[].sha256\`
  lze porovnávat mezi běhy.
- **\`výkres export pdf dokument\`** (EN \`drawing export pdf document\`, DE \`zeichnung export pdf dokument\`) = **jedno PDF**:
  všechny listy všech výkresů dokumentu a u sestavy i výkresy dílů uložené v jejích komponentách (každý zdrojový díl
  jednou, i z podsestav); list sestavy s kusovníkem, balónky a hmotností jako ve výkresovém prostředí. Stránek = listů
  (konzole „výkres PDF, listů N“, řádek \`F pdf "…" …B sheets=N\`). **\`výkres export pdf vše\`** = listy aktivního výkresu;
  **u sestavy, jejíž komponenty nesou výkresy dílů, je \`vše\` totéž co \`dokument\`** (všechny listy včetně dílů) – jen
  list sestavy dá \`list 1\`. DXF / DWG / SVG s \`dokument\` = ZIP \`<základ>_<formát>.zip\` se souborem na list (jeden list
  = \`<základ>.dxf\`); CSV = kusovník. \`výkres export png\` jen v aplikaci (CLI ✗ \`host.app-only\`). Dokument bez výkresu:
  ⚠ \`drawing.default-sheet\` a exportuje se výchozí list (stejně u \`--formats pdf\`; \`--strict\` ho zastaví). 2D výkres
  (\`2d nový …\`) se exportuje příkazem \`2d export dxf|dwg\` (v CLI soubor do \`--out\` s řádkem F, stejně \`2d tisk\` = PDF
  rozvržení a \`--formats dxf,dwg\`) – \`výkres export\` na něm dá ✗ s tímto důvodem.
- **CLI \`--formats auto\`** (výchozí) = STEP hlavního dokumentu + \`.mncad\` + jedno PDF všech listů (jako \`výkres export pdf
  dokument\`, má-li výkres dokument nebo díl v jeho komponentách); \`--formats pdf\` totéž PDF, \`dxf|dwg|svg\` soubor na
  list, \`csv\` kusovník sestavy. Listy spočítané v běhu (\`výkres export pdf dokument\`) převezme \`--formats pdf\` téhož
  nezměněného dokumentu bez druhého výpočtu.
- **\`… base64\`** na konci \`uložit\`, \`export …\`, \`výkres export …\`, \`skica export dxf\` (pro agenta v prohlížeči v cloudu,
  který ke staženým souborům nedosáhne): soubor se nestáhne ani nezapíše; konzole (a text z \`window.mncad.run\`) má řádek
  \`BASE64 "<soubor>" <bajty>B <data>\`, stručný protokol \`= L<n> file "<dokument>" name="…" format=… bytes=… sha256=…
  base64=<znaků>\`, data jsou v plném protokolu a v JSON \`entries[].data.base64\` – stručný protokol proto vždy končí značkou
  \`… <n> entries <bajty>B in protocol-full.txt\` a CLI zapíše \`<out>/protocol-full.txt\` (data jsou tam odsazený řádek pod
  řádkem \`= … file\`; HTTP: soubor \`protocol-full.txt\` ve \`files\`). Nejvýš 2 MB (2 097 152 B), větší soubor = ✗
  \`out.too-big\`. \`jako base64\` nebo \`"base64"\` v uvozovkách = soubor s názvem „base64“ (slovo v uvozovkách je vždy název).
- **\`… odkaz\`** (EN / DE \`link\`) na konci \`uložit\`, \`export …\`, \`výkres export …\`, \`skica export dxf\`: soubor se v prohlížeči
  (v CLI ve vlákně běhu) zašifruje (AES-GCM, náhodný 128bitový klíč) a nahraje do úložiště odkazů webu (jako sdílený
  dokument, platnost 10 dní); protokol vypíše \`URL: …/cad/soubor/index.html#f=<id>.<klíč>\` a \`= L<n> file "<dokument>" name="…"
  … url=… exp=<datum>\`. Odkaz otevře malou stránku, která soubor v prohlížeči dešifruje a nabídne ke stažení (název,
  velikost, SHA-256) – odkaz lze předat člověku. Úložiště neodpovídá / není nastavené = ✗ \`share.store-unavailable\` (text
  uvádí adresu úložiště, např. z \`--share-store\`), odmítne zápis = ✗ \`share.rejected\`. Úložiště, které na \`?ping\`
  odpoví, ale nahrávání nedokončí, má časový limit (20 s + 10 ms na kB jednoho požadavku) → ✗ \`share.store-unavailable\`
  a běh pokračuje dalším řádkem. \`jako odkaz\` nebo \`"odkaz"\` (EN \`"link"\`) v uvozovkách = soubor s názvem „odkaz“;
  samotné \`odkaz\` dál vypíše poslední sdílený odkaz.
- **Sdílení**:
  - \`sdílet\` = krátký odkaz přes úložiště; úložiště neodpovídá → dlouhý odkaz a ⚠ \`share.fallback-link\` (s délkou
    odkazu); úložiště zápis odmítne (403, limit za hodinu, plné) → ✗ \`share.rejected\` s důvodem serveru + ⚠
    \`share.fallback-link\` s dlouhým odkazem.
  - \`sdílet úložiště\` (EN \`share store\`, DE \`freigeben speicher\`) = **jen krátký odkaz** (pod 200 znaků); bez úložiště ✗
    \`share.store-unavailable\`, nikdy tichý dlouhý odkaz. \`sdílet úložiště nebo odkaz\` (\`share store or link\`,
    \`freigeben speicher oder link\`) = jinak dlouhý odkaz s ⚠.
  - \`sdílet odkazem\` = celý dokument v adrese; delší než **4096 znaků** → ⚠ \`share.long-link\` – prohlížeč agenta
    v cloudu delší adresu odmítne, použijte \`sdílet úložiště\`.
  - Platnost: výchozí 10 dní; v úložišti nejvýš **90 dní** – \`sdílet 200 dní\` dá krátký odkaz s platností 90 dní a
    ⚠ \`share.days-clamped\`. \`sdílet úložiště bez omezení\` = ✗ \`share.days-unlimited\` (bez dotazu na úložiště); bez
    omezení jen \`sdílet odkazem bez omezení\` (nebo \`sdílet úložiště nebo odkaz bez omezení\` = dlouhý odkaz s ⚠).
    Úložiště, které při nahrávání přestane odpovídat (časový limit jako u \`… odkaz\`), je nedostupné úložiště: u
    \`sdílet úložiště\` ✗ \`share.store-unavailable\`, u výchozího \`sdílet\` dlouhý odkaz s ⚠ \`share.fallback-link\`.
  - Řádek \`O <url> exp=<YYYY-MM-DD|none> mode=self|store|link\` – režim podle skutečného výsledku: \`self\` = vlastní úložiště
    webu, \`store\` = Supabase, \`link\` = celý dokument v adrese. Řádek O se ve stručném protokolu **nikdy nevynechá**
    (jako hlavička a Σ), ale dlouhý odkaz nesmí vytlačit ✗ a ⚠: odkaz delší než 200 znaků, který se do rozpočtu vedle nich
    nevejde, je zkrácený na \`O <prvních 64 znaků>…(<délka>chars) exp=… mode=link\` – celý je v \`protocol-full.txt\`
    (počítá se do značky přebytku), v JSON \`share.url\` a v konzoli (\`URL: …\`). Krátké odkazy úložiště se nezkracují.
    \`odkaz\` vypíše poslední odkaz znovu (i řádek O).
  - **Každý odkaz běhu má vlastní výpis \`=\`** (vlna 22): \`= L<n> link "<dokument>" url=<adresa> mode=self|store|link
    exp=<YYYY-MM-DD|none> view=model|drawing pw=0|1 bytes=<obsah> chars=<délka odkazu> content=part|asm|draft comp=<komponent>
    parts=<různých dílů> sheets=<listů výkresu> files=<příloh> [features=<prvků dílu>]\` – tři \`sdílet\` v jednom běhu = tři výpisy
    s třemi adresami (stručný i plný protokol, JSON \`entries[].data\` a \`shares[]\`; \`share\` = poslední, řádek O). Dlouhý
    odkaz má ve výpisu \`=\` zkrácenou adresu \`…(<délka>chars)\` – celá je v JSON a na řádku O (poslední odkaz) a v plném
    protokolu (řádek O pro každý odkaz). Konzole prohlížeče vypíše u každého odkazu \`URL: …\` a \`obsah odkazu: …\`.
  - **Úložiště vypnuté** (CLI \`--share-store off\`, hostitel bez úložiště): dlouhý odkaz s ℹ \`share.store-off\` („úložiště
    krátkých odkazů je vypnuté – dokument je celý v odkazu (N znaků)“) – vidět i ve stručném protokolu. Náhradní dlouhý
    odkaz vede vždy na stránku CADu (\`MNCAD_ORIGIN\`, jinak https://www.mnastrojarna.cz/cad), nikdy na web nedostupného
    úložiště z \`--share-store\`.
  - **Ověření odkazu textem:** \`odkaz ověřit [<odkaz|kód>] [heslo X]\` (EN \`link verify\`, DE \`link prüfen\`) otevře odkaz
    jako příjemce a nic nezmění: \`✓ odkaz se otevře (288 znaků, dokument v odkazu, platí do: 20. 12. 2026, model): díl
    „Konzola“ – prvků 1, listů výkresu 0, příloh 0\` + \`= L<n> link "<dokument>" url=… ok=1 mode=… exp=… chars=… content=…\`;
    nefunkční odkaz = ✗ \`share.link-broken\` \`odkaz se neotevře (<důvod>): <text>\` + \`= … ok=0 reason=<důvod> chars=…\`.
    Důvody: \`truncated\` = **useknutý** (data končí předčasně – zkopírujte celý odkaz), \`corrupt\` = **změněný** (data
    úplná, ale jiná), \`password\` (chybí / nesprávné heslo; u šifrovaného dlouhého odkazu nejde useknutí od špatného hesla
    odlišit – text to řekne), \`expired\`, \`revoked\`, \`notfound\`, \`network\`, \`insecure\`, \`unrecognized\` (text není
    odkaz ani kód). Odkaz s kódem se ověří u úložiště webu, ze kterého je (\`<web>/cad/share/\`). Totéž rozlišení ukáže
    prohlížeč při otevření useknutého odkazu.
  - Příklad výstupu sdílení (CLI \`mncad run skript.txt --share-store off\`, stručný protokol; platí pro protokol MNCAD/1
    a CAD od vlny 22 – 20. 11. 2026, verzi CLI vypíše \`mncad --version\`; test \`share-doc-example.test.ts\` porovnává
    tyto řádky se skutečným výstupem):

\`\`\`
# skript:
nový díl "Konzola"
kvádr 80 50 12
sdílet
sdílet odkazem dní 30
odkaz ověřit
# stručný protokol:
MNCAD/1 OK lines=5 ops=5 err=0 warn=0 note=2 t=0.1
ℹ L3 share.store-off "Konzola": úložiště krátkých odkazů je vypnuté – dokument je celý v odkazu (288 znaků)
= L3 link "Konzola" url=https://www.mnastrojarna.cz/cad#s=1d.RY9LboQwEAWvEr11RzIwJKSvMEd…(288chars) mode=link exp=2026-11-30 view=model pw=0 bytes=188 chars=288 content=part comp=0 parts=0 sheets=0 files=0 features=1
= L4 link "Konzola" url=https://www.mnastrojarna.cz/cad#s=1d.RY9BTsQwEAS_gvo8SE5WIWG-wBO…(288chars) mode=link exp=2026-12-20 view=model pw=0 bytes=188 chars=288 content=part comp=0 parts=0 sheets=0 files=0 features=1
= L5 link "Konzola" url=https://www.mnastrojarna.cz/cad#s=1d.RY9BTsQwEAS_gvo8SE5WIWG-wBO…(288chars) ok=1 mode=link exp=2026-12-20 chars=288 content=part comp=0 parts=0 sheets=0 files=0 features=1
D "Konzola" part feat=1/0/0 V=48cm3 m=0.377kg bbox=80x50x12 solids=1 valid=1
O https://www.mnastrojarna.cz/cad#s=1d.RY9BTsQwEAS_gvo8SE5WIWG-wBOiHIZ4FhkltmUb77JRHsNb-BhKLlxL6ir1hgpuCHqP4KZ_7fuX9tJ1Qz8QqtMbGGuwuoBgwwzeIDEe0EsuKXxK8vI8iwWhasoueHBL8LIqGG_BP8IiIKxSNDlZwAjzqbuqlK-kGTxucPZw6sXW4QP_8_r7Y9NTA0L5jgd5D3cQsnsoeBwMdYaadiLEkF0546MhQ2YizOqLJrXgqyxZ6fwBhtcb9mnf_wA exp=2026-12-20 mode=link
Σ docs=1 V=48cm3 m=0.377kg files=0 share=link t=0.1
\`\`\`
  - Tvary odkazu (část za \`#\` se na server nikdy neposílá):
    \`…/cad#q=<id 10 znaků>.<klíč 22 znaků base64url>\` – vlastní úložiště, obsah AES-GCM, 128bitový klíč jen v odkazu;
    \`…/cad#s=1d.<data>\` – data = base64url(deflate-raw(JSON \`{"v":1,"exp":<ms|null>,"from"?,"view":"model|drawing","doc":{…}}\`)),
    \`#s=1dp.<sůl>.<data>\` totéž s heslem (AES-GCM, klíč PBKDF2-SHA-256), \`#s=1r.<data>\` bez komprese;
    \`…/cad#r=<cesta>.<klíč>[.p<sůl>]\` – úložiště Supabase. V Node odkaz otevře \`openShareLink(parseShareHash(hash))\`
    (share.ts).
- Mnoho souborů a málo místa ve stručném protokolu: místo jednotlivých řádků F jeden souhrnný
  \`F <formát|mixed> "*" <bajty>B files=<n> formats=… [check=ok|fail] [run=fail]\`; jednotlivé soubory jsou v
  \`protocol-full.txt\` a v JSON \`files\`.

\`\`\`
nový díl Deska
kvádr 80 60 10
díra 10,5 skrz v 40 30
výkres A3 na šířku pohledy přední,horní
export step
výkres export pdf dokument
export step base64
\`\`\`

\`\`\`
F step "Deska.step" 20513B check=ok
F pdf "Deska_vykresy.pdf" 79021B sheets=1
= L7 file "Deska" name="Deska.step" format=step bytes=20513 sha256=5a64… base64=27352
O https://www.mnastrojarna.cz/cad#q=Ab3kZ9xQ2m.0f8KxZ1v3QpL7cR2mT9wYA exp=2026-11-24 mode=self
… 1 entries 27355B in protocol-full.txt
\`\`\`

## Kontrola modelu, porovnání s referencí a třídy kolizí (\`kontrola\`, \`porovnat\`, \`kolize\`)

**\`kontrola [díl "A" | sestava | vše] [díry] [polohy]\`** (EN \`check\`, DE \`prüfen\`) vypíše kontrolní tabulku – vždy
přesně z B-rep (nikdy ze sítě): objem, hmotnost, hustota, obálka (min..max), počet těles, platnost (BRepCheck). V dílu
i tabulka děr: souosé úseky jsou sloučené (zahloubení + vrtání = jedna díra), díra je spojená s prvkem díry / závitu podle
osy a polohy (závit, hloubka závitu, zahloubení, dno plochý / kužel s úhlem hrotu). \`polohy\` přidá středy vstupů. \`dir\` =
smysl vrtání od vstupu do materiálu; u průchozí díry je vstup na straně polohy prvku (\`díra 8,5 skrz v 20 0 20 směr 0 1 0\`
→ \`at=20,0,20 dir=+Y\`), u zahloubené na straně zahloubení. Uvozený název ve výpisu je kontrolovaný díl: \`kontrola díl "Beta"\`
z jiné záložky vypíše \`= … check "Beta" part …\` (i JSON \`entries[].doc\` = \`Beta\`), v sestavě název komponenty.

\`\`\`
= L7 check "Spodní deska" part V=2347.216cm3 m=18.426kg rho=7.85 bbox=0,0,0..300,200,40 solids=1 valid=1 holes=9
= L7 check "Spodní deska" holes=9 rows=4
  hole d=8 depth=20 bottom=cone tip=118 n=2 at=60,60,40;240,60,40 dir=-Z
  hole d=8.5 depth=25 bottom=cone tip=118 thread=M10 tdepth=20 n=4 at=30,25,40;90,25,40;150,25,40;210,25,40 dir=-Z
  hole d=11 through=1 cbore=18x11 n=1 at=150,100,40 dir=-Z
  hole d=25 through=1 n=2 at=15,100,40;285,100,40 dir=-Z
\`\`\`

- \`rho.assumed=1\` = materiál je zadaný jen označením (\`materiál EN AW-6082\`) a hustota je hustota třídy (ocel 7,85) –
  pro správnou hmotnost zadejte třídu (\`materiál hliník\`).
- ⚠ \`check.hole-missing\` = prvek díry (nebo některá jeho poloha) nemá v geometrii díru (díru zakryl pozdější prvek, nepostavila
  se); ⚠ \`check.invalid\` = těleso dílu není platné – export STEP a výpočty mohou selhat. Obě patří dílu, ne sestavě:
  \`⚠ L11 check.hole-missing "Deska B": prvek díry „Díra 2“ …\` (JSON \`doc\` = díl, \`data\` = \`{ part, feature, missing,
  expected }\`) – stejně pojmenované prvky různých dílů se tak nepletou.
- JSON \`data\` dílu: \`{ part, volume_mm3, mass_kg, density, densityAssumed, bbox, solids, valid, holes }\`, řádek děr
  \`{ d, through, depth?, bottom?, tipAngle?, tipDepth?, thread?, threadDepth?, cbore?: [Ø, hloubka], csink?: [Ø, úhel], axis,
  positions, n, features }\` – \`axis\` = jednotkový směr vrtání, \`positions\` = středy vstupů, \`features\` = spojené prvky.
- V sestavě (\`kontrola\` v otevřené sestavě nebo \`kontrola sestava\`): jeden souhrnný řádek \`asm comp= parts= V.sum= V.union= m=
  bbox= mates= clash=N(thread=…,underhead=…,real=…,undetermined=…) valid=K/N\` a výpis \`parts=N\` s řádkem
  \`part "Název" n=ks V= m= rho= bbox= solids= valid=\` na každý různý díl (výpis má v rozpočtu stručného protokolu nejnižší
  prioritu – celý je v \`protocol-full.txt\`). \`V.sum\` = součet objemů komponent, \`V.union\` = sjednocení bez překryvů
  (V.sum − průniky dvojic z kontroly kolizí; přesné, pokud se v jednom místě nepřekrývají tři komponenty). Obálka je přesná
  (natočení o násobky 90° z lokální obálky, jiná natočení měřením komponenty na místě). \`díry\` nebo \`vše\` přidá pod každý díl
  jeho tabulku děr. \`kontrola díl "Deska"\` v sestavě zkontroluje díl komponenty (název, cesta \`Rám/Deska\` nebo \`#3\`).

**Kolize šroub × závit** (\`kolize\`, \`kontrola sestava\`) se třídí geometricky, bez tabulek závitů: dvojice je ℹ
\`clash.thread\` (počítá se, nevypisuje se, přísný režim nezastaví), když má jedna komponenta prvek závitové díry
(\`díra … závit M10\`) nebo vnitřní závit, průnik je souosý s její dírou (úhel < 0,5°, osy < 0,05 mm) a leží v mezikruží
[poloměr díry − 0,02; D/2 + 0,02] × hloubka díry (D z označení \`M10\`, \`M10x1\` → 10). Malý prstenec u vstupu (do 0,1·D,
nejvýš max(1 mm³, 5 % průniku) – přechod pod hlavou, sražení) = ℹ \`clash.underhead\`. Všechno ostatní je ⚠ \`clash.real\`
s objemem: šroub mimo osu, delší než díra, M12 v díře M10, kolík s přesahem v hladké díře (bez závitového prvku je každá
kolize skutečná). Neznámé označení (G 1/4, UNC…) = ⚠ \`clash.undetermined\`. Výpis \`= clash "Sestava" total=27 thread=27
underhead=0 real=0 undetermined=0\`; JSON \`entries[]\` s kódem \`clash.thread\` nese \`data\` (díra, objem v pásmu a mimo něj).
Řádek \`D\` sestavy v CLI má po \`kolize\` / \`kontrola sestava\` třídy kolizí (\`clash=27(thread=27,real=0)\`) – vždy pro
**konečný stav** sestavy: změní-li se sestava po kontrole (vložená / posunutá / skrytá komponenta, upravený díl), CLI kolize na
konci běhu přepočítá (ℹ \`clash.rechecked\` s řádkem původní kontroly, nové ⚠ \`clash.real\` jako \`L-\`, \`--strict\` je
zastaví); textový stav (\`stav\`) takový výsledek označí \`clash.stale=1\` a „NEPLATÍ: sestava se od kontroly změnila“. Šrouby
ISO 4762 / ISO 4017 z knihovny i ze šroubového spoje (\`sestava šroub\`) nemají prstenec pod hlavou (hlava se srazí dřív, než
se přidá dřík) – v průchozí díře ani na podložce se se sevřeným dílem neprotnou; \`clash.underhead\` zůstává pro šrouby uložené
starší verzí a pro vlastní modely.

**Třídy, místo a pravidla kolizí** (vlna 22): každý výstup – protokol \`kolize\`, \`stav\`, řádek \`D\`, panel Kolize v aplikaci,
zvýraznění ve 3D, souhrn pohybové studie i \`window.mncad.motion()\` – čte TÝŽ zařazený seznam, nikdy surové průniky. Třídy:
⚠ skutečná (\`clash.real\`), ⚠ nevyhodnotitelná (\`clash.undetermined\`), ℹ pracovní kontakt (\`clash.work\`), ℹ dotyk
(\`clash.touch\`), ℹ pod hlavou, ℹ šroub v závitu. Dvojice nese **instanci** (\`„Šroub M12 [S2]“\` přezdívka, \`„Blok #2“\` pořadí,
v podsestavě \`„Horní skupina › Šroub M12 [S1]“\`) a **místo** průniku (těžiště a obálka ve světových souřadnicích:
\`– místo [50; 30; 28,5] · obálka 18 × 18 × 3 mm\`; JSON \`entries[].data.items[]\` = \`a, b, aPath, bPath, volume, at, box, depth\`).
Opakované nálezy se seskupí (stejná třída, stejné díly, objem v toleranci 2 %): \`⚠ 4× kolize „Přidržovač“ × „Šroub M12“ [#3, #4,
#5, #6] (365,2 mm³)\`. **Dotyk**: průnik tenčí než tolerance (\`kolize tolerance 0,01\`, výchozí 0,01 mm; tloušťka = 2·V/S
nejtlustšího kusu) – přesah 0,0001 mm dvou desek je ℹ \`clash.touch\`, ne kolize (výpis \`= clash … touch=1\`, D \`clash=3(thread=0,
real=2,touch=1)\`). **Jádrová díra bez prvku závitu** (hladká díra Ø10,2, importovaný díl) se šroubem Ø12 = ⚠ \`clash.undetermined\`
s nápovědou „zadejte díru se závitem, nebo pravidlo“ – ne skutečná kolize; hlava nebo konec dříku v plném materiálu zůstanou
skutečnou kolizí. **Pravidla** (\`doc.clashRules\`, jeden model i pro procesní vrstvu): \`kolize pravidlo pracovní "Razník"
"Plech" kroky 10..20\` nebo \`… pohyb "ZDVIH" 30..27\` (hodnota motoru vazby; staticky hodnota vazby v dokumentu) = pracovní
kontakt nástroj × plech jen v okně operace, mimo okno zůstává ⚠; \`kolize pravidlo závit "Deska A" ["Šroub M12"]\` = šroub
v hladké jádrové díře je závitový záběr (třída podle pásma závitu). Pravidla se uplatní hned nad uloženou kontrolou (geometrie
se nemění – výsledek neplatnost nezíská); \`kolize pravidla\` je vypíše, \`kolize pravidlo 2 smazat\` odebere, skript dokumentu
je přenáší. \`kolize seznam [skutečné|závit|dotyk|pracovní|závady|vše]\` = výpis po skupinách s filtrem. V pohybu \`clash.steps=K/N\`
počítá jen kroky se skutečnou (nebo nevyhodnotitelnou) kolizí, šrouby v závitu zvlášť (\`thread=\`), na konci \`touch=\` /
\`work=\` (jen nenulové). Panel Kolize: přepínače tříd s počty (\`data-clash-filter\`), skupiny (\`data-clash-group\`,
\`data-clash-cls\`), u závady „Pracovní kontakt…“ / „Je to závit“, pravidla a tolerance dotyku; ve 3D svítí jen listy se závadou.

**Vůle a spojitá kontrola v pohybu** (vlna 22, bod 6): **žádný průnik není „bez kolizí“ ani „nic nedře“.** Statická \`kolize\` bez
průniku hlásí \`kolize: žádný průnik (objem nad 0,001 mm³) – N komponent · vůle nekontrolována\` (žádné ✓), panel Kolize „Bez průniku ·
vůle nekontrolována“, \`stav\` „Kolize: žádný průnik · vůle nekontrolována“. **Kolize v pohybu se kontrolují i mezi kroky** (výchozí,
\`pohyb kolize spojitě\`): úsek mezi dvěma polohami se dokáže mezí posunu (díly se nemohou dotknout), u čistého posuvu přesnou
dráhou z jádra (těleso B ∪ hranoly ploch B – nůž 1 mm přes kolík Ø2 mezi kroky 5 mm od sebe se najde), jinak se půlí
(mezipoloha z řešiče; v dynamice zaznamenané snímky). Kontakt mezi kroky = ⚠ \`clash.real "S": v pohybu „Kolík“ × „Nůž“ mezi kroky
17 a 18 (zjemněno: poloha 17,5, t = 0,972 s, motory 99,5): průnik 19,132 mm³ – v krocích samotných není\`. Souhrn vždy říká, JAK
se kontrolovalo: \` kontrolováno spojitě i mezi polohami (37 poloh + 36 mezipoloh ze zjemnění; …)\` / \` spojitě jen částečně: …
nepotvrzeno v N úsecích (od kroku …; dotyk bez objemu v poloze …) – tam jen v polohách\` (⚠ \`clash.uncertain\`) / \` kontrolováno
jen v 37 polohách (diskrétně, posun mezi polohami až 5 mm) – mezi polohami nekontrolováno\` (ℹ \`clash.discrete\`, po \`pohyb kolize
diskrétně\`). Díl klouzající po ploše (dotyk bez objemu) se u posuvu potvrdí objemem průniku s dráhou; při natáčení zůstane
„nepotvrzeno“. Strojový řádek \`= … motion …\` končí \`clash.mode=continuous|partial|discrete clash.poses=37 clash.refined=36
clash.maxstep=5mm [clash.unproven=N] [clash.between=1 first.between=17.5]\`.
**Sledovaná vůle** (\`MotionStudy.clearance\`): \`pohyb vůle "Střižník" "Vodítko" min 0,05\` (další dvojice dalším příkazem; EN
\`motion clearance … min 0.05\`, DE \`bewegung spiel … min 0,05\`), \`pohyb vůle pohyblivé min 0,1\` (všechny pohyblivé díly vůči
ostatním blíž než limit + rezerva), \`pohyb vůle bez zjemnění\`, \`pohyb vůle\` (nastavení a výsledek), \`pohyb vůle seznam\`, \`pohyb vůle
"A" "B" smazat\`, \`pohyb vůle smazat\`. Vzdálenost (BRepExtrema) v každé poloze, zjemnění tam, kde by mezi polohami mohla být menší;
souhrn \`Vůle „Střižník“ × „Vodítko“: nejmenší 0,01 mm v kroku 0 (t = 0 s) – místo [25; 20; 10] ↔ [25,01; 20; 10] · ⚠ pod limitem
0,05 mm v 11 z 11 poloh (kroky 0–10)\` + ⚠ \`clash.clearance\`; nad limitem „limit … dodržen v celém pohybu (spojitě i mezi polohami)“
jen se zjemněním bez nepotvrzených úseků, jinak „dodržen v N polohách (mezi polohami nepotvrzeno)“. Strojová pole na konci řádku
pohybu: \`clear.min=0.01 clear.limit=0.05 clear.below=11/11 clear.at=0 clear.pairs=1\` (\`clear.min=2.5+\` = jen dolní mez z obálek,
\`clear.at=17-18\` = mezi kroky; \`clear.below=N/M\` počítá JEN polohy kroků – minimum pod limitem nalezené mezi kroky je zvlášť
\`clear.below.between=K\` (K úseků) a v textu „mezi kroky 17 a 18 (poloha 17,438, t = 0,969 s, motory 99,188)“, takže
\`clear.below=0/37 clear.below.between=1\` = limit porušen mezi kroky; rozhoduje vždy \`clear.min\` < \`clear.limit\` a ⚠ \`clash.clearance\`).
Poloha / čas / motory v úseku jsou lineárně interpolované podílem dráhy – přesné u posunu úměrného motoru, jinak (klika, vačka)
přibližné, protokol pak připíše „přibližně“. \`pohyb krok N\` vypíše vůli kroku s body, CSV má sloupce \`Vůle A × B [mm]\`, \`window.mncad.motion()\`
vrací \`clearance\` (limit, min s dvojicí, polohou a body, dvojice s řadou po krocích), \`sweep\` (režim, polohy, zjemnění, největší
posun) a \`between\` (kontakty mezi kroky). V aplikaci: Pohybová studie › „Vůle a spojitost kontroly“ (dvojice / pohyblivé díly,
limit, „Kolize i mezi kroky“), výsledek s tlačítkem „Na minimum“ a grafem vůle po krocích (\`data-clearance-chart\`), úsečka
nejbližších bodů v aktuálním kroku ve 3D i v náhledu bez WebGL (\`data-gap-label\`, pod limitem červená). Pružiny se mezi kroky
spojitě nekontrolují (mění tvar).

**Platnost výsledků (žádné falešné zelené):** každý uložený výsledek platí jen pro dokument + revizi geometrie + konfiguraci +
polohu mechanismu, pro které vznikl – na jinou záložku se nikdy nepřenese. Ve \`stav\` (řádek \`= … status\`): \`clash=-\` =
sestava kontrolována nebyla, \`clash.stale=1\` = kontrola je z jiného stavu sestavy; \`mates=N/M\` je vždy pro nynější stav (po
kroku zpět nebo změně se stav vazeb přepočítá), \`mates.stale=1\` + „NEPLATÍ pro polohy v dokumentu“ = polohy komponent
v dokumentu vazbám neodpovídají (typicky ručně psaný JSON) – uvedený stav platí až po přepočtu a \`sestava vazby\` to hlásí ⚠;
\`measure.stale=1\` / \`compare.stale=1\` + „Měření: výsledek L12 je pro revizi r·a1b2c3 – NEPLATÍ“ = poslední \`měřit\` /
\`porovnat\` tohoto dokumentu je z dřívější revize, příkaz zopakujte. Řádek \`D\` končí \`stale=clash,mates,motion,measure,compare\`
(jen druhy, které konečnému stavu neodpovídají; JSON \`docs[].stale\`) – kolize a vazby se před tím přepočítají, zůstává hlavně
měření a porovnání provedené před poslední změnou. Výsledek bez \`stale\` (\`kolize: žádný průnik\`, \`ok=1\`, \`mates=N/N\`) tedy
popisuje právě odevzdávaný stav. Ztracené reference po změně dílu nejsou nikdy zelené ani bez \`stale\`: vazba \`mates=…(lost=N)\`,
dosedací plocha pružiny \`springs.lost=N\` (řádek \`D\`, \`= … status\`, \`Σ\`, \`kontrola sestava\`; JSON \`docs[].springs\`) – délka a síla té
pružiny se nekontrolují, oprava \`sestava pružina "P" mezi "A" <plocha> "B" F5\` nebo \`sestava pružina "P" odebrat\`. V aplikaci totéž: panel Kolize má stavy ok / kolize / neplatí / nezkontrolováno
(\`data-clash-state\`) a u výsledku uvádí název sestavy, počet komponent, čas, revizi \`r·…\` a polohu.
Výstupy (vlna 22, bod 20): dokument s výkresy nebo záznamy exportů má v řádku \`D\` revizi modelu \`rev=r·a1b2c3\` (JSON
\`docs[].rev\`) a \`stale=\` navíc \`drawing\` (vydaný list ze starší revize modelu – \`výkres vydat\`) a \`export\` (záznam exportu ze
starší revize – \`exporty\`); \`stav\` pak má řádky „Revize modelu“, „Výkres: …“, „Exporty: …“ a strojově \`drawing.stale=N
export.stale=N\`. Přehled a opravy: \`výstupy zastaralé\`, \`přepočítat vše\`.

**\`porovnat "ref.step" [tolerance 0,05] [zarovnat auto|střed|ne] [díl "A" | sestava] [mapa ne] [přísně]\`** (EN \`compare\`,
DE \`vergleichen\`) porovná model se souborem reference (STEP, BREP, STL; sestava STEP jako jedno těleso) – stejný výpočet jako
okno Porovnat s referencí a \`window.mncad.compare\`; sestava se porovná jako složené těleso viditelných komponent. Soubor
reference: v CLI ve složce \`--files\` nebo ve složce skriptu, v HTTP klíč \`files\`, v prohlížeči přiložený soubor (tlačítko
**Připojit soubor…** v konzoli Textové příkazy nebo \`window.mncad.attach({ name: "ref.step", base64 })\`; seznam
\`window.mncad.attachments()\`, odebrání \`window.mncad.detach(název)\`). Název se všude hledá stejně: přesně, pak bez cesty
(\`refs/deska.step\` → \`deska.step\`), pak bez ohledu na velikost písmen (\`DESKA.STEP\`, jen jednoznačná shoda); v CLI vždy jen
mezi soubory složek \`--files\` / složky skriptu. Chybí-li, ✗ \`file.missing\` se seznamem dostupných.
Výchozí tolerance 0,1 mm a zarovnání \`ne\` (reference jak je); \`zarovnat auto\` zkusí i 24 otočení o 90° (u souměrného
dílu může vybrat otočenou polohu – pak \`moved=1\`), \`střed\` dá středy obálek na sebe.

\`\`\`
= L4 compare "Deska" ref=deska.step ok=1 tol=0.05 dV=+0% dV.mm3=0 extra=0mm3 missing=0mm3 regions=0 dev=+0/-0mm within=100% align=none

⚠ L4 compare.mismatch "Deska": model se od reference liší: chybí 0,283 cm³ u [20; 20; 5] – model má navíc díru / vybrání Ø8,00 (nebo mu chybí čep)
= L4 compare "Deska" ref=deska.step ok=0 tol=0.1 dV=-1.2033% dV.mm3=-282.743 extra=0mm3 missing=282.743mm3 regions=1 dev=+0/-1mm within=95.63% align=none
\`\`\`

\`ok=1\` = žádná rozdílová oblast nad prahem šumu a odchylka povrchu v toleranci. Mimo toleranci ⚠ \`compare.mismatch\` se
3 největšími oblastmi (materiál navíc / chybí, objem, střed, popis); s \`přísně\` je to ✗. Celý report (jako v okně) je
v \`protocol-full.txt\` / JSON \`entries[].detail\`. U velké sestavy, jejíž tělesa se navzájem překrývají (šrouby v závitových
dírách), bývají booleovské operace složeného tělesa nepřesné (objem navíc − objem chybí ≠ rozdíl objemů): pak
\`booleans=inexact\`, \`extra=- missing=- regions=-\`, ℹ \`compare.inexact\` a o shodě rozhodne rozdíl objemů (v mezích šumu)
a mapa odchylek v toleranci – vlastní STEP sestavy je tak shoda, skutečný rozdíl ukáže mapa nebo objem.
`;
