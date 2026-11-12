"use client";

import * as React from "react";
import { useUrlState } from "@/components/nav/use-url-state";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  AlertCircle, ArrowLeftRight, CheckCircle2, Coins, ListChecks, Crown, Briefcase, Wrench, Users, Sparkles, MoreHorizontal, Pencil,
  KeyRound, Send, UserCheck, UserX, Trash2, Search, Mail, X, Loader2, Phone, Clock, FileSignature, FileCheck2, ShieldCheck, Handshake,
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
import { EditUserDialog, SetPasswordDialog, DeleteUserDialog, salesContactOptions } from "@/components/users/user-dialogs";
import { CommissionContractDialog, contractSummary } from "@/components/users/commission-contract-dialog";
import { UserAvatar } from "@/components/users/user-avatar";
import { mailboxLabel } from "@/components/users/add-user-dialog";
import { ROLE_STYLES } from "@/components/users/user-style";
import { ROLE_LABELS } from "@/lib/auth/permissions";
import type { ManagedUser, MailboxOption } from "@/components/users/types";
import type { UserRole } from "@/lib/supabase/database.types";
import { cn, relativeTime } from "@/lib/utils";
import { compareLastActive, describeLastActive, type ActivityTone } from "@/lib/activity";

type Notify = (tone: "success" | "error", text: string) => void;
type Filter = "all" | UserRole | "inactive" | "ai";
const USER_FILTERS: Filter[] = ["all", "super_admin", "obchodnik", "zamestnanec", "inactive", "ai"];
function isUserFilter(v: string): v is Filter {
  return (USER_FILTERS as string[]).includes(v);
}

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
  // hledání a filtr v adrese (Zpět vrátí stejný seznam)
  const url = useUrlState({ q: "", filtr: "all", razeni: "" });
  const query = url.values.q;
  const setQuery = (v: string) => url.set({ q: v }, { delay: 300 });
  const filter: Filter = isUserFilter(url.values.filtr) ? url.values.filtr : "all";
  const setFilter = (f: Filter) => url.set({ filtr: f });
  // 9. 11.: řazení podle poslední aktivity (kdo systém nepoužívá, je na konci)
  const byActivity = url.values.razeni === "aktivita";
  const [toast, setToast] = React.useState<{ tone: "success" | "error"; text: string; id: number } | null>(null);

  const notify = React.useCallback<Notify>((tone, text) => setToast({ tone, text, id: Date.now() }), []);
  React.useEffect(() => {
    if (!toast) return;
    const t = window.setTimeout(() => setToast(null), toast.tone === "error" ? 7000 : 3500);
    return () => window.clearTimeout(t);
  }, [toast]);

  const refresh = React.useCallback(() => router.refresh(), [router]);
  const owners = React.useMemo(() => new Map(users.map((u) => [u.id, u.fullName])), [users]);

  // /users?smlouva=<id> (odkaz ze stránky Provize) → rovnou otevřít smlouvu
  const [contractFor, setContractFor] = React.useState<string | null>(null);
  React.useEffect(() => {
    try {
      const url = new URL(window.location.href);
      const id = url.searchParams.get("smlouva");
      if (!id) return;
      setContractFor(id);
      url.searchParams.delete("smlouva");
      window.history.replaceState(window.history.state, "", url.toString());
    } catch {
      // adresa je jen pohodlí
    }
  }, []);

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
  if (byActivity) visible.sort((a, b) => compareLastActive(a.lastActiveAt, b.lastActiveAt));

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
          <Button
            variant={byActivity ? "secondary" : "ghost"}
            size="sm"
            onClick={() => url.set({ razeni: byActivity ? "" : "aktivita" })}
            aria-pressed={byActivity}
            data-sort-activity={byActivity ? "on" : "off"}
            title="Seřadit podle poslední aktivity (kdy kdo naposledy něco v systému udělal)"
          >
            <Clock className="h-4 w-4" /> {byActivity ? "Podle aktivity" : "Řadit podle aktivity"}
          </Button>
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
                openContract={contractFor === u.id}
                onContractOpened={() => setContractFor(null)}
                users={users}
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

const ACTIVITY_TONES: Record<ActivityTone, string> = {
  recent: "text-emerald-700 dark:text-emerald-400",
  normal: "text-foreground/75",
  // déle než 7 dní / nikdy — tlumeně: na první pohled, kdo systém nepoužívá
  stale: "text-muted-foreground/70",
  never: "text-muted-foreground/70 italic",
};

/**
 * 9. 11. „Naposledy aktivní" — kdy uživatel naposledy něco v aplikaci udělal (kliknutí / klávesa, ~1 min) a kde.
 * Přesný čas a poslední přihlášení v title (majitel: přihlášení je nepodstatné, zajímá ho poslední kliknutí).
 */
export function LastActive({ user }: { user: Pick<ManagedUser, "lastActiveAt" | "lastActivePath" | "lastSeenAt"> }) {
  const v = describeLastActive(user.lastActiveAt, user.lastActivePath);
  const title = [
    v.exact ? `Naposledy aktivní ${v.exact}` : "Zatím žádná aktivita v aplikaci",
    v.page ? `stránka: ${v.page}` : null,
    user.lastSeenAt ? `přihlášen ${relativeTime(user.lastSeenAt)}` : "zatím nepřihlášen",
  ].filter(Boolean).join(" · ");
  return (
    // relativní čas se mezi serverem a prohlížečem může lišit o minutu
    <span
      data-last-active={v.tone}
      title={title}
      className={cn("inline-flex min-w-0 max-w-full items-start gap-1 text-[11px] leading-4", ACTIVITY_TONES[v.tone])}
      suppressHydrationWarning
    >
      {v.tone === "recent" ? (
        <span className="mx-0.5 mt-[5px] h-1.5 w-1.5 shrink-0 rounded-full bg-emerald-500" aria-hidden />
      ) : (
        <Clock className="mt-0.5 h-3 w-3 shrink-0" />
      )}
      {/* úzký sloupec na desktopu: stránka se zalomí pod čas (neořezávat) */}
      <span className="min-w-0 break-words" suppressHydrationWarning>
        <span className="whitespace-nowrap">{v.tone === "never" ? v.label : `Naposledy aktivní ${v.label}`}</span>
        {v.page ? <span className="text-muted-foreground"> · {v.page}</span> : null}
      </span>
    </span>
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
  openContract = false,
  onContractOpened,
  users = [],
}: {
  user: ManagedUser;
  isSelf: boolean;
  mailboxes: MailboxOption[];
  owners: Map<string, string>;
  aiForAll: boolean;
  notify: Notify;
  refresh: () => void;
  /** Otevřít rovnou smlouvu a provize (odkaz ze stránky Provize). */
  openContract?: boolean;
  onContractOpened?: () => void;
  /** Všichni uživatelé — kandidáti na „Kontakt pro obchod a ceny". */
  users?: ManagedUser[];
}) {
  const [busy, setBusy] = React.useState<string | null>(null);
  const [dialog, setDialog] = React.useState<null | "edit" | "password" | "delete" | "contract">(null);
  React.useEffect(() => {
    if (!openContract) return;
    setDialog("contract");
    onContractOpened?.();
  }, [openContract, onContractOpened]);
  const hasContract = (user.commissionRules?.length ?? 0) > 0;
  const contract = contractSummary(user);
  const contractShort = contractSummary(user, { short: true });
  const canHaveContract = user.role === "obchodnik" || user.role === "super_admin";
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
            {(canHaveContract || hasContract) && (
              <DropdownMenuItem onSelect={() => setDialog("contract")}>
                <FileSignature /> Smlouva a provize
              </DropdownMenuItem>
            )}
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
          {user.role === "obchodnik" && user.commissionPercent > 0 && !hasContract && (
            <span className="opacity-70">· {String(user.commissionPercent).replace(".", ",")} %</span>
          )}
        </Badge>
        {(canHaveContract || hasContract) && (contract || user.role === "obchodnik") && (
          <button
            type="button"
            onClick={() => setDialog("contract")}
            className={cn(
              "inline-flex max-w-full items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-medium transition hover:shadow-sm",
              hasContract
                ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-700 hover:bg-emerald-500/15 dark:text-emerald-300"
                : "border-dashed text-muted-foreground hover:bg-accent",
            )}
            title={`Smlouva a provize${contract ? ` — ${contract}` : ""}`}
          >
            <FileSignature className="h-3 w-3 shrink-0" />
            <span className="truncate">{hasContract ? contractShort : contract ? `${contract} · bez smlouvy` : "Nastavit provizi"}</span>
          </button>
        )}
        {/* 31. 10.: schvalování nabídek per uživatel (přepínač v „Upravit") */}
        {!isAdmin && (
          <button
            type="button"
            onClick={() => setDialog("edit")}
            data-quote-approval={user.quoteNeedsApproval !== false ? "on" : "off"}
            className={cn(
              "inline-flex max-w-full items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-medium transition hover:shadow-sm",
              user.quoteNeedsApproval !== false
                ? "border-amber-500/30 bg-amber-500/10 text-amber-700 hover:bg-amber-500/15 dark:text-amber-300"
                : "border-emerald-500/30 bg-emerald-500/10 text-emerald-700 hover:bg-emerald-500/15 dark:text-emerald-300",
            )}
            title={user.quoteNeedsApproval !== false
              ? "Nabídky musí před odesláním schválit super admin nebo schvalovatel — změnit v Upravit"
              : "Nabídky vystavuje i odesílá bez schválení — změnit v Upravit"}
          >
            <FileCheck2 className="h-3 w-3 shrink-0" />
            <span className="truncate">{user.quoteNeedsApproval !== false ? "nabídky se schválením" : "nabídky bez schválení"}</span>
          </button>
        )}
        {/* 31. 10.: smí schvalovat nabídky ostatních (přepínač v „Upravit"; super admin vždy — štítek nepotřebuje) */}
        {!isAdmin && user.canApproveQuotes === true && (
          <button
            type="button"
            onClick={() => setDialog("edit")}
            data-quote-approver="on"
            className="inline-flex max-w-full items-center gap-1 rounded-full border border-sky-500/30 bg-sky-500/10 px-2 py-0.5 text-[11px] font-medium text-sky-700 transition hover:bg-sky-500/15 hover:shadow-sm dark:text-sky-300"
            title="Smí schvalovat nabídky kolegů, které schválení potřebují (vlastní ne) — změnit v Upravit"
          >
            <ShieldCheck className="h-3 w-3 shrink-0" />
            <span className="truncate">schvaluje nabídky</span>
          </button>
        )}
        {/* 3. 11.: kontakt pro obchod a ceny (e-mail k nabídce odkáže obchod a ceny na kolegu) */}
        {user.salesContactId && (
          <button
            type="button"
            onClick={() => setDialog("edit")}
            data-sales-contact-chip={user.salesContactId}
            className="inline-flex max-w-full items-center gap-1 rounded-full border border-violet-500/30 bg-violet-500/10 px-2 py-0.5 text-[11px] font-medium text-violet-700 transition hover:bg-violet-500/15 hover:shadow-sm dark:text-violet-300"
            title="E-mail k nabídce odkáže obchodní záležitosti a ceny na tohoto kolegu — změnit v Upravit"
          >
            <Handshake className="h-3 w-3 shrink-0" />
            <span className="truncate">obchod a ceny: {owners.get(user.salesContactId) ?? "—"}</span>
          </button>
        )}
        {/* 2. 11.: plný přístup (vše kromě cizí pošty a správy uživatelů) */}
        {user.role !== "super_admin" && user.fullAccess === true && (
          <button
            type="button"
            onClick={() => setDialog("edit")}
            data-full-access-user="on"
            className="inline-flex max-w-full items-center gap-1 rounded-full border border-primary/30 bg-primary/10 px-2 py-0.5 text-[11px] font-medium text-primary transition hover:bg-primary/15 hover:shadow-sm"
            title="Smí vše jako super admin kromě pošty ostatních schránek a správy uživatelů — změnit v Upravit"
          >
            <ShieldCheck className="h-3 w-3 shrink-0" />
            <span className="truncate">plný přístup</span>
          </button>
        )}
        {/* 31. 10.: zaměstnanec smí poptávat dodavatele (obchodník a super admin vždy — štítek nepotřebují) */}
        {user.role === "zamestnanec" && user.canRfq === true && (
          <button
            type="button"
            onClick={() => setDialog("edit")}
            data-rfq-user="on"
            className="inline-flex max-w-full items-center gap-1 rounded-full border border-orange-500/30 bg-orange-500/10 px-2 py-0.5 text-[11px] font-medium text-orange-700 transition hover:bg-orange-500/15 hover:shadow-sm dark:text-orange-300"
            title="Posílá poptávky dodavatelům a vidí jejich ceny v porovnání — změnit v Upravit"
          >
            <ShieldCheck className="h-3 w-3 shrink-0" />
            <span className="truncate">poptává dodavatele</span>
          </button>
        )}
        {/* 9. 11.: zaměstnanec smí ručně měnit stav zakázky (obchodník a super admin vždy — štítek nepotřebují) */}
        {user.role === "zamestnanec" && user.canChangeStage === true && (
          <button
            type="button"
            onClick={() => setDialog("edit")}
            data-stage-user="on"
            className="inline-flex max-w-full items-center gap-1 rounded-full border border-teal-500/30 bg-teal-500/10 px-2 py-0.5 text-[11px] font-medium text-teal-700 transition hover:bg-teal-500/15 hover:shadow-sm dark:text-teal-300"
            title="Ručně mění stav zakázky dopředu i dozadu, včetně Vyfakturováno a Dokončeno — změnit v Upravit"
          >
            <ArrowLeftRight className="h-3 w-3 shrink-0" />
            <span className="truncate">mění stav zakázky</span>
          </button>
        )}
        {/* 9. 11.: řeší frontu ke schválení (super admin vždy — štítek nepotřebuje) */}
        {user.role !== "super_admin" && user.canResolveQueue === true && (
          <button
            type="button"
            onClick={() => setDialog("edit")}
            data-queue-user="on"
            className="inline-flex max-w-full items-center gap-1 rounded-full border border-fuchsia-500/30 bg-fuchsia-500/10 px-2 py-0.5 text-[11px] font-medium text-fuchsia-700 transition hover:bg-fuchsia-500/15 hover:shadow-sm dark:text-fuchsia-300"
            title="Schvaluje odchozí e-maily, objednávky dodavatelům a změny stavu z pošty (Fronta ke schválení) — změnit v Upravit"
          >
            <ListChecks className="h-3 w-3 shrink-0" />
            <span className="truncate">řeší frontu</span>
          </button>
        )}
        {/* 9. 11.: zaměstnanec vidí nákupní ceny a marže (obchodník a super admin vždy) */}
        {user.role === "zamestnanec" && user.canSeeMargins === true && (
          <button
            type="button"
            onClick={() => setDialog("edit")}
            data-margins-user="on"
            className="inline-flex max-w-full items-center gap-1 rounded-full border border-emerald-500/30 bg-emerald-500/10 px-2 py-0.5 text-[11px] font-medium text-emerald-700 transition hover:bg-emerald-500/15 hover:shadow-sm dark:text-emerald-300"
            title="Vidí nákupní ceny a marže — změnit v Upravit"
          >
            <Coins className="h-3 w-3 shrink-0" />
            <span className="truncate">vidí marže</span>
          </button>
        )}
        <LastActive user={user} />
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
        salesContacts={dialog === "edit" ? salesContactOptions(users, user.id, user.salesContactId) : undefined}
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
      <CommissionContractDialog
        user={user}
        open={dialog === "contract"}
        onOpenChange={(o) => setDialog(o ? "contract" : null)}
        notify={notify}
        onSaved={refresh}
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
