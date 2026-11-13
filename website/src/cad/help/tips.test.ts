/**
 * Mikronávody u ikon: úplnost a jednotnost obsahu ve třech jazycích a pokrytí všech tlačítek pásu karet.
 *
 * - každý klíč balíku je ve všech třech jazycích, se stejným počtem kroků a stejnými volitelnými poli, pole v limitech;
 * - žádný klíč není ve dvou balících; balík obsahuje právě klíče ze svého výčtu (tips-manifest.ts);
 * - výčet pokrývá všechna tlačítka nalezená ve zdrojích (pás karet v cad-app.tsx, nabídky, pás skici, lišty výkresu)
 *   a všechny viditelné prvky rozšíření; chybějící se vypíší po kontextech;
 * - textový příkaz `cmd` projde parserem bez „neznámý příkaz“.
 * Balíky v PENDING_PACKAGES se na úplnost nekontrolují (jejich obsah se píše); vynutit: TIPS_CHECK=edit,ext.
 */
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { FILTER_LABEL } from "@/components/cad/selection";
import { parseAgentText } from "../agent";
import { visibleExt } from "../ext/index";
import { ADVANCED, MECHANICAL } from "../mate-spec";
import { TIP_LIMITS, lookupTip, resolveTip, tipKeys, type MicroTip } from "./tips";
import { CS_TIPS, TIP_PACKAGES, loadTipPackage, type TipPackage } from "./tips/index";
import { PENDING_PACKAGES, TIP_MANIFEST } from "./tips-manifest";

const LANGS = ["cs", "en", "de"] as const;
type Lang = (typeof LANGS)[number];
const SRC = path.resolve(__dirname, "../..");
const read = (rel: string) => fs.readFileSync(path.join(SRC, rel), "utf8");

const forced = new Set((process.env.TIPS_CHECK ?? "").split(",").map((s) => s.trim()).filter(Boolean));
const checked = (p: TipPackage) => forced.has(p) || forced.has("all") || !PENDING_PACKAGES.includes(p);

async function allPackages(): Promise<Record<Lang, Record<TipPackage, Record<string, MicroTip>>>> {
  const out = {} as Record<Lang, Record<TipPackage, Record<string, MicroTip>>>;
  for (const l of LANGS) {
    out[l] = {} as Record<TipPackage, Record<string, MicroTip>>;
    for (const p of TIP_PACKAGES) out[l][p] = await loadTipPackage(l, p);
  }
  return out;
}

// ───────────── zdroje: id tlačítek a jejich kontext ─────────────

type Found = { ctx: string; id: string; file: string };
type DynMenu = { ctx: string; file: string };

/**
 * Projde blok kódu a vrátí literální `id: "…"` s kontextem: uvnitř hodnoty vlastnosti `menu:` je kontext
 * `menu:<id objektu s nabídkou>`, jinak `baseCtx`. Nabídka bez literálních id (např. `.map((c) => ({ id: c.c … }))`)
 * se vrátí jako dynamická. Hodnota `menu: identifikátor` se rozvine přes `idents`.
 */
function scanBlock(src: string, baseCtx: string, file: string, idents: Record<string, (ctx: string) => { found: Found[]; dyn: DynMenu[] }> = {}): { found: Found[]; dyn: DynMenu[] } {
  const found: Found[] = [];
  const dyn: DynMenu[] = [];
  type Frame = { ch: string; objId?: string };
  const stack: Frame[] = [];
  const menus: { depth: number; ctx: string; nonLiteral: boolean }[] = [];
  const modes: ("code" | "tpl")[] = ["code"];
  const closeMenusAbove = (depth: number) => {
    while (menus.length && menus[menus.length - 1].depth > depth) {
      const m = menus.pop()!;
      if (m.nonLiteral) dyn.push({ ctx: m.ctx, file });
    }
  };
  const ident = (i: number) => i > 0 && /[\w$]/.test(src[i - 1]);
  let i = 0;
  while (i < src.length) {
    const c = src[i];
    if (modes[modes.length - 1] === "tpl") {
      if (c === "\\") i += 2;
      else if (c === "`") {
        modes.pop();
        i++;
      } else if (c === "$" && src[i + 1] === "{") {
        modes.push("code");
        stack.push({ ch: "${" });
        i += 2;
      } else i++;
      continue;
    }
    if (c === "/" && src[i + 1] === "/") {
      i = src.indexOf("\n", i);
      if (i < 0) break;
      continue;
    }
    if (c === "/" && src[i + 1] === "*") {
      i = src.indexOf("*/", i) + 2;
      continue;
    }
    if (c === '"' || c === "'") {
      let j = i + 1;
      while (j < src.length && src[j] !== c) j += src[j] === "\\" ? 2 : 1;
      i = j + 1;
      continue;
    }
    if (c === "`") {
      modes.push("tpl");
      i++;
      continue;
    }
    if (c === "{" || c === "[" || c === "(") {
      stack.push({ ch: c });
      i++;
      continue;
    }
    if (c === "}" || c === "]" || c === ")") {
      const top = stack.pop();
      if (top?.ch === "${") modes.pop();
      closeMenusAbove(stack.length);
      if (c === "}" && menus.length && menus[menus.length - 1].depth === stack.length) closeMenusAbove(stack.length - 1);
      i++;
      continue;
    }
    if (c === "," && menus.length && menus[menus.length - 1].depth === stack.length) {
      closeMenusAbove(stack.length - 1);
      i++;
      continue;
    }
    if (!ident(i) && src.startsWith("menu", i)) {
      const m = /^menu\s*:\s*/.exec(src.slice(i, i + 40));
      if (m) {
        const parent = [...stack].reverse().find((f) => f.ch === "{")?.objId ?? "?";
        const ctx = `menu:${parent}`;
        const rest = src.slice(i + m[0].length, i + m[0].length + 80);
        const id = /^([A-Za-z_$][\w$]*)\s*[,}\n]/.exec(rest);
        if (id && idents[id[1]]) {
          const sub = idents[id[1]](ctx);
          found.push(...sub.found);
          dyn.push(...sub.dyn);
          i += m[0].length + id[1].length;
          continue;
        }
        if (id) dyn.push({ ctx, file }); // neznámý identifikátor = dynamická nabídka
        else menus.push({ depth: stack.length, ctx, nonLiteral: false });
        i += m[0].length;
        continue;
      }
    }
    if (!ident(i) && src.startsWith("id", i)) {
      const m = /^id\s*:\s*/.exec(src.slice(i, i + 10));
      const top = stack[stack.length - 1];
      if (m && top?.ch === "{") {
        const j = i + m[0].length;
        const lit = /^"([^"\\]*)"/.exec(src.slice(j, j + 120));
        const ctx = menus.length ? menus[menus.length - 1].ctx : baseCtx;
        if (lit) {
          top.objId ??= lit[1];
          found.push({ ctx, id: lit[1], file });
        } else {
          top.objId ??= "?";
          if (menus.length) menus[menus.length - 1].nonLiteral = true;
        }
        i = j;
        continue;
      }
    }
    i++;
  }
  closeMenusAbove(-1);
  return { found, dyn };
}

/** Text mezi začátkem `start` a prvním výskytem `end` za ním. */
function between(src: string, start: string, end: string): string {
  const a = src.indexOf(start);
  if (a < 0) throw new Error(`nenalezeno: ${start}`);
  const b = src.indexOf(end, a + start.length);
  if (b < 0) throw new Error(`nenalezeno: ${end}`);
  return src.slice(a, b);
}

/** Všechna tlačítka s mikronávodem, která jdou najít ve zdrojích (statická id), a dynamické nabídky. */
function sourceButtons(): { found: Found[]; dyn: DynMenu[]; quick: Found[] } {
  const app = read("components/cad/cad-app.tsx");
  const sketcher = read("components/cad/sketcher.tsx");
  const dws = read("components/cad/drawing-workspace.tsx");
  const dvp = read("components/cad/drawing-views-panel.tsx");
  const presets = read("components/cad/shape-presets.tsx");
  const found: Found[] = [];
  const dyn: DynMenu[] = [];
  const F = "cad-app.tsx";
  const exportsBlock = between(app, "const EXPORTS:", "];");
  const exportIds = [...exportsBlock.matchAll(/\{ f: "([^"]+)"/g)].map((m) => m[1]);
  const sketchPlanes = between(app, "const sketchPlanes: RMenuEntry[] = [", "\n  ];");
  const idents = {
    sketchPlanes: (ctx: string) => scanBlock(sketchPlanes.slice(sketchPlanes.indexOf("[")), ctx, F),
    exportEntries: (ctx: string) => ({ found: exportIds.map((id) => ({ ctx, id, file: F })), dyn: [] }),
  };
  // pás karet: baseGroups po kartách (vlastnosti objektu odsazené 4 mezerami)
  const base = between(app, "const baseGroups:", "const groups: Record<Tab");
  const parts = [...base.matchAll(/^ {4}(\w+): /gm)];
  parts.forEach((m, k) => {
    const tab = m[1];
    const body = base.slice(m.index! + m[0].length, k + 1 < parts.length ? parts[k + 1].index : base.length);
    if (tab === "sketch") return; // sketchRibbon – níže
    const r = scanBlock(body, tab, F, idents);
    found.push(...r.found);
    dyn.push(...r.dyn);
    // položky z tabulky dvojic/trojic `["shadedEdges", tr("…"), "ikona"]` mapované na tlačítka (styl zobrazení)
    for (const t of body.matchAll(/^\s*\["(\w+)", tr\("[^"]*"\), "\w+"\],?$/gm)) found.push({ ctx: tab, id: t[1], file: F });
    if (tab === "create") found.push(...[...presets.matchAll(/\{ id: "([^"]+)"/g)].map((x) => ({ ctx: "create", id: x[1], file: "shape-presets.tsx" })));
  });
  // pás skici
  const sr = between(sketcher, "export function sketchRibbon(", "\n}\n");
  for (const m of sr.matchAll(/\b[TE]\("(\w+)"/g)) found.push({ ctx: "sketch", id: m[1], file: "sketcher.tsx" });
  for (const m of sr.matchAll(/\bid: "([^"]+)"/g)) found.push({ ctx: "sketch", id: m[1], file: "sketcher.tsx" });
  const cons = /\(\[([^\]]+)\] as ConType\[\]\)\.map\(K\)/.exec(sr);
  if (!cons) throw new Error("sketchRibbon: seznam vazeb nenalezen");
  for (const m of cons[1].matchAll(/"(\w+)"/g)) found.push({ ctx: "sketch", id: `con-${m[1]}`, file: "sketcher.tsx" });
  const snaps = /const SNAP_ORDER: SnapKind\[\] = \[([^\]]+)\]/.exec(sketcher);
  if (!snaps || !/SNAP_ORDER\.map/.test(sr)) throw new Error("sketchRibbon: SNAP_ORDER nenalezen");
  for (const m of snaps[1].matchAll(/"(\w+)"/g)) found.push({ ctx: "sketch", id: `snap-${m[1]}`, file: "sketcher.tsx" });
  // pracovní plocha výkresu: dwTip({ id: … }) / tip={{ id: … }}, nástroje kót (ann-…) a pomocných pohledů (vt-…)
  for (const m of dws.matchAll(/(?:dwTip\(\{|tip=\{\{) id: "([^"]+)"/g)) found.push({ ctx: "drawing-ws", id: m[1], file: "drawing-workspace.tsx" });
  const ann = between(dws, "const ANN_TOOLS:", "];");
  if (!/id: `ann-\$\{t\.id\}`/.test(dws)) throw new Error("drawing-workspace: id nástrojů kót (ann-…) nenalezeno");
  for (const m of ann.matchAll(/\{ id: "(\w+)"/g)) found.push({ ctx: "drawing-ws", id: `ann-${m[1]}`, file: "drawing-workspace.tsx" });
  const vt = between(dvp, "const TOOLS:", "];");
  if (!/id: `vt-\$\{t\.id\}`/.test(dvp)) throw new Error("drawing-views-panel: id pomocných pohledů (vt-…) nenalezeno");
  for (const m of vt.matchAll(/\{ id: "(\w+)"/g)) found.push({ ctx: "drawing-ws", id: `vt-${m[1]}`, file: "drawing-views-panel.tsx" });
  // rychlá lišta u výběru = první 4 aktivní položky entityMenu (jen v dílu) – všechna jejich možná id
  const em = between(app, "const entityMenu = (it: SelItem | null): RMenuEntry[] => {", "const runInterference");
  const quick = [...em.matchAll(/\bid: "([^"]+)"/g)].map((m) => ({ ctx: "quick", id: m[1], file: F }));
  return { found, dyn, quick };
}

/** Výčet známých dynamických nabídek (id položek se berou z dat, ne z literálů). */
const ENUMERATED: Record<string, string[]> = {
  "menu:filter": Object.keys(FILTER_LABEL),
  "menu:mAdv": [...ADVANCED],
  "menu:mMech": [...MECHANICAL],
};

const manifestKeys = (p?: TipPackage) => (p ? TIP_MANIFEST[p] : TIP_PACKAGES.flatMap((q) => TIP_MANIFEST[q])).map((r) => r[0]);
const DUMMY: MicroTip = { what: "x", when: "x", steps: [] };
const manifestMap = () => Object.fromEntries(manifestKeys().map((k) => [k, DUMMY]));

// ───────────── testy ─────────────

describe("mikronávody – vyhledávání klíčů", () => {
  it("pořadí: kontext/id → kontext/* → id", () => {
    expect(tipKeys("fillet", "sketch")).toEqual(["sketch/fillet", "sketch/*", "fillet"]);
    expect(tipKeys("fillet")).toEqual(["fillet"]);
    const map: Record<string, MicroTip> = {
      fillet: { what: "3D", when: "w", steps: [] },
      "sketch/fillet": { what: "2D", when: "w", steps: [] },
      "menu:color/*": { what: "barva", when: "w", steps: [] },
    };
    expect(resolveTip(map, "fillet", "sketch")?.tip.what).toBe("2D");
    expect(resolveTip(map, "fillet", "create")?.key).toBe("fillet");
    expect(resolveTip(map, "#e03930", "menu:color")?.key).toBe("menu:color/*");
    expect(resolveTip(map, "nic", "create")).toBeNull();
  });
  it("lookupTip v češtině čte statické balíky", () => {
    const anyKey = TIP_PACKAGES.flatMap((p) => Object.keys(CS_TIPS[p]))[0];
    if (!anyKey) return;
    const [ctx, id] = anyKey.includes("/") ? [anyKey.slice(0, anyKey.lastIndexOf("/")), anyKey.slice(anyKey.lastIndexOf("/") + 1)] : [undefined, anyKey];
    expect(lookupTip(id === "*" ? "cokoli" : id, ctx, "cs")).toBeTruthy();
  });
});

describe("mikronávody – výčet klíčů (tips-manifest.ts)", () => {
  it("žádný klíč není ve výčtu dvakrát ani ve dvou balících", () => {
    const all = manifestKeys();
    const dup = all.filter((k, i) => all.indexOf(k) !== i);
    expect(dup).toEqual([]);
  });
  it("klíče mají tvar id, kontext/id nebo kontext/*", () => {
    const bad = manifestKeys().filter((k) => !/^((create|surface|sheet|weld|sketch|asm|tools|view|drawing|data|quick|drawing-ws|menu:[\w.-]+)\/)?([\w.#-]+|\*)$/.test(k));
    expect(bad).toEqual([]);
  });
  it("PENDING_PACKAGES obsahuje jen známé balíky", () => {
    expect(PENDING_PACKAGES.filter((p) => !TIP_PACKAGES.includes(p))).toEqual([]);
  });

  const src = sourceButtons();
  it("zdroje: nalezeno přes 200 tlačítek pásu, nabídek, skici a výkresu (bez prvků rozšíření)", () => {
    const per: Record<string, number> = {};
    for (const f of src.found) per[f.ctx] = (per[f.ctx] ?? 0) + 1;
    expect(src.found.length, JSON.stringify(per)).toBeGreaterThan(200);
    for (const ctx of ["create", "asm", "tools", "view", "drawing", "data", "sketch", "drawing-ws", "menu:sketch", "menu:mouse", "menu:sub"]) expect(per[ctx], ctx).toBeGreaterThan(0);
  });
  it("každé tlačítko ze zdrojů má ve výčtu klíč (chybějící po kontextech)", () => {
    const map = manifestMap();
    const missing: Record<string, string[]> = {};
    for (const f of src.found) if (!resolveTip(map, f.id, f.ctx)) (missing[f.ctx] ??= []).push(f.id);
    expect(missing).toEqual({});
  });
  it("dynamické nabídky mají společný návod (kontext/*) nebo návod pro každou položku", () => {
    const map = manifestMap();
    const missing: Record<string, string[]> = {};
    for (const d of src.dyn) {
      if (map[`${d.ctx}/*`]) continue;
      const ids = ENUMERATED[d.ctx];
      if (!ids) {
        (missing[d.ctx] ??= []).push("* (dynamická nabídka bez výčtu)");
        continue;
      }
      for (const id of ids) if (!map[`${d.ctx}/${id}`]) (missing[d.ctx] ??= []).push(id);
    }
    expect(missing).toEqual({});
  });
  it("každý viditelný prvek rozšíření (src/cad/ext) má ve výčtu klíč", () => {
    const map = manifestMap();
    const miss = visibleExt().filter((d) => !resolveTip(map, d.ext, d.tab)).map((d) => `${d.tab}: ${d.ext}`);
    expect(miss).toEqual([]);
  });
  it("výčet neobsahuje klíče tlačítek, která ve zdrojích nejsou", () => {
    const ids = new Set([...src.found, ...src.quick].map((f) => `${f.ctx}|${f.id}`));
    const plain = new Set([...src.found, ...src.quick].map((f) => f.id));
    const ext = new Set(visibleExt().map((d) => d.ext));
    const enumerated = new Set(Object.entries(ENUMERATED).flatMap(([c, l]) => l.map((id) => `${c}|${id}`)));
    const stale = manifestKeys().filter((k) => {
      if (k.endsWith("/*")) return false;
      const cut = k.lastIndexOf("/");
      if (cut < 0) return !plain.has(k) && !ext.has(k);
      const ctx = k.slice(0, cut);
      const id = k.slice(cut + 1);
      return !ids.has(`${ctx}|${id}`) && !enumerated.has(`${ctx}|${id}`);
    });
    expect(stale).toEqual([]);
  });
});

describe("mikronávody – obsah balíků", async () => {
  const pk = await allPackages();
  const keysOf = (l: Lang, p: TipPackage) => Object.keys(pk[l][p]).sort();

  it("žádný klíč není ve dvou balících", () => {
    for (const l of LANGS) {
      const seen = new Map<string, TipPackage>();
      const dup: string[] = [];
      for (const p of TIP_PACKAGES) for (const k of Object.keys(pk[l][p])) seen.has(k) ? dup.push(`${l}: ${k} (${seen.get(k)} + ${p})`) : seen.set(k, p);
      expect(dup).toEqual([]);
    }
  });

  for (const p of TIP_PACKAGES) {
    describe(`balík ${p}`, () => {
      it("angličtina a němčina mají stejné klíče jako čeština", () => {
        expect(keysOf("en", p)).toEqual(keysOf("cs", p));
        expect(keysOf("de", p)).toEqual(keysOf("cs", p));
      });
      it("stejný počet kroků a stejná volitelná pole ve všech jazycích", () => {
        const bad: string[] = [];
        for (const [k, cs] of Object.entries(pk.cs[p])) {
          for (const l of ["en", "de"] as const) {
            const t = pk[l][p][k];
            if (!t) continue;
            if (t.steps.length !== cs.steps.length) bad.push(`${l} ${k}: kroků ${t.steps.length} ≠ ${cs.steps.length}`);
            for (const f of ["select", "cmd", "note"] as const) if (!!t[f] !== !!cs[f]) bad.push(`${l} ${k}: pole ${f} ${t[f] ? "navíc" : "chybí"}`);
          }
        }
        expect(bad).toEqual([]);
      });
      it("pole jsou neprázdné texty v délkových limitech, bez emoji", () => {
        const bad: string[] = [];
        // limity platí pro češtinu; angličtina a němčina mají rezervu 35 % (delší slova)
        for (const l of LANGS) {
          const f = l === "cs" ? 1 : 1.35;
          const lim = (n: number) => Math.round(n * f);
          for (const [k, t] of Object.entries(pk[l][p])) {
            const check = (name: string, v: unknown, max: number, required: boolean) => {
              if (v === undefined && !required) return;
              if (typeof v !== "string" || !v.trim()) return bad.push(`${l} ${k}.${name}: prázdné`);
              if (v.length > max) bad.push(`${l} ${k}.${name}: ${v.length} > ${max} znaků`);
              if (/\p{Extended_Pictographic}/u.test(v)) bad.push(`${l} ${k}.${name}: emoji`);
              if (v !== v.trim()) bad.push(`${l} ${k}.${name}: mezery na okraji`);
            };
            check("what", t.what, lim(TIP_LIMITS.what), true);
            check("when", t.when, lim(TIP_LIMITS.when), true);
            check("select", t.select, lim(TIP_LIMITS.select), false);
            check("cmd", t.cmd, TIP_LIMITS.cmd, false);
            check("note", t.note, lim(TIP_LIMITS.note), false);
            if (!Array.isArray(t.steps) || t.steps.length < 1 || t.steps.length > TIP_LIMITS.steps) bad.push(`${l} ${k}.steps: ${t.steps?.length} kroků (1–${TIP_LIMITS.steps})`);
            t.steps?.forEach((s, i) => check(`steps[${i}]`, s, lim(TIP_LIMITS.step), true));
            const extra = Object.keys(t).filter((x) => !["what", "when", "select", "steps", "cmd", "note"].includes(x));
            if (extra.length) bad.push(`${l} ${k}: neznámá pole ${extra.join(", ")}`);
          }
        }
        expect(bad).toEqual([]);
      });
      it("obsahuje jen klíče ze svého výčtu", () => {
        const allowed = new Set(manifestKeys(p));
        expect(keysOf("cs", p).filter((k) => !allowed.has(k))).toEqual([]);
      });
      it.skipIf(!checked(p))("obsahuje všechny klíče ze svého výčtu (pokrytí)", () => {
        const have = new Set(keysOf("cs", p));
        const missing = manifestKeys(p).filter((k) => !have.has(k));
        expect(missing, `balík ${p}: chybí ${missing.length} z ${manifestKeys(p).length}`).toEqual([]);
      });
      it("textové příkazy (cmd) parser zná", () => {
        const bad: string[] = [];
        for (const l of LANGS)
          for (const [k, t] of Object.entries(pk[l][p])) {
            if (!t.cmd) continue;
            const errs = parseAgentText(t.cmd).errors.map((e) => e.message);
            const unknown = errs.find((m) => /neznámý příkaz|neznámý typ prvku|neznámá entita|Prázdný vstup/.test(m));
            if (unknown) bad.push(`${l} ${k}: „${t.cmd}“ → ${unknown.slice(0, 120)}`);
          }
        expect(bad).toEqual([]);
      });
    });
  }

  it("souhrn pokrytí po balících (informativní)", () => {
    const rows = TIP_PACKAGES.map((p) => {
      const have = new Set(Object.keys(pk.cs[p]));
      const miss = manifestKeys(p).filter((k) => !have.has(k));
      return `${p}: ${manifestKeys(p).length - miss.length}/${manifestKeys(p).length}${PENDING_PACKAGES.includes(p) ? " (rozpracováno)" : ""}${miss.length && miss.length <= 12 ? ` – chybí: ${miss.join(", ")}` : ""}`;
    });
    console.info(`mikronávody:\n  ${rows.join("\n  ")}`);
    expect(rows.length).toBe(TIP_PACKAGES.length);
  });
});
