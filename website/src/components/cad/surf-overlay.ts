"use client";

/**
 * Sdílený stav analýzy ploch (7. vlna, plochy třídy A) mezi panelem / formulářem a 3D oknem – bez dalšího stavu v cad-app:
 *  - `overlay`: obarvené hrany (návaznost G0/G1/G2), hřebeny křivosti, řídicí body a síť CV,
 *  - `panel`: otevřený panel „Návaznost a křivost hran“,
 *  - `cvGizmo`: úchop vybraného řídicího bodu (přesun gizmem v 3D okně).
 */
import { useSyncExternalStore } from "react";
import type { Gizmo } from "./viewport";
import type { Vec3 } from "@/cad/types";

export type SurfOverlay = {
  /** lomené čáry (hrany obarvené podle návaznosti, obálka hřebenu, síť CV) */
  lines: { pts: Vec3[]; color: string; width?: number; dashed?: boolean }[];
  /** body (CV) – `big` = vybraný */
  points: { p: Vec3; color: string; big?: boolean }[];
};

type State = { overlay: SurfOverlay | null; panel: boolean; cvGizmo: { at: Vec3; onMove: (d: Vec3) => void } | null };
let state: State = { overlay: null, panel: false, cvGizmo: null };
const subs = new Set<() => void>();
const emit = () => subs.forEach((f) => f());
const subscribe = (f: () => void) => {
  subs.add(f);
  return () => void subs.delete(f);
};

export function setSurfOverlay(overlay: SurfOverlay | null) {
  state = { ...state, overlay };
  emit();
}
export function setSurfPanel(open: boolean) {
  state = { ...state, panel: open, ...(open ? {} : { overlay: null }) };
  emit();
}
export function setCvGizmo(g: State["cvGizmo"]) {
  state = { ...state, cvGizmo: g };
  emit();
}
export const surfState = () => state;

export function useSurfState(): State {
  return useSyncExternalStore(subscribe, surfState, surfState);
}

/** gizmo vybraného CV pro 3D okno (null = žádné) a obsluha posunu (konec tažení → posun bodu o vektor) */
export function cvGizmoProps(s: State): { gizmo: Gizmo; onGizmo: (delta: number[], final: boolean) => void } | null {
  const g = s.cvGizmo;
  if (!g) return null;
  return {
    gizmo: { id: "__cv__", matrix: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, g.at[0], g.at[1], g.at[2], 1], mode: "translate", targets: [] },
    onGizmo: (delta, final) => {
      if (!final) return;
      // delta = matice posunu (po sloupcích) – posun je v posledním sloupci
      const d: Vec3 = [delta[12] ?? 0, delta[13] ?? 0, delta[14] ?? 0];
      if (Math.hypot(...d) > 1e-9) g.onMove(d.map((v) => Math.round(v * 1000) / 1000) as Vec3);
    },
  };
}
