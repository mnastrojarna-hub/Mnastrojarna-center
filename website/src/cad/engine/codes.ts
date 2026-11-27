/**
 * Registr kódů hlášek protokolu (CAD-HEADLESS-NAVRH.md kap. 4.3 a 5.2).
 *
 * Kód je stabilní ASCII identifikátor `[a-z0-9]+([.-][a-z0-9]+)*`, stejný v cs/en/de – agent podle něj třídí, přísný
 * režim podle něj vynechává (`přísně kromě kód,…`). `level` je výchozí úroveň (✗ error, ⚠ warn, ℹ note); `key` je český
 * zdroj volného textu pro `tr()` (překlady v `scripts/i18n/{en,de}/21-protocol-ports.tsv` za řádkem `#!dynamic`, protože
 * se překládají přes `tr(def.key)`, ne literálem).
 *
 * Nový kód = nový řádek zde + řádky EN/DE v TSV; test `codes.test.ts` hlídá tvar, jedinečnost a překlady.
 */
import { tr } from "../i18n";
import type { Entry } from "./protocol-types";

export type CodeLevel = "error" | "warn" | "note";
/** `short` = ℹ, které stručný protokol vypíše i bez volby `notes` (převzetí záložky opakovaným během – protocol.ts) */
export type CodeDef = { code: string; level: CodeLevel; key: string; short?: true };

/** tvar kódu – shodně s gramatikou protokolu (kap. 4.2) */
export const CODE_RE = /^[a-z0-9]+(?:[.-][a-z0-9]+)*$/;

export const CODES = [
  // ── běh a hostitel (kap. 3.1, 2.1) ──
  { code: "run.timeout", level: "error", key: "časový limit {0} s vypršel" },
  { code: "run.memory", level: "error", key: "překročen limit paměti {0} MB" },
  { code: "run.crash", level: "error", key: "výpočet spadl: {0}" },
  { code: "run.interrupted", level: "error", key: "běh přerušen" },
  { code: "run.cancelled", level: "error", key: "výpočet zrušen – dokument zůstal beze změny" },
  // vlna 22, bod 12: zrušený běh, který už před zrušením zapsal jiný dokument (přechod `záložka` / `nový díl`) – nikdy „beze změny“
  { code: "run.cancelled-partial", level: "error", key: "výpočet zrušen – změny zapsané před zrušením zůstaly v {0}" },
  { code: "host.app-only", level: "error", key: "příkaz funguje jen v aplikaci v prohlížeči: {0}" },
  { code: "host.fonts", level: "error", key: "písma pro PDF a text modelu nejsou k dispozici" },
  { code: "ui.no-view", level: "note", key: "bez 3D okna nemá příkaz účinek: {0}" },
  { code: "session.history", level: "note", key: "historie zpět/znovu se v relaci neukládá" },
  { code: "file.missing", level: "error", key: "soubor „{0}“ není k dispozici – dostupné: {1}" },
  { code: "out.path", level: "error", key: "název souboru „{0}“ míří mimo výstupní složku" },
  { code: "out.renamed", level: "note", key: "soubor „{0}“ už existuje – uloženo jako „{1}“" },
  { code: "out.empty", level: "warn", key: "prázdný dokument – nezapsáno: {0}" },
  { code: "share.rejected", level: "error", key: "úložiště odkazů odmítlo zápis: {0}" },
  { code: "share.fallback-link", level: "warn", key: "krátký odkaz se nepodařil – použit dlouhý odkaz" },
  { code: "share.uncompressed", level: "note", key: "odkaz není komprimovaný (prostředí neumí deflate-raw)" },
  // vlna 22, bod 16: vypnuté úložiště je vidět (ℹ, ne tichý dlouhý odkaz) a ověření odkazu textem (`odkaz ověřit`)
  { code: "share.store-off", level: "note", short: true, key: "úložiště krátkých odkazů je vypnuté – dokument je celý v odkazu ({0} znaků)" },
  { code: "share.link-broken", level: "error", key: "odkaz se neotevře ({0}): {1}" },
  // ── výstupy textem (balík B3 outputs) ──
  { code: "share.store-unavailable", level: "error", key: "úložiště krátkých odkazů není dostupné: {0}" },
  { code: "share.long-link", level: "warn", key: "odkaz má {0} znaků – prohlížeč agenta v cloudu přijme nejvýš 4096; krátký odkaz dá „sdílet úložiště“" },
  { code: "share.days-clamped", level: "warn", key: "platnost odkazu zkrácena na {0} dní – úložiště dovolí nejvýš {0} (zadáno {1})" },
  { code: "share.days-unlimited", level: "error", key: "odkaz v úložišti musí mít omezenou platnost 1–{0} dní – zadejte „dní N“, nebo dlouhý odkaz „sdílet odkazem bez omezení“" },
  { code: "out.check-failed", level: "warn", key: "kontrola souboru: {0}" },
  // vlna 22, bod 22a (fáze 2): soubor STEP / BREP po zpětném načtení neprojde přesnou kontrolou platnosti, model ano
  { code: "out.reload-invalid", level: "warn", key: "soubor po zpětném načtení neprojde přesnou kontrolou platnosti: {0}" },
  // objemový export (STEP, BREP, STL, 3MF) bez tělesa / s plochami mimo tělesa – vlna 22, bod 22c (solid-export.ts)
  { code: "out.no-solid", level: "error", key: "objemový export bez tělesa: {0}" },
  { code: "out.free-surfaces", level: "warn", key: "objemový export s plochami mimo tělesa: {0}" },
  { code: "out.unsupported", level: "warn", key: "výstup {0} není k dispozici: {1}" },
  { code: "out.too-big", level: "error", key: "soubor „{0}“ má {1} B – jako base64 do protokolu nejvýš {2} B (soubor zapište bez „base64“)" },
  { code: "out.lost-imports", level: "warn", key: "projekt odkazuje na importované soubory bez dat: {0} – tyto prvky se nepostaví" },
  { code: "drawing.default-sheet", level: "warn", key: "dokument zatím nemá výkres – exportuje se výchozí list (vlastní list: „výkres A3 …“ a „kótovat“)" },
  // ── rozbor (5.2 č. 1–4, 6, 9, 10) ──
  { code: "parse.error", level: "error", key: "chyba zápisu: {0}" },
  { code: "parse.unknown", level: "error", key: "neznámý příkaz „{0}“" },
  { code: "parse.unused", level: "warn", key: "nevyužitá slova: {0}" },
  { code: "parse.coord-missing", level: "warn", key: "chybějící souřadnice doplněna nulou: {0}" },
  { code: "parse.axis", level: "error", key: "neznámá osa „{0}“" },
  { code: "parse.conflict", level: "warn", key: "odporující si volby – použito „{0}“, zahozeno „{1}“" },
  // ── provedení a stavba (5.2 č. 15–17, 21, 22, 24–28) ──
  { code: "op.failed", level: "error", key: "příkaz selhal: {0}" },
  // přijetí příkazu, který mění model nebo list – výsledek ✓/⚠/✗ přijde až po stavbě / vyhodnocení listu (vlna 22, bod 22i)
  { code: "op.accepted", level: "note", key: "příkaz přijat: {0}" },
  // stav modelu po tomto příkazu se samostatně nestavěl (následovala další změna) – výsledek „postaven“ smí nést jen řádek
  // poslední změny; mezistav je nezkontrolovaný, nikdy ✓
  { code: "op.superseded", level: "note", key: "stav modelu po tomto příkazu se samostatně nestavěl (následovala další změna) – ověřen je až stav po řádku {0}" },
  { code: "build.failed", level: "error", key: "stavba selhala: {0}" },
  { code: "feature.failed", level: "error", key: "prvek „{0}“ se nepostavil: {1}" },
  { code: "feature.warning", level: "warn", key: "prvek „{0}“: {1}" },
  // závity (vlna 22, body 22a a 22d): ⚠ prvku s vlastním kódem místo feature.warning – přísný režim je umí vynechat jmenovitě
  // (`přísně kromě thread.pitch-nonstandard`); text = hláška prvku (feat/thread-helix.ts, thread-spec.ts)
  { code: "thread.tip-tangent", level: "warn", key: "prvek „{0}“: {1}" },
  { code: "thread.no-reach", level: "warn", key: "prvek „{0}“: {1}" },
  { code: "thread.wrong-side", level: "warn", key: "prvek „{0}“: {1}" },
  { code: "thread.pitch-nonstandard", level: "warn", key: "prvek „{0}“: {1}" },
  { code: "feature.unverified", level: "warn", key: "prvek „{0}“ nebyl ověřen stavbou" },
  // prvek vznikl, ale platnost tělesa se po něm nekontrolovala (velké těleso) – nikdy ✓ (vlna 22, úrovně stavu prvku)
  { code: "feature.unchecked", level: "note", key: "prvek „{0}“: {1}" },
  // prvek je potlačený (přímo nebo aktivní konfigurací) – nestavěl se, nemá výsledek; nikdy ✓ (vlna 22, úrovně stavu prvku)
  { code: "feature.suppressed", level: "note", key: "prvek „{0}“ je potlačený – nestaví se (bez výsledku)" },
  // prvek sám je v pořádku, ale týž řádek (příkaz) má ⚠/✗ jiného prvku – řádek není zelený, proto ℹ místo ✓
  { code: "feature.built", level: "note", key: "prvek „{0}“ vznikl ({1}) – týž příkaz má ⚠/✗ jiného prvku" },
  // načtený dokument (JSON, otevřít, --open) se postavil bez ⚠/✗, ale platnost tělesa se nekontrolovala – nikdy ✓
  { code: "doc.unchecked", level: "note", key: "dokument „{0}“ postaven: prvků {1}, bez ⚠ a ✗ – {2}" },
  { code: "geom.approx", level: "note", key: "objem a hmotnost jsou přibližné (ze sítě)" },
  { code: "geom.volume-failed", level: "warn", key: "objem se nepodařilo změřit – uvedena 0" },
  // přesná kontrola platnosti před exportem STEP / BREP našla vadu (vlna 22, bod 22a – validity.ts)
  { code: "geom.exact-invalid", level: "warn", key: "těleso „{0}“ neprošlo přesnou kontrolou platnosti: {1}" },
  { code: "param.clamped", level: "warn", key: "hodnota {0} upravena na {1} ({2})" },
  { code: "mode.new-body", level: "note", key: "přidání bez tělesa – vytvořeno nové těleso" },
  { code: "json.id-renewed", level: "note", key: "duplicitní id prvku „{0}“ nahrazeno novým" },
  { code: "name.renamed", level: "warn", key: "název „{0}“ je obsazený – použit „{1}“" },
  { code: "name.renamed-auto", level: "note", key: "výchozí název očíslován: „{0}“" },
  { code: "tab.empty-replaced", level: "warn", key: "prázdná záložka „{0}“ nahrazena dokumentem „{1}“" },
  { code: "tab.settle-timeout", level: "error", key: "přepnutí záložky nedoběhlo do {0} s" },
  // ── opakovaný běh (vlna E, balík runs – agent-runs.ts, engine/ops/new.ts) ──
  { code: "doc.reused", level: "note", short: true, key: "záložka „{0}“ z dřívějšího běhu použita znovu – obsah nahrazen (novou záložku dá u nový díl / nová sestava volba „nový“)" },
  { code: "doc.name-taken", level: "note", short: true, key: "záložka „{0}“ už je otevřená, ale nezaložil ji stejný druh příkazu běhu (otevřený soubor, JSON, ruční práce) – dokument je v nové záložce (u nový díl / nová sestava ji převezme volba „znovu“)" },
  // ── díry a výběr (5.2 č. 5, 7, 8, 12, 13, 18, 38) ──
  { code: "hole.depth-default", level: "warn", key: "díra bez hloubky – vrtá se skrz" },
  { code: "hole.conflict", level: "warn", key: "zahloubení a kuželové zahloubení zároveň – použito {0}" },
  { code: "hole.cbore-dropped", level: "warn", key: "zahloubení Ø{0} se u díry se závitem {1} nepostaví" },
  { code: "hole.no-surface", level: "warn", key: "díra neleží na povrchu – umístěna na obálku tělesa" },
  { code: "hole.tap-diameter", level: "warn", key: "zadaný průměr {0} nahrazen průměrem vrtáku {1} pro závit {2}" },
  { code: "select.fallback", level: "warn", key: "plocha podle pravidla nenalezena – použita nejkrajnější" },
  { code: "select.ambiguous", level: "warn", key: "více vyhovujících ploch – použita první" },
  { code: "insert.name-ignored", level: "warn", key: "název instance „{0}“ se zatím neukládá" },
  // ── sestava, kolize, pohyb (5.2 č. 11, 19, 20, 29, 30, 40; kap. 6.3, 7, 9.2) ──
  { code: "asm.stale-copy", level: "warn", key: "komponenta je kopie dílu – pozdější změny dílu se nepromítnou" },
  // kusovník a dokumentace podle druhu položky (vlna 22, bod 19 – cad/bom-model.ts)
  { code: "bom.make-incomplete", level: "warn", key: "vyráběnému dílu chybí výkres, číslo nebo označení materiálu: {0}" },
  { code: "bom.docs", level: "note", key: "dokumentace: {0}" },
  { code: "asm.depth", level: "warn", key: "podsestavy hlubší než {0} úrovní se vynechají" },
  { code: "asm.faces-truncated", level: "warn", key: "díl „{0}“ má víc než {1} ploch – načteno jen prvních {1}" },
  { code: "asm.kernel-restarted", level: "note", key: "jádro se restartovalo – mezipaměti sestavy vyprázdněny" },
  { code: "asm.face-missing", level: "error", key: "plocha F{0} dílu „{1}“ není k dispozici" },
  // reference vazeb po změně historie dílu (vlna 22, bod 20 – cad/mate-remap.ts): ztracená = mimo řešení, nikdy tiché připojení jinam
  { code: "mate.lost", level: "error", key: "vazba {0} – ztracená reference {1}: vazba je mimo řešení a komponenty se kvůli ní nehýbou; {2}" },
  { code: "mate.renumbered", level: "note", key: "vazba {0}: {1} po úpravě dílu ({2})" },
  { code: "mate.restored", level: "note", key: "vazba {0}: ztracená reference {1} znovu nalezena jako {2} – vazba se zase řeší" },
  { code: "asm.instance-duplicate", level: "warn", key: "instance „{0}“ už v sestavě je" },
  { code: "clash.real", level: "warn", key: "kolize „{0}“ × „{1}“ ({2} mm³)" },
  { code: "clash.thread", level: "note", key: "šroub v závitu „{0}“ × „{1}“" },
  { code: "clash.underhead", level: "note", key: "prstenec pod hlavou šroubu „{0}“ × „{1}“" },
  { code: "clash.undetermined", level: "warn", key: "kolizi „{0}“ × „{1}“ nelze vyhodnotit" },
  // vlna 22, bod 5 (clash-rules.ts): numerický dotyk pod tolerancí a pracovní kontakt podle pravidla operace – počítají se, nejsou závadou
  { code: "clash.touch", level: "note", key: "dotyk „{0}“ × „{1}“ (průnik tenčí než tolerance dotyku)" },
  { code: "clash.work", level: "note", key: "pracovní kontakt „{0}“ × „{1}“ podle pravidla kolizí" },
  // vlna 22, bod 6 (motion-clearance.ts): vůle pod limitem v pohybu, kolize mezi polohami nepotvrzené, kontrola jen v polohách
  { code: "clash.clearance", level: "warn", key: "vůle „{0}“ × „{1}“ {2} mm < {3} mm" },
  { code: "clash.uncertain", level: "warn", key: "kolize mezi polohami nepotvrzeny v {0} úsecích – tam jen v polohách" },
  { code: "clash.discrete", level: "note", key: "kolize kontrolovány jen v {0} polohách (diskrétně) – mezi polohami nekontrolováno" },
  { code: "clash.stale", level: "warn", key: "výpis kolizí platí pro dřívější stav sestavy (zkontrolováno {0}) – spusťte „kolize“ znovu" },
  { code: "clash.hidden", level: "note", key: "skryté komponenty se nekontrolují ({0})" },
  { code: "clash.rechecked", level: "note", key: "kolize přepočítány pro konečný stav sestavy – sestava se po kontrole kolizí ({0}) změnila" },
  { code: "motion.conflict", level: "warn", key: "pohyb porušuje vazbu „{0}“ v kroku {1}" },
  // priorita tvrdých podmínek, motor na mezi, neplatné kroky, neurčená poloha, statický konflikt (vlna 22, body 2 a 8) – cad/motion-quasi.ts
  { code: "motion.motor-limit", level: "warn", key: "motor {0} stojí na mezi v krocích {1} – brání: {2}" },
  { code: "motion.invalid", level: "warn", key: "neřešitelné kroky {0} – zobrazena poslední platná poloha (krok {1}); konflikt: {2}" },
  { code: "motion.undetermined", level: "warn", key: "poloha „{0}“ není vazbami určena (volná v mezi {1})" },
  // vlna 22, body 3 a 10: fáze studie, motor nahrazený / v konfliktu už při definici
  { code: "motion.phase-unreached", level: "warn", key: "fáze „{0}“ nenastala: podmínka {1} se do konce studie nesplnila (nejbližší hodnota {2})" },
  { code: "motion.motor-conflict", level: "warn", key: "motor {0} je v konfliktu s motorem {1} – pohánějí tentýž stupeň volnosti od stejného okamžiku" },
  { code: "motion.motor-replaced", level: "note", key: "motor {0} na vazbě „{1}“ nahrazen novým zadáním" },
  // vlna 22, bod 4: procesní vrstva (střih / otisk jako geometrická aproximace – cad/motion-process.ts)
  { code: "motion.process-miss", level: "warn", key: "procesní operace {0}: nástroj „{1}“ obrobek „{2}“ v okně operace nezasáhl – obrobek beze změny" },
  { code: "motion.process-partial", level: "note", key: "procesní operace {0}: obrobek „{1}“ neprostřižen – hloubka {2} mm" },
  { code: "motion.process-between", level: "warn", key: "procesní operace {0}: nástroj „{1}“ mohl obrobek „{2}“ zasáhnout jen mezi kroky – mezipolohy nešly spočítat, výsledek procesu nezjištěn (jemnější kroky: pohyb kroky N)" },
  { code: "motion.process-approx", level: "note", key: "procesní operace {0}: booleovsky spočítáno {1} z {2} kroků se záběrem (strop výkonu) – mezikroky převzaty" },
  { code: "motion.process-failed", level: "warn", key: "procesní operace {0}: booleovská operace selhala ({1}) – výsledek jen do posledního platného stavu" },
  { code: "mate.conflict", level: "warn", key: "vazby nelze splnit spolu – polohy komponent beze změny; {0}" },
  // pružina po načtení dokumentu (vlna 22, bod 7): délka se odvozuje z dosedacích ploch – cad/asm-spring.ts springDrift
  { code: "spring.stale", level: "warn", key: "pružina „{0}“: uložená délka {1} neodpovídá dosedacím plochám ({2}) – délka odvozena z ploch" },
  // dosedací plocha pružiny, kterou díl nemá (po načtení dokumentu, `stav`): délka a síla nezkontrolovány – kolo 6 (cad/spring-lost.ts)
  { code: "spring.lost", level: "warn", key: "pružina „{0}“: ztracená dosedací plocha {1} – délka a síla nezkontrolovány; oprava: {2}" },
  // výsledek studie jen pro stav sestavy, pro který vznikl (vlna 22, bod 1); motory: rozsah × rychlost a začátek (body 9, 11) – cad/motor-model.ts
  { code: "motion.stale", level: "warn", key: "výsledek pohybové studie pro nynější stav sestavy neplatí – od výpočtu se změnilo: {0}; přepočítá ho „pohyb spustit“" },
  { code: "motion.recomputed", level: "note", key: "pohybová studie přepočítána – uložený výsledek neplatil, od výpočtu se změnilo: {0}" },
  { code: "motion.start-jump", level: "warn", key: "motor {0}: začátek {1} neodpovídá aktuální hodnotě vazby {2} – v kroku 0 díl přeskočí" },
  { code: "motion.motor-short", level: "warn", key: "motor {0} nedojede na konec: jízda trvá {1} s, studie má {2} s" },
  { code: "motion.gap-negative", level: "warn", key: "motor {0}: hodnota vazby „{1}“ klesne pod nulu ({2} mm) – plochy vazby se prostoupí a díly do sebe mohou vnikat; kolize se v této studii nekontrolují (pohyb kolize)" },
  { code: "motion.duration-extended", level: "warn", key: "délka studie prodloužena z {1} s na {2} s – motor {0} potřebuje na svůj rozsah {2} s (ostatní motory s rozsahem bez rychlosti tím zpomalí)" },
  { code: "motion.duration-set", level: "note", key: "délka studie změněna z {1} s na {2} s – určuje ji doba jízdy jediného motoru {0} (rozsah × rychlost)" },
  { code: "motion.end-unused", level: "warn", key: "motor {0}: uložený konec {1} se nepoužívá – motor jede bez koncové hodnoty, na konci studie je na {2}" },
  // ── měření, kontrola, porovnání, materiál (5.2 č. 31, 37; kap. 6) ──
  { code: "measure.truncated", level: "note", key: "vypsáno {0} z {1}" },
  { code: "check.hole-missing", level: "warn", key: "prvek díry „{0}“ nemá v geometrii díru" },
  { code: "check.invalid", level: "warn", key: "těleso dílu „{0}“ není platné (BRepCheck) – export STEP a výpočty mohou selhat" },
  { code: "compare.mismatch", level: "warn", key: "model se od reference liší: {0}" },
  { code: "compare.inexact", level: "note", key: "rozdílová tělesa nejsou spolehlivá (kontrola booleovských operací nesedí o {0} mm³) – shoda podle objemu a mapy odchylek" },
  { code: "material.density-assumed", level: "warn", key: "materiál „{0}“ zadán jen označením – hustota {1} g/cm³ ({2})" },
  { code: "material.class", level: "note", key: "materiál „{0}“ zařazen jako {1}" },
  // ── výkresy a předloha (5.2 č. 32, 33; kap. 8) ──
  { code: "drawing.warning", level: "warn", key: "list {0}: {1}" },
  { code: "drawing.section-miss", level: "warn", key: "rovina řezu neprotíná těleso: {0}" },
  /** odsazení řezu ve starším zápisu (souřadnice na ose) vyloženo postaru – automatický výklad vstupu (přísný režim = ✗) */
  { code: "drawing.section-legacy", level: "warn", key: "starší zápis odsazení řezu vyložen postaru: {0}" },
  { code: "drawing.overlap", level: "warn", key: "překryv na listu {0}: {1}" },
  // kusovník se na list nevejde ani ve sloupcích (vlna 22, bod 17) – rada: větší formát / kusovník na samostatném listu
  { code: "drawing.bom-overflow", level: "warn", key: "list {0}: {1}" },
  { code: "drawing.tolerance-missing", level: "warn", key: "kóta {0} nemá toleranci" },
  // kontrola kót pro výrobní úplnost (vlna 22, bod 18 – cad/dim-complete.ts): chybí velikost / poloha prvku; přetolerování (ℹ)
  { code: "drawing.dims-incomplete", level: "warn", key: "list {0}: {1}" },
  // ruční kóta po změně modelu neleží na geometrii / přichytila se ke změněné geometrii (vlna 22, bod 20 – cad/drawing-dim-attach.ts)
  { code: "drawing.dim-detached", level: "warn", key: "list {0}: {1}" },
  { code: "drawing.tol-nonfunctional", level: "note", key: "list {0}: přesná tolerance na rozměru, který není funkční – {1}" },
  // pravidla poznámek výkresu pro agenty (vlna 23, R1–R7 – cad/drawing-notes-rules.ts): příkaz agenta, který by je porušil,
  // skončí ✗ s radou; vyhodnocení listu je hlásí ✗ za text agenta (i z JSON / otevřeného dokumentu) a ℹ (rada) za ruční
  // text z GUI (úroveň u záznamu); export listu s porušením agenta se odmítne
  { code: "drawing.notes-limit", level: "error", key: "list {0}: poznámky nad razítkem – {1}" },
  { code: "drawing.note-style", level: "error", key: "list {0}: text není strojařsky heslovitý – {1}" },
  { code: "drawing.note-title-data", level: "error", key: "list {0}: údaj razítka mimo svou buňku razítka – {1}" },
  { code: "drawing.notes-sheet", level: "error", key: "list {0}: poznámky mimo hlavní list – {1}" },
  { code: "drawing.leaders-limit", level: "error", key: "list {0}: místních popisů je moc – {1}" },
  { code: "drawing.note-not-model", level: "warn", key: "list {0}: popis jen na výkrese, ne v modelu – {1}" },
  { code: "drawing.note-free-leader", level: "error", key: "list {0}: poznámka bez cíle v geometrii – {1}" },
  { code: "drawing.note-to-title", level: "note", key: "list {0}: přesunuto do razítka – {1}" },
  { code: "drawing.sheet-empty", level: "warn", key: "list {0}: {1}" },
  { code: "drawing.sheet-duplicate", level: "warn", key: "list {0}: {1}" },
  // popis plochy / oblastní úprava z modelu (vlna 23, R2 / R3): plocha se změnila, nebo ji žádný pohled neukazuje
  { code: "drawing.pmi-lost", level: "warn", key: "list {0}: {1}" },
  { code: "drawing.pmi-unplaced", level: "warn", key: "list {0}: {1}" },
  { code: "drawing.pmi-range", level: "warn", key: "list {0}: {1}" },
  // vydaný list ze starší revize modelu (vlna 22, bod 20 – cad/doc-outputs.ts); export se stejným písmenem v přísném režimu ✗
  { code: "drawing.stale", level: "warn", key: "vydaný výkres neodpovídá modelu: {0}" },
  { code: "reference.mismatch", level: "warn", key: "předloha se liší: {0}" },
  // ── náhradní kódy pro hlášky bez vlastního kódu (do přiřazení v balíku B4) ──
  { code: "msg.error", level: "error", key: "chyba: {0}" },
  { code: "msg.warn", level: "warn", key: "varování: {0}" },
  { code: "msg.note", level: "note", key: "poznámka: {0}" },
] as const satisfies readonly CodeDef[];

export type Code = (typeof CODES)[number]["code"];

const BY_CODE = new Map<string, CodeDef>(CODES.map((c) => [c.code, c]));

/** definice kódu (undefined = kód není v registru) */
export const codeDef = (code: string): CodeDef | undefined => BY_CODE.get(code);
export const isCode = (code: string): code is Code => BY_CODE.has(code);
/** kód ⚠ prvku: vlastní kód stavitele (`FeatureStatus.warnCode`, např. thread.tip-tangent), jinak `feature.warning` */
export const featureWarnCode = (s: { warnCode?: string }): Code => (s.warnCode && isCode(s.warnCode) && BY_CODE.get(s.warnCode)!.level === "warn" ? s.warnCode : "feature.warning");

/** náhradní kód pro záznam úrovně bez vlastního kódu (protokol vyžaduje kód u každého ✗/⚠/ℹ) */
export const fallbackCode = (level: CodeLevel): Code => (level === "error" ? "msg.error" : level === "warn" ? "msg.warn" : "msg.note");

/**
 * Výjimka s kódem protokolu: smyčka běhu ji zapíše jako ✗ s tímto kódem (ne `op.failed`) – např. ✗ `tab.settle-timeout`
 * z hostitele aplikace, když se přepnutí záložky nepromítlo do 5 s (5.2 č. 22).
 */
export class CodedError extends Error {
  constructor(
    readonly code: Code,
    readonly args: unknown[] = [],
  ) {
    super(tr(BY_CODE.get(code)!.key, ...args));
  }
}

/** lokalizovaný text kódu v aktuálním jazyce (`setLang`) */
export function codeText(code: Code, ...args: unknown[]): string {
  return tr(BY_CODE.get(code)!.key, ...args);
}

const escRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
/**
 * Argumenty `{0}`, `{1}`… zpět z textu záznamu podle textu kódu v aktuálním jazyce (`prvek „{0}“: {1}` → [název, hláška]);
 * null, když text neodpovídá šabloně (vlastní text záznamu, jiný jazyk). Slouží stručnému protokolu ke sloučení hlášek,
 * které se liší jen názvem prvku (protocol.ts `mergeSimilar`).
 */
export function codeArgs(code: string, text: string): string[] | null {
  const def = BY_CODE.get(code);
  if (!def) return null;
  const tpl = tr(def.key);
  const order: number[] = [];
  const src = tpl.split(/(\{\d+\})/).map((p) => {
    const m = /^\{(\d+)\}$/.exec(p);
    if (!m) return escRe(p);
    order.push(Number(m[1]));
    return "([\\s\\S]*?)";
  });
  const m = new RegExp(`^${src.join("")}$`).exec(text);
  if (!m) return null;
  const out: string[] = [];
  order.forEach((k, i) => (out[k] = m[i + 1]));
  return out;
}

export type CodeEntryInit = {
  line?: number | null;
  doc?: string;
  /** argumenty `{0}`, `{1}`… textu kódu */
  args?: unknown[];
  /** vlastní volný text místo textu kódu (už lokalizovaný) */
  text?: string;
  /** jiná úroveň než výchozí (např. `porovnat … přísně` → ✗) */
  level?: CodeLevel;
  data?: unknown;
};

/** Záznam protokolu s kódem z registru: úroveň z registru (nebo `level`), text `tr(key, …args)` v aktuálním jazyce. */
export function codeEntry(code: Code, o: CodeEntryInit = {}): Entry {
  const def = BY_CODE.get(code)!;
  const e: Entry = { line: o.line ?? null, level: o.level ?? def.level, code, text: o.text ?? tr(def.key, ...(o.args ?? [])) };
  if (o.doc !== undefined) e.doc = o.doc;
  if (o.data !== undefined) e.data = o.data;
  return e;
}
