/** Kurzanleitungen – Paket „edit“ (Registerkarten Werkzeuge, Ansicht, Daten, Schnellleiste an der Auswahl, Baugruppe – Einfügen, Normteile, Verschieben, Formen), Deutsch. Schlüssel und Liste: src/cad/help/tips-manifest.ts. */
import type { MicroTip } from "../tips";

export default {
  // ── Werkzeuge › Analyse ──
  "tools/measure": {
    what: "Misst Abstand, Winkel, Länge oder Radius zwischen Punkten, Kanten, Flächen und Körpern.",
    when: "Maß, Lochabstand, Wandstärke oder Flächenwinkel prüfen – ohne Zeichnung.",
    select: "Nichts vorab – die Objekte klicken Sie bei eingeschaltetem Messen (Filter im Bereich Messen).",
    steps: ["Messen einschalten, im Bereich den Filter wählen (Alle, Punkt, Kante, Fläche, Körper / Form).", "Erstes Objekt anklicken – zeigt Länge, Ø oder Fläche.", "Zweites anklicken – Abstand und Winkel; Neue Messung beginnt von vorn."],
    cmd: "messen F3 F7",
    note: "Beim Überfahren einer Kante werden Endpunkte, Kantenmitte und Kreismittelpunkt angeboten.",
  },
  inspect: {
    what: "Schaltet den Bereich mit Daten zum gewählten Objekt ein und aus: Typ, Länge, Ø, Fläche, Normale, Koordinaten.",
    when: "Schnell Bohrungs-Ø, Kantenlänge, Flächennormale oder Lage einer Komponente ablesen.",
    select: "Ein Objekt im Modell anklicken (Fläche, Kante, Punkt, Körper oder Komponente).",
    steps: ["Objekt anklicken – unten rechts erscheint ein Bereich mit seinen Daten.", "Die Schaltfläche Eigenschaften blendet ihn aus, ein weiterer Klick wieder ein."],
    cmd: "messen F3",
    note: "Der Bereich ist von Anfang an eingeschaltet – der erste Klick auf die Schaltfläche schaltet ihn aus.",
  },
  filter: {
    what: "Legt fest, was ein Klick im 3D-Fenster wählt: alles, Fläche, Kante, Punkt, Körper, in der Baugruppe Komponente.",
    when: "Wenn ein Klick ein anderes Objekt trifft als gewünscht – z. B. Kante statt Fläche.",
    steps: ["Menü Filter öffnen und die Objektart wählen.", "Im Modell klicken; Strg+Klick fügt ein weiteres Objekt hinzu oder entfernt es."],
    note: "Derselbe Filter ist auch in der Statusleiste unten und im Rechtsklickmenü auf leerer Stelle.",
  },
  "menu:filter/all": {
    what: "Auswahl ohne Einschränkung: Vorrang hat ein Punkt, dann eine Kante, sonst die Fläche unter dem Cursor.",
    when: "Normale Arbeit – gewählt wird genau das, worauf Sie zeigen.",
    steps: ["Alle wählen und ein Objekt im Modell anklicken."],
  },
  "menu:filter/feature": {
    what: "Filter Feature: ein Klick im 3D-Fenster wählt den ganzen Körper, genau wie Körper / Form.",
    when: "Features der Historie (Bohrung, Extrusion…) wählt man im Historienbaum links.",
    steps: ["Feature wählen.", "Ein Feature durch Klick im Historienbaum links öffnen."],
    note: "Ein Klick ins Modell wählt kein einzelnes Feature.",
  },
  "menu:filter/face": {
    what: "Ein Klick wählt nur Flächen des Modells.",
    when: "Vor Ziehen / Drücken, Formschräge, Schale, Skizze auf Fläche oder Flächenfarbe.",
    steps: ["Fläche wählen.", "Fläche anklicken; Strg+Klick fügt weitere hinzu."],
  },
  "menu:filter/edge": {
    what: "Ein Klick wählt nur Kanten des Modells.",
    when: "Vor Verrunden und Fasen, beim Messen einer Kantenlänge.",
    steps: ["Kante wählen.", "Kante anklicken; Strg+Klick fügt weitere hinzu."],
  },
  "menu:filter/vertex": {
    what: "Ein Klick wählt nur Eckpunkte (Ecken) des Körpers.",
    when: "Ebene durch drei Punkte, Messen von einer Ecke, Koordinaten eines Eckpunkts ablesen.",
    steps: ["Punkt wählen.", "Eine Ecke des Körpers anklicken; Strg+Klick fügt weitere hinzu."],
  },
  "menu:filter/body": {
    what: "Ein Klick wählt den ganzen Körper (in der Baugruppe den Körper der Komponente).",
    when: "Körper verschieben, ausblenden oder transparent schalten, ganzen Körper messen.",
    steps: ["Körper / Form wählen.", "Irgendwo auf den Körper klicken – im Bauteil erscheint die Schnellleiste des Körpers."],
  },
  "menu:filter/component": {
    what: "Wählt in der Baugruppe per Klick ein einzelnes Teil (Komponente).",
    when: "Verschieben, Verknüpfen, Eigenschaften oder Entfernen eines Teils der Baugruppe.",
    steps: ["Komponente wählen.", "Teil anklicken – rechts öffnet sich der Komponentenbereich; Strg+Klick fügt weitere hinzu."],
    note: "Nur in der Baugruppe.",
  },
  "menu:filter/subasm": {
    what: "Wählt in der Baugruppe per Klick die ganze Unterbaugruppe (Komponente der obersten Ebene).",
    when: "Eine ganze Gruppe von Teilen auf einmal verschieben, öffnen oder auflösen.",
    steps: ["Unterbaugruppe wählen.", "Ein beliebiges Teil der Unterbaugruppe anklicken – die ganze wird gewählt."],
    note: "Nur in der Baugruppe; ein Teil außerhalb einer Unterbaugruppe wird allein gewählt.",
  },
  mass: {
    what: "Zeigt Masse, Volumen, Oberfläche, Hüllquader sowie Anzahl der Flächen und Kanten des Teils.",
    when: "Masse für Angebot oder Stückliste, Volumen prüfen, Werkstoff wählen.",
    steps: ["Auf Masse klicken.", "Im Feld Werkstoff den Werkstoff (Dichte) wählen, ggf. Werkstoffbezeichnung (Schriftfeld).", "Masse, Volumen, Oberfläche und Abmessungen (X × Y × Z) ablesen."],
    cmd: "messen körper",
    note: "In der Baugruppe öffnet sich das Fenster nicht – die Baugruppenmasse steht im Infochip unten und in der Stückliste.",
  },
  section: {
    what: "Schneidet die Modellanzeige mit einer Ebene – nur Ansicht, die Geometrie ändert sich nicht.",
    when: "Innenformen prüfen: Bohrungen, Taschen, Wandstärken, Sitz der Teile in der Baugruppe.",
    steps: ["Schnitt einschalten – die Ebene geht durch die Modellmitte, senkrecht zu Y.", "Im Bereich Schnittansicht X / Y / Z, Fläche oder Vektor wählen.", "Position (mm) und Seite umdrehen setzen; mit der Schaltfläche Schnitt wieder aus."],
    cmd: "schnitt Z 10",
    note: "Dauerhaftes Abtrennen von Material macht Trennen auf der Registerkarte Erstellen.",
  },
  compare: {
    what: "Vergleicht das Teil mit einem Referenzmodell: Volumendifferenz, fehlende und überzählige Bereiche, Abweichungskarte.",
    when: "Prüfung eines nachgezeichneten oder geänderten Teils gegen das STEP des Kunden.",
    steps: ["Auf Referenz wählen… klicken und STEP, BREP, IGES oder Netz (STL…) wählen.", "Lage der Referenz: Wie vorhanden, Mitten oder Automatisch; Toleranz mm setzen.", "Auf Vergleichen klicken und die Differenzbereiche durchgehen."],
    note: "Nur im Bauteil. Eine Netzreferenz (STL, OBJ) hat begrenzte Genauigkeit.",
  },

  // ── Werkzeuge › Parametrisierung, Formen ──
  vars: {
    what: "Zeigt, wo die Variablen des Teils sind – benannte Maße, auf die sich Formularfelder beziehen.",
    when: "Parametrisches Teil: Ändern eines Maßes (d, t, L) berechnet das ganze Modell neu.",
    steps: ["Auf Variablen klicken und im linken Bereich die Registerkarte Variablen öffnen.", "+ Variable hinzufügen: Namen und Ausdruck (z. B. d*2) eintragen.", "Im Feld eines Features =d oder einen Ausdruck schreiben (z. B. =d/2+3)."],
    cmd: "variable d = 20",
    note: "Die Schaltfläche wechselt die Registerkarte nicht selbst, sie zeigt nur eine Meldung. Die Baugruppe hat keine Variablen.",
  },
  cfg: {
    what: "Zeigt, wo die Teilkonfigurationen sind – Varianten mit anderen Variablenwerten und unterdrückten Features.",
    when: "Ein Teil in mehreren Ausführungen: M8 / M10, mit und ohne Bohrungen, verschiedene Längen.",
    steps: ["Auf Teilkonfigurationen klicken und links die Registerkarte Konfigurationen öffnen.", "+ Neue Konfiguration aus aktuellen Werten, aufklappen, Werte und Unterdrückte Features ändern.", "Mit dem Optionsfeld aktivieren; Standard stellt die ursprünglichen Werte her."],
    cmd: 'konfiguration "Kurz" t=10',
    note: "Konfigurationen ändern Variablen – diese zuerst anlegen. Die Baugruppe hat keine Konfigurationen.",
  },
  moldtools: {
    what: "Öffnet den Bereich für den Formenbau: Entformungsschrägen und Hinterschnitte, Flächenanalyse, Schwindung, Auswerfer, Kühlung.",
    when: "Kunststoff- oder Gussteil für die Form vorbereiten – Entformbarkeit prüfen und Form entwerfen.",
    steps: ["Entformungsschrägen: Farbkarte einschalten, Entformungsrichtung und Min. Schräge setzen.", "Schwindung: Werkstoff oder Wert wählen und auf Schwindung anwenden klicken.", "Auswerfer: Bohrungen in das Teil / Auswerfer in die Baugruppe; Kühlung: In das Teil bohren."],
    cmd: "analyse formschräge richtung +Z min 1 anzeigen",
    note: "Nur im Bauteil mit Körper. Die Schwindung wird als Maßstab in die Historie eingefügt.",
  },

  // ── Ansicht › Ansichten ──
  iso: {
    what: "Dreht die Ansicht isometrisch (schräg von oben) und passt das Modell ins Fenster ein.",
    when: "Überblick über das Modell, Bild fürs Angebot, Rückkehr nach Arbeit in einer anderen Ansicht.",
    steps: ["Auf Isometrie klicken – die Kamera dreht sich und das Modell passt ins Fenster."],
    cmd: "ansicht iso",
  },
  front: {
    what: "Ansicht von vorne (von −Y) auf die XZ-Ebene – Vorderansicht; das Modell passt ins Fenster.",
    when: "Profil, Höhen und Absätze prüfen wie in der Vorderansicht einer Zeichnung.",
    steps: ["Auf Vorne klicken."],
    cmd: "ansicht vorne",
    note: "Ohne perspektivische Verzerrung: Kamera › Orthogonal einschalten.",
  },
  top: {
    what: "Ansicht von oben (von +Z) auf die XY-Ebene – Draufsicht; das Modell passt ins Fenster.",
    when: "Lage von Bohrungen, Taschen und Plattenkontur wie in der Draufsicht.",
    steps: ["Auf Oben klicken."],
    cmd: "ansicht oben",
    note: "Ohne perspektivische Verzerrung: Kamera › Orthogonal einschalten.",
  },
  right: {
    what: "Ansicht von rechts (von +X) auf die YZ-Ebene – Seitenansicht; das Modell passt ins Fenster.",
    when: "Seite des Teils, Querbohrungen und Nuten prüfen.",
    steps: ["Auf Rechts klicken."],
    cmd: "ansicht rechts",
    note: "Ohne perspektivische Verzerrung: Kamera › Orthogonal einschalten.",
  },
  back: {
    what: "Ansicht von hinten (von +Y), gegenüber der Ansicht Vorne.",
    when: "Rückseite des Teils prüfen, die man von vorne nicht sieht.",
    steps: ["Auf Hinten klicken."],
    cmd: "ansicht hinten",
  },
  bottom: {
    what: "Ansicht von unten (von −Z), gegenüber der Ansicht Oben.",
    when: "Unterseite prüfen: Bohrungen von unten, Fasen, Auflageflächen.",
    steps: ["Auf Unten klicken."],
    cmd: "ansicht unten",
  },
  left: {
    what: "Ansicht von links (von −X), gegenüber der Ansicht Rechts.",
    when: "Linke Seite des Teils prüfen.",
    steps: ["Auf Links klicken."],
    cmd: "ansicht links",
  },

  // ── Ansicht › Darstellungsstil ──
  shadedEdges: {
    what: "Schattierte Flächen mit gezeichneten Kanten – Standardstil zum Modellieren.",
    when: "Normale Arbeit: Form und Kanten zum Wählen sind gut sichtbar.",
    steps: ["Auf Schattiert mit Kanten klicken – der Stil wechselt sofort."],
    cmd: "ansicht kanten",
    note: "Der gewählte Stil bleibt auch nach dem Schließen des Programms erhalten.",
  },
  shaded: {
    what: "Nur schattierte Flächen, ohne Kantenlinien.",
    when: "Präsentation, Bildschirmfoto, Beurteilung von Form und Glätte der Flächen.",
    steps: ["Auf Schattiert klicken."],
    cmd: "ansicht schattiert",
  },
  wireframe: {
    what: "Nur Modellkanten ohne Flächen – auch die Kanten auf der Rückseite sind sichtbar.",
    when: "Innere Bohrungen und Kanäle suchen, Orientierung in komplexer Form.",
    steps: ["Auf Drahtmodell klicken; zurück z. B. mit Schattiert mit Kanten."],
    cmd: "ansicht drahtmodell",
  },
  hiddenLine: {
    what: "Weiße Flächen mit Kanten, verdeckte Kanten werden nicht gezeichnet – wirkt wie eine Zeichnung.",
    when: "Konturen wie in der Zeichnung prüfen, sauberes Bild zum Drucken.",
    steps: ["Auf Verdeckte Kanten klicken."],
    cmd: "ansicht verdeckt",
  },
  xray: {
    what: "Transparente Flächen mit Kanten – Blick ins Innere von Körper und Baugruppe.",
    when: "Innere Kanäle, Bohrungen und Einsätze; in der Baugruppe innen verborgene Teile.",
    steps: ["Auf Transparent klicken; zurück mit Schattiert mit Kanten."],
    cmd: "ansicht röntgen",
  },

  // ── Ansicht › Kamera ──
  fit: {
    what: "Zoomt und zentriert das ganze Modell im Fenster; die Blickrichtung bleibt.",
    when: "Das Modell ist aus dem Bild gelaufen oder nach dem Import zu klein oder zu groß.",
    steps: ["Auf Einpassen klicken."],
    cmd: "ansicht einpassen",
  },
  persp: {
    what: "Perspektivische Projektion – entferntere Teile werden kleiner, wie in Wirklichkeit.",
    when: "Natürliches Aussehen des Modells, Präsentation, Rundgang durch die Baugruppe.",
    steps: ["Auf Perspektive klicken – die Wahl wird in den Einstellungen gespeichert."],
    note: "Parallele Kanten laufen zusammen – zur Formprüfung Orthogonal verwenden.",
  },
  ortho: {
    what: "Orthogonale (parallele) Projektion ohne Verzerrung – parallele Kanten bleiben parallel.",
    when: "Prüfen in den Ansichten Vorne, Oben, Rechts wie in der Zeichnung; Kanten ausrichten.",
    steps: ["Auf Orthogonal klicken; das Tastenkürzel schaltet zwischen beiden Projektionen um."],
    note: "Die Wahl wird gespeichert und gilt auch nach dem nächsten Start.",
  },
  "view/grid": {
    what: "Blendet Raster und Koordinatenachsen im 3D-Fenster ein oder aus.",
    when: "Orientierung im Raum, Lage des Teils zum Ursprung prüfen.",
    steps: ["Auf Raster und Achsen klicken; ein weiterer Klick blendet sie aus."],
    note: "Gilt nur bis zum Schließen des Programms – nach dem Start ist das Raster aus.",
  },

  // ── Ansicht › Darstellung ──
  color: {
    what: "Setzt die Körperfarbe des Teils – Stahl, Aluminium, Messing, Gusseisen oder Signalfarben.",
    when: "Teile am Bildschirm und auf Bildern unterscheiden; die Farbe wird mit dem Teil gespeichert.",
    steps: ["Menü Körperfarbe öffnen.", "Farbe anklicken – der Körper wird sofort umgefärbt (Strg+Z macht rückgängig)."],
    cmd: "farbe #b9c2cc",
    note: "Die Farbe ändert weder Werkstoff noch Masse. In der Baugruppe hat jede Komponente ihre Farbe (Komponentenbereich).",
  },
  "menu:color/*": {
    what: "Färbt den Körper des Teils in dieser Farbe.",
    when: "Teil oder Werkstoff am Bildschirm schnell unterscheiden.",
    steps: ["Farbe anklicken – die Änderung wird im Teil gespeichert, Strg+Z macht sie rückgängig."],
    cmd: "farbe #b9c2cc",
    note: "Nur Aussehen – der Werkstoff für die Masse wird getrennt gewählt (Masse, linker Bereich).",
  },
  bg: {
    what: "Ändert den Hintergrund des 3D-Fensters: blaugrauer Verlauf, hell, graphit oder weiß.",
    when: "Besserer Kontrast beim Arbeiten, weißer Hintergrund für Bilder und Druck.",
    steps: ["Menü Hintergrund öffnen und eine Variante anklicken."],
    note: "Die Wahl wird in den Programmeinstellungen gespeichert (Einstellungen › Ansicht).",
  },
  "menu:bg/*": {
    what: "Setzt diesen Hintergrund des 3D-Fensters.",
    when: "Graphit für dunkle Umgebung, Weiß (Druck) für Bilder in der Dokumentation.",
    steps: ["Variante anklicken – der Hintergrund ändert sich sofort und bleibt gespeichert."],
  },
  mouse: {
    what: "Stellt die Maussteuerung der Ansicht auf das gewohnte CAD um – ZW3D, SolidWorks oder Touchpad.",
    when: "Gleich zu Beginn, damit Drehen und Verschieben wie in Ihrem CAD funktionieren.",
    steps: ["Menü Mausbedienung öffnen und ein Schema wählen."],
    note: "Das Rad zoomt immer; weitere Optionen unter Einstellungen › Maus und Bedienung.",
  },
  "menu:mouse/zw3d": {
    what: "Schema ZW3D: rechte Taste dreht, mittlere verschiebt, Rad zoomt.",
    when: "Sie sind ZW3D gewohnt; ein Rechtsklick ohne Ziehen öffnet das Menü.",
    steps: ["ZW3D wählen – gilt sofort und bleibt gespeichert."],
  },
  "menu:mouse/solidworks": {
    what: "Schema SolidWorks / Inventor: mittlere Taste dreht, Strg+mittlere verschiebt.",
    when: "Sie sind SolidWorks oder Inventor gewohnt.",
    steps: ["SolidWorks wählen – gilt sofort und bleibt gespeichert."],
  },
  "menu:mouse/simple": {
    what: "Schema Touchpad: linke Taste dreht, rechte verschiebt, Rad zoomt.",
    when: "Notebook ohne Maus mit mittlerer Taste.",
    steps: ["Touchpad wählen – gilt sofort und bleibt gespeichert."],
  },

  // ── Daten › Programm ──
  settings: {
    what: "Öffnet die Programmeinstellungen: Sprache, Einheiten, Ansicht, Maus, Skizze, Zeichnung, Dateien, Tastenkürzel.",
    when: "Programm anpassen – Standardwerkstoff, Darstellungsstil, Tastenkürzel, Speichern ohne Dialog.",
    steps: ["Links einen Bereich wählen (Allgemein, Ansicht, Maus und Bedienung…).", "Optionen ändern; Standard wiederherstellen setzt alles zurück, Export / Import speichert als JSON.", "Mit OK bestätigen."],
    note: "Diese Kurzanleitungen schalten Sie unter Allgemein aus (Kurzanleitungen an Symbolen).",
  },
  palette: {
    what: "Öffnet die Suche über alle Befehle – Teil des Namens tippen und mit Enter ausführen.",
    when: "Wenn Sie nicht wissen, auf welcher Registerkarte ein Befehl ist, oder ohne Maus arbeiten wollen.",
    steps: ["Z. B. Bohrung, Zeichnung oder Verrunden tippen.", "Befehl mit den Pfeiltasten wählen und Enter drücken; Esc schließt die Palette."],
  },
  start: {
    what: "Zeigt den Startbildschirm: neues Teil, Baugruppe, Zeichnung, Datei öffnen, Beispiele.",
    when: "Beginn neuer Arbeit oder schnelles Öffnen eines Beispielmodells.",
    steps: ["Eine Aktion unter Starten oder ein Modell unter Beispielmodelle wählen.", "Weiterarbeiten schließt den Bildschirm."],
    note: "Die Anzeige beim Start schalten Sie unter Einstellungen › Allgemein aus.",
  },

  // ── Daten › Datei ──
  open: {
    what: "Öffnet ein .mncad-Projekt oder importiert STEP, IGES, BREP, STL, OBJ, 3MF, glTF, PLY oder DXF.",
    when: "Modell vom Kunden, laufendes Projekt, DXF-Zeichnung als Skizzenunterlage.",
    steps: ["Auf Öffnen / Import klicken und eine oder mehrere Dateien wählen.", "Jedes Modell öffnet sich in einem eigenen Tab; DXF wird als Skizze geladen."],
    note: "In der Baugruppe wird ein Teil oder Modell als Komponente eingefügt. Dateien lassen sich auch ins Fenster ziehen.",
  },
  save: {
    what: "Speichert das ganze Projekt (.mncad) mit Feature-Historie, Skizzen und Importdaten.",
    when: "Regelmäßiges Speichern der Arbeit; die Datei später über Öffnen / Import öffnen.",
    steps: ["Beim ersten Mal Ort und Dateinamen wählen.", "Weitere Speicherungen schreiben ohne Rückfrage in dieselbe Datei."],
    note: "Ohne Dialog (direkt in Downloads): Einstellungen › Dateien, Frage nach Ort und Namen ausschalten.",
  },
  saveAs: {
    what: "Speichert das Projekt unter neuem Namen oder an anderem Ort (.mncad).",
    when: "Teilevariante, Sicherung vor großer Änderung, Kopie für den Kunden.",
    steps: ["Ort und Dateinamen wählen und bestätigen.", "Danach speichert Projekt speichern in diese neue Datei."],
  },

  // ── Daten › 3D-Export ──
  export: {
    what: "Exportiert das Modell nach STEP, BREP, STL, 3MF, OBJ, glTF oder VRML.",
    when: "Weitergabe des Modells an ein anderes CAD, an CAM, zum 3D-Druck oder zur Visualisierung.",
    steps: ["Menü Export öffnen und das Format wählen.", "Ort und Dateinamen wählen – erst dann wird der Export berechnet."],
    note: "Für andere CAD und CAM STEP verwenden. Features mit Warnung in der Historie verlangsamen oder verderben den Export.",
  },
  "menu:export/step": {
    what: "Speichert die exakte Geometrie als STEP AP214 – Standard für den Austausch zwischen CAD-Systemen.",
    when: "Weitergabe an ZW3D, SolidWorks, Inventor, CATIA, Creo oder CAM zur Bearbeitung.",
    steps: ["Auf STEP AP214 klicken, Ort und Namen wählen; auf die Meldung Export fertig warten."],
    note: "Ungültige Geometrie (Feature mit Warnung in der Historie) kann den STEP-Export verlangsamen oder verderben.",
  },
  "menu:export/brep": {
    what: "Speichert die exakte Geometrie im nativen Format des OpenCascade-Kerns (.brep).",
    when: "Austausch mit Programmen auf OpenCascade-Basis (z. B. FreeCAD), Archiv der exakten Form.",
    steps: ["Auf OpenCascade BREP klicken, Ort und Dateinamen wählen."],
  },
  "menu:export/stl": {
    what: "Speichert das Modell als STL-Dreiecksnetz (ohne Einheiten und Farben).",
    when: "3D-Druck, schnelle Vorschau in Netzbetrachtern.",
    steps: ["Auf STL klicken, Ort und Dateinamen wählen."],
    note: "Ein Netz lässt sich nicht mehr exakt bearbeiten – an andere CAD STEP senden.",
  },
  "menu:export/3mf": {
    what: "Speichert das Netz im Format 3MF – mit Einheiten (mm), geeignet für den 3D-Druck.",
    when: "Moderne Slicer für den 3D-Druck (PrusaSlicer, Cura, Bambu Studio).",
    steps: ["Auf 3MF klicken, Ort und Dateinamen wählen."],
  },
  "menu:export/obj": {
    what: "Speichert das Netz als Wavefront OBJ.",
    when: "Visualisierungs- und Renderprogramme.",
    steps: ["Auf Wavefront OBJ klicken, Ort und Dateinamen wählen."],
  },
  "menu:export/glb": {
    what: "Speichert das Modell als binäres glTF (.glb) – leichtes Format für Web, AR und Präsentationen.",
    when: "Modellvorschau im Web, auf dem Handy oder in einer Präsentation.",
    steps: ["Auf glTF binär klicken, Ort und Dateinamen wählen."],
  },
  "menu:export/wrl": {
    what: "Speichert das Netz im Format VRML (.wrl).",
    when: "Ältere Betrachter und Programme, die neuere Formate nicht lesen.",
    steps: ["Auf VRML klicken, Ort und Dateinamen wählen."],
  },

  // ── Daten › Baugruppe, Beispiele ──
  asm: {
    what: "Legt eine Baugruppe an: leer, aus dem aktuellen Teil oder als Spritzgieß-Formaufbau.",
    when: "Wenn Sie aus Teilen ein Ganzes bauen – Vorrichtung, Form, Werkzeug.",
    steps: ["Menü Baugruppe öffnen und eine Variante wählen."],
    cmd: "neue baugruppe",
  },
  "menu:asm/na": {
    what: "Öffnet eine neue leere Baugruppe in einem neuen Tab.",
    when: "Beginn einer Baugruppe, in die Sie Teile, Normteile und Verknüpfungen einfügen.",
    steps: ["Auf Neue leere Baugruppe klicken.", "Auf der Registerkarte Baugruppe Teile einfügen (Teil / Modell einfügen, Normteilbibliothek)."],
    cmd: "neue baugruppe Form",
  },
  "menu:asm/nc": {
    what: "Öffnet eine neue Baugruppe in einem neuen Tab mit dem aktuellen Teil als fixierter Komponente.",
    when: "Ein Teil, zu dem Sie Schrauben, ein Gegenstück oder eine Vorrichtung hinzufügen wollen.",
    steps: ["Auf Baugruppe aus dem aktuellen Teil klicken.", "Auf der Registerkarte Baugruppe weitere Teile und Verknüpfungen hinzufügen."],
    note: "Das Teil wird als Kopie eingefügt – weiter in der Baugruppe über Teil bearbeiten (im Kontext) ändern.",
  },
  "menu:asm/mold": {
    what: "Öffnet den Assistenten für den Spritzgieß-Formaufbau: Platten, Zwischenleisten, Auswerferpaket, Säulen mit Buchsen.",
    when: "Schneller Entwurf eines Formaufbaus um einen Formeinsatz.",
    steps: ["Breite X, Länge Y, Plattendicken und Ø Führungssäulen eingeben.", "Optional Kavität in Platte A und Plattenwerkstoff.", "Auf Formaufbau erzeugen klicken."],
    cmd: "formaufbau 246 296",
    note: "Der Formaufbau ersetzt den Inhalt des aktuellen Tabs (Strg+Z macht rückgängig) – zuerst einen leeren öffnen.",
  },
  ex: {
    what: "Öffnet ein Beispielteil in einem neuen Tab – Flansch, Welle, Winkel, Griff, Bolzen, Übergangsstück.",
    when: "Programm kennenlernen, Beispielvorgehen (Austragung, Gewinde, Konfigurationen, Loft).",
    steps: ["Menü Beispielteile öffnen und ein Beispiel anklicken.", "Historie links ansehen – Features lassen sich öffnen und ändern."],
  },
  "menu:ex/*": {
    what: "Öffnet dieses Beispielteil in einem neuen Tab, mit der ganzen Feature-Historie.",
    when: "Beispiel, wie das Teil aufgebaut ist; Ausgangspunkt für eigene Änderungen.",
    steps: ["Beispiel anklicken – es öffnet sich in einem neuen Tab.", "Ein Feature in der Historie links anklicken, um seine Parameter zu öffnen."],
    note: "Ihr laufendes Dokument bleibt in seinem ursprünglichen Tab.",
  },

  // ── Schnellleiste an der Auswahl (Bauteil) ──
  "quick/sk": {
    what: "Legt eine neue Skizze direkt auf der angeklickten ebenen Fläche an.",
    when: "Tasche, Zapfen oder Bohrungen auf einer Fläche eines fertigen Körpers.",
    select: "Eine ebene Fläche – die Leiste erscheint nach Klick auf eine Fläche im Bauteil.",
    steps: ["Ebene Fläche anklicken.", "In der Leiste Neue Skizze auf Fläche wählen, Kontur zeichnen, Skizze beenden."],
    cmd: "skizze fläche oben: kreis 20",
    note: "Auf einer gekrümmten Fläche lässt sich keine Skizze anlegen.",
  },
  "quick/pp": {
    what: "Öffnet Ziehen / Drücken mit der angeklickten Fläche – verschiebt sie entlang ihrer Normale.",
    when: "Schnelle Maßänderung ohne Historie: verlängern, dünner machen, Wand angleichen.",
    select: "Eine ebene Fläche – die Leiste erscheint nach Klick darauf; weitere im Formular hinzufügen.",
    steps: ["Fläche anklicken und in der Leiste Ziehen / Drücken wählen.", "Endbedingung: Blind (+ außen, − innen), Bis Eckpunkt oder Bis Fläche.", "Mit OK bestätigen."],
    cmd: "element pushPull distance=5 faces=oben",
  },
  "quick/of": {
    what: "Öffnet Fläche versetzen mit der angeklickten Fläche – auch gekrümmt oder zylindrisch.",
    when: "Bearbeitungszugabe, Bohrung vergrößern oder verkleinern, Passung anpassen.",
    select: "Eine Fläche – die Leiste erscheint nach Klick darauf; weitere im Formular hinzufügen.",
    steps: ["Fläche anklicken und in der Leiste Fläche versetzen wählen.", "Versatz eingeben (+ außen, − innen).", "Mit OK bestätigen."],
    cmd: "element offsetFace distance=0,5 faces=zylindrisch",
    note: "Eine Bohrungswand um +0,5 mm versetzt macht die Bohrung kleiner.",
  },
  "quick/df": {
    what: "Öffnet Fläche entfernen mit der angeklickten Fläche – der Körper wird geheilt.",
    when: "Bohrung, Verrundung oder Zapfen aus einem importierten Modell ohne Historie entfernen.",
    select: "Eine Fläche – die Leiste erscheint nach Klick darauf; weitere im Formular hinzufügen.",
    steps: ["Fläche anklicken (z. B. Bohrungswand) und Fläche entfernen wählen.", "Flächenliste prüfen und mit OK bestätigen."],
    cmd: "element deleteFace faces=zylindrisch",
    note: "Geheilt wird nur, was die Nachbarflächen schließen können – sonst meldet das Element einen Fehler.",
  },
  "quick/fi": {
    what: "Öffnet Verrunden mit der angeklickten Kante.",
    when: "Schnelles Verrunden einer Kante, ohne die Schaltfläche im Menüband zu suchen.",
    select: "Eine Körperkante – die Leiste erscheint nach Klick auf eine Kante im Bauteil.",
    steps: ["Kante anklicken und in der Leiste Kante verrunden wählen.", "Radius eingeben; weitere Kanten per Klick im Modell hinzufügen.", "Mit OK bestätigen."],
    cmd: "verrunden 2 kanten senkrecht",
  },
  "quick/ch": {
    what: "Öffnet Fasen mit der angeklickten Kante.",
    when: "Schnelles Fasen einer Kante für Montage oder Entgraten.",
    select: "Eine Körperkante – die Leiste erscheint nach Klick auf eine Kante im Bauteil.",
    steps: ["Kante anklicken und in der Leiste Kante fasen wählen.", "Fasenart wählen und Größe eingeben; weitere Kanten per Klick hinzufügen.", "Mit OK bestätigen."],
    cmd: "fase 1 kanten oben",
  },
  "quick/meas": {
    what: "Startet das Messen mit dem angeklickten Objekt als erstem – nur noch das zweite anklicken.",
    when: "Kantenlänge, Abstand von einem Eckpunkt, Körpermaße mit einem Klick.",
    select: "Eine Kante, einen Eckpunkt oder Körper – die Leiste erscheint nach Klick im Bauteil.",
    steps: ["Objekt anklicken und in der Leiste Messen wählen.", "Zweites Objekt anklicken – der Bereich Messen zeigt Abstand und Winkel."],
    cmd: "messen E5 F3",
    note: "Das Messen beenden Sie mit der Taste Esc oder dem Kreuz des Bereichs.",
  },
  "quick/props": {
    what: "Öffnet den Bereich Eigenschaften mit Daten zum angeklickten Objekt.",
    when: "Typ und Länge einer Kante, Ø eines Bogens, Koordinaten eines Eckpunkts.",
    select: "Eine Kante oder einen Eckpunkt (bei Fläche und Körper ist die Option unter ⋯).",
    steps: ["Kante oder Eckpunkt anklicken und in der Leiste Eigenschaften wählen."],
    cmd: "messen E5",
  },
  "quick/co": {
    what: "Zeigt die Koordinaten X ; Y ; Z des angeklickten Eckpunkts direkt auf der Schaltfläche.",
    when: "Schnelles Ablesen der Lage einer Ecke für Bohrung, Skizze oder Maß.",
    select: "Einen Eckpunkt (Filter Alle oder Punkt) – die Leiste erscheint nach Klick darauf.",
    steps: ["Eckpunkt anklicken und die Koordinaten auf der Schaltfläche ablesen.", "Klick auf die Schaltfläche aktualisiert die Daten im Bereich Eigenschaften."],
    cmd: "messen V2",
    note: "Die Werte auf der Schaltfläche sind auf 2 Dezimalstellen gerundet.",
  },
  "quick/mv": {
    what: "Fügt ein Element Verschieben / drehen hinzu und zeigt ein Gizmo zum Verschieben und Drehen des ganzen Körpers.",
    when: "Importiertes Modell ausrichten, Teil in die Bearbeitungslage drehen.",
    select: "Den Körper (Filter Körper / Form) – die Leiste erscheint nach Klick darauf.",
    steps: ["Körper anklicken und in der Leiste Verschieben / drehen (Gizmo) wählen.", "Pfeile (Schritt 1 mm) oder Bögen (15°) ziehen; R schaltet um.", "Auf Fertig klicken."],
    cmd: "element transform translate=10;0;0",
    note: "Ist das letzte Element der Historie schon Verschieben / drehen, wird dieses bearbeitet.",
  },
  "quick/hd": {
    what: "Blendet den ganzen Körper des Teils aus oder wieder ein – nur Anzeige, das Modell ändert sich nicht.",
    when: "Blick auf Skizzen, Hilfsebenen und Achsen, die im Körper verborgen sind.",
    select: "Den Körper (Filter Körper / Form).",
    steps: ["Körper anklicken und in der Leiste Körper ausblenden wählen."],
    note: "Ein ausgeblendeter Körper lässt sich nicht anklicken, diese Leiste blendet ihn also nicht wieder ein.",
  },
  "quick/tr": {
    what: "Schaltet den Körper halbtransparent und zurück auf undurchsichtig – nur Anzeige.",
    when: "Blick auf innere Bohrungen und Kanäle, ohne den Darstellungsstil zu ändern.",
    select: "Den Körper (Filter Körper / Form).",
    steps: ["Körper anklicken und in der Leiste Transparent wählen; zurück mit Undurchsichtig."],
    note: "Für das ganze Modell auf einmal gibt es den Stil Transparent auf der Registerkarte Ansicht.",
  },

  // ── Baugruppe › Einfügen ──
  ins: {
    what: "Fügt ein .mncad-Teil oder ein STEP-, IGES-, STL-Modell… aus einer Datei als Komponente in die Baugruppe ein.",
    when: "Montage aus fertigen Teilen, Zukaufteile vom Lieferanten als STEP.",
    steps: ["Auf Teil / Modell einfügen klicken und eine Datei wählen.", "Komponente mit Verschieben / drehen oder mit Verknüpfungen platzieren."],
    cmd: 'einfügen "Platte" bei 100 0 0',
    note: "Eine Baugruppendatei (.mncad) wird nicht eingefügt, sondern in einem neuen Tab geöffnet.",
  },
  "asm/library": {
    what: "Öffnet die Normteilbibliothek – Schrauben, Muttern, Lager, Stifte, Zahnräder, Profile, Formennormalien.",
    when: "Normteile in die Baugruppe, ohne sie zu zeichnen.",
    steps: ["Bezeichnung eingeben (z. B. M8x30, Lager 6205, Z40 6x160) oder Kategorie wählen.", "Maße prüfen und auf In Baugruppe einfügen klicken."],
    cmd: "normteil M8x30",
    note: "Als neues Teil öffnen öffnet es in einem neuen Tab, statt es einzufügen.",
  },
  newpart: {
    what: "Fügt der Baugruppe ein neues leeres Teil hinzu und öffnet es sofort zum Modellieren im Baugruppenkontext.",
    when: "Ein Teil, das nach den umgebenden Teilen konstruiert wird – Platte, Einsatz, Vorrichtung.",
    steps: ["Auf Neues Teil klicken – die Registerkarte Erstellen öffnet sich mit der Leiste Teil wird bearbeitet.", "Das Teil modellieren (Skizze, Extrusion…).", "Auf ← Zurück zur Baugruppe klicken."],
  },

  // ── Baugruppe › Normteile ──
  screw: {
    what: "Fügt eine Zylinderschraube mit Innensechskant ISO 4762, M6–M16, Länge 20, 40 oder 60 mm, in die Baugruppe ein.",
    when: "Schraubverbindungen von Formplatten, Vorrichtungen oder Werkzeugen.",
    steps: ["Menü Schraube ISO 4762 öffnen und die Größe wählen.", "Schraube mit Verschieben / drehen oder einer Verknüpfung Zentrieren in die Bohrung setzen."],
    cmd: "normteil M8x40",
    note: "Die Schraube ist vereinfacht, ohne Gewinde. Andere Größen gibt es in der Normteilbibliothek.",
  },
  "menu:screw/*": {
    what: "Fügt eine Schraube ISO 4762 dieser Größe (Gewinde × Länge in mm) als Komponente ein.",
    when: "Schnelles Einfügen einer üblichen Schraube, ohne die Bibliothek zu öffnen.",
    steps: ["Größe anklicken – die Schraube wird neben dem Modell eingefügt (in leerer Baugruppe im Ursprung)."],
    cmd: "normteil M8x40",
    note: "Der Kopf liegt auf der XY-Ebene, der Schaft zeigt nach −Z.",
  },
  pillar: {
    what: "Fügt eine Führungssäule mit Bund Ø16–Ø40 ein, Länge 5 × Ø.",
    when: "Führung der Platten einer Form oder eines Schneidwerkzeugs.",
    steps: ["Menü Führungssäule öffnen und Ø × Länge wählen.", "Mit Verschieben / drehen oder einer Verknüpfung Zentrieren in die Bohrung setzen."],
    cmd: "normteil Z00 20x100",
    note: "Sie kommt in die Gruppe Führungen; das Gegenstück ist die Führungsbuchse gleichen Ø.",
  },
  "menu:pillar/*": {
    what: "Fügt eine Führungssäule dieser Größe (Ø × Länge) in die Gruppe Führungen ein.",
    when: "Schnelles Einfügen einer Säule, ohne die Bibliothek zu öffnen.",
    steps: ["Größe anklicken – die Säule wird als Komponente eingefügt."],
    cmd: "normteil Z00 20x100",
  },
  bush: {
    what: "Fügt eine Führungsbuchse mit Bund für eine Säule Ø16–Ø40 ein, Länge 2 × Ø.",
    when: "Gegenstück der Führungssäule in der anderen Formplatte.",
    steps: ["Menü Führungsbuchse öffnen und Ø × Länge wählen.", "Koaxial zur Säule setzen (Verschieben / drehen oder Verknüpfung Zentrieren)."],
    cmd: "normteil Z10 20x40",
    note: "Sie kommt in die Gruppe Führungen.",
  },
  "menu:bush/*": {
    what: "Fügt eine Führungsbuchse dieser Größe (Ø × Länge) in die Gruppe Führungen ein.",
    when: "Schnelles Einfügen einer Buchse, ohne die Bibliothek zu öffnen.",
    steps: ["Größe anklicken – die Buchse wird als Komponente eingefügt."],
    cmd: "normteil Z10 20x40",
  },
  pin: {
    what: "Fügt einen Auswerfer mit Zylinderkopf Ø3–Ø10 ein, Schaftlänge 150 mm.",
    when: "Auswerfen des Formteils; Lagen schlagen die Formenbau-Werkzeuge im Bauteil vor.",
    steps: ["Menü Auswerfer öffnen und den Durchmesser wählen.", "Mit Verschieben / drehen oder einer Verknüpfung Zentrieren platzieren."],
    cmd: "normteil Z40 6x150",
    note: "Er kommt in die Gruppe Auswerfen.",
  },
  "menu:pin/*": {
    what: "Fügt einen Auswerfer dieses Durchmessers, Schaftlänge 150 mm, in die Gruppe Auswerfen ein.",
    when: "Schnelles Einfügen eines Auswerfers, ohne die Bibliothek zu öffnen.",
    steps: ["Größe anklicken – der Auswerfer wird als Komponente eingefügt."],
    cmd: "normteil Z40 6x150",
  },
  ring: {
    what: "Fügt einen Zentrierring Ø100 × 10 mm (innen Ø36) als Komponente ein.",
    when: "Zentrieren der Form auf der Aufspannplatte der Spritzgießmaschine.",
    steps: ["Auf Zentrierring klicken – er wird als Komponente eingefügt.", "Auf die Aufspannplatte setzen (Verschieben / drehen oder Verknüpfung Kontakt)."],
    cmd: "normteil K100",
    note: "Andere Durchmesser (90–160 mm) gibt es in der Normteilbibliothek.",
  },

  // ── Baugruppe › Verschieben ──
  gz: {
    what: "Verschiebt oder dreht die gewählte Komponente mit dem Gizmo; Verknüpfungen werden danach neu berechnet.",
    when: "Grobe Platzierung eines Teils vor dem Verknüpfen, Teil aus einer Kollision schieben.",
    select: "Eine Komponente im Baugruppenbaum oder im Modell.",
    steps: ["Komponente wählen und auf Verschieben / drehen klicken.", "Pfeile (Schritt 1 mm) oder Bögen (15°) ziehen; R schaltet um.", "Auf Fertig klicken."],
    cmd: 'baugruppe komponente "Stift" verschieben 10 0 0',
    note: "Eine fixierte Komponente muss zuerst gelöst werden.",
  },
  "asm/delete": {
    what: "Entfernt die gewählten Komponenten aus der Baugruppe.",
    when: "Baugruppe aufräumen, ein Teil gegen eine andere Variante tauschen.",
    select: "Komponenten im Modell (Filter Komponente, Strg+Klick) oder eine Komponente im Baum.",
    steps: ["Komponenten wählen.", "Auf Entfernen klicken und die Rückfrage bestätigen."],
    cmd: 'baugruppe entfernen "Stift"',
    note: "Strg+Z macht das Entfernen rückgängig; die Rückfrage schalten Sie unter Einstellungen › Allgemein ab.",
  },
  sub: {
    what: "Fasst Komponenten zu einer Unterbaugruppe zusammen, löst sie auf oder öffnet sie zum Bearbeiten.",
    when: "Eine Einheit, die sich als Ganzes bewegt oder wiederholt – Führung, Auswerferpaket.",
    steps: ["Menü Unterbaugruppe öffnen.", "Aus Auswahl erzeugen, Ausgewählte auflösen oder Ausgewählte öffnen wählen."],
    cmd: 'baugruppe unterbaugruppe "A" "B" als "Führung"',
  },
  "menu:sub/mk": {
    what: "Erzeugt aus den im Modell gewählten Komponenten eine neue Unterbaugruppe (Unterbaugruppe 1, 2…).",
    when: "Teile einer Einheit gruppieren, damit sie sich als Ganzes bewegen.",
    select: "Komponenten per Klick im Modell (Filter Komponente, Strg+Klick).",
    steps: ["Komponenten im 3D-Fenster mit Strg+Klick wählen.", "Aus Auswahl erzeugen (Strg+Klick) wählen."],
    cmd: 'baugruppe unterbaugruppe "A" "B"',
    note: "Es zählt nur die Auswahl im 3D-Fenster – eine nur im Baum gewählte Komponente nicht.",
  },
  "menu:sub/dis": {
    what: "Löst die gewählte Unterbaugruppe auf – ihre Komponenten kehren direkt in die Baugruppe zurück.",
    when: "Gruppierung aufheben, ein Teil aus der Unterbaugruppe herausnehmen.",
    select: "Eine Unterbaugruppe (Filter Unterbaugruppe oder im Baum).",
    steps: ["Unterbaugruppe wählen.", "Ausgewählte auflösen wählen."],
    cmd: 'baugruppe auflösen "Führung"',
  },
  "menu:sub/open": {
    what: "Öffnet die gewählte Unterbaugruppe zum Bearbeiten im selben Tab (Leiste Unterbaugruppe wird bearbeitet).",
    when: "Teile innerhalb einer Unterbaugruppe hinzufügen, verschieben oder verknüpfen.",
    select: "Eine Unterbaugruppe (Filter Unterbaugruppe oder im Baum).",
    steps: ["Unterbaugruppe wählen und Ausgewählte öffnen wählen.", "Komponenten bearbeiten und auf ← Zurück zur Baugruppe klicken."],
    cmd: 'baugruppe bearbeiten "Führung"',
  },

  // ── Baugruppe › Formen ──
  mold: {
    what: "Öffnet den Assistenten für den Spritzgieß-Formaufbau: Aufspann- und Formplatten, Zwischenleisten, Auswerferpaket, Säulen.",
    when: "Entwurf einer Zweiplattenform um einen Formeinsatz.",
    steps: ["Breite X, Länge Y, Plattendicken und Ø Führungssäulen eingeben.", "Optional Kavität in Platte A und Plattenwerkstoff.", "Auf Formaufbau erzeugen klicken."],
    cmd: "formaufbau 246 296",
    note: "Der Formaufbau ersetzt den Inhalt des aktuellen Tabs (Strg+Z macht rückgängig) – Einsätze danach hinzufügen.",
  },
} satisfies Record<string, MicroTip>;
