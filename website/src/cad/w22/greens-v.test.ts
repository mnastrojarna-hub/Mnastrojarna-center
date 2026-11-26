/**
 * Vlna 22, balík V (body 13 a 14) – „žádné falešně zelené“: úspěšný text exportu videa / snímků a anotací se nesmí objevit,
 * když kontrola neproběhla, proběhla na jiném vstupu, nebo selhala.
 *  - „obraz se mění ve všech … snímcích“ jen když se obraz opravdu měnil s polohou (mrtvé plátno = ✗, část = ⚠);
 *  - video, jehož soubor neodpovídá plánu (délka 2,926 s pro studii 0,65 s, chybějící snímky), kontrola souboru odmítne;
 *  - anotace nikdy nepíší vůli ani hloubku zásahu, které se nepočítaly; „✓“ u pohledu jen když se opravdu uložil.
 *  - V2 (řez v sestavě): věta „čela řezu“ jen tam, kde okno čela opravdu kreslí (ne v drátovém modelu, ne bez komponent),
 *    a skořepina bez objemu / tlumená komponenta v softwarovém náhledu čelo nedostane (nic se „nezaslepuje“ naoko).
 */
import { describe, expect, it } from "vitest";
import { applyMotionViewCmd } from "../agent-motion-view";
import { parseMotionText, type MotionCmd } from "../agent-motion";
import { setLang } from "../i18n";
import type { MotionResult } from "../motion";
import { checkFrames, checkText, combineChecks, frameSig, videoPlan } from "../motion-video";
import { annotRows } from "../motion-views";
import { emptyDoc, type CadDoc } from "../types";
import { checkWebm, muxWebm, readWebm } from "../webm-mux";
import { capStyles, capSummary, softCapStyles } from "../section-cap";

setLang("cs");
const OK_FRAMES = /obraz se mění ve všech/;

describe("greens V: kontrola obrazu snímků", () => {
  const gray = (v: number) => {
    const d = new Uint8ClampedArray(32 * 18 * 4);
    for (let i = 0; i < 32 * 18; i++) d.set([v, v, v, 255], i * 4);
    return frameSig(d, 32, 18);
  };
  it("mrtvé plátno (poloha se mění, obraz ne) → ✗, nikdy „mění ve všech“", () => {
    const c = checkFrames(Array.from({ length: 20 }, (_, i) => ({ pose: `p${i}`, sig: gray(90) })));
    expect(c.verdict).toBe("dead");
    expect(checkText(c)).not.toMatch(OK_FRAMES);
    expect(checkText(c)).toMatch(/^✗/);
  });
  it("dva pohledy, jeden nehybný → ⚠ s názvem pohledu, nikdy „mění ve všech“ ani ✓", () => {
    const live = checkFrames(Array.from({ length: 20 }, (_, i) => ({ pose: `p${i}`, sig: gray(60 + i * 8) })));
    const dead = checkFrames(Array.from({ length: 20 }, (_, i) => ({ pose: `p${i}`, sig: gray(90) })));
    expect(live.verdict).toBe("ok");
    const c = combineChecks([live, dead], ["Řez", "Shora"]);
    expect(c.verdict).toBe("partial");
    expect(checkText(c)).not.toMatch(OK_FRAMES);
    expect(checkText(c)).toMatch(/^⚠.*„Shora“/);
  });
  it("část snímků beze změny obrazu → ⚠, ne úspěch", () => {
    const c = checkFrames([0, 1, 2, 3].map((i) => ({ pose: `p${i}`, sig: gray(i < 2 ? 90 + i * 20 : 110) })));
    expect(c.verdict).toBe("partial");
    expect(checkText(c)).not.toMatch(OK_FRAMES);
  });
  it("studie bez pohybu → ℹ (nic se nekontrolovalo proti pohybu), ne úspěch", () => {
    const c = checkFrames([{ pose: "a", sig: gray(90) }, { pose: "a", sig: gray(90) }]);
    expect(checkText(c)).not.toMatch(OK_FRAMES);
  });
  it("úspěch jen když se obraz mění s polohou", () => {
    const c = checkFrames([0, 1, 2].map((i) => ({ pose: `p${i}`, sig: gray(90 + i * 30) })));
    expect(checkText(c)).toMatch(OK_FRAMES);
  });
});

describe("greens V: kontrola hotového videa proti plánu", () => {
  const fr = (n: number) => Array.from({ length: n }, (_, i) => ({ data: new Uint8Array([i, i + 1, i + 2]), time: (i * 1000) / 30, key: i === 0 }));
  it("délka 2,926 s pro studii 0,65 s při 1× (zpráva majitele) → rozpor", () => {
    expect(checkWebm(readWebm(muxWebm({ codec: "V_VP8", width: 8, height: 8, fps: 30, frames: fr(88), duration: 2926 })), videoPlan(0.65)).length).toBeGreaterThan(0);
  });
  it("správná délka, ale chybějící snímky → rozpor", () => {
    expect(checkWebm(readWebm(muxWebm({ codec: "V_VP8", width: 8, height: 8, fps: 30, frames: fr(19), duration: 666.67 })), videoPlan(0.65)).join(" ")).toMatch(/blocks/);
  });
  it("odpovídající video → bez rozporu", () => {
    expect(checkWebm(readWebm(muxWebm({ codec: "V_VP8", width: 8, height: 8, fps: 30, frames: fr(20), duration: 666.667 })), videoPlan(0.65))).toEqual([]);
  });
});

describe("greens V: anotace a pohledy", () => {
  const doc = (): CadDoc => ({ ...emptyDoc(), kind: "assembly", name: "S", components: [], mates: [], motion: { motors: [], duration: 1, steps: 4 } });
  it("bez kontroly vůle a bez procesní vrstvy anotace vůli ani zásah nepíší", () => {
    const rows = annotRows({ t: 0, step: 0, steps: 5, motors: [], stepData: { conflicts: [] } }, doc());
    expect(rows.some((r) => r.key === "clearance" || r.key === "cut")).toBe(false);
    expect(rows.map((r) => r.text).join(" ")).not.toMatch(/vůle|zásah/);
  });
  it("vůle: studie ji sleduje, výsledek ji nemá → „vůle: nezkontrolováno“ ⚠ (ne mlčení, ne hodnota); dvojice bez měření → „nezměřeno“", () => {
    const d: CadDoc = { ...doc(), motion: { motors: [], duration: 1, steps: 4, clearance: { pairs: [{ a: "x", b: "y" }], limit: 0.1 } } };
    const none = annotRows({ t: 0, step: 0, steps: 5, motors: [] }, d, { res: { steps: [] } });
    expect(none.filter((r) => r.key === "clearance")).toEqual([{ key: "clearance", text: "vůle: nezkontrolováno", warn: true }]);
    // kontrola proběhla, ale dvojici nezměřila (bez tělesa) – žádné číslo, žádné „dodrženo“
    const res = { steps: [], clearance: { limit: 0.1, moving: false, pairs: [], poses: 5, refined: 0 } };
    const rows = annotRows({ t: 0, step: 0, steps: 5, motors: [] }, d, { res });
    expect(rows.filter((r) => r.key === "clearance")).toEqual([{ key: "clearance", text: "vůle x × y: nezměřeno", warn: true }]);
    // vůle nad limitem: hodnota bez ⚠, ale nikdy ✓ / „dodržen“ (anotace kroku netvrdí nic o celém pohybu)
    const ok = { steps: [], clearance: { limit: 0.1, moving: false, pairs: [{ a: "x", b: "y", min: { d: 0.2, exact: true, pos: 0, t: 0, motors: [] }, series: [0.2], pts: [null], below: [], unproven: 0 }], poses: 1, refined: 0 } };
    const r2 = annotRows({ t: 0, step: 0, steps: 1, motors: [] }, d, { res: ok }).filter((r) => r.key === "clearance");
    expect(r2).toEqual([{ key: "clearance", text: "vůle x × y: 0,2 mm (min. 0,1)", warn: false }]);
    expect(r2[0].text).not.toMatch(/✓|dodržen|ok/);
  });
  it("vůle „pohyblivé“: dvojice nezměřená v kroku se nevypisuje (nic se o ní netvrdí)", () => {
    const d: CadDoc = { ...doc(), motion: { motors: [], duration: 1, steps: 4, clearance: { pairs: "moving", limit: 0.1 } } };
    const res = { steps: [], clearance: { limit: 0.1, moving: true, pairs: [{ a: "x", b: "y", min: { d: 0.05, exact: true, pos: 1, t: 0, motors: [] }, series: [null, 0.05], pts: [], below: [1], unproven: 0 }], poses: 2, refined: 0, reach: 1.2 } };
    expect(annotRows({ t: 0, step: 0, steps: 2, motors: [] }, d, { res }).some((r) => r.key === "clearance")).toBe(false);
    expect(annotRows({ t: 0, step: 1, steps: 2, motors: [] }, d, { res }).find((r) => r.key === "clearance")).toMatchObject({ text: "⚠ vůle x × y: 0,05 mm (min. 0,1)", warn: true });
  });
  it("nesplněné vazby / kolize kroku jsou v anotaci ⚠, ne mlčení", () => {
    const rows = annotRows({ t: 0, step: 0, steps: 5, motors: [], stepData: { conflicts: ["m1"], clashes: [{}] } }, doc());
    expect(rows.find((r) => r.key === "flags")).toMatchObject({ warn: true, text: "⚠ kolize · nesplněno 1" });
  });
  it("„✓ pohled … uložen“ jen když se pohled do studie opravdu zapsal; neplatný řez = chyba, žádné ✓", async () => {
    const run = (line: string) => applyMotionViewCmd(doc(), (parseMotionText(line) as Extract<MotionCmd, { op: "view" }>).cmd, { run: async () => ({ steps: [] }) as unknown as MotionResult });
    const r = await run('pohyb pohled uložit "A" řez Z 5');
    expect(r.log[0].startsWith("✓")).toBe(true);
    expect(r.doc.motion!.views).toHaveLength(1);
    expect(() => parseMotionText('pohyb pohled uložit "A" řez normála 0 0 0')).toThrow(/nulový/);
    // bez studie: chyba, ne ✓
    const bare: CadDoc = { ...doc(), motion: undefined };
    await expect(applyMotionViewCmd(bare, { k: "save", name: "A" }, { run: async () => ({ steps: [] }) as unknown as MotionResult })).rejects.toThrow(/nemá pohybovou studii/);
  });
});

describe("greens V2: čela řezu v sestavě", () => {
  const comps = [{ id: "a", color: "#b9c2cc" }, { id: "b", color: "#4678c8", solid: false }, { id: "c", color: "#4678c8", dim: true }];
  it("„čela řezu“ se neříká v drátovém modelu ani bez komponent", () => {
    expect(capSummary(3, "wireframe")).not.toMatch(/čela řezu: každá/);
    expect(capSummary(3, "wireframe")).toMatch(/nekreslí/);
    expect(capSummary(0, "shadedEdges")).toBe("");
    expect(capSummary(3, "shadedEdges")).toMatch(/čela řezu: každá komponenta s objemem/);
  });
  it("drátový model: žádné čelo; skořepina bez objemu čelo nemá; tlumená v softwarovém náhledu také ne", () => {
    expect(capStyles(comps, "wireframe").every((s) => s === null)).toBe(true);
    const gl = capStyles(comps, "shadedEdges");
    expect(gl[0]).not.toBeNull();
    expect(gl[1]).toBeNull();
    expect(gl[2]!.opacity).toBe(0.18); // WebGL: průhledné čelo jako průhledné tělo
    const soft = softCapStyles(comps, "shadedEdges");
    expect(soft[2]).toBeNull(); // softwarový náhled kreslí tlumenou komponentu jen v hranách – bez čela
  });
});
