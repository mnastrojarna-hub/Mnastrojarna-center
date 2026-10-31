"use client";

import { useEffect, useRef } from "react";
import * as THREE from "three";
import { RoomEnvironment } from "three/examples/jsm/environments/RoomEnvironment.js";
import type { MeshData } from "@/cad/types";

/**
 * Malý 3D náhled sítě (knihovna normálií, náhledy dílů). Tažením myší se otáčí, kolečkem přibližuje.
 * Nezávislý na hlavním Viewportu – jen síť + hrany + jemné osvětlení.
 */
export function MiniViewport({ mesh, color = "#b9c2cc", className, spin = true }: { mesh: MeshData | null; color?: string; className?: string; spin?: boolean }) {
  const host = useRef<HTMLDivElement>(null);
  const S = useRef<{ renderer: THREE.WebGLRenderer; scene: THREE.Scene; camera: THREE.PerspectiveCamera; group: THREE.Group; pivot: THREE.Group; dist: number; render: () => void } | null>(null);

  useEffect(() => {
    const el = host.current!;
    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    el.appendChild(renderer.domElement);
    renderer.domElement.style.display = "block";
    const scene = new THREE.Scene();
    const pmrem = new THREE.PMREMGenerator(renderer);
    scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    const camera = new THREE.PerspectiveCamera(28, 1, 0.1, 1e5);
    camera.up.set(0, 0, 1);
    scene.add(new THREE.HemisphereLight(0xffffff, 0xcfd6de, 0.7));
    const key = new THREE.DirectionalLight(0xffffff, 1.1);
    key.position.set(1, -1.5, 2);
    camera.add(key);
    scene.add(camera);
    const pivot = new THREE.Group();
    const group = new THREE.Group();
    pivot.add(group);
    scene.add(pivot);
    let dirty = true;
    let raf = 0;
    let auto = spin;
    const render = () => (dirty = true);
    const loop = () => {
      raf = requestAnimationFrame(loop);
      if (auto) {
        pivot.rotation.z += 0.004;
        dirty = true;
      }
      if (dirty) {
        renderer.render(scene, camera);
        dirty = false;
      }
    };
    loop();
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
    // otáčení tažením, zoom kolečkem
    let down: [number, number] | null = null;
    const onDown = (e: PointerEvent) => {
      down = [e.clientX, e.clientY];
      auto = false;
      renderer.domElement.setPointerCapture(e.pointerId);
    };
    const onMove = (e: PointerEvent) => {
      if (!down) return;
      pivot.rotation.z += (e.clientX - down[0]) * 0.01;
      pivot.rotation.x = Math.max(-1.4, Math.min(1.4, pivot.rotation.x + (e.clientY - down[1]) * 0.01));
      down = [e.clientX, e.clientY];
      render();
    };
    const onUp = () => (down = null);
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const s = S.current;
      if (!s) return;
      s.dist *= e.deltaY > 0 ? 1.1 : 0.9;
      camera.position.setLength(s.dist);
      render();
    };
    renderer.domElement.addEventListener("pointerdown", onDown);
    renderer.domElement.addEventListener("pointermove", onMove);
    renderer.domElement.addEventListener("pointerup", onUp);
    renderer.domElement.addEventListener("wheel", onWheel, { passive: false });
    S.current = { renderer, scene, camera, group, pivot, dist: 300, render };
    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
      renderer.domElement.removeEventListener("pointerdown", onDown);
      renderer.domElement.removeEventListener("pointermove", onMove);
      renderer.domElement.removeEventListener("pointerup", onUp);
      renderer.domElement.removeEventListener("wheel", onWheel);
      scene.traverse((o) => (o as THREE.Mesh).geometry?.dispose?.());
      pmrem.dispose();
      renderer.dispose();
      renderer.domElement.remove();
      S.current = null;
    };
  }, [spin]);

  useEffect(() => {
    const s = S.current;
    if (!s) return;
    for (const o of [...s.group.children]) {
      s.group.remove(o);
      (o as THREE.Mesh).geometry?.dispose?.();
      ((o as THREE.Mesh).material as THREE.Material)?.dispose?.();
    }
    if (mesh && mesh.triangles.length) {
      const geo = new THREE.BufferGeometry();
      geo.setAttribute("position", new THREE.BufferAttribute(mesh.vertices, 3));
      geo.setAttribute("normal", new THREE.BufferAttribute(mesh.normals, 3));
      geo.setIndex(new THREE.BufferAttribute(mesh.triangles, 1));
      geo.computeBoundingSphere();
      const bs = geo.boundingSphere!;
      const mat = new THREE.MeshStandardMaterial({ color: new THREE.Color(color), metalness: 0.45, roughness: 0.42, envMapIntensity: 0.95, polygonOffset: true, polygonOffsetFactor: 1, polygonOffsetUnits: 1 });
      const m = new THREE.Mesh(geo, mat);
      m.position.copy(bs.center).negate();
      s.group.add(m);
      const eg = new THREE.BufferGeometry();
      eg.setAttribute("position", new THREE.BufferAttribute(mesh.lines, 3));
      const edges = new THREE.LineSegments(eg, new THREE.LineBasicMaterial({ color: 0x1b2430, transparent: true, opacity: 0.8 }));
      edges.position.copy(m.position);
      s.group.add(edges);
      s.dist = (bs.radius / Math.sin((s.camera.fov * Math.PI) / 360)) * 1.15;
      s.camera.position.set(1, -1.15, 0.85).normalize().multiplyScalar(s.dist);
      s.camera.lookAt(0, 0, 0);
      s.camera.near = s.dist / 200;
      s.camera.far = s.dist * 20;
      s.camera.updateProjectionMatrix();
    }
    s.render();
  }, [mesh, color]);

  return <div ref={host} className={className ?? "h-full w-full"} />;
}
