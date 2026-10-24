import { cache } from "react";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { requireFeature, getAccess } from "@/lib/auth/session";
import { getFieldStamps, getJobStamps, listJobPayments, listOrderRevisions } from "@/lib/data/flow-status";
import { FIELD_STAMP_COLUMNS } from "@/components/jobs/detail/detail-helpers";
import { getJob, getJobFormOptions } from "@/lib/data/jobs";
import { getJobProduction } from "@/lib/data/production";
import { getJobPurchasing } from "@/lib/data/purchasing";
import { JobDetailView } from "@/components/jobs/detail/job-detail-view";

export const dynamic = "force-dynamic";
// předání do výroby: jedno odeslání = PDF objednávek + e-maily dodavatelům (akce běží ve funkci stránky)
export const maxDuration = 60;

// metadata i stránka čtou stejnou zakázku — jeden dotaz na požadavek
const loadJob = cache(getJob);

type Params = { params: Promise<{ id: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> };

export async function generateMetadata({ params }: Pick<Params, "params">): Promise<Metadata> {
  const { id } = await params;
  const job = await loadJob(id);
  return { title: job ? `${job.number} — ${job.title} | Kniha zakázek` : "Zakázka nenalezena" };
}

/** Karta zakázky — vše k jedné zakázce: stav (kdo · kdy), další krok, termíny, položky, nabídky, dokumenty, historie. */
export default async function JobDetailPage({ params, searchParams }: Params) {
  const user = await requireFeature("orders");
  const [{ id }, sp] = await Promise.all([params, searchParams]);
  const [job, options, access, production, purchasing, stamps, fieldStamps, payments, revisions] = await Promise.all([
    loadJob(id), getJobFormOptions(), getAccess(), getJobProduction(id), getJobPurchasing(id),
    getJobStamps(id), getFieldStamps(id, FIELD_STAMP_COLUMNS), listJobPayments(id), listOrderRevisions(id),
  ]);
  if (!job) notFound();

  return (
    <JobDetailView
      job={job}
      options={options}
      perms={{
        canDelete: access.can("delete"),
        margins: access.can("margins"),
        aiCapture: access.can("ai_capture"),
        ownerEditable: user.role === "super_admin",
      }}
      initialTab={typeof sp.tab === "string" ? sp.tab : undefined}
      // ?nova=1 (Poptávky „Vytvořit nabídku“) = záložka Nabídky s otevřeným editorem nové nabídky
      initialAction={typeof sp.akce === "string" ? sp.akce : sp.nova === "1" ? "quote.create" : null}
      flow={{
        stamps, fieldStamps, payments, revisions,
        access: { features: access.features, userId: user.id, role: user.role },
      }}
      production={production}
      purchasing={purchasing}
    />
  );
}
