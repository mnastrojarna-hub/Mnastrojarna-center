/** Port hostitele: očištění názvů (únik z výstupní složky), jedinečné názvy, FileSink/FileSource v paměti, SHA-256. */
import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { FILE_NAME_MAX, MissingInputError, OutPathError, memoryFileSink, memoryFileSource, safeFileName, sha256Hex, uniqueFileName } from "./host";

describe("host – názvy souborů", () => {
  it("safeFileName odstraní cestu a zakázané znaky, název nikdy neobsahuje oddělovač", () => {
    expect(safeFileName("Díl A.step")).toBe("Díl A.step");
    expect(safeFileName("../../etc/passwd")).toBe("_.._etc_passwd");
    expect(safeFileName("/abs/path.pdf")).toBe("_abs_path.pdf");
    expect(safeFileName("C:\\win\\x.dxf")).toBe("C_win_x.dxf");
    expect(safeFileName('a<b>c:"d"|e?f*g\u0000h.step')).toBe("a_b_c_d_e_f_g_h.step");
    expect(safeFileName("  .skryty.step. ")).toBe("skryty.step");
    expect(safeFileName("x".repeat(300)).length).toBe(120);
    for (const n of ["../a", "..\\a", "a/../../b", "/etc/x", "\u0000/x", "a/b/c", "./.x"]) expect(safeFileName(n)).not.toMatch(/[\\/]|^\.\.?$/);
    for (const bad of ["", "..", ".", "...", "   ", "///", "\\\\", "\u0000"]) expect(() => safeFileName(bad), JSON.stringify(bad)).toThrow(OutPathError);
  });
  it("dlouhý název: zkrácení po celých znacích, přípona zůstane, ≤ 120 znaků a ≤ 240 B UTF-8; osamělé náhradní znaky → _", () => {
    const lone = /[\ud800-\udbff](?![\udc00-\udfff])|(?<![\ud800-\udbff])[\udc00-\udfff]/;
    const long = "959-01-00 Nástroj – sestava střižného nástroje pro díl 959-01-00-12 s vodicími sloupky a pružinami (verze 3) final";
    const cases: [string, string][] = [
      ["a".repeat(119) + "😀.pdf", ".pdf"],
      ["x".repeat(200) + ".mncad", ".mncad"],
      [long + " výkres sestavy.step", ".step"],
      ["„Střižník“–".repeat(30) + "výkres.pdf", ".pdf"], // 3 B na znak: bez limitu v bajtech by to bylo 330 B > 255 (ENAMETOOLONG)
      ["😀".repeat(100) + ".dxf", ".dxf"],
      ["y".repeat(300), ""],
    ];
    for (const [raw, ext] of cases) {
      const n = safeFileName(raw);
      expect(n.endsWith(ext), raw.slice(0, 20)).toBe(true);
      expect([...n].length).toBeLessThanOrEqual(FILE_NAME_MAX.chars);
      expect(Buffer.byteLength(n)).toBeLessThanOrEqual(FILE_NAME_MAX.bytes);
      expect(n).not.toMatch(lone);
      expect(n).not.toMatch(/[.\s]\.[a-z]+$/); // žádná tečka / mezera před příponou po zkrácení
      expect(raw.startsWith(n.slice(0, n.length - ext.length))).toBe(true); // začátek názvu beze změny
    }
    expect(safeFileName("a".repeat(119) + "😀.pdf")).toBe("a".repeat(116) + ".pdf");
    expect(safeFileName("Díl\ud800X.step")).toBe("Díl_X.step");
    expect(safeFileName("Díl\u2028X\u0085.step")).toBe("Díl_X_.step");
    expect(safeFileName(long + ".step")).toBe(long + ".step"); // krátký název (119 znaků) beze změny
  });
  it("zapsaný soubor má na disku přesně vrácený název (i po zkrácení a s náhradními znaky)", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "mncad-names-"));
    try {
      const raws = ["a".repeat(119) + "😀.pdf", "„Střižník“–".repeat(30) + "výkres.pdf", "😀".repeat(100) + ".dxf", "Díl\udc00.step", "x".repeat(200) + ".mncad"];
      const names = raws.map((r) => safeFileName(r));
      for (const n of names) fs.writeFileSync(path.join(dir, n), "x");
      expect(fs.readdirSync(dir).sort()).toEqual([...names].sort());
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
  it("uniqueFileName přidá „ (2)“ před příponu", () => {
    const taken = new Set(["Díl.step", "Díl (2).step", "bez"]);
    expect(uniqueFileName("Díl.step", (n) => taken.has(n))).toBe("Díl (3).step");
    expect(uniqueFileName("bez", (n) => taken.has(n))).toBe("bez (2)");
    expect(uniqueFileName("nový.pdf", (n) => taken.has(n))).toBe("nový.pdf");
  });
});

describe("host – soubory v paměti", () => {
  it("memoryFileSink: OutFile s velikostí a SHA-256, očištěné a jedinečné názvy", async () => {
    const sink = memoryFileSink();
    const data = new TextEncoder().encode("ISO-10303-21;");
    const a = await sink.write({ name: "../Díl.step", mime: "model/step", data, doc: "Díl", format: "step" });
    const b = await sink.write({ name: "../Díl.step", mime: "model/step", data, doc: "Díl", format: "step" });
    expect(a).toEqual({ name: "_Díl.step", format: "step", bytes: data.length, sha256: createHash("sha256").update(data).digest("hex"), doc: "Díl" });
    expect(b.name).toBe("_Díl (2).step");
    expect([...sink.files.keys()]).toEqual(["_Díl.step", "_Díl (2).step"]);
    await expect(sink.write({ name: "..", mime: "x", data, doc: "D", format: "step" })).rejects.toThrow(OutPathError);
  });
  it("memoryFileSource čte jen klíče mapy, chybějící = seznam dostupných", async () => {
    const src = memoryFileSource({ "ref.step": new Uint8Array([1, 2]), "b.mncad": new Uint8Array([3]) });
    expect(src.list()).toEqual(["b.mncad", "ref.step"]);
    expect((await src.read("ref.step")).data).toEqual(new Uint8Array([1, 2]));
    const err = await src.read("../ref.step").catch((e: unknown) => e);
    expect(err).toBeInstanceOf(MissingInputError);
    expect((err as MissingInputError).available).toEqual(["b.mncad", "ref.step"]);
    expect((err as Error).message).toBe("soubor „../ref.step“ není k dispozici – dostupné: b.mncad, ref.step");
  });
  it("sha256Hex = node:crypto", async () => {
    for (const s of ["", "abc", "ž".repeat(10000)]) {
      const u = new TextEncoder().encode(s);
      expect(await sha256Hex(u)).toBe(createHash("sha256").update(u).digest("hex"));
    }
  });
});
