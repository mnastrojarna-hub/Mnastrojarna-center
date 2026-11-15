import { describe, expect, it } from "vitest";
import type { BoxHits } from "@/cad/box-select";
import { applyBoxIdx, applyBoxSel, boxCountText, boxLabel, boxModeOf, boxPreviewText, boxSpecFor, dragAction, featureFacesOf, featureOwnerCache, hitsToSel, measureMany, mouseButtons, mouseHint } from "./box-pick-3d";
import type { SelItem } from "./selection";

describe("box-pick-3d: režimy, filtr, převod zásahů", () => {
  it("modifikátory jako u kliku: bez klávesy nahradí, Ctrl/Shift přidá, Ctrl+Shift nebo Alt odebere", () => {
    expect(boxModeOf({})).toBe("replace");
    expect(boxModeOf({ ctrlKey: true })).toBe("add");
    expect(boxModeOf({ shiftKey: true })).toBe("add");
    expect(boxModeOf({ metaKey: true })).toBe("add");
    expect(boxModeOf({ ctrlKey: true, shiftKey: true })).toBe("remove");
    expect(boxModeOf({ altKey: true })).toBe("remove");
  });
  it("filtr výběru → co okno vybírá (Vše: plochy dílu, komponenty sestavy; formuláře: hrany / plochy)", () => {
    expect(boxSpecFor("select", "all", false)).toEqual({ faces: true });
    expect(boxSpecFor("select", "all", true)).toEqual({ items: "component" });
    expect(boxSpecFor("select", "edge", true)).toEqual({ edges: true });
    expect(boxSpecFor("select", "subasm", true)).toEqual({ items: "subasm" });
    expect(boxSpecFor("select", "component", false)).toEqual({ items: "body" });
    expect(boxSpecFor("select", "feature", false)).toEqual({ faces: true });
    expect(boxSpecFor("edges", "all", false)).toEqual({ edges: true });
    expect(boxSpecFor("faces", "edge", false)).toEqual({ faces: true });
    expect(boxSpecFor("face-plane", "all", false)).toBeNull();
    expect(boxSpecFor("asmFace", "face", true)).toBeNull();
    expect(boxSpecFor("none", "all", false)).toBeNull();
  });
  it("zásahy → SelItem s id komponenty; podsestava jen jednou", () => {
    const h: BoxHits = { faces: [{ item: 1, face: 3 }], edges: [{ item: 0, edge: 2 }], vertices: [{ item: 0, index: 5, point: [1, 2, 3] }], items: [0, 1, 2], ms: 0 };
    const metas = [{ compId: "a/x", topId: "a" }, { compId: "a/y", topId: "a" }, { compId: "b", topId: "b" }];
    expect(hitsToSel(h, metas, { faces: true, edges: true, vertices: true })).toEqual([
      { kind: "face", index: 3, compId: "a/y", topId: "a" },
      { kind: "edge", index: 2, compId: "a/x", topId: "a" },
      { kind: "vertex", index: 5, point: [1, 2, 3], compId: "a/x", topId: "a" },
    ]);
    expect(hitsToSel(h, metas, { items: "subasm" })).toEqual([
      { kind: "component", compId: "a", topId: "a" },
      { kind: "component", compId: "b", topId: "b" },
    ]);
    expect(hitsToSel(h, metas, { items: "component" }).length).toBe(3);
    expect(hitsToSel({ ...h, items: [0] }, [{}], { items: "component" })).toEqual([{ kind: "body" }]);
  });
  it("nahradit / přidat / odebrat výběr a seznam čísel", () => {
    const f = (i: number): SelItem => ({ kind: "face", index: i });
    expect(applyBoxSel([f(1), f(2)], [f(3), f(3)], "replace")).toEqual([f(3)]);
    expect(applyBoxSel([f(1), f(2)], [f(2), f(3)], "add")).toEqual([f(1), f(2), f(3)]);
    expect(applyBoxSel([f(1), f(2), f(3)], [f(2)], "remove")).toEqual([f(1), f(3)]);
    expect(applyBoxIdx([5, 1], [3, 1], "add")).toEqual([1, 3, 5]);
    expect(applyBoxIdx([5, 1, 3], [3], "remove")).toEqual([5, 1]);
    expect(applyBoxIdx([5], [4, 2, 4], "replace")).toEqual([2, 4]);
  });
  it("počítadlo s českými tvary a režimem", () => {
    const f = (i: number): SelItem => ({ kind: "face", index: i });
    const e = (i: number): SelItem => ({ kind: "edge", index: i });
    expect(boxCountText([])).toBe("nic");
    expect(boxCountText([f(1)])).toBe("1 plocha");
    expect(boxCountText([f(1), f(2), e(1), e(2), e(3), e(4), e(5)])).toBe("2 plochy · 5 hran");
    expect(boxCountText(Array.from({ length: 12 }, (_, i) => f(i)))).toBe("12 ploch");
    expect(boxLabel([e(1)], "add")).toBe("+ 1 hrana");
    expect(boxLabel([e(1), e(2)], "remove")).toBe("− 2 hrany");
  });
  it("tlačítka myši: levé = okno (výchozí), otáčení podle schématu; volba otáčení vrací levé otáčení", () => {
    expect(mouseButtons("zw3d", "window")).toEqual({ left: "none", middle: "pan", right: "orbit" });
    expect(mouseButtons("solidworks", undefined)).toEqual({ left: "none", middle: "orbit", right: "pan" });
    expect(mouseButtons("simple", "window")).toEqual({ left: "none", middle: "pan", right: "orbit" });
    expect(mouseButtons("simple", "orbit")).toEqual({ left: "orbit", middle: "pan", right: "pan" });
    expect(mouseButtons("zw3d", "orbit").left).toBe("orbit");
    expect(dragAction("zw3d", "window", 0, false)).toBe("none");
    expect(dragAction("zw3d", "window", 2, false)).toBe("orbit");
    expect(dragAction("zw3d", "window", 2, true)).toBe("pan");
    expect(dragAction("solidworks", "window", 1, true)).toBe("pan");
    expect(dragAction("simple", "orbit", 0, true)).toBe("pan");
    expect(mouseHint("zw3d", "window")).toContain("Okno: levé tl.");
    expect(mouseHint("simple", "orbit")).toContain("Otáčení: levé");
  });
  it("měření oknem sečte délky hran a plochy ploch; filtr Prvek se ptá jen na plochy dosud nenalezených prvků", async () => {
    const items: SelItem[] = [{ kind: "edge", index: 0 }, { kind: "edge", index: 1 }, { kind: "face", index: 2 }];
    const m = await measureMany(items, async (it) => ({ title: "", rows: [], ...(it.kind === "edge" ? { length: 10 + it.index } : { area: 50 }) }));
    expect(m.rows.map((r) => r[0])).toEqual(["Vybráno oknem", "Celková délka hran", "Celková plocha ploch"]);
    expect(m.rows[1][1]).toBe("21 mm");
    expect(m.rows[2][1]).toBe("50 mm²");
    const asked: number[] = [];
    const found = await featureFacesOf([0, 1, 2, 5].map((i) => ({ kind: "face", index: i }) as SelItem), async (f) => {
      asked.push(f);
      return f < 3 ? { featureId: "box", faces: [0, 1, 2, 3] } : { featureId: "hole", faces: [5] };
    });
    expect(found).toEqual({ box: [0, 1, 2, 3], hole: [5] });
    expect(asked).toEqual([0, 5]);
  });
  it("filtr Prvek: počítadlo počítá prvky, ne plochy (vlastníci ploch se dohledají na pozadí, oprava po kontrole)", async () => {
    // deska s 280 dírami: plochy 0–5 kvádr, 6–285 jeden prvek „díry“
    const asked: number[] = [];
    const ask = async (f: number) => {
      asked.push(f);
      return f < 6 ? { featureId: "box", faces: [0, 1, 2, 3, 4, 5] } : { featureId: "holes", faces: Array.from({ length: 280 }, (_, i) => 6 + i) };
    };
    const faces = Array.from({ length: 283 }, (_, i): SelItem => ({ kind: "face", index: i < 3 ? i : 3 + i }));
    const cache = featureOwnerCache();
    const mesh = {};
    let changed = 0;
    const resolve = (it: SelItem[], c: () => void) => cache.resolve(mesh, it, ask, c);
    // první náhled: vlastníci ještě nejsou – popisek neříká „283 ploch“
    expect(boxPreviewText(faces, "replace", resolve, () => changed++)).toBe("hledám prvky…");
    await new Promise((r) => setTimeout(r, 0));
    expect(asked).toEqual([0, 6]); // jedna otázka na prvek
    expect(changed).toBe(2);
    expect(boxPreviewText(faces, "replace", resolve, () => changed++)).toBe("2 prvky");
    expect(boxPreviewText(faces.slice(0, 2), "add", resolve, () => changed++)).toBe("+ 1 prvek");
    // výběr po uvolnění použije mezipaměť (žádná další otázka jádra)
    const found = await featureFacesOf(faces, cache.owner(mesh, ask));
    expect(Object.keys(found).sort()).toEqual(["box", "holes"]);
    expect(found.box).toEqual([0, 1, 2, 3, 4, 5]);
    expect(found.holes.length).toBe(280);
    expect(asked).toEqual([0, 6]);
    // jiný model (nová síť) = mezipaměť od začátku
    const other = featureOwnerCache();
    other.resolve(mesh, faces.slice(0, 1), ask, () => {});
    expect(cache.resolve({}, faces.slice(0, 1), ask, () => {}).pending).toBe(true);
    // bez převodu (jiný filtr) popisek počítá zásahy
    expect(boxPreviewText(faces.slice(0, 3), "replace", undefined, () => {})).toBe("3 plochy");
  });
});
