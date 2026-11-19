/**
 * Tahák pro AI agenty (≤ 5 kB na jazyk): nejčastější příkazy jako hotové řádky, které jdou rovnou do skriptu. Bez importů –
 * čte ho i Node skript scripts/cad-docs-text.mjs (public/cad/tahak.md, tahak.en.md, tahak.de.md a začátek
 * public/cad/schema-pro-ai.md). V konzoli `nápověda tahák` (EN `help cheatsheet`, DE `hilfe spickzettel`), v CLI `mncad help cheat`.
 *
 * Každý řádek v `…` je platný příkaz daného jazyka (agent-cheatsheet.test.ts ho přečte parseAgentText – bez chyby);
 * výjimky (příkazová řádka, API, zástupná slova) jsou ve `CHEATSHEET_NON_COMMAND`.
 */

export type CheatLang = "cs" | "en" | "de";

const CS = `# Tahák pro AI agenty – Mnástrojárna CAD

Celý návod: https://www.mnastrojarna.cz/cad/schema-pro-ai.md · hledání: \`nápověda hledat záložky\` · pole prvku: \`prvek nápověda díra\`
Bez prohlížeče: \`mncad run skript.txt --out out\` (\`--strict\`, \`--formats step,pdf\`, \`--json\`; Node 22, /cad/cli/) · v prohlížeči \`await window.mncad.run(text)\`
Protokol MNCAD/1: ✗ chyba · ⚠ varování · ℹ poznámka · = výpis · D dokument · F soubor · O odkaz. mm a °, Z nahoru, \`#\` komentář, řádky a JSON lze míchat.

## Dokumenty a záložky
\`nový díl "Deska"\` · \`nová sestava "Nástroj"\` · \`záložky\` · \`záložka "Deska"\` · \`zavřít záložku\` – každý díl = záložka; sestava vkládá jen otevřené záložky (další vložení = další instance).
Velká sestava: všechny díly jako bloky \`nový díl "…"\` → \`nová sestava "…"\` → \`vložit "Deska" v 100 0 0\` pro každou instanci → \`sestava\` (výpis komponent, počet) → \`kusovník\` (kusy podle zdroje).

## Díl
\`kvádr 100 60 12\` · \`válec 20 30 v 50 30 12\` · \`skica XY: obdélník 60 40; kružnice 20 v 10 5\` → \`vysunout 10 odebrat\` · \`rotovat 360 osa Y\`
\`zaoblit 2 hrany svislé\` · \`srazit 1 hrany horní\` · \`pole 4 rozteč 25 směr X\` · \`pole kruhové 6 osa Z\` · \`zrcadlit YZ\` · \`materiál ocel\` · \`normálie M8x30\`
Skica: \`vazba vodorovně e1; kolmo e1 e2\` · \`kóta délka e1 50\` · úpravy: \`upravit "Kvádr 1" size=120;60;12\` · \`potlačit "Zaoblení 1"\` · \`smazat poslední\` · \`proměnná t = 12\` · \`zpět\`

## Díry a závity
\`díra 8,5 skrz v 20 30\` · \`díra závit M8 hloubka 20 v 50 30\` · \`díra 6,8 skrz v 10 10 zahloubení 11 6,5\` · \`díra 10 hloubka 12 dno ploché v 40 20\` · \`závit M18×1,5 délka 20 v 0 0 12 vnitřní\`

## Sestava
\`vložit "Deska" v 0 0 0 ukotvit jako "D1"\` · \`vložit "Čep" v 20 30 12 jako "K48"\` · \`sestava plochy "K48"\` · \`sestava vazba souosost "K48" Ø10 "D1" Ø10\` · \`sestava vazba kontakt "K48" -Z "D1" horní\` · \`sestava vazby\` · \`sestava komponenta "K48" přezdívka "Čep A"\` · \`kolize\` · \`kusovník\`

## Pružiny
\`pružina tlačná d 2 De 20 L0 50 n 8\` (díl z tabulky) · \`sestava pružina nová d 2 De 20 L0 35 n 6 mezi "D1" Ø21 "K48" spodní\` (na konci „do děr vzoru“ = do všech děr vzoru) · \`sestava pružiny\` · \`sestava šroub "D1" Ø9\`

## Pohyb
\`pohyb motor lineární vazba 2 0..40 krok 2 kolize\` · \`pohyb motor rotační "K48" 0..360 krok 5\` · \`pohyb dynamika čas 0,5 gravitace -Z\` · \`pohyb hmotnost "K48" 2,5\` · \`pohyb stav\`

## Výkres
\`výkres A3 měřítko 1:2 pohledy přední,horní,iso\` · \`výkres řez XZ\` · \`kótovat chytře funkční 26,5\` · \`výkres tolerance 26,5 h7\` · \`výkres razítko šablona=iso7200 číslo="MN-1"\` · \`výkres nepředepsané ISO 2768-mK\` · \`výkres kusovník ano\` · \`výkres detail přední v 45 10 poloměr 5\` · \`výkres stav\` · \`výkres export pdf vše\`

## 2D výkres
\`2d nový "Profil"\` · \`2d čára 0,0 100,0 @0,50\` · \`2d kružnice 50,25 20\` · \`2d export dwg\`

## Výstupy a odkazy
\`uložit\` · \`export step\` · \`export step odkaz\` · \`export skript\` · \`sdílet dní 30\` · \`odkaz\` (adresa znovu) · v CLI \`--formats step,pdf,dxf\` a \`--share\`

## Kontrola
\`stav\` · \`měřit těleso\` · \`měřit díry\` · \`kontrola sestava\` · \`porovnat "ref.step" tolerance 0,05\` · \`předloha "zakaznik.dwg"\` · \`předloha kontrola kót\`

## Přísný režim a nápověda
\`přísně\` (každé ⚠ zastaví běh; CLI \`--strict\`) · \`přísně vyp\` · \`nápověda hledat pružina mezi díly\` · \`nápověda tahák\` · \`prvek nápověda díra\` · \`zpět\`
`;

const EN = `# Cheat sheet for AI agents – Mnástrojárna CAD

Full guide: https://www.mnastrojarna.cz/cad/schema-pro-ai.md · search: \`help search tabs\` · feature fields: \`feature help hole\`
Without a browser: \`mncad run script.txt --out out\` (\`--strict\`, \`--formats step,pdf\`, \`--json\`; Node 22, /cad/cli/) · in a browser \`await window.mncad.run(text)\`
Log MNCAD/1: ✗ error · ⚠ warning · ℹ note · = listing · D document · F file · O link. mm and °, Z up, \`#\` comment, lines and JSON can be mixed.

## Documents and tabs
\`new part "Plate"\` · \`new assembly "Tool"\` · \`tabs\` · \`tab "Plate"\` · \`close tab\` – every part is a tab; an assembly inserts open tabs only (inserting again = another instance).
Large assembly: every part as a block \`new part "…"\` → \`new assembly "…"\` → \`insert "Plate" at 100 0 0\` for each instance → \`assembly\` (component list, count) → \`bom\` (quantities by source).

## Part
\`box 100 60 12\` · \`cylinder 20 30 at 50 30 12\` · \`sketch XY: rect 60 40; circle 20 at 10 5\` → \`extrude 10 cut\` · \`revolve 360 axis Y\`
\`fillet 2 edges vertical\` · \`chamfer 1 edges top\` · \`pattern 4 spacing 25 direction X\` · \`pattern circular 6 axis Z\` · \`mirror YZ\` · \`material steel\` · \`library M8x30\`
Sketch: \`constraint horizontal e1; perpendicular e1 e2\` · \`dim length e1 50\` · edits: \`edit "Box 1" size=120;60;12\` · \`suppress "Fillet 1"\` · \`delete last\` · \`variable t = 12\` · \`undo\`

## Holes and threads
\`hole 8.5 through at 20 30\` · \`hole thread M8 depth 20 at 50 30\` · \`hole 6.8 through at 10 10 counterbore 11 6.5\` · \`hole 10 depth 12 flat bottom at 40 20\` · \`thread M18x1.5 length 20 at 0 0 12 internal\`

## Assembly
\`insert "Plate" at 0 0 0 fix as "D1"\` · \`insert "Pin" at 20 30 12 as "K48"\` · \`assembly faces "K48"\` · \`assembly mate concentric "K48" Ø10 "D1" Ø10\` · \`assembly mate contact "K48" -Z "D1" top\` · \`assembly mates\` · \`assembly component "K48" alias "Pin A"\` · \`clash\` · \`bom\`

## Springs
\`spring compression d 2 De 20 L0 50 n 8\` (part from the table) · \`assembly spring new d 2 De 20 L0 35 n 6 between "D1" Ø21 "K48" bottom\` (“all holes” at the end = into every hole of the pattern) · \`assembly springs\` · \`assembly bolt "D1" Ø9\`

## Motion
\`motion motor linear mate 2 0..40 step 2 collisions\` · \`motion motor rotary "K48" 0..360 step 5\` · \`motion dynamics time 0.5 gravity -Z\` · \`motion mass "K48" 2.5\` · \`motion status\`

## Drawing
\`drawing A3 scale 1:2 views front,top,iso\` · \`drawing section XZ\` · \`dimension smart functional 26.5\` · \`drawing tolerance 26.5 h7\` · \`drawing titleblock template=iso7200 number="MN-1"\` · \`drawing general ISO 2768-mK\` · \`drawing bom yes\` · \`drawing detail front at 45 10 radius 5\` · \`drawing status\` · \`drawing export pdf all\`

## 2D drawing
\`2d new "Profile"\` · \`2d line 0,0 100,0 @0,50\` · \`2d circle 50,25 20\` · \`2d export dwg\`

## Outputs and links
\`save\` · \`export step\` · \`export step link\` · \`export script\` · \`share days 30\` · \`link\` (address again) · CLI \`--formats step,pdf,dxf\` and \`--share\`

## Checks
\`status\` · \`measure body\` · \`measure holes\` · \`check assembly\` · \`compare "ref.step" tolerance 0.05\` · \`reference "customer.dwg"\` · \`reference check dimensions\`

## Strict mode and help
\`strict\` (every ⚠ stops the run; CLI \`--strict\`) · \`strict off\` · \`help search spring between parts\` · \`help cheatsheet\` · \`feature help hole\` · \`undo\`
`;

const DE = `# Spickzettel für KI-Agenten – Mnástrojárna CAD

Ganze Anleitung: https://www.mnastrojarna.cz/cad/schema-pro-ai.md · Suche: \`hilfe suchen registerkarten\` · Feature-Felder: \`element hilfe bohrung\`
Ohne Browser: \`mncad run skript.txt --out out\` (\`--strict\`, \`--formats step,pdf\`, \`--json\`; Node 22, /cad/cli/) · im Browser \`await window.mncad.run(text)\`
Protokoll MNCAD/1: ✗ Fehler · ⚠ Warnung · ℹ Hinweis · = Auflistung · D Dokument · F Datei · O Link. mm und °, Z oben, \`#\` Kommentar, Zeilen und JSON mischbar.

## Dokumente und Registerkarten
\`neues teil "Platte"\` · \`neue baugruppe "Werkzeug"\` · \`registerkarten\` · \`registerkarte "Platte"\` · \`registerkarte schließen\` – jedes Teil = Registerkarte; eine Baugruppe fügt nur offene Registerkarten ein (erneutes Einfügen = weitere Instanz).
Große Baugruppe: jedes Teil als Block \`neues teil "…"\` → \`neue baugruppe "…"\` → \`einfügen "Platte" bei 100 0 0\` für jede Instanz → \`baugruppe\` (Komponentenliste, Anzahl) → \`stückliste\` (Stück je Quelle).

## Teil
\`quader 100 60 12\` · \`zylinder 20 30 bei 50 30 12\` · \`skizze XY: rechteck 60 40; kreis 20 bei 10 5\` → \`extrudieren 10 abziehen\` · \`drehen 360 achse Y\`
\`verrunden 2 kanten senkrecht\` · \`fase 1 kanten oben\` · \`muster 4 abstand 25 richtung X\` · \`muster kreisförmig 6 achse Z\` · \`spiegeln YZ\` · \`werkstoff stahl\` · \`normteil M8x30\`
Skizze: \`bedingung horizontal e1; senkrecht e1 e2\` · \`bemaßung länge e1 50\` · Änderungen: \`bearbeiten "Quader 1" size=120;60;12\` · \`unterdrücken "Verrundung 1"\` · \`löschen letzte\` · \`variable t = 12\` · \`rückgängig\`

## Bohrungen und Gewinde
\`bohrung 8,5 durch bei 20 30\` · \`bohrung gewinde M8 tiefe 20 bei 50 30\` · \`bohrung 6,8 durch bei 10 10 senkung 11 6,5\` · \`bohrung 10 tiefe 12 flacher grund bei 40 20\` · \`gewinde M18×1,5 länge 20 bei 0 0 12 innen\`

## Baugruppe
\`einfügen "Platte" bei 0 0 0 fixieren als "D1"\` · \`einfügen "Stift" bei 20 30 12 als "K48"\` · \`baugruppe flächen "K48"\` · \`baugruppe verknüpfung konzentrisch "K48" Ø10 "D1" Ø10\` · \`baugruppe verknüpfung kontakt "K48" -Z "D1" oben\` · \`baugruppe verknüpfungen\` · \`baugruppe komponente "K48" alias "Stift A"\` · \`kollision\` · \`stückliste\`

## Federn
\`feder druck d 2 De 20 L0 50 n 8\` (Teil aus der Tabelle) · \`baugruppe feder neu d 2 De 20 L0 35 n 6 zwischen "D1" Ø21 "K48" unten\` („alle bohrungen“ am Ende = in jede Bohrung des Musters) · \`baugruppe federn\` · \`baugruppe schraube "D1" Ø9\`

## Bewegung
\`bewegung antrieb linear verknüpfung 2 0..40 schritt 2 kollision\` · \`bewegung antrieb dreh "K48" 0..360 schritt 5\` · \`bewegung dynamik zeit 0,5 schwerkraft -Z\` · \`bewegung masse "K48" 2,5\` · \`bewegung status\`

## Zeichnung
\`zeichnung A3 maßstab 1:2 ansichten vorne,oben,iso\` · \`zeichnung schnitt XZ\` · \`bemaßen intelligent funktional 26,5\` · \`zeichnung toleranz 26,5 h7\` · \`zeichnung schriftfeld vorlage=iso7200 nummer="MN-1"\` · \`zeichnung allgemein ISO 2768-mK\` · \`zeichnung stückliste ja\` · \`zeichnung einzelheit vorne bei 45 10 radius 5\` · \`zeichnung status\` · \`zeichnung export pdf alle\`

## 2D-Zeichnung
\`2d neu "Profil"\` · \`2d linie 0,0 100,0 @0,50\` · \`2d kreis 50,25 20\` · \`2d exportieren dwg\`

## Ausgaben und Links
\`speichern\` · \`exportieren step\` · \`exportieren step link\` · \`export skript\` · \`freigeben tage 30\` · \`link\` (Adresse erneut) · CLI \`--formats step,pdf,dxf\` und \`--share\`

## Prüfen
\`status\` · \`messen körper\` · \`messen bohrungen\` · \`prüfen baugruppe\` · \`vergleichen "ref.step" toleranz 0,05\` · \`vorlage "kunde.dwg"\` · \`vorlage maße prüfen\`

## Strenger Modus und Hilfe
\`streng\` (jede ⚠ stoppt den Lauf; CLI \`--strict\`) · \`streng aus\` · \`hilfe suchen feder zwischen teilen\` · \`hilfe spickzettel\` · \`element hilfe bohrung\` · \`rückgängig\`
`;

export const AGENT_CHEATSHEET: Record<CheatLang, string> = { cs: CS, en: EN, de: DE };

/** úseky v `…`, které nejsou řádky skriptu (příkazová řádka, API, volby CLI, symboly protokolu) */
export const CHEATSHEET_NON_COMMAND = /^(mncad |node |npx |await |window\.|--|#$|https?:)/;

/** všechny řádky příkazů taháku v daném jazyce (obsah `…` mimo výjimky) */
export function cheatCommands(lang: CheatLang): string[] {
  return [...AGENT_CHEATSHEET[lang].matchAll(/`([^`]+)`/g)].map((m) => m[1]).filter((s) => !CHEATSHEET_NON_COMMAND.test(s));
}
