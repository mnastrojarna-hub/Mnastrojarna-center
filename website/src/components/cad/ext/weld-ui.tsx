"use client";

/**
 * UI svařenců: ikony, formuláře (konstrukční profil, rám, housenka – ukládá délky hran pro tabulku svarů)
 * a akce Kusovník řezů (text + CSV) / Tabulka svarů.
 */
import { cadLocale, tr } from "@/cad/i18n";
import { ALIGN_OPTIONS, beadData, cutListCsv, cutListText, PROFILE_FAMILIES, type ProfileFamily } from "@/cad/ext/weld-layout";
import { contourPoints, filletSize, grooveAreaFormula, grooveData, grooveError, grooveProfile, isOpeningAngle, materialDensity, prepDef, PREPS, PROCESSES, reinforcementArea, type GroovePrep, type GrooveSpec } from "@/cad/ext/weld-calc";
import { weldTableCsv, weldTableText } from "@/cad/ext/weld-table";
import { HEB, IPE, UPN } from "@/cad/library/tables";
import type { Feature } from "@/cad/types";
import { Check, Num, PickInfo, Seg } from "../props";
import { registerIcon } from "./icons";
import { registerExtUi, type ExtFormProps } from "./registry";

// ---------- ikony ----------
registerIcon("weld-member", <><path d="M3 17l6-10h12" /><path d="M3 21l6-10h12" /><path d="M9 7v4M21 7v4M3 17v4" /></>);
registerIcon("weld-frame", <><path d="M5 9l4-4h10v10l-4 4H5z" /><path d="M5 9h10v10M15 9l4-4" /></>);
registerIcon("weld-plate", <><rect x="3" y="8" width="18" height="10" rx="1" /><circle cx="7" cy="13" r="1.3" /><circle cx="17" cy="13" r="1.3" /></>);
registerIcon("weld-trim", <><path d="M4 16h16M4 20h16" /><path d="M12 3v10" strokeDasharray="2 1.5" /><path d="M9 7l3 3 3-3" /></>);
registerIcon("weld-cap", <><path d="M4 8h12v12H4z" /><path d="M16 8l3-3v12l-3 3" /><rect x="2" y="6" width="4" height="14" rx="0.5" fill="currentColor" fillOpacity=".2" /></>);
registerIcon("weld-gusset", <><path d="M4 20V4M4 20h16" /><path d="M4 12l8 8H4z" fill="currentColor" fillOpacity=".25" /></>);
registerIcon("weld-bead", <><path d="M4 20V6M4 20h14" /><path d="M4 14c3 0 6 3 6 6" /><path d="M4 11c4.5 0 9 4.5 9 9" strokeDasharray="1.2 1.2" /></>);
registerIcon("weld-groove", <><path d="M2 9h7l2.5 6h1L15 9h7" /><path d="M2 15h9.5M12.5 15H22" /><path d="M9 9l3 -2.5L15 9" fill="currentColor" fillOpacity=".3" /></>);
registerIcon("weld-plug", <><path d="M3 10h18v4H3z" /><path d="M3 14h18v4H3z" /><path d="M9.5 10v4h5v-4" fill="currentColor" fillOpacity=".35" /></>);
registerIcon("weld-spot", <><rect x="3" y="7" width="18" height="10" rx="1" /><circle cx="7" cy="12" r="1.6" fill="currentColor" /><circle cx="12" cy="12" r="1.6" fill="currentColor" /><circle cx="17" cy="12" r="1.6" fill="currentColor" /></>);
registerIcon("weld-symbol", <><path d="M3 14h18" /><path d="M3 14l-1 6" /><path d="M9 14l4-5h0l4 5" /><path d="M12 9v5" /></>);
registerIcon("weld-list", <><rect x="3" y="4" width="18" height="16" rx="1.5" /><path d="M7 9h10M7 13h10M7 17h6" /></>);
registerIcon("weld-table", <><rect x="3" y="5" width="18" height="14" rx="1.5" /><path d="M3 10h18M3 15h18M9 5v14M15 5v14" /></>);

// ---------- formuláře ----------

const inputCls = "w-full rounded-lg border border-ink-700/12 bg-white px-2 py-1.5 text-[13px] outline-none focus:border-brand";

function ProfileFields({ f, onChange }: ExtFormProps) {
  const data = f.data ?? {};
  const fam = String(data.family ?? "shs") as ProfileFamily;
  const n = (k: string, d: number) => (typeof data[k] === "number" ? (data[k] as number) : d);
  const table = fam === "U" ? UPN : fam === "IPE" ? IPE : fam === "HEB" ? HEB : null;
  return (
    <>
      <label className="block">
        <span className="mb-1 block text-[11px] font-medium uppercase tracking-wider text-ink-700/55">{tr("Profil")}</span>
        <select className={inputCls} value={fam} onChange={(e) => onChange({ family: e.target.value })}>
          {PROFILE_FAMILIES.map((p) => (
            <option key={p.v} value={p.v}>
              {p.l}
            </option>
          ))}
        </select>
      </label>
      {table && (
        <label className="block">
          <span className="mb-1 block text-[11px] font-medium uppercase tracking-wider text-ink-700/55">{tr("Velikost")}</span>
          <select className={inputCls} value={String(data.size ?? Object.keys(table)[0])} onChange={(e) => onChange({ size: e.target.value })}>
            {Object.keys(table).map((k) => (
              <option key={k} value={k}>
                {fam === "U" ? "UPN" : fam} {k}
              </option>
            ))}
          </select>
        </label>
      )}
      {(fam === "shs" || fam === "square") && <Num label={fam === "shs" ? tr("Rozměr a×a") : tr("Rozměr a")} value={n("w", 40)} min={1} bind={`${f.id}:data.w`} onChange={(v) => onChange({ w: v })} />}
      {(fam === "rhs" || fam === "L" || fam === "flat") && (
        <div className="grid grid-cols-2 gap-2">
          <Num label={fam === "L" ? tr("Rameno a") : tr("Šířka")} value={n("w", 40)} min={1} bind={`${f.id}:data.w`} onChange={(v) => onChange({ w: v })} />
          {fam !== "flat" && <Num label={fam === "L" ? tr("Rameno b") : tr("Výška")} value={n("h", 40)} min={1} bind={`${f.id}:data.h`} onChange={(v) => onChange({ h: v })} />}
        </div>
      )}
      {(fam === "chs" || fam === "round") && <Num label={tr("Průměr D")} value={n("d", 33.7)} min={1} bind={`${f.id}:data.d`} onChange={(v) => onChange({ d: v })} />}
      {(fam === "shs" || fam === "rhs" || fam === "chs" || fam === "L" || fam === "flat") && <Num label={fam === "flat" ? tr("Tloušťka") : tr("Tloušťka stěny t")} value={n("t", 3)} min={0.5} step={0.5} bind={`${f.id}:data.t`} onChange={(v) => onChange({ t: v })} />}
    </>
  );
}

function MemberForm(props: ExtFormProps) {
  const { f, doc, onChange } = props;
  const data = f.data ?? {};
  const idx = doc.features.findIndex((x) => x.id === f.id);
  const sketches = (idx >= 0 ? doc.features.slice(0, idx) : doc.features).filter((x): x is Extract<Feature, { type: "sketch" }> => x.type === "sketch");
  const n = (k: string, d: number) => (typeof data[k] === "number" ? (data[k] as number) : d);
  return (
    <div className="space-y-3">
      <label className="block">
        <span className="mb-1 block text-[11px] font-medium uppercase tracking-wider text-ink-700/55">{tr("Skica s úsečkami (osy profilů)")}</span>
        <select className={inputCls} value={String(data.sketchId ?? "")} onChange={(e) => onChange({ sketchId: e.target.value })}>
          <option value="">{tr("— vyberte skicu —")}</option>
          {sketches.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
            </option>
          ))}
        </select>
      </label>
      <ProfileFields {...props} />
      <div className="grid grid-cols-2 gap-2">
        <label className="block">
          <span className="mb-1 block text-[11px] font-medium uppercase tracking-wider text-ink-700/55">{tr("Zarovnání k ose")}</span>
          <select className={inputCls} value={String(data.align ?? "center")} onChange={(e) => onChange({ align: e.target.value })}>
            {ALIGN_OPTIONS.map((a) => (
              <option key={a.v} value={a.v}>
                {a.l}
              </option>
            ))}
          </select>
        </label>
        <Num label={tr("Natočení")} value={n("angle", 0)} step={15} suffix="°" bind={`${f.id}:data.angle`} onChange={(v) => onChange({ angle: v })} />
      </div>
      <Seg label={tr("Spoj v rohu")} value={String(data.corner ?? "mitre")} options={[{ v: "mitre", l: tr("Pokos") }, { v: "butt", l: tr("Tupý") }, { v: "none", l: tr("Žádný") }]} onChange={(v) => onChange({ corner: v })} />
      <div className="grid grid-cols-3 gap-2">
        <Num label={tr("Mezera")} value={n("gap", 0)} min={0} step={0.5} bind={`${f.id}:data.gap`} onChange={(v) => onChange({ gap: v })} />
        <Num label={tr("Prodl. začátek")} value={n("extStart", 0)} bind={`${f.id}:data.extStart`} onChange={(v) => onChange({ extStart: v })} />
        <Num label={tr("Prodl. konec")} value={n("extEnd", 0)} bind={`${f.id}:data.extEnd`} onChange={(v) => onChange({ extEnd: v })} />
      </div>
      <label className="flex items-center gap-2 text-[13px]">
        <input type="checkbox" className="accent-[#E03930]" checked={!!data.separate} onChange={(e) => onChange({ separate: e.target.checked })} />
        {tr("Jako samostatná tělesa (nespojovat)")}
      </label>
      <Seg label={tr("Operace")} value={data.mode === "new" ? "new" : "add"} options={[{ v: "add", l: tr("Přidat") }, { v: "new", l: tr("Nové těleso") }]} onChange={(v) => onChange({ mode: v })} />
      <p className="text-[11px] leading-snug text-ink-700/50">{tr("Rohy: profily, které se ve skice stýkají koncovými body, se v rohu ořežou pokosem (obě stejně) nebo tupě (první profil průběžný, druhý zkrácený). Volné konce lze prodloužit/zkrátit.")}</p>
    </div>
  );
}

function FrameForm(props: ExtFormProps) {
  const { f, onChange } = props;
  const data = f.data ?? {};
  const n = (k: string, d: number) => (typeof data[k] === "number" ? (data[k] as number) : d);
  return (
    <div className="space-y-3">
      <ProfileFields {...props} />
      <div className="grid grid-cols-3 gap-2">
        <Num label={tr("Šířka X")} value={n("width", 600)} min={10} bind={`${f.id}:data.width`} onChange={(v) => onChange({ width: v })} />
        <Num label={tr("Hloubka Y")} value={n("depth", 400)} min={10} bind={`${f.id}:data.depth`} onChange={(v) => onChange({ depth: v })} />
        <Num label={tr("Výška Z")} value={n("height", 800)} min={10} bind={`${f.id}:data.height`} onChange={(v) => onChange({ height: v })} />
      </div>
      <Seg label={tr("Rohy obdélníků")} value={String(data.corner ?? "mitre")} options={[{ v: "mitre", l: tr("Pokos") }, { v: "butt", l: tr("Tupý") }]} onChange={(v) => onChange({ corner: v })} />
      <Seg label={tr("Operace")} value={data.mode === "new" ? "new" : "add"} options={[{ v: "add", l: tr("Přidat") }, { v: "new", l: tr("Nové těleso") }]} onChange={(v) => onChange({ mode: v })} />
      <p className="text-[11px] leading-snug text-ink-700/50">{tr("Spodní a horní obdélník + 4 sloupky tupě mezi nimi. Vnější rozměry rámu odpovídají zadání.")}</p>
    </div>
  );
}

const fmt = (n: number, d = 2) => (Math.round(n * 10 ** d) / 10 ** d).toLocaleString(cadLocale(), { maximumFractionDigits: d });
const PROCESS_OPTS = PROCESSES.map((p) => ({ v: p.v, l: p.l }));

function ProcessFields({ f, onChange }: ExtFormProps) {
  const data = f.data ?? {};
  return (
    <div className="grid grid-cols-2 gap-2">
      <label className="block">
        <span className="mb-1 block text-[11px] font-medium uppercase tracking-wider text-ink-700/55">{tr("Metoda (ISO 4063)")}</span>
        <select className={inputCls} data-weld-process value={String(data.process ?? "135")} onChange={(e) => onChange({ process: e.target.value })}>
          {PROCESS_OPTS.map((o) => (
            <option key={o.v} value={o.v}>
              {o.l}
            </option>
          ))}
        </select>
      </label>
      <Num label={tr("Účinnost navaření")} value={typeof data.eff === "number" ? data.eff : 0} min={0} step={0.05} suffix="" hint={tr("0 = podle metody")} onChange={(v) => onChange({ eff: Math.max(0, Math.min(1, v)) })} />
    </div>
  );
}

/** Koutový svar: hrany koutu, a / z (převod z = a·√2), oboustranný, kolem, přerušovaný, těleso, metoda. */
function BeadForm(props: ExtFormProps) {
  const { f, doc, onChange } = props;
  const data = f.data ?? {};
  const b = beadData(data);
  const fs = filletSize(b.a, b.measure);
  return (
    <div className="space-y-3" data-weld-form="bead">
      <div className="space-y-1">
        <p className="text-[12.5px] font-medium">{tr("Hrany koutu")}</p>
        <PickInfo n={b.edges.length + (Array.isArray(data.edgeAt) ? (data.edgeAt as unknown[]).length : 0)} what={tr("hran")} hint={tr("Klikněte na vnitřní hranu koutu, nebo na spodní hranu dílu stojícího na jiném dílu.")} onClear={() => onChange({ edges: [], edgeAt: [], edgeLens: [] })} list={{ doc, f, kind: "edges", value: b.edges, onChange: (x) => onChange({ edges: x }) }} />
      </div>
      <Seg label={tr("Velikost svaru")} value={b.measure} options={[{ v: "a", l: tr("a – účinná tloušťka") }, { v: "z", l: tr("z – rameno") }]} onChange={(v) => onChange({ measure: v })} />
      <Num label={b.measure === "a" ? tr("Účinná tloušťka a") : tr("Rameno z")} value={b.a} min={0.5} step={0.5} bind={`${f.id}:data.a`} onChange={(v) => onChange({ a: v })} />
      <p className="text-[11.5px] text-ink-700/60" data-weld-az>
        {b.measure === "a" ? tr("z = a·√2 = {0} mm (kout 90°), průřez a² = {1} mm²", fmt(fs.z), fmt(fs.area)) : tr("a = z/√2 = {0} mm (kout 90°), průřez z²/2 = {1} mm²", fmt(fs.a), fmt(fs.area))}
      </p>
      <div className="grid grid-cols-2 gap-x-3 gap-y-1">
        <Check label={tr("Oboustranný")} value={b.both} onChange={(v) => onChange({ both: v })} />
        <Check label={tr("Kolem")} value={b.allAround} onChange={(v) => onChange({ allAround: v })} />
        <Check label={tr("Přerušovaný svar")} value={b.intermittent} onChange={(v) => onChange({ intermittent: v })} />
        <Check label={tr("Montážní svar")} value={b.field} onChange={(v) => onChange({ field: v })} />
      </div>
      {b.intermittent && (
        <div className="grid grid-cols-2 gap-2">
          <Num label={tr("Délka úseku")} value={b.segLen} min={1} onChange={(v) => onChange({ segLen: v })} />
          <Num label={tr("Rozteč")} value={b.pitch} min={1} onChange={(v) => onChange({ pitch: v })} />
        </div>
      )}
      <Check label={tr("Svarový kov jako těleso „Svar k“")} value={b.separate} onChange={(v) => onChange({ separate: v })} />
      <ProcessFields {...props} />
      <p className="text-[11px] leading-snug text-ink-700/50">{tr("Housenka je rovnoramenný trojúhelník z × z v koutu (rovné hrany i oblouky); kolem = celá uzavřená smyčka koutu s vyplněnými rohy. Délka, průřez, hmotnost svarového kovu a přídavný materiál jsou ve stavu prvku a v Tabulce svarů.")}</p>
    </div>
  );
}

/** náhled průřezu drážky (SVG): drážka, převýšení, podložka, kóty t / b / úhel */
function GroovePreview({ spec }: { spec: GrooveSpec }) {
  const err = grooveError(spec);
  if (err) return <p className="rounded bg-brand/10 px-2 py-1 text-[12px] text-brand-600" data-groove-error>{err}</p>;
  const p = grooveProfile(spec);
  const def = prepDef(spec.prep)!;
  const pieces = [...p.groove.map((c) => ({ pts: contourPoints(c, 24), cap: false })), ...p.caps.map((c) => ({ pts: contourPoints(c.piece, 24), cap: true }))];
  const all = pieces.flatMap((x) => x.pts).concat(p.backing ?? []);
  const half = Math.max(...all.map((q) => Math.abs(q[0])), spec.t * 0.6) + 8;
  const x0 = -half;
  const x1 = half;
  const y0 = Math.min(...all.map((q) => q[1]), 0) - 3;
  const y1 = Math.max(...all.map((q) => q[1]), spec.t) + 3;
  const W = 260;
  const H = Math.min(150, Math.max(80, (W * (y1 - y0)) / (x1 - x0)));
  const k = Math.min(W / (x1 - x0), H / (y1 - y0));
  const X = (x: number) => (x - x0) * k;
  const Y = (y: number) => H - (y - y0) * k;
  const path = (pts: [number, number][]) => pts.map((q, i) => `${i ? "L" : "M"}${X(q[0]).toFixed(1)},${Y(q[1]).toFixed(1)}`).join(" ") + " Z";
  // spojované díly: obdélníky vně drážky (A vpravo, B vlevo u souměrných; jednostranné: B je povrch x < 0)
  const plateA: [number, number][] = [[0, 0], [x1, 0], [x1, spec.t], [0, spec.t]];
  const plateB: [number, number][] = [[x0, 0], [0, 0], [0, spec.t], [x0, spec.t]];
  return (
    <svg data-groove-preview width={W} height={H} viewBox={`0 0 ${W} ${H}`} className="rounded border border-ink-700/10 bg-white">
      <path d={path(plateA)} fill="#d6dce3" stroke="none" />
      {def.both && <path d={path(plateB)} fill="#d6dce3" stroke="none" />}
      {!def.both && <path d={path(plateB)} fill="#c5ccd5" stroke="none" />}
      {pieces.map((pc, i) => (
        <path key={i} d={path(pc.pts)} fill={pc.cap ? "#c58a48" : "#a8743a"} stroke="#6b4a24" strokeWidth={0.8} />
      ))}
      {p.backing && <path d={path(p.backing)} fill="#7d8794" stroke="#4a525c" strokeWidth={0.8} />}
      <text x={4} y={12} fontSize={10} fill="#334">{`${prepDef(spec.prep)?.l ?? spec.prep} · t ${fmt(spec.t, 1)}`}</text>
    </svg>
  );
}

/** průřez a hmotnost svarového kovu na metr podle vzorců (živě ve formuláři; skutečné hodnoty z modelu jsou ve stavu prvku) */
function GrooveNumbers({ spec, material }: { spec: GrooveSpec; material: unknown }) {
  if (grooveError(spec)) return null;
  const a = grooveAreaFormula(spec) + reinforcementArea(spec);
  const kgPerM = a * 1000 * materialDensity(material) * 1e-6;
  return <p className="text-[11.5px] text-ink-700/70" data-groove-area>{tr("Průřez svarového kovu ≈ {0} mm² (t = {1} mm) · {2} kg/m", fmt(a, 2), fmt(spec.t, 1), fmt(kgPerM, 3))}</p>;
}

/** Tupý svar: výběr čela / hrany, úprava ISO 9692-1 s výchozími hodnotami, převýšení, podložka, náhled průřezu. */
function GrooveForm(props: ExtFormProps) {
  const { f, doc, onChange } = props;
  const data = f.data ?? {};
  const g = grooveData(data);
  const def = prepDef(g.prep)!;
  const pickEdges = data.pickKind === "edges" || (!g.faces.length && g.edges.length > 0 && data.pickKind !== "faces");
  const tPreview = g.t > 0 ? g.t : typeof data.tPreview === "number" ? (data.tPreview as number) : 10;
  const spec: GrooveSpec = { prep: g.prep, t: tPreview, c: g.prep === "I" ? 0 : Math.min(g.c, tPreview * 0.999), g: g.g, angle: g.angle, R: g.R, cap: g.cap, root: g.root, backing: g.backing, overlap: 1 };
  const setPrep = (v: GroovePrep) => {
    const d = prepDef(v)!;
    onChange({ prep: v, angle: d.angle, rootFace: d.c, gap: d.g, radius: d.R });
  };
  return (
    <div className="space-y-3" data-weld-form="groove">
      <Seg label={tr("Spoj vybírám v modelu jako")} value={pickEdges ? "edges" : "faces"} options={[{ v: "faces", l: tr("Čelo dílu (plocha)") }, { v: "edges", l: tr("Hrana spáry / kout") }]} onChange={(v) => onChange({ pickKind: v })} />
      {pickEdges ? (
        <PickInfo n={g.edges.length + (Array.isArray(data.edgeAt) ? (data.edgeAt as unknown[]).length : 0)} what={tr("hran")} hint={tr("Hrana čela na straně svaru (strana šipky), nebo vnitřní kout sloučeného T / rohového spoje.")} onClear={() => onChange({ edges: [], edgeAt: [] })} list={{ doc, f, kind: "edges", value: g.edges, onChange: (x) => onChange({ edges: x }) }} />
      ) : (
        <PickInfo n={g.faces.length + (Array.isArray(data.faceAt) ? (data.faceAt as unknown[]).length : 0)} what={tr("ploch")} hint={tr("Čelo připravovaného dílu, které se dotýká druhého dílu (konec plechu, spodní čelo stojiny).")} onClear={() => onChange({ faces: [], faceAt: [] })} list={{ doc, f, kind: "faces", value: g.faces, onChange: (x) => onChange({ faces: x }) }} />
      )}
      <label className="block">
        <span className="mb-1 block text-[11px] font-medium uppercase tracking-wider text-ink-700/55">{tr("Úprava (ISO 9692-1)")}</span>
        <select className={inputCls} data-weld-prep value={g.prep} onChange={(e) => setPrep(e.target.value as GroovePrep)}>
          {PREPS.map((p) => (
            <option key={p.v} value={p.v}>
              {p.l} ({p.iso})
            </option>
          ))}
        </select>
      </label>
      <div className="grid grid-cols-2 gap-2">
        {g.prep !== "I" && <Num label={isOpeningAngle(g.prep) ? tr("Úhel rozevření α") : tr("Úhel úkosu β")} value={g.angle} min={1} step={5} suffix="°" bind={`${f.id}:data.angle`} onChange={(v) => onChange({ angle: v })} />}
        {g.prep !== "I" && <Num label={tr("Otupení c")} value={g.c} min={0} step={0.5} bind={`${f.id}:data.rootFace`} onChange={(v) => onChange({ rootFace: v })} />}
        <Num label={tr("Mezera b")} value={g.g} min={0} step={0.5} bind={`${f.id}:data.gap`} onChange={(v) => onChange({ gap: v })} />
        {def.curved && <Num label={tr("Poloměr dna R")} value={g.R} min={0.5} step={0.5} bind={`${f.id}:data.radius`} onChange={(v) => onChange({ radius: v })} />}
        <Num label={tr("Převýšení housenky")} value={g.cap} min={0} step={0.5} onChange={(v) => onChange({ cap: v })} />
        {!def.double && <Num label={tr("Převýšení kořene")} value={g.root} min={0} step={0.5} hint={tr("jen s mezerou")} onChange={(v) => onChange({ root: v })} />}
        <Num label={tr("Tloušťka t")} value={g.t} min={0} step={1} hint={tr("0 = z modelu")} onChange={(v) => onChange({ t: v })} />
      </div>
      <div className="grid grid-cols-2 gap-x-3 gap-y-1">
        {!def.double && <Check label={tr("Podložka kořene")} value={g.backing} onChange={(v) => onChange({ backing: v })} />}
        <Check label={tr("Obrátit stranu svaru")} value={g.flip} onChange={(v) => onChange({ flip: v })} />
        <Check label={tr("Montážní svar")} value={g.field} onChange={(v) => onChange({ field: v })} />
      </div>
      <GroovePreview spec={spec} />
      <GrooveNumbers spec={spec} material={doc.material} />
      <ProcessFields {...props} />
      <p className="text-[11px] leading-snug text-ink-700/50">{tr("Úprava se vyřízne do spojovaných dílů (souměrné V, Y, X, U, 2U do obou, ½V, ½Y, K, J, 2J jen do vybraného), svarový kov s převýšením je těleso „Svar k“, podložka „Podložka k“. Náhled kreslí průřez pro zadanou tloušťku (0 = 10 mm, skutečná se změří v modelu).")}</p>
    </div>
  );
}

registerExtUi("weld.member", { Form: MemberForm });
registerExtUi("weld.frame", { Form: FrameForm });
registerExtUi("weld.bead", { Form: BeadForm });
registerExtUi("weld.groove", {
  Form: GrooveForm,
  // výběr v modelu: čelo dílu (plocha), nebo hrana spáry / kout
  pick: (f) => {
    const d = f.data ?? {};
    const edges = d.pickKind === "edges" || (d.pickKind !== "faces" && !(Array.isArray(d.faces) && d.faces.length) && Array.isArray(d.edges) && d.edges.length > 0);
    return edges ? { kind: "edges", key: "edges" } : { kind: "faces", key: "faces" };
  },
});

// ---------- akce ----------

const safe = (s: string) => (s || "svarenec").normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^\w.-]+/g, "_").slice(0, 60);

registerExtUi("weld.cutList", {
  action: (api) => {
    const text = cutListText(api.doc);
    api.notice(tr("Kusovník řezů"), text);
    if (!text.startsWith(tr("Žádné"))) {
      api.download(`${safe(api.doc.name)}_kusovnik_rezu.csv`, cutListCsv(api.doc), "text/csv;charset=utf-8");
      api.flash(tr("Kusovník řezů uložen jako CSV (Excel)."));
    }
  },
});
registerExtUi("weld.weldTable", {
  action: (api) => {
    const text = weldTableText(api.doc, api.result?.status);
    api.notice(tr("Tabulka svarů"), text);
    if (!text.startsWith(tr("Žádné"))) api.download(`${safe(api.doc.name)}_tabulka_svaru.csv`, weldTableCsv(api.doc, api.result?.status), "text/csv;charset=utf-8");
  },
});
