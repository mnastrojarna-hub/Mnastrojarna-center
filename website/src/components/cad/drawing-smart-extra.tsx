"use client";
/**
 * Výkresové prostředí – doplněk sekce Chytré kóty (vlna 15, B8 / B12): funkční rozměry (nikdy pomocná kóta „(…)“)
 * a způsob kótování poloh děr (auto / souřadnicově / tabulkou / od hran). Stejné volby jako textem
 * `kótovat … funkční 26,5 74,175` a `kótovat … díry tabulka|souřadnicově|řetězově`.
 */
import { useEffect, useState } from "react";
import { tr } from "@/cad/i18n";
import type { DrawingOptions, PlacedView } from "@/cad/drawing";
import { tolCheckLines } from "@/cad/drawing-agent";
import type { DrawingAnnotation } from "@/cad/types";
import { cn } from "@/lib/cn";

type HoleMode = NonNullable<DrawingOptions["dimHoles"]>;
const fmt = (n: number) => String(n).replace(".", ",");
/** „26,5; 74,175“ → [26.5, 74.175] (oddělovač středník nebo mezera – čárka je desetinná) */
export const parseFunctional = (t: string): number[] => t.split(/[;\s]+/).map((x) => Number(x.replace(",", "."))).filter((n) => Number.isFinite(n) && n > 0);

export function SmartDimsExtra({ opts, set }: { opts: Pick<DrawingOptions, "dimFunctional" | "dimHoles" | "holeTable">; set: <K extends "dimFunctional" | "dimHoles" | "holeTable">(k: K, v: DrawingOptions[K]) => void }) {
  const text = (opts.dimFunctional ?? []).map(fmt).join("; ");
  const [t, setT] = useState(text);
  useEffect(() => setT(text), [text]);
  const commit = () => {
    const list = parseFunctional(t);
    set("dimFunctional", list.length ? list : undefined);
    setT(list.map(fmt).join("; "));
  };
  const modes: { v: HoleMode; l: string }[] = [
    { v: "auto", l: tr("auto") },
    { v: "ordinate", l: tr("souřadnicově") },
    { v: "table", l: tr("tabulkou děr") },
    { v: "chain", l: tr("od hran") },
  ];
  const mode = opts.dimHoles ?? "auto";
  return (
    <div data-smart-extra className="mb-1.5 space-y-1.5">
      <label className="block">
        <span className="mb-0.5 block text-[11px] text-ink-700/55">{tr("Funkční rozměry (nikdy v závorce)")}</span>
        <input
          data-functional
          className="w-full rounded-md border border-ink-700/15 px-2 py-1 font-mono text-[12px] outline-none focus:border-brand"
          value={t}
          placeholder={tr("např. 26,5; 74,175")}
          inputMode="decimal"
          onChange={(e) => setT(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => e.key === "Enter" && commit()}
        />
      </label>
      <div>
        <span className="mb-0.5 block text-[11px] text-ink-700/55">{tr("Polohy děr")}</span>
        <div data-hole-mode className="flex rounded-md bg-steel-100 p-0.5">
          {modes.map((o) => (
            <button
              key={o.v}
              type="button"
              onClick={() => {
                set("dimHoles", o.v === "auto" ? undefined : o.v);
                // polohy kótami = tabulka děr by je opakovala (vypne se); tabulkou = tabulka se zapne – jako kótovat díry …
                if ((o.v === "ordinate" || o.v === "chain") && opts.holeTable) set("holeTable", false);
                if (o.v === "table" && !opts.holeTable) set("holeTable", true);
              }}
              className={cn("flex-1 rounded px-1 py-1 text-[11px] transition", mode === o.v ? "bg-white font-semibold text-ink-700 shadow-sm" : "text-ink-700/60 hover:text-ink-700")}>
              {o.l}
            </button>
          ))}
        </div>
        <p className="mt-0.5 text-[10.5px] leading-snug text-ink-700/50">{tr("Auto: od hran; od 12 poloh nebo když se nevejdou souřadnicové kóty od levého dolního rohu, pak tabulka děr.")}</p>
      </div>
    </div>
  );
}

/** Výsledek `výkres kontrola tolerancí` v panelu Kontrola kót (funkční rozměry bez tolerance). */
export function TolCheckBlock({ views, ann, opts }: { views: PlacedView[]; ann: DrawingAnnotation[]; opts: Partial<DrawingOptions> }) {
  if (!opts.dimFunctional?.length) return null;
  const r = tolCheckLines(views, ann, opts);
  return (
    <div data-tol-check className="mt-1.5 border-t border-ink-700/10 pt-1">
      {r.lines.map((l, i) => (
        <p key={i} className={cn("leading-snug", i === 0 ? "font-semibold" : "pl-2", /⚠/.test(l) ? "text-brand" : "")}>
          {l.trim()}
        </p>
      ))}
    </div>
  );
}
