/**
 * Pojmenované šablony hlavičky (razítka) s logem (vlna 22, bod 22j).
 *
 * Dřív Nastavení drželo jen druh šablony (iso7200 / kompaktní / nástrojářská) a logo s firmou se dědilo jen do dalších listů
 * téhož dokumentu. Teď je šablona hlavičky pojmenovaný záznam: druh razítka, logo (PNG i SVG – `TitleLogo.svg`), firma,
 * zákazník, projekt, kreslil / kontroloval / schválil, nepředepsané tolerance, hrany, úpravy. Ukládá se:
 * - v Nastavení (`Settings.titleTemplates`, výchozí pro nové listy `Settings.titleTemplateDefault`) – pro další dokumenty,
 * - v dokumentu (`CadDoc.titleTemplates`) – jde s ním do .mncad, do sdíleného odkazu (payload = dokument) i do skriptu
 *   (`výkres hlavička uložit "…" pole=…`, doc-script-sheet.ts); list nese název použité šablony (`meta.titleTpl`).
 * Text: `výkres hlavička [uložit "X" [výchozí] [pole=…] | použít "X" | smazat "X"]`, `výkres razítko šablona="X"`.
 */
import type { DrawingMeta } from "./drawing";
import { tr } from "./i18n";
import { loadSettings, saveSettings } from "./settings";
import { templateLabel, titleTemplateOf, type TitleFieldKey, type TitleLogo, type TitleTemplate } from "./title-block";
import type { CadDoc } from "./types";

/** pole razítka, která šablona hlavičky nese (údaje listu jako název, číslo, revize, datum, materiál, kusy ne) */
export const TEMPLATE_FIELDS = ["company", "customer", "project", "author", "checkedBy", "approvedBy", "tolerance", "angleTol", "chamferTol", "edges", "heatTreatment", "surfaceTreatment", "note"] as const satisfies readonly TitleFieldKey[];
export type TemplateField = (typeof TEMPLATE_FIELDS)[number];

export type TitleTemplateRec = {
  name: string;
  /** druh razítka (bez hodnoty = ISO 7200) */
  template?: TitleTemplate;
  logo?: TitleLogo;
  fields?: Partial<Record<TemplateField, string>>;
  /** nepředepsané tolerance jako tabulka podle desetinných míst */
  tolTable?: string[];
};

const fold = (s: string) => s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/\s+/g, " ").trim();
export const sameName = (a: string, b: string) => fold(a) === fold(b);

/** šablona hlavičky z údajů listu (druh, logo, pole šablony, tabulka tolerancí) */
export function templateFromMeta(name: string, meta: Partial<DrawingMeta>): TitleTemplateRec {
  const fields: Partial<Record<TemplateField, string>> = {};
  for (const k of TEMPLATE_FIELDS) {
    const v = meta[k];
    if (typeof v === "string" && v.trim()) fields[k] = v;
  }
  const t = titleTemplateOf(meta);
  return { name: name.trim(), ...(t !== "iso7200" ? { template: t } : {}), ...(meta.logo?.src ? { logo: meta.logo } : {}), ...(Object.keys(fields).length ? { fields } : {}), ...(meta.tolTable?.length ? { tolTable: meta.tolTable } : {}) };
}

/** Použije šablonu na údaje listu (mění `meta`): druh, logo (šablona bez loga logo odebere), pole šablony; zapíše `titleTpl`. */
export function applyTemplate(meta: Record<string, unknown>, rec: TitleTemplateRec): void {
  if (rec.template && rec.template !== "iso7200") meta.template = rec.template;
  else delete meta.template;
  if (rec.logo?.src) meta.logo = rec.logo;
  else delete meta.logo;
  for (const k of TEMPLATE_FIELDS) {
    const v = rec.fields?.[k];
    if (v !== undefined) meta[k] = v;
  }
  if (rec.tolTable?.length) meta.tolTable = rec.tolTable;
  else if (rec.fields?.tolerance !== undefined) delete meta.tolTable;
  meta.titleTpl = rec.name;
}

/** šablony z Nastavení (v CLI jen v paměti běhu) */
export const settingsTemplates = (): TitleTemplateRec[] => loadSettings().titleTemplates ?? [];

/** šablona podle názvu: nejdřív dokument, pak Nastavení */
export function findTemplate(doc: Pick<CadDoc, "titleTemplates">, name: string): { rec: TitleTemplateRec; from: "doc" | "settings" } | null {
  const d = (doc.titleTemplates ?? []).find((t) => sameName(t.name, name));
  if (d) return { rec: d, from: "doc" };
  const s = settingsTemplates().find((t) => sameName(t.name, name));
  return s ? { rec: s, from: "settings" } : null;
}

const upsert = (list: TitleTemplateRec[] | undefined, rec: TitleTemplateRec) => [...(list ?? []).filter((t) => !sameName(t.name, rec.name)), rec];

/** kopie šablony v dokumentu (jde s ním do .mncad, sdílení a skriptu) */
export function withDocTemplate(doc: CadDoc, rec: TitleTemplateRec): CadDoc {
  return { ...doc, titleTemplates: upsert(doc.titleTemplates, rec) };
}

/** uloží šablonu do dokumentu i do Nastavení (`setDefault` = výchozí pro nové listy) */
export function saveTemplate(doc: CadDoc, rec: TitleTemplateRec, setDefault = false): CadDoc {
  const s = loadSettings();
  saveSettings({ ...s, titleTemplates: upsert(s.titleTemplates, rec), ...(setDefault ? { titleTemplateDefault: rec.name } : {}) });
  return withDocTemplate(doc, rec);
}

/** smaže šablonu z dokumentu i z Nastavení (výchozí se zruší, byla-li to ona); false = nebyla nikde */
export function deleteTemplate(doc: CadDoc, name: string): { doc: CadDoc; found: boolean } {
  const s = loadSettings();
  const inS = (s.titleTemplates ?? []).some((t) => sameName(t.name, name));
  const inD = (doc.titleTemplates ?? []).some((t) => sameName(t.name, name));
  if (inS) saveSettings({ ...s, titleTemplates: (s.titleTemplates ?? []).filter((t) => !sameName(t.name, name)), ...(s.titleTemplateDefault && sameName(s.titleTemplateDefault, name) ? { titleTemplateDefault: undefined } : {}) });
  const left = (doc.titleTemplates ?? []).filter((t) => !sameName(t.name, name));
  return { doc: inD ? { ...doc, titleTemplates: left.length ? left : undefined } : doc, found: inS || inD };
}

/** výchozí šablona hlavičky nových listů z Nastavení (null = žádná) */
export function defaultTemplateRec(): TitleTemplateRec | null {
  const s = loadSettings();
  const n = s.titleTemplateDefault;
  return n ? ((s.titleTemplates ?? []).find((t) => sameName(t.name, n)) ?? null) : null;
}

/** popis šablony: „Firma (nástrojářská, logo SVG firma.svg, firma „…“, 4 pole)“ */
export function templateText(rec: TitleTemplateRec): string {
  const parts = [templateLabel(rec.template ?? "iso7200")];
  if (rec.logo?.src) parts.push(tr("logo {0}{1}", rec.logo.svg ? "SVG" : "PNG", rec.logo.name ? ` „${rec.logo.name}“` : ""));
  const n = Object.keys(rec.fields ?? {}).length + (rec.tolTable?.length ? 1 : 0);
  if (rec.fields?.company) parts.push(tr("firma „{0}“", rec.fields.company));
  if (n) parts.push(tr("polí {0}", n));
  return `„${rec.name}“ (${parts.join(", ")})`;
}

/** řádek přehledu šablon hlavičky (dokument, Nastavení, výchozí, šablona aktivního listu) */
export function templatesLine(doc: Pick<CadDoc, "titleTemplates">, active?: string): string {
  const docT = doc.titleTemplates ?? [];
  const setT = settingsTemplates().filter((t) => !docT.some((d) => sameName(d.name, t.name)));
  const def = loadSettings().titleTemplateDefault;
  const mark = (t: TitleTemplateRec) => templateText(t) + (def && sameName(def, t.name) ? tr(" [výchozí]") : "");
  return tr("Šablony hlavičky: v dokumentu {0} · v Nastavení {1} · list: {2}", docT.map(mark).join(", ") || "—", setT.map(mark).join(", ") || "—", active ? `„${active}“` : "—");
}
