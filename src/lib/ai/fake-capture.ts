import "server-only";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { COMPANY } from "@/lib/company";
import type { BatchDocType, BatchFile, BatchPage, DocFlag } from "@/lib/jobs/capture-batch-types";
import {
  BATCH_TYPES, BATCH_TYPE_ENUM, DOC_FLAG_ENUM, batchTypeFor, isDocFlag, type RawClassification, type RawClassifiedDoc,
} from "@/lib/jobs/capture-batch";
import { normalizeExtracted } from "@/lib/jobs/extracted-normalize";
import type { ExtractedBusinessDoc } from "@/lib/jobs/capture-types";

/**
 * TESTOVACÍ HÁČEK dávkového focení (bez nové proměnné prostředí): je-li nastavená AI_FAKE_CAPTURE,
 * roztřídění i vytěžení jsou deterministické podle názvů souborů a fixtures ve složce
 * <dirname(AI_FAKE_CAPTURE)>/batch. Značky v názvu: „…__<typ>[+<flag>]*[-s<n>][-g<id>][-dup].<přípona>",
 * PDF s více doklady „…__sada-<jméno>.pdf" (batch/sada-<jméno>.json). Soubory bez značky = jeden
 * doklad podle AI_FAKE_CAPTURE (dnešní tok jednoho dokladu). V produkci proměnnou NENASTAVOVAT.
 */

const NAME_RE = /^[a-z0-9_-]{1,40}$/;

export function isFakeCapture(): boolean {
  return Boolean(process.env.AI_FAKE_CAPTURE);
}

export function fakeBatchDir(): string | null {
  const f = process.env.AI_FAKE_CAPTURE;
  return f ? path.join(path.dirname(path.resolve(f)), "batch") : null;
}

/** Bezpečná cesta souboru ve složce dávek (jinak null — značka neplatí). */
export function safeBatchFile(dir: string, name: string): string | null {
  if (!NAME_RE.test(name.replace(/\.json$/, ""))) return null;
  const full = path.resolve(dir, name.endsWith(".json") ? name : `${name}.json`);
  return full.startsWith(dir + path.sep) ? full : null;
}

export interface FakeTag {
  type: BatchDocType;
  flags: DocFlag[];
  /** Pořadí strany v dokladu (-s<n>), null = podle pořadí souborů. */
  page: number | null;
  /** Skupina dokladu („0" bez -g). */
  group: string;
  dup: boolean;
}

/** Značka v názvu souboru; null = soubor bez (platné) značky. */
export function parseFakeTag(filename: string): FakeTag | { sada: string } | null {
  const name = String(filename ?? "").trim();
  const sada = /__sada-([a-z0-9_-]{1,40})\.pdf$/i.exec(name);
  if (sada) return NAME_RE.test(sada[1].toLowerCase()) ? { sada: sada[1].toLowerCase() } : null;
  const m = /__([a-z0-9_]{1,40})((?:\+[a-z_]{1,20})*)(?:-s(\d{1,3}))?(?:-g([a-z0-9_]{1,40}))?(-dup)?\.[A-Za-z0-9_]{1,12}$/.exec(name);
  if (!m) return null;
  const type = m[1];
  if (!(BATCH_TYPE_ENUM as readonly string[]).includes(type)) return null;
  const flags = m[2] ? m[2].split("+").filter(Boolean) : [];
  if (flags.some((f) => !(DOC_FLAG_ENUM as readonly string[]).includes(f))) return null;
  return {
    type: type as BatchDocType,
    flags: flags.filter(isDocFlag),
    page: m[3] ? Number(m[3]) : null,
    group: m[4] ? `g${m[4]}` : "0",
    dup: Boolean(m[5]),
  };
}

function readJson(file: string | null): unknown {
  if (!file || !existsSync(file)) return null;
  try {
    return JSON.parse(readFileSync(file, "utf8"));
  } catch {
    return null;
  }
}

/** Fixture vytěžení: batch/<typ>-<skupina>.json → batch/<typ>.json → AI_FAKE_CAPTURE. group null = bez značky. */
export function fakeExtractRaw(type: BatchDocType, group: string | null): unknown {
  const dir = fakeBatchDir();
  const base = process.env.AI_FAKE_CAPTURE ? path.resolve(process.env.AI_FAKE_CAPTURE) : null;
  if (dir && group !== null) {
    if (group !== "0") {
      const hit = readJson(safeBatchFile(dir, `${type}-${group}`));
      if (hit) return hit;
    }
    const hit = readJson(safeBatchFile(dir, type));
    if (hit) return hit;
  }
  return readJson(base) ?? {};
}

/** Skupina fixture dokladu podle značek jeho souborů (null = bez značky → AI_FAKE_CAPTURE). */
export function fakeGroupFor(type: BatchDocType, filenames: string[]): string | null {
  for (const f of filenames) {
    const tag = parseFakeTag(f);
    if (tag && "type" in tag && tag.type === type) return tag.group;
    if (tag && "sada" in tag) return "0";
  }
  for (const f of filenames) {
    const tag = parseFakeTag(f);
    if (tag && "type" in tag) return tag.group;
  }
  return null;
}

/** Značka druhu a skupiny dokladu podle jeho souborů (jen testovací režim; null = bez značky). */
export function fakeTagFor(filenames: string[]): { type: BatchDocType; group: string } | null {
  if (!isFakeCapture()) return null;
  for (const f of filenames) {
    const tag = parseFakeTag(f);
    if (tag && "type" in tag) return { type: tag.type, group: tag.group };
  }
  return null;
}

function issuerIcos(type: BatchDocType, doc: ExtractedBusinessDoc): { issuerIco: string; recipientIco: string } {
  const meta = BATCH_TYPES[type];
  const ours = COMPANY.ico;
  if (meta.form !== "business") return { issuerIco: "", recipientIco: "" };
  if (meta.group === "my") return { issuerIco: ours, recipientIco: meta.side === "customer" ? doc.customer.ico : doc.supplier.ico };
  if (meta.side === "customer") return { issuerIco: doc.customer.ico, recipientIco: ours };
  return { issuerIco: doc.supplier.ico, recipientIco: ours };
}

function fakeDoc(type: BatchDocType, pages: number[], group: string | null, flags: DocFlag[]): RawClassifiedDoc {
  const meta = BATCH_TYPES[type];
  const doc = meta.form === "business" ? normalizeExtracted(fakeExtractRaw(type, group)) : null;
  const drawing = meta.form === "drawing" ? (fakeExtractRaw(type, group) as Record<string, unknown>) : null;
  const number = doc?.documentNumber || (typeof drawing?.drawingNumber === "string" ? drawing.drawingNumber : "");
  const party = doc ? (meta.side === "supplier" ? doc.supplier.name : doc.customer.name) : "";
  const icos = doc ? issuerIcos(type, doc) : { issuerIco: "", recipientIco: "" };
  return {
    pages,
    type,
    title: [meta.label, number].filter(Boolean).join(" "),
    documentNumber: number,
    partyName: party,
    issuerName: meta.group === "my" ? COMPANY.name : party,
    issuerIco: icos.issuerIco,
    recipientIco: icos.recipientIco,
    drawingNumbers: [
      ...(doc?.items.map((i) => i.drawingNumber).filter(Boolean) ?? []),
      ...(drawing && typeof drawing.drawingNumber === "string" ? [drawing.drawingNumber] : []),
      ...(drawing && Array.isArray(drawing.drawingNumbers) ? drawing.drawingNumbers.filter((x): x is string => typeof x === "string") : []),
    ].filter((x, i, a) => x && a.indexOf(x) === i),
    flags,
    confidence: 0.9,
    reason: "testovací roztřídění",
    continuesPrevious: false,
  };
}

/**
 * Falešné roztřídění (deterministické podle názvů souborů) ve tvaru odpovědi AI — projde stejnou
 * normalizací jako produkce. sentPageIds = stránky poslané „AI" v pořadí S1…Sn.
 */
export function fakeClassify(files: BatchFile[], pages: BatchPage[], sentPageIds: string[]): RawClassification {
  const fixture = normalizeExtracted(fakeExtractRaw("ostatni", null));
  const sIndex = new Map(sentPageIds.map((id, i) => [id, i + 1]));
  const tagged = new Map<string, { type: BatchDocType; group: string; flags: DocFlag[]; entries: { s: number; order: number; dup: boolean }[] }>();
  const untagged: number[] = [];
  const out: RawClassification = { documents: [], fileLinks: [], ignoredPages: [], duplicatePages: [], pageLabels: [], notes: [] };
  const dir = fakeBatchDir();
  let order = 0;
  for (const f of files) {
    const fp = pages.filter((p) => p.fileId === f.id && sIndex.has(p.id));
    if (!fp.length) continue;
    const tag = parseFakeTag(f.filename);
    if (tag && "sada" in tag) {
      const def = readJson(dir ? safeBatchFile(dir, `sada-${tag.sada}`) : null) as { documents?: { pages?: number[]; type?: string; flags?: string[] }[] } | null;
      const docs = Array.isArray(def?.documents) ? def!.documents : [];
      for (const d of docs) {
        if (!d || !(BATCH_TYPE_ENUM as readonly string[]).includes(d.type ?? "")) continue;
        const s = (d.pages ?? []).map((n) => fp.find((p) => p.page === n)).filter((p): p is BatchPage => Boolean(p)).map((p) => sIndex.get(p.id)!);
        if (s.length) out.documents.push(fakeDoc(d.type as BatchDocType, s, "0", (d.flags ?? []).filter(isDocFlag)));
      }
      continue;
    }
    if (!tag) {
      untagged.push(...fp.map((p) => sIndex.get(p.id)!));
      continue;
    }
    const key = `${tag.type}|${tag.group}`;
    let entry = tagged.get(key);
    if (!entry) {
      entry = { type: tag.type, group: tag.group, flags: [], entries: [] };
      tagged.set(key, entry);
    }
    for (const fl of tag.flags) if (!entry.flags.includes(fl)) entry.flags.push(fl);
    for (const p of fp) entry.entries.push({ s: sIndex.get(p.id)!, order: tag.page ?? 1000 + order++, dup: tag.dup });
  }
  for (const e of tagged.values()) {
    const sorted = [...e.entries].sort((a, b) => a.order - b.order || a.s - b.s);
    const pagesS: number[] = [];
    for (const x of sorted) {
      if (x.dup) {
        const same = sorted.find((y) => !y.dup && y.order === x.order);
        if (same) {
          out.duplicatePages.push({ page: x.s, sameAs: same.s });
          continue;
        }
      }
      pagesS.push(x.s);
    }
    out.documents.push(fakeDoc(e.type, pagesS, e.group, e.flags));
  }
  if (untagged.length) {
    const type = batchTypeFor(fixture.docKind, fixture.issuer);
    out.documents.push(fakeDoc(type, untagged, null, []));
  }
  out.documents.sort((a, b) => Math.min(...a.pages) - Math.min(...b.pages));
  return out;
}
