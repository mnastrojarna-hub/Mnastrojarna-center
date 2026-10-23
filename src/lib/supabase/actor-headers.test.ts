import { describe, it, expect } from "vitest";
import {
  ACTOR_HEADER, SYSTEM_ACTOR, actorHeaders, aiActor, cronActor, decodeChangeNote, encodeChangeNote, userActor,
  withChangeNote,
} from "./actor-headers";

const ME = "156c7996-b488-4c53-a3f5-e51dd004f4ad";
const ascii = (s: string) => /^[\x20-\x7e]*$/.test(s);

describe("hlavičky autora", () => {
  it("uživatel: id, druh, způsob a request id (vždy ASCII)", () => {
    const h = actorHeaders(userActor({ id: ME }));
    expect(h[ACTOR_HEADER.id]).toBe(ME);
    expect(h[ACTOR_HEADER.kind]).toBe("user");
    expect(h[ACTOR_HEADER.via]).toBe("rucne");
    expect(h[ACTOR_HEADER.request]).toMatch(/^[0-9a-f-]{36}$/);
    expect(h[ACTOR_HEADER.agent]).toBeUndefined();
    for (const v of Object.values(h)) expect(ascii(v)).toBe(true);
  });

  it("výchozí způsob podle druhu; AI s agentem; plánovač", () => {
    expect(actorHeaders(aiActor(ME, "capture", "foto"))).toMatchObject({ "x-actor-kind": "ai", "x-actor-via": "foto", "x-actor-agent": "capture", "x-actor-id": ME });
    expect(actorHeaders(aiActor(null, "email-ingest"))).toMatchObject({ "x-actor-kind": "ai", "x-actor-via": "ai" });
    expect(actorHeaders(aiActor(null, "email-ingest"))["x-actor-id"]).toBeUndefined();
    expect(actorHeaders(cronActor())).toMatchObject({ "x-actor-kind": "system", "x-actor-via": "cron", "x-actor-agent": "cron" });
    expect(actorHeaders(SYSTEM_ACTOR)).toMatchObject({ "x-actor-kind": "system", "x-actor-via": "automaticky" });
    expect(actorHeaders(null)).toMatchObject({ "x-actor-kind": "system" });
    expect(actorHeaders({ id: null, kind: "system" })["x-actor-via"]).toBe("automaticky");
  });

  it("neplatné uuid, druh, způsob a agent se vynechají", () => {
    const h = actorHeaders({ id: "není-uuid", kind: "hacker" as never, via: "x" as never, agent: "Špatný Agent!", requestId: "abc" });
    expect(h["x-actor-id"]).toBeUndefined();
    expect(h["x-actor-kind"]).toBe("system");
    expect(h["x-actor-via"]).toBe("automaticky");
    expect(h["x-actor-agent"]).toBeUndefined();
    expect(h["x-actor-request"]).toMatch(/^[0-9a-f-]{36}$/);
    expect(actorHeaders({ id: ME, kind: "user", agent: "a".repeat(41) })["x-actor-agent"]).toBeUndefined();
  });

  it("request id se zachová, když je platné; jinak nový pro každého klienta", () => {
    const rid = "11111111-2222-4333-8444-555555555555";
    expect(actorHeaders({ id: ME, kind: "user", requestId: rid })["x-actor-request"]).toBe(rid);
    expect(actorHeaders(userActor({ id: ME }))["x-actor-request"]).not.toBe(actorHeaders(userActor({ id: ME }))["x-actor-request"]);
  });

  it("userActor bez uživatele = Systém", () => {
    expect(userActor(null)).toMatchObject({ id: null, kind: "system" });
    expect(userActor({ id: ME }, "foto")).toEqual({ id: ME, kind: "user", via: "foto" });
  });
});

describe("poznámka ke změně (base64url UTF-8)", () => {
  it("diakritika a symboly projdou tam i zpět, hodnota je ASCII", () => {
    const text = "Výroba začala ✓ — ž";
    const enc = encodeChangeNote(text)!;
    expect(ascii(enc)).toBe(true);
    expect(enc).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(decodeChangeNote(enc)).toBe(text);
  });

  it("ořez na 500 znaků před kódováním, prázdná → null", () => {
    const long = "ř".repeat(600);
    expect(decodeChangeNote(encodeChangeNote(long)!)).toBe("ř".repeat(500));
    expect(encodeChangeNote("   ")).toBeNull();
    expect(encodeChangeNote(null)).toBeNull();
    expect(encodeChangeNote(undefined)).toBeNull();
  });

  it("neplatná hodnota se nedekóduje", () => {
    expect(decodeChangeNote("není base64!")).toBeNull();
    expect(decodeChangeNote("")).toBeNull();
  });

  it("withChangeNote bez poznámky nemění dotaz, s poznámkou nastaví hlavičku", () => {
    const calls: [string, string][] = [];
    const q = { setHeader(name: string, value: string) { calls.push([name, value]); return q; } };
    expect(withChangeNote(q, null)).toBe(q);
    expect(withChangeNote(q, "  ")).toBe(q);
    expect(calls).toHaveLength(0);
    expect(withChangeNote(q, "Ahoj")).toBe(q);
    expect(calls).toEqual([["x-change-note", encodeChangeNote("Ahoj")]]);
  });
});
