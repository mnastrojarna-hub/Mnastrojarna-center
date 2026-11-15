"use client";

/**
 * Výběr oknem ve 2D – společné zobrazení: obdélník (okno = plná modrá, křížení = čárkovaná zelená) s počítadlem u kurzoru.
 * SVG verze pro skicu a výkres dílu, canvas verze pro 2D výkres. Pravidla: `@/cad/box-select-2d`.
 */
import { tr } from "@/cad/i18n";
import type { P2 } from "@/cad/box-select-2d";

export const BOX_COLORS = { window: "#2563eb", crossing: "#16a34a", windowFill: "rgba(37,99,235,.08)", crossingFill: "rgba(22,163,74,.08)" };

/** „3 objekty“ – počet s českým tvarem slova (EN/DE podle překladu) */
export function objCount(n: number): string {
  if (n === 1) return tr("1 objekt");
  if (n >= 2 && n <= 4) return tr("{0} objekty", n);
  return tr("{0} objektů", n);
}

/** popisek u okna: „Okno · 3 objekty“ / „Křížení · 0 objektů“ (+ „− odebrat“ / „+ přidat“) */
export function boxLabel(n: number, crossing: boolean, mode?: "replace" | "add" | "remove"): string {
  const head = crossing ? tr("Křížení") : tr("Okno");
  const tail = mode === "add" ? ` (${tr("přidat")})` : mode === "remove" ? ` (${tr("odebrat")})` : "";
  return `${head} · ${objCount(n)}${tail}`;
}

/** obdélník okna v px (SVG) s popiskem vedle druhého rohu */
export function BoxSelectSvg({ a, b, crossing, label }: { a: P2; b: P2; crossing: boolean; label?: string }) {
  const x = Math.min(a[0], b[0]);
  const y = Math.min(a[1], b[1]);
  const w = Math.abs(b[0] - a[0]);
  const h = Math.abs(b[1] - a[1]);
  const lw = label ? label.length * 6.4 + 10 : 0;
  const lx = b[0] + 12;
  const ly = b[1] + 14;
  return (
    <g data-boxsel={crossing ? "crossing" : "window"} pointerEvents="none">
      <rect x={x} y={y} width={w} height={h} fill={crossing ? BOX_COLORS.crossingFill : BOX_COLORS.windowFill} stroke={crossing ? BOX_COLORS.crossing : BOX_COLORS.window} strokeWidth={1} strokeDasharray={crossing ? "5 3" : undefined} />
      {label && (
        <g data-boxsel-label>
          <rect x={lx} y={ly - 12} width={lw} height={17} rx={3} fill="rgba(17,24,39,.86)" />
          <text x={lx + 5} y={ly} fontSize={11} fill="#fff" fontFamily="Roboto, Arial, sans-serif">
            {label}
          </text>
        </g>
      )}
    </g>
  );
}

/** totéž do canvasu (souřadnice v CSS px, `dpr` = poměr pixelů plátna) */
export function drawBoxSelect(g: CanvasRenderingContext2D, a: P2, b: P2, crossing: boolean, dpr: number, label?: string) {
  g.save();
  g.fillStyle = crossing ? "rgba(34,197,94,0.12)" : "rgba(59,130,246,0.12)";
  g.strokeStyle = crossing ? "#22c55e" : "#3b82f6";
  g.lineWidth = dpr;
  g.setLineDash(crossing ? [6 * dpr, 4 * dpr] : []);
  const x = Math.min(a[0], b[0]) * dpr;
  const y = Math.min(a[1], b[1]) * dpr;
  g.fillRect(x, y, Math.abs(b[0] - a[0]) * dpr, Math.abs(b[1] - a[1]) * dpr);
  g.strokeRect(x, y, Math.abs(b[0] - a[0]) * dpr, Math.abs(b[1] - a[1]) * dpr);
  if (label) {
    g.setLineDash([]);
    g.font = `${11 * dpr}px sans-serif`;
    const tw = g.measureText(label).width;
    const lx = (b[0] + 14) * dpr;
    const ly = (b[1] + 30) * dpr;
    g.fillStyle = "rgba(17,24,39,0.86)";
    g.fillRect(lx, ly - 12 * dpr, tw + 10 * dpr, 17 * dpr);
    g.fillStyle = "#ffffff";
    g.fillText(label, lx + 5 * dpr, ly);
  }
  g.restore();
}
