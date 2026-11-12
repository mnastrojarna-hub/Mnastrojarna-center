import "server-only";
import { logJobEvent, type JobsDb } from "@/lib/jobs/events";

/** Výsledek zrušení vystavené faktury u zakázky. */
export interface InvoiceRelease {
  number: string;
  /** Číslo bylo v řadě poslední — nová faktura dostane totéž. */
  numberFree: boolean;
  /** Stav „Vyfakturováno" vrácen na „Dodáno zákazníkovi". */
  stageReturned: boolean;
}

export type InvoiceReleaseFail = { released: false; reason: "other_number" | "paid" | "error"; error?: string };

/**
 * Zrušení vystavené faktury u zakázky — JEDINÁ cesta (smazání PDF v Dokumentech i „Smazat" ve Fakturách vydaných):
 * RPC release_job_invoice (migrace 20261106090000) vymaže číslo, datum, splatnost a příznaky vyfakturování u zakázky,
 * smaže řádek z evidence faktur, vrátí čítač řady FV, když bylo číslo poslední, a „Vyfakturováno" vrátí na „Dodáno
 * zákazníkovi". Uhrazenou fakturu (invoices.status = uhrazena) nezruší. Událost v historii zakázky s autorem.
 * `cause` = konec věty události („smazáno PDF Faktura_FV-….pdf" / „smazáno ve Fakturách vydaných").
 */
export async function releaseJobInvoiceCore(
  db: JobsDb,
  jobId: string,
  number: string,
  actorId: string,
  cause: string,
): Promise<InvoiceRelease | InvoiceReleaseFail> {
  const rpc = db.rpc as unknown as (fn: string, args: Record<string, unknown>) => PromiseLike<{ data: unknown; error: { message: string } | null }>;
  const { data, error } = await rpc.call(db, "release_job_invoice", { p_job: jobId, p_number: number });
  if (error) {
    console.error(`[invoice-release] Zrušení faktury ${number} selhalo: ${error.message}`);
    return { released: false, reason: "error", error: error.message };
  }
  const r = (data ?? {}) as { released?: boolean; reason?: string; numberFree?: boolean; stageReturned?: boolean };
  if (!r.released) return { released: false, reason: r.reason === "paid" ? "paid" : "other_number" };
  const out: InvoiceRelease = { number, numberFree: r.numberFree === true, stageReturned: r.stageReturned === true };
  await logJobEvent(db, {
    jobId, type: "file", actorId,
    message: `Faktura ${number} zrušena (${cause}) — lze vystavit novou${out.numberFree ? " se stejným číslem" : ""}${out.stageReturned ? "; stav vrácen na Dodáno zákazníkovi" : ""}`,
    data: { action: "invoice_released", number, numberFree: out.numberFree, stageReturned: out.stageReturned },
  });
  return out;
}

export function isInvoiceRelease(r: InvoiceRelease | InvoiceReleaseFail | null | undefined): r is InvoiceRelease {
  return Boolean(r) && !("released" in (r as object));
}
