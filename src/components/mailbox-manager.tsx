"use client";

import * as React from "react";
import { Plus, Trash2, Mail, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { addMailbox, deleteMailbox } from "@/app/actions/integrations";
import type { Mailbox, MailboxProvider } from "@/lib/supabase/database.types";
import { useRouter } from "next/navigation";

const PROVIDERS: { value: MailboxProvider; label: string }[] = [
  { value: "imap", label: "IMAP (hosting90)" },
  { value: "outlook", label: "Microsoft 365 / Outlook" },
  { value: "gmail", label: "Gmail" },
];

export function MailboxManager({ mailboxes }: { mailboxes: Mailbox[] }) {
  const router = useRouter();
  const [provider, setProvider] = React.useState<MailboxProvider>("imap");
  const [email, setEmail] = React.useState("");
  const [name, setName] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  const add = async () => {
    setBusy(true);
    setError(null);
    const res = await addMailbox(provider, email, name);
    if (res.ok) {
      setEmail("");
      setName("");
      router.refresh();
    } else {
      setError(res.error ?? "Chyba");
    }
    setBusy(false);
  };

  const remove = async (id: string) => {
    setBusy(true);
    await deleteMailbox(id);
    router.refresh();
    setBusy(false);
  };

  return (
    <div className="space-y-4">
      <div className="space-y-2">
        {mailboxes.length === 0 && (
          <p className="text-sm text-muted-foreground">Zatím žádná schránka. Přidej první níže.</p>
        )}
        {mailboxes.map((m) => (
          <div key={m.id} className="flex items-center gap-3 rounded-lg border p-3">
            <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-muted">
              <Mail className="h-4 w-4 text-muted-foreground" />
            </div>
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2 text-sm font-medium">
                {m.email}
                <Badge variant="secondary">{m.provider}</Badge>
                {m.active && <Badge variant="success">aktivní</Badge>}
              </div>
              {m.display_name && <div className="text-xs text-muted-foreground">{m.display_name}</div>}
            </div>
            <Button variant="ghost" size="icon-sm" onClick={() => remove(m.id)} disabled={busy} aria-label="Odebrat schránku">
              <Trash2 className="h-4 w-4" />
            </Button>
          </div>
        ))}
      </div>

      <div className="space-y-2 rounded-lg border border-dashed p-3">
        <div className="text-sm font-medium">Přidat schránku</div>
        <div className="grid gap-2 sm:grid-cols-3">
          <select
            value={provider}
            onChange={(e) => setProvider(e.target.value as MailboxProvider)}
            className="h-9 rounded-md border border-input bg-background px-3 text-sm"
          >
            {PROVIDERS.map((p) => (
              <option key={p.value} value={p.value}>{p.label}</option>
            ))}
          </select>
          <Input value={email} onChange={(e) => setEmail(e.target.value)} placeholder="adresa@mnastrojarna.cz" type="email" />
          <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Popis (volitelné)" />
        </div>
        <div className="flex items-center gap-3">
          <Button size="sm" onClick={add} disabled={busy}>
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />} Přidat
          </Button>
          {error && <span className="text-sm text-destructive">{error}</span>}
        </div>
        <p className="text-xs text-muted-foreground">
          Přihlašovací údaje (IMAP heslo / Graph tajemství) se zadávají výše v sekci API klíče a integrace.
        </p>
      </div>
    </div>
  );
}
