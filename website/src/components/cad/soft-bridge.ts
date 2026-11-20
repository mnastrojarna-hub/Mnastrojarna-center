/**
 * Předání ovládání 3D okna softwarovému náhledu (bez WebGL).
 * Dokud je náhled zobrazen, obsluhuje pohledy, přizpůsobení, snímek a rozměr scény místo 3D okna – pás karet,
 * klávesové zkratky i textové příkazy tak fungují beze změny (volají stále `ViewportHandle`).
 */
import { useEffect, useSyncExternalStore } from "react";
import type { SoftViewName } from "@/cad/soft-render";
import type { Vec3 } from "@/cad/types";
import type { BoxRect } from "@/cad/box-select";
import type { SelItem } from "./selection";
import type { Hint, NeutralCam, ViewportProps } from "./viewport";

export type SoftViewHandle = {
  setView: (v: SoftViewName) => void;
  fit: () => void;
  /** snímek náhledu jako data URL (PNG) */
  snapshot: () => string | null;
  bounds: () => { center: Vec3; radius: number };
  /** stav kamery a jeho obnovení (snímek pro agenta vrátí dočasný pohled zpět) */
  camera?: () => unknown;
  setCamera?: (c: unknown) => void;
  /** popisky entit (F1 / E2 / V3) a „klik“ na popisek – stejné jako u 3D okna (výběr bez trefování) */
  hintList?: () => Omit<Hint, "p">[];
  clickHint?: (id: string, additive?: boolean) => boolean;
  /** výběr oknem / křížením (CSS px náhledu) podle filtru – bez změny výběru; null = v tomto režimu nejde */
  boxPick?: (rect: BoxRect, crossing: boolean) => SelItem[] | null;
  /** vlna 22: vykreslí náhled hned (plná kvalita) a vrátí plátna (obraz + překryv) k sejmutí snímku videa */
  frame?: () => HTMLCanvasElement[] | null;
  /** kamera nezávislá na způsobu kreslení (viewport.tsx NeutralCam) */
  viewState?: () => NeutralCam | null;
  setViewState?: (c: NeutralCam) => void;
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

/**
 * Vlastnosti 3D okna pro výběr kliknutím (režim a filtr výběru, výběr, zvýraznění, události) – softwarový náhled je
 * převezme beze změny, takže výběr, formuláře prvků („+ výběr“, hrany zaoblení, skica na ploše), měření i vazby
 * sestav fungují stejně jako ve 3D okně a aplikace nepotřebuje žádnou zvláštní větev.
 */
export type SoftPickProps = Pick<
  ViewportProps,
  "pickMode" | "selFilter" | "snapPoints" | "selection" | "selectedEdges" | "selectedFaces" | "onPickEdge" | "onPickFace" | "onPick" | "onContext" | "onCursor" | "measure" | "vertices" | "hints" | "onPickMany" | "mouse" | "leftDrag" | "boxResolve"
>;

let pickProps: SoftPickProps | null = null;
const pickListeners = new Set<() => void>();
const subscribePick = (l: () => void) => {
  pickListeners.add(l);
  return () => {
    pickListeners.delete(l);
  };
};

/** Zveřejní (nebo s `null` odhlásí) vlastnosti 3D okna pro softwarový náhled. */
export function setSoftPickProps(p: SoftPickProps | null) {
  if (pickProps === p) return;
  pickProps = p;
  for (const l of [...pickListeners]) l();
}

/** Aktuální vlastnosti 3D okna pro výběr (null = 3D okno není připojené). */
export function useSoftPickProps(): SoftPickProps | null {
  return useSyncExternalStore(
    subscribePick,
    () => pickProps,
    () => null,
  );
}

/** 3D okno (i jeho náhrada po pádu) zveřejňuje své vlastnosti po každém vykreslení, při odpojení je odhlásí. */
export function usePublishPickProps(p: SoftPickProps) {
  useEffect(() => setSoftPickProps(p));
  useEffect(() => () => setSoftPickProps(null), []);
}
