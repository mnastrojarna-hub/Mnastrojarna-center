/** Mikronávody – balík „edit“ (karty Nástroje, Zobrazení, Data, rychlá lišta u výběru, karta Sestava – Vložit, Normálie, Přesun, Formy), čeština (zdroj). Klíče a jejich výčet: src/cad/help/tips-manifest.ts. */
import type { MicroTip } from "../tips";

export default {
  // ── Nástroje › Analýza ──
  "tools/measure": {
    what: "Změří vzdálenost, úhel, délku nebo poloměr mezi body, hranami, plochami a tělesy.",
    when: "Kontrola rozměru, rozteče děr, tloušťky stěny nebo úhlu ploch bez výkresu.",
    select: "Nic předem – entity klikáte až v zapnutém měření (filtr přepnete v panelu Měření).",
    steps: ["Zapněte Měřit, v panelu zvolte filtr (Vše, Bod, Hrana, Plocha, Těleso / tvar).", "Klikněte na první entitu – ukáže délku, Ø nebo plochu.", "Klikněte na druhou – vzdálenost a úhel; Nové měření začne znovu."],
    cmd: "měřit F3 F7",
    note: "Najetím na hranu se nabídnou koncové body, střed hrany a střed kružnice.",
  },
  inspect: {
    what: "Zapíná a vypíná panel s údaji o vybrané entitě: typ, délka, Ø, plocha, normála, souřadnice.",
    when: "Rychlé zjištění Ø díry, délky hrany, normály plochy nebo polohy komponenty.",
    select: "Jednu entitu kliknutím v modelu (plochu, hranu, bod, těleso nebo komponentu).",
    steps: ["Klikněte na entitu – vpravo dole se ukáže panel s jejími údaji.", "Tlačítkem Vlastnosti panel vypnete, dalším klikem znovu zapnete."],
    cmd: "měřit F3",
    note: "Panel je zapnutý od začátku – první klik na tlačítko ho vypne.",
  },
  filter: {
    what: "Určí, co kliknutí v 3D okně vybere: vše, plochu, hranu, bod, těleso, v sestavě komponentu.",
    when: "Když klik bere jinou entitu, než chcete – např. hranu místo plochy.",
    steps: ["Otevřete nabídku Filtr a zvolte druh entity.", "Klikejte v modelu; Ctrl+klik přidá nebo odebere další entitu."],
    note: "Stejný filtr je i ve stavovém řádku dole a v nabídce pravého tlačítka na prázdném místě.",
  },
  "menu:filter/all": {
    what: "Výběr bez omezení: přednost má bod, pak hrana, jinak plocha pod kurzorem.",
    when: "Běžná práce – vybere se to, na co přesně ukazujete.",
    steps: ["Zvolte Vše a klikněte na entitu v modelu."],
  },
  "menu:filter/feature": {
    what: "Filtr Prvek: kliknutí v 3D okně vybere celé těleso, stejně jako Těleso / tvar.",
    when: "Prvky historie (díra, vysunutí…) se vybírají ve stromu historie vlevo.",
    steps: ["Zvolte Prvek.", "Prvek otevřete kliknutím ve stromu historie vlevo."],
    note: "Kliknutím do modelu se jednotlivý prvek nevybere.",
  },
  "menu:filter/face": {
    what: "Kliknutí vybere jen plochy modelu.",
    when: "Před Vytáhnout / Zatlačit, Úkos, Skořepina, skicou na ploše nebo barvou plochy.",
    steps: ["Zvolte Plocha.", "Klikněte na plochu; Ctrl+klik přidá další."],
  },
  "menu:filter/edge": {
    what: "Kliknutí vybere jen hrany modelu.",
    when: "Před Zaoblit a Srazit, při měření délky hrany.",
    steps: ["Zvolte Hrana.", "Klikněte na hranu; Ctrl+klik přidá další."],
  },
  "menu:filter/vertex": {
    what: "Kliknutí vybere jen vrcholy (rohy) tělesa.",
    when: "Rovina třemi body, měření od rohu, odečtení souřadnic vrcholu.",
    steps: ["Zvolte Bod.", "Klikněte na roh tělesa; Ctrl+klik přidá další."],
  },
  "menu:filter/body": {
    what: "Kliknutí vybere celé těleso (v sestavě těleso komponenty).",
    when: "Přesun, skrytí nebo průhlednost tělesa, měření celého tělesa.",
    steps: ["Zvolte Těleso / tvar.", "Klikněte kamkoli na těleso – v dílu se ukáže rychlá lišta tělesa."],
  },
  "menu:filter/component": {
    what: "V sestavě vybere kliknutím jednotlivý díl (komponentu).",
    when: "Přesun, vazby, vlastnosti nebo odebrání jednoho dílu sestavy.",
    steps: ["Zvolte Komponenta.", "Klikněte na díl – vpravo se otevře panel komponenty; Ctrl+klik přidá další."],
    note: "Jen v sestavě.",
  },
  "menu:filter/subasm": {
    what: "V sestavě vybere kliknutím celou podsestavu (komponentu nejvyšší úrovně).",
    when: "Přesun, otevření nebo rozpuštění celé skupiny dílů najednou.",
    steps: ["Zvolte Podsestava.", "Klikněte na kterýkoli díl podsestavy – vybere se celá."],
    note: "Jen v sestavě; díl mimo podsestavu se vybere sám.",
  },
  mass: {
    what: "Ukáže hmotnost, objem, povrch, rozměry obálky a počet ploch a hran dílu.",
    when: "Hmotnost do nabídky nebo kusovníku, kontrola objemu, volba materiálu.",
    steps: ["Klikněte na Hmotnost.", "V poli Materiál zvolte materiál (hustota), případně Označení materiálu (razítko).", "Odečtěte Hmotnost, Objem, Povrch a Rozměry (X × Y × Z)."],
    cmd: "měřit těleso",
    note: "V sestavě se okno neotevře – hmotnost sestavy je ve štítku dole a v Kusovníku.",
  },
  section: {
    what: "Rozřízne zobrazení modelu rovinou – jen pohled, geometrie se nemění.",
    when: "Kontrola vnitřních tvarů: díry, kapsy, tloušťky stěn, uložení dílů v sestavě.",
    steps: ["Zapněte Řez – rovina jde středem modelu kolmo na osu Y.", "V panelu Řez modelem zvolte X / Y / Z, Plocha nebo Vektor.", "Nastavte Poloha (mm) a Otočit stranu; vypnete znovu tlačítkem Řez."],
    cmd: "řez Z 10",
    note: "Trvalé odříznutí materiálu dělá Rozříznout na kartě Tvorba.",
  },
  compare: {
    what: "Porovná díl s referenčním modelem: rozdíl objemů, chybějící a přebývající oblasti, mapa odchylek.",
    when: "Kontrola překresleného nebo upraveného dílu proti STEP od zákazníka.",
    steps: ["Klikněte na Vybrat referenci… a zvolte STEP, BREP, IGES nebo síť (STL…).", "Umístění reference: Jak je, Středy nebo Automaticky; nastavte Tolerance mm.", "Klikněte na Porovnat a projděte Rozdílové oblasti."],
    note: "Jen v dílu. Síťová reference (STL, OBJ) má omezenou přesnost.",
  },

  // ── Nástroje › Parametrizace, Formy ──
  vars: {
    what: "Ukáže, kde jsou proměnné dílu – pojmenované rozměry, na které se odkazují pole formulářů.",
    when: "Parametrický díl: změna jednoho rozměru (d, t, L) přepočítá celý model.",
    steps: ["Klikněte na Proměnné a v levém panelu otevřete záložku Proměnné.", "+ Přidat proměnnou: vyplňte Název a Výraz (např. d*2).", "V poli prvku napište =d nebo výraz (např. =d/2+3)."],
    cmd: "proměnná d = 20",
    note: "Tlačítko záložku samo nepřepne, jen ukáže hlášku. Sestava záložku Proměnné nemá.",
  },
  cfg: {
    what: "Ukáže, kde jsou stavy dílu (konfigurace) – varianty s jinými hodnotami proměnných a potlačenými prvky.",
    when: "Jeden díl ve více provedeních: M8 / M10, s děrami a bez, různé délky.",
    steps: ["Klikněte na Stavy dílu a v levém panelu otevřete záložku Stavy.", "+ Nový stav z aktuálních hodnot, rozbalte ho a upravte hodnoty a Potlačené prvky.", "Přepínačem u stavu ho aktivujte; Výchozí vrátí původní hodnoty."],
    cmd: 'konfigurace "Krátká" t=10',
    note: "Stavy mění proměnné – nejdřív je založte. Sestava záložku Stavy nemá.",
  },
  moldtools: {
    what: "Otevře panel pro konstrukci formy: úkosy a podkosy, analýza ploch, smrštění, vyhazovače, chlazení.",
    when: "Příprava plastového nebo litého dílu do formy – kontrola vyjímatelnosti a návrh formy.",
    steps: ["Úkosy: zapněte Barevná mapa úkosů, nastavte Směr vyhození a Min. úkos.", "Smrštění: zvolte materiál nebo hodnotu a klikněte na Použít smrštění.", "Vyhazovače: Díry do dílu / Vyhazovače do sestavy; Chlazení: Vrtat do dílu."],
    cmd: "analýza úkosů směr +Z min 1 zobrazit",
    note: "Jen v dílu s tělesem. Smrštění se přidá do historie jako měřítko.",
  },

  // ── Zobrazení › Pohledy ──
  iso: {
    what: "Natočí pohled do izometrie (šikmo shora) a přizpůsobí model oknu.",
    when: "Celkový přehled modelu, snímek pro nabídku, návrat po práci v jiném pohledu.",
    steps: ["Klikněte na Izometrie – kamera se natočí a model se vejde do okna."],
    cmd: "zobraz iso",
  },
  front: {
    what: "Pohled zepředu (od −Y) na rovinu XZ – nárys; model se přizpůsobí oknu.",
    when: "Kontrola profilu, výšek a osazení jako v nárysu výkresu.",
    steps: ["Klikněte na Přední."],
    cmd: "zobraz přední",
    note: "Bez perspektivního zkreslení: přepněte Kamera › Pravoúhlá.",
  },
  top: {
    what: "Pohled shora (od +Z) na rovinu XY – půdorys; model se přizpůsobí oknu.",
    when: "Rozmístění děr, kapes a obrysu desky jako v půdorysu.",
    steps: ["Klikněte na Horní."],
    cmd: "zobraz horní",
    note: "Bez perspektivního zkreslení: přepněte Kamera › Pravoúhlá.",
  },
  right: {
    what: "Pohled zprava (od +X) na rovinu YZ – bokorys; model se přizpůsobí oknu.",
    when: "Kontrola boční strany dílu, příčných děr a drážek.",
    steps: ["Klikněte na Pravý."],
    cmd: "zobraz pravý",
    note: "Bez perspektivního zkreslení: přepněte Kamera › Pravoúhlá.",
  },
  back: {
    what: "Pohled zezadu (od +Y), protilehlý k pohledu Přední.",
    when: "Kontrola zadní strany dílu, kterou zepředu nevidíte.",
    steps: ["Klikněte na Zadní."],
    cmd: "zobraz zadní",
  },
  bottom: {
    what: "Pohled zdola (od −Z), protilehlý k pohledu Horní.",
    when: "Kontrola spodní plochy: díry ze spodu, sražení, dosedací plochy.",
    steps: ["Klikněte na Spodní."],
    cmd: "zobraz spodní",
  },
  left: {
    what: "Pohled zleva (od −X), protilehlý k pohledu Pravý.",
    when: "Kontrola levé boční strany dílu.",
    steps: ["Klikněte na Levý."],
    cmd: "zobraz levý",
  },

  // ── Zobrazení › Styl zobrazení ──
  shadedEdges: {
    what: "Stínované plochy s vykreslenými hranami – výchozí styl pro modelování.",
    when: "Běžná práce: dobře vidíte tvar i hrany pro výběr.",
    steps: ["Klikněte na Stínovaný s hranami – styl se hned přepne."],
    cmd: "zobraz hrany",
    note: "Zvolený styl se pamatuje i po zavření programu.",
  },
  shaded: {
    what: "Jen stínované plochy, bez čar hran.",
    when: "Prezentace, snímek obrazovky, posouzení tvaru a hladkosti ploch.",
    steps: ["Klikněte na Stínovaný."],
    cmd: "zobraz stínovaný",
  },
  wireframe: {
    what: "Jen hrany modelu bez ploch – vidíte i hrany na odvrácené straně.",
    when: "Hledání vnitřních děr a kanálů, orientace ve složitém tvaru.",
    steps: ["Klikněte na Drátový; zpět např. Stínovaný s hranami."],
    cmd: "zobraz drátový",
  },
  hiddenLine: {
    what: "Bílé plochy s hranami, zakryté hrany se nekreslí – vzhled jako na výkrese.",
    when: "Kontrola obrysů jako ve výkresu, čistý snímek pro tisk.",
    steps: ["Klikněte na Skryté hrany."],
    cmd: "zobraz skryté",
  },
  xray: {
    what: "Průhledné plochy s hranami – vidíte dovnitř tělesa i sestavy.",
    when: "Vnitřní kanály, díry a vložky; v sestavě díly schované uvnitř.",
    steps: ["Klikněte na Průhledný; zpět Stínovaný s hranami."],
    cmd: "zobraz průhledný",
  },

  // ── Zobrazení › Kamera ──
  fit: {
    what: "Přiblíží a vystředí celý model v okně; směr pohledu zůstane.",
    when: "Model utekl z obrazovky nebo je po importu příliš malý či velký.",
    steps: ["Klikněte na Přizpůsobit."],
    cmd: "zobraz přizpůsobit",
  },
  persp: {
    what: "Perspektivní promítání – vzdálenější části se zmenšují jako ve skutečnosti.",
    when: "Přirozený vzhled modelu, prezentace, prohlídka sestavy.",
    steps: ["Klikněte na Perspektiva – volba se uloží do nastavení."],
    note: "Rovnoběžné hrany se sbíhají – pro kontrolu tvaru použijte Pravoúhlá.",
  },
  ortho: {
    what: "Pravoúhlé (rovnoběžné) promítání bez zkreslení – rovnoběžné hrany zůstanou rovnoběžné.",
    when: "Kontrola v pohledech Přední, Horní, Pravý jako na výkresu; zarovnání hran.",
    steps: ["Klikněte na Pravoúhlá; klávesová zkratka přepíná mezi oběma promítáními."],
    note: "Volba se uloží a platí i po dalším spuštění.",
  },
  "view/grid": {
    what: "Zapne nebo vypne mřížku a osy souřadnic v 3D okně.",
    when: "Orientace v prostoru, kontrola polohy dílu vůči počátku.",
    steps: ["Klikněte na Mřížka a osy; dalším klikem je skryjete."],
    note: "Platí jen do zavření programu – po spuštění je mřížka vypnutá.",
  },

  // ── Zobrazení › Vzhled ──
  color: {
    what: "Nastaví barvu tělesa dílu – ocel, hliník, mosaz, litina nebo signální barvy.",
    when: "Odlišení dílů na obrazovce a ve snímcích; barva se uloží s dílem.",
    steps: ["Otevřete nabídku Barva tělesa.", "Klikněte na barvu – těleso se hned přebarví (Ctrl+Z vrátí)."],
    cmd: "barva #b9c2cc",
    note: "Barva nemění materiál ani hmotnost. V sestavě má barvu každá komponenta (panel komponenty).",
  },
  "menu:color/*": {
    what: "Obarví těleso dílu touto barvou.",
    when: "Rychlé odlišení dílu nebo materiálu na obrazovce.",
    steps: ["Klikněte na barvu – změna se uloží do dílu, Ctrl+Z ji vrátí."],
    cmd: "barva #b9c2cc",
    note: "Jen vzhled – materiál pro hmotnost se volí zvlášť (Hmotnost, levý panel).",
  },
  bg: {
    what: "Změní pozadí 3D okna: modrošedý přechod, světlé, grafitové nebo bílé.",
    when: "Lepší kontrast při práci, bílé pozadí pro snímky a tisk.",
    steps: ["Otevřete nabídku Pozadí a klikněte na variantu."],
    note: "Volba se uloží do nastavení programu (Nastavení › Zobrazení).",
  },
  "menu:bg/*": {
    what: "Nastaví toto pozadí 3D okna.",
    when: "Grafit pro tmavé prostředí, Bílý (tisk) pro snímky do dokumentace.",
    steps: ["Klikněte na variantu – pozadí se hned změní a zapamatuje."],
  },
  mouse: {
    what: "Přepne ovládání pohledu myší podle CAD, na který jste zvyklí – ZW3D, SolidWorks nebo touchpad.",
    when: "Hned na začátku, aby otáčení a posun fungovaly jako ve vašem CAD.",
    steps: ["Otevřete nabídku Ovládání myši a zvolte schéma."],
    note: "Kolečko vždy přibližuje; další volby jsou v Nastavení › Myš a ovládání.",
  },
  "menu:mouse/zw3d": {
    what: "Schéma ZW3D: pravé tlačítko otáčí, prostřední posouvá, kolečko přibližuje.",
    when: "Jste zvyklí na ZW3D; pravý klik bez tažení otevře nabídku.",
    steps: ["Zvolte ZW3D – platí hned a zůstane uložené."],
  },
  "menu:mouse/solidworks": {
    what: "Schéma SolidWorks / Inventor: prostřední tlačítko otáčí, Ctrl+prostřední posouvá.",
    when: "Jste zvyklí na SolidWorks nebo Inventor.",
    steps: ["Zvolte SolidWorks – platí hned a zůstane uložené."],
  },
  "menu:mouse/simple": {
    what: "Schéma pro touchpad: levé tlačítko otáčí, pravé posouvá, kolečko přibližuje.",
    when: "Notebook bez myši s prostředním tlačítkem.",
    steps: ["Zvolte Touchpad – platí hned a zůstane uložené."],
  },

  // ── Data › Program ──
  settings: {
    what: "Otevře nastavení programu: jazyk, jednotky, zobrazení, myš, skica, výkres, soubory, zkratky.",
    when: "Přizpůsobení programu – výchozí materiál, styl zobrazení, zkratky, ukládání bez dialogu.",
    steps: ["Vlevo zvolte oblast (Obecné, Zobrazení, Myš a ovládání…).", "Změňte volby; Obnovit výchozí vrátí vše, Export / Import uloží nastavení do JSON.", "Potvrďte OK."],
    note: "Tyto mikronávody vypnete v části Obecné (Mikronávody u ikon).",
  },
  palette: {
    what: "Otevře vyhledávání všech příkazů – napíšete část názvu a spustíte ho Enterem.",
    when: "Když nevíte, na které kartě příkaz je, nebo chcete pracovat bez myši.",
    steps: ["Napište např. díra, výkres nebo zaoblit.", "Šipkami vyberte příkaz a stiskněte Enter; Esc paletu zavře."],
  },
  start: {
    what: "Zobrazí úvodní obrazovku: nový díl, sestava, výkres, otevření souboru, ukázky.",
    when: "Začátek nové práce nebo rychlé otevření ukázkového modelu.",
    steps: ["Zvolte akci v části Začít nebo model v Ukázkové modely.", "Pokračovat v práci obrazovku zavře."],
    note: "Zobrazení při spuštění vypnete v Nastavení › Obecné.",
  },

  // ── Data › Soubor ──
  open: {
    what: "Otevře projekt .mncad nebo importuje STEP, IGES, BREP, STL, OBJ, 3MF, glTF, PLY či DXF.",
    when: "Model od zákazníka, rozpracovaný projekt, výkres DXF jako podklad skici.",
    steps: ["Klikněte na Otevřít / Import a vyberte jeden nebo více souborů.", "Každý model se otevře ve vlastní záložce; DXF se načte jako skica."],
    note: "V sestavě se díl nebo model vloží jako komponenta. Soubory lze i přetáhnout do okna.",
  },
  save: {
    what: "Uloží celý projekt (.mncad) včetně historie prvků, skic a dat importů.",
    when: "Průběžné ukládání práce; soubor později otevřete přes Otevřít / Import.",
    steps: ["Poprvé zvolte místo a název souboru.", "Další uložení zapisuje do stejného souboru bez dotazu."],
    note: "Bez dialogu (rovnou do Stažené): Nastavení › Soubory, vypněte dotaz na místo a název.",
  },
  saveAs: {
    what: "Uloží projekt pod novým názvem nebo na jiné místo (.mncad).",
    when: "Varianta dílu, záloha před velkou změnou, kopie pro zákazníka.",
    steps: ["Zvolte místo a název souboru a potvrďte.", "Další Uložit projekt už ukládá do tohoto nového souboru."],
  },

  // ── Data › Export 3D ──
  export: {
    what: "Vyexportuje model do STEP, BREP, STL, 3MF, OBJ, glTF nebo VRML.",
    when: "Předání modelu do jiného CAD, do CAM, na 3D tisk nebo pro vizualizaci.",
    steps: ["Otevřete nabídku Export a zvolte formát.", "Zvolte místo a název souboru – teprve pak se export spočítá."],
    note: "Pro jiné CAD a CAM použijte STEP. Prvky s výstrahou v historii export zpomalují nebo kazí.",
  },
  "menu:export/step": {
    what: "Uloží přesnou geometrii jako STEP AP214 – standard pro výměnu mezi CAD.",
    when: "Předání do ZW3D, SolidWorks, Inventor, CATIA, Creo nebo CAM pro obrábění.",
    steps: ["Klikněte na STEP AP214, zvolte místo a název; počkejte na hlášení Export hotov."],
    note: "Neplatná geometrie (prvek s výstrahou v historii) může export STEP zpomalit nebo zkazit.",
  },
  "menu:export/brep": {
    what: "Uloží přesnou geometrii v nativním formátu jádra OpenCascade (.brep).",
    when: "Výměna s programy postavenými na OpenCascade (např. FreeCAD), archiv přesného tvaru.",
    steps: ["Klikněte na OpenCascade BREP, zvolte místo a název souboru."],
  },
  "menu:export/stl": {
    what: "Uloží model jako trojúhelníkovou síť STL (bez jednotek a barev).",
    when: "3D tisk, rychlý náhled v prohlížečích sítí.",
    steps: ["Klikněte na STL, zvolte místo a název souboru."],
    note: "Síť už nejde přesně upravovat – do jiného CAD posílejte STEP.",
  },
  "menu:export/3mf": {
    what: "Uloží síť ve formátu 3MF – s jednotkami (mm), vhodný pro 3D tisk.",
    when: "Moderní slicery pro 3D tisk (PrusaSlicer, Cura, Bambu Studio).",
    steps: ["Klikněte na 3MF, zvolte místo a název souboru."],
  },
  "menu:export/obj": {
    what: "Uloží síť jako Wavefront OBJ.",
    when: "Vizualizační a renderovací programy.",
    steps: ["Klikněte na Wavefront OBJ, zvolte místo a název souboru."],
  },
  "menu:export/glb": {
    what: "Uloží model jako binární glTF (.glb) – lehký formát pro web, AR a prezentace.",
    when: "Náhled modelu na webu, v mobilu nebo v prezentaci.",
    steps: ["Klikněte na glTF binární, zvolte místo a název souboru."],
  },
  "menu:export/wrl": {
    what: "Uloží síť ve formátu VRML (.wrl).",
    when: "Starší prohlížeče a programy, které novější formáty nečtou.",
    steps: ["Klikněte na VRML, zvolte místo a název souboru."],
  },

  // ── Data › Sestava, Ukázky ──
  asm: {
    what: "Založí sestavu: prázdnou, z aktuálního dílu, nebo rám vstřikovací formy.",
    when: "Když z dílů skládáte celek – přípravek, formu, nástroj.",
    steps: ["Otevřete nabídku Sestava a zvolte variantu."],
    cmd: "nová sestava",
  },
  "menu:asm/na": {
    what: "Otevře novou prázdnou sestavu v nové záložce.",
    when: "Začátek sestavy, do které vložíte díly, normálie a vazby.",
    steps: ["Klikněte na Nová prázdná sestava.", "Na kartě Sestava vložte díly (Vložit díl / model, Knihovna normálií)."],
    cmd: "nová sestava Forma",
  },
  "menu:asm/nc": {
    what: "Otevře novou sestavu v nové záložce s aktuálním dílem jako ukotvenou komponentou.",
    when: "Díl, ke kterému chcete přidat šrouby, protikus nebo přípravek.",
    steps: ["Klikněte na Sestava z aktuálního dílu.", "Na kartě Sestava přidejte další díly a vazby."],
    note: "Díl se vloží jako kopie – dál ho upravujte v sestavě přes Upravit díl (v kontextu).",
  },
  "menu:asm/mold": {
    what: "Otevře průvodce rámem vstřikovací formy: desky, rozpěrky, vyhazovací paket, sloupky s pouzdry.",
    when: "Rychlý návrh rámu formy kolem tvarové vložky.",
    steps: ["Zadejte Šířka X, Délka Y, tloušťky desek a Ø vodicích sloupků.", "Volitelně Dutina v desce A a Materiál desek.", "Klikněte na Vytvořit rám formy."],
    cmd: "rám formy 246 296",
    note: "Rám nahradí obsah aktuální záložky (Ctrl+Z vrátí) – nejdřív otevřete prázdnou.",
  },
  ex: {
    what: "Otevře ukázkový díl v nové záložce – příruba, hřídel, úhelník, madlo, čep, přechodový kus.",
    when: "Seznámení s programem, vzor postupu (tažení, závit, stavy, šablonování).",
    steps: ["Otevřete nabídku Ukázkové díly a klikněte na ukázku.", "Prohlédněte si historii vlevo – prvky lze otevřít a měnit."],
  },
  "menu:ex/*": {
    what: "Otevře tento ukázkový díl v nové záložce, s celou historií prvků.",
    when: "Vzor, jak je díl postavený; výchozí bod pro vlastní úpravy.",
    steps: ["Klikněte na ukázku – otevře se v nové záložce.", "Kliknutím na prvek v historii vlevo otevřete jeho parametry."],
    note: "Rozpracovaný dokument zůstane v původní záložce.",
  },

  // ── Rychlá lišta u výběru (díl) ──
  "quick/sk": {
    what: "Založí novou skicu přímo na kliknuté rovinné ploše.",
    when: "Kapsa, výstupek nebo díry na ploše hotového tělesa.",
    select: "Rovinnou plochu – lišta se ukáže po kliknutí na plochu v dílu.",
    steps: ["Klikněte na rovinnou plochu.", "V liště zvolte Nová skica na ploše, nakreslete obrys a Dokončit skicu."],
    cmd: "skica plocha horní: kružnice 20",
    note: "Na zakřivené ploše skicu založit nelze.",
  },
  "quick/pp": {
    what: "Otevře Vytáhnout / Zatlačit s kliknutou plochou – posune ji po normále.",
    when: "Rychlá změna rozměru bez historie: prodloužit, ztenčit, srovnat stěnu.",
    select: "Rovinnou plochu – lišta se ukáže po kliknutí na ni; další přidáte ve formuláři.",
    steps: ["Klikněte na plochu a v liště zvolte Vytáhnout / Zatlačit.", "Ukončení: Na vzdálenost (+ ven, − dovnitř), K vrcholu nebo K ploše.", "Potvrďte OK."],
    cmd: "prvek pushPull distance=5 faces=horní",
  },
  "quick/of": {
    what: "Otevře Odsadit plochu s kliknutou plochou – i zakřivenou nebo válcovou.",
    when: "Přídavek na obrábění, zvětšení nebo zmenšení díry, úprava uložení.",
    select: "Plochu – lišta se ukáže po kliknutí na ni; další přidáte ve formuláři.",
    steps: ["Klikněte na plochu a v liště zvolte Odsadit plochu.", "Zadejte Odsazení (+ ven, − dovnitř).", "Potvrďte OK."],
    cmd: "prvek offsetFace distance=0,5 faces=válcové",
    note: "Odsazení stěny díry o +0,5 mm díru zmenší.",
  },
  "quick/df": {
    what: "Otevře Odstranit plochu s kliknutou plochou – těleso se zacelí.",
    when: "Odstranění díry, zaoblení nebo čepu z importovaného modelu bez historie.",
    select: "Plochu – lišta se ukáže po kliknutí na ni; další přidáte ve formuláři.",
    steps: ["Klikněte na plochu (např. stěnu díry) a zvolte Odstranit plochu.", "Zkontrolujte seznam ploch a potvrďte OK."],
    cmd: "prvek deleteFace faces=válcové",
    note: "Zacelit jde jen to, co okolní plochy uzavřou – jinak prvek ohlásí chybu.",
  },
  "quick/fi": {
    what: "Otevře Zaoblit s kliknutou hranou.",
    when: "Rychlé zaoblení hrany bez hledání tlačítka na pásu karet.",
    select: "Hranu tělesa – lišta se ukáže po kliknutí na hranu v dílu.",
    steps: ["Klikněte na hranu a v liště zvolte Zaoblit hranu.", "Zadejte Poloměr; další hrany přidáte kliknutím v modelu.", "Potvrďte OK."],
    cmd: "zaoblit 2 hrany svislé",
  },
  "quick/ch": {
    what: "Otevře Srazit s kliknutou hranou.",
    when: "Rychlé sražení hrany pro montáž nebo odjehlení.",
    select: "Hranu tělesa – lišta se ukáže po kliknutí na hranu v dílu.",
    steps: ["Klikněte na hranu a v liště zvolte Srazit hranu.", "Zvolte Druh sražení a zadejte rozměr; další hrany přidáte kliknutím.", "Potvrďte OK."],
    cmd: "srazit 1 hrany horní",
  },
  "quick/meas": {
    what: "Zapne měření s kliknutou entitou jako první – stačí kliknout na druhou.",
    when: "Délka hrany, vzdálenost od vrcholu, rozměry tělesa jedním klikem.",
    select: "Hranu, vrchol nebo těleso – lišta se ukáže po kliknutí v dílu.",
    steps: ["Klikněte na entitu a v liště zvolte Měřit.", "Klikněte na druhou entitu – panel Měření ukáže vzdálenost a úhel."],
    cmd: "měřit E5 F3",
    note: "Měření ukončíte klávesou Esc nebo křížkem panelu.",
  },
  "quick/props": {
    what: "Otevře panel Vlastnosti s údaji o kliknuté entitě.",
    when: "Typ a délka hrany, Ø oblouku, souřadnice vrcholu.",
    select: "Hranu nebo vrchol (u plochy a tělesa je volba pod ⋯).",
    steps: ["Klikněte na hranu nebo vrchol a v liště zvolte Vlastnosti."],
    cmd: "měřit E5",
  },
  "quick/co": {
    what: "Ukazuje souřadnice X ; Y ; Z kliknutého vrcholu přímo na tlačítku.",
    when: "Rychlé odečtení polohy rohu pro díru, skicu nebo kótu.",
    select: "Vrchol (filtr Vše nebo Bod) – lišta se ukáže po kliknutí na něj.",
    steps: ["Klikněte na vrchol a odečtěte souřadnice na tlačítku.", "Klik na tlačítko obnoví údaje v panelu Vlastnosti."],
    cmd: "měřit V2",
    note: "Hodnoty na tlačítku jsou zaokrouhlené na 2 desetinná místa.",
  },
  "quick/mv": {
    what: "Přidá prvek Přesunout / otočit a ukáže gizmo pro posun a otočení celého tělesa.",
    when: "Srovnání importovaného modelu, natočení dílu do výrobní polohy.",
    select: "Těleso (filtr Těleso / tvar) – lišta se ukáže po kliknutí na něj.",
    steps: ["Klikněte na těleso a v liště zvolte Přesunout / otočit (gizmo).", "Táhněte šipky (krok 1 mm) nebo oblouky (15°); R přepne posun/otočení.", "Klikněte na Hotovo."],
    cmd: "prvek transform translate=10;0;0",
    note: "Je-li posledním prvkem historie už Přesunout / otočit, upraví se ten.",
  },
  "quick/hd": {
    what: "Skryje celé těleso dílu, nebo ho znovu zobrazí – jen zobrazení, model se nemění.",
    when: "Pohled na skici, pomocné roviny a osy schované v tělese.",
    select: "Těleso (filtr Těleso / tvar).",
    steps: ["Klikněte na těleso a v liště zvolte Skrýt těleso."],
    note: "Skryté těleso nejde kliknout, takže ho touto lištou znovu nezobrazíte.",
  },
  "quick/tr": {
    what: "Přepne těleso na poloprůhledné a zpět na neprůhledné – jen zobrazení.",
    when: "Pohled na vnitřní díry a kanály, aniž byste měnili styl zobrazení.",
    select: "Těleso (filtr Těleso / tvar).",
    steps: ["Klikněte na těleso a v liště zvolte Průhledné; zpět Neprůhledné."],
    note: "Pro celý model naráz je styl Průhledný na kartě Zobrazení.",
  },

  // ── Sestava › Vložit ──
  ins: {
    what: "Vloží do sestavy díl .mncad nebo model STEP, IGES, STL… ze souboru jako komponentu.",
    when: "Sestavování z hotových dílů, nakupované díly od dodavatele ve STEP.",
    steps: ["Klikněte na Vložit díl / model a vyberte soubor.", "Komponentu umístěte tlačítkem Přesunout / otočit nebo vazbami."],
    cmd: 'vložit "Deska" v 100 0 0',
    note: "Soubor sestavy (.mncad) se nevloží, ale otevře v nové záložce.",
  },
  "asm/library": {
    what: "Otevře knihovnu normálií – šrouby, matice, ložiska, kolíky, ozubená kola, profily, normálie forem.",
    when: "Normalizované díly do sestavy bez kreslení.",
    steps: ["Napište označení (např. M8x30, ložisko 6205, vyhazovač 6x160) nebo vyberte kategorii.", "Zkontrolujte rozměry a klikněte na Vložit do sestavy."],
    cmd: "normálie M8x30",
    note: "Otevřít jako nový díl ho místo vložení otevře v nové záložce.",
  },
  newpart: {
    what: "Přidá do sestavy nový prázdný díl a rovnou ho otevře k modelování v kontextu sestavy.",
    when: "Díl navrhovaný podle okolních dílů – deska, vložka, přípravek.",
    steps: ["Klikněte na Nový díl – otevře se karta Tvorba s pruhem Úprava dílu.", "Namodelujte díl (skica, vysunutí…).", "Klikněte na ← Zpět do sestavy."],
  },

  // ── Sestava › Normálie ──
  screw: {
    what: "Vloží do sestavy imbusový šroub ISO 4762 velikosti M6–M16 a délky 20, 40 nebo 60 mm.",
    when: "Šroubové spoje desek formy, přípravku nebo nástroje.",
    steps: ["Otevřete nabídku Šroub ISO 4762 a zvolte rozměr.", "Umístěte šroub tlačítkem Přesunout / otočit nebo vazbou Vystředit do díry."],
    cmd: "normálie M8x40",
    note: "Šroub je zjednodušený, bez závitu. Jiné rozměry najdete v Knihovně normálií.",
  },
  "menu:screw/*": {
    what: "Vloží šroub ISO 4762 tohoto rozměru (závit × délka v mm) jako komponentu.",
    when: "Rychlé vložení běžného šroubu bez otevírání knihovny.",
    steps: ["Klikněte na rozměr – šroub se vloží vedle modelu (do prázdné sestavy do počátku)."],
    cmd: "normálie M8x40",
    note: "Hlava leží na rovině XY, dřík míří do −Z.",
  },
  pillar: {
    what: "Vloží vodicí sloupek s límcem Ø16–Ø40, délka 5 × Ø.",
    when: "Vedení desek formy nebo střižného nástroje.",
    steps: ["Otevřete nabídku Vodicí sloupek a zvolte Ø × délka.", "Umístěte ho tlačítkem Přesunout / otočit nebo vazbou Vystředit do díry."],
    cmd: "normálie vodicí sloupek 20x100",
    note: "Vloží se do skupiny Vedení; protikus je Vodicí pouzdro stejného Ø.",
  },
  "menu:pillar/*": {
    what: "Vloží vodicí sloupek tohoto rozměru (Ø × délka) do skupiny Vedení.",
    when: "Rychlé vložení sloupku bez otevírání knihovny.",
    steps: ["Klikněte na rozměr – sloupek se vloží jako komponenta."],
    cmd: "normálie vodicí sloupek 20x100",
  },
  bush: {
    what: "Vloží vodicí pouzdro s límcem pro sloupek Ø16–Ø40, délka 2 × Ø.",
    when: "Protikus vodicího sloupku v druhé desce formy.",
    steps: ["Otevřete nabídku Vodicí pouzdro a zvolte Ø × délka.", "Umístěte ho souose se sloupkem (Přesunout / otočit nebo vazba Vystředit)."],
    cmd: "normálie vodicí pouzdro 20x40",
    note: "Vloží se do skupiny Vedení.",
  },
  "menu:bush/*": {
    what: "Vloží vodicí pouzdro tohoto rozměru (Ø × délka) do skupiny Vedení.",
    when: "Rychlé vložení pouzdra bez otevírání knihovny.",
    steps: ["Klikněte na rozměr – pouzdro se vloží jako komponenta."],
    cmd: "normálie vodicí pouzdro 20x40",
  },
  pin: {
    what: "Vloží vyhazovač s válcovou hlavou Ø3–Ø10, délka dříku 150 mm.",
    when: "Vyhazování výlisku z formy; polohy navrhnou Formařské nástroje v dílu.",
    steps: ["Otevřete nabídku Vyhazovač a zvolte průměr.", "Umístěte ho tlačítkem Přesunout / otočit nebo vazbou Vystředit."],
    cmd: "normálie vyhazovač 6x150",
    note: "Vloží se do skupiny Vyhazování.",
  },
  "menu:pin/*": {
    what: "Vloží vyhazovač tohoto průměru, délka dříku 150 mm, do skupiny Vyhazování.",
    when: "Rychlé vložení vyhazovače bez otevírání knihovny.",
    steps: ["Klikněte na rozměr – vyhazovač se vloží jako komponenta."],
    cmd: "normálie vyhazovač 6x150",
  },
  ring: {
    what: "Vloží středicí kroužek Ø100 × 10 mm (vnitřní Ø36) jako komponentu.",
    when: "Ustředění formy na upínací desce vstřikolisu.",
    steps: ["Klikněte na Středicí kroužek – vloží se jako komponenta.", "Usaďte ho na upínací desku (Přesunout / otočit nebo vazba Kontakt)."],
    cmd: "normálie středicí kroužek 100",
    note: "Jiný průměr (90–160 mm) najdete v Knihovně normálií.",
  },

  // ── Sestava › Přesun ──
  gz: {
    what: "Posune nebo otočí vybranou komponentu gizmem; vazby se po přesunu přepočítají.",
    when: "Hrubé umístění dílu před vazbami, posun dílu mimo kolizi.",
    select: "Komponentu ve stromu sestavy nebo v modelu.",
    steps: ["Vyberte komponentu a klikněte na Přesunout / otočit.", "Táhněte šipky (krok 1 mm) nebo oblouky (15°); R přepne posun/otočení.", "Klikněte na Hotovo."],
    cmd: 'sestava komponenta "Čep" posun 10 0 0',
    note: "Ukotvenou komponentu je třeba nejdřív uvolnit.",
  },
  "asm/delete": {
    what: "Odebere vybrané komponenty ze sestavy.",
    when: "Úklid sestavy, výměna dílu za jinou variantu.",
    select: "Komponenty v modelu (filtr Komponenta, Ctrl+klik) nebo komponentu ve stromu.",
    steps: ["Vyberte komponenty.", "Klikněte na Odebrat a potvrďte dotaz."],
    cmd: 'sestava odebrat "Čep"',
    note: "Ctrl+Z odebrání vrátí; potvrzování vypnete v Nastavení › Obecné.",
  },
  sub: {
    what: "Seskupí komponenty do podsestavy, rozpustí ji nebo ji otevře k úpravě.",
    when: "Uzel, který se pohybuje nebo opakuje jako celek – vedení, vyhazovací paket.",
    steps: ["Otevřete nabídku Podsestava.", "Zvolte Vytvořit z vybraných, Rozpustit vybranou nebo Otevřít vybranou."],
    cmd: 'sestava podsestava "A" "B" jako "Vedení"',
  },
  "menu:sub/mk": {
    what: "Z komponent vybraných v modelu vytvoří novou podsestavu (Podsestava 1, 2…).",
    when: "Seskupení dílů uzlu, aby se přesouvaly jako celek.",
    select: "Komponenty kliknutím v modelu (filtr Komponenta, Ctrl+klik).",
    steps: ["Ctrl+klikem vyberte komponenty ve 3D okně.", "Zvolte Vytvořit z vybraných (Ctrl+klik)."],
    cmd: 'sestava podsestava "A" "B"',
    note: "Počítá se jen výběr ve 3D okně – komponenta vybraná jen ve stromu ne.",
  },
  "menu:sub/dis": {
    what: "Rozpustí vybranou podsestavu – její komponenty se vrátí přímo do sestavy.",
    when: "Zrušení seskupení, přesun dílu z podsestavy jinam.",
    select: "Podsestavu (filtr Podsestava nebo ve stromu).",
    steps: ["Vyberte podsestavu.", "Zvolte Rozpustit vybranou."],
    cmd: 'sestava rozpustit "Vedení"',
  },
  "menu:sub/open": {
    what: "Otevře vybranou podsestavu k úpravě v téže záložce (pruh Úprava podsestavy).",
    when: "Přidání, posun nebo vazby dílů uvnitř podsestavy.",
    select: "Podsestavu (filtr Podsestava nebo ve stromu).",
    steps: ["Vyberte podsestavu a zvolte Otevřít vybranou.", "Upravte komponenty a klikněte na ← Zpět do sestavy."],
    cmd: 'sestava upravit "Vedení"',
  },

  // ── Sestava › Formy ──
  mold: {
    what: "Otevře průvodce rámem vstřikovací formy: upínací a tvarové desky, rozpěrky, vyhazovací paket, sloupky.",
    when: "Návrh dvoudeskové formy kolem tvarové vložky.",
    steps: ["Zadejte Šířka X, Délka Y, tloušťky desek a Ø vodicích sloupků.", "Volitelně Dutina v desce A a Materiál desek.", "Klikněte na Vytvořit rám formy."],
    cmd: "rám formy 246 296",
    note: "Rám nahradí obsah aktuální záložky (Ctrl+Z vrátí) – vložky přidejte až potom.",
  },
} satisfies Record<string, MicroTip>;
