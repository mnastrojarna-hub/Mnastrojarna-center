import { afterEach, describe, expect, it, vi } from "vitest";
import { browserOf, collectDiagnostics, explainRenderFailure, probeWebGL } from "./diagnostics";

type Ctx = { getExtension: (n: string) => unknown; getParameter: (p: number) => unknown; VENDOR: number; RENDERER: number };
/** falešný dokument s plátnem: `ctx` = co vrátí getContext (null = WebGL nedostupné) */
function fakeDocument(ctx: Ctx | null | (() => never)) {
  const g = globalThis as unknown as { document?: unknown };
  g.document = { createElement: () => ({ getContext: typeof ctx === "function" ? ctx : () => ctx }) };
}
const g = globalThis as unknown as { document?: unknown; navigator?: unknown; window?: unknown };

afterEach(() => {
  delete g.document;
  delete g.navigator;
  delete g.window;
  vi.restoreAllMocks();
});

describe("ověření WebGL", () => {
  it("bez dokumentu / bez kontextu hlásí nedostupnost s důvodem", () => {
    expect(probeWebGL()).toMatchObject({ ok: false, api: null, reason: "mimo prohlížeč" });
    fakeDocument(null);
    const p = probeWebGL();
    expect(p.ok).toBe(false);
    expect(p.reason).toMatch(/neposkytl WebGL/);
  });
  it("výjimka při vytváření kontextu se nešíří, vrací důvod", () => {
    fakeDocument(() => {
      throw new Error("Error creating WebGL context.");
    });
    const p = probeWebGL();
    expect(p.ok).toBe(false);
    expect(p.reason).toContain("Error creating WebGL context");
  });
  it("dostupný kontext: vendor, renderer, rozpoznání softwarového vykreslování", () => {
    fakeDocument({ VENDOR: 1, RENDERER: 2, getExtension: (n) => (n === "WEBGL_debug_renderer_info" ? { UNMASKED_VENDOR_WEBGL: 3, UNMASKED_RENDERER_WEBGL: 4 } : null), getParameter: (p) => ({ 1: "v", 2: "r", 3: "Google Inc.", 4: "ANGLE (Google, Vulkan 1.3 (SwiftShader Device))" })[p] });
    const p = probeWebGL();
    expect(p).toMatchObject({ ok: true, api: "webgl2", vendor: "Google Inc.", software: true });
    expect(p.renderer).toContain("SwiftShader");
    fakeDocument({ VENDOR: 1, RENDERER: 2, getExtension: () => null, getParameter: (p) => ({ 1: "NVIDIA Corporation", 2: "NVIDIA GeForce RTX 3060/PCIe/SSE2" })[p] });
    expect(probeWebGL()).toMatchObject({ ok: true, vendor: "NVIDIA Corporation", software: false });
  });
});

describe("vysvětlení a postup", () => {
  const ua = {
    chrome: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
    edge: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36 Edg/131.0.0.0",
    firefox: "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:133.0) Gecko/20100101 Firefox/133.0",
    safari: "Mozilla/5.0 (Macintosh; Intel Mac OS X 14_5) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Safari/605.1.15",
  };
  it("rozpozná prohlížeč", () => {
    expect(browserOf(ua.chrome)).toBe("chrome");
    expect(browserOf(ua.edge)).toBe("edge");
    expect(browserOf(ua.firefox)).toBe("firefox");
    expect(browserOf(ua.safari)).toBe("safari");
    expect(browserOf("curl/8")).toBe("other");
  });
  it("WebGL nedostupné: česká příčina a kroky podle prohlížeče, vždy i vzdálená plocha, ovladače, jiný prohlížeč, jiné zařízení", () => {
    const f = { error: new Error("Error creating WebGL context."), probe: { ok: false, api: null, vendor: null, renderer: null, software: false, reason: "prohlížeč neposkytl WebGL kontext" } };
    const e = explainRenderFailure(f, ua.chrome);
    expect(e.title).toBe("3D okno nelze spustit");
    expect(e.cause).toMatch(/neposkytl WebGL/);
    expect(e.steps[0]).toMatch(/Chrome.*grafickou akceleraci.*chrome:\/\/gpu/);
    expect(e.steps.join("\n")).toMatch(/vzdálenou plochu/);
    expect(e.steps.join("\n")).toMatch(/ovladač grafické karty/);
    expect(e.steps.join("\n")).toMatch(/jiný prohlížeč/);
    expect(e.steps.join("\n")).toMatch(/jiné zařízení/);
    expect(explainRenderFailure(f, ua.edge).steps[0]).toMatch(/Edge.*edge:\/\/gpu/);
    expect(explainRenderFailure(f, ua.firefox).steps[0]).toMatch(/Firefox.*webgl\.disabled/);
    expect(explainRenderFailure(f, ua.safari).steps[0]).toMatch(/Safari/);
    expect(e.note).toMatch(/nabídky, nápověda/);
  });
  it("ztracený kontext a selhání při dostupném WebGL mají vlastní příčinu", () => {
    const probe = { ok: true, api: "webgl2" as const, vendor: "x", renderer: "GPU", software: false, reason: null };
    expect(explainRenderFailure({ error: new Error("lost"), probe, lost: true }, ua.chrome).title).toBe("3D okno přestalo fungovat");
    expect(explainRenderFailure({ error: new Error("Out of memory"), probe }, ua.chrome).cause).toMatch(/WebGL je dostupné \(GPU\).*Out of memory/);
  });
});

describe("text diagnostiky", () => {
  it("obsahuje verzi, prohlížeč, WebGL, jádro a chybu – a nic z dokumentu", () => {
    g.navigator = { userAgent: "Mozilla/5.0 Chrome/131.0.0.0 Safari/537.36", platform: "Win32", language: "cs-CZ", hardwareConcurrency: 8, maxTouchPoints: 0, onLine: true, cookieEnabled: true };
    g.window = { location: { origin: "https://www.mnastrojarna.cz", pathname: "/cad", hash: "#s=1d.TAJNE" }, screen: { width: 1920, height: 1080 }, innerWidth: 1400, innerHeight: 850, devicePixelRatio: 1.25 };
    fakeDocument(null);
    const t = collectDiagnostics({ error: new Error("THREE.WebGLRenderer: Error creating WebGL context."), core: "ready" });
    expect(t).toContain("Mnástrojárna CAD – diagnostika (bez dat dokumentu)");
    expect(t).toMatch(/Verze CADu: .+/);
    expect(t).toContain("Prohlížeč: Mozilla/5.0 Chrome/131.0.0.0 Safari/537.36 (chrome)");
    expect(t).toContain("WebGL: nedostupné – prohlížeč neposkytl WebGL kontext");
    expect(t).toContain("Jádro OCCT: ready");
    expect(t).toContain("Chyba: THREE.WebGLRenderer: Error creating WebGL context.");
    expect(t).toContain("Adresa: https://www.mnastrojarna.cz/cad");
    expect(t).not.toContain("TAJNE"); // část adresy za # (sdílený dokument) se nikdy nepřikládá
    expect(t).toContain("Obrazovka: 1920×1080 · okno 1400×850 · DPR 1.25");
  });
  it("funguje i mimo prohlížeč", () => {
    const t = collectDiagnostics();
    expect(t).toContain("WebGL: nedostupné – mimo prohlížeč");
    expect(t).toContain("Prohlížeč: –");
  });
});
