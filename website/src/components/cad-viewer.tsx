"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { RoomEnvironment } from "three/examples/jsm/environments/RoomEnvironment.js";
import { MATERIALS, fmtNum, massKg, meshMetrics, type Metrics } from "@/lib/mesh-metrics";
import { loadCad, type LoadedMesh } from "@/lib/occt";
import { cn } from "@/lib/cn";

type State = { status: "idle" } | { status: "loading" } | { status: "error"; error: string } | { status: "ready"; metrics: Metrics };

/**
 * 3D náhled CAD modelu (STEP/IGES/STL) s měřením: gabarit, objem, povrch, hmotnost.
 * Model se zpracovává lokálně (WebAssembly) — nic se neodesílá na server.
 */
export function CadViewer({
  file,
  className,
  compact,
  onMetrics,
}: {
  file: File | null;
  className?: string;
  compact?: boolean;
  onMetrics?: (m: Metrics | null) => void;
}) {
  const host = useRef<HTMLDivElement>(null);
  const api = useRef<{ show: (m: LoadedMesh[]) => void; dispose: () => void; view: (v: "iso" | "top" | "front") => void; wire: (on: boolean) => void } | null>(null);
  const [state, setState] = useState<State>({ status: "idle" });
  const [material, setMaterial] = useState<string>("ocel");
  const [wire, setWire] = useState(false);
  const onMetricsRef = useRef(onMetrics);
  onMetricsRef.current = onMetrics;

  // Inicializace scény
  useEffect(() => {
    const el = host.current;
    if (!el) return;
    let renderer: THREE.WebGLRenderer;
    try {
      renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: false });
    } catch {
      setState({ status: "error", error: "Váš prohlížeč nepodporuje WebGL." });
      return;
    }
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    el.appendChild(renderer.domElement);
    renderer.domElement.style.display = "block";
    renderer.domElement.style.touchAction = "none";

    const scene = new THREE.Scene();
    const pmrem = new THREE.PMREMGenerator(renderer);
    const env = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    scene.environment = env;
    const camera = new THREE.PerspectiveCamera(40, 1, 0.1, 1e6);
    camera.position.set(1, 0.8, 1.2);
    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.autoRotate = true;
    controls.autoRotateSpeed = 0.8;
    controls.addEventListener("start", () => (controls.autoRotate = false));

    const group = new THREE.Group();
    scene.add(group);
    const grid = new THREE.GridHelper(1, 20, 0xe03930, 0x444444);
    (grid.material as THREE.Material).transparent = true;
    (grid.material as THREE.Material).opacity = 0.25;
    scene.add(grid);
    const dirL = new THREE.DirectionalLight(0xffffff, 1.4);
    dirL.position.set(3, 5, 4);
    scene.add(dirL);
    const rimL = new THREE.DirectionalLight(0xff4a3d, 0.9);
    rimL.position.set(-4, 2, -3);
    scene.add(rimL);

    const mat = new THREE.MeshPhysicalMaterial({ color: 0xc4c7cb, metalness: 0.85, roughness: 0.32, clearcoat: 0.2, side: THREE.DoubleSide });
    const edgeMat = new THREE.LineBasicMaterial({ color: 0xe03930, transparent: true, opacity: 0.85 });
    let radius = 1;
    let center = new THREE.Vector3();

    const fit = (dir: THREE.Vector3) => {
      const d = radius / Math.sin((camera.fov * Math.PI) / 360) * 1.15;
      camera.position.copy(center).addScaledVector(dir.normalize(), d);
      camera.near = d / 1000;
      camera.far = d * 100;
      camera.updateProjectionMatrix();
      controls.target.copy(center);
      controls.update();
    };

    const resize = () => {
      const w = el.clientWidth;
      const h = el.clientHeight;
      if (!w || !h) return;
      renderer.setSize(w, h);
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
    };
    resize();
    const ro = new ResizeObserver(resize);
    ro.observe(el);

    let raf = 0;
    const loop = () => {
      raf = requestAnimationFrame(loop);
      controls.update();
      renderer.render(scene, camera);
    };
    loop();

    api.current = {
      show(meshes) {
        group.traverse((o) => {
          const m = o as THREE.Mesh;
          if (m.geometry) m.geometry.dispose();
        });
        group.clear();
        for (const m of meshes) {
          const g = new THREE.BufferGeometry();
          g.setAttribute("position", new THREE.BufferAttribute(m.position instanceof Float32Array ? m.position : new Float32Array(m.position), 3));
          if (m.index && m.index.length) g.setIndex(new THREE.BufferAttribute(m.index instanceof Uint32Array ? m.index : new Uint32Array(m.index), 1));
          if (m.normal) g.setAttribute("normal", new THREE.BufferAttribute(m.normal, 3));
          else g.computeVertexNormals();
          group.add(new THREE.Mesh(g, mat));
          group.add(new THREE.LineSegments(new THREE.EdgesGeometry(g, 30), edgeMat));
        }
        // CAD je obvykle Z-up → otočit do Y-up
        group.rotation.set(-Math.PI / 2, 0, 0);
        group.updateMatrixWorld(true);
        const box = new THREE.Box3().setFromObject(group);
        const sphere = box.getBoundingSphere(new THREE.Sphere());
        radius = sphere.radius || 1;
        center = sphere.center;
        grid.scale.setScalar(radius * 4);
        grid.position.set(center.x, box.min.y, center.z);
        fit(new THREE.Vector3(1, 0.75, 1.1));
        controls.autoRotate = true;
      },
      view(v) {
        fit(v === "top" ? new THREE.Vector3(0, 1, 0.0001) : v === "front" ? new THREE.Vector3(0, 0, 1) : new THREE.Vector3(1, 0.75, 1.1));
        controls.autoRotate = false;
      },
      wire(on) {
        mat.wireframe = on;
      },
      dispose() {
        cancelAnimationFrame(raf);
        ro.disconnect();
        controls.dispose();
        group.traverse((o) => (o as THREE.Mesh).geometry?.dispose());
        mat.dispose();
        edgeMat.dispose();
        env.dispose();
        pmrem.dispose();
        renderer.dispose();
        renderer.domElement.remove();
      },
    };
    return () => {
      api.current?.dispose();
      api.current = null;
    };
  }, []);

  // Načtení souboru
  useEffect(() => {
    let alive = true;
    if (!file) {
      setState({ status: "idle" });
      onMetricsRef.current?.(null);
      return;
    }
    setState({ status: "loading" });
    loadCad(file)
      .then((meshes) => {
        if (!alive) return;
        if (!meshes.length) throw new Error("Soubor neobsahuje žádnou geometrii.");
        api.current?.show(meshes);
        const metrics = meshMetrics(meshes);
        setState({ status: "ready", metrics });
        onMetricsRef.current?.(metrics);
      })
      .catch((e: Error) => {
        if (!alive) return;
        setState({ status: "error", error: e.message });
        onMetricsRef.current?.(null);
      });
    return () => {
      alive = false;
    };
  }, [file]);

  useEffect(() => api.current?.wire(wire), [wire]);

  const density = useMemo(() => MATERIALS.find((m) => m.id === material)?.density ?? 7.85, [material]);

  return (
    <div className={cn("relative overflow-hidden rounded-2xl border border-white/10 bg-ink", className)}>
      <div className="bg-grid absolute inset-0 opacity-60" />
      <div ref={host} className={cn("relative w-full", compact ? "h-64" : "h-[52vh] min-h-[340px]")} />

      {state.status !== "ready" && (
        <div className="pointer-events-none absolute inset-0 grid place-items-center p-6 text-center">
          {state.status === "loading" && (
            <div className="flex flex-col items-center gap-3 text-white/70">
              <span className="h-10 w-10 animate-spin rounded-full border-2 border-white/15 border-t-brand" />
              <p className="text-sm">Načítám 3D jádro a zpracovávám model…</p>
            </div>
          )}
          {state.status === "error" && <p className="max-w-sm text-sm text-red-300">{state.error}</p>}
          {state.status === "idle" && <p className="text-sm text-white/40">Zde se zobrazí 3D náhled modelu</p>}
        </div>
      )}

      {state.status === "ready" && (
        <>
          <div className="absolute right-3 top-3 flex gap-1 rounded-full border border-white/10 bg-black/50 p-1 backdrop-blur">
            {(["iso", "top", "front"] as const).map((v) => (
              <button key={v} type="button" onClick={() => api.current?.view(v)} className="rounded-full px-3 py-1 font-mono text-[11px] uppercase text-white/70 hover:bg-white/10 hover:text-white">
                {v === "iso" ? "Izo" : v === "top" ? "Shora" : "Zepředu"}
              </button>
            ))}
            <button type="button" onClick={() => setWire((w) => !w)} className={cn("rounded-full px-3 py-1 font-mono text-[11px] uppercase hover:bg-white/10", wire ? "text-brand" : "text-white/70")}>
              Drát
            </button>
          </div>
          <div className="relative grid grid-cols-2 gap-px border-t border-white/10 bg-white/10 font-mono text-[12px] sm:grid-cols-4">
            <Cell k="Gabarit (mm)" v={state.metrics.size.map((x) => fmtNum(x, 1)).join(" × ")} />
            <Cell k="Objem" v={`${fmtNum(state.metrics.volume / 1000, 1)} cm³`} />
            <Cell k="Povrch" v={`${fmtNum(state.metrics.area / 100, 1)} cm²`} />
            <div className="bg-ink-900 p-3">
              <label className="flex items-center gap-1 text-white/40">
                Hmotnost –
                <select value={material} onChange={(e) => setMaterial(e.target.value)} className="bg-transparent text-white/70 outline-none" aria-label="Materiál">
                  {MATERIALS.map((m) => (
                    <option key={m.id} value={m.id} className="bg-ink">
                      {m.label}
                    </option>
                  ))}
                </select>
              </label>
              <p className="mt-1 text-white">{fmtNum(massKg(state.metrics.volume, density), 2)} kg</p>
            </div>
          </div>
        </>
      )}
    </div>
  );
}

function Cell({ k, v }: { k: string; v: string }) {
  return (
    <div className="bg-ink-900 p-3">
      <p className="text-white/40">{k}</p>
      <p className="mt-1 text-white">{v}</p>
    </div>
  );
}
