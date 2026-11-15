/**
 * Společné řádky tabulky (tělo kola, umístění, výstup), jejich čtení a kontrola, poloviční řez soustruženého polotovaru
 * a obrys díry s drážkou pro pero DIN 6885-1.
 */
import { getLang, tr } from "../i18n";
import { keyForShaft, SET_SCREWS } from "./tables";
import type { BodyOpts, GearData, GearPhrase, GearRow, Issue, Lang, Seg2, Vec2 } from "./types";

export type Words = Record<Lang, string[]>;
export const W = (cs: string | string[], en: string | string[], de: string | string[]): Words => ({ cs: [cs].flat(), en: [en].flat(), de: [de].flat() });

/** stručný zápis řádku tabulky */
export function row(key: string, label: string, kind: GearRow["kind"], def: GearRow["def"], hint: string, group: GearRow["group"], words: Words, extra: Partial<GearRow> = {}): GearRow {
  return { key, label, kind, def, hint, group, words, ...extra };
}

export const num = (v: unknown, d = 0): number => {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string" && v.trim() !== "") {
    const n = Number(v.replace(",", "."));
    if (Number.isFinite(n)) return n;
  }
  return d;
};
export const int = (v: unknown, d = 0) => Math.round(num(v, d));
export const bool = (v: unknown) => v === true || v === "true" || v === 1 || v === "ano" || v === "yes" || v === "ja";
export const oneOf = <T extends string>(v: unknown, opts: readonly T[], d: T): T => (opts.includes(String(v) as T) ? (String(v) as T) : d);
/** číslo na nejvýš `d` desetinných míst, bez koncových nul (pro názvy a souhrn; desetinnou čárku řeší výpis) */
export const fmt = (v: number, d = 3) => {
  const s = (Math.round(v * 10 ** d) / 10 ** d).toFixed(d).replace(/\.?0+$/, "");
  return s === "-0" ? "0" : s;
};
/** číslo s desetinnou čárkou a pevným počtem míst (tabulka ozubení) */
export const fix = (v: number, d = 3) => (Number.isFinite(v) ? (getLang() === "en" ? v.toFixed(d) : v.toFixed(d).replace(".", ",")) : "–");

/** desetinná čárka podle jazyka (cs, de čárka; en tečka) */
export const loc = (s: string) => (getLang() === "en" ? s : s.replace(".", ","));

export type OutMode = "wheel" | "blank" | "teeth";
export type Place = { out: OutMode; mode: "new" | "add" | "cut"; turn: number };

const HUB_SIDES = ["top", "bottom", "both"] as const;

/** Řádky těla kola. `hub: false` = bez náboje a stojiny (hřeben, vnitřní kolo…). */
export function bodyRows(o: { hub?: boolean; holes?: boolean; chamfer?: boolean; sprocket?: boolean; web?: boolean } = {}): GearRow[] {
  const hub = o.hub !== false;
  const out: GearRow[] = [
    row("bore", tr("Díra d"), "number", 0, tr("průměr díry pro hřídel; 0 = bez díry"), "body", W(["díra", "bore"], "bore", ["bohrung", "bore"]), { unit: "mm", min: 0, symbol: "d" }),
    row("keyway", tr("Drážka pro pero"), "bool", false, tr("drážka v náboji podle DIN 6885-1 (šířka a hloubka podle průměru díry)"), "body", W(["pero", "keyway"], ["keyway", "key"], ["nut", "passfeder", "keyway"])),
  ];
  if (hub)
    out.push(
      row("hubD", tr("Náboj Ø"), "number", 0, tr("průměr náboje; 0 = bez náboje (musí být menší než patní průměr)"), "body", W(["náboj-průměr", "hubd"], ["hub-diameter", "hubd"], ["nabe-durchmesser", "hubd"]), { unit: "mm", min: 0 }),
      row("hubL", tr("Náboj délka"), "number", 0, tr("přesah náboje přes čelo kola; 0 = bez náboje"), "body", W(["náboj-délka", "hubl"], ["hub-length", "hubl"], ["nabe-länge", "hubl"]), { unit: "mm", min: 0 }),
      row("hubSide", tr("Náboj na straně"), "enum", "top", o.sprocket ? tr("ISO 606: typ A = bez náboje (délka 0), typ B = náboj na jedné straně, typ C = na obou stranách") : tr("nahoře = ve směru osy kola, dole = proti směru, nebo na obou stranách"), "body", W(["náboj-strana", "hubside"], ["hub-side", "hubside"], ["nabe-seite", "hubside"]), {
        options: [{ v: "top", l: o.sprocket ? tr("Typ B – nahoře") : tr("Nahoře") }, { v: "bottom", l: o.sprocket ? tr("Typ B – dole") : tr("Dole") }, { v: "both", l: o.sprocket ? tr("Typ C – obě strany") : tr("Obě strany") }],
        enumWords: { top: W("nahoře", "top", "oben"), bottom: W("dole", "bottom", "unten"), both: W(["obě strany", "obě", "oboustranný"], ["both sides", "both"], ["beide seiten", "beidseitig"]) },
      }),
      row("setScrew", tr("Stavěcí šroub"), "enum", "", tr("radiální díra pro závit v polovině délky náboje nad drážkou pro pero (vrtá se průměr vrtáku pro závit); potřebuje náboj"), "body", W(["šroub", "setscrew"], ["setscrew", "screw"], ["gewindestift", "setscrew"]), {
        options: [{ v: "", l: tr("Žádný") }, ...Object.keys(SET_SCREWS).map((k) => ({ v: k, l: k }))],
      }),
    );
  if (o.holes !== false)
    out.push(
      row("holesN", tr("Odlehčovací díry – počet"), "int", 0, tr("počet odlehčovacích děr v disku; 0 = žádné"), "body", W(["díry-počet", "holesn"], ["holes-count", "holesn"], ["bohrungen-anzahl", "holesn"]), { min: 0, max: 24 }),
      row("holesD", tr("Odlehčovací díry Ø"), "number", 0, tr("průměr odlehčovacích děr"), "body", W(["díry-průměr", "holesd"], ["holes-diameter", "holesd"], ["bohrungen-durchmesser", "holesd"]), { unit: "mm", min: 0 }),
      row("holesPcd", tr("Odlehčovací díry – roztečná Ø"), "number", 0, tr("průměr roztečné kružnice děr; 0 = uprostřed mezi nábojem a věncem"), "body", W(["díry-rozteč", "holespcd"], ["holes-pcd", "holespcd"], ["bohrungen-teilkreis", "holespcd"]), { unit: "mm", min: 0 }),
    );
  if (hub && o.web !== false) out.push(row("webT", tr("Tloušťka stojiny"), "number", 0, tr("0 = plný disk; jinak vybrání z obou stran mezi nábojem a věncem (věnec 3·m pod patou zubu)"), "body", W(["stojina", "webt"], ["web", "webt"], ["steg", "webt"]), { unit: "mm", min: 0 }));
  if (o.chamfer !== false) out.push(row("chamfer", tr("Sražení hlav na čelech"), "number", 0, tr("sražení c×45° hlavového válce na obou čelech (soustruží se před ozubením)"), "body", W(["sražení", "chamfer"], "chamfer", ["fase", "chamfer"]), { unit: "mm", min: 0 }));
  return out;
}

/** složené zápisy těla kola: `díra 20 pero`, `náboj 40 15 obě strany`, `díry 6 12 80` */
export function bodyPhrases(o: { hub?: boolean; holes?: boolean } = {}): GearPhrase[] {
  const out: GearPhrase[] = [{ words: W("díra", "bore", "bohrung"), keys: ["bore"], flags: [{ words: W("pero", ["keyway", "key"], ["nut", "passfeder"]), set: { keyway: true } }] }];
  if (o.hub !== false)
    out.push({
      words: W("náboj", "hub", "nabe"),
      keys: ["hubD", "hubL"],
      flags: [
        { words: W(["obě strany", "obě", "oboustranný", "C"], ["both sides", "both", "C"], ["beide seiten", "beidseitig", "C"]), set: { hubSide: "both" } },
        { words: W("dole", "bottom", "unten"), set: { hubSide: "bottom" } },
        { words: W(["nahoře", "B"], ["top", "B"], ["oben", "B"]), set: { hubSide: "top" } },
      ],
    });
  if (o.holes !== false) out.push({ words: W("díry", "holes", "bohrungen"), keys: ["holesN", "holesD", "holesPcd"] });
  return out;
}

/** Řádky výstupu a umístění (všechny druhy). */
export function placeRows(): GearRow[] {
  return [
    row("jn", tr("Boční vůle – podíl kola"), "number", 0, tr("ztenčení zubu: boční vůle po normále, kterou do soukolí přinese toto kolo (0 = jmenovitý zub)"), "advanced", W(["vůle", "jn"], ["backlash", "jn"], ["spiel", "jn"]), { unit: "mm", min: 0, symbol: "jₙ" }),
    row("out", tr("Výstup"), "enum", "wheel", tr("hotové kolo, jen soustružený polotovar bez zubů, nebo jen zubové mezery vyříznuté do aktivního tělesa"), "place", W(["výstup", "out"], ["output", "out"], ["ausgabe", "out"]), {
      options: [{ v: "wheel", l: tr("Hotové kolo") }, { v: "blank", l: tr("Polotovar (bez zubů)") }, { v: "teeth", l: tr("Zuby do tělesa") }],
      enumWords: { wheel: W(["hotové", "hotový"], "finished", "fertig"), blank: W("polotovar", "blank", "rohling"), teeth: W("zuby", ["toothcut", "teethonly"], ["verzahnung", "nurzähne"]) },
    }),
    row("mode", tr("Operace"), "mode", "new", tr("nové těleso, přidat k aktivnímu tělesu, nebo od něj odebrat"), "place", W(["operace", "mode"], ["operation", "mode"], ["operation", "mode"]), {
      enumWords: { new: W(["nové", "nový"], "new", "neu"), add: W("přidat", "add", "hinzufügen"), cut: W("odebrat", "cut", "abziehen") },
    }),
    row("positionRef", tr("Poloha odkazem"), "point", "", tr("vrchol, střed hrany, bod skici… – má přednost před souřadnicemi níže"), "place", W(["poloha-odkaz", "positionref"], ["position-ref", "positionref"], ["position-ref", "positionref"])),
    row("position", tr("Poloha"), "vec3", [0, 0, 0], tr("bod, do kterého přijde počátek kola (střed spodního čela)"), "place", W(["v", "poloha", "position"], ["at", "position"], ["bei", "position"])),
    // výchozí směr jako u ostatních prvků rozšíření (surf.helix): objekt Direction, ne text „Z“ – `prvek gear.* axis=Z` uloží totéž
    row("axis", tr("Osa"), "direction", { kind: "axis", axis: "Z" }, tr("směr osy kola: X / Y / Z, vektor čísly, nebo odkazem (osa válcové plochy, hrana, normála plochy)"), "place", W(["osa", "axis"], "axis", ["achse", "axis"])),
    row("turn", tr("Natočení kolem osy"), "number", 0, tr("pootočení zubů kolem osy kola (pro nastavení záběru)"), "place", W(["natočení", "turn"], ["turn", "rotation"], ["drehung", "turn"]), { unit: "°" }),
  ];
}
/** řádky pro tabulku ozubení soukolí (vyplní je režim Soukolí) */
export function mateRows(): GearRow[] {
  return [
    row("mateZ", tr("Zuby spoluzabírajícího kola"), "int", 0, tr("jen pro tabulku ozubení; vyplní režim Soukolí (0 = neuvádět)"), "advanced", W(["protikolo", "matez"], ["mate", "matez"], ["gegenrad", "matez"]), { min: 0 }),
    row("aw", tr("Osová vzdálenost"), "number", 0, tr("jen pro tabulku ozubení; vyplní režim Soukolí (0 = neuvádět)"), "advanced", W(["osová", "aw"], ["centredistance", "aw"], ["achsabstand", "aw"]), { unit: "mm", min: 0, symbol: "a_w" }),
  ];
}
export const placePhrases = (): GearPhrase[] => [];

export function readBody(d: GearData, b: number): BodyOpts {
  return {
    b,
    bore: Math.max(0, num(d.bore)),
    keyway: bool(d.keyway),
    hubD: Math.max(0, num(d.hubD)),
    hubL: Math.max(0, num(d.hubL)),
    hubSide: oneOf(d.hubSide, HUB_SIDES, "top"),
    setScrew: typeof d.setScrew === "string" && SET_SCREWS[d.setScrew.toUpperCase()] ? d.setScrew.toUpperCase() : "",
    holesN: Math.max(0, int(d.holesN)),
    holesD: Math.max(0, num(d.holesD)),
    holesPcd: Math.max(0, num(d.holesPcd)),
    webT: Math.max(0, num(d.webT)),
    chamfer: Math.max(0, num(d.chamfer)),
  };
}
export function readPlace(d: GearData): Place {
  return { out: oneOf(d.out, ["wheel", "blank", "teeth"] as const, "wheel"), mode: oneOf(d.mode, ["new", "add", "cut"] as const, "new"), turn: num(d.turn) };
}

/** má kolo náboj? (průměr i délka) */
export const hasHub = (o: BodyOpts) => o.hubD > 0 && o.hubL > 0;
/** hloubka drážky pro pero v náboji (DIN 6885-1 t2) a šířka; bez pera nuly */
export function keyOf(o: BodyOpts): { b: number; t2: number } {
  if (!o.keyway || !(o.bore > 0)) return { b: 0, t2: 0 };
  const k = keyForShaft(o.bore);
  return { b: k.b, t2: k.t2 };
}
/** poloměr, pod kterým už je díra s drážkou (nejvzdálenější roh drážky od osy) */
export function boreReach(o: BodyOpts): number {
  const k = keyOf(o);
  return k.b > 0 ? Math.hypot(o.bore / 2 + k.t2, k.b / 2) : o.bore / 2;
}
/** vnitřní poloměr vybrání stojiny / nejmenší poloměr pro odlehčovací díry */
export const innerR = (o: BodyOpts) => (hasHub(o) ? o.hubD / 2 : o.bore > 0 ? Math.max(0.8 * o.bore, boreReach(o) + 2) : 0);
/** volný pás pro odlehčovací díry (poloměry): od náboje / díry s drážkou + 1 mm po věnec 2·m pod patou zubu */
export const holesBand = (o: BodyOpts, rootR: number, m: number): [number, number] => [Math.max(innerR(o), boreReach(o)) + 1, rootR - 2 * m];
/** roztečná kružnice odlehčovacích děr – průměr (0 = uprostřed volného pásu mezi nábojem a věncem) */
export const holesPcd = (o: BodyOpts, rootR: number, m: number) => {
  if (o.holesPcd > 0) return o.holesPcd;
  const [lo, hi] = holesBand(o, rootR, m);
  return lo + hi;
};
/** vnější poloměr vybrání stojiny (věnec 3·m pod patou zubu) */
export const webOuterR = (rootR: number, m: number) => rootR - 3 * m;
export const hasWeb = (o: BodyOpts) => o.webT > 0 && o.webT < o.b - 1e-9;

/**
 * Kontrola těla kola. `rootR` = patní poloměr (vnější mez pro díru, náboj a díry), `m` = modul (měřítko mezí),
 * `tipR` = hlavový poloměr (sražení).
 */
export function bodyIssues(o: BodyOpts, g: { rootR: number; tipR: number; m: number }): Issue[] {
  const out: Issue[] = [];
  const err = (key: string, code: string, text: string) => out.push({ level: "error", code, key, text });
  const warn = (key: string, code: string, text: string) => out.push({ level: "warn", code, key, text });
  if (!(o.b > 0)) err("b", "b", tr("Šířka kola musí být kladná."));
  const reach = boreReach(o);
  if (o.bore > 0) {
    if (reach >= g.rootR - 0.25 * g.m) err("bore", "bore-root", tr("Díra Ø{0} (s drážkou) zasahuje do ozubení – patní průměr je Ø{1}. Zmenšete díru, nebo zvětšete kolo.", fmt(o.bore), fmt(2 * g.rootR)));
    else if (g.rootR - reach < 1.5 * g.m) warn("bore", "bore-rim", tr("Pod patou zubu zbývá nad dírou jen {0} mm materiálu – věnec bývá aspoň 2·m.", fmt(g.rootR - reach, 2)));
  } else if (o.keyway) warn("keyway", "key-nobore", tr("Drážka pro pero se bez díry nevytvoří – zadejte průměr díry."));
  if ((o.hubD > 0) !== (o.hubL > 0)) err(o.hubD > 0 ? "hubL" : "hubD", "hub-half", tr("Náboj potřebuje průměr i délku – doplňte obojí, nebo obojí nechte nulové."));
  if (hasHub(o)) {
    if (o.hubD / 2 <= reach + 0.5) err("hubD", "hub-bore", tr("Náboj Ø{0} musí být větší než díra s drážkou (Ø{1}).", fmt(o.hubD), fmt(2 * reach, 1)));
    if (o.hubD / 2 >= g.rootR - g.m) err("hubD", "hub-root", tr("Náboj Ø{0} je příliš velký – musí být menší než patní průměr zmenšený o 2·m (Ø{1}).", fmt(o.hubD), fmt(2 * (g.rootR - g.m), 2)));
  }
  if (o.setScrew && !hasHub(o)) err("setScrew", "screw-hub", tr("Stavěcí šroub potřebuje náboj – zadejte průměr a délku náboje."));
  if (o.setScrew && hasHub(o) && SET_SCREWS[o.setScrew] > 0.6 * o.hubL) err("setScrew", "screw-len", tr("Stavěcí šroub {0} se do náboje délky {1} mm nevejde.", o.setScrew, fmt(o.hubL)));
  if (o.holesN > 0) {
    if (!(o.holesD > 0)) err("holesD", "holes-d", tr("Zadejte průměr odlehčovacích děr."));
    else {
      const pr = holesPcd(o, g.rootR, g.m) / 2;
      const [lo, hi] = holesBand(o, g.rootR, g.m);
      if (pr - o.holesD / 2 < lo || pr + o.holesD / 2 > hi) err(o.holesPcd > 0 ? "holesPcd" : "holesD", "holes-fit", tr("Odlehčovací díry Ø{0} na roztečné Ø{1} se nevejdou mezi náboj a věnec (volný pás je Ø{2} až Ø{3}).", fmt(o.holesD), fmt(2 * pr, 1), fmt(2 * lo, 1), fmt(2 * hi, 1)));
      else if (o.holesN * o.holesD > 0.92 * Math.PI * 2 * pr) err("holesN", "holes-overlap", tr("Odlehčovací díry se na roztečné kružnici překrývají – uberte počet nebo průměr."));
    }
  }
  if (o.webT > 0) {
    if (o.webT >= o.b) warn("webT", "web-full", tr("Stojina tloušťky {0} mm není tenčí než kolo – vybrání se nevytvoří.", fmt(o.webT)));
    else if (webOuterR(g.rootR, g.m) - innerR(o) < 1) err("webT", "web-fit", tr("Vybrání stojiny se nevejde mezi náboj a věnec – zmenšete náboj nebo stojinu zrušte."));
  }
  if (o.chamfer > 0 && o.chamfer > Math.min(o.b / 2 - 1e-6, g.tipR - g.rootR)) err("chamfer", "chamfer", tr("Sražení {0} mm je větší než výška zubu nebo polovina šířky kola.", fmt(o.chamfer)));
  return out;
}

/** vyčistí lomenou čáru: bez opakovaných bodů a bez bodů ležících na přímce mezi sousedy */
export function cleanPoly(pts: Vec2[]): Vec2[] {
  const out: Vec2[] = [];
  for (const p of pts) {
    const q = out[out.length - 1];
    if (q && Math.hypot(p[0] - q[0], p[1] - q[1]) < 1e-9) continue;
    out.push(p);
  }
  if (out.length > 1 && Math.hypot(out[0][0] - out[out.length - 1][0], out[0][1] - out[out.length - 1][1]) < 1e-9) out.pop();
  let changed = true;
  while (changed && out.length > 3) {
    changed = false;
    for (let i = 0; i < out.length; i++) {
      const a = out[(i - 1 + out.length) % out.length];
      const b = out[i];
      const c = out[(i + 1) % out.length];
      const cr = (b[0] - a[0]) * (c[1] - b[1]) - (b[1] - a[1]) * (c[0] - b[0]);
      const dt = (b[0] - a[0]) * (c[0] - b[0]) + (b[1] - a[1]) * (c[1] - b[1]);
      if (Math.abs(cr) < 1e-12 * Math.max(1, Math.abs(dt)) && dt > 0) {
        out.splice(i, 1);
        changed = true;
        break;
      }
    }
  }
  return out;
}

/**
 * Poloviční řez (r, z) soustruženého polotovaru kotoučového kola: disk Ø 2·tipR × b (z ∈ [0, b]), sražení, vybrání stojiny,
 * náboj(e). Proti směru hodin v rovině (r, z), začíná na ose dole. Bez díry (tu řeže jádro i s drážkou).
 */
export function discSection(o: BodyOpts, g: { tipR: number; rootR: number; m: number }): Vec2[] {
  const hub = hasHub(o);
  const hr = hub ? o.hubD / 2 : 0;
  const zb = hub && o.hubSide !== "top" ? -o.hubL : 0;
  const zt = hub && o.hubSide !== "bottom" ? o.b + o.hubL : o.b;
  const web = hasWeb(o);
  const rec = web ? (o.b - o.webT) / 2 : 0;
  const wi = innerR(o);
  const wo = webOuterR(g.rootR, g.m);
  const c = Math.min(o.chamfer, o.b / 2);
  // vybrání stojiny až k ose (bez náboje a díry): řez začíná a končí na ose v hloubce vybrání
  const toAxis = web && wi <= 1e-9;
  const pts: Vec2[] = toAxis ? [[0, rec]] : [[0, zb]];
  if (zb < 0) pts.push([hr, zb], [hr, 0]);
  if (web) pts.push(...(toAxis ? [] : ([[wi, 0], [wi, rec]] as Vec2[])), [wo, rec], [wo, 0]);
  pts.push([g.tipR - c, 0], [g.tipR, c], [g.tipR, o.b - c], [g.tipR - c, o.b]);
  if (web) pts.push([wo, o.b], [wo, o.b - rec], ...(toAxis ? [] : ([[wi, o.b - rec], [wi, o.b]] as Vec2[])));
  if (zt > o.b) pts.push([hr, o.b], [hr, zt]);
  pts.push(toAxis ? [0, o.b - rec] : [0, zt]);
  return cleanPoly(pts);
}
/** objem rotačního tělesa z polovičního řezu (Pappus: V = 2π·∮ … = π·Σ (r_i² + r_i·r_j + r_j²)(z_j − z_i)/3) */
export function revolveVolume(sec: Vec2[]): number {
  let v = 0;
  for (let i = 0; i < sec.length; i++) {
    const [r0, z0] = sec[i];
    const [r1, z1] = sec[(i + 1) % sec.length];
    v += ((r0 * r0 + r0 * r1 + r1 * r1) * (z1 - z0)) / 3;
  }
  return Math.abs(Math.PI * v);
}

/** Obrys díry s drážkou pro pero (drážka na +Y), proti směru hodin; bez drážky null (díra je kružnice). */
export function boreContour(o: BodyOpts): Seg2[] | null {
  const k = keyOf(o);
  if (!(k.b > 0)) return null;
  const R = o.bore / 2;
  const w = k.b / 2;
  const a = Math.asin(Math.min(1, w / R)); // polovina úhlu, který drážka vytne z kružnice
  const top = R + k.t2;
  const y0 = R * Math.cos(a);
  return [
    { t: "arc", c: [0, 0], r: R, a0: Math.PI / 2 + a, a1: Math.PI / 2 - a + 2 * Math.PI, ccw: true },
    { t: "line", a: [w, y0], b: [w, top] },
    { t: "line", a: [w, top], b: [-w, top] },
    { t: "line", a: [-w, top], b: [-w, y0] },
  ];
}
/** plocha díry s drážkou */
export function boreArea(o: BodyOpts): number {
  if (!(o.bore > 0)) return 0;
  const k = keyOf(o);
  const R = o.bore / 2;
  if (!(k.b > 0)) return Math.PI * R * R;
  const w = k.b / 2;
  const a = Math.asin(Math.min(1, w / R));
  // kruh + obdélník drážky nad tětivou − kruhová úseč pod tětivou, kterou obdélník překrývá
  const y0 = R * Math.cos(a);
  return Math.PI * R * R + k.b * (R + k.t2 - y0) - (R * R * a - w * y0);
}

/** výchozí hodnoty z řádků (bez řádků druhu „point“ – odkaz se ukládá až když ho uživatel vybere) */
export function defaultsOf(rows: GearRow[]): GearData {
  const out: GearData = {};
  for (const r of rows) if (r.kind !== "point") out[r.key] = typeof r.def === "object" ? JSON.parse(JSON.stringify(r.def)) : r.def;
  return out;
}
/** obecné meze řádků (min / max, celé číslo) → hlášky u řádku */
export function rangeIssues(rows: GearRow[], d: GearData): Issue[] {
  const out: Issue[] = [];
  for (const r of rows) {
    if (r.kind !== "number" && r.kind !== "int") continue;
    if (r.when && !r.when(d)) continue;
    const raw = d[r.key];
    const v = num(raw, NaN);
    if (!Number.isFinite(v)) {
      out.push({ level: "error", code: "nan", key: r.key, text: tr("{0}: zadejte číslo.", r.label) });
      continue;
    }
    if (r.kind === "int" && Math.abs(v - Math.round(v)) > 1e-9) out.push({ level: "error", code: "int", key: r.key, text: tr("{0}: musí být celé číslo.", r.label) });
    if (r.min !== undefined && v < r.min) out.push({ level: "error", code: "min", key: r.key, text: tr("{0}: nejmenší hodnota je {1}.", r.label, fmt(r.min)) });
    if (r.max !== undefined && v > r.max) out.push({ level: "error", code: "max", key: r.key, text: tr("{0}: největší hodnota je {1}.", r.label, fmt(r.max)) });
  }
  return out;
}
export const validation = (issues: Issue[]) => ({ ok: !issues.some((x) => x.level === "error"), issues });
