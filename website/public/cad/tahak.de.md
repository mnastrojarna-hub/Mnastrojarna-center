# Spickzettel für KI-Agenten – Mnástrojárna CAD

Ganze Anleitung: https://www.mnastrojarna.cz/cad/schema-pro-ai.md · Suche: `hilfe suchen registerkarten` · Feature-Felder: `element hilfe bohrung`
Ohne Browser: `mncad run skript.txt --out out` (`--strict`, `--formats step,pdf`, `--json`, `--timeout 300`, `--max-mem 2048`; Node 22, /cad/cli/) · im Browser `await window.mncad.run(text)`
Protokoll MNCAD/1: ✗ Fehler · ⚠ Warnung · ℹ Hinweis · = Auflistung · D Dokument · F Datei · O Link. mm und °, Z oben, `#` Kommentar, Zeilen und JSON mischbar.
Die Befehle dieses Spickzettels laufen nacheinander als ein Skript (Platte → Stift → Baugruppe → Zeichnung); nach „Sonst:“ stehen eigenständige Beispiele.

## Dokumente und Registerkarten
`neues teil "Platte"` · `neue baugruppe "Werkzeug"` · `registerkarten` · `registerkarte "Platte"` (die nächsten Zeilen gehören ihr) – jedes Teil = Registerkarte; eine Baugruppe fügt nur offene Registerkarten ein (erneutes Einfügen = weitere Instanz). Sonst: `registerkarte schließen`
Große Baugruppe: jedes Teil als Block `neues teil "…"`, dann in der Registerkarte der Baugruppe `einfügen "…" bei 100 0 0` für jede Instanz; der Befehl baugruppe listet die Komponentenzahl, stückliste die Stückzahlen.

## Teil (Registerkarte „Platte“)
`quader 100 60 12` · `skizze XY: rechteck 30 18 ecke 60 36` · `bedingung fest e1.c0` · `bemaßung länge e1.s0 30` → `extrudieren 4 abziehen`
`verrunden 2 kanten senkrecht` · `fase 1 kanten oben` · `werkstoff stahl` · `variable t = 12` · Änderungen: `bearbeiten "Verrundung 1" radius=3` · `unterdrücken "Fase 1"` · `löschen letzte`
Sonst: `zylinder 20 30 bei 50 30 12` · `skizze XZ: rechteck 10 30 ecke 0 0` → `drehen 360 achse Z` · `muster kreisförmig 6 achse Z bei 50 30 0` · `spiegeln YZ` · `normteil M8x30` · `feder druck d 2 De 20 L0 50 n 8` (Teil aus der Tabelle) · `rückgängig` (nur zwischen Läufen – nimmt einen ganzen Lauf zurück, keine Zeile)

## Bohrungen und Gewinde
`bohrung 21 tiefe 8 flacher grund bei 25 30` · `bohrung 9 durch bei 50 10` · `bohrung gewinde M8 tiefe 10 bei 50 50` · `bohrung 6,8 durch bei 10 10 senkung 11 6,5` · `muster 2 abstand 80 richtung X` · `bohrung 16,5 durch bei 75 20` · `gewinde M18×1,5 länge 12 bei 75 20 12 innen`
Teil prüfen: `status` · `messen körper` · `messen bohrungen` · `prüfen`

## Baugruppe (Registerkarte „Werkzeug“)
`neues teil "Stift"` · `zylinder 20 30` · `registerkarte "Werkzeug"` · `einfügen "Platte" bei 0 0 0 fixieren als "D1"` · `einfügen "Stift" bei 25 30 40` · `baugruppe komponente #2 alias "K48"` · `baugruppe` (Komponenten, Anzahl) · `baugruppe flächen "K48"`
`baugruppe verknüpfung konzentrisch "K48" Ø20 "D1" Ø21` · `baugruppe verknüpfung abstand "K48" -Z "D1" oben wert 20` · `baugruppe verknüpfungen` · `kollision` · `stückliste` · `prüfen baugruppe`. Sonst: `baugruppe verknüpfung kontakt "K48" -Z "D1" oben`

## Federn und Bewegung
`baugruppe feder neu d 2 De 20 L0 35 n 6 zwischen "D1" Ø21 "K48" unten` („alle bohrungen“ am Ende = in jede Bohrung des Musters) · `baugruppe federn`
`bewegung antrieb linear verknüpfung 2 12..20 schritt 4 kollision` (Verknüpfung 2 = Abstand; kein Antrieb auf Kontakt) · `bewegung status` · `bewegung dynamik zeit 0,1 schwerkraft -Z` · `bewegung masse "K48" 2,5` · `bewegung kinematik`
Schraube erst nach der Dynamik in die Bohrung (ein freies Teil fiele unter Schwerkraft): `baugruppe schraube "D1" Ø9`. Sonst: `bewegung antrieb dreh "K48" 0..360 schritt 5`

## Zeichnung (Registerkarte des Teils)
`registerkarte "Platte"` · `zeichnung A3 maßstab 1:1 ansichten vorne,oben,iso` · `zeichnung schnitt XZ versatz -30` (Ebene Y = 30; ohne Versatz liegt sie auf der Fläche) · `bemaßen intelligent funktional 100` · `zeichnung toleranz 100 ±0,05` · `zeichnung toleranz Ø21 H7`
`zeichnung schriftfeld vorlage=iso7200 nummer="MN-1"` · `zeichnung allgemein ISO 2768-mK` · `zeichnung blatt neu "Detail"` · `bemaßen keine` · `zeichnung einzelheit vorne bei 25 8 radius 6` · `zeichnung status alle` · `zeichnung export pdf alle`. Sonst (Baugruppenzeichnung): `zeichnung stückliste ja`

## Ausgaben und Links
`speichern` · `exportieren step` · `export skript` · `freigeben` · `link` (Adresse erneut) · CLI `--formats step,pdf,dxf` und `--share`. Sonst (Speicher): `freigeben tage 30` · `exportieren step link`

## 2D-Zeichnung
`2d neu "Profil"` · `2d linie 0,0 100,0 @0,50` · `2d kreis 50,25 20` · `2d exportieren dwg`

## Prüfen gegen eine Vorlage
Sonst (Eingabedateien, CLI --files): `vergleichen "ref.step" toleranz 0,05` · `vorlage "kunde.dwg"` · `vorlage maße prüfen`

## Strenger Modus und Hilfe
`streng` (jede ⚠ stoppt den Lauf; CLI `--strict`) · `streng aus` · `hilfe suchen feder zwischen teilen` · `hilfe spickzettel` · `element hilfe bohrung`
