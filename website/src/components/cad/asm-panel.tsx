"use client";

import { useState } from "react";
import { defaultMoldBase, type BomRow, type CompPattern, type MoldBaseParams } from "@/cad/assembly";
import { MATE_LABEL, type MateStatus } from "@/cad/mates";
import type { AsmComponent, CadDoc, Mate, PlaneName, Vec3 } from "@/cad/types";
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
  mateStatus,
  onResolve,
}: {
  doc: CadDoc;
  selected: string | null;
  onSelect: (id: string | null) => void;
  onCommit: (d: CadDoc) => void;
  onContext: (x: number, y: number, entries: RMenuEntry[]) => void;
  menuFor: (c: AsmComponent) => RMenuEntry[];
  /** stav trvalých vazeb (z řešiče) */
  mateStatus?: Record<string, MateStatus>;
  /** přepočítat vazby */
  onResolve?: () => void;
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
              <div key={c.id}>
              <div
                onClick={() => onSelect(c.id === selected ? null : c.id)}
                onContextMenu={(e) => {
                  e.preventDefault();
                  onSelect(c.id);
                  onContext(e.clientX, e.clientY, menuFor(c));
                }}
                className={cn("group ml-3 flex cursor-default items-center gap-2 rounded px-2 py-[3px]", c.id === selected ? "bg-[#dbe7f5]" : "hover:bg-[#edf2f7]", c.hidden && "opacity-45")}
              >
                {c.source.kind === "asm" ? (
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      setClosed((x) => ({ ...x, [c.id]: !x[c.id] }));
                    }}
                    className="text-[#6b7785]"
                    title="Rozbalit podsestavu"
                  >
                    <CadIcon name={closed[c.id] ? "chevronRight" : "chevronDown"} className="h-3 w-3" />
                  </button>
                ) : null}
                {c.source.kind === "asm" ? <CadIcon name="layers" tone="create" className="h-3.5 w-3.5 shrink-0" /> : <span className="h-3 w-3 shrink-0 rounded-sm border border-black/20" style={{ background: c.color ?? "#b9c2cc" }} />}
                <span className="min-w-0 flex-1 truncate">{c.name}</span>
                {c.source.kind === "asm" && <span className="font-mono text-[10px] text-[#8a95a3]">{c.source.doc.components?.length ?? 0}</span>}
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
              {c.source.kind === "asm" && !closed[c.id] && <SubTree comps={c.source.doc.components ?? []} depth={1} />}
              </div>
            ))}
        </div>
      ))}
      <MatesList doc={doc} status={mateStatus} onCommit={onCommit} onResolve={onResolve} onSelect={onSelect} />
    </div>
  );
}

const STATUS_DOT: Record<MateStatus, string> = { ok: "bg-emerald-500", conflict: "bg-brand", missing: "bg-[#9aa5b1]", suppressed: "bg-[#d5dbe2]" };
const STATUS_TITLE: Record<MateStatus, string> = { ok: "splněno", conflict: "konflikt – vazbu nelze splnit spolu s ostatními", missing: "plocha nenalezena / díl se ještě staví", suppressed: "potlačeno" };

/** Seznam trvalých vazeb sestavy (pod stromem komponent). */
function MatesList({ doc, status, onCommit, onResolve, onSelect }: { doc: CadDoc; status?: Record<string, MateStatus>; onCommit: (d: CadDoc) => void; onResolve?: () => void; onSelect: (id: string | null) => void }) {
  const mates = doc.mates ?? [];
  const [closed, setClosed] = useState(false);
  const name = (id: string) => doc.components?.find((c) => c.id === id)?.name ?? "?";
  const setMates = (next: Mate[]) => onCommit({ ...doc, mates: next });
  if (!mates.length) return null;
  const conflicts = mates.filter((m) => status?.[m.id] === "conflict").length;
  return (
    <div className="ml-3 mt-1 border-l border-dashed border-[#cdd5de] pl-1">
      <button type="button" onClick={() => setClosed((v) => !v)} className="flex w-full items-center gap-1.5 px-1.5 py-[3px] text-left text-[11.5px] font-semibold text-[#4a5664]">
        <CadIcon name={closed ? "chevronRight" : "chevronDown"} className="h-3 w-3" />
        Vazby
        {conflicts > 0 && <span className="rounded bg-brand/10 px-1 text-[10px] text-brand-600">{conflicts} konflikt</span>}
        <span className="ml-auto pr-2 font-mono text-[10px] font-normal text-[#8a95a3]">{mates.length}</span>
      </button>
      {!closed &&
        mates.map((m) => {
          const st = status?.[m.id] ?? (m.suppressed ? "suppressed" : "missing");
          return (
            <div key={m.id} className={cn("group ml-3 flex items-center gap-2 rounded px-2 py-[3px] text-[12px]", m.suppressed && "opacity-45")} onClick={() => onSelect(m.a.compId)} title={STATUS_TITLE[st]}>
              <span className={cn("h-2 w-2 shrink-0 rounded-full", STATUS_DOT[st])} />
              <span className="min-w-0 flex-1 truncate">
                <span className="font-medium">{m.name ?? MATE_LABEL[m.type]}</span>
                {m.center && <span className="text-[#8a95a3]"> (střed)</span>}
                {(m.type === "distance" || m.type === "angle") && <span className="font-mono text-[#5b6776]"> {m.value ?? 0}{m.type === "angle" ? "°" : " mm"}</span>}
                <span className="block truncate text-[10.5px] text-[#8a95a3]">
                  {name(m.a.compId)} → {name(m.b.compId)}
                </span>
              </span>
              {m.type !== "fixed" && (
                <button type="button" title="Otočit (flip)" onClick={(e) => { e.stopPropagation(); setMates(mates.map((x) => (x.id === m.id ? { ...x, flip: !x.flip } : x))); }} className="hidden text-[#6b7785] hover:text-[#1f2933] group-hover:block">
                  <CadIcon name="mirror" className="h-3.5 w-3.5" />
                </button>
              )}
              <button type="button" title={m.suppressed ? "Zapnout" : "Potlačit"} onClick={(e) => { e.stopPropagation(); setMates(mates.map((x) => (x.id === m.id ? { ...x, suppressed: !x.suppressed } : x))); }} className="hidden text-[#6b7785] hover:text-[#1f2933] group-hover:block">
                <CadIcon name="eye" className="h-3.5 w-3.5" />
              </button>
              <button type="button" title="Smazat vazbu" onClick={(e) => { e.stopPropagation(); setMates(mates.filter((x) => x.id !== m.id)); }} className="hidden text-[#6b7785] hover:text-brand group-hover:block">
                <CadIcon name="trash" className="h-3.5 w-3.5" />
              </button>
            </div>
          );
        })}
      {!closed && onResolve && (
        <button type="button" onClick={onResolve} className="ml-3 mt-1 rounded border border-[#cfd6de] px-2 py-0.5 text-[11px] hover:bg-[#f3f6f9]">
          Přepočítat vazby
        </button>
      )}
    </div>
  );
}

/** Vnořené komponenty podsestavy (jen pro čtení – úpravy přes „Otevřít podsestavu“). */
function SubTree({ comps, depth }: { comps: AsmComponent[]; depth: number }) {
  return (
    <div className="ml-4 border-l border-dotted border-[#cdd5de]">
      {comps.map((c) => (
        <div key={c.id}>
          <div className={cn("flex items-center gap-2 px-2 py-[2px] text-[12px] text-[#4a5664]", c.hidden && "opacity-45")} style={{ paddingLeft: 8 + depth * 2 }}>
            {c.source.kind === "asm" ? <CadIcon name="layers" tone="create" className="h-3.5 w-3.5 shrink-0" /> : <span className="h-2.5 w-2.5 shrink-0 rounded-sm border border-black/20" style={{ background: c.color ?? "#b9c2cc" }} />}
            <span className="min-w-0 flex-1 truncate">{c.name}</span>
          </div>
          {c.source.kind === "asm" && <SubTree comps={c.source.doc.components ?? []} depth={depth + 1} />}
        </div>
      ))}
    </div>
  );
}

export type MateMode = "mate" | "flush" | "center" | "concentric" | "distance" | "angle" | "parallel";

/** Vlastnosti komponenty (pravý panel). */
export function AsmProps({
  c,
  onChange,
  onMate,
  mating,
  mateValue = 0,
  onMateValue,
  onPattern,
  onMirror,
  onBolt,
  bolting,
}: {
  c: AsmComponent;
  onChange: (p: Partial<AsmComponent>) => void;
  onMate: (mode: MateMode) => void;
  mating: boolean | MateMode;
  mateValue?: number;
  onMateValue?: (v: number) => void;
  onPattern?: (p: CompPattern) => void;
  onMirror?: (plane: PlaneName, offset: number) => void;
  onBolt?: (opts: { washer: boolean; nut: boolean }) => void;
  bolting?: boolean;
}) {
  const [pat, setPat] = useState<CompPattern>({ kind: "linear", count: 3, spacing: 50, direction: [1, 0, 0] });
  const [mirrorPlane, setMirrorPlane] = useState<PlaneName>("YZ");
  const [mirrorOffset, setMirrorOffset] = useState(0);
  const [bolt, setBolt] = useState({ washer: true, nut: false });
  const activeMode = typeof mating === "string" ? mating : null;
  const mateBtn = (mode: MateMode, label: string, title: string) => (
    <button type="button" onClick={() => onMate(mode)} className={cn("rounded border py-1.5 text-[11.5px]", activeMode === mode || (mating === true && mode === "mate") ? "border-brand bg-brand/10" : "border-[#cfd6de] hover:bg-[#f3f6f9]")} title={title}>
      {label}
    </button>
  );
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
        <p className="mb-1 text-[11px] font-medium uppercase tracking-wider text-ink-700/55">Vazby (trvalé – uloží se do sestavy)</p>
        <div className="grid grid-cols-3 gap-1.5">
          {mateBtn("mate", "Kontakt", "Rovinné plochy proti sobě, v jedné rovině")}
          {mateBtn("flush", "Zarovnat", "Rovinné plochy souhlasně v jedné rovině")}
          {mateBtn("center", "Vystředit", "Kontakt + ztotožnění středů ploch")}
          {mateBtn("concentric", "Souosost", "Osy válcových ploch (čep v díře, šroub v díře)")}
          {mateBtn("distance", "Vzdálenost", "Rovinné plochy rovnoběžně v zadané vzdálenosti")}
          {mateBtn("angle", "Úhel", "Rovinné plochy pod zadaným úhlem")}
          {mateBtn("parallel", "Rovnoběžně", "Jen natočení – normály rovnoběžně")}
        </div>
        {(activeMode === "distance" || activeMode === "angle") && onMateValue && (
          <div className="mt-2">
            <Num label={activeMode === "distance" ? "Vzdálenost" : "Úhel"} value={mateValue} step={activeMode === "angle" ? 5 : 1} suffix={activeMode === "angle" ? "°" : "mm"} onChange={onMateValue} />
          </div>
        )}
        <p className="mt-1.5 text-[11px] leading-relaxed text-[#6b7785]">{activeMode ? "Klikněte na plochu této komponenty a pak na plochu jiné komponenty. Vazba se uloží a přepočítá při každém pohybu." : "Vyberte typ vazby, pak klikněte na plochu této komponenty a na plochu cílové komponenty."}</p>
      </div>
      {onPattern && (
        <div>
          <p className="mb-1 text-[11px] font-medium uppercase tracking-wider text-ink-700/55">Pole komponenty</p>
          <div className="mb-1.5 flex rounded-md bg-[#eef2f6] p-0.5">
            {(["linear", "circular"] as const).map((k) => (
              <button key={k} type="button" onClick={() => setPat(k === "linear" ? { kind: "linear", count: 3, spacing: 50, direction: [1, 0, 0] } : { kind: "circular", count: 6, angle: 360, axis: "Z", center: [0, 0, 0] })} className={cn("flex-1 rounded px-2 py-0.5 text-[11.5px]", pat.kind === k ? "bg-white shadow-sm" : "text-[#5b6776]")}>
                {k === "linear" ? "Lineární" : "Kruhové"}
              </button>
            ))}
          </div>
          {pat.kind === "linear" ? (
            <div className="space-y-2">
              <div className="grid grid-cols-2 gap-2">
                <Num label="Počet" value={pat.count} step={1} min={1} suffix="" onChange={(v) => setPat({ ...pat, count: Math.round(v) })} />
                <Num label="Rozteč" value={pat.spacing} onChange={(v) => setPat({ ...pat, spacing: v })} />
              </div>
              <Vec label="Směr" value={pat.direction} onChange={(v: Vec3) => setPat({ ...pat, direction: v })} />
            </div>
          ) : (
            <div className="space-y-2">
              <div className="grid grid-cols-3 gap-2">
                <Num label="Počet" value={pat.count} step={1} min={1} suffix="" onChange={(v) => setPat({ ...pat, count: Math.round(v) })} />
                <Num label="Úhel" value={pat.angle} suffix="°" onChange={(v) => setPat({ ...pat, angle: v })} />
                <div>
                  <p className="mb-1 text-[11px] font-medium uppercase tracking-wider text-ink-700/55">Osa</p>
                  <div className="flex rounded-md bg-[#eef2f6] p-0.5">
                    {(["X", "Y", "Z"] as const).map((a) => (
                      <button key={a} type="button" onClick={() => setPat({ ...pat, axis: a })} className={cn("flex-1 rounded py-0.5 text-[11.5px]", pat.axis === a ? "bg-white shadow-sm" : "text-[#5b6776]")}>
                        {a}
                      </button>
                    ))}
                  </div>
                </div>
              </div>
              <Vec label="Střed osy" value={pat.center} onChange={(v: Vec3) => setPat({ ...pat, center: v })} />
            </div>
          )}
          <button type="button" onClick={() => onPattern(pat)} className="mt-2 w-full rounded border border-[#cfd6de] py-1.5 text-[12px] hover:bg-[#f3f6f9]">
            Vytvořit pole ({pat.count}×)
          </button>
        </div>
      )}
      {onMirror && (
        <div>
          <p className="mb-1 text-[11px] font-medium uppercase tracking-wider text-ink-700/55">Zrcadlení komponenty</p>
          <div className="grid grid-cols-[1fr_1fr] gap-2">
            <div className="flex rounded-md bg-[#eef2f6] p-0.5">
              {(["XY", "XZ", "YZ"] as PlaneName[]).map((pl) => (
                <button key={pl} type="button" onClick={() => setMirrorPlane(pl)} className={cn("flex-1 rounded py-1 text-[11.5px]", mirrorPlane === pl ? "bg-white shadow-sm" : "text-[#5b6776]")}>
                  {pl}
                </button>
              ))}
            </div>
            <Num label="Odsazení roviny" value={mirrorOffset} onChange={setMirrorOffset} />
          </div>
          <button type="button" onClick={() => onMirror(mirrorPlane, mirrorOffset)} className="mt-2 w-full rounded border border-[#cfd6de] py-1.5 text-[12px] hover:bg-[#f3f6f9]">
            Zrcadlit komponentu
          </button>
          <p className="mt-1 text-[10.5px] leading-snug text-[#8a95a3]">Zrcadlí se poloha a natočení; geometrie dílu zůstává (přesné pro symetrické díly).</p>
        </div>
      )}
      {onBolt && (
        <div>
          <p className="mb-1 text-[11px] font-medium uppercase tracking-wider text-ink-700/55">Šroubový spoj do díry</p>
          <div className="flex gap-3 text-[12px]">
            <label className="flex items-center gap-1.5">
              <input type="checkbox" className="accent-[#E03930]" checked={bolt.washer} onChange={(e) => setBolt({ ...bolt, washer: e.target.checked })} /> Podložka
            </label>
            <label className="flex items-center gap-1.5">
              <input type="checkbox" className="accent-[#E03930]" checked={bolt.nut} onChange={(e) => setBolt({ ...bolt, nut: e.target.checked })} /> Matice
            </label>
          </div>
          <button type="button" onClick={() => onBolt(bolt)} className={cn("mt-2 w-full rounded border py-1.5 text-[12px]", bolting ? "border-brand bg-brand/10 text-brand" : "border-[#cfd6de] hover:bg-[#f3f6f9]")}>
            {bolting ? "Klikněte na válcovou plochu díry…" : "Vložit šroub ISO 4762 do díry…"}
          </button>
          <p className="mt-1 text-[10.5px] leading-snug text-[#8a95a3]">Závit podle průměru díry (ISO 273), délka podle sevřené tloušťky; hlava na straně kliknutí. Přidá se vazba Souosost.</p>
        </div>
      )}
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
