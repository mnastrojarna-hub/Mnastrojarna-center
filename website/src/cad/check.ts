/**
 * Kontrola výsledku geometrické operace: platnost (BRepCheck), počet solidů / skořepin a „podpis“ tělesa
 * (objem, počet ploch a hran) pro zjištění, že operace těleso vůbec nezměnila.
 *
 * Proč: jádro (OCCT) umí vrátit těleso bez chyby i tehdy, když booleovská operace selhala (vrátí původní tvar),
 * nebo vrátí neplatnou geometrii (sebeprotínající plochy), se kterou pak selže export STEP. Stav „✓“ u prvku
 * musí znamenat, že výsledek je platné objemové těleso a že se operace skutečně projevila.
 */
import { tr } from "./i18n";
import * as r from "replicad";

export type Shape = r.Shape3D;
type OC = {
  BRepCheck_Analyzer: new (s: unknown, geom: boolean) => { IsValid(): boolean; delete(): void };
  TopExp_Explorer: new () => { Init(s: unknown, kind: unknown, avoid: unknown): void; More(): boolean; Next(): void; Current(): unknown; delete(): void };
  TopAbs_ShapeEnum: Record<string, unknown>;
  ShapeFix_Solid: new (s: unknown) => { Perform(p: unknown): boolean; Solid(): unknown; delete(): void };
  Message_ProgressRange: new () => unknown;
};
const oc = () => r.getOC() as unknown as OC;

export type ShapeCheck = {
  /** BRepCheck_Analyzer (topologie i geometrie) */
  valid: boolean;
  solids: number;
  shells: number;
  faces: number;
};

/** Počet podtvarů daného druhu. */
export function countSub(shape: r.AnyShape, kind: "SOLID" | "SHELL" | "FACE" | "EDGE"): number {
  const o = oc();
  const ex = new o.TopExp_Explorer();
  let n = 0;
  try {
    ex.Init(shape.wrapped, o.TopAbs_ShapeEnum[`TopAbs_${kind}`], o.TopAbs_ShapeEnum.TopAbs_SHAPE);
    while (ex.More()) {
      n++;
      ex.Next();
    }
  } finally {
    ex.delete();
  }
  return n;
}

/** Platnost tvaru podle BRepCheck_Analyzer (včetně geometrických kontrol: sebeprotínající dráty, neorientovatelné plochy). */
export function isValidShape(shape: r.AnyShape): boolean {
  const o = oc();
  let a: { IsValid(): boolean; delete(): void } | null = null;
  try {
    a = new o.BRepCheck_Analyzer(shape.wrapped, true);
    return a.IsValid();
  } catch {
    return false;
  } finally {
    a?.delete();
  }
}

export function checkShape(shape: r.AnyShape): ShapeCheck {
  return { valid: isValidShape(shape), solids: countSub(shape, "SOLID"), shells: countSub(shape, "SHELL"), faces: countSub(shape, "FACE") };
}

/** Pokus o opravu neplatného tělesa (ShapeFix_Solid na každém solidu). Vrátí opravené těleso jen pokud je platné. */
export function tryFixShape(shape: Shape): Shape | null {
  const o = oc();
  try {
    const solids = shape.solids;
    if (!solids.length) return null;
    const fixed: r.AnyShape[] = [];
    for (const s of solids) {
      const fix = new o.ShapeFix_Solid(s.wrapped);
      try {
        fix.Perform(new o.Message_ProgressRange());
        fixed.push(r.cast(fix.Solid() as never));
      } finally {
        fix.delete();
      }
    }
    const out = fixed.length === 1 ? fixed[0] : r.makeCompound(fixed);
    if (!r.isShape3D(out) || !isValidShape(out)) return null;
    return out;
  } catch {
    return null;
  }
}

export type ShapeSignature = { volume: number; faces: number; edges: number };

/** Podpis tělesa – objem a počty ploch / hran (levné; stačí k rozpoznání, že se operace neprojevila). */
export function signatureOf(shape: Shape | null): ShapeSignature | null {
  if (!shape) return null;
  let volume = 0;
  try {
    volume = r.measureVolume(shape);
  } catch {
    volume = NaN;
  }
  return { volume, faces: countSub(shape, "FACE"), edges: countSub(shape, "EDGE") };
}

/** Stejné těleso (objem i topologie beze změny). */
export function sameSignature(a: ShapeSignature | null, b: ShapeSignature | null): boolean {
  if (!a || !b) return false;
  if (a.faces !== b.faces || a.edges !== b.edges) return false;
  if (!Number.isFinite(a.volume) || !Number.isFinite(b.volume)) return true;
  return Math.abs(a.volume - b.volume) <= 1e-9 * Math.max(1, Math.abs(a.volume));
}

/** Lidský popis stavu geometrie pro protokol a stav dokumentu. */
export function describeCheck(c: ShapeCheck): string {
  if (!c.solids) return c.shells ? tr("žádné objemové těleso – jen {0} {1} ({2} ploch)", c.shells, c.shells === 1 ? tr("plášť") : tr("pláště"), c.faces) : tr("žádné objemové těleso");
  const base = c.solids === 1 ? tr("1 těleso") : tr("{0} těles", c.solids);
  return c.valid ? tr("platná geometrie ({0})", base) : tr("NEPLATNÁ geometrie ({0}) – sebeprotínající nebo neorientovatelné plochy; export STEP může selhat", base);
}
