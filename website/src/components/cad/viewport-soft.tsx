"use client";

/**
 * Náhled modelu bez WebGL: softwarové vykreslení sítě na 2D plátno (viz `@/cad/soft-render`).
 * Tlačítka pohledů, přizpůsobení, přiblížení (tlačítka i kolečko), otáčení a posun tažením.
 * Výběr ploch, hran a vrcholů kliknutím (`@/cad/soft-pick`) se stejnými vlastnostmi a událostmi jako 3D okno
 * (`SoftPickProps` – režim a filtr výběru, Ctrl/Shift přidá / odebere, výběr pro formuláře prvků, měření, vazby
 * sestav, kontextová nabídka), zvýraznění pod kurzorem a vybraných entit, popisky entit (F1 / E2 / V3).
 */
import { cadLocale, tr } from "@/cad/i18n";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { sectionPlane } from "@/cad/section-plane";
import { fitSoftCam, newSoftCam, softCamOnModel, type SoftCam } from "@/cad/soft-cam";
import { buildPickIndex, edgeNear, edgeSnaps, itemEdgePolyline, pickAt, snapNear, softHintSteps, surfaceAt, type PickItem, type SoftHint, type SoftPickIndex } from "@/cad/soft-pick";
import { basisOf, hexToRgb, orbitAngles, screenToWorld, softBounds, softRender, type RGB, type SoftViewName } from "@/cad/soft-render";
import type { MeshData, Vec3 } from "@/cad/types";
import { cn } from "@/lib/cn";
import { selKey, sameSel, type SelFilter, type SelItem } from "./selection";
import { setSoftView, softView, type SoftPickProps, type SoftViewHandle } from "./soft-bridge";
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
/** barvy výběru a zvýraznění pod kurzorem (shodné se 3D oknem) */
const SEL: RGB = [224, 57, 48];
const HOVER: RGB = [245, 158, 11];
const SEL_CSS = "#e03930";
const HOVER_CSS = "#f59e0b";
const SNAP_CSS = "#0284c7";
/** zvýraznění plochy pod kurzorem znamená překreslení celého náhledu – u pomalých modelů (ms na snímek) jen hrany a body */
const HOVER_FACE_MAX_MS = 60;
/** index výběru, jehož sestavení trvá déle (ms), se při otáčení / přibližování nestaví na každý pohyb myši – až po zastavení */
const SLOW_INDEX_MS = 16;
/** popisky entit se počítají po dávkách této délky (ms) mezi snímky – velký model nezamrzne */
const HINT_SLICE_MS = 10;
const mix = (a: RGB, b: RGB, t: number): RGB => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
const round3 = (v: number) => Math.round(v * 1000) / 1000;
const LEGACY = new Set(["edges", "faces", "face-plane"]);

/** Sítě k vykreslení a výběru: díl (jedna síť s barvami ploch) nebo komponenty sestavy s maticemi umístění. */
export function sceneItems(sc: SoftScene, points?: Float32Array | null): PickItem[] {
  if (sc.assembly) {
    return sc.assembly.map((c) => {
      const base = hexToRgb(c.clash ? "#ff3b30" : c.color);
      return {
        vertices: c.mesh.vertices,
        triangles: c.mesh.triangles,
        normals: c.mesh.normals,
        lines: c.mesh.lines,
        faceGroups: c.mesh.faceGroups,
        edgeGroups: c.mesh.edgeGroups,
        points: c.vertices ?? null,
        matrix: c.matrix,
        color: c.selected ? mix(base, SEL, 0.3) : base,
        edgeColor: c.selected ? SEL : null,
        wire: !!c.dim,
        compId: c.id,
        topId: c.topId ?? c.id,
      };
    });
  }
  const m = sc.mesh;
  if (!m || sc.hidden || !m.triangles.length) return [];
  const fc: Record<number, RGB> = {};
  for (const [k, v] of Object.entries(sc.faceColors ?? {})) fc[Number(k)] = hexToRgb(v);
  return [{ vertices: m.vertices, triangles: m.triangles, normals: m.normals, lines: m.lines, faceGroups: m.faceGroups, edgeGroups: m.edgeGroups, points: points ?? null, faceColors: fc, color: hexToRgb(sc.color) }];
}

/** Zvýraznění ploch, těles a komponent (výběr, entita pod kurzorem, plochy formuláře) – barvy ploch a sítí. */
type FaceMarks = { sel: SelItem[]; hover: SelItem | null; faces: number[]; hoverFace: number };
function highlightItems(items: PickItem[], hl: FaceMarks): PickItem[] {
  const faceMarks = new Map<string, Map<number, [RGB, number]>>();
  const bodyMarks = new Map<string, RGB>();
  const markFace = (comp: string, f: number, col: RGB, t: number) => {
    let m = faceMarks.get(comp);
    if (!m) faceMarks.set(comp, (m = new Map()));
    if (!m.has(f)) m.set(f, [col, t]);
  };
  const mark = (it: SelItem, col: RGB) => {
    if (it.kind === "face") markFace(it.compId ?? "", it.index, col, 0.55);
    else if (it.kind === "body" && !bodyMarks.has(it.compId ?? "")) bodyMarks.set(it.compId ?? "", col);
    else if (it.kind === "component" && !bodyMarks.has(it.compId)) bodyMarks.set(it.compId, col);
  };
  for (const f of hl.faces) markFace("", f, SEL, 0.85);
  for (const s of hl.sel) mark(s, SEL);
  if (hl.hoverFace >= 0) markFace("", hl.hoverFace, HOVER, 0.85);
  if (hl.hover && !hl.sel.some((s) => sameSel(s, hl.hover!))) mark(hl.hover, HOVER);
  if (!faceMarks.size && !bodyMarks.size) return items;
  return items.map((it) => {
    const key = it.compId ?? "";
    const fm = faceMarks.get(key);
    const bm = bodyMarks.get(key) ?? (it.topId ? bodyMarks.get(it.topId) : undefined);
    if (!fm && !bm) return it;
    const color = bm ? mix(it.color, bm, 0.35) : it.color;
    const faceColors: Record<number, RGB> = {};
    for (const [k, v] of Object.entries(it.faceColors ?? {})) faceColors[Number(k)] = bm ? mix(v, bm, 0.35) : v;
    for (const [f, [col, t]] of fm ?? []) faceColors[f] = mix(faceColors[f] ?? color, col, t);
    return { ...it, color, faceColors };
  });
}

/** vzhled tlačítek nad náhledem */
export const SOFT_BTN = "rounded border border-[#cfd6de] bg-white/95 px-2 py-1 text-[11.5px] font-medium text-[#26303b] shadow-sm hover:bg-[#f3f6f9]";
const SOFT_BTN_ON = "rounded border border-[#1f2933] bg-[#1f2933] px-2 py-1 text-[11.5px] font-medium text-white shadow-sm";

type Snap = { item: SelItem; point: Vec3 };

export function SoftViewport({ scene, toolbarExtra, pick }: { scene: SoftScene; toolbarExtra?: React.ReactNode; pick?: SoftPickProps | null }) {
  const box = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const overlay = useRef<HTMLCanvasElement>(null);
  const labels = useRef<HTMLDivElement>(null);
  const triad = useRef<SVGSVGElement>(null);
  const info = useRef<HTMLSpanElement>(null);
  const cam = useRef<SoftCam>(newSoftCam());
  const buf = useRef<{ image: ImageData | null; depth: Float32Array | null }>({ image: null, depth: null });
  const raf = useRef(0);
  const rafOv = useRef(0);
  /** při tažení se u velkých modelů kreslí v polovičním rozlišení, po uvolnění znovu naplno */
  const quality = useRef(1);
  /** doba posledního vykreslení v plném rozlišení (ms) */
  const fullMs = useRef(0);
  const frames = useRef(0);
  const [view, setViewName] = useState<SoftViewName | "free">("iso");

  // ---------- výběr: vlastnosti 3D okna, entita pod kurzorem, body k uchopení ----------
  const pickRef = useRef(pick ?? null);
  pickRef.current = pick ?? null;
  const [hover, setHover] = useState<SelItem | null>(null);
  /** formuláře prvků (hrany zaoblení, plochy skořepiny, plocha skici): plocha / hrana pod kurzorem */
  const [lhover, setLhover] = useState<{ face: number; edge: number }>({ face: -1, edge: -1 });
  const hoverRef = useRef(hover);
  hoverRef.current = hover;
  const lhoverRef = useRef(lhover);
  lhoverRef.current = lhover;
  const snaps = useRef<{ key: string; list: Snap[] }>({ key: "", list: [] });
  const pix = useRef<{ key: string; items: PickItem[]; ix: SoftPickIndex } | null>(null);
  const [hintList, setHintList] = useState<SoftHint[]>([]);
  /** popisky pro index snímku; `blocked` = zkoušená místa zakrytá jiným prvkem stránky (x, y po dvojicích) */
  const hintsRef = useRef<{ ix: SoftPickIndex | null; list: SoftHint[]; blocked: number[] }>({ ix: null, list: [], blocked: [] });
  /** rozpracovaný výpočet popisků (po dávkách) */
  const hintJob = useRef<{ ix: SoftPickIndex; gen: Generator<void, SoftHint[], void>; blocked: number[]; timer: ReturnType<typeof setTimeout> | null } | null>(null);

  const fcKey = JSON.stringify(scene.faceColors ?? {});
  const points = pick?.vertices ?? null;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const baseItems = useMemo(() => sceneItems(scene, points), [scene.mesh, scene.assembly, scene.color, fcKey, scene.hidden, points]);
  const baseRef = useRef(baseItems);
  baseRef.current = baseItems;
  const pickMode = pick?.pickMode ?? "none";
  const legacy = LEGACY.has(pickMode);
  const sel = useMemo(() => pick?.selection ?? [], [pick?.selection]);
  const selFaces = legacy ? (pick?.selectedFaces ?? []) : [];
  const hoverFaceOk = !!hover && (hover.kind === "face" || hover.kind === "body" || hover.kind === "component");
  const faceKey = [sel.filter((s) => s.kind === "face" || s.kind === "body" || s.kind === "component").map(selKey).join(","), selFaces.join(","), legacy && pickMode !== "edges" ? lhover.face : -1, hoverFaceOk ? selKey(hover!) : ""].join("|");
  const items = useMemo(
    () => highlightItems(baseItems, { sel, hover: hoverFaceOk ? hover : null, faces: selFaces, hoverFace: legacy && pickMode !== "edges" ? lhover.face : -1 }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [baseItems, faceKey],
  );
  const itemsRef = useRef(items);
  itemsRef.current = items;
  const sceneRef = useRef(scene);
  sceneRef.current = scene;

  /** předpočítaná data výběru pro aktuální snímek (kamera, velikost, řez, zobrazení); jen při změně */
  const pickIndex = useCallback((): SoftPickIndex | null => {
    const el = box.current;
    const list = baseRef.current;
    if (!el || !list.length) return null;
    const w = el.clientWidth;
    const h = el.clientHeight;
    if (!w || !h) return null;
    const c = cam.current;
    const sc = sceneRef.current;
    const clip = sc.section ? sectionPlane(sc.section) : null;
    const display = sc.display ?? "shadedEdges";
    const key = `${c.angles.az},${c.angles.el},${c.center.join(",")},${c.scale},${w},${h},${clip ? `${clip.normal.join(",")},${clip.constant}` : ""},${display}`;
    const cur = pix.current;
    if (cur && cur.key === key && cur.items === list) return cur.ix;
    const ix = buildPickIndex(list, { width: w, height: h, camera: { ...basisOf(c.angles), center: c.center, scale: c.scale }, clip, cull: !clip && display !== "hiddenLine", occlude: display !== "wireframe" });
    pix.current = { key, items: list, ix };
    if (canvas.current) canvas.current.dataset.pickMs = ix.ms.toFixed(1); // doba stavby indexu výběru (diagnostika)
    return ix;
  }, []);

  /**
   * Místo plátna zakryté jiným prvkem stránky (upozornění náhledu, panel vlastností, lišty)? Skutečný klik by tam
   * dopadl na ten prvek, ne na model – popisek tam proto nepatří. `blocked` sbírá zkoušená zakrytá místa.
   * Rychle: nejdřív obdélníky prvků, které plátno překrývají a přijímají klik (jednou na výpočet); jen bod uvnitř
   * některého z nich se ověří `elementFromPoint` (pořadí vrstev).
   */
  const coverTest = useCallback((blocked?: number[]) => {
    const cv = canvas.current;
    if (!cv || typeof document === "undefined" || !document.elementFromPoint) return () => false;
    const r = cv.getBoundingClientRect();
    const rects: number[] = [];
    const all = document.body.getElementsByTagName("*");
    for (let i = 0; i < all.length; i++) {
      const el = all[i];
      if (el === cv) continue;
      const b = el.getBoundingClientRect();
      if (!(b.width > 0 && b.height > 0) || b.right <= r.left || b.left >= r.right || b.bottom <= r.top || b.top >= r.bottom) continue;
      if (el.contains(cv)) continue;
      const st = getComputedStyle(el);
      if (st.pointerEvents === "none" || st.visibility === "hidden") continue;
      // prvek pod plátnem (např. odpojené 3D okno): klik do jeho plochy dopadne na plátno – nezakrývá
      const x0 = Math.max(b.left, r.left), x1 = Math.min(b.right, r.right), y0 = Math.max(b.top, r.top), y1 = Math.min(b.bottom, r.bottom);
      const probes: [number, number][] = [[0.5, 0.5], [0.25, 0.25], [0.75, 0.25], [0.25, 0.75], [0.75, 0.75]];
      if (probes.some(([u, v]) => document.elementFromPoint(x0 + (x1 - x0) * u, y0 + (y1 - y0) * v) === cv)) continue;
      rects.push(b.left - r.left - 1, b.top - r.top - 1, b.right - r.left + 1, b.bottom - r.top + 1);
    }
    return (x: number, y: number) => {
      let hit = false;
      for (let i = 0; i < rects.length; i += 4) {
        if (x >= rects[i] && x <= rects[i + 2] && y >= rects[i + 1] && y <= rects[i + 3]) {
          hit = document.elementFromPoint(r.left + x, r.top + y) !== cv;
          break;
        }
      }
      if (hit && blocked) blocked.push(x, y);
      return hit;
    };
  }, []);
  /** platí uložené popisky? (tentýž snímek, žádný není zakrytý a zakrytá místa zakrytá zůstala – jinak se přepočítají) */
  const hintsValid = useCallback(
    (ix: SoftPickIndex) => {
      const c = hintsRef.current;
      if (c.ix !== ix) return false;
      const covered = coverTest();
      if (c.list.some((h) => covered(h.x, h.y))) return false;
      for (let i = 0; i + 1 < c.blocked.length; i += 2) if (!covered(c.blocked[i], c.blocked[i + 1])) return false;
      return true;
    },
    [coverTest],
  );
  const stopHintJob = useCallback(() => {
    const j = hintJob.current;
    if (j?.timer) clearTimeout(j.timer);
    hintJob.current = null;
  }, []);
  /** výpočet popisků pro index (rozpracovaný pro tentýž index se převezme) */
  const hintJobFor = useCallback(
    (ix: SoftPickIndex) => {
      const j = hintJob.current;
      if (j && j.ix === ix) return j;
      stopHintJob();
      const blocked: number[] = [];
      const job = { ix, gen: softHintSteps(ix, { blocked: coverTest(blocked) }), blocked, timer: null };
      hintJob.current = job;
      return job;
    },
    [coverTest, stopHintJob],
  );
  /** popisky entit (F1 / E2 / V3) pro aktuální snímek – každý leží tam, kde klik vybere právě jeho entitu (synchronně) */
  const hintsNow = useCallback((): SoftHint[] => {
    if (!pickRef.current?.hints) return [];
    // index se staví znovu při změně pohledu, velikosti, řezu i modelu – popisky platí pro jeden index
    const ix = pickIndex();
    if (!ix) return [];
    if (hintsValid(ix)) return hintsRef.current.list;
    const job = hintJobFor(ix);
    if (job.timer) clearTimeout(job.timer);
    let r = job.gen.next();
    while (!r.done) r = job.gen.next();
    hintJob.current = null;
    hintsRef.current = { ix, list: r.value, blocked: job.blocked };
    return r.value;
  }, [pickIndex, hintsValid, hintJobFor]);
  const hintTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  /** po vykreslení (s odkladem): popisky pro nový snímek po dávkách, mezi nimi se kreslí a reaguje na myš */
  const hintsTick = useCallback(() => {
    if (hintTimer.current) clearTimeout(hintTimer.current);
    hintTimer.current = setTimeout(() => {
      hintTimer.current = null;
      if (!pickRef.current?.hints) return;
      const ix = pickIndex();
      if (!ix) {
        stopHintJob();
        setHintList((l) => (l.length ? [] : l));
        return;
      }
      if (hintsValid(ix)) {
        const list = hintsRef.current.list;
        setHintList((l) => (l === list ? l : list));
        return;
      }
      const job = hintJobFor(ix);
      let first = true;
      const step = () => {
        job.timer = null;
        if (hintJob.current !== job) return;
        const t0 = performance.now();
        let r = job.gen.next();
        while (!r.done && performance.now() - t0 < HINT_SLICE_MS) r = job.gen.next();
        if (r.done) {
          hintJob.current = null;
          hintsRef.current = { ix, list: r.value, blocked: job.blocked };
          const list = r.value;
          setHintList((l) => (l === list ? l : list));
          return;
        }
        // nedokončeno v první dávce: staré popisky by ukazovaly na staré místo – skrýt, dokud nejsou nové
        if (first) setHintList((l) => (l.length ? [] : l));
        first = false;
        job.timer = setTimeout(step, 0);
      };
      if (!job.timer) step();
    }, 160);
  }, [pickIndex, hintsValid, hintJobFor, stopHintJob]);

  /** překryvná vrstva: vybrané a najeté hrany a body (bez hloubkového testu – jako 3D okno), body uchopení, kóty měření */
  const drawOverlay = useCallback(() => {
    rafOv.current = 0;
    const el = box.current;
    const ov = overlay.current;
    if (!el || !ov) return;
    const w = el.clientWidth;
    const h = el.clientHeight;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const ow = Math.max(1, Math.round(w * dpr));
    const oh = Math.max(1, Math.round(h * dpr));
    if (ov.width !== ow || ov.height !== oh) {
      ov.width = ow;
      ov.height = oh;
    }
    const g = ov.getContext("2d");
    if (!g) return;
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.clearRect(0, 0, ow, oh);
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    const c = cam.current;
    const b = basisOf(c.angles);
    const sc = sceneRef.current;
    const clip = sc.section ? sectionPlane(sc.section) : null;
    const P = (p: Vec3): [number, number] => {
      const dx = p[0] - c.center[0], dy = p[1] - c.center[1], dz = p[2] - c.center[2];
      return [w / 2 + c.scale * (b.right[0] * dx + b.right[1] * dy + b.right[2] * dz), h / 2 - c.scale * (b.up[0] * dx + b.up[1] * dy + b.up[2] * dz)];
    };
    const cd = (p: Vec3) => (clip ? clip.normal[0] * p[0] + clip.normal[1] * p[1] + clip.normal[2] * p[2] + clip.constant : 1);
    const list = baseRef.current;
    const itemOf = (compId?: string) => list.find((it) => (it.compId ?? "") === (compId ?? ""));
    const stroke = (pts: Vec3[], color: string, width: number) => {
      g.strokeStyle = color;
      g.lineWidth = width;
      g.lineCap = "round";
      g.lineJoin = "round";
      g.beginPath();
      for (let i = 1; i < pts.length; i++) {
        let a = pts[i - 1], q = pts[i];
        const ca = cd(a), cb = cd(q);
        if (ca < 0 && cb < 0) continue;
        if (ca < 0 || cb < 0) {
          const t = ca / (ca - cb);
          const m: Vec3 = [a[0] + (q[0] - a[0]) * t, a[1] + (q[1] - a[1]) * t, a[2] + (q[2] - a[2]) * t];
          if (ca < 0) a = m;
          else q = m;
        }
        const [x0, y0] = P(a);
        const [x1, y1] = P(q);
        g.moveTo(x0, y0);
        g.lineTo(x1, y1);
      }
      g.stroke();
    };
    const dot = (p: Vec3, color: string, r: number) => {
      if (cd(p) < 0) return;
      const [x, y] = P(p);
      g.fillStyle = color;
      g.strokeStyle = "#ffffff";
      g.lineWidth = 1.5;
      g.beginPath();
      g.arc(x, y, r, 0, Math.PI * 2);
      g.fill();
      g.stroke();
    };
    const pp = pickRef.current;
    const marks: [SelItem, string][] = (pp?.selection ?? []).map((s) => [s, SEL_CSS]);
    const hv = hoverRef.current;
    if (hv && !(pp?.selection ?? []).some((s) => sameSel(s, hv))) marks.push([hv, HOVER_CSS]);
    const mode = pp?.pickMode ?? "none";
    if (LEGACY.has(mode)) {
      for (const e of pp?.selectedEdges ?? []) marks.push([{ kind: "edge", index: e }, SEL_CSS]);
      const le = lhoverRef.current.edge;
      if (le >= 0 && mode === "edges") marks.push([{ kind: "edge", index: le }, (pp?.selectedEdges ?? []).length ? SEL_CSS : HOVER_CSS]);
    }
    for (const [it, col] of marks) {
      if (it.kind === "edge") {
        const src = itemOf(it.compId);
        if (src) stroke(itemEdgePolyline(src, it.index), col, 3.5);
      } else if (it.kind === "vertex") dot(it.point, col, 5);
    }
    // body k uchopení na najeté hraně (měření, odkaz na bod)
    if (pp?.snapPoints) {
      const active = hv && hv.kind === "edge" && hv.at ? hv : null;
      for (const s of snaps.current.list) {
        const on = !!active && sameSel(active, s.item);
        dot(s.point, on ? SEL_CSS : SNAP_CSS, on ? 5 : 3.5);
      }
    }
    // kóty měření: úsečky, body a popisky
    const ms = pp?.measure;
    if (ms) {
      for (const [a, q] of ms.lines) stroke([a, q], SEL_CSS, 1.6);
      for (const p of ms.points) dot(p, SEL_CSS, 3.5);
    }
    const lab = labels.current;
    if (lab) {
      const kids = lab.children;
      (ms?.labels ?? []).forEach((l, i) => {
        const node = kids[i] as HTMLElement | undefined;
        if (!node) return;
        const [x, y] = P(l.pos);
        node.style.transform = `translate(${Math.round(x)}px, ${Math.round(y)}px) translate(-50%, -50%)`;
      });
    }
  }, []);
  const scheduleOverlay = useCallback(() => {
    if (!rafOv.current && !raf.current) rafOv.current = requestAnimationFrame(drawOverlay);
  }, [drawOverlay]);

  const draw = useCallback(() => {
    raf.current = 0;
    if (rafOv.current) {
      cancelAnimationFrame(rafOv.current);
      rafOv.current = 0;
    }
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
    drawOverlay();
    if (pickRef.current?.hints) hintsTick();
  }, [drawOverlay, hintsTick]);
  const schedule = useCallback(() => {
    if (!raf.current) raf.current = requestAnimationFrame(draw);
  }, [draw]);

  /** vejde model do plátna; s `v` zároveň nastaví pojmenovaný pohled (prázdná scéna: přizpůsobí se až model) */
  const fit = useCallback(
    (v?: SoftViewName) => {
      const el = box.current;
      if (v) setViewName(v);
      fitSoftCam(cam.current, itemsRef.current, el?.clientWidth ?? 0, el?.clientHeight ?? 0, FILL, v);
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

  // model: první zobrazení, výrazná změna velikosti nebo přesun → celé plátno (stejně jako 3D okno); jinak se pohled drží
  useEffect(() => {
    const v = softCamOnModel(cam.current, softBounds(baseItems));
    if (v) fit(v);
    else schedule();
  }, [baseItems, fit, schedule]);
  // zvýraznění ploch / těles (výběr, entita pod kurzorem) – jen překreslení
  useEffect(schedule, [items, schedule]);
  const secKey = scene.section ? JSON.stringify(sectionPlane(scene.section)) : "";
  useEffect(schedule, [scene.display, secKey, schedule]);
  // hrany a body výběru, body uchopení, kóty měření – jen překryvná vrstva
  const ovKey = [sel.filter((s) => s.kind === "edge" || s.kind === "vertex").map(selKey).join(","), legacy ? (pick?.selectedEdges ?? []).join(",") : "", lhover.edge, hover && (hover.kind === "edge" || hover.kind === "vertex") ? selKey(hover) : "", pick?.snapPoints ? 1 : 0].join("|");
  useEffect(scheduleOverlay, [ovKey, pick?.measure, scheduleOverlay]);
  // popisky entit: zapnutí / vypnutí
  const hintsOn = !!pick?.hints;
  useEffect(() => {
    if (hintsOn) hintsTick();
    else {
      stopHintJob();
      hintsRef.current = { ix: null, list: [], blocked: [] };
      setHintList([]);
    }
  }, [hintsOn, hintsTick, stopHintJob]);
  // jiný režim výběru (otevřený / zavřený formulář) – zrušit zvýraznění pod kurzorem
  useEffect(() => {
    setHover(null);
    setLhover((l) => (l.face < 0 && l.edge < 0 ? l : { face: -1, edge: -1 }));
    snaps.current = { key: "", list: [] };
  }, [pickMode]);

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
      if (rafOv.current) cancelAnimationFrame(rafOv.current);
      if (hintTimer.current) clearTimeout(hintTimer.current);
      stopHintJob();
      raf.current = 0;
      rafOv.current = 0;
    };
  }, [fit, schedule, stopHintJob]);

  // myš a dotyk: tažení otáčí (Shift, prostřední nebo pravé tlačítko posouvá), kolečko a dva prsty přibližují;
  // klik (bez tažení) vybírá, pravé tlačítko / dlouhý stisk prstem otevře kontextovou nabídku
  useEffect(() => {
    const cv = canvas.current;
    if (!cv) return;
    const pts = new Map<number, { x: number; y: number }>();
    let pan = false;
    let settle: ReturnType<typeof setTimeout> | null = null;
    let downAt: { x: number; y: number; button: number } | null = null;
    let longPress: ReturnType<typeof setTimeout> | null = null;
    /** najetí myší během otáčení / přiblížení velkého modelu – vyhodnotí se až po zastavení pohledu */
    let pendingHover: PointerEvent | null = null;
    const local = (e: PointerEvent | WheelEvent | MouseEvent) => {
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
        if (pendingHover) {
          const e = pendingHover;
          pendingHover = null;
          hoverAt(e);
        }
      }, 160);
    };
    /** stavba indexu výběru je u velkého modelu znát – během pohybu pohledu se odloží (index platí pro jeden pohled) */
    const slowIndex = () => (pix.current?.ix.ms ?? 0) > SLOW_INDEX_MS;
    // ---- výběr: stejná pravidla jako 3D okno (viewport.tsx: pickSel, legacyPick) ----
    const effFilter = (): SelFilter | undefined => (pickRef.current?.pickMode === "asmFace" ? "face" : undefined);
    const pickSel = (p: { x: number; y: number }, filterOverride?: SelFilter): SelItem | null => {
      const ix = pickIndex();
      const pp = pickRef.current;
      if (!ix || !pp) return null;
      const filter = filterOverride ?? pp.selFilter ?? "all";
      if (pp.snapPoints && (filter === "all" || filter === "vertex" || filter === "edge")) {
        const s = snapNear(ix, snaps.current.list, p.x, p.y);
        if (s) return s.item;
      }
      const r = pickAt(ix, p.x, p.y, filter) as SelItem | null;
      if (pp.snapPoints && r?.kind === "edge") {
        const key = `${r.compId ?? ""}:${r.index}`;
        if (snaps.current.key !== key) {
          const extra = r.compId ? { compId: r.compId, ...(r.topId ? { topId: r.topId } : {}) } : {};
          snaps.current = { key, list: edgeSnaps(ix, r.index, r.compId).map((s) => ({ point: s.point, item: { kind: "edge", index: r.index, at: s.at, point: s.point, ...extra } as SelItem })) };
        }
      }
      return r;
    };
    const legacyPick = (p: { x: number; y: number }) => {
      const ix = pickIndex();
      const mode = pickRef.current?.pickMode;
      let face = -1;
      let edge = -1;
      let point: [number, number, number] | undefined;
      if (ix && mode === "edges") {
        const h = edgeNear(ix, p.x, p.y);
        if (h && !ix.items[h.item].it.compId) edge = h.edge;
      }
      if (ix && (mode === "faces" || mode === "face-plane")) {
        const h = surfaceAt(ix, p.x, p.y);
        if (h && !h.cap && h.face >= 0 && !ix.items[h.item].it.compId) {
          face = h.face;
          point = h.point;
        }
      }
      return { face, edge, point };
    };
    const isLegacy = () => LEGACY.has(pickRef.current?.pickMode ?? "none");
    const hoverAt = (e: PointerEvent) => {
      const pp = pickRef.current;
      const p = local(e);
      if (pp?.onCursor) {
        const ix = pickIndex();
        const h = ix ? surfaceAt(ix, p.x, p.y) : null;
        pp.onCursor(h ? [round3(h.point[0]), round3(h.point[1]), round3(h.point[2])] : null);
      }
      if (!pp || pp.pickMode === "none") {
        cv.style.cursor = "";
        return;
      }
      if (isLegacy()) {
        const { face, edge } = legacyPick(p);
        const l = lhoverRef.current;
        if (face !== l.face || edge !== l.edge) {
          const next = { face: fullMs.current <= HOVER_FACE_MAX_MS ? face : -1, edge };
          lhoverRef.current = next;
          setLhover(next);
        }
        cv.style.cursor = face >= 0 || edge >= 0 ? "pointer" : "";
        return;
      }
      const it = pickSel(p, effFilter());
      const prev = hoverRef.current;
      const same = (!it && !prev) || (it && prev && sameSel(it, prev));
      if (!same) {
        // pomalý model: plocha / těleso pod kurzorem se nezvýrazní překreslením (jen kurzor), hrany a body ano
        const show = it && (it.kind === "edge" || it.kind === "vertex" || fullMs.current <= HOVER_FACE_MAX_MS) ? it : null;
        hoverRef.current = show;
        setHover(show);
      }
      cv.style.cursor = it ? "pointer" : "";
      if (pp.snapPoints) scheduleOverlay();
    };
    const clearHover = () => {
      pendingHover = null;
      pickRef.current?.onCursor?.(null);
      if (hoverRef.current) {
        hoverRef.current = null;
        setHover(null);
      }
      if (lhoverRef.current.face >= 0 || lhoverRef.current.edge >= 0) {
        lhoverRef.current = { face: -1, edge: -1 };
        setLhover(lhoverRef.current);
      }
      cv.style.cursor = "";
    };
    const cancelLongPress = () => {
      if (longPress) clearTimeout(longPress);
      longPress = null;
    };
    const onDown = (e: PointerEvent) => {
      pts.set(e.pointerId, local(e));
      pan = e.shiftKey || e.button === 1 || e.button === 2;
      downAt = pts.size === 1 ? { x: e.clientX, y: e.clientY, button: e.button } : null;
      try {
        cv.setPointerCapture?.(e.pointerId);
      } catch {
        /* syntetická událost (klik na popisek) nemá aktivní ukazatel */
      }
      cancelLongPress();
      if (e.pointerType === "touch" && pickRef.current && pickRef.current.pickMode !== "none") {
        const p = local(e);
        longPress = setTimeout(() => {
          longPress = null;
          downAt = null;
          pickRef.current?.onContext?.(e.clientX, e.clientY, pickSel(p, effFilter()));
        }, 550);
      }
    };
    // prostřední tlačítko: bez automatického posouvání stránky
    const onMouseDown = (e: MouseEvent) => {
      if (e.button === 1) e.preventDefault();
    };
    const onMove = (e: PointerEvent) => {
      const prev = pts.get(e.pointerId);
      if (!prev) {
        if (e.buttons) return;
        if (settle && slowIndex()) pendingHover = e;
        else hoverAt(e);
        return;
      }
      const p = local(e);
      if (downAt && Math.hypot(e.clientX - downAt.x, e.clientY - downAt.y) > 8) cancelLongPress();
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
      // tažení: zvýraznění pod kurzorem by po otočení / posunu ukazovalo jinam; kurzor „ruka“ (active:cursor-grabbing)
      const dragging = !downAt || Math.hypot(e.clientX - downAt.x, e.clientY - downAt.y) > 4;
      if (dragging && hoverRef.current) {
        hoverRef.current = null;
        setHover(null);
      }
      if (dragging && cv.style.cursor) cv.style.cursor = "";
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
      cancelLongPress();
      const was = pts.has(e.pointerId);
      pts.delete(e.pointerId);
      try {
        if (cv.hasPointerCapture?.(e.pointerId)) cv.releasePointerCapture(e.pointerId);
      } catch {
        /* bez zachycení */
      }
      const d = downAt;
      downAt = null;
      // klik = stisk a uvolnění téhož tlačítka bez tažení (do 4 px)
      if (!was || !d || pts.size || e.button !== d.button || Math.hypot(e.clientX - d.x, e.clientY - d.y) > 4) return;
      const pp = pickRef.current;
      if (!pp) return;
      const p = local(e);
      if (e.button === 2) {
        pp.onContext?.(e.clientX, e.clientY, pickSel(p, effFilter()));
        return;
      }
      if (e.button !== 0) return;
      if (isLegacy()) {
        const { face, edge, point } = legacyPick(p);
        if (edge >= 0) pp.onPickEdge?.(edge);
        if (face >= 0) pp.onPickFace?.(face, point);
        return;
      }
      if (pp.pickMode === "none") return;
      pp.onPick?.(pickSel(p, effFilter()), e.ctrlKey || e.shiftKey || e.metaKey);
    };
    const onCancel = (e: PointerEvent) => {
      cancelLongPress();
      pts.delete(e.pointerId);
      downAt = null;
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
    cv.addEventListener("pointercancel", onCancel);
    cv.addEventListener("pointerleave", clearHover);
    cv.addEventListener("wheel", onWheel, { passive: false });
    cv.addEventListener("contextmenu", onCtx);
    return () => {
      if (settle) clearTimeout(settle);
      cancelLongPress();
      cv.removeEventListener("pointerdown", onDown);
      cv.removeEventListener("mousedown", onMouseDown);
      cv.removeEventListener("pointermove", onMove);
      cv.removeEventListener("pointerup", onUp);
      cv.removeEventListener("pointercancel", onCancel);
      cv.removeEventListener("pointerleave", clearHover);
      cv.removeEventListener("wheel", onWheel);
      cv.removeEventListener("contextmenu", onCtx);
    };
  }, [schedule, scheduleOverlay, zoom, pickIndex]);

  // převzetí ovládání 3D okna (pás karet, klávesy, textové příkazy, náhledy nedávných souborů, popisky pro výběr)
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
      camera: () => ({ ...cam.current, angles: { ...cam.current.angles } }),
      setCamera: (c) => {
        if (!c || typeof c !== "object") return;
        cam.current = { ...(c as SoftCam) };
        setViewName(cam.current.view);
        schedule();
      },
      hintList: () => hintsNow().map((hh) => ({ id: hh.id, kind: hh.kind, index: hh.index, x: hh.x, y: hh.y, title: hh.title })),
      clickHint: (id, additive = false) => {
        const hh = hintsNow().find((x) => x.id.toUpperCase() === id.trim().toUpperCase());
        const cv = canvas.current;
        if (!hh || !cv) return false;
        const r = cv.getBoundingClientRect();
        const init: PointerEventInit = { clientX: r.left + hh.x, clientY: r.top + hh.y, button: 0, buttons: 1, bubbles: true, cancelable: true, pointerType: "mouse", pointerId: 1, isPrimary: true, ctrlKey: additive };
        cv.dispatchEvent(new PointerEvent("pointerdown", init));
        cv.dispatchEvent(new PointerEvent("pointerup", { ...init, buttons: 0 }));
        return true;
      },
    };
    setSoftView(handle);
    return () => {
      if (softView.current === handle) setSoftView(null);
    };
  }, [fit, draw, schedule, hintsNow]);

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
  const measureLabels = pick?.measure?.labels ?? [];
  return (
    <div ref={box} data-soft-viewport data-soft-pick={pickMode} className="absolute inset-0 overflow-hidden">
      <canvas ref={canvas} data-soft-canvas className="absolute inset-0 h-full w-full cursor-grab touch-none select-none active:cursor-grabbing" aria-label={tr("Náhled modelu bez WebGL")} role="img" />
      <canvas ref={overlay} data-soft-overlay className="pointer-events-none absolute inset-0 h-full w-full" aria-hidden />
      {/* popisky kót měření (polohu nastavuje překryvná vrstva) */}
      <div ref={labels} className="pointer-events-none absolute inset-0 overflow-hidden" aria-hidden>
        {measureLabels.map((l, i) => (
          <div key={i} className="absolute left-0 top-0 whitespace-nowrap rounded border border-brand/40 bg-white/95 px-1.5 py-0.5 font-mono text-[11px] font-semibold text-brand-600 shadow">
            {l.text}
          </div>
        ))}
      </div>
      {/* popisky entit pro výběr bez trefování (klik na střed popisku = klik na entitu; pointer-events: none) */}
      {hintsOn && hintList.length > 0 && (
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
      {!baseItems.length && (
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
