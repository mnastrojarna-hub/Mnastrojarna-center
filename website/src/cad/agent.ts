/**
 * Textové rozhraní CADu – pro AI agenty, automatizaci i lidi, kteří raději píší než klikají.
 *
 * Vstup je buď JSON (celý dokument `.mncad`, pole prvků nebo jeden prvek), nebo řádkové příkazy
 * (česky i anglicky, např. `kvádr 100 60 20`, `díra 8,5 skrz v 20 30`, `zaoblit 2 hrany svislé`).
 * Výstupem je program operací (`AgentOp`), který aplikace provede nad dokumentem a vrátí textový protokol
 * (co se podařilo, co ne a proč) + textový stav dokumentu, aby agent měl zpětnou vazbu bez obrázku.
 *
 * Čisté funkce bez prohlížeče (testovatelné v Node). Operace, které potřebují topologii tělesa
 * (výběr hran/ploch pravidlem, poloha díry „na horní ploše“), nechávají doplnění na aplikaci.
 */
import { emptyDoc, uid, type Axis, type BuildResult, type CadDoc, type Feature, type PlaneName, type SketchEntity, type Vec3 } from "./types";

export const AGENT_API_VERSION = 1;

/** Všechny typy prvků dokumentu (hlídá test proti `types.ts`). */
export const FEATURE_TYPES = [
  "sketch", "extrude", "revolve", "box", "cylinder", "sphere", "cone", "tube", "hole", "fillet", "chamfer", "shell", "pattern", "mirror", "import", "sweep", "loft", "draft", "split", "transform", "datum", "text", "pushPull", "deleteFace", "offsetFace", "rib", "spring", "thicken", "thread", "ext", "combine", "splitBodies", "copyBody", "datumAxis", "datumPoint", "csys",
] as const;

export const FEATURE_LABEL: Record<string, string> = {
  sketch: "Skica", extrude: "Vysunutí", revolve: "Rotace", box: "Kvádr", cylinder: "Válec", sphere: "Koule", cone: "Kužel", tube: "Trubka", hole: "Díra", fillet: "Zaoblení", chamfer: "Sražení", shell: "Skořepina", pattern: "Pole", mirror: "Zrcadlení", import: "Import", sweep: "Tažení", loft: "Šablonování", draft: "Úkos", split: "Rozříznutí", transform: "Přesun", datum: "Rovina", text: "Text", pushPull: "Vytáhnout", deleteFace: "Odstranit plochu", offsetFace: "Odsadit plochu", rib: "Žebro", spring: "Pružina", thicken: "Zesílení", thread: "Závit", ext: "Prvek", combine: "Sloučení", splitBodies: "Rozdělení", copyBody: "Kopie tělesa", datumAxis: "Osa", datumPoint: "Bod", csys: "Souřadný systém",
};

/* ───────────────────────── operace ───────────────────────── */
export type Rule = string[];
export type AgentOp =
  | { k: "doc"; doc: CadDoc; line: number }
  | { k: "features"; features: Feature[]; line: number }
  | { k: "new"; name: string; assembly: boolean; line: number }
  | { k: "meta"; patch: { name?: string; material?: string; color?: string }; line: number }
  /** prvek; `fillTop` = souřadnice v ose prvku doplnit na horní plochu tělesa (díra „v x y“ bez z, text) */
  | { k: "feature"; feature: Feature; line: number; fillTop?: boolean }
  /** entity do poslední skici */
  | { k: "entities"; entities: SketchEntity[]; line: number }
  /** prvek, jehož hrany/plochy vybere aplikace podle pravidla (zaoblení, sražení, skořepina) */
  | { k: "select"; feature: Feature; rule: Rule; line: number }
  | { k: "pop"; line: number }
  | { k: "view"; view: string; line: number }
  | { k: "status"; line: number };
export type AgentError = { line: number; text: string; message: string };
export type AgentProgram = { ops: AgentOp[]; errors: AgentError[] };

/* ───────────────────────── pomocné ───────────────────────── */
const fold = (s: string) => s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
const isNum = (t: string) => /^[+-]?ø?(\d+[.,]?\d*|[.,]\d+)(mm|°)?$/i.test(t.replace(/^[øØ]/, ""));
export const num = (t: string): number => {
  const m = /^[+-]?(\d+[.,]?\d*|[.,]\d+)/.exec(t.replace(/^[øØ]/, ""));
  if (!m) return NaN;
  const sign = t.startsWith("-") ? -1 : 1;
  return sign * parseFloat(m[1].replace(",", "."));
};
function tokenize(line: string): string[] {
  const out: string[] = [];
  const re = /"([^"]*)"|„([^“]*)“|'([^']*)'|(\S+)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(line))) out.push(m[1] ?? m[2] ?? m[3] ?? m[4]);
  return out;
}
/** synonyma → kanonický název příkazu / volby */
const SYN: Record<string, string> = {};
const syn = (canon: string, ...alts: string[]) => {
  for (const a of [canon, ...alts]) SYN[fold(a)] = canon;
};
syn("new", "nový", "nova", "nová", "novy");
syn("part", "díl", "dil", "součást", "soucast");
syn("assembly", "sestava");
syn("name", "název", "nazev", "pojmenovat");
syn("material", "materiál", "material");
syn("color", "barva", "colour");
syn("box", "kvádr", "kvadr", "hranol", "deska");
syn("cylinder", "válec", "valec");
syn("sphere", "koule", "ball");
syn("cone", "kužel", "kuzel");
syn("tube", "trubka", "pipe");
syn("sketch", "skica", "náčrt", "nacrt");
syn("rect", "obdélník", "obdelnik", "rectangle", "čtverec", "ctverec", "square");
syn("circle", "kružnice", "kruznice", "kruh");
syn("polygon", "mnohoúhelník", "mnohouhelnik", "šestihran", "sestihran", "hex");
syn("slot", "drážka", "drazka");
syn("line", "úsečka", "usecka", "přímka", "primka");
syn("polyline", "čára", "cara", "lomená", "lomena", "obrys", "polyčára");
syn("point", "bod");
syn("ellipse", "elipsa");
syn("extrude", "vysunout", "vysunutí", "vysunuti", "vytáhnout", "vytahnout");
syn("revolve", "rotovat", "rotace", "orotovat");
syn("hole", "díra", "dira", "otvor", "vrtat");
syn("fillet", "zaoblit", "zaoblení", "zaobleni", "rádius", "radius", "round");
syn("chamfer", "srazit", "sražení", "srazeni", "zkosit", "zkosení");
syn("shell", "skořepina", "skorepina", "vydlabat");
syn("pattern", "pole", "opakovat", "array");
syn("mirror", "zrcadlit", "zrcadlení", "zrcadleni");
syn("text", "nápis", "napis");
syn("undo", "smazat", "zpět", "zpet", "odstranit");
syn("status", "stav", "info", "report");
syn("view", "zobraz", "pohled", "zobrazit");
// volby
syn("center", "střed", "stred", "centered", "vystředit");
syn("at", "v", "na", "poloha", "position", "pos");
syn("through", "skrz", "průchozí", "pruchozi", "throughall");
syn("depth", "hloubka", "hloubku", "deep");
syn("symmetric", "symetricky", "symetrický", "symetricke", "oboustranně", "midplane");
syn("reverse", "obráceně", "obracene", "opačně", "opacne", "flip", "otočit");
syn("cut", "odebrat", "odečíst", "odecist", "vyříznout", "subtract", "minus");
syn("add", "přidat", "pridat", "sloučit", "union", "plus");
syn("intersect", "průnik", "prunik");
syn("newbody", "nové", "nove", "samostatně", "newbody");
syn("axis", "osa", "kolem");
syn("angle", "úhel", "uhel", "deg");
syn("draft", "úkos", "ukos");
syn("offset", "odsazení", "odsazeni", "posun");
syn("spacing", "rozteč", "roztec", "krok", "step", "pitch");
syn("count", "počet", "pocet", "ks");
syn("direction", "směr", "smer", "podél", "podel");
syn("thread", "závit", "zavit");
syn("counterbore", "zahloubení", "zahloubeni", "cbore");
syn("countersink", "kuželové", "kuzelove", "csink", "zapuštění", "zapusteni");
syn("edges", "hrany", "hrana", "edge");
syn("open", "otevřít", "otevrit", "bez", "remove");
syn("height", "výška", "vyska", "h");
syn("engrave", "gravírovat", "gravirovat", "vyrýt", "vyryt");
syn("construction", "pomocná", "pomocna", "pomocný", "konstrukční");
syn("closed", "uzavřít", "uzavrit", "uzavřený", "uzavreny", "close");
syn("keep", "ponechat", "zachovat");
syn("radius", "poloměr", "polomer", "r");
syn("diameter", "průměr", "prumer", "d");
syn("sides", "stran", "strany", "n");
syn("corner", "roh", "rohy");
syn("rect-r", "zaoblení-rohů", "rr");
syn("length", "délka", "delka", "dlouhé", "l");
syn("width", "šířka", "sirka", "široké", "w");
syn("longer", "delší", "delsi");
syn("shorter", "kratší", "kratsi");
syn("linear", "lineární", "linearni", "řada", "rada", "mřížka", "mrizka");
syn("circular", "kruhové", "kruhove", "kruhový", "kruhovy", "dokola", "polar");
const canon = (t: string) => SYN[fold(t)] ?? fold(t);

const PLANES: Record<string, PlaneName> = { xy: "XY", xz: "XZ", yz: "YZ", "pudorys": "XY", "narys": "XZ", "bokorys": "YZ", top: "XY", front: "XZ", right: "YZ" };
const AXES: Record<string, Axis> = { x: "X", y: "Y", z: "Z" };
const DIRS: Record<string, Vec3> = { "+x": [1, 0, 0], "-x": [-1, 0, 0], "+y": [0, 1, 0], "-y": [0, -1, 0], "+z": [0, 0, 1], "-z": [0, 0, -1], x: [1, 0, 0], y: [0, 1, 0], z: [0, 0, 1] };
const VIEWS: Record<string, string> = { iso: "iso", izo: "iso", izometrie: "iso", front: "front", predni: "front", zadni: "back", back: "back", top: "top", horni: "top", shora: "top", bottom: "bottom", spodni: "bottom", left: "left", levy: "left", zleva: "left", right: "right", pravy: "right", zprava: "right" };

/** volby za příkazem: `{klíč: čísla | slova}` + příznaky */
type Opts = { flags: Set<string>; nums: Record<string, number[]>; words: Record<string, string[]>; free: number[]; strings: string[] };
const FLAGS = new Set(["center", "through", "symmetric", "reverse", "cut", "add", "intersect", "newbody", "engrave", "construction", "closed", "keep", "linear", "circular"]);
const NUM_OPTS = new Set(["at", "depth", "angle", "draft", "offset", "spacing", "count", "counterbore", "countersink", "height", "radius", "diameter", "sides", "rect-r", "length", "width", "longer", "shorter", "corner"]);
const WORD_OPTS = new Set(["axis", "direction", "thread", "edges", "open", "name", "material", "color"]);
function parseOpts(tokens: string[]): Opts {
  const o: Opts = { flags: new Set(), nums: {}, words: {}, free: [], strings: [] };
  let i = 0;
  while (i < tokens.length) {
    const t = tokens[i];
    const c = canon(t);
    if (FLAGS.has(c)) {
      o.flags.add(c);
      i++;
      continue;
    }
    if (NUM_OPTS.has(c)) {
      const vals: number[] = [];
      i++;
      while (i < tokens.length && isNum(tokens[i])) vals.push(num(tokens[i++]));
      o.nums[c] = [...(o.nums[c] ?? []), ...vals];
      continue;
    }
    if (WORD_OPTS.has(c)) {
      const vals: string[] = [];
      const ruleWords = c === "edges" || c === "open"; // pravidla smí obsahovat i slova, která jsou jinde příznaky (kruhové…)
      const single = c === "axis" || c === "direction" || c === "thread"; // jedno slovo (směr i jako 3 čísla)
      i++;
      if (single) {
        if (i < tokens.length && isNum(tokens[i])) while (i < tokens.length && isNum(tokens[i]) && vals.length < 3) vals.push(tokens[i++]);
        else if (i < tokens.length && !NUM_OPTS.has(canon(tokens[i])) && !WORD_OPTS.has(canon(tokens[i])) && !FLAGS.has(canon(tokens[i]))) vals.push(tokens[i++]);
      } else while (i < tokens.length && (ruleWords || !FLAGS.has(canon(tokens[i]))) && !NUM_OPTS.has(canon(tokens[i])) && !WORD_OPTS.has(canon(tokens[i]))) vals.push(tokens[i++]);
      o.words[c] = [...(o.words[c] ?? []), ...vals];
      continue;
    }
    if (isNum(t)) o.free.push(num(t));
    else o.strings.push(t);
    i++;
  }
  return o;
}
const axisOf = (o: Opts, dflt: Axis = "Z"): Axis => AXES[fold(o.words.axis?.[0] ?? "")] ?? dflt;
const modeOf = (o: Opts): "new" | "add" | "cut" | "intersect" => (o.flags.has("cut") ? "cut" : o.flags.has("intersect") ? "intersect" : o.flags.has("newbody") ? "new" : "add");
const posOf = (o: Opts): Vec3 | null => {
  const p = o.nums.at;
  if (!p?.length) return null;
  return [p[0] ?? 0, p[1] ?? 0, p[2] ?? 0];
};
const dirOf = (words: string[] | undefined, nums?: number[]): Vec3 | null => {
  const w = fold(words?.[0] ?? "");
  if (DIRS[w]) return DIRS[w];
  if (words && words.length >= 3 && words.slice(0, 3).every(isNum)) return [num(words[0]), num(words[1]), num(words[2])];
  if (nums && nums.length >= 3) return [nums[0], nums[1], nums[2]];
  return null;
};

/* ───────────────────────── parser ───────────────────────── */
export function parseAgentText(text: string): AgentProgram {
  const trimmed = text.trim();
  if (!trimmed) return { ops: [], errors: [{ line: 0, text: "", message: "Prázdný vstup." }] };
  if (/^[[{]/.test(trimmed)) return parseJson(trimmed);
  const ops: AgentOp[] = [];
  const errors: AgentError[] = [];
  const counts: Record<string, number> = {}; // čítače názvů podle typu prvku
  const lines = trimmed.split(/\r?\n/);
  const named = (type: Feature["type"], name?: string) => name ?? `${FEATURE_LABEL[type] ?? type} ${(counts[type] = (counts[type] ?? 0) + 1)}`;
  lines.forEach((raw, idx) => {
    const line = raw.replace(/\s+(#|\/\/).*$/, "").trim();
    if (!line || line.startsWith("#") || line.startsWith("//")) return;
    const no = idx + 1;
    try {
      // skica: `skica XY [odsazení 5]: kružnice 165; obdélník 60 40`
      const colon = line.indexOf(":");
      const headTokens = tokenize(colon >= 0 ? line.slice(0, colon) : line);
      const cmd = canon(headTokens[0] ?? "");
      if (cmd === "sketch") {
        const o = parseOpts(headTokens.slice(1));
        const planeWord = o.strings.map(fold).find((w) => PLANES[w]);
        const plane: PlaneName = planeWord ? PLANES[planeWord] : "XY";
        const f: Feature = { id: uid(), name: named("sketch", o.words.name?.join(" ")), type: "sketch", plane: { kind: "base", name: plane, offset: o.nums.offset?.[0] ?? 0 }, entities: [] };
        ops.push({ k: "feature", feature: f, line: no });
        if (colon >= 0) {
          const ents = line
            .slice(colon + 1)
            .split(";")
            .map((s) => s.trim())
            .filter(Boolean)
            .map((s) => parseEntity(tokenize(s)));
          ops.push({ k: "entities", entities: ents, line: no });
        }
        return;
      }
      if (ENTITY.has(cmd) || (cmd === "construction" && ENTITY.has(canon(headTokens[1] ?? "")))) {
        const ents = line
          .split(";")
          .map((s) => s.trim())
          .filter(Boolean)
          .map((s) => parseEntity(tokenize(s)));
        ops.push({ k: "entities", entities: ents, line: no });
        return;
      }
      const tokens = tokenize(line).slice(1);
      const o = parseOpts(tokens);
      const nm = o.words.name?.join(" ");
      switch (cmd) {
        case "new": {
          const what = canon(tokens[0] ?? "part");
          const name = tokens.slice(1).join(" ").trim();
          ops.push({ k: "new", name: name || (what === "assembly" ? "Nová sestava" : "Nový díl"), assembly: what === "assembly", line: no });
          return;
        }
        case "name":
          ops.push({ k: "meta", patch: { name: tokens.join(" ") }, line: no });
          return;
        case "material":
          ops.push({ k: "meta", patch: { material: tokens.join(" ") }, line: no });
          return;
        case "color":
          ops.push({ k: "meta", patch: { color: tokens[0] }, line: no });
          return;
        case "box": {
          const [x, y, z] = o.free;
          if (!(x > 0 && y > 0 && z > 0)) throw new Error("kvádr potřebuje tři kladné rozměry: kvádr X Y Z");
          ops.push({ k: "feature", feature: { id: uid(), name: named("box", nm), type: "box", size: [x, y, z], position: posOf(o) ?? [0, 0, 0], centered: o.flags.has("center"), mode: modeOf(o) }, line: no });
          return;
        }
        case "cylinder": {
          const [d, h] = o.free;
          if (!(d > 0 && h > 0)) throw new Error("válec potřebuje průměr a výšku: válec D H");
          ops.push({ k: "feature", feature: { id: uid(), name: named("cylinder", nm), type: "cylinder", radius: d / 2, height: h, position: posOf(o) ?? [0, 0, 0], axis: axisOf(o), mode: modeOf(o) }, line: no });
          return;
        }
        case "sphere": {
          const [d] = o.free;
          if (!(d > 0)) throw new Error("koule potřebuje průměr: koule D");
          ops.push({ k: "feature", feature: { id: uid(), name: named("sphere", nm), type: "sphere", radius: d / 2, position: posOf(o) ?? [0, 0, 0], mode: modeOf(o) }, line: no });
          return;
        }
        case "cone": {
          const [d1, d2, h] = o.free;
          if (!(d1 > 0 && d2 >= 0 && h > 0)) throw new Error("kužel potřebuje dolní průměr, horní průměr a výšku: kužel D1 D2 H");
          ops.push({ k: "feature", feature: { id: uid(), name: named("cone", nm), type: "cone", radius1: d1 / 2, radius2: d2 / 2, height: h, position: posOf(o) ?? [0, 0, 0], axis: axisOf(o), mode: modeOf(o) }, line: no });
          return;
        }
        case "tube": {
          const [D, d, h] = o.free;
          if (!(D > 0 && d >= 0 && D > d && h > 0)) throw new Error("trubka potřebuje vnější průměr, vnitřní průměr a výšku: trubka D d H");
          ops.push({ k: "feature", feature: { id: uid(), name: named("tube", nm), type: "tube", outer: D, inner: d, height: h, position: posOf(o) ?? [0, 0, 0], axis: axisOf(o), mode: modeOf(o) }, line: no });
          return;
        }
        case "extrude": {
          const d = o.free[0] ?? o.nums.height?.[0] ?? o.nums.depth?.[0];
          const through = o.flags.has("through");
          if (!through && !(d > 0)) throw new Error("vysunout potřebuje výšku: vysunout 20 [symetricky] [odebrat] [skrz]");
          const f: Feature = { id: uid(), name: named("extrude", nm), type: "extrude", sketchId: "$last", distance: through ? 1 : d, symmetric: o.flags.has("symmetric"), reverse: o.flags.has("reverse"), mode: o.flags.has("cut") || o.flags.has("intersect") || o.flags.has("newbody") || o.flags.has("add") ? modeOf(o) : "$auto" as unknown as "add" };
          if (through) f.extent = { kind: "throughAll" };
          if (o.nums.draft?.[0]) f.draftAngle = o.nums.draft[0];
          ops.push({ k: "feature", feature: f, line: no });
          return;
        }
        case "revolve": {
          const ang = o.free[0] ?? o.nums.angle?.[0] ?? 360;
          const ax = fold(o.words.axis?.[0] ?? "");
          const f: Feature = { id: uid(), name: named("revolve", nm), type: "revolve", sketchId: "$last", angle: ang, axis: ax === "x" || ax === "sketchx" ? "x" : "y", mode: o.flags.has("cut") || o.flags.has("intersect") || o.flags.has("newbody") || o.flags.has("add") ? modeOf(o) : "$auto" as unknown as "add" };
          if (ax === "x" || ax === "y" || ax === "z") f.axisDef = { kind: "global", axis: AXES[ax] };
          ops.push({ k: "feature", feature: f, line: no });
          return;
        }
        case "hole": {
          const d = o.free[0] ?? o.nums.diameter?.[0];
          if (!(d > 0)) throw new Error("díra potřebuje průměr: díra 8,5 [hloubka 20 | skrz] v X Y [Z]");
          const at = o.nums.at ?? [];
          const axis = axisOf(o);
          const fillTop = at.length < 3;
          const position: Vec3 = [at[0] ?? 0, at[1] ?? 0, at[2] ?? 0];
          const f: Feature = { id: uid(), name: named("hole", nm), type: "hole", position, axis, flip: o.flags.has("reverse"), diameter: d, depth: o.flags.has("through") ? 0 : (o.nums.depth?.[0] ?? 0), cbDiameter: o.nums.counterbore?.[0] ?? 0, cbDepth: o.nums.counterbore?.[1] ?? 0 };
          if (o.nums.counterbore?.length) f.kind = "counterbore";
          if (o.nums.countersink?.length) {
            f.kind = "countersink";
            f.csDiameter = o.nums.countersink[0];
            f.csAngle = o.nums.countersink[1] ?? 90;
          }
          if (o.words.thread?.[0]) {
            f.kind = "tapped";
            f.thread = o.words.thread[0].toUpperCase();
          }
          ops.push({ k: "feature", feature: f, line: no, fillTop });
          return;
        }
        case "fillet":
        case "chamfer": {
          const v = o.free[0] ?? o.nums.radius?.[0];
          if (!(v > 0)) throw new Error(cmd === "fillet" ? "zaoblit potřebuje poloměr: zaoblit 2 [hrany svislé]" : "srazit potřebuje velikost: srazit 1 [hrany horní]");
          const rule = (o.words.edges ?? []).map(fold).concat(numRule(o));
          const feature: Feature = cmd === "fillet" ? { id: uid(), name: named("fillet", nm), type: "fillet", radius: v, edges: "all" } : { id: uid(), name: named("chamfer", nm), type: "chamfer", distance: v, edges: "all" };
          if (!rule.length || rule.includes("vse") || rule.includes("all")) ops.push({ k: "feature", feature, line: no });
          else ops.push({ k: "select", feature, rule, line: no });
          return;
        }
        case "shell": {
          const t = o.free[0];
          if (!(t > 0)) throw new Error("skořepina potřebuje tloušťku: skořepina 2 [otevřít +Z]");
          const rule = (o.words.open ?? []).map(fold);
          const feature: Feature = { id: uid(), name: named("shell", nm), type: "shell", thickness: t, faces: [] };
          if (rule.length) ops.push({ k: "select", feature, rule, line: no });
          else ops.push({ k: "feature", feature, line: no });
          return;
        }
        case "pattern": {
          const isCirc = o.flags.has("circular");
          if (isCirc) {
            const count = o.free[0] ?? o.nums.count?.[0];
            if (!(count >= 2)) throw new Error("pole kruhové potřebuje počet: pole kruhové 6 [úhel 360] [osa Z]");
            const c = o.nums.at ?? [0, 0, 0];
            ops.push({ k: "feature", feature: { id: uid(), name: named("pattern", nm), type: "pattern", featureId: "$last", kind: "circular", count, angle: o.nums.angle?.[0] ?? 360, axis: axisOf(o), center: [c[0] ?? 0, c[1] ?? 0, c[2] ?? 0] }, line: no });
            return;
          }
          const counts = o.nums.count ?? [];
          const count = o.free[0] ?? counts[0];
          const sp = o.nums.spacing ?? [];
          if (!(count >= 2) || !(sp[0] > 0)) throw new Error("pole potřebuje počet a rozteč: pole 4 rozteč 25 [směr X] [počet 3 rozteč 20 směr Y]");
          const dirs = o.words.direction ?? [];
          const dirList: Vec3[] = [];
          for (let j = 0; j < dirs.length; ) {
            if (isNum(dirs[j]) && j + 2 < dirs.length) {
              dirList.push([num(dirs[j]), num(dirs[j + 1]), num(dirs[j + 2])]);
              j += 3;
            } else {
              const v = dirOf([dirs[j]]);
              if (v) dirList.push(v);
              j++;
            }
          }
          const f: Feature = { id: uid(), name: named("pattern", nm), type: "pattern", featureId: "$last", kind: "linear", count, spacing: sp[0], direction: dirList[0] ?? [1, 0, 0] };
          const count2 = o.free[1] ?? counts[1];
          if (count2 >= 2 && sp[1] > 0) {
            f.count2 = count2;
            f.spacing2 = sp[1];
            f.direction2 = dirList[1] ?? [0, 1, 0];
          }
          ops.push({ k: "feature", feature: f, line: no });
          return;
        }
        case "mirror": {
          const planeWord = o.strings.map(fold).find((w) => PLANES[w]);
          ops.push({ k: "feature", feature: { id: uid(), name: named("mirror", nm), type: "mirror", plane: planeWord ? PLANES[planeWord] : "YZ", offset: o.nums.offset?.[0] ?? 0, keepOriginal: true }, line: no });
          return;
        }
        case "text": {
          const str = o.strings[0];
          if (!str) throw new Error('text potřebuje nápis v uvozovkách: text "ABC" výška 10 hloubka 1 v X Y [Z]');
          const at = o.nums.at ?? [];
          const planeWord = o.strings.slice(1).map(fold).find((w) => PLANES[w]);
          ops.push({ k: "feature", feature: { id: uid(), name: named("text", nm), type: "text", text: str, height: o.nums.height?.[0] ?? o.free[0] ?? 10, depth: o.nums.depth?.[0] ?? o.free[1] ?? 1, plane: { kind: "base", name: planeWord ? PLANES[planeWord] : "XY", offset: at[2] ?? 0 }, position: [at[0] ?? 0, at[1] ?? 0], angle: o.nums.angle?.[0] ?? 0, mode: o.flags.has("engrave") || o.flags.has("cut") ? "cut" : "add" }, line: no, fillTop: at.length < 3 });
          return;
        }
        case "undo":
          ops.push({ k: "pop", line: no });
          return;
        case "status":
          ops.push({ k: "status", line: no });
          return;
        case "view": {
          const v = VIEWS[fold(tokens[0] ?? "iso")];
          if (!v) throw new Error("pohled: iso, přední, zadní, horní, spodní, levý, pravý");
          ops.push({ k: "view", view: v, line: no });
          return;
        }
        default:
          throw new Error(`neznámý příkaz „${headTokens[0]}“ – příkazy: nový díl, kvádr, válec, koule, kužel, trubka, skica, obdélník, kružnice, mnohoúhelník, drážka, úsečka, čára, vysunout, rotovat, díra, zaoblit, srazit, skořepina, pole, zrcadlit, text, smazat poslední, stav, zobraz; nebo vložte JSON`);
      }
    } catch (e) {
      errors.push({ line: no, text: line, message: (e as Error).message });
    }
  });
  return { ops, errors };
}

const numRule = (o: Opts): string[] => {
  const r: string[] = [];
  if (o.nums.radius?.length) r.push(`r=${o.nums.radius[0]}`);
  if (o.nums.longer?.length) r.push(`len>${o.nums.longer[0]}`);
  if (o.nums.shorter?.length) r.push(`len<${o.nums.shorter[0]}`);
  return r;
};

const ENTITY = new Set(["rect", "circle", "polygon", "slot", "line", "polyline", "point", "ellipse"]);
/** entita skici z tokenů: `kružnice 165 [v 10 20]`, `obdélník 60 40 [střed] [v x y] [r 3]`, `čára x1 y1 x2 y2 … [uzavřít]` */
export function parseEntity(tokens: string[]): SketchEntity {
  let construction = false;
  if (canon(tokens[0]) === "construction") {
    construction = true;
    tokens = tokens.slice(1);
  }
  const t = canon(tokens[0] ?? "");
  const o = parseOpts(tokens.slice(1));
  const at = o.nums.at ?? [];
  const cx = at[0] ?? 0;
  const cy = at[1] ?? 0;
  const base = { id: uid(), ...(construction ? { construction: true } : {}) };
  switch (t) {
    case "rect": {
      const [w, h = w] = o.free;
      if (!(w > 0 && h > 0)) throw new Error("obdélník potřebuje šířku a výšku: obdélník 60 40 [v x y] (střed) nebo roh x y");
      const corner = o.nums.corner;
      return { ...base, type: "rect", cx: corner ? corner[0] + w / 2 : cx, cy: corner ? corner[1] + h / 2 : cy, w, h, r: o.nums["rect-r"]?.[0] ?? 0, angle: o.nums.angle?.[0] ?? 0 };
    }
    case "circle": {
      const d = o.free[0] ?? o.nums.diameter?.[0];
      const r = o.nums.radius?.[0] ?? (d > 0 ? d / 2 : NaN);
      if (!(r > 0)) throw new Error("kružnice potřebuje průměr: kružnice 165 [v x y] (nebo poloměr 82,5)");
      return { ...base, type: "circle", cx, cy, r };
    }
    case "polygon": {
      const sides = o.nums.sides?.[0] ?? o.free[0];
      const d = o.free[1] ?? o.nums.diameter?.[0];
      const r = o.nums.radius?.[0] ?? (d > 0 ? d / 2 : NaN);
      if (!(sides >= 3 && r > 0)) throw new Error("mnohoúhelník potřebuje počet stran a průměr opsané kružnice: mnohoúhelník 6 30 [v x y]");
      return { ...base, type: "polygon", cx, cy, r, sides, angle: o.nums.angle?.[0] ?? 0 };
    }
    case "slot": {
      const [length, width] = o.free;
      if (!(length > 0 && width > 0)) throw new Error("drážka potřebuje délku a šířku: drážka 40 10 [v x y] [úhel 0]");
      return { ...base, type: "slot", cx, cy, length, width, angle: o.nums.angle?.[0] ?? 0 };
    }
    case "line": {
      const [x1, y1, x2, y2] = o.free;
      if (o.free.length < 4) throw new Error("úsečka potřebuje dva body: úsečka x1 y1 x2 y2");
      return { ...base, type: "line", a: [x1, y1], b: [x2, y2] };
    }
    case "polyline": {
      if (o.free.length < 4 || o.free.length % 2) throw new Error("čára potřebuje body po dvojicích: čára x1 y1 x2 y2 x3 y3 … [uzavřít]");
      const points: [number, number][] = [];
      for (let i = 0; i < o.free.length; i += 2) points.push([o.free[i], o.free[i + 1]]);
      return { ...base, type: "polyline", points, closed: o.flags.has("closed") || points.length >= 3 };
    }
    case "point":
      return { ...base, type: "point", p: [o.free[0] ?? cx, o.free[1] ?? cy] };
    case "ellipse": {
      const [rx, ry] = o.free;
      if (!(rx > 0 && ry > 0)) throw new Error("elipsa potřebuje dvě poloosy: elipsa 30 20 [v x y]");
      return { ...base, type: "ellipse", cx, cy, rx, ry, angle: o.nums.angle?.[0] ?? 0 };
    }
    default:
      throw new Error(`neznámá entita skici „${tokens[0]}“ – obdélník, kružnice, mnohoúhelník, drážka, úsečka, čára, bod, elipsa`);
  }
}

/* ───────────────────────── JSON ───────────────────────── */
function parseJson(text: string): AgentProgram {
  let v: unknown;
  try {
    v = JSON.parse(text);
  } catch (e) {
    return { ops: [], errors: [{ line: 1, text: text.slice(0, 60), message: `JSON nelze přečíst: ${(e as Error).message}` }] };
  }
  if (v && typeof v === "object" && !Array.isArray(v) && (v as { app?: string }).app === "mnastrojarna-cad") {
    const d = v as CadDoc;
    const { features, errors } = normalizeFeatures(Array.isArray(d.features) ? d.features : []);
    const doc: CadDoc = { ...emptyDoc(d.name || "Díl z JSON"), ...d, app: "mnastrojarna-cad", version: 2, features };
    return { ops: [{ k: "doc", doc, line: 1 }], errors: errors.map((m) => ({ line: 1, text: "", message: m })) };
  }
  const arr = Array.isArray(v) ? v : [v];
  const { features, errors } = normalizeFeatures(arr);
  return { ops: features.length ? [{ k: "features", features, line: 1 }] : [], errors: errors.map((m) => ({ line: 1, text: "", message: m })) };
}

/** Doplní id/název, ověří typ a základní povinná pole; vrací chyby pro neznámé/nevalidní prvky. */
export function normalizeFeatures(input: unknown[]): { features: Feature[]; errors: string[] } {
  const features: Feature[] = [];
  const errors: string[] = [];
  const ids = new Set<string>();
  const counts: Record<string, number> = {};
  input.forEach((raw, i) => {
    if (!raw || typeof raw !== "object") return void errors.push(`Prvek ${i + 1}: není objekt.`);
    const f = { ...(raw as Record<string, unknown>) };
    const type = String(f.type ?? "");
    if (!(FEATURE_TYPES as readonly string[]).includes(type)) return void errors.push(`Prvek ${i + 1}: neznámý typ „${type}“. Povolené: ${FEATURE_TYPES.join(", ")}.`);
    if (typeof f.id !== "string" || !f.id || ids.has(f.id)) f.id = uid();
    ids.add(f.id as string);
    counts[type] = (counts[type] ?? 0) + 1;
    if (typeof f.name !== "string" || !f.name) f.name = `${FEATURE_LABEL[type]} ${counts[type]}`;
    const dflt: Record<string, Record<string, unknown>> = {
      box: { position: [0, 0, 0], centered: false, mode: "add" },
      cylinder: { position: [0, 0, 0], axis: "Z", mode: "add" },
      sphere: { position: [0, 0, 0], mode: "add" },
      cone: { position: [0, 0, 0], axis: "Z", mode: "add" },
      tube: { position: [0, 0, 0], axis: "Z", mode: "add" },
      hole: { axis: "Z", flip: false, depth: 0, cbDiameter: 0, cbDepth: 0 },
      extrude: { symmetric: false, reverse: false, mode: "add" },
      revolve: { angle: 360, axis: "y", mode: "add" },
      fillet: { edges: "all" },
      chamfer: { edges: "all" },
      shell: { faces: [] },
      mirror: { offset: 0, keepOriginal: true, plane: "YZ" },
      sketch: { plane: { kind: "base", name: "XY", offset: 0 }, entities: [] },
      text: { angle: 0, mode: "add", position: [0, 0], depth: 1, height: 10, plane: { kind: "base", name: "XY", offset: 0 } },
      pattern: { kind: "linear" },
    };
    for (const [k, v] of Object.entries(dflt[type] ?? {})) if (f[k] === undefined) f[k] = v;
    if (type === "sketch" && Array.isArray(f.entities)) f.entities = (f.entities as Record<string, unknown>[]).map((e, j) => ({ ...e, id: typeof e.id === "string" && e.id ? e.id : `e${i + 1}_${j + 1}` }));
    features.push(f as unknown as Feature);
  });
  return { features, errors };
}

/* ───────────────────────── výběr hran / ploch pravidlem ───────────────────────── */
export type EdgeLite = { index: number; curve?: string; dir?: Vec3; center?: Vec3; radius?: number; length?: number };
export type FaceLite = { index: number; planar: boolean; normal?: Vec3; center?: Vec3; area?: number; surface?: string };
export type Bbox = [Vec3, Vec3];
const near = (a: number, b: number, tol: number) => Math.abs(a - b) <= tol;
const tolOf = (b: Bbox) => Math.max(0.01, 1e-3 * Math.hypot(b[1][0] - b[0][0], b[1][1] - b[0][1], b[1][2] - b[0][2]));
const unitDot = (a: Vec3 | undefined, b: Vec3) => (a ? Math.abs(a[0] * b[0] + a[1] * b[1] + a[2] * b[2]) / (Math.hypot(...a) || 1) : 0);
const sideWord = (w: string): { ax: 0 | 1 | 2; max: boolean } | null => {
  const m: Record<string, { ax: 0 | 1 | 2; max: boolean }> = { "+x": { ax: 0, max: true }, "-x": { ax: 0, max: false }, "+y": { ax: 1, max: true }, "-y": { ax: 1, max: false }, "+z": { ax: 2, max: true }, "-z": { ax: 2, max: false }, horni: { ax: 2, max: true }, top: { ax: 2, max: true }, spodni: { ax: 2, max: false }, bottom: { ax: 2, max: false }, dole: { ax: 2, max: false }, nahore: { ax: 2, max: true } };
  return m[w] ?? null;
};
export function selectEdges(rule: Rule, edges: EdgeLite[], bbox: Bbox): number[] {
  const tol = tolOf(bbox);
  let list = edges;
  for (const w0 of rule) {
    const w = fold(w0);
    const side = sideWord(w);
    if (side) list = list.filter((e) => e.center && near(e.center[side.ax], bbox[side.max ? 1 : 0][side.ax], tol));
    else if (["svisle", "vertical", "svisla"].includes(w)) list = list.filter((e) => !!e.dir && unitDot(e.dir, [0, 0, 1]) > 0.999);
    else if (["vodorovne", "horizontal", "vodorovna"].includes(w)) list = list.filter((e) => e.dir && unitDot(e.dir, [0, 0, 1]) < 0.001);
    else if (["kruhove", "circular", "kruznice", "oblouky", "oble", "round"].includes(w)) list = list.filter((e) => /circ|kru[zž]|arc|obl/i.test(e.curve ?? "") || (e.radius ?? 0) > 0);
    else if (["rovne", "straight", "prime", "linear"].includes(w)) list = list.filter((e) => /line|[uú]se[cč]|p[rř][ií]m/i.test(e.curve ?? "") || (!!e.dir && !e.radius));
    else if (w.startsWith("r=")) list = list.filter((e) => e.radius !== undefined && near(e.radius, num(w.slice(2)), Math.max(tol, 0.05)));
    else if (w.startsWith("len>")) list = list.filter((e) => (e.length ?? 0) > num(w.slice(4)));
    else if (w.startsWith("len<")) list = list.filter((e) => (e.length ?? Infinity) < num(w.slice(4)));
    else if (["vse", "all", "vsechny"].includes(w)) list = edges;
    else throw new Error(`neznámé pravidlo pro hrany „${w0}“ – vše, horní, spodní, +Z/-Z/+X/-X/+Y/-Y, svislé, vodorovné, kruhové, rovné, poloměr N, delší N, kratší N`);
  }
  return list.map((e) => e.index);
}
export function selectFaces(rule: Rule, faces: FaceLite[], bbox: Bbox): number[] {
  const tol = tolOf(bbox);
  let list = faces;
  for (const w0 of rule) {
    const w = fold(w0);
    const side = sideWord(w);
    if (side) {
      const n: Vec3 = [0, 0, 0];
      n[side.ax] = side.max ? 1 : -1;
      const cands = list.filter((f) => f.planar && f.normal && unitDot(f.normal, n) > 0.999 && f.center && near(f.center[side.ax], bbox[side.max ? 1 : 0][side.ax], tol));
      list = cands.length ? cands : list.filter((f) => f.planar && f.normal && unitDot(f.normal, n) > 0.999 && f.center).sort((a, b) => (side.max ? b.center![side.ax] - a.center![side.ax] : a.center![side.ax] - b.center![side.ax])).slice(0, 1);
    } else if (["valcove", "cylindrical", "valec", "oble"].includes(w)) list = list.filter((f) => /cyl|v[aá]l/i.test(f.surface ?? "") || (!f.planar && !!f.surface));
    else if (["rovinne", "planar", "rovne", "ploche"].includes(w)) list = list.filter((f) => f.planar);
    else if (["bocni", "side", "sides"].includes(w)) list = list.filter((f) => f.planar && f.normal && unitDot(f.normal, [0, 0, 1]) < 0.001);
    else if (["nejvetsi", "largest", "max"].includes(w)) list = [...list].sort((a, b) => (b.area ?? 0) - (a.area ?? 0)).slice(0, 1);
    else if (["vse", "all", "vsechny"].includes(w)) list = faces;
    else throw new Error(`neznámé pravidlo pro plochy „${w0}“ – +Z/-Z/+X/-X/+Y/-Y, horní, spodní, boční, válcové, rovinné, největší`);
  }
  return list.map((f) => f.index);
}

/* ───────────────────────── stav dokumentu jako text ───────────────────────── */
const fmt = (n: number, d = 1) => (Number.isFinite(n) ? n.toFixed(d).replace(/\.0+$/, "").replace(/^-0$/, "0").replace(".", ",") : "–");
export function featureSummary(f: Feature): string {
  switch (f.type) {
    case "sketch":
      return `rovina ${f.plane.kind === "base" ? f.plane.name + (f.plane.offset ? ` +${fmt(f.plane.offset)}` : "") : f.plane.label ?? "vlastní"}, ${f.entities.length} entit` + (f.entities.length ? ": " + f.entities.map((e) => e.type === "circle" ? `kružnice Ø${fmt(2 * e.r)}` : e.type === "rect" ? `obdélník ${fmt(e.w)}×${fmt(e.h)}` : e.type === "polygon" ? `${e.sides}-úhelník` : e.type === "slot" ? `drážka ${fmt(e.length)}×${fmt(e.width)}` : e.type === "polyline" ? `čára ${e.points.length} b.` : e.type).slice(0, 6).join(", ") : "");
    case "extrude":
      return `${f.extent?.kind === "throughAll" ? "skrz vše" : fmt(f.distance) + " mm"}${f.symmetric ? ", symetricky" : ""}, ${f.mode}`;
    case "revolve":
      return `${fmt(f.angle)}°, ${f.mode}`;
    case "box":
      return `${f.size.map((v) => fmt(v)).join(" × ")} mm${f.centered ? " (střed)" : ""}, ${f.mode}`;
    case "cylinder":
      return `Ø${fmt(2 * f.radius)} × ${fmt(f.height)} mm, osa ${f.axis}, ${f.mode}`;
    case "sphere":
      return `Ø${fmt(2 * f.radius)} mm, ${f.mode}`;
    case "cone":
      return `Ø${fmt(2 * f.radius1)}→Ø${fmt(2 * f.radius2)} × ${fmt(f.height)} mm, ${f.mode}`;
    case "tube":
      return `Ø${fmt(f.outer)}/Ø${fmt(f.inner)} × ${fmt(f.height)} mm, ${f.mode}`;
    case "hole":
      return `Ø${fmt(f.diameter, 2)}${f.thread ? ` ${f.thread}` : ""}${f.depth > 0 ? ` hloubka ${fmt(f.depth)}` : " skrz"}${f.cbDiameter > 0 ? ` zahl. Ø${fmt(f.cbDiameter)}×${fmt(f.cbDepth)}` : ""} v [${f.position.map((v) => fmt(v)).join("; ")}], osa ${f.axis}`;
    case "fillet":
      return `R${fmt(f.radius, 2)}, hrany ${f.edges === "all" ? "vše" : f.edges.length}`;
    case "chamfer":
      return `${fmt(f.distance, 2)} mm, hrany ${f.edges === "all" ? "vše" : f.edges.length}`;
    case "shell":
      return `${fmt(f.thickness, 2)} mm, otevřených ploch ${f.faces.length}`;
    case "pattern":
      return f.kind === "circular" ? `kruhové ${f.count}× / ${fmt(f.angle)}°` : f.kind === "linear" ? `lineární ${f.count}× po ${fmt(f.spacing)}${f.count2 ? ` × ${f.count2}× po ${fmt(f.spacing2 ?? 0)}` : ""}` : f.kind;
    case "mirror":
      return `rovina ${f.plane}${f.offset ? ` +${fmt(f.offset)}` : ""}`;
    case "text":
      return `„${f.text}“ ${fmt(f.height)} mm, ${f.mode}`;
    case "import":
      return `${f.fileName} (${f.format})`;
    default:
      return "";
  }
}
/** Textový stav dokumentu – zpětná vazba pro agenta bez obrázku. */
export function docStatusText(doc: CadDoc, res: BuildResult | null): string {
  const st = new Map((res?.status ?? []).map((s) => [s.id, s]));
  const okCount = doc.features.filter((f) => st.get(f.id)?.ok !== false).length;
  const lines: string[] = [];
  lines.push(`Dokument: „${doc.name}“ · ${doc.kind === "assembly" ? "sestava" : "díl"} · materiál ${doc.material || "–"} · prvků ${doc.features.length} (${okCount} ✓, ${doc.features.length - okCount} ✗)${res?.bodies?.length ? ` · těles ${res.bodies.length}` : ""}`);
  if (res?.metrics) {
    const [a, b] = res.metrics.bbox;
    lines.push(`Rozměry: ${fmt(b[0] - a[0])} × ${fmt(b[1] - a[1])} × ${fmt(b[2] - a[2])} mm (X ${fmt(a[0])}…${fmt(b[0])}, Y ${fmt(a[1])}…${fmt(b[1])}, Z ${fmt(a[2])}…${fmt(b[2])}) · objem ${fmt(res.metrics.volume / 1000, 2)} cm³ · ploch ${res.metrics.faces} · hran ${res.metrics.edges}`);
  } else if (res) lines.push("Rozměry: žádné těleso (jen skici / pomocná geometrie)");
  if (doc.kind === "assembly") lines.push(`Komponenty: ${(doc.components ?? []).map((c) => c.name).join(", ") || "žádné"}`);
  if (doc.features.length) {
    lines.push("Prvky:");
    doc.features.forEach((f, i) => {
      const s = st.get(f.id);
      lines.push(` ${i + 1}. ${f.name} [${f.type}, id ${f.id}] ${s?.ok === false ? "✗ " + (s.error ?? "chyba") : "✓"}${f.suppressed ? " (potlačen)" : ""} – ${featureSummary(f)}`);
    });
  }
  if (res?.paramErrors?.length) lines.push(`Chyby proměnných: ${res.paramErrors.join("; ")}`);
  if (doc.variables?.length) lines.push(`Proměnné: ${doc.variables.map((v) => `${v.name} = ${v.expr}`).join("; ")}`);
  return lines.join("\n");
}

/** Seznam příkazů (pro nápovědu v konzoli a paletu). */
export const AGENT_COMMANDS: { cmd: string; en: string; desc: string }[] = [
  { cmd: "nový díl [název] / nová sestava [název]", en: "new part / new assembly", desc: "nový dokument v nové záložce" },
  { cmd: "název …, materiál …, barva #hex", en: "name, material, color", desc: "popis dokumentu" },
  { cmd: "kvádr X Y Z [střed] [v x y z] [odebrat]", en: "box", desc: "kvádr; výchozí roh v počátku, „střed“ = vystředit" },
  { cmd: "válec D H [osa Z] [v x y z] [odebrat]", en: "cylinder", desc: "válec průměr × výška" },
  { cmd: "koule D [v x y z]", en: "sphere", desc: "koule průměr" },
  { cmd: "kužel D1 D2 H [osa Z]", en: "cone", desc: "kužel / komolý kužel" },
  { cmd: "trubka D d H [osa Z]", en: "tube", desc: "trubka vnější / vnitřní průměr × výška" },
  { cmd: "skica XY|XZ|YZ [odsazení N]: entita; entita…", en: "sketch", desc: "nová skica; entity i na dalších řádcích" },
  { cmd: "obdélník W H [v x y] | roh x y [zaoblení-rohů r]", en: "rect", desc: "obdélník se středem (výchozí počátek) nebo rohem" },
  { cmd: "kružnice D [v x y]", en: "circle", desc: "kružnice průměrem (poloměr r: „poloměr 10“)" },
  { cmd: "mnohoúhelník N D [v x y]", en: "polygon", desc: "pravidelný N-úhelník (D = opsaná kružnice)" },
  { cmd: "drážka L W [v x y] [úhel a]", en: "slot", desc: "drážka" },
  { cmd: "úsečka x1 y1 x2 y2 · čára x1 y1 x2 y2 … [uzavřít] · bod x y · elipsa rx ry", en: "line, polyline, point, ellipse", desc: "další entity; předpona „pomocná“ = konstrukční" },
  { cmd: "vysunout H [symetricky] [skrz] [odebrat|přidat|průnik|nové] [obráceně] [úkos a]", en: "extrude", desc: "vysune poslední skicu" },
  { cmd: "rotovat [úhel] [osa X|Y|Z]", en: "revolve", desc: "orotuje poslední skicu (výchozí osa Y skici, 360°)" },
  { cmd: "díra D [hloubka H|skrz] v x y [z] [osa Z] [zahloubení D2 H2] [kuželové D2] [závit M8]", en: "hole", desc: "bez z = z nejvyššího bodu tělesa dolů (skrz vše / hloubka)" },
  { cmd: "zaoblit R [hrany vše|horní|spodní|svislé|vodorovné|kruhové|rovné|+Z… ] [poloměr N] [delší N]", en: "fillet", desc: "pravidla lze kombinovat (horní kruhové)" },
  { cmd: "srazit C [hrany …]", en: "chamfer", desc: "sražení hran" },
  { cmd: "skořepina T [otevřít +Z|horní|boční…]", en: "shell", desc: "vydlabání, otevřené plochy pravidlem" },
  { cmd: "pole N rozteč P [směr X] [N2 rozteč P2 směr Y] · pole kruhové N [úhel 360] [osa Z] [v cx cy cz]", en: "pattern", desc: "pole posledního prvku" },
  { cmd: "zrcadlit XY|XZ|YZ [odsazení N]", en: "mirror", desc: "zrcadlení tělesa" },
  { cmd: "text \"ABC\" výška H hloubka D v x y [z] [gravírovat]", en: "text", desc: "nápis vystouplý / gravírovaný" },
  { cmd: "smazat poslední · stav · zobraz iso|přední|horní…", en: "undo, status, view", desc: "správa" },
  { cmd: "{ … } nebo [ … ] (JSON)", en: "JSON", desc: "celý dokument .mncad, pole prvků nebo jeden prvek – přístup ke všem 36 typům prvků" },
];

/** JavaScript API v prohlížeči (`window.mncad`) – pro automatizaci a agenty, kteří umí spustit skript. */
export type MncadApi = {
  version: number;
  /** návod pro AI (Markdown) */
  guide: () => string;
  /** seznam textových příkazů */
  commands: () => string[];
  /** provede textové příkazy nebo JSON; vrátí protokol + stav dokumentu */
  run: (text: string) => Promise<string>;
  /** kopie otevřeného dokumentu (formát .mncad) */
  getDocument: () => CadDoc;
  /** nahradí / otevře dokument (objekt nebo JSON text); vrátí protokol */
  setDocument: (doc: CadDoc | string) => Promise<string>;
  /** textový stav dokumentu (rozměry, prvky, chyby) */
  status: () => Promise<string>;
  /** otevře konzoli Textové příkazy */
  openConsole: () => void;
};
declare global {
  interface Window {
    mncad?: MncadApi;
  }
}
