import { describe, expect, it } from "vitest";
import * as THREE from "three";
import { acceleratedRaycast, computeBoundsTree } from "three-mesh-bvh";

THREE.BufferGeometry.prototype.computeBoundsTree = computeBoundsTree;
THREE.Mesh.prototype.raycast = acceleratedRaycast;

/** Výběr plochy při měření spoléhá na původní čísla trojúhelníků (topologie z workeru). */
describe("BVH v režimu indirect", () => {
  it("nepřeskládá index a vrací původní číslo trojúhelníku", () => {
    // pás 200 trojúhelníků podél osy X, trojúhelník t leží v x ∈ [t, t+1]
    const pos: number[] = [];
    const idx: number[] = [];
    for (let t = 0; t < 200; t++) {
      const b = pos.length / 3;
      const x = (t * 7919) % 200; // zamíchané pořadí v prostoru
      pos.push(x, 0, 0, x + 1, 0, 0, x, 1, 0);
      idx.push(b, b + 1, b + 2);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
    const index = new Uint32Array(idx);
    g.setIndex(new THREE.BufferAttribute(index, 1));
    g.computeBoundsTree({ indirect: true });
    expect([...index]).toEqual(idx);
    const mesh = new THREE.Mesh(g, new THREE.MeshBasicMaterial({ side: THREE.DoubleSide }));
    const rc = new THREE.Raycaster(new THREE.Vector3(0, 0, 5), new THREE.Vector3(0, 0, -1));
    rc.firstHitOnly = true;
    for (const t of [0, 17, 123, 199]) {
      const x = (t * 7919) % 200;
      rc.ray.origin.set(x + 0.2, 0.2, 5);
      expect(rc.intersectObject(mesh)[0]?.faceIndex).toBe(t);
    }
  });
});
