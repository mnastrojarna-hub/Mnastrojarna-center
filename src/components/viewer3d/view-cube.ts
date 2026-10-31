import * as THREE from "three";

/**
 * Orientační kostka v rohu (jako ZW3D / Inventor): ukazuje natočení modelu, klik na stěnu
 * nastaví standardní pohled. Kreslí se do malého výřezu stejného rendereru.
 */

export const CUBE_SIZE_PX = 112;

/** Stěny v lokálních souřadnicích BoxGeometry (+X, −X, +Y, −Y, +Z, −Z). */
const LABELS = ["VPRAVO", "VLEVO", "HORNÍ", "SPODNÍ", "PŘEDNÍ", "ZADNÍ"];

function faceTexture(text: string): THREE.CanvasTexture {
  const c = document.createElement("canvas");
  c.width = 128;
  c.height = 128;
  const ctx = c.getContext("2d")!;
  const g = ctx.createLinearGradient(0, 0, 0, 128);
  g.addColorStop(0, "#f4f6f9");
  g.addColorStop(1, "#dde3ea");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 128, 128);
  ctx.strokeStyle = "#8a96a5";
  ctx.lineWidth = 4;
  ctx.strokeRect(2, 2, 124, 124);
  ctx.fillStyle = "#272425";
  ctx.font = `bold ${text.length > 6 ? 21 : 25}px Roboto, Arial, sans-serif`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(text, 64, 66);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}

export class ViewCube {
  readonly scene = new THREE.Scene();
  readonly camera = new THREE.OrthographicCamera(-1.75, 1.75, 1.75, -1.75, 0.1, 20);
  private cube: THREE.Mesh;
  private materials: THREE.MeshBasicMaterial[];
  private raycaster = new THREE.Raycaster();
  private hovered = -1;

  constructor(zUp: boolean) {
    this.materials = LABELS.map((l) => new THREE.MeshBasicMaterial({ map: faceTexture(l) }));
    this.cube = new THREE.Mesh(new THREE.BoxGeometry(1.7, 1.7, 1.7), this.materials);
    const holder = new THREE.Group();
    holder.add(this.cube);
    // lokální +Y (HORNÍ) → svět +Z u modelů „Z nahoru"; lokální +Z (PŘEDNÍ) → svět −Y
    if (zUp) holder.rotation.x = Math.PI / 2;
    // osy X (červená), Y (zelená), Z (modrá) z rohu kostky
    const axes = new THREE.Group();
    const o = new THREE.Vector3(-0.85, -0.85, -0.85);
    const mk = (dir: THREE.Vector3, color: number) => {
      const g = new THREE.BufferGeometry().setFromPoints([o, o.clone().addScaledVector(dir, 2.3)]);
      return new THREE.Line(g, new THREE.LineBasicMaterial({ color, depthTest: false }));
    };
    // kostka je souměrná → roh (−,−,−) je rohem i po natočení
    axes.add(mk(new THREE.Vector3(1, 0, 0), 0xe03930), mk(new THREE.Vector3(0, 1, 0), 0x22a352), mk(new THREE.Vector3(0, 0, 1), 0x2f6fe0));
    this.scene.add(holder, axes);
  }

  /** Natočit kamerou kostky stejně jako hlavní kameru. */
  sync(main: THREE.Camera) {
    const back = new THREE.Vector3(0, 0, 1).applyQuaternion(main.quaternion);
    this.camera.position.copy(back.multiplyScalar(6));
    this.camera.quaternion.copy(main.quaternion);
    this.camera.updateMatrixWorld();
  }

  /** Normála stěny (svět) pod bodem ve výřezu kostky (souřadnice 0–1), nebo null. */
  pick(u: number, v: number): THREE.Vector3 | null {
    this.raycaster.setFromCamera(new THREE.Vector2(u * 2 - 1, -(v * 2 - 1)), this.camera);
    const hit = this.raycaster.intersectObject(this.cube, false)[0];
    if (!hit?.face) return null;
    const n = hit.face.normal.clone().transformDirection(this.cube.matrixWorld);
    return new THREE.Vector3(Math.round(n.x), Math.round(n.y), Math.round(n.z));
  }

  /** Zvýraznění stěny pod kurzorem; vrací true, když se změnilo. */
  hover(u: number | null, v: number | null): boolean {
    let idx = -1;
    if (u !== null && v !== null) {
      this.raycaster.setFromCamera(new THREE.Vector2(u * 2 - 1, -(v * 2 - 1)), this.camera);
      const hit = this.raycaster.intersectObject(this.cube, false)[0];
      idx = hit?.face ? hit.face.materialIndex : -1;
    }
    if (idx === this.hovered) return false;
    if (this.hovered >= 0) this.materials[this.hovered].color.set(0xffffff);
    if (idx >= 0) this.materials[idx].color.set(0xffd9a8);
    this.hovered = idx;
    return true;
  }

  dispose() {
    this.cube.geometry.dispose();
    for (const m of this.materials) {
      m.map?.dispose();
      m.dispose();
    }
    this.scene.traverse((o) => {
      const l = o as THREE.Line;
      if (l.isLine) {
        l.geometry.dispose();
        (l.material as THREE.Material).dispose();
      }
    });
  }
}
