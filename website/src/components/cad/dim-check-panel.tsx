"use client";
/**
 * Panel „Kontrola kót“ výkresového prostředí (vlna 22, bod 18 – cad/dim-complete.ts, text `výkres kontrola kót`):
 * velikosti a polohy prvků výsledného dílu zvlášť, chybějící položky s tlačítkem „Přidat kótu“ (= `výkres doplnit kóty`),
 * pomocná (nástrojová) tělesa šedě, funkční prvky a jejich tolerance, přetolerování (ℹ). Nikdy „všech N“ – panel říká, co
 * zkontroloval, co chybí a co se nekontroluje.
 */
import type { ReactNode } from "react";
import { useMemo } from "react";
import { isMissing, markLabel, type DimReq } from "@/cad/dim-complete";
import type { DrawingOptions, DrawingResult } from "@/cad/drawing";
import { sheetDimCheck, suggestionsFor } from "@/cad/drawing-dimcheck";
import { makeManualDim } from "@/cad/drawing-marks";
import { tr } from "@/cad/i18n";
import type { CadDoc, DrawingAnnotation } from "@/cad/types";
import { cn } from "@/lib/cn";

type Props = {
  doc: CadDoc;
  /** výsledek listu s poznámkami listu */
  out: DrawingResult | null;
  ann: DrawingAnnotation[];
  opts: Partial<DrawingOptions>;
  /** přidat kóty (návrh kontroly) do poznámek listu */
  onAdd: (anns: DrawingAnnotation[]) => void;
  /** chybová / informační hláška (toast) */
  flash?: (text: string) => void;
  /** kontrola tolerancí funkčních rozměrů listu (dosavadní blok) */
  children?: ReactNode;
};

const MARK: Record<DimReq["status"], string> = { ok: "✓", partial: "◐", missing: "✗", unchecked: "–" };

export function DimCheckPanel({ doc, out, ann, opts, onAdd, flash, children }: Props) {
  const r = useMemo(() => (out ? sheetDimCheck(doc, out, ann, opts) : null), [doc, out, ann, opts]);
  if (!out) return null;
  if (!r)
    return (
      <div data-dim-check data-dim-asm className="mt-1 rounded-md border border-ink-700/10 bg-steel-100/60 p-2 text-[11px]">
        <p>{tr("List sestavy – rozměry dílů se kontrolují na výkresech dílů.")}</p>
        {children}
      </div>
    );
  const add = (which: "all" | "size" | "pos", only?: DimReq) => {
    const sug = suggestionsFor(r, doc, out.views, which).filter((x) => !only || x.item.id === only.id);
    const made: DrawingAnnotation[] = [];
    const failed: string[] = [];
    const per = new Map<string, number>();
    for (const { item, dim } of sug) {
      if (!dim) {
        failed.push(item.label);
        continue;
      }
      try {
        const k = `${dim.view}:${dim.kind}`;
        const n = per.get(k) ?? 0;
        per.set(k, n + 1);
        made.push(makeManualDim(out, opts, dim, dim.kind === "diameter" ? 8 : 10 + 7 * n).ann);
      } catch (e) {
        failed.push(`${item.label} – ${e instanceof Error ? e.message : String(e)}`);
      }
    }
    if (made.length) onAdd(made);
    flash?.(made.length ? tr("Přidáno kót: {0}{1}", made.length, failed.length ? tr(" · nejde automaticky: {0}", failed.join("; ")) : "") : tr("Kótu nejde navrhnout automaticky: {0} – použijte nástroj Kóta", failed.join("; ") || "—"));
  };
  const sizes = r.items.filter((q) => q.kind === "size");
  const pos = r.items.filter((q) => q.kind === "pos");
  const missing = r.items.filter(isMissing);
  const row = (q: DimReq) => (
    <li key={q.id} data-dim-item={q.id} data-dim-status={q.status} data-dim-functional={q.functional ? (q.tolState ?? "missing") : undefined} className="flex items-center gap-1">
      <span className={cn("w-3 shrink-0 text-center", q.status === "ok" ? "text-emerald-700" : q.status === "unchecked" ? "text-ink-700/40" : "text-brand")}>{MARK[q.status]}</span>
      <span className="min-w-0 flex-1 truncate" title={`${q.label} · ${q.source}${q.why ? ` · ${q.why}` : ""}`}>
        {q.label}
        {q.why ? <span className="text-ink-700/50"> · {q.why}</span> : null}
        {q.functional ? <span className={cn("ml-1 rounded px-1 text-[10px]", q.tolState === "ok" ? "bg-emerald-50 text-emerald-800" : "bg-amber-50 text-amber-800")}>{q.tolState === "ok" ? tr("funkční · tol. {0}", (q.tols ?? []).find((t) => t.trim()) ?? "") : q.tolState === "differs" ? tr("funkční · tol. ≠ {0}", q.tol ?? "") : tr("funkční · bez tolerance")}</span> : null}
      </span>
      {isMissing(q) ? (
        <button type="button" data-dim-add={q.id} onClick={() => add("all", q)} className="shrink-0 rounded border border-ink-700/15 px-1 py-0 text-[10px] hover:bg-white" title={tr("Přidat navrženou kótu (od hrany dílu / základny) – upravíte ji v seznamu kót")}>
          {tr("Přidat kótu")}
        </button>
      ) : (
        <span className="shrink-0 text-ink-700/40">{q.source.length > 18 ? `${q.source.slice(0, 17)}…` : q.source}</span>
      )}
    </li>
  );
  return (
    <div data-dim-check data-dim-size={`${r.size.ok}/${r.size.total}`} data-dim-pos={`${r.pos.ok}/${r.pos.total}`} data-dim-incomplete={missing.length ? "1" : "0"} className="mt-1 rounded-md border border-ink-700/10 bg-steel-100/60 p-2 text-[11px]">
      <p className="font-semibold">
        {tr("Velikosti {0}/{1} · polohy {2}/{3}", r.size.ok, r.size.total, r.pos.ok, r.pos.total)}
        {missing.length ? <span className="ml-1 text-brand">{tr("· chybí {0}", missing.length)}</span> : null}
      </p>
      {missing.length > 1 && (
        <button type="button" data-dim-add-all onClick={() => add("all")} className="mt-1 w-full rounded border border-ink-700/15 px-2 py-0.5 text-[11px] hover:bg-white">
          {tr("Přidat všechny navržené kóty ({0})", missing.length)}
        </button>
      )}
      {children}
      <div className="mt-1 grid gap-1">
        <div data-dim-sizes>
          <span className="block text-ink-700/55">{tr("Velikosti")}</span>
          <ul className="max-h-36 space-y-0.5 overflow-y-auto">{[...sizes.filter(isMissing), ...sizes.filter((q) => !isMissing(q))].map(row)}</ul>
        </div>
        <div data-dim-positions>
          <span className="block text-ink-700/55">{tr("Polohy")}</span>
          {pos.length ? <ul className="max-h-36 space-y-0.5 overflow-y-auto">{[...pos.filter(isMissing), ...pos.filter((q) => !isMissing(q))].map(row)}</ul> : <p className="text-ink-700/45">{tr("žádné polohy k ověření")}</p>}
        </div>
      </div>
      {r.aux.length > 0 && (
        <p data-dim-aux className="mt-1 text-ink-700/45">
          {tr("Pomocná tělesa (nekótují se): {0}", r.aux.map((a) => `${a.name} (${a.op === "cut" ? tr("odebráno") : tr("průnik")})`).join(", "))}
        </p>
      )}
      <div data-dim-functional-marks className="mt-1">
        {doc.functional?.length ? (
          <p className="text-ink-700/70">
            {tr("Funkční prvky a základny: {0} · tolerance {1}/{2}", doc.functional.map((m) => markLabel(doc, m)).join(", "), r.tol.ok, r.tol.ok + r.tol.missing.length)}
          </p>
        ) : (
          <p className="text-ink-700/55">{tr("Tolerance neověřeny – funkční prvky nejsou vyznačené (pravým tlačítkem na plochu v modelu: Označit jako funkční / základnu; textem funkční F7 H7, základna A F3).")}</p>
        )}
        {r.tol.over.length > 0 && (
          <p data-dim-over className="text-sky-800">
            {tr("ℹ Přesná tolerance na rozměru, který není funkční: {0}", r.tol.over.map((o) => `${o.label} ${o.tol}`).join(", "))}
          </p>
        )}
      </div>
      {r.unchecked.length > 0 && <p data-dim-unchecked className="mt-1 text-ink-700/45">{tr("Nezkontrolováno: {0}", r.unchecked.join("; "))}</p>}
      <p className="mt-1 leading-snug text-ink-700/55">{tr("Kontrola zná jen rozměry odvozené z historie modelu a vyznačené funkční prvky – úplnost výrobního výkresu potvrzuje konstruktér.")}</p>
    </div>
  );
}
