import { describe, it, expect } from "vitest";
import {
  cleanMailText, isNoiseOnly, extractInstructions, itemPatchFor, targetItems, normalizeAiInstruction,
  itemHintsFromMail, drawingNumberFromFilename, drawingFileKey, overrideBadgeText,
  oldValueMatches, insteadText, changeHolds, mailNoteLine, noteWithoutLine, sameMaterial,
} from "./job-instructions";
import { mergeSpecPatch } from "@/lib/jobs/drawing-spec";

const REPLY = [
  "Dobrý den,",
  "",
  "nabídku akceptujeme, prosím kalit, a 30 ks místo 20.",
  "",
  "S pozdravem",
  "Jan Dvořák",
  "Strojmetal s.r.o.",
  "",
  "Dne 28. 10. 2026 v 10:12 Adam Obchodník <adam@mnastrojarna.test> napsal(a):",
  "> Dobrý den, posíláme nabídku NAB-2026-031 na 20 ks hřídelí H-200 bez povrchové úpravy.",
  "> Materiál 11 523.",
].join("\n");

describe("čištění textu (šum pryč)", () => {
  it("bez citace, podpisu a hlavičky přeposlání", () => {
    const c = cleanMailText(REPLY);
    expect(c).toContain("prosím kalit");
    expect(c).not.toContain("NAB-2026-031");
    expect(c).not.toContain("Strojmetal");
    expect(cleanMailText("Ahoj\nFrom: Jan <j@x.cz>\nSent: Monday\nTo: me\nSubject: x\n\nmateriál 1.4301")).toBe("Ahoj");
    expect(cleanMailText("ok\n-----Original Message-----\nmateriál 1.4301")).toBe("ok");
    expect(cleanMailText("Zinkovat prosím.\n-- \nJan")).toBe("Zinkovat prosím.");
  });
  it("poděkování / potvrzení = šum", () => {
    expect(isNoiseOnly("Dobrý den, děkuji, v pořádku.")).toBe(true);
    expect(isNoiseOnly("OK, díky")).toBe(true);
    expect(isNoiseOnly("Děkujeme za zaslání, potvrzujeme přijetí.")).toBe(true);
    expect(isNoiseOnly("prosím kalit")).toBe(false);
    expect(extractInstructions("Děkuji, v pořádku.\n\nS pozdravem Jan\n> materiál 1.4301 zinkovat")).toEqual([]);
  });
});

describe("pokyny z e-mailu (pravidla)", () => {
  it("„prosím kalit, a 30 ks místo 20“ → tepelné zpracování + počet", () => {
    const list = extractInstructions(REPLY);
    expect(list.map((i) => i.field).sort()).toEqual(["heat", "quantity"]);
    const q = list.find((i) => i.field === "quantity")!;
    expect(q).toMatchObject({ quantity: 30, quantityFrom: 20, summary: "Počet kusů: 30 ks (místo 20 ks)" });
    const h = list.find((i) => i.field === "heat")!;
    expect(h.heat).toMatchObject({ status: "uvedeno", kind: "kaleni", label: "kalení" });
    expect(h.summary).toBe("Tepelné zpracování: kalení");
  });
  it("zápory a povrch, materiál, tvrdost, revize, termín, storno", () => {
    const f = (t: string) => extractInstructions(t, { drawingNumbers: ["H-200", "P-20"] });
    expect(f("Díl H-200 bez povrchové úpravy.")[0]).toMatchObject({ field: "surface", surface: { status: "bez" }, drawingNumber: "H-200" });
    expect(f("Prosím nekalit, stačí surový.")[0]).toMatchObject({ field: "heat", heat: { status: "bez" } });
    expect(f("Bez kalení.")[0]).toMatchObject({ field: "heat", heat: { status: "bez" } });
    expect(f("Materiál 1.4301 prosím.")[0]).toMatchObject({ field: "material", material: "1.4301" });
    expect(f("Místo 11523 použijte 1.0577.")[0]).toMatchObject({ field: "material", material: "1.0577", oldValue: "11523" });
    expect(f("Kalit na 58-60 HRC.")[0]).toMatchObject({ field: "heat", heat: { kind: "kaleni", hardness: "58-60 HRC" } });
    expect(f("Pozinkovat galvanicky.")[0]).toMatchObject({ field: "surface", surface: { kind: "galvanicky_zinek" } });
    expect(f("Černit prosím.")[0]).toMatchObject({ field: "surface", surface: { kind: "cerneni" } });
    expect(f("Platí nová revize C výkresu P-20.")[0]).toMatchObject({ field: "revision", revision: "C", drawingNumber: "P-20" });
    expect(f("Termín dodání do 15. 11. 2026 prosím.", )[0]).toMatchObject({ field: "deadline", value: "15. 11. 2026" });
    expect(f("Objednávku stornujeme.")[0]).toMatchObject({ field: "cancel" });
    expect(f("Prosím zrušit kalení.")[0]).toMatchObject({ field: "heat", heat: { status: "bez" } });
    expect(f("Navýšit počet na 50 ks.")[0]).toMatchObject({ field: "quantity", quantity: 50 });
    expect(f("Dodací adresa: Hala 3, Brno.")[0]).toMatchObject({ field: "address" });
    expect(f("Balení na paletu po 10 ks.").map((i) => i.field)).toContain("packaging");
    expect(f("Označit číslem dílu laserem.")[0]).toMatchObject({ field: "marking" });
    expect(f("Prosím tolerance průměru 20 h7.")[0]).toMatchObject({ field: "tolerance" });
    expect(f("Průměr 20 má být ø20 ±0,05 mm.").map((i) => i.field)).toContain("tolerance");
    expect(f("Prosím zkrátit délku na 120 mm.")[0]).toMatchObject({ field: "dimension" });
    expect(f("Splatnost faktury 30 dní.")[0]).toMatchObject({ field: "terms" });
  });
  it("čísla uvnitř materiálu a data nejsou počet kusů (review #1)", () => {
    const m = extractInstructions("Prosím materiál 1.4301 místo 1.4305.");
    expect(m.map((i) => i.field)).toEqual(["material"]);
    expect(m[0]).toMatchObject({ material: "1.4301", oldValue: "1.4305", summary: "Materiál: 1.4301 (místo 1.4305)" });
    const d = extractInstructions("Termín dodání 15.11 místo 10.11", { now: new Date("2026-10-29T10:00:00Z") });
    expect(d.map((i) => i.field)).toEqual(["deadline"]);
    expect(d[0].value).toBe("15. 11. 2026");
    expect(extractInstructions("Prosím materiál 1.4301 místo 1.4305 a prosím kalit.").map((i) => i.field).sort()).toEqual(["heat", "material"]);
    expect(extractInstructions("Dodejte 5 místo 3, děkuji.").some((i) => i.field === "quantity")).toBe(false); // „místo" bez kusů
    expect(extractInstructions("Počet 5 místo 3 prosím.")[0]).toMatchObject({ field: "quantity", quantity: 5, quantityFrom: 3 });
    expect(extractInstructions("Objednávka 1/2026 místo 2/2026.").some((i) => i.field === "quantity")).toBe(false);
    expect(extractInstructions("Prosím 30 ks místo 20 ks.")[0]).toMatchObject({ quantity: 30, quantityFrom: 20 });
    expect(extractInstructions("Potřebujeme celkem 1 200 ks.")[0]).toMatchObject({ field: "quantity", quantity: 1200 });
  });
  it("běžné věty nejsou tolerance / rozměr / označení (review #15)", () => {
    expect(extractInstructions("Díky, H7 jsme dostali v pořádku.")).toEqual([]);
    expect(extractInstructions("Volejte mi prosím na 777 123 456, rozměr tam je.").filter((i) => i.field === "dimension")).toEqual([]);
    expect(extractInstructions("Rozměry jsou na výkrese 120 mm, to sedí.").filter((i) => i.field === "dimension")).toEqual([]);
    expect(extractInstructions("Popis dílu najdete v příloze, je to hřídel 20 mm.").filter((i) => i.field === "marking")).toEqual([]);
    expect(extractInstructions("Prosím změnit označení na ABC-123.")[0]).toMatchObject({ field: "marking" });
  });
  it("normalizace: stejný pokyn dvakrát = jednou", () => {
    expect(extractInstructions("Prosím kalit.\nJeště jednou: prosím kalit.")).toHaveLength(1);
  });
  it("AI výstup se normalizuje stejně jako pravidla", () => {
    expect(normalizeAiInstruction({ field: "heat", value: "kalit", quote: "ale prosím kalit" })).toMatchObject({ field: "heat", heat: { kind: "kaleni" } });
    expect(normalizeAiInstruction({ field: "quantity", value: "30 ks", old_value: "20", quote: "30 místo 20" })).toMatchObject({ quantity: 30, quantityFrom: 20 });
    expect(normalizeAiInstruction({ field: "nesmysl", value: "x" })).toBeNull();
    expect(normalizeAiInstruction({ field: "quantity", value: "hodně" })).toBeNull();
    expect(normalizeAiInstruction({ field: "packaging", value: "na paletu", quote: "zabalte na paletu" }, {})).toMatchObject({ field: "packaging", summary: "Balení: na paletu" });
  });
});

describe("změna položky: pokyn nadřazený výkresu", () => {
  const item = { id: "i1", drawing_number: "H-200", quantity: 20, material: "11 523", heat_status: null, heat_treatment: null, surface_status: "bez", note: null };
  it("kalení přes „výkres neuvádí“, počet 20 → 30 s předchozí hodnotou (vrácení)", () => {
    const [heat, qty] = ["heat", "quantity"].map((f) => extractInstructions(REPLY).find((i) => i.field === f)!);
    const h = itemPatchFor(heat, item, { heat_status: null }, "29. 10. 2026")!;
    expect(h.patch).toMatchObject({ heat_status: "uvedeno", heat_treatment: "kalení", spec_sources: { heat: "rucne" } });
    expect((h.patch.heat_steps as { kind: string; note: string }[])[0]).toMatchObject({ kind: "kaleni", note: "Pokyn z e-mailu 29. 10. 2026" });
    expect(h.prev).toEqual({ heat_status: null, heat_treatment: null, heat_steps: null, hardness: null, spec_sources: {} });
    expect(h.drawingValue).toBeNull();
    const q = itemPatchFor(qty, item, { quantity: 20 })!;
    expect(q).toMatchObject({ patch: { quantity: 30 }, prev: { quantity: 20 }, valueNew: "30 ks", valuePrev: "20 ks", drawingValue: "20 ks" });
    // už platí → beze změny
    expect(itemPatchFor(qty, { ...item, quantity: 30 })).toBeNull();
  });
  it("cílení položek: výkres ve větě, jediná položka, počet „místo“", () => {
    const items = [{ id: "a", drawing_number: "H-200", quantity: 20 }, { id: "b", drawing_number: "P-20", quantity: 5 }];
    const [q] = extractInstructions("30 ks místo 20 prosím");
    expect(targetItems(q, items)).toEqual({ items: [items[0]], ambiguous: false });
    const [h] = extractInstructions("prosím kalit");
    expect(targetItems(h, items).ambiguous).toBe(true);
    const [h2] = extractInstructions("P-20 prosím kalit", { drawingNumbers: ["H-200", "P-20"] });
    expect(targetItems(h2, items).items.map((i) => i.id)).toEqual(["b"]);
    const [addr] = extractInstructions("Dodací adresa je nová: Hala 3.");
    expect(targetItems(addr, items)).toEqual({ items: [], ambiguous: false });
  });
  it("pokyn z e-mailu je ruční údaj: pozdější čtení výkresu ho nepřepíše (review #9)", () => {
    const [heat] = extractInstructions("Prosím kalit.");
    const row = { ...item, heat_status: "bez", heat_treatment: null, heat_steps: [], hardness: null, spec_sources: { heat: "ai", material_designation: "ai" } };
    const p = itemPatchFor(heat, row, null, "29. 10. 2026")!;
    expect(p.patch.spec_sources).toEqual({ heat: "rucne", material_designation: "ai" });
    expect(p.prev.spec_sources).toEqual({ heat: "ai", material_designation: "ai" });
    const after = { ...row, ...p.patch };
    // výkres (AI) znovu přečtený s „bez TZ" → kalení zůstane a capture ohlásí „zůstalo ručně zadané"
    const m = mergeSpecPatch(after, { heat_status: "bez", heat_steps: [], heat_treatment: null, hardness: null } as never, { heat: "ai" });
    expect(m.changed).not.toContain("heat");
    expect(m.kept).toContain("heat");
    expect(m.patch.heat_status).toBeUndefined();
    expect(overrideBadgeText("29. 10. 2026")).toBe("Pokyn zákazníka z e-mailu 29. 10. 2026 — nadřazeno výkresu");
  });
});

describe("položky z e-mailu a výkresy z příloh", () => {
  it("číslo výkresu z názvu souboru (bez revize), klíč revize", () => {
    expect(drawingNumberFromFilename("H-200_revB.pdf")).toBe("H-200");
    expect(drawingNumberFromFilename("Výkres H-200 rev. C.pdf")).toBe("H-200");
    expect(drawingNumberFromFilename("IMG_2034.jpg")).toBeNull();
    expect(drawingNumberFromFilename("nabidka.docx")).toBeNull();
    expect(drawingFileKey("H-200_revA.pdf")).toBe(drawingFileKey("H 200_revB.pdf"));
  });
  it("„poptáváme 20 ks dle výkresu H-200, prosím kalit“ + příloha", () => {
    expect(itemHintsFromMail("Dobrý den, poptáváme 20 ks dle výkresu H-200, prosím kalit.", ["H-200.pdf"])).toEqual([{ drawingNumber: "H-200", quantity: 20, name: null }]);
    expect(itemHintsFromMail("H-200 – 20 ks\nP-20 – 5 ks", ["H-200.pdf", "P-20.pdf"])).toEqual([
      { drawingNumber: "H-200", quantity: 20, name: null }, { drawingNumber: "P-20", quantity: 5, name: null },
    ]);
  });
});

describe("„X místo Y“ jen když Y platí na položce (fix 2)", () => {
  const one = (text: string, field: string) => extractInstructions(text).find((i) => i.field === field)!;
  const mat = one("Materiál 1.4301 místo 1.4305.", "material");
  const qty = one("Prosím 30 ks místo 20 ks.", "quantity");
  it("materiál: normalizace označení (1.4305, 11 523, S235 / S235JR)", () => {
    expect(oldValueMatches(mat, { id: "i", material: "1.4305" })).toBe(true);
    expect(oldValueMatches(mat, { id: "i", material: " 1.4305 " })).toBe(true);
    expect(oldValueMatches(mat, { id: "i", material: "11 523" })).toBe(false);
    expect(oldValueMatches(mat, { id: "i", material: "1.4301" })).toBe(false);
    // položka bez materiálu → platí hodnota výkresu
    expect(oldValueMatches(mat, { id: "i", material: null }, { material: "1.4305" })).toBe(true);
    expect(oldValueMatches(mat, { id: "i", material: null }, null)).toBe(false);
    expect(sameMaterial("11 523", "11523")).toBe(true);
    expect(sameMaterial("S235", "S235JR")).toBe(true);
    expect(sameMaterial("ocel S235JR+AR", "S235")).toBe(true);
    expect(sameMaterial("1.430", "1.4301")).toBe(false);
    expect(sameMaterial("S235", "S355")).toBe(false);
    const csn = one("místo 11 523 bude 12 050", "material");
    expect(oldValueMatches(csn, { id: "i", material: "11523" })).toBe(true);
    expect(oldValueMatches(csn, { id: "i", material: "S235" })).toBe(false);
  });
  it("počet kusů, tepelné zpracování, povrch, revize, tvrdost (AI old_value)", () => {
    expect(oldValueMatches(qty, { id: "i", quantity: 20 })).toBe(true);
    expect(oldValueMatches(qty, { id: "i", quantity: "20.000" })).toBe(true);
    expect(oldValueMatches(qty, { id: "i", quantity: 25 })).toBe(false);
    const heat = normalizeAiInstruction({ field: "heat", value: "kalení", old_value: "nitridace", quote: "kalit místo nitridovat" })!;
    expect(heat.oldValue).toBe("nitridace");
    expect(oldValueMatches(heat, { id: "i", heat_status: "uvedeno", heat_treatment: "nitridace" })).toBe(true);
    expect(oldValueMatches(heat, { id: "i", heat_status: "bez", heat_treatment: null })).toBe(false);
    const noHeat = normalizeAiInstruction({ field: "heat", value: "kalení", old_value: "bez TZ", quote: "kalit, ne bez TZ" })!;
    expect(oldValueMatches(noHeat, { id: "i", heat_status: "bez", heat_treatment: null })).toBe(true);
    const surf = normalizeAiInstruction({ field: "surface", value: "zinkování", old_value: "černění", quote: "zinkovat místo černit" })!;
    expect(oldValueMatches(surf, { id: "i", surface_status: "uvedeno", surface_treatment: "černění" })).toBe(true);
    expect(oldValueMatches(surf, { id: "i", surface_status: "uvedeno", surface_treatment: "eloxování" })).toBe(false);
    const rev = normalizeAiInstruction({ field: "revision", value: "C", old_value: "b", quote: "revize C místo B" })!;
    expect(oldValueMatches(rev, { id: "i", revision: "B" })).toBe(true);
    expect(oldValueMatches(rev, { id: "i", revision: "A" })).toBe(false);
    const hard = normalizeAiInstruction({ field: "hardness", value: "58 HRC", old_value: "52HRC", quote: "tvrdost 58 HRC místo 52 HRC" })!;
    expect(oldValueMatches(hard, { id: "i", hardness: "52 HRC" })).toBe(true);
    expect(oldValueMatches(hard, { id: "i", hardness: "45 HRC" })).toBe(false);
  });
  it("pravidla: „kalit místo nitridovat“ / „místo černění zinkovat“ = nová i původní úprava", () => {
    const h = one("Prosím kalit místo nitridovat.", "heat");
    expect(h).toMatchObject({ heat: { kind: "kaleni" }, oldValue: "nitridace", summary: "Tepelné zpracování: kalení (místo nitridace)" });
    expect(one("Místo nitridace prosím kalit.", "heat")).toMatchObject({ heat: { kind: "kaleni" }, oldValue: "nitridace" });
    expect(oldValueMatches(h, { id: "i", heat_status: "uvedeno", heat_treatment: "Nitridace" })).toBe(true);
    expect(oldValueMatches(h, { id: "i", heat_status: "bez", heat_treatment: null })).toBe(false);
    const s = one("Místo černění prosím zinkovat.", "surface");
    expect(s).toMatchObject({ surface: { kind: "zinkovani" }, oldValue: "černění" });
    expect(oldValueMatches(s, { id: "i", surface_status: "uvedeno", surface_treatment: "černění" })).toBe(true);
    // jen jedna úprava ve větě s „místo" = beze změny chování (bez původní hodnoty)
    expect(one("Prosím kalit místo 20 ks 30 ks.", "heat").oldValue).toBeUndefined();
  });
  it("bez „místo“ → nic se neporovnává; text návrhu", () => {
    expect(oldValueMatches(one("Prosím kalit.", "heat"), { id: "i" })).toBeNull();
    expect(oldValueMatches(one("Materiál: 1.4301", "material"), { id: "i", material: "11 523" })).toBeNull();
    expect(insteadText(mat, "11 523")).toBe("e-mail: 1.4301 místo 1.4305, na položce je 11 523");
    expect(insteadText(qty, "25 ks")).toBe("e-mail: 30 ks místo 20 ks, na položce je 25 ks");
    expect(insteadText(qty, "—")).toBe("e-mail: 30 ks místo 20 ks, na položce není nic");
  });
});

describe("platí změna z e-mailu ještě na položce? (fix 3)", () => {
  it("hodnoty sloupců (čísla číselně, JSON bez ohledu na pořadí klíčů)", () => {
    const patch = { quantity: 30, heat_status: "uvedeno", heat_steps: [{ kind: "kaleni", value: "" }], spec_sources: { heat: "rucne" } };
    expect(changeHolds("quantity", { quantity: 30 }, { quantity: 20 }, { quantity: "30.000" })).toBe(true);
    expect(changeHolds("quantity", { quantity: 30 }, { quantity: 20 }, { quantity: 35 })).toBe(false);
    expect(changeHolds("heat", patch, {}, { quantity: 30, heat_status: "uvedeno", heat_steps: [{ value: "", kind: "kaleni" }], spec_sources: {} })).toBe(true);
    expect(changeHolds("material", { material: "1.4301", material_designation: "1.4301" }, {}, { material: "1.4404", material_designation: "1.4301" })).toBe(false);
    expect(changeHolds("material", { material: "1.4301" }, {}, null)).toBe(false);
  });
  it("poznámka (označení / rozměry / tolerance): platí, dokud v poznámce položky je řádek z e-mailu", () => {
    const patch = { note: "Stará poznámka\nPokyn z e-mailu 29. 10. 2026: vyrazit číslo dílu" };
    const prev = { note: "Stará poznámka" };
    const line = mailNoteLine(patch, prev);
    expect(line).toBe("Pokyn z e-mailu 29. 10. 2026: vyrazit číslo dílu");
    expect(mailNoteLine({ note: "Pokyn z e-mailu: x" }, { note: null })).toBe("Pokyn z e-mailu: x");
    expect(changeHolds("marking", patch, prev, { note: `${patch.note}\nDalší ruční řádek` })).toBe(true);
    expect(changeHolds("marking", patch, prev, { note: "Stará poznámka" })).toBe(false);
    expect(noteWithoutLine(`${patch.note}\nDalší ruční řádek`, line!)).toBe("Stará poznámka\nDalší ruční řádek");
    expect(noteWithoutLine(line!, line!)).toBeNull();
  });
});
