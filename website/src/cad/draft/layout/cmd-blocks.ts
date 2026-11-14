/**
 * BALÍK 3 (layout) – příkazy bloků: BLOK, VLOŽIT, UPRAVIT-BLOK, ZAVŘÍT-BLOK, DEFINICE-ATRIBUTU, UPRAVIT-ATRIBUTY,
 * EXTRAHOVAT-ATRIBUTY (CSV), ULOŽIT-BLOK (WBLOCK – DXF / DWG / .mncad / nová záložka), VYČISTIT (PURGE).
 * Každý příkaz = jeden krok historie; GUI (výzvy, myš) i text (`2d …`).
 */
import { tr } from "../../i18n";
import { kw, kwLabel, registerCommand, type CmdCtx, type CmdGen, type Kw } from "../commands";
import { xfMove } from "../geom";
import { kindOf } from "../kinds";
import { findLayer } from "../layers";
import { allEntityLists, spaceEntities, type DraftBlock, type DraftEntity, type DraftModel, type NewEntity, type Vec2 } from "../model";
import { setSelection } from "../session";
import { attributeRows, attribsFor, blockAttDefs, blockUseCount, findBlock, insertedBlocks, purge, refreshInserts, rowsToCsv, validBlockName, wouldRecurse, type PurgeWhat } from "./blocks";
import { layoutState, setSpace } from "./state";
import type { DAttDef, DAttrib, DInsert } from "./types";
import { fold, isW, nfmt } from "./util";

const K = {
  convert: kw("convert", "Převést", "Convert", "Umwandeln"),
  retain: kw("retain", "Ponechat", "Retain", "Beibehalten"),
  delete: kw("delete", "Smazat", "Delete", "Löschen"),
  scale: kw("scale", "Měřítko", "Scale", "Faktor"),
  rotate: kw("rotate", "Otočit", "Rotate", "Drehen"),
  array: kw("array", "Pole", "Array", "Reihe"),
  save: kw("save", "Uložit", "Save", "Speichern"),
  discard: kw("discard", "Zahodit", "Discard", "Verwerfen"),
  done: kw("done", "Hotovo", "Done", "Fertig"),
};
/** režimy atributu (jen celé slovo nebo _id – značka atributu smí začínat stejně) */
const MODES: Kw[] = [kw("invisible", "Neviditelný", "Invisible", "Unsichtbar"), kw("constant", "Konstantní", "Constant", "Konstant"), kw("verify", "Ověřit", "Verify", "Prüfen"), kw("preset", "Předvolba", "Preset", "Vorgabe")];
const exactMode = (t: string) => MODES.find((k) => isW(t, k.cs, k.en, k.de, `_${k.id}`)) ?? null;

/** název z výzvy (v GUI celý řádek): bez okrajových mezer a uvozovek „…“ / "…" (názvy s mezerou) */
export const unq = (s: string) => {
  const t = s.trim();
  const m = /^(?:"([^"]*)"|„([^“”"]*)[“”"])$/.exec(t);
  return m ? (m[1] ?? m[2]).trim() : t;
};

const userBlocks = (m: DraftModel) => (m.blocks ?? []).filter((b) => !b.anonymous && !b.name.startsWith("*"));
const blockList = (m: DraftModel) => userBlocks(m).map((b) => b.name).join(", ") || "—";

function listBlocks(c: CmdCtx) {
  const m = c.tx.model;
  const rows = userBlocks(m).map((b) => ({ name: b.name, entities: b.entities.length, inserts: blockUseCount(m, b.name), attributes: blockAttDefs(b).map((d) => d.tag), base: b.base, ...(b.desc ? { desc: b.desc } : {}) }));
  c.out("blocks", rows);
  if (!rows.length) return c.log(tr("výkres nemá žádné bloky"));
  for (const r of rows) c.log(tr("{0} · entit {1} · vložení {2}{3}", r.name, r.entities, r.inserts, r.attributes.length ? ` · ${tr("atributy")} ${r.attributes.join(", ")}` : ""));
}

function needBlock(m: DraftModel, name: string): DraftBlock {
  const b = findBlock(m, name);
  if (!b) throw new Error(tr("blok „{0}“ ve výkresu není – bloky: {1}", name, blockList(m)));
  return b;
}

// ---------------------------------------------------------------- BLOK

registerCommand({
  id: "BLOCK",
  names: { cs: ["blok"], en: ["block", "bmake"], de: ["block"] },
  alias: ["B"],
  group: "block",
  pickfirst: true,
  desc: () => tr("definice bloku z vybraných objektů: název, bod vložení, objekty, původní objekty [Převést/Ponechat/Smazat] (převést = nahradit vložením); stejný název blok předefinuje a obnoví všechna vložení; „blok ?“ = seznam bloků"),
  usage: () => tr("blok ŠROUB 0,0 e1 e2 e3 | blok RÁM 10,10 okno 0,0 200,100 ponechat | blok ?"),
  run: function* (c): CmdGen {
    const t = yield { k: "text", msg: tr("Zadejte název bloku nebo [?]") };
    if (t.k !== "text") return;
    const name = unq(t.s);
    if (name === "?") return listBlocks(c);
    const err = validBlockName(name);
    if (err) throw new Error(err);
    const bp = yield { k: "point", msg: tr("Zadejte bod vložení (základní bod bloku)") };
    if (bp.k !== "point") return;
    const sel = yield { k: "select", msg: tr("Vyberte objekty bloku"), filter: (e) => e.type !== "viewport" };
    if (sel.k !== "sel" || !sel.ids.length) throw new Error(tr("nic nevybráno – blok potřebuje aspoň jeden objekt"));
    const md = yield { k: "kw", msg: tr("Původní objekty"), kw: [K.convert, K.retain, K.delete], def: "convert" };
    const mode = md.k === "kw" ? md.id : "convert";
    const src = sel.ids.map((id) => c.tx.get(id)).filter((e): e is DraftEntity => !!e && e.type !== "viewport");
    if (!src.length) throw new Error(tr("výřezy nemohou být součástí bloku"));
    const m0 = c.tx.model;
    if (wouldRecurse(m0, findBlock(m0, name)?.name ?? name, src)) throw new Error(tr("blok „{0}“ nemůže obsahovat sám sebe (ani vnořeně)", name));
    if (mode !== "retain") {
      const locked = src.filter((e) => findLayer(m0, e.layer)?.locked);
      if (locked.length) throw new Error(tr("objekty na zamčené hladině nelze převést ani smazat: {0}", locked.map((e) => e.id).join(", ")));
      for (const e of src) c.tx.remove(e.id);
    }
    const ents = src.map((e) => ({ ...e, id: c.tx.newId() }) as DraftEntity);
    const prev = findBlock(c.tx.model, name);
    const blk: DraftBlock = { ...(prev ?? {}), name: prev?.name ?? name, base: bp.p, entities: ents };
    c.tx.setModel((m) => {
      const blocks = prev ? (m.blocks ?? []).map((b) => (b === prev ? blk : b)) : [...(m.blocks ?? []), blk];
      const out = { ...m, blocks, vars: { ...m.vars, insname: blk.name } };
      return prev ? refreshInserts(out, [blk.name]) : out;
    });
    if (mode === "convert") {
      const ins: Omit<DInsert, "id" | "layer"> = { type: "insert", block: blk.name, p: bp.p, sx: 1, sy: 1, rot: 0 };
      const atts = attribsFor(c.tx.model, blk, ins);
      const id = c.tx.add({ ...ins, ...(atts.length ? { attribs: atts } : {}) } as NewEntity);
      c.out("insert", id);
      setSelection(c.session, []);
    }
    c.out("block", blk.name);
    c.log(prev ? tr("✓ blok „{0}“ předefinován ({1} entit, vložení obnovena: {2})", blk.name, ents.length, blockUseCount(c.tx.model, blk.name)) : tr("✓ blok „{0}“ ({1} entit){2}", blk.name, ents.length, mode === "convert" ? tr(" – objekty nahrazeny vložením") : mode === "delete" ? tr(" – objekty smazány") : ""));
  },
});

// ---------------------------------------------------------------- VLOŽIT

registerCommand({
  id: "INSERT",
  names: { cs: ["vložit", "vlozit", "vložit-blok"], en: ["insert", "ddinsert"], de: ["einfüge", "einfuege", "einfügen"] },
  alias: ["I"],
  group: "block",
  desc: () => tr("vložení bloku: název, bod vložení [Měřítko/Otočit/Pole], měřítko X <1>, měřítko Y <=X>, natočení <0>, hodnoty atributů (v pořadí definic); záporné měřítko = zrcadlení; „vložit ?“ = seznam bloků"),
  usage: () => tr("vložit ŠROUB 100,50 | vložit ŠROUB 100,50 2 2 45 | vložit RAZÍTKO 400,10 1 1 0 \"Hřídel\" \"V-001\" | vložit ŠROUB pole 3 2 20 15 0,0"),
  run: function* (c): CmdGen {
    const last = c.tx.vars.insname;
    const t = yield { k: "text", msg: tr("Zadejte název bloku nebo [?]"), ...(last && findBlock(c.tx.model, last) ? { def: last } : {}) };
    if (t.k !== "text") return;
    if (unq(t.s) === "?") return listBlocks(c);
    const blk = needBlock(c.tx.model, unq(t.s));
    if (c.session.space.startsWith("block:")) {
      const host = c.session.space.slice(6);
      if (fold(blk.name) === fold(host) || wouldRecurse(c.tx.model, host, [{ type: "insert", id: "~", layer: "0", block: blk.name, p: [0, 0], sx: 1, sy: 1, rot: 0 } as DInsert]))
        throw new Error(tr("blok „{0}“ nelze vložit do bloku „{1}“ – blok nemůže obsahovat sám sebe (ani vnořeně)", blk.name, host));
    }
    let sx = 1;
    let sy = 1;
    let rot = 0;
    let preScale = false;
    let preRot = false;
    let cols = 1;
    let rows = 1;
    let cs = 0;
    let rs = 0;
    let p: Vec2 | null = null;
    const prev = (q: Vec2): NewEntity[] => [{ type: "insert", block: blk.name, p: q, sx, sy, rot, ...(cols > 1 || rows > 1 ? { cols, rows, colSpacing: cs, rowSpacing: rs } : {}) } as NewEntity];
    while (!p) {
      const i = yield { k: "point", msg: tr("Zadejte bod vložení"), kw: [K.scale, K.rotate, K.array], preview: prev };
      if (i.k === "point") p = i.p;
      else if (i.k === "kw" && i.id === "scale") {
        const s = yield { k: "dist", msg: tr("Zadejte měřítko"), def: 1 };
        if (s.k !== "num" || s.v === 0) throw new Error(tr("měřítko nesmí být 0"));
        sx = sy = s.v;
        preScale = true;
      } else if (i.k === "kw" && i.id === "rotate") {
        const r = yield { k: "angle", msg: tr("Zadejte úhel natočení"), def: 0 };
        if (r.k === "num") rot = ((r.v % 360) + 360) % 360;
        preRot = true;
      } else if (i.k === "kw" && i.id === "array") {
        const a = yield { k: "int", msg: tr("Počet sloupců"), def: 2, min: 1, max: 10000 };
        const b = yield { k: "int", msg: tr("Počet řádků"), def: 1, min: 1, max: 10000 };
        cols = a.k === "num" ? a.v : 1;
        rows = b.k === "num" ? b.v : 1;
        if (cols > 1) {
          const d = yield { k: "dist", msg: tr("Rozteč sloupců") };
          cs = d.k === "num" ? d.v : 0;
        }
        if (rows > 1) {
          const d = yield { k: "dist", msg: tr("Rozteč řádků") };
          rs = d.k === "num" ? d.v : 0;
        }
      } else return;
    }
    if (!preScale) {
      const a = yield { k: "dist", msg: tr("Zadejte měřítko X"), def: 1 };
      if (a.k !== "num" || a.v === 0) throw new Error(tr("měřítko nesmí být 0"));
      sx = a.v;
      const b = yield { k: "dist", msg: tr("Zadejte měřítko Y <stejné jako X>"), def: sx };
      if (b.k !== "num" || b.v === 0) throw new Error(tr("měřítko nesmí být 0"));
      sy = b.v;
    }
    if (!preRot) {
      const r = yield { k: "angle", msg: tr("Zadejte úhel natočení"), base: p, def: 0, preview: (q: Vec2) => [{ type: "insert", block: blk.name, p: p!, sx, sy, rot: (Math.atan2(q[1] - p![1], q[0] - p![0]) * 180) / Math.PI } as NewEntity] };
      if (r.k === "num") rot = ((r.v % 360) + 360) % 360;
    }
    const values: string[] = [];
    for (const d of blockAttDefs(blk)) {
      if (d.constant) continue;
      if (d.preset) {
        values.push(d.def);
        continue;
      }
      const v = yield { k: "text", msg: d.prompt || d.tag, def: d.def, none: true };
      values.push(v.k === "text" ? v.s : d.def);
    }
    const ins: Omit<DInsert, "id" | "layer"> = { type: "insert", block: blk.name, p, sx, sy, rot, ...(cols > 1 || rows > 1 ? { cols, rows, colSpacing: cs, rowSpacing: rs } : {}) };
    const atts = attribsFor(c.tx.model, blk, ins, values);
    const id = c.tx.add({ ...ins, ...(atts.length ? { attribs: atts } : {}) } as NewEntity);
    c.tx.setVars({ insname: blk.name });
    c.out("insert", id);
    c.log(tr("✓ {0}: vložení bloku „{1}“ v {2}{3}", id, blk.name, c.fmt.pt(p), sx !== 1 || sy !== 1 || rot ? ` · ${tr("měřítko")} ${nfmt(sx)}×${nfmt(sy)} · ${c.fmt.ang(rot)}` : ""));
  },
});

// ---------------------------------------------------------------- UPRAVIT-BLOK / ZAVŘÍT-BLOK

registerCommand({
  id: "BEDIT",
  names: { cs: ["upravit-blok", "editor-bloků"], en: ["bedit"], de: ["bbearb", "blockeditor"] },
  alias: ["BE"],
  group: "block",
  desc: () => tr("úprava definice bloku: přepne do prostoru bloku (kreslí se a upravuje obsah bloku, počátek = bod vložení); neexistující název založí nový blok; konec ZAVŘÍT-BLOK [Uložit/Zahodit]"),
  usage: () => tr("upravit-blok ŠROUB · (kreslení…) · zavřít-blok | zavřít-blok zahodit"),
  run: function* (c): CmdGen {
    const sel = c.session.sel.map((id) => c.tx.get(id)).find((e) => e?.type === "insert") as DInsert | undefined;
    const t = yield { k: "text", msg: tr("Zadejte název bloku k úpravě nebo [?]"), ...(sel ? { def: sel.block } : {}) };
    if (t.k !== "text") return;
    const nm = unq(t.s);
    if (nm === "?") return listBlocks(c);
    if (c.session.space.startsWith("block:")) throw new Error(tr("už upravujete blok „{0}“ – nejdřív ZAVŘÍT-BLOK", c.session.space.slice(6)));
    let blk = findBlock(c.tx.model, nm);
    const snapshot = blk ?? null;
    if (!blk) {
      const err = validBlockName(nm);
      if (err) throw new Error(err);
      blk = { name: nm, base: [0, 0], entities: [] };
      const nb = blk;
      c.tx.setModel((m) => ({ ...m, blocks: [...(m.blocks ?? []), nb] }));
      c.log(tr("nový prázdný blok „{0}“ (bod vložení 0,0)", nm));
    }
    layoutState(c.session).bedit = { block: blk.name, prev: c.session.space, snapshot };
    setSpace(c.session, `block:${blk.name}`);
    c.session.zoom = { kind: "extents" };
    c.out("space", c.session.space);
    c.log(tr("✓ úprava bloku „{0}“ ({1} entit) – kreslete a upravujte, konec: zavřít-blok", blk.name, blk.entities.length));
  },
});

registerCommand({
  id: "BCLOSE",
  names: { cs: ["zavřít-blok", "zavrit-blok"], en: ["bclose"], de: ["bschließen", "bschliessen"] },
  group: "block",
  desc: () => tr("ukončí úpravu bloku: Uložit (výchozí – všechna vložení se obnoví) nebo Zahodit (vrátí definici před UPRAVIT-BLOK)"),
  usage: () => tr("zavřít-blok | zavřít-blok uložit | zavřít-blok zahodit"),
  run: function* (c): CmdGen {
    const sp = c.session.space;
    const st = layoutState(c.session);
    if (!sp.startsWith("block:")) throw new Error(tr("neupravujete žádný blok (UPRAVIT-BLOK název)"));
    const name = sp.slice(6);
    const k = yield { k: "kw", msg: tr("Změny bloku „{0}“", name), kw: [K.save, K.discard], def: "save" };
    const save = k.k !== "kw" || k.id === "save";
    const be = st.bedit && st.bedit.block === name ? st.bedit : null;
    if (save) {
      const blk = findBlock(c.tx.model, name);
      if (!blk) {
        // definice zmizela (zpět, smazání) – nic k uložení; zpět do modelu, ať se nekreslí „do ztracena“
        st.bedit = null;
        setSpace(c.session, "model");
        c.session.zoom = { kind: "extents" };
        throw new Error(tr("blok „{0}“ ve výkresu už není – úprava bloku ukončena bez uložení", name));
      }
      if (blk && wouldRecurse(c.tx.model, name, blk.entities)) throw new Error(tr("blok „{0}“ nemůže obsahovat sám sebe (ani vnořeně)", name));
      if (blk?.entities.some((e) => e.type === "viewport")) throw new Error(tr("výřezy nemohou být součástí bloku"));
      c.tx.setModel((m) => refreshInserts(m, [name]));
      c.log(tr("✓ blok „{0}“ uložen ({1} entit, vložení obnovena: {2})", name, blk?.entities.length ?? 0, blockUseCount(c.tx.model, name)));
    } else {
      const snap = be?.snapshot ?? null;
      c.tx.setModel((m) => {
        const blocks = snap ? (m.blocks ?? []).map((b) => (b.name === name ? snap : b)) : (m.blocks ?? []).filter((b) => b.name !== name);
        return refreshInserts({ ...m, blocks }, [name]);
      });
      c.log(snap ? tr("✓ změny bloku „{0}“ zahozeny", name) : tr("✓ nový blok „{0}“ zahozen", name));
    }
    st.bedit = null;
    const back = be?.prev && be.prev !== sp && spaceEntities(c.tx.model, be.prev) ? be.prev : "model";
    setSpace(c.session, back);
    c.session.zoom = { kind: "extents" };
    c.out("space", back);
  },
});

// ---------------------------------------------------------------- DEFINICE-ATRIBUTU

registerCommand({
  id: "ATTDEF",
  names: { cs: ["definice-atributu", "atribut"], en: ["attdef", "ddattdef"], de: ["attdef", "attributdef"] },
  alias: ["ATT"],
  group: "block",
  desc: () => tr("definice atributu (pro bloky): režimy [Neviditelný/Konstantní/Ověřit/Předvolba] před značkou, značka, výzva, výchozí hodnota, bod [Zarovnání/Styl], výška, natočení"),
  usage: () => tr("definice-atributu CISLO \"Číslo dílu\" \"001\" 10,5 3.5 0 | definice-atributu neviditelný CENA \"Cena\" \"0\" 0,0 2.5 0"),
  run: function* (c): CmdGen {
    const modes = { invisible: false, constant: false, verify: false, preset: false };
    let tag = "";
    while (!tag) {
      const t = yield { k: "text", msg: tr("Zadejte značku atributu nebo režim [{0}]", MODES.map((m) => (modes[m.id as keyof typeof modes] ? "✓" : "") + kwLabel(m)).join("/")) };
      if (t.k !== "text") return;
      const md = exactMode(t.s.trim());
      if (md) {
        modes[md.id as keyof typeof modes] = !modes[md.id as keyof typeof modes];
        c.log(tr("režim {0}: {1}", kwLabel(md), modes[md.id as keyof typeof modes] ? tr("ano") : tr("ne")));
        continue;
      }
      const v = t.s.trim().toUpperCase();
      if (!v || /\s/.test(v)) throw new Error(tr("značka atributu nesmí být prázdná ani obsahovat mezery"));
      tag = v;
    }
    let prompt = tag;
    if (!modes.constant) {
      const p = yield { k: "text", msg: tr("Zadejte výzvu atributu"), def: tag };
      if (p.k === "text") prompt = p.s;
    }
    const d = yield { k: "text", msg: modes.constant ? tr("Zadejte hodnotu atributu") : tr("Zadejte výchozí hodnotu"), def: "", none: true };
    const def = d.k === "text" ? d.s : "";
    let style = c.tx.vars.textstyle;
    let halign: DAttDef["halign"];
    let p: Vec2 | null = null;
    const J: Record<string, [DAttDef["halign"], DAttDef["valign"]]> = { left: [undefined, undefined], center: ["center", undefined], right: ["right", undefined], middle: ["middle", undefined], tl: ["left", "top"], tc: ["center", "top"], tr: ["right", "top"], ml: ["left", "middle"], mc: ["center", "middle"], mr: ["right", "middle"], bl: ["left", "bottom"], bc: ["center", "bottom"], br: ["right", "bottom"] };
    let valign: DAttDef["valign"];
    while (!p) {
      const i = yield { k: "point", msg: tr("Zadejte počáteční bod textu atributu"), kw: [kw("justify", "Zarovnání", "Justify", "Ausrichten"), kw("style", "Styl", "Style", "Stil")] };
      if (i.k === "point") p = i.p;
      else if (i.k === "kw" && i.id === "justify") {
        const j = yield { k: "kw", msg: tr("Zarovnání"), kw: Object.keys(J).map((x) => kw(x, x.toUpperCase(), x.toUpperCase(), x.toUpperCase())), def: "left" };
        if (j.k === "kw") [halign, valign] = J[j.id];
      } else if (i.k === "kw" && i.id === "style") {
        const s = yield { k: "text", msg: tr("Zadejte název textového stylu"), def: style };
        if (s.k === "text") {
          const st = c.tx.model.textStyles.find((x) => x.name.toLowerCase() === s.s.trim().toLowerCase());
          if (!st) throw new Error(tr("textový styl „{0}“ ve výkresu není – styly: {1}", s.s, c.tx.model.textStyles.map((x) => x.name).join(", ")));
          style = st.name;
        }
      } else return;
    }
    const h0 = yield { k: "dist", msg: tr("Zadejte výšku textu"), base: p, def: c.tx.vars.textsize, min: 1e-9 };
    const h = h0.k === "num" ? h0.v : c.tx.vars.textsize;
    const r = yield { k: "angle", msg: tr("Zadejte úhel natočení textu"), base: p, def: 0 };
    const rot = r.k === "num" ? ((r.v % 360) + 360) % 360 : 0;
    const e: Omit<DAttDef, "id" | "layer"> = {
      type: "attdef",
      tag,
      prompt,
      def,
      p,
      h,
      ...(rot ? { rot } : {}),
      ...(style !== "Standard" ? { style } : {}),
      ...(halign ? { halign } : {}),
      ...(valign ? { valign } : {}),
      ...(modes.invisible ? { invisible: true } : {}),
      ...(modes.constant ? { constant: true } : {}),
      ...(modes.verify ? { verify: true } : {}),
      ...(modes.preset ? { preset: true } : {}),
    };
    const id = c.tx.add(e as NewEntity);
    c.log(tr("✓ {0}: definice atributu {1}{2}", id, tag, c.session.space.startsWith("block:") ? "" : tr(" – zahrňte ji do bloku (BLOK) nebo ji nakreslete v úpravě bloku")));
  },
});

// ---------------------------------------------------------------- UPRAVIT-ATRIBUTY

registerCommand({
  id: "ATTEDIT",
  names: { cs: ["upravit-atributy"], en: ["attedit", "eattedit"], de: ["attedit", "attänd"] },
  alias: ["ATE"],
  group: "block",
  desc: () => tr("hodnoty atributů vložení bloku: vložení, pak ZNAČKA=hodnota … (Enter = konec); bez zadání = výpis atributů"),
  usage: () => tr("upravit-atributy e5 CISLO=V-001 \"NAZEV=Hřídel 2\" | upravit-atributy e5 (výpis)"),
  run: function* (c): CmdGen {
    const en = yield { k: "entity", msg: tr("Vyberte vložení bloku s atributy"), filter: (e) => e.type === "insert" };
    if (en.k !== "ent") return;
    const ins = c.tx.get(en.id) as DInsert;
    if (!ins.attribs?.length) throw new Error(tr("vložení {0} (blok {1}) nemá atributy", ins.id, ins.block));
    if (findLayer(c.tx.model, ins.layer)?.locked) throw new Error(tr("entita {0} je na zamčené hladině „{1}“", ins.id, ins.layer));
    c.out("attributes", Object.fromEntries(ins.attribs.map((a) => [a.tag, a.value])));
    let attribs: DAttrib[] = ins.attribs;
    let n = 0;
    for (;;) {
      const t = yield { k: "text", msg: tr("ZNAČKA=hodnota (atributy: {0}) nebo Enter", attribs.map((a) => `${a.tag}=${a.value}`).join(", ")), none: true };
      if (t.k !== "text" || !t.s.trim() || isW(t.s.trim(), K.done.cs, K.done.en, K.done.de)) break;
      const eq = t.s.indexOf("=");
      if (eq < 1) throw new Error(tr("zadejte ZNAČKA=hodnota, ne „{0}“", t.s));
      const tag = t.s.slice(0, eq).trim();
      const val = t.s.slice(eq + 1);
      const i = attribs.findIndex((a) => a.tag.toLowerCase() === tag.toLowerCase());
      if (i < 0) throw new Error(tr("vložení {0} nemá atribut {1} – atributy: {2}", ins.id, tag, attribs.map((a) => a.tag).join(", ")));
      attribs = attribs.map((a, k) => (k === i ? { ...a, value: val } : a));
      n++;
    }
    if (n) c.tx.put({ ...ins, attribs } as DraftEntity);
    for (const a of attribs) c.log(`  ${a.tag} = ${a.value}`);
    c.log(n ? tr("✓ {0}: změněno atributů {1}", ins.id, n) : tr("{0}: beze změny", ins.id));
  },
});

// ---------------------------------------------------------------- EXTRAHOVAT-ATRIBUTY (CSV)

registerCommand({
  id: "ATTEXT",
  names: { cs: ["extrahovat-atributy", "atributy-csv"], en: ["attext", "dataextraction"], de: ["attextrahieren", "datenextraktion"] },
  group: "block",
  readonly: true,
  desc: () => tr("tabulka atributů vložení do CSV (id, blok, hladina, X, Y, natočení, měřítka, prostor, hodnoty): všechny prostory, jen blok X, nebo výběr; soubor se stáhne, data v results[].data.rows"),
  usage: () => tr("extrahovat-atributy | extrahovat-atributy blok RAZÍTKO | extrahovat-atributy výběr oddělovač , název kusovník"),
  line: (c, a) => {
    let block: string | undefined;
    let ids: string[] | undefined;
    let sep = ";";
    let name: string | undefined;
    for (let i = 0; i < a.length; i++) {
      if (isW(a[i], "blok", "block")) block = needBlock(c.tx.model, a[++i] ?? "").name;
      else if (isW(a[i], "výběr", "vyber", "selection", "auswahl")) ids = [...c.session.sel];
      else if (isW(a[i], "oddělovač", "separator", "trennzeichen")) sep = a[++i] === "tab" ? "\t" : (a[i] ?? ";");
      else if (isW(a[i], "název", "name", "soubor", "file", "datei")) name = a[++i];
      else throw new Error(tr("neznámé zadání „{0}“ – blok X, výběr, oddělovač ;, název soubor", a[i]));
    }
    const rows = attributeRows(c.tx.model, { block, ids });
    const csv = rowsToCsv(rows, sep, c.tx.vars.prec);
    const fname = `${(name ?? c.ui?.docName?.() ?? "atributy").replace(/\.csv$/i, "").replace(/[^\w.\-áčďéěíňóřšťúůýž ]+/gi, "_")}.csv`;
    c.out("rows", rows);
    c.out("file", { name: fname, mime: "text/csv", bytes: csv.length, text: csv });
    c.ui?.download?.(fname, "﻿" + csv, "text/csv;charset=utf-8");
    c.log(tr("✓ {0}: {1} vložení s atributy", fname, rows.length));
  },
});

// ---------------------------------------------------------------- ULOŽIT-BLOK (WBLOCK)

const toB64 = (u8: Uint8Array) => {
  let b = "";
  for (let i = 0; i < u8.length; i += 0x8000) b += String.fromCharCode(...u8.subarray(i, i + 0x8000));
  return btoa(b);
};

/**
 * Výzvy na jedno slovo (název bloku, značka atributu): v GUI je potvrdí i mezera jako v AutoCADu (výzva „text“ jádra
 * bere celý řádek). Vrací začátky textů výzev v aktuálním jazyce; názvy s mezerou se zadají v uvozovkách.
 */
export const blockWordPrompts = (): string[] => [tr("Zadejte název bloku nebo [?]"), tr("Zadejte název bloku k úpravě nebo [?]"), tr("Zadejte značku atributu nebo režim [{0}]", "\u0000").split("\u0000")[0]];

/** druhy entit, které zapíše základní převodník DXF / DWG jádra (io/basic.ts) */
const CORE_IO_KINDS = new Set(["point", "line", "xline", "ray", "circle", "arc", "polyline", "ellipse", "spline", "text"]);

/** samostatný výkres z bloku / výběru / celého výkresu: entity s bodem vložení v počátku, potřebné hladiny, typy čar a bloky */
export function wblockModel(m: DraftModel, ents: DraftEntity[], base: Vec2): DraftModel {
  const xf = xfMove(-base[0], -base[1]);
  const ctx = { model: m };
  let seq = 0;
  const moved = ents.map((e) => ({ ...((base[0] || base[1] ? (kindOf(e)?.transform(e, xf, ctx) ?? e) : e) as DraftEntity), id: `e${++seq}` }) as DraftEntity);
  const need = insertedBlocks(m, moved);
  const blocks = (m.blocks ?? []).filter((b) => need.has(b.name));
  const layers = new Set<string>(["0"]);
  const lts = new Set<string>(["continuous"]);
  for (const list of [moved, ...blocks.map((b) => b.entities)])
    for (const e of list) {
      layers.add(e.layer.toLowerCase());
      if (e.linetype) lts.add(e.linetype.toLowerCase());
      for (const at of (e as DInsert).attribs ?? []) if (at.layer) layers.add(at.layer.toLowerCase());
    }
  const L = m.layers.filter((l) => layers.has(l.name.toLowerCase()));
  for (const l of L) lts.add(l.linetype.toLowerCase());
  return {
    ...m,
    id: Math.random().toString(36).slice(2, 12),
    seq,
    vars: { ...m.vars, clayer: "0" },
    layers: L,
    linetypes: m.linetypes.filter((l) => lts.has(l.name.toLowerCase()) || l.name === "Continuous"),
    entities: moved,
    blocks,
    layouts: undefined,
  };
}

registerCommand({
  id: "WBLOCK",
  names: { cs: ["uložit-blok", "ulozit-blok"], en: ["wblock"], de: ["wblock", "wblocksichern"] },
  alias: ["W"],
  group: "block",
  readonly: true,
  desc: () => tr("uloží blok (nebo výběr, nebo celý výkres „*“) jako samostatný výkres: DXF (výchozí), DWG, .mncad, nebo nová záložka; bod vložení bloku = počátek 0,0"),
  usage: () => tr("uložit-blok ŠROUB | uložit-blok ŠROUB dwg verze R2013 | uložit-blok výběr dxf název detail | uložit-blok * mncad | uložit-blok ŠROUB záložka"),
  async: async (c, a) => {
    const m = c.tx.model;
    const src = a[0];
    if (!src) throw new Error(tr("zadejte název bloku, „výběr“ nebo „*“ – bloky: {0}", blockList(m)));
    let ents: DraftEntity[];
    let base: Vec2 = [0, 0];
    let label: string;
    if (src === "*") {
      ents = m.entities;
      label = c.ui?.docName?.() ?? tr("výkres");
    } else if (isW(src, "výběr", "vyber", "selection", "auswahl")) {
      const list = spaceEntities(m, c.session.space) ?? m.entities;
      const ids = new Set(c.session.sel);
      ents = list.filter((e) => ids.has(e.id) && e.type !== "viewport");
      if (!ents.length) throw new Error(tr("nic není vybráno"));
      label = tr("výběr");
    } else {
      const b = needBlock(m, src);
      ents = b.entities;
      base = b.base;
      label = b.name;
    }
    let fmt = "dxf";
    let version: string | undefined;
    let name: string | undefined;
    for (let i = 1; i < a.length; i++) {
      const t = fold(a[i]);
      if (["dxf", "dwg", "mncad", "json"].includes(t)) fmt = t === "json" ? "mncad" : t;
      else if (["zalozka", "tab", "neu", "registerkarte", "novy", "new"].includes(t)) fmt = "tab";
      else if (["verze", "version"].includes(t)) {
        const v = (a[++i] ?? "").toUpperCase().replace(/^(?=\d)/, "R");
        if (!/^R(12|2000|2004|2007|2010|2013|2018)$/.test(v)) throw new Error(tr("neznámá verze „{0}“ – R2018, R2013, R2010, R2007, R2004, R2000 (DXF i R12)", a[i] ?? ""));
        version = v;
      }
      else if (["nazev", "name", "soubor", "file", "datei"].includes(t)) name = a[++i];
      else throw new Error(tr("neznámé zadání „{0}“ – dxf, dwg, mncad, záložka, verze R2018, název X", a[i]));
    }
    const nm = wblockModel(m, ents, base);
    const fname = name ?? label;
    if (fmt === "tab") {
      c.out("newModel", nm);
      c.out("name", fname);
      return c.log(tr("✓ „{0}“ ({1} entit) – nová záložka", fname, nm.entities.length));
    }
    if (fmt === "mncad") {
      const text = JSON.stringify({ app: "mnastrojarna-cad", version: 2, name: fname, material: "ocel", features: [], kind: "draft", draft: nm });
      const f = `${fname.replace(/[^\w.\-áčďéěíňóřšťúůýž ]+/gi, "_")}.mncad`;
      c.out("file", { name: f, mime: "application/json", bytes: text.length, text });
      c.ui?.download?.(f, text, "application/json");
      return c.log(tr("✓ {0} ({1} entit)", f, nm.entities.length));
    }
    if (version === "R12" && fmt === "dwg") throw new Error(tr("DWG R12 nelze zapsat – použijte DXF R12 nebo DWG R2000 a novější"));
    const io = await import("../io");
    const f = (await io.draftExport(nm, fmt as "dxf" | "dwg", { name: fname, version: version as never })) as Awaited<ReturnType<typeof io.draftExport>> & { warnings?: string[]; version?: string };
    // základní převodník jádra (bez balíku io) zapíše jen entity jádra – vložení, atributy, kóty… by tiše chyběly
    const dropped: Record<string, number> = {};
    let written = nm.entities.length;
    if (!Array.isArray(f.warnings)) {
      written = 0;
      for (const e of nm.entities) {
        if (CORE_IO_KINDS.has(e.type)) written++;
        else dropped[e.type] = (dropped[e.type] ?? 0) + 1;
      }
      for (const b of nm.blocks ?? []) for (const e of b.entities) if (!CORE_IO_KINDS.has(e.type)) dropped[e.type] = (dropped[e.type] ?? 0) + 1;
      if (!written) throw new Error(tr("{0}: formát {1} zatím neumí zapsat {2} – použijte .mncad (uložit-blok {3} mncad) nebo záložku", label, fmt.toUpperCase(), Object.keys(dropped).join(", "), src));
    }
    c.out("file", { name: f.name, mime: f.mime, bytes: f.bytes, ...(f.text !== undefined ? { text: f.text } : { base64: f.base64 ?? toB64(f.data) }) });
    c.out("written", written);
    if (Object.keys(dropped).length) c.out("dropped", dropped);
    c.ui?.download?.(f.name, f.data, f.mime);
    c.log(tr("✓ {0} ({1} entit, {2} kB)", f.name, written, Math.max(1, Math.round(f.bytes / 1024))));
    if (Object.keys(dropped).length) c.log(tr("⚠ nezapsáno (převodník je zatím nepodporuje): {0}", Object.entries(dropped).map(([k, v]) => `${k} ${v}`).join(", ")));
    for (const w of f.warnings ?? []) c.log(`⚠ ${w}`);
  },
});

// ---------------------------------------------------------------- VYČISTIT (PURGE)

const PW: Record<PurgeWhat, string[]> = {
  blocks: ["bloky", "blok", "blocks", "block", "blöcke", "bloecke"],
  layers: ["hladiny", "hladina", "layers", "layer", "ebenen", "ebene"],
  linetypes: ["typy-čar", "typyčar", "typycar", "linetypes", "linetype", "linientypen", "ltypes"],
  styles: ["styly", "styly-textu", "styles", "textstyles", "textstile", "stile"],
  dimstyles: ["kótovací-styly", "kotovacistyly", "dimstyles", "bemstile", "bemaßungsstile"],
};
registerCommand({
  id: "PURGE",
  names: { cs: ["vyčistit", "vycistit"], en: ["purge"], de: ["bereinig", "bereinigen"] },
  alias: ["PU"],
  group: "util",
  desc: () => tr("odstraní nepoužité bloky (i vnořené), hladiny, typy čar, textové a kótovací styly; bez zadání vše, jinak druh a případně názvy"),
  usage: () => tr("vyčistit | vyčistit bloky | vyčistit hladiny STARÁ POMOCNÁ | vyčistit typy-čar"),
  line: (c, a) => {
    let what: PurgeWhat[] = ["blocks", "layers", "linetypes", "styles", "dimstyles"];
    let names: string[] = [];
    if (a[0] && !isW(a[0], "vše", "vse", "all", "alles")) {
      const k = (Object.keys(PW) as PurgeWhat[]).find((x) => PW[x].some((w) => fold(w) === fold(a[0])));
      if (!k) throw new Error(tr("vyčistit: vše, bloky, hladiny, typy-čar, styly, kótovací-styly – ne „{0}“", a[0]));
      what = [k];
      names = a.slice(1);
    }
    // právě upravovaný blok (UPRAVIT-BLOK) se nečistí, i když zatím nemá vložení
    const editing = c.session.space.startsWith("block:") ? [c.session.space.slice(6)] : [];
    const be = layoutState(c.session).bedit?.block;
    if (be && !editing.includes(be)) editing.push(be);
    const r = purge(c.tx.model, what, names, editing);
    c.tx.setModel(() => r.model);
    const total = Object.values(r.removed).reduce((s, x) => s + x.length, 0);
    c.out("purged", r.removed);
    if (!total) return c.log(tr("nic k vyčištění"));
    const lab: Record<PurgeWhat, string> = { blocks: tr("bloky"), layers: tr("hladiny"), linetypes: tr("typy čar"), styles: tr("textové styly"), dimstyles: tr("kótovací styly") };
    for (const k of Object.keys(r.removed) as PurgeWhat[]) if (r.removed[k].length) c.log(`  ${lab[k]}: ${r.removed[k].join(", ")}`);
    c.log(tr("✓ vyčištěno: {0}", total));
  },
});

/** počet bloků a vložení (stav pro agenty) */
export function blocksSummary(m: DraftModel) {
  return userBlocks(m).map((b) => ({ name: b.name, entities: b.entities.length, inserts: allEntityLists(m).reduce((s, { list }) => s + list.filter((e) => e.type === "insert" && (e as DInsert).block === b.name).length, 0) }));
}
