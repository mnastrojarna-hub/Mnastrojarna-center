"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Briefcase, Loader2, Mail, Pencil, Phone, Plus, Star, Trash2, UserRound, Users, X, Check } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Field } from "@/components/customers/form-bits";
import { EmailSuggestInput } from "@/components/mail/recipient-field";
import { ContactToneChip } from "@/components/contacts/contact-tone-chip";
import { deleteCustomerContact, saveCustomerContact } from "@/app/actions/crm";
import { deleteSupplierContactAction, saveSupplierContactAction } from "@/app/actions/contacts";
import {
  EMPTY_CONTACT_FORM, avatarToneFor, contactFormFromView, initialsOf, validateContactForm,
  type ContactFormValues, type ContactView,
} from "@/components/customers/model";
import { ROLE_TEXT, type PartyKind, type RoleEntry } from "@/lib/contacts/roles";
import type { AddressForm } from "@/lib/contacts/tone";
import { cn } from "@/lib/utils";

export interface ContactTones {
  [email: string]: { address: AddressForm; summary: string };
}

/**
 * Kontaktní osoby zákazníka (i dodavatele) — u každé jméno, pozice, telefon a e-mail; přidat, upravit,
 * smazat, označit hlavní. U osoby je vidět, k čemu se její e-mail používá (Fakturace, Nabídky…),
 * a moje tykání / vykání s ní. Úprava probíhá přímo v kartě kontaktu (bez dalšího okna).
 */
export function ContactsManager({
  customerId, contacts, kind = "customer", roles = [], tones = {}, onChanged,
}: {
  /** Id zákazníka (u dodavatele id dodavatele). */
  customerId: string;
  contacts: ContactView[];
  kind?: PartyKind;
  roles?: RoleEntry[];
  tones?: ContactTones;
  /** Po uložení (dialog dodavatele si data načte sám); jinak router.refresh(). */
  onChanged?: () => void;
}) {
  const router = useRouter();
  const [editing, setEditing] = React.useState<string | "new" | null>(null);
  const [deleting, setDeleting] = React.useState<string | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const refresh = () => (onChanged ? onChanged() : router.refresh());

  async function remove(c: ContactView) {
    if (!window.confirm(`Smazat kontakt ${c.name}?`)) return;
    setDeleting(c.id);
    setError(null);
    const res = kind === "supplier" ? await deleteSupplierContactAction(customerId, c.id) : await deleteCustomerContact(customerId, c.id);
    setDeleting(null);
    if (!res.ok) setError(res.error ?? "Smazání se nepovedlo.");
    else refresh();
  }

  return (
    <div className="space-y-3">
      {error && <p className="rounded-lg bg-destructive/10 px-3 py-2 text-sm text-destructive">{error}</p>}

      {contacts.length === 0 && editing !== "new" && (
        <div className="flex flex-col items-center gap-2 rounded-xl border border-dashed p-5 text-center text-sm text-muted-foreground">
          <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-sky-100 text-sky-700 dark:bg-sky-500/15 dark:text-sky-300">
            <Users className="h-5 w-5" />
          </span>
          <p>
            {kind === "supplier"
              ? "Zatím žádné kontaktní osoby. Přidej obchodníka, technika nebo účetní dodavatele."
              : "Zatím žádné kontaktní osoby. Přidej nákupčího, technika nebo účetní — e-maily se pak přiřadí samy."}
          </p>
        </div>
      )}

      {/* na kartě zákazníka je v úzkém sloupci → na velké obrazovce jeden sloupec */}
      <ul className="grid gap-2 sm:grid-cols-2 lg:grid-cols-1">
        {contacts.map((c) => {
          const myRoles = roles.filter((r) => r.contactId === c.id);
          const tone = c.email ? tones[c.email.toLowerCase()] : undefined;
          return editing === c.id ? (
            <li key={c.id} className="sm:col-span-2 lg:col-span-1">
              <ContactForm
                kind={kind}
                customerId={customerId}
                contact={c}
                onDone={(saved) => {
                  setEditing(null);
                  if (saved) refresh();
                }}
              />
            </li>
          ) : (
            <li
              key={c.id}
              className={cn(
                "flex items-start gap-3 rounded-xl border bg-card p-3",
                c.isPrimary && "border-amber-300 bg-amber-50/50 dark:border-amber-500/40 dark:bg-amber-500/[0.06]",
              )}
              data-testid="contact-card"
              data-email={c.email ?? ""}
            >
              <span className={cn("flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-xs font-bold", avatarToneFor(c.name))}>
                {initialsOf(c.name)}
              </span>
              <div className="min-w-0 flex-1 space-y-1.5 text-sm">
                <div>
                  <div className="flex flex-wrap items-center gap-1.5">
                    <span className="font-semibold">{c.name}</span>
                    {c.isPrimary && (
                      <span className="inline-flex items-center gap-0.5 rounded-full bg-amber-100 px-1.5 py-0.5 text-[10px] font-semibold text-amber-800 dark:bg-amber-500/20 dark:text-amber-300">
                        <Star className="h-3 w-3 fill-current" /> hlavní
                      </span>
                    )}
                    {myRoles.map((r) => (
                      <span key={r.id} className="rounded-full bg-sky-100 px-1.5 py-0.5 text-[10px] font-semibold text-sky-800 dark:bg-sky-500/15 dark:text-sky-300">
                        {ROLE_TEXT[kind][r.role].label}
                      </span>
                    ))}
                  </div>
                  <div className={cn("flex items-center gap-1 text-xs", c.position ? "text-muted-foreground" : "text-muted-foreground/60")}>
                    <Briefcase className="h-3 w-3 shrink-0" />{c.position ?? "pozice neuvedena"}
                  </div>
                </div>
                <div className="flex flex-col gap-0.5 text-xs">
                  {c.email ? (
                    <a href={`mailto:${c.email}`} className="inline-flex min-w-0 items-center gap-1 text-sky-700 hover:underline dark:text-sky-400">
                      <Mail className="h-3 w-3 shrink-0" /><span className="truncate">{c.email}</span>
                    </a>
                  ) : (
                    <button type="button" onClick={() => setEditing(c.id)} className="inline-flex items-center gap-1 text-left text-amber-700 hover:underline dark:text-amber-400">
                      <Mail className="h-3 w-3 shrink-0" /> doplnit e-mail
                    </button>
                  )}
                  {c.phone ? (
                    <a href={`tel:${c.phone.replace(/\s/g, "")}`} className="inline-flex items-center gap-1 text-emerald-700 hover:underline dark:text-emerald-400">
                      <Phone className="h-3 w-3 shrink-0" />{c.phone}
                    </a>
                  ) : (
                    <button type="button" onClick={() => setEditing(c.id)} className="inline-flex items-center gap-1 text-left text-amber-700 hover:underline dark:text-amber-400">
                      <Phone className="h-3 w-3 shrink-0" /> doplnit telefon
                    </button>
                  )}
                </div>
                <ContactToneChip email={c.email} name={c.name} initial={tone?.address ?? null} summary={tone?.summary ?? null} />
              </div>
              <div className="flex shrink-0 gap-0.5">
                <Button type="button" variant="ghost" size="icon-sm" onClick={() => setEditing(c.id)} aria-label={`Upravit ${c.name}`} title="Upravit">
                  <Pencil />
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-sm"
                  onClick={() => remove(c)}
                  disabled={deleting === c.id}
                  aria-label={`Smazat ${c.name}`}
                  title="Smazat"
                  className="text-muted-foreground hover:text-destructive"
                >
                  {deleting === c.id ? <Loader2 className="animate-spin" /> : <Trash2 />}
                </Button>
              </div>
            </li>
          );
        })}
        {editing === "new" && (
          <li className="sm:col-span-2 lg:col-span-1">
            <ContactForm
              kind={kind}
              customerId={customerId}
              primaryDefault={contacts.length === 0}
              onDone={(saved) => {
                setEditing(null);
                if (saved) refresh();
              }}
            />
          </li>
        )}
      </ul>

      {editing !== "new" && (
        <Button type="button" variant="outline" size="sm" onClick={() => setEditing("new")}>
          <Plus /> Přidat kontaktní osobu
        </Button>
      )}
    </div>
  );
}

function ContactForm({
  kind,
  customerId,
  contact,
  primaryDefault = false,
  onDone,
}: {
  kind: PartyKind;
  customerId: string;
  contact?: ContactView;
  primaryDefault?: boolean;
  onDone: (saved: boolean) => void;
}) {
  const [values, setValues] = React.useState<ContactFormValues>(
    contact ? contactFormFromView(contact) : { ...EMPTY_CONTACT_FORM, isPrimary: primaryDefault },
  );
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const prefix = `contact-${contact?.id ?? "new"}`;

  function set<K extends keyof ContactFormValues>(k: K, v: ContactFormValues[K]) {
    setValues((cur) => ({ ...cur, [k]: v }));
    setError(null);
  }

  async function submit(e?: React.SyntheticEvent) {
    e?.preventDefault();
    if (busy) return;
    const err = validateContactForm(values);
    if (err) {
      setError(err);
      return;
    }
    setBusy(true);
    const res = kind === "supplier"
      ? await saveSupplierContactAction(customerId, values, contact?.id)
      : await saveCustomerContact(customerId, values, contact?.id);
    setBusy(false);
    if (!res.ok) setError(res.error ?? "Uložení se nepovedlo.");
    else onDone(true);
  }

  const missing = [!values.position.trim() && "pozici", !values.phone.trim() && "telefon", !values.email.trim() && "e-mail"].filter(Boolean);
  return (
    // bez <form> — formulář kontaktu může být i uvnitř jiného formuláře (karta dodavatele je dialog s formulářem)
    <div
      role="group"
      aria-label={contact ? "Upravit kontakt" : "Nová kontaktní osoba"}
      className="space-y-3 rounded-xl border-2 border-sky-200 bg-sky-50/40 p-3 dark:border-sky-500/30 dark:bg-sky-500/[0.05]"
      onKeyDown={(e) => {
        if (e.key === "Enter" && !e.defaultPrevented && (e.target as HTMLElement).tagName === "INPUT" && (e.target as HTMLInputElement).type !== "checkbox") void submit(e);
      }}
    >
      <div className="flex items-center gap-2 text-sm font-semibold">
        <UserRound className="h-4 w-4 text-sky-600 dark:text-sky-400" />
        {contact ? `Upravit kontakt` : "Nová kontaktní osoba"}
      </div>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-1">
        <Field id={`${prefix}-name`} label="Jméno" required>
          <Input id={`${prefix}-name`} value={values.name} onChange={(e) => set("name", e.target.value)} placeholder="Ing. Petr Svoboda" autoFocus autoComplete="name" />
        </Field>
        <Field id={`${prefix}-position`} label="Pozice">
          <Input id={`${prefix}-position`} value={values.position} onChange={(e) => set("position", e.target.value)} placeholder="Nákupčí / technik / účetní" />
        </Field>
        <Field id={`${prefix}-email`} label="E-mail">
          <EmailSuggestInput
            id={`${prefix}-email`}
            value={values.email}
            onChange={(v) => set("email", v)}
            context={kind === "supplier" ? { supplierId: customerId } : { customerId }}
            placeholder="petr.svoboda@firma.cz"
            onPicked={(s) => {
              // adresa z pošty / adresáře → doplní prázdné jméno, pozici a telefon
              setValues((cur) => ({
                ...cur,
                name: cur.name.trim() || (s.name !== s.email && s.kind !== "zákazník" && s.kind !== "dodavatel" ? s.name : cur.name),
                position: cur.position.trim() || s.position || "",
                phone: cur.phone.trim() || s.phone || "",
              }));
            }}
          />
        </Field>
        <Field id={`${prefix}-phone`} label="Telefon">
          <Input id={`${prefix}-phone`} type="tel" inputMode="tel" value={values.phone} onChange={(e) => set("phone", e.target.value)} placeholder="+420 777 123 456" autoComplete="tel" />
        </Field>
      </div>
      {missing.length > 0 && values.name.trim() && (
        <p className="text-[11px] text-muted-foreground">Doplň ještě {missing.join(", ")} — u každého kontaktu se hodí osoba, pozice, telefon i e-mail.</p>
      )}
      <label className="flex cursor-pointer items-center gap-2 text-sm">
        <input type="checkbox" checked={values.isPrimary} onChange={(e) => set("isPrimary", e.target.checked)} className="h-4 w-4 accent-amber-500" />
        {kind === "supplier" ? "Hlavní kontakt dodavatele" : "Hlavní kontakt (na něj chodí nabídky a potvrzení)"}
      </label>
      {error && <p className="text-sm font-medium text-destructive">{error}</p>}
      <div className="flex justify-end gap-2">
        <Button type="button" variant="ghost" size="sm" onClick={() => onDone(false)} disabled={busy}>
          <X /> Zrušit
        </Button>
        <Button type="button" variant="success" size="sm" disabled={busy} onClick={(e) => void submit(e)}>
          {busy ? <Loader2 className="animate-spin" /> : <Check />} Uložit kontakt
        </Button>
      </div>
    </div>
  );
}
