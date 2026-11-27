/**
 * Vlna 22, bod 23 („fungoval softwarový náhled, řez a video v řezu“ – ponechat v regresních testech; majitel testoval BEZ WebGL):
 * e2e sada balíku V (cad-w22-v) musí průchod bez WebGL pouštět v KAŽDÉM standardním volání. Dřív ho pouštěla jen s E2E_NOGL=1,
 * řetězce e2e ho nevolaly, a video v řezu bez WebGL tak v kolech nehlídalo nic (log bez jediného řádku „(bez WebGL)“).
 *  - výchozí volání = oba průchody (WebGL i bez WebGL), E2E_NOGL=1 / 0 = jen jeden, jiná hodnota = chyba (ne tichý výchozí stav);
 *  - sada bere průchody z e2e/lib/gl-passes.cjs (ne z vlastní konstanty jen pro jeden průchod) a každou kontrolu průchodu bez
 *    WebGL označí „(bez WebGL)“; průchod, který nic nezkontroloval, je FAIL.
 */
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { describe, expect, it } from "vitest";

type Pass = { id: string; nogl: boolean; args: string[]; tag: string };
const req = createRequire(import.meta.url);
const { glPasses } = req("../../../e2e/lib/gl-passes.cjs") as { glPasses: (env: Record<string, string | undefined>) => Pass[] };
const SUITE = readFileSync(path.join(path.dirname(new URL(import.meta.url).pathname), "../../../e2e/cad-w22-v.e2e.cjs"), "utf8");

describe("bod 23: průchod bez WebGL v každém standardním běhu cad-w22-v", () => {
  it("bez proměnné prostředí běží oba průchody – WebGL i bez WebGL", () => {
    const ps = glPasses({});
    expect(ps.map((p) => p.id)).toEqual(["webgl", "nogl"]);
    const nogl = ps.find((p) => p.nogl)!;
    expect(nogl.args).toContain("--disable-webgl");
    expect(nogl.args).toContain("--disable-webgl2");
    expect(nogl.tag).toBe(" (bez WebGL)");
    expect(ps.find((p) => !p.nogl)!.args.some((a) => /disable-webgl/.test(a))).toBe(false);
    expect(glPasses({ E2E_NOGL: "" }).map((p) => p.id)).toEqual(["webgl", "nogl"]);
  });
  it("E2E_NOGL=1 / 0 zúží na jeden průchod, neznámá hodnota je chyba", () => {
    expect(glPasses({ E2E_NOGL: "1" }).map((p) => p.id)).toEqual(["nogl"]);
    expect(glPasses({ E2E_NOGL: "0" }).map((p) => p.id)).toEqual(["webgl"]);
    expect(() => glPasses({ E2E_NOGL: "ano" })).toThrow(/E2E_NOGL/);
  });
  it("sada bere průchody ze sdílené funkce, ne z konstanty jediného průchodu", () => {
    expect(SUITE).toMatch(/require\('\.\/lib\/gl-passes\.cjs'\)/);
    expect(SUITE).toMatch(/glPasses\(process\.env\)/);
    expect(SUITE).toMatch(/for \(const ps of PASSES\)/);
    // dřívější tvar: jeden průchod podle E2E_NOGL, výchozí jen WebGL
    expect(SUITE).not.toMatch(/const NOGL = process\.env\.E2E_NOGL === '1'/);
    expect(SUITE).not.toMatch(/chromium\.launch\(\{ args: NOGL \? NO_GL : GL \}\)/);
  });
  it("každá kontrola nese příponu průchodu a prázdný průchod je FAIL", () => {
    // ok() přidává tag průchodu ke každé zprávě (log obou průchodů je jeden soubor – grep „(bez WebGL)“ musí najít jeho kontroly)
    expect(SUITE).toMatch(/console\.log\(\(c \? 'ok: ' : 'FAIL: '\) \+ m \+ tag\)/);
    expect(SUITE).toMatch(/ok\(\(counts\[ps\.id\] \|\| 0\) > 1/);
    // průchod musí být ten, za který se vydává (WebGL v prohlížeči je / není k dispozici)
    expect(SUITE).toMatch(/ok\(gl === !ps\.nogl/);
  });
});
