/**
 * Kontrola tlačné pružiny v sestavě (cad/asm-spring-check.ts, recenze vlny 21) – ruční výpočty EN 13906-1:
 * - d 3 · De 19,5 · L0 41 · n 4, SH, F = 964,4 N: D = 16,5, w = 5,5, R = 81 500·81 / (8·16,5³·4) = 45,924 N/mm,
 *   τ = 8·964,4·16,5 / (π·3³) = 1 500,8 MPa, k = (5,5 + 0,5)/(5,5 − 0,75) = 1,26316, τk = 1 895,8 MPa,
 *   Rm(3) = 1 840 (EN 10270-1 SH) → τzul = 920 MPa → statická kontrola (jako výpočet pružiny z tabulky `@/cad/springs`,
 *   integrace vlny 21: τ bez korekce) 1 500,8 / 920 = 163 %, τk 206 %;
 * - 2 × 19,5 × 41, n 7,5 na 20 mm: Ln = 9,5·2 = 19, Sa = (0,0015·17,5²/2 + 0,1·2)·7,5 = 3,2227 → Ln + Sa = 22,223 > 20 → ⚠ dotyk;
 * - d 3 · De 19,5 · L0 17 · n 4: Ln = 6·3 = 18 > L0 → ✗ i bez vzdálenosti ploch;
 * - vzpěr: d 1 · De 10 · L0 150 · n 40 (D 9, L0/D 16,7), ν = 0,5, G/E = 81 500/206 000 = 0,39563:
 *   sK = 150·0,5/(1 − 0,39563)·[1 − √(1 − 0,60437/0,89563·(π·9/75)²)] = 124,096·[1 − √(1 − 0,67480·0,14212)] = 124,096·0,049159
 *   = 6,10 mm;
 * - kolík 0,8 × 7 × 30, n 11 (návod, příklad 2): R = 1,5917 N/mm, Ln 10,4, Sa = (0,0015·6,2²/0,8 + 0,08)·11 = 1,6728 → Ln + Sa = 12,0728, při 14 mm τk 80 %, na dorazu 98 % → bez ⚠.
 */
import { describe, expect, it } from "vitest";
import { parseAsmText, type AsmCmd } from "./agent-asm";
import { springHelpLines, springLite } from "./asm-spring-between";
import { springCheck, springMotionCheck, springRateOf, springWireOf, wireOfSpec } from "./asm-spring-check";
import { calcCompression, rmOf, springMaterial } from "./springs";
import { springMotionLines } from "./asm-spring";
import { parseDecimal } from "@/components/cad/springs/decimal-input";
import { emptyDoc, type AsmComponent, type CadDoc } from "./types";

describe("EN 13906-1: pevnost, nejmenší mezery, vzpěr", () => {
  it("přetížená pružina d 3 · De 19,5 · L0 41 · n 4 při 964,4 N: τ 1 501 MPa = 163 % τzul 920 (τk 1 896 MPa = 206 %)", () => {
    const w = wireOfSpec({ d: 3, De: 19.5, L0: 41, n: 4, material: "SH" });
    expect(w).toMatchObject({ D: 16.5, nt: 6, Ln: 18 });
    expect(rmOf(springMaterial("SH"), 3)).toBe(1840);
    const c = springCheck(w, { F: 964.4 });
    expect(c.R).toBeCloseTo(45.924, 3);
    expect(c.k).toBeCloseTo(1.26316, 5);
    expect(c.tau(964.4)).toBeCloseTo(1500.8, 0);
    expect(c.tauk(964.4)).toBeCloseTo(1895.8, 0);
    expect(c.tauzul).toBe(920);
    // statická kontrola EN 13906-1 napětím bez korekce (stejně jako tabulka pružiny), τk = k·τ jen jako přísnější rada
    expect(c.issues.map((x) => x.text).join("\n")).toMatch(/napětí 163 % dovoleného při síle 964,4 N \(τ = 1501 MPa, τzul = 0,5·Rm = 920 MPa, statická kontrola EN 13906-1\)/);
    // staticky vyhoví, s korekcí ne: d 3 · n 4 při 520 N → τ = 1,55618·520 = 809 MPa (88 %), τk = 1,26316·809 = 1 022 MPa (111 %)
    const mid = springCheck(w, { F: 520 });
    expect(mid.issues.map((x) => x.text).join("\n")).toMatch(/napětí s korekcí k 111 % dovoleného při síle 520 N \(τk = 1022 MPa\) – staticky vyhoví \(τ 88 %\)/);
  });

  it("tabulka „Pružina mezi díly“ (springLite): ⚠ napětí na dorazu, dotyk závitů, ✗ L0 ≤ Ln i bez vzdálenosti ploch", () => {
    // stejná pružina v montáži 35 mm: τk při montáži 59 %, na dorazu Ln 18 mm τn 179 % (τkn 226 %)
    const a = springLite({ d: 3, De: 19.5, L0: 41, n: 4, material: "SH" }, 35, true);
    expect(a.bad).toBe(false);
    expect(a.taukSeat! / a.tauzul).toBeCloseTo(0.589, 2);
    expect(a.tauSeat! / a.tauzul).toBeCloseTo(0.589 / 1.26316, 2);
    expect(a.taukLn / a.tauzul).toBeCloseTo(2.26, 2);
    expect(a.tauLn / a.tauzul).toBeCloseTo(2.26 / 1.26316, 2);
    expect(a.issues.join("\n")).toMatch(/na doraz Ln by napětí bylo 179 % dovoleného \(τn = 1644 MPa\)/);
    // střižníková 2 × 19,5 × 41, n 7,5 v montáži 20 mm: Ln + Sa = 22,22 mm
    const b = springLite({ d: 2, De: 19.5, L0: 41, n: 7.5 }, 20, true);
    expect(b.Sa).toBeCloseTo(3.2227, 4);
    expect(b.Lmin).toBeCloseTo(22.2227, 4);
    expect(b.issues.join("\n")).toMatch(/pracovní délka 20 mm je pod nejmenší přípustnou Ln \+ Sa = 22,22 mm .* závity se dotýkají/);
    // L0 17 < Ln 18 bez vzdálenosti ploch = ✗ (dřív žádná hláška)
    const c = springLite({ d: 3, De: 19.5, L0: 17, n: 4 });
    expect(c.bad).toBe(true);
    expect(c.issues.join("\n")).toMatch(/volná délka L0 17 mm není větší než délka na doraz Ln 18 mm/);
    // výchozí pružina DIN 2095 2 × 20 × 44, n 8 v montáži 38 mm: bez hlášek (beze změny)
    expect(springLite({ d: 2, De: 20, L0: 44, n: 8 }, 38).issues).toEqual([]);
  });

  it("vzpěr: štíhlá pružina nevedená ⚠, v díře vedená bez hlášky, krátká nevybočí", () => {
    const w = wireOfSpec({ d: 1, De: 10, L0: 150, n: 40 });
    const free = springCheck(w, { L: 120, guided: false });
    expect(free.sK).toBeCloseTo(6.1, 2);
    expect(free.issues.map((x) => x.text).join("\n")).toMatch(/pružina se vybočí – zdvih 30 mm je větší než kritický sK = 6,1 mm/);
    expect(springCheck(w, { L: 120, guided: true }).issues.some((x) => /vybočí/.test(x.text))).toBe(false);
    expect(springCheck(w, { L: 120 }).issues.map((x) => x.text).join("\n")).toMatch(/může vybočit .* není-li vedená/);
    expect(springCheck(wireOfSpec({ d: 2, De: 19.5, L0: 41, n: 7.5 }), { L: 25 }).sK).toBe(Infinity);
  });

  it("kolík z návodu (0,8 × 7 × 30, n 11) v montáži 14 mm: R 1,592 N/mm, Ln + Sa 12,07, τk 80 % / 98 % (τ 68 % / 83 %) → bez hlášek", () => {
    const c = springLite({ d: 0.8, De: 7, L0: 30, n: 11 }, 14, false);
    expect(c.R).toBeCloseTo(1.5917, 4);
    expect(c.Ln).toBeCloseTo(10.4, 9);
    expect(c.Lmin).toBeCloseTo(12.0728, 4);
    expect(c.taukSeat! / c.tauzul).toBeCloseTo(0.8, 2);
    expect(c.taukLn / c.tauzul).toBeCloseTo(0.98, 2);
    expect(c.issues).toEqual([]);
    // původní příklad (0,8 × 7 × 20, n 6 v montáži 4 mm) je pod Ln 6,4 mm
    expect(springLite({ d: 0.8, De: 7, L0: 20, n: 6 }, 4).issues.join("\n")).toMatch(/pod délkou na doraz Ln 6,4 mm/);
  });
});

const springPart = (feature: CadDoc["features"][number]): CadDoc => ({ ...emptyDoc("P"), features: [feature] });

describe("drát pružiny z dílu a kontrola v souhrnu pohybové studie", () => {
  it("prvek Pružina (r 8, drát 2, 8 závitů) i tabulková spring.compression; trubka není drátová pružina", () => {
    const sp = springPart({ id: "s", name: "Pružina", type: "spring", radius: 8, pitch: 5, turns: 8, wire: 2, position: [0, 0, 1], axis: "Z", mode: "new" });
    expect(springWireOf(sp)).toMatchObject({ d: 2, D: 16, n: 8, ends: "open", Ln: 18, L0: 42, material: "SH" });
    expect(springRateOf(sp)).toBeCloseTo((81500 * 16) / (8 * 4096 * 8), 9);
    const tab = springPart({ id: "t", name: "Tlačná", type: "ext", ext: "spring.compression", data: { d: 2, De: "19,5", L0: 41, n: 7.5, ends: "ground", material: "1.4310", at: [0, 0, 0], axis: "Z" } } as CadDoc["features"][number]);
    expect(springWireOf(tab)).toMatchObject({ d: 2, D: 17.5, n: 7.5, nt: 9.5, Ln: 19, material: "1.4310" });
    expect(springWireOf(springPart({ id: "u", name: "Trubka", type: "tube", outer: 20, inner: 10, height: 42, position: [0, 0, 0], axis: "Z", mode: "new" } as CadDoc["features"][number]))).toBeNull();
  });

  it("souhrn pružin pohybu: ⚠ dotyk závitů a přetížení při nejkratší délce (dřív ✓)", () => {
    const part = springPart({ id: "t", name: "Tlačná", type: "ext", ext: "spring.compression", data: { d: 3, De: 19.5, L0: 41, n: 4, ends: "ground", material: "SH", at: [0, 0, 0], axis: "Z" } } as CadDoc["features"][number]);
    const c: AsmComponent = { id: "P", name: "P", source: { kind: "part", doc: part }, placement: { position: [0, 0, 0], rotation: [0, 0, 0] }, spring: { a: { compId: "A", face: 0 }, b: { compId: "B", face: 0 }, free: 41, rate: 45.924, solid: 18 } };
    const chk = springMotionCheck(c, 20)!;
    // F = 45,924·21 = 964,4 N → 206 %; Ln + Sa = 18 + (0,0015·16,5²/3 + 0,3)·4 = 19,74 < 20 → bez dotyku
    expect(chk.issues.map((x) => x.text).join("\n")).toMatch(/napětí 163 % dovoleného/);
    const doc: CadDoc = { ...emptyDoc("S"), kind: "assembly", components: [{ ...c }, { id: "A", name: "A", source: { kind: "part", doc: emptyDoc("A") }, placement: { position: [0, 0, 0], rotation: [0, 0, 0] } }, { id: "B", name: "B", source: { kind: "part", doc: emptyDoc("B") }, placement: { position: [0, 0, 0], rotation: [0, 0, 0] } }] };
    const st = (i: number, L: number) => ({ i, t: i * 0.1, springs: { P: { length: L, offset: 0, seat: L, force: 45.924 * (41 - L), level: "ok" as const } } });
    const lines = springMotionLines(doc, [st(0, 35), st(1, 20), st(2, 35)]);
    expect(lines[0]).toMatch(/^⚠ pružina „P“: délka 35 mm \(min 20 · L0 41 · Ln 18\) .* – napětí 163 % dovoleného/);
    // vedená pružina (Pružina mezi díly v díře – SpringDef.guided): vzpěr se nehlásí; nevedená štíhlá ⚠ „vybočí“
    const slim = springPart({ id: "s", name: "Štíhlá", type: "ext", ext: "spring.compression", data: { d: 1, De: 10, L0: 150, n: 40, ends: "ground", material: "SH", at: [0, 0, 0], axis: "Z" } } as CadDoc["features"][number]);
    const cs: AsmComponent = { ...c, source: { kind: "part", doc: slim }, spring: { a: c.spring!.a, b: c.spring!.b, free: 150 } };
    expect(springMotionCheck(cs, 120)!.issues.map((x) => x.text).join("\n")).toMatch(/může vybočit .* není-li vedená/);
    expect(springMotionCheck({ ...cs, spring: { ...cs.spring!, guided: true } }, 120)!.issues.some((x) => /vybočit|vybočí/.test(x.text))).toBe(false);
    expect(springMotionCheck({ ...cs, spring: { ...cs.spring!, guided: false } }, 120)!.issues.map((x) => x.text).join("\n")).toMatch(/pružina se vybočí/);
    // v pořádku: ✓ beze změny
    expect(springMotionLines(doc, [st(0, 35), st(1, 33)])[0]).toMatch(/^✓ pružina „P“/);
    // ručně zadaná tuhost mimo ±10 % geometrie (díl = náhradní tvar jiné pružiny, jako normálie v testech vlny 15): bez kontroly drátu
    expect(springMotionCheck({ ...c, spring: { ...c.spring!, rate: 25 } }, 20)).toBeNull();
    expect(springMotionCheck({ ...c, spring: { ...c.spring!, rate: 48 } }, 20)).not.toBeNull();
  });

  it("vzpěr s uložením ν z tabulky pružiny (recenze integrace vlny 21): d 2 · De 14 · L0 90 · n 15, ν 1 → sK 4,55 mm jako tabulka", () => {
    // ruční výpočet EN 13906-1, G/E = 81 500 / 206 000 = 0,39563, D = 12: ν 1 → (π·12 / 90)² = 0,17546,
    //   sK = 90·0,5/0,60437·[1 − √(1 − 0,67480·0,17546)] = 74,458·0,061055 = 4,546 mm; ν 0,5 → (π·12 / 45)² = 0,70184,
    //   sK = 74,458·[1 − √(1 − 0,47360)] = 74,458·0,27447 = 20,436 mm (dřív vždy ν 0,5 – zdvih 15 mm v pohybu prošel ✓)
    const data = { d: 2, De: 14, L0: 90, n: 15, ends: "ground", material: "SH", nu: "1", at: [0, 0, 0], axis: "Z" };
    const part = springPart({ id: "t", name: "Pružina nu1", type: "ext", ext: "spring.compression", data } as CadDoc["features"][number]);
    const table = calcCompression(data).v.sK!;
    expect(table).toBeCloseTo(4.546, 2);
    expect(springWireOf(part)).toMatchObject({ nu: 1 });
    const c: AsmComponent = { id: "P", name: "Pružina nu1", source: { kind: "part", doc: part }, placement: { position: [0, 0, 0], rotation: [0, 0, 0] }, spring: { a: { compId: "A", face: 0 }, b: { compId: "B", face: 0 }, free: 90 } };
    const chk = springMotionCheck(c, 75)!;
    expect(chk.sK).toBeCloseTo(table, 9);
    expect(chk.issues.map((x) => x.text).join("\n")).toMatch(/může vybočit – zdvih 15 mm je větší než kritický sK = 4,55 mm/);
    // výchozí uložení 0,5 (tabulka bez `uložení`, Pružina mezi díly, prvek Pružina) beze změny: sK 20,44 mm → 15 mm nevybočí
    const half = springPart({ id: "t", name: "Pružina", type: "ext", ext: "spring.compression", data: { ...data, nu: undefined } } as CadDoc["features"][number]);
    const c5 = springMotionCheck({ ...c, source: { kind: "part", doc: half } }, 75)!;
    expect(c5.sK).toBeCloseTo(20.436, 2);
    expect(c5.issues.some((x) => /vybočit|vybočí/.test(x.text))).toBe(false);
    expect(wireOfSpec({ d: 2, De: 14, L0: 90, n: 15 }).nu).toBe(0.5);
  });
});

describe("text a pole tabulky", () => {
  it("sestava pružina nápověda (CS / EN / DE) = přehled; komponenta „nápověda“ v uvozovkách zůstává komponentou", () => {
    for (const line of ["sestava pružina nápověda", "assembly spring help", "baugruppe feder hilfe", "sestava pružina ?"]) expect(parseAsmText("assembly", line)).toEqual({ k: "spring", comp: "", help: true });
    expect((parseAsmText("assembly", 'sestava pružina "nápověda" mezi "A" "B"') as Extract<AsmCmd, { k: "spring" }>).comp).toBe("nápověda");
    const help = springHelpLines().join("\n");
    expect(help).toMatch(/sestava pružina nová/);
    expect(help).toMatch(/do děr vzoru/);
    expect(help).toMatch(/Ln \+ Sa/);
  });

  it("desetinná čárka i tečka; rozepsané číslo („1,“, „0“) se nepřepíše na jinou hodnotu", () => {
    expect(parseDecimal("1,8")).toBe(1.8);
    expect(parseDecimal("1.8")).toBe(1.8);
    expect(parseDecimal("19,5")).toBe(19.5);
    expect(parseDecimal("0,5")).toBe(0.5);
    expect(parseDecimal("1,")).toBe(1);
    expect(parseDecimal(",5")).toBe(0.5);
    expect(parseDecimal("-2,5")).toBe(-2.5);
    expect(parseDecimal("")).toBeNull();
    expect(parseDecimal("1,8,")).toBeNull();
    expect(parseDecimal("abc")).toBeNull();
  });
});
