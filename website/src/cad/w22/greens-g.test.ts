/**
 * „Zelené“ texty balíku G vlny 22 (zásada č. 1 zprávy majitele: žádný falešný zelený stav). Pro každý text úspěchu, kterého
 * se body 22i / 22b a úrovně stavu prvku týkají, je tu případ, kdy se text NESMÍ vypsat: kontrola neproběhla, proběhla nad
 * jiným vstupem, nebo selhala.
 *
 *   ✓ <prvek> (typ) · …        výsledek prvku        – ne bez výsledku stavby, ne při ✗/⚠, ne při nezkontrolovaném tělese
 *   „těleso platné“            úroveň konečné těleso – ne bez kontroly platnosti
 *   „Geometrie: platná“        textový stav          – ne bez kontroly platnosti
 *   valid=1                    řádek D / = status    – ne bez kontroly platnosti (valid=unchecked)
 *   ✓ <úprava> (přijetí)       úprava modelu         – nikdy (přijetí je ℹ), tím spíš ne před ✗
 *   ✓ výkres: list … bez nálezů výsledek listu       – ne při nálezu, ne když se list nevyhodnotil
 *   ✓ dokument … postaven      načtený dokument      – ne bez výsledku stavby, ne při ⚠/✗ prvku, ne při nezkontrolovaném tělese
 *   feat=N/… (počet ✓)         řádek D               – prvek bez kontroly platnosti se mezi ✓ nepočítá (unchecked=N)
 *   ✓ <prvek> u potlačeného    výsledek prvku        – potlačený prvek (přímo / konfigurací) se nestavěl: ℹ feature.suppressed, off=N
 *   ✓ <závit> (helixSweep)     výsledek prvku        – ne, když drážka povrch neřeže (tečná špička, skrytý kanál – G2, 22a/22b-H)
 *   „· přesná kontrola“, „platné (přesná kontrola)“, vcheck=exact, „✓ těleso: přesná kontrola …“
 *                              Geometrie / kontrola / D – ne bez přesné kontroly, ne pro jinou revizi modelu (G2, 22a)
 *   „→ věrná kopie modelu“, F check=ok, ✓ export STEP, objem / hmotnost
 *                              kontrola exportu / řádek F / D – ne bez objemového tělesa (ani když soubor = model), ne s volnými
 *                              plochami vedle tělesa, ne když se soubor nenačetl, ne bez kontroly („bez kontroly“, STL) (G3, 22c);
 *                              ne, když soubor po zpětném načtení neprojde přesnou kontrolou platnosti (⚠ out.reload-invalid),
 *                              ne bez přesné kontroly souboru (ploch nad mez – jen „odpovídá modelu; … jen rychlou kontrolou“) (22a f. 2)
 *   „→ geometrie souboru odpovídá“ (příčina ⚠ out.reload-invalid)
 *                              kontrola exportu – jen s tolerancí po přepočtu do meze (číslo v řádku), ne bez změřené tolerance,
 *                              ne s tolerancí nad mezí, ne když soubor neprojde ani po přepočtu (22a f. 2, kolo 4)
 */
import { beforeAll, describe, expect, it } from "vitest";
import { docStatusText } from "../agent";
import { setLang } from "../i18n";
import type { EngineHost, MemoryFiles } from "../engine/host";
import type { KernelApi } from "../engine/kernel";
import { statusKv } from "../engine/kv";
import { MemoryWorkspace } from "../engine/memory-workspace";
import { docLine, finalizeReport, formatConsole } from "../engine/protocol";
import { runScript } from "../engine/run";
import { runReport } from "../engine/run-protocol";
import { bodyText, featureState, geometryText, levelsText } from "../feature-levels";
import { emptyDoc, type BuildResult, type CadDoc, type FeatureStatus } from "../types";
import { greenThenRed, realHost } from "./real-host";

let host: () => EngineHost;
beforeAll(async () => {
  setLang("cs");
  host = await realHost();
}, 120_000);

/** jádro, které vrátí zadané stavy prvků (kontrola „neproběhla“ / „selhala“ bez dlouhé stavby) */
function hostWith(status: (d: CadDoc) => FeatureStatus[] | null, metrics: Partial<NonNullable<BuildResult["metrics"]>> = {}): EngineHost {
  const result = (d: CadDoc): BuildResult => ({ status: status(d) ?? [], mesh: null, metrics: d.features.length ? { volume: 4000, area: 1600, bbox: [[0, 0, 0], [20, 20, 10]], faces: 6, edges: 12, valid: true, solids: 1, ...metrics } : null, ms: 1 }) as BuildResult;
  const k = { generation: () => 1, build: async (d: CadDoc) => result(d), asmParts: async (parts: { key: string; source: { kind: string; doc: CadDoc } }[]) => parts.map((p) => ({ key: p.key, result: result(p.source.doc) })), stepSplit: async () => null };
  return { ...host(), kernel: k as unknown as KernelApi };
}
const okLines = (text: string) => text.split("\n").filter((l) => l.startsWith("✓"));

describe("✓ výsledek prvku", () => {
  const SCRIPT = 'nový díl "Deska A"\nkvádr 20 20 10';
  it("kontrola neproběhla (stavba nevrátila stav prvku): ⚠ feature.unverified, žádné ✓ prvku", async () => {
    const r = await runScript(new MemoryWorkspace(), SCRIPT, hostWith(() => null));
    expect(r.entries.filter((e) => e.line === 2).map((e) => e.code ?? e.level)).toEqual(["op.accepted", "feature.unverified"]);
    expect(okLines(formatConsole(r)).filter((l) => l.includes("Kvádr"))).toEqual([]);
  });
  it("platnost tělesa se nekontrolovala: ℹ feature.unchecked s důvodem, žádné ✓ a žádné „těleso platné“", async () => {
    const st = (d: CadDoc): FeatureStatus[] => d.features.map((f) => ({ id: f.id, ok: true, body: { solids: 1, free: 0, faces: 1020, valid: null, why: "approx" } }));
    const r = finalizeReport(await runReport(new MemoryWorkspace(), SCRIPT + "\nstav", hostWith(st, { valid: undefined, faces: 1020, approx: true })), { full: true });
    const e = r.entries.find((x) => x.line === 2 && x.code === "feature.unchecked")!;
    expect(e.level).toBe("note");
    expect(e.text).toMatch(/těleso nezkontrolováno \(velké těleso, 1020 ploch/);
    expect(r.entries.filter((x) => x.level === "ok" && x.text.includes("Kvádr"))).toEqual([]);
    expect(r.full).not.toMatch(/těleso platné/);
    expect(r.full).not.toMatch(/Geometrie: platná/);
    expect(r.full).toMatch(/Geometrie: nezkontrolováno/);
    expect(r.protocol).toMatch(/^D "Deska A" part feat=0\/0\/0 .* solids=1 valid=unchecked unchecked=1$/m); // prvek není mezi ✓
    expect(r.protocol).not.toMatch(/valid=1/);
  });
  it("kontrola selhala (prvek ✗ / ⚠ žádný účinek): žádné ✓ prvku", { timeout: 120_000 }, async () => {
    const r = await runScript(new MemoryWorkspace(), 'nový díl "Deska A"\nkvádr 20 20 10\nzaoblit 15 hrany vše\nkvádr 5 5 5 v 0 0 10 odebrat', host());
    expect(r.entries.filter((e) => e.line === 3).map((e) => e.code)).toEqual(["op.accepted", "feature.failed"]);
    expect(r.entries.filter((e) => e.line === 4).map((e) => e.code)).toEqual(["op.accepted", "feature.warning"]);
    expect(okLines(formatConsole(r)).filter((l) => /Zaoblení|Kvádr 2/.test(l))).toEqual([]);
  });
  it("prvek se nestavěl (potlačený aktivní konfigurací nebo příkazem potlačit): ℹ feature.suppressed, žádné ✓ prvku ani v počtu feat=", { timeout: 120_000 }, async () => {
    const text = 'nový díl "Deska K"\nkvádr 60 40 10\nkvádr 10 10 30 v 40 10 10\nkonfigurace "Bez výstupku" potlačit "Kvádr 2"\nkonfigurace aktivní "Bez výstupku"\nstav';
    const r = finalizeReport(await runReport(new MemoryWorkspace(), text, host()), { full: true });
    // dřív: „✓ Kvádr 2 (box)“ za prvek, který model po konfiguraci vůbec neobsahuje
    const k2 = r.entries.filter((e) => e.line === 3);
    expect(k2.map((e) => `${e.level}:${e.code ?? ""}`)).toEqual(["note:op.accepted", "note:feature.suppressed"]);
    expect(k2[1].data).toEqual({ levels: { built: false, suppressed: true } });
    expect(r.entries.filter((e) => e.level === "ok" && e.text.startsWith("Kvádr 2"))).toEqual([]);
    expect(k2[1].text).toBe("prvek „Kvádr 2“ je potlačený – nestaví se (bez výsledku)");
    expect(r.full).toMatch(/ 2\. Kvádr 2 \[box, id [^\]]+\] ℹ \(potlačen\) – /);
    expect(r.full).toMatch(/prvků 2 \(1 ✓, 1 ℹ potlačeno, 0 ✗\)/);
    expect(r.protocol).toMatch(/^D "Deska K" part feat=1\/0\/0 .* off=1$/m);
    expect(greenThenRed(r.entries)).toEqual([]);
    // potlačit + zapnout v témže běhu: prvek se staví → ✓ s úrovněmi (žádné „potlačen“)
    const z = await runScript(new MemoryWorkspace(), 'nový díl "Deska A"\nkvádr 20 20 10\ndíra 4 skrz v 10 10\npotlačit "Díra 1"\nzapnout "Díra 1"', host());
    expect(z.entries.some((e) => e.code === "feature.suppressed")).toBe(false);
  });
  it("kontrola proběhla nad jiným stavem modelu: ✓ z dřívější stavby neplatí pro model po úpravě – nový stav se ohlásí", { timeout: 120_000 }, async () => {
    const r = await runScript(new MemoryWorkspace(), 'přísně kromě feature.warning\nnový díl "Deska A"\nkvádr 20 20 10\ndíra 4 skrz v 10 10\nupravit "Kvádr 1" size=5;5;10', host());
    expect(r.entries.filter((e) => e.line === 4 && e.level === "ok")).toHaveLength(1); // platilo pro model řádku 4
    expect(r.entries.filter((e) => e.code === "feature.warning").map((e) => e.line)).toEqual([5]); // po úpravě už ne
    expect(r.entries.filter((e) => e.line === 5 && e.level === "ok")).toEqual([]);
  });
});

describe("„těleso platné“, „Geometrie: platná“, valid=1", () => {
  it("bez kontroly platnosti se nevypíše nic z toho", () => {
    const body = { solids: 1, free: 0, faces: 468, valid: null, why: "feature-faces" as const };
    expect(bodyText(body)).not.toMatch(/platné/);
    expect(levelsText({ ok: true, body })).toMatch(/nezkontrolováno/);
    expect(featureState({ ok: true, body })).toBe("unchecked");
    expect(geometryText({ valid: undefined, solids: 1, faces: 1020, approx: true })).not.toMatch(/platná/);
    const doc: CadDoc = { ...emptyDoc("Deska A"), features: [{ id: "a", name: "Kvádr 1", type: "box", size: [20, 20, 10], position: [0, 0, 0], centered: false, mode: "new" }] as CadDoc["features"] };
    const res = { status: [{ id: "a", ok: true, body }], mesh: null, metrics: { volume: 4000, area: 1600, bbox: [[0, 0, 0], [20, 20, 10]], faces: 1020, edges: 12, solids: 1, approx: true }, ms: 1 } as unknown as BuildResult;
    expect(statusKv(doc, res)).toMatch(/feat=0\/0\/0 .* solids=1 valid=unchecked unchecked=1$/);
    expect(docStatusText(doc, res)).not.toMatch(/✓ –|Geometrie: platná/);
    expect(docLine({ ref: "a", name: "Deska A", kind: "part", solids: 1, valid: null })).toBe('D "Deska A" part V=- bbox=- solids=1 valid=unchecked');
  });
  it("neplatné těleso: valid=0, „NEPLATNÉ“, stav ⚠", () => {
    expect(docLine({ ref: "a", name: "Deska A", kind: "part", solids: 1, valid: false })).toMatch(/valid=0$/);
    expect(bodyText({ solids: 1, free: 0, faces: 6, valid: false })).toBe("těleso NEPLATNÉ");
    expect(geometryText({ valid: false, solids: 1, faces: 6 })).not.toMatch(/^platná/);
  });
});

describe("✓ úpravy modelu a ✓ listu výkresu", () => {
  it("úprava: přijetí není ✓ – ani když stavba projde (✓ nese až výsledek prvku), ani když selže", { timeout: 120_000 }, async () => {
    for (const radius of [2, 15]) {
      const r = await runScript(new MemoryWorkspace(), `nový díl "Deska A"\nkvádr 20 20 10\nzaoblit 1 hrany svislé\nupravit "Zaoblení 1" radius=${radius}`, host());
      expect(r.entries.filter((e) => e.level === "ok" && /radius/.test(e.text))).toEqual([]);
      expect(formatConsole(r)).not.toMatch(/^✓ Zaoblení 1: radius/m);
      expect(greenThenRed(r.entries)).toEqual([]);
    }
  });
  it("list s nálezem (řez mimo těleso): žádné „vyhodnocen bez nálezů“", { timeout: 120_000 }, async () => {
    const r = await runScript(new MemoryWorkspace(), 'nový díl "Deska A"\nkvádr 60 40 10\nvýkres A4\nvýkres řez XZ odsazení 500', host());
    expect(formatConsole(r)).not.toMatch(/vyhodnocen bez nálezů/);
    expect(r.entries.some((e) => e.code === "drawing.section-miss")).toBe(true);
  });
  it("list se nevyhodnotil (přísný režim zastavil běh dřív): žádné „vyhodnocen bez nálezů“ a žádné ✓ příkazu výkresu", { timeout: 120_000 }, async () => {
    const r = await runScript(new MemoryWorkspace(), 'přísně\nnový díl "Deska A"\nkvádr 60 40 10\nvýkres A4\nzaoblit 50 hrany vše\nstav', host());
    expect(r.stopped?.line).toBe(5);
    expect(formatConsole(r)).not.toMatch(/vyhodnocen bez nálezů/);
    expect(r.entries.filter((e) => e.level === "ok" && /výkres|list/i.test(e.text))).toEqual([]);
  });
});

describe("✓ dokument … postaven (načtený JSON / otevřený soubor)", () => {
  const JSON_DOC = JSON.stringify({ app: "mnastrojarna-cad", version: 2, name: "Deska A", material: "ocel", features: [{ id: "a", name: "Kvádr 1", type: "box", size: [20, 20, 10], position: [0, 0, 0], centered: false, mode: "new" }] });
  const okText = /dokument „Deska A“ postaven/;
  it("kontrola neproběhla (stavba nevrátila stavy prvků): přijetí + ⚠ feature.unverified, žádné ✓", async () => {
    const r = await runScript(new MemoryWorkspace(), JSON_DOC, hostWith(() => null));
    expect(r.entries.filter((e) => e.line === 1).map((e) => e.code ?? e.level)).toEqual(["op.accepted", "feature.unverified"]);
    expect(formatConsole(r)).not.toMatch(okText);
  });
  it("kontrola selhala (prvek ✗): ✗ na řádku načtení, žádné ✓", async () => {
    const r = await runScript(new MemoryWorkspace(), JSON_DOC, hostWith((d) => d.features.map((f) => ({ id: f.id, ok: false, error: "nejde" }))));
    expect(r.entries.filter((e) => e.line === 1).map((e) => e.code ?? e.level)).toEqual(["op.accepted", "feature.failed"]);
    expect(formatConsole(r)).not.toMatch(okText);
  });
  it("platnost tělesa se nekontrolovala: ℹ doc.unchecked s důvodem, žádné ✓; řádek D nepočítá prvek mezi ✓", async () => {
    const st = (d: CadDoc): FeatureStatus[] => d.features.map((f) => ({ id: f.id, ok: true, body: { solids: 1, free: 0, faces: 1020, valid: null, why: "approx" } }));
    const r = finalizeReport(await runReport(new MemoryWorkspace(), JSON_DOC, hostWith(st, { valid: undefined, faces: 1020, approx: true })), { full: true });
    const e = r.entries.filter((x) => x.line === 1);
    expect(e.map((x) => `${x.level}:${x.code ?? ""}`)).toEqual(["note:op.accepted", "note:doc.unchecked"]);
    expect(e[1].text).toMatch(/dokument „Deska A“ postaven: prvků 1, bez ⚠ a ✗ – těleso nezkontrolováno \(velké těleso, 1020 ploch/);
    expect(r.entries.some((x) => x.level === "ok")).toBe(false);
    expect(r.protocol).toMatch(/^D "Deska A" part feat=0\/0\/0 .* solids=1 valid=unchecked unchecked=1$/m);
  });
  it("kontrola proběhla nad jiným stavem (mezistav se nestavěl, následovala další změna): žádné ✓ na řádku načtení, ℹ op.superseded", async () => {
    const st = (d: CadDoc): FeatureStatus[] => d.features.map((f) => ({ id: f.id, ok: true, body: { solids: 1, free: 0, faces: 6, valid: true } }));
    const r = await runScript(new MemoryWorkspace(), JSON_DOC + "\nkvádr 5 5 5 v 30 0 0", hostWith(st));
    expect(r.entries.filter((e) => e.line === 1).map((e) => e.code ?? e.level)).toEqual(["op.accepted", "op.superseded"]);
    expect(formatConsole(r)).not.toMatch(okText);
  });
  it("kontrola proběhla a je čistá: ✓ až po stavbě", async () => {
    const st = (d: CadDoc): FeatureStatus[] => d.features.map((f) => ({ id: f.id, ok: true, body: { solids: 1, free: 0, faces: 6, valid: true } }));
    const r = finalizeReport(await runReport(new MemoryWorkspace(), JSON_DOC, hostWith(st)));
    expect(r.entries.filter((x) => x.line === 1).map((x) => `${x.level}:${x.text}`)).toEqual(["note:dokument „Deska A“ (1 prvků) – otevře se v nové záložce – výsledek po výpočtu níže", "ok:dokument „Deska A“ postaven: prvků 1, bez ⚠ a ✗ · těleso platné"]);
    expect(r.protocol).toMatch(/^D "Deska A" part feat=1\/0\/0 .* solids=1 valid=1$/m);
  });
});

describe("řádek D: volné plochy vedle těles (free=N)", () => {
  it("free= se vypíše jen když volné plochy jsou", () => {
    expect(docLine({ ref: "a", name: "Deska A", kind: "part", solids: 1, valid: true, free: 2 })).toBe('D "Deska A" part V=- bbox=- solids=1 valid=1 free=2');
    expect(docLine({ ref: "a", name: "Deska A", kind: "part", solids: 1, valid: true })).not.toMatch(/free=/);
  });
});

describe("22b – případ H (drážka závitu celá ve stěně) a 22a – tečná špička: žádné ✓ (etapa G2)", () => {
  // Dřív: ✓ s účinkem „(celý nástroj)“ – nástroj závitu byl celý v materiálu, drážka do díry neústila (it.fails v G1).
  // Etapa G2: sonda drážky (feat/thread-helix.ts) → ⚠ thread.no-reach; vědomě změněno z it.fails na přímé očekávání.
  it("H není ✓: ⚠ thread.no-reach „nezasahuje do válcové plochy díry“ na řádku prvku", { timeout: 180_000 }, async () => {
    const r = await runScript(new MemoryWorkspace(), 'nový díl "Deska H"\ntrubka 30 16.4 20\nprvek surf.helixSweep profile=thread60 radius=9 depth=0.8 pitch=1.5 turns=12 side=internal mode=cut', host());
    expect(r.entries.filter((e) => e.line === 3 && e.level === "ok")).toEqual([]);
    const w = r.entries.find((x) => x.line === 3 && x.code === "thread.no-reach")!;
    expect(w.level).toBe("warn");
    expect(w.text).toMatch(/nezasahuje do válcové plochy díry ani válce/);
  });
  it("C (tečná špička) není ✓: ⚠ thread.tip-tangent; „Geometrie: platná“ zůstává jen s výhradou ⚠ prvku", { timeout: 180_000 }, async () => {
    const r = finalizeReport(await runReport(new MemoryWorkspace(), 'nový díl "Deska C"\ntrubka 30 16.4 20\nprvek surf.helixSweep profile=thread60 radius=9 depth=0.8 pitch=1.5 turns=12 mode=cut\nstav', host()), { full: true });
    expect(r.entries.filter((e) => e.line === 3 && e.level === "ok")).toEqual([]);
    expect(r.entries.filter((e) => e.line === 3).map((e) => e.code)).toEqual(["op.accepted", "thread.tip-tangent"]);
    expect(r.full).toMatch(/prvků 2 \(1 ✓, 1 ⚠, 0 ✗\)/);
    expect(r.protocol).toMatch(/^D "Deska C" part feat=1\/1\/0 /m);
  });
});

describe("„· přesná kontrola“, „platné (přesná kontrola)“, vcheck=exact, „✓ těleso: přesná kontrola …“", () => {
  it("bez přesné kontroly se nevypíše nic z toho – řádek Geometrie říká „rychlá kontrola“, řádek D vcheck nemá", () => {
    expect(geometryText({ valid: true, solids: 1, faces: 6 })).toBe("platná · 1 těleso · rychlá kontrola");
    expect(geometryText({ valid: true, solids: 1, faces: 6, validCheck: "fast" })).not.toMatch(/přesná/);
    expect(geometryText({ valid: undefined, solids: 1, faces: 1020, approx: true })).not.toMatch(/kontrola$|přesná|rychlá/);
    expect(docLine({ ref: "a", name: "Deska A", kind: "part", solids: 1, valid: true, validCheck: "fast" })).toBe('D "Deska A" part V=- bbox=- solids=1 valid=1');
    expect(docLine({ ref: "a", name: "Deska A", kind: "part", solids: 1, valid: true, validCheck: "exact" })).toBe('D "Deska A" part V=- bbox=- solids=1 valid=1 vcheck=exact');
    expect(docLine({ ref: "a", name: "Deska A", kind: "part", solids: 1, valid: null, validCheck: "exact" })).toBe('D "Deska A" part V=- bbox=- solids=1 valid=unchecked');
  });
  it("přesná kontrola z jiné revize modelu neplatí: po změně stav „· rychlá kontrola“, D bez vcheck", { timeout: 180_000 }, async () => {
    const r = finalizeReport(await runReport(new MemoryWorkspace(), 'nový díl "Deska A"\nkvádr 40 20 10\nkontrola přesně\nkvádr 5 5 5 v 0 0 10\nstav', host()), { full: true });
    expect(r.full).toMatch(/platné \(přesná kontrola\)/); // řádek kontroly platil pro model řádku 3
    expect(r.full).toMatch(/Geometrie: platná · 1 těleso · rychlá kontrola/);
    expect(r.full).not.toMatch(/Geometrie: [^\n]*přesná kontrola/);
    expect(r.protocol).not.toMatch(/^D .*vcheck=exact/m);
  });
  it("přesná kontrola nešla provést (ploch nad mez): ℹ s důvodem, žádné „platné (přesná kontrola)“ ani vcheck=exact", { timeout: 120_000 }, async () => {
    const k = { generation: () => 1, build: async (d: CadDoc) => ({ status: d.features.map((f) => ({ id: f.id, ok: true })), mesh: null, metrics: { volume: 4000, area: 1600, bbox: [[0, 0, 0], [20, 20, 10]], faces: 6000, edges: 12, valid: true, solids: 1 }, ms: 1 }), validity: async () => ({ method: "none", valid: null, faces: 6000, solids: 1, badFaces: 0, ms: 1, why: "faces" }), measure: host().kernel.measure };
    const h = { ...host(), kernel: { ...host().kernel, ...k } as unknown as KernelApi };
    const r = finalizeReport(await runReport(new MemoryWorkspace(), 'nový díl "Deska A"\nkvádr 20 20 10\nkontrola přesně', h), { full: true });
    expect(r.full).not.toMatch(/přesná kontrola\)/);
    expect(r.full).toMatch(/platné \(rychlá kontrola\)/);
    expect(r.full).toMatch(/ℹ L3 msg\.note .*přesná kontrola platnosti neprovedena \(6000 ploch > 5000\)/);
    expect(r.full).not.toMatch(/vcheck=exact/);
  });
});

describe("„věrná kopie modelu“, F check=ok, ✓ export STEP – jen s objemovým tělesem (G3, 22c)", () => {
  const SHELL = 'nový díl "Deska A"\nskica XY: obdélník 40 30\nprvek surf.extrude sketchId="Skica 1" distance=20\nskica XY: obdélník 40 30\nprvek surf.planar sketchId="Skica 2"\nskica XY odsazení 20: obdélník 40 30\nprvek surf.planar sketchId="Skica 3"\nprvek surf.sew tolerance=0.01';
  const run = async (t: string) => finalizeReport(await runReport(new MemoryWorkspace(), t, host(), { lang: "cs" }), { full: true });
  it("skořepina bez tělesa: soubor = model, přesto žádné „věrná kopie“, žádné check=ok, zápis ℹ (ne ✓), V=- m=-", { timeout: 180_000 }, async () => {
    const r = await run(`${SHELL}\nexport step`);
    expect(r.full).not.toMatch(/věrná kopie/);
    expect(r.protocol).not.toMatch(/check=ok/);
    expect(r.full).not.toMatch(/^✓ L9 /m);
    expect(r.protocol).toMatch(/^D "Deska A" part feat=7\/0\/0 V=- m=- /m);
    expect(r.entries.some((e) => e.code === "out.no-solid" && e.level === "error")).toBe(true);
  });
  it("těleso s volnou plochou: soubor = model, přesto ne „věrná kopie“ (⚠ out.free-surfaces)", { timeout: 180_000 }, async () => {
    const r = await run('nový díl "Deska B"\nkvádr 40 30 20\nskica XZ: čára -10 5 50 5 otevřená\nprvek surf.extrude sketchId="Skica 1" distance=60 symmetric=ano\nexport step');
    expect(r.full).not.toMatch(/věrná kopie/);
    expect(r.protocol).toMatch(/check=fail/);
  });
  it("„bez kontroly“ a STL: kontrola neproběhla → nikdy „věrná kopie“ ani check=ok, model bez tělesa = ✗", { timeout: 180_000 }, async () => {
    const r = await run(`${SHELL}\nexport step bez kontroly\nexport stl`);
    expect(r.full).not.toMatch(/věrná kopie/);
    expect(r.protocol).not.toMatch(/check=ok/);
    expect(r.entries.filter((e) => e.code === "out.no-solid")).toHaveLength(2);
    const solid = await run("nový díl Kostka\nkvádr 10 10 10\nexport step bez kontroly\nexport stl");
    expect(solid.full).not.toMatch(/věrná kopie/); // kontrola se vynechala – „věrná kopie“ by byla nepodložená
    expect(solid.protocol).not.toMatch(/check=/); // bez kontroly není výsledek kontroly – ani ok, ani fail
  });
});

describe("„věrná kopie modelu“ – jen po přesné kontrole platnosti souboru (22a, fáze 2)", () => {
  const run = async (t: string) => finalizeReport(await runReport(new MemoryWorkspace(), t, host(), { lang: "cs" }), { full: true });
  it("kontrola selhala: závit šroubovicí – soubor po načtení přesnou kontrolou neprojde → ⚠ out.reload-invalid, F check=fail, žádné „věrná kopie“", { timeout: 300_000 }, async () => {
    const r = await run('nový díl "Šroub B"\nválec 18 30\nzávit M18×1,5 délka 20 v 0 0 10 šroubovice\nexport step');
    expect(r.full).not.toMatch(/věrná kopie/);
    expect(r.protocol).toMatch(/check=fail/);
    expect(r.protocol).not.toMatch(/check=ok/);
    expect(r.entries.some((e) => e.code === "out.reload-invalid" && e.level === "warn")).toBe(true);
  });
  it("kolo 4: soubor projde přesnou kontrolou až po přepočtu tolerancí hran – pořád ⚠ out.reload-invalid (výchozí čtečka ho odmítne), nikdy „věrná kopie“ ani ✓", async () => {
    const { exportCheck } = await import("../agent-out");
    const box: [[number, number, number], [number, number, number]] = [[0, 0, 0], [20, 20, 30]];
    const c = exportCheck({ solids: 1, volume: 8860, bbox: box, valid: true, validExact: true }, { solids: 1, volume: 8860, bbox: box, valid: true, validExact: false, badFaces: 3, faces: 7, retolValid: true }, "STEP");
    expect(c.ok).toBe(false);
    expect(c.level).toBe("warn");
    expect(c.code).toBe("out.reload-invalid");
    expect(c.line.startsWith("⚠")).toBe(true);
    expect(c.line).not.toMatch(/věrná kopie|^✓/);
  });
  it("kolo 4 (oponent): „geometrie souboru odpovídá“ jen s tolerancí po přepočtu do meze – ne s tolerancí 0,2 mm, ne bez změřené tolerance, ne když soubor neprojde ani po přepočtu", async () => {
    const { exportCheck } = await import("../agent-out");
    const box: [[number, number, number], [number, number, number]] = [[0, 0, 0], [20, 20, 30]];
    const m = { solids: 1, volume: 8860, bbox: box, valid: true, validExact: true, maxTol: 6.3e-5 };
    const f = { solids: 1, volume: 8860, bbox: box, valid: true, validExact: false, badFaces: 3, faces: 7 };
    const ok = exportCheck(m, { ...f, retolValid: true, retolMaxTol: 6e-7 }, "STEP");
    expect(ok.line).toMatch(/s tolerancí nejvýše 6,0e-7 mm \(mez 6,3e-5 mm = největší tolerance modelu\) → geometrie souboru odpovídá/);
    for (const g of [{ retolValid: true, retolMaxTol: 0.2 }, { retolValid: true }, { retolValid: false, retolBadFaces: 1 }, { retolValid: false, retolBadFaces: 1, devMax: 6e-5, devOver: 0 }]) {
      const c = exportCheck({ ...m, devMax: 6e-5 }, { ...f, ...g }, "STEP");
      expect(c.code, JSON.stringify(g)).toBe("out.reload-invalid");
      expect(c.line, JSON.stringify(g)).not.toMatch(/geometrie souboru odpovídá|zápis odchylku nezvětšil|věrná kopie/);
    }
  });
  it("kontrola neproběhla nad souborem (ploch nad mez): „věrná kopie“ se nevypíše, řádek řekne „jen rychlou kontrolou“", async () => {
    const { exportCheck } = await import("../agent-out");
    const box: [[number, number, number], [number, number, number]] = [[0, 0, 0], [10, 10, 10]];
    const c = exportCheck({ solids: 1, volume: 1000, bbox: box, valid: true }, { solids: 1, volume: 1000, bbox: box, valid: true, validExact: null, faces: 401 }, "STEP");
    expect(c.line).not.toMatch(/věrná kopie/);
    expect(c.line).toMatch(/jen rychlou kontrolou – přesná neproběhla \(401 ploch > 400\)/);
  });
});

describe("kolo 6: „✓ export STEP“ a pak ⚠ / ✗ – zápis souboru není ✓, rozhoduje kontrola (22i, 22a, 22c)", () => {
  const SHELL = 'nový díl "Deska A"\nskica XY: obdélník 40 30\nprvek surf.extrude sketchId="Skica 1" distance=20\nskica XY: obdélník 40 30\nprvek surf.planar sketchId="Skica 2"\nskica XY odsazení 20: obdélník 40 30\nprvek surf.planar sketchId="Skica 3"\nprvek surf.sew tolerance=0.01';
  const run = async (t: string, strict = false) => {
    const h = host();
    const phases: string[] = [];
    h.phase = (op, p) => void phases.push(`${op}:${p}`);
    const r = finalizeReport(await runReport(new MemoryWorkspace(), t, h, { lang: "cs", strict }), { full: true });
    return { r, files: (h.files as MemoryFiles).files, phases };
  };
  const exportOk = (full: string | undefined) => (full ?? "").split("\n").filter((l) => /^✓ L\d+ export (STEP|BREP)/.test(l));
  it("závit šroubovicí (⚠ out.reload-invalid): řádek zápisu ℹ „zapsáno, kontrola níže“, žádné „✓ … export STEP“ nad ⚠", { timeout: 300_000 }, async () => {
    const { r } = await run('nový díl "Šroub B"\nválec 18 30\nzávit M18×1,5 délka 20 v 0 0 10 šroubovice\nexport step');
    expect(r.entries.some((e) => e.code === "out.reload-invalid")).toBe(true);
    expect(exportOk(r.full)).toEqual([]);
    expect(r.full).toMatch(/^ℹ L4 msg\.note "Šroub B": export STEP: .* – zapsáno, kontrola níže$/m);
  });
  it("těleso s volnou plochou (známé před zápisem): zápis ℹ, ne ✓; ⚠ out.free-surfaces", { timeout: 180_000 }, async () => {
    const { r } = await run('nový díl "Deska B"\nkvádr 40 30 20\nskica XZ: čára -10 5 50 5 otevřená\nprvek surf.extrude sketchId="Skica 1" distance=60 symmetric=ano\nexport step\nexport stl');
    expect(r.entries.filter((e) => e.code === "out.free-surfaces")).toHaveLength(2);
    expect((r.full ?? "").split("\n").filter((l) => /^✓ L\d+ export (STEP|STL)/.test(l))).toEqual([]);
  });
  it("volné plochy vedle tělesa (var/c1, repro 22c L25): ani „✓ těleso: přesná kontrola platnosti“ nestojí nad ⚠ out.free-surfaces – jen ℹ", { timeout: 180_000 }, async () => {
    // oponentura kola 6: zápis už byl ℹ, ale ✓ přesné kontroly tělesa zůstal přímo nad ⚠ téhož exportu
    const { r } = await run('nový díl "Deska B"\nkvádr 40 30 20\nskica XZ: čára -10 5 50 5 otevřená\nprvek surf.extrude sketchId="Skica 1" distance=60 symmetric=ano\nexport step');
    expect(r.entries.some((e) => e.code === "out.free-surfaces")).toBe(true);
    const lines = (r.full ?? "").split("\n");
    expect(lines.filter((l) => /^✓ L5 /.test(l))).toEqual([]);
    expect(lines.some((l) => /^ℹ L5 msg\.note "Deska B": těleso: přesná kontrola platnosti .* – platné/.test(l)), r.full).toBe(true);
  });
  it("platné těleso: zápis ℹ, ✓ jen z kontroly („věrná kopie modelu“)", { timeout: 180_000 }, async () => {
    const { r } = await run("nový díl Kostka\nkvádr 10 10 10\nexport step");
    expect(exportOk(r.full)).toEqual([]);
    expect(r.full).toMatch(/^✓ L3 kontrola STEP: .* → věrná kopie modelu$/m);
  });
  it("přísný režim: export, který zastaví běh, soubor NEZAPÍŠE (model bez tělesa, ⚠ out.reload-invalid); bez přísného režimu ano", { timeout: 300_000 }, async () => {
    const a = await run(`${SHELL}\nexport step`, true);
    expect(a.r.protocol).toMatch(/^MNCAD\/1 STOP /);
    expect(a.r.entries.find((e) => e.code === "out.no-solid")?.text).toMatch(/^soubor nezapsán \(přísný režim zastaví běh\) – /);
    expect(a.files.size).toBe(0);
    expect(a.r.protocol).not.toMatch(/^F /m);
    const b = await run('nový díl "Šroub B"\nválec 18 30\nzávit M18×1,5 délka 20 v 0 0 10 šroubovice\nexport step', true);
    expect(b.r.entries.find((e) => e.code === "out.reload-invalid")?.text).toMatch(/^soubor nezapsán/);
    expect(b.files.size).toBe(0);
    // fáze průběhu (CLI --progress / hostitel): kontrola ano, zápis NE – soubor nevznikl (dřív hlášena fáze „write“)
    expect(b.phases.filter((p) => p.startsWith("export:step:"))).toEqual(["export:step:model", "export:step:convert", "export:step:verify"]);
    const c = await run(`${SHELL}\nexport step`);
    expect(c.files.size).toBe(1); // bez přísného režimu se soubor zapíše (✗ out.no-solid, F check=fail)
    const ok = await run("nový díl Kostka\nkvádr 10 10 10\nexport step", true);
    expect(ok.files.size).toBe(1); // čistá kontrola: zapíše se i v přísném režimu
    expect(ok.phases.filter((p) => p.startsWith("export:step:"))).toEqual(["export:step:model", "export:step:convert", "export:step:verify", "export:step:write"]);
    expect(ok.r.protocol).not.toMatch(/^MNCAD\/1 STOP/);
  });
});

describe("kolo 6: řez výkresu mimo těleso se při výstupu PDF ohlásí jednou (22i)", () => {
  const TEXT = 'nový díl "Deska A"\nkvádr 60 40 10\nvýkres A4\nvýkres řez XZ odsazení 500';
  it("výkres export pdf: jeden ✗ drawing.section-miss na řádku příkazu řezu, žádný ⚠ s odznakem, žádné „bez nálezů“", { timeout: 180_000 }, async () => {
    const r = finalizeReport(await runReport(new MemoryWorkspace(), `${TEXT}\nvýkres export pdf`, host(), { lang: "cs" }), { full: true });
    const miss = r.entries.filter((e) => e.code === "drawing.section-miss");
    expect(miss.map((e) => e.line)).toEqual([4]);
    expect(r.entries.some((e) => /Rovina řezu neprotíná/.test(e.text))).toBe(false);
    expect(r.full).not.toMatch(/bez nálezů/);
  });
  it("CLI --formats pdf (finishRun): nález z řádku příkazu se v závěru nezopakuje (dřív druhý ✗ L-, err=2)", { timeout: 180_000 }, async () => {
    const { engineRun, finishRun } = await import("../cli/job");
    const { ReportBuilder } = await import("../engine/protocol");
    const ws = new MemoryWorkspace();
    const h = host();
    const rb = new ReportBuilder({ lang: "cs", lines: 4, strict: false });
    const hooks = { opStart: () => undefined, opEnd: () => undefined };
    await engineRun(ws, TEXT, h, rb, { strict: false, open: [] }, hooks);
    await finishRun(ws, h, rb, { formats: ["pdf"], allDocs: false, noOutputOnError: false, share: false }, hooks);
    expect(rb.entries.filter((e) => e.code === "drawing.section-miss").map((e) => e.line)).toEqual([4]);
    expect(rb.count("error")).toBe(1);
    expect((h.files as MemoryFiles).files.size).toBe(1);
  });
});

describe("kolo 7: „✓ výkres PDF“ nad ⚠ / ✗ listu – zápis výkresu s nálezem není ✓; přísný režim soubor nezapíše (22i, 22c)", () => {
  const run = async (t: string, strict = false) => {
    const h = host();
    const r = finalizeReport(await runReport(new MemoryWorkspace(), t, h, { lang: "cs", strict }), { full: true });
    return { r, files: (h.files as MemoryFiles).files };
  };
  const drawOk = (full: string | undefined) => (full ?? "").split("\n").filter((l) => /^✓ L\d+ výkres (PDF|DXF|SVG|DWG)/.test(l));
  const NO_TOL = 'nový díl "Deska A"\nkvádr 60 40 10\nvýkres A4\nvýkres export pdf';
  it("list bez nepředepsaných tolerancí: řádek zápisu ℹ „zapsáno, nálezy níže“, ⚠ pod ním, žádné „✓ výkres PDF“", { timeout: 180_000 }, async () => {
    const { r, files } = await run(NO_TOL);
    expect(drawOk(r.full)).toEqual([]);
    expect(r.full).toMatch(/^ℹ L4 msg\.note "Deska A": výkres PDF: .* – zapsáno, nálezy níže$/m);
    expect(r.entries.some((e) => e.line === 4 && e.code === "drawing.warning" && /nepředepsané tolerance/.test(e.text))).toBe(true);
    expect(files.size).toBe(1); // bez přísného režimu se soubor zapíše
  });
  it("funkční plocha bez tolerované kóty (repro 79e): žádné „✓ výkres PDF“ nad ⚠ funkční polohy", { timeout: 180_000 }, async () => {
    const { r } = await run('nový díl "Deska A"\nkvádr 60 40 10\nvýkres A4\nvýkres nepředepsané ISO 2768-mK\nfunkční F2 ±0,02\nvýkres export pdf');
    expect(r.entries.some((e) => e.line === 6 && e.code === "drawing.warning" && /funkční poloha F2/.test(e.text))).toBe(true);
    expect(drawOk(r.full)).toEqual([]);
  });
  it("řez mimo těleso (✗ na řádku příkazu řezu): zápis výkresu ℹ, ne ✓ – soubor ten nález nese", { timeout: 180_000 }, async () => {
    const { r } = await run('nový díl "Deska A"\nkvádr 60 40 10\nvýkres A4\nvýkres nepředepsané ISO 2768-mK\nvýkres řez XZ odsazení 500\nvýkres export pdf');
    expect(r.entries.filter((e) => e.code === "drawing.section-miss").map((e) => e.line)).toEqual([5]);
    expect(drawOk(r.full)).toEqual([]);
    expect(r.full).toMatch(/^ℹ L6 msg\.note "Deska A": výkres PDF: /m);
  });
  it("přísný režim: ⚠ listu zastaví běh a soubor výkresu se NEZAPÍŠE (žádný F, files=0); čistý list se zapíše a je ✓", { timeout: 180_000 }, async () => {
    const a = await run(NO_TOL, true);
    expect(a.r.protocol).toMatch(/^MNCAD\/1 STOP /);
    expect(a.r.entries.find((e) => e.code === "drawing.warning")?.text).toMatch(/^soubor nezapsán \(přísný režim zastaví běh\) – Výkres nemá nepředepsané tolerance/);
    expect(a.files.size).toBe(0);
    expect(a.r.protocol).not.toMatch(/^F /m);
    expect(a.r.full).not.toMatch(/výkres PDF: Deska/);
    const ok = await run('nový díl "Deska A"\nkvádr 60 40 10\nvýkres A4\nvýkres nepředepsané ISO 2768-mK\nvýkres export pdf', true);
    expect(ok.files.size).toBe(1);
    expect(ok.r.protocol).not.toMatch(/^MNCAD\/1 STOP/);
    expect(drawOk(ok.r.full)).toHaveLength(1); // ✓ zápisu zůstává jen u listu bez nálezu
  });
  it("přísný režim s výjimkou `přísně kromě drawing.warning`: soubor se zapíše, řádek zápisu ℹ, ⚠ pod ním", { timeout: 180_000 }, async () => {
    const { r, files } = await run(NO_TOL.replace("výkres export pdf", "přísně kromě drawing.warning\nvýkres export pdf"), true);
    expect(files.size).toBe(1);
    expect(drawOk(r.full)).toEqual([]);
    expect(r.entries.some((e) => e.code === "drawing.warning" && /^Výkres nemá/.test(e.text))).toBe(true);
  });
});

describe("kolo 7 (oponentura): přísný běh na ⚠ výchozího listu – soubor se nezapíše a řádek jmenuje tentýž nález (22c)", () => {
  const run = async (t: string) => {
    const h = host();
    const r = finalizeReport(await runReport(new MemoryWorkspace(), t, h, { lang: "cs" }), { full: true });
    return { r, files: (h.files as MemoryFiles).files };
  };
  const BARE = 'nový díl "Deska A"\nkvádr 60 40 10\nvýkres export pdf';
  it("`přísně kromě drawing.warning` + dokument bez listu: STOP na drawing.default-sheet a ŽÁDNÝ soubor (dřív F pdf, files=1)", { timeout: 180_000 }, async () => {
    const { r, files } = await run(`přísně kromě drawing.warning\n${BARE}`);
    expect(r.protocol).toMatch(/^MNCAD\/1 STOP /);
    expect(r.protocol).toMatch(/stop=L4:drawing\.default-sheet/);
    expect(files.size).toBe(0);
    expect(r.protocol).not.toMatch(/^F /m);
    expect(r.protocol).toMatch(/files=0/);
    expect(r.entries.some((e) => e.code === "msg.note" && /^soubor nezapsán \(přísný režim zastaví běh\) – dokument zatím nemá výkres/.test(e.text))).toBe(true);
    expect(r.full).not.toMatch(/výkres PDF: Deska/);
  });
  it("`přísně` + dokument bez listu: řádek „nezapsán“ jmenuje drawing.default-sheet (jako Σ stop=), ne „nepředepsané tolerance“", { timeout: 180_000 }, async () => {
    const { r, files } = await run(`přísně\n${BARE}`);
    expect(r.protocol).toMatch(/stop=L4:drawing\.default-sheet/);
    expect(files.size).toBe(0);
    const unwritten = r.entries.filter((e) => /soubor nezapsán/.test(e.text));
    expect(unwritten).toHaveLength(1);
    expect(unwritten[0].text).toMatch(/– dokument zatím nemá výkres/);
    expect(unwritten[0].text).not.toMatch(/nepředepsané tolerance/);
  });
});

describe("kolo 7 (oponentura): vyhodnocení listu „✓ … bez nálezů“ nikdy nad nálezem téhož listu (22i)", () => {
  const run = async (t: string) => finalizeReport(await runReport(new MemoryWorkspace(), t, host(), { lang: "cs" }), { full: true });
  const sheetOk = (full: string | undefined) => (full ?? "").split("\n").filter((l) => /^✓ L\d+ výkres: list „List 1“ vyhodnocen bez nálezů/.test(l));
  it("export listu s ⚠ (bez nepředepsaných tolerancí): žádné ✓ listu, ℹ „nálezy listu hlásí řádek 4“", { timeout: 180_000 }, async () => {
    const r = await run('nový díl "Deska A"\nkvádr 60 40 10\nvýkres A4\nvýkres export pdf');
    expect(sheetOk(r.full)).toEqual([]);
    expect(r.entries.some((e) => e.line === 3 && e.code === "msg.note" && e.text === "výkres: list „List 1“ vyhodnocen – nálezy listu hlásí řádek 4")).toBe(true);
    expect(r.entries.some((e) => e.line === 4 && e.code === "drawing.warning")).toBe(true);
  });
  it("funkční plocha bez tolerované kóty hlášená u exportu (repro 79e): žádné ✓ listu, ℹ s řádkem exportu", { timeout: 180_000 }, async () => {
    const r = await run('nový díl "Deska A"\nkvádr 60 40 10\nvýkres A4\nvýkres nepředepsané ISO 2768-mK\nfunkční F2 ±0,02\nexport step\nvýkres export pdf');
    expect(sheetOk(r.full)).toEqual([]);
    expect(r.entries.some((e) => e.code === "msg.note" && /^výkres: list „List 1“ vyhodnocen – nálezy listu hlásí řádek 7$/.test(e.text))).toBe(true);
  });
  it("list dílu bez nepředepsaných tolerancí bez exportu: ℹ „… nepředepsané tolerance nezadány“, ne ✓; s tolerancemi ✓ zůstává", { timeout: 180_000 }, async () => {
    const r = await run('nový díl "Deska A"\nkvádr 60 40 10\nvýkres A4');
    expect(sheetOk(r.full)).toEqual([]);
    expect(r.entries.some((e) => e.code === "msg.note" && /^výkres: list „List 1“ vyhodnocen – pohledy, řezy a Chytré kóty bez nálezů, nepředepsané tolerance nezadány/.test(e.text))).toBe(true);
    const ok = await run('nový díl "Deska A"\nkvádr 60 40 10\nvýkres A4\nvýkres nepředepsané ISO 2768-mK');
    expect(sheetOk(ok.full)).toHaveLength(1);
  });
});

describe("kolo 7 (oponentura): strojový řádek F souboru bez kontroly platnosti není `check=ok` (22c)", () => {
  it("fileLine / souhrnný F: `check=unchecked` u souboru, který odpovídá modelu, ale jeho platnost se nezkontrolovala; fail má přednost", async () => {
    const { fileLine, filesSummaryLine } = await import("../engine/protocol");
    const f = (check: { ok: boolean; text: string; unchecked?: boolean }) => ({ name: "A.step", format: "step", mime: "model/step", bytes: 10, sha256: "", doc: "A", check });
    expect(fileLine(f({ ok: true, text: "x", unchecked: true }))).toMatch(/ check=unchecked$/);
    expect(fileLine(f({ ok: true, text: "x" }))).toMatch(/ check=ok$/);
    expect(filesSummaryLine([f({ ok: true, text: "x", unchecked: true }), f({ ok: true, text: "y" })])).toMatch(/ check=unchecked$/);
    expect(filesSummaryLine([f({ ok: true, text: "x", unchecked: true }), f({ ok: false, text: "y" })])).toMatch(/ check=fail$/);
  });
  it("záznam úlohy exportu bez kontroly platnosti (výpis `exporty`): „kontrola ℹ …“, ne „kontrola ✓“", async () => {
    const { exportLine, recordExport } = await import("../doc-outputs");
    const doc: CadDoc = { ...emptyDoc(), name: "A", features: [{ id: "b", name: "Kvádr 1", type: "box", size: [10, 10, 10], position: [0, 0, 0], mode: "new" } as never] };
    const rec = (check: { ok: boolean; text: string; unchecked?: boolean }) => recordExport(doc, { what: "model", format: "step", file: "A.step", job: { state: "done", ms: 10, check } }).rec;
    const text = "kontrola STEP: … → odpovídá modelu; platnost souboru nezkontrolována (3500 ploch > 3000; přísný režim ji zkontroluje)";
    const un = exportLine(doc, rec({ ok: true, text, unchecked: true }));
    expect(un).toContain(`kontrola ℹ ${text}`);
    expect(un).not.toContain("kontrola ✓");
    expect(exportLine(doc, rec({ ok: true, text: "kontrola STEP: věrná kopie" }))).toContain("kontrola ✓");
  });
});

describe("kolo 7: platnost souboru nad 3000 ploch – „✓ … jen rychlou kontrolou“ bez rychlé kontroly (22c)", () => {
  const box: [[number, number, number], [number, number, number]] = [[0, 0, 0], [10, 10, 10]];
  it("soubor nad mez bez jakékoli kontroly platnosti: ℹ „platnost souboru nezkontrolována (3500 ploch > 3000 …)“, ne ✓ a ne „jen rychlou kontrolou“", async () => {
    const { exportCheck } = await import("../agent-out");
    const c = exportCheck({ solids: 1, volume: 1000, bbox: box, valid: null }, { solids: 1, volume: 1000, bbox: box, valid: null, validExact: null, faces: 3500 }, "STEP");
    expect(c.line).toMatch(/^ℹ kontrola STEP: .* → odpovídá modelu; platnost souboru nezkontrolována \(3500 ploch > 3000; přísný režim ji zkontroluje\)$/);
    expect(c.line).not.toMatch(/rychlou kontrolou|věrná kopie|^✓/);
    expect(c.level).toBe("note");
    expect(c.validCheck).toBe("none");
    // rychlá kontrola proběhla a prošla: ✓ se slabší větou zůstává (nad 400 ploch bez přesné)
    const fast = exportCheck({ solids: 1, volume: 1000, bbox: box, valid: true }, { solids: 1, volume: 1000, bbox: box, valid: true, validExact: null, faces: 3500 }, "STEP");
    expect(fast.line).toMatch(/^✓ .*jen rychlou kontrolou – přesná neproběhla \(3500 ploch > 400\)$/);
  });
  it("přísný režim: kontrola zpětným načtením žádá jádro o platnost bez meze ploch (`exportStats(…, full)`); bez přísného režimu ne", { timeout: 180_000 }, async () => {
    const run = async (strict: boolean) => {
      const h = host();
      const calls: unknown[] = [];
      const k = h.kernel as unknown as Record<string, (...a: unknown[]) => unknown>;
      const kernel = new Proxy(k, { get: (t, p) => (p === "exportStats" ? (...a: unknown[]) => (calls.push(a[3] ?? false), t.exportStats(...a)) : typeof t[p as string] === "function" ? (t[p as string] as (...x: unknown[]) => unknown).bind(t) : t[p as string]) });
      const { resetExportChecks } = await import("../engine/files");
      resetExportChecks();
      await runReport(new MemoryWorkspace(), "nový díl Kostka\nkvádr 10 10 10\nexport step", { ...h, kernel: kernel as unknown as KernelApi }, { lang: "cs", strict });
      return calls;
    };
    expect(await run(true)).toEqual([true]);
    expect(await run(false)).toEqual([false]);
  });
  it("oponentura: STEP z `--formats` (finishRun → writeDocFormat) v přísném běhu také bez meze ploch; bez přísného ne (dřív jen výslovný `export step`)", { timeout: 180_000 }, async () => {
    const { engineRun, finishRun } = await import("../cli/job");
    const { ReportBuilder } = await import("../engine/protocol");
    const { resetExportChecks } = await import("../engine/files");
    const hooks = { opStart: () => undefined, opEnd: () => undefined };
    const run = async (strict: boolean) => {
      const h = host();
      const calls: unknown[] = [];
      const k = h.kernel as unknown as Record<string, (...a: unknown[]) => unknown>;
      const kernel = new Proxy(k, { get: (t, p) => (p === "exportStats" ? (...a: unknown[]) => (calls.push(a[3] ?? false), t.exportStats(...a)) : typeof t[p as string] === "function" ? (t[p as string] as (...x: unknown[]) => unknown).bind(t) : t[p as string]) });
      const hk = { ...h, kernel: kernel as unknown as KernelApi };
      resetExportChecks();
      const ws = new MemoryWorkspace();
      const script = "nový díl Kostka\nkvádr 10 10 10";
      const rb = new ReportBuilder({ lang: "cs", lines: 2, strict });
      await engineRun(ws, script, hk, rb, { strict, open: [] }, hooks);
      await finishRun(ws, hk, rb, { formats: ["step"], allDocs: false, noOutputOnError: false, share: false, strict }, hooks);
      return calls;
    };
    expect(await run(true)).toEqual([true]);
    expect(await run(false)).toEqual([false]);
  });
});
