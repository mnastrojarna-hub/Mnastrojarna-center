/**
 * Vlna 22, kolo 7b, bod 14 („Víc živých pohledů v okně není (jen v exportu)“ – CAD-M1-OPRAVY.md „Co zbývá“): pohledy
 * videa studie se kreslí živě v panelu studie (`components/cad/motion-live-views.tsx`) funkcí `renderStudyView` – každý
 * svou kamerou a rovinou řezu, s pevnou kamerou mezi snímky (obraz sleduje polohu komponent, ne přepočet kamery).
 * Na 7d72099 funkce neexistovala (import FAIL); GUI v e2e cad-w22-v („bod 14: živé pohledy“).
 */
import { describe, expect, it } from "vitest";
import { renderStudyView } from "../motion-frames";
import { sigChanged } from "../motion-video";
import type { RGB, SoftItem } from "../soft-render";
import type { MotionView, Vec3 } from "../types";

function box(min: Vec3, max: Vec3, color: RGB, dz = 0): SoftItem {
  const [x0, y0, z0] = min;
  const [x1, y1, z1] = max;
  const f: [Vec3, Vec3, Vec3, Vec3][] = [
    [[x0, y0, z0], [x0, y1, z0], [x1, y1, z0], [x1, y0, z0]],
    [[x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1]],
    [[x0, y0, z0], [x1, y0, z0], [x1, y0, z1], [x0, y0, z1]],
    [[x1, y1, z0], [x0, y1, z0], [x0, y1, z1], [x1, y1, z1]],
    [[x0, y1, z0], [x0, y0, z0], [x0, y0, z1], [x0, y1, z1]],
    [[x1, y0, z0], [x1, y1, z0], [x1, y1, z1], [x1, y0, z1]],
  ];
  const v: number[] = [];
  const t: number[] = [];
  f.forEach((q, i) => {
    for (const p of q) v.push(...p);
    t.push(i * 4, i * 4 + 1, i * 4 + 2, i * 4, i * 4 + 2, i * 4 + 3);
  });
  return { vertices: new Float32Array(v), triangles: new Uint32Array(t), color, matrix: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, dz, 1], capColor: [200, 60, 60], capHatch: null };
}
const scene = (dz: number) => [box([0, 0, 0], [200, 100, 10], [185, 194, 204]), box([0, 0, 0], [200, 100, 10], [70, 120, 200], 60 + dz)];
const FRONT: MotionView = { id: "a", name: "Řez Y", camera: { view: "front" }, section: { axis: "Y", offset: 50, flip: false } };
const TOP: MotionView = { id: "b", name: "Shora", camera: { view: "top" }, section: null };

describe("bod 14: živé pohledy studie (renderStudyView)", () => {
  it("dva pohledy se liší (kamera, řez) a oba ukazují model", () => {
    const a = renderStudyView(scene(0), FRONT, 328, 184);
    const b = renderStudyView(scene(0), TOP, 328, 184);
    const filled = (d: Uint8ClampedArray) => {
      let n = 0;
      for (let i = 0; i < d.length; i += 4) if (d[i] < 245 || d[i + 1] < 245 || d[i + 2] < 245) n++;
      return n;
    };
    expect(filled(a.data)).toBeGreaterThan(2000);
    expect(filled(b.data)).toBeGreaterThan(2000);
    expect(sigChanged(a.sig, b.sig)).toBe(true);
    // řez: v pohledu „Řez Y“ je barva čela (200, 60, 60), v pohledu shora bez řezu ne
    const has = (d: Uint8ClampedArray) => {
      for (let i = 0; i < d.length; i += 4) if (d[i] === 200 && d[i + 1] === 60 && d[i + 2] === 60) return true;
      return false;
    };
    expect(has(a.data)).toBe(true);
    expect(has(b.data)).toBe(false);
  });

  it("pevná kamera: posun komponenty změní obraz zepředu, kamera zůstane (synchronní s polohou)", () => {
    const f0 = renderStudyView(scene(0), FRONT, 328, 184);
    const f1 = renderStudyView(scene(-30), FRONT, 328, 184, f0.cam);
    expect(f1.cam).toBe(f0.cam);
    expect(sigChanged(f0.sig, f1.sig)).toBe(true);
    // shora se svislý pohyb neukáže (pravoúhlé promítání) – obraz stejný, nic se nepředstírá
    const t0 = renderStudyView(scene(0), TOP, 328, 184);
    const t1 = renderStudyView(scene(-30), TOP, 328, 184, t0.cam);
    expect(sigChanged(t0.sig, t1.sig)).toBe(false);
  });
});
