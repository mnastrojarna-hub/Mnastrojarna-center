"use client";

import { useEffect, useRef } from "react";
import * as THREE from "three";
import { RoomEnvironment } from "three/examples/jsm/environments/RoomEnvironment.js";
import { EffectComposer } from "three/examples/jsm/postprocessing/EffectComposer.js";
import { RenderPass } from "three/examples/jsm/postprocessing/RenderPass.js";
import { UnrealBloomPass } from "three/examples/jsm/postprocessing/UnrealBloomPass.js";
import { OutputPass } from "three/examples/jsm/postprocessing/OutputPass.js";

/**
 * Hero 3D scéna: obráběný díl (stupňovitá hřídel s přírubou) z leštěné oceli,
 * kolem kterého „fréza“ kreslí zářící dráhu nástroje. Červené hrany = korporátní barva.
 * Respektuje prefers-reduced-motion, pauzuje mimo obrazovku a na skryté záložce.
 */
export default function HeroScene({ className }: { className?: string }) {
  const host = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = host.current;
    if (!el) return;
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const mobile = window.matchMedia("(max-width: 768px)").matches;

    let renderer: THREE.WebGLRenderer;
    try {
      renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, powerPreference: "high-performance" });
    } catch {
      return; // bez WebGL zůstane jen statické pozadí
    }
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, mobile ? 1.5 : 2));
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 0.9;
    renderer.setClearColor(0x000000, 0);
    el.appendChild(renderer.domElement);
    renderer.domElement.style.opacity = "0";
    renderer.domElement.style.transition = "opacity 1.6s ease";

    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x0f0e0e);
    scene.fog = new THREE.Fog(0x0f0e0e, 12, 26);
    const pmrem = new THREE.PMREMGenerator(renderer);
    const envTex = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    scene.environment = envTex;

    const camera = new THREE.PerspectiveCamera(32, 1, 0.1, 100);
    camera.position.set(0, 0.6, 11);

    const root = new THREE.Group();
    scene.add(root);

    // --- Obráběný díl (rotační profil: poloměr, výška) ---
    const prof: [number, number][] = [
      [0, -2.6], [0.62, -2.6], [0.62, -1.9], [0.8, -1.9], [0.8, -1.25], [0.72, -1.15], [0.72, -0.95],
      [1.55, -0.95], [1.62, -0.88], [1.62, -0.45], [1.55, -0.38], [1.05, -0.38], [1.05, 0.25], [0.98, 0.32],
      [0.98, 0.55], [1.12, 0.55], [1.12, 1.25], [0.98, 1.25], [0.98, 1.45], [1.12, 1.45], [1.12, 1.75],
      [0.66, 1.75], [0.66, 2.55], [0.58, 2.65], [0, 2.65],
    ];
    const lathe = new THREE.LatheGeometry(prof.map(([r, y]) => new THREE.Vector2(r, y)), mobile ? 72 : 128);
    lathe.computeVertexNormals();
    const steel = new THREE.MeshPhysicalMaterial({
      color: 0x9a9ea3,
      metalness: 1,
      roughness: 0.3,
      clearcoat: 0.3,
      clearcoatRoughness: 0.35,
      envMapIntensity: 0.85,
    });
    const part = new THREE.Mesh(lathe, steel);
    root.add(part);

    // Otvory v přírubě (tmavé zahloubení) + drážka pera
    const holeGeo = new THREE.CylinderGeometry(0.11, 0.11, 0.6, 24);
    const holeMat = new THREE.MeshStandardMaterial({ color: 0x0c0b0b, metalness: 0.6, roughness: 0.6 });
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2;
      const h = new THREE.Mesh(holeGeo, holeMat);
      h.position.set(Math.cos(a) * 1.3, -0.66, Math.sin(a) * 1.3);
      h.scale.y = 0.75;
      root.add(h);
    }
    const key = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.75, 0.12), holeMat);
    key.position.set(0, 2.15, 0.62);
    root.add(key);

    // Červené ostré hrany (feature lines)
    const edges = new THREE.LineSegments(
      new THREE.EdgesGeometry(lathe, 35),
      new THREE.LineBasicMaterial({ color: 0xff3b30, transparent: true, opacity: 0.85 }),
    );
    edges.scale.setScalar(1.002);
    root.add(edges);

    // --- Dráha nástroje (šroubovice kolem dílu), vykreslovaná postupně ---
    const turns = 9;
    const N = 900;
    const pathPts: THREE.Vector3[] = [];
    for (let i = 0; i <= N; i++) {
      const t = i / N;
      const a = t * Math.PI * 2 * turns;
      const y = -2.3 + t * 4.6;
      const r = 1.95 + Math.sin(t * Math.PI) * 0.35;
      pathPts.push(new THREE.Vector3(Math.cos(a) * r, y, Math.sin(a) * r));
    }
    const pathGeo = new THREE.BufferGeometry().setFromPoints(pathPts);
    const pathMat = new THREE.LineBasicMaterial({ color: 0xff4a3d, transparent: true, opacity: 0.9 });
    const toolPath = new THREE.Line(pathGeo, pathMat);
    pathGeo.setDrawRange(0, 0);
    root.add(toolPath);

    // Hlavička nástroje = zářící bod
    const tip = new THREE.Mesh(new THREE.SphereGeometry(0.06, 16, 16), new THREE.MeshBasicMaterial({ color: 0xffd2c9 }));
    root.add(tip);
    const tipHalo = new THREE.Sprite(
      new THREE.SpriteMaterial({ map: makeGlowTexture(), color: 0xff4a3d, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false }),
    );
    tipHalo.scale.setScalar(0.9);
    root.add(tipHalo);

    // Jiskry / třísky
    const SP = mobile ? 90 : 180;
    const spPos = new Float32Array(SP * 3);
    const spVel = new Float32Array(SP * 3);
    const spLife = new Float32Array(SP);
    const spGeo = new THREE.BufferGeometry();
    spGeo.setAttribute("position", new THREE.BufferAttribute(spPos, 3));
    const sparks = new THREE.Points(
      spGeo,
      new THREE.PointsMaterial({ color: 0xff6a4d, size: 0.045, transparent: true, opacity: 0.9, blending: THREE.AdditiveBlending, depthWrite: false }),
    );
    root.add(sparks);

    // Prachové částice v prostoru
    const DUST = mobile ? 160 : 320;
    const dPos = new Float32Array(DUST * 3);
    for (let i = 0; i < DUST; i++) {
      dPos[i * 3] = (Math.random() - 0.5) * 18;
      dPos[i * 3 + 1] = (Math.random() - 0.5) * 10;
      dPos[i * 3 + 2] = (Math.random() - 0.5) * 8 - 2;
    }
    const dGeo = new THREE.BufferGeometry();
    dGeo.setAttribute("position", new THREE.BufferAttribute(dPos, 3));
    const dust = new THREE.Points(dGeo, new THREE.PointsMaterial({ color: 0xffffff, size: 0.018, transparent: true, opacity: 0.35, depthWrite: false }));
    scene.add(dust);

    // Kruhové „měřicí“ prstence
    const ringMat = new THREE.LineBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.12 });
    for (const [r, y] of [[2.6, -0.65], [3.2, -0.65]] as const) {
      const pts = Array.from({ length: 129 }, (_, i) => {
        const a = (i / 128) * Math.PI * 2;
        return new THREE.Vector3(Math.cos(a) * r, y, Math.sin(a) * r);
      });
      root.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts), ringMat));
    }

    // Světla (doplněk k env mapě): červený protisvit pro siluetu
    const rim = new THREE.PointLight(0xff3b30, 30, 20);
    rim.position.set(-4, 2, -3);
    scene.add(rim);
    const keyL = new THREE.DirectionalLight(0xffffff, 1.2);
    keyL.position.set(4, 5, 6);
    scene.add(keyL);

    root.rotation.set(0.32, 0, -0.38);
    root.position.set(3, 0, 0);

    // Postprocessing (bloom) — na mobilu vypnuto kvůli výkonu
    let composer: EffectComposer | null = null;
    if (!mobile) {
      composer = new EffectComposer(renderer);
      composer.addPass(new RenderPass(scene, camera));
      composer.addPass(new UnrealBloomPass(new THREE.Vector2(1, 1), 0.38, 0.45, 0.9));
      composer.addPass(new OutputPass());
    }

    let baseX = 3;
    let baseY = 0;
    const resize = () => {
      const w = el.clientWidth;
      const h = el.clientHeight;
      if (!w || !h) return;
      renderer.setSize(w, h, false);
      renderer.domElement.style.width = "100%";
      renderer.domElement.style.height = "100%";
      composer?.setSize(w, h);
      camera.aspect = w / h;
      // desktop: díl vpravo vedle textu; mobil: menší, za textem vpravo dole
      const narrow = w / h < 0.9;
      camera.position.z = narrow ? 17 : 13;
      baseX = narrow ? 1.6 : w / h > 1.5 ? 3.1 : 2.2;
      baseY = narrow ? -2.2 : 0;
      root.position.set(baseX, baseY, 0);
      camera.updateProjectionMatrix();
    };
    resize();
    const ro = new ResizeObserver(resize);
    ro.observe(el);

    const pointer = { x: 0, y: 0, tx: 0, ty: 0 };
    const onPointer = (e: PointerEvent) => {
      pointer.tx = (e.clientX / window.innerWidth) * 2 - 1;
      pointer.ty = (e.clientY / window.innerHeight) * 2 - 1;
    };
    window.addEventListener("pointermove", onPointer, { passive: true });

    let visible = true;
    const io = new IntersectionObserver(([en]) => (visible = en.isIntersecting), { threshold: 0 });
    io.observe(el);

    const clock = new THREE.Clock();
    let progress = reduce ? 1 : 0;
    let spawnIdx = 0;
    let raf = 0;
    let first = true;
    const tmp = new THREE.Vector3();

    const frame = () => {
      raf = requestAnimationFrame(frame);
      if (!visible || document.hidden) {
        clock.getDelta();
        return;
      }
      const dt = Math.min(clock.getDelta(), 0.05);
      const t = clock.elapsedTime;

      if (!reduce) {
        root.rotation.y += dt * 0.22;
        pointer.x += (pointer.tx - pointer.x) * 0.04;
        pointer.y += (pointer.ty - pointer.y) * 0.04;
        root.rotation.x = 0.32 + pointer.y * 0.12;
        root.rotation.z = -0.38 + pointer.x * 0.08;
        root.position.y = baseY + Math.sin(t * 0.6) * 0.08;
        root.position.x = baseX;
        progress = (progress + dt * 0.075) % 1.15;
      }
      const p = Math.min(progress, 1);
      const count = Math.max(2, Math.floor(p * N));
      pathGeo.setDrawRange(0, count);
      pathMat.opacity = progress > 1 ? Math.max(0, 1 - (progress - 1) * 6.6) * 0.9 : 0.9;
      const head = pathPts[Math.min(count, N)];
      tip.position.copy(head);
      tipHalo.position.copy(head);
      tipHalo.material.opacity = 0.75 + Math.sin(t * 20) * 0.2;

      // jiskry z hlavičky nástroje
      if (!reduce && progress <= 1) {
        for (let k = 0; k < 3; k++) {
          const i = spawnIdx++ % SP;
          spPos[i * 3] = head.x;
          spPos[i * 3 + 1] = head.y;
          spPos[i * 3 + 2] = head.z;
          tmp.set(head.x, 0, head.z).normalize();
          spVel[i * 3] = tmp.x * (0.6 + Math.random()) + (Math.random() - 0.5) * 0.8;
          spVel[i * 3 + 1] = Math.random() * 1.2 - 0.2;
          spVel[i * 3 + 2] = tmp.z * (0.6 + Math.random()) + (Math.random() - 0.5) * 0.8;
          spLife[i] = 1;
        }
      }
      for (let i = 0; i < SP; i++) {
        if (spLife[i] <= 0) {
          spPos[i * 3 + 1] = -999;
          continue;
        }
        spLife[i] -= dt * 1.6;
        spVel[i * 3 + 1] -= dt * 2.4;
        spPos[i * 3] += spVel[i * 3] * dt;
        spPos[i * 3 + 1] += spVel[i * 3 + 1] * dt;
        spPos[i * 3 + 2] += spVel[i * 3 + 2] * dt;
      }
      spGeo.attributes.position.needsUpdate = true;
      dust.rotation.y = t * 0.01;

      if (composer) composer.render();
      else renderer.render(scene, camera);
      if (first) {
        first = false;
        renderer.domElement.style.opacity = "1";
      }
    };
    frame();

    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
      io.disconnect();
      window.removeEventListener("pointermove", onPointer);
      scene.traverse((o) => {
        const m = o as THREE.Mesh;
        m.geometry?.dispose?.();
        const mat = m.material as THREE.Material | THREE.Material[] | undefined;
        if (Array.isArray(mat)) mat.forEach((x) => x.dispose());
        else mat?.dispose?.();
      });
      envTex.dispose();
      pmrem.dispose();
      composer?.dispose();
      renderer.dispose();
      renderer.domElement.remove();
    };
  }, []);

  return <div ref={host} className={className} aria-hidden />;
}

function makeGlowTexture() {
  const c = document.createElement("canvas");
  c.width = c.height = 64;
  const g = c.getContext("2d")!;
  const grd = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  grd.addColorStop(0, "rgba(255,255,255,1)");
  grd.addColorStop(0.3, "rgba(255,120,100,.6)");
  grd.addColorStop(1, "rgba(255,60,48,0)");
  g.fillStyle = grd;
  g.fillRect(0, 0, 64, 64);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}
