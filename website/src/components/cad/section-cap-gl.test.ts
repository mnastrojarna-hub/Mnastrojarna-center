/**
 * Vlna 22 (zpráva 20. 11. – čela řezu v sestavě): materiál čela pro 3D okno. Bez WebGL v Node se ověří, že kód čela jde
 * vložit do shaderu MeshBasicMaterial této verze three (kotvy existují, kód je tam jednou), že čelo nese značku „nevybírat“,
 * matici komponenty a projekční matici kamery, a že výpočet hloubky v rovině řezu (zrcadlo kódu shaderu) odpovídá
 * konvencím ořezu three.js (rovina v pohledových souřadnicích, ponechá se n·p + w ≥ 0).
 */
import { describe, expect, it } from "vitest";
import * as THREE from "three";
import { capStyle, hatchWorld } from "@/cad/section-cap";
import { contourLength } from "@/cad/section-contour";
import { CAP_OUTLINE_PX, CAP_SHADER_ANCHORS, capHatchView, capMaterial, capMesh, capMeshes, capOrder, capOutline, capOutlineSegments, isCapObject, isCapStencil, patchCapShader, syncCapCamera, updateCapOutline } from "./section-cap-gl";

const style = capStyle({ id: "deska-a", color: "#b9c2cc" }, "shadedEdges", 0)!;
const fakeUniforms = () => ({ capProj: { value: new THREE.Matrix4() }, capHatch: { value: new THREE.Vector4(1, 0, 0, 0) }, capHatchWidth: { value: 1 }, capHatchColor: { value: new THREE.Color() } });

describe("čelo řezu – shader a materiál (section-cap-gl)", () => {
  it("kotvy kódu čela existují ve shaderu MeshBasicMaterial této verze three a kód se vloží právě jednou", () => {
    const src = THREE.ShaderLib.basic.fragmentShader;
    for (const a of Object.values(CAP_SHADER_ANCHORS)) expect(src.split(a).length - 1).toBe(1);
    const shader = { fragmentShader: src, uniforms: {} as Record<string, { value: unknown }> };
    expect(patchCapShader(shader, fakeUniforms())).toBe(true);
    const f = shader.fragmentShader;
    expect(f.split("gl_FragDepth = capDepth;").length - 1).toBe(1);
    expect(f.split("uniform mat4 capProj;").length - 1).toBe(1);
    // kolo 7 (vědomá změna): šrafy vázané na model – hodnota z bodu čela v rovině řezu, tloušťka přes derivace (pixely)
    expect(f.split("float capV = dot( capPt, capHatch.xyz ) + capHatch.w;").length - 1).toBe(1);
    expect(f).toContain("fract( capV ) < capHatchWidth * capFw");
    expect(f).not.toContain("gl_FragCoord.xy, capHatch");
    // pořadí: deklarace před main, hloubka za ořezem (zahozené fragmenty), šrafy za barvou
    expect(f.indexOf("uniform mat4 capProj;")).toBeLessThan(f.indexOf("void main() {"));
    expect(f.indexOf("gl_FragDepth")).toBeGreaterThan(f.indexOf("#include <clipping_planes_fragment>"));
    expect(f.indexOf("capHatchColor;", f.indexOf("void main"))).toBeGreaterThan(f.indexOf("#include <color_fragment>"));
    // kód hloubky jen s rovinou ořezu (bez ní shader čela zůstane platný)
    expect(f).toMatch(/#if NUM_CLIPPING_PLANES > 0[\s\S]*gl_FragDepth = capDepth;[\s\S]*#endif/);
    expect(Object.keys(shader.uniforms).sort()).toEqual(["capHatch", "capHatchColor", "capHatchWidth", "capProj"]);
  });

  it("jiný shader bez kotev se nezmění (žádný rozbitý program)", () => {
    const shader = { fragmentShader: "void main() { gl_FragColor = vec4(1.0); }", uniforms: {} as Record<string, { value: unknown }> };
    expect(patchCapShader(shader, fakeUniforms())).toBe(false);
    expect(shader.fragmentShader).toBe("void main() { gl_FragColor = vec4(1.0); }");
    expect(shader.uniforms).toEqual({});
  });

  it("materiál: rub stěn, oříznutý rovinou řezu, bez tónování, barva čela; průhledné čelo nezapisuje hloubku", () => {
    const plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), -15);
    const m = capMaterial(style, plane, 2);
    expect(m.side).toBe(THREE.BackSide);
    expect(m.clippingPlanes?.[0]).toBe(plane); // tentýž objekt jako u těla – posun řezu bez nové stavby
    expect(m.toneMapped).toBe(false);
    expect(m.transparent).toBe(false);
    expect(m.depthWrite).toBe(true);
    expect("#" + m.color.getHexString()).toBe(style.hex);
    const u = m.userData.capUniforms;
    // kolo 7 (vědomá změna): rozteč v mm (model), jen tloušťka čáry v pixelech plátna
    expect(u.capHatchWidth.value).toBe(style.hatch.width * 2);
    expect(m.userData.capHatchMm).toBe(style.hatch.stepMm);
    // všechna čela sdílejí jeden program
    const t = capMaterial(capStyle({ id: "b", color: "#4678c8", dim: true }, "shaded", 3)!, plane);
    expect(t.customProgramCacheKey()).toBe(m.customProgramCacheKey());
    expect(t.transparent).toBe(true);
    expect(t.depthWrite).toBe(false);
    expect(t.opacity).toBe(0.18);
    // onBeforeCompile vloží kód čela
    const shader = { fragmentShader: THREE.ShaderLib.basic.fragmentShader, vertexShader: THREE.ShaderLib.basic.vertexShader, uniforms: {} } as unknown as THREE.WebGLProgramParametersWithUniforms;
    m.onBeforeCompile(shader, {} as THREE.WebGLRenderer);
    expect(shader.fragmentShader).toContain("gl_FragDepth = capDepth;");
    expect(shader.uniforms.capProj).toBe(u.capProj);
  });

  it("síť čela: matice a id komponenty (pohyb, rozložení, gizmo), značka čela, projekce kamery před vykreslením", () => {
    const geo = new THREE.BoxGeometry(40, 30, 20);
    const plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), -15);
    const mtx = new THREE.Matrix4().makeTranslation(40, 0, 0);
    const cap = capMesh(geo, style, plane, mtx, { id: "k2", topId: "k2", key: "deska-b" });
    expect(isCapObject(cap)).toBe(true);
    expect(isCapObject(new THREE.Mesh(geo))).toBe(false);
    expect(cap.userData).toMatchObject({ id: "k2", topId: "k2", key: "deska-b", cap: true });
    expect(cap.matrixAutoUpdate).toBe(false);
    expect(cap.matrix.equals(mtx)).toBe(true);
    const cam = new THREE.PerspectiveCamera(30, 1.5, 0.5, 5000);
    cam.updateProjectionMatrix();
    cap.onBeforeRender({} as THREE.WebGLRenderer, new THREE.Scene(), cam, geo, cap.material as THREE.Material, new THREE.Group());
    expect((cap.material as THREE.Material).userData.capUniforms.capProj.value.equals(cam.projectionMatrix)).toBe(true);
    const ortho = new THREE.OrthographicCamera(-100, 100, 80, -80, -1e6, 1e6);
    syncCapCamera(cap, ortho);
    expect((cap.material as THREE.Material).userData.capUniforms.capProj.value.equals(ortho.projectionMatrix)).toBe(true);
  });
});

/* ───────────── zrcadlo výpočtu hloubky ze shaderu (stejné vzorce, JS) ───────────── */
/** pohledová rovina tak, jak ji three.js posílá do shaderu (WebGLClipping.projectPlanes): normála a konstanta po transformaci */
function viewPlane(world: THREE.Plane, cam: THREE.Camera): THREE.Vector4 {
  cam.updateMatrixWorld();
  const vm = cam.matrixWorldInverse;
  const p = world.clone().applyMatrix4(vm, new THREE.Matrix3().getNormalMatrix(vm));
  return new THREE.Vector4(p.normal.x, p.normal.y, p.normal.z, p.constant);
}
/** CAP_DEPTH ze shaderu: P = pohledová poloha fragmentu (−vClipPosition), pl = clippingPlanes[0] */
function capPoint(P: THREE.Vector3, pl: THREE.Vector4, ortho: boolean): THREE.Vector3 | null {
  if (ortho) {
    if (Math.abs(pl.z) <= 1e-6) return null;
    const X = new THREE.Vector3(P.x, P.y, -(pl.w + pl.x * P.x + pl.y * P.y) / pl.z);
    return X.z >= P.z ? X : null;
  }
  const den = pl.x * P.x + pl.y * P.y + pl.z * P.z;
  if (Math.abs(den) <= 1e-12) return null;
  const t = -pl.w / den;
  return t > 0 && t <= 1 ? P.clone().multiplyScalar(t) : null;
}

describe("hloubka čela = průsečík paprsku kamery s rovinou řezu (konvence three.js)", () => {
  const world = new THREE.Plane(new THREE.Vector3(0, 1, 0), -15); // ponechá y ≥ 15
  // bod zadní stěny kvádru (rub viditelný otvorem řezu): y = 30, ponechaná strana
  const back = new THREE.Vector3(12, 30, 7);

  for (const ortho of [false, true]) {
    it(ortho ? "pravoúhlý pohled" : "perspektiva", () => {
      const cam = ortho ? new THREE.OrthographicCamera(-100, 100, 80, -80, -1e6, 1e6) : new THREE.PerspectiveCamera(30, 1.5, 0.5, 5000);
      cam.up.set(0, 0, 1);
      cam.position.set(60, -260, 120);
      cam.lookAt(20, 15, 10);
      cam.updateMatrixWorld();
      if (cam instanceof THREE.PerspectiveCamera) cam.updateProjectionMatrix();
      const pl = viewPlane(world, cam);
      const P = back.clone().applyMatrix4(cam.matrixWorldInverse);
      // fragment zadní stěny projde ořezem shaderu: dot(vClipPosition, n) > w → zahodit
      expect(P.clone().negate().dot(new THREE.Vector3(pl.x, pl.y, pl.z)) > pl.w).toBe(false);
      const X = capPoint(P, pl, ortho)!;
      expect(X).not.toBeNull();
      const Xw = X.clone().applyMatrix4(cam.matrixWorld);
      expect(world.distanceToPoint(Xw)).toBeCloseTo(0, 6); // leží v rovině řezu
      // leží na paprsku kamery → stejný pixel jako fragment zadní stěny
      const a = back.clone().project(cam);
      const b = Xw.clone().project(cam);
      expect(b.x).toBeCloseTo(a.x, 9);
      expect(b.y).toBeCloseTo(a.y, 9);
      // a blíž ke kameře (menší hloubka) než zadní stěna – hrany zadní stěny za čelem neprojdou testem hloubky
      expect(b.z).toBeLessThan(a.z);
      // hloubka do bufferu jako ve shaderu: capProj · X
      const c = new THREE.Vector4(X.x, X.y, X.z, 1).applyMatrix4(cam.projectionMatrix);
      expect(c.z / c.w).toBeCloseTo(b.z, 9);
    });
  }

  it("kamera na ponechané straně (díváme se zezadu): hloubka se nemění", () => {
    const cam = new THREE.PerspectiveCamera(30, 1.5, 0.5, 5000);
    cam.up.set(0, 0, 1);
    cam.position.set(20, 300, 10);
    cam.lookAt(20, 15, 10);
    cam.updateMatrixWorld();
    const pl = viewPlane(world, cam);
    const P = new THREE.Vector3(12, 20, 7).applyMatrix4(cam.matrixWorldInverse);
    expect(capPoint(P, pl, false)).toBeNull();
  });
});

/* ───────────── kolo 7: šrafy vázané na model a obrys čela ve 3D okně ───────────── */
describe("kolo 7 – šrafy čela vázané na model a obrys (3D okno)", () => {
  it("uniforma šraf v pohledových souřadnicích dá v každém bodě tutéž hodnotu jako softwarový náhled (hatchWorld ve světě)", () => {
    const plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), -15);
    const world = new THREE.Matrix4().makeRotationZ(0.3).setPosition(12, -3, 5);
    for (const cam of [new THREE.PerspectiveCamera(30, 1.5, 0.5, 5000), new THREE.OrthographicCamera(-100, 100, 80, -80, -1e6, 1e6)]) {
      cam.position.set(60, -200, 90);
      cam.lookAt(20, 15, 10);
      cam.updateMatrixWorld();
      const hv = capHatchView(world, plane, 60, 2.75, cam);
      const { g, g0 } = hatchWorld(world.elements, [0, 1, 0], 60, 2.75);
      for (const p of [new THREE.Vector3(20, 15, 10), new THREE.Vector3(-7, 15, 33), new THREE.Vector3(41, 15, -2)]) {
        const q = p.clone().applyMatrix4(cam.matrixWorldInverse); // pohledové souřadnice (to, co shader má v capPt)
        const vGl = hv.x * q.x + hv.y * q.y + hv.z * q.z + hv.w;
        const vSoft = g[0] * p.x + g[1] * p.y + g[2] * p.z + g0;
        expect(vGl).toBeCloseTo(vSoft, 6);
      }
    }
  });

  it("syncCapCamera nastaví šrafy podle matice komponenty: posun komponenty posune šrafy s ní (ne s obrazovkou)", () => {
    const st = capStyle({ id: "a", color: "#b9c2cc" }, "shaded", 0, 0.25)!;
    const plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), -15);
    const geo = new THREE.BoxGeometry(40, 30, 20);
    const cam = new THREE.OrthographicCamera(-100, 100, 80, -80, -1e6, 1e6);
    cam.position.set(0, -300, 0);
    cam.lookAt(0, 0, 0);
    cam.updateMatrixWorld();
    const val = (x: number) => {
      const cap = capMesh(geo, st, plane, new THREE.Matrix4().makeTranslation(x, 0, 0), { id: "a", topId: "a", key: "a" });
      cap.updateMatrixWorld(true); // ve 3D okně vynucuje přepočet scéna (matrixAutoUpdate = false)
      syncCapCamera(cap, cam);
      const hv = ((cap.material as THREE.Material).userData.capUniforms.capHatch.value as THREE.Vector4).clone();
      // tentýž bod komponenty (místní 3, 15, 2) v pohledu
      const q = new THREE.Vector3(3 + x, 15, 2).applyMatrix4(cam.matrixWorldInverse);
      return hv.x * q.x + hv.y * q.y + hv.z * q.z + hv.w;
    };
    expect(val(17)).toBeCloseTo(val(0), 6);
    expect(Math.abs(val(0))).toBeGreaterThan(0);
  });

  it("obrys čela: úsečky v rovině řezu (místní souřadnice), posun do odebrané strany, přepočet po pohybu komponenty", () => {
    const st = capStyle({ id: "a", color: "#b9c2cc" }, "shaded", 0)!;
    const plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), -15);
    const bg = new THREE.BoxGeometry(40, 30, 20).translate(0, 15, 0).toNonIndexed(); // y 0…30
    const pos = bg.getAttribute("position").array as Float32Array;
    const mesh = { vertices: pos, triangles: new Uint32Array(pos.length / 3).map((_, i) => i) };
    const l = capOutline(mesh, st, plane, new THREE.Matrix4(), { id: "a", topId: "a", key: "a" }, -0.01);
    expect(isCapObject(l)).toBe(true);
    expect(l.userData.capOutline).toBe(true);
    expect("#" + (l.material as unknown as { color: THREE.Color }).color.getHexString()).toBe(st.outlineHex);
    expect((l.material as unknown as { linewidth: number }).linewidth).toBe(CAP_OUTLINE_PX);
    expect(l.visible).toBe(false); // bez úseček se nekreslí
    l.updateMatrixWorld(true);
    expect(updateCapOutline(l, { x: 800, y: 600 })).toBeGreaterThan(0);
    expect(l.visible).toBe(true);
    expect((l.material as unknown as { resolution: THREE.Vector2 }).resolution.toArray()).toEqual([800, 600]);
    const a = capOutlineSegments(l)!;
    expect(contourLength(a)).toBeCloseTo(2 * (40 + 20), 4);
    for (let j = 1; j < a.length; j += 3) expect(a[j]).toBeCloseTo(14.99, 4);
    // komponenta posunutá o 5 v Y: rovina řezu je v místních souřadnicích v y = 10
    l.matrix.makeTranslation(0, 5, 0);
    l.updateMatrixWorld(true);
    updateCapOutline(l);
    const b = capOutlineSegments(l)!;
    for (let j = 1; j < b.length; j += 3) expect(b[j]).toBeCloseTo(9.99, 4);
  });

  /**
   * Kolo 7, nález oponenta (šikmý pohled): hloubka v rovině řezu dostávala každý fragment rubu stěn – čelo přebarvilo
   * přední stěny zachované části, kudy paprsek protne rovinu mimo těleso. Emulace jednoho pixelu podle nastavení šablony
   * a hloubky materiálů (stejná pravidla jako WebGL): paprsek = seznam zachovaných stěn komponenty (hloubka, strana).
   */
  const stencilOp = (op: number, v: number, ref: number, wm: number) => {
    const nv = op === THREE.ZeroStencilOp ? 0 : op === THREE.InvertStencilOp ? ~v & 0xff : op === THREE.ReplaceStencilOp ? ref : v;
    return (v & ~wm) | (nv & wm);
  };
  const stencilPass = (m: THREE.Material, v: number) => {
    if (!m.stencilWrite) return true;
    const a = m.stencilRef & m.stencilFuncMask, b = v & m.stencilFuncMask;
    return m.stencilFunc === THREE.AlwaysStencilFunc || (m.stencilFunc === THREE.EqualStencilFunc && a === b) || (m.stencilFunc === THREE.NotEqualStencilFunc && a !== b);
  };
  /** pixel: neprůhledné těleso (přední stěny zapisují hloubku; menší = blíž), pak objekty čela v pořadí renderOrder */
  function pixel(objs: THREE.Mesh[], wall: { z: number; front: boolean }[], planeZ: number) {
    let depth = 1, stencil = 0, color = "pozadí";
    for (const w of wall) if (w.front && w.z < depth) { depth = w.z; color = "těleso"; }
    for (const o of [...objs].sort((a, b) => a.renderOrder - b.renderOrder)) {
      const m = o.material as THREE.MeshBasicMaterial;
      for (const w of wall) {
        const drawn = m.side === THREE.DoubleSide || (m.side === THREE.BackSide ? !w.front : w.front);
        if (!drawn) continue;
        // hloubka čela: rovina řezu, když leží mezi kamerou a fragmentem (CAP_DEPTH), jinak fragment
        const z = m.userData.capStencil ? w.z : planeZ <= w.z ? planeZ : w.z;
        if (!stencilPass(m, stencil)) {
          if (m.stencilWrite) stencil = stencilOp(m.stencilFail, stencil, m.stencilRef, m.stencilWriteMask);
          continue;
        }
        const zok = !m.depthTest || z < depth;
        if (m.stencilWrite) stencil = stencilOp(zok ? m.stencilZPass : m.stencilZFail, stencil, m.stencilRef, m.stencilWriteMask);
        if (!zok) continue;
        if (m.colorWrite) color = "čelo";
        if (m.depthWrite) depth = z;
      }
    }
    return { color, stencil };
  }

  it("čelo se šablonou: v šikmém pohledu nepřebarví přední stěnu zachované části (dřív ano), v ploše řezu ano", () => {
    const geo = new THREE.BoxGeometry(1, 1, 1);
    const plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), -15);
    const objs = capMeshes(geo, style, plane, new THREE.Matrix4(), { id: "a", topId: "a", key: "a" }, 0);
    // paprsek protne rovinu mimo těleso (hloubka 0,2), pak vstoupí přední stěnou (0,4) a vystoupí zadní (0,7)
    const outside = [{ z: 0.4, front: true }, { z: 0.7, front: false }];
    // paprsek protne rovinu uvnitř tělesa (0,3): přední část je odříznutá, zbývá zadní stěna (0,7)
    const inside = [{ z: 0.7, front: false }];
    expect(pixel(objs, outside, 0.2)).toEqual({ color: "těleso", stencil: 0 });
    expect(pixel(objs, inside, 0.3)).toEqual({ color: "čelo", stencil: 0 });
    // vydutý tvar: vstup a výstup za rovinou + zadní stěna (lichý počet = uvnitř), šablona po sobě vynulovaná
    expect(pixel(objs, [{ z: 0.5, front: false }, { z: 0.6, front: true }, { z: 0.8, front: false }], 0.3)).toEqual({ color: "čelo", stencil: 0 });
    // starý stav (jen čelo bez šablony): přední stěnu přebarvilo – emulace vadu ukazuje
    const old = capMesh(geo, style, plane, new THREE.Matrix4(), { id: "a", topId: "a", key: "a" });
    (old.material as THREE.Material).stencilWrite = false;
    expect(pixel([old], outside, 0.2).color).toBe("čelo");
    // průhledné čelo: tytéž průchody v seznamu průhledných objektů, šablona stejná
    const tst = capStyle({ id: "b", color: "#4678c8", dim: true }, "shaded", 3)!;
    const tobjs = capMeshes(geo, tst, plane, new THREE.Matrix4(), { id: "b", topId: "b", key: "b" }, 1);
    expect(tobjs.every((o) => (o.material as THREE.Material).transparent)).toBe(true);
    expect(pixel(tobjs, outside, 0.2).color).toBe("těleso");
    expect(pixel(tobjs, inside, 0.3).color).toBe("čelo");
  });

  it("průchody šablony: pořadí count → čelo → clear za tělesy a před překryvy, nesou id, nejsou cílem zásahu čela", () => {
    const geo = new THREE.BoxGeometry(1, 1, 1);
    const plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
    const a = capMeshes(geo, style, plane, new THREE.Matrix4().makeTranslation(3, 0, 0), { id: "a", topId: "t", key: "k" }, 0);
    const b = capMeshes(geo, style, plane, new THREE.Matrix4(), { id: "b", topId: "b", key: "k2" }, 1);
    const orders = [...a, ...b].map((o) => o.renderOrder);
    expect(orders).toEqual([...orders].sort((x, y) => x - y));
    expect(orders[0]).toBeGreaterThan(0);
    expect(capOrder(9999, 2)).toBeLessThan(4); // překryvy okna mají renderOrder 4 a víc
    expect(a.map((o) => o.userData.capStencil ?? "cap")).toEqual(["count", "cap", "clear"]);
    for (const o of a) {
      expect(isCapObject(o)).toBe(true);
      expect(o.userData.id).toBe("a");
      expect(o.userData.topId).toBe("t");
      expect(o.matrix.elements[12]).toBe(3);
    }
    expect(isCapStencil(a[0]) && !isCapStencil(a[1]) && isCapStencil(a[2])).toBe(true);
    const cm = a[0].material as THREE.Material;
    expect(cm.colorWrite || cm.depthWrite || cm.depthTest).toBe(false);
  });
});
