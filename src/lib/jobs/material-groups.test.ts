import { describe, expect, it } from "vitest";
import {
  classifyMaterial, findHardness, formatHeatTreatments, formatSurfaceTreatments, HEAT_KINDS, MATERIAL_GROUP_ORDER,
  MATERIAL_GROUPS, MATERIAL_SUBGROUPS, materialGroupFromText, materialGroupMeta, parseTreatments, SURFACE_KINDS,
  type MaterialGroupKey,
} from "./material-groups";

// [označení z výkresu, skupina, podskupina | null | undefined (= nekontrolovat), uklizené označení | undefined]
const CASES: Array<[string, MaterialGroupKey, string | null | undefined, string | undefined]> = [
  // ── běžná konstrukční ocel ──
  ["S235JR", "bezna_ocel", null, "S235JR"],
  ["S355J2+N", "bezna_ocel", null, "S355J2"],
  ["s355j2", "bezna_ocel", null, undefined],
  ["11 373", "bezna_ocel", null, "ČSN 11 373"],
  ["11373", "bezna_ocel", null, "ČSN 11 373"],
  ["ČSN 11 523.1", "bezna_ocel", null, "ČSN 11 523.1"],
  ["12 050", "bezna_ocel", "usle_uhlikova", "ČSN 12 050"],
  ["C45", "bezna_ocel", "usle_uhlikova", "C45"],
  ["C45E (1.1191)", "bezna_ocel", "usle_uhlikova", undefined],
  ["Ck45", "bezna_ocel", "usle_uhlikova", "Ck45"],
  ["1.0503", "bezna_ocel", undefined, "1.0503"],
  ["E295", "bezna_ocel", null, "E295"],
  ["St37-2", "bezna_ocel", null, "St37-2"],
  ["11SMn30", "bezna_ocel", "automatova", "11SMn30"],
  ["11SMnPb30 (1.0718)", "bezna_ocel", "automatova", undefined],
  ["ČSN 11 109", "bezna_ocel", "automatova", "ČSN 11 109"],
  ["DC01", "bezna_ocel", "plech_ocel", "DC01"],
  ["DX51D+Z275", "bezna_ocel", "plech_ocel", undefined],
  ["S355MC", "bezna_ocel", "plech_ocel", undefined],
  ["AISI 1045", "bezna_ocel", null, "AISI 1045"],
  // ── zušlechtěná / legovaná ──
  ["42CrMo4", "zuslechtena_ocel", null, "42CrMo4"],
  ["42CrMo4+QT", "zuslechtena_ocel", null, "42CrMo4+QT"],
  ["1.7225", "zuslechtena_ocel", null, "1.7225"],
  ["15 142", "zuslechtena_ocel", null, "ČSN 15 142"],
  ["ČSN 15 142.6", "zuslechtena_ocel", null, "ČSN 15 142.6"],
  ["ČSN 41 5142", "zuslechtena_ocel", null, "ČSN 15 142"],
  ["34CrNiMo6", "zuslechtena_ocel", null, "34CrNiMo6"],
  ["1.6582", "zuslechtena_ocel", null, "1.6582"],
  ["12 050.6", "zuslechtena_ocel", null, "ČSN 12 050.6"],
  ["C45 +QT", "zuslechtena_ocel", null, undefined],
  ["C45 zušlechtěno", "zuslechtena_ocel", null, undefined],
  ["16MnCr5", "zuslechtena_ocel", "cementacni", "16MnCr5"],
  ["1.7131", "zuslechtena_ocel", "cementacni", "1.7131"],
  ["14 220", "zuslechtena_ocel", "cementacni", "ČSN 14 220"],
  ["18CrNiMo7-6", "zuslechtena_ocel", "cementacni", "18CrNiMo7-6"],
  ["100Cr6", "zuslechtena_ocel", "lozyskova", "100Cr6"],
  ["14 109", "zuslechtena_ocel", "lozyskova", "ČSN 14 109"],
  ["51CrV4", "zuslechtena_ocel", "pruzinova", "51CrV4"],
  ["31CrMoV9", "zuslechtena_ocel", "nitridacni", "31CrMoV9"],
  ["AISI 4140", "zuslechtena_ocel", null, "AISI 4140"],
  ["S690QL", "zuslechtena_ocel", "oteruvzdorna", "S690QL"],
  ["Hardox 450", "zuslechtena_ocel", "oteruvzdorna", undefined],
  // ── nástrojová ──
  ["1.2379", "nastrojova_ocel", "nastr_ledeburit", "1.2379"],
  ["W.Nr. 1.2379", "nastrojova_ocel", "nastr_ledeburit", "1.2379"],
  ["X153CrMoV12", "nastrojova_ocel", "nastr_ledeburit", "X153CrMoV12"],
  ["19 573", "nastrojova_ocel", "nastr_ledeburit", "ČSN 19 573"],
  ["19 552", "nastrojova_ocel", "nastr_tepla", "ČSN 19 552"],
  ["19552", "nastrojova_ocel", "nastr_tepla", "ČSN 19 552"],
  ["ČSN 19 552.4", "nastrojova_ocel", "nastr_tepla", undefined],
  ["1.2343 (H11)", "nastrojova_ocel", "nastr_tepla", undefined],
  ["X40CrMoV5-1", "nastrojova_ocel", "nastr_tepla", "X40CrMoV5-1"],
  ["H13", "nastrojova_ocel", undefined, "AISI H13"],
  ["D2", "nastrojova_ocel", undefined, "AISI D2"],
  ["1.2311", "nastrojova_ocel", "nastr_formy", "1.2311"],
  ["1.2842", "nastrojova_ocel", undefined, "1.2842"],
  ["90MnCrV8", "nastrojova_ocel", undefined, "90MnCrV8"],
  ["19 312", "nastrojova_ocel", undefined, "ČSN 19 312"],
  ["HS6-5-2", "nastrojova_ocel", "hss", "HS6-5-2"],
  ["19 830", "nastrojova_ocel", "hss", "ČSN 19 830"],
  ["1.3343", "nastrojova_ocel", "hss", "1.3343"],
  ["HSS-Co", "nastrojova_ocel", "hss", undefined],
  ["Böhler K110", "nastrojova_ocel", undefined, undefined],
  ["Böhler W302", "nastrojova_ocel", undefined, undefined],
  ["Vanadis 23", "nastrojova_ocel", undefined, undefined],
  ["Toolox 44", "nastrojova_ocel", undefined, undefined],
  ["C105U", "nastrojova_ocel", undefined, "C105U"],
  // ── slinutý karbid ──
  ["HM K20", "slinuty_karbid", null, undefined],
  ["slinutý karbid", "slinuty_karbid", null, undefined],
  ["Hartmetall", "slinuty_karbid", null, undefined],
  ["WC-Co 10 %", "slinuty_karbid", null, undefined],
  ["K10", "slinuty_karbid", null, "K10"],
  // ── nerez ──
  ["1.4301", "nerez", "nerez_austenit", "1.4301"],
  ["17 240", "nerez", "nerez_austenit", "ČSN 17 240"],
  ["AISI 316L", "nerez", "nerez_austenit_mo", "AISI 316L"],
  ["316L", "nerez", "nerez_austenit_mo", undefined],
  ["304", "nerez", "nerez_austenit", "AISI 304"],
  ["X5CrNi18-10", "nerez", "nerez_austenit", "X5CrNi18-10"],
  ["X2CrNiMo17-12-2 (1.4404)", "nerez", "nerez_austenit_mo", undefined],
  ["1.4571", "nerez", "nerez_austenit_mo", "1.4571"],
  ["1.4305 (AISI 303)", "nerez", "nerez_austenit", undefined],
  ["X20Cr13", "nerez", "nerez_martenzit", "X20Cr13"],
  ["1.4021", "nerez", "nerez_martenzit", "1.4021"],
  ["AISI 420", "nerez", "nerez_martenzit", "AISI 420"],
  ["17 029", "nerez", "nerez_martenzit", "ČSN 17 029"],
  ["1.4542 (17-4PH)", "nerez", "nerez_ph", undefined],
  ["1.4828", "nerez", "nerez_zaruvzdorna", "1.4828"],
  ["V2A", "nerez", null, undefined],
  ["nerez", "nerez", null, ""],
  ["UNS S31603", "nerez", "nerez_austenit", "UNS S31603"],
  // ── duplex ──
  ["1.4462", "duplex", null, "1.4462"],
  ["X2CrNiMoN22-5-3", "duplex", null, "X2CrNiMoN22-5-3"],
  ["Duplex 2205", "duplex", null, undefined],
  ["1.4362", "duplex", null, "1.4362"],
  ["1.4410", "duplex", "super_duplex", "1.4410"],
  ["Super duplex 2507", "duplex", "super_duplex", undefined],
  ["UNS S32750", "duplex", "super_duplex", "UNS S32750"],
  ["X2CrNiMoN25-7-4", "duplex", "super_duplex", undefined],
  // ── měď ──
  ["Cu-ETP", "med", null, "Cu-ETP"],
  ["E-Cu", "med", null, undefined],
  ["CW004A", "med", null, "CW004A"],
  ["ČSN 42 3001", "med", null, "ČSN 42 3001"],
  ["CuCrZr", "med", "med_nizkolegovana", undefined],
  ["2.0060", "med", null, "2.0060"],
  ["měď", "med", null, ""],
  // ── jiné barevné kovy ──
  ["CuZn39Pb3", "barevne_kovy", "mosaz", "CuZn39Pb3"],
  ["CW614N", "barevne_kovy", "mosaz", "CW614N"],
  ["Ms58", "barevne_kovy", "mosaz", "Ms58"],
  ["mosaz", "barevne_kovy", "mosaz", ""],
  ["ČSN 42 3213", "barevne_kovy", "mosaz", "ČSN 42 3213"],
  ["CuSn8", "barevne_kovy", "bronz", "CuSn8"],
  ["CC491K (Rg5)", "barevne_kovy", "bronz", undefined],
  ["CuAl10Fe5Ni5", "barevne_kovy", "hlinikovy_bronz", "CuAl10Fe5Ni5"],
  ["CuBe2", "barevne_kovy", "berylliova_med", undefined],
  ["Inconel 718", "barevne_kovy", "niklova_slitina", undefined],
  ["2.4856 (Alloy 625)", "barevne_kovy", "niklova_slitina", undefined],
  ["Hastelloy C-276", "barevne_kovy", "hastelloy", undefined],
  ["Hastelloy C-22", "barevne_kovy", "hastelloy", undefined],
  ["Monel 400", "barevne_kovy", "monel", undefined],
  ["AZ31", "barevne_kovy", "horcik", undefined],
  // ── litina ──
  ["EN-GJL-250", "litina", "litina_seda", "EN-GJL-250"],
  ["GG25", "litina", "litina_seda", "GG-25"],
  ["ČSN 42 2425", "litina", "litina_seda", "ČSN 42 2425"],
  ["EN-GJS-400-15", "litina", "litina_tvarna", "EN-GJS-400-15"],
  ["GGG-40", "litina", "litina_tvarna", "GGG-40"],
  ["ČSN 42 2304", "litina", "litina_tvarna", "ČSN 42 2304"],
  ["0.6025", "litina", "litina_seda", "0.6025"],
  ["tvárná litina", "litina", "litina_tvarna", undefined],
  ["GS-C25", "litina", "ocelolitina", undefined],
  // ── hliník ──
  ["EN AW-6082 T6", "hlinik", null, undefined],
  ["EN AW-7075", "hlinik", "al_7xxx", "EN AW-7075"],
  ["7075-T651", "hlinik", "al_7xxx", undefined],
  ["AW 2017A", "hlinik", "al_dural", undefined],
  ["AlMgSi1", "hlinik", null, "AlMgSi1"],
  ["AlZnMgCu1,5", "hlinik", "al_7xxx", undefined],
  ["AlCuMg1", "hlinik", "al_dural", "AlCuMg1"],
  ["AlMg4,5Mn", "hlinik", "al_5xxx", undefined],
  ["5083", "hlinik", "al_5xxx", undefined],
  ["3.2315", "hlinik", null, "3.2315"],
  ["ČSN 42 4401", "hlinik", null, "ČSN 42 4401"],
  ["EN AC-43000", "hlinik", "al_slevarensky", undefined],
  ["dural", "hlinik", "al_dural", undefined],
  ["hliník", "hlinik", null, ""],
  // ── titan ──
  ["Ti6Al4V", "titan", "ti_slitina", undefined],
  ["Titan Gr. 2", "titan", "ti_cisty", "Ti Grade 2"],
  ["Ti Grade 5", "titan", "ti_slitina", "Ti Grade 5"],
  ["3.7165", "titan", "ti_slitina", "3.7165"],
  ["3.7035", "titan", "ti_cisty", "3.7035"],
  // ── plasty ──
  ["POM-C", "plasty", "pom", undefined],
  ["Delrin", "plasty", "pom", undefined],
  ["PA6", "plasty", "pa", undefined],
  ["PA6G", "plasty", "pa", undefined],
  ["PE 1000", "plasty", "pe_uhmw", undefined],
  ["PE-HD", "plasty", "pe", undefined],
  ["PTFE", "plasty", "ptfe", undefined],
  ["Teflon", "plasty", "ptfe", undefined],
  ["PEEK", "plasty", "peek", undefined],
  ["PMMA (plexi)", "plasty", "pmma", undefined],
  ["textit", "plasty", "textit", undefined],
  // ── ostatní ──
  ["grafit", "ostatni", "grafit", undefined],
];

describe("classifyMaterial — reálná označení z výkresů", () => {
  it(`má aspoň 60 případů (${CASES.length})`, () => {
    expect(CASES.length).toBeGreaterThanOrEqual(60);
  });

  it.each(CASES)("%s → %s", (designation, group, sub, normalized) => {
    const r = classifyMaterial(designation);
    expect(r.group).toBe(group);
    if (sub !== undefined) expect(r.subgroup?.key ?? null).toBe(sub);
    if (normalized !== undefined) expect(r.normalizedDesignation).toBe(normalized);
    expect(r.confidence).toBeGreaterThan(0.5);
    expect(r.density).toBeGreaterThan(0.5);
    expect(r.label).toBe(MATERIAL_GROUPS[group].label);
  });

  it("hustoty podskupin: mosaz 8,5, bronz 8,8, PTFE 2,2, titan Gr5 4,43, dural 2,79, HSS 8,1", () => {
    expect(classifyMaterial("CuZn39Pb3").density).toBe(8.5);
    expect(classifyMaterial("CuSn8").density).toBe(8.8);
    expect(classifyMaterial("PTFE").density).toBe(2.2);
    expect(classifyMaterial("Ti6Al4V").density).toBe(4.43);
    expect(classifyMaterial("AlCuMg1").density).toBe(2.79);
    expect(classifyMaterial("HS6-5-2").density).toBe(8.1);
    expect(classifyMaterial("S235JR").density).toBe(7.85);
    // shodně s katalogem nacenění (tabulka materials): 1.4301 = 7,90, 1.4404 = 8,00
    expect(classifyMaterial("1.4301").density).toBe(7.9);
    expect(classifyMaterial("1.4404").density).toBe(8);
  });

  it("normalizace mezer a teček: „19 552“ = „19552“ = „ČSN 19552“; „1,2379“ = „1.2379“", () => {
    expect(classifyMaterial("19552").normalizedDesignation).toBe("ČSN 19 552");
    expect(classifyMaterial("ČSN 19552").normalizedDesignation).toBe("ČSN 19 552");
    expect(classifyMaterial("1,2379").normalizedDesignation).toBe("1.2379");
    expect(classifyMaterial("W.-Nr. 1.2379").group).toBe("nastrojova_ocel");
  });

  it("víc označení téže oceli → spojí je", () => {
    const r = classifyMaterial("1.2379 / X153CrMoV12 / ČSN 19 573");
    expect(r.group).toBe("nastrojova_ocel");
    expect(r.normalizedDesignation).toBe("1.2379 / X153CrMoV12 / ČSN 19 573");
  });

  it("stav a tvrdost z označení", () => {
    expect(classifyMaterial("42CrMo4+QT").condition).toBe("zušlechtěno (+QT)");
    expect(classifyMaterial("C45+N").condition).toBe("normalizačně žíháno (+N)");
    expect(classifyMaterial("1.2379 kaleno 58-60 HRC").hardness).toBe("58-60 HRC");
    expect(classifyMaterial("42CrMo4 zušlechtěno 28-32 HRC").condition).toBe("zušlechtěno");
  });

  it("norma za označením (ČSN EN 10083) se nebere jako ČSN ocel", () => {
    const r = classifyMaterial("C45E dle ČSN EN 10083-2");
    expect(r.group).toBe("bezna_ocel");
    expect(r.normalizedDesignation).toBe("C45E");
  });

  it("uložení / rozměry nejsou materiál", () => {
    expect(classifyMaterial("Ø40s6").group).toBe("ostatni");
    expect(classifyMaterial("10N").group).toBe("ostatni");
  });

  it("jednoznačné označení má přednost před AI", () => {
    const r = classifyMaterial("1.4301", "bezna_ocel");
    expect(r.group).toBe("nerez");
    expect(r.source).toBe("oznaceni");
  });

  it("AI skupina jako záloha: nic / jen obecné „ocel“", () => {
    const none = classifyMaterial("", "nástrojová ocel");
    expect(none.group).toBe("nastrojova_ocel");
    expect(none.source).toBe("ai");
    expect(none.confidence).toBe(0.5);
    const generic = classifyMaterial("ocel", "zuslechtena_ocel");
    expect(generic.group).toBe("zuslechtena_ocel");
    const agree = classifyMaterial("ocel", "bezna_ocel");
    expect(agree.source).toBe("klicove_slovo");
  });

  it("neurčený materiál → ostatní, hustota oceli jen předpokládaná", () => {
    const r = classifyMaterial("dle dohody");
    expect(r.group).toBe("ostatni");
    expect(r.confidence).toBe(0);
    expect(r.densityAssumed).toBe(true);
    expect(r.density).toBe(7.85);
    expect(classifyMaterial(null).group).toBe("ostatni");
  });

  it("odlitky z nerezu (GX…) zůstanou nerez s příznakem odlitku", () => {
    const r = classifyMaterial("GX5CrNi19-10");
    expect(r.group).toBe("nerez");
    expect(r.cast).toBe(true);
  });

  it("„karbid křemíku“ není slinutý karbid, „Wolframkarbid“ je", () => {
    expect(classifyMaterial("karbid křemíku SiC").group).toBe("ostatni");
    expect(classifyMaterial("Wolframkarbid").group).toBe("slinuty_karbid");
  });
});

describe("skupiny — metadata", () => {
  it("každá skupina má štítky, třídy, ikonu a hustotu; barvy jsou různé", () => {
    const dots = new Set<string>();
    for (const k of MATERIAL_GROUP_ORDER) {
      const g = MATERIAL_GROUPS[k];
      expect(g.key).toBe(k);
      expect(g.label && g.short && g.icon && g.badge && g.dot).toBeTruthy();
      expect(g.density).toBeGreaterThan(0);
      dots.add(g.dot);
    }
    expect(dots.size).toBe(MATERIAL_GROUP_ORDER.length);
    expect(MATERIAL_GROUP_ORDER.length).toBe(13);
  });

  it("podskupiny patří do existující skupiny", () => {
    for (const s of Object.values(MATERIAL_SUBGROUPS)) expect(MATERIAL_GROUPS[s.group]).toBeDefined();
  });

  it("materialGroupFromText převede volný text AI", () => {
    expect(materialGroupFromText("Nástrojová ocel")).toBe("nastrojova_ocel");
    expect(materialGroupFromText("stainless steel")).toBe("nerez");
    expect(materialGroupFromText("zušlechtěná ocel")).toBe("zuslechtena_ocel");
    expect(materialGroupFromText("hlinik")).toBe("hlinik");
    expect(materialGroupFromText("barevne_kovy")).toBe("barevne_kovy");
    expect(materialGroupFromText("nesmysl xyz")).toBeNull();
    expect(materialGroupMeta("neexistuje").key).toBe("ostatni");
  });
});

describe("findHardness", () => {
  it.each([
    ["58-60 HRC", "58-60 HRC"],
    ["HRC 58-60", "58-60 HRC"],
    ["58+2 HRC", "58-60 HRC"],
    ["58±1HRC", "57-59 HRC"],
    ["min. 55 HRC", "min. 55 HRC"],
    ["≥ 600 HV1", "min. 600 HV1"],
    ["max. 250 HB", "max. 250 HB"],
    ["HV 600", "600 HV"],
    ["Härte 60 HRC", "60 HRC"],
    ["28–32 HRC", "28-32 HRC"],
  ])("%s → %s", (text, value) => {
    expect(findHardness(text)[0]?.value).toBe(value);
  });

  it("nesmyslné hodnoty ignoruje", () => {
    expect(findHardness("5 HRC")).toHaveLength(0);
    expect(findHardness("Ra 0,8")).toHaveLength(0);
  });
});

const kinds = (r: ReturnType<typeof parseTreatments>) => ({ heat: r.heat.map((h) => h.kind), surface: r.surface.map((s) => s.kind) });

describe("parseTreatments — tepelné zpracování (CZ / DE / EN)", () => {
  it("kalit + popustit s tvrdostí", () => {
    const r = parseTreatments("Kalit na 58-60 HRC, popustit");
    expect(kinds(r).heat).toEqual(["kaleni", "popousteni"]);
    expect(r.heat[0].hardness).toBe("58-60 HRC");
  });
  it("zušlechtit (tvrdost patří zušlechtění)", () => {
    const r = parseTreatments("Zušlechtit na 28-32 HRC");
    expect(r.heat).toEqual([expect.objectContaining({ kind: "zuslechteni", hardness: "28-32 HRC" })]);
  });
  it("cementace s hloubkou (Eht 0,8+0,3) a kalení", () => {
    const r = parseTreatments("Cementovat Eht 0,8+0,3; kalit 58-62 HRC");
    expect(kinds(r).heat).toEqual(["cementace", "kaleni"]);
    expect(r.heat[0].depth).toBe("0,8-1,1 mm");
    expect(r.heat[1].hardness).toBe("58-62 HRC");
  });
  it("německy: einsatzgehärtet CHD + tvrdost", () => {
    const r = parseTreatments("einsatzgehärtet CHD 0.6-0.9, 58+2 HRC");
    expect(r.heat).toEqual([expect.objectContaining({ kind: "cementace", depth: "0,6-0,9 mm", hardness: "58-60 HRC" })]);
  });
  it("německy: gehärtet und angelassen", () => {
    expect(kinds(parseTreatments("gehärtet und angelassen 60 HRC")).heat).toEqual(["kaleni", "popousteni"]);
  });
  it("německy: vergütet", () => {
    expect(kinds(parseTreatments("vergütet auf 900-1100 N/mm²")).heat).toEqual(["zuslechteni"]);
  });
  it("anglicky: quenched and tempered = zušlechtění (bez samostatného popouštění)", () => {
    expect(kinds(parseTreatments("Quenched and tempered 30-35 HRC")).heat).toEqual(["zuslechteni"]);
  });
  it("anglicky: induction hardened s hloubkou", () => {
    const r = parseTreatments("Induction hardened 50-55 HRC, depth 1.5-2 mm");
    expect(r.heat).toEqual([expect.objectContaining({ kind: "indukcni_kaleni", hardness: "50-55 HRC", depth: "1,5-2 mm", detail: "indukčně" })]);
  });
  it("nitridace s tvrdostí HV a hloubkou", () => {
    const r = parseTreatments("Plazmově nitridovat, 600 HV1, hloubka 0,3 mm");
    expect(r.heat).toEqual([expect.objectContaining({ kind: "nitridace", hardness: "600 HV1", depth: "0,3 mm", detail: "plazmová" })]);
  });
  it("nitridační ocel v poznámce není nitridace", () => {
    expect(parseTreatments("materiál: nitridační ocel").heat).toEqual([]);
  });
  it("QPQ / Tenifer = nitrocementace", () => {
    expect(kinds(parseTreatments("QPQ")).heat).toEqual(["nitrocementace"]);
    expect(kinds(parseTreatments("Tenifer + oxidiert")).heat).toEqual(["nitrocementace"]);
  });
  it("žíhání ke snížení pnutí / normalizace / na měkko", () => {
    expect(kinds(parseTreatments("Po svaření žíhat ke snížení pnutí")).heat).toEqual(["zihani_pnuti"]);
    expect(kinds(parseTreatments("spannungsarm geglüht")).heat).toEqual(["zihani_pnuti"]);
    expect(kinds(parseTreatments("normalizačně žíháno")).heat).toEqual(["normalizace"]);
    expect(parseTreatments("žíháno na měkko").heat[0]).toEqual(expect.objectContaining({ kind: "zihani", detail: "na měkko" }));
  });
  it("vakuové kalení", () => {
    expect(parseTreatments("Kaleno vakuově 58±1 HRC").heat[0]).toEqual(expect.objectContaining({ kind: "kaleni", detail: "vakuově", hardness: "57-59 HRC" }));
  });
  it("jen tvrdost → odvozené kalení / zušlechtění", () => {
    expect(parseTreatments("58 HRC").heat[0]).toEqual(expect.objectContaining({ kind: "kaleni", inferred: true }));
    expect(parseTreatments("tvrdost 280-320 HB").heat[0]).toEqual(expect.objectContaining({ kind: "zuslechteni", inferred: true }));
  });
  it("negace a „bez TZ“", () => {
    expect(parseTreatments("nekalit").heat).toEqual([]);
    expect(parseTreatments("bez kalení").heat).toEqual([]);
    expect(kinds(parseTreatments("bez TZ")).heat).toEqual(["bez_tz"]);
    expect(kinds(parseTreatments("ohne Wärmebehandlung")).heat).toEqual(["bez_tz"]);
  });
  it("precipitační vytvrzení (Al T6, 17-4PH H1150)", () => {
    expect(parseTreatments("vytvrzeno T6").heat[0]).toEqual(expect.objectContaining({ kind: "precipitacni_vytvrzeni", detail: "T6" }));
    expect(parseTreatments("aged H1150").heat[0]?.detail).toBe("H1150");
  });
});

describe("parseTreatments — povrchové úpravy (CZ / DE / EN)", () => {
  it("galvanický zinek 8 µm + modrá pasivace (pasivace je detail zinku)", () => {
    const r = parseTreatments("Galvanicky zinkovat Zn 8 µm, modrá pasivace");
    expect(r.surface).toEqual([expect.objectContaining({ kind: "galvanicky_zinek", detail: "8 µm, modrá pasivace" })]);
  });
  it("ČSN zápis Fe/Zn 12 + černá pasivace", () => {
    expect(parseTreatments("PÚ: Fe/Zn 12 černá pasivace").surface).toEqual([expect.objectContaining({ kind: "galvanicky_zinek", detail: "12 µm, černá pasivace" })]);
  });
  it("ZnNi", () => {
    expect(parseTreatments("Zn-Ni 8µm transparent passiviert").surface[0]).toEqual(expect.objectContaining({ kind: "galvanicky_zinek" }));
    expect(parseTreatments("Zn-Ni 8µm transparent passiviert").surface[0].detail).toContain("ZnNi");
  });
  it("žárové zinkování / hot dip", () => {
    expect(parseTreatments("Žárově zinkovat").surface[0]).toEqual(expect.objectContaining({ kind: "zinkovani", detail: "žárové" }));
    expect(parseTreatments("Hot dip galvanized").surface[0]).toEqual(expect.objectContaining({ kind: "zinkovani", detail: "žárové" }));
    expect(kinds(parseTreatments("feuerverzinkt")).surface).toEqual(["zinkovani"]);
  });
  it("zinkové lamely (Geomet)", () => {
    expect(kinds(parseTreatments("Geomet 321 + Plus VL")).surface).toEqual(["zinkove_lamely"]);
  });
  it("černění / brüniert / black oxide", () => {
    expect(kinds(parseTreatments("černit")).surface).toEqual(["cerneni"]);
    expect(kinds(parseTreatments("brüniert")).surface).toEqual(["cerneni"]);
    expect(kinds(parseTreatments("Black oxide finish")).surface).toEqual(["cerneni"]);
  });
  it("elox černý E6/EV1, tvrdý elox, hartanodisiert, anodized", () => {
    expect(parseTreatments("Eloxovat černě E6/EV1").surface[0]).toEqual(expect.objectContaining({ kind: "eloxovani", detail: "černý, E6/EV1" }));
    expect(parseTreatments("Tvrdý elox 50 µm").surface[0]).toEqual(expect.objectContaining({ kind: "eloxovani", detail: "tvrdý, 50 µm" }));
    expect(parseTreatments("hartanodisiert 40µm").surface[0].detail).toContain("tvrdý");
    expect(parseTreatments("schwarz eloxiert").surface[0].detail).toBe("černý");
    expect(kinds(parseTreatments("Anodized clear, MIL-A-8625 Type II")).surface).toEqual(["eloxovani"]);
  });
  it("tvrdochrom vs. chromování", () => {
    expect(parseTreatments("Tvrdochrom 20 µm, broušeno").surface).toEqual([
      expect.objectContaining({ kind: "tvrdochrom", detail: "20 µm" }),
      expect.objectContaining({ kind: "brouseni_povrchu" }),
    ]);
    expect(kinds(parseTreatments("hartverchromt 0,02 mm")).surface).toEqual(["tvrdochrom"]);
    expect(kinds(parseTreatments("chrome plated")).surface).toEqual(["chromovani"]);
  });
  it("chemický nikl vs. galvanické niklování", () => {
    expect(parseTreatments("Chemický nikl 15 µm").surface[0]).toEqual(expect.objectContaining({ kind: "chemicky_nikl", detail: "15 µm" }));
    expect(kinds(parseTreatments("chemisch vernickelt")).surface).toEqual(["chemicky_nikl"]);
    expect(kinds(parseTreatments("electroless nickel plating")).surface).toEqual(["chemicky_nikl"]);
    expect(kinds(parseTreatments("niklovat")).surface).toEqual(["niklovani"]);
  });
  it("práškové lakování RAL (RAL není druhé lakování)", () => {
    expect(parseTreatments("Práškově lakovat RAL 9005").surface).toEqual([expect.objectContaining({ kind: "praskove_lakovani", detail: "RAL 9005" })]);
    expect(kinds(parseTreatments("pulverbeschichtet RAL 7035")).surface).toEqual(["praskove_lakovani"]);
    expect(parseTreatments("lakovat RAL 5010").surface[0]).toEqual(expect.objectContaining({ kind: "lakovani", detail: "RAL 5010" }));
    expect(kinds(parseTreatments("KTL schwarz")).surface).toEqual(["lakovani"]);
  });
  it("fosfátování, moření a pasivace, elektrolytické leštění", () => {
    expect(parseTreatments("manganfosfatiert").surface[0]).toEqual(expect.objectContaining({ kind: "fosfatovani", detail: "manganový" }));
    expect(kinds(parseTreatments("Mořit a pasivovat")).surface).toEqual(["moreni", "pasivace"]);
    expect(kinds(parseTreatments("Passivated, electropolished")).surface).toEqual(["pasivace", "lesteni"]);
  });
  it("tryskání Sa 2,5 / kuličkování / glasperlgestrahlt", () => {
    expect(parseTreatments("Tryskat Sa 2,5").surface[0]).toEqual(expect.objectContaining({ kind: "tryskani", detail: "Sa 2,5" }));
    expect(parseTreatments("kuličkovat").surface[0].detail).toBe("kuličkování");
    expect(kinds(parseTreatments("glasperlgestrahlt")).surface).toEqual(["tryskani"]);
  });
  it("povlaky TiN / DLC / PVD (TiN ≠ „tin plated“)", () => {
    expect(parseTreatments("TiN").surface[0]).toEqual(expect.objectContaining({ kind: "povlak", detail: "TiN" }));
    expect(parseTreatments("povlak DLC").surface[0].detail).toBe("DLC");
    expect(parseTreatments("PVD AlCrN beschichtet").surface[0].detail).toBe("AlCrN");
    expect(kinds(parseTreatments("tin plated")).surface).toEqual(["cinovani"]);
  });
  it("lapování / honování, stříbření, konzervace", () => {
    expect(kinds(parseTreatments("honovat")).surface).toEqual(["lapovani_honovani"]);
    expect(kinds(parseTreatments("versilbert 5 µm")).surface).toEqual(["stribreni"]);
    expect(kinds(parseTreatments("naolejovat")).surface).toEqual(["konzervace"]);
  });
  it("bez povrchové úpravy / ohne Oberflächenbehandlung", () => {
    expect(kinds(parseTreatments("Bez povrchové úpravy")).surface).toEqual(["bez_upravy"]);
    expect(kinds(parseTreatments("ohne Oberflächenbehandlung")).surface).toEqual(["bez_upravy"]);
  });
  it("kombinovaná poznámka z razítka", () => {
    const r = parseTreatments("TZ: kalit 58-62 HRC, popustit | PÚ: černit | Nekótované hrany sražené 0,5x45°, Ra 3,2");
    expect(kinds(r)).toEqual({ heat: ["kaleni", "popousteni"], surface: ["cerneni"] });
    expect(r.hardness).toEqual(["58-62 HRC"]);
  });
  it("prázdný text", () => {
    expect(parseTreatments("")).toEqual({ heat: [], surface: [], hardness: [] });
    expect(parseTreatments(null)).toEqual({ heat: [], surface: [], hardness: [] });
  });
});

describe("formátování a štítky úprav", () => {
  it("formatHeatTreatments / formatSurfaceTreatments", () => {
    const r = parseTreatments("cementovat Eht 0,8; kalit 58-62 HRC; galvanicky zinkovat 8 µm, modrá pasivace");
    expect(formatHeatTreatments(r.heat)).toBe("cementace, hloubka 0,8 mm; kalení 58-62 HRC");
    expect(formatSurfaceTreatments(r.surface)).toBe("galvanický zinek (8 µm, modrá pasivace)");
  });
  it("každý druh má štítek a třídy", () => {
    for (const k of [...Object.values(HEAT_KINDS), ...Object.values(SURFACE_KINDS)]) {
      expect(k.label && k.short && k.badge && k.dot).toBeTruthy();
    }
  });
});

// ═════════════════════════════════════════════════════════════════════════
// Opravy po recenzi technologa (čísla nálezů v názvech)
// ═════════════════════════════════════════════════════════════════════════

describe("recenze 2 — holé zkratky materiálu", () => {
  it.each([
    ["Al", "hlinik", null, 2.7],
    ["AL", "hlinik", null, 2.7],
    ["Alu", "hlinik", null, 2.7],
    ["Cu", "med", null, 8.94],
    ["Ms", "barevne_kovy", "mosaz", 8.5],
    ["Ti", "titan", null, 4.5],
    ["Mg", "barevne_kovy", "horcik", 1.8],
    ["PA", "plasty", "pa", 1.14],
    ["Ni", "barevne_kovy", "nikl", 8.9],
  ])("%s → %s", (m, group, sub, density) => {
    const r = classifyMaterial(m);
    expect(r.group).toBe(group);
    expect(r.subgroup?.key ?? null).toBe(sub);
    expect(r.density).toBe(density);
    expect(r.densityAssumed).toBe(false);
  });
  it("„MS“ velkými (mild steel?) je pod prahem AI; „chem. Ni“ za ocelí není materiál", () => {
    expect(classifyMaterial("MS").group).toBe("barevne_kovy");
    expect(classifyMaterial("MS", "bezna_ocel").group).toBe("bezna_ocel");
    expect(classifyMaterial("S235 chem. Ni").group).toBe("bezna_ocel");
  });
});

describe("recenze 12 — holé A2 / A4", () => {
  it("A2 / A4 → nerez (0,7); AISI A2 a 1.2363 → nástrojová", () => {
    expect(classifyMaterial("A2")).toEqual(expect.objectContaining({ group: "nerez", confidence: 0.7 }));
    expect(classifyMaterial("A4")).toEqual(expect.objectContaining({ group: "nerez", confidence: 0.7 }));
    expect(classifyMaterial("AISI A2").group).toBe("nastrojova_ocel");
    expect(classifyMaterial("1.2363").group).toBe("nastrojova_ocel");
  });
});

describe("recenze 13 — ČSN 42 5xxx je rozměrová norma, ne materiál", () => {
  it("„KR 70 ČSN 42 5510“ → neurčeno; „ocel ČSN 42 5510“ → obecná ocel, AI ji může přebít", () => {
    expect(classifyMaterial("KR 70 ČSN 42 5510").group).toBe("ostatni");
    expect(classifyMaterial("ocel ČSN 42 5510")).toEqual(expect.objectContaining({ group: "bezna_ocel", confidence: 0.55 }));
    expect(classifyMaterial("ocel ČSN 42 5510", "nerez").group).toBe("nerez");
    expect(classifyMaterial("11 523 ČSN 42 5510").normalizedDesignation).toBe("ČSN 11 523");
  });
  it("litiny a barevné kovy ČSN 42 2xxx–4xxx zůstávají", () => {
    expect(classifyMaterial("ČSN 42 2425").group).toBe("litina");
    expect(classifyMaterial("ČSN 42 3213").group).toBe("barevne_kovy");
  });
});

describe("recenze 8 — stav podle doplňkového čísla ČSN", () => {
  it.each([
    ["ČSN 15 142.7", "zušlechtěno na střední pevnost (.7)", "zuslechtena_ocel"],
    ["12 050.6", "zušlechtěno na dolní pevnost (.6)", "zuslechtena_ocel"],
    ["11 523.1", "normalizačně žíháno (.1)", "bezna_ocel"],
    ["19 436.3", "žíháno na měkko (.3)", "nastrojova_ocel"],
  ])("%s → %s", (m, cond, group) => {
    const r = classifyMaterial(m);
    expect(r.condition).toBe(cond);
    expect(r.group).toBe(group);
  });
  it("u nerezi (17) se doplněk jako stav TZ nebere", () => {
    expect(classifyMaterial("17 240.4").condition).toBeNull();
  });
  it("stav hliníku (T6, T651, T4, H111, O)", () => {
    expect(classifyMaterial("EN AW-6082 T6").condition).toBe("vytvrzeno (T6)");
    expect(classifyMaterial("AW-7075 T651").condition).toBe("vytvrzeno (T651)");
    expect(classifyMaterial("AW 2017 T4").condition).toBe("přirozeně stárnuto (T4)");
    expect(classifyMaterial("EN AW-5083 O").condition).toBe("žíháno (O)");
  });
});

describe("recenze 16 — drobnosti v materiálech", () => {
  it("mezery uvnitř EN označení: „11 SMnPb 30“, „42 CrMo 4“", () => {
    expect(classifyMaterial("11 SMnPb 30")).toEqual(expect.objectContaining({ group: "bezna_ocel", normalizedDesignation: "11SMnPb30" }));
    expect(classifyMaterial("42 CrMo 4").normalizedDesignation).toBe("42CrMo4");
  });
  it("„SK“ = slinutý karbid; samotné „Grade 5“ zůstane neurčené (může být třída šroubu SAE)", () => {
    expect(classifyMaterial("SK").group).toBe("slinuty_karbid");
    expect(classifyMaterial("Grade 5").group).toBe("ostatni");
  });
  it("plněné plasty: PA6 GF30 1,36, PEEK GF30 1,51, PEEK CF30 1,41 (CF30 není ocel Cf30)", () => {
    expect(classifyMaterial("PA6 GF30").density).toBe(1.36);
    expect(classifyMaterial("PEEK GF30").density).toBe(1.51);
    expect(classifyMaterial("PEEK CF30")).toEqual(expect.objectContaining({ group: "plasty", density: 1.41 }));
    expect(classifyMaterial("Cf35").group).toBe("bezna_ocel");
  });
  it("martenzitické 1.4313 / 1.4418 / 1.4528 → 7,7; austenit s Mo 1.4404 → 8,0", () => {
    for (const m of ["1.4313", "1.4418", "1.4528"]) expect(classifyMaterial(m)).toEqual(expect.objectContaining({ group: "nerez", density: 7.7 }));
    expect(classifyMaterial("1.4404").density).toBe(8);
  });
  it("CuNi2Si = nízkolegovaná měď jako CW111C; CuNi10Fe1Mn = měďnikl", () => {
    expect(classifyMaterial("CuNi2Si").group).toBe("med");
    expect(classifyMaterial("CW111C").group).toBe("med");
    expect(classifyMaterial("CuNi10Fe1Mn").subgroup?.key).toBe("mednikl");
  });
  it("tvrdost „58 HRC +2“ = 58-60, „60 HRC ±2“ = 58-62", () => {
    expect(findHardness("58 HRC +2")[0]?.value).toBe("58-60 HRC");
    expect(findHardness("Härte 60 HRC ±2")[0]?.value).toBe("58-62 HRC");
  });
  it("zušlechtění s pevností Rm", () => {
    expect(parseTreatments("zušlechtit na Rm 900–1100 MPa").heat[0]).toEqual(expect.objectContaining({ kind: "zuslechteni", detail: "Rm 900-1100 MPa" }));
  });
  it("omílání / trowalizace / Gleitschliff, sandgestrahlt, ENP", () => {
    for (const s of ["omílat", "trowalizovat", "Gleitschliff"]) expect(kinds(parseTreatments(s)).surface).toEqual(["omilani"]);
    expect(parseTreatments("sandgestrahlt").surface[0]).toEqual(expect.objectContaining({ kind: "tryskani", detail: "pískování" }));
    expect(kinds(parseTreatments("ENP 20 µm")).surface).toEqual(["chemicky_nikl"]);
  });
});

describe("recenze 10 — hloubka vrstvy u běžného zápisu", () => {
  it.each([
    ["cementovat 0,8 mm", "cementace", "0,8 mm"],
    ["cementovat a kalit 0,8 mm 58-62 HRC", "cementace", "0,8 mm"],
    ["cementováno hl. 0,6-0,8", "cementace", "0,6-0,8 mm"],
    ["cementovat do hl. 1 mm", "cementace", "1 mm"],
    ["Einsatzhärten 0,8 mm", "cementace", "0,8 mm"],
    ["Nitridovat 0,3 mm 600 HV", "nitridace", "0,3 mm"],
    ["Gasnitriert 0,3 mm", "nitridace", "0,3 mm"],
    ["povrchově kalit 50 HRC, hl. 1,5 mm", "indukcni_kaleni", "1,5 mm"],
  ])("%s → %s, hloubka %s", (text, kind, depth) => {
    expect(parseTreatments(text).heat.find((h) => h.kind === kind)?.depth).toBe(depth);
  });
  it("„CHD 550HV1 0,8-1,0“: 550 HV1 je mezní tvrdost (detail), ne tvrdost povrchu", () => {
    const r = parseTreatments("CHD 550HV1 0,8-1,0");
    expect(r.heat).toEqual([expect.objectContaining({ kind: "cementace", depth: "0,8-1 mm", detail: "mezní tvrdost 550 HV1" })]);
    expect(r.heat[0].hardness).toBeUndefined();
    expect(r.hardness).toEqual([]);
  });
  it("mezní tvrdost v závorce za hloubkou; HRC za hloubkou zůstává tvrdostí povrchu", () => {
    const r = parseTreatments("Eht 0,8+0,3 mm (550 HV1), 58-62 HRC");
    expect(r.heat[0]).toEqual(expect.objectContaining({ depth: "0,8-1,1 mm", hardness: "58-62 HRC", detail: "mezní tvrdost 550 HV1" }));
    expect(parseTreatments("Eht 0,6-0,8 mm 58-62 HRC").heat[0].hardness).toBe("58-62 HRC");
  });
  it("hloubka se nepřiřadí zpracování před jiným zpracováním s vrstvou", () => {
    const r = parseTreatments("nitridovat, cementovat 0,8 mm");
    expect(r.heat.find((h) => h.kind === "nitridace")?.depth).toBeUndefined();
    expect(r.heat.find((h) => h.kind === "cementace")?.depth).toBe("0,8 mm");
  });
});

describe("recenze 11 — galvanický vs. žárový zinek", () => {
  it.each([
    ["zinkovat galvanicky 8 µm", "galvanicky_zinek", "8 µm"],
    ["galv. zinek 8 µm, žlutá pasivace", "galvanicky_zinek", "8 µm, žlutá pasivace"],
    ["Galvanic zinc 8µm", "galvanicky_zinek", "8 µm"],
    ["galv. verzinkt Fe/Zn 8", "galvanicky_zinek", "8 µm"],
    ["zinkovat 8 µm", "galvanicky_zinek", "8 µm"],
    ["zinkovat žárově", "zinkovani", "žárové"],
    ["zinkovat 80 µm", "zinkovani", "80 µm"],
  ])("%s → %s (%s)", (text, kind, detail) => {
    expect(parseTreatments(text).surface).toEqual([expect.objectContaining({ kind, detail })]);
  });
});
