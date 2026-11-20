/**
 * Vlna 22 (zpráva 20. 11. – čela řezu v sestavě): materiál čela pro 3D okno. Bez WebGL v Node se ověří, že kód čela jde
 * vložit do shaderu MeshBasicMaterial této verze three (kotvy existují, kód je tam jednou), že čelo nese značku „nevybírat“,
 * matici komponenty a projekční matici kamery, a že výpočet hloubky v rovině řezu (zrcadlo kódu shaderu) odpovídá
 * konvencím ořezu three.js (rovina v pohledových souřadnicích, ponechá se n·p + w ≥ 0).
 */
import { describe, expect, it } from "vitest";
import * as THREE from "three";
import { capStyle } from "@/cad/section-cap";
import { CAP_SHADER_ANCHORS, capMaterial, capMesh, isCapObject, patchCapShader, syncCapCamera } from "./section-cap-gl";

const style = capStyle({ id: "deska-a", color: "#b9c2cc" }, "shadedEdges", 0)!;
const fakeUniforms = () => ({ capProj: { value: new THREE.Matrix4() }, capHatch: { value: new THREE.Vector4(1, 0, 8, 1) }, capHatchColor: { value: new THREE.Color() } });

describe("čelo řezu – shader a materiál (section-cap-gl)", () => {
  it("kotvy kódu čela existují ve shaderu MeshBasicMaterial této verze three a kód se vloží právě jednou", () => {
    const src = THREE.ShaderLib.basic.fragmentShader;
    for (const a of Object.values(CAP_SHADER_ANCHORS)) expect(src.split(a).length - 1).toBe(1);
    const shader = { fragmentShader: src, uniforms: {} as Record<string, { value: unknown }> };
    expect(patchCapShader(shader, fakeUniforms())).toBe(true);
    const f = shader.fragmentShader;
    expect(f.split("gl_FragDepth = capDepth;").length - 1).toBe(1);
    expect(f.split("uniform mat4 capProj;").length - 1).toBe(1);
    expect(f.split("mod( capH, capHatch.z )").length - 1).toBe(1);
    // pořadí: deklarace před main, hloubka za ořezem (zahozené fragmenty), šrafy za barvou
    expect(f.indexOf("uniform mat4 capProj;")).toBeLessThan(f.indexOf("void main() {"));
    expect(f.indexOf("gl_FragDepth")).toBeGreaterThan(f.indexOf("#include <clipping_planes_fragment>"));
    expect(f.indexOf("capHatchColor;", f.indexOf("void main"))).toBeGreaterThan(f.indexOf("#include <color_fragment>"));
    // kód hloubky jen s rovinou ořezu (bez ní shader čela zůstane platný)
    expect(f).toMatch(/#if NUM_CLIPPING_PLANES > 0[\s\S]*gl_FragDepth = capDepth;[\s\S]*#endif/);
    expect(Object.keys(shader.uniforms).sort()).toEqual(["capHatch", "capHatchColor", "capProj"]);
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
    expect(u.capHatch.value.z).toBe(style.hatch.step * 2); // rozteč šraf v pixelech plátna
    expect(u.capHatch.value.w).toBe(style.hatch.width * 2);
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
