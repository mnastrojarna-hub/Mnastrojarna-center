/**
 * Kontrola exportu v jádře (worker) pro příkaz konzole `export step|brep`: stažený soubor se znovu načte jádrem a změří
 * (počet objemových těles, objem, obálka) a změří se i těleso modelu (z mezipaměti stavby – export ho právě postavil).
 *
 * Záměrně BEZ sítě a BEZ úložiště importů: dřívější cesta (prepareImport → díl s prvkem Import → asmParts) soubor
 * zasíťovala jako díl k zobrazení a jeho bajty nechala navždy v úložišti importů v UI i v jádře – u desky 330 ploch to
 * trvalo 10 s místo 0,4 s exportu a paměť rostla s každým exportem. Tady se načtené těleso po změření hned uvolní.
 */
import * as r from "replicad";
import { tr } from "./i18n";
import { shapeOfDoc } from "./asm-kernel";
import { compositionOf, exactCheck, isValidShape, solidComposition, solidsVolume } from "./check";
import { importBREP } from "./formats/kernel-import";
import type { CadDoc, Vec3 } from "./types";
import { EXACT_AUTO_FACES } from "./validity";

/**
 * Míry tvaru pro kontrolu exportu: `volume` jen z objemových těles (22c – pseudoobjem skořepin a ploch se nepočítá),
 * složení (tělesa, skořepiny, uzavřené, volné skořepiny a z nich uzavřené, plochy mimo skořepiny, plochy mimo tělesa) a platnost BRepCheck
 * (rychlá metoda). `validExact` = přesná metoda BRepCheck (vlna 22, bod 22a, fáze 2): u souboru vždy do `EXACT_AUTO_FACES`
 * ploch – čtečka STEP umí nastavit tolerance hran menší než skutečná odchylka křivek, takže soubor přesně platného modelu
 * po zpětném načtení přesnou kontrolou neprojde; „věrná kopie“ se pak napsat nesmí. `null` = přesná kontrola neproběhla
 * (ploch nad mez), `badFaces` = vadných ploch podle přesné kontroly, `faces` = počet ploch.
 */
export type KernelShapeStats = {
  solids: number;
  volume: number;
  bbox: [Vec3, Vec3];
  shells: number;
  closedShells: number;
  freeShells: number;
  closedFree: number;
  freeFaces: number;
  free: number;
  valid: boolean | null;
  faces: number;
  validExact: boolean | null;
  badFaces?: number;
  /** největší tolerance hran a vrcholů tvaru [mm] (u modelu, když soubor přesnou kontrolou neprojde – mez pro `retolMaxTol`) */
  maxTol?: number;
  /** soubor: přesná kontrola po přepočtu tolerancí načteného tvaru (`retolExact`) – výsledek, vadných ploch, největší tolerance hran a vrcholů po přepočtu [mm] */
  retolValid?: boolean;
  retolBadFaces?: number;
  retolMaxTol?: number;
  /**
   * Odchylka křivek hran od ploch (`edgeDeviation`, jen když soubor neprojde ani po přepočtu): největší naměřená [mm] (model
   * i soubor stejným počtem vzorků `devSamples` na hranu); u souboru `devOver` = dvojic hrana × plocha na plochách vadných
   * po přepočtu, kde naměřená odchylka přesahuje toleranci hrany.
   */
  devMax?: number;
  devOver?: number;
  devSamples?: number;
};

/** nad kolik ploch se platnost souboru při kontrole exportu nekontroluje (drahé) – `valid: null` */
export const EXPORT_VALID_FACES = 3000;

const free = (s: unknown) => {
  try {
    (s as { delete?: () => void } | null)?.delete?.();
  } catch {
    /* už uvolněno */
  }
};

/** objem těles (přesně z B-rep), obálka (přesná – fastbox), složení a platnost; `exact` = i přesná kontrola (do `EXACT_AUTO_FACES` ploch) */
export function shapeStats(s: r.AnyShape, exact = false): KernelShapeStats {
  let volume = 0;
  try {
    volume = solidsVolume(s); // jen tělesa – skořepina / plocha objem nemá
  } catch {
    volume = 0;
  }
  const b = (s as r.Shape3D).boundingBox.bounds as [Vec3, Vec3];
  const c = solidComposition(s);
  const free = compositionOf(s).free;
  const valid = c.faces <= EXPORT_VALID_FACES ? isValidShape(s) : null;
  const x = exact && c.faces <= EXACT_AUTO_FACES ? exactCheck(s) : null;
  return { solids: c.solids, volume, bbox: [[b[0][0], b[0][1], b[0][2]], [b[1][0], b[1][1], b[1][2]]], shells: c.shells, closedShells: c.closedShells, freeShells: c.freeShells, closedFree: c.closedFree, freeFaces: c.freeFaces, free, valid, faces: c.faces, validExact: x ? x.valid : null, ...(x && !x.valid ? { badFaces: x.badFaces } : {}) };
}

type OcTol = {
  TopExp_Explorer: new () => { Init(s: unknown, a: unknown, b: unknown): void; More(): boolean; Current(): unknown; Next(): void; delete(): void };
  TopAbs_ShapeEnum: Record<"TopAbs_FACE" | "TopAbs_EDGE" | "TopAbs_VERTEX" | "TopAbs_SHAPE", unknown>;
  TopoDS: { Edge(s: unknown): unknown; Vertex(s: unknown): unknown; Face(s: unknown): unknown };
  BRep_Tool: { Tolerance(s: unknown): number; Degenerated(e: unknown): boolean };
  BRepLib: { UpdateEdgeTolerance(s: unknown, min: number, max: number): boolean; UpdateTolerances(s: unknown, face: boolean): void };
  BRepAdaptor_Curve: new (e: unknown, f?: unknown) => { FirstParameter(): number; LastParameter(): number; Value(t: number): { Distance(p: unknown): number; delete(): void }; delete(): void };
  BRepCheck_Analyzer: new (s: unknown, geom: boolean, par: boolean, exact: boolean) => { IsValid(s: unknown): boolean; delete(): void };
};
const ocTol = () => r.getOC() as unknown as OcTol;

/** podtvary daného druhu (TopExp_Explorer) – volání `f` pro každý */
function eachSub(o: OcTol, s: unknown, kind: "TopAbs_FACE" | "TopAbs_EDGE" | "TopAbs_VERTEX", f: (x: unknown) => void) {
  const ex = new o.TopExp_Explorer();
  try {
    ex.Init(s, o.TopAbs_ShapeEnum[kind], o.TopAbs_ShapeEnum.TopAbs_SHAPE);
    for (; ex.More(); ex.Next()) f(ex.Current());
  } finally {
    ex.delete();
  }
}

/** největší tolerance hran a vrcholů tvaru [mm] */
export function maxTolerance(s: r.AnyShape): number {
  const o = ocTol();
  let m = 0;
  eachSub(o, s.wrapped, "TopAbs_EDGE", (e) => (m = Math.max(m, o.BRep_Tool.Tolerance(o.TopoDS.Edge(e)))));
  eachSub(o, s.wrapped, "TopAbs_VERTEX", (v) => (m = Math.max(m, o.BRep_Tool.Tolerance(o.TopoDS.Vertex(v)))));
  return m;
}

/** dvojic hrana × plocha tvaru (pro počet vzorků `devSamplesFor`) */
function edgeFacePairs(s: r.AnyShape): number {
  const o = ocTol();
  let n = 0;
  eachSub(o, s.wrapped, "TopAbs_FACE", (f) => eachSub(o, f, "TopAbs_EDGE", () => n++));
  return n;
}
/** vzorků na hranu: nejvýš 1000, nejmíň 50, celkem do ~200 000 vyhodnocení (měření běží jen u souboru, který přesnou kontrolou neprojde) */
export const devSamplesFor = (pairs: number) => Math.max(50, Math.min(1000, Math.floor(200_000 / Math.max(1, pairs))));

/**
 * Odchylka křivek hran od ploch: pro každou hranu v každé její ploše největší |C(t) − S(P(t))| (3D křivka hrany × p-křivka
 * na ploše, týž parametr – podmínka SameParameter, kterou přesná kontrola ověřuje) v `n` + 1 rovnoměrných bodech. Je to
 * NAMĚŘENÁ odchylka (dolní odhad skutečné), ne mez – hláška to říká („vzorkováno N bodů na hranu“). `badOnly` = analyzátor:
 * `over` počítá jen dvojice na plochách, které přesnou kontrolou neprojdou, kde odchylka přesahuje toleranci hrany. Tvar nemění.
 */
export function edgeDeviation(s: r.AnyShape, n: number, badOnly?: { IsValid(s: unknown): boolean }): { max: number; over: number } {
  const o = ocTol();
  let max = 0;
  let over = 0;
  eachSub(o, s.wrapped, "TopAbs_FACE", (fc) => {
    const face = o.TopoDS.Face(fc);
    const bad = badOnly ? !badOnly.IsValid(face) : false;
    eachSub(o, face, "TopAbs_EDGE", (ec) => {
      const e = o.TopoDS.Edge(ec);
      if (o.BRep_Tool.Degenerated(e)) return;
      let c3: InstanceType<OcTol["BRepAdaptor_Curve"]> | null = null;
      let cs: InstanceType<OcTol["BRepAdaptor_Curve"]> | null = null;
      try {
        c3 = new o.BRepAdaptor_Curve(e);
        cs = new o.BRepAdaptor_Curve(e, face);
        const t0 = c3.FirstParameter();
        const t1 = c3.LastParameter();
        let d = 0;
        for (let i = 0; i <= n; i++) {
          const t = t0 + ((t1 - t0) * i) / n;
          const p = c3.Value(t);
          const q = cs.Value(t);
          d = Math.max(d, p.Distance(q));
          p.delete();
          q.delete();
        }
        max = Math.max(max, d);
        if (bad && d > o.BRep_Tool.Tolerance(e)) over++;
      } catch {
        /* hrana bez p-křivky / bez 3D křivky – neměří se */
      } finally {
        c3?.delete();
        cs?.delete();
      }
    });
  });
  return { max, over };
}

/**
 * Rozbor souboru, který po zpětném načtení přesnou kontrolou neprojde (22a, fáze 2, kolo 4): tolerance hran a vrcholů
 * znovu načteného tvaru se přepočtou ze skutečné odchylky křivek od ploch (`BRepLib::UpdateEdgeTolerance` + `UpdateTolerances`
 * – krok, který dělá přijímající CAD při opravě tolerancí) a přesná kontrola se zopakuje. Vrací i NEJVĚTŠÍ TOLERANCI po
 * přepočtu (`maxTol`): přepočet tolerance jen zvětší, takže „projde po přepočtu“ samo nic neříká o shodě geometrie – tu smí
 * hláška tvrdit jen s tolerancí do meze (agent-out.ts `retolLimit`, číslo v řádku). Neprojde-li ani po přepočtu, změří se
 * odchylka křivek hran od ploch (`edgeDeviation`, `dev`) – na vadných plochách `over` = hran s odchylkou nad tolerancí.
 * Výsledek jen dokládá PŘÍČINU v hlášce `out.reload-invalid` – „věrnou kopii“ z něj nikdy nedělá: nezávislá kontrola výchozí
 * čtečkou soubor odmítne tak jako tak. Mění tolerance předaného tvaru: volat jen nad jednorázovým tvarem načteným ze souboru,
 * nikdy nad tělesem modelu (mezipaměť stavby).
 *
 * Zjištěno pokusy (kolo 4, rozbor v poznámkách): STEP tolerance hran nenese; čtečka OCCT je po načtení spočte vzorkováním a
 * u hran z aproximovaných průsečnic (šroubovice, ale i válec − koule) vyjdou menší než skutečná odchylka. Odchylka křivek hran
 * od ploch je v souboru stejná jako v modelu (závit M18×1,5 šroub / matice i kanál šroubovicí – zápis geometrii nezhoršil);
 * přepočet `BRepLib` vzorkuje také (23 bodů na hranu), takže u závitu z prvku Závit tolerance pár hran pořád podhodnotí
 * (naměřená odchylka až 2× nad tolerancí po přepočtu). Nastavení zapisovače (`write.precision.mode`, `write.surfacecurve.mode`,
 * schéma AP214 / AP242) výchozí čtení neopraví; BREP, který tolerance nese, projde i přesnou kontrolou.
 */
function retolExact(s: r.AnyShape): { valid: boolean; badFaces: number; maxTol: number; dev?: { max: number; over: number; n: number } } | null {
  try {
    const o = ocTol();
    o.BRepLib.UpdateEdgeTolerance(s.wrapped, 1e-7, 1);
    o.BRepLib.UpdateTolerances(s.wrapped, false);
    const x = exactCheck(s);
    const maxTol = maxTolerance(s);
    if (x.valid) return { valid: true, badFaces: 0, maxTol };
    const n = devSamplesFor(edgeFacePairs(s));
    const a = new o.BRepCheck_Analyzer(s.wrapped, true, false, true);
    try {
      return { valid: false, badFaces: x.badFaces, maxTol, dev: { ...edgeDeviation(s, n, a), n } };
    } finally {
      a.delete();
    }
  } catch {
    return null;
  }
}

/**
 * Model (díl / sestava) a znovu načtený soubor STEP / BREP – míry pro porovnání (`exportCheck` v agent-out.ts). Soubor se
 * kontroluje i přesnou metodou (do `EXACT_AUTO_FACES` ploch, 22a); model přesně jen tehdy, když soubor přesnou kontrolou
 * neprojde (aby hláška rozlišila „vadu přinesl soubor“ od „model je vadný už sám“) – u platného souboru se čas neplýtvá.
 */
export async function exportStats(doc: CadDoc, bytes: Uint8Array, format: "step" | "brep"): Promise<{ model: KernelShapeStats; file: KernelShapeStats }> {
  const body = await shapeOfDoc(doc);
  if (!body) throw new Error(tr("Model je prázdný."));
  let file: r.AnyShape | null = null;
  try {
    file = format === "step" ? await r.importSTEP(new Blob([bytes as BlobPart])) : importBREP(new TextDecoder().decode(bytes));
    if (!file || (file as { isNull?: boolean }).isNull) throw new Error(tr("soubor neobsahuje žádný tvar"));
    const fileStats = shapeStats(file, true);
    // soubor přesně neplatný: příčina doložená přepočtem tolerancí (jen nad načteným souborem, viz retolExact)
    const rt = fileStats.validExact === false ? retolExact(file) : null;
    if (rt) Object.assign(fileStats, { retolValid: rt.valid, retolMaxTol: rt.maxTol }, rt.valid ? {} : { retolBadFaces: rt.badFaces });
    if (rt?.dev) Object.assign(fileStats, { devMax: rt.dev.max, devOver: rt.dev.over, devSamples: rt.dev.n });
    const modelStats = shapeStats(body, fileStats.validExact === false);
    if (fileStats.validExact === false) {
      // mez pro tolerance po přepočtu a srovnání odchylky křivek: tytéž míry modelu (tvar modelu se jen čte)
      try {
        modelStats.maxTol = maxTolerance(body);
        if (rt?.dev) Object.assign(modelStats, { devMax: edgeDeviation(body, rt.dev.n).max, devSamples: rt.dev.n });
      } catch {
        /* bez měr modelu hláška příčinu netvrdí */
      }
    }
    return { model: modelStats, file: fileStats };
  } finally {
    free(file);
    if (doc.kind === "assembly") free(body); // složené těleso sestavy vzniká pro každé volání; těleso dílu patří mezipaměti stavby
  }
}
