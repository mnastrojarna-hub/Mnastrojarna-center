/**
 * Textový příkaz svar (8. vlna, CS / EN / DE) – koutový, tupý s úpravou ISO 9692-1, děrový / žlábkový, bodový svar a tabulka
 * svarů. Čisté funkce bez jádra (testovatelné v Node); agent.ts je volá před ostatními příkazy, null = jiný příkaz.
 *
 *   svar koutový a5 hrany <pravidlo|E7;E9> [oboustranně] [kolem] [přerušovaný 50/100] [z] [montážní] [metoda 135]
 *   svar tupý V 60 otupení 1 mezera 2 hrana E7 [podložka] [převýšení 1,5] [kořen 1] [obráceně]
 *   svar X 60 … · svar U R6 [úhel 10] … · svar ½V 45 … · svar K … · svar J R6 … · svar I mezera 3 …   (plocha F3 = čelo spoje)
 *   svar děrový Ø12 [počet 2] [rozteč 60] plocha F3 · svar žlábkový 30×10 … · svar bodový Ø6 rozteč 40 [počet 5] plocha F3
 *   svar tabulka
 *   EN: weld fillet a5 edges … [both sides] [all around] [intermittent 50/100] · weld butt V 60 root face 1 gap 2 edge E7 [backing]
 *       weld plug Ø12 … · weld slot … · weld spot Ø6 pitch 40 … · weld table
 *   DE: schweißnaht / naht kehlnaht a5 kanten … [beidseitig] [ringsum] [unterbrochen 50/100] · naht stumpf V 60 steg 1 spalt 2
 *       kante E7 [badsicherung] · naht lochnaht Ø12 … · naht schlitznaht … · naht punkt Ø6 teilung 40 … · naht tabelle
 *
 * Hrany / plochy: čísla jako popisky pro výběr (E7, F3; více odděleno středníkem či mezerou) nebo pravidlo (svislé, horní, +Z…)
 * – pravidlo vybere aplikace na aktivním tělese.
 */
import { tr } from "./i18n";
import { getExt } from "./ext/registry";
import { PREPS, type GroovePrep } from "./ext/weld-calc";
import { emptyDoc, uid, type Feature } from "./types";

export type WeldOp =
  | { k: "feature"; feature: Feature; line: number }
  | { k: "select"; feature: Feature; rule: string[]; line: number; into: { path: string; kind: "faces" | "edges" } }
  | { k: "api"; cmd: { kind: "action"; id: string }; line: number };

const fold = (s: string) => s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/ß/g, "ss");
const set = (...w: string[]) => new Set(w.map(fold));
const NUM = /^[+-]?(\d+[.,]?\d*|[.,]\d+)$/;
const num = (t: string) => parseFloat(t.replace(",", "."));

const HEAD = set("svar", "svary", "weld", "welds", "schweissnaht", "schweißnaht", "naht", "schweissen", "schweißen");
const FILLET = set("koutovy", "koutový", "kout", "fillet", "kehlnaht", "kehl", "koutove", "koutové");
const BUTT = set("tupy", "tupý", "butt", "groove", "stumpf", "stumpfnaht", "tupe", "tupé");
const PLUG = set("derovy", "děrový", "plug", "lochnaht", "loch", "derovi", "dira", "díra");
const SLOT = set("zlabkovy", "žlábkový", "slot", "schlitznaht", "schlitz", "langloch", "zlabek", "žlábek");
const SPOT = set("bodovy", "bodový", "spot", "punkt", "punktnaht", "punktschweissung", "punktschweißung", "bod");
const TABLE = set("tabulka", "table", "tabelle", "tab", "seznam", "list", "liste");
/** úpravy: slovo → úprava (½V i jako 1/2V, HV, polovicni V) */
const PREP_WORDS: Record<string, GroovePrep> = {
  i: "I", v: "V", y: "Y", x: "X", "2v": "X", u: "U", "2u": "UU", uu: "UU", "½v": "HV", "1/2v": "HV", hv: "HV", "½y": "HY", "1/2y": "HY", hy: "HY", k: "K", "2½v": "K", j: "J", "2j": "JJ", jj: "JJ",
};

const EDGES = set("hrany", "hrana", "hran", "edges", "edge", "kanten", "kante");
const FACES = set("plocha", "plochy", "plose", "ploše", "face", "faces", "flache", "fläche", "flaeche", "flachen", "flächen", "cela", "čelo", "celo", "stirnflache", "stirnfläche");
const ANGLE = set("uhel", "úhel", "angle", "winkel", "alfa", "alpha", "beta", "β", "α");
const ROOTFACE = set("otupeni", "otupení", "rootface", "steg", "stegflanke", "c");
const GAP = set("mezera", "gap", "spalt", "b", "spara", "spára");
const RADIUS = set("polomer", "poloměr", "radius", "r");
const CAP = set("prevyseni", "převýšení", "cap", "reinforcement", "uberhohung", "überhöhung", "ueberhoehung", "nahtuberhohung", "housenka");
const ROOT = set("koren", "kořen", "root", "wurzel", "wurzeluberhohung", "wurzelüberhöhung");
const BACKING = set("podlozka", "podložka", "backing", "badsicherung", "unterlage", "badunterlage");
const BOTH = set("oboustranne", "oboustranně", "oboustranny", "oboustranný", "both", "doublesided", "beidseitig", "doppelseitig", "beidseits");
const AROUND = set("kolem", "dokola", "allaround", "around", "ringsum", "umlaufend", "rundum", "obvod", "poobvodu");
const INTERMITTENT = set("prerusovany", "přerušovaný", "prerusovane", "přerušovaně", "intermittent", "unterbrochen", "stitch");
const FIELD = set("montazni", "montážní", "field", "site", "montage", "baustelle", "baustellennaht");
const PROCESS = set("metoda", "metodou", "process", "prozess", "verfahren", "iso4063");
const EFF = set("ucinnost", "účinnost", "efficiency", "eff", "wirkungsgrad", "ausbringung");
const DIAM = set("prumer", "průměr", "diameter", "d", "durchmesser", "ø");
const PITCH = set("roztec", "rozteč", "pitch", "teilung", "abstand", "e");
const COUNT = set("pocet", "počet", "count", "anzahl", "n", "ks", "stuck", "stück");
const LENGTH = set("delka", "délka", "length", "lange", "länge", "laenge", "l");
const FLIP = set("obracene", "obráceně", "flip", "reverse", "umgekehrt", "obratit", "obrátit", "druhastrana");
const THICK = set("tloustka", "tloušťka", "thickness", "t", "dicke", "s");
const SHORT = set("kratsi", "kratší", "short", "kurz", "kurze", "napric", "napříč");
const LONG = set("delsi", "delší", "long", "lang", "lange", "podel", "podél");
const SHIFT = set("posun", "shift", "offset", "versatz");
const MERGE = set("sloucit", "sloučit", "merge", "fuse", "verschmelzen", "vereinen");
const NAME = set("nazev", "název", "name", "jako", "as", "als");
const SIZE_A = set("a", "ucinna", "účinná", "throat");
const SIZE_Z = set("z", "rameno", "leg", "schenkel");
const EXTRA_FACE = set("face"); // „root face“
const AT = set("u", "at", "bei", "pri", "při", "near", "nahe", "bod", "point", "punkt");
const KEYS = [EDGES, FACES, ANGLE, ROOTFACE, GAP, RADIUS, CAP, ROOT, BACKING, BOTH, AROUND, INTERMITTENT, FIELD, PROCESS, EFF, DIAM, PITCH, COUNT, LENGTH, FLIP, THICK, SHORT, LONG, SHIFT, MERGE, NAME];
const isKey = (t: string) => KEYS.some((k) => k.has(fold(t)));

/** Rozdělí řádek na slova; text v uvozovkách je jedno slovo. */
function tokens(line: string): { t: string; q: boolean }[] {
  const out: { t: string; q: boolean }[] = [];
  const re = /"([^"]*)"|„([^“]*)“|([^\s"„]+)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(line))) out.push(m[1] != null || m[2] != null ? { t: m[1] ?? m[2], q: true } : { t: m[3], q: false });
  return out;
}

/** výběr entit: „E7;E9“, „E7 E9“, „7“ → indexy; jinak slova pravidla */
function pickList(words: string[], letter: "e" | "f"): { idx: number[]; rule: string[] } {
  const idx: number[] = [];
  const rule: string[] = [];
  for (const w of words.flatMap((x) => x.split(/[;,]/)).filter(Boolean)) {
    const m = new RegExp(`^${letter}?(\\d+)$`, "i").exec(w);
    if (m) idx.push(parseInt(m[1], 10) - 1);
    else rule.push(fold(w));
  }
  return { idx, rule };
}

/** Přečte řádek `svar …`; null = jiný příkaz. Chyba = srozumitelná hláška (protokol ji ukáže u řádku). */
export function parseWeldLine(line: string, no: number, named: (label: string) => string): WeldOp | null {
  const tk = tokens(line);
  if (!tk.length || !HEAD.has(fold(tk[0].t))) return null;
  const rest = tk.slice(1);
  if (!rest.length) throw new Error(tr("svar potřebuje druh: svar koutový a5 hrany … | svar tupý V 60 … | svar děrový Ø12 … | svar bodový Ø6 … | svar tabulka"));
  const w0 = fold(rest[0].t);
  if (TABLE.has(w0)) return { k: "api", cmd: { kind: "action", id: "weld.weldTable" }, line: no };
  let kind: "fillet" | "groove" | "plug" | "slot" | "spot";
  let prep: GroovePrep | null = null;
  let i = 1;
  if (FILLET.has(w0)) kind = "fillet";
  else if (BUTT.has(w0)) {
    kind = "groove";
    const p = PREP_WORDS[fold(rest[1]?.t ?? "")];
    if (p) {
      prep = p;
      i = 2;
    }
  } else if (PREP_WORDS[w0]) {
    kind = "groove";
    prep = PREP_WORDS[w0];
  } else if (PLUG.has(w0)) kind = "plug";
  else if (SLOT.has(w0)) kind = "slot";
  else if (SPOT.has(w0)) kind = "spot";
  else throw new Error(tr("neznámý druh svaru „{0}“ – koutový, tupý (V, Y, X, U, 2U, ½V, ½Y, K, J, 2J, I), děrový, žlábkový, bodový, tabulka", rest[0].t));
  const ext = kind === "fillet" ? "weld.bead" : kind === "groove" ? "weld.groove" : kind === "spot" ? "weld.spot" : "weld.plug";
  const def = getExt(ext);
  if (!def) throw new Error(tr("Prvek {0} není načten.", ext));
  const data: Record<string, unknown> = { ...def.make({ ...emptyDoc(""), features: [] }) };
  if (prep) data.prep = prep;
  let name: string | undefined;
  let edges: string[] | null = null;
  let faces: string[] | null = null;
  const free: number[] = [];
  const nextNum = (label: string): number => {
    const t = rest[i];
    if (!t || !NUM.test(t.t.replace(/[°]$/, ""))) throw new Error(tr("svar: za „{0}“ chybí číslo", label));
    i++;
    return num(t.t.replace(/[°]$/, ""));
  };
  const listUntilKey = (): string[] => {
    const out: string[] = [];
    while (i < rest.length && !(isKey(rest[i].t) && !/^[ef]?\d+$/i.test(rest[i].t))) out.push(rest[i++].t);
    return out;
  };
  for (; i < rest.length; ) {
    const raw = rest[i].t;
    const w = fold(raw);
    i++;
    if (rest[i - 1].q) {
      name = raw;
      continue;
    }
    // složené zápisy: a5, z7, R6, Ø12, s10, E7, F3, 50/100, 30×10, 5×
    let m: RegExpExecArray | null;
    if ((m = /^a(\d+[.,]?\d*)$/i.exec(raw)) && kind === "fillet") {
      data.a = num(m[1]);
      data.measure = "a";
      continue;
    }
    if ((m = /^z(\d+[.,]?\d*)$/i.exec(raw)) && kind === "fillet") {
      data.a = num(m[1]);
      data.measure = "z";
      continue;
    }
    if ((m = /^r(\d+[.,]?\d*)$/i.exec(raw))) {
      data.radius = num(m[1]);
      continue;
    }
    if ((m = /^[øØ⌀](\d+[.,]?\d*)$/.exec(raw))) {
      data.d = num(m[1]);
      continue;
    }
    if ((m = /^s(\d+[.,]?\d*)$/i.exec(raw)) && kind === "groove") {
      data.t = num(m[1]);
      continue;
    }
    if ((m = /^e(\d+)$/i.exec(raw))) {
      edges = [...(edges ?? []), raw];
      continue;
    }
    if ((m = /^f(\d+)$/i.exec(raw))) {
      faces = [...(faces ?? []), raw];
      continue;
    }
    if ((m = /^(\d+[.,]?\d*)\s*\/\s*(\d+[.,]?\d*)$/.exec(raw))) {
      data.intermittent = true;
      data.segLen = num(m[1]);
      data.pitch = num(m[2]);
      continue;
    }
    if ((m = /^(\d+[.,]?\d*)[×x*](\d+[.,]?\d*)$/i.exec(raw)) && (kind === "slot" || kind === "plug")) {
      // žlábek l × d
      const a = num(m[1]);
      const b = num(m[2]);
      data.slot = Math.max(a, b);
      data.d = Math.min(a, b);
      continue;
    }
    if ((m = /^(\d+)[×x*]$/i.exec(raw))) {
      data.n = parseInt(m[1], 10);
      continue;
    }
    if ((EDGES.has(w) || FACES.has(w)) && AT.has(fold(rest[i]?.t ?? ""))) {
      // hrana / plocha u bodu: „hrana u 5 50 12; -5 50 12“ – nejbližší hrana / plocha modelu (vyřeší jádro)
      i++;
      const nums: number[] = [];
      while (i < rest.length && /^[+-]?(\d+[.,]?\d*|[.,]\d+);?$/.test(rest[i].t)) nums.push(num(rest[i++].t.replace(/;$/, "")));
      if (!nums.length || nums.length % 3) throw new Error(tr("svar: bod hrany / plochy má tři souřadnice: hrana u x y z [; x y z]"));
      const pts: number[][] = [];
      for (let k = 0; k < nums.length; k += 3) pts.push(nums.slice(k, k + 3));
      const key = EDGES.has(w) ? "edgeAt" : "faceAt";
      data[key] = [...((data[key] as number[][] | undefined) ?? []), ...pts];
      if (EDGES.has(w)) edges = edges ?? [];
      else faces = faces ?? [];
      continue;
    }
    if (EDGES.has(w)) {
      edges = [...(edges ?? []), ...listUntilKey()];
      continue;
    }
    if (FACES.has(w) && !(fold(rest[i - 2]?.t ?? "") === "root")) {
      faces = [...(faces ?? []), ...listUntilKey()];
      continue;
    }
    if (w === "root" && EXTRA_FACE.has(fold(rest[i]?.t ?? ""))) {
      i++;
      data.rootFace = nextNum("root face");
      continue;
    }
    if (ANGLE.has(w)) data.angle = nextNum(raw);
    else if (ROOTFACE.has(w)) data.rootFace = nextNum(raw);
    else if (GAP.has(w)) data.gap = nextNum(raw);
    else if (RADIUS.has(w)) data.radius = nextNum(raw);
    else if (CAP.has(w)) data.cap = nextNum(raw);
    else if (ROOT.has(w)) data.root = NUM.test(rest[i]?.t ?? "") ? nextNum(raw) : 1;
    else if (BACKING.has(w)) data.backing = true;
    else if (BOTH.has(w) || (w === "both" && fold(rest[i]?.t ?? "") === "sides")) {
      data.both = true;
      if (fold(rest[i]?.t ?? "") === "sides") i++;
    } else if (AROUND.has(w) || (w === "all" && fold(rest[i]?.t ?? "") === "around")) {
      data.allAround = true;
      if (fold(rest[i]?.t ?? "") === "around") i++;
    } else if (INTERMITTENT.has(w)) {
      data.intermittent = true;
      const t = rest[i]?.t ?? "";
      const mm = /^(\d+[.,]?\d*)\s*\/\s*(\d+[.,]?\d*)$/.exec(t);
      if (mm) {
        data.segLen = num(mm[1]);
        data.pitch = num(mm[2]);
        i++;
      } else if (NUM.test(t)) {
        data.segLen = nextNum(raw);
        if (NUM.test(rest[i]?.t ?? "")) data.pitch = nextNum(raw);
      }
    } else if (FIELD.has(w)) data.field = true;
    else if (PROCESS.has(w)) {
      const t = rest[i]?.t;
      if (!t || !/^\d{2,3}$/.test(t)) throw new Error(tr("svar: metoda je číslo ISO 4063 (111, 131, 135, 136, 141, 21)"));
      data.process = t;
      i++;
    } else if (EFF.has(w)) data.eff = nextNum(raw);
    else if (DIAM.has(w)) data.d = nextNum(raw);
    else if (PITCH.has(w)) data.pitch = nextNum(raw);
    else if (COUNT.has(w)) data.n = Math.round(nextNum(raw));
    else if (LENGTH.has(w)) data.slot = nextNum(raw);
    else if (FLIP.has(w)) data.flip = true;
    else if (THICK.has(w)) data.t = nextNum(raw);
    else if (SHORT.has(w)) data.axis = "short";
    else if (LONG.has(w)) data.axis = "long";
    else if (SHIFT.has(w)) data.shift = nextNum(raw);
    else if (MERGE.has(w)) data.separate = false;
    else if (NAME.has(w)) {
      name = rest[i]?.t;
      i++;
    } else if (kind === "fillet" && SIZE_A.has(w)) {
      data.a = nextNum(raw);
      data.measure = "a";
    } else if (kind === "fillet" && SIZE_Z.has(w)) {
      data.a = nextNum(raw);
      data.measure = "z";
    } else if (kind === "groove" && !prep && PREP_WORDS[w]) {
      prep = PREP_WORDS[w];
      data.prep = prep;
    } else if (NUM.test(raw.replace(/[°]$/, ""))) free.push(num(raw.replace(/[°]$/, "")));
    else throw new Error(tr("svar: neznámé slovo „{0}“", raw));
  }
  // poziční číslo: koutový = velikost a; tupý = úhel; děrový / bodový = průměr
  if (free.length) {
    if (kind === "fillet" && data.a === getExt(ext)!.make({ ...emptyDoc(""), features: [] }).a) data.a = free[0];
    else if (kind === "groove" && data.angle === undefined) data.angle = free[0];
    else if ((kind === "plug" || kind === "spot" || kind === "slot") && free.length) data.d = free[0];
  }
  if (kind === "slot" && !(typeof data.slot === "number" && data.slot > 0)) throw new Error(tr("žlábkový svar potřebuje délku žlábku: svar žlábkový 30×10 … nebo délka 30 Ø10"));
  if (kind === "groove" && !data.prep) data.prep = "V";
  if (kind === "groove" && !PREPS.some((p) => p.v === data.prep)) throw new Error(tr("neznámá úprava „{0}“", String(data.prep)));
  if (kind === "fillet" && !(Number(data.a) > 0)) throw new Error(tr("koutový svar potřebuje velikost: svar koutový a5 hrany …"));
  const label = kind === "fillet" ? tr("Koutový svar") : kind === "groove" ? tr("Tupý svar {0}", String(data.prep).replace("HV", "½V").replace("HY", "½Y").replace("UU", "2U").replace("JJ", "2J")) : kind === "spot" ? tr("Bodový svar") : kind === "slot" ? tr("Žlábkový svar") : tr("Děrový svar");
  const feature = { id: uid(), name: name ?? named(label), type: "ext", ext, data } as unknown as Feature;
  // výběr: indexy přímo, pravidlo vybere aplikace
  const want: "edges" | "faces" = kind === "fillet" ? "edges" : kind === "groove" ? (edges ? "edges" : "faces") : "faces";
  const src = want === "edges" ? edges : faces;
  if (kind !== "groove" && kind !== "fillet" && edges && !faces) throw new Error(tr("děrový / bodový svar se zadává plochou horního plechu: … plocha F3 (nebo plocha horní)"));
  if (kind === "fillet" && faces && !edges) throw new Error(tr("koutový svar se zadává hranami koutu: … hrany E7;E9 (nebo pravidlem)"));
  const atList = want === "edges" ? data.edgeAt : data.faceAt;
  const byPoint = Array.isArray(atList) && atList.length > 0;
  if ((!src || !src.length) && !byPoint) throw new Error(want === "edges" ? tr("svar: chybí hrany – … hrany E7;E9, pravidlo (svislé, horní…) nebo hrana u x y z") : tr("svar: chybí plocha – … plocha F3, pravidlo (horní, +Z…) nebo plocha u x y z"));
  const pk = pickList(src ?? [], want === "edges" ? "e" : "f");
  if (kind === "groove") {
    data.faces = want === "faces" ? pk.idx : [];
    data.edges = want === "edges" ? pk.idx : [];
  } else (data as Record<string, unknown>)[want] = pk.idx;
  if (pk.rule.length) {
    if (pk.idx.length) throw new Error(tr("svar: zadejte buď čísla (E7;E9), nebo pravidlo – ne obojí"));
    return { k: "select", feature, rule: pk.rule, line: no, into: { path: `data.${want}`, kind: want } };
  }
  return { k: "feature", feature, line: no };
}

/** Shrnutí prvku svaru pro textový stav (featureSummary). */
export function weldSummary(f: Feature): string {
  if (f.type !== "ext" || !f.ext.startsWith("weld.")) return "";
  const d = f.data ?? {};
  const n = (k: string) => (typeof d[k] === "number" ? (d[k] as number) : undefined);
  const list = (k: string, p: string) => (Array.isArray(d[k]) && (d[k] as number[]).length ? `${p}${(d[k] as number[]).map((x) => x + 1).join(`;${p}`)}` : "");
  switch (f.ext) {
    case "weld.bead":
      return [tr("koutový {0}{1}", d.measure === "a" ? "a" : "z", n("a") ?? 4), d.both ? tr("oboustranně") : "", d.allAround ? tr("kolem") : "", d.intermittent ? tr("přerušovaný {0}/{1}", n("segLen") ?? 50, n("pitch") ?? 100) : "", list("edges", "E"), d.separate ? tr("těleso") : tr("sloučit")].filter(Boolean).join(" · ");
    case "weld.groove":
      return [tr("tupý {0}", String(d.prep ?? "V")), n("angle") !== undefined ? `${n("angle")}°` : "", n("rootFace") !== undefined ? tr("otupení {0}", n("rootFace")!) : "", n("gap") !== undefined ? tr("mezera {0}", n("gap")!) : "", d.backing ? tr("podložka") : "", list("faces", "F") || list("edges", "E")].filter(Boolean).join(" · ");
    case "weld.plug":
      return [n("slot") ? tr("žlábkový {0}×{1}", n("slot")!, n("d") ?? 12) : tr("děrový Ø{0}", n("d") ?? 12), tr("{0}× rozteč {1}", n("n") ?? 2, n("pitch") ?? 60), list("faces", "F")].filter(Boolean).join(" · ");
    case "weld.spot":
      return [tr("bodový Ø{0}", n("d") ?? 6), tr("{0}× rozteč {1}", n("n") ?? 5, n("pitch") ?? 40), list("faces", "F")].filter(Boolean).join(" · ");
    default:
      return "";
  }
}

/** Řádky nápovědy příkazů (AGENT_COMMANDS). */
export const WELD_COMMANDS: { cmd: string; en: string; de: string; desc: string }[] = [
  {
    cmd: "svar koutový a5 hrany <pravidlo|E7;E9> [z] [oboustranně] [kolem] [přerušovaný 50/100] [montážní] [metoda 135] [sloučit]",
    en: "weld fillet a5 edges … [both sides] [all around] [intermittent 50/100] [field] [process 135]",
    de: "schweißnaht kehlnaht a5 kanten … [beidseitig] [ringsum] [unterbrochen 50/100] [baustelle] [verfahren 135]",
    desc: tr("koutový svar a (účinná tloušťka, z = a·√2; „z7“ = rameno) do koutu dvou ploch nebo dvou dílů; oboustranně = i druhá strana stěny, kolem = celá smyčka (profil na desce, i oblouky); svarový kov = těleso „Svar k“"),
  },
  {
    cmd: "svar tupý V|Y|X|U|2U|½V|½Y|K|J|2J|I [úhel] [otupení c] [mezera b] [R6] hrana E7 | plocha F3 [podložka] [převýšení 1,5] [kořen 1] [obráceně] [t 10]",
    en: "weld butt V 60 root face 1 gap 2 edge E7 | face F3 [backing] [cap 1.5] [root 1] [flip]",
    de: "naht stumpf V 60 steg 1 spalt 2 kante E7 | fläche F3 [badsicherung] [überhöhung 1,5] [wurzel 1]",
    desc: tr("tupý svar s úpravou ISO 9692-1 pro tupý, T i rohový spoj: plocha = čelo připravovaného dílu u druhého dílu, hrana = hrana čela na straně svaru nebo vnitřní kout sloučeného tělesa; úprava se vyřízne do dílů, svarový kov (+ převýšení) = těleso „Svar k“"),
  },
  {
    cmd: "svar děrový Ø12 [počet 2] [rozteč 60] plocha F3 · svar žlábkový 30×10 … · svar bodový Ø6 rozteč 40 [počet 5] plocha F3 [kratší] [posun N]",
    en: "weld plug Ø12 [count 2] [pitch 60] face F3 · weld slot 30x10 … · weld spot Ø6 pitch 40 [count 5] face F3",
    de: "naht lochnaht Ø12 [anzahl 2] [teilung 60] fläche F3 · naht schlitznaht 30x10 … · naht punkt Ø6 teilung 40",
    desc: tr("děrový / žlábkový svar: otvory v horním plechu (tloušťka z modelu) vyplněné svarem; bodový: značky bodů Ø d (bez přídavného materiálu); řada po delší (kratší) straně plochy, vystředěná"),
  },
  { cmd: "svar tabulka", en: "weld table", de: "naht tabelle", desc: tr("tabulka svarů: délka, průřez, objem, hmotnost svarového kovu a přídavný materiál každého svaru se součty") },
];
