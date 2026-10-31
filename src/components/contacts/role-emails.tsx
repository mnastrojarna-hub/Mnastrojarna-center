"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { AlertTriangle, Check, Loader2, Plus, Sparkles, Star, Trash2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { EmailSuggestInput, type RecipientContext } from "@/components/mail/recipient-field";
import { deleteRoleEmailAction, saveRoleEmailAction, setRoleDefaultAction } from "@/app/actions/contacts";
import {
  CONTACTS_SCHEMA_MISSING, ROLES_FOR, ROLE_TEXT,
  type BookContact, type ContactRole, type PartyKind, type RoleEntry,
} from "@/lib/contacts/roles";
import { cn } from "@/lib/utils";

const ROLE_TONE: Record<ContactRole, string> = {
  fakturace: "bg-amber-100 text-amber-800 dark:bg-amber-500/15 dark:text-amber-300",
  dodaci_listy: "bg-emerald-100 text-emerald-800 dark:bg-emerald-500/15 dark:text-emerald-300",
  nabidky: "bg-violet-100 text-violet-800 dark:bg-violet-500/15 dark:text-violet-300",
  nakup: "bg-sky-100 text-sky-800 dark:bg-sky-500/15 dark:text-sky-300",
  komunikace: "bg-slate-100 text-slate-700 dark:bg-slate-500/15 dark:text-slate-300",
};

/** Co se použije, když účel nemá vlastní adresu (stejně jako pickRecipients). */
function fallbackText(kind: PartyKind, role: ContactRole, partyEmail?: string | null): string {
  if (role === "komunikace") return partyEmail ? `e-mail firmy (${partyEmail})` : "hlavní kontakt";
  if (role === "dodaci_listy") return `„${ROLE_TEXT[kind].nakup.label}“, kontakt zakázky nebo běžná komunikace`;
  return "kontakt zakázky nebo běžná komunikace";
}

export interface RoleEmailsViewProps {
  kind: PartyKind;
  roles: RoleEntry[];
  /** Osoby k výběru (s e-mailem). */
  contacts: BookContact[];
  partyEmail?: string | null;
  /** Našeptávač adres (adresy firmy nahoře); u nové firmy null. */
  suggestContext?: RecipientContext | null;
  /** true = přidáno (formulář přidání se zavře / zůstane pro další osobu). */
  onAdd: (role: ContactRole, input: { contactId?: string; email?: string }) => Promise<boolean> | boolean;
  onRemove: (entry: RoleEntry) => void;
  onSetDefault: (entry: RoleEntry) => void;
  busy?: string | null;
  error?: string | null;
  schemaMissing?: boolean;
}

/**
 * „Kam posílat": e-maily zákazníka / dodavatele podle účelu (Faktury, Dodací listy, Nabídky, Objednávky / potvrzení,
 * Běžná komunikace). Každý účel = víc adres (kontaktní osoba nebo samotná adresa), jedna výchozí (★) jde do Komu,
 * ostatní do Kopie. Odesílání dokladů je opravdu používá (faktura → Faktury, DL → Dodací listy, nabídka → Nabídky…).
 * Čisté zobrazení — ukládá karta zákazníka hned (RoleEmailsEditor), dialog firmy až tlačítkem (PartyBookEditor).
 */
export function RoleEmailsView({
  kind, roles, contacts, partyEmail, suggestContext = null, onAdd, onRemove, onSetDefault, busy = null, error = null, schemaMissing = false,
}: RoleEmailsViewProps) {
  const [adding, setAdding] = React.useState<ContactRole | null>(null);
  const text = ROLE_TEXT[kind];
  if (schemaMissing) {
    return (
      <p className="flex items-start gap-2 rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-900 dark:bg-amber-500/10 dark:text-amber-200" data-testid="role-emails-missing">
        <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" /> {CONTACTS_SCHEMA_MISSING}
      </p>
    );
  }
  return (
    <div className="space-y-2.5" data-testid="role-emails">
      {error && <p className="rounded-lg bg-destructive/10 px-3 py-2 text-sm text-destructive" role="alert">{error}</p>}
      {ROLES_FOR[kind].map((role) => {
        const list = roles.filter((r) => r.role === role).sort((a, b) => Number(b.isDefault) - Number(a.isDefault));
        const pickable = contacts.filter((c) => c.email && !list.some((r) => r.contactId === c.id || r.email === c.email));
        return (
          <div key={role} className="rounded-xl border bg-card p-2.5" data-testid={`role-${role}`}>
            <div className="flex items-center gap-2">
              <span className={cn("shrink-0 rounded-md px-2 py-0.5 text-xs font-semibold", ROLE_TONE[role])}>{text[role].label}</span>
              <span className="min-w-0 flex-1 truncate text-[11px] text-muted-foreground">{text[role].hint}</span>
              {adding !== role && (
                <Button type="button" variant="ghost" size="icon-sm" onClick={() => setAdding(role)} aria-label={`Přidat e-mail: ${text[role].label}`} title="Přidat">
                  <Plus />
                </Button>
              )}
            </div>
            {list.length === 0 && adding !== role && (
              <p className="mt-1 text-[11px] italic text-muted-foreground">Nenastaveno — použije se {fallbackText(kind, role, partyEmail)}.</p>
            )}
            {list.length > 0 && (
              <ul className="mt-1.5 space-y-1">
                {list.map((r) => (
                  <li key={r.id} className="flex items-center gap-1.5 text-sm" data-testid="role-entry" data-email={r.email ?? ""}>
                    <button
                      type="button"
                      onClick={() => !r.isDefault && onSetDefault(r)}
                      className={cn("shrink-0 rounded p-0.5", r.isDefault ? "text-amber-500" : "text-muted-foreground/50 hover:text-amber-500")}
                      aria-label={r.isDefault ? "Výchozí adresa" : "Nastavit jako výchozí"}
                      title={r.isDefault ? "Výchozí — jde do Komu" : "Nastavit jako výchozí (ostatní jdou do kopie)"}
                    >
                      <Star className={cn("h-3.5 w-3.5", r.isDefault && "fill-current")} />
                    </button>
                    <span className="min-w-0 flex-1 truncate">
                      {r.contactName && <b className="font-medium">{r.contactName} </b>}
                      <span className={r.contactName ? "text-muted-foreground" : ""}>{r.email ?? <i className="text-amber-700 dark:text-amber-400">bez e-mailu</i>}</span>
                    </span>
                    {r.source === "ai" && (
                      <span className="inline-flex shrink-0 items-center gap-0.5 rounded-full bg-violet-100 px-1.5 text-[10px] font-medium text-violet-800 dark:bg-violet-500/15 dark:text-violet-300" title="Našla AI v poště / dokladu">
                        <Sparkles className="h-2.5 w-2.5" /> AI
                      </span>
                    )}
                    <Button
                      type="button" variant="ghost" size="icon-sm" className="shrink-0 text-muted-foreground hover:text-destructive"
                      disabled={busy === `x-${r.id}`}
                      onClick={() => onRemove(r)}
                      aria-label={`Odebrat ${r.email ?? r.contactName ?? ""} z ${text[role].label}`}
                    >
                      {busy === `x-${r.id}` ? <Loader2 className="animate-spin" /> : <Trash2 />}
                    </Button>
                  </li>
                ))}
              </ul>
            )}
            {adding === role && (
              <AddRoleEmail
                kind={kind}
                role={role}
                contacts={pickable}
                suggestContext={suggestContext}
                onCancel={() => setAdding(null)}
                onSave={async (input) => {
                  const ok = await onAdd(role, input);
                  // vybraná osoba → formulář zůstane pro další (víc osob v účelu), adresa nebo poslední osoba → zavřít
                  if (ok && (input.email || pickable.length <= 1)) setAdding(null);
                  return ok;
                }}
                busy={busy === `a-${role}`}
              />
            )}
          </div>
        );
      })}
    </div>
  );
}

/** Karta zákazníka: účely se ukládají hned (každá změna = akce). */
export function RoleEmailsEditor({
  kind, partyId, roles, contacts, partyEmail, onChanged, schemaMissing,
}: {
  kind: PartyKind;
  partyId: string;
  roles: RoleEntry[];
  contacts: BookContact[];
  partyEmail?: string | null;
  /** Po změně; jinak router.refresh(). */
  onChanged?: () => void;
  schemaMissing?: boolean;
}) {
  const router = useRouter();
  const [busy, setBusy] = React.useState<string | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const refresh = () => (onChanged ? onChanged() : router.refresh());

  async function run(key: string, fn: () => Promise<{ ok: boolean; error?: string }>) {
    setBusy(key);
    setError(null);
    const res = await fn().catch(() => ({ ok: false, error: "Spojení se nepovedlo." }));
    setBusy(null);
    if (!res.ok) setError(res.error ?? "Nepovedlo se.");
    else refresh();
    return res.ok;
  }

  return (
    <RoleEmailsView
      kind={kind}
      roles={roles}
      contacts={contacts}
      partyEmail={partyEmail}
      suggestContext={kind === "customer" ? { customerId: partyId } : { supplierId: partyId }}
      busy={busy}
      error={error}
      schemaMissing={schemaMissing}
      onAdd={(role, input) => run(`a-${role}`, () => saveRoleEmailAction({ kind, partyId, role, ...input }))}
      onRemove={(r) => void run(`x-${r.id}`, () => deleteRoleEmailAction(kind, r.id))}
      onSetDefault={(r) => void run(`d-${r.id}`, () => setRoleDefaultAction(kind, r.id))}
    />
  );
}

function AddRoleEmail({
  kind, role, contacts, suggestContext, onCancel, onSave, busy,
}: {
  kind: PartyKind;
  role: ContactRole;
  contacts: BookContact[];
  suggestContext: RecipientContext | null;
  onCancel: () => void;
  onSave: (input: { contactId?: string; email?: string }) => Promise<boolean>;
  busy: boolean;
}) {
  const [email, setEmail] = React.useState("");
  const id = `role-add-${role}`;
  const save = async (input: { contactId?: string; email?: string }) => {
    const ok = await onSave(input);
    if (ok && input.email) setEmail("");
  };
  return (
    <div className="mt-2 space-y-2 rounded-lg bg-muted/40 p-2">
      {contacts.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {contacts.map((c) => (
            <button
              key={c.id}
              type="button"
              disabled={busy}
              onClick={() => void save({ contactId: c.id })}
              className="inline-flex min-h-8 max-w-full items-center gap-1 rounded-full border bg-background px-2.5 text-xs hover:bg-accent"
              data-testid="role-add-contact"
            >
              <Plus className="h-3 w-3 shrink-0" /> <span className="truncate">{c.name}{c.position ? ` · ${c.position}` : ""}</span>
            </button>
          ))}
        </div>
      )}
      <div
        className="flex gap-1.5"
        onKeyDown={(e) => {
          // Enter = Přidat (a nikdy neodešle okolní formulář, např. dialog firmy)
          if (e.key !== "Enter") return;
          if (!e.defaultPrevented && email.trim()) void save({ email });
          e.preventDefault();
        }}
      >
        <div className="min-w-0 flex-1">
          <EmailSuggestInput
            id={id}
            value={email}
            onChange={setEmail}
            context={suggestContext}
            placeholder={contacts.length ? "nebo napiš jinou adresu" : "napiš e-mail"}
            aria-label={`Nový e-mail: ${ROLE_TEXT[kind][role].label}`}
          />
        </div>
        <Button type="button" size="sm" variant="success" disabled={busy || !email.trim()} onClick={() => void save({ email })}>
          {busy ? <Loader2 className="animate-spin" /> : <Check />} Přidat
        </Button>
        <Button type="button" size="icon-sm" variant="ghost" onClick={onCancel} aria-label="Zrušit" className="h-9 w-9 shrink-0">
          <X />
        </Button>
      </div>
    </div>
  );
}
