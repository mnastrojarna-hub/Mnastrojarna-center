"use client";

/**
 * Zobrazení výsledků textových příkazů ploch (agent-surfaces.ts) ve 3D okně aplikace: obarvené hrany, hřebeny, CV.
 * Dotaz do jádra a protokol jsou v enginu (engine/ops/surf.ts); překryvy se kreslí přes surf-overlay.ts.
 */
import { CONT_COLOR, type CvInfo } from "@/cad/surf-a";
import type { SurfQueryResult } from "@/cad/surf-query";
import { setSurfOverlay, type SurfOverlay } from "./surf-overlay";

/** hrany obarvené podle třídy návaznosti */
export function continuityOverlay(res: Extract<SurfQueryResult, { kind: "continuity" }>): SurfOverlay {
  return { lines: res.items.map((c) => ({ pts: c.pts, color: CONT_COLOR[c.cls], width: 4 })), points: [] };
}
/** hřebeny křivosti: zuby + obálka */
export function combOverlay(res: Extract<SurfQueryResult, { kind: "comb" }>): SurfOverlay {
  const lines: SurfOverlay["lines"] = [];
  for (const c of res.combs) {
    for (const [a, b] of c.teeth) lines.push({ pts: [a, b], color: "#64748b", width: 1 });
    lines.push({ pts: c.envelope, color: "#2563eb", width: 2 });
  }
  return { lines, points: [] };
}
/** řídicí body a síť CV; `sel` = vybraný bod [u, v] (od 1), `moved` = posunuté body */
export function cvOverlay(info: CvInfo, sel?: [number, number] | null, moved?: Set<string>): SurfOverlay {
  const lines: SurfOverlay["lines"] = [];
  for (let u = 0; u < info.nu; u++) lines.push({ pts: info.poles[u], color: "#94a3b8", width: 1, dashed: true });
  for (let v = 0; v < info.nv; v++) lines.push({ pts: info.poles.map((row) => row[v]), color: "#94a3b8", width: 1, dashed: true });
  const points: SurfOverlay["points"] = [];
  info.poles.forEach((row, u) =>
    row.forEach((p, v) => {
      const isSel = !!sel && sel[0] === u + 1 && sel[1] === v + 1;
      points.push({ p, color: isSel ? "#e03930" : moved?.has(`${u + 1},${v + 1}`) ? "#f59e0b" : "#0e7490", big: isSel });
    }),
  );
  return { lines, points };
}

/** Výsledek dotazu ploch s „zobrazit“ (engine/ops/surf.ts → háček `surfOverlay`): překryv ve 3D okně. */
export function showSurfResult(res: SurfQueryResult): void {
  if (res.kind === "continuity") setSurfOverlay(continuityOverlay(res));
  else if (res.kind === "comb") setSurfOverlay(combOverlay(res));
}
