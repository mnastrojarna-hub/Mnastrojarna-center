/** Načtení importovaného tělesa v jádře (běží ve workeru i v Node). Převody ostatních formátů: ./import.ts. */
import * as r from "replicad";
import type { Feature } from "../types";

type ImportFeature = Extract<Feature, { type: "import" }>;

export function b64ToBytes(b64: string) {
  if (typeof atob === "function") {
    const s = atob(b64);
    const u = new Uint8Array(s.length);
    for (let i = 0; i < s.length; i++) u[i] = s.charCodeAt(i);
    return u;
  }
  return new Uint8Array(Buffer.from(b64, "base64"));
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
  if (!shape || (shape as { isNull?: boolean }).isNull) throw new Error("Soubor BREP se nepodařilo načíst.");
  if (!(shape instanceof r._3DShape)) throw new Error("BREP neobsahuje 3D těleso.");
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
    if (!reader.Read(raw, file)) throw new Error("Soubor STL se nepodařilo přečíst.");
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
    if (!solids.length) throw new Error("STL neobsahuje plochy.");
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
  const bytes = b64ToBytes(f.data);
  switch (f.format) {
    case "step":
      return (await r.importSTEP(new Blob([bytes as BlobPart]))) as r.Shape3D;
    case "stl":
      return importSTLBody(bytes);
    case "brep":
      return importBREP(new TextDecoder().decode(bytes));
    default:
      throw new Error(`Formát ${String(f.format).toUpperCase()} musí být před vložením převeden (otevřete soubor znovu).`);
  }
}
