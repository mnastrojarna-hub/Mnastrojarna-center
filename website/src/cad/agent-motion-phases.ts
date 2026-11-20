/**
 * Fáze pohybové studie textem (vlna 22, bod 3 – čistý parser; provedení cad/asm-agent-kin.ts, model cad/motion-phases.ts):
 *
 * - `pohyb fáze "Sevření" [při vazba <N|"název"> <=|>= <hodnota> | při motor <N> <=|>= <hodnota> | od <T> s]
 *   [zapnout vazba <N> …] [potlačit vazba <N> …] [kinematika | kvazistatika | dynamika | automaticky]` – přidá fázi na konec;
 * - `pohyb fáze <N|"název"> upravit [název "…"] [při … | od T s | bez podmínky] [zapnout …] [potlačit …] [režim]` – úprava;
 * - `pohyb fáze <N|"název"> smazat`, `pohyb fáze <N|"název"> nahoru|dolů` (pořadí), `pohyb fáze` – výpis.
 *
 * EN: `motion phase "Clamp" when mate 3 <= 0 enable mate 5 suppress mate 6 quasistatic`, `motion phase 2 edit|delete|up|down`;
 * DE: `bewegung phase "Klemmen" wenn verknüpfung 3 <= 0 aktivieren verknüpfung 5 unterdrücken verknüpfung 6 quasistatik`.
 */
import { tr } from "./i18n";
import { AsmCursor, asmIsNum, asmWords as W } from "./agent-asm";

export type PhaseCondSpec = { t: number } | { mate: string; op: "<=" | ">="; value: number } | { motor: string; op: "<=" | ">="; value: number };
export type PhaseSpec = {
  name?: string;
  /** null = bez podmínky (fáze začne hned po předchozí) */
  start?: PhaseCondSpec | null;
  enable?: string[];
  suppress?: string[];
  /** null = režim studie (automaticky) */
  mode?: "kinematic" | "quasistatic" | "dynamic" | null;
};
export type PhaseCmd =
  | { k: "list" }
  /** `spec.name` chybí jen u `pohyb událost` – název „Událost N“ doplní provedení */
  | { k: "add"; spec: PhaseSpec }
  | { k: "edit"; ref: string; spec: PhaseSpec }
  | { k: "remove"; ref: string }
  | { k: "move"; ref: string; dir: -1 | 1 };

const K = {
  when: W("při", "pri", "když", "kdyz", "jakmile", "when", "once", "if", "wenn", "sobald", "bei"),
  from: W("od", "from", "after", "ab", "von", "nach"),
  atTime: W("čase", "case", "time", "zeit", "zeitpunkt"),
  mate: W("vazba", "vazbě", "vazbu", "mate", "constraint", "verknüpfung", "verknuepfung", "bedingung"),
  motor: W("motor", "pohon", "drive", "antrieb"),
  enable: W("zapnout", "zapni", "aktivovat", "enable", "activate", "aktivieren", "einschalten"),
  suppress: W("potlačit", "potlacit", "vypnout", "suppress", "disable", "unterdrücken", "unterdruecken", "deaktivieren"),
  kin: W("kinematika", "kinematiku", "kinematic", "kinematics", "kinematik", "kinematisch"),
  quasi: W("kvazistatika", "kvazistatiku", "quasistatic", "quasi-static", "quasistatik", "quasistatisch"),
  dyn: W("dynamika", "dynamiku", "dynamic", "dynamics", "dynamik", "dynamisch"),
  auto: W("automaticky", "auto", "automatic", "automatisch"),
  edit: W("upravit", "změnit", "zmenit", "edit", "change", "bearbeiten", "ändern", "aendern"),
  del: W("smazat", "odstranit", "zrušit", "zrusit", "delete", "remove", "löschen", "loeschen", "entfernen"),
  up: W("nahoru", "výš", "vys", "dříve", "drive", "up", "earlier", "hoch", "nach-oben", "früher", "frueher"),
  down: W("dolů", "dolu", "níž", "niz", "později", "pozdeji", "down", "later", "runter", "nach-unten", "später", "spaeter"),
  name: W("název", "nazev", "jméno", "jmeno", "name", "bezeichnung"),
  none: W("bez", "without", "ohne"),
  cond: W("podmínky", "podminky", "podmínka", "podminka", "condition", "bedingung"),
  sec: W("s", "sec", "sek", "sekund", "seconds"),
  at: W("v", "at", "um"),
};

export const PHASE_USE = () =>
  tr("pohyb fáze \"<název>\" [při vazba <N> <=|>= <hodnota> | při motor <N> <=|>= <hodnota> | od <T> s] [zapnout vazba <N>] [potlačit vazba <N>] [kinematika|kvazistatika|automaticky] · pohyb fáze <N> upravit|smazat|nahoru|dolů · pohyb fáze");

const OPS: Record<string, "<=" | ">="> = { "<=": "<=", "≤": "<=", "<": "<=", "=<": "<=", ">=": ">=", "≥": ">=", ">": ">=", "=>": ">=" };

/** operátor a hodnota: „<= 30“, „≤ 30“, „<=30“ */
function opValue(c: AsmCursor): { op: "<=" | ">="; value: number } {
  const t = c.next();
  if (!t) throw new Error(tr("fáze: podmínka potřebuje operátor <= nebo >= a hodnotu – při vazba \"ZDVIH\" <= 30"));
  const m = /^(<=|>=|≤|≥|=<|=>|<|>)(.*)$/.exec(t.t.trim());
  if (!m) throw new Error(tr("fáze: podmínka potřebuje operátor <= nebo >= a hodnotu, ne „{0}“", t.t));
  const op = OPS[m[1]];
  if (m[2]) {
    if (!asmIsNum(m[2])) throw new Error(tr("fáze: hodnota podmínky „{0}“ není číslo", m[2]));
    c.tk.splice(c.i, 0, { t: m[2], q: false });
  }
  return { op, value: c.num(tr("hodnota podmínky")) };
}

/** odkaz na vazbu za slovem „vazba“ (číslo / název) – víc vazeb za sebou: „zapnout vazba 5 vazba 6“ nebo „zapnout vazba 5 6“ */
function mateRefs(c: AsmCursor): string[] {
  const out: string[] = [];
  while (c.is(K.mate)) {
    c.i++;
    const t = c.next();
    if (!t) throw new Error(tr("fáze: za „vazba“ zadejte číslo nebo název vazby"));
    out.push(t.t.replace(/^#/, "").trim());
    // další čísla bez slova „vazba“
    while (!c.done && !c.peek()!.q && /^#?\d+$/.test(c.peek()!.t)) out.push(c.next()!.t.replace(/^#/, ""));
  }
  if (!out.length) throw new Error(tr("fáze: zapnout / potlačit vazba <N> – např. zapnout vazba 5"));
  return out;
}

/** volby fáze (podmínka, vazby, režim, název) – `allowName` = holý název na začátku (přidání) */
function phaseSpec(c: AsmCursor, o: { allowName: boolean }): PhaseSpec {
  const spec: PhaseSpec = {};
  while (!c.done) {
    if (c.is(K.when)) {
      c.i++;
      if (c.is(K.mate)) {
        c.i++;
        const t = c.next();
        if (!t) throw new Error(tr("fáze: při vazba <N|\"název\"> <= hodnota"));
        spec.start = { mate: t.t.replace(/^#/, "").trim(), ...opValue(c) };
      } else if (c.is(K.motor)) {
        c.i++;
        const t = c.next();
        if (!t) throw new Error(tr("fáze: při motor <N> <= hodnota"));
        spec.start = { motor: t.t.replace(/^#/, "").trim(), ...opValue(c) };
      } else if (c.is(K.atTime) || c.is(K.from)) {
        c.i++;
        spec.start = { t: c.num(tr("čas fáze")) };
        if (c.is(K.sec)) c.i++;
      } else throw new Error(tr("fáze: podmínka – při vazba <N> <= hodnota | při motor <N> >= hodnota | od <T> s"));
    } else if (c.is(K.from) && asmIsNum(c.peek(1)?.t ?? "")) {
      c.i++;
      spec.start = { t: c.num(tr("čas fáze")) };
      if (c.is(K.sec)) c.i++;
    } else if (c.is(K.at) && c.is(K.atTime, 1)) {
      c.i += 2;
      spec.start = { t: c.num(tr("čas fáze")) };
      if (c.is(K.sec)) c.i++;
    } else if (c.is(K.none) && c.is(K.cond, 1)) {
      c.i += 2;
      spec.start = null;
    } else if (c.is(K.enable)) {
      c.i++;
      spec.enable = [...(spec.enable ?? []), ...mateRefs(c)];
    } else if (c.is(K.suppress)) {
      c.i++;
      spec.suppress = [...(spec.suppress ?? []), ...mateRefs(c)];
    } else if (c.is(K.kin)) {
      c.i++;
      spec.mode = "kinematic";
    } else if (c.is(K.quasi)) {
      c.i++;
      spec.mode = "quasistatic";
    } else if (c.is(K.dyn)) {
      c.i++;
      spec.mode = "dynamic";
    } else if (c.is(K.auto)) {
      c.i++;
      spec.mode = null;
    } else if (c.is(K.name)) {
      c.i++;
      spec.name = c.str(tr("název fáze"));
    } else if (o.allowName && spec.name === undefined && c.peek()!.q) spec.name = c.next()!.t.trim();
    else throw new Error(tr("pohyb fáze: neznámá volba „{0}“ – {1}", c.peek()!.t, PHASE_USE()));
  }
  if (spec.start && "t" in spec.start && !(spec.start.t >= 0)) throw new Error(tr("fáze: čas začátku musí být ≥ 0 s"));
  return spec;
}

/** Rozbor za slovy „pohyb fáze“. */
export function parsePhaseText(c: AsmCursor, o: { event?: boolean } = {}): PhaseCmd {
  if (c.done) return { k: "list" };
  if (o.event) return { k: "add", spec: phaseSpec(c, { allowName: true }) };
  // odkaz na existující fázi: číslo, nebo název následovaný akcí
  const t = c.peek()!;
  const isRef = (!t.q && /^#?\d+$/.test(t.t)) || (t.q && (c.is(K.edit, 1) || c.is(K.del, 1) || c.is(K.up, 1) || c.is(K.down, 1)));
  if (isRef) {
    c.i++;
    const ref = t.t.replace(/^#/, "").trim();
    if (c.done) throw new Error(tr("pohyb fáze {0}: upravit | smazat | nahoru | dolů", ref));
    if (c.is(K.del)) return { k: "remove", ref };
    if (c.is(K.up)) return { k: "move", ref, dir: -1 };
    if (c.is(K.down)) return { k: "move", ref, dir: 1 };
    if (c.is(K.edit)) c.i++;
    return { k: "edit", ref, spec: phaseSpec(c, { allowName: false }) };
  }
  const spec = phaseSpec(c, { allowName: true });
  if (!spec.name) throw new Error(tr("pohyb fáze: zadejte název v uvozovkách – {0}", PHASE_USE()));
  return { k: "add", spec };
}
