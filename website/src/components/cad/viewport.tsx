"use client";

import { forwardRef, useEffect, useImperativeHandle, useRef } from "react";
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { RoomEnvironment } from "three/examples/jsm/environments/RoomEnvironment.js";
import { toWorld } from "@/cad/defaults";
import { entityPath } from "@/cad/sketch";
import type { Feature, MeshData, Vec3 } from "@/cad/types";

export type PickMode = "none" | "edges" | "faces" | "face-plane" | "measure" | "component" | "asmFace";
export type ViewName = "iso" | "front" | "top" | "right" | "back" | "bottom" | "left";
export type DisplayMode = "shadedEdges" | "shaded" | "wireframe" | "hiddenLine" | "xray";
/** Schéma myši: ZW3D (pravé otáčí, prostřední posouvá), SolidWorks (prostřední otáčí, Ctrl+prostřední posouvá), jednoduché (levé otáčí). */
export type MouseScheme = "zw3d" | "solidworks" | "simple";
export type Section = { axis: "X" | "Y" | "Z"; offset: number; flip: boolean } | null;
export type Datum = { id: string; name: string; origin: Vec3; normal: Vec3; xDir: Vec3; size: number };
/** Komponenta sestavy k vykreslení: síť dílu (sdílená podle `key`) + matice umístění (po sloupcích). */
export type AsmView = { id: string; key: string; mesh: MeshData; matrix: number[]; color: string; selected?: boolean; dim?: boolean; clash?: boolean };

export type ViewportHandle = {
  setView: (v: ViewName) => void;
  fit: () => void;
  snapshot: () => string | null;
  bounds: () => { center: Vec3; radius: number };
};

type Props = {
  mesh: MeshData | null;
  sketches: Extract<Feature, { type: "sketch" }>[];
  datums?: Datum[];
  pickMode: PickMode;
  selectedEdges: number[];
  selectedFaces: number[];
  onPickEdge?: (i: number) => void;
  onPickFace?: (i: number, point?: [number, number, number]) => void;
  onMeasurePoint?: (p: Vec3) => void;
  measurePts?: Vec3[];
  onContext?: (x: number, y: number, face: number) => void;
  onCursor?: (p: Vec3 | null) => void;
  assembly?: AsmView[];
  onPickComponent?: (id: string | null, face: number, point?: Vec3) => void;
  display?: DisplayMode;
  ortho?: boolean;
  section?: Section;
  bodyColor?: string;
  mouse?: MouseScheme;
  showGrid?: boolean;
};

const HOVER = new THREE.Color(0xf59e0b);
const SEL = new THREE.Color(0xe03930);

type St = {
  renderer: THREE.WebGLRenderer;
  scene: THREE.Scene;
  persp: THREE.PerspectiveCamera;
  orthoCam: THREE.OrthographicCamera;
  camera: THREE.PerspectiveCamera | THREE.OrthographicCamera;
  key: THREE.DirectionalLight;
  controls: OrbitControls;
  model: THREE.Group;
  overlay: THREE.Group;
  sketchGroup: THREE.Group;
  asmGroup: THREE.Group;
  asmGeo: Map<string, { geo: THREE.BufferGeometry; edges: THREE.BufferGeometry; faceOf: Int32Array; mesh: MeshData }>;
  hoverComp: string | null;
  mesh?: THREE.Mesh;
  cap?: THREE.Mesh;
  edges?: THREE.LineSegments;
  edgeHi?: THREE.LineSegments;
  faceOf?: Int32Array;
  edgeOf?: Int32Array;
  grid: THREE.Group;
  hoverFace: number;
  hoverEdge: number;
  radius: number;
  center: THREE.Vector3;
  clip: THREE.Plane;
  cursorDot: THREE.Mesh;
  render: () => void;
};

/**
 * 3D okno CAD: Z nahoru (strojírenská konvence), PBR materiál, výběr ploch/hran raycastem,
 * ViewCube, osový kříž, styly zobrazení, řez rovinou a měření.
 */
export const Viewport = forwardRef<ViewportHandle, Props>(function Viewport(props, ref) {
  const host = useRef<HTMLDivElement>(null);
  const cubeRef = useRef<HTMLDivElement>(null);
  const triadRef = useRef<SVGSVGElement>(null);
  const S = useRef<St | null>(null);
  const propsRef = useRef(props);
  propsRef.current = props;

  // ---------- inicializace ----------
  useEffect(() => {
    const el = host.current!;
    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true });
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

    scene.add(new THREE.HemisphereLight(0xffffff, 0xcfd6de, 0.65));
    const key = new THREE.DirectionalLight(0xffffff, 1.15);
    key.position.set(1, -1.5, 2);
    persp.add(key);
    scene.add(persp);
    scene.add(orthoCam);

    const grid = new THREE.Group();
    scene.add(grid);
    const model = new THREE.Group();
    scene.add(model);
    const overlay = new THREE.Group();
    scene.add(overlay);
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

    const cursorDot = new THREE.Mesh(new THREE.SphereGeometry(1, 16, 12), new THREE.MeshBasicMaterial({ color: 0xf59e0b, depthTest: false, transparent: true }));
    cursorDot.renderOrder = 20;
    cursorDot.visible = false;
    scene.add(cursorDot);

    let raf = 0;
    let dirty = true;
    const render = () => {
      dirty = true;
    };
    const m4 = new THREE.Matrix4();
    const loop = () => {
      raf = requestAnimationFrame(loop);
      const moved = controls.update();
      if (moved || dirty) {
        const s = S.current;
        if (s) {
          // světlo vždy od kamery i u ortho
          if (s.camera === s.orthoCam && key.parent !== orthoCam) orthoCam.add(key);
          if (s.camera === s.persp && key.parent !== persp) persp.add(key);
          renderer.render(scene, s.camera);
          syncCube(s.camera);
        }
        dirty = false;
      }
    };
    const syncCube = (cam: THREE.Camera) => {
      cam.updateMatrixWorld();
      m4.copy(cam.matrixWorldInverse);
      const e = m4.elements;
      // rotační část pohledu → CSS (osa Y dolů)
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
    S.current = { renderer, scene, persp, orthoCam, camera: persp, key, controls, model, overlay, sketchGroup, asmGroup, asmGeo: new Map(), hoverComp: null, grid, hoverFace: -1, hoverEdge: -1, radius: 100, center: new THREE.Vector3(), clip, cursorDot, render };
    resize();
    const ro = new ResizeObserver(resize);
    ro.observe(el);
    buildGrid(100);
    applyMouse();

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
    const hitAsm = (e: PointerEvent | MouseEvent) => {
      const s = S.current!;
      setRay(e);
      const hit = ray.intersectObjects(s.asmGroup.children.filter((o) => (o as THREE.Mesh).isMesh && o.visible), false).find((h) => clipOk(h.point));
      if (!hit) return null;
      const faceOf = (hit.object as THREE.Mesh).geometry.userData.faceOf as Int32Array | undefined;
      return { id: hit.object.userData.id as string, face: hit.faceIndex != null && faceOf ? faceOf[hit.faceIndex] : -1, point: hit.point, hit };
    };
    const hitMesh = (e: PointerEvent | MouseEvent) => {
      const s = S.current!;
      if (propsRef.current.assembly?.length) return hitAsm(e)?.hit ?? null;
      if (!s.mesh) return null;
      setRay(e);
      return ray.intersectObject(s.mesh, false).find((h) => clipOk(h.point)) ?? null;
    };
    const pick = (e: PointerEvent) => {
      const s = S.current!;
      setRay(e);
      const mode = propsRef.current.pickMode;
      let face = -1;
      let edge = -1;
      let point: [number, number, number] | undefined;
      if (mode === "edges" && s.edges) {
        const hit = ray.intersectObject(s.edges, false).find((h) => clipOk(h.point));
        if (hit && hit.index != null && s.edgeOf) edge = s.edgeOf[Math.floor(hit.index / 2)];
      }
      if ((mode === "faces" || mode === "face-plane") && s.mesh) {
        const hit = hitMesh(e);
        if (hit && hit.faceIndex != null && s.faceOf) {
          face = s.faceOf[hit.faceIndex];
          point = [hit.point.x, hit.point.y, hit.point.z];
        }
      }
      return { face, edge, point };
    };
    /** bod pro měření – přichytí se k vrcholu sítě, je-li blízko */
    const measurePoint = (e: PointerEvent): Vec3 | null => {
      const s = S.current!;
      const hit = hitMesh(e);
      if (!hit || !s.mesh || !hit.face) return null;
      const pos = s.mesh.geometry.getAttribute("position");
      const rect = renderer.domElement.getBoundingClientRect();
      let best: THREE.Vector3 | null = null;
      let bestD = 14;
      for (const i of [hit.face.a, hit.face.b, hit.face.c]) {
        const v = new THREE.Vector3().fromBufferAttribute(pos, i);
        const p = v.clone().project(s.camera);
        const sx = ((p.x + 1) / 2) * rect.width + rect.left;
        const sy = ((1 - p.y) / 2) * rect.height + rect.top;
        const d = Math.hypot(sx - e.clientX, sy - e.clientY);
        if (d < bestD) {
          bestD = d;
          best = v;
        }
      }
      const p = best ?? hit.point;
      return [round3(p.x), round3(p.y), round3(p.z)];
    };
    const onMove = (e: PointerEvent) => {
      const s = S.current!;
      const mode = propsRef.current.pickMode;
      if (propsRef.current.onCursor && !e.buttons) {
        const h = hitMesh(e);
        propsRef.current.onCursor(h ? [round3(h.point.x), round3(h.point.y), round3(h.point.z)] : null);
      }
      if (mode === "measure" && !e.buttons) {
        const p = measurePoint(e);
        s.cursorDot.visible = !!p;
        if (p) {
          s.cursorDot.position.set(...p);
          s.cursorDot.scale.setScalar(s.radius / 90);
        }
        s.render();
        return;
      }
      if ((mode === "component" || mode === "asmFace") && !e.buttons) {
        const h = hitAsm(e);
        const id = h?.id ?? null;
        if (id !== s.hoverComp) {
          s.hoverComp = id;
          renderer.domElement.style.cursor = id ? "pointer" : "";
          paintAsm();
        }
        return;
      }
      if (mode === "none" || e.buttons) {
        if (s.hoverFace !== -1 || s.hoverEdge !== -1) {
          s.hoverFace = -1;
          s.hoverEdge = -1;
          paint();
        }
        return;
      }
      const { face, edge } = pick(e);
      if (face !== s.hoverFace || edge !== s.hoverEdge) {
        s.hoverFace = face;
        s.hoverEdge = edge;
        renderer.domElement.style.cursor = face >= 0 || edge >= 0 ? "pointer" : "";
        paint();
      }
    };
    const onDown = (e: PointerEvent) => (downAt = [e.clientX, e.clientY, e.button]);
    const onUp = (e: PointerEvent) => {
      if (!downAt || Math.hypot(e.clientX - downAt[0], e.clientY - downAt[1]) > 4 || e.button !== downAt[2]) {
        downAt = null;
        return;
      }
      downAt = null;
      if (e.button === 2) {
        const s = S.current!;
        if (propsRef.current.assembly?.length) {
          const h = hitAsm(e);
          if (h) propsRef.current.onPickComponent?.(h.id, h.face, [h.point.x, h.point.y, h.point.z]);
          propsRef.current.onContext?.(e.clientX, e.clientY, h?.face ?? -1);
          return;
        }
        const h = hitMesh(e);
        const face = h && h.faceIndex != null && s.faceOf ? s.faceOf[h.faceIndex] : -1;
        propsRef.current.onContext?.(e.clientX, e.clientY, face);
        return;
      }
      if (e.button !== 0) return;
      const pm = propsRef.current.pickMode;
      if (pm === "component" || pm === "asmFace") {
        const h = hitAsm(e);
        propsRef.current.onPickComponent?.(h?.id ?? null, h?.face ?? -1, h ? [h.point.x, h.point.y, h.point.z] : undefined);
        return;
      }
      if (propsRef.current.pickMode === "measure") {
        const p = measurePoint(e);
        if (p) propsRef.current.onMeasurePoint?.(p);
        return;
      }
      const { face, edge, point } = pick(e);
      if (edge >= 0) propsRef.current.onPickEdge?.(edge);
      if (face >= 0) propsRef.current.onPickFace?.(face, point);
    };
    const onCtx = (e: MouseEvent) => e.preventDefault();
    const onLeave = () => {
      propsRef.current.onCursor?.(null);
      const s = S.current!;
      if (s.cursorDot.visible) {
        s.cursorDot.visible = false;
        s.render();
      }
    };
    renderer.domElement.addEventListener("pointermove", onMove);
    renderer.domElement.addEventListener("pointerdown", onDown);
    renderer.domElement.addEventListener("pointerup", onUp);
    renderer.domElement.addEventListener("pointerleave", onLeave);
    renderer.domElement.addEventListener("contextmenu", onCtx);

    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
      controls.dispose();
      renderer.domElement.removeEventListener("pointermove", onMove);
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
    s.controls.update();
    s.render();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [props.ortho]);

  function buildGrid(radius: number) {
    const s = S.current!;
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

  function materials() {
    const p = propsRef.current;
    const display = p.display ?? "shadedEdges";
    const base = new THREE.Color(p.bodyColor ?? "#b9c2cc");
    const clipping = p.section ? [S.current!.clip] : [];
    const mk = (c: THREE.Color) => {
      if (display === "hiddenLine") return new THREE.MeshBasicMaterial({ color: c.equals(base) ? new THREE.Color(0xffffff) : c, polygonOffset: true, polygonOffsetFactor: 1, polygonOffsetUnits: 1, side: THREE.DoubleSide, clippingPlanes: clipping });
      const m = new THREE.MeshStandardMaterial({ color: c, metalness: 0.45, roughness: 0.42, envMapIntensity: 0.95, polygonOffset: true, polygonOffsetFactor: 1, polygonOffsetUnits: 1, side: THREE.FrontSide, clippingPlanes: clipping });
      if (display === "xray") {
        m.transparent = true;
        m.opacity = 0.28;
        m.depthWrite = false;
        m.side = THREE.DoubleSide;
      }
      if (display === "wireframe") m.visible = false;
      return m;
    };
    return [mk(base), mk(HOVER), mk(SEL)];
  }

  function paint() {
    const s = S.current;
    if (!s?.mesh) return s?.render();
    const { selectedFaces, selectedEdges, pickMode } = propsRef.current;
    const geo = s.mesh.geometry;
    for (const g of geo.groups) {
      const fi = (g as THREE.GeometryGroup & { face: number }).face;
      g.materialIndex = selectedFaces.includes(fi) ? 2 : fi === s.hoverFace && pickMode !== "edges" ? 1 : 0;
    }
    if (s.edgeHi) {
      s.model.remove(s.edgeHi);
      s.edgeHi.geometry.dispose();
      s.edgeHi = undefined;
    }
    const want = new Set(selectedEdges);
    if (s.hoverEdge >= 0) want.add(s.hoverEdge);
    if (want.size && s.edges && s.edgeOf) {
      const src = s.edges.geometry.getAttribute("position").array as Float32Array;
      const pts: number[] = [];
      for (let seg = 0; seg < s.edgeOf.length; seg++) if (want.has(s.edgeOf[seg])) pts.push(...src.slice(seg * 6, seg * 6 + 6));
      const g = new THREE.BufferGeometry();
      g.setAttribute("position", new THREE.Float32BufferAttribute(pts, 3));
      s.edgeHi = new THREE.LineSegments(g, new THREE.LineBasicMaterial({ color: selectedEdges.length ? 0xe03930 : 0xf59e0b, depthTest: false, transparent: true, linewidth: 2 }));
      s.edgeHi.renderOrder = 5;
      s.model.add(s.edgeHi);
    }
    s.render();
  }

  function applyClip() {
    const s = S.current;
    if (!s) return;
    const sec = propsRef.current.section;
    if (sec) {
      // ponechá se strana, kam míří normála (výchozí: +osa, tj. dál od izometrické kamery → řez je vidět)
      const sign = (sec.axis === "Y" ? 1 : -1) * (sec.flip ? -1 : 1);
      const n = new THREE.Vector3(sec.axis === "X" ? 1 : 0, sec.axis === "Y" ? 1 : 0, sec.axis === "Z" ? 1 : 0).multiplyScalar(sign);
      s.clip.set(n, -sign * sec.offset);
    }
  }

  // ---------- model ----------
  const firstFit = useRef(true);
  useEffect(() => {
    const s = S.current;
    if (!s) return;
    for (const o of [...s.model.children]) {
      s.model.remove(o);
      (o as THREE.Mesh).geometry?.dispose();
    }
    s.mesh = undefined;
    s.cap = undefined;
    s.edges = undefined;
    s.edgeHi = undefined;
    const m = props.mesh;
    const display = props.display ?? "shadedEdges";
    applyClip();
    if (m && m.triangles.length) {
      const geo = new THREE.BufferGeometry();
      geo.setAttribute("position", new THREE.BufferAttribute(m.vertices, 3));
      geo.setAttribute("normal", new THREE.BufferAttribute(m.normals, 3));
      geo.setIndex(new THREE.BufferAttribute(m.triangles, 1));
      const triCount = m.triangles.length / 3;
      const faceOf = new Int32Array(triCount).fill(-1);
      for (let i = 0; i < m.faceGroups.length; i += 3) {
        const [start, count, face] = [m.faceGroups[i], m.faceGroups[i + 1], m.faceGroups[i + 2]];
        geo.addGroup(start, count, 0);
        (geo.groups[geo.groups.length - 1] as THREE.GeometryGroup & { face: number }).face = face;
        for (let t = start / 3; t < (start + count) / 3; t++) faceOf[t] = face;
      }
      const mesh = new THREE.Mesh(geo, materials());
      s.model.add(mesh);
      s.mesh = mesh;
      s.faceOf = faceOf;
      if (props.section && display !== "wireframe") {
        // „víko“ řezu: zadní strany ploch viditelné skrz řez obarvené jako šrafa
        const cap = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ color: 0xe8706a, side: THREE.BackSide, clippingPlanes: [s.clip] }));
        s.model.add(cap);
        s.cap = cap;
      }

      const eg = new THREE.BufferGeometry();
      const edgeOf = new Int32Array(m.lines.length / 6).fill(-1);
      for (let i = 0; i < m.edgeGroups.length; i += 3) {
        const [start, count, edge] = [m.edgeGroups[i], m.edgeGroups[i + 1], m.edgeGroups[i + 2]];
        for (let k = start / 2; k < (start + count) / 2; k++) edgeOf[k] = edge;
      }
      eg.setAttribute("position", new THREE.BufferAttribute(m.lines, 3));
      const edgeColor = display === "hiddenLine" || display === "wireframe" ? 0x1f2933 : 0x1b2430;
      const edges = new THREE.LineSegments(
        eg,
        new THREE.LineBasicMaterial({ color: edgeColor, transparent: true, opacity: display === "shaded" ? 0 : 0.9, clippingPlanes: props.section ? [s.clip] : [], depthTest: display !== "wireframe" }),
      );
      edges.visible = display !== "shaded";
      s.model.add(edges);
      s.edges = edges;
      s.edgeOf = edgeOf;

      geo.computeBoundingSphere();
      const bs = geo.boundingSphere!;
      const changed = Math.abs(bs.radius - s.radius) / s.radius > 0.6;
      s.radius = bs.radius || 100;
      s.center.copy(bs.center);
      if (firstFit.current || changed) {
        firstFit.current = false;
        buildGrid(s.radius);
        fitTo("iso");
      }
    }
    paint();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [props.mesh, props.display, props.bodyColor, !!props.section]);

  useEffect(() => {
    applyClip();
    S.current?.render();
  }, [props.section?.axis, props.section?.offset, props.section?.flip]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const s = S.current;
    if (!s) return;
    s.grid.visible = props.showGrid !== false;
    s.render();
  }, [props.showGrid]);

  // ---------- skici, roviny a měření v prostoru ----------
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
        const line = new THREE.Line(new THREE.BufferGeometry().setFromPoints(w), new THREE.LineBasicMaterial({ color: 0x2563eb, transparent: true, opacity: 0.95, depthTest: false }));
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
    if (!props.mesh && props.sketches.length) {
      const box = new THREE.Box3().setFromObject(s.sketchGroup);
      if (!box.isEmpty()) {
        const sp = box.getBoundingSphere(new THREE.Sphere());
        s.radius = Math.max(sp.radius, 20);
        s.center.copy(sp.center);
      }
    }
    s.render();
  }, [props.sketches, props.mesh, props.datums]);

  useEffect(() => {
    const s = S.current;
    if (!s) return;
    for (const o of [...s.overlay.children]) {
      s.overlay.remove(o);
      (o as THREE.Mesh).geometry?.dispose();
    }
    const pts = props.measurePts ?? [];
    const r = s.radius / 110;
    for (const p of pts) {
      const dot = new THREE.Mesh(new THREE.SphereGeometry(r, 16, 12), new THREE.MeshBasicMaterial({ color: 0xe03930, depthTest: false }));
      dot.position.set(...p);
      dot.renderOrder = 21;
      s.overlay.add(dot);
    }
    if (pts.length === 2) {
      const line = new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts.map((p) => new THREE.Vector3(...p))), new THREE.LineDashedMaterial({ color: 0xe03930, dashSize: r * 3, gapSize: r * 1.5, depthTest: false }));
      line.computeLineDistances();
      line.renderOrder = 21;
      s.overlay.add(line);
    }
    if (props.pickMode !== "measure") s.cursorDot.visible = false;
    s.render();
  }, [props.measurePts, props.pickMode]);

  useEffect(paint, [props.selectedEdges, props.selectedFaces, props.pickMode]); // eslint-disable-line react-hooks/exhaustive-deps

  function paintAsm() {
    const s = S.current;
    if (!s) return;
    for (const o of s.asmGroup.children) {
      const mat = (o as THREE.Mesh).material as THREE.MeshStandardMaterial;
      if (!(o as THREE.Mesh).isMesh || !mat?.userData?.base) continue;
      const hov = o.userData.id === s.hoverComp;
      mat.emissive?.set(hov ? 0x8a5a00 : o.userData.selected ? 0x5a0d08 : 0x000000);
    }
    s.render();
  }

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
    // geometrie sdílené podle klíče dílu; nepoužité uvolnit
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
        const m = c.mesh;
        const geo = new THREE.BufferGeometry();
        geo.setAttribute("position", new THREE.BufferAttribute(m.vertices, 3));
        geo.setAttribute("normal", new THREE.BufferAttribute(m.normals, 3));
        geo.setIndex(new THREE.BufferAttribute(m.triangles, 1));
        const faceOf = new Int32Array(m.triangles.length / 3).fill(-1);
        for (let i = 0; i < m.faceGroups.length; i += 3) for (let t = m.faceGroups[i] / 3; t < (m.faceGroups[i] + m.faceGroups[i + 1]) / 3; t++) faceOf[t] = m.faceGroups[i + 2];
        geo.userData.faceOf = faceOf;
        geo.computeBoundingSphere();
        const edges = new THREE.BufferGeometry();
        edges.setAttribute("position", new THREE.BufferAttribute(m.lines, 3));
        g = { geo, edges, faceOf, mesh: m };
        s.asmGeo.set(c.key, g);
      }
      const mtx = new THREE.Matrix4().fromArray(c.matrix);
      const col = new THREE.Color(c.clash ? "#ff3b30" : c.color);
      const mat =
        display === "hiddenLine"
          ? new THREE.MeshBasicMaterial({ color: 0xffffff, polygonOffset: true, polygonOffsetFactor: 1, polygonOffsetUnits: 1, clippingPlanes: clipping })
          : new THREE.MeshStandardMaterial({ color: col, metalness: 0.4, roughness: 0.45, envMapIntensity: 0.9, polygonOffset: true, polygonOffsetFactor: 1, polygonOffsetUnits: 1, clippingPlanes: clipping });
      if (display === "xray" || c.dim) {
        mat.transparent = true;
        mat.opacity = c.dim ? 0.18 : 0.3;
        mat.depthWrite = false;
      }
      if (display === "wireframe") mat.visible = false;
      mat.userData = { base: c.color };
      if (c.selected && "emissive" in mat) (mat as THREE.MeshStandardMaterial).emissive.set(0x5a0d08);
      const mesh = new THREE.Mesh(g.geo, mat);
      mesh.matrixAutoUpdate = false;
      mesh.matrix.copy(mtx);
      mesh.userData = { id: c.id, selected: c.selected };
      s.asmGroup.add(mesh);
      if (display !== "shaded") {
        const e = new THREE.LineSegments(g.edges, new THREE.LineBasicMaterial({ color: c.selected ? 0xe03930 : 0x1b2430, transparent: true, opacity: c.dim ? 0.25 : c.selected ? 1 : 0.75, clippingPlanes: clipping }));
        e.matrixAutoUpdate = false;
        e.matrix.copy(mtx);
        e.userData = { id: c.id };
        s.asmGroup.add(e);
      }
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
      const changed = Math.abs(sp.radius - s.radius) / s.radius > 0.6;
      s.radius = sp.radius * 0.8 || 100;
      s.center.copy(sp.center);
      if (firstFit.current || changed) {
        firstFit.current = false;
        buildGrid(s.radius);
        fitTo("iso");
      }
    }
    s.render();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [props.assembly, props.display, !!props.section]);

  function fitTo(v: ViewName) {
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
      const s = S.current;
      if (!s) return;
      // zachovat směr pohledu, jen přiblížit na model
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
      const s = S.current;
      if (!s) return null;
      s.renderer.render(s.scene, s.camera);
      return s.renderer.domElement.toDataURL("image/png");
    },
    bounds: () => {
      const s = S.current;
      return { center: s ? [s.center.x, s.center.y, s.center.z] : [0, 0, 0], radius: s?.radius ?? 100 };
    },
  }));

  /** stěny krychle ve světových souřadnicích: n = normála ven, u = směr nahoru na stěně */
  const faces: { v: ViewName; label: string; n: Vec3; u: Vec3 }[] = [
    { v: "front", label: "Přední", n: [0, -1, 0], u: [0, 0, 1] },
    { v: "back", label: "Zadní", n: [0, 1, 0], u: [0, 0, 1] },
    { v: "right", label: "Pravý", n: [1, 0, 0], u: [0, 0, 1] },
    { v: "left", label: "Levý", n: [-1, 0, 0], u: [0, 0, 1] },
    { v: "top", label: "Horní", n: [0, 0, 1], u: [0, 1, 0] },
    { v: "bottom", label: "Spodní", n: [0, 0, -1], u: [0, -1, 0] },
  ];
  const faceMatrix = (n: Vec3, u: Vec3) => {
    const r: Vec3 = [u[1] * n[2] - u[2] * n[1], u[2] * n[0] - u[0] * n[2], u[0] * n[1] - u[1] * n[0]];
    const d: Vec3 = [-u[0], -u[1], -u[2]];
    return `matrix3d(${[...r, 0, ...d, 0, ...n, 0, n[0] * 30, n[1] * 30, n[2] * 30, 1].join(",")})`;
  };

  return (
    <div className="absolute inset-0">
      <div ref={host} className="absolute inset-0" />
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
                  title={`Pohled: ${f.label}`}
                >
                  {f.label}
                </button>
              ))}
            </div>
          </div>
        </div>
        <button type="button" onClick={() => fitTo("iso")} title="Izometrie (domů)" className="absolute -left-6 -top-1 rounded p-1 text-slate-500 hover:bg-white/70 hover:text-slate-800">
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
