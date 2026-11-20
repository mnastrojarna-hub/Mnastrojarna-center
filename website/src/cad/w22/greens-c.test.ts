/**
 * Vlna 22, balík C1 (bod 5) – test „žádné falešné zelené“. Úspěšné / uklidňující texty, kterých se třídění kolizí dotklo, a kdy
 * se NESMÍ vypsat (kontrola neproběhla, dvojice nebyla zařazena, pravidlo neplatí, průnik existuje):
 *
 *  1. panel Kolize „Bez kolizí ✓“                     – jen stav `ok`; průnik jen „šroub v závitu“ = „Kolize (N) · šroub v závitu N“
 *  2. protokol „✓ kolize: žádné (N komponent)“         – jen bez průniku; šrouby v závitu = „kolize: N – šroub v závitu N, skutečné 0“
 *  3. pohyb „Kolize: žádné ve všech krocích“           – jen bez průniku v krocích; šroub v závitu / dotyk / pracovní kontakt ne
 *  4. ℹ dotyk / ℹ pracovní kontakt / ℹ šroub v závitu – nezařazená dvojice (bez třídy z jádra) je vždy ⚠ skutečná (slabší tvrzení);
 *     dotyk jen s naměřenou tloušťkou pod tolerancí; pracovní kontakt jen v okně pravidla (mimo okno ⚠)
 *  5. bez štítku „· kolize“ u kroku / bez zvýraznění ve 3D – jen když v kroku / sestavě není závada
 */
import { describe, expect, it } from "vitest";
import { setLang } from "../i18n";
import type { ClashDetail } from "../clash-class";
import { applyClashPolicy, staticRuleCtx, stepRuleCtx } from "../clash-rules";
import { entryClashes, faultLeafIds, motionClashSummary, stepHasFault } from "../clash-report";
import { clashTitle, clashTitleClasses } from "../../components/cad/clash-view";
import { countClasses } from "../clash-class";
import { memoryFileSink, memoryFileSource, type EngineHost } from "../engine/host";
import { MemoryWorkspace } from "../engine/memory-workspace";
import { formatConsole } from "../engine/protocol";
import { runScript } from "../engine/run";
import type { KernelApi } from "../engine/kernel";
import type { AsmComponent, BuildResult, CadDoc, ComponentSource } from "../types";
import { emptyDoc } from "../types";

setLang("cs");
const part = (name: string): CadDoc => ({ ...emptyDoc(name) }) as CadDoc;
const comp = (id: string, name: string): AsmComponent => ({ id, name, source: { kind: "part", doc: part(name) }, placement: { position: [0, 0, 0], rotation: [0, 0, 0] } }) as AsmComponent;
const doc: CadDoc = { ...emptyDoc("S"), kind: "assembly", components: [comp("d", "Deska A"), comp("s", "Šroub M12"), comp("r", "Razník"), comp("pl", "Plech")] } as CadDoc;
const det = (a: string, b: string, cls: ClashDetail["cls"], extra: Partial<ClashDetail> = {}): ClashDetail => ({ a, b, volume: 250, cls, why: cls === "thread" ? "thread" : "no-thread", aPath: [a], bPath: [b], ...extra });

describe("vlna 22 C1: žádné falešné zelené u tříd kolizí (bod 5)", () => {
  it("1. panel Kolize: průnik jen „šroub v závitu“ nikdy „Bez kolizí ✓“ – titulek uvede počet a třídy", () => {
    const c = countClasses([det("d", "s", "thread"), det("d", "s", "thread")]);
    const t = clashTitleClasses("clash", 2, c);
    expect(t).toBe("Kolize (2) · šroub v závitu 2");
    expect(t).not.toMatch(/✓|Bez kolizí/);
    expect(clashTitleClasses("stale", 2, c)).toBe(clashTitle("stale", 2));
    expect(clashTitleClasses("unchecked", 0, null)).not.toMatch(/✓/);
  });

  it("2. protokol `kolize`: šrouby v závitu nedají „✓ kolize: žádné“", async () => {
    const result = (d: CadDoc): BuildResult => ({ status: d.features.map((f) => ({ id: f.id, ok: true })), mesh: null, metrics: d.features.length ? { volume: 1000, area: 600, bbox: [[0, 0, 0], [10, 10, 10]], faces: 6, edges: 12, valid: true, solids: 1 } : null, ms: 1 }) as unknown as BuildResult;
    const kernel = {
      generation: () => 1,
      build: async (d: CadDoc) => result(d),
      asmParts: async (parts: { key: string; source: ComponentSource }[]) => parts.map((p) => ({ key: p.key, result: result(p.source.kind === "part" ? p.source.doc : emptyDoc()) })),
      interference: async (d: CadDoc) => [{ a: d.components![0].id, b: d.components![1].id, volume: 250 }],
      clashDetail: async (_d: CadDoc, pairs: { a: string; b: string; volume: number }[]) => pairs.map((p) => ({ ...p, cls: "thread", why: "thread" })),
    } as unknown as KernelApi;
    const host: EngineHost = { kernel, files: memoryFileSink(), inputs: memoryFileSource({}), now: () => Date.now() };
    const con = formatConsole(await runScript(new MemoryWorkspace(), 'nový díl Deska\nkvádr 10 10 10\nnový díl Šroub\nválec 5 10\nnová sestava S\nvložit "Deska" ukotvit\nvložit "Šroub"\nkolize\nstav', host));
    expect(con).toMatch(/^kolize: 1 – šroub v závitu 1, skutečné 0$/m);
    expect(con).not.toMatch(/✓ kolize: žádné/);
    expect(con).toMatch(/^Kolize: 1 – šroub v závitu 1 \(zkontrolováno/m);
    expect(con).not.toMatch(/^Kolize: žádné/m);
  });

  it("3. pohyb: „Kolize: žádné ve všech krocích“ jen bez průniku – ne při šroubu v závitu, dotyku ani pracovním kontaktu", () => {
    const st = (clashes: ClashDetail[]) => ({ steps: [0, 1, 2].map((i) => ({ i, t: i, motors: [i], clashes })), collisionsChecked: true });
    expect(motionClashSummary(st([]), doc).lines).toEqual(["Kolize: žádné ve všech krocích"]);
    for (const c of [det("d", "s", "thread"), det("d", "s", "real", { depth: 0.0001 }), det("r", "pl", "real")]) {
      const d = c.a === "r" ? { ...doc, clashRules: [{ id: "r1", kind: "work" as const, a: ["r"], b: ["pl"] }] } : doc;
      const lines = motionClashSummary(st([c]), d).lines;
      expect(lines.join("\n")).not.toMatch(/žádné ve všech krocích/);
    }
  });

  it("4. nezařazená dvojice je skutečná; dotyk jen s naměřenou tloušťkou; pracovní kontakt jen v okně pravidla", () => {
    // výsledek bez zařazení z jádra (starší záznam, cizí prostředí): nikdy ℹ
    expect(entryClashes({ res: [{ a: "d", b: "s", volume: 250 }] }, doc)[0].cls).toBe("real");
    expect(applyClashPolicy([{ a: "d", b: "s", volume: 250 }], doc, staticRuleCtx(doc))[0].cls).toBe("real");
    // tloušťka neznámá → ne dotyk
    expect(applyClashPolicy([det("d", "s", "real")], doc, staticRuleCtx(doc))[0].cls).toBe("real");
    // pracovní kontakt s oknem kroků: staticky (poloha z dokumentu) neplatí, v kroku mimo okno neplatí
    const d = { ...doc, clashRules: [{ id: "r1", kind: "work" as const, a: ["r"], b: ["pl"], when: { steps: [0, 2] as [number, number] } }] };
    expect(applyClashPolicy([det("r", "pl", "real")], d, staticRuleCtx(d))[0].cls).toBe("real");
    expect(applyClashPolicy([det("r", "pl", "real")], d, stepRuleCtx(d, { i: 5, motors: [] }))[0].cls).toBe("real");
    // pravidlo závit nepřevede skutečnou kolizi (jen šroub v jádrové díře bez prvku závitu)
    const t = { ...doc, clashRules: [{ id: "r1", kind: "thread" as const, a: ["d"], b: ["s"] }] };
    expect(applyClashPolicy([det("d", "s", "real")], t, staticRuleCtx(t))[0].cls).toBe("real");
  });

  it("5. bez štítku „· kolize“ a bez zvýraznění jen tehdy, když krok / sestava nemá závadu", () => {
    expect(stepHasFault(doc, { i: 0, t: 0, motors: [], clashes: [det("d", "s", "thread")] })).toBe(false);
    expect(stepHasFault(doc, { i: 0, t: 0, motors: [], clashes: [{ a: "d", b: "s", volume: 250 }] })).toBe(true); // nezařazená
    expect(stepHasFault(doc, { i: 0, t: 0, motors: [], clashes: [det("d", "s", "undetermined")] })).toBe(true);
    expect(faultLeafIds([det("d", "s", "thread")]).size).toBe(0);
    expect([...faultLeafIds([det("d", "s", "undetermined")])].sort()).toEqual(["d", "s"]);
  });
});
