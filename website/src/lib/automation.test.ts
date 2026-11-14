import { afterEach, describe, expect, it, vi } from "vitest";
import { automationSource, isAutomation } from "./automation";

/** sessionStorage karty v paměti */
const memStore = () => {
  const m = new Map<string, string>();
  return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, String(v)), removeItem: (k: string) => void m.delete(k), size: () => m.size };
};
/** prohlížeč s adresou `search` (bez webdriveru – rozšíření prohlížeče, člověk) */
const page = (search: string, store: unknown, webdriver = false) => {
  vi.stubGlobal("window", { location: { search }, sessionStorage: store });
  vi.stubGlobal("navigator", { webdriver });
};

afterEach(() => vi.unstubAllGlobals());

describe("režim automatizace", () => {
  it("webdriver → automatizace bez příznaku v adrese", () => {
    page("", memStore(), true);
    expect(automationSource()).toBe("webdriver");
  });

  it("revize: ?agent=1 platí i po přechodu na adresu bez příznaku (přepnutí jazyka /cad → /en/cad)", () => {
    const store = memStore();
    page("?agent=1", store);
    expect(automationSource()).toBe("url");
    page("", store); // window.location.assign("/en/cad") – query string zmizí, karta (sessionStorage) zůstane
    expect(isAutomation()).toBe(true);
    page("?lang=en", store);
    expect(automationSource()).toBe("url");
  });

  it("?agent=0 / false / off režim vypne i zapamatovaný", () => {
    for (const off of ["0", "false", "off", "ne"]) {
      const store = memStore();
      page("?agent=1", store);
      expect(isAutomation()).toBe(true);
      page(`?agent=${off}`, store);
      expect(isAutomation(), off).toBe(false);
      page("", store);
      expect(isAutomation(), off).toBe(false);
    }
  });

  it("nová karta (prázdné úložiště) bez příznaku = běžný uživatel", () => {
    page("", memStore());
    expect(automationSource()).toBeNull();
  });

  it("úložiště nedostupné (soukromé okno) – příznak platí pro adresu, nic nespadne", () => {
    const broken = {
      getItem: () => {
        throw new Error("SecurityError");
      },
      setItem: () => {
        throw new Error("QuotaExceeded");
      },
      removeItem: () => {
        throw new Error("SecurityError");
      },
    };
    page("?agent=1", broken);
    expect(automationSource()).toBe("url");
    page("", broken);
    expect(automationSource()).toBeNull();
  });
});
