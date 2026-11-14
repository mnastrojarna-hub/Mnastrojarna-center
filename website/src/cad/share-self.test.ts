import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { blobOf, embedBlobs, putBlob } from "./blobs";
import { createShareLink, deflate, deriveShareCode, openErrorText, openShareLink, parseShareHash, probeSelfStore, resetShareProbe, revokeShare, shareCryptoOk, shareMessage } from "./share";
import { emptyDoc, type CadDoc } from "./types";

/**
 * Krátký odkaz přes vlastní úložiště na webu (/cad/share/, PHP) – klient proti napodobenému serveru (stejný protokol jako
 * public/cad/share/index.php; skutečný PHP server testuje share-php.test.ts). Nové odkazy mají tvar <základ>/s#<KÓD>
 * (kód → id + klíč, share-short.test.ts); starší #q=<id>.<klíč> se dál otevírají a vznikají jen proti starší verzi serveru.
 */
const ORIGIN = "https://www.mnastrojarna.cz";
const BASE = ORIGIN + "/cad";
const STORE = ORIGIN + "/cad/share/";
/** nejkratší odkaz na produkci: https://mnastrojarna.cz/s#<10 znaků base58> = 36 znaků */
const SHORT_RE = /^https:\/\/mnastrojarna\.cz\/s#[1-9A-HJ-NP-Za-km-z]{10}$/;
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
/** napodobený PHP server: ping, nahrání po částech, stažení, 404/410, mazání tokenem, náhrobky (jednou použité id se nepřidělí znovu) */
function mockServer(opts: { maxBytes?: number; chunkBytes?: number; down?: boolean; status?: number; /** starší skript: ?ping v = 1, id přiděluje server */ legacy?: boolean; /** kolik prvních založení s id od klienta skončí 409 */ taken?: number } = {}) {
  const maxBytes = opts.maxBytes ?? 25 * 1024 * 1024;
  const chunkBytes = opts.chunkBytes ?? 8 * 1024 * 1024;
  const db = new Map<string, Entry>();
  /** náhrobky: id zneplatněných (bez data) a vypršelých (s koncem platnosti) odkazů */
  const dead = new Map<string, number | null>();
  const calls: { method: string; url: string; bytes: number; headers: Record<string, string> }[] = [];
  let n = 0;
  let taken = opts.taken ?? 0;
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
    if (method === "GET" && q.has("ping")) return json(200, { ok: true, v: opts.legacy ? 1 : 2, max_bytes: maxBytes, chunk_bytes: chunkBytes, max_days: 90 });
    if (opts.status) return json(opts.status, { ok: false, error: "x" });
    if (method === "POST" && (!q.has("id") || (!q.has("offset") && q.has("days") && !opts.legacy))) {
      expect(headers["Content-Type"]).toBe("application/octet-stream");
      const total = Number(q.get("total"));
      const days = Number(q.get("days"));
      if (!(days >= 1 && days <= 90)) return json(400, { error: "invalid_days" });
      if (total > maxBytes || body.length > chunkBytes) return json(413, { error: "too_large", max_bytes: maxBytes });
      const given = q.get("id");
      if (given !== null && !/^[1-9A-HJ-NP-Za-km-z]{11}$/.test(given)) return json(400, { error: "invalid_id" });
      if (given !== null && (db.has(given) || dead.has(given) || taken-- > 0)) return json(409, { error: "id_taken" });
      const id = given ?? "Ab" + String(++n).padStart(8, "0");
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
      if (!e && dead.has(id)) return dead.get(id) === null ? json(410, { error: "revoked" }) : json(410, { error: "expired", exp: dead.get(id) });
      if (!e || !e.done) return json(404, { error: "not_found" });
      if (e.exp * 1000 < Date.now()) {
        db.delete(id);
        dead.set(id, e.exp);
        return json(410, { error: "expired", exp: e.exp });
      }
      return new Response(e.data as BodyInit, { status: 200, headers: { "content-type": "application/octet-stream" } });
    }
    if (method === "DELETE") {
      const e = db.get(q.get("id")!);
      if (!e) return json(404, { error: "not_found" });
      if (headers["X-Delete-Token"] !== e.del) return json(403, { error: "bad_token" });
      db.delete(q.get("id")!);
      dead.set(q.get("id")!, null);
      return json(200, { ok: true });
    }
    return json(405, { error: "method_not_allowed" });
  });
  vi.stubGlobal("fetch", fetchMock);
  return { db, dead, calls, fetchMock };
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
  it("nejkratší odkaz: https://mnastrojarna.cz/s#<kód 10> = 36 znaků; id na serveru je odvozené z kódu; heslo odkaz neprodlouží", async () => {
    const { db, calls } = mockServer();
    const r = await createShareLink(sample(), { days: 10, base: BASE });
    expect(r.mode).toBe("self");
    expect(r.url).toMatch(SHORT_RE);
    expect(r.url.length).toBe(36);
    expect(r.url).not.toMatch(/\s/);
    expect(r.note).toBeUndefined();
    expect(r.code).toBe(r.url.slice(-10));
    // id v úložišti = odvozené z kódu (server ho nepřiděluje) a v odkazu není
    expect(r.id).toBe((await deriveShareCode(r.code!)).id);
    expect([...db.keys()]).toEqual([r.id]);
    expect(r.url).not.toContain(r.id!);
    expect(calls.find((c) => c.method === "POST")!.url).toContain(`&id=${r.id}`);
    // kód (část za #) se na server nikdy neposílá
    expect(calls.some((c) => c.url.includes(r.code!))).toBe(false);
    const rp = await createShareLink(sample(), { days: 10, base: BASE, password: "tajne" });
    expect(rp.password).toBe(true);
    expect(rp.url).toMatch(SHORT_RE);
    expect(rp.url.length).toBe(r.url.length);
  });

  it("základ odkazu podle stránky: /en/cad → /en/s, /de/cad → /de/s, jiný web → <původ>/s, stránka mimo /cad → #KÓD za její adresou", async () => {
    mockServer();
    const en = await createShareLink(sample(), { days: 1, base: ORIGIN + "/en/cad" });
    expect(en.url).toMatch(/^https:\/\/mnastrojarna\.cz\/en\/s#[1-9A-HJ-NP-Za-km-z]{10}$/);
    expect(en.url.length).toBeLessThanOrEqual(40);
    const de = await createShareLink(sample(), { days: 1, base: ORIGIN + "/de/cad/" }); // statický export: lomítko na konci
    expect(de.url).toMatch(/^https:\/\/mnastrojarna\.cz\/de\/s#[1-9A-HJ-NP-Za-km-z]{10}$/);
    // bez `base`: adresa aktuální stránky (location)
    const cur = await createShareLink(sample(), { days: 1 });
    expect(cur.url).toMatch(SHORT_RE);
    // jiné nasazení (náhled, localhost): „www.“ se neodebírá, port zůstává
    vi.stubGlobal("location", { origin: "http://localhost:3431", pathname: "/cad", hash: "" });
    resetShareProbe();
    const inner = mockServer().fetchMock;
    vi.stubGlobal("fetch", (input: string, init?: RequestInit) => inner(String(input).replace("http://localhost:3431", ORIGIN), init));
    const local = await createShareLink(sample(), { days: 1 });
    expect(local.url).toMatch(/^http:\/\/localhost:3431\/s#[1-9A-HJ-NP-Za-km-z]{10}$/);
    const other = await createShareLink(sample(), { days: 1, base: "http://localhost:3431/nastroje/cad-embed" });
    expect(other.url).toMatch(/^http:\/\/localhost:3431\/nastroje\/cad-embed#[1-9A-HJ-NP-Za-km-z]{10}$/);
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
    // nový tvar: jen kód
    expect(parseShareHash("#Ab3kZ9xQ2m")).toEqual({ kind: "code", code: "Ab3kZ9xQ2m" });
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
    expect(m.split("\n").find((l) => l.includes("/s#"))).toBe(r.url);
    // obsah „MNQ“ v2: bez soli v hlavičce, id ani klíč v něm nejsou
    expect(stored.data[3]).toBe(2);
    expect(text).not.toContain(r.code!);
    expect(text).not.toContain(r.id!);
  });

  it("neznámý kód → nenalezeno; obsah podstrčený pod cizí id (jiný klíč) → neplatný", async () => {
    const { db } = mockServer();
    const r = await createShareLink(sample(), { days: 1, base: BASE });
    const nf = await openShareLink({ kind: "code", code: "Zz99999999" });
    expect(!nf.ok && nf.reason).toBe("notfound");
    // kód o jeden znak vedle: jiné id → nenalezeno (žádné „skoro správně“)
    const near = r.code!.slice(0, 9) + (r.code!.endsWith("2") ? "3" : "2");
    const nf2 = await openShareLink({ kind: "code", code: near });
    expect(!nf2.ok && nf2.reason).toBe("notfound");
    // server (nebo útočník s přístupem k úložišti) přesune šifrovaný obsah pod id jiného kódu → klíč nesedí
    const other = "Ab3kZ9xQ2m";
    db.set((await deriveShareCode(other)).id, db.get(r.id!)!);
    const bad = await openShareLink({ kind: "code", code: other });
    expect(!bad.ok && bad.reason).toBe("invalid");
    // poškozený obsah (změněný bajt) → neplatný (AES-GCM ověřuje i hlavičku)
    const e = db.get(r.id!)!;
    const broken = e.data.slice();
    broken[4] ^= 2;
    db.set(r.id!, { ...e, data: broken });
    resetShareProbe();
    const tampered = await openShareLink(parseShareHash(hashOf(r.url))!);
    expect(!tampered.ok && tampered.reason).toBe("invalid");
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
    // samotný kód dokument neotevře: klíč odvozený jen z kódu obsah nedešifruje
    expect(parsed).toEqual({ kind: "code", code: r.code });
    const d = await deriveShareCode(r.code!);
    const dp = await deriveShareCode(r.code!, "tajné-123");
    expect(dp.id).toBe(d.id);
    expect(Buffer.from(dp.key).equals(Buffer.from(d.key))).toBe(false);
    resetShareProbe();
    // heslo se normalizuje (NFKC) a okrajové mezery se ignorují
    const spaced = await openShareLink(parsed, "  tajne\u0301-123 ");
    expect(spaced.ok).toBe(true);
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

  it("zneplatnění (DELETE s tokenem) → odkaz už nejde otevřít: „zneplatněn odesílatelem“ (ne „nenalezeno“)", async () => {
    const { db, calls } = mockServer();
    const r = await createShareLink(sample(), { days: 10, base: BASE });
    expect(r.del).toBeTruthy();
    expect(await revokeShare(r)).toBe(true);
    expect(db.size).toBe(0);
    const del = calls.find((c) => c.method === "DELETE")!;
    expect(del.headers["X-Delete-Token"]).toBe(r.del);
    const o = await openShareLink(parseShareHash(hashOf(r.url))!);
    expect(o).toEqual({ ok: false, reason: "revoked" });
    expect(openErrorText("revoked")).toMatch(/Odesílatel tento sdílený odkaz zneplatnil/);
    expect(await revokeShare({ mode: "link" })).toBe(false);
  });

  it("stránka na http:// (bez WebCrypto): vytvoření skončí srozumitelnou chybou, otevření důvodem „insecure“ – žádná chyba JavaScriptu", async () => {
    // (revize: na http:// spadlo sdílení na „Cannot read properties of undefined (reading 'importKey')“ a platný kód se hlásil jako neplatný odkaz)
    const { calls } = mockServer();
    const r = await createShareLink(sample(), { days: 10, base: BASE });
    const realCrypto = globalThis.crypto;
    vi.stubGlobal("crypto", { getRandomValues: realCrypto.getRandomValues.bind(realCrypto) }); // jako prohlížeč na http://: crypto.subtle chybí
    try {
      expect(shareCryptoOk()).toBe(false);
      const before = calls.length;
      await expect(createShareLink(sample(), { days: 10, base: BASE })).rejects.toThrow(/zabezpečené připojení.*https:\/\//);
      await expect(createShareLink(sample(), { days: 10, base: BASE, mode: "self" })).rejects.toThrow(/https:\/\//);
      await expect(createShareLink(sample(), { days: 10, base: BASE, mode: "link", password: "x" })).rejects.toThrow(/https:\/\//);
      expect(await openShareLink(parseShareHash(hashOf(r.url))!)).toEqual({ ok: false, reason: "insecure" });
      expect(await openShareLink({ kind: "self", id: "Ab12345678", key: "AAAAAAAAAAAAAAAAAAAAAA" })).toEqual({ ok: false, reason: "insecure" });
      expect(calls.length).toBe(before); // na server se nic neposlalo
      expect(openErrorText("insecure")).toMatch(/https:\/\//);
      // dokument v odkazu bez hesla šifrování nepotřebuje – funguje dál jako dřív
      const l = await createShareLink(sample(), { days: 10, base: BASE, mode: "link" });
      expect(l.mode).toBe("link");
      const o = await openShareLink(parseShareHash(hashOf(l.url))!);
      expect(o.ok && o.payload.doc.name).toBe("Příruba DN50");
    } finally {
      vi.stubGlobal("crypto", realCrypto);
    }
    expect(shareCryptoOk()).toBe(true);
  });

  it("jednou použité id se nepřidělí znovu: po zneplatnění i po vypršení dá stejný kód 409 a vylosuje se jiný", async () => {
    const { dead } = mockServer();
    const r = await createShareLink(sample(), { days: 10, base: BASE });
    expect(await revokeShare(r)).toBe(true);
    expect([...dead.keys()]).toEqual([r.id]);
    const A58 = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
    const real = crypto.getRandomValues.bind(crypto);
    let forced = 1;
    const spy = vi.spyOn(crypto, "getRandomValues").mockImplementation(((a: Uint8Array) => {
      if (a.length !== 24 || forced-- <= 0) return real(a);
      a.fill(0);
      [...r.code!].forEach((ch, i) => (a[i] = A58.indexOf(ch)));
      return a;
    }) as typeof crypto.getRandomValues);
    try {
      const again = await createShareLink({ ...sample(), name: "Podvrh" }, { days: 90, base: BASE });
      expect(again.code).not.toBe(r.code);
      expect(again.id).not.toBe(r.id);
    } finally {
      spy.mockRestore();
    }
    const o = await openShareLink(parseShareHash(hashOf(r.url))!);
    expect(!o.ok && o.reason).toBe("revoked");
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
    expect(r.url).toMatch(SHORT_RE);
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
  }, 30_000);

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

  it("id už v úložišti je (409): vylosuje se nový kód – nejvýš 3 pokusy, pak dokument v odkazu s důvodem", { timeout: 60_000 }, async () => {
    const a = mockServer({ taken: 2 });
    const r = await createShareLink(sample(), { days: 10, base: BASE });
    expect(r.mode).toBe("self");
    expect(r.url).toMatch(SHORT_RE);
    const posts = a.calls.filter((c) => c.method === "POST");
    expect(posts.length).toBe(3);
    expect(new Set(posts.map((c) => new URL(c.url).searchParams.get("id"))).size).toBe(3); // pokaždé jiný kód → jiné id
    expect([...a.db.keys()]).toEqual([r.id]);
    const o = await openShareLink(parseShareHash(hashOf(r.url))!);
    expect(o.ok && o.payload.doc.name).toBe("Příruba DN50");
    resetShareProbe();
    const b = mockServer({ taken: 6 });
    const f = await createShareLink(sample(), { days: 10, base: BASE });
    expect(f.mode).toBe("link");
    expect(f.note).toMatch(/409 id_taken/);
    expect(b.calls.filter((c) => c.method === "POST").length).toBe(3);
    await expect(createShareLink(sample(), { days: 10, base: BASE, mode: "self" })).rejects.toThrow(/409 id_taken/);
  });
});

describe("starší odkazy #q=<id>.<klíč> (vlna 8) – otevírají se dál", () => {
  // skutečný výstup kódu z bf91b0b (createShareLink před zavedením kódu): obsah „MNQ“ v1, platnost do 1. 4. 2099
  const OLD = {
    plain: {
      hash: "#q=Ab00000001.Y3zVVDBJ_a0QdUpYKLUKMw",
      exp: 4078684800000,
      blob: "TU5RAQaMcYjIzb7dlc+EExElws+GCge7HL2l9HmOqBUbgUaDvsVbjky4ZUwBaM4FZwbNHakxADfivBj+fXZznElCy8/01+Bdcrr9toc1f3pL2okH6wh/5eOqEhevkLARP175DP+3fsrJ78w2BSiikDoeoYvlr6x9wazbKv0/MdSElx786ailHkpmnv+WW7d9rlv44I0nDaTfPxRyNfkjSXwBqhj/YAfMieZdxB7Ua84PbH3iCon2GY132KWLPFHpqSQcw8koZdwKtygFSBU8sl3I2ad9+QhjEq+IFsNca3Aw3169deLDL3XzSKkFhGhwe6S3xn1kqk8KS7jsDvTz+HPBKJ0lxyrYoqmlrSnvZvF20Du8ZwYQmqE=",
    },
    password: {
      hash: "#q=Ab00000002.-R90YqFaLuKvVhfP2Nk4FQ",
      exp: 4078684800000,
      blob: "TU5RAQcgOlPMIWKbJBsrVknBjEg24NVYNtRNXQ80rBAi65UT2J9DpX2q2hLNSsrOAx3TkHBofJUTA9AxHjosUC9I/W0iWttmW0DptKsHbSnA7EsJgpOpyjEk+eOTF8jqo7YI+dI3nDAbEVzEZaH3eZDDJT3nm3RnpV+PKV0WppJMadm+9TiHZLoe7Cc8+8GFq914Hp4CJJ4D1NhswYINOT42FG4tPGi6+xv4ubG6FvdUiOh4XFDGVlZ9tWKjkib9IyIOE5AmLZvwZnjsJF2GwEsfJ7dtHPYF3O0Zb9zqyi+BNRQL5MWuIj6lk2JaY27bs1h0Lma+CspWp1AUpUNok+vQd6cbLAHhpIaKTOpFAYNEH5YQnDJrzD8=",
    },
  };
  const put = (db: Map<string, Entry>, id: string, b64: string) => {
    const data = new Uint8Array(Buffer.from(b64, "base64"));
    db.set(id, { data, total: data.length, exp: Math.floor(Date.now() / 1000) + 86_400, del: "x".repeat(24), done: true });
  };

  it("starý odkaz bez hesla i s heslem se otevře beze změny (obsah vytvořený původním kódem)", async () => {
    const { db } = mockServer();
    put(db, "Ab00000001", OLD.plain.blob);
    put(db, "Ab00000002", OLD.password.blob);
    const p = parseShareHash(OLD.plain.hash)!;
    expect(p).toEqual({ kind: "self", id: "Ab00000001", key: "Y3zVVDBJ_a0QdUpYKLUKMw" });
    const o = await openShareLink(p);
    expect(o.ok).toBe(true);
    if (o.ok) {
      expect(o.mode).toBe("self");
      expect(o.payload.doc).toEqual(sample());
      expect(o.payload.from).toBe("Vít Volný");
      expect(o.payload.exp).toBe(OLD.plain.exp);
    }
    const pp = parseShareHash(OLD.password.hash)!;
    const need = await openShareLink(pp);
    expect(!need.ok && need.reason).toBe("password");
    const bad = await openShareLink(pp, "spatne");
    expect(!bad.ok && bad.reason).toBe("password");
    const good = await openShareLink(pp, "tajne");
    expect(good.ok && good.payload.doc.name).toBe("Příruba DN50");
    // starý klíč k cizímu obsahu nepasuje
    const cross = await openShareLink({ kind: "self", id: "Ab00000002", key: "Y3zVVDBJ_a0QdUpYKLUKMw" }, "tajne");
    expect(!cross.ok && cross.reason).toBe("password");
  });

  it("starší skript úložiště (?ping v = 1, id přiděluje server): vznikne starší tvar #q= s vysvětlením a jde otevřít i zneplatnit", async () => {
    const { db, calls } = mockServer({ legacy: true });
    const r = await createShareLink(sample(), { days: 10, base: BASE, password: "tajne" });
    expect(r.mode).toBe("self");
    expect(r.url).toMatch(/^https:\/\/www\.mnastrojarna\.cz\/cad#q=[0-9A-Za-z]{10}\.[A-Za-z0-9_-]{22}$/);
    expect(r.code).toBeUndefined();
    expect(r.note).toMatch(/starší verze/);
    expect(calls.find((c) => c.method === "POST")!.url).not.toContain("&id=");
    expect([...db.values()][0].data[3]).toBe(1);
    const p = parseShareHash(hashOf(r.url))!;
    expect((await openShareLink(p)).ok).toBe(false);
    const o = await openShareLink(p, "tajne");
    expect(o.ok && o.payload.doc.name).toBe("Příruba DN50");
    expect(await revokeShare(r)).toBe(true);
    expect(db.size).toBe(0);
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
