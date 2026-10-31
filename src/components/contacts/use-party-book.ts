"use client";

import * as React from "react";
import { getPartyBookAction } from "@/app/actions/contacts";
import {
  bookInputFromDraft, draftFromBook, draftSignature, emptyBookDraft, type BookDraft, type PartyBookInput,
} from "@/lib/contacts/book-draft";
import type { PartyKind } from "@/lib/contacts/roles";

/**
 * Koncept adresáře firmy pro dialog (kontaktní osoby + „Kam posílat"): při otevření se načte uložený stav
 * (u nové firmy prázdný s jedním řádkem), `dirty` = neuložené změny, `prepare()` = vstup pro akci uložení
 * (null = adresář se neposílá — nenačetl se / v DB chybí migrace; firma se uloží jako dřív).
 */
export function usePartyBookDraft(kind: PartyKind, partyId: string | null, open: boolean) {
  const [draft, setDraft] = React.useState<BookDraft | null>(() => (partyId ? null : emptyBookDraft(true)));
  const [initialSig, setInitialSig] = React.useState(() => (draft ? draftSignature(draft) : ""));
  const [loadError, setLoadError] = React.useState<string | null>(null);
  const [schemaMissing, setSchemaMissing] = React.useState(false);

  React.useEffect(() => {
    if (!open) return;
    let alive = true;
    setLoadError(null);
    setSchemaMissing(false);
    if (!partyId) {
      const d = emptyBookDraft(true);
      setDraft(d);
      setInitialSig(draftSignature(d));
      return;
    }
    setDraft(null);
    getPartyBookAction(kind, partyId)
      .then((res) => {
        if (!alive) return;
        if (res.ok && res.book) {
          if (res.book.schemaMissing) {
            setSchemaMissing(true);
            return;
          }
          const d = draftFromBook(res.book, true);
          setDraft(d);
          setInitialSig(draftSignature(d));
        } else setLoadError(res.error ?? "Kontakty se nepodařilo načíst.");
      })
      .catch(() => {
        if (alive) setLoadError("Kontakty se nepodařilo načíst.");
      });
    return () => {
      alive = false;
    };
  }, [open, kind, partyId]);

  const dirty = draft ? draftSignature(draft) !== initialSig : false;
  const loading = open && !draft && !loadError && !schemaMissing;

  const prepare = React.useCallback((): { input: PartyBookInput | null } | { error: string } => {
    if (!draft || loadError || schemaMissing) return { input: null };
    return bookInputFromDraft(kind, draft);
  }, [draft, kind, loadError, schemaMissing]);

  return { draft, setDraft, dirty, loading, loadError, schemaMissing, prepare };
}
