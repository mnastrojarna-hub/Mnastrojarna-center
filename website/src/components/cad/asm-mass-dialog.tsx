"use client";

/**
 * Hmotnostní vlastnosti sestavy (Nástroje › Hmotnost v otevřené sestavě): hmotnost, objem, součet povrchů dílů, těžiště
 * a obálka – součet přes viditelné listové díly (i v podsestavách) s jejich materiály a umístěním (cad/asm-mass.ts).
 * Každý zdroj dílu změří jádro jednou (přesný objem a těžiště); seznam dílů je seřazený od nejtěžšího.
 */
import { tr } from "@/cad/i18n";
import { useEffect, useMemo, useState } from "react";
import { asmMassProps, type MassLeaf, type PartMass } from "@/cad/asm-mass";
import { cad } from "@/cad/client";
import type { AsmComponent } from "@/cad/types";
import { MATERIALS, fmtNum } from "@/lib/mesh-metrics";
import type { Leaf } from "./asm-flatten";
import { Modal, Row } from "./ui";

type MassLeafIn = MassLeaf & { source: AsmComponent["source"] };
const IDENT = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];

/** materiál listového dílu: třída materiálu dílu (u importovaného modelu volba v panelu komponenty) – hustota a popisek */
function leafOf(l: Leaf): MassLeafIn {
  const c = l.comp;
  const id = c.source.kind === "part" ? c.source.doc.material : (c.material ?? "ocel");
  const m = MATERIALS.find((x) => x.id === id);
  const label = c.source.kind === "part" && c.source.doc.materialName?.trim() ? c.source.doc.materialName.trim() : (m?.label ?? id).split(" – ")[0];
  return { id: l.id, name: l.path.join(" / "), key: l.key, matrix: l.matrix, density: m?.density ?? 7.85, material: label, source: c.source };
}

/** díl změřený jádrem ve vlastních souřadnicích (přesný objem, povrch, těžiště, obálka) */
const measurePart = async (key: string, source: AsmComponent["source"]): Promise<PartMass | null> => {
  const r = await cad.measure({ kind: "body", src: { kind: "comp", key, matrix: IDENT }, label: key }, { sources: [{ key, source }] });
  return r.kind === "body" ? { volume: r.body.volume, area: r.body.area, com: r.body.com, bbox: r.body.bbox } : null;
};

export function AsmMassDialog({ name, leaves: all, onClose, measure = measurePart }: { name: string; leaves: Leaf[]; onClose: () => void; measure?: (key: string, source: AsmComponent["source"]) => Promise<PartMass | null> }) {
  const leaves = useMemo(() => all.filter((l) => !l.hidden).map(leafOf), [all]);
  const hidden = all.length - leaves.length;
  const [parts, setParts] = useState<Map<string, PartMass | null>>(new Map());
  const [done, setDone] = useState(0);
  const sources = useMemo(() => {
    const m = new Map<string, AsmComponent["source"]>();
    for (const l of leaves) if (!m.has(l.key)) m.set(l.key, l.source);
    return m;
  }, [leaves]);
  useEffect(() => {
    let live = true;
    void (async () => {
      const out = new Map<string, PartMass | null>();
      let n = 0;
      for (const [key, src] of sources) {
        out.set(key, await measure(key, src).catch(() => null));
        if (!live) return;
        setDone(++n);
      }
      if (live) setParts(out);
    })();
    return () => {
      live = false;
    };
    // měří se jen při otevření a při změně složení sestavy (zdroje dílů), ne při každém vykreslení
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sources]);
  const ready = sources.size > 0 && [...sources.keys()].every((k) => parts.has(k));
  const res = useMemo(() => (ready ? asmMassProps(leaves, parts) : null), [ready, leaves, parts]);
  const v3 = (v: number[]) => v.map((x) => fmtNum(x, 2)).join(" ; ");
  return (
    <Modal title={tr("Hmotnostní vlastnosti sestavy – {0}", name)} icon="mass" onClose={onClose}>
      <div data-asm-mass={res ? "ready" : "busy"} data-mass-kg={res?.massKg} data-cog={res?.cog?.join(";")}>
        {!res ? (
          <p className="text-[12.5px] text-[#5b6776]">{sources.size ? tr("Měřím díly sestavy… {0} / {1}", done, sources.size) : tr("Sestava nemá žádný viditelný díl.")}</p>
        ) : (
          <>
            <Row k={tr("Hmotnost")} v={`${fmtNum(res.massKg, 4)} kg`} strong />
            <Row k={tr("Objem")} v={`${fmtNum(res.volume, 2)} mm³ (${fmtNum(res.volume / 1000, 3)} cm³)`} />
            <Row k={tr("Povrch dílů (součet)")} v={`${fmtNum(res.area, 2)} mm²`} />
            <Row k={tr("Těžiště X ; Y ; Z")} v={res.cog ? `${v3(res.cog)} mm` : "–"} />
            {res.bbox && <Row k={tr("Rozměry (X × Y × Z)")} v={`${fmtNum(res.bbox[1][0] - res.bbox[0][0], 2)} × ${fmtNum(res.bbox[1][1] - res.bbox[0][1], 2)} × ${fmtNum(res.bbox[1][2] - res.bbox[0][2], 2)} mm`} />}
            <Row k={tr("Dílů")} v={hidden ? tr("{0} (skryté nezapočteny: {1})", res.rows.length, hidden) : String(res.rows.length)} />
            {res.missing.length > 0 && <p className="mt-2 rounded bg-amber-500/15 px-2 py-1 text-[11.5px] text-amber-800">{tr("Nezměřeno (není v součtu): {0}", res.missing.join(", "))}</p>}
            <table className="mt-3 w-full text-[11.5px]">
              <thead>
                <tr className="text-left text-[10px] uppercase tracking-wider text-[#6b7785]">
                  <th className="py-1 font-semibold">{tr("Díl")}</th>
                  <th className="py-1 font-semibold">{tr("Materiál")}</th>
                  <th className="py-1 text-right font-semibold">{tr("kg")}</th>
                </tr>
              </thead>
              <tbody>
                {res.rows.map((r) => (
                  <tr key={r.id} data-mass-row={r.name} className="border-t border-[#edf1f5]">
                    <td className="max-w-[220px] truncate py-0.5 pr-2">{r.name}</td>
                    <td className="py-0.5 pr-2 text-[#5b6776]">{tr("{0} ({1} g/cm³)", r.material, r.density)}</td>
                    <td className="py-0.5 text-right font-mono">{fmtNum(r.massKg, 4)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <p className="mt-2 text-[10.5px] leading-snug text-[#8a95a3]">{tr("Materiál dílu se mění v dílu (Upravit díl), u importovaného modelu v panelu komponenty. Těžiště je v souřadnicích sestavy.")}</p>
          </>
        )}
      </div>
    </Modal>
  );
}
