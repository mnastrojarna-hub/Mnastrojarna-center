import { describe, expect, it, vi } from "vitest";
import { bufferResponse, bufferedRscFetch, installRscFetchBuffer, isRscResponse } from "@/lib/rsc-fetch-buffer";

/** Odpověď se streamem ve dvou kusech (jako RSC navigace). */
function streamed(text: string, contentType: string, init: { url?: string; redirected?: boolean } = {}): Response {
  const enc = new TextEncoder();
  const half = Math.floor(text.length / 2);
  const body = new ReadableStream<Uint8Array>({
    start(c) {
      c.enqueue(enc.encode(text.slice(0, half)));
      c.enqueue(enc.encode(text.slice(half)));
      c.close();
    },
  });
  const res = new Response(body, { status: 200, headers: { "content-type": contentType, "x-test": "1" } });
  Object.defineProperty(res, "url", { value: init.url ?? "http://localhost/orders?q=a" });
  Object.defineProperty(res, "redirected", { value: init.redirected ?? false });
  return res;
}

describe("buffer odpovědí RSC", () => {
  it("pozná RSC podle content-type", () => {
    expect(isRscResponse(new Response("", { headers: { "content-type": "text/x-component" } }))).toBe(true);
    expect(isRscResponse(new Response("", { headers: { "content-type": "Text/X-Component; charset=utf-8" } }))).toBe(true);
    expect(isRscResponse(new Response("", { headers: { "content-type": "application/json" } }))).toBe(false);
    expect(isRscResponse(new Response(""))).toBe(false);
  });

  it("odpověď RSC předá celou, se stejnou adresou, stavem a hlavičkami", async () => {
    const original = vi.fn(async () => streamed("0:{\"a\":1}\n1:[\"$L2\"]\n", "text/x-component", { url: "http://x/orders?q=b", redirected: true }));
    const f = bufferedRscFetch(original as unknown as typeof fetch);
    const res = await f("http://x/orders?q=b&_rsc=1");
    expect(res.status).toBe(200);
    expect(res.url).toBe("http://x/orders?q=b");
    expect(res.redirected).toBe(true);
    expect(res.headers.get("x-test")).toBe("1");
    const reader = res.body!.getReader();
    const first = await reader.read();
    expect(new TextDecoder().decode(first.value)).toBe("0:{\"a\":1}\n1:[\"$L2\"]\n");
    expect((await reader.read()).done).toBe(true);
  });

  it("ostatní odpovědi (API, soubory) nechá beze změny", async () => {
    const json = streamed("{\"ok\":true}", "application/json");
    const f = bufferedRscFetch((async () => json) as unknown as typeof fetch);
    expect(await f("/api/x")).toBe(json);
  });

  it("chyba sítě projde dál", async () => {
    const f = bufferedRscFetch((async () => { throw new TypeError("offline"); }) as unknown as typeof fetch);
    await expect(f("/orders")).rejects.toThrow("offline");
  });

  it("instalace jen jednou a na serveru nic", async () => {
    const calls: string[] = [];
    const host = { fetch: (async (u: string) => { calls.push(u); return new Response("x", { headers: { "content-type": "text/x-component" } }); }) as unknown as typeof fetch } as { fetch: typeof fetch } & Record<string, unknown>;
    expect(installRscFetchBuffer(host)).toBe(true);
    const first = host.fetch;
    expect(installRscFetchBuffer(host)).toBe(false);
    expect(host.fetch).toBe(first);
    expect(await (await host.fetch("/a")).text()).toBe("x");
    expect(calls).toEqual(["/a"]);
    expect(installRscFetchBuffer(undefined)).toBe(false);
  });

  it("bufferResponse zachová prázdné tělo i stav", async () => {
    const res = await bufferResponse(new Response(null, { status: 204 }));
    expect(res.status).toBe(204);
    expect(await res.text()).toBe("");
  });
});
