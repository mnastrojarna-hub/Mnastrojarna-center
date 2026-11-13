/**
 * Předání ovládání 3D okna softwarovému náhledu (bez WebGL).
 * Dokud je náhled zobrazen, obsluhuje pohledy, přizpůsobení, snímek a rozměr scény místo 3D okna – pás karet,
 * klávesové zkratky i textové příkazy tak fungují beze změny (volají stále `ViewportHandle`).
 */
import { useSyncExternalStore } from "react";
import type { SoftViewName } from "@/cad/soft-render";
import type { Vec3 } from "@/cad/types";

export type SoftViewHandle = {
  setView: (v: SoftViewName) => void;
  fit: () => void;
  /** snímek náhledu jako data URL (PNG) */
  snapshot: () => string | null;
  bounds: () => { center: Vec3; radius: number };
  /** stav kamery a jeho obnovení (snímek pro agenta vrátí dočasný pohled zpět) */
  camera?: () => unknown;
  setCamera?: (c: unknown) => void;
};

/** Aktivní softwarový náhled hlavního 3D okna; null = kreslí WebGL. */
export const softView: { current: SoftViewHandle | null } = { current: null };

const listeners = new Set<() => void>();
const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => {
    listeners.delete(l);
  };
};

/** Zaregistruje (nebo s `null` odhlásí) softwarový náhled. */
export function setSoftView(h: SoftViewHandle | null) {
  if (softView.current === h) return;
  softView.current = h;
  for (const l of [...listeners]) l();
}

/** Je právě zobrazen softwarový náhled? (3D okno pak skryje ViewCube a osový kříž, které by se neotáčely.) */
export function useSoftViewActive(): boolean {
  return useSyncExternalStore(
    subscribe,
    () => softView.current !== null,
    () => false,
  );
}
