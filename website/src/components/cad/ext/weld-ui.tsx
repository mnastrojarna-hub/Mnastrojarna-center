"use client";

/**
 * UI svařenců: ikony, formuláře (konstrukční profil, rám, housenka – ukládá délky hran pro tabulku svarů)
 * a akce Kusovník řezů (text + CSV) / Tabulka svarů.
 */
import { tr } from "@/cad/i18n";
import { useEffect } from "react";
import { cad } from "@/cad/client";
import { ALIGN_OPTIONS, beadData, cutListCsv, cutListText, PROFILE_FAMILIES, weldTableText, type ProfileFamily } from "@/cad/ext/weld-layout";
import { HEB, IPE, UPN } from "@/cad/library/tables";
import type { Feature } from "@/cad/types";
import { Num, Seg } from "../props";
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

/** Housenka: parametry + uložení délek vybraných hran (pro tabulku svarů počítanou v UI). */
function BeadForm({ f, onChange }: ExtFormProps) {
  const data = f.data ?? {};
  const b = beadData(data);
  const key = b.edges.join(",");
  useEffect(() => {
    let alive = true;
    (async () => {
      const lens: number[] = [];
      for (const i of b.edges) {
        try {
          const info = await cad.inspect({ kind: "part" }, { kind: "edge", index: i });
          lens.push(typeof info.length === "number" ? info.length : 0);
        } catch {
          lens.push(0);
        }
      }
      if (alive && JSON.stringify(lens) !== JSON.stringify(b.edgeLens)) onChange({ edgeLens: lens });
    })();
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  return (
    <div className="space-y-3">
      <div className="rounded-lg border border-dashed border-ink-700/20 p-2.5 text-[12.5px]">
        <span className="font-medium">{tr("Hrany koutu:")}</span> {b.edges.length ? tr("{0} vybráno ({1} mm)", b.edges.length, Math.round(b.edgeLens.reduce((s, x) => s + x, 0))) : tr("klikněte na hranu vnitřního rohu v modelu")}
        {b.edges.length > 0 && (
          <button type="button" className="ml-2 text-brand hover:underline" onClick={() => onChange({ edges: [], edgeLens: [] })}>
            {tr("vymazat")}
          </button>
        )}
      </div>
      <Num label={tr("Velikost svaru a")} value={b.a} min={0.5} step={0.5} bind={`${f.id}:data.a`} onChange={(v) => onChange({ a: v })} />
      <label className="flex items-center gap-2 text-[13px]">
        <input type="checkbox" className="accent-[#E03930]" checked={b.intermittent} onChange={(e) => onChange({ intermittent: e.target.checked })} />
        {tr("Přerušovaný svar")}
      </label>
      {b.intermittent && (
        <div className="grid grid-cols-2 gap-2">
          <Num label={tr("Délka úseku")} value={b.segLen} min={1} onChange={(v) => onChange({ segLen: v })} />
          <Num label={tr("Rozteč")} value={b.pitch} min={1} onChange={(v) => onChange({ pitch: v })} />
        </div>
      )}
      <p className="text-[11px] leading-snug text-ink-700/50">{tr("Koutový svar a×a se vymodeluje jako trojúhelníkový hranol podél hrany; objem svarového kovu ≈ a²/2 × délka (Tabulka svarů).")}</p>
    </div>
  );
}

registerExtUi("weld.member", { Form: MemberForm });
registerExtUi("weld.frame", { Form: FrameForm });
registerExtUi("weld.bead", { Form: BeadForm });

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
  action: (api) => api.notice(tr("Tabulka svarů"), weldTableText(api.doc)),
});
