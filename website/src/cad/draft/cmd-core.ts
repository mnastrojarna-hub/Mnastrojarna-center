/**
 * Příkazy jádra 2D výkresu: smazat, výběr, hladiny, typy čar, měřítko čar, tloušťky, vlastnosti, geometrie entity,
 * proměnné výkresu, jednotky, dotazy (vzdálenost, plocha, souřadnice, výpis), stav, zoom, nápověda.
 */
import { tr } from "../i18n";
import { colorLabel, parseColor } from "./colors";
import { cmdName, commands, findCommand, registerCommand, type CmdCtx, type CmdGen } from "./commands";
import { angleOf, deg, dist, polyArea, sub } from "./geom";
import { kindOf } from "./kinds";
import { createLayer, deleteLayer, findLayer, layerUse, linetypeUsed, ltLabel, lwLabel, renameLayer, setCurrentLayer, setLayer, type LayerPatch } from "./layers";
import { findLinetype, linetypeLibrary, loadLinetype } from "./linetypes";
import { snapLineweight, spaceEntities, type DraftColor, type DraftEntity, type DraftLw, type DraftVars, type Vec2 } from "./model";
import { isSelectionWord, parseSelection } from "./select";
import { setSelection } from "./session";
import { spatialIndex } from "./spatial";
import { draftStatus, draftStatusText, extents } from "./status";
import { evalNumber, normDeg, parseUnits, unitsLabel } from "./units";

const fold = (s: string) => s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/ß/g, "ss").replace(/[-_]/g, "");
const isW = (t: string | undefined, ...w: string[]) => t !== undefined && w.includes(fold(t));
const list = (c: CmdCtx) => spaceEntities(c.tx.model, c.session.space) ?? c.tx.model.entities;
const posNum = (t: string | undefined, what: string) => {
  const v = evalNumber(t ?? "", true);
  if (!(v > 0)) throw new Error(tr("{0}: očekávám kladné číslo, ne „{1}“", what, t ?? ""));
  return v;
};

/** tloušťka čáry ze zadání (mm, ByLayer, ByBlock, Default) */
export function parseLw(t: string | undefined): DraftLw {
  const f = fold(t ?? "");
  if (["bylayer", "dlehladiny", "vonlayer", "layer"].includes(f)) return "ByLayer";
  if (["byblock", "dlebloku", "vonblock", "block"].includes(f)) return "ByBlock";
  if (["default", "vychozi", "vorgabe", "standard"].includes(f)) return "Default";
  const v = evalNumber((t ?? "").replace(/mm$/i, ""), true);
  if (!Number.isFinite(v) || v < 0 || v > 2.11) throw new Error(tr("tloušťka čáry: 0–2,11 mm, ByLayer, ByBlock nebo Default – ne „{0}“", t ?? ""));
  return snapLineweight(v);
}
function colorOf(t: string | undefined): DraftColor {
  const c = parseColor(t ?? "");
  if (c === null) throw new Error(tr("neplatná barva „{0}“ – číslo ACI 1–255, název (červená…), #rrggbb, r,g,b, ByLayer, ByBlock", t ?? ""));
  return c;
}

// ---------------------------------------------------------------- SMAZAT

registerCommand({
  id: "ERASE",
  names: { cs: ["smazat", "vymazat"], en: ["erase", "delete"], de: ["löschen", "loeschen"] },
  alias: ["E"],
  group: "modify",
  pickfirst: true,
  desc: () => tr("smaže vybrané entity (výběr: e3 e5, vše, okno, křížení, hladina, typ…; zamčené hladiny se přeskočí)"),
  usage: () => tr("smazat e3 e5 | smazat hladina OSY | smazat okno 0,0 100,100 | smazat vše"),
  run: function* (c): CmdGen {
    const s = yield { k: "select", msg: tr("Vyberte objekty") };
    if (s.k !== "sel" || !s.ids.length) return c.log(tr("nic nevybráno"));
    let n = 0;
    const locked: string[] = [];
    for (const id of s.ids) {
      const e = c.tx.get(id);
      if (!e) continue;
      if (findLayer(c.tx.model, e.layer)?.locked) {
        locked.push(id);
        continue;
      }
      c.tx.remove(id);
      n++;
    }
    setSelection(c.session, c.session.sel.filter((id) => !s.ids.includes(id) || locked.includes(id)));
    c.log(tr("✓ smazáno entit: {0}", n));
    if (locked.length) c.log(tr("⚠ na zamčené hladině (nesmazáno): {0}", locked.join(", ")));
  },
});

// ---------------------------------------------------------------- VÝBĚR

registerCommand({
  id: "SELECT",
  names: { cs: ["vyber", "vybrat", "výběr"], en: ["select"], de: ["wählen", "waehlen", "auswahl"] },
  group: "util",
  readonly: true,
  desc: () => tr("nastaví výběr: e3 e5, vše, poslední (naposledy vytvořené), předchozí, okno x,y x,y, křížení x,y x,y, hladina X, typ line, barva 1, odebrat …, přidat …, nic"),
  usage: () => tr("vyber hladina OSY typ circle | vyber okno 0,0 100,50 | vyber výběr odebrat e3 | vyber nic"),
  run: function* (c): CmdGen {
    const s = yield { k: "select", msg: tr("Vyberte objekty") };
    if (s.k !== "sel") return;
    setSelection(c.session, s.ids);
    c.out("selection", s.ids);
    c.log(tr("✓ vybráno: {0}{1}", s.ids.length, s.ids.length ? ` (${s.ids.slice(0, 40).join(", ")}${s.ids.length > 40 ? " …" : ""})` : ""));
  },
});

// ---------------------------------------------------------------- HLADINY

const LP: Record<string, string[]> = {
  color: ["barva", "color", "colour", "farbe", "c"],
  linetype: ["typcary", "typ", "linetype", "lt", "linientyp", "ltype"],
  lineweight: ["tloustka", "lineweight", "lw", "linienstarke", "linienstaerke", "lweight"],
  on: ["zapnout", "zap", "on", "ein"],
  off: ["vypnout", "vyp", "off", "aus"],
  freeze: ["zmrazit", "freeze", "frieren", "einfrieren"],
  thaw: ["rozmrazit", "thaw", "tauen", "auftauen"],
  lock: ["zamknout", "lock", "sperren"],
  unlock: ["odemknout", "unlock", "entsperren"],
  plot: ["tisk", "tisknout", "plot", "plotten"],
  noplot: ["netisk", "netisknout", "noplot", "nichtplotten"],
  desc: ["popis", "description", "desc", "beschreibung"],
  transparency: ["pruhlednost", "transparency", "transparenz"],
};
const lpKey = (t: string) => (Object.keys(LP) as (keyof typeof LP)[]).find((k) => LP[k].includes(fold(t))) ?? null;

/** vlastnosti hladiny ze slov: barva 1 typčáry CENTER tloušťka 0.35 vypnout zmrazit zamknout netisk popis "…" */
function layerProps(args: string[], from: number): LayerPatch {
  const p: LayerPatch = {};
  for (let i = from; i < args.length; i++) {
    const k = lpKey(args[i]);
    if (!k) throw new Error(tr("neznámá vlastnost hladiny „{0}“ – barva, typčáry, tloušťka, zapnout, vypnout, zmrazit, rozmrazit, zamknout, odemknout, tisk, netisk, popis", args[i]));
    if (k === "color") {
      const c = colorOf(args[++i]);
      if (c === "ByLayer" || c === "ByBlock") throw new Error(tr("barva hladiny musí být ACI 1–255 nebo #rrggbb"));
      p.color = c;
    } else if (k === "linetype") p.linetype = args[++i] ?? "";
    else if (k === "lineweight") {
      const w = parseLw(args[++i]);
      if (w === "ByLayer" || w === "ByBlock") throw new Error(tr("tloušťka čáry hladiny: 0–2,11 mm nebo Default"));
      p.lineweight = w;
    } else if (k === "on") p.on = true;
    else if (k === "off") p.on = false;
    else if (k === "freeze") p.frozen = true;
    else if (k === "thaw") p.frozen = false;
    else if (k === "lock") p.locked = true;
    else if (k === "unlock") p.locked = false;
    else if (k === "plot") p.plot = true;
    else if (k === "noplot") p.plot = false;
    else if (k === "desc") p.desc = args[++i] ?? "";
    else if (k === "transparency") {
      const v = evalNumber(args[++i] ?? "", true);
      if (!(v >= 0 && v <= 90)) throw new Error(tr("průhlednost 0–90 %"));
      p.transparency = v;
    }
  }
  return p;
}

const describeLayer = (c: CmdCtx, name: string) => {
  const l = findLayer(c.tx.model, name)!;
  return `${l.name}: ${tr("barva")} ${colorLabel(l.color)}, ${l.linetype}, ${lwLabel(l.lineweight)}${l.on ? "" : `, ${tr("vypnutá")}`}${l.frozen ? `, ${tr("zmrazená")}` : ""}${l.locked ? `, ${tr("zamčená")}` : ""}${l.plot ? "" : `, ${tr("netiskne")}`}`;
};

registerCommand({
  id: "LAYER",
  names: { cs: ["hladina", "hladiny"], en: ["layer", "layers"], de: ["ebene", "ebenen", "layer2"] },
  alias: ["LA", "-LA", "-LAYER"],
  group: "layer",
  desc: () => tr("hladiny: nová / vytvořit (+ aktuální) / aktuální / smazat [přesunout-na X | i-s-entitami] / přejmenovat / vlastnosti (barva, typčáry, tloušťka, zapnout, vypnout, zmrazit, rozmrazit, zamknout, odemknout, tisk, netisk, popis); * = všechny hladiny; bez argumentu = seznam (v GUI správce hladin)"),
  usage: () => tr("hladina nová OSY barva 1 typčáry CENTER tloušťka 0.25 | hladina aktuální OSY | hladina OSY vypnout | hladina přejmenovat OSY Osy | hladina smazat OSY přesunout-na 0"),
  line: (c, a) => {
    const sub0 = a[0];
    if (!sub0 || isW(sub0, "seznam", "list", "liste", "?")) {
      if (!sub0 && c.ui?.openPanel) c.ui.openPanel("layers");
      const st = draftStatus(c.tx.model, c.session);
      c.out("layers", st.layers);
      for (const l of st.layers) c.log(`${l.current ? "✓" : "·"} ${describeLayer(c, l.name)} · ${tr("entit")} ${l.count}`);
      return;
    }
    if (isW(sub0, "nova", "novou", "new", "neu", "vytvorit", "make", "erstellen", "n", "m")) {
      const name = a[1];
      if (!name) throw new Error(tr("chybí název hladiny"));
      const make = isW(sub0, "vytvorit", "make", "erstellen", "m");
      if (make && findLayer(c.tx.model, name)) c.tx.setModel((m) => setLayer(m, name, layerProps(a, 2)));
      else c.tx.setModel((m) => createLayer(m, name, layerProps(a, 2)));
      if (make) c.tx.setModel((m) => setCurrentLayer(m, name));
      c.log(tr("✓ hladina {0}{1}", describeLayer(c, name), make ? tr(" – aktuální") : ""));
      c.out("layer", findLayer(c.tx.model, name));
      return;
    }
    if (isW(sub0, "aktualni", "current", "aktuell", "set", "cur", "nastavit")) {
      const name = a[1];
      if (!name) throw new Error(tr("chybí název hladiny"));
      c.tx.setModel((m) => setCurrentLayer(m, name));
      c.log(tr("✓ aktuální hladina: {0}", c.tx.vars.clayer));
      return;
    }
    if (isW(sub0, "smazat", "delete", "del", "loschen", "loeschen")) {
      const name = a[1];
      if (!name) throw new Error(tr("chybí název hladiny"));
      let moveTo: string | undefined;
      let purge = false;
      for (let i = 2; i < a.length; i++) {
        if (isW(a[i], "presunoutna", "moveto", "verschiebennach", "na", "to", "nach")) moveTo = a[++i];
        else if (isW(a[i], "isentitami", "purge", "mitobjekten", "sentitami")) purge = true;
      }
      const n = layerUse(c.tx.model, findLayer(c.tx.model, name)?.name ?? name);
      c.tx.setModel((m) => deleteLayer(m, name, { moveTo, purge }));
      c.log(tr("✓ hladina {0} smazána{1}", name, n ? (moveTo ? tr(" – {0} entit přesunuto na {1}", n, moveTo) : tr(" – smazáno i {0} entit", n)) : ""));
      return;
    }
    if (isW(sub0, "prejmenovat", "rename", "umbenennen")) {
      if (!a[1] || !a[2]) throw new Error(tr("přejmenovat: hladina přejmenovat STARÝ NOVÝ"));
      c.tx.setModel((m) => renameLayer(m, a[1], a[2]));
      c.log(tr("✓ hladina {0} → {1}", a[1], a[2]));
      return;
    }
    // vlastnosti existující hladiny (nebo * = všech)
    const targets = a[0] === "*" ? c.tx.model.layers.map((l) => l.name) : [a[0]];
    const p = layerProps(a, 1);
    if (!Object.keys(p).length) {
      const l = findLayer(c.tx.model, a[0]);
      if (!l) throw new Error(tr("hladina „{0}“ neexistuje – hladiny: {1}", a[0], c.tx.model.layers.map((x) => x.name).join(", ")));
      c.out("layer", l);
      c.log(describeLayer(c, l.name));
      return;
    }
    for (const t of targets) {
      // u * se aktuální hladina nezmrazí (přeskočí se)
      if (a[0] === "*" && p.frozen && t === c.tx.vars.clayer) continue;
      c.tx.setModel((m) => setLayer(m, t, p));
      c.log(`✓ ${describeLayer(c, t)}`);
    }
    if (p.on === false && targets.some((t) => findLayer(c.tx.model, t)?.name === c.tx.vars.clayer)) c.log(tr("⚠ aktuální hladina je vypnutá – nové entity nebudou vidět"));
  },
});

registerCommand({
  id: "LAYMCUR",
  names: { cs: ["hladinaobjektu", "hladina-objektu"], en: ["laymcur"], de: ["ebeneaktobj"] },
  group: "layer",
  desc: () => tr("nastaví aktuální hladinu podle vybrané entity"),
  usage: () => tr("hladinaobjektu e3"),
  run: function* (c): CmdGen {
    const e = yield { k: "entity", msg: tr("Vyberte objekt, jehož hladina bude aktuální") };
    if (e.k !== "ent") return;
    const ent = c.tx.get(e.id)!;
    c.tx.setModel((m) => setCurrentLayer(m, ent.layer));
    c.log(tr("✓ aktuální hladina: {0}", ent.layer));
  },
});

// ---------------------------------------------------------------- TYPY ČAR, MĚŘÍTKO, TLOUŠŤKY

registerCommand({
  id: "LINETYPE",
  names: { cs: ["typčáry", "typcary", "typy-čar"], en: ["linetype"], de: ["linientyp"] },
  alias: ["LT", "-LT", "-LINETYPE"],
  group: "layer",
  desc: () => tr("typy čar: načíst z knihovny (BORDER, CENTER, DASHDOT, DASHED, DIVIDE, DOT, HIDDEN, PHANTOM + varianty 2 a X2; vše), aktuální typ nových entit, smazat nepoužitý, seznam"),
  usage: () => tr("typčáry načíst CENTER2 HIDDENX2 | typčáry načíst vše | typčáry aktuální DASHED | typčáry smazat DOT | typčáry seznam"),
  line: (c, a) => {
    const s0 = a[0];
    if (!s0 || isW(s0, "seznam", "list", "liste", "?")) {
      const lib = linetypeLibrary(c.tx.vars.measurement === 1);
      c.out("linetypes", c.tx.model.linetypes);
      c.out("library", lib.map((l) => l.name));
      for (const l of c.tx.model.linetypes) c.log(`${l.name} — ${l.desc}${l.pattern.length ? ` [${l.pattern.join(", ")}]` : ""}`);
      return;
    }
    if (isW(s0, "nacist", "load", "laden")) {
      const names = isW(a[1], "vse", "all", "alles", "*") ? linetypeLibrary(c.tx.vars.measurement === 1).map((l) => l.name) : a.slice(1);
      if (!names.length) throw new Error(tr("chybí název typu čáry"));
      for (const n of names) {
        let found = false;
        c.tx.setModel((m) => {
          const [m2, lt] = loadLinetype(m, n);
          found = !!lt;
          return m2;
        });
        if (!found) throw new Error(tr("typ čáry „{0}“ v knihovně není – knihovna: {1}", n, linetypeLibrary().map((l) => l.name).join(", ")));
      }
      c.log(tr("✓ načteno: {0}", names.join(", ")));
      return;
    }
    if (isW(s0, "aktualni", "current", "aktuell", "set")) {
      const n = c.tx.linetype(a[1] ?? "");
      c.tx.setVars({ celtype: n });
      c.log(tr("✓ aktuální typ čáry: {0}", ltLabel(n)));
      return;
    }
    if (isW(s0, "smazat", "delete", "loschen", "loeschen", "purge")) {
      const lt = findLinetype(c.tx.model, a[1] ?? "");
      if (!lt) throw new Error(tr("typ čáry „{0}“ ve výkresu není", a[1] ?? ""));
      if (/^continuous$/i.test(lt.name)) throw new Error(tr("typ Continuous nelze smazat"));
      if (linetypeUsed(c.tx.model, lt.name) || c.tx.vars.celtype.toLowerCase() === lt.name.toLowerCase()) throw new Error(tr("typ čáry {0} se používá – nelze smazat", lt.name));
      c.tx.setModel((m) => ({ ...m, linetypes: m.linetypes.filter((x) => x !== lt) }));
      c.log(tr("✓ typ čáry {0} smazán", lt.name));
      return;
    }
    throw new Error(tr("typčáry: načíst | aktuální | smazat | seznam"));
  },
});

registerCommand({
  id: "LTSCALE",
  names: { cs: ["měřítkočar", "meritkocar", "měřítko-čar"], en: ["ltscale"], de: ["ltfaktor"] },
  alias: ["LTS"],
  group: "layer",
  desc: () => tr("globální měřítko typů čar (LTSCALE) – délky čárek a mezer se násobí"),
  usage: () => tr("měřítkočar 0.5"),
  line: (c, a) => {
    if (!a[0]) {
      c.out("ltscale", c.tx.vars.ltscale);
      return c.log(`LTSCALE = ${c.tx.vars.ltscale}`);
    }
    c.tx.setVars({ ltscale: posNum(a[0], "LTSCALE") });
    c.log(`✓ LTSCALE = ${c.tx.vars.ltscale}`);
  },
});

registerCommand({
  id: "LWDISPLAY",
  names: { cs: ["tloušťky", "tloustky", "zobrazit-tloušťky"], en: ["lwdisplay"], de: ["lstärke", "lstaerke", "lwanzeige"] },
  alias: ["LWT"],
  group: "layer",
  desc: () => tr("zobrazení tlouštěk čar zapnout / vypnout (bez argumentu přepne)"),
  usage: () => tr("tloušťky zap | tloušťky vyp"),
  line: (c, a) => {
    const v = a[0] ? isW(a[0], "zap", "zapnout", "on", "ein", "1", "ano", "yes") : !c.tx.vars.lwdisplay;
    c.tx.setVars({ lwdisplay: v });
    c.log(v ? tr("✓ tloušťky čar se zobrazují") : tr("✓ tloušťky čar se nezobrazují"));
  },
});

// ---------------------------------------------------------------- VLASTNOSTI

const PK: Record<string, string[]> = {
  layer: ["hladina", "layer", "ebene", "la"],
  color: ["barva", "color", "colour", "farbe"],
  linetype: ["typcary", "linetype", "lt", "linientyp"],
  lineweight: ["tloustka", "lineweight", "lw", "linienstarke", "linienstaerke"],
  ltscale: ["meritkocary", "ltscale", "celtscale", "ltfaktor", "lts"],
  transparency: ["pruhlednost", "transparency", "transparenz"],
};
const pkKey = (t: string) => (Object.keys(PK) as (keyof typeof PK)[]).find((k) => PK[k].includes(fold(t))) ?? null;

/** výběr na začátku argumentů: id (e3 e5 / e3,e5), vše, poslední, předchozí, výběr; jinak aktuální výběr */
function leadingSelection(c: CmdCtx, a: string[], stopAt: (t: string) => boolean): { ids: string[]; next: number } {
  let i = 0;
  while (i < a.length && !stopAt(a[i]) && isSelectionWord(a[i])) i++;
  if (!i) return { ids: c.session.sel.filter((id) => c.tx.get(id)), next: 0 };
  const m = c.tx.model;
  const l = list(c);
  const r = parseSelection(a.slice(0, i), 0, { model: m, list: l, idx: spatialIndex(l, { model: m }), session: c.session, parsePoint: (t) => c.parsePoint(t) });
  return { ids: r.ids, next: i };
}

registerCommand({
  id: "PROPERTIES",
  names: { cs: ["vlastnosti", "změnit-vlastnosti"], en: ["properties", "chprop", "change"], de: ["eigenschaften", "eigändr"] },
  alias: ["PR", "CH", "-CH"],
  group: "modify",
  desc: () => tr("změní vlastnosti entit (výběr na začátku: e3 e5 / vše / poslední / výběr; jinak aktuální výběr): hladina, barva, typčáry, tloušťka, měřítkočáry, průhlednost; bez vlastností = výpis"),
  usage: () => tr("vlastnosti e3 e5 hladina OSY barva 1 typčáry DASHED tloušťka 0.5 | vlastnosti barva ByLayer (vybrané)"),
  line: (c, a) => {
    const { ids, next } = leadingSelection(c, a, (t) => pkKey(t) !== null);
    if (!ids.length) throw new Error(tr("nic není vybráno – zadejte e3 e5 / vše nebo nejdřív „2d vyber …“"));
    const patch: Partial<DraftEntity> = {};
    const unset: string[] = [];
    let layer: string | null = null;
    for (let i = next; i < a.length; i++) {
      const k = pkKey(a[i]);
      const v = a[i + 1];
      if (!k) throw new Error(tr("neznámá vlastnost „{0}“ – hladina, barva, typčáry, tloušťka, měřítkočáry, průhlednost", a[i]));
      if (v === undefined) throw new Error(tr("chybí hodnota vlastnosti {0}", a[i]));
      i++;
      if (k === "layer") {
        const l = findLayer(c.tx.model, v);
        if (!l) throw new Error(tr("hladina „{0}“ neexistuje – hladiny: {1}", v, c.tx.model.layers.map((x) => x.name).join(", ")));
        layer = l.name;
      } else if (k === "color") {
        const col = colorOf(v);
        if (col === "ByLayer") unset.push("color");
        else patch.color = col;
      } else if (k === "linetype") {
        const n = c.tx.linetype(v);
        if (n === "ByLayer") unset.push("linetype");
        else patch.linetype = n;
      } else if (k === "lineweight") {
        const w = parseLw(v);
        if (w === "ByLayer") unset.push("lineweight");
        else patch.lineweight = w;
      } else if (k === "ltscale") {
        const s = posNum(v, tr("měřítko čáry"));
        if (s === 1) unset.push("ltscale");
        else patch.ltscale = s;
      } else if (k === "transparency") {
        const t = evalNumber(v, true);
        if (!(t >= 0 && t <= 90)) throw new Error(tr("průhlednost 0–90 %"));
        patch.transparency = t;
      }
    }
    if (!layer && !Object.keys(patch).length && !unset.length) {
      // výpis společných vlastností
      for (const id of ids) {
        const e = c.tx.get(id);
        if (e) c.log(`${id} ${kindOf(e)?.label() ?? e.type}: ${tr("hladina")} ${e.layer}, ${tr("barva")} ${colorLabel(e.color)}, ${ltLabel(e.linetype)}, ${lwLabel(e.lineweight)}`);
      }
      return;
    }
    let n = 0;
    const skipped: string[] = [];
    for (const id of ids) {
      const e = c.tx.get(id);
      if (!e) continue;
      if (findLayer(c.tx.model, e.layer)?.locked) {
        skipped.push(id);
        continue;
      }
      const ne = { ...e, ...patch, ...(layer ? { layer } : {}) } as DraftEntity & Record<string, unknown>;
      for (const u of unset) delete ne[u];
      c.tx.put(ne as DraftEntity);
      n++;
    }
    c.log(tr("✓ změněno entit: {0}", n));
    if (skipped.length) c.log(tr("⚠ na zamčené hladině (beze změny): {0}", skipped.join(", ")));
  },
});

registerCommand({
  id: "SETGEOM",
  names: { cs: ["nastavit", "geometrie"], en: ["set", "setgeom"], de: ["setzen", "geometrie2"] },
  group: "modify",
  desc: () => tr("změní geometrii entity jako panel vlastností: klíč hodnota nebo klíč=hodnota (úsečka a b length angle; kružnice c r d area; oblouk c r a0 a1; křivka closed width v1… b1…; elipsa c a b rot t0 t1; text s p h rot style halign valign wf oblique; bod p; přímka p angle)"),
  usage: () => tr("nastavit e3 r 25 c 10,10 | nastavit e7 s \"Nový text\" h 5 | nastavit e2 length=120"),
  line: (c, a) => {
    const { ids, next } = leadingSelection(c, a, () => false);
    if (!ids.length) throw new Error(tr("zadejte entitu (e3) nebo vyberte entity"));
    const pairs: [string, string][] = [];
    for (let i = next; i < a.length; i++) {
      const t = a[i];
      const eq = t.indexOf("=");
      if (eq > 0) pairs.push([t.slice(0, eq), t.slice(eq + 1)]);
      else {
        if (a[i + 1] === undefined) throw new Error(tr("chybí hodnota vlastnosti {0}", t));
        pairs.push([t, a[++i]]);
      }
    }
    if (!pairs.length) {
      for (const id of ids) {
        const e = c.tx.get(id)!;
        const f = kindOf(e)?.fields(e, c.kctx(), c.fmt) ?? [];
        c.out(id, Object.fromEntries(f.map((x) => [x.key, x.value])));
        c.log(`${id}: ${f.map((x) => `${x.key}=${x.value}`).join(" ")}`);
      }
      return;
    }
    for (const id of ids) {
      c.tx.update(id, (e) => {
        let n: DraftEntity = e;
        const k = kindOf(e);
        if (!k) throw new Error(tr("neznámý druh entity {0}", e.type));
        for (const [key, val] of pairs) n = k.setField(n, key, val, c.kctx());
        return n;
      });
    }
    c.log(tr("✓ upraveno: {0}", ids.join(", ")));
  },
});

// ---------------------------------------------------------------- PROMĚNNÉ, JEDNOTKY

type VarSpec = { key: keyof DraftVars; parse: (t: string, c: CmdCtx) => unknown };
const VARS: Record<string, VarSpec> = {
  clayer: { key: "clayer", parse: (t, c) => (c.tx.setModel((m) => setCurrentLayer(m, t)), c.tx.vars.clayer) },
  cecolor: { key: "cecolor", parse: (t) => colorOf(t) },
  celtype: { key: "celtype", parse: (t, c) => c.tx.linetype(t) },
  celweight: { key: "celweight", parse: (t) => parseLw(t) },
  celtscale: { key: "celtscale", parse: (t) => posNum(t, "CELTSCALE") },
  ltscale: { key: "ltscale", parse: (t) => posNum(t, "LTSCALE") },
  textsize: { key: "textsize", parse: (t) => posNum(t, "TEXTSIZE") },
  textstyle: { key: "textstyle", parse: (t, c) => { const s = c.tx.model.textStyles.find((x) => x.name.toLowerCase() === t.toLowerCase()); if (!s) throw new Error(tr("textový styl „{0}“ ve výkresu není", t)); return s.name; } },
  pdmode: { key: "pdmode", parse: (t) => { const v = evalNumber(t); if (![0, 1, 2, 3, 4, 32, 33, 34, 35, 64, 65, 66, 67, 96, 97, 98, 99].includes(v)) throw new Error(tr("PDMODE: 0, 2, 3, 32, 34, 35 …")); return v; } },
  pdsize: { key: "pdsize", parse: (t) => { const v = evalNumber(t, true); if (!Number.isFinite(v)) throw new Error("PDSIZE"); return v; } },
  luprec: { key: "prec", parse: (t) => { const v = evalNumber(t); if (!(Number.isInteger(v) && v >= 0 && v <= 8)) throw new Error(tr("přesnost 0–8")); return v; } },
  auprec: { key: "aprec", parse: (t) => { const v = evalNumber(t); if (!(Number.isInteger(v) && v >= 0 && v <= 8)) throw new Error(tr("přesnost 0–8")); return v; } },
  insunits: { key: "units", parse: (t) => { const u = parseUnits(t); if (!u) throw new Error(tr("jednotky: mm, cm, m, in, ft, km, um, unitless")); return u; } },
  mirrtext: { key: "mirrtext", parse: (t) => (evalNumber(t) ? 1 : 0) },
  lwdisplay: { key: "lwdisplay", parse: (t) => isW(t, "1", "zap", "on", "ein", "ano", "yes", "true") },
  lwdefault: { key: "lwdefault", parse: (t) => { const w = parseLw(t); if (typeof w !== "number") throw new Error("LWDEFAULT"); return w; } },
  gridunit: { key: "grid", parse: (t) => posNum(t, "GRIDUNIT") },
  snapunit: { key: "snap", parse: (t) => posNum(t, "SNAPUNIT") },
  measurement: { key: "measurement", parse: (t) => (evalNumber(t) ? 1 : 0) },
};
registerCommand({
  id: "SETVAR",
  names: { cs: ["proměnná", "promenna"], en: ["setvar"], de: ["variable", "setvar2"] },
  group: "util",
  desc: () => tr("proměnné výkresu (jako AutoCAD): CLAYER, CECOLOR, CELTYPE, CELWEIGHT, CELTSCALE, LTSCALE, TEXTSIZE, TEXTSTYLE, PDMODE, PDSIZE, LUPREC, AUPREC, INSUNITS, MIRRTEXT, LWDISPLAY, LWDEFAULT, GRIDUNIT, SNAPUNIT, MEASUREMENT; bez hodnoty = výpis"),
  usage: () => tr("proměnná cecolor 1 | proměnná pdmode 3 | proměnná luprec 2 | proměnná (výpis všech)"),
  line: (c, a) => {
    if (!a[0]) {
      const v = c.tx.vars;
      c.out("vars", v);
      for (const [n, s] of Object.entries(VARS)) c.log(`${n.toUpperCase()} = ${JSON.stringify(v[s.key])}`);
      return;
    }
    const spec = VARS[fold(a[0])];
    if (!spec) throw new Error(tr("neznámá proměnná „{0}“ – {1}", a[0], Object.keys(VARS).join(", ")));
    if (a[1] === undefined) {
      c.out(a[0].toLowerCase(), c.tx.vars[spec.key]);
      return c.log(`${a[0].toUpperCase()} = ${JSON.stringify(c.tx.vars[spec.key])}`);
    }
    const val = spec.parse(a[1], c);
    c.tx.setVars({ [spec.key]: val } as Partial<DraftVars>);
    c.log(`✓ ${a[0].toUpperCase()} = ${JSON.stringify(val)}`);
  },
});

registerCommand({
  id: "UNITS",
  names: { cs: ["jednotky"], en: ["units"], de: ["einheiten"] },
  alias: ["UN"],
  group: "util",
  desc: () => tr("jednotky výkresu (INSUNITS: mm, cm, m, in, ft…) a přesnost délek / úhlů; geometrie se nepřepočítává"),
  usage: () => tr("jednotky mm přesnost 3 úhly 1"),
  line: (c, a) => {
    if (!a.length) {
      c.out("units", { units: c.tx.vars.units, prec: c.tx.vars.prec, aprec: c.tx.vars.aprec });
      return c.log(tr("jednotky {0}, přesnost {1}, úhly {2}", unitsLabel(c.tx.vars.units), c.tx.vars.prec, c.tx.vars.aprec));
    }
    for (let i = 0; i < a.length; i++) {
      const u = parseUnits(a[i]);
      if (u) c.tx.setVars({ units: u });
      else if (isW(a[i], "presnost", "precision", "genauigkeit", "luprec")) c.tx.setVars({ prec: VARS.luprec.parse(a[++i] ?? "", c) as number });
      else if (isW(a[i], "uhly", "angles", "winkel", "auprec")) c.tx.setVars({ aprec: VARS.auprec.parse(a[++i] ?? "", c) as number });
      else throw new Error(tr("jednotky: mm|cm|m|in|ft… přesnost N úhly N"));
    }
    c.log(tr("✓ jednotky {0}, přesnost {1}, úhly {2}", unitsLabel(c.tx.vars.units), c.tx.vars.prec, c.tx.vars.aprec));
  },
});

// ---------------------------------------------------------------- DOTAZY

registerCommand({
  id: "DIST",
  names: { cs: ["vzdálenost", "vzdalenost"], en: ["dist", "distance"], de: ["abstand"] },
  alias: ["DI"],
  group: "inquiry",
  readonly: true,
  desc: () => tr("vzdálenost dvou bodů, úhel v rovině XY, delta X a Y"),
  usage: () => tr("vzdálenost 0,0 e3.end"),
  run: function* (c): CmdGen {
    const a = yield { k: "point", msg: tr("Zadejte první bod") };
    if (a.k !== "point") return;
    const b = yield { k: "point", msg: tr("Zadejte druhý bod"), base: a.p, preview: (p) => [{ type: "line", a: a.p, b: p }] };
    if (b.k !== "point") return;
    const d = dist(a.p, b.p);
    const ang = normDeg(deg(angleOf(sub(b.p, a.p))));
    const dx = b.p[0] - a.p[0];
    const dy = b.p[1] - a.p[1];
    c.out("distance", d);
    c.out("angle", ang);
    c.out("dx", dx);
    c.out("dy", dy);
    c.log(tr("Vzdálenost = {0}, úhel v XY = {1}, delta X = {2}, delta Y = {3}", c.fmt.len(d), c.fmt.ang(ang), c.fmt.len(dx), c.fmt.len(dy)));
  },
});

registerCommand({
  id: "AREA",
  names: { cs: ["plocha"], en: ["area"], de: ["fläche", "flaeche"] },
  alias: ["AA"],
  group: "inquiry",
  readonly: true,
  desc: () => tr("plocha a obvod: body mnohoúhelníku (Enter uzavře), nebo Objekt (kružnice, uzavřená křivka, elipsa, spline)"),
  usage: () => tr("plocha 0,0 100,0 100,50 0,50 | plocha objekt e3"),
  run: function* (c): CmdGen {
    const OBJ = { id: "object", cs: "Objekt", en: "Object", de: "Objekt" };
    const a = yield { k: "point", msg: tr("Zadejte první roh"), kw: [OBJ] };
    if (a.k === "kw") {
      const e = yield { k: "entity", msg: tr("Vyberte objekt") };
      if (e.k !== "ent") return;
      const ent = c.tx.get(e.id)!;
      const m = kindOf(ent)?.measure?.(ent, c.kctx());
      if (!m || (m.area === undefined && m.length === undefined)) throw new Error(tr("{0} nemá plochu ani délku", e.id));
      if (m.area !== undefined) c.out("area", m.area);
      if (m.length !== undefined) c.out(m.closed ? "perimeter" : "length", m.length);
      c.log(m.area !== undefined ? tr("Plocha = {0}, obvod = {1}", c.fmt.len(m.area), c.fmt.len(m.length ?? 0)) : tr("{0} není uzavřená – délka = {1}", e.id, c.fmt.len(m.length ?? 0)));
      return;
    }
    if (a.k !== "point") return;
    const pts: Vec2[] = [a.p];
    for (;;) {
      const prev = pts[pts.length - 1];
      const b = yield { k: "point", msg: tr("Zadejte další roh (Enter = konec)"), base: prev, none: pts.length >= 3, preview: (p) => [{ type: "polyline", pts: [...pts, p], closed: true }] };
      if (b.k !== "point") break;
      pts.push(b.p);
    }
    const area = Math.abs(polyArea(pts));
    let per = 0;
    for (let i = 0; i < pts.length; i++) per += dist(pts[i], pts[(i + 1) % pts.length]);
    c.out("area", area);
    c.out("perimeter", per);
    c.log(tr("Plocha = {0}, obvod = {1}", c.fmt.len(area), c.fmt.len(per)));
  },
});

registerCommand({
  id: "ID",
  names: { cs: ["souřadnice", "souradnice", "bod-id"], en: ["id"], de: ["koordinaten", "id2"] },
  group: "inquiry",
  readonly: true,
  desc: () => tr("souřadnice bodu (i odkazu na entitu, např. e3.cen, x(e1,e2))"),
  usage: () => tr("souřadnice e3.cen"),
  run: function* (c): CmdGen {
    const a = yield { k: "point", msg: tr("Zadejte bod") };
    if (a.k !== "point") return;
    c.out("point", a.p);
    c.log(`X = ${c.fmt.len(a.p[0])}, Y = ${c.fmt.len(a.p[1])}`);
  },
});

registerCommand({
  id: "LIST",
  names: { cs: ["výpis", "vypis", "info"], en: ["list"], de: ["liste", "auflisten"] },
  alias: ["LI", "LS"],
  group: "inquiry",
  readonly: true,
  pickfirst: true,
  desc: () => tr("výpis entit: druh, id, hladina, barva, typ čáry, tloušťka a geometrie (délka, plocha, body…)"),
  usage: () => tr("výpis e3 e5 | výpis vše"),
  run: function* (c): CmdGen {
    const s = yield { k: "select", msg: tr("Vyberte objekty") };
    if (s.k !== "sel" || !s.ids.length) return c.log(tr("nic nevybráno"));
    const out: Record<string, unknown>[] = [];
    for (const id of s.ids.slice(0, 500)) {
      const e = c.tx.get(id);
      if (!e) continue;
      const k = kindOf(e);
      const rows = k?.info(e, c.kctx(), c.fmt) ?? [];
      c.log(`${k?.label() ?? e.type} ${id} · ${tr("hladina")} ${e.layer} · ${tr("barva")} ${colorLabel(e.color)} · ${ltLabel(e.linetype)} · ${lwLabel(e.lineweight)}${e.ltscale ? ` · LTS ${e.ltscale}` : ""}`);
      for (const [a, b] of rows) c.log(`    ${a}: ${b}`);
      const m = k?.measure?.(e, c.kctx());
      out.push({ id, type: e.type, layer: e.layer, color: e.color ?? "ByLayer", linetype: e.linetype ?? "ByLayer", lineweight: e.lineweight ?? "ByLayer", ...(m ?? {}), geometry: e });
    }
    c.out("entities", out);
  },
});

registerCommand({
  id: "STATUS",
  names: { cs: ["stav"], en: ["status"], de: ["status", "zustand"] },
  group: "inquiry",
  readonly: true,
  desc: () => tr("stav výkresu: jednotky, rozsah, počty entit podle druhu, hladiny (barva, typ, tloušťka, stav, počet entit), výběr"),
  usage: () => tr("stav"),
  line: (c) => {
    c.out("status", draftStatus(c.tx.model, c.session));
    for (const l of draftStatusText(c.tx.model, c.session).split("\n")) c.log(l);
  },
});

registerCommand({
  id: "EXTENTS",
  names: { cs: ["rozsah"], en: ["extents"], de: ["grenzen", "ausdehnung"] },
  group: "inquiry",
  readonly: true,
  desc: () => tr("rozsah kresby (nejmenší a největší souřadnice, šířka × výška)"),
  usage: () => tr("rozsah"),
  line: (c) => {
    const ex = extents(c.tx.model, list(c));
    if (!ex) {
      c.out("extents", null);
      return c.log(tr("výkres je prázdný"));
    }
    c.out("extents", { min: [ex.x0, ex.y0], max: [ex.x1, ex.y1], width: ex.x1 - ex.x0, height: ex.y1 - ex.y0 });
    c.log(tr("Rozsah: {0} – {1} ({2} × {3})", c.fmt.pt([ex.x0, ex.y0]), c.fmt.pt([ex.x1, ex.y1]), c.fmt.len(ex.x1 - ex.x0), c.fmt.len(ex.y1 - ex.y0)));
  },
});

registerCommand({
  id: "ZOOM",
  names: { cs: ["zoom", "přiblížit"], en: ["zoom"], de: ["zoom2", "zoomen"] },
  alias: ["Z"],
  group: "view",
  readonly: true,
  desc: () => tr("pohled: rozsah (vše), okno x,y x,y, střed x,y výška, měřítko k"),
  usage: () => tr("zoom rozsah | zoom okno 0,0 100,100 | zoom střed 50,50 200"),
  line: (c, a) => {
    if (!a[0] || isW(a[0], "rozsah", "extents", "e", "vse", "all", "a", "grenzen", "alles")) c.session.zoom = { kind: "extents" };
    else if (isW(a[0], "okno", "window", "w", "fenster", "f")) {
      const p = c.parsePoint(a[1] ?? "");
      const q = c.parsePoint(a[2] ?? "");
      if (!p || !q) throw new Error(tr("zoom okno x,y x,y"));
      c.session.zoom = { kind: "window", box: { x0: Math.min(p[0], q[0]), y0: Math.min(p[1], q[1]), x1: Math.max(p[0], q[0]), y1: Math.max(p[1], q[1]) } };
    } else if (isW(a[0], "stred", "center", "c", "mitte", "zentrum")) {
      const p = c.parsePoint(a[1] ?? "");
      if (!p) throw new Error(tr("zoom střed x,y výška"));
      c.session.zoom = { kind: "center", c: p, h: posNum(a[2] ?? "100", tr("výška")) };
    } else if (isW(a[0], "meritko", "scale", "s", "faktor")) c.session.zoom = { kind: "scale", k: posNum(a[1], tr("měřítko")) };
    else throw new Error(tr("zoom rozsah | okno x,y x,y | střed x,y výška | měřítko k"));
    c.log(tr("✓ pohled se upraví"));
  },
});

registerCommand({
  id: "HELP",
  names: { cs: ["nápověda", "napoveda", "příkazy"], en: ["help", "commands"], de: ["hilfe", "befehle"] },
  alias: ["?"],
  group: "util",
  readonly: true,
  desc: () => tr("seznam příkazů 2D výkresu (nebo nápověda k jednomu)"),
  usage: () => tr("nápověda | nápověda kružnice"),
  line: (c, a) => {
    const pick = a[0] ? findCommand(a[0]) : null;
    if (a[0] && !pick) throw new Error(tr("neznámý příkaz „{0}“", a[0]));
    const defs = pick ? [pick] : commands();
    const out = defs.map((d) => ({ id: d.id, name: cmdName(d), names: d.names, alias: d.alias ?? [], group: d.group, desc: d.desc(), usage: d.usage?.() ?? "" }));
    c.out("commands", out);
    for (const d of out) c.log(`${d.name} (${[d.id, ...d.alias].join(", ")}) — ${d.desc}${d.usage ? `\n    ${d.usage}` : ""}`);
  },
});

