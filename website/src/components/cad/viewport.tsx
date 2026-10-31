"use client";

import { forwardRef, useEffect, useImperativeHandle, useRef } from "react";
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { RoomEnvironment } from "three/examples/jsm/environments/RoomEnvironment.js";
import { toWorld } from "@/cad/defaults";
import { entityPath } from "@/cad/sketch";
import type { Feature, MeshData } from "@/cad/types";

export type PickMode = "none" | "edges" | "faces" | "face-plane";
export type ViewName = "iso" | "front" | "top" | "right" | "back" | "bottom";
export type ViewportHandle = { setView: (v: ViewName) => void; fit: () => void; snapshot: () => string | null };

type Props = {
  mesh: MeshData | null;
  sketches: Extract<Feature, { type: "sketch" }>[];
  pickMode: PickMode;
  selectedEdges: number[];
  selectedFaces: number[];
  onPickEdge?: (i: number) => void;
  onPickFace?: (i: number, point?: [number, number, number]) => void;
  busy?: boolean;
};

const COL = {
  face: new THREE.Color(0xd5d8dc),
  hover: new THREE.Color(0xf5b3ae),
  sel: new THREE.Color(0xe03930),
  edge: new THREE.Color(0x272425),
};

/**
 * 3D okno CAD: Z nahoru (strojírenská konvence), PBR ocel, výběr ploch/hran raycastem.
 */
export const Viewport = forwardRef<ViewportHandle, Props>(function Viewport(props, ref) {
  const host = useRef<HTMLDivElement>(null);
  const S = useRef<{
    renderer: THREE.WebGLRenderer;
    scene: THREE.Scene;
    camera: THREE.PerspectiveCamera;
    controls: OrbitControls;
    model: THREE.Group;
    sketchGroup: THREE.Group;
    mesh?: THREE.Mesh;
    edges?: THREE.LineSegments;
    edgeHi?: THREE.LineSegments;
    faceOf?: Int32Array; // trojúhelník → plocha
    edgeOf?: Int32Array; // segment → hrana
    grid: THREE.Group;
    hoverFace: number;
    hoverEdge: number;
    radius: number;
    center: THREE.Vector3;
    render: () => void;
  } | null>(null);
  const propsRef = useRef(props);
  propsRef.current = props;

  // ---------- inicializace ----------
  useEffect(() => {
    const el = host.current!;
    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.0;
    el.appendChild(renderer.domElement);
    renderer.domElement.style.display = "block";
    renderer.domElement.style.touchAction = "none";

    const scene = new THREE.Scene();
    const pmrem = new THREE.PMREMGenerator(renderer);
    scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.03).texture;
    THREE.Object3D.DEFAULT_UP.set(0, 0, 1);
    const camera = new THREE.PerspectiveCamera(30, 1, 0.1, 1e6);
    camera.up.set(0, 0, 1);
    camera.position.set(220, -260, 180);
    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.12;
    controls.screenSpacePanning = true;
    controls.mouseButtons = { LEFT: THREE.MOUSE.ROTATE, MIDDLE: THREE.MOUSE.PAN, RIGHT: THREE.MOUSE.PAN };

    scene.add(new THREE.HemisphereLight(0xffffff, 0xd8d4d0, 0.6));
    const key = new THREE.DirectionalLight(0xffffff, 1.1);
    key.position.set(1, -1.5, 2);
    camera.add(key);
    scene.add(camera);

    const grid = new THREE.Group();
    scene.add(grid);
    const model = new THREE.Group();
    scene.add(model);
    const sketchGroup = new THREE.Group();
    scene.add(sketchGroup);

    // osy
    const axes = new THREE.Group();
    const ax = (dir: THREE.Vector3, color: number) => {
      const g = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), dir.clone().multiplyScalar(30)]);
      axes.add(new THREE.Line(g, new THREE.LineBasicMaterial({ color, depthTest: false, transparent: true, opacity: 0.9 })));
    };
    ax(new THREE.Vector3(1, 0, 0), 0xe03930);
    ax(new THREE.Vector3(0, 1, 0), 0x2f9e44);
    ax(new THREE.Vector3(0, 0, 1), 0x1c7ed6);
    axes.renderOrder = 10;
    scene.add(axes);

    let raf = 0;
    let dirty = true;
    const render = () => {
      dirty = true;
    };
    const loop = () => {
      raf = requestAnimationFrame(loop);
      const moved = controls.update();
      if (moved || dirty) {
        renderer.render(scene, camera);
        dirty = false;
      }
    };
    loop();
    controls.addEventListener("change", render);

    const resize = () => {
      const w = el.clientWidth;
      const h = el.clientHeight;
      if (!w || !h) return;
      renderer.setSize(w, h);
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
      render();
    };
    resize();
    const ro = new ResizeObserver(resize);
    ro.observe(el);

    S.current = { renderer, scene, camera, controls, model, sketchGroup, grid, hoverFace: -1, hoverEdge: -1, radius: 100, center: new THREE.Vector3(), render };
    buildGrid(100);

    // ---------- výběr ----------
    const ray = new THREE.Raycaster();
    const ndc = new THREE.Vector2();
    let downAt: [number, number] | null = null;
    const pick = (e: PointerEvent) => {
      const s = S.current!;
      const rect = renderer.domElement.getBoundingClientRect();
      ndc.set(((e.clientX - rect.left) / rect.width) * 2 - 1, -((e.clientY - rect.top) / rect.height) * 2 + 1);
      ray.setFromCamera(ndc, camera);
      ray.params.Line = { threshold: s.radius / 120 };
      const mode = propsRef.current.pickMode;
      let face = -1;
      let edge = -1;
      let point: [number, number, number] | undefined;
      if (mode === "edges" && s.edges) {
        const hit = ray.intersectObject(s.edges, false)[0];
        if (hit && hit.index != null && s.edgeOf) edge = s.edgeOf[Math.floor(hit.index / 2)];
      }
      if ((mode === "faces" || mode === "face-plane") && s.mesh) {
        const hit = ray.intersectObject(s.mesh, false)[0];
        if (hit && hit.faceIndex != null && s.faceOf) {
          face = s.faceOf[hit.faceIndex];
          point = [hit.point.x, hit.point.y, hit.point.z];
        }
      }
      return { face, edge, point };
    };
    const onMove = (e: PointerEvent) => {
      const s = S.current!;
      if (propsRef.current.pickMode === "none" || e.buttons) {
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
    const onDown = (e: PointerEvent) => (downAt = [e.clientX, e.clientY]);
    const onUp = (e: PointerEvent) => {
      if (!downAt || Math.hypot(e.clientX - downAt[0], e.clientY - downAt[1]) > 4 || e.button !== 0) return;
      downAt = null;
      const { face, edge, point } = pick(e);
      if (edge >= 0) propsRef.current.onPickEdge?.(edge);
      if (face >= 0) propsRef.current.onPickFace?.(face, point);
    };
    renderer.domElement.addEventListener("pointermove", onMove);
    renderer.domElement.addEventListener("pointerdown", onDown);
    renderer.domElement.addEventListener("pointerup", onUp);

    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
      controls.dispose();
      renderer.domElement.removeEventListener("pointermove", onMove);
      renderer.domElement.removeEventListener("pointerdown", onDown);
      renderer.domElement.removeEventListener("pointerup", onUp);
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

  function buildGrid(radius: number) {
    const s = S.current!;
    s.grid.clear();
    const step = niceStep(radius / 6);
    const size = step * 24;
    const minor = new THREE.GridHelper(size, 24 * 5, 0xe7e5e4, 0xefedeb);
    const major = new THREE.GridHelper(size, 24, 0xd6d3d1, 0xd6d3d1);
    for (const g of [minor, major]) {
      g.rotation.x = Math.PI / 2;
      (g.material as THREE.Material).transparent = true;
      (g.material as THREE.Material).opacity = g === minor ? 0.6 : 0.9;
      (g.material as THREE.Material).depthWrite = false;
      s.grid.add(g);
    }
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
    // zvýraznění hran
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
      s.edgeHi = new THREE.LineSegments(g, new THREE.LineBasicMaterial({ color: 0xe03930, depthTest: false, transparent: true }));
      s.edgeHi.renderOrder = 5;
      s.model.add(s.edgeHi);
    }
    s.render();
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
    s.edges = undefined;
    s.edgeHi = undefined;
    const m = props.mesh;
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
      const mk = (c: THREE.Color) =>
        new THREE.MeshStandardMaterial({ color: c, metalness: 0.55, roughness: 0.38, envMapIntensity: 0.9, polygonOffset: true, polygonOffsetFactor: 1, polygonOffsetUnits: 1, side: THREE.DoubleSide });
      const mesh = new THREE.Mesh(geo, [mk(COL.face), mk(COL.hover), mk(COL.sel)]);
      s.model.add(mesh);
      s.mesh = mesh;
      s.faceOf = faceOf;

      const eg = new THREE.BufferGeometry();
      // „lines“ jsou dvojice bodů (segmenty); skupiny určují hranu
      const edgeOf = new Int32Array(m.lines.length / 6).fill(-1);
      for (let i = 0; i < m.edgeGroups.length; i += 3) {
        const [start, count, edge] = [m.edgeGroups[i], m.edgeGroups[i + 1], m.edgeGroups[i + 2]];
        for (let k = start / 2; k < (start + count) / 2; k++) edgeOf[k] = edge;
      }
      eg.setAttribute("position", new THREE.BufferAttribute(m.lines, 3));
      const edges = new THREE.LineSegments(eg, new THREE.LineBasicMaterial({ color: COL.edge, transparent: true, opacity: 0.85 }));
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
  }, [props.mesh]);

  // ---------- skici v prostoru ----------
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
        const line = new THREE.Line(new THREE.BufferGeometry().setFromPoints(w), new THREE.LineBasicMaterial({ color: 0xe03930, transparent: true, opacity: 0.9, depthTest: false }));
        line.renderOrder = 4;
        s.sketchGroup.add(line);
      }
    }
    if (!props.mesh && props.sketches.length) {
      // bez tělesa: zaměřit na skici
      const box = new THREE.Box3().setFromObject(s.sketchGroup);
      if (!box.isEmpty()) {
        const sp = box.getBoundingSphere(new THREE.Sphere());
        s.radius = Math.max(sp.radius, 20);
        s.center.copy(sp.center);
      }
    }
    s.render();
  }, [props.sketches, props.mesh]);

  useEffect(paint, [props.selectedEdges, props.selectedFaces, props.pickMode]); // eslint-disable-line react-hooks/exhaustive-deps

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
    };
    const d = new THREE.Vector3(...dirs[v]).normalize();
    const dist = (s.radius / Math.sin((s.camera.fov * Math.PI) / 360)) * 1.12;
    s.camera.position.copy(s.center).addScaledVector(d, dist);
    s.camera.near = dist / 500;
    s.camera.far = dist * 50;
    s.camera.updateProjectionMatrix();
    s.controls.target.copy(s.center);
    s.controls.update();
    s.render();
  }

  useImperativeHandle(ref, () => ({
    setView: fitTo,
    fit: () => fitTo("iso"),
    snapshot: () => {
      const s = S.current;
      if (!s) return null;
      s.renderer.render(s.scene, s.camera);
      return s.renderer.domElement.toDataURL("image/png");
    },
  }));

  return <div ref={host} className="absolute inset-0" />;
});

function niceStep(x: number) {
  const p = Math.pow(10, Math.floor(Math.log10(x)));
  const n = x / p;
  return (n < 2 ? 1 : n < 5 ? 2 : 5) * p;
}
