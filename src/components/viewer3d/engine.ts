import * as THREE from "three";
import { acceleratedRaycast, computeBoundsTree, disposeBoundsTree } from "three-mesh-bvh";
import type { ModelNode, ParsedModel } from "@/lib/viewer3d/types";
import type { PartTopology, Vec3 } from "@/lib/viewer3d/topology";
import { chainSegments, sliceMesh, type SectionTopology } from "@/lib/viewer3d/section";
import {
  measureAngle, measureDiameter, measureDistance, meshVolumeArea,
  type MeasureMode, type Measurement, type SnapGeometry, type SnapKind, type SnapPoint,
} from "@/lib/viewer3d/measure";
import { CadControls } from "./cad-controls";
import { CUBE_SIZE_PX, ViewCube } from "./view-cube";

/**
 * Jádro prohlížeče 3D (three.js) — bez Reactu. Vykresluje jen na vyžádání (šetří baterii, nesekne se),
 * výběr přes BVH (three-mesh-bvh), ovládání jako ZW3D (cad-controls.ts), měření s uchopováním
 * na rohy / středy kružnic / středy hran / hrany / plochy, skrývání dílů s historií zpět / vpřed.
 */

THREE.BufferGeometry.prototype.computeBoundsTree = computeBoundsTree;
THREE.BufferGeometry.prototype.disposeBoundsTree = disposeBoundsTree;
THREE.Mesh.prototype.raycast = acceleratedRaycast;

export type DisplayMode = "shaded-edges" | "shaded" | "wireframe" | "xray";
export type Tool = "select" | MeasureMode;
export type StdView = "front" | "back" | "left" | "right" | "top" | "bottom" | "iso";
export type ChangeKind =
  | "selection" | "visibility" | "history" | "measures" | "tool" | "display" | "snap" | "pending" | "filter" | "section" | "entity" | "colors";

/** Výběrový filtr jako v ZW3D — co se vybírá / na co se uchopuje. */
export type PickFilter = "auto" | "shape" | "part" | "assembly" | "face" | "edge" | "vertex" | "center" | "midpoint";

export const PICK_FILTERS: { key: PickFilter; label: string; hint: string }[] = [
  { key: "auto", label: "Automaticky", hint: "díl při výběru; při měření roh, střed díry, hrana, plocha" },
  { key: "shape", label: "Tvar (těleso)", hint: "jedno těleso" },
  { key: "part", label: "Díl", hint: "celý díl (všechna jeho tělesa)" },
  { key: "assembly", label: "Sestava", hint: "celá podsestava, do které díl patří" },
  { key: "face", label: "Plocha", hint: "rovina, válec, obecná plocha" },
  { key: "edge", label: "Hrana", hint: "úsečka, kružnice, oblouk, křivka" },
  { key: "vertex", label: "Bod / roh", hint: "koncový bod hrany" },
  { key: "center", label: "Střed křivosti", hint: "střed kružnice, oblouku, osa válce" },
  { key: "midpoint", label: "Střed hrany", hint: "polovina hrany" },
];

const ENTITY_FILTERS: PickFilter[] = ["face", "edge", "vertex", "center", "midpoint"];

/** Vybraná entita (plocha / hrana / bod) — popis pro kartu. */
export interface EntityInfo {
  kind: SnapKind;
  title: string;
  rows: [string, string][];
  part: number;
  /** Rovinná plocha → jde z ní udělat řez. */
  plane?: { normal: Vec3; point: Vec3 };
  /** Index plochy (barva plochy). */
  face?: number;
}

/** Stav řezu pro panel. */
export interface SectionState {
  normal: Vec3;
  position: number;
  min: number;
  max: number;
  flipped: boolean;
  label: string;
}

export interface PartInfo {
  index: number;
  name: string;
  triangles: number;
  size: Vec3;
  volume: number;
  area: number;
  faces: number;
  holes: number[];
}

export interface ContextRequest {
  part: number | null;
  clientX: number;
  clientY: number;
  /** Rovinná plocha pod kurzorem (nabídka „Řez touto plochou"). */
  facePlane?: { normal: Vec3; point: Vec3; part: number } | null;
  /** Plocha pod kurzorem (barva plochy). */
  face?: { part: number; index: number } | null;
}

export interface SnapState {
  kind: SnapKind;
  x: number;
  y: number;
  text: string;
}

interface PartView {
  index: number;
  name: string;
  mesh: THREE.Mesh;
  edges: THREE.LineSegments | null;
  wires: THREE.LineSegments | null;
  topo: PartTopology;
  baseMaterial: THREE.Material;
  hidden: boolean;
  box: THREE.Box3;
  sphere: THREE.Sphere;
  faceTris?: { start: Uint32Array; tris: Uint32Array };
  info?: PartInfo;
  /** Barva ze souboru (lineární) a barvy ploch ze souboru (barvy vrcholů) — pro „Původní barvy". */
  origColor: THREE.Color | null;
  origVC: Float32Array | null;
  opacity: number;
  /** Uživatelská barva dílu (sRGB hex) a barvy ploch (plocha → hex). */
  colorOverride: number | null;
  faceColors: Map<number, number>;
}

interface Snapshot {
  hidden: Uint8Array;
  measures: Measurement[];
  colors: { over: (number | null)[]; faces: [number, [number, number][]][] };
}

/** Paleta pro barvy dílů / ploch (sRGB) — dobře rozlišitelné odstíny jako v CAD. */
export const COLOR_PALETTE = [
  0x4f81bd, 0xc0504d, 0x9bbb59, 0xf79646, 0x8064a2, 0x4bacc6, 0xf2c314, 0x2e8b57,
  0xd16ba5, 0x8c564b, 0x17becf, 0xbcbd22, 0xa9c4e8, 0xe03930, 0x7f7f7f, 0x272425,
];

const DEFAULT_COLOR = new THREE.Color(0.72, 0.75, 0.79);
const SELECT_COLOR = 0xff9f1a;
const EDGE_COLOR = 0x1d2127;
const MEASURE_COLOR = 0x1f6feb;
/** Větší plochy se při měření nezvýrazňují celé (jen bod) — kopie sítě by zdržovala. */
const FACE_HIGHLIGHT_MAX_TRIS = 60_000;

const VIEW_DIRS: Record<StdView, { dir: Vec3; up: Vec3 }> = {
  front: { dir: [0, -1, 0], up: [0, 0, 1] },
  back: { dir: [0, 1, 0], up: [0, 0, 1] },
  left: { dir: [-1, 0, 0], up: [0, 0, 1] },
  right: { dir: [1, 0, 0], up: [0, 0, 1] },
  top: { dir: [0, 0, 1], up: [0, 1, 0] },
  bottom: { dir: [0, 0, -1], up: [0, -1, 0] },
  iso: { dir: [1, -1, 1], up: [0, 0, 1] },
};

const easeInOut = (t: number) => (t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2);

export class ViewerEngine {
  readonly renderer: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  private camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 1000);
  private modelGroup = new THREE.Group();
  private overlayGroup = new THREE.Group();
  private parts: PartView[] = [];
  private tree: ModelNode = { name: "Model", parts: [], children: [] };
  private controls: CadControls;
  private cube: ViewCube;
  private resizeObs: ResizeObserver;
  private labelLayer: HTMLDivElement;

  private width = 1;
  private height = 1;
  private viewHeight = 100;
  private target = new THREE.Vector3();
  private pivot = new THREE.Vector3();
  private camDist = 1000;
  private modelSphere = new THREE.Sphere(new THREE.Vector3(), 50);
  private zUp = true;
  private anim: {
    t0: number; dur: number; q0: THREE.Quaternion; q1: THREE.Quaternion;
    p0: THREE.Vector3; p1: THREE.Vector3; h0: number; h1: number;
  } | null = null;

  private frame = 0;
  private disposed = false;
  private materials = new Map<string, THREE.Material>();
  private edgeMaterial = new THREE.LineBasicMaterial({ color: EDGE_COLOR });
  private edgeSelMaterial = new THREE.LineBasicMaterial({ color: 0x8a4b00 });
  private selMaterial = new THREE.MeshPhongMaterial({
    color: SELECT_COLOR, shininess: 30, specular: 0x333333, side: THREE.DoubleSide,
    polygonOffset: true, polygonOffsetFactor: 1, polygonOffsetUnits: 1,
  });
  private hoverMaterials = new Map<THREE.Material, THREE.Material>();
  private selMaterials = new Map<THREE.Material, THREE.Material>();
  private raycaster = new THREE.Raycaster();

  private display: DisplayMode = "shaded-edges";
  private tool: Tool = "select";
  private selection = new Set<number>();
  private hoverPart: number | null = null;
  private undoStack: Snapshot[] = [];
  private redoStack: Snapshot[] = [];
  private measures: Measurement[] = [];
  private measureObjects = new Map<number, { obj: THREE.Object3D; label: HTMLDivElement }>();
  private pending: SnapPoint | null = null;
  private pendingObj: THREE.Points | null = null;
  private snap: SnapPoint | null = null;
  private snapText = "";
  private snapHighlight: THREE.Object3D | null = null;
  private snapShapeKey = "";
  private snapPointObj: THREE.Points | null = null;
  private hoverQueued: { x: number; y: number; alt: boolean } | null = null;
  private lastPointer: { x: number; y: number } | null = null;
  private touchMode = false;
  private bvhQueue: number[] = [];
  private cubeHover = false;

  // výběrový filtr a vybraná entita
  private filter: PickFilter = "auto";
  private entity: SnapPoint | null = null;
  private entityObj: THREE.Object3D | null = null;
  // strom sestavy: díl → uzel, uzel → rodič
  private nodeParts: number[][] = [];
  private nodeAll: number[][] = [];
  private nodeParent: number[] = [];
  private partNode: number[] = [];

  // řez
  private clipPlane: THREE.Plane | null = null;
  private section: { normal: THREE.Vector3; position: number; flipped: boolean; label: string } | null = null;
  private sectionGroup = new THREE.Group();
  private sectionTopo = new Map<number, SectionTopology>();
  private sectionTimer: number | null = null;
  private sectionPick = false;
  private capMaterials = new Map<string, THREE.Material>();
  private hatch: THREE.Texture | null = null;
  private stencilBack = new THREE.MeshBasicMaterial({
    side: THREE.BackSide, colorWrite: false, depthWrite: false, depthTest: false, stencilWrite: true,
    stencilFunc: THREE.AlwaysStencilFunc, stencilFail: THREE.IncrementWrapStencilOp,
    stencilZFail: THREE.IncrementWrapStencilOp, stencilZPass: THREE.IncrementWrapStencilOp,
  });
  private stencilFront = new THREE.MeshBasicMaterial({
    side: THREE.FrontSide, colorWrite: false, depthWrite: false, depthTest: false, stencilWrite: true,
    stencilFunc: THREE.AlwaysStencilFunc, stencilFail: THREE.DecrementWrapStencilOp,
    stencilZFail: THREE.DecrementWrapStencilOp, stencilZPass: THREE.DecrementWrapStencilOp,
  });
  private sectionLineMaterial = new THREE.LineBasicMaterial({ color: 0x111317 });

  constructor(
    private container: HTMLElement,
    private onChange: (kind: ChangeKind) => void,
    private onContext: (req: ContextRequest) => void,
  ) {
    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, stencil: true, powerPreference: "high-performance" });
    this.renderer.localClippingEnabled = true;
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    this.renderer.setClearColor(0x000000, 0);
    this.renderer.autoClear = false;
    const canvas = this.renderer.domElement;
    canvas.style.display = "block";
    canvas.style.width = "100%";
    canvas.style.height = "100%";
    canvas.style.outline = "none";
    canvas.tabIndex = 0;
    container.appendChild(canvas);

    this.labelLayer = document.createElement("div");
    this.labelLayer.style.cssText = "position:absolute;inset:0;pointer-events:none;overflow:hidden;";
    container.appendChild(this.labelLayer);

    // světla: rozptýlené + „čelovka" spojená s kamerou (stínování nezávisí na natočení)
    this.scene.add(new THREE.AmbientLight(0xffffff, 0.55));
    const key = new THREE.DirectionalLight(0xffffff, 2.1);
    key.position.set(-0.45, 0.8, 0.6);
    this.camera.add(key);
    const fill = new THREE.DirectionalLight(0xffffff, 0.7);
    fill.position.set(0.7, -0.25, 0.65);
    this.camera.add(fill);
    const rim = new THREE.DirectionalLight(0xffffff, 0.35);
    rim.position.set(0, -0.6, -0.8);
    this.camera.add(rim);
    // překryvy (měření, uchopení) až po řezu — skupina s vlastním pořadím
    this.overlayGroup.renderOrder = 100000;
    this.scene.add(this.camera, this.modelGroup, this.sectionGroup, this.overlayGroup);

    this.cube = new ViewCube(true);
    this.controls = new CadControls(canvas, {
      beginRotate: (x, y) => this.beginRotate(x, y),
      rotate: (dx, dy) => this.rotateBy(dx, dy),
      pan: (dx, dy) => this.panBy(dx, dy),
      zoomAt: (f, x, y) => this.zoomAt(f, x, y),
      endInteraction: () => this.requestRender(),
      tap: (x, y, info) => this.onTap(x, y, info),
      doubleTap: (x, y) => this.onDoubleTap(x, y),
      hover: (x, y, info) => this.queueHover(x, y, info.alt),
      leave: () => this.clearHover(),
      contextMenu: (x, y, cx, cy) => this.openContext(x, y, cx, cy),
    });
    this.resizeObs = new ResizeObserver(() => this.resize());
    this.resizeObs.observe(container);
    this.resize();
  }

  // ------------------------------------------------------------------ životní cyklus

  dispose() {
    this.disposed = true;
    cancelAnimationFrame(this.frame);
    this.controls.dispose();
    this.resizeObs.disconnect();
    this.clearModel();
    this.cube.dispose();
    for (const m of this.materials.values()) m.dispose();
    for (const m of this.hoverMaterials.values()) m.dispose();
    for (const m of this.selMaterials.values()) m.dispose();
    this.selMaterial.dispose();
    this.edgeMaterial.dispose();
    this.edgeSelMaterial.dispose();
    this.stencilBack.dispose();
    this.stencilFront.dispose();
    this.sectionLineMaterial.dispose();
    for (const m of this.capMaterials.values()) m.dispose();
    this.hatch?.dispose();
    if (this.sectionTimer !== null) window.clearTimeout(this.sectionTimer);
    this.renderer.dispose();
    this.renderer.forceContextLoss();
    this.renderer.domElement.remove();
    this.labelLayer.remove();
  }

  private clearModel() {
    for (const p of this.parts) {
      p.mesh.geometry.disposeBoundsTree?.();
      p.mesh.geometry.dispose();
      p.edges?.geometry.dispose();
      p.wires?.geometry.dispose();
    }
    this.modelGroup.clear();
    this.parts = [];
    this.clearMeasureObjects();
    this.clearSectionObjects();
    this.setEntityObj(null);
  }

  // ------------------------------------------------------------------ model

  private material(color: THREE.Color | null, vertexColors: boolean, opacity = 1): THREE.Material {
    const c = color ?? DEFAULT_COLOR;
    const key = vertexColors ? `vc|${opacity}` : `${c.getHexString()}|${opacity}`;
    let m = this.materials.get(key);
    if (!m) {
      m = new THREE.MeshPhongMaterial({
        color: vertexColors ? 0xffffff : c, vertexColors, shininess: 28, specular: 0x2a2a2a,
        side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: 1, polygonOffsetUnits: 1,
        transparent: opacity < 1, opacity, depthWrite: opacity >= 1,
      });
      m.userData.baseOpacity = opacity;
      m.userData.vc = vertexColors;
      m.clippingPlanes = this.clipPlane ? [this.clipPlane] : null;
      this.materials.set(key, m);
      this.applyDisplayToMaterial(m);
    }
    return m;
  }

  load(model: ParsedModel, topology: PartTopology[], zUp = true) {
    this.clearModel();
    this.zUp = zUp;
    this.cube.dispose();
    this.cube = new ViewCube(zUp);
    this.tree = model.root;
    this.selection.clear();
    this.undoStack = [];
    this.redoStack = [];
    this.measures = [];
    this.pending = null;
    this.entity = null;
    this.section = null;
    this.clipPlane = null;
    this.indexTree(model.root, model.parts.length);

    model.parts.forEach((part, index) => {
      const g = new THREE.BufferGeometry();
      g.setAttribute("position", new THREE.BufferAttribute(part.positions, 3));
      if (part.indices && part.indices.length) g.setIndex(new THREE.BufferAttribute(part.indices, 1));
      const vcount = part.positions.length / 3;
      if (part.normals && part.normals.length === part.positions.length) g.setAttribute("normal", new THREE.BufferAttribute(part.normals, 3));
      else g.computeVertexNormals();

      // barvy ploch (STEP s barevnými plochami) → barvy vrcholů
      let vertexColors = false;
      let origVC: Float32Array | null = null;
      const base = part.color ? new THREE.Color(part.color[0], part.color[1], part.color[2]) : null;
      const faceColors = part.faces?.filter((f) => f.color) ?? [];
      if (faceColors.length && part.indices) {
        const differs = faceColors.some((f) => !base || Math.abs(f.color![0] - base.r) + Math.abs(f.color![1] - base.g) + Math.abs(f.color![2] - base.b) > 0.01);
        if (differs) {
          const col = new Float32Array(vcount * 3);
          const dc = base ?? DEFAULT_COLOR;
          for (let i = 0; i < vcount; i++) {
            col[i * 3] = dc.r;
            col[i * 3 + 1] = dc.g;
            col[i * 3 + 2] = dc.b;
          }
          for (const f of part.faces!) {
            if (!f.color) continue;
            for (let t = f.first; t <= f.last; t++) {
              for (let k = 0; k < 3; k++) {
                const v = part.indices[t * 3 + k];
                col[v * 3] = f.color[0];
                col[v * 3 + 1] = f.color[1];
                col[v * 3 + 2] = f.color[2];
              }
            }
          }
          // barvy z CAD jsou sRGB → lineární prostor rendereru
          const tmp = new THREE.Color();
          for (let i = 0; i < vcount; i++) {
            tmp.setRGB(col[i * 3], col[i * 3 + 1], col[i * 3 + 2], THREE.SRGBColorSpace);
            col[i * 3] = tmp.r;
            col[i * 3 + 1] = tmp.g;
            col[i * 3 + 2] = tmp.b;
          }
          g.setAttribute("color", new THREE.BufferAttribute(col, 3));
          origVC = col.slice();
          vertexColors = true;
        }
      }
      const baseColor = base ? new THREE.Color().setRGB(base.r, base.g, base.b, THREE.SRGBColorSpace) : null;
      const mat = this.material(baseColor, vertexColors, part.opacity ?? 1);
      const mesh = new THREE.Mesh(g, mat);
      mesh.userData.part = index;
      mesh.matrixAutoUpdate = false;
      this.modelGroup.add(mesh);

      const topo = topology[index];
      let edges: THREE.LineSegments | null = null;
      if (topo?.edgeSegments.length) {
        const eg = new THREE.BufferGeometry();
        eg.setAttribute("position", new THREE.BufferAttribute(topo.edgeSegments, 3));
        edges = new THREE.LineSegments(eg, this.edgeMaterial);
        edges.matrixAutoUpdate = false;
        this.modelGroup.add(edges);
      }
      let wires: THREE.LineSegments | null = null;
      if (part.lines?.length) {
        const wg = new THREE.BufferGeometry();
        wg.setAttribute("position", new THREE.BufferAttribute(part.lines, 3));
        wires = new THREE.LineSegments(wg, this.edgeMaterial);
        wires.matrixAutoUpdate = false;
        this.modelGroup.add(wires);
      }
      g.computeBoundingBox();
      g.computeBoundingSphere();
      const box = g.boundingBox!.clone();
      if (part.lines?.length) {
        for (let i = 0; i < part.lines.length; i += 3) box.expandByPoint(new THREE.Vector3(part.lines[i], part.lines[i + 1], part.lines[i + 2]));
      }
      this.parts.push({
        index, name: part.name, mesh, edges, wires,
        topo: topo ?? { edgeSegments: new Float32Array(0), curves: [], segCurve: new Uint32Array(0), corners: new Float32Array(0), triFace: new Uint32Array(0), faces: [] },
        baseMaterial: mat, hidden: false, box, sphere: box.getBoundingSphere(new THREE.Sphere()),
        origColor: baseColor, origVC, opacity: part.opacity ?? 1, colorOverride: null, faceColors: new Map(),
      });
    });

    const all = new THREE.Box3();
    for (const p of this.parts) all.union(p.box);
    if (all.isEmpty()) all.set(new THREE.Vector3(-50, -50, -50), new THREE.Vector3(50, 50, 50));
    all.getBoundingSphere(this.modelSphere);
    if (this.modelSphere.radius <= 0) this.modelSphere.radius = 1;
    this.camDist = this.modelSphere.radius * 6 + 10;
    this.applyDisplay();
    this.setView("iso", false);
    // BVH pro rychlý výběr — postupně, ať první vykreslení nečeká
    this.bvhQueue = this.parts.map((p) => p.index).sort((a, b) => this.triCount(b) - this.triCount(a));
    this.scheduleBvh();
    this.applyClipping();
    this.onChange("visibility");
    this.onChange("history");
    this.onChange("measures");
    this.onChange("section");
  }

  /** Strom sestavy → rychlé dotazy „díl tohoto tělesa" a „podsestava". */
  private indexTree(root: ModelNode, partCount: number) {
    this.nodeParts = [];
    this.nodeAll = [];
    this.nodeParent = [];
    this.partNode = new Array(partCount).fill(-1);
    const visit = (n: ModelNode, parent: number): number[] => {
      const id = this.nodeParts.length;
      this.nodeParts.push(n.parts);
      this.nodeAll.push([]);
      this.nodeParent.push(parent);
      for (const p of n.parts) if (p >= 0 && p < partCount && this.partNode[p] < 0) this.partNode[p] = id;
      const all = [...n.parts];
      for (const c of n.children) all.push(...visit(c, id));
      this.nodeAll[id] = all;
      return all;
    };
    visit(root, -1);
  }

  /** Všechna tělesa dílu, do kterého patří těleso i. */
  partGroup(i: number): number[] {
    const n = this.partNode[i];
    return n >= 0 && this.nodeParts[n].length ? [...this.nodeParts[n]] : [i];
  }

  /** Všechna tělesa podsestavy, do které patří díl tělesa i. */
  assemblyGroup(i: number): number[] {
    const n = this.partNode[i];
    if (n < 0) return [i];
    const parent = this.nodeParent[n];
    return parent >= 0 ? [...this.nodeAll[parent]] : [...this.nodeAll[n]];
  }

  private triCount(i: number): number {
    const g = this.parts[i].mesh.geometry;
    return Math.floor(g.index ? g.index.count / 3 : g.getAttribute("position").count / 3);
  }

  private scheduleBvh() {
    if (this.disposed || !this.bvhQueue.length) return;
    const step = () => {
      if (this.disposed) return;
      const t0 = performance.now();
      while (this.bvhQueue.length && performance.now() - t0 < 12) {
        const i = this.bvhQueue.shift()!;
        this.ensureBvh(this.parts[i]);
      }
      if (this.bvhQueue.length) window.setTimeout(step, 0);
    };
    window.setTimeout(step, 50);
  }

  private ensureBvh(p: PartView) {
    // díl jen z čar (drátová geometrie z 3D PDF) nemá trojúhelníky → BVH ani výběr plochou
    // indirect: BVH nepřeskládá index sítě → číslo trojúhelníku z výběru sedí na plochy z topologie
    if (!p.mesh.geometry.boundsTree && this.triCount(p.index) > 0) p.mesh.geometry.computeBoundsTree({ indirect: true });
  }

  getTree(): ModelNode {
    return this.tree;
  }

  partCount(): number {
    return this.parts.length;
  }

  partName(i: number): string {
    return this.parts[i]?.name ?? "";
  }

  isHidden(i: number): boolean {
    return !!this.parts[i]?.hidden;
  }

  hiddenCount(): number {
    return this.parts.filter((p) => p.hidden).length;
  }

  getSelection(): number[] {
    return [...this.selection];
  }

  /** Rozměry celého modelu (viditelné díly) v mm. */
  modelSize(): Vec3 {
    const b = this.visibleBox();
    if (b.isEmpty()) return [0, 0, 0];
    const s = b.getSize(new THREE.Vector3());
    return [s.x, s.y, s.z];
  }

  totalTriangles(): number {
    let n = 0;
    for (const p of this.parts) n += this.triCount(p.index);
    return n;
  }

  partInfo(i: number): PartInfo | null {
    const p = this.parts[i];
    if (!p) return null;
    if (!p.info) {
      const g = p.mesh.geometry;
      const pos = g.getAttribute("position").array as Float32Array;
      const idx = g.index ? (g.index.array as Uint32Array) : null;
      const { volume, area } = meshVolumeArea(pos, idx);
      const s = p.box.getSize(new THREE.Vector3());
      const holes = new Set<number>();
      for (const f of p.topo.faces) if (f.kind === "cylinder" && f.radius) holes.add(Math.round(f.radius * 2 * 1000) / 1000);
      for (const c of p.topo.curves) if (c.kind === "circle" && c.radius) holes.add(Math.round(c.radius * 2 * 1000) / 1000);
      p.info = {
        index: i, name: p.name, triangles: this.triCount(i), size: [s.x, s.y, s.z], volume, area,
        faces: p.topo.faces.length, holes: [...holes].sort((a, b) => a - b).slice(0, 12),
      };
    }
    return p.info;
  }

  // ------------------------------------------------------------------ vykreslování

  requestRender() {
    if (this.disposed || this.frame) return;
    this.frame = requestAnimationFrame(() => {
      this.frame = 0;
      this.render();
    });
  }

  private resize() {
    const r = this.container.getBoundingClientRect();
    this.width = Math.max(1, Math.round(r.width));
    this.height = Math.max(1, Math.round(r.height));
    this.renderer.setSize(this.width, this.height, false);
    this.updateFrustum();
    this.requestRender();
  }

  private updateFrustum() {
    const aspect = this.width / this.height;
    const h = this.viewHeight / 2;
    this.camera.left = -h * aspect;
    this.camera.right = h * aspect;
    this.camera.top = h;
    this.camera.bottom = -h;
    // hloubka podle koule modelu (kamera je vždy před modelem)
    const dir = new THREE.Vector3(0, 0, -1).applyQuaternion(this.camera.quaternion);
    const dc = this.modelSphere.center.clone().sub(this.camera.position).dot(dir);
    const r = this.modelSphere.radius * 2.2 + 1;
    this.camera.near = Math.max(0.01, dc - r);
    this.camera.far = dc + r;
    this.camera.updateProjectionMatrix();
    this.camera.updateMatrixWorld();
  }

  private render() {
    if (this.disposed) return;
    if (this.anim) {
      const t = Math.min(1, (performance.now() - this.anim.t0) / this.anim.dur);
      const e = easeInOut(t);
      this.camera.quaternion.slerpQuaternions(this.anim.q0, this.anim.q1, e);
      this.target.lerpVectors(this.anim.p0, this.anim.p1, e);
      this.viewHeight = this.anim.h0 + (this.anim.h1 - this.anim.h0) * e;
      this.placeCamera();
      if (t >= 1) this.anim = null;
      else this.requestRender();
    }
    this.updateFrustum();
    const r = this.renderer;
    r.setScissorTest(false);
    r.setViewport(0, 0, this.width, this.height);
    r.clear();
    r.render(this.scene, this.camera);
    // orientační kostka vpravo nahoře
    const s = Math.min(CUBE_SIZE_PX, Math.round(Math.min(this.width, this.height) * 0.28));
    this.cube.sync(this.camera);
    r.setScissorTest(true);
    r.setViewport(this.width - s - 8, this.height - s - 8, s, s);
    r.setScissor(this.width - s - 8, this.height - s - 8, s, s);
    r.clearDepth();
    r.render(this.cube.scene, this.cube.camera);
    r.setScissorTest(false);
    this.updateLabels();
  }

  private cubeRect() {
    const s = Math.min(CUBE_SIZE_PX, Math.round(Math.min(this.width, this.height) * 0.28));
    return { x: this.width - s - 8, y: 8, s };
  }

  private inCube(x: number, y: number): { u: number; v: number } | null {
    const c = this.cubeRect();
    if (x < c.x || x > c.x + c.s || y < c.y || y > c.y + c.s) return null;
    return { u: (x - c.x) / c.s, v: (y - c.y) / c.s };
  }

  // ------------------------------------------------------------------ kamera

  private back(): THREE.Vector3 {
    return new THREE.Vector3(0, 0, 1).applyQuaternion(this.camera.quaternion);
  }

  private placeCamera() {
    this.camera.position.copy(this.target).addScaledVector(this.back(), this.camDist);
    this.camera.updateMatrixWorld();
  }

  private worldPerPx(): number {
    return this.viewHeight / this.height;
  }

  /** Bod v rovině pohledu (přes cíl) pod pixelem. */
  private viewPlanePoint(x: number, y: number): THREE.Vector3 {
    const right = new THREE.Vector3(1, 0, 0).applyQuaternion(this.camera.quaternion);
    const up = new THREE.Vector3(0, 1, 0).applyQuaternion(this.camera.quaternion);
    const wpp = this.worldPerPx();
    return this.target.clone().addScaledVector(right, (x - this.width / 2) * wpp).addScaledVector(up, (this.height / 2 - y) * wpp);
  }

  private beginRotate(x: number, y: number) {
    this.anim = null;
    const hit = this.raycastParts(x, y);
    if (hit) this.pivot.copy(hit.point);
    else {
      const b = this.visibleBox();
      if (!b.isEmpty()) b.getCenter(this.pivot);
      else this.pivot.copy(this.target);
    }
  }

  private rotateBy(dx: number, dy: number) {
    this.anim = null;
    const ang = Math.PI / Math.max(300, Math.min(this.width, this.height));
    const up = new THREE.Vector3(0, 1, 0).applyQuaternion(this.camera.quaternion);
    const right = new THREE.Vector3(1, 0, 0).applyQuaternion(this.camera.quaternion);
    const q = new THREE.Quaternion().setFromAxisAngle(up, -dx * ang);
    q.multiply(new THREE.Quaternion().setFromAxisAngle(right, -dy * ang));
    this.target.sub(this.pivot).applyQuaternion(q).add(this.pivot);
    this.camera.quaternion.premultiply(q).normalize();
    this.placeCamera();
    this.requestRender();
  }

  private panBy(dx: number, dy: number) {
    this.anim = null;
    const wpp = this.worldPerPx();
    const right = new THREE.Vector3(1, 0, 0).applyQuaternion(this.camera.quaternion);
    const up = new THREE.Vector3(0, 1, 0).applyQuaternion(this.camera.quaternion);
    this.target.addScaledVector(right, -dx * wpp).addScaledVector(up, dy * wpp);
    this.placeCamera();
    this.requestRender();
  }

  private zoomAt(factor: number, x: number, y: number) {
    this.anim = null;
    const r = this.modelSphere.radius;
    const next = Math.min(Math.max(this.viewHeight * factor, r * 1e-4), r * 200);
    const f = next / this.viewHeight;
    if (f === 1) return;
    const under = this.viewPlanePoint(x, y);
    // bod pod kurzorem zůstane na místě
    this.target.sub(under).multiplyScalar(f).add(under);
    this.viewHeight = next;
    this.placeCamera();
    this.requestRender();
  }

  zoomBy(factor: number) {
    this.zoomAt(factor, this.width / 2, this.height / 2);
  }

  private visibleBox(only?: Iterable<number>): THREE.Box3 {
    const b = new THREE.Box3();
    const list = only ? [...only].map((i) => this.parts[i]).filter(Boolean) : this.parts.filter((p) => !p.hidden);
    for (const p of list) b.union(p.box);
    return b;
  }

  /** Výška pohledu, aby se box vešel (při orientaci q). */
  private fitHeight(box: THREE.Box3, q: THREE.Quaternion, center: THREE.Vector3): number {
    const inv = q.clone().invert();
    let mx = 0;
    let my = 0;
    for (let i = 0; i < 8; i++) {
      const v = new THREE.Vector3(i & 1 ? box.max.x : box.min.x, i & 2 ? box.max.y : box.min.y, i & 4 ? box.max.z : box.min.z);
      v.sub(center).applyQuaternion(inv);
      mx = Math.max(mx, Math.abs(v.x));
      my = Math.max(my, Math.abs(v.y));
    }
    const aspect = this.width / this.height;
    return Math.max(2 * my, (2 * mx) / aspect, this.modelSphere.radius * 1e-3) * 1.14;
  }

  private animateTo(q: THREE.Quaternion, center: THREE.Vector3, h: number, animate: boolean) {
    if (!animate) {
      this.anim = null;
      this.camera.quaternion.copy(q);
      this.target.copy(center);
      this.viewHeight = h;
      this.placeCamera();
      this.requestRender();
      return;
    }
    this.anim = {
      t0: performance.now(), dur: 320, q0: this.camera.quaternion.clone(), q1: q.clone(),
      p0: this.target.clone(), p1: center.clone(), h0: this.viewHeight, h1: h,
    };
    this.requestRender();
  }

  /** Zobrazit vše (nebo vybrané díly). */
  fit(onlySelection = false, animate = true) {
    const box = onlySelection && this.selection.size ? this.visibleBox(this.selection) : this.visibleBox();
    if (box.isEmpty()) return;
    const c = box.getCenter(new THREE.Vector3());
    this.pivot.copy(c);
    this.animateTo(this.camera.quaternion.clone(), c, this.fitHeight(box, this.camera.quaternion, c), animate);
  }

  private mapDir(v: Vec3): THREE.Vector3 {
    // modely „Y nahoru" (OBJ, glTF): CAD směr (x, y, z) → (x, z, −y)
    return this.zUp ? new THREE.Vector3(v[0], v[1], v[2]) : new THREE.Vector3(v[0], v[2], -v[1]);
  }

  setView(view: StdView, animate = true) {
    const d = VIEW_DIRS[view];
    this.setViewDir(this.mapDir(d.dir), this.mapDir(d.up), animate);
  }

  private setViewDir(dir: THREE.Vector3, up: THREE.Vector3, animate: boolean) {
    const m = new THREE.Matrix4().lookAt(dir.clone().normalize(), new THREE.Vector3(), up.clone().normalize());
    const q = new THREE.Quaternion().setFromRotationMatrix(m);
    const box = this.visibleBox();
    const b = box.isEmpty() ? new THREE.Box3().setFromCenterAndSize(this.modelSphere.center, new THREE.Vector3(1, 1, 1)) : box;
    const c = b.getCenter(new THREE.Vector3());
    this.pivot.copy(c);
    this.animateTo(q, c, this.fitHeight(b, q, c), animate);
  }

  // ------------------------------------------------------------------ výběr a zobrazení

  private raycastParts(x: number, y: number): { part: number; point: THREE.Vector3; tri: number; distance: number; cap?: boolean } | null {
    if (!this.parts.length) return null;
    this.updateFrustum();
    const ndc = new THREE.Vector2((x / this.width) * 2 - 1, -(y / this.height) * 2 + 1);
    this.raycaster.setFromCamera(ndc, this.camera);
    const plane = this.clipPlane;
    // s řezem potřebujeme všechny průsečíky (první může být v odříznuté části)
    this.raycaster.firstHitOnly = !plane;
    const meshes: THREE.Mesh[] = [];
    for (const p of this.parts) {
      if (p.hidden || this.triCount(p.index) === 0) continue;
      if (!this.raycaster.ray.intersectsSphere(p.sphere)) continue;
      this.ensureBvh(p);
      meshes.push(p.mesh);
    }
    const eps = this.modelSphere.radius * 1e-6;
    let best: THREE.Intersection | null = null;
    for (const m of meshes) {
      const hits = this.raycaster.intersectObject(m, false);
      for (const h of hits) {
        if (plane && plane.distanceToPoint(h.point) < -eps) continue;
        if (!best || h.distance < best.distance) best = h;
        break;
      }
    }
    if (!best) return null;
    const part = best.object.userData.part as number;
    if (plane && best.face) {
      // díváme se do vnitřku tělesa → vidíme vybarvený řez (víčko) v rovině řezu
      const n = best.face.normal;
      if (n.dot(this.raycaster.ray.direction) > 0) {
        const q = this.raycaster.ray.intersectPlane(plane, new THREE.Vector3());
        if (q) return { part, point: q, tri: -1, distance: this.raycaster.ray.origin.distanceTo(q), cap: true };
      }
    }
    return { part, point: best.point.clone(), tri: best.faceIndex ?? 0, distance: best.distance };
  }

  private applyDisplayToMaterial(m: THREE.Material) {
    const base = (m.userData.baseOpacity as number | undefined) ?? 1;
    const xray = this.display === "xray";
    const opacity = xray ? Math.min(base, 0.28) : base;
    m.transparent = opacity < 1;
    m.opacity = opacity;
    m.depthWrite = opacity >= 1;
    m.needsUpdate = true;
  }

  /** Ořezová rovina na všechny materiály modelu (posun roviny už jen mění její hodnoty). */
  private applyClipping() {
    const planes = this.clipPlane ? [this.clipPlane] : null;
    const all: THREE.Material[] = [
      ...this.materials.values(), ...this.hoverMaterials.values(), ...this.selMaterials.values(), this.selMaterial, this.edgeMaterial, this.edgeSelMaterial,
      this.stencilBack, this.stencilFront,
    ];
    for (const m of all) {
      m.clippingPlanes = planes;
      m.needsUpdate = true;
    }
    this.requestRender();
  }

  private applyDisplay() {
    for (const m of this.materials.values()) this.applyDisplayToMaterial(m);
    for (const m of this.hoverMaterials.values()) this.applyDisplayToMaterial(m);
    for (const m of this.selMaterials.values()) this.applyDisplayToMaterial(m);
    this.selMaterial.userData.baseOpacity = 1;
    this.applyDisplayToMaterial(this.selMaterial);
    for (const p of this.parts) this.applyPartState(p);
    this.requestRender();
  }

  private applyPartState(p: PartView) {
    const showMesh = !p.hidden && this.display !== "wireframe";
    const showEdges = !p.hidden && this.display !== "shaded";
    p.mesh.visible = showMesh;
    if (p.edges) {
      p.edges.visible = showEdges || (!p.hidden && this.display === "wireframe");
      p.edges.material = this.selection.has(p.index) ? this.edgeSelMaterial : this.edgeMaterial;
    }
    if (p.wires) p.wires.visible = !p.hidden;
    let mat = p.baseMaterial;
    // výběr = barva dílu se zvýrazněním (vidět i změnu barvy), ne plná oranžová
    if (this.selection.has(p.index)) mat = this.tintMaterial(p.baseMaterial, this.selMaterials, 0x8a4600);
    else if (this.hoverPart === p.index && this.tool === "select") mat = this.hoverMaterial(p.baseMaterial);
    p.mesh.material = mat;
  }

  private hoverMaterial(base: THREE.Material): THREE.Material {
    return this.tintMaterial(base, this.hoverMaterials, 0x3a2a10);
  }

  private tintMaterial(base: THREE.Material, cache: Map<THREE.Material, THREE.Material>, emissive: number): THREE.Material {
    let m = cache.get(base);
    if (!m) {
      const c = (base as THREE.MeshPhongMaterial).clone();
      c.emissive = new THREE.Color(emissive);
      c.clippingPlanes = this.clipPlane ? [this.clipPlane] : null;
      c.userData.baseOpacity = base.userData.baseOpacity;
      this.applyDisplayToMaterial(c);
      m = c;
      cache.set(base, m);
    }
    return m;
  }

  setDisplay(mode: DisplayMode) {
    this.display = mode;
    this.applyDisplay();
    this.onChange("display");
  }

  getDisplay(): DisplayMode {
    return this.display;
  }

  select(indices: number[], additive = false) {
    if (!additive) this.selection.clear();
    for (const i of indices) {
      if (!this.parts[i]) continue;
      if (additive && this.selection.has(i)) this.selection.delete(i);
      else this.selection.add(i);
    }
    for (const p of this.parts) this.applyPartState(p);
    this.requestRender();
    this.onChange("selection");
  }

  clearSelection() {
    if (!this.selection.size) return;
    this.select([]);
  }

  // ------------------------------------------------------------------ historie (zpět / vpřed)

  private snapshot(): Snapshot {
    return {
      hidden: Uint8Array.from(this.parts.map((p) => (p.hidden ? 1 : 0))),
      measures: [...this.measures],
      colors: {
        over: this.parts.map((p) => p.colorOverride),
        faces: this.parts.filter((p) => p.faceColors.size).map((p) => [p.index, [...p.faceColors.entries()]]),
      },
    };
  }

  private commit(before: Snapshot) {
    this.undoStack.push(before);
    if (this.undoStack.length > 200) this.undoStack.shift();
    this.redoStack = [];
    this.onChange("history");
  }

  private restore(s: Snapshot) {
    const faces = new Map(s.colors.faces.map(([i, list]) => [i, list]));
    this.parts.forEach((p, i) => {
      p.hidden = !!s.hidden[i];
      if (p.hidden) this.selection.delete(i);
      const over = s.colors.over[i] ?? null;
      const fc = faces.get(i) ?? [];
      const sameFaces = fc.length === p.faceColors.size && fc.every(([f, c]) => p.faceColors.get(f) === c);
      if (over !== p.colorOverride || !sameFaces) {
        p.colorOverride = over;
        p.faceColors = new Map(fc);
        this.applyColors(p);
      }
      this.applyPartState(p);
    });
    this.measures = [...s.measures];
    this.syncMeasureObjects();
    if (this.section) this.rebuildSection(true);
    this.requestRender();
    this.onChange("colors");
    this.onChange("visibility");
    this.onChange("selection");
    this.onChange("measures");
  }

  canUndo(): boolean {
    return this.undoStack.length > 0;
  }

  canRedo(): boolean {
    return this.redoStack.length > 0;
  }

  undo() {
    const prev = this.undoStack.pop();
    if (!prev) return;
    this.redoStack.push(this.snapshot());
    this.restore(prev);
    this.onChange("history");
  }

  redo() {
    const next = this.redoStack.pop();
    if (!next) return;
    this.undoStack.push(this.snapshot());
    this.restore(next);
    this.onChange("history");
  }

  private setHidden(indices: number[], hidden: boolean) {
    const changed = indices.filter((i) => this.parts[i] && this.parts[i].hidden !== hidden);
    if (!changed.length) return;
    const before = this.snapshot();
    for (const i of changed) {
      this.parts[i].hidden = hidden;
      if (hidden) this.selection.delete(i);
      this.applyPartState(this.parts[i]);
    }
    if (hidden && this.hoverPart !== null && changed.includes(this.hoverPart)) this.hoverPart = null;
    if (this.section) this.rebuildSection(true);
    this.commit(before);
    this.requestRender();
    this.onChange("visibility");
    this.onChange("selection");
  }

  /** Smazat (skrýt) díly — v prohlížeči, soubor se nemění. */
  hideParts(indices: number[]) {
    this.setHidden(indices, true);
  }

  showParts(indices: number[]) {
    this.setHidden(indices, false);
  }

  deleteSelected() {
    if (this.selection.size) this.hideParts([...this.selection]);
    else if (this.entity) {
      // vybraná plocha / hrana / bod → smazat díl, ke kterému patří
      const part = this.entity.part;
      this.setEntity(null);
      this.hideParts(this.partGroup(part));
    }
  }

  hasDeletable(): boolean {
    return this.selection.size > 0 || !!this.entity;
  }

  isolate(indices: number[]) {
    const keep = new Set(indices);
    const before = this.snapshot();
    let changed = false;
    for (const p of this.parts) {
      const h = !keep.has(p.index);
      if (p.hidden !== h) {
        p.hidden = h;
        changed = true;
      }
      if (h) this.selection.delete(p.index);
      this.applyPartState(p);
    }
    if (!changed) return;
    if (this.section) this.rebuildSection(true);
    this.commit(before);
    this.requestRender();
    this.onChange("visibility");
    this.onChange("selection");
  }

  showAll() {
    this.setHidden(this.parts.map((p) => p.index), false);
  }

  // ------------------------------------------------------------------ nástroje a měření

  setTool(tool: Tool) {
    this.tool = tool;
    this.pending = null;
    this.snap = null;
    this.clearSnapHighlight();
    if (this.hoverPart !== null) {
      const p = this.parts[this.hoverPart];
      this.hoverPart = null;
      if (p) this.applyPartState(p);
    }
    this.syncPending();
    this.requestRender();
    this.onChange("tool");
    this.onChange("snap");
    this.onChange("pending");
  }

  getTool(): Tool {
    return this.tool;
  }

  hasPending(): boolean {
    return !!this.pending;
  }

  /** Zrušit rozdělané měření / výběr (Esc). */
  cancel() {
    if (this.sectionPick) {
      this.cancelSectionPick();
      return true;
    }
    if (this.entity) {
      this.setEntity(null);
      return true;
    }
    if (this.pending) {
      this.pending = null;
      this.syncPending();
      this.onChange("pending");
      this.requestRender();
      return true;
    }
    if (this.tool !== "select") {
      this.setTool("select");
      return true;
    }
    if (this.selection.size) {
      this.clearSelection();
      return true;
    }
    return false;
  }

  getMeasures(): Measurement[] {
    return this.measures;
  }

  removeMeasure(id: number) {
    if (!this.measures.some((m) => m.id === id)) return;
    const before = this.snapshot();
    this.measures = this.measures.filter((m) => m.id !== id);
    this.syncMeasureObjects();
    this.commit(before);
    this.onChange("measures");
    this.requestRender();
  }

  clearMeasures() {
    if (!this.measures.length) return;
    const before = this.snapshot();
    this.measures = [];
    this.syncMeasureObjects();
    this.commit(before);
    this.onChange("measures");
    this.requestRender();
  }

  private addMeasure(m: Measurement) {
    const before = this.snapshot();
    this.measures = [...this.measures, m];
    this.syncMeasureObjects();
    this.commit(before);
    this.onChange("measures");
    this.requestRender();
  }

  getSnap(): SnapState | null {
    if (!this.snap) return null;
    const s = this.toScreen(this.snap.point);
    return { kind: this.snap.kind, x: s.x, y: s.y, text: this.snapText };
  }

  // --- projekce

  private toScreen(v: Vec3 | THREE.Vector3): { x: number; y: number; depth: number } {
    const p = Array.isArray(v) ? new THREE.Vector3(v[0], v[1], v[2]) : v.clone();
    const depth = p.clone().sub(this.camera.position).dot(new THREE.Vector3(0, 0, -1).applyQuaternion(this.camera.quaternion));
    p.project(this.camera);
    return { x: ((p.x + 1) / 2) * this.width, y: ((1 - p.y) / 2) * this.height, depth };
  }

  /** Je bod vidět (nic ho nezakrývá)? */
  private visibleAt(point: Vec3): boolean {
    const s = this.toScreen(point);
    const hit = this.raycastParts(s.x, s.y);
    if (!hit) return true;
    const eps = this.modelSphere.radius * 2e-3 + this.worldPerPx() * 1.5;
    return s.depth <= this.toScreen(hit.point).depth + eps;
  }

  /**
   * Najde místo k uchopení pod kurzorem podle nástroje a výběrového filtru (ZW3D):
   * roh, střed křivosti (kružnice, oblouk, osa válce), střed hrany, bod na hraně, plocha.
   * Počítá i s řezem — obrys řezu (hrany, rohy, díry v řezu) a vybarvená plocha řezu.
   */
  private findSnap(x: number, y: number, alt: boolean, purpose: "distance" | "diameter" | "angle" | "entity" = this.tool === "select" ? "entity" : this.tool): SnapPoint | null {
    const tol = this.touchMode ? 22 : 11;
    const F = this.filter;
    const auto = F === "auto" || F === "shape" || F === "part" || F === "assembly";
    const pointy = purpose === "distance" || purpose === "entity";
    const allowVertex = pointy && !alt && (auto || F === "vertex");
    const allowCenter = !alt && (auto ? pointy : F === "center") && purpose !== "angle";
    const allowMid = pointy && !alt && (auto || F === "midpoint");
    const allowEdge = auto || F === "edge" || (F === "center" && purpose !== "angle");
    const allowFace = auto || F === "face" || F === "center";
    const hit = this.raycastParts(x, y);
    const wpp = this.worldPerPx();
    const plane = this.clipPlane;
    const eps = this.modelSphere.radius * 1e-5;
    const kept = (px: number, py: number, pz: number) => !plane || plane.normal.x * px + plane.normal.y * py + plane.normal.z * pz + plane.constant >= -eps;

    interface Cand { kind: SnapKind; point: Vec3; part: number; d: number; pri: number; check: Vec3; geometry?: SnapGeometry }
    const cands: Cand[] = [];
    const m = this.camera.matrixWorldInverse.clone().premultiply(this.camera.projectionMatrix).elements;
    const proj = (px: number, py: number, pz: number): [number, number] => {
      const w = m[3] * px + m[7] * py + m[11] * pz + m[15];
      const nx = (m[0] * px + m[4] * py + m[8] * pz + m[12]) / w;
      const ny = (m[1] * px + m[5] * py + m[9] * pz + m[13]) / w;
      return [((nx + 1) / 2) * this.width, ((1 - ny) / 2) * this.height];
    };

    const collect = (t: SectionTopology, part: number) => {
      if (allowVertex) {
        for (let i = 0; i < t.corners.length; i += 3) {
          if (!kept(t.corners[i], t.corners[i + 1], t.corners[i + 2])) continue;
          const [sx, sy] = proj(t.corners[i], t.corners[i + 1], t.corners[i + 2]);
          const d = Math.hypot(sx - x, sy - y);
          if (d <= tol) {
            const pt: Vec3 = [t.corners[i], t.corners[i + 1], t.corners[i + 2]];
            cands.push({ kind: "vertex", point: pt, part, d, pri: 0, check: pt });
          }
        }
      }
      for (const c of t.curves) {
        if (allowCenter && c.center && (c.kind === "circle" || c.kind === "arc") && kept(c.mid[0], c.mid[1], c.mid[2])) {
          const [sx, sy] = proj(c.center[0], c.center[1], c.center[2]);
          const d = Math.hypot(sx - x, sy - y);
          if (d <= tol) cands.push({ kind: "center", point: c.center, part, d, pri: 1, check: c.mid, geometry: circleGeom(c) });
        }
        if (allowMid && !c.closed && c.kind !== "circle" && kept(c.mid[0], c.mid[1], c.mid[2])) {
          const [sx, sy] = proj(c.mid[0], c.mid[1], c.mid[2]);
          const d = Math.hypot(sx - x, sy - y);
          if (d <= tol * 0.8) cands.push({ kind: "midpoint", point: c.mid, part, d, pri: 2, check: c.mid, geometry: lineGeom(c) ?? circleOrNone(c) });
        }
      }
      if (!allowEdge && !allowCenter) return;
      const seg = t.edgeSegments;
      for (let s = 0; s < seg.length; s += 6) {
        const [ax, ay] = proj(seg[s], seg[s + 1], seg[s + 2]);
        const [bx, by] = proj(seg[s + 3], seg[s + 4], seg[s + 5]);
        const vx = bx - ax;
        const vy = by - ay;
        const l2 = vx * vx + vy * vy;
        let u = l2 > 0 ? ((x - ax) * vx + (y - ay) * vy) / l2 : 0;
        u = Math.max(0, Math.min(1, u));
        const d = Math.hypot(ax + vx * u - x, ay + vy * u - y);
        if (d > tol) continue;
        const pt: Vec3 = [seg[s] + (seg[s + 3] - seg[s]) * u, seg[s + 1] + (seg[s + 4] - seg[s + 1]) * u, seg[s + 2] + (seg[s + 5] - seg[s + 2]) * u];
        if (!kept(pt[0], pt[1], pt[2])) continue;
        const curve = t.curves[t.segCurve[s / 6]];
        const isCircle = !!curve && (curve.kind === "circle" || curve.kind === "arc") && !!curve.center;
        if (purpose === "diameter") {
          if (isCircle && F === "center") cands.push({ kind: "center", point: curve.center!, part, d, pri: 1, check: pt, geometry: circleGeom(curve) });
          else if (isCircle && allowEdge) cands.push({ kind: "edge", point: pt, part, d, pri: 1, check: pt, geometry: circleGeom(curve) });
          continue;
        }
        if (purpose === "angle") {
          if (allowEdge && curve?.kind === "line") cands.push({ kind: "edge", point: pt, part, d, pri: 1, check: pt, geometry: lineGeom(curve) });
          continue;
        }
        // na kružnici / oblouku: střed (díry) — automaticky nebo s filtrem „Střed křivosti"
        if (isCircle && allowCenter && (F === "center" || (auto && !alt))) {
          cands.push({ kind: "center", point: curve.center!, part, d, pri: 1.5, check: pt, geometry: circleGeom(curve) });
        } else if (allowEdge && F !== "center") {
          const geometry = curve?.kind === "line" ? lineGeom(curve) : isCircle ? circleGeom(curve) : undefined;
          cands.push({ kind: "edge", point: pt, part, d, pri: 3, check: pt, geometry: geometry ? { ...geometry, curveLength: curve?.length } : { curveLength: curve?.length } });
        }
      }
    };

    for (const p of this.parts) {
      if (p.hidden) continue;
      const [cx, cy] = proj(p.sphere.center.x, p.sphere.center.y, p.sphere.center.z);
      if (Math.hypot(cx - x, cy - y) > p.sphere.radius / wpp + tol) continue;
      collect(p.topo, p.index);
      const st = this.sectionTopo.get(p.index);
      if (st) collect(st, p.index);
    }
    cands.sort((a, b) => a.pri - b.pri || a.d - b.d);
    for (const c of cands.slice(0, 8)) {
      if (this.visibleAt(c.check)) return { kind: c.kind, point: c.point, part: c.part, geometry: c.geometry };
    }
    if (!hit || !allowFace) return null;
    const p = this.parts[hit.part];
    const geometry: SnapGeometry = {};
    if (hit.cap && plane) {
      // plocha řezu
      geometry.plane = { normal: [plane.normal.x, plane.normal.y, plane.normal.z], point: [hit.point.x, hit.point.y, hit.point.z] };
      geometry.sectionCap = true;
    } else {
      const fi = p.topo.triFace[hit.tri];
      const f = fi !== undefined ? p.topo.faces[fi] : undefined;
      if (f?.kind === "plane" && f.normal && f.point) geometry.plane = { normal: f.normal, point: f.point };
      if (f?.kind === "cylinder" && f.normal && f.point && f.radius) geometry.cylinder = { axis: f.normal, point: f.point, radius: f.radius };
      geometry.faceIndex = fi;
      if (f) geometry.faceArea = f.area;
    }
    const pt: Vec3 = [hit.point.x, hit.point.y, hit.point.z];
    if (F === "center") {
      // střed křivosti válcové plochy = bod na ose v rovině kurzoru
      const cyl = geometry.cylinder;
      if (!cyl) return null;
      const ax = new THREE.Vector3(...cyl.axis).normalize();
      const o = new THREE.Vector3(...cyl.point);
      const c = o.addScaledVector(ax, new THREE.Vector3(...pt).sub(new THREE.Vector3(...cyl.point)).dot(ax));
      return { kind: "center", point: [c.x, c.y, c.z], part: hit.part, geometry: { ...geometry, circle: { center: [c.x, c.y, c.z], normal: cyl.axis, radius: cyl.radius, full: true } } };
    }
    if (purpose === "diameter" && !geometry.cylinder) return null;
    if (purpose === "angle" && !geometry.plane && !geometry.cylinder) return null;
    return { kind: "face", point: pt, part: hit.part, geometry };
  }

  private queueHover(x: number, y: number, alt: boolean) {
    this.touchMode = false;
    this.lastPointer = { x, y };
    const cubeHit = this.inCube(x, y);
    if (cubeHit || this.cubeHover) {
      this.cubeHover = !!cubeHit;
      if (this.cube.hover(cubeHit?.u ?? null, cubeHit?.v ?? null)) this.requestRender();
      if (cubeHit) return;
    }
    const first = !this.hoverQueued;
    this.hoverQueued = { x, y, alt };
    if (first) {
      requestAnimationFrame(() => {
        const q = this.hoverQueued;
        this.hoverQueued = null;
        if (q && !this.disposed) this.doHover(q.x, q.y, q.alt);
      });
    }
  }

  private doHover(x: number, y: number, alt: boolean) {
    if (this.sectionPick) {
      const s = this.findSnap(x, y, false, "angle");
      this.updateSnap(s?.geometry?.plane ? s : null);
      this.container.style.cursor = "crosshair";
      return;
    }
    if (this.tool === "select" && ENTITY_FILTERS.includes(this.filter)) {
      this.container.style.cursor = "crosshair";
      this.updateSnap(this.findSnap(x, y, alt, "entity"));
      return;
    }
    if (this.tool === "select") {
      const hit = this.raycastParts(x, y);
      const part = hit?.part ?? null;
      if (part !== this.hoverPart) {
        const prev = this.hoverPart;
        this.hoverPart = part;
        if (prev !== null && this.parts[prev]) this.applyPartState(this.parts[prev]);
        if (part !== null) this.applyPartState(this.parts[part]);
        this.requestRender();
      }
      this.container.style.cursor = part !== null ? "pointer" : "default";
      return;
    }
    this.container.style.cursor = "crosshair";
    this.updateSnap(this.findSnap(x, y, alt));
  }

  private updateSnap(s: SnapPoint | null) {
    this.snap = s;
    this.snapText = s ? this.describeSnap(s) : "";
    // zvýraznění hrany / plochy jen při změně (ne při každém pohybu myši — velké plochy by se sekaly)
    const curve = s && this.parts[s.part] ? this.curveAt(this.parts[s.part], s) : -1;
    const key = s ? `${s.part}|${curve}|${s.kind === "face" ? (s.geometry?.faceIndex ?? -1) : -1}` : "";
    if (key !== this.snapShapeKey) {
      this.clearSnapShape();
      if (s) this.highlightSnap(s, curve);
      this.snapShapeKey = key;
    }
    if (s) {
      if (!this.snapPointObj) {
        const pg = new THREE.BufferGeometry();
        pg.setAttribute("position", new THREE.Float32BufferAttribute([0, 0, 0], 3));
        this.snapPointObj = new THREE.Points(pg, new THREE.PointsMaterial({ color: 0xff3b00, size: 9, sizeAttenuation: false, depthTest: false }));
        this.snapPointObj.renderOrder = 11;
        this.overlayGroup.add(this.snapPointObj);
      }
      const attr = this.snapPointObj.geometry.getAttribute("position") as THREE.BufferAttribute;
      attr.setXYZ(0, s.point[0], s.point[1], s.point[2]);
      attr.needsUpdate = true;
      this.snapPointObj.geometry.computeBoundingSphere();
      this.snapPointObj.visible = true;
    } else if (this.snapPointObj) {
      this.snapPointObj.visible = false;
    }
    this.requestRender();
    this.onChange("snap");
  }

  private describeSnap(s: SnapPoint): string {
    const g = s.geometry;
    const fmt = (v: number) => v.toFixed(3).replace(".", ",");
    if (s.kind === "center" && g?.circle) return `Střed ${g.circle.full ? "Ø" : "R"} ${fmt(g.circle.full ? g.circle.radius * 2 : g.circle.radius)}`;
    if (s.kind === "vertex") return "Roh";
    if (s.kind === "midpoint") return "Střed hrany";
    if (s.kind === "edge" && g?.circle) return `${g.circle.full ? "Kružnice Ø" : "Oblouk R"} ${fmt(g.circle.full ? g.circle.radius * 2 : g.circle.radius)}`;
    if (s.kind === "edge" && g?.line) return `Hrana ${fmt(g.line.length)}`;
    if (s.kind === "edge") return "Na hraně";
    if (g?.cylinder) return `Válcová plocha Ø ${fmt(g.cylinder.radius * 2)}`;
    if (g?.plane) return "Rovinná plocha";
    return "Na ploše";
  }

  private clearSnapShape() {
    if (this.snapHighlight) {
      this.overlayGroup.remove(this.snapHighlight);
      disposeObject(this.snapHighlight);
      this.snapHighlight = null;
    }
    this.snapShapeKey = "";
  }

  private clearSnapHighlight() {
    this.clearSnapShape();
    if (this.snapPointObj) this.snapPointObj.visible = false;
  }

  /** Zvýraznit hranu / plochu, na kterou se uchopuje. */
  private highlightSnap(s: SnapPoint, curveIdx: number, color = 0xff6a00) {
    const p = this.parts[s.part];
    if (!p) return;
    const group = new THREE.Group();
    group.renderOrder = 10;
    // křivka
    if (curveIdx >= 0) {
      const c = p.topo.curves[curveIdx];
      const arr = p.topo.edgeSegments.slice(c.segStart * 6, (c.segStart + c.segCount) * 6);
      const g = new THREE.BufferGeometry();
      g.setAttribute("position", new THREE.BufferAttribute(arr, 3));
      const l = new THREE.LineSegments(g, new THREE.LineBasicMaterial({ color, depthTest: false, transparent: true }));
      l.renderOrder = 10;
      group.add(l);
    } else if (s.kind === "face") {
      const fi = s.geometry?.faceIndex;
      if (fi !== undefined) {
        const tris = this.faceTriangles(p, fi);
        if (tris.length && tris.length <= FACE_HIGHLIGHT_MAX_TRIS) {
          const src = p.mesh.geometry;
          const pos = src.getAttribute("position").array as Float32Array;
          const idx = src.index ? (src.index.array as Uint32Array) : null;
          const out = new Float32Array(tris.length * 9);
          let k = 0;
          for (const t of tris) {
            for (let j = 0; j < 3; j++) {
              const v = idx ? idx[t * 3 + j] : t * 3 + j;
              out[k++] = pos[v * 3];
              out[k++] = pos[v * 3 + 1];
              out[k++] = pos[v * 3 + 2];
            }
          }
          const g = new THREE.BufferGeometry();
          g.setAttribute("position", new THREE.BufferAttribute(out, 3));
          const mesh = new THREE.Mesh(g, new THREE.MeshBasicMaterial({
            color: color === 0xff6a00 ? 0xff8a1f : color, transparent: true, opacity: 0.35, depthWrite: false, side: THREE.DoubleSide,
            polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2,
          }));
          mesh.renderOrder = 9;
          group.add(mesh);
        }
      }
    }
    this.snapHighlight = group;
    this.overlayGroup.add(group);
  }

  private curveAt(p: PartView, s: SnapPoint): number {
    if (s.kind === "face" || s.kind === "vertex") return -1;
    const g = s.geometry;
    if (!g?.circle && !g?.line) return -1;
    const ref = g.circle ? g.circle.center : g.line!.point;
    let best = -1;
    let bd = Infinity;
    p.topo.curves.forEach((c, i) => {
      const r = g.circle ? c.center : c.kind === "line" ? c.start : undefined;
      if (!r) return;
      if (g.circle && Math.abs((c.radius ?? 0) - g.circle.radius) > 1e-6) return;
      const d = Math.hypot(r[0] - ref[0], r[1] - ref[1], r[2] - ref[2]);
      if (d < bd) {
        bd = d;
        best = i;
      }
    });
    return bd < 1e-6 ? best : -1;
  }

  private faceTriangles(p: PartView, face: number): Uint32Array {
    if (!p.faceTris) {
      const tf = p.topo.triFace;
      const nf = p.topo.faces.length;
      const start = new Uint32Array(nf + 1);
      for (let t = 0; t < tf.length; t++) start[tf[t] + 1]++;
      for (let f = 0; f < nf; f++) start[f + 1] += start[f];
      const tris = new Uint32Array(tf.length);
      const fill = start.slice(0, nf);
      for (let t = 0; t < tf.length; t++) tris[fill[tf[t]]++] = t;
      p.faceTris = { start, tris };
    }
    const { start, tris } = p.faceTris;
    return tris.subarray(start[face] ?? 0, start[face + 1] ?? 0);
  }

  private clearHover() {
    if (this.hoverPart !== null) {
      const p = this.parts[this.hoverPart];
      this.hoverPart = null;
      if (p) this.applyPartState(p);
    }
    if (this.cube.hover(null, null)) this.cubeHover = false;
    if (this.snap) this.updateSnap(null);
    this.requestRender();
  }

  private onTap(x: number, y: number, info: { touch: boolean; additive: boolean; alt: boolean }) {
    this.touchMode = info.touch;
    const cubeHit = this.inCube(x, y);
    if (cubeHit) {
      const n = this.cube.pick(cubeHit.u, cubeHit.v);
      if (n) {
        // shora / zespodu: „nahoru" na obrazovce = +Y (u modelů Y nahoru −Z); ze stran svislá osa
        const vertical = this.zUp ? Math.abs(n.z) > 0.5 : Math.abs(n.y) > 0.5;
        let up: THREE.Vector3;
        if (!vertical) up = this.zUp ? new THREE.Vector3(0, 0, 1) : new THREE.Vector3(0, 1, 0);
        else if (this.zUp) up = new THREE.Vector3(0, n.z > 0 ? 1 : -1, 0);
        else up = new THREE.Vector3(0, 0, n.y > 0 ? -1 : 1);
        this.setViewDir(n, up, true);
      }
      return;
    }
    if (this.sectionPick) {
      const s = this.findSnap(x, y, false, "angle");
      const pl = s?.geometry?.plane;
      if (pl && s) this.sectionFromPlane(pl.normal, pl.point, s.part);
      return;
    }
    if (this.tool === "select") {
      if (ENTITY_FILTERS.includes(this.filter)) {
        const s = info.touch || !this.snap ? this.findSnap(x, y, info.alt, "entity") : this.snap;
        this.setEntity(s);
        return;
      }
      const hit = this.raycastParts(x, y);
      if (hit) this.select(this.filter === "shape" ? [hit.part] : this.filter === "assembly" ? this.assemblyGroup(hit.part) : this.partGroup(hit.part), info.additive);
      else if (!info.additive) this.clearSelection();
      return;
    }
    const s = info.touch || !this.snap ? this.findSnap(x, y, info.alt) : this.snap;
    if (!s) return;
    this.pick(s);
  }

  private pick(s: SnapPoint) {
    if (this.tool === "diameter") {
      const m = measureDiameter(s);
      if (m) this.addMeasure(m);
      return;
    }
    if (!this.pending) {
      this.pending = s;
      this.syncPending();
      this.onChange("pending");
      this.requestRender();
      return;
    }
    const a = this.pending;
    this.pending = null;
    this.syncPending();
    const m = this.tool === "angle" ? measureAngle(a, s) : measureDistance(a, s);
    if (m) this.addMeasure(m);
    this.onChange("pending");
  }

  private onDoubleTap(x: number, y: number) {
    if (this.inCube(x, y)) return;
    if (this.tool !== "select") return;
    if (!this.raycastParts(x, y)) this.fit(false, true);
  }

  private openContext(x: number, y: number, clientX: number, clientY: number) {
    if (this.inCube(x, y)) return;
    const hit = this.raycastParts(x, y);
    if (hit && !this.selection.has(hit.part) && this.tool === "select" && !ENTITY_FILTERS.includes(this.filter)) {
      this.select(this.filter === "shape" ? [hit.part] : this.filter === "assembly" ? this.assemblyGroup(hit.part) : this.partGroup(hit.part));
    }
    let facePlane: ContextRequest["facePlane"] = null;
    let face: ContextRequest["face"] = null;
    if (hit && !hit.cap) {
      const p = this.parts[hit.part];
      const fi = p.topo.triFace[hit.tri];
      const f = p.topo.faces[fi];
      if (f?.kind === "plane" && f.normal && f.point) facePlane = { normal: f.normal, point: f.point, part: hit.part };
      if (f) face = { part: hit.part, index: fi };
    }
    this.onContext({ part: hit?.part ?? null, clientX, clientY, facePlane, face });
  }

  // ------------------------------------------------------------------ výběrový filtr a entity

  setPickFilter(f: PickFilter) {
    this.filter = f;
    this.snap = null;
    this.clearSnapHighlight();
    if (!ENTITY_FILTERS.includes(f)) this.setEntity(null);
    else if (this.selection.size) this.clearSelection();
    if (this.hoverPart !== null) {
      const p = this.parts[this.hoverPart];
      this.hoverPart = null;
      if (p) this.applyPartState(p);
    }
    this.requestRender();
    this.onChange("filter");
    this.onChange("snap");
  }

  getPickFilter(): PickFilter {
    return this.filter;
  }

  private setEntityObj(obj: THREE.Object3D | null) {
    if (this.entityObj) {
      this.overlayGroup.remove(this.entityObj);
      disposeObject(this.entityObj);
    }
    this.entityObj = obj;
    if (obj) this.overlayGroup.add(obj);
  }

  /** Vybrat plochu / hranu / bod (filtr entit). */
  setEntity(s: SnapPoint | null) {
    this.entity = s;
    if (!s) this.setEntityObj(null);
    else {
      const prev = this.snapHighlight;
      const prevKey = this.snapShapeKey;
      this.snapHighlight = null;
      this.highlightSnap(s, this.parts[s.part] ? this.curveAt(this.parts[s.part], s) : -1, 0x1f6feb);
      const shape = this.snapHighlight as THREE.Object3D | null;
      if (shape) this.overlayGroup.remove(shape);
      this.snapHighlight = prev;
      this.snapShapeKey = prevKey;
      const group = new THREE.Group();
      if (shape) group.add(shape);
      const pg = new THREE.BufferGeometry();
      pg.setAttribute("position", new THREE.Float32BufferAttribute(s.point, 3));
      const pts = new THREE.Points(pg, new THREE.PointsMaterial({ color: 0x1f6feb, size: 10, sizeAttenuation: false, depthTest: false }));
      group.add(pts);
      this.setEntityObj(group);
    }
    this.requestRender();
    this.onChange("entity");
  }

  getEntity(): EntityInfo | null {
    const s = this.entity;
    if (!s) return null;
    const g = s.geometry;
    const mm = (v: number) => `${v.toFixed(3).replace(".", ",")} mm`;
    const xyz = (v: Vec3) => v.map((x) => x.toFixed(3).replace(".", ",")).join("; ");
    const rows: [string, string][] = [];
    let title = "Bod";
    if (s.kind === "face") {
      if (g?.sectionCap) title = "Plocha řezu";
      else if (g?.cylinder) {
        title = "Válcová plocha";
        rows.push(["Průměr", `Ø ${mm(g.cylinder.radius * 2)}`], ["Poloměr", `R ${mm(g.cylinder.radius)}`], ["Osa", xyz(g.cylinder.axis)]);
      } else if (g?.plane) {
        title = "Rovinná plocha";
        rows.push(["Normála", xyz(g.plane.normal)]);
      } else title = "Plocha";
      if (g?.faceArea) rows.push(["Plocha", `${(g.faceArea / 100).toFixed(3).replace(".", ",")} cm²`]);
    } else if (s.kind === "edge") {
      if (g?.circle) {
        title = g.circle.full ? "Kružnice" : "Oblouk";
        rows.push(["Průměr", `Ø ${mm(g.circle.radius * 2)}`], ["Poloměr", `R ${mm(g.circle.radius)}`], ["Střed", xyz(g.circle.center)]);
      } else if (g?.line) {
        title = "Úsečka";
        rows.push(["Délka", mm(g.line.length)], ["Směr", xyz(g.line.dir)]);
      } else title = "Hrana";
      if (g?.curveLength && !g?.line) rows.push(["Délka", mm(g.curveLength)]);
    } else if (s.kind === "center") {
      title = "Střed křivosti";
      if (g?.circle) rows.push(["Průměr", `Ø ${mm(g.circle.radius * 2)}`], ["Poloměr", `R ${mm(g.circle.radius)}`]);
    } else if (s.kind === "midpoint") title = "Střed hrany";
    else if (s.kind === "vertex") title = "Roh (bod)";
    rows.push(["X", mm(s.point[0])], ["Y", mm(s.point[1])], ["Z", mm(s.point[2])]);
    return {
      kind: s.kind, title, rows, part: s.part, plane: g?.plane && !g.sectionCap ? g.plane : undefined,
      face: s.kind === "face" && !g?.sectionCap ? g?.faceIndex : undefined,
    };
  }

  /** Měřit vzdálenost od vybrané entity (první bod hotový). */
  measureFromEntity() {
    const e = this.entity;
    if (!e) return;
    this.setTool("distance");
    this.pending = e;
    this.syncPending();
    this.onChange("pending");
  }

  // ------------------------------------------------------------------ barvy

  /** Zobrazená barva dílu (lineární) — přepsaná, ze souboru, nebo výchozí. */
  private displayColor(p: PartView): THREE.Color {
    if (p.colorOverride !== null) return new THREE.Color().setHex(p.colorOverride, THREE.SRGBColorSpace);
    return (p.origColor ?? DEFAULT_COLOR).clone();
  }

  /** Barva dílu jako sRGB hex (pro výběr barvy v kartě). */
  partColorHex(i: number): number {
    const p = this.parts[i];
    return p ? this.displayColor(p).getHex(THREE.SRGBColorSpace) : 0xb8c0ca;
  }

  hasColorChanges(): boolean {
    return this.parts.some((p) => p.colorOverride !== null || p.faceColors.size > 0);
  }

  /** Sestaví materiál / barvy vrcholů dílu podle barvy dílu a barev ploch. */
  private applyColors(p: PartView) {
    const g = p.mesh.geometry;
    const useVC = p.faceColors.size > 0 || (!!p.origVC && p.colorOverride === null);
    if (!useVC) {
      if (g.getAttribute("color")) g.deleteAttribute("color");
      p.baseMaterial = this.material(p.colorOverride !== null ? this.displayColor(p) : p.origColor, false, p.opacity);
    } else {
      const n = g.getAttribute("position").count;
      const arr = new Float32Array(n * 3);
      if (p.colorOverride === null && p.origVC && p.origVC.length === arr.length) arr.set(p.origVC);
      else {
        const c = this.displayColor(p);
        for (let i = 0; i < n; i++) {
          arr[i * 3] = c.r;
          arr[i * 3 + 1] = c.g;
          arr[i * 3 + 2] = c.b;
        }
      }
      const idx = g.index ? (g.index.array as Uint32Array) : null;
      const tmp = new THREE.Color();
      for (const [face, hex] of p.faceColors) {
        tmp.setHex(hex, THREE.SRGBColorSpace);
        for (const t of this.faceTriangles(p, face)) {
          for (let k = 0; k < 3; k++) {
            const v = idx ? idx[t * 3 + k] : t * 3 + k;
            arr[v * 3] = tmp.r;
            arr[v * 3 + 1] = tmp.g;
            arr[v * 3 + 2] = tmp.b;
          }
        }
      }
      g.setAttribute("color", new THREE.BufferAttribute(arr, 3));
      p.baseMaterial = this.material(null, true, p.opacity);
    }
    this.applyPartState(p);
  }

  private colorChange(fn: () => boolean) {
    const before = this.snapshot();
    if (!fn()) return;
    this.commit(before);
    if (this.section) this.rebuildSection(true);
    this.requestRender();
    this.onChange("colors");
  }

  /** Barva dílů (null = původní). Celý díl přebarví i plochy. */
  setPartColor(indices: number[], hex: number | null) {
    this.colorChange(() => {
      let changed = false;
      for (const i of indices) {
        const p = this.parts[i];
        if (!p) continue;
        if (p.colorOverride === hex && !p.faceColors.size) continue;
        p.colorOverride = hex;
        p.faceColors.clear();
        this.applyColors(p);
        changed = true;
      }
      return changed;
    });
  }

  /** Barva jedné plochy dílu (null = jako díl). */
  setFaceColor(part: number, face: number, hex: number | null) {
    this.colorChange(() => {
      const p = this.parts[part];
      if (!p || face < 0 || face >= p.topo.faces.length) return false;
      if (hex === null) {
        if (!p.faceColors.delete(face)) return false;
      } else {
        if (p.faceColors.get(face) === hex) return false;
        p.faceColors.set(face, hex);
      }
      this.applyColors(p);
      return true;
    });
  }

  /** Barevně odlišit díly (vybrané, jinak všechny viditelné). */
  colorPartsDistinct(indices?: number[]) {
    const list = indices?.length ? indices : this.parts.filter((p) => !p.hidden).map((p) => p.index);
    this.colorChange(() => {
      list.forEach((i, k) => {
        const p = this.parts[i];
        if (!p) return;
        p.colorOverride = COLOR_PALETTE[k % (COLOR_PALETTE.length - 2)];
        p.faceColors.clear();
        this.applyColors(p);
      });
      return list.length > 0;
    });
  }

  /** Barevně odlišit plochy dílů (vybraných, jinak všech viditelných). */
  colorFacesDistinct(indices?: number[]) {
    const list = indices?.length ? indices : this.parts.filter((p) => !p.hidden).map((p) => p.index);
    this.colorChange(() => {
      let changed = false;
      for (const i of list) {
        const p = this.parts[i];
        if (!p || !p.topo.faces.length) continue;
        p.faceColors = new Map(p.topo.faces.map((_, f) => [f, COLOR_PALETTE[f % (COLOR_PALETTE.length - 2)]]));
        this.applyColors(p);
        changed = true;
      }
      return changed;
    });
  }

  /** Původní barvy ze souboru (vybrané díly, jinak všechny). */
  resetColors(indices?: number[]) {
    const list = indices?.length ? indices : this.parts.map((p) => p.index);
    this.colorChange(() => {
      let changed = false;
      for (const i of list) {
        const p = this.parts[i];
        if (!p || (p.colorOverride === null && !p.faceColors.size)) continue;
        p.colorOverride = null;
        p.faceColors.clear();
        this.applyColors(p);
        changed = true;
      }
      return changed;
    });
  }

  // ------------------------------------------------------------------ řez

  getSection(): SectionState | null {
    if (!this.section) return null;
    const [min, max] = this.sectionRange(this.section.normal);
    return {
      normal: [this.section.normal.x, this.section.normal.y, this.section.normal.z],
      position: this.section.position, min, max, flipped: this.section.flipped, label: this.section.label,
    };
  }

  isSectionPicking(): boolean {
    return this.sectionPick;
  }

  /** Rozsah modelu (viditelné díly) podél normály. */
  private sectionRange(n: THREE.Vector3): [number, number] {
    const b = this.visibleBox();
    if (b.isEmpty()) return [-1, 1];
    let min = Infinity;
    let max = -Infinity;
    for (let i = 0; i < 8; i++) {
      const v = new THREE.Vector3(i & 1 ? b.max.x : b.min.x, i & 2 ? b.max.y : b.min.y, i & 4 ? b.max.z : b.min.z);
      const d = v.dot(n);
      min = Math.min(min, d);
      max = Math.max(max, d);
    }
    return [min, max];
  }

  /** Řez standardní rovinou (XY = normála Z …) v polovině modelu. */
  setSectionAxis(axis: "x" | "y" | "z") {
    const n = axis === "x" ? new THREE.Vector3(1, 0, 0) : axis === "y" ? new THREE.Vector3(0, 1, 0) : new THREE.Vector3(0, 0, 1);
    const [min, max] = this.sectionRange(n);
    const label = axis === "z" ? "Rovina XY" : axis === "y" ? "Rovina XZ" : "Rovina YZ";
    this.setSection(n, (min + max) / 2, label);
  }

  /** Řez rovnoběžně s plochou — první poloha uprostřed dílu (hned je vidět dovnitř). */
  sectionFromPlane(normal: Vec3, point: Vec3, part?: number) {
    const n = new THREE.Vector3(...normal).normalize();
    const at = new THREE.Vector3(...point).dot(n);
    let pos = at;
    if (part !== undefined && this.parts[part]) {
      const [min, max] = this.boxRange(this.parts[part].box, n);
      // plocha je na jednom konci dílu → jít do poloviny k druhému
      pos = Math.abs(at - max) < Math.abs(at - min) ? (at + min) / 2 : (at + max) / 2;
    }
    // vybraná plocha je teď odříznutá → zrušit její zvýraznění
    if (this.entity) this.setEntity(null);
    this.setSection(n, pos, "Rovina plochy");
  }

  private boxRange(b: THREE.Box3, n: THREE.Vector3): [number, number] {
    let min = Infinity;
    let max = -Infinity;
    for (let i = 0; i < 8; i++) {
      const d = new THREE.Vector3(i & 1 ? b.max.x : b.min.x, i & 2 ? b.max.y : b.min.y, i & 4 ? b.max.z : b.min.z).dot(n);
      min = Math.min(min, d);
      max = Math.max(max, d);
    }
    return [min, max];
  }

  startSectionPick() {
    this.sectionPick = true;
    this.onChange("section");
  }

  cancelSectionPick() {
    if (!this.sectionPick) return;
    this.sectionPick = false;
    this.updateSnap(null);
    this.onChange("section");
  }

  private setSection(n: THREE.Vector3, position: number, label: string) {
    const was = !!this.clipPlane;
    this.sectionPick = false;
    this.section = { normal: n.clone().normalize(), position, flipped: this.section?.flipped ?? false, label };
    if (!this.clipPlane) this.clipPlane = new THREE.Plane();
    this.updatePlane();
    if (!was) this.applyClipping();
    this.updateSnap(null);
    this.rebuildSection(true);
    this.onChange("section");
  }

  setSectionPosition(position: number) {
    if (!this.section) return;
    this.section.position = position;
    this.updatePlane();
    this.rebuildSection(false);
    this.onChange("section");
  }

  flipSection() {
    if (!this.section) return;
    this.section.flipped = !this.section.flipped;
    this.updatePlane();
    this.rebuildSection(true);
    this.onChange("section");
  }

  clearSection() {
    this.sectionPick = false;
    if (!this.section) return this.onChange("section");
    this.section = null;
    this.clipPlane = null;
    this.applyClipping();
    this.clearSectionObjects();
    this.updateSnap(null);
    this.onChange("section");
  }

  /** Pohled kolmo na řez (na odkrytou plochu). */
  viewSection() {
    if (!this.section) return;
    const n = this.section.normal.clone().multiplyScalar(this.section.flipped ? -1 : 1);
    const up = Math.abs(n.z) > 0.9 ? new THREE.Vector3(0, 1, 0) : new THREE.Vector3(0, 0, 1);
    this.setViewDir(n, this.zUp ? up : new THREE.Vector3(0, 1, 0), true);
  }

  /** Ponechává se strana n·p ≤ poloha (otočeno: ≥). */
  private updatePlane() {
    if (!this.section || !this.clipPlane) return;
    const { normal: n, position, flipped } = this.section;
    if (flipped) this.clipPlane.set(n.clone(), -position);
    else this.clipPlane.set(n.clone().negate(), position);
    this.requestRender();
  }

  private clearSectionObjects() {
    if (this.sectionTimer !== null) {
      window.clearTimeout(this.sectionTimer);
      this.sectionTimer = null;
    }
    for (const o of [...this.sectionGroup.children]) {
      this.sectionGroup.remove(o);
      const m = o as THREE.Mesh;
      // geometrie dílů se sdílí — mazat jen vlastní (víčko, obrys)
      if (m.userData.ownGeometry) m.geometry?.dispose();
    }
    this.sectionTopo.clear();
  }

  /** Šrafování plochy řezu (jako na výkresu) — šikmé čáry, opakuje se ve světových souřadnicích. */
  private hatchTexture(): THREE.Texture {
    if (!this.hatch) {
      const c = document.createElement("canvas");
      c.width = 64;
      c.height = 64;
      const ctx = c.getContext("2d")!;
      ctx.fillStyle = "#ffffff";
      ctx.fillRect(0, 0, 64, 64);
      ctx.strokeStyle = "#3a3f47";
      ctx.lineWidth = 5;
      for (const o of [-64, 0, 64]) {
        ctx.beginPath();
        ctx.moveTo(o, 64);
        ctx.lineTo(o + 64, 0);
        ctx.stroke();
      }
      const t = new THREE.CanvasTexture(c);
      t.wrapS = t.wrapT = THREE.RepeatWrapping;
      t.colorSpace = THREE.SRGBColorSpace;
      t.anisotropy = 4;
      this.hatch = t;
    }
    return this.hatch;
  }

  private capMaterial(p: PartView): THREE.Material {
    // světlejší odstín barvy dílu + šrafy → řez je hned poznat od ploch modelu
    const c = this.displayColor(p).lerp(new THREE.Color(1, 1, 1), 0.35);
    const key = c.getHexString();
    let m = this.capMaterials.get(key);
    if (!m) {
      m = new THREE.MeshBasicMaterial({
        color: c, map: this.hatchTexture(), side: THREE.DoubleSide, stencilWrite: true, stencilRef: 0, stencilFunc: THREE.NotEqualStencilFunc,
        stencilFail: THREE.ReplaceStencilOp, stencilZFail: THREE.ReplaceStencilOp, stencilZPass: THREE.ReplaceStencilOp,
        polygonOffset: true, polygonOffsetFactor: 1, polygonOffsetUnits: 1,
      });
      this.capMaterials.set(key, m);
    }
    return m;
  }

  /**
   * Vybarvení řezu (stencil: zadní stěny +1, přední −1 → uvnitř tělesa ≠ 0 → víčko v rovině řezu)
   * a obrys řezu (čáry + uchopení). Víčka hned, obrys po krátké pauze (posuvník).
   */
  private rebuildSection(immediate: boolean) {
    if (!this.section || !this.clipPlane) return;
    // víčka a stencil
    for (const o of [...this.sectionGroup.children]) {
      if (o.userData.kind === "cap" || o.userData.kind === "stencil") {
        this.sectionGroup.remove(o);
        if (o.userData.ownGeometry) (o as THREE.Mesh).geometry.dispose();
      }
    }
    const plane = this.clipPlane;
    const size = this.modelSphere.radius * 4 + 1;
    const capGeom = new THREE.PlaneGeometry(size, size);
    // šrafy po ~1/40 velikosti modelu
    this.hatchTexture().repeat.set(size / (this.modelSphere.radius / 20), size / (this.modelSphere.radius / 20));
    const center = plane.projectPoint(this.modelSphere.center, new THREE.Vector3());
    const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 0, 1), plane.normal);
    let k = 0;
    let firstCap = true;
    for (const p of this.parts) {
      if (p.hidden || this.triCount(p.index) === 0) continue;
      if (!plane.intersectsBox(p.box)) continue;
      const base = 1000 + k * 3;
      k++;
      const back = new THREE.Mesh(p.mesh.geometry, this.stencilBack);
      const front = new THREE.Mesh(p.mesh.geometry, this.stencilFront);
      back.renderOrder = base;
      front.renderOrder = base;
      back.userData.kind = front.userData.kind = "stencil";
      const cap = new THREE.Mesh(capGeom, this.capMaterial(p));
      cap.position.copy(center);
      cap.quaternion.copy(q);
      cap.renderOrder = base + 1;
      cap.userData.kind = "cap";
      if (firstCap) {
        cap.userData.ownGeometry = true;
        firstCap = false;
      }
      cap.userData.part = p.index;
      this.sectionGroup.add(back, front, cap);
    }
    if (firstCap) capGeom.dispose();
    this.requestRender();
    // obrys řezu
    if (this.sectionTimer !== null) window.clearTimeout(this.sectionTimer);
    const run = () => {
      this.sectionTimer = null;
      this.rebuildContours();
    };
    if (immediate) run();
    else this.sectionTimer = window.setTimeout(run, 90);
  }

  private rebuildContours() {
    for (const o of [...this.sectionGroup.children]) {
      if (o.userData.kind === "contour") {
        this.sectionGroup.remove(o);
        (o as THREE.LineSegments).geometry.dispose();
      }
    }
    this.sectionTopo.clear();
    const plane = this.clipPlane;
    if (!plane) return;
    const def = { normal: [plane.normal.x, plane.normal.y, plane.normal.z] as Vec3, constant: plane.constant };
    const tol = Math.max(this.modelSphere.radius * 1e-6, 1e-6);
    for (const p of this.parts) {
      if (p.hidden || this.triCount(p.index) === 0 || !plane.intersectsBox(p.box)) continue;
      const g = p.mesh.geometry;
      const segs = sliceMesh(g.getAttribute("position").array as Float32Array, g.index ? (g.index.array as Uint32Array) : null, def);
      if (!segs.length) continue;
      const topo = chainSegments(segs, tol);
      this.sectionTopo.set(p.index, topo);
      const lg = new THREE.BufferGeometry();
      lg.setAttribute("position", new THREE.BufferAttribute(topo.edgeSegments, 3));
      const lines = new THREE.LineSegments(lg, this.sectionLineMaterial);
      lines.renderOrder = 90000;
      lines.userData.kind = "contour";
      lines.userData.ownGeometry = true;
      this.sectionGroup.add(lines);
    }
    this.requestRender();
  }

  // ------------------------------------------------------------------ objekty měření

  private clearMeasureObjects() {
    for (const { obj, label } of this.measureObjects.values()) {
      this.overlayGroup.remove(obj);
      disposeObject(obj);
      label.remove();
    }
    this.measureObjects.clear();
    this.syncPending();
  }

  private syncPending() {
    if (this.pendingObj) {
      this.overlayGroup.remove(this.pendingObj);
      disposeObject(this.pendingObj);
      this.pendingObj = null;
    }
    if (this.pending) {
      const g = new THREE.BufferGeometry();
      g.setAttribute("position", new THREE.Float32BufferAttribute(this.pending.point, 3));
      this.pendingObj = new THREE.Points(g, new THREE.PointsMaterial({ color: MEASURE_COLOR, size: 10, sizeAttenuation: false, depthTest: false }));
      this.pendingObj.renderOrder = 12;
      this.overlayGroup.add(this.pendingObj);
    }
  }

  private syncMeasureObjects() {
    const ids = new Set(this.measures.map((m) => m.id));
    for (const [id, { obj, label }] of this.measureObjects) {
      if (!ids.has(id)) {
        this.overlayGroup.remove(obj);
        disposeObject(obj);
        label.remove();
        this.measureObjects.delete(id);
      }
    }
    for (const m of this.measures) {
      if (this.measureObjects.has(m.id)) continue;
      const group = new THREE.Group();
      const flat = m.points.flat();
      const lg = new THREE.BufferGeometry();
      lg.setAttribute("position", new THREE.Float32BufferAttribute(flat, 3));
      const line = new THREE.Line(lg, new THREE.LineBasicMaterial({ color: MEASURE_COLOR, depthTest: false }));
      line.renderOrder = 12;
      const pg = new THREE.BufferGeometry();
      pg.setAttribute("position", new THREE.Float32BufferAttribute(flat, 3));
      const pts = new THREE.Points(pg, new THREE.PointsMaterial({ color: MEASURE_COLOR, size: 8, sizeAttenuation: false, depthTest: false }));
      pts.renderOrder = 13;
      group.add(line, pts);
      this.overlayGroup.add(group);
      const label = document.createElement("div");
      label.textContent = m.short;
      label.style.cssText =
        "position:absolute;left:0;top:0;transform:translate(-50%,-50%);padding:2px 7px;border-radius:6px;" +
        "background:rgba(31,111,235,.95);color:#fff;font:600 12px/1.4 Roboto,Arial,sans-serif;white-space:nowrap;" +
        "box-shadow:0 1px 4px rgba(0,0,0,.25);will-change:transform;";
      this.labelLayer.appendChild(label);
      this.measureObjects.set(m.id, { obj: group, label });
    }
  }

  private updateLabels() {
    for (const m of this.measures) {
      const o = this.measureObjects.get(m.id);
      if (!o) continue;
      const s = this.toScreen(m.anchor);
      const visible = s.x > -50 && s.y > -50 && s.x < this.width + 50 && s.y < this.height + 50;
      o.label.style.display = visible ? "block" : "none";
      if (visible) o.label.style.transform = `translate(${Math.round(s.x)}px, ${Math.round(s.y) - 14}px) translate(-50%,-50%)`;
    }
    if (this.snap) this.onChange("snap");
  }

  /** Obrázek pohledu (PNG data URL) — pro uložení / sdílení. */
  screenshot(): string {
    this.render();
    return this.renderer.domElement.toDataURL("image/png");
  }

  /** Klávesové zkratky (volá React vrstva). Vrací true, když byla zpracována. */
  handleKey(e: KeyboardEvent): boolean {
    const k = e.key;
    const mod = e.ctrlKey || e.metaKey;
    if (mod && (k === "z" || k === "Z") && !e.shiftKey) {
      this.undo();
      return true;
    }
    if (mod && (k === "y" || k === "Y" || ((k === "z" || k === "Z") && e.shiftKey))) {
      this.redo();
      return true;
    }
    if (mod && (k === "f" || k === "F")) {
      this.fit();
      return true;
    }
    if (mod || e.altKey) return false;
    switch (k) {
      case "Delete":
      case "Backspace":
        if (!this.hasDeletable()) return false;
        this.deleteSelected();
        return true;
      case "h":
      case "H":
        if (!this.selection.size) return false;
        this.deleteSelected();
        return true;
      case "i":
      case "I":
        if (!this.selection.size) return false;
        this.isolate([...this.selection]);
        return true;
      case "f":
      case "F":
        this.fit(this.selection.size > 0);
        return true;
      case "Escape":
        return this.cancel();
      case "1": this.setView("front"); return true;
      case "2": this.setView("back"); return true;
      case "3": this.setView("left"); return true;
      case "4": this.setView("right"); return true;
      case "5": this.setView("top"); return true;
      case "6": this.setView("bottom"); return true;
      case "0":
      case "7": this.setView("iso"); return true;
      case "m":
      case "M": this.setTool(this.tool === "distance" ? "select" : "distance"); return true;
      case "+":
      case "=": this.zoomBy(1 / 1.25); return true;
      case "-": this.zoomBy(1.25); return true;
      default:
        return false;
    }
  }

  /** Poslední pozice ukazatele (pro zkratky „na kurzor"). */
  pointer() {
    return this.lastPointer;
  }
}

function circleGeom(c: { center?: Vec3; normal?: Vec3; radius?: number; kind: string }): SnapGeometry {
  return { circle: { center: c.center!, normal: c.normal ?? [0, 0, 1], radius: c.radius ?? 0, full: c.kind === "circle" } };
}

function circleOrNone(c: { center?: Vec3; normal?: Vec3; radius?: number; kind: string }): SnapGeometry | undefined {
  return c.center && (c.kind === "circle" || c.kind === "arc") ? circleGeom(c) : undefined;
}

function lineGeom(c: { kind: string; start: Vec3; normal?: Vec3; length: number }): SnapGeometry | undefined {
  if (c.kind !== "line" || !c.normal) return undefined;
  return { line: { point: c.start, dir: c.normal, length: c.length } };
}

function disposeObject(o: THREE.Object3D) {
  o.traverse((x) => {
    const m = x as THREE.Mesh;
    if (m.geometry) m.geometry.dispose();
    const mat = m.material as THREE.Material | THREE.Material[] | undefined;
    if (Array.isArray(mat)) mat.forEach((y) => y.dispose());
    else mat?.dispose();
  });
}
