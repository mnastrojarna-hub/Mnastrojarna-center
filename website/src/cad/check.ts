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
  BRepCheck_Analyzer: new (s: unknown, geom: boolean, parallel?: boolean, exact?: boolean) => { IsValid(s?: unknown): boolean; delete(): void };
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

/**
 * Složení tvaru pro očekávaný typ výsledku prvku (feature-levels.ts): objemová tělesa, plochy mimo ně (volné plochy,
 * pláště – průzkum s vynecháním těles) a všechny plochy. Levné i u velkých těles (jen průchod topologií).
 */
export function compositionOf(shape: r.AnyShape): { solids: number; free: number; faces: number } {
  const o = oc();
  const ex = new o.TopExp_Explorer();
  let free = 0;
  try {
    ex.Init(shape.wrapped, o.TopAbs_ShapeEnum.TopAbs_FACE, o.TopAbs_ShapeEnum.TopAbs_SOLID);
    while (ex.More()) {
      free++;
      ex.Next();
    }
  } finally {
    ex.delete();
  }
  return { solids: countSub(shape, "SOLID"), free, faces: countSub(shape, "FACE") };
}

/**
 * Složení tvaru pro objemový export (vlna 22, bod 22c): objemová tělesa, skořepiny (uzavřené), skořepiny mimo tělesa
 * (volné – i uzavřená skořepina bez „Uzavřít do tělesa“ je volná) a plochy mimo skořepiny. Jen průchod topologií (levné).
 */
export type SolidComposition = { solids: number; shells: number; closedShells: number; freeShells: number; closedFree: number; freeFaces: number; faces: number };

export function solidComposition(shape: r.AnyShape): SolidComposition {
  const o = oc() as OC & { BRep_Tool: { IsClosed(s: unknown): boolean } };
  const E = o.TopAbs_ShapeEnum;
  const walk = (kind: unknown, avoid: unknown, each?: (s: unknown) => void) => {
    const ex = new o.TopExp_Explorer();
    let n = 0;
    try {
      ex.Init(shape.wrapped, kind, avoid);
      for (; ex.More(); ex.Next()) {
        n++;
        each?.(ex.Current());
      }
    } finally {
      ex.delete();
    }
    return n;
  };
  const closed = (s: unknown) => {
    try {
      return o.BRep_Tool.IsClosed(s);
    } catch {
      return false; // bez informace o uzavřenosti
    }
  };
  let closedShells = 0;
  let closedFree = 0;
  const shells = walk(E.TopAbs_SHELL, E.TopAbs_SHAPE, (s) => void (closed(s) && closedShells++));
  const freeShells = walk(E.TopAbs_SHELL, E.TopAbs_SOLID, (s) => void (closed(s) && closedFree++));
  return {
    solids: walk(E.TopAbs_SOLID, E.TopAbs_SHAPE),
    shells,
    closedShells,
    freeShells,
    closedFree,
    freeFaces: walk(E.TopAbs_FACE, E.TopAbs_SHELL),
    faces: walk(E.TopAbs_FACE, E.TopAbs_SHAPE),
  };
}

/**
 * Objem jen objemových těles tvaru (součet přes solidy) – skořepiny a plochy objem nemají (22c: „pseudoobjem“ otevřené
 * plochy nebo uzavřené skořepiny bez tělesa se do objemu a hmotnosti nepočítá). 0 solidů → 0.
 */
export function solidsVolume(shape: r.AnyShape): number {
  const o = r.getOC() as unknown as OC & { GProp_GProps: new () => { Mass(): number; delete(): void }; BRepGProp: { VolumeProperties(s: unknown, p: unknown, onlyClosed: boolean, skipShared: boolean, useTriangulation: boolean): void } };
  const ex = new o.TopExp_Explorer();
  let v = 0;
  try {
    ex.Init(shape.wrapped, o.TopAbs_ShapeEnum.TopAbs_SOLID, o.TopAbs_ShapeEnum.TopAbs_SHAPE);
    for (; ex.More(); ex.Next()) {
      const gp = new o.GProp_GProps();
      try {
        o.BRepGProp.VolumeProperties(ex.Current(), gp, false, false, false);
        v += Math.abs(gp.Mass());
      } finally {
        gp.delete();
      }
    }
  } finally {
    ex.delete();
  }
  return v;
}

/**
 * Platnost tvaru podle BRepCheck_Analyzer (včetně geometrických kontrol: sebeprotínající dráty, neorientovatelné plochy).
 * `exact` = přesná metoda (vlna 22, bod 22a): odchylka křivky hrany od plochy se počítá přesně (BRepLib_CheckCurveOnSurface),
 * ne v konečném počtu bodů – pomalejší, ale bez ní „platná“ znamená jen „platná rychlou kontrolou“.
 */
export function isValidShape(shape: r.AnyShape, exact = false): boolean {
  const o = oc();
  let a: { IsValid(): boolean; delete(): void } | null = null;
  try {
    a = exact ? new o.BRepCheck_Analyzer(shape.wrapped, true, false, true) : new o.BRepCheck_Analyzer(shape.wrapped, true);
    return a.IsValid();
  } catch {
    return false;
  } finally {
    a?.delete();
  }
}

/** výsledek přesné kontroly: platnost, počet ploch a ploch s vadou (hrana mimo plochu v toleranci, drát, orientace…) */
export type ExactCheck = { valid: boolean; faces: number; badFaces: number; ms: number };

/**
 * Přesná kontrola platnosti (BRepCheck přesnou metodou) s počtem vadných ploch. Vadná plocha = plocha, která sama nebo
 * v kontextu svých hran / drátů / vrcholů neprojde (typicky křivka hrany dál od plochy, než dovoluje tolerance hrany).
 */
export function exactCheck(shape: r.AnyShape): ExactCheck {
  const o = oc();
  const t0 = Date.now();
  let a: { IsValid(s?: unknown): boolean; delete(): void } | null = null;
  let faces = 0;
  let badFaces = 0;
  try {
    a = new o.BRepCheck_Analyzer(shape.wrapped, true, false, true);
    const valid = a.IsValid();
    const ex = new o.TopExp_Explorer();
    try {
      ex.Init(shape.wrapped, o.TopAbs_ShapeEnum.TopAbs_FACE, o.TopAbs_ShapeEnum.TopAbs_SHAPE);
      while (ex.More()) {
        faces++;
        if (!valid && !a.IsValid(ex.Current())) badFaces++;
        ex.Next();
      }
    } finally {
      ex.delete();
    }
    return { valid, faces, badFaces: valid ? 0 : Math.max(1, badFaces), ms: Date.now() - t0 };
  } catch {
    return { valid: false, faces, badFaces: Math.max(1, badFaces), ms: Date.now() - t0 };
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
