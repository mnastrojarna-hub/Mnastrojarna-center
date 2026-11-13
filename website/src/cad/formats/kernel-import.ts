/** Načtení importovaného tělesa v jádře (běží ve workeru i v Node). Převody ostatních formátů: ./import.ts. */
import { tr } from "../i18n";
import * as r from "replicad";
import { b64ToBytes, dataBytes, MissingBlob } from "../blobs";
import { perfMark } from "../perf-log";
import { stepIsComplete, truncatedStepText } from "./step-check";
import type { Feature } from "../types";

type ImportFeature = Extract<Feature, { type: "import" }>;

export { b64ToBytes };

export { stepIsComplete, truncatedStepText };

type OcAny = any;
const statusName = (oc: OcAny, st: unknown): string => {
  const E = oc.IFSelect_ReturnStatus ?? {};
  for (const k of Object.keys(E)) if (E[k] === st || (st && typeof st === "object" && E[k]?.value !== undefined && E[k].value === (st as { value: unknown }).value)) return k;
  return String(st);
};

/** obsazená paměť jádra (WASM) v MB */
export const wasmMB = (): number => {
  try {
    return Math.round(((r.getOC() as OcAny).wasmMemory?.buffer?.byteLength ?? 0) / 1048576);
  } catch {
    return 0;
  }
};

/** počet ploch tvaru (bez vytváření obalů replicadu) */
export function countFaces(shape: unknown, limit = Infinity): number {
  const oc = r.getOC() as OcAny;
  const en = oc.TopAbs_ShapeEnum;
  const ex = new oc.TopExp_Explorer(shape, en.TopAbs_FACE, en.TopAbs_SHAPE);
  let n = 0;
  try {
    for (; ex.More() && n < limit; ex.Next()) n++;
  } finally {
    ex.delete();
  }
  return n;
}

/**
 * STEP → těleso, s kontrolou každého kroku (replicad.importSTEP stav čtení nekontroluje – poškozený soubor pak „projde“
 * jako prázdné těleso a uživatel vidí prázdné okno). Neúplný soubor, chyba čtení, nic k přenosu a výsledek bez ploch
 * jsou srozumitelné chyby.
 */
export function importSTEPBody(bytes: Uint8Array, fileName = ""): r.Shape3D {
  if (!stepIsComplete(bytes)) throw new Error(truncatedStepText(fileName));
  const oc = r.getOC() as OcAny;
  const file = `/step_${Math.random().toString(36).slice(2)}.step`;
  oc.FS.writeFile(file, bytes);
  const reader = new oc.STEPControl_Reader();
  try {
    let t = Date.now();
    const st = statusName(oc, reader.ReadFile(file));
    perfMark("kernel.step.read", Date.now() - t, { mb: +(bytes.length / 1048576).toFixed(2), wasmMB: wasmMB() });
    if (!/RetDone/.test(st)) throw new Error(tr("Soubor {0} se nepodařilo přečíst jako STEP (stav čtení: {1}) – soubor je poškozený nebo není ve formátu STEP AP203/AP214/AP242.", fileName || "STEP", st.replace(/^IFSelect_Ret/, "")));
    try {
      oc.FS.unlink(file);
    } catch {
      /* už smazáno */
    }
    if (!(reader.NbRootsForTransfer() > 0)) throw new Error(tr("Soubor {0} neobsahuje žádný výrobek s geometrií (STEP bez tvaru).", fileName || "STEP"));
    t = Date.now();
    reader.TransferRoots(new oc.Message_ProgressRange());
    const raw = reader.OneShape();
    perfMark("kernel.step.transfer", Date.now() - t, { wasmMB: wasmMB() });
    if (!raw || raw.IsNull?.()) throw new Error(tr("Soubor {0} neobsahuje žádné plochy ani tělesa – není co zobrazit.", fileName || "STEP"));
    if (countFaces(raw, 1) === 0) {
      raw.delete?.();
      throw new Error(tr("Soubor {0} neobsahuje žádné plochy ani tělesa – není co zobrazit.", fileName || "STEP"));
    }
    const shape = r.cast(raw) as r.AnyShape;
    if (!(shape instanceof r._3DShape)) throw new Error(tr("Soubor {0} neobsahuje 3D těleso.", fileName || "STEP"));
    return shape as r.Shape3D;
  } finally {
    try {
      oc.FS.unlink(file);
    } catch {
      /* už smazáno */
    }
    reader.delete();
  }
}

/** BREP (nativní formát OpenCascade, text) → těleso. */
export function importBREP(text: string): r.Shape3D {
  const oc = r.getOC() as unknown as { BRepToolsWrapper: { Read: (s: string) => unknown } };
  let raw: unknown;
  try {
    raw = oc.BRepToolsWrapper.Read(text);
  } catch {
    raw = null;
  }
  const shape = raw ? (r.cast(raw as never) as r.AnyShape) : null;
  if (!shape || (shape as { isNull?: boolean }).isNull) throw new Error(tr("Soubor BREP se nepodařilo načíst."));
  if (!(shape instanceof r._3DShape)) throw new Error(tr("BREP neobsahuje 3D těleso."));
  return shape as r.Shape3D;
}

/**
 * STL → těleso. (replicad.importSTL v této sestavě OpenCascade selže – čtečka vrací Compound, ne Shell.)
 * Plošky se sešijí, koplanární trojúhelníky sloučí do rovinných ploch a z každé skořepiny vznikne těleso.
 */
export function importSTLBody(bytes: Uint8Array): r.Shape3D {
  const oc = r.getOC() as any;
  const E = oc.TopAbs_ShapeEnum;
  const file = `/stl_${Math.random().toString(36).slice(2)}.stl`;
  oc.FS.writeFile(file, bytes);
  const trash: { delete: () => void }[] = [];
  const keep = <T extends { delete: () => void }>(o: T) => (trash.push(o), o);
  try {
    const reader = keep(new oc.StlAPI_Reader());
    const raw = keep(new oc.TopoDS_Shell());
    if (!reader.Read(raw, file)) throw new Error(tr("Soubor STL se nepodařilo přečíst."));
    const sew = keep(new oc.BRepBuilderAPI_Sewing(1e-6, true, true, true, false));
    sew.Add(raw);
    sew.Perform();
    const sewn = keep(sew.SewedShape());
    const unify = keep(new oc.ShapeUpgrade_UnifySameDomain(sewn, true, true, false));
    unify.Build();
    const merged = keep(unify.Shape());
    const solids: r.AnyShape[] = [];
    const ex = keep(new oc.TopExp_Explorer(merged, E.TopAbs_SHELL, E.TopAbs_SHAPE));
    for (; ex.More(); ex.Next()) {
      const fix = keep(new oc.ShapeFix_Solid());
      const solid = fix.SolidFromShell(oc.TopoDS.Shell(ex.Current()));
      solids.push(r.cast(solid));
    }
    if (!solids.length) throw new Error(tr("STL neobsahuje plochy."));
    return (solids.length === 1 ? solids[0] : r.makeCompound(solids)) as r.Shape3D;
  } finally {
    try {
      oc.FS.unlink(file);
    } catch {
      /* už smazáno */
    }
    for (const o of trash) o.delete();
  }
}

export async function importBody(f: ImportFeature): Promise<r.Shape3D> {
  let bytes: Uint8Array;
  try {
    bytes = dataBytes(f.data, f.fileName);
  } catch (e) {
    if (e instanceof MissingBlob) throw new Error(tr("Data souboru {0} nejsou v paměti (dokument obnovený bez souboru) – otevřete soubor znovu.", f.fileName));
    throw e;
  }
  switch (f.format) {
    case "step":
      return importSTEPBody(bytes, f.fileName);
    case "stl":
      return importSTLBody(bytes);
    case "brep":
      return importBREP(new TextDecoder().decode(bytes));
    default:
      throw new Error(tr("Formát {0} musí být před vložením převeden (otevřete soubor znovu).", String(f.format).toUpperCase()));
  }
}
