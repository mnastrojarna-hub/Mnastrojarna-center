import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { extensionOf, filenameFromDisposition, isViewable3D, sniffFile } from "./sniff";
import { extractPdf3DStreams, pdfHas3D } from "./formats/pdf3d";
import { zlibSync } from "fflate";

const FIX = path.join(__dirname, "__fixtures__");
const enc = (s: string) => new TextEncoder().encode(s);

describe("sniffFile", () => {
  it("STEP podle obsahu i bez přípony, s rozpoznáním AP", () => {
    const step = new Uint8Array(fs.readFileSync(path.join(FIX, "cube.stp")));
    expect(sniffFile(step, null)).toMatchObject({ kind: "model", format: "step" });
    expect(sniffFile(enc("ISO-10303-21;\nHEADER;\nFILE_SCHEMA(('AUTOMOTIVE_DESIGN { 1 0 10303 214 1 1 1 1 }'));"), "x.bin").label).toBe("STEP (AP214)");
    expect(sniffFile(enc("ISO-10303-21;\nFILE_SCHEMA(('AP242_MANAGED_MODEL_BASED_3D_ENGINEERING_MIM_LF'));"), "DIL.STP").label).toBe("STEP (AP242)");
  });

  it("IGES, STL (binární i text), PDF, obrázky", () => {
    expect(sniffFile(new Uint8Array(fs.readFileSync(path.join(FIX, "cube-10mm.igs"))), "Cube.IGS")).toMatchObject({ kind: "model", format: "iges" });
    expect(sniffFile(new Uint8Array(fs.readFileSync(path.join(FIX, "cube-10mm.stl"))), "a.stl")).toMatchObject({ kind: "model", format: "stl" });
    const bin = new Uint8Array(84 + 50);
    new DataView(bin.buffer).setUint32(80, 1, true);
    expect(sniffFile(bin, "neco")).toMatchObject({ kind: "model", format: "stl" });
    expect(sniffFile(enc("%PDF-1.7\n..."), "doc")).toMatchObject({ kind: "pdf" });
    expect(sniffFile(new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0, 0]), null)).toMatchObject({ kind: "image" });
    expect(sniffFile(new Uint8Array([0xff, 0xd8, 0xff, 0xe0]), "foto")).toMatchObject({ kind: "image" });
  });

  it("neznámé typy podle přípony / jako nepodporované", () => {
    expect(sniffFile(enc("PK\u0003\u0004..."), "nabidka.docx")).toMatchObject({ kind: "unsupported", label: "DOCX" });
    expect(sniffFile(enc("hello"), "poznamka.txt")).toMatchObject({ kind: "text" });
    expect(sniffFile(enc("solid x\nendsolid"), "model.glb").kind).toBe("model");
  });

  it("pomocné funkce", () => {
    expect(extensionOf("DIL_01.STEP")).toBe("step");
    expect(isViewable3D("a.stp")).toBe(true);
    expect(isViewable3D("a.sldprt")).toBe(false);
    expect(filenameFromDisposition(`attachment; filename="a.pdf"; filename*=UTF-8''v%C3%BDkres.pdf`)).toBe("výkres.pdf");
    expect(filenameFromDisposition(`inline; filename="kostka.step"`)).toBe("kostka.step");
    expect(filenameFromDisposition(null)).toBeNull();
  });
});

describe("3D PDF — vytažení proudu", () => {
  function pdfWith3D(kind: "U3D" | "PRC", payload: Uint8Array, opts: { flate?: boolean; indirectLength?: boolean } = {}): Uint8Array {
    const body = opts.flate ? zlibSync(payload) : payload;
    const filter = opts.flate ? " /Filter /FlateDecode" : "";
    const len = opts.indirectLength ? "9 0 R" : String(body.length);
    const head = enc(`%PDF-1.6\n1 0 obj\n<< /Type /Catalog >>\nendobj\n5 0 obj\n<< /Type /3D /Subtype /${kind} /Length ${len}${filter} >>\nstream\n`);
    const tail = enc(`\nendstream\nendobj\n9 0 obj\n${body.length}\nendobj\n6 0 obj\n<< /Type /Annot /Subtype /3D /3DD 5 0 R >>\nendobj\ntrailer\n<< /Root 1 0 R >>\n%%EOF\n`);
    const out = new Uint8Array(head.length + body.length + tail.length);
    out.set(head, 0);
    out.set(body, head.length);
    out.set(tail, head.length + body.length);
    return out;
  }

  it("najde U3D proud (FlateDecode, délka odkazem)", () => {
    const payload = new Uint8Array([0x55, 0x33, 0x44, 0x00, 1, 2, 3, 4, 0x0a, 0x0d, 9]);
    const pdf = pdfWith3D("U3D", payload, { flate: true, indirectLength: true });
    expect(pdfHas3D(pdf)).toBe(true);
    const s = extractPdf3DStreams(pdf);
    expect(s).toHaveLength(1);
    expect(s[0].kind).toBe("u3d");
    expect([...s[0].data]).toEqual([...payload]);
  });

  it("najde PRC proud bez filtru", () => {
    const payload = enc("PRC\u0008\u0000binary");
    const s = extractPdf3DStreams(pdfWith3D("PRC", payload));
    expect(s[0].kind).toBe("prc");
    expect(new TextDecoder().decode(s[0].data)).toBe("PRC\u0008\u0000binary");
  });

  it("běžné PDF 3D nemá", () => {
    const plain = enc("%PDF-1.4\n1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n%%EOF");
    expect(pdfHas3D(plain)).toBe(false);
    expect(extractPdf3DStreams(plain)).toHaveLength(0);
  });
});
