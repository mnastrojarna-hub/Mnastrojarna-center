"use client";

import { useEffect, useRef, useState } from "react";
import * as THREE from "three";
import { RoomEnvironment } from "three/examples/jsm/environments/RoomEnvironment.js";
import { cn } from "@/lib/cn";

/** Profil hotového dílu (poloměr, výška) — stejný díl jako v hero. */
const PROF: [number, number][] = [
  [0, -2.6], [0.62, -2.6], [0.62, -1.9], [0.8, -1.9], [0.8, -1.25], [0.72, -1.15], [0.72, -0.95],
  [1.55, -0.95], [1.62, -0.88], [1.62, -0.45], [1.55, -0.38], [1.05, -0.38], [1.05, 0.25], [0.98, 0.32],
  [0.98, 0.55], [1.12, 0.55], [1.12, 1.25], [0.98, 1.25], [0.98, 1.45], [1.12, 1.45], [1.12, 1.75],
  [0.66, 1.75], [0.66, 2.55], [0.58, 2.65], [0, 2.65],
];
const Y0 = -2.6;
const Y1 = 2.65;
const BILLET = 1.72;

function finalRadius(y: number) {
  let best = 0;
  for (let i = 0; i < PROF.length - 1; i++) {
    const [r1, y1] = PROF[i];
    const [r2, y2] = PROF[i + 1];
    if (y1 === y2) continue;
    const lo = Math.min(y1, y2);
    const hi = Math.max(y1, y2);
    if (y >= lo && y <= hi) best = Math.max(best, r1 + ((y - y1) / (y2 - y1)) * (r2 - r1));
  }
  return best;
}

export const STAGES = [
  { t: "Polotovar", d: "Tyč z konstrukční oceli. Materiál s atestem, dohledatelný až k tavbě.", machine: "Příprava materiálu", at: 0 },
  { t: "Soustružení", d: "Dvouvřetenové centrum obrobí všechny rotační plochy na jedno upnutí.", machine: "HYPERTUN 65 · Sinumerik 840D", at: 0.12 },
  { t: "5osé frézování", d: "Díry, drážky a tvarové plochy bez přeupínání – přesnost bez kompromisů.", machine: "AXILE G8 · Heidenhain iTNC640", at: 0.5 },
  { t: "Kontrola 3D sondou", d: "100% výstupní kontrola. Dvě nezávislé osoby, přesnost až 2 µm.", machine: "3D sonda · kalibrovaná měřidla", at: 0.7 },
  { t: "Měřicí protokol", d: "Díl odchází s protokolem. Dohledatelný i měsíce zpětně.", machine: "Expedice · konsignační sklad", at: 0.86 },
];

export function MachiningStory() {
  const wrap = useRef<HTMLDivElement>(null);
  const host = useRef<HTMLDivElement>(null);
  const progressRef = useRef(0);
  const [stage, setStage] = useState(0);
  const [progress, setProgress] = useState(0);

  // scroll → progres
  useEffect(() => {
    const on = () => {
      const el = wrap.current;
      if (!el) return;
      const r = el.getBoundingClientRect();
      const total = r.height - window.innerHeight;
      const p = Math.min(1, Math.max(0, -r.top / Math.max(1, total)));
      progressRef.current = p;
      setProgress(p);
      let s = 0;
      STAGES.forEach((st, i) => {
        if (p >= st.at) s = i;
      });
      setStage(s);
    };
    on();
    window.addEventListener("scroll", on, { passive: true });
    window.addEventListener("resize", on);
    return () => {
      window.removeEventListener("scroll", on);
      window.removeEventListener("resize", on);
    };
  }, []);

  // 3D scéna
  useEffect(() => {
    const el = host.current;
    if (!el) return;
    const mobile = window.matchMedia("(max-width: 768px)").matches;
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    let renderer: THREE.WebGLRenderer;
    try {
      renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    } catch {
      return;
    }
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, mobile ? 1.5 : 2));
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    el.appendChild(renderer.domElement);
    renderer.domElement.style.width = "100%";
    renderer.domElement.style.height = "100%";

    const scene = new THREE.Scene();
    const pmrem = new THREE.PMREMGenerator(renderer);
    scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    const camera = new THREE.PerspectiveCamera(30, 1, 0.1, 100);
    camera.position.set(6.5, 3.2, 9.5);
    camera.lookAt(0, 0, 0);
    const key = new THREE.DirectionalLight(0xffffff, 1.2);
    key.position.set(4, 6, 5);
    scene.add(key);

    const root = new THREE.Group();
    scene.add(root);
    const spin = new THREE.Group();
    root.add(spin);

    const SAMPLES = mobile ? 150 : 300;
    const SEG = mobile ? 56 : 112;
    const steel = new THREE.MeshPhysicalMaterial({ color: 0xb9bdc2, metalness: 0.95, roughness: 0.28, clearcoat: 0.25, envMapIntensity: 1 });
    const fresh = new THREE.MeshPhysicalMaterial({ color: 0x8e9297, metalness: 0.7, roughness: 0.55 }); // povrch polotovaru
    let partMesh: THREE.Mesh | null = null;
    let lastFront = NaN;
    const buildPart = (front: number) => {
      if (Math.abs(front - lastFront) < 1e-4) return;
      lastFront = front;
      const pts: THREE.Vector2[] = [new THREE.Vector2(0, Y0)];
      for (let i = 0; i <= SAMPLES; i++) {
        const y = Y0 + ((Y1 - Y0) * i) / SAMPLES;
        const r = y > front ? finalRadius(y) : BILLET; // nad čelem nože už obrobeno
        pts.push(new THREE.Vector2(Math.max(r, 0.001), y));
      }
      pts.push(new THREE.Vector2(0, Y1));
      const g = new THREE.LatheGeometry(pts, SEG);
      g.computeVertexNormals();
      if (partMesh) {
        partMesh.geometry.dispose();
        partMesh.geometry = g;
      } else {
        partMesh = new THREE.Mesh(g, steel);
        spin.add(partMesh);
      }
      partMesh.material = front >= Y1 - 1e-3 ? fresh : steel;
      if (front < Y1 - 1e-3 && front > Y0) partMesh.material = steel;
    };
    buildPart(Y1);

    // díry v přírubě + drážka pro pero (frézování)
    const darkMat = new THREE.MeshStandardMaterial({ color: 0x2b2829, roughness: 0.6, metalness: 0.4 });
    const holes: THREE.Mesh[] = [];
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2;
      const h = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.12, 0.6, 24), darkMat);
      h.position.set(Math.cos(a) * 1.3, -0.66, Math.sin(a) * 1.3);
      h.scale.set(1, 0.001, 1);
      h.visible = false;
      spin.add(h);
      holes.push(h);
    }
    const key2 = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.75, 0.14), darkMat);
    key2.position.set(0, 2.15, 0.62);
    key2.visible = false;
    spin.add(key2);

    // soustružnický nůž
    const tool = new THREE.Group();
    const insert = new THREE.Mesh(new THREE.ConeGeometry(0.12, 0.35, 3), new THREE.MeshStandardMaterial({ color: 0xe03930, metalness: 0.3, roughness: 0.4 }));
    insert.rotation.z = Math.PI / 2;
    const holder = new THREE.Mesh(new THREE.BoxGeometry(1.6, 0.22, 0.22), new THREE.MeshStandardMaterial({ color: 0x3a3637, metalness: 0.6, roughness: 0.4 }));
    holder.position.x = 0.95;
    tool.add(insert, holder);
    root.add(tool);

    // vřeteno frézy
    const spindle = new THREE.Group();
    const cutter = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.1, 0.7, 16), new THREE.MeshStandardMaterial({ color: 0xe03930, metalness: 0.5, roughness: 0.3 }));
    cutter.position.y = 0.35;
    const head = new THREE.Mesh(new THREE.CylinderGeometry(0.32, 0.38, 1.2, 32), new THREE.MeshStandardMaterial({ color: 0x3a3637, metalness: 0.7, roughness: 0.35 }));
    head.position.y = 1.3;
    spindle.add(cutter, head);
    spindle.visible = false;
    root.add(spindle);

    // 3D sonda
    const probe = new THREE.Group();
    const ball = new THREE.Mesh(new THREE.SphereGeometry(0.07, 16, 16), new THREE.MeshStandardMaterial({ color: 0xe03930 }));
    const stem = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.025, 1.4, 8), new THREE.MeshStandardMaterial({ color: 0x9a9b9d, metalness: 0.8 }));
    stem.position.y = 0.72;
    probe.add(ball, stem);
    probe.visible = false;
    root.add(probe);
    const probePts = [
      new THREE.Vector3(0, 2.72, 0),
      new THREE.Vector3(1.69, -0.66, 0),
      new THREE.Vector3(0, -0.31, 1.12),
      new THREE.Vector3(-1.19, 0.9, 0),
      new THREE.Vector3(0.75, -1.6, 0.4),
    ];
    const marks = probePts.map((p) => {
      const m = new THREE.Mesh(new THREE.SphereGeometry(0.055, 12, 12), new THREE.MeshBasicMaterial({ color: 0x2f9e44 }));
      m.position.copy(p);
      m.visible = false;
      root.add(m);
      return m;
    });

    // třísky
    const CH = mobile ? 60 : 140;
    const cPos = new Float32Array(CH * 3);
    const cVel = new Float32Array(CH * 3);
    const cLife = new Float32Array(CH);
    const cGeo = new THREE.BufferGeometry();
    cGeo.setAttribute("position", new THREE.BufferAttribute(cPos, 3));
    const chips = new THREE.Points(cGeo, new THREE.PointsMaterial({ color: 0xc0631c, size: 0.05, transparent: true, opacity: 0.9 }));
    root.add(chips);
    let chipIdx = 0;

    // podlahová stínová elipsa
    const shadow = new THREE.Mesh(
      new THREE.CircleGeometry(2.4, 48),
      new THREE.MeshBasicMaterial({ color: 0x272425, transparent: true, opacity: 0.07 }),
    );
    shadow.rotation.x = -Math.PI / 2;
    shadow.position.y = -2.62;
    root.add(shadow);
    root.rotation.z = 0.05;

    const resize = () => {
      const w = el.clientWidth;
      const h = el.clientHeight;
      if (!w || !h) return;
      renderer.setSize(w, h, false);
      camera.aspect = w / h;
      camera.position.setLength(w / h < 0.9 ? 22 : 16);
      camera.updateProjectionMatrix();
    };
    resize();
    const ro = new ResizeObserver(resize);
    ro.observe(el);

    let visible = false;
    const io = new IntersectionObserver(([en]) => (visible = en.isIntersecting));
    io.observe(el);

    const clock = new THREE.Clock();
    let raf = 0;
    let spinSpeed = 0.3;
    const loop = () => {
      raf = requestAnimationFrame(loop);
      const dt = Math.min(clock.getDelta(), 0.05);
      if (!visible) return;
      const p = progressRef.current;
      const t = clock.elapsedTime;

      // soustružení 0.12–0.5
      const turn = Math.min(1, Math.max(0, (p - 0.12) / 0.36));
      const front = Y1 - turn * (Y1 - Y0 + 0.02);
      buildPart(turn >= 1 ? Y0 - 0.01 : turn <= 0 ? Y1 : front);
      const turning = turn > 0 && turn < 1;
      tool.visible = turning;
      const targetSpin = turning ? 9 : p < 0.12 ? 0.35 : p < 0.5 ? 0.35 : 0.12;
      spinSpeed += (targetSpin - spinSpeed) * 0.08;
      if (!reduce) spin.rotation.y += dt * spinSpeed;
      if (turning) {
        const r = finalRadius(front);
        tool.position.set(r + 0.17, front, 0);
        // třísky
        for (let k = 0; k < 4; k++) {
          const i = chipIdx++ % CH;
          cPos.set([r + 0.05, front, 0], i * 3);
          cVel.set([0.6 + Math.random() * 1.2, 0.6 + Math.random() * 1.4, (Math.random() - 0.5) * 2.2], i * 3);
          cLife[i] = 1;
        }
      }
      for (let i = 0; i < CH; i++) {
        if (cLife[i] <= 0) {
          cPos[i * 3 + 1] = -999;
          continue;
        }
        cLife[i] -= dt * 1.4;
        cVel[i * 3 + 1] -= dt * 4;
        cPos[i * 3] += cVel[i * 3] * dt;
        cPos[i * 3 + 1] += cVel[i * 3 + 1] * dt;
        cPos[i * 3 + 2] += cVel[i * 3 + 2] * dt;
      }
      cGeo.attributes.position.needsUpdate = true;

      // frézování 0.5–0.7
      const mill = Math.min(1, Math.max(0, (p - 0.5) / 0.2));
      const nOps = holes.length + 1;
      const opF = mill * nOps;
      holes.forEach((h, i) => {
        const k = Math.min(1, Math.max(0, opF - i));
        h.visible = k > 0;
        h.scale.y = Math.max(0.001, k);
        h.position.y = -0.38 - 0.3 * k;
      });
      const keyK = Math.min(1, Math.max(0, opF - holes.length));
      key2.visible = keyK > 0;
      key2.scale.y = Math.max(0.001, keyK);
      spindle.visible = mill > 0 && mill < 1;
      if (spindle.visible) {
        const idx = Math.min(nOps - 1, Math.floor(opF));
        const local = opF - idx;
        const target = new THREE.Vector3();
        if (idx < holes.length) {
          holes[idx].getWorldPosition(target);
          target.y = -0.38;
        } else {
          key2.getWorldPosition(target);
          target.y = 2.6;
        }
        const plunge = Math.sin(local * Math.PI);
        spindle.position.set(target.x, target.y + 0.15 + (1 - plunge) * 0.9 - plunge * 0.2, target.z);
        cutter.rotation.y += dt * 40;
      }

      // kontrola 0.7–0.86
      const insp = Math.min(1, Math.max(0, (p - 0.7) / 0.16));
      probe.visible = insp > 0 && insp < 1;
      const pf = insp * probePts.length;
      marks.forEach((m, i) => (m.visible = pf > i + 0.6 || insp >= 1));
      if (probe.visible) {
        const i = Math.min(probePts.length - 1, Math.floor(pf));
        const local = pf - i;
        const touch = Math.sin(local * Math.PI);
        const pt = probePts[i];
        const dir = pt.clone().setY(0).normalize();
        const approach = i === 0 ? new THREE.Vector3(0, 1, 0) : dir.lengthSq() ? dir : new THREE.Vector3(1, 0, 0);
        probe.position.copy(pt).addScaledVector(approach, (1 - touch) * 0.8 + 0.06);
      }

      root.position.y = Math.sin(t * 0.8) * 0.04;
      renderer.render(scene, camera);
    };
    loop();

    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
      io.disconnect();
      scene.traverse((o) => (o as THREE.Mesh).geometry?.dispose?.());
      pmrem.dispose();
      renderer.dispose();
      renderer.domElement.remove();
    };
  }, []);

  return (
    <section ref={wrap} className="relative" style={{ height: "460vh" }} aria-label="Od polotovaru k měřicímu protokolu">
      <div className="paper sticky top-0 flex h-[100svh] items-center overflow-hidden">
        <div className="bg-grid-light absolute inset-0" />
        <div ref={host} className="absolute inset-0 md:left-[34%]" aria-hidden />

        <div className="container relative z-10 grid h-full grid-rows-[auto_1fr_auto] py-24 md:py-28">
          <div className="max-w-md">
            <p className="eyebrow">Jak vzniká přesný díl</p>
            <h2 className="h-display mt-4 text-4xl text-ink-700 md:text-6xl">
              Od polotovaru <span className="text-brand">k protokolu</span>
            </h2>
          </div>

          <ol className="mt-8 hidden max-w-sm self-center md:block">
            {STAGES.map((s, i) => (
              <li key={s.t} className={cn("relative border-l-2 py-3 pl-6 transition-all duration-500", i === stage ? "border-brand" : "border-ink-700/10")}>
                <span className={cn("font-mono text-[11px] tracking-widest", i <= stage ? "text-brand" : "text-ink-700/30")}>0{i + 1}</span>
                <h3 className={cn("font-display text-2xl font-bold uppercase transition-colors", i === stage ? "text-ink-700" : "text-ink-700/30")}>{s.t}</h3>
                <div className={cn("grid transition-all duration-500", i === stage ? "grid-rows-[1fr] opacity-100" : "grid-rows-[0fr] opacity-0")}>
                  <div className="overflow-hidden">
                    <p className="mt-1 text-[15px] leading-relaxed text-ink-700/65">{s.d}</p>
                    <p className="mt-2 font-mono text-[11px] uppercase tracking-widest text-ink-700/45">{s.machine}</p>
                  </div>
                </div>
              </li>
            ))}
          </ol>

          {/* mobil: aktuální krok */}
          <div className="self-end rounded-2xl border border-ink-700/10 bg-white/90 p-5 backdrop-blur md:hidden">
            <p className="font-mono text-[11px] tracking-widest text-brand">0{stage + 1} / 05</p>
            <h3 className="font-display text-2xl font-bold uppercase text-ink-700">{STAGES[stage].t}</h3>
            <p className="mt-1 text-[14px] text-ink-700/65">{STAGES[stage].d}</p>
          </div>

          <div className="hidden items-center gap-4 md:flex">
            <div className="h-px flex-1 bg-ink-700/10">
              <div className="h-px bg-brand transition-[width] duration-150" style={{ width: `${progress * 100}%` }} />
            </div>
            <span className="font-mono text-[11px] text-ink-700/45">{Math.round(progress * 100)} %</span>
          </div>
        </div>

        {/* protokol */}
        <div
          className={cn(
            "absolute bottom-8 right-6 z-10 hidden w-80 rounded-2xl border border-ink-700/10 bg-white p-5 shadow-[0_30px_60px_-30px_rgba(39,36,37,.35)] transition-all duration-700 md:block",
            stage === 4 ? "translate-y-0 opacity-100" : "pointer-events-none translate-y-6 opacity-0",
          )}
        >
          <div className="flex items-center justify-between">
            <p className="font-mono text-[11px] uppercase tracking-widest text-ink-700/50">Měřicí protokol · ukázka</p>
            <span className="rounded-full bg-emerald-50 px-2 py-0.5 text-[11px] font-semibold text-emerald-700">OK</span>
          </div>
          <table className="mt-3 w-full font-mono text-[12px]">
            <tbody>
              {[
                ["Ø 32 h6", "31,994", "✓"],
                ["Ø 162 ±0,1", "162,03", "✓"],
                ["Ø 13 H7 (8×)", "13,009", "✓"],
                ["Délka 52,6", "52,61", "✓"],
                ["Házení 0,02", "0,008", "✓"],
              ].map(([a, b, c]) => (
                <tr key={a} className="border-t border-ink-700/5">
                  <td className="py-1.5 text-ink-700/60">{a}</td>
                  <td className="py-1.5 text-right text-ink-700">{b}</td>
                  <td className="py-1.5 pl-2 text-right text-emerald-600">{c}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </section>
  );
}
