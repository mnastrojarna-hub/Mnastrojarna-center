"use client";

/**
 * Náhled modelu bez WebGL: softwarové vykreslení sítě na 2D plátno (viz `@/cad/soft-render`).
 * Tlačítka pohledů, přizpůsobení, přiblížení (tlačítka i kolečko), otáčení a posun tažením. Výběr entit kliknutím
 * zde není – slouží jen k prohlížení; zbytek programu (strom, formuláře, textové příkazy) pracuje beze změny.
 */
import { cadLocale, tr } from "@/cad/i18n";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { sectionPlane } from "@/cad/section-plane";
import { VIEW_ANGLES, basisOf, fitCamera, hexToRgb, orbitAngles, screenToWorld, softBounds, softRender, type RGB, type SoftAngles, type SoftItem, type SoftViewName } from "@/cad/soft-render";
import type { MeshData, Vec3 } from "@/cad/types";
import { cn } from "@/lib/cn";
import { setSoftView, softView, type SoftViewHandle } from "./soft-bridge";
import type { AsmView, DisplayMode, Section } from "./viewport";

/** Co se má vykreslit – stejná data, jaká dostává 3D okno. */
export type SoftScene = {
  mesh: MeshData | null;
  /** komponenty sestavy (je-li zadáno, kreslí se místo `mesh`) */
  assembly?: AsmView[];
  /** barva tělesa (#rrggbb) */
  color?: string;
  faceColors?: Record<number, string>;
  display?: DisplayMode;
  section?: Section;
  /** skryté těleso dílu */
  hidden?: boolean;
  /** tmavé pozadí pracovní plochy (světlé popisky) */
  dark?: boolean;
};

/** podíl plátna, který model po přizpůsobení zabere (zbytek je místo na tlačítka a popisky) */
const FILL = 0.78;
/** nejvyšší počet pixelů plátna – na velkých a jemných displejích se náhled kreslí v nižším rozlišení */
const MAX_PIXELS = 2_600_000;
const SEL: RGB = [224, 57, 48];
const mix = (a: RGB, b: RGB, t: number): RGB => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];

/** Sítě k vykreslení: díl (jedna síť s barvami ploch) nebo komponenty sestavy s maticemi umístění. */
export function sceneItems(sc: SoftScene): SoftItem[] {
  if (sc.assembly) {
    return sc.assembly.map((c) => {
      const base = hexToRgb(c.clash ? "#ff3b30" : c.color);
      return {
        vertices: c.mesh.vertices,
        triangles: c.mesh.triangles,
        normals: c.mesh.normals,
        lines: c.mesh.lines,
        matrix: c.matrix,
        color: c.selected ? mix(base, SEL, 0.3) : base,
        edgeColor: c.selected ? SEL : null,
        wire: !!c.dim,
      };
    });
  }
  const m = sc.mesh;
  if (!m || sc.hidden || !m.triangles.length) return [];
  const fc: Record<number, RGB> = {};
  for (const [k, v] of Object.entries(sc.faceColors ?? {})) fc[Number(k)] = hexToRgb(v);
  return [{ vertices: m.vertices, triangles: m.triangles, normals: m.normals, lines: m.lines, faceGroups: m.faceGroups, faceColors: fc, color: hexToRgb(sc.color) }];
}

/** vzhled tlačítek nad náhledem */
export const SOFT_BTN = "rounded border border-[#cfd6de] bg-white/95 px-2 py-1 text-[11.5px] font-medium text-[#26303b] shadow-sm hover:bg-[#f3f6f9]";
const SOFT_BTN_ON = "rounded border border-[#1f2933] bg-[#1f2933] px-2 py-1 text-[11.5px] font-medium text-white shadow-sm";

type Cam = { angles: SoftAngles; center: Vec3; /** CSS pixelů na milimetr */ scale: number; view: SoftViewName | "free"; fitted: boolean; radius: number };

export function SoftViewport({ scene, toolbarExtra }: { scene: SoftScene; toolbarExtra?: React.ReactNode }) {
  const box = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const triad = useRef<SVGSVGElement>(null);
  const info = useRef<HTMLSpanElement>(null);
  const cam = useRef<Cam>({ angles: VIEW_ANGLES.iso, center: [0, 0, 0], scale: 1, view: "iso", fitted: false, radius: 1 });
  const buf = useRef<{ image: ImageData | null; depth: Float32Array | null }>({ image: null, depth: null });
  const raf = useRef(0);
  /** při tažení se u velkých modelů kreslí v polovičním rozlišení, po uvolnění znovu naplno */
  const quality = useRef(1);
  /** doba posledního vykreslení v plném rozlišení (ms) */
  const fullMs = useRef(0);
  const frames = useRef(0);
  const [view, setViewName] = useState<SoftViewName | "free">("iso");

  const fcKey = JSON.stringify(scene.faceColors ?? {});
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const items = useMemo(() => sceneItems(scene), [scene.mesh, scene.assembly, scene.color, fcKey, scene.hidden]);
  const itemsRef = useRef(items);
  itemsRef.current = items;
  const sceneRef = useRef(scene);
  sceneRef.current = scene;

  const draw = useCallback(() => {
    raf.current = 0;
    const el = box.current;
    const cv = canvas.current;
    if (!el || !cv) return;
    const w = el.clientWidth;
    const h = el.clientHeight;
    if (!w || !h) return;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const ratio = Math.min(dpr, Math.sqrt(MAX_PIXELS / (w * h))) * quality.current;
    const cw = Math.max(1, Math.round(w * ratio));
    const ch = Math.max(1, Math.round(h * ratio));
    const ctx = cv.getContext("2d");
    if (!ctx) return;
    if (cv.width !== cw || cv.height !== ch || !buf.current.image) {
      cv.width = cw;
      cv.height = ch;
      buf.current = { image: ctx.createImageData(cw, ch), depth: new Float32Array(cw * ch) };
    }
    const c = cam.current;
    const sc = sceneRef.current;
    const display = sc.display ?? "shadedEdges";
    const basis = basisOf(c.angles);
    const image = buf.current.image!;
    const r = softRender({
      width: cw,
      height: ch,
      items: itemsRef.current,
      camera: { ...basis, center: c.center, scale: c.scale * (cw / w) },
      out: image.data,
      depth: buf.current.depth,
      fill: display !== "wireframe",
      edges: display !== "shaded",
      flatColor: display === "hiddenLine" ? [255, 255, 255] : null,
      edgeWidth: ratio >= 1.5 ? 2 : 1,
      clip: sc.section ? sectionPlane(sc.section) : null,
    });
    ctx.putImageData(image, 0, 0);
    if (quality.current === 1) fullMs.current = r.ms;
    frames.current++;
    cv.dataset.frame = String(frames.current);
    cv.dataset.tris = String(r.triangles);
    cv.dataset.ms = r.ms.toFixed(1);
    cv.dataset.view = c.view;
    if (info.current) info.current.textContent = r.triangles ? tr("Softwarový náhled · {0} trojúhelníků · {1} ms", r.triangles.toLocaleString(cadLocale()), Math.max(1, Math.round(r.ms))) : "";
    const t = triad.current;
    if (t) {
      [0, 1, 2].forEach((i) => {
        const x = basis.right[i];
        const y = basis.up[i];
        const line = t.querySelector<SVGLineElement>(`[data-ax="${i}"]`);
        const lab = t.querySelector<SVGTextElement>(`[data-lab="${i}"]`);
        line?.setAttribute("x2", String(36 + x * 26));
        line?.setAttribute("y2", String(36 - y * 26));
        lab?.setAttribute("x", String(36 + x * 32));
        lab?.setAttribute("y", String(39 - y * 32));
      });
    }
  }, []);
  const schedule = useCallback(() => {
    if (!raf.current) raf.current = requestAnimationFrame(draw);
  }, [draw]);

  /** vejde model do plátna; s `v` zároveň nastaví pojmenovaný pohled */
  const fit = useCallback(
    (v?: SoftViewName) => {
      const el = box.current;
      const c = cam.current;
      if (v) {
        c.angles = VIEW_ANGLES[v];
        c.view = v;
        setViewName(v);
      }
      if (el && el.clientWidth && el.clientHeight) {
        const f = fitCamera(itemsRef.current, basisOf(c.angles), el.clientWidth, el.clientHeight, FILL);
        c.center = f.center;
        c.scale = f.scale;
      }
      schedule();
    },
    [schedule],
  );
  /** přiblížení kolem bodu plátna (CSS pixely); bez bodu kolem středu */
  const zoom = useCallback(
    (factor: number, at?: { x: number; y: number }) => {
      const el = box.current;
      const c = cam.current;
      if (!el) return;
      const w = el.clientWidth;
      const h = el.clientHeight;
      const next = Math.max(1e-6, Math.min(1e6, c.scale * factor));
      if (at) {
        const b = basisOf(c.angles);
        const p = screenToWorld({ ...b, center: c.center, scale: c.scale }, w, h, at.x, at.y);
        const rx = (at.x - w / 2) / next;
        const uy = -(at.y - h / 2) / next;
        c.center = [p[0] - b.right[0] * rx - b.up[0] * uy, p[1] - b.right[1] * rx - b.up[1] * uy, p[2] - b.right[2] * rx - b.up[2] * uy];
      }
      c.scale = next;
      schedule();
    },
    [schedule],
  );

  // model: první zobrazení a výrazná změna velikosti → izometrie na celé plátno (stejně jako 3D okno); jinak se pohled drží
  useEffect(() => {
    const b = softBounds(items);
    const c = cam.current;
    if (b) {
      const changed = Math.abs(b.radius - c.radius) / c.radius > 0.6;
      c.radius = b.radius;
      if (!c.fitted || changed) {
        c.fitted = true;
        fit("iso");
        return;
      }
    }
    schedule();
  }, [items, fit, schedule]);
  const secKey = scene.section ? JSON.stringify(sectionPlane(scene.section)) : "";
  useEffect(schedule, [scene.display, secKey, schedule]);

  // velikost plátna
  useEffect(() => {
    const el = box.current;
    if (!el) return;
    let had = el.clientWidth > 0 && el.clientHeight > 0;
    const ro = new ResizeObserver(() => {
      const has = el.clientWidth > 0 && el.clientHeight > 0;
      if (has && !had && cam.current.fitted) fit();
      else schedule();
      had = has;
    });
    ro.observe(el);
    return () => {
      ro.disconnect();
      if (raf.current) cancelAnimationFrame(raf.current);
      raf.current = 0;
    };
  }, [fit, schedule]);

  // myš a dotyk: tažení otáčí (Shift, prostřední nebo pravé tlačítko posouvá), kolečko a dva prsty přibližují
  useEffect(() => {
    const cv = canvas.current;
    if (!cv) return;
    const pts = new Map<number, { x: number; y: number }>();
    let pan = false;
    let settle: ReturnType<typeof setTimeout> | null = null;
    const local = (e: PointerEvent | WheelEvent) => {
      const r = cv.getBoundingClientRect();
      return { x: e.clientX - r.left, y: e.clientY - r.top };
    };
    const moving = () => {
      quality.current = fullMs.current > 45 ? 0.5 : 1;
      if (settle) clearTimeout(settle);
      settle = setTimeout(() => {
        settle = null;
        if (quality.current !== 1) {
          quality.current = 1;
          schedule();
        }
      }, 160);
    };
    const onDown = (e: PointerEvent) => {
      pts.set(e.pointerId, local(e));
      pan = e.shiftKey || e.button === 1 || e.button === 2;
      cv.setPointerCapture?.(e.pointerId);
    };
    // prostřední tlačítko: bez automatického posouvání stránky
    const onMouseDown = (e: MouseEvent) => {
      if (e.button === 1) e.preventDefault();
    };
    const onMove = (e: PointerEvent) => {
      const prev = pts.get(e.pointerId);
      if (!prev) return;
      const p = local(e);
      const c = cam.current;
      if (pts.size >= 2) {
        // dva prsty: změna rozteče přibližuje, posun středu posouvá
        const other = [...pts.entries()].find(([id]) => id !== e.pointerId)![1];
        const d0 = Math.hypot(prev.x - other.x, prev.y - other.y);
        const d1 = Math.hypot(p.x - other.x, p.y - other.y);
        const mid = { x: (p.x + other.x) / 2, y: (p.y + other.y) / 2 };
        const b = basisOf(c.angles);
        const dx = (p.x - prev.x) / 2 / c.scale;
        const dy = (p.y - prev.y) / 2 / c.scale;
        c.center = [c.center[0] - b.right[0] * dx + b.up[0] * dy, c.center[1] - b.right[1] * dx + b.up[1] * dy, c.center[2] - b.right[2] * dx + b.up[2] * dy];
        pts.set(e.pointerId, p);
        moving();
        if (d0 > 2 && d1 > 2) zoom(d1 / d0, mid);
        else schedule();
        return;
      }
      const dx = p.x - prev.x;
      const dy = p.y - prev.y;
      pts.set(e.pointerId, p);
      if (!dx && !dy) return;
      if (pan) {
        const b = basisOf(c.angles);
        c.center = [c.center[0] - (b.right[0] * dx - b.up[0] * dy) / c.scale, c.center[1] - (b.right[1] * dx - b.up[1] * dy) / c.scale, c.center[2] - (b.right[2] * dx - b.up[2] * dy) / c.scale];
      } else {
        c.angles = orbitAngles(c.angles, -dx * 0.008, dy * 0.008);
        if (c.view !== "free") {
          c.view = "free";
          setViewName("free");
        }
      }
      moving();
      schedule();
    };
    const onUp = (e: PointerEvent) => {
      pts.delete(e.pointerId);
      if (cv.hasPointerCapture?.(e.pointerId)) cv.releasePointerCapture(e.pointerId);
    };
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const unit = e.deltaMode === 1 ? 33 : e.deltaMode === 2 ? 400 : 1;
      moving();
      zoom(Math.exp(-e.deltaY * unit * 0.0015), local(e));
    };
    const onCtx = (e: Event) => e.preventDefault();
    cv.addEventListener("pointerdown", onDown);
    cv.addEventListener("mousedown", onMouseDown);
    cv.addEventListener("pointermove", onMove);
    cv.addEventListener("pointerup", onUp);
    cv.addEventListener("pointercancel", onUp);
    cv.addEventListener("wheel", onWheel, { passive: false });
    cv.addEventListener("contextmenu", onCtx);
    return () => {
      if (settle) clearTimeout(settle);
      cv.removeEventListener("pointerdown", onDown);
      cv.removeEventListener("mousedown", onMouseDown);
      cv.removeEventListener("pointermove", onMove);
      cv.removeEventListener("pointerup", onUp);
      cv.removeEventListener("pointercancel", onUp);
      cv.removeEventListener("wheel", onWheel);
      cv.removeEventListener("contextmenu", onCtx);
    };
  }, [schedule, zoom]);

  // převzetí ovládání 3D okna (pás karet, klávesy, textové příkazy, náhledy nedávných souborů)
  useEffect(() => {
    const handle: SoftViewHandle = {
      setView: (v) => fit(v),
      fit: () => fit(),
      snapshot: () => {
        const cv = canvas.current;
        if (!cv || !itemsRef.current.length) return null;
        if (raf.current) cancelAnimationFrame(raf.current);
        quality.current = 1;
        draw();
        try {
          return cv.toDataURL("image/png");
        } catch {
          return null;
        }
      },
      bounds: () => {
        const b = softBounds(itemsRef.current);
        return b ? { center: b.center, radius: b.radius } : { center: [0, 0, 0], radius: 100 };
      },
    };
    setSoftView(handle);
    return () => {
      if (softView.current === handle) setSoftView(null);
    };
  }, [fit, draw]);

  const views: { v: SoftViewName; label: string }[] = [
    { v: "iso", label: tr("Izometrie") },
    { v: "front", label: tr("Přední") },
    { v: "back", label: tr("Zadní") },
    { v: "top", label: tr("Horní") },
    { v: "bottom", label: tr("Spodní") },
    { v: "left", label: tr("Levý") },
    { v: "right", label: tr("Pravý") },
  ];
  const btn = SOFT_BTN;
  return (
    <div ref={box} data-soft-viewport className="absolute inset-0 overflow-hidden">
      <canvas ref={canvas} data-soft-canvas className="absolute inset-0 h-full w-full cursor-grab touch-none select-none active:cursor-grabbing" aria-label={tr("Náhled modelu bez WebGL")} role="img" />
      {!items.length && (
        <p className={cn("pointer-events-none absolute inset-x-6 top-1/2 -translate-y-1/2 text-center text-[13px]", scene.dark ? "text-white/70" : "text-[#5b6776]")}>
          {scene.hidden ? tr("Těleso je skryté.") : tr("Model je zatím prázdný – po vytvoření tělesa se tu zobrazí jeho náhled.")}
        </p>
      )}
      {/* pohledy, přizpůsobení, přiblížení */}
      <div data-soft-toolbar className="pointer-events-none absolute left-14 right-3 top-3 z-10 flex flex-wrap items-center justify-end gap-1 lg:left-[300px] [&>*]:pointer-events-auto">
        {views.map((x) => (
          <button key={x.v} type="button" data-soft-view={x.v} aria-pressed={view === x.v} onClick={() => fit(x.v)} title={tr("Pohled: {0}", x.label)} className={view === x.v ? SOFT_BTN_ON : btn}>
            {x.label}
          </button>
        ))}
        <span className="mx-0.5 h-5 w-px bg-[#b9c3cd]" aria-hidden />
        <button type="button" data-soft-fit onClick={() => fit()} title={tr("Vejít celý model do okna (F)")} className={btn}>
          {tr("Přizpůsobit")}
        </button>
        <button type="button" data-soft-zoom="out" onClick={() => zoom(1 / 1.25)} title={tr("Oddálit")} aria-label={tr("Oddálit")} className={cn(btn, "w-7 px-0 text-center font-mono text-[13px] leading-[1.15]")}>
          −
        </button>
        <button type="button" data-soft-zoom="in" onClick={() => zoom(1.25)} title={tr("Přiblížit")} aria-label={tr("Přiblížit")} className={cn(btn, "w-7 px-0 text-center font-mono text-[13px] leading-[1.15]")}>
          +
        </button>
        {toolbarExtra}
      </div>
      {/* osový kříž */}
      <svg ref={triad} viewBox="0 0 72 72" className="pointer-events-none absolute bottom-10 left-3 h-[72px] w-[72px]" aria-hidden>
        {["#E03930", "#16A34A", "#2563EB"].map((c, i) => (
          <g key={i}>
            <line data-ax={i} x1="36" y1="36" x2="36" y2="36" stroke={c} strokeWidth="2.2" strokeLinecap="round" />
            <text data-lab={i} x="36" y="36" fontSize="10" fontWeight="700" fill={c} textAnchor="middle" fontFamily="Roboto, Arial">
              {"XYZ"[i]}
            </text>
          </g>
        ))}
      </svg>
      <span ref={info} data-soft-info className={cn("pointer-events-none absolute bottom-9 right-3 font-mono text-[10px]", scene.dark ? "text-white/60" : "text-[#5b6776]")} />
    </div>
  );
}
