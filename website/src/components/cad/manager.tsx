"use client";

import { useState } from "react";
import { resolveDoc } from "@/cad/params";
import { uid, type CadDoc, type Config, type Feature, type FeatureStatus, type Variable } from "@/cad/types";
import { MATERIALS } from "@/lib/mesh-metrics";
import { cn } from "@/lib/cn";
import { CadIcon, type CadIconName, type Tone } from "./cad-icons";
import type { RMenuEntry } from "./ribbon";

export const FEATURE_TONE: Record<string, Tone> = {
  sketch: "sketch",
  extrude: "create",
  revolve: "create",
  sweep: "create",
  loft: "create",
  box: "create",
  cylinder: "create",
  sphere: "create",
  cone: "create",
  tube: "create",
  text: "create",
  hole: "cut",
  thread: "cut",
  split: "cut",
  fillet: "feature",
  chamfer: "feature",
  shell: "feature",
  draft: "feature",
  pattern: "pattern",
  mirror: "pattern",
  transform: "pattern",
  datum: "ref",
  import: "file",
};

type Tab = "history" | "vars" | "configs";

export function Manager({
  doc,
  status,
  activeId,
  sketchId,
  onSelect,
  onCommit,
  onContext,
}: {
  doc: CadDoc;
  status: FeatureStatus[] | undefined;
  activeId: string | null;
  sketchId: string | null;
  onSelect: (f: Feature) => void;
  onCommit: (d: CadDoc) => void;
  onContext: (x: number, y: number, entries: RMenuEntry[]) => void;
}) {
  const [tab, setTab] = useState<Tab>("history");
  const [renaming, setRenaming] = useState<string | null>(null);
  const resolved = resolveDoc(doc);
  const suppressedByConfig = new Set(doc.configs?.find((c) => c.id === doc.activeConfig)?.suppressed ?? []);

  const setFeatures = (features: Feature[]) => onCommit({ ...doc, features });
  const move = (id: string, d: -1 | 1) => {
    const i = doc.features.findIndex((f) => f.id === id);
    const j = i + d;
    if (i < 0 || j < 0 || j >= doc.features.length) return;
    const next = [...doc.features];
    [next[i], next[j]] = [next[j], next[i]];
    setFeatures(next);
  };
  const featureMenu = (f: Feature): RMenuEntry[] => [
    { id: "edit", label: f.type === "sketch" ? "Upravit skicu" : "Upravit parametry", icon: "edit", onClick: () => onSelect(f) },
    { id: "rename", label: "Přejmenovat", icon: "text", onClick: () => setRenaming(f.id) },
    { id: "supp", label: f.suppressed ? "Zapnout prvek" : "Potlačit prvek", icon: "eye", onClick: () => setFeatures(doc.features.map((x) => (x.id === f.id ? ({ ...x, suppressed: !x.suppressed } as Feature) : x))) },
    { id: "dup", label: "Duplikovat", icon: "copy", onClick: () => {
      const i = doc.features.findIndex((x) => x.id === f.id);
      const copy = { ...structuredClone(f), id: uid(), name: `${f.name} (kopie)` } as Feature;
      const next = [...doc.features];
      next.splice(i + 1, 0, copy);
      setFeatures(next);
    } },
    { divider: true },
    { id: "up", label: "Posunout výš", icon: "up", onClick: () => move(f.id, -1) },
    { id: "down", label: "Posunout níž", icon: "down", onClick: () => move(f.id, 1) },
    { divider: true },
    { id: "del", label: "Smazat", icon: "trash", tone: "cut", kbd: "Del", onClick: () => setFeatures(doc.features.filter((x) => x.id !== f.id)) },
  ];

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex shrink-0 border-b border-[#d5dbe2] bg-[#f3f6f9] text-[11.5px]">
        {(
          [
            ["history", "Historie", "tree"],
            ["vars", "Proměnné", "variables"],
            ["configs", "Stavy", "configs"],
          ] as [Tab, string, CadIconName][]
        ).map(([t, l, i]) => (
          <button
            key={t}
            type="button"
            onClick={() => setTab(t)}
            className={cn("flex flex-1 items-center justify-center gap-1.5 border-b-2 px-2 py-2 font-medium", tab === t ? "border-brand bg-white text-[#1f2933]" : "border-transparent text-[#5b6776] hover:text-[#1f2933]")}
          >
            <CadIcon name={i} className="h-3.5 w-3.5" />
            {l}
          </button>
        ))}
      </div>

      {tab === "history" && (
        <div className="min-h-0 flex-1 overflow-y-auto py-1">
          <div className="flex items-center gap-2 px-3 py-1.5 text-[12px] font-semibold text-[#1f2933]">
            <CadIcon name="cube" tone="create" className="h-4 w-4" />
            <span className="truncate">{doc.name}</span>
          </div>
          <div className="ml-5 border-l border-dashed border-[#cdd5de] pl-1">
            {[
              ["XY", "Rovina XY"],
              ["XZ", "Rovina XZ"],
              ["YZ", "Rovina YZ"],
            ].map(([k, l]) => (
              <div key={k} className="flex items-center gap-2 px-2 py-[3px] text-[12px] text-[#6b7785]">
                <CadIcon name="datum" tone="ref" className="h-3.5 w-3.5" />
                {l}
              </div>
            ))}
            {doc.features.length === 0 && <p className="m-2 rounded border border-dashed border-[#cdd5de] p-3 text-[11.5px] leading-relaxed text-[#6b7785]">Historie je prázdná. Začněte skicou (karta Tvorba → Skica) nebo vložte primitivum.</p>}
            {doc.features.map((f) => {
              const st = status?.find((s) => s.id === f.id);
              const isActive = f.id === activeId || f.id === sketchId;
              const off = f.suppressed || suppressedByConfig.has(f.id);
              return (
                <div key={f.id}>
                  <div
                    className={cn("group flex cursor-default items-center gap-2 rounded px-2 py-[3px] text-[12.5px]", isActive ? "bg-[#dbe7f5] text-[#0b1f33]" : "text-[#26303b] hover:bg-[#edf2f7]", off && "opacity-45")}
                    onClick={() => onSelect(f)}
                    onDoubleClick={() => setRenaming(f.id)}
                    onContextMenu={(e) => {
                      e.preventDefault();
                      onContext(e.clientX, e.clientY, featureMenu(f));
                    }}
                  >
                    <CadIcon name={(f.type as CadIconName) ?? "cube"} tone={FEATURE_TONE[f.type] ?? "create"} className="h-4 w-4 shrink-0" />
                    {renaming === f.id ? (
                      <input
                        autoFocus
                        defaultValue={f.name}
                        className="min-w-0 flex-1 rounded border border-brand px-1 text-[12.5px] outline-none"
                        onClick={(e) => e.stopPropagation()}
                        onBlur={(e) => {
                          setRenaming(null);
                          const name = e.target.value.trim();
                          if (name && name !== f.name) setFeatures(doc.features.map((x) => (x.id === f.id ? ({ ...x, name } as Feature) : x)));
                        }}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") (e.target as HTMLInputElement).blur();
                          if (e.key === "Escape") setRenaming(null);
                        }}
                      />
                    ) : (
                      <span className="min-w-0 flex-1 truncate">{f.name}</span>
                    )}
                    {st && !st.ok && (
                      <span className="grid h-4 w-4 shrink-0 place-items-center rounded-full bg-brand text-[10px] font-bold text-white" title={st.error}>
                        !
                      </span>
                    )}
                    <button
                      type="button"
                      title="Nabídka"
                      className="hidden rounded px-1 text-[#6b7785] hover:bg-white group-hover:block"
                      onClick={(e) => {
                        e.stopPropagation();
                        onContext(e.clientX, e.clientY, featureMenu(f));
                      }}
                    >
                      ⋯
                    </button>
                  </div>
                  {st && !st.ok && isActive && <p className="mx-2 mb-1 rounded bg-brand/10 px-2 py-1 text-[11px] text-brand-600">{st.error}</p>}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {tab === "vars" && <Variables doc={doc} values={resolved.values} errors={resolved.errors} onCommit={onCommit} />}
      {tab === "configs" && <Configs doc={doc} values={resolved.values} onCommit={onCommit} />}

      <div className="shrink-0 space-y-2 border-t border-[#d5dbe2] bg-[#f7f9fb] p-3">
        <label className="block">
          <span className="mb-1 block text-[10px] font-semibold uppercase tracking-wider text-[#6b7785]">Materiál</span>
          <select value={doc.material} onChange={(e) => onCommit({ ...doc, material: e.target.value })} className="w-full rounded border border-[#cfd6de] bg-white px-2 py-1 text-[12.5px]">
            {MATERIALS.map((x) => (
              <option key={x.id} value={x.id}>
                {x.label} ({x.density} g/cm³)
              </option>
            ))}
          </select>
        </label>
        {(doc.configs?.length ?? 0) > 0 && (
          <label className="block">
            <span className="mb-1 block text-[10px] font-semibold uppercase tracking-wider text-[#6b7785]">Aktivní stav</span>
            <select value={doc.activeConfig ?? ""} onChange={(e) => onCommit({ ...doc, activeConfig: e.target.value || null })} className="w-full rounded border border-[#cfd6de] bg-white px-2 py-1 text-[12.5px]">
              <option value="">Výchozí</option>
              {doc.configs!.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </label>
        )}
      </div>
    </div>
  );
}

const fmt = (n: number | undefined) => (n == null || !Number.isFinite(n) ? "—" : (Math.round(n * 1e4) / 1e4).toLocaleString("cs-CZ"));

function Variables({ doc, values, errors, onCommit }: { doc: CadDoc; values: Record<string, number>; errors: string[]; onCommit: (d: CadDoc) => void }) {
  const vars = doc.variables ?? [];
  const set = (next: Variable[]) => onCommit({ ...doc, variables: next });
  const bindings = Object.entries(doc.bindings ?? {});
  return (
    <div className="min-h-0 flex-1 overflow-y-auto p-2 text-[12px]">
      <p className="px-1 pb-2 leading-relaxed text-[#6b7785]">
        Proměnné řídí rozměry modelu. V poli parametru napište název proměnné nebo výraz (např. <code className="rounded bg-[#eef2f6] px-1">=d/2+3</code>).
      </p>
      <table className="w-full border-collapse">
        <thead>
          <tr className="text-left text-[10px] uppercase tracking-wider text-[#8a95a3]">
            <th className="px-1 pb-1 font-semibold">Název</th>
            <th className="px-1 pb-1 font-semibold">Výraz</th>
            <th className="px-1 pb-1 text-right font-semibold">Hodnota</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {vars.map((v, i) => (
            <tr key={i} className="border-t border-[#edf1f5]">
              <td className="p-0.5">
                <input
                  defaultValue={v.name}
                  key={v.name}
                  onBlur={(e) => {
                    const name = e.target.value.trim().replace(/[^\p{L}\p{N}_]/gu, "_");
                    if (name && name !== v.name) set(vars.map((x, k) => (k === i ? { ...x, name } : x)));
                  }}
                  className="w-full rounded border border-transparent px-1 py-0.5 font-mono hover:border-[#cfd6de] focus:border-brand focus:outline-none"
                />
              </td>
              <td className="p-0.5">
                <input
                  defaultValue={v.expr}
                  key={v.expr}
                  onBlur={(e) => e.target.value !== v.expr && set(vars.map((x, k) => (k === i ? { ...x, expr: e.target.value } : x)))}
                  onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()}
                  className="w-full rounded border border-transparent px-1 py-0.5 font-mono hover:border-[#cfd6de] focus:border-brand focus:outline-none"
                />
              </td>
              <td className="whitespace-nowrap p-0.5 text-right font-mono text-[#0e7490]">{fmt(values[v.name])}</td>
              <td className="p-0.5 text-right">
                <button type="button" title="Smazat" onClick={() => set(vars.filter((_, k) => k !== i))} className="rounded p-0.5 text-[#8a95a3] hover:text-brand">
                  <CadIcon name="trash" className="h-3.5 w-3.5" />
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <button
        type="button"
        onClick={() => {
          let k = vars.length + 1;
          while (vars.some((v) => v.name === `d${k}`)) k++;
          set([...vars, { name: `d${k}`, expr: "10" }]);
        }}
        className="mt-2 w-full rounded border border-dashed border-[#b9c3cd] py-1.5 text-[12px] text-[#26303b] hover:border-brand hover:text-brand"
      >
        + Přidat proměnnou
      </button>
      {errors.length > 0 && (
        <div className="mt-2 space-y-1">
          {errors.map((e, i) => (
            <p key={i} className="rounded bg-brand/10 px-2 py-1 text-[11px] text-brand-600">
              {e}
            </p>
          ))}
        </div>
      )}
      {bindings.length > 0 && (
        <div className="mt-4">
          <p className="px-1 pb-1 text-[10px] font-semibold uppercase tracking-wider text-[#8a95a3]">Vazby parametrů</p>
          {bindings.map(([k, expr]) => {
            const [fid, path] = k.split(":");
            const f = doc.features.find((x) => x.id === fid);
            return (
              <div key={k} className="flex items-center gap-2 border-t border-[#edf1f5] px-1 py-1">
                <span className="min-w-0 flex-1 truncate text-[#26303b]">
                  {f?.name ?? "?"} · <span className="text-[#6b7785]">{path}</span>
                </span>
                <code className="rounded bg-[#eef2f6] px-1 font-mono text-[11px] text-[#0e7490]">{expr}</code>
                <button
                  type="button"
                  title="Zrušit vazbu"
                  onClick={() => {
                    const b = { ...(doc.bindings ?? {}) };
                    delete b[k];
                    onCommit({ ...doc, bindings: b });
                  }}
                  className="text-[#8a95a3] hover:text-brand"
                >
                  <CadIcon name="x" className="h-3.5 w-3.5" />
                </button>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function Configs({ doc, values, onCommit }: { doc: CadDoc; values: Record<string, number>; onCommit: (d: CadDoc) => void }) {
  const configs = doc.configs ?? [];
  const [open, setOpen] = useState<string | null>(doc.activeConfig ?? null);
  const set = (next: Config[], active = doc.activeConfig) => onCommit({ ...doc, configs: next, activeConfig: active });
  const vars = doc.variables ?? [];
  return (
    <div className="min-h-0 flex-1 overflow-y-auto p-2 text-[12px]">
      <p className="px-1 pb-2 leading-relaxed text-[#6b7785]">Stavy (konfigurace) jsou varianty dílu: jiné hodnoty proměnných a potlačené prvky – např. „M8“, „M10“, „bez děr“.</p>
      <label className={cn("mb-1 flex cursor-pointer items-center gap-2 rounded px-2 py-1.5", !doc.activeConfig ? "bg-[#dbe7f5]" : "hover:bg-[#edf2f7]")}>
        <input type="radio" checked={!doc.activeConfig} onChange={() => onCommit({ ...doc, activeConfig: null })} className="accent-[#E03930]" />
        <span className="font-medium">Výchozí</span>
      </label>
      {configs.map((c) => (
        <div key={c.id} className="mb-1 rounded border border-[#e3e8ee]">
          <div className={cn("flex items-center gap-2 px-2 py-1.5", doc.activeConfig === c.id && "bg-[#dbe7f5]")}>
            <input type="radio" checked={doc.activeConfig === c.id} onChange={() => onCommit({ ...doc, activeConfig: c.id })} className="accent-[#E03930]" />
            <input
              defaultValue={c.name}
              onBlur={(e) => e.target.value.trim() && e.target.value !== c.name && set(configs.map((x) => (x.id === c.id ? { ...x, name: e.target.value.trim() } : x)))}
              className="min-w-0 flex-1 rounded border border-transparent bg-transparent px-1 font-medium hover:border-[#cfd6de] focus:border-brand focus:outline-none"
            />
            <button type="button" onClick={() => setOpen(open === c.id ? null : c.id)} className="text-[#6b7785] hover:text-[#1f2933]" title="Upravit">
              <CadIcon name={open === c.id ? "chevronDown" : "chevronRight"} className="h-3.5 w-3.5" />
            </button>
            <button type="button" onClick={() => set(configs.filter((x) => x.id !== c.id), doc.activeConfig === c.id ? null : doc.activeConfig)} className="text-[#8a95a3] hover:text-brand" title="Smazat stav">
              <CadIcon name="trash" className="h-3.5 w-3.5" />
            </button>
          </div>
          {open === c.id && (
            <div className="space-y-2 border-t border-[#e3e8ee] p-2">
              {vars.length === 0 && <p className="text-[11px] text-[#8a95a3]">Nejdřív založte proměnné (karta Proměnné).</p>}
              {vars.map((v) => (
                <label key={v.name} className="flex items-center gap-2">
                  <span className="w-20 truncate font-mono">{v.name}</span>
                  <input
                    defaultValue={c.values[v.name] ?? ""}
                    placeholder={fmt(values[v.name])}
                    onBlur={(e) => {
                      const n = Number(e.target.value.replace(",", "."));
                      const vals = { ...c.values };
                      if (e.target.value.trim() === "" || !Number.isFinite(n)) delete vals[v.name];
                      else vals[v.name] = n;
                      set(configs.map((x) => (x.id === c.id ? { ...x, values: vals } : x)));
                    }}
                    className="w-full rounded border border-[#cfd6de] px-1.5 py-0.5 font-mono focus:border-brand focus:outline-none"
                  />
                </label>
              ))}
              {doc.features.length > 0 && (
                <div>
                  <p className="pb-1 pt-1 text-[10px] font-semibold uppercase tracking-wider text-[#8a95a3]">Potlačené prvky</p>
                  <div className="max-h-40 space-y-0.5 overflow-y-auto">
                    {doc.features.map((f) => (
                      <label key={f.id} className="flex items-center gap-2 text-[11.5px]">
                        <input
                          type="checkbox"
                          className="accent-[#E03930]"
                          checked={c.suppressed.includes(f.id)}
                          onChange={(e) => set(configs.map((x) => (x.id === c.id ? { ...x, suppressed: e.target.checked ? [...x.suppressed, f.id] : x.suppressed.filter((s) => s !== f.id) } : x)))}
                        />
                        {f.name}
                      </label>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      ))}
      <button
        type="button"
        onClick={() => {
          const id = uid();
          const snapshot: Record<string, number> = {};
          for (const v of vars) if (Number.isFinite(values[v.name])) snapshot[v.name] = values[v.name];
          set([...configs, { id, name: `Stav ${configs.length + 1}`, values: snapshot, suppressed: [] }], id);
          setOpen(id);
        }}
        className="mt-2 w-full rounded border border-dashed border-[#b9c3cd] py-1.5 text-[12px] text-[#26303b] hover:border-brand hover:text-brand"
      >
        + Nový stav z aktuálních hodnot
      </button>
    </div>
  );
}
