/**
 * Textové příkazy plechu 7. vlny (CS / EN / DE) – tvářecí nástroje a křížový zlom. Čisté funkce bez jádra (testovatelné
 * v Node); agent.ts je volá před ostatními příkazy, null = jiný příkaz.
 *
 *   plech [tvarování] žaluzie L W H v x y [v x y …] [natočení 90] [vpravo] [dolů] [plocha F3] [poloměr R]
 *   plech prolis D H [úhel 60] v x y … [ostrý]          · sheet dimple D H at x y   · blech napf D H bei x y
 *   plech žebro W H [úhel 60] skica "Dráha"            · sheet bead W H sketch "Path" · blech sicke W H skizze "Pfad"
 *   plech výstřih L W H [úhel 45] v x y …              · sheet lance …              · blech lasche …
 *   plech můstek L W H [úhel 45] v x y …               · sheet bridge …             · blech brücke …
 *   plech lem díry d H v x y …                         · sheet collar d H at …      · blech durchzug d H bei …
 *   plech vodítko L W mezera S v x y …                 · sheet card guide L W slot S · blech kartenführung L W spalt S
 *   plech křížový zlom [F3] [úhel 1,5] [dolů]          · sheet cross break [F3] [angle 1.5] [down] · blech kreuzbruch [F3] [winkel 1,5] [unten]
 *
 * Body „v x y“ jsou souřadnice v rovině plochy (u vodorovné plochy x, y); „v x y z“ = bod v prostoru (promítne se na plochu).
 * Plocha: F3 (číslo jako popisky pro výběr), nebo pravidlo (`plocha +Y`, `plocha největší`); bez plochy horní plocha základu.
 */
import { tr } from "./i18n";
import { getExt } from "./ext/registry";
import { CROSS_BREAK_EXT, FORM_EXT, formPoints, formSummary, formToolLabel, formToolOf, type FormTool } from "./ext/sheetmetal-form-geom";
import { emptyDoc, uid, type Feature } from "./types";

/** Operace kompatibilní s `AgentOp` (agent.ts). */
export type SheetOp =
  | { k: "feature"; feature: Feature; line: number }
  | { k: "select"; feature: Feature; rule: string[]; line: number; into: { path: string; kind: "faces" | "edges" } };

const fold = (s: string) => s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/ß/g, "ss");
const isNum = (t: string) => /^[+-]?(\d+[.,]?\d*|[.,]\d+)(mm|°)?$/i.test(t);
const num = (t: string) => parseFloat(t.replace(",", "."));
const set = (...w: string[]) => new Set(w.map(fold));

const HEAD = set("plech", "sheet", "sheetmetal", "sheet-metal", "blech");
const FORMING = set("tvarovani", "tvarování", "tvarovat", "tvarovaní", "forming", "form", "formtool", "umformen", "umformung", "formwerkzeug", "nastroj", "nástroj", "tool", "werkzeug");
/** slova nástroje (jedno nebo dvě slova) */
const TOOLS: [FormTool | "crossbreak", string[][]][] = [
  ["crossbreak", [["krizovy", "zlom"], ["krizovy"], ["cross", "break"], ["crossbreak"], ["kreuzbruch"], ["kreuzsicke"], ["kreuz", "bruch"]]],
  ["collar", [["lem", "diry"], ["lem", "otvoru"], ["limec"], ["lem"], ["collar"], ["extruded", "hole"], ["extrudedhole"], ["flanged", "hole"], ["durchzug"], ["kragen"], ["kragenloch"]]],
  ["cardguide", [["voditko", "desky"], ["voditko"], ["card", "guide"], ["cardguide"], ["kartenfuhrung"], ["kartenfuehrung"], ["platinenfuhrung"], ["platinenfuehrung"]]],
  ["louvre", [["zaluzie"], ["zaluzii"], ["louvre"], ["louver"], ["kieme"], ["kiemen"], ["jalousie"], ["luftungskieme"], ["lueftungskieme"]]],
  ["dimple", [["prolis"], ["dulek"], ["dimple"], ["napf"], ["pragung"], ["praegung"], ["beule"]]],
  ["bead", [["zebro"], ["bead"], ["rib"], ["emboss"], ["sicke"], ["rippe"]]],
  ["lance", [["vystrih"], ["jazycek"], ["lance"], ["tab"], ["lasche"], ["ausklinkung"]]],
  ["bridge", [["mustek"], ["most"], ["bridge"], ["bridgelance"], ["brucke"], ["bruecke"]]],
];

const AT = set("v", "na", "at", "bei", "an", "bod", "body", "point", "points", "punkt", "punkte");
const ROT = set("natoceni", "natočení", "otoceni", "otočení", "rotace", "rotation", "rotate", "rot", "drehung", "gedreht", "verdreht");
const ANGLE = set("uhel", "úhel", "angle", "winkel", "stena", "stěna", "wall", "nabeh", "náběh", "ramp");
const DOWN = set("dolu", "dolů", "down", "unten", "nachunten", "dovnitr", "dovnitř");
const UP = set("nahoru", "up", "oben", "nachoben", "ven");
const FACE = set("plocha", "plose", "ploše", "face", "flache", "fläche", "flaeche", "panel");
const RADIUS = set("polomer", "poloměr", "radius", "r", "halbmesser");
const LEFT = set("vlevo", "left", "links", "levá", "leva");
const RIGHT = set("vpravo", "right", "rechts", "pravá", "prava");
const OPEN = set("otevrena", "otevřená", "otevreny", "otevřený", "open", "offen", "strana", "side", "seite");
const SHARP = set("ostry", "ostrý", "ostre", "ostré", "sharp", "scharf", "scharfkantig");
const ROUND = set("zaobleny", "zaoblený", "zaoblene", "zaoblené", "rounded", "round", "gerundet");
const SKETCH = set("skica", "skice", "draha", "dráha", "sketch", "path", "skizze", "pfad", "bahn");
const SLOT = set("mezera", "slot", "gap", "spalt", "schlitz");
const NAME = set("nazev", "název", "name", "jako", "as", "als");
const LENGTH = set("delka", "délka", "length", "l", "lange", "länge", "laenge");
const WIDTH = set("sirka", "šířka", "width", "w", "breite", "b");
const HEIGHT = set("vyska", "výška", "height", "h", "hohe", "höhe", "hoehe", "hloubka", "depth", "tiefe");
const DIAM = set("prumer", "průměr", "diameter", "d", "durchmesser", "ø");
const KEYS = [AT, ROT, ANGLE, DOWN, UP, FACE, RADIUS, LEFT, RIGHT, OPEN, SHARP, ROUND, SKETCH, SLOT, NAME, LENGTH, WIDTH, HEIGHT, DIAM];
const isKey = (t: string) => KEYS.some((k) => k.has(fold(t)));

/** Rozdělí řádek na slova; text v uvozovkách "…" / „…“ je jedno slovo, „;“ samostatné. */
export function sheetTokens(line: string): { t: string; q: boolean }[] {
  const out: { t: string; q: boolean }[] = [];
  const re = /"([^"]*)"|„([^“]*)“|(;)|([^\s;"„]+)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(line))) out.push(m[1] != null || m[2] != null ? { t: m[1] ?? m[2], q: true } : { t: m[3] ?? m[4], q: false });
  return out;
}

/** Kladná čísla poziční: pořadí podle nástroje. */
const POSITIONAL: Record<FormTool | "crossbreak", string[]> = {
  louvre: ["length", "width", "height"],
  dimple: ["diameter", "height", "wallAngle"],
  bead: ["width", "height", "wallAngle"],
  lance: ["length", "width", "height", "wallAngle"],
  bridge: ["length", "width", "height", "wallAngle"],
  collar: ["diameter", "height"],
  cardguide: ["length", "width", "slot", "wallAngle"],
  crossbreak: ["angle"],
};

function toolAt(words: string[], i: number): { tool: FormTool | "crossbreak"; used: number } | null {
  for (const [tool, variants] of TOOLS)
    for (const v of variants) if (v.every((w, k) => fold(words[i + k] ?? "") === w)) return { tool, used: v.length };
  return null;
}

/**
 * Řádek plechu → operace, nebo null (jiný příkaz). Chyba zápisu = výjimka s nápovědou.
 */
export function parseSheetLine(line: string, no: number, name: (label: string) => string): SheetOp | null {
  const tk = sheetTokens(line.trim());
  if (!tk.length || !HEAD.has(fold(tk[0].t))) return null;
  let i = 1;
  if (tk[i] && FORMING.has(fold(tk[i].t))) i++;
  const words = tk.map((x) => (x.q ? "" : x.t));
  const hit = toolAt(words, i);
  if (!hit) {
    // jiné plechové příkazy (nyní jen tvarování) – nevíme-li, ohlásit použití
    throw new Error(tr("plech: neznámý nástroj „{0}“ – plech žaluzie | prolis | žebro | výstřih | můstek | lem díry | vodítko | křížový zlom (EN louvre | dimple | bead | lance | bridge | collar | card guide | cross break)", tk[i]?.t ?? ""));
  }
  i += hit.used;
  const tool = hit.tool;
  const ext = tool === "crossbreak" ? CROSS_BREAK_EXT : FORM_EXT[tool];
  const def = getExt(ext);
  if (!def) throw new Error(tr("plech: modul tvářecích nástrojů není načten"));
  const data: Record<string, unknown> = { ...def.make({ ...emptyDoc(""), features: [] }) };
  const pts: number[][] = [];
  const positional: number[] = [];
  let faceRule: string[] | null = null;
  let label: string | undefined;
  const numAt = (j: number, what: string) => {
    const t = tk[j];
    if (!t || t.q || !isNum(t.t)) throw new Error(tr("plech: za „{0}“ chybí číslo", what));
    return num(t.t);
  };
  while (i < tk.length) {
    const { t, q } = tk[i];
    const w = fold(t);
    if (q) throw new Error(tr("plech: text „{0}“ nečekán – název skici patří za slovo skica, název prvku za název", t));
    if (w === ";") {
      i++;
      continue;
    }
    if (isNum(t)) {
      positional.push(num(t));
      i++;
      continue;
    }
    // F3 = plocha číslem (bez slova plocha)
    const fm = /^f(\d+)$/i.exec(t);
    if (fm) {
      const n = Number(fm[1]);
      if (n < 1) throw new Error(tr("čísla ploch začínají 1 (F1)"));
      data.face = [n - 1];
      i++;
      continue;
    }
    if (AT.has(w)) {
      // jeden nebo více bodů: „v 50 30 v 80 30“, „v 50 30; 80 30“, „v 10 20 2“
      i++;
      let group: number[] = [];
      const flush = () => {
        if (group.length === 2 || group.length === 3) pts.push(group);
        else if (group.length) throw new Error(tr("plech: bod má dvě nebo tři souřadnice (v x y nebo v x y z) – „{0}“", group.join(" ")));
        group = [];
      };
      while (i < tk.length && (isNum(tk[i].t) || tk[i].t === ";") && !tk[i].q) {
        if (tk[i].t === ";") flush();
        else group.push(num(tk[i].t));
        i++;
      }
      // „v 10 20 30 40“ = dva body po dvou souřadnicích (čtyři čísla), šest čísel = dva body 3D
      if (group.length === 4) {
        pts.push(group.slice(0, 2), group.slice(2));
        group = [];
      } else if (group.length === 6) {
        pts.push(group.slice(0, 3), group.slice(3));
        group = [];
      }
      flush();
      continue;
    }
    if (ROT.has(w)) {
      data.rotation = numAt(i + 1, t);
      i += 2;
      continue;
    }
    if (ANGLE.has(w)) {
      data[tool === "crossbreak" ? "angle" : "wallAngle"] = numAt(i + 1, t);
      i += 2;
      continue;
    }
    if (RADIUS.has(w)) {
      data.radius = numAt(i + 1, t);
      i += 2;
      continue;
    }
    if (SLOT.has(w)) {
      data.slot = numAt(i + 1, t);
      i += 2;
      continue;
    }
    const named: [Set<string>, string][] = [[LENGTH, "length"], [WIDTH, "width"], [HEIGHT, "height"], [DIAM, "diameter"]];
    const nk = named.find(([s]) => s.has(w));
    if (nk && tk[i + 1] && isNum(tk[i + 1].t)) {
      data[nk[1]] = numAt(i + 1, t);
      i += 2;
      continue;
    }
    if (DOWN.has(w)) {
      data.direction = "down";
      i++;
      continue;
    }
    if (UP.has(w)) {
      data.direction = "up";
      i++;
      continue;
    }
    if (OPEN.has(w)) {
      i++;
      continue;
    }
    if (LEFT.has(w) || RIGHT.has(w)) {
      data.open = LEFT.has(w) ? "left" : "right";
      i++;
      continue;
    }
    if (SHARP.has(w)) {
      data.rounded = false;
      i++;
      continue;
    }
    if (ROUND.has(w)) {
      data.rounded = true;
      i++;
      continue;
    }
    if (SKETCH.has(w)) {
      const s = tk[i + 1];
      if (!s) throw new Error(tr("plech: za „{0}“ chybí název skici v uvozovkách nebo $last", t));
      data.sketchId = s.t;
      i += 2;
      continue;
    }
    if (NAME.has(w)) {
      const s = tk[i + 1];
      if (!s) throw new Error(tr("plech: za „{0}“ chybí název", t));
      label = s.t;
      i += 2;
      continue;
    }
    if (FACE.has(w)) {
      i++;
      const f = tk[i] ? /^f(\d+)$/i.exec(tk[i].t) : null;
      if (f) {
        data.face = [Number(f[1]) - 1];
        i++;
        continue;
      }
      // pravidlo plochy (horní, +Y, největší…) – slova až po další klíčové slovo
      const rule: string[] = [];
      while (i < tk.length && !tk[i].q && !isKey(tk[i].t) && !isNum(tk[i].t)) rule.push(fold(tk[i++].t));
      if (!rule.length) throw new Error(tr("plech: za „plocha“ zadejte F číslo (plocha F3) nebo pravidlo (plocha +Y, plocha největší)"));
      faceRule = rule;
      continue;
    }
    throw new Error(tr("plech: neznámé slovo „{0}“ – {1}", t, usage(tool)));
  }
  const keys = POSITIONAL[tool];
  if (positional.length > keys.length) throw new Error(tr("plech: příliš mnoho čísel – {0}", usage(tool)));
  positional.forEach((v, k) => (data[keys[k]] = v));
  if (tool !== "crossbreak" && tool !== "bead") {
    if (!pts.length) throw new Error(tr("plech: zadejte bod umístění „v x y“ – {0}", usage(tool)));
    data.points = pts;
    formPoints(pts);
  } else if (pts.length) throw new Error(tr("plech: {0} nemá body umístění – {1}", tool === "bead" ? formToolLabel("bead") : tr("křížový zlom"), usage(tool)));
  if (tool === "bead" && !data.sketchId) data.sketchId = "$last";
  const lbl = tool === "crossbreak" ? tr("Křížový zlom") : formToolLabel(tool);
  const feature = { id: uid(), name: label ?? name(lbl), type: "ext", ext, data } as unknown as Feature;
  return faceRule ? { k: "select", feature, rule: faceRule, line: no, into: { path: "data.face", kind: "faces" } } : { k: "feature", feature, line: no };
}

function usage(tool: FormTool | "crossbreak"): string {
  switch (tool) {
    case "louvre":
      return tr("plech žaluzie DÉLKA ŠÍŘKA VÝŠKA v x y [v x y …] [natočení 90] [vlevo|vpravo] [dolů] [plocha F3]");
    case "dimple":
      return tr("plech prolis PRŮMĚR HLOUBKA [úhel 60] v x y [ostrý] [dolů] [plocha F3]");
    case "bead":
      return tr("plech žebro ŠÍŘKA VÝŠKA [úhel 60] skica \"Dráha\" [dolů] [plocha F3]");
    case "lance":
      return tr("plech výstřih DÉLKA ŠÍŘKA VÝŠKA [úhel 45] v x y [natočení 0] [dolů]");
    case "bridge":
      return tr("plech můstek DÉLKA ŠÍŘKA VÝŠKA [úhel 45] v x y [natočení 0] [dolů]");
    case "collar":
      return tr("plech lem díry PRŮMĚR VÝŠKA v x y [dolů] [plocha F3]");
    case "cardguide":
      return tr("plech vodítko DÉLKA ŠÍŘKA mezera S v x y [natočení 90]");
    case "crossbreak":
      return tr("plech křížový zlom [F3] [úhel 1,5] [nahoru|dolů]");
  }
}

// ---------------- stav ----------------

const fmt = (n: number) => String(Math.round(n * 100) / 100).replace(".", ",");

/** Řádek stavu (`stav`) pro tvářecí nástroj / křížový zlom; jiný prvek = "". */
export function sheetSummary(f: Feature): string {
  if (f.type !== "ext") return "";
  const d = f.data ?? {};
  const face = Array.isArray(d.face) && typeof d.face[0] === "number" ? tr("plocha F{0}", (d.face[0] as number) + 1) : tr("horní plocha základu");
  const dir = d.direction === "down" ? tr("dolů") : tr("nahoru");
  if (f.ext === CROSS_BREAK_EXT) return tr("křížový zlom {0}° {1} · {2}", fmt(typeof d.angle === "number" ? d.angle : 1.5), dir, face);
  const tool = formToolOf(f.ext);
  if (!tool) return "";
  const t = 2;
  const parts = [formSummary(tool, d, t), dir, face];
  if (tool === "bead") parts.push(tr("dráha {0}", String(d.sketchId ?? "—")));
  else {
    let pts: number[][] = [];
    try {
      pts = formPoints(d.points);
    } catch {
      /* neplatné body – ukáže chyba stavby */
    }
    parts.push(tr("{0} b.: {1}", pts.length, pts.map((p) => `[${p.map(fmt).join("; ")}]`).join(" ")));
    if (typeof d.rotation === "number" && d.rotation) parts.push(tr("natočení {0}°", fmt(d.rotation)));
  }
  return parts.join(" · ");
}

/** Řádky nápovědy příkazů (AGENT_COMMANDS). */
export const SHEET_COMMANDS: { cmd: string; en: string; de: string; desc: string }[] = [
  {
    cmd: "plech [tvarování] žaluzie L W H | prolis D H [úhel A] | výstřih L W H | můstek L W H | lem díry d H | vodítko L W mezera S … v x y [v x y …] [natočení 90] [vlevo|vpravo] [ostrý] [dolů] [plocha F3] [poloměr R]",
    en: "sheet [forming] louvre | dimple | lance | bridge | collar | card guide … at x y [rotation 90] [down] [face F3]",
    de: "blech [umformen] kieme | napf | lasche | brücke | durchzug | kartenführung … bei x y [drehung 90] [unten] [fläche F3]",
    desc: tr("tvářecí nástroj plechu v jednom nebo více bodech plochy (bez plochy horní plocha základu): skořepina tloušťky plechu nahoru / dolů, prostřih skutečně otevřený; v rozvinu stopa ve vrstvě FORM"),
  },
  {
    cmd: "plech žebro W H [úhel A] skica \"Dráha\" [dolů] [plocha F3]",
    en: "sheet bead W H [angle A] sketch \"Path\" [down]",
    de: "blech sicke W H [winkel A] skizze \"Pfad\" [unten]",
    desc: tr("žebro (prolis) podél dráhy ve skice – úsečky, lomené čáry, oblouky, kružnice; zaoblené konce, pokosy v rozích"),
  },
  {
    cmd: "plech křížový zlom [F3] [úhel 1,5] [nahoru|dolů]",
    en: "sheet cross break [F3] [angle 1.5] [up|down]",
    de: "blech kreuzbruch [F3] [winkel 1,5] [oben|unten]",
    desc: tr("panel se po úhlopříčkách mírně vyklene (skutečný zlom); ve výkrese hrany + poznámka KŘÍŽOVÝ ZLOM, v rozvinu tenké čáry ve vrstvě FORM"),
  },
];
