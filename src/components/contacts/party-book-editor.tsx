"use client";

import * as React from "react";
import { AlertTriangle, Loader2, Plus, Send, Star, Trash2, Users } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { FormSection } from "@/components/customers/form-bits";
import { EmailSuggestInput } from "@/components/mail/recipient-field";
import { RoleEmailsView } from "@/components/contacts/role-emails";
import { contactFromSuggestion } from "@/components/customers/model";
import {
  draftAddContact, draftAddRole, draftPickableContacts, draftRemoveContact, draftRemoveRole, draftRoleEntries,
  draftSetRoleDefault, draftTogglePrimary, draftUpdateContact, type BookDraft, type DraftContact,
} from "@/lib/contacts/book-draft";
import { CONTACTS_SCHEMA_MISSING, ROLE_TEXT, type PartyKind } from "@/lib/contacts/roles";
import { cn } from "@/lib/utils";

const HINT = "placeholder:italic placeholder:text-muted-foreground/80";

/**
 * Dialog „Upravit zákazníka / dodavatele": všechny kontaktní osoby (jméno, pozice, e-mail, telefon, hlavní)
 * a hned pod nimi „Kam posílat" (Faktury, Dodací listy, Nabídky, Objednávky / potvrzení, Běžná komunikace).
 * Upravuje se koncept — uloží ho až tlačítko dialogu, spolu s údaji firmy (save_party_book, jedna transakce).
 * Zobrazení účelů je stejné jako na kartě zákazníka (RoleEmailsView).
 */
export function PartyBookEditor({
  kind, partyId, draft, onChange, partyEmail, loadError, schemaMissing = false, idPrefix,
}: {
  kind: PartyKind;
  /** Uložená firma (našeptávač adres firmy); nová = null. */
  partyId: string | null;
  /** null = načítá se. */
  draft: BookDraft | null;
  onChange: (d: BookDraft) => void;
  partyEmail?: string | null;
  loadError?: string | null;
  schemaMissing?: boolean;
  idPrefix: string;
}) {
  const [roleError, setRoleError] = React.useState<string | null>(null);
  const [focusKey, setFocusKey] = React.useState<string | null>(null);
  React.useEffect(() => {
    if (!focusKey) return;
    document.getElementById(`${idPrefix}-c-${focusKey}-name`)?.focus();
    setFocusKey(null);
  }, [focusKey, idPrefix]);

  const suggestContext = partyId ? (kind === "customer" ? { customerId: partyId } : { supplierId: partyId }) : null;
  const contactsTitle = "Kontaktní osoby";
  const tone = { contacts: "bg-sky-100 text-sky-700 dark:bg-sky-500/15 dark:text-sky-300", roles: "bg-violet-100 text-violet-700 dark:bg-violet-500/15 dark:text-violet-300" };

  if (loadError || schemaMissing) {
    return (
      <FormSection icon={<Users />} tone={tone.contacts} title={contactsTitle}>
        <p className="flex items-start gap-2 rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-900 sm:col-span-2 dark:bg-amber-500/10 dark:text-amber-200" data-testid="party-book-unavailable">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
          <span>{schemaMissing ? CONTACTS_SCHEMA_MISSING : `${loadError} Kontakty teď nejde upravit — ostatní údaje uložíš normálně.`}</span>
        </p>
      </FormSection>
    );
  }
  if (!draft) {
    return (
      <FormSection icon={<Users />} tone={tone.contacts} title={contactsTitle}>
        <p className="flex items-center gap-2 text-sm text-muted-foreground sm:col-span-2"><Loader2 className="h-4 w-4 animate-spin" /> Načítám kontakty…</p>
      </FormSection>
    );
  }

  const text = ROLE_TEXT[kind];
  const set = (d: BookDraft) => {
    setRoleError(null);
    onChange(d);
  };
  const remove = (c: DraftContact, label: string) => {
    const used = [...new Set(draft.roles.filter((r) => r.contactKey === c.key).map((r) => text[r.role].label))];
    if (used.length && !window.confirm(`${label} je v „Kam posílat“: ${used.join(", ")}. Odebrat kontakt i odtud?`)) return;
    set(draftRemoveContact(draft, c.key));
  };

  return (
    <>
      <FormSection icon={<Users />} tone={tone.contacts} title={`${contactsTitle} (${draft.contacts.filter((c) => c.name.trim() || c.email.trim()).length})`} hint="Kdo u firmy co dělá. ★ = hlavní kontakt.">
        <div className="min-w-0 space-y-2 sm:col-span-2" data-testid="party-contacts">
          {draft.contacts.length === 0 && (
            <p className="rounded-xl border border-dashed p-3 text-center text-sm italic text-muted-foreground">Zatím žádná kontaktní osoba.</p>
          )}
          <ul className="space-y-2">
            {draft.contacts.map((c, i) => {
              const n = i + 1;
              const label = c.name.trim() || c.email.trim() || `${n}. kontakt`;
              const fid = `${idPrefix}-c-${c.key}`;
              const roles = [...new Set(draft.roles.filter((r) => r.contactKey === c.key).map((r) => text[r.role].label))];
              return (
                <li
                  key={c.key}
                  className={cn(
                    "rounded-xl border bg-card p-2",
                    c.isPrimary && "border-amber-300 bg-amber-50/50 dark:border-amber-500/40 dark:bg-amber-500/[0.06]",
                  )}
                  data-testid="party-contact"
                  data-email={c.email.trim().toLowerCase()}
                >
                  <div className="flex items-start gap-1.5">
                    <button
                      type="button"
                      onClick={() => set(draftTogglePrimary(draft, c.key))}
                      className={cn("mt-1.5 shrink-0 rounded p-1", c.isPrimary ? "text-amber-500" : "text-muted-foreground/50 hover:text-amber-500")}
                      aria-pressed={c.isPrimary}
                      aria-label={c.isPrimary ? `${label}: hlavní kontakt` : `${label}: nastavit jako hlavní kontakt`}
                      title={c.isPrimary ? "Hlavní kontakt" : "Nastavit jako hlavní kontakt"}
                    >
                      <Star className={cn("h-4 w-4", c.isPrimary && "fill-current")} />
                    </button>
                    <div className="grid min-w-0 flex-1 gap-1.5 sm:grid-cols-2">
                      <Input
                        id={`${fid}-name`}
                        value={c.name}
                        onChange={(e) => set(draftUpdateContact(draft, c.key, { name: e.target.value }))}
                        placeholder="jméno a příjmení"
                        aria-label={`${n}. kontakt — jméno`}
                        autoComplete="off"
                        className={cn(HINT, "font-medium")}
                      />
                      <Input
                        id={`${fid}-position`}
                        value={c.position}
                        onChange={(e) => set(draftUpdateContact(draft, c.key, { position: e.target.value }))}
                        placeholder="pozice (nákup, účetní, technik…)"
                        aria-label={`${n}. kontakt — pozice`}
                        autoComplete="off"
                        className={HINT}
                      />
                      <EmailSuggestInput
                        id={`${fid}-email`}
                        value={c.email}
                        onChange={(v) => set(draftUpdateContact(draft, c.key, { email: v }))}
                        context={suggestContext}
                        placeholder="e-mail"
                        aria-label={`${n}. kontakt — e-mail`}
                        onPicked={(s) => set(draftUpdateContact(draft, c.key, { ...contactFromSuggestion(c, s), email: s.email }))}
                      />
                      <Input
                        id={`${fid}-phone`}
                        type="tel"
                        inputMode="tel"
                        value={c.phone}
                        onChange={(e) => set(draftUpdateContact(draft, c.key, { phone: e.target.value }))}
                        placeholder="telefon"
                        aria-label={`${n}. kontakt — telefon`}
                        autoComplete="off"
                        className={HINT}
                      />
                    </div>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon-sm"
                      className="mt-0.5 shrink-0 text-muted-foreground hover:text-destructive"
                      onClick={() => remove(c, label)}
                      aria-label={`Odebrat kontakt ${label}`}
                      title="Odebrat kontakt"
                    >
                      <Trash2 />
                    </Button>
                  </div>
                  {roles.length > 0 && (
                    <div className="mt-1.5 flex flex-wrap gap-1 pl-8">
                      {roles.map((r) => (
                        <span key={r} className="rounded-full bg-sky-100 px-1.5 py-0.5 text-[10px] font-semibold text-sky-800 dark:bg-sky-500/15 dark:text-sky-300">{r}</span>
                      ))}
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => {
              const r = draftAddContact(draft);
              set(r.draft);
              setFocusKey(r.key);
            }}
          >
            <Plus /> Přidat kontaktní osobu
          </Button>
        </div>
      </FormSection>

      <FormSection
        icon={<Send />}
        tone={tone.roles}
        title="Kam posílat"
        hint={kind === "customer"
          ? "Ke každému účelu vyber osobu nebo napiš adresu. ★ jde do Komu, další do kopie."
          : "Poptávky a objednávky dodavateli odejdou sem. ★ jde do Komu, další do kopie."}
      >
        <div className="min-w-0 sm:col-span-2">
          <RoleEmailsView
            kind={kind}
            roles={draftRoleEntries(draft)}
            contacts={draftPickableContacts(draft)}
            partyEmail={partyEmail}
            suggestContext={suggestContext}
            error={roleError}
            onAdd={(role, input) => {
              const r = draftAddRole(draft, role, input);
              if ("error" in r) {
                setRoleError(r.error);
                return false;
              }
              set(r.draft);
              return true;
            }}
            onRemove={(entry) => set(draftRemoveRole(draft, entry.id))}
            onSetDefault={(entry) => set(draftSetRoleDefault(draft, entry.id))}
          />
        </div>
      </FormSection>
    </>
  );
}
