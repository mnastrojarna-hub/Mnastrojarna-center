"use client";

import { tr } from "@/cad/i18n";
import { forwardRef, useCallback, useEffect, useImperativeHandle, useRef, useState } from "react";
import { probeWebGL, type RenderFailure } from "@/cad/diagnostics";
import { perfMark } from "@/cad/perf-log";
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { TransformControls } from "three/examples/jsm/controls/TransformControls.js";
import { RoomEnvironment } from "three/examples/jsm/environments/RoomEnvironment.js";
import { toWorld } from "@/cad/defaults";
import { sectionKey, sectionPlane, type SectionState } from "@/cad/section-plane";
import { entityPath } from "@/cad/sketch";
import type { Feature, MeshData, Vec3 } from "@/cad/types";
import { sameSel, type MeasureGfx, type SelFilter, type SelItem } from "./selection";
import { softView, useSoftViewActive } from "./soft-bridge";

/**
 * Režim výběru: „select“ = obecný výběr entit podle filtru; ostatní režimy slouží formulářům prvků
 * (výběr hran pro zaoblení, ploch pro skořepinu, plochy pro skicu).
 */
export type PickMode = "none" | "select" | "edges" | "faces" | "face-plane" | "measure" | "component" | "asmFace";
export type ViewName = "iso" | "front" | "top" | "right" | "back" | "bottom" | "left";
export type DisplayMode = "shadedEdges" | "shaded" | "wireframe" | "hiddenLine" | "xray";
/** analýza ploch: zebra pruhy (návaznost ploch) – přebije běžný materiál tělesa */
export type SurfaceAnalysis = "none" | "zebra";
/** Schéma myši: ZW3D (pravé otáčí, prostřední posouvá), SolidWorks (prostřední otáčí, Ctrl+prostřední posouvá), jednoduché (levé otáčí). */
export type MouseScheme = "zw3d" | "solidworks" | "simple";
/** Řez: osová rovina (X / Y / Z + poloha) nebo obecná rovina (normála + bod + posun) – viz `@/cad/section-plane`. */
export type Section = SectionState | null;
export type Datum = { id: string; name: string; origin: Vec3; normal: Vec3; xDir: Vec3; size: number };
/** Pomocná osa / bod / souřadný systém k vykreslení (vyřešené jádrem). */
export type DatumGfx = { kind: "axis"; origin: Vec3; dir: Vec3; length: number } | { kind: "point"; p: Vec3 } | { kind: "csys"; origin: Vec3; x: Vec3; y: Vec3; z: Vec3; size: number };
/** Komponenta sestavy k vykreslení: síť dílu (sdílená podle `key`) + matice umístění (po sloupcích). */
export type AsmView = {
  /** jedinečné id listu (u podsestav cesta „a/b“) */
  id: string;
  /** komponenta nejvyšší úrovně (pro výběr podsestavy) */
  topId?: string;
  key: string;
  mesh: MeshData;
  vertices?: Float32Array;
  matrix: number[];
  color: string;
  selected?: boolean;
  dim?: boolean;
  clash?: boolean;
  opacity?: number;
};
/** Průhledné pomocné těleso jen k zobrazení (referenční model, rozdílová oblast při porovnání) – nejde vybrat; `xray` = kreslí se i skrz model. */
export type Ghost = { key: string; vertices: Float32Array; normals?: Float32Array | null; triangles: Uint32Array; color: string; opacity: number; xray?: boolean };
/** Gizmo pro přesun/otočení (TransformControls). `matrix` = výchozí poloha úchopu (po sloupcích). */
export type Gizmo = { id: string; matrix: number[]; mode: "translate" | "rotate"; targets: string[] } | null;

/** popisek entity na obrazovce */
export type Hint = { id: string; kind: "face" | "edge" | "vertex"; index: number; x: number; y: number; p: Vec3; title: string };
const axisName = (n: THREE.Vector3): string => (Math.abs(n.x) > 0.95 ? (n.x > 0 ? "+X" : "-X") : Math.abs(n.y) > 0.95 ? (n.y > 0 ? "+Y" : "-Y") : Math.abs(n.z) > 0.95 ? (n.z > 0 ? "+Z" : "-Z") : "");
export type ViewportHandle = {
  hintList: () => Omit<Hint, "p">[];
  clickHint: (id: string, additive?: boolean) => boolean;
  setView: (v: ViewName) => void;
  fit: () => void;
  snapshot: () => string | null;
  bounds: () => { center: Vec3; radius: number };
  /** přiblíží pohled na kouli (střed, poloměr) při zachování směru pohledu */
  focus: (center: Vec3, radius: number) => void;
  /** stav kamery a jeho obnovení – snímek pro agenta (window.mncad.screenshot) vrátí dočasný pohled zpět */
  camera?: () => unknown;
  setCamera?: (c: unknown) => void;
};

type Props = {
  mesh: MeshData | null;
  /** selhání 3D okna (WebGL nedostupné, kontext ztracen) – aplikace zobrazí chybovou obrazovku místo pádu */
  onRenderError?: (f: RenderFailure) => void;
  /** popisky entit (F1 plocha, E2 hrana, V3 vrchol) na viditelných místech – výběr myší bez trefování (AI agenti, automatizace) */
  hints?: boolean;
  /** topologické vrcholy tělesa dílu (x,y,z…) */
  vertices?: Float32Array | null;
  sketches: Extract<Feature, { type: "sketch" }>[];
  datums?: Datum[];
  datumGfx?: DatumGfx[];
  pickMode: PickMode;
  selFilter?: SelFilter;
  /** uchopování bodů na hranách (začátek, konec, střed, střed kružnice) – měření a výběr bodu do odkazu */
  snapPoints?: boolean;
  selection?: SelItem[];
  selectedEdges: number[];
  selectedFaces: number[];
  onPickEdge?: (i: number) => void;
  onPickFace?: (i: number, point?: [number, number, number]) => void;
  /** obecný výběr (režim „select“) */
  onPick?: (item: SelItem | null, additive: boolean) => void;
  onContext?: (x: number, y: number, item: SelItem | null) => void;
  onCursor?: (p: Vec3 | null) => void;
  measure?: MeasureGfx | null;
  assembly?: AsmView[];
  faceColors?: Record<number, string>;
  /** barvy vrcholů (RGB po trojicích, délka = vertices.length) – např. analýza úkosů; přebije barvy ploch */
  vertexColors?: Float32Array | null;
  /** průhledná pomocná tělesa (porovnání s referenčním modelem) */
  ghosts?: Ghost[] | null;
  /** zebra pruhy pro kontrolu hladkosti/návaznosti ploch */
  surface?: SurfaceAnalysis;
  bodyOpacity?: number;
  bodyHidden?: boolean;
  gizmo?: Gizmo;
  /** změna polohy gizma: delta = matice (po sloupcích) vůči výchozí poloze; final = konec tažení */
  onGizmo?: (delta: number[], final: boolean) => void;
  display?: DisplayMode;
  ortho?: boolean;
  section?: Section;
  bodyColor?: string;
  mouse?: MouseScheme;
  showGrid?: boolean;
};

const HOVER = new THREE.Color(0xf59e0b);
const SEL = new THREE.Color(0xe03930);
const HOVER_HEX = 0xf59e0b;
const SEL_HEX = 0xe03930;

type GeoInfo = { geo: THREE.BufferGeometry; edges: THREE.BufferGeometry; faceOf: Int32Array; edgeOf: Int32Array; mesh: MeshData };
type SnapCand = { item: SelItem; p: THREE.Vector3 };

type St = {
  renderer: THREE.WebGLRenderer;
  scene: THREE.Scene;
  persp: THREE.PerspectiveCamera;
  orthoCam: THREE.OrthographicCamera;
  camera: THREE.PerspectiveCamera | THREE.OrthographicCamera;
  key: THREE.DirectionalLight;
  controls: OrbitControls;
  tc: TransformControls;
  proxy: THREE.Object3D;
  gizmoStart: THREE.Matrix4;
  dragStarts: Map<THREE.Object3D, THREE.Matrix4>;
  model: THREE.Group;
  overlay: THREE.Group;
  hilite: THREE.Group;
  sketchGroup: THREE.Group;
  asmGroup: THREE.Group;
  asmGeo: Map<string, GeoInfo>;
  partGeo?: GeoInfo;
  mesh?: THREE.Mesh;
  cap?: THREE.Mesh;
  edges?: THREE.LineSegments;
  edgeHi?: THREE.LineSegments;
  grid: THREE.Group;
  hoverFace: number;
  hoverEdge: number;
  hoverItem: SelItem | null;
  /** kandidáti uchopení na naposledy přejeté hraně (začátek, konec, střed, střed kružnice) */
  snapCands: SnapCand[];
  snapGroup: THREE.Group;
  radius: number;
  center: THREE.Vector3;
  clip: THREE.Plane;
  render: () => void;
};

const edgeOfFrom = (m: MeshData) => {
  const edgeOf = new Int32Array(m.lines.length / 6).fill(-1);
  for (let i = 0; i < m.edgeGroups.length; i += 3) for (let k = m.edgeGroups[i] / 2; k < (m.edgeGroups[i] + m.edgeGroups[i + 1]) / 2; k++) edgeOf[k] = m.edgeGroups[i + 2];
  return edgeOf;
};
const faceOfFrom = (m: MeshData) => {
  const faceOf = new Int32Array(m.triangles.length / 3).fill(-1);
  for (let i = 0; i < m.faceGroups.length; i += 3) for (let t = m.faceGroups[i] / 3; t < (m.faceGroups[i] + m.faceGroups[i + 1]) / 3; t++) faceOf[t] = m.faceGroups[i + 2];
  return faceOf;
};
/** nová síť čeká na první vykreslení (měření nahrání do WebGL – perf-log) */
let uploadMark: { t0: number; tris: number; kind: string } | null = null;
/** posunul se model mimo dosavadní pohled (nový model jinde, stejně velký)? → přizpůsobit pohled */
const movedAway = (c: THREE.Vector3, r: number, prevC: THREE.Vector3, prevR: number) => c.distanceTo(prevC) > Math.max(r, prevR) * 0.5;

function geoInfo(m: MeshData): GeoInfo {
  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.BufferAttribute(m.vertices, 3));
  geo.setAttribute("normal", new THREE.BufferAttribute(m.normals, 3));
  geo.setIndex(new THREE.BufferAttribute(m.triangles, 1));
  const faceOf = faceOfFrom(m);
  for (let i = 0; i < m.faceGroups.length; i += 3) {
    geo.addGroup(m.faceGroups[i], m.faceGroups[i + 1], 0);
    (geo.groups[geo.groups.length - 1] as THREE.GeometryGroup & { face: number }).face = m.faceGroups[i + 2];
  }
  geo.userData.faceOf = faceOf;
  geo.computeBoundingSphere();
  const edges = new THREE.BufferGeometry();
  edges.setAttribute("position", new THREE.BufferAttribute(m.lines, 3));
  const edgeOf = edgeOfFrom(m);
  edges.userData.edgeOf = edgeOf;
  return { geo, edges, faceOf, edgeOf, mesh: m };
}

/**
 * 3D okno CAD: Z nahoru (strojírenská konvence), PBR materiál, výběr ploch/hran/bodů/těles/komponent raycastem
 * s filtrem výběru, ViewCube, osový kříž, styly zobrazení, řez rovinou, kóty měření a gizmo přesunu.
 */
export const Viewport = forwardRef<ViewportHandle, Props>(function Viewport(props, ref) {
  const host = useRef<HTMLDivElement>(null);
  const cubeRef = useRef<HTMLDivElement>(null);
  const triadRef = useRef<SVGSVGElement>(null);
  const labelsRef = useRef<HTMLDivElement>(null);
  const S = useRef<St | null>(null);
  const propsRef = useRef(props);
  propsRef.current = props;
  /** bez WebGL kreslí model softwarový náhled (viewport-soft.tsx) a přebírá pohledy, přizpůsobení i snímek */
  const softOn = useSoftViewActive();

  // ---------- popisky entit (F1 / E2 / V3) ----------
  const [hintList, setHintList] = useState<Hint[]>([]);
  const hintsRef = useRef<Hint[]>([]);
  hintsRef.current = hintList;
  const hintsTick = useRef<() => void>(() => undefined);
  const computeHints = useCallback(() => {
    const s = S.current;
    const el = host.current;
    const m = propsRef.current.mesh;
    if (!s || !el || !propsRef.current.hints) {
      setHintList((l) => (l.length ? [] : l));
      return;
    }
    const w = el.clientWidth;
    const h = el.clientHeight;
    const cam = s.camera;
    const out: Hint[] = [];
    const ray = new THREE.Raycaster();
    const targets: THREE.Object3D[] = s.mesh ? [s.mesh] : [];
    const radius = s.radius || 100;
    const tol = Math.max(0.05, radius * 0.01);
    const visible = (p: THREE.Vector3, t: number) => {
      if (!targets.length) return true;
      const ndc = p.clone().project(cam);
      ray.setFromCamera(new THREE.Vector2(ndc.x, ndc.y), cam);
      const hit = ray.intersectObjects(targets, false)[0];
      return !hit || hit.point.distanceTo(p) <= t;
    };
    const toScreen = (p: THREE.Vector3): [number, number, number] => {
      const v = p.clone().project(cam);
      return [((v.x + 1) / 2) * w, ((1 - v.y) / 2) * h, v.z];
    };
    const inside = (x: number, y: number, z: number) => z <= 1 && x >= 4 && y >= 4 && x <= w - 4 && y <= h - 4;
    const camDir = cam.getWorldDirection(new THREE.Vector3());
    if (m) {
      const V = m.vertices;
      const N = m.normals;
      const T = m.triangles;
      for (let g = 0; g + 2 < m.faceGroups.length && out.length < 300; g += 3) {
        const start = m.faceGroups[g];
        const count = m.faceGroups[g + 1];
        const fi = m.faceGroups[g + 2];
        if (count < 3) continue;
        let cx = 0, cy = 0, cz = 0, nx = 0, ny = 0, nz = 0, n = 0;
        const cents: Vec3[] = [];
        for (let i = start; i + 2 < start + count; i += 3) {
          const a = T[i] * 3, b = T[i + 1] * 3, c = T[i + 2] * 3;
          const tc: Vec3 = [(V[a] + V[b] + V[c]) / 3, (V[a + 1] + V[b + 1] + V[c + 1]) / 3, (V[a + 2] + V[b + 2] + V[c + 2]) / 3];
          cents.push(tc);
          cx += tc[0]; cy += tc[1]; cz += tc[2];
          nx += N[a]; ny += N[a + 1]; nz += N[a + 2];
          n++;
        }
        cx /= n; cy /= n; cz /= n;
        let best = cents[0];
        let bd = Infinity;
        for (const c of cents) {
          const d = (c[0] - cx) ** 2 + (c[1] - cy) ** 2 + (c[2] - cz) ** 2;
          if (d < bd) { bd = d; best = c; }
        }
        const nl = Math.hypot(nx, ny, nz) || 1;
        const nv = new THREE.Vector3(nx / nl, ny / nl, nz / nl);
        const planar = nl / n > 0.98;
        const p = new THREE.Vector3(best[0], best[1], best[2]);
        const toCam = cam instanceof THREE.OrthographicCamera ? camDir.clone().negate() : cam.position.clone().sub(p).normalize();
        if (planar && nv.dot(toCam) < 0.03) continue; // rovinná plocha odvrácená od kamery
        if (!visible(p, tol)) continue;
        const [x, y, z] = toScreen(p);
        if (!inside(x, y, z)) continue;
        const dir = axisName(nv);
        out.push({ id: `F${fi + 1}`, kind: "face", index: fi, x, y, p: best, title: tr("Plocha {0} · {1}{2}", fi + 1, planar ? tr("rovinná") : tr("zakřivená"), dir ? tr(" · normála {0}", dir) : "") });
      }
      const L = m.lines;
      let edges = 0;
      for (let g = 0; g + 2 < m.edgeGroups.length && edges < 400; g += 3) {
        const start = m.edgeGroups[g];
        const count = m.edgeGroups[g + 1];
        const ei = m.edgeGroups[g + 2];
        const nSeg = Math.floor(count / 2);
        if (nSeg < 1) continue;
        // štítek uprostřed hrany: u úsečky střed mezi koncovými body (ne vrchol), u křivky prostřední bod
        const k = start + 2 * Math.floor(nSeg / 2);
        const p = nSeg === 1 ? new THREE.Vector3((L[start * 3] + L[(start + 1) * 3]) / 2, (L[start * 3 + 1] + L[(start + 1) * 3 + 1]) / 2, (L[start * 3 + 2] + L[(start + 1) * 3 + 2]) / 2) : new THREE.Vector3(L[k * 3], L[k * 3 + 1], L[k * 3 + 2]);
        let len = 0;
        for (let q = start; q + 1 < start + count; q += 2) len += Math.hypot(L[(q + 1) * 3] - L[q * 3], L[(q + 1) * 3 + 1] - L[q * 3 + 1], L[(q + 1) * 3 + 2] - L[q * 3 + 2]);
        if (!visible(p, tol * 2)) continue;
        const [x, y, z] = toScreen(p);
        if (!inside(x, y, z)) continue;
        let kind = tr("křivka");
        if (nSeg === 1) {
          const d = new THREE.Vector3(L[(start + 1) * 3] - L[start * 3], L[(start + 1) * 3 + 1] - L[start * 3 + 1], L[(start + 1) * 3 + 2] - L[start * 3 + 2]).normalize();
          kind = Math.abs(d.z) > 0.99 ? tr("svislá úsečka") : Math.abs(d.z) < 0.01 ? tr("vodorovná úsečka") : tr("úsečka");
        }
        out.push({ id: `E${ei + 1}`, kind: "edge", index: ei, x, y, p: [p.x, p.y, p.z], title: tr("Hrana {0} · {1} · délka ≈ {2} mm", ei + 1, kind, Math.round(len * 10) / 10) });
        edges++;
      }
    }
    const vs = propsRef.current.vertices;
    if (vs) {
      let nv = 0;
      for (let i = 0; i + 2 < vs.length && nv < 200; i += 3) {
        const p = new THREE.Vector3(vs[i], vs[i + 1], vs[i + 2]);
        if (!visible(p, tol * 2)) continue;
        const [x, y, z] = toScreen(p);
        if (!inside(x, y, z)) continue;
        out.push({ id: `V${i / 3 + 1}`, kind: "vertex", index: i / 3, x, y, p: [p.x, p.y, p.z], title: tr("Vrchol {0} · [{1}; {2}; {3}]", i / 3 + 1, Math.round(p.x * 100) / 100, Math.round(p.y * 100) / 100, Math.round(p.z * 100) / 100) });
        nv++;
      }
    }
    setHintList(out);
  }, []);
  useEffect(() => {
    let t: ReturnType<typeof setTimeout> | null = null;
    hintsTick.current = () => {
      if (t) clearTimeout(t);
      t = setTimeout(computeHints, 160);
    };
    return () => {
      if (t) clearTimeout(t);
    };
  }, [computeHints]);
  useEffect(() => {
    const t = setTimeout(computeHints, 120); // až po přestavbě sítě ve scéně
    return () => clearTimeout(t);
  }, [props.hints, props.mesh, props.vertices, computeHints]);
  useEffect(() => {
    if (!props.hints) return;
    const on = () => hintsTick.current();
    window.addEventListener("resize", on);
    return () => window.removeEventListener("resize", on);
  }, [props.hints]);

  // ---------- inicializace ----------
  useEffect(() => {
    const el = host.current!;
    // dostupnost WebGL se ověří předem a selhání rendereru se zachytí – místo pádu aplikace chybová obrazovka
    const probe = probeWebGL();
    let renderer: THREE.WebGLRenderer;
    try {
      if (!probe.ok) throw new Error(probe.reason ?? tr("WebGL není dostupné"));
      renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true });
    } catch (e) {
      propsRef.current.onRenderError?.({ error: e instanceof Error ? e : new Error(String(e)), probe });
      return;
    }
    const onLost = (ev: Event) => {
      ev.preventDefault();
      perfMark("ui.webgl.lost", 0);
      propsRef.current.onRenderError?.({ error: new Error(tr("WebGL kontext byl ztracen")), probe, lost: true });
    };
    renderer.domElement.addEventListener("webglcontextlost", onLost);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.05;
    renderer.localClippingEnabled = true;
    el.appendChild(renderer.domElement);
    renderer.domElement.style.display = "block";
    renderer.domElement.style.touchAction = "none";

    const scene = new THREE.Scene();
    const pmrem = new THREE.PMREMGenerator(renderer);
    scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.03).texture;
    THREE.Object3D.DEFAULT_UP.set(0, 0, 1);
    const persp = new THREE.PerspectiveCamera(30, 1, 0.1, 1e6);
    persp.up.set(0, 0, 1);
    persp.position.set(220, -260, 180);
    const orthoCam = new THREE.OrthographicCamera(-100, 100, 100, -100, -1e6, 1e6);
    orthoCam.up.set(0, 0, 1);
    const controls = new OrbitControls(persp, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.14;
    controls.screenSpacePanning = true;
    controls.zoomToCursor = true;
    controls.addEventListener("change", () => hintsTick.current()); // popisky entit sledují kameru

    scene.add(new THREE.HemisphereLight(0xffffff, 0xcfd6de, 0.65));
    const key = new THREE.DirectionalLight(0xffffff, 1.15);
    key.position.set(1, -1.5, 2);
    persp.add(key);
    scene.add(persp);
    scene.add(orthoCam);

    const grid = new THREE.Group();
    scene.add(grid);
    const model = new THREE.Group();
    model.matrixAutoUpdate = false;
    scene.add(model);
    const overlay = new THREE.Group();
    scene.add(overlay);
    const hilite = new THREE.Group();
    hilite.matrixAutoUpdate = false;
    scene.add(hilite);
    const snapGroup = new THREE.Group();
    snapGroup.matrixAutoUpdate = false;
    scene.add(snapGroup);
    const sketchGroup = new THREE.Group();
    scene.add(sketchGroup);
    const asmGroup = new THREE.Group();
    scene.add(asmGroup);

    const axes = new THREE.Group();
    const ax = (dir: THREE.Vector3, color: number) => {
      const g = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), dir.clone().multiplyScalar(30)]);
      axes.add(new THREE.Line(g, new THREE.LineBasicMaterial({ color, depthTest: false, transparent: true, opacity: 0.9 })));
    };
    ax(new THREE.Vector3(1, 0, 0), 0xe03930);
    ax(new THREE.Vector3(0, 1, 0), 0x16a34a);
    ax(new THREE.Vector3(0, 0, 1), 0x2563eb);
    axes.renderOrder = 10;
    grid.add(axes);

    // gizmo (přesun / otočení)
    const tc = new TransformControls(persp, renderer.domElement);
    tc.setTranslationSnap(1);
    tc.setRotationSnap(THREE.MathUtils.degToRad(15));
    tc.setSpace("world");
    tc.setSize(0.9);
    const proxy = new THREE.Object3D();
    scene.add(proxy);
    scene.add(tc.getHelper());

    let raf = 0;
    let dirty = true;
    const render = () => {
      dirty = true;
    };
    const m4 = new THREE.Matrix4();
    const v3 = new THREE.Vector3();
    const loop = () => {
      raf = requestAnimationFrame(loop);
      const moved = controls.update();
      if (moved || dirty) {
        const s = S.current;
        if (s) {
          if (s.camera === s.orthoCam && key.parent !== orthoCam) orthoCam.add(key);
          if (s.camera === s.persp && key.parent !== persp) persp.add(key);
          const tRender = uploadMark ? performance.now() : 0;
          renderer.render(scene, s.camera);
          if (uploadMark) {
            perfMark("ui.three.firstRender", performance.now() - uploadMark.t0, { renderMs: Math.round(performance.now() - tRender), triangles: uploadMark.tris, kind: uploadMark.kind });
            uploadMark = null;
          }
          syncCube(s.camera);
          syncLabels(s.camera);
        }
        dirty = false;
      }
    };
    const syncLabels = (cam: THREE.Camera) => {
      const box = labelsRef.current;
      const labels = propsRef.current.measure?.labels ?? [];
      if (!box) return;
      const w = el.clientWidth;
      const h = el.clientHeight;
      labels.forEach((l, i) => {
        const d = box.children[i] as HTMLElement | undefined;
        if (!d) return;
        v3.set(...l.pos).project(cam);
        const hidden = v3.z > 1 || v3.z < -1;
        d.style.display = hidden ? "none" : "block";
        d.style.transform = `translate(${((v3.x + 1) / 2) * w}px, ${((1 - v3.y) / 2) * h}px) translate(-50%, -50%)`;
      });
    };
    const syncCube = (cam: THREE.Camera) => {
      cam.updateMatrixWorld();
      m4.copy(cam.matrixWorldInverse);
      const e = m4.elements;
      const css = [e[0], -e[1], e[2], 0, e[4], -e[5], e[6], 0, e[8], -e[9], e[10], 0, 0, 0, 0, 1];
      if (cubeRef.current) cubeRef.current.style.transform = `translateZ(-60px) matrix3d(${css.map((v) => v.toFixed(6)).join(",")})`;
      const t = triadRef.current;
      if (t) {
        const axesDef: [number, number][] = [
          [e[0], e[1]],
          [e[4], e[5]],
          [e[8], e[9]],
        ];
        axesDef.forEach(([x, y], i) => {
          const line = t.querySelector<SVGLineElement>(`[data-ax="${i}"]`);
          const lab = t.querySelector<SVGTextElement>(`[data-lab="${i}"]`);
          line?.setAttribute("x2", String(36 + x * 26));
          line?.setAttribute("y2", String(36 - y * 26));
          lab?.setAttribute("x", String(36 + x * 32));
          lab?.setAttribute("y", String(39 - y * 32));
        });
      }
    };
    loop();
    controls.addEventListener("change", render);
    tc.addEventListener("change", render);

    const resize = () => {
      const w = el.clientWidth;
      const h = el.clientHeight;
      if (!w || !h) return;
      renderer.setSize(w, h);
      persp.aspect = w / h;
      persp.updateProjectionMatrix();
      updateOrthoFrustum();
      render();
    };

    const clip = new THREE.Plane(new THREE.Vector3(0, 0, -1), 0);
    S.current = {
      renderer, scene, persp, orthoCam, camera: persp, key, controls, tc, proxy, gizmoStart: new THREE.Matrix4(), dragStarts: new Map(), model, overlay, hilite, sketchGroup, asmGroup,
      asmGeo: new Map(), grid, hoverFace: -1, hoverEdge: -1, hoverItem: null, snapCands: [], snapGroup, radius: 100, center: new THREE.Vector3(), clip, render,
    };
    resize();
    const ro = new ResizeObserver(() => {
      resize();
      hintsTick.current(); // štítky entit po změně velikosti 3D okna (otevření formuláře, panelů)
    });
    ro.observe(el);
    buildGrid(100);
    applyMouse();

    // ---------- gizmo: tažení ----------
    tc.addEventListener("dragging-changed", (ev) => {
      const s = S.current!;
      const dragging = (ev as unknown as { value: boolean }).value;
      controls.enabled = !dragging;
      if (dragging) {
        s.dragStarts.clear();
        proxy.updateMatrixWorld();
        s.gizmoStart.copy(proxy.matrixWorld);
        for (const o of movedObjects()) s.dragStarts.set(o, o.matrix.clone());
      } else {
        const delta = deltaMatrix();
        propsRef.current.onGizmo?.(delta.toArray(), true);
      }
    });
    tc.addEventListener("objectChange", () => {
      const s = S.current!;
      const delta = deltaMatrix();
      for (const [o, start] of s.dragStarts) {
        o.matrix.multiplyMatrices(delta, start);
        o.matrixWorldNeedsUpdate = true;
      }
      propsRef.current.onGizmo?.(delta.toArray(), false);
      s.render();
    });
    function deltaMatrix() {
      const s = S.current!;
      s.proxy.updateMatrixWorld();
      return new THREE.Matrix4().multiplyMatrices(s.proxy.matrixWorld, s.gizmoStart.clone().invert());
    }
    function movedObjects(): THREE.Object3D[] {
      const s = S.current!;
      const g = propsRef.current.gizmo;
      if (!g) return [];
      if (g.targets.includes("__body__")) return [s.model, s.hilite];
      const set = new Set(g.targets);
      return s.asmGroup.children.filter((o) => set.has(o.userData.id) || set.has(o.userData.topId));
    }

    // ---------- výběr ----------
    const ray = new THREE.Raycaster();
    const ndc = new THREE.Vector2();
    let downAt: [number, number, number] | null = null;
    const setRay = (e: PointerEvent | MouseEvent) => {
      const s = S.current!;
      const rect = renderer.domElement.getBoundingClientRect();
      ndc.set(((e.clientX - rect.left) / rect.width) * 2 - 1, -((e.clientY - rect.top) / rect.height) * 2 + 1);
      ray.setFromCamera(ndc, s.camera);
      ray.params.Line = { threshold: (s.radius / 140) * (s.camera === s.orthoCam ? 1 / s.orthoCam.zoom : 1) };
    };
    const clipOk = (p: THREE.Vector3) => !propsRef.current.section || S.current!.clip.distanceToPoint(p) >= -1e-6;
    const isAsm = () => !!propsRef.current.assembly?.length;
    const meshTargets = (): THREE.Mesh[] => {
      const s = S.current!;
      if (isAsm()) return s.asmGroup.children.filter((o) => (o as THREE.Mesh).isMesh && o.visible) as THREE.Mesh[];
      return s.mesh && !propsRef.current.bodyHidden ? [s.mesh] : [];
    };
    const edgeTargets = (): THREE.LineSegments[] => {
      const s = S.current!;
      if (isAsm()) return s.asmGroup.children.filter((o) => (o as THREE.LineSegments).isLineSegments && o.visible) as THREE.LineSegments[];
      return s.edges && !propsRef.current.bodyHidden ? [s.edges] : [];
    };
    const hitMesh = (e: PointerEvent | MouseEvent) => {
      setRay(e);
      return ray.intersectObjects(meshTargets(), false).find((h) => clipOk(h.point)) ?? null;
    };
    const ids = (o: THREE.Object3D) => (isAsm() ? { compId: o.userData.id as string, topId: o.userData.topId as string } : {});
    const toScreen = (p: THREE.Vector3) => {
      const s = S.current!;
      const rect = renderer.domElement.getBoundingClientRect();
      const q = p.clone().project(s.camera);
      return [((q.x + 1) / 2) * rect.width + rect.left, ((1 - q.y) / 2) * rect.height + rect.top];
    };
    /** nejbližší topologický vrchol do 10 px, který není zakrytý */
    const pickVertex = (e: PointerEvent | MouseEvent, meshHit: THREE.Intersection | null): SelItem | null => {
      const s = S.current!;
      const camPos = s.camera.position;
      const maxD = meshHit ? meshHit.distance + s.radius * 0.02 : Infinity;
      let best: { d: number; item: SelItem } | null = null;
      const test = (verts: Float32Array | null | undefined, mtx: THREE.Matrix4 | null, extra: object) => {
        if (!verts) return;
        const v = new THREE.Vector3();
        for (let i = 0; i < verts.length / 3; i++) {
          v.set(verts[i * 3], verts[i * 3 + 1], verts[i * 3 + 2]);
          if (mtx) v.applyMatrix4(mtx);
          if (!clipOk(v)) continue;
          if (v.distanceTo(camPos) > maxD && s.camera === s.persp) continue;
          const [sx, sy] = toScreen(v);
          const d = Math.hypot(sx - e.clientX, sy - e.clientY);
          if (d < 10 && (!best || d < best.d)) best = { d, item: { kind: "vertex", index: i, point: [v.x, v.y, v.z], ...extra } as SelItem };
        }
      };
      if (isAsm()) {
        for (const o of meshTargets()) {
          const av = propsRef.current.assembly?.find((a) => a.id === o.userData.id);
          test(av?.vertices, o.matrix, ids(o));
        }
      } else test(propsRef.current.vertices, null, {});
      return (best as { d: number; item: SelItem } | null)?.item ?? null;
    };
    /** lomená čára hrany ve světových souřadnicích (úseky hrany jdou v bufferu za sebou) */
    const edgePoints = (obj: THREE.LineSegments, idx: number): THREE.Vector3[] => {
      const edgeOf = obj.geometry.userData.edgeOf as Int32Array | undefined;
      const pos = obj.geometry.getAttribute("position") as THREE.BufferAttribute | undefined;
      if (!edgeOf || !pos) return [];
      const pts: THREE.Vector3[] = [];
      for (let seg = 0; seg < edgeOf.length; seg++) {
        if (edgeOf[seg] !== idx) continue;
        if (!pts.length) pts.push(new THREE.Vector3().fromBufferAttribute(pos, seg * 2));
        pts.push(new THREE.Vector3().fromBufferAttribute(pos, seg * 2 + 1));
      }
      obj.updateMatrixWorld();
      return pts.map((p) => p.applyMatrix4(obj.matrixWorld));
    };
    /** střed kružnice třemi body (nebo null, nejsou-li body na kružnici) */
    const circleOf = (pts: THREE.Vector3[]): { c: THREE.Vector3; r: number } | null => {
      if (pts.length < 4) return null;
      const A = pts[0];
      const B = pts[Math.floor(pts.length / 3)];
      const C = pts[Math.floor((2 * pts.length) / 3)];
      const a = A.clone().sub(C);
      const b = B.clone().sub(C);
      const axb = a.clone().cross(b);
      const den = 2 * axb.lengthSq();
      if (den < 1e-12) return null;
      const num = b.clone().multiplyScalar(a.lengthSq()).sub(a.clone().multiplyScalar(b.lengthSq())).cross(axb);
      const c = C.clone().add(num.divideScalar(den));
      const r = c.distanceTo(A);
      if (!(r > 1e-6)) return null;
      const tol = r * 0.02 + 1e-6;
      return pts.every((p) => Math.abs(p.distanceTo(c) - r) <= tol) ? { c, r } : null;
    };
    /** body k uchopení na hraně: začátek, konec, střed délky, střed kružnice/oblouku */
    const snapCandidates = (obj: THREE.LineSegments, idx: number, extra: object): SnapCand[] => {
      const pts = edgePoints(obj, idx);
      if (pts.length < 2) return [];
      const mk = (at: "start" | "end" | "mid" | "center", p: THREE.Vector3): SnapCand => ({ item: { kind: "edge", index: idx, at, point: [p.x, p.y, p.z], ...extra } as SelItem, p });
      const out: SnapCand[] = [];
      const a = pts[0];
      const b = pts[pts.length - 1];
      const closed = a.distanceTo(b) < 1e-6;
      if (!closed) out.push(mk("start", a), mk("end", b));
      const cum = [0];
      for (let i = 1; i < pts.length; i++) cum.push(cum[i - 1] + pts[i].distanceTo(pts[i - 1]));
      const half = cum[cum.length - 1] / 2;
      for (let i = 1; i < pts.length; i++) {
        if (cum[i] >= half) {
          const t = cum[i] - cum[i - 1] > 1e-9 ? (half - cum[i - 1]) / (cum[i] - cum[i - 1]) : 0;
          out.push(mk("mid", pts[i - 1].clone().lerp(pts[i], t)));
          break;
        }
      }
      const circ = circleOf(pts);
      if (circ) out.push(mk("center", circ.c));
      return out;
    };
    const drawSnaps = () => {
      const s = S.current!;
      for (const o of [...s.snapGroup.children]) {
        s.snapGroup.remove(o);
        (o as THREE.Mesh).geometry?.dispose();
        ((o as THREE.Mesh).material as THREE.Material | undefined)?.dispose?.();
      }
      if (propsRef.current.snapPoints) {
        const active = s.hoverItem && s.hoverItem.kind === "edge" && s.hoverItem.at ? s.hoverItem : null;
        for (const c of s.snapCands) {
          const isActive = !!active && sameSel(active, c.item);
          const at = (c.item as { at?: string }).at;
          const geo = at === "center" ? new THREE.OctahedronGeometry(s.radius / (isActive ? 70 : 110)) : new THREE.SphereGeometry(s.radius / (isActive ? 90 : 150), 12, 8);
          const dot = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ color: isActive ? 0xe03930 : 0x0284c7, depthTest: false, transparent: true, opacity: isActive ? 1 : 0.85 }));
          dot.position.copy(c.p);
          dot.renderOrder = 9;
          s.snapGroup.add(dot);
        }
      }
      s.render();
    };
    /** nejbližší kandidát uchopení do 12 px od kurzoru */
    const pickSnap = (e: PointerEvent | MouseEvent): SelItem | null => {
      const s = S.current!;
      if (!propsRef.current.snapPoints || !s.snapCands.length) return null;
      let best: { d: number; item: SelItem } | null = null;
      for (const c of s.snapCands) {
        if (!clipOk(c.p)) continue;
        const [sx, sy] = toScreen(c.p);
        const d = Math.hypot(sx - e.clientX, sy - e.clientY);
        if (d < 12 && (!best || d < best.d)) best = { d, item: c.item };
      }
      return best?.item ?? null;
    };
    const pickEdge = (e: PointerEvent | MouseEvent, meshHit: THREE.Intersection | null): SelItem | null => {
      const s = S.current!;
      setRay(e);
      const tol = s.radius * 0.01;
      const hit = ray.intersectObjects(edgeTargets(), false).find((h) => clipOk(h.point) && (!meshHit || h.distance <= meshHit.distance + tol));
      if (!hit || hit.index == null) return null;
      const edgeOf = (hit.object as THREE.LineSegments).geometry.userData.edgeOf as Int32Array | undefined;
      const idx = edgeOf?.[Math.floor(hit.index / 2)] ?? -1;
      if (idx < 0) return null;
      const extra = ids(hit.object);
      if (propsRef.current.snapPoints) {
        const cur = s.snapCands[0]?.item;
        if (!cur || cur.kind !== "edge" || cur.index !== idx || (cur.compId ?? "") !== ((extra as { compId?: string }).compId ?? "")) s.snapCands = snapCandidates(hit.object as THREE.LineSegments, idx, extra);
      }
      return { kind: "edge", index: idx, point: [hit.point.x, hit.point.y, hit.point.z], ...extra };
    };
    /** výběr podle filtru */
    const pickSel = (e: PointerEvent | MouseEvent, filterOverride?: SelFilter): SelItem | null => {
      const filter = filterOverride ?? propsRef.current.selFilter ?? "all";
      if (filter === "all" || filter === "vertex" || filter === "edge") {
        const snap = pickSnap(e);
        if (snap) return snap;
      }
      const h = hitMesh(e);
      const pt = h ? ([h.point.x, h.point.y, h.point.z] as Vec3) : undefined;
      const faceIdx = h && h.faceIndex != null ? ((h.object as THREE.Mesh).geometry.userData.faceOf as Int32Array | undefined)?.[h.faceIndex] ?? -1 : -1;
      switch (filter) {
        case "vertex":
          return pickVertex(e, h);
        case "edge":
          return pickEdge(e, h);
        case "face":
          return h && faceIdx >= 0 ? { kind: "face", index: faceIdx, point: pt, ...ids(h.object) } : null;
        case "body":
          return h ? { kind: "body", point: pt, ...ids(h.object) } : null;
        case "component":
          return h && isAsm() ? { kind: "component", compId: h.object.userData.id, topId: h.object.userData.topId, point: pt } : h ? { kind: "body", point: pt } : null;
        case "subasm":
          return h && isAsm() ? { kind: "component", compId: h.object.userData.topId ?? h.object.userData.id, topId: h.object.userData.topId, point: pt } : h ? { kind: "body", point: pt } : null;
        case "feature":
          return h ? { kind: "body", point: pt, ...ids(h.object) } : null;
        default: {
          const v = pickVertex(e, h);
          if (v) return v;
          const ed = pickEdge(e, h);
          if (ed) return ed;
          return h && faceIdx >= 0 ? { kind: "face", index: faceIdx, point: pt, ...ids(h.object) } : null;
        }
      }
    };
    const legacyPick = (e: PointerEvent) => {
      const s = S.current!;
      setRay(e);
      const mode = propsRef.current.pickMode;
      let face = -1;
      let edge = -1;
      let point: [number, number, number] | undefined;
      if (mode === "edges" && s.edges) {
        const hit = ray.intersectObject(s.edges, false).find((h) => clipOk(h.point));
        if (hit && hit.index != null && s.partGeo) edge = s.partGeo.edgeOf[Math.floor(hit.index / 2)];
      }
      if ((mode === "faces" || mode === "face-plane") && s.mesh) {
        const hit = ray.intersectObject(s.mesh, false).find((h) => clipOk(h.point));
        if (hit && hit.faceIndex != null && s.partGeo) {
          face = s.partGeo.faceOf[hit.faceIndex];
          point = [hit.point.x, hit.point.y, hit.point.z];
        }
      }
      return { face, edge, point };
    };
    const isLegacy = () => ["edges", "faces", "face-plane"].includes(propsRef.current.pickMode);
    const effFilter = (): SelFilter | undefined => (propsRef.current.pickMode === "asmFace" ? "face" : undefined);
    const onMove = (e: PointerEvent) => {
      const s = S.current!;
      if (propsRef.current.onCursor && !e.buttons) {
        const h = hitMesh(e);
        propsRef.current.onCursor(h ? [round3(h.point.x), round3(h.point.y), round3(h.point.z)] : null);
      }
      if (e.buttons || s.tc.dragging) return;
      if (isLegacy()) {
        const { face, edge } = legacyPick(e);
        if (face !== s.hoverFace || edge !== s.hoverEdge) {
          s.hoverFace = face;
          s.hoverEdge = edge;
          renderer.domElement.style.cursor = face >= 0 || edge >= 0 ? "pointer" : "";
          paint();
        }
        return;
      }
      if (propsRef.current.pickMode === "none") return;
      const it = pickSel(e, effFilter());
      const same = (!it && !s.hoverItem) || (it && s.hoverItem && sameSel(it, s.hoverItem));
      if (!same) {
        s.hoverItem = it;
        renderer.domElement.style.cursor = it ? "pointer" : "";
        drawHilite();
      }
      if (propsRef.current.snapPoints) drawSnaps();
      else if (s.snapGroup.children.length) {
        s.snapCands = [];
        drawSnaps();
      }
    };
    // dlouhý stisk prstem = kontextová nabídka (pravé tlačítko) na dotykových zařízeních
    let longPress: ReturnType<typeof setTimeout> | null = null;
    let swallowTouchEnd = false; // po dlouhém stisku potlačit náhradní mouse/click události (zavřely by nabídku)
    const cancelLongPress = () => {
      if (longPress) clearTimeout(longPress);
      longPress = null;
    };
    const onTouchEnd = (e: TouchEvent) => {
      if (swallowTouchEnd) {
        swallowTouchEnd = false;
        e.preventDefault();
      }
    };
    const onDown = (e: PointerEvent) => {
      downAt = [e.clientX, e.clientY, e.button];
      cancelLongPress();
      if (e.pointerType === "touch" && propsRef.current.pickMode !== "none") {
        longPress = setTimeout(() => {
          longPress = null;
          downAt = null;
          swallowTouchEnd = true;
          const it = pickSel(e, effFilter());
          propsRef.current.onContext?.(e.clientX, e.clientY, it);
        }, 550);
      }
    };
    const onMoveCancel = (e: PointerEvent) => {
      if (longPress && downAt && Math.hypot(e.clientX - downAt[0], e.clientY - downAt[1]) > 8) cancelLongPress();
    };
    const onUp = (e: PointerEvent) => {
      const s = S.current!;
      cancelLongPress();
      if (!downAt || Math.hypot(e.clientX - downAt[0], e.clientY - downAt[1]) > 4 || e.button !== downAt[2] || s.tc.dragging) {
        downAt = null;
        return;
      }
      downAt = null;
      if (e.button === 2) {
        const it = pickSel(e, effFilter());
        propsRef.current.onContext?.(e.clientX, e.clientY, it);
        return;
      }
      if (e.button !== 0) return;
      if (isLegacy()) {
        const { face, edge, point } = legacyPick(e);
        if (edge >= 0) propsRef.current.onPickEdge?.(edge);
        if (face >= 0) propsRef.current.onPickFace?.(face, point);
        return;
      }
      if (propsRef.current.pickMode === "none") return;
      propsRef.current.onPick?.(pickSel(e, effFilter()), e.ctrlKey || e.shiftKey || e.metaKey);
    };
    const onCtx = (e: MouseEvent) => e.preventDefault();
    const onLeave = () => {
      propsRef.current.onCursor?.(null);
      const s = S.current!;
      if (s.hoverItem) {
        s.hoverItem = null;
        drawHilite();
      }
    };
    renderer.domElement.addEventListener("pointermove", onMove);
    renderer.domElement.addEventListener("pointermove", onMoveCancel, { passive: true });
    renderer.domElement.addEventListener("pointercancel", cancelLongPress);
    renderer.domElement.addEventListener("touchend", onTouchEnd, { passive: false });
    renderer.domElement.addEventListener("pointerdown", onDown);
    renderer.domElement.addEventListener("pointerup", onUp);
    renderer.domElement.addEventListener("pointerleave", onLeave);
    renderer.domElement.addEventListener("contextmenu", onCtx);

    return () => {
      cancelAnimationFrame(raf);
      renderer.domElement.removeEventListener("webglcontextlost", onLost);
      ro.disconnect();
      controls.dispose();
      tc.dispose();
      renderer.domElement.removeEventListener("pointermove", onMove);
      renderer.domElement.removeEventListener("pointermove", onMoveCancel);
      renderer.domElement.removeEventListener("pointercancel", cancelLongPress);
      renderer.domElement.removeEventListener("touchend", onTouchEnd);
      renderer.domElement.removeEventListener("pointerdown", onDown);
      renderer.domElement.removeEventListener("pointerup", onUp);
      renderer.domElement.removeEventListener("pointerleave", onLeave);
      renderer.domElement.removeEventListener("contextmenu", onCtx);
      scene.traverse((o) => {
        (o as THREE.Mesh).geometry?.dispose?.();
      });
      pmrem.dispose();
      renderer.dispose();
      renderer.domElement.remove();
      S.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function updateOrthoFrustum() {
    const s = S.current;
    if (!s) return;
    const el = host.current!;
    const aspect = el.clientWidth / Math.max(1, el.clientHeight);
    const dist = s.persp.position.distanceTo(s.controls.target);
    const h = 2 * dist * Math.tan((s.persp.fov * Math.PI) / 360);
    s.orthoCam.left = (-h * aspect) / 2;
    s.orthoCam.right = (h * aspect) / 2;
    s.orthoCam.top = h / 2;
    s.orthoCam.bottom = -h / 2;
    s.orthoCam.updateProjectionMatrix();
  }

  function applyMouse() {
    const s = S.current;
    if (!s) return;
    const scheme = propsRef.current.mouse ?? "zw3d";
    const NONE = -1 as unknown as THREE.MOUSE;
    s.controls.mouseButtons =
      scheme === "zw3d"
        ? { LEFT: NONE, MIDDLE: THREE.MOUSE.PAN, RIGHT: THREE.MOUSE.ROTATE }
        : scheme === "solidworks"
          ? { LEFT: NONE, MIDDLE: THREE.MOUSE.ROTATE, RIGHT: THREE.MOUSE.PAN }
          : { LEFT: THREE.MOUSE.ROTATE, MIDDLE: THREE.MOUSE.PAN, RIGHT: THREE.MOUSE.PAN };
  }
  useEffect(applyMouse, [props.mouse]);

  // perspektiva / pravoúhlé promítání
  useEffect(() => {
    const s = S.current;
    if (!s) return;
    const wantOrtho = !!props.ortho;
    if (wantOrtho === (s.camera === s.orthoCam)) return;
    if (wantOrtho) {
      updateOrthoFrustum();
      s.orthoCam.position.copy(s.persp.position);
      s.orthoCam.quaternion.copy(s.persp.quaternion);
      s.orthoCam.zoom = 1;
      s.orthoCam.updateProjectionMatrix();
      s.camera = s.orthoCam;
    } else {
      const dist = s.persp.position.distanceTo(s.controls.target) / s.orthoCam.zoom;
      const dir = s.orthoCam.position.clone().sub(s.controls.target).normalize();
      s.persp.position.copy(s.controls.target).addScaledVector(dir, dist);
      s.camera = s.persp;
    }
    s.controls.object = s.camera;
    s.tc.camera = s.camera;
    s.controls.update();
    s.render();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [props.ortho]);

  function buildGrid(radius: number) {
    const s = S.current;
    if (!s) return;
    const axes = s.grid.children.find((c) => c.type === "Group");
    s.grid.clear();
    if (axes) s.grid.add(axes);
    const step = niceStep(radius / 6);
    const size = step * 24;
    const minor = new THREE.GridHelper(size, 24 * 5, 0xb9c3cd, 0xc9d1d9);
    const major = new THREE.GridHelper(size, 24, 0x9aa6b2, 0x9aa6b2);
    for (const g of [minor, major]) {
      g.rotation.x = Math.PI / 2;
      (g.material as THREE.Material).transparent = true;
      (g.material as THREE.Material).opacity = g === minor ? 0.35 : 0.55;
      (g.material as THREE.Material).depthWrite = false;
      s.grid.add(g);
    }
  }

  /** materiály dílu: [základ, hover, výběr, …barvy ploch] */
  function materials(colors: string[]) {
    const p = propsRef.current;
    const display = p.display ?? "shadedEdges";
    const base = new THREE.Color(p.bodyColor ?? "#b9c2cc");
    const clipping = p.section && S.current ? [S.current.clip] : [];
    const opacity = p.bodyOpacity ?? 1;
    const mk = (c: THREE.Color, isBase = false) => {
      if (display === "hiddenLine") return new THREE.MeshBasicMaterial({ color: isBase ? new THREE.Color(0xffffff) : c, polygonOffset: true, polygonOffsetFactor: 1, polygonOffsetUnits: 1, side: THREE.DoubleSide, clippingPlanes: clipping });
      const m = new THREE.MeshStandardMaterial({ color: c, metalness: 0.45, roughness: 0.42, envMapIntensity: 0.95, polygonOffset: true, polygonOffsetFactor: 1, polygonOffsetUnits: 1, side: THREE.FrontSide, clippingPlanes: clipping });
      if (display === "xray" || opacity < 1) {
        m.transparent = true;
        m.opacity = display === "xray" ? Math.min(0.28, opacity) : opacity;
        m.depthWrite = false;
        m.side = THREE.DoubleSide;
      }
      if (display === "wireframe") m.visible = false;
      return m;
    };
    return [mk(base, true), mk(HOVER), mk(SEL), ...colors.map((c) => mk(new THREE.Color(c)))];
  }

  /** skupiny materiálů dílu (výběr ve formuláři prvku, barvy ploch) a zvýraznění hran formuláře */
  function paint() {
    const s = S.current;
    if (!s?.mesh) return s?.render();
    const { selectedFaces, selectedEdges, pickMode, faceColors } = propsRef.current;
    const colorIdx = s.mesh.userData.colorIdx as Map<string, number> | undefined;
    const geo = s.mesh.geometry;
    const legacy = ["edges", "faces", "face-plane"].includes(pickMode);
    for (const g of geo.groups) {
      const fi = (g as THREE.GeometryGroup & { face: number }).face;
      const fc = faceColors?.[fi];
      g.materialIndex = selectedFaces.includes(fi) ? 2 : legacy && fi === s.hoverFace && pickMode !== "edges" ? 1 : fc && colorIdx?.has(fc) ? colorIdx.get(fc)! : 0;
    }
    if (s.edgeHi) {
      s.model.remove(s.edgeHi);
      s.edgeHi.geometry.dispose();
      s.edgeHi = undefined;
    }
    const want = new Set(selectedEdges);
    if (legacy && s.hoverEdge >= 0) want.add(s.hoverEdge);
    if (want.size && s.edges && s.partGeo) {
      const src = s.edges.geometry.getAttribute("position").array as Float32Array;
      const pts: number[] = [];
      for (let seg = 0; seg < s.partGeo.edgeOf.length; seg++) if (want.has(s.partGeo.edgeOf[seg])) pts.push(...src.slice(seg * 6, seg * 6 + 6));
      const g = new THREE.BufferGeometry();
      g.setAttribute("position", new THREE.Float32BufferAttribute(pts, 3));
      s.edgeHi = new THREE.LineSegments(g, new THREE.LineBasicMaterial({ color: selectedEdges.length ? 0xe03930 : 0xf59e0b, depthTest: false, transparent: true }));
      s.edgeHi.renderOrder = 5;
      s.model.add(s.edgeHi);
    }
    s.render();
  }

  /** zvýraznění vybraných a najetých entit (překryvné vrstvy) */
  function drawHilite() {
    const s = S.current;
    if (!s) return;
    for (const o of [...s.hilite.children]) {
      s.hilite.remove(o);
      const mesh = o as THREE.Mesh;
      if (mesh.geometry && !mesh.userData.shared) mesh.geometry.dispose();
      (mesh.material as THREE.Material | undefined)?.dispose?.();
    }
    const items: [SelItem, number][] = [...(propsRef.current.selection ?? []).map((x) => [x, SEL_HEX] as [SelItem, number])];
    if (s.hoverItem && !(propsRef.current.selection ?? []).some((x) => sameSel(x, s.hoverItem!))) items.push([s.hoverItem, HOVER_HEX]);
    const asm = !!propsRef.current.assembly?.length;
    const clipping = propsRef.current.section ? [s.clip] : [];
    // emise komponent / těles
    const emiss = new Map<string, number>();
    let bodyEm: number | null = null;
    for (const [it, col] of items) {
      if (it.kind === "component") emiss.set(it.compId, col);
      else if (it.kind === "body") {
        if (asm && it.compId) emiss.set(it.compId, col);
        else bodyEm = col;
      }
    }
    const emCol = (c: number) => (c === SEL_HEX ? 0x5a0d08 : 0x6a4500);
    if (asm) {
      for (const o of s.asmGroup.children) {
        const mt = (o as THREE.Mesh).material as THREE.MeshStandardMaterial | undefined;
        if (!(o as THREE.Mesh).isMesh || !mt?.emissive) continue;
        const c = emiss.get(o.userData.id) ?? emiss.get(o.userData.topId);
        mt.emissive.set(c != null ? emCol(c) : o.userData.selected ? 0x5a0d08 : 0x000000);
      }
    } else if (s.mesh) {
      for (const mt of s.mesh.material as THREE.Material[]) (mt as THREE.MeshStandardMaterial).emissive?.set(bodyEm != null ? emCol(bodyEm) : 0x000000);
    }
    // plochy, hrany, body
    const findObj = (compId?: string) => {
      if (!asm) return s.mesh ? { mesh: s.mesh, edges: s.edges ?? null, gi: s.partGeo ?? null, mtx: null as THREE.Matrix4 | null } : null;
      const m = s.asmGroup.children.find((o) => (o as THREE.Mesh).isMesh && o.userData.id === compId) as THREE.Mesh | undefined;
      if (!m) return null;
      const gi = s.asmGeo.get(m.userData.key as string) ?? null;
      return { mesh: m, edges: null, gi, mtx: m.matrix };
    };
    for (const [it, col] of items) {
      if (it.kind === "face") {
        const o = findObj(it.compId);
        if (!o?.gi) continue;
        const idx: number[] = [];
        const tri = o.gi.mesh.triangles;
        for (let t = 0; t < o.gi.faceOf.length; t++) if (o.gi.faceOf[t] === it.index) idx.push(tri[t * 3], tri[t * 3 + 1], tri[t * 3 + 2]);
        const g = new THREE.BufferGeometry();
        g.setAttribute("position", o.gi.geo.getAttribute("position"));
        g.setAttribute("normal", o.gi.geo.getAttribute("normal"));
        g.setIndex(idx);
        const m = new THREE.Mesh(g, new THREE.MeshBasicMaterial({ color: col, transparent: true, opacity: 0.55, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2, clippingPlanes: clipping, side: THREE.DoubleSide }));
        if (o.mtx) {
          m.matrixAutoUpdate = false;
          m.matrix.copy(o.mtx);
        }
        m.renderOrder = 6;
        s.hilite.add(m);
      } else if (it.kind === "edge") {
        const o = findObj(it.compId);
        if (!o?.gi) continue;
        const src = o.gi.mesh.lines;
        const pts: number[] = [];
        for (let seg = 0; seg < o.gi.edgeOf.length; seg++) if (o.gi.edgeOf[seg] === it.index) pts.push(...src.slice(seg * 6, seg * 6 + 6));
        const g = new THREE.BufferGeometry();
        g.setAttribute("position", new THREE.Float32BufferAttribute(pts, 3));
        const l = new THREE.LineSegments(g, new THREE.LineBasicMaterial({ color: col, depthTest: false, transparent: true, clippingPlanes: clipping }));
        if (o.mtx) {
          l.matrixAutoUpdate = false;
          l.matrix.copy(o.mtx);
        }
        l.renderOrder = 7;
        s.hilite.add(l);
        // zesílení: druhá vrstva s mírným posunem není v WebGL možná → přidáme body na koncích
      } else if (it.kind === "vertex") {
        const dot = new THREE.Mesh(new THREE.SphereGeometry(s.radius / 120, 16, 12), new THREE.MeshBasicMaterial({ color: col, depthTest: false, transparent: true }));
        dot.position.set(...it.point);
        dot.renderOrder = 8;
        s.hilite.add(dot);
      }
    }
    s.render();
  }

  function applyClip() {
    const s = S.current;
    if (!s) return;
    const sec = propsRef.current.section;
    if (sec) {
      // ponechá se strana, kam míří normála; osová i obecná rovina (z plochy, z vektoru) se počítá v section-plane.ts
      const pl = sectionPlane(sec);
      s.clip.set(new THREE.Vector3(...pl.normal), pl.constant);
    }
  }

  // ---------- model dílu ----------
  const firstFit = useRef(true);
  const fcKey = JSON.stringify(props.faceColors ?? {});
  useEffect(() => {
    const s = S.current;
    if (!s) return;
    for (const o of [...s.model.children]) {
      s.model.remove(o);
      const g = (o as THREE.Mesh).geometry;
      if (g && g !== s.partGeo?.geo && g !== s.partGeo?.edges) g.dispose();
    }
    s.mesh = undefined;
    s.cap = undefined;
    s.edges = undefined;
    s.edgeHi = undefined;
    s.model.matrix.identity();
    s.hilite.matrix.identity();
    const m = props.mesh;
    const display = props.display ?? "shadedEdges";
    applyClip();
    if (m && m.triangles.length) {
      if (!s.partGeo || s.partGeo.mesh !== m) {
        s.partGeo?.geo.dispose();
        s.partGeo?.edges.dispose();
        s.partGeo = geoInfo(m);
        uploadMark = { t0: performance.now(), tris: m.triangles.length / 3, kind: "part" };
      }
      const gi = s.partGeo;
      const colors = [...new Set(Object.values(props.faceColors ?? {}))];
      const vc = props.vertexColors && props.vertexColors.length === m.vertices.length ? props.vertexColors : null;
      if (vc) gi.geo.setAttribute("color", new THREE.BufferAttribute(vc, 3));
      else if (gi.geo.getAttribute("color")) gi.geo.deleteAttribute("color");
      const mats = props.surface === "zebra"
        ? (() => {
            const zm = new THREE.MeshMatcapMaterial({ matcap: zebraTexture(), polygonOffset: true, polygonOffsetFactor: 1, polygonOffsetUnits: 1, clippingPlanes: props.section ? [s.clip] : [] });
            return new Array(3 + colors.length).fill(zm) as THREE.Material[];
          })()
        : vc
        ? (() => {
            const vm = new THREE.MeshStandardMaterial({ vertexColors: true, color: 0xffffff, metalness: 0.08, roughness: 0.62, polygonOffset: true, polygonOffsetFactor: 1, polygonOffsetUnits: 1, clippingPlanes: props.section ? [s.clip] : [] });
            return new Array(3 + colors.length).fill(vm) as THREE.Material[];
          })()
        : materials(colors);
      const mesh = new THREE.Mesh(gi.geo, mats);
      mesh.userData.colorIdx = new Map(colors.map((c, i) => [c, i + 3]));
      mesh.visible = !props.bodyHidden;
      s.model.add(mesh);
      s.mesh = mesh;
      if (props.section && display !== "wireframe") {
        const cap = new THREE.Mesh(gi.geo, new THREE.MeshBasicMaterial({ color: 0xe8706a, side: THREE.BackSide, clippingPlanes: [s.clip] }));
        cap.visible = !props.bodyHidden;
        s.model.add(cap);
        s.cap = cap;
      }
      const edgeColor = display === "hiddenLine" || display === "wireframe" ? 0x1f2933 : 0x1b2430;
      const edges = new THREE.LineSegments(
        gi.edges,
        new THREE.LineBasicMaterial({ color: edgeColor, transparent: true, opacity: display === "shaded" ? 0 : 0.9, clippingPlanes: props.section ? [s.clip] : [], depthTest: display !== "wireframe" }),
      );
      edges.visible = display !== "shaded" && !props.bodyHidden;
      s.model.add(edges);
      s.edges = edges;

      const bs = gi.geo.boundingSphere!;
      const changed = Math.abs(bs.radius - s.radius) / s.radius > 0.6 || movedAway(bs.center, bs.radius, s.center, s.radius);
      s.radius = bs.radius || 100;
      s.center.copy(bs.center);
      if (firstFit.current || changed) {
        firstFit.current = false;
        buildGrid(s.radius);
        fitTo("iso");
      }
    }
    paint();
    drawHilite();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [props.mesh, props.display, props.bodyColor, !!props.section, fcKey, props.bodyOpacity, props.bodyHidden, props.vertexColors, props.surface]);

  useEffect(() => {
    applyClip();
    S.current?.render();
  }, [sectionKey(props.section)]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const s = S.current;
    if (!s) return;
    s.grid.visible = props.showGrid !== false;
    s.render();
  }, [props.showGrid]);

  // ---------- skici a roviny ----------
  useEffect(() => {
    const s = S.current;
    if (!s) return;
    for (const o of [...s.sketchGroup.children]) {
      s.sketchGroup.remove(o);
      (o as THREE.Line).geometry?.dispose();
    }
    for (const sk of props.sketches) {
      for (const e of sk.entities) {
        const { pts, closed } = entityPath(e);
        if (pts.length < 2) continue;
        const w = pts.map((p) => new THREE.Vector3(...toWorld(sk.plane, p)));
        if (closed) w.push(w[0]);
        const mat = e.construction
          ? new THREE.LineDashedMaterial({ color: 0x2563eb, dashSize: 2, gapSize: 1.5, transparent: true, opacity: 0.6, depthTest: false })
          : new THREE.LineBasicMaterial({ color: 0x2563eb, transparent: true, opacity: 0.95, depthTest: false });
        const line = new THREE.Line(new THREE.BufferGeometry().setFromPoints(w), mat);
        if (e.construction) line.computeLineDistances();
        line.renderOrder = 4;
        s.sketchGroup.add(line);
      }
    }
    for (const d of props.datums ?? []) {
      const n = new THREE.Vector3(...d.normal).normalize();
      const x = new THREE.Vector3(...d.xDir).normalize();
      const y = new THREE.Vector3().crossVectors(n, x);
      const o = new THREE.Vector3(...d.origin);
      const h = d.size / 2;
      const corners = [
        [-h, -h],
        [h, -h],
        [h, h],
        [-h, h],
      ].map(([a, b]) => o.clone().addScaledVector(x, a).addScaledVector(y, b));
      const g = new THREE.BufferGeometry().setFromPoints([corners[0], corners[1], corners[2], corners[0], corners[2], corners[3]]);
      const quad = new THREE.Mesh(g, new THREE.MeshBasicMaterial({ color: 0x7c3aed, transparent: true, opacity: 0.12, side: THREE.DoubleSide, depthWrite: false }));
      const border = new THREE.LineLoop(new THREE.BufferGeometry().setFromPoints(corners), new THREE.LineBasicMaterial({ color: 0x7c3aed }));
      s.sketchGroup.add(quad, border);
    }
    for (const g of props.datumGfx ?? []) {
      if (g.kind === "axis") {
        const o = new THREE.Vector3(...g.origin);
        const d = new THREE.Vector3(...g.dir).normalize();
        const h = (g.length || 100) / 2;
        const line = new THREE.Line(new THREE.BufferGeometry().setFromPoints([o.clone().addScaledVector(d, -h), o.clone().addScaledVector(d, h)]), new THREE.LineDashedMaterial({ color: 0xea580c, dashSize: 4, gapSize: 2, depthTest: false }));
        line.computeLineDistances();
        line.renderOrder = 5;
        s.sketchGroup.add(line);
      } else if (g.kind === "point") {
        const o = new THREE.Vector3(...g.p);
        const r = Math.max(0.6, s.radius * 0.012);
        const pts: THREE.Vector3[] = [];
        for (const ax of [new THREE.Vector3(1, 0, 0), new THREE.Vector3(0, 1, 0), new THREE.Vector3(0, 0, 1)]) pts.push(o.clone().addScaledVector(ax, -r), o.clone().addScaledVector(ax, r));
        const cross = new THREE.LineSegments(new THREE.BufferGeometry().setFromPoints(pts), new THREE.LineBasicMaterial({ color: 0xea580c, depthTest: false }));
        cross.renderOrder = 5;
        const dot = new THREE.Mesh(new THREE.SphereGeometry(r * 0.35, 12, 8), new THREE.MeshBasicMaterial({ color: 0xea580c, depthTest: false }));
        dot.position.copy(o);
        dot.renderOrder = 5;
        s.sketchGroup.add(cross, dot);
      } else {
        const o = new THREE.Vector3(...g.origin);
        const L = g.size || 50;
        const axes: [Vec3, number][] = [
          [g.x, 0xdc2626],
          [g.y, 0x16a34a],
          [g.z, 0x2563eb],
        ];
        for (const [v, color] of axes) {
          const d = new THREE.Vector3(...v).normalize();
          const line = new THREE.Line(new THREE.BufferGeometry().setFromPoints([o, o.clone().addScaledVector(d, L)]), new THREE.LineBasicMaterial({ color, depthTest: false }));
          line.renderOrder = 5;
          const cone = new THREE.Mesh(new THREE.ConeGeometry(L * 0.04, L * 0.12, 10), new THREE.MeshBasicMaterial({ color, depthTest: false }));
          cone.position.copy(o.clone().addScaledVector(d, L));
          cone.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), d);
          cone.renderOrder = 5;
          s.sketchGroup.add(line, cone);
        }
      }
    }
    if (!props.mesh && !props.assembly?.length && props.sketches.length) {
      const box = new THREE.Box3().setFromObject(s.sketchGroup);
      if (!box.isEmpty()) {
        const sp = box.getBoundingSphere(new THREE.Sphere());
        s.radius = Math.max(sp.radius, 20);
        s.center.copy(sp.center);
      }
    }
    s.render();
  }, [props.sketches, props.mesh, props.datums, props.datumGfx, props.assembly]);

  // ---------- kóty měření ----------
  useEffect(() => {
    const s = S.current;
    if (!s) return;
    for (const o of [...s.overlay.children]) {
      s.overlay.remove(o);
      (o as THREE.Mesh).geometry?.dispose();
    }
    const g = props.measure;
    const r = s.radius / 130;
    for (const p of g?.points ?? []) {
      const dot = new THREE.Mesh(new THREE.SphereGeometry(r, 16, 12), new THREE.MeshBasicMaterial({ color: 0xe03930, depthTest: false }));
      dot.position.set(...p);
      dot.renderOrder = 21;
      s.overlay.add(dot);
    }
    for (const [a, b] of g?.lines ?? []) {
      const line = new THREE.Line(new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(...a), new THREE.Vector3(...b)]), new THREE.LineDashedMaterial({ color: 0xe03930, dashSize: r * 3, gapSize: r * 1.5, depthTest: false }));
      line.computeLineDistances();
      line.renderOrder = 21;
      s.overlay.add(line);
    }
    s.render();
  }, [props.measure]);

  // ---------- průhledná pomocná tělesa (porovnání s referencí) ----------
  useEffect(() => {
    const s = S.current;
    if (!s) return;
    let grp = s.scene.getObjectByName("ghosts") as THREE.Group | undefined;
    if (!grp) {
      if (!props.ghosts?.length) return;
      grp = new THREE.Group();
      grp.name = "ghosts";
      s.scene.add(grp);
    }
    for (const o of [...grp.children] as THREE.Mesh[]) {
      grp.remove(o);
      o.geometry.dispose();
      (o.material as THREE.Material).dispose();
    }
    for (const g of props.ghosts ?? []) {
      const geo = new THREE.BufferGeometry();
      geo.setAttribute("position", new THREE.BufferAttribute(g.vertices, 3));
      geo.setIndex(new THREE.BufferAttribute(g.triangles, 1));
      if (g.normals && g.normals.length === g.vertices.length) geo.setAttribute("normal", new THREE.BufferAttribute(g.normals, 3));
      else geo.computeVertexNormals();
      const mesh = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ color: g.color, transparent: true, opacity: g.opacity, depthWrite: false, depthTest: !g.xray, side: THREE.DoubleSide, metalness: 0, roughness: 0.75 }));
      mesh.renderOrder = g.xray ? 20 : 5;
      mesh.userData.ghost = g.key;
      grp.add(mesh);
    }
    s.render();
  }, [props.ghosts]);

  useEffect(paint, [props.selectedEdges, props.selectedFaces, props.pickMode]); // eslint-disable-line react-hooks/exhaustive-deps
  const selKeyStr = (props.selection ?? []).map((x) => JSON.stringify(x)).join("|");
  useEffect(drawHilite, [selKeyStr, props.assembly]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    const s = S.current;
    if (!s) return;
    if (props.pickMode !== "select" && props.pickMode !== "component" && props.pickMode !== "asmFace" && props.pickMode !== "measure" && s.hoverItem) {
      s.hoverItem = null;
      drawHilite();
    }
  }, [props.pickMode]); // eslint-disable-line react-hooks/exhaustive-deps

  // ---------- sestava ----------
  useEffect(() => {
    const s = S.current;
    if (!s) return;
    const list = props.assembly ?? [];
    for (const o of [...s.asmGroup.children]) {
      s.asmGroup.remove(o);
      const mt = (o as THREE.Mesh).material as THREE.Material | undefined;
      mt?.dispose?.();
    }
    const used = new Set(list.map((c) => c.key));
    for (const [k, g] of s.asmGeo)
      if (!used.has(k)) {
        g.geo.dispose();
        g.edges.dispose();
        s.asmGeo.delete(k);
      }
    const display = props.display ?? "shadedEdges";
    const clipping = props.section ? [s.clip] : [];
    applyClip();
    for (const c of list) {
      let g = s.asmGeo.get(c.key);
      if (!g || g.mesh !== c.mesh) {
        if (g) {
          g.geo.dispose();
          g.edges.dispose();
        }
        g = geoInfo(c.mesh);
        s.asmGeo.set(c.key, g);
        uploadMark = { t0: uploadMark?.t0 ?? performance.now(), tris: (uploadMark?.tris ?? 0) + c.mesh.triangles.length / 3, kind: "asm" };
      }
      const mtx = new THREE.Matrix4().fromArray(c.matrix);
      const col = new THREE.Color(c.clash ? "#ff3b30" : c.color);
      const mat =
        display === "hiddenLine"
          ? new THREE.MeshBasicMaterial({ color: 0xffffff, polygonOffset: true, polygonOffsetFactor: 1, polygonOffsetUnits: 1, clippingPlanes: clipping })
          : new THREE.MeshStandardMaterial({ color: col, metalness: 0.4, roughness: 0.45, envMapIntensity: 0.9, polygonOffset: true, polygonOffsetFactor: 1, polygonOffsetUnits: 1, clippingPlanes: clipping });
      const op = c.dim ? 0.18 : display === "xray" ? 0.3 : (c.opacity ?? 1);
      if (op < 1) {
        mat.transparent = true;
        mat.opacity = op;
        mat.depthWrite = false;
      }
      if (display === "wireframe") mat.visible = false;
      mat.userData = { base: c.color };
      if (c.selected && "emissive" in mat) (mat as THREE.MeshStandardMaterial).emissive.set(0x5a0d08);
      const mesh = new THREE.Mesh(g.geo, mat);
      mesh.matrixAutoUpdate = false;
      mesh.matrix.copy(mtx);
      mesh.userData = { id: c.id, topId: c.topId ?? c.id, key: c.key, selected: c.selected };
      s.asmGroup.add(mesh);
      const e = new THREE.LineSegments(g.edges, new THREE.LineBasicMaterial({ color: c.selected ? 0xe03930 : 0x1b2430, transparent: true, opacity: display === "shaded" ? 0 : c.dim ? 0.25 : c.selected ? 1 : 0.75, clippingPlanes: clipping }));
      e.matrixAutoUpdate = false;
      e.matrix.copy(mtx);
      e.userData = { id: c.id, topId: c.topId ?? c.id, key: c.key };
      s.asmGroup.add(e);
    }
    if (list.length) {
      const box = new THREE.Box3();
      for (const o of s.asmGroup.children) {
        const gg = (o as THREE.Mesh).geometry;
        if (!(o as THREE.Mesh).isMesh || !gg.boundingSphere) continue;
        const sp = gg.boundingSphere.clone().applyMatrix4(o.matrix);
        box.expandByPoint(sp.center.clone().addScalar(sp.radius));
        box.expandByPoint(sp.center.clone().addScalar(-sp.radius));
      }
      const sp = box.getBoundingSphere(new THREE.Sphere());
      const changed = Math.abs(sp.radius - s.radius) / s.radius > 0.6 || movedAway(sp.center, sp.radius * 0.8, s.center, s.radius);
      s.radius = sp.radius * 0.8 || 100;
      s.center.copy(sp.center);
      if (firstFit.current || changed) {
        firstFit.current = false;
        buildGrid(s.radius);
        fitTo("iso");
      }
    }
    drawHilite();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [props.assembly, props.display, !!props.section]);

  // ---------- gizmo ----------
  const gizmoKey = props.gizmo ? `${props.gizmo.id}|${props.gizmo.mode}|${props.gizmo.matrix.join(",")}` : "";
  useEffect(() => {
    const s = S.current;
    if (!s) return;
    const g = props.gizmo;
    if (!g) {
      s.tc.detach();
      s.render();
      return;
    }
    if (s.tc.dragging) return;
    const m = new THREE.Matrix4().fromArray(g.matrix);
    m.decompose(s.proxy.position, s.proxy.quaternion, s.proxy.scale);
    s.proxy.updateMatrixWorld();
    s.tc.setMode(g.mode);
    s.tc.setSpace(g.mode === "rotate" ? "local" : "world");
    s.tc.attach(s.proxy);
    s.render();
  }, [gizmoKey]); // eslint-disable-line react-hooks/exhaustive-deps

  function fitTo(v: ViewName) {
    if (softView.current) return softView.current.setView(v);
    const s = S.current;
    if (!s) return;
    const dirs: Record<ViewName, [number, number, number]> = {
      iso: [1, -1.15, 0.85],
      front: [0, -1, 0],
      back: [0, 1, 0],
      top: [0, -0.0001, 1],
      bottom: [0, 0.0001, -1],
      right: [1, 0, 0],
      left: [-1, 0, 0],
    };
    const d = new THREE.Vector3(...dirs[v]).normalize();
    const dist = (s.radius / Math.sin((s.persp.fov * Math.PI) / 360)) * 1.12;
    s.persp.position.copy(s.center).addScaledVector(d, dist);
    s.persp.near = dist / 500;
    s.persp.far = dist * 50;
    s.persp.updateProjectionMatrix();
    perfMark("ui.fit", 0, { radius: Math.round(s.radius), x: Math.round(s.center.x), y: Math.round(s.center.y), z: Math.round(s.center.z) });
    s.orthoCam.position.copy(s.persp.position);
    s.orthoCam.zoom = 1;
    s.controls.target.copy(s.center);
    updateOrthoFrustum();
    s.controls.update();
    s.render();
  }

  useImperativeHandle(ref, () => ({
    setView: fitTo,
    fit: () => {
      if (softView.current) return softView.current.fit();
      const s = S.current;
      if (!s) return;
      const dir = s.camera.position.clone().sub(s.controls.target).normalize();
      const dist = (s.radius / Math.sin((s.persp.fov * Math.PI) / 360)) * 1.12;
      s.persp.position.copy(s.center).addScaledVector(dir, dist);
      s.orthoCam.position.copy(s.persp.position);
      s.orthoCam.zoom = 1;
      s.orthoCam.updateProjectionMatrix();
      s.controls.target.copy(s.center);
      updateOrthoFrustum();
      s.controls.update();
      s.render();
    },
    snapshot: () => {
      if (softView.current) return softView.current.snapshot();
      const s = S.current;
      if (!s) return null;
      s.renderer.render(s.scene, s.camera);
      return s.renderer.domElement.toDataURL("image/png");
    },
    camera: () => {
      if (softView.current) return softView.current.camera?.() ?? null;
      const s = S.current;
      return s ? { p: s.persp.position.toArray(), n: [s.persp.near, s.persp.far], o: s.orthoCam.position.toArray(), z: s.orthoCam.zoom, t: s.controls.target.toArray() } : null;
    },
    setCamera: (c: unknown) => {
      if (softView.current) return softView.current.setCamera?.(c);
      const s = S.current;
      const v = c as { p: [number, number, number]; n: [number, number]; o: [number, number, number]; z: number; t: [number, number, number] } | null;
      if (!s || !v?.p) return;
      s.persp.position.fromArray(v.p);
      [s.persp.near, s.persp.far] = v.n;
      s.persp.updateProjectionMatrix();
      s.orthoCam.position.fromArray(v.o);
      s.orthoCam.zoom = v.z;
      s.controls.target.fromArray(v.t);
      updateOrthoFrustum();
      s.controls.update();
      s.render();
    },
    /** popisky entit na obrazovce (souřadnice vůči 3D oknu) – pro automatizaci */
    hintList: () => hintsRef.current.map((hh) => ({ id: hh.id, kind: hh.kind, index: hh.index, x: hh.x, y: hh.y, title: hh.title })),
    /** „klikne“ na popisek (syntetické pointer události na plátně – stejná cesta jako myš) */
    clickHint: (id: string, additive = false) => {
      const hh = hintsRef.current.find((x) => x.id.toUpperCase() === id.trim().toUpperCase());
      const s = S.current;
      if (!hh || !s) return false;
      const r = s.renderer.domElement.getBoundingClientRect();
      const init: PointerEventInit = { clientX: r.left + hh.x, clientY: r.top + hh.y, button: 0, buttons: 1, bubbles: true, cancelable: true, pointerType: "mouse", pointerId: 1, isPrimary: true, ctrlKey: additive };
      s.renderer.domElement.dispatchEvent(new PointerEvent("pointerdown", init));
      s.renderer.domElement.dispatchEvent(new PointerEvent("pointerup", { ...init, buttons: 0 }));
      return true;
    },
    bounds: () => {
      if (softView.current) return softView.current.bounds();
      const s = S.current;
      return { center: s ? [s.center.x, s.center.y, s.center.z] : [0, 0, 0], radius: s?.radius ?? 100 };
    },
    focus: (center: Vec3, radius: number) => {
      const s = S.current;
      if (!s) return;
      const c = new THREE.Vector3(...center);
      const dir = s.camera.position.clone().sub(s.controls.target).normalize();
      const dist = (Math.max(radius, s.radius / 100) / Math.sin((s.persp.fov * Math.PI) / 360)) * 1.12;
      s.persp.position.copy(c).addScaledVector(dir, dist);
      s.persp.near = dist / 500;
      s.persp.far = Math.max(dist * 50, s.radius * 100);
      s.persp.updateProjectionMatrix();
      s.orthoCam.position.copy(s.persp.position);
      s.orthoCam.zoom = 1;
      s.orthoCam.updateProjectionMatrix();
      s.controls.target.copy(c);
      updateOrthoFrustum();
      s.controls.update();
      s.render();
    },
  }));

  /** stěny krychle ve světových souřadnicích: n = normála ven, u = směr nahoru na stěně */
  const faces: { v: ViewName; label: string; n: Vec3; u: Vec3 }[] = [
    { v: "front", label: tr("Přední"), n: [0, -1, 0], u: [0, 0, 1] },
    { v: "back", label: tr("Zadní"), n: [0, 1, 0], u: [0, 0, 1] },
    { v: "right", label: tr("Pravý"), n: [1, 0, 0], u: [0, 0, 1] },
    { v: "left", label: tr("Levý"), n: [-1, 0, 0], u: [0, 0, 1] },
    { v: "top", label: tr("Horní"), n: [0, 0, 1], u: [0, 1, 0] },
    { v: "bottom", label: tr("Spodní"), n: [0, 0, -1], u: [0, -1, 0] },
  ];
  const faceMatrix = (n: Vec3, u: Vec3) => {
    const r: Vec3 = [u[1] * n[2] - u[2] * n[1], u[2] * n[0] - u[0] * n[2], u[0] * n[1] - u[1] * n[0]];
    const d: Vec3 = [-u[0], -u[1], -u[2]];
    return `matrix3d(${[...r, 0, ...d, 0, ...n, 0, n[0] * 30, n[1] * 30, n[2] * 30, 1].join(",")})`;
  };

  return (
    <div className={softOn ? "invisible absolute inset-0" : "absolute inset-0"}>
      <div ref={host} className="absolute inset-0" />
      {/* popisky kót měření */}
      <div ref={labelsRef} className="pointer-events-none absolute inset-0 overflow-hidden">
        {(props.measure?.labels ?? []).map((l, i) => (
          <div key={i} className="absolute left-0 top-0 whitespace-nowrap rounded border border-brand/40 bg-white/95 px-1.5 py-0.5 font-mono text-[11px] font-semibold text-brand-600 shadow">
            {l.text}
          </div>
        ))}
      </div>
      {/* popisky entit pro výběr bez trefování (klik na střed popisku = klik na entitu; pointer-events: none) */}
      {props.hints && hintList.length > 0 && (
        <div data-hints className="pointer-events-none absolute inset-0 overflow-hidden">
          {hintList.map((hh) => (
            <div
              key={hh.id}
              data-hint={hh.id}
              data-kind={hh.kind}
              data-index={hh.index}
              title={hh.title}
              className={`absolute -translate-x-1/2 -translate-y-1/2 rounded px-1 font-mono text-[10px] font-semibold leading-[14px] text-white shadow ${hh.kind === "face" ? "bg-[#2563eb]/90" : hh.kind === "edge" ? "bg-[#059669]/90" : "bg-[#7c3aed]/90"}`}
              style={{ left: hh.x, top: hh.y }}
            >
              {hh.id}
            </div>
          ))}
        </div>
      )}
      {/* ViewCube */}
      <div className="absolute right-4 top-4 z-10 select-none" style={{ perspective: 600 }}>
        <div className="relative h-[60px] w-[60px]" style={{ transformStyle: "preserve-3d" }}>
          <div ref={cubeRef} className="absolute inset-0" style={{ transformStyle: "preserve-3d" }}>
            <div className="absolute inset-0" style={{ transformStyle: "preserve-3d" }}>
              {faces.map((f) => (
                <button
                  key={f.v}
                  type="button"
                  onClick={() => fitTo(f.v)}
                  className="absolute inset-0 grid place-items-center border border-slate-400/70 bg-gradient-to-br from-white to-slate-200 text-[9px] font-semibold uppercase tracking-wide text-slate-600 [backface-visibility:hidden] hover:from-amber-100 hover:to-amber-200 hover:text-slate-900"
                  style={{ transform: faceMatrix(f.n, f.u) }}
                  title={tr("Pohled: {0}", f.label)}
                >
                  {f.label}
                </button>
              ))}
            </div>
          </div>
        </div>
        <button type="button" onClick={() => fitTo("iso")} title={tr("Izometrie (domů)")} className="absolute -left-6 -top-1 rounded p-1 text-slate-500 hover:bg-white/70 hover:text-slate-800">
          <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth={1.7} strokeLinecap="round" strokeLinejoin="round">
            <path d="M3 11l9-7 9 7M5 9v11h14V9" />
          </svg>
        </button>
      </div>
      {/* osový kříž */}
      <svg ref={triadRef} viewBox="0 0 72 72" className="pointer-events-none absolute bottom-10 left-3 z-10 h-[72px] w-[72px]" aria-hidden>
        {["#E03930", "#16A34A", "#2563EB"].map((c, i) => (
          <g key={i}>
            <line data-ax={i} x1="36" y1="36" x2="36" y2="36" stroke={c} strokeWidth="2.2" strokeLinecap="round" />
            <text data-lab={i} x="36" y="36" fontSize="10" fontWeight="700" fill={c} textAnchor="middle" fontFamily="Roboto, Arial">
              {"XYZ"[i]}
            </text>
          </g>
        ))}
      </svg>
    </div>
  );
});

const round3 = (v: number) => Math.round(v * 1000) / 1000;

function niceStep(x: number) {
  const p = Math.pow(10, Math.floor(Math.log10(x)));
  const n = x / p;
  return (n < 2 ? 1 : n < 5 ? 2 : 5) * p;
}

let zebraTex: THREE.Texture | null = null;
/** Matcap textura s vodorovnými pruhy – odraz pruhů ukazuje zlomy a nehladké přechody ploch. */
function zebraTexture() {
  if (zebraTex) return zebraTex;
  const c = document.createElement("canvas");
  c.width = 512;
  c.height = 512;
  const g = c.getContext("2d")!;
  g.fillStyle = "#f4f6f8";
  g.fillRect(0, 0, 512, 512);
  g.fillStyle = "#1b2430";
  const stripes = 14;
  for (let i = 0; i < stripes; i++) {
    const y = (i / stripes) * 512;
    g.fillRect(0, y, 512, 512 / stripes / 2);
  }
  // lehké stínění po okrajích matcapu, ať je tvar čitelný
  const grad = g.createRadialGradient(256, 256, 120, 256, 256, 256);
  grad.addColorStop(0, "rgba(0,0,0,0)");
  grad.addColorStop(1, "rgba(0,0,0,0.55)");
  g.fillStyle = grad;
  g.fillRect(0, 0, 512, 512);
  zebraTex = new THREE.CanvasTexture(c);
  zebraTex.colorSpace = THREE.SRGBColorSpace;
  return zebraTex;
}
