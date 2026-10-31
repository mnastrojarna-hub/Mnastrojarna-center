import "server-only";
import { fetchPaged } from "@/lib/jobs/mapping";
import { matchCustomer, type CustomerLookupRow } from "@/lib/jobs/customers";
import type { PartyKind } from "@/lib/contacts/roles";
import type { PartyDuplicate } from "@/lib/parties/autofill-types";
import type { JobsDb } from "@/lib/jobs/events";

/**
 * Je firma už v adresáři? (IČO → DIČ → název, stejně jako kontrola při uložení v crm.ts.)
 * Chyba čtení = null (varování je jen pomůcka — uložení duplicitu stejně odmítne).
 */
export async function findPartyDuplicate(
  db: JobsDb,
  kind: PartyKind,
  input: { name?: string | null; ico?: string | null; dic?: string | null },
  exceptId?: string | null,
): Promise<PartyDuplicate | null> {
  if (!input.name?.trim() && !input.ico?.trim() && !input.dic?.trim()) return null;
  const table = kind === "customer" ? "customers" : "suppliers";
  const cols = kind === "customer" ? "id, name, ico, dic, customer_number" : "id, name, ico, dic";
  try {
    const { data, error } = await fetchPaged<CustomerLookupRow & { customer_number?: string | null }>(
      (from, to) => db.from(table).select(cols).order("created_at").order("id").range(from, to),
      50_000,
    );
    if (error) return null;
    const rows = exceptId ? data.filter((r) => r.id !== exceptId) : data;
    const hit = matchCustomer(rows, { name: input.name ?? "", ico: input.ico ?? undefined, dic: input.dic ?? undefined });
    if (!hit) return null;
    const row = rows.find((r) => r.id === hit.id);
    return { id: hit.id, by: hit.by, label: `${row?.customer_number ? `${row.customer_number} ` : ""}${row?.name ?? ""}`.trim() };
  } catch {
    return null;
  }
}
