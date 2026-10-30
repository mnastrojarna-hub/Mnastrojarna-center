import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

/**
 * AI pro anonymizaci fotek a skenů: klíč z JEDNOHO zdroje s celou aplikací (getAiConfig — Nastavení →
 * Integrace, jinak env ANTHROPIC_API_KEY) a stejný hlavní vypínač jako pošta. Automatický běh po nahrání je
 * systémová ochrana (AI za každého autora); ruční běh jen s právem AI čtení toho, kdo ho spustil.
 */

const cfg = vi.hoisted(() => ({ key: "sk-ant-test" as string | undefined, settings: {} as Record<string, string> }));
vi.mock("@/lib/settings", () => ({
  getAiConfig: async () => ({ apiKey: cfg.key, model: "claude-test" }),
  getSetting: async (k: string) => cfg.settings[k],
}));

import { aiConfigFor } from "./service";

const db = (profile: Record<string, unknown> | null) => ({
  from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: profile, error: null }) }) }) }),
}) as never;
const noAi = { role: "obchodnik", ai_access: false, active: true };

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

  it("automatika po nahrání: AI i pro autora bez práva AI čtení (jako třídění pošty)", async () => {
    const c = await aiConfigFor(db(noAi), "u1", Date.now() + 1000, "sha");
    expect(c).toMatchObject({ apiKey: "sk-ant-test", model: "claude-test" });
    expect(await aiConfigFor(db(null), null, Date.now() + 1000, "sha")).not.toBeNull();
  });
  it("ruční běh: jen s právem AI čtení toho, kdo ho spustil", async () => {
    expect(await aiConfigFor(db(noAi), "u1", Date.now() + 1000, "sha", { manual: true })).toBeNull();
    expect(await aiConfigFor(db({ role: "super_admin", ai_access: false, active: true }), "u2", Date.now() + 1000, "sha", { manual: true })).not.toBeNull();
  });
  it("bez klíče nebo s vypnutou AI nic (fotky a skeny → ke kontrole)", async () => {
    cfg.key = undefined;
    expect(await aiConfigFor(db(noAi), "u1", Date.now() + 1000, "sha")).toBeNull();
    cfg.key = "sk-ant-test";
    cfg.settings = { ai_enabled: "false" };
    expect(await aiConfigFor(db(noAi), "u1", Date.now() + 1000, "sha")).toBeNull();
  });
});
