/** Export tělesa do 3D formátů (běží ve workeru nebo v Node; předpokládá setOC). */
import * as r from "replicad";
import type { ExportFormat } from "../types";
import { write3MF, writeBinarySTL, writeGLB, writeOBJ, writeWRL, type NormalMesh } from "./mesh-io";

export const EXPORT_FORMATS: { id: ExportFormat; ext: string; mime: string; label: string; hint: string }[] = [
  { id: "step", ext: "step", mime: "application/step", label: "STEP AP214 (.step)", hint: "CAD/CAM – SolidWorks, Inventor, ZW3D, CATIA, Fusion" },
  { id: "brep", ext: "brep", mime: "application/octet-stream", label: "BREP OpenCascade (.brep)", hint: "Přesná geometrie pro FreeCAD/OCCT" },
  { id: "stl", ext: "stl", mime: "model/stl", label: "STL binární (.stl)", hint: "3D tisk, CAM" },
  { id: "3mf", ext: "3mf", mime: "model/3mf", label: "3MF (.3mf)", hint: "3D tisk – PrusaSlicer, Cura, Bambu" },
  { id: "obj", ext: "obj", mime: "model/obj", label: "OBJ (.obj)", hint: "Vizualizace, Blender" },
  { id: "glb", ext: "glb", mime: "model/gltf-binary", label: "glTF binární (.glb)", hint: "Web, AR, prezentace (metry, Y nahoru)" },
  { id: "wrl", ext: "wrl", mime: "model/vrml", label: "VRML 2.0 (.wrl)", hint: "Starší prohlížeče a CAE" },
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

export async function exportShape(shape: r.Shape3D, format: ExportFormat, name: string): Promise<ArrayBuffer> {
  const enc = new TextEncoder();
  switch (format) {
    case "step":
      return shape.blobSTEP().arrayBuffer();
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
      throw new Error(`Neznámý formát exportu: ${String(format)}`);
  }
}
