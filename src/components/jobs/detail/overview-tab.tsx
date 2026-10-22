"use client";

import * as React from "react";
import Link from "next/link";
import {
  Building2, UserRound, Mail, Phone, Hash, FileDigit, Users, Factory, Truck, StickyNote, Tag, Calculator, Percent,
  ShoppingCart, ReceiptText, MessageSquareQuote, Banknote, Wrench, MapPin, ClipboardList, X, Plus, Loader2,
  CalendarDays, BadgeCheck, PenLine, ExternalLink, Handshake, type LucideIcon,
} from "lucide-react";
import type { JobDetail } from "@/lib/jobs/types";
import { cn } from "@/lib/utils";
import { useJobDetail } from "./detail-context";
import { JobField, InlineSelect, PersonChip, type SelectOption } from "./inline-field";
import { SearchSelect, type SearchOption } from "./search-select";
import { formatPercent, longDate, parseTags, tagTone } from "./detail-helpers";
import { openProductionTab } from "@/components/jobs/production/production-chip";

function InfoCard({
  icon: Icon, tone, title, subtitle, children, className,
}: { icon: LucideIcon; tone: string; title: string; subtitle?: string; children: React.ReactNode; className?: string }) {
  return (
    <section className={cn("rounded-xl border bg-card shadow-sm", className)}>
      <header className="flex items-center gap-2.5 border-b px-4 py-3">
        <span className={cn("flex h-8 w-8 shrink-0 items-center justify-center rounded-lg", tone)}>
          <Icon className="h-4 w-4" />
        </span>
        <div className="min-w-0">
          <h3 className="text-sm font-semibold leading-tight">{title}</h3>
          {subtitle && <p className="truncate text-xs text-muted-foreground">{subtitle}</p>}
        </div>
      </header>
      <div className="grid gap-3 p-4">{children}</div>
    </section>
  );
}

function ReadOnly({ label, icon: Icon, iconClass, children }: { label: string; icon?: LucideIcon; iconClass?: string; children: React.ReactNode }) {
  return (
    <div className="min-w-0">
      <div className="mb-0.5 flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
        {Icon && <Icon className={cn("h-3.5 w-3.5", iconClass)} />}
        {label}
        <span className="rounded bg-muted px-1 text-[9px] font-normal uppercase tracking-wide">auto</span>
      </div>
      <div className="text-sm">{children}</div>
    </div>
  );
}

/** Štítky: klik na × odebere, Enter / čárka přidá. */
function TagsEditor({ tags }: { tags: string[] }) {
  const { save } = useJobDetail();
  const [draft, setDraft] = React.useState("");
  const [saving, setSaving] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [local, setLocal] = React.useState<string[] | null>(null);
  const [synced, setSynced] = React.useState(tags);
  if (tags !== synced) {
    setSynced(tags);
    setLocal(null);
  }
  const shown = local ?? tags;

  async function commit(next: string[]) {
    setLocal(next);
    setSaving(true);
    setError(null);
    const err = await save({ tags: next });
    setSaving(false);
    if (err) {
      setLocal(null);
      setError(err);
    }
  }

  function add() {
    const next = parseTags(draft, shown);
    setDraft("");
    if (next.length !== shown.length) void commit(next);
  }

  return (
    <div>
      <div className="mb-1 flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
        <Tag className="h-3.5 w-3.5 text-pink-500" /> Štítky
        {saving && <Loader2 className="h-3 w-3 animate-spin" />}
      </div>
      <div className="flex flex-wrap items-center gap-1.5">
        {shown.map((t) => (
          <span key={t} className={cn("inline-flex items-center gap-1 rounded-full py-0.5 pl-2 pr-1 text-xs font-medium", tagTone(t))}>
            {t}
            <button
              type="button"
              onClick={() => void commit(shown.filter((x) => x !== t))}
              className="rounded-full p-0.5 opacity-60 transition hover:bg-black/10 hover:opacity-100 dark:hover:bg-white/10"
              aria-label={`Odebrat štítek ${t}`}
            >
              <X className="h-3 w-3" />
            </button>
          </span>
        ))}
        <span className="inline-flex items-center gap-1 rounded-full border border-dashed border-muted-foreground/30 py-0.5 pl-2 pr-1">
          <input
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === ",") {
                e.preventDefault();
                add();
              }
            }}
            onBlur={() => draft.trim() && add()}
            placeholder={shown.length ? "další…" : "např. expres, kalení"}
            aria-label="Nový štítek"
            className="w-28 bg-transparent text-xs outline-none placeholder:text-muted-foreground"
          />
          <button type="button" onClick={add} className="rounded-full p-0.5 text-muted-foreground hover:text-foreground" aria-label="Přidat štítek">
            <Plus className="h-3 w-3" />
          </button>
        </span>
      </div>
      {error && <p role="alert" className="mt-1 text-xs text-red-600 dark:text-red-400">{error}</p>}
    </div>
  );
}

/** Záložka Přehled — vše upravitelné na místě (klik → uprav → Enter). */
export function OverviewTab({ job }: { job: JobDetail }) {
  const { options, perms, save } = useJobDetail();

  const customerOptions = React.useMemo<SearchOption[]>(
    () => options.customers.map((c) => ({
      value: c.id,
      label: c.name,
      sub: [c.customerNumber ? `zák. č. ${c.customerNumber}` : null, c.ico ? `IČO ${c.ico}` : null].filter(Boolean).join(" · ") || null,
    })),
    [options.customers],
  );
  const supplierOptions = React.useMemo<SearchOption[]>(
    () => options.suppliers.map((s) => ({ value: s.id, label: s.name })),
    [options.suppliers],
  );
  const people = React.useMemo<SelectOption[]>(() => {
    const list = options.users.map((u) => ({ value: u.id, label: u.name }));
    // osoba, která už není aktivní, musí zůstat vidět
    for (const p of [job.owner, job.assignee, job.pricedBy]) {
      if (p && !list.some((o) => o.value === p.id)) list.push({ value: p.id, label: `${p.name} (neaktivní)` });
    }
    return list;
  }, [options.users, job.owner, job.assignee, job.pricedBy]);

  const personDisplay = (o: SelectOption | null) =>
    o ? <PersonChip name={o.label} /> : <span className="text-muted-foreground">— nikdo —</span>;

  const cd = job.customerDetail;
  const address = cd ? [cd.street, [cd.zip, cd.city].filter(Boolean).join(" "), cd.country && cd.country !== "CZ" ? cd.country : null].filter(Boolean).join(", ") : "";

  return (
    <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
      {job.customerNote && (
        <section
          aria-label="Domluvy se zákazníkem"
          className="flex items-start gap-3 rounded-xl border border-amber-200 bg-amber-50/80 px-4 py-3 shadow-sm dark:border-amber-500/30 dark:bg-amber-500/[0.07] md:col-span-2 xl:col-span-3"
        >
          <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-amber-500 text-white shadow-sm">
            <Handshake className="h-4 w-4" />
          </span>
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-baseline justify-between gap-x-3">
              <h3 className="text-sm font-semibold">
                Domluvy se zákazníkem <span className="font-normal text-amber-800/80 dark:text-amber-300/80">— co není v objednávce</span>
              </h3>
              <a href="?tab=vyroba" onClick={openProductionTab} className="text-xs font-medium text-amber-800 hover:underline dark:text-amber-300">
                Upravit
              </a>
            </div>
            <p className="mt-0.5 whitespace-pre-wrap break-words text-sm leading-relaxed">{job.customerNote}</p>
          </div>
        </section>
      )}
      <InfoCard icon={Building2} tone="bg-sky-100 text-sky-700 dark:bg-sky-500/15 dark:text-sky-300" title="Zákazník & kontakt" subtitle="Komu zakázku děláme">
        <SearchSelect
          label="Zákazník"
          icon={Building2}
          iconClass="text-sky-500"
          value={job.customer?.id ?? null}
          valueLabel={job.customer?.name ?? null}
          options={customerOptions}
          emptyLabel="Vyber zákazníka"
          createLabel="Založit zákazníka"
          onSave={(id) => save({ customerId: id })}
          onCreate={(name) => save({ customerName: name })}
        />
        {cd && (
          <div className="-mt-1 space-y-0.5 rounded-lg bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
            <div className="flex flex-wrap gap-x-3 gap-y-0.5">
              {cd.customerNumber && <span>Naše č. zákazníka: <strong className="font-mono text-foreground">{cd.customerNumber}</strong></span>}
              {cd.ico && <span>IČO: <strong className="text-foreground">{cd.ico}</strong></span>}
              {cd.dic && <span>DIČ: <strong className="text-foreground">{cd.dic}</strong></span>}
              {cd.supplierNumberAtCustomer && <span>Naše č. dodavatele u nich: <strong className="text-foreground">{cd.supplierNumberAtCustomer}</strong></span>}
            </div>
            {address && <div className="flex items-center gap-1"><MapPin className="h-3 w-3" /> {address}</div>}
            <Link href={`/customers/${cd.id}`} className="inline-flex items-center gap-1 font-medium text-sky-700 hover:underline dark:text-sky-400">
              Karta zákazníka <ExternalLink className="h-3 w-3" />
            </Link>
          </div>
        )}
        <JobField field="customerContact" label="Kontaktní osoba" value={job.customerContact} icon={UserRound} iconClass="text-sky-500" placeholder="Doplnit jméno" hint={!job.customerContact && cd?.contactPerson ? `Kontakt firmy: ${cd.contactPerson}` : undefined} />
        <div className="grid gap-3 sm:grid-cols-2 md:grid-cols-1 lg:grid-cols-2">
          <JobField
            field="customerContactEmail" kind="email" label="E-mail" value={job.customerContactEmail} icon={Mail} iconClass="text-sky-500"
            placeholder="Doplnit e-mail" hint={!job.customerContactEmail && cd?.email ? `Firemní: ${cd.email}` : undefined}
            display={(v) => <span className="break-all text-sky-700 dark:text-sky-400">{v}</span>}
          />
          <JobField field="customerContactPhone" kind="tel" label="Telefon" value={job.customerContactPhone} icon={Phone} iconClass="text-sky-500" placeholder="Doplnit telefon" hint={!job.customerContactPhone && cd?.phone ? `Firemní: ${cd.phone}` : undefined} />
        </div>
        {(job.customerContactEmail || job.customerContactPhone) && (
          <div className="flex flex-wrap gap-2 text-xs">
            {job.customerContactEmail && (
              <a href={`mailto:${job.customerContactEmail}`} className="inline-flex items-center gap-1 rounded-full bg-sky-100 px-2 py-0.5 font-medium text-sky-800 hover:brightness-95 dark:bg-sky-500/15 dark:text-sky-300">
                <Mail className="h-3 w-3" /> Napsat
              </a>
            )}
            {job.customerContactPhone && (
              <a href={`tel:${job.customerContactPhone.replace(/\s+/g, "")}`} className="inline-flex items-center gap-1 rounded-full bg-green-100 px-2 py-0.5 font-medium text-green-800 hover:brightness-95 dark:bg-green-500/15 dark:text-green-300">
                <Phone className="h-3 w-3" /> Zavolat
              </a>
            )}
          </div>
        )}
      </InfoCard>

      <InfoCard icon={FileDigit} tone="bg-violet-100 text-violet-700 dark:bg-violet-500/15 dark:text-violet-300" title="Čísla dokladů" subtitle="Podle nich zakázku najdeš i v poště">
        <div className="grid gap-3 sm:grid-cols-2 md:grid-cols-1 lg:grid-cols-2">
          <JobField field="customerInquiryNumber" label="Č. poptávky zákazníka" value={job.customerInquiryNumber} icon={MessageSquareQuote} iconClass="text-sky-500" display={(v) => <span className="font-mono">{v}</span>} />
          <JobField field="inquiryDate" kind="date" label="Datum poptávky" value={job.inquiryDate} icon={CalendarDays} iconClass="text-sky-500" />
          <JobField field="customerOrderNumber" label="Č. objednávky zákazníka" value={job.customerOrderNumber} icon={ShoppingCart} iconClass="text-orange-500" display={(v) => <span className="font-mono">{v}</span>} />
          <JobField field="orderDate" kind="date" label="Datum objednávky" value={job.orderDate} icon={CalendarDays} iconClass="text-orange-500" />
          <JobField field="supplierOrderNumber" label="Naše obj. u dodavatele" value={job.supplierOrderNumber} icon={Hash} iconClass="text-yellow-600" display={(v) => <span className="font-mono">{v}</span>} />
          <JobField field="deliveryNoteNumber" label="Číslo dodacího listu" value={job.deliveryNoteNumber} icon={Truck} iconClass="text-green-600" display={(v) => <span className="font-mono">{v}</span>} />
          <JobField field="invoiceNumber" label="Číslo faktury" value={job.invoiceNumber} icon={ReceiptText} iconClass="text-emerald-600" display={(v) => <span className="font-mono">{v}</span>} />
        </div>
      </InfoCard>

      <InfoCard icon={Users} tone="bg-amber-100 text-amber-700 dark:bg-amber-500/15 dark:text-amber-300" title="Lidé" subtitle="Kdo za zakázku odpovídá">
        <InlineSelect
          label="Obchodník" icon={UserRound} iconClass="text-amber-500" value={job.owner?.id ?? null} options={people}
          onSave={(id) => save({ ownerId: id })} display={personDisplay}
        />
        <InlineSelect
          label="Zpracovává" icon={ClipboardList} iconClass="text-amber-500" value={job.assignee?.id ?? null} options={people}
          onSave={(id) => save({ assigneeId: id })} display={personDisplay} hint="Kdo má zakázku teď na stole."
        />
        <InlineSelect
          label="Nacenil" icon={Calculator} iconClass="text-amber-500" value={job.pricedBy?.id ?? null} options={people}
          onSave={(id) => save({ pricedById: id })} display={personDisplay}
        />
        <div className="grid gap-3 sm:grid-cols-2 md:grid-cols-1 lg:grid-cols-2">
          <ReadOnly label="Zadal" icon={PenLine} iconClass="text-amber-500">
            <PersonChip name={job.createdBy?.name} />
            <div className="text-[11px] text-muted-foreground">{longDate(job.createdAt)}</div>
          </ReadOnly>
          <ReadOnly label="Schválil" icon={BadgeCheck} iconClass="text-amber-500">
            {job.approvedBy ? (
              <>
                <PersonChip name={job.approvedBy.name} />
                {job.approvedAt && <div className="text-[11px] text-muted-foreground">{longDate(job.approvedAt)}</div>}
              </>
            ) : (
              <span className="text-xs text-muted-foreground">zatím nikdo (schvaluje se nabídka)</span>
            )}
          </ReadOnly>
        </div>
      </InfoCard>

      <InfoCard icon={Factory} tone="bg-emerald-100 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300" title="Dodavatel & peníze" subtitle={perms.margins ? "Prodej, nákup a marže" : "Kdo to vyrábí a za kolik prodáváme"}>
        <SearchSelect
          label="Dodavatel / výrobce"
          icon={Factory}
          iconClass="text-emerald-500"
          value={job.supplier?.id ?? null}
          valueLabel={job.supplier?.name ?? null}
          options={supplierOptions}
          emptyLabel="Vyrábíme sami / nevybráno"
          placeholder="Hledej dodavatele…"
          onSave={(id) => save({ supplierId: id })}
        />
        <div className="grid gap-3 sm:grid-cols-2 md:grid-cols-1 lg:grid-cols-2">
          <JobField
            field="value" kind="money" currency={job.currency} label="Prodejní hodnota (bez DPH)" value={job.value}
            icon={Banknote} iconClass="text-emerald-500" placeholder="Doplnit částku"
            hint="Počítá se z položek, nebo z přijaté nabídky."
          />
          {perms.margins && (
            <JobField
              field="purchaseCost" kind="money" currency={job.currency} label="Nákupní náklady" value={job.purchaseCost}
              icon={ShoppingCart} iconClass="text-emerald-500" placeholder="Doplnit nákup"
            />
          )}
        </div>
        {perms.margins && (
          <div className={cn(
            "flex items-center justify-between rounded-lg px-3 py-2 text-sm",
            job.margin === null ? "bg-muted/40 text-muted-foreground"
              : job.margin < 0 ? "bg-red-50 text-red-800 dark:bg-red-500/10 dark:text-red-300"
              : job.margin < 0.15 ? "bg-amber-50 text-amber-900 dark:bg-amber-500/10 dark:text-amber-200"
              : "bg-green-50 text-green-800 dark:bg-green-500/10 dark:text-green-300",
          )}>
            <span className="flex items-center gap-1.5 font-medium"><Percent className="h-4 w-4" /> Marže</span>
            <span className="font-semibold tabular-nums">
              {job.margin === null ? "doplň prodej i nákup" : formatPercent(job.margin)}
            </span>
          </div>
        )}
      </InfoCard>

      <InfoCard icon={Wrench} tone="bg-yellow-100 text-yellow-800 dark:bg-yellow-500/15 dark:text-yellow-300" title="Výroba" subtitle="Jak a kde se díly dělají">
        <div className="grid gap-3 sm:grid-cols-2 md:grid-cols-1 lg:grid-cols-2">
          <JobField field="technology" label="Technologie" value={job.technology} icon={Wrench} iconClass="text-yellow-600" placeholder="např. frézování, kalení" />
          <JobField field="manufacturingLocation" label="Místo výroby" value={job.manufacturingLocation} icon={MapPin} iconClass="text-yellow-600" placeholder="u nás / u dodavatele" />
        </div>
        <JobField field="specificRequirements" kind="textarea" label="Specifické požadavky" value={job.specificRequirements} icon={ClipboardList} iconClass="text-yellow-600" placeholder="atesty, tolerance, balení…" />
        <JobField field="deliveryMethod" label="Způsob dodání" value={job.deliveryMethod} icon={Truck} iconClass="text-yellow-600" placeholder="např. naše doprava, PPL, osobní odběr" />
      </InfoCard>

      <InfoCard icon={StickyNote} tone="bg-slate-100 text-slate-700 dark:bg-slate-500/20 dark:text-slate-300" title="Poznámka & štítky" subtitle="Interní — zákazník je neuvidí">
        <JobField field="note" kind="textarea" label="Interní poznámka" value={job.note} icon={StickyNote} iconClass="text-slate-500" placeholder="Napiš poznámku pro kolegy" hint="Ctrl + Enter uloží." />
        <TagsEditor tags={job.tags} />
      </InfoCard>
    </div>
  );
}
