/**
 * Příprava importu v hlavním vlákně: rozpozná formát, síťové formáty převede na binární STL,
 * DXF na entity skici a u nativních formátů jiných CAD programů poradí, jak vyexportovat STEP.
 */
import { cadLocale, tr } from "../i18n";
import type { KernelImportFormat, SketchEntity } from "../types";
import { parseDXF } from "./dxf";
import { bytesToB64, parse3MF, parseGLTF, parseOBJ, parseOFF, parsePLY, parseSTL, triangleCount, writeBinarySTL, type TriMesh } from "./mesh-io";

export type ImportResult =
  | { kind: "body"; format: KernelImportFormat; data: string; fileName: string; note?: string }
  | { kind: "sketch"; name: string; entities: SketchEntity[]; note?: string }
  | { kind: "unsupported"; message: string };

/** Hodnota atributu accept pro <input type="file">. */
export const IMPORT_EXTENSIONS = [
  ".mncad", ".json",
  ".step", ".stp", ".brep", ".brp", ".igs", ".iges",
  ".stl", ".obj", ".3mf", ".gltf", ".glb", ".ply", ".off",
  ".dxf",
  // nativní formáty – jen vysvětlení, jak exportovat
  ".sldprt", ".sldasm", ".ipt", ".iam", ".z3", ".z3prt", ".z3asm", ".catpart", ".catproduct", ".prt", ".asm", ".x_t", ".x_b", ".par", ".psm", ".f3d", ".skp", ".3dm", ".dwg", ".ifc", ".jt", ".sat", ".sab", ".3ds", ".fbx", ".dae", ".blend",
];
export const IMPORT_ACCEPT = IMPORT_EXTENSIONS.join(",");

/** Shrnutí podporovaných formátů pro UI. */
export const IMPORT_SUMMARY = {
  exact: "STEP, IGES, BREP",
  mesh: "STL, OBJ, 3MF, glTF/GLB, PLY, OFF",
  sketch: "DXF",
};

const NATIVE: Record<string, { app: string; how: string }> = {
  sldprt: { app: "SolidWorks (díl)", how: tr("V SolidWorksu: Soubor → Uložit jako → typ „STEP AP214 (*.step)“.") },
  sldasm: { app: "SolidWorks (sestava)", how: tr("V SolidWorksu: Soubor → Uložit jako → „STEP AP214 (*.step)“ (sestava se uloží jako jeden soubor).") },
  slddrw: { app: "SolidWorks (výkres)", how: tr("Výkres uložte jako DXF (Soubor → Uložit jako → DXF) nebo 3D model jako STEP.") },
  ipt: { app: "Autodesk Inventor (díl)", how: tr("V Inventoru: Soubor → Exportovat → Formát CAD → typ „STEP (*.stp)“.") },
  iam: { app: "Autodesk Inventor (sestava)", how: tr("V Inventoru: Soubor → Exportovat → Formát CAD → „STEP (*.stp)“.") },
  idw: { app: "Autodesk Inventor (výkres)", how: tr("Výkres exportujte jako DXF (Soubor → Exportovat → Formát DWG/DXF) nebo model jako STEP.") },
  z3: { app: "ZW3D", how: tr("V ZW3D: Soubor → Export → typ „STEP File (*.stp)“.") },
  z3prt: { app: "ZW3D (díl)", how: tr("V ZW3D: Soubor → Export → „STEP File (*.stp)“.") },
  z3asm: { app: "ZW3D (sestava)", how: tr("V ZW3D: Soubor → Export → „STEP File (*.stp)“.") },
  catpart: { app: "CATIA V5 (díl)", how: tr("V CATII: File → Save As → typ „stp“.") },
  catproduct: { app: "CATIA V5 (sestava)", how: tr("V CATII: File → Save As → typ „stp“.") },
  prt: { app: "PTC Creo / NX (díl)", how: tr("V Creu: Soubor → Uložit kopii → „STEP (*.stp)“; v NX: File → Export → STEP.") },
  asm: { app: "PTC Creo / Solid Edge (sestava)", how: tr("Použijte Soubor → Uložit kopii / Uložit jako → STEP (*.stp).") },
  x_t: { app: "Parasolid (text)", how: tr("Parasolid vyžaduje licencované jádro Siemens. Ve zdrojovém programu exportujte STEP AP214.") },
  x_b: { app: "Parasolid (binární)", how: tr("Parasolid vyžaduje licencované jádro Siemens. Ve zdrojovém programu exportujte STEP AP214.") },
  par: { app: "Solid Edge (díl)", how: tr("V Solid Edge: Uložit jako → typ „STEP (*.stp)“.") },
  psm: { app: "Solid Edge (plechový díl)", how: tr("V Solid Edge: Uložit jako → typ „STEP (*.stp)“.") },
  f3d: { app: "Autodesk Fusion", how: tr("Ve Fusion: Soubor → Exportovat → typ „STEP (*.step)“.") },
  skp: { app: "SketchUp", how: tr("Ve SketchUpu: Soubor → Exportovat → 3D model → „OBJ“ nebo „STL“, ty pak otevřete zde.") },
  "3dm": { app: "Rhinoceros", how: tr("V Rhinu: File → Export Selected → „STEP (*.stp)“.") },
  dwg: { app: "AutoCAD / ZWCAD (DWG)", how: tr("Formát DWG je uzavřený (Autodesk). V AutoCADu, ZWCADu nebo DraftSightu použijte Uložit jako → „DXF (*.dxf)“ a otevřete DXF zde.") },
  ifc: { app: "BIM (IFC)", how: tr("IFC je stavební formát. Exportujte geometrii jako STEP nebo OBJ.") },
  jt: { app: "JT (Siemens)", how: tr("Ve zdrojovém programu exportujte STEP AP214.") },
  sat: { app: "ACIS (SAT)", how: tr("ACIS je licencované jádro (Spatial). Exportujte STEP AP214.") },
  sab: { app: "ACIS (SAB)", how: tr("ACIS je licencované jádro (Spatial). Exportujte STEP AP214.") },
  "3ds": { app: "3ds Max", how: tr("Exportujte model jako OBJ nebo glTF (GLB).") },
  fbx: { app: "Autodesk FBX", how: tr("Exportujte model jako OBJ nebo glTF (GLB).") },
  dae: { app: "Collada", how: tr("Exportujte model jako OBJ nebo glTF (GLB).") },
  blend: { app: "Blender", how: tr("V Blenderu: File → Export → „glTF 2.0 (.glb)“ nebo „STL“.") },
};

export function extOf(name: string) {
  return name.split(".").pop()?.toLowerCase() ?? "";
}

const BIG_MESH = 60_000;

function meshBody(m: TriMesh, fileName: string, extra?: string): ImportResult {
  const n = triangleCount(m);
  const notes = [tr("Síťový model ({0} trojúhelníků) – vloženo jako těleso z plošek.", n.toLocaleString(cadLocale()))];
  if (n > BIG_MESH) notes.push(tr("Model je velký, přestavba může trvat déle."));
  if (extra) notes.push(extra);
  return { kind: "body", format: "stl", data: bytesToB64(writeBinarySTL(m)), fileName, note: notes.join(" ") };
}

/** Rozpozná formát podle přípony i obsahu a připraví data pro jádro / skicu. */
export async function prepareImport(file: File): Promise<ImportResult> {
  const ext = extOf(file.name);
  const base = file.name.replace(/\.[^.]+$/, "");
  try {
    if (NATIVE[ext]) {
      const n = NATIVE[ext];
      return {
        kind: "unsupported",
        message: tr("{0}: nativní formát programu {1} je uzavřený a v prohlížeči ho bez licencovaného převodníku nepřečte žádný CAD. {2} Pak otevřete soubor STEP zde.", file.name, n.app, n.how),
      };
    }
    const buf = new Uint8Array(await file.arrayBuffer());
    const head = new TextDecoder().decode(buf.subarray(0, 256));
    switch (ext) {
      case "step":
      case "stp":
        if (!/ISO-10303-21/.test(head)) throw new Error(tr("Soubor nevypadá jako STEP (chybí hlavička ISO-10303-21)."));
        return { kind: "body", format: "step", data: bytesToB64(buf), fileName: file.name };
      case "brep":
      case "brp":
        if (!/DBRep_DrawableShape|CASCADE Topology/.test(head)) throw new Error(tr("Soubor nevypadá jako BREP OpenCascade."));
        return { kind: "body", format: "brep", data: bytesToB64(buf), fileName: file.name };
      case "igs":
      case "iges": {
        const { igesToMesh } = await import("./occt");
        return meshBody(await igesToMesh(buf), file.name, tr("IGES převeden přes OpenCascade na síť."));
      }
      case "stl":
        return meshBody(parseSTL(buf), file.name);
      case "obj":
        return meshBody(parseOBJ(new TextDecoder().decode(buf)), file.name);
      case "off":
        return meshBody(parseOFF(new TextDecoder().decode(buf)), file.name);
      case "ply":
        return meshBody(parsePLY(buf), file.name);
      case "gltf":
      case "glb":
        return meshBody(parseGLTF(buf), file.name, tr("glTF je v metrech – převedeno na mm (×1000), osa Y → Z."));
      case "3mf":
        return meshBody(await parse3MF(buf), file.name);
      case "dxf": {
        const res = parseDXF(new TextDecoder().decode(buf));
        if (!res.entities.length) throw new Error(tr("DXF neobsahuje čáry, kružnice ani oblouky."));
        const skipped = Object.entries(res.skipped).map(([k, v]) => `${k} ×${v}`);
        return {
          kind: "sketch",
          name: base,
          entities: res.entities,
          note: tr("Načteno {0} entit{1}.", res.entities.length, skipped.length ? tr("; přeskočeno: {0}", skipped.join(", ")) : ""),
        };
      }
      default:
        return { kind: "unsupported", message: tr("Formát .{0} není podporovaný. Otevřete STEP, IGES, BREP, STL, OBJ, 3MF, glTF/GLB, PLY, OFF nebo DXF.", ext || "?") };
    }
  } catch (e) {
    return { kind: "unsupported", message: `${file.name}: ${e instanceof Error ? e.message : tr("soubor se nepodařilo načíst.")}` };
  }
}
