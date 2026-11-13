/**
 * Kreslení překryvu analýzy ploch v 3D okně (obarvené hrany podle návaznosti, hřebeny křivosti, řídicí body a síť CV).
 * Silné čáry jako trubičky (WebGL kreslí čáry jen 1 px), vše přes model (bez testu hloubky), aby byly vidět i hrany vzadu.
 */
import * as THREE from "three";
import type { SurfOverlay } from "./surf-overlay";

const NAME = "surfOverlay";

export function drawSurfOverlay(scene: THREE.Scene, o: SurfOverlay | null, radius: number) {
  let grp = scene.getObjectByName(NAME) as THREE.Group | undefined;
  if (!grp) {
    grp = new THREE.Group();
    grp.name = NAME;
    scene.add(grp);
  }
  for (const c of [...grp.children]) {
    grp.remove(c);
    (c as THREE.Mesh).geometry?.dispose();
    const m = (c as THREE.Mesh).material as THREE.Material | THREE.Material[] | undefined;
    if (Array.isArray(m)) m.forEach((x) => x.dispose());
    else m?.dispose();
  }
  if (!o) return;
  const r = Math.max(1e-3, radius / 130);
  for (const ln of o.lines) {
    if (ln.pts.length < 2) continue;
    const pts = ln.pts.map((p) => new THREE.Vector3(p[0], p[1], p[2]));
    if ((ln.width ?? 1) >= 3) {
      const path = new THREE.CurvePath<THREE.Vector3>();
      for (let i = 1; i < pts.length; i++) if (pts[i].distanceTo(pts[i - 1]) > 1e-9) path.add(new THREE.LineCurve3(pts[i - 1], pts[i]));
      if (!path.curves.length) continue;
      const tube = new THREE.Mesh(new THREE.TubeGeometry(path, Math.max(2, pts.length * 2), r * 0.35, 6, false), new THREE.MeshBasicMaterial({ color: ln.color, depthTest: false, transparent: true, opacity: 0.95 }));
      tube.renderOrder = 22;
      grp.add(tube);
      continue;
    }
    const geo = new THREE.BufferGeometry().setFromPoints(pts);
    const mat = ln.dashed ? new THREE.LineDashedMaterial({ color: ln.color, dashSize: r * 2, gapSize: r, depthTest: false }) : new THREE.LineBasicMaterial({ color: ln.color, depthTest: false });
    const line = new THREE.Line(geo, mat);
    if (ln.dashed) line.computeLineDistances();
    line.renderOrder = 22;
    grp.add(line);
  }
  for (const pt of o.points) {
    const dot = new THREE.Mesh(new THREE.SphereGeometry(pt.big ? r * 1.6 : r, 12, 10), new THREE.MeshBasicMaterial({ color: pt.color, depthTest: false }));
    dot.position.set(pt.p[0], pt.p[1], pt.p[2]);
    dot.renderOrder = 23;
    grp.add(dot);
  }
}
