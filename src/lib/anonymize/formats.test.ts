import { describe, it, expect } from "vitest";
import { isAnonCandidate, sourceFormat, unsupportedHowTo, UNSUPPORTED_PREFIX } from "./candidate";
import { anonymizeStl } from "./stl";
import { anonymizeIges } from "./iges";
import { anonymizeDxf, binaryDxfToAscii, parseDxfPairs } from "./dxf";
import { DEFAULT_REDACT, isSuspiciousLiteral, makeTerms, makeWordTerms, ruleLine, type RuleContext } from "./rules";
import { fileAnonLabel, jobAnonBadge } from "@/components/anonymize/anon-status";

/**
 * Formáty mimo PDF / fotky (audit „vždycky tam musí být anonymizace"): STL, IGES, binární DXF, názvy
 * hladin a bloků v DXF, rozpoznání formátu a návody „nelze automaticky". Čisté funkce.
 */

const KEEP = ["Mnástrojárna"];
const ctx = (): RuleContext => ({
  terms: [...makeTerms(["Strojmetal a.s.", "Ing. Jan Dvořák", "strojmetal.cz"], "crm", KEEP), ...makeWordTerms(["Strojmetal a.s."], "crm", KEEP)],
  keepTerms: KEEP, redact: { ...DEFAULT_REDACT },
});
const enc = (s: string) => new TextEncoder().encode(s);
const latin = (b: Uint8Array | null) => Buffer.from(b ?? new Uint8Array()).toString("latin1");

describe("rozpoznání formátu a návod", () => {
  it("obsah má přednost, ZIP jen u .zip / bez přípony (DOCX je také ZIP)", () => {
    const pk = new Uint8Array([0x50, 0x4b, 0x03, 0x04, 0, 0, 0, 0]);
    expect(sourceFormat("podklady.zip", null, pk)).toBe("zip");
    expect(sourceFormat("poptavka.docx", null, pk)).toBe("unsupported");
    expect(sourceFormat("model.3mf", null, pk)).toBe("unsupported");
    expect(sourceFormat("x.bin", null, enc("ISO-10303-21;\nHEADER;"))).toBe("step");
    expect(sourceFormat("x.stl", null, enc("solid x\n"))).toBe("stl");
    expect(sourceFormat("x.IGS", null, enc("     S      1"))).toBe("iges");
    expect(sourceFormat("poptavka.eml", "message/rfc822")).toBe("eml");
    expect(sourceFormat("obr.gif", null, enc("GIF89a....."))).toBe("image");
    expect(sourceFormat("IMG_1.HEIC", null, new Uint8Array([0, 0, 0, 24, 0x66, 0x74, 0x79, 0x70, 0x68, 0x65, 0x69, 0x63]))).toBe("heic");
  });

  it.each([
    ["sestava.DWG", /\(DWG\).*PDF nebo DXF/],
    ["dil.SLDPRT", /nativní CAD model.*STEP/],
    ["vykres.slddrw", /výkres z CAD.*PDF nebo DXF/],
    ["poptavka.docx", /dokument Word.*PDF/],
    ["kusovnik.xlsx", /tabulka Excel.*PDF/],
    ["vykresy.rar", /archiv RAR.*ZIP/],
    ["mail.msg", /Outlook.*přílohy/],
    ["logo.bmp", /PNG nebo JPEG/],
    ["neco.xyz", /PDF, DXF nebo STEP/],
  ])("%s → jednořádkový návod", (f, re) => {
    const t = unsupportedHowTo(f);
    expect(t.startsWith(UNSUPPORTED_PREFIX)).toBe(true);
    expect(t).toMatch(re);
    expect(t).not.toContain("\n");
  });

  it("e-mail zákazníka (.eml / .msg) je kandidát, od dodavatele ne", () => {
    expect(isAnonCandidate("korespondence", "a.eml", null, "upload", "zakaznik")).toBe(true);
    expect(isAnonCandidate("korespondence", "a.msg", null, "email", null)).toBe(true);
    expect(isAnonCandidate("korespondence", "a.eml", null, "upload", "dodavatel")).toBe(false);
  });
});

describe("STL", () => {
  it("ASCII: název za solid / endsolid pryč, geometrie beze změny", () => {
    const src = "solid Strojmetal_D-4711_JDvorak\n facet normal 0 0 1\n  outer loop\n   vertex 0 0 0\n   vertex 1 0 0\n   vertex 0 1 0\n  endloop\n endfacet\nendsolid Strojmetal_D-4711_JDvorak\n";
    const r = anonymizeStl(enc(src));
    expect(r.kind).toBe("ascii");
    expect(r.problems).toEqual([]);
    const out = latin(r.bytes);
    expect(out).not.toMatch(/strojmetal|dvorak/i);
    expect(out.split("\n")[0]).toBe("solid");
    expect(out).toContain("vertex 1 0 0");
    expect(r.texts[0].text).toBe("Strojmetal_D-4711_JDvorak");
  });
  it("binární (i s hlavičkou „solid …“ ze SolidWorks): 80 B hlavičky přepsáno, data beze změny", () => {
    const head = enc("solid Exported by Jan Dvorak, Strojmetal a.s.".padEnd(80, " "));
    const body = new Uint8Array(4 + 50);
    new DataView(body.buffer).setUint32(0, 1, true);
    body.set([1, 2, 3, 4, 5], 10);
    const src = new Uint8Array([...head, ...body]);
    const r = anonymizeStl(src);
    expect(r.kind).toBe("binary");
    expect(r.problems).toEqual([]);
    expect(latin(r.bytes!.subarray(0, 80))).not.toMatch(/dvorak|strojmetal/i);
    expect(Array.from(r.bytes!.subarray(80))).toEqual(Array.from(src.subarray(80)));
  });
  it("nesmysl → nelze automaticky", () => {
    expect(anonymizeStl(enc("hello world")).unsupported).toMatch(/^Soubor STL/);
  });
});

function igesFile(): string {
  const line = (data: string, sec: string, n: number) => `${data.padEnd(72).slice(0, 72)}${sec}${String(n).padStart(7)}`;
  const g = "1H,,1H;,20HD-4711-02 Strojmetal,41HC:\\Users\\jdvorak\\Strojmetal\\D-4711-02.igs,15HSolidWorks 2024,10HSwIGES 1.0,32,38,6,308,15,9HD-4711-02,1.,2,2HMM,1,0.01,15H20261029.101200,1E-06,500.,10HJan Dvorak,15HStrojmetal a.s.,11,0,15H20261029.101200;";
  const gl = g.match(/.{1,72}/g)!;
  const p = (data: string, de: number, n: number) => `${data.padEnd(64)}${String(de).padStart(8)}P${String(n).padStart(7)}`;
  return [
    line("Strojmetal a.s. - Ing. Jan Dvorak, jan.dvorak@strojmetal.cz", "S", 1),
    ...gl.map((x, i) => line(x, "G", i + 1)),
    line("     116       1       0       0       0       0       0       000000000", "D", 1),
    line("     116       0       0       1       0                STROJMET       0", "D", 2),
    line("     212       2       0       0       0       0       0       000000100", "D", 3),
    line("     212       0       0       2       0                               0", "D", 4),
    p("116,0.,0.,0.,0,0,0;", 1, 1),
    p("212,1,15,10.,3.,0,0.,0.,0,0,0.,0.,0.,15HStrojmetal a.s.;", 3, 2),
    line(`S      1G      ${gl.length}D      4P      2`, "T", 1),
  ].join("\r\n") + "\r\n";
}

describe("IGES", () => {
  it("start, autor, organizace, soubor, popisky a poznámky pryč — délky řádků a geometrie beze změny", () => {
    const src = igesFile();
    const r = anonymizeIges(enc(src), ctx());
    expect(r.unsupported).toBeUndefined();
    expect(r.problems).toEqual([]);
    const out = latin(r.bytes);
    expect(out.length).toBe(src.length);
    expect(out).not.toMatch(/strojmet|dvorak|jdvorak/i);
    expect(out).toContain("model.igs");
    expect(out).toContain("116,0.,0.,0.,0,0,0;");
    expect(out).toContain("SolidWorks 2024");
    for (const l of out.split("\r\n").filter(Boolean)) expect(l.length).toBe(80);
  });
  it("poškozený globální oddíl (řádek přes 72 znaků) → termín zůstane, kontrola ho chytí (ne „hotovo“)", () => {
    const line = (d: string, s: string, n: number) => `${d.padEnd(72).slice(0, 72)}${s}${String(n).padStart(7)}`;
    const src = [line("1H,,1H;,4HD-1 ,10HD-1.igs   ,2HSW,2HSW,32,38,6,308,15,3HD-1,1.,2,2HMM,1,0.01,", "G", 1),
      line("13H20261029.1012,1E-06,500.,10HJan Dvorak,15HStrojmetal a.s.,11,0;", "G", 2),
      line("     116       1       0       0       0       0       0       000000000", "D", 1)].join("\n") + "\n";
    const r = anonymizeIges(enc(src), ctx());
    if (/strojmetal/i.test(latin(r.bytes))) expect(r.problems.length).toBeGreaterThan(0);
  });
  it("nesmysl / komprimovaný → nelze automaticky (návod STEP)", () => {
    expect(anonymizeIges(enc("hello"), ctx()).unsupported).toMatch(/STEP/);
  });
});

/** Binární DXF R13+ z párů (2bajtové kódy, typ hodnoty podle kódu). */
function binaryDxf(pairs: [number, string | number][]): Uint8Array {
  const parts: number[] = [...enc("AutoCAD Binary DXF\r\n\x1a\0")];
  for (const [code, v] of pairs) {
    parts.push(code & 0xff, (code >> 8) & 0xff);
    if ((code >= 10 && code <= 59) || (code >= 1010 && code <= 1059)) {
      const b = new Uint8Array(8);
      new DataView(b.buffer).setFloat64(0, Number(v), true);
      parts.push(...b);
    } else if ((code >= 60 && code <= 79) || (code >= 270 && code <= 289)) {
      parts.push(Number(v) & 0xff, (Number(v) >> 8) & 0xff);
    } else {
      parts.push(...enc(String(v)), 0);
    }
  }
  return new Uint8Array(parts);
}

describe("DXF", () => {
  it("binární DXF → ASCII → anonymizace (dřív „nelze“)", () => {
    const bin = binaryDxf([
      [0, "SECTION"], [2, "HEADER"], [9, "$ACADVER"], [1, "AC1032"], [9, "$LASTSAVEDBY"], [1, "jdvorak"], [0, "ENDSEC"],
      [0, "SECTION"], [2, "ENTITIES"],
      [0, "TEXT"], [8, "0"], [10, 100.5], [20, 50], [40, 2.5], [1, "Strojmetal a.s."],
      [0, "TEXT"], [8, "0"], [10, 100], [20, 40], [40, 2.5], [1, "Číslo výkresu: D-4711-02"],
      [0, "LINE"], [8, "0"], [10, 0], [20, 0], [11, 123.456789], [21, 0], [62, 7],
      [0, "ENDSEC"], [0, "EOF"],
    ]);
    const ascii = binaryDxfToAscii(bin);
    expect(ascii).not.toBeNull();
    const pairs = parseDxfPairs(latin(ascii))!.pairs;
    expect(pairs.find((p) => p.code === 11)?.raw).toBe("123.456789");
    const r = anonymizeDxf(bin, ctx());
    expect(r.unsupported).toBeUndefined();
    expect(r.verified).toBe(true);
    const out = latin(r.bytes);
    expect(out).not.toMatch(/strojmetal|jdvorak/i);
    expect(out).toContain("D-4711-02");
    expect(out).toContain("123.456789");
  });
  it("blok a hladina s firmou: přejmenované jednotně i v odkazech, vlastní vlastnosti výkresu prázdné", () => {
    const dxf = ([
      [0, "SECTION"], [2, "HEADER"], [9, "$ACADVER"], [1, "AC1032"], [9, "$CUSTOMPROPERTYTAG"], [1, "Firma"], [9, "$CUSTOMPROPERTY"], [1, "Ing. Petr Zákazník"], [0, "ENDSEC"],
      [0, "SECTION"], [2, "TABLES"], [0, "LAYER"], [2, "Strojmetal razitko"], [70, "0"], [0, "ENDSEC"],
      [0, "SECTION"], [2, "BLOCKS"], [0, "BLOCK"], [8, "0"], [2, "RAZITKO_STROJMETAL"], [70, "2"], [0, "ENDBLK"], [0, "ENDSEC"],
      [0, "SECTION"], [2, "ENTITIES"], [0, "INSERT"], [8, "Strojmetal razitko"], [2, "RAZITKO_STROJMETAL"], [10, "0.0"], [20, "0.0"], [0, "ENDSEC"],
      [0, "SECTION"], [2, "OBJECTS"], [0, "DICTIONARYVAR"], [100, "DictionaryVariables"], [1, "1"], [0, "ENDSEC"],
      [0, "EOF"],
    ] as [number, string][]).map(([c, v]) => `${String(c).padStart(3)}\n${v}`).join("\n") + "\n";
    const r = anonymizeDxf(enc(dxf), ctx());
    expect(r.problems).toEqual([]);
    const out = new TextDecoder().decode(r.bytes!);
    expect(out).not.toMatch(/strojmetal|Zákazník/i);
    // odkazy sedí: INSERT → stejný název bloku i hladiny jako v tabulkách
    const pairs = parseDxfPairs(out)!.pairs;
    const after = (code: number, ent: string) => { const i = pairs.findIndex((p) => p.code === 0 && p.raw.trim() === ent); return pairs.slice(i + 1).find((p) => p.code === code)!.raw.trim(); };
    expect(after(2, "BLOCK")).toMatch(/^RAZITKO/);
    expect(after(2, "INSERT")).toBe(after(2, "BLOCK"));
    expect(after(8, "INSERT")).toBe(after(2, "LAYER"));
    expect(after(2, "LAYER")).toMatch(/^razitko/);
    // „DictionaryVariables" není DIČ (dřív falešný nález → „zbyl citlivý text")
    expect(out).toContain("DictionaryVariables");
    expect(r.warnings.some((w) => w.code === "dxf_layer_term")).toBe(false);
  });
});

describe("pravidla", () => {
  it("DIČ / VAT jen s číslem, ne slova jako DICTIONARY / Dictionary", () => {
    const c = ctx();
    expect(ruleLine("DICTIONARYVAR", "title_block", c).hits).toEqual([]);
    expect(ruleLine("DictionaryVariables", "title_block", c).hits).toEqual([]);
    expect(ruleLine("DIČ: CZ12345678", "title_block", c).hits.some((h) => h.rule === "vat")).toBe(true);
    expect(ruleLine("VAT ID DE123456789", "title_block", c).hits.some((h) => h.rule === "vat")).toBe(true);
  });
  it("právní forma naší firmy není podezřelá", () => {
    expect(isSuspiciousLiteral("Výroba pro: Mnástrojárna s.r.o.", KEEP)).toBe(false);
    expect(isSuspiciousLiteral("Výroba pro: ACME s.r.o.", KEEP)).toBe(true);
  });
});

describe("štítky v UI", () => {
  it("nelze automaticky (s návodem) vs. rozbalený archiv", () => {
    const u = fileAnonLabel({ status: "unsupported", reason: unsupportedHowTo("a.dwg") });
    expect(u.label).toBe("Nelze anonymizovat automaticky");
    expect(u.hint).toMatch(/DXF/);
    expect(fileAnonLabel({ status: "unsupported", reason: "Rozbaleno do 3 souborů — anonymizují se jednotlivě." }).label).toBe("Rozbaleno");
    const b = jobAnonBadge({ total: 3, done: 1, review: 0, failed: 0, pending: 0, unsupported: 1, skipped: 1, sendWaiting: 0 })!;
    expect(b.parts.map((p) => p.text)).toContain("1 nelze automaticky");
  });
});
