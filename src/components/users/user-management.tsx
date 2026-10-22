"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  AlertCircle, CheckCircle2, Crown, Briefcase, Wrench, Users, Sparkles, MoreHorizontal, Pencil,
  KeyRound, Send, UserCheck, UserX, Trash2, Search, Mail, X, Loader2, Phone, Clock,
} from "lucide-react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { updateUser, sendUserResetCode } from "@/app/actions/users";
import { setMailboxOwner } from "@/app/actions/mailbox-owner";
import { EditUserDialog, SetPasswordDialog, DeleteUserDialog } from "@/components/users/user-dialogs";
import { UserAvatar } from "@/components/users/user-avatar";
import { mailboxLabel } from "@/components/users/add-user-dialog";
import { ROLE_STYLES } from "@/components/users/user-style";
import { ROLE_LABELS } from "@/lib/auth/permissions";
import type { ManagedUser, MailboxOption } from "@/components/users/types";
import type { UserRole } from "@/lib/supabase/database.types";
import { cn, relativeTime } from "@/lib/utils";

type Notify = (tone: "success" | "error", text: string) => void;
type Filter = "all" | UserRole | "inactive" | "ai";

const ROLE_ICONS: Record<UserRole, React.ComponentType<{ className?: string }>> = {
  super_admin: Crown,
  obchodnik: Briefcase,
  zamestnanec: Wrench,
};

/** Správa uživatelů: přehled, hledání, řádky s přepínači a akcemi. */
export function UserManagement({
  users,
  mailboxes,
  currentUserId,
  aiForAll,
}: {
  users: ManagedUser[];
  mailboxes: MailboxOption[];
  currentUserId: string;
  aiForAll: boolean;
}) {
  const router = useRouter();
  const [query, setQuery] = React.useState("");
  const [filter, setFilter] = React.useState<Filter>("all");
  const [toast, setToast] = React.useState<{ tone: "success" | "error"; text: string; id: number } | null>(null);

  const notify = React.useCallback<Notify>((tone, text) => setToast({ tone, text, id: Date.now() }), []);
  React.useEffect(() => {
    if (!toast) return;
    const t = window.setTimeout(() => setToast(null), toast.tone === "error" ? 7000 : 3500);
    return () => window.clearTimeout(t);
  }, [toast]);

  const refresh = React.useCallback(() => router.refresh(), [router]);
  const owners = React.useMemo(() => new Map(users.map((u) => [u.id, u.fullName])), [users]);

  const stats = React.useMemo(
    () => ({
      all: users.length,
      super_admin: users.filter((u) => u.role === "super_admin").length,
      obchodnik: users.filter((u) => u.role === "obchodnik").length,
      zamestnanec: users.filter((u) => u.role === "zamestnanec").length,
      inactive: users.filter((u) => !u.active).length,
      ai: users.filter((u) => u.active && (u.role === "super_admin" || u.aiAccess || aiForAll)).length,
    }),
    [users, aiForAll],
  );

  const q = query.trim().toLowerCase();
  const visible = users.filter((u) => {
    if (filter === "inactive" && u.active) return false;
    if (filter === "ai" && !(u.active && (u.role === "super_admin" || u.aiAccess || aiForAll))) return false;
    if ((filter === "super_admin" || filter === "obchodnik" || filter === "zamestnanec") && u.role !== filter) return false;
    if (!q) return true;
    return [u.fullName, u.email, u.position ?? "", u.phone ?? ""].some((s) => s.toLowerCase().includes(q));
  });

  const chips: { key: Filter; label: string; count: number; icon: React.ComponentType<{ className?: string }>; tone: string }[] = [
    { key: "all", label: "Všichni", count: stats.all, icon: Users, tone: "bg-foreground/10 text-foreground" },
    { key: "super_admin", label: "Super admini", count: stats.super_admin, icon: Crown, tone: ROLE_STYLES.super_admin.badge },
    { key: "obchodnik", label: "Obchodníci", count: stats.obchodnik, icon: Briefcase, tone: ROLE_STYLES.obchodnik.badge },
    { key: "zamestnanec", label: "Zaměstnanci", count: stats.zamestnanec, icon: Wrench, tone: ROLE_STYLES.zamestnanec.badge },
    { key: "ai", label: "S AI", count: stats.ai, icon: Sparkles, tone: "bg-violet-500/10 text-violet-600 dark:text-violet-400" },
    { key: "inactive", label: "Neaktivní", count: stats.inactive, icon: UserX, tone: "bg-muted text-muted-foreground" },
  ];

  return (
    <div className="space-y-4">
      {/* Barevné přehledové dlaždice = zároveň filtry */}
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
        {chips.map((c) => (
          <button
            key={c.key}
            type="button"
            onClick={() => setFilter(c.key)}
            aria-pressed={filter === c.key}
            className={cn(
              "flex items-center gap-3 rounded-xl border bg-card p-3 text-left shadow-sm transition-all hover:-translate-y-0.5 hover:shadow-md",
              filter === c.key && "border-foreground/30 ring-2 ring-foreground/10",
            )}
          >
            <span className={cn("flex h-9 w-9 shrink-0 items-center justify-center rounded-lg", c.tone)}>
              <c.icon className="h-4 w-4" />
            </span>
            <span className="min-w-0">
              <span className="block text-lg font-bold leading-none">{c.count}</span>
              <span className="block truncate text-xs text-muted-foreground">{c.label}</span>
            </span>
          </button>
        ))}
      </div>

      <Card className="overflow-hidden">
        <div className="flex flex-col gap-2 border-b p-3 sm:flex-row sm:items-center">
          <div className="relative flex-1">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Hledat jméno, e-mail, funkci…"
              className="pl-9"
              aria-label="Hledat uživatele"
            />
          </div>
          {filter !== "all" && (
            <Button variant="ghost" size="sm" onClick={() => setFilter("all")}>
              <X className="h-4 w-4" /> Zrušit filtr
            </Button>
          )}
        </div>

        {/* Hlavička tabulky (desktop) */}
        <div className="hidden grid-cols-[minmax(0,1.7fr)_minmax(0,0.9fr)_minmax(0,1.4fr)_72px_72px_40px] gap-4 border-b bg-muted/40 px-5 py-2 text-xs font-medium text-muted-foreground md:grid">
          <span>Uživatel</span>
          <span>Role</span>
          <span>Schránka</span>
          <span className="text-center">AI</span>
          <span className="text-center">Aktivní</span>
          <span />
        </div>

        {visible.length === 0 ? (
          <div className="flex flex-col items-center gap-2 p-10 text-center text-sm text-muted-foreground">
            <Users className="h-8 w-8 opacity-40" />
            {users.length === 0 ? "Zatím žádní uživatelé — přidej prvního tlačítkem nahoře." : "Nikdo neodpovídá hledání."}
          </div>
        ) : (
          <ul className="divide-y">
            {visible.map((u) => (
              <UserRow
                key={u.id}
                user={u}
                isSelf={u.id === currentUserId}
                mailboxes={mailboxes}
                owners={owners}
                aiForAll={aiForAll}
                notify={notify}
                refresh={refresh}
              />
            ))}
          </ul>
        )}
      </Card>

      {toast && (
        <div
          key={toast.id}
          role={toast.tone === "error" ? "alert" : "status"}
          className={cn(
            "fixed inset-x-4 bottom-24 z-50 mx-auto flex max-w-md items-start gap-2 rounded-xl border p-3 text-sm shadow-xl animate-fade-in md:bottom-6",
            toast.tone === "success" ? "border-success/30 bg-card text-foreground" : "border-destructive/30 bg-card text-foreground",
          )}
        >
          {toast.tone === "success" ? (
            <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-success" />
          ) : (
            <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-destructive" />
          )}
          <span className="flex-1">{toast.text}</span>
          <button type="button" onClick={() => setToast(null)} className="text-muted-foreground hover:text-foreground" aria-label="Zavřít">
            <X className="h-4 w-4" />
          </button>
        </div>
      )}
    </div>
  );
}

function UserRow({
  user,
  isSelf,
  mailboxes,
  owners,
  aiForAll,
  notify,
  refresh,
}: {
  user: ManagedUser;
  isSelf: boolean;
  mailboxes: MailboxOption[];
  owners: Map<string, string>;
  aiForAll: boolean;
  notify: Notify;
  refresh: () => void;
}) {
  const [busy, setBusy] = React.useState<string | null>(null);
  const [dialog, setDialog] = React.useState<null | "edit" | "password" | "delete">(null);
  // optimistické přepínače
  const [active, setActive] = React.useState(user.active);
  const [aiAccess, setAiAccess] = React.useState(user.aiAccess);
  React.useEffect(() => setActive(user.active), [user.active]);
  React.useEffect(() => setAiAccess(user.aiAccess), [user.aiAccess]);

  const isAdmin = user.role === "super_admin";
  const owned = mailboxes.filter((m) => m.ownerId === user.id);
  const assignable = mailboxes.filter((m) => m.ownerId !== user.id);
  const RoleIcon = ROLE_ICONS[user.role];

  const run = async (key: string, fn: () => Promise<{ ok: boolean; error?: string }>, success: string, revert?: () => void) => {
    setBusy(key);
    try {
      const res = await fn();
      if (!res.ok) {
        revert?.();
        notify("error", res.error ?? "Akce se nepovedla.");
      } else {
        notify("success", success);
        refresh();
      }
    } catch {
      revert?.();
      notify("error", "Spojení se nepovedlo — zkus to znovu.");
    } finally {
      setBusy(null);
    }
  };

  const toggleActive = (v: boolean) => {
    setActive(v);
    void run("active", () => updateUser(user.id, { active: v }), v ? `${user.fullName} je znovu aktivní.` : `${user.fullName} je deaktivovaný — nepřihlásí se.`, () => setActive(!v));
  };
  const toggleAi = (v: boolean) => {
    setAiAccess(v);
    void run("ai", () => updateUser(user.id, { aiAccess: v }), v ? `${user.fullName} může používat AI čtení dokladů.` : `${user.fullName} vyplňuje doklady ručně.`, () => setAiAccess(!v));
  };
  const assignMailbox = (mailboxId: string) => {
    if (!mailboxId) return;
    const m = mailboxes.find((x) => x.id === mailboxId);
    void run("mailbox", () => setMailboxOwner(mailboxId, user.id), `Schránka ${m?.email ?? ""} patří uživateli ${user.fullName}.`);
  };
  const unassignMailbox = (mailboxId: string) => {
    const m = mailboxes.find((x) => x.id === mailboxId);
    void run("mailbox", () => setMailboxOwner(mailboxId, null), `Schránka ${m?.email ?? ""} už nemá vlastníka.`);
  };
  const sendCode = async () => {
    setBusy("code");
    try {
      const r = await sendUserResetCode(user.id);
      if (!r.ok) notify("error", r.error ?? "Kód se nepodařilo odeslat.");
      else if (r.channel === "supabase") {
        notify("success", `SMTP není nastavené — ${user.email} dostal(a) e-mail s odkazem ze Supabase.`);
      } else notify("success", `Kód pro obnovu hesla odešel na ${user.email}. Platí 15 minut.`);
    } catch {
      notify("error", "Spojení se nepovedlo — zkus to znovu.");
    } finally {
      setBusy(null);
    }
  };

  const aiTooltip = isAdmin
    ? "Super admin má AI vždy (když je zapnutá a je nastaven klíč)."
    : aiForAll
      ? "AI čtení dokladů je teď zapnuté pro všechny (nastavení níže)."
      : "Povolit AI čtení dokladů z fotky";

  return (
    <li
      className={cn(
        "grid grid-cols-[minmax(0,1fr)_auto] gap-x-3 gap-y-3 p-4 transition-colors hover:bg-muted/30 md:grid-cols-[minmax(0,1.7fr)_minmax(0,0.9fr)_minmax(0,1.4fr)_72px_72px_40px] md:items-center md:gap-4 md:px-5 md:py-3",
        !active && "bg-muted/20",
      )}
    >
      {/* Uživatel */}
      <div className={cn("flex min-w-0 items-center gap-3", !active && "opacity-60")}>
        <UserAvatar id={user.id} name={user.fullName} email={user.email} role={user.role} active={active} />
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <span className="truncate font-medium">{user.fullName}</span>
            {isSelf && <Badge variant="muted" className="px-1.5 py-0 text-[10px]">ty</Badge>}
            {!active && <Badge variant="muted" className="px-1.5 py-0 text-[10px]">neaktivní</Badge>}
          </div>
          <div className="truncate text-xs text-muted-foreground">{user.email}</div>
          {(user.position || user.phone) && (
            <div className="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-xs text-muted-foreground">
              {user.position && <span>{user.position}</span>}
              {user.phone && (
                <a href={`tel:${user.phone.replace(/\s/g, "")}`} className="inline-flex items-center gap-1 hover:text-foreground">
                  <Phone className="h-3 w-3" /> {user.phone}
                </a>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Akce (mobil vpravo nahoře, desktop poslední sloupec) */}
      <div className="flex justify-end md:order-last">
        <DropdownMenu modal={false}>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="icon-sm" aria-label={`Akce pro ${user.fullName}`} disabled={busy !== null}>
              {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <MoreHorizontal className="h-4 w-4" />}
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-60">
            <DropdownMenuLabel className="truncate">{user.fullName}</DropdownMenuLabel>
            <DropdownMenuItem onSelect={() => setDialog("edit")}>
              <Pencil /> Upravit
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={() => setDialog("password")}>
              <KeyRound /> Nastavit nové heslo
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={() => void sendCode()} disabled={!active || !user.email}>
              <Send /> Poslat kód pro obnovu hesla
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            {active ? (
              <DropdownMenuItem onSelect={() => toggleActive(false)} disabled={isSelf}>
                <UserX /> Deaktivovat
              </DropdownMenuItem>
            ) : (
              <DropdownMenuItem onSelect={() => toggleActive(true)}>
                <UserCheck /> Aktivovat
              </DropdownMenuItem>
            )}
            <DropdownMenuItem
              onSelect={() => setDialog("delete")}
              disabled={isSelf}
              className="text-destructive focus:text-destructive [&_svg]:text-destructive"
            >
              <Trash2 /> Smazat
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      {/* Role + naposledy */}
      <div className="col-span-2 flex flex-wrap items-center gap-2 md:col-span-1 md:flex-col md:items-start md:gap-1">
        <Badge className={cn("gap-1", ROLE_STYLES[user.role].badge)}>
          <RoleIcon className="h-3 w-3" /> {ROLE_LABELS[user.role]}
          {user.role === "obchodnik" && user.commissionPercent > 0 && (
            <span className="opacity-70">· {String(user.commissionPercent).replace(".", ",")} %</span>
          )}
        </Badge>
        <span className="inline-flex items-center gap-1 text-[11px] text-muted-foreground">
          <Clock className="h-3 w-3" />
          {user.lastSeenAt ? `přihlášen ${relativeTime(user.lastSeenAt)}` : "zatím nepřihlášen"}
        </span>
      </div>

      {/* Schránky */}
      <div className="col-span-2 min-w-0 space-y-1.5 md:col-span-1">
        {owned.length > 0 && (
          <div className="flex flex-wrap gap-1.5">
            {owned.map((m) => (
              <span
                key={m.id}
                className="inline-flex max-w-full items-center gap-1 rounded-full border border-blue-500/20 bg-blue-500/10 py-0.5 pl-2 pr-1 text-xs text-blue-700 dark:text-blue-300"
              >
                <Mail className="h-3 w-3 shrink-0" />
                <span className="truncate">{m.email}</span>
                <button
                  type="button"
                  onClick={() => unassignMailbox(m.id)}
                  disabled={busy !== null}
                  className="rounded-full p-0.5 hover:bg-blue-500/20"
                  aria-label={`Odebrat schránku ${m.email}`}
                  title="Odebrat schránku"
                >
                  <X className="h-3 w-3" />
                </button>
              </span>
            ))}
          </div>
        )}
        {mailboxes.length === 0 ? (
          <Link href="/settings" className="text-xs text-muted-foreground hover:text-foreground hover:underline">
            Žádné schránky — přidat v Nastavení
          </Link>
        ) : assignable.length > 0 ? (
          <select
            value=""
            onChange={(e) => assignMailbox(e.target.value)}
            disabled={busy !== null}
            aria-label={`Přiřadit schránku uživateli ${user.fullName}`}
            className="h-8 w-full max-w-[260px] rounded-md border border-dashed border-input bg-background px-2 text-xs text-muted-foreground shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <option value="">{owned.length ? "+ další schránka…" : "+ přiřadit schránku…"}</option>
            {assignable.map((m) => (
              <option key={m.id} value={m.id}>{mailboxLabel(m, owners)}</option>
            ))}
          </select>
        ) : null}
      </div>

      {/* Přepínače: mobil v jednom řádku, desktop ve sloupcích */}
      <div className="col-span-2 flex items-center gap-6 md:contents">
        <div className="flex items-center gap-2 md:justify-center">
          <Tooltip>
            <TooltipTrigger asChild>
              <span className="inline-flex">
                <Switch
                  checked={isAdmin || aiAccess}
                  onCheckedChange={toggleAi}
                  disabled={isAdmin || busy !== null || !active}
                  aria-label={`AI pro ${user.fullName}`}
                  className="data-[state=checked]:bg-violet-500"
                />
              </span>
            </TooltipTrigger>
            <TooltipContent className="max-w-xs">{aiTooltip}</TooltipContent>
          </Tooltip>
          <span className="flex items-center gap-1 text-xs text-muted-foreground md:sr-only">
            <Sparkles className="h-3 w-3 text-violet-500" /> AI
          </span>
        </div>
        <div className="flex items-center gap-2 md:justify-center">
          <Tooltip>
            <TooltipTrigger asChild>
              <span className="inline-flex">
                <Switch
                  checked={active}
                  onCheckedChange={toggleActive}
                  disabled={isSelf || busy !== null}
                  aria-label={`Aktivní účet ${user.fullName}`}
                  className="data-[state=checked]:bg-success"
                />
              </span>
            </TooltipTrigger>
            <TooltipContent>
              {isSelf ? "Sám sebe deaktivovat nemůžeš." : active ? "Aktivní — může se přihlásit" : "Neaktivní — nepřihlásí se"}
            </TooltipContent>
          </Tooltip>
          <span className="text-xs text-muted-foreground md:sr-only">Aktivní</span>
        </div>
      </div>

      <EditUserDialog
        user={user}
        isSelf={isSelf}
        open={dialog === "edit"}
        onOpenChange={(o) => setDialog(o ? "edit" : null)}
        notify={notify}
        onSaved={refresh}
      />
      <SetPasswordDialog
        user={user}
        open={dialog === "password"}
        onOpenChange={(o) => setDialog(o ? "password" : null)}
        notify={notify}
      />
      <DeleteUserDialog
        user={user}
        open={dialog === "delete"}
        onOpenChange={(o) => setDialog(o ? "delete" : null)}
        notify={notify}
        onDone={refresh}
      />
    </li>
  );
}
