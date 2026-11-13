/**
 * Otisky výběru po parametrické změně rozměru (nálezy kontroly po nasazení):
 *  - souosé plochy: po změně průměru se výběr vnější plochy trubky nesmí „přestěhovat“ na vrtání (střed obou leží na ose),
 *  - změna rozměru bez změny topologie: zaoblení / skořepina nesmí hlásit ⚠ „nenašla podle otisku“ a razítkování otisk obnoví,
 *  - změna topologie, kde se entita podle otisku nenajde, varování dál hlásí.
 */
import path from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import * as r from "replicad";
import opencascade from "replicad-opencascadejs";
import { buildDoc, buildShape, clearBuildCache } from "./build";
import { entityInfo } from "./inspect";
import { resolvePicks, SigTable, stampPicks } from "./pick-sigs";
import { entityIndex, findBySig, sigOf } from "./ref-resolve";
import type { Sig } from "./refs";
import { emptyDoc, type CadDoc, type Feature } from "./types";
import "./ext/index";
import "./feat/index";

beforeAll(async () => {
  const oc = await (opencascade as unknown as (o: object) => Promise<unknown>)({ locateFile: () => path.resolve(__dirname, "../../node_modules/replicad-opencascadejs/dist/replicad_single.wasm"), print: () => undefined, printErr: () => undefined });
  r.setOC(oc as never);
}, 60_000);

const doc = (...features: Feature[]): CadDoc => ({ ...emptyDoc("Test"), features });
const bodyOf = async (...fs: Feature[]) => (await buildShape(doc(...fs), Infinity, { noCache: true })).body!;
const build = async (...fs: Feature[]) => {
  clearBuildCache();
  return buildDoc(doc(...fs));
};
const statusOf = (res: Awaited<ReturnType<typeof buildDoc>>, id: string) => res.status.find((s) => s.id === id)!;
/** otisk bez polí přidaných opravou (dokument uložený nasazenou betou) */
const legacy = (s: Sig): Sig => ({ t: s.t, c: s.c, s: s.s });
const legacyMap = (m: Record<string, Sig> | undefined) => Object.fromEntries(Object.entries(m ?? {}).map(([k, v]) => [k, legacy(v)]));

// ───────────── souosé plochy: trubka R / r, výška 20 ─────────────
const outer = (radius: number): Feature => ({ id: "c", name: "Plášť", type: "cylinder", radius, height: 20, position: [0, 0, 0], axis: "Z", mode: "new" }) as Feature;
const bore = (radius = 5): Feature => ({ id: "h", name: "Vrtání", type: "cylinder", radius, height: 20, position: [0, 0, 0], axis: "Z", mode: "cut" }) as Feature;
const offsetFace = (faces: number[], extra: Record<string, unknown> = {}): Feature => ({ id: "o", name: "Odsazení", type: "offsetFace", faces, distance: 1, ...extra }) as Feature;
/** index válcové plochy s poloměrem `rad` */
const cylIndex = (b: r.Shape3D, rad: number) => b.faces.findIndex((_, i) => {
  const x = entityInfo(b, { kind: "face", index: i });
  return x.surface === "CYLINDRE" && Math.abs((x.radius ?? 0) - rad) < 1e-6;
});
const tubeVol = (R: number, rIn: number) => Math.PI * (R * R - rIn * rIn) * 20;

describe("souosé plochy: výběr vnější plochy po změně průměru zůstane na vnější ploše", () => {
  it("odsazení vnější plochy trubky R6/R5: po R 6 → 7,5 a 8 se odsadí vnější plocha, ne vrtání (s otiskem i se starým otiskem)", async () => {
    const b6 = await bodyOf(outer(6), bore());
    const oi = cylIndex(b6, 6);
    expect(oi).toBeGreaterThanOrEqual(0);
    const stamped = stampPicks(offsetFace([oi]), b6).feature;
    const sigs = (stamped as { faceSigs?: Record<string, Sig> }).faceSigs;
    expect(Object.keys(sigs ?? {})).toEqual([String(oi)]);
    const old = offsetFace([oi], { faceSigs: legacyMap(sigs) });
    for (const R of [7.5, 8]) {
      const want = tubeVol(R + 1, 5); // vnější plocha odsazená o 1 mm
      for (const [label, f] of [["otisk", stamped], ["starý otisk", old], ["bez otisku", offsetFace([oi])]] as const) {
        const res = await build(outer(R), bore(), f);
        const s = statusOf(res, "o");
        expect(s.ok, `${label} R=${R}: ${JSON.stringify(s)}`).toBe(true);
        expect(s.warning, `${label} R=${R}`).toBeUndefined();
        expect(res.metrics!.volume, `${label} R=${R}`).toBeCloseTo(want, 1);
        expect(res.metrics!.bbox[1][0], `${label} R=${R}`).toBeCloseTo(R + 1, 3);
      }
    }
  }, 240_000);

  it("tenká stěna R6/R5,9: otisk vnější plochy se nepřestěhuje na vrtání, i když se plochy liší jen o 1,7 %", async () => {
    const b6 = await bodyOf(outer(6), bore(5.9));
    const oi = cylIndex(b6, 6);
    const sig = sigOf(b6, "face", oi)!;
    const b65 = await bodyOf(outer(6.5), bore(5.9));
    const bi = cylIndex(b65, 5.9);
    expect(bi).toBeGreaterThanOrEqual(0);
    // vrtání má plochu do 2 % plochy původní vnější plochy, střed na stejném místě – rozhodne poloměr v otisku
    expect(Math.abs(sigOf(b65, "face", bi)!.s - sig.s) / sig.s).toBeLessThan(0.02);
    expect(findBySig(b65, "face", sig)).toBe(-1);
    expect(new SigTable(b65, "face").find(sig)).toBe(-1);
    const t = new SigTable(b65, "face");
    expect(t.resolve(oi, { ...sig, n: t.count }).index).toBe(cylIndex(b65, 6.5));
    // odkaz (refs) se stejným otiskem zůstane na vnější ploše
    expect(entityIndex(b65, "face", oi, sig)).toBe(cylIndex(b65, 6.5));
  }, 120_000);
});

// ───────────── změna rozměru bez změny topologie ─────────────
const box = (h: number): Feature => ({ id: "b", name: "Kvádr", type: "box", size: [80, 50, h], position: [0, 0, 0], centered: false, mode: "new" });
const hole = (h: number): Feature => ({ id: "hl", name: "Díra", type: "hole", position: [20, 25, h], axis: "Z", flip: false, diameter: 10, depth: 0, cbDiameter: 0, cbDepth: 0 });
const fillet = (extra: Record<string, unknown> = {}): Feature => ({ id: "f", name: "Zaoblení", type: "fillet", radius: 5, edges: [0, 4], ...extra }) as Feature;
const shell = (extra: Record<string, unknown> = {}): Feature => ({ id: "s", name: "Skořepina", type: "shell", thickness: 2, faces: [5], ...extra }) as Feature;

describe("změna rozměru bez změny topologie: žádné falešné ⚠ u zaoblení a skořepiny", () => {
  it("zaoblení hran 1 a 5 kvádru: výška 30 → 31 / 33 / 40 bez varování, stejný objem jako bez otisku; razítko otisk obnoví", async () => {
    const b30 = await bodyOf(box(30));
    const st = stampPicks(fillet(), b30).feature;
    const old = fillet({ edgeSigs: legacyMap((st as { edgeSigs?: Record<string, Sig> }).edgeSigs) });
    for (const h of [31, 33, 40]) {
      const plain = await build(box(h), fillet());
      for (const [label, f] of [["otisk", st], ["starý otisk", old]] as const) {
        const res = await build(box(h), f);
        const s = statusOf(res, "f");
        expect(s.ok, `${label} H=${h}`).toBe(true);
        expect(s.warning, `${label} H=${h}: ${s.warning}`).toBeUndefined();
        expect(res.metrics!.volume, `${label} H=${h}`).toBeCloseTo(plain.metrics!.volume, 3);
      }
      // otevření prvku (razítkování nad tělesem po změně): bez varování, otisk se obnoví na aktuální entitu a podruhé se nic nemění
      const bh = await bodyOf(box(h));
      const again = stampPicks(st, bh);
      expect(again.warnings, `H=${h}`).toEqual([]);
      expect(again.changed).toBe(true);
      const sigs = (again.feature as { edgeSigs: Record<string, Sig> }).edgeSigs;
      expect(sigs["4"].s).toBeCloseTo(h, 6); // svislá hrana má teď délku h
      expect(stampPicks(again.feature, bh).changed).toBe(false);
      expect(resolvePicks(again.feature, bh).warnings).toEqual([]);
    }
  }, 240_000);

  it("skořepina otevírající horní plochu: výška 30 → 40 bez varování", async () => {
    const st = stampPicks(shell(), await bodyOf(box(30))).feature;
    const res = await build(box(40), st);
    const plain = await build(box(40), shell());
    expect(statusOf(res, "s").ok).toBe(true);
    expect(statusOf(res, "s").warning).toBeUndefined();
    expect(res.metrics!.volume).toBeCloseTo(plain.metrics!.volume, 3);
  }, 120_000);

  it("změna topologie a otisk se nenajde (výška 30 → 40 a díra před zaoblením): varování zůstává", async () => {
    const st = stampPicks(fillet({ edges: [4] }), await bodyOf(box(30))).feature;
    const res = await build(box(40), hole(40), st);
    const s = statusOf(res, "f");
    expect(s.ok).toBe(true);
    expect(s.warning).toMatch(/Hrana 5 se po změně modelu nenašla podle otisku – použit původní index/);
    // samotná díra (bez změny rozměru) hranu podle otisku najde – bez varování
    const moved = await build(box(30), hole(30), st);
    expect(statusOf(moved, "f").warning).toBeUndefined();
  }, 120_000);
});
