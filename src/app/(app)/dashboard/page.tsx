import Link from "next/link";
import {
  AlarmClock, ArrowRight, Bot, CalendarClock, CheckCircle2, Circle, ClipboardList, Flame, History, Inbox,
  ListChecks, Mail, MessageSquareQuote, Rocket, ShieldAlert, ShoppingCart, Sparkles, Wallet, type LucideIcon,
} from "lucide-react";
import { PageHeader } from "@/components/page-header";
import { ApprovalQueue } from "@/components/approval-queue";
import { Button } from "@/components/ui/button";
import { CategoryBadge } from "@/components/status-badge";
import { QuoteApprovalList } from "@/components/flow/quote-approval-list";
import { AiConfidence } from "@/components/ai-confidence";
import { CaptureButton } from "@/components/jobs/capture/capture-button";
import { FriendlyEmpty } from "@/components/customers/friendly-empty";
import { JobMiniList } from "@/components/customers/job-mini-list";
import { CLOSED_STAGES, STAGES, STAGE_ORDER } from "@/lib/jobs/stages";
import { bookKpis, segmentOfStage } from "@/components/jobs/book/book-params";
import { requireFeature, getAccess } from "@/lib/auth/session";
import {
  FLOW_TILES, getEmails, getApprovalQueue, getCommissions, getFlowDashboard, getResolvedApprovals, listPendingQuoteApprovals,
} from "@/lib/data/queries";
import { FlowStateTiles, MoversPanel } from "@/components/dashboard/flow-overview";
import { getJobStageCounts, listJobs } from "@/lib/data/jobs";
import { getSetupChecklist } from "@/lib/setup/status";
import { getAnonReviewCount } from "@/lib/data/anonymize";
import { EyeOff } from "lucide-react";
import { cn, formatCZK, relativeTime } from "@/lib/utils";

/**
 * AI přehled (super admin): co AI udělala a co čeká na rozhodnutí — fronta
 * schvalování, AI pošta, rozložení zakázek podle stavů a co hoří. Všechny
 * dlaždice vedou rovnou do Knihy zakázek s nastaveným filtrem.
 */
export default async function DashboardPage() {
  await requireFeature("dashboard");
  const { can } = await getAccess();
  const [emails, approvals, counts, recent, overdue, quotes, commissions, setup, flow, resolved, anonReview] = await Promise.all([
    getEmails(),
    getApprovalQueue(),
    getJobStageCounts(),
    listJobs({ sort: "updated", dir: "desc", limit: 6 }),
    listJobs({ group: "aktivni", deadline: "overdue", sort: "deadline", dir: "asc", limit: 5 }),
    listPendingQuoteApprovals(),
    can("commissions") ? getCommissions("month") : Promise.resolve([]),
    getSetupChecklist(),
    getFlowDashboard(),
    getResolvedApprovals(5),
    // dřív až po všem ostatním (o round-trip později)
    getAnonReviewCount(),
  ]);
  // #25: dlaždice = fronta AI + ruční nabídky kolegů (oba panely níže je vypíšou)
  const waitingApproval = approvals.length + quotes.length;
  // chip „Ke schválení“ = stejné nabídky jako panel níže (ruční kolegů + AI ve frontě), ne vrácené autorovi
  const flowCounts = {
    ...flow.counts,
    "quote.ke_schvaleni": quotes.length + approvals.filter((a) => a.rawType === "quote").length,
  };

  const kpis = bookKpis(counts);
  const mail = emails.filter((e) => e.category !== "Spam");
  const unread = mail.filter((e) => e.unread).length;
  const aiSorted = mail.filter((e) => e.aiConfidence > 0).length;
  const commissionTotal = commissions.reduce((s, c) => s + c.commission, 0);

  const tiles: Tile[] = [
    // = záložka Objednávky v Knize (bez vystaveného DL na vše) — bookKpis z getJobStageCounts
    { label: "Objednávky v běhu", value: kpis.ordersRunning, hint: "objednávka → dodací list", icon: ShoppingCart, href: "/orders", tone: TONE.orange },
    {
      label: "Po termínu", value: kpis.overdue, hint: kpis.overdue ? "hoří — řeš hned" : "vše v termínu", icon: AlarmClock,
      href: "/orders?segment=vse&deadline=overdue", tone: kpis.overdue ? TONE.red : TONE.green,
    },
    { label: "Termín do 7 dní", value: kpis.dueSoon, hint: "připrav dodání", icon: CalendarClock, href: "/orders?segment=vse&deadline=week", tone: TONE.amber },
    { label: "Poptávky & nabídky", value: kpis.inquiries, hint: "před objednávkou", icon: MessageSquareQuote, href: "/orders?segment=poptavky", tone: TONE.sky },
    { label: "Čeká na schválení", value: waitingApproval, hint: waitingApproval ? "jedním klikem níže" : "fronta je prázdná", icon: ListChecks, href: "#fronta", tone: TONE.fuchsia },
    { label: "Nepřečtená pošta", value: unread, hint: `${aiSorted} roztřídila AI`, icon: Inbox, href: "/inbox", tone: TONE.blue },
  ];

  // Rozložení rozpracovaných zakázek podle stavů (barevný pruh + legenda)
  const distribution = STAGE_ORDER
    .filter((s) => !CLOSED_STAGES.includes(s))
    .map((s) => ({ stage: s, count: counts.byStage[s] ?? 0 }))
    .filter((x) => x.count > 0);
  const distTotal = distribution.reduce((n, x) => n + x.count, 0);

  const checklist = [
    { label: "Připojit Supabase databázi", done: setup.supabase.configured && setup.supabase.secretKeySet, href: "/setup" },
    { label: "Zapnout AI (Claude API klíč)", done: setup.aiConfigured, href: "/setup" },
    { label: "Přidat e-mailovou schránku", done: setup.mailboxCount > 0, href: "/settings" },
    { label: "Vyplnit firemní údaje (jdou na nabídky a faktury)", done: setup.companyFilled, href: "/setup" },
  ];
  const setupDone = checklist.every((c) => c.done);

  return (
    <div className="space-y-5">
      <PageHeader
        title="AI přehled"
        description="Co AI udělala sama a co čeká na tvoje rozhodnutí. Hlavní práce dál běží v Knize zakázek."
        actions={
          <>
            <CaptureButton label="Vyfotit doklad" className="flex-1 sm:flex-none" />
            <Button asChild variant="outline" className="flex-1 sm:flex-none">
              <Link href="/orders"><ClipboardList /> Kniha zakázek</Link>
            </Button>
          </>
        }
      />

      {!setupDone && (
        <section className="rounded-2xl border border-primary/30 bg-primary/5 p-4">
          <h2 className="mb-2 flex items-center gap-2 text-sm font-semibold">
            <Rocket className="h-4 w-4 text-primary" /> Dokonči zprovoznění — pak vše pojede samo
          </h2>
          <div className="grid gap-1 sm:grid-cols-2">
            {checklist.map((item) => (
              <Link key={item.label} href={item.href} className="flex items-center gap-2 rounded-lg px-2 py-1.5 text-sm transition hover:bg-accent">
                {item.done ? <CheckCircle2 className="h-4 w-4 shrink-0 text-success" /> : <Circle className="h-4 w-4 shrink-0 text-muted-foreground" />}
                <span className={cn(item.done && "text-muted-foreground line-through")}>{item.label}</span>
                {!item.done && <ArrowRight className="ml-auto h-3.5 w-3.5 text-muted-foreground" />}
              </Link>
            ))}
          </div>
        </section>
      )}

      {anonReview > 0 && (
        <Link
          href="/inquiries#anonymizace"
          data-testid="dashboard-anon-review"
          className="flex items-center gap-3 rounded-2xl border border-rose-200 bg-rose-50/70 px-4 py-3 text-sm transition hover:shadow-md dark:border-rose-500/20 dark:bg-rose-500/10"
        >
          <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-rose-100 text-rose-700 dark:bg-rose-500/20 dark:text-rose-300"><EyeOff className="h-4 w-4" /></span>
          <span className="min-w-0 flex-1">
            <strong className="text-rose-800 dark:text-rose-200">{anonReview} {anonReview === 1 ? "výkres" : anonReview < 5 ? "výkresy" : "výkresů"} — anonymizace se nepovedla</strong>
            <span className="block text-xs text-muted-foreground">Dodavateli zatím nepůjdou. Otevři a zkus „Anonymizovat znovu“, nebo nahraj výkres jako PDF.</span>
          </span>
          <ArrowRight className="h-4 w-4 text-muted-foreground" />
        </Link>
      )}

      {/* Dlaždice → filtr v Knize zakázek */}
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 xl:grid-cols-6">
        {tiles.map((t) => (
          <Link
            key={t.label}
            href={t.href}
            className={cn("group flex flex-col gap-2 rounded-2xl border p-3 transition hover:shadow-md", t.tone.tile)}
          >
            <div className="flex items-center justify-between">
              <span className={cn("flex h-8 w-8 items-center justify-center rounded-xl", t.tone.icon)}>
                <t.icon className="h-4 w-4" />
              </span>
              <ArrowRight className="h-3.5 w-3.5 text-muted-foreground opacity-0 transition group-hover:opacity-100" />
            </div>
            <div>
              <div className={cn("text-2xl font-bold leading-none", t.tone.num)}>{t.value}</div>
              <div className="mt-1 text-xs font-medium">{t.label}</div>
              <div className="text-[11px] text-muted-foreground">{t.hint}</div>
            </div>
          </Link>
        ))}
      </div>

      {/* Podrobné stavy toku — co čeká na koho */}
      <FlowStateTiles tiles={FLOW_TILES} counts={flowCounts} />

      {/* Kde jsou zakázky */}
      <section className="rounded-2xl border bg-card p-4 shadow-sm">
        <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
          <h2 className="text-base font-semibold">Kde jsou rozpracované zakázky</h2>
          <span className="text-xs text-muted-foreground">{distTotal} celkem · klikni na barvu pro filtr</span>
        </div>
        {distTotal === 0 ? (
          <p className="text-sm text-muted-foreground">Zatím žádná rozpracovaná zakázka — vyfoť první poptávku nebo objednávku.</p>
        ) : (
          <>
            <div className="flex h-4 w-full overflow-hidden rounded-full bg-muted">
              {distribution.map((x) => (
                <Link
                  key={x.stage}
                  href={`/orders?segment=${segmentOfStage(x.stage)}&stages=${x.stage}`}
                  title={`${STAGES[x.stage].label}: ${x.count}`}
                  className={cn("h-full transition hover:opacity-80", STAGES[x.stage].bar)}
                  style={{ width: `${(x.count / distTotal) * 100}%` }}
                />
              ))}
            </div>
            <div className="mt-3 flex flex-wrap gap-1.5">
              {distribution.map((x) => {
                const m = STAGES[x.stage];
                const Icon = m.icon;
                return (
                  <Link
                    key={x.stage}
                    href={`/orders?segment=${segmentOfStage(x.stage)}&stages=${x.stage}`}
                    className={cn("inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-medium transition hover:brightness-95", m.badge)}
                  >
                    <Icon className="h-3 w-3" /> {m.label} <b className="ml-0.5">{x.count}</b>
                  </Link>
                );
              })}
            </div>
          </>
        )}
      </section>

      {/* grid-cols-1 + min-w-0: na mobilu se sloupec nesmí roztáhnout podle nejširšího obsahu */}
      <div className="grid grid-cols-1 gap-5 lg:grid-cols-5">
        <div className="min-w-0 space-y-5 lg:col-span-3">
          <div id="fronta" className="scroll-mt-4 space-y-5">
            <Panel
              icon={<ShieldAlert />}
              tone="bg-amber-100 text-amber-800 dark:bg-amber-500/15 dark:text-amber-300"
              title={`Nabídky ke schválení (${quotes.length})`}
              hint="Nabídky od kolegů a od AI. Bez schválení je nejde odeslat."
              action={<Button asChild variant="ghost" size="sm"><Link href="/quotes#ke-schvaleni">Nabídky <ArrowRight /></Link></Button>}
            >
              <QuoteApprovalList items={quotes} stacked />
            </Panel>
            <ApprovalQueue initialItems={approvals} recent={resolved} />
          </div>

          <Panel
            icon={<Bot />}
            tone="bg-blue-100 text-blue-700 dark:bg-blue-500/15 dark:text-blue-300"
            title="AI pošta"
            hint="Nejnovější e-maily ze všech schránek — AI je roztřídila a přiřadila."
            action={<Button asChild variant="ghost" size="sm"><Link href="/inbox">Pošta <ArrowRight /></Link></Button>}
          >
            {mail.length === 0 ? (
              <FriendlyEmpty
                compact
                icon={<Mail />}
                tone="bg-blue-100 text-blue-700 dark:bg-blue-500/15 dark:text-blue-300"
                title="Zatím žádná pošta"
                actions={<Button asChild variant="outline" size="sm"><Link href="/settings">Nastavit schránku</Link></Button>}
              >
                Přidej schránku v Nastavení (Outlook / IMAP) — AI pak každý e-mail sama roztřídí a připojí k zakázce.
              </FriendlyEmpty>
            ) : (
              <ul className="space-y-1">
                {mail.slice(0, 6).map((e) => (
                  <li key={e.id}>
                    <Link
                      href={e.jobId ? `/orders/${e.jobId}` : "/inbox"}
                      className="flex items-start gap-3 rounded-xl px-2 py-2 transition hover:bg-accent/60"
                    >
                      <span className={cn("mt-1.5 h-2 w-2 shrink-0 rounded-full", e.unread ? "bg-blue-500" : "bg-transparent")} />
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className={cn("truncate text-sm", e.unread ? "font-semibold" : "font-medium")}>{e.from}</span>
                          <CategoryBadge category={e.category} />
                          {e.jobNumber && <span className="font-mono text-[11px] text-muted-foreground">{e.jobNumber}</span>}
                        </div>
                        <p className="truncate text-sm text-muted-foreground">{e.subject || "(bez předmětu)"}</p>
                        {e.aiSummary && (
                          <p className="mt-0.5 line-clamp-1 text-xs text-fuchsia-700 dark:text-fuchsia-300">
                            <Sparkles className="mr-1 inline h-3 w-3" />{e.aiSummary}
                          </p>
                        )}
                      </div>
                      <div className="flex shrink-0 flex-col items-end gap-1">
                        <span className="text-[11px] text-muted-foreground">{relativeTime(e.receivedAt)}</span>
                        {e.aiConfidence > 0 && <AiConfidence value={e.aiConfidence} />}
                      </div>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </Panel>
        </div>

        <div className="min-w-0 space-y-5 lg:col-span-2">
          <MoversPanel movers={flow.movers} total={flow.movedToday} />

          <Panel
            icon={<Flame />}
            tone="bg-red-100 text-red-700 dark:bg-red-500/15 dark:text-red-300"
            title="Hoří — po termínu"
            action={overdue.length ? <Button asChild variant="ghost" size="sm"><Link href="/orders?segment=vse&deadline=overdue">Vše <ArrowRight /></Link></Button> : undefined}
          >
            {overdue.length === 0 ? (
              <p className="flex items-center gap-2 rounded-xl bg-green-50 px-3 py-2.5 text-sm text-green-800 dark:bg-green-500/10 dark:text-green-300">
                <CheckCircle2 className="h-4 w-4 shrink-0" /> Žádná zakázka po termínu. Paráda.
              </p>
            ) : (
              <JobMiniList jobs={overdue} showCustomer />
            )}
          </Panel>

          <Panel
            icon={<History />}
            tone="bg-slate-100 text-slate-700 dark:bg-slate-500/15 dark:text-slate-300"
            title="Naposledy změněné zakázky"
            action={<Button asChild variant="ghost" size="sm"><Link href="/orders?segment=vse&sort=updated">Kniha <ArrowRight /></Link></Button>}
          >
            {recent.length === 0 ? (
              <p className="text-sm text-muted-foreground">Kniha zakázek je zatím prázdná.</p>
            ) : (
              <JobMiniList jobs={recent} showCustomer />
            )}
          </Panel>

          {can("commissions") && (
            <Link
              href="/commissions"
              className="flex items-center gap-3 rounded-2xl border bg-emerald-50/70 p-4 transition hover:shadow-md dark:bg-emerald-500/[0.07]"
            >
              <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-emerald-600 text-white"><Wallet className="h-5 w-5" /></span>
              <div className="min-w-0 flex-1">
                <div className="text-lg font-bold text-emerald-700 dark:text-emerald-300">{formatCZK(commissionTotal)}</div>
                <div className="text-xs text-muted-foreground">Provize obchodníků tento měsíc</div>
              </div>
              <ArrowRight className="h-4 w-4 text-muted-foreground" />
            </Link>
          )}

          <section className="space-y-2 rounded-2xl border bg-card p-4 text-sm">
            <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Jak číst tlačítka</div>
            <div className="flex items-center gap-2"><span className="h-3 w-3 shrink-0 rounded-full bg-success" /><span><b>Zelená</b> — uloží / potvrdí. Nic neodejde z firmy.</span></div>
            <div className="flex items-center gap-2"><span className="h-3 w-3 shrink-0 rounded-full bg-primary" /><span><b>Červená</b> — odešle něco zákazníkovi či dodavateli.</span></div>
            <div className="flex items-center gap-2"><span className="h-3 w-3 shrink-0 rounded-full bg-warning" /><span><b>Oranžová</b> — čeká na tvoje rozhodnutí.</span></div>
          </section>
        </div>
      </div>
    </div>
  );
}

interface Tile {
  label: string;
  value: number;
  hint: string;
  icon: LucideIcon;
  href: string;
  tone: { tile: string; icon: string; num: string };
}

const TONE = {
  orange: { tile: "bg-orange-50/70 dark:bg-orange-500/[0.07]", icon: "bg-orange-500 text-white", num: "text-orange-700 dark:text-orange-300" },
  red: { tile: "bg-red-50/70 dark:bg-red-500/[0.07]", icon: "bg-red-600 text-white", num: "text-red-700 dark:text-red-300" },
  green: { tile: "bg-green-50/70 dark:bg-green-500/[0.07]", icon: "bg-green-600 text-white", num: "text-green-700 dark:text-green-300" },
  amber: { tile: "bg-amber-50/70 dark:bg-amber-500/[0.07]", icon: "bg-amber-500 text-white", num: "text-amber-700 dark:text-amber-300" },
  sky: { tile: "bg-sky-50/70 dark:bg-sky-500/[0.07]", icon: "bg-sky-500 text-white", num: "text-sky-700 dark:text-sky-300" },
  fuchsia: { tile: "bg-fuchsia-50/70 dark:bg-fuchsia-500/[0.07]", icon: "bg-fuchsia-600 text-white", num: "text-fuchsia-700 dark:text-fuchsia-300" },
  blue: { tile: "bg-blue-50/70 dark:bg-blue-500/[0.07]", icon: "bg-blue-600 text-white", num: "text-blue-700 dark:text-blue-300" },
} as const;

function Panel({
  icon,
  tone,
  title,
  hint,
  action,
  children,
}: {
  icon: React.ReactNode;
  tone: string;
  title: string;
  hint?: string;
  action?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section className="rounded-2xl border bg-card p-4 shadow-sm">
      <div className="mb-3 flex items-start gap-2.5">
        <span className={cn("flex h-8 w-8 shrink-0 items-center justify-center rounded-lg [&_svg]:h-4 [&_svg]:w-4", tone)}>{icon}</span>
        <div className="min-w-0 flex-1">
          <h2 className="truncate text-base font-semibold leading-8">{title}</h2>
          {hint && <p className="-mt-1 text-xs text-muted-foreground">{hint}</p>}
        </div>
        {action}
      </div>
      {children}
    </section>
  );
}
