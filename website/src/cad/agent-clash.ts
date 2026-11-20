/**
 * Příkaz `kolize …` textem (vlna 22, bod 5 – čistý parser a úpravy dokumentu; provedení engine/ops/clash.ts):
 *
 * - `kolize` – kontrola kolizí sestavy (průniky v jádře, třídy, místo, seskupení opakovaných nálezů);
 * - `kolize seznam [skutečné|nevyhodnotitelné|závit|pod hlavou|dotyk|pracovní|vše]` – výpis poslední kontroly po skupinách
 *   (filtr třídy; bez filtru vše); EN `clash list [real|undetermined|thread|underhead|touch|work|all]`, DE `kollision liste …`;
 * - `kolize pravidlo pracovní "A" ["B"] [kroky K0..K1 | pohyb "VAZBA" V0..V1] [pozn "…"]` – pracovní kontakt operace
 *   (nástroj × plech): v okně ℹ `clash.work`, mimo okno ⚠ skutečná kolize; EN `clash rule work … [steps … | motion …] [note …]`,
 *   DE `kollision regel arbeit … [schritte … | bewegung …] [notiz …]`;
 * - `kolize pravidlo závit "A" ["B"]` – šroub v hladké jádrové díře (bez prvku závitu, import) je závitový záběr;
 *   EN `clash rule thread`, DE `kollision regel gewinde`;
 * - `kolize pravidla` – výpis pravidel; `kolize pravidlo N smazat` / `kolize pravidla smazat` – odebrání;
 * - `kolize tolerance 0,01` – tolerance dotyku [mm] (průnik tenčí = ℹ dotyk).
 *
 * Komponenty: název, přezdívka nebo `#k`; díl v podsestavě cestou `"Horní skupina/Šroub M12"` (nebo `›`).
 */
import { asmIsNum, asmNum, asmTokens, asmWords as W, findComp, fold } from "./agent-asm";
import type { ClashClass } from "./clash-class";
import { withRule, withoutRule } from "./clash-rules";
import { tr } from "./i18n";
import type { CadDoc, ClashRule } from "./types";

export type ClashListFilter = ClashClass | "faults" | "all";
export type ClashCmd =
  | { op: "check" }
  | { op: "list"; filter: ClashListFilter }
  | { op: "rule"; kind: "work" | "thread"; a: string; b?: string; steps?: [number, number]; mate?: string; from?: number; to?: number; note?: string }
  | { op: "rules" }
  | { op: "ruleDel"; n: number | "all" }
  | { op: "tol"; value: number };

const LIST = W("seznam", "výpis", "vypis", "list", "liste", "auflisten");
const RULE = W("pravidlo", "rule", "regel");
const RULES = W("pravidla", "rules", "regeln");
const DEL = W("smazat", "odebrat", "odstranit", "delete", "remove", "löschen", "loeschen", "entfernen");
const TOL = W("tolerance", "toleranz", "tol");
const WORK = W("pracovní", "pracovni", "práce", "prace", "work", "working", "arbeit", "arbeits", "arbeitskontakt");
const THREAD = W("závit", "zavit", "thread", "gewinde");
const STEPS = W("kroky", "krok", "steps", "step", "schritte", "schritt");
const MOTION = W("pohyb", "motor", "vazba", "motion", "mate", "bewegung", "antrieb", "verknüpfung", "verknuepfung");
const NOTE = W("pozn", "poznámka", "poznamka", "note", "notiz");
const ALL = W("vše", "vse", "všechny", "vsechny", "all", "alle", "alles");
const CLASS_WORDS: [ClashListFilter, Set<string>][] = [
  ["faults", W("závady", "zavady", "faults", "fehler", "chyby")],
  ["real", W("skutečné", "skutecne", "skutečná", "real", "echte", "echt")],
  ["undetermined", W("nevyhodnotitelné", "nevyhodnotitelne", "undetermined", "unbestimmt", "unbestimmte")],
  ["thread", W("závit", "zavit", "závity", "thread", "threads", "gewinde")],
  ["underhead", W("pod hlavou", "podhlavou", "underhead", "unterkopf")],
  ["touch", W("dotyk", "dotyky", "touch", "kontakt", "berührung", "beruehrung")],
  ["work", W("pracovní", "pracovni", "work", "arbeit")],
  ["all", ALL],
];

export const CLASH_USAGE = (): string =>
  tr("kolize [seznam [skutečné|závit|dotyk|pracovní|vše]] · kolize pravidlo pracovní \"A\" \"B\" [kroky 10..20 | pohyb \"ZDVIH\" 30..27] · kolize pravidlo závit \"A\" [\"B\"] · kolize pravidla · kolize pravidlo N smazat · kolize tolerance 0,01");

/** rozsah „10..20“, „30..27“, „10,5..12“ (desetinná čárka) */
function range(t: string | undefined, what: string): [number, number] {
  const m = /^([+-]?\d+(?:[.,]\d+)?)\.\.([+-]?\d+(?:[.,]\d+)?)$/.exec(t ?? "");
  if (!m) throw new Error(tr("{0}: čekám rozsah od..do (např. 10..20), ne „{1}“", what, t ?? ""));
  return [Number(m[1].replace(",", ".")), Number(m[2].replace(",", "."))];
}

/** Rozbor řádku za slovem `kolize` (prázdný = kontrola). */
export function parseClashText(rest: string): ClashCmd {
  const tk = asmTokens(rest);
  const word = (k: number) => (tk[k] && !tk[k].q ? fold(tk[k].t) : "");
  if (!tk.length) return { op: "check" };
  const w0 = word(0);
  if (LIST.has(w0)) {
    const t = tk.slice(1).map((x) => fold(x.t)).join(" ");
    if (!t) return { op: "list", filter: "all" };
    const hit = CLASS_WORDS.find(([, set]) => set.has(t));
    if (!hit) throw new Error(tr("kolize seznam: neznámá třída „{0}“ – skutečné, nevyhodnotitelné, závit, pod hlavou, dotyk, pracovní, závady, vše", t));
    return { op: "list", filter: hit[0] };
  }
  if (TOL.has(w0)) {
    const t = tk[1]?.t;
    if (!t || !asmIsNum(t) || !(asmNum(t) >= 0)) throw new Error(tr("kolize tolerance: čekám tloušťku dotyku v mm (např. kolize tolerance 0,01)"));
    return { op: "tol", value: asmNum(t) };
  }
  if (RULES.has(w0)) {
    if (DEL.has(word(1))) return { op: "ruleDel", n: "all" };
    if (tk.length > 1) throw new Error(CLASH_USAGE());
    return { op: "rules" };
  }
  if (RULE.has(w0)) {
    // kolize pravidlo N smazat
    if (tk[1] && /^\d+$/.test(tk[1].t) && DEL.has(word(2))) return { op: "ruleDel", n: Number(tk[1].t) };
    if (ALL.has(word(1)) && DEL.has(word(2))) return { op: "ruleDel", n: "all" };
    const kind = WORK.has(word(1)) ? "work" : THREAD.has(word(1)) ? "thread" : null;
    if (!kind) throw new Error(tr("kolize pravidlo: druh pracovní nebo závit – {0}", CLASH_USAGE()));
    let i = 2;
    const names: string[] = [];
    while (tk[i] && (tk[i].q || !(STEPS.has(word(i)) || MOTION.has(word(i)) || NOTE.has(word(i)))) && names.length < 2) names.push(tk[i++].t.trim());
    if (!names.length) throw new Error(tr("kolize pravidlo: chybí komponenta – {0}", CLASH_USAGE()));
    const cmd: Extract<ClashCmd, { op: "rule" }> = { op: "rule", kind, a: names[0], ...(names[1] ? { b: names[1] } : {}) };
    while (i < tk.length) {
      const w = word(i);
      if (STEPS.has(w)) {
        cmd.steps = range(tk[i + 1]?.t, tr("kroky")).map((v) => Math.round(v)) as [number, number];
        i += 2;
      } else if (MOTION.has(w)) {
        const m = tk[i + 1];
        if (!m) throw new Error(tr("kolize pravidlo: za „pohyb“ název vazby motoru v uvozovkách nebo číslo vazby"));
        cmd.mate = m.t.trim();
        const [from, to] = range(tk[i + 2]?.t, tr("pohyb"));
        cmd.from = from;
        cmd.to = to;
        i += 3;
      } else if (NOTE.has(w)) {
        cmd.note = tk
          .slice(i + 1)
          .map((x) => x.t)
          .join(" ")
          .trim();
        i = tk.length;
      } else throw new Error(tr("kolize pravidlo: nečekané „{0}“ – {1}", tk[i].t, CLASH_USAGE()));
    }
    if (cmd.kind === "thread" && (cmd.steps || cmd.mate)) throw new Error(tr("kolize pravidlo závit platí vždy – bez kroků a pohybu"));
    return cmd;
  }
  throw new Error(CLASH_USAGE());
}

/** cesta id komponenty z textu: název / přezdívka / `#k`, díl v podsestavě „Skupina/Díl“ nebo „Skupina › Díl“ */
export function compPath(doc: CadDoc, ref: string): string[] {
  const parts = ref.split(/\s*(?:›|\/)\s*/).filter(Boolean);
  const out: string[] = [];
  let cur: CadDoc = doc;
  for (let k = 0; k < parts.length; k++) {
    const c = findComp(cur, parts[k]);
    out.push(c.id);
    if (k < parts.length - 1) {
      if (c.source.kind !== "asm") throw new Error(tr("„{0}“ není podsestava – díl v ní nelze vybrat", c.name));
      cur = c.source.doc;
    }
  }
  return out;
}

/** vazba motoru podle názvu nebo čísla (1 = první vazba) → id */
function mateId(doc: CadDoc, ref: string): string {
  const mates = doc.mates ?? [];
  const n = /^#?(\d+)$/.exec(ref.trim());
  const m = n ? mates[Number(n[1]) - 1] : (mates.find((x) => x.name === ref) ?? mates.find((x) => x.name && fold(x.name) === fold(ref)));
  if (!m) throw new Error(tr("vazba „{0}“ v sestavě není – vazby: {1}", ref, mates.map((x, i) => `${i + 1} ${x.name ?? x.type}`).join(", ") || tr("žádné")));
  return m.id;
}

/** pravidlo z příkazu (komponenty a vazba přeložené na id) */
export function ruleFromCmd(doc: CadDoc, cmd: Extract<ClashCmd, { op: "rule" }>): Omit<ClashRule, "id"> {
  const a = compPath(doc, cmd.a);
  const b = cmd.b ? compPath(doc, cmd.b) : undefined;
  const when = cmd.steps ? { steps: cmd.steps } : cmd.mate !== undefined ? { mate: mateId(doc, cmd.mate), from: cmd.from, to: cmd.to } : undefined;
  return { kind: cmd.kind, a, ...(b ? { b } : {}), ...(when ? { when } : {}), ...(cmd.note ? { note: cmd.note } : {}) };
}

/** úprava dokumentu příkazem pravidla / tolerance (null = příkaz dokument nemění) */
export function applyClashDocCmd(doc: CadDoc, cmd: ClashCmd): { doc: CadDoc; rule?: ClashRule; removed?: ClashRule[] } | null {
  switch (cmd.op) {
    case "rule": {
      const d = withRule(doc, ruleFromCmd(doc, cmd));
      return { doc: d, rule: d.clashRules![d.clashRules!.length - 1] };
    }
    case "ruleDel": {
      const rules = doc.clashRules ?? [];
      if (cmd.n === "all") {
        const d = { ...doc };
        delete d.clashRules;
        return { doc: d, removed: rules };
      }
      const r = rules[cmd.n - 1];
      if (!r) throw new Error(tr("pravidlo kolizí {0} v sestavě není – pravidel: {1}", cmd.n, rules.length));
      return { doc: withoutRule(doc, r.id), removed: [r] };
    }
    case "tol":
      return { doc: { ...doc, clashTol: cmd.value } };
    default:
      return null;
  }
}

/** slova skriptu podle jazyka (doc → skript, cad/doc-script.ts) */
const SCRIPT_WORDS = {
  clash: ["kolize", "clash", "kollision"],
  rule: ["pravidlo", "rule", "regel"],
  work: ["pracovní", "work", "arbeit"],
  thread: ["závit", "thread", "gewinde"],
  steps: ["kroky", "steps", "schritte"],
  motion: ["pohyb", "motion", "bewegung"],
  note: ["pozn", "note", "notiz"],
  tol: ["tolerance", "tolerance", "toleranz"],
} as const;
const sn = (v: number) => String(Math.round(v * 1e6) / 1e6).replace(".", ",");

/**
 * Řádky skriptu pro pravidla kolizí a toleranci dotyku dokumentu (doc → skript, tam a zpět): `ref(cesta)` = odkaz komponenty
 * ve skriptu (`#3`, `#3/#2`; null = komponenta ve skriptu není), `mateNo(id)` = číslo vazby ve skriptu. Nepřenesitelné
 * pravidlo vrátí v `skipped`.
 */
export function clashRulesScript(doc: CadDoc, li: 0 | 1 | 2, ref: (path: readonly string[]) => string | null, mateNo: (id: string) => number | undefined): { lines: string[]; skipped: number } {
  const w = (k: keyof typeof SCRIPT_WORDS) => SCRIPT_WORDS[k][li];
  const lines: string[] = [];
  let skipped = 0;
  for (const r of doc.clashRules ?? []) {
    const a = ref(r.a);
    const b = r.b?.length ? ref(r.b) : "";
    if (!a || b === null) {
      skipped++;
      continue;
    }
    let l = `${w("clash")} ${w("rule")} ${w(r.kind === "work" ? "work" : "thread")} ${a}${b ? ` ${b}` : ""}`;
    if (r.when?.steps) l += ` ${w("steps")} ${r.when.steps[0]}..${r.when.steps[1]}`;
    else if (r.when?.mate !== undefined) {
      const no = mateNo(r.when.mate);
      if (no === undefined) {
        skipped++;
        continue;
      }
      l += ` ${w("motion")} ${no} ${sn(r.when.from ?? 0)}..${sn(r.when.to ?? 0)}`;
    }
    if (r.note) l += ` ${w("note")} ${r.note}`;
    lines.push(l);
  }
  if (doc.clashTol !== undefined) lines.push(`${w("clash")} ${w("tol")} ${sn(doc.clashTol)}`);
  return { lines, skipped };
}
