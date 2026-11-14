/** Mikronávody – jádro 2D výkresu (karty Kreslení, Úpravy, Hladiny, Poznámky, Výstup – tlačítka jádra), čeština (zdroj). Klíč = „draft/<id tlačítka pásu>“. */
// same shape as MicroTip in help/tips.ts (integrace přepne na import typu a zaregistruje balík)
type MicroTip = { what: string; when: string; select?: string; steps: string[]; cmd?: string; note?: string };

export default {
  // ── Kreslení ──
  "draft/line": {
    what: "Nakreslí navazující úsečky – každý úsek je samostatná entita.",
    when: "Obrysy dílů, osy a pomocné čáry s přesnými body.",
    steps: ["Klikněte nebo napište první bod (x,y).", "Další body: @dx,dy relativně, @délka<úhel polárně.", "Zpět vrátí úsek, Uzavřít spojí s počátkem, Enter ukončí."],
    cmd: "2d čára 0,0 100,0 100,50",
    note: "ORTHO (F8) a uchopení (F3) zajistí přesné kreslení myší.",
  },
  "draft/pline": {
    what: "Nakreslí křivku z úseček a oblouků jako jednu entitu, volitelně se šířkou.",
    when: "Uzavřené obrysy pro šrafu, ekvidistantu a zaoblení všech rohů najednou.",
    steps: ["Zadejte první bod a další vrcholy.", "Oblouk přepne na oblouky, Úsečka zpět, Šířka nastaví tloušťku.", "Uzavřít obrys spojí, Enter ukončí."],
    cmd: "2d křivka 0,0 100,0 100,50 0,50 uzavřít",
  },
  "draft/circle": {
    what: "Nakreslí kružnici ze středu a poloměru nebo průměru, 2 či 3 bodů nebo tečně ke dvěma objektům.",
    when: "Díry, čepy a rozteče; TTP pro kružnici tečnou ke dvěma hranám.",
    steps: ["Klikněte střed (uchopení na průsečík os).", "Napište poloměr, nebo Průměr a hodnotu.", "Šipka u tlačítka nabídne 2 body, 3 body a TTP."],
    cmd: "2d kružnice 50,25 průměr 20",
  },
  "draft/arc": {
    what: "Nakreslí kruhový oblouk třemi body nebo ze středu, počátku a konce (proti směru hodin).",
    when: "Zaoblené přechody, konce drážek a obloukové části obrysu.",
    steps: ["Zadejte počátek, bod na oblouku a konec.", "Nebo Střed: střed, počátek a konec (úhel proti směru hodin)."],
    cmd: "2d oblouk střed 60,0 75,0 45,0",
  },
  "draft/rect": {
    what: "Nakreslí obdélník jako uzavřenou křivku ze dvou rohů nebo z rozměrů.",
    when: "Desky, rámečky a drážky; se zaoblenými nebo zkosenými rohy.",
    steps: ["Klikněte první roh.", "Druhý roh: klik, @šířka,výška nebo Rozměry.", "Zaoblení / Zkosení zadejte před prvním rohem."],
    cmd: "2d obdélník 0,0 @100,50",
  },
  "draft/polygon": {
    what: "Nakreslí pravidelný mnohoúhelník vepsaný nebo opsaný kružnici, nebo podle délky hrany.",
    when: "Šestihran matice či hlavy šroubu, čtyřhran, pravidelné drážky.",
    steps: ["Napište počet stran.", "Zadejte střed (nebo Hrana a dva body).", "Zvolte Vepsaný / Opsaný a poloměr."],
    cmd: "2d mnohoúhelník 6 0,0 opsaný 6.5",
    note: "Opsaný = poloměr k polovině strany, tedy polovina rozměru klíče.",
  },
  "draft/ellipse": {
    what: "Nakreslí elipsu nebo eliptický oblouk z osy a druhé poloosy, nebo ze středu.",
    when: "Šikmé pohledy na díry, oválné otvory a eliptické drážky.",
    steps: ["Zadejte oba konce první osy.", "Zadejte délku druhé poloosy.", "Šipka u tlačítka nabídne Střed a Eliptický oblouk."],
    cmd: "2d elipsa -50,0 50,0 20",
  },
  "draft/spline": {
    what: "Nakreslí hladkou křivku NURBS proložením bodů nebo řídicími body.",
    when: "Volné tvary, vačky a profily – do DWG / DXF se přenese přesně.",
    steps: ["Klikejte body, kterými má křivka projít.", "Enter ukončí, Uzavřít vytvoří uzavřenou křivku.", "Šipka přepne metodu: proložení / řídicí body."],
    cmd: "2d spline 0,0 10,10 20,0 30,10",
  },
  "draft/xline": {
    what: "Nakreslí nekonečnou konstrukční přímku bodem a směrem (vodorovně, svisle, pod úhlem, osou úhlu).",
    when: "Promítací čáry mezi pohledy a pomocné osy při konstrukci.",
    steps: ["Zvolte směr (Vodorovně, Svisle, Úhel, Osa) nebo klikněte dva body.", "Klikejte body, kterými přímky vedou; Enter ukončí."],
    cmd: "2d přímka vodorovně 0,50",
    note: "Konstrukční čáry dejte do vlastní hladiny – jedním klikem je pak vypnete.",
  },
  "draft/ray": {
    what: "Nakreslí polopřímku z bodu daným směrem do nekonečna.",
    when: "Pomocné čáry, které mají začínat v konkrétním bodě (projekce, úhly).",
    steps: ["Klikněte počáteční bod.", "Klikejte body směru – každý vytvoří polopřímku; Enter ukončí."],
    cmd: "2d polopřímka 0,0 100,100",
  },
  "draft/point": {
    what: "Vloží bod (uzel), na který lze uchopit režimem Uzel.",
    when: "Značky souřadnic, středy otvorů pro CNC, body po rozdělení křivky.",
    steps: ["Klikejte nebo pište body; Enter ukončí."],
    cmd: "2d bod 10,10 20,20",
    note: "Vzhled bodu nastaví PDMODE, např. 2d proměnná pdmode 3.",
  },
  "draft/text": {
    what: "Vloží jednořádkový text s výškou a natočením; každý řádek je samostatná entita.",
    when: "Krátké popisy, čísla pozic a označení řezů.",
    steps: ["Klikněte počáteční bod (Zarovnání změní polohu).", "Zadejte výšku a natočení.", "Napište text a potvrďte Enter."],
    cmd: '2d text 10,10 3.5 0 "Deska"',
    note: "Víceřádkový text s formátováním: karta Poznámky ▸ Odstavcový text.",
  },
  "draft/text2": {
    what: "Vloží jednořádkový text s výškou a natočením; každý řádek je samostatná entita.",
    when: "Krátké popisy, čísla pozic a označení řezů přímo z karty Poznámky.",
    steps: ["Klikněte počáteční bod.", "Zadejte výšku a natočení.", "Napište text a potvrďte Enter."],
    cmd: '2d text 10,10 3.5 0 "Řez A-A"',
  },
  // ── Dotazy ──
  "draft/dist": {
    what: "Změří vzdálenost dvou bodů, přírůstky ΔX, ΔY a úhel; výsledek je v protokolu.",
    when: "Kontrola rozměru, rozteče děr nebo vzdálenosti hran bez kreslení kóty.",
    steps: ["Klikněte první bod (s uchopením přesně).", "Klikněte druhý bod.", "Hodnoty si přečtěte v příkazovém řádku."],
    cmd: "2d vzdálenost 0,0 100,50",
  },
  "draft/area": {
    what: "Spočítá plochu a obvod oblasti z bodů nebo uzavřeného objektu.",
    when: "Plocha dílu pro hmotnost, výpočet řezné délky, kontrola výpalku.",
    steps: ["Klikejte vrcholy oblasti, Enter spočítá.", "Nebo Objekt a klikněte kružnici, uzavřenou křivku či šrafu."],
    cmd: "2d plocha 0,0 100,0 100,50",
  },
  "draft/id": {
    what: "Vypíše souřadnice X a Y bodu – s uchopením přesně.",
    when: "Odečtení polohy středu díry nebo koncového bodu pro CNC program.",
    steps: ["Klikněte bod (uchopení: konec, střed, průsečík…).", "Souřadnice se vypíšou v příkazovém řádku."],
    cmd: "2d souřadnice 25,40",
  },
  "draft/list": {
    what: "Vypíše vlastnosti objektů: druh, hladinu, geometrii, délku a plochu.",
    when: "Rychlá kontrola, na jaké hladině objekt je a jaké má přesné hodnoty.",
    select: "Objekty vyberte předem nebo po spuštění.",
    steps: ["Vyberte objekty a potvrďte Enter.", "Výpis je v příkazovém řádku (F2 ho rozbalí)."],
    cmd: "2d výpis e1",
  },
  // ── Výběr a úpravy jádra ──
  "draft/all": {
    what: "Vybere všechny objekty zobrazeného prostoru kromě zmrazených a vypnutých hladin.",
    when: "Před posunem, změnou hladiny nebo smazáním celého obsahu.",
    steps: ["Klikněte Vybrat vše (Ctrl+A).", "Pak spusťte příkaz – výběr se použije."],
    cmd: "2d vyber vše",
  },
  "draft/none": {
    what: "Zruší aktuální výběr objektů.",
    when: "Když chcete spustit příkaz s novým výběrem.",
    steps: ["Klikněte Zrušit výběr nebo stiskněte Esc."],
    cmd: "2d vyber nic",
  },
  "draft/erase": {
    what: "Smaže vybrané objekty; objekty na zamčených hladinách přeskočí.",
    when: "Odstranění pomocných čar, starých kót nebo chybně nakreslených objektů.",
    select: "Objekty vyberte předem (klik, okno, křížení) nebo po spuštění.",
    steps: ["Vyberte objekty.", "Potvrďte Enter – smazání je jeden krok zpět."],
    cmd: "2d smazat e3",
    note: "Klávesa Delete smaže vybrané objekty stejně.",
  },
  "draft/props": {
    what: "Otevře panel Vlastnosti: hladina, barva, typ a tloušťka čáry a geometrie vybraných objektů.",
    when: "Přesun objektů do jiné hladiny, změna barvy nebo přesná úprava souřadnic.",
    select: "Vyberte jeden nebo více objektů.",
    steps: ["Vyberte objekty.", "V panelu změňte hodnotu – uloží se hned."],
    cmd: "2d vlastnosti e1 hladina OSY barva 1",
  },
  // ── Hladiny ──
  "draft/lm": {
    what: "Otevře správce hladin: nová, přejmenovat, barva, typ čáry, tloušťka, zapnout, zmrazit, zamknout, tisk.",
    when: "Založení hladin výkresu (obrys, osy, kóty, šrafy) a jejich vzhledu.",
    steps: ["Klikněte Správce hladin.", "Nová hladina, napište název a nastavte barvu, typ a tloušťku.", "Kliknutím na řádek ji udělejte aktuální."],
    cmd: "2d hladina nová VRTÁNÍ barva 1 typčáry CENTER",
  },
  "draft/cur": {
    what: "Nastaví aktuální hladinu ze seznamu – nové objekty se kreslí do ní.",
    when: "Před kreslením os, kót nebo šrafy do správné hladiny.",
    steps: ["Klikněte na tlačítko a vyberte hladinu ze seznamu."],
    cmd: "2d hladina aktuální OSY",
    note: "Zmrazená hladina nemůže být aktuální.",
  },
  "draft/mcur": {
    what: "Nastaví jako aktuální hladinu vybraného objektu.",
    when: "Chcete pokračovat v kreslení ve stejné hladině, jakou má existující čára.",
    select: "Vyberte objekt (nebo ho klikněte po spuštění).",
    steps: ["Vyberte objekt a klikněte Aktuální podle objektu."],
    cmd: "2d hladinaobjektu e1",
  },
  "draft/loff": {
    what: "Vypne hladinu vybraných objektů – objekty zmizí a netisknou se.",
    when: "Dočasné skrytí os, kót nebo konstrukčních čar.",
    select: "Vyberte objekt v hladině, kterou chcete vypnout.",
    steps: ["Vyberte objekt.", "Klikněte Vypnout hladinu objektu; zapnete ji ve správci hladin."],
    cmd: "2d hladina OSY vypnout",
  },
  "draft/lfrz": {
    what: "Zmrazí hladinu vybraných objektů – nekreslí se, nevybírají ani nepočítají do rozsahu.",
    when: "Velké výkresy: zmrazení zrychlí práci více než vypnutí.",
    select: "Vyberte objekt v hladině, kterou chcete zmrazit.",
    steps: ["Vyberte objekt.", "Klikněte Zmrazit hladinu objektu."],
    cmd: "2d hladina OSY zmrazit",
    note: "Aktuální hladinu zmrazit nelze.",
  },
  "draft/llck": {
    what: "Zamkne hladinu vybraných objektů – zůstanou vidět, ale nejdou upravit ani smazat.",
    when: "Ochrana rámečku, podkladu nebo hotového obrysu před nechtěnou změnou.",
    select: "Vyberte objekt v hladině, kterou chcete zamknout.",
    steps: ["Vyberte objekt.", "Klikněte Zamknout hladinu objektu."],
    cmd: "2d hladina OSY zamknout",
  },
  "draft/lall": {
    what: "Zapne a rozmrazí všechny hladiny výkresu.",
    when: "Po kontrole se skrytými hladinami – vše je zase vidět.",
    steps: ["Klikněte Zapnout a rozmrazit vše."],
    cmd: "2d hladina * zapnout",
  },
  "draft/lunl": {
    what: "Odemkne všechny hladiny výkresu.",
    when: "Před úpravou objektů, které jsou na zamčených hladinách.",
    steps: ["Klikněte Odemknout vše."],
    cmd: "2d hladina * odemknout",
  },
  // ── Typy čar ──
  "draft/ltload": {
    what: "Načte typ čáry z knihovny acadiso (CENTER, HIDDEN, DASHED, PHANTOM…).",
    when: "Osy (CENTER), skryté hrany (HIDDEN) a obrysy sousedních dílů (PHANTOM).",
    steps: ["Klikněte Načíst typ čáry a vyberte typ.", "Přiřaďte ho hladině ve správci hladin."],
    cmd: "2d typčáry načíst CENTER HIDDEN",
  },
  "draft/lts": {
    what: "Nastaví globální měřítko typů čar LTSCALE – délku čárek a mezer.",
    when: "Čárkované a osové čáry vypadají jako plné (malé měřítko) nebo příliš řídké.",
    steps: ["Klikněte tlačítko a napište měřítko (např. 0.5).", "Potvrďte Enter."],
    cmd: "2d měřítkočar 0.5",
    note: "Ve výřezech rozvržení platí PSLTSCALE (2d proměnná psltscale 1).",
  },
  "draft/lwt": {
    what: "Zapne nebo vypne zobrazení tlouštěk čar na obrazovce (LWDISPLAY).",
    when: "Kontrola tlustých a tenkých čar před tiskem.",
    steps: ["Klikněte Zobrazit tloušťky (také TLOUŠŤKY ve stavovém řádku)."],
    cmd: "2d tloušťky zap",
    note: "Tisk a PDF používají tloušťky vždy, nezávisle na tomto přepínači.",
  },
  // ── Výstup ──
  "draft/save": {
    what: "Uloží výkres jako .mncad se všemi hladinami, bloky a rozvrženími (Ctrl+S).",
    when: "Průběžné ukládání vlastní práce.",
    steps: ["Klikněte Uložit .mncad nebo stiskněte Ctrl+S."],
    note: "Pro AutoCAD použijte skupinu DWG / DXF ▸ Uložit jako….",
  },
  "draft/share": {
    what: "Vytvoří sdílený odkaz na výkres – otevře se v prohlížeči bez instalace.",
    when: "Rychlé předání výkresu kolegovi, zákazníkovi nebo dodavateli k nahlédnutí.",
    steps: ["Klikněte Sdílet odkazem.", "Zkopírujte odkaz a pošlete ho."],
  },
} satisfies Record<string, MicroTip>;
