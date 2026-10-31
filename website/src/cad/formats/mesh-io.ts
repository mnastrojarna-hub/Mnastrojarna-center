/**
 * Čtení a zápis trojúhelníkových sítí (STL, OBJ, PLY, OFF, glTF/GLB, 3MF, VRML).
 * Čisté funkce bez DOM – běží v hlavním vlákně, ve workeru i v Node (testy).
 * Interní konvence: milimetry, osa Z nahoru.
 */
import { readZip, writeZip } from "./zip";

export type TriMesh = { positions: Float32Array; indices: Uint32Array };
/** Síť s normálami ve vrcholech (výstup OpenCascade mesh()). */
export type NormalMesh = TriMesh & { normals: Float32Array };

const dec = new TextDecoder();

// ---------------------------------------------------------------- pomocné

export function bytesToB64(u8: Uint8Array): string {
  let bin = "";
  for (let i = 0; i < u8.length; i += 0x8000) bin += String.fromCharCode(...u8.subarray(i, i + 0x8000));
  return typeof btoa === "function" ? btoa(bin) : Buffer.from(u8).toString("base64");
}

function b64Decode(b64: string): Uint8Array {
  if (typeof atob === "function") {
    const s = atob(b64);
    const u = new Uint8Array(s.length);
    for (let i = 0; i < s.length; i++) u[i] = s.charCodeAt(i);
    return u;
  }
  return new Uint8Array(Buffer.from(b64, "base64"));
}

export function triangleCount(m: TriMesh) {
  return m.indices.length / 3;
}

function bounds(pos: Float32Array) {
  const min = [Infinity, Infinity, Infinity];
  const max = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < pos.length; i += 3)
    for (let k = 0; k < 3; k++) {
      if (pos[i + k] < min[k]) min[k] = pos[i + k];
      if (pos[i + k] > max[k]) max[k] = pos[i + k];
    }
  return { min, max };
}

/** Sloučí totožné vrcholy (ploška OpenCascade má vlastní vrcholy) – nutné pro 3MF/VRML (uzavřená síť). */
export function weld(positions: Float32Array, indices: Uint32Array, eps = 1e-4): TriMesh {
  const map = new Map<string, number>();
  const out: number[] = [];
  const remap = new Uint32Array(positions.length / 3);
  const q = (v: number) => Math.round(v / eps);
  for (let i = 0; i < positions.length / 3; i++) {
    const key = `${q(positions[i * 3])},${q(positions[i * 3 + 1])},${q(positions[i * 3 + 2])}`;
    let k = map.get(key);
    if (k === undefined) {
      k = out.length / 3;
      map.set(key, k);
      out.push(positions[i * 3], positions[i * 3 + 1], positions[i * 3 + 2]);
    }
    remap[i] = k;
  }
  const idx: number[] = [];
  for (let t = 0; t < indices.length; t += 3) {
    const a = remap[indices[t]];
    const b = remap[indices[t + 1]];
    const c = remap[indices[t + 2]];
    if (a !== b && b !== c && a !== c) idx.push(a, b, c); // degenerované vynechat
  }
  return { positions: new Float32Array(out), indices: new Uint32Array(idx) };
}

function merge(parts: TriMesh[]): TriMesh {
  const nv = parts.reduce((s, p) => s + p.positions.length, 0);
  const ni = parts.reduce((s, p) => s + p.indices.length, 0);
  const positions = new Float32Array(nv);
  const indices = new Uint32Array(ni);
  let vo = 0;
  let io = 0;
  for (const p of parts) {
    positions.set(p.positions, vo);
    for (let i = 0; i < p.indices.length; i++) indices[io + i] = p.indices[i] + vo / 3;
    vo += p.positions.length;
    io += p.indices.length;
  }
  return { positions, indices };
}

function assertMesh(m: TriMesh, what: string): TriMesh {
  if (!m.indices.length) throw new Error(`${what}: soubor neobsahuje žádné trojúhelníky.`);
  return m;
}

// ---------------------------------------------------------------- STL

export function isBinarySTL(u8: Uint8Array) {
  if (u8.length < 84) return false;
  const n = new DataView(u8.buffer, u8.byteOffset, u8.byteLength).getUint32(80, true);
  if (84 + n * 50 === u8.length) return true;
  const head = dec.decode(u8.subarray(0, Math.min(u8.length, 512))).trimStart();
  return !/^solid[\s\S]*facet/i.test(head);
}

export function parseSTL(buf: ArrayBuffer | Uint8Array): TriMesh {
  const u8 = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
  if (isBinarySTL(u8)) {
    const dv = new DataView(u8.buffer, u8.byteOffset, u8.byteLength);
    const n = Math.min(dv.getUint32(80, true), Math.floor((u8.length - 84) / 50));
    const positions = new Float32Array(n * 9);
    for (let t = 0; t < n; t++) {
      const o = 84 + t * 50 + 12;
      for (let k = 0; k < 9; k++) positions[t * 9 + k] = dv.getFloat32(o + k * 4, true);
    }
    const indices = new Uint32Array(n * 3).map((_, i) => i);
    return assertMesh({ positions, indices }, "STL");
  }
  const txt = dec.decode(u8);
  const nums: number[] = [];
  const re = /vertex\s+(\S+)\s+(\S+)\s+(\S+)/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(txt))) nums.push(Number(m[1]), Number(m[2]), Number(m[3]));
  const positions = new Float32Array(nums.length - (nums.length % 9));
  positions.set(nums.slice(0, positions.length));
  return assertMesh({ positions, indices: new Uint32Array(positions.length / 3).map((_, i) => i) }, "STL");
}

export function writeBinarySTL(m: TriMesh, header = "Mnastrojarna CAD"): Uint8Array {
  const n = m.indices.length / 3;
  const out = new Uint8Array(84 + n * 50);
  out.set(new TextEncoder().encode(header.slice(0, 79)), 0);
  const dv = new DataView(out.buffer);
  dv.setUint32(80, n, true);
  const p = m.positions;
  for (let t = 0; t < n; t++) {
    const ia = m.indices[t * 3] * 3;
    const ib = m.indices[t * 3 + 1] * 3;
    const ic = m.indices[t * 3 + 2] * 3;
    const ux = p[ib] - p[ia], uy = p[ib + 1] - p[ia + 1], uz = p[ib + 2] - p[ia + 2];
    const vx = p[ic] - p[ia], vy = p[ic + 1] - p[ia + 1], vz = p[ic + 2] - p[ia + 2];
    let nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    const l = Math.hypot(nx, ny, nz) || 1;
    nx /= l; ny /= l; nz /= l;
    const o = 84 + t * 50;
    const vals = [nx, ny, nz, p[ia], p[ia + 1], p[ia + 2], p[ib], p[ib + 1], p[ib + 2], p[ic], p[ic + 1], p[ic + 2]];
    vals.forEach((v, k) => dv.setFloat32(o + k * 4, v, true));
  }
  return out;
}

// ---------------------------------------------------------------- OBJ

export function parseOBJ(text: string): TriMesh {
  const v: number[] = [];
  const idx: number[] = [];
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (line.startsWith("v ")) {
      const [, x, y, z] = line.split(/\s+/);
      v.push(Number(x), Number(y), Number(z));
    } else if (line.startsWith("f ")) {
      const n = v.length / 3;
      const ids = line
        .slice(2)
        .trim()
        .split(/\s+/)
        .map((tok) => {
          const i = parseInt(tok.split("/")[0], 10);
          return i < 0 ? n + i : i - 1;
        })
        .filter((i) => Number.isFinite(i));
      for (let k = 1; k + 1 < ids.length; k++) idx.push(ids[0], ids[k], ids[k + 1]);
    }
  }
  return assertMesh({ positions: new Float32Array(v), indices: new Uint32Array(idx) }, "OBJ");
}

export function writeOBJ(m: NormalMesh, name: string): string {
  const L: string[] = [`# Mnastrojarna CAD – ${name}`, "# jednotky: mm", `o ${name.replace(/\s+/g, "_") || "model"}`];
  const f = (x: number) => (Math.round(x * 1e5) / 1e5).toString();
  for (let i = 0; i < m.positions.length; i += 3) L.push(`v ${f(m.positions[i])} ${f(m.positions[i + 1])} ${f(m.positions[i + 2])}`);
  for (let i = 0; i < m.normals.length; i += 3) L.push(`vn ${f(m.normals[i])} ${f(m.normals[i + 1])} ${f(m.normals[i + 2])}`);
  for (let t = 0; t < m.indices.length; t += 3) {
    const [a, b, c] = [m.indices[t] + 1, m.indices[t + 1] + 1, m.indices[t + 2] + 1];
    L.push(`f ${a}//${a} ${b}//${b} ${c}//${c}`);
  }
  return L.join("\n") + "\n";
}

// ---------------------------------------------------------------- OFF

export function parseOFF(text: string): TriMesh {
  const toks = text
    .split(/\r?\n/)
    .map((l) => l.replace(/#.*/, "").trim())
    .filter(Boolean)
    .join(" ")
    .split(/\s+/);
  let i = 0;
  if (/^[A-Z]*OFF$/.test(toks[0])) i++;
  const nv = Number(toks[i++]);
  const nf = Number(toks[i++]);
  i++; // počet hran
  const v = new Float32Array(nv * 3);
  for (let k = 0; k < nv * 3; k++) v[k] = Number(toks[i++]);
  const idx: number[] = [];
  for (let f = 0; f < nf; f++) {
    const n = Number(toks[i++]);
    const ids = toks.slice(i, i + n).map(Number);
    i += n;
    for (let k = 1; k + 1 < ids.length; k++) idx.push(ids[0], ids[k], ids[k + 1]);
  }
  return assertMesh({ positions: v, indices: new Uint32Array(idx) }, "OFF");
}

// ---------------------------------------------------------------- PLY

const PLY_SIZE: Record<string, number> = { char: 1, int8: 1, uchar: 1, uint8: 1, short: 2, int16: 2, ushort: 2, uint16: 2, int: 4, int32: 4, uint: 4, uint32: 4, float: 4, float32: 4, double: 8, float64: 8 };

export function parsePLY(buf: ArrayBuffer | Uint8Array): TriMesh {
  const u8 = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
  const headEnd = dec.decode(u8.subarray(0, Math.min(u8.length, 8192))).indexOf("end_header");
  if (headEnd < 0) throw new Error("PLY: chybí hlavička.");
  const headerText = dec.decode(u8.subarray(0, headEnd));
  let bodyStart = headEnd + "end_header".length;
  while (u8[bodyStart] === 13 || u8[bodyStart] === 10) {
    bodyStart++;
    if (u8[bodyStart - 1] === 10) break;
  }
  type Prop = { name: string; type: string; list?: { count: string; item: string } };
  const elements: { name: string; count: number; props: Prop[] }[] = [];
  let format = "ascii";
  for (const line of headerText.split(/\r?\n/)) {
    const p = line.trim().split(/\s+/);
    if (p[0] === "format") format = p[1];
    if (p[0] === "element") elements.push({ name: p[1], count: Number(p[2]), props: [] });
    if (p[0] === "property") {
      const el = elements[elements.length - 1];
      if (p[1] === "list") el.props.push({ name: p[4], type: "list", list: { count: p[2], item: p[3] } });
      else el.props.push({ name: p[2], type: p[1] });
    }
  }
  const pos: number[] = [];
  const idx: number[] = [];
  if (format === "ascii") {
    const toks = dec.decode(u8.subarray(bodyStart)).trim().split(/\s+/);
    let i = 0;
    for (const el of elements)
      for (let n = 0; n < el.count; n++) {
        const rec: Record<string, number | number[]> = {};
        for (const pr of el.props) {
          if (pr.list) {
            const c = Number(toks[i++]);
            rec[pr.name] = toks.slice(i, i + c).map(Number);
            i += c;
          } else rec[pr.name] = Number(toks[i++]);
        }
        if (el.name === "vertex") pos.push(rec.x as number, rec.y as number, rec.z as number);
        if (el.name === "face") {
          const ids = (rec.vertex_indices ?? rec.vertex_index) as number[];
          for (let k = 1; ids && k + 1 < ids.length; k++) idx.push(ids[0], ids[k], ids[k + 1]);
        }
      }
  } else {
    const le = format === "binary_little_endian";
    const dv = new DataView(u8.buffer, u8.byteOffset + bodyStart, u8.byteLength - bodyStart);
    let o = 0;
    const read = (t: string) => {
      let v: number;
      switch (PLY_SIZE[t] && t) {
        case "char": case "int8": v = dv.getInt8(o); break;
        case "uchar": case "uint8": v = dv.getUint8(o); break;
        case "short": case "int16": v = dv.getInt16(o, le); break;
        case "ushort": case "uint16": v = dv.getUint16(o, le); break;
        case "int": case "int32": v = dv.getInt32(o, le); break;
        case "uint": case "uint32": v = dv.getUint32(o, le); break;
        case "float": case "float32": v = dv.getFloat32(o, le); break;
        case "double": case "float64": v = dv.getFloat64(o, le); break;
        default: throw new Error(`PLY: neznámý typ ${t}.`);
      }
      o += PLY_SIZE[t];
      return v;
    };
    for (const el of elements)
      for (let n = 0; n < el.count; n++) {
        const rec: Record<string, number | number[]> = {};
        for (const pr of el.props) {
          if (pr.list) {
            const c = read(pr.list.count);
            const arr: number[] = [];
            for (let k = 0; k < c; k++) arr.push(read(pr.list.item));
            rec[pr.name] = arr;
          } else rec[pr.name] = read(pr.type);
        }
        if (el.name === "vertex") pos.push(rec.x as number, rec.y as number, rec.z as number);
        if (el.name === "face") {
          const ids = (rec.vertex_indices ?? rec.vertex_index) as number[];
          for (let k = 1; ids && k + 1 < ids.length; k++) idx.push(ids[0], ids[k], ids[k + 1]);
        }
      }
  }
  return assertMesh({ positions: new Float32Array(pos), indices: new Uint32Array(idx) }, "PLY");
}

// ---------------------------------------------------------------- glTF / GLB

type Gltf = {
  scene?: number;
  scenes?: { nodes?: number[] }[];
  nodes?: { mesh?: number; children?: number[]; matrix?: number[]; translation?: number[]; rotation?: number[]; scale?: number[] }[];
  meshes?: { primitives: { attributes: Record<string, number>; indices?: number; mode?: number }[] }[];
  accessors?: { bufferView?: number; byteOffset?: number; componentType: number; count: number; type: string }[];
  bufferViews?: { buffer: number; byteOffset?: number; byteLength: number; byteStride?: number }[];
  buffers?: { uri?: string; byteLength: number }[];
};

type Mat4 = number[]; // column-major (glTF)
const IDENT: Mat4 = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
function mul(a: Mat4, b: Mat4): Mat4 {
  const o = new Array(16).fill(0);
  for (let c = 0; c < 4; c++) for (let r = 0; r < 4; r++) for (let k = 0; k < 4; k++) o[c * 4 + r] += a[k * 4 + r] * b[c * 4 + k];
  return o;
}
function trs(n: { translation?: number[]; rotation?: number[]; scale?: number[] }): Mat4 {
  const [x, y, z, w] = n.rotation ?? [0, 0, 0, 1];
  const [sx, sy, sz] = n.scale ?? [1, 1, 1];
  const [tx, ty, tz] = n.translation ?? [0, 0, 0];
  return [
    (1 - 2 * (y * y + z * z)) * sx, 2 * (x * y + z * w) * sx, 2 * (x * z - y * w) * sx, 0,
    2 * (x * y - z * w) * sy, (1 - 2 * (x * x + z * z)) * sy, 2 * (y * z + x * w) * sy, 0,
    2 * (x * z + y * w) * sz, 2 * (y * z - x * w) * sz, (1 - 2 * (x * x + y * y)) * sz, 0,
    tx, ty, tz, 1,
  ];
}

export function parseGLTF(input: ArrayBuffer | Uint8Array, externalBuffers?: Record<string, Uint8Array>): TriMesh {
  const u8 = input instanceof Uint8Array ? input : new Uint8Array(input);
  let json: Gltf;
  let bin: Uint8Array | null = null;
  const dv = new DataView(u8.buffer, u8.byteOffset, u8.byteLength);
  if (u8.length >= 12 && dv.getUint32(0, true) === 0x46546c67) {
    let o = 12;
    json = {};
    while (o + 8 <= u8.length) {
      const len = dv.getUint32(o, true);
      const type = dv.getUint32(o + 4, true);
      const chunk = u8.subarray(o + 8, o + 8 + len);
      if (type === 0x4e4f534a) json = JSON.parse(dec.decode(chunk));
      if (type === 0x004e4942) bin = chunk;
      o += 8 + len;
    }
  } else json = JSON.parse(dec.decode(u8));

  const buffers = (json.buffers ?? []).map((b, i) => {
    if (!b.uri) {
      if (!bin) throw new Error("glTF: chybí binární data.");
      return bin;
    }
    const m = /^data:[^;]*;base64,(.*)$/.exec(b.uri);
    if (m) return b64Decode(m[1]);
    const ext = externalBuffers?.[b.uri] ?? externalBuffers?.[decodeURIComponent(b.uri)];
    if (ext) return ext;
    throw new Error(`glTF odkazuje na externí soubor „${b.uri}“ – použijte formát GLB (vše v jednom souboru). (buffer ${i})`);
  });

  const readAcc = (ai: number): Float64Array => {
    const a = json.accessors![ai];
    const ncomp = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4 }[a.type] ?? 1;
    const out = new Float64Array(a.count * ncomp);
    if (a.bufferView == null) return out;
    const bv = json.bufferViews![a.bufferView];
    const buf = buffers[bv.buffer];
    const csize = { 5120: 1, 5121: 1, 5122: 2, 5123: 2, 5125: 4, 5126: 4 }[a.componentType] ?? 4;
    const stride = bv.byteStride || csize * ncomp;
    const base = (bv.byteOffset ?? 0) + (a.byteOffset ?? 0);
    const d = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
    for (let i = 0; i < a.count; i++)
      for (let k = 0; k < ncomp; k++) {
        const o = base + i * stride + k * csize;
        out[i * ncomp + k] =
          a.componentType === 5126 ? d.getFloat32(o, true)
          : a.componentType === 5125 ? d.getUint32(o, true)
          : a.componentType === 5123 ? d.getUint16(o, true)
          : a.componentType === 5122 ? d.getInt16(o, true)
          : a.componentType === 5121 ? d.getUint8(o)
          : d.getInt8(o);
      }
    return out;
  };

  const parts: TriMesh[] = [];
  const visit = (ni: number, parent: Mat4) => {
    const n = json.nodes![ni];
    const local = n.matrix ?? trs(n);
    const M = mul(parent, local);
    if (n.mesh != null)
      for (const prim of json.meshes![n.mesh].primitives) {
        if ((prim.mode ?? 4) !== 4 || prim.attributes.POSITION == null) continue;
        const p = readAcc(prim.attributes.POSITION);
        const positions = new Float32Array(p.length);
        for (let i = 0; i < p.length; i += 3) {
          const [x, y, z] = [p[i], p[i + 1], p[i + 2]];
          const wx = M[0] * x + M[4] * y + M[8] * z + M[12];
          const wy = M[1] * x + M[5] * y + M[9] * z + M[13];
          const wz = M[2] * x + M[6] * y + M[10] * z + M[14];
          // glTF: metry, Y nahoru → CAD: mm, Z nahoru
          positions[i] = wx * 1000;
          positions[i + 1] = -wz * 1000;
          positions[i + 2] = wy * 1000;
        }
        const indices = prim.indices != null ? Uint32Array.from(readAcc(prim.indices)) : new Uint32Array(p.length / 3).map((_, i) => i);
        parts.push({ positions, indices });
      }
    for (const c of n.children ?? []) visit(c, M);
  };
  const roots = json.scenes?.[json.scene ?? 0]?.nodes ?? (json.nodes ?? []).map((_, i) => i);
  for (const r of roots) visit(r, IDENT);
  return assertMesh(merge(parts), "glTF");
}

/** glTF 2.0 binární (GLB): metry, osa Y nahoru, PBR ocel. */
export function writeGLB(m: NormalMesh, name: string, color: [number, number, number] = [0.78, 0.8, 0.83]): Uint8Array {
  const nv = m.positions.length / 3;
  const pos = new Float32Array(nv * 3);
  const nor = new Float32Array(nv * 3);
  for (let i = 0; i < nv; i++) {
    // mm → m, Z nahoru → Y nahoru: (x, y, z) → (x, z, -y)
    pos[i * 3] = m.positions[i * 3] / 1000;
    pos[i * 3 + 1] = m.positions[i * 3 + 2] / 1000;
    pos[i * 3 + 2] = -m.positions[i * 3 + 1] / 1000;
    nor[i * 3] = m.normals[i * 3] ?? 0;
    nor[i * 3 + 1] = m.normals[i * 3 + 2] ?? 0;
    nor[i * 3 + 2] = -(m.normals[i * 3 + 1] ?? 0);
  }
  const { min, max } = bounds(pos);
  const idx = new Uint32Array(m.indices);
  const binLen = pos.byteLength + nor.byteLength + idx.byteLength;
  const bin = new Uint8Array(Math.ceil(binLen / 4) * 4);
  bin.set(new Uint8Array(pos.buffer), 0);
  bin.set(new Uint8Array(nor.buffer), pos.byteLength);
  bin.set(new Uint8Array(idx.buffer), pos.byteLength + nor.byteLength);
  const gltf = {
    asset: { version: "2.0", generator: "Mnastrojarna CAD" },
    scene: 0,
    scenes: [{ nodes: [0] }],
    nodes: [{ mesh: 0, name }],
    meshes: [{ name, primitives: [{ attributes: { POSITION: 0, NORMAL: 1 }, indices: 2, material: 0 }] }],
    materials: [{ name: "Ocel", pbrMetallicRoughness: { baseColorFactor: [...color, 1], metallicFactor: 0.6, roughnessFactor: 0.4 } }],
    buffers: [{ byteLength: bin.length }],
    bufferViews: [
      { buffer: 0, byteOffset: 0, byteLength: pos.byteLength, target: 34962 },
      { buffer: 0, byteOffset: pos.byteLength, byteLength: nor.byteLength, target: 34962 },
      { buffer: 0, byteOffset: pos.byteLength + nor.byteLength, byteLength: idx.byteLength, target: 34963 },
    ],
    accessors: [
      { bufferView: 0, componentType: 5126, count: nv, type: "VEC3", min, max },
      { bufferView: 1, componentType: 5126, count: nv, type: "VEC3" },
      { bufferView: 2, componentType: 5125, count: idx.length, type: "SCALAR" },
    ],
  };
  let jsonBytes = new TextEncoder().encode(JSON.stringify(gltf));
  const pad = (4 - (jsonBytes.length % 4)) % 4;
  if (pad) {
    const j = new Uint8Array(jsonBytes.length + pad).fill(0x20);
    j.set(jsonBytes);
    jsonBytes = j;
  }
  const total = 12 + 8 + jsonBytes.length + 8 + bin.length;
  const out = new Uint8Array(total);
  const dv = new DataView(out.buffer);
  dv.setUint32(0, 0x46546c67, true);
  dv.setUint32(4, 2, true);
  dv.setUint32(8, total, true);
  dv.setUint32(12, jsonBytes.length, true);
  dv.setUint32(16, 0x4e4f534a, true);
  out.set(jsonBytes, 20);
  const o = 20 + jsonBytes.length;
  dv.setUint32(o, bin.length, true);
  dv.setUint32(o + 4, 0x004e4942, true);
  out.set(bin, o + 8);
  return out;
}

// ---------------------------------------------------------------- 3MF

const UNIT_3MF: Record<string, number> = { micron: 0.001, millimeter: 1, centimeter: 10, inch: 25.4, foot: 304.8, meter: 1000 };

export async function parse3MF(buf: ArrayBuffer | Uint8Array): Promise<TriMesh> {
  const entries = readZip(buf);
  const models = entries.filter((e) => /\.model$/i.test(e.name));
  if (!models.length) throw new Error("3MF: archiv neobsahuje 3D model.");
  const parts: TriMesh[] = [];
  for (const entry of models) {
    const xml = dec.decode(await entry.read());
    const unit = UNIT_3MF[/<model[^>]*\bunit="([^"]+)"/.exec(xml)?.[1] ?? "millimeter"] ?? 1;
    const attr = (s: string, n: string) => new RegExp(`\\b${n}="([^"]*)"`).exec(s)?.[1];
    const objects = new Map<string, { mesh?: TriMesh; comps: { id: string; t?: number[] }[] }>();
    const objRe = /<object\b([^>]*)>([\s\S]*?)<\/object>/g;
    let om: RegExpExecArray | null;
    while ((om = objRe.exec(xml))) {
      const id = attr(om[1], "id")!;
      const body = om[2];
      const verts: number[] = [];
      const vre = /<vertex\b([^>]*)\/?>/g;
      let vm: RegExpExecArray | null;
      while ((vm = vre.exec(body))) verts.push(Number(attr(vm[1], "x")) * unit, Number(attr(vm[1], "y")) * unit, Number(attr(vm[1], "z")) * unit);
      const tris: number[] = [];
      const tre = /<triangle\b([^>]*)\/?>/g;
      let tm: RegExpExecArray | null;
      while ((tm = tre.exec(body))) tris.push(Number(attr(tm[1], "v1")), Number(attr(tm[1], "v2")), Number(attr(tm[1], "v3")));
      const comps: { id: string; t?: number[] }[] = [];
      const cre = /<component\b([^>]*)\/?>/g;
      let cm: RegExpExecArray | null;
      while ((cm = cre.exec(body))) comps.push({ id: attr(cm[1], "objectid")!, t: attr(cm[1], "transform")?.trim().split(/\s+/).map(Number) });
      objects.set(id, { mesh: verts.length ? { positions: new Float32Array(verts), indices: new Uint32Array(tris) } : undefined, comps });
    }
    const apply = (m: TriMesh, t?: number[]): TriMesh => {
      if (!t || t.length !== 12) return m;
      const p = new Float32Array(m.positions.length);
      for (let i = 0; i < p.length; i += 3) {
        const [x, y, z] = [m.positions[i], m.positions[i + 1], m.positions[i + 2]];
        p[i] = x * t[0] + y * t[3] + z * t[6] + t[9] * unit;
        p[i + 1] = x * t[1] + y * t[4] + z * t[7] + t[10] * unit;
        p[i + 2] = x * t[2] + y * t[5] + z * t[8] + t[11] * unit;
      }
      return { positions: p, indices: m.indices };
    };
    const resolve = (id: string, depth = 0): TriMesh[] => {
      const o = objects.get(id);
      if (!o || depth > 16) return [];
      const out: TriMesh[] = o.mesh ? [o.mesh] : [];
      for (const c of o.comps) for (const m of resolve(c.id, depth + 1)) out.push(apply(m, c.t));
      return out;
    };
    const items = [...xml.matchAll(/<item\b([^>]*)\/?>/g)];
    if (items.length)
      for (const it of items) {
        const t = attr(it[1], "transform")?.trim().split(/\s+/).map(Number);
        for (const m of resolve(attr(it[1], "objectid")!)) parts.push(apply(m, t));
      }
    else for (const id of objects.keys()) parts.push(...resolve(id));
  }
  return assertMesh(merge(parts), "3MF");
}

export function write3MF(m: TriMesh, name: string): Uint8Array {
  const w = weld(m.positions, m.indices);
  const f = (x: number) => (Math.round(x * 1e5) / 1e5).toString();
  const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);
  const v: string[] = [];
  for (let i = 0; i < w.positions.length; i += 3) v.push(`<vertex x="${f(w.positions[i])}" y="${f(w.positions[i + 1])}" z="${f(w.positions[i + 2])}"/>`);
  const t: string[] = [];
  for (let i = 0; i < w.indices.length; i += 3) t.push(`<triangle v1="${w.indices[i]}" v2="${w.indices[i + 1]}" v3="${w.indices[i + 2]}"/>`);
  const model = `<?xml version="1.0" encoding="UTF-8"?>
<model unit="millimeter" xml:lang="cs-CZ" xmlns="http://schemas.microsoft.com/3dmanufacturing/core/2015/02">
<metadata name="Title">${esc(name)}</metadata>
<metadata name="Application">Mnastrojarna CAD</metadata>
<resources>
<object id="1" type="model" name="${esc(name)}"><mesh><vertices>${v.join("")}</vertices><triangles>${t.join("")}</triangles></mesh></object>
</resources>
<build><item objectid="1"/></build>
</model>`;
  const types = `<?xml version="1.0" encoding="UTF-8"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="model" ContentType="application/vnd.ms-package.3dmanufacturing-3dmodel+xml"/></Types>`;
  const rels = `<?xml version="1.0" encoding="UTF-8"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Target="/3D/3dmodel.model" Id="rel0" Type="http://schemas.microsoft.com/3dmanufacturing/2013/01/3dmodel"/></Relationships>`;
  return writeZip([
    { name: "[Content_Types].xml", data: types },
    { name: "_rels/.rels", data: rels },
    { name: "3D/3dmodel.model", data: model },
  ]);
}

// ---------------------------------------------------------------- VRML 2.0

export function writeWRL(m: TriMesh, name: string, color: [number, number, number] = [0.78, 0.8, 0.83]): string {
  const w = weld(m.positions, m.indices);
  const f = (x: number) => (Math.round(x * 1e4) / 1e4).toString();
  const pts: string[] = [];
  for (let i = 0; i < w.positions.length; i += 3) pts.push(`${f(w.positions[i])} ${f(w.positions[i + 1])} ${f(w.positions[i + 2])}`);
  const idx: string[] = [];
  for (let i = 0; i < w.indices.length; i += 3) idx.push(`${w.indices[i]} ${w.indices[i + 1]} ${w.indices[i + 2]} -1`);
  return `#VRML V2.0 utf8
# Mnastrojarna CAD – ${name.replace(/\n/g, " ")} (jednotky: mm)
Shape {
  appearance Appearance { material Material { diffuseColor ${color.join(" ")} specularColor 0.6 0.6 0.6 shininess 0.4 } }
  geometry IndexedFaceSet {
    solid TRUE
    creaseAngle 0.5
    coord Coordinate { point [ ${pts.join(", ")} ] }
    coordIndex [ ${idx.join(", ")} ]
  }
}
`;
}
