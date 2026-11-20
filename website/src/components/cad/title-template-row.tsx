"use client";

/**
 * Pojmenované šablony hlavičky v panelu razítka (vlna 22, bod 22j): výběr šablony (dokument + Nastavení) a „Použít“,
 * „Uložit jako šablonu hlavičky“ (název, volitelně výchozí pro nové listy). Stejný model jako text `výkres hlavička …`
 * (cad/title-templates.ts): šablona se uloží do Nastavení i do dokumentu (jde do .mncad, sdílení a skriptu).
 */
import { useState } from "react";
import type { DrawingMeta } from "@/cad/drawing";
import { tr } from "@/cad/i18n";
import { loadSettings, saveSettings } from "@/cad/settings";
import { applyTemplate, sameName, settingsTemplates, templateFromMeta, templateText, TEMPLATE_FIELDS, type TitleTemplateRec } from "@/cad/title-templates";

type Props = {
  meta: DrawingMeta;
  setM: (patch: Partial<DrawingMeta>) => void;
  docTemplates?: TitleTemplateRec[];
  onDocTemplates?: (list: TitleTemplateRec[] | undefined) => void;
  flash: (m: string) => void;
};

const inputCls = "min-w-0 flex-1 rounded-md border border-ink-700/15 bg-white px-2 py-1 text-[12px] outline-none focus:border-brand";
const btnCls = "rounded-md border border-ink-700/15 px-2 py-1 text-[11px] hover:bg-steel-100 disabled:opacity-40";

export function TitleTemplateRow({ meta, setM, docTemplates, onDocTemplates, flash }: Props) {
  const [name, setName] = useState("");
  const [def, setDef] = useState(false);
  const [, bump] = useState(0);
  const docT = docTemplates ?? [];
  const all = [...docT, ...settingsTemplates().filter((t) => !docT.some((d) => sameName(d.name, t.name)))];
  const cur = meta.titleTpl ?? "";
  const use = (n: string) => {
    const rec = all.find((t) => sameName(t.name, n));
    if (!rec) return;
    const next: Record<string, unknown> = { ...meta };
    applyTemplate(next, rec);
    // patch se všemi klíči šablony (odebrané = undefined)
    const patch: Record<string, unknown> = { template: next.template, logo: next.logo, tolTable: next.tolTable, titleTpl: rec.name };
    for (const k of TEMPLATE_FIELDS) if (rec.fields?.[k] !== undefined) patch[k] = next[k];
    setM(patch as Partial<DrawingMeta>);
    if (!docT.some((d) => sameName(d.name, rec.name))) onDocTemplates?.([...docT, rec]);
    flash(tr("Razítko podle šablony hlavičky {0}", templateText(rec)));
  };
  const save = () => {
    const n = name.trim();
    if (!n) return;
    const rec = templateFromMeta(n, meta);
    const s = loadSettings();
    saveSettings({ ...s, titleTemplates: [...(s.titleTemplates ?? []).filter((t) => !sameName(t.name, n)), rec], ...(def ? { titleTemplateDefault: n } : {}) });
    onDocTemplates?.([...docT.filter((t) => !sameName(t.name, n)), rec]);
    setM({ titleTpl: n });
    setName("");
    bump((x) => x + 1);
    flash(tr("Šablona hlavičky {0} uložena do dokumentu i do Nastavení{1}", templateText(rec), def ? tr(" · výchozí pro nové listy") : ""));
  };
  return (
    <div className="mb-2 space-y-1 rounded-md border border-ink-700/10 p-1.5" data-title-tpl>
      <div className="flex items-center gap-1">
        <span className="shrink-0 text-[11px] text-ink-700/70">{tr("Šablona hlavičky")}</span>
        <select className={inputCls} data-title-tpl-select value={all.some((t) => sameName(t.name, cur)) ? all.find((t) => sameName(t.name, cur))!.name : ""} onChange={(e) => e.target.value && use(e.target.value)} aria-label={tr("Šablona hlavičky")}>
          <option value="">{all.length ? tr("— vyberte —") : tr("— žádná uložená —")}</option>
          {all.map((t) => (
            <option key={t.name} value={t.name}>
              {t.name}
              {docT.some((d) => sameName(d.name, t.name)) ? "" : tr(" (Nastavení)")}
            </option>
          ))}
        </select>
      </div>
      <div className="flex items-center gap-1">
        <input className={inputCls} data-title-tpl-name value={name} placeholder={tr("název nové šablony")} onChange={(e) => setName(e.target.value)} aria-label={tr("Název šablony hlavičky")} />
        <label className="flex shrink-0 items-center gap-0.5 text-[10.5px]" title={tr("Nové listy převezmou tuto šablonu (logo, firmu, druh razítka)")}>
          <input type="checkbox" data-title-tpl-default checked={def} onChange={(e) => setDef(e.target.checked)} />
          {tr("výchozí")}
        </label>
        <button type="button" className={btnCls} data-title-tpl-save disabled={!name.trim()} onClick={save}>
          {tr("Uložit jako šablonu")}
        </button>
      </div>
    </div>
  );
}
