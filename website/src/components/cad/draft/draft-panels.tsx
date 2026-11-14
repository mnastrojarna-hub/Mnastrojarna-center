"use client";

/**
 * Panely 2D výkresu: správce hladin (jako AutoCAD LAYER) a panel vlastností (společné vlastnosti výběru +
 * geometrie entity; bez výběru aktuální vlastnosti nových entit a nastavení výkresu). Výběr barvy ACI / pravé barvy.
 */
import { tr } from "@/cad/i18n";
import { useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { aciHex, colorLabel, displayHex, parseColor } from "@/cad/draft/colors";
import { kindOf, type KindCtx } from "@/cad/draft/kinds";
import { createLayer, deleteLayer, ensureLinetype, findLayer, layerUse, ltLabel, lwLabel, renameLayer, setCurrentLayer, setLayer } from "@/cad/draft/layers";
import { linetypeLibrary } from "@/cad/draft/linetypes";
import { entityById, LINEWEIGHTS, spaceEntities, type DraftColor, type DraftEntity, type DraftLw, type DraftModel, type DraftSpace } from "@/cad/draft/model";
import { makeFmt } from "@/cad/draft/commands";
import { DraftTx } from "@/cad/draft/tx";
import { parseUnits, UNITS } from "@/cad/draft/units";
import type { DraftUnits } from "@/cad/draft/model";
import { cn } from "@/lib/cn";
import { CadIcon } from "../cad-icons";

const field = "w-full min-w-0 rounded border border-[#cfd6de] bg-white px-1.5 py-0.5 text-[12px] outline-none focus:border-brand";
const cellSel = "w-[96px] rounded border border-[#cfd6de] bg-white px-1 py-0.5 text-[11.5px] outline-none focus:border-brand";

// ---------------------------------------------------------------- barva

const ACI_ROWS = Array.from({ length: 24 }, (_, h) => Array.from({ length: 10 }, (_, k) => 10 + h * 10 + k));
/** Výběr barvy: ByLayer / ByBlock, 9 základních, paleta ACI 10–249, šedé 250–255, pravá barva. */
export function ColorPicker({ value, onPick, allowBy = true, onClose, at }: { value: DraftColor | undefined; onPick: (c: DraftColor) => void; allowBy?: boolean; onClose: () => void; at: { x: number; y: number } }) {
  const [hex, setHex] = useState(typeof value === "string" && value.startsWith("#") ? value : "#ff8800");
  const sw = (i: number) => (
    <button key={i} type="button" title={`ACI ${i}`} data-aci={i} onClick={() => onPick(i)} className={cn("h-3.5 w-3.5 border border-black/10", value === i && "outline outline-2 outline-brand")} style={{ background: aciHex(i) }} />
  );
  // nabídka v portálu s pevnou polohou (panel s posuvníkem by ji jinak ořízl)
  const W = 290;
  const H = 300;
  const left = Math.max(4, Math.min(at.x - W + 20, (typeof window !== "undefined" ? window.innerWidth : 1200) - W - 4));
  const top = Math.max(4, Math.min(at.y + 6, (typeof window !== "undefined" ? window.innerHeight : 800) - H - 4));
  return createPortal(
    <>
      <div className="fixed inset-0 z-[80]" onClick={onClose} />
      <div className="fixed z-[81] w-[290px] rounded-md border border-[#cfd6de] bg-white p-2 text-[11.5px] shadow-2xl" style={{ left, top }} onClick={(e) => e.stopPropagation()} data-color-picker>
        {allowBy && (
          <div className="mb-1.5 flex gap-1">
            <button type="button" className="rounded border px-2 py-0.5 hover:bg-[#eef2f6]" onClick={() => onPick("ByLayer")}>
              {tr("DleHladiny")}
            </button>
            <button type="button" className="rounded border px-2 py-0.5 hover:bg-[#eef2f6]" onClick={() => onPick("ByBlock")}>
              {tr("DleBloku")}
            </button>
          </div>
        )}
        <div className="mb-1 flex gap-0.5">{[1, 2, 3, 4, 5, 6, 7, 8, 9].map(sw)}</div>
        <div className="grid grid-flow-col grid-rows-10 gap-0">{ACI_ROWS.flatMap((r) => r.map(sw))}</div>
        <div className="mt-1 flex gap-0.5">{[250, 251, 252, 253, 254, 255].map(sw)}</div>
        <div className="mt-2 flex items-center gap-1.5">
          <span className="text-[#6b7785]">{tr("Pravá barva")}</span>
          <input type="color" value={hex} onChange={(e) => setHex(e.target.value)} className="h-6 w-8" aria-label={tr("Pravá barva")} />
          <input value={hex} onChange={(e) => setHex(e.target.value)} className={cn(field, "w-24 font-mono")} />
          <button type="button" className="rounded bg-brand px-2 py-0.5 font-semibold text-white" onClick={() => { const c = parseColor(hex); if (c !== null) onPick(c); }}>
            OK
          </button>
        </div>
      </div>
    </>,
    document.body,
  );
}

function Swatch({ c, dark = false }: { c: number | string; dark?: boolean }) {
  return <span className="inline-block h-3 w-3 shrink-0 rounded-sm border border-black/25" style={{ background: displayHex(c, dark) === "#ffffff" ? "#ffffff" : displayHex(c, false) }} />;
}

function ColorField({ value, onChange, allowBy = true, model, layerColor }: { value: DraftColor | undefined | null; onChange: (c: DraftColor) => void; allowBy?: boolean; model: DraftModel; layerColor?: number | string }) {
  const [open, setOpen] = useState<{ x: number; y: number } | null>(null);
  void model;
  const shown = value === undefined ? "ByLayer" : value;
  return (
    <div className="relative">
      <button type="button" onClick={(e) => { const r = e.currentTarget.getBoundingClientRect(); setOpen(open ? null : { x: r.right, y: r.bottom }); }} className={cn(field, "flex items-center gap-1.5 text-left")} data-color-field>
        {shown === null ? <span className="text-[#6b7785]">*{tr("různé")}*</span> : <><Swatch c={typeof shown === "number" || (typeof shown === "string" && shown.startsWith("#")) ? shown : (layerColor ?? 7)} /> {colorLabel(shown)}</>}
      </button>
      {open && (
        <ColorPicker
          value={shown ?? undefined}
          allowBy={allowBy}
          at={open}
          onClose={() => setOpen(null)}
          onPick={(c) => {
            setOpen(null);
            onChange(c);
          }}
        />
      )}
    </div>
  );
}

const lwOptions = (withBy: boolean) => [...(withBy ? ["ByLayer", "ByBlock"] : []), "Default", ...LINEWEIGHTS.map(String)];
const lwValue = (v: string): DraftLw => (v === "ByLayer" || v === "ByBlock" || v === "Default" ? v : Number(v));

// ---------------------------------------------------------------- správce hladin

export function LayerPanel({ model, onCommit, onFlash }: { model: DraftModel; onCommit: (m: DraftModel) => void; onFlash: (m: string) => void }) {
  const [sel, setSel] = useState<string | null>(null);
  const [colorFor, setColorFor] = useState<{ name: string; x: number; y: number } | null>(null);
  const [edit, setEdit] = useState<{ name: string; value: string } | null>(null);
  const counts = useMemo(() => new Map(model.layers.map((l) => [l.name, layerUse(model, l.name)])), [model]);
  const lib = useMemo(() => linetypeLibrary(model.vars.measurement === 1), [model.vars.measurement]);
  const apply = (fn: (m: DraftModel) => DraftModel) => {
    try {
      onCommit(fn(model));
    } catch (e) {
      onFlash((e as Error).message);
    }
  };
  const fresh = () => {
    for (let i = 1; ; i++) if (!findLayer(model, tr("Hladina{0}", i))) return tr("Hladina{0}", i);
  };
  const tog = "grid h-6 w-6 place-items-center rounded hover:bg-[#e6ebf1]";
  return (
    <div className="flex h-full flex-col text-[12px]" data-layer-panel>
      <div className="flex flex-wrap gap-1 border-b border-[#e3e8ee] p-2">
        <button type="button" data-layer-new className="flex items-center gap-1 rounded bg-brand px-2 py-1 font-semibold text-white hover:bg-brand-600" onClick={() => { const n = fresh(); apply((m) => createLayer(m, n)); setSel(n); setEdit({ name: n, value: n }); }}>
          <CadIcon name="new" className="h-3.5 w-3.5" /> {tr("Nová")}
        </button>
        <button type="button" className="rounded border border-[#cfd6de] px-2 py-1 hover:bg-[#eef2f6] disabled:opacity-40" disabled={!sel} onClick={() => sel && apply((m) => setCurrentLayer(m, sel))}>
          {tr("Nastavit aktuální")}
        </button>
        <button type="button" className="rounded border border-[#cfd6de] px-2 py-1 hover:bg-[#eef2f6] disabled:opacity-40" disabled={!sel} onClick={() => sel && apply((m) => deleteLayer(m, sel, counts.get(sel) ? { moveTo: m.vars.clayer === sel ? "0" : m.vars.clayer } : {}))} title={tr("Smaže hladinu; entity se přesunou na aktuální hladinu")}>
          {tr("Smazat")}
        </button>
      </div>
      <div className="min-h-0 flex-1 overflow-auto">
        <table className="w-full border-collapse">
          <thead className="sticky top-0 bg-[#f3f6f9] text-[10.5px] uppercase tracking-wide text-[#6b7785]">
            <tr>
              <th className="w-5" />
              <th className="px-1 text-left">{tr("Název")}</th>
              <th title={tr("Zapnutá")}>{tr("Zap")}</th>
              <th title={tr("Zmrazená")}>{tr("Zmr")}</th>
              <th title={tr("Zamčená")}>{tr("Zam")}</th>
              <th className="px-1 text-left">{tr("Barva")}</th>
              <th className="px-1 text-left">{tr("Typ čáry")}</th>
              <th className="px-1 text-left">{tr("Tloušťka")}</th>
              <th title={tr("Tisknout")}>{tr("Tisk")}</th>
              <th className="px-1 text-right">#</th>
            </tr>
          </thead>
          <tbody>
            {model.layers.map((l) => {
              const cur = l.name === model.vars.clayer;
              return (
                <tr key={l.name} data-layer-row={l.name} onClick={() => setSel(l.name)} className={cn("border-b border-[#eef2f6]", sel === l.name ? "bg-brand/10" : "hover:bg-[#f6f8fa]")}>
                  <td className="text-center">
                    <button type="button" title={tr("Nastavit aktuální (dvojklik na název)")} className={cn("h-4 w-4 rounded-full border", cur ? "border-[#16a34a] bg-[#16a34a]" : "border-[#cfd6de]")} onClick={(e) => { e.stopPropagation(); apply((m) => setCurrentLayer(m, l.name)); }} data-layer-current={cur ? "1" : "0"} />
                  </td>
                  <td className="max-w-[140px] px-1" onDoubleClick={() => l.name !== "0" && setEdit({ name: l.name, value: l.name })}>
                    {edit?.name === l.name ? (
                      <input
                        autoFocus
                        value={edit.value}
                        onChange={(e) => setEdit({ ...edit, value: e.target.value })}
                        onBlur={() => { if (edit.value !== l.name) apply((m) => renameLayer(m, l.name, edit.value)); setEdit(null); }}
                        onKeyDown={(e) => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); if (e.key === "Escape") setEdit(null); e.stopPropagation(); }}
                        onFocus={(e) => e.target.select()}
                        className={field}
                        data-layer-name-input
                      />
                    ) : (
                      <span className={cn("block truncate", cur && "font-semibold")} title={l.desc ?? l.name}>
                        {l.name}
                      </span>
                    )}
                  </td>
                  <td className="text-center">
                    <button type="button" className={cn(tog, !l.on && "opacity-35")} title={l.on ? tr("Vypnout") : tr("Zapnout")} onClick={(e) => { e.stopPropagation(); apply((m) => setLayer(m, l.name, { on: !l.on })); }} data-layer-on={l.on ? "1" : "0"}>
                      <CadIcon name="eye" className="h-3.5 w-3.5" />
                    </button>
                  </td>
                  <td className="text-center">
                    <button type="button" className={cn(tog, "font-bold", l.frozen ? "text-[#2563eb]" : "text-[#d97706]")} title={l.frozen ? tr("Rozmrazit") : tr("Zmrazit")} onClick={(e) => { e.stopPropagation(); apply((m) => setLayer(m, l.name, { frozen: !l.frozen })); }} data-layer-frozen={l.frozen ? "1" : "0"}>
                      {l.frozen ? "✱" : "☼"}
                    </button>
                  </td>
                  <td className="text-center">
                    <button type="button" className={cn(tog, !l.locked && "opacity-35")} title={l.locked ? tr("Odemknout") : tr("Zamknout")} onClick={(e) => { e.stopPropagation(); apply((m) => setLayer(m, l.name, { locked: !l.locked })); }} data-layer-locked={l.locked ? "1" : "0"}>
                      <CadIcon name="lock" className="h-3.5 w-3.5" />
                    </button>
                  </td>
                  <td className="relative px-1">
                    <button type="button" className="flex items-center gap-1" onClick={(e) => { e.stopPropagation(); const r = e.currentTarget.getBoundingClientRect(); setColorFor(colorFor?.name === l.name ? null : { name: l.name, x: r.right, y: r.bottom }); }} data-layer-color={String(l.color)}>
                      <Swatch c={l.color} /> <span className="max-w-[54px] truncate">{typeof l.color === "number" ? l.color : l.color}</span>
                    </button>
                    {colorFor?.name === l.name && (
                      <ColorPicker value={l.color} allowBy={false} at={colorFor} onClose={() => setColorFor(null)} onPick={(c) => { setColorFor(null); apply((m) => setLayer(m, l.name, { color: c as number | string })); }} />
                    )}
                  </td>
                  <td className="px-1">
                    <select value={l.linetype} onClick={(e) => e.stopPropagation()} onChange={(e) => apply((m) => setLayer(m, l.name, { linetype: e.target.value }))} className={cellSel} data-layer-lt>
                      {model.linetypes.map((t) => (
                        <option key={t.name} value={t.name}>
                          {t.name}
                        </option>
                      ))}
                      <optgroup label={tr("Načíst z knihovny")}>
                        {lib.filter((t) => !model.linetypes.some((x) => x.name.toLowerCase() === t.name.toLowerCase())).map((t) => (
                          <option key={t.name} value={t.name}>
                            {t.name}
                          </option>
                        ))}
                      </optgroup>
                    </select>
                  </td>
                  <td className="px-1">
                    <select value={String(l.lineweight)} onClick={(e) => e.stopPropagation()} onChange={(e) => apply((m) => setLayer(m, l.name, { lineweight: lwValue(e.target.value) as number | "Default" }))} className={cellSel} data-layer-lw>
                      {lwOptions(false).map((o) => (
                        <option key={o} value={o}>
                          {o === "Default" ? tr("Výchozí") : `${Number(o).toFixed(2)} mm`}
                        </option>
                      ))}
                    </select>
                  </td>
                  <td className="text-center">
                    <button type="button" className={cn(tog, !l.plot && "opacity-35 line-through")} title={l.plot ? tr("Netisknout") : tr("Tisknout")} onClick={(e) => { e.stopPropagation(); apply((m) => setLayer(m, l.name, { plot: !l.plot })); }}>
                      P
                    </button>
                  </td>
                  <td className="px-1 text-right font-mono text-[11px] text-[#6b7785]">{counts.get(l.name) ?? 0}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {sel && findLayer(model, sel) && (
        <div className="border-t border-[#e3e8ee] p-2">
          <label className="text-[11px] text-[#6b7785]">{tr("Popis hladiny {0}", sel)}</label>
          <input key={sel} defaultValue={findLayer(model, sel)?.desc ?? ""} onBlur={(e) => { const v = e.target.value; if (v !== (findLayer(model, sel)?.desc ?? "")) apply((m) => setLayer(m, sel, { desc: v })); }} onKeyDown={(e) => e.stopPropagation()} className={field} />
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------- vlastnosti

export function PropsPanel({ model, ids, space = "model", onCommit, onFlash }: { model: DraftModel; ids: readonly string[]; space?: DraftSpace; onCommit: (m: DraftModel) => void; onFlash: (m: string) => void }) {
  const list = spaceEntities(model, space) ?? model.entities;
  const ents = useMemo(() => ids.map((id) => entityById(list, id)).filter((e): e is DraftEntity => !!e), [ids, list]);
  const kctx: KindCtx = { model };
  const fmt = makeFmt(model);
  const common = <T,>(get: (e: DraftEntity) => T): T | null => {
    if (!ents.length) return null;
    const v0 = get(ents[0]);
    return ents.every((e) => JSON.stringify(get(e)) === JSON.stringify(v0)) ? v0 : null;
  };
  const patchAll = (fn: (e: DraftEntity) => DraftEntity) => {
    try {
      const tx = new DraftTx(model, space);
      for (const e of ents) tx.update(e.id, fn);
      onCommit(tx.model);
    } catch (e) {
      onFlash((e as Error).message);
    }
  };
  const setProp = (k: "color" | "linetype" | "lineweight" | "ltscale", v: unknown) =>
    patchAll((e) => {
      const n = { ...e } as Record<string, unknown>;
      if (v === "ByLayer" || v === undefined || (k === "ltscale" && v === 1)) delete n[k];
      else n[k] = v;
      return n as unknown as DraftEntity;
    });
  const setVars = (p: Partial<DraftModel["vars"]>) => onCommit({ ...model, vars: { ...model.vars, ...p } });
  const row = (label: string, el: React.ReactNode, key?: string) => (
    <div key={key} className="grid grid-cols-[42%_58%] items-center gap-1 border-b border-[#eef2f6] px-2 py-1">
      <span className="truncate text-[#6b7785]">{label}</span>
      <div className="min-w-0">{el}</div>
    </div>
  );
  const ltSelect = (value: string | null, on: (v: string) => void, withBy: boolean) => (
    <select value={value ?? ""} onChange={(e) => on(e.target.value)} className={field} data-prop-lt>
      {value === null && <option value="">*{tr("různé")}*</option>}
      {withBy && <option value="ByLayer">{tr("DleHladiny")}</option>}
      {withBy && <option value="ByBlock">{tr("DleBloku")}</option>}
      {model.linetypes.map((t) => (
        <option key={t.name} value={t.name}>
          {t.name}
        </option>
      ))}
    </select>
  );
  const lwSelect = (value: string | null, on: (v: DraftLw) => void) => (
    <select value={value ?? ""} onChange={(e) => on(lwValue(e.target.value))} className={field} data-prop-lw>
      {value === null && <option value="">*{tr("různé")}*</option>}
      {lwOptions(true).map((o) => (
        <option key={o} value={o}>
          {o === "ByLayer" ? tr("DleHladiny") : o === "ByBlock" ? tr("DleBloku") : o === "Default" ? tr("Výchozí") : `${Number(o).toFixed(2)} mm`}
        </option>
      ))}
    </select>
  );

  if (!ents.length) {
    // bez výběru: aktuální vlastnosti nových entit a nastavení výkresu
    const v = model.vars;
    return (
      <div className="text-[12px]" data-props-panel="none">
        <p className="border-b border-[#e3e8ee] bg-[#f6f8fa] px-2 py-1.5 font-semibold">{tr("Žádný výběr – vlastnosti nových entit")}</p>
        {row(tr("Hladina"), (
          <select value={v.clayer} onChange={(e) => { try { onCommit(setCurrentLayer(model, e.target.value)); } catch (er) { onFlash((er as Error).message); } }} className={field} data-prop-clayer>
            {model.layers.map((l) => (
              <option key={l.name} value={l.name} disabled={l.frozen}>
                {l.name}
              </option>
            ))}
          </select>
        ))}
        {row(tr("Barva"), <ColorField value={v.cecolor} onChange={(c) => setVars({ cecolor: c })} model={model} />)}
        {row(tr("Typ čáry"), ltSelect(v.celtype, (x) => { try { const [m2, n] = ensureLinetype(model, x); onCommit({ ...m2, vars: { ...m2.vars, celtype: n } }); } catch (er) { onFlash((er as Error).message); } }, true))}
        {row(tr("Tloušťka"), lwSelect(String(v.celweight), (x) => setVars({ celweight: x })))}
        {row(tr("Měřítko typu čáry"), <NumInput value={v.celtscale} onCommit={(x) => x > 0 && setVars({ celtscale: x })} />)}
        <p className="border-b border-[#e3e8ee] bg-[#f6f8fa] px-2 py-1.5 font-semibold">{tr("Výkres")}</p>
        {row(tr("Jednotky"), (
          <select value={v.units} onChange={(e) => { const u = parseUnits(e.target.value) as DraftUnits; if (u) setVars({ units: u }); }} className={field} data-prop-units>
            {Object.entries(UNITS).map(([k, u]) => (
              <option key={k} value={k}>
                {u.label === "—" ? tr("bez jednotek") : u.label}
              </option>
            ))}
          </select>
        ))}
        {row(tr("Přesnost délek"), (
          <select value={v.prec} onChange={(e) => setVars({ prec: Number(e.target.value) })} className={field}>
            {[0, 1, 2, 3, 4, 5, 6, 7, 8].map((p) => (
              <option key={p} value={p}>
                {(0).toFixed(p)}
              </option>
            ))}
          </select>
        ))}
        {row("LTSCALE", <NumInput value={v.ltscale} onCommit={(x) => x > 0 && setVars({ ltscale: x })} />)}
        {row(tr("Výška textu"), <NumInput value={v.textsize} onCommit={(x) => x > 0 && setVars({ textsize: x })} />)}
      </div>
    );
  }

  const types = [...new Set(ents.map((e) => e.type))];
  const single = ents.length === 1 ? ents[0] : null;
  const k = single ? kindOf(single) : null;
  const layer = common((e) => e.layer);
  const color = common((e) => e.color ?? "ByLayer");
  const lt = common((e) => e.linetype ?? "ByLayer");
  const lw = common((e) => String(e.lineweight ?? "ByLayer"));
  const lts = common((e) => e.ltscale ?? 1);
  return (
    <div className="text-[12px]" data-props-panel={ents.length}>
      <p className="border-b border-[#e3e8ee] bg-[#f6f8fa] px-2 py-1.5 font-semibold">
        {types.length === 1 ? `${kindOf(types[0])?.label() ?? types[0]}${ents.length > 1 ? ` (${ents.length})` : ` ${single!.id}`}` : tr("Vše ({0})", ents.length)}
      </p>
      {row(tr("Hladina"), (
        <select value={layer ?? ""} onChange={(e) => patchAll((x) => ({ ...x, layer: e.target.value }))} className={field} data-prop-layer>
          {layer === null && <option value="">*{tr("různé")}*</option>}
          {model.layers.map((l) => (
            <option key={l.name} value={l.name}>
              {l.name}
            </option>
          ))}
        </select>
      ))}
      {row(tr("Barva"), <ColorField value={color} onChange={(c) => setProp("color", c)} model={model} layerColor={layer ? findLayer(model, layer)?.color : undefined} />)}
      {row(tr("Typ čáry"), ltSelect(lt, (x) => setProp("linetype", x === "ByLayer" ? undefined : x), true))}
      {row(tr("Tloušťka"), lwSelect(lw, (x) => setProp("lineweight", x)))}
      {row(tr("Měřítko typu čáry"), <NumInput value={lts} onCommit={(x) => x > 0 && setProp("ltscale", x)} />)}
      {single && k && (
        <>
          <p className="border-b border-[#e3e8ee] bg-[#f6f8fa] px-2 py-1.5 font-semibold">{tr("Geometrie")}</p>
          {k.fields(single, kctx, fmt).map((f) =>
            row(
              f.label,
              f.readonly ? (
                <span className="font-mono text-[11.5px]">{String(f.value)}</span>
              ) : f.kind === "bool" ? (
                <input type="checkbox" checked={!!f.value && f.value !== "0"} onChange={(e) => patchAll((x) => kindOf(x)!.setField(x, f.key, e.target.checked ? "1" : "0", kctx))} />
              ) : (
                <TextInput key={`${single.id}:${f.key}:${f.value}`} value={String(f.value).replace(/°$/, "")} mono={f.kind !== "text"} data-field={f.key} onCommit={(raw) => patchAll((x) => kindOf(x)!.setField(x, f.key, raw, kctx))} />
              ),
              f.key,
            ),
          )}
          {(() => {
            const m = k.measure?.(single, kctx);
            return m ? (
              <>
                {m.length !== undefined && row(m.closed ? tr("Obvod") : tr("Délka"), <span className="font-mono text-[11.5px]">{fmt.len(m.length)}</span>)}
                {m.area !== undefined && row(tr("Plocha"), <span className="font-mono text-[11.5px]">{fmt.len(m.area)}</span>)}
              </>
            ) : null;
          })()}
        </>
      )}
      <p className="px-2 py-1.5 text-[11px] text-[#6b7785]">{tr("Text: 2d vlastnosti {0} barva 1 · 2d nastavit {1} …", ids.slice(0, 3).join(" "), ids[0])}</p>
      <span className="hidden">{ltLabel(undefined)}{lwLabel(undefined)}</span>
    </div>
  );
}

function NumInput({ value, onCommit }: { value: number | null; onCommit: (v: number) => void }) {
  return <TextInput key={String(value)} value={value === null ? "" : String(value)} mono onCommit={(raw) => { const v = Number(raw.replace(",", ".")); if (Number.isFinite(v)) onCommit(v); }} />;
}

function TextInput({ value, onCommit, mono, ...rest }: { value: string; onCommit: (v: string) => void; mono?: boolean; "data-field"?: string }) {
  const [v, setV] = useState(value);
  return (
    <input
      value={v}
      onChange={(e) => setV(e.target.value)}
      onBlur={() => v !== value && onCommit(v)}
      onKeyDown={(e) => {
        e.stopPropagation();
        if (e.key === "Enter") (e.target as HTMLInputElement).blur();
        if (e.key === "Escape") setV(value);
      }}
      className={cn(field, mono && "font-mono")}
      {...rest}
    />
  );
}
