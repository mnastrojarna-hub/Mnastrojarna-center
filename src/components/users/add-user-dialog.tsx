"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { AlertCircle, CheckCircle2, Loader2, Sparkles, UserPlus, Mail } from "lucide-react";
import { Dialog, DialogContent, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { createUser } from "@/app/actions/users";
import { RolePicker } from "@/components/users/role-picker";
import { PasswordField, CopyButton } from "@/components/users/password-field";
import { initialPasswordProblem } from "@/components/users/password-tools";
import type { MailboxOption } from "@/components/users/types";
import type { UserRole } from "@/lib/supabase/database.types";

export const SELECT_CLASS =
  "flex h-9 w-full rounded-md border border-input bg-background px-3 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50";

interface FormState {
  fullName: string;
  email: string;
  password: string;
  role: UserRole;
  phone: string;
  position: string;
  commission: string;
  aiAccess: boolean;
  mailboxId: string;
  sendWelcome: boolean;
}

const EMPTY: FormState = {
  fullName: "",
  email: "",
  password: "",
  role: "obchodnik",
  phone: "",
  position: "",
  commission: "8",
  aiAccess: false,
  mailboxId: "",
  sendWelcome: true,
};

export function mailboxLabel(m: MailboxOption, owners: Map<string, string>): string {
  const owner = m.ownerId ? owners.get(m.ownerId) : null;
  return `${m.displayName ? `${m.displayName} · ` : ""}${m.email}${owner ? ` (má ${owner})` : ""}${m.active ? "" : " — neaktivní"}`;
}

/** „Přidat uživatele" — e-mail + heslo, role, kontakty, provize, AI a schránka. */
export function AddUserDialog({
  mailboxes,
  owners,
  disabled,
}: {
  mailboxes: MailboxOption[];
  /** id → jméno vlastníka schránky (pro popisky). */
  owners: Record<string, string>;
  disabled?: boolean;
}) {
  const router = useRouter();
  const [open, setOpen] = React.useState(false);
  const [form, setForm] = React.useState<FormState>(EMPTY);
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [created, setCreated] = React.useState<{ email: string; password: string; welcomeSent: boolean; warnings: string[] } | null>(null);
  const ownerMap = React.useMemo(() => new Map(Object.entries(owners)), [owners]);

  const set = <K extends keyof FormState>(key: K, value: FormState[K]) => setForm((f) => ({ ...f, [key]: value }));

  const reset = () => {
    setForm(EMPTY);
    setError(null);
    setCreated(null);
    setBusy(false);
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (!form.fullName.trim()) return setError("Vyplň jméno a příjmení.");
    if (!form.email.trim()) return setError("Vyplň e-mail.");
    const pw = initialPasswordProblem(form.password);
    if (pw) return setError(pw);

    setBusy(true);
    try {
      const res = await createUser({
        email: form.email,
        password: form.password,
        fullName: form.fullName,
        role: form.role,
        phone: form.phone,
        position: form.position,
        commissionRate: form.role === "obchodnik" ? form.commission : 0,
        aiAccess: form.role === "super_admin" ? false : form.aiAccess,
        mailboxId: form.mailboxId || null,
        sendWelcome: form.sendWelcome,
      });
      if (!res.ok) {
        setError(res.error ?? "Účet se nepodařilo založit.");
        return;
      }
      setCreated({
        email: form.email.trim().toLowerCase(),
        password: form.password,
        welcomeSent: Boolean(res.welcomeSent),
        warnings: res.warnings ?? [],
      });
      router.refresh();
    } catch {
      setError("Spojení se nepovedlo — zkus to znovu.");
    } finally {
      setBusy(false);
    }
  };

  const loginUrl = typeof window !== "undefined" ? `${window.location.origin}/login` : "/login";

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        setOpen(o);
        if (!o) reset();
      }}
    >
      <DialogTrigger asChild>
        <Button variant="success" disabled={disabled}>
          <UserPlus className="h-4 w-4" /> Přidat uživatele
        </Button>
      </DialogTrigger>
      <DialogContent
        aria-describedby={undefined}
        className="top-[4%] max-h-[92vh] w-[calc(100%-1.5rem)] overflow-y-auto sm:top-[6%] sm:max-w-xl"
      >
        <div className="sticky top-0 z-10 flex items-center gap-3 border-b bg-popover/95 px-5 py-4 backdrop-blur">
          <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-success/15 text-success">
            <UserPlus className="h-5 w-5" />
          </span>
          <div>
            <DialogTitle>{created ? "Účet je připraven" : "Přidat uživatele"}</DialogTitle>
            <p className="text-xs text-muted-foreground">
              {created ? "Uživatel se může hned přihlásit." : "Uživatel se přihlásí e-mailem a heslem."}
            </p>
          </div>
        </div>

        {created ? (
          <div className="space-y-4 p-5">
            <div className="flex items-start gap-3 rounded-lg border border-success/25 bg-success/10 p-3 text-sm">
              <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-success" />
              <div>
                Účet <strong>{created.email}</strong> je aktivní.
                {created.welcomeSent && <> Přihlašovací e-mail odešel.</>}
              </div>
            </div>
            {created.warnings.map((w) => (
              <div key={w} className="flex items-start gap-2 rounded-lg border border-warning/30 bg-warning/10 p-3 text-sm">
                <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-warning" />
                <span>{w}</span>
              </div>
            ))}
            <div className="space-y-2 rounded-lg border bg-muted/40 p-3 font-mono text-sm">
              <div><span className="text-muted-foreground">Přihlášení: </span>{loginUrl}</div>
              <div><span className="text-muted-foreground">E-mail: </span>{created.email}</div>
              <div><span className="text-muted-foreground">Heslo: </span>{created.password}</div>
            </div>
            <div className="flex flex-wrap justify-between gap-2">
              <CopyButton
                label="Zkopírovat přihlašovací údaje"
                text={`Přihlášení: ${loginUrl}\nE-mail: ${created.email}\nHeslo: ${created.password}`}
              />
              <div className="flex gap-2">
                <Button type="button" variant="outline" onClick={reset}>
                  Přidat dalšího
                </Button>
                <Button type="button" onClick={() => setOpen(false)}>
                  Hotovo
                </Button>
              </div>
            </div>
          </div>
        ) : (
          <form onSubmit={submit} className="space-y-5 p-5" noValidate>
            {error && (
              <div role="alert" className="flex items-start gap-2 rounded-lg border border-destructive/25 bg-destructive/10 p-3 text-sm text-destructive">
                <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
                <span>{error}</span>
              </div>
            )}

            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1.5 sm:col-span-2">
                <label htmlFor="nu-name" className="text-sm font-medium">Jméno a příjmení</label>
                <Input id="nu-name" value={form.fullName} onChange={(e) => set("fullName", e.target.value)} placeholder="jméno a příjmení" className="placeholder:italic" autoFocus />
              </div>
              <div className="space-y-1.5 sm:col-span-2">
                <label htmlFor="nu-email" className="text-sm font-medium">E-mail (přihlašovací jméno)</label>
                <Input
                  id="nu-email"
                  type="email"
                  inputMode="email"
                  autoCapitalize="none"
                  autoComplete="off"
                  value={form.email}
                  onChange={(e) => set("email", e.target.value)}
                  placeholder="pracovní e-mail kolegy"
                  className="placeholder:italic"
                />
              </div>
              <div className="space-y-1.5 sm:col-span-2">
                <label htmlFor="nu-password" className="text-sm font-medium">Heslo</label>
                <PasswordField id="nu-password" value={form.password} onChange={(v) => set("password", v)} />
              </div>
            </div>

            <div className="space-y-1.5">
              <div className="text-sm font-medium">Role</div>
              <RolePicker value={form.role} onChange={(r) => set("role", r)} name="nu-role" />
            </div>

            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1.5">
                <label htmlFor="nu-phone" className="text-sm font-medium">Telefon</label>
                <Input id="nu-phone" type="tel" inputMode="tel" value={form.phone} onChange={(e) => set("phone", e.target.value)} placeholder="telefon" className="placeholder:italic" />
              </div>
              <div className="space-y-1.5">
                <label htmlFor="nu-position" className="text-sm font-medium">Funkce</label>
                <Input id="nu-position" value={form.position} onChange={(e) => set("position", e.target.value)} placeholder="funkce (technolog, nákup, obchod…)" className="placeholder:italic" />
              </div>
              {form.role === "obchodnik" && (
                <div className="space-y-1.5">
                  <label htmlFor="nu-commission" className="text-sm font-medium">Provize (%)</label>
                  <Input
                    id="nu-commission"
                    inputMode="decimal"
                    value={form.commission}
                    onChange={(e) => set("commission", e.target.value)}
                    className="w-28 text-right"
                  />
                </div>
              )}
              <div className="space-y-1.5 sm:col-span-2">
                <p className="rounded-lg bg-blue-500/5 p-2.5 text-xs text-muted-foreground" data-testid="nu-mailbox-hint">
                  <b className="text-foreground">E-mailová schránka:</b> schránku si uživatel nastaví sám v Můj účet (e-mail + heslo).
                  Přiřadit existující schránku jde výjimečně u uživatele v seznamu.
                </p>
              </div>
            </div>

            <div className="space-y-2 rounded-lg border bg-muted/30 p-3">
              <label className="flex cursor-pointer items-start gap-3 text-sm">
                <input
                  type="checkbox"
                  className="mt-0.5 h-4 w-4 accent-primary"
                  checked={form.role === "super_admin" ? true : form.aiAccess}
                  disabled={form.role === "super_admin"}
                  onChange={(e) => set("aiAccess", e.target.checked)}
                />
                <span>
                  <span className="flex items-center gap-1.5 font-medium">
                    <Sparkles className="h-3.5 w-3.5 text-violet-500" /> Povolit AI čtení dokladů z fotky
                  </span>
                  <span className="block text-xs text-muted-foreground">
                    {form.role === "super_admin"
                      ? "Super admin má AI vždy."
                      : "Bez AI vyplňuje údaje ručně — a AI se z toho učí."}
                  </span>
                </span>
              </label>
              <label className="flex cursor-pointer items-start gap-3 text-sm">
                <input
                  type="checkbox"
                  className="mt-0.5 h-4 w-4 accent-primary"
                  checked={form.sendWelcome}
                  onChange={(e) => set("sendWelcome", e.target.checked)}
                />
                <span>
                  <span className="flex items-center gap-1.5 font-medium">
                    <Mail className="h-3.5 w-3.5 text-sky-500" /> Poslat uživateli přihlašovací e-mail
                  </span>
                  <span className="block text-xs text-muted-foreground">
                    Odkaz na přihlášení, e-mail a heslo. Odejde z firemní schránky.
                  </span>
                </span>
              </label>
            </div>

            <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
              <Button type="button" variant="ghost" onClick={() => setOpen(false)}>
                Zrušit
              </Button>
              <Button type="submit" variant="success" disabled={busy}>
                {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <UserPlus className="h-4 w-4" />}
                Vytvořit účet
              </Button>
            </div>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}
