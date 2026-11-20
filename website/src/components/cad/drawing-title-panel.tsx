"use client";

/**
 * Razítko ve výkresovém prostředí: šablona (ISO 7200 / kompaktní / nástrojářská), logo (nahrání obrázku), firma a
 * všechna pole razítka, nepředepsané tolerance (ISO 2768 třída nebo tabulka podle desetinných míst), tolerance úhlů
 * a sražení. Stejná data jako textový příkaz `výkres razítko pole=hodnota` (cad/agent-title.ts, cad/title-block.ts).
 */
import { TitleTemplateRow } from "./title-template-row";
import type { TitleTemplateRec } from "@/cad/title-templates";
import { useRef, useState } from "react";
import { tr } from "@/cad/i18n";
import type { DrawingMeta } from "@/cad/drawing";
import { attachedFiles, readFileAsDataUrl } from "@/cad/attached-files";
import { DEFAULT_DECIMALS, generalTolFields, generalTolOf, templateLabel, titleBlockSize, TITLE_TEMPLATES, titleTemplateOf, type GeneralTol, type TitleTemplate } from "@/cad/title-block";
import { encodePng, prepareLogo, rasterInBrowser, toDataUrl } from "@/cad/title-logo";
import { cn } from "@/lib/cn";

type Props = {
  meta: DrawingMeta;
  setM: (patch: Partial<DrawingMeta>) => void;
  /** číslo, kreslil a revize i do vlastností dokumentu (po opuštění pole) */
  persistProps: () => void;
  onMaterialChange?: (name: string) => void;
  /** sestava: nepředepsané tolerance se nevyžadují */
  assembly?: boolean;
  flash: (m: string) => void;
  /** list, ke kterému patří `meta` (id listu) – volba „Vlastní text“ bez textu platí jen pro list, na kterém se zvolila */
  sheetKey?: string;
  /** pojmenované šablony hlavičky dokumentu a jejich zápis do dokumentu (vlna 22, bod 22j) */
  docTemplates?: TitleTemplateRec[];
  onDocTemplates?: (list: TitleTemplateRec[] | undefined) => void;
};

const inputCls = "w-full rounded-md border border-ink-700/15 bg-white px-2 py-1 text-[12.5px] outline-none focus:border-brand focus:ring-2 focus:ring-brand/15";
const selectCls = "w-full rounded-md border border-ink-700/15 bg-white px-1.5 py-1 text-[12.5px] outline-none focus:border-brand";

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="block min-w-0">
      <span className="mb-0.5 block text-[11px] text-ink-700/55">{label}</span>
      {children}
    </div>
  );
}
function Field({ label, value, onChange, onBlur, placeholder, name }: { label: string; value?: string; onChange: (v: string) => void; onBlur?: () => void; placeholder?: string; name: string }) {
  return (
    <Row label={label}>
      <input className={inputCls} data-title-field={name} aria-label={label} value={value ?? ""} placeholder={placeholder} onChange={(e) => onChange(e.target.value)} onBlur={onBlur} />
    </Row>
  );
}

export type TolMode = "none" | "iso2768" | "decimals" | "text";
const modeOf = (g: GeneralTol | null): TolMode => (g ? g.kind : "none");
/**
 * Režim výběru nepředepsaných tolerancí v panelu: podle údajů listu; bez hodnoty jen „Vlastní text“ zvolený na tomtéž
 * listu (`textOn` = list, kde se zvolil) – jinak „nezadané“ (volba z jiného listu se nepřenáší).
 */
export const panelTolMode = (g: GeneralTol | null, textOn: string | null, sheetKey: string): TolMode => (g ? modeOf(g) : textOn !== null && textOn === sheetKey ? "text" : "none");

/** Sekce „Razítko“ výkresového prostředí. */
export function TitleBlockSection({ meta, setM, persistProps, onMaterialChange, assembly, flash, sheetKey = "", docTemplates, onDocTemplates }: Props) {
  const tpl = titleTemplateOf(meta);
  const g = generalTolOf(meta);
  // režim se odvozuje z údajů listu; jediný stav bez hodnoty je „Vlastní text“ s prázdným polem – zapamatuje se
  // pro list, na kterém se zvolil (přepnutí listu ani zrušení tolerancí textem nenechá v panelu cizí režim)
  const [textOn, setTextOn] = useState<string | null>(null);
  const file = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const curMode = panelTolMode(g, textOn, sheetKey);
  const setTol = (next: GeneralTol | null) => setM({ ...generalTolFields(next), ...(next?.kind === "decimals" ? {} : { tolTable: undefined }) });
  const iso = g?.kind === "iso2768" ? g : { kind: "iso2768" as const, lin: "m" as const, geo: "K" as const };
  const rows = g?.kind === "decimals" ? g.rows : DEFAULT_DECIMALS;

  const onLogo = async (f: File) => {
    setBusy(true);
    try {
      const url = await readFileAsDataUrl(f);
      // SVG zůstává vektorem (+ PNG náhled a obrys pro DXF / DWG – vlna 22, bod 22j); ostatní obrázky prohlížeče (PNG, JPEG,
      // WebP …) → PNG nejvýš 600 × 300 px + obrys pro DXF / DWG
      const isSvg = /svg/i.test(f.type) || /\.svg$/i.test(f.name);
      const { logo, warnings } = isSvg ? await prepareLogo(url, f.name) : await prepareLogo(toDataUrl("image/png", await encodePng(await rasterInBrowser(url))), f.name);
      attachedFiles.add({ name: f.name, mime: f.type || "image/png", dataUrl: url, bytes: f.size });
      setM({ logo });
      flash([tr("Logo „{0}“ {1}×{2} px vloženo do razítka", f.name, logo.w, logo.h), ...warnings].join(" · "));
    } catch (e) {
      flash(tr("Logo se nepodařilo načíst: {0}", (e as Error).message));
    } finally {
      setBusy(false);
      if (file.current) file.current.value = "";
    }
  };

  return (
    <div className="space-y-2" data-title-panel>
      <TitleTemplateRow meta={meta} setM={setM} docTemplates={docTemplates} onDocTemplates={onDocTemplates} flash={flash} />
      <Row label={tr("Šablona razítka")}>
        <select className={selectCls} aria-label={tr("Šablona razítka")} data-title-template value={tpl} onChange={(e) => setM({ template: e.target.value === "iso7200" ? undefined : (e.target.value as TitleTemplate) })}>
          {TITLE_TEMPLATES.map((t) => (
            <option key={t} value={t}>
              {templateLabel(t)} – {titleBlockSize({ template: t }).w}×{titleBlockSize({ template: t }).h} mm
            </option>
          ))}
        </select>
      </Row>
      <p className="-mt-1 text-[10.5px] leading-snug text-ink-700/50">{tr("Pole, která šablona nemá, se vypíšou v patičce nad razítkem. Výchozí šablona nových listů je v Nastavení → Výkres.")}</p>

      <div className="flex items-end gap-2">
        <div className="min-w-0 flex-1">
          <Field name="company" label={tr("Firma (vlastník výkresu)")} value={meta.company} onChange={(v) => setM({ company: v })} placeholder="Mnástrojárna s.r.o." />
        </div>
        <div className="flex shrink-0 flex-col items-center gap-0.5">
          <span className="text-[11px] text-ink-700/55">{tr("Logo")}</span>
          <div className="flex items-center gap-1">
            {meta.logo?.src ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={meta.logo.src} alt={tr("Logo")} data-title-logo className="h-7 max-w-[64px] rounded border border-ink-700/10 bg-white object-contain" />
            ) : null}
            <button type="button" disabled={busy} onClick={() => file.current?.click()} className="rounded border border-ink-700/20 px-1.5 py-1 text-[11.5px] hover:border-brand hover:text-brand disabled:opacity-50" title={tr("Nahrát obrázek loga (PNG, JPEG, SVG) – zmenší se na nejvýš 600 × 300 px")}>
              {meta.logo?.src ? tr("Změnit") : tr("Nahrát…")}
            </button>
            {meta.logo?.src && (
              <button type="button" onClick={() => setM({ logo: undefined })} className="px-1 text-ink-700/40 hover:text-brand" title={tr("Odebrat logo")} aria-label={tr("Odebrat logo")}>
                ×
              </button>
            )}
          </div>
          <input ref={file} type="file" accept="image/png,image/jpeg,image/svg+xml,image/webp,image/gif" className="hidden" data-title-logo-input onChange={(e) => e.target.files?.[0] && void onLogo(e.target.files[0])} />
        </div>
      </div>

      <Field name="name" label={tr("Název")} value={meta.name} onChange={(v) => setM({ name: v })} />
      <Field name="number" label={tr("Číslo výkresu")} value={meta.number} onChange={(v) => setM({ number: v })} onBlur={persistProps} placeholder={tr("např. MN-2026-001")} />
      <div className="grid grid-cols-2 gap-2">
        <Field name="customer" label={tr("Zákazník")} value={meta.customer} onChange={(v) => setM({ customer: v })} />
        <Field name="project" label={tr("Projekt")} value={meta.project} onChange={(v) => setM({ project: v })} />
      </div>
      <div className="grid grid-cols-3 gap-2">
        <Field name="author" label={tr("Kreslil")} value={meta.author} onChange={(v) => setM({ author: v })} onBlur={persistProps} />
        <Field name="checkedBy" label={tr("Kontroloval")} value={meta.checkedBy} onChange={(v) => setM({ checkedBy: v })} />
        <Field name="approvedBy" label={tr("Schválil")} value={meta.approvedBy} onChange={(v) => setM({ approvedBy: v })} />
      </div>
      <div className="grid grid-cols-2 gap-2">
        <Field name="revision" label={tr("Revize")} value={meta.revision} onChange={(v) => setM({ revision: v })} onBlur={persistProps} placeholder={meta.revisions?.length ? meta.revisions[meta.revisions.length - 1].rev : "A"} />
        <Field name="date" label={tr("Datum")} value={meta.date} onChange={(v) => setM({ date: v })} />
      </div>
      <Row label={tr("Materiál")}>
        <input className={inputCls} data-title-field="material" aria-label={tr("Materiál")} value={meta.material} onChange={(e) => setM({ material: e.target.value })} onBlur={() => onMaterialChange?.(meta.material)} placeholder={tr("označení do razítka, např. ČSN 11 423")} />
      </Row>
      <div className="grid grid-cols-2 gap-2">
        <Field name="stock" label={tr("Polotovar")} value={meta.stock} onChange={(v) => setM({ stock: v })} placeholder={tr("např. plech 40×160×185")} />
        <Field name="quantity" label={tr("Počet kusů")} value={meta.quantity} onChange={(v) => setM({ quantity: v })} placeholder="1" />
      </div>
      <div className="grid grid-cols-2 gap-2">
        <Field name="heatTreatment" label={tr("Tepelné zpracování")} value={meta.heatTreatment} onChange={(v) => setM({ heatTreatment: v })} placeholder={tr("např. kalit 58–60 HRC")} />
        <Field name="surfaceTreatment" label={tr("Povrchová úprava")} value={meta.surfaceTreatment} onChange={(v) => setM({ surfaceTreatment: v })} placeholder={tr("např. černit")} />
      </div>

      <Row label={tr("Nepředepsané tolerance")}>
        <select
          className={selectCls}
          aria-label={tr("Nepředepsané tolerance")}
          data-title-tol-mode
          value={curMode}
          onChange={(e) => {
            const m = e.target.value as TolMode;
            setTextOn(m === "text" ? sheetKey : null);
            if (m === "none") setTol(null);
            else if (m === "iso2768") setTol(iso);
            else if (m === "decimals") setTol({ kind: "decimals", rows: [...rows] });
            else setTol({ kind: "text", text: g?.kind === "text" ? g.text : "" });
          }}
        >
          <option value="none">{tr("— nezadané —")}</option>
          <option value="iso2768">{tr("ISO 2768 – třída přesnosti")}</option>
          <option value="decimals">{tr("Tabulka podle desetinných míst")}</option>
          <option value="text">{tr("Vlastní text")}</option>
        </select>
      </Row>
      {curMode === "iso2768" && (
        <div className="grid grid-cols-2 gap-2">
          <Row label={tr("Délky a úhly (ISO 2768-1)")}>
            <select className={selectCls} aria-label={tr("Délky a úhly (ISO 2768-1)")} data-title-tol-lin value={iso.lin} onChange={(e) => setTol({ ...iso, lin: e.target.value as "m" })}>
              <option value="f">{tr("f – jemná")}</option>
              <option value="m">{tr("m – střední")}</option>
              <option value="c">{tr("c – hrubá")}</option>
              <option value="v">{tr("v – velmi hrubá")}</option>
            </select>
          </Row>
          <Row label={tr("Geometrie (ISO 2768-2)")}>
            <select className={selectCls} aria-label={tr("Geometrie (ISO 2768-2)")} data-title-tol-geo value={iso.geo ?? ""} onChange={(e) => setTol({ kind: "iso2768", lin: iso.lin, ...(e.target.value ? { geo: e.target.value as "K" } : {}) })}>
              <option value="">—</option>
              <option value="H">H</option>
              <option value="K">K</option>
              <option value="L">L</option>
            </select>
          </Row>
        </div>
      )}
      {curMode === "decimals" && (
        <div className="grid grid-cols-4 gap-1.5">
          {["X.", "X.X", "X.XX", "X.XXX"].map((lab, i) => (
            <Row key={lab} label={lab}>
              <input className={cn(inputCls, "font-mono")} aria-label={tr("Tolerance pro {0}", lab)} data-title-tol-dec={i} value={rows[i]} onChange={(e) => setTol({ kind: "decimals", rows: rows.map((r, k) => (k === i ? e.target.value : r)) })} />
            </Row>
          ))}
        </div>
      )}
      {curMode === "text" && <input className={inputCls} aria-label={tr("Nepředepsané tolerance – text")} value={g?.kind === "text" ? g.text : ""} placeholder={tr("např. DIN ISO 2768-mK")} onChange={(e) => setTol(e.target.value.trim() ? { kind: "text", text: e.target.value } : null)} />}
      {!g && !assembly && <p className="text-[10.5px] leading-snug text-brand" data-title-tol-warning>{tr("⚠ Bez nepředepsaných tolerancí – export výkresu to ohlásí.")}</p>}
      <div className="grid grid-cols-2 gap-2">
        <Field name="angleTol" label={tr("Tolerance úhlů")} value={meta.angleTol} onChange={(v) => setM({ angleTol: v })} placeholder={g?.kind === "iso2768" ? `ISO 2768-${g.lin}` : "±0°30′"} />
        <Field name="chamferTol" label={tr("Tolerance sražení")} value={meta.chamferTol} onChange={(v) => setM({ chamferTol: v })} placeholder={g?.kind === "iso2768" ? `ISO 2768-${g.lin}` : "±0,2"} />
      </div>
    </div>
  );
}
