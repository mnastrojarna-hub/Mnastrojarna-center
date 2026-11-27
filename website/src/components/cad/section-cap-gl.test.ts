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
import { CAP_OUTLINE_PX, CAP_SHADER_ANCHORS, capHatchView, capMaterial, capMesh, capOutline, capOutlineSegments, isCapObject, patchCapShader, syncCapCamera, updateCapOutline } from "./section-cap-gl";

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
});
