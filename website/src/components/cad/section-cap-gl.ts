/**
 * Vlna 22 (zpráva 20. 11.): čelo řezu komponenty sestavy ve 3D okně (WebGL).
 *
 * Stejný princip jako čelo dílu (kopie sítě s odvrácenými stěnami, oříznutá stejnou rovinou – skrz otvor řezu je vidět rub
 * stěn tělesa), navíc:
 *  - hloubka fragmentu se přepíše na průsečík paprsku kamery s rovinou řezu (gl_FragDepth) – čelo leží v rovině řezu, ne na
 *    zadní stěně, takže hrany a plochy uvnitř tělesa za čelem neprosvítají (stejně jako softwarový náhled, `soft-render.ts`);
 *  - barva a šrafy podle `@/cad/section-cap` (barva komponenty, kolize, různý vzor sousedních komponent), bez tónování
 *    (barva v obraze = barva čela, kontrolovatelná vzorkem pixelu v e2e);
 *  - průhledná čela (tlumená / průhledná komponenta) nezapisují hloubku.
 * Čelo se nevybírá: `userData.cap = true` → 3D okno ho vynechá z cílů výběru, najetí myší, výběru oknem i měření; čelo jen
 * zakrývá to, co je za ním.
 *
 * Kolo 7: šrafy vázané na MODEL – hodnota šraf v bodě čela = g·p + g0 (svět, `hatchWorld` z `@/cad/section-cap`, tentýž
 * vzorec jako softwarový náhled), před vykreslením převedená do pohledových souřadnic (uniforma `capHatch`); čára, když
 * zlomková část < tloušťka × |∇| (`dFdx`/`dFdy` – tloušťka v pixelech v každém přiblížení). Obrys čela = `LineSegments`
 * průsečnice roviny řezu se sítí (`@/cad/section-contour`) v místních souřadnicích komponenty, přepočtený před snímkem,
 * když se rovina vůči komponentě pohne (`updateCapOutline`).
 *
 * Kolo 7, oprava po oponentovi: hloubka v rovině řezu se dřív dávala KAŽDÉMU fragmentu rubu stěn, před kterým rovina leží –
 * v šikmém pohledu tak čelo (s hloubkou bližší než přední stěna zachované části) přebarvilo celou siluetu komponenty, kudy
 * paprsek protne rovinu MIMO těleso. Teď se čelo kreslí jen tam, kde bod roviny na paprsku leží UVNITŘ tělesa: šablona
 * (stencil) se nejdřív přepne každou zachovanou stěnou komponenty na paprsku (lichý počet průchodů = uvnitř, `capMeshes`
 * průchod „count“), čelo se kreslí jen s lichou šablonou a šablonu po sobě nuluje, zbytek vynuluje průchod „clear“. Totéž
 * pravidlo jako softwarový náhled (`soft-render.ts`: čelo jen tam, kde je nejbližší zachovaná stěna odvrácená).
 */
import * as THREE from "three";
import { LineMaterial } from "three/examples/jsm/lines/LineMaterial.js";
import { LineSegments2 } from "three/examples/jsm/lines/LineSegments2.js";
import { LineSegmentsGeometry } from "three/examples/jsm/lines/LineSegmentsGeometry.js";
import { hatchWorld, type CapStyle } from "@/cad/section-cap";
import { cachedContour, localPlane } from "@/cad/section-contour";

/** místa ve shaderu MeshBasicMaterial (three r186), za která se vkládá kód čela – kontroluje test */
export const CAP_SHADER_ANCHORS = { main: "void main() {", clip: "#include <clipping_planes_fragment>", color: "#include <color_fragment>" } as const;

const CAP_UNIFORMS = /* glsl */ `
uniform mat4 capProj;
uniform vec4 capHatch;
uniform float capHatchWidth;
uniform vec3 capHatchColor;
`;

/** hloubka čela = rovina řezu (pohledové souřadnice: paprsek z kamery, u pravoúhlého pohledu rovnoběžně s osou −z) */
const CAP_DEPTH = /* glsl */ `
#if NUM_CLIPPING_PLANES > 0
	vec3 capPt = - vClipPosition;
	{
		vec3 capP = - vClipPosition;
		vec4 capPl = clippingPlanes[ 0 ];
		float capDepth = gl_FragCoord.z;
		if ( isOrthographic ) {
			if ( abs( capPl.z ) > 1e-6 ) {
				vec3 capX = vec3( capP.xy, - ( capPl.w + dot( capPl.xy, capP.xy ) ) / capPl.z );
				if ( capX.z >= capP.z ) {
					capPt = capX;
					vec4 capC = capProj * vec4( capX, 1.0 );
					capDepth = clamp( ( capC.z / capC.w ) * 0.5 + 0.5, 0.0, 1.0 );
				}
			}
		} else {
			float capDen = dot( capPl.xyz, capP );
			if ( abs( capDen ) > 1e-12 ) {
				float capT = - capPl.w / capDen;
				if ( capT > 0.0 && capT <= 1.0 ) {
					capPt = capP * capT;
					vec4 capC = capProj * vec4( capPt, 1.0 );
					capDepth = clamp( ( capC.z / capC.w ) * 0.5 + 0.5, 0.0, 1.0 );
				}
			}
		}
		gl_FragDepth = capDepth;
	}
#endif
`;

/**
 * šrafy vázané na model: v = capHatch.xyz · bod čela (pohledové souřadnice, bod v rovině řezu) + capHatch.w; čára, když
 * fract(v) < tloušťka × |∇v| (pixely) – shodně se softwarovým náhledem (`soft-render.ts`, `onModelHatch`)
 */
const CAP_HATCH = /* glsl */ `
#if NUM_CLIPPING_PLANES > 0
	if ( capHatchWidth > 0.0 ) {
		float capV = dot( capPt, capHatch.xyz ) + capHatch.w;
		float capFw = length( vec2( dFdx( capV ), dFdy( capV ) ) );
		if ( fract( capV ) < capHatchWidth * capFw ) diffuseColor.rgb = capHatchColor;
	}
#endif
`;

type CapUniforms = { capProj: { value: THREE.Matrix4 }; capHatch: { value: THREE.Vector4 }; capHatchWidth: { value: number }; capHatchColor: { value: THREE.Color } };

/** vloží kód čela do shaderu MeshBasicMaterial; vrací false, když některé místo ve shaderu chybí (jiná verze three) */
export function patchCapShader(shader: { fragmentShader: string; uniforms: Record<string, { value: unknown }> }, u: CapUniforms): boolean {
  const f = shader.fragmentShader;
  if (!f.includes(CAP_SHADER_ANCHORS.main) || !f.includes(CAP_SHADER_ANCHORS.clip) || !f.includes(CAP_SHADER_ANCHORS.color)) return false;
  shader.uniforms.capProj = u.capProj;
  shader.uniforms.capHatch = u.capHatch;
  shader.uniforms.capHatchWidth = u.capHatchWidth;
  shader.uniforms.capHatchColor = u.capHatchColor;
  shader.fragmentShader = f
    .replace(CAP_SHADER_ANCHORS.main, CAP_UNIFORMS + CAP_SHADER_ANCHORS.main)
    .replace(CAP_SHADER_ANCHORS.clip, CAP_SHADER_ANCHORS.clip + CAP_DEPTH)
    .replace(CAP_SHADER_ANCHORS.color, CAP_SHADER_ANCHORS.color + CAP_HATCH);
  return true;
}

/**
 * Materiál čela řezu: odvrácené stěny sítě komponenty oříznuté rovinou `plane` (tentýž objekt jako u těla – posun řezu
 * se projeví bez nové stavby). `pixelRatio` = pixely plátna na CSS px (tloušťka čáry šraf).
 */
export function capMaterial(st: CapStyle, plane: THREE.Plane, pixelRatio = 1): THREE.MeshBasicMaterial {
  const pr = pixelRatio > 0 && Number.isFinite(pixelRatio) ? pixelRatio : 1;
  const transparent = st.opacity < 1;
  const m = new THREE.MeshBasicMaterial({
    color: new THREE.Color(st.hex),
    side: THREE.BackSide,
    clippingPlanes: [plane],
    toneMapped: false,
    transparent,
    opacity: st.opacity,
    depthWrite: !transparent,
    // čelo jen tam, kde je bod roviny uvnitř tělesa (lichá šablona z průchodu „count“); po prvním fragmentu se šablona
    // vynuluje (průhledné čelo se v pixelu prolne jen jednou, další komponenta začíná od nuly)
    stencilWrite: true,
    stencilRef: 1,
    stencilFunc: THREE.EqualStencilFunc,
    stencilFuncMask: 1,
    stencilWriteMask: 0xff,
    stencilFail: THREE.KeepStencilOp,
    stencilZFail: THREE.ZeroStencilOp,
    stencilZPass: THREE.ZeroStencilOp,
  });
  const h = st.hatch;
  const u: CapUniforms = {
    capProj: { value: new THREE.Matrix4() },
    // šrafy v pohledových souřadnicích – nastaví `syncCapCamera` před každým vykreslením (kamera, matice komponenty, rovina)
    capHatch: { value: new THREE.Vector4(0, 0, 0, 0) },
    capHatchWidth: { value: h.stepMm > 0 ? h.width * pr : 0 },
    capHatchColor: { value: new THREE.Color(h.hex) },
  };
  m.userData = { cap: true, capUniforms: u, capHex: st.hex, capHatchHex: h.hex, capPattern: st.pattern, capHatchAngle: h.angle, capHatchMm: h.stepMm, capPlane: plane };
  m.onBeforeCompile = (shader) => {
    patchCapShader(shader, u);
  };
  // jeden program pro všechna čela (uniformy má každý materiál vlastní); v2 = šrafy vázané na model
  m.customProgramCacheKey = () => "mncad-section-cap-v2";
  return m;
}

const M3 = new THREE.Matrix3();
/**
 * Šrafy čela v pohledových souřadnicích kamery: hodnota ve světě v = g·p + g0 (`hatchWorld`, matice komponenty `world`,
 * světová rovina řezu); p = Rc·q + tc (q pohledové souřadnice, kamera.matrixWorld = [Rc | tc]) → v = (Rcᵀ·g)·q + (g·tc + g0).
 */
export function capHatchView(world: THREE.Matrix4, plane: THREE.Plane, angle: number, stepMm: number, camera: THREE.Camera, out = new THREE.Vector4()): THREE.Vector4 {
  const { g, g0 } = hatchWorld(world.elements, [plane.normal.x, plane.normal.y, plane.normal.z], angle, stepMm);
  const cw = camera.matrixWorld.elements;
  // Rcᵀ·g: sloupce Rc jsou osy kamery ve světě → složky = průměty g do os kamery
  M3.setFromMatrix4(camera.matrixWorld);
  const e = M3.elements;
  return out.set(e[0] * g[0] + e[1] * g[1] + e[2] * g[2], e[3] * g[0] + e[4] * g[1] + e[5] * g[2], e[6] * g[0] + e[7] * g[1] + e[8] * g[2], g[0] * cw[12] + g[1] * cw[13] + g[2] * cw[14] + g0);
}

/** projekční matice kamery a šrafy vázané na model do uniforem čela před vykreslením (perspektiva i pravoúhlý pohled, i snímek videa) */
export function syncCapCamera(cap: THREE.Object3D, camera: THREE.Camera) {
  const ud = ((cap as THREE.Mesh).material as THREE.Material | undefined)?.userData;
  const u = ud?.capUniforms as CapUniforms | undefined;
  if (!u) return;
  u.capProj.value.copy(camera.projectionMatrix);
  const plane = ud!.capPlane as THREE.Plane | undefined;
  if (plane && ud!.capHatchMm > 0) capHatchView(cap.matrixWorld, plane, ud!.capHatchAngle, ud!.capHatchMm, camera, u.capHatch.value);
}

/**
 * Čelo řezu komponenty: síť `geo` s maticí komponenty (přehrávání studie, rozložený pohled, tažení gizmem – čelo se hýbe
 * s tělem, protože nese stejné id), `userData.cap = true`.
 */
export function capMesh(geo: THREE.BufferGeometry, st: CapStyle, plane: THREE.Plane, matrix: THREE.Matrix4, ids: { id: string; topId: string; key: string }, pixelRatio = 1): THREE.Mesh {
  const cap = new THREE.Mesh(geo, capMaterial(st, plane, pixelRatio));
  cap.matrixAutoUpdate = false;
  cap.matrix.copy(matrix);
  cap.userData = { ...ids, cap: true };
  cap.onBeforeRender = (_r, _s, camera) => syncCapCamera(cap, camera);
  return cap;
}

/** pořadí kreslení čel: za tělesy a hranami (0), před překryvy okna (4+); komponenta k → count, čelo, clear po sobě */
export const CAP_ORDER_BASE = 1;
export const capOrder = (k: number, pass: 0 | 1 | 2): number => CAP_ORDER_BASE + (Math.max(0, Math.min(9999, Math.floor(k))) * 3 + pass) * 1e-4;

/**
 * Pomocný průchod šablony čela (bez barvy a hloubky): „count“ přepne bit 0 šablony každou zachovanou stěnou komponenty
 * (obě strany, bez hloubkového testu – lichý počet = bod roviny na paprsku je uvnitř uzavřeného tělesa), „clear“ šablonu
 * po čele vynuluje (pixely, kde čelo nemělo fragment). Průhledné čelo má průchody v seznamu průhledných objektů.
 */
export function capStencilMaterial(plane: THREE.Plane, pass: "count" | "clear", transparent: boolean): THREE.MeshBasicMaterial {
  const m = new THREE.MeshBasicMaterial({
    side: THREE.DoubleSide,
    clippingPlanes: [plane],
    colorWrite: false,
    depthWrite: false,
    depthTest: false,
    transparent,
    stencilWrite: true,
    stencilFunc: THREE.AlwaysStencilFunc,
    stencilRef: 0,
    stencilFuncMask: 0xff,
    stencilWriteMask: pass === "count" ? 1 : 0xff,
    stencilFail: THREE.KeepStencilOp,
    stencilZFail: pass === "count" ? THREE.InvertStencilOp : THREE.ZeroStencilOp,
    stencilZPass: pass === "count" ? THREE.InvertStencilOp : THREE.ZeroStencilOp,
  });
  m.userData = { cap: true, capStencil: pass };
  return m;
}

/**
 * Čelo řezu komponenty k se šablonou: [count, čelo, clear] ve správném pořadí kreslení (`capOrder`). Všechny tři nesou
 * id komponenty (gizmo a přehrávání je posunou s tělem) a `cap: true` (nevybírají se); pomocné průchody navíc
 * `capStencil` (nejsou cílem zásahu čela). 3D okno potřebuje kontext se šablonou (`stencil: true`).
 */
export function capMeshes(geo: THREE.BufferGeometry, st: CapStyle, plane: THREE.Plane, matrix: THREE.Matrix4, ids: { id: string; topId: string; key: string }, k: number, pixelRatio = 1): THREE.Mesh[] {
  const transparent = st.opacity < 1;
  const helper = (pass: "count" | "clear") => {
    const h = new THREE.Mesh(geo, capStencilMaterial(plane, pass, transparent));
    h.matrixAutoUpdate = false;
    h.matrix.copy(matrix);
    h.userData = { ...ids, cap: true, capStencil: pass };
    h.renderOrder = capOrder(k, pass === "count" ? 0 : 2);
    return h;
  };
  const cap = capMesh(geo, st, plane, matrix, ids, pixelRatio);
  cap.renderOrder = capOrder(k, 1);
  return [helper("count"), cap, helper("clear")];
}

/** pomocný průchod šablony čela (ne samo čelo) */
export const isCapStencil = (o: THREE.Object3D | null | undefined): boolean => !!o?.userData?.capStencil;

/** objekt je čelo řezu (ne těleso komponenty) – nevybírá se, nepočítá se do rozměru scény */
export const isCapObject = (o: THREE.Object3D | null | undefined): boolean => !!o?.userData?.cap;

/** tloušťka obrysu čela v CSS px (čára širší než hrany – hranice řezu je hlavní čára jako na výkrese) */
export const CAP_OUTLINE_PX = 2;

/**
 * Obrys čela řezu (kolo 7): široké úsečky (`LineSegments2`, tloušťka v CSS px) v místních souřadnicích komponenty (matice
 * komponenty – hýbe se s ní); body se přepočítají v `updateCapOutline` před snímkem z místní roviny řezu. Posun `offset`
 * (mm, záporný = do odebrané strany, odkud je čelo vidět) drží obrys před čelem v hloubce. Nese `cap: true` (nevybírá se,
 * nezakrývá výběr) a `capOutline: true`.
 */
export function capOutline(mesh: { vertices: ArrayLike<number>; triangles: ArrayLike<number> & object }, st: CapStyle, plane: THREE.Plane, matrix: THREE.Matrix4, ids: { id: string; topId: string; key: string }, offset: number): LineSegments2 {
  const g = new LineSegmentsGeometry();
  const transparent = st.opacity < 1;
  const m = new LineMaterial({ color: new THREE.Color(st.outlineHex).getHex(), linewidth: CAP_OUTLINE_PX, worldUnits: false, transparent, opacity: transparent ? Math.max(st.opacity, 0.35) : 1, toneMapped: false });
  m.userData = { capOutlineHex: st.outlineHex };
  const l = new LineSegments2(g, m);
  l.matrixAutoUpdate = false;
  l.matrix.copy(matrix);
  l.frustumCulled = false;
  l.visible = false; // až s prvními úsečkami (prázdná geometrie by v kreslení nic neudělala)
  l.userData = { ...ids, cap: true, capOutline: true, outlineMesh: mesh, outlinePlane: plane, outlineOffset: offset, outlineSeg: null };
  return l;
}

/**
 * Přepočítá obrys čela, když se rovina řezu vůči komponentě změnila (posun řezu, přehrávání studie, gizmo), a nastaví
 * rozlišení plátna (tloušťka čáry v px); vrací počet úseček. `size` = velikost plátna v CSS px.
 */
export function updateCapOutline(l: THREE.Object3D, size?: { x: number; y: number }): number {
  const ud = l.userData as { outlineMesh?: { vertices: ArrayLike<number>; triangles: ArrayLike<number> & object }; outlinePlane?: THREE.Plane; outlineOffset?: number; outlineSeg?: Float32Array | null };
  if (!ud.outlineMesh || !ud.outlinePlane) return 0;
  const p = ud.outlinePlane;
  const pl = localPlane(l.matrixWorld.elements, [p.normal.x, p.normal.y, p.normal.z], p.constant);
  const seg = cachedContour(ud.outlineMesh.vertices, ud.outlineMesh.triangles, pl, ud.outlineOffset ?? 0);
  const ls = l as LineSegments2;
  if (ud.outlineSeg !== seg) {
    ud.outlineSeg = seg;
    if (seg.length >= 6) ls.geometry.setPositions(seg);
    l.visible = seg.length >= 6;
  }
  if (size && size.x > 0 && size.y > 0) (ls.material as LineMaterial).resolution.set(size.x, size.y);
  return seg.length / 6;
}

/** úsečky obrysu (pro testy a diagnostiku): body naposledy nastavené `updateCapOutline` */
export const capOutlineSegments = (l: THREE.Object3D): Float32Array | null => (l.userData.outlineSeg as Float32Array | null) ?? null;
