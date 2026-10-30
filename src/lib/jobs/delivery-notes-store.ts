import "server-only";
import type { JobsDb } from "@/lib/jobs/events";
import { logJobEvent } from "@/lib/jobs/events";
import { registerJobFileCore } from "@/lib/jobs/job-files-store";
import { jobFilePath, translateDbError } from "@/lib/jobs/mapping";
import type { JobDetail } from "@/lib/jobs/types";
import { issuedEventMessage } from "@/lib/jobs/document-emails";
import { buildDeliveryDoc, dateOnly, pdfFileName } from "@/lib/pdf/job-docs";
import { renderDeliveryNotePdf } from "@/lib/pdf/render";
import { todayIso } from "@/lib/pdf/types";
import { czPlural } from "@/lib/jobs/flow-status";
import { documentedQuantities } from "@/lib/jobs/delivery-notes-db";
import {
  CATCH_UP_LABEL, deliveryCompletes, deliveryLabel, deliveryLines, deliveryNoteTitle, hadUndocumentedBefore, remainingQty, round3,
  type DeliveryLine, type DeliveryRowInput,
} from "@/lib/jobs/delivery-notes";

/**
 * Dodací listy dodávek — servisní klíč (oprávnění hlídá volající akce). Bez migrace: řádek
 * delivery_notes (číslo, zakázka, zákazník, dodací adresa, poznámka, PDF) + delivery_note_items
 * (popis, množství, jednotka). storage_path: „zakazky/…" = vystavený DL; „pending:<ms>" = DL se
 * právě vystavuje (zabrané jedním požadavkem); null = vystavení selhalo — „Vystavit dodací list
 * znovu" (retryId) ho zabere a použije stejné číslo. Nikdo jiný rozpracovaný řádek nepřevezme.
 */

const BUCKET = "job-files";

export interface DeliveryNoteRow {
  id: string;
  number: string;
  order_id: string | null;
  customer_id: string | null;
  issue_date: string;
  delivery_address: string | null;
  note: string | null;
  storage_path: string | null;
  created_at: string;
}

const NOTE_COLS = "id, number, order_id, customer_id, issue_date, delivery_address, note, storage_path, created_at";

/** Zabraný řádek — PDF se právě vystavuje (zámek po dobu jednoho požadavku). */
const PENDING = "pending:";
/** Po této době se zabraný řádek (spadlý požadavek) smí zabrat znovu. */
const PENDING_STALE_MS = 2 * 60_000;
const pendingMark = () => `${PENDING}${String(Date.now()).padStart(13, "0")}`;

/** storage_path vystaveného DL (ne rezervace, ne rozpracovaný). */
export function isIssuedPath(p: string | null | undefined): boolean {
  return typeof p === "string" && p.startsWith("zakazky/");
}

/** Vystavené dodací listy zakázky (s PDF) — nejstarší první. */
export async function issuedDeliveryNotes(db: JobsDb, jobId: string): Promise<DeliveryNoteRow[]> {
  const { data, error } = await db.from("delivery_notes").select(NOTE_COLS)
    .eq("order_id", jobId).like("storage_path", "zakazky/%").order("created_at", { ascending: true });
  if (error) throw new Error(error.message);
  return (data ?? []) as DeliveryNoteRow[];
}

/** Řádky dodacího listu (popis, množství, jednotka) v pořadí. */
export async function deliveryNoteLines(db: JobsDb, noteId: string): Promise<{ description: string; quantity: number; unit: string }[]> {
  const { data } = await db.from("delivery_note_items").select("description, quantity, unit, position")
    .eq("delivery_note_id", noteId).order("position", { ascending: true });
  return ((data ?? []) as { description: string; quantity: number | string; unit: string }[])
    .map((r) => ({ description: r.description, quantity: Number(r.quantity), unit: r.unit }));
}

/** Soubor dokumentu zakázky k PDF dodacího listu (aktuální verze s touto cestou). */
export async function fileOfNote(db: JobsDb, jobId: string, storagePath: string | null) {
  if (!storagePath) return null;
  const { data } = await db.from("job_files").select("id, filename, version, archived, title")
    .eq("job_id", jobId).eq("storage_path", storagePath).maybeSingle();
  return (data as { id: string; filename: string; version: number | null; archived: boolean; title: string | null } | null) ?? null;
}

/** Další číslo z řady DL (DL-RRRR-NNN). */
async function nextDlNumber(db: JobsDb): Promise<string | null> {
  const { data, error } = await db.rpc("next_doc_number", { p_prefix: "DL" } as never);
  if (error) console.error(`[delivery-notes] Číslo dodacího listu se nepodařilo přidělit: ${error.message}`);
  return typeof data === "string" && data ? data : null;
}

/** Chyba, kterou nejde opakovat se stejným číslem (DL už je vystavený / jiný požadavek ho právě vystavuje). */
export class DeliveryNoteBlocked extends Error {}

/**
 * Řádek dodacího listu pro tuto dodávku, zabraný jen pro tento požadavek (storage_path = pending):
 *  - retryId = „Vystavit dodací list znovu" po chybě: zabere řádek jedním podmíněným UPDATE (jen
 *    když nemá PDF, nebo jeho zámek zestárl) — vystavený DL ani rozpracovaný jiným požadavkem nepřevezme;
 *  - jinak číslo, jehož vystavení dřív selhalo a nikdo ho neopakoval (řada bez mezer), jinak NOVÝ řádek:
 *    první dodávka převezme číslo DL zakázky z Dokladů (orders.delivery_note_number), jinak další číslo
 *    z řady (kolize jedinečnosti → další číslo).
 */
async function reserveNote(
  db: JobsDb, job: JobDetail, opts: { retryId?: string | null; note: string | null },
): Promise<DeliveryNoteRow> {
  const mark = pendingMark();
  const patch = {
    customer_id: job.customer?.id ?? null,
    delivery_address: job.customerDetail?.deliveryAddress ?? null,
    note: opts.note,
    issue_date: todayIso(),
    storage_path: mark,
  };
  if (opts.retryId) {
    const { data: found } = await db.from("delivery_notes").select(NOTE_COLS).eq("id", opts.retryId).eq("order_id", job.id).maybeSingle();
    const prev = (found as DeliveryNoteRow | null) ?? null;
    if (!prev) throw new DeliveryNoteBlocked("Dodací list k opakování nenalezen.");
    if (isIssuedPath(prev.storage_path)) {
      throw new DeliveryNoteBlocked(`Dodací list ${prev.number} je už vystavený — najdeš ho v Dokumentech zakázky.`);
    }
    // zábor jedním podmíněným UPDATE: bez PDF (selhalo), nebo zestárlý zámek spadlého požadavku
    const stale = `${PENDING}${String(Date.now() - PENDING_STALE_MS).padStart(13, "0")}`;
    const free = await db.from("delivery_notes").update(patch as never)
      .eq("id", prev.id).eq("order_id", job.id).is("storage_path", null).select(NOTE_COLS);
    if (free.error) throw new Error(free.error.message);
    let row = ((free.data ?? []) as DeliveryNoteRow[])[0];
    if (!row) {
      const old = await db.from("delivery_notes").update(patch as never)
        .eq("id", prev.id).eq("order_id", job.id).like("storage_path", `${PENDING}%`).lt("storage_path", stale).select(NOTE_COLS);
      if (old.error) throw new Error(old.error.message);
      row = ((old.data ?? []) as DeliveryNoteRow[])[0];
    }
    if (!row) throw new DeliveryNoteBlocked(`Dodací list ${prev.number} se právě vystavuje (jiné okno nebo kolega) — obnov stránku.`);
    return row;
  }

  // číslo DL, jehož vystavení dřív selhalo a nikdo ho neopakoval (zavřená obrazovka chyby) → použít ho
  // pro tento DL (řada DL bez mezer); zábor stejně podmíněně jako „Vystavit znovu"
  {
    const stale = `${PENDING}${String(Date.now() - PENDING_STALE_MS).padStart(13, "0")}`;
    const [failed, dead] = await Promise.all([
      db.from("delivery_notes").select("id, storage_path, created_at").eq("order_id", job.id).is("storage_path", null)
        .order("created_at", { ascending: true }).limit(3),
      db.from("delivery_notes").select("id, storage_path, created_at").eq("order_id", job.id)
        .like("storage_path", `${PENDING}%`).lt("storage_path", stale).order("created_at", { ascending: true }).limit(3),
    ]);
    const orphans = [...((failed.data ?? []) as { id: string; storage_path: string | null; created_at: string }[]),
      ...((dead.data ?? []) as { id: string; storage_path: string | null; created_at: string }[])]
      .sort((a, b) => a.created_at.localeCompare(b.created_at));
    for (const o of orphans) {
      // nová dodávka = nové pořadí (created_at), číslo zůstává
      let q = db.from("delivery_notes").update({ ...patch, created_at: new Date().toISOString() } as never).eq("id", o.id).eq("order_id", job.id);
      q = o.storage_path === null ? q.is("storage_path", null) : q.eq("storage_path", o.storage_path);
      const { data: got, error } = await q.select(NOTE_COLS);
      if (error) throw new Error(error.message);
      const row = ((got ?? []) as DeliveryNoteRow[])[0];
      if (row) return row;
    }
  }

  // první dodávka zakázky: číslo DL z Dokladů (vystavený DL na celou zakázku) — jedno číslo pro jedno zboží
  const { count: anyNotes } = await db.from("delivery_notes").select("id", { count: "exact", head: true }).eq("order_id", job.id);
  const jobNumber = (job.deliveryNoteNumber ?? "").trim();
  const candidates: (string | null)[] = [];
  if (!anyNotes && jobNumber) {
    const { data: taken } = await db.from("delivery_notes").select("id").eq("number", jobNumber).maybeSingle();
    if (!taken) candidates.push(jobNumber);
  }
  for (let attempt = 0; attempt < 6; attempt++) {
    const number = candidates.shift() ?? (await nextDlNumber(db));
    if (!number) throw new Error("Nepodařilo se přidělit číslo dodacího listu.");
    const { data, error } = await db.from("delivery_notes")
      .insert({ number, order_id: job.id, ...patch } as never).select(NOTE_COLS).single();
    if (!error) return data as DeliveryNoteRow;
    if (!/duplicate key|unique/i.test(error.message)) throw new Error(error.message);
  }
  throw new Error("Nepodařilo se přidělit číslo dodacího listu (čísla jsou obsazená).");
}

export interface IssueNoteResult {
  id: string;
  number: string;
  fileId: string;
  filename: string;
  version: number;
  label: string | null;
  final: boolean;
}

export class DeliveryNoteError extends Error {
  /** note = rezervované číslo pro „Vystavit znovu"; blocked = opakovat nejde (už vystaven / právě se vystavuje). */
  constructor(message: string, readonly note: { id: string; number: string } | null, readonly blocked = false) {
    super(message);
  }
}

/**
 * Zabere číslo dodacího listu pro dodávku (řádek delivery_notes se zámkem pending) — volající
 * ho může hned uvést v historii dodání; PDF pak vystaví issueDeliveryNote({ reserved }).
 */
export async function reserveDeliveryNote(
  db: JobsDb, job: JobDetail, opts: { note: string | null; retryId?: string | null },
): Promise<DeliveryNoteRow> {
  try {
    return await reserveNote(db, job, { retryId: opts.retryId ?? null, note: opts.note });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new DeliveryNoteError(err instanceof DeliveryNoteBlocked ? msg : translateDbError(msg), null, err instanceof DeliveryNoteBlocked);
  }
}

/**
 * Vystaví (nebo znovu vystaví — stejné číslo) PDF dodacího listu dodávky a uloží ho do Dokumentů
 * zakázky (kind dodaci_list; každý DL vlastní dokument, opakování = nová verze téhož DL) a do
 * delivery_notes(+items, řádek navázaný na položku). Dodané množství NEZAPISUJE — to udělá volající
 * až po úspěchu. catchUp = DL na zboží dodané dřív bez DL (zakázka už jiné DL má) → vlastní označení.
 * Chyba → DeliveryNoteError s rezervovaným číslem (opakování ho použije).
 */
export async function issueDeliveryNote(
  db: JobsDb,
  userId: string,
  job: JobDetail,
  rows: DeliveryRowInput[],
  opts: { note: string | null; preparedBy?: string; retryId?: string | null; reserved?: DeliveryNoteRow; catchUp?: boolean },
): Promise<IssueNoteResult & { lines: DeliveryLine[] }> {
  const lines = deliveryLines(job.items.map((i) => ({ ...i })), rows);
  if (!lines.length) throw new DeliveryNoteError("Na dodací list není co dát — zadej, kolik se dodává teď.", null);

  const row: DeliveryNoteRow = opts.reserved ?? (await reserveDeliveryNote(db, job, { note: opts.note, retryId: opts.retryId }));
  const ref = { id: row.id, number: row.number };
  const mark = row.storage_path;
  try {
    // pořadí dodávky = vystavené DL zakázky před touto (opakování téhož DL pořadí nemění)
    const issued = (await issuedDeliveryNotes(db, job.id)).filter((n) => n.id !== row.id && n.created_at <= row.created_at);
    const items = job.items.map((i) => ({ ...i }));
    const final = deliveryCompletes(items, rows);
    // dodávka zapsaná dřív bez DL se počítá do pořadí („2. dodávka", i když je to první DL zakázky)
    const documented = await documentedQuantities(db, job.id, { exclude: row.id }).catch(() => null);
    const seq = issued.length + 1 + (!opts.catchUp && hadUndocumentedBefore(items, rows, documented) ? 1 : 0);
    const label = opts.catchUp && issued.length ? CATCH_UP_LABEL : deliveryLabel(seq, final);
    const after = new Map(rows.map((r) => [r.itemId, r.to]));
    const left = items.filter((i) => remainingQty({ ...i, deliveredQuantity: after.get(i.id) ?? i.deliveredQuantity }) > 0).length;
    const remainingText = final || !left ? undefined : `${left} ${czPlural(left, "položka", "položky", "položek")}`;

    // snímek řádků (evidence + náhradní PDF, kdyby se soubor ztratil)
    const { error: delErr } = await db.from("delivery_note_items").delete().eq("delivery_note_id", row.id);
    if (delErr) throw new Error(delErr.message);
    const snapshot = lines.map((l, idx) => {
      const it = job.items.find((i) => i.id === l.itemId)!;
      const main = (it.name ?? "").trim() || (it.description ?? "").trim() || (it.drawingNumber ? `Díl dle výkresu ${it.drawingNumber}` : "Položka");
      return {
        delivery_note_id: row.id,
        description: (it.drawingNumber && !main.includes(it.drawingNumber) ? `${main} (výkres ${it.drawingNumber})` : main).slice(0, 500),
        quantity: l.quantity,
        unit: (it.unit || "ks").slice(0, 20),
        position: idx,
        order_item_id: it.id,
      };
    });
    const { error: insErr } = await db.from("delivery_note_items").insert(snapshot as never);
    if (insErr) throw new Error(insErr.message);

    const data = await buildDeliveryDoc(job, {
      number: row.number,
      issueDate: dateOnly(row.issue_date) ?? todayIso(),
      lines: lines.map((l) => ({ itemId: l.itemId, quantity: l.quantity, ordered: l.ordered, deliveredTotal: l.deliveredTotal })),
      deliveryLabel: label,
      remainingText,
      note: opts.note ?? undefined,
      preparedBy: opts.preparedBy,
    });
    const pdf = await renderDeliveryNotePdf(data);
    const filename = pdfFileName("dodaci_list", row.number);
    const path = jobFilePath(job.id, crypto.randomUUID(), filename);
    const { error: upErr } = await db.storage.from(BUCKET).upload(path, pdf, { contentType: "application/pdf", upsert: false });
    if (upErr) throw new Error(`PDF se nepodařilo uložit: ${upErr.message}`);
    const title = deliveryNoteTitle(row.number, label);
    const reg = await registerJobFileCore(db, userId, {
      jobId: job.id, path, filename, mimeType: "application/pdf", size: pdf.length, kind: "dodaci_list",
      title, note: opts.note ?? undefined, silent: true, origin: "generated", issuer: "my",
    });
    if (!reg.ok || !reg.file) {
      try { await db.storage.from(BUCKET).remove([path]); } catch { /* úklid je best-effort */ }
      throw new Error(reg.error ?? "Dodací list se nepodařilo uložit k zakázce.");
    }
    const { error: pathErr } = await db.from("delivery_notes").update({ storage_path: path } as never).eq("id", row.id).eq("storage_path", mark ?? "");
    if (pathErr) throw new Error(pathErr.message);
    // číslo DL zakázky (faktura, starší pohledy) — první vystavený
    if (!(job.deliveryNoteNumber ?? "").trim()) {
      const { error } = await db.from("orders").update({ delivery_note_number: row.number } as never).eq("id", job.id).is("delivery_note_number", null);
      if (error) console.error(`[delivery-notes] Číslo DL k zakázce se nezapsalo: ${error.message}`);
    }
    await logJobEvent(db, {
      jobId: job.id, type: "file", entity: "file", entityId: reg.file.id, actorId: userId,
      message: `${issuedEventMessage("dodaci_list", row.number, reg.file.version)}${label ? ` · ${label}` : ""}`,
      data: {
        fileId: reg.file.id, kind: "dodaci_list", filename, version: reg.file.version, number: row.number, action: "issued",
        deliveryNoteId: row.id, items: lines.map((l) => ({ itemId: l.itemId, quantity: l.quantity })),
      },
    });
    return { ...ref, fileId: reg.file.id, filename, version: reg.file.version, label: label ?? null, final, lines };
  } catch (err) {
    // uvolnit zábor → „Vystavit dodací list znovu" ho hned zabere (stejné číslo)
    if (mark) {
      const { error } = await db.from("delivery_notes").update({ storage_path: null } as never).eq("id", row.id).eq("storage_path", mark);
      if (error) console.error(`[delivery-notes] Zábor DL ${row.number} se neuvolnil: ${error.message}`);
    }
    if (err instanceof DeliveryNoteError) throw err;
    throw new DeliveryNoteError(translateDbError(err instanceof Error ? err.message : String(err)), ref);
  }
}

/** Náhradní PDF ze záznamu dodacího listu (soubor se ztratil) — stejné číslo, popisy ze snímku. */
export async function reissueFromSnapshot(
  db: JobsDb, userId: string, job: JobDetail, note: DeliveryNoteRow, preparedBy?: string,
): Promise<{ fileId: string; filename: string; version: number }> {
  const lines = await deliveryNoteLines(db, note.id);
  const data = await buildDeliveryDoc(job, {
    number: note.number,
    issueDate: dateOnly(note.issue_date) ?? todayIso(),
    lines: lines.map((l) => ({ quantity: round3(l.quantity), description: l.description, unit: l.unit })),
    note: note.note ?? undefined,
    preparedBy,
  });
  const pdf = await renderDeliveryNotePdf(data);
  const filename = pdfFileName("dodaci_list", note.number);
  const path = jobFilePath(job.id, crypto.randomUUID(), filename);
  const { error: upErr } = await db.storage.from(BUCKET).upload(path, pdf, { contentType: "application/pdf", upsert: false });
  if (upErr) throw new Error(`PDF se nepodařilo uložit: ${upErr.message}`);
  const reg = await registerJobFileCore(db, userId, {
    jobId: job.id, path, filename, mimeType: "application/pdf", size: pdf.length, kind: "dodaci_list",
    title: deliveryNoteTitle(note.number), silent: true, origin: "generated", issuer: "my",
  });
  if (!reg.ok || !reg.file) throw new Error(reg.error ?? "Dodací list se nepodařilo uložit k zakázce.");
  await db.from("delivery_notes").update({ storage_path: path } as never).eq("id", note.id);
  return { fileId: reg.file.id, filename, version: reg.file.version };
}
