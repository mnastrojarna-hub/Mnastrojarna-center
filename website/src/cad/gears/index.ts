/**
 * KOLA A OZUBENÍ (vlna 19) – veřejné rozhraní balíku „core“. Jediná cesta importu pro UI i text: `@/cad/gears`.
 * Čistá matematika (žádné DOM, žádné jádro replicad) – běží v Node (testy), ve workeru i v hlavním vlákně (živý náhled).
 *
 * PRVKY ROZŠÍŘENÍ (`{ type: "ext", ext, data }`, registrované v `cad/ext/gears.ts`, všechny skryté na pásu karet – `hidden`):
 *   gear.spur · gear.helical · gear.herringbone · gear.internal · gear.rack · gear.bevel · gear.hypoid · gear.worm ·
 *   gear.wormwheel · gear.cycloid · gear.cyclodisc · gear.sprocket · gear.pulley · gear.ratchet     + akce `gear.table` (skrytá)
 *   Data = plochá tabulka klíč → hodnota; KAŽDÝ klíč je v `KINDS[druh].defaults()` (kromě odkazu polohy `positionRef`).
 *
 * JEDEN POPIS = JEDNA TABULKA: `KINDS[druh].rows` (`GearRow[]`) řídí tabulku průvodce, formulář úprav, automatický
 *   formulář (`rowsToParams` → `ExtDef.params`), obecný příkaz `prvek gear.* klíč=hodnota`, slova textové gramatiky
 *   (`row.words[jazyk]`, první = kanonické; `row.enumWords` = slova hodnot / příznaků; `KindDef.phrases` = složené zápisy
 *   `díra 20 pero`, `náboj 40 15 obě strany`, `díry 6 12 80`; `KindDef.positional` = volné tokeny: `kolo řetězové 08B`) a zápis
 *   dokument → skript. Slovo složeného zápisu smí být stejné jako slovo řádku jeho prvního klíče (zápis řádek zobecňuje);
 *   slovo s mezerou („obě strany“) = dva po sobě jdoucí tokeny. `row.when(data)` = řádek se ukáže jen někdy.
 *   Popisky (`label`, `hint`, `options[].l`) jsou česky nebo už přeložené podle jazyka při načtení modulu – při výpisu
 *   v jiném jazykovém kontextu je znovu protáhněte `tr()`.
 *
 * KLÍČE SPOLEČNÉ VŠEM DRUHŮM:
 *   `out`: "wheel" hotové kolo | "blank" polotovar (totéž bez zubů: soustružené tělo s nábojem, dírou, drážkou…)
 *          | "teeth" jen zubové mezery jako nástroj odebraný z aktivního tělesa (vyžaduje těleso; vnutí operaci Odebrat)
 *   `mode`: "new" | "add" | "cut" (parametr druhu `mode`, „new“ = Nové těleso)
 *   `position` [x, y, z] + `positionRef` (odkaz) + `axis` (směr, výchozí Z) + `turn` (° kolem osy)
 *   tělo kola: `b`, `bore`, `keyway`, `hubD`, `hubL`, `hubSide`, `setScrew`, `holesN`, `holesD`, `holesPcd`, `webT`, `chamfer`;
 *   `jn` = podíl kola na boční vůli (ztenčení zubu), `mateZ` a `aw` = jen do tabulky ozubení (vyplní režim Soukolí).
 *
 * MÍSTNÍ SOUSTAVA KAŽDÉHO KOLA před umístěním (závazná pro náhled, polohu soukolí i testy):
 *   čelní, šikmé, šípové, cykloidní, řetězové, řemenice, rohatka, šnekové kolo: osa +Z, zuby z ∈ [0, b], počátek = střed čela
 *     z = 0; ZUB 0 MÁ OSU NA +X v z = 0 (šnekové kolo: ve střední rovině z = b/2; řemenice: z = 0 je vnější líc dolní bočnice)
 *   vnitřní: totéž, na +X je MEZERA 0;   rohatka: na +X je HROT zubu 0
 *   hřeben: roztečná přímka podél +X ve výšce z = h − h_a nad dnem (dno z = 0), šířka y ∈ [0, b], mezera 0 má střed
 *     v x = p/2 (u šikmého hřebene v rovině y = 0), zuby x ∈ [0, n·p]
 *   kuželové, hypoidní: osa +Z míří od zadního (velkého) čela k vrcholu; počátek = průsečík os (kuželové: vrchol roztečného
 *     kužele), tělo má z < 0; zub 0 má osu na +X ve středu šířky ozubení
 *   šnek: osa +Z, závit z ∈ [0, L], čepy hřídele pod / nad; mezera závitu má ve středu délky střed na +X
 *   kotouč cykloreduktoru: střed v počátku, údolí na +X; věnec: střed roztečné kružnice čepů v počátku, čep 0 na +X
 *
 * FUNKCE:
 *   gearValidate(ext, data) → { ok, issues[] }   hlášky lidsky česky, `issue.key` = řádek tabulky; `ok` = bez chyby
 *   gearCompute(ext, data) → Record<string, number>   všechny odvozené rozměry (mm, rad)
 *   gearProfile(ext, data) → Profile2D   jmenovitý profil JEDNÉ rozteče (úsečky, přesné oblouky, křivky s body a derivacemi)
 *   profilePolyline(profile, tol) / profileSvgPath(profile, scale) → celý obrys pro náhled a miniatury
 *   gearDataRows(ext, data) → GearDataRow[]   tabulka ozubení (skupiny basic | geometry | check | pair), hodnoty už jako text
 *   gearTableText(name, ext, data) → string[]   tabulka ozubení jako řádky protokolu (`kolo tabulka`)
 *   gearSummary(feature) → string   jeden řádek pro `stav` ("" = prvek není kolo)
 *   gearTablesOf(doc) → GearTable[]   tabulky všech nepotlačených kol dílu (výkres)
 *   solvePair({ kind, values }) → PairResult   soukolí: řádky `PAIR_ROWS[kind]`; chybějící řádky doplní `pairDefaults(kind)`;
 *     zadaný převod `i` > 0 má přednost před `z2`; `jn` = celková boční vůle (0 = automaticky 0,04·mₙ); data kol obsahují
 *     jen klíče, které druh zná (každé kolo jde zapsat `prvek gear.* klíč=hodnota`)
 *   pairScript(result) → string[]   existující příkazy: nový díl · prvek gear.* · nová sestava · vložit · sestava vazba
 *   gearKeyValues(ext, data) → "klíč=hodnota …" jen pro klíče odlišné od výchozích (zápis `prvek gear.*`)
 *
 * SMYSL STOUPÁNÍ („hand“): válcová kola, šnek a šnekové kolo – pravý = pravotočivá šroubovice (zuby se s rostoucím z
 *   natáčejí proti směru hodin při pohledu z +Z); kuželová a hypoidní kola podle ISO 23509 / AGMA – pravý = vnější polovina
 *   zubu skloněná po směru hodin při pohledu na čelo od vrcholu. Hypoidní člen dostane smysl stopy z geometrie středního bodu
 *   (stopa ve směru skluzu), takže pastorek pravý ↔ talířové kolo levé vždy zabírají.
 *
 * TĚLESO V JÁDŘE (cad/ext/gears*.ts): hranolová kola = jedna plocha → jeden hranol; šroubová, kuželová a šneková kola =
 *   záplaty boků sešité do pláště (bez booleovských operací na zubech); boční odlehčení řetězového kola = jedna výseč + kruhové
 *   pole; plochy kola mají souosé válce (díra, náboj, čepy) jako první – vazba ozubení v sestavě najde díru i u kol s více
 *   než 400 plochami.
 *
 * PŘESNOST: evolventa, trochoida paty i cykloidy jsou kubické B-spliny proložené přesnými body v přirozeném parametru
 *   křivky se zadanými derivacemi na koncích (odchylka ≤ 4·10⁻⁵ mm u m = 10); co je u kterého druhu přiblížené, říká
 *   `KINDS[druh].accuracy` (jedna věta do nápovědy tabulky).
 */
export type * from "./types";
export { KINDS, GEAR_KINDS, kindOfExt, rowsToParams, withDefaults, type AnyKind } from "./registry";
export { gearValidate, gearCompute, gearProfile, gearDataRows, gearTableText, gearSummary, gearTablesOf, type GearTable } from "./data";
export { profilePolyline, profileSvgPath, polygonArea, segPoints, curveEval } from "./preview";
export { solvePair, PAIR_ROWS, pairDefaults, cylPair, autoBore, type CylPair } from "./pair";
export { pairScript, gearKeyValues, wheelFeatureName } from "./pair-script";
export { MODULES, CHAINS, CHAIN_NAMES, BELT_NAMES, SET_SCREWS } from "./tables";
export { RACKS } from "./rack";
