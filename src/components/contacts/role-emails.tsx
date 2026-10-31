"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Check, Loader2, Plus, Sparkles, Star, Trash2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { EmailSuggestInput } from "@/components/mail/recipient-field";
import { deleteRoleEmailAction, saveRoleEmailAction, setRoleDefaultAction } from "@/app/actions/contacts";
import { CONTACT_ROLES, ROLE_TEXT, type BookContact, type ContactRole, type PartyKind, type RoleEntry } from "@/lib/contacts/roles";
import { cn } from "@/lib/utils";

const ROLE_TONE: Record<ContactRole, string> = {
  nabidky: "bg-violet-100 text-violet-800 dark:bg-violet-500/15 dark:text-violet-300",
  nakup: "bg-sky-100 text-sky-800 dark:bg-sky-500/15 dark:text-sky-300",
  fakturace: "bg-amber-100 text-amber-800 dark:bg-amber-500/15 dark:text-amber-300",
  komunikace: "bg-slate-100 text-slate-700 dark:bg-slate-500/15 dark:text-slate-300",
};

/**
 * „Kam co posílat": e-maily zákazníka / dodavatele podle účelu (Fakturace, Nákup, Nabídky, Běžná komunikace).
 * Každý účel = víc adres (kontaktní osoba nebo samotná adresa), jedna výchozí (★). Odesílání dokladů je
 * opravdu používá (faktura → Fakturace, nabídka → Nabídky, potvrzení / DL → Nákup…).
 */
export function RoleEmailsEditor({
  kind, partyId, roles, contacts, partyEmail, onChanged,
}: {
  kind: PartyKind;
  partyId: string;
  roles: RoleEntry[];
  contacts: BookContact[];
  partyEmail?: string | null;
  /** Po změně (karta dodavatele je dialog — obnoví si data sama); jinak router.refresh(). */
  onChanged?: () => void;
}) {
  const router = useRouter();
  const [adding, setAdding] = React.useState<ContactRole | null>(null);
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

  const text = ROLE_TEXT[kind];
  return (
    <div className="space-y-2.5" data-testid="role-emails">
      {error && <p className="rounded-lg bg-destructive/10 px-3 py-2 text-sm text-destructive">{error}</p>}
      {CONTACT_ROLES.map((role) => {
        const list = roles.filter((r) => r.role === role).sort((a, b) => Number(b.isDefault) - Number(a.isDefault));
        return (
          <div key={role} className="rounded-xl border bg-card p-2.5" data-testid={`role-${role}`}>
            <div className="flex items-center gap-2">
              <span className={cn("rounded-md px-2 py-0.5 text-xs font-semibold", ROLE_TONE[role])}>{text[role].label}</span>
              <span className="min-w-0 flex-1 truncate text-[11px] text-muted-foreground">{text[role].hint}</span>
              {adding !== role && (
                <Button type="button" variant="ghost" size="icon-sm" onClick={() => setAdding(role)} aria-label={`Přidat e-mail: ${text[role].label}`} title="Přidat">
                  <Plus />
                </Button>
              )}
            </div>
            {list.length === 0 && adding !== role && (
              <p className="mt-1 text-[11px] text-muted-foreground">
                Nenastaveno — použije se {role === "komunikace" ? (partyEmail ? `e-mail firmy (${partyEmail})` : "hlavní kontakt") : "kontakt zakázky nebo běžná komunikace"}.
              </p>
            )}
            {list.length > 0 && (
              <ul className="mt-1.5 space-y-1">
                {list.map((r) => (
                  <li key={r.id} className="flex items-center gap-1.5 text-sm" data-testid="role-entry" data-email={r.email ?? ""}>
                    <button
                      type="button"
                      onClick={() => !r.isDefault && void run(`d-${r.id}`, () => setRoleDefaultAction(kind, r.id))}
                      className={cn("shrink-0 rounded p-0.5", r.isDefault ? "text-amber-500" : "text-muted-foreground/50 hover:text-amber-500")}
                      aria-label={r.isDefault ? "Výchozí adresa" : "Nastavit jako výchozí"}
                      title={r.isDefault ? "Výchozí — jde do Komu" : "Nastavit jako výchozí (ostatní jdou do kopie)"}
                    >
                      <Star className={cn("h-3.5 w-3.5", r.isDefault && "fill-current")} />
                    </button>
                    <span className="min-w-0 flex-1 truncate">
                      {r.contactName && <b className="font-medium">{r.contactName} </b>}
                      <span className={r.contactName ? "text-muted-foreground" : ""}>{r.email ?? "bez e-mailu"}</span>
                    </span>
                    {r.source === "ai" && (
                      <span className="inline-flex shrink-0 items-center gap-0.5 rounded-full bg-violet-100 px-1.5 text-[10px] font-medium text-violet-800 dark:bg-violet-500/15 dark:text-violet-300" title="Našla AI v poště / dokladu">
                        <Sparkles className="h-2.5 w-2.5" /> AI
                      </span>
                    )}
                    <Button
                      type="button" variant="ghost" size="icon-sm" className="shrink-0 text-muted-foreground hover:text-destructive"
                      disabled={busy === `x-${r.id}`}
                      onClick={() => void run(`x-${r.id}`, () => deleteRoleEmailAction(kind, r.id))}
                      aria-label={`Odebrat ${r.email ?? ""} z ${text[role].label}`}
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
                partyId={partyId}
                role={role}
                contacts={contacts.filter((c) => c.email && !list.some((r) => r.contactId === c.id))}
                onCancel={() => setAdding(null)}
                onSave={async (input) => {
                  const ok = await run(`a-${role}`, () => saveRoleEmailAction({ kind, partyId, role, ...input }));
                  if (ok) setAdding(null);
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

function AddRoleEmail({
  kind, partyId, role, contacts, onCancel, onSave, busy,
}: {
  kind: PartyKind;
  partyId: string;
  role: ContactRole;
  contacts: BookContact[];
  onCancel: () => void;
  onSave: (input: { contactId?: string; email?: string; isDefault?: boolean }) => void;
  busy: boolean;
}) {
  const [email, setEmail] = React.useState("");
  const id = `role-add-${role}`;
  return (
    <div className="mt-2 space-y-2 rounded-lg bg-muted/40 p-2">
      {contacts.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {contacts.map((c) => (
            <button
              key={c.id}
              type="button"
              disabled={busy}
              onClick={() => onSave({ contactId: c.id })}
              className="inline-flex min-h-8 items-center gap-1 rounded-full border bg-background px-2.5 text-xs hover:bg-accent"
              data-testid="role-add-contact"
            >
              <Plus className="h-3 w-3" /> {c.name}{c.position ? ` · ${c.position}` : ""}
            </button>
          ))}
        </div>
      )}
      <div
        className="flex gap-1.5"
        onKeyDown={(e) => {
          // Enter = Přidat (a nikdy neodešle okolní formulář, např. kartu dodavatele)
          if (e.key !== "Enter") return;
          if (!e.defaultPrevented && email.trim()) onSave({ email });
          e.preventDefault();
        }}
      >
        <div className="min-w-0 flex-1">
          <EmailSuggestInput
            id={id}
            value={email}
            onChange={setEmail}
            context={kind === "customer" ? { customerId: partyId } : { supplierId: partyId }}
            placeholder={role === "fakturace" ? "fakturace@firma.cz" : "adresa@firma.cz"}
            aria-label={`Nový e-mail: ${ROLE_TEXT[kind][role].label}`}
          />
        </div>
        <Button type="button" size="sm" variant="success" disabled={busy || !email.trim()} onClick={() => onSave({ email })}>
          {busy ? <Loader2 className="animate-spin" /> : <Check />} Přidat
        </Button>
        <Button type="button" size="icon-sm" variant="ghost" onClick={onCancel} aria-label="Zrušit" className="h-9 w-9">
          <X />
        </Button>
      </div>
    </div>
  );
}
