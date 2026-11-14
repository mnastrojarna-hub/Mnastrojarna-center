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
   dokument; \`await window.mncad.setDocument(docOrJson)\` ho otevře v nové záložce (\`{ inPlace: true }\` = nahradí otevřený
   dokument jako jeden krok historie); \`await window.mncad.undo(n)\` / \`redo(n)\` / \`history()\` = historie Zpět / Znovu;
   \`await window.mncad.status()\` vrátí stav
   jako text; \`window.mncad.guide()\` vrátí tento návod; \`window.mncad.commands()\` seznam příkazů;
   \`window.mncad.openConsole()\` otevře konzoli; \`await window.mncad.exportFile("step")\` (step, stl, brep, obj, glb,
   3mf, wrl, mncad) vrátí \`{ name, mime, bytes, base64 }\` **bez dialogu** – pro agenty a skripty, které potřebují soubor;
   \`await window.mncad.measure("F3", "F7")\` změří jako příkaz \`měřit\` a vrátí řádky + čísla (viz „Měření“);
   \`window.mncad.progress()\` vrátí průběh běžícího výpočtu (\`{ label, index, total, name, seconds }\` nebo \`null\`) a
   \`window.mncad.cancel()\` ho zruší (dokument zůstane ve stavu před výpočtem).

**Když textový příkaz něco neumí, \`prvek nápověda <typ>\` ukáže všechna pole pro \`prvek <typ> …\`** (EN \`feature help\`,
DE \`element hilfe\`; typ i slovem příkazu – \`nápověda díra\`, \`nápověda kužel\`, u rozšíření id: \`prvek nápověda sheet.bend\`):
název, druh hodnoty a ukázka zápisu, jednotka, povolené hodnoty, výchozí / povinné, význam a zápis vlastním textovým příkazem
(„jen prvek / upravit / JSON“ = vlastní zápis nemá). \`prvek nápověda\` bez typu vypíše přehled všech typů a polí, která jdou
zadat jen přes \`prvek\` / \`upravit\`.

Všechny rozměry jsou v **milimetrech**, úhly ve stupních, desetinná čárka i tečka jsou povolené, „Ø“ před číslem
se ignoruje. Souřadný systém: Z nahoru, XY je půdorys. Počátek je v rohu kvádru (bez „střed“) nebo ve středu válce.

## Řádkové příkazy (česky i anglicky, jeden příkaz na řádek, \`#\` = komentář)

| Příkaz | Význam |
| --- | --- |
| \`nový díl [název]\` / \`nová sestava [název]\` | nový dokument v nové záložce |
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
| \`čára x1 y1 x2 y2 [r N] x3 y3 … [uzavřít]\` | lomená čára; \`r N\` za bodem zaoblí tento roh poloměrem N (vzniknou úsečky a tečné oblouky) |
| \`oblouk x1 y1 xm ym x2 y2\` | oblouk třemi body: začátek, bod na oblouku, konec |
| \`spline x1 y1 x2 y2 x3 y3 … [uzavřít]\` | hladká křivka přes zadané body |
| \`vazba <druh> <odkaz> [<odkaz> …]; <druh> …\` | vazba ve skice (vodorovně, kolmo, tečně, shodně…); odkazy na entity \`e1\`, \`e1.a\`, \`počátek\` |
| \`kóta <druh> <odkaz> [<odkaz>] <hodnota> [referenční]; …\` | kóta ve skice (délka, vzdálenost, vodorovně, svisle, poloměr, průměr, úhel, délka oblouku) |
| \`vysunout H|výška H [směr x y z|směr +X|směr hrana E3|směr osa "Osa 1"|směr plocha F2|směr body V1 V2] [sklon a [k +X|k x y z]] [symetricky] [skrz|k tělesu|k dalšímu|k ploše F3 [odsazení N]|k rovině "Rovina 1"|k vrcholu V3] [odebrat|přidat|průnik|nové] [obráceně] [úkos a [dovnitř|ven] [břit N] [ostré rohy|zaoblené rohy]]\` | vysune poslední skicu; šikmo (\`sklon 25 k +X\` = propad), úkos dovnitř / ven s břitem (střižnice) – viz „Šikmé vysunutí, úkos dovnitř / ven a břit“ |
| \`rotovat [úhel] [osa X|Y|Z] [odebrat|přidat|průnik|nové]\` | orotuje poslední skicu (výchozí osa Y skici, 360°); \`odebrat\` = vysoustružit profil z tělesa |
| \`díra D [hloubka H [dno ploché | hrot 118]|skrz [obousměrně]|k tělesu] v x y [z] [osa Z] [zahloubení D2 H2] [kuželové D2] [závit M8 [hloubka-závitu T] [jádro | vrták [N]]]\` | bez z = díra začíná na povrchu tělesa v daném místě (zjistí se ze sítě modelu) a vrtá dolů; \`skrz\` vrtá **od zadaného bodu jen ve směru vrtání** (materiál nad bodem zůstane), \`obousměrně\` na obě strany; \`k tělesu\` (EN \`to body\`, DE \`bis Körper\`) vrtá po první stěnu stávajícího tělesa – projde první stěnou ve směru vrtání a dál nepokračuje (např. jen horní stěnou dutého dílu), jako ukončení „K tělesu“ u vysunutí; \`závit M6\` vrtá tabulkový vrták (viz další řádek), \`hloubka\` = hloubka vrtání, \`hloubka-závitu\` = užitečná délka závitu (výkres pak ukáže „M8 ↧10“ + „Ø6,8 ↧14“) |
| \`díra závit M8 hloubka 20 v x y\` · \`díra 6,647 závit M8 …\` · \`díra závit M8 … jádro\` · \`díra závit M8 … vrták 6,7\` | **průměr vrtáku závitové díry**: bez průměru = tabulkový vrták (M8 → Ø6,8, jemný M18×1,5 → Ø16,5); **zadaný průměr má přednost** (protokol: „vrták Ø6,647 zadán ručně (tabulkový 6,8)“); jmenovitý průměr (\`díra 8 závit M8\`) i nesmyslně malé zástupné číslo (pod D1 − P, např. \`díra 5 závit M18×1,5\` ze starších zápisů) = tabulkový vrták s poznámkou v protokolu; \`jádro\` (EN \`core\`/\`minor\`, DE \`Kern\`) = malý průměr vnitřního závitu D1 = D − 1,082532·P podle ISO 965-1 (M8 → 6,647, M12 → 10,106, M18×1,5 → 16,376); \`vrták\` (EN \`drill\`, DE \`Bohrer\`) = tabulkový, \`vrták 6,7\` = vlastní; vrták větší než závit = chyba. Označení \`M8\` lze psát i bez slova \`závit\`. Výkres u jiného než tabulkového vrtáku uvede i řádek vrtáku („M8 ↧20“ + „Ø6,647 ↧20“), stav ukáže „(vrták = jádro D1 Ø6,647)“. V JSON je to pole \`tapDrill\`: \`"table"\` (nebo chybí) / \`"minor"\` / \`"custom"\` + \`diameter\` – v JSON bez \`tapDrill: "custom"\` se \`diameter\` závitové díry nepoužije (stavba to ohlásí ⚠). \`upravit "Díra 1" diameter=6,647\` a \`prvek hole … kind=tapped thread=M8 diameter=6,647\` platí jako text (zadaný průměr má přednost, \`tapDrill\` se doplní); \`tapDrill=\` přijme jen \`table\` / \`minor\` / \`custom\` (i \`tabulkový\` / \`jádro\` / \`vlastní\`); změna závitu (\`thread=M10\`, formulář) ponechá vlastní vrták, jen když se k novému závitu hodí (D1 − P až pod D), jinak vrtá tabulkový s poznámkou. Volby díry pište **před** \`název\` – vše za \`název\` až do další volby je název (\`… název M8\` je díra pojmenovaná M8, ne závit) |
| \`díra D hloubka H dno ploché\` · \`díra D hloubka H hrot 120\` | **dno slepé díry**: výchozí kužel hrotu vrtáku 118°; \`hrot N\` (EN \`tip\`, DE \`Spitze\`) = jiný vrcholový úhel 60–170°; \`dno ploché\` / \`ploché dno\` (EN \`flat bottom\`, DE \`flacher Grund\`) = rovné dno bez kužele (sedlo pružiny, frézované dno; v JSON \`tipAngle: 180\`); také \`ploché\`, \`s plochým dnem\`, \`bez hrotu\`, \`dno=ploché\`, \`dno kužel 120\` (EN \`flat\`, \`without tip\`, DE \`ohne Spitze\`); slovo podobné volbě dna, kterému CAD nerozumí, je chyba řádku. Hloubka H je vždy hloubka válcové části (u plochého dna celá hloubka). Platí i pro závitovou a zahloubenou díru; u díry skrz / k tělesu je to chyba; úhel mimo 60–170° je chyba i v \`upravit\` / \`prvek\` (v JSON jádro úhel ořízne a ohlásí ⚠, stav i výkres ukazují použitý úhel). \`měřit díry\` vypíše „dno ploché“ (i se souosou dírou ze dna) nebo „hrot 118° (ke špičce …)“, výkres u plochého dna připíše „(ploché dno)“ |
| \`díra D … směr vx vy vz\` · \`díra D … sklon úhel [směr +X]\` | šikmá díra: \`směr\` = směr vrtání vektorem; \`sklon\` = odklon od osy díry (výchozí k +X u osy Z) |
| \`díra D skrz v x1 y1 z1 v x2 y2 z2 …\` | více děr jedním příkazem (každá poloha třemi souřadnicemi) |
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
| \`vložit "název záložky" [v x y z] [otočení rx ry rz] [ukotvit]\` | sestava: vloží díl z otevřené záložky jako komponentu |
| \`sestava\` · \`sestava plochy "Čep" [rovinné|válcové]\` · \`sestava vazba <druh> "A" <plocha> "B" <plocha> [hodnota N] [obráceně]\` · \`sestava vazby\` · \`sestava vazba 2 hodnota=5|obráceně|potlačit|zapnout|smazat\` | sestava textem: komponenty, plochy pro vazby, trvalé vazby a jejich správa (viz „Sestava textem“) |
| \`sestava vazba ozubení|šroub|hřeben|vačka|kardan|kolmo|tečně|shodně|symetricky|šířka|dráha|drážka|závěs|zámek|mez … "A" <F|E|V> "B" <F|E|V> [poměr|stoupání|min|max]\` · \`pohyb motor rotační "Klika" 0..360 krok 5 [kolize]\` · \`pohyb stav|krok N|přehrát|export csv\` | pokročilé a mechanické vazby (23 druhů) a pohybová studie (viz „Pokročilé a mechanické vazby, pohybová studie“) |
| \`sestava komponenta "X" [v x y z] [otočení …] [posun …] [ukotvit|uvolnit] [skrýt|zobrazit] [barva #hex] [název "…"] [číslo "…"] [skupina "…"] [materiál …]\` · \`sestava odebrat|duplikovat|izolovat "X"\` · \`sestava zobrazit vše\` | vlastnosti komponenty jako v panelu |
| \`sestava pole "X" N rozteč P [směr Y]\` · \`sestava pole "X" kruhové N [osa Z] [v cx cy cz]\` · \`sestava zrcadlit "X" YZ\` · \`sestava šroub "Deska" Ø9 [matice] [bez podložky]\` | pole, zrcadlení, šroubový spoj do díry |
| \`sestava podsestava "A" "B" [jako "…"]\` · \`sestava rozpustit "P"\` · \`sestava upravit "X"\` … \`sestava hotovo\` · \`sestava otevřít "X"\` | podsestavy, úprava dílu v kontextu sestavy |
| \`kusovník [strukturovaně] [csv]\` · \`rám formy [šířka délka] [dutina X Y H] …\` · \`záložky\` · \`záložka "název"|N\` · \`zavřít záložku\` | kusovník do protokolu, rám vstřikovací formy, záložky dokumentů |
| \`výkres\` | otevře výkres otevřeného dokumentu v záložce |
| \`výkres [A4|A3|A2|A1|A0] [na šířku|na výšku] [měřítko 1:2|auto] [pohledy přední,horní,levý,pravý,zadní,spodní,iso] [řez XZ|YZ|XY [odsazení N]|ne] [skryté ano|ne] [osy ano|ne] [tabulka děr ano|ne] [promítání E|A]\` | volby aktivního listu výkresu (\`výkres list N\`; bez něj první list – založí ho, chybí-li) a otevře výkres |
| \`kótovat [chytře|celkově|nic] [řetězově|od základny]\` | Chytré kóty podle prvků modelu (viz „Výkres a kóty“) – nahradí jen vygenerované kóty |
| \`výkres tolerance <kóta> <tolerance>\` · \`výkres poznámka "…"\` · \`výkres nepředepsané ISO 2768-mK\` · \`výkres hrany ISO 13715 …\` · \`výkres drsnost Ra 3,2\` | tolerance ke kótě podle popisku (\`Ø40 h6\`, \`25 ±0,1\`, \`M8 6H\`); údaje u razítka |
| \`výkres stav\` | textový stav výkresu: list, měřítko, pohledy, všechny kóty po pohledech, duplicity, chybějící rozměry, co se nevešlo (také \`window.mncad.drawingStatus()\`) |
| \`měřit F3|E5|V2 [F7|E9|V8|x y z]\` · \`měřit těleso|díry|válce\` · \`měřit plocha|hrany <pravidlo>\` | měření pro kontrolu modelu (viz „Měření“); také \`window.mncad.measure()\` |
| \`výkres list 2\` · \`výkres list nový "Detail"\` · \`výkres list přejmenovat 2 "…"\` · \`výkres list smazat 2\` · \`výkres stav [list N|vše]\` | listy výkresu – další příkazy výkresu pracují s vybraným listem (viz „Výkres textem: listy, značky, kóty, export“) |
| \`výkres razítko číslo="MN-1" kreslil="AI" …\` · \`výkres revize B "popis"\` · \`výkres otočení 90\` · \`výkres řez XZ poloviční\` · \`výkres kusovník ano\` · \`výkres balónky ne\` · \`kótovat základní\` | razítko, revize a další volby listu |
| \`výkres pohled pomocný přední hrana x1 y1 x2 y2\` · \`výkres řez zalomený|natočený|částečný …\` · \`výkres přerušení přední x od 50 do 250\` · \`výkres uložení Ø40 H7\` · \`výkres revize značka B na Ø40\` · \`výkres zóny ano\` | pomocný pohled, řezy lomenou čarou, částečný řez, přerušený pohled, uložení ISO 286 s Tabulkou uložení, trojúhelníky revizí a zóny (viz „Pomocné pohledy, řezy lomenou čarou, přerušení, uložení a revize“) |
| \`výkres značka drsnost Ra 1,6 na Ø40\` · \`výkres kóta vodorovně pohled přední x1 y1 x2 y2\` · \`výkres upravit a3 odsazení=8\` · \`výkres smazat a3\` · \`výkres detail přední v x y poloměr r\` · \`výkres model "Hřídel"\` | značky, ruční kóty, úpravy, detaily a další modely – vše, co jde ve výkrese myší; export \`window.mncad.exportDrawing("pdf")\` |
| \`smazat poslední\` · \`stav\` · \`zobraz iso|přední|horní…\` · \`kolize\` | správa; kolize = kontrola průniků komponent sestavy |
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
  (popisky pro výběr) místo pravidla; čísla a slova pravidla nelze míchat.
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
  (ve směru krajního úseku). \`čára\` se 3+ body se ve skice uzavírá – uzavírací úsek se u dělicí čáry vynechá.
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
Protokol úpravy: \`✓ Díra 1: diameter 8,5 → 10, depth 0 → 12\` a po výpočtu ✓ / ⚠ / ✗ upraveného prvku i prvků, které na
něm závisejí. Neznámý klíč skončí chybou s výčtem parametrů prvku (\`„diametr“ není parametr prvku „Díra 1“ (hole) – parametry: …\`).

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
   názvem nebo pořadím \`#2\`. \`stav\` u sestavy obsahuje řádky \`Komponenty: Deska [0; 0; 0] ⚓ · Čep [40; 30; -20]\` a
   \`Vazby: 2 (2 ok)\`.
6. \`sestava komponenta "Čep" v x y z | posun dx dy dz | otočení rx ry rz | pootočit X 90 | ukotvit | uvolnit | skrýt | zobrazit |
   barva #hex | název "…" | číslo "…" | skupina "…" | materiál ocel\` (třída hustoty, jiný text = označení do kusovníku);
   po přesunu se vazby přepočítají (přesunutá komponenta drží). \`sestava odebrat "X"\` (i s jejími vazbami),
   \`sestava duplikovat "X" [posun 50 0 0]\`, \`sestava izolovat "X"\`, \`sestava zobrazit vše\`.
7. \`sestava pole "X" 4 rozteč 25 [směr Y|dx dy dz]\`, \`sestava pole "X" kruhové 6 [úhel 360] [osa Z] [v cx cy cz]\` (kopie
   „X (2)“…), \`sestava zrcadlit "X" YZ [odsazení N]\`, \`sestava šroub "Deska" Ø9|F8 [matice] [bez podložky] [obráceně]\` –
   šroub ISO 4762 podle průměru díry, délka podle tloušťky, hlava nahoře (\`obráceně\` = dole), vazba Souosost.
8. \`sestava podsestava "A" "B" [jako "Vedení"]\` (vazby se převedou), \`sestava rozpustit "Vedení"\`;
   \`sestava upravit "Čep"\` → další řádky pracují s dílem (\`díra 3 skrz v 0 0\`…) → \`sestava hotovo\` vrátí díl do sestavy
   (změna platí pro všechny stejné komponenty); \`sestava otevřít "Čep"\` = kopie v nové záložce.
9. \`kusovník [strukturovaně] [csv]\` – tabulka \`Poz. | Název | Číslo / norma | Ks | Materiál | kg/ks\`; \`kolize\` = průniky.
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
  Šroub komponenty (vztaženo k protějšku vazby, ukotvený má přednost; motor na komponentě B vazby obrátí znaménko). \`krok 5\` =
  73 kroků po 5°, \`kroky N\` = počet, \`čas T\` = délka [s], \`ot/min 60\` místo rozsahu = rychlost.
- \`pohyb motor lineární vazba 3 10..40\` – lineární motor: Vzdálenost (absolutní hodnota mezery), Drážka / Dráha / Souosost / Šroub
  (posuv od výchozí polohy, mm); \`rychlost 5\` = mm/s.
- \`pohyb\` / \`pohyb stav\` – definice a souhrn (rozsah pohybu komponent, první kolize, nesplněné vazby); \`pohyb krok 12\` – polohy
  v kroku; \`pohyb export csv\` – tabulka (krok; čas; motory; X Y Z RX RY RZ každé komponenty; stopa; kolize) přímo v protokolu;
  \`pohyb přehrát [smyčka]\`, \`pohyb zastavit\`, \`pohyb export png|webm\` (snímky ZIP / video z 3D okna, jen v aplikaci);
  \`pohyb kroky 48 čas 2 kolize vyp\`, \`pohyb motor smazat 1\`, \`pohyb smazat\`.
- API: \`await window.mncad.motion('motor rotační "Klika" 0..360 krok 5')\` (text = volitelný příkaz \`pohyb …\` předem) vrátí
  \`{ steps: [{ step, t, motors, comps: { "Píst": { position, rotation } }, trace?, clashes?, conflicts }], summary, collision, csv }\`.
- Studie se ukládá do sestavy (\`motion\` v JSON) a v \`stav\` je řádek „Pohybová studie: …“.

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
| \`žebro\` / \`bead\` / \`sicke\` | šířka výška [úhel stěny] | \`skica "Dráha"\` (úsečky, lomené čáry, oblouky, kružnice; bez = poslední skica) |
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
| hladina · layer (LA) | \`2d hladina nová OSY barva 1 typčáry CENTER tloušťka 0.25 [popis "…"]\` · \`aktuální OSY\` · \`vytvořit X\` (+aktuální) · \`OSY vypnout\` (zapnout, zmrazit, rozmrazit, zamknout, odemknout, netisk, tisk) · \`* rozmrazit\` · \`přejmenovat A B\` · \`smazat OSY přesunout-na 0\` |
| typčáry · linetype | \`2d typčáry načíst CENTER2 HIDDENX2\` · \`načíst vše\` · \`aktuální DASHED\` · měřítko \`2d měřítkočar 0.5\` |
| vlastnosti · properties | \`2d vlastnosti e3 e5 hladina OSY barva 5 typčáry DASHED tloušťka 0.5 měřítkočáry 2\` (bez id = výběr; \`barva ByLayer\` vrátí výchozí) |
| nastavit · set | geometrie jako panel vlastností: \`2d nastavit e3 r 25 c 10,10\` · \`nastavit e7 s "Nový text" h 5\` · \`nastavit e2 length=120\` |
| vyber · select | \`2d vyber hladina OSY typ circle\` · \`okno x,y x,y\` · \`křížení x,y x,y\` · \`vše\` · \`poslední\` · \`předchozí\` · \`výběr odebrat e3\` · \`nic\` |
| smazat · erase (E) | \`2d smazat e3 e5\` · \`smazat hladina OSY\` · \`smazat\` (výběr) |
| dotazy | \`2d vzdálenost p1 p2\` · \`plocha p1 p2 p3 …\` / \`plocha objekt e3\` · \`souřadnice x(e1,e2)\` · \`výpis e3\` · \`stav\` · \`rozsah\` |
| proměnná · setvar | \`2d proměnná cecolor 1\` · \`celtype\` \`celweight\` \`clayer\` \`ltscale\` \`textsize\` \`pdmode\` \`luprec\` \`insunits\` \`mirrtext\` … · \`jednotky mm přesnost 3\` |
| zoom | \`2d zoom rozsah\` · \`zoom okno x,y x,y\` · \`zoom střed x,y výška\` |
| export / import | \`2d export dxf\` · \`export dwg verze R2013\` (soubor v \`results[].data.file\`) · import: \`window.mncad.draftImport({ name, base64 })\` nebo \`{ name, text }\` |
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

## Soubory, obraz, výstupy a analýzy – API pro agenty

Vše z tohoto oddílu funguje bez dialogů a bez klikání; textové příkazy píší do protokolu jeden řádek ✓ / ✗ s výsledkem.

**Soubory.** \`await window.mncad.importFile({ name: "dil.step", base64 })\` (nebo \`{ name, text }\` u DXF / .mncad, nebo
objekt \`File\`) otevře soubor **stejnou cestou jako Otevřít / přetažení** – STEP (i sestavy), IGES, BREP, STL, OBJ, 3MF,
glTF/GLB, PLY, OFF, DXF, .mncad. Volba \`{ as: "auto" | "tab" | "component" | "sketch" }\`: auto = jako Otevřít (v otevřené
sestavě se díl vloží jako komponenta), tab = samostatný dokument v záložce (prázdnou záložku použije, jinak otevře novou),
component = do otevřené sestavy (Sestava ▸ Vložit díl),
sketch = DXF do otevřené skici, jinak jako nová skica v otevřeném dílu (Skica ▸ Import DXF). Slib se splní až po
dokončení importu a výpočtu a vrátí protokol + stav dokumentu; chyba (nepodporovaný formát, prázdný soubor) = výjimka
s důvodem. Export skici do DXF: \`await window.mncad.exportFile("dxf", { sketch: "Skica 1" })\` (výchozí otevřená, jinak
poslední skica).

**Obraz.** \`await window.mncad.screenshot({ view: "iso", display: "shadedEdges", width: 1200, hints: true })\` vrátí
\`{ mime: "image/png", width, height, base64 }\` – snímek 3D okna; při otevřené skice snímek skicáře (\`target: "3d"\`
vynutí 3D okno). Volby: \`view\` iso | front | top | right | back | bottom | left | current, \`display\` shadedEdges |
shaded | wireframe | hiddenLine | xray, \`fit\`, \`hints\` (popisky F1 / E2 / V3 do obrázku), \`section: { axis: "X", offset:
25, flip: true }\` (\`null\` = bez řezu), \`explode\` (sestava 0–3), \`background\` white | current. Dočasný pohled, styl
i řez se po snímku vrátí. Funguje i bez WebGL (zjednodušený náhled). Trvale textem:

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
\`měřit\`), \`window.mncad.clearSelection()\` ho zruší (Esc).

**Výstupy.** \`await window.mncad.action("sheet.dxf")\` spustí akci rozšíření (tlačítko bez prvku v historii) a vrátí
\`{ log, files: [{ name, mime, bytes, base64 }] }\` – Rozvin → DXF / SVG, Tabulka ohybů, Kusovník řezů (+ CSV), Tabulka
svarů, Tloušťka stěn, \`sketch.dxf\`. Textem \`akce tabulka ohybů\` (EN \`action bend table\`, DE \`aktion biegetabelle\`)
– text okna jde do protokolu. \`prvek sheet.dxf\` skončí chybou s odkazem na \`akce\`.
\`await window.mncad.share({ days: 10, password, from, view: "model" | "drawing", mode: "link" | "store" | "self" })\`
vytvoří sdílený odkaz (jako tlačítko Sdílet odkazem) a vrátí \`{ url, mode, bytes, exp, message, chars, note? }\`.
Výchozí je **krátký odkaz na jeden řádek** (~70 znaků, např. \`https://www.mnastrojarna.cz/cad#q=Ab3kZ9xQ2m.0f8Kx…\`,
\`mode: "self"\`): dokument se v prohlížeči zašifruje (AES-GCM, klíč 128 bitů jen v odkazu za #) a nahraje do úložiště
na webu (\`/cad/share/\`; s heslem PBKDF2 – odkaz zůstává stejně krátký); platnost 1–90 dní, po ní se smaže.
\`mode: "store"\` = Supabase (je-li nastavené), \`"link"\` = celý dokument v odkazu (dlouhý, bez serveru). Když úložiště
neodpovídá nebo je \`days: null\`, vrátí se \`mode: "link"\` a \`note\` říká proč. Velké modely (importovaný STEP) do
25 MB po kompresi; nad limit = výjimka s velikostí a limitem. Odkaz (i \`#q=\`, \`#s=\`, \`#r=\`) otevřete \`page.goto(url)\`.
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

## Materiál, výkres a export – co je dobré vědět

- \`materiál ocel|nerez|hliník|mosaz|měď|plast|titan|litina|bronz\` nastaví **třídu materiálu (hustotu)** pro hmotnost.
  Jakýkoli jiný text (\`materiál ČSN 11 423\`, \`materiál 1.0503\`) se uloží jako **označení materiálu do razítka**
  a hustota zůstává podle třídy – protokol to vždy napíše. V JSON jsou to pole \`material\` (id třídy) a \`materialName\`.
- Výkres **nedoplňuje žádné výrobní požadavky sám**: nepředepsané tolerance (např. ISO 2768-mK) a opracování hran
  (např. srazit 0,5×45°) se na list dostanou jen vyplněním polí v razítku (každé zvlášť, lze smazat). Výchozí text je
  jen „Rozměry v mm“.
- Závitové díry (\`díra závit M6 hloubka 12\`) se na výkrese kótují popisem \`M6 ↧12\` (s počtem), ne jako Ø jádra; vrták
  jiný než tabulkový (\`jádro\`, zadaný průměr) má vlastní řádek \`Ø6,647 ↧12\`, ploché dno poznámku \`(ploché dno)\`.
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
| \`výkres revize B "Přidána díra Ø8" [datum …] [kreslil …]\` · \`výkres revize smazat B\` | tabulka revizí; poslední revize se zapíše do razítka |
| \`výkres otočení 0|90|180|270\` · \`výkres řez XZ odsazení 0 poloviční|celý\` · \`výkres kusovník ano|ne\` · \`výkres balónky ano|ne\` | otočení hlavního pohledu, poloviční řez, kusovník nad razítkem a pozice komponent (sestava) |
| \`kótovat základní\` | kóty „Auto + Ø“ zapečené do pohledů (jen pomocný základ – místo Chytrých kót) |
| \`výkres značka poznámka "Kalit 58 HRC" na Ø40\` | poznámka s odkazovou čarou na kótu (popisek nebo id) |
| \`výkres značka drsnost Ra 1,6 na Ø40\` · \`… drsnost Ra 0,8 pohled přední v 0 20\` | značka drsnosti na kótu nebo na povrch (bod pohledu) |
| \`výkres značka tolerance kolmost 0,02 A na Ø40\` | rámeček ISO 1101: přímost, rovinnost, kruhovitost, válcovitost, profil, rovnoběžnost, kolmost, sklon, poloha, souosost, souměrnost, házení (+ hodnota, základna) |
| \`výkres značka základna A pohled horní v -50 0\` | základna (bez písmene další volné) |
| \`výkres značka text "Kalit 58 ± 2 HRC" v 20 30 [výška 5]\` | volný text na listu (mm listu) |
| \`… posun dx dy\` | posun popisku značky od cíle [mm listu] |
| \`výkres kóta vodorovně|svisle|šikmo pohled přední x1 y1 x2 y2 [odsazení 10] [text "…"]\` | ruční kóta dvou bodů; konce jedné hrany = kóta hrany (sleduje změny modelu); kladné odsazení = ven z pohledu |
| \`výkres kóta průměr|poloměr pohled horní střed x y [r R] [úhel 45]\` · \`výkres kóta úhel pohled přední x1 y1 x2 y2 x3 y3 x4 y4\` | kóta kružnice (dohledá se podle středu a poloměru) a úhlu dvou hran (mezi směry 1→2 a 3→4) |
| \`výkres upravit a3 odsazení=8 přípona="H7" text="(20)"\` · \`výkres upravit a5 posun="5 -3"\` | úprava kóty / značky (také \`hodnota=\`, \`základna=\`, \`výška=\`; \`posun\` přesune popisek značky v mm listu); cíl id nebo popisek |
| \`výkres smazat a3 a5\` · \`výkres smazat "Ra 1,6"\` · \`výkres smazat vlastní\` · \`výkres smazat vše\` | smazání; smazané vygenerované kóty se při přegenerování nevrátí |
| \`výkres detail přední v 45 10 poloměr 5 [měřítko 4:1] [umístit 330 200]\` · \`výkres detail A měřítko 5:1\` · \`výkres detail smazat A\` | detailní pohled (střed v mm modelu, umístění středu v mm listu) |
| \`výkres model "Hřídel" [pohled horní] [měřítko 1:2]\` · \`výkres model smazat "Hřídel"\` | další model na listu: komponenta sestavy nebo otevřená záložka |
| \`výkres stav list 2\` · \`výkres stav vše\` | stav zvoleného / všech listů (přehled listů, souřadnice, id, razítko, revize) |

**Export bez dialogu** (JavaScript API): \`await window.mncad.exportDrawing("pdf" | "dxf" | "dwg" | "svg" | "csv" | "png",
{ sheet: 2, dwgVersion: "R2018", width: 2000 })\` vrátí \`{ name, mime, bytes, base64, width?, height?, warnings? }\` –
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

Pak \`window.mncad.exportDrawing("pdf", { sheet: 1 })\` a \`exportDrawing("png", { sheet: 2 })\` pro kontrolu očima.

### Pomocné pohledy, řezy lomenou čarou, přerušení, uložení a revize

Body se zadávají jako u ostatních příkazů výkresu v **mm modelu v rovině pohledu** (y nahoru – rozsahy pohledů ukáže
\`výkres stav\`), umístění na listu v mm listu od levého dolního rohu. Nové pohledy dostanou písmeno (B, C… – A patří
řezu A–A) a značky na ně míří jako na ostatní pohledy: \`pohled B v x y\` (pomocný), \`řez B v x y\` (řez lomenou čarou).

| Příkaz | Význam |
| --- | --- |
| \`výkres pohled pomocný přední hrana 40 50 100 15,36\` | **pomocný pohled** (POHLED B, metoda šipky ISO 128-30) kolmo na šikmou plochu, která je v rodičovském pohledu vidět jako hrana – plocha ve skutečném tvaru; bod hrany se přichytí k hraně pohledu |
| \`… hrana … podél\` · \`… otočit\` · \`… umístit 330 120\` | pohled podél hrany · z opačné strany · střed pohledu na zadané místo listu (jinak zarovnaně s rodičem: ISO E po šipce, A proti ní) |
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
  \`výkres poznámka "Rozměry označené ≈ jsou odhadnuty z měřítka – ověřit"\`.
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
- Díra se závitem: \`díra závit M18×1,5 hloubka 20 v x y\` – vrták (Ø16,5) se dopočítá z označení; zadaný průměr
  (\`díra 16,4 závit M18×1,5 …\`) má přednost, \`jádro\` = D1 podle ISO 965-1 (16,376).
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
   kladná“). Opravte a spusťte znovu jen opravené řádky – příkazy se **připojují** k dokumentu; chybný prvek opravíte
   \`upravit "Díra 1" diameter=10\`, \`smazat "Díra 1"\` ho smaže, \`smazat poslední\` smaže poslední prvek a \`zpět\` vrátí
   celý poslední běh (krok historie).
4. \`stav\` vrátí rozměry (X/Y/Z rozsah), objem, řádek Geometrie (platná / neplatná / bez tělesa), počet ploch a hran
   a seznam prvků se stavem ✓ / ⚠ / ✗ – podle toho ověřte, že model odpovídá výkresu (např. 165 × 165 × 48 mm).
   Jednotlivé rozměry, díry a polohy ověříte příkazem \`měřit\` (oddíl „Měření“).
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
- Konzole nepřistupuje k souborům na disku (bezpečnost prohlížeče) – soubor předá skript přes \`window.mncad.importFile()\`
  (obsah jako base64 / text), nebo ho člověk přetáhne do okna.
- Dokumentace pro lidi: https://www.mnastrojarna.cz/cad/dokumentace (PDF: /cad/mnastrojarna-cad-prirucka.pdf).
`;
