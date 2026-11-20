/**
 * Vlna 22, body 13 a 14: pohledy studie (kamera + řez), časování videa a anotace textem – rozbor CS / EN / DE, provedení nad
 * dokumentem (pohled je součást studie a přežije uložení), časový plán exportu v protokolu, tam a zpět přes převodník
 * dokument → skript a nezávislost výsledku studie na pohledech (otisk vstupu se nemění).
 */
import { afterEach, describe, expect, it } from "vitest";
import { parseAgentText } from "./agent";
import type { AsmCmd } from "./agent-asm";
import { parseMotionText, type MotionCmd } from "./agent-motion";
import { applyMotionViewCmd, type MotionViewCmd } from "./agent-motion-view";
import type { AsmOut } from "./doc-script-asm";
import { emitMotionViews } from "./doc-script-motion-view";
import { setLang } from "./i18n";
import type { MotionResult } from "./motion";
import { motionSig } from "./motion-cache";
import { activeView, annotRows } from "./motion-views";
import { emptyDoc, type CadDoc, type MotionStudy } from "./types";

afterEach(() => setLang("cs"));

const view = (line: string): MotionViewCmd => {
  const c = parseMotionText(line);
  expect(c.op, line).toBe("view");
  return (c as Extract<MotionCmd, { op: "view" }>).cmd;
};

/** sestava se studií 0,65 s / 112 kroků (repro 13) – bez geometrie, příkazy pohledů ji nepotřebují */
function asm(motion?: Partial<MotionStudy>): CadDoc {
  return { ...emptyDoc(), kind: "assembly", name: "Studie", components: [], mates: [{ id: "m1", type: "distance", name: "ZDVIH", a: { compId: "a", face: 0 }, b: { compId: "b", face: 0 }, value: 57.5 } as never], motion: { motors: [{ id: "mo1", kind: "linear", mate: "m1", from: 57.5, to: 27.15 }], duration: 0.65, steps: 112, ...motion } };
}
const fakeRes = (T = 0.65, n = 112): MotionResult => ({ steps: Array.from({ length: n + 1 }, (_, i) => ({ i, t: (T * i) / n, motors: [57.5 - (30.35 * i) / n], place: {}, conflicts: [] })), comps: [], motors: [], collision: null, collisionsChecked: false, conflictSteps: 0 });
const run = async (d: CadDoc, line: string) => {
  let ran = 0;
  const r = await applyMotionViewCmd(d, view(line), { run: async () => (ran++, fakeRes()) });
  return { ...r, ran };
};

describe("rozbor: pohledy, video, anotace (CS / EN / DE)", () => {
  it("uložit pohled: řez osou, kamera pojmenovaná / směr + cíl + výška, bez řezu", () => {
    expect(view('pohyb pohled uložit "Řez pružinami" řez Y 50 kamera přední')).toEqual({ k: "save", name: "Řez pružinami", section: { axis: "Y", offset: 50, flip: false }, camera: { view: "front" } });
    expect(view('motion view save "Punch" section X 20 flip camera top')).toEqual({ k: "save", name: "Punch", section: { axis: "X", offset: 20, flip: true }, camera: { view: "top" } });
    expect(view('bewegung ansicht speichern "Stempel" schnitt Z -5,5 kamera oben')).toEqual({ k: "save", name: "Stempel", section: { axis: "Z", offset: -5.5, flip: false }, camera: { view: "top" } });
    expect(view('pohyb pohled uložit "B" směr 1 0 0 cíl 0 0 10 výška 120 bez řezu')).toEqual({ k: "save", name: "B", camera: { dir: [1, 0, 0], target: [0, 0, 10], height: 120 }, section: null });
    expect(view('pohyb pohled uložit "N" řez normála 1 0 1 bod 0 0 5 posun 2 obráceně')).toEqual({ k: "save", name: "N", section: { axis: "Z", offset: 2, flip: true, normal: [1, 0, 1], origin: [0, 0, 5] } });
    expect(() => view('pohyb pohled uložit "X" řez W 5')).toThrow(/X \| Y \| Z/);
    expect(() => view('pohyb pohled uložit "X" výška -1')).toThrow(/kladná/);
  });
  it("aktivní pohled, okno, smazat, výpis", () => {
    expect(view('pohyb pohled "Řez pružinami"')).toEqual({ k: "use", ref: "Řez pružinami" });
    expect(view("motion view 2")).toEqual({ k: "use", ref: "2" });
    expect(view("pohyb pohled okno")).toEqual({ k: "use", ref: null });
    expect(view('bewegung ansicht löschen "A"')).toEqual({ k: "remove", ref: "A" });
    expect(view("pohyb pohledy")).toEqual({ k: "list" });
    expect(view("motion views")).toEqual({ k: "list" });
  });
  it("video: rychlost (i 0,5×), FPS, ruční délka, pohledy, anotace; export png|webm s volbami; csv zůstává", () => {
    expect(view("pohyb video rychlost 0,25 fps 60")).toEqual({ k: "video", args: { speed: 0.25, fps: 60 } });
    expect(view("pohyb video 0,5×")).toEqual({ k: "video", args: { speed: 0.5 } });
    expect(view("motion video length 5 annotations off")).toEqual({ k: "video", args: { seconds: 5, annot: false } });
    expect(view("bewegung video geschwindigkeit 1 länge 2s")).toEqual({ k: "video", args: { speed: 1, seconds: 2 } });
    expect(view('pohyb export webm rychlost 0,5 pohled "A" "B"')).toEqual({ k: "export", format: "webm", args: { speed: 0.5, views: ["A", "B"] } });
    expect(view("pohyb export video pohledy vše")).toEqual({ k: "export", format: "webm", args: { views: "all" } });
    expect(view("pohyb export png kroky")).toEqual({ k: "export", format: "png", args: { perStep: true } });
    expect(view("pohyb anotace vyp")).toEqual({ k: "annot", on: false });
    expect(view("motion annotations on")).toEqual({ k: "annot", on: true });
    expect(parseMotionText("pohyb export csv")).toEqual({ op: "export", format: "csv" });
    expect(() => view("pohyb video rychlost -1")).toThrow(/rychlost/);
    expect(() => view("pohyb video kolize")).toThrow(/neznámá volba/);
  });
  it("celý řádek přes parseAgentText (konzole)", () => {
    const p = parseAgentText('pohyb pohled uložit "A" řez Y 50');
    expect(p.errors).toEqual([]);
    const c = (p.ops[0] as { cmd: AsmCmd }).cmd as Extract<AsmCmd, { k: "motion" }>;
    expect(c.cmd).toEqual({ op: "view", cmd: { k: "save", name: "A", section: { axis: "Y", offset: 50, flip: false } } });
  });
});

describe("provedení: pohled je součást studie, výsledek studie na něm nezávisí", () => {
  it("uložit → aktivovat → výpis → smazat; otisk výsledku (motionSig) se pohledy nemění", async () => {
    const d0 = asm();
    const sig0 = motionSig(d0);
    const a = await run(d0, 'pohyb pohled uložit "Řez pružinami" řez Y 50 kamera přední');
    expect(a.changed).toBe(true);
    expect(a.doc.motion!.views).toHaveLength(1);
    expect(a.log[0]).toBe("✓ pohled studie „Řez pružinami“ uložen: kamera přední · řez Y 50 mm");
    const b = await run(a.doc, 'pohyb pohled uložit "Řez pružinami" řez X 20');
    expect(b.doc.motion!.views).toHaveLength(1);
    expect(b.doc.motion!.views![0].id).toBe(a.doc.motion!.views![0].id);
    expect(b.log[0]).toContain("nahrazen");
    const c = await run(b.doc, 'pohyb pohled "Řez pružinami"');
    expect(activeView(c.doc.motion)?.name).toBe("Řez pružinami");
    expect(c.motion).toEqual({ open: true, view: c.doc.motion!.view });
    expect(motionSig(c.doc)).toBe(sig0);
    const l = await run(c.doc, "pohyb pohledy");
    expect(l.log.join("\n")).toContain("▸ 1. „Řez pružinami“");
    const e = await run(c.doc, "pohyb pohled smazat 1");
    expect(e.doc.motion!.views).toBeUndefined();
    expect(e.doc.motion!.view).toBeUndefined();
    await expect(run(c.doc, 'pohyb pohled "Neexistuje"')).rejects.toThrow(/není/);
  });
  it("pohyb video: uloží volby a vypíše plán s poměrem ke studii; strojový řádek", async () => {
    const r = await run(asm(), "pohyb video rychlost 0,25");
    expect(r.doc.motion!.video).toEqual({ speed: 0.25 });
    expect(r.log[0]).toBe("Video studie: video 2,6 s = 4 × délka studie 0,65 s · rychlost 0,25× · 30 fps · 78 snímků (tolerance ±1 snímek = ±0,033 s)");
    expect(r.kv).toBe("video seconds=2.6 study=0.65 fps=30 frames=78 speed=0.25 ratio=4");
    expect(motionSig(r.doc)).toBe(motionSig(asm()));
    const m = await run(r.doc, "pohyb video délka 1");
    expect(m.doc.motion!.video).toEqual({ seconds: 1 });
  });
  it("pohyb export webm: výsledek studie, plán v protokolu, pokyn pro aplikaci s volbami (CLI ho ohlásí ✗ host.app-only)", async () => {
    const r = await run(asm({ video: { fps: 60 } }), "pohyb export webm rychlost 1");
    expect(r.ran).toBe(1);
    expect(r.changed).toBe(false);
    expect(r.motion).toEqual({ open: true, export: "webm", video: { speed: 1, fps: 60 } });
    expect(r.log[0]).toContain("Video WebM s pevným časováním: video 0,65 s = 1 × délka studie 0,65 s");
    expect(r.kv).toContain("frames=39");
    const p = await run(asm(), "pohyb export png");
    expect(p.motion).toEqual({ open: true, export: "png", video: { perStep: true } });
    expect(p.log[0]).toContain("113 snímků po vypočtených krocích");
    await expect(run(asm(), "pohyb export webm kroky")).rejects.toThrow(/jen pro snímky PNG/);
  });
  it("anotace: vypnout / zapnout; řádky anotace bez vůle a zásahu, dokud je nic nepočítá", async () => {
    const off = await run(asm(), "pohyb anotace vyp");
    expect(off.doc.motion!.annot).toEqual({ off: true });
    const on = await run(off.doc, "pohyb anotace zap");
    expect(on.doc.motion!.annot).toBeUndefined();
    const rows = annotRows({ t: 0.325, step: 56, steps: 113, motors: [42.33] }, asm(), { study: 0.65 });
    expect(rows.map((x) => x.text)).toEqual(["t = 0,325 s / 0,65 s", "krok 56/112", "ZDVIH 42,33 mm"]);
    const withCl = annotRows({ t: 0, step: 0, steps: 2, motors: [57.5], stepData: { clearance: [{ a: "Razník", b: "Plech", min: 0.4, limit: 0.5 }], cut: [{ label: "Razník", depth: 1.2 }] } }, asm());
    expect(withCl.find((x) => x.key === "clearance")).toMatchObject({ text: "vůle Razník × Plech: 0,4 mm (min. 0,5)", warn: true });
    expect(withCl.find((x) => x.key === "cut")?.text).toBe("zásah Razník: 1,2 mm");
  });
  it("EN / DE protokol", async () => {
    setLang("en");
    const r = await run(asm(), "motion video speed 0.5");
    expect(r.log[0]).toMatch(/^Study video: video 1.3 s/);
  });
});

describe("převodník dokument → skript: pohledy, aktivní pohled, video, anotace tam a zpět", () => {
  const out = (li: 0 | 1 | 2) => {
    const lines: string[] = [];
    const notes: string[] = [];
    const o: AsmOut = { li, line: (s) => lines.push(s), note: (s) => notes.push(s), n: (v) => String(v), q: (s) => (s.includes('"') ? null : `"${s}"`) };
    return { o, lines, notes };
  };
  for (const li of [0, 1, 2] as const) {
    it(`jazyk ${["cs", "en", "de"][li]}: řádky se přečtou a dají tutéž studii`, async () => {
      const study: Partial<MotionStudy> = {
        views: [
          { id: "v1", name: "Řez pružinami", camera: { view: "front" }, section: { axis: "Y", offset: 50, flip: false } },
          { id: "v2", name: "Razník", camera: { dir: [0.57735, -0.57735, 0.57735], target: [10, 0, 25.5], height: 140 }, section: { axis: "Z", offset: 0, flip: true, normal: [1, 0, 1], origin: [0, 0, 5] } },
          { id: "v3", name: "Celek", section: null },
        ],
        view: "v2",
        video: { speed: 0.25, fps: 60, views: ["v1", "v2"], annot: false },
        annot: { off: true },
      };
      const src = asm(study);
      const { o, lines, notes } = out(li);
      emitMotionViews(o, src.motion);
      expect(notes).toEqual([]);
      expect(lines).toHaveLength(6);
      // přehrát řádky nad studií bez pohledů
      let d = asm();
      for (const l of lines) d = (await applyMotionViewCmd(d, view(l), { run: async () => fakeRes() })).doc;
      const m = d.motion!;
      expect(m.views!.map((v) => ({ name: v.name, camera: v.camera, section: v.section }))).toEqual(study.views!.map((v) => ({ name: v.name, camera: v.camera, section: v.section })));
      expect(activeView(m)?.name).toBe("Razník");
      expect(m.video).toMatchObject({ speed: 0.25, fps: 60, annot: false });
      expect(m.video!.views!.map((id) => m.views!.find((v) => v.id === id)!.name)).toEqual(["Řez pružinami", "Razník"]);
      expect(m.annot).toEqual({ off: true });
    });
  }
});
