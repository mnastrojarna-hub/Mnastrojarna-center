"use client";

import * as React from "react";
import { Box, FileText, Maximize2, PanelRight, PencilRuler } from "lucide-react";
import { FileViewer } from "@/components/file-viewer/file-viewer";
import { useFileViewer } from "@/components/file-viewer/file-viewer-provider";
import { usePdfThumb } from "@/components/jobs/capture/pdf-thumbs";
import { openFileViewer } from "@/components/file-viewer/viewer-bus";
import { standaloneViewerHref } from "@/components/file-viewer/viewer-links";
import { drawingHref, type PricingDrawing } from "@/lib/jobs/pricing-drawings";
import { cn } from "@/lib/utils";

/**
 * Výkres u položky na Nacenění: miniatura v řádku, klik = prohlížeč přes celou obrazovku (vrstva nad
 * stránkou, žádná navigace → rozepsané ceny zůstanou), na počítači „Mít vedle" = panel vedle položek.
 */

/** Co je otevřené v panelu vedle (zakázka, řádek, soubory položky a vybraný). */
export interface DrawingTarget {
  jobId: string;
  rowKey: string;
  label: string;
  drawings: PricingDrawing[];
  index: number;
}

const WIDE_QUERY = "(min-width: 1024px)";
const PIN_KEY = "mn:pricing:drawing-dock";

/** Je okno dost široké na panel vedle (Tailwind lg)? */
export function isWideScreen(): boolean {
  try {
    return typeof window !== "undefined" && typeof window.matchMedia === "function" && window.matchMedia(WIDE_QUERY).matches;
  } catch {
    return false;
  }
}

/** „Mít vedle" — zapamatované v prohlížeči (jen pohodlí, bez něj funguje vše). */
export function usePinnedDock(): [boolean, (v: boolean) => void] {
  const [pinned, setPinnedState] = React.useState(false);
  React.useEffect(() => {
    try {
      if (window.localStorage.getItem(PIN_KEY) === "1") setPinnedState(true);
    } catch {
      /* úložiště nedostupné */
    }
  }, []);
  const setPinned = React.useCallback((v: boolean) => {
    setPinnedState(v);
    try {
      if (v) window.localStorage.setItem(PIN_KEY, "1");
      else window.localStorage.removeItem(PIN_KEY);
    } catch {
      /* úložiště nedostupné */
    }
  }, []);
  return [pinned, setPinned];
}

/** Otevře výkres přes celou obrazovku (vrstva prohlížeče; bez ní samostatná stránka v nové kartě). */
export function useOpenDrawingFullscreen() {
  const viewer = useFileViewer();
  return React.useCallback(
    (d: PricingDrawing, toolbar?: React.ReactNode) => {
      const req = { href: drawingHref(d.id), filename: d.filename, toolbar };
      if (viewer) viewer.open(req);
      else if (!openFileViewer(req)) window.open(standaloneViewerHref(req.href, d.filename), "_blank", "noopener");
    },
    [viewer],
  );
}

function ThumbImage({ drawing }: { drawing: PricingDrawing }) {
  const href = drawingHref(drawing.id);
  const pdf = usePdfThumb(drawing.view === "pdf" ? href : null, 1, 96);
  const [imgFailed, setImgFailed] = React.useState(false);
  if (drawing.view === "pdf" && pdf.src) {
    // eslint-disable-next-line @next/next/no-img-element
    return <img src={pdf.src} alt="" className="h-full w-full object-contain" draggable={false} />;
  }
  if (drawing.view === "image" && !imgFailed) {
    // eslint-disable-next-line @next/next/no-img-element
    return <img src={href} alt="" loading="lazy" onError={() => setImgFailed(true)} className="h-full w-full object-contain" draggable={false} />;
  }
  const Icon = drawing.view === "model" ? Box : drawing.view === "pdf" ? FileText : PencilRuler;
  return <Icon className="h-4 w-4 text-blue-600 dark:text-blue-400" aria-hidden />;
}

/** Miniatura výkresu v řádku položky (bez výkresu = šedé místo s popiskem „Výkres chybí"). */
export function DrawingThumbButton({
  drawings, label, active, onOpen,
}: {
  drawings: PricingDrawing[] | undefined;
  /** „Položka 2" — do popisku pro čtečky a tooltipu. */
  label: string;
  active?: boolean;
  onOpen: () => void;
}) {
  const d = drawings?.[0];
  if (!d) {
    return (
      <span
        role="img"
        aria-label={`${label}: výkres chybí`}
        title="Výkres chybí"
        className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md border border-dashed text-muted-foreground/50"
        data-testid="pricing-drawing-missing"
      >
        <PencilRuler className="h-3.5 w-3.5" aria-hidden />
      </span>
    );
  }
  const more = (drawings?.length ?? 0) - 1;
  return (
    <button
      type="button"
      onClick={onOpen}
      aria-label={`${label}: zobrazit výkres ${d.filename}`}
      title={`Zobrazit výkres ${d.filename}${more > 0 ? ` (+${more} další)` : ""}`}
      aria-pressed={active || undefined}
      data-testid="pricing-drawing-thumb"
      className={cn(
        "relative flex h-9 w-9 shrink-0 items-center justify-center overflow-hidden rounded-md border bg-white transition hover:ring-2 hover:ring-blue-400 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 dark:bg-white/90",
        active && "ring-2 ring-blue-500",
      )}
    >
      <ThumbImage drawing={d} />
      {more > 0 && (
        <span className="absolute bottom-0 right-0 rounded-tl bg-blue-600 px-0.5 text-[9px] font-bold leading-tight text-white">+{more}</span>
      )}
    </button>
  );
}

/** Tlačítko „Mít vedle" (hlavička prohlížeče přes celou obrazovku, jen na počítači). */
export function PinDockButton({ onPin }: { onPin: () => void }) {
  return (
    <button
      type="button"
      onClick={onPin}
      className="hidden h-11 shrink-0 items-center gap-1.5 rounded-lg border px-3 text-sm font-medium hover:bg-accent lg:inline-flex"
      title="Výkres zůstane otevřený vedle položek — můžeš psát ceny a dívat se na něj"
      data-testid="pricing-drawing-pin"
    >
      <PanelRight className="h-4 w-4" /> Mít vedle
    </button>
  );
}

/** Panel s výkresem vedle položek (počítač). Přepnutí souboru položky, celá obrazovka, zavřít. */
export function DrawingDock({
  target, onClose, onSelect, onFullscreen,
}: {
  target: DrawingTarget;
  onClose: () => void;
  onSelect: (index: number) => void;
  onFullscreen: () => void;
}) {
  const d = target.drawings[target.index] ?? target.drawings[0];
  if (!d) return null;
  return (
    <div className="flex h-full flex-col" data-testid="pricing-drawing-dock">
      <div className="flex items-center gap-2 border-b bg-blue-50/60 px-3 py-1.5 text-xs dark:bg-blue-500/10">
        <PencilRuler className="h-3.5 w-3.5 shrink-0 text-blue-600 dark:text-blue-400" />
        <span className="min-w-0 flex-1 truncate font-medium" title={target.label}>{target.label}</span>
        {target.drawings.length > 1 && (
          <div className="flex shrink-0 gap-1" role="tablist" aria-label="Soubory položky">
            {target.drawings.map((x, i) => (
              <button
                key={x.id}
                type="button"
                role="tab"
                aria-selected={i === target.index}
                onClick={() => onSelect(i)}
                title={x.filename}
                className={cn(
                  "inline-flex h-7 items-center gap-1 rounded-md px-2 font-medium",
                  i === target.index ? "bg-foreground text-background" : "hover:bg-accent",
                )}
              >
                {x.view === "model" ? <Box className="h-3.5 w-3.5" /> : <FileText className="h-3.5 w-3.5" />}
                {x.view === "model" ? "3D" : x.view === "pdf" ? "PDF" : x.view === "image" ? "Obrázek" : "Soubor"}
              </button>
            ))}
          </div>
        )}
      </div>
      <div className="min-h-0 flex-1">
        <FileViewer
          key={d.id}
          request={{ href: drawingHref(d.id), filename: d.filename }}
          onBack={onClose}
          backLabel="Zavřít"
          toolbar={
            <button
              type="button"
              onClick={onFullscreen}
              className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-lg hover:bg-accent"
              aria-label="Celá obrazovka"
              title="Celá obrazovka"
            >
              <Maximize2 className="h-5 w-5" />
            </button>
          }
        />
      </div>
    </div>
  );
}
