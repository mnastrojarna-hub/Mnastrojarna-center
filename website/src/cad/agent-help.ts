/**
 * Nápověda polí prvků textem (CS / EN / DE):
 *
 *   prvek nápověda <typ>   · feature help <type>   · element hilfe <typ>   – všechna pole pro `prvek <typ> klíč=hodnota`
 *   nápověda <typ>         · help <type>           · hilfe <typ>           – totéž (typ i slovem příkazu: díra, kužel, pružina…)
 *   prvek nápověda         · help                  · hilfe                 – přehled typů: vlastní textový příkaz a pole jen přes prvek
 *
 * Zdroj je jediná tabulka `feature-fields.ts` (svázaná s types.ts) a u rozšíření jejich `ExtParam`. Čisté funkce bez jádra.
 */
import { tr } from "./i18n";
import { allExt, type ExtDef } from "./ext/registry";
import { COMMON_FIELDS, featureFields, kindInfo, textGaps, type FieldSpec } from "./feature-fields";
import { emptyDoc, type FeatureType } from "./types";

const fold = (s: string) => s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/ß/g, "ss");
const set = (...w: string[]) => new Set(w.map(fold));
const HELP = set("nápověda", "napoveda", "help", "hilfe", "?");
/** slova příkazů, která nejsou v synonymech agent.ts (pružina…) → typ */
const ALIAS: Record<string, FeatureType> = { pruzina: "spring", feder: "spring", spring: "spring", zavit: "thread", gewinde: "thread", rozdelit: "splitBodies", kopie: "copyBody", sloucit: "combine", osa: "datumAxis", bod: "datumPoint", rovina: "datum" };

/** Kontext z agent.ts (bez cyklického importu): typy prvků, české popisky, kanonický tvar slova, výchozí hodnoty příkazu `prvek`. */
export type HelpCtx = { types: readonly string[]; labels: Record<string, string>; canon: (t: string) => string; defaults: (type: string) => Record<string, unknown> | null };

const show = (v: unknown): string => (v === "" ? "—" : typeof v === "string" ? v : typeof v === "boolean" ? (v ? tr("ano") : tr("ne")) : Array.isArray(v) && v.every((x) => typeof x === "number") ? v.join(";") : JSON.stringify(v));

/**
 * Řádek `prvek nápověda …` / `nápověda …`: `cmd` = kanonický příkaz z agent.ts, `rest` = text za příkazem.
 * Vrací řádky nápovědy, nebo null (jiný příkaz – např. `prvek cone …`).
 */
export function parseFeatureHelp(cmd: string, rest: string, ctx: HelpCtx): string[] | null {
  let text = rest.trim();
  if (cmd === "feature") {
    const m = /^(\S+)\s*(.*)$/.exec(text);
    if (!m || !HELP.has(fold(m[1]))) return null;
    text = m[2].trim();
  } else if (!HELP.has(fold(cmd))) return null;
  const word = text.replace(/^["„]|["“]$/g, "").trim();
  return word ? typeHelp(word, ctx) : overview(ctx);
}

/** Najde typ prvku nebo rozšíření podle slova (typ, popisek, příkaz CS / EN / DE, id nebo popisek rozšíření). */
export function findHelpTarget(word: string, ctx: HelpCtx): { type: FeatureType } | { ext: ExtDef } | null {
  const w = fold(word);
  const t = ctx.types.find((x) => fold(x) === w) ?? ctx.types.find((x) => fold(x) === fold(ctx.canon(word))) ?? Object.entries(ctx.labels).find(([, l]) => fold(l) === w || fold(tr(l)) === w)?.[0] ?? ALIAS[w];
  if (t) return { type: t as FeatureType };
  const ext = allExt().find((d) => fold(d.ext) === w || fold(d.label) === w);
  return ext ? { ext } : null;
}

function typeHelp(word: string, ctx: HelpCtx): string[] {
  const hit = findHelpTarget(word, ctx);
  if (!hit) throw new Error(tr("nápověda: neznámý typ prvku „{0}“ – typy: {1}; rozšíření: {2}", word, ctx.types.join(", "), allExt().filter((d) => !d.action).map((d) => d.ext).join(", ")));
  if ("ext" in hit) return extHelp(hit.ext);
  const type = hit.type;
  const spec = featureFields()[type];
  const dflt = ctx.defaults(type) ?? {};
  const out: string[] = [];
  out.push(tr("{0} ({1}) – pole pro „prvek {1} klíč=hodnota“ i „upravit <prvek> klíč=hodnota“:", tr(ctx.labels[type] ?? type), type));
  out.push(spec.cmd ? tr("textový příkaz: {0}", spec.cmd) : tr("vlastní textový příkaz nemá – jen prvek {0} …, upravit nebo JSON", type));
  for (const [key, f] of Object.entries(spec.fields as Record<string, FieldSpec>)) out.push(fieldLine(key, f, dflt));
  out.push(tr("společná pole: name (název), suppressed (potlačit ano/ne), body (cílové těleso)"));
  out.push(tr("hodnoty: číslo 12,5 · ano/ne · seznam a;b;c · text v uvozovkách · JSON {…} / […]; skici a prvky názvem nebo $last; plochy a hrany indexy od 0 (F3 = 2) nebo pravidlem; „povinné“ pole bez hodnoty skončí chybou při stavbě"));
  if (spec.ex) out.push(tr("příklad: {0}", spec.ex));
  return out;
}

function fieldLine(key: string, f: FieldSpec, dflt: Record<string, unknown>): string {
  const ki = kindInfo(f.k);
  const kind = f.values ? `${ki.label} ${f.values.join("|")}` : ki.label + (f.unit ? ` [${f.unit}]` : "");
  const state = key in dflt ? tr("výchozí {0}", show(dflt[key])) : f.opt ? tr("nepovinné") : tr("povinné");
  const ex = !f.values && ki.ex ? tr(", např. {0}={1}", key, ki.ex) : "";
  const only = f.only ? ` (${f.only})` : "";
  const text = f.k === "sigs" ? "" : f.text ? tr(" · text: {0}", f.text) : tr(" · jen prvek / upravit / JSON");
  return ` • ${key} – ${kind}${ex} · ${state}${only} – ${f.desc}${text}`;
}

/** Pole prvku rozšíření z jeho parametrů (`ExtParam`) a výchozích dat (`make`). */
function extHelp(d: ExtDef): string[] {
  if (d.action) return [tr("„{0}“ není prvek, ale akce (bez prvku v historii) – spusťte ji příkazem: akce {1}", d.label, d.ext)];
  let data: Record<string, unknown> = {};
  try {
    data = d.make({ ...emptyDoc(""), features: [] }) ?? {};
  } catch {
    data = {};
  }
  const out: string[] = [tr("{0} ({1}) – parametry pro „prvek {1} klíč=hodnota“ (klíč nebo český popisek):", d.label, d.ext)];
  const params = d.params ?? [];
  for (const p of params) {
    const kind = p.kind === "number" ? tr("číslo") + (p.unit ? ` [${p.unit}]` : "") : p.kind === "bool" ? tr("ano/ne") : p.kind === "enum" ? `${tr("výčet")} ${p.options.map((o) => o.v).join("|")}` : p.kind === "vec3" ? tr("vektor x;y;z") : p.kind === "faces" ? kindInfo("faces").label : p.kind === "edges" ? kindInfo("edges").label : p.kind === "sketch" ? kindInfo("sketch").label : p.kind === "sketches" ? kindInfo("sketches").label : p.kind === "feature" ? kindInfo("feature").label : p.kind === "mode" ? `${tr("výčet")} new|add|cut|intersect` : p.kind === "plane" ? kindInfo("planeDef").label : p.kind === "point" ? kindInfo("ref").label : p.kind === "direction" ? tr("směr: X | Y | Z | -Z | vektor 1;0;1 | JSON") : p.kind === "axis" ? tr("osa: X | Y | Z | vektor 1;0;1 | JSON") : tr("text");
    const state = p.key in data ? tr("výchozí {0}", show(data[p.key])) : tr("nepovinné");
    const hint = "hint" in p && p.hint ? ` (${p.hint})` : "";
    out.push(` • ${p.key} („${p.label}“) – ${kind} · ${state}${hint}`);
  }
  const extra = Object.keys(data).filter((k) => !params.some((p) => p.key === k));
  if (extra.length) out.push(tr(" • další klíče dat: {0}", extra.map((k) => `${k}=${show(data[k])}`).join(", ")));
  if (!params.length) out.push(tr("parametry nemá popsané – klíče podle výchozích dat výše"));
  return out;
}

/** Přehled: typy prvků, jejich textový příkaz a pole, která jdou zadat jen přes prvek / upravit / JSON (mezery textu). */
function overview(ctx: HelpCtx): string[] {
  const out = [tr("prvek nápověda <typ> vypíše všechna pole typu pro „prvek <typ> klíč=hodnota“ (typ i slovem příkazu: díra, kužel, pružina; rozšíření id nebo popiskem). Přehled – textový příkaz · pole jen přes prvek / upravit / JSON:")];
  for (const g of textGaps()) out.push(` • ${g.type} (${tr(ctx.labels[g.type] ?? g.type)}): ${g.cmd ? tr("text ✓") : tr("bez textového příkazu")} · ${g.missing.length ? tr("jen prvek: {0}", g.missing.join(", ")) : tr("vše textem")}`);
  out.push(tr("rozšíření ({0}): prvek nápověda <id> – např. prvek nápověda sheet.bend", allExt().filter((d) => !d.action).length));
  out.push(tr("společná pole všech prvků: {0}", COMMON_FIELDS.filter((x) => x !== "id" && x !== "type").join(", ")));
  return out;
}
