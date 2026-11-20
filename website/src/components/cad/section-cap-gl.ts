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
 */
import * as THREE from "three";
import type { CapStyle } from "@/cad/section-cap";

/** místa ve shaderu MeshBasicMaterial (three r186), za která se vkládá kód čela – kontroluje test */
export const CAP_SHADER_ANCHORS = { main: "void main() {", clip: "#include <clipping_planes_fragment>", color: "#include <color_fragment>" } as const;

const CAP_UNIFORMS = /* glsl */ `
uniform mat4 capProj;
uniform vec4 capHatch;
uniform vec3 capHatchColor;
`;

/** hloubka čela = rovina řezu (pohledové souřadnice: paprsek z kamery, u pravoúhlého pohledu rovnoběžně s osou −z) */
const CAP_DEPTH = /* glsl */ `
#if NUM_CLIPPING_PLANES > 0
	{
		vec3 capP = - vClipPosition;
		vec4 capPl = clippingPlanes[ 0 ];
		float capDepth = gl_FragCoord.z;
		if ( isOrthographic ) {
			if ( abs( capPl.z ) > 1e-6 ) {
				vec3 capX = vec3( capP.xy, - ( capPl.w + dot( capPl.xy, capP.xy ) ) / capPl.z );
				if ( capX.z >= capP.z ) {
					vec4 capC = capProj * vec4( capX, 1.0 );
					capDepth = clamp( ( capC.z / capC.w ) * 0.5 + 0.5, 0.0, 1.0 );
				}
			}
		} else {
			float capDen = dot( capPl.xyz, capP );
			if ( abs( capDen ) > 1e-12 ) {
				float capT = - capPl.w / capDen;
				if ( capT > 0.0 && capT <= 1.0 ) {
					vec4 capC = capProj * vec4( capP * capT, 1.0 );
					capDepth = clamp( ( capC.z / capC.w ) * 0.5 + 0.5, 0.0, 1.0 );
				}
			}
		}
		gl_FragDepth = capDepth;
	}
#endif
`;

/** šrafy v pixelech obrazovky: čára, kde (x·nx + y·ny) mod rozteč < tloušťka (shodně s `onHatch` a softwarovým náhledem) */
const CAP_HATCH = /* glsl */ `
	if ( capHatch.z > 0.0 ) {
		float capH = dot( gl_FragCoord.xy, capHatch.xy );
		if ( mod( capH, capHatch.z ) < capHatch.w ) diffuseColor.rgb = capHatchColor;
	}
`;

type CapUniforms = { capProj: { value: THREE.Matrix4 }; capHatch: { value: THREE.Vector4 }; capHatchColor: { value: THREE.Color } };

/** vloží kód čela do shaderu MeshBasicMaterial; vrací false, když některé místo ve shaderu chybí (jiná verze three) */
export function patchCapShader(shader: { fragmentShader: string; uniforms: Record<string, { value: unknown }> }, u: CapUniforms): boolean {
  const f = shader.fragmentShader;
  if (!f.includes(CAP_SHADER_ANCHORS.main) || !f.includes(CAP_SHADER_ANCHORS.clip) || !f.includes(CAP_SHADER_ANCHORS.color)) return false;
  shader.uniforms.capProj = u.capProj;
  shader.uniforms.capHatch = u.capHatch;
  shader.uniforms.capHatchColor = u.capHatchColor;
  shader.fragmentShader = f
    .replace(CAP_SHADER_ANCHORS.main, CAP_UNIFORMS + CAP_SHADER_ANCHORS.main)
    .replace(CAP_SHADER_ANCHORS.clip, CAP_SHADER_ANCHORS.clip + CAP_DEPTH)
    .replace(CAP_SHADER_ANCHORS.color, CAP_SHADER_ANCHORS.color + CAP_HATCH);
  return true;
}

/**
 * Materiál čela řezu: odvrácené stěny sítě komponenty oříznuté rovinou `plane` (tentýž objekt jako u těla – posun řezu
 * se projeví bez nové stavby). `pixelRatio` = pixely plátna na CSS px (rozteč šraf).
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
  });
  const h = st.hatch;
  const u: CapUniforms = {
    capProj: { value: new THREE.Matrix4() },
    capHatch: { value: new THREE.Vector4(h.nx, h.ny, h.step * pr, h.width * pr) },
    capHatchColor: { value: new THREE.Color(h.hex) },
  };
  m.userData = { cap: true, capUniforms: u, capHex: st.hex, capHatchHex: h.hex, capPattern: st.pattern };
  m.onBeforeCompile = (shader) => {
    patchCapShader(shader, u);
  };
  // jeden program pro všechna čela (uniformy má každý materiál vlastní)
  m.customProgramCacheKey = () => "mncad-section-cap-v1";
  return m;
}

/** projekční matice kamery do uniformy čela před vykreslením (perspektiva i pravoúhlý pohled, i snímek videa) */
export function syncCapCamera(cap: THREE.Object3D, camera: THREE.Camera) {
  const u = ((cap as THREE.Mesh).material as THREE.Material | undefined)?.userData?.capUniforms as CapUniforms | undefined;
  if (u) u.capProj.value.copy(camera.projectionMatrix);
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

/** objekt je čelo řezu (ne těleso komponenty) – nevybírá se, nepočítá se do rozměru scény */
export const isCapObject = (o: THREE.Object3D | null | undefined): boolean => !!o?.userData?.cap;
