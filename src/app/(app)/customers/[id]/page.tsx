import Link from "next/link";
import { notFound } from "next/navigation";
import {
  ArrowLeft, Banknote, BookOpen, Building2, CalendarClock, ClipboardList, ExternalLink, FileBox, FileText, Globe, Hash,
  Inbox, Mail, MapPin, Phone, ReceiptText, StickyNote, Truck, UserRound, Users,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { CategoryBadge, QuoteStatusBadge } from "@/components/status-badge";
import { CustomerPricingProfile } from "@/components/customer-pricing-profile";
import { CustomerDialog } from "@/components/customers/customer-dialog";
import { ContactsManager } from "@/components/customers/contacts-manager";
import { FriendlyEmpty } from "@/components/customers/friendly-empty";
import { JobMiniList } from "@/components/customers/job-mini-list";
import { addressLine, avatarToneFor, initialsOf, websiteHref } from "@/components/customers/model";
import { NewJobDialog } from "@/components/jobs/new-job-dialog";
import { CaptureButton } from "@/components/jobs/capture/capture-button";
import { requireFeature } from "@/lib/auth/session";
import { getCustomerDetail } from "@/lib/data/queries";
import { getJobFormOptions } from "@/lib/data/jobs";
import { CLOSED_STAGES } from "@/lib/jobs/stages";
import { plural } from "@/lib/jobs/deadlines";
import { cn, formatCZK, formatDate, relativeTime } from "@/lib/utils";

/** Karta zákazníka — údaje, kontakty a kompletní historie (zakázky, nabídky, pošta, výkresy). */
export default async function CustomerDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requireFeature("customers");
  const { id } = await params;
  const [detail, options] = await Promise.all([getCustomerDetail(id), getJobFormOptions()]);
  if (!detail) notFound();
  const { customer: c, contacts, jobs, quotes, emails, drawings, pricingRow } = detail;
  const owners = options.users.map((u) => ({ id: u.id, name: u.name, role: u.role }));

  const activeJobs = jobs.filter((j) => !CLOSED_STAGES.includes(j.stage));
  const closedJobs = jobs.filter((j) => CLOSED_STAGES.includes(j.stage));
  const lastJob = jobs[0] ?? null;
  const address = addressLine(c);
  const web = websiteHref(c.website);

  const tiles = [
    {
      label: "Rozpracované zakázky", value: String(activeJobs.length), icon: ClipboardList,
      tone: "bg-orange-50/80 dark:bg-orange-500/[0.07]", icon2: "bg-orange-500 text-white", num: "text-orange-700 dark:text-orange-300",
    },
    {
      label: "Zakázek celkem", value: String(jobs.length), icon: BookOpen,
      tone: "bg-slate-100/80 dark:bg-slate-500/[0.10]", icon2: "bg-slate-600 text-white", num: "text-slate-700 dark:text-slate-200",
    },
    {
      label: "Obrat bez DPH", value: formatCZK(c.revenue), icon: Banknote,
      tone: "bg-emerald-50/80 dark:bg-emerald-500/[0.07]", icon2: "bg-emerald-600 text-white", num: "text-emerald-700 dark:text-emerald-300",
    },
    {
      label: "Poslední zakázka", value: lastJob ? formatDate(lastJob.createdAt) : "—", icon: CalendarClock,
      tone: "bg-sky-50/80 dark:bg-sky-500/[0.07]", icon2: "bg-sky-500 text-white", num: "text-sky-700 dark:text-sky-300",
    },
  ];

  return (
    <div className="space-y-5">
      <Button asChild variant="ghost" size="sm" className="-ml-2">
        <Link href="/customers"><ArrowLeft /> Všichni zákazníci</Link>
      </Button>

      {/* Hlavička */}
      <section className="relative overflow-hidden rounded-2xl border bg-gradient-to-br from-green-50 via-card to-card p-4 shadow-sm dark:from-green-500/[0.08] sm:p-5">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-start">
          <span className={cn("flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl text-lg font-bold", avatarToneFor(c.name))}>
            {initialsOf(c.name)}
          </span>
          <div className="min-w-0 flex-1 space-y-1.5">
            <h1 className="text-xl font-semibold tracking-tight sm:text-2xl">{c.name}</h1>
            <div className="flex flex-wrap items-center gap-1.5 text-xs">
              {c.customerNumber && (
                <span className="inline-flex items-center gap-0.5 rounded-md bg-green-600 px-2 py-0.5 font-semibold text-white" title="Naše číslo zákazníka">
                  <Hash className="h-3 w-3" />{c.customerNumber}
                </span>
              )}
              {c.ico && <span className="rounded-md bg-background/80 px-2 py-0.5 font-medium ring-1 ring-border">IČO {c.ico}</span>}
              {c.dic && <span className="rounded-md bg-background/80 px-2 py-0.5 font-medium ring-1 ring-border">DIČ {c.dic}</span>}
              <span className="rounded-md bg-background/80 px-2 py-0.5 font-medium ring-1 ring-border">{c.country}</span>
              {c.owner && (
                <span className="inline-flex items-center gap-1 rounded-md bg-sky-100 px-2 py-0.5 font-medium text-sky-800 dark:bg-sky-500/15 dark:text-sky-300">
                  <UserRound className="h-3 w-3" /> obchodník {c.owner.name}
                </span>
              )}
            </div>
          </div>
          <div className="flex flex-wrap gap-2 sm:justify-end">
            <CustomerDialog customer={c} owners={owners} />
            <NewJobDialog
              options={options}
              initial={{ customerId: c.id, ownerId: c.owner?.id ?? user.id, stage: "objednavka" }}
              label="Nová zakázka"
            />
            <CaptureButton label="Vyfotit doklad" size="default" />
          </div>
        </div>
      </section>

      {/* Dlaždice */}
      <div className="grid grid-cols-2 gap-2 lg:grid-cols-4">
        {tiles.map((t) => (
          <div key={t.label} className={cn("flex items-center gap-3 rounded-2xl border p-3", t.tone)}>
            <span className={cn("flex h-9 w-9 shrink-0 items-center justify-center rounded-xl", t.icon2)}>
              <t.icon className="h-4 w-4" />
            </span>
            <div className="min-w-0">
              <div className={cn("truncate text-lg font-bold leading-tight", t.num)}>{t.value}</div>
              <div className="truncate text-xs text-muted-foreground">{t.label}</div>
            </div>
          </div>
        ))}
      </div>

      <div className="grid gap-5 lg:grid-cols-3">
        <div className="space-y-5 lg:col-span-2">
          {/* Zakázky */}
          <Panel
            icon={<ClipboardList />}
            tone="bg-orange-100 text-orange-700 dark:bg-orange-500/15 dark:text-orange-300"
            title={`Zakázky (${jobs.length})`}
            action={
              jobs.length > 0 ? (
                <Button asChild variant="ghost" size="sm">
                  <Link href={`/orders?segment=vse&customer=${c.id}`}>V Knize zakázek <ExternalLink /></Link>
                </Button>
              ) : undefined
            }
          >
            {jobs.length === 0 ? (
              <FriendlyEmpty
                compact
                icon={<ClipboardList />}
                tone="bg-orange-100 text-orange-700 dark:bg-orange-500/15 dark:text-orange-300"
                title="Zatím žádná zakázka"
              >
                Vyfoť poptávku nebo objednávku tohoto zákazníka — AI ji spáruje sama. Nebo založ zakázku tlačítkem nahoře.
              </FriendlyEmpty>
            ) : (
              <div className="space-y-4">
                {activeJobs.length > 0 && <JobMiniList jobs={activeJobs} />}
                {closedJobs.length > 0 && (
                  <details className="group" open={activeJobs.length === 0}>
                    <summary className="cursor-pointer list-none text-xs font-semibold text-muted-foreground hover:text-foreground [&::-webkit-details-marker]:hidden">
                      <span className="group-open:hidden">▸</span><span className="hidden group-open:inline">▾</span>{" "}
                      Uzavřené ({closedJobs.length} {plural(closedJobs.length, "zakázka", "zakázky", "zakázek")})
                    </summary>
                    <JobMiniList jobs={closedJobs} className="mt-2" />
                  </details>
                )}
              </div>
            )}
          </Panel>

          {/* Nabídky */}
          <Panel icon={<FileText />} tone="bg-violet-100 text-violet-700 dark:bg-violet-500/15 dark:text-violet-300" title={`Nabídky (${quotes.length})`}>
            {quotes.length === 0 ? (
              <p className="rounded-xl border border-dashed p-4 text-center text-sm text-muted-foreground">
                Žádné nabídky. Nabídku připravíš na kartě zakázky v záložce Nabídky.
              </p>
            ) : (
              <ul className="divide-y rounded-xl border">
                {quotes.slice(0, 15).map((q) => {
                  const inner = (
                    <>
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="font-mono text-sm font-semibold">{q.number}</span>
                          <QuoteStatusBadge status={q.status} />
                          {q.accepted && (
                            <span className="rounded-full bg-green-600 px-1.5 py-0.5 text-[10px] font-semibold text-white">přijatá</span>
                          )}
                        </div>
                        <p className="truncate text-xs text-muted-foreground">
                          {[q.job ? `zakázka ${q.job.number}` : null, q.title, q.createdBy ? `zadal ${q.createdBy.name}` : null,
                            q.approvedBy ? `schválil ${q.approvedBy.name}` : null].filter(Boolean).join(" · ")}
                        </p>
                      </div>
                      <div className="shrink-0 text-right">
                        <div className="text-sm font-semibold">{q.total !== null ? formatCZK(q.total) : <span className="text-muted-foreground">bez ceny</span>}</div>
                        <div className="text-[11px] text-muted-foreground">{formatDate(q.createdAt)}</div>
                      </div>
                    </>
                  );
                  return (
                    <li key={q.id}>
                      {q.job ? (
                        <Link href={`/orders/${q.job.id}`} className="flex items-center gap-3 px-3 py-2.5 transition hover:bg-accent/60">{inner}</Link>
                      ) : (
                        <div className="flex items-center gap-3 px-3 py-2.5">{inner}</div>
                      )}
                    </li>
                  );
                })}
              </ul>
            )}
          </Panel>

          {/* Komunikace */}
          <Panel icon={<Inbox />} tone="bg-blue-100 text-blue-700 dark:bg-blue-500/15 dark:text-blue-300" title={`Komunikace (${emails.length})`}>
            {emails.length === 0 ? (
              <p className="rounded-xl border border-dashed p-4 text-center text-sm text-muted-foreground">
                Žádné e-maily tohoto zákazníka ve tvé poště. Jakmile AI pozná odesílatele, e-maily se sem přiřadí samy.
              </p>
            ) : (
              <ul className="space-y-1">
                {emails.slice(0, 12).map((e) => (
                  <li key={e.id}>
                    <Link
                      href={e.jobId ? `/orders/${e.jobId}` : "/inbox"}
                      className="flex items-center gap-3 rounded-xl px-2 py-2 transition hover:bg-accent/60"
                    >
                      <span className={cn("h-2 w-2 shrink-0 rounded-full", e.unread ? "bg-blue-500" : "bg-transparent")} />
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className={cn("truncate text-sm", e.unread ? "font-semibold" : "font-medium")}>{e.from}</span>
                          <CategoryBadge category={e.category} />
                          {e.jobNumber && <span className="font-mono text-[11px] text-muted-foreground">{e.jobNumber}</span>}
                        </div>
                        <p className="truncate text-xs text-muted-foreground">{e.subject || "(bez předmětu)"}</p>
                      </div>
                      <span className="shrink-0 text-[11px] text-muted-foreground">{relativeTime(e.receivedAt)}</span>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </Panel>
        </div>

        <div className="space-y-5">
          {/* Údaje */}
          <Panel icon={<Building2 />} tone="bg-green-100 text-green-700 dark:bg-green-500/15 dark:text-green-300" title="Údaje firmy">
            <dl className="space-y-2.5 text-sm">
              <InfoRow icon={<MapPin className="text-violet-500" />} label="Sídlo" value={address} />
              <InfoRow icon={<Truck className="text-green-600" />} label="Dodací adresa" value={c.deliveryAddress} />
              <InfoRow icon={<UserRound className="text-sky-500" />} label="Kontaktní osoba" value={c.contactPerson} />
              <InfoRow
                icon={<Mail className="text-sky-500" />}
                label="E-mail"
                value={c.email ? <a href={`mailto:${c.email}`} className="text-sky-700 hover:underline dark:text-sky-400">{c.email}</a> : null}
              />
              <InfoRow
                icon={<Phone className="text-emerald-500" />}
                label="Telefon"
                value={c.phone ? <a href={`tel:${c.phone.replace(/\s/g, "")}`} className="text-emerald-700 hover:underline dark:text-emerald-400">{c.phone}</a> : null}
              />
              <InfoRow
                icon={<Globe className="text-indigo-500" />}
                label="Web"
                value={web ? <a href={web} target="_blank" rel="noreferrer" className="text-indigo-700 hover:underline dark:text-indigo-400">{c.website}</a> : c.website}
              />
              <InfoRow
                icon={<ReceiptText className="text-amber-500" />}
                label="Splatnost faktur"
                value={c.paymentTermsDays !== null ? `${c.paymentTermsDays} ${plural(c.paymentTermsDays, "den", "dny", "dní")}` : null}
              />
              <InfoRow icon={<Hash className="text-orange-500" />} label="Naše číslo dodavatele u zákazníka" value={c.supplierNumberAtCustomer} />
              <InfoRow icon={<StickyNote className="text-yellow-500" />} label="Poznámka" value={c.note ? <span className="whitespace-pre-line">{c.note}</span> : null} />
            </dl>
            {!address && !c.email && !c.phone && (
              <p className="mt-3 rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-800 dark:bg-amber-500/10 dark:text-amber-300">
                {"Chybí adresa a kontakt — doplň je přes „Upravit“, ať jsou správně na nabídkách a fakturách."}
              </p>
            )}
          </Panel>

          {/* Kontaktní osoby */}
          <Panel icon={<Users />} tone="bg-sky-100 text-sky-700 dark:bg-sky-500/15 dark:text-sky-300" title={`Kontaktní osoby (${contacts.length})`}>
            <ContactsManager customerId={c.id} contacts={contacts} />
          </Panel>

          {/* Výkresy — jen s právem na archiv výkresů */}
          {drawings !== null && (
            <Panel icon={<FileBox />} tone="bg-indigo-100 text-indigo-700 dark:bg-indigo-500/15 dark:text-indigo-300" title={`Výkresy v archivu (${drawings.length})`}>
              {drawings.length === 0 ? (
                <p className="text-sm text-muted-foreground">Žádné výkresy tohoto zákazníka v archivu.</p>
              ) : (
                <ul className="space-y-1">
                  {drawings.slice(0, 12).map((d) => (
                    <li key={d.id} className="flex items-center gap-2 rounded-lg px-2 py-1.5 text-sm">
                      <span className="font-mono font-medium">{d.number}</span>
                      <span className="rounded bg-blue-100 px-1.5 py-0.5 text-[10px] font-semibold text-blue-800 dark:bg-blue-500/15 dark:text-blue-300">rev. {d.revision}</span>
                      <span className="truncate text-xs text-muted-foreground">{d.material !== "—" ? d.material : ""}</span>
                      <span className="ml-auto shrink-0 text-[11px] text-muted-foreground">{formatDate(d.uploadedAt)}</span>
                    </li>
                  ))}
                </ul>
              )}
            </Panel>
          )}
        </div>
      </div>

      {pricingRow && <CustomerPricingProfile customer={pricingRow} />}
    </div>
  );
}

function Panel({
  icon,
  tone,
  title,
  action,
  children,
}: {
  icon: React.ReactNode;
  tone: string;
  title: string;
  action?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section className="rounded-2xl border bg-card p-4 shadow-sm">
      <div className="mb-3 flex items-center gap-2.5">
        <span className={cn("flex h-8 w-8 shrink-0 items-center justify-center rounded-lg [&_svg]:h-4 [&_svg]:w-4", tone)}>{icon}</span>
        <h2 className="min-w-0 flex-1 truncate text-base font-semibold">{title}</h2>
        {action}
      </div>
      {children}
    </section>
  );
}

function InfoRow({ icon, label, value }: { icon: React.ReactNode; label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-start gap-2.5">
      <span className="mt-0.5 shrink-0 [&_svg]:h-4 [&_svg]:w-4">{icon}</span>
      <div className="min-w-0">
        <dt className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">{label}</dt>
        <dd className={cn("break-words", value ? "" : "text-muted-foreground")}>{value || "—"}</dd>
      </div>
    </div>
  );
}
