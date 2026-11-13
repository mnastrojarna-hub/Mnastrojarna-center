import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { blobOf, embedBlobs, putBlob } from "./blobs";
import { b64u, createShareLink, deflate, openShareLink, parseShareHash, probeSelfStore, resetShareProbe, revokeShare, shareMessage } from "./share";
import { emptyDoc, type CadDoc } from "./types";

/**
 * Krátký odkaz přes vlastní úložiště na webu (/cad/share/, PHP) – klient proti napodobenému serveru (stejný protokol jako
 * public/cad/share/index.php; skutečný PHP server testuje share-php.test.ts).
 */
const ORIGIN = "https://www.mnastrojarna.cz";
const BASE = ORIGIN + "/cad";
const STORE = ORIGIN + "/cad/share/";
const hashOf = (url: string) => url.slice(url.indexOf("#"));
const sample = (): CadDoc => ({
  ...emptyDoc("Příruba DN50"),
  features: [
    { id: "s1", name: "Skica 1", type: "sketch", plane: "XY", entities: [{ kind: "circle", center: [0, 0], r: 82.5 }] } as unknown as CadDoc["features"][number],
    { id: "e1", name: "Vysunutí 1", type: "extrude", sketchId: "s1", distance: 18 } as unknown as CadDoc["features"][number],
  ],
});
const randomBytes = (n: number) => {
  const out = new Uint8Array(n);
  for (let i = 0; i < n; i += 65_536) crypto.getRandomValues(out.subarray(i, Math.min(n, i + 65_536)));
  return out;
};

type Entry = { data: Uint8Array; total: number; exp: number; del: string; done: boolean };
/** napodobený PHP server: ping, nahrání po částech, stažení, 404/410, mazání tokenem */
function mockServer(opts: { maxBytes?: number; chunkBytes?: number; down?: boolean; status?: number } = {}) {
  const maxBytes = opts.maxBytes ?? 25 * 1024 * 1024;
  const chunkBytes = opts.chunkBytes ?? 8 * 1024 * 1024;
  const db = new Map<string, Entry>();
  const calls: { method: string; url: string; bytes: number; headers: Record<string, string> }[] = [];
  let n = 0;
  const json = (status: number, data: unknown) => new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json" } });
  const fetchMock = vi.fn(async (input: string, init: RequestInit = {}) => {
    const url = new URL(String(input));
    const method = (init.method ?? "GET").toUpperCase();
    const headers = (init.headers ?? {}) as Record<string, string>;
    const body = init.body ? new Uint8Array(init.body as Uint8Array) : new Uint8Array();
    calls.push({ method, url: String(input), bytes: body.length, headers });
    if (opts.down) throw new TypeError("fetch failed");
    if (!String(input).startsWith(STORE)) return new Response("not found", { status: 404, headers: { "content-type": "text/html" } });
    const q = url.searchParams;
    if (method === "GET" && q.has("ping")) return json(200, { ok: true, v: 1, max_bytes: maxBytes, chunk_bytes: chunkBytes, max_days: 90 });
    if (opts.status) return json(opts.status, { ok: false, error: "x" });
    if (method === "POST" && !q.has("id")) {
      expect(headers["Content-Type"]).toBe("application/octet-stream");
      const total = Number(q.get("total"));
      const days = Number(q.get("days"));
      if (!(days >= 1 && days <= 90)) return json(400, { error: "invalid_days" });
      if (total > maxBytes || body.length > chunkBytes) return json(413, { error: "too_large", max_bytes: maxBytes });
      const id = "Ab" + String(++n).padStart(8, "0");
      const e: Entry = { data: body, total, exp: Math.floor(Date.now() / 1000) + days * 86400, del: "tok" + "x".repeat(20) + n, done: body.length === total };
      db.set(id, e);
      return json(201, { id, del: e.del, exp: e.exp, size: body.length, done: e.done });
    }
    if (method === "POST") {
      const e = db.get(q.get("id")!);
      if (!e || e.done) return json(404, { error: "not_found" });
      if (headers["X-Delete-Token"] !== e.del) return json(403, { error: "bad_token" });
      if (Number(q.get("offset")) !== e.data.length) return json(409, { error: "offset", size: e.data.length });
      if (body.length > chunkBytes) return json(413, { error: "chunk_too_large" });
      const d = new Uint8Array(e.data.length + body.length);
      d.set(e.data);
      d.set(body, e.data.length);
      e.data = d;
      e.done = d.length === e.total;
      return json(200, { id: q.get("id"), size: d.length, done: e.done });
    }
    if (method === "GET") {
      const id = q.get("id") ?? "";
      if (!/^[0-9A-Za-z]{8,12}$/.test(id)) return json(400, { error: "invalid_id" });
      const e = db.get(id);
      if (!e || !e.done) return json(404, { error: "not_found" });
      if (e.exp * 1000 < Date.now()) {
        db.delete(id);
        return json(410, { error: "expired", exp: e.exp });
      }
      return new Response(e.data as BodyInit, { status: 200, headers: { "content-type": "application/octet-stream" } });
    }
    if (method === "DELETE") {
      const e = db.get(q.get("id")!);
      if (!e) return json(404, { error: "not_found" });
      if (headers["X-Delete-Token"] !== e.del) return json(403, { error: "bad_token" });
      db.delete(q.get("id")!);
      return json(200, { ok: true });
    }
    return json(405, { error: "method_not_allowed" });
  });
  vi.stubGlobal("fetch", fetchMock);
  return { db, calls, fetchMock };
}

beforeEach(() => {
  vi.stubGlobal("location", { origin: ORIGIN, pathname: "/cad", hash: "" });
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  resetShareProbe();
});

describe("krátký odkaz – tvar a rozbor", () => {
  it("odkaz je jeden řádek pod 120 znaků: /cad#q=<id 10>.<klíč 22>; heslo odkaz neprodlouží", async () => {
    mockServer();
    const r = await createShareLink(sample(), { days: 10, base: BASE });
    expect(r.mode).toBe("self");
    expect(r.url).toMatch(/^https:\/\/www\.mnastrojarna\.cz\/cad#q=[0-9A-Za-z]{10}\.[A-Za-z0-9_-]{22}$/);
    expect(r.url.length).toBeLessThan(120);
    expect(r.url).not.toMatch(/\s/);
    expect(r.note).toBeUndefined();
    const rp = await createShareLink(sample(), { days: 10, base: BASE, password: "tajne" });
    expect(rp.password).toBe(true);
    expect(rp.url.length).toBe(r.url.length);
  });

  it("rozbor #q=: id + klíč, tolerantní k přilepené interpunkci, odmítne poškozený", () => {
    expect(parseShareHash("#q=Ab12345678.AAAAAAAAAAAAAAAAAAAAAA")).toEqual({ kind: "self", id: "Ab12345678", key: "AAAAAAAAAAAAAAAAAAAAAA" });
    expect(parseShareHash("#q=Ab12345678.AAAAAAAAAAAAAAAAAAAAAA).")).toMatchObject({ kind: "self", id: "Ab12345678" });
    expect(parseShareHash("#q=Ab12345678.AAAAAAAAAAAAAAAAAAAAA")).toBeNull(); // klíč 21 znaků
    expect(parseShareHash("#q=Ab12345678.AAAAAAAAAAAAAAAAAAAAAAA")).toBeNull(); // 23 znaků
    expect(parseShareHash("#q=../../etc.AAAAAAAAAAAAAAAAAAAAAA")).toBeNull();
    expect(parseShareHash("#q=Ab1.AAAAAAAAAAAAAAAAAAAAAA")).toBeNull();
    // staré odkazy dál fungují
    expect(parseShareHash("#s=1d.abc")?.kind).toBe("link");
    expect(parseShareHash("#r=d10~abc.def")?.kind).toBe("store");
  });
});

describe("krátký odkaz – vytvoření a otevření (napodobený server)", () => {
  it("kulatá cesta: na serveru jen šifrovaný obsah, otevření vrátí shodný dokument; zpráva nese krátký odkaz", async () => {
    const { db } = mockServer();
    const r = await createShareLink(sample(), { days: 7, base: BASE, from: "Vít Volný", view: "drawing" });
    expect(db.size).toBe(1);
    const stored = [...db.values()][0];
    expect(stored.done).toBe(true);
    const text = new TextDecoder().decode(stored.data);
    expect(text).not.toContain("Příruba");
    expect(text).not.toContain("mnastrojarna-cad");
    expect(String.fromCharCode(...stored.data.subarray(0, 3))).toBe("MNQ");
    expect(r.exp).toBeGreaterThan(Date.now() + 6.9 * 86_400_000);
    const o = await openShareLink(parseShareHash(hashOf(r.url))!);
    expect(o.ok).toBe(true);
    if (o.ok) {
      expect(o.mode).toBe("self");
      expect(o.payload.doc).toEqual(sample());
      expect(o.payload.from).toBe("Vít Volný");
      expect(o.payload.view).toBe("drawing");
      expect(o.payload.exp).toBe(r.exp);
    }
    const m = shareMessage("Příruba DN50", r);
    expect(m).toContain(r.url);
    expect(m.split("\n").find((l) => l.includes("#q="))).toBe(r.url);
  });

  it("špatný klíč v odkazu → neplatný; cizí id → nenalezeno", async () => {
    mockServer();
    const r = await createShareLink(sample(), { days: 1, base: BASE });
    const p = parseShareHash(hashOf(r.url)) as { kind: "self"; id: string; key: string };
    const bad = await openShareLink({ ...p, key: b64u(new Uint8Array(16)) });
    expect(!bad.ok && bad.reason).toBe("invalid");
    const nf = await openShareLink({ ...p, id: "Zz99999999" });
    expect(!nf.ok && nf.reason).toBe("notfound");
  });

  it("heslo: bez hesla dotaz, špatné odmítne, správné otevře – obsah se stahuje jen jednou", async () => {
    const { calls } = mockServer();
    const r = await createShareLink(sample(), { days: 10, base: BASE, password: "tajné-123" });
    const parsed = parseShareHash(hashOf(r.url))!;
    const gets = () => calls.filter((c) => c.method === "GET" && c.url.includes("?id=")).length;
    const a = await openShareLink(parsed);
    expect(!a.ok && a.reason).toBe("password");
    const b = await openShareLink(parsed, "spatne");
    expect(!b.ok && b.reason).toBe("password");
    const c = await openShareLink(parsed, "tajné-123");
    expect(c.ok && c.payload.doc.name).toBe("Příruba DN50");
    expect(gets()).toBe(1);
  });

  it("vypršení: server vrátí 410 → „expired“ s datem; obsah s prošlou platností se neotevře ani bez serveru", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-11-01T10:00:00Z"));
    mockServer();
    const r = await createShareLink(sample(), { days: 1, base: BASE });
    vi.setSystemTime(new Date("2026-11-03T10:00:00Z"));
    const o = await openShareLink(parseShareHash(hashOf(r.url))!);
    expect(!o.ok && o.reason).toBe("expired");
    expect(!o.ok && o.exp).toBeGreaterThan(Date.parse("2026-11-02T09:00:00Z"));
  });

  it("zneplatnění (DELETE s tokenem) → odkaz už nejde otevřít", async () => {
    const { db, calls } = mockServer();
    const r = await createShareLink(sample(), { days: 10, base: BASE });
    expect(r.del).toBeTruthy();
    expect(await revokeShare(r)).toBe(true);
    expect(db.size).toBe(0);
    const del = calls.find((c) => c.method === "DELETE")!;
    expect(del.headers["X-Delete-Token"]).toBe(r.del);
    const o = await openShareLink(parseShareHash(hashOf(r.url))!);
    expect(!o.ok && o.reason).toBe("notfound");
    expect(await revokeShare({ mode: "link" })).toBe(false);
  });

  it("velký model (importovaný STEP přes mnblob): data binárně, nahrání po částech, příjemce dostane stejná data", async () => {
    const { calls, db } = mockServer({ chunkBytes: 256 * 1024 });
    const step = randomBytes(900_000); // nestlačitelná data → více částí
    const ref = putBlob(step);
    const doc = sample();
    doc.features.push({ id: "imp", name: "Import", type: "import", fileName: "deska.step", format: "step", data: ref } as CadDoc["features"][number]);
    const progress: number[] = [];
    const r = await createShareLink(doc, { days: 30, base: BASE, onProgress: (s, t) => progress.push(s / t) });
    expect(r.mode).toBe("self");
    expect(r.url.length).toBeLessThan(120);
    // base64 by obsah zvětšil o třetinu; binární kontejner jen o hlavičku a JSON
    expect(r.bytes).toBeLessThan(step.length + 4_000);
    const posts = calls.filter((c) => c.method === "POST");
    expect(posts.length).toBe(4);
    expect(posts.every((c) => c.bytes <= 256 * 1024)).toBe(true);
    expect(progress.at(-1)).toBe(1);
    expect([...db.values()][0].data.length).toBe(r.bytes);
    const o = await openShareLink(parseShareHash(hashOf(r.url))!);
    expect(o.ok).toBe(true);
    if (o.ok) {
      const f = o.payload.doc.features.find((x) => x.type === "import") as { data: string };
      expect(f.data).toBe(ref);
      expect(blobOf(f.data)).toEqual(step);
    }
  });

  it("textový STEP se binárně zkomprimuje lépe než base64 v odkazu", async () => {
    mockServer();
    const lines = Array.from({ length: 20_000 }, (_, i) => `#${i + 10}=CARTESIAN_POINT('',(${(i * 0.37).toFixed(3)},${(i * 1.7) % 100}.0,${i % 13}.5));`).join("\n");
    const ref = putBlob(new TextEncoder().encode(lines));
    const doc = sample();
    doc.features.push({ id: "imp", name: "Import", type: "import", fileName: "dil.step", format: "step", data: ref } as CadDoc["features"][number]);
    const r = await createShareLink(doc, { days: 10, base: BASE });
    expect(r.mode).toBe("self");
    // dokument v odkazu: JSON s base64 (embedBlobs) + deflate
    const inLink = (await deflate(new TextEncoder().encode(JSON.stringify({ v: 1, doc: embedBlobs(doc) }))))!.length;
    expect(r.bytes).toBeLessThan(inLink * 0.9);
  });

  it("nad limit úložiště: srozumitelná chyba (MB a limit), nic se nenahraje", async () => {
    const { calls } = mockServer({ maxBytes: 300_000 });
    const doc = sample();
    doc.features.push({ id: "imp", name: "Import", type: "import", fileName: "deska.step", format: "step", data: putBlob(randomBytes(400_000)) } as CadDoc["features"][number]);
    await expect(createShareLink(doc, { days: 10, base: BASE })).rejects.toThrow(/příliš velký.*limit úložiště je 0,3 MB/);
    expect(calls.filter((c) => c.method === "POST").length).toBe(0);
  });
});

describe("výběr úložiště a návrat k odkazu", () => {
  it("server neodpovídá (statický hosting bez PHP) → dokument v odkazu s vysvětlením", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("<html>404</html>", { status: 404, headers: { "content-type": "text/html" } })));
    const r = await createShareLink(sample(), { days: 10, base: BASE });
    expect(r.mode).toBe("link");
    expect(r.url).toContain("#s=1d.");
    expect(r.note).toMatch(/úložiště sdílení na serveru \(\/cad\/share\/\) neodpovídá/);
    expect(await probeSelfStore()).toBeNull();
  });

  it("síťová chyba nebo limit požadavků při nahrání → odkaz s důvodem; bez omezení platnosti → odkaz s důvodem", async () => {
    mockServer({ status: 429 });
    const r = await createShareLink(sample(), { days: 10, base: BASE });
    expect(r.mode).toBe("link");
    expect(r.note).toMatch(/limit za hodinu/);
    resetShareProbe();
    mockServer();
    const n = await createShareLink(sample(), { days: null, base: BASE });
    expect(n.mode).toBe("link");
    expect(n.note).toMatch(/Bez omezení platnosti/);
  });

  it("vynucený režim: self bez serveru = chyba; store bez Supabase = vlastní úložiště; link = v odkazu", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("x", { status: 404 })));
    await expect(createShareLink(sample(), { days: 10, base: BASE, mode: "self" })).rejects.toThrow(/neodpovídá/);
    resetShareProbe();
    mockServer();
    expect((await createShareLink(sample(), { days: 10, base: BASE, mode: "store" })).mode).toBe("self");
    expect((await createShareLink(sample(), { days: 10, base: BASE, mode: "link" })).mode).toBe("link");
  });

  it("Supabase má přednost; když selže, použije se vlastní úložiště", async () => {
    process.env.NEXT_PUBLIC_CAD_SHARE_URL = "https://abc.supabase.co";
    process.env.NEXT_PUBLIC_CAD_SHARE_KEY = "anon";
    try {
      const { fetchMock } = mockServer();
      const inner = fetchMock.getMockImplementation()!;
      const supa: string[] = [];
      fetchMock.mockImplementation(async (input: string, init?: RequestInit) => {
        if (String(input).includes("supabase.co")) {
          supa.push(String(input));
          return new Response("{}", { status: 200 });
        }
        return inner(input, init);
      });
      const r1 = await createShareLink(sample(), { days: 10, base: BASE });
      expect(r1.mode).toBe("store");
      expect(supa.length).toBe(1);
      fetchMock.mockImplementation(async (input: string, init?: RequestInit) => (String(input).includes("supabase.co") ? new Response("{}", { status: 500 }) : inner(input, init)));
      const r2 = await createShareLink(sample(), { days: 10, base: BASE });
      expect(r2.mode).toBe("self");
    } finally {
      delete process.env.NEXT_PUBLIC_CAD_SHARE_URL;
      delete process.env.NEXT_PUBLIC_CAD_SHARE_KEY;
    }
  });

  it("NEXT_PUBLIC_CAD_SHARE_SELF=off vypne vlastní úložiště (žádný ping)", async () => {
    process.env.NEXT_PUBLIC_CAD_SHARE_SELF = "off";
    try {
      const { calls } = mockServer();
      const r = await createShareLink(sample(), { days: 10, base: BASE });
      expect(r.mode).toBe("link");
      expect(calls.length).toBe(0);
    } finally {
      delete process.env.NEXT_PUBLIC_CAD_SHARE_SELF;
    }
  });
});
