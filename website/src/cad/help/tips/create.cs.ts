/** Mikronávody – balík „create“ (karta Tvorba), čeština (zdroj). Klíče a jejich výčet: src/cad/help/tips-manifest.ts. */
import type { MicroTip } from "../tips";

export default {
  // ── Skica ──
  sketch: {
    what: "Založí 2D skicu na rovině nebo rovinné ploše – základ pro vysunutí, rotaci, tažení i žebro.",
    when: "Na začátku každého tvaru: obrys dílu, kapsa, dráha tažení, čára žebra.",
    steps: ["Klikněte na Skica a v nabídce zvolte rovinu nebo plochu.", "Na kartě Skica kreslete obrys, přidejte vazby a kóty.", "Potvrďte Dokončit skicu – rovnou se otevře Vysunout."],
    cmd: "skica XY: obdélník 60 40",
    note: "Pro vysunutí kreslete uzavřený obrys bez přesahů a mezer.",
  },
  "menu:sketch/xy": {
    what: "Založí skicu na základní rovině XY (půdorys, pohled shora).",
    when: "Půdorys dílu: deska, příruba, obrys kapsy vysouvaný ve směru Z.",
    steps: ["Zvolte Rovina XY (půdorys).", "Nakreslete obrys a potvrďte Dokončit skicu."],
    cmd: "skica XY: kružnice 50",
  },
  "menu:sketch/xz": {
    what: "Založí skicu na základní rovině XZ (nárys, pohled zepředu).",
    when: "Profil viděný zepředu – např. polovina hřídele pro rotaci, profil lišty.",
    steps: ["Zvolte Rovina XZ (nárys).", "Nakreslete profil a potvrďte Dokončit skicu."],
    cmd: "skica XZ: kružnice 50",
  },
  "menu:sketch/yz": {
    what: "Založí skicu na základní rovině YZ (bokorys, pohled zboku).",
    when: "Profil viděný z boku – boční výřez, žebro ve směru X.",
    steps: ["Zvolte Rovina YZ (bokorys).", "Nakreslete profil a potvrďte Dokončit skicu."],
    cmd: "skica YZ: kružnice 50",
  },
  "menu:sketch/face": {
    what: "Založí skicu přímo na rovinné ploše modelu (počátek a směr X převezme z plochy).",
    when: "Kapsa, výstupek nebo díry na horní či boční ploše hotového tělesa.",
    select: "Po volbě klikněte na rovinnou plochu modelu.",
    steps: ["Zvolte Na rovinné ploše modelu….", "Klikněte na rovinnou plochu, nakreslete obrys, Dokončit skicu."],
    cmd: "skica plocha horní: kružnice 20",
    note: "Zakřivená plocha rovinu neurčí – vyberte rovinnou nebo použijte Rovina (Reference).",
  },
  "menu:sketch/xyo": {
    what: "Založí skicu na rovině rovnoběžné s XY, posunuté o zadanou vzdálenost ve směru Z.",
    when: "Obrys ve výšce: horní kapsa, druhý profil pro šablonování, výstupek nad deskou.",
    steps: ["Zvolte XY s odsazením….", "Zadejte odsazení v mm (i výraz, např. 25/2) a potvrďte.", "Nakreslete obrys a potvrďte Dokončit skicu."],
    cmd: "skica XY odsazení 20: kružnice 30",
  },
  "menu:sketch/xzo": {
    what: "Založí skicu na rovině rovnoběžné s XZ, posunuté o zadanou vzdálenost ve směru Y.",
    when: "Profil před nebo za základní rovinou – druhý profil šablonování, čelní kapsa.",
    steps: ["Zvolte XZ s odsazením….", "Zadejte odsazení v mm a potvrďte.", "Nakreslete obrys a potvrďte Dokončit skicu."],
    cmd: "skica XZ odsazení 20: kružnice 30",
  },
  "menu:sketch/yzo": {
    what: "Založí skicu na rovině rovnoběžné s YZ, posunuté o zadanou vzdálenost ve směru X.",
    when: "Boční profil mimo střed dílu, řez v určité poloze X.",
    steps: ["Zvolte YZ s odsazením….", "Zadejte odsazení v mm a potvrďte.", "Nakreslete obrys a potvrďte Dokončit skicu."],
    cmd: "skica YZ odsazení 20: kružnice 30",
  },
  "menu:sketch/faceOff": {
    what: "Založí skicu na rovině rovnoběžné s vybranou rovinnou plochou, v zadané vzdálenosti.",
    when: "Obrys kousek nad plochou nebo pod ní – osazení, stupeň, druhý profil.",
    select: "Přesně 1 rovinnou plochu (filtr výběru Plocha).",
    steps: ["Vyberte rovinnou plochu.", "Zvolte Rovnoběžně s vybranou plochou… a zadejte vzdálenost.", "Nakreslete obrys a potvrďte Dokončit skicu."],
  },
  "menu:sketch/mid": {
    what: "Založí skicu na střední rovině mezi dvěma vybranými plochami.",
    when: "Symetrické prvky: žebro uprostřed stěny, drážka ve středu dílu.",
    select: "Přesně 2 plochy (filtr výběru Plocha, Ctrl+klik).",
    steps: ["Vyberte 2 plochy.", "Zvolte Střední rovina mezi 2 plochami a kreslete."],
  },
  "menu:sketch/pts": {
    what: "Založí skicu na rovině procházející třemi vybranými vrcholy.",
    when: "Šikmá rovina daná rohy modelu – zkosení, šikmý výřez.",
    select: "Přesně 3 vrcholy (filtr výběru Bod, Ctrl+klik).",
    steps: ["Přepněte filtr výběru na Bod a vyberte 3 vrcholy.", "Zvolte Třemi body a kreslete."],
    note: "Vrcholy nesmějí ležet na jedné přímce.",
  },
  "menu:sketch/*": {
    what: "Založí skicu na této pomocné rovině z historie.",
    when: "Rovina v obecné poloze – šikmá, natočená nebo odsazená od jiného prvku.",
    steps: ["Zvolte pomocnou rovinu podle názvu.", "Nakreslete obrys a potvrďte Dokončit skicu."],
    note: "Pomocnou rovinu vytvoříte tlačítkem Rovina ve skupině Reference.",
  },

  // ── Tvar ──
  extrude: {
    what: "Vysune uzavřený profil skici do 3D – přidá nebo odebere materiál.",
    when: "Základní tvar dílu z 2D profilu, kapsa, výstupek, průchozí výřez.",
    select: "Skicu s uzavřeným profilem (předvolí se poslední; jinou zvolíte v poli Profil (skica)).",
    steps: ["V poli Profil (skica) zkontrolujte profil.", "Ukončení (směr 1): Na vzdálenost, Skrz vše, K ploše… a délka.", "Operace: Přidat / Odebrat / Průnik, potvrďte OK."],
    cmd: "vysunout 10",
    note: "Bez skici nejde. Otevřený obrys vysunete jen s volbou Tenká stěna.",
  },
  revolve: {
    what: "Orotuje profil skici kolem osy – rotační díly jako hřídel, příruba, čep.",
    when: "Soustružené tvary: hřídel s osazením, kotouč, kroužek; s Odebrat zápich či drážka.",
    select: "Skicu s polovinou profilu na jedné straně osy (výchozí osa = osa Y skici).",
    steps: ["V poli Profil (skica) zvolte skicu, v poli Osa rotace osu.", "Zadejte Úhel (360° = celá otáčka) a Směr.", "Operace: Přidat nebo Odebrat, potvrďte OK."],
    cmd: "rotovat 360",
    note: "Profil nesmí přecházet přes osu rotace.",
  },
  sweep: {
    what: "Protáhne profil podél dráhy – ohnutá trubka, madlo, lišta po křivce.",
    when: "Tvar se stálým průřezem po zakřivené dráze: trubka, drát, těsnicí drážka.",
    select: "Dvě skici: profil a dráhu; kruhový profil lze zadat i bez skici (Kružnice).",
    steps: ["Zvolte Profil (uzavřená skica) a Dráha (křivka).", "Nastavte Orientace profilu podél dráhy, případně Kroucení.", "Zvolte Operace a potvrďte OK."],
    cmd: 'prvek sweep profileId="Skica 1" pathId=$last',
    note: "Ostré rohy dráhy řeší pole Přechod v rozích dráhy.",
  },
  loft: {
    what: "Vytvoří plynulý přechod mezi dvěma a více profily v různých rovinách.",
    when: "Přechodový kus (čtverec na kruh), násypka, lopatka, tvarový náběh.",
    select: "Alespoň 2 uzavřené skici v různých rovinách (stačí i profil a bod).",
    steps: ["V seznamu Profily (v pořadí) přidejte skici od první k poslední.", "Volitelně Uzavření, okrajové podmínky nebo vodicí křivka.", "Zvolte Operace a potvrďte OK."],
    note: "Profily se stejným počtem úseků dávají nejčistší plochy.",
  },
  text: {
    what: "Vygravíruje nebo vytáhne nápis na rovině – označení, číslo dílu, šipka.",
    when: "Číslo formy, označení dílu, popis na štítku nebo přípravku.",
    steps: ["Do pole Text napište nápis, zadejte Výška písma a Hloubka.", "Způsob: Gravírovat nebo Vystoupit; zvolte Rovina textu.", "Nastavte Střed textu a Natočení, potvrďte OK."],
    cmd: 'text "ABC" výška 10 hloubka 1 v 0 0',
    note: "Nápis na válcovou plochu dělá Text na válci (také na kartě Tvorba).",
  },

  // ── Primitiva ──
  box: {
    what: "Vloží kvádr zadaný rozměry X × Y × Z – polotovar, deska, blok.",
    when: "Rychlý polotovar, upínací deska, kostka pro odebrání materiálu.",
    steps: ["Zadejte Rozměry (X × Y × Z) v mm.", "Nastavte Poloha (roh), nebo zaškrtněte Poloha = střed kvádru.", "Zvolte Operace a potvrďte OK."],
    cmd: "kvádr 100 60 20",
    note: "Natočení kvádru určuje pole Osa Z kvádru.",
  },
  cylinder: {
    what: "Vloží válec zadaný průměrem a výškou – čep, hřídel, kruhová deska.",
    when: "Čep, distanční sloupek, kruhový polotovar; s Odebrat válcový výřez.",
    steps: ["Zadejte Průměr a Výška.", "Zvolte osu (X / Y / Z nebo směr) a Poloha podstavy.", "Zvolte Operace a potvrďte OK."],
    cmd: "válec 40 60",
    note: "Pro díru se závitem či zahloubením je lepší Díra – má i popis do výkresu.",
  },
  tube: {
    what: "Vloží trubku zadanou vnějším a vnitřním průměrem a délkou.",
    when: "Pouzdro, distanční kroužek, trubkový polotovar.",
    steps: ["Zadejte Ø vnější, Ø vnitřní a Délka.", "Zvolte osu a Poloha podstavy.", "Zvolte Operace a potvrďte OK."],
    cmd: "trubka 40 30 100",
    note: "Ø vnitřní musí být menší než Ø vnější; 0 dá plný válec.",
  },
  cone: {
    what: "Vloží kužel nebo komolý kužel zadaný Ø dole, Ø nahoře a výškou.",
    when: "Hrot, kuželový čep, středicí kužel, přechod mezi dvěma průměry.",
    steps: ["Zadejte Ø dole, Ø nahoře a Výška (Ø 0 = špička).", "Zvolte osu a Poloha podstavy.", "Zvolte Operace a potvrďte OK."],
    cmd: "kužel 40 20 30",
    note: "Kuželové zahloubení pro šroub udělá rovnou Díra (Kuž. zahl.).",
  },
  sphere: {
    what: "Vloží kouli zadanou průměrem a středem.",
    when: "Kulová hlava, kulový čep, s Odebrat kulové lůžko kloubu.",
    steps: ["Zadejte Průměr.", "V poli Střed zadejte souřadnice nebo bod odkazem.", "Zvolte Operace a potvrďte OK."],
    cmd: "koule 30",
  },

  // ── Konstrukční prvky ──
  hole: {
    what: "Vyvrtá díru: vrtanou, válcově či kuželově zahloubenou nebo závitovou, i více naráz.",
    when: "Díry pro šrouby a kolíky, závitové otvory; slepé i průchozí.",
    select: "Po otevření formuláře klikněte na plochu, kam se má vrtat (nastaví Bod na povrchu i osu).",
    steps: ["Typ díry: Vrtaná, Válc. zahl., Kuž. zahl. nebo Závit; zadejte Průměr.", "Klikněte na plochu (Bod na povrchu) nebo vyplňte Polohy děr.", "Nastavte Ukončení (hloubka, skrz) a potvrďte OK."],
    cmd: "díra 8,5 skrz v 20 30",
    note: "Volba Pro šroub (průchozí díra ISO 273) dopočítá průměr podle šroubu.",
  },
  thread: {
    what: "Přidá metrický závit ISO na válec nebo do díry – kosmetický, nebo vymodelovaný.",
    when: "Šroub, čep se závitem, závitová díra, kterou má výkres popsat (M8, M18×1,5).",
    select: "Válec nebo díru – začátek a osu závitu zadáte ve formuláři odkazem na hranu.",
    steps: ["V poli Závit vyberte velikost, nebo napište Označení (text).", "U díry zaškrtněte Vnitřní závit (v díře), zadejte Délka závitu.", "Nastavte osu a Začátek závitu (na ose), potvrďte OK."],
    cmd: "závit M8 délka 20",
    note: "Kosmetický závit geometrii nemění, jen se popíše ve výkrese.",
  },
  split: {
    what: "Rozřízne těleso rovinou a jednu stranu odstraní.",
    when: "Odříznutí části dílu, zkrácení importovaného modelu, polovina dílu.",
    steps: ["V poli Řezná rovina zvolte rovinu, nebo Základní rovina a Poloha roviny.", "V poli Ponechat zvolte stranu, která zůstane.", "Potvrďte OK."],
    cmd: "prvek split plane=XY offset=10",
    note: "Obě části jako samostatná tělesa ponechá Rozdělit na tělesa.",
  },
  rib: {
    what: "Z otevřené čáry skici vytvoří výztužné žebro dané tloušťky až k tělesu.",
    when: "Výztuha mezi stěnami odlitku nebo výlisku, žebro úhelníku.",
    select: "Otevřenou skicu s čarou žebra.",
    steps: ["V poli Čára žebra (otevřená skica) zvolte skicu.", "Zadejte Tloušťka a Směr tloušťky (Kolmo na skicu / V rovině skici).", "Případně Obrátit stranu, potvrďte OK."],
    cmd: "prvek rib thickness=3",
    note: "Žebro se protáhne až k materiálu – čára nemusí těleso přesně dosahovat.",
  },
  spring: {
    what: "Vytvoří šroubovitou pružinu z kruhového drátu.",
    when: "Tlačná pružina do sestavy, přípravku nebo formy.",
    steps: ["Zadejte Průměr pružiny, Průměr drátu, Stoupání a Počet závitů.", "Zvolte osu a Poloha (začátek osy).", "Zkontrolujte Volná délka a potvrďte OK."],
    cmd: "prvek spring radius=10 wire=2 pitch=5 turns=8",
    note: "Stoupání musí být větší než průměr drátu, jinak se závity protnou.",
  },

  // ── Úpravy ──
  fillet: {
    what: "Zaoblí vybrané hrany – stálým, proměnným nebo eliptickým poloměrem.",
    when: "Odstranění ostrých hran, rádiusy odlitků a výlisků, přechody mezi stěnami.",
    select: "Hrany tělesa (filtr Hrana, Ctrl+klik pro více) – nebo je klikněte až ve formuláři.",
    steps: ["Vyberte hrany a klikněte na Zaoblit.", "Zvolte druh (Konstantní, R1 → R2…) a zadejte Poloměr.", "Potvrďte OK."],
    cmd: "zaoblit 2 hrany svislé",
    note: "Poloměr větší než sousední stěna selže – zkuste menší nebo méně hran.",
  },
  chamfer: {
    what: "Srazí vybrané hrany – stejnou vzdáleností, dvěma vzdálenostmi nebo vzdáleností a úhlem.",
    when: "Sražení hran pro montáž, odjehlení, náběh pro čep nebo šroub.",
    select: "Hrany tělesa (filtr Hrana, Ctrl+klik pro více).",
    steps: ["Vyberte hrany a klikněte na Srazit.", "Druh sražení: Stejné, D1 × D2 nebo D × úhel; zadejte rozměr.", "Potvrďte OK."],
    cmd: "srazit 1 hrany horní",
  },
  draft: {
    what: "Zkosí boční plochy o úhel úkosu vůči neutrální rovině – pro vyjímání z formy.",
    when: "Úkosy odlitků, výlisků a plastových dílů ve směru otevírání formy.",
    select: "Plochy ke zkosení (filtr Plocha) – nebo je klikněte ve formuláři.",
    steps: ["Vyberte boční plochy a klikněte na Úkos.", "Zadejte Úhel úkosu, Neutrální rovina a Směr tahu (otevírání formy).", "Potvrďte OK."],
    cmd: "úkos 3 plochy boční",
    note: "Kontrolu úkosů celého dílu dělají Formařské nástroje (Nástroje).",
  },
  shell: {
    what: "Vydlabe těleso na stěnu zadané tloušťky; vybrané plochy zůstanou otevřené.",
    when: "Krabička, kryt, nádoba, tenkostěnný výlisek.",
    select: "Plochy, které mají být otevřené (filtr Plocha).",
    steps: ["Vyberte otevírané plochy a klikněte na Skořepina.", "Zadejte Tloušťka stěny, případně Zesílit ven.", "Potvrďte OK."],
    cmd: "skořepina 2 otevřít horní",
    note: "Tloušťka musí být menší než nejmenší poloměr zaoblení uvnitř.",
  },
  filletSetback: {
    what: "Zaoblí hrany a roh, kde se stýkají 3 a více hran, uzavře hladkou záplatou.",
    when: "Rohy krabiček a odlitků, kde se potkávají tři zaoblené hrany.",
    select: "Hrany vedoucí do rohu (filtr Hrana).",
    steps: ["Vyberte hrany a klikněte na Zaoblení se setbackem.", "Zadejte Poloměr a Setback (od vrcholu podél hran).", "Případně jiný setback pro vybrané Vrcholy, potvrďte OK."],
    cmd: "zaoblit 3 hrany svislé setback 6",
    note: "Setback musí být alespoň rovný poloměru, jinak roh selže.",
  },
  filletConic: {
    what: "Zaoblí hrany eliptickým průřezem – dvě různé vzdálenosti D1 × D2 nebo kuželosečka (rho).",
    when: "Designové přechody, nesymetrické zaoblení mezi stěnami různé výšky.",
    select: "Hrany tělesa (filtr Hrana).",
    steps: ["Vyberte hrany a klikněte na Eliptické zaoblení.", "Zadejte D1 (první plocha) a D2 (druhá plocha); Průřez Elipsa nebo Kuželosečka.", "Potvrďte OK."],
    cmd: "zaoblit eliptické 4 2 hrany horní",
  },
  draftParting: {
    what: "Zkosí plochy od dělicí křivky na obě strany – horní i dolní část formy.",
    when: "Díly s dělicí rovinou formy uprostřed, úkos nad i pod dělicí čarou.",
    select: "Skicu s dělicí křivkou a plochy ke zkosení.",
    steps: ["V poli Dělicí křivka (skica) zvolte skicu.", "Vyberte plochy ke zkosení a zadejte Úhel úkosu a Směr tahu.", "Případně Stupňovitý úkos, potvrďte OK."],
    cmd: 'úkos 3 plochy boční dělicí "Skica 1"',
  },

  // ── Přímé úpravy ──
  pushPull: {
    what: "Posune vybranou rovinnou plochu po její normále – přidá nebo ubere materiál.",
    when: "Rychlá změna rozměru bez historie: prodloužit, ztenčit, srovnat stěnu.",
    select: "Rovinné plochy (filtr Plocha) – nebo je klikněte ve formuláři.",
    steps: ["Vyberte plochu a klikněte na Vytáhnout / Zatlačit.", "Ukončení: Na vzdálenost (+ ven, − dovnitř), K vrcholu nebo K ploše.", "Potvrďte OK."],
    cmd: "prvek pushPull distance=5 faces=horní",
    note: "Funguje i na importovaném modelu (STEP), který nemá historii.",
  },
  offsetFace: {
    what: "Odsadí vybrané plochy o zadanou vzdálenost – i zakřivené a válcové.",
    when: "Přídavek na obrábění, zvětšení nebo zmenšení díry, úprava uložení.",
    select: "Plochy k odsazení (filtr Plocha).",
    steps: ["Vyberte plochy a klikněte na Odsadit plochu.", "Zadejte Odsazení (+ ven, − dovnitř).", "Potvrďte OK."],
    cmd: "prvek offsetFace distance=0,5 faces=válcové",
    note: "Odsazení stěny díry o +0,5 mm díru zmenší.",
  },
  deleteFace: {
    what: "Odstraní vybrané plochy a těleso zacelí – zmizí díra, zaoblení, čep.",
    when: "Zjednodušení importovaného modelu, odstranění zaoblení nebo díry bez historie.",
    select: "Plochy k odstranění (filtr Plocha).",
    steps: ["Vyberte plochy (např. stěnu díry) a klikněte na Odstranit plochu.", "Zkontrolujte seznam ploch a potvrďte OK."],
    cmd: "prvek deleteFace faces=válcové",
    note: "Zacelit jde jen to, co okolní plochy uzavřou – jinak prvek ohlásí chybu.",
  },
  thicken: {
    what: "Zesílí vybrané plochy na těleso zadané tloušťky.",
    when: "Plech nebo skořepina z plochy, stěna z importované plochy.",
    select: "Plochy k zesílení (filtr Plocha).",
    steps: ["Vyberte plochy a klikněte na Zesílit.", "Zadejte Tloušťka (+ ven, − dovnitř).", "Zvolte Operace a potvrďte OK."],
    cmd: "prvek thicken thickness=2 faces=horní",
  },
  faceColor: {
    what: "Obarví vybrané plochy modelu zvolenou barvou.",
    when: "Zvýraznění funkčních ploch: dosedací, broušené, závitové, plochy pro obrábění.",
    select: "Plochy (filtr Plocha, Ctrl+klik pro více).",
    steps: ["Vyberte plochy.", "Klikněte na Barva plochy a zvolte barvu."],
    cmd: "barva plochy horní #e03930",
  },
  "menu:faceColor/*": {
    what: "Nastaví vybraným plochám tuto barvu.",
    when: "Odlišení funkčních ploch (dosedací, obráběné, kontrolní).",
    select: "Plochy (filtr Plocha).",
    steps: ["Klikněte na barvu – plochy se hned přebarví."],
    cmd: "barva plochy horní #e03930",
  },
  "menu:faceColor/reset": {
    what: "Vrátí vybraným plochám barvu tělesa.",
    when: "Zrušení zvýraznění ploch.",
    select: "Obarvené plochy (filtr Plocha).",
    steps: ["Klikněte na Výchozí barva."],
    cmd: "barva plochy horní výchozí",
  },

  // ── Základní editace ──
  pattern: {
    what: "Zopakuje prvek (díru, výstupek…) – lineárně, kruhově, po křivce, podle bodů skici nebo výplní.",
    when: "Řada nebo mřížka děr, díry na roztečné kružnici, žebra po obvodu.",
    select: "Prvek k opakování – předvolí se poslední díra nebo vysunutí (pole Opakované prvky).",
    steps: ["V poli Opakované prvky zkontrolujte prvek.", "Druh pole: Lineární, Kruhové…; zadejte Počet kusů a Rozteč nebo úhel.", "Nastavte Směr 1 (u kruhového osu) a potvrďte OK."],
    cmd: "pole 4 rozteč 25 směr X",
    note: "Jednotlivé kusy lze vynechat kliknutím v seznamu kusů.",
  },
  mirror: {
    what: "Zrcadlí celé těleso nebo vybrané prvky podle roviny.",
    when: "Symetrické díly: namodelujte polovinu a dozrcadlete.",
    steps: ["V poli Rovina zrcadlení zvolte rovinu (nebo Základní rovina).", "Zrcadlit: Celé těleso, nebo Vybrané prvky a zaškrtněte je.", "U tělesa nechte Ponechat originál (sloučit), potvrďte OK."],
    cmd: "zrcadlit YZ",
  },
  transform: {
    what: "Posune, otočí nebo změní měřítko tělesa – táhnutím gizma nebo číselně.",
    when: "Srovnání importovaného modelu, natočení dílu do výrobní polohy.",
    steps: ["Klikněte na Přesunout / otočit – objeví se gizmo.", "Táhněte šipky (krok 1 mm) nebo oblouky (krok 15°); R přepne posun/otočení.", "Přesné hodnoty: Posunutí, Otočení, Měřítko; potvrďte OK."],
    cmd: "prvek transform translate=10;0;0",
  },

  // ── Tělesa ──
  splitBodies: {
    what: "Rozdělí těleso rovinou na dvě samostatná tělesa; nic se neodstraní.",
    when: "Dělení formy na dvě poloviny, díl z více kusů, příprava pro sestavu.",
    steps: ["V poli Dělicí rovina zvolte rovinu, nebo Základní rovina a polohu.", "Zadejte Název nového tělesa (záporná strana roviny).", "Potvrďte OK."],
    cmd: "rozdělit XY odsazení 10",
  },
  copyBody: {
    what: "Vytvoří další těleso jako posunutou kopii existujícího tělesa.",
    when: "Druhý stejný kus vedle prvního, varianta k úpravám, nástroj pro sloučení.",
    steps: ["V poli Kopírované těleso zvolte těleso.", "Zadejte Posunutí kopie (X, Y, Z) a Název kopie.", "Potvrďte OK."],
    cmd: "kopie posun 50 0 0",
  },
  combine: {
    what: "Sloučí dvě tělesa dílu: sjednotí, odebere jedno od druhého, nebo ponechá průnik.",
    when: "Spojení dvou kusů, vyfrézování tvaru jiného tělesa, průnik dvou tvarů.",
    select: "Díl s alespoň dvěma tělesy.",
    steps: ["Zvolte Cílové těleso (výsledek) a Nástrojové těleso.", "Operace: Sjednotit, Odebrat nebo Průnik.", "Případně Ponechat nástrojové těleso, potvrďte OK."],
    cmd: "sloučit 1 2",
  },

  // ── Mazání ──
  delete: {
    what: "Smaže upravovaný nebo vybraný prvek, vybranou plochu (jako Odstranit plochu) nebo celé těleso.",
    when: "Úklid historie, zrušení chybného prvku, odstranění plochy importovaného modelu.",
    select: "Prvek ve správci, plochu nebo těleso v modelu.",
    steps: ["Vyberte, co se má smazat.", "Klikněte na Smazat (nebo klávesa Del)."],
    cmd: "smazat poslední",
    note: "Prvky, které na smazaný navazují, se ohlásí chybou – Ctrl+Z vrátí.",
  },

  // ── Reference ──
  datum: {
    what: "Vytvoří pomocnou rovinu – odsazenou, třemi body, pod úhlem k ploše, kolmo na křivku a další.",
    when: "Skica nebo řez v obecné poloze, rovina zrcadlení či rozdělení mimo základní roviny.",
    steps: ["V poli Definice roviny zvolte způsob a vyberte odkazy v modelu.", "Nebo ručně zadejte Počátek a Normála.", "Potvrďte OK; skicu na ní založíte v nabídce Skica."],
    cmd: "prvek datum",
    note: "Pomocná rovina nevytváří geometrii a přepočítá se se změnou modelu.",
  },
  datumAxis: {
    what: "Vytvoří pomocnou osu – z hrany, osy válce, dvou bodů nebo průsečnice rovin.",
    when: "Osa rotace, otočení nebo kruhového pole mimo osy X, Y, Z.",
    steps: ["V poli Definice osy zvolte způsob a vyberte odkazy.", "Nastavte Délka zobrazení a potvrďte OK."],
    cmd: "prvek datumAxis",
    note: "Ve formulářích ji vyberete volbou Pomocná osa v poli osy nebo směru.",
  },
  datumPoint: {
    what: "Vytvoří pomocný bod – vrchol, střed hrany či kružnice, průmět, průsečík, souřadnice.",
    when: "Poloha díry, primitiva nebo středu otáčení na místě, které není vrcholem.",
    steps: ["V poli Bod zvolte způsob (pravé tlačítko / ⋯ = další způsoby).", "Vyberte odkazy v modelu a potvrďte OK."],
    cmd: "prvek datumPoint",
  },
  csys: {
    what: "Vytvoří souřadný systém z počátku a směrů os Z a X.",
    when: "Měření a skici vůči výrobnímu nulovému bodu, natočený díl v sestavě.",
    steps: ["Zadejte Počátek (bod odkazem).", "Nastavte Osa Z a Osa X (ortogonalizuje se vůči Z).", "Potvrďte OK."],
    cmd: "prvek csys",
    note: "Počátek slouží jako pomocný bod, osa Z jako osa, rovina XY jako rovina skici.",
  },

  // ── Knihovna ──
  library: {
    what: "Otevře knihovnu normálií – šrouby, matice, ložiska, kolíky, ozubená kola, profily.",
    when: "Normalizované díly do konstrukce nebo sestavy bez kreslení.",
    steps: ["Napište označení (např. M8x30, ložisko 6204) nebo vyberte kategorii.", "Zkontrolujte rozměry a vložte díl."],
    cmd: "normálie M8x30",
    note: "V dílu se normálie otevře v nové záložce, v sestavě se vloží jako komponenta.",
  },
} satisfies Record<string, MicroTip>;
