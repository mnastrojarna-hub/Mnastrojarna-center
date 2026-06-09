/**
 * Velmi podrobná, ale bezpečná serializace libovolných hodnot do textu.
 * Zvládá: Error, DOM uzly, Event, cyklické reference, funkce, mapy/sety,
 * velká pole i hluboké objekty (s limity, aby UI nespadlo).
 */

const MAX_DEPTH = 6;
const MAX_ARRAY = 100;
const MAX_KEYS = 80;
const MAX_STRING = 5000;

export function describeType(value: unknown): string {
  if (value === null) return "null";
  if (value === undefined) return "undefined";
  const t = typeof value;
  if (t !== "object" && t !== "function") return t;
  const ctor = (value as { constructor?: { name?: string } })?.constructor?.name;
  return ctor || Object.prototype.toString.call(value).slice(8, -1);
}

function truncate(s: string): string {
  return s.length > MAX_STRING ? s.slice(0, MAX_STRING) + `… (+${s.length - MAX_STRING} znaků)` : s;
}

function serializeValue(value: unknown, depth: number, seen: WeakSet<object>): unknown {
  if (value === null || value === undefined) return value;

  const t = typeof value;
  if (t === "string") return truncate(value as string);
  if (t === "number" || t === "boolean") return value;
  if (t === "bigint") return `${(value as bigint).toString()}n`;
  if (t === "symbol") return (value as symbol).toString();
  if (t === "function") {
    const fn = value as { name?: string; length?: number };
    return `[Function ${fn.name || "anonymous"}(${fn.length ?? 0})]`;
  }

  if (value instanceof Error) {
    const out: Record<string, unknown> = {
      __type: "Error",
      name: value.name,
      message: value.message,
      stack: value.stack,
    };
    const errRecord = value as unknown as Record<string, unknown>;
    for (const k of Object.keys(value)) {
      if (!(k in out)) out[k] = serializeValue(errRecord[k], depth + 1, seen);
    }
    const cause = (value as { cause?: unknown }).cause;
    if (cause) out.cause = serializeValue(cause, depth + 1, seen);
    return out;
  }

  if (typeof Date !== "undefined" && value instanceof Date) {
    return { __type: "Date", iso: isNaN(value.getTime()) ? "Invalid Date" : value.toISOString() };
  }

  if (typeof Node !== "undefined" && value instanceof Node) {
    const el = value as unknown as Element;
    const tag = el.tagName?.toLowerCase?.();
    if (tag) {
      const id = el.id ? `#${el.id}` : "";
      const cls = el.className && typeof el.className === "string" ? "." + el.className.split(/\s+/).join(".") : "";
      return `<${tag}${id}${cls}>`;
    }
    return `[Node ${describeType(value)}]`;
  }

  if (typeof Event !== "undefined" && value instanceof Event) {
    return { __type: "Event", type: value.type, target: describeType(value.target) };
  }

  if (depth >= MAX_DEPTH) return `[${describeType(value)} — hloubka překročena]`;

  const obj = value as object;
  if (seen.has(obj)) return "[Cyklická reference]";
  seen.add(obj);

  try {
    if (Array.isArray(value)) {
      const arr = value.slice(0, MAX_ARRAY).map((v) => serializeValue(v, depth + 1, seen));
      if (value.length > MAX_ARRAY) arr.push(`… (+${value.length - MAX_ARRAY} položek)`);
      return arr;
    }

    if (value instanceof Map) {
      const out: Record<string, unknown> = { __type: "Map", size: value.size };
      let i = 0;
      for (const [k, v] of value) {
        if (i++ >= MAX_KEYS) break;
        out[String(k)] = serializeValue(v, depth + 1, seen);
      }
      return out;
    }
    if (value instanceof Set) {
      return { __type: "Set", size: value.size, values: serializeValue([...value].slice(0, MAX_ARRAY), depth + 1, seen) };
    }

    const out: Record<string, unknown> = {};
    const keys = Object.keys(value as Record<string, unknown>);
    for (const k of keys.slice(0, MAX_KEYS)) {
      try {
        out[k] = serializeValue((value as Record<string, unknown>)[k], depth + 1, seen);
      } catch (e) {
        out[k] = `[Nelze přečíst: ${(e as Error)?.message}]`;
      }
    }
    if (keys.length > MAX_KEYS) out["…"] = `(+${keys.length - MAX_KEYS} klíčů)`;
    if (keys.length === 0) {
      const str = String(value);
      if (str !== "[object Object]") return `${describeType(value)} → ${truncate(str)}`;
    }
    return out;
  } finally {
    seen.delete(obj);
  }
}

/** Jednořádkové shrnutí jediné hodnoty (pro sloupec „zpráva"). */
export function summarize(value: unknown): string {
  if (value === null) return "null";
  if (value === undefined) return "undefined";
  const t = typeof value;
  if (t === "string") return value as string;
  if (t === "number" || t === "boolean" || t === "bigint") return String(value);
  if (value instanceof Error) return `${value.name}: ${value.message}`;
  if (Array.isArray(value)) return `Array(${value.length})`;
  try {
    const json = JSON.stringify(value);
    if (json && json.length <= 200) return json;
  } catch {
    /* ignore */
  }
  return describeType(value);
}

/** Sloučí console-argumenty do jednořádkové zprávy. */
export function summarizeArgs(args: unknown[]): string {
  if (args.length === 0) return "";
  return args.map(summarize).join(" ").slice(0, 300);
}

/** Plný, čitelný JSON dump argumentů pro detail záznamu. */
export function detailFromArgs(args: unknown[]): string {
  const seen = new WeakSet<object>();
  const serialized = args.map((a) => serializeValue(a, 0, seen));
  try {
    return JSON.stringify(serialized.length === 1 ? serialized[0] : serialized, null, 2);
  } catch {
    return args.map(String).join("\n");
  }
}

export function detailFromValue(value: unknown): string {
  const seen = new WeakSet<object>();
  try {
    return JSON.stringify(serializeValue(value, 0, seen), null, 2);
  } catch {
    return String(value);
  }
}
