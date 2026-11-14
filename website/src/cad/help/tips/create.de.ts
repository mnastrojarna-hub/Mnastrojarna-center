/** Kurzanleitungen – Paket „create“ (Registerkarte Erstellen), Deutsch. Schlüssel und Liste: src/cad/help/tips-manifest.ts. */
import type { MicroTip } from "../tips";

export default {
  // ── Skizze ──
  sketch: {
    what: "Legt eine 2D-Skizze auf einer Ebene oder ebenen Fläche an – Basis für Extrudieren, Drehen, Austragung, Rippe.",
    when: "Am Anfang jeder Form: Bauteilkontur, Tasche, Austragungspfad, Rippenlinie.",
    steps: ["Klicken Sie auf Skizze und wählen Sie im Menü Ebene oder Fläche.", "Auf der Registerkarte Skizze Kontur zeichnen, Bedingungen und Maße setzen.", "Mit Skizze beenden bestätigen – Extrudieren öffnet sich sofort."],
    cmd: "skizze XY: rechteck 60 40",
    note: "Für Extrudieren eine geschlossene Kontur ohne Überstände und Lücken zeichnen.",
  },
  "menu:sketch/xy": {
    what: "Legt eine Skizze auf der Grundebene XY an (Draufsicht).",
    when: "Bauteilgrundriss: Platte, Flansch, Taschenkontur, in Z extrudiert.",
    steps: ["Ebene XY (Draufsicht) wählen.", "Kontur zeichnen und mit Skizze beenden bestätigen."],
    cmd: "skizze XY: kreis 50",
  },
  "menu:sketch/xz": {
    what: "Legt eine Skizze auf der Grundebene XZ an (Vorderansicht).",
    when: "Profil von vorne – z. B. halbe Welle zum Drehen, Leistenprofil.",
    steps: ["Ebene XZ (Vorderansicht) wählen.", "Profil zeichnen und mit Skizze beenden bestätigen."],
    cmd: "skizze XZ: kreis 50",
  },
  "menu:sketch/yz": {
    what: "Legt eine Skizze auf der Grundebene YZ an (Seitenansicht).",
    when: "Profil von der Seite – seitlicher Ausschnitt, Rippe in X-Richtung.",
    steps: ["Ebene YZ (Seitenansicht) wählen.", "Profil zeichnen und mit Skizze beenden bestätigen."],
    cmd: "skizze YZ: kreis 50",
  },
  "menu:sketch/face": {
    what: "Legt eine Skizze direkt auf einer ebenen Modellfläche an (Ursprung und X-Richtung von der Fläche).",
    when: "Tasche, Zapfen oder Bohrungen auf der Ober- oder Seitenfläche eines Körpers.",
    select: "Nach der Wahl auf eine ebene Modellfläche klicken.",
    steps: ["Auf einer ebenen Fläche des Modells… wählen.", "Ebene Fläche anklicken, Kontur zeichnen, Skizze beenden."],
    cmd: "skizze fläche oben: kreis 20",
    note: "Eine gekrümmte Fläche definiert keine Ebene – ebene wählen oder Ebene (Referenz) nutzen.",
  },
  "menu:sketch/xyo": {
    what: "Legt eine Skizze auf einer zu XY parallelen Ebene an, um einen Abstand in Z versetzt.",
    when: "Kontur in einer Höhe: obere Tasche, zweites Ausformprofil, Zapfen über einer Platte.",
    steps: ["XY mit Versatz… wählen.", "Versatz in mm eingeben (auch Ausdruck wie 25/2) und bestätigen.", "Kontur zeichnen und mit Skizze beenden bestätigen."],
    cmd: "skizze XY versatz 20: kreis 30",
  },
  "menu:sketch/xzo": {
    what: "Legt eine Skizze auf einer zu XZ parallelen Ebene an, um einen Abstand in Y versetzt.",
    when: "Profil vor oder hinter der Grundebene – zweites Ausformprofil, Stirntasche.",
    steps: ["XZ mit Versatz… wählen.", "Versatz in mm eingeben und bestätigen.", "Kontur zeichnen und mit Skizze beenden bestätigen."],
    cmd: "skizze XZ versatz 20: kreis 30",
  },
  "menu:sketch/yzo": {
    what: "Legt eine Skizze auf einer zu YZ parallelen Ebene an, um einen Abstand in X versetzt.",
    when: "Seitenprofil außerhalb der Bauteilmitte, Schnitt an einer X-Position.",
    steps: ["YZ mit Versatz… wählen.", "Versatz in mm eingeben und bestätigen.", "Kontur zeichnen und mit Skizze beenden bestätigen."],
    cmd: "skizze YZ versatz 20: kreis 30",
  },
  "menu:sketch/faceOff": {
    what: "Legt eine Skizze auf einer Ebene parallel zur gewählten ebenen Fläche an, im angegebenen Abstand.",
    when: "Kontur knapp über oder unter einer Fläche – Absatz, Stufe, zweites Profil.",
    select: "Genau 1 ebene Fläche (Auswahlfilter Fläche).",
    steps: ["Ebene Fläche auswählen.", "Parallel zur gewählten Fläche… wählen und Abstand eingeben.", "Kontur zeichnen und mit Skizze beenden bestätigen."],
  },
  "menu:sketch/mid": {
    what: "Legt eine Skizze auf der Mittelebene zwischen zwei gewählten Flächen an.",
    when: "Symmetrische Elemente: Rippe mittig in der Wand, Nut in der Bauteilmitte.",
    select: "Genau 2 Flächen (Auswahlfilter Fläche, Strg+Klick).",
    steps: ["2 Flächen auswählen.", "Mittelebene zwischen 2 Flächen wählen und zeichnen."],
  },
  "menu:sketch/pts": {
    what: "Legt eine Skizze auf der Ebene durch drei gewählte Eckpunkte an.",
    when: "Schräge Ebene durch Modellecken – Abschrägung, schräger Ausschnitt.",
    select: "Genau 3 Eckpunkte (Auswahlfilter Punkt, Strg+Klick).",
    steps: ["Auswahlfilter auf Punkt stellen und 3 Eckpunkte wählen.", "Durch drei Punkte wählen und zeichnen."],
    note: "Die Eckpunkte dürfen nicht auf einer Geraden liegen.",
  },
  "menu:sketch/*": {
    what: "Legt eine Skizze auf dieser Bezugsebene aus der Historie an.",
    when: "Ebene in allgemeiner Lage – schräg, gedreht oder von einem anderen Element versetzt.",
    steps: ["Bezugsebene nach Namen wählen.", "Kontur zeichnen und mit Skizze beenden bestätigen."],
    note: "Eine Bezugsebene erstellen Sie mit der Schaltfläche Ebene in der Gruppe Referenz.",
  },

  // ── Form ──
  extrude: {
    what: "Extrudiert ein geschlossenes Skizzenprofil in 3D – fügt Material hinzu oder entfernt es.",
    when: "Grundform aus einem 2D-Profil, Tasche, Zapfen, durchgehender Ausschnitt.",
    select: "Skizze mit geschlossenem Profil (letzte vorgewählt; andere im Feld Profil (Skizze)).",
    steps: ["Im Feld Profil (Skizze) das Profil prüfen.", "Endbedingung (Richtung 1): Blind, Durch alles, Bis Fläche… und Länge.", "Operation: Hinzufügen / Entfernen / Schnittmenge, mit OK bestätigen."],
    cmd: "extrudieren 10",
    note: "Auch schräg (Richtung, Winkel zur Normalen) und Formschräge Innen / Außen mit gerader Schneidkante – Freiwinkel der Schneidplatte.",
  },
  revolve: {
    what: "Dreht ein Skizzenprofil um eine Achse – Drehteile wie Welle, Flansch, Bolzen.",
    when: "Gedrehte Formen: abgesetzte Welle, Scheibe, Ring; mit Entfernen Einstich oder Nut.",
    select: "Skizze mit halbem Profil auf einer Seite der Achse (Standard = Y-Achse der Skizze).",
    steps: ["Im Feld Profil (Skizze) die Skizze, im Feld Rotationsachse die Achse wählen.", "Winkel (360° = volle Drehung) und Richtung eingeben.", "Operation: Hinzufügen oder Entfernen, mit OK bestätigen."],
    cmd: "rotieren 360",
    note: "Das Profil darf die Rotationsachse nicht kreuzen.",
  },
  sweep: {
    what: "Zieht ein Profil entlang eines Pfads – gebogenes Rohr, Griff, Leiste entlang einer Kurve.",
    when: "Konstanter Querschnitt auf gekrümmtem Pfad: Rohr, Draht, Dichtungsnut.",
    select: "Zwei Skizzen: Profil und Pfad; ein Kreisprofil geht auch ohne Skizze (Kreis).",
    steps: ["Profil (geschlossene Skizze) und Pfad (Kurve) wählen.", "Profilausrichtung entlang des Pfads, ggf. Verdrehung einstellen.", "Operation wählen und mit OK bestätigen."],
    cmd: 'element sweep profileId="Skizze 1" pathId=$last',
    note: "Scharfe Pfadecken regelt das Feld Übergang an Pfadecken.",
  },
  loft: {
    what: "Erzeugt einen fließenden Übergang zwischen zwei oder mehr Profilen in verschiedenen Ebenen.",
    when: "Übergangsstück (Vierkant auf rund), Trichter, Schaufel, Formanlauf.",
    select: "Mindestens 2 geschlossene Skizzen in verschiedenen Ebenen (Profil und Punkt genügen).",
    steps: ["In Profile (in Reihenfolge) die Skizzen von der ersten bis zur letzten hinzufügen.", "Optional Schließen, Randbedingungen oder Leitkurve.", "Operation wählen und mit OK bestätigen."],
    note: "Profile mit gleicher Segmentanzahl ergeben die saubersten Flächen.",
  },
  text: {
    what: "Graviert eine Beschriftung oder hebt sie erhaben heraus – Kennzeichnung, Teilenummer, Pfeil.",
    when: "Formnummer, Teilekennzeichnung, Beschriftung auf Schild oder Vorrichtung.",
    steps: ["Im Feld Text die Beschriftung eingeben, Schrifthöhe und Tiefe angeben.", "Methode: Gravieren oder Erhaben; Textebene wählen.", "Textmitte und Drehung einstellen, mit OK bestätigen."],
    cmd: 'text "ABC" höhe 10 tiefe 1 bei 0 0',
    note: "Schrift auf einer Zylinderfläche macht Text auf Zylinder (ebenfalls unter Erstellen).",
  },

  // ── Grundkörper ──
  box: {
    what: "Fügt einen Quader mit den Abmessungen X × Y × Z ein – Rohteil, Platte, Block.",
    when: "Schnelles Rohteil, Spannplatte, Block zum Materialabtrag.",
    steps: ["Abmessungen (X × Y × Z) in mm eingeben.", "Position (Ecke) setzen oder Position = Quadermitte ankreuzen.", "Operation wählen und mit OK bestätigen."],
    cmd: "quader 100 60 20",
    note: "Die Lage des Quaders bestimmt das Feld Z-Achse des Quaders.",
  },
  cylinder: {
    what: "Fügt einen Zylinder mit Durchmesser und Höhe ein – Bolzen, Welle, runde Platte.",
    when: "Bolzen, Distanzsäule, rundes Rohteil; mit Entfernen ein zylindrischer Ausschnitt.",
    steps: ["Durchmesser und Höhe eingeben.", "Achse (X / Y / Z oder Richtung) und Position der Grundfläche wählen.", "Operation wählen und mit OK bestätigen."],
    cmd: "zylinder 40 60",
    note: "Für Gewinde- oder Senkbohrungen besser Bohrung – mit Angabe in der Zeichnung.",
  },
  tube: {
    what: "Fügt ein Rohr mit Außen- und Innendurchmesser und Länge ein.",
    when: "Buchse, Distanzring, Rohr-Rohteil.",
    steps: ["Außen-Ø, Ø innen und Länge eingeben.", "Achse und Position der Grundfläche wählen.", "Operation wählen und mit OK bestätigen."],
    cmd: "rohr 40 30 100",
    note: "Ø innen muss kleiner als Außen-Ø sein; 0 ergibt einen Vollzylinder.",
  },
  cone: {
    what: "Fügt einen Kegel oder Kegelstumpf mit Ø unten, Ø oben und Höhe ein.",
    when: "Spitze, Kegelbolzen, Zentrierkegel, Übergang zwischen zwei Durchmessern.",
    steps: ["Ø unten, Ø oben und Höhe eingeben (Ø 0 = Spitze).", "Achse und Position der Grundfläche wählen.", "Operation wählen und mit OK bestätigen."],
    cmd: "kegel 40 20 30",
    note: "Eine Kegelsenkung für Schrauben macht direkt Bohrung (Kegelsenkung).",
  },
  sphere: {
    what: "Fügt eine Kugel mit Durchmesser und Mittelpunkt ein.",
    when: "Kugelkopf, Kugelbolzen; mit Entfernen eine Kugelpfanne für ein Gelenk.",
    steps: ["Durchmesser eingeben.", "Im Feld Mitte Koordinaten oder einen Punkt per Referenz angeben.", "Operation wählen und mit OK bestätigen."],
    cmd: "kugel 30",
  },

  // ── Konstruktionselemente ──
  hole: {
    what: "Bohrt ein Loch: gebohrt, mit Zylinder- oder Kegelsenkung oder mit Gewinde, auch mehrere auf einmal.",
    when: "Bohrungen für Schrauben und Stifte, Gewindebohrungen; Sack- oder Durchgangsloch.",
    select: "Bei offenem Formular die Fläche anklicken, in die gebohrt wird (setzt Punkt und Achse).",
    steps: ["Bohrungstyp: Gebohrt, Zylindersenkung, Kegelsenkung oder Gewinde; Durchmesser.", "Fläche anklicken (Punkt auf der Oberfläche) oder Bohrungspositionen ausfüllen.", "Endbedingung (Tiefe, durch) einstellen und mit OK bestätigen."],
    cmd: "bohrung 8,5 durch bei 20 30",
    note: "Gewinde: Tabellenbohrer (M8 → 6,8), Kerndurchmesser oder eigener Bohrer; Sackloch auch mit flachem Grund.",
  },
  thread: {
    what: "Fügt ein metrisches ISO-Gewinde an einem Zylinder oder in einer Bohrung hinzu – kosmetisch oder modelliert.",
    when: "Schraube, Gewindebolzen, Gewindebohrung, die die Zeichnung angeben soll (M8, M18×1,5).",
    select: "Zylinder oder Bohrung – Anfang und Achse im Formular per Kantenreferenz.",
    steps: ["Im Feld Gewinde die Größe wählen oder die Bezeichnung (Text) eintippen.", "Bei Bohrungen Innengewinde (in einer Bohrung) ankreuzen, Gewindelänge.", "Achse und Gewindeanfang (auf der Achse) setzen, mit OK bestätigen."],
    cmd: "gewinde M8 länge 20",
    note: "Ein kosmetisches Gewinde ändert die Geometrie nicht, es wird nur in der Zeichnung angegeben.",
  },
  split: {
    what: "Schneidet den Körper mit einer Ebene und entfernt eine Seite.",
    when: "Abschneiden eines Bauteilteils, Kürzen eines importierten Modells, halbes Bauteil.",
    steps: ["Im Feld Schnittebene eine Ebene wählen, oder Grundebene und Ebenenlage.", "Im Feld Behalten die verbleibende Seite wählen.", "Mit OK bestätigen."],
    cmd: "element split plane=XY offset=10",
    note: "Beide Hälften als eigene Körper behält In Körper teilen.",
  },
  rib: {
    what: "Erzeugt aus einer offenen Skizzenlinie eine Versteifungsrippe gegebener Dicke bis zum Körper.",
    when: "Versteifung zwischen Wänden eines Guss- oder Spritzteils, Rippe eines Winkels.",
    select: "Offene Skizze mit der Rippenlinie.",
    steps: ["Im Feld Rippenlinie (offene Skizze) die Skizze wählen.", "Dicke und Dickenrichtung (Senkrecht zur Skizze / In der Skizzenebene).", "Ggf. Seite umkehren, mit OK bestätigen."],
    cmd: "element rib thickness=3",
    note: "Die Rippe läuft bis zum Material – die Linie muss den Körper nicht genau treffen.",
  },
  spring: {
    what: "Erzeugt eine Schraubenfeder aus Runddraht.",
    when: "Druckfeder für Baugruppe, Vorrichtung oder Form.",
    steps: ["Federdurchmesser, Drahtdurchmesser, Steigung und Windungszahl eingeben.", "Achse und Position (Achsenanfang) wählen.", "Freie Länge prüfen und mit OK bestätigen."],
    cmd: "element spring radius=10 wire=2 pitch=5 turns=8",
    note: "Die Steigung muss größer als der Drahtdurchmesser sein, sonst schneiden sich die Windungen.",
  },

  // ── Bearbeiten ──
  fillet: {
    what: "Verrundet die gewählten Kanten – mit konstantem, variablem oder elliptischem Radius.",
    when: "Scharfe Kanten brechen, Radien an Guss- und Pressteilen, Wandübergänge.",
    select: "Körperkanten (Filter Kante, Strg+Klick für mehrere) – oder später im Formular anklicken.",
    steps: ["Kanten wählen und auf Verrunden klicken.", "Art wählen (Konstant, R1 → R2…) und Radius eingeben.", "Mit OK bestätigen."],
    cmd: "verrunden 2 kanten senkrecht",
    note: "Ein Radius größer als die Nachbarwand scheitert – kleiner wählen oder weniger Kanten.",
  },
  chamfer: {
    what: "Fast die gewählten Kanten – gleicher Abstand, zwei Abstände oder Abstand und Winkel.",
    when: "Montagefasen, Entgraten, Einführschräge für Stift oder Schraube.",
    select: "Körperkanten (Filter Kante, Strg+Klick für mehrere).",
    steps: ["Kanten wählen und auf Fasen klicken.", "Fasenart: Gleich, D1 × D2 oder D × Winkel; Größe eingeben.", "Mit OK bestätigen."],
    cmd: "fase 1 kanten oben",
  },
  draft: {
    what: "Neigt Seitenflächen um den Schrägenwinkel zur neutralen Ebene – zum Entformen.",
    when: "Formschrägen an Guss-, Press- und Kunststoffteilen in Öffnungsrichtung der Form.",
    select: "Flächen für die Formschräge (Filter Fläche) – oder im Formular anklicken.",
    steps: ["Seitenflächen wählen und auf Formschräge klicken.", "Schrägenwinkel, Neutrale Ebene und Entformungsrichtung (Formöffnung) angeben.", "Mit OK bestätigen."],
    cmd: "schräge 3 flächen seitlich",
    note: "Die Schrägenanalyse des ganzen Teils bieten die Formenbau-Werkzeuge (Werkzeuge).",
  },
  shell: {
    what: "Höhlt den Körper zu einer Wand gegebener Dicke aus; gewählte Flächen bleiben offen.",
    when: "Kasten, Deckel, Behälter, dünnwandiges Spritzteil.",
    select: "Flächen, die offen bleiben sollen (Filter Fläche).",
    steps: ["Zu öffnende Flächen wählen und auf Schale klicken.", "Wanddicke eingeben, ggf. Nach außen verdicken.", "Mit OK bestätigen."],
    cmd: "schale 2 öffnen oben",
    note: "Die Dicke muss kleiner sein als der kleinste innere Verrundungsradius.",
  },
  filletSetback: {
    what: "Verrundet Kanten und schließt die Ecke, an der 3 und mehr Kanten zusammenlaufen, mit einem glatten Flicken.",
    when: "Ecken von Kästen und Gussteilen, an denen drei verrundete Kanten zusammentreffen.",
    select: "Die zur Ecke laufenden Kanten (Filter Kante).",
    steps: ["Kanten wählen und auf Verrundung mit Rückversatz klicken.", "Radius und Rückversatz (von der Ecke entlang der Kanten) eingeben.", "Ggf. anderer Rückversatz für gewählte Eckpunkte, mit OK bestätigen."],
    cmd: "verrunden 3 kanten senkrecht rückversatz 6",
    note: "Der Rückversatz muss mindestens dem Radius entsprechen, sonst scheitert die Ecke.",
  },
  filletConic: {
    what: "Verrundet Kanten mit elliptischem Querschnitt – zwei Abstände D1 × D2 oder Kegelschnitt (rho).",
    when: "Designübergänge, unsymmetrische Rundungen zwischen unterschiedlich hohen Wänden.",
    select: "Körperkanten (Filter Kante).",
    steps: ["Kanten wählen und auf Elliptische Verrundung klicken.", "D1 (erste Fläche) und D2 (zweite Fläche); Querschnitt Ellipse oder Kegelschnitt.", "Mit OK bestätigen."],
    cmd: "verrunden elliptisch 4 2 kanten oben",
  },
  draftParting: {
    what: "Neigt Flächen von einer Trennlinie aus nach beiden Seiten – obere und untere Formhälfte.",
    when: "Teile mit der Formtrennung in der Mitte, Schräge über und unter der Trennlinie.",
    select: "Skizze mit der Trennlinie und die Flächen für die Formschräge.",
    steps: ["Im Feld Trennlinie (Skizze) die Skizze wählen.", "Flächen wählen, Schrägenwinkel und Entformungsrichtung angeben.", "Ggf. Gestufte Schräge, mit OK bestätigen."],
    cmd: 'schräge 3 flächen seitlich trennlinie "Skizze 1"',
  },

  // ── Direkte Bearbeitung ──
  pushPull: {
    what: "Verschiebt die gewählte ebene Fläche entlang ihrer Normalen – fügt Material hinzu oder nimmt es weg.",
    when: "Schnelle Maßänderung ohne Historie: verlängern, dünner machen, Wand ausrichten.",
    select: "Ebene Flächen (Filter Fläche) – oder im Formular anklicken.",
    steps: ["Fläche wählen und auf Ziehen / Drücken klicken.", "Endbedingung: Blind (+ außen, − innen), Bis Eckpunkt oder Bis Fläche.", "Mit OK bestätigen."],
    cmd: "element pushPull distance=5 faces=oben",
    note: "Funktioniert auch an importierten Modellen (STEP) ohne Historie.",
  },
  offsetFace: {
    what: "Versetzt die gewählten Flächen um einen Abstand – auch gekrümmte und zylindrische.",
    when: "Bearbeitungszugabe, Bohrung vergrößern oder verkleinern, Passung anpassen.",
    select: "Zu versetzende Flächen (Filter Fläche).",
    steps: ["Flächen wählen und auf Fläche versetzen klicken.", "Versatz eingeben (+ außen, − innen).", "Mit OK bestätigen."],
    cmd: "element offsetFace distance=0,5 faces=zylindrisch",
    note: "Eine Bohrungswand um +0,5 mm versetzt macht die Bohrung kleiner.",
  },
  deleteFace: {
    what: "Entfernt die gewählten Flächen und heilt den Körper – Bohrung, Verrundung oder Zapfen verschwinden.",
    when: "Vereinfachen importierter Modelle, Verrundung oder Bohrung ohne Historie entfernen.",
    select: "Zu entfernende Flächen (Filter Fläche).",
    steps: ["Flächen wählen (z. B. Bohrungswand) und auf Fläche entfernen klicken.", "Flächenliste prüfen und mit OK bestätigen."],
    cmd: "element deleteFace faces=zylindrisch",
    note: "Geheilt wird nur, was die Nachbarflächen schließen können – sonst meldet das Element einen Fehler.",
  },
  thicken: {
    what: "Verdickt die gewählten Flächen zu einem Körper gegebener Dicke.",
    when: "Blech oder Schale aus einer Fläche, Wand aus einer importierten Fläche.",
    select: "Zu verdickende Flächen (Filter Fläche).",
    steps: ["Flächen wählen und auf Verdicken klicken.", "Dicke eingeben (+ außen, − innen).", "Operation wählen und mit OK bestätigen."],
    cmd: "element thicken thickness=2 faces=oben",
  },
  faceColor: {
    what: "Färbt die gewählten Modellflächen in der gewählten Farbe.",
    when: "Funktionsflächen hervorheben: Anlage-, Schleif-, Gewinde- oder Bearbeitungsflächen.",
    select: "Flächen (Filter Fläche, Strg+Klick für mehrere).",
    steps: ["Flächen wählen.", "Auf Flächenfarbe klicken und eine Farbe wählen."],
    cmd: "farbe fläche oben #e03930",
  },
  "menu:faceColor/*": {
    what: "Gibt den gewählten Flächen diese Farbe.",
    when: "Unterscheidung von Funktionsflächen (Anlage, bearbeitet, Prüfung).",
    select: "Flächen (Filter Fläche).",
    steps: ["Auf die Farbe klicken – die Flächen werden sofort umgefärbt."],
    cmd: "farbe fläche oben #e03930",
  },
  "menu:faceColor/reset": {
    what: "Setzt die gewählten Flächen auf die Körperfarbe zurück.",
    when: "Hervorhebung von Flächen aufheben.",
    select: "Gefärbte Flächen (Filter Fläche).",
    steps: ["Auf Standardfarbe klicken."],
    cmd: "farbe fläche oben standard",
  },

  // ── Grundbearbeitung ──
  pattern: {
    what: "Wiederholt ein Element (Bohrung, Zapfen…) – linear, kreisförmig, entlang Kurve, nach Skizzenpunkten oder als Füllung.",
    when: "Reihe oder Raster von Bohrungen, Bohrungen auf Teilkreis, Rippen am Umfang.",
    select: "Das zu wiederholende Element – letzte Bohrung oder Extrusion vorgewählt (Feld Wiederholte Features).",
    steps: ["Im Feld Wiederholte Features das Element prüfen.", "Musterart: Linear, Kreisförmig…; Anzahl der Instanzen und Abstand oder Winkel.", "Richtung 1 (kreisförmig: Achse) setzen und mit OK bestätigen."],
    cmd: "muster 4 abstand 25 richtung X",
    note: "Einzelne Instanzen lassen sich per Klick in der Instanzliste auslassen.",
  },
  mirror: {
    what: "Spiegelt den ganzen Körper oder gewählte Elemente an einer Ebene.",
    when: "Symmetrische Teile: eine Hälfte modellieren und spiegeln.",
    steps: ["Im Feld Spiegelebene eine Ebene wählen (oder Grundebene).", "Spiegeln: Ganzer Körper, oder Gewählte Elemente und ankreuzen.", "Beim Körper Original behalten (vereinigen) lassen, mit OK bestätigen."],
    cmd: "spiegeln YZ",
  },
  transform: {
    what: "Verschiebt, dreht oder skaliert den Körper – per Gizmo oder numerisch.",
    when: "Ausrichten eines importierten Modells, Teil in die Bearbeitungslage drehen.",
    steps: ["Auf Verschieben / drehen klicken – das Gizmo erscheint.", "Pfeile (Schritt 1 mm) oder Bögen (Schritt 15°) ziehen; R schaltet um.", "Genaue Werte: Verschiebung, Drehung, Maßstab; mit OK bestätigen."],
    cmd: "element transform translate=10;0;0",
  },

  // ── Körper ──
  splitBodies: {
    what: "Teilt den Körper mit einer Ebene in zwei eigenständige Körper; nichts wird entfernt.",
    when: "Form in zwei Hälften teilen, Bauteil aus mehreren Stücken, Vorbereitung für Baugruppe.",
    steps: ["Im Feld Trennebene eine Ebene wählen, oder Grundebene und Lage.", "Name des neuen Körpers (negative Seite der Ebene) eingeben.", "Mit OK bestätigen."],
    cmd: "teilen XY versatz 10",
  },
  copyBody: {
    what: "Erzeugt einen weiteren Körper als verschobene Kopie eines vorhandenen Körpers.",
    when: "Zweites gleiches Stück neben dem ersten, Variante zum Ändern, Werkzeug zum Kombinieren.",
    steps: ["Im Feld Zu kopierender Körper den Körper wählen.", "Verschiebung der Kopie (X, Y, Z) und Name der Kopie eingeben.", "Mit OK bestätigen."],
    cmd: "kopieren versatz 50 0 0",
  },
  combine: {
    what: "Kombiniert zwei Körper des Bauteils: vereinigt, zieht einen vom anderen ab oder behält die Schnittmenge.",
    when: "Zwei Stücke verbinden, Form eines anderen Körpers ausfräsen, Schnitt zweier Formen.",
    select: "Bauteil mit mindestens zwei Körpern.",
    steps: ["Zielkörper (Ergebnis) und Werkzeugkörper wählen.", "Operation: Vereinigen, Entfernen oder Schnittmenge.", "Ggf. Werkzeugkörper behalten, mit OK bestätigen."],
    cmd: "kombinieren 1 2",
  },

  // ── Löschen ──
  delete: {
    what: "Löscht das bearbeitete oder gewählte Element, die gewählte Fläche (wie Fläche entfernen) oder den ganzen Körper.",
    when: "Historie aufräumen, falsches Element verwerfen, Fläche eines importierten Modells entfernen.",
    select: "Element im Manager, Fläche oder Körper im Modell.",
    steps: ["Auswählen, was gelöscht werden soll.", "Auf Löschen klicken (oder Taste Entf)."],
    cmd: "löschen letzte",
    note: "Abhängige Elemente melden danach einen Fehler – Strg+Z macht es rückgängig.",
  },

  // ── Referenz ──
  datum: {
    what: "Erzeugt eine Bezugsebene – versetzt, durch drei Punkte, unter Winkel zur Fläche, senkrecht zur Kurve u. a.",
    when: "Skizze oder Schnitt in allgemeiner Lage, Spiegel- oder Trennebene abseits der Grundebenen.",
    steps: ["Im Feld Ebenendefinition die Methode wählen und Referenzen im Modell anklicken.", "Oder Ursprung und Normale manuell eingeben.", "Mit OK bestätigen; Skizze darauf im Menü Skizze anlegen."],
    cmd: "element datum",
    note: "Eine Bezugsebene erzeugt keine Geometrie und folgt Änderungen des Modells.",
  },
  datumAxis: {
    what: "Erzeugt eine Bezugsachse – aus Kante, Zylinderachse, zwei Punkten oder Schnittlinie zweier Ebenen.",
    when: "Achse für Drehen, Rotation oder Kreismuster abseits der Achsen X, Y, Z.",
    steps: ["Im Feld Achsendefinition die Methode wählen und Referenzen anklicken.", "Anzeigelänge einstellen und mit OK bestätigen."],
    cmd: "element datumAxis",
    note: "In Formularen über die Option Bezugsachse im Achsen- oder Richtungsfeld wählbar.",
  },
  datumPoint: {
    what: "Erzeugt einen Bezugspunkt – Eckpunkt, Kanten- oder Kreismitte, Projektion, Schnittpunkt, Koordinaten.",
    when: "Lage einer Bohrung, eines Grundkörpers oder Drehzentrums an einer Stelle ohne Eckpunkt.",
    steps: ["Im Feld Punkt die Methode wählen (rechte Taste / ⋯ = weitere Möglichkeiten).", "Referenzen im Modell anklicken und mit OK bestätigen."],
    cmd: "element datumPoint",
  },
  csys: {
    what: "Erzeugt ein Koordinatensystem aus Ursprung und den Richtungen der Z- und X-Achse.",
    when: "Messen und Skizzieren bezogen auf den Werkstücknullpunkt, gedrehtes Teil in der Baugruppe.",
    steps: ["Ursprung angeben (Punkt per Referenz).", "Z-Achse und X-Achse (wird zu Z orthogonalisiert) setzen.", "Mit OK bestätigen."],
    cmd: "element csys",
    note: "Sein Ursprung dient als Bezugspunkt, die Z-Achse als Achse, die XY-Ebene als Skizzenebene.",
  },

  // ── Bibliothek ──
  library: {
    what: "Öffnet die Normteilbibliothek – Schrauben, Muttern, Lager, Stifte, Zahnräder, Profile.",
    when: "Normteile für Konstruktion oder Baugruppe, ohne sie zu zeichnen.",
    steps: ["Bezeichnung eingeben (z. B. M8x30, Lager 6204) oder Kategorie wählen.", "Maße prüfen und das Teil einfügen."],
    cmd: "normteil M8x30",
    note: "Im Bauteil öffnet sich das Normteil in einem neuen Tab, in der Baugruppe wird es als Komponente eingefügt.",
  },
} satisfies Record<string, MicroTip>;
