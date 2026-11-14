/**
 * BALÍK 2 (annot) – příkazy textu: MTEXT (odstavcový text v rámečku, editor na místě v GUI), STYLE (textové styly),
 * TEXTEDIT (úprava obsahu textu, MTEXT, kóty, odkazu, tolerance, značky).
 */
import { tr } from "../../i18n";
import { kw, registerCommand, type CmdCtx, type CmdGen, type Kw } from "../commands";
import { logCreated } from "../cmd-draw";
import { add, dot, mul, rad, rot90, sub } from "../geom";
import { invalidateGeometry, kindOf } from "../kinds";
import { allEntityLists, type DraftEntity, type DraftModel, type DraftTextStyle, type Vec2 } from "../model";
import { evalNumber, normDeg } from "../units";
import { ATTACH_NAMES } from "./kinds-annot";
import { closeEditor, openEditor, takeEditorResult } from "./editor";
import { dimStyles } from "./dimstyle";
import { mtextPlain } from "./mtext";
import type { DDimension, DLeader, DMText } from "./types";

const fold = (s: string) => s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/ß/g, "ss");
const isW = (t: string | undefined, ...w: string[]) => t !== undefined && w.includes(fold(t));

export const KA = {
  height: kw("height", "Výška", "Height", "Höhe"),
  justify: kw("justify", "Zarovnání", "Justify", "Ausrichten"),
  linespacing: kw("linespacing", "Řádkování", "Linespacing", "Zeilenabstand"),
  rotation: kw("rotation", "Natočení", "Rotation", "Drehung"),
  style: kw("style", "Styl", "Style", "Stil"),
  width: kw("width", "Šířka", "Width", "Breite"),
};
const ATT_KW: Kw[] = ATTACH_NAMES.map((n, i) => kw(n.toLowerCase(), n, n, ["OL", "OZ", "OR", "ML", "MZ", "MR", "UL", "UZ", "UR"][i]));

const findStyle = (m: DraftModel, name: string) => m.textStyles.find((x) => x.name.toLowerCase() === name.trim().toLowerCase());
const styleErr = (m: DraftModel, name: string) => new Error(tr("textový styl „{0}“ ve výkresu není – styly: {1}", name, m.textStyles.map((x) => x.name).join(", ")));

/** výzva obsahu textu: v GUI otevře editor na místě, prázdné zadání = obsah z editoru */
export function* askText(c: CmdCtx, msg: string, req: Omit<Parameters<typeof openEditor>[0], "title"> & { title?: string }): Generator<import("../commands").Prompt, string | null, import("../commands").Input> {
  if (c.interactive) openEditor({ title: req.title ?? msg, ...req });
  try {
    const i = yield { k: "text", msg, none: true };
    if (i.k === "text") return i.s;
    return takeEditorResult();
  } finally {
    closeEditor();
  }
}

// ---------------------------------------------------------------- MTEXT

registerCommand({
  id: "MTEXT",
  names: { cs: ["mtext", "odstavcový-text"], en: ["mtext"], de: ["mtext", "absatztext"] },
  alias: ["MT", "T"],
  group: "annotate",
  desc: () => tr("odstavcový text v rámečku (MTEXT): dva rohy rámečku (šířka zalamování), obsah s kódy MTEXT (\\P nový řádek, {\\C1;…} barva, \\S1/2; zlomek); volby Výška, Zarovnání (TL…BR), Řádkování, Natočení, Styl, Šířka"),
  usage: () => tr("mtext x,y @80,-20 \"1. řádek\\P2. řádek\" | mtext výška 5 zarovnání mc x,y šířka 0 \"Text\""),
  run: function* (c): CmdGen {
    const v = c.tx.vars;
    let style = v.textstyle;
    const st0 = findStyle(c.tx.model, style);
    let h = st0?.height && st0.height > 0 ? st0.height : v.textsize;
    let attach = 1;
    let ls = 1;
    let rot = 0;
    let p1: Vec2 | null = null;
    let w: number | null = null;
    const kws = [KA.height, KA.justify, KA.linespacing, KA.rotation, KA.style, KA.width];
    const option = function* (id: string): Generator<import("../commands").Prompt, void, import("../commands").Input> {
      if (id === "height") {
        const i = yield { k: "dist", msg: tr("Zadejte výšku textu"), def: h, min: 1e-9, ...(p1 ? { base: p1 } : {}) };
        if (i.k === "num") {
          h = i.v;
          c.tx.setVars({ textsize: h });
        }
      } else if (id === "justify") {
        const i = yield { k: "kw", msg: tr("Zadejte připojení"), kw: ATT_KW, def: ATT_KW[attach - 1].id };
        if (i.k === "kw") attach = ATT_KW.findIndex((k) => k.id === i.id) + 1 || 1;
      } else if (id === "linespacing") {
        const i = yield { k: "dist", msg: tr("Zadejte faktor řádkování"), def: ls, min: 0.25 };
        if (i.k === "num") ls = i.v;
      } else if (id === "rotation") {
        const i = yield { k: "angle", msg: tr("Zadejte úhel natočení"), def: rot, ...(p1 ? { base: p1 } : {}) };
        if (i.k === "num") rot = normDeg(i.v);
      } else if (id === "style") {
        const i = yield { k: "text", msg: tr("Zadejte název textového stylu"), def: style };
        if (i.k === "text") {
          const s = findStyle(c.tx.model, i.s);
          if (!s) throw styleErr(c.tx.model, i.s);
          style = s.name;
          if (s.height > 0) h = s.height;
        }
      } else if (id === "width") {
        const i = yield { k: "dist", msg: tr("Zadejte šířku rámečku (0 = bez zalamování)"), def: 0, min: 0, ...(p1 ? { base: p1 } : {}) };
        if (i.k === "num") w = i.v;
      }
    };
    while (!p1) {
      const i = yield { k: "point", msg: tr("Zadejte první roh rámečku"), kw: kws };
      if (i.k === "point") p1 = i.p;
      else if (i.k === "kw") yield* option(i.id);
      else return;
    }
    // směr rámečku podle aktuálního natočení – volba Natočení se smí zadat i u protilehlého rohu (jako v AutoCADu)
    const dirOf = (): Vec2 => [Math.cos(rad(rot)), Math.sin(rad(rot))];
    let p = p1;
    while (w === null) {
      const dir = dirOf();
      const i = yield {
        k: "point",
        msg: tr("Zadejte protilehlý roh"),
        base: p1,
        kw: kws,
        preview: (q) => {
          const u = dot(sub(q, p1!), dir);
          const vv = dot(sub(q, p1!), rot90(dir));
          const A = p1!;
          const B = add(A, mul(dir, u));
          const C = add(B, mul(rot90(dir), vv));
          const D = add(A, mul(rot90(dir), vv));
          return [{ type: "polyline", pts: [A, B, C, D], closed: true }];
        },
      };
      if (i.k === "point") {
        const u = dot(sub(i.p, p1), dir);
        const vv = dot(sub(i.p, p1), rot90(dir));
        const u0 = Math.min(0, u);
        const u1 = Math.max(0, u);
        const v0 = Math.min(0, vv);
        const v1 = Math.max(0, vv);
        const col = (attach - 1) % 3;
        const row = Math.floor((attach - 1) / 3);
        const uu = col === 0 ? u0 : col === 1 ? (u0 + u1) / 2 : u1;
        const vy = row === 0 ? v1 : row === 1 ? (v0 + v1) / 2 : v0;
        p = add(p1, add(mul(dir, uu), mul(rot90(dir), vy)));
        w = Math.abs(u);
      } else if (i.k === "kw") yield* option(i.id);
      else return;
    }
    const stx = findStyle(c.tx.model, style);
    const s = yield* askText(c, tr("Zadejte text (\\P = nový řádek)"), { title: tr("Odstavcový text"), init: "", p, h, rot, w, attach, style });
    if (!s) {
      if (!c.interactive) throw new Error(tr("chybí nový obsah textu"));
      return;
    }
    const id = c.tx.add({ type: "mtext", p, h, w, s, ...(rot ? { rot } : {}), ...(style !== "Standard" ? { style } : {}), ...(attach !== 1 ? { attach } : {}), ...(ls !== 1 ? { lineSpacing: ls } : {}), ...(stx?.annotative ? { annotative: true } : {}) } as DMText);
    logCreated(c, [id]);
    c.out("text", mtextPlain(s));
  },
});

// ---------------------------------------------------------------- STYLE (textové styly)

const W = {
  new: ["novy", "new", "neu", "vytvorit", "create"],
  modify: ["upravit", "modify", "andern", "aendern", "zmenit", "set"],
  current: ["aktualni", "current", "aktuell", "set-current"],
  rename: ["prejmenovat", "rename", "umbenennen"],
  delete: ["smazat", "delete", "loschen", "loeschen", "odstranit"],
  font: ["pismo", "font", "schrift", "schriftart"],
  height: ["vyska", "height", "hohe", "hoehe"],
  width: ["sirka", "width", "breite", "faktor", "widthfactor"],
  oblique: ["sklon", "oblique", "neigung", "neigungswinkel"],
  anno: ["anotativni", "annotative", "beschriftung", "anno"],
};
function stylePatch(a: string[], from: number): Partial<DraftTextStyle> {
  const out: Partial<DraftTextStyle> = {};
  for (let i = from; i < a.length; i++) {
    const k = a[i];
    const val = a[i + 1];
    if (val === undefined) throw new Error(tr("chybí hodnota vlastnosti {0}", k));
    i++;
    if (isW(k, ...W.font)) out.font = val;
    else if (isW(k, ...W.height)) {
      const v = evalNumber(val, true);
      if (!(v >= 0)) throw new Error(tr("výška stylu: 0 (zadává se u textu) nebo kladné číslo"));
      out.height = v;
    } else if (isW(k, ...W.width)) {
      const v = evalNumber(val, true);
      if (!(v > 0)) throw new Error(tr("šířkový faktor musí být kladný"));
      out.wf = v;
    } else if (isW(k, ...W.oblique)) {
      const v = evalNumber(val.replace("°", ""), true);
      if (!(Math.abs(v) <= 85)) throw new Error(tr("sklon musí být v rozsahu −85° až 85°"));
      out.oblique = v;
    } else if (isW(k, ...W.anno)) out.annotative = /^(1|ano|yes|ja|true|zap|on)$/i.test(val);
    else throw new Error(tr("neznámá vlastnost stylu „{0}“ – písmo, výška, šířka, sklon, anotativní", k));
  }
  return out;
}
const styleUsed = (m: DraftModel, name: string) => {
  const n = name.toLowerCase();
  let used = 0;
  for (const { list } of allEntityLists(m)) for (const e of list) if (((e as { style?: string }).style ?? "").toLowerCase() === n && e.type !== "dimension") used++;
  for (const d of dimStyles(m)) if ((d.dimtxsty ?? "").toLowerCase() === n) used++;
  return used;
};
const styleLine = (s: DraftTextStyle, cur: string) => `${s.name === cur ? "* " : "  "}${s.name}: ${tr("písmo")} ${s.font}, ${tr("výška")} ${s.height || tr("proměnná")}, ${tr("šířka")} ${s.wf}, ${tr("sklon")} ${s.oblique}°${s.annotative ? `, ${tr("anotativní")}` : ""}`;

registerCommand({
  id: "STYLE",
  names: { cs: ["styl-textu", "textový-styl"], en: ["style", "textstyle"], de: ["stil", "textstil"] },
  alias: ["ST"],
  group: "annotate",
  desc: () => tr("textové styly: výpis, nový / upravit (písmo, výška – 0 = zadává se u textu, šířka, sklon, anotativní), aktuální, přejmenovat, smazat (nepoužitý)"),
  usage: () => tr("styl-textu nový ISO písmo isocp.shx výška 0 šířka 1 | styl-textu aktuální ISO | styl-textu upravit ISO sklon 15 | styl-textu smazat ISO"),
  line: (c, a) => {
    const m0 = c.tx.model;
    const cur = c.tx.vars.textstyle;
    if (!a.length) {
      if (c.interactive) c.ui?.openPanel?.("annot-styles");
      c.out("textStyles", m0.textStyles.map((s) => ({ ...s, current: s.name === cur })));
      for (const s of m0.textStyles) c.log(styleLine(s, cur));
      return;
    }
    const op = a[0];
    const name = a[1];
    const touch = (fn: (m: DraftModel) => DraftModel) => {
      c.tx.setModel(fn);
      invalidateGeometry();
    };
    if (isW(op, ...W.new)) {
      if (!name?.trim() || /[<>/\\":;?*|=`]/.test(name)) throw new Error(tr("neplatný název stylu „{0}“", name ?? ""));
      if (findStyle(m0, name)) throw new Error(tr("textový styl „{0}“ už existuje", name));
      const base = findStyle(m0, cur) ?? m0.textStyles[0];
      const st: DraftTextStyle = { name: name.trim(), font: base?.font ?? "Arial", height: 0, wf: 1, oblique: 0, ...stylePatch(a, 2) };
      touch((m) => ({ ...m, textStyles: [...m.textStyles, st], vars: { ...m.vars, textstyle: st.name } }));
      c.log(tr("✓ textový styl {0} vytvořen a nastaven jako aktuální", st.name));
      return;
    }
    if (isW(op, ...W.modify)) {
      const s = name ? findStyle(m0, name) : undefined;
      if (!s) throw styleErr(m0, name ?? "");
      const patch = stylePatch(a, 2);
      if (!Object.keys(patch).length) throw new Error(tr("zadejte změny: písmo, výška, šířka, sklon, anotativní"));
      touch((m) => ({ ...m, textStyles: m.textStyles.map((x) => (x === s ? { ...x, ...patch } : x)) }));
      c.log(tr("✓ textový styl {0} upraven", s.name));
      return;
    }
    if (isW(op, ...W.current)) {
      const s = name ? findStyle(m0, name) : undefined;
      if (!s) throw styleErr(m0, name ?? "");
      c.tx.setVars({ textstyle: s.name });
      c.log(tr("✓ aktuální textový styl: {0}", s.name));
      return;
    }
    if (isW(op, ...W.rename)) {
      const s = name ? findStyle(m0, name) : undefined;
      const to = a[2]?.trim();
      if (!s) throw styleErr(m0, name ?? "");
      if (/^standard$/i.test(s.name)) throw new Error(tr("styl Standard nelze přejmenovat"));
      if (!to || /[<>/\\":;?*|=`]/.test(to)) throw new Error(tr("neplatný název stylu „{0}“", to ?? ""));
      if (findStyle(m0, to) && findStyle(m0, to) !== s) throw new Error(tr("textový styl „{0}“ už existuje", to));
      const re = (x?: string) => (x && x.toLowerCase() === s.name.toLowerCase() ? to : x);
      touch((m) => {
        const mapE = (l: DraftEntity[]) => l.map((e) => ((e as { style?: string }).style && e.type !== "dimension" && re((e as { style?: string }).style) !== (e as { style?: string }).style ? ({ ...e, style: to } as DraftEntity) : e));
        return {
          ...m,
          textStyles: m.textStyles.map((x) => (x === s ? { ...x, name: to } : x)),
          vars: { ...m.vars, textstyle: re(m.vars.textstyle) ?? m.vars.textstyle },
          entities: mapE(m.entities),
          ...(m.blocks ? { blocks: m.blocks.map((b) => ({ ...b, entities: mapE(b.entities) })) } : {}),
          ...(m.layouts ? { layouts: m.layouts.map((l) => ({ ...l, entities: mapE(l.entities) })) } : {}),
          ...(m.dimStyles ? { dimStyles: m.dimStyles.map((d) => (re(d.dimtxsty) !== d.dimtxsty ? { ...d, dimtxsty: to } : d)) } : {}),
        };
      });
      c.log(tr("✓ textový styl {0} přejmenován na {1}", s.name, to));
      return;
    }
    if (isW(op, ...W.delete)) {
      const s = name ? findStyle(m0, name) : undefined;
      if (!s) throw styleErr(m0, name ?? "");
      if (/^standard$/i.test(s.name)) throw new Error(tr("styl Standard nelze smazat"));
      if (s.name === cur) throw new Error(tr("aktuální textový styl nelze smazat – nejdřív nastavte jiný"));
      const used = styleUsed(m0, s.name);
      if (used) throw new Error(tr("styl {0} používá {1} objektů – nejdřív je převeďte na jiný styl", s.name, used));
      touch((m) => ({ ...m, textStyles: m.textStyles.filter((x) => x !== s) }));
      c.log(tr("✓ textový styl {0} smazán", s.name));
      return;
    }
    // název stylu: nastavit jako aktuální, jinak vytvořit (jako -STYLE)
    const s = findStyle(m0, op);
    if (s && a.length === 1) {
      c.tx.setVars({ textstyle: s.name });
      c.log(tr("✓ aktuální textový styl: {0}", s.name));
      return;
    }
    if (s) {
      const patch = stylePatch(a, 1);
      touch((m) => ({ ...m, textStyles: m.textStyles.map((x) => (x === s ? { ...x, ...patch } : x)), vars: { ...m.vars, textstyle: s.name } }));
      c.log(tr("✓ textový styl {0} upraven", s.name));
      return;
    }
    throw new Error(tr("neznámá volba „{0}“ – nový, upravit, aktuální, přejmenovat, smazat nebo název stylu", op));
  },
});

// ---------------------------------------------------------------- TEXTEDIT

const TEXT_TYPES = new Set(["text", "mtext", "dimension", "leader", "tolerance", "surfsym", "attdef"]);
/** obsah textové entity a jeho změna */
export function textOf(e: DraftEntity): string {
  const x = e as unknown as Record<string, unknown>;
  if (e.type === "dimension") return (e as DDimension).text ?? "<>";
  if (e.type === "leader") return (e as DLeader).text ?? "";
  if (e.type === "surfsym") return String(x.text ?? "");
  if (e.type === "attdef") return String(x.def ?? x.s ?? "");
  return String(x.s ?? "");
}
export function withText(e: DraftEntity, s: string): DraftEntity {
  if (e.type === "dimension") return { ...e, text: s === "<>" ? "" : s } as DraftEntity;
  if (e.type === "leader" || e.type === "surfsym") return { ...e, text: s } as DraftEntity;
  if (e.type === "attdef") return { ...e, def: s } as DraftEntity;
  return { ...e, s } as DraftEntity;
}

registerCommand({
  id: "TEXTEDIT",
  names: { cs: ["upravit-text"], en: ["textedit", "ddedit"], de: ["textedit", "textbearb"] },
  alias: ["ED"],
  group: "annotate",
  desc: () => tr("upraví obsah textu, odstavcového textu, kóty (<> = naměřená hodnota, prázdné = výchozí), odkazu, tolerance nebo značky; v GUI editor na místě"),
  usage: () => tr("upravit-text e5 \"Nový text\" | upravit-text e7 \"<> H7\" (kóta) | upravit-text e7 \"<>\" (kóta zpět na naměřenou hodnotu)"),
  run: function* (c): CmdGen {
    const ids: string[] = [];
    for (;;) {
      const i = yield { k: "entity", msg: tr("Vyberte text, kótu nebo odkaz"), filter: (e) => TEXT_TYPES.has(e.type), none: true };
      if (i.k !== "ent") break;
      const e = c.tx.get(i.id)!;
      const p = (e as { p?: Vec2 }).p ?? (e as { textPos?: Vec2 }).textPos ?? i.p;
      const h = (e as { h?: number }).h ?? (e as { textH?: number }).textH ?? c.tx.vars.textsize;
      const rot = (e as { rot?: number }).rot ?? 0;
      const s = yield* askText(c, tr("Zadejte nový obsah"), { title: `${kindOf(e)?.label() ?? e.type} ${e.id}`, init: textOf(e), p, h, rot, w: e.type === "mtext" ? (e as DMText).w : 0, attach: e.type === "mtext" ? ((e as DMText).attach ?? 1) : 7, single: e.type !== "mtext" && e.type !== "leader", ...((e as { style?: string }).style && e.type !== "dimension" ? { style: (e as { style?: string }).style } : {}) });
      if (s === null) {
        if (!c.interactive) throw new Error(tr("chybí nový obsah textu"));
        break;
      }
      c.tx.update(e.id, (x) => withText(x, s));
      ids.push(e.id);
      if (!c.interactive) break;
    }
    if (ids.length) c.log(tr("✓ upraveno: {0}", ids.join(", ")));
  },
});
