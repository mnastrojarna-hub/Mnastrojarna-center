/**
 * Struktura výrobku ze souboru STEP (AP203 / AP214 / AP242) bez jádra: rychlé čtení textu ISO 10303-21.
 *
 * Velké sestavy z komerčních CAD (SolidWorks, Creo, Inventor, ZW3D…) se v jádře OpenCascade čtou jako jedno složené těleso:
 * 46 MB soubor = minuty výpočtu a 1,5 GB paměti, bez názvů dílů. Tady se ze souboru přečte jen strom výrobku (PRODUCT,
 * NEXT_ASSEMBLY_USAGE_OCCURRENCE, umístění z CONTEXT_DEPENDENT_SHAPE_REPRESENTATION) a geometrie každého DÍLU se vyřízne do
 * samostatného malého souboru STEP (uzávěr odkazů z jeho reprezentace). Sestava se pak otevře jako sestava komponent: každý díl
 * se v jádře čte zvlášť, opakované instance téhož dílu jen jednou, a obraz přibývá postupně.
 *
 * Funkce pracují nad bajty souboru (indexy začátků a konců entit), vyříznuté soubory kopírují původní bajty beze změny.
 */

export type StepIndex = {
  bytes: Uint8Array;
  /** začátek příkazu „#id = …“ (pozice znaku #) podle id; −1 = entita neexistuje */
  stmt: Int32Array;
  /** začátek těla entity (za „=“) */
  body: Int32Array;
  /** konec entity (pozice „;“) */
  end: Int32Array;
  maxId: number;
  count: number;
  /** FILE_SCHEMA z hlavičky (text včetně závorek), např. (('AUTOMOTIVE_DESIGN')) */
  schema: string;
  /** id entit vybraných typů (struktura výrobku, barvy) */
  byType: Map<string, number[]>;
  /** konec dat: soubor končí řádně (END-ISO-10303-21) */
  complete: boolean;
};

/** typy entit, které se při čtení rovnou zařadí do seznamů */
const LISTED = new Set([
  "PRODUCT",
  "PRODUCT_DEFINITION",
  "PRODUCT_DEFINITION_WITH_ASSOCIATED_DOCUMENTS",
  "PRODUCT_DEFINITION_SHAPE",
  "SHAPE_DEFINITION_REPRESENTATION",
  "NEXT_ASSEMBLY_USAGE_OCCURRENCE",
  "CONTEXT_DEPENDENT_SHAPE_REPRESENTATION",
  "SHAPE_REPRESENTATION_RELATIONSHIP",
  "STYLED_ITEM",
  "OVER_RIDING_STYLED_ITEM",
  "MAPPED_ITEM",
]);

const C = { hash: 35, quote: 39, semi: 59, eq: 61, lpar: 40, rpar: 41, slash: 47, star: 42, space: 32, nl: 10, cr: 13, tab: 9, zero: 48, nine: 57 };
const isSpace = (c: number) => c === C.space || c === C.nl || c === C.cr || c === C.tab;
const isIdent = (c: number) => (c >= 65 && c <= 90) || (c >= 97 && c <= 122) || (c >= 48 && c <= 57) || c === 95;

function latin1(b: Uint8Array, s: number, e: number): string {
  let out = "";
  for (let i = s; i < e; i += 0x8000) out += String.fromCharCode(...b.subarray(i, Math.min(e, i + 0x8000)));
  return out;
}

/** konec příkazu (`;` mimo řetězce a komentáře) od pozice `i`; −1 = soubor skončil uprostřed příkazu */
function stmtEnd(b: Uint8Array, i: number): number {
  const n = b.length;
  while (i < n) {
    const c = b[i];
    if (c === C.semi) return i;
    if (c === C.quote) {
      i++;
      while (i < n) {
        if (b[i] === C.quote) {
          if (b[i + 1] === C.quote) i += 2;
          else break;
        } else i++;
      }
      i++;
      continue;
    }
    if (c === C.slash && b[i + 1] === C.star) {
      i += 2;
      while (i < n - 1 && !(b[i] === C.star && b[i + 1] === C.slash)) i++;
      i += 2;
      continue;
    }
    i++;
  }
  return -1;
}

function skipWs(b: Uint8Array, i: number, e = b.length): number {
  for (;;) {
    while (i < e && isSpace(b[i])) i++;
    if (i < e - 1 && b[i] === C.slash && b[i + 1] === C.star) {
      i += 2;
      while (i < e - 1 && !(b[i] === C.star && b[i + 1] === C.slash)) i++;
      i += 2;
      continue;
    }
    return i;
  }
}

/** Chyba čtení struktury STEP (poškozený / neúplný soubor). */
export class StepFormatError extends Error {}

/**
 * Index entit souboru STEP. Jeden průchod bajty (46 MB ≈ 0,3 s). Vyhodí `StepFormatError`, když soubor není STEP
 * (chybí ISO-10303-21 / DATA) – neúplný soubor (useknutý konec) se přečte a má `complete: false`.
 */
export function indexStep(bytes: Uint8Array): StepIndex {
  const head = latin1(bytes, 0, Math.min(bytes.length, 512));
  if (!/ISO-10303-21/.test(head)) throw new StepFormatError("STEP: chybí hlavička ISO-10303-21");
  let i = 0;
  let schema = "";
  // hlavička: příkazy až po DATA;
  let inData = false;
  while (i < bytes.length && !inData) {
    i = skipWs(bytes, i);
    const e = stmtEnd(bytes, i);
    if (e < 0) throw new StepFormatError("STEP: soubor končí v hlavičce");
    const st = latin1(bytes, i, Math.min(e, i + 4096)).trim();
    if (/^FILE_SCHEMA/i.test(st)) schema = st.replace(/^FILE_SCHEMA\s*/i, "");
    if (/^DATA\b/i.test(st)) inData = true;
    i = e + 1;
  }
  if (!inData) throw new StepFormatError("STEP: chybí oddíl DATA");
  const ids: number[] = [];
  const st0: number[] = [];
  const bo: number[] = [];
  const en: number[] = [];
  const byType = new Map<string, number[]>();
  let maxId = 0;
  let complete = false;
  const n = bytes.length;
  while (i < n) {
    i = skipWs(bytes, i);
    if (i >= n) break;
    if (bytes[i] !== C.hash) {
      // ENDSEC / další oddíl / END-ISO-10303-21
      const e = stmtEnd(bytes, i);
      const word = latin1(bytes, i, Math.min(i + 24, e < 0 ? n : e)).trim().toUpperCase();
      if (word.startsWith("ENDSEC")) {
        const rest = latin1(bytes, e + 1, Math.min(n, e + 200));
        if (/END-ISO-10303-21/i.test(rest)) complete = true;
        break;
      }
      if (e < 0) break;
      i = e + 1;
      continue;
    }
    let j = i + 1;
    let id = 0;
    while (j < n && bytes[j] >= C.zero && bytes[j] <= C.nine) id = id * 10 + (bytes[j++] - C.zero);
    j = skipWs(bytes, j);
    if (bytes[j] !== C.eq) {
      const e = stmtEnd(bytes, j);
      if (e < 0) break;
      i = e + 1;
      continue;
    }
    const b = skipWs(bytes, j + 1);
    const e = stmtEnd(bytes, b);
    if (e < 0) break; // useknutý soubor – poslední neúplná entita se vynechá
    ids.push(id);
    st0.push(i);
    bo.push(b);
    en.push(e);
    if (id > maxId) maxId = id;
    // typ: identifikátor na začátku těla (složené entity „( A() B() )“ se nezařazují)
    if (isIdent(bytes[b])) {
      let k = b;
      while (k < e && isIdent(bytes[k])) k++;
      if (k - b <= 48) {
        const t = latin1(bytes, b, k).toUpperCase();
        if (LISTED.has(t)) {
          const l = byType.get(t);
          if (l) l.push(id);
          else byType.set(t, [id]);
        }
      }
    }
    i = e + 1;
  }
  const stmt = new Int32Array(maxId + 1).fill(-1);
  const body = new Int32Array(maxId + 1);
  const end = new Int32Array(maxId + 1);
  for (let k = 0; k < ids.length; k++) {
    stmt[ids[k]] = st0[k];
    body[ids[k]] = bo[k];
    end[ids[k]] = en[k];
  }
  return { bytes, stmt, body, end, maxId, count: ids.length, schema, byType, complete };
}

export const hasEntity = (ix: StepIndex, id: number) => id > 0 && id <= ix.maxId && ix.stmt[id] >= 0;

/** typ entity (u složené entity „( A() B() )“ typy oddělené mezerou) */
export function typeOf(ix: StepIndex, id: number): string {
  if (!hasEntity(ix, id)) return "";
  const b = ix.bytes;
  let k = ix.body[id];
  if (isIdent(b[k])) {
    const s = k;
    while (isIdent(b[k])) k++;
    return latin1(b, s, k).toUpperCase();
  }
  return parseBody(ix, id)
    .filter((v): v is StepTyped => isTyped(v))
    .map((v) => v.type)
    .join(" ");
}

// ---------------- hodnoty parametrů ----------------

export type StepRef = { ref: number };
export type StepEnum = { enum: string };
export type StepTyped = { type: string; args: StepVal[] };
export type StepVal = number | string | null | "*" | StepRef | StepEnum | StepTyped | StepVal[];

export const isRef = (v: StepVal): v is StepRef => !!v && typeof v === "object" && !Array.isArray(v) && "ref" in v;
export const isTyped = (v: StepVal): v is StepTyped => !!v && typeof v === "object" && !Array.isArray(v) && "type" in v;
const refOf = (v: StepVal | undefined): number => (v !== undefined && isRef(v) ? v.ref : -1);

/** Dekódování řetězce STEP: '' → ', \X2\…\X0\ (UTF-16), \X\hh (latin1), \S\c. */
export function decodeStepString(s: string): string {
  // některé programy zapisují názvy přímo v UTF-8 (mimo normu) – bajty ≥ 0x80 zkusit přečíst jako UTF-8
  if (/[\x80-\xff]/.test(s))
    try {
      s = new TextDecoder("utf-8", { fatal: true }).decode(Uint8Array.from(s, (c) => c.charCodeAt(0) & 255));
    } catch {
      /* zůstává latin1 */
    }
  let out = s.replace(/''/g, "'");
  out = out.replace(/\\X2\\([0-9A-Fa-f]+)\\X0\\/g, (_, hex: string) => {
    let r = "";
    for (let i = 0; i + 4 <= hex.length; i += 4) r += String.fromCharCode(parseInt(hex.slice(i, i + 4), 16));
    return r;
  });
  out = out.replace(/\\X4\\([0-9A-Fa-f]+)\\X0\\/g, (_, hex: string) => {
    let r = "";
    for (let i = 0; i + 8 <= hex.length; i += 8) r += String.fromCodePoint(parseInt(hex.slice(i, i + 8), 16));
    return r;
  });
  out = out.replace(/\\X\\([0-9A-Fa-f]{2})/g, (_, hex: string) => String.fromCharCode(parseInt(hex, 16)));
  out = out.replace(/\\S\\(.)/g, (_, c: string) => String.fromCharCode(c.charCodeAt(0) + 128));
  return out.replace(/\\\\/g, "\\");
}

/** Parametry entity jako strom hodnot (jednoduchá entita = pole parametrů; složená = pole typovaných záznamů). */
export function parseBody(ix: StepIndex, id: number): StepVal[] {
  if (!hasEntity(ix, id)) return [];
  const s = latin1(ix.bytes, ix.body[id], ix.end[id]);
  let i = 0;
  const ws = () => {
    while (i < s.length && /\s/.test(s[i])) i++;
  };
  const value = (): StepVal => {
    ws();
    const c = s[i];
    if (c === "$") {
      i++;
      return null;
    }
    if (c === "*") {
      i++;
      return "*";
    }
    if (c === "#") {
      i++;
      let n = 0;
      while (i < s.length && s[i] >= "0" && s[i] <= "9") n = n * 10 + (s.charCodeAt(i++) - 48);
      return { ref: n };
    }
    if (c === "'") {
      i++;
      let r = "";
      while (i < s.length) {
        if (s[i] === "'") {
          if (s[i + 1] === "'") {
            r += "''";
            i += 2;
            continue;
          }
          i++;
          break;
        }
        r += s[i++];
      }
      return decodeStepString(r);
    }
    if (c === ".") {
      const e = s.indexOf(".", i + 1);
      const v = s.slice(i + 1, e);
      i = e + 1;
      return { enum: v.toUpperCase() };
    }
    if (c === "(") {
      i++;
      return list();
    }
    if (c === '"') {
      const e = s.indexOf('"', i + 1);
      const v = s.slice(i + 1, e);
      i = e + 1;
      return v;
    }
    if (/[A-Za-z_]/.test(c)) {
      const st = i;
      while (i < s.length && /[A-Za-z0-9_]/.test(s[i])) i++;
      const type = s.slice(st, i).toUpperCase();
      ws();
      if (s[i] === "(") {
        i++;
        return { type, args: list() };
      }
      return { type, args: [] };
    }
    const st = i;
    while (i < s.length && /[-+0-9.Ee]/.test(s[i])) i++;
    const num = Number(s.slice(st, i));
    if (i === st) {
      i++; // neznámý znak – přeskočit
      return null;
    }
    return num;
  };
  const list = (): StepVal[] => {
    const out: StepVal[] = [];
    ws();
    if (s[i] === ")") {
      i++;
      return out;
    }
    for (;;) {
      out.push(value());
      ws();
      if (s[i] === ",") {
        i++;
        continue;
      }
      if (s[i] === ")") i++;
      break;
    }
    return out;
  };
  ws();
  if (/[A-Za-z_]/.test(s[i] ?? "")) {
    const v = value();
    return isTyped(v) ? v.args : [];
  }
  if (s[i] === "(") {
    // složená entita: ( A(...) B(...) )
    i++;
    const recs: StepVal[] = [];
    for (;;) {
      ws();
      if (i >= s.length || s[i] === ")") break;
      recs.push(value());
    }
    return recs;
  }
  return [];
}

/** záznam typu `type` ze složené entity (nebo celé parametry jednoduché entity daného typu) */
export function partOf(ix: StepIndex, id: number, type: string): StepVal[] | null {
  return records(ix, id).find((r) => r.type === type)?.args ?? null;
}

/** odkazy z těla entity (mimo řetězce) */
export function refsOf(ix: StepIndex, id: number, out: number[] = []): number[] {
  const b = ix.bytes;
  const e = ix.end[id];
  let i = ix.body[id];
  while (i < e) {
    const c = b[i];
    if (c === C.quote) {
      i++;
      while (i < e) {
        if (b[i] === C.quote) {
          if (b[i + 1] === C.quote) i += 2;
          else break;
        } else i++;
      }
      i++;
      continue;
    }
    if (c === C.hash) {
      i++;
      let n = 0;
      let d = 0;
      while (i < e && b[i] >= C.zero && b[i] <= C.nine) {
        n = n * 10 + (b[i++] - C.zero);
        d++;
      }
      if (d) out.push(n);
      continue;
    }
    i++;
  }
  return out;
}

// ---------------- geometrie umístění a jednotky ----------------

const num3 = (v: StepVal | undefined, d: [number, number, number]): [number, number, number] => {
  if (!Array.isArray(v)) return d;
  const a = v.map((x) => (typeof x === "number" ? x : 0));
  return [a[0] ?? d[0], a[1] ?? d[1], a[2] ?? d[2]];
};
const unit = (v: [number, number, number]): [number, number, number] => {
  const l = Math.hypot(...v) || 1;
  return [v[0] / l, v[1] / l, v[2] / l];
};
const cross = (a: number[], b: number[]): [number, number, number] => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];

/** Matice 4×4 (po sloupcích, jako three.js) z AXIS2_PLACEMENT_3D: osy X, Y, Z a počátek. */
export function axisMatrix(ix: StepIndex, id: number): number[] {
  const a = parseBody(ix, id);
  const p = num3(hasEntity(ix, refOf(a[1])) ? parseBody(ix, refOf(a[1]))[1] : undefined, [0, 0, 0]);
  const z = unit(num3(hasEntity(ix, refOf(a[2])) ? parseBody(ix, refOf(a[2]))[1] : undefined, [0, 0, 1]));
  let x = num3(hasEntity(ix, refOf(a[3])) ? parseBody(ix, refOf(a[3]))[1] : undefined, Math.abs(z[0]) < 0.9 ? [1, 0, 0] : [0, 1, 0]);
  const d = x[0] * z[0] + x[1] * z[1] + x[2] * z[2];
  x = unit([x[0] - d * z[0], x[1] - d * z[1], x[2] - d * z[2]]);
  const y = cross(z, x);
  return [x[0], x[1], x[2], 0, y[0], y[1], y[2], 0, z[0], z[1], z[2], 0, p[0], p[1], p[2], 1];
}

export function mul4(a: number[], b: number[]): number[] {
  const o = new Array(16).fill(0);
  for (let c = 0; c < 4; c++) for (let r = 0; r < 4; r++) for (let k = 0; k < 4; k++) o[c * 4 + r] += a[k * 4 + r] * b[c * 4 + k];
  return o;
}
/** inverze tuhé transformace (rotace + posun) */
export function invRigid(m: number[]): number[] {
  const t = [m[12], m[13], m[14]];
  const o = [m[0], m[4], m[8], 0, m[1], m[5], m[9], 0, m[2], m[6], m[10], 0, 0, 0, 0, 1];
  o[12] = -(o[0] * t[0] + o[4] * t[1] + o[8] * t[2]);
  o[13] = -(o[1] * t[0] + o[5] * t[1] + o[9] * t[2]);
  o[14] = -(o[2] * t[0] + o[6] * t[1] + o[10] * t[2]);
  return o;
}

const SI_PREFIX: Record<string, number> = { EXA: 1e18, PETA: 1e15, TERA: 1e12, GIGA: 1e9, MEGA: 1e6, KILO: 1e3, HECTO: 1e2, DECA: 1e1, DECI: 1e-1, CENTI: 1e-2, MILLI: 1e-3, MICRO: 1e-6, NANO: 1e-9 };

/** záznamy entity: jednoduchá entita = jeden záznam, složená „( A() B() )“ = více záznamů */
function records(ix: StepIndex, id: number): StepTyped[] {
  if (!hasEntity(ix, id)) return [];
  if (isIdent(ix.bytes[ix.body[id]])) return [{ type: typeOf(ix, id), args: parseBody(ix, id) }];
  return parseBody(ix, id).filter((v): v is StepTyped => isTyped(v));
}

const enumOf = (v: StepVal | undefined): string | null => (v && typeof v === "object" && !Array.isArray(v) && "enum" in v ? v.enum : null);

/** délková jednotka entity jednotky v mm (SI_UNIT s předponou, CONVERSION_BASED_UNIT palec / stopa…) */
function lengthUnitMm(ix: StepIndex, id: number, depth = 0): number | null {
  if (depth > 4) return null;
  const all = records(ix, id);
  const si = all.find((t) => t.type === "SI_UNIT");
  if (si) {
    if (enumOf(si.args[1]) !== "METRE") return null;
    const pre = enumOf(si.args[0]);
    return (pre ? (SI_PREFIX[pre] ?? 1) : 1) * 1000;
  }
  const conv = all.find((t) => t.type === "CONVERSION_BASED_UNIT");
  if (conv && all.some((t) => t.type === "LENGTH_UNIT")) {
    const nm = typeof conv.args[0] === "string" ? conv.args[0].toUpperCase() : "";
    const m = refOf(conv.args[1]);
    if (hasEntity(ix, m)) {
      const mv = parseBody(ix, m); // LENGTH_MEASURE_WITH_UNIT(LENGTH_MEASURE(25.4), #u)
      const v = mv[0];
      const val = typeof v === "number" ? v : isTyped(v as StepVal) ? Number((v as StepTyped).args[0]) : NaN;
      const base = lengthUnitMm(ix, refOf(mv[1]), depth + 1);
      if (Number.isFinite(val) && base) return val * base;
    }
    if (/INCH/.test(nm)) return 25.4;
    if (/FOOT/.test(nm)) return 304.8;
  }
  return null;
}

/** délková jednotka kontextu reprezentace (GLOBAL_UNIT_ASSIGNED_CONTEXT) v mm; neznámá = 1 (mm) */
export function contextUnitMm(ix: StepIndex, ctx: number): number {
  const units = hasEntity(ix, ctx) ? partOf(ix, ctx, "GLOBAL_UNIT_ASSIGNED_CONTEXT") : null;
  const list = units && Array.isArray(units[0]) ? (units[0] as StepVal[]) : [];
  for (const u of list) {
    const mm = lengthUnitMm(ix, refOf(u));
    if (mm) return mm;
  }
  return 1;
}

/** kontext reprezentace (poslední parametr SHAPE_REPRESENTATION a odvozených typů) */
function repContext(ix: StepIndex, rep: number): number {
  const a = parseBody(ix, rep);
  return refOf(a[a.length - 1]);
}

// ---------------- strom výrobku ----------------

export type StepInstance = {
  /** PRODUCT_DEFINITION dítěte */
  pd: number;
  /** umístění dítěte v souřadnicích rodiče (matice 4×4 po sloupcích, posun v mm) */
  matrix: number[];
  /** název výskytu (NEXT_ASSEMBLY_USAGE_OCCURRENCE), často prázdný */
  name: string;
};
export type StepProduct = {
  pd: number;
  name: string;
  /** reprezentace tvaru (SHAPE_REPRESENTATION…) – id */
  rep: number;
  /** délková jednotka reprezentace v mm */
  unitMm: number;
  children: StepInstance[];
  /** kořeny geometrie dílu pro vyříznutí (SHAPE_DEFINITION_REPRESENTATION a navázané SHAPE_REPRESENTATION_RELATIONSHIP) */
  geomRoots: number[];
  /** barva dílu z STYLED_ITEM (#rrggbb) */
  color?: string;
};
export type StepTree = {
  products: Map<number, StepProduct>;
  /** kořenové výrobky (nejsou dítětem v žádné sestavě) */
  roots: number[];
  /** počet výskytů dílů ve stromu (s opakováním instancí) */
  leafInstances: number;
  /** počet různých dílů (listů s geometrií) */
  leafProducts: number;
  /** sestava je popsaná přes MAPPED_ITEM (umístění v geometrii) – strom se tím nepřečte */
  mappedItems: number;
};

function colorOfStyled(ix: StepIndex, styled: number): string | undefined {
  // BFS po odkazech stylu (PRESENTATION_STYLE_ASSIGNMENT → … → COLOUR_RGB), nanejvýš 10 kroků
  const seen = new Set<number>();
  let front = refsOf(ix, styled).slice(0, -1); // poslední odkaz = stylovaný prvek
  for (let d = 0; d < 10 && front.length; d++) {
    const next: number[] = [];
    for (const id of front) {
      if (seen.has(id) || !hasEntity(ix, id)) continue;
      seen.add(id);
      const t = typeOf(ix, id);
      if (t === "COLOUR_RGB") {
        const a = parseBody(ix, id);
        const c = [a[1], a[2], a[3]].map((v) => Math.max(0, Math.min(255, Math.round(Number(v) * 255))));
        return "#" + c.map((v) => v.toString(16).padStart(2, "0")).join("");
      }
      if (t === "DRAUGHTING_PRE_DEFINED_COLOUR") {
        const nm = String(parseBody(ix, id)[0] ?? "");
        const pre: Record<string, string> = { red: "#ff0000", green: "#00ff00", blue: "#0000ff", yellow: "#ffff00", magenta: "#ff00ff", cyan: "#00ffff", black: "#000000", white: "#ffffff" };
        if (pre[nm]) return pre[nm];
      }
      refsOf(ix, id, next);
    }
    front = next;
  }
  return undefined;
}

/**
 * Strom výrobku. Vrací `null`, když soubor nemá sestavu (žádné NEXT_ASSEMBLY_USAGE_OCCURRENCE s umístěním) – takový soubor se
 * čte jako jeden díl.
 */
export function stepTree(ix: StepIndex): StepTree | null {
  const list = (t: string) => ix.byType.get(t) ?? [];
  const nauos = list("NEXT_ASSEMBLY_USAGE_OCCURRENCE");
  const mappedItems = list("MAPPED_ITEM").length;
  if (!nauos.length) return null;
  // PRODUCT_DEFINITION → název výrobku
  const pdName = (pd: number): string => {
    const a = parseBody(ix, pd); // PRODUCT_DEFINITION(id, desc, formation, frame)
    const pdf = refOf(a[2]);
    const fa = hasEntity(ix, pdf) ? parseBody(ix, pdf) : []; // PRODUCT_DEFINITION_FORMATION(id, desc, of_product…)
    const prod = refOf(fa[2]);
    const pa = hasEntity(ix, prod) ? parseBody(ix, prod) : []; // PRODUCT(id, name, description, contexts)
    const name = (typeof pa[1] === "string" && pa[1].trim()) || (typeof pa[0] === "string" && pa[0].trim()) || "";
    return name || `#${pd}`;
  };
  // PRODUCT_DEFINITION_SHAPE: definice (PD nebo NAUO) → PDS
  const pdsOf = new Map<number, number>();
  for (const id of list("PRODUCT_DEFINITION_SHAPE")) {
    const a = parseBody(ix, id);
    const def = refOf(a[2]);
    if (def > 0 && !pdsOf.has(def)) pdsOf.set(def, id);
  }
  // SHAPE_DEFINITION_REPRESENTATION: PDS → reprezentace (+ SDR)
  const repOfPds = new Map<number, { rep: number; sdr: number }>();
  for (const id of list("SHAPE_DEFINITION_REPRESENTATION")) {
    const a = parseBody(ix, id);
    const pds = refOf(a[0]);
    const rep = refOf(a[1]);
    if (pds > 0 && rep > 0 && !repOfPds.has(pds)) repOfPds.set(pds, { rep, sdr: id });
  }
  // jednoduché SHAPE_REPRESENTATION_RELATIONSHIP (bez transformace): reprezentace výrobku ↔ reprezentace geometrie
  const srrOf = new Map<number, number[]>();
  for (const id of list("SHAPE_REPRESENTATION_RELATIONSHIP")) {
    const a = parseBody(ix, id);
    for (const r of [refOf(a[2]), refOf(a[3])]) {
      if (r <= 0) continue;
      const l = srrOf.get(r);
      if (l) l.push(id);
      else srrOf.set(r, [id]);
    }
  }
  // umístění výskytu: NAUO → PDS → CONTEXT_DEPENDENT_SHAPE_REPRESENTATION → (REPRESENTATION_RELATIONSHIP + …WITH_TRANSFORMATION)
  const cdsrOfPds = new Map<number, number>();
  for (const id of list("CONTEXT_DEPENDENT_SHAPE_REPRESENTATION")) {
    const a = parseBody(ix, id);
    const pds = refOf(a[1]);
    if (pds > 0) cdsrOfPds.set(pds, refOf(a[0]));
  }
  const products = new Map<number, StepProduct>();
  const product = (pd: number): StepProduct => {
    let p = products.get(pd);
    if (!p) {
      const pds = pdsOf.get(pd) ?? -1;
      const r = repOfPds.get(pds);
      const rep = r?.rep ?? -1;
      const geomRoots: number[] = [];
      if (r) {
        geomRoots.push(r.sdr);
        for (const s of srrOf.get(rep) ?? []) geomRoots.push(s);
      }
      p = { pd, name: pdName(pd), rep, unitMm: rep > 0 ? contextUnitMm(ix, repContext(ix, rep)) : 1, children: [], geomRoots };
      products.set(pd, p);
    }
    return p;
  };
  const isChild = new Set<number>();
  for (const id of nauos) {
    const a = parseBody(ix, id); // NAUO(id, name, description, relating, related, ref_designator)
    const parent = refOf(a[3]);
    const child = refOf(a[4]);
    if (!hasEntity(ix, parent) || !hasEntity(ix, child)) continue;
    const P = product(parent);
    const Ch = product(child);
    isChild.add(child);
    let matrix = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
    const rr = cdsrOfPds.get(pdsOf.get(id) ?? -1) ?? -1;
    if (hasEntity(ix, rr)) {
      const rel = partOf(ix, rr, "REPRESENTATION_RELATIONSHIP"); // (name, desc, rep_1, rep_2)
      const wt = partOf(ix, rr, "REPRESENTATION_RELATIONSHIP_WITH_TRANSFORMATION");
      const tr = wt ? refOf(wt[0]) : -1;
      if (rel && hasEntity(ix, tr) && typeOf(ix, tr) === "ITEM_DEFINED_TRANSFORMATION") {
        const t = parseBody(ix, tr); // (name, desc, item_1, item_2)
        const m1 = axisMatrix(ix, refOf(t[2]));
        const m2 = axisMatrix(ix, refOf(t[3]));
        // item_1 patří k rep_1; dítě je obvykle rep_1 (OpenCascade, SolidWorks), některé programy je dávají jako rep_2
        const childFirst = refOf(rel[2]) === Ch.rep || refOf(rel[3]) === P.rep;
        matrix = childFirst ? mul4(m2, invRigid(m1)) : mul4(m1, invRigid(m2));
      }
    }
    // posun do mm podle jednotky rodiče
    const k = P.unitMm;
    if (k !== 1) matrix = matrix.map((v, i) => (i >= 12 && i <= 14 ? v * k : v));
    P.children.push({ pd: child, matrix, name: typeof a[1] === "string" ? a[1] : "" });
  }
  const roots = [...products.keys()].filter((pd) => !isChild.has(pd) && products.get(pd)!.children.length);
  if (!roots.length) return null;
  // barvy dílů: STYLED_ITEM → prvek geometrie (těleso) → reprezentace dílu
  const colorOfItem = new Map<number, string>();
  for (const id of [...list("STYLED_ITEM"), ...list("OVER_RIDING_STYLED_ITEM")]) {
    const a = parseBody(ix, id); // STYLED_ITEM(name, styles, item)
    const item = refOf(a[2]);
    if (item > 0 && !colorOfItem.has(item)) {
      const c = colorOfStyled(ix, id);
      if (c) colorOfItem.set(item, c);
    }
  }
  let leafInstances = 0;
  const leaves = new Set<number>();
  const walk = (pd: number, depth: number) => {
    if (depth > 32) return;
    const p = products.get(pd)!;
    if (!p.children.length) {
      leafInstances++;
      leaves.add(pd);
      return;
    }
    for (const c of p.children) walk(c.pd, depth + 1);
  };
  for (const r of roots) walk(r, 0);
  for (const pd of leaves) {
    const p = products.get(pd)!;
    if (!colorOfItem.size) break;
    // položky reprezentací geometrie dílu (MANIFOLD_SOLID_BREP…)
    const reps = [p.rep, ...p.geomRoots.flatMap((s) => (typeOf(ix, s) === "SHAPE_REPRESENTATION_RELATIONSHIP" ? (() => { const a = parseBody(ix, s); return [refOf(a[2]), refOf(a[3])]; })() : []))];
    for (const rep of reps) {
      if (!hasEntity(ix, rep)) continue;
      const items = parseBody(ix, rep)[1];
      if (!Array.isArray(items)) continue;
      const hit = items.map((v) => colorOfItem.get(refOf(v))).find(Boolean);
      if (hit) {
        p.color = hit;
        break;
      }
    }
  }
  return { products, roots, leafInstances, leafProducts: leaves.size, mappedItems };
}

// ---------------- vyříznutí dílu do samostatného souboru ----------------

const GEOM_TYPES = /(^|\s)(MANIFOLD_SOLID_BREP|BREP_WITH_VOIDS|FACETED_BREP|SHELL_BASED_SURFACE_MODEL|ADVANCED_FACE|FACE_SURFACE|TRIANGULATED_FACE|TESSELLATED_SHELL)(\s|$)/;

let mark: Int32Array | null = null;
let markGen = 0;

/** Uzávěr odkazů z kořenů (id v pořadí souboru) – vše, co entity kořenů potřebují. */
export function closure(ix: StepIndex, roots: number[]): number[] {
  if (!mark || mark.length < ix.maxId + 1) {
    mark = new Int32Array(ix.maxId + 1);
    markGen = 0;
  }
  const gen = ++markGen;
  const out: number[] = [];
  const stack = roots.filter((r) => hasEntity(ix, r));
  const buf: number[] = [];
  while (stack.length) {
    const id = stack.pop()!;
    if (mark[id] === gen || !hasEntity(ix, id)) continue;
    mark[id] = gen;
    out.push(id);
    buf.length = 0;
    refsOf(ix, id, buf);
    for (const r of buf) if (r <= ix.maxId && mark[r] !== gen) stack.push(r);
  }
  return out.sort((a, b) => a - b);
}

const enc = new TextEncoder();

/** Obsahuje uzávěr geometrii (plochy / tělesa)? */
export function hasGeometry(ix: StepIndex, ids: number[]): boolean {
  for (const id of ids) {
    const b = ix.bytes[ix.body[id]];
    // rychlé síto podle prvního písmene typu (A, B, F, M, S, T) a pak přesný typ
    if (b === 65 || b === 66 || b === 70 || b === 77 || b === 83 || b === 84) if (GEOM_TYPES.test(typeOf(ix, id))) return true;
  }
  return false;
}

/** Samostatný soubor STEP s geometrií jednoho dílu (původní bajty entit, hlavička se schématem originálu). */
export function extractProduct(ix: StepIndex, p: StepProduct, ids = closure(ix, p.geomRoots)): Uint8Array {
  const safe = p.name.replace(/[^\x20-\x7e]/g, "_").replace(/'/g, "");
  const head = enc.encode(`ISO-10303-21;\nHEADER;\nFILE_DESCRIPTION(('Mnastrojarna CAD - dil ze sestavy'),'2;1');\nFILE_NAME('${safe}','',(''),(''),'','','');\nFILE_SCHEMA${ix.schema || "(('AUTOMOTIVE_DESIGN'))"};\nENDSEC;\nDATA;\n`);
  const tail = enc.encode("ENDSEC;\nEND-ISO-10303-21;\n");
  let size = head.length + tail.length;
  for (const id of ids) size += ix.end[id] + 1 - ix.stmt[id] + 1;
  const out = new Uint8Array(size);
  out.set(head, 0);
  let o = head.length;
  for (const id of ids) {
    out.set(ix.bytes.subarray(ix.stmt[id], ix.end[id] + 1), o);
    o += ix.end[id] + 1 - ix.stmt[id];
    out[o++] = 10;
  }
  out.set(tail, o);
  return out;
}
