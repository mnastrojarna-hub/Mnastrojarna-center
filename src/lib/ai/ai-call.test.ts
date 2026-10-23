import { describe, it, expect } from "vitest";
import Anthropic from "@anthropic-ai/sdk";
import {
  AiCallError, aiFailureMessage, buildRequestBody, callOptions, classifyAiError, isRetryable, parseStructuredText,
  routeDeadline, usageOf, usesServerFallback,
} from "./ai-call";

function apiError(status: number, body: Record<string, unknown>, message = "chyba") {
  return Anthropic.APIError.generate(status, body, message, new Headers());
}

describe("callOptions (termín route)", () => {
  it("dost času → 1 opakování, timeout do termínu − rezerva", () => {
    const now = 1_000_000;
    const o = callOptions(now + 200_000, now)!;
    expect(o.maxRetries).toBe(1);
    expect(o.timeout).toBe(195_000);
    expect(o.signal).toBeInstanceOf(AbortSignal);
  });
  it("málo času → bez opakování; po termínu → null", () => {
    const now = 1_000_000;
    expect(callOptions(now + 100_000, now)!.maxRetries).toBe(0);
    expect(callOptions(now + 3_000, now)).toBeNull();
  });
  it("abort klienta se propaguje", () => {
    const ctl = new AbortController();
    const o = callOptions(Date.now() + 200_000, Date.now(), ctl.signal)!;
    expect(o.signal.aborted).toBe(false);
    ctl.abort();
    expect(o.signal.aborted).toBe(true);
  });
  it("termín route = start + 270 s", () => {
    expect(routeDeadline(0)).toBe(270_000);
  });
});

describe("classifyAiError", () => {
  it("limit útraty (kód i text) se neopakuje", () => {
    const a = apiError(400, { type: "error", error: { type: "invalid_request_error", message: "x", error_code: "enforced_spend_limit_reached" } });
    expect(classifyAiError(a)).toBe("spend_limit");
    const b = apiError(400, { type: "error", error: { type: "invalid_request_error", message: "You have reached your specified API usage limits." } }, "You have reached your specified API usage limits.");
    expect(classifyAiError(b)).toBe("spend_limit");
    expect(isRetryable("spend_limit")).toBe(false);
    expect(aiFailureMessage(a)).toBe("AI vyčerpala měsíční limit — vyplň ručně.");
  });
  it("typované chyby SDK", () => {
    expect(classifyAiError(apiError(429, { error: { type: "rate_limit_error" } }))).toBe("rate_limit");
    expect(classifyAiError(apiError(529, { error: { type: "overloaded_error", message: "Overloaded" } }, "Overloaded"))).toBe("overloaded");
    expect(classifyAiError(apiError(401, { error: { type: "authentication_error" } }))).toBe("auth");
    expect(classifyAiError(apiError(400, { error: { type: "invalid_request_error", message: "bad image" } }))).toBe("invalid_request");
    expect(classifyAiError(new Anthropic.APIConnectionTimeoutError())).toBe("timeout");
    expect(classifyAiError(new AiCallError("refusal"))).toBe("refusal");
    expect(classifyAiError(new Error("něco"))).toBe("other");
    expect(isRetryable("overloaded")).toBe(true);
    expect(isRetryable("auth")).toBe(false);
  });
  it("400 kvůli output_config → hláška o modelu", () => {
    const e = apiError(400, { error: { type: "invalid_request_error", message: "output_config.format: not supported for this model" } }, "output_config.format: not supported");
    expect(aiFailureMessage(e)).toBe("Nastavený model nepodporuje strukturovaný výstup — změň model v Nastavení.");
  });
  it("vlastní chyby si nechají hlášku", () => {
    expect(aiFailureMessage(new Error("Chybí soubor dokladu."))).toBe("Chybí soubor dokladu.");
    expect(aiFailureMessage(new AiCallError("max_tokens"))).toBe("AI odpověď byla useknutá — zkus doklad nahrát znovu.");
  });
});

describe("tělo požadavku", () => {
  it("adaptivní thinking, effort a JSON schéma, cache jen na stabilním bloku, bez sampling parametrů", () => {
    const b = buildRequestBody({
      model: "claude-opus-5-5", systemStable: "STABIL", systemExtra: "UČENÍ", content: [{ type: "text", text: "x" }],
      schema: { type: "object" }, effort: "medium", maxTokens: 16000,
    }) as unknown as Record<string, unknown>;
    expect(b.thinking).toEqual({ type: "adaptive" });
    expect(b.output_config).toEqual({ effort: "medium", format: { type: "json_schema", schema: { type: "object" } } });
    expect(b.system).toEqual([
      { type: "text", text: "STABIL", cache_control: { type: "ephemeral" } },
      { type: "text", text: "UČENÍ" },
    ]);
    for (const k of ["temperature", "top_p", "top_k"]) expect(b).not.toHaveProperty(k);
    expect(JSON.stringify(b)).not.toMatch(/budget_tokens/);
  });
  it("server-side fallback jen u podporovaných modelů", () => {
    expect(usesServerFallback("claude-opus-5-5")).toBe(true);
    expect(usesServerFallback("claude-opus-4-8")).toBe(false);
  });
  it("usage a JSON i po přepnutí modelu", () => {
    expect(usageOf({ input_tokens: 10, output_tokens: 5, cache_read_input_tokens: 3, cache_creation_input_tokens: null })).toEqual({ input: 10, output: 5, cacheRead: 3, cacheWrite: 0 });
    expect(parseStructuredText([{ type: "thinking" }, { type: "text", text: "{\"a\":1}" }])).toEqual({ a: 1 });
    expect(parseStructuredText([{ type: "text", text: "{\"a\":" }, { type: "fallback" }, { type: "text", text: "{\"b\":2}" }])).toEqual({ b: 2 });
    expect(() => parseStructuredText([{ type: "text", text: "nic" }])).toThrow(/nečitelnou/);
  });
});

describe("callStructured proti lokálnímu falešnému API (streaming)", () => {
  async function withServer(
    respond: (body: Record<string, unknown>) => { stop: string; text: string[]; fallback?: boolean },
    fn: (seen: { body: Record<string, unknown>; headers: Record<string, string | string[] | undefined> }[]) => Promise<void>,
  ) {
    const http = await import("node:http");
    const seen: { body: Record<string, unknown>; headers: Record<string, string | string[] | undefined> }[] = [];
    const server = http.createServer((req, res) => {
      let raw = "";
      req.on("data", (c) => { raw += c; });
      req.on("end", () => {
        const body = JSON.parse(raw) as Record<string, unknown>;
        seen.push({ body, headers: req.headers });
        const r = respond(body);
        res.writeHead(200, { "content-type": "text/event-stream" });
        const ev = (type: string, data: Record<string, unknown>) => res.write(`event: ${type}\ndata: ${JSON.stringify({ type, ...data })}\n\n`);
        ev("message_start", { message: { id: "msg_1", type: "message", role: "assistant", model: body.model, content: [], stop_reason: null, stop_sequence: null, usage: { input_tokens: 11, output_tokens: 0, cache_read_input_tokens: 4, cache_creation_input_tokens: 0 } } });
        let i = 0;
        if (r.fallback) {
          ev("content_block_start", { index: i, content_block: { type: "fallback", from: { model: "claude-opus-5-5" }, to: { model: "claude-opus-4-8" } } });
          ev("content_block_stop", { index: i++ });
        }
        for (const t of r.text) {
          ev("content_block_start", { index: i, content_block: { type: "text", text: "" } });
          ev("content_block_delta", { index: i, delta: { type: "text_delta", text: t } });
          ev("content_block_stop", { index: i++ });
        }
        ev("message_delta", { delta: { stop_reason: r.stop, stop_sequence: null }, usage: { output_tokens: 7 } });
        ev("message_stop", {});
        res.end();
      });
    });
    await new Promise<void>((ok) => server.listen(0, "127.0.0.1", () => ok()));
    const port = (server.address() as { port: number }).port;
    const prev = process.env.ANTHROPIC_BASE_URL;
    process.env.ANTHROPIC_BASE_URL = `http://127.0.0.1:${port}`;
    try {
      await fn(seen);
    } finally {
      if (prev === undefined) delete process.env.ANTHROPIC_BASE_URL;
      else process.env.ANTHROPIC_BASE_URL = prev;
      await new Promise<void>((ok) => server.close(() => ok()));
    }
  }

  const input = (model: string) => ({
    apiKey: "test-klic", model, systemStable: "S", systemExtra: "E", content: [{ type: "text" as const, text: "x" }],
    schema: { type: "object" }, effort: "high" as const, maxTokens: 32000, deadline: Date.now() + 200_000,
  });

  it("Opus 5.5: beta fallback, streaming, strukturovaný výstup a usage", async () => {
    const { callStructured } = await import("./ai-call");
    await withServer(() => ({ stop: "end_turn", text: ["{\"ok\":", "true}"] }), async (seen) => {
      const res = await callStructured(input("claude-opus-5-5"));
      expect(res.data).toEqual({ ok: true });
      expect(res.usage).toMatchObject({ input: 11, output: 7, cacheRead: 4 });
      expect(seen[0].body).toMatchObject({ stream: true, fallbacks: "default", thinking: { type: "adaptive" }, max_tokens: 32000 });
      expect(String(seen[0].headers["anthropic-beta"])).toContain("server-side-fallback-2026-07-01");
    });
  });

  it("jiný model: bez beta; odmítnutí a useknutí jako typované chyby; JSON po přepnutí modelu", async () => {
    const { callStructured, AiCallError } = await import("./ai-call");
    await withServer(() => ({ stop: "end_turn", text: ["{\"a\":1}"] }), async (seen) => {
      await callStructured(input("claude-opus-4-8"));
      expect(seen[0].body).not.toHaveProperty("fallbacks");
      expect(seen[0].headers["anthropic-beta"]).toBeUndefined();
    });
    await withServer(() => ({ stop: "refusal", text: [] }), async () => {
      await expect(callStructured(input("claude-opus-4-8"))).rejects.toMatchObject({ failure: "refusal" });
    });
    await withServer(() => ({ stop: "max_tokens", text: ["{\"a\":"] }), async () => {
      const err = await callStructured(input("claude-opus-4-8")).catch((e) => e);
      expect(err).toBeInstanceOf(AiCallError);
      expect(err.failure).toBe("max_tokens");
    });
    await withServer(() => ({ stop: "end_turn", text: ["{\"b\":2}"], fallback: true }), async () => {
      expect((await callStructured(input("claude-opus-5-5"))).data).toEqual({ b: 2 });
    });
  });
});
