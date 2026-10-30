import { cache } from "react";
import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { requireFeature, getAccess } from "@/lib/auth/session";
import { getMergeBanner, getMergeRedirect, getMergedSourceInfo } from "@/lib/data/job-merge";
import { MergeBanner, MergedSourceBanner } from "@/components/jobs/detail/merge-banner";
import { getFieldStamps, getJobStamps, listJobPayments, listOrderRevisions } from "@/lib/data/flow-status";
import { FIELD_STAMP_COLUMNS } from "@/components/jobs/detail/detail-helpers";
import { getJob, getJobFormOptions } from "@/lib/data/jobs";
import { getJobProduction } from "@/lib/data/production";
import { getJobPurchasing } from "@/lib/data/purchasing";
import { JobDetailView } from "@/components/jobs/detail/job-detail-view";
import { getJobCommunication } from "@/lib/data/job-mail";
import { JobMailProvider } from "@/components/jobs/communication/job-mail-context";

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
  const mergedFrom = typeof sp.slouceno === "string" ? sp.slouceno : null;
  const [job, options, access, production, purchasing, stamps, fieldStamps, payments, revisions, mergedInto, banner, communication] = await Promise.all([
    loadJob(id), getJobFormOptions(), getAccess(), getJobProduction(id), getJobPurchasing(id),
    getJobStamps(id), getFieldStamps(id, FIELD_STAMP_COLUMNS), listJobPayments(id), listOrderRevisions(id),
    // #24: sloučená zakázka (zdroj) → přesměrovat na tu, která zůstala; na ní banner
    getMergeRedirect(id), mergedFrom ? getMergeBanner(id, mergedFrom, sp.presmerovano === "1") : Promise.resolve(null),
    // Pošta B: Komunikace (vlákna, návrhy, změny z e-mailů) — pošta jen podle pravidel viditelnosti
    getJobCommunication(id).catch(() => null),
  ]);
  if (!job) notFound();
  // ?historie=1 = původní (sloučenou) zakázku jen zobrazit — odkaz z banneru cíle
  if (mergedInto && sp.historie !== "1") redirect(`/orders/${mergedInto.id}?slouceno=${encodeURIComponent(job.number)}&presmerovano=1`);
  const sourceInfo = mergedInto ? await getMergedSourceInfo(id, mergedInto) : null;

  return (
    <>
    {banner && <MergeBanner {...banner} />}
    {sourceInfo && <MergedSourceBanner number={job.number} {...sourceInfo} />}
    <JobMailProvider jobId={job.id} initial={communication}>
    <JobDetailView
      job={job}
      options={options}
      perms={{
        // sloučená zakázka je jen historie (úpravy odmítne DB) — bez mazání a dalšího slučování
        canDelete: !sourceInfo && access.can("delete"),
        margins: access.can("margins"),
        aiCapture: !sourceInfo && access.can("ai_capture"),
        ownerEditable: !sourceInfo && user.role === "super_admin",
        canMerge: !sourceInfo && (user.role === "super_admin" || user.role === "obchodnik"),
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
    </JobMailProvider>
    </>
  );
}
