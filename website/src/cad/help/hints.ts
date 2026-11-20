/**
 * Slova, kterými se agent na příkaz ptá a která v jeho zápisu ani popisu nejsou (hledání v nápovědě – pole klíčových slov
 * řádku tabulky příkazů). `cmd` = začátek zápisu příkazu v AGENT_COMMANDS; slova česky, anglicky i německy. Obecná synonyma
 * (změnit ~ upravit, zjistit ~ měřit) patří do glosáře (glossary.ts), sem jen to, co se váže k jednomu příkazu.
 */
export const COMMAND_HINTS: readonly { cmd: string; kw: string }[] = [
  { cmd: "nový díl", kw: "založit vytvořit dokument create document erstellen anlegen" },
  { cmd: "záložky", kw: "přepnout přepnutí aktivní jiný dokument otevřené dokumenty switch activate another document open documents wechseln umschalten dokument" },
  { cmd: "sestava · sestava plochy", kw: "kolik komponent počet seznam komponent how many components count wie viele komponenten anzahl" },
  { cmd: "kusovník", kw: "export csv soubor seznam dílů počet kusů export file parts exportieren datei csv" },
  { cmd: "vložit \"", kw: "instance další druhá vícekrát znovu téhož dílu vložení poloha natočení second another instance again placement weitere instanz mehrfach" },
  { cmd: "sestava komponenta", kw: "přesunout posunout otočit skrýt odebrat smazat komponentu přezdívka move rotate hide remove delete component verschieben drehen ausblenden entfernen" },
  { cmd: "výkres [A4", kw: "formát listu papír orientace format paper size orientation blattformat papier ausrichtung" },
  { cmd: "výkres export pdf|dxf", kw: "export výkresu soubor pdf dxf dwg svg tisk print drawing file zeichnung datei drucken" },
  { cmd: "upravit <prvek>", kw: "změnit změna rozměr parametr hodnota existujícího prvku change size parameter value ändern maß wert" },
  { cmd: "měřit F3", kw: "zjistit průměry děr hloubka vůle mezera vzdálenost mezi díly find diameters clearance gap durchmesser spiel abstand" },
  { cmd: "smazat poslední · stav", kw: "hmotnost objem rozměry obálka přehled dokumentu poslední prvek mass weight volume size bounding box summary masse gewicht volumen" },
  { cmd: "sdílet", kw: "platnost expirace vyprší heslo expiry expires validity password gültigkeit ablauf passwort" },
  { cmd: "uložit", kw: "soubor mncad jiný název jméno save as file speichern unter datei" },
  { cmd: "export step", kw: "soubor step stl uložit model save file export datei" },
  { cmd: "otevřít \"", kw: "načíst import soubor step load import file laden importieren datei" },
  { cmd: "název …", kw: "hustota materiálu hmotnost density mass dichte" },
  { cmd: "zpět [N]", kw: "vrátit poslední krok příkaz undo last command step letzten schritt befehl" },
  { cmd: "zaoblit R [hrany", kw: "výběr hran pravidlem pravidlo select edges rule kanten regel" },
  { cmd: "kolize", kw: "průnik těles kontrola sestavy interference check collisions prüfen" },
  { cmd: "kontrola [díl", kw: "ověřit zkontrolovat díly sestavu verify check assembly parts" },
  { cmd: "přísně", kw: "přísný režim varování zastaví strict mode warnings stop strenger modus" },
  { cmd: "normálie", kw: "šroub matice podložka ložisko kolík z knihovny bolt screw nut washer bearing pin from library schraube mutter scheibe lager" },
  { cmd: "pohyb motor", kw: "zdvih pohyb simulace kolize při pohybu stroke travel simulation collisions hub simulation" },
  { cmd: "zobraz stínovaný", kw: "průhledné zobrazení modelu drátový model transparent wireframe display durchsichtig" },
];
