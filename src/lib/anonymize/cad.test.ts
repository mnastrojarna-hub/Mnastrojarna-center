import { describe, it, expect } from "vitest";
import { anonymizeDxf, dxfPlainText, parseDxfPairs } from "./dxf";
import { anonymizeStep, decodeStepString, encodeStepString } from "./step";
import { DEFAULT_REDACT, makeTerms, type RuleContext } from "./rules";

const ctx = (terms: string[] = ["STROJMETAL"]): RuleContext => ({ terms: makeTerms(terms, "crm"), keepTerms: ["Mnástrojárna"], redact: { ...DEFAULT_REDACT } });
const enc = (s: string) => new TextEncoder().encode(s);
const dec = (b: Uint8Array | null) => new TextDecoder().decode(b ?? new Uint8Array());

function dxf(pairs: [number, string][]): string {
  return pairs.map(([c, v]) => `${String(c).padStart(3, " ")}\n${v}`).join("\n") + "\n";
}

const SAMPLE = dxf([
  [999, "Vytvořeno: C:\\Users\\novak\\cad\\D-1234.dwg"],
  [0, "SECTION"], [2, "HEADER"],
  [9, "$ACADVER"], [1, "AC1027"],
  [9, "$LASTSAVEDBY"], [1, "novak"],
  [9, "$DWGCODEPAGE"], [3, "ANSI_1250"],
  [0, "ENDSEC"],
  [0, "SECTION"], [2, "TABLES"],
  [0, "STYLE"], [2, "ISO"], [3, "\\\\server\\fonts\\strojmetal.shx"],
  [0, "LAYER"], [2, "LOGO_STROJMETAL"], [70, "0"],
  [0, "ENDSEC"],
  [0, "SECTION"], [2, "ENTITIES"],
  [0, "TEXT"], [8, "0"], [10, "100.0"], [20, "50.0"], [40, "2.5"], [1, "Kreslil: J. Novák"],
  [0, "TEXT"], [8, "0"], [10, "100.0"], [20, "40.0"], [40, "2.5"], [1, "\\U+0161STROJMETAL a.s."],
  [0, "MTEXT"], [8, "0"], [10, "10.0"], [20, "10.0"], [1, "{\\fArial|b1;Firma:} STROJMETAL\\Pinfo@strojmetal.cz"],
  [0, "TEXT"], [8, "0"], [10, "200.0"], [20, "40.0"], [40, "3.5"], [1, "D-1234-01"],
  [0, "TEXT"], [8, "0"], [10, "200.0"], [20, "30.0"], [40, "2.5"], [1, "%%c25 h7"],
  [0, "IMAGE"], [8, "LOGO"], [10, "0.0"], [20, "0.0"], [340, "2F"],
  [0, "LINE"], [8, "0"], [10, "0.0"], [20, "0.0"], [11, "100.0"], [21, "0.0"],
  [0, "ENDSEC"],
  [0, "SECTION"], [2, "OBJECTS"],
  [0, "XRECORD"], [1, "DWGPROPS COOKIE"], [2, "Hřídel"], [4, "Jan Novák"], [300, "Company=STROJMETAL"],
  [0, "PLOTSETTINGS"], [1, "Setup"], [2, "STROJMETAL_A3.pc3"], [7, "strojmetal.ctb"],
  [0, "IMAGEDEF"], [1, "C:\\Loga\\strojmetal.png"],
  [1001, "ACAD"], [1000, "Autor J. Novák"],
  [0, "ENDSEC"],
  [0, "EOF"],
]);

describe("DXF", () => {
  it("smaže texty, komentáře, vlastnosti, cesty a IMAGE; geometrie a technické texty zůstanou; v1 review", () => {
    const r = anonymizeDxf(enc(SAMPLE), ctx());
    expect(r.ok).toBe(true);
    const out = dec(r.bytes);
    // název hladiny se v1 nepřejmenovává (odkazy) — jinde termín nesmí zůstat
    expect(out.replace("LOGO_STROJMETAL", "")).not.toMatch(/strojmetal/i);
    expect(out).not.toContain("Novák");
    expect(out).not.toContain("novak");
    expect(out).not.toContain("C:\\");
    expect(out).toContain("Kreslil:");
    expect(out).toContain("D-1234-01");
    expect(out).toContain("%%c25 h7");
    expect(out).toContain("100.0");
    expect(out).not.toMatch(/^\s*0\nIMAGE$/m);
    expect(r.removedImages).toBe(1);
    // název hladiny s termínem se nepřejmenuje (v1) → review
    expect(r.warnings.some((w) => w.code === "dxf_layer_term")).toBe(true);
    expect(r.warnings.some((w) => w.code === "dxf_graphics")).toBe(true);
    expect(r.verified).toBe(true);
    expect(parseDxfPairs(out)).not.toBeNull();
  });
  it("dekódování \\U+, %%c a formátu MTEXT pro detekci", () => {
    expect(dxfPlainText("\\U+00E1bc %%c10 {\\fArial|b1;Tučně}\\Pdalší")).toBe("ábc Ø10 Tučně další");
  });
  it("binární DXF → unsupported", () => {
    expect(anonymizeDxf(enc("AutoCAD Binary DXF\r\n\u001a\u0000xxxx"), ctx()).unsupported).toBeTruthy();
  });
  it("termín zapsaný \\U+ v textu se najde", () => {
    const r = anonymizeDxf(enc(dxf([[0, "SECTION"], [2, "ENTITIES"], [0, "TEXT"], [1, "Zákazník: STROJMET\\U+0041L"], [0, "ENDSEC"], [0, "EOF"]])), ctx());
    expect(dec(r.bytes)).not.toContain("STROJMET");
  });
});

const STEP = `ISO-10303-21;
HEADER;
/* vytvořil Jan Novak, STROJMETAL */
FILE_DESCRIPTION(('C:\\\\Projekty\\\\Strojmetal\\\\hridel.SLDPRT'),'2;1');
FILE_NAME('C:\\\\Projekty\\\\hridel.step','2026-10-01T10:00:00',('Jan Novak'),('STROJMETAL a.s.'),'SwSTEP 2.0','SolidWorks 2024','Ing. Dvorak');
FILE_SCHEMA(('AUTOMOTIVE_DESIGN'));
ENDSEC;
DATA;
#1=PRODUCT('D-1234-01','Hridel STROJMETAL','vyrobce STROJMETAL a.s., info@strojmetal.cz',(#2));
#2=PRODUCT_CONTEXT('',#3,'mechanical');
#10=PERSON('JN','Novak','Jan',$,$,$);
#11=ORGANIZATION('ORG1','STROJMETAL a.s.','Kladno');
#12=PERSON_AND_ORGANIZATION(#10,#11);
#13=DESCRIPTIVE_REPRESENTATION_ITEM('Company','STROJMETAL');
#14=DESCRIPTIVE_REPRESENTATION_ITEM('Material','1.4301');
#15=DOCUMENT_FILE('D1','C:\\\\cad\\\\x.dwg','',#16,'',$);
#16=TEXT_LITERAL('note','Kreslil: J. Nov\\X2\\00E1\\X0\\k',#17,'',.LEFT.);
/* komentář v DATA: STROJMETAL */
#17=CARTESIAN_POINT('',(0.,0.,0.));
ENDSEC;
END-ISO-10303-21;
`;

describe("STEP", () => {
  it("hlavička, entity osob/organizací, vlastnosti, literály, komentáře; geometrie a materiál zůstanou", () => {
    const r = anonymizeStep(enc(STEP), ctx());
    expect(r.ok).toBe(true);
    const out = dec(r.bytes);
    expect(out).not.toMatch(/strojmetal/i);
    expect(out).not.toMatch(/novak|Nov\\X2/i);
    expect(out).not.toContain("Dvorak");
    expect(out).not.toContain("C:\\\\");
    expect(out).not.toContain("/*");
    expect(out).toContain("FILE_NAME('hridel.step'");
    expect(out).toContain("'D-1234-01'");
    expect(out).toContain("'1.4301'");
    expect(out).toContain("CARTESIAN_POINT('',(0.,0.,0.))");
    expect(out).toContain("'Kreslil:'");
    expect(r.problems).toEqual([]);
    expect(r.termInKeep).toBe(false);
  });
  it("číslo dílu s termínem → review (nemaže se)", () => {
    const r = anonymizeStep(enc(STEP.replace("'D-1234-01'", "'STROJMETAL-1234'")), ctx());
    expect(r.termInKeep).toBe(true);
    expect(dec(r.bytes)).toContain("'STROJMETAL-1234'");
  });
  it("\\X2\\ a '' kódování tam a zpět", () => {
    expect(decodeStepString("Nov\\X2\\00E1\\X0\\k ''x''")).toBe("Novák 'x'");
    expect(decodeStepString(encodeStepString("Hřídel 'A'\\"))).toBe("Hřídel 'A'\\");
  });
  it("doména / právní forma kdekoli (i bez termínu) se smaže", () => {
    const r = anonymizeStep(enc(STEP.replace("'mechanical'", "'acme-gmbh.de'").replace("'Kladno'", "'Huber GmbH'")), ctx([]));
    const out = dec(r.bytes);
    expect(out).not.toContain("acme-gmbh.de");
    expect(out).not.toContain("Huber GmbH");
    expect(r.problems).toEqual([]);
  });
  it("ne-STEP → unsupported", () => {
    expect(anonymizeStep(enc("hello"), ctx()).unsupported).toBeTruthy();
  });
});
