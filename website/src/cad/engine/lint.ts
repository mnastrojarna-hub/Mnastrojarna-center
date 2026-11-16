/**
 * Tiché změny zápisu, které rozbor přečte bez chyby, ale postaví jinak, než je napsáno (CAD-HEADLESS-NAVRH.md 5.2
 * č. 2, 5–10, 38; balík B4). Kontrola běží nad hotovou operací a slovy jejího řádku – parser (agent.ts) se nemění, takže
 * pravidla platí stejně pro díru, vysunutí i primitiva a nekříží se s úpravami parseru jiných týmů.
 *
 * Výsledek: seznam ⚠ s kódem a argumenty textu (engine je zapíše na řádek operace před během).
 */
import { canon, tokenize, type AgentOp } from "../agent";
import { threadByName } from "../defaults";
import type { Feature } from "../types";
import { tr } from "../i18n";
import type { Code } from "./codes";

export type LintDiag = { code: Code; args: unknown[] };

const isNum = (t: string) => /^[+-]?ø?(\d+[.,]?\d*|[.,]\d+)(mm|°)?$/i.test(t.replace(/^[øØ]/, ""));
const num = (t: string) => Number(t.replace(/^[øØ]/, "").replace(/(mm|°)$/i, "").replace(",", "."));
const MODES = ["cut", "intersect", "newbody", "add"] as const;
/** prvky, u kterých volba režimu (přidat / odebrat / průnik / nové) něco znamená */
const MODE_TYPES = new Set(["extrude", "revolve", "box", "cylinder", "sphere", "cone", "tube", "sweep", "loft", "spring", "text", "thicken", "ext"]);
const fmt = (n: number) => String(Math.round(n * 1000) / 1000);

/** čísla za klíčovým slovem (kanonický název volby) – každý výskyt zvlášť */
function groupsOf(words: string[], key: string): number[][] {
  const out: number[][] = [];
  for (let i = 0; i < words.length; i++) {
    if (canon(words[i]) !== key) continue;
    const g: number[] = [];
    for (let j = i + 1; j < words.length && isNum(words[j]); j++) g.push(num(words[j]));
    out.push(g);
  }
  return out;
}

/**
 * Hodnoty, které stavba ořízne do platného rozsahu (5.2 č. 24–26 – build.ts, ext/surface.ts, ext/sheetmetal-form-geom.ts):
 * ⚠ param.clamped s původní a použitou hodnotou. Pravidla jsou tytéž meze jako ve stavbě.
 */
export function lintParams(f: Feature): LintDiag[] {
  const out: LintDiag[] = [];
  const clamp = (v: unknown, lo: number, hi: number, what: string, map?: (x: number) => number) => {
    if (typeof v !== "number" || !Number.isFinite(v)) return;
    const used = map ? map(v) : Math.min(hi, Math.max(lo, v));
    if (Math.abs(used - v) > 1e-9) out.push({ code: "param.clamped", args: [fmt(v), fmt(used), what] });
  };
  if (f.type === "hole") {
    if (f.kind === "countersink") clamp(f.csAngle, 30, 170, tr("úhel kuželového zahloubení 30–170°"));
    const tip = (f as Feature & { tipAngle?: number }).tipAngle;
    if (tip !== undefined && tip !== 180) clamp(tip, 60, 170, tr("hrot vrtáku 60–170° (180 = ploché dno)"));
  } else if (f.type === "revolve") {
    clamp(f.angle, 0.01, 360, tr("úhel rotace 0,01–360° (0 = celá otáčka)"), (x) => Math.max(0.01, Math.min(360, x || 360)));
  } else if (f.type === "ext") {
    const d = (f.data ?? {}) as Record<string, unknown>;
    if ("wallAngle" in d) clamp(d.wallAngle, 5, 90, tr("úhel stěny tvářecího nástroje 5–90°"));
    if (/revol|rotat/i.test(f.ext) && "angle" in d) clamp(d.angle, 0.1, 360, tr("úhel rotace plochy 0,1–360°"));
  }
  return out;
}

/** Tiché změny zápisu operace na řádku `text` (bez komentáře). */
export function lintOp(op: AgentOp, text: string): LintDiag[] {
  if (op.k === "features") return op.features.flatMap(lintParams);
  if (op.k !== "feature" && op.k !== "select") return [];
  const params = lintParams(op.feature as Feature);
  const f = op.feature as Feature;
  const all = tokenize(text);
  // obecný příkaz `prvek …` a JSON zadávají pole výslovně (depth=0 = skrz) – kontrolují se jen textové příkazy prvků
  if (!all.length || /^[[{]/.test(text.trim()) || canon(all[0]) === "feature") return params;
  const words = all.slice(1);
  const c = new Set(words.map(canon));
  const out: LintDiag[] = [...params];
  const said = (key: string) => words.find((w) => canon(w) === key) ?? key;
  // 5.2 č. 10: více režimů najednou → přednost odebrat > průnik > nové > přidat (modeOf, agent-extr, agent-prim)
  if (MODE_TYPES.has(f.type)) {
    const given = MODES.filter((m) => c.has(m));
    if (given.length > 1) out.push({ code: "parse.conflict", args: [said(given[0]), given.slice(1).map(said).join(", ")] });
  }
  if (f.type === "extrude" && canon(all[0]) === "extrude") {
    // 5.2 č. 9: `vysunout H skrz` – délka H se zahodí (skrz = přes celé těleso)
    const len = words.findIndex((w) => isNum(w));
    if (f.extent?.kind === "throughAll" && len === 0) out.push({ code: "parse.conflict", args: [said("through"), words[0]] });
  }
  if (f.type === "hole" && canon(all[0]) === "hole") {
    const through = c.has("through");
    const depth = groupsOf(words, "depth").filter((g) => g.length);
    const toBody = f.end?.kind === "toBody";
    // 5.2 č. 5: díra bez hloubky / skrz / k tělesu = skrz
    if (!through && !depth.length && !toBody && !f.bothWays && !(f.depth > 0)) out.push({ code: "hole.depth-default", args: [] });
    // 5.2 č. 6: hloubka i skrz → hloubka se zahodí
    if (through && depth.length) out.push({ code: "parse.conflict", args: [said("through"), `${said("depth")} ${depth[0].join(" ")}`] });
    // 5.2 č. 7: zahloubení i kuželové zahloubení → vyhraje kuželové
    if (c.has("counterbore") && c.has("countersink")) out.push({ code: "hole.conflict", args: [said("countersink")] });
    // 5.2 č. 8: zahloubení u závitové díry se dnes nepostaví (do sloučení balíku w15-hole, který ho postaví – pole `head`)
    const h = f as Feature & { head?: string };
    if (f.kind === "tapped" && f.cbDiameter > 0 && !h.head) out.push({ code: "hole.cbore-dropped", args: [fmt(f.cbDiameter), f.thread ?? ""] });
    // 5.2 č. 2: poloha jedním číslem – druhá souřadnice = 0 (dvě čísla = na povrchu tělesa, tři = x y z)
    for (const g of groupsOf(words, "at")) if (g.length === 1) out.push({ code: "parse.coord-missing", args: [`${said("at")} ${g[0]} → [${g[0]}; 0]`] });
    // 5.2 č. 38: zadaný průměr závitové díry nahrazen tabulkovým vrtákem (jmenovitý průměr, nesmyslně malé číslo)
    if (f.kind === "tapped" && f.thread && f.tapDrill !== "custom" && f.tapDrill !== "minor") {
      const given = isNum(words[0] ?? "") ? num(words[0]) : groupsOf(words, "diameter")[0]?.[0];
      const t = threadByName(f.thread);
      if (given !== undefined && t && Math.abs(given - f.diameter) > 5e-4) out.push({ code: "hole.tap-diameter", args: [fmt(given), fmt(f.diameter), t.name] });
    }
  }
  return out;
}
