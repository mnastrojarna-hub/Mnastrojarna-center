"use client";

import * as React from "react";
import { Loader2, Send, Users } from "lucide-react";
import { getSupplierBookAction, type SupplierBook } from "@/app/actions/contacts";
import { ContactsManager } from "@/components/customers/contacts-manager";
import { RoleEmailsEditor } from "@/components/contacts/role-emails";

/**
 * Karta dodavatele (dialog): kontaktní osoby (jméno, pozice, telefon, e-mail, moje tykání) a e-maily
 * podle účelu — objednávky odejdou na „Objednávky", poptávky na „Poptávky (RFQ)".
 */
export function SupplierContactsSection({ supplierId }: { supplierId: string }) {
  const [book, setBook] = React.useState<SupplierBook | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const load = React.useCallback(async () => {
    const res = await getSupplierBookAction(supplierId).catch(() => null);
    if (res?.ok && res.book) {
      setBook(res.book);
      setError(null);
    } else setError(res?.error ?? "Kontakty se nepodařilo načíst.");
  }, [supplierId]);
  React.useEffect(() => { void load(); }, [load]);

  if (error) return <p className="rounded-lg bg-destructive/10 px-3 py-2 text-sm text-destructive">{error}</p>;
  if (!book) {
    return (
      <p className="flex items-center gap-2 text-sm text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" /> Načítám kontakty…
      </p>
    );
  }
  return (
    <div className="space-y-5" data-testid="supplier-contacts">
      <section className="space-y-2">
        <h3 className="flex items-center gap-2 text-sm font-semibold"><Users className="h-4 w-4 text-sky-600" /> Kontaktní osoby ({book.contacts.length})</h3>
        <ContactsManager kind="supplier" customerId={supplierId} contacts={book.contacts} roles={book.roles} tones={book.tones} onChanged={() => void load()} />
      </section>
      <section className="space-y-2">
        <h3 className="flex items-center gap-2 text-sm font-semibold"><Send className="h-4 w-4 text-violet-600" /> E-maily podle účelu</h3>
        <p className="text-xs text-muted-foreground">{"Objednávka jde na „Objednávky“, poptávka na „Poptávky (RFQ)“; bez nich e-mail dodavatele."}</p>
        <RoleEmailsEditor kind="supplier" partyId={supplierId} roles={book.roles} contacts={book.contacts} partyEmail={book.partyEmail} onChanged={() => void load()} />
      </section>
    </div>
  );
}
