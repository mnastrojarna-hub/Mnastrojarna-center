"use client";

/**
 * Pokročilé a mechanické vazby v panelu komponenty: tlačítka druhů (Kolmo, Tečně, Shodně, Symetricky, Šířka, Dráha, Drážka, Závěs,
 * Zámek, Mez vzdálenosti / úhlu; Ozubení, Hřeben, Šroub, Vačka, Kardan) a průvodce zadáním – entity (plochy, hrany, vrcholy)
 * postupně podle cad/mate-spec.ts ze seznamů nebo kliknutím na plochu v modelu, pak hodnoty (poměr, stoupání, meze) a potvrzení.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { fmt } from "@/cad/agent-asm";
import { cad } from "@/cad/client";
import { tr } from "@/cad/i18n";
import { ADVANCED, KIN_SPEC, MECHANICAL, accepts, entKindOf, isKinMode, kinDefaults, nextSlot, pendingReady, skipSlot, slotCompOk, slotWants, type EntKind, type SlotSpec } from "@/cad/mate-spec";
import { MATE_LABEL, dirLabel, faceAreas, worldGeo, type FaceGeo, type KinMateType, type PartFace, type PendingMate } from "@/cad/mates";
import type { AsmComponent, CadDoc, ComponentSource, MateRef, Vec3 } from "@/cad/types";
import { cn } from "@/lib/cn";
import { flattenLeaves, matrixToPlacement } from "./asm-flatten";
import { CadIcon } from "./cad-icons";
import { Num } from "./props";
import type { SelItem } from "./selection";

/* ───────────────────────── tlačítka druhů vazeb ───────────────────────── */

/** Skupiny tlačítek pokročilých a mechanických vazeb (pod základními vazbami v panelu komponenty). */
export function KinMateButtons({ active, onMate }: { active: PendingMate["mode"] | null; onMate: (mode: KinMateType) => void }) {
  const [open, setOpen] = useState<Record<string, boolean>>({ advanced: !!active && ADVANCED.includes(active as KinMateType), mechanical: !!active && MECHANICAL.includes(active as KinMateType) });
  const group = (key: "advanced" | "mechanical", title: string, list: KinMateType[]) => (
    <div data-mate-group={key}>
      <button type="button" onClick={() => setOpen((o) => ({ ...o, [key]: !o[key] }))} className="mt-1.5 flex w-full items-center gap-1 text-left text-[10.5px] font-semibold uppercase tracking-wider text-[#4a5664]">
        <CadIcon name={open[key] ? "chevronDown" : "chevronRight"} className="h-3 w-3" />
        {title}
        <span className="ml-auto font-mono text-[10px] font-normal text-[#8a95a3]">{list.length}</span>
      </button>
      {open[key] && (
        <div className="mt-1 grid grid-cols-3 gap-1.5">
          {list.map((t) => (
            <button key={t} type="button" data-mate-mode={t} onClick={() => onMate(t)} title={tr(KIN_SPEC[t].hint)} className={cn("rounded border px-1 py-1.5 text-[11px] leading-tight", active === t ? "border-brand bg-brand/10" : "border-[#cfd6de] hover:bg-[#f3f6f9]")}>
              {tr(MATE_LABEL[t])}
            </button>
          ))}
        </div>
      )}
    </div>
  );
  return (
    <>
      {group("advanced", tr("Pokročilé vazby"), ADVANCED)}
      {group("mechanical", tr("Mechanické vazby"), MECHANICAL)}
    </>
  );
}

/* ───────────────────────── entity komponent (plochy, hrany, vrcholy) ───────────────────────── */

type PartEnts = { faces: { i: number; info: PartFace; area?: number }[]; edges: { i: number; info: PartFace }[]; vertices: Vec3[]; truncated: boolean };
const LIMIT = 400;
const cache = new Map<string, Promise<PartEnts>>();

/** Plochy (všech druhů), hrany a vrcholy dílu v jeho souřadnicích – z jádra, s mezipamětí podle otisku dílu. */
function loadPartEnts(key: string, source: ComponentSource): Promise<PartEnts> {
  const hit = cache.get(key);
  if (hit) return hit;
  const p = (async (): Promise<PartEnts> => {
    const res = (await cad.asmParts([{ key, source }]))[0]?.result;
    const nf = Math.min(res?.metrics?.faces ?? 0, LIMIT);
    const ne = Math.min(res?.metrics?.edges ?? 0, LIMIT);
    const areas = res?.mesh ? faceAreas(res.mesh) : [];
    const faces: PartEnts["faces"] = [];
    const edges: PartEnts["edges"] = [];
    for (let s = 0; s < nf; s += 25) {
      const idx = Array.from({ length: Math.min(25, nf - s) }, (_, k) => s + k);
      const infos = await Promise.all(idx.map((i) => cad.mateFace(key, i).catch(() => null)));
      infos.forEach((f, k) => f && faces.push({ i: idx[k], info: f, area: areas[idx[k]] }));
    }
    for (let s = 0; s < ne; s += 25) {
      const idx = Array.from({ length: Math.min(25, ne - s) }, (_, k) => s + k);
      const infos = await Promise.all(idx.map((i) => cad.mateEnt(key, i, "edge").catch(() => null)));
      infos.forEach((f, k) => f && edges.push({ i: idx[k], info: f }));
    }
    const v = res?.vertices ?? new Float32Array();
    const vertices: Vec3[] = [];
    for (let i = 0; i * 3 + 2 < v.length && i < LIMIT; i++) vertices.push([v[i * 3], v[i * 3 + 1], v[i * 3 + 2]]);
    return { faces, edges, vertices, truncated: (res?.metrics?.faces ?? 0) > nf || (res?.metrics?.edges ?? 0) > ne };
  })();
  cache.set(key, p);
  p.catch(() => cache.delete(key));
  if (cache.size > 40) cache.delete(cache.keys().next().value as string);
  return p;
}

/** Řádek seznamu entit ve světových souřadnicích sestavy. */
type EntRowUi = { leafId: string; part?: string; index: number; ent?: "edge" | "vertex"; kind: EntKind; g: FaceGeo; size: number };

function useCompEnts(doc: CadDoc, compId: string | null): { rows: EntRowUi[]; loading: boolean; truncated: boolean } {
  const leaves = useMemo(() => (compId ? flattenLeaves(doc).filter((l) => l.topId === compId) : []), [doc, compId]);
  const sig = leaves.map((l) => l.key).join("|");
  const [loaded, setLoaded] = useState<{ sig: string; parts: Record<string, PartEnts> }>({ sig: "", parts: {} });
  useEffect(() => {
    if (!leaves.length) return;
    let dead = false;
    Promise.all(leaves.map((l) => loadPartEnts(l.key, l.comp.source).then((p) => [l.key, p] as const, () => [l.key, { faces: [], edges: [], vertices: [], truncated: false }] as const))).then((all) => {
      if (!dead) setLoaded({ sig, parts: Object.fromEntries(all) });
    });
    return () => {
      dead = true;
    };
    // plochy dílů závisí jen na jejich obsahu (klíčích v `sig`), ne na poloze komponent
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sig]);
  const rows = useMemo(() => {
    const out: EntRowUi[] = [];
    if (loaded.sig !== sig) return out;
    for (const l of leaves) {
      const pl = matrixToPlacement(l.matrix);
      const part = l.id !== l.topId ? l.path.slice(1).join(" › ") : undefined;
      const p = loaded.parts[l.key];
      if (!p) continue;
      for (const f of p.faces) out.push({ leafId: l.id, part, index: f.i, kind: entKindOf(f.info), g: worldGeo(pl, f.info), size: f.area ?? 0 });
      for (const e of p.edges) out.push({ leafId: l.id, part, index: e.i, ent: "edge", kind: entKindOf(e.info), g: worldGeo(pl, e.info), size: (e.info as { length?: number }).length ?? 0 });
      p.vertices.forEach((v, i) => out.push({ leafId: l.id, part, index: i, ent: "vertex", kind: "vertex", g: worldGeo(pl, { kind: "point", origin: v, normal: [0, 0, 1] }), size: 0 }));
    }
    return out;
  }, [leaves, loaded, sig]);
  return { rows, loading: !!leaves.length && loaded.sig !== sig, truncated: leaves.some((l) => loaded.parts[l.key]?.truncated) };
}

const KIND_TEXT: Record<EntKind, string> = { plane: "rovinná", cylinder: "válcová", sphere: "kulová", face: "obecná plocha", line: "úsečka", circle: "kružnice", curve: "křivka", edge: "hrana", vertex: "vrchol" };
const f2 = (v: number) => fmt(v, 2);
const ptText = (p: Vec3) => p.map(f2).join("; ");
/** popis entity: „Plocha 3 · válcová Ø10 · osa Z“ / „Hrana 5 · kružnice Ø40“ / „Vrchol 2“ */
function entLabel(r: EntRowUi): { title: string; detail: string } {
  const no = r.ent === "edge" ? tr("Hrana {0}", r.index + 1) : r.ent === "vertex" ? tr("Vrchol {0}", r.index + 1) : tr("Plocha {0}", r.index + 1);
  const d = r.g.radius ? ` Ø${f2(2 * r.g.radius)}` : "";
  const dir = r.kind === "plane" ? ` · ${tr("normála {0}", dirLabel(r.g.normal))}` : r.kind === "cylinder" || r.kind === "line" || r.kind === "circle" ? ` · ${tr("osa {0}", dirLabel(r.g.normal))}` : "";
  return { title: `${r.part ? `${r.part} › ` : ""}${no} · ${tr(KIND_TEXT[r.kind])}${d}${dir}`, detail: `${r.kind === "line" ? tr("začátek {0}", ptText(r.g.origin)) : tr("střed {0}", ptText(r.g.origin))}${r.size && !r.ent ? ` · ${f2(r.size)} mm²` : r.size && r.ent === "edge" ? ` · ${tr("délka {0} mm", f2(r.size))}` : ""}` };
}
const selOf = (r: EntRowUi): SelItem | null => (r.ent === "vertex" ? { kind: "vertex", index: r.index, compId: r.leafId, point: r.g.origin } : r.ent === "edge" ? { kind: "edge", index: r.index, compId: r.leafId } : { kind: "face", index: r.index, compId: r.leafId });

/** Seznam entit komponenty vhodných pro krok vazby (s hledáním); najetí zvýrazní entitu v modelu. */
function EntList({ ents, kinds, slot, onPick, onHover }: { ents: ReturnType<typeof useCompEnts>; kinds: EntKind[]; slot: string; onPick: (r: EntRowUi) => void; onHover?: (it: SelItem | null) => void }) {
  const [q, setQ] = useState("");
  const all = useMemo(() => ents.rows.filter((r) => accepts(kinds, r.kind)).sort((a, b) => (a.ent ?? "").localeCompare(b.ent ?? "") || b.size - a.size || a.index - b.index), [ents.rows, kinds]);
  const shown = useMemo(() => {
    const words = q.trim().toLowerCase().replace(/,/g, ".").split(/\s+/).filter(Boolean);
    if (!words.length) return all;
    return all.filter((r) => {
      const l = entLabel(r);
      const t = `${l.title} ${l.detail}`.toLowerCase().replace(/,/g, ".");
      return words.every((w) => t.includes(w));
    });
  }, [all, q]);
  const hover = useRef(onHover);
  hover.current = onHover;
  useEffect(() => () => hover.current?.(null), []);
  if (ents.loading) return <p className="text-[11px] text-[#6b7785]">{tr("Načítám plochy, hrany a vrcholy komponenty…")}</p>;
  if (!all.length) return <p className="text-[11px] text-brand-600">{tr("Komponenta nemá vhodnou entitu ({0}).", kinds.map((k) => tr(KIND_TEXT[k])).join(" / "))}</p>;
  return (
    <div className="space-y-1">
      {all.length > 6 && <input value={q} onChange={(e) => setQ(e.target.value)} placeholder={tr("Hledat (např. válcová, Ø8, hrana, +Z)…")} aria-label={tr("Hledat entitu")} className="w-full rounded border border-[#cfd6de] bg-white px-2 py-1 text-[11.5px] outline-none focus:border-brand" />}
      <ul data-ent-list={slot} className="max-h-[168px] divide-y divide-[#edf1f5] overflow-y-auto rounded border border-[#d5dbe2] bg-white">
        {shown.slice(0, 150).map((r) => {
          const l = entLabel(r);
          const it = selOf(r);
          return (
            <li key={`${r.leafId}:${r.ent ?? "f"}${r.index}`}>
              <button
                type="button"
                data-ent-row={`${r.leafId}:${r.ent ?? "f"}${r.index}`}
                onClick={() => onPick(r)}
                onMouseEnter={() => onHover?.(it)}
                onMouseLeave={() => onHover?.(null)}
                className="block w-full px-2 py-1 text-left hover:bg-[#fff4e0] focus:bg-[#fff4e0] focus:outline-none"
              >
                <span className="block break-words text-[11.5px] font-medium leading-snug text-[#1f2933]">{l.title}</span>
                <span className="block break-words font-mono text-[10.5px] leading-snug text-[#6b7785]">{l.detail}</span>
              </button>
            </li>
          );
        })}
      </ul>
      {(shown.length > 150 || ents.truncated) && <p className="text-[10.5px] text-[#8a95a3]">{tr("{0} z {1}", Math.min(150, shown.length), all.length)}{ents.truncated ? tr(" · načteno prvních {0} ploch / hran dílu", LIMIT) : ""}</p>}
    </div>
  );
}

/* ───────────────────────── průvodce vazbou ───────────────────────── */

const stepCls = "mb-1 text-[10.5px] font-semibold uppercase tracking-wider text-[#4a5664]";
const refEq = (r: MateRef | undefined, row: EntRowUi) => !!r && (r.leaf ?? r.compId) === row.leafId && r.face === row.index && r.ent === row.ent;

/**
 * Zadání pokročilé vazby: kroky podle druhu (entita této komponenty, cílová komponenta a její entita, další plochy / rovina souměrnosti),
 * přeskočení nepovinných kroků, hodnoty s výchozími z geometrie a tlačítko Vytvořit vazbu.
 */
export function KinMatePicker({
  doc,
  c,
  mate,
  onPatch,
  onConfirm,
  onHover,
}: {
  doc: CadDoc;
  c: AsmComponent;
  mate: PendingMate;
  onPatch: (p: Partial<PendingMate> | null) => void;
  onConfirm: (value: number, patch?: Partial<PendingMate>) => void;
  onHover?: (it: SelItem | null) => void;
}) {
  const mode = mate.mode as KinMateType;
  const spec = KIN_SPEC[mode];
  const others = (doc.components ?? []).filter((x) => x.id !== c.id);
  const slot = nextSlot(mate);
  const [target, setTarget] = useState("");
  const [any, setAny] = useState("");
  const targetId = mate.b?.compId ?? mate.target ?? (others.some((x) => x.id === target) ? target : (others[0]?.id ?? ""));
  const listComp = !slot ? null : slot.side === "self" ? c.id : slot.side === "target" ? targetId : any || targetId;
  const ents = useCompEnts(doc, listComp);
  const own = useCompEnts(doc, c.id);
  const tgt = useCompEnts(doc, targetId || null);
  const rowOf = (r?: MateRef) => (r ? [...own.rows, ...tgt.rows, ...ents.rows].find((x) => refEq(r, x)) : undefined);
  const gA = rowOf(mate.a)?.g ?? null;
  const gB = rowOf(mate.b)?.g ?? null;
  const ready = pendingReady(mate);
  // výchozí hodnoty z geometrie (poměr z poloměrů, stoupání ISO, meze kolem aktuální hodnoty) – jen jednou po výběru ploch
  const defaulted = useRef(false);
  useEffect(() => {
    if (defaulted.current || slot || mode === "lock" || !spec.params.length) return;
    if (!gA || !gB) return;
    defaulted.current = true;
    const d = kinDefaults(mode, gA, gB);
    onPatch({ ...(mate.value === undefined && d.value !== undefined ? { value: d.value } : {}), ...(mate.min === undefined && d.min !== undefined ? { min: d.min } : {}), ...(mate.max === undefined && d.max !== undefined ? { max: d.max } : {}) });
  }, [slot, gA, gB, mode, spec.params.length, mate.value, mate.min, mate.max, onPatch]);
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    box.current?.scrollIntoView?.({ block: "nearest" });
  }, [slot?.key, ents.loading]);
  const pick = (r: EntRowUi) => {
    if (!slot) return;
    const top = flattenLeaves(doc).find((l) => l.id === r.leafId)?.topId ?? r.leafId;
    if (!slotCompOk(mate, slot, top)) return;
    onPatch({ [slot.key]: { compId: top, ...(r.leafId !== top ? { leaf: r.leafId } : {}), face: r.index, ...(r.ent ? { ent: r.ent } : {}) } });
  };
  /** zrušit výběr kroku a všech dalších */
  const reset = (s: SlotSpec) => {
    const order = spec.slots.map((x) => x.key);
    const from = order.indexOf(s.key);
    const p: Partial<PendingMate> = { skip: [] };
    for (const k of order.slice(from)) p[k] = undefined;
    onPatch(p);
    defaulted.current = false;
  };
  const optionLabel = (x: AsmComponent) => {
    const same = (doc.components ?? []).filter((y) => y.name === x.name);
    return same.length > 1 ? `${x.name} (${same.indexOf(x) + 1})` : x.name;
  };
  const compSelect = (value: string, list: AsmComponent[], onChange: (id: string) => void, attr: string) => (
    <select data-kin-comp={attr} aria-label={tr("Komponenta")} value={value} onChange={(e) => onChange(e.target.value)} className="w-full rounded border border-[#cfd6de] bg-white px-2 py-1 text-[12px] outline-none focus:border-brand">
      {list.map((x) => (
        <option key={x.id} value={x.id}>
          {optionLabel(x)}
        </option>
      ))}
    </select>
  );
  if (!isKinMode(mate.mode)) return null;
  return (
    <div ref={box} data-mate-picker={mode} className="mt-2 space-y-2 rounded-lg border border-brand/30 bg-[#fbfcfd] p-2">
      <p className="text-[11px] leading-snug text-[#4a5664]">
        <span className="font-semibold">{tr(MATE_LABEL[mode])}</span> – {tr(spec.hint)}
      </p>
      {mode === "lock" ? (
        <div>
          <p className={stepCls}>{tr("Cílová komponenta")}</p>
          {others.length ? compSelect(targetId, others, (id) => onPatch({ target: id }), "target") : <p className="text-[11px] text-brand-600">{tr("V sestavě není žádná další komponenta – vazba potřebuje dvě.")}</p>}
        </div>
      ) : (
        spec.slots.map((s, i) => {
          const chosen = mate[s.key];
          const skipped = (mate.skip ?? []).includes(s.key as "c" | "d");
          const isNext = slot?.key === s.key;
          if (!chosen && !isNext) return skipped ? null : null;
          return (
            <div key={s.key} data-kin-slot={s.key}>
              <p className={stepCls}>
                {i + 1} · {tr(s.label)}
                {s.optional ? tr(" (nepovinné)") : ""}
              </p>
              {chosen ? (
                <div data-kin-chosen={s.key} className="flex items-center gap-1.5 rounded border border-emerald-500/50 bg-emerald-50/70 px-2 py-1">
                  <span className="min-w-0 flex-1 text-[11.5px] font-medium">{(() => { const r = rowOf(chosen); return r ? entLabel(r).title : `${chosen.ent === "edge" ? tr("Hrana {0}", chosen.face + 1) : chosen.ent === "vertex" ? tr("Vrchol {0}", chosen.face + 1) : tr("Plocha {0}", chosen.face + 1)} · ${doc.components?.find((x) => x.id === chosen.compId)?.name ?? ""}`; })()}</span>
                  <button type="button" onClick={() => reset(s)} className="shrink-0 rounded border border-[#cfd6de] bg-white px-1.5 py-0.5 text-[10.5px] hover:bg-[#f3f6f9]">
                    {tr("Změnit")}
                  </button>
                </div>
              ) : (
                <div className="space-y-1">
                  {s.side === "target" && !mate.b && (others.length ? compSelect(targetId, others, (id) => setTarget(id), "target") : <p className="text-[11px] text-brand-600">{tr("V sestavě není žádná další komponenta – vazba potřebuje dvě.")}</p>)}
                  {s.side === "any" && compSelect(any || targetId, doc.components ?? [], setAny, "any")}
                  <EntList key={`${listComp}:${s.key}`} ents={ents} kinds={s.kinds} slot={s.key} onPick={pick} onHover={onHover} />
                  {slotWants(s.kinds).edge || slotWants(s.kinds).vertex ? <p className="text-[10.5px] leading-snug text-[#8a95a3]">{tr("Hrany a vrcholy vyberte ze seznamu; plochy lze vybrat i kliknutím v modelu.")}</p> : null}
                  {s.optional && (
                    <button type="button" data-kin-skip={s.key} onClick={() => onPatch(skipSlot(mate, s))} className="w-full rounded border border-dashed border-[#cfd6de] py-1 text-[11px] text-[#4a5664] hover:bg-[#f3f6f9]">
                      {mode === "hinge" ? tr("Bez dosedacích rovin (osová poloha zůstane)") : tr("Přeskočit")}
                    </button>
                  )}
                </div>
              )}
            </div>
          );
        })
      )}
      {!slot && mode !== "lock" && (spec.params.length > 0 || spec.flip) && (
        <div data-kin-params className="space-y-1.5">
          <p className={stepCls}>{tr("Hodnoty")}</p>
          <div className="grid grid-cols-2 gap-2">
            {spec.params.map((p) => (
              <Num key={p.key} label={tr(p.label)} value={mate[p.key] ?? 0} step={p.step} suffix={p.suffix} onChange={(v) => v !== mate[p.key] && onPatch({ [p.key]: v })} />
            ))}
          </div>
          {spec.flip && (
            <label className="flex items-center gap-2 text-[12px]">
              <input type="checkbox" data-kin-flip className="accent-[#E03930]" checked={!!mate.flip} onChange={(e) => onPatch({ flip: e.target.checked || undefined })} />
              {tr(spec.flip)}
            </label>
          )}
        </div>
      )}
      <div className="flex gap-1.5">
        {(ready || (mode === "lock" && !!targetId)) && (
          <button
            type="button"
            data-mate-confirm
            onClick={() => onConfirm(mate.value ?? 0, mode === "lock" ? { a: { compId: c.id, face: -1 }, b: { compId: targetId, face: -1 } } : undefined)}
            className="flex-1 rounded bg-brand py-1.5 text-[12px] font-semibold text-white hover:bg-brand-600"
          >
            {tr("Vytvořit vazbu")}
          </button>
        )}
        <button type="button" data-mate-cancel onClick={() => onPatch(null)} className={cn("rounded border border-[#cfd6de] bg-white py-1.5 text-[12px] hover:bg-[#f3f6f9]", ready ? "px-3" : "flex-1")}>
          {tr("Zrušit")}
        </button>
      </div>
    </div>
  );
}

/**
 * Výběr entity kliknutím v modelu pro pokročilou vazbu: doplní další krok, pokud entita vyhoví druhu a komponentě kroku.
 * Vrací novou rozpracovanou vazbu, nebo text chyby pro stavový řádek.
 */
export function kinPickFromModel(p: PendingMate, topId: string, ref: MateRef, info: PartFace): { next?: PendingMate; error?: string } {
  const s = nextSlot(p);
  if (!s) return { error: tr("Všechny entity vazby jsou vybrané – potvrďte vazbu v panelu komponenty.") };
  if (!slotCompOk(p, s, topId)) return { error: s.side === "self" ? tr("Klikněte na plochu vybrané (pohyblivé) komponenty.") : tr("Teď klikněte na plochu cílové komponenty.") };
  const k = entKindOf(info, ref.ent);
  if (!accepts(s.kinds, k)) return { error: tr("Krok „{0}“ potřebuje: {1}", tr(s.label), s.kinds.map((x) => tr(KIND_TEXT[x])).join(" / ")) };
  return { next: { ...p, [s.key]: ref } };
}

/** Text výzvy ve stavovém řádku pro pokročilou vazbu. */
export function kinPrompt(p: PendingMate): string {
  const s = nextSlot(p);
  const label = tr(MATE_LABEL[p.mode as KinMateType]);
  if (p.mode === "lock") return tr("Vazba {0}: vyberte cílovou komponentu v panelu a potvrďte · Esc zruší", label);
  if (!s) return tr("Vazba {0}: zkontrolujte hodnoty a potvrďte v panelu komponenty · Esc zruší", label);
  return tr("Vazba {0}: {1} – klikněte na plochu v modelu nebo vyberte ze seznamu · Esc zruší", label, tr(s.label));
}
