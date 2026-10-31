/**
 * Parametry dílu: bezpečný vyhodnocovač výrazů (bez eval/Function), proměnné (rovnice),
 * vazby parametrů prvků na výrazy a stavy (konfigurace) – obdoba „Správce rovnic“ v ZW3D/Inventoru.
 * Goniometrické funkce pracují ve stupních.
 */
import type { CadDoc, Feature, Variable } from "./types";

type Tok = { t: "num"; v: number } | { t: "id"; v: string } | { t: "op"; v: string };

const FUNCS: Record<string, (...a: number[]) => number> = {
  sin: (x) => Math.sin((x * Math.PI) / 180),
  cos: (x) => Math.cos((x * Math.PI) / 180),
  tan: (x) => Math.tan((x * Math.PI) / 180),
  asin: (x) => (Math.asin(x) * 180) / Math.PI,
  acos: (x) => (Math.acos(x) * 180) / Math.PI,
  atan: (x) => (Math.atan(x) * 180) / Math.PI,
  sqrt: Math.sqrt,
  abs: Math.abs,
  min: (...a) => Math.min(...a),
  max: (...a) => Math.max(...a),
  round: Math.round,
  floor: Math.floor,
  ceil: Math.ceil,
};
const CONSTS: Record<string, number> = { pi: Math.PI, PI: Math.PI };

export const EXPR_FUNCTIONS = Object.keys(FUNCS);

function tokenize(src: string): Tok[] {
  const out: Tok[] = [];
  const s = src.replace(/^\s*=/, "");
  // Desetinná čárka: platí, pokud výraz nevolá funkci, nebo jsou argumenty oddělené středníkem (jako v Excelu).
  const commaDecimal = s.includes(";") || !/[A-Za-z_\u00C0-\u024F]\s*\(/.test(s);
  const numRe = commaDecimal ? /^(\d+(?:[.,]\d+)?|\d+\.|[.,]\d+)(?:e[-+]?\d+)?/i : /^(\d+(?:\.\d+)?|\d+\.|\.\d+)(?:e[-+]?\d+)?/i;
  let i = 0;
  while (i < s.length) {
    const c = s[i];
    if (/\s/.test(c)) {
      i++;
      continue;
    }
    // číslo (desetinná čárka i tečka, exponent)
    const num = numRe.exec(s.slice(i));
    if (num) {
      out.push({ t: "num", v: Number(num[0].replace(",", ".")) });
      i += num[0].length;
      continue;
    }
    const id = /^[A-Za-z_À-ɏ][A-Za-z0-9_À-ɏ]*/.exec(s.slice(i));
    if (id) {
      out.push({ t: "id", v: id[0] });
      i += id[0].length;
      continue;
    }
    if ("+-*/^(),;".includes(c)) {
      out.push({ t: "op", v: c === ";" ? "," : c });
      i++;
      continue;
    }
    throw new Error(`Neplatný znak „${c}“ ve výrazu.`);
  }
  return out;
}

/** Názvy proměnných, na které výraz odkazuje (bez funkcí a konstant). */
export function exprRefs(expr: string): string[] {
  try {
    const toks = tokenize(expr);
    const refs = new Set<string>();
    toks.forEach((t, k) => {
      if (t.t !== "id") return;
      const next = toks[k + 1];
      if (next?.t === "op" && next.v === "(") return; // volání funkce
      if (t.v in CONSTS) return;
      refs.add(t.v);
    });
    return [...refs];
  } catch {
    return [];
  }
}

/** Vyhodnotí výraz; neznámá proměnná nebo chyba syntaxe → Error s českou zprávou. */
export function evalExpr(expr: string, scope: Record<string, number> = {}): number {
  const toks = tokenize(expr);
  if (!toks.length) throw new Error("Prázdný výraz.");
  let p = 0;
  const peek = () => toks[p];
  const isOp = (v: string) => peek()?.t === "op" && peek()!.v === v;
  const expect = (v: string) => {
    if (!isOp(v)) throw new Error(`Ve výrazu chybí „${v}“.`);
    p++;
  };

  // expr := term (('+'|'-') term)*
  const parseExpr = (): number => {
    let v = parseTerm();
    while (isOp("+") || isOp("-")) {
      const op = toks[p++].v;
      const r = parseTerm();
      v = op === "+" ? v + r : v - r;
    }
    return v;
  };
  // term := unary (('*'|'/') unary)*
  const parseTerm = (): number => {
    let v = parseUnary();
    while (isOp("*") || isOp("/")) {
      const op = toks[p++].v;
      const r = parseUnary();
      if (op === "/" && r === 0) throw new Error("Dělení nulou.");
      v = op === "*" ? v * r : v / r;
    }
    return v;
  };
  // unary := ('-'|'+') unary | power
  const parseUnary = (): number => {
    if (isOp("-")) {
      p++;
      return -parseUnary();
    }
    if (isOp("+")) {
      p++;
      return parseUnary();
    }
    return parsePower();
  };
  // power := primary ('^' unary)?   (pravě asociativní)
  const parsePower = (): number => {
    const b = parsePrimary();
    if (isOp("^")) {
      p++;
      return Math.pow(b, parseUnary());
    }
    return b;
  };
  const parsePrimary = (): number => {
    const t = toks[p];
    if (!t) throw new Error("Neúplný výraz.");
    if (t.t === "num") {
      p++;
      return t.v;
    }
    if (t.t === "op" && t.v === "(") {
      p++;
      const v = parseExpr();
      expect(")");
      return v;
    }
    if (t.t === "id") {
      p++;
      if (isOp("(")) {
        const fn = FUNCS[t.v.toLowerCase()];
        if (!fn) throw new Error(`Neznámá funkce „${t.v}“.`);
        p++;
        const args: number[] = [];
        if (!isOp(")")) {
          args.push(parseExpr());
          while (isOp(",")) {
            p++;
            args.push(parseExpr());
          }
        }
        expect(")");
        return fn(...args);
      }
      if (t.v in scope) return scope[t.v];
      if (t.v in CONSTS) return CONSTS[t.v];
      throw new Error(`Neznámá proměnná „${t.v}“.`);
    }
    throw new Error(`Neočekávané „${t.v}“ ve výrazu.`);
  };

  const v = parseExpr();
  if (p < toks.length) throw new Error(`Neočekávané „${toks[p].v}“ ve výrazu.`);
  if (!Number.isFinite(v)) throw new Error("Výsledek výrazu není konečné číslo.");
  return v;
}

/** Je text výraz (ne jen číslo)? Číslo s desetinnou čárkou výraz není. */
export function isExpression(text: string) {
  const t = text.trim();
  if (!t) return false;
  if (t.startsWith("=")) return true;
  return /[A-Za-z_À-ɏ]/.test(t);
}

export const VAR_NAME = /^[A-Za-z_À-ɏ][A-Za-z0-9_À-ɏ]*$/;

/**
 * Vyhodnotí proměnné v pořadí závislostí. `overrides` (ze stavu/konfigurace) přepíší výraz pevnou hodnotou.
 * Cyklus nebo chyba se hlásí u konkrétní proměnné, ostatní se vyhodnotí.
 */
export function resolveVariables(vars: Variable[] = [], overrides: Record<string, number> = {}): { values: Record<string, number>; errors: Record<string, string> } {
  const values: Record<string, number> = {};
  const errors: Record<string, string> = {};
  const byName = new Map<string, Variable>();
  for (const v of vars) {
    if (!VAR_NAME.test(v.name)) errors[v.name] = "Neplatný název proměnné (písmena, číslice, podtržítko; nesmí začínat číslicí).";
    else if (byName.has(v.name)) errors[v.name] = "Proměnná je definovaná vícekrát.";
    else if (v.name in FUNCS || v.name in CONSTS) errors[v.name] = "Název je vyhrazen pro funkci/konstantu.";
    else byName.set(v.name, v);
  }
  const state = new Map<string, "visiting" | "done">();
  const visit = (name: string, chain: string[]): boolean => {
    if (state.get(name) === "done") return name in values;
    if (state.get(name) === "visiting") {
      const cyc = [...chain.slice(chain.indexOf(name)), name].join(" → ");
      for (const n of chain.slice(chain.indexOf(name))) errors[n] = `Cyklická závislost: ${cyc}`;
      return false;
    }
    const v = byName.get(name);
    if (!v) return false;
    state.set(name, "visiting");
    if (name in overrides && Number.isFinite(overrides[name])) {
      values[name] = overrides[name];
      state.set(name, "done");
      return true;
    }
    let ok = true;
    for (const ref of exprRefs(v.expr)) {
      if (!byName.has(ref)) continue; // chybějící proměnnou nahlásí evalExpr
      if (!visit(ref, [...chain, name])) ok = false;
    }
    if (ok && !errors[name]) {
      try {
        values[name] = evalExpr(v.expr, values);
      } catch (e) {
        errors[name] = (e as Error).message;
      }
    } else if (!errors[name]) errors[name] = "Závisí na proměnné s chybou.";
    state.set(name, "done");
    return name in values;
  };
  for (const name of byName.keys()) visit(name, []);
  return { values, errors };
}

/** Zapíše číslo na cestu „size.0“ / „distance“ v (klonovaném) prvku. Vrací false, pokud cesta neexistuje. */
export function setPath(obj: Record<string, unknown>, path: string, value: number): boolean {
  const parts = path.split(".");
  let cur: unknown = obj;
  for (let i = 0; i < parts.length - 1; i++) {
    if (cur == null || typeof cur !== "object") return false;
    cur = (cur as Record<string, unknown>)[parts[i]];
  }
  const last = parts[parts.length - 1];
  if (cur == null || typeof cur !== "object" || !(last in (cur as object))) return false;
  if (typeof (cur as Record<string, unknown>)[last] !== "number") return false;
  (cur as Record<string, unknown>)[last] = value;
  return true;
}

export function getPath(obj: unknown, path: string): number | undefined {
  let cur: unknown = obj;
  for (const k of path.split(".")) {
    if (cur == null || typeof cur !== "object") return undefined;
    cur = (cur as Record<string, unknown>)[k];
  }
  return typeof cur === "number" ? cur : undefined;
}

/** Hodnoty parametrů v jednotkách uložených v dokumentu (průměr → poloměr apod. řeší UI převodem výrazu). */
export function resolveDoc(doc: CadDoc): { doc: CadDoc; values: Record<string, number>; errors: string[] } {
  const errors: string[] = [];
  const cfg = doc.activeConfig ? doc.configs?.find((c) => c.id === doc.activeConfig) : undefined;
  const { values, errors: verr } = resolveVariables(doc.variables, cfg?.values ?? {});
  for (const [n, e] of Object.entries(verr)) errors.push(`${n}: ${e}`);

  const bindings = doc.bindings ?? {};
  const hasBindings = Object.keys(bindings).length > 0;
  const suppressed = new Set(cfg?.suppressed ?? []);
  if (!hasBindings && !suppressed.size) return { doc, values, errors };

  const features: Feature[] = doc.features.map((f) => (suppressed.has(f.id) || Object.keys(bindings).some((k) => k.startsWith(f.id + ":")) ? (structuredCloneSafe(f) as Feature) : f));
  const byId = new Map(features.map((f) => [f.id, f]));
  for (const f of features) if (suppressed.has(f.id)) f.suppressed = true;
  for (const [key, expr] of Object.entries(bindings)) {
    const k = key.indexOf(":");
    const fid = key.slice(0, k);
    const path = key.slice(k + 1);
    const f = byId.get(fid);
    if (!f) continue; // vazba na smazaný prvek – ignorovat
    try {
      const v = evalExpr(expr, values);
      if (!setPath(f as unknown as Record<string, unknown>, path, v)) errors.push(`${f.name}: parametr „${path}“ neexistuje.`);
    } catch (e) {
      errors.push(`${f.name} (${path}): ${(e as Error).message}`);
    }
  }
  return { doc: { ...doc, features }, values, errors };
}

function structuredCloneSafe<T>(v: T): T {
  return typeof structuredClone === "function" ? structuredClone(v) : (JSON.parse(JSON.stringify(v)) as T);
}
