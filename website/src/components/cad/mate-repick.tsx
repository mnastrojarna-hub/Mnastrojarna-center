"use client";

/**
 * Oprava ztracené reference vazby v aplikaci (vlna 22, bod 20): po úpravě dílu v kontextu sestavy může plocha, na kterou vazba
 * ukazovala, zmizet nebo být nejednoznačná (cad/mate-remap.ts). Vazba je pak mimo řešení a v seznamu vazeb červeně; tlačítko
 * „Vybrat plochu znovu“ zapne výběr: klik na plochu komponenty v modelu (i v softwarovém zobrazení bez WebGL), nebo výběr ze
 * seznamu ploch komponenty (`data-repick-face`). Totéž textem: `sestava vazba N plocha b F6`.
 */
import { useEffect, useState } from "react";
import { faceShort, type CompFaceRow } from "@/cad/agent-asm";
import type { MateFaceInfo } from "@/cad/asm-kernel";
import { tr } from "@/cad/i18n";
import type { CadDoc, MateRef } from "@/cad/types";
import type { Leaf } from "./asm-flatten";

type Side = "a" | "b" | "c" | "d";

export function useMateRepick(o: {
  doc: CadDoc;
  leaves: Leaf[];
  faceInfo: (key: string, face: number) => Promise<MateFaceInfo | null>;
  faceRows: (compId: string) => Promise<CompFaceRow[]>;
  /** geometrie ploch vazeb (mezipaměť aplikace, `klíč:index`) */
  geo: Map<string, MateFaceInfo>;
  /** zapíše opravenou sestavu a přepočítá vazby */
  apply: (d: CadDoc) => void;
  flash: (t: string) => void;
}) {
  const [active, setActive] = useState<{ mate: string; side: Side } | null>(null);
  const [rows, setRows] = useState<CompFaceRow[] | null>(null);
  const mate = active ? o.doc.mates?.find((m) => m.id === active.mate) : undefined;
  const old: MateRef | undefined = active && mate ? mate[active.side] : undefined;
  const compName = (id?: string) => o.doc.components?.find((c) => c.id === id)?.name ?? "?";
  // vazba zmizela (smazána, krok zpět, jiná záložka) → výběr končí
  useEffect(() => {
    if (active && !old) setActive(null);
  }, [active, old]);
  // seznam ploch komponenty (alternativa ke kliknutí do modelu – funguje i bez WebGL)
  useEffect(() => {
    let live = true;
    setRows(null);
    if (old) void o.faceRows(old.compId).then((r) => live && setRows(r)).catch(() => live && setRows([]));
    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [old?.compId, active?.mate]);
  const need = old?.lost ? (old.lost.kind === "cylinder" || old.lost.kind === "cone" ? "cylinder" : old.lost.kind === "plane" ? "plane" : null) : null;
  const start = (mateId: string, side: Side) => {
    if (active?.mate === mateId) return setActive(null);
    const m = o.doc.mates?.find((x) => x.id === mateId);
    if (!m?.[side]) return;
    setActive({ mate: mateId, side });
    o.flash(tr("Klikněte na plochu komponenty „{0}“ (nebo ji vyberte ze seznamu ploch) – nahradí ztracenou plochu vazby.", compName(m[side]!.compId)));
  };
  /** nová plocha strany vazby: `leafId` = list (díl), `face` = index plochy v dílu */
  const choose = async (leafId: string, face: number) => {
    if (!active || !mate || !old || face < 0) return;
    const leaf = o.leaves.find((l) => l.id === leafId);
    if (!leaf) return;
    if (leaf.topId !== old.compId) return o.flash(tr("Vyberte plochu komponenty „{0}“ – tuto komponentu vazba spojuje.", compName(old.compId)));
    const info = await o.faceInfo(leaf.key, face).catch(() => null);
    if (!info) return o.flash(tr("Plochu se nepodařilo načíst."));
    if (need && info.kind !== need) return o.flash(need === "cylinder" ? tr("Ztracená plocha byla válcová – vyberte válcovou plochu.") : tr("Ztracená plocha byla rovinná – vyberte rovinnou plochu."));
    o.geo.set(`${leaf.key}:${face}`, info);
    const ref: MateRef = { compId: leaf.topId, ...(leaf.id !== leaf.topId ? { leaf: leaf.id } : {}), face };
    const next: CadDoc = { ...o.doc, mates: (o.doc.mates ?? []).map((m) => (m.id === mate.id ? { ...m, [active.side]: ref } : m)) };
    setActive(null);
    o.apply(next);
    o.flash(tr("Plocha vazby vybrána znovu (F{0}) – vazba se zase řeší.", face + 1));
  };
  const panel =
    active && old ? (
      <div data-repick-panel={active.mate} className="mx-2 mb-2 rounded border border-[#f3c4c0] bg-[#fef3f2] p-2 text-[11.5px] leading-snug text-[#912018]">
        <p className="mb-1 font-semibold">{tr("Nová plocha vazby – komponenta „{0}“", compName(old.compId))}</p>
        <p className="mb-1.5">{tr("Klikněte na plochu v modelu, nebo ji vyberte ze seznamu:")}</p>
        <select
          data-repick-face
          className="mb-1.5 w-full rounded border border-[#d5dbe2] bg-white px-1 py-0.5 text-[11.5px] text-[#1f2933]"
          value=""
          onChange={(e) => {
            const [leafId, f] = e.target.value.split("|");
            if (leafId) void choose(leafId, Number(f));
          }}
        >
          <option value="">{rows ? tr("— plocha ({0}) —", rows.filter((r) => !need || r.kind === need).length) : tr("načítám plochy…")}</option>
          {(rows ?? [])
            .filter((r) => !need || r.kind === need)
            .map((r) => (
              <option key={`${r.leafId}|${r.face}`} value={`${r.leafId}|${r.face}`}>
                {faceShort(r)}
              </option>
            ))}
        </select>
        <button type="button" data-repick-cancel onClick={() => setActive(null)} className="rounded border border-[#d5dbe2] bg-white px-2 py-0.5 text-[11px] text-[#4a5664] hover:bg-[#f3f6f9]">
          {tr("Zrušit výběr")}
        </button>
      </div>
    ) : null;
  return { active, start, choose, cancel: () => setActive(null), panel };
}
