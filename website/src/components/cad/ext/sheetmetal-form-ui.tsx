"use client";

/**
 * UI tvářecích nástrojů plechu a křížového zlomu: ikony, formuláře (plocha, body umístění klikem i číselně, parametry
 * s živou kontrolou rozměrů), klik do modelu = plocha + bod umístění, výzva v řádku příkazů.
 */
import { tr } from "@/cad/i18n";
import { useEffect, useMemo, useState } from "react";
import { cad } from "@/cad/client";
import { getExt, type ExtParam } from "@/cad/ext/registry";
import { sheetParamsAt } from "@/cad/ext/sheetmetal-flat";
import { CROSS_BREAK_EXT, FORM_EXT, formPoints, formSection, formToolLabel, formToolOf } from "@/cad/ext/sheetmetal-form-geom";
import type { Feature, Vec3 } from "@/cad/types";
import { Num, PickInfo, Seg, SketchPick } from "../props";
import { registerIcon } from "./icons";
import { registerExtUi, type ExtFormProps } from "./registry";

// ---------- ikony ----------
registerIcon("sheet-louvre", <><path d="M3 18h18" /><path d="M5 18c1-5 5-8 14-8" /><path d="M19 10v3" /></>);
registerIcon("sheet-dimple", <><path d="M3 15h5l2-4h4l2 4h5" /><path d="M3 18h5.5l2-4h3l2 4H21" /></>);
registerIcon("sheet-bead", <><path d="M3 15h4l3-4h4l3 4h4" /><path d="M3 18h4.5l3-4h3l3 4H21" /><path d="M12 4v4" strokeDasharray="1.5 1.5" /></>);
registerIcon("sheet-lance", <><path d="M3 17h6l3-5h9" /><path d="M3 20h5.5l3-5H21" /></>);
registerIcon("sheet-bridge", <><path d="M3 17h4l3-5h4l3 5h4" /><path d="M10 17h4" strokeDasharray="1.5 1.5" /></>);
registerIcon("sheet-collar", <><path d="M3 17h5V8" /><path d="M16 8v9h5" /><path d="M10 8v7M14 8v7" /></>);
registerIcon("sheet-cardguide", <><path d="M3 18h4l2-6h6l2 6h4" /><path d="M8 15h8" strokeWidth="2.2" /></>);
registerIcon("sheet-crossbreak", <><rect x="4" y="5" width="16" height="14" rx="1" /><path d="M4 5l16 14M20 5L4 19" strokeDasharray="2 1.5" /></>);

type ExtF = Extract<Feature, { type: "ext" }>;
const r2 = (v: number) => Math.round(v * 100) / 100;
const fmt = (n: number) => String(r2(n)).replace(".", ",");

/** Rovina vybrané plochy (pro rozvin v UI bez jádra) – uloží se k prvku jako `faceGeom`. */
async function faceGeomOf(index: number): Promise<{ origin: Vec3; normal: Vec3; face: number } | string> {
  const info = await cad.face(index).catch(() => null);
  if (!info) return tr("Plochu {0} se nepodařilo načíst.", index + 1);
  if (!info.planar) return tr("Tvářecí nástroj i křížový zlom se umisťují na rovinnou plochu plechu (plocha {0} není rovinná).", index + 1);
  return { origin: info.origin, normal: info.normal, face: index };
}

/** Udržuje `faceGeom` v souladu s vybranou plochou (výběr ze seznamu, pravidlem, ze stavu). */
function useFaceGeom(f: ExtF, onChange: (p: Record<string, unknown>) => void) {
  const face = (Array.isArray(f.data?.face) ? (f.data.face as number[]) : [])[0];
  const fg = f.data?.faceGeom as { face?: number } | null | undefined;
  useEffect(() => {
    if (face == null || fg?.face === face) return;
    let alive = true;
    void faceGeomOf(face).then((g) => {
      if (alive && typeof g !== "string") onChange({ faceGeom: g });
    });
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [face]);
}

/** Editor bodů umístění: řádky x, y [, z], přidání a smazání, zadání seznamem „x y; x y“. */
function PointsEditor({ value, onChange }: { value: number[][]; onChange: (v: number[][]) => void }) {
  const [text, setText] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const set = (i: number, k: number, v: string) => {
    const n = Number(v.replace(",", "."));
    if (!Number.isFinite(n)) return;
    onChange(value.map((p, j) => (j === i ? p.map((x, kk) => (kk === k ? n : x)) : p)));
  };
  const applyText = () => {
    const pts = text
      .split(/[;\n]/)
      .map((s) => s.trim())
      .filter(Boolean)
      .map((s) => s.split(/[\s,]+(?=[-+\d.])/).map((x) => Number(x.replace(",", "."))));
    // „10,5 20“ = desetinná čárka; čísla oddělená mezerou
    const ok = pts.every((p) => (p.length === 2 || p.length === 3) && p.every(Number.isFinite));
    if (!pts.length || !ok) return setErr(tr("Zadejte body jako „x y; x y“ nebo „x y z; …“ (mm)."));
    setErr(null);
    setText("");
    onChange([...value, ...pts]);
  };
  return (
    <div className="space-y-1" data-form-points>
      <p className="text-[12.5px] font-medium">{tr("Body umístění ({0})", value.length)}</p>
      {value.map((p, i) => (
        <div key={i} className="flex items-center gap-1 text-[12px]" data-point-row={i}>
          <span className="w-5 text-ink-700/45">{i + 1}.</span>
          {p.map((x, k) => (
            <input key={`${i}:${k}:${x}`} defaultValue={fmt(x)} aria-label={["x", "y", "z"][k]} onBlur={(e) => set(i, k, e.target.value)} onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()} className="w-16 rounded border border-ink-700/12 px-1.5 py-0.5 font-mono text-[12px] outline-none focus:border-brand" />
          ))}
          {p.length === 2 && <span className="text-[10.5px] text-ink-700/40">{tr("v rovině plochy")}</span>}
          <button type="button" aria-label={tr("Smazat bod")} title={tr("Smazat bod")} onClick={() => onChange(value.filter((_, j) => j !== i))} className="ml-auto px-1 text-brand">
            ×
          </button>
        </div>
      ))}
      <div className="flex gap-1">
        <input value={text} onChange={(e) => setText(e.target.value)} onKeyDown={(e) => e.key === "Enter" && applyText()} placeholder={tr("x y; x y …")} data-points-text className="min-w-0 flex-1 rounded-lg border border-ink-700/12 px-2 py-1 text-[12.5px] outline-none focus:border-brand" />
        <button type="button" onClick={applyText} data-points-add className="rounded-lg border border-ink-700/15 px-2 text-[12px] hover:border-brand">
          {tr("Přidat")}
        </button>
      </div>
      {err && <p className="text-[11px] text-brand">{err}</p>}
      <p className="text-[11px] text-ink-700/45">{tr("Klik na plochu plechu v modelu přidá bod. Dvě čísla = souřadnice v rovině plochy (u vodorovné plochy x, y), tři = bod v prostoru (promítne se na plochu).")}</p>
    </div>
  );
}

/** Číslo / volba / přepínač z parametrů registru. */
function ParamField({ f, p, onChange }: { f: ExtF; p: ExtParam; onChange: (patch: Record<string, unknown>) => void }) {
  const v = f.data?.[p.key];
  switch (p.kind) {
    case "number":
      return <Num label={p.label} value={typeof v === "number" ? v : 0} step={p.step ?? 0.5} min={p.min} suffix={p.unit ?? "mm"} hint={p.hint} bind={`${f.id}:data.${p.key}`} onChange={(n) => onChange({ [p.key]: p.max != null ? Math.min(p.max, n) : n })} />;
    case "bool":
      return (
        <label className="flex items-center gap-2 text-[13px]">
          <input type="checkbox" checked={v !== false} onChange={(e) => onChange({ [p.key]: e.target.checked })} className="accent-[#E03930]" />
          {p.label}
        </label>
      );
    case "enum":
      return <Seg label={p.label} value={String(v ?? p.options[0]?.v ?? "")} options={p.options} onChange={(x) => onChange({ [p.key]: x })} />;
    default:
      return null;
  }
}

/** Shrnutí řezu nástroje (použitý poloměr, velikost stopy) nebo chyba rozměrů – ještě před výpočtem v jádře. */
function SectionInfo({ f, doc }: { f: ExtF; doc: ExtFormProps["doc"] }) {
  const tool = formToolOf(f.ext);
  const idx = doc.features.findIndex((x) => x.id === f.id);
  const sp = sheetParamsAt(doc, idx < 0 ? doc.features.length : idx);
  const res = useMemo(() => {
    if (!tool) return null;
    try {
      const s = formSection(tool, f.data ?? {}, sp.t, sp.r);
      const size = s.mode === "revolve" ? tr("stopa Ø{0} mm", fmt(2 * s.s1)) : tool === "bead" ? tr("šířka stopy {0} mm", fmt(s.s1 - s.s0)) : tr("stopa {0} × {1} mm", fmt(s.s1 - s.s0), fmt(s.a1 - s.a0));
      return { ok: true, text: tr("Plech t = {0} mm · vnitřní poloměr R = {1} mm{2} · {3}", fmt(sp.t), fmt(s.R), (f.data?.radius as number) > 0 ? "" : tr(" (automaticky)"), size) };
    } catch (e) {
      return { ok: false, text: (e as Error).message };
    }
  }, [tool, f.data, sp.t, sp.r]);
  if (!res) return null;
  return (
    <p data-form-info className={res.ok ? "rounded-lg bg-steel-100 px-2.5 py-1.5 text-[11.5px] text-ink-700/70" : "rounded-lg border border-brand/40 bg-brand/5 px-2.5 py-1.5 text-[11.5px] text-brand"}>
      {res.text}
    </p>
  );
}

function FormToolForm({ f, doc, onChange }: ExtFormProps) {
  const def = getExt(f.ext);
  const tool = formToolOf(f.ext);
  useFaceGeom(f, onChange);
  if (!def || !tool) return null;
  const data = f.data ?? {};
  const face = Array.isArray(data.face) ? (data.face as number[]) : [];
  let pts: number[][] = [];
  let ptsErr: string | null = null;
  try {
    pts = formPoints(data.points);
  } catch (e) {
    ptsErr = (e as Error).message;
  }
  const idx = doc.features.findIndex((x) => x.id === f.id);
  const sketches = doc.features.slice(0, idx < 0 ? doc.features.length : idx).filter((x) => x.type === "sketch");
  const skip = new Set(["face", "points", "sketchId"]);
  return (
    <>
      <p className="text-[11.5px] leading-snug text-ink-700/55">{def.hint}</p>
      <div className="space-y-1">
        <p className="text-[12.5px] font-medium">{tr("Plocha plechu")}</p>
        <PickInfo n={face.length} what={tr("ploch")} hint={tr("Klik na rovinnou plochu plechu ji vybere{0}; bez výběru = horní plocha základního plechu.", tool === "bead" ? "" : tr(" a přidá bod umístění"))} onClear={() => onChange({ face: [], faceGeom: null })} list={{ doc, f, kind: "faces", value: face, onChange: (x) => onChange({ face: x.slice(-1), faceGeom: null }) }} />
      </div>
      {tool === "bead" ? (
        <SketchPick label={tr("Skica s dráhou (úsečky, oblouky)")} value={String(data.sketchId ?? "")} sketches={sketches} onChange={(v) => onChange({ sketchId: v })} />
      ) : (
        <>
          <PointsEditor value={pts} onChange={(v) => onChange({ points: v.map((p) => p.map(r2)) })} />
          {ptsErr && <p className="text-[11px] text-brand">{ptsErr}</p>}
        </>
      )}
      {(def.params ?? [])
        .filter((p) => !skip.has(p.key))
        .map((p) => (
          <ParamField key={p.key} f={f} p={p} onChange={onChange} />
        ))}
      <SectionInfo f={f} doc={doc} />
    </>
  );
}

function CrossBreakForm({ f, doc, onChange }: ExtFormProps) {
  const def = getExt(f.ext);
  useFaceGeom(f, onChange);
  if (!def) return null;
  const face = Array.isArray(f.data?.face) ? (f.data.face as number[]) : [];
  return (
    <>
      <p className="text-[11.5px] leading-snug text-ink-700/55">{def.hint}</p>
      <div className="space-y-1">
        <p className="text-[12.5px] font-medium">{tr("Panel")}</p>
        <PickInfo n={face.length} what={tr("ploch")} hint={tr("Klik na rovný panel plechu (plocha s rovnými hranami); bez výběru = horní plocha základního plechu.")} onClear={() => onChange({ face: [], faceGeom: null })} list={{ doc, f, kind: "faces", value: face, onChange: (x) => onChange({ face: x.slice(-1), faceGeom: null }) }} />
      </div>
      {(def.params ?? [])
        .filter((p) => p.key !== "face")
        .map((p) => (
          <ParamField key={p.key} f={f} p={p} onChange={onChange} />
        ))}
      <p className="rounded-lg bg-steel-100 px-2.5 py-1.5 text-[11.5px] text-ink-700/70">{tr("Panel se po úhlopříčkách vyklene o kratší polovinu × tan(úhel). Ve výkrese jsou úhlopříčky hranami modelu s poznámkou KŘÍŽOVÝ ZLOM, v rozvinu tenké čáry ve vrstvě FORM.")}</p>
    </>
  );
}

const pointsOf = (f: ExtF): number[][] => {
  try {
    return formPoints(f.data?.points);
  } catch {
    return [];
  }
};

for (const ext of Object.values(FORM_EXT)) {
  const tool = formToolOf(ext)!;
  registerExtUi(ext, {
    Form: FormToolForm,
    onFacePick: async ({ f, index, point }) => {
      const g = await faceGeomOf(index);
      if (typeof g === "string") return g;
      const cur = (Array.isArray(f.data?.face) ? (f.data.face as number[]) : [])[0];
      if (tool === "bead") return { face: [index], faceGeom: g };
      const p = point.map(r2);
      // jiná plocha = nové body (body se vztahují k rovině plochy); stejná plocha = další bod
      return { face: [index], faceGeom: g, points: cur === index ? [...pointsOf(f), p] : [p] };
    },
    prompt: (f) =>
      tool === "bead"
        ? tr("{0}: dráhu zvolte ve formuláři (skica s úsečkami / oblouky), klik na plochu plechu vybere plochu · Enter = OK, Esc = Storno", formToolLabel(tool))
        : tr("{0}: klikněte na rovinnou plochu plechu – každý klik přidá bod umístění (bodů {1}) · body lze zadat i číselně ve formuláři · Enter = OK, Esc = Storno", formToolLabel(tool), pointsOf(f).length),
  });
}

registerExtUi(CROSS_BREAK_EXT, {
  Form: CrossBreakForm,
  onFacePick: async ({ index }) => {
    const g = await faceGeomOf(index);
    if (typeof g === "string") return g;
    return { face: [index], faceGeom: g };
  },
  prompt: () => tr("Křížový zlom: klikněte na rovný panel plechu (bez výběru = horní plocha základního plechu) · Enter = OK, Esc = Storno"),
});
