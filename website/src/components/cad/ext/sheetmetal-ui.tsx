"use client";

/**
 * UI plechových dílů: ikony, formuláře ohybu z hrany / lemu (ukládají geometrii vybraných hran pro rozvin v UI)
 * a akce Rozvin → DXF / SVG a Tabulka ohybů.
 */
import { tr } from "@/cad/i18n";
import { useEffect } from "react";
import { cad } from "@/cad/client";
import { getExt, type ExtParam } from "@/cad/ext/registry";
import { bendTable, flatLayout, flatToDxf, flatToSvg, type EdgeGeom, type EdgeResolver } from "@/cad/ext/sheetmetal-flat";
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
function FlangeForm({ f, onChange }: ExtFormProps) {
  const def = getExt(f.ext);
  const data = f.data ?? {};
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
        switch (p.kind) {
          case "number":
            return <Num key={p.key} label={p.label} value={typeof v === "number" ? v : 0} step={p.step ?? 1} min={p.min} suffix={p.unit ?? "mm"} hint={p.hint} bind={`${f.id}:data.${p.key}`} onChange={(n) => onChange({ [p.key]: p.max != null ? Math.min(p.max, n) : n })} />;
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

/** Rozvin v UI: hrany ohybů bere z geometrie uložené formulářem (edgeGeom). */
async function layoutFromDoc(doc: CadDoc) {
  const resolve: EdgeResolver = (fi, ei) => {
    const f = doc.features[fi];
    if (!f || f.type !== "ext") return null;
    const edges = (f.data.edges as number[] | undefined) ?? [];
    const geom = (f.data.edgeGeom as (EdgeGeom | null)[] | undefined) ?? [];
    return geom[edges.indexOf(ei)] ?? null;
  };
  return flatLayout(doc, resolve);
}

const safe = (s: string) => (s || "rozvin").normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^\w.-]+/g, "_").slice(0, 60);

async function exportFlat(api: ExtActionApi, kind: "dxf" | "svg") {
  try {
    const lay = await layoutFromDoc(api.doc);
    if (kind === "dxf") api.download(`${safe(api.doc.name)}_rozvin.dxf`, flatToDxf(lay, api.doc.name), "application/dxf");
    else api.download(`${safe(api.doc.name)}_rozvin.svg`, flatToSvg(lay, api.doc.name), "image/svg+xml");
    api.flash(lay.warnings.length ? tr("Rozvin uložen ({0} ohybů). Upozornění: {1}", lay.bends.length, lay.warnings[0]) : tr("Rozvin uložen – {0} ohybů, {1} × {2} mm.", lay.bends.length, Math.round((lay.bbox[1][0] - lay.bbox[0][0]) * 10) / 10, Math.round((lay.bbox[1][1] - lay.bbox[0][1]) * 10) / 10));
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
