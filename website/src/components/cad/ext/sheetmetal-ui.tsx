"use client";

/**
 * UI plechových dílů: ikony, formuláře ohybu z hrany / lemu (ukládají geometrii vybraných hran pro rozvin v UI)
 * a akce Rozvin → DXF / SVG a Tabulka ohybů.
 */
import { tr } from "@/cad/i18n";
import { useEffect } from "react";
import { cad, type TopologyResult } from "@/cad/client";
import { getExt, type ExtParam } from "@/cad/ext/registry";
import { flangeFieldState } from "@/cad/ext/sheetmetal";
import { bendTable, flangeNumber, flatLayout, flatToDxf, flatToSvg, sheetParamsAt, type EdgeGeom, type EdgeResolver, type FaceResolver } from "@/cad/ext/sheetmetal-flat";
import type { CadDoc, Vec3 } from "@/cad/types";
import { Num, Seg } from "../props";
import { registerIcon } from "./icons";
import { registerExtUi, type ExtActionApi, type ExtFormProps } from "./registry";

// ---------- ikony ----------
registerIcon("sheet-base", <><path d="M3 15l9-5 9 5-9 5z" /><path d="M3 15v2l9 5 9-5v-2" /></>);
registerIcon("sheet-params", <><path d="M3 15l9-5 9 5-9 5z" /><path d="M12 3v4M10 5h4" /><path d="M18 4l2 2-2 2" /></>);
registerIcon("sheet-flange", <><path d="M3 18h9a2 2 0 0 0 2-2V6" /><path d="M3 20h9a4 4 0 0 0 4-4V6" /><path d="M14 6h2" /></>);
registerIcon("sheet-hem", <><path d="M3 14h12a3 3 0 0 0 0-6H9" /><path d="M3 16h12a5 5 0 0 0 0-10H9" /></>);
registerIcon("sheet-bend", <><path d="M3 17l8-4 8-9" /><path d="M3 19l8-4 10-11" /><path d="M11 13v3" strokeDasharray="1 1.2" /></>);
registerIcon("sheet-cut", <><path d="M3 15l9-5 9 5-9 5z" /><circle cx="12" cy="15" r="2.2" /></>);
registerIcon("sheet-relief", <><path d="M4 20V8h12" /><path d="M8 12h4v4H8z" /><path d="M4 8l4-4h12" /></>);
registerIcon("sheet-rib", <><path d="M3 16h5a4 3 0 0 1 8 0h5" /><path d="M3 18h18" /></>);
registerIcon("sheet-unfold", <><rect x="3" y="7" width="18" height="10" rx="1" /><path d="M9 7v10M15 7v10" strokeDasharray="1.5 1.5" /></>);
registerIcon("sheet-dxf", <><rect x="4" y="3" width="16" height="18" rx="1.5" /><path d="M8 8h8M8 12h8M8 16h5" /><path d="M11 8v8" strokeDasharray="1.5 1.5" /></>);
registerIcon("sheet-table", <><rect x="3" y="5" width="18" height="14" rx="1.5" /><path d="M3 10h18M9 5v14M15 5v14" /></>);

// ---------- formuláře ohybu z hrany / lemu ----------

const parseVec = (s: string | undefined): Vec3 | null => {
  if (!s) return null;
  const parts = s.split(";").map((x) => Number(x.replace(/\s/g, "").replace(",", ".")));
  return parts.length === 3 && parts.every(Number.isFinite) ? (parts as Vec3) : null;
};

/** Formulář: parametry z registru + uložení koncových bodů vybraných hran (pro rozvin počítaný v UI). */
function FlangeForm({ f, doc, onChange }: ExtFormProps) {
  const def = getExt(f.ext);
  const data = f.data ?? {};
  const idx = doc.features.findIndex((x) => x.id === f.id);
  const sheet = sheetParamsAt(doc, idx >= 0 ? idx : doc.features.length);
  const edges = (data.edges as number[] | undefined) ?? [];
  const geom = (data.edgeGeom as (EdgeGeom | null)[] | undefined) ?? [];
  const key = edges.join(",");
  useEffect(() => {
    let alive = true;
    (async () => {
      const out: (EdgeGeom | null)[] = [];
      for (const i of edges) {
        try {
          const info = await cad.inspect({ kind: "part" }, { kind: "edge", index: i });
          const a = parseVec(info.rows.find((r) => r[0] === tr("Začátek"))?.[1]);
          const b = parseVec(info.rows.find((r) => r[0] === tr("Konec"))?.[1]);
          out.push(a && b ? { a, b } : null);
        } catch {
          out.push(null);
        }
      }
      if (alive && JSON.stringify(out) !== JSON.stringify(geom)) onChange({ edgeGeom: out });
    })();
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  if (!def?.params) return null;
  return (
    <>
      {def.params.map((p: ExtParam) => {
        const v = data[p.key];
        // pole, které se při ostatních hodnotách neuplatní (úleva bez druhu, úhel kapky u jiného lemu…), je zašedlé s vysvětlením
        const st = flangeFieldState(f.ext, p.key, data, sheet);
        switch (p.kind) {
          case "number":
            return (
              <fieldset key={p.key} disabled={!!st.off} data-field={p.key} data-off={st.off ? "1" : undefined} className={st.off ? "opacity-50" : undefined}>
                <Num label={p.label} value={flangeNumber(f.ext, p.key, data, sheet)} step={p.step ?? 1} min={p.min} suffix={p.unit ?? "mm"} hint={st.note ?? p.hint} bind={`${f.id}:data.${p.key}`} onChange={(n) => onChange({ [p.key]: p.max != null ? Math.min(p.max, n) : n })} />
              </fieldset>
            );
          case "bool":
            return (
              <label key={p.key} className="flex items-center gap-2 text-[13px]">
                <input type="checkbox" checked={!!v} onChange={(e) => onChange({ [p.key]: e.target.checked })} className="accent-[#E03930]" />
                {p.label}
              </label>
            );
          case "enum":
            return <Seg key={p.key} label={p.label} value={String(v ?? p.options[0]?.v ?? "")} options={p.options} onChange={(x) => onChange({ [p.key]: x })} />;
          case "edges":
            return (
              <div key={p.key} className="rounded-lg border border-dashed border-ink-700/20 p-2.5 text-[12.5px]">
                <span className="font-medium">{p.label}:</span> {edges.length ? tr("{0} vybráno", edges.length) : tr("klikněte na rovnou hranu plechu v modelu")}
                {edges.length > 0 && (
                  <button type="button" className="ml-2 text-brand hover:underline" onClick={() => onChange({ edges: [], edgeGeom: [] })}>
                    {tr("vymazat")}
                  </button>
                )}
                {p.hint && <p className="mt-1 text-[11px] text-ink-700/45">{p.hint}</p>}
              </div>
            );
          default:
            return null;
        }
      })}
    </>
  );
}
registerExtUi("sheet.flange", { Form: FlangeForm });
registerExtUi("sheet.hem", { Form: FlangeForm });

// ---------- akce: rozvin ----------

/**
 * Rozvin v UI: hrany ohybů a plochy tvářecích nástrojů bere z geometrie uložené formulářem (edgeGeom, faceGeom). Chybí-li
 * (prvek zadaný textem nebo JSON), dopočte je jádro z tělesa před prvkem (`cad.topology`) a pak obnoví model celého dílu.
 */
async function layoutFromDoc(doc: CadDoc) {
  const topo = new Map<number, Promise<TopologyResult | null>>();
  const topoAt = (fi: number) => {
    if (!topo.has(fi)) topo.set(fi, cad.topology({ ...doc, features: doc.features.slice(0, fi) }).catch(() => null));
    return topo.get(fi)!;
  };
  const resolve: EdgeResolver = async (fi, ei) => {
    const f = doc.features[fi];
    if (!f || f.type !== "ext") return null;
    const edges = (f.data.edges as number[] | undefined) ?? [];
    const geom = (f.data.edgeGeom as (EdgeGeom | null)[] | undefined) ?? [];
    const stored = geom[edges.indexOf(ei)];
    if (stored) return stored;
    const e = (await topoAt(fi))?.edges[ei];
    if (!e?.center || !e.dir || !e.length || (e.curve && !/line/i.test(e.curve))) return null;
    const h = e.length / 2;
    return { a: [e.center[0] - e.dir[0] * h, e.center[1] - e.dir[1] * h, e.center[2] - e.dir[2] * h], b: [e.center[0] + e.dir[0] * h, e.center[1] + e.dir[1] * h, e.center[2] + e.dir[2] * h] };
  };
  const resolveFace: FaceResolver = async (fi, fx) => {
    const fc = (await topoAt(fi))?.faces[fx];
    return fc?.planar && fc.center && fc.normal ? { origin: fc.center, normal: fc.normal } : null;
  };
  try {
    return await flatLayout(doc, resolve, doc.features.length, resolveFace);
  } finally {
    // jádro po dopočtu drží těleso zkrácené historie – vrátit model celého dílu (výběr ploch, měření)
    if (topo.size) await cad.build(doc).catch(() => null);
  }
}

const safe = (s: string) => (s || "rozvin").normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^\w.-]+/g, "_").slice(0, 60);

async function exportFlat(api: ExtActionApi, kind: "dxf" | "svg") {
  try {
    const lay = await layoutFromDoc(api.doc);
    if (kind === "dxf") api.download(`${safe(api.doc.name)}_rozvin.dxf`, flatToDxf(lay, api.doc.name), "application/dxf");
    else api.download(`${safe(api.doc.name)}_rozvin.svg`, flatToSvg(lay, api.doc.name), "image/svg+xml");
    const w = Math.round((lay.bbox[1][0] - lay.bbox[0][0]) * 10) / 10;
    const h = Math.round((lay.bbox[1][1] - lay.bbox[0][1]) * 10) / 10;
    api.flash(lay.warnings.length ? tr("Rozvin uložen ({0} ohybů). Upozornění: {1}", lay.bends.length, lay.warnings[0]) : lay.forms.length ? tr("Rozvin uložen – {0} ohybů, {1} tvářených prvků ve vrstvě FORM, {2} × {3} mm.", lay.bends.length, lay.forms.length, w, h) : tr("Rozvin uložen – {0} ohybů, {1} × {2} mm.", lay.bends.length, w, h));
  } catch (e) {
    api.flash((e as Error).message);
  }
}

registerExtUi("sheet.dxf", { action: (api) => exportFlat(api, "dxf") });
registerExtUi("sheet.svg", { action: (api) => exportFlat(api, "svg") });
registerExtUi("sheet.table", {
  action: async (api) => {
    try {
      const lay = await layoutFromDoc(api.doc);
      api.notice(tr("Tabulka ohybů"), bendTable(lay));
    } catch (e) {
      api.flash((e as Error).message);
    }
  },
});

export {};
