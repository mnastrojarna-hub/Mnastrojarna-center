#!/usr/bin/env node
/**
 * Codemod: obalí české texty v CAD komponentách a jádře do `tr("…")` (src/cad/i18n) a vypíše seznam klíčů.
 *
 *   node scripts/cad-i18n-codemod.mjs            – upraví soubory na místě
 *   node scripts/cad-i18n-codemod.mjs --dry      – jen vypíše, co by změnil
 *   node scripts/cad-i18n-codemod.mjs --keys out.json – navíc uloží klíče (klíč → soubory)
 *
 * Pravidla (TypeScript AST):
 *  - JSX text s písmeny                        → {tr("text")}
 *  - JSX atributy title/placeholder/aria-label/label/hint/desc/… → {tr("…")}
 *  - vlastnosti objektů label/hint/title/desc/text/l/q/a/body/… → tr("…")
 *  - šablony `…${x}…` na těchto místech          → tr("… {0} …", x)
 *  - argumenty volání (flash, notice, new Error, log.push, …) a návratové hodnoty, které vypadají česky
 *    (diakritika nebo více slov)                 → tr("…")
 *  - přeskočí: className, id, icon, kbd, key, href, src, porovnání (===), case, importy, regexy, testy
 * Idempotentní: text uvnitř tr(...) se znovu neobaluje.
 */
import fs from "node:fs";
import path from "node:path";
import ts from "typescript";

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const args = process.argv.slice(2);
const DRY = args.includes("--dry");
const EXTRACT = args.includes("--extract"); // jen posbírat klíče existujících tr("…") volání
const keysOut = args.includes("--keys") ? args[args.indexOf("--keys") + 1] : null;

const DIRS = ["src/components/cad", "src/cad", "src/lib/mesh-metrics.ts"];
const SKIP_FILES = [/\.test\.tsx?$/, /agent-guide\.ts$/, /\/i18n\//, /cad-docs/, /__fixtures__/, /dwg-versions/];
const ATTRS = new Set(["title", "placeholder", "aria-label", "label", "hint", "desc", "description", "summary", "alt", "caption", "tooltip", "k", "legend", "help", "subtitle", "prefix", "emptyText", "noneLabel"]);
const PROPS = new Set(["label", "hint", "title", "desc", "description", "summary", "placeholder", "text", "lead", "q", "a", "l", "caption", "message", "note", "tooltip", "help", "subtitle", "legend", "body", "short", "long", "warning", "error", "info", "unitLabel", "emptyText", "noneLabel", "cmdLabel", "name_cs"]);
const CALLEES_ANY = new Set(["flash", "notice", "askNum", "confirm", "window.confirm", "window.prompt", "prompt", "alert", "setToast", "setError", "setErr", "fail", "warn", "log.push", "lines.push", "out.push", "parts.push", "errors.push", "warnings.push", "problems.push", "notes.push", "cell", "T", "Row", "addNote", "toast", "setStatus", "setMsg", "humanError", "Error"]);
const CALLEE_BLACKLIST = /^(syn|fold|canon|new Set|includes|test|match|replace|replaceAll|split|startsWith|endsWith|indexOf|localStorage\.\w+|sessionStorage\.\w+|getItem|setItem|removeItem|querySelector\w*|getElementById|addEventListener|removeEventListener|track|console\.\w+|new RegExp|RegExp|Intl\.\w+|toLocale\w+|classList\.\w+|cn|clsx|getByRole|getByText|getByLabel|require|import|fetch|new URL|URL|encodeURIComponent|decodeURIComponent|atob|btoa|createElement|setAttribute|getAttribute|hasAttribute|new Worker|postMessage|dispatchEvent|new Event|new CustomEvent|new Blob|new File|JSON\.\w+|Object\.\w+|Array\.\w+|Number|String|parseInt|parseFloat|Math\.\w+|Date|new Date|key|keyOf|sourceKey|uid|open|window\.open|navigator\.\w+|normalize|padStart|padEnd|repeat|charAt|codePointAt|fromCharCode|getOC|r\.\w+|oc\.\w+|o\.\w+|describe|it|expect|vi\.\w+|beforeAll|registerExt|registerIcon|registerFeatureBuilder|registerFeatureForm|registerExtUi|toolBuilder|getExt|getExtUi|getFeatureForm|getFeatureBuilder|threadByName|planeOf|axisVec|readFileSync|writeFileSync|resolve|join|exec|setBinding|evalExpr|isExpression|exprRefs|wrapExpr|unwrapExpr|setView|setTab|setTool|setMode|toFixed|has|get|set|delete|add|push\b|emit|on|off|once|register|unregister|define|lookup|find|filter|map|some|every|reduce|sort|concat|slice|splice|at|assign|freeze|keys|values|entries|from|of|is|parse|stringify|format|toString|valueOf|toUpperCase|toLowerCase|trim|localeCompare|measureVolume|measureArea|makeBox|makeCylinder|makeSphere|makeHelix|makePlane|sketchOnPlane|drawText|loadFont|getFont|cast|downcast|setOC|getLang|setLang|tr|langFromPath|cadLocale|t|L|P|E|K|V\.\w+)$/;
const CZ_RE = /[ěščřžýáíéúůťďňĚŠČŘŽÝÁÍÉÚŮŤĎŇ]/;
const LETTER_RE = /\p{L}/u;

/** Vypadá řetězec jako česká věta / popisek (ne identifikátor, cesta, barva…)? */
/** seznam CSS tříd (w-full rounded-md …) – nikdy nepřekládat */
const isCss = (s) => !CZ_RE.test(s) && /^[a-z0-9!\-\[\]:./%()#,]+(\s+[a-z0-9!\-\[\]:./%()#,]+)+$/i.test(s.trim()) && /[-:\[]/.test(s);
function looksCzech(s) {
  if (!LETTER_RE.test(s) || isCss(s)) return false;
  if (/^[#\w./:@%+-]+$/.test(s) && !CZ_RE.test(s)) return false; // identifikátor, cesta, barva, číslo s jednotkou
  if (/^https?:|^\/|^mailto:|^data:|^#[0-9a-f]{3,8}$/i.test(s)) return false;
  if (/^[a-z][a-zA-Z0-9]*$/.test(s) && !CZ_RE.test(s)) return false; // camelCase / id
  if (/^[A-Z][A-Z0-9_]*$/.test(s)) return false; // KONSTANTA / zkratka (XY, STEP)
  if (CZ_RE.test(s)) return true;
  return /\s/.test(s.trim()) || /[–—„“…]/.test(s);
}
/** Pro JSX text / popiskové pozice: stačí písmena (i jednoslovné „Skica“), ale ne čisté symboly/jednotky. */
function looksLabel(s) {
  const t = s.trim();
  if (!LETTER_RE.test(t) || isCss(t)) return false;
  if (/^<|<\/\w+>/.test(t)) return false; // kus HTML/SVG
  if (!CZ_RE.test(t) && !/\s/.test(t) && /\{\d+\}/.test(t)) return false; // kód / názvy souborů / selektory se zástupným výrazem
  if (/^\[data-|^matrix3d|^=\w/.test(t)) return false;
  if (/^(mm|cm|m|kg|g|ks|°|%|mm²|mm³|cm³|px|pt|s|ms|x|×|Ø|R|M|H|V|Z|X|Y|XY|XZ|YZ|OK|ID|PDF|DXF|DWG|STEP|STL|SVG|CSV|JSON|3MF|OBJ|IGES|BREP|glTF|GLB|PLY|OFF|WRL|URL|API|AI|CAD|CNC|ISO|DIN|ČSN|EN|HLR|OCCT|WebGL|AV|ƒx|F|E|P|O|N|A|B|C|D|S|T|W|L)$/.test(t)) return false;
  if (/^[#\w.:/%+-]+$/.test(t) && !CZ_RE.test(t) && !/^[A-ZÁ-Ž][a-zá-ž]+$/.test(t)) return false; // ids, ale „Skica“ projde
  return true;
}

const keys = new Map(); // key → Set(files)
const stats = { files: 0, changed: 0, jsx: 0, attr: 0, prop: 0, tpl: 0, call: 0, ret: 0, decl: 0 };

function escapeKey(s) {
  return JSON.stringify(s);
}
/** Šablona → [klíč s {i}, výrazy] */
function templateToKey(node, sf) {
  let key = node.head.text;
  const exprs = [];
  node.templateSpans.forEach((span, i) => {
    key += `{${i}}` + span.literal.text;
    exprs.push(span.expression.getText(sf));
  });
  return { key, exprs };
}

function walkFile(file) {
  const text = fs.readFileSync(file, "utf8");
  if (!EXTRACT && !/[ěščřžýáíéúůťďň]/i.test(text)) return; // bez českých znaků nic (jednoslovné popisky bez diakritiky jsou v souborech s diakritikou)
  const sf = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, file.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
  const edits = []; // {start,end,text}
  const wrapped = new Set(); // node positions already wrapped (avoid nested double wrap)
  const rel = path.relative(ROOT, file);
  const addKey = (k) => {
    if (!keys.has(k)) keys.set(k, new Set());
    keys.get(k).add(rel);
  };
  const insideTr = (n) => {
    for (let p = n.parent; p; p = p.parent) {
      if (ts.isCallExpression(p) && p.expression.getText(sf) === "tr") return true;
    }
    return false;
  };
  const wrapString = (node, kind) => {
    if (wrapped.has(node.pos) || insideTr(node)) return;
    const s = node.text;
    addKey(s);
    edits.push({ start: node.getStart(sf), end: node.getEnd(), text: `tr(${escapeKey(s)})` });
    wrapped.add(node.pos);
    stats[kind]++;
  };
  const wrapTemplate = (node, kind) => {
    if (wrapped.has(node.pos) || insideTr(node)) return;
    const { key, exprs } = templateToKey(node, sf);
    if (!looksLabel(key.replace(/\{\d+\}/g, " ")) || !looksLabel(key)) return;
    addKey(key);
    edits.push({ start: node.getStart(sf), end: node.getEnd(), text: `tr(${escapeKey(key)}${exprs.length ? ", " + exprs.join(", ") : ""})` });
    wrapped.add(node.pos);
    stats[kind]++;
  };
  /** výraz na „hodnotové“ pozici: řetězec / šablona / podmínka / ?? / || */
  const wrapValueExpr = (e, kind, pred) => {
    if (!e) return;
    if (ts.isParenthesizedExpression(e)) return wrapValueExpr(e.expression, kind, pred);
    if (ts.isStringLiteral(e) || ts.isNoSubstitutionTemplateLiteral(e)) {
      if (pred(e.text)) wrapString(e, kind);
      return;
    }
    if (ts.isTemplateExpression(e)) return wrapTemplate(e, kind);
    if (ts.isConditionalExpression(e)) {
      wrapValueExpr(e.whenTrue, kind, pred);
      wrapValueExpr(e.whenFalse, kind, pred);
      return;
    }
    if (ts.isBinaryExpression(e) && (e.operatorToken.kind === ts.SyntaxKind.QuestionQuestionToken || e.operatorToken.kind === ts.SyntaxKind.BarBarToken)) {
      wrapValueExpr(e.left, kind, pred);
      wrapValueExpr(e.right, kind, pred);
      return;
    }
    if (ts.isBinaryExpression(e) && e.operatorToken.kind === ts.SyntaxKind.PlusToken) {
      wrapValueExpr(e.left, kind, pred);
      wrapValueExpr(e.right, kind, pred);
    }
  };
  const calleeName = (c) => {
    const ex = c.expression;
    if (ts.isIdentifier(ex)) return ex.text;
    if (ts.isPropertyAccessExpression(ex)) return ex.getText(sf);
    if (ts.isNewExpression(c)) return "new " + c.expression.getText(sf);
    return ex.getText(sf);
  };

  if (EXTRACT) {
    const collect = (n) => {
      if (ts.isCallExpression(n) && n.expression.getText(sf) === "tr" && n.arguments[0] && (ts.isStringLiteral(n.arguments[0]) || ts.isNoSubstitutionTemplateLiteral(n.arguments[0]))) addKey(n.arguments[0].text);
      ts.forEachChild(n, collect);
    };
    collect(sf);
    stats.files++;
    return;
  }
  const visit = (node) => {
    // JSX text
    if (ts.isJsxText(node)) {
      const raw = node.getText(sf);
      const value = raw.replace(/\s*\n\s*/g, " ").trim();
      if (value && looksLabel(value) && !insideTr(node)) {
        const leadSpace = /^[ \t]+\S/.test(raw) && !/^\s*\n/.test(raw);
        const trailSpace = /\S[ \t]+$/.test(raw) && !/\n\s*$/.test(raw);
        const lead = raw.match(/^\s*/)[0];
        const trail = raw.match(/\s*$/)[0];
        const keepLead = lead.includes("\n") ? lead : "";
        const keepTrail = trail.includes("\n") ? trail : "";
        addKey(value);
        edits.push({ start: node.getStart(sf), end: node.getEnd(), text: `${keepLead}${leadSpace ? "{\" \"}" : ""}{tr(${escapeKey(value)})}${trailSpace ? "{\" \"}" : ""}${keepTrail}` });
        stats.jsx++;
      }
      return;
    }
    // JSX atribut
    if (ts.isJsxAttribute(node) && node.initializer) {
      const name = node.name.getText(sf);
      if (ATTRS.has(name)) {
        const init = node.initializer;
        if (ts.isStringLiteral(init)) {
          if (looksLabel(init.text) && !wrapped.has(init.pos)) {
            addKey(init.text);
            edits.push({ start: init.getStart(sf), end: init.getEnd(), text: `{tr(${escapeKey(init.text)})}` });
            wrapped.add(init.pos);
            stats.attr++;
          }
          return;
        }
        if (ts.isJsxExpression(init) && init.expression) wrapValueExpr(init.expression, "attr", looksLabel);
      }
      ts.forEachChild(node, visit);
      return;
    }
    // JSX výraz jako potomek: {cond ? "A" : "B"}, {`… ${x}`}
    if (ts.isJsxExpression(node) && node.expression && node.parent && (ts.isJsxElement(node.parent) || ts.isJsxFragment(node.parent))) {
      wrapValueExpr(node.expression, "tpl", looksLabel);
      ts.forEachChild(node, visit);
      return;
    }
    // vlastnost objektu
    if (ts.isPropertyAssignment(node)) {
      const name = ts.isIdentifier(node.name) || ts.isStringLiteral(node.name) ? node.name.text : "";
      if (PROPS.has(name)) wrapValueExpr(node.initializer, "prop", looksLabel);
      ts.forEachChild(node, visit);
      return;
    }
    // volání / new Error
    if (ts.isCallExpression(node) || ts.isNewExpression(node)) {
      const name = calleeName(node);
      const bare = name.replace(/^new /, "");
      const any = CALLEES_ANY.has(bare) || bare === "Error";
      if (!CALLEE_BLACKLIST.test(bare) || any) {
        for (const a of node.arguments ?? []) wrapValueExpr(a, "call", any ? looksLabel : looksCzech);
      }
      ts.forEachChild(node, visit);
      return;
    }
    // throw "…" / return "…"
    if (ts.isReturnStatement(node) && node.expression) wrapValueExpr(node.expression, "ret", looksCzech);
    if (ts.isThrowStatement(node) && node.expression) wrapValueExpr(node.expression, "ret", looksCzech);
    // const x = "český text"
    if (ts.isVariableDeclaration(node) && node.initializer && (ts.isStringLiteral(node.initializer) || ts.isTemplateExpression(node.initializer))) {
      // KONSTANTY (G, TAB, GROUP…) bývají klíče skupin / identifikátory – nechat; překládají se až při zobrazení
      const vname = ts.isIdentifier(node.name) ? node.name.text : "";
      if (!/^[A-Z][A-Z0-9_]*$/.test(vname)) wrapValueExpr(node.initializer, "decl", (s) => CZ_RE.test(s) || /\s\S+\s/.test(s.trim()));
    }
    // přiřazení: x.title = "…", el.textContent = "…"
    if (ts.isBinaryExpression(node) && node.operatorToken.kind === ts.SyntaxKind.EqualsToken && (ts.isStringLiteral(node.right) || ts.isTemplateExpression(node.right))) {
      const lhs = node.left.getText(sf);
      if (/\.(title|textContent|innerText|placeholder|label|value|ariaLabel|hint)$/.test(lhs)) wrapValueExpr(node.right, "decl", looksCzech);
    }
    // pole řetězců v hodnotové pozici vlastnosti (items: ["…", "…"]) – jen česky vypadající
    if (ts.isArrayLiteralExpression(node) && node.parent && ts.isPropertyAssignment(node.parent)) {
      const pname = ts.isIdentifier(node.parent.name) ? node.parent.name.text : "";
      if (["items", "lines", "notes", "steps", "options", "hints", "tips", "bullets"].includes(pname)) for (const el of node.elements) wrapValueExpr(el, "prop", looksCzech);
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  stats.files++;
  if (!edits.length) return;
  // aplikovat od konce; zahodit překryvy (vnořené) – vnější má přednost
  edits.sort((a, b) => b.start - a.start || a.end - b.end);
  const final = [];
  let lastStart = Infinity;
  for (const e of edits) {
    if (e.end > lastStart) continue; // překryv s již přijatým (vnitřní uvnitř vnějšího) – vnější (pozdější v poli? ne) …
    final.push(e);
    lastStart = e.start;
  }
  let out = text;
  for (const e of final) out = out.slice(0, e.start) + e.text + out.slice(e.end);
  // import
  if (!/import \{[^}]*\btr\b[^}]*\} from "(@\/cad\/i18n|\.{1,2}\/[./]*i18n)";/.test(out)) {
    const relImport = rel.startsWith("src/components/") || rel.startsWith("src/lib/") ? "@/cad/i18n" : path.relative(path.dirname(file), path.join(ROOT, "src/cad/i18n")).replace(/\\/g, "/").replace(/^(?!\.)/, "./");
    // vložit před první import (podle AST původního textu – posuny editací jsou až za importy)
    const firstImport = sf.statements.find((st) => ts.isImportDeclaration(st));
    const imp = `import { tr } from "${relImport}";\n`;
    if (firstImport) {
      const at = firstImport.getStart(sf);
      out = out.slice(0, at) + imp + out.slice(at);
    } else {
      const useClient = out.startsWith('"use client";');
      out = useClient ? out.replace(/^"use client";\n\n?/, (m) => m + imp) : imp + out;
    }
  }
  stats.changed++;
  if (DRY) console.log(`${rel}: ${final.length} změn`);
  else fs.writeFileSync(file, out);
}

function listFiles(p) {
  const abs = path.join(ROOT, p);
  if (fs.statSync(abs).isFile()) return [abs];
  const out = [];
  for (const e of fs.readdirSync(abs, { withFileTypes: true })) {
    const f = path.join(abs, e.name);
    if (e.isDirectory()) out.push(...listFiles(path.relative(ROOT, f)));
    else if (/\.tsx?$/.test(e.name)) out.push(f);
  }
  return out;
}

for (const d of DIRS) for (const f of listFiles(d)) if (!SKIP_FILES.some((re) => re.test(f))) walkFile(f);
console.log(`soubory ${stats.files}, změněno ${stats.changed}; jsx ${stats.jsx}, atributy ${stats.attr}, vlastnosti ${stats.prop}, šablony/výrazy ${stats.tpl}, volání ${stats.call}, return/throw ${stats.ret}, deklarace ${stats.decl}; klíčů ${keys.size}`);
if (keysOut) fs.writeFileSync(keysOut, JSON.stringify(Object.fromEntries([...keys.entries()].sort((a, b) => a[0].localeCompare(b[0], "cs")).map(([k, v]) => [k, [...v]])), null, 1));
