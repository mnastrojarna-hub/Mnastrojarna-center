"use client";

/**
 * Provedení textových příkazů ploch (agent-surfaces.ts) v aplikaci: dotaz do jádra (cad.surfA), protokol a volitelně
 * zobrazení v 3D okně (obarvené hrany, hřebeny, CV). Překryvy se kreslí přes surf-overlay.ts.
 */
import { cad } from "@/cad/client";
import { combLines, continuityLines, cvLines, type SurfCmd } from "@/cad/agent-surfaces";
import { CONT_COLOR, type CvInfo } from "@/cad/surf-a";
import type { SurfQueryResult } from "@/cad/surf-query";
import type { CadDoc } from "@/cad/types";
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

/** Provede příkaz a vrátí řádky protokolu. */
export async function runSurfCmd(cmd: SurfCmd, doc: CadDoc): Promise<string[]> {
  if (cmd.kind === "continuity") {
    const res = await cad.surfA({ kind: "continuity", edges: cmd.edges }, doc);
    if (res.kind !== "continuity") return [];
    if (cmd.show) setSurfOverlay(continuityOverlay(res));
    return continuityLines(res, cmd.show);
  }
  if (cmd.kind === "comb") {
    const res = await cad.surfA({ kind: "comb", edges: cmd.edges, scale: cmd.scale }, doc);
    if (res.kind !== "comb") return [];
    if (cmd.show) setSurfOverlay(combOverlay(res));
    return combLines(res, cmd.show);
  }
  const res = await cad.surfA({ kind: "cv", face: cmd.face, grid: cmd.grid }, doc);
  if (res.kind !== "cv") return [];
  return cvLines(res);
}

