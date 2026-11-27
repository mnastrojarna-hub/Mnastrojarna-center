/**
 * Vlna 22, balík A – test „žádné falešné zelené“ (zpráva majitele, priorita 1). Pro každý úspěšný text, kterého se
 * balík A dotkl, je tu případ, kdy se NESMÍ vypsat: kontrola neproběhla, proběhla nad jiným dokumentem / jiným stavem,
 * nebo nevyšla. Skutečné jádro in-process, engine stejný jako v prohlížeči a v CLI.
 *
 * Inventář zelených textů etapy A1 (bod 1) a podmínka, za které smějí být vidět:
 *  1. panel Kolize „Bez kolizí ✓“                – jen stav `ok`: záznam aktivního dokumentu, otisk = zobrazený stav sestavy
 *  2. `stav` „Kolize: žádný průnik · vůle nekontrolována (zkontrolováno …)“ (do vlny 22 C2 „Kolize: žádné“) – bez dovětku
 *     „NEPLATÍ“ jen při shodném otisku; jiná sestava „nezkontrolováno“
 *  3. `= … status … clash=0`                     – bez `clash.stale=1` jen při shodném otisku; jiná sestava `clash=-`
 *  4. řádek D `clash=0(…)`                       – vždy pro konečný stav sestavy (přepočet ℹ clash.rechecked)
 *  5. `stav` „Vazby: N (N ok)“ / `mates=N/N`     – jen pro nynější stav sestavy; jinak přepočet, a neodpovídají-li polohy
 *                                                  v dokumentu, „NEPLATÍ“ + `mates.stale=1` + D `stale=mates`
 *  6. `sestava vazby` „… – ok“                   – nad sestavou s neodpovídajícími polohami vždy s ⚠ „platí až po přepočtu“
 *  7. `= … measure …` (čísla měření)             – po změně dokumentu `stav` „Měření … NEPLATÍ“ + `measure.stale=1` + D `stale=measure`
 *  8. `= … compare … ok=1`                       – po změně dokumentu `stav` „Porovnání … NEPLATÍ“ + `compare.stale=1` + D `stale=compare`
 * (GUI: zelená tečka vazby, řádky měření a barevná mapa porovnání – tatáž pravidla, hlídá je e2e cad-w22-a.e2e.cjs.)
 *
 * Etapa A2 (bod 20 – reference vazeb po změně dílu, 22i – souhrn `sestava hotovo`):
 *  9. `✓ „…“ vrácen do sestavy … · vazby N/N ok` – jen když se žádná reference neztratila, všechny vazby platí a díl se postavil;
 *     ztracená plocha = „→ … – stav vazeb níže“ + ✗ mate.lost, `sestava vazby` „ztracená reference“ (nikdy „– ok“),
 *     `mates=0/1(lost=1)` ve `stav` i v řádku D, komponenta stojí (GUI „Zpět do sestavy“ = táž funkce – e2e cad-w22-a2.e2e.cjs)
 *
 * Etapa A3 (bod 12 – identita a zrušení běhů, 22h – export jako úloha):
 * 10. ✓ řádků skriptu / `MNCAD/1 OK` / stav běhu „dokončeno“ – nikdy u zrušeného běhu: zrušený běh = ✗ run.cancelled,
 *     žádné ✓ za neprovedené řádky, `run.state` „cancelled“, dokument beze změny
 * 11. `✓ kontrola STEP …` / F `check=ok` – jen když kontrola zpětným načtením opravdu proběhla nad TÍMTO souborem (export
 *     `bez kontroly` = žádné ✓ kontroly ani `check=`); i export z menu ukazuje ✓ jen s výsledkem kontroly (export-run.test.ts)
 *
 * Etapa A4 (bod 16 – ověření odkazu, bod 21 – softwarové zobrazení):
 * 12. `✓ odkaz se otevře …` / `= … link … ok=1` – jen když se odkaz opravdu otevřel a dokument prošel kontrolou; useknutý,
 *     změněný nebo nerozpoznaný odkaz = ✗ share.link-broken s důvodem a `ok=0`, nikdy ✓ (a useknutý není „nesprávné heslo“)
 * 13. horní lišta bez WebGL: stav prostředí není zelený ani „OCCT · připraveno“ na jeho místě – stav jádra je samostatný
 *     (`[data-core-status]`, e2e cad-nowebgl.e2e.cjs); `softStatusText` nikdy neříká, že 3D běží
 */
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import { setLang } from "../i18n";
import { setHostAssets } from "../host-assets";
import { makeKernelClient } from "../kernel-client";
import { memoryFileSink, memoryFileSource, type EngineHost, type FileSource } from "../engine/host";
import { MemoryWorkspace } from "../engine/memory-workspace";
import { formatConsole, formatShort } from "../engine/protocol";
import { runReport } from "../engine/run-protocol";
import { runScript } from "../engine/run";
import type { CadDoc } from "../types";

const WASM = path.resolve(__dirname, "../../../node_modules/replicad-opencascadejs/dist/replicad_single.wasm");
const FONTS = path.resolve(__dirname, "../../../public/fonts");

const PARTS = `nový díl "Deska A"
kvádr 60 40 10
nový díl "Přidržovač"
kvádr 10 10 10
`;
const statusLines = (text: string) => text.split("\n").filter((l) => /^= L\d+ status /.test(l));
const dLine = (text: string, name: string) => text.split("\n").find((l) => l.startsWith(`D "${name}" `)) ?? "";

describe("vlna 22 A: žádné falešné zelené (bod 1 – zastaralé výsledky)", async () => {
  setLang("cs");
  setHostAssets({ font: async (name) => new Uint8Array(fs.readFileSync(path.join(FONTS, name))).buffer });
  const { inProcessTransport } = await import("../kernel-inprocess");
  const kernel = makeKernelClient(inProcessTransport({ locateFile: (file) => (file.endsWith(".wasm") ? WASM : file) }));
  await kernel.init();
  const hostOf = (inputs: FileSource = memoryFileSource({})): EngineHost => ({ kernel, files: memoryFileSink(), inputs, now: () => Date.now() });
  /** text konzole posledního běhu `short` (lokalizované řádky stavu – strojová část je ve stručném protokolu) */
  let con = "";
  /** stručný protokol se všemi řádky (bez rozpočtu); text konzole téhož běhu je v `con` */
  const short = async (ws: MemoryWorkspace, text: string, inputs?: FileSource) => {
    const r = await runReport(ws, text, hostOf(inputs));
    con = formatConsole(r);
    return formatShort(r, { budget: Infinity, notes: true });
  };

  it("1. panel Kolize: zelený titulek jen pro stav ok – nezkontrolováno / neplatí / kolize ho nikdy nemají", async () => {
    const { clashHeader, clashNote, clashTitle } = await import("../../components/cad/clash-view");
    const { clashStateOf } = await import("../engine/result-key");
    // vlna 22, bod 6 (C2): stav ok = bez průniku, ne „bez kolizí ✓“ (vůle se nekontroluje) – text vědomě změněn
    expect(clashTitle("ok", 0)).toBe("Bez průniku · vůle nekontrolována");
    for (const st of ["unchecked", "stale", "clash"] as const) {
      expect(clashTitle(st, 2)).not.toMatch(/✓|Bez kolizí|Bez průniku/);
    }
    expect(clashTitle("unchecked", 0)).toBe("Kolize: nezkontrolováno");
    expect(clashTitle("stale", 0)).toBe("Kolize: neplatí");
    expect(clashNote("stale")).toMatch(/Neplatí – sestava se od kontroly změnila/);
    expect(clashNote("unchecked")).toMatch(/^Nezkontrolováno/);
    expect(clashNote("ok")).toBeNull();
    // stav se odvozuje jen z otisku: kontrola neproběhla / proběhla nad jiným stavem / záznam bez otisku → nikdy ok
    expect(clashStateOf(undefined, "s")).toBe("unchecked");
    expect(clashStateOf({ res: [], sig: "jiný stav" }, "s")).toBe("stale");
    expect(clashStateOf({ res: [] }, "s")).toBe("stale");
    // hlavička říká, pro co výsledek platí: dokument, počet komponent, čas, revize, poloha
    const head = clashHeader({ res: [], at: "10:15:00", comps: 2 }, { kind: "clash", doc: "k", sig: "s", rev: "r·a1b2c3", name: "Sestava A", pose: "doc" }, "?");
    expect(head).toBe("„Sestava A“ · 2 komponent · 10:15:00 · r·a1b2c3 · poloha z dokumentu");
    expect(clashHeader({ res: [], at: "10:15:00", comps: 2 }, { kind: "clash", doc: "k", sig: "s", rev: "r·a1b2c3", name: "Sestava A", pose: "step" }, "?")).toMatch(/zobrazený krok pohybové studie$/);
  });

  it("2.–4. kolize textem: výsledek sestavy A se nepřenese na B; po posunu komponenty NEPLATÍ; řádek D je pro konečný stav", async () => {
    const ws = new MemoryWorkspace();
    const out = await short(
      ws,
      `${PARTS}nová sestava "Sestava A"
vložit "Deska A" ukotvit
vložit "Přidržovač" v 40 10 30
kolize
stav
nová sestava "Sestava B"
vložit "Deska A" ukotvit
vložit "Přidržovač" v 40 10 5
stav
záložka "Sestava A"
sestava komponenta "Přidržovač" v 40 10 5
stav`,
    );
    const st = statusLines(out);
    // A zkontrolována bez kolizí → zelený výsledek smí být u A
    expect(st[0]).toMatch(/status "Sestava A" .* clash=0$/);
    expect(con).toMatch(/Kolize: žádný průnik · vůle nekontrolována \(zkontrolováno [^)]+\)$/m);
    // B (kde přidržovač do desky zasahuje) nikdy kontrolována nebyla → žádné clash=0, žádné „Kolize: žádné“
    expect(st[1]).toMatch(/status "Sestava B" .* clash=-$/);
    expect(con).toMatch(/Kolize: nezkontrolováno/);
    // A po posunu do kolize: starý výsledek jen s označením neplatnosti
    expect(st[2]).toMatch(/status "Sestava A" .* clash=0 clash\.stale=1$/);
    // poslední výpis stavu v konzoli (závěrečný stav sestavy A)
    const lastStatus = con.slice(con.lastIndexOf("Dokument: „Sestava A“"));
    expect(lastStatus).toMatch(/Kolize: žádný průnik · vůle nekontrolována \(zkontrolováno [^)]+\) – NEPLATÍ: sestava se od kontroly změnila/);
    expect(lastStatus).not.toMatch(/Kolize: žádný průnik · vůle nekontrolována \(zkontrolováno [^)]+\)$/m);
    // řádek D: kolize přepočítány pro konečný stav – ne clash=0 z dřívější kontroly
    expect(dLine(out, "Sestava A")).toMatch(/ clash=1\(thread=0,real=1\)$/);
    expect(dLine(out, "Sestava A")).not.toMatch(/stale=/); // po přepočtu už nic zastaralého
    expect(dLine(out, "Sestava B")).not.toMatch(/clash=/); // B bez kontroly = bez údaje o kolizích
    expect(out).toMatch(/^ℹ L- clash\.rechecked "Sestava A"/m);
  }, 240_000);

  it("2.–4. kolize: změna KONFIGURACE dílu v sestavě (polohy stejné) zneplatní zelený výsledek; řádek D je pro konečný stav", async () => {
    const ws = new MemoryWorkspace();
    // deska s výstupkem pod přidržovačem; konfigurace „Bez výstupku“ ho potlačí → sestava bez kolize
    const out = await short(
      ws,
      `nový díl "Deska K"
kvádr 60 40 10
kvádr 10 10 30 v 40 10 10
konfigurace "Bez výstupku" potlačit "Kvádr 2"
konfigurace aktivní "Bez výstupku"
nový díl "Přidržovač"
kvádr 10 10 10
nová sestava "Sestava K"
vložit "Deska K" ukotvit
vložit "Přidržovač" v 40 10 30
kolize
stav
sestava upravit "Deska K"
konfigurace aktivní žádná
sestava hotovo
stav`,
    );
    const st = statusLines(out);
    expect(st[0]).toMatch(/status "Sestava K" .* clash=0$/); // konfigurace bez výstupku: zkontrolováno, bez kolize
    // jiná konfigurace téhož dílu (výstupek zasahuje do přidržovače), polohy komponent beze změny → žádné platné clash=0
    expect(st[1]).toMatch(/status "Sestava K" .* clash=0 clash\.stale=1$/);
    const lastStatus = con.slice(con.lastIndexOf("Dokument: „Sestava K“"));
    expect(lastStatus).toMatch(/Kolize: žádný průnik · vůle nekontrolována \(zkontrolováno [^)]+\) – NEPLATÍ: sestava se od kontroly změnila/);
    expect(dLine(out, "Sestava K")).toMatch(/ clash=1\(thread=0,real=1\)$/);
    expect(out).toMatch(/^ℹ L- clash\.rechecked "Sestava K"/m);
  }, 240_000);

  it("5. vazby: po kroku zpět platí stav pro vrácený dokument (ne stav z doby před krokem zpět)", async () => {
    const ws = new MemoryWorkspace();
    await runScript(
      ws,
      `${PARTS}nová sestava "Sestava A"
vložit "Deska A" ukotvit
vložit "Přidržovač" v 40 10 30
sestava vazba vzdálenost "Přidržovač" spodní "Deska A" horní hodnota 20
sestava ukotvit "Přidržovač"`,
      hostOf(),
    );
    // posun ukotvené komponenty mimo vazbu = konflikt (zapsáno do historie)
    const moved = await short(ws, `sestava komponenta "Přidržovač" v 40 10 55\nstav`);
    expect(statusLines(moved)[0]).toMatch(/ mates=0\/1\(conflict=1\) /);
    // krok zpět: dokument je zpět ve splněném stavu → stav vazeb se nesmí vzít z doby konfliktu
    const undone = await short(ws, `zpět\nstav`);
    expect(statusLines(undone)[0]).toMatch(/ mates=1\/1 /);
    expect(statusLines(undone)[0]).not.toMatch(/stale/);
    // krok znovu: dokument je zase v konfliktu → žádné mates=1/1 z předchozího stavu
    const redone = await short(ws, `znovu\nstav`);
    expect(statusLines(redone)[0]).toMatch(/ mates=0\/1\(conflict=1\) /);
    expect(statusLines(redone)[0]).not.toMatch(/ mates=1\/1 /);
    expect(dLine(redone, "Sestava A")).toMatch(/ mates=0\/1\(conflict=1\) /);
  }, 240_000);

  it("5.–6. vazby: polohy v dokumentu vazbám neodpovídají → „ok“ jen s NEPLATÍ, mates.stale=1, D stale=mates, výpis s ⚠", async () => {
    const ws = new MemoryWorkspace();
    await runScript(
      ws,
      `${PARTS}nová sestava "Sestava A"
vložit "Deska A" ukotvit
vložit "Přidržovač" v 40 10 30
sestava vazba vzdálenost "Přidržovač" spodní "Deska A" horní hodnota 20`,
      hostOf(),
    );
    // tentýž dokument s polohou přepsanou mimo řešič (ruční JSON): vazba 20 mm, přidržovač o 25 mm výš
    const doc = JSON.parse(JSON.stringify(ws.present())) as CadDoc;
    const pusher = doc.components!.find((c) => c.name === "Přidržovač")!;
    pusher.placement.position = [40, 10, 55];
    const ws2 = new MemoryWorkspace();
    const out = await short(ws2, `${JSON.stringify({ ...doc, name: "Sestava J" })}\nstav\nsestava vazby`);
    const st = statusLines(out)[0];
    expect(st).toMatch(/status "Sestava J" .* mates\.stale=1$/);
    expect(con).toMatch(/Vazby: 1 \(1 ok\) – NEPLATÍ pro polohy v dokumentu/);
    expect(con).not.toMatch(/Vazby: 1 \(1 ok\)$/m);
    expect(out).toMatch(/polohy v dokumentu vazbám neodpovídají – uvedený stav vazeb platí až po přepočtu, který by posunul: „Přidržovač“ poloha \[40; 10; 30\]/);
    expect(dLine(out, "Sestava J")).toMatch(/ stale=mates$/);
    // po skutečném přepočtu (změna vazby zapíše polohy) je stav platný a nic zastaralého nezbývá
    const fixed = await short(ws2, `sestava vazba 1 hodnota 20\nstav`);
    expect(statusLines(fixed)[0]).toMatch(/ mates=1\/1 /);
    expect(statusLines(fixed)[0]).not.toMatch(/stale/);
    expect(dLine(fixed, "Sestava J")).not.toMatch(/stale=/);
  }, 240_000);

  it("7. měření: po změně dílu stav hlásí NEPLATÍ + measure.stale=1 a řádek D stale=measure; nové měření to zruší", async () => {
    const ws = new MemoryWorkspace();
    const out = await short(ws, `nový díl "Deska A"\nkvádr 60 40 10\nměřit těleso\nstav\nkvádr 10 10 30 v 0 0 10\nstav`);
    const st = statusLines(out);
    expect(st[0]).not.toMatch(/stale/); // hned po měření platí
    expect(st[1]).toMatch(/ measure\.stale=1$/);
    expect(con).toMatch(/Měření: výsledek L3 je pro revizi r·[0-9a-f]{6} – NEPLATÍ: dokument se od té doby změnil/);
    expect(dLine(out, "Deska A")).toMatch(/ stale=measure$/);
    const again = await short(ws, `měřit těleso\nstav`);
    expect(statusLines(again)[0]).not.toMatch(/stale/);
    expect(con).not.toMatch(/NEPLATÍ/);
    expect(dLine(again, "Deska A")).not.toMatch(/stale=/);
    // jiný dokument: měření dílu A se k němu nevztahuje
    const other = await short(ws, `nový díl "Přidržovač"\nkvádr 10 10 10\nstav`);
    expect(statusLines(other)[0]).not.toMatch(/stale/);
  }, 240_000);

  it("8. porovnání s referencí: ok=1 platí jen pro porovnanou revizi – po změně compare.stale=1 a D stale=compare", async () => {
    const ws0 = new MemoryWorkspace();
    await runScript(ws0, `nový díl "Deska A"\nkvádr 60 40 10`, hostOf());
    const inputs = memoryFileSource({ "deska.step": new Uint8Array(await kernel.exportFile(ws0.present(), "step")) });
    const ws = new MemoryWorkspace();
    const out = await short(ws, `nový díl "Deska A"\nkvádr 60 40 10\nporovnat "deska.step" tolerance 0,05\nstav\nkvádr 10 10 30 v 0 0 10\nstav`, inputs);
    expect(out).toMatch(/^= L3 compare "Deska A" ref=deska\.step ok=1 /m);
    const st = statusLines(out);
    expect(st[0]).not.toMatch(/stale/);
    expect(st[1]).toMatch(/ compare\.stale=1$/);
    expect(con).toMatch(/Porovnání s referencí: výsledek L3 je pro revizi r·[0-9a-f]{6} – NEPLATÍ/);
    expect(dLine(out, "Deska A")).toMatch(/ stale=compare$/);
    // nové porovnání změněného dílu: žádné ok=1, žádné stale – rozdíl se hlásí ⚠
    const again = await short(ws, `porovnat "deska.step" tolerance 0,05\nstav`, inputs);
    expect(again).toMatch(/ compare "Deska A" ref=deska\.step ok=0 /);
    expect(again).toMatch(/^⚠ L1 compare\.mismatch/m);
    expect(dLine(again, "Deska A")).not.toMatch(/stale=/);
  }, 240_000);

  it("strojová část je stejná v cs / en / de; text neplatnosti přeložen (EN NOT VALID, DE UNGÜLTIG)", async () => {
    const script = `nový díl "Deska A"\nkvádr 60 40 10\nměřit těleso\nkvádr 10 10 30 v 0 0 10\nstav`;
    try {
      const kv: string[] = [];
      for (const [lang, word] of [["cs", "NEPLATÍ"], ["en", "NOT VALID"], ["de", "UNGÜLTIG"]] as const) {
        setLang(lang);
        const ws = new MemoryWorkspace();
        const r = await runReport(ws, script, hostOf());
        const text = formatShort(r, { budget: Infinity });
        kv.push(statusLines(text)[0].replace(/^= L\d+ /, ""));
        expect(formatConsole(r)).toContain(word);
        expect(dLine(text, "Deska A")).toMatch(/ stale=measure$/);
      }
      expect(kv[1]).toBe(kv[0]);
      expect(kv[2]).toBe(kv[0]);
      expect(kv[0]).toMatch(/ measure\.stale=1$/);
    } finally {
      setLang("cs");
    }
  }, 240_000);
  it("9. sestava hotovo se ztracenou plochou vazby: žádné ✓ ani „vazby 1/1 ok“, ✗ mate.lost, mates=0/1(lost=1), komponenta stojí (cs/en/de)", async () => {
    const script = `nový díl "Deska A"\nkvádr 60 40 10\nkvádr 20 40 5 v 0 0 5 odebrat\nnový díl "Přidržovač"\nkvádr 10 10 10\nnová sestava "Sestava A"\nvložit "Deska A" ukotvit\nvložit "Přidržovač" v 40 10 30\nsestava vazba kontakt "Přidržovač" spodní "Deska A" F3\nsestava upravit "Deska A"\nsmazat "Kvádr 2"\nsestava hotovo\nsestava vazby\nstav`;
    const out = await short(new MemoryWorkspace(), script);
    expect(out).not.toMatch(/^✓ L12 /m);
    expect(out).not.toMatch(/vazby 1\/1 ok|vazby pohnuly/);
    expect(out).toMatch(/^✗ L12 mate\.lost "Sestava A": vazba 1 Kontakt „Přidržovač“ F5 → „Deska A“ F3 – ztracená reference B F3 dílu „Deska A“ \(rovinná \+Z · střed \[10; 20; 5\] · 800 mm²\) po úpravě dílu neexistuje/m);
    expect(con).toMatch(/^→ „Deska A“ vrácen do sestavy „Sestava A“ .* · vazby 0\/1 ok · ztracené reference: 1 – stav vazeb níže$/m);
    expect(con).toMatch(/1\. Kontakt „Přidržovač“ F5 → „Deska A“ F3 – ztracená reference: B F3/);
    expect(con).not.toMatch(/F3 – ok$/m);
    expect(con).toMatch(/Komponenty: Deska A \[0; 0; 0\] ⚓ · Přidržovač \[40; 10; 5\]$/m); // dřív [40; 0; 5] ∠[90; 0; 0]
    expect(statusLines(out)[0]).toMatch(/ mates=0\/1\(lost=1\) /);
    expect(dLine(out, "Sestava A")).toMatch(/ mates=0\/1\(lost=1\) /);
    // strojová část stejná v en / de (texty přeložené)
    try {
      for (const [lang, word] of [["en", "lost reference"], ["de", "verlorene Referenz"]] as const) {
        setLang(lang);
        const r = await runReport(new MemoryWorkspace(), script.replace('smazat "Kvádr 2"', lang === "en" ? 'smazat "Box 2"' : 'smazat "Quader 2"'), hostOf());
        const text = formatShort(r, { budget: Infinity });
        expect(text).toMatch(/^✗ L12 mate\.lost /m);
        expect(text).not.toMatch(/^✓ L12 /m);
        expect(dLine(text, "Sestava A")).toMatch(/ mates=0\/1\(lost=1\) /);
        expect(formatConsole(r)).toContain(word);
      }
    } finally {
      setLang("cs");
    }
  }, 240_000);

  it("20. (kolo 6) vazba na levý schod, levý smazán: druhý schod na TÉŽE rovině se stejnou plochou není „táž plocha“ – ✗ mate.lost, žádné ℹ mate.renumbered ani „vazby 1/1 ok“", async () => {
    const script = `nový díl "Deska A"\nkvádr 60 40 10\nkvádr 20 40 5 v 0 0 5 odebrat\nkvádr 20 40 5 v 40 0 5 odebrat\nnový díl "Přidržovač"\nkvádr 10 10 10\nnová sestava "Sestava A"\nvložit "Deska A" ukotvit\nvložit "Přidržovač" v 5 15 30\nsestava vazba kontakt "Přidržovač" spodní "Deska A" F3\nsestava upravit "Deska A"\nsmazat "Kvádr 2"\nsestava hotovo\nsestava vazby\nstav`;
    const out = await short(new MemoryWorkspace(), script);
    expect(out).not.toMatch(/mate\.renumbered/);
    expect(out).not.toMatch(/^✓ L13 /m);
    expect(out).toMatch(/^✗ L13 mate\.lost "Sestava A": vazba 1 Kontakt „Přidržovač“ F5 → „Deska A“ F3 – ztracená reference B F3 dílu „Deska A“ \(rovinná \+Z · střed \[10; 20; 5\] · 800 mm²\)/m);
    expect(con).not.toMatch(/vazby 1\/1 ok|F7 – ok/);
    expect(dLine(out, "Sestava A")).toMatch(/ mates=0\/1\(lost=1\) /);
  }, 240_000);

  it("21. (kolo 6) dokument se ztracenou referencí znovu otevřený: `stav` i konec běhu → ⚠ mate.lost (hlavička není OK warn=0), přísný režim zastaví", async () => {
    const ws0 = new MemoryWorkspace();
    await runReport(ws0, `nový díl "Deska A"\nkvádr 60 40 10\nkvádr 20 40 5 v 0 0 5 odebrat\nnový díl "Přidržovač"\nkvádr 10 10 10\nnová sestava "Sestava A"\nvložit "Deska A" ukotvit\nvložit "Přidržovač" v 40 10 30\nsestava vazba kontakt "Přidržovač" spodní "Deska A" F3\nsestava upravit "Deska A"\nsmazat "Kvádr 2"\nsestava hotovo`, hostOf());
    const saved = JSON.stringify(ws0.present());
    expect(saved).toMatch(/"lost":/);
    // otevřený dokument + stav
    const out = await short(new MemoryWorkspace(), `${saved}\nstav`);
    expect(out).not.toMatch(/^MNCAD\/1 OK .* warn=0 /);
    expect(out).toMatch(/^⚠ L2 mate\.lost "Sestava A": vazba 1 Kontakt „Přidržovač“ F5 → „Deska A“ F3 – ztracená reference/m);
    expect(out.match(/mate\.lost/g)?.length).toBe(1); // jednou za běh (konec běhu ji neopakuje)
    expect(statusLines(out)[0]).toMatch(/ mates=0\/1\(lost=1\) /);
    // otevřený dokument bez `stav` (CLI --open + export): hláška na konci běhu
    const opened = await short(new MemoryWorkspace(), saved);
    expect(opened).toMatch(/^⚠ L- mate\.lost "Sestava A"/m);
    // přísný režim: STOP
    const rep = await runReport(new MemoryWorkspace(), `${saved}\nstav`, hostOf(), { strict: true });
    const strict = formatShort(rep, { budget: Infinity });
    expect(strict).toMatch(/^MNCAD\/1 (STOP|FAIL) /);
    // další běh nad týmž prostorem bez změny: znovu jen se `stav`, ne na konci každého běhu
    const ws = new MemoryWorkspace();
    await runReport(ws, saved, hostOf());
    const again = await short(ws, "sestava");
    expect(again).not.toMatch(/mate\.lost/);
  }, 240_000);

  it("22. (kolo 6, bod 22h) export se stavbou: fáze „přestavba modelu“ se hlásí DŘÍV než průběh stavby (build i/n)", async () => {
    const events: string[] = [];
    const stop = kernel.onProgress((p) => {
      if (p && p.phase !== "start") events.push(`progress:${p.op}`);
    });
    try {
      const host: EngineHost = { ...hostOf(), phase: (op, ph) => events.push(`phase:${op}:${ph}`) };
      await runReport(new MemoryWorkspace(), 'nový díl "Export F"\nkvádr 20 10 10\nválec 3 10 v 10 5 0 odebrat\nexport step bez kontroly', host, { hooks: { opStart: (_l: number | null, op: string) => void events.push(`op:${op}`) } });
    } finally {
      stop();
    }
    const at = events.findIndex((e) => /^op:out/.test(e));
    expect(at).toBeGreaterThanOrEqual(0);
    const after = events.slice(at + 1);
    const model = after.indexOf("phase:export:step:model");
    expect(model).toBeGreaterThanOrEqual(0);
    const build = after.findIndex((e) => e.startsWith("progress:"));
    if (build >= 0) expect(model).toBeLessThan(build);
    expect(after.filter((e) => e === "phase:export:step:model").length).toBe(1); // fáze jednou, ne dvakrát
    expect(after).toContain("phase:export:step:convert");
  }, 240_000);

  it("10. zrušený běh (signál po 1. řádku): žádné ✓ za další řádky, MNCAD/1 FAIL, run.state cancelled, dokument beze změny", async () => {
    const ws = new MemoryWorkspace();
    await runReport(ws, 'nový díl "Zrušený"\nkvádr 30 30 5', hostOf());
    const before = JSON.stringify(ws.present());
    const ac = new AbortController();
    // (zrušení po `nový díl` uprostřed skriptu hlídá případ 16 – tady dokument založí dřívější běh)
    const rep = await runReport(ws, 'kvádr 20 10 10\nválec 5 10\nkvádr 1 1 1\nstav', hostOf(), { signal: ac.signal, hooks: { opEnd: () => ac.abort() } });
    rep.run = { id: "r1", inputRev: "-@r·000000", state: rep.entries.some((e) => e.code === "run.cancelled") ? "cancelled" : "done" };
    const out = formatShort(rep, { budget: Infinity, notes: true });
    expect(out).toMatch(/^MNCAD\/1 FAIL /);
    expect(out).toMatch(/^✗ L- run\.cancelled/m);
    expect(out).not.toMatch(/^✓ L[234] /m);
    expect(rep.run.state).toBe("cancelled");
    expect(out).toMatch(/ run=r1$/);
    expect(JSON.stringify(ws.present())).toBe(before);
  }, 120_000);

  it("11. ✓ kontrola STEP jen s kontrolou: `export step bez kontroly` = žádné ✓ kontroly ani check=, s kontrolou ✓ + check=ok + rev=", async () => {
    const ws = new MemoryWorkspace();
    await runReport(ws, 'nový díl "Export"\nkvádr 20 10 10', hostOf());
    const without = await short(ws, "export step bez kontroly");
    expect(con).not.toMatch(/✓ kontrola STEP/);
    expect(without).not.toMatch(/check=/);
    const withCheck = await short(ws, "export step");
    expect(con).toMatch(/✓ kontrola STEP/);
    expect(withCheck).toMatch(/^F step "Export\.step" \d+B check=ok rev=r·[0-9a-f]{6}/m);
  }, 120_000);

  it("16. zrušený běh, který před zrušením zapsal jiný dokument: nikdy „beze změny“ – ✗ run.cancelled-partial ho jmenuje; založená záložka zmizí", async () => {
    setLang("cs");
    const ws = new MemoryWorkspace();
    await runReport(ws, 'nový díl "Deska A"\nkvádr 30 30 5', hostOf());
    const ac = new AbortController();
    const rep = await runReport(ws, 'kvádr 5 5 5 v 0 0 5\nnový díl "Deska B"\nkvádr 1 1 1\nnový díl "Deska C"\nkvádr 2 2 2', hostOf(), { signal: ac.signal, hooks: { opEnd: (l: number | null) => void (l === 4 && ac.abort()) } });
    const out = formatShort(rep, { budget: Infinity, notes: true });
    expect(out).toMatch(/^✗ L- run\.cancelled-partial /m);
    expect(out).not.toMatch(/beze změny/);
    expect(rep.console).toMatch(/zůstaly v „Deska A“/);
    expect(rep.console).toMatch(/Dokumenty založené během \(„Deska B“\) se zahodily/);
    expect(ws.tabs().map((t) => t.title)).not.toContain("Deska B");
  }, 120_000);
});

describe("vlna 22 A4: žádné falešné zelené u ověření odkazu a softwarového zobrazení", async () => {
  const { createShareLink } = await import("../share");
  const { verifyShareLink } = await import("../share-verify");
  const { softStatusText } = await import("../soft-view");
  const { emptyDoc } = await import("../types");
  const doc: CadDoc = { ...emptyDoc("Deska A"), kind: "part", features: [{ id: "b1", name: "Kvádr 1", type: "box", size: [60, 40, 10], position: [0, 0, 0], centered: false, mode: "new" } as never] };

  it("12. ověření: jen otevřený odkaz je ok; useknutý / změněný / nerozpoznaný = ok:false s důvodem", async () => {
    setLang("cs");
    const r = await createShareLink(doc, { days: 10, mode: "link", base: "https://www.mnastrojarna.cz/cad" });
    expect((await verifyShareLink(r.url)).ok).toBe(true);
    const cut = await verifyShareLink(r.url.slice(0, -5));
    expect(cut.ok).toBe(false);
    if (!cut.ok) {
      expect(cut.reason).toBe("truncated");
      expect(cut.text).not.toMatch(/heslo/i);
    }
    const k = Math.floor(r.url.length * 0.8);
    const bad = await verifyShareLink(r.url.slice(0, k) + (r.url[k] === "A" ? "B" : "A") + r.url.slice(k + 1));
    expect(bad.ok).toBe(false);
    expect((await verifyShareLink("https://www.mnastrojarna.cz/cad")).ok).toBe(false);
  });

  it("18. (kolo 6) náhradní dlouhý odkaz: úložiště odpovědělo HTTP 500 php_too_old → důvod nese PHP a HTTP 500, ne nepravdivé „neodpovídá“", async () => {
    setLang("cs");
    const { resetShareProbe } = await import("../share");
    const { shareWithPolicy } = await import("../engine/share-out");
    const store = "http://127.0.0.1:9/cad/share/";
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ ok: false, error: "php_too_old", php: "5.6.40", need: "7.0" }), { status: 500, headers: { "content-type": "application/json" } })));
    try {
      for (const want of ["auto", "store"] as const) {
        resetShareProbe();
        const notes: { code: string; text?: string }[] = [];
        const r = await shareWithPolicy(doc, { days: 10, view: "model", want, base: "https://example.test/cad", store }, (n) => notes.push(n));
        expect(r?.mode ?? null).toBe(want === "auto" ? "link" : null);
        const text = notes.map((n) => n.text ?? "").join("\n");
        expect(notes.map((n) => n.code)).toEqual([want === "auto" ? "share.fallback-link" : "share.store-unavailable"]);
        expect(text).toMatch(/HTTP 500/);
        expect(text).toMatch(/PHP 5\.6\.40/);
        expect(text).not.toMatch(/neodpovídá/);
      }
      // server vůbec neodpověděl (síť): „neodpovídá“ je pravda a důvod se připojí
      resetShareProbe();
      vi.stubGlobal("fetch", vi.fn(async () => { throw new TypeError("fetch failed"); }));
      const notes: { code: string; text?: string }[] = [];
      await shareWithPolicy(doc, { days: 10, view: "model", want: "auto", base: "https://example.test/cad", store }, (n) => notes.push(n));
      expect(notes[0].text).toMatch(/neodpovídá \(http:\/\/127\.0\.0\.1:9\/cad\/share\/\) – server nedostupný/);
    } finally {
      vi.unstubAllGlobals();
      resetShareProbe();
    }
  });

  it("18b. (kolo 6, úplný běh) tatáž HTTP 404 úložiště: `sdílet úložiště` i `export … odkaz` (soubor) hlásí stejný text „nefunguje – HTTP 404“", async () => {
    // Dřív: sdílení dokumentu „úložiště … (adresa) nefunguje – HTTP 404: …“, sdílení souboru (share-file.ts) pořád „neodpovídá (adresa)“
    // – server přitom odpověděl. Jedno pravidlo `storeDownText` (share.ts) pro obě cesty.
    setLang("cs");
    const { resetShareProbe } = await import("../share");
    const { shareWithPolicy } = await import("../engine/share-out");
    const { shareFile } = await import("../share-file");
    const store = "http://127.0.0.1:9/cad/share/";
    vi.stubGlobal("fetch", vi.fn(async () => new Response("<!doctype html><title>404</title>", { status: 404, headers: { "content-type": "text/html" } })));
    try {
      resetShareProbe();
      const notes: { code: string; text?: string }[] = [];
      expect(await shareWithPolicy(doc, { days: 10, view: "model", want: "store", base: "https://example.test/cad", store }, (n) => notes.push(n))).toBeNull();
      expect(notes.map((n) => n.code)).toEqual(["share.store-unavailable"]);
      const docText = notes[0].text ?? "";
      expect(docText).toMatch(/^úložiště krátkých odkazů \(http:\/\/127\.0\.0\.1:9\/cad\/share\/\) nefunguje – HTTP 404/);
      resetShareProbe();
      const err = await shareFile({ name: "Deska.step", mime: "model/step", data: new Uint8Array(16) }, { store }).then(
        () => null,
        (e: Error & { unavailable?: boolean }) => e,
      );
      expect(err).toMatchObject({ name: "FileStoreError", unavailable: true });
      expect(err!.message).toBe(docText);
      expect(err!.message).not.toMatch(/neodpovídá/);
    } finally {
      vi.unstubAllGlobals();
      resetShareProbe();
    }
  });

  it("19. (kolo 6) poznámka nad softwarově VYKRESLENÝM modelem není chyba: žádné „3D okno nelze spustit“ ani barvy chyby (cs/en/de)", async () => {
    const { createElement } = await import("react");
    const { renderToStaticMarkup } = await import("react-dom/server");
    const { ViewportFallback } = await import("../../components/cad/viewport-fallback");
    const failure = { error: new Error("WebGL context could not be created"), probe: { ok: false, api: null, vendor: null, renderer: null, software: false, reason: "no-webgl" } };
    try {
      for (const lang of ["cs", "en", "de"] as const) {
        setLang(lang);
        const html = renderToStaticMarkup(createElement(ViewportFallback, { failure, core: "OCCT", onRetry: () => undefined, onCopy: () => undefined, scene: { mesh: null } }));
        const note = html.match(/<div[^>]*data-soft-note[^>]*>[\s\S]*?<\/div>/)?.[0] ?? "";
        expect(note).not.toBe("");
        const text = note.replace(/<[^>]+>/g, "");
        expect(text).toContain(softStatusText());
        expect(text).not.toMatch(/nelze spustit|cannot start|kann nicht/i);
        expect(note).not.toMatch(/#fff7f6|#f3c6c2/i);
      }
    } finally {
      setLang("cs");
    }
  });

  it("13. stav prostředí bez WebGL netvrdí, že 3D běží (ani zelený stav jádra místo něj)", () => {
    setLang("cs");
    expect(softStatusText()).toMatch(/WebGL není dostupné/);
    expect(softStatusText()).not.toMatch(/OCCT|připraveno|✓/);
  });
});

describe("vlna 22 fáze 2 kolo 3 (body 12, 22h): „odpovídá modelu“, „kontrola ✓“ a „beze změny“ jen tam, kde to platí", async () => {
  const { exportLine, recordExport } = await import("../doc-outputs");
  const { emptyDoc } = await import("../types");
  const part = (h: number): CadDoc => ({ ...emptyDoc("Deska A"), kind: "part", features: [{ id: "b1", name: "Kvádr 1", type: "box", size: [60, 40, h], position: [0, 0, 0], centered: false, mode: "new" } as never] });

  it("14. záznam exportu ze STARŠÍ revize (model změněný během exportu) nikdy „odpovídá modelu“", () => {
    setLang("cs");
    const exported = part(10);
    const now = part(12); // uživatel změnil výšku, než export doběhl
    const { doc, rec } = recordExport(now, { what: "model", format: "step", file: "Deska A.step", from: exported });
    expect(exportLine(doc, rec)).not.toMatch(/odpovídá modelu/);
    expect(exportLine(doc, rec)).toMatch(/ZASTARALÝ/);
    // tentýž model → odpovídá
    const same = recordExport(exported, { what: "model", format: "step", file: "Deska A.step", from: exported });
    expect(exportLine(same.doc, same.rec)).toMatch(/odpovídá modelu$/);
  });

  it("15. „kontrola ✓“ v záznamu úlohy jen s provedenou a úspěšnou kontrolou; neúspěšná = ⚠ s důvodem", () => {
    setLang("cs");
    const d = part(10);
    const none = recordExport(d, { what: "model", format: "step", file: "a.step", job: { state: "done", ms: 400 } });
    expect(exportLine(none.doc, none.rec)).not.toMatch(/kontrola/);
    const bad = recordExport(d, { what: "model", format: "step", file: "b.step", job: { state: "done", ms: 400, check: { ok: false, text: "těles: 0" } } });
    expect(exportLine(bad.doc, bad.rec)).toMatch(/kontrola ⚠ těles: 0/);
    expect(exportLine(bad.doc, bad.rec)).not.toMatch(/✓/);
    const ok = recordExport(d, { what: "model", format: "step", file: "c.step", job: { state: "done", ms: 400, check: { ok: true, text: "věrná kopie" } } });
    expect(exportLine(ok.doc, ok.rec)).toMatch(/úloha: dokončeno ⏱ 0,4 s · kontrola ✓/);
  });

  it("17. (kolo 4) Ctrl+Z hned po exportu: seznam výstupů nesmí být „čistý“ – záznam zůstane a k vrácenému modelu je ZASTARALÝ", async () => {
    setLang("cs");
    const { undoKeepOutputs, recordOutsideHistory } = await import("../history-outputs");
    const { staleExports, exportsText } = await import("../doc-outputs");
    const before = part(10);
    const exported = part(12);
    let h = { past: [before], present: exported, future: [] as CadDoc[] };
    h = recordOutsideHistory(h, (d) => recordExport(d, { what: "model", format: "step", file: "Deska A.step", from: exported }).doc);
    const u = undoKeepOutputs(h);
    const text = exportsText(u.present);
    expect(text).not.toMatch(/žádné|odpovídá modelu/);
    expect(text).toMatch(/Deska A\.step[^\n]*ZASTARALÝ/);
    expect(staleExports(u.present).length).toBe(1);
  });
});
