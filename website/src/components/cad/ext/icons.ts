/** Ikony registrované moduly rozšíření (název → SVG obsah 24×24, stroke currentColor). */
import type { ReactNode } from "react";
export const EXTRA_ICONS: Record<string, ReactNode> = {};
export function registerIcon(name: string, node: ReactNode) {
  EXTRA_ICONS[name] = node;
}
