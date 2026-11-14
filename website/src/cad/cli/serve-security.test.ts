import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { UsageError } from "./args";
import { allowedHosts, BODY_MAX, checkBody, checkRequest, defaultTokenFile, loadOrCreateToken, tokenEquals, validateBind, type SecurityConfig } from "./serve-security";

const TOKEN = "t".repeat(43);
const cfg: SecurityConfig = { token: TOKEN, port: 8787 };
const ok = { host: "127.0.0.1:8787", authorization: `Bearer ${TOKEN}` };

describe("checkRequest – Host, Origin, Sec-Fetch-Site, token", () => {
  it("povolí jen loopback:port s platným tokenem", () => {
    for (const host of ["127.0.0.1:8787", "localhost:8787", "[::1]:8787", "LOCALHOST:8787"]) expect(checkRequest({ ...ok, host }, cfg), host).toBeNull();
  });
  it("--host 127.0.0.2 / ::1 / localhost: hlásí-li server tuto adresu, Host s ní projde; jiná místní adresa ne", () => {
    const c2: SecurityConfig = { ...cfg, bind: "127.0.0.2" };
    expect(checkRequest({ ...ok, host: "127.0.0.2:8787" }, c2)).toBeNull();
    expect(checkRequest({ ...ok, host: "127.0.0.3:8787" }, c2)?.status).toBe(403);
    expect(checkRequest({ ...ok, host: "127.0.0.2:8787" }, cfg)?.status).toBe(403);
    expect([...allowedHosts({ ...cfg, bind: "::1" })!]).toContain("[::1]:8787");
    expect([...allowedHosts({ ...cfg, bind: "0.0.0.0" })!]).not.toContain("0.0.0.0:8787"); // jen s --allow-remote
  });
  it("403 – cizí Host (DNS rebinding), jiný port, chybějící Host", () => {
    for (const host of ["evil.example:8787", "127.0.0.1:80", "127.0.0.1", "", "attacker.127.0.0.1.nip.io:8787"]) expect(checkRequest({ ...ok, host }, cfg)?.status, host).toBe(403);
    expect(checkRequest({ authorization: ok.authorization }, cfg)?.status).toBe(403);
  });
  it("403 – jakákoli hlavička Origin (i „null“ a vlastní adresa)", () => {
    for (const origin of ["https://evil.example", "null", "http://127.0.0.1:8787", ""]) expect(checkRequest({ ...ok, origin }, cfg)?.status, origin).toBe(403);
  });
  it("403 – Sec-Fetch-Site mimo none/same-origin", () => {
    expect(checkRequest({ ...ok, "sec-fetch-site": "cross-site" }, cfg)?.status).toBe(403);
    expect(checkRequest({ ...ok, "sec-fetch-site": "same-site" }, cfg)?.status).toBe(403);
    expect(checkRequest({ ...ok, "sec-fetch-site": "none" }, cfg)).toBeNull();
    expect(checkRequest({ ...ok, "sec-fetch-site": "same-origin" }, cfg)).toBeNull();
  });
  it("401 – bez tokenu, špatný token, jiné schéma; Host a Origin mají přednost", () => {
    expect(checkRequest({ host: ok.host }, cfg)?.status).toBe(401);
    expect(checkRequest({ host: ok.host, authorization: "Bearer nope" }, cfg)?.status).toBe(401);
    expect(checkRequest({ host: ok.host, authorization: `Basic ${TOKEN}` }, cfg)?.status).toBe(401);
    expect(checkRequest({ host: ok.host, authorization: `Bearer ${TOKEN}x` }, cfg)?.status).toBe(401);
    expect(checkRequest({ host: "evil:8787" }, cfg)?.status).toBe(403);
    expect(checkRequest({ host: ok.host, origin: "x" }, cfg)?.status).toBe(403);
    expect(tokenEquals("abc", "abc")).toBe(true);
    expect(tokenEquals("abc", "abd")).toBe(false);
  });
  it("vzdálený přístup: adresa naslouchání a --allow-host; 0.0.0.0 bez výčtu = jakýkoli Host s portem", () => {
    const r1: SecurityConfig = { ...cfg, remote: { bind: "10.0.0.5", hosts: ["cad.local"] } };
    expect([...allowedHosts(r1)!]).toEqual(expect.arrayContaining(["10.0.0.5:8787", "cad.local:8787", "127.0.0.1:8787"]));
    expect(checkRequest({ ...ok, host: "cad.local:8787" }, r1)).toBeNull();
    expect(checkRequest({ ...ok, host: "other:8787" }, r1)?.status).toBe(403);
    const r2: SecurityConfig = { ...cfg, remote: { bind: "0.0.0.0", hosts: [] } };
    expect(allowedHosts(r2)).toBeNull();
    expect(checkRequest({ ...ok, host: "anything:8787" }, r2)).toBeNull();
    expect(checkRequest({ ...ok, host: "anything:9999" }, r2)?.status).toBe(403);
  });
});

describe("checkBody – jen JSON, limit těla", () => {
  it("415 pro text/plain, form, chybějící typ; JSON s charset projde; 413 nad limit", () => {
    for (const ct of ["text/plain", "application/x-www-form-urlencoded", "multipart/form-data; boundary=x", "", "application/json-patch+json"]) expect(checkBody({ "content-type": ct })?.status, ct).toBe(415);
    expect(checkBody({ "content-type": "application/json" })).toBeNull();
    expect(checkBody({ "content-type": "application/json; charset=utf-8" })).toBeNull();
    expect(checkBody({ "content-type": "application/json", "content-length": String(BODY_MAX + 1) })?.status).toBe(413);
  });
});

describe("token (0600) a adresa naslouchání", () => {
  let tmp: string;
  beforeAll(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), "mncad-tok-"));
  });
  afterAll(() => fs.rmSync(tmp, { recursive: true, force: true }));
  it("vygeneruje 32 bajtů do $XDG_CONFIG_HOME/mncad/token s právy 0600 a příště ho znovu použije", () => {
    const env = { XDG_CONFIG_HOME: path.join(tmp, "cfg") };
    const a = loadOrCreateToken(undefined, env, tmp);
    expect(a.created).toBe(true);
    expect(a.file).toBe(defaultTokenFile(env, tmp));
    expect(Buffer.from(a.token, "base64url").length).toBe(32);
    expect(fs.statSync(a.file).mode & 0o777).toBe(0o600);
    expect(fs.statSync(path.dirname(a.file)).mode & 0o777).toBe(0o700);
    const b = loadOrCreateToken(undefined, env, tmp);
    expect(b).toEqual({ token: a.token, file: a.file, created: false });
  });
  it("--token-file: musí existovat, nesmí být čitelný pro ostatní, aspoň 16 znaků", () => {
    const f = path.join(tmp, "tok");
    expect(() => loadOrCreateToken(f, {}, tmp)).toThrow(UsageError);
    fs.writeFileSync(f, "x".repeat(20), { mode: 0o644 });
    fs.chmodSync(f, 0o644);
    expect(() => loadOrCreateToken(f, {}, tmp)).toThrow(/chmod 600/);
    fs.chmodSync(f, 0o600);
    expect(loadOrCreateToken(f, {}, tmp).token).toBe("x".repeat(20));
    fs.writeFileSync(f, "short");
    expect(() => loadOrCreateToken(f, {}, tmp)).toThrow(/16/);
  });
  it("jiná adresa než loopback jen s --allow-remote a výslovným --token-file", () => {
    expect(() => validateBind("127.0.0.1", false, undefined)).not.toThrow();
    expect(() => validateBind("::1", false, undefined)).not.toThrow();
    expect(() => validateBind("localhost", false, undefined)).not.toThrow();
    expect(() => validateBind("0.0.0.0", false, "t")).toThrow(/--allow-remote/);
    expect(() => validateBind("0.0.0.0", true, undefined)).toThrow(/--token-file/);
    expect(() => validateBind("0.0.0.0", true, "t")).not.toThrow();
  });
});
