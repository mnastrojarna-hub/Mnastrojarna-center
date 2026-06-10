"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Plus, Loader2, UserRound, Check } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { createUser, updateUser } from "@/app/actions/users";
import type { Profile, UserRole } from "@/lib/supabase/database.types";
import { cn } from "@/lib/utils";

const ROLES: { value: UserRole; label: string }[] = [
  { value: "obchodnik", label: "Obchodník" },
  { value: "zamestnanec", label: "Zaměstnanec" },
  { value: "super_admin", label: "Super admin" },
];

const ROLE_LABEL: Record<string, string> = {
  super_admin: "Super admin",
  obchodnik: "Obchodník",
  zamestnanec: "Zaměstnanec",
};

function RoleSelect({ value, onChange, disabled }: { value: UserRole; onChange: (r: UserRole) => void; disabled?: boolean }) {
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value as UserRole)}
      disabled={disabled}
      className="h-8 rounded-md border border-input bg-background px-2 text-xs"
    >
      {ROLES.map((r) => (
        <option key={r.value} value={r.value}>{r.label}</option>
      ))}
    </select>
  );
}

function UserRow({ user }: { user: Profile }) {
  const router = useRouter();
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [rate, setRate] = React.useState(String(Math.round(user.commission_rate * 1000) / 10));

  const change = async (changes: Parameters<typeof updateUser>[1]) => {
    setBusy(true);
    setError(null);
    const res = await updateUser(user.id, changes);
    if (!res.ok) setError(res.error ?? "Chyba");
    else router.refresh();
    setBusy(false);
  };

  return (
    <div className="flex flex-wrap items-center gap-3 rounded-lg border p-3">
      <div className="flex h-9 w-9 items-center justify-center rounded-full bg-muted">
        <UserRound className="h-4 w-4 text-muted-foreground" />
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2 text-sm font-medium">
          {user.full_name || user.email}
          <Badge variant={user.role === "super_admin" ? "default" : "secondary"}>
            {ROLE_LABEL[user.role] ?? user.role}
          </Badge>
          {!user.active && <Badge variant="muted">deaktivován</Badge>}
        </div>
        <div className="text-xs text-muted-foreground">{user.email}</div>
        {error && <div className="text-xs text-destructive">{error}</div>}
      </div>

      <div className="flex items-center gap-2 text-xs">
        <RoleSelect value={user.role} onChange={(role) => change({ role })} disabled={busy} />
        <div className="flex items-center gap-1">
          <Input
            value={rate}
            onChange={(e) => setRate(e.target.value)}
            onBlur={() => {
              const n = Number(rate.replace(",", "."));
              if (!Number.isNaN(n)) void change({ commissionRate: n });
            }}
            className="h-8 w-16 text-right text-xs"
            inputMode="decimal"
            aria-label="Provizní sazba v procentech"
          />
          <span className="text-muted-foreground">% provize</span>
        </div>
        <div className="flex items-center gap-1.5">
          <Switch
            checked={user.active}
            onCheckedChange={(active) => change({ active })}
            disabled={busy}
            aria-label="Aktivní účet"
          />
          <span className="text-muted-foreground">aktivní</span>
        </div>
      </div>
    </div>
  );
}

export function UserManager({ users, isSuperAdmin }: { users: Profile[]; isSuperAdmin: boolean }) {
  const router = useRouter();
  const [fullName, setFullName] = React.useState("");
  const [email, setEmail] = React.useState("");
  const [password, setPassword] = React.useState("");
  const [role, setRole] = React.useState<UserRole>("obchodnik");
  const [rate, setRate] = React.useState("8");
  const [busy, setBusy] = React.useState(false);
  const [msg, setMsg] = React.useState<{ ok: boolean; text: string } | null>(null);

  if (!isSuperAdmin) {
    return (
      <p className="text-sm text-muted-foreground">
        Uživatele spravuje super admin. Přihlas se účtem s rolí super admin.
      </p>
    );
  }

  const add = async () => {
    setBusy(true);
    setMsg(null);
    const res = await createUser({
      email,
      password,
      fullName,
      role,
      commissionRate: Number(rate.replace(",", ".")) || 0,
    });
    if (res.ok) {
      setMsg({ ok: true, text: "Uživatel vytvořen — může se hned přihlásit." });
      setFullName(""); setEmail(""); setPassword("");
      router.refresh();
    } else {
      setMsg({ ok: false, text: res.error ?? "Chyba" });
    }
    setBusy(false);
  };

  return (
    <div className="space-y-4">
      <div className="space-y-2">
        {users.length === 0 && (
          <p className="text-sm text-muted-foreground">Zatím žádní uživatelé.</p>
        )}
        {users.map((u) => <UserRow key={u.id} user={u} />)}
      </div>

      <div className="space-y-2 rounded-lg border border-dashed p-3">
        <div className="text-sm font-medium">Přidat uživatele</div>
        <div className="grid gap-2 sm:grid-cols-2">
          <Input value={fullName} onChange={(e) => setFullName(e.target.value)} placeholder="Jméno a příjmení" />
          <Input value={email} onChange={(e) => setEmail(e.target.value)} placeholder="email@mnastrojarna.cz" type="email" />
          <Input value={password} onChange={(e) => setPassword(e.target.value)} placeholder="Heslo (min. 8 znaků)" type="password" />
          <div className="flex items-center gap-2">
            <RoleSelect value={role} onChange={setRole} />
            <Input value={rate} onChange={(e) => setRate(e.target.value)} className="w-16 text-right" inputMode="decimal" aria-label="Provize %" />
            <span className="text-xs text-muted-foreground">% provize</span>
          </div>
        </div>
        <div className="flex items-center gap-3">
          <Button size="sm" variant="success" onClick={add} disabled={busy}>
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />} Vytvořit účet
          </Button>
          {msg && (
            <span className={cn("text-sm", msg.ok ? "text-success" : "text-destructive")}>
              {msg.ok && <Check className="mr-1 inline h-3.5 w-3.5" />}{msg.text}
            </span>
          )}
        </div>
        <p className="text-xs text-muted-foreground">
          Obchodník vidí jen své zákazníky, nabídky a provize. Zaměstnanec jen přidělené úkoly.
        </p>
      </div>
    </div>
  );
}
