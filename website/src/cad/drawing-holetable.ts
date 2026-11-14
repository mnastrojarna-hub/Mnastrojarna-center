/**
 * Tabulka děr výkresu (vlna 15, B12 – tabulka je místem poloh děr: `kótovat díry tabulka`, automatika u desek s mnoha
 * dírami, listy s tabulkou děr). Čisté funkce bez jádra:
 * - `holeTableRows`: řádky z kružnic válcových ploch pohledu (drawing.ts `holeRowsOf`, jeden řádek na válec) se sloučí
 *   podle středu – souosé válce téže díry (zahloubení nad vrtákem) jsou JEDEN řádek „Ø8 ⌴Ø14“, ne další díra na téže
 *   poloze; závitová díra (vrták podle závitů dílu – `DrawingMeta.threads`, jako popisy děr ve výkresu) nese označení závitu
 *   „M8“ místo průměru vrtáku. Značky po druzích popisu (A1, A2 … B1 …), počet kusů podle popisu. Řádky, které už sloučil
 *   výtah děr (`steps` = větší souosé průměry, `thread` = závit – balík díry), se berou tak, jak jsou.
 * - `holeTableColumns`: dlouhá tabulka (víc než HOLE_SPLIT řádků) se rozdělí do dvou sloupců vedle sebe v šířce razítka –
 *   pás nad razítkem je pak poloviční (tabulka 40 děr nepřekryje pohledy).
 */
import type { HoleRow } from "./drawing";

/** od kolika řádků se tabulka dělí do dvou sloupců */
export const HOLE_SPLIT = 16;

const fmt = (n: number) => String(Math.round(n * 1000) / 1000).replace(".", ",");
/** označení závitu bez délky („M8 hl. 12“ → „M8“) */
const threadName = (label: string) => label.replace(/\s+(hl|dl)\..*$/u, "").trim();

/** Řádky tabulky: jeden na polohu díry (souosé válce = zahloubení), závit označením, značky a pořadí podle popisu. */
/** řádek výtahu děr – případně už sloučený (souosé průměry `steps`, závit `thread`) */
type RowIn = HoleRow & { steps?: number[]; thread?: string };

export function holeTableRows(rows: readonly RowIn[], threads: readonly { r: number; label: string }[] = []): HoleRow[] {
  const groups: RowIn[][] = [];
  for (const r of rows) {
    const g = groups.find((x) => Math.hypot(x[0].c[0] - r.c[0], x[0].c[1] - r.c[1]) < 1e-2);
    if (g) g.push(r);
    else groups.push([r]);
  }
  const merged = groups.map((g) => {
    const ds = [...new Set(g.flatMap((r) => [r.d, ...(r.steps ?? [])]))].sort((a, b) => a - b);
    const d = ds[0];
    const th = threads.find((t) => Math.abs(t.r - d / 2) < 0.03);
    const given = g.find((r) => r.thread)?.thread;
    const name = given ?? (th ? threadName(th.label) : `Ø${fmt(d)}`);
    const cb = ds.length > 1 ? ds[ds.length - 1] : 0;
    return { ...g[0], d, label: cb ? `${name} ⌴Ø${fmt(cb)}` : name, cb };
  });
  // druhy popisu podle průměru vrtáku (pak zahloubení, pak text) – značka A pro nejmenší jako dřív
  const kinds = [...new Map(merged.map((m) => [m.label, m])).values()].sort((a, b) => a.d - b.d || a.cb - b.cb || a.label.localeCompare(b.label)).map((m) => m.label);
  const list = merged.sort((a, b) => kinds.indexOf(a.label) - kinds.indexOf(b.label) || a.c[1] - b.c[1] || a.c[0] - b.c[0]);
  const counters: Record<string, number> = {};
  return list.map(({ cb: _cb, ...m }) => {
    void _cb;
    const letter = String.fromCharCode(65 + Math.min(25, kinds.indexOf(m.label)));
    counters[letter] = (counters[letter] ?? 0) + 1;
    return { ...m, tag: `${letter}${counters[letter]}` };
  });
}

/** Rozdělení řádků do sloupců tabulky (1, nebo 2 nad HOLE_SPLIT řádků) – první sloupec určuje výšku tabulky. */
export function holeTableColumns<T>(rows: readonly T[]): T[][] {
  if (rows.length <= HOLE_SPLIT) return [rows.slice()];
  const per = Math.ceil(rows.length / 2);
  return [rows.slice(0, per), rows.slice(per)];
}

/** počet kusů podle popisu řádku (sloupec „Ks“) */
export function holeTableCounts(rows: readonly HoleRow[]): Map<string, number> {
  const m = new Map<string, number>();
  for (const r of rows) m.set(r.label ?? String(r.d), (m.get(r.label ?? String(r.d)) ?? 0) + 1);
  return m;
}
