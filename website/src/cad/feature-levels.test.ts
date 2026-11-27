/**
 * Úrovně stavu prvku (vlna 22): účinek proti nástroji, očekávaný typ výsledku, stav „nezkontrolováno“, texty a strojová data.
 * Čistý modul – bez jádra (jádro: w22/levels-kernel.test.ts, protokol: w22/status-run.test.ts).
 */
import { afterEach, describe, expect, it } from "vitest";
import { setLang } from "./i18n";
import { bodyText, effectOf, effectText, expectsSolid, featureCounts, featureState, geometryText, levelsData, levelsText, resultTypeError, settleBodyChecks, treeStatus, type BodyCheck } from "./feature-levels";
import type { FeatureStatus } from "./types";

afterEach(() => setLang("cs"));
const valid: BodyCheck = { solids: 1, free: 0, faces: 6, valid: true };

describe("úroveň „účinek“ – změna objemu proti objemu nástroje", () => {
  it("none / partial / full / changed", () => {
    expect(effectOf("cut", 0, 500, 50_000).level).toBe("none");
    expect(effectOf("cut", -0.2, 500, 50_000).level).toBe("none"); // pod tisícinu nástroje
    expect(effectOf("cut", -350, 500, 50_000).level).toBe("partial");
    expect(effectOf("cut", -500, 500, 50_000).level).toBe("full");
    expect(effectOf("add", 499.9, 500, 50_000).level).toBe("full");
    expect(effectOf("modify", -3.4, undefined, 50_000).level).toBe("changed"); // zaoblení – bez nástroje
    expect(effectOf("modify", 0, undefined, 50_000).level).toBe("none");
  });
  it("text účinku nese čísla (cs čárka, en tečka)", () => {
    expect(effectText(effectOf("cut", -352.13, 354.04, 9912))).toBe("úběr 352,1 mm³ (>99 % nástroje)");
    expect(effectText(effectOf("cut", -125.66, 1005.3, 4000))).toBe("úběr 125,7 mm³ (12 % nástroje)");
    expect(effectText(effectOf("add", 2000, 2000, 4000))).toBe("přidáno 2000 mm³ (celý nástroj)");
    expect(effectText(effectOf("new", 4000, undefined, 0))).toBe("přidáno 4000 mm³");
    expect(effectText(effectOf("cut", 0, 500, 4000))).toBe("objem beze změny");
    setLang("en");
    expect(effectText(effectOf("cut", -8.58, undefined, 4000))).toBe("removed 8.58 mm³");
  });
});

describe("očekávaný typ výsledku – prvek objemového typu musí dát objemové těleso", () => {
  const solid = { solids: 1, free: 0, faces: 6 };
  it("plášť místo tělesa = chyba prvku (i jako první prvek, i u velkého tělesa)", () => {
    expect(resultTypeError({ type: "sweep" }, null, { solids: 0, free: 6, faces: 6 })).toMatch(/má dát objemové těleso, ale výsledek je jen plocha \/ plášť \(6 volných ploch/);
    expect(resultTypeError({ type: "hole" }, solid, { solids: 0, free: 900, faces: 900 })).toMatch(/jen plocha/);
    expect(resultTypeError({ type: "ext", data: { mode: "cut" } }, solid, { solids: 0, free: 5, faces: 5 })).not.toBeNull();
  });
  it("těleso + nové volné plochy = chyba prvku; volné plochy, které už v modelu byly, se prvku nepřičítají", () => {
    expect(resultTypeError({ type: "extrude" }, solid, { solids: 1, free: 2, faces: 8 })).toMatch(/zůstaly volné plochy \(2 navíc\)/);
    expect(resultTypeError({ type: "extrude" }, { solids: 1, free: 2, faces: 8 }, { solids: 1, free: 2, faces: 14 })).toBeNull();
  });
  it("prvky ploch, import, smazání plochy, kosmetický závit a úprava plošného modelu těleso dát nemusí", () => {
    const shell = { solids: 0, free: 6, faces: 6 };
    expect(expectsSolid({ type: "ext", data: {} }, null)).toBe(false); // surf.* bez operace
    expect(resultTypeError({ type: "ext", data: { sketchId: "s" } }, null, shell)).toBeNull();
    expect(resultTypeError({ type: "import" }, null, shell)).toBeNull();
    expect(resultTypeError({ type: "deleteFace" }, solid, { solids: 0, free: 5, faces: 5 })).toBeNull();
    expect(expectsSolid({ type: "thread", modeled: false }, solid)).toBe(false);
    expect(resultTypeError({ type: "mirror" }, shell, { solids: 0, free: 12, faces: 12 })).toBeNull();
    expect(resultTypeError({ type: "box" }, solid, solid)).toBeNull();
  });
  it("prvek rozšíření: objemový je s booleovskou operací, nebo mimo kartu Plochy (plech, svařence, pružiny, pokročilé)", () => {
    const shell = { solids: 0, free: 6, faces: 6 };
    // karta Plochy bez operace: plocha je správný výsledek
    expect(expectsSolid({ type: "ext", data: {}, solidExt: false }, null)).toBe(false);
    // plech / svařenec / pokročilý prvek bez pole `mode`: těleso se čeká – i jako první prvek dílu
    expect(expectsSolid({ type: "ext", data: {}, solidExt: true }, null)).toBe(true);
    expect(resultTypeError({ type: "ext", data: { thickness: 2 }, solidExt: true }, null, shell)).toMatch(/jen plocha \/ plášť/);
    expect(resultTypeError({ type: "ext", data: {}, solidExt: true }, solid, { solids: 1, free: 3, faces: 9 })).toMatch(/volné plochy \(3 navíc\)/);
    // … ale úprava čistě plošného modelu (zaoblení hran pláště) těleso dát nemusí
    expect(resultTypeError({ type: "ext", data: {}, solidExt: true }, shell, shell)).toBeNull();
    // s operací se těleso čeká vždy (i na kartě Plochy: zesílení, uzavření do tělesa, závit šroubovicí)
    expect(resultTypeError({ type: "ext", data: { mode: "add" }, solidExt: false }, shell, shell)).toMatch(/jen plocha/);
  });
});

describe("počty prvků pro souhrn dokumentu (řádek D)", () => {
  it("prvek bez kontroly platnosti není mezi ✓ – má vlastní počet unchecked", () => {
    const ok = { ok: true, body: valid };
    const un = { ok: true, body: { ...valid, valid: null, why: "approx" as const } };
    expect(featureCounts([ok, { ok: true, warning: "w" }, { ok: false }])).toEqual({ ok: 1, warn: 1, error: 1 });
    expect(featureCounts([ok, un, un])).toEqual({ ok: 1, warn: 0, error: 0, unchecked: 2 });
  });
  it("potlačený prvek (nestavěl se) není mezi ✓ – má vlastní počet off", () => {
    expect(featureCounts([{ ok: true, body: valid }, { ok: true, suppressed: true }])).toEqual({ ok: 1, warn: 0, error: 0, off: 1 });
  });
});

describe("úroveň „konečné těleso“ – neprovedená kontrola nikdy není ✓", () => {
  const st = (o: Partial<FeatureStatus>): FeatureStatus => ({ id: "a", ok: true, ...o });
  it("stav prvku: ✗ / ⚠ / ℹ nezkontrolováno / ✓", () => {
    expect(featureState(st({ ok: false, error: "x" }))).toBe("error");
    expect(featureState(st({ warning: "w", body: valid }))).toBe("warn");
    expect(featureState(st({ body: { ...valid, faces: 468, valid: null, why: "feature-faces" } }))).toBe("unchecked");
    expect(featureState(st({ body: valid }))).toBe("ok");
    expect(featureState(st({}))).toBe("ok"); // skica, pomocná rovina – bez tělesa
    // potlačený prvek (přímo nebo konfigurací) se nestavěl – ℹ „potlačen“, nikdy ✓
    expect(featureState(st({ suppressed: true }))).toBe("off");
    expect(levelsText(st({ suppressed: true }))).toBe("potlačen – nestaví se");
    expect(levelsData(st({ suppressed: true }))).toEqual({ built: false, suppressed: true });
    expect(featureState(undefined)).toBeUndefined();
  });
  it("texty: platné / nezkontrolováno s důvodem a čísly / neplatné / bez tělesa / volné plochy", () => {
    expect(bodyText(valid)).toBe("těleso platné");
    expect(bodyText({ ...valid, solids: 2 })).toBe("2 těles, platná");
    expect(bodyText({ ...valid, faces: 468, valid: null, why: "feature-faces" })).toBe("těleso nezkontrolováno (468 ploch > 400 – platnost se ověří na konci stavby)");
    expect(bodyText({ ...valid, faces: 2040, valid: null, why: "final-faces" })).toBe("těleso nezkontrolováno (2040 ploch > 2000)");
    expect(bodyText({ ...valid, valid: false })).toBe("těleso NEPLATNÉ");
    expect(bodyText({ solids: 0, free: 6, faces: 6, valid: true })).toBe("žádné objemové těleso");
    expect(bodyText({ solids: 1, free: 2, faces: 8, valid: true })).toBe("těleso platné + 2 volných ploch");
    expect(levelsText(st({ effect: effectOf("cut", -100, 400, 4000), body: valid }))).toBe("úběr 100 mm³ (25 % nástroje) · těleso platné");
    expect(levelsText(st({ ok: false, error: "x" }))).toBe("");
  });
  it("strojová data (JSON entries[].data.levels): built / effect / body, nezkontrolováno jako „unchecked“", () => {
    expect(levelsData(st({ ok: false }))).toEqual({ built: false });
    expect(levelsData(st({ effect: effectOf("cut", -100, 400, 4000), body: { ...valid, valid: null, why: "final-faces" } }))).toEqual({ built: true, effect: { op: "cut", level: "partial", dV_mm3: -100, tool_mm3: 400 }, body: { solids: 1, free: 0, valid: "unchecked", why: "final-faces" } });
  });
  it("závěrečná kontrola doplní prvky bez kontroly: platné → ✓, neprovedená → zůstává nezkontrolováno, neplatné → od původce dál", () => {
    const pend: BodyCheck = { solids: 1, free: 0, faces: 468, valid: null, why: "feature-faces" };
    const list = [st({ id: "a", body: valid }), st({ id: "b", body: pend }), st({ id: "c", body: pend, warning: "Výsledek má neplatnou geometrii – …" }), st({ id: "d", body: pend })];
    expect(settleBodyChecks(list, { valid: true, faces: 470 }).map((s) => s.body?.valid)).toEqual([true, true, true, true]);
    const skipped = settleBodyChecks(list, { valid: undefined, faces: 2040 });
    expect(skipped.map((s) => s.body?.valid)).toEqual([true, null, null, null]);
    expect(skipped[1].body).toMatchObject({ why: "final-faces", faces: 2040 });
    expect(settleBodyChecks(list, { valid: undefined, faces: 1020, approx: true })[1].body).toMatchObject({ valid: null, why: "approx", faces: 1020 });
    expect(featureState(skipped[1])).toBe("unchecked");
    expect(settleBodyChecks(list, { valid: false, faces: 470 }, "Výsledek má neplatnou geometrii").map((s) => s.body?.valid)).toEqual([true, true, false, false]);
    expect(list[1].body?.valid).toBeNull(); // uložené stavy stavby se nemění
  });
  it("řádek Geometrie: neprovedená kontrola je „nezkontrolováno“, ne „platná“", () => {
    // vlna 22 (G2, 22a): řádek říká, která kontrola proběhla – rychlá po stavbě, nebo přesná (kontrola přesně / export)
    expect(geometryText({ valid: true, solids: 1, faces: 6 })).toBe("platná · 1 těleso · rychlá kontrola");
    expect(geometryText({ valid: true, solids: 1, faces: 6, validCheck: "exact" })).toBe("platná · 1 těleso · přesná kontrola");
    expect(geometryText({ valid: undefined, solids: 340, faces: 2040 })).toBe("nezkontrolováno (2040 ploch > 2000) · 340 těles");
    expect(geometryText({ valid: undefined, solids: 1, faces: 90_000, approx: true })).toBe("nezkontrolováno (velké těleso, 90000 ploch – měřeno ze sítě, platnost se nekontroluje) · 1 těleso");
    expect(geometryText({ valid: false, solids: 1, faces: 6 })).toMatch(/^NEPLATNÁ/);
    expect(geometryText({ valid: true, solids: 0, faces: 6 })).toMatch(/^ŽÁDNÉ objemové těleso/);
  });
});

describe("strom historie při úpravě prvku se stavbou po něj (rollback) – úrovně aktivního prvku jen z platné celé stavby", () => {
  const st = (id: string, ok = true) => ({ id, ok });
  const view = [st("a"), st("b")]; // stavba po upravovaný prvek „c“
  const full = { geo: "G1", status: [st("a"), st("b"), st("c"), st("d", false)] };
  it("doplní upravovaný a další prvky z celé stavby téže geometrie", () => {
    expect(treeStatus(view, full, "G1", true)?.map((s) => s.id)).toEqual(["a", "b", "c", "d"]);
    expect(treeStatus(view, full, "G1", true)?.find((s) => s.id === "d")?.ok).toBe(false);
  });
  it("po změně geometrie (parametr upravovaného prvku) celá stavba neplatí – nic se nedoplní", () => {
    expect(treeStatus(view, full, "G2", true)?.map((s) => s.id)).toEqual(["a", "b"]);
  });
  it("bez rollbacku / bez celé stavby / bez výsledku beze změny", () => {
    expect(treeStatus(view, full, "G1", false)?.map((s) => s.id)).toEqual(["a", "b"]);
    expect(treeStatus(view, null, "G1", true)?.map((s) => s.id)).toEqual(["a", "b"]);
    expect(treeStatus(undefined, full, "G1", true)).toBeUndefined();
  });
});
