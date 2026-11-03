import { afterEach, describe, expect, it, vi } from "vitest";
import { emptyDoc, type CadDoc } from "./types";
import { b64u, createShareLink, LINK_MAX_CHARS, openShareLink, parseShareHash, shareMessage, unb64u } from "./share";

const sample = (): CadDoc => ({
  ...emptyDoc("Příruba DN50"),
  material: "nerez",
  features: [
    { id: "s1", name: "Skica 1", type: "sketch", plane: "XY", entities: [{ kind: "circle", center: [0, 0], r: 82.5 }] } as unknown as CadDoc["features"][number],
    { id: "e1", name: "Vysunutí 1", type: "extrude", sketchId: "s1", distance: 18 } as unknown as CadDoc["features"][number],
  ],
  drawings: [{ id: "d1", name: "Výkres 1" } as unknown as NonNullable<CadDoc["drawings"]>[number]],
});
const BASE = "https://www.mnastrojarna.cz/cad";
/** náhodná (nestlačitelná) data – getRandomValues zvládne max. 65 536 B na volání */
const randomBytes = (n: number) => {
  const out = new Uint8Array(n);
  for (let i = 0; i < n; i += 65_536) crypto.getRandomValues(out.subarray(i, Math.min(n, i + 65_536)));
  return out;
};
const hashOf = (url: string) => url.slice(url.indexOf("#"));

afterEach(() => {
  vi.unstubAllGlobals();
  delete process.env.NEXT_PUBLIC_CAD_SHARE_URL;
  delete process.env.NEXT_PUBLIC_CAD_SHARE_KEY;
});

describe("base64url", () => {
  it("zvládne velká pole (nad limit argumentů String.fromCharCode) a kulatou cestu", () => {
    const big = new Uint8Array(300_000).map((_, i) => (i * 7) % 256);
    const s = b64u(big);
    expect(s).not.toMatch(/[+/=]/);
    expect(unb64u(s)).toEqual(big);
  });
});

describe("sdílení odkazem – dokument v odkazu", () => {
  it("odkaz nese zkomprimovaný dokument, nic se neposílá, po otevření je dokument shodný", async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    const r = await createShareLink(sample(), { days: 10, base: BASE, from: "Vít Volný", view: "drawing" });
    expect(r.mode).toBe("link");
    expect(r.password).toBe(false);
    expect(r.url.startsWith(BASE + "#s=1d.")).toBe(true);
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(r.exp).toBeGreaterThan(Date.now() + 9.9 * 86_400_000);
    const parsed = parseShareHash(hashOf(r.url));
    expect(parsed?.kind).toBe("link");
    const o = await openShareLink(parsed!);
    expect(o.ok).toBe(true);
    if (o.ok) {
      expect(o.payload.doc).toEqual(sample());
      expect(o.payload.from).toBe("Vít Volný");
      expect(o.payload.view).toBe("drawing");
      expect(o.payload.exp).toBe(r.exp);
    }
  });

  it("komprese zmenší dokument a odkaz nese jen base64url (bez znaků +/=)", async () => {
    const doc = sample();
    doc.features = Array.from({ length: 60 }, (_, i) => ({ ...doc.features[1], id: `e${i}`, name: `Vysunutí ${i}` }));
    const r = await createShareLink(doc, { days: null, base: BASE });
    expect(r.exp).toBeNull();
    expect(r.url.length).toBeLessThan(JSON.stringify(doc).length);
    expect(hashOf(r.url).slice(3)).not.toMatch(/[+/=&]/);
    const o = await openShareLink(parseShareHash(hashOf(r.url))!);
    expect(o.ok && o.payload.doc.features.length).toBe(60);
  });

  it("heslo: bez hesla se neotevře, špatné heslo odmítne, správné otevře", async () => {
    const r = await createShareLink(sample(), { days: 1, base: BASE, password: "tajné-123" });
    expect(r.password).toBe(true);
    expect(r.url).toContain("#s=1dp.");
    const parsed = parseShareHash(hashOf(r.url))!;
    expect(parsed.kind === "link" && parsed.salt).toBeTruthy();
    expect((await openShareLink(parsed)).ok).toBe(false);
    expect((await openShareLink(parsed, "spatne")).ok).toBe(false);
    const bad = await openShareLink(parsed, "spatne");
    expect(!bad.ok && bad.reason).toBe("password");
    const good = await openShareLink(parsed, "tajné-123");
    expect(good.ok && good.payload.doc.name).toBe("Příruba DN50");
  });

  it("vypršená platnost se neotevře", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-11-01T10:00:00Z"));
    const r = await createShareLink(sample(), { days: 10, base: BASE });
    vi.setSystemTime(new Date("2026-11-12T10:00:00Z"));
    const o = await openShareLink(parseShareHash(hashOf(r.url))!);
    expect(!o.ok && o.reason).toBe("expired");
    vi.setSystemTime(new Date("2026-11-10T10:00:00Z"));
    expect((await openShareLink(parseShareHash(hashOf(r.url))!)).ok).toBe(true);
    vi.useRealTimers();
  });

  it("neplatné / cizí odkazy se odmítnou", async () => {
    expect(parseShareHash("#x=1")).toBeNull();
    expect(parseShareHash("#s=9z.abc")).toBeNull();
    expect(parseShareHash("")).toBeNull();
    const o = await openShareLink({ kind: "link", compressed: true, salt: null, data: b64u(new Uint8Array([1, 2, 3])) });
    expect(!o.ok && o.reason).toBe("invalid");
    const o2 = await openShareLink({ kind: "link", compressed: false, salt: null, data: b64u(new TextEncoder().encode('{"v":1,"doc":{"app":"jiny"}}')) });
    expect(!o2.ok && o2.reason).toBe("invalid");
  });

  it("příliš velký dokument (importovaná geometrie) bez úložiště skončí srozumitelnou chybou", async () => {
    const doc = sample();
    doc.features.push({ id: "imp", name: "Import", type: "import", fileName: "deska.step", format: "step", data: b64u(randomBytes(LINK_MAX_CHARS)) });
    await expect(createShareLink(doc, { days: 10, base: BASE })).rejects.toThrow(/příliš velký/);
  });

  it("text zprávy obsahuje název, platnost a odkaz", async () => {
    const r = await createShareLink(sample(), { days: 10, base: BASE, password: "x1234" });
    const m = shareMessage("Příruba DN50", r);
    expect(m).toContain("Příruba DN50");
    expect(m).toContain("platí do");
    expect(m).toContain(r.url);
    expect(m).toContain("heslem");
  });
});

describe("sdílení přes úložiště (Supabase Storage, šifrováno – klíč jen v odkazu)", () => {
  const setup = () => {
    process.env.NEXT_PUBLIC_CAD_SHARE_URL = "https://abc.supabase.co/";
    process.env.NEXT_PUBLIC_CAD_SHARE_KEY = "anon-key";
    const objects = new Map<string, Uint8Array>();
    const fetchSpy = vi.fn(async (url: string, init?: RequestInit) => {
      const u = String(url);
      if (init?.method === "POST") {
        const path = u.split("/storage/v1/object/cad-share/")[1];
        expect((init.headers as Record<string, string>).apikey).toBe("anon-key");
        objects.set(path, new Uint8Array(init.body as Uint8Array));
        return new Response(JSON.stringify({ Key: "cad-share/" + path }), { status: 200 });
      }
      const path = u.split("/storage/v1/object/public/cad-share/")[1];
      const b = objects.get(path);
      return b ? new Response(b as BodyInit, { status: 200 }) : new Response("{}", { status: 404 });
    });
    vi.stubGlobal("fetch", fetchSpy);
    return { objects, fetchSpy };
  };

  it("velký dokument jde automaticky do úložiště; na serveru je jen šifrovaný obsah; otevření klíčem z odkazu", async () => {
    const { objects } = setup();
    const doc = sample();
    doc.features.push({ id: "imp", name: "Import", type: "import", fileName: "deska.step", format: "step", data: b64u(randomBytes(20_000)) });
    const r = await createShareLink(doc, { days: 10, base: BASE });
    expect(r.mode).toBe("store");
    expect(r.url).toMatch(/#r=d10~[A-Za-z0-9_-]+\.[A-Za-z0-9_-]{43}$/);
    expect(objects.size).toBe(1);
    const stored = [...objects.values()][0];
    expect(new TextDecoder().decode(stored)).not.toContain("deska.step");
    expect(new TextDecoder().decode(stored)).not.toContain("mnastrojarna-cad");
    const o = await openShareLink(parseShareHash(hashOf(r.url))!);
    expect(o.ok && o.mode).toBe("store");
    expect(o.ok && o.payload.doc.features.length).toBe(3);
  });

  it("malý dokument zůstává v odkazu i s nastaveným úložištěm; vynucené úložiště funguje; heslo chrání i úložiště", async () => {
    const { fetchSpy } = setup();
    const r1 = await createShareLink(sample(), { days: 10, base: BASE });
    expect(r1.mode).toBe("link");
    expect(fetchSpy).not.toHaveBeenCalled();
    const r2 = await createShareLink(sample(), { days: 7, base: BASE, mode: "store", password: "heslo" });
    expect(r2.mode).toBe("store");
    expect(r2.url).toMatch(/\.p[A-Za-z0-9_-]+$/);
    const parsed = parseShareHash(hashOf(r2.url))!;
    expect((await openShareLink(parsed)).ok).toBe(false);
    const bad = await openShareLink(parsed, "jine");
    expect(!bad.ok && bad.reason).toBe("password");
    const ok = await openShareLink(parsed, "heslo");
    expect(ok.ok && ok.payload.doc.name).toBe("Příruba DN50");
  });

  it("smazaný / vypršelý soubor v úložišti → notfound; bez omezení platnosti nelze do úložiště", async () => {
    const { objects } = setup();
    const r = await createShareLink(sample(), { days: 1, base: BASE, mode: "store" });
    objects.clear();
    const o = await openShareLink(parseShareHash(hashOf(r.url))!);
    expect(!o.ok && o.reason).toBe("notfound");
    await expect(createShareLink(sample(), { days: null, base: BASE, mode: "store" })).rejects.toThrow(/platnost/);
  });
});
