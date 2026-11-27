"use client";

/**
 * Oprava ztracené reference vazby v aplikaci (vlna 22, bod 20): po úpravě dílu v kontextu sestavy může plocha, na kterou vazba
 * ukazovala, zmizet nebo být nejednoznačná (cad/mate-remap.ts). Vazba je pak mimo řešení a v seznamu vazeb červeně; tlačítko
 * „Vybrat plochu znovu“ zapne výběr: klik na plochu komponenty v modelu (i v softwarovém zobrazení bez WebGL), nebo výběr ze
 * seznamu ploch komponenty (`data-repick-face`). Totéž textem: `sestava vazba N plocha b F6`.
 * Ztracená HRANA / VRCHOL (fáze 2, kolo 4): „Vybrat hranu znovu“ / „Vybrat vrchol znovu“ – klik na hranu / vrchol téhož dílu
 * v modelu, nebo výběr ze seznamu hran / vrcholů dílu (`data-repick-ent`, popis jako otisk ztracené reference) = text
 * `sestava vazba N plocha a E3`.
 * Ztracená DOSEDACÍ PLOCHA PRUŽINY (kolo 7): „Vybrat dosedací plochu znovu“ – klik na plochu téže komponenty v modelu nebo výběr
 * ze seznamu ploch; zapíše se stejným textovým příkazem jako ručně (`sestava pružina "P" mezi "Deska A" F6 "Přidržovač" F5`),
 * takže kontrola plochy (rovinná, kolmá k ose) a protokol jsou tytéž.
 */
import { useEffect, useState } from "react";
import { faceShort, type CompFaceRow } from "@/cad/agent-asm";
import { compArgText } from "@/cad/spring-lost";
import type { CompEntRow } from "@/cad/asm-agent";
import { entKey } from "@/cad/mate-geo";
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
  /** hrany / vrcholy listového dílu (ztracená reference hrany / vrcholu) */
  entRows: (leaf: string, ent: "edge" | "vertex") => Promise<CompEntRow[]>;
  /** geometrie hrany / vrcholu dílu (`klíč dílu`, index) */
  entInfo: (key: string, index: number, ent: "edge" | "vertex") => Promise<MateFaceInfo | null>;
  /** geometrie ploch vazeb (mezipaměť aplikace, `klíč:index`) */
  geo: Map<string, MateFaceInfo>;
  /** zapíše opravenou sestavu a přepočítá vazby */
  apply: (d: CadDoc) => void;
  /** textový příkaz přes agenta (nová dosedací plocha pružiny – stejná cesta jako `sestava pružina … mezi …`) */
  run?: (text: string) => Promise<string>;
  flash: (t: string) => void;
}) {
  /** `mate` = id vazby, nebo `spring:<id komponenty pružiny>` (dosedací plocha pružiny, strana a / b) */
  const [active, setActive] = useState<{ mate: string; side: Side } | null>(null);
  const [rows, setRows] = useState<CompFaceRow[] | null>(null);
  const [ents, setEnts] = useState<CompEntRow[] | null>(null);
  const springId = active?.mate.startsWith("spring:") ? active.mate.slice(7) : null;
  const springComp = springId ? o.doc.components?.find((c) => c.id === springId && c.spring) : undefined;
  const mate = active && !springId ? o.doc.mates?.find((m) => m.id === active.mate) : undefined;
  const old: MateRef | undefined = active && mate ? mate[active.side] : springComp && (active?.side === "a" || active?.side === "b") ? springComp.spring![active.side] : undefined;
  /** co se vybírá: plocha, nebo (ztracená hrana / vrchol) táž entita jako původní reference */
  const want: "face" | "edge" | "vertex" = old?.ent ?? "face";
  const compName = (id?: string) => o.doc.components?.find((c) => c.id === id)?.name ?? "?";
  // vazba zmizela (smazána, krok zpět, jiná záložka) → výběr končí
  useEffect(() => {
    if (active && !old) setActive(null);
  }, [active, old]);
  // seznam ploch komponenty (alternativa ke kliknutí do modelu – funguje i bez WebGL)
  useEffect(() => {
    let live = true;
    setRows(null);
    setEnts(null);
    if (old?.ent) void o.entRows(old.leaf ?? old.compId, old.ent).then((r) => live && setEnts(r)).catch(() => live && setEnts([]));
    else if (old) void o.faceRows(old.compId).then((r) => live && setRows(r)).catch(() => live && setRows([]));
    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [old?.compId, active?.mate]);
  const need = old?.lost ? (old.lost.kind === "cylinder" || old.lost.kind === "cone" ? "cylinder" : old.lost.kind === "plane" ? "plane" : null) : null;
  /** výběr nové dosedací plochy pružiny (komponenta pružiny `id`, ztracená strana) */
  const startSpring = (id: string, side: "a" | "b") => {
    const key = `spring:${id}`;
    if (active?.mate === key) return setActive(null);
    const c = o.doc.components?.find((x) => x.id === id && x.spring);
    if (!c?.spring) return;
    setActive({ mate: key, side });
    o.flash(tr("Klikněte na dosedací plochu komponenty „{0}“ (nebo ji vyberte ze seznamu ploch) – nahradí ztracenou dosedací plochu pružiny „{1}“.", compName(c.spring[side].compId), c.name));
  };
  const start = (mateId: string, side: Side) => {
    if (active?.mate === mateId) return setActive(null);
    const m = o.doc.mates?.find((x) => x.id === mateId);
    if (!m?.[side]) return;
    setActive({ mate: mateId, side });
    const ent = m[side]!.ent;
    o.flash(
      ent === "edge"
        ? tr("Klikněte na hranu komponenty „{0}“ (nebo ji vyberte ze seznamu hran) – nahradí ztracenou hranu vazby.", compName(m[side]!.compId))
        : ent === "vertex"
          ? tr("Klikněte na vrchol komponenty „{0}“ (nebo ho vyberte ze seznamu vrcholů) – nahradí ztracený vrchol vazby.", compName(m[side]!.compId))
          : tr("Klikněte na plochu komponenty „{0}“ (nebo ji vyberte ze seznamu ploch) – nahradí ztracenou plochu vazby.", compName(m[side]!.compId)),
    );
  };
  /** nová hrana / vrchol strany vazby: jen týž díl jako původní reference (jako text `sestava vazba N plocha a E3`) */
  const chooseEnt = async (leafId: string, index: number, ent: "edge" | "vertex") => {
    if (!active || !mate || !old?.ent || index < 0) return;
    if (ent !== old.ent) return o.flash(old.ent === "edge" ? tr("Ztracená reference byla hrana – vyberte hranu.") : tr("Ztracená reference byl vrchol – vyberte vrchol."));
    const leaf = o.leaves.find((l) => l.id === leafId);
    if (!leaf) return;
    if (leaf.id !== (old.leaf ?? old.compId)) return o.flash(tr("Vyberte hranu / vrchol dílu „{0}“ – na tento díl vazba ukazovala.", compName(old.compId)));
    const info = await o.entInfo(leaf.key, index, ent).catch(() => null);
    if (!info) return o.flash(tr("Hranu / vrchol se nepodařilo načíst."));
    o.geo.set(entKey(leaf.key, { face: index, ent }), info);
    const ref: MateRef = { compId: leaf.topId, ...(leaf.id !== leaf.topId ? { leaf: leaf.id } : {}), face: index, ent };
    const next: CadDoc = { ...o.doc, mates: (o.doc.mates ?? []).map((m) => (m.id === mate.id ? { ...m, [active.side]: ref } : m)) };
    setActive(null);
    o.apply(next);
    o.flash(ent === "edge" ? tr("Hrana vazby vybrána znovu (E{0}) – vazba se zase řeší.", index + 1) : tr("Vrchol vazby vybrán znovu (V{0}) – vazba se zase řeší.", index + 1));
  };
  /** nová dosedací plocha pružiny: tentýž textový příkaz jako ručně (kontrola plochy a protokol jako text) */
  const chooseSeat = async (leafId: string, face: number) => {
    if (!active || !springComp?.spring || !old || face < 0) return;
    const leaf = o.leaves.find((l) => l.id === leafId);
    if (!leaf) return;
    if (leaf.topId !== old.compId) return o.flash(tr("Vyberte plochu komponenty „{0}“ – na ni pružina dosedá.", compName(old.compId)));
    const s = springComp.spring;
    const sideArg = (k: "a" | "b") => `${compArgText(o.doc, s[k].compId)} F${(k === active.side ? face : s[k].face) + 1}`;
    const text = `sestava pružina ${compArgText(o.doc, springComp.id)} mezi ${sideArg("a")} ${sideArg("b")}`;
    setActive(null);
    if (!o.run) return o.flash(text);
    const out = await o.run(text).catch((e: unknown) => (e instanceof Error ? e.message : String(e)));
    const bad = out.split("\n").find((l) => l.startsWith("✗"));
    o.flash(bad ?? tr("Dosedací plocha pružiny vybrána znovu (F{0}) – {1}", face + 1, text));
  };
  /** nová plocha strany vazby: `leafId` = list (díl), `face` = index plochy v dílu */
  const choose = async (leafId: string, face: number) => {
    if (springId) return chooseSeat(leafId, face);
    if (!active || !mate || !old || face < 0) return;
    if (old.ent) return o.flash(old.ent === "edge" ? tr("Ztracená reference byla hrana – vyberte hranu.") : tr("Ztracená reference byl vrchol – vyberte vrchol."));
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
        <p className="mb-1 font-semibold">{springComp ? tr("Nová dosedací plocha pružiny „{0}“ – komponenta „{1}“", springComp.name, compName(old.compId)) : want === "edge" ? tr("Nová hrana vazby – komponenta „{0}“", compName(old.compId)) : want === "vertex" ? tr("Nový vrchol vazby – komponenta „{0}“", compName(old.compId)) : tr("Nová plocha vazby – komponenta „{0}“", compName(old.compId))}</p>
        {old.ent ? (
          <>
            <p className="mb-1.5">{want === "edge" ? tr("Klikněte na hranu v modelu, nebo ji vyberte ze seznamu (souřadnice dílu):") : tr("Klikněte na vrchol v modelu, nebo ho vyberte ze seznamu (souřadnice dílu):")}</p>
            <select
              data-repick-ent={want}
              className="mb-1.5 w-full rounded border border-[#d5dbe2] bg-white px-1 py-0.5 text-[11.5px] text-[#1f2933]"
              value=""
              onChange={(e) => {
                const [leafId, i] = e.target.value.split("|");
                if (leafId) void chooseEnt(leafId, Number(i), want as "edge" | "vertex");
              }}
            >
              <option value="">{ents ? (want === "edge" ? tr("— hrana ({0}) —", ents.length) : tr("— vrchol ({0}) —", ents.length)) : want === "edge" ? tr("načítám hrany…") : tr("načítám vrcholy…")}</option>
              {(ents ?? []).map((r) => (
                <option key={`${r.leafId}|${r.index}`} value={`${r.leafId}|${r.index}`}>
                  {r.text}
                </option>
              ))}
            </select>
          </>
        ) : (
          <>
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
          </>
        )}
        <button type="button" data-repick-cancel onClick={() => setActive(null)} className="rounded border border-[#d5dbe2] bg-white px-2 py-0.5 text-[11px] text-[#4a5664] hover:bg-[#f3f6f9]">
          {tr("Zrušit výběr")}
        </button>
      </div>
    ) : null;
  return { active, want: active ? want : null, start, startSpring, choose, chooseEnt, cancel: () => setActive(null), panel };
}
