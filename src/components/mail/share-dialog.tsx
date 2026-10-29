"use client";

import * as React from "react";
import { Check, Loader2, Share2, X } from "lucide-react";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { shareCandidatesAction, shareThreadAction, type ShareCandidate } from "@/app/actions/mail-inbox";
import { ROLE_LABELS } from "@/lib/auth/permissions";
import { cn } from "@/lib/utils";

/**
 * „Předat kolegovi": vyber jednoho či více kolegů + krátká poznámka. Kolega uvidí celé vlákno ve
 * své Přijaté poště („Od <kdo>: poznámka") s odznakem nepřečtených.
 */
export function ShareDialog({ threadId, subject, open, onClose, onShared }: {
  threadId: string;
  subject: string;
  open: boolean;
  onClose: () => void;
  onShared: (n: number) => void;
}) {
  const [users, setUsers] = React.useState<ShareCandidate[] | null>(null);
  const [picked, setPicked] = React.useState<string[]>([]);
  const [note, setNote] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    if (!open) return;
    setPicked([]);
    setNote("");
    setError(null);
    void shareCandidatesAction().then((r) => (r.ok ? setUsers(r.users ?? []) : setError(r.error ?? "Kolegy se nepodařilo načíst.")));
  }, [open]);

  const toggle = (id: string) => setPicked((p) => (p.includes(id) ? p.filter((x) => x !== id) : [...p, id]));
  const submit = async () => {
    setBusy(true);
    setError(null);
    const r = await shareThreadAction(threadId, picked, note);
    setBusy(false);
    if (!r.ok) return setError(r.error ?? "Předání se nepodařilo.");
    onShared(r.shared ?? picked.length);
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !o && !busy && onClose()}>
      <DialogContent hideClose className="max-w-md" data-testid="share-dialog">
        <div className="flex items-center gap-2 border-b px-4 py-3">
          <Share2 className="h-4 w-4 text-primary" />
          <DialogTitle className="flex-1">Předat kolegovi</DialogTitle>
          <Button size="icon-sm" variant="ghost" onClick={onClose} aria-label="Zavřít"><X className="h-4 w-4" /></Button>
        </div>
        <div className="space-y-3 px-4 py-3">
          <p className="truncate text-sm text-muted-foreground">„{subject || "(bez předmětu)"}“</p>
          <div className="max-h-56 space-y-1 overflow-y-auto" role="group" aria-label="Kolegové">
            {users === null ? (
              <p className="flex items-center gap-2 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" /> Načítám kolegy…</p>
            ) : users.length === 0 ? (
              <p className="text-sm text-muted-foreground">Žádní další kolegové.</p>
            ) : (
              users.map((u) => {
                const on = picked.includes(u.id);
                return (
                  <button
                    key={u.id}
                    type="button"
                    onClick={() => toggle(u.id)}
                    aria-pressed={on}
                    className={cn("flex min-h-11 w-full items-center gap-2 rounded-lg border px-3 py-2 text-left text-sm transition-colors", on ? "border-primary bg-primary/5" : "hover:bg-accent")}
                    data-testid={`share-user-${u.email}`}
                  >
                    <span className={cn("flex h-5 w-5 shrink-0 items-center justify-center rounded border", on ? "border-primary bg-primary text-primary-foreground" : "border-border")}>
                      {on && <Check className="h-3.5 w-3.5" />}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate font-medium">{u.name}</span>
                      <span className="block truncate text-xs text-muted-foreground">{u.email} · {ROLE_LABELS[u.role as keyof typeof ROLE_LABELS] ?? u.role}</span>
                    </span>
                  </button>
                );
              })
            )}
          </div>
          <Textarea value={note} onChange={(e) => setNote(e.target.value)} rows={3} maxLength={1000} placeholder="Krátká poznámka (např. „Prosím nacenit do pátku“)" aria-label="Poznámka pro kolegu" />
          {error && <p className="text-sm text-destructive" role="alert">{error}</p>}
        </div>
        <div className="flex justify-end gap-2 border-t px-4 py-3">
          <Button variant="ghost" onClick={onClose} disabled={busy}>Zrušit</Button>
          <Button variant="success" onClick={submit} disabled={busy || !picked.length} data-testid="share-submit">
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Share2 className="h-4 w-4" />} Předat{picked.length > 1 ? ` (${picked.length})` : ""}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
