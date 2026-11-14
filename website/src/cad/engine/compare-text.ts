/**
 * `porovnat "ref.step" [tolerance 0.05] [zarovnat auto|střed|ne] [díl "A" | sestava] [mapa ne] [přísně]`
 * (EN compare, DE vergleichen) – CAD-HEADLESS-NAVRH.md kap. 6.2, balík B5.
 *
 * Porovnání s referenčním modelem textem: soubor reference ze vstupů hostitele (`FileSource` – CLI `--files` / složka skriptu,
 * HTTP `files`, v prohlížeči přiložený soubor `window.mncad.attach`; chybí-li, ✗ `file.missing` se seznamem dostupných),
 * výpočet `kernel.compare` jako okno Porovnat s referencí a `window.mncad.compare` (sestava = složené těleso viditelných
 * komponent). Stručně jeden řádek `= compare … ok=1 tol= dV= extra= missing= dev= within= align=`; mimo toleranci
 * ⚠ `compare.mismatch` se 3 největšími oblastmi (s `přísně` ✗). Plný report (text okna) je v plném protokolu.
 */
import type { CompareCmd } from "../agent-check";
import { flattenLeaves } from "../asm-flatten";
import { dataBytes } from "../blobs";
import type { CompareOptions, CompareResult, ReferenceFile } from "../compare";
import { booleansInexact, compareReportText, regionHint, regionList } from "../compare-report";
import { prepareImportWith } from "../formats/import-core";
import { cadLocale, tr } from "../i18n";
import { leafByRef } from "../leaf-ref";
import type { CadDoc } from "../types";
import { ensureLeaves } from "./asm-status";
import { kv, num } from "./kv";
import { runOf } from "./run-doc";
import { asmHooks, coded, sayKvAs, type OpCtx, type OpHandler } from "./ops/util";

/**
 * Dokument, který se porovná: aktivní (díl / sestava), sestava, nebo díl podle názvu (komponenta / záložka). `label` =
 * název v protokolu (`= … compare "<label>"`, JSON `entries[].doc`): porovnávaný díl / komponenta, ne aktivní záložka.
 */
async function targetOf(ctx: OpCtx, cmd: CompareCmd): Promise<{ doc: CadDoc; label: string }> {
  const d = runOf(ctx).doc;
  const t = cmd.target;
  if (d.kind === "draft") throw new Error(tr("porovnat: otevřený dokument je 2D výkres"));
  if (t === "assembly" && d.kind !== "assembly") throw new Error(tr("porovnat sestava: otevřený dokument není sestava"));
  if (typeof t === "object") {
    if (d.kind === "assembly") {
      const leaf = leafByRef(d, flattenLeaves(d), t.part);
      if (leaf.comp.source.kind !== "part") throw new Error(tr("porovnat díl: komponenta „{0}“ není díl s historií – porovnat … sestava", leaf.comp.name));
      return { doc: leaf.comp.source.doc, label: leaf.comp.name };
    }
    const p = ctx.ws.findPart(t.part);
    if (!p) throw new Error(tr("díl „{0}“ není mezi otevřenými záložkami – dostupné: {1}", t.part, ctx.ws.partNames().join(", ") || "—"));
    return { doc: p, label: p.name };
  }
  return { doc: d, label: d.name };
}

/** soubor reference ze vstupů hostitele → těleso pro jádro (STEP / BREP / STL…; sestava STEP jako jedno těleso) */
async function referenceFile(ctx: OpCtx, name: string): Promise<ReferenceFile> {
  const f = await ctx.host.inputs.read(name); // chybí → MissingInputError → ✗ file.missing se seznamem dostupných
  const base = f.name.replace(/^.*[\\/]/, "") || name;
  const r = await prepareImportWith(new File([f.data as BlobPart], base), async () => null);
  if (r.kind === "unsupported") throw new Error(r.message);
  if (r.kind !== "body") throw new Error(tr("{0}: soubor obsahuje jen 2D výkres – jako referenci použijte 3D model (STEP).", base));
  return { data: dataBytes(r.data, base), format: r.format, fileName: base };
}

/** rozdíl objemů v mezích numerického šumu (stejný práh jako kontrola booleovských operací v compare.ts) */
const volumeNoise = (res: CompareResult) => Math.max(1, 1e-5 * Math.abs(res.model.volume));

/**
 * Výsledek je shoda: žádné rozdílové oblasti nad prahem šumu a mapa odchylek v toleranci (jako `window.mncad.compare`).
 * Nesedí-li kontrola booleovských operací (`booleansInexact` – složené těleso sestavy s tělesy, která se překrývají, např.
 * šroub v závitové díře), rozdílové oblasti nejsou skutečné rozdíly: shodu pak určí rozdíl objemů v mezích šumu a mapa
 * odchylek v toleranci (bez mapy jen objem).
 */
export function compareOk(res: CompareResult, tolerance: number): boolean {
  const mapOk = res.map ? res.map.stats.max <= tolerance + res.map.accuracy : null;
  if (booleansInexact(res)) return Math.abs(res.volumeDiff) <= volumeNoise(res) && mapOk !== false;
  return !regionList(res).length && (mapOk ?? !!(res.extra || res.missing));
}

const regionsVolume = (s: CompareResult["extra"]) => (s ? s.regions.reduce((a, g) => a + g.volume, 0) + s.more.volume : 0);
const signed = (v: number, d = 3) => `${v >= 0 ? "+" : "-"}${num(Math.abs(v), d)}`;

/** strojová část výsledku porovnání (stejná v cs/en/de) */
export function compareKv(res: CompareResult, cmd: Pick<CompareCmd, "tolerance" | "align">, ok: boolean): string {
  const refV = res.reference.volume;
  const s = res.map?.stats;
  // nespolehlivá rozdílová tělesa se do strojové části nepíšou (`booleans=inexact`) – jejich objemy nejsou skutečné rozdíly
  const inexact = booleansInexact(res);
  // procenta bez uvozovek (kv uvozuje hodnoty mimo [A-Za-z0-9._:/+,-]) – hodnoty jsou čísla, mezeru neobsahují
  return [
    kv([
      ["ref", res.reference.fileName],
      ["ok", ok],
      ["tol", num(cmd.tolerance, 4)],
    ]),
    refV > 0 ? `dV=${signed((100 * res.volumeDiff) / refV, 4)}%` : "",
    kv([
      ["dV.mm3", num(res.volumeDiff, 3)],
      ["extra", res.extra && !inexact ? `${num(regionsVolume(res.extra), 3)}mm3` : "-"],
      ["missing", res.missing && !inexact ? `${num(regionsVolume(res.missing), 3)}mm3` : "-"],
      ["regions", inexact ? "-" : regionList(res).length],
      ["dev", s ? `${signed(s.maxOut)}/${signed(s.maxIn)}mm` : undefined],
    ]),
    s ? `within=${num(100 * (s.withinArea ?? s.within), 2)}%` : "",
    kv([
      ["align", res.transform.mode],
      ["moved", res.transform.identity ? undefined : true],
      ["booleans", res.booleansSkipped ? "skipped" : inexact ? "inexact" : undefined],
    ]),
  ]
    .filter(Boolean)
    .join(" ");
}

const loc = (v: number, d = 3) => (Math.round(v * 10 ** d) / 10 ** d + 0).toLocaleString(cadLocale(), { maximumFractionDigits: d });

export const compareOp: OpHandler<"compare"> = async (op, ctx) => {
  const cmd = op.cmd;
  const { doc, label } = await targetOf(ctx, cmd);
  if (doc.kind === "assembly") await ensureLeaves(ctx.ws, ctx.host.kernel, doc, asmHooks(ctx));
  else if (!doc.features.length) throw new Error(tr("porovnání: díl nemá těleso"));
  const file = await referenceFile(ctx, cmd.file);
  const opts: CompareOptions = { align: { mode: cmd.align }, tolerance: cmd.tolerance, booleans: "auto", map: cmd.map, ghost: false, regionMeshes: 0 };
  const res = await ctx.host.kernel.compare(doc, file, opts);
  const ok = compareOk(res, cmd.tolerance);
  const inexact = booleansInexact(res);
  const report = compareReportText(res, { model: label, tolerance: cmd.tolerance }).split("\n");
  sayKvAs(ctx, label, compareKv(res, cmd, ok), ...report);
  if (inexact) coded(ctx, "compare.inexact", { doc: label, args: [loc(Math.abs(res.residual ?? 0), 2)] });
  if (ok) return;
  // tři největší oblasti (objem, střed, popis); bez oblastí (nebo s nespolehlivými oblastmi) rozdíl objemů a odchylka mapy
  const list = inexact ? [] : regionList(res).slice(0, 3);
  const parts = list.map((g) => tr("{0} {1} cm³ u [{2}] – {3}", g.side === "extra" ? tr("navíc") : tr("chybí"), loc(g.volume / 1000, 3), g.center.map((v) => loc(v, 2)).join("; "), regionHint(g)));
  const mapText = () => tr("odchylka povrchu až {0} mm (tolerance {1} mm)", loc(res.map!.stats.max, 3), loc(cmd.tolerance, 3));
  if (inexact) {
    if (Math.abs(res.volumeDiff) > volumeNoise(res)) parts.push(tr("rozdíl objemů {0} mm³", loc(res.volumeDiff, 3)));
    if (res.map && res.map.stats.max > cmd.tolerance + res.map.accuracy) parts.push(mapText());
  } else if (!parts.length && res.map) parts.push(mapText());
  const more = inexact ? 0 : regionList(res).length - list.length;
  coded(ctx, "compare.mismatch", { doc: label, args: [parts.join("; ") + (more > 0 ? tr(" (+{0} dalších)", more) : "")], ...(cmd.strict ? { level: "error" as const } : {}) });
};
