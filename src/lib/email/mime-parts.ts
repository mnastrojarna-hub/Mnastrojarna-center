/**
 * Minimální MIME rozklad zprávy (bez závislostí) — hlavičky, části s číslováním jako IMAP
 * BODYSTRUCTURE (1, 2, 2.1 …), přílohy a jejich obsah. Používá ingest (seznam příloh) a stažení /
 * přeposlání přílohy (obsah části podle čísla). Testy v mime-parts.test.ts.
 */

export interface MimeHeaders {
  [key: string]: string;
}

export interface MimeLeaf {
  /** Číslo části jako v IMAP (BODY[2.1]). */
  partId: string;
  contentType: string;
  params: Record<string, string>;
  disposition: string | null;
  dispositionParams: Record<string, string>;
  encoding: string;
  filename: string | null;
  /** Zakódovaný obsah (bez hlaviček části). */
  rawBody: Buffer;
  /** Část nemusí být celá (zpráva zkrácená při stahování). */
  truncated: boolean;
}

export interface AttachmentMeta {
  partId: string;
  filename: string;
  contentType: string;
  /** Velikost po dekódování (odhad u base64); null = neznámá (zkrácená zpráva). */
  size: number | null;
}

// ── Hlavičky ────────────────────────────────────────────────
function splitHeaderBody(raw: Buffer): { head: string; body: Buffer } {
  const s = raw.toString("latin1");
  const a = s.indexOf("\r\n\r\n");
  const b = s.indexOf("\n\n");
  let idx = -1;
  let len = 0;
  if (a >= 0 && (b < 0 || a <= b)) { idx = a; len = 4; } else if (b >= 0) { idx = b; len = 2; }
  if (idx < 0) return { head: s, body: Buffer.alloc(0) };
  return { head: s.slice(0, idx), body: raw.subarray(idx + len) };
}

export function parseHeaderBlock(head: string): MimeHeaders {
  const out: MimeHeaders = {};
  const unfolded = head.replace(/\r?\n[ \t]+/g, " ");
  for (const line of unfolded.split(/\r?\n/)) {
    const i = line.indexOf(":");
    if (i <= 0) continue;
    const key = line.slice(0, i).trim().toLowerCase();
    if (!(key in out)) out[key] = line.slice(i + 1).trim();
  }
  return out;
}

/** Hlavičky zprávy (první výskyt, rozbalené, klíče malými písmeny). */
export function readHeaders(raw: Buffer): MimeHeaders {
  return parseHeaderBlock(splitHeaderBody(raw).head);
}

/** „text/plain; charset=utf-8; name="a b.pdf"" → hodnota + parametry (RFC 2231 i encoded-words). */
export function parseHeaderValue(v: string | undefined): { value: string; params: Record<string, string> } {
  const s = v ?? "";
  const parts: string[] = [];
  let cur = "";
  let q = false;
  for (const ch of s) {
    if (ch === '"') q = !q;
    if (ch === ";" && !q) { parts.push(cur); cur = ""; continue; }
    cur += ch;
  }
  parts.push(cur);
  const value = (parts.shift() ?? "").trim().toLowerCase();
  const params: Record<string, string> = {};
  const continued: Record<string, string[]> = {};
  for (const p of parts) {
    const i = p.indexOf("=");
    if (i <= 0) continue;
    const key = p.slice(0, i).trim().toLowerCase();
    let val = p.slice(i + 1).trim();
    if (val.startsWith('"') && val.endsWith('"')) val = val.slice(1, -1).replace(/\\(.)/g, "$1");
    const m = /^([^*]+)\*(\d+)?(\*)?$/.exec(key);
    if (m) {
      const name = m[1];
      const encoded = Boolean(m[3]) || (!m[2] && key.endsWith("*"));
      const decoded = encoded ? decode2231(val) : val;
      (continued[name] ??= [])[Number(m[2] ?? 0)] = decoded;
    } else params[key] = decodeWords(val);
  }
  for (const [k, list] of Object.entries(continued)) params[k] = list.filter((x) => x !== undefined).join("");
  return { value, params };
}

function decode2231(v: string): string {
  const m = /^([^']*)'[^']*'(.*)$/.exec(v);
  const charset = (m?.[1] || "utf-8").toLowerCase();
  const data = m ? m[2] : v;
  const bytes = Buffer.from(data.replace(/%([0-9a-f]{2})/gi, (_, h) => String.fromCharCode(parseInt(h, 16))), "latin1");
  return charset.includes("8859") || charset.includes("1252") ? bytes.toString("latin1") : bytes.toString("utf8");
}

function decodeCharset(buf: Buffer, charset: string): string {
  const c = charset.toLowerCase();
  if (c.includes("utf")) return buf.toString("utf8");
  if (c.includes("8859-1") || c.includes("1252") || c.includes("ascii")) return buf.toString("latin1");
  try {
    return new TextDecoder(c).decode(buf);
  } catch {
    return buf.toString("utf8");
  }
}

/** =?UTF-8?B?…?= / =?iso-8859-2?Q?…?= → text. */
export function decodeWords(s: string): string {
  return s
    .replace(/\?=\s+=\?/g, "?==?")
    .replace(/=\?([^?]+)\?([bqBQ])\?([^?]*)\?=/g, (_, charset: string, enc: string, data: string) => {
      try {
        const buf = enc.toUpperCase() === "B"
          ? Buffer.from(data, "base64")
          : Buffer.from(data.replace(/_/g, " ").replace(/=([0-9a-f]{2})/gi, (_m, h) => String.fromCharCode(parseInt(h, 16))), "latin1");
        return decodeCharset(buf, charset);
      } catch {
        return data;
      }
    });
}

// ── Části ───────────────────────────────────────────────────
function splitMultipart(body: Buffer, boundary: string): { parts: Buffer[]; closed: boolean } {
  const s = body.toString("latin1");
  const marker = `--${boundary}`;
  const parts: Buffer[] = [];
  let pos = s.indexOf(marker);
  let closed = false;
  while (pos >= 0) {
    const after = pos + marker.length;
    if (s.startsWith("--", after)) { closed = true; break; }
    const lineEnd = s.indexOf("\n", after);
    if (lineEnd < 0) break;
    const next = s.indexOf(`\n${marker}`, lineEnd);
    const end = next < 0 ? s.length : (s[next - 1] === "\r" ? next - 1 : next);
    parts.push(Buffer.from(s.slice(lineEnd + 1, end), "latin1"));
    if (next < 0) break;
    pos = next + 1;
  }
  return { parts, closed };
}

function walk(raw: Buffer, prefix: string, out: MimeLeaf[], truncated: boolean, depth = 0): void {
  const { head, body } = splitHeaderBody(raw);
  const h = parseHeaderBlock(head);
  const ct = parseHeaderValue(h["content-type"] || "text/plain");
  if (ct.value.startsWith("multipart/") && ct.params.boundary && depth < 8) {
    const { parts, closed } = splitMultipart(body, ct.params.boundary);
    parts.forEach((p, i) => walk(p, prefix ? `${prefix}.${i + 1}` : String(i + 1), out, truncated || (!closed && i === parts.length - 1), depth + 1));
    return;
  }
  const disp = h["content-disposition"] ? parseHeaderValue(h["content-disposition"]) : null;
  const filename = disp?.params.filename || ct.params.name || null;
  out.push({
    partId: prefix || "1",
    contentType: ct.value || "application/octet-stream",
    params: ct.params,
    disposition: disp?.value ?? null,
    dispositionParams: disp?.params ?? {},
    encoding: (h["content-transfer-encoding"] || "7bit").trim().toLowerCase(),
    filename: filename ? decodeWords(filename) : null,
    rawBody: body,
    truncated,
  });
}

/** Listové části zprávy (s číslováním IMAP). `truncated` = zpráva byla při stažení zkrácená. */
export function mimeLeaves(raw: Buffer, truncated = false): MimeLeaf[] {
  const out: MimeLeaf[] = [];
  walk(raw, "", out, truncated);
  return out;
}

export function isAttachmentLeaf(p: MimeLeaf): boolean {
  if (p.disposition === "attachment") return true;
  if (p.filename) return true;
  return !p.contentType.startsWith("text/") && !p.contentType.startsWith("multipart/") && p.contentType !== "message/delivery-status";
}

/** Dekódovaný obsah části (base64 / quoted-printable / 7bit). */
export function decodePart(p: MimeLeaf): Buffer {
  if (p.encoding === "base64") return Buffer.from(p.rawBody.toString("latin1").replace(/[^A-Za-z0-9+/=]/g, ""), "base64");
  if (p.encoding === "quoted-printable") {
    const s = p.rawBody.toString("latin1").replace(/=\r?\n/g, "").replace(/=([0-9A-Fa-f]{2})/g, (_, h) => String.fromCharCode(parseInt(h, 16)));
    return Buffer.from(s, "latin1");
  }
  return p.rawBody;
}

function sizeOf(p: MimeLeaf): number | null {
  if (p.truncated) return null;
  if (p.encoding === "base64") {
    const len = p.rawBody.toString("latin1").replace(/[^A-Za-z0-9+/=]/g, "").length;
    return Math.max(0, Math.floor((len * 3) / 4) - (p.rawBody.toString("latin1").trimEnd().endsWith("==") ? 2 : p.rawBody.toString("latin1").trimEnd().endsWith("=") ? 1 : 0));
  }
  return decodePart(p).length;
}

/** Přílohy zprávy (bez obsahu). */
export function listAttachments(raw: Buffer, truncated = false): AttachmentMeta[] {
  return mimeLeaves(raw, truncated)
    .filter(isAttachmentLeaf)
    .map((p) => ({
      partId: p.partId,
      filename: (p.filename || `priloha-${p.partId}.${p.contentType.split("/")[1]?.replace(/[^a-z0-9]/gi, "") || "bin"}`).slice(0, 255),
      contentType: p.contentType,
      size: sizeOf(p),
    }));
}

/** Obsah přílohy podle čísla části (null = nenalezena). */
export function extractPart(raw: Buffer, partId: string): { filename: string | null; contentType: string; content: Buffer } | null {
  const p = mimeLeaves(raw).find((x) => x.partId === partId);
  return p ? { filename: p.filename, contentType: p.contentType, content: decodePart(p) } : null;
}

/** imapflow BODYSTRUCTURE → přílohy (když ho server pošle — přesné i u zkrácené zprávy). */
export interface BodyStructureNode {
  part?: string;
  type?: string;
  parameters?: Record<string, string>;
  disposition?: string;
  dispositionParameters?: Record<string, string>;
  size?: number;
  encoding?: string;
  childNodes?: BodyStructureNode[];
}

export function attachmentsFromStructure(node: BodyStructureNode | undefined | null): AttachmentMeta[] {
  const out: AttachmentMeta[] = [];
  const visit = (n: BodyStructureNode) => {
    if (n.childNodes?.length) return n.childNodes.forEach(visit);
    const type = (n.type || "application/octet-stream").toLowerCase();
    const filename = n.dispositionParameters?.filename || n.parameters?.name || null;
    const att = n.disposition?.toLowerCase() === "attachment" || Boolean(filename) || (!type.startsWith("text/") && !type.startsWith("multipart/"));
    if (!att) return;
    const enc = (n.encoding || "").toLowerCase();
    const size = typeof n.size === "number" ? (enc === "base64" ? Math.floor((n.size * 3) / 4) : n.size) : null;
    const part = n.part || "1";
    out.push({ partId: part, filename: (filename ? decodeWords(filename) : `priloha-${part}`).slice(0, 255), contentType: type, size });
  };
  if (node) visit(node);
  return out;
}
