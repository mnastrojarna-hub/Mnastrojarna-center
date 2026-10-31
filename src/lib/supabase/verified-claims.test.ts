import { describe, it, expect, vi } from "vitest";
import { createHmac } from "node:crypto";
import { getVerifiedAuthUser, jwtAlg, verifyHs256, type AuthLike } from "./verified-claims";

const SECRET = "super-secret-jwt-token-with-at-least-32-characters";
const b64 = (v: unknown) => Buffer.from(typeof v === "string" ? v : JSON.stringify(v)).toString("base64url");

function sign(payload: Record<string, unknown>, secret = SECRET, header: Record<string, unknown> = { alg: "HS256", typ: "JWT" }): string {
  const head = `${b64(header)}.${b64(payload)}`;
  return `${head}.${createHmac("sha256", secret).update(head).digest("base64url")}`;
}

const now = Math.floor(Date.now() / 1000);
const claims = { sub: "5ff3e3a5-29d4-4eba-845d-75b2fb8c5041", email: "a@b.cz", role: "authenticated", exp: now + 600, user_metadata: { full_name: "Admin" } };

type ClaimsResult = { data: { claims: Record<string, unknown> } | null; error: unknown };

function client(
  token: string | null,
  getClaims = vi.fn(async (): Promise<ClaimsResult> => ({ data: null, error: new Error("no") })),
): AuthLike & { getClaims: typeof getClaims } {
  return {
    getClaims,
    auth: {
      getSession: async () => ({ data: { session: token ? { access_token: token } : null }, error: null }),
      getClaims: getClaims as unknown as AuthLike["auth"]["getClaims"],
    },
  };
}

describe("verifyHs256", () => {
  it("platný podpis a nevypršelý token → claims", async () => {
    expect((await verifyHs256(sign(claims), SECRET))?.sub).toBe(claims.sub);
  });
  it("jiný klíč, změněný obsah, prošlý token, jiný algoritmus → null", async () => {
    expect(await verifyHs256(sign(claims, "jiny-klic-jiny-klic-jiny-klic-jiny"), SECRET)).toBeNull();
    const [h, , s] = sign(claims).split(".");
    expect(await verifyHs256(`${h}.${b64({ ...claims, sub: "jiny" })}.${s}`, SECRET)).toBeNull();
    expect(await verifyHs256(sign({ ...claims, exp: now - 1 }), SECRET)).toBeNull();
    expect(await verifyHs256(sign(claims, SECRET, { alg: "none" }), SECRET)).toBeNull();
    expect(await verifyHs256("nesmysl", SECRET)).toBeNull();
  });
  it("jwtAlg čte hlavičku", () => {
    expect(jwtAlg(sign(claims))).toBe("HS256");
    expect(jwtAlg("x")).toBeNull();
  });
});

describe("getVerifiedAuthUser", () => {
  it("se SUPABASE_JWT_SECRET ověří lokálně (bez getClaims → bez síťového volání)", async () => {
    vi.stubEnv("SUPABASE_JWT_SECRET", SECRET);
    const c = client(sign(claims));
    const u = await getVerifiedAuthUser(c);
    expect(u).toEqual({ id: claims.sub, email: "a@b.cz", user_metadata: { full_name: "Admin" } });
    expect(c.getClaims).not.toHaveBeenCalled();
    vi.unstubAllEnvs();
  });
  it("špatný podpis při nastaveném klíči → rozhodne Supabase (getClaims), nikdo se omylem nepřihlásí", async () => {
    vi.stubEnv("SUPABASE_JWT_SECRET", SECRET);
    const c = client(sign(claims, "podvrzeny-klic-podvrzeny-klic-podvrzeny"));
    expect(await getVerifiedAuthUser(c)).toBeNull();
    expect(c.getClaims).toHaveBeenCalledOnce();
    vi.unstubAllEnvs();
  });
  it("bez klíče použije getClaims (JWKS / síťové ověření); anon a servisní token nejsou uživatel", async () => {
    vi.stubEnv("SUPABASE_JWT_SECRET", "");
    const ok = client(sign(claims), vi.fn(async () => ({ data: { claims }, error: null })));
    expect((await getVerifiedAuthUser(ok))?.id).toBe(claims.sub);
    const anon = client(null, vi.fn(async () => ({ data: { claims: { role: "anon" } }, error: null })));
    expect(await getVerifiedAuthUser(anon)).toBeNull();
    const service = client(null, vi.fn(async () => ({ data: { claims: { role: "service_role", sub: "x" } }, error: null })));
    expect(await getVerifiedAuthUser(service)).toBeNull();
    vi.unstubAllEnvs();
  });
  it("bez session → null", async () => {
    vi.stubEnv("SUPABASE_JWT_SECRET", SECRET);
    expect(await getVerifiedAuthUser(client(null))).toBeNull();
    vi.unstubAllEnvs();
  });
});
