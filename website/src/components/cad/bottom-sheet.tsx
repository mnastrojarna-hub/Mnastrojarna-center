"use client";

/**
 * Spodní listy CADu na mobilu – jedna sdílená komponenta pro všechny (logika: sheet-drag.ts, posluchače: use-sheet-drag.ts).
 *
 * - `BottomSheet` – modální list s podkladem (nabídky pásu karet, Soubor, seznam dokumentů): úchyt nahoře,
 *   tažení dolů za úchyt nebo za obsah posunutý nahoře, klepnutí na podklad, systémové Zpět, Esc.
 * - `SheetAside` – boční panel (formulář prvku, komponenta sestavy), který je na úzkém displeji spodním listem.
 *   Je nemodální (model pod ním zůstává ovladatelný pro výběr ploch/hran), proto bez podkladu; zavře se tažením
 *   za úchyt / záhlaví (prvek s `data-sheet-grip`), tlačítkem Zpět; Esc obsluhuje aplikace.
 * Na počítači (≥ 640 px) se SheetAside chová jako dřív – bez úchytu, tažení i záznamu v historii.
 */
import { tr } from "@/cad/i18n";
import { useEffect, useRef, useState } from "react";
import { cn } from "@/lib/cn";
import { useSheetDrag } from "./use-sheet-drag";

/** úchyt listu (viditelný proužek) – zároveň plocha, za kterou se list táhne */
export function SheetGrip({ className }: { className?: string }) {
  return (
    <div data-sheet-grip data-sheet-handle aria-hidden className={cn("flex h-6 shrink-0 cursor-grab touch-none select-none items-center justify-center", className)}>
      <span className="h-1.5 w-11 rounded-full bg-[#c4ccd6]" />
    </div>
  );
}

/** true na úzké obrazovce (< 640 px, stejná hranice jako `max-sm:` v Tailwindu) */
export function useNarrowSheet(): boolean {
  const [narrow, setNarrow] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia("(max-width: 639px)");
    const on = () => setNarrow(mq.matches);
    on();
    mq.addEventListener("change", on);
    return () => mq.removeEventListener("change", on);
  }, []);
  return narrow;
}

export function BottomSheet({
  onClose,
  children,
  footer,
  sheetRef,
  className,
  label,
  ...rest
}: {
  onClose: () => void;
  children: React.ReactNode;
  /** pevná patička pod posuvným obsahem (např. tlačítko Zavřít) */
  footer?: React.ReactNode;
  /** vnější ref na prvek listu (měření, „patří k nabídce“) */
  sheetRef?: React.RefObject<HTMLDivElement | null>;
  className?: string;
  label?: string;
} & Omit<React.HTMLAttributes<HTMLDivElement>, "children" | "className">) {
  const own = useRef<HTMLDivElement>(null);
  const ref = sheetRef ?? own;
  const backdrop = useRef<HTMLDivElement>(null);
  useSheetDrag({ enabled: true, sheetRef: ref, backdropRef: backdrop, onClose });
  return (
    <>
      {/* podklad: klepnutí list zavře; data-cad-menu = vnější posluchač nabídky ho nepovažuje za klik „mimo“
          (jinak by se list zavřel už při stisku a klik by propadl do modelu pod ním) */}
      <div
        ref={backdrop}
        data-sheet-backdrop
        data-cad-menu
        aria-hidden
        className="fixed inset-0 z-[94] touch-none overscroll-contain bg-black/30"
        onClick={onClose}
      />
      <div
        ref={ref}
        data-bottom-sheet
        aria-label={label}
        {...rest}
        className={cn(
          "fixed inset-x-0 bottom-0 z-[95] flex max-h-[70vh] flex-col overscroll-contain rounded-t-2xl border-t border-[#cfd6de] bg-white pb-[max(8px,env(safe-area-inset-bottom))] shadow-[0_-12px_32px_-8px_rgba(15,23,42,.35)]",
          className,
        )}
      >
        <SheetGrip />
        <div data-sheet-body className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
          {children}
        </div>
        {footer}
      </div>
    </>
  );
}

/** Tlačítko „Zavřít“ v patičce listu (velký cíl pro palec). */
export function SheetCloseButton({ onClose }: { onClose: () => void }) {
  return (
    <button type="button" onClick={onClose} className="mx-3 mt-1 h-11 w-[calc(100%-24px)] shrink-0 rounded-lg bg-[#eef2f6] text-[14px] font-medium text-[#26303b]">
      {tr("Zavřít")}
    </button>
  );
}

/**
 * Boční panel, na úzkém displeji spodní list (třídy `max-sm:` určuje volající). Záhlaví označte `data-sheet-grip`
 * (a `max-sm:touch-none`), aby šlo list táhnout i za něj.
 */
export function SheetAside({ onClose, className, children, ...rest }: { onClose: () => void; className?: string; children: React.ReactNode } & Omit<React.HTMLAttributes<HTMLElement>, "children" | "className">) {
  const narrow = useNarrowSheet();
  const ref = useRef<HTMLElement>(null);
  useSheetDrag({ enabled: narrow, sheetRef: ref, onClose, esc: false });
  return (
    <aside ref={ref} data-bottom-sheet={narrow ? "" : undefined} {...rest} className={cn(className, "max-sm:overscroll-contain")}>
      {narrow && <SheetGrip className="bg-[#f7f9fb]" />}
      {children}
    </aside>
  );
}
