/**
 * Textový příkaz `vysunout` (EN `extrude`, DE `extrudieren`) – šikmé vysunutí, úkos dovnitř / ven s břitem, ukončení odkazem.
 *
 *   vysunout 20 směr 1 0 1                 # šikmý hranol podél vektoru (20 = délka podél směru)
 *   vysunout výška 20 směr 1 0 1           # 20 = výška kolmo na rovinu skici (délka podél směru = 20 / cos)
 *   vysunout 20 směr hrana E3 | směr osa "Osa 1" | směr plocha F2 | směr body V1 V5 | směr +X
 *   vysunout 20 sklon 25 [k +X | k 1 1 0]  # propad: hranol skloněný o 25° od normály skici směrem k +X (průmět do roviny skici)
 *   vysunout skrz odebrat obráceně úkos 2 ven břit 3 [ostré rohy]   # střižnice: břit 3 mm, pak odlehčení 2° (otvor se rozšiřuje)
 *   vysunout 10 odebrat k tělesu | k dalšímu | k ploše F3 [odsazení 2] | k rovině "Rovina 1" | k vrcholu V3
 *
 * Směr odkazem se píše vždy za `směr` (`směr hrana E3`); samotné `hrana E3` / `osa …` / `body V1 V2` je chyba s nápovědou – obecný
 * rozbor by je jinak vzal jako volby jiných příkazů (hrany zaoblení, těleso) a tiše změnil význam řádku.
 *
 * Úkos: kladný = dovnitř (vnější obrys se od roviny skici zužuje, otvory profilu rozšiřují), záporný = ven; slovo `dovnitř` / `ven`
 * (EN in / out, DE innen / außen) určí znaménko bez ohledu na zapsané. Význam pro přidání i odebrání popisuje extrude-draft.ts.
 * Čisté funkce bez jádra (testy v Node); názvy pomocné osy / roviny („Osa 1“) převede na id aplikace (`resolveRefNames`).
 */
import { tr } from "./i18n";
import type { Direction, Extent, Ref } from "./refs";
import type { Feature, Vec3 } from "./types";
import { resolveDatumNames } from "./agent-prim";

type ExtrudeF = Extract<Feature, { type: "extrude" }>;
/** volby příkazu z obecného rozboru agent.ts (`parseOpts`) */
export type OptsLike = { flags: Set<string>; nums: Record<string, number[]>; words: Record<string, string[]>; free: number[]; strings: string[] };

const fold = (s: string) => s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/ß/g, "ss").replace(/−/g, "-");
const set = (...w: string[]) => new Set(w.map(fold));
const isNum = (t: string) => /^[+-]?(\d+[.,]?\d*|[.,]\d+)(mm|°)?$/i.test(t.replace(/^[øØ]/, ""));
const num = (t: string) => {
  const m = /^([+-]?)(\d+[.,]?\d*|[.,]\d+)/.exec(t.replace(/^[øØ]/, ""));
  return m ? (m[1] === "-" ? -1 : 1) * parseFloat(m[2].replace(",", ".")) : NaN;
};

const DIR = set("směr", "smer", "podél", "podel", "direction", "dir", "along", "richtung", "entlang");
const TILT = set("sklon", "naklonit", "tilt", "neigung", "geneigt");
const TOWARD = set("k", "ke", "směrem", "smerem", "toward", "towards", "nach", "zu");
const TO = set("k", "ke", "to", "bis");
const IN = set("dovnitř", "dovnitr", "in", "inward", "inwards", "innen");
const OUT = set("ven", "out", "outward", "outwards", "außen", "aussen");
const LAND = set("břit", "brit", "land", "steg", "schneidkante");
const SHARP = set("ostré", "ostre", "ostrými", "ostrymi", "sharp", "scharf", "scharfe", "scharfen");
const ROUND = set("zaoblené", "zaoblene", "zaoblenými", "zaoblenymi", "round", "rounded", "rund", "runde", "runden");
const CORNERS = set("rohy", "roh", "rohů", "rohu", "corners", "corner", "ecken", "ecke");
const EDGE = set("hrana", "hrany", "hranou", "edge", "kante");
const FACE = set("plocha", "plochy", "plochou", "face", "fläche", "flaeche");
const AXISW = set("osa", "osou", "axis", "achse");
const POINTS = set("body", "points", "punkte");
const NORMAL = set("normála", "normala", "kolmo", "normal", "normale", "senkrecht");
const OFFSET = set("odsazení", "odsazeni", "offset", "versatz");
const NAMEW = set("název", "nazev", "jméno", "jmeno", "name", "bezeichnung");
// ukončení za k / to / bis
const END_BODY = set("tělesu", "telesu", "body", "körper", "koerper");
const END_NEXT = set("dalšímu", "dalsimu", "další", "dalsi", "next", "nächste", "nachste", "nächsten", "nachsten", "naechste", "naechsten");
const END_FACE = set("ploše", "plose", "plochu", "face", "fläche", "flaeche");
const END_PLANE = set("rovině", "rovine", "rovinu", "plane", "datum", "ebene");
const END_VERTEX = set("vrcholu", "vrchol", "bodu", "bod", "vertex", "point", "punkt", "eckpunkt");

/** úplný zápis příkazu (chybové hlášky, nápověda) */
export const extrudeUsage = () =>
  tr("vysunout H|výška H [směr x y z|směr +X|směr hrana E3|směr osa \"Osa 1\"|směr plocha F2|směr body V1 V2] [sklon a [k +X|k x y z]] [symetricky] [skrz|k tělesu|k dalšímu|k ploše F3 [odsazení N]|k rovině \"Rovina 1\"|k vrcholu V3] [odebrat|přidat|průnik|nové] [obráceně] [úkos a [dovnitř|ven] [břit N] [ostré rohy|zaoblené rohy]]");

const ENT = /^([efv])(\d+)$/i;
const AXIS_TOKEN = /^([+-]?)([xyz])$/i;
const refOf = (t: string): Ref | null => {
  const m = ENT.exec(t);
  if (!m) return null;
  const i = Number(m[2]) - 1;
  if (i < 0) throw new Error(tr("čísla ploch, hran a vrcholů začínají 1 (F1, E1, V1) – „{0}“", t));
  const k = m[1].toLowerCase();
  return k === "f" ? { kind: "face", index: i } : k === "e" ? { kind: "edge", index: i } : { kind: "vertex", index: i };
};
const axisVecOf = (t: string): Vec3 | null => {
  const m = AXIS_TOKEN.exec(fold(t));
  if (!m) return null;
  const v: Vec3 = [0, 0, 0];
  v["xyz".indexOf(m[2])] = m[1] === "-" ? -1 : 1;
  return v;
};
const r6 = (v: number) => Math.round(v * 1e6) / 1e6 || 0;

/** Směr za slovem `směr`: vektor 3 čísly, ±X/Y/Z, hrana E3, plocha F2 (normála), osa "Osa 1" / X / E3, body V1 V2, normála. */
function readDirection(tk: string[], i: number): { dir: Direction | null; used: number; vec?: Vec3 } {
  const t = tk[i];
  if (t === undefined) throw new Error(tr("směr potřebuje hodnotu: směr x y z | +X | hrana E3 | osa \"Osa 1\" | plocha F2 | body V1 V2"));
  if (isNum(t)) {
    if (!(i + 2 < tk.length && isNum(tk[i + 1]) && isNum(tk[i + 2]))) throw new Error(tr("směr vektorem potřebuje tři čísla: směr 1 0 1"));
    const v: Vec3 = [num(t), num(tk[i + 1]), num(tk[i + 2])];
    if (!(Math.hypot(...v) > 1e-12)) throw new Error(tr("směr nesmí být nulový vektor"));
    return { dir: { kind: "vector", v }, used: 3, vec: v };
  }
  const f = fold(t);
  const av = axisVecOf(t);
  if (av) return { dir: av.some((c) => c < 0) ? { kind: "vector", v: av } : { kind: "axis", axis: f.replace("+", "").toUpperCase() as "X" | "Y" | "Z" }, used: 1, vec: av };
  if (NORMAL.has(f)) return { dir: null, used: 1 };
  const r = refOf(t);
  if (r) return { dir: r.kind === "face" ? { kind: "faceNormal", ref: r } : r.kind === "edge" ? { kind: "edge", ref: r } : badDir(t), used: 1 };
  const next = tk[i + 1];
  if (EDGE.has(f) || FACE.has(f)) {
    const rr = next !== undefined ? refOf(next) : null;
    if (!rr || rr.kind !== (EDGE.has(f) ? "edge" : "face")) throw new Error(EDGE.has(f) ? tr("směr hrana potřebuje číslo hrany: směr hrana E3") : tr("směr plocha potřebuje číslo plochy: směr plocha F2 (normála plochy)"));
    return { dir: rr.kind === "face" ? { kind: "faceNormal", ref: rr } : { kind: "edge", ref: rr }, used: 2 };
  }
  if (AXISW.has(f)) {
    if (next === undefined) throw new Error(tr("směr osa potřebuje osu: směr osa \"Osa 1\" | X | E3"));
    if (axisVecOf(next)) return { ...readDirection(tk, i + 1), used: 2 };
    const rr = refOf(next);
    if (rr?.kind === "edge") return { dir: { kind: "edge", ref: rr }, used: 2 };
    // pomocná osa názvem (id doplní aplikace – resolveRefNames)
    return { dir: { kind: "edge", ref: { kind: "datumAxis", featureId: next } }, used: 2 };
  }
  if (POINTS.has(f)) {
    const a = tk[i + 1] !== undefined ? refOf(tk[i + 1]) : null;
    const b = tk[i + 2] !== undefined ? refOf(tk[i + 2]) : null;
    if (!a || !b || a.kind !== "vertex" || b.kind !== "vertex") throw new Error(tr("směr body potřebuje dva vrcholy: směr body V1 V5"));
    return { dir: { kind: "twoPoints", a, b }, used: 3 };
  }
  return badDir(t);
}
function badDir(t: string): never {
  throw new Error(tr("neznámý směr „{0}“ – směr x y z | +X | hrana E3 | osa \"Osa 1\" | plocha F2 | body V1 V2", t));
}
/** globální vektor za `k` / `směr` u sklonu: ±X/Y/Z nebo tři čísla */
function readVector(tk: string[], i: number, what: string): { v: Vec3; used: number } {
  const t = tk[i];
  const av = t !== undefined ? axisVecOf(t) : null;
  if (av) return { v: av, used: 1 };
  if (t !== undefined && isNum(t) && i + 2 < tk.length && isNum(tk[i + 1]) && isNum(tk[i + 2])) {
    const v: Vec3 = [num(t), num(tk[i + 1]), num(tk[i + 2])];
    if (!(Math.hypot(...v) > 1e-12)) throw new Error(tr("směr nesmí být nulový vektor"));
    return { v, used: 3 };
  }
  throw new Error(tr("{0}: směr sklonu se píše +X, -Y … nebo třemi čísly (k 1 1 0)", what));
}

/** Rozbor voleb vysunutí, které obecný rozbor (`parseOpts`) nezná; ostatní tokeny vrátí v `rest`. */
export function scanExtrude(tokens: string[]): { rest: string[]; dir?: Direction; tilt?: number; toward?: Vec3; draftSign?: 1 | -1; land?: number; corners?: "sharp" | "round"; extent?: Extent } {
  const out: ReturnType<typeof scanExtrude> = { rest: [] };
  let dirSpec: { dir: Direction | null; vec?: Vec3 } | null = null;
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i];
    const f = fold(t);
    const nf = tokens[i + 1] !== undefined ? fold(tokens[i + 1]) : "";
    if (DIR.has(f)) {
      if (dirSpec) throw new Error(tr("vysunout: směr je zadaný dvakrát"));
      const d = readDirection(tokens, i + 1);
      dirSpec = d;
      i += d.used;
      continue;
    }
    if (TILT.has(f)) {
      const a = tokens[i + 1];
      if (a === undefined || !isNum(a)) throw new Error(tr("sklon potřebuje úhel od normály skici: sklon 25 [k +X]"));
      out.tilt = num(a);
      if (!(Math.abs(out.tilt) < 89)) throw new Error(tr("sklon musí být menší než 89° (zadáno {0}°)", a));
      i++;
      continue;
    }
    // ukončení: k tělesu, k dalšímu, k ploše F3 [odsazení N], k rovině "Rovina 1", k vrcholu V3
    if (TO.has(f) && (END_BODY.has(nf) || END_NEXT.has(nf) || END_FACE.has(nf) || END_PLANE.has(nf) || END_VERTEX.has(nf))) {
      if (out.extent) throw new Error(tr("vysunout: ukončení je zadané dvakrát"));
      if (END_BODY.has(nf)) out.extent = { kind: "toBody" };
      else if (END_NEXT.has(nf)) out.extent = { kind: "toNext" };
      else {
        const v = tokens[i + 2];
        if (v === undefined) throw new Error(tr("ukončení k ploše / rovině / vrcholu potřebuje odkaz: k ploše F3 | k rovině \"Rovina 1\" | k vrcholu V3"));
        if (END_VERTEX.has(nf)) {
          const rr = refOf(v);
          if (rr?.kind !== "vertex") throw new Error(tr("k vrcholu potřebuje číslo vrcholu: k vrcholu V3"));
          out.extent = { kind: "toVertex", ref: rr };
        } else {
          const rr: Ref | null = END_PLANE.has(nf) ? { kind: "datum", featureId: v } : refOf(v);
          if (!rr || rr.kind !== (END_PLANE.has(nf) ? "datum" : "face")) throw new Error(tr("k ploše potřebuje číslo plochy: k ploše F3 [odsazení 2]"));
          out.extent = { kind: "toFace", ref: rr };
          if (tokens[i + 3] !== undefined && OFFSET.has(fold(tokens[i + 3]))) {
            const o = tokens[i + 4];
            if (o === undefined || !isNum(o)) throw new Error(tr("odsazení potřebuje číslo: k ploše F3 odsazení 2"));
            out.extent.offset = num(o);
            i += 2;
          }
        }
        i++;
      }
      i++;
      continue;
    }
    if (TOWARD.has(f) && !out.toward && tokens[i + 1] !== undefined && (axisVecOf(tokens[i + 1]) || isNum(tokens[i + 1]))) {
      const v = readVector(tokens, i + 1, t);
      out.toward = v.v;
      i += v.used;
      continue;
    }
    // směr odkazem bez „směr“: obecný rozbor by „hrana E3“ vzal jako hrany zaoblení (i se slovy za nimi), „osa“ tiše vynechal
    // a „body V1 V2“ jako název tělesa – chyba s nápovědou místo tiché změny významu
    const bareRef = tokens[i + 1] !== undefined ? refOf(tokens[i + 1]) : null;
    const twoVertices = POINTS.has(f) && bareRef?.kind === "vertex" && tokens[i + 2] !== undefined && refOf(tokens[i + 2])?.kind === "vertex";
    const named = i > 0 && NAMEW.has(fold(tokens[i - 1])); // „název Osa“ = název prvku
    if (!named && (((EDGE.has(f) || FACE.has(f)) && bareRef) || (AXISW.has(f) && tokens[i + 1] !== undefined) || twoVertices)) {
      const what = twoVertices ? `${t} ${tokens[i + 1]} ${tokens[i + 2]}` : `${t}${tokens[i + 1] !== undefined ? " " + tokens[i + 1] : ""}`;
      throw new Error(tr("vysunout: „{0}“ – směr odkazem se píše za slovo směr: směr {0} (ukončení: k ploše F3, k vrcholu V3)", what));
    }
    if (f === "nach" && (IN.has(nf) || OUT.has(nf))) continue; // „nach innen / nach außen“
    if (IN.has(f) || OUT.has(f)) {
      const s = IN.has(f) ? 1 : -1;
      if (out.draftSign && out.draftSign !== s) throw new Error(tr("úkos nemůže být zároveň dovnitř i ven"));
      out.draftSign = s;
      continue;
    }
    if (LAND.has(f)) {
      const v = tokens[i + 1];
      if (v === undefined || !isNum(v) || !(num(v) >= 0)) throw new Error(tr("břit potřebuje délku rovné části v mm: břit 3"));
      out.land = num(v);
      i++;
      continue;
    }
    if (SHARP.has(f) || ROUND.has(f)) {
      out.corners = SHARP.has(f) ? "sharp" : "round";
      if (CORNERS.has(nf)) i++;
      continue;
    }
    if (CORNERS.has(f) && (SHARP.has(nf) || ROUND.has(nf))) {
      out.corners = SHARP.has(nf) ? "sharp" : "round";
      i++;
      continue;
    }
    out.rest.push(t);
  }
  if (out.tilt !== undefined) {
    // sklon: „směr“ u sklonu = směr naklonění (jako u díry „sklon 30 směr +X“)
    if (dirSpec) {
      if (out.toward) throw new Error(tr("sklon: směr naklonění zadejte jednou (k +X nebo směr +X)"));
      if (!dirSpec.vec) throw new Error(tr("sklon: směr naklonění zadejte vektorem nebo osou (k +X, k 1 1 0)"));
      out.toward = dirSpec.vec;
    }
    // bez „k“ = k ose X skici; „obráceně“ pak zrcadlí přes rovinu skici stejně jako s „k +X“ (keepSide)
    if (Math.abs(out.tilt) > 1e-9) out.dir = { kind: "angle", deg: out.tilt, ...(out.toward ? { toward: out.toward.map(r6) as Vec3 } : { keepSide: true }) };
  } else if (out.toward) throw new Error(tr("„k +X“ určuje směr sklonu – patří za sklon: vysunout 20 sklon 25 k +X"));
  else if (dirSpec?.dir) out.dir = dirSpec.dir;
  return out;
}

/**
 * Slova pro obecný rozbor celého řádku v agent.ts (název `název …`, cílové těleso `těleso …`): bez voleb vysunutí, aby se
 * `směr body V1 V5` / `k tělesu` nebraly jako těleso. Chybu zápisu ohlásí až `extrudeFromText`.
 */
export function extrudeOptTokens(tokens: string[]): string[] {
  try {
    return scanExtrude(tokens).rest;
  } catch {
    return tokens;
  }
}

/** obecné volby, které vysunutí zná (ostatní jsou chyba – nic se tiše nevynechá) */
const KNOWN_FLAGS = new Set(["through", "symmetric", "reverse", "cut", "add", "intersect", "newbody"]);
const KNOWN_NUMS = new Set(["height", "depth", "draft"]);
const KNOWN_WORDS = new Set(["name", "body"]);
const HINTS: Record<string, () => string> = {
  angle: () => tr("šikmé vysunutí: sklon 25 [k +X] nebo směr x y z"),
  offset: () => tr("odsazení patří k ukončení: k ploše F3 odsazení 2"),
  axis: () => tr("směr podél osy: směr osa \"Osa 1\" | směr osa Z"),
  edges: () => tr("směr podél hrany: směr hrana E3"),
  direction: () => tr("směr x y z | směr +X | směr hrana E3"),
};

/** Prvek vysunutí z textu (`tokens` = slova za příkazem); `base` jako funkce = název se přidělí až po úspěšném rozboru. */
export function extrudeFromText(tokens: string[], parse: (t: string[]) => OptsLike, base: { id: string; name: string } | (() => { id: string; name: string })): ExtrudeF {
  const ex = scanExtrude(tokens);
  const o = parse(ex.rest);
  const junk = o.strings.filter((s) => !/^(mm|°)$/i.test(s));
  if (junk.length) throw new Error(tr("vysunout: neznámé slovo „{0}“ – zápis: {1}", junk[0], extrudeUsage()));
  // volby jiných příkazů a přebytečná čísla: chyba s původním slovem (obecný rozbor zná jen kanonické klíče)
  const word = (key: string) => ex.rest.find((t) => {
    const p = parse([t]);
    return p.flags.has(key) || key in p.nums || key in p.words;
  }) ?? key;
  const stray = [...[...o.flags].filter((k) => !KNOWN_FLAGS.has(k)), ...Object.keys(o.nums).filter((k) => !KNOWN_NUMS.has(k)), ...Object.keys(o.words).filter((k) => !KNOWN_WORDS.has(k))];
  if (stray.length) throw new Error(tr("vysunout: volba „{0}“ sem nepatří{1} – zápis: {2}", word(stray[0]), HINTS[stray[0]] ? ` (${HINTS[stray[0]]()})` : "", extrudeUsage()));
  for (const k of KNOWN_NUMS) if ((o.nums[k]?.length ?? 0) > 1) throw new Error(tr("vysunout: „{0}“ má jen jednu hodnotu (zadáno {1})", word(k), o.nums[k].join(" ")));
  if (o.free.length > 1) throw new Error(tr("vysunout: přebytečné číslo „{0}“ – délka se zadává jednou: {1}", o.free[1], extrudeUsage()));
  const lens = [o.free[0] !== undefined ? String(o.free[0]) : "", o.nums.height?.length ? `${word("height")} ${o.nums.height[0]}` : "", o.nums.depth?.length ? `${word("depth")} ${o.nums.depth[0]}` : ""].filter(Boolean);
  if (lens.length > 1) throw new Error(tr("vysunout: délka je zadaná dvakrát ({0}) – číslo / hloubka = podél směru, výška = kolmo na skicu", lens.join(", ")));
  const byHeight = o.free[0] === undefined && o.nums.height?.[0] !== undefined;
  const d = o.free[0] ?? o.nums.height?.[0] ?? o.nums.depth?.[0];
  const through = o.flags.has("through");
  if (through && ex.extent) throw new Error(tr("vysunout: „skrz“ a ukončení „k …“ nelze kombinovat"));
  if (!through && !ex.extent && !(d > 0)) throw new Error(tr("vysunout potřebuje výšku: {0}", extrudeUsage()));
  const mode = o.flags.has("cut") ? "cut" : o.flags.has("intersect") ? "intersect" : o.flags.has("newbody") ? "new" : o.flags.has("add") ? "add" : ("$auto" as unknown as "add");
  const f: ExtrudeF = { id: "", name: "", type: "extrude", sketchId: "$last", distance: d > 0 && !through ? d : through ? 1 : 10, symmetric: o.flags.has("symmetric"), reverse: o.flags.has("reverse"), mode };
  if (through) f.extent = { kind: "throughAll" };
  else if (ex.extent) f.extent = ex.extent;
  if (ex.dir) f.dir = ex.dir;
  // „výška“ u šikmého směru; „k vrcholu“ šikmo = po rovinu rovnoběžnou se skicou přes vrchol (bez pole: průmět do směru – starší dokumenty)
  if (ex.dir && (byHeight || ex.extent?.kind === "toVertex")) f.normalHeight = true;
  const a = o.nums.draft?.[0];
  if (o.nums.draft && a === undefined) throw new Error(tr("úkos potřebuje úhel: úkos 2 [dovnitř|ven]"));
  if (a !== undefined && Math.abs(a) > 1e-9) {
    if (!(Math.abs(a) < 45)) throw new Error(tr("úkos vysunutí musí být menší než 45° (zadáno {0}°)", a));
    f.draftAngle = ex.draftSign ? ex.draftSign * Math.abs(a) : a;
  } else if (ex.draftSign) throw new Error(tr("„dovnitř“ / „ven“ patří k úkosu: vysunout 20 úkos 2 ven"));
  if ((ex.land !== undefined || ex.corners) && !f.draftAngle) throw new Error(tr("břit a ostré / zaoblené rohy patří k úkosu: vysunout skrz odebrat úkos 2 ven břit 3"));
  if (f.draftAngle) {
    if (ex.land) f.draftLand = ex.land;
    // nový úkos má ostré rohy (rovinné stěny jako v desktopových CADech); „zaoblené rohy“ = starší chování (JSON bez pole)
    f.draftCorners = ex.corners ?? "sharp";
  }
  const b = typeof base === "function" ? base() : base;
  f.id = b.id;
  f.name = b.name;
  return f;
}

/** `upravit … draftCorners=ostré|zaoblené|sharp|round`, `draftLand=N`, `normalHeight=ano` – jen platné hodnoty (jinak by se tiše změnily) */
export function extrudeFieldValue(field: string, v: unknown, key: string): unknown {
  if (field === "draftCorners") {
    const w = typeof v === "string" ? fold(v) : "";
    if (SHARP.has(w)) return "sharp";
    if (ROUND.has(w)) return "round";
    throw new Error(tr("„{0}“: rohy úkosu jsou sharp (ostré) | round (zaoblené), zadáno „{1}“", key, String(v)));
  }
  if (field === "draftLand") {
    if (typeof v !== "number" || !(v >= 0)) throw new Error(tr("„{0}“ čeká délku břitu v mm (0 = bez břitu), zadáno „{1}“", key, String(v)));
    return v;
  }
  if (field === "normalHeight" && typeof v !== "boolean") throw new Error(tr("„{0}“ čeká ano / ne, zadáno „{1}“", key, String(v)));
  return v;
}
export const EXTRUDE_EDIT_FIELDS = new Set(["draftCorners", "draftLand", "normalHeight"]);

/* ───────────── stav ───────────── */
const refText = (r: Ref, name: (id: string) => string): string => {
  switch (r.kind) {
    case "face":
      return `F${r.index + 1}`;
    case "edge":
      return `E${r.index + 1}`;
    case "vertex":
      return `V${r.index + 1}`;
    case "datum":
    case "datumAxis":
    case "datumPoint":
      return `„${name(r.featureId)}“`;
    case "xyz":
      return `[${r.p.join("; ")}]`;
    default:
      return r.kind;
  }
};
const vecText = (v: Vec3, fmt: (n: number, d?: number) => string): string => {
  const nz = v.map((c, i) => [c, i] as const).filter(([c]) => Math.abs(c) > 1e-9);
  if (nz.length === 1) return `${nz[0][0] < 0 ? "-" : "+"}${"XYZ"[nz[0][1]]}`;
  return `[${v.map((c) => fmt(c, 3)).join("; ")}]`;
};
const extentText = (e: Extent, fmt: (n: number, d?: number) => string, name: (id: string) => string): string => {
  switch (e.kind) {
    case "throughAll":
      return tr("skrz vše");
    case "toBody":
      return tr("k tělesu");
    case "toNext":
      return tr("k dalšímu");
    case "toVertex":
      return tr("k vrcholu {0}", refText(e.ref, name));
    case "toFace":
      return (e.ref.kind === "datum" ? tr("k rovině {0}", refText(e.ref, name)) : tr("k ploše {0}", refText(e.ref, name))) + (e.offset ? tr(" (odsazení {0})", fmt(e.offset)) : "");
    case "offsetFromFace":
      return tr("odsazeně {0} mm od plochy {1}", fmt(e.d), refText(e.ref, name));
    default:
      return `${fmt(e.d)} mm`;
  }
};
/** popis směru vysunutí pro `stav` */
export function directionText(d: Direction, fmt: (n: number, d?: number) => string, name: (id: string) => string = (x) => x): string {
  switch (d.kind) {
    case "normal":
      return tr("normála skici");
    case "axis":
      return `+${d.axis}`;
    case "vector":
      return vecText(d.v, fmt);
    case "angle":
      return d.toward ? tr("sklon {0}° k {1}", fmt(d.deg), vecText(d.toward, fmt)) : tr("sklon {0}° (k ose X skici)", fmt(d.deg));
    case "edge":
      return d.ref.kind === "datumAxis" ? tr("podél osy {0}", refText(d.ref, name)) : tr("podél hrany {0}", refText(d.ref, name));
    case "faceNormal":
      return tr("normála plochy {0}", refText(d.ref, name));
    case "twoPoints":
      return `${refText(d.a, name)} → ${refText(d.b, name)}`;
    case "tangent":
      return tr("tečna {0}", refText(d.ref, name));
  }
}
/**
 * Řádek `stav` vysunutí: „20 mm, symetricky, cut“ jako dosud (beze změny u starších prvků) + ukončení odkazem, směr, výška,
 * úkos se znaménkem slovy, břit, ostré rohy, druhý směr.
 */
export function extrudeSummary(f: ExtrudeF, fmt: (n: number, d?: number) => string, name: (id: string) => string = (x) => x): string {
  const head = !f.extent || f.extent.kind === "blind" || f.extent.kind === "midPlane" ? `${fmt(f.distance)} mm` : extentText(f.extent, fmt, name);
  const parts = [head + (f.symmetric ? tr(", symetricky") : ""), f.mode];
  if (f.dir && f.dir.kind !== "normal") parts.push(tr("směr {0}", directionText(f.dir, fmt, name)));
  if (f.normalHeight) parts.push(tr("výška kolmo na skicu"));
  if (f.draftAngle) {
    parts.push(f.draftAngle > 0 ? tr("úkos {0}° dovnitř (obrys se zužuje)", fmt(f.draftAngle)) : tr("úkos {0}° ven (obrys se rozšiřuje)", fmt(-f.draftAngle)));
    if (f.draftLand) parts.push(tr("břit {0} mm", fmt(f.draftLand)));
    parts.push(f.draftCorners === "sharp" ? tr("ostré rohy") : tr("zaoblené rohy"));
  }
  if (f.extent2) parts.push(tr("2. směr {0}", extentText(f.extent2, fmt, name)));
  return parts.join(", ");
}

/* ───────────── názvy pomocné geometrie → id ───────────── */
/**
 * Odkazy na pomocnou rovinu / osu / bod zadané textem názvem („Osa 1“) převede na id prvku (kdekoli v prvku – směr, ukončení…).
 * Jedna implementace pro všechny příkazy: `resolveDatumNames` (agent-prim.ts); aplikace ji volá jednou pro každý přidaný prvek.
 */
export const resolveRefNames = resolveDatumNames;
