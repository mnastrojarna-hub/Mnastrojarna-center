import { cache } from "react";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { requireFeature, getAccess } from "@/lib/auth/session";
import { getJob, getJobFormOptions } from "@/lib/data/jobs";
import { JobDetailView } from "@/components/jobs/detail/job-detail-view";

export const dynamic = "force-dynamic";

// metadata i stránka čtou stejnou zakázku — jeden dotaz na požadavek
const loadJob = cache(getJob);

type Params = { params: Promise<{ id: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> };

export async function generateMetadata({ params }: Pick<Params, "params">): Promise<Metadata> {
  const { id } = await params;
  const job = await loadJob(id);
  return { title: job ? `${job.number} — ${job.title} | Kniha zakázek` : "Zakázka nenalezena" };
}

/** Karta zakázky — vše k jedné zakázce: stav, termíny, položky, nabídky, dokumenty, historie. */
export default async function JobDetailPage({ params, searchParams }: Params) {
  await requireFeature("orders");
  const [{ id }, sp] = await Promise.all([params, searchParams]);
  const [job, options, access] = await Promise.all([loadJob(id), getJobFormOptions(), getAccess()]);
  if (!job) notFound();

  return (
    <JobDetailView
      job={job}
      options={options}
      perms={{
        canDelete: access.can("delete"),
        margins: access.can("margins"),
        aiCapture: access.can("ai_capture"),
      }}
      initialTab={typeof sp.tab === "string" ? sp.tab : undefined}
    />
  );
}
