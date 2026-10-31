/**
 * Schéma PRC (ISO 14739-1, kap. 9): popis polí, která novější verze formátu přidala na konec
 * existujících entit. Čtečka podle něj nová pole přeskočí. Bloky s verzí ≤ verzi, kterou tato
 * čtečka zná, se ignorují (pole už čteme nativně).
 */

import { BitReader, PrcFormatError } from "./prc-bits";

/** Typ entity → tokeny schématu. */
export type PrcSchema = Map<number, Uint32Array>;

/** Verze specifikace, kterou čtečka implementuje (ISO 14739-1 = PRC 10001). */
const READER_VERSION = 10001;

enum Tok {
  Boolean = 0,
  Double = 1,
  Character = 2,
  UInt = 3,
  Int = 4,
  String = 5,
  FatherType = 6,
  Vector2D = 7,
  Vector3D = 8,
  Extent1D = 9,
  Extent2D = 10,
  Extent3D = 11,
  PtrType = 12,
  PtrSurface = 13,
  PtrCurve = 14,
  For = 15,
  SimpleFor = 16,
  If = 17,
  Else = 18,
  BlockStart = 19,
  BlockVersion = 20,
  BlockEnd = 21,
  ValueDeclare = 22,
  ValueSet = 23,
  ValueDeclareAndSet = 24,
  Value = 25,
  ValueConstant = 26,
  ValueFor = 27,
  ValueCurveIs3D = 28,
  Mult = 29,
  Div = 30,
  Add = 31,
  Sub = 32,
  LT = 33,
  LE = 34,
  GT = 35,
  GE = 36,
  EQ = 37,
  NEQ = 38,
  Ignore1 = 39,
  Ignore2 = 40,
}

/** Přečte definici schématu (počet typů + pro každý typ pole tokenů). */
export function readSchema(r: BitReader): PrcSchema | null {
  const n = r.readUInt();
  if (n > 100_000) throw new PrcFormatError("neplatné schéma");
  if (n === 0) return null;
  const schema: PrcSchema = new Map();
  for (let i = 0; i < n; i++) {
    const type = r.readUInt();
    const count = r.readUInt();
    if (count > r.remaining) throw new PrcFormatError("neplatné schéma");
    const tokens = new Uint32Array(count);
    for (let k = 0; k < count; k++) tokens[k] = r.readUInt();
    schema.set(type, tokens);
  }
  return schema;
}

interface SchemaHost {
  r: BitReader;
}

interface ExecState {
  value: number;
  isBool: boolean;
  loop: number;
  inLoop: boolean;
  vars: Map<number, number>;
  father: number;
}

/** Provede schéma pro daný typ (přečte a zahodí nová pole). */
export function executeSchema(host: SchemaHost, schema: PrcSchema, type: number, depth = 0): void {
  const tokens = schema.get(type);
  if (!tokens || tokens.length === 0) return;
  if (depth > 16) throw new PrcFormatError("cyklické schéma");
  const st: ExecState = { value: 0, isBool: false, loop: 0, inLoop: false, vars: new Map(), father: -1 };
  let off = 0;
  while (off < tokens.length) off = exec(host.r, tokens, off, st, 0);
  if (st.father >= 0 && st.father !== type && schema.has(st.father)) {
    executeSchema(host, schema, st.father, depth + 1);
  }
}

function bad(): never {
  throw new PrcFormatError("neplatné schéma");
}

function at(t: Uint32Array, i: number): number {
  if (i < 0 || i >= t.length) bad();
  return t[i];
}

/** Přeskočí instrukci bez provedení; vrací offset za ní. */
function skip(t: Uint32Array, off: number, depth: number): number {
  if (depth > 4096) bad();
  const tok = at(t, off);
  switch (tok) {
    case Tok.BlockVersion:
    case Tok.BlockStart: {
      off += tok === Tok.BlockVersion ? 2 : 1;
      while (at(t, off) !== Tok.BlockEnd) off = skip(t, off, depth + 1);
      return off + 1;
    }
    case Tok.Boolean:
    case Tok.Double:
    case Tok.Character:
    case Tok.UInt:
    case Tok.Int:
    case Tok.String:
    case Tok.Vector2D:
    case Tok.Vector3D:
    case Tok.Extent1D:
    case Tok.Extent2D:
    case Tok.Extent3D:
    case Tok.PtrSurface:
    case Tok.PtrCurve:
    case Tok.ValueCurveIs3D:
    case Tok.ValueFor:
      return off + 1;
    case Tok.If: {
      off = skip(t, off + 1, depth + 1);
      off = skip(t, off, depth + 1);
      if (off < t.length && t[off] === Tok.Else) off = skip(t, off + 1, depth + 1);
      return off;
    }
    case Tok.PtrType:
    case Tok.FatherType:
    case Tok.ValueConstant:
    case Tok.Value:
    case Tok.ValueDeclare:
    case Tok.Ignore1:
    case Tok.Ignore2:
      return off + 2;
    case Tok.ValueDeclareAndSet:
    case Tok.ValueSet:
      return skip(t, off + 2, depth + 1);
    case Tok.SimpleFor:
      return skip(t, off + 1, depth + 1);
    case Tok.For:
    case Tok.LT:
    case Tok.LE:
    case Tok.GT:
    case Tok.GE:
    case Tok.EQ:
    case Tok.NEQ:
    case Tok.Add:
    case Tok.Sub:
    case Tok.Mult:
    case Tok.Div:
      off = skip(t, off + 1, depth + 1);
      return skip(t, off, depth + 1);
    default:
      return bad();
  }
}

function exec(r: BitReader, t: Uint32Array, off: number, st: ExecState, depth: number): number {
  if (depth > 4096) bad();
  const tok = at(t, off);
  const set = (v: number, b = false) => {
    st.value = v;
    st.isBool = b;
  };
  switch (tok) {
    case Tok.Boolean:
      set(r.readBit(), true);
      return off + 1;
    case Tok.Double:
      set(r.readDouble());
      return off + 1;
    case Tok.Character:
      set(r.readChar());
      return off + 1;
    case Tok.UInt:
      set(r.readUInt());
      return off + 1;
    case Tok.Int:
      set(r.readInt());
      return off + 1;
    case Tok.String:
      r.readString();
      set(0);
      return off + 1;
    case Tok.FatherType:
      st.father = at(t, off + 1);
      return off + 2;
    case Tok.Vector2D:
    case Tok.Extent1D:
      r.readDouble();
      r.readDouble();
      return off + 1;
    case Tok.Vector3D:
      for (let i = 0; i < 3; i++) r.readDouble();
      return off + 1;
    case Tok.Extent2D:
      for (let i = 0; i < 4; i++) r.readDouble();
      return off + 1;
    case Tok.Extent3D:
      for (let i = 0; i < 6; i++) r.readDouble();
      return off + 1;
    case Tok.PtrType:
    case Tok.PtrSurface:
    case Tok.PtrCurve:
      // vnořené geometrické objekty v rozšíření neumíme přeskočit
      throw new PrcFormatError("nepodporované rozšíření schématu (geometrie)");
    case Tok.For: {
      off = exec(r, t, off + 1, st, depth + 1);
      const n = Math.floor(st.value);
      const body = off;
      if (n <= 0) return skip(t, body, depth + 1);
      for (let k = 0; k < n; k++) {
        st.inLoop = true;
        st.loop = k;
        off = exec(r, t, body, st, depth + 1);
      }
      return off;
    }
    case Tok.SimpleFor: {
      const n = r.readUInt();
      const body = off + 1;
      if (n === 0) return skip(t, body, depth + 1);
      if (n > r.remaining) bad();
      for (let k = 0; k < n; k++) {
        st.inLoop = true;
        st.loop = k;
        off = exec(r, t, body, st, depth + 1);
      }
      return off;
    }
    case Tok.If: {
      off = exec(r, t, off + 1, st, depth + 1);
      const cond = st.value !== 0;
      if (cond) {
        off = exec(r, t, off, st, depth + 1);
        if (off < t.length && t[off] === Tok.Else) off = skip(t, off + 1, depth + 1);
      } else {
        off = skip(t, off, depth + 1);
        if (off < t.length && t[off] === Tok.Else) off = exec(r, t, off + 1, st, depth + 1);
      }
      return off;
    }
    case Tok.BlockStart: {
      off++;
      while (at(t, off) !== Tok.BlockEnd) off = exec(r, t, off, st, depth + 1);
      return off + 1;
    }
    case Tok.BlockVersion: {
      const version = at(t, off + 1);
      if (version <= READER_VERSION) return skip(t, off, depth + 1);
      off += 2;
      while (at(t, off) !== Tok.BlockEnd) off = exec(r, t, off, st, depth + 1);
      return off + 1;
    }
    case Tok.ValueDeclare:
      st.vars.set(at(t, off + 1), 0);
      return off + 2;
    case Tok.ValueSet:
    case Tok.ValueDeclareAndSet: {
      const key = at(t, off + 1);
      if (tok === Tok.ValueSet && !st.vars.has(key)) bad();
      off = exec(r, t, off + 2, st, depth + 1);
      st.vars.set(key, st.value);
      return off;
    }
    case Tok.Value: {
      const key = at(t, off + 1);
      const v = st.vars.get(key);
      if (v === undefined) bad();
      set(v);
      return off + 2;
    }
    case Tok.ValueConstant:
      set(at(t, off + 1));
      return off + 2;
    case Tok.ValueFor:
      if (!st.inLoop) bad();
      set(st.loop);
      return off + 1;
    case Tok.ValueCurveIs3D:
      set(1, true);
      return off + 1;
    case Tok.Mult:
    case Tok.Div:
    case Tok.Add:
    case Tok.Sub:
    case Tok.LT:
    case Tok.LE:
    case Tok.GT:
    case Tok.GE:
    case Tok.EQ:
    case Tok.NEQ: {
      off = exec(r, t, off + 1, st, depth + 1);
      const a = st.value;
      off = exec(r, t, off, st, depth + 1);
      const b = st.value;
      switch (tok) {
        case Tok.Mult:
          set(a * b);
          break;
        case Tok.Div:
          if (b === 0) bad();
          set(a / b);
          break;
        case Tok.Add:
          set(a + b);
          break;
        case Tok.Sub:
          set(a - b);
          break;
        case Tok.LT:
          set(a < b ? 1 : 0, true);
          break;
        case Tok.LE:
          set(a <= b ? 1 : 0, true);
          break;
        case Tok.GT:
          set(a > b ? 1 : 0, true);
          break;
        case Tok.GE:
          set(a >= b ? 1 : 0, true);
          break;
        case Tok.EQ:
          set(a === b ? 1 : 0, true);
          break;
        default:
          set(a !== b ? 1 : 0, true);
      }
      return off;
    }
    case Tok.Ignore1:
    case Tok.Ignore2:
      // token s jedním parametrem (zapisovače jím uvozují schéma), nic nečte
      return off + 2;
    default:
      return bad();
  }
}
