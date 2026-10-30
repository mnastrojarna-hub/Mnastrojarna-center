import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

/**
 * AI pro anonymizaci fotek a skenů: klíč z JEDNOHO zdroje s celou aplikací (getAiConfig — Nastavení →
 * Integrace, jinak env ANTHROPIC_API_KEY) a stejný hlavní vypínač jako pošta. Automatický běh po nahrání je
 * systémová ochrana — AI pro všechny uživatele, automaticky i ručně (rozhodnutí majitele 30. 10.).
 */

const cfg = vi.hoisted(() => ({ key: "sk-ant-test" as string | undefined, settings: {} as Record<string, string> }));
vi.mock("@/lib/settings", () => ({
  getAiConfig: async () => ({ apiKey: cfg.key, model: "claude-test" }),
  getSetting: async (k: string) => cfg.settings[k],
}));

import { aiConfigFor } from "./service";


describe("aiConfigFor — stejný klíč a vypínač jako čtení dokladů a pošta", () => {
  const prev = process.env.AI_FAKE_ANON;
  beforeEach(() => {
    delete process.env.AI_FAKE_ANON;
    cfg.key = "sk-ant-test";
    cfg.settings = { ai_capture_for_all: "false" };
  });
  afterEach(() => {
    if (prev === undefined) delete process.env.AI_FAKE_ANON; else process.env.AI_FAKE_ANON = prev;
  });

  it("AI pro všechny uživatele (i bez práva AI čtení a i když je ai_capture_for_all vypnuté)", async () => {
    expect(await aiConfigFor(Date.now() + 1000, "sha")).toMatchObject({ apiKey: "sk-ant-test", model: "claude-test" });
  });
  it("bez klíče nebo s vypnutou AI nic (fotky a skeny → ke kontrole)", async () => {
    cfg.key = undefined;
    expect(await aiConfigFor(Date.now() + 1000, "sha")).toBeNull();
    cfg.key = "sk-ant-test";
    cfg.settings = { ai_enabled: "false" };
    expect(await aiConfigFor(Date.now() + 1000, "sha")).toBeNull();
  });
});
