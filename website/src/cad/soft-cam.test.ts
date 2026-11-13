import { describe, expect, it } from "vitest";
import { fitSoftCam, newSoftCam, softCamOnModel, type SoftCam } from "./soft-cam";
import { VIEW_ANGLES, basisOf, fitCamera, softBounds, type SoftItem } from "./soft-render";
import type { Vec3 } from "./types";

/** kvádr jako mračno 8 rohů (pro kameru stačí vrcholy) */
function box(min: Vec3, max: Vec3): SoftItem {
  const v: number[] = [];
  for (const x of [min[0], max[0]]) for (const y of [min[1], max[1]]) for (const z of [min[2], max[2]]) v.push(x, y, z);
  return { vertices: new Float32Array(v), triangles: new Uint32Array([0, 1, 2]), color: [185, 194, 204] };
}
const W = 1000;
const H = 700;
const FILL = 0.78;

/** Stejný postup jako komponenta náhledu: nový model → případné přizpůsobení. */
function showModel(c: SoftCam, items: SoftItem[]) {
  const v = softCamOnModel(c, softBounds(items));
  if (v) fitSoftCam(c, items, W, H, FILL, v);
  return v;
}
/** Šířka obrysu modelu na plátně (CSS px) v aktuální kameře. */
function screenWidth(c: SoftCam, items: SoftItem[]) {
  const R = basisOf(c.angles).right;
  let lo = Infinity, hi = -Infinity;
  for (const it of items)
    for (let j = 0; j < it.vertices.length; j += 3) {
      const r = R[0] * (it.vertices[j] - c.center[0]) + R[1] * (it.vertices[j + 1] - c.center[1]) + R[2] * (it.vertices[j + 2] - c.center[2]);
      lo = Math.min(lo, r);
      hi = Math.max(hi, r);
    }
  return { lo: W / 2 + lo * c.scale, hi: W / 2 + hi * c.scale };
}
/** Je model celý na plátně a zabírá podstatnou část šířky nebo výšky? */
function fills(c: SoftCam, items: SoftItem[]) {
  const s = screenWidth(c, items);
  const fit = fitCamera(items, basisOf(c.angles), W, H, FILL);
  return s.lo >= 0 && s.hi <= W && Math.abs(c.scale - fit.scale) / fit.scale < 1e-9;
}

describe("softwarový náhled – kamera po změně modelu", () => {
  it("první model se vejde do plátna v izometrii", () => {
    const c = newSoftCam();
    const a = [box([0, 0, 0], [40, 30, 20])];
    expect(showModel(c, a)).toBe("iso");
    expect(fills(c, a)).toBe(true);
    expect(c.fitted).toBe(true);
  });

  it("nový díl: přizpůsobení prázdné scény nenastaví měřítko 1 px/mm, další model se vejde do plátna", () => {
    const c = newSoftCam();
    const a = [box([0, 0, 0], [40, 30, 20])];
    showModel(c, a);
    const scaleA = c.scale;
    // nový díl: prázdná scéna, aplikace po chvíli přepne na izometrii
    expect(softCamOnModel(c, softBounds([]))).toBeNull();
    fitSoftCam(c, [], W, H, FILL, "iso");
    expect(c.scale).toBe(scaleA); // dřív: fitCamera([]) → měřítko 1
    expect(c.fitted).toBe(false);
    // stejný kvádr v novém dílu → znovu přizpůsobit (dřív zůstalo 1 px/mm, kvádr měl ~50 px)
    const b = [box([0, 0, 0], [40, 30, 20])];
    expect(showModel(c, b)).toBe("iso");
    expect(fills(c, b)).toBe(true);
    expect(c.scale).toBeGreaterThan(5);
  });

  it("pohled zvolený nad prázdnou scénou se použije, až se model objeví", () => {
    const c = newSoftCam();
    fitSoftCam(c, [], W, H, FILL, "top");
    expect(c.view).toBe("top");
    const a = [box([0, 0, 0], [40, 30, 20])];
    expect(showModel(c, a)).toBe("top");
    expect(c.angles).toEqual(VIEW_ANGLES.top);
    expect(fills(c, a)).toBe(true);
  });

  it("model stejné velikosti přesunutý daleko → znovu přizpůsobit (dřív prázdné plátno)", () => {
    const c = newSoftCam();
    showModel(c, [box([0, 0, 0], [40, 30, 20])]);
    const far = [box([5000, 0, 0], [5040, 30, 20])];
    expect(showModel(c, far)).toBe("iso");
    expect(fills(c, far)).toBe(true);
  });

  it("vystředěný kvádr místo kvádru v rohu → znovu přizpůsobit (dřív napůl mimo plátno)", () => {
    const c = newSoftCam();
    showModel(c, [box([0, 0, 0], [40, 30, 20])]);
    const centred = [box([-20, -15, -10], [20, 15, 10])];
    expect(showModel(c, centred)).toBe("iso");
    expect(fills(c, centred)).toBe(true);
  });

  it("drobná úprava modelu pohled drží (směr i přiblížení)", () => {
    const c = newSoftCam();
    showModel(c, [box([0, 0, 0], [40, 30, 20])]);
    fitSoftCam(c, [box([0, 0, 0], [40, 30, 20])], W, H, FILL, "front");
    c.scale *= 2; // uživatel přiblížil
    const before = { ...c };
    expect(showModel(c, [box([0, 0, 0], [40, 30, 25])])).toBeNull();
    expect(c.scale).toBe(before.scale);
    expect(c.center).toEqual(before.center);
    expect(c.view).toBe("front");
  });

  it("skryté těleso (prázdná scéna) a jeho opětovné zobrazení pohled nemění", () => {
    const c = newSoftCam();
    const a = [box([0, 0, 0], [40, 30, 20])];
    showModel(c, a);
    c.scale *= 3;
    const s = c.scale;
    expect(showModel(c, [])).toBeNull();
    expect(showModel(c, a)).toBeNull();
    expect(c.scale).toBe(s);
  });

  it("výrazná změna velikosti → izometrie na celé plátno", () => {
    const c = newSoftCam();
    showModel(c, [box([0, 0, 0], [40, 30, 20])]);
    fitSoftCam(c, [box([0, 0, 0], [40, 30, 20])], W, H, FILL, "top");
    const big = [box([0, 0, 0], [400, 300, 200])];
    expect(showModel(c, big)).toBe("iso");
    fitSoftCam(c, big, W, H, FILL, "iso");
    expect(c.view).toBe("iso");
    expect(fills(c, big)).toBe(true);
  });

  it("plátno bez rozměru kameru nemění, model zůstane k přizpůsobení", () => {
    const c = newSoftCam();
    const a = [box([0, 0, 0], [40, 30, 20])];
    expect(softCamOnModel(c, softBounds(a))).toBe("iso");
    fitSoftCam(c, a, 0, 0, FILL, "iso");
    expect(c.scale).toBe(1);
    expect(c.fitted).toBe(true); // komponenta přizpůsobí, až plátno dostane rozměr (ResizeObserver)
  });
});
