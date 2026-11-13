"use client";

/**
 * Ovládání řezu modelem (obsah panelu „Řez modelem“): rovina kolmá na X / Y / Z, rovina vybrané rovinné plochy
 * nebo rovina zadaná normálou „nx; ny; nz“; poloha posuvníkem i číslem (mm, lze i výrazem), otočení strany.
 * Stav řezu drží aplikace (`section` / `onChange`), matematika roviny je v `@/cad/section-plane`.
 */
import { tr } from "@/cad/i18n";
import { useEffect, useMemo, useState } from "react";
import { axisSection, facePlane, faceSection, formatPos, formatVector, isGeneralSection, parseFaceNo, parseVector, projectionRange, sectionNormal, sectionOrigin, sectionPlane, toVectorSection, unitVec, vectorSection, type PlaneMesh, type SectionAxis, type SectionState } from "@/cad/section-plane";
import type { MeshData, Vec3 } from "@/cad/types";
import { cn } from "@/lib/cn";
import { Num } from "./props";
import type { SelItem } from "./selection";
import { useSoftViewActive } from "./soft-bridge";
import { Row } from "./ui";
import type { AsmView } from "./viewport";

type Mode = SectionAxis | "face" | "vector";
type FaceSel = Extract<SelItem, { kind: "face" }>;

/** Sítě modelu pro rozsah a rovinu řezu: komponenty sestavy (po umístění), jinak síť dílu. */
export function sectionItems(mesh: MeshData | null, assembly?: AsmView[]): PlaneMesh[] {
  if (assembly) return assembly.map((c) => ({ vertices: c.mesh.vertices, triangles: c.mesh.triangles, faceGroups: c.mesh.faceGroups, matrix: c.matrix }));
  return mesh ? [mesh] : [];
}

/** Řez po zapnutí (klávesa X, pás karet): rovina kolmá na Y uprostřed modelu – dílu i sestavy. */
export const defaultSection = (mesh: MeshData | null, assembly?: AsmView[]): SectionState => axisSection("Y", sectionItems(mesh, assembly));

export function SectionControls({
  section,
  onChange,
  mesh,
  assembly,
  selection,
}: {
  section: SectionState;
  onChange: (s: SectionState) => void;
  /** síť dílu (rozsah posuvníku, rovina plochy) */
  mesh: MeshData | null;
  /** komponenty sestavy – jsou-li zadány, platí místo `mesh` */
  assembly?: AsmView[];
  /** aktuální výběr ve 3D okně – rovinná plocha z něj určí rovinu řezu */
  selection?: SelItem[];
}) {
  const items = useMemo(() => sectionItems(mesh, assembly), [mesh, assembly]);
  /** náhled bez WebGL: plochy nejde vybrat kliknutím */
  const soft = useSoftViewActive();
  const general = isGeneralSection(section);
  const mode: Mode = !general ? section.axis : section.source?.kind === "face" ? "face" : "vector";
  /** záložka „Plocha“ je otevřená, ale rovina ještě není určená (čeká se na výběr rovinné plochy) */
  const [waitFace, setWaitFace] = useState(false);
  const tab: Mode = waitFace ? "face" : mode;
  const [faceNo, setFaceNo] = useState("");
  const [faceErr, setFaceErr] = useState<string | null>(null);

  // vybraná plocha (poslední ve výběru) a její rovina; u sestavy plocha komponenty po umístění
  const picked = useMemo(() => {
    const f = [...(selection ?? [])].reverse().find((s): s is FaceSel => s.kind === "face");
    if (!f) return null;
    const comp = assembly ? assembly.find((c) => c.id === f.compId) : null;
    const src: PlaneMesh | null = assembly ? (comp ? { vertices: comp.mesh.vertices, triangles: comp.mesh.triangles, faceGroups: comp.mesh.faceGroups, matrix: comp.matrix } : null) : mesh;
    return { index: f.index, compId: f.compId, plane: src ? facePlane(src, f.index) : null };
  }, [selection, mesh, assembly]);
  const faceCount = useMemo(() => {
    if (assembly || !mesh) return 0;
    let n = 0;
    for (let g = 2; g < mesh.faceGroups.length; g += 3) if (mesh.faceGroups[g] + 1 > n) n = mesh.faceGroups[g] + 1;
    return n;
  }, [mesh, assembly]);

  const applyFace = (plane: { origin: Vec3; normal: Vec3 }, index: number, compId?: string) => {
    setWaitFace(false);
    setFaceErr(null);
    onChange(faceSection(section, plane, index, compId));
  };
  // záložka „Plocha“ bez určené roviny: první vybraná rovinná plocha rovinu nastaví sama
  useEffect(() => {
    if (waitFace && picked?.plane) applyFace(picked.plane, picked.index, picked.compId);
  }, [waitFace, picked]); // eslint-disable-line react-hooks/exhaustive-deps

  const pickTab = (m: Mode) => {
    setFaceErr(null);
    if (m === "face") {
      if (picked?.plane) return applyFace(picked.plane, picked.index, picked.compId);
      if (mode !== "face") setWaitFace(true);
      return;
    }
    setWaitFace(false);
    if (m === "vector") {
      if (mode !== "vector") onChange(toVectorSection(section));
      return;
    }
    onChange(axisSection(m, items, general ? false : section.flip));
  };
  const applyFaceNumber = () => {
    const n = parseFaceNo(faceNo);
    if (!mesh || !Number.isFinite(n) || n < 1 || n > faceCount) return setFaceErr(tr("Zadejte číslo plochy 1–{0}.", faceCount));
    const plane = facePlane(mesh, n - 1);
    if (!plane) return setFaceErr(tr("Plocha {0} není rovinná – řez lze vést jen rovinnou plochou.", n));
    applyFace(plane, n - 1);
  };

  // normála zadaná vektorem
  const normalText = general ? formatVector(section.normal as Vec3) : "";
  const [vecText, setVecText] = useState(normalText);
  const [vecErr, setVecErr] = useState<string | null>(null);
  useEffect(() => {
    setVecText(normalText);
    setVecErr(null);
  }, [normalText]);
  const commitVector = (t: string) => {
    if (!t.trim()) {
      setVecText(normalText);
      return setVecErr(null);
    }
    try {
      const v = parseVector(t);
      setVecErr(null);
      const a = unitVec(v)!;
      const b = sectionNormal(section);
      const same = Math.abs(a[0] - b[0]) + Math.abs(a[1] - b[1]) + Math.abs(a[2] - b[2]) < 1e-9;
      // stejný směr (jen jiná délka): poloha zůstává; jiný směr: rovina se vrátí do středu modelu
      onChange(same && mode === "vector" ? { ...section, normal: v } : vectorSection(section, v, items));
      setVecText(formatVector(v));
    } catch (x) {
      setVecErr((x as Error).message);
    }
  };

  const n = sectionNormal(section);
  const range = useMemo(() => projectionRange(items, sectionNormal(section), sectionOrigin(section)), [items, section.axis, section.normal?.join(), section.origin?.join()]); // eslint-disable-line react-hooks/exhaustive-deps
  const pl = sectionPlane(section);
  const tabBtn = (m: Mode, label: string, title: string, wide = false) => (
    <button key={m} type="button" role="tab" aria-selected={tab === m} data-section-tab={m} title={title} onClick={() => pickTab(m)} className={cn("rounded py-1 text-[12px] font-semibold", wide ? "px-2" : "flex-1", tab === m ? "bg-[#1f2933] text-white" : "bg-[#eef2f6] hover:bg-[#e3e9f0]")}>
      {label}
    </button>
  );
  const small = "rounded border border-[#cfd6de] bg-white px-2 py-1 text-[11.5px] hover:bg-[#f3f6f9] disabled:opacity-40";
  const hint = "text-[11px] leading-relaxed text-[#6b7785]";

  return (
    <div data-section-controls data-section-mode={tab} data-section-plane={[...pl.normal, pl.constant].map((v) => Math.round(v * 1e4) / 1e4).join(" ")}>
      <div className="mb-2 flex gap-1" role="tablist" aria-label={tr("Rovina řezu")}>
        {(["X", "Y", "Z"] as const).map((a) => tabBtn(a, a, tr("Rovina kolmá na osu {0}", a)))}
        {tabBtn("face", tr("Plocha"), tr("Rovina vybrané rovinné plochy tělesa"), true)}
        {tabBtn("vector", tr("Vektor"), tr("Obecná rovina zadaná normálou nx; ny; nz"), true)}
      </div>

      {tab === "face" && (
        <div className="mb-2 space-y-1.5">
          {waitFace ? (
            <p data-section-wait className={hint}>
              {picked && !picked.plane
                ? tr("Vybraná plocha není rovinná. Vyberte rovinnou plochu tělesa – rovina řezu se na ni položí.")
                : soft && assembly
                  ? tr("V náhledu bez WebGL nejde plochu sestavy vybrat kliknutím. Rovinu zadejte na záložce Vektor (normála) nebo X / Y / Z.")
                  : soft
                    ? tr("V náhledu bez WebGL nejde plochu vybrat kliknutím. Zadejte číslo rovinné plochy (např. F3) – rovina řezu se na ni položí.")
                    : tr("Vyberte rovinnou plochu tělesa (kliknutím ve 3D okně) – rovina řezu se na ni položí.")}
            </p>
          ) : (
            <p className={hint}>{tr("Rovina leží na ploše {0}. Poloha je posun od plochy: záporně do materiálu, kladně ven.", (section.source?.kind === "face" ? section.source.index : 0) + 1)}</p>
          )}
          <div className="flex flex-wrap items-center gap-1">
            <button type="button" data-section-use-face disabled={!picked?.plane} onClick={() => picked?.plane && applyFace(picked.plane, picked.index, picked.compId)} className={small} title={picked && !picked.plane ? tr("Vybraná plocha není rovinná.") : undefined}>
              {tr("Použít vybranou plochu")}
            </button>
            {faceCount > 0 && (
              <span className="flex items-center gap-1 text-[11.5px] text-[#5b6776]">
                {tr("nebo č.")}
                <input
                  value={faceNo}
                  onChange={(e) => setFaceNo(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && applyFaceNumber()}
                  inputMode="numeric"
                  aria-label={tr("Číslo plochy")}
                  placeholder={`1–${faceCount}`}
                  className="w-14 rounded border border-[#cfd6de] bg-white px-1.5 py-1 font-mono text-[12px] outline-none focus:border-brand"
                />
                <button type="button" data-section-face-no onClick={applyFaceNumber} className={small}>
                  {tr("Použít")}
                </button>
              </span>
            )}
          </div>
          {faceErr && <p className="text-[11px] text-brand-600">{faceErr}</p>}
        </div>
      )}

      {tab === "vector" && (
        <label className="mb-2 block">
          <span className="mb-1 flex items-center justify-between text-[11px] font-medium uppercase tracking-wider text-ink-700/55">
            {tr("Normála")}
            <span className="normal-case tracking-normal text-ink-700/40">nx; ny; nz</span>
          </span>
          <input
            value={vecText}
            spellCheck={false}
            aria-label={tr("Normála roviny řezu")}
            onChange={(e) => setVecText(e.target.value)}
            onBlur={(e) => commitVector(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") commitVector((e.target as HTMLInputElement).value);
              if (e.key === "Escape") {
                setVecText(normalText);
                setVecErr(null);
              }
            }}
            className={cn("w-full rounded-lg border bg-white px-2.5 py-1.5 font-mono text-[13px] text-ink-700 outline-none focus:ring-2", vecErr ? "border-brand ring-brand/15" : "border-ink-700/12 focus:border-brand focus:ring-brand/15")}
          />
          {vecErr ? <span className="mt-1 block text-[11px] text-brand-600">{vecErr}</span> : <span className={cn("mt-1 block", hint)}>{section.flip ? tr("Normála míří do zachované části. Poloha je vzdálenost roviny od počátku souřadnic ve směru normály.") : tr("Normála míří do odříznuté části. Poloha je vzdálenost roviny od počátku souřadnic ve směru normály.")}</span>}
        </label>
      )}

      {range && (
        <input
          type="range"
          aria-label={tr("Poloha roviny řezu")}
          min={Math.min(range[0], section.offset) - 0.01}
          max={Math.max(range[1], section.offset) + 0.01}
          step={0.01}
          value={section.offset}
          onChange={(e) => onChange({ ...section, offset: Number(e.target.value) })}
          className="w-full accent-[#E03930]"
        />
      )}
      <div className="mt-1">
        <Num label={tr("Poloha")} value={section.offset} onChange={(v) => onChange({ ...section, offset: v })} step={1} hint={range ? tr("model {0} až {1}", formatPos(range[0]), formatPos(range[1])) : undefined} />
      </div>
      {mode === "face" && !waitFace && (
        <div className="mt-1.5">
          <Row k={tr("Normála plochy")} v={formatVector(n)} />
        </div>
      )}
      <button type="button" data-section-flip onClick={() => onChange({ ...section, flip: !section.flip })} className="mt-2 w-full rounded border border-[#cfd6de] py-1 text-[12px] hover:bg-[#f3f6f9]">
        {tr("Otočit stranu")}
      </button>
    </div>
  );
}
