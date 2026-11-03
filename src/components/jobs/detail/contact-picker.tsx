"use client";

import * as React from "react";
import Link from "next/link";
import { UserRound, Mail, Phone, ExternalLink, Lock, AlertTriangle } from "lucide-react";
import type { JobDetail } from "@/lib/jobs/types";
import { newContactFromText } from "@/lib/jobs/mapping";
import { useJobDetail } from "./detail-context";
import { SearchSelect, type SearchOption } from "./search-select";

/** Popisek kontaktu ve výběru: pozice · e-mail · telefon (hledá se i podle nich). */
export function contactOptionSub(k: { position: string | null; email: string | null; phone: string | null; isPrimary?: boolean }): string | null {
  return [k.isPrimary ? "hlavní" : null, k.position, k.email, k.phone].filter(Boolean).join(" · ") || null;
}

function ReadOnlyValue({ label, icon: Icon, children, field }: {
  label: string; icon: typeof Mail; children: React.ReactNode; field: string;
}) {
  return (
    <div className="min-w-0" data-field={field}>
      <div className="mb-0.5 flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
        <Icon className="h-3.5 w-3.5 text-sky-500" aria-hidden />
        {label}
        <Lock className="h-3 w-3" aria-label="mění se v Kartě zákazníka" />
      </div>
      <div className="min-w-0 text-sm">{children}</div>
    </div>
  );
}

/**
 * Kontaktní osoba zakázky (majitel 3. 11.): výběr z kontaktů Karty zákazníka (hledá jméno i e-mail),
 * „Přidat kontakt …" ho do karty uloží. E-mail a telefon jdou s osobou — na zakázce jen ke čtení,
 * mění se v Kartě zákazníka.
 */
export function JobContactPicker({ job }: { job: JobDetail }) {
  const { save } = useJobDetail();
  const cd = job.customerDetail;
  const contacts = React.useMemo(() => cd?.contacts ?? [], [cd?.contacts]);
  const options = React.useMemo<SearchOption[]>(
    () => contacts.map((k) => ({ value: k.id, label: k.name, sub: contactOptionSub(k) })),
    [contacts],
  );
  const linked = Boolean(job.customerContactId);
  const legacy = !linked && Boolean(job.customerContact || job.customerContactEmail || job.customerContactPhone);
  const email = job.customerContactEmail;
  const phone = job.customerContactPhone;

  return (
    <div className="grid gap-3" data-testid="job-contact">
      {cd ? (
        <SearchSelect
          label="Kontaktní osoba"
          icon={UserRound}
          iconClass="text-sky-500"
          value={job.customerContactId}
          valueLabel={job.customerContact}
          options={options}
          emptyLabel={contacts.length ? "Vyber z kontaktů zákazníka" : "Přidat kontakt do karty zákazníka"}
          placeholder="Hledej jméno nebo e-mail…"
          createLabel="Přidat kontakt"
          onSave={(id) => save({ customerContactId: id })}
          onCreate={(text) => save({ newCustomerContact: newContactFromText(text) })}
        />
      ) : (
        <div className="min-w-0" data-field="contact-disabled">
          <div className="mb-0.5 flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
            <UserRound className="h-3.5 w-3.5 text-sky-500" aria-hidden /> Kontaktní osoba
          </div>
          <p className="text-sm text-muted-foreground">Nejdřív vyber zákazníka</p>
        </div>
      )}

      {legacy && (
        <div className="-mt-1 flex items-start gap-1.5 rounded-lg bg-amber-50 px-2.5 py-1.5 text-xs text-amber-900 dark:bg-amber-500/10 dark:text-amber-200" data-testid="contact-legacy">
          <AlertTriangle className="mt-px h-3.5 w-3.5 shrink-0" aria-hidden />
          <span className="min-w-0 break-words">
            {job.customerContact && <strong className="font-semibold">{job.customerContact} </strong>}
            Není v kartě zákazníka — vyber kontakt nebo ho přidej.
          </span>
        </div>
      )}

      <div className="grid gap-3 sm:grid-cols-2 md:grid-cols-1 lg:grid-cols-2">
        <ReadOnlyValue label="E-mail" icon={Mail} field="contact-email">
          {email ? <span className="break-all text-sky-700 dark:text-sky-400">{email}</span> : <span className="text-muted-foreground">—</span>}
        </ReadOnlyValue>
        <ReadOnlyValue label="Telefon" icon={Phone} field="contact-phone">
          {phone ? <span className="tabular-nums">{phone}</span> : <span className="text-muted-foreground">—</span>}
        </ReadOnlyValue>
      </div>

      <div className="flex flex-wrap items-center gap-2 text-xs">
        {email && (
          <a href={`mailto:${email}`} className="inline-flex items-center gap-1 rounded-full bg-sky-100 px-2 py-0.5 font-medium text-sky-800 hover:brightness-95 dark:bg-sky-500/15 dark:text-sky-300">
            <Mail className="h-3 w-3" /> Napsat
          </a>
        )}
        {phone && (
          <a href={`tel:${phone.replace(/\s+/g, "")}`} className="inline-flex items-center gap-1 rounded-full bg-green-100 px-2 py-0.5 font-medium text-green-800 hover:brightness-95 dark:bg-green-500/15 dark:text-green-300">
            <Phone className="h-3 w-3" /> Zavolat
          </a>
        )}
        {cd && (
          <Link
            href={`/customers/${cd.id}#kontakty`}
            className="ml-auto inline-flex items-center gap-1 text-[11px] font-medium text-muted-foreground hover:text-foreground hover:underline"
            data-testid="contact-edit-link"
          >
            Upravit v Kartě zákazníka <ExternalLink className="h-3 w-3" aria-hidden />
          </Link>
        )}
      </div>
    </div>
  );
}
