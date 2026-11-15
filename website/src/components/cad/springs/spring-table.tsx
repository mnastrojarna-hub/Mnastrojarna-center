"use client";

/**
 * Tabulka pružiny – stejná v průvodci i ve formuláři úpravy prvku: vstupní řádky (povinné tučně nahoře, výchozí hodnoty
 * v zástupném textu, nápověda s normou, hláška vedle řádku) a pod nimi živě spočtené řádky (tuhost, Ln, síly, napětí…).
 *
 * Pro automatizaci: řádek `[data-spring-row="<klíč>"]` (pole `input` / `select`), hláška `[data-spring-issue="<klíč>"]`,
 * spočtený řádek `[data-spring-calc="<klíč>"]`.
 */
import { useEffect, useState } from "react";
import { tr } from "@/cad/i18n";
import { rowVisible, type CalcRow, type Issue, type SpringData, type SpringRow } from "@/cad/springs";
import { discPresets } from "@/cad/springs";
import { cn } from "@/lib/cn";

const cellIn = "w-full min-w-0 rounded border border-[#cfd6de] bg-white px-2 py-1 text-[13px] outline-none focus:border-brand focus:ring-2 focus:ring-brand/15";
const GROUP: Record<SpringRow["group"], () => string> = {
  basic: () => tr("Rozměry"),
  ends: () => tr("Konce a uložení"),
  load: () => tr("Pracovní body (nepovinné)"),
  material: () => tr("Materiál a vinutí"),
  place: () => tr("Umístění"),
};

const showNum = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? String(v).replace(".", ",") : typeof v === "string" ? v : "");

/** číselné pole: píše se volně (čárka i tečka), do dat jde až platné číslo; prázdné = nezadáno */
function NumCell({ value, onChange, placeholder, label }: { value: unknown; onChange: (v: number | undefined) => void; placeholder?: string; label: string }) {
  const [text, setText] = useState(showNum(value));
  const [focus, setFocus] = useState(false);
  useEffect(() => {
    if (!focus) setText(showNum(value));
  }, [value, focus]);
  return (
    <input
      className={cellIn}
      inputMode="decimal"
      aria-label={label}
      value={text}
      placeholder={placeholder}
      onFocus={() => setFocus(true)}
      onBlur={() => {
        setFocus(false);
        setText(showNum(value));
      }}
      onChange={(e) => {
        const t = e.target.value;
        setText(t);
        if (!t.trim()) return onChange(undefined);
        const n = Number(t.trim().replace(",", "."));
        if (Number.isFinite(n)) onChange(n);
      }}
    />
  );
}

export function SpringTable({ rows, data, onChange, issues, calc }: { rows: SpringRow[]; data: SpringData; onChange: (patch: SpringData) => void; issues: Issue[]; calc: CalcRow[] }) {
  const vis = rows.filter((r) => rowVisible(r, data));
  const groups = [...new Set(vis.map((r) => r.group))];
  const issueOf = (k: string) => issues.filter((i) => i.key === k || (k === "De" && (i.key === "D" || i.key === "Di")));
  const set = (k: string, v: unknown) => onChange({ [k]: v });
  return (
    <div className="space-y-2" data-spring-table>
      {groups.map((g) => (
        <div key={g}>
          <p className="mb-0.5 text-[10.5px] font-semibold uppercase tracking-wider text-[#6b7785]">{GROUP[g]()}</p>
          <div className="divide-y divide-[#edf1f5] rounded border border-[#e3e8ee]">
            {vis
              .filter((r) => r.group === g)
              .map((r) => {
                const iss = issueOf(r.key);
                const v = data[r.key];
                const def = r.def !== undefined ? String(r.def).replace(".", ",") : r.alt ? tr("nebo jiný z řádků") : "";
                return (
                  <div key={r.key} data-spring-row={r.key} className={cn("grid grid-cols-[minmax(0,1.25fr)_minmax(0,1fr)] items-center gap-x-2 px-2 py-1", r.required && "bg-[#fbfcfd]")}>
                    <div className="min-w-0">
                      <p className={cn("truncate text-[12.5px]", r.required ? "font-semibold text-[#0b1f33]" : "text-[#26303b]")} title={r.hint}>
                        {r.label}
                        {r.unit ? <span className="text-[#6b7785]"> [{r.unit}]</span> : null}
                      </p>
                      <p className="truncate text-[10.5px] text-[#6b7785]" title={r.hint}>
                        {r.hint}
                      </p>
                    </div>
                    <div className="min-w-0">
                      {r.kind === "enum" ? (
                        <select className={cellIn} aria-label={r.label} value={String(v ?? r.def ?? "")} onChange={(e) => set(r.key, e.target.value === "" ? undefined : e.target.value)}>
                          {r.def === undefined && <option value="">{tr("—")}</option>}
                          {(r.options ?? []).map((o) => (
                            <option key={o.v} value={o.v}>
                              {o.l}
                            </option>
                          ))}
                        </select>
                      ) : r.kind === "bool" ? (
                        <input type="checkbox" aria-label={r.label} checked={!!v} onChange={(e) => set(r.key, e.target.checked)} className="accent-[#E03930]" />
                      ) : r.key === "De" && data.series !== undefined && data.series !== "custom" ? (
                        <select className={cellIn} aria-label={r.label} value={String(v ?? 40)} onChange={(e) => set("De", Number(e.target.value))}>
                          {discPresets(String(data.series)).map((x) => (
                            <option key={x} value={x}>
                              {String(x).replace(".", ",")}
                            </option>
                          ))}
                        </select>
                      ) : (
                        <NumCell value={v} label={r.label} placeholder={def} onChange={(n) => set(r.key, n)} />
                      )}
                    </div>
                    {iss.map((i, k) => (
                      <p key={k} data-spring-issue={r.key} role={i.level === "error" ? "alert" : undefined} className={cn("col-span-2 mt-0.5 text-[11.5px] leading-snug", i.level === "error" ? "text-brand-600" : i.level === "warn" ? "text-amber-700" : "text-[#4b5866]")}>
                        {i.level === "error" ? "✗ " : i.level === "warn" ? "⚠ " : "ℹ "}
                        {i.text}
                      </p>
                    ))}
                  </div>
                );
              })}
          </div>
        </div>
      ))}
      {calc.length > 0 && (
        <div>
          <p className="mb-0.5 text-[10.5px] font-semibold uppercase tracking-wider text-[#6b7785]">{tr("Spočteno")}</p>
          <div className="divide-y divide-[#edf1f5] rounded border border-[#e3e8ee] bg-[#f7f9fb]" data-spring-calcs>
            {calc.map((c) => (
              <div key={c.key} data-spring-calc={c.key} className="flex items-baseline justify-between gap-3 px-2 py-0.5 text-[12px]">
                <span className="min-w-0 truncate text-[#4b5866]">{c.label}</span>
                <span className={cn("shrink-0 text-right font-mono", c.level === "warn" ? "text-amber-700" : c.level === "error" ? "text-brand-600" : "text-[#0b1f33]")}>{c.text}</span>
              </div>
            ))}
          </div>
        </div>
      )}
      {issues.filter((i) => !i.key || !vis.some((r) => r.key === i.key || (r.key === "De" && (i.key === "D" || i.key === "Di")))).map((i, k) => (
        <p key={k} data-spring-issue={i.key ?? "general"} className={cn("text-[11.5px]", i.level === "error" ? "text-brand-600" : "text-amber-700")}>
          {i.level === "error" ? "✗ " : "⚠ "}
          {i.text}
        </p>
      ))}
    </div>
  );
}
