"use client";

import * as React from "react";
import { AlertCircle, AlertTriangle, KeyRound, Loader2, Pencil, Trash2, UserX } from "lucide-react";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { updateUser, setUserPassword, deleteUser } from "@/app/actions/users";
import { RolePicker } from "@/components/users/role-picker";
import { PasswordField } from "@/components/users/password-field";
import { initialPasswordProblem } from "@/components/users/password-tools";
import { UserAvatar } from "@/components/users/user-avatar";
import type { ManagedUser } from "@/components/users/types";
import type { UserRole } from "@/lib/supabase/database.types";
import { cn } from "@/lib/utils";

type Notify = (tone: "success" | "error", text: string) => void;

function DialogHeader({
  icon: Icon,
  tone,
  title,
  user,
}: {
  icon: React.ComponentType<{ className?: string }>;
  tone: string;
  title: string;
  user: ManagedUser;
}) {
  return (
    <div className="flex items-center gap-3 border-b px-5 py-4">
      <span className={cn("flex h-9 w-9 items-center justify-center rounded-lg", tone)}>
        <Icon className="h-5 w-5" />
      </span>
      <div className="min-w-0">
        <DialogTitle>{title}</DialogTitle>
        <p className="truncate text-xs text-muted-foreground">{user.fullName} · {user.email}</p>
      </div>
    </div>
  );
}

function ErrorBox({ error }: { error: string | null }) {
  if (!error) return null;
  return (
    <div role="alert" className="flex items-start gap-2 rounded-lg border border-destructive/25 bg-destructive/10 p-3 text-sm text-destructive">
      <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
      <span>{error}</span>
    </div>
  );
}

// ── Upravit ─────────────────────────────────────────────────

export function EditUserDialog({
  user,
  isSelf,
  open,
  onOpenChange,
  notify,
  onSaved,
}: {
  user: ManagedUser;
  isSelf: boolean;
  open: boolean;
  onOpenChange: (o: boolean) => void;
  notify: Notify;
  onSaved: () => void;
}) {
  const [fullName, setFullName] = React.useState(user.fullName);
  const [phone, setPhone] = React.useState(user.phone ?? "");
  const [position, setPosition] = React.useState(user.position ?? "");
  const [role, setRole] = React.useState<UserRole>(user.role);
  const [commission, setCommission] = React.useState(String(user.commissionPercent).replace(".", ","));
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    if (!open) return;
    setFullName(user.fullName);
    setPhone(user.phone ?? "");
    setPosition(user.position ?? "");
    setRole(user.role);
    setCommission(String(user.commissionPercent).replace(".", ","));
    setError(null);
  }, [open, user]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (!fullName.trim()) return setError("Jméno nesmí být prázdné.");
    setBusy(true);
    try {
      const res = await updateUser(user.id, {
        fullName,
        phone,
        position,
        role: isSelf ? undefined : role,
        commissionRate: role === "obchodnik" || user.commissionPercent > 0 ? commission : undefined,
      });
      if (!res.ok) {
        setError(res.error ?? "Uložení se nepovedlo.");
        return;
      }
      notify("success", `Uživatel ${fullName.trim()} uložen.`);
      onOpenChange(false);
      onSaved();
    } catch {
      setError("Spojení se nepovedlo — zkus to znovu.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent aria-describedby={undefined} className="top-[4%] max-h-[92vh] w-[calc(100%-1.5rem)] overflow-y-auto sm:top-[8%] sm:max-w-xl">
        <DialogHeader icon={Pencil} tone="bg-sky-500/15 text-sky-600 dark:text-sky-400" title="Upravit uživatele" user={user} />
        <form onSubmit={submit} className="space-y-5 p-5" noValidate>
          <ErrorBox error={error} />
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5 sm:col-span-2">
              <label htmlFor={`eu-name-${user.id}`} className="text-sm font-medium">Jméno a příjmení</label>
              <Input id={`eu-name-${user.id}`} value={fullName} onChange={(e) => setFullName(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <label htmlFor={`eu-phone-${user.id}`} className="text-sm font-medium">Telefon</label>
              <Input id={`eu-phone-${user.id}`} type="tel" inputMode="tel" value={phone} onChange={(e) => setPhone(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <label htmlFor={`eu-position-${user.id}`} className="text-sm font-medium">Funkce</label>
              <Input id={`eu-position-${user.id}`} value={position} onChange={(e) => setPosition(e.target.value)} />
            </div>
          </div>

          <div className="space-y-1.5">
            <div className="text-sm font-medium">Role</div>
            <RolePicker value={role} onChange={setRole} disabled={isSelf} name={`eu-role-${user.id}`} />
            {isSelf && <p className="text-xs text-muted-foreground">Svou vlastní roli změnit nemůžeš.</p>}
          </div>

          {(role === "obchodnik" || user.commissionPercent > 0) && (
            <div className="space-y-1.5">
              <label htmlFor={`eu-commission-${user.id}`} className="text-sm font-medium">Provize (%)</label>
              <Input
                id={`eu-commission-${user.id}`}
                inputMode="decimal"
                value={commission}
                onChange={(e) => setCommission(e.target.value)}
                className="w-28 text-right"
              />
              <p className="text-xs text-muted-foreground">Používá se při výpočtu provizí z marže.</p>
            </div>
          )}

          <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>Zrušit</Button>
            <Button type="submit" variant="success" disabled={busy}>
              {busy && <Loader2 className="h-4 w-4 animate-spin" />} Uložit změny
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

// ── Nastavit nové heslo ─────────────────────────────────────

export function SetPasswordDialog({
  user,
  open,
  onOpenChange,
  notify,
}: {
  user: ManagedUser;
  open: boolean;
  onOpenChange: (o: boolean) => void;
  notify: Notify;
}) {
  const [password, setPassword] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    if (open) {
      setPassword("");
      setError(null);
    }
  }, [open]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const problem = initialPasswordProblem(password);
    if (problem) return setError(problem);
    setBusy(true);
    setError(null);
    try {
      const res = await setUserPassword(user.id, password);
      if (!res.ok) {
        setError(res.error ?? "Heslo se nepodařilo nastavit.");
        return;
      }
      notify("success", `Nové heslo pro ${user.fullName} je nastavené.`);
      onOpenChange(false);
    } catch {
      setError("Spojení se nepovedlo — zkus to znovu.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent aria-describedby={undefined} className="w-[calc(100%-1.5rem)] sm:max-w-md">
        <DialogHeader icon={KeyRound} tone="bg-amber-500/15 text-amber-600 dark:text-amber-400" title="Nastavit nové heslo" user={user} />
        <form onSubmit={submit} className="space-y-4 p-5" noValidate>
          <ErrorBox error={error} />
          <div className="space-y-1.5">
            <label htmlFor={`sp-${user.id}`} className="text-sm font-medium">Nové heslo</label>
            <PasswordField id={`sp-${user.id}`} value={password} onChange={setPassword} autoFocus />
          </div>
          <p className="text-xs text-muted-foreground">
            Heslo uživateli předej osobně nebo telefonem. Pohodlnější je poslat mu kód pro obnovu — heslo si
            pak zvolí sám.
          </p>
          <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>Zrušit</Button>
            <Button type="submit" variant="success" disabled={busy}>
              {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <KeyRound className="h-4 w-4" />} Uložit heslo
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

// ── Smazat ──────────────────────────────────────────────────

export function DeleteUserDialog({
  user,
  open,
  onOpenChange,
  notify,
  onDone,
}: {
  user: ManagedUser;
  open: boolean;
  onOpenChange: (o: boolean) => void;
  notify: Notify;
  onDone: () => void;
}) {
  const [busy, setBusy] = React.useState<"delete" | "deactivate" | null>(null);
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    if (open) setError(null);
  }, [open]);

  const run = async (kind: "delete" | "deactivate") => {
    setBusy(kind);
    setError(null);
    try {
      const res = kind === "delete" ? await deleteUser(user.id) : await updateUser(user.id, { active: false });
      if (!res.ok) {
        setError(res.error ?? "Akce se nepovedla.");
        return;
      }
      notify("success", kind === "delete" ? `Uživatel ${user.fullName} byl smazán.` : `Uživatel ${user.fullName} je deaktivovaný.`);
      onOpenChange(false);
      onDone();
    } catch {
      setError("Spojení se nepovedlo — zkus to znovu.");
    } finally {
      setBusy(null);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent aria-describedby={undefined} className="w-[calc(100%-1.5rem)] sm:max-w-md">
        <DialogHeader icon={Trash2} tone="bg-destructive/15 text-destructive" title="Smazat uživatele?" user={user} />
        <div className="space-y-4 p-5">
          <ErrorBox error={error} />
          <div className="flex items-center gap-3 rounded-lg border p-3">
            <UserAvatar id={user.id} name={user.fullName} email={user.email} role={user.role} active={user.active} />
            <div className="min-w-0">
              <div className="truncate font-medium">{user.fullName}</div>
              <div className="truncate text-xs text-muted-foreground">{user.email}</div>
            </div>
          </div>
          <div className="flex items-start gap-2 rounded-lg border border-warning/30 bg-warning/10 p-3 text-sm">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-warning" />
            <span>
              Smazání je <strong>nevratné</strong> a jde jen u účtu bez historie změn. Účet, který už něco
              posunul nebo změnil, <strong>deaktivuj</strong> — nepřihlásí se, ale jeho jméno zůstane u všech
              záznamů.
            </span>
          </div>
          <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>Zrušit</Button>
            {user.active && (
              <Button type="button" variant="outline" disabled={busy !== null} onClick={() => void run("deactivate")}>
                {busy === "deactivate" ? <Loader2 className="h-4 w-4 animate-spin" /> : <UserX className="h-4 w-4" />}
                Jen deaktivovat
              </Button>
            )}
            <Button type="button" variant="destructive" disabled={busy !== null} onClick={() => void run("delete")}>
              {busy === "delete" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
              Smazat natrvalo
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
