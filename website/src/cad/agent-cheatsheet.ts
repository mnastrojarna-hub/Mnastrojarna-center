/**
 * Tahák pro AI agenty (≤ 5 kB na jazyk): nejčastější příkazy jako hotové řádky, které jdou rovnou do skriptu. Bez importů –
 * čte ho i Node skript scripts/cad-docs-text.mjs (public/cad/tahak.md, tahak.en.md, tahak.de.md a začátek
 * public/cad/schema-pro-ai.md). V konzoli `nápověda tahák` (EN `help cheatsheet`, DE `hilfe spickzettel`), v CLI `mncad help cheat`.
 *
 * Tahák je jeden souvislý příklad: příkazy v `…` jdou za sebou jako jeden skript (deska s dírami → čep → sestava
 * s pružinou a pohybem → výkres → výstupy → kontrola) a každý oddíl říká, ve které záložce pracuje. Mimo pořadí jsou jen
 * ukázky za slovem „Jinde:“ (EN „Elsewhere:“, DE „Sonst:“) – samostatné zápisy, které do tohoto příkladu nepatří –
 * a řádky se zástupným „…“. Testy: každý příkaz se přečte (agent-cheatsheet.test.ts) a celé pořadí proběhne ve skutečném
 * jádře bez ✗ a ⚠ v cs / en / de (agent-cheatsheet-kernel.test.ts).
 */

export type CheatLang = "cs" | "en" | "de";

const CS = `# Tahák pro AI agenty – Mnástrojárna CAD

Celý návod: https://www.mnastrojarna.cz/cad/schema-pro-ai.md · hledání: \`nápověda hledat záložky\` · pole prvku: \`prvek nápověda díra\`
Bez prohlížeče: \`mncad run skript.txt --out out\` (\`--strict\`, \`--formats step,pdf\`, \`--json\`, \`--timeout 300\`, \`--max-mem 2048\`; Node 22, /cad/cli/) · v prohlížeči \`await window.mncad.run(text)\`
Protokol MNCAD/1: ✗ chyba · ⚠ varování · ℹ poznámka · = výpis · D dokument · F soubor · O odkaz. mm a °, Z nahoru, \`#\` komentář, řádky a JSON lze míchat.
Příkazy taháku jdou za sebou jako jeden skript (deska → čep → sestava → výkres); za „Jinde:“ jsou samostatné ukázky.

## Dokumenty a záložky
\`nový díl "Deska"\` · \`nová sestava "Nástroj"\` · \`záložky\` · \`záložka "Deska"\` (další řádky patří jí) – každý díl = záložka; sestava vkládá jen otevřené záložky (další vložení = další instance). Jinde: \`zavřít záložku\`
Velká sestava: všechny díly jako bloky \`nový díl "…"\`, pak v záložce sestavy \`vložit "…" v 100 0 0\` pro každou instanci; počet komponent vypíše příkaz sestava, kusy kusovník.

## Díl (záložka „Deska“)
\`kvádr 100 60 12\` · \`skica XY: obdélník 30 18 roh 60 36\` · \`vazba pevně e1.c0\` · \`kóta délka e1.s0 30\` → \`vysunout 4 odebrat\`
\`zaoblit 2 hrany svislé\` · \`srazit 1 hrany horní\` · \`materiál ocel\` · \`proměnná t = 12\` · úpravy: \`upravit "Zaoblení 1" radius=3\` · \`potlačit "Sražení 1"\` · \`smazat poslední\`
Jinde: \`válec 20 30 v 50 30 12\` · \`skica XZ: obdélník 10 30 roh 0 0\` → \`rotovat 360 osa Z\` · \`pole kruhové 6 osa Z v 50 30 0\` · \`zrcadlit YZ\` · \`normálie M8x30\` · \`pružina tlačná d 2 De 20 L0 50 n 8\` (díl z tabulky) · \`zpět\` (jen mezi běhy – vrací celý běh, ne řádek)

## Díry a závity
\`díra 21 hloubka 8 dno ploché v 25 30\` · \`díra 9 skrz v 50 10\` · \`díra závit M8 hloubka 10 v 50 50\` · \`díra 6,8 skrz v 10 10 zahloubení 11 6,5\` · \`pole 2 rozteč 80 směr X\` · \`díra 16,5 skrz v 75 20\` · \`závit M18×1,5 délka 12 v 75 20 12 vnitřní\`
Kontrola dílu: \`stav\` · \`měřit těleso\` · \`měřit díry\` · \`kontrola\`

## Sestava (záložka „Nástroj“)
\`nový díl "Čep"\` · \`válec 20 30\` · \`záložka "Nástroj"\` · \`vložit "Deska" v 0 0 0 ukotvit jako "D1"\` · \`vložit "Čep" v 25 30 40\` · \`sestava komponenta #2 přezdívka "K48"\` · \`sestava\` (komponenty, počet) · \`sestava plochy "K48"\`
\`sestava vazba souosost "K48" Ø20 "D1" Ø21\` · \`sestava vazba vzdálenost "K48" -Z "D1" horní hodnota 20\` · \`sestava vazby\` · \`kolize\` · \`kusovník\` · \`kontrola sestava\`. Jinde: \`sestava vazba kontakt "K48" -Z "D1" horní\`

## Pružiny a pohyb
\`sestava pružina nová d 2 De 20 L0 35 n 6 mezi "D1" Ø21 "K48" spodní\` (na konci „do děr vzoru“ = do všech děr vzoru) · \`sestava pružiny\`
\`pohyb motor lineární vazba 2 20..12 krok 4 kolize\` (vazba 2 = Vzdálenost; motor nejde na Kontakt) · \`pohyb stav\` · \`pohyb dynamika čas 0,1 gravitace -Z\` · \`pohyb hmotnost "K48" 2,5\` · \`pohyb kinematika\`
Šroub do díry až po dynamice (volný díl by v gravitaci spadl): \`sestava šroub "D1" Ø9\`. Jinde: \`pohyb motor rotační "K48" 0..360 krok 5\`

## Výkres (záložka dílu)
\`záložka "Deska"\` · \`výkres A3 měřítko 1:1 pohledy přední,horní,iso\` · \`výkres řez XZ odsazení -30\` (rovina Y = 30; bez odsazení leží na stěně) · \`kótovat chytře funkční 100\` · \`výkres tolerance 100 ±0,05\` · \`výkres tolerance Ø21 H7\`
\`výkres razítko šablona=iso7200 číslo="MN-1"\` · \`výkres nepředepsané ISO 2768-mK\` · \`výkres list nový "Detail"\` · \`kótovat nic\` · \`výkres detail přední v 25 8 poloměr 6\` · \`výkres stav vše\` · \`výkres export pdf vše\`. Jinde (výkres sestavy): \`výkres kusovník ano\`

## Výstupy a odkazy
\`uložit\` · \`export step\` · \`export skript\` · \`sdílet\` · \`odkaz\` (adresa znovu) · v CLI \`--formats step,pdf,dxf\` a \`--share\`. Jinde (úložiště): \`sdílet dní 30\` · \`export step odkaz\`

## 2D výkres
\`2d nový "Profil"\` · \`2d čára 0,0 100,0 @0,50\` · \`2d kružnice 50,25 20\` · \`2d export dwg\`

## Kontrola proti předloze
Jinde (vstupní soubory, CLI --files): \`porovnat "ref.step" tolerance 0,05\` · \`předloha "zakaznik.dwg"\` · \`předloha kontrola kót\`

## Přísný režim a nápověda
\`přísně\` (každé ⚠ zastaví běh; CLI \`--strict\`) · \`přísně vyp\` · \`nápověda hledat pružina mezi díly\` · \`nápověda tahák\` · \`prvek nápověda díra\`
`;

const EN = `# Cheat sheet for AI agents – Mnástrojárna CAD

Full guide: https://www.mnastrojarna.cz/cad/schema-pro-ai.md · search: \`help search tabs\` · feature fields: \`feature help hole\`
Without a browser: \`mncad run script.txt --out out\` (\`--strict\`, \`--formats step,pdf\`, \`--json\`, \`--timeout 300\`, \`--max-mem 2048\`; Node 22, /cad/cli/) · in a browser \`await window.mncad.run(text)\`
Log MNCAD/1: ✗ error · ⚠ warning · ℹ note · = listing · D document · F file · O link. mm and °, Z up, \`#\` comment, lines and JSON can be mixed.
The commands of this sheet run one after another as one script (plate → pin → assembly → drawing); after “Elsewhere:” come independent samples.

## Documents and tabs
\`new part "Plate"\` · \`new assembly "Tool"\` · \`tabs\` · \`tab "Plate"\` (the next lines belong to it) – every part is a tab; an assembly inserts open tabs only (inserting again = another instance). Elsewhere: \`close tab\`
Large assembly: every part as a block \`new part "…"\`, then in the assembly tab \`insert "…" at 100 0 0\` for each instance; the assembly command lists the component count, bom the quantities.

## Part (tab “Plate”)
\`box 100 60 12\` · \`sketch XY: rect 30 18 corner 60 36\` · \`constraint fixed e1.c0\` · \`dim length e1.s0 30\` → \`extrude 4 cut\`
\`fillet 2 edges vertical\` · \`chamfer 1 edges top\` · \`material steel\` · \`variable t = 12\` · edits: \`edit "Fillet 1" radius=3\` · \`suppress "Chamfer 1"\` · \`delete last\`
Elsewhere: \`cylinder 20 30 at 50 30 12\` · \`sketch XZ: rect 10 30 corner 0 0\` → \`revolve 360 axis Z\` · \`pattern circular 6 axis Z at 50 30 0\` · \`mirror YZ\` · \`library M8x30\` · \`spring compression d 2 De 20 L0 50 n 8\` (part from the table) · \`undo\` (between runs only – undoes a whole run, not a line)

## Holes and threads
\`hole 21 depth 8 flat bottom at 25 30\` · \`hole 9 through at 50 10\` · \`hole thread M8 depth 10 at 50 50\` · \`hole 6.8 through at 10 10 counterbore 11 6.5\` · \`pattern 2 spacing 80 direction X\` · \`hole 16.5 through at 75 20\` · \`thread M18x1.5 length 12 at 75 20 12 internal\`
Part check: \`status\` · \`measure body\` · \`measure holes\` · \`check\`

## Assembly (tab “Tool”)
\`new part "Pin"\` · \`cylinder 20 30\` · \`tab "Tool"\` · \`insert "Plate" at 0 0 0 fixed as "D1"\` · \`insert "Pin" at 25 30 40\` · \`assembly component #2 alias "K48"\` · \`assembly\` (components, count) · \`assembly faces "K48"\`
\`assembly mate concentric "K48" Ø20 "D1" Ø21\` · \`assembly mate distance "K48" -Z "D1" top value 20\` · \`assembly mates\` · \`clash\` · \`bom\` · \`check assembly\`. Elsewhere: \`assembly mate contact "K48" -Z "D1" top\`

## Springs and motion
\`assembly spring new d 2 De 20 L0 35 n 6 between "D1" Ø21 "K48" bottom\` (“all holes” at the end = into every hole of the pattern) · \`assembly springs\`
\`motion motor linear mate 2 20..12 step 4 collisions\` (mate 2 = Distance; no motor on a Contact mate) · \`motion status\` · \`motion dynamics time 0.1 gravity -Z\` · \`motion mass "K48" 2.5\` · \`motion kinematics\`
Bolt into a hole only after the dynamics (a free part would fall under gravity): \`assembly bolt "D1" Ø9\`. Elsewhere: \`motion motor rotary "K48" 0..360 step 5\`

## Drawing (part tab)
\`tab "Plate"\` · \`drawing A3 scale 1:1 views front,top,iso\` · \`drawing section XZ offset -30\` (plane Y = 30; without the offset it lies on the face) · \`dimension smart functional 100\` · \`drawing tolerance 100 ±0.05\` · \`drawing tolerance Ø21 H7\`
\`drawing titleblock template=iso7200 number="MN-1"\` · \`drawing general ISO 2768-mK\` · \`drawing sheet new "Detail"\` · \`dimension none\` · \`drawing detail front at 25 8 radius 6\` · \`drawing status all\` · \`drawing export pdf all\`. Elsewhere (assembly drawing): \`drawing bom yes\`

## Outputs and links
\`save\` · \`export step\` · \`export script\` · \`share\` · \`link\` (address again) · CLI \`--formats step,pdf,dxf\` and \`--share\`. Elsewhere (storage): \`share days 30\` · \`export step link\`

## 2D drawing
\`2d new "Profile"\` · \`2d line 0,0 100,0 @0,50\` · \`2d circle 50,25 20\` · \`2d export dwg\`

## Check against a reference
Elsewhere (input files, CLI --files): \`compare "ref.step" tolerance 0.05\` · \`reference "customer.dwg"\` · \`reference check dimensions\`

## Strict mode and help
\`strict\` (every ⚠ stops the run; CLI \`--strict\`) · \`strict off\` · \`help search spring between parts\` · \`help cheatsheet\` · \`feature help hole\`
`;

const DE = `# Spickzettel für KI-Agenten – Mnástrojárna CAD

Ganze Anleitung: https://www.mnastrojarna.cz/cad/schema-pro-ai.md · Suche: \`hilfe suchen registerkarten\` · Feature-Felder: \`element hilfe bohrung\`
Ohne Browser: \`mncad run skript.txt --out out\` (\`--strict\`, \`--formats step,pdf\`, \`--json\`, \`--timeout 300\`, \`--max-mem 2048\`; Node 22, /cad/cli/) · im Browser \`await window.mncad.run(text)\`
Protokoll MNCAD/1: ✗ Fehler · ⚠ Warnung · ℹ Hinweis · = Auflistung · D Dokument · F Datei · O Link. mm und °, Z oben, \`#\` Kommentar, Zeilen und JSON mischbar.
Die Befehle dieses Spickzettels laufen nacheinander als ein Skript (Platte → Stift → Baugruppe → Zeichnung); nach „Sonst:“ stehen eigenständige Beispiele.

## Dokumente und Registerkarten
\`neues teil "Platte"\` · \`neue baugruppe "Werkzeug"\` · \`registerkarten\` · \`registerkarte "Platte"\` (die nächsten Zeilen gehören ihr) – jedes Teil = Registerkarte; eine Baugruppe fügt nur offene Registerkarten ein (erneutes Einfügen = weitere Instanz). Sonst: \`registerkarte schließen\`
Große Baugruppe: jedes Teil als Block \`neues teil "…"\`, dann in der Registerkarte der Baugruppe \`einfügen "…" bei 100 0 0\` für jede Instanz; der Befehl baugruppe listet die Komponentenzahl, stückliste die Stückzahlen.

## Teil (Registerkarte „Platte“)
\`quader 100 60 12\` · \`skizze XY: rechteck 30 18 ecke 60 36\` · \`bedingung fest e1.c0\` · \`bemaßung länge e1.s0 30\` → \`extrudieren 4 abziehen\`
\`verrunden 2 kanten senkrecht\` · \`fase 1 kanten oben\` · \`werkstoff stahl\` · \`variable t = 12\` · Änderungen: \`bearbeiten "Verrundung 1" radius=3\` · \`unterdrücken "Fase 1"\` · \`löschen letzte\`
Sonst: \`zylinder 20 30 bei 50 30 12\` · \`skizze XZ: rechteck 10 30 ecke 0 0\` → \`drehen 360 achse Z\` · \`muster kreisförmig 6 achse Z bei 50 30 0\` · \`spiegeln YZ\` · \`normteil M8x30\` · \`feder druck d 2 De 20 L0 50 n 8\` (Teil aus der Tabelle) · \`rückgängig\` (nur zwischen Läufen – nimmt einen ganzen Lauf zurück, keine Zeile)

## Bohrungen und Gewinde
\`bohrung 21 tiefe 8 flacher grund bei 25 30\` · \`bohrung 9 durch bei 50 10\` · \`bohrung gewinde M8 tiefe 10 bei 50 50\` · \`bohrung 6,8 durch bei 10 10 senkung 11 6,5\` · \`muster 2 abstand 80 richtung X\` · \`bohrung 16,5 durch bei 75 20\` · \`gewinde M18×1,5 länge 12 bei 75 20 12 innen\`
Teil prüfen: \`status\` · \`messen körper\` · \`messen bohrungen\` · \`prüfen\`

## Baugruppe (Registerkarte „Werkzeug“)
\`neues teil "Stift"\` · \`zylinder 20 30\` · \`registerkarte "Werkzeug"\` · \`einfügen "Platte" bei 0 0 0 fixieren als "D1"\` · \`einfügen "Stift" bei 25 30 40\` · \`baugruppe komponente #2 alias "K48"\` · \`baugruppe\` (Komponenten, Anzahl) · \`baugruppe flächen "K48"\`
\`baugruppe verknüpfung konzentrisch "K48" Ø20 "D1" Ø21\` · \`baugruppe verknüpfung abstand "K48" -Z "D1" oben wert 20\` · \`baugruppe verknüpfungen\` · \`kollision\` · \`stückliste\` · \`prüfen baugruppe\`. Sonst: \`baugruppe verknüpfung kontakt "K48" -Z "D1" oben\`

## Federn und Bewegung
\`baugruppe feder neu d 2 De 20 L0 35 n 6 zwischen "D1" Ø21 "K48" unten\` („alle bohrungen“ am Ende = in jede Bohrung des Musters) · \`baugruppe federn\`
\`bewegung antrieb linear verknüpfung 2 20..12 schritt 4 kollision\` (Verknüpfung 2 = Abstand; kein Antrieb auf Kontakt) · \`bewegung status\` · \`bewegung dynamik zeit 0,1 schwerkraft -Z\` · \`bewegung masse "K48" 2,5\` · \`bewegung kinematik\`
Schraube erst nach der Dynamik in die Bohrung (ein freies Teil fiele unter Schwerkraft): \`baugruppe schraube "D1" Ø9\`. Sonst: \`bewegung antrieb dreh "K48" 0..360 schritt 5\`

## Zeichnung (Registerkarte des Teils)
\`registerkarte "Platte"\` · \`zeichnung A3 maßstab 1:1 ansichten vorne,oben,iso\` · \`zeichnung schnitt XZ versatz -30\` (Ebene Y = 30; ohne Versatz liegt sie auf der Fläche) · \`bemaßen intelligent funktional 100\` · \`zeichnung toleranz 100 ±0,05\` · \`zeichnung toleranz Ø21 H7\`
\`zeichnung schriftfeld vorlage=iso7200 nummer="MN-1"\` · \`zeichnung allgemein ISO 2768-mK\` · \`zeichnung blatt neu "Detail"\` · \`bemaßen keine\` · \`zeichnung einzelheit vorne bei 25 8 radius 6\` · \`zeichnung status alle\` · \`zeichnung export pdf alle\`. Sonst (Baugruppenzeichnung): \`zeichnung stückliste ja\`

## Ausgaben und Links
\`speichern\` · \`exportieren step\` · \`export skript\` · \`freigeben\` · \`link\` (Adresse erneut) · CLI \`--formats step,pdf,dxf\` und \`--share\`. Sonst (Speicher): \`freigeben tage 30\` · \`exportieren step link\`

## 2D-Zeichnung
\`2d neu "Profil"\` · \`2d linie 0,0 100,0 @0,50\` · \`2d kreis 50,25 20\` · \`2d exportieren dwg\`

## Prüfen gegen eine Vorlage
Sonst (Eingabedateien, CLI --files): \`vergleichen "ref.step" toleranz 0,05\` · \`vorlage "kunde.dwg"\` · \`vorlage maße prüfen\`

## Strenger Modus und Hilfe
\`streng\` (jede ⚠ stoppt den Lauf; CLI \`--strict\`) · \`streng aus\` · \`hilfe suchen feder zwischen teilen\` · \`hilfe spickzettel\` · \`element hilfe bohrung\`
`;

export const AGENT_CHEATSHEET: Record<CheatLang, string> = { cs: CS, en: EN, de: DE };

/** úseky v `…`, které nejsou řádky skriptu (příkazová řádka, API, volby CLI, symboly protokolu) */
export const CHEATSHEET_NON_COMMAND = /^(mncad |node |npx |await |window\.|--|#$|https?:)/;
/** slovo, za kterým jsou na řádku samostatné ukázky mimo souvislý příklad */
export const CHEATSHEET_ELSEWHERE = /\b(?:Jinde|Elsewhere|Sonst)\b[^:`]*:/;

/** všechny řádky příkazů taháku v daném jazyce (obsah `…` mimo výjimky) */
export function cheatCommands(lang: CheatLang): string[] {
  return [...AGENT_CHEATSHEET[lang].matchAll(/`([^`]+)`/g)].map((m) => m[1]).filter((s) => !CHEATSHEET_NON_COMMAND.test(s));
}

/**
 * souvislý příklad taháku: příkazy v pořadí, jak jdou za sebou jako jeden skript – bez ukázek za „Jinde:“ a bez řádků
 * se zástupným „…“
 */
export function cheatSequence(lang: CheatLang): string[] {
  return split(lang).seq;
}

/** samostatné ukázky taháku (za „Jinde:“) v pořadí, jak jsou v taháku – stejné pořadí ve všech jazycích */
export function cheatElsewhere(lang: CheatLang): string[] {
  return split(lang).elsewhere;
}

function split(lang: CheatLang): { seq: string[]; elsewhere: string[] } {
  const seq: string[] = [];
  const elsewhere: string[] = [];
  const spans = (text: string) => [...text.matchAll(/`([^`]+)`/g)].map((m) => m[1]).filter((x) => !CHEATSHEET_NON_COMMAND.test(x) && !x.includes("…"));
  for (const line of AGENT_CHEATSHEET[lang].split("\n")) {
    const cut = CHEATSHEET_ELSEWHERE.exec(line);
    seq.push(...spans(cut ? line.slice(0, cut.index) : line));
    if (cut) elsewhere.push(...spans(line.slice(cut.index)));
  }
  return { seq, elsewhere };
}
