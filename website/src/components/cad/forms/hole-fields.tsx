"use client";
/**
 * Formulář díry – volby 12. vlny, stejné jako v textu (`díra … jádro | vrták | vrták 6,7 | dno ploché | hrot 120`, agent-hole.ts):
 * vrták závitové díry (tabulkový / jádro D1 podle ISO 965-1 / vlastní průměr) a dno slepé díry (kužel vrtáku s úhlem / ploché).
 */
import { tr } from "@/cad/i18n";
import type { MetricThread } from "@/cad/defaults";
import { DEFAULT_TIP, FLAT_TIP, holeTip, isFlatBottom, tapDrillD, threadChangePatch, threadMinorD, type TapDrill } from "@/cad/hole-spec";
import type { Feature } from "@/cad/types";
import { Info, Num, Seg } from "../props";

type HoleF = Extract<Feature, { type: "hole" }>;
type Set = (patch: Record<string, unknown>) => void;
const fmtMm = (n: number) => String(Math.round(n * 1000) / 1000).replace(".", ",");

/** Změna závitu ve formuláři – stejná pravidla jako text a upravit (hole-spec.ts). */
export const threadPatch = threadChangePatch;

/** Vrták závitové díry: tabulkový (M8 → 6,8), jádro D1 (6,647), nebo vlastní průměr. */
export function TapDrillField({ f, t, set, b }: { f: HoleF; t: MetricThread; set: Set; b: (p: string) => string }) {
  const mode: TapDrill = f.tapDrill ?? "table";
  const D1 = threadMinorD(t);
  const drill = tapDrillD(t, mode, f.diameter);
  const pick = (m: TapDrill) => set(m === "table" ? { tapDrill: undefined, diameter: t.tap } : m === "minor" ? { tapDrill: "minor", diameter: D1 } : { tapDrill: "custom", diameter: drill });
  const how = mode === "minor" ? tr("jádro D1 podle ISO 965-1 (D − 1,0825·P)") : mode === "custom" ? tr("zadaný průměr") : tr("tabulkový vrták");
  return (
    <>
      <Seg
        label={tr("Vrták pro závit")}
        value={mode}
        options={[
          { v: "table", l: tr("Tabulkový Ø{0}", fmtMm(t.tap)) },
          { v: "minor", l: tr("Jádro D1 Ø{0}", fmtMm(D1)) },
          { v: "custom", l: tr("Vlastní") },
        ]}
        onChange={pick}
      />
      {mode === "custom" && <Num label={tr("Průměr vrtáku")} value={f.diameter} min={0.01} step={0.01} bind={b("diameter")} onChange={(v) => set({ diameter: v })} />}
      {mode === "custom" && f.diameter >= t.d && <span className="block text-[11px] text-brand-600">{tr("Vrták musí být menší než závit {0} (Ø{1}).", t.name, fmtMm(t.d))}</span>}
      <Info>{tr("Vrtá se Ø{0} mm – {1}; závit {2} se uvede ve výkrese.", fmtMm(drill), mode === "custom" ? tr("{0} (tabulkový {1})", how, fmtMm(t.tap)) : how, t.name)}</Info>
    </>
  );
}

/** Dno slepé díry: kužel hrotu vrtáku (úhel, výchozí 118°) nebo ploché (tipAngle 180). */
export function HoleBottomField({ f, set, b }: { f: HoleF; set: Set; b: (p: string) => string }) {
  const flat = isFlatBottom(f);
  return (
    <>
      <Seg
        label={tr("Dno díry")}
        value={flat ? "flat" : "cone"}
        options={[
          { v: "cone", l: tr("Kužel vrtáku") },
          { v: "flat", l: tr("Ploché") },
        ]}
        onChange={(v) => set({ tipAngle: v === "flat" ? FLAT_TIP : undefined })}
      />
      {!flat && <Num label={tr("Úhel špičky vrtáku")} value={holeTip(f) ?? DEFAULT_TIP} min={60} suffix="°" bind={b("tipAngle")} onChange={(v) => set({ tipAngle: Math.min(170, Math.max(60, v)) })} />}
    </>
  );
}
