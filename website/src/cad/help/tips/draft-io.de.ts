/** Kurzanleitungen – Paket „draft-io“ (2D-Zeichnung, Registerkarte Ausgabe, Gruppe DWG / DXF), Deutsch. */

/** gleiche Form wie MicroTip in help/tips.ts (die Integration ersetzt sie durch den Import) */
type MicroTip = { what: string; when: string; select?: string; steps: string[]; cmd?: string; note?: string };

export default {
  "draft/io-open": {
    what: "Öffnet eine DWG- (R2000–R2018) oder DXF-Zeichnung (R12–R2018) als neue 2D-Zeichnung in einem neuen Tab.",
    when: "Zeichnung von Kunde oder Lieferant aus AutoCAD, DraftSight, LibreCAD oder einem CAM-Programm.",
    steps: ["Auf DXF / DWG öffnen klicken und die Datei wählen.", "Bei großen Dateien den Fortschritt verfolgen; Abbrechen stoppt das Lesen.", "Was anders übernommen wurde, steht in der Meldung und in DWG / DXF-Optionen."],
    cmd: "importieren",
    note: "Strg+O und Ziehen der Datei ins Fenster funktionieren genauso; XREFs werden nicht geladen.",
  },
  "draft/io-insert": {
    what: "Fügt den Inhalt einer anderen DWG / DXF in die offene Zeichnung ein – Objekte, fehlende Ebenen, Stile, Blöcke.",
    when: "Firmenrahmen und Schriftfeld, ein Normdetail oder das Bauteil eines Kollegen in die eigene Zeichnung.",
    steps: ["Auf Zeichnung einfügen klicken und die Datei wählen.", "Die eingefügten Objekte bleiben ausgewählt – mit SCHIEBEN verschieben.", "Strg+Z macht das ganze Einfügen in einem Schritt rückgängig."],
    cmd: "importieren einfügen",
    note: "Gleichnamige Ebenen und Blöcke bleiben wie in der offenen Zeichnung; andere Einheiten werden skaliert.",
  },
  "draft/io-export": {
    what: "Speichert die Zeichnung als DWG (R2000–R2018) oder DXF (R12–R2018, auch binär) mit Ebenen, Blöcken, Maßen.",
    when: "Weitergabe an Lieferanten, an AutoCAD, Laser oder CNC; R12 für alte CAM-Programme.",
    steps: ["Auf Speichern unter… (Gruppe DWG / DXF) klicken und Format und Version wählen.", "Die Datei wird heruntergeladen; das Protokoll zeigt Version und Größe."],
    cmd: "exportieren dwg version R2013",
    note: "DXF R12 kennt kein MTEXT, keine Schraffuren und Layouts – sie werden vereinfacht geschrieben (Warnung).",
  },
  "menu:io-export/*": {
    what: "Schnellexport in der gewählten DXF- oder DWG-Version mit Standardnamen aus der Zeichnung.",
    when: "Wenn der Empfänger eine bestimmte Version braucht, z. B. AutoCAD 2013 oder ein altes Programm nur mit R12.",
    steps: ["Version im Menü wählen – die Datei wird sofort heruntergeladen."],
    cmd: "exportieren dxf version R2000",
  },
  "draft/io-panel": {
    what: "Öffnet den Bereich DWG / DXF: Format, Version, binäres DXF, Dateiname, Zeichnungseinheiten, Importprotokoll.",
    when: "Wenn Sie den Export anpassen oder sehen wollen, was beim Öffnen übernommen wurde und was nicht.",
    steps: ["Auf DWG / DXF-Optionen klicken.", "Format, Version und Namen wählen und mit Exportieren bestätigen.", "Einheiten (INSUNITS) einstellen, bevor Sie die Zeichnung weitergeben."],
    cmd: "exportieren dxf version R2018 binär",
    note: "Das Ändern der Einheiten skaliert die Geometrie nicht – es legt nur fest, was die Zahlen bedeuten.",
  },
} satisfies Record<string, MicroTip>;
