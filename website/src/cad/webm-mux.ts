/**
 * Zápis a čtení kontejneru WebM (Matroska / EBML) s pevnými časovými značkami snímků (vlna 22, bod 13 zprávy). Čistý kód bez
 * prohlížeče: export videa pohybové studie do něj vloží zakódované snímky VP8 / VP9 (WebCodecs, nebo klíčové snímky VP8 z WebP)
 * s časem i·1000/fps ms a délkou N·1000/fps ms – délka videa tak nezávisí na tom, jak rychle se snímky vykreslovaly.
 * Čtení (`readWebm`) slouží testům a kontrole hotového souboru: délka, kodek, rozměr, časy a velikosti bloků.
 */

export type WebmFrame = { data: Uint8Array; /** čas snímku [ms] */ time: number; key: boolean };
export type WebmInput = {
  codec: "V_VP8" | "V_VP9";
  width: number;
  height: number;
  fps: number;
  frames: WebmFrame[];
  /** délka videa [ms] (výchozí počet snímků / fps) */ duration?: number;
  app?: string;
  /** značky souboru (Matroska Tags/SimpleTag – např. MODEL_REVISION = revize modelu studie; vlna 22 kolo 7, bod 12) */
  tags?: Record<string, string>;
};

/* ───────────────────────── zápis ───────────────────────── */

const ID = {
  EBML: 0x1a45dfa3,
  EBMLVersion: 0x4286,
  EBMLReadVersion: 0x42f7,
  EBMLMaxIDLength: 0x42f2,
  EBMLMaxSizeLength: 0x42f3,
  DocType: 0x4282,
  DocTypeVersion: 0x4287,
  DocTypeReadVersion: 0x4285,
  Segment: 0x18538067,
  Info: 0x1549a966,
  TimecodeScale: 0x2ad7b1,
  Duration: 0x4489,
  MuxingApp: 0x4d80,
  WritingApp: 0x5741,
  Tracks: 0x1654ae6b,
  TrackEntry: 0xae,
  TrackNumber: 0xd7,
  TrackUID: 0x73c5,
  FlagLacing: 0x9c,
  CodecID: 0x86,
  TrackType: 0x83,
  DefaultDuration: 0x23e383,
  Video: 0xe0,
  PixelWidth: 0xb0,
  PixelHeight: 0xba,
  Cluster: 0x1f43b675,
  Timecode: 0xe7,
  SimpleBlock: 0xa3,
  BlockGroup: 0xa0,
  Block: 0xa1,
  Cues: 0x1c53bb6b,
  SeekHead: 0x114d9b74,
  Tags: 0x1254c367,
  Tag: 0x7373,
  Targets: 0x63c0,
  SimpleTag: 0x67c8,
  TagName: 0x45a3,
  TagString: 0x4487,
  Void: 0xec,
} as const;

type Node = Uint8Array;
const concat = (parts: Uint8Array[]): Uint8Array => {
  const n = parts.reduce((a, p) => a + p.length, 0);
  const out = new Uint8Array(n);
  let o = 0;
  for (const p of parts) {
    out.set(p, o);
    o += p.length;
  }
  return out;
};
function idBytes(id: number): Uint8Array {
  const b: number[] = [];
  let v = id;
  while (v > 0) {
    b.unshift(v & 0xff);
    v = Math.floor(v / 256);
  }
  return new Uint8Array(b);
}
/** délka jako EBML vint (nejkratší zápis) */
function sizeBytes(n: number): Uint8Array {
  for (let len = 1; len <= 8; len++) {
    const max = 2 ** (7 * len) - 2; // samé jedničky = neznámá délka
    if (n <= max) {
      const out = new Uint8Array(len);
      let v = n;
      for (let i = len - 1; i >= 0; i--) {
        out[i] = v & 0xff;
        v = Math.floor(v / 256);
      }
      out[0] |= 1 << (8 - len);
      return out;
    }
  }
  throw new Error("EBML: element je příliš velký");
}
const el = (id: number, body: Uint8Array): Node => concat([idBytes(id), sizeBytes(body.length), body]);
const master = (id: number, children: Node[]): Node => el(id, concat(children));
function uint(id: number, v: number): Node {
  const b: number[] = [];
  let x = Math.max(0, Math.round(v));
  do {
    b.unshift(x & 0xff);
    x = Math.floor(x / 256);
  } while (x > 0);
  return el(id, new Uint8Array(b));
}
const str = (id: number, s: string): Node => el(id, new TextEncoder().encode(s));
function float(id: number, v: number): Node {
  const b = new Uint8Array(8);
  new DataView(b.buffer).setFloat64(0, v);
  return el(id, b);
}
function simpleBlock(track: number, rel: number, key: boolean, data: Uint8Array): Node {
  const head = new Uint8Array(4);
  head[0] = 0x80 | track;
  new DataView(head.buffer).setInt16(1, rel);
  head[3] = key ? 0x80 : 0;
  return el(ID.SimpleBlock, concat([head, data]));
}

/**
 * Soubor WebM z hotových snímků. Časy bloků = `frame.time` (ms, zaokrouhleno), délka v hlavičce = `duration` (výchozí
 * N·1000/fps). Nový cluster začíná klíčovým snímkem (a nejpozději po 30 s – relativní čas bloku je 16bitový).
 */
export function muxWebm(v: WebmInput): Uint8Array {
  if (!v.frames.length) throw new Error("WebM: žádný snímek");
  if (!v.frames[0].key) throw new Error("WebM: první snímek musí být klíčový");
  const duration = v.duration ?? (v.frames.length * 1000) / v.fps;
  const header = master(ID.EBML, [uint(ID.EBMLVersion, 1), uint(ID.EBMLReadVersion, 1), uint(ID.EBMLMaxIDLength, 4), uint(ID.EBMLMaxSizeLength, 8), str(ID.DocType, "webm"), uint(ID.DocTypeVersion, 2), uint(ID.DocTypeReadVersion, 2)]);
  const info = master(ID.Info, [uint(ID.TimecodeScale, 1_000_000), str(ID.MuxingApp, "mncad-webm"), str(ID.WritingApp, v.app ?? "Mnástrojárna CAD"), float(ID.Duration, duration)]);
  const tracks = master(ID.Tracks, [
    master(ID.TrackEntry, [uint(ID.TrackNumber, 1), uint(ID.TrackUID, 1), uint(ID.FlagLacing, 0), str(ID.CodecID, v.codec), uint(ID.TrackType, 1), uint(ID.DefaultDuration, Math.round(1e9 / v.fps)), master(ID.Video, [uint(ID.PixelWidth, v.width), uint(ID.PixelHeight, v.height)])]),
  ]);
  const clusters: Node[] = [];
  let start = -1;
  let blocks: Node[] = [];
  const flush = () => {
    if (start >= 0 && blocks.length) clusters.push(master(ID.Cluster, [uint(ID.Timecode, start), ...blocks]));
    blocks = [];
  };
  for (const f of v.frames) {
    const t = Math.max(0, Math.round(f.time));
    if (start < 0 || f.key || t - start > 30_000) {
      flush();
      start = t;
    }
    blocks.push(simpleBlock(1, t - start, f.key, f.data));
  }
  flush();
  return concat([header, master(ID.Segment, [info, tracks, ...clusters, ...tagsNode(v.tags)])]);
}

/** element Tags (jedna značka pro celý segment – prázdné Targets) nebo nic */
function tagsNode(tags: Record<string, string> | undefined): Node[] {
  const list = Object.entries(tags ?? {}).filter(([k, v]) => k && v !== undefined);
  if (!list.length) return [];
  return [master(ID.Tags, [master(ID.Tag, [master(ID.Targets, []), ...list.map(([k, v]) => master(ID.SimpleTag, [str(ID.TagName, k), str(ID.TagString, v)]))])])];
}

/**
 * Připíše značky do hotového souboru WebM (vlna 22 kolo 7, bod 12 – revize modelu ve videu pohybové studie): element Tags na
 * konec segmentu, délka segmentu se přepíše. Segment neznámé délky (MediaRecorder) = Tags se jen připojí na konec. Snímky
 * a časy se nemění (bajty clusterů zůstávají stejné).
 */
export function tagWebm(bytes: Uint8Array, tags: Record<string, string>): Uint8Array {
  const add = tagsNode(tags);
  if (!add.length) return bytes;
  const readId = (o: number): number => {
    const b = bytes[o];
    return b >= 0x80 ? 1 : b >= 0x40 ? 2 : b >= 0x20 ? 3 : b >= 0x10 ? 4 : 0;
  };
  let o = 0;
  while (o < bytes.length) {
    const il = readId(o);
    if (!il) throw new Error("WebM: neplatné ID na " + o);
    let id = 0;
    for (let i = 0; i < il; i++) id = id * 256 + bytes[o + i];
    const b0 = bytes[o + il];
    let sl = 1;
    while (sl <= 8 && !(b0 & (0x80 >> (sl - 1)))) sl++;
    if (sl > 8) throw new Error("WebM: neplatná délka na " + (o + il));
    let size = b0 & (0xff >> sl);
    let ones = size === 0xff >> sl;
    for (let i = 1; i < sl; i++) {
      size = size * 256 + bytes[o + il + i];
      if (bytes[o + il + i] !== 0xff) ones = false;
    }
    const body = o + il + sl;
    if (id === ID.Segment) {
      if (ones) return concat([bytes, ...add]); // neznámá délka: segment sahá do konce souboru
      const end = body + size;
      return concat([bytes.subarray(0, o), master(ID.Segment, [bytes.subarray(body, end), ...add]), bytes.subarray(end)]);
    }
    if (ones) break;
    o = body + size;
  }
  throw new Error("WebM: soubor nemá segment");
}

/* ───────────────────────── WebP → VP8 ───────────────────────── */

/**
 * Bitový tok VP8 ze ztrátového obrázku WebP (kontejner RIFF, blok „VP8 “ – i uvnitř rozšířeného „VP8X“ s průhledností):
 * je to klíčový snímek VP8 použitelný přímo jako blok WebM. Bezeztrátový WebP („VP8L“) nebo jiný formát → null.
 */
export function webpVp8(bytes: Uint8Array): Uint8Array | null {
  const tag = (o: number) => String.fromCharCode(bytes[o], bytes[o + 1], bytes[o + 2], bytes[o + 3]);
  if (bytes.length < 20 || tag(0) !== "RIFF" || tag(8) !== "WEBP") return null;
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let o = 12;
  while (o + 8 <= bytes.length) {
    const name = tag(o);
    const size = dv.getUint32(o + 4, true);
    if (name === "VP8 ") return bytes.slice(o + 8, o + 8 + size);
    o += 8 + size + (size & 1);
  }
  return null;
}

/* ───────────────────────── čtení ───────────────────────── */

export type WebmBlock = { time: number; key: boolean; size: number; track: number; /** otisk dat bloku (FNV-1a) */ hash: string };
export type WebmInfo = { docType: string; timecodeScale: number; /** délka z hlavičky [ms] (null = chybí) */ duration: number | null; codec: string; width: number; height: number; defaultDuration: number | null; blocks: WebmBlock[]; /** značky souboru (SimpleTag název → text) */ tags: Record<string, string> };

const MASTER = new Set<number>([ID.EBML, ID.Segment, ID.Info, ID.Tracks, ID.TrackEntry, ID.Video, ID.Cluster, ID.BlockGroup, ID.Cues, ID.SeekHead, ID.Tags, ID.Tag, ID.Targets]);
/** elementy, které ukončí cluster neznámé délky */
const TOP = new Set<number>([ID.Cluster, ID.Cues, ID.Tags, ID.SeekHead, ID.Info, ID.Tracks]);

function fnv(b: Uint8Array, from: number, to: number): string {
  let h = 0x811c9dc5;
  for (let i = from; i < to; i++) {
    h ^= b[i];
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, "0");
}

/** Přečte WebM / Matroska: hlavičku, stopu videa a všechny bloky (i z MediaRecorderu s neznámou délkou segmentu a clusterů). */
export function readWebm(bytes: Uint8Array): WebmInfo {
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const out: WebmInfo = { docType: "", timecodeScale: 1_000_000, duration: null, codec: "", width: 0, height: 0, defaultDuration: null, blocks: [], tags: {} };
  const readId = (o: number): [number, number] => {
    const b = bytes[o];
    const len = b >= 0x80 ? 1 : b >= 0x40 ? 2 : b >= 0x20 ? 3 : b >= 0x10 ? 4 : 0;
    if (!len) throw new Error("WebM: neplatné ID na " + o);
    let v = 0;
    for (let i = 0; i < len; i++) v = v * 256 + bytes[o + i];
    return [v, len];
  };
  const readSize = (o: number): [number | null, number] => {
    const b = bytes[o];
    let len = 1;
    while (len <= 8 && !(b & (0x80 >> (len - 1)))) len++;
    if (len > 8) throw new Error("WebM: neplatná délka na " + o);
    let v = b & (0xff >> len);
    let ones = v === 0xff >> len;
    for (let i = 1; i < len; i++) {
      v = v * 256 + bytes[o + i];
      if (bytes[o + i] !== 0xff) ones = false;
    }
    return [ones ? null : v, len];
  };
  const readUint = (o: number, n: number) => {
    let v = 0;
    for (let i = 0; i < n; i++) v = v * 256 + bytes[o + i];
    return v;
  };
  let clusterTime = 0;
  const walk = (from: number, to: number, inCluster: boolean): number => {
    let o = from;
    while (o < to) {
      const [id, il] = readId(o);
      if (inCluster && TOP.has(id)) return o; // cluster neznámé délky končí dalším elementem nejvyšší úrovně
      const [size, sl] = readSize(o + il);
      const body = o + il + sl;
      const end = size === null ? to : Math.min(to, body + size);
      if (id === ID.SimpleTag) {
        // značka: TagName + TagString (vnořené SimpleTag se nečtou)
        let name = "";
        let text = "";
        for (let q = body; q < end; ) {
          const [cid, cil] = readId(q);
          const [cs, csl] = readSize(q + cil);
          const cb = q + cil + csl;
          const ce = cs === null ? end : Math.min(end, cb + cs);
          if (cid === ID.TagName) name = new TextDecoder().decode(bytes.subarray(cb, ce));
          else if (cid === ID.TagString) text = new TextDecoder().decode(bytes.subarray(cb, ce));
          q = ce;
        }
        if (name) out.tags[name] = text;
      } else if (MASTER.has(id)) {
        if (id === ID.Cluster) {
          const stop = walk(body, end, size === null);
          o = size === null ? stop : end;
          continue;
        }
        walk(body, end, false);
      } else if (id === ID.DocType) out.docType = new TextDecoder().decode(bytes.subarray(body, end));
      else if (id === ID.TimecodeScale) out.timecodeScale = readUint(body, end - body);
      else if (id === ID.Duration) out.duration = end - body === 8 ? dv.getFloat64(body) : dv.getFloat32(body);
      else if (id === ID.CodecID) out.codec = new TextDecoder().decode(bytes.subarray(body, end));
      else if (id === ID.PixelWidth) out.width = readUint(body, end - body);
      else if (id === ID.PixelHeight) out.height = readUint(body, end - body);
      else if (id === ID.DefaultDuration) out.defaultDuration = readUint(body, end - body);
      else if (id === ID.Timecode) clusterTime = readUint(body, end - body);
      else if (id === ID.SimpleBlock || id === ID.Block) {
        const [track, tl] = readSize(body);
        const rel = dv.getInt16(body + tl);
        const flags = bytes[body + tl + 2];
        const scale = out.timecodeScale / 1e6;
        out.blocks.push({ time: (clusterTime + rel) * scale, key: id === ID.SimpleBlock ? !!(flags & 0x80) : false, size: end - (body + tl + 3), track: track ?? 0, hash: fnv(bytes, body + tl + 3, end) });
      }
      o = end;
    }
    return o;
  };
  walk(0, bytes.length, false);
  if (out.duration !== null) out.duration *= out.timecodeScale / 1e6;
  return out;
}

/**
 * Kontrola hotového videa proti plánu: délka v hlavičce = počet snímků / fps (±1 snímek), počet bloků = počet snímků, časy bloků
 * rostou po 1000/fps ms. Vrací seznam rozporů (prázdný = video odpovídá plánu).
 */
export function checkWebm(info: WebmInfo, plan: { frames: number; fps: number; seconds: number }): string[] {
  const bad: string[] = [];
  const tol = 1000 / plan.fps;
  if (info.duration === null) bad.push("duration=null");
  else if (Math.abs(info.duration - plan.seconds * 1000) > tol + 1e-6) bad.push(`duration=${info.duration.toFixed(1)}ms≠${(plan.seconds * 1000).toFixed(1)}ms`);
  if (info.blocks.length !== plan.frames) bad.push(`blocks=${info.blocks.length}≠${plan.frames}`);
  info.blocks.forEach((b, i) => {
    if (Math.abs(b.time - (i * 1000) / plan.fps) > 1) bad.push(`block${i}.time=${b.time}`);
  });
  return bad.slice(0, 5);
}
