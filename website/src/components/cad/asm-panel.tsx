"use client";

import { useState } from "react";
import { defaultMoldBase, type BomRow, type MoldBaseParams } from "@/cad/assembly";
import type { AsmComponent, CadDoc, Vec3 } from "@/cad/types";
import { MATERIALS, fmtNum } from "@/lib/mesh-metrics";
import { cn } from "@/lib/cn";
import { CadIcon } from "./cad-icons";
import { Num, Vec } from "./props";
import type { RMenuEntry } from "./ribbon";

/** Strom sestavy (levý panel) – komponenty seskupené podle skupin kusovníku. */
export function AsmTree({
  doc,
  selected,
  onSelect,
  onCommit,
  onContext,
  menuFor,
}: {
  doc: CadDoc;
  selected: string | null;
  onSelect: (id: string | null) => void;
  onCommit: (d: CadDoc) => void;
  onContext: (x: number, y: number, entries: RMenuEntry[]) => void;
  menuFor: (c: AsmComponent) => RMenuEntry[];
}) {
  const comps = doc.components ?? [];
  const groups = new Map<string, AsmComponent[]>();
  for (const c of comps) {
    const g = c.group || "Díly";
    groups.set(g, [...(groups.get(g) ?? []), c]);
  }
  const [closed, setClosed] = useState<Record<string, boolean>>({});
  const setComp = (id: string, patch: Partial<AsmComponent>) => onCommit({ ...doc, components: comps.map((c) => (c.id === id ? { ...c, ...patch } : c)) });
  return (
    <div className="min-h-0 flex-1 overflow-y-auto py-1 text-[12.5px]">
      <div className="flex items-center gap-2 px-3 py-1.5 font-semibold">
        <CadIcon name="layers" tone="create" className="h-4 w-4" />
        <span className="truncate">{doc.name}</span>
        <span className="ml-auto font-mono text-[10.5px] font-normal text-[#8a95a3]">{comps.length} ks</span>
      </div>
      {comps.length === 0 && <p className="m-3 rounded border border-dashed border-[#cdd5de] p-3 text-[11.5px] leading-relaxed text-[#6b7785]">Sestava je prázdná. Na kartě Sestava vložte díl, normálii nebo vygenerujte rám formy.</p>}
      {[...groups.entries()].map(([g, list]) => (
        <div key={g} className="ml-3 border-l border-dashed border-[#cdd5de] pl-1">
          <button type="button" onClick={() => setClosed((c) => ({ ...c, [g]: !c[g] }))} className="flex w-full items-center gap-1.5 px-1.5 py-[3px] text-left text-[11.5px] font-semibold text-[#4a5664]">
            <CadIcon name={closed[g] ? "chevronRight" : "chevronDown"} className="h-3 w-3" />
            {g}
            <span className="ml-auto pr-2 font-mono text-[10px] font-normal text-[#8a95a3]">{list.length}</span>
          </button>
          {!closed[g] &&
            list.map((c) => (
              <div
                key={c.id}
                onClick={() => onSelect(c.id === selected ? null : c.id)}
                onContextMenu={(e) => {
                  e.preventDefault();
                  onSelect(c.id);
                  onContext(e.clientX, e.clientY, menuFor(c));
                }}
                className={cn("group ml-3 flex cursor-default items-center gap-2 rounded px-2 py-[3px]", c.id === selected ? "bg-[#dbe7f5]" : "hover:bg-[#edf2f7]", c.hidden && "opacity-45")}
              >
                <span className="h-3 w-3 shrink-0 rounded-sm border border-black/20" style={{ background: c.color ?? "#b9c2cc" }} />
                <span className="min-w-0 flex-1 truncate">{c.name}</span>
                {c.fixed && <CadIcon name="lock" className="h-3 w-3 text-[#8a95a3]" />}
                <button
                  type="button"
                  title={c.hidden ? "Zobrazit" : "Skrýt"}
                  onClick={(e) => {
                    e.stopPropagation();
                    setComp(c.id, { hidden: !c.hidden });
                  }}
                  className="hidden text-[#6b7785] hover:text-[#1f2933] group-hover:block"
                >
                  <CadIcon name="eye" className="h-3.5 w-3.5" />
                </button>
              </div>
            ))}
        </div>
      ))}
    </div>
  );
}

/** Vlastnosti komponenty (pravý panel). */
export function AsmProps({ c, onChange, onMate, mating }: { c: AsmComponent; onChange: (p: Partial<AsmComponent>) => void; onMate: (mode: "mate" | "flush" | "center") => void; mating: boolean }) {
  return (
    <div className="space-y-4">
      <label className="block">
        <span className="mb-1 block text-[11px] font-medium uppercase tracking-wider text-ink-700/55">Název</span>
        <input defaultValue={c.name} key={c.id + c.name} onBlur={(e) => e.target.value.trim() && onChange({ name: e.target.value.trim() })} className="w-full rounded-lg border border-ink-700/12 px-2.5 py-1.5 text-[13px] outline-none focus:border-brand" />
      </label>
      <div className="grid grid-cols-2 gap-2">
        <label className="block">
          <span className="mb-1 block text-[11px] font-medium uppercase tracking-wider text-ink-700/55">Číslo / norma</span>
          <input defaultValue={c.number ?? ""} key={c.id + (c.number ?? "")} onBlur={(e) => onChange({ number: e.target.value.trim() || undefined })} className="w-full rounded-lg border border-ink-700/12 px-2.5 py-1.5 text-[13px] outline-none focus:border-brand" />
        </label>
        <label className="block">
          <span className="mb-1 block text-[11px] font-medium uppercase tracking-wider text-ink-700/55">Skupina</span>
          <input defaultValue={c.group ?? ""} key={c.id + (c.group ?? "")} onBlur={(e) => onChange({ group: e.target.value.trim() || undefined })} className="w-full rounded-lg border border-ink-700/12 px-2.5 py-1.5 text-[13px] outline-none focus:border-brand" />
        </label>
      </div>
      <Vec label="Poloha [mm]" value={c.placement.position} onChange={(v: Vec3) => onChange({ placement: { ...c.placement, position: v } })} />
      <Vec label="Natočení X / Y / Z [°]" value={c.placement.rotation} onChange={(v: Vec3) => onChange({ placement: { ...c.placement, rotation: v } })} />
      <div className="grid grid-cols-3 gap-1.5">
        {(["X", "Y", "Z"] as const).map((a, i) => (
          <button
            key={a}
            type="button"
            onClick={() => onChange({ placement: { ...c.placement, rotation: c.placement.rotation.map((v, k) => (k === i ? (v + 90) % 360 : v)) as Vec3 } })}
            className="rounded border border-[#cfd6de] py-1 text-[11.5px] hover:bg-[#f3f6f9]"
          >
            +90° {a}
          </button>
        ))}
      </div>
      <div>
        <p className="mb-1 text-[11px] font-medium uppercase tracking-wider text-ink-700/55">Vazby (zarovnání ploch)</p>
        <div className="grid grid-cols-3 gap-1.5">
          <button type="button" onClick={() => onMate("mate")} className={cn("rounded border py-1.5 text-[11.5px]", mating ? "border-brand bg-brand/10" : "border-[#cfd6de] hover:bg-[#f3f6f9]")} title="Plochy proti sobě, v jedné rovině">
            Kontakt
          </button>
          <button type="button" onClick={() => onMate("flush")} className="rounded border border-[#cfd6de] py-1.5 text-[11.5px] hover:bg-[#f3f6f9]" title="Plochy souhlasně v jedné rovině">
            Zarovnat
          </button>
          <button type="button" onClick={() => onMate("center")} className="rounded border border-[#cfd6de] py-1.5 text-[11.5px] hover:bg-[#f3f6f9]" title="Kontakt + ztotožnění středů ploch">
            Vystředit
          </button>
        </div>
        <p className="mt-1.5 text-[11px] leading-relaxed text-[#6b7785]">Klikněte na plochu této komponenty a pak na plochu jiné komponenty.</p>
      </div>
      <label className="block">
        <span className="mb-1 block text-[11px] font-medium uppercase tracking-wider text-ink-700/55">Barva</span>
        <input type="color" value={c.color ?? "#b9c2cc"} onChange={(e) => onChange({ color: e.target.value })} className="h-8 w-full cursor-pointer rounded border border-[#cfd6de]" />
      </label>
      {c.source.kind === "file" && (
        <label className="block">
          <span className="mb-1 block text-[11px] font-medium uppercase tracking-wider text-ink-700/55">Materiál (kusovník)</span>
          <select value={c.material ?? "ocel"} onChange={(e) => onChange({ material: e.target.value })} className="w-full rounded-lg border border-ink-700/12 bg-white px-2 py-1.5 text-[13px]">
            {MATERIALS.map((m) => (
              <option key={m.id} value={m.id}>
                {m.label}
              </option>
            ))}
          </select>
        </label>
      )}
      <label className="flex items-center gap-2 text-[12.5px]">
        <input type="checkbox" checked={!!c.fixed} onChange={(e) => onChange({ fixed: e.target.checked })} className="accent-[#E03930]" />
        Ukotvená (nepohyblivá)
      </label>
    </div>
  );
}

/** Kusovník – tabulka + CSV. */
export function BomTable({ rows, onCsv, onDrawing }: { rows: BomRow[]; onCsv: () => void; onDrawing?: () => void }) {
  const total = rows.reduce((s, r) => s + (r.massKg ?? 0) * r.qty, 0);
  return (
    <div>
      <div className="overflow-x-auto">
        <table className="w-full border-collapse text-[12px]">
          <thead>
            <tr className="bg-[#eef2f6] text-left text-[10.5px] uppercase tracking-wider text-[#5b6776]">
              <th className="px-2 py-1.5">Poz.</th>
              <th className="px-2 py-1.5">Název</th>
              <th className="px-2 py-1.5">Číslo / norma</th>
              <th className="px-2 py-1.5 text-right">Ks</th>
              <th className="px-2 py-1.5">Materiál</th>
              <th className="px-2 py-1.5 text-right">kg/ks</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.pos} className="border-b border-[#edf1f5]">
                <td className="px-2 py-1 font-mono">{r.pos}</td>
                <td className="px-2 py-1">{r.name}</td>
                <td className="px-2 py-1 text-[#5b6776]">{r.number ?? ""}</td>
                <td className="px-2 py-1 text-right font-mono">{r.qty}</td>
                <td className="px-2 py-1">{r.material ?? ""}</td>
                <td className="px-2 py-1 text-right font-mono">{r.massKg != null ? fmtNum(r.massKg, 3) : "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <span className="text-[12px] text-[#5b6776]">
          Celkem {rows.reduce((s, r) => s + r.qty, 0)} ks · {fmtNum(total, 2)} kg
        </span>
        <span className="flex-1" />
        <button type="button" onClick={onCsv} className="rounded border border-[#cfd6de] px-3 py-1.5 text-[12px] hover:bg-[#f3f6f9]">
          Export CSV (Excel)
        </button>
        {onDrawing && (
          <button type="button" onClick={onDrawing} className="rounded bg-brand px-3 py-1.5 text-[12px] font-semibold text-white hover:bg-brand-600">
            Výkres sestavy s kusovníkem
          </button>
        )}
      </div>
    </div>
  );
}

/** Průvodce rámem vstřikovací formy. */
export function MoldWizard({ onCreate }: { onCreate: (p: MoldBaseParams) => void }) {
  const [p, setP] = useState<MoldBaseParams>(defaultMoldBase);
  const set = (k: keyof MoldBaseParams, v: number) => setP({ ...p, [k]: v });
  const sizes: [number, number][] = [
    [196, 196],
    [246, 246],
    [296, 296],
    [296, 346],
    [346, 396],
    [396, 446],
    [446, 546],
    [596, 696],
    [796, 996],
  ];
  return (
    <div className="space-y-4">
      <div>
        <p className="mb-1 text-[11px] font-medium uppercase tracking-wider text-ink-700/55">Velikost rámu (šířka × délka)</p>
        <div className="flex flex-wrap gap-1">
          {sizes.map(([w, l]) => (
            <button key={`${w}x${l}`} type="button" onClick={() => setP({ ...p, width: w, length: l })} className={cn("rounded border px-2 py-1 font-mono text-[11.5px]", p.width === w && p.length === l ? "border-brand bg-brand/10" : "border-[#cfd6de] hover:bg-[#f3f6f9]")}>
              {w}×{l}
            </button>
          ))}
        </div>
      </div>
      <div className="grid grid-cols-2 gap-2.5">
        <Num label="Šířka X" value={p.width} onChange={(v) => set("width", v)} min={100} />
        <Num label="Délka Y" value={p.length} onChange={(v) => set("length", v)} min={100} />
        <Num label="Deska A (pevná)" value={p.aPlate} onChange={(v) => set("aPlate", v)} min={10} />
        <Num label="Deska B (pohyblivá)" value={p.bPlate} onChange={(v) => set("bPlate", v)} min={10} />
        <Num label="Upínací desky" value={p.clamp} onChange={(v) => set("clamp", v)} min={10} />
        <Num label="Opěrná deska" value={p.support} onChange={(v) => set("support", v)} min={10} />
        <Num label="Výška rozpěrek" value={p.spacer} onChange={(v) => set("spacer", v)} min={40} />
        <Num label="Šířka rozpěrek" value={p.spacerWidth} onChange={(v) => set("spacerWidth", v)} min={20} />
        <Num label="Vyhazovací deska" value={p.ejector} onChange={(v) => set("ejector", v)} min={8} />
        <Num label="Kotevní deska" value={p.retainer} onChange={(v) => set("retainer", v)} min={8} />
        <Num label="Ø vodicích sloupků" value={p.pillar} onChange={(v) => set("pillar", v)} min={10} />
      </div>
      <label className="flex items-center gap-2 text-[12.5px]">
        <input type="checkbox" checked={!!p.cavity} onChange={(e) => setP({ ...p, cavity: e.target.checked ? { w: Math.round(p.width * 0.45), l: Math.round(p.length * 0.5), depth: Math.round(p.aPlate * 0.5) } : null })} className="accent-[#E03930]" />
        Dutina v desce A (kapsa pro tvarovou vložku)
      </label>
      {p.cavity && (
        <div className="grid grid-cols-3 gap-2">
          <Num label="Kapsa X" value={p.cavity.w} onChange={(v) => setP({ ...p, cavity: { ...p.cavity!, w: v } })} />
          <Num label="Kapsa Y" value={p.cavity.l} onChange={(v) => setP({ ...p, cavity: { ...p.cavity!, l: v } })} />
          <Num label="Hloubka" value={p.cavity.depth} onChange={(v) => setP({ ...p, cavity: { ...p.cavity!, depth: v } })} />
        </div>
      )}
      <label className="block">
        <span className="mb-1 block text-[11px] font-medium uppercase tracking-wider text-ink-700/55">Materiál desek</span>
        <select value={p.material} onChange={(e) => setP({ ...p, material: e.target.value })} className="w-full rounded-lg border border-ink-700/12 bg-white px-2 py-1.5 text-[13px]">
          {MATERIALS.map((m) => (
            <option key={m.id} value={m.id}>
              {m.label}
            </option>
          ))}
        </select>
      </label>
      <p className="rounded bg-[#eef2f6] p-2.5 text-[11.5px] leading-relaxed text-[#4a5664]">
        Vytvoří kompletní dvoudeskový rám: upínací desky, tvarové desky A/B, opěrnou desku, rozpěrky, vyhazovací paket, 4 vodicí sloupky s pouzdry (jeden přesazený proti obrácené montáži), šrouby ISO 4762, vyhazovače a středicí kroužek. Výška formy{" "}
        <strong>{fmtNum(2 * p.clamp + p.spacer + p.support + p.aPlate + p.bPlate + 10, 0)} mm</strong>.
      </p>
      <button type="button" onClick={() => onCreate(p)} className="w-full rounded bg-brand py-2 text-[13px] font-semibold text-white hover:bg-brand-600">
        Vytvořit rám formy
      </button>
    </div>
  );
}
