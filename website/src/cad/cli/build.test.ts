/**
 * Svazek CLI (scripts/cad-cli-build.mjs): graf modulů nesmí obsahovat `src/cad/client.ts` ani `src/components/**`
 * (ani dynamickým importem, který ESLint podle zápisu nepozná), tar pro `npx` a seznam balíků pro licence.
 */
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import { builtinModules } from "node:module";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import zlib from "node:zlib";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

type BuildModule = {
  ROOT: string;
  forbiddenModules(ids: string[], src?: string): string[];
  bundle(o: { outFile: string; entryCode?: string; minify?: boolean }): Promise<{ moduleIds: string[]; externals: string[]; bytes: number; ms: number }>;
  makeTar(entries: { name: string; data: Buffer; mode?: number }[]): Buffer;
  packagesOf(ids: string[]): [string, string][];
  parseBuildArgs(argv: string[]): { outRoot: string; keep: number; ifStale: boolean; tgz: boolean; quiet: boolean; run: string[] | null };
};
const SCRIPT = path.resolve(__dirname, "../../../scripts/cad-cli-build.mjs");
let m: BuildModule;
let tmp: string;
beforeAll(async () => {
  m = (await import(/* @vite-ignore */ pathToFileURL(SCRIPT).href)) as BuildModule;
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), "mncad-build-"));
});
afterAll(() => fs.rmSync(tmp, { recursive: true, force: true }));

describe("graf modulů svazku CLI", () => {
  it("forbiddenModules: client.ts a components/** (i s ?query a zpětnými lomítky)", () => {
    const src = path.join(m.ROOT, "src");
    const ids = [path.join(src, "cad/cli/main.ts"), path.join(src, "cad/client.ts"), path.join(src, "components/cad/cad-app.tsx") + "?x", path.join(src, "cad/client-tools.ts"), "/x/node_modules/react/index.js"];
    expect(m.forbiddenModules(ids, src).map((x) => path.relative(src, x))).toEqual(["cad/client.ts", "components/cad/cad-app.tsx"]);
  });
  it("sestavení selže, když graf obsahuje client.ts (statický import) nebo components (dynamický import)", async () => {
    const out = path.join(tmp, "bad.mjs");
    await expect(m.bundle({ outFile: out, minify: false, entryCode: `import { cad } from "@/cad/client";\nconsole.log(Object.keys(cad));\n` })).rejects.toThrow(/zakázané moduly.*src\/cad\/client\.ts/s);
    await expect(m.bundle({ outFile: out, minify: false, entryCode: `const p = "x";\nexport const f = () => import("@/components/cad/agent-api-host");\nconsole.log(p, f);\n` })).rejects.toThrow(/zakázané moduly.*src\/components\//s);
    expect(fs.existsSync(out)).toBe(false);
  });
  it("skutečný svazek: vstup cli/main.ts + nezměněný cad.worker.ts, bez client.ts a components; jen node: externí", async () => {
    const out = path.join(tmp, "mncad.mjs");
    const r = await m.bundle({ outFile: out });
    const rel = r.moduleIds.map((id) => path.relative(m.ROOT, id).replace(/\\/g, "/"));
    expect(rel).toContain("src/cad/cli/main.ts");
    expect(rel).toContain("src/cad/cli/job.ts");
    expect(rel).toContain("src/cad/cad.worker.ts");
    expect(rel).not.toContain("src/cad/client.ts");
    expect(rel.filter((x) => x.startsWith("src/components/"))).toEqual([]);
    expect(rel.some((x) => /node_modules\/replicad-opencascadejs\//.test(x))).toBe(true);
    const code = fs.readFileSync(out, "utf8");
    expect(code.startsWith("#!/usr/bin/env node\n")).toBe(true);
    // jediné externí moduly jsou vestavěné moduly Node (svazek běží ve složce bez node_modules)
    expect(r.externals.length).toBeGreaterThan(0);
    expect(r.externals.filter((s) => !s.startsWith("node:") && !builtinModules.includes(s))).toEqual([]);
    expect(r.bytes).toBeGreaterThan(1_000_000);
  }, 60_000);
});

describe("distribuce", () => {
  it("makeTar: ustar s package/…, práva bin 755, obsah beze změny (ověřeno systémovým tar)", () => {
    const tgz = path.join(tmp, "p.tgz");
    const big = Buffer.alloc(1300, 7);
    fs.writeFileSync(tgz, zlib.gzipSync(m.makeTar([
      { name: "package/mncad.mjs", data: Buffer.from("#!/usr/bin/env node\n"), mode: 0o755 },
      { name: "package/fonts/Roboto-Bold.ttf", data: big },
      { name: "package/package.json", data: Buffer.from('{"name":"mncad"}') },
    ])));
    const list = execFileSync("tar", ["-tvzf", tgz], { encoding: "utf8" });
    expect(list).toMatch(/-rwxr-xr-x .* package\/mncad\.mjs/);
    expect(list).toMatch(/1300 .* package\/fonts\/Roboto-Bold\.ttf/);
    const x = path.join(tmp, "x");
    fs.mkdirSync(x);
    execFileSync("tar", ["-xzf", tgz, "-C", x]);
    expect(fs.readFileSync(path.join(x, "package/fonts/Roboto-Bold.ttf")).equals(big)).toBe(true);
    expect(fs.readFileSync(path.join(x, "package/package.json"), "utf8")).toBe('{"name":"mncad"}');
  });
  it("parseBuildArgs: volby sestavení jen před --run (npm run mncad -- run k.txt --out DIR nesestaví distribuci do DIR)", () => {
    const dflt = path.join(m.ROOT, "public", "cad", "cli");
    expect(m.parseBuildArgs(["--if-stale", "--run", "run", "k.txt", "--out", "/tmp/o-npm3", "--formats", "none", "--keep", "9"])).toEqual({ outRoot: dflt, keep: 2, ifStale: true, tgz: true, quiet: false, run: ["run", "k.txt", "--out", "/tmp/o-npm3", "--formats", "none", "--keep", "9"] });
    expect(m.parseBuildArgs(["--out", "/tmp/dist", "--keep", "3", "--no-tgz", "--quiet"])).toEqual({ outRoot: "/tmp/dist", keep: 3, ifStale: false, tgz: false, quiet: true, run: null });
    expect(m.parseBuildArgs(["--out", "/tmp/dist", "--if-stale", "--run", "version"])).toMatchObject({ outRoot: "/tmp/dist", ifStale: true, run: ["version"] });
  });
  it("packagesOf: balíky npm podle cest modulů (i scoped)", () => {
    expect(m.packagesOf(["/w/node_modules/jspdf/dist/a.js", "/w/node_modules/@node-projects/acad-ts/x.js", "/w/node_modules/jspdf/b.js", "/w/src/cad/x.ts"]).map((p) => p[0])).toEqual(["@node-projects/acad-ts", "jspdf"]);
  });
});
