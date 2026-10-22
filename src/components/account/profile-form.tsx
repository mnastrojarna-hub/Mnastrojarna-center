"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { AlertCircle, CheckCircle2, Loader2, Save } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { updateOwnProfile } from "@/app/auth/password";

/** Úprava vlastního jména a telefonu (Můj účet). */
export function ProfileForm({ fullName, phone, email }: { fullName: string; phone: string | null; email: string }) {
  const router = useRouter();
  const [name, setName] = React.useState(fullName);
  const [tel, setTel] = React.useState(phone ?? "");
  const [busy, setBusy] = React.useState(false);
  const [status, setStatus] = React.useState<{ ok: boolean; text: string } | null>(null);
  const dirty = name.trim() !== fullName.trim() || tel.trim() !== (phone ?? "").trim();

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setStatus(null);
    if (!name.trim()) return setStatus({ ok: false, text: "Vyplň jméno." });
    setBusy(true);
    try {
      const res = await updateOwnProfile({ fullName: name, phone: tel });
      if (!res.ok) setStatus({ ok: false, text: res.error ?? "Uložení se nepovedlo." });
      else {
        setStatus({ ok: true, text: "Uloženo." });
        router.refresh();
      }
    } catch {
      setStatus({ ok: false, text: "Spojení se nepovedlo — zkus to znovu." });
    } finally {
      setBusy(false);
    }
  };

  return (
    <form onSubmit={submit} className="space-y-4" noValidate>
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="space-y-1.5 sm:col-span-2">
          <label htmlFor="acc-name" className="text-sm font-medium">Jméno a příjmení</label>
          <Input id="acc-name" autoComplete="name" value={name} onChange={(e) => setName(e.target.value)} />
        </div>
        <div className="space-y-1.5">
          <label htmlFor="acc-phone" className="text-sm font-medium">Telefon</label>
          <Input
            id="acc-phone"
            type="tel"
            inputMode="tel"
            autoComplete="tel"
            placeholder="+420 777 123 456"
            value={tel}
            onChange={(e) => setTel(e.target.value)}
          />
        </div>
        <div className="space-y-1.5">
          <label htmlFor="acc-email" className="text-sm font-medium">E-mail (přihlašovací)</label>
          <Input id="acc-email" value={email} readOnly disabled className="bg-muted/50" />
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <Button type="submit" variant="success" disabled={busy || !dirty}>
          {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />} Uložit
        </Button>
        {status && (
          <span className={status.ok ? "inline-flex items-center gap-1 text-sm text-success" : "inline-flex items-center gap-1 text-sm text-destructive"}>
            {status.ok ? <CheckCircle2 className="h-4 w-4" /> : <AlertCircle className="h-4 w-4" />}
            {status.text}
          </span>
        )}
      </div>
      <p className="text-xs text-muted-foreground">E-mail, roli a funkci mění super admin.</p>
    </form>
  );
}
