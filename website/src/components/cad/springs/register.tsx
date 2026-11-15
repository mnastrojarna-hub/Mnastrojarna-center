"use client";

/**
 * UI pružin: ikony druhů a formulář úpravy prvku `spring.*` = stejná tabulka jako v průvodci (vstupy, hlášky u řádků,
 * spočtené řádky, náhled) + umístění (poloha, osa, délka tvaru, operace). Poloha / osa zadaná odkazem na geometrii se
 * upravuje textem nebo obecným příkazem `prvek`; formulář ji ukáže a dovolí vrátit na souřadnice.
 */
import { useMemo } from "react";
import { tr } from "@/cad/i18n";
import { springTableLines } from "@/cad/agent-springs";
import { kindOfExt, springCalc, type SpringData } from "@/cad/springs";
import type { Vec3 } from "@/cad/types";
import { registerIcon } from "../ext/icons";
import { registerExtUi, type ExtFormProps } from "../ext/registry";
import { Num, Seg, Vec } from "../props";
import { SpringPreview } from "./spring-preview";
import { SpringTable } from "./spring-table";

registerIcon("spring-ext", <><path d="M12 1.5a2 2 0 1 1 0 4" /><path d="M12 5.5v1M7 7h10l-10 3h10l-10 3h10l-10 3h10" /><path d="M12 17.5v1" /><path d="M12 22.5a2 2 0 1 1 0-4" /></>);
registerIcon("spring-torsion", <><path d="M8 6h8l-8 3h8l-8 3h8l-8 3h8" /><path d="M8 6L3 3M16 15l5 4" /></>);
registerIcon("spring-disc", <><path d="M3 9l9-3 9 3" /><path d="M3 12l9 3 9-3" /><path d="M3 15l9-3 9 3" /><path d="M3 18l9 3 9-3" /></>);

const AXES = ["Z", "-Z", "X", "-X", "Y", "-Y"];
/** operace prvku pružiny (data.mode): nové těleso / přidat k tělesu / odebrat / průnik */
export const MODE_OPTIONS: { v: string; l: () => string }[] = [
  { v: "new", l: () => tr("Nové těleso") },
  { v: "add", l: () => tr("Přidat") },
  { v: "cut", l: () => tr("Odebrat") },
  { v: "intersect", l: () => tr("Průnik") },
];
const axisKey = (a: unknown): string | null => {
  if (a === undefined || a === null || a === "") return "Z";
  if (typeof a === "string") return AXES.includes(a.toUpperCase()) ? a.toUpperCase() : null;
  const o = a as { kind?: string; axis?: string; v?: number[] };
  if (o.kind === "axis" && o.axis) return o.axis;
  if (o.kind === "vector" && Array.isArray(o.v)) {
    const [x, y, z] = o.v;
    const l = Math.hypot(x, y, z) || 1;
    for (const k of AXES) {
      const s = k.startsWith("-") ? -1 : 1;
      const ax = k.slice(-1);
      const want = [ax === "X" ? s : 0, ax === "Y" ? s : 0, ax === "Z" ? s : 0];
      if (Math.abs(x / l - want[0]) + Math.abs(y / l - want[1]) + Math.abs(z / l - want[2]) < 1e-9) return k;
    }
  }
  return null;
};

function SpringEditForm({ f, onChange }: ExtFormProps) {
  const data = useMemo(() => (f.data ?? {}) as SpringData, [f.data]);
  const k = kindOfExt(f.ext)!;
  const calc = useMemo(() => springCalc(f.ext, data), [f.ext, data]);
  const patch = (p: SpringData) => {
    const next: SpringData = {};
    for (const [key, v] of Object.entries(p)) {
      next[key] = v === "" ? undefined : v;
      const row = k.rows().find((r) => r.key === key);
      if (row?.alt && v !== undefined && v !== "") for (const other of k.rows()) if (other.alt === row.alt && other.key !== key && data[other.key] !== undefined) next[other.key] = undefined;
    }
    onChange(next);
  };
  const ax = axisKey(data.axis);
  const at = (Array.isArray(data.at) ? data.at : [0, 0, 0]) as Vec3;
  return (
    <div className="space-y-3" data-spring-form={k.kind}>
      <div className="flex items-center gap-2">
        <div className="rounded border border-[#e3e8ee] bg-white">
          <SpringPreview ext={f.ext} data={data} small />
        </div>
        <div className="min-w-0">
          <p className="text-[12.5px] font-semibold">{calc.title}</p>
          <p className="text-[11px] text-[#6b7785]">
            {k.label()} · {k.standard}
          </p>
        </div>
      </div>
      <SpringTable rows={k.rows()} data={data} onChange={patch} issues={calc.issues} calc={calc.rows} />
      <div className="space-y-2 rounded border border-[#e3e8ee] p-2">
        <p className="text-[10.5px] font-semibold uppercase tracking-wider text-[#6b7785]">{tr("Umístění")}</p>
        {data.atRef ? (
          <p className="text-[11.5px] text-[#4b5866]">
            {tr("Poloha je zadaná odkazem na geometrii.")}{" "}
            <button type="button" className="text-brand underline" onClick={() => onChange({ atRef: undefined })}>
              {tr("Zadat souřadnicemi")}
            </button>
          </p>
        ) : (
          <Vec label={tr("Poloha (začátek osy)")} value={at} bind={`${f.id}:data.at`} onChange={(v: Vec3) => onChange({ at: v })} />
        )}
        {ax ? (
          <Seg label={tr("Osa pružiny")} value={ax} options={AXES.map((a) => ({ v: a, l: a.replace("-", "−") }))} onChange={(v) => onChange({ axis: v })} />
        ) : (
          <p className="text-[11.5px] text-[#4b5866]">
            {tr("Osa je zadaná odkazem na geometrii.")}{" "}
            <button type="button" className="text-brand underline" onClick={() => onChange({ axis: "Z" })}>
              {tr("Osa Z")}
            </button>
          </p>
        )}
        {k.kind === "compression" && (
          <Num label={tr("Délka tvaru (0 = volná)")} value={typeof data.len === "number" ? data.len : 0} min={0} step={0.5} bind={`${f.id}:data.len`} hint={tr("tvar stlačené / protažené pružiny – výpočet zůstává pro L0")} onChange={(v) => onChange({ len: v > 0 ? v : undefined })} />
        )}
        {/* „přidat“ zapisuje průvodce (do tohoto dílu) i text `přidat` – musí mít vlastní volbu, jinak není nic zvýrazněno */}
        <Seg label={tr("Operace")} value={MODE_OPTIONS.some((o) => o.v === data.mode) ? String(data.mode) : "new"} options={MODE_OPTIONS.map((o) => ({ v: o.v, l: o.l() }))} onChange={(v) => onChange({ mode: v })} />
      </div>
    </div>
  );
}

for (const ext of ["spring.compression", "spring.extension", "spring.torsion", "spring.disc"]) registerExtUi(ext, { Form: SpringEditForm });

// `window.mncad.action("spring.table")` – údaje do protokolu (notice); text `pružina tabulka ["Název"|vše]` a `akce spring.table`
// provádí engine sám touto funkcí (engine/ops/doc-actions.ts – v aplikaci i v CLI); název nese `api.arg` (bez textu = poslední pružina)
registerExtUi("spring.table", {
  action: (api) => api.notice(tr("Tabulka pružin"), springTableLines(api.doc, api.arg ?? "").join("\n")),
});
