# Spickzettel für KI-Agenten – Mnástrojárna CAD

Ganze Anleitung: https://www.mnastrojarna.cz/cad/schema-pro-ai.md · Suche: `hilfe suchen registerkarten` · Feature-Felder: `element hilfe bohrung`
Ohne Browser: `mncad run skript.txt --out out` (`--strict`, `--formats step,pdf`, `--json`; Node 22, /cad/cli/) · im Browser `await window.mncad.run(text)`
Protokoll MNCAD/1: ✗ Fehler · ⚠ Warnung · ℹ Hinweis · = Auflistung · D Dokument · F Datei · O Link. mm und °, Z oben, `#` Kommentar, Zeilen und JSON mischbar.

## Dokumente und Registerkarten
`neues teil "Platte"` · `neue baugruppe "Werkzeug"` · `registerkarten` · `registerkarte "Platte"` · `registerkarte schließen` – jedes Teil = Registerkarte; eine Baugruppe fügt nur offene Registerkarten ein (erneutes Einfügen = weitere Instanz).
Große Baugruppe: jedes Teil als Block `neues teil "…"` → `neue baugruppe "…"` → `einfügen "Platte" bei 100 0 0` für jede Instanz → `baugruppe` (Komponentenliste, Anzahl) → `stückliste` (Stück je Quelle).

## Teil
`quader 100 60 12` · `zylinder 20 30 bei 50 30 12` · `skizze XY: rechteck 60 40; kreis 20 bei 10 5` → `extrudieren 10 abziehen` · `drehen 360 achse Y`
`verrunden 2 kanten senkrecht` · `fase 1 kanten oben` · `muster 4 abstand 25 richtung X` · `muster kreisförmig 6 achse Z` · `spiegeln YZ` · `werkstoff stahl` · `normteil M8x30`
Skizze: `bedingung horizontal e1; senkrecht e1 e2` · `bemaßung länge e1 50` · Änderungen: `bearbeiten "Quader 1" size=120;60;12` · `unterdrücken "Verrundung 1"` · `löschen letzte` · `variable t = 12` · `rückgängig`

## Bohrungen und Gewinde
`bohrung 8,5 durch bei 20 30` · `bohrung gewinde M8 tiefe 20 bei 50 30` · `bohrung 6,8 durch bei 10 10 senkung 11 6,5` · `bohrung 10 tiefe 12 flacher grund bei 40 20` · `gewinde M18×1,5 länge 20 bei 0 0 12 innen`

## Baugruppe
`einfügen "Platte" bei 0 0 0 fixieren als "D1"` · `einfügen "Stift" bei 20 30 12 als "K48"` · `baugruppe flächen "K48"` · `baugruppe verknüpfung konzentrisch "K48" Ø10 "D1" Ø10` · `baugruppe verknüpfung kontakt "K48" -Z "D1" oben` · `baugruppe verknüpfungen` · `baugruppe komponente "K48" alias "Stift A"` · `kollision` · `stückliste`

## Federn
`feder druck d 2 De 20 L0 50 n 8` (Teil aus der Tabelle) · `baugruppe feder neu d 2 De 20 L0 35 n 6 zwischen "D1" Ø21 "K48" unten` („alle bohrungen“ am Ende = in jede Bohrung des Musters) · `baugruppe federn` · `baugruppe schraube "D1" Ø9`

## Bewegung
`bewegung antrieb linear verknüpfung 2 0..40 schritt 2 kollision` · `bewegung antrieb dreh "K48" 0..360 schritt 5` · `bewegung dynamik zeit 0,5 schwerkraft -Z` · `bewegung masse "K48" 2,5` · `bewegung status`

## Zeichnung
`zeichnung A3 maßstab 1:2 ansichten vorne,oben,iso` · `zeichnung schnitt XZ` · `bemaßen intelligent funktional 26,5` · `zeichnung toleranz 26,5 h7` · `zeichnung schriftfeld vorlage=iso7200 nummer="MN-1"` · `zeichnung allgemein ISO 2768-mK` · `zeichnung stückliste ja` · `zeichnung einzelheit vorne bei 45 10 radius 5` · `zeichnung status` · `zeichnung export pdf alle`

## 2D-Zeichnung
`2d neu "Profil"` · `2d linie 0,0 100,0 @0,50` · `2d kreis 50,25 20` · `2d exportieren dwg`

## Ausgaben und Links
`speichern` · `exportieren step` · `exportieren step link` · `export skript` · `freigeben tage 30` · `link` (Adresse erneut) · CLI `--formats step,pdf,dxf` und `--share`

## Prüfen
`status` · `messen körper` · `messen bohrungen` · `prüfen baugruppe` · `vergleichen "ref.step" toleranz 0,05` · `vorlage "kunde.dwg"` · `vorlage maße prüfen`

## Strenger Modus und Hilfe
`streng` (jede ⚠ stoppt den Lauf; CLI `--strict`) · `streng aus` · `hilfe suchen feder zwischen teilen` · `hilfe spickzettel` · `element hilfe bohrung` · `rückgängig`
