/**
 * Vlna 22, kolo 7, stopa a – regresní testy zbylých mezer (body 12, 15, 16, 20, 22h).
 * Každý případ padá na kódu před kolem 7 (origin/main 260ff8b).
 */
import { describe, expect, it } from "vitest";
import { setLang } from "../i18n";
import { createShareLink, openErrorText, openShareLink, parseShareHash } from "../share";
import { verifyShareLink } from "../share-verify";
import { emptyDoc, type CadDoc } from "../types";
import { muxWebm, readWebm, tagWebm, checkWebm } from "../webm-mux";
import { groupsKv, kvName, rigidMotionGroups } from "../motion-groups";
import { entityCandidates, findOnScreen } from "../screen-probe";

setLang("cs");
const part = (name = "Deska A"): CadDoc => ({ ...emptyDoc(name), kind: "part", features: [{ id: "b1", name: "Kvádr 1", type: "box", size: [120, 80, 10], position: [0, 0, 0], centered: false, mode: "new" } as never] });
const BASE = "https://www.mnastrojarna.cz/cad";

describe("bod 16 (kolo 7): šifrovaný dlouhý odkaz – useknutý × změněný × špatné heslo se rozliší", () => {
  it("odkaz s heslem nese kontrolu úplnosti před daty (1dpk.<sůl>.<n>.<otisk>.<data>) a otevře se celý", async () => {
    const r = await createShareLink(part(), { days: 10, mode: "link", base: BASE, password: "tajne" });
    const hash = new URL(r.url).hash;
    const m = /^#s=1dpk\.[A-Za-z0-9_-]{22}\.(\d+)\.[A-Za-z0-9_-]{8}\.([A-Za-z0-9_-]+)$/.exec(hash);
    expect(m).not.toBeNull();
    expect(Number(m![1])).toBe(m![2].length);
    const ok = await openShareLink(parseShareHash(hash)!, "tajne");
    expect(ok.ok).toBe(true);
    if (ok.ok) expect(ok.payload.doc.name).toBe("Deska A");
  });

  it("useknutý šifrovaný odkaz = truncated i BEZ hesla a se správným heslem (dřív „Nesprávné heslo – nebo useknutý“)", async () => {
    const r = await createShareLink(part(), { days: 10, mode: "link", base: BASE, password: "tajne" });
    const hash = new URL(r.url).hash;
    for (const cut of [hash.slice(0, -8), hash.slice(0, Math.floor(hash.length * 0.6))]) {
      for (const pw of [undefined, "tajne"]) {
        const o = await openShareLink(parseShareHash(cut)!, pw);
        expect(o).toMatchObject({ ok: false, reason: "invalid", damage: "truncated" });
        if (!o.ok) {
          expect(o.expected).toBeGreaterThan(o.chars!);
          expect(openErrorText(o.reason, o.exp, "link", o)).toMatch(/^Odkaz je useknutý – .* má \d+ z \d+ znaků/);
        }
      }
    }
    // useknutý hned v hlavičce kontroly (za solí) – také useknutý, ne heslo
    const head = hash.slice(0, hash.indexOf(".", hash.indexOf(".") + 1) + 3);
    expect(await openShareLink(parseShareHash(head)!, "tajne")).toMatchObject({ ok: false, reason: "invalid", damage: "truncated" });
  });

  it("změněný znak v datech = corrupt (bez hesla i s ním); znaky přilepené za odkaz nevadí", async () => {
    const r = await createShareLink(part(), { days: 10, mode: "link", base: BASE, password: "tajne" });
    const hash = new URL(r.url).hash;
    const i = hash.length - 20;
    const bad = hash.slice(0, i) + (hash[i] === "A" ? "B" : "A") + hash.slice(i + 1);
    for (const pw of [undefined, "tajne"]) {
      const c = await openShareLink(parseShareHash(bad)!, pw);
      expect(c).toMatchObject({ ok: false, reason: "invalid", damage: "corrupt" });
      if (!c.ok) expect(openErrorText(c.reason, c.exp, "link", c)).toMatch(/^Odkaz je poškozený/);
    }
    // messenger přilepí za odkaz „.“ nebo „)“ – kontrola úplnosti je odřízne
    for (const tail of [".", ")", "-x"]) {
      const o = await openShareLink(parseShareHash(hash + tail)!, "tajne");
      expect(o.ok).toBe(true);
    }
  });

  it("celý odkaz a špatné heslo = jen „Nesprávné heslo.“ (bez dohadu o useknutí); verifyShareLink totéž", async () => {
    const r = await createShareLink(part(), { days: 10, mode: "link", base: BASE, password: "tajne" });
    const hash = new URL(r.url).hash;
    const w = await openShareLink(parseShareHash(hash)!, "spatne");
    expect(w).toEqual({ ok: false, reason: "password" });
    if (!w.ok) expect(openErrorText(w.reason, w.exp, "link", w)).toBe("Nesprávné heslo.");
    expect(await verifyShareLink(r.url, { password: "spatne" })).toMatchObject({ ok: false, reason: "password", text: "Nesprávné heslo." });
    expect(await verifyShareLink(r.url.slice(0, -10), { password: "tajne" })).toMatchObject({ ok: false, reason: "truncated" });
    expect(await verifyShareLink(r.url, { password: "tajne" })).toMatchObject({ ok: true, mode: "link" });
  });

  it("oponentura kola 7: useknuto uvnitř SOLI nebo hlavičky kontroly = useknutý odkaz s vlastním textem (ne „není odkaz“, ne „má 0 znaků“)", async () => {
    const r = await createShareLink(part(), { days: 10, mode: "link", base: BASE, password: "tajne" });
    const hash = new URL(r.url).hash; // #s=1dpk.<sůl 22>.<n>.<otisk 8>.<data>
    const salt0 = "#s=1dpk.".length;
    const n0 = salt0 + 23;
    const chk0 = hash.indexOf(".", n0) + 1;
    const cuts = ["#s=1dpk", "#s=1dpk.", hash.slice(0, salt0 + 1), hash.slice(0, salt0 + 11), hash.slice(0, salt0 + 22), hash.slice(0, n0 + 1), hash.slice(0, chk0 - 1), hash.slice(0, chk0 + 4), hash.slice(0, chk0 + 8)];
    for (const cut of cuts) {
      const parsed = parseShareHash(cut);
      expect(parsed, cut).not.toBeNull(); // dřív uvnitř soli null = „Text není sdílený odkaz“
      for (const pw of [undefined, "tajne"]) {
        const o = await openShareLink(parsed!, pw);
        expect(o, cut).toMatchObject({ ok: false, reason: "invalid", damage: "truncated" });
        if (!o.ok) {
          const t = openErrorText(o.reason, o.exp, "link", o);
          expect(t).toMatch(/^Odkaz je useknutý – končí ještě před daty dokumentu/);
          expect(t).not.toMatch(/má 0 znaků/);
        }
      }
      expect(await verifyShareLink(BASE + cut, { password: "tajne" }), cut).toMatchObject({ ok: false, reason: "truncated" });
    }
    // useknuto přesně za hlavičkou (data chybí celá) = „má 0 z N znaků“ – N je známé, text je pravdivý
    const o = await openShareLink(parseShareHash(hash.slice(0, chk0 + 9))!, "tajne");
    expect(o).toMatchObject({ ok: false, reason: "invalid", damage: "truncated", chars: 0 });
    if (!o.ok) expect(openErrorText(o.reason, o.exp, "link", o)).toMatch(/má 0 z \d+ znaků/);
    // starší tvar 1dp: useknutí v soli se odlišit nedá (bez kontroly) – zůstává jako dřív
    expect(parseShareHash("#s=1dp.abc")).toBeNull();
  });

  it("odkaz bez hesla má tvar beze změny (1d.<data>) – návod pro AI a starší stránky ho čtou dál", async () => {
    const r = await createShareLink(part(), { days: 10, mode: "link", base: BASE });
    expect(new URL(r.url).hash).toMatch(/^#s=1d\.[A-Za-z0-9_-]+$/);
  });
});

describe("bod 23 (kolo 7): cad-w22-m pouští průchod bez WebGL ve výchozím běhu", () => {
  it("sada čte průchody ze společného glPasses (výchozí = WebGL i bez WebGL), ne z jednoprůchodového E2E_NOGL === '1'", async () => {
    const fs = await import("node:fs");
    const path = await import("node:path");
    const src = fs.readFileSync(path.resolve(__dirname, "../../../e2e/cad-w22-m.e2e.cjs"), "utf8");
    expect(src).toMatch(/require\('\.\/lib\/gl-passes\.cjs'\)/);
    expect(src).toMatch(/for \(const ps of PASSES\)/);
    expect(src).not.toMatch(/const NOGL = process\.env\.E2E_NOGL === '1'/);
    // přípona průchodu u každé kontroly a kontrola, že průchod opravdu je / není s WebGL (žádná falešná zelená)
    expect(src).toMatch(/m \+ tag\)/);
    expect(src).toMatch(/průchod: WebGL v prohlížeči/);
    const { glPasses } = (await import(path.resolve(__dirname, "../../../e2e/lib/gl-passes.cjs"))) as { glPasses: (e: Record<string, string>) => { id: string }[] };
    expect(glPasses({}).map((x) => x.id)).toEqual(["webgl", "nogl"]);
  });
});

describe("bod 12 (oponentura kola 7): revize modelu ve videu WebM – vlastní muxer (cad/webm-mux.ts), ne MediaRecorder", () => {
  const frames = (n: number) => Array.from({ length: n }, (_, i) => ({ data: new Uint8Array([i, i + 1, i + 2, 7]), time: (i * 1000) / 30, key: i === 0 }));
  it("tagWebm připíše MODEL_REVISION do segmentu, readWebm ho přečte; snímky, časy a délka beze změny", () => {
    const raw = muxWebm({ codec: "V_VP8", width: 64, height: 64, fps: 30, frames: frames(12), duration: 400 });
    expect(readWebm(raw).tags).toEqual({}); // dřív soubor revizi nenesl vůbec
    const tagged = tagWebm(raw, { MODEL_REVISION: "r·a1b2c3", TITLE: "Studie W" });
    const a = readWebm(raw);
    const b = readWebm(tagged);
    expect(b.tags).toEqual({ MODEL_REVISION: "r·a1b2c3", TITLE: "Studie W" });
    expect(b.blocks).toEqual(a.blocks);
    expect(b.duration).toBe(a.duration);
    expect(checkWebm(b, { frames: 12, fps: 30, seconds: 0.4 })).toEqual([]);
    // přímo při zápisu (muxWebm tags) = totéž
    expect(readWebm(muxWebm({ codec: "V_VP8", width: 64, height: 64, fps: 30, frames: frames(3), tags: { MODEL_REVISION: "r·000001" } })).tags.MODEL_REVISION).toBe("r·000001");
  });
  it("segment neznámé délky (zápis po částech) – značka se připojí na konec a přečte se", () => {
    const raw = muxWebm({ codec: "V_VP8", width: 8, height: 8, fps: 30, frames: frames(2) });
    // přepis délky segmentu na „neznámou“ (8 bajtů 0x01FFFFFFFFFFFFFF) jako u MediaRecorderu
    const i = raw.findIndex((_, k) => raw[k] === 0x18 && raw[k + 1] === 0x53 && raw[k + 2] === 0x80 && raw[k + 3] === 0x67);
    const sizeLen = (() => { const b0 = raw[i + 4]; let l = 1; while (!(b0 & (0x80 >> (l - 1)))) l++; return l; })();
    const unk = new Uint8Array([...raw.slice(0, i + 4), 0x01, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, ...raw.slice(i + 4 + sizeLen)]);
    expect(readWebm(unk).blocks).toHaveLength(2);
    const t = readWebm(tagWebm(unk, { MODEL_REVISION: "r·abcdef" }));
    expect(t.tags.MODEL_REVISION).toBe("r·abcdef");
    expect(t.blocks).toHaveLength(2);
  });
});

describe("bod 15 (oponentura kola 7): řádek groups= uvádí jméno kořene skupiny", () => {
  it("groups=<n>:<osy>:<kořen>; znaky, které by rozbily klíč=hodnota, zapsané jako v URL; čtení n:osy beze změny", () => {
    const P = (p: [number, number, number]) => ({ position: p, rotation: [0, 0, 0] as [number, number, number] });
    const res = { comps: [{ id: "a", name: "Horní deska, A: 1" }, { id: "b", name: "Šroub" }, { id: "c", name: "Rám" }], steps: [{ place: { a: P([0, 0, 50]), b: P([5, 5, 60]), c: P([0, 0, 0]) } }, { place: { a: P([0, 0, 20]), b: P([5, 5, 30]), c: P([0, 0, 0]) } }] };
    const kv = groupsKv(rigidMotionGroups(res as never));
    expect(kv).toEqual(["groups=2:z-30:Horní%20deska%2C%20A%3A%201"]); // dřív "groups=2:z-30" – bez jména
    expect(kvName("Deska A")).toBe("Deska%20A");
    expect(kvName("Přidržovač")).toBe("Přidržovač");
    expect(decodeURIComponent("Horní%20deska%2C%20A%3A%201")).toBe("Horní deska, A: 1");
    // parser akceptační brány (scripts/cad-acceptance.mjs) bere n a osy podle dvojtečky – beze změny
    const rigid = (/ groups=(\S+)/.exec(" " + kv[0])?.[1] ?? "").split(",").map((g) => ({ n: Number(g.split(":")[0]), axes: g.split(":")[1] }));
    expect(rigid).toEqual([{ n: 2, axes: "z-30" }]);
  });
});

describe("bod 20 (oponentura kola 7): háček screenOf – kde kliknout na plochu / hranu / vrchol (cad/screen-probe.ts)", () => {
  // jednotková krychle: 2 trojúhelníky plochy 0 (z = 1), hrana 0 = úsečka [0,0,1]–[1,0,1], vrchol 0 = [1,1,1]; matice = posun +10 v X
  const mesh = {
    vertices: new Float32Array([0, 0, 1, 1, 0, 1, 1, 1, 1, 0, 1, 1]),
    normals: new Float32Array(12),
    triangles: new Uint32Array([0, 1, 2, 0, 2, 3]),
    faceGroups: new Int32Array([0, 6, 0]),
    lines: new Float32Array([0, 0, 1, 1, 0, 1]),
    edgeGroups: new Int32Array([0, 2, 0]),
  };
  const M = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 10, 0, 0, 1];
  it("body entity ve světě (s maticí komponenty) a první bod, který týž výběr jako klik opravdu vybere", () => {
    const src = { mesh, vertices: new Float32Array([1, 1, 1]), matrix: M };
    expect(entityCandidates(src, "vertex", 0)).toEqual([[11, 1, 1]]);
    expect(entityCandidates(src, "edge", 0)[0]).toEqual([10.5, 0, 1]);
    expect(entityCandidates(src, "face", 0)).toHaveLength(2);
    const project = (p: number[]): [number, number] => [p[0] * 10, p[1] * 10];
    // výběr vrací pro x > 105 jinou komponentu (zakrytí) – háček musí vzít až bod, kde klik vybere hledanou entitu
    const cands = entityCandidates(src, "face", 0);
    expect(Math.round(cands[0][0] * 10)).toBeGreaterThan(105); // první kandidát je zakrytý
    const pick = (x: number) => (x > 105 ? { kind: "face", index: 0, compId: "jiná" } : { kind: "face", index: 0, compId: "k" });
    const hit = findOnScreen(cands, { compId: "k", kind: "face", index: 0 }, project, pick);
    expect(hit).not.toBeNull();
    expect(hit!.x).toBeLessThanOrEqual(105);
    // nikde vidět = null (žádné „klikni naslepo“)
    expect(findOnScreen(entityCandidates(src, "edge", 0), { compId: "k", kind: "edge", index: 0 }, project, () => null)).toBeNull();
    expect(entityCandidates(src, "vertex", 5)).toEqual([]);
  });
});
