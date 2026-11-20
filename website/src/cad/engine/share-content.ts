/**
 * Obsah sdíleného odkazu a jeho záznam v protokolu (vlna 22, bod 16): každý `sdílet` / `odkaz` / `odkaz ověřit` dostane
 * vlastní výpis `= L<n> link …` s adresou, režimem, platností a obsahem odkazu – v plném protokolu, ve stručném protokolu
 * (priorita vyžádané hodnoty) i v JSON (`entries[].data`, `shares[]`). Řádek `O` (gramatika beze změny) dál nese poslední
 * odkaz. Dlouhý odkaz (`#s=…`, celý dokument v adrese) má ve výpisu `=` zkrácenou adresu s délkou; celá je v `data.url`,
 * v `shares[]` a na řádku O (u posledního odkazu).
 *
 * Čistý modul (bez jádra a sítě) – smí ho importovat engine, CLI i aplikace.
 */
import { tr } from "../i18n";
import type { CadDoc } from "../types";
import type { ShareInfo, ShareMode } from "./protocol-types";

/** co odkaz obsahuje: druh a název dokumentu, komponenty, různé díly, listy výkresu, přílohy (importy a podklady skic) */
export type ShareContent = {
  doc: string;
  kind: "part" | "assembly" | "draft";
  /** komponenty sestavy (0 u dílu) */
  comp: number;
  /** různé díly sestavy podle názvu zdroje (0 u dílu) */
  parts: number;
  /** listy výkresu (DrawingDoc = list) */
  sheets: number;
  /** přiložená data: importované soubory (STEP, IGES…) a podklady skic (PDF, obrázky) */
  files: number;
  /** prvky historie dílu (u sestavy 0) */
  features: number;
};

type Holder = { data?: unknown };

/** importované soubory dokumentu (prvky importu, komponenty ze souboru, vnořené díly) – každá data jednou */
function importFiles(doc: CadDoc, seen: Set<string>, depth = 0): void {
  if (depth > 20) return;
  for (const f of doc.features ?? []) {
    if ((f as { type?: string }).type !== "import") continue;
    const d = (f as Holder).data;
    if (typeof d === "string" && d) seen.add(d.length > 64 ? `${d.length}:${d.slice(0, 64)}` : d);
  }
  for (const c of doc.components ?? []) {
    const s = c.source as { kind: string; data?: unknown; doc?: CadDoc };
    if (s.kind === "file") {
      if (typeof s.data === "string" && s.data) seen.add(s.data.length > 64 ? `${s.data.length}:${s.data.slice(0, 64)}` : s.data);
    } else if (s.doc) importFiles(s.doc, seen, depth + 1);
  }
}

/** Obsah dokumentu, jak ho odkaz přenese (pro protokol odesílatele i pro `odkaz ověřit`). */
export function shareContent(doc: CadDoc): ShareContent {
  const kind = doc.kind === "assembly" ? "assembly" : doc.kind === "draft" ? "draft" : "part";
  const comps = doc.components ?? [];
  const partNames = new Set(comps.map((c) => (c.source as { doc?: CadDoc }).doc?.name ?? c.name));
  const files = new Set<string>();
  importFiles(doc, files);
  const underlays = Object.keys((doc as { underlays?: Record<string, unknown> }).underlays ?? {}).length;
  return {
    doc: doc.name,
    kind,
    comp: kind === "assembly" ? comps.length : 0,
    parts: kind === "assembly" ? partNames.size : 0,
    sheets: doc.drawings?.length ?? 0,
    files: files.size + underlays,
    features: kind === "part" ? (doc.features?.length ?? 0) : 0,
  };
}

const KIND_KV: Record<ShareContent["kind"], string> = { part: "part", assembly: "asm", draft: "draft" };

/** strojová část obsahu: `content=asm comp=2 parts=2 sheets=0 files=0` (název dokumentu je v hlavičce výpisu) */
export const shareContentKv = (c: ShareContent): string => `content=${KIND_KV[c.kind]} comp=${c.comp} parts=${c.parts} sheets=${c.sheets} files=${c.files}${c.kind === "part" ? ` features=${c.features}` : ""}`;

/** lidský popis obsahu: „sestava „X“ – komponent 2, různých dílů 2, listů výkresu 0, příloh 0“ */
export function shareContentText(c: ShareContent): string {
  if (c.kind === "assembly") return tr("sestava „{0}“ – komponent {1}, různých dílů {2}, listů výkresu {3}, příloh {4}", c.doc, c.comp, c.parts, c.sheets, c.files);
  if (c.kind === "draft") return tr("2D výkres „{0}“ – příloh {1}", c.doc, c.files);
  return tr("díl „{0}“ – prvků {1}, listů výkresu {2}, příloh {3}", c.doc, c.features, c.sheets, c.files);
}

/** adresa do výpisu `=`: krátký odkaz celý, dlouhý (nad 200 znaků) začátek + délka – celý je v datech a na řádku O */
export const LINK_KV_MAX = 200;
export function linkKvUrl(url: string): string {
  const u = String(url ?? "").replace(/[\s\u0000-\u001f\u007f-\u009f]/g, (ch) => encodeURIComponent(ch)) || "-";
  return u.length <= LINK_KV_MAX ? u : `${u.slice(0, 64)}…(${u.length}chars)`;
}

/**
 * Strojová část výpisu `= L<n> link "<dokument>" …` pro vytvořený / vypsaný odkaz: adresa, režim, platnost, pohled,
 * heslo, velikost obsahu, délka odkazu a obsah.
 */
export function shareLinkKv(s: ShareInfo & { view?: string; password?: boolean }, c: ShareContent | undefined): string {
  const kv = [`url=${linkKvUrl(s.url)}`, `mode=${s.mode}`, `exp=${s.exp ?? "none"}`];
  if (s.view) kv.push(`view=${s.view}`);
  if (s.password !== undefined) kv.push(`pw=${s.password ? 1 : 0}`);
  kv.push(`bytes=${Math.max(0, Math.round(s.bytes || 0))}`, `chars=${String(s.url ?? "").length}`);
  if (c) kv.push(shareContentKv(c));
  return kv.join(" ");
}

/** výsledek `odkaz ověřit` do výpisu `=`: `ok=1 mode=self exp=… content=asm …` / `ok=0 reason=truncated chars=287` */
export function verifyKv(v: { ok: boolean; url: string; mode?: ShareMode; exp?: string | null; reason?: string; content?: ShareContent; chars: number }): string {
  const kv = [`url=${linkKvUrl(v.url)}`, `ok=${v.ok ? 1 : 0}`];
  if (v.ok) kv.push(`mode=${v.mode ?? "link"}`, `exp=${v.exp ?? "none"}`);
  else kv.push(`reason=${v.reason ?? "invalid"}`);
  kv.push(`chars=${v.chars}`);
  if (v.content) kv.push(shareContentKv(v.content));
  return kv.join(" ");
}

