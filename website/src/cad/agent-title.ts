/**
 * Razítko výkresu textem (`výkres razítko pole=hodnota …`): klíče polí česky, anglicky i německy, šablona, logo
 * (připojený soubor nebo data URL) a nepředepsané tolerance (ISO 2768 / tabulka podle desetinných míst). Provedení nad
 * údaji listu a řádky stavu pro protokol. Bez jádra – volá ho cad/drawing-agent.ts.
 */
import { attachedFiles, attachedList } from "./attached-files";
import type { DrawingMeta } from "./drawing";
import { tr } from "./i18n";
import { drawTitleBlock, generalTolDescribe, generalTolFields, generalTolOf, generalTolText, parseGeneralTol, parseTemplate, TECH_ROW_H, techStripKeys, templateKeys, templateLabel, titleBlockSize, titleRevision, titleTemplateOf, type TitleFieldKey } from "./title-block";
import { prepareLogo, sniffImage, toDataUrl } from "./title-logo";
import type { CadDoc } from "./types";

/** MIME obrázku vstupu podle obsahu (PNG, JPEG, SVG …), jinak podle přípony */
const mimeOf = (name: string, b: Uint8Array): string => {
  const k = sniffImage(b);
  if (k) return k === "svg" ? "image/svg+xml" : `image/${k}`;
  return /\.svg$/i.test(name) ? "image/svg+xml" : /\.jpe?g$/i.test(name) ? "image/jpeg" : "image/png";
};

/** pole příkazu razítka: pole listu + logo a šablona */
export type TitleCmdField = TitleFieldKey | "logo" | "template";

const fold = (s: string) => s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/ß/g, "ss").replace(/[\s_.-]+/g, "");

/** klíče polí razítka (cs, en, de – bez diakritiky, pomlček a podtržítek) */
export const TITLE_WORDS: Record<string, TitleCmdField> = {
  nazev: "name", name: "name", title: "name", benennung: "name", titel: "name", bezeichnung: "name",
  cislo: "number", cislovykresu: "number", number: "number", drawingnumber: "number", nummer: "number", zeichnungsnummer: "number", no: "number", sachnummer: "number",
  kreslil: "author", nakreslil: "author", autor: "author", author: "author", drawn: "author", drawnby: "author", ersteller: "author", gezeichnet: "author", bearbeiter: "author",
  kontroloval: "checkedBy", zkontroloval: "checkedBy", kontrola: "checkedBy", checked: "checkedBy", checkedby: "checkedBy", checker: "checkedBy", geprueft: "checkedBy", gepruft: "checkedBy", prufer: "checkedBy", pruefer: "checkedBy",
  schvalil: "approvedBy", schvaleno: "approvedBy", schvaleni: "approvedBy", approved: "approvedBy", approvedby: "approvedBy", approver: "approvedBy", genehmigt: "approvedBy", freigabe: "approvedBy", freigegeben: "approvedBy",
  revize: "revision", revision: "revision", index: "revision", rev: "revision", anderungsindex: "revision",
  datum: "date", date: "date",
  material: "material", werkstoff: "material",
  polotovar: "stock", stock: "stock", blank: "stock", rawmaterial: "stock", semifinished: "stock", rohteil: "stock", halbzeug: "stock", rohmass: "stock", rohmaterial: "stock",
  pocet: "quantity", pocetkusu: "quantity", kusu: "quantity", ks: "quantity", mnozstvi: "quantity", quantity: "quantity", qty: "quantity", pieces: "quantity", menge: "quantity", stuckzahl: "quantity", stueckzahl: "quantity", anzahl: "quantity",
  tepelne: "heatTreatment", tepelnezpracovani: "heatTreatment", tz: "heatTreatment", kaleni: "heatTreatment", heat: "heatTreatment", heattreatment: "heatTreatment", hardening: "heatTreatment", warmebehandlung: "heatTreatment", waermebehandlung: "heatTreatment", harten: "heatTreatment",
  povrch: "surfaceTreatment", povrchova: "surfaceTreatment", povrchovauprava: "surfaceTreatment", uprava: "surfaceTreatment", surface: "surfaceTreatment", surfacetreatment: "surfaceTreatment", finish: "surfaceTreatment", coating: "surfaceTreatment", oberflachenbehandlung: "surfaceTreatment", oberflaechenbehandlung: "surfaceTreatment", beschichtung: "surfaceTreatment",
  nepredepsane: "tolerance", tolerance: "tolerance", general: "tolerance", generaltolerance: "tolerance", generaltolerances: "tolerance", allgemeintoleranz: "tolerance", allgemeintoleranzen: "tolerance", toleranz: "tolerance",
  uhly: "angleTol", toleranceuhlu: "angleTol", uhel: "angleTol", angles: "angleTol", angle: "angleTol", angletolerance: "angleTol", angular: "angleTol", winkel: "angleTol", winkeltoleranz: "angleTol",
  srazeni: "chamferTol", tolerancesrazeni: "chamferTol", chamfers: "chamferTol", chamfer: "chamferTol", chamfertolerance: "chamferTol", fasen: "chamferTol", fase: "chamferTol", fasentoleranz: "chamferTol",
  hrany: "edges", edges: "edges", kanten: "edges", werkstuckkanten: "edges", stavhran: "edges", iso13715: "edges",
  tvrdost: "hardness", hardness: "hardness", harte: "hardness", haerte: "hardness", hrc: "hardness",
  drsnost: "roughness", obecnadrsnost: "roughness", nepredepsanadrsnost: "roughness", roughness: "roughness", generalroughness: "roughness", rauheit: "roughness", rauigkeit: "roughness", allgemeinrauheit: "roughness",
  zakaznik: "customer", odberatel: "customer", customer: "customer", client: "customer", kunde: "customer", auftraggeber: "customer",
  projekt: "project", zakazka: "project", project: "project", job: "project", auftrag: "project",
  firma: "company", spolecnost: "company", vlastnik: "company", company: "company", owner: "company", unternehmen: "company", inhaber: "company",
  poznamka: "note", note: "note", hinweis: "note", notiz: "note",
  logo: "logo", znak: "logo",
  sablona: "template", template: "template", vorlage: "template", layout: "template",
};
/** pole razítka podle klíče (cs / en / de); neznámý klíč = undefined */
export const titleFieldOf = (key: string): TitleCmdField | undefined => TITLE_WORDS[fold(key)];

/** název pole pro protokol (malými písmeny, v jazyce rozhraní) */
export function titleKeyLabel(k: TitleCmdField): string {
  switch (k) {
    case "name": return tr("název");
    case "number": return tr("číslo");
    case "author": return tr("kreslil");
    case "checkedBy": return tr("kontroloval");
    case "approvedBy": return tr("schválil");
    case "revision": return tr("revize");
    case "date": return tr("datum");
    case "material": return tr("materiál");
    case "stock": return tr("polotovar");
    case "quantity": return tr("počet kusů");
    case "heatTreatment": return tr("tepelné zpracování");
    case "hardness": return tr("tvrdost");
    case "roughness": return tr("drsnost");
    case "surfaceTreatment": return tr("povrchová úprava");
    case "tolerance": return tr("nepředepsané");
    case "angleTol": return tr("tolerance úhlů");
    case "chamferTol": return tr("tolerance sražení");
    case "edges": return tr("hrany");
    case "customer": return tr("zákazník");
    case "project": return tr("projekt");
    case "company": return tr("firma");
    case "note": return tr("poznámka");
    case "logo": return tr("logo");
    case "template": return tr("šablona");
  }
}

/** nápověda k příkazu razítka (chybová hláška neznámého pole) */
export const titleUsage = () =>
  tr("výkres razítko název=\"…\" číslo=\"…\" kreslil=\"…\" kontroloval=\"…\" schválil=\"…\" revize=\"…\" datum=\"…\" materiál=\"…\" polotovar=\"…\" počet=\"…\" tepelné=\"…\" tvrdost=\"58–60 HRC\" povrch=\"…\" drsnost=\"Ra 3,2\" nepředepsané=\"ISO 2768-mK|desetinná\" úhly=\"…\" sražení=\"…\" hrany=\"…\" zákazník=\"…\" projekt=\"…\" firma=\"…\" logo=\"soubor.png\" šablona=iso7200|kompaktní|nástrojářská poznámka=\"…\"");

/** tvrdost s jednotkou: 58 HRC, 58–60 HRC, 58+2 HRC, 650 HV10, 220 HB, 60 ± 2 HRC */
const HARDNESS_RE = /^(?:min\.?\s*|max\.?\s*|≥\s*|≤\s*)?\d+(?:[.,]\d+)?(?:\s*(?:[-–…]|\+\s*\/?\s*-?|±|až|to|bis)\s*\d+(?:[.,]\d+)?)?\s*(?:HRC|HRB|HRA|HV\s?\d{0,2}|HBW|HB)\b/i;
const NONE = new Set(["", "ne", "no", "nein", "none", "zadne", "zadna", "zadny", "keine", "kein", "smazat", "delete", "loschen", "loeschen", "-", "—"]);

/**
 * Pole razítka → údaje listu (`meta` se mění na místě). Logo: data URL nebo název připojeného souboru (zmenší se a dostane
 * obrys pro DXF / DWG); šablona: iso7200 / kompaktní / nástrojářská; nepředepsané: ISO 2768 třída, „desetinná …“ nebo text.
 * Vrací části řádku protokolu „✓ razítko: …“ a upozornění („! …“). Materiál nastavuje volající (do dokumentu).
 */
export async function applyTitleFields(meta: Record<string, unknown>, f: Partial<Record<TitleCmdField, string>>, input?: (name: string) => Promise<{ name: string; bytes: Uint8Array } | null>): Promise<{ parts: string[]; warnings: string[] }> {
  const parts: string[] = [];
  const warnings: string[] = [];
  for (const k of Object.keys(f) as TitleCmdField[]) {
    const v = f[k] ?? "";
    if (k === "material") {
      parts.push(`${titleKeyLabel(k)} „${v}“`);
      continue;
    }
    if (k === "template") {
      const t = parseTemplate(v);
      if (!t) throw new Error(tr("šablona razítka „{0}“ neexistuje – iso7200 (výchozí), kompaktní, nástrojářská", v));
      if (t === "iso7200") delete meta.template;
      else meta.template = t;
      const s = titleBlockSize({ template: t });
      parts.push(tr("šablona {0} ({1}×{2} mm)", templateLabel(t), s.w, s.h));
      continue;
    }
    if (k === "logo") {
      if (NONE.has(fold(v))) {
        delete meta.logo;
        parts.push(tr("logo odstraněno"));
        continue;
      }
      let src = v.trim();
      let name: string | undefined;
      if (!/^data:/i.test(src)) {
        const found = attachedFiles.matches(src);
        if (found.length > 1) throw new Error(tr("logo „{0}“: název odpovídá více připojeným souborům ({1}) – zadejte celý název s příponou, např. logo=\"{2}\"", src, found.map((x) => x.name).join(", "), found[0].name));
        const file = found[0];
        // bez připojeného souboru: vstupy hostitele (CLI --files / složka skriptu, HTTP body.files – vlna 22, bod 22j)
        const inp = file ? null : await input?.(src);
        if (!file && !inp) throw new Error(tr("logo „{0}“: soubor není připojený – připojte ho v konzoli tlačítkem „Připojit soubor…“, v CLI složkou --files, nebo zadejte data URL (data:image/png;base64,…); připojené: {1}", src, attachedList() || "—"));
        if (file) {
          src = file.dataUrl;
          name = file.name;
        } else {
          src = toDataUrl(mimeOf(inp!.name, inp!.bytes), inp!.bytes);
          name = inp!.name;
        }
      }
      const r = await prepareLogo(src, name);
      meta.logo = r.logo;
      warnings.push(...r.warnings);
      parts.push(tr("logo „{0}“ {1}×{2} px{3}", name ?? tr("data URL"), r.logo.w, r.logo.h, r.logo.trace ? tr(", obrys pro DXF/DWG {0} ploch", r.logo.trace.rects.length / 4) : ""));
      continue;
    }
    if (k === "tolerance") {
      const g = parseGeneralTol(v);
      const fl = generalTolFields(g);
      meta.tolerance = fl.tolerance;
      if (fl.tolTable) meta.tolTable = fl.tolTable;
      else delete meta.tolTable;
      parts.push(`${titleKeyLabel(k)} „${fl.tolerance || tr("nezadané")}“`);
      continue;
    }
    if (k === "hardness" && v.trim() && !NONE.has(fold(v)) && !HARDNESS_RE.test(v.trim())) throw new Error(tr("tvrdost „{0}“: zadejte hodnotu s jednotkou – např. tvrdost=\"58–60 HRC\", \"58+2 HRC\", \"650 HV10\", \"220 HB\"", v));
    if (k === "roughness" && v.trim() && !NONE.has(fold(v)) && !/^(?:R[az]|Rmax)\s*\d|^\d/.test(v.trim())) throw new Error(tr("drsnost „{0}“: zadejte hodnotu – např. drsnost=\"Ra 3,2\" (obecná drsnost ISO 1302 v razítku)", v));
    const val = k === "roughness" && /^\d/.test(v.trim()) ? `Ra ${v.trim()}` : v;
    if (NONE.has(fold(v)) && (k === "hardness" || k === "roughness")) {
      delete meta[k];
      parts.push(`${titleKeyLabel(k)} —`);
      continue;
    }
    meta[k] = val;
    parts.push(`${titleKeyLabel(k)} „${val}“`);
  }
  return { parts, warnings };
}

/** `výkres nepředepsané …` → údaje listu a text pro protokol */
export function applyGeneralTol(meta: Record<string, unknown>, value: string): string {
  const fl = generalTolFields(parseGeneralTol(value));
  meta.tolerance = fl.tolerance;
  if (fl.tolTable) meta.tolTable = fl.tolTable;
  else delete meta.tolTable;
  return fl.tolerance ? tr("✓ nepředepsané tolerance {0}", fl.tolerance) : tr("✓ nepředepsané tolerance zrušeny – export výkresu dílu to ohlásí ⚠");
}

const ROUND = (n: number) => String(Math.round(n * 10) / 10).replace(".", ",");

/**
 * Revize v razítku a její vazba na tabulku revizí: prázdné pole = poslední revize z tabulky (tak ji kreslí list),
 * zadaná revize, která v tabulce není (a tabulka není prázdná) = upozornění. `shown` = text do protokolu.
 */
export function titleRevisionCheck(m: Pick<DrawingMeta, "revision" | "revisions">): { shown: string; value: string; warning?: string } {
  const value = titleRevision(m);
  const revs = m.revisions ?? [];
  const field = m.revision?.trim() ?? "";
  if (!value) return { shown: "—", value };
  if (!field) return { shown: tr("{0} (z tabulky revizí)", value), value };
  if (revs.length && !revs.some((r) => r.rev.trim().toUpperCase() === field.toUpperCase()))
    return {
      shown: value,
      value,
      warning: tr("revize v razítku „{0}“ není v tabulce revizí ({1}) – doplňte ji (výkres revize {0} \"…\") nebo pole vyprázdněte (výkres razítko revize=\"\") a razítko vezme poslední revizi z tabulky", field, revs.map((r) => r.rev).join(", ")),
    };
  return { shown: value, value };
}

/**
 * Řádky stavu razítka: šablona, promítání, logo, další pole, nepředepsané tolerance a jak se pole vešla (zmenšené písmo,
 * zalomení – nic se nezkracuje). `projection` z voleb listu. `m` = údaje listu jako pro výpočet (název, materiál
 * z dokumentu – cad/drawing-agent.ts sheetMeta), jinak se materiál ani název do kontroly velikosti písma nedostanou.
 */
export function titleStatusLines(doc: Pick<CadDoc, "kind">, m: Partial<DrawingMeta>, projection: "E" | "A" = "E"): string[] {
  const tpl = titleTemplateOf(m);
  const size = titleBlockSize(m);
  const L: string[] = [];
  const logo = (m.logo?.src ? tr(" · logo „{0}“ {1}×{2} px{3}", m.logo.name ?? tr("data URL"), m.logo.w, m.logo.h, m.logo.trace ? "" : tr(" (v DXF/DWG jen rámeček)")) + (m.logo.svg ? tr(" · SVG (vektor v SVG a PDF)") : "") : "") + (m.titleTpl ? tr(" · šablona hlavičky „{0}“", m.titleTpl) : "");
  L.push(tr("Šablona razítka: {0} {1}×{2} mm · promítání ISO {3} – značka ISO 5456-2 ({4}){5}", templateLabel(tpl), size.w, size.h, projection, projection === "E" ? tr("1. kvadrant, kružnice vpravo") : tr("3. kvadrant, kružnice vlevo"), logo));
  const extra: TitleCmdField[] = ["company", "customer", "project", "checkedBy", "approvedBy", "stock", "quantity", "heatTreatment", "hardness", "surfaceTreatment", "angleTol", "chamferTol", "roughness"];
  const filled = extra.filter((k) => typeof m[k as keyof DrawingMeta] === "string" && (m[k as keyof DrawingMeta] as string).trim());
  const inCells = new Set(templateKeys(tpl, m));
  L.push(
    filled.length
      ? tr("Další pole razítka: {0}", filled.map((k) => `${titleKeyLabel(k)} „${(m[k as keyof DrawingMeta] as string).trim()}“${k === "company" || inCells.has(k) ? "" : tr(" (v patičce)")}`).join(" · "))
      : tr("Další pole razítka: — (kontroloval, schválil, zákazník, projekt, polotovar, počet kusů, tepelné zpracování, povrchová úprava, tolerance úhlů a sražení: výkres razítko pole=\"…\")"),
  );
  // technické údaje vždy v buňkách razítka (vlna 23, R1) – co je vyplněno a kde (technický pás u ISO 7200 / kompaktní)
  const strip = techStripKeys(m);
  const techVal = (k: string) => (k === "tolerance" ? generalTolText(generalTolOf(m)) : ((m as Record<string, unknown>)[k] as string | undefined)?.trim() ?? "");
  const tech = (["heatTreatment", "hardness", "surfaceTreatment", "edges", "tolerance", "roughness"] as const).map((k) => `${titleKeyLabel(k === "edges" ? "edges" : k)} ${techVal(k) ? `„${techVal(k)}“` : "—"}`);
  L.push(tr("Údaje razítka (technické, v buňkách): {0}{1}", tech.join(" · "), strip.length ? tr(" · technický pás razítka +{0} mm ({1} polí)", TECH_ROW_H, strip.length) : ""));
  const g = generalTolOf(m);
  L.push(!g ? (doc.kind === "assembly" ? tr("Nepředepsané tolerance: nezadané (sestava – nevyžadují se)") : tr("Nepředepsané tolerance: nezadané – export výkresu dílu je ohlásí; zadejte výkres nepředepsané ISO 2768-mK nebo výkres nepředepsané desetinná")) : tr("Nepředepsané tolerance: {0}", generalTolDescribe(g)));
  // jak se pole vešla (stejný výpočet jako na listu; měřítko a formát tu nejsou známé)
  const info = drawTitleBlock({ W: 420, H: 297, margin: 10, ctx: { sheet: "A3", scaleLabel: "1:1", projection }, meta: { name: "", material: "", ...m } as DrawingMeta, polys: [], texts: [], above: 0 });
  const shrunk = info.fields.filter((x) => x.where === "cell" && x.shrunk && !["scale", "format"].includes(x.key));
  const small = shrunk.filter((x) => x.small);
  L.push(
    shrunk.length
      ? tr("Razítko bez zkracování textu: {0}", shrunk.map((x) => (x.lines > 1 ? tr("{0} {1} řádky {2} mm", x.label, x.lines, ROUND(x.size)) : tr("{0} písmo {1} mm", x.label, ROUND(x.size)))).join(" · "))
      : tr("Razítko bez zkracování textu: všechna pole v nominální velikosti"),
  );
  for (const x of small) L.push(tr("⚠ pole „{0}“ má písmo jen {1} mm – zkraťte text nebo zvolte šablonu nástrojářská (výkres razítko šablona=nástrojářská)", x.label, ROUND(x.size)));
  return L;
}
