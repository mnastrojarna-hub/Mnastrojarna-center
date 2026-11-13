/**
 * Dotazy na plochy pro UI a agenty (worker op „surfA“): návaznost hran, hřebeny křivosti, řídicí body plochy.
 * Výsledek je čistý JSON (body hran pro obarvení v 3D okně, čísla pro protokol).
 */
import type * as r from "replicad";
import { continuityReport, curvatureCombs, cvInfo, sampleEdge, type Comb, type CvInfo, type EdgeContinuity } from "./surf-a";
import { tr } from "./i18n";
import type { Vec3 } from "./types";

export type SurfQuery =
  | { kind: "continuity"; edges?: number[] }
  | { kind: "comb"; edges?: number[]; scale?: number }
  | { kind: "cv"; face: number; grid?: [number, number] | null };

export type SurfQueryResult =
  | { kind: "continuity"; items: (EdgeContinuity & { pts: Vec3[] })[]; total: number }
  | { kind: "comb"; combs: Comb[] }
  | { kind: "cv"; face: number; info: CvInfo };

/** hrany, které mají smysl pro hřeben křivosti (ne úsečky) */
const curved = (e: r.Edge) => e.geomType !== "LINE";

export function surfQuery(body: r.AnyShape | null, q: SurfQuery): SurfQueryResult {
  if (!body) throw new Error(tr("Model nemá žádné plochy ani hrany."));
  const ne = body.edges.length;
  const check = (list: number[] | undefined) => {
    for (const i of list ?? []) if (!(i >= 0 && i < ne)) throw new Error(tr("Hrana E{0} v modelu není (model má E1–E{1}).", i + 1, ne));
  };
  if (q.kind === "continuity") {
    check(q.edges);
    const items = continuityReport(body, q.edges).map((c) => ({ ...c, pts: sampleEdge(body.edges[c.edge], 24).map((p) => p.p) }));
    return { kind: "continuity", items, total: q.edges?.length ? q.edges.length : ne };
  }
  if (q.kind === "comb") {
    check(q.edges);
    const list = q.edges?.length ? q.edges : body.edges.map((e, i) => (curved(e) ? i : -1)).filter((i) => i >= 0).slice(0, 60);
    return { kind: "comb", combs: curvatureCombs(body, list, 48, q.scale ?? 0) };
  }
  const f = body.faces[q.face];
  if (!f) throw new Error(tr("Plocha F{0} v modelu není (model má F1–F{1}).", q.face + 1, body.faces.length));
  return { kind: "cv", face: q.face, info: cvInfo(f, q.grid ?? null) };
}
