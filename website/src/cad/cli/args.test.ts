import { describe, expect, it } from "vitest";
import { parseArgs, parseFormats, parseStrict, UsageError, usageText, type RunArgs, type ServeArgs } from "./args";

const run = (...a: string[]) => parseArgs(["run", ...a]) as RunArgs;
const serve = (...a: string[]) => parseArgs(["serve", ...a]) as ServeArgs;
const usage = (argv: string[]) => {
  try {
    parseArgs(argv);
  } catch (e) {
    expect(e).toBeInstanceOf(UsageError);
    return (e as Error).message;
  }
  throw new Error(`no UsageError for ${argv.join(" ")}`);
};

describe("mncad run – volby", () => {
  it("výchozí hodnoty (kap. 3.1)", () => {
    const a = run("skript.txt");
    expect(a).toMatchObject({ cmd: "run", script: "skript.txt", out: "mncad-out", strict: false, share: false, shareDays: 10, formats: "auto", allDocs: false, open: [], json: false, full: false, notes: false, budget: 2048, timeout: 300, maxMem: 2048, progress: false, noOutputOnError: false });
  });
  it("všechny volby v obou zápisech (--x v a --x=v)", () => {
    const a = run("-", "--out", "/tmp/o", "--strict=kromě select.ambiguous,hole.depth-default", "--share=drawing", "--share-days", "30", "--share-store=http://127.0.0.1:8765/cad/share/", "--formats", "step,pdf,stp", "--doc", "Nástroj", "--all-docs", "--open", "a.mncad", "b.step", "--files", "in", "--resume", "s.mncad-ws", "--json", "--full", "--notes", "--budget=1500", "--lang", "de", "--timeout", "120", "--max-mem", "1800", "--progress", "--no-output-on-error");
    expect(a).toMatchObject({ script: "-", out: "/tmp/o", strict: { except: ["select.ambiguous", "hole.depth-default"] }, share: "drawing", shareDays: 30, shareStore: "http://127.0.0.1:8765/cad/share/", formats: ["step", "pdf"], doc: "Nástroj", allDocs: true, open: ["a.mncad", "b.step"], files: "in", resume: "s.mncad-ws", json: true, full: true, notes: true, budget: 1500, lang: "de", timeout: 120, maxMem: 1800, progress: true, noOutputOnError: true });
  });
  it("--share bez hodnoty nepohltí skript; --share model; --open končí u další volby", () => {
    expect(run("--share", "skript.txt")).toMatchObject({ share: "model", script: "skript.txt" });
    expect(run("skript.txt", "--share", "model")).toMatchObject({ share: "model" });
    expect(run("skript.txt", "--share", "výkres")).toMatchObject({ share: "drawing" });
    expect(run("skript.txt", "--open", "a", "b.mncad", "--json")).toMatchObject({ open: ["a", "b.mncad"], json: true });
  });
  it("--open nepohltí skript: první hodnota vždy, další jen s příponou dokumentu (i po --open=…)", () => {
    expect(run("--open", "asm.mncad", "k.txt")).toMatchObject({ open: ["asm.mncad"], script: "k.txt" });
    expect(run("--open=asm.mncad", "k.txt")).toMatchObject({ open: ["asm.mncad"], script: "k.txt" });
    expect(run("--open", "a.mncad", "B.STEP", "ref.dxf", "k.txt", "--json")).toMatchObject({ open: ["a.mncad", "B.STEP", "ref.dxf"], script: "k.txt", json: true });
    expect(run("--open", "a.mncad", "-")).toMatchObject({ open: ["a.mncad"], script: "-" });
    expect(run("--open", "bez-pripony", "k.txt")).toMatchObject({ open: ["bez-pripony"], script: "k.txt" });
    expect(run("--open", "a.mncad", "--open", "b.json", "k.txt")).toMatchObject({ open: ["a.mncad", "b.json"], script: "k.txt" });
    expect(() => run("k.txt", "--open")).toThrow(UsageError);
    expect(() => run("k.txt", "--open", "-")).toThrow(UsageError);
    expect(() => run("k.txt", "--open=")).toThrow(UsageError);
    expect(run("--timeout", "0", "skript.txt").timeout).toBe(0);
  });
  it("chyby použití → UsageError (kód 3)", () => {
    expect(usage(["run"])).toMatch(/chybí skript/);
    expect(usage(["run", "a.txt", "b.txt"])).toMatch(/nadbytečný/);
    expect(usage(["run", "a.txt", "--neni"])).toMatch(/--neni/);
    expect(usage(["run", "a.txt", "--out"])).toMatch(/chybí hodnota/);
    expect(usage(["run", "a.txt", "--out", "--json"])).toMatch(/chybí hodnota/);
    expect(usage(["run", "a.txt", "--json=1"])).toMatch(/nemá hodnotu/);
    expect(usage(["run", "a.txt", "--timeout", "1.5"])).toMatch(/celé číslo/);
    expect(usage(["run", "a.txt", "--share-days", "91"])).toMatch(/rozsah/);
    expect(usage(["run", "a.txt", "--formats", "doc"])).toMatch(/neznámý formát/);
    expect(usage(["run", "a.txt", "--lang", "fr"])).toMatch(/jazyk/);
    expect(usage(["run", "a.txt", "--share=3d"])).toMatch(/pohled/);
    expect(usage(["run", "a.txt", "--strict=Neni Kod"])).toMatch(/kód/);
    expect(usage(["run", "a.txt", "--share-store", "ftp://x"])).toMatch(/http/);
    expect(usage(["run", "a.txt", "--out", "a", "--out", "b"])).toMatch(/dvakrát/);
    expect(usage(["frobnicate"])).toMatch(/neznámý příkaz/);
  });
});

describe("mncad serve, help, version, selftest", () => {
  it("serve – výchozí hodnoty a volby", () => {
    expect(serve()).toMatchObject({ port: 8787, host: "127.0.0.1", jobs: 1, maxMem: 2048, timeout: 300, allowRemote: false, allowHosts: [], idleTimeout: 900 });
    expect(serve("--port", "0", "--jobs", "2", "--allow-remote", "--allow-host", "cad.local,10.0.0.5", "--token-file", "t", "--host", "0.0.0.0", "--out", "o", "--idle-timeout", "5")).toMatchObject({ port: 0, jobs: 2, allowRemote: true, allowHosts: ["cad.local", "10.0.0.5"], tokenFile: "t", host: "0.0.0.0", out: "o", idleTimeout: 5 });
    expect(usage(["serve", "--jobs", "0"])).toMatch(/rozsah/);
    expect(usage(["serve", "x"])).toMatch(/nadbytečný/);
  });
  it("help / version / selftest", () => {
    expect(parseArgs([])).toMatchObject({ cmd: "help", topic: [] });
    expect(parseArgs(["help", "guide"])).toMatchObject({ cmd: "help", topic: ["guide"] });
    expect(parseArgs(["--version"])).toMatchObject({ cmd: "version", json: false });
    expect(parseArgs(["selftest", "--json", "--lang", "en"])).toMatchObject({ cmd: "selftest", json: true, lang: "en", timeout: 120 });
    expect(usageText()).toMatch(/mncad run <skript\.txt\|->/);
    expect(usageText()).toMatch(/130/);
  });
  it("parseStrict / parseFormats", () => {
    expect(parseStrict(undefined)).toBe(false);
    expect(parseStrict(true)).toBe(true);
    expect(parseStrict("except clash.real")).toEqual({ except: ["clash.real"] });
    expect(parseStrict("außer:a.b,c-d")).toEqual({ except: ["a.b", "c-d"] });
    expect(parseStrict("")).toBe(true);
    expect(parseFormats(undefined)).toBe("auto");
    expect(parseFormats("NONE")).toBe("none");
    expect(parseFormats("step, step,mncad")).toEqual(["step", "mncad"]);
  });
});
