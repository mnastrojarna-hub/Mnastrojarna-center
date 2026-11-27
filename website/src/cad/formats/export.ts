/** Export tělesa do 3D formátů (běží ve workeru nebo v Node; předpokládá setOC). */
import { tr } from "../i18n";
import * as r from "replicad";
import type { ExportFormat } from "../types";
import { write3MF, writeBinarySTL, writeGLB, writeOBJ, writeWRL, type NormalMesh } from "./mesh-io";

export const EXPORT_FORMATS: { id: ExportFormat; ext: string; mime: string; label: string; hint: string }[] = [
  { id: "step", ext: "step", mime: "application/step", label: tr("STEP AP214 (.step)"), hint: tr("CAD/CAM – SolidWorks, Inventor, ZW3D, CATIA, Fusion") },
  { id: "brep", ext: "brep", mime: "application/octet-stream", label: tr("BREP OpenCascade (.brep)"), hint: tr("Přesná geometrie pro FreeCAD/OCCT") },
  { id: "stl", ext: "stl", mime: "model/stl", label: tr("STL binární (.stl)"), hint: tr("3D tisk, CAM") },
  { id: "3mf", ext: "3mf", mime: "model/3mf", label: tr("3MF (.3mf)"), hint: tr("3D tisk – PrusaSlicer, Cura, Bambu") },
  { id: "obj", ext: "obj", mime: "model/obj", label: tr("OBJ (.obj)"), hint: tr("Vizualizace, Blender") },
  { id: "glb", ext: "glb", mime: "model/gltf-binary", label: tr("glTF binární (.glb)"), hint: tr("Web, AR, prezentace (metry, Y nahoru)") },
  { id: "wrl", ext: "wrl", mime: "model/vrml", label: tr("VRML 2.0 (.wrl)"), hint: tr("Starší prohlížeče a CAE") },
];

function bboxDiag(s: r.Shape3D) {
  const [[x0, y0, z0], [x1, y1, z1]] = s.boundingBox.bounds;
  return Math.hypot(x1 - x0, y1 - y0, z1 - z0) || 100;
}

/** Síť tělesa s normálami (jemnost podle velikosti). */
export function meshOf(shape: r.Shape3D, fine = 1): NormalMesh {
  const tol = Math.max(0.005, bboxDiag(shape) / (3000 * fine));
  const m = shape.mesh({ tolerance: tol, angularTolerance: 0.15 / fine });
  return { positions: new Float32Array(m.vertices), normals: new Float32Array(m.normals), indices: new Uint32Array(m.triangles) };
}

const toBuf = (u8: Uint8Array): ArrayBuffer => (u8.byteOffset === 0 && u8.byteLength === u8.buffer.byteLength ? (u8.buffer as ArrayBuffer) : (u8.slice().buffer as ArrayBuffer));

export function exportBREP(shape: r.Shape3D): string {
  const oc = r.getOC() as unknown as { BRepToolsWrapper: { Write: (s: unknown) => string } };
  return oc.BRepToolsWrapper.Write(shape.wrapped);
}

/** krok převodu do STEP (vlna 22 kolo 7, bod 22h): průběh uvnitř převodu – přenos tvaru, zápis textu, čtení souboru */
export type StepStage = "transfer" | "write" | "read";
export const STEP_STAGES: readonly StepStage[] = ["transfer", "write", "read"];
export const stepStageText = (s: StepStage): string => (s === "transfer" ? tr("přenos tvaru do STEP") : s === "write" ? tr("zápis textu STEP") : tr("čtení zapsaného souboru"));
export type StepStageFn = (stage: StepStage, index: number, total: number, detail: string) => void;

type StepOC = {
  STEPControl_Writer: new () => { Transfer(s: unknown, mode: unknown, compgraph: boolean, p: unknown): unknown; Write(f: string): unknown; delete(): void };
  Interface_Static: { SetIVal(k: string, v: number): boolean };
  Message_ProgressRange: new () => { delete(): void };
  STEPControl_StepModelType: Record<string, unknown>;
  IFSelect_ReturnStatus: Record<string, unknown>;
  BRepCheck_Analyzer: new (s: unknown, geom: boolean, parallel?: boolean, exact?: boolean) => { IsValid(s?: unknown): boolean; delete(): void };
  TopExp_Explorer: new () => { Init(s: unknown, kind: unknown, avoid: unknown): void; More(): boolean; Next(): void; Current(): unknown; delete(): void };
  TopAbs_ShapeEnum: Record<string, unknown>;
  FS: { readFile(f: string): Uint8Array; unlink(f: string): void };
};

/** jméno stavu zapisovače (IFSelect_RetDone / RetVoid / RetError / RetFail / RetStop) – text pro diagnostiku */
function retName(oc: StepOC, v: unknown): string {
  for (const [k, x] of Object.entries(oc.IFSelect_ReturnStatus)) if (x === v && k.startsWith("IFSelect_")) return k;
  return String((v as { value?: unknown })?.value ?? v);
}

function subShapes(oc: StepOC, wrapped: unknown, kind: "SOLID" | "SHELL" | "FACE"): unknown[] {
  const ex = new oc.TopExp_Explorer();
  const out: unknown[] = [];
  try {
    ex.Init(wrapped, oc.TopAbs_ShapeEnum[`TopAbs_${kind}`], oc.TopAbs_ShapeEnum.TopAbs_SHAPE);
    for (; ex.More(); ex.Next()) out.push(ex.Current());
  } finally {
    ex.delete();
  }
  return out;
}

/** Chyba zapisovače STEP s příčinou: krok (přenos / zápis / čtení), stav jádra a složení tvaru (vlna 22 kolo 7, bod 22h). */
export class StepWriteError extends Error {
  constructor(
    message: string,
    readonly stage: StepStage,
    readonly status: string,
    readonly shape: { solids: number; shells: number; faces: number; valid: boolean; failedSolids: number[] },
  ) {
    super(message);
    this.name = "StepWriteError";
  }
}

/**
 * Zápis STEP AP214 po krocích s kontrolou stavu jádra. replicad (`blobSTEP`) stav přenosu (`Transfer`) zahazuje a při
 * chybě zápisu hlásí jen „WRITE STEP FILE FAILED.“ – tady se zkontroluje stav každého kroku, krok se ohlásí (`onStage`,
 * průběh uvnitř převodu) a chyba nese příčinu: krok, stav jádra (IFSelect_…), složení tvaru, platnost (BRepCheck) a při
 * selhání přenosu i pořadí těles, která samostatně přenést nejdou. Výstup je bajtově stejný jako dřív (stejné volby).
 */
export function writeStepFile(shape: r.AnyShape, onStage?: StepStageFn): Uint8Array {
  const oc = r.getOC() as unknown as StepOC;
  const solids = subShapes(oc, shape.wrapped, "SOLID");
  const shells = subShapes(oc, shape.wrapped, "SHELL").length;
  const faces = subShapes(oc, shape.wrapped, "FACE").length;
  const comp = tr("tělesa {0}, skořepiny {1}, plochy {2}", solids.length, shells, faces);
  const done = oc.IFSelect_ReturnStatus.IFSelect_RetDone;
  const fail = (stage: StepStage, status: string, failedSolids: number[] = []): StepWriteError => {
    let valid = false;
    try {
      const chk = new oc.BRepCheck_Analyzer(shape.wrapped, true, false);
      try {
        valid = chk.IsValid();
      } finally {
        chk.delete();
      }
    } catch {
      /* nulový tvar – analyzátor ho nepřijme */
    }
    const parts = [
      tr("tvar: {0}", comp),
      valid ? tr("tvar je platný (BRepCheck)") : tr("tvar je NEPLATNÝ (BRepCheck)"),
      ...(failedSolids.length ? [tr("samostatně nejdou přenést tělesa {0} z {1}", failedSolids.join(", "), solids.length)] : []),
    ];
    const msg = tr("zapisovač STEP: krok „{0}“ skončil stavem {1} · {2}", stepStageText(stage), status, parts.join(" · "));
    return new StepWriteError(msg, stage, status, { solids: solids.length, shells, faces, valid, failedSolids });
  };
  const transfer = (s: unknown): unknown => {
    const w = new oc.STEPControl_Writer();
    const p = new oc.Message_ProgressRange();
    try {
      oc.Interface_Static.SetIVal("write.step.schema", 5);
      return w.Transfer(s, oc.STEPControl_StepModelType.STEPControl_AsIs, true, p);
    } finally {
      w.delete();
      p.delete();
    }
  };
  const writer = new oc.STEPControl_Writer();
  const progress = new oc.Message_ProgressRange();
  // stejné jméno jako replicad (`blobSTEP`) – hlavička souboru beze změny
  const file = "blob.step";
  try {
    oc.Interface_Static.SetIVal("write.step.schema", 5);
    onStage?.("transfer", 0, STEP_STAGES.length, comp);
    const ts = writer.Transfer(shape.wrapped, oc.STEPControl_StepModelType.STEPControl_AsIs, true, progress);
    if (ts !== done) {
      // které těleso přenést nejde (jen při chybě – běžný export nic navíc nedělá)
      const bad = solids.length > 1 ? solids.map((x, i) => (transfer(x) === done ? 0 : i + 1)).filter((i) => i > 0) : [];
      throw fail("transfer", retName(oc, ts), bad);
    }
    onStage?.("write", 1, STEP_STAGES.length, "");
    const ws = writer.Write(file);
    if (ws !== done) throw fail("write", retName(oc, ws));
    onStage?.("read", 2, STEP_STAGES.length, "");
    try {
      return oc.FS.readFile(`/${file}`);
    } catch (e) {
      throw fail("read", e instanceof Error ? e.message : String(e));
    } finally {
      try {
        oc.FS.unlink(`/${file}`);
      } catch {
        /* soubor nevznikl */
      }
    }
  } finally {
    writer.delete();
    progress.delete();
  }
}

export async function exportShape(shape: r.Shape3D, format: ExportFormat, name: string, onStage?: StepStageFn): Promise<ArrayBuffer> {
  const enc = new TextEncoder();
  switch (format) {
    case "step":
      return toBuf(writeStepFile(shape, onStage));
    case "stl":
      return toBuf(writeBinarySTL(meshOf(shape), `Mnastrojarna CAD ${name}`.normalize("NFD").replace(/[^\x20-\x7e]/g, "")));
    case "brep":
      return toBuf(enc.encode(exportBREP(shape)));
    case "obj":
      return toBuf(enc.encode(writeOBJ(meshOf(shape), name)));
    case "glb":
      return toBuf(writeGLB(meshOf(shape), name));
    case "3mf":
      return toBuf(write3MF(meshOf(shape), name));
    case "wrl":
      return toBuf(enc.encode(writeWRL(meshOf(shape), name)));
    default:
      throw new Error(tr("Neznámý formát exportu: {0}", String(format)));
  }
}
