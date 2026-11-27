"use client";
/**
 * Vlna 22, kolo 7 (bod 14 – „plný panel studie nejde ukotvit“): ukotvení plného panelu pohybové studie k pravému okraji
 * pracovní plochy. Ukotvený panel nepřekrývá model: stojí VEDLE 3D okna (sloupec v rozvržení aplikace, `MotionDockSlot`),
 * 3D okno / softwarový náhled se zúží a lišta přehrávání zůstává dole v okně. Volba se pamatuje v prohlížeči (jako kompaktní
 * režim lišty); jedna sdílená hodnota pro panel (tlačítko v záhlaví) i rozvržení aplikace (sloupec, poloha panelu Řez).
 */
import { tr } from "@/cad/i18n";
import { useEffect, useState, useSyncExternalStore } from "react";

export type MotionDock = "float" | "right";
const KEY = "mncad.motion.dock";
const subs = new Set<() => void>();
let mem: MotionDock | null = null;

function read(): MotionDock {
  if (mem) return mem;
  try {
    mem = localStorage.getItem(KEY) === "right" ? "right" : "float";
  } catch {
    mem = "float";
  }
  return mem;
}

/** nastaví ukotvení (a uloží ho; bez úložiště platí jen pro tuto relaci) */
export function setMotionDock(d: MotionDock) {
  mem = d;
  try {
    localStorage.setItem(KEY, d);
  } catch {
    /* bez úložiště jen pro tuto relaci */
  }
  for (const f of subs) f();
}

const subscribe = (f: () => void) => {
  subs.add(f);
  return () => void subs.delete(f);
};

/** aktuální ukotvení panelu studie (sdílené mezi panelem a rozvržením aplikace) */
export function useMotionDock(): MotionDock {
  return useSyncExternalStore(subscribe, read, () => "float");
}

/** id sloupce pro ukotvený panel (cad-app ho vykreslí vedle `<main>`) */
export const MOTION_DOCK_SLOT = "mncad-motion-dock";

/** cíl ukotveného panelu: sloupec vedle pracovní plochy, když je panel ukotvený a sloupec existuje (jinak null = plovoucí) */
export function useMotionDockTarget(): HTMLElement | null {
  const dock = useMotionDock();
  const [el, setEl] = useState<HTMLElement | null>(null);
  useEffect(() => setEl(dock === "right" ? document.getElementById(MOTION_DOCK_SLOT) : null), [dock]);
  return el;
}

/** tlačítko v záhlaví panelu studie: ukotvit vpravo / uvolnit (plovoucí) */
export function MotionDockButton() {
  const dock = useMotionDock();
  const on = dock === "right";
  return (
    <button
      type="button"
      data-motion-dock={on ? "right" : "float"}
      aria-pressed={on}
      title={on ? tr("Uvolnit panel studie (plovoucí nad modelem)") : tr("Ukotvit panel studie vpravo vedle 3D okna (nepřekrývá model)")}
      onClick={() => setMotionDock(on ? "float" : "right")}
      className="rounded px-1 text-[11px] font-medium text-[#6b7785] hover:bg-[#eef2f6] max-md:hidden"
    >
      {on ? tr("Plovoucí") : tr("Ukotvit ⇥")}
    </button>
  );
}

/** sloupec pro ukotvený panel – cad-app ho vykreslí v řádku rozvržení hned za `<main>` (bez panelu má nulovou šířku) */
export function MotionDockSlot() {
  const dock = useMotionDock();
  return <div id={MOTION_DOCK_SLOT} data-motion-dock-slot={dock} className="relative z-20 flex shrink-0 empty:hidden" />;
}
