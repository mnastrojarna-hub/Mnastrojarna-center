import "server-only";
import { createOperatorClient, isSupabaseConfigured } from "@/lib/supabase/server";
import { getAccess } from "@/lib/auth/session";
import { loadAddressBook, loadToneSettings } from "@/lib/contacts/server";
import { toneSummary } from "@/lib/contacts/tone";
import type { BookContact, PartyKind, RoleEntry } from "@/lib/contacts/roles";
import type { ContactTones } from "@/components/customers/contacts-manager";

/**
 * Data karty zákazníka / dodavatele pro kontakty: e-maily podle účelu a MOJE tykání ke kontaktům.
 * Bez oprávnění / DB → prázdné (karta se vykreslí jako dřív).
 */
export async function getContactBook(kind: PartyKind, id: string): Promise<{
  roles: RoleEntry[]; contacts: BookContact[]; partyEmail: string | null; tones: ContactTones;
}> {
  const empty = { roles: [], contacts: [], partyEmail: null, tones: {} };
  if (!isSupabaseConfigured()) return empty;
  const { user, can } = await getAccess();
  if (!user || !can(kind === "customer" ? "customers" : "suppliers")) return empty;
  try {
    const db = await createOperatorClient();
    const book = await loadAddressBook(db, kind === "customer" ? { customerId: id } : { supplierId: id });
    if (!book) return empty;
    const map = await loadToneSettings(db, user.id, book.contacts.map((c) => c.email ?? ""));
    const tones: ContactTones = {};
    for (const c of book.contacts) {
      const s = c.email ? map.get(c.email) : undefined;
      if (c.email && s) tones[c.email] = { address: s.address, summary: toneSummary(s, c.name) };
    }
    return { roles: book.roles, contacts: book.contacts, partyEmail: book.partyEmail, tones };
  } catch {
    return empty;
  }
}
