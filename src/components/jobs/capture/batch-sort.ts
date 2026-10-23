import { BATCH_TYPES, BATCH_TYPE_ORDER, pagesKey } from "@/lib/jobs/capture-batch";
import type {
  BatchDocDraft, BatchDocType, BatchFile, BatchPage, BatchSort,
} from "@/lib/jobs/capture-batch-types";

/**
 * Roztřídění dávky (čisté operace nad BatchSort, sdílí karta i testy).
 * Invarianty: každá stránka je právě v jednom dokladu nebo mezi vyřazenými,
 * doklad nemá prázdné stránky (prázdný doklad zmizí), stránka typu „file"
 * (CAD, ZIP položka, kancelářský soubor) je vždy sama ve svém dokladu.
 */

/** Klientské id nového dokladu („u-" + 8 znaků). */
export function newDocId(): string {
  const raw = typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID().replace(/-/g, "")
    : Math.random().toString(16).slice(2) + Date.now().toString(16);
  return `u-${raw.slice(0, 8)}`;
}

function blankDoc(id: string, type: BatchDocType, pageIds: string[]): BatchDocDraft {
  return {
    id, type, pageIds, aiType: null, confidence: null, reason: "", title: "", documentNumber: "", partyName: "",
    drawingNumbers: [], format: null, flags: [], issuerCheck: "unknown", excluded: false,
  };
}

/** Doklad, ve kterém stránka je (null = vyřazená / neznámá). */
export function docOfPage(sort: BatchSort, pageId: string): BatchDocDraft | null {
  return sort.docs.find((d) => d.pageIds.includes(pageId)) ?? null;
}

/** Doklady, které se uloží (bez vyřazených). */
export function activeDocs(sort: BatchSort): BatchDocDraft[] {
  return sort.docs.filter((d) => !d.excluded);
}

/** Stránka je samostatný soubor (CAD, kancelářský…) — nejde slučovat ani dělit. */
export function isFilePage(pages: BatchPage[], pageId: string): boolean {
  return pages.find((p) => p.id === pageId)?.source === "file";
}

/** Doklad tvoří samostatný soubor (CAD / jiný soubor bez náhledu). */
export function isFileDoc(doc: BatchDocDraft, pages: BatchPage[]): boolean {
  return doc.pageIds.some((id) => isFilePage(pages, id));
}

/** Stránka je z PDF, které nejde rozdělit (zaheslované / poškozené) — drží se pohromadě. */
export function isLockedPage(pages: BatchPage[], files: BatchFile[], pageId: string): boolean {
  const p = pages.find((x) => x.id === pageId);
  if (!p) return true;
  if (p.source === "file") return true;
  if (p.source !== "pdf_page") return false;
  const f = files.find((x) => x.id === p.fileId);
  return Boolean(f && !f.splittable && f.pageCount > 1);
}

/** Druhy, na které jde doklad přepnout (soubor bez náhledu jen výkres / model / jiné). */
export function allowedTypes(doc: Pick<BatchDocDraft, "pageIds">, pages: BatchPage[]): BatchDocType[] {
  if (doc.pageIds.some((id) => isFilePage(pages, id))) return ["model_3d", "vykres", "ostatni"];
  return BATCH_TYPE_ORDER.filter((t) => t !== "model_3d");
}

function withoutPage(sort: BatchSort, pageId: string): BatchSort {
  return {
    docs: sort.docs
      .map((d) => (d.pageIds.includes(pageId) ? { ...d, pageIds: d.pageIds.filter((p) => p !== pageId) } : d))
      .filter((d) => d.pageIds.length > 0),
    excludedPageIds: sort.excludedPageIds.filter((p) => p !== pageId),
  };
}

function mapDoc(sort: BatchSort, docId: string, fn: (d: BatchDocDraft) => BatchDocDraft): BatchSort {
  return { ...sort, docs: sort.docs.map((d) => (d.id === docId ? fn(d) : d)) };
}

/** Změnit druh dokladu (ruční oprava — vystavitel se už nepovažuje za ověřený z AI). */
export function setDocType(sort: BatchSort, docId: string, type: BatchDocType): BatchSort {
  return mapDoc(sort, docId, (d) => (d.type === type ? d : { ...d, type, issuerCheck: "unknown" }));
}

/** Prohodit vystavitele (naše nabídka ↔ nabídka dodavatele…); typ bez protějšku se nemění. */
export function swapIssuer(sort: BatchSort, docId: string): BatchSort {
  const doc = sort.docs.find((d) => d.id === docId);
  const to = doc ? BATCH_TYPES[doc.type].swap : null;
  return doc && to ? setDocType(sort, docId, to) : sort;
}

/** Přesunout stránku do jiného dokladu (index = pozice v cílovém dokladu, jinak na konec). */
export function movePage(sort: BatchSort, pageId: string, toDocId: string, index?: number): BatchSort {
  const from = docOfPage(sort, pageId);
  if (from?.id === toDocId && index === undefined) return sort;
  if (!sort.docs.some((d) => d.id === toDocId)) return sort;
  const rest = withoutPage(sort, pageId);
  if (!rest.docs.some((d) => d.id === toDocId)) {
    // cílový doklad měl jen tuto stránku — vrátit ji zpět na místo
    return sort;
  }
  return mapDoc(rest, toDocId, (d) => {
    const ids = [...d.pageIds];
    const at = index === undefined ? ids.length : Math.max(0, Math.min(index, ids.length));
    ids.splice(at, 0, pageId);
    return { ...d, pageIds: ids };
  });
}

/** Oddělit stránku jako nový doklad (zařadí se hned za původní doklad). */
export function splitPage(sort: BatchSort, pageId: string, type: BatchDocType, id: string = newDocId()): BatchSort {
  const from = docOfPage(sort, pageId);
  const fromIndex = from ? sort.docs.findIndex((d) => d.id === from.id) : sort.docs.length - 1;
  const rest = withoutPage(sort, pageId);
  const doc = blankDoc(id, type, [pageId]);
  // původní doklad mohl zmizet (měl jen tuto stránku) — vložit na jeho místo
  const anchorStill = from ? rest.docs.findIndex((d) => d.id === from.id) : -1;
  const at = anchorStill >= 0 ? anchorStill + 1 : Math.max(0, Math.min(fromIndex, rest.docs.length));
  const docs = [...rest.docs];
  docs.splice(at, 0, doc);
  return { ...rest, docs };
}

/** Sloučit doklad b do a (stránky b za stránky a, typ zůstává podle a). */
export function mergeDocs(sort: BatchSort, aId: string, bId: string): BatchSort {
  if (aId === bId) return sort;
  const a = sort.docs.find((d) => d.id === aId);
  const b = sort.docs.find((d) => d.id === bId);
  if (!a || !b) return sort;
  return {
    ...sort,
    docs: sort.docs
      .filter((d) => d.id !== bId)
      .map((d) => (d.id === aId ? { ...d, pageIds: [...d.pageIds, ...b.pageIds], excluded: d.excluded && b.excluded } : d)),
  };
}

/** Předchozí doklad (pro „Sloučit s předchozím"), null = první. */
export function previousDoc(sort: BatchSort, docId: string): BatchDocDraft | null {
  const i = sort.docs.findIndex((d) => d.id === docId);
  return i > 0 ? sort.docs[i - 1] : null;
}

export function excludeDoc(sort: BatchSort, docId: string): BatchSort {
  return mapDoc(sort, docId, (d) => ({ ...d, excluded: true }));
}

export function restoreDoc(sort: BatchSort, docId: string): BatchSort {
  return mapDoc(sort, docId, (d) => ({ ...d, excluded: false }));
}

/** Vyřadit jednu stránku (zůstane v relaci, nikam se neuloží). */
export function excludePage(sort: BatchSort, pageId: string): BatchSort {
  if (sort.excludedPageIds.includes(pageId)) return sort;
  const rest = withoutPage(sort, pageId);
  return { ...rest, excludedPageIds: [...rest.excludedPageIds, pageId] };
}

/**
 * Vrátit vyřazenou stránku: do zadaného dokladu, jinak za stránku, kterou opakuje
 * (přefocení), jinak jako nový doklad „Jiné".
 */
export function restorePage(sort: BatchSort, pageId: string, pages: BatchPage[], toDocId?: string, id: string = newDocId()): BatchSort {
  if (!sort.excludedPageIds.includes(pageId)) return sort;
  const base: BatchSort = { ...sort, excludedPageIds: sort.excludedPageIds.filter((p) => p !== pageId) };
  if (toDocId && base.docs.some((d) => d.id === toDocId)) {
    return mapDoc(base, toDocId, (d) => ({ ...d, pageIds: [...d.pageIds, pageId] }));
  }
  const original = pages.find((p) => p.id === pageId)?.duplicateOf ?? null;
  const host = original ? docOfPage(base, original) : null;
  if (host && !isFilePage(pages, pageId)) {
    return mapDoc(base, host.id, (d) => {
      const ids = [...d.pageIds];
      ids.splice(ids.indexOf(original!) + 1, 0, pageId);
      return { ...d, pageIds: ids };
    });
  }
  return { ...base, docs: [...base.docs, blankDoc(id, "ostatni", [pageId])] };
}

/** Posunout stránku v rámci dokladu (pořadí stran). */
export function movePageWithin(sort: BatchSort, pageId: string, delta: -1 | 1): BatchSort {
  const doc = docOfPage(sort, pageId);
  if (!doc) return sort;
  const i = doc.pageIds.indexOf(pageId);
  const j = i + delta;
  if (j < 0 || j >= doc.pageIds.length) return sort;
  return mapDoc(sort, doc.id, (d) => {
    const ids = [...d.pageIds];
    [ids[i], ids[j]] = [ids[j], ids[i]];
    return { ...d, pageIds: ids };
  });
}

/**
 * „Každá fotka zvlášť": každá stránka vlastní doklad (typ podle původního dokladu);
 * strany nedělitelného PDF zůstávají pohromadě. První stránka si nechá id dokladu.
 */
export function eachFileSeparately(sort: BatchSort, pages: BatchPage[], files: BatchFile[], makeId: () => string = newDocId): BatchSort {
  const docs: BatchDocDraft[] = [];
  for (const d of sort.docs) {
    if (d.excluded || d.pageIds.length < 2) {
      docs.push(d);
      continue;
    }
    const chunks: string[][] = [];
    for (const pid of d.pageIds) {
      const prev = chunks[chunks.length - 1];
      const p = pages.find((x) => x.id === pid);
      const prevPage = prev ? pages.find((x) => x.id === prev[prev.length - 1]) : undefined;
      const sameLockedFile = prev && p && prevPage && p.fileId === prevPage.fileId && isLockedPage(pages, files, pid);
      if (sameLockedFile) prev.push(pid);
      else chunks.push([pid]);
    }
    chunks.forEach((ids, n) => {
      docs.push(n === 0 ? { ...d, pageIds: ids } : { ...blankDoc(makeId(), d.type, ids) });
    });
  }
  return { ...sort, docs };
}

/**
 * „Sloučit vše do jednoho": všechny (nevyřazené) doklady z fotek a PDF do prvního;
 * soubory bez náhledu (CAD…) zůstávají samostatně. Typ = první obchodní doklad.
 */
export function mergeAll(sort: BatchSort, pages: BatchPage[]): BatchSort {
  const mergeable = sort.docs.filter((d) => !d.excluded && !isFileDoc(d, pages));
  if (mergeable.length < 2) return sort;
  const host = mergeable[0];
  const type = mergeable.find((d) => BATCH_TYPES[d.type].form === "business")?.type ?? host.type;
  const pageIds = mergeable.flatMap((d) => d.pageIds);
  const drop = new Set(mergeable.slice(1).map((d) => d.id));
  return {
    ...sort,
    docs: sort.docs
      .filter((d) => !drop.has(d.id))
      .map((d) => (d.id === host.id ? { ...d, type, pageIds, issuerCheck: d.type === type ? d.issuerCheck : "unknown" } : d)),
  };
}

/**
 * Doklady, které je potřeba přečíst znovu: nové, se změněnými stránkami,
 * nebo se změnou formuláře (obchodní ↔ výkres ↔ model/soubor) či strany
 * (zákaznická ↔ dodavatelská). Změna v rámci strany (potvrzení → faktura) ne.
 */
export function dirtyDocs(prev: BatchSort, next: BatchSort): string[] {
  const out: string[] = [];
  for (const d of next.docs) {
    if (d.excluded) continue;
    const old = prev.docs.find((x) => x.id === d.id);
    if (!old) {
      out.push(d.id);
      continue;
    }
    if (pagesKey(old.pageIds) !== pagesKey(d.pageIds)) {
      out.push(d.id);
      continue;
    }
    const a = BATCH_TYPES[old.type];
    const b = BATCH_TYPES[d.type];
    if (a.form !== b.form || a.side !== b.side) out.push(d.id);
  }
  return out;
}

/** Doklad potřebuje vytěžení na serveru (obchodní / výkres jen s AI, model vždy — formát a číslo). */
export function needsExtract(type: BatchDocType, aiUsed: boolean): boolean {
  const form = BATCH_TYPES[type].form;
  if (form === "model") return true;
  if (form === "file") return false;
  return aiUsed;
}

/** Shoda dvou roztřídění (stejné doklady, stránky, druhy i vyřazení). */
export function sameSort(a: BatchSort, b: BatchSort): boolean {
  if (a.docs.length !== b.docs.length || pagesKey(a.excludedPageIds) !== pagesKey(b.excludedPageIds)) return false;
  return a.docs.every((d, i) => {
    const o = b.docs[i];
    return o.id === d.id && o.type === d.type && o.excluded === d.excluded && pagesKey(o.pageIds) === pagesKey(d.pageIds);
  });
}
