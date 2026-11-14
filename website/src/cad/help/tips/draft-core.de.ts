/** Mikronávody – jádro 2D výkresu (karty Kreslení, Úpravy, Hladiny, Poznámky, Výstup – tlačítka jádra), němčina. Klíč = „draft/<id tlačítka pásu>“. */
// same shape as MicroTip in help/tips.ts (integrace přepne na import typu a zaregistruje balík)
type MicroTip = { what: string; when: string; select?: string; steps: string[]; cmd?: string; note?: string };

export default {
  // ── Zeichnen ──
  "draft/line": {
    what: "Zeichnet zusammenhängende Linien – jedes Segment ist ein eigenes Objekt.",
    when: "Bauteilkonturen, Mittellinien und Hilfslinien mit genauen Punkten.",
    steps: ["Ersten Punkt anklicken oder eingeben (x,y).", "Weitere Punkte: @dx,dy relativ, @Länge<Winkel polar.", "Zurück entfernt ein Segment, Schließen verbindet zum Start, Enter beendet."],
    cmd: "2d linie 0,0 100,0 100,50",
    note: "ORTHO (F8) und Objektfang (F3) machen das Zeichnen mit der Maus genau.",
  },
  "draft/pline": {
    what: "Zeichnet eine Polylinie aus Linien- und Bogensegmenten als ein Objekt, optional mit Breite.",
    when: "Geschlossene Konturen zum Schraffieren, Versetzen und Abrunden aller Ecken auf einmal.",
    steps: ["Ersten Punkt und weitere Scheitelpunkte angeben.", "Bogen schaltet auf Bögen, Linie zurück; Breite setzt die Stärke.", "Schließen verbindet die Kontur, Enter beendet."],
    cmd: "2d polylinie 0,0 100,0 100,50 0,50 schließen",
  },
  "draft/circle": {
    what: "Zeichnet einen Kreis aus Mittelpunkt und Radius oder Durchmesser, 2 oder 3 Punkten oder tangential zu zwei Objekten.",
    when: "Bohrungen, Bolzen und Lochkreise; TTR für einen Kreis tangential zu zwei Kanten.",
    steps: ["Mittelpunkt anklicken (Fang auf den Schnittpunkt der Mittellinien).", "Radius eingeben, oder Durchmesser und den Wert.", "Der Pfeil am Knopf bietet 2 Punkte, 3 Punkte und TTR."],
    cmd: "2d kreis 50,25 durchmesser 20",
  },
  "draft/arc": {
    what: "Zeichnet einen Kreisbogen durch drei Punkte oder aus Mittelpunkt, Start und Ende (gegen den Uhrzeigersinn).",
    when: "Abgerundete Übergänge, Nutenden und Bogenteile einer Kontur.",
    steps: ["Start, einen Punkt auf dem Bogen und das Ende angeben.", "Oder Mittelpunkt: Mittelpunkt, Start und Ende (Winkel gegen den Uhrzeigersinn)."],
    cmd: "2d bogen mittelpunkt 60,0 75,0 45,0",
  },
  "draft/rect": {
    what: "Zeichnet ein Rechteck als geschlossene Polylinie aus zwei Ecken oder aus Abmessungen.",
    when: "Platten, Rahmen und Nuten; mit abgerundeten oder gefasten Ecken.",
    steps: ["Erste Ecke anklicken.", "Zweite Ecke: Klick, @Breite,Höhe oder Abmessungen.", "Abrunden / Fase vor der ersten Ecke einstellen."],
    cmd: "2d rechteck 0,0 @100,50",
  },
  "draft/polygon": {
    what: "Zeichnet ein regelmäßiges Vieleck mit Umkreis oder Inkreis oder über die Kantenlänge.",
    when: "Sechskant einer Mutter oder Schraube, Vierkant, regelmäßige Nuten.",
    steps: ["Anzahl der Seiten eingeben.", "Mittelpunkt angeben (oder Kante und zwei Punkte).", "Umkreis / Inkreis und den Radius wählen."],
    cmd: "2d vieleck 6 0,0 inkreis 6.5",
    note: "Inkreis = Radius bis zur Seitenmitte, also die halbe Schlüsselweite.",
  },
  "draft/ellipse": {
    what: "Zeichnet eine Ellipse oder einen Ellipsenbogen aus einer Achse und der zweiten Halbachse oder aus dem Zentrum.",
    when: "Schrägansichten von Bohrungen, ovale Öffnungen und elliptische Nuten.",
    steps: ["Beide Enden der ersten Achse angeben.", "Länge der zweiten Halbachse angeben.", "Der Pfeil am Knopf bietet Zentrum und Ellipsenbogen."],
    cmd: "2d ellipse -50,0 50,0 20",
  },
  "draft/spline": {
    what: "Zeichnet eine glatte NURBS-Kurve durch Anpassungspunkte oder über Steuerpunkte.",
    when: "Freiformen, Kurvenscheiben und Profile – exakt nach DWG / DXF übertragen.",
    steps: ["Punkte anklicken, durch die die Kurve verläuft.", "Enter beendet, Schließen erzeugt eine geschlossene Kurve.", "Der Pfeil schaltet die Methode: Anpassen / Steuerpunkte."],
    cmd: "2d spline 0,0 10,10 20,0 30,10",
  },
  "draft/xline": {
    what: "Zeichnet eine unendliche Konstruktionslinie durch einen Punkt und eine Richtung (horizontal, vertikal, Winkel, Winkelhalbierende).",
    when: "Projektionslinien zwischen Ansichten und Hilfsachsen bei der Konstruktion.",
    steps: ["Richtung wählen (Hor, Ver, Winkel, Halbieren) oder zwei Punkte anklicken.", "Punkte anklicken, durch die die Linien verlaufen; Enter beendet."],
    cmd: "2d klinie hor 0,50",
    note: "Konstruktionslinien auf einen eigenen Layer legen – dann mit einem Klick ausschalten.",
  },
  "draft/ray": {
    what: "Zeichnet einen Strahl von einem Punkt in eine Richtung bis ins Unendliche.",
    when: "Hilfslinien, die in einem bestimmten Punkt beginnen sollen (Projektionen, Winkel).",
    steps: ["Startpunkt anklicken.", "Richtungspunkte anklicken – jeder erzeugt einen Strahl; Enter beendet."],
    cmd: "2d strahl 0,0 100,100",
  },
  "draft/point": {
    what: "Fügt einen Punkt (Knoten) ein, der mit dem Fang Knoten gefangen werden kann.",
    when: "Koordinatenmarken, Bohrungsmitten für CNC, Punkte nach dem Teilen einer Kurve.",
    steps: ["Punkte anklicken oder eingeben; Enter beendet."],
    cmd: "2d punkt 10,10 20,20",
    note: "Das Punktsymbol stellt PDMODE ein, z. B. 2d variable pdmode 3.",
  },
  "draft/text": {
    what: "Fügt einzeiligen Text mit Höhe und Drehung ein; jede Zeile ist ein eigenes Objekt.",
    when: "Kurze Beschriftungen, Positionsnummern und Schnittbezeichnungen.",
    steps: ["Startpunkt anklicken (Ausrichten ändert den Bezugspunkt).", "Höhe und Drehung angeben.", "Text eingeben und mit Enter bestätigen."],
    cmd: '2d dtext 10,10 3.5 0 "Platte"',
    note: "Mehrzeiliger formatierter Text: Register Beschriften ▸ Absatztext.",
  },
  "draft/text2": {
    what: "Fügt einzeiligen Text mit Höhe und Drehung ein; jede Zeile ist ein eigenes Objekt.",
    when: "Kurze Beschriftungen, Positionsnummern und Schnittbezeichnungen direkt aus dem Register Beschriften.",
    steps: ["Startpunkt anklicken.", "Höhe und Drehung angeben.", "Text eingeben und mit Enter bestätigen."],
    cmd: '2d dtext 10,10 3.5 0 "Schnitt A-A"',
  },
  // ── Abfragen ──
  "draft/dist": {
    what: "Misst den Abstand zweier Punkte, die Zuwächse ΔX, ΔY und den Winkel; Ergebnis im Protokoll.",
    when: "Prüfen eines Maßes, Lochabstands oder Kantenabstands ohne Bemaßung.",
    steps: ["Ersten Punkt anklicken (mit Objektfang exakt).", "Zweiten Punkt anklicken.", "Werte in der Befehlszeile ablesen."],
    cmd: "2d abstand 0,0 100,50",
  },
  "draft/area": {
    what: "Berechnet Fläche und Umfang eines Bereichs aus Punkten oder einem geschlossenen Objekt.",
    when: "Bauteilfläche für das Gewicht, Schnittlänge, Kontrolle eines Brennteils.",
    steps: ["Eckpunkte des Bereichs anklicken, Enter berechnet.", "Oder Objekt und einen Kreis, eine geschlossene Polylinie oder Schraffur anklicken."],
    cmd: "2d fläche 0,0 100,0 100,50",
  },
  "draft/id": {
    what: "Zeigt die X- und Y-Koordinaten eines Punkts – mit Objektfang exakt.",
    when: "Position einer Bohrungsmitte oder eines Endpunkts für ein CNC-Programm ablesen.",
    steps: ["Punkt anklicken (Fang: Endpunkt, Mitte, Schnittpunkt…).", "Die Koordinaten erscheinen in der Befehlszeile."],
    cmd: "2d koordinaten 25,40",
  },
  "draft/list": {
    what: "Listet Objekteigenschaften: Art, Layer, Geometrie, Länge und Fläche.",
    when: "Schnell prüfen, auf welchem Layer ein Objekt liegt und welche genauen Werte es hat.",
    select: "Objekte vorher oder nach dem Start wählen.",
    steps: ["Objekte wählen und mit Enter bestätigen.", "Die Liste steht in der Befehlszeile (F2 klappt sie auf)."],
    cmd: "2d liste e1",
  },
  // ── Auswahl und Grundbearbeitung ──
  "draft/all": {
    what: "Wählt alle Objekte des angezeigten Bereichs außer auf gefrorenen und ausgeschalteten Layern.",
    when: "Vor dem Verschieben, Layerwechsel oder Löschen des gesamten Inhalts.",
    steps: ["Alles wählen anklicken (Strg+A).", "Dann einen Befehl starten – die Auswahl wird verwendet."],
    cmd: "2d wählen alles",
  },
  "draft/none": {
    what: "Hebt die aktuelle Auswahl auf.",
    when: "Wenn ein Befehl mit einer neuen Auswahl starten soll.",
    steps: ["Auswahl aufheben anklicken oder Esc drücken."],
    cmd: "2d wählen nichts",
  },
  "draft/erase": {
    what: "Löscht die gewählten Objekte; Objekte auf gesperrten Layern werden übersprungen.",
    when: "Entfernen von Hilfslinien, alten Bemaßungen oder falsch gezeichneten Objekten.",
    select: "Objekte vorher wählen (Klick, Fenster, Kreuzen) oder nach dem Start.",
    steps: ["Objekte wählen.", "Mit Enter bestätigen – Löschen ist ein Rückgängig-Schritt."],
    cmd: "2d löschen e3",
    note: "Die Entf-Taste löscht die gewählten Objekte ebenso.",
  },
  "draft/props": {
    what: "Öffnet die Eigenschaften: Layer, Farbe, Linientyp, Linienstärke und Geometrie der gewählten Objekte.",
    when: "Objekte auf einen anderen Layer legen, Farbe ändern oder Koordinaten genau bearbeiten.",
    select: "Ein oder mehrere Objekte wählen.",
    steps: ["Objekte wählen.", "Einen Wert in der Palette ändern – er gilt sofort."],
    cmd: "2d eigenschaften e1 ebene OSY farbe 1",
  },
  // ── Layer ──
  "draft/lm": {
    what: "Öffnet die Layerverwaltung: neu, umbenennen, Farbe, Linientyp, Linienstärke, ein, frieren, sperren, plotten.",
    when: "Layer der Zeichnung anlegen (Kontur, Mittellinien, Bemaßung, Schraffur) und ihr Aussehen festlegen.",
    steps: ["Layerverwaltung anklicken.", "Neuer Layer, Namen eingeben und Farbe, Linientyp und Stärke setzen.", "Eine Zeile anklicken, um sie aktuell zu machen."],
    cmd: "2d ebene neu BOHRUNG farbe 1 linientyp CENTER",
  },
  "draft/cur": {
    what: "Setzt den aktuellen Layer aus der Liste – neue Objekte werden darauf gezeichnet.",
    when: "Vor dem Zeichnen von Mittellinien, Bemaßungen oder Schraffuren auf dem richtigen Layer.",
    steps: ["Knopf anklicken und einen Layer aus der Liste wählen."],
    cmd: "2d ebene aktuell OSY",
    note: "Ein gefrorener Layer kann nicht aktuell sein.",
  },
  "draft/mcur": {
    what: "Macht den Layer des gewählten Objekts zum aktuellen Layer.",
    when: "Auf demselben Layer wie eine vorhandene Linie weiterzeichnen.",
    select: "Ein Objekt wählen (oder nach dem Start anklicken).",
    steps: ["Objekt wählen und Aktuell nach Objekt anklicken."],
    cmd: "2d ebeneaktobj e1",
  },
  "draft/loff": {
    what: "Schaltet den Layer der gewählten Objekte aus – sie verschwinden und werden nicht geplottet.",
    when: "Mittellinien, Bemaßungen oder Konstruktionslinien vorübergehend ausblenden.",
    select: "Ein Objekt auf dem Layer wählen, der ausgeschaltet werden soll.",
    steps: ["Objekt wählen.", "Layer des Objekts ausschalten anklicken; einschalten in der Layerverwaltung."],
    cmd: "2d ebene OSY aus",
  },
  "draft/lfrz": {
    what: "Friert den Layer der gewählten Objekte – nicht gezeichnet, gewählt oder in die Grenzen gerechnet.",
    when: "Große Zeichnungen: Frieren beschleunigt die Arbeit mehr als Ausschalten.",
    select: "Ein Objekt auf dem Layer wählen, der gefroren werden soll.",
    steps: ["Objekt wählen.", "Layer des Objekts frieren anklicken."],
    cmd: "2d ebene OSY frieren",
    note: "Der aktuelle Layer kann nicht gefroren werden.",
  },
  "draft/llck": {
    what: "Sperrt den Layer der gewählten Objekte – sichtbar, aber nicht bearbeitbar oder löschbar.",
    when: "Rahmen, Unterlage oder fertige Kontur vor versehentlichen Änderungen schützen.",
    select: "Ein Objekt auf dem Layer wählen, der gesperrt werden soll.",
    steps: ["Objekt wählen.", "Layer des Objekts sperren anklicken."],
    cmd: "2d ebene OSY sperren",
  },
  "draft/lall": {
    what: "Schaltet alle Layer der Zeichnung ein und taut sie auf.",
    when: "Nach einer Prüfung mit ausgeblendeten Layern – alles ist wieder sichtbar.",
    steps: ["Alle ein- und auftauen anklicken."],
    cmd: "2d ebene * ein",
  },
  "draft/lunl": {
    what: "Entsperrt alle Layer der Zeichnung.",
    when: "Vor dem Bearbeiten von Objekten auf gesperrten Layern.",
    steps: ["Alle entsperren anklicken."],
    cmd: "2d ebene * entsperren",
  },
  // ── Linientypen ──
  "draft/ltload": {
    what: "Lädt einen Linientyp aus der Bibliothek acadiso (CENTER, HIDDEN, DASHED, PHANTOM…).",
    when: "Mittellinien (CENTER), verdeckte Kanten (HIDDEN) und Nachbarteile (PHANTOM).",
    steps: ["Linientyp laden anklicken und einen Typ wählen.", "In der Layerverwaltung einem Layer zuweisen."],
    cmd: "2d linientyp laden CENTER HIDDEN",
  },
  "draft/lts": {
    what: "Setzt den globalen Linientypfaktor LTSCALE – die Länge von Strichen und Lücken.",
    when: "Strich- und Mittellinien wirken durchgezogen (Faktor zu klein) oder zu licht.",
    steps: ["Knopf anklicken und den Faktor eingeben (z. B. 0.5).", "Mit Enter bestätigen."],
    cmd: "2d ltfaktor 0.5",
    note: "In Layout-Ansichtsfenstern gilt PSLTSCALE (2d variable psltscale 1).",
  },
  "draft/lwt": {
    what: "Schaltet die Anzeige der Linienstärken am Bildschirm (LWDISPLAY) ein oder aus.",
    when: "Dicke und dünne Linien vor dem Plotten prüfen.",
    steps: ["Linienstärken anzeigen anklicken (auch LINIENSTÄRKE in der Statusleiste)."],
    cmd: "2d lwanzeige ein",
    note: "Plot und PDF verwenden die Linienstärken immer, unabhängig von diesem Schalter.",
  },
  // ── Ausgabe ──
  "draft/save": {
    what: "Speichert die Zeichnung als .mncad mit allen Layern, Blöcken und Layouts (Strg+S).",
    when: "Regelmäßiges Speichern der eigenen Arbeit.",
    steps: ["Speichern .mncad anklicken oder Strg+S drücken."],
    note: "Für AutoCAD die Gruppe DWG / DXF ▸ Speichern unter… verwenden.",
  },
  "draft/share": {
    what: "Erstellt einen Freigabelink zur Zeichnung – sie öffnet sich im Browser ohne Installation.",
    when: "Eine Zeichnung schnell an Kollegen, Kunden oder Lieferanten zur Ansicht weitergeben.",
    steps: ["Per Link teilen anklicken.", "Link kopieren und senden."],
  },
} satisfies Record<string, MicroTip>;
