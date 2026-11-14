import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { MissingInputError, OutPathError } from "../engine/host";
import { CliFileSink, CliFileSource, confinedPath, isInside } from "./file-sink";

let tmp: string;
beforeAll(() => {
  tmp = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "mncad-sink-")));
});
afterAll(() => fs.rmSync(tmp, { recursive: true, force: true }));

const enc = (s: string) => new TextEncoder().encode(s);
const w = (sink: CliFileSink, name: string, data = "x") => sink.write({ name, mime: "text/plain", data: enc(data), doc: "D", format: "txt" });

describe("CliFileSink – zápis jen do realpath(--out)", () => {
  it("očistí názvy a nikdy nezapíše mimo složku", async () => {
    const out = path.join(tmp, "out1");
    const sink = CliFileSink.create(out);
    const names = ["../../evil.txt", "a/b\\c.txt", "C:\\Windows\\x.txt", "nul\u0000byte.txt", "/etc/passwd", "..\\..\\x.txt", " . lead.txt", "Díl 1 výkres.pdf"];
    for (const n of names) {
      const f = await w(sink, n);
      expect(path.dirname(f.path!)).toBe(fs.realpathSync(out));
      expect(f.name).not.toMatch(/[/\\:\u0000]/);
      expect(fs.readFileSync(f.path!, "utf8")).toBe("x");
    }
    expect(fs.existsSync(path.join(tmp, "evil.txt"))).toBe(false);
    expect(sink.written.map((f) => f.name)).toContain("Díl 1 výkres.pdf");
    await expect(w(sink, "..")).rejects.toBeInstanceOf(OutPathError);
    await expect(w(sink, "///")).rejects.toBeInstanceOf(OutPathError);
  });
  it("existující soubor → „ (2)“, zaznamenané přejmenování; SHA-256 a velikost", async () => {
    const sink = CliFileSink.create(path.join(tmp, "out2"));
    const a = await w(sink, "Díl.step", "aaa");
    const b = await w(sink, "Díl.step", "bbbb");
    const c = await w(sink, "Díl.step", "c");
    expect([a.name, b.name, c.name]).toEqual(["Díl.step", "Díl (2).step", "Díl (3).step"]);
    expect(sink.renamed).toEqual([
      { from: "Díl.step", to: "Díl (2).step" },
      { from: "Díl.step", to: "Díl (3).step" },
    ]);
    expect(b.bytes).toBe(4);
    expect(a.sha256).toBe("9834876dcfb05cb167a5c24953eba58c4ac89b1adf57f28f2f9d09af107ee8f0");
  });
  it("symbolický odkaz ve výstupní složce se nenásleduje (O_EXCL) a writeFixed ho nahradí, cíl zůstane", async () => {
    const out = path.join(tmp, "out3");
    const sink = CliFileSink.create(out);
    const target = path.join(tmp, "outside-target.txt");
    fs.writeFileSync(target, "SECRET");
    fs.symlinkSync(target, path.join(out, "Díl.step"));
    const f = await w(sink, "Díl.step", "new");
    expect(f.name).toBe("Díl (2).step");
    expect(fs.readFileSync(target, "utf8")).toBe("SECRET");
    fs.symlinkSync(target, path.join(out, "session.mncad-ws"));
    const p = sink.writeFixed("session.mncad-ws", enc("{}"));
    expect(fs.lstatSync(p).isSymbolicLink()).toBe(false);
    expect(fs.readFileSync(p, "utf8")).toBe("{}");
    expect(fs.readFileSync(target, "utf8")).toBe("SECRET");
    expect(() => sink.writeFixed("../x.txt", "a")).not.toThrow();
    expect(fs.existsSync(path.join(tmp, "x.txt"))).toBe(false);
  });
  it("výstupní složka přes symbolický odkaz = její realpath", () => {
    const real = path.join(tmp, "realout");
    fs.mkdirSync(real);
    fs.symlinkSync(real, path.join(tmp, "linkout"));
    expect(CliFileSink.create(path.join(tmp, "linkout")).root).toBe(real);
    expect(confinedPath(real, "a.txt").path).toBe(path.join(real, "a.txt"));
    expect(isInside(real, path.join(real, "..", "x"))).toBe(false);
  });
});

describe("CliFileSource – jen --files DIR, složka skriptu a výslovné soubory", () => {
  it("čte uvnitř kořenů, odmítne únik ../, absolutní cestu ven a odkaz ven", async () => {
    const root = path.join(tmp, "in");
    fs.mkdirSync(path.join(root, "sub"), { recursive: true });
    fs.writeFileSync(path.join(root, "a.mncad"), "A");
    fs.writeFileSync(path.join(root, "sub", "b.txt"), "B");
    fs.writeFileSync(path.join(tmp, "secret.txt"), "S");
    fs.symlinkSync(path.join(tmp, "secret.txt"), path.join(root, "link.txt"));
    const explicit = path.join(tmp, "explicit.mncad");
    fs.writeFileSync(explicit, "E");
    const src = new CliFileSource([root, path.join(tmp, "does-not-exist")], [explicit]);
    expect(new TextDecoder().decode((await src.read("a.mncad")).data)).toBe("A");
    expect(new TextDecoder().decode((await src.read("sub/b.txt")).data)).toBe("B");
    expect(new TextDecoder().decode((await src.read(explicit)).data)).toBe("E");
    expect(new TextDecoder().decode((await src.read("explicit.mncad")).data)).toBe("E");
    for (const bad of ["../secret.txt", path.join(tmp, "secret.txt"), "link.txt", "/etc/passwd", "sub/../../secret.txt", "", "a\u0000.mncad"]) {
      await expect(src.read(bad), bad).rejects.toBeInstanceOf(MissingInputError);
    }
    expect(src.list()).toEqual(["a.mncad", "explicit.mncad"]); // odkaz ven se ani nevypíše
  });
  it("chybějící výslovný soubor (--open) není v seznamu dostupných", async () => {
    const root = path.join(tmp, "in2");
    fs.mkdirSync(root, { recursive: true });
    fs.writeFileSync(path.join(root, "plate.mncad"), "P");
    const src = new CliFileSource([], [path.join(tmp, "nothere.mncad"), path.join(root, "plate.mncad")]);
    expect(src.list()).toEqual(["plate.mncad"]);
    await expect(src.read("nothere.mncad")).rejects.toThrow("soubor „nothere.mncad“ není k dispozici – dostupné: plate.mncad");
  });
});
