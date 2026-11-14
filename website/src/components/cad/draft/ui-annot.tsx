"use client";

/**
 * GUI rozšíření 2D výkresu – poznámky (balík 2): karta Poznámky (Text, Kóty, Odkazy, Šrafy, Styly), panel stylů
 * (kótovací a textové styly), editor textu na místě (MTEXT, úprava textu / kóty / odkazu – poklepáním i v příkazu),
 * měřítko poznámek ve stavovém řádku a přepočet mezipaměti geometrie po změně stylů (i po zpět / znovu).
 * Smlouva: website/CAD-2D-NAVRH.md, kap. 11 „Balík 2 – annot“.
 */
import { tr } from "@/cad/i18n";
import { useEffect, useReducer, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { ANNO_SCALES, annoMultiplier, annoScaleLabel, sameAnnoScale } from "@/cad/draft/annot/anno";
import { textOf, withText } from "@/cad/draft/annot/cmd-text";
import { ARROWS } from "@/cad/draft/annot/dimgeom";
import { createDimStyle, currentDimStyle, deleteDimStyle, DIM_VARS, dimStyles, modifyDimStyle, parseDimVar, renameDimStyle, resolveDimStyle, setCurrentDimStyle, type DimVarDef } from "@/cad/draft/annot/dimstyle";
import { closeEditor, editorState, submitEditor, subscribeEditor, openEditor, type EditorReq } from "@/cad/draft/annot/editor";
import { GDT_SYMBOLS } from "@/cad/draft/annot/gdt";
import { codesToEditor, editorToCodes } from "@/cad/draft/annot/mtext";
import { patternLibrary } from "@/cad/draft/annot/patterns";
import { quoteArg } from "@/cad/draft/annot/util";
import type { DMText } from "@/cad/draft/annot/types";
import { invalidateGeometry, kindOf } from "@/cad/draft/kinds";
import { layerLocked } from "@/cad/draft/layers";
import { entityById, spaceEntities, type DraftDimStyle, type DraftEntity, type DraftModel, type Vec2 } from "@/cad/draft/model";
import { toScreen } from "@/cad/draft/render";
import { DraftTx } from "@/cad/draft/tx";
import { cn } from "@/lib/cn";
import type { CadIconName } from "../cad-icons";
import type { RItem } from "../ribbon";
import type { DraftUiApi, DraftUiExt, RGroup, RMenuEntry } from "./ui-ext";

const TEXT_TYPES = new Set(["text", "mtext", "dimension", "leader", "tolerance", "surfsym"]);
const q = (s: string) => quoteArg(s) ?? `"${s.replace(/"/g, "")}"`;

/** poslední rozhraní pracovní plochy (editor a poklepání pracují s aktuálním modelem) */
let apiNow: DraftUiApi | null = null;

// ---------------------------------------------------------------- přepočet geometrie po změně stylů

let lastTok: unknown[] | null = null;
function checkStyles(m: DraftModel) {
  const tok = [m.dimStyles, m.textStyles, m.vars.cannoscale, m.vars.dimstyle, m.vars.textstyle];
  if (!lastTok || tok.some((x, i) => x !== lastTok![i])) {
    if (lastTok) invalidateGeometry();
    lastTok = tok;
  }
}

// ---------------------------------------------------------------- editor na místě

/** poklepání / kontextová nabídka: úprava obsahu jedním krokem historie (šrafa → HATCHEDIT, zamčená hladina = hlášení) */
function editEntity(api: DraftUiApi, id: string): boolean {
  const list = spaceEntities(api.model, api.space) ?? api.model.entities;
  const e = entityById(list as DraftEntity[], id);
  if (!e || (!TEXT_TYPES.has(e.type) && e.type !== "hatch")) return false;
  if (layerLocked(api.model, e.layer)) {
    api.flash(tr("entita {0} je na zamčené hladině „{1}“", e.id, e.layer));
    return true;
  }
  if (e.type === "hatch") {
    api.command("HATCHEDIT", [e.id]);
    return true;
  }
  const p = (e as { p?: Vec2 }).p ?? (e as { textPos?: Vec2 }).textPos ?? (e as { pts?: Vec2[] }).pts?.slice(-1)[0] ?? [0, 0];
  const h = (e as { h?: number }).h ?? (e as { textH?: number }).textH ?? api.model.vars.textsize;
  openEditor({
    title: `${kindOf(e)?.label() ?? e.type} ${e.id}`,
    init: textOf(e),
    p,
    h,
    rot: (e as { rot?: number }).rot ?? 0,
    w: e.type === "mtext" ? (e as DMText).w : 0,
    attach: e.type === "mtext" ? ((e as DMText).attach ?? 1) : 7,
    single: e.type !== "mtext" && e.type !== "leader",
    ...((e as { style?: string }).style && e.type !== "dimension" ? { style: (e as { style?: string }).style } : {}),
    apply: (s) => {
      const a = apiNow ?? api;
      try {
        const tx = new DraftTx(a.model, a.space);
        tx.update(id, (x) => withText(x, s));
        a.commit(tx.model);
      } catch (err) {
        a.flash((err as Error).message);
      }
    },
  });
  return true;
}

const key = (k: string) => window.dispatchEvent(new KeyboardEvent("keydown", { key: k, bubbles: true }));

function AnnotEditor({ api }: { api: DraftUiApi }) {
  const [, force] = useReducer((x: number) => x + 1, 0);
  useEffect(() => subscribeEditor(force), []);
  const req = editorState();
  if (!req || typeof document === "undefined") return null;
  return createPortal(<EditorBox key={`${req.title}|${req.init}|${req.p.join(",")}`} req={req} api={api} />, document.body);
}

const COLORS: [number, string][] = [[1, "#ff0000"], [2, "#ffff00"], [3, "#00ff00"], [4, "#00ffff"], [5, "#0000ff"], [6, "#ff00ff"], [7, "#000000"]];

function EditorBox({ req, api }: { req: EditorReq; api: DraftUiApi }) {
  const [text, setText] = useState(() => codesToEditor(req.init));
  const ta = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    const el = ta.current;
    if (el) {
      el.focus();
      el.setSelectionRange(el.value.length, el.value.length);
    }
  }, []);
  const host = typeof document !== "undefined" ? document.querySelector("[data-draft-canvas]") : null;
  const r = host?.getBoundingClientRect();
  const v = api.view();
  const s = v && r ? toScreen(v, req.p) : [80, 80];
  const W = Math.max(260, Math.min(560, (req.w || 0) * (v?.scale ?? 1) + 40));
  const left = Math.max(8, Math.min((r?.left ?? 0) + s[0], (typeof window !== "undefined" ? window.innerWidth : 1200) - W - 8));
  const top = Math.max(8, Math.min((r?.top ?? 0) + s[1] + 12, (typeof window !== "undefined" ? window.innerHeight : 800) - 230));
  const ok = () => {
    const codes = editorToCodes(text);
    if (req.apply) {
      closeEditor();
      req.apply(codes);
      return;
    }
    submitEditor(codes);
    key("Enter");
  };
  const cancel = () => {
    closeEditor();
    if (!req.apply) key("Escape");
  };
  /** obalí výběr kódem (např. {\C1;…}); formát bez výběru by vložil prázdnou skupinu – jen upozorní */
  const wrap = (pre: string, post: string) => {
    const el = ta.current;
    if (!el) return;
    const a = el.selectionStart;
    const b = el.selectionEnd;
    if (a === b && post) {
      api.flash(tr("Nejdřív vyberte text, který se má formátovat"));
      el.focus();
      return;
    }
    const n = text.slice(0, a) + pre + text.slice(a, b) + post + text.slice(b);
    setText(n);
    requestAnimationFrame(() => {
      el.focus();
      el.setSelectionRange(a + pre.length, b + pre.length);
    });
  };
  const ins = (t: string) => wrap(t, "");
  // tučně / kurzíva písmem textového stylu (kód \f s názvem písma stylu, ne pevně Arial)
  const font = (api.model.textStyles.find((x) => x.name.toLowerCase() === (req.style ?? api.model.vars.textstyle).toLowerCase())?.font ?? "Arial").replace(/[|;{}\\]/g, "");
  const btn = "rounded border border-[#cfd6de] bg-white px-1.5 py-0.5 text-[11.5px] hover:bg-[#eef2f6]";
  return (
    <div className="fixed z-[90] rounded-md border border-[#9fb3c8] bg-white p-2 text-[12px] text-[#1f2933] shadow-2xl" style={{ left, top, width: W }} data-annot-editor onKeyDown={(e) => e.stopPropagation()}>
      <div className="mb-1 flex items-center gap-1">
        <span className="flex-1 truncate font-semibold">{req.title}</span>
        <span className="text-[10.5px] text-[#6b7785]">{tr("Ctrl+Enter = OK, Esc = zrušit")}</span>
      </div>
      <div className="mb-1 flex flex-wrap gap-1" data-annot-editor-tools>
        <button type="button" className={cn(btn, "font-bold")} title={tr("Tučně")} onClick={() => wrap(`{\\f${font}|b1;`, "}")}>B</button>
        <button type="button" className={cn(btn, "italic")} title={tr("Kurzíva")} onClick={() => wrap(`{\\f${font}|i1;`, "}")}>I</button>
        <button type="button" className={cn(btn, "underline")} title={tr("Podtržení")} onClick={() => wrap("\\L", "\\l")}>U</button>
        <button type="button" className={cn(btn, "overline")} title={tr("Nadtržení")} onClick={() => wrap("\\O", "\\o")}>O</button>
        <button type="button" className={cn(btn, "line-through")} title={tr("Přeškrtnutí")} onClick={() => wrap("\\K", "\\k")}>S</button>
        {COLORS.map(([i, c]) => (
          <button key={i} type="button" className="h-5 w-5 rounded border border-black/20" style={{ background: c }} title={tr("Barva ACI {0}", i)} onClick={() => wrap(`{\\C${i};`, "}")} />
        ))}
        <button type="button" className={btn} title={tr("Menší písmo (0,7×)")} onClick={() => wrap("{\\H0.7x;", "}")}>A−</button>
        <button type="button" className={btn} title={tr("Větší písmo (1,5×)")} onClick={() => wrap("{\\H1.5x;", "}")}>A+</button>
        <button type="button" className={btn} title={tr("Zlomek / stoh (vyberte a/b nebo +0,1^-0,2)")} onClick={() => wrap("\\S", ";")}>a/b</button>
        <button type="button" className={btn} title={tr("Průměr")} onClick={() => ins("%%c")}>Ø</button>
        <button type="button" className={btn} title={tr("Stupeň")} onClick={() => ins("%%d")}>°</button>
        <button type="button" className={btn} title={tr("Plus mínus")} onClick={() => ins("%%p")}>±</button>
      </div>
      <textarea
        ref={ta}
        value={text}
        onChange={(e) => setText(e.target.value)}
        rows={req.single ? 1 : Math.min(8, Math.max(3, text.split("\n").length + 1))}
        spellCheck={false}
        className="w-full resize-y rounded border border-[#cfd6de] px-1.5 py-1 font-mono text-[12.5px] outline-none focus:border-brand"
        data-annot-editor-text
        onKeyDown={(e) => {
          e.stopPropagation();
          if (e.key === "Escape") {
            e.preventDefault();
            cancel();
          } else if (e.key === "Enter" && (e.ctrlKey || e.metaKey || req.single)) {
            e.preventDefault();
            ok();
          }
        }}
      />
      <div className="mt-1 flex items-center gap-1.5">
        <span className="flex-1 text-[10.5px] text-[#6b7785]">{req.single ? tr("<> = naměřená hodnota kóty") : tr("Enter = nový řádek (\\P)")}</span>
        <button type="button" className={btn} onClick={cancel} data-annot-editor-cancel>
          {tr("Zrušit")}
        </button>
        <button type="button" className="rounded bg-brand px-3 py-0.5 font-semibold text-white" onClick={ok} data-annot-editor-ok>
          {tr("OK")}
        </button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- stavový řádek: měřítko poznámek + editor

function AnnotStatus({ api }: { api: DraftUiApi }) {
  const [open, setOpen] = useState<{ left: number; bottom: number } | null>(null);
  const k = annoMultiplier(api.model);
  return (
    <span className="shrink-0" data-annot-status>
      <button
        type="button"
        onClick={(e) => {
          const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
          setOpen((x) => (x ? null : { left: r.left, bottom: window.innerHeight - r.top + 4 }));
        }}
        className="rounded px-1.5 py-0.5 font-semibold text-[#4a5664] hover:bg-white"
        title={tr("Měřítko poznámek (anotativní texty, kóty, odkazy)")}
        data-annot-scale
      >
        ⚖ {annoScaleLabel(k)}
      </button>
      {open &&
        typeof document !== "undefined" &&
        createPortal(
          <>
            <div className="fixed inset-0 z-[70]" onClick={() => setOpen(null)} />
            <div className="fixed z-[71] w-36 rounded border border-[#cfd6de] bg-white py-1 text-[12px] shadow-xl" style={{ left: open.left, bottom: open.bottom }} data-annot-scale-menu>
              {ANNO_SCALES.map((s) => (
                <button key={s} type="button" className={cn("block w-full px-2 py-0.5 text-left hover:bg-[#eef2f6]", sameAnnoScale(s, k) && "font-semibold text-brand")} onClick={() => { setOpen(null); void api.run(`kótovací-styl měřítko-poznámek ${annoScaleLabel(s)}`); }}>
                  {annoScaleLabel(s)}
                </button>
              ))}
            </div>
          </>,
          document.body,
        )}
      <AnnotEditor api={api} />
    </span>
  );
}

// ---------------------------------------------------------------- panel stylů

const field = "w-full min-w-0 rounded border border-[#cfd6de] bg-white px-1.5 py-0.5 text-[12px] outline-none focus:border-brand";
const ARROW_LABEL = (a: string) => (a === "" ? tr("plná uzavřená") : a.replace(/^_/, "").toLowerCase());
const FONTS = ["Arial", "isocp.shx", "iso3098.shx", "romans.shx", "simplex.shx", "txt.shx", "Times New Roman", "Courier New"];
/** proměnné stylu v panelu (ostatní textem: kótovací-styl upravit …) */
const PANEL_VARS = ["dimtxt", "dimasz", "dimexe", "dimexo", "dimgap", "dimdli", "dimscale", "dimdec", "dimdsep", "dimzin", "dimlfac", "dimpost", "dimtad", "dimjust", "dimtih", "dimtoh", "dimblk", "dimtol", "dimlim", "dimtp", "dimtm", "dimtdec", "dimtfac", "dimcen", "dimarcsym", "dimadec", "dimanno"];

function VarInput({ def, value, onCommit }: { def: DimVarDef; value: unknown; onCommit: (raw: string) => void }) {
  const [v, setV] = useState(String(value ?? ""));
  useEffect(() => setV(String(value ?? "")), [value]);
  if (def.kind === "bool") return <input type="checkbox" checked={!!value} onChange={(e) => onCommit(e.target.checked ? "1" : "0")} data-dimvar={def.key} />;
  if (def.key === "dimblk")
    return (
      <select value={String(value ?? "")} onChange={(e) => onCommit(e.target.value || '""')} className={field} data-dimvar={def.key}>
        {ARROWS.map((a) => (
          <option key={a} value={a}>
            {ARROW_LABEL(a)}
          </option>
        ))}
      </select>
    );
  return <input value={v} onChange={(e) => setV(e.target.value)} onBlur={() => v !== String(value ?? "") && onCommit(v === "" && def.kind === "str" ? '""' : v)} onKeyDown={(e) => { e.stopPropagation(); if (e.key === "Enter") (e.target as HTMLInputElement).blur(); }} className={cn(field, def.kind !== "str" && "font-mono")} data-dimvar={def.key} />;
}

function StylesPanel({ api }: { api: DraftUiApi }) {
  const m = api.model;
  const [sel, setSel] = useState<string>(() => currentDimStyle(m));
  const [tsel, setTsel] = useState<string>(() => m.vars.textstyle);
  const [newName, setNewName] = useState("");
  const [newText, setNewText] = useState("");
  const styles = dimStyles(m);
  const st = styles.find((s) => s.name === sel) ?? styles[0];
  const r = resolveDimStyle(m, st.name);
  const commit = (fn: (x: DraftModel) => DraftModel) => {
    try {
      api.commit(fn(api.model));
    } catch (e) {
      api.flash((e as Error).message);
    }
  };
  const setVar = (def: DimVarDef, raw: string) =>
    commit((x) => {
      const val = parseDimVar(def, raw, x);
      return modifyDimStyle(x, st.name, { [def.key]: val } as Partial<DraftDimStyle>);
    });
  const ts = m.textStyles.find((x) => x.name === tsel) ?? m.textStyles[0];
  const runText = (t: string) => void api.run(t);
  const sec = "border-b border-[#e3e8ee] bg-[#f6f8fa] px-2 py-1.5 font-semibold";
  const row = (label: string, el: React.ReactNode, k?: string) => (
    <label key={k ?? label} className="grid grid-cols-[1fr_110px] items-center gap-2 border-b border-[#f0f3f6] px-2 py-0.5">
      <span className="truncate text-[#4a5664]" title={label}>
        {label}
      </span>
      {el}
    </label>
  );
  return (
    <div className="text-[12px]" data-annot-styles>
      <p className={sec}>{tr("Kótovací styly")}</p>
      <div className="flex flex-wrap gap-1 px-2 py-1.5">
        {styles.map((s) => (
          <button key={s.name} type="button" onClick={() => setSel(s.name)} className={cn("rounded border px-2 py-0.5", s.name === st.name ? "border-brand text-brand" : "border-[#cfd6de]")} data-dimstyle={s.name}>
            {s.name === currentDimStyle(m) ? "● " : ""}
            {s.name}
          </button>
        ))}
      </div>
      <div className="flex flex-wrap items-center gap-1 px-2 pb-1.5">
        <button type="button" className="rounded border border-[#cfd6de] px-2 py-0.5 hover:bg-[#eef2f6]" onClick={() => commit((x) => setCurrentDimStyle(x, st.name))} data-dimstyle-current>
          {tr("Nastavit aktuální")}
        </button>
        <input value={newName} onChange={(e) => setNewName(e.target.value)} onKeyDown={(e) => e.stopPropagation()} placeholder={tr("nový název")} className={cn(field, "w-28")} data-dimstyle-newname />
        <button type="button" className="rounded border border-[#cfd6de] px-2 py-0.5 hover:bg-[#eef2f6]" disabled={!newName.trim()} onClick={() => { commit((x) => setCurrentDimStyle(createDimStyle(x, newName.trim(), st.name), newName.trim())); setSel(newName.trim()); setNewName(""); }} data-dimstyle-new>
          {tr("Nový z vybraného")}
        </button>
        <button type="button" className="rounded border border-[#cfd6de] px-2 py-0.5 hover:bg-[#eef2f6]" disabled={!newName.trim()} onClick={() => { commit((x) => renameDimStyle(x, st.name, newName.trim())); setSel(newName.trim()); setNewName(""); }}>
          {tr("Přejmenovat")}
        </button>
        <button type="button" className="rounded border border-[#cfd6de] px-2 py-0.5 text-[#b42318] hover:bg-[#fdecea]" onClick={() => { commit((x) => deleteDimStyle(x, st.name)); setSel(currentDimStyle(api.model)); }}>
          {tr("Smazat")}
        </button>
      </div>
      {PANEL_VARS.map((k) => {
        const def = DIM_VARS.find((d) => d.key === k)!;
        return row(def.label(), <VarInput def={def} value={(r as Record<string, unknown>)[k]} onCommit={(raw) => setVar(def, raw)} />, k);
      })}
      {row(
        tr("Textový styl (DIMTXSTY)"),
        <select value={r.dimtxsty ?? ""} onChange={(e) => setVar(DIM_VARS.find((d) => d.key === "dimtxsty")!, e.target.value || "Standard")} className={field}>
          <option value="">—</option>
          {m.textStyles.map((t) => (
            <option key={t.name} value={t.name}>
              {t.name}
            </option>
          ))}
        </select>,
      )}
      <p className="px-2 py-1 text-[11px] text-[#6b7785]">{tr("Další proměnné textem: 2d kótovací-styl upravit {0} dimclrd 1 …", st.name)}</p>

      <p className={sec}>{tr("Textové styly")}</p>
      <div className="flex flex-wrap gap-1 px-2 py-1.5">
        {m.textStyles.map((s) => (
          <button key={s.name} type="button" onClick={() => setTsel(s.name)} className={cn("rounded border px-2 py-0.5", s.name === ts?.name ? "border-brand text-brand" : "border-[#cfd6de]")} data-textstyle={s.name}>
            {s.name === m.vars.textstyle ? "● " : ""}
            {s.name}
          </button>
        ))}
      </div>
      {ts && (
        <>
          <div className="flex flex-wrap items-center gap-1 px-2 pb-1.5">
            <button type="button" className="rounded border border-[#cfd6de] px-2 py-0.5 hover:bg-[#eef2f6]" onClick={() => runText(`styl-textu aktuální ${q(ts.name)}`)}>
              {tr("Nastavit aktuální")}
            </button>
            <input value={newText} onChange={(e) => setNewText(e.target.value)} onKeyDown={(e) => e.stopPropagation()} placeholder={tr("nový název")} className={cn(field, "w-28")} data-textstyle-newname />
            <button type="button" className="rounded border border-[#cfd6de] px-2 py-0.5 hover:bg-[#eef2f6]" disabled={!newText.trim()} onClick={() => { runText(`styl-textu nový ${q(newText.trim())} písmo ${q(ts.font)} šířka ${ts.wf}`); setTsel(newText.trim()); setNewText(""); }} data-textstyle-new>
              {tr("Nový")}
            </button>
            <button type="button" className="rounded border border-[#cfd6de] px-2 py-0.5 hover:bg-[#eef2f6]" disabled={!newText.trim()} onClick={() => { runText(`styl-textu přejmenovat ${q(ts.name)} ${q(newText.trim())}`); setTsel(newText.trim()); setNewText(""); }}>
              {tr("Přejmenovat")}
            </button>
            <button type="button" className="rounded border border-[#cfd6de] px-2 py-0.5 text-[#b42318] hover:bg-[#fdecea]" onClick={() => runText(`styl-textu smazat ${q(ts.name)}`)}>
              {tr("Smazat")}
            </button>
          </div>
          {row(
            tr("Písmo"),
            <>
              <input key={`f${ts.name}${ts.font}`} defaultValue={ts.font} list="annot-fonts" onBlur={(e) => e.target.value !== ts.font && runText(`styl-textu upravit ${q(ts.name)} písmo ${q(e.target.value)}`)} onKeyDown={(e) => { e.stopPropagation(); if (e.key === "Enter") (e.target as HTMLInputElement).blur(); }} className={field} data-textstyle-font />
              <datalist id="annot-fonts">
                {FONTS.map((f) => (
                  <option key={f} value={f} />
                ))}
              </datalist>
            </>,
          )}
          {(
            [
              ["height", tr("Výška (0 = zadává se u textu)"), ts.height, "výška"],
              ["wf", tr("Šířkový faktor"), ts.wf, "šířka"],
              ["oblique", tr("Sklon [°]"), ts.oblique, "sklon"],
            ] as [string, string, number, string][]
          ).map(([k, l, v, w]) =>
            row(l, <input key={`${k}${ts.name}${v}`} defaultValue={String(v)} onBlur={(e) => e.target.value !== String(v) && runText(`styl-textu upravit ${q(ts.name)} ${w} ${e.target.value.replace(",", ".")}`)} onKeyDown={(e) => { e.stopPropagation(); if (e.key === "Enter") (e.target as HTMLInputElement).blur(); }} className={cn(field, "font-mono")} data-textstyle-var={k} />, k),
          )}
          {row(tr("Anotativní"), <input type="checkbox" checked={!!ts.annotative} onChange={(e) => runText(`styl-textu upravit ${q(ts.name)} anotativní ${e.target.checked ? "ano" : "ne"}`)} />)}
        </>
      )}
    </div>
  );
}

// ---------------------------------------------------------------- pás karet

function groups(api: DraftUiApi): RGroup[] {
  const m = api.model;
  const c = (id: string, label: string, icon: CadIconName, cmd: string, pre: string[] = [], hint?: string, kbd?: string, menu?: RMenuEntry[]): RItem => ({ id, label, icon, tone: "sketch", hint, kbd, onClick: () => api.command(cmd, pre), ...(menu ? { menu } : {}) });
  const mi = (id: string, label: string, icon: CadIconName, cmd: string, pre: string[] = []): RItem => ({ id, label, icon, onClick: () => api.command(cmd, pre) });
  const curDim = currentDimStyle(m);
  const pats = patternLibrary().filter((p) => /^ANSI3[1-8]$|^(NET|LINE|DOTS|STEEL|BRICK|HONEY|GRATE|CROSS)$/.test(p.name));
  return [
    {
      label: tr("Text – odstavce"),
      big: 1,
      items: [
        c("an-mtext", tr("Odstavcový text"), "text", "MTEXT", [], tr("text v rámečku se zalamováním a formátováním"), "MT"),
        c("an-textedit", tr("Upravit text"), "edit", "TEXTEDIT", [], tr("text, kóta, odkaz – i poklepáním"), "ED"),
        { id: "an-textstyle", label: tr("Text: {0}", m.vars.textstyle), icon: "text", menu: [...m.textStyles.map((s) => ({ id: `ts-${s.name}`, label: s.name, icon: (s.name === m.vars.textstyle ? "check" : "text") as CadIconName, onClick: () => void api.run(`styl-textu aktuální ${q(s.name)}`) })), { divider: true as const }, { id: "ts-panel", label: tr("Textové styly…"), icon: "settings" as CadIconName, onClick: () => api.openPanel("annot-styles") }] },
      ],
    },
    {
      label: tr("Kóty"),
      big: 1,
      items: [
        c("an-dim", tr("Kóta"), "dimension", "DIM", [], tr("podle objektu: úsečka, kružnice, oblouk"), "DIM"),
        c("an-dimlinear", tr("Lineární"), "dimension", "DIMLINEAR", [], tr("vodorovná / svislá / natočená"), "DLI"),
        c("an-dimaligned", tr("Zarovnaná"), "dimension", "DIMALIGNED", [], undefined, "DAL"),
        c("an-dimangular", tr("Úhlová"), "arc", "DIMANGULAR", [], tr("dvě úsečky, oblouk nebo 3 body"), "DAN"),
        c("an-dimradius", tr("Poloměr"), "arcCenter", "DIMRADIUS", [], undefined, "DRA", [mi("an-dimradius-r", tr("Poloměr"), "arcCenter", "DIMRADIUS"), mi("an-dimjogged", tr("Zalomená (velký poloměr)"), "arcCenter", "DIMRADIUS", ["_jogged"])]),
        c("an-dimdiameter", tr("Průměr"), "circle", "DIMDIAMETER", [], undefined, "DDI"),
        c("an-dimarc", tr("Délka oblouku"), "arc", "DIMARC", [], undefined, "DAR"),
        c("an-dimordinate", tr("Souřadnicová"), "axes", "DIMORDINATE", [], tr("od počátku 0,0 – X / Y"), "DOR"),
        c("an-dimbaseline", tr("Základnicová"), "dimension", "DIMBASELINE", [], tr("od 1. čáry poslední kóty"), "DBA"),
        c("an-dimcontinue", tr("Řetězová"), "dimension", "DIMCONTINUE", [], tr("navazuje na poslední kótu"), "DCO"),
        c("an-centermark", tr("Značka středu"), "centerline", "CENTERMARK", [], tr("kříž a osy kružnice"), "CM", [mi("an-centermark-c", tr("Značka středu a osy"), "centerline", "CENTERMARK"), mi("an-centerline", tr("Osa mezi dvěma úsečkami"), "centerline", "CENTERMARK", ["_centerline"])]),
      ],
    },
    {
      label: tr("Odkazy"),
      big: 1,
      items: [
        c("an-mleader", tr("Multiodkaz"), "polyline", "MLEADER", [], tr("šipka, zalomení, text"), "MLD"),
        c("an-tolerance", tr("Tolerance tvaru a polohy"), "table", "TOLERANCE", [], tr("rámeček ISO 1101"), "TOL", GDT_SYMBOLS.map((g) => mi(`an-tol-${g.ch}`, g.label(), "table", "TOLERANCE", [`_${g.ch}`]))),
        c("an-surfsym", tr("Drsnost povrchu"), "check", "SURFSYM", [], tr("značka ISO 1302"), undefined, [mi("an-surf-removal", tr("S úběrem materiálu"), "check", "SURFSYM", ["_kind", "_removal"]), mi("an-surf-basic", tr("Základní značka"), "check", "SURFSYM", ["_kind", "_basic"]), mi("an-surf-noremoval", tr("Bez úběru materiálu"), "check", "SURFSYM", ["_kind", "_noremoval"])]),
        c("an-revcloud", tr("Revizní obláček"), "spline", "REVCLOUD", [], tr("obdélník, mnohoúhelník nebo objekt")),
      ],
    },
    {
      label: tr("Šrafy"),
      big: 1,
      items: [
        c("an-hatch", tr("Šrafa"), "grid", "HATCH", [], tr("klikněte dovnitř uzavřené oblasti"), "H", [
          ...pats.map((p) => mi(`an-hatch-${p.name}`, `${p.name} – ${p.desc}`, "grid", "HATCH", ["_pattern", p.name])),
          { divider: true as const },
          mi("an-hatch-solid", tr("Plná výplň (SOLID)"), "grid", "HATCH", ["_solid"]),
          mi("an-hatch-user", tr("Uživatelská (rozteč, úhel)"), "grid", "HATCH", ["_user"]),
          mi("an-hatch-gradient", tr("Přechod"), "palette", "HATCH", ["_gradient"]),
          mi("an-hatch-objects", tr("Výběrem objektů"), "select", "HATCH", ["_objects"]),
        ]),
        c("an-hatchedit", tr("Upravit šrafu"), "edit", "HATCHEDIT", [], tr("vzor, měřítko, úhel, ostrovy"), "HE"),
      ],
    },
    {
      label: tr("Styly"),
      big: 1,
      items: [
        { id: "an-styles", label: tr("Kótovací styly"), icon: "settings", tone: "view", hint: tr("ISO-25, text, šipky, tolerance, měřítko"), kbd: "D", onClick: () => api.openPanel("annot-styles") },
        { id: "an-curdim", label: tr("Kóty: {0}", curDim), icon: "dimension", menu: dimStyles(m).map((s) => ({ id: `ds-${s.name}`, label: s.name, icon: (s.name === curDim ? "check" : "dimension") as CadIconName, onClick: () => void api.run(`kótovací-styl aktuální ${q(s.name)}`) })) },
        { id: "an-annoscale", label: tr("Měřítko poznámek {0}", annoScaleLabel(annoMultiplier(m))), icon: "scale", menu: ANNO_SCALES.map((s) => ({ id: `as-${s}`, label: annoScaleLabel(s), icon: (sameAnnoScale(s, annoMultiplier(m)) ? "check" : "scale") as CadIconName, onClick: () => void api.run(`kótovací-styl měřítko-poznámek ${annoScaleLabel(s)}`) })) },
      ],
    },
  ];
}

export const annotUi: DraftUiExt = {
  id: "annot",
  ribbon: (api) => {
    apiNow = api;
    return { annotate: groups(api) };
  },
  panels: {
    "annot-styles": { title: () => tr("Styly poznámek"), icon: "dimension", render: (api) => <StylesPanel key={api.model.id} api={api} /> },
  },
  statusLeft: (api) => {
    apiNow = api;
    return <AnnotStatus key="annot" api={api} />;
  },
  context: (api) => {
    const list = spaceEntities(api.model, api.space) ?? api.model.entities;
    const sel = api.session.sel.map((id) => entityById(list as DraftEntity[], id)).filter((e): e is DraftEntity => !!e);
    if (sel.length !== 1) return [];
    const e = sel[0];
    if (TEXT_TYPES.has(e.type)) return [{ divider: true as const }, { id: "an-ctx-edit", label: tr("Upravit text"), icon: "edit" as CadIconName, onClick: () => editEntity(api, e.id) }];
    if (e.type === "hatch") return [{ divider: true as const }, { id: "an-ctx-hatch", label: tr("Upravit šrafu"), icon: "edit" as CadIconName, onClick: () => api.command("HATCHEDIT", [e.id]) }];
    return [];
  },
  underlay: (_g, api) => checkStyles(api.model),
  dblclick: (api, id) => editEntity(api, id),
};
