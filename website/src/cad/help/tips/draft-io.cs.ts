/** Mikronávody – balík „draft-io“ (2D výkres, karta Výstup, skupina DWG / DXF), čeština (zdroj). */

/** stejný tvar jako MicroTip v help/tips.ts (integrace ho nahradí importem) */
type MicroTip = { what: string; when: string; select?: string; steps: string[]; cmd?: string; note?: string };

export default {
  "draft/io-open": {
    what: "Otevře výkres DWG (R2000–R2018) nebo DXF (R12–R2018) jako nový 2D výkres v nové záložce.",
    when: "Výkres od zákazníka nebo dodavatele z AutoCADu, DraftSightu, LibreCADu či CAM programu.",
    steps: ["Klikněte na Otevřít DXF / DWG a vyberte soubor.", "U velkého souboru sledujte průběh; Zrušit čtení přeruší.", "Co se převedlo jinak, je v hlášce a v panelu Možnosti DWG / DXF."],
    cmd: "import",
    note: "Stejně funguje Ctrl+O a přetažení souboru do okna; XREF se nenačítají.",
  },
  "draft/io-insert": {
    what: "Vloží obsah jiného výkresu DWG / DXF do otevřeného výkresu – entity, chybějící hladiny, styly a bloky.",
    when: "Firemní rámeček a razítko, normalizovaný detail nebo díl od kolegy do vlastního výkresu.",
    steps: ["Klikněte na Vložit výkres a vyberte soubor.", "Vložené entity zůstanou vybrané – posuňte je příkazem POSUN.", "Ctrl+Z vrátí celé vložení jedním krokem."],
    cmd: "import sloučit",
    note: "Hladiny a bloky se stejným názvem zůstanou podle otevřeného výkresu; jiné jednotky se převedou měřítkem.",
  },
  "draft/io-export": {
    what: "Uloží výkres jako DWG (R2000–R2018) nebo DXF (R12–R2018, i binární) se všemi hladinami, bloky a kótami.",
    when: "Předání výkresu dodavateli, do AutoCADu, laseru nebo CNC; R12 pro staré CAM programy.",
    steps: ["Klikněte na Uložit jako… (skupina DWG / DXF) a zvolte formát a verzi.", "Soubor se stáhne; protokol ukáže verzi a velikost."],
    cmd: "export dwg verze R2013",
    note: "DXF R12 nezná MTEXT, šrafy ani rozvržení – zapíše je zjednodušeně (varování v protokolu).",
  },
  "menu:io-export/*": {
    what: "Rychlý export ve zvolené verzi DXF nebo DWG s výchozím názvem podle výkresu.",
    when: "Když příjemce potřebuje konkrétní verzi, např. AutoCAD 2013 nebo starý program jen s R12.",
    steps: ["Vyberte verzi v nabídce – soubor se hned stáhne."],
    cmd: "export dxf verze R2000",
  },
  "draft/io-panel": {
    what: "Otevře panel DWG / DXF: formát, verze, binární DXF, název souboru, jednotky výkresu a protokol importu.",
    when: "Když chcete export doladit nebo zjistit, co se při otevření souboru převedlo či nepřevedlo.",
    steps: ["Klikněte na Možnosti DWG / DXF.", "Zvolte formát, verzi a název a potvrďte Exportovat.", "Jednotky (INSUNITS) nastavte dřív, než výkres pošlete dál."],
    cmd: "export dxf verze R2018 binární",
    note: "Změna jednotek geometrii nepřepočítá – jen určí, v čem čísla jsou.",
  },
} satisfies Record<string, MicroTip>;
