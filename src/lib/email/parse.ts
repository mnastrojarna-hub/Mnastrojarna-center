import "server-only";
import type { RawEmail } from "./ingest";

/**
 * Parsování e-mailových souborů exportovaných z Outlooku.
 *  - `.eml`  → standardní MIME (RFC 822)
 *  - `.msg`  → binární Outlook formát (CFBF / OLE Compound File)
 *
 * Vrací `RawEmail`, který jde rovnou poslat do AI ingest pipeline.
 * Bez závislostí — vše čistě v Node.
 */

export interface ParsedFile {
  ok: boolean;
  email?: RawEmail;
  error?: string;
}

export function parseEmailFile(fileName: string, buf: Buffer): ParsedFile {
  try {
    const lower = fileName.toLowerCase();
    if (lower.endsWith(".msg")) return { ok: true, email: parseMsg(buf, fileName) };
    if (lower.endsWith(".eml") || lower.endsWith(".mime") || lower.endsWith(".txt")) {
      return { ok: true, email: parseEml(buf, fileName) };
    }
    // Detekce podle obsahu: CFBF magic → .msg
    if (buf.length > 8 && buf.readUInt32BE(0) === 0xd0cf11e0) {
      return { ok: true, email: parseMsg(buf, fileName) };
    }
    return { ok: true, email: parseEml(buf, fileName) };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Nepodařilo se přečíst soubor." };
  }
}

// ════════════════════════════════════════════════════════════
//  EML (MIME)
// ════════════════════════════════════════════════════════════
function parseEml(buf: Buffer, fileName: string): RawEmail {
  const raw = buf.toString("latin1");
  const sepIdx = findHeaderBodySplit(raw);
  const headerBlock = sepIdx >= 0 ? raw.slice(0, sepIdx) : raw;
  const bodyBlock = sepIdx >= 0 ? raw.slice(sepIdx).replace(/^\r?\n\r?\n/, "") : "";

  const headers = parseHeaders(headerBlock);
  const from = headers["from"] || "";
  const { name, email } = parseAddress(from);

  const body = extractBody(headers, bodyBlock);
  const dateStr = headers["date"];
  const received = dateStr ? new Date(dateStr) : new Date();

  return {
    messageId: (headers["message-id"] || `eml-${fileName}-${buf.length}`).replace(/[<>]/g, ""),
    fromName: decodeMime(name) || decodeMime(email) || "",
    fromEmail: email,
    subject: decodeMime(headers["subject"] || fileName.replace(/\.[^.]+$/, "")),
    body: body.slice(0, 12000),
    receivedAt: isNaN(received.getTime()) ? new Date().toISOString() : received.toISOString(),
  };
}

function findHeaderBodySplit(raw: string): number {
  const a = raw.indexOf("\r\n\r\n");
  const b = raw.indexOf("\n\n");
  if (a >= 0 && (b < 0 || a <= b)) return a;
  return b;
}

function parseHeaders(block: string): Record<string, string> {
  const unfolded = block.replace(/\r?\n[ \t]+/g, " "); // rozbalení skládaných řádků
  const out: Record<string, string> = {};
  for (const line of unfolded.split(/\r?\n/)) {
    const idx = line.indexOf(":");
    if (idx <= 0) continue;
    const key = line.slice(0, idx).trim().toLowerCase();
    const val = line.slice(idx + 1).trim();
    out[key] = out[key] ? `${out[key]}, ${val}` : val;
  }
  return out;
}

function parseAddress(value: string): { name: string; email: string } {
  const m = value.match(/^\s*"?([^"<]*)"?\s*<([^>]+)>/);
  if (m) return { name: m[1].trim(), email: m[2].trim() };
  const justEmail = value.match(/[^\s<>]+@[^\s<>]+/);
  return { name: "", email: justEmail ? justEmail[0] : value.trim() };
}

function extractBody(headers: Record<string, string>, body: string): string {
  const ctype = headers["content-type"] || "";
  const boundaryMatch = ctype.match(/boundary="?([^";]+)"?/i);

  if (boundaryMatch) {
    const boundary = boundaryMatch[1];
    const parts = body.split(new RegExp(`--${escapeRe(boundary)}(?:--)?`));
    let htmlFallback = "";
    for (const part of parts) {
      const splitIdx = findHeaderBodySplit(part);
      if (splitIdx < 0) continue;
      const partHeaders = parseHeaders(part.slice(0, splitIdx));
      const partBody = part.slice(splitIdx).replace(/^\r?\n\r?\n/, "");
      const pType = (partHeaders["content-type"] || "").toLowerCase();
      const decoded = decodeTransfer(partHeaders["content-transfer-encoding"], partBody, pType);
      if (pType.includes("text/plain")) return decoded.trim();
      if (pType.includes("text/html") && !htmlFallback) htmlFallback = stripHtml(decoded);
      if (pType.includes("multipart")) {
        const nested = extractBody(partHeaders, partBody);
        if (nested) return nested;
      }
    }
    if (htmlFallback) return htmlFallback.trim();
    return "";
  }

  const decoded = decodeTransfer(headers["content-transfer-encoding"], body, ctype.toLowerCase());
  return ctype.toLowerCase().includes("text/html") ? stripHtml(decoded).trim() : decoded.trim();
}

function decodeTransfer(encoding: string | undefined, data: string, ctype: string): string {
  const enc = (encoding || "").toLowerCase();
  const charset = ctype.match(/charset="?([^";]+)"?/i)?.[1]?.toLowerCase();
  let bytes: Buffer;
  if (enc.includes("base64")) {
    bytes = Buffer.from(data.replace(/\s+/g, ""), "base64");
  } else if (enc.includes("quoted-printable")) {
    bytes = decodeQuotedPrintable(data);
  } else {
    bytes = Buffer.from(data, "latin1");
  }
  if (charset && (charset.includes("utf-8") || charset.includes("utf8"))) return bytes.toString("utf8");
  if (charset && charset.includes("iso-8859-2")) return decodeLatin2(bytes);
  if (charset && (charset.includes("windows-1250") || charset.includes("cp1250"))) return decodeCp1250(bytes);
  return bytes.toString("utf8");
}

function decodeQuotedPrintable(input: string): Buffer {
  const cleaned = input.replace(/=\r?\n/g, "");
  const out: number[] = [];
  for (let i = 0; i < cleaned.length; i++) {
    const c = cleaned[i];
    if (c === "=" && i + 2 < cleaned.length) {
      const hex = cleaned.slice(i + 1, i + 3);
      if (/^[0-9A-Fa-f]{2}$/.test(hex)) {
        out.push(parseInt(hex, 16));
        i += 2;
        continue;
      }
    }
    out.push(cleaned.charCodeAt(i) & 0xff);
  }
  return Buffer.from(out);
}

/** Dekódování =?charset?B?…?= / =?charset?Q?…?= v hlavičkách. */
function decodeMime(value: string): string {
  if (!value) return value;
  return value.replace(/=\?([^?]+)\?([BbQq])\?([^?]*)\?=/g, (_m, charset, enc, text) => {
    try {
      const bytes =
        enc.toUpperCase() === "B"
          ? Buffer.from(text, "base64")
          : decodeQuotedPrintable(String(text).replace(/_/g, " "));
      const cs = String(charset).toLowerCase();
      if (cs.includes("utf-8")) return bytes.toString("utf8");
      if (cs.includes("iso-8859-2")) return decodeLatin2(bytes);
      if (cs.includes("1250")) return decodeCp1250(bytes);
      return bytes.toString("utf8");
    } catch {
      return text;
    }
  });
}

function stripHtml(html: string): string {
  return html
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<\/(p|div|tr|li|h[1-6])>/gi, "\n")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/\n{3,}/g, "\n\n");
}

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// ════════════════════════════════════════════════════════════
//  MSG (CFBF / OLE Compound File)
// ════════════════════════════════════════════════════════════
function parseMsg(buf: Buffer, fileName: string): RawEmail {
  const streams = readCfbf(buf);

  const subject = readMsgString(streams, "0037");
  const bodyPlain = readMsgString(streams, "1000");
  const bodyHtml = readMsgString(streams, "1013");
  const senderName = readMsgString(streams, "0C1A") || readMsgString(streams, "0042");
  const senderEmail =
    readMsgSmtp(streams) ||
    readMsgString(streams, "0C1F") ||
    readMsgString(streams, "0065");

  const body = bodyPlain || (bodyHtml ? stripHtml(bodyHtml) : "");

  return {
    messageId: `msg-${fileName}-${buf.length}`,
    fromName: senderName || senderEmail || "",
    fromEmail: senderEmail || "",
    subject: subject || fileName.replace(/\.[^.]+$/, ""),
    body: body.slice(0, 12000),
    receivedAt: new Date().toISOString(),
  };
}

/** Najde property stream podle 4místného hex tagu, zkusí unicode (001F) i ascii (001E). */
function readMsgString(streams: Map<string, Buffer>, tag: string): string {
  const uni = streams.get(`__substg1.0_${tag}001F`.toLowerCase());
  if (uni) return uni.toString("utf16le").replace(/\0+$/, "");
  const ascii = streams.get(`__substg1.0_${tag}001E`.toLowerCase());
  if (ascii) return ascii.toString("latin1").replace(/\0+$/, "");
  return "";
}

function readMsgSmtp(streams: Map<string, Buffer>): string {
  // PR_SENDER_SMTP_ADDRESS / PR_SENT_REPRESENTING_SMTP / PR_SMTP_ADDRESS
  for (const tag of ["5D01", "5D02", "39FE"]) {
    const v = readMsgString(streams, tag);
    if (v && v.includes("@")) return v;
  }
  return "";
}

/** Minimální čtečka Compound File Binary Format — vrací mapu název→obsah streamu. */
function readCfbf(buf: Buffer): Map<string, Buffer> {
  const result = new Map<string, Buffer>();
  if (buf.length < 512 || buf.readUInt32BE(0) !== 0xd0cf11e0) return result;

  const sectorShift = buf.readUInt16LE(30);
  const miniSectorShift = buf.readUInt16LE(32);
  const sectorSize = 1 << sectorShift;
  const miniSectorSize = 1 << miniSectorShift;
  const miniCutoff = buf.readUInt32LE(56);
  const numFatSectors = buf.readUInt32LE(44);
  const firstDirSector = buf.readUInt32LE(48);
  const firstMiniFatSector = buf.readUInt32LE(60);
  const numMiniFatSectors = buf.readUInt32LE(64);
  const firstDifatSector = buf.readUInt32LE(68);
  const numDifatSectors = buf.readUInt32LE(72);

  const ENDOFCHAIN = 0xfffffffe;
  const FREESECT = 0xffffffff;

  const sectorOffset = (sid: number) => (sid + 1) * sectorSize;

  // 1) DIFAT → seznam FAT sektorů
  const fatSectors: number[] = [];
  for (let i = 0; i < 109 && fatSectors.length < numFatSectors; i++) {
    const sid = buf.readUInt32LE(76 + i * 4);
    if (sid !== FREESECT && sid !== ENDOFCHAIN) fatSectors.push(sid);
  }
  let difatSid = firstDifatSector;
  let guard = 0;
  while (difatSid !== ENDOFCHAIN && difatSid !== FREESECT && guard++ < numDifatSectors + 2) {
    const base = sectorOffset(difatSid);
    const entriesPerSector = sectorSize / 4 - 1;
    for (let i = 0; i < entriesPerSector; i++) {
      const sid = buf.readUInt32LE(base + i * 4);
      if (sid !== FREESECT && sid !== ENDOFCHAIN) fatSectors.push(sid);
    }
    difatSid = buf.readUInt32LE(base + entriesPerSector * 4);
  }

  // 2) Sestavení FAT
  const fat: number[] = [];
  for (const fs of fatSectors) {
    const base = sectorOffset(fs);
    if (base + sectorSize > buf.length) break;
    for (let i = 0; i < sectorSize / 4; i++) fat.push(buf.readUInt32LE(base + i * 4));
  }

  const readChain = (start: number, source: Buffer, ssize: number, sOff: (n: number) => number, table: number[]): Buffer => {
    const chunks: Buffer[] = [];
    let sid = start;
    let g = 0;
    while (sid !== ENDOFCHAIN && sid !== FREESECT && sid >= 0 && g++ < table.length + 2) {
      const off = sOff(sid);
      if (off + ssize > source.length) break;
      chunks.push(source.subarray(off, off + ssize));
      sid = table[sid] ?? ENDOFCHAIN;
    }
    return Buffer.concat(chunks);
  };

  // 3) Adresář
  const dirBuf = readChain(firstDirSector, buf, sectorSize, sectorOffset, fat);
  const numEntries = Math.floor(dirBuf.length / 128);
  type DirEntry = { name: string; type: number; start: number; size: number };
  const entries: DirEntry[] = [];
  for (let i = 0; i < numEntries; i++) {
    const o = i * 128;
    const nameLen = dirBuf.readUInt16LE(o + 64);
    if (nameLen < 2) {
      entries.push({ name: "", type: 0, start: 0, size: 0 });
      continue;
    }
    const name = dirBuf.toString("utf16le", o, o + nameLen - 2);
    const type = dirBuf.readUInt8(o + 66);
    const start = dirBuf.readUInt32LE(o + 116);
    const size = dirBuf.readUInt32LE(o + 120);
    entries.push({ name, type, start, size });
  }

  // 4) Mini stream (z root entry, type 5) + mini FAT
  const root = entries.find((e) => e.type === 5);
  let miniStream: Buffer = Buffer.alloc(0);
  const miniFat: number[] = [];
  if (root) {
    miniStream = readChain(root.start, buf, sectorSize, sectorOffset, fat);
    if (numMiniFatSectors > 0) {
      const miniFatBuf = readChain(firstMiniFatSector, buf, sectorSize, sectorOffset, fat);
      for (let i = 0; i < miniFatBuf.length / 4; i++) miniFat.push(miniFatBuf.readUInt32LE(i * 4));
    }
  }
  const miniOffset = (sid: number) => sid * miniSectorSize;

  // 5) Načtení streamů
  for (const e of entries) {
    if (e.type !== 2 || !e.name) continue; // pouze streamy
    let data: Buffer;
    if (e.size >= miniCutoff) {
      data = readChain(e.start, buf, sectorSize, sectorOffset, fat).subarray(0, e.size);
    } else {
      data = readChain(e.start, miniStream, miniSectorSize, miniOffset, miniFat).subarray(0, e.size);
    }
    result.set(e.name.toLowerCase(), data);
  }
  return result;
}

// ── České kódové stránky (fallback) ─────────────────────────
const CP1250_HIGH =
  "€\x81‚\x83„…†‡\x88‰Š‹ŚŤŽŹ\x90‘’“”•–—\x98™š›śťžź\xa0ˇ˘Ł¤Ą¦§¨©Ş«¬\xad®Ż°±˛ł´µ¶·¸ąş»Ľ˝ľżŔÁÂĂÄĹĆÇČÉĘËĚÍÎĎĐŃŇÓÔŐÖ×ŘŮÚŰÜÝŢßŕáâăäĺćçčéęëěíîďđńňóôőö÷řůúűüýţ˙";
function decodeCp1250(bytes: Buffer): string {
  let out = "";
  for (const b of bytes) out += b < 0x80 ? String.fromCharCode(b) : CP1250_HIGH[b - 0x80] || "?";
  return out;
}
function decodeLatin2(bytes: Buffer): string {
  // ISO-8859-2 — pro naše účely stačí přiblížení přes CP1250 mimo řídicí znaky
  return decodeCp1250(bytes);
}
