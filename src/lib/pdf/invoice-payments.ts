import { computeTotals, czDate, type DocItem, type InvoicePayment } from "./types";

export type { InvoicePayment };

/**
 * Úhrady na faktuře (zálohy a platby zapsané u zakázky) — čisté funkce bez DB.
 *
 * Úhrady se v aplikaci zapisují BEZ DPH (job_payments.amount, „Částka bez DPH"), faktura ale
 * účtuje s DPH. Odečítaná částka = zapsaná částka × (celkem s DPH / celkem bez DPH) téže faktury
 * (při více sazbách poměrně). Daňový doklad k záloze se NEvytváří: rekapitulace DPH faktury zůstává
 * za celé zdanitelné plnění, úhrady snižují jen částku „Zbývá uhradit" (QR platba, e-mail).
 */

/** Řádek job_payments (stačí tyto sloupce). */
export interface PaymentRowLike {
  paid_on: string;
  amount: number | string | null;
  settles?: boolean | null;
}

const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;

/**
 * Úhrady zakázky → řádky faktury (s DPH), seřazené podle data. `settled` = některá úhrada zakázku
 * vyrovnává („Zaplaceno" — i se slevou / skontem) → nic nezbývá.
 */
export function invoicePaymentsFromRows(
  rows: readonly PaymentRowLike[] | null | undefined,
  items: DocItem[],
  issueDate: string,
): { payments: InvoicePayment[]; settled: boolean } {
  const { subtotal, total } = computeTotals(items);
  const ratio = subtotal > 0 ? total / subtotal : 1;
  const sorted = [...(rows ?? [])]
    .filter((r) => typeof r?.paid_on === "string" && r.paid_on)
    .sort((a, b) => a.paid_on.localeCompare(b.paid_on));
  const issued = (issueDate ?? "").slice(0, 10);
  const payments: InvoicePayment[] = [];
  let paid = 0;
  let settled = false;
  for (const r of sorted) {
    if (r.settles) settled = true;
    const date = r.paid_on.slice(0, 10);
    const kind = issued && date < issued ? "zaloha" : "platba";
    if (r.amount === null || r.amount === undefined || r.amount === "") {
      // „celá / zbývající částka" — na faktuře zbytek do celkové částky
      const rest = round2(total - paid);
      if (rest <= 0) continue;
      payments.push({ date, amount: rest, net: null, kind });
      paid = round2(paid + rest);
      continue;
    }
    const net = round2(Number(r.amount));
    if (!Number.isFinite(net) || net <= 0) continue;
    const amount = round2(net * ratio);
    payments.push({ date, amount, net, kind });
    paid = round2(paid + amount);
  }
  return { payments, settled };
}

/** Celkem s DPH, uhrazeno a zbývá uhradit (nikdy záporně; vyrovnaná zakázka = 0). */
export function invoiceBalance(
  items: DocItem[],
  payments?: readonly InvoicePayment[] | null,
  settled?: boolean | null,
): { total: number; paid: number; due: number } {
  const { total } = computeTotals(items);
  const paid = round2((payments ?? []).reduce((s, p) => s + (Number.isFinite(p.amount) ? p.amount : 0), 0));
  const due = settled ? 0 : Math.max(0, round2(total - paid));
  return { total, paid, due };
}

/** „Uhrazeno zálohou 12. 10. 2026" / „Uhrazeno platbou 2. 11. 2026". */
export function invoicePaymentLabel(p: Pick<InvoicePayment, "kind" | "date">): string {
  return `Uhrazeno ${p.kind === "zaloha" ? "zálohou" : "platbou"} ${czDate(p.date)}`;
}
