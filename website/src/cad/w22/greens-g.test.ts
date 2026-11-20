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
 */
import { beforeAll, describe, expect, it } from "vitest";
import { docStatusText } from "../agent";
import { setLang } from "../i18n";
import type { EngineHost } from "../engine/host";
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

describe("22b – případ H (drážka závitu celá ve stěně): čeká na etapu G2", () => {
  // Dnes: ✓ s účinkem „(celý nástroj)“ – nástroj závitu je celý v materiálu, drážka do díry neústí. Etapa G2 (22a/22b) přidá
  // ⚠ thread.no-reach; až bude hotová, tento test „selže“ (it.fails) a nahradí se přímým očekáváním ⚠.
  it.fails("H nesmí být ✓ (po G2: ⚠ thread.no-reach)", { timeout: 180_000 }, async () => {
    const r = await runScript(new MemoryWorkspace(), 'nový díl "Deska H"\ntrubka 30 16.4 20\nprvek surf.helixSweep profile=thread60 radius=9 depth=0.8 pitch=1.5 turns=12 side=internal mode=cut', host());
    expect(r.entries.filter((e) => e.line === 3 && e.level === "ok")).toEqual([]);
  });
  it("H dnes: úroveň účinku říká „celý nástroj“ – vodítko, že drážka leží celá v materiálu", { timeout: 180_000 }, async () => {
    const r = await runScript(new MemoryWorkspace(), 'nový díl "Deska H"\ntrubka 30 16.4 20\nprvek surf.helixSweep profile=thread60 radius=9 depth=0.8 pitch=1.5 turns=12 side=internal mode=cut', host());
    const e = r.entries.find((x) => x.line === 3 && x.level === "ok")!;
    expect(e.text).toMatch(/úběr \d+(,\d+)? mm³ \((celý nástroj|>99 % nástroje)\) · těleso platné/);
  });
});
