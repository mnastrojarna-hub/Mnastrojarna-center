import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { ArrowLeft, ChevronLeft, ChevronRight, ShieldCheck } from "lucide-react";
import { requireFeature } from "@/lib/auth/session";
import { listAudit } from "@/lib/data/audit";
import { pragueToday } from "@/lib/jobs/flow-status";
import { PageHeader } from "@/components/page-header";
import { Button } from "@/components/ui/button";
import { AuditFilters, type AuditFilterValue } from "./audit-filters";
import { AuditList } from "./audit-list";
import { periodFrom } from "./audit-model";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Audit" };

type Search = Promise<Record<string, string | string[] | undefined>>;

const one = (v: string | string[] | undefined): string => (typeof v === "string" ? v.trim().slice(0, 64) : "");
const DAY = /^\d{4}-\d{2}-\d{2}$/;

/** Audit (jen super admin): kdo, kdy, jak a co změnil — filtr podle osoby, entity a období. */
export default async function AuditPage({ searchParams }: { searchParams: Search }) {
  const user = await requireFeature("settings");
  if (user.role !== "super_admin") redirect("/settings");
  const sp = await searchParams;
  const value: AuditFilterValue = {
    osoba: one(sp.osoba),
    entita: one(sp.entita),
    od: DAY.test(one(sp.od)) ? one(sp.od) : "",
    do: DAY.test(one(sp.do)) ? one(sp.do) : "",
    obdobi: ["dnes", "7d", "30d"].includes(one(sp.obdobi)) ? one(sp.obdobi) : "",
  };
  const page = Math.max(0, Number.parseInt(one(sp.strana), 10) || 0);
  const today = pragueToday();
  const from = value.od || (value.obdobi ? periodFrom(value.obdobi, today) : null);
  const list = await listAudit({
    actorId: value.osoba && value.osoba !== "ai" && value.osoba !== "system" ? value.osoba : null,
    actorKind: value.osoba === "ai" ? "ai" : value.osoba === "system" ? "system" : null,
    entity: value.entita || null,
    from,
    to: value.do || null,
    page,
  });
  const pageHref = (p: number) => {
    const q = new URLSearchParams();
    for (const [k, v] of Object.entries(value)) if (v) q.set(k, v);
    if (p > 0) q.set("strana", String(p));
    return q.size ? `/settings/audit?${q.toString()}` : "/settings/audit";
  };

  return (
    <div className="space-y-4">
      <PageHeader
        title="Audit"
        description="Kdo, kdy a jak co změnil — každý zápis nese účet (i AI a plánovač). Smazané záznamy zůstávají celé."
        actions={
          <Button asChild variant="outline" size="sm">
            <Link href="/settings"><ArrowLeft className="h-4 w-4" /> Nastavení</Link>
          </Button>
        }
      />
      <AuditFilters value={value} actors={list.actors} entities={list.entities} />
      {list.error && (
        <p role="alert" className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-800 dark:border-red-500/30 dark:bg-red-500/10 dark:text-red-200">
          {list.error}
        </p>
      )}
      <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
        <ShieldCheck className="h-3.5 w-3.5 text-emerald-600" aria-hidden />
        {list.entries.length ? `Zobrazeno ${page * 50 + 1}–${page * 50 + list.entries.length}` : "Nic k zobrazení"} · nejnovější nahoře
      </p>
      <AuditList entries={list.entries} />
      {(page > 0 || list.hasMore) && (
        <nav aria-label="Stránkování auditu" className="flex items-center justify-between gap-2">
          {page > 0 ? (
            <Button asChild variant="outline" size="sm"><Link href={pageHref(page - 1)}><ChevronLeft className="h-4 w-4" /> Novější</Link></Button>
          ) : <span />}
          {list.hasMore && (
            <Button asChild variant="outline" size="sm"><Link href={pageHref(page + 1)}>Starší <ChevronRight className="h-4 w-4" /></Link></Button>
          )}
        </nav>
      )}
    </div>
  );
}
