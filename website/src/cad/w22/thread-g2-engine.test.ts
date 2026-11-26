/**
 * Vlna 22, body 22a a 22d v enginu (stejný běh jako konzole aplikace a CLI – skutečné jádro in-process):
 *  – přesná kontrola platnosti: `kontrola přesně` (CS / EN / DE), řádek Geometrie „· přesná kontrola“, řádek D `vcheck=exact`,
 *    JSON `docs[].validCheck`; po změně modelu výsledek neplatí (zpět „· rychlá kontrola“, bez vcheck);
 *  – automatická přesná kontrola před exportem STEP; export = model (žádné SameParameter / opravy tolerancí – kritik „weak“:
 *    zpětně načtený STEP má objem i obálku modelu a model je po exportu stále přesně platný);
 *  – závit z označení v protokolu: kódy thread.* (přísný režim je umí vynechat jmenovitě), „m18 x 1,5“ bez chyby zápisu.
 */
import { beforeAll, describe, expect, it } from "vitest";
import { setLang } from "../i18n";
import type { EngineHost } from "../engine/host";
import type { KernelApi } from "../engine/kernel";
import { MemoryWorkspace } from "../engine/memory-workspace";
import { finalizeReport } from "../engine/protocol";
import { runScript } from "../engine/run";
import { runReport } from "../engine/run-protocol";
import { exactBeforeExport } from "../engine/validity-store";
import { retolLimit } from "../agent-out";
import { emptyDoc, type CadDoc } from "../types";
import type { ValidityResult } from "../validity";
import { greenThenRed, realHost } from "./real-host";

let host: () => EngineHost;
beforeAll(async () => {
  setLang("cs");
  host = await realHost();
}, 120_000);

const full = async (text: string, lang: "cs" | "en" | "de" = "cs") => {
  setLang(lang);
  try {
    return finalizeReport(await runReport(new MemoryWorkspace(), text, host(), { lang }), { full: true });
  } finally {
    setLang("cs");
  }
};

describe("přesná kontrola platnosti – co proběhlo, se vždy vypíše", () => {
  it("kontrola přesně → valid=1 vcheck=exact, „platné (přesná kontrola)“; stav pak „· přesná kontrola“, D vcheck=exact, JSON validCheck", { timeout: 180_000 }, async () => {
    const r = await full('nový díl "Šroub"\nválec 18 30\nzávit m18 x 1,5 délka 20 v 0 0 10 šroubovice\nstav\nkontrola přesně\nstav');
    expect(r.entries.filter((e) => e.level === "error")).toEqual([]);
    expect(r.full).toMatch(/= L5 check "Šroub" part .* solids=1 valid=1 vcheck=exact holes=0/);
    expect(r.full).toMatch(/Kontrola „Šroub“: .* · těles 1 · platné \(přesná kontrola\)/);
    const geo = (r.full ?? "").split("\n").filter((l) => l.includes("Geometrie:"));
    expect(geo).toEqual(["  Geometrie: platná · 1 těleso · rychlá kontrola", "  Geometrie: platná · 1 těleso · přesná kontrola"]);
    expect(r.protocol).toMatch(/^D "Šroub" part feat=2\/0\/0 .* solids=1 valid=1 vcheck=exact$/m);
    expect(r.docs[0]).toMatchObject({ valid: true, validCheck: "exact" });
    expect(greenThenRed(r.entries)).toEqual([]);
  });
  it("výsledek přesné kontroly neplatí pro změněný model: zpět „· rychlá kontrola“, bez vcheck=exact, JSON fast", { timeout: 180_000 }, async () => {
    const r = await full('nový díl "Deska"\nkvádr 40 20 10\nkontrola přesně\ndíra 4 skrz v 10 10\nstav');
    expect(r.full).toMatch(/= L3 check "Deska" .* valid=1 vcheck=exact/);
    expect(r.full).toMatch(/Geometrie: platná · 1 těleso · rychlá kontrola/);
    expect(r.full).not.toMatch(/Geometrie: [^\n]*přesná kontrola/);
    expect(r.protocol).not.toMatch(/^D .*vcheck=exact/m); // = L3 check … vcheck=exact patří řádku kontroly, ne řádku D
    expect(r.docs[0]).toMatchObject({ valid: true, validCheck: "fast" });
  });
  it("EN check exact / DE prüfen genau", { timeout: 180_000 }, async () => {
    const en = await full("new part P\nbox 20 20 10\ncheck exact\nstatus", "en");
    expect(en.full).toMatch(/valid \(exact check\)/);
    expect(en.full).toMatch(/Geometry: valid · 1 body · exact check/);
    const de = await full("neu teil P\nquader 20 20 10\nprüfen genau\nstatus", "de");
    expect(de.full).toMatch(/gültig \(genaue Prüfung\)/);
  });
});

describe("export STEP: přesná kontrola před exportem, export = model (bez SameParameter)", () => {
  // fáze 2 (22a, falešná zelená): dřív tu stálo „✓ kontrola STEP … → věrná kopie modelu“, ale soubor po zpětném načtení
  // přesnou kontrolou neprojde (nezávislá kontrola souboru: valid(exact)=false). Nově ⚠ out.reload-invalid, nikdy „věrná kopie“.
  it("vnější a vnitřní závit šroubovicí: ✓ těleso přesně platné, STEP zpětně = model (objem, obálka, tělesa), ale soubor přesně neplatný → ⚠ out.reload-invalid, ne „věrná kopie“; model po exportu beze změny", { timeout: 300_000 }, async () => {
    for (const [name, body, thr] of [
      ["Šroub", "válec 18 30", "závit M18×1,5 délka 20 v 0 0 10 šroubovice"],
      ["Matice", "trubka 30 16.5 20", "závit M18×1,5 délka 18 v 0 0 1 vnitřní šroubovice"],
    ]) {
      const ws = new MemoryWorkspace();
      const h = host();
      const r = finalizeReport(await runReport(ws, `nový díl "${name}"\n${body}\n${thr}\nexport step`, h), { full: true });
      const lines = (r.full ?? "").split("\n");
      const at = lines.findIndex((l) => /^✓ L4 export STEP/.test(l));
      expect(at, name).toBeGreaterThanOrEqual(0);
      expect(lines[at + 1], name).toMatch(/^✓ L4 těleso: přesná kontrola platnosti \(BRepCheck přesnou metodou\) – platné, ploch \d+ · [\d,]+ s$/);
      expect(lines[at + 2], name).toMatch(/^⚠ L4 out\.reload-invalid .*kontrola STEP: soubor znovu načten jádrem – těles: 1, .*rozdíl 0,0000 %.* – shoda s modelem, ale soubor po načtení NEPROJDE přesnou kontrolou platnosti \(BRepCheck přesnou metodou\): vadných ploch \d+ z \d+ \(rychlá kontrola: platné; model přesně platný\)/);
      expect(r.full ?? "", name).not.toMatch(/věrná kopie/);
      // export model neupravil: znovu načtený soubor = model a model je i po exportu přesně platný
      const d: CadDoc = ws.present();
      expect(d.name).toBe(name);
      const bytes = new Uint8Array(await h.kernel.exportFile(d, "step"));
      const { model, file } = await h.kernel.exportStats(d, bytes, "step");
      expect(file.solids).toBe(model.solids);
      expect(Math.abs(file.volume - model.volume) / model.volume).toBeLessThan(1e-6);
      for (let i = 0; i < 3; i++) for (let j = 0; j < 2; j++) expect(Math.abs(file.bbox[j][i] - model.bbox[j][i])).toBeLessThan(1e-4);
      // soubor: rychlá kontrola platné, přesná ne (tolerance hran ze čtečky STEP); model přesně platný
      expect(file, name).toMatchObject({ valid: true, validExact: false });
      expect(file.badFaces, name).toBeGreaterThan(0);
      expect(model.validExact, name).toBe(true);
      // kolo 4 (rozbor příčiny, oponent): u závitu z prvku Závit nepomůže ani přepočet tolerancí po načtení – přepočet BRepLib
      // vzorkuje a tolerance pár hran podhodnotí. Naměřená odchylka křivek hran od ploch je v souboru STEJNÁ jako v modelu (zápis
      // geometrii nezhoršil – není to vada exportu) a na vadných plochách přesahuje toleranci hran i po přepočtu.
      expect(file.retolValid, name).toBe(false);
      expect(file.retolMaxTol, name).toBeGreaterThan(0);
      expect(model.maxTol, name).toBeGreaterThan(0);
      expect(file.devSamples, name).toBeGreaterThanOrEqual(50);
      expect(model.devSamples, name).toBe(file.devSamples);
      expect(file.devMax!, name).toBeGreaterThan(0);
      expect(file.devMax!, name).toBeLessThanOrEqual(model.devMax! * 1.01 + 1e-9);
      expect(file.devMax!, name).toBeLessThan(1e-3);
      expect(file.devOver!, name).toBeGreaterThan(0);
      expect(lines[at + 2], name).toMatch(/ani po přepočtu tolerancí hran a vrcholů soubor přesnou kontrolou neprojde \(vadných ploch \d+\): odchylka křivek hran od ploch v souboru nejvýše [\d,]+e-\d mm, v modelu [\d,]+e-\d mm \(vzorkováno \d+ bodů na hranu\); na vadných plochách přesahuje odchylka toleranci hrany i po přepočtu \(hran: \d+; přepočet vzorkuje\) – zápis odchylku nezvětšil, čtečka STEP a přepočet tolerance hran podhodnotí/);
      expect(lines[at + 2], name).not.toMatch(/geometrie souboru odpovídá|příčina není jen|příčina nezjištěna/);
      const after = await h.kernel.validity(d);
      expect(after).toMatchObject({ method: "exact", valid: true });
      expect(r.docs[0], name).toMatchObject({ valid: true, validCheck: "exact" });
    }
  });
  // kolo 4 (rozbor cad-w22-a3 22h): model z e2e A3 (válec Ø20 + helixSweep radius 9 = skrytý kanál) je přesnou kontrolou
  // platný; soubor STEP po zpětném načtení výchozí čtečkou ne – zapisovač to nespraví (STEP tolerance hran nenese; nastavení
  // zapisovače výsledek čtení nemění), po přepočtu tolerancí načteného souboru projde. Pravda = ⚠ out.reload-invalid
  // s doloženou příčinou, nikdy ✓ „věrná kopie“ – totéž čeká e2e cad-w22-a3 (exportFile i export z menu)
  it("model z e2e A3 (helixSweep r 9 ve válci Ø20): model přesně platný, soubor po načtení ne, po přepočtu tolerancí ano → ⚠ out.reload-invalid s doloženou příčinou, ne ✓", { timeout: 300_000 }, async () => {
    const ws = new MemoryWorkspace();
    const h = host();
    const r = finalizeReport(await runReport(ws, 'nový díl "Export A"\nválec 20 30\nprvek surf.helixSweep profile=thread60 radius=9 depth=0.8 pitch=1.5 turns=12 mode=cut\nexport step', h), { full: true });
    const full = r.full ?? "";
    expect(full).toMatch(/^✓ L4 těleso: přesná kontrola platnosti \(BRepCheck přesnou metodou\) – platné, ploch \d+ · [\d,]+ s$/m);
    expect(full).toMatch(/^⚠ L4 out\.reload-invalid "Export A": kontrola STEP: .* – shoda s modelem, ale soubor po načtení NEPROJDE přesnou kontrolou platnosti \(BRepCheck přesnou metodou\): vadných ploch \d+ z \d+ \(rychlá kontrola: platné; model přesně platný\); čtečka STEP nastaví tolerance hran menší než odchylka křivek od ploch – po přepočtu tolerancí hran a vrcholů soubor přesnou kontrolou projde s tolerancí nejvýše [\d,]+e-\d mm \(mez [\d,]+e-\d mm = největší tolerance modelu\) → geometrie souboru odpovídá/m);
    expect(full).not.toMatch(/věrná kopie/);
    expect(r.protocol).toMatch(/check=fail/);
    const d: CadDoc = ws.present();
    const { model, file } = await h.kernel.exportStats(d, new Uint8Array(await h.kernel.exportFile(d, "step")), "step");
    expect(model.validExact).toBe(true);
    expect(file).toMatchObject({ valid: true, validExact: false, retolValid: true });
    // „geometrie souboru odpovídá“ jen s tolerancí po přepočtu do meze (oponent kolo 4: změřeno 6e-7 mm, model 6,3e-5 mm)
    expect(file.retolMaxTol!).toBeLessThanOrEqual(retolLimit(model.maxTol));
    expect(file.retolMaxTol!).toBeLessThan(1e-5);
    // rozbor mění jen tolerance načteného souboru, ne model (mezipaměť stavby): model je po exportu stále přesně platný
    expect(await h.kernel.validity(d)).toMatchObject({ method: "exact", valid: true });
  });
  it("kontrolní těleso bez závitu (válec s průchozí dírou): soubor projde i přesnou kontrolou → ✓ „věrná kopie modelu“", { timeout: 180_000 }, async () => {
    const ws = new MemoryWorkspace();
    const h = host();
    const r = finalizeReport(await runReport(ws, `nový díl "Kontrola K1"\nválec 30 20\ndíra 8 skrz v 0 0 20\nexport step`, h), { full: true });
    expect(r.full ?? "").toMatch(/^✓ L4 kontrola STEP: soubor znovu načten jádrem – těles: 1, .* → věrná kopie modelu$/m);
    expect(r.full ?? "").not.toMatch(/out\.reload-invalid/);
    const d: CadDoc = ws.present();
    const { file } = await h.kernel.exportStats(d, new Uint8Array(await h.kernel.exportFile(d, "step")), "step");
    expect(file).toMatchObject({ valid: true, validExact: true });
  });
  it("exactBeforeExport: přesná neproběhla (ploch nad mez) → ℹ s důvodem, nikdy ✓; vada → ⚠", async () => {
    const d: CadDoc = { ...emptyDoc("Velký"), features: [{ id: "a", name: "Kvádr 1", type: "box", size: [1, 1, 1], position: [0, 0, 0], centered: false, mode: "new" }] as CadDoc["features"] };
    const k = (v: ValidityResult, fast = true) => ({ validity: async () => v, build: async () => ({ status: [], mesh: null, metrics: { volume: 1, area: 6, bbox: [[0, 0, 0], [1, 1, 1]], faces: 6, edges: 12, valid: fast, solids: 1 } }) }) as unknown as Pick<KernelApi, "validity" | "build">;
    const none = await exactBeforeExport(k({ method: "none", valid: null, faces: 1200, solids: 1, badFaces: 0, ms: 1, why: "faces" }), null, undefined, d);
    expect(none.level).toBe("note");
    expect(none.text).toBe("těleso: přesná kontrola platnosti neprovedena (1200 ploch > 400) – rychlá kontrola: platné – přesně: „kontrola přesně“");
    expect(none.level).not.toBe("ok");
    const bad = await exactBeforeExport(k({ method: "exact", valid: false, faces: 19, solids: 1, badFaces: 14, ms: 5 }), null, undefined, d);
    expect(bad.level).toBe("warn");
    expect(bad.text).toMatch(/NEPLATNÉ: 14 z 19 ploch má vadu/);
    const ok = await exactBeforeExport(k({ method: "exact", valid: true, faces: 19, solids: 1, badFaces: 0, ms: 150 }), null, undefined, d);
    expect(ok).toMatchObject({ level: "ok", text: "těleso: přesná kontrola platnosti (BRepCheck přesnou metodou) – platné, ploch 19 · 0,15 s" });
  });
});

describe("závity v protokolu: kódy thread.*, přísný režim, zápis s mezerami", () => {
  it("M18×3 = ⚠ thread.pitch-nonstandard; přísně zastaví, „přísně kromě thread.pitch-nonstandard“ ne", { timeout: 120_000 }, async () => {
    const text = 'nový díl "Čep"\nválec 18 30\nzávit M18×3 délka 10';
    const r = await runScript(new MemoryWorkspace(), text, host());
    expect(r.entries.filter((e) => e.line === 3).map((e) => e.code)).toEqual(["op.accepted", "thread.pitch-nonstandard"]);
    const s = await runScript(new MemoryWorkspace(), "přísně\n" + text, host());
    expect(s.stopped).toEqual({ line: 4, code: "thread.pitch-nonstandard" });
    const k = await runScript(new MemoryWorkspace(), "přísně kromě thread.pitch-nonstandard\n" + text, host());
    expect(k.stopped).toBeUndefined();
  });
  it("„závit m18 x 1,5 …“ už není chyba zápisu „neznámé slovo x“ (repro 22d T5)", { timeout: 120_000 }, async () => {
    const r = await runScript(new MemoryWorkspace(), 'nový díl "Deska C"\nválec 18 30\nzávit m18 x 1,5 délka 10 v 0 0 15', host());
    expect(r.entries.filter((e) => e.level === "error")).toEqual([]);
    expect(r.entries.filter((e) => e.line === 3 && e.level === "ok").map((e) => e.text)).toEqual(["Závit 1 (thread)"]);
  });
  it("tečná špička a skrytý kanál (helixSweep) nejsou ✓: ⚠ thread.tip-tangent / thread.no-reach na řádku prvku", { timeout: 180_000 }, async () => {
    const r = await runScript(
      new MemoryWorkspace(),
      'nový díl "Deska C"\ntrubka 30 16.4 20\nprvek surf.helixSweep profile=thread60 radius=9 depth=0.8 pitch=1.5 turns=12 mode=cut\nnový díl "Deska H"\ntrubka 30 16.4 20\nprvek surf.helixSweep profile=thread60 radius=9 depth=0.8 pitch=1.5 turns=12 side=internal mode=cut',
      host(),
    );
    expect(r.entries.filter((e) => e.line === 3).map((e) => e.code ?? e.level)).toEqual(["op.accepted", "thread.tip-tangent"]);
    expect(r.entries.filter((e) => e.line === 6).map((e) => e.code ?? e.level)).toEqual(["op.accepted", "thread.no-reach"]);
    expect(r.entries.filter((e) => e.level === "ok" && /Tažení po šroubovici/.test(e.text))).toEqual([]);
  });
});
