import Link from "next/link";
import {
  BadgeCheck, Crown, Briefcase, Wrench, Mail, KeyRound, UserRound, ShieldCheck, Sparkles, Inbox, Check, Eye,
} from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { requireUser, getAccess } from "@/lib/auth/session";
import { ROLE_DESCRIPTIONS, ROLE_LABELS, FEATURE_LABELS, can, type Feature } from "@/lib/auth/permissions";
import { loadAccountData } from "@/components/account/data";
import { ProfileForm } from "@/components/account/profile-form";
import { ChangePasswordForm } from "@/components/account/change-password-form";
import { UserAvatar } from "@/components/users/user-avatar";
import { ROLE_STYLES } from "@/components/users/user-style";
import type { UserRole } from "@/lib/supabase/database.types";
import { cn, formatDate, relativeTime } from "@/lib/utils";

export const dynamic = "force-dynamic";

const ROLE_ICONS: Record<UserRole, React.ComponentType<{ className?: string }>> = {
  super_admin: Crown,
  obchodnik: Briefcase,
  zamestnanec: Wrench,
};

/** Funkce, které má smysl ukazovat uživateli (technické podfunkce vynecháme). */
const SHOWN_FEATURES: Feature[] = [
  "orders", "workflow", "flow_all", "documents", "customers", "suppliers", "mail", "mail_all", "ai_capture",
  "pricing", "quote_approval", "margins", "commissions", "commissions_all", "dashboard", "ai_assistant", "drawings",
  "knowledge", "ai_tuning", "users", "settings",
];

/** Karta „Co vidím“ (#25, pravidlo 7): Kniha zakázek vs. Obchodní tok, schvalování, Nacenění, focení, provize. */
function whatISee(hasAi: boolean): React.ReactNode[] {
  return [
  <><strong>Kniha zakázek</strong> = výroba a celý život zakázky. Vidí ji každý — všechny zakázky a vše v nich (nákupní ceny, marže a nákupní doklady jen obchodník a super admin).</>,
  <><strong>Obchodní tok</strong> (Poptávky, Nabídky, Potvrzení objednávek, Objednávky dodavatelům, Dokumenty) = tvoje práce z pošty: zakázky, kde jsi obchodník nebo je zpracováváš, které jsi založil(a), a doklady z tvé schránky. Super admin vidí tok všech.</>,
  <><strong>Nabídky</strong> od kohokoli kromě super admina musí před odesláním schválit super admin. Po schválení je odešleš sám.</>,
  <><strong>Nacenění</strong> zatím dělá jen super admin.</>,
  hasAi
    ? <><strong>Vyfotit doklad</strong> může každý — AI fotku přečte a zařadí.</>
    : <><strong>Vyfotit doklad</strong> může každý — fotku přiložíš k zakázce a údaje vyplníš ručně.</>,
  <><strong>Provize</strong> vidíš jen své. · <strong>Pošta</strong>: jen tvoje schránky.</>,
  ];
}

/** Proč AI čtení nemá (skutečný důvod — ne vždy pomůže super admin). */
function aiOffReason(access: Awaited<ReturnType<typeof getAccess>>): string {
  const permitted = can(access.user, "ai_capture", { ...access.ctx, aiEnabled: true, aiConfigured: true });
  if (!permitted) return "Automatické čtení AI ti může zapnout super admin.";
  if (!access.ctx.aiEnabled) return "AI je teď vypnutá v Nastavení (hlavní vypínač).";
  return "AI zatím není připojená — chybí Claude API klíč (doplní super admin v Nastavení).";
}

function SectionIcon({ icon: Icon, tone }: { icon: React.ComponentType<{ className?: string }>; tone: string }) {
  return (
    <span className={cn("flex h-8 w-8 items-center justify-center rounded-lg", tone)}>
      <Icon className="h-4 w-4" />
    </span>
  );
}

/** Můj účet — jméno, telefon, heslo, role a co role vidí, vlastní schránky. */
export default async function AccountPage() {
  const user = await requireUser();
  const [data, access] = await Promise.all([loadAccountData(user.id), getAccess()]);
  const RoleIcon = ROLE_ICONS[user.role];
  const style = ROLE_STYLES[user.role];
  const features = SHOWN_FEATURES.filter((f) => access.features.includes(f));
  const hasAi = access.features.includes("ai_capture");

  return (
    <div className="space-y-6">
      {/* Hlavička s avatarem */}
      <Card className="overflow-hidden">
        <div className="h-20 bg-gradient-to-r from-primary via-orange-500 to-amber-400 sm:h-24" />
        <CardContent className="-mt-10 flex flex-col gap-4 pb-5 sm:-mt-12 sm:flex-row sm:items-end">
          <UserAvatar
            id={user.id}
            name={user.fullName}
            email={user.email}
            role={user.role}
            size="xl"
          />
          <div className="min-w-0 flex-1 space-y-1">
            <h1 className="truncate text-xl font-bold tracking-tight">{user.fullName}</h1>
            <div className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
              <span className="truncate">{user.email}</span>
              {data.position && <span>· {data.position}</span>}
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Badge className={cn("gap-1 px-3 py-1 text-sm", style.badge)}>
              <RoleIcon className="h-3.5 w-3.5" /> {ROLE_LABELS[user.role]}
            </Badge>
            {hasAi && (
              <Badge className="gap-1 border-transparent bg-violet-500/10 px-3 py-1 text-sm text-violet-600 dark:text-violet-400">
                <Sparkles className="h-3.5 w-3.5" /> AI čtení dokladů
              </Badge>
            )}
          </div>
        </CardContent>
      </Card>

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1.25fr)_minmax(0,1fr)]">
        <div className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base">
                <SectionIcon icon={UserRound} tone="bg-sky-500/10 text-sky-600 dark:text-sky-400" /> Osobní údaje
              </CardTitle>
              <CardDescription>Jméno se ukazuje u zakázek, nabídek a v historii.</CardDescription>
            </CardHeader>
            <CardContent>
              <ProfileForm fullName={user.fullName} phone={data.phone} email={user.email} />
            </CardContent>
          </Card>

          <Card id="zmena-hesla" className={user.mustChangePassword ? "scroll-mt-20 ring-2 ring-amber-400" : "scroll-mt-20"}>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base">
                <SectionIcon icon={KeyRound} tone="bg-amber-500/10 text-amber-600 dark:text-amber-400" /> Heslo
              </CardTitle>
              <CardDescription>Silné heslo má aspoň 12 znaků, velká i malá písmena a číslice.</CardDescription>
            </CardHeader>
            <CardContent>
              <ChangePasswordForm email={user.email} />
            </CardContent>
          </Card>
        </div>

        <div className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base">
                <SectionIcon icon={ShieldCheck} tone="bg-emerald-500/10 text-emerald-600 dark:text-emerald-400" /> Tvoje role a přístupy
              </CardTitle>
              <CardDescription>{ROLE_DESCRIPTIONS[user.role]}</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <ul className="flex flex-wrap gap-1.5">
                {features.map((f) => (
                  <li
                    key={f}
                    className="inline-flex items-center gap-1 rounded-full border bg-muted/40 px-2.5 py-1 text-xs font-medium"
                  >
                    <Check className="h-3 w-3 text-success" /> {FEATURE_LABELS[f]}
                  </li>
                ))}
              </ul>
              {!hasAi && user.role !== "super_admin" && (
                <p className="rounded-lg bg-violet-500/5 p-3 text-xs text-muted-foreground">
                  <Sparkles className="mr-1 inline h-3.5 w-3.5 text-violet-500" />
                  Fotky dokladů přikládáš k zakázkám a údaje vyplňuješ ručně — AI se z nich učí. {aiOffReason(access)}
                </p>
              )}
              <div className="grid grid-cols-2 gap-3 border-t pt-3 text-xs text-muted-foreground">
                <div>
                  <div className="font-medium text-foreground">Účet od</div>
                  {data.createdAt ? formatDate(data.createdAt) : "—"}
                </div>
                <div>
                  <div className="font-medium text-foreground">Naposledy přihlášen</div>
                  {data.lastSeenAt ? relativeTime(data.lastSeenAt) : "—"}
                </div>
              </div>
            </CardContent>
          </Card>

          <Card data-what-i-see>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base">
                <SectionIcon icon={Eye} tone="bg-violet-500/10 text-violet-600 dark:text-violet-400" /> Co vidím
              </CardTitle>
              <CardDescription>Kniha zakázek je společná, obchodní tok je tvůj.</CardDescription>
            </CardHeader>
            <CardContent>
              <ul className="space-y-2 text-sm leading-relaxed text-muted-foreground [&_strong]:text-foreground">
                {whatISee(hasAi).map((line, i) => (
                  <li key={i} className="flex gap-2">
                    <Check className="mt-1 h-3.5 w-3.5 shrink-0 text-success" aria-hidden />
                    <span className="min-w-0">{line}</span>
                  </li>
                ))}
              </ul>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base">
                <SectionIcon icon={Inbox} tone="bg-blue-500/10 text-blue-600 dark:text-blue-400" /> Moje e-mailové schránky
              </CardTitle>
              <CardDescription>
                {access.features.includes("mail_all")
                  ? "Jako super admin vidíš poštu všech schránek."
                  : "Vidíš jen poštu schránek, které ti přidělil super admin."}
              </CardDescription>
            </CardHeader>
            <CardContent>
              {data.mailboxes.length === 0 ? (
                <p className="rounded-lg border border-dashed p-4 text-center text-sm text-muted-foreground">
                  Zatím ti nebyla přidělena žádná schránka. Požádej super admina.
                </p>
              ) : (
                <ul className="space-y-2">
                  {data.mailboxes.map((m) => (
                    <li key={m.id} className="flex items-center gap-3 rounded-lg border p-3">
                      <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-blue-500/10 text-blue-600 dark:text-blue-400">
                        <Mail className="h-4 w-4" />
                      </span>
                      <div className="min-w-0 flex-1">
                        <div className="truncate text-sm font-medium">{m.displayName || m.email}</div>
                        <div className="truncate text-xs text-muted-foreground">
                          {m.displayName ? `${m.email} · ` : ""}
                          {m.lastSyncAt ? `staženo ${relativeTime(m.lastSyncAt)}` : "zatím nestaženo"}
                        </div>
                        {m.incomplete ? (
                          <div className="mt-0.5 text-xs text-amber-700 dark:text-amber-400">Nastavení schránky není kompletní — požádej super admina.</div>
                        ) : m.lastSyncError ? (
                          <div className="mt-0.5 break-words text-xs text-destructive">Poslední stažení selhalo: {m.lastSyncError}</div>
                        ) : null}
                      </div>
                      <Badge
                        variant={m.active ? "outline" : "muted"}
                        className={m.active ? "border-transparent bg-success/10 text-success" : undefined}
                      >
                        {m.active ? <><BadgeCheck className="h-3 w-3" /> aktivní</> : "vypnutá"}
                      </Badge>
                    </li>
                  ))}
                </ul>
              )}
              {access.features.includes("mail") && (
                <Link href="/inbox" className="mt-3 inline-block text-sm font-medium text-primary underline-offset-4 hover:underline">
                  Otevřít přijatou poštu
                </Link>
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
