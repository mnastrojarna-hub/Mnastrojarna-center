/**
 * Vlna 22, bod 13 zprávy: časování videa pohybové studie. Studie 0,65 s / 112 kroků dala při 1× video 2,9–3,8 s (záznam
 * obrazovky v reálném čase, FPS = počet kroků / délka oříznuté na 5–30). Plán exportu musí dát délku studie / rychlost ± 1 snímek
 * nezávisle na počtu kroků a rychlosti vykreslení a snímky musí ukazovat různé polohy (žádné mrtvé plátno).
 */
import { describe, expect, it } from "vitest";
import { setLang } from "./i18n";
import { rotMatrix } from "./assembly";
import { checkFrames, checkText, combineChecks, frameSig, planKv, planText, poseAt, poseKey, sigChanged, slerpRotation, stepPlan, studySpan, videoApi, videoPlan, VIDEO_MAX_FRAMES } from "./motion-video";
import type { MotionResult, MotionStep } from "./motion";
import type { Vec3 } from "./types";

setLang("cs");

/** výsledek studie: komponenta A jede po Z z 57,5 na 27,15 mm (zdvih jako v repro 13), `n` kroků za `T` s */
function study(n: number, T: number): Pick<MotionResult, "steps"> {
  const steps: MotionStep[] = Array.from({ length: n + 1 }, (_, i) => ({ i, t: (T * i) / n, motors: [57.5 - (30.35 * i) / n], place: { A: { position: [0, 0, 57.5 - (30.35 * i) / n] as Vec3, rotation: [0, 0, 0] as Vec3 } }, conflicts: [] }));
  return { steps };
}

describe("plán videa: délka = délka studie / rychlost ± 1 snímek (bod 13)", () => {
  it("0,65 s studie při 1× = 0,65 s videa ± 1/30 s (dřív 2,926 s) – nezávisle na počtu kroků", () => {
    const p = videoPlan(0.65);
    expect(p.fps).toBe(30);
    expect(p.frames).toBe(20);
    expect(Math.abs(p.seconds - 0.65)).toBeLessThanOrEqual(1 / 30);
    expect(p.samples[0]).toBe(0);
    expect(p.samples[p.frames - 1]).toBe(0.65);
    // 112 i 12 kroků studie dají totéž video (čas videa nezávisí na počtu výpočetních kroků)
    expect(videoPlan(studySpan(study(112, 0.65)))).toEqual(videoPlan(studySpan(study(12, 0.65))));
    // starý vzorec (záznam v reálném čase, 113 × 1/30 s) by dal ≥ 3,77 s – mimo toleranci
    expect(Math.abs(113 / 30 - 0.65)).toBeGreaterThan(p.tol);
  });
  it("zpomalení 0,5× a 0,25×, vlastní rychlost, ruční délka, FPS", () => {
    expect(videoPlan(0.65, { speed: 0.5 }).seconds).toBeCloseTo(1.3, 6);
    const q = videoPlan(0.65, { speed: 0.25 });
    expect(q.frames).toBe(78);
    expect(q.seconds).toBeCloseTo(2.6, 6);
    expect(Math.abs(videoPlan(0.65, { speed: 0.3 }).seconds - 0.65 / 0.3)).toBeLessThanOrEqual(1 / 30);
    const m = videoPlan(0.65, { seconds: 5 });
    expect(m.manual).toBe(true);
    expect(m.seconds).toBe(5);
    expect(m.speed).toBeCloseTo(0.13, 6);
    const f = videoPlan(0.65, { fps: 60 });
    expect(f.frames).toBe(39);
    expect(f.seconds).toBeCloseTo(0.65, 6);
    // dlouhá studie s málo kroky: dřív FPS 5 a video ZRYCHLENÉ (10 s → 4,2 s); teď 10 s
    expect(videoPlan(studySpan(study(20, 10))).seconds).toBe(10);
  });
  it("hláška uvádí délku videa a poměr ke studii; strojový řádek", () => {
    const p = videoPlan(0.65);
    expect(planText(p)).toBe("video 0,667 s = 1,03 × délka studie 0,65 s · rychlost 1× · 30 fps · 20 snímků (tolerance ±1 snímek = ±0,033 s)");
    expect(planKv(p)).toBe("video seconds=0.667 study=0.65 fps=30 frames=20 speed=1 ratio=1.026");
    setLang("en");
    expect(planText(videoPlan(0.65, { speed: 0.25 }))).toContain("2.6");
    setLang("cs");
  });
  it("chybné zadání = chyba, ne tiché video", () => {
    expect(() => videoPlan(0)).toThrow(/délku/);
    expect(() => videoPlan(1, { speed: 0 })).toThrow(/rychlost/);
    expect(() => videoPlan(1, { fps: 0 })).toThrow(/FPS/);
    expect(() => videoPlan(1, { seconds: -1 })).toThrow(/délka/);
    expect(() => videoPlan(1000, { fps: 60 })).toThrow(String(VIDEO_MAX_FRAMES));
  });
  it("snímky PNG po krocích: jeden snímek na vypočtený krok, časy kroků", () => {
    const p = stepPlan(study(4, 2));
    expect(p.frames).toBe(5);
    expect(p.samples).toEqual([0, 0.5, 1, 1.5, 2]);
  });
  it("window.mncad.motion().video – plán z uložených voleb studie", () => {
    const api = videoApi(study(112, 0.65), { motors: [], duration: 0.65, steps: 112, video: { speed: 0.25 } });
    expect("seconds" in api && api.seconds).toBeCloseTo(2.6, 6);
    expect("error" in videoApi(null, undefined)).toBe(true);
  });
});

describe("poloha v čase studie: interpolace mezi kroky", () => {
  it("poloha lineárně, nejbližší krok, motory", () => {
    const r = study(4, 2);
    const p = poseAt(r, 0.25);
    expect(p.k).toBe(0);
    expect(p.alpha).toBeCloseTo(0.5, 9);
    expect(p.place.A.position[2]).toBeCloseTo(57.5 - 30.35 / 8, 9);
    expect(p.motors[0]).toBeCloseTo(57.5 - 30.35 / 8, 9);
    expect(poseAt(r, 2).place.A.position[2]).toBeCloseTo(27.15, 9);
    expect(poseAt(r, 5).step).toBe(4);
  });
  it("natočení po nejkratší cestě (170° → −170° přes 180°, ne přes 0°)", () => {
    const rz = slerpRotation([0, 0, 170], [0, 0, -170], 0.5);
    const m = rotMatrix(rz);
    // osa X otočená o 180° kolem Z míří na −X
    expect(m[0]).toBeCloseTo(-1, 6);
    expect(slerpRotation([0, 0, 10], [0, 0, 10], 0.5)).toEqual([0, 0, 10]);
  });
  it("snímky pohybující se studie ukazují různé polohy (každý snímek jiný otisk polohy)", () => {
    const r = study(112, 0.65);
    const p = videoPlan(0.65);
    const keys = p.samples.map((t) => poseKey(poseAt(r, t).place));
    expect(new Set(keys).size).toBe(p.frames);
  });
});

describe("kontrola obrazu: mrtvé plátno se pozná (bod 13, kritik 2a)", () => {
  const img = (v: number, w = 64, h = 36) => {
    const d = new Uint8ClampedArray(w * h * 4);
    for (let i = 0; i < w * h; i++) d.set([v, v, v, 255], i * 4);
    return d;
  };
  it("otisk: stejný obraz = stejný otisk, jiný obraz = změna", () => {
    expect(sigChanged(frameSig(img(100), 64, 36), frameSig(img(100), 64, 36))).toBe(false);
    expect(sigChanged(frameSig(img(100), 64, 36), frameSig(img(120), 64, 36))).toBe(true);
  });
  it("poloha se mění, obraz ne → dead (✗); obojí se mění → ok; nic se nemění → static", () => {
    const s0 = frameSig(img(100), 64, 36);
    const s1 = frameSig(img(140), 64, 36);
    const dead = checkFrames([{ pose: "a", sig: s0 }, { pose: "b", sig: s0 }, { pose: "c", sig: s0 }]);
    expect(dead.verdict).toBe("dead");
    expect(checkText(dead).startsWith("✗")).toBe(true);
    const ok = checkFrames([{ pose: "a", sig: s0 }, { pose: "b", sig: s1 }, { pose: "c", sig: s0 }]);
    expect(ok.verdict).toBe("ok");
    expect(ok.distinct).toBe(2);
    expect(checkFrames([{ pose: "a", sig: s0 }, { pose: "a", sig: s0 }]).verdict).toBe("static");
    const part = checkFrames([{ pose: "a", sig: s0 }, { pose: "b", sig: s1 }, { pose: "c", sig: s1 }]);
    expect(part.verdict).toBe("partial");
    expect(checkText(part).startsWith("⚠")).toBe(true);
  });
  it("víc pohledů: jeden pohled nehybný (pohyb ve směru pohledu), druhý se mění → ⚠ s názvem pohledu, video se uloží; všechny nehybné → ✗", () => {
    // repro e2e cad-w22-v bez WebGL: dlaždice „Shora“ při svislém zdvihu v pravoúhlém promítání → dřív „dead“ celého videa (nic se neuložilo)
    const s0 = frameSig(img(100), 64, 36);
    const s1 = frameSig(img(140), 64, 36);
    const moving = checkFrames([{ pose: "a", sig: s0 }, { pose: "b", sig: s1 }, { pose: "c", sig: s0 }]);
    const still = checkFrames([{ pose: "a", sig: s0 }, { pose: "b", sig: s0 }, { pose: "c", sig: s0 }]);
    const c = combineChecks([moving, still], ["Řez A", "Shora"]);
    expect(c.verdict).toBe("partial");
    expect(c.still).toEqual(["Shora"]);
    expect(checkText(c)).toMatch(/^⚠ v pohledu „Shora“ se obraz nezměnil/);
    expect(combineChecks([still, still], ["A", "B"]).verdict).toBe("dead");
    expect(checkText(combineChecks([still, still], ["A", "B"]))).toMatch(/^✗/);
    expect(combineChecks([moving, moving], ["A", "B"]).verdict).toBe("ok");
    expect(combineChecks([moving]).verdict).toBe("ok");
    expect(combineChecks([still]).verdict).toBe("dead");
  });
});
