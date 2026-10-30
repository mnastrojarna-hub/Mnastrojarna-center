import { describe, it, expect, beforeAll, afterEach } from "vitest";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { makePhoto, makeVectorDrawing, type SampleDrawing, type SamplePhoto } from "./__fixtures__/samples";
import { setFakeAnonHandler, resetFakeAnonCalls, fakeAnonCalls, type FakeAnonRequest } from "./detect-ai";
import { decodeImage } from "./image";
import { anonymizeImage } from "./photo-pipeline";
import { inkFraction, type Raster } from "./pdf-raster";
import { DEFAULT_REDACT, makeTerms, type RuleContext } from "./rules";
import { runVision } from "./vision";
import { decideAnonStatus } from "./decide";

/**
 * Fotka výkresu (4032×3024, EXIF orientace 6, natočení 7°, vizitka vedle listu) s fake AI:
 * přehled → narovnání a ořez listu → výřezy → OCR řádky → pravidla → vypálení polygonů → ověření.
 */

const SHOTS = process.env.ANON_SHOTS || "";
const ctx = (): RuleContext => ({ terms: makeTerms(["Strojmetal"], "crm"), keepTerms: ["Mnástrojárna"], redact: { ...DEFAULT_REDACT } });
const AI = { apiKey: "x", model: "claude-opus-5-5", deadline: Date.now() + 10 * 60_000, sha: "a".repeat(64) };

const CATEGORY: Record<string, string> = {
  company: "company", address: "contact", phone: "contact", web: "contact", email: "contact", drawnBy: "person", checkedBy: "person", formField: "person",
};
const KEEP: Record<string, string> = { drawingNumber: "drawingNumber", material: "material", rev: "revision", title: "title" };

type ToW = (x: number, y: number) => [number, number];

function textQuad(s: SampleDrawing, p: SamplePhoto, key: string): number[] {
  const t = s.texts.find((x) => x.key === key)!;
  const w = t.text.length * t.size * 0.52;
  const top = t.y + t.size * 0.95, bottom = t.y - t.size * 0.25;
  return [p.map(t.x, top), p.map(t.x + w, top), p.map(t.x + w, bottom), p.map(t.x, bottom)].flat();
}

function toTile(q: number[], toW: ToW, crop: { x: number; y: number }, sc: number): number[] {
  const out: number[] = [];
  for (let i = 0; i < 8; i += 2) {
    const [wx, wy] = toW(q[i], q[i + 1]);
    out.push(Math.round((wx - crop.x) * sc), Math.round((wy - crop.y) * sc));
  }
  return out;
}

function handler(s: SampleDrawing, p: SamplePhoto, scenario: "clean" | "leak-then-clean" | "leak-always" | "missing-keep" | "fallback") {
  return (req: FakeAnonRequest) => {
    if (req.call === "overview") {
      const im = req.images[0];
      const sc = im.s;
      const tbCorners = [p.map(s.width - 540, 200), p.map(s.width - 20, 200), p.map(s.width - 20, 20), p.map(s.width - 540, 20)];
      const xs = tbCorners.map((c) => c[0] * sc), ys = tbCorners.map((c) => c[1] * sc);
      const data = {
        isDrawing: true, sheet: p.sheet.map((v) => Math.round(v * sc)), angleDeg: p.angleDeg,
        titleBlock: { x: Math.round(Math.min(...xs)), y: Math.round(Math.min(...ys)), w: Math.round(Math.max(...xs) - Math.min(...xs)), h: Math.round(Math.max(...ys) - Math.min(...ys)) },
        revisions: { x: 0, y: 0, w: 0, h: 0 },
        candidates: [s.vectorLogo].map((L) => {
          const c = [p.map(L.x, L.y + L.h), p.map(L.x + L.w, L.y), p.map(L.x, L.y), p.map(L.x + L.w, L.y + L.h)];
          const cx = c.map((q) => q[0] * sc), cy = c.map((q) => q[1] * sc);
          return { x: Math.round(Math.min(...cx)), y: Math.round(Math.min(...cy)), w: Math.round(Math.max(...cx) - Math.min(...cx)), h: Math.round(Math.max(...cy) - Math.min(...cy)), kind: "logo" };
        }),
        confidence: 0.94,
      };
      return scenario === "fallback" ? { data, model: "claude-sonnet-5-5" } : data;
    }
    const toW = req.extra?.toWorking as ToW;
    if (req.call === "lines") {
      return {
        tiles: req.images.map((im) => {
          const lines = s.texts.flatMap((t) => {
            const q = toTile(textQuad(s, p, t.key), toW, im.crop, im.s);
            const cx = (q[0] + q[4]) / 2, cy = (q[1] + q[5]) / 2;
            if (cx < 0 || cy < 0 || cx > im.outW || cy > im.outH || q.some((v, i) => v < -2 || v > (i % 2 === 0 ? im.outW : im.outH) + 2)) return [];
            const redact = t.sensitive && t.key !== "path"; // cestu „zapomene" AI → pojistka pravidel
            return [{ quad: q, text: t.text, redact, category: CATEGORY[t.key] ?? "other", reason: redact ? "owner_company" : "other", keepField: KEEP[t.key] ?? "none" }];
          });
          const graphics = [s.logo, s.vectorLogo].flatMap((L) => {
            const lq = toTile([p.map(L.x, L.y + L.h), p.map(L.x + L.w, L.y + L.h), p.map(L.x + L.w, L.y), p.map(L.x, L.y)].flat(), toW, im.crop, im.s);
            const inside = lq.every((v, i) => v >= 0 && v <= (i % 2 === 0 ? im.outW : im.outH));
            return inside ? [{ quad: lq, kind: "logo", confidence: 0.9 }] : [];
          });
          return { img: im.index, lines, graphics };
        }),
        confidence: 0.92,
      };
    }
    if (req.call === "verify") {
      const round = Number(req.extra?.round ?? 0);
      return {
        tiles: req.images.map((im) => {
          const keepTexts = s.texts.filter((t) => !t.sensitive).filter((t) => {
            const q = toTile(textQuad(s, p, t.key), toW, im.crop, im.s);
            const cx = (q[0] + q[4]) / 2, cy = (q[1] + q[5]) / 2;
            return cx >= 0 && cy >= 0 && cx <= im.outW && cy <= im.outH;
          }).map((t) => t.text).filter((t) => !(scenario === "missing-keep" && t === "D-1234-01"));
          const leak = (scenario === "leak-always" || (scenario === "leak-then-clean" && round === 0)) && im.label === "razítko";
          return { img: im.index, lines: [...keepTexts, ...(scenario === "leak-always" && leak ? ["STROJMETAL"] : [])], graphics: leak && scenario === "leak-then-clean" ? [{ quad: [10, 10, 60, 10, 60, 40, 10, 40], description: "logo firmy (červený štít)" }] : [] };
        }),
      };
    }
    return null;
  };
}

async function save(name: string, r: Raster) {
  if (!SHOTS) return;
  const sharp = (await import("sharp")).default;
  mkdirSync(SHOTS, { recursive: true });
  writeFileSync(path.join(SHOTS, name), await sharp(Buffer.from(r.data), { raw: { width: r.width, height: r.height, channels: r.channels } }).resize({ width: 1600 }).png().toBuffer());
}

describe("anonymizace fotky výkresu", () => {
  let s: SampleDrawing;
  let p: SamplePhoto;
  const prevFake = process.env.AI_FAKE_ANON;
  beforeAll(async () => {
    s = await makeVectorDrawing({ withAttachment: false });
    p = await makePhoto(s);
    process.env.AI_FAKE_ANON = mkdtempSync(path.join(os.tmpdir(), "anon-fake-"));
  }, 120_000);
  afterEach(() => {
    setFakeAnonHandler(null);
    resetFakeAnonCalls();
  });

  it("EXIF orientace se zapeče, list se narovná a ořízne (vizitka pryč), citlivá místa jsou vypálená", async () => {
    setFakeAnonHandler(handler(s, p, "clean"));
    const src = await decodeImage(p.jpeg);
    expect([src.width, src.height]).toEqual([p.width, p.height]);
    await save("photo-before.png", src);
    const v = await runVision({ raster: src, mode: "photo", page: 1, ctx: ctx(), ai: AI, verify: true, fill: "background" });
    await save("photo-after.png", v.raster);
    expect(fakeAnonCalls("overview")).toBe(1);
    expect(fakeAnonCalls("lines")).toBe(1);
    expect(fakeAnonCalls("verify")).toBe(1);
    expect(v.verifyClean).toBe(true);
    expect(v.verifyKeepPresent).toBe(true);
    expect(v.raster.width).toBeLessThan(p.width);
    // vizitka je mimo výstup nebo vybílená
    const [cx, cy] = v.toOutput(p.card.x + p.card.w / 2, p.card.y + p.card.h / 2);
    expect(cx < 0 || cy < 0 || cx >= v.raster.width || cy >= v.raster.height || inkFraction(v.raster, { x: cx - 50, y: cy - 20, w: 100, h: 40 }) < 0.01).toBe(true);
    const cats = new Set(v.regions.map((r) => r.category));
    for (const c of ["company", "person", "contact", "path", "logo"]) expect(cats.has(c as never), c).toBe(true);
    // pravidla chytila cestu, kterou AI nevrátila
    expect(v.regions.some((r) => r.category === "path" && r.source === "rule")).toBe(true);
    const at = (key: string) => {
      const q = textQuad(s, p, key);
      const pts = [0, 2, 4, 6].map((i) => v.toOutput(q[i], q[i + 1]));
      const xs = pts.map((x) => x[0]), ys = pts.map((x) => x[1]);
      return { x: Math.min(...xs), y: Math.min(...ys), w: Math.max(...xs) - Math.min(...xs), h: Math.max(...ys) - Math.min(...ys) };
    };
    for (const k of ["company", "drawnBy", "phone", "path"]) expect(inkFraction(v.raster, at(k)), k).toBeLessThan(0.01);
    const L = s.vectorLogo;
    const lp = [v.toOutput(...p.map(L.x, L.y)), v.toOutput(...p.map(L.x + L.w, L.y + L.h))];
    const lb = { x: Math.min(lp[0][0], lp[1][0]), y: Math.min(lp[0][1], lp[1][1]), w: Math.abs(lp[1][0] - lp[0][0]), h: Math.abs(lp[1][1] - lp[0][1]) };
    expect(inkFraction(v.raster, lb), "vektorové logo").toBeLessThan(0.01);
    for (const k of ["drawingNumber", "material", "dim1"]) expect(inkFraction(v.raster, at(k)), k).toBeGreaterThan(0.01);
    expect(v.pxPerMm).toBeGreaterThan(6);
  }, 120_000);

  it("výstup bez EXIF/GPS, JPEG, rozměry narovnaného ořezu; rozhodnutí done", async () => {
    setFakeAnonHandler(handler(s, p, "clean"));
    const r = await anonymizeImage({ bytes: p.jpeg, hasMaster: true, ctx: ctx(), ai: AI, verify: true, fill: "background" });
    expect(r.unsupported).toBeNull();
    expect(r.outputProblems).toEqual([]);
    expect(r.mime).toBe("image/jpeg");
    const sharp = (await import("sharp")).default;
    const m = await sharp(Buffer.from(r.bytes!)).metadata();
    expect(m.exif).toBeUndefined();
    expect(m.icc).toBeUndefined();
    expect(m.orientation).toBeUndefined();
    const d = decideAnonStatus({
      mode: "full", method: "image", aiUsed: r.aiUsed, modelFallback: r.fallback, confidence: r.confidence, ruleHitsCovered: true, outputChecksPassed: true,
      verifyClean: r.verifyClean, verifyKeepPresent: r.verifyKeepPresent, pxPerMm: r.pxPerMm, isPhoto: true, hasMaster: true, warnings: r.warnings,
      customerStandard: r.customerStandard, termInKeep: r.termInKeep, titleBlockFound: r.titleBlockFound,
    });
    expect(d.status, JSON.stringify(d.warnings)).toBe("done");
    expect(r.cache?.pages[1]?.lines).toBeTruthy();
  }, 120_000);

  it("ověření: únik v 1. kole → doplnění a 2. kolo čisté", async () => {
    setFakeAnonHandler(handler(s, p, "leak-then-clean"));
    const src = await decodeImage(p.jpeg);
    const v = await runVision({ raster: src, mode: "photo", page: 1, ctx: ctx(), ai: AI, verify: true, fill: "white" });
    expect(fakeAnonCalls("verify")).toBe(2);
    expect(v.verifyClean).toBe(true);
  }, 120_000);

  it("ověření: únik i ve 2. kole → review; chybějící číslo výkresu → review", async () => {
    setFakeAnonHandler(handler(s, p, "leak-always"));
    const src = await decodeImage(p.jpeg);
    const v = await runVision({ raster: src, mode: "photo", page: 1, ctx: ctx(), ai: AI, verify: true, fill: "white" });
    expect(v.verifyClean).toBe(false);
    resetFakeAnonCalls();
    setFakeAnonHandler(handler(s, p, "missing-keep"));
    const v2 = await runVision({ raster: src, mode: "photo", page: 1, ctx: ctx(), ai: AI, verify: true, fill: "white" });
    expect(v2.verifyKeepPresent).toBe(false);
    const d = decideAnonStatus({
      mode: "full", method: "image", aiUsed: true, modelFallback: false, confidence: 0.95, ruleHitsCovered: true, outputChecksPassed: true,
      verifyClean: v2.verifyClean, verifyKeepPresent: v2.verifyKeepPresent, pxPerMm: 8, isPhoto: true, hasMaster: true, warnings: [],
      customerStandard: false, termInKeep: false, titleBlockFound: true,
    });
    expect(d.status).toBe("review");
  }, 120_000);

  it("fallback modelu → review; fotka 4032 px bez masteru = originál (prohlížeč ji nezmenšil)", async () => {
    setFakeAnonHandler(handler(s, p, "fallback"));
    const r = await anonymizeImage({ bytes: p.jpeg, hasMaster: false, ctx: ctx(), ai: AI, verify: false, fill: "white" });
    expect(r.fallback).toBe(true);
    expect(r.hasMaster).toBe(true);
    expect(r.warnings.some((w) => w.code === "no_master")).toBe(false);
    const d = decideAnonStatus({
      mode: "full", method: "image", aiUsed: true, modelFallback: r.fallback, confidence: r.confidence, ruleHitsCovered: true, outputChecksPassed: true,
      verifyClean: r.verifyClean, verifyKeepPresent: r.verifyKeepPresent, pxPerMm: r.pxPerMm, isPhoto: true, hasMaster: r.hasMaster, warnings: r.warnings,
      customerStandard: false, termInKeep: false, titleBlockFound: true,
    });
    expect(d.status).toBe("review");
    expect(d.warnings.map((w) => w.code)).toEqual(expect.arrayContaining(["model_fallback"]));
  }, 120_000);

  it("zmenšená fotka z prohlížeče (JPEG ≤ 2400 px) bez masteru → no_master; PNG je vždy originál", async () => {
    const sharp = (await import("sharp")).default;
    setFakeAnonHandler(() => null);
    const small = new Uint8Array(await sharp(Buffer.from(p.jpeg)).rotate().resize({ width: 2400 }).jpeg({ quality: 85 }).toBuffer());
    const r = await anonymizeImage({ bytes: small, hasMaster: false, ctx: ctx(), ai: null, verify: false, fill: "white" });
    expect(r.hasMaster).toBe(false);
    expect(r.warnings.some((w) => w.code === "no_master")).toBe(true);
    const png = new Uint8Array(await sharp(Buffer.from(small)).resize({ width: 1200 }).png().toBuffer());
    const r2 = await anonymizeImage({ bytes: png, hasMaster: false, ctx: ctx(), ai: null, verify: false, fill: "white" });
    expect(r2.hasMaster).toBe(true);
    expect(r2.warnings.some((w) => w.code === "no_master")).toBe(false);
  }, 120_000);

  it("vícestránkový TIFF → PDF se všemi stránkami", async () => {
    const sharp = (await import("sharp")).default;
    const page = await sharp({ create: { width: 800, height: 600, channels: 3, background: "#ffffff" } }).png().toBuffer();
    const tiff = await sharp([page, page], { join: { animated: true } }).tiff().toBuffer().catch(async () => null);
    if (!tiff) return; // starší libvips bez vícestránkového zápisu
    setFakeAnonHandler(() => null);
    const r = await anonymizeImage({ bytes: new Uint8Array(tiff), hasMaster: true, ctx: ctx(), ai: AI, verify: false, fill: "white" });
    expect(r.pages).toBeGreaterThanOrEqual(1);
    if (r.pages > 1) {
      expect(r.method).toBe("image_pdf");
      const { openPdf } = await import("./pdf-node");
      const doc = await openPdf(r.bytes!);
      expect(doc.numPages).toBe(r.pages);
      await doc.destroy();
    }
  }, 120_000);

  it("poškozený HEIC → unsupported s návodem", async () => {
    const heicLike = new Uint8Array([0, 0, 0, 24, 0x66, 0x74, 0x79, 0x70, 0x68, 0x65, 0x69, 0x63, 0, 0, 0, 0]);
    const r = await anonymizeImage({ bytes: heicLike, hasMaster: false, ctx: ctx(), ai: null, verify: false, fill: "white" });
    expect(r.unsupported).toMatch(/^Nelze anonymizovat automaticky.*JPEG/);
  });

  it("HEIC z iPhonu (HEVC) se dekóduje na serveru: orientace zapečená, výstup JPEG bez EXIF / GPS", async () => {
    const { HEIC_SAMPLE_B64 } = await import("./__fixtures__/heic-sample");
    const sharp = (await import("sharp")).default;
    setFakeAnonHandler(() => null);
    const heic = new Uint8Array(Buffer.from(HEIC_SAMPLE_B64, "base64"));
    const r = await anonymizeImage({ bytes: heic, hasMaster: false, ctx: ctx(), ai: AI, verify: false, fill: "white" });
    expect(r.unsupported).toBeNull();
    expect(r.hasMaster).toBe(true);
    expect(r.mime).toBe("image/jpeg");
    const m = await sharp(Buffer.from(r.bytes!)).metadata();
    expect([m.width, m.height]).toEqual([320, 240]);
    expect(m.exif).toBeUndefined();
    expect(m.xmp).toBeUndefined();
    expect(Buffer.from(r.bytes!).toString("latin1")).not.toMatch(/Dvorak|GPS/);
  }, 60_000);

  it("úklid env", () => {
    if (prevFake === undefined) delete process.env.AI_FAKE_ANON;
    else process.env.AI_FAKE_ANON = prevFake;
    expect(true).toBe(true);
  });
});
