"use client";
/**
 * Porovnání modelu s referenčním modelem (STEP / BREP / IGES / síťové formáty – typicky model zákazníka k výkresu):
 * objemy a jejich rozdíly, seznam rozdílových oblastí (klik = zvýraznit a přiblížit), barevná mapa odchylek na modelu
 * s legendou, průhledná reference a export reportu (CSV / text). Výpočet běží v jádře (compare.ts, operace `compare`).
 *
 * Mapa odchylek se zobrazuje existujícím mechanismem barev vrcholů viewportu: dialog předá aplikaci síť modelu pro mapu
 * (jemnější než zobrazovací, stejné plochy) a k ní barvy vrcholů (`onView`).
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { cad, isCancelled } from "@/cad/client";
import type { CompareOptions, CompareResult, ReferenceFile } from "@/cad/compare";
import { alignText, compareReportCsv, compareReportText, regionHint, regionList, sideText, surfacesText, type NumberedRegion } from "@/cad/compare-report";
import { prepareImport } from "@/cad/formats/import";
import { cadLocale, getLang, tr } from "@/cad/i18n";
import { distanceColors, distanceStats, MAP_GREEN, MAP_ORANGE, MAP_RED, MAP_YELLOW, type AlignMode } from "@/cad/mesh-distance";
import type { CadDoc, MeshData, Vec3 } from "@/cad/types";
import { cn } from "@/lib/cn";
import { saveFile } from "@/lib/save-file";
import { CadIcon } from "./cad-icons";
import { Btn, FloatPanel, Segmented, Toggle } from "./ui";
import type { Ghost, ViewportHandle } from "./viewport";

/** co má viewport ukázat: síť modelu pro mapu + barvy vrcholů (obojí null = běžný model) a průhledná tělesa */
export type CompareView = { mesh: MeshData | null; colors: Float32Array | null; ghosts: Ghost[] };

/** soubory, které jdou použít jako reference (síťové formáty se převedou na STL stejně jako při importu) */
const ACCEPT = ".step,.stp,.brep,.brp,.igs,.iges,.stl,.obj,.3mf,.ply,.off,.gltf,.glb";
const EXTRA_COLOR = "#ea580c";
const MISSING_COLOR = "#2563eb";
const ROTS = [0, 90, 180, 270];

const css = (c: [number, number, number]) => `rgb(${Math.round(c[0] * 255)} ${Math.round(c[1] * 255)} ${Math.round(c[2] * 255)})`;
const geoKeyOf = (d: CadDoc) => JSON.stringify([d.features, d.variables ?? null, d.bindings ?? null, d.configs ?? null, d.activeConfig ?? null, d.activeBody ?? null]);
const showNum = (v: number) => (getLang() === "en" ? String(v) : String(v).replace(".", ","));

function fromB64(b64: string): Uint8Array {
  const s = atob(b64);
  const u = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) u[i] = s.charCodeAt(i);
  return u;
}

/** číslo podle jazyka rozhraní */
const nf = (v: number, digits = 2) => (Number.isFinite(v) ? (Math.abs(v) < 0.5 * 10 ** -digits ? 0 : v).toLocaleString(cadLocale(), { minimumFractionDigits: digits, maximumFractionDigits: digits }) : "–");
const cm3 = (mm3: number) => nf(mm3 / 1000, 3);
const pt = (p: Vec3, digits = 2) => `${nf(p[0], digits)} / ${nf(p[1], digits)} / ${nf(p[2], digits)}`;

/** číselné pole s desetinnou čárkou i tečkou; hodnota se převezme po Enter nebo opuštění pole */
function NumIn({ value, onChange, label, min, className }: { value: number; onChange: (v: number) => void; label: string; min?: number; className?: string }) {
  const [text, setText] = useState(showNum(value));
  useEffect(() => setText(showNum(value)), [value]);
  const commit = () => {
    const v = Number(text.replace(",", ".").replace(/\s/g, ""));
    if (text.trim() !== "" && Number.isFinite(v) && (min == null || v >= min)) onChange(v);
    else setText(showNum(value));
  };
  return (
    <input
      aria-label={label}
      title={label}
      inputMode="decimal"
      value={text}
      onChange={(e) => setText(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => e.key === "Enter" && commit()}
      className={cn("w-full min-w-0 rounded border border-[#cfd6de] bg-white px-1.5 py-1 text-right font-mono text-[12px] outline-none focus:border-brand", className)}
    />
  );
}

function Stat({ k, v, strong, data }: { k: string; v: React.ReactNode; strong?: boolean; data?: string }) {
  return (
    <div className="flex items-baseline justify-between gap-3 border-b border-[#edf1f5] py-0.5 text-[12px] last:border-0" data-compare-stat={data}>
      <span className="text-[#6b7785]">{k}</span>
      <span className={cn("text-right font-mono", strong ? "text-[13px] font-bold text-[#0b1f33]" : "text-[#26303b]")}>{v}</span>
    </div>
  );
}

/** Legenda barevné mapy: zelená v toleranci, žlutá → červená odchylka, plná červená od `full`. */
export function CompareLegend({ tol, full, accuracy }: { tol: number; full: number; accuracy?: number }) {
  const g = css(MAP_GREEN);
  const k = Math.min(45, Math.max(12, (tol / Math.max(full, tol * 1.0001)) * 100));
  return (
    <div data-compare-legend className="text-[11px] text-[#4a5664]">
      <div className="h-3 w-full rounded-sm border border-[#cfd6de]" style={{ background: `linear-gradient(to right, ${g} 0%, ${g} ${k}%, ${css(MAP_YELLOW)} ${k}%, ${css(MAP_ORANGE)} ${(k + 100) / 2}%, ${css(MAP_RED)} 100%)` }} />
      <div className="relative mt-0.5 h-3.5 font-mono">
        <span className="absolute left-0">0</span>
        <span className="absolute -translate-x-1/2" style={{ left: `${k}%` }}>
          ±{nf(tol, 3)}
        </span>
        <span className="absolute right-0">≥ ±{nf(full, 2)} mm</span>
      </div>
      <p className="mt-1 leading-snug">
        {tr("Zelená = odchylka v toleranci, žlutá → červená = odchylka od povrchu reference.")}
        {accuracy != null && ` ${tr("Přesnost mapy ±{0} mm (dána sítí reference a modelu).", nf(accuracy, 3))}`}
      </p>
    </div>
  );
}

export function CompareDialog({ doc, vp, onView, onClose }: { doc: CadDoc; vp: React.RefObject<ViewportHandle | null>; onView: (v: CompareView | null) => void; onClose: () => void }) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [ref, setRef] = useState<{ file: ReferenceFile; note?: string; size: number } | null>(null);
  const [loadErr, setLoadErr] = useState<string | null>(null);
  const [mode, setMode] = useState<AlignMode>("none");
  const [rotate, setRotate] = useState<Vec3>([0, 0, 0]);
  const [offset, setOffset] = useState<Vec3>([0, 0, 0]);
  const [tol, setTol] = useState(0.1);
  const [full, setFull] = useState(1);
  const [booleans, setBooleans] = useState(true);
  const [wantMap, setWantMap] = useState(true);
  const [running, setRunning] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [res, setRes] = useState<CompareResult | null>(null);
  const [resKey, setResKey] = useState("");
  const [resAt, setResAt] = useState("");
  const [showMap, setShowMap] = useState(true);
  const [showGhost, setShowGhost] = useState(false);
  const [sel, setSel] = useState<number | null>(null);
  const [width] = useState(() => (typeof window === "undefined" ? 360 : Math.max(280, Math.min(360, window.innerWidth - 24))));

  const geoKey = useMemo(() => geoKeyOf(doc), [doc]);
  const stale = !!res && resKey !== geoKey;
  const list = useMemo<NumberedRegion[]>(() => (res ? regionList(res) : []), [res]);
  // statistika a barvy mapy podle aktuální tolerance (přepočet bez jádra)
  const stats = useMemo(() => (res?.map ? distanceStats(res.map.distances, tol, res.map.mesh) : null), [res, tol]);
  const colors = useMemo(() => {
    if (!res?.map) return null;
    // barvy stupnice jsou v sRGB (jako legenda); atribut barev vrcholů je ve three.js lineární → převod, jinak by mapa vybledla
    const c = distanceColors(res.map.distances, tol, Math.max(full, tol * 1.0001));
    for (let i = 0; i < c.length; i++) c[i] = c[i] ** 2.2;
    return c;
  }, [res, tol, full]);
  const selected = sel != null ? (list.find((g) => g.n === sel) ?? null) : null;

  // zobrazení ve viewportu
  useEffect(() => {
    if (!res || stale) {
      onView(null);
      return;
    }
    const ghosts: Ghost[] = [];
    if (showGhost && res.ghost) ghosts.push({ key: "reference", ...res.ghost, color: "#64748b", opacity: 0.22 });
    if (selected?.mesh) ghosts.push({ key: `region-${selected.n}`, ...selected.mesh, color: selected.side === "extra" ? EXTRA_COLOR : MISSING_COLOR, opacity: 0.6, xray: true });
    const map = showMap && res.map && colors ? res.map : null;
    onView({ mesh: map ? map.mesh : null, colors: map ? colors : null, ghosts });
  }, [res, stale, showMap, showGhost, selected, colors, onView]);
  useEffect(() => () => onView(null), [onView]);

  const run = useCallback(
    async (file: ReferenceFile) => {
      setRunning(true);
      setErr(null);
      const key = geoKey;
      try {
        const opts: CompareOptions = { align: { mode, rotate, offset }, tolerance: tol, booleans: booleans ? "auto" : "never", map: wantMap };
        const out = await cad.compare(doc, file, opts);
        setRes(out);
        setResKey(key);
        setResAt(new Date().toLocaleString(cadLocale()));
        setSel(null);
        setShowMap(true);
      } catch (e) {
        setErr(isCancelled(e) ? tr("Porovnání bylo zrušeno.") : (e as Error).message);
      } finally {
        setRunning(false);
      }
    },
    [doc, geoKey, mode, rotate, offset, tol, booleans, wantMap],
  );

  const onFile = async (f: File) => {
    setLoadErr(null);
    setErr(null);
    const r = await prepareImport(f);
    if (r.kind !== "body") {
      setLoadErr(r.kind === "unsupported" ? r.message : tr("{0}: soubor obsahuje jen 2D výkres – jako referenci použijte 3D model (STEP).", f.name));
      return;
    }
    const file: ReferenceFile = { data: fromB64(r.data), format: r.format, fileName: f.name };
    setRef({ file, note: r.note, size: f.size });
    setRes(null);
    setSel(null);
    void run(file);
  };

  /** klik na oblast: zvýraznit a přiblížit (s okolím); druhý klik zvýraznění zruší a ukáže celý model */
  const pick = (g: NumberedRegion) => {
    if (sel === g.n) {
      setSel(null);
      vp.current?.fit();
      return;
    }
    setSel(g.n);
    vp.current?.focus(g.center, Math.max(1.25 * Math.hypot(...g.size), 2));
  };

  const meta = () => ({ model: doc.name, tolerance: tol, date: resAt });
  const live = (r: CompareResult): CompareResult => (r.map && stats ? { ...r, map: { ...r.map, stats } } : r);
  const base = () => (doc.name || "model").normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^\w.-]+/g, "_").slice(0, 60);
  const exportCsv = () => res && void saveFile(`${base()}-porovnani.csv`, compareReportCsv(live(res), meta()), "text/csv").catch(() => undefined);
  const exportTxt = () => res && void saveFile(`${base()}-porovnani.txt`, compareReportText(live(res), meta()), "text/plain").catch(() => undefined);
  const copyTxt = () => res && void navigator.clipboard?.writeText(compareReportText(live(res), meta())).catch(() => undefined);

  const noise = res ? (res.extra?.noise.count ?? 0) + (res.missing?.noise.count ?? 0) : 0;
  const noiseVol = res ? (res.extra?.noise.volume ?? 0) + (res.missing?.noise.volume ?? 0) : 0;

  return (
    <FloatPanel title={tr("Porovnat s referenčním modelem")} icon="xray" onClose={onClose} width={width} initial={{ x: 12, y: 12 }}>
      <div data-compare-dialog className="-mx-3 -my-3 max-h-[calc(100vh-190px)] overflow-y-auto px-3 py-3 text-[12px]">
        {/* soubor reference */}
        <input
          ref={fileRef}
          type="file"
          accept={ACCEPT}
          className="hidden"
          data-compare-file
          onChange={(e) => {
            const f = e.target.files?.[0];
            e.target.value = "";
            if (f) void onFile(f);
          }}
        />
        <div className="flex items-center gap-2">
          <Btn onClick={() => fileRef.current?.click()} disabled={running} className="shrink-0">
            {ref ? tr("Jiný soubor…") : tr("Vybrat referenci…")}
          </Btn>
          <span className="min-w-0 flex-1 truncate font-mono text-[11.5px] text-[#26303b]" title={ref?.file.fileName}>
            {ref ? `${ref.file.fileName} · ${nf(ref.size / 1024, 0)} kB` : tr("STEP, BREP, IGES nebo síť (STL, OBJ…)")}
          </span>
        </div>
        {ref?.note && <p className="mt-1 text-[11px] leading-snug text-[#8a5a00]">{ref.note} {tr("Síťová reference: přesnost je omezená sítí souboru.")}</p>}
        {loadErr && <p className="mt-1 text-[11.5px] leading-snug text-brand">{loadErr}</p>}

        {/* umístění reference */}
        <p className="mb-1 mt-3 text-[10.5px] font-semibold uppercase tracking-wider text-[#5b6776]">{tr("Umístění reference")}</p>
        <Segmented
          size="sm"
          value={mode}
          onChange={setMode}
          options={[
            { v: "none", l: tr("Jak je"), title: tr("reference v poloze ze souboru") },
            { v: "center", l: tr("Středy"), title: tr("střed obalového kvádru reference na střed kvádru modelu") },
            { v: "auto", l: tr("Automaticky"), title: tr("zkusí polohu ze souboru a 24 otočení po 90° se středy na sobě a vybere nejlépe sedící") },
          ]}
        />
        <div className="mt-1.5 grid grid-cols-[auto_1fr_1fr_1fr] items-center gap-x-1.5 gap-y-1">
          <span className="text-[11px] text-[#6b7785]">{tr("Otočení")}</span>
          {(["X", "Y", "Z"] as const).map((ax, k) => (
            <select
              key={ax}
              aria-label={tr("Otočení kolem {0}", ax)}
              title={mode === "auto" ? tr("v automatickém režimu se otočení hledá samo") : tr("Otočení kolem {0}", ax)}
              disabled={mode === "auto"}
              value={rotate[k]}
              onChange={(e) => setRotate((r) => r.map((v, i) => (i === k ? Number(e.target.value) : v)) as Vec3)}
              className="w-full min-w-0 rounded border border-[#cfd6de] bg-white px-1 py-1 text-[12px] disabled:opacity-40"
            >
              {ROTS.map((d) => (
                <option key={d} value={d}>
                  {ax} {d}°
                </option>
              ))}
            </select>
          ))}
          <span className="text-[11px] text-[#6b7785]">{tr("Posun mm")}</span>
          {(["X", "Y", "Z"] as const).map((ax, k) => (
            <NumIn key={ax} label={tr("Posun {0} (mm)", ax)} value={offset[k]} onChange={(v) => setOffset((o) => o.map((x, i) => (i === k ? v : x)) as Vec3)} />
          ))}
        </div>

        {/* tolerance a volby */}
        <div className="mt-2 grid grid-cols-2 gap-2">
          <label className="block">
            <span className="mb-0.5 block text-[10.5px] font-semibold uppercase tracking-wider text-[#5b6776]">{tr("Tolerance mm")}</span>
            <NumIn label={tr("Tolerance (mm)")} value={tol} min={0.0001} onChange={setTol} />
          </label>
          <label className="block">
            <span className="mb-0.5 block text-[10.5px] font-semibold uppercase tracking-wider text-[#5b6776]">{tr("Červená od mm")}</span>
            <NumIn label={tr("Plná červená od odchylky (mm)")} value={full} min={0.0001} onChange={setFull} />
          </label>
        </div>
        <Toggle label={tr("Rozdílová tělesa (seznam oblastí)")} checked={booleans} onChange={setBooleans} hint={tr("booleovské operace – u složité reference trvají déle")} />
        <Toggle label={tr("Mapa odchylek na modelu")} checked={wantMap} onChange={setWantMap} />
        <Btn primary onClick={() => ref && void run(ref.file)} disabled={!ref || running} className="mt-1 w-full">
          <span data-compare-run>{running ? tr("Porovnávám…") : res ? tr("Porovnat znovu") : tr("Porovnat")}</span>
        </Btn>
        {running && <p className="mt-1 text-[11px] text-[#6b7785]">{tr("Průběh a tlačítko Zrušit jsou dole uprostřed.")}</p>}
        {err && <p className="mt-1.5 text-[11.5px] leading-snug text-brand" data-compare-error>{err}</p>}

        {/* výsledky */}
        {res && (
          <div className="mt-3 border-t border-[#e3e8ee] pt-2" data-compare-result data-volume-diff={res.volumeDiff} data-extra={res.extra?.volume ?? ""} data-missing={res.missing?.volume ?? ""} data-regions={list.length}>
            {stale && <p className="mb-2 rounded bg-amber-50 px-2 py-1 text-[11.5px] text-[#8a5a00]">{tr("Model se od porovnání změnil – mapa je skrytá. Porovnejte znovu.")}</p>}
            <Stat k={tr("Objem modelu")} v={`${cm3(res.model.volume)} cm³`} />
            <Stat k={tr("Objem reference")} v={`${cm3(res.reference.volume)} cm³`} />
            <Stat k={tr("Rozdíl (model − reference)")} v={<span data-compare-diff>{`${cm3(res.volumeDiff)} cm³`}</span>} strong />
            {res.extra && <Stat k={tr("Navíc v modelu (model − ref.)")} v={<span style={{ color: EXTRA_COLOR }}>{`${cm3(res.extra.volume)} cm³`}</span>} data="extra" />}
            {res.missing && <Stat k={tr("Chybí v modelu (ref. − model)")} v={<span style={{ color: MISSING_COLOR }}>{`${cm3(res.missing.volume)} cm³`}</span>} data="missing" />}
            {noise > 0 && <Stat k={tr("Numerický šum ({0} těles)", noise)} v={`${cm3(noiseVol)} cm³`} />}
            {res.map && stats && (
              <>
                <Stat k={tr("Největší odchylka + / −")} v={`+${nf(stats.maxOut, 3)} / ${nf(stats.maxIn, 3)} mm`} />
                <Stat k={tr("V toleranci ±{0} mm", nf(tol, 3))} v={`${nf(100 * (stats.withinArea ?? stats.within), 1)} % ${tr("plochy")}`} data="within" />
              </>
            )}
            <p className="mt-1 text-[11px] leading-snug text-[#6b7785]">
              {tr("Zarovnání: {0}", alignText(res))} · {tr("výpočet {0} s", nf(res.ms.total / 1000, 1))}
            </p>
            {res.warnings.map((w, i) => (
              <p key={i} className="mt-1 rounded bg-amber-50 px-2 py-1 text-[11.5px] leading-snug text-[#8a5a00]" data-compare-warning>
                {w}
              </p>
            ))}

            {/* zobrazení */}
            {res.map && (
              <div className="mt-2">
                <Toggle label={tr("Barevná mapa odchylek")} checked={showMap} onChange={setShowMap} />
                {showMap && <CompareLegend tol={tol} full={Math.max(full, tol)} accuracy={res.map.accuracy} />}
                {res.map.capped && <p className="mt-1 text-[11px] text-[#8a5a00]">{tr("Síť pro mapu dosáhla limitu počtu trojúhelníků – uprostřed velkých rovinných ploch mohou body chybět.")}</p>}
              </div>
            )}
            {res.ghost && <Toggle label={tr("Reference průhledně")} checked={showGhost} onChange={setShowGhost} />}

            {/* oblasti */}
            <p className="mb-1 mt-2 text-[10.5px] font-semibold uppercase tracking-wider text-[#5b6776]">
              {res.extra || res.missing ? tr("Rozdílové oblasti ({0})", list.length) : tr("Rozdílové oblasti se nepočítaly")}
            </p>
            {(res.extra || res.missing) && list.length === 0 && <p className="text-[11.5px] text-[#2f7d4f]">{tr("Žádné rozdíly nad prahem šumu – modely se shodují.")}</p>}
            <div className="space-y-0.5">
              {list.map((g) => (
                <button
                  key={g.n}
                  type="button"
                  data-compare-region={g.n}
                  onClick={() => pick(g)}
                  title={tr("Kliknutím zvýraznit a přiblížit, dalším kliknutím zpět na celý model")}
                  className={cn("block w-full rounded border px-2 py-1 text-left hover:bg-[#f3f6f9]", sel === g.n ? "border-[#1f2933] bg-[#f3f6f9]" : "border-[#e3e8ee]")}
                >
                  <span className="flex items-baseline gap-1.5">
                    <span className="inline-block h-2 w-2 shrink-0 rounded-full" style={{ background: g.side === "extra" ? EXTRA_COLOR : MISSING_COLOR }} />
                    <span className="font-mono text-[11px] text-[#6b7785]">{g.n}.</span>
                    <span className="min-w-0 flex-1 truncate">{regionHint(g)}</span>
                    <span className="shrink-0 font-mono font-semibold">{cm3(g.volume)} cm³</span>
                  </span>
                  <span className="block pl-3.5 font-mono text-[10.5px] text-[#6b7785]">
                    {tr("{0} × {1} × {2} mm · střed {3}", nf(g.size[0], 1), nf(g.size[1], 1), nf(g.size[2], 1), pt(g.center, 1))}
                  </span>
                </button>
              ))}
              {[res.extra, res.missing].map((s, i) =>
                s?.more.count ? (
                  <p key={i} className="text-[11px] text-[#6b7785]">
                    {tr("… a dalších {0} oblastí ({1}), celkem {2} cm³", s.more.count, sideText(i ? "missing" : "extra"), cm3(s.more.volume))}
                  </p>
                ) : null,
              )}
            </div>
            {selected && (
              <div className="mt-2 rounded border border-[#e3e8ee] bg-[#f7f9fb] p-2" data-compare-selected>
                <p className="mb-1 font-semibold">
                  {tr("Oblast {0}: {1}", selected.n, sideText(selected.side))}
                </p>
                <Stat k={tr("Objem")} v={`${cm3(selected.volume)} cm³`} />
                <Stat k={tr("Střed obalového kvádru")} v={pt(selected.center)} />
                {selected.centroid && <Stat k={tr("Těžiště")} v={pt(selected.centroid)} />}
                <Stat k={tr("Od")} v={pt(selected.bbox[0])} />
                <Stat k={tr("Do")} v={pt(selected.bbox[1])} />
                <Stat k={tr("Rozměr")} v={pt(selected.size)} />
                <p className="mt-1 text-[11px] leading-snug text-[#4a5664]">{surfacesText(selected.surfaces)}</p>
                {!selected.mesh && <p className="mt-1 text-[11px] text-[#6b7785]">{tr("Zvýraznění jen u největších oblastí – použijte souřadnice.")}</p>}
              </div>
            )}

            {/* export */}
            <div className="mt-3 flex flex-wrap gap-1.5">
              <Btn onClick={exportCsv} className="flex items-center gap-1">
                <CadIcon name="export" className="h-3.5 w-3.5" /> CSV
              </Btn>
              <Btn onClick={exportTxt} className="flex items-center gap-1">
                <CadIcon name="export" className="h-3.5 w-3.5" /> {tr("Text")}
              </Btn>
              <Btn onClick={copyTxt} className="flex items-center gap-1">
                <CadIcon name="copy" className="h-3.5 w-3.5" /> {tr("Kopírovat")}
              </Btn>
            </div>
          </div>
        )}
      </div>
    </FloatPanel>
  );
}
