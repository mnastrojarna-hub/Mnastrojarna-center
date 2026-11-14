"use client";

import { tr } from "@/cad/i18n";
import { useEffect, useMemo, useRef, useState } from "react";
import { groupComponents, groupKey, groupLabel } from "@/cad/asm-groups";
import { defaultMoldBase, type BomRow, type CompPattern, type MoldBaseParams } from "@/cad/assembly";
import { cad } from "@/cad/client";
import {
  MATE_LABEL,
  faceAreas,
  faceLabel,
  faceRow,
  hasFixedMate,
  mateFaceKind,
  mateNeedsValue,
  patchMate,
  releaseComponent,
  removeMate,
  snapDir,
  sortFaceRows,
  toggleFixedMate,
  type FaceRow,
  type MateMode,
  type MateStatus,
  type PartFace,
  type PendingMate,
} from "@/cad/mates";
import { evalExpr } from "@/cad/params";
import { uid, type AsmComponent, type CadDoc, type ComponentSource, type MateRef, type PlaneName, type Vec3 } from "@/cad/types";
import { MATERIALS, fmtNum } from "@/lib/mesh-metrics";
import { cn } from "@/lib/cn";
import { flattenLeaves, matrixToPlacement } from "./asm-flatten";
import { KinMateButtons, KinMatePicker, kinPrompt } from "./asm-mates-kin";
import { KIN_SPEC, isKinMode, kinHasLimits, kinHasValue } from "@/cad/mate-spec";
import { CadIcon } from "./cad-icons";
import { DirVecField } from "./dir-vec-field";
import { Num, Vec } from "./props";
import type { RMenuEntry } from "./ribbon";
import type { SelItem } from "./selection";

export type { MateMode, PendingMate } from "@/cad/mates";

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
  picked,
}: {
  doc: CadDoc;
  selected: string | null;
  /** výběr ve stromu; `add` = Ctrl / ⌘ / Shift + klik (přidat k výběru / ubrat z něj) */
  onSelect: (id: string | null, add?: boolean) => void;
  onCommit: (d: CadDoc) => void;
  onContext: (x: number, y: number, entries: RMenuEntry[]) => void;
  menuFor: (c: AsmComponent) => RMenuEntry[];
  /** další vybrané komponenty (Ctrl+klik ve stromu nebo v modelu) – zvýraznění řádků */
  picked?: readonly string[];
  /** stav trvalých vazeb (z řešiče) */
  mateStatus?: Record<string, MateStatus>;
  /** přepočítat vazby */
  onResolve?: () => void;
}) {
  const comps = doc.components ?? [];
  const groups = groupComponents(comps); // „Normálie“ i „Standard parts“ = jedna skupina (asm-groups.ts)
  const [closed, setClosed] = useState<Record<string, boolean>>({});
  const setComp = (id: string, patch: Partial<AsmComponent>) => onCommit({ ...doc, components: comps.map((c) => (c.id === id ? { ...c, ...patch } : c)) });
  return (
    <div className="min-h-0 flex-1 overflow-y-auto py-1 text-[12.5px]">
      <div className="flex items-center gap-2 px-3 py-1.5 font-semibold">
        <CadIcon name="layers" tone="create" className="h-4 w-4" />
        <span className="truncate">{doc.name}</span>
        <span className="ml-auto font-mono text-[10.5px] font-normal text-[#8a95a3]">{comps.length} ks</span>
      </div>
      {comps.length === 0 && <p className="m-3 rounded border border-dashed border-[#cdd5de] p-3 text-[11.5px] leading-relaxed text-[#6b7785]">{tr("Sestava je prázdná. Na kartě Sestava vložte díl, normálii nebo vygenerujte rám formy.")}</p>}
      {groups.map(({ key: g, label, items: list }) => (
        <div key={g} className="ml-3 border-l border-dashed border-[#cdd5de] pl-1">
          <button type="button" onClick={() => setClosed((c) => ({ ...c, [g]: !c[g] }))} className="flex w-full items-center gap-1.5 px-1.5 py-[3px] text-left text-[11.5px] font-semibold text-[#4a5664]">
            <CadIcon name={closed[g] ? "chevronRight" : "chevronDown"} className="h-3 w-3" />
            {label}
            <span className="ml-auto pr-2 font-mono text-[10px] font-normal text-[#8a95a3]">{list.length}</span>
          </button>
          {!closed[g] &&
            list.map((c) => (
              <div key={c.id}>
              <div
                onClick={(e) => {
                  const add = e.ctrlKey || e.metaKey || e.shiftKey;
                  onSelect(c.id === selected && !add ? null : c.id, add);
                }}
                onContextMenu={(e) => {
                  e.preventDefault();
                  onSelect(c.id);
                  onContext(e.clientX, e.clientY, menuFor(c));
                }}
                className={cn("group ml-3 flex cursor-default items-center gap-2 rounded px-2 py-[3px]", c.id === selected || picked?.includes(c.id) ? "bg-[#dbe7f5]" : "hover:bg-[#edf2f7]", c.hidden && "opacity-45")}
              >
                {c.source.kind === "asm" ? (
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      setClosed((x) => ({ ...x, [c.id]: !x[c.id] }));
                    }}
                    className="text-[#6b7785]"
                    title={tr("Rozbalit podsestavu")}
                  >
                    <CadIcon name={closed[c.id] ? "chevronRight" : "chevronDown"} className="h-3 w-3" />
                  </button>
                ) : null}
                {c.source.kind === "asm" ? <CadIcon name="layers" tone="create" className="h-3.5 w-3.5 shrink-0" /> : <span className="h-3 w-3 shrink-0 rounded-sm border border-black/20" style={{ background: c.color ?? "#b9c2cc" }} />}
                <span className="min-w-0 flex-1 truncate">{c.name}</span>
                {c.source.kind === "asm" && <span className="font-mono text-[10px] text-[#8a95a3]">{c.source.doc.components?.length ?? 0}</span>}
                {(c.fixed || hasFixedMate(doc, c.id)) && <CadIcon name="lock" className="h-3 w-3 text-[#8a95a3]" />}
                <button
                  type="button"
                  title={c.hidden ? tr("Zobrazit") : tr("Skrýt")}
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

/**
 * Seznam trvalých vazeb sestavy (pod stromem komponent). Vazbu lze po vytvoření upravit: hodnotu Vzdálenosti / Úhlu přepsat
 * v poli (číslo i výraz), otočit, potlačit nebo smazat – každá změna jde přes `onCommit`, které sestavu znovu přepočítá.
 * Vazba Ukotvit se týká jedné komponenty; jejím smazáním / potlačením se komponenta uvolní.
 */
function MatesList({ doc, status, onCommit, onResolve, onSelect }: { doc: CadDoc; status?: Record<string, MateStatus>; onCommit: (d: CadDoc) => void; onResolve?: () => void; onSelect: (id: string | null) => void }) {
  const mates = doc.mates ?? [];
  const [closed, setClosed] = useState(false);
  const name = (id: string) => doc.components?.find((c) => c.id === id)?.name ?? "?";
  if (!mates.length) return null;
  const conflicts = mates.filter((m) => status?.[m.id] === "conflict").length;
  return (
    <div className="ml-3 mt-1 border-l border-dashed border-[#cdd5de] pl-1" data-mates-list>
      <button type="button" onClick={() => setClosed((v) => !v)} className="flex w-full items-center gap-1.5 px-1.5 py-[3px] text-left text-[11.5px] font-semibold text-[#4a5664]">
        <CadIcon name={closed ? "chevronRight" : "chevronDown"} className="h-3 w-3" />
        {tr("Vazby")}
        {conflicts > 0 && <span className="rounded bg-brand/10 px-1 text-[10px] text-brand-600">{tr("{0} konflikt", conflicts)}</span>}
        <span className="ml-auto pr-2 font-mono text-[10px] font-normal text-[#8a95a3]">{mates.length}</span>
      </button>
      {!closed &&
        mates.map((m) => {
          const st = status?.[m.id] ?? (m.suppressed ? "suppressed" : "missing");
          const valued = mateNeedsValue(m.type);
          const kinValue = !valued && kinHasValue(m.type) ? KIN_SPEC[m.type as keyof typeof KIN_SPEC].params.find((p) => p.key === "value") : undefined;
          return (
            <div key={m.id} data-mate={m.id} data-mate-type={m.type} className={cn("group ml-3 rounded px-2 py-[3px] text-[12px]", m.suppressed && "opacity-45")} onClick={() => onSelect(m.a.compId)} title={tr(STATUS_TITLE[st])}>
              <div className="flex items-center gap-2">
                <span className={cn("h-2 w-2 shrink-0 rounded-full", STATUS_DOT[st])} />
                <span className="min-w-0 flex-1 truncate">
                  <span className="font-medium">{m.name ?? tr(MATE_LABEL[m.type])}</span>
                  {m.center && <span className="text-[#8a95a3]"> {tr("(střed)")}</span>}
                  <span className="block truncate text-[10.5px] text-[#8a95a3]">{m.type === "fixed" ? name(m.a.compId) : `${name(m.a.compId)} → ${name(m.b.compId)}`}</span>
                </span>
                {m.type !== "fixed" && (
                  <button type="button" title={tr("Otočit (flip)")} onClick={(e) => { e.stopPropagation(); onCommit(patchMate(doc, m.id, { flip: !m.flip })); }} className="hidden text-[#6b7785] hover:text-[#1f2933] group-hover:block">
                    <CadIcon name="mirror" className="h-3.5 w-3.5" />
                  </button>
                )}
                <button type="button" title={m.suppressed ? tr("Zapnout") : tr("Potlačit")} onClick={(e) => { e.stopPropagation(); onCommit(patchMate(doc, m.id, { suppressed: !m.suppressed })); }} className="hidden text-[#6b7785] hover:text-[#1f2933] group-hover:block">
                  <CadIcon name="eye" className="h-3.5 w-3.5" />
                </button>
                <button type="button" title={tr("Smazat vazbu")} onClick={(e) => { e.stopPropagation(); onCommit(removeMate(doc, m.id)); }} className="hidden text-[#6b7785] hover:text-brand group-hover:block">
                  <CadIcon name="trash" className="h-3.5 w-3.5" />
                </button>
              </div>
              {valued && (
                // hodnota vazby: pole Num bez nadpisu (typ vazby je o řádek výš); změna se uloží a sestava se přepočítá
                <div className="ml-4 mt-0.5 w-[150px] [&_label>span:first-child]:hidden" onClick={(e) => e.stopPropagation()} title={tr("Hodnotu vazby lze přepsat (číslo i výraz, např. 25/2) – Enter potvrdí a sestava se přepočítá")}>
                  <Num label={m.type === "angle" ? tr("Úhel") : tr("Vzdálenost")} value={m.value ?? 0} step={m.type === "angle" ? 5 : 1} suffix={m.type === "angle" ? "°" : "mm"} onChange={(v) => v !== (m.value ?? 0) && onCommit(patchMate(doc, m.id, { value: v }))} />
                </div>
              )}
              {kinValue && (
                // pokročilé vazby: převodový poměr, stoupání, posuv na otáčku – úprava přepočítá sestavu
                <div className="ml-4 mt-0.5 w-[170px]" onClick={(e) => e.stopPropagation()} data-mate-value={m.id}>
                  <Num label={tr(kinValue.label)} value={m.value ?? 0} step={kinValue.step} suffix={kinValue.suffix} onChange={(v) => v > 0 && v !== (m.value ?? 0) && onCommit(patchMate(doc, m.id, { value: v }))} />
                </div>
              )}
              {kinHasLimits(m.type) && (
                <div className="ml-4 mt-0.5 grid w-[200px] grid-cols-2 gap-1.5" onClick={(e) => e.stopPropagation()} data-mate-limits={m.id}>
                  <Num label={tr("Min")} value={m.min ?? 0} suffix={m.type === "limitAngle" ? "°" : "mm"} onChange={(v) => v !== m.min && onCommit(patchMate(doc, m.id, { min: v }))} />
                  <Num label={tr("Max")} value={m.max ?? 0} suffix={m.type === "limitAngle" ? "°" : "mm"} onChange={(v) => v !== m.max && onCommit(patchMate(doc, m.id, { max: v }))} />
                </div>
              )}
            </div>
          );
        })}
      {!closed && onResolve && (
        <button type="button" onClick={onResolve} className="ml-3 mt-1 rounded border border-[#cfd6de] px-2 py-0.5 text-[11px] hover:bg-[#f3f6f9]">
          {tr("Přepočítat vazby")}
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

// ---------------- zadávání vazby: výzva, zvýraznění, seznamy ploch ----------------

/** Výzva ve stavovém řádku pro rozpracovanou vazbu (nebo výběr směru pole komponenty z plochy). */
export function matePrompt(m: PendingMate): string {
  if (isKinMode(m.mode)) return kinPrompt(m);
  if (m.mode === "dir") return tr("Směr pole: klikněte na rovinnou plochu (normála) nebo válcovou plochu (osa) kterékoli komponenty · Esc zruší");
  if (m.b) return tr("Vazba: potvrďte hodnotu v panelu komponenty (Enter) · Esc zruší");
  if (!m.a) return tr("Vazba {0} vybrané (pohyblivé) komponenty · Esc zruší", m.mode === "concentric" ? tr("Souosost: klikněte na válcovou plochu") : tr("– klikněte na rovinnou plochu"));
  return tr("Vazba: klikněte na {0} plochu cílové komponenty", m.mode === "concentric" ? tr("válcovou") : tr("rovinnou"));
}

/** Zvýraznění v modelu během zadávání vazby: už vybrané plochy + plocha, na kterou uživatel najel v seznamu ploch. */
export function mateSelection(m: PendingMate | null, hover: SelItem | null): SelItem[] {
  const out: SelItem[] = [];
  for (const r of [m?.a, m?.b, m?.c, m?.d]) if (r && r.face >= 0 && r.ent !== "vertex") out.push(r.ent === "edge" ? { kind: "edge", index: r.face, compId: r.leaf ?? r.compId } : { kind: "face", index: r.face, compId: r.leaf ?? r.compId });
  if (hover) out.push(hover);
  return out;
}

type PartFaces = { faces: { face: number; info: PartFace; area?: number }[]; truncated: boolean };
/** nejvýš tolik ploch jednoho dílu se načte do seznamu (další lze vybrat kliknutím v modelu) */
const FACE_LIMIT = 400;
/** nejvýš tolik řádků seznam vykreslí najednou (zbytek po upřesnění hledáním) */
const ROW_LIMIT = 150;
const IDENT = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
const partFaces = new Map<string, Promise<PartFaces>>();

/**
 * Plochy dílu použitelné pro vazby (rovinné, válcové, kuželové) v souřadnicích dílu. Jde přes operace jádra pro komponenty
 * (`asmParts` zajistí postavení dílu a dá síť pro plošný obsah, `mateFace` geometrii plochy, `inspect` rozliší kužel od válce).
 * Klíč dílu je otisk jeho obsahu, takže výsledek lze držet v mezipaměti a opakované otevření seznamu je okamžité.
 */
function loadPartFaces(key: string, source: ComponentSource): Promise<PartFaces> {
  const hit = partFaces.get(key);
  if (hit) return hit;
  const p = (async (): Promise<PartFaces> => {
    const res = (await cad.asmParts([{ key, source }]))[0]?.result;
    const total = res?.metrics?.faces ?? 0;
    const n = Math.min(total, FACE_LIMIT);
    const areas = res?.mesh ? faceAreas(res.mesh) : [];
    const faces: PartFaces["faces"] = [];
    for (let start = 0; start < n; start += 25) {
      const idx = Array.from({ length: Math.min(25, n - start) }, (_, k) => start + k);
      const infos = await Promise.all(idx.map((i) => cad.mateFace(key, i).catch(() => null)));
      const cones = await Promise.all(
        infos.map((f, k) =>
          f?.kind === "cylinder"
            ? cad.inspect({ kind: "comp", key, matrix: IDENT }, { kind: "face", index: idx[k] }).then(
                (e) => e.surface === "CONE",
                () => false,
              )
            : false,
        ),
      );
      infos.forEach((f, k) => {
        if (f && f.kind !== "other") faces.push({ face: idx[k], info: { ...f, cone: cones[k] || undefined }, area: areas[idx[k]] });
      });
    }
    return { faces, truncated: total > n };
  })();
  partFaces.set(key, p);
  p.catch(() => partFaces.delete(key));
  if (partFaces.size > 60) partFaces.delete(partFaces.keys().next().value as string);
  return p;
}

/** Řádek seznamu ploch komponenty: plocha listového dílu ve světových souřadnicích sestavy (`part` = název dílu uvnitř podsestavy). */
type CompFaceRow = FaceRow & { leafId: string; part?: string };
type CompFaces = { rows: CompFaceRow[]; loading: boolean; truncated: boolean };

/** Plochy komponenty nejvyšší úrovně (u podsestavy plochy všech jejích dílů) ve světových souřadnicích sestavy. */
function useCompFaces(doc: CadDoc, compId: string | null): CompFaces {
  const leaves = useMemo(() => (compId ? flattenLeaves(doc).filter((l) => l.topId === compId) : []), [doc, compId]);
  const sig = leaves.map((l) => l.key).join("|");
  const [loaded, setLoaded] = useState<{ sig: string; parts: Record<string, PartFaces> }>({ sig: "", parts: {} });
  useEffect(() => {
    if (!leaves.length) return;
    let dead = false;
    Promise.all(leaves.map((l) => loadPartFaces(l.key, l.comp.source).then((f) => [l.key, f] as const, () => [l.key, { faces: [], truncated: false } as PartFaces] as const))).then((all) => {
      if (!dead) setLoaded({ sig, parts: Object.fromEntries(all) });
    });
    return () => {
      dead = true;
    };
    // `leaves` se mění s každým pohybem komponenty; plochy dílů závisí jen na jejich obsahu (klíčích v `sig`)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sig]);
  const ready = !leaves.length || loaded.sig === sig;
  const rows = useMemo(() => {
    const out: CompFaceRow[] = [];
    if (loaded.sig !== sig) return out;
    for (const l of leaves) {
      const world = matrixToPlacement(l.matrix);
      for (const f of loaded.parts[l.key]?.faces ?? []) {
        const r = faceRow(f.face, f.info, world, f.area);
        if (r) out.push({ ...r, leafId: l.id, part: l.id !== l.topId ? l.path.slice(1).join(" › ") : undefined });
      }
    }
    return out;
  }, [leaves, loaded, sig]);
  return { rows, loading: !ready, truncated: ready && leaves.some((l) => loaded.parts[l.key]?.truncated) };
}

const refRow = (faces: CompFaces, ref?: MateRef) => (ref ? faces.rows.find((r) => r.leafId === (ref.leaf ?? ref.compId) && r.face === ref.face) : undefined);

/** Dvouřádkový popis plochy: číslo, typ, směr normály / osy · poloha a velikost. */
function FaceText({ r }: { r: CompFaceRow }) {
  const { title, detail } = faceLabel(r);
  return (
    <>
      <span className="block break-words text-[11.5px] font-medium leading-snug text-[#1f2933]">
        {r.part ? `${r.part} › ` : ""}
        {title}
      </span>
      <span className="block break-words font-mono text-[10.5px] leading-snug text-[#6b7785]">{detail}</span>
    </>
  );
}

/**
 * Seznam ploch komponenty pro vazbu – výběr bez trefování do 3D. Nabízí jen plochy daného druhu (Souosost válcové a kuželové,
 * ostatní vazby rovinné), rovinné od největší. Najetí na řádek (nebo fokus klávesnicí) plochu zvýrazní v modelu.
 */
function FaceList({ faces, kind, step, onPick, onHover }: { faces: CompFaces; kind: "plane" | "cylinder"; step: "a" | "b"; onPick: (leafId: string, face: number) => void; onHover?: (it: SelItem | null) => void }) {
  const [query, setQuery] = useState("");
  const all = useMemo(() => sortFaceRows(faces.rows.filter((r) => r.kind === kind)), [faces.rows, kind]);
  const shown = useMemo(() => {
    const words = query.trim().toLowerCase().replace(/,/g, ".").split(/\s+/).filter(Boolean);
    if (!words.length) return all;
    return all.filter((r) => {
      const l = faceLabel(r);
      const text = `${r.part ?? ""} ${l.title} ${l.detail}`.toLowerCase().replace(/,/g, ".");
      return words.every((w) => text.includes(w));
    });
  }, [all, query]);
  // po výběru řádku seznam zmizí bez události „myš pryč“ – zvýraznění se musí zrušit i při odpojení
  const hover = useRef(onHover);
  hover.current = onHover;
  useEffect(() => () => hover.current?.(null), []);
  if (faces.loading) return <p className="text-[11px] text-[#6b7785]">{tr("Načítám plochy komponenty…")}</p>;
  if (!all.length) return <p className="text-[11px] text-brand-600">{kind === "cylinder" ? tr("Komponenta nemá žádnou válcovou ani kuželovou plochu.") : tr("Komponenta nemá žádnou rovinnou plochu.")}</p>;
  return (
    <div className="space-y-1">
      {all.length > 6 && <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder={tr("Hledat plochu (např. +Z, Ø8, 120)…")} aria-label={tr("Hledat plochu")} className="w-full rounded border border-[#cfd6de] bg-white px-2 py-1 text-[11.5px] outline-none focus:border-brand" />}
      <ul data-face-list={step} className="max-h-[168px] divide-y divide-[#edf1f5] overflow-y-auto rounded border border-[#d5dbe2] bg-white">
        {shown.slice(0, ROW_LIMIT).map((r) => {
          const it: SelItem = { kind: "face", index: r.face, compId: r.leafId };
          return (
            <li key={`${r.leafId}:${r.face}`}>
              <button
                type="button"
                data-face-row={`${r.leafId}:${r.face}`}
                onClick={() => onPick(r.leafId, r.face)}
                onMouseEnter={() => onHover?.(it)}
                onMouseLeave={() => onHover?.(null)}
                onFocus={() => onHover?.(it)}
                onBlur={() => onHover?.(null)}
                className="block w-full px-2 py-1 text-left hover:bg-[#fff4e0] focus:bg-[#fff4e0] focus:outline-none"
              >
                <FaceText r={r} />
              </button>
            </li>
          );
        })}
      </ul>
      {(shown.length > ROW_LIMIT || faces.truncated || shown.length < all.length) && (
        <p className="text-[10.5px] leading-snug text-[#8a95a3]">
          {tr("{0} z {1} ploch", Math.min(shown.length, ROW_LIMIT), all.length)}
          {shown.length > ROW_LIMIT && tr(" · upřesněte hledáním")}
          {faces.truncated && tr(" · načteno prvních {0} ploch dílu, další vyberte kliknutím v modelu", FACE_LIMIT)}
        </p>
      )}
    </div>
  );
}

/** Vybraná plocha kroku vazby s tlačítkem Změnit (plocha vybraná klikem v modelu se popíše stejně jako ze seznamu). */
function ChosenFace({ faces, mref, step, onChange }: { faces: CompFaces; mref: MateRef; step: "a" | "b"; onChange: () => void }) {
  const r = refRow(faces, mref);
  return (
    <div data-face-chosen={step} className="flex items-center gap-1.5 rounded border border-emerald-500/50 bg-emerald-50/70 px-2 py-1">
      <span className="min-w-0 flex-1">{r ? <FaceText r={r} /> : <span className="block truncate text-[11.5px] font-medium">{tr("Plocha {0}", mref.face + 1)}</span>}</span>
      <button type="button" onClick={onChange} className="shrink-0 rounded border border-[#cfd6de] bg-white px-1.5 py-0.5 text-[10.5px] hover:bg-[#f3f6f9]">
        {tr("Změnit")}
      </button>
    </div>
  );
}

const stepCls = "mb-1 text-[10.5px] font-semibold uppercase tracking-wider text-[#4a5664]";

/**
 * Panel rozpracované vazby: 1) plocha vybrané (pohyblivé) komponenty, 2) cílová komponenta a její plocha – obojí ze seznamu,
 * nebo kliknutím v modelu (stav je společný, lze kombinovat) – a 3) u Vzdálenosti / Úhlu potvrzení hodnoty předvyplněné tím,
 * co je právě naměřeno (výchozí hodnota tedy komponentami nepohne).
 */
function MatePicker({
  doc,
  c,
  mate,
  onPatch,
  onPickFace,
  onConfirm,
  onHover,
}: {
  doc: CadDoc;
  c: AsmComponent;
  mate: PendingMate;
  onPatch: (p: Partial<PendingMate> | null) => void;
  onPickFace: (leafId: string, face: number) => void;
  onConfirm: (value: number) => void;
  onHover?: (it: SelItem | null) => void;
}) {
  const kind = mateFaceKind(mate.mode);
  const others = (doc.components ?? []).filter((x) => x.id !== c.id);
  const [target, setTarget] = useState("");
  const targetId = mate.b?.compId ?? (others.some((x) => x.id === target) ? target : (others[0]?.id ?? ""));
  const own = useCompFaces(doc, c.id);
  const tgt = useCompFaces(doc, mate.a && targetId ? targetId : null);
  const valued = mateNeedsValue(mate.mode);
  const angle = mate.mode === "angle";
  // panel komponenty je dlouhý: nový krok (seznam ploch, pole hodnoty) se posune do zorného pole
  const box = useRef<HTMLDivElement>(null);
  const stage = mate.b ? 2 : mate.a ? 1 : 0;
  useEffect(() => {
    box.current?.scrollIntoView?.({ block: "nearest" });
  }, [stage, own.loading, tgt.loading]);
  // po výběru obou ploch (i klikem v modelu) je pole hodnoty rovnou aktivní: stačí přepsat číslo a Enter
  useEffect(() => {
    if (stage !== 2 || !valued) return;
    const input = box.current?.querySelector<HTMLInputElement>("[data-mate-pending-value] input");
    input?.focus();
    input?.select();
  }, [stage, valued]);
  /** stejně pojmenované komponenty (dva čepy) rozliší pořadové číslo */
  const optionLabel = (x: AsmComponent) => {
    const same = others.filter((y) => y.name === x.name);
    return same.length > 1 ? `${x.name} (${same.indexOf(x) + 1})` : x.name;
  };
  return (
    <div ref={box} data-mate-picker={mate.mode} className="mt-2 space-y-2 rounded-lg border border-brand/30 bg-[#fbfcfd] p-2">
      <div>
        <p className={stepCls}>{tr("1 · Plocha této komponenty")}</p>
        {mate.a ? <ChosenFace faces={own} mref={mate.a} step="a" onChange={() => onPatch({ a: undefined, b: undefined, value: undefined, flip: undefined })} /> : <FaceList faces={own} kind={kind} step="a" onPick={onPickFace} onHover={onHover} />}
      </div>
      {mate.a && (
        <div>
          <p className={stepCls}>{tr("2 · Cílová komponenta a její plocha")}</p>
          {others.length ? (
            <div className="space-y-1">
              <select
                data-mate-target
                aria-label={tr("Cílová komponenta")}
                value={targetId}
                onChange={(e) => {
                  setTarget(e.target.value);
                  if (mate.b) onPatch({ b: undefined, value: undefined, flip: undefined });
                }}
                className="w-full rounded border border-[#cfd6de] bg-white px-2 py-1 text-[12px] outline-none focus:border-brand"
              >
                {others.map((x) => (
                  <option key={x.id} value={x.id}>
                    {optionLabel(x)}
                  </option>
                ))}
              </select>
              {mate.b ? <ChosenFace faces={tgt} mref={mate.b} step="b" onChange={() => onPatch({ b: undefined, value: undefined, flip: undefined })} /> : <FaceList key={targetId} faces={tgt} kind={kind} step="b" onPick={onPickFace} onHover={onHover} />}
            </div>
          ) : (
            <p className="text-[11px] text-brand-600">{tr("V sestavě není žádná další komponenta – vazba potřebuje dvě.")}</p>
          )}
        </div>
      )}
      {mate.a && mate.b && valued && (
        <div
          data-mate-pending-value
          onKeyDown={(e) => {
            // Enter v poli hodnotu rovnou potvrdí a vazbu vytvoří (text pole se vyhodnotí tady – stav se ještě nestihl propsat)
            if (e.key !== "Enter" || !(e.target instanceof HTMLInputElement)) return;
            try {
              onConfirm(evalExpr(e.target.value));
            } catch {
              /* neplatný výraz – pole si chybu ohlásí samo */
            }
          }}
        >
          <p className={stepCls}>{angle ? tr("3 · Úhel mezi plochami") : tr("3 · Vzdálenost ploch")}</p>
          <Num label={angle ? tr("Úhel") : tr("Vzdálenost")} hint={tr("naměřeno")} value={mate.value ?? 0} step={angle ? 5 : 1} suffix={angle ? "°" : "mm"} onChange={(v) => v !== mate.value && onPatch({ value: v })} />
          <p className="mt-1 text-[10.5px] leading-snug text-[#8a95a3]">{tr("Předvyplněna je aktuálně naměřená hodnota – s ní komponenty zůstanou, kde jsou. Přepište ji a potvrďte (Enter).")}</p>
        </div>
      )}
      <div className="flex gap-1.5">
        {mate.a && mate.b && valued && (
          <button type="button" data-mate-confirm onClick={() => onConfirm(mate.value ?? 0)} className="flex-1 rounded bg-brand py-1.5 text-[12px] font-semibold text-white hover:bg-brand-600">
            {tr("Vytvořit vazbu")}
          </button>
        )}
        <button type="button" data-mate-cancel onClick={() => onPatch(null)} className={cn("rounded border border-[#cfd6de] bg-white py-1.5 text-[12px] hover:bg-[#f3f6f9]", mate.a && mate.b && valued ? "px-3" : "flex-1")}>
          {tr("Zrušit")}
        </button>
      </div>
    </div>
  );
}

/** Textová vlastnost komponenty: potvrdí se Enterem nebo opuštěním pole (jen když se změnila), Esc vrátí původní hodnotu. */
function TextProp({ label, value, required, onCommit }: { label: string; value: string; required?: boolean; onCommit: (v: string) => void }) {
  return (
    <label className="block">
      <span className="mb-1 block text-[11px] font-medium uppercase tracking-wider text-ink-700/55">{label}</span>
      <input
        defaultValue={value}
        aria-label={label}
        onBlur={(e) => {
          const v = e.target.value.trim();
          if (v === value) return;
          if (!v && required) {
            e.target.value = value;
            return;
          }
          onCommit(v);
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter") e.currentTarget.blur();
          if (e.key === "Escape") {
            e.currentTarget.value = value;
            e.currentTarget.blur();
          }
        }}
        className="w-full rounded-lg border border-ink-700/12 px-2.5 py-1.5 text-[13px] outline-none focus:border-brand"
      />
    </label>
  );
}

const AXIS_DIR: Record<"X" | "Y" | "Z", Vec3> = { X: [1, 0, 0], Y: [0, 1, 0], Z: [0, 0, 1] };

/** Vlastnosti komponenty (pravý panel). */
export function AsmProps({
  c,
  doc,
  onChange,
  onDoc,
  onMate,
  mate = null,
  onMatePatch,
  onMateFace,
  onMateConfirm,
  onFaceHover,
  onPattern,
  onMirror,
  onBolt,
  bolting,
}: {
  c: AsmComponent;
  /** sestava (komponenty a vazby) – seznamy ploch pro vazby, vazba Ukotvit */
  doc: CadDoc;
  onChange: (p: Partial<AsmComponent>) => void;
  /** změna sestavy z panelu (vazby) – volající ji uloží a vazby přepočítá */
  onDoc: (d: CadDoc) => void;
  /** spustí / zruší zadávání vazby daného typu pro tuto komponentu („dir“ = výběr plochy pro směr pole) */
  onMate: (mode: PendingMate["mode"]) => void;
  /** rozpracovaná vazba této komponenty (vybrané plochy, čekající hodnota) */
  mate?: PendingMate | null;
  /** úprava rozpracované vazby (např. zrušení vybrané plochy, změna hodnoty); null = zadávání zrušit */
  onMatePatch?: (p: Partial<PendingMate> | null) => void;
  /** plocha vybraná ze seznamu – stejné jako kliknutí na plochu v modelu (id listového dílu, index plochy) */
  onMateFace?: (leafId: string, face: number) => void;
  /** potvrzení hodnoty Vzdálenosti / Úhlu po výběru obou ploch → vazba se vytvoří (`patch` = doplnění rozpracované vazby, např. Zámek) */
  onMateConfirm?: (value: number, patch?: Partial<PendingMate>) => void;
  /** zvýraznění plochy v modelu při najetí na řádek seznamu ploch */
  onFaceHover?: (it: SelItem | null) => void;
  onPattern?: (p: CompPattern) => void;
  onMirror?: (plane: PlaneName, offset: number) => void;
  onBolt?: (opts: { washer: boolean; nut: boolean }) => void;
  bolting?: boolean;
}) {
  const [pat, setPat] = useState<CompPattern>({ kind: "linear", count: 3, spacing: 50, direction: [1, 0, 0] });
  const [mirrorPlane, setMirrorPlane] = useState<PlaneName>("YZ");
  const [mirrorOffset, setMirrorOffset] = useState(0);
  const [bolt, setBolt] = useState({ washer: true, nut: false });
  const activeMode = mate && mate.mode !== "dir" ? mate.mode : null;
  const dirPicking = mate?.mode === "dir";
  const pickedDir = dirPicking ? mate.dir : undefined;
  const fixedByMate = hasFixedMate(doc, c.id);
  // směr pole převzatý z plochy kliknuté v modelu (normála roviny / osa válce) → do formuláře a výběr ukončit
  useEffect(() => {
    if (!pickedDir) return;
    setPat((p) => (p.kind === "linear" ? { ...p, direction: snapDir(pickedDir) } : p));
    onMatePatch?.(null);
  }, [pickedDir, onMatePatch]);
  const mateBtn = (mode: MateMode, label: string, title: string) => (
    <button type="button" data-mate-mode={mode} onClick={() => onMate(mode)} className={cn("rounded border py-1.5 text-[11.5px]", activeMode === mode ? "border-brand bg-brand/10" : "border-[#cfd6de] hover:bg-[#f3f6f9]")} title={title}>
      {label}
    </button>
  );
  return (
    <div className="space-y-4">
      <TextProp key={`${c.id}:name:${c.name}`} label={tr("Název")} value={c.name} required onCommit={(v) => onChange({ name: v })} />
      <div className="grid grid-cols-2 gap-2">
        <TextProp key={`${c.id}:number:${c.number ?? ""}`} label={tr("Číslo / norma")} value={c.number ?? ""} onCommit={(v) => onChange({ number: v || undefined })} />
        <TextProp key={`${c.id}:group:${c.group ?? ""}`} label={tr("Skupina")} value={c.group ? groupLabel(c.group) : ""} onCommit={(v) => onChange({ group: v.trim() ? groupKey(v) : undefined })} />
      </div>
      {/* ukotvená komponenta (příznak nebo vazba Ukotvit) se nepřesouvá – jako gizmo a klávesa G; poloha jde změnit po uvolnění */}
      <fieldset disabled={!!c.fixed || fixedByMate} data-placement-locked={!!c.fixed || fixedByMate || undefined} className="space-y-4 disabled:opacity-55">
      {(!!c.fixed || fixedByMate) && <p className="rounded bg-[#eef2f6] px-2 py-1 text-[11px] text-[#5b6776]">{tr("Komponenta je ukotvená – polohu a natočení změníte po uvolnění (Ukotvená dole).")}</p>}
      <Vec label={tr("Poloha [mm]")} value={c.placement.position} onChange={(v: Vec3) => onChange({ placement: { ...c.placement, position: v } })} />
      <Vec label={tr("Natočení X / Y / Z [°]")} value={c.placement.rotation} onChange={(v: Vec3) => onChange({ placement: { ...c.placement, rotation: v } })} />
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
      </fieldset>
      <div>
        <p className="mb-1 text-[11px] font-medium uppercase tracking-wider text-ink-700/55">{tr("Vazby (trvalé – uloží se do sestavy)")}</p>
        <div className="grid grid-cols-3 gap-1.5">
          {mateBtn("mate", tr("Kontakt"), tr("Rovinné plochy proti sobě, v jedné rovině"))}
          {mateBtn("flush", tr("Zarovnat"), tr("Rovinné plochy souhlasně v jedné rovině"))}
          {mateBtn("center", tr("Vystředit"), tr("Kontakt + ztotožnění středů ploch"))}
          {mateBtn("concentric", tr("Souosost"), tr("Osy válcových ploch (čep v díře, šroub v díře)"))}
          {mateBtn("distance", tr("Vzdálenost"), tr("Rovinné plochy rovnoběžně v zadané vzdálenosti"))}
          {mateBtn("angle", tr("Úhel"), tr("Rovinné plochy pod zadaným úhlem"))}
          {mateBtn("parallel", tr("Rovnoběžně"), tr("Jen natočení – normály rovnoběžně"))}
          <button
            type="button"
            data-mate-mode="fixed"
            onClick={() => onDoc(toggleFixedMate(doc, c.id, uid()))}
            className={cn("rounded border py-1.5 text-[11.5px]", fixedByMate ? "border-brand bg-brand/10" : "border-[#cfd6de] hover:bg-[#f3f6f9]")}
            title={fixedByMate ? tr("Komponenta má vazbu Ukotvit – kliknutím ji odeberete a komponentu uvolníte (totéž smazáním vazby v seznamu vazeb)") : tr("Ukotví komponentu na místě: vazba Ukotvit se zapíše do seznamu vazeb, ostatní vazby pak hýbou druhou komponentou")}
          >
            {tr("Ukotvit")}
          </button>
        </div>
        {/* pokročilé a mechanické vazby (Kolmo … Kardan) – průvodce v asm-mates-kin.tsx */}
        <KinMateButtons active={activeMode} onMate={(t) => onMate(t)} />
        {mate && activeMode && onMatePatch && onMateConfirm && isKinMode(activeMode) && <KinMatePicker key={activeMode} doc={doc} c={c} mate={mate} onPatch={onMatePatch} onConfirm={onMateConfirm} onHover={onFaceHover} />}
        {mate && activeMode && onMatePatch && onMateFace && onMateConfirm && !isKinMode(activeMode) && <MatePicker key={activeMode} doc={doc} c={c} mate={mate} onPatch={onMatePatch} onPickFace={onMateFace} onConfirm={onMateConfirm} onHover={onFaceHover} />}
        <p className="mt-1.5 text-[11px] leading-relaxed text-[#6b7785]">
          {activeMode ? tr("Klikněte na plochu této komponenty a pak na plochu jiné komponenty. Vazba se uloží a přepočítá při každém pohybu.") : tr("Vyberte typ vazby, pak klikněte na plochu této komponenty a na plochu cílové komponenty.")}{" "}
          {activeMode
            ? activeMode === "distance" || activeMode === "angle"
              ? tr("Plochy lze místo klikání vybrat ze seznamů výše; hodnotu potvrdíte až po výběru obou ploch.")
              : tr("Plochy lze místo klikání vybrat ze seznamů výše.")
            : tr("Plochy lze vybrat i ze seznamu v tomto panelu; hotovou vazbu upravíte v seznamu Vazby pod stromem komponent.")}
        </p>
      </div>
      {onPattern && (
        <div>
          <p className="mb-1 text-[11px] font-medium uppercase tracking-wider text-ink-700/55">{tr("Pole komponenty")}</p>
          <div className="mb-1.5 flex rounded-md bg-[#eef2f6] p-0.5">
            {(["linear", "circular"] as const).map((k) => (
              <button
                key={k}
                type="button"
                onClick={() => {
                  if (dirPicking) onMatePatch?.(null);
                  setPat(k === "linear" ? { kind: "linear", count: 3, spacing: 50, direction: [1, 0, 0] } : { kind: "circular", count: 6, angle: 360, axis: "Z", center: [0, 0, 0] });
                }}
                className={cn("flex-1 rounded px-2 py-0.5 text-[11.5px]", pat.kind === k ? "bg-white shadow-sm" : "text-[#5b6776]")}
              >
                {k === "linear" ? tr("Lineární") : tr("Kruhové")}
              </button>
            ))}
          </div>
          {pat.kind === "linear" ? (
            <div className="space-y-2">
              <div className="grid grid-cols-2 gap-2">
                <Num label={tr("Počet")} value={pat.count} step={1} min={1} suffix="" onChange={(v) => setPat({ ...pat, count: Math.round(v) })} />
                <Num label={tr("Rozteč")} value={pat.spacing} onChange={(v) => setPat({ ...pat, spacing: v })} />
              </div>
              {/* stejné pole směru jako u formařských nástrojů: osa X / Y / Z, obrácení, vektor čísly; odkaz = plocha komponenty kliknutá v modelu
                  (obecné odkazy na hrany / dva body řeší jádro jen v dílu – v sestavě se plocha převezme jako vektor) */}
              <div data-pattern-direction>
                <DirVecField label={tr("Směr")} value={pat.direction} refs={false} attr="data-pattern-dir" onChange={(v) => setPat({ ...pat, direction: v })}>
                  <button type="button" data-pattern-dir="face" onClick={() => onMate("dir")} className={cn("w-full rounded border py-1.5 text-[12px]", dirPicking ? "border-brand bg-brand/10 text-brand" : "border-[#cfd6de] hover:bg-[#f3f6f9]")}>
                    {dirPicking ? tr("Klikněte na plochu v modelu…") : tr("Směr z plochy v modelu…")}
                  </button>
                  <p className="text-[10.5px] leading-snug text-[#8a95a3]">{tr("Rovinná plocha dá směr své normály, válcová směr své osy (plocha kterékoli komponenty).")}</p>
                </DirVecField>
              </div>
            </div>
          ) : (
            <div className="space-y-2">
              <div className="grid grid-cols-2 gap-2">
                <Num label={tr("Počet")} value={pat.count} step={1} min={1} suffix="" onChange={(v) => setPat({ ...pat, count: Math.round(v) })} />
                <Num label={tr("Úhel")} value={pat.angle} suffix="°" onChange={(v) => setPat({ ...pat, angle: v })} />
              </div>
              {/* osa kruhového pole: globální X / Y / Z nebo libovolný směr vektorem (stejné pole jako směr lineárního pole) */}
              <div data-pattern-axis>
                <DirVecField label={tr("Osa")} value={Array.isArray(pat.axis) ? pat.axis : AXIS_DIR[pat.axis]} refs={false} attr="data-pattern-axis-dir" onChange={(v) => setPat({ ...pat, axis: v })} />
              </div>
              <Vec label={tr("Střed osy")} value={pat.center} onChange={(v: Vec3) => setPat({ ...pat, center: v })} />
            </div>
          )}
          <button type="button" onClick={() => onPattern(pat)} className="mt-2 w-full rounded border border-[#cfd6de] py-1.5 text-[12px] hover:bg-[#f3f6f9]">
            {tr("Vytvořit pole (")}{pat.count}×)
          </button>
        </div>
      )}
      {onMirror && (
        <div>
          <p className="mb-1 text-[11px] font-medium uppercase tracking-wider text-ink-700/55">{tr("Zrcadlení komponenty")}</p>
          <div className="grid grid-cols-[1fr_1fr] gap-2">
            <div className="flex rounded-md bg-[#eef2f6] p-0.5">
              {(["XY", "XZ", "YZ"] as PlaneName[]).map((pl) => (
                <button key={pl} type="button" onClick={() => setMirrorPlane(pl)} className={cn("flex-1 rounded py-1 text-[11.5px]", mirrorPlane === pl ? "bg-white shadow-sm" : "text-[#5b6776]")}>
                  {pl}
                </button>
              ))}
            </div>
            <Num label={tr("Odsazení roviny")} value={mirrorOffset} onChange={setMirrorOffset} />
          </div>
          <button type="button" onClick={() => onMirror(mirrorPlane, mirrorOffset)} className="mt-2 w-full rounded border border-[#cfd6de] py-1.5 text-[12px] hover:bg-[#f3f6f9]">
            {tr("Zrcadlit komponentu")}
          </button>
          <p className="mt-1 text-[10.5px] leading-snug text-[#8a95a3]">{tr("Zrcadlí se poloha a natočení; geometrie dílu zůstává (přesné pro symetrické díly).")}</p>
        </div>
      )}
      {onBolt && (
        <div>
          <p className="mb-1 text-[11px] font-medium uppercase tracking-wider text-ink-700/55">{tr("Šroubový spoj do díry")}</p>
          <div className="flex gap-3 text-[12px]">
            <label className="flex items-center gap-1.5">
              <input type="checkbox" className="accent-[#E03930]" checked={bolt.washer} onChange={(e) => setBolt({ ...bolt, washer: e.target.checked })} /> {tr("Podložka")}
            </label>
            <label className="flex items-center gap-1.5">
              <input type="checkbox" className="accent-[#E03930]" checked={bolt.nut} onChange={(e) => setBolt({ ...bolt, nut: e.target.checked })} /> {tr("Matice")}
            </label>
          </div>
          <button type="button" onClick={() => onBolt(bolt)} className={cn("mt-2 w-full rounded border py-1.5 text-[12px]", bolting ? "border-brand bg-brand/10 text-brand" : "border-[#cfd6de] hover:bg-[#f3f6f9]")}>
            {bolting ? tr("Klikněte na válcovou plochu díry…") : tr("Vložit šroub ISO 4762 do díry…")}
          </button>
          <p className="mt-1 text-[10.5px] leading-snug text-[#8a95a3]">{tr("Závit podle průměru díry (ISO 273), délka podle sevřené tloušťky; hlava na straně kliknutí. Přidá se vazba Souosost.")}</p>
        </div>
      )}
      <label className="block">
        <span className="mb-1 block text-[11px] font-medium uppercase tracking-wider text-ink-700/55">{tr("Barva")}</span>
        <input type="color" value={c.color ?? "#b9c2cc"} onChange={(e) => onChange({ color: e.target.value })} className="h-8 w-full cursor-pointer rounded border border-[#cfd6de]" />
      </label>
      {c.source.kind === "file" && (
        <label className="block">
          <span className="mb-1 block text-[11px] font-medium uppercase tracking-wider text-ink-700/55">{tr("Materiál (kusovník)")}</span>
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
        {/* uvolnění zruší i vazbu Ukotvit (jinak by komponentu dál držel řešič vazeb) */}
        <input type="checkbox" checked={!!c.fixed || fixedByMate} onChange={(e) => (e.target.checked || !fixedByMate ? onChange({ fixed: e.target.checked }) : onDoc(releaseComponent(doc, c.id)))} className="accent-[#E03930]" />
        {tr("Ukotvená (nepohyblivá)")}
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
              <th className="px-2 py-1.5">{tr("Název")}</th>
              <th className="px-2 py-1.5">{tr("Číslo / norma")}</th>
              <th className="px-2 py-1.5 text-right">{tr("Ks")}</th>
              <th className="px-2 py-1.5">{tr("Materiál")}</th>
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
          {tr("Celkem")}{" "}{rows.reduce((s, r) => s + r.qty, 0)} {tr("ks ·")}{" "}{fmtNum(total, 2)} kg
        </span>
        <span className="flex-1" />
        <button type="button" onClick={onCsv} className="rounded border border-[#cfd6de] px-3 py-1.5 text-[12px] hover:bg-[#f3f6f9]">
          {tr("Export CSV (Excel)")}
        </button>
        {onDrawing && (
          <button type="button" onClick={onDrawing} className="rounded bg-brand px-3 py-1.5 text-[12px] font-semibold text-white hover:bg-brand-600">
            {tr("Výkres sestavy s kusovníkem")}
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
        <p className="mb-1 text-[11px] font-medium uppercase tracking-wider text-ink-700/55">{tr("Velikost rámu (šířka × délka)")}</p>
        <div className="flex flex-wrap gap-1">
          {sizes.map(([w, l]) => (
            <button key={`${w}x${l}`} type="button" onClick={() => setP({ ...p, width: w, length: l })} className={cn("rounded border px-2 py-1 font-mono text-[11.5px]", p.width === w && p.length === l ? "border-brand bg-brand/10" : "border-[#cfd6de] hover:bg-[#f3f6f9]")}>
              {w}×{l}
            </button>
          ))}
        </div>
      </div>
      <div className="grid grid-cols-2 gap-2.5">
        <Num label={tr("Šířka X")} value={p.width} onChange={(v) => set("width", v)} min={100} />
        <Num label={tr("Délka Y")} value={p.length} onChange={(v) => set("length", v)} min={100} />
        <Num label={tr("Deska A (pevná)")} value={p.aPlate} onChange={(v) => set("aPlate", v)} min={10} />
        <Num label={tr("Deska B (pohyblivá)")} value={p.bPlate} onChange={(v) => set("bPlate", v)} min={10} />
        <Num label={tr("Upínací desky")} value={p.clamp} onChange={(v) => set("clamp", v)} min={10} />
        <Num label={tr("Opěrná deska")} value={p.support} onChange={(v) => set("support", v)} min={10} />
        <Num label={tr("Výška rozpěrek")} value={p.spacer} onChange={(v) => set("spacer", v)} min={40} />
        <Num label={tr("Šířka rozpěrek")} value={p.spacerWidth} onChange={(v) => set("spacerWidth", v)} min={20} />
        <Num label={tr("Vyhazovací deska")} value={p.ejector} onChange={(v) => set("ejector", v)} min={8} />
        <Num label={tr("Kotevní deska")} value={p.retainer} onChange={(v) => set("retainer", v)} min={8} />
        <Num label={tr("Ø vodicích sloupků")} value={p.pillar} onChange={(v) => set("pillar", v)} min={10} />
      </div>
      <label className="flex items-center gap-2 text-[12.5px]">
        <input type="checkbox" checked={!!p.cavity} onChange={(e) => setP({ ...p, cavity: e.target.checked ? { w: Math.round(p.width * 0.45), l: Math.round(p.length * 0.5), depth: Math.round(p.aPlate * 0.5) } : null })} className="accent-[#E03930]" />
        {tr("Dutina v desce A (kapsa pro tvarovou vložku)")}
      </label>
      {p.cavity && (
        <div className="grid grid-cols-3 gap-2">
          <Num label={tr("Kapsa X")} value={p.cavity.w} onChange={(v) => setP({ ...p, cavity: { ...p.cavity!, w: v } })} />
          <Num label={tr("Kapsa Y")} value={p.cavity.l} onChange={(v) => setP({ ...p, cavity: { ...p.cavity!, l: v } })} />
          <Num label={tr("Hloubka")} value={p.cavity.depth} onChange={(v) => setP({ ...p, cavity: { ...p.cavity!, depth: v } })} />
        </div>
      )}
      <label className="block">
        <span className="mb-1 block text-[11px] font-medium uppercase tracking-wider text-ink-700/55">{tr("Materiál desek")}</span>
        <select value={p.material} onChange={(e) => setP({ ...p, material: e.target.value })} className="w-full rounded-lg border border-ink-700/12 bg-white px-2 py-1.5 text-[13px]">
          {MATERIALS.map((m) => (
            <option key={m.id} value={m.id}>
              {m.label}
            </option>
          ))}
        </select>
      </label>
      <p className="rounded bg-[#eef2f6] p-2.5 text-[11.5px] leading-relaxed text-[#4a5664]">
        {tr("Vytvoří kompletní dvoudeskový rám: upínací desky, tvarové desky A/B, opěrnou desku, rozpěrky, vyhazovací paket, 4 vodicí sloupky s pouzdry (jeden přesazený proti obrácené montáži), šrouby ISO 4762, vyhazovače a středicí kroužek. Výška formy")}{" "}
        <strong>{fmtNum(2 * p.clamp + p.spacer + p.support + p.aPlate + p.bPlate + 10, 0)} mm</strong>.
      </p>
      <button type="button" onClick={() => onCreate(p)} className="w-full rounded bg-brand py-2 text-[13px] font-semibold text-white hover:bg-brand-600">
        {tr("Vytvořit rám formy")}
      </button>
    </div>
  );
}
