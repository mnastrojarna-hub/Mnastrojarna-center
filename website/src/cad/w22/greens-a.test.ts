/**
 * Vlna 22, balík A – test „žádné falešné zelené“ (zpráva majitele, priorita 1). Pro každý úspěšný text, kterého se
 * balík A dotkl, je tu případ, kdy se NESMÍ vypsat: kontrola neproběhla, proběhla nad jiným dokumentem / jiným stavem,
 * nebo nevyšla. Skutečné jádro in-process, engine stejný jako v prohlížeči a v CLI.
 *
 * Inventář zelených textů etapy A1 (bod 1) a podmínka, za které smějí být vidět:
 *  1. panel Kolize „Bez kolizí ✓“                – jen stav `ok`: záznam aktivního dokumentu, otisk = zobrazený stav sestavy
 *  2. `stav` „Kolize: žádné (zkontrolováno …)“   – bez dovětku „NEPLATÍ“ jen při shodném otisku; jiná sestava „nezkontrolováno“
 *  3. `= … status … clash=0`                     – bez `clash.stale=1` jen při shodném otisku; jiná sestava `clash=-`
 *  4. řádek D `clash=0(…)`                       – vždy pro konečný stav sestavy (přepočet ℹ clash.rechecked)
 *  5. `stav` „Vazby: N (N ok)“ / `mates=N/N`     – jen pro nynější stav sestavy; jinak přepočet, a neodpovídají-li polohy
 *                                                  v dokumentu, „NEPLATÍ“ + `mates.stale=1` + D `stale=mates`
 *  6. `sestava vazby` „… – ok“                   – nad sestavou s neodpovídajícími polohami vždy s ⚠ „platí až po přepočtu“
 *  7. `= … measure …` (čísla měření)             – po změně dokumentu `stav` „Měření … NEPLATÍ“ + `measure.stale=1` + D `stale=measure`
 *  8. `= … compare … ok=1`                       – po změně dokumentu `stav` „Porovnání … NEPLATÍ“ + `compare.stale=1` + D `stale=compare`
 * (GUI: zelená tečka vazby, řádky měření a barevná mapa porovnání – tatáž pravidla, hlídá je e2e cad-w22-a.e2e.cjs.)
 */
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
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
    expect(clashTitle("ok", 0)).toBe("Bez kolizí ✓");
    for (const st of ["unchecked", "stale", "clash"] as const) {
      expect(clashTitle(st, 2)).not.toMatch(/✓|Bez kolizí/);
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
    expect(con).toMatch(/Kolize: žádné \(zkontrolováno [^)]+\)$/m);
    // B (kde přidržovač do desky zasahuje) nikdy kontrolována nebyla → žádné clash=0, žádné „Kolize: žádné“
    expect(st[1]).toMatch(/status "Sestava B" .* clash=-$/);
    expect(con).toMatch(/Kolize: nezkontrolováno/);
    // A po posunu do kolize: starý výsledek jen s označením neplatnosti
    expect(st[2]).toMatch(/status "Sestava A" .* clash=0 clash\.stale=1$/);
    // poslední výpis stavu v konzoli (závěrečný stav sestavy A)
    const lastStatus = con.slice(con.lastIndexOf("Dokument: „Sestava A“"));
    expect(lastStatus).toMatch(/Kolize: žádné \(zkontrolováno [^)]+\) – NEPLATÍ: sestava se od kontroly změnila/);
    expect(lastStatus).not.toMatch(/Kolize: žádné \(zkontrolováno [^)]+\)$/m);
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
    expect(lastStatus).toMatch(/Kolize: žádné \(zkontrolováno [^)]+\) – NEPLATÍ: sestava se od kontroly změnila/);
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
});
