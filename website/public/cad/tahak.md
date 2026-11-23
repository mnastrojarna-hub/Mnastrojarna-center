# Tahák pro AI agenty – Mnástrojárna CAD

Celý návod: https://www.mnastrojarna.cz/cad/schema-pro-ai.md · hledání: `nápověda hledat záložky` · pole prvku: `prvek nápověda díra`
Bez prohlížeče: `mncad run skript.txt --out out` (`--strict`, `--formats step,pdf`, `--json`, `--timeout 300`, `--max-mem 2048`; Node 22, /cad/cli/) · v prohlížeči `await window.mncad.run(text)`
Protokol MNCAD/1: ✗ chyba · ⚠ varování · ℹ poznámka · = výpis · D dokument · F soubor · O odkaz. mm a °, Z nahoru, `#` komentář, řádky a JSON lze míchat.
Příkazy taháku jdou za sebou jako jeden skript (deska → čep → sestava → výkres); za „Jinde:“ jsou samostatné ukázky.

## Dokumenty a záložky
`nový díl "Deska"` · `nová sestava "Nástroj"` · `záložky` · `záložka "Deska"` (další řádky patří jí) – každý díl = záložka; sestava vkládá jen otevřené záložky (další vložení = další instance). Jinde: `zavřít záložku`
Velká sestava: všechny díly jako bloky `nový díl "…"`, pak v záložce sestavy `vložit "…" v 100 0 0` pro každou instanci; počet komponent vypíše příkaz sestava, kusy kusovník.

## Díl (záložka „Deska“)
`kvádr 100 60 12` · `skica XY: obdélník 30 18 roh 60 36` · `vazba pevně e1.c0` · `kóta délka e1.s0 30` → `vysunout 4 odebrat`
`zaoblit 2 hrany svislé` · `srazit 1 hrany horní` · `materiál 1.2379` · `proměnná t = 12` · úpravy: `upravit "Zaoblení 1" radius=3` · `potlačit "Sražení 1"` · `smazat poslední`
Jinde: `válec 20 30 v 50 30 12` · `skica XZ: obdélník 10 30 roh 0 0` → `rotovat 360 osa Z` · `pole kruhové 6 osa Z v 50 30 0` · `zrcadlit YZ` · `normálie M8x30` · `pružina tlačná d 2 De 20 L0 50 n 8` (díl z tabulky) · `zpět` (jen mezi běhy – vrací celý běh, ne řádek)

## Díry a závity
`díra 21 hloubka 8 dno ploché v 25 30` · `díra 9 skrz v 50 10` · `díra závit M8 hloubka 10 v 50 50` · `díra 6,8 skrz v 10 10 zahloubení 11 6,5` · `pole 2 rozteč 80 směr X` · `díra 16,5 skrz v 75 20` · `závit M18×1,5 délka 12 v 75 20 12 vnitřní`
Kontrola dílu: `stav` · `měřit těleso` · `měřit díry` · `kontrola`

## Sestava (záložka „Nástroj“)
`nový díl "Čep"` · `válec 20 30` · `materiál 1.0503` · `záložka "Nástroj"` · `vložit "Deska" v 0 0 0 ukotvit jako "D1"` · `vložit "Čep" v 25 30 40` · `sestava komponenta #2 přezdívka "K48" číslo "MN-2"` · `sestava komponenta "D1" číslo "MN-1"` · `sestava` (komponenty, počet) · `sestava plochy "K48"`
`sestava vazba souosost "K48" Ø20 "D1" Ø21` · `sestava vazba vzdálenost "K48" -Z "D1" horní hodnota 20` · `sestava vazby` · `kolize` · `kusovník` · `kontrola sestava`. Jinde: `sestava vazba kontakt "K48" -Z "D1" horní`

## Pružiny a pohyb
`sestava pružina nová d 2 De 20 L0 35 n 6 mezi "D1" Ø21 "K48" spodní` (na konci „do děr vzoru“ = do všech děr vzoru) · `sestava pružiny`
`pohyb motor lineární vazba 2 20..12 krok 4 kolize` (vazba 2 = Vzdálenost; motor nejde na Kontakt) · `pohyb stav` · `pohyb dynamika čas 0,1 gravitace -Z` · `pohyb hmotnost "K48" 2,5` · `pohyb kinematika`
Šroub do díry až po dynamice (volný díl by v gravitaci spadl): `sestava šroub "D1" Ø9`. Jinde: `pohyb motor rotační "K48" 0..360 krok 5`

## Výkres (záložka dílu)
`záložka "Deska"` · `výkres A3 měřítko 1:1 pohledy přední,horní,iso` · `výkres řez XZ odsazení -30` (rovina Y = 30; bez odsazení leží na stěně) · `kótovat chytře funkční 100` · `výkres tolerance 100 ±0,05` · `výkres tolerance Ø21 H7`
`výkres razítko šablona=iso7200` · `výkres nepředepsané ISO 2768-mK` · `výkres list nový "Detail"` · `kótovat nic` · `výkres detail přední v 25 8 poloměr 6` · `výkres stav vše` · `výkres export pdf vše`. Jinde (výkres sestavy): `výkres kusovník ano`

## Výstupy a odkazy
`uložit` · `export step` · `export skript` · `sdílet` · `odkaz` (adresa znovu) · v CLI `--formats step,pdf,dxf` a `--share`. Jinde (úložiště): `sdílet dní 30` · `export step odkaz`

## 2D výkres
`2d nový "Profil"` · `2d čára 0,0 100,0 @0,50` · `2d kružnice 50,25 20` · `2d export dwg`

## Kontrola proti předloze
Jinde (vstupní soubory, CLI --files): `porovnat "ref.step" tolerance 0,05` · `předloha "zakaznik.dwg"` · `předloha kontrola kót`

## Přísný režim a nápověda
`přísně` (každé ⚠ zastaví běh; CLI `--strict`) · `přísně vyp` · `nápověda hledat pružina mezi díly` · `nápověda tahák` · `prvek nápověda díra`
