/**
 * Rychlý index souboru STEP (ISO 10303-21) nad bajty — bez převodu celého souboru na řetězec.
 *
 * Pro každou entitu `#id=…;` uloží začátek a konec těla, typ (první klíčové slovo; komplexní
 * entita `(A()B())` má typ „") a seznam odkazů `#n`. Index slouží k rozdělení velké sestavy
 * na samostatné díly (viz step-split.ts) — 150 MB se projde zhruba za sekundu.
 */

export interface StepIndex {
  bytes: Uint8Array;
  /** Hlavička souboru (vše před „DATA;") — kopíruje se do souborů dílů. */
  headerEnd: number;
  count: number;
  ids: Int32Array;
  start: Uint32Array;
  end: Uint32Array;
  type: Uint16Array;
  typeNames: string[];
  refStart: Uint32Array;
  refs: Int32Array;
  maxId: number;
  /** id → pořadí entity (−1 = není). */
  idToIdx: Int32Array;
}

const SEMI = 59, QUOTE = 39, HASH = 35, EQ = 61, LPAR = 40, SLASH = 47, STAR = 42;
const isDigit = (c: number) => c >= 48 && c <= 57;
const isWord = (c: number) => (c >= 65 && c <= 90) || (c >= 97 && c <= 122) || (c >= 48 && c <= 57) || c === 95;

function grow<T extends Int32Array | Uint32Array | Uint16Array>(a: T, need: number): T {
  if (need <= a.length) return a;
  const next = new (a.constructor as new (n: number) => T)(Math.max(need, Math.ceil(a.length * 1.6)));
  next.set(a);
  return next;
}

/** Najde „DATA;" mimo řetězce hlavičky. */
function findData(b: Uint8Array): number {
  const n = b.length;
  let inStr = false;
  for (let i = 0; i < n - 4; i++) {
    const c = b[i];
    if (c === QUOTE) inStr = !inStr;
    else if (!inStr && c === 68 && b[i + 1] === 65 && b[i + 2] === 84 && b[i + 3] === 65) {
      let j = i + 4;
      while (j < n && b[j] <= 32) j++;
      if (b[j] === SEMI && (i === 0 || !isWord(b[i - 1]))) return i;
    }
  }
  return -1;
}

/** Index souboru; null = nevypadá jako STEP (nebo má nečekanou stavbu). */
export function indexStep(bytes: Uint8Array): StepIndex | null {
  const b = bytes;
  const n = b.length;
  const dataAt = findData(b);
  if (dataAt < 0) return null;
  let cap = Math.max(1024, Math.floor(n / 40));
  let ids = new Int32Array(cap);
  let start = new Uint32Array(cap);
  let end = new Uint32Array(cap);
  let type = new Uint16Array(cap);
  let refStart = new Uint32Array(cap + 1);
  let refs = new Int32Array(Math.max(1024, Math.floor(n / 12)));
  let refN = 0;
  const typeNames: string[] = [""];
  const typeCodes = new Map<string, number>();
  let count = 0;
  let maxId = 0;

  let i = dataAt + 5;
  while (i < n) {
    const c = b[i];
    if (c === HASH) {
      // #id = tělo ;
      let id = 0;
      i++;
      while (i < n && isDigit(b[i])) id = id * 10 + (b[i++] - 48);
      while (i < n && b[i] <= 32) i++;
      if (b[i] !== EQ) {
        // odkaz mimo entitu (nemělo by nastat) → přeskočit
        continue;
      }
      i++;
      while (i < n && b[i] <= 32) i++;
      const bodyStart = i;
      let code = 0;
      if (b[i] !== LPAR) {
        const ts = i;
        while (i < n && isWord(b[i])) i++;
        let name = "";
        for (let k = ts; k < i; k++) name += String.fromCharCode(b[k] >= 97 ? b[k] - 32 : b[k]);
        let tc = typeCodes.get(name);
        if (tc === undefined) {
          tc = typeNames.length;
          if (tc > 65000) return null;
          typeNames.push(name);
          typeCodes.set(name, tc);
        }
        code = tc;
      }
      if (count >= cap) {
        cap = Math.ceil(cap * 1.6);
        ids = grow(ids, cap);
        start = grow(start, cap);
        end = grow(end, cap);
        type = grow(type, cap);
        refStart = grow(refStart, cap + 1);
      }
      refStart[count] = refN;
      // tělo až po středník mimo řetězce
      for (;;) {
        if (i >= n) return null;
        const d = b[i];
        if (d === SEMI) break;
        if (d === QUOTE) {
          i++;
          while (i < n) {
            if (b[i] === QUOTE) {
              if (b[i + 1] === QUOTE) {
                i += 2;
                continue;
              }
              break;
            }
            i++;
          }
          i++;
          continue;
        }
        if (d === HASH) {
          i++;
          let r = 0;
          while (i < n && isDigit(b[i])) r = r * 10 + (b[i++] - 48);
          if (refN >= refs.length) refs = grow(refs, refN + 1);
          refs[refN++] = r;
          continue;
        }
        i++;
      }
      ids[count] = id;
      start[count] = bodyStart;
      end[count] = i;
      type[count] = code;
      if (id > maxId) maxId = id;
      count++;
      i++;
      continue;
    }
    if (c === SLASH && b[i + 1] === STAR) {
      const close = indexOfSeq(b, i + 2, STAR, SLASH);
      if (close < 0) break;
      i = close + 2;
      continue;
    }
    if (c === 69 /* E */ && b[i + 1] === 78 && b[i + 2] === 68 && b[i + 3] === 83 /* ENDS(EC) */) break;
    i++;
  }
  if (!count) return null;
  refStart[count] = refN;
  // řídká čísla entit (např. #900000000) → nečekaná stavba, raději celý soubor najednou
  if (maxId > Math.max(count * 8, 1 << 22) || maxId > 1 << 27) return null;
  const idToIdx = new Int32Array(maxId + 1).fill(-1);
  for (let k = 0; k < count; k++) idToIdx[ids[k]] = k;
  return { bytes, headerEnd: dataAt, count, ids, start, end, type, typeNames, refStart, refs, maxId, idToIdx };
}

function indexOfSeq(b: Uint8Array, from: number, a: number, c: number): number {
  for (let i = from; i < b.length - 1; i++) if (b[i] === a && b[i + 1] === c) return i;
  return -1;
}

export function typeCode(ix: StepIndex, name: string): number {
  const k = ix.typeNames.indexOf(name);
  return k > 0 ? k : -1;
}

export function typeName(ix: StepIndex, idx: number): string {
  return ix.typeNames[ix.type[idx]];
}

/** Odkazy entity jako pořadí (idx); neexistující se vynechají. */
export function refsOf(ix: StepIndex, idx: number): number[] {
  const out: number[] = [];
  for (let k = ix.refStart[idx]; k < ix.refStart[idx + 1]; k++) {
    const r = ix.refs[k];
    const j = r <= ix.maxId ? ix.idToIdx[r] : -1;
    if (j >= 0) out.push(j);
  }
  return out;
}

export function idxOf(ix: StepIndex, id: number): number {
  return id >= 0 && id <= ix.maxId ? ix.idToIdx[id] : -1;
}

/* ───────── parametry entit (jen u entit, které potřebujeme rozumět) ───────── */

export type StepArg =
  | { k: "ref"; id: number }
  | { k: "str"; v: string }
  | { k: "num"; v: number }
  | { k: "enum"; v: string }
  | { k: "list"; v: StepArg[] }
  | { k: "typed"; name: string; v: StepArg[] }
  | { k: "null" };

export interface StepRecord {
  name: string;
  args: StepArg[];
}

const latin1 = (b: Uint8Array, s: number, e: number) => {
  let out = "";
  for (let i = s; i < e; i += 8192) out += String.fromCharCode.apply(null, Array.from(b.subarray(i, Math.min(e, i + 8192))));
  return out;
};

/** Řetězec STEP: \X2\…\X0\ (UTF-16), \X\hh, '' → ', jinak UTF-8 (časté u exportů z CAD). */
export function decodeStepString(raw: Uint8Array): string {
  let s: string;
  try {
    s = new TextDecoder("utf-8", { fatal: true }).decode(raw);
  } catch {
    s = latin1(raw, 0, raw.length);
  }
  return s
    .replace(/''/g, "'")
    .replace(/\\X2\\([0-9A-Fa-f]+)\\X0\\/g, (_, hex: string) => {
      let r = "";
      for (let i = 0; i + 4 <= hex.length; i += 4) r += String.fromCharCode(parseInt(hex.slice(i, i + 4), 16));
      return r;
    })
    .replace(/\\X\\([0-9A-Fa-f]{2})/g, (_, h: string) => String.fromCharCode(parseInt(h, 16)))
    .replace(/\\S\\(.)/g, (_, ch: string) => String.fromCharCode(ch.charCodeAt(0) + 128));
}

/** Rozebere tělo entity: jednoduchá → [záznam], komplexní → záznamy všech částí. */
export function parseEntity(ix: StepIndex, idx: number): StepRecord[] {
  const b = ix.bytes;
  let i = ix.start[idx];
  const end = ix.end[idx];
  const skipWs = () => {
    while (i < end && b[i] <= 32) i++;
  };
  const word = () => {
    const s = i;
    while (i < end && isWord(b[i])) i++;
    return latin1(b, s, i).toUpperCase();
  };
  const parseList = (): StepArg[] => {
    // b[i] === '('
    i++;
    const out: StepArg[] = [];
    skipWs();
    if (b[i] === 41) {
      i++;
      return out;
    }
    for (;;) {
      skipWs();
      out.push(parseArg());
      skipWs();
      if (b[i] === 44) {
        i++;
        continue;
      }
      if (b[i] === 41) i++;
      return out;
    }
  };
  const parseArg = (): StepArg => {
    const c = b[i];
    if (c === HASH) {
      i++;
      let r = 0;
      while (i < end && isDigit(b[i])) r = r * 10 + (b[i++] - 48);
      return { k: "ref", id: r };
    }
    if (c === QUOTE) {
      i++;
      const s = i;
      while (i < end) {
        if (b[i] === QUOTE) {
          if (b[i + 1] === QUOTE) {
            i += 2;
            continue;
          }
          break;
        }
        i++;
      }
      const v = decodeStepString(b.subarray(s, i));
      i++;
      return { k: "str", v };
    }
    if (c === LPAR) return { k: "list", v: parseList() };
    if (c === 46 /* . */ && i + 1 < end && !isDigit(b[i + 1])) {
      i++;
      const v = word();
      if (b[i] === 46) i++;
      return { k: "enum", v };
    }
    if (c === 36 /* $ */ || c === STAR) {
      i++;
      return { k: "null" };
    }
    if ((c >= 65 && c <= 90) || (c >= 97 && c <= 122)) {
      const name = word();
      skipWs();
      return { k: "typed", name, v: b[i] === LPAR ? parseList() : [] };
    }
    // číslo
    const s = i;
    while (i < end && b[i] !== 44 && b[i] !== 41 && b[i] > 32) i++;
    return { k: "num", v: Number(latin1(b, s, i)) };
  };

  skipWs();
  if (b[i] === LPAR) {
    i++;
    const recs: StepRecord[] = [];
    for (;;) {
      skipWs();
      if (i >= end || b[i] === 41) break;
      const name = word();
      skipWs();
      const args = b[i] === LPAR ? parseList() : [];
      recs.push({ name, args });
    }
    return recs;
  }
  const name = word();
  skipWs();
  return [{ name, args: b[i] === LPAR ? parseList() : [] }];
}

export const argRef = (a: StepArg | undefined): number => (a && a.k === "ref" ? a.id : -1);
export const argStr = (a: StepArg | undefined): string => (a && a.k === "str" ? a.v : "");
export const argNum = (a: StepArg | undefined): number => (a && a.k === "num" ? a.v : a && a.k === "typed" && a.v[0]?.k === "num" ? a.v[0].v : NaN);
export const argRefs = (a: StepArg | undefined): number[] => (a && a.k === "list" ? a.v.map(argRef).filter((x) => x >= 0) : []);

/** Rychlé čtení souřadnic CARTESIAN_POINT('…',(x,y,z)) přímo z bajtů. */
export function readPoint(ix: StepIndex, idx: number, out: number[]): number {
  const b = ix.bytes;
  let i = ix.start[idx];
  const end = ix.end[idx];
  // přeskočit název a řetězec jména
  while (i < end && b[i] !== LPAR) i++;
  i++;
  while (i < end && b[i] <= 32) i++;
  if (b[i] === QUOTE) {
    i++;
    while (i < end) {
      if (b[i] === QUOTE) {
        if (b[i + 1] === QUOTE) {
          i += 2;
          continue;
        }
        break;
      }
      i++;
    }
    i++;
  }
  while (i < end && b[i] !== LPAR) i++;
  i++;
  let k = 0;
  while (k < 3 && i < end) {
    while (i < end && (b[i] <= 32 || b[i] === 44)) i++;
    if (b[i] === 41) break;
    let sign = 1;
    if (b[i] === 45) {
      sign = -1;
      i++;
    } else if (b[i] === 43) i++;
    let v = 0;
    while (i < end && isDigit(b[i])) v = v * 10 + (b[i++] - 48);
    if (b[i] === 46) {
      i++;
      let f = 0.1;
      while (i < end && isDigit(b[i])) {
        v += (b[i++] - 48) * f;
        f *= 0.1;
      }
    }
    if (b[i] === 69 || b[i] === 101) {
      i++;
      let es = 1;
      if (b[i] === 45) {
        es = -1;
        i++;
      } else if (b[i] === 43) i++;
      let e = 0;
      while (i < end && isDigit(b[i])) e = e * 10 + (b[i++] - 48);
      v *= Math.pow(10, es * e);
    }
    out[k++] = sign * v;
  }
  return k;
}
