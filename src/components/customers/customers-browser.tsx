"use client";

import * as React from "react";
import Link from "next/link";
import {
  Building2, ChevronRight, ClipboardList, Hash, Mail, MapPin, Phone, Search, SearchX, Sparkles, UserRound, Users, X,
  type LucideIcon,
} from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { CustomerDialog, type OwnerOption } from "@/components/customers/customer-dialog";
import { FriendlyEmpty } from "@/components/customers/friendly-empty";
import {
  CUSTOMER_FILTERS, avatarToneFor, customerFilterCounts, filterCustomers, initialsOf,
  type CustomerFilter, type CustomerView,
} from "@/components/customers/model";
import { plural } from "@/lib/jobs/deadlines";
import { cn, formatCZK } from "@/lib/utils";

/**
 * Adresář zákazníků: hledání, barevné filtry, karty na mobilu, řádky na desktopu.
 * Celý řádek otevře kartu zákazníka; tužka rovnou upraví údaje.
 */

const FILTER_STYLE: Record<CustomerFilter, { icon: LucideIcon; tone: string; active: string }> = {
  vse: {
    icon: Users,
    tone: "bg-green-50/80 text-green-800 hover:bg-green-50 dark:bg-green-500/[0.08] dark:text-green-300",
    active: "bg-green-600 text-white shadow-sm shadow-green-600/20",
  },
  aktivni: {
    icon: ClipboardList,
    tone: "bg-orange-50/80 text-orange-800 hover:bg-orange-50 dark:bg-orange-500/[0.08] dark:text-orange-300",
    active: "bg-orange-500 text-white shadow-sm shadow-orange-500/20",
  },
  moji: {
    icon: UserRound,
    tone: "bg-sky-50/80 text-sky-800 hover:bg-sky-50 dark:bg-sky-500/[0.08] dark:text-sky-300",
    active: "bg-sky-500 text-white shadow-sm shadow-sky-500/20",
  },
  bez_zakazek: {
    icon: Building2,
    tone: "bg-slate-100/80 text-slate-700 hover:bg-slate-100 dark:bg-slate-500/[0.12] dark:text-slate-300",
    active: "bg-slate-600 text-white shadow-sm",
  },
};

export function CustomersBrowser({
  customers,
  owners,
  userId,
}: {
  customers: CustomerView[];
  owners: OwnerOption[];
  userId: string;
}) {
  const [q, setQ] = React.useState("");
  const [filter, setFilter] = React.useState<CustomerFilter>("vse");
  const counts = React.useMemo(() => customerFilterCounts(customers, userId), [customers, userId]);
  const shown = React.useMemo(() => filterCustomers(customers, { q, filter, userId }), [customers, q, filter, userId]);

  if (customers.length === 0) {
    return (
      <FriendlyEmpty
        icon={<Users />}
        tone="bg-green-100 text-green-700 dark:bg-green-500/15 dark:text-green-300"
        title="Zatím tu není žádný zákazník"
        actions={<CustomerDialog owners={owners} defaultOwnerId={userId} size="lg" />}
      >
        <p>
          Klikni na <b>Nový zákazník</b> a vyfoť cokoli od firmy (e-mail, objednávku, fakturu, vizitku) nebo jen napiš IČO —
          AI a ARES vyplní zbytek a založí se jen zákazník, žádná zakázka.
        </p>
      </FriendlyEmpty>
    );
  }

  return (
    <div className="space-y-4">
      <div className="space-y-3 rounded-2xl border bg-card p-2.5 shadow-sm sm:p-3">
        <div className="grid grid-cols-2 gap-2 lg:grid-cols-4">
          {CUSTOMER_FILTERS.map((f) => {
            const st = FILTER_STYLE[f.key];
            const Icon = st.icon;
            const active = filter === f.key;
            return (
              <button
                key={f.key}
                type="button"
                onClick={() => setFilter(active && f.key !== "vse" ? "vse" : f.key)}
                aria-pressed={active}
                className={cn(
                  "flex items-center gap-2.5 rounded-xl px-3 py-2.5 text-left transition",
                  active ? st.active : st.tone,
                )}
              >
                <Icon className="h-5 w-5 shrink-0 opacity-90" />
                <span className="min-w-0">
                  <span className="block text-lg font-bold leading-none">{counts[f.key]}</span>
                  <span className="block truncate text-xs font-medium opacity-90">{f.label}</span>
                </span>
              </button>
            );
          })}
        </div>
        <div className="relative">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Hledej název, číslo ZK…, IČO, město, kontakt, e-mail…"
            className="h-10 pl-9 pr-9"
            aria-label="Hledat zákazníka"
          />
          {q && (
            <button
              type="button"
              onClick={() => setQ("")}
              className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-1 text-muted-foreground hover:bg-accent"
              aria-label="Vymazat hledání"
            >
              <X className="h-4 w-4" />
            </button>
          )}
        </div>
      </div>

      {shown.length === 0 ? (
        <FriendlyEmpty
          compact
          icon={<SearchX />}
          tone="bg-amber-100 text-amber-700 dark:bg-amber-500/15 dark:text-amber-300"
          title="Nikdo tomu neodpovídá"
          actions={
            <Button variant="outline" size="sm" onClick={() => { setQ(""); setFilter("vse"); }}>
              Zrušit hledání a filtry
            </Button>
          }
        >
          Zkus kratší slovo, číslo zákazníka (ZK0001) nebo IČO.
        </FriendlyEmpty>
      ) : (
        <>
          <p className="px-1 text-xs text-muted-foreground">
            {shown.length === customers.length
              ? `${customers.length} ${plural(customers.length, "zákazník", "zákazníci", "zákazníků")}`
              : `${shown.length} z ${customers.length} zákazníků`}
            {" · "}klikni na řádek pro celou historii
          </p>
          <ul className="space-y-2">
            {shown.map((c) => (
              <CustomerRowItem key={c.id} customer={c} owners={owners} />
            ))}
          </ul>
        </>
      )}
    </div>
  );
}

function CustomerRowItem({ customer: c, owners }: { customer: CustomerView; owners: OwnerOption[] }) {
  const place = [c.city, c.country !== "CZ" ? c.country : null].filter(Boolean).join(", ");
  return (
    <li className="group relative flex items-start gap-3 rounded-xl border bg-card p-3 shadow-sm transition hover:border-green-500/40 hover:shadow-md sm:items-center">
      <span
        aria-hidden
        className={cn("flex h-10 w-10 shrink-0 items-center justify-center rounded-xl text-sm font-bold", avatarToneFor(c.name))}
      >
        {initialsOf(c.name)}
      </span>

      <div className="min-w-0 flex-1 sm:grid sm:grid-cols-[minmax(0,1.6fr)_minmax(0,1.2fr)_auto] sm:items-center sm:gap-4">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <Link
              href={`/customers/${c.id}`}
              className="truncate font-semibold after:absolute after:inset-0 after:rounded-xl hover:text-green-700 dark:hover:text-green-400"
            >
              {c.name}
            </Link>
            {c.customerNumber && (
              <span className="inline-flex items-center gap-0.5 rounded-md bg-green-100 px-1.5 py-0.5 text-[11px] font-semibold text-green-800 dark:bg-green-500/15 dark:text-green-300">
                <Hash className="h-3 w-3" />{c.customerNumber}
              </span>
            )}
          </div>
          <div className="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-xs text-muted-foreground">
            {c.ico && <span>IČO {c.ico}</span>}
            {place && (
              <span className="inline-flex items-center gap-1"><MapPin className="h-3 w-3 text-violet-500" />{place}</span>
            )}
            {c.owner && (
              <span className="inline-flex items-center gap-1"><UserRound className="h-3 w-3 text-sky-500" />{c.owner.name}</span>
            )}
          </div>
        </div>

        <div className="mt-1.5 min-w-0 space-y-0.5 text-xs sm:mt-0">
          {c.contactPerson && <div className="truncate font-medium text-foreground">{c.contactPerson}</div>}
          <div className="flex flex-wrap gap-x-3 gap-y-0.5">
            {c.email && (
              <a href={`mailto:${c.email}`} className="relative z-10 inline-flex min-w-0 items-center gap-1 text-sky-700 hover:underline dark:text-sky-400">
                <Mail className="h-3 w-3 shrink-0" /><span className="truncate">{c.email}</span>
              </a>
            )}
            {c.phone && (
              <a href={`tel:${c.phone.replace(/\s/g, "")}`} className="relative z-10 inline-flex items-center gap-1 text-emerald-700 hover:underline dark:text-emerald-400">
                <Phone className="h-3 w-3 shrink-0" />{c.phone}
              </a>
            )}
            {!c.contactPerson && !c.email && !c.phone && <span className="text-muted-foreground">bez kontaktu</span>}
          </div>
        </div>

        <div className="mt-2 flex flex-wrap items-center gap-1.5 sm:mt-0 sm:justify-end">
          {c.activeJobs > 0 ? (
            <span className="inline-flex items-center gap-1 rounded-full bg-orange-100 px-2 py-0.5 text-xs font-semibold text-orange-800 dark:bg-orange-500/15 dark:text-orange-300">
              <ClipboardList className="h-3 w-3" />{`${c.activeJobs} v běhu`}
            </span>
          ) : null}
          <span
            className={cn(
              "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium",
              c.totalJobs ? "bg-slate-100 text-slate-700 dark:bg-slate-500/15 dark:text-slate-300" : "bg-muted text-muted-foreground",
            )}
            title={c.revenue ? `Obrat ${formatCZK(c.revenue)} bez DPH` : undefined}
          >
            {c.totalJobs ? `${c.totalJobs} ${plural(c.totalJobs, "zakázka", "zakázky", "zakázek")} celkem` : (
              <><Sparkles className="h-3 w-3 text-amber-500" />nový</>
            )}
          </span>
        </div>
      </div>

      <div className="relative z-10 flex shrink-0 items-center gap-1">
        <CustomerDialog customer={c} owners={owners} iconOnly variant="ghost" />
        <ChevronRight className="hidden h-4 w-4 text-muted-foreground transition group-hover:translate-x-0.5 sm:block" />
      </div>
    </li>
  );
}
