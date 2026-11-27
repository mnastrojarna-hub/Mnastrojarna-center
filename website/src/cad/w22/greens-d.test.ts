/**
 * Vlna 22, balík D (etapa D1, body 22g a 19) – „žádné falešné zelené“: každý úspěšný / klidný text kusovníku se nesmí
 * vypsat, když kontrola neproběhla, proběhla nad jiným stavem nebo nevyšla. Náhradní jádro (geometrie nerozhoduje).
 *
 * Inventář a podmínka, za které smějí být vidět:
 *  1. `✓ komponenta „X“ už odpovídá dílu v záložce`  – jen když díl JE otevřený a kopie se od něj neliší
 *  2. `✓ komponenta „X“ obnovena z dílu (…)`          – jen když se kopie opravdu převzala z dílu záložky
 *  3. kusovník bez ⚠ asm.stale-copy                   – jen když žádná kopie není starší než díl v záložce
 *  4. kusovník bez ⚠ bom.make-incomplete             – jen když vyráběné díly mají číslo i označení materiálu
 *  5. ℹ `bom.docs` „vyráběné N“ bez „(bez výkresu …)“ – jen když všechny vyráběné díly mají výkres
 *  6. `✓ druh dílu …`                                  – jen po přečteném druhu (neznámé slovo = ✗, druh se nezmění)
 *  Etapa D2 (bod 20 – výkresy a výstupy):
 *  7. `✓ list „X“ vydán jako rev. A …`                 – jen když se vydání opravdu zapsalo (opakování beze změny = „→ … beze změny“)
 *  8. „Vydání: … – odpovídá modelu“ / „Výkres: … odpovídá modelu“ – jen pro revizi modelu, ze které byl list vydán
 *  9. „Zastaralé výstupy: žádné“                       – jen když žádný vydaný list ani export neodpovídá starší revizi
 *  Etapa D3 (bod 18 – kontrola kót pro výrobu, čisté funkce cad/dim-complete.ts):
 * 10. „Kontrola kót: všech N očekávaných rozměrů je na listu“ – už nikdy; ani úplná kontrola neříká „všech“ / „kompletní“
 * 11. bez ⚠ drawing.dims-incomplete jen když na listu nechybí ani POLOHA prvku (dřív stačily velikosti)
 * 12. „funkční prvky: tolerance n/n“ – jen s vyznačenými funkčními prvky a předepsanou tolerancí na kótě; jinak „neověřeny“
 * 13. poloha „✓“ nikdy u kót zapečených v pohledu (nezkontrolováno)
 *  Etapa D4 (body 17 a 22j – čitelný výkres sestavy, šablona hlavičky):
 * 14. „Překryvy na listu: 0 (zkontrolováno …)“ / řádek D `overlaps=0` – jen po kontrole nad tímto listem; bez ní
 *     „nezkontrolováno“ a v řádku D pole chybí; s překryvem nikdy 0
 * 15. „nevešlo se 0“ u pozic – jen když se všechny pozice vešly (lost = 0); `✓ pozice … zamčeny` jen s uloženým zámkem
 * 16. `✓ razítko podle šablony hlavičky` – jen když šablona existuje (jinak ✗ s přehledem); logo názvem souboru jen
 *     s nalezeným souborem (jinak ✗ „soubor není připojený“)
 *  Fáze 2, kolo 3 (ověření po bodech na main 4a46d82):
 * 17. `✓ výkres: list „X“ vyhodnocen bez nálezů` – nikdy nad ruční kótou, která po změně modelu neleží na geometrii (bod 20:
 *     „60 *“ na dílu délky 30) – ⚠ drawing.dim-detached; po potvrzení `výkres upravit aN …` zase ✓
 * 18. „Překryvy na listu: 0“ – nikdy, když centrovací značka rámu vede přes tabulku (bod 17: záhlaví kusovníku A3 / A1)
 * 19. `✓ výkres: list „X“ vyhodnocen bez nálezů` nad sestavou se zastaralou kopií dílu – nikdy (22g); export kusovníku /
 *     výkresu sestavy vždy s ⚠ asm.stale-copy
 *  Fáze 2, kolo 6 (nezávislé ověření po bodech):
 * 21. „Kontrola kót: velikosti n/n“ – nikdy, když celkový rozměr nese jen kóta jiného směru (osy modelu) nebo jen její text
 * 22. „polohy n/n“ – nikdy z kóty, jejíž pomocná čára nevede na osu díry (shodná souřadnice jinde na listu)
 * 23. „Překryvy na listu: 0“ – nikdy, když odkazová čára pozice vede přes kotvu jiné pozice nebo přes kótu (čáry, text)
 * 24. kusovník u zastaralé kopie: nikdy rada „materiál … v dílu“ / „bez výkresu“, když díl v záložce údaj má – rada obnovit
 *     (24b: totéž u `výkres export pdf vše`, v souhrnu `bom.docs` a v panelu Kusovník – asm-supply.test.ts)
 * 25. „uložena do Nastavení“ – jen kde Nastavení přežije běh (v CLI „jen pro tento běh“)
 *  Fáze 2, kolo 7 (zbylé mezery bodů 19, 20, 22g):
 * 26. `✓ kontrola kolizí znovu (kolize)` v `přepočítat vše` – nikdy, když kontrola kolizi našla (⚠ „nalezeno kolizí: N“);
 *     strojová část `warned=N`
 * 27. „Zbývá: nic – … odpovídají modelu“ – nikdy, když obnova kopie ztratila referenci vazby (vazba v „Zbývá udělat ručně“);
 *     `✓ kopie dílů … obnoveny` jen bez ⚠/✗ podpříkazu
 * 28. `✓ materiál = Nerez` – nikdy, když označení v razítku patří jiné třídě (⚠ material.class-conflict); razítko textem
 *     `materiál="ČSN 11 523"` na hliníkovém dílu nikdy bez ℹ/⚠ a nikdy s hustotou hliníku
 * 30. „křížení odkazů 0“ – jen když se žádné dva odkazy pozic nekříží (bod 17: A1, 100 dílů – dřív 2 křížení, přesun kolo 7)
 * 28b. třída 1.2311 po označení ČSN 11 523 – nikdy ⚠ „si odporují“ (stejná skupina oceli, ℹ material.class-family); rozpor tříd
 *     nikdy jen na řádku příkazu – ⚠ i ve `stav`, kusovníku a exportu výkresu
 * 29. `výkresy dílů`: „list vyhodnocen bez nálezů“ jen u listu, který vznikl; díl mimo záložku nikdy tiše (⚠ bom.make-incomplete)
 * 32. „odpovídá modelu“ / „Zastaralé výstupy: žádné“ – nikdy po změně prvků dokumentu, který engine mění na místě (revize podle
 *     objektu i tvaru dokumentu, doc-shape.ts)
 * 31. „Zastaralé výstupy: žádné“ / „Zbývá: nic“ / `✓ pohybová studie znovu` – nikdy s výsledkem pohybové studie, který pro
 *     nynější stav sestavy neplatí (motion.stale), ani se studií, která při přepočtu našla kolizi
 *  (GUI: panel komponenty bez žlutého „Kopie je starší než díl“ a Kusovník bez upozornění – stejné funkce asm-refresh.ts /
 *  bom-model.ts, scénář e2e/cad-w22-d.e2e.cjs.)
 */
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { partComponent, screwISO4762 } from "../assembly";
import { asmDocNotes } from "../engine/files";
import { memoryFileSink, memoryFileSource, type EngineHost } from "../engine/host";
import type { KernelApi } from "../engine/kernel";
import { MemoryWorkspace } from "../engine/memory-workspace";
import { formatConsole } from "../engine/protocol";
import type { RunReport } from "../engine/protocol-types";
import { runScript } from "../engine/run";
import { setHostAssets } from "../host-assets";
import { makeKernelClient } from "../kernel-client";
import { emptyDoc, type BuildResult, type CadDoc, type ComponentSource, type DrawingAnnotation, type Feature, type FunctionalMark } from "../types";
import { checkSheet, dimCheckLine, type CheckView } from "../dim-complete";
import { dimCheckIssues } from "../drawing-dimcheck";

const WASM = path.resolve(__dirname, "../../../node_modules/replicad-opencascadejs/dist/replicad_single.wasm");
const FONTS = path.resolve(__dirname, "../../../public/fonts");
const result = (d: CadDoc): BuildResult =>
  ({ status: d.features.map((f) => ({ id: f.id, ok: true })), mesh: null, metrics: d.features.length ? { volume: 20000, area: 600, bbox: [[0, 0, 0], [10, 10, 10]], faces: 6, edges: 12, valid: true, solids: 1 } : null, ms: 1 }) as unknown as BuildResult;
const kernel = {
  generation: () => 1,
  build: async (d: CadDoc) => result(d),
  check: async (d: CadDoc) => ({ status: d.features.map((f) => ({ id: f.id, ok: true })), paramErrors: [], solid: true }),
  asmParts: async (parts: { key: string; source: ComponentSource }[]) => parts.map((p) => ({ key: p.key, result: result(p.source.kind === "part" ? p.source.doc : emptyDoc()) })),
  interference: async () => Object.assign([], { stats: { pairs: 0, culled: 0, exact: 0, reused: 0, undetermined: 0 } }),
  clashDetail: async () => [],
  stepSplit: async () => null,
} as unknown as KernelApi;
const host = (): EngineHost => ({ kernel, files: memoryFileSink(), inputs: memoryFileSource({}), now: () => Date.now() });
const run = (ws: MemoryWorkspace, t: string) => runScript(ws, t, host());
const txt = (r: RunReport) => formatConsole(r);
const has = (r: RunReport, code: string) => r.entries.some((e) => e.code === code);

describe("greens D1 – kusovník a kopie dílu", () => {
  it("1+2: „už odpovídá dílu“ ani „obnovena“ se nevypíše, když díl není otevřený (zavřená záložka) – jen ℹ se důvodem", async () => {
    const ws = new MemoryWorkspace();
    await run(ws, 'nový díl "Deska A"\nkvádr 100 60 20\nnová sestava "Nástroj"\nvložit "Deska A" ukotvit');
    await run(ws, 'zavřít záložku "Deska A"');
    const r = await run(ws, 'sestava obnovit "Deska A"');
    expect(txt(r)).not.toMatch(/už odpovídá dílu/);
    expect(txt(r)).not.toMatch(/obnovena z dílu/);
    expect(txt(r)).toMatch(/„Deska A“ se neobnovuje: díl „Deska A“ není otevřený v záložce/);
  });

  it("1: „už odpovídá dílu“ se nevypíše, když se díl od vložení změnil – místo toho obnova s výčtem polí", async () => {
    const ws = new MemoryWorkspace();
    await run(ws, 'nový díl "Deska A"\nkvádr 100 60 20\nnová sestava "Nástroj"\nvložit "Deska A" ukotvit');
    await run(ws, 'záložka "Deska A"\nmateriál 1.2379\nzáložka "Nástroj"');
    const r = await run(ws, 'sestava obnovit "Deska A"');
    expect(txt(r)).not.toMatch(/už odpovídá dílu/);
    expect(txt(r)).toMatch(/✓ komponenta „Deska A“ obnovena z dílu \(materiál\)/);
  });

  it("3: kusovník nad zastaralou kopií nikdy bez ⚠ asm.stale-copy (dřív tiché prázdné číslo a „Ocel“)", async () => {
    const ws = new MemoryWorkspace();
    await run(ws, 'nový díl "Deska A"\nkvádr 100 60 20\nnová sestava "Nástroj"\nvložit "Deska A" ukotvit');
    const clean = await run(ws, "kusovník");
    expect(has(clean, "asm.stale-copy")).toBe(false); // díl se nezměnil → nic se nehlásí (a nic se netvrdí navíc)
    await run(ws, 'záložka "Deska A"\nmateriál 1.2379\nzáložka "Nástroj"');
    const r = await run(ws, "kusovník");
    expect(has(r, "asm.stale-copy")).toBe(true);
  });

  it("4: kusovník bez ⚠ bom.make-incomplete jen s číslem a označením materiálu vyráběného dílu", async () => {
    const ws = new MemoryWorkspace();
    const bad = await run(ws, 'nový díl "Deska A"\nkvádr 100 60 20\nnová sestava "Nástroj"\nvložit "Deska A" ukotvit\nkusovník');
    expect(bad.entries.filter((e) => e.code === "bom.make-incomplete").length).toBe(2); // bez čísla, bez označení
    const ws2 = new MemoryWorkspace();
    // normálie a nakupovaný díl se nehodnotí – samotné nevyvolají ⚠
    const ok = await run(ws2, 'nový díl "Pouzdro"\nválec 10 20\ndruh nakupovaný katalog "K-1"\nnová sestava "Nástroj"\nvložit "Pouzdro"\nnormálie M8x20\nkusovník');
    expect(has(ok, "bom.make-incomplete")).toBe(false);
  });

  it("5: souhrn dokumentace neříká „vyráběné 1“ bez dovětku, když vyráběnému dílu výkres chybí", () => {
    const plate: CadDoc = { ...emptyDoc("Deska A"), kind: "part", props: { number: "DA-001" } };
    const asm: CadDoc = { ...emptyDoc("Nástroj"), kind: "assembly", components: [partComponent(plate), partComponent(screwISO4762("M8", 20))] };
    const n = asmDocNotes(asm);
    expect(n[0].args).toEqual(["vyráběné 1 (bez výkresu 1), normálie 1, nakupované 0"]);
    expect(n.some((x) => x.code === "bom.make-incomplete")).toBe(true);
    const withSheet: CadDoc = { ...asm, components: [partComponent({ ...plate, drawings: [{ id: "s", name: "List 1" } as never] }), partComponent(screwISO4762("M8", 20))] };
    expect(asmDocNotes(withSheet)).toEqual([{ code: "bom.docs", args: ["vyráběné 1, normálie 1, nakupované 0"] }]);
  });

  it("24 (kolo 6, 22g): zastaralá kopie – žádná rada „materiál … v dílu“ / „bez výkresu“, když díl v záložce údaj má; rada obnovit", async () => {
    // repro S/w22/repro/22g/repro-b.txt L13
    const ws = new MemoryWorkspace();
    await run(ws, 'nový díl "Deska A"\nkvádr 100 60 20\nnová sestava "Nástroj"\nvložit "Deska A" ukotvit');
    await run(ws, 'záložka "Deska A"\nmateriál 1.2379\nvýkres razítko číslo="DA-001"\nzáložka "Nástroj"');
    const r = await run(ws, "kusovník");
    const inc = r.entries.filter((e) => e.code === "bom.make-incomplete").map((e) => e.text ?? "").join("\n");
    expect(inc).not.toMatch(/Deska A[^\n]*materiál 1\.2379 v dílu/);
    expect(inc).not.toMatch(/bez čísla výkresu: Deska A/);
    expect(inc).toMatch(/Deska A: v kusovníku chybí číslo DA-001, materiál 1\.2379 – díl v záložce je má, kopie v sestavě je starší: sestava obnovit #1/);
    const notes = asmDocNotes(ws.present(), (n) => ws.findPart(n));
    expect(JSON.stringify(notes)).not.toMatch(/Deska A \(bez výkresu/);
    expect(JSON.stringify(notes)).toMatch(/sestava obnovit #1/);
  });

  it("6: „✓ druh dílu“ jen po přečteném druhu – neznámé slovo = ✗ a dokument beze změny", async () => {
    const ws = new MemoryWorkspace();
    const r = await run(ws, 'nový díl "Pouzdro"\nválec 10 20\ndruh levný');
    expect(txt(r)).not.toMatch(/✓ druh dílu/);
    expect(txt(r)).toMatch(/druh: čekám vyráběný \| normálie \| nakupovaný \| auto, ne „levný“/);
    expect(ws.present().supply).toBeUndefined();
  });
});

describe("greens D2 – vydání listu a zastaralé výstupy (bod 20)", async () => {
  // Skutečné jádro: list se po příkazech výkresu vyhodnotí (vlna 22, 22i – „→ … výsledek po vyhodnocení listu níže“, pak ✓ / ✗
  // listu). Falešné jádro výkres neumí – běh by skončil ✗ a „greens“ by tvrdil úspěch nad nevyhodnoceným listem.
  setHostAssets({ font: async (name) => new Uint8Array(fs.readFileSync(path.join(FONTS, name))).buffer });
  const { inProcessTransport } = await import("../kernel-inprocess");
  const real = makeKernelClient(inProcessTransport({ locateFile: (file) => (file.endsWith(".wasm") ? WASM : file) }));
  await real.init();
  const run = (ws: MemoryWorkspace, t: string) => runScript(ws, t, { kernel: real as unknown as KernelApi, files: memoryFileSink(), inputs: memoryFileSource({}), now: () => Date.now() });
  const clean = (r: RunReport) => expect(r.entries.filter((e) => e.level === "error").map((e) => `L${e.line} ${e.code}: ${e.text}`)).toEqual([]);
  const PART = 'nový díl "Deska A"\nkvádr 60 40 10\nvýkres A4';
  it("7: opakované vydání téhož listu z téhož modelu není nové vydání", async () => {
    const ws = new MemoryWorkspace();
    const r1 = await run(ws, `${PART}\nvýkres vydat`);
    clean(r1);
    // vydání je příkaz výkresu: přijato (→), list se pak vyhodnotí (✓ listu) – 22i
    expect(txt(r1)).toMatch(/→ list „List 1“ vydán jako rev\. A z modelu r·[0-9a-f]{6} .* – výsledek po vyhodnocení listu níže/);
    expect(txt(r1)).toMatch(/✓ výkres: list „List 1“ vyhodnocen bez nálezů/);
    const r2 = await run(ws, 'záložka "Deska A"\nvýkres vydat A');
    clean(r2);
    expect(txt(r2)).not.toMatch(/[✓→] list „List 1“ vydán/);
    expect(txt(r2)).toMatch(/list „List 1“ už je vydán jako rev\. A z modelu r·\w{6} – beze změny/);
  });

  it("8 + 9: po změně modelu ani stav, ani výstupy netvrdí „odpovídá modelu“ / „žádné“ – ⚠ drawing.stale", async () => {
    const ws = new MemoryWorkspace();
    clean(await run(ws, `${PART}\nvýkres vydat`));
    const r = await run(ws, 'záložka "Deska A"\nupravit "Kvádr 1" size=30;40;10\nstav\nvýstupy zastaralé');
    clean(r);
    const t = txt(r);
    expect(t).not.toMatch(/– odpovídá modelu/);
    expect(t).not.toMatch(/Zastaralé výstupy: žádné/);
    expect(t).toMatch(/Zastaralé výstupy \(1\)/);
    expect(has(r, "drawing.stale")).toBe(true);
  });

  it("17 (kolo 3, bod 20): ruční kóta po změně modelu – žádné „✓ list vyhodnocen bez nálezů“, ⚠ drawing.dim-detached; po potvrzení ✓", async () => {
    const ws = new MemoryWorkspace();
    const r0 = await run(ws, `${PART}\nvýkres kóta vodorovně pohled přední 0 10 60 10 odsazení 10`);
    clean(r0);
    expect(txt(r0)).toMatch(/✓ výkres: list „List 1“ vyhodnocen bez nálezů/);
    expect(has(r0, "drawing.dim-detached")).toBe(false);
    const r = await run(ws, 'záložka "Deska A"\nupravit "Kvádr 1" size=30;40;10\nvýkres stav');
    clean(r);
    expect(txt(r)).not.toMatch(/vyhodnocen bez nálezů/);
    expect(txt(r)).not.toMatch(/přední: 60 \*/); // výpis ukazuje, co je na listu, ne uloženou hodnotu
    expect(txt(r)).toMatch(/přední: 30 \(zadáno 60\) \* ⚠/);
    const det = r.entries.filter((e) => e.code === "drawing.dim-detached");
    expect(det.length).toBe(1);
    expect(det[0].text).toMatch(/a\d+ 60 \(přední\) – přichycena ke změněné geometrii, na listu teď 30/);
    const ok = await run(ws, `záložka "Deska A"\nvýkres upravit ${/(a\d+) 60 \(přední\)/.exec(det[0].text)![1]} odsazení=10`);
    clean(ok);
    expect(has(ok, "drawing.dim-detached")).toBe(false);
    expect(txt(ok)).toMatch(/✓ výkres: list „List 1“ vyhodnocen bez nálezů/);
  }, 240_000);

  it("19 (kolo 3, 22g): list sestavy se zastaralou kopií dílu – žádné „✓ bez nálezů“; export CSV / PDF s ⚠ asm.stale-copy", async () => {
    const ws = new MemoryWorkspace();
    clean(await run(ws, 'nový díl "Deska A"\nkvádr 100 60 20\nnový díl "Přidržovač"\nkvádr 40 30 10\nnová sestava "Nástroj"\nvložit "Deska A" ukotvit\nvložit "Přidržovač" v 10 10 20'));
    // ⚠ zazní u `kusovník` (jiný řádek než list) – list sestavy na dalším řádku ho musí zohlednit v konečném stavu
    const r = await run(ws, 'záložka "Deska A"\nmateriál 1.2379\nzáložka "Nástroj"\nkusovník\nvýkres A3');
    clean(r);
    expect(has(r, "asm.stale-copy")).toBe(true);
    expect(txt(r)).not.toMatch(/✓ výkres: list „List 1“ vyhodnocen bez nálezů/);
    // export (CLI --formats csv,pdf): ⚠ při každém výstupu, dokud se kopie neobnoví
    const { writeDocFormat } = await import("../engine/files");
    const asm = ws.docOf!(ws.tabs().find((t) => t.title === "Nástroj")!.id)!;
    for (const fmt of ["csv", "pdf"] as const) {
      const notes: { code: string; text?: string }[] = [];
      await writeDocFormat({ kernel: real as unknown as KernelApi, files: memoryFileSink() }, ws, asm, fmt, (n) => notes.push(n));
      expect(notes.filter((n) => n.code === "asm.stale-copy").map((n) => n.text)).toEqual([`${fmt.toUpperCase()} sestavy se zapisuje z kopie dílu: komponenta „Deska A“ je starší než díl „Deska A“ v záložce (materiál) – obnovit: sestava obnovit #1; kusovník a výkres ukazují údaje z vložení`]);
    }
    // po obnově: ✓ listu, export bez ⚠
    const ok = await run(ws, 'záložka "Nástroj"\nsestava obnovit "Deska A"\nvýkres A3');
    clean(ok);
    expect(txt(ok)).toMatch(/✓ výkres: list „List 1“ vyhodnocen bez nálezů/);
    const asm2 = ws.docOf!(ws.tabs().find((t) => t.title === "Nástroj")!.id)!;
    const notes2: { code: string }[] = [];
    await writeDocFormat({ kernel: real as unknown as KernelApi, files: memoryFileSink() }, ws, asm2, "csv", (n) => notes2.push(n));
    expect(notes2.filter((n) => n.code === "asm.stale-copy")).toEqual([]);
  }, 240_000);

  it("24b (kolo 6, 22g): `výkres export pdf vše` a souhrn dokumentace u zastaralé kopie – rada obnovit, ne „bez výkresu, bez čísla“", async () => {
    // repro S/w22/rev6d/r22g/d.txt: Deska A dostane po vložení materiál, číslo DA-001 a výkres; Přidržovač má výkres
    const ws = new MemoryWorkspace();
    clean(await run(ws, 'nový díl "Deska A"\nkvádr 100 60 20\nnový díl "Přidržovač"\nkvádr 40 30 10\nvýkres A4\nvýkres razítko číslo="PR-002"\nnová sestava "Nástroj"\nvložit "Deska A" ukotvit\nvložit "Přidržovač" v 10 10 20'));
    const r = await run(ws, 'záložka "Deska A"\nmateriál 1.2379\nvýkres razítko číslo="DA-001"\nzáložka "Nástroj"\nvýkres A3\nvýkres export pdf vše');
    clean(r);
    const exp = r.entries.filter((e) => e.line === 6);
    const miss = exp.filter((e) => /chybí výkres, číslo nebo označení materiálu/.test(e.text ?? "")).map((e) => e.text ?? "");
    expect(miss).toHaveLength(1);
    expect(miss[0]).not.toMatch(/Deska A \(bez výkresu/);
    expect(miss[0]).toMatch(/Deska A \(výkres, číslo má díl v záložce, kopie v sestavě je starší: sestava obnovit #1\)/);
    // řádek exportu sám řekne, že PDF sestavy je z kopie dílu (dřív jen dřívější řádek listu)
    expect(exp.filter((e) => e.code === "asm.stale-copy").map((e) => e.text)).toEqual(["PDF sestavy se zapisuje z kopie dílu: komponenta „Deska A“ je starší než díl „Deska A“ v záložce (číslo, materiál, výkres) – obnovit: sestava obnovit #1; kusovník a výkres ukazují údaje z vložení"]);
    // souhrn dokumentace: starší kopie se nepočítá jako „bez výkresu“
    const asm = ws.docOf!(ws.tabs().find((t) => t.title === "Nástroj")!.id)!;
    const notes = asmDocNotes(asm, (n) => ws.findPart(n));
    expect(notes[0]).toEqual({ code: "bom.docs", args: ["vyráběné 2 (starší kopie 1 – výkres má díl v záložce: sestava obnovit), normálie 0, nakupované 0"] });
    // po obnově: žádná rada obnovit, žádné asm.stale-copy u exportu
    const ok = await run(ws, 'záložka "Nástroj"\nsestava obnovit #1\nvýkres export pdf vše');
    clean(ok);
    expect(ok.entries.some((e) => e.code === "asm.stale-copy")).toBe(false);
    expect(txt(ok)).not.toMatch(/sestava obnovit #1\)/);
  }, 240_000);

  it("20 (kolo 3, bod 20): změna jen materiálu – stav, výstupy ani přepočítat vše netvrdí „odpovídá modelu“ / „Zbývá: nic“", async () => {
    const ws = new MemoryWorkspace();
    clean(await run(ws, `${PART}\nvýkres vydat`));
    const r = await run(ws, 'záložka "Deska A"\nmateriál 1.2379\nstav\nvýkres stav\nvýstupy zastaralé\npřepočítat vše');
    clean(r);
    const t = txt(r);
    expect(t).not.toMatch(/Vydání: rev\. A .* – odpovídá modelu/);
    expect(t).not.toMatch(/Zastaralé výstupy: žádné/);
    expect(t).not.toMatch(/Zbývá: nic/);
    expect(t).toMatch(/se změněnými údaji dílu/);
    expect(has(r, "drawing.stale")).toBe(true);
  }, 240_000);

  it("9: „Zastaralé výstupy: žádné“ jen bez změny modelu po vydání", async () => {
    const ws = new MemoryWorkspace();
    const r = await run(ws, `${PART}\nvýkres vydat\nvýstupy zastaralé`);
    clean(r);
    expect(txt(r)).toMatch(/Zastaralé výstupy: žádné/);
    expect(has(r, "drawing.stale")).toBe(false);
  });
});

// ───────────────────────── D3 (bod 18): kontrola kót – čisté funkce, ručně složené pohledy a kóty ─────────────────────────
describe("greens D3 – kontrola kót pro výrobu (bod 18)", () => {
  const TOP: CheckView = { key: "top", x0: 0, y0: -60, w: 100, h: 60, cam: { d: [0, 0, 1], x: [1, 0, 0] } };
  const FRONT: CheckView = { key: "front", x0: 0, y0: -20, w: 100, h: 20, cam: { d: [0, -1, 0], x: [1, 0, 0] } };
  let k = 0;
  const F = (f: Record<string, unknown>) => ({ id: `g${++k}`, ...f }) as unknown as Feature;
  const dim = (view: string, kind: "horizontal" | "vertical", a: [number, number], b: [number, number], suffix?: string): DrawingAnnotation => ({ id: `d${++k}`, view, type: "dim", kind, a, b, offset: 10, ...(suffix ? { suffix } : {}) });
  const plate = (): CadDoc => ({
    ...emptyDoc("Deska A"),
    features: [F({ name: "Kvádr 1", type: "box", size: [100, 60, 20], position: [0, 0, 0], centered: false, mode: "new" }), F({ name: "Díra 1", type: "hole", position: [15, 15, 20], axis: "Z", flip: false, diameter: 8, depth: 0, cbDiameter: 0, cbDepth: 0 })],
  });
  const sizes = (): DrawingAnnotation[] => [dim("top", "horizontal", [0, 0], [100, 0]), dim("top", "vertical", [0, 0], [0, -60]), dim("front", "vertical", [0, 0], [0, -20]), { id: "c1", view: "top", type: "dim", kind: "diameter", c: [15, -15], r: 4, ang: 45, offset: 8 }];
  // kolo 6: kóty polohy díry s bodem ve středu díry (pomocná čára vede na osu díry) – dřív [0; −5] a [−5; 0], které nové
  // pravidlo (bod 18: „jen kóta, jejíž pomocná čára vede na osu díry“) právem nepočítá
  const positions = (sx?: string): DrawingAnnotation[] => [dim("top", "horizontal", [0, -15], [15, -15], sx), dim("top", "vertical", [15, 0], [15, -15], sx)];

  it("10: ani úplná kontrola neříká „všech“ ani „kompletní“ – jen co zkontrolovala", () => {
    const r = checkSheet({ doc: plate(), views: [FRONT, TOP], annotations: [...sizes(), ...positions()], dimensions: "smart" });
    expect(dimCheckLine(r)).toMatch(/^Kontrola kót: velikosti 4\/4 · polohy 2\/2 · tolerance neověřeny \(funkční prvky nevyznačeny\)$/);
    expect(dimCheckLine(r)).not.toMatch(/všech|kompletní/);
  });
  it("11: všechny velikosti na listu, ale bez polohy díry → ⚠ drawing.dims-incomplete (dřív „všech … je na listu“)", () => {
    const r = checkSheet({ doc: plate(), views: [FRONT, TOP], annotations: sizes(), dimensions: "smart" });
    expect(r.size).toEqual({ ok: 4, total: 4 });
    expect(dimCheckIssues(r).map((i) => i.code)).toEqual(["drawing.dims-incomplete"]);
    const ok = checkSheet({ doc: plate(), views: [FRONT, TOP], annotations: [...sizes(), ...positions()], dimensions: "smart" });
    expect(dimCheckIssues(ok)).toEqual([]);
  });
  it("12b (fáze 2): hloubka závitové díry z popisu „M8 ↧10“ s odkazem na kružnici vrtáku – splněno; bez ↧ dál chybí", () => {
    const d: CadDoc = { ...emptyDoc("Deska Z"), features: [F({ name: "Kvádr 1", type: "box", size: [100, 60, 20], position: [0, 0, 0], centered: false, mode: "new" }), F({ name: "Díra Z", type: "hole", kind: "tapped", thread: "M8", position: [50, 30, 20], axis: "Z", flip: false, diameter: 6.8, depth: 10, cbDiameter: 0, cbDepth: 0 })] };
    const k1 = 3.4 * Math.SQRT1_2; // odkaz končí na kružnici vrtáku Ø6,8 (ne na jmenovitém M8)
    const call = (lines: string[]): DrawingAnnotation => ({ id: "cz", view: "top", type: "callout", tip: [50 + k1, -30 - k1], at: [70, -10], lines });
    const base = [dim("top", "horizontal", [0, 0], [100, 0]), dim("top", "vertical", [0, 0], [0, -60]), dim("front", "vertical", [0, 0], [0, -20]), dim("top", "horizontal", [0, -5], [50, -5]), dim("top", "vertical", [-5, 0], [-5, -30])];
    const ok = checkSheet({ doc: d, views: [FRONT, TOP], annotations: [...base, call(["M8 ↧10"])], dimensions: "smart" });
    expect(dimCheckLine(ok)).not.toMatch(/hloubka díry/);
    const no = checkSheet({ doc: d, views: [FRONT, TOP], annotations: [...base, call(["M8"])], dimensions: "smart" });
    expect(dimCheckLine(no)).toMatch(/chybí: .*10 \(hloubka díry\)/);
  });
  it("12: tolerance funkčních prvků „n/n“ jen s tolerancí na kótě (velikost = předepsaná H7); bez vyznačení „neověřeny“", () => {
    const d = plate();
    const marks: FunctionalMark[] = [{ id: "f1", kind: "functional", feature: d.features[1].id, tol: "H7" }];
    const diaT = (sx: string): DrawingAnnotation => ({ id: "c2", view: "top", type: "dim", kind: "diameter", c: [15, -15], r: 4, ang: 45, offset: 8, suffix: sx });
    const none = checkSheet({ doc: { ...d, functional: marks }, views: [FRONT, TOP], annotations: [...sizes(), ...positions()], dimensions: "smart" });
    expect(dimCheckLine(none)).toMatch(/funkční prvky: tolerance 0\/3/);
    // jiná tolerance průměru než předepsaná H7 → průměr nesplněný („liší se“), polohy s tolerancí ano
    const wrong = checkSheet({ doc: { ...d, functional: marks }, views: [FRONT, TOP], annotations: [...sizes().slice(0, 3), diaT("H9"), ...positions("±0,02")], dimensions: "smart" });
    expect(dimCheckLine(wrong)).toMatch(/funkční prvky: tolerance 2\/3/);
    const right = checkSheet({ doc: { ...d, functional: marks }, views: [FRONT, TOP], annotations: [...sizes().slice(0, 3), diaT("H7"), ...positions("±0,02")], dimensions: "smart" });
    expect(dimCheckLine(right)).toMatch(/funkční prvky: tolerance 3\/3/);
    expect(dimCheckLine(checkSheet({ doc: d, views: [FRONT, TOP], annotations: [...sizes().slice(0, 3), diaT("H7"), ...positions("±0,02")], dimensions: "smart" }))).toContain("tolerance neověřeny");
  });
  it("21 (kolo 6, bod 18): „velikosti n/n“ ne, když celkový rozměr nese jen kóta jiného směru (vodorovná 60 v horním = X)", () => {
    // repro S/w22/ver6/draw/p18/b2.txt – texty listu nesou i texty kót (withAnnotations), dřív je fallback hodnotou započetl
    const anns = [dim("top", "horizontal", [0, 0], [100, 0]), dim("top", "horizontal", [20, -30], [80, -30]), dim("front", "horizontal", [40, -5], [60, -5]), sizes()[3], ...positions()];
    const r = checkSheet({ doc: plate(), views: [FRONT, TOP], annotations: anns, dimensions: "smart", texts: ["100", "60", "20", "Ø8", "15", "15"].map((s) => ({ s, layer: "dim" })) });
    expect(dimCheckLine(r)).not.toMatch(/velikosti 4\/4/);
    expect(dimCheckLine(r)).toMatch(/chybí: 60 \(šířka Y\) \(celkové rozměry\); 20 \(výška Z\) \(celkové rozměry\)/);
    expect(dimCheckIssues(r).map((i) => i.code)).toEqual(["drawing.dims-incomplete"]);
  });
  it("22 (kolo 6, bod 18): „polohy n/n“ ne, když kóta polohy díry končí na shodné souřadnici mimo osu díry", () => {
    // repro S/w22/ver6/draw/p18/a.txt: kóta „15“ z [0; 45] do [15; 45], díra na [15; 15]
    const r = checkSheet({ doc: plate(), views: [FRONT, TOP], annotations: [...sizes(), dim("top", "horizontal", [0, -45], [15, -45]), dim("top", "vertical", [45, 0], [45, -15])], dimensions: "smart" });
    expect(dimCheckLine(r)).toMatch(/polohy 0\/2/);
    expect(dimCheckIssues(r).map((i) => i.code)).toEqual(["drawing.dims-incomplete"]);
  });
  it("13: kóty zapečené v pohledu – poloha nikdy ✓, jen nezkontrolováno", () => {
    const r = checkSheet({ doc: plate(), views: [FRONT, TOP], annotations: [], dimensions: "overall", texts: [{ s: "100", layer: "dim" }, { s: "60", layer: "dim" }, { s: "20", layer: "dim" }] });
    expect(r.items.filter((q) => q.kind === "pos").map((q) => q.status)).toEqual(["unchecked", "unchecked"]);
    expect(dimCheckLine(r)).toContain("polohy nezkontrolovány");
  });
});

describe("greens D4 – čitelný výkres sestavy a šablony hlavičky (body 17, 22j)", async () => {
  const { positionLines } = await import("../drawing-pos-agent");
  const { overlapIssueText, sheetOverlaps } = await import("../drawing-overlaps");
  const { docLine } = await import("../engine/protocol");
  const { applyDrawingCmd } = await import("../drawing-agent");
  const { parseAgentText } = await import("../agent");
  const sheet = (extra: Partial<import("../drawing").DrawingResult> = {}) =>
    ({ sheet: { name: "A3", w: 420, h: 297 }, views: [], scale: "1:1", scaleValue: 1, polys: [], texts: [], svg: "", dxf: "", warnings: [], tables: [], frameRect: { x: 20, y: 10, w: 390, h: 277 }, ...extra }) as import("../drawing").DrawingResult;

  it("14: bez kontroly „nezkontrolováno“ (nikdy 0); s překryvem nikdy 0; řádek D overlaps jen se zjištěnou hodnotou", () => {
    expect(positionLines(sheet(), {}, null).join("\n")).toMatch(/Překryvy na listu: nezkontrolováno/);
    const clash = sheet({ balloons: [{ pos: 1, x: 50, y: 50, a: [60, 60], r: 4 }, { pos: 2, x: 52, y: 51, a: [70, 60], r: 4 }] });
    const ov = sheetOverlaps(clash);
    expect(ov.total).toBeGreaterThan(0);
    const txt = positionLines(clash, {}, ov).join("\n");
    expect(txt).not.toMatch(/Překryvy na listu: 0/);
    expect(overlapIssueText(ov)).toMatch(/překryvů/);
    expect(docLine({ ref: "a", name: "a", kind: "assembly", sheets: 1 })).not.toMatch(/overlaps=/);
  });

  it("18 (kolo 3, bod 17): centrovací značka přes záhlaví kusovníku → překryv (nikdy „Překryvy na listu: 0“)", () => {
    const s = sheet({ polys: [{ layer: "frame", width: 0.7, pts: [[215, 297], [215, 282]] }], tables: [{ kind: "bom", x: 50, y: 266, w: 180, h: 21 }] });
    const ov = sheetOverlaps(s);
    expect(ov.total).toBe(1);
    expect(positionLines(s, {}, ov).join("\n")).not.toMatch(/Překryvy na listu: 0/);
  });

  it("23 (kolo 6, bod 17): odkaz přes kotvu jiné pozice nebo přes kótu (čára, text) → nikdy „Překryvy na listu: 0“", () => {
    // repro S/w22/repro/17/repro-100.txt (odkaz 72 0,14 mm od kotvy 82) a repro.txt (odkaz 21 přes pomocnou čáru kóty 245)
    const anchor = sheet({ balloons: [{ pos: 1, x: 60, y: 60, a: [110, 120], r: 4 }, { pos: 2, x: 40, y: 110, a: [85.1, 90], r: 4 }] });
    const oa = sheetOverlaps(anchor);
    expect(oa.byKind["leader-anchor"]).toBe(1);
    expect(positionLines(anchor, {}, oa).join("\n")).not.toMatch(/Překryvy na listu: 0/);
    const dimLine = sheet({ polys: [{ layer: "dim", pts: [[230, 40], [230, 140]] }], balloons: [{ pos: 3, x: 260, y: 70, a: [205, 110], r: 4 }] });
    const od = sheetOverlaps(dimLine);
    expect(od.byKind["leader-dim"]).toBe(1);
    expect(positionLines(dimLine, {}, od).join("\n")).not.toMatch(/Překryvy na listu: 0/);
    const dimText = sheet({ texts: [{ x: 150, y: 90, s: "100", size: 3.5, anchor: "middle", layer: "dim" }] as never, balloons: [{ pos: 4, x: 150, y: 60, a: [150, 110], r: 4 }] });
    const ot = sheetOverlaps(dimText);
    expect(ot.byKind["leader-dim"]).toBe(1);
    expect(positionLines(dimText, {}, ot).join("\n")).not.toMatch(/Překryvy na listu: 0/);
    // protipříklad: odkaz mimo kotvy i kóty = 0 (kontrola nehlásí falešný nález)
    const clear = sheet({ polys: [{ layer: "dim", pts: [[330, 40], [330, 140]] }], balloons: [{ pos: 5, x: 60, y: 200, a: [100, 200], r: 4 }] });
    expect(sheetOverlaps(clear).total).toBe(0);
  });

  it("15: „nevešlo se 0“ jen bez ztracených pozic; zámek jen s uloženou polohou", () => {
    const lost = sheet({ balloons: [{ pos: 1, x: 50, y: 50, a: [60, 60], r: 4, lost: true }], balloonInfo: { lost: 1, crossings: 0, missingView: [] } });
    expect(positionLines(lost, {}, sheetOverlaps(lost)).join("\n")).toMatch(/nevešlo se 1/);
  });

  it("25 (kolo 6, 22j): bez trvalého Nastavení (CLI, test) žádné „uložena … i do Nastavení“ – „jen pro tento běh“", async () => {
    const ws = new MemoryWorkspace();
    const r = await run(ws, 'nový díl "Deska A"\nkvádr 100 60 20\nvýkres A4\nvýkres hlavička uložit "Firma" výchozí firma="Firma s.r.o."');
    expect(txt(r)).not.toMatch(/uložena do dokumentu i do Nastavení/);
    expect(txt(r)).toMatch(/uložena do dokumentu; v Nastavení jen pro tento běh · výchozí pro nové listy/);
  });

  it("16: šablona hlavičky, která neexistuje, = ✗ (ne ✓); logo neexistujícího souboru = ✗", async () => {
    const doc = { id: "d", name: "Deska", kind: "part", features: [], material: "ocel" } as unknown as CadDoc;
    const cmd = (l: string) => (parseAgentText(l).ops[0] as unknown as { cmd: never }).cmd;
    const no = async () => {
      throw new Error("bez výpočtu");
    };
    await expect(applyDrawingCmd(doc, cmd('výkres hlavička použít "Nikde"'), no)).rejects.toThrow(/neexistuje/);
    await expect(applyDrawingCmd(doc, cmd('výkres razítko logo="nikde.png"'), no, { input: async () => null })).rejects.toThrow(/není připojený/);
  });
});

// ───────────────────────── kolo 7 (body 19, 20, 22g): skutečné jádro ─────────────────────────
describe("greens kolo 7 – přepočítat vše, materiál razítka, výkresy dílů", async () => {
  setHostAssets({ font: async (name) => new Uint8Array(fs.readFileSync(path.join(FONTS, name))).buffer });
  const { inProcessTransport } = await import("../kernel-inprocess");
  const { formatShort } = await import("../engine/protocol");
  const real = makeKernelClient(inProcessTransport({ locateFile: (file) => (file.endsWith(".wasm") ? WASM : file) }));
  await real.init();
  const run = (ws: MemoryWorkspace, t: string) => runScript(ws, t, { kernel: real as unknown as KernelApi, files: memoryFileSink(), inputs: memoryFileSource({}), now: () => Date.now() });
  const docOf = (ws: MemoryWorkspace, name: string): CadDoc => ws.docOf!(ws.tabs().find((x) => x.title === name)!.id)!;
  // repro S/w22/p2/fixr7d/p20/a.txt = korpus 78 (zvětšená deska prorazí přidržovač)
  const ASM = 'nový díl "Deska A"\nkvádr 100 60 20\nnový díl "Přidržovač"\nkvádr 40 30 10\nnová sestava "Nástroj"\nvložit "Deska A" ukotvit\nvložit "Přidržovač" v 10 10 20\nkolize';

  it("26 (kolo 7, bod 20): přepočítat vše s nalezenou kolizí – žádné „✓ kontrola kolizí znovu“, ⚠ s počtem, warned=1", async () => {
    const ws = new MemoryWorkspace();
    await run(ws, ASM);
    const r = await run(ws, 'záložka "Deska A"\nupravit "Kvádr 1" size=100;60;25\nzáložka "Nástroj"\npřepočítat vše');
    const t = txt(r);
    expect(t).not.toMatch(/✓ kontrola kolizí znovu/);
    expect(t).toMatch(/⚠ kontrola kolizí znovu \(kolize\) – nalezeno kolizí: 1 – viz ⚠ výše/);
    expect(formatShort(r)).toMatch(/recomputed=\d+ left=\d+ .* warned=1/);
    // protipříklad: obnova, po které kolize není (deska tenčí) → ✓ a warned=0
    const ws2 = new MemoryWorkspace();
    await run(ws2, ASM);
    const ok = await run(ws2, 'záložka "Deska A"\nupravit "Kvádr 1" size=100;60;15\nzáložka "Nástroj"\npřepočítat vše');
    expect(txt(ok)).toMatch(/✓ kontrola kolizí znovu \(kolize\)\n/);
    expect(formatShort(ok)).toMatch(/warned=0/);
  }, 240_000);

  it("31 (kolo 7b, bod 20): pohybová studie po změně dílu – výstupy ji vypíší, přepočítat vše nikdy „Zbývá: nic“ bez přepočtu, ⚠ s nálezem", async () => {
    // repro S/rev-w22d-r7/e2.txt (oponent): dřív „Zastaralé výstupy: žádné“ a warned=0, přestože `pohyb stav` hlásil motion.stale
    const ws = new MemoryWorkspace();
    await run(ws, 'nový díl "Deska A"\nkvádr 60 40 10\nnový díl "Přidržovač"\nkvádr 10 10 10\nnová sestava "Sestava A"\nvložit "Deska A" ukotvit\nvložit "Přidržovač" v 40 10 30\nsestava vazba vzdálenost "Přidržovač" spodní "Deska A" horní hodnota 20\npohyb motor lineární vazba 1 20..-5 kroky 5 kolize\npohyb spustit');
    const ch = await run(ws, 'záložka "Deska A"\nupravit "Kvádr 1" size=70;40;10\nzáložka "Sestava A"\nsestava obnovit vše\nvýstupy');
    const t1 = txt(ch);
    expect(t1).not.toMatch(/Zastaralé výstupy: žádné/);
    expect(t1).toMatch(/⚠ pohybová studie – výsledek neplatí – od výpočtu se změnilo: geometrie dílu „Deska A“ → pohyb spustit/);
    expect(formatShort(ch)).toMatch(/stale=1 .*analysis=1/);
    const r = await run(ws, "přepočítat vše\nvýstupy");
    const t = txt(r);
    expect(t).not.toMatch(/✓ pohybová studie znovu/); // studie našla kolizi (clash.real) – ne „✓“
    expect(t).toMatch(/⚠ pohybová studie znovu \(pohyb spustit\) – s varováním: clash\.real/);
    expect(formatShort(r)).toMatch(/warned=1/);
    expect(t).toMatch(/Zastaralé výstupy: žádné/); // po přepočtu výsledek platí – a teprve teď
    // protipříklad: studie bez kolize (přidržovač nedojede do desky) → ✓ a warned=0
    const ws2 = new MemoryWorkspace();
    await run(ws2, 'nový díl "Deska A"\nkvádr 60 40 10\nnový díl "Přidržovač"\nkvádr 10 10 10\nnová sestava "Sestava A"\nvložit "Deska A" ukotvit\nvložit "Přidržovač" v 40 10 30\nsestava vazba vzdálenost "Přidržovač" spodní "Deska A" horní hodnota 20\npohyb motor lineární vazba 1 20..5 kroky 5 kolize\npohyb spustit');
    const ok = await run(ws2, 'záložka "Deska A"\nupravit "Kvádr 1" size=70;40;10\nzáložka "Sestava A"\npřepočítat vše');
    expect(txt(ok)).toMatch(/✓ pohybová studie znovu \(pohyb spustit\)\n/);
    expect(formatShort(ok)).toMatch(/warned=0/);
  }, 240_000);

  it("32 (kolo 7b, bod 20): vydaný list a pak prvek v témže běhu (dokument měněný na místě) – nikdy „odpovídá modelu“", async () => {
    // repro S/w22/p2/fixr7d2/rv2.txt: dřív revize r·4273fb i po díře (mezipaměť podle objektu dokumentu) → „Zastaralé výstupy: žádné“
    const r = await run(new MemoryWorkspace(), 'nový díl "Deska F"\nkvádr 60 40 10\nvýkres A4\nvýkres vydat\ndíra 6 v 20 20 10 skrz\nvýstupy');
    const t = txt(r);
    expect(t).not.toMatch(/Zastaralé výstupy: žádné/);
    expect(t).not.toMatch(/List 1: Vydání: rev\. A z modelu r·\w+ \([^)]*\) – odpovídá modelu/);
    expect(t).toMatch(/1\. ⚠ list „List 1“ rev\. A – vydán z modelu (r·\w{6}), model je teď (?!\1)r·\w{6} → výkres vydat B/);
    expect(has(r, "drawing.stale")).toBe(true);
    // protipříklad: bez změny modelu po vydání list odpovídá
    const ok = await run(new MemoryWorkspace(), 'nový díl "Deska F"\nkvádr 60 40 10\ndíra 6 v 20 20 10 skrz\nvýkres A4\nvýkres vydat\nvýstupy');
    expect(txt(ok)).toMatch(/Zastaralé výstupy: žádné/);
  }, 240_000);

  it("27 (kolo 7, bod 20): obnova kopie ztratí referenci vazby – „Zbývá“ ji vypíše, žádné „Zbývá: nic“ ani ✓ obnovy", async () => {
    // repro S/w22/p2/fixr7d/p20/b.txt
    const ws = new MemoryWorkspace();
    await run(ws, 'nový díl "Deska A"\nkvádr 60 40 10\nkvádr 20 40 5 v 0 0 5 odebrat\nnový díl "Přidržovač"\nkvádr 10 10 10\nnová sestava "Sestava A"\nvložit "Deska A" ukotvit\nvložit "Přidržovač" v 40 10 30\nsestava vazba kontakt "Přidržovač" spodní "Deska A" F3');
    const r = await run(ws, 'záložka "Deska A"\nsmazat "Kvádr 2"\nzáložka "Sestava A"\npřepočítat vše');
    const t = txt(r);
    expect(t).not.toMatch(/Zbývá: nic/);
    expect(t).not.toMatch(/✓ kopie dílů v sestavě obnoveny/);
    expect(t).toMatch(/⚠ kopie dílů v sestavě obnoveny z dílů \(sestava obnovit vše\) – s varováním: mate\.lost/);
    expect(t).toMatch(/Zbývá udělat ručně \(1\)[\s\S]*⚠ vazba 1 Kontakt – ztracená reference po úpravě dílu → sestava vazba 1 plocha … \/ sestava vazba 1 smazat/);
  }, 240_000);

  it("28 (kolo 7, 22g): třída po označení jiné třídy = ⚠ material.class-conflict (ne ✓); razítko textem pozná třídu", async () => {
    const ws = new MemoryWorkspace();
    const r = await run(ws, 'nový díl "Přidržovač"\nkvádr 40 30 10\nmateriál ČSN 11 423\nmateriál nerez');
    expect(txt(r)).not.toMatch(/✓ materiál = Nerez/);
    expect(has(r, "material.class-conflict")).toBe(true);
    expect(r.entries.find((e) => e.code === "material.class-conflict")!.text).toMatch(/„ČSN 11 423“ je třídy Ocel, hustota se ale počítá podle třídy Nerez/);
    // protipříklad: třída shodná s označením / neznámé označení – bez ⚠ konfliktu
    const ok = await run(new MemoryWorkspace(), 'nový díl "Přidržovač"\nkvádr 40 30 10\nmateriál ČSN 11 423\nmateriál ocel\nmateriál Hardox 400\nmateriál ocel');
    expect(has(ok, "material.class-conflict")).toBe(false);
    expect(txt(ok)).toMatch(/✓ materiál = Ocel \(7\.85 g\/cm³\) · označení „Hardox 400“ v razítku zůstává/);
    // razítko textem: ČSN 11 523 na hliníkovém dílu → třída ocel + ℹ material.class (dřív hustota hliníku bez slova)
    const ws3 = new MemoryWorkspace();
    const st = await run(ws3, 'nový díl "Deska A"\nkvádr 100 60 20\nmateriál hliník\nvýkres A4\nvýkres razítko materiál="ČSN 11 523"');
    expect(docOf(ws3, "Deska A")).toMatchObject({ material: "ocel", materialName: "ČSN 11 523" });
    expect(st.entries.some((e) => e.code === "material.class" && e.line === 5)).toBe(true);
    // neznámé označení v razítku = ⚠ density-assumed (jako příkaz materiál)
    const st2 = await run(new MemoryWorkspace(), 'nový díl "Deska A"\nkvádr 100 60 20\nvýkres A4\nvýkres razítko materiál="Hardox 400"');
    expect(st2.entries.some((e) => e.code === "material.density-assumed" && e.line === 4)).toBe(true);
  }, 240_000);

  it("28b (kolo 7b, 22g): podtřída oceli není rozpor; rozpor tříd hlásí i stav, kusovník a export (ne jen řádek příkazu)", async () => {
    // repro S/rev-w22d-r7/a.txt: dřív ⚠ „ČSN 11 523 je třídy Ocel, hustota … podle třídy 1.2311 … si odporují“
    const sub = await run(new MemoryWorkspace(), 'nový díl "Deska A"\nkvádr 100 60 20\nmateriál ČSN 11 523\nmateriál 1.2311\nstav');
    expect(has(sub, "material.class-conflict")).toBe(false);
    expect(txt(sub)).not.toMatch(/si odporují/);
    expect(sub.entries.find((e) => e.code === "material.class-family")?.text).toMatch(/„ČSN 11 523“ je třídy Ocel – hustota podle zvolené třídy 1\.2311 .*7\.85 g\/cm³\) ze stejné skupiny/);
    // skutečný rozpor (ocel × nerez): ⚠ i na řádku `stav`, `kusovník` sestavy a exportu výkresu – dřív jen na řádku `materiál`
    const ws = new MemoryWorkspace();
    const r = await run(ws, 'nový díl "Přidržovač"\nkvádr 40 30 10\nmateriál ČSN 11 423\nmateriál nerez\nstav\nvýkres A4\nvýkres export pdf\nnová sestava "Nástroj"\nvložit "Přidržovač" ukotvit\nkusovník');
    const lines = r.entries.filter((e) => e.code === "material.class-conflict").map((e) => e.line);
    expect(lines).toEqual(expect.arrayContaining([4, 5, 7, 10]));
    expect(r.entries.find((e) => e.code === "material.class-conflict" && e.line === 10)?.text).toMatch(/díl „Přidržovač“: materiál „ČSN 11 423“ je třídy Ocel, hustota se ale počítá podle třídy Nerez/);
    expect(r.entries.find((e) => e.code === "material.class-conflict" && e.line === 7)?.text).toMatch(/^PDF: materiál „ČSN 11 423“/);
    // protipříklad: bez rozporu nic z toho
    const ok = await run(new MemoryWorkspace(), 'nový díl "Přidržovač"\nkvádr 40 30 10\nmateriál ČSN 11 423\nstav\nvýkres A4\nvýkres export pdf\nnová sestava "Nástroj"\nvložit "Přidržovač" ukotvit\nkusovník');
    expect(has(ok, "material.class-conflict")).toBe(false);
  }, 240_000);

  it("29 (kolo 7, bod 19): výkresy dílů – list jen vyráběnému dílu bez výkresu; díl mimo záložku ⚠, nikdy tiše", async () => {
    // repro S/w22/p2/fixr7d/p19/a.txt
    const ws = new MemoryWorkspace();
    const SETUP = 'nový díl "Deska A"\nkvádr 100 60 20\nnový díl "Přidržovač"\nkvádr 40 30 10\nvýkres A3\nnový díl "Pouzdro"\nválec 10 20\ndruh nakupovaný katalog "K-1"\nnová sestava "Nástroj"\nvložit "Deska A" ukotvit\nvložit "Přidržovač" v 10 10 20\nvložit "Pouzdro" v 60 10 20\nnormálie M8x20';
    await run(ws, SETUP);
    const r = await run(ws, "výkresy dílů");
    const t = txt(r);
    expect(t).toMatch(/Výkresy dílů sestavy „Nástroj“ – vyráběných dílů 2 \(normálie 1 a nakupované 1 výkres nedostanou\)/);
    expect(t).toMatch(/→ Deska A – list „List 1“ vyhodnocen bez nálezů/);
    expect(t).toMatch(/· Přidržovač \(1 listů\)/);
    expect(formatShort(r)).toMatch(/make=2 created=1 existing=1 missing=0/);
    expect(docOf(ws, "Deska A").drawings?.length).toBe(1);
    expect(docOf(ws, "Pouzdro").drawings?.length ?? 0).toBe(0);
    expect(docOf(ws, "Přidržovač").drawings?.length).toBe(1);
    expect(ws.present().name).toBe("Nástroj"); // zpět v sestavě
    expect(has(r, "bom.make-incomplete")).toBe(false);
    // opakování: nic nového („Výkres už mají (2)“), žádné „Založeno“
    const again = await run(ws, 'záložka "Nástroj"\nvýkresy dílů');
    expect(txt(again)).not.toMatch(/Založeno/);
    expect(formatShort(again)).toMatch(/created=0 existing=2/);
    // díl zavřený (jen kopie v sestavě) → ⚠ bom.make-incomplete, „Nezaloženo“
    const ws2 = new MemoryWorkspace();
    await run(ws2, 'nový díl "Deska A"\nkvádr 100 60 20\nnová sestava "Nástroj"\nvložit "Deska A" ukotvit');
    await run(ws2, 'zavřít záložku "Deska A"');
    const miss = await run(ws2, 'záložka "Nástroj"\nvýkresy dílů');
    expect(txt(miss)).not.toMatch(/vyhodnocen bez nálezů/);
    expect(txt(miss)).toMatch(/Nezaloženo – díl není otevřený v záložce \(1\)/);
    expect(has(miss, "bom.make-incomplete")).toBe(true);
    // v dílu = ✗ s radou (žádné tiché nic)
    const part = await run(new MemoryWorkspace(), 'nový díl "Deska A"\nkvádr 10 10 10\nvýkresy dílů');
    expect(part.entries.some((e) => e.level === "error" && /jen v sestavě/.test(e.text ?? ""))).toBe(true);
  }, 240_000);

  it("30 (kolo 7, bod 17): A1 se 100 díly – křížení odkazů 0, překryvy 0; počet odpovídá skutečným průsečíkům čar", async () => {
    const { countCrossings } = await import("../drawing-balloons");
    const src = fs.readFileSync(path.resolve(__dirname, "../engine/__corpus__/79f-balloons-100-a1.txt"), "utf8");
    const ws = new MemoryWorkspace();
    const r = await run(ws, src.split("\n").filter((l) => !l.startsWith("#")).join("\n"));
    const t = txt(r);
    expect(t).toMatch(/Pozice: 100 \(.*\) · .* · nevešlo se 0 · křížení odkazů 0/);
    expect(t).toMatch(/Překryvy na listu: 0 \(zkontrolováno/);
    // „0“ musí být skutečný stav čar: bez kontroly by test prošel i s křížícím se rozmístěním
    expect(countCrossings([{ x: 0, y: 0, a: [10, 10] }, { x: 10, y: 0, a: [0, 10] }])).toBe(1);
    // nejdelší odkaz (kolo 7b – tvrzení „162 → 139 mm“ bez testu): spočítaný list téže sestavy, délka od středu kroužku ke kotvě;
    // před krokem 3b 162 mm, po něm 139 mm (mez 145 mm nechává rezervu na drobné změny rozvržení, 162 by neprošlo)
    const { renderSheet } = await import("../drawing-export");
    const { drawingMemo } = await import("../engine/sheet-eval");
    const { drawExtras } = await import("../engine/asm-status");
    const asm = ws.present();
    const sh = await renderSheet(asm, 0, drawingMemo(real as unknown as KernelApi), await drawExtras(ws, real as unknown as KernelApi, asm, { flat: true }));
    const bs = (sh.out.balloons ?? []).map((b) => ({ x: b.x, y: b.y, a: b.a ?? ([b.x, b.y] as [number, number]) }));
    expect(bs.length).toBe(100);
    const longest = Math.max(...bs.map((b) => Math.hypot(b.a[0] - b.x, b.a[1] - b.y)));
    expect(longest).toBeLessThan(145);
    expect(countCrossings(bs)).toBe(0);
  }, 240_000);
});
