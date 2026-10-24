import Link from "next/link";
import { Box, Briefcase, Download, FileBox, FileImage, FileText, Paperclip, PencilRuler, Search, SearchX } from "lucide-react";
import { FileAnonBadge } from "@/components/anonymize/anon-badge";
import type { AnonUiStatus } from "@/components/anonymize/anon-status";
import { getDrawingAnonStatuses } from "@/lib/data/anonymize";
import { PageHeader } from "@/components/page-header";
import { Input } from "@/components/ui/input";
import { DrawingUpload } from "@/components/drawing-upload";
import { FriendlyEmpty } from "@/components/customers/friendly-empty";
import { requireFeature } from "@/lib/auth/session";
import { getDrawings } from "@/lib/data/queries";
import { searchNormalize } from "@/lib/jobs/mapping";
import type { DrawingItem } from "@/lib/data/types";
import { cn, formatDate } from "@/lib/utils";
import { DrawingSpecChips } from "@/components/jobs/drawing-spec-chips";
import { MATERIAL_GROUPS, classifyMaterial } from "@/lib/jobs/material-groups";

const TYPE_STYLE: Record<DrawingItem["fileType"], { label: string; icon: typeof FileText; badge: string }> = {
  PDF: { label: "PDF", icon: FileText, badge: "bg-red-100 text-red-700 dark:bg-red-500/15 dark:text-red-300" },
  STEP: { label: "STEP", icon: Box, badge: "bg-purple-100 text-purple-800 dark:bg-purple-500/15 dark:text-purple-300" },
  DXF: { label: "DXF", icon: PencilRuler, badge: "bg-blue-100 text-blue-800 dark:bg-blue-500/15 dark:text-blue-300" },
  IMG: { label: "Obrázek", icon: FileImage, badge: "bg-rose-100 text-rose-800 dark:bg-rose-500/15 dark:text-rose-300" },
};

function typeStyle(t: string) {
  return TYPE_STYLE[t as DrawingItem["fileType"]] ?? TYPE_STYLE.PDF;
}

export default async function DrawingsPage({ searchParams }: { searchParams: Promise<{ q?: string | string[] }> }) {
  await requireFeature("drawings");
  const sp = await searchParams;
  const q = (typeof sp.q === "string" ? sp.q : "").slice(0, 120);
  const all = await getDrawings();
  const tokens = searchNormalize(q).split(/\s+/).filter(Boolean);
  const drawings = tokens.length
    ? all.filter((d) => {
        const sp = d.spec;
        const h = searchNormalize([
          d.number, d.revision, d.customer, d.material, d.dimensions, d.jobNumber ?? "", d.title ?? "",
          sp?.materialGroup ? MATERIAL_GROUPS[sp.materialGroup].label : "", sp?.materialDesignation ?? "",
          // uklizené označení („ČSN 19 436" pro „ČSN 41 9436") — najde se i jiný zápis
          sp?.materialDesignation ? classifyMaterial(sp.materialDesignation).normalizedDesignation : "",
          sp?.heatTreatment ?? "", sp?.surfaceTreatment ?? "", sp?.hardness ?? "",
        ].join(" "));
        return tokens.every((t) => h.includes(t));
      })
    : all;
  const anon = await getDrawingAnonStatuses(drawings.slice(0, 500).map((d) => ({ id: d.id, jobFileId: d.jobFileId })));

  return (
    <div className="space-y-5">
      <PageHeader
        title="Archiv výkresů"
        description="Nahraj výkres — AI z něj vytáhne číslo, revizi, materiál, rozměry i množství. Stejné číslo a revize se pozná jako duplicita."
      />

      <DrawingUpload />

      <section className="space-y-3 rounded-2xl border bg-card p-3 shadow-sm sm:p-4">
        <form action="/drawings" className="relative">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input name="q" defaultValue={q} placeholder="Hledej číslo výkresu, zákazníka, materiál…" className="h-10 pl-9" />
        </form>

        {all.length === 0 ? (
          <FriendlyEmpty icon={<FileBox />} tone="bg-indigo-100 text-indigo-700 dark:bg-indigo-500/15 dark:text-indigo-300" title="Archiv je zatím prázdný">
            Nahraj první výkres nahoře (PDF nebo fotka). Výkresy přiložené k zakázkám najdeš i přímo na kartě zakázky v záložce Dokumenty.
          </FriendlyEmpty>
        ) : drawings.length === 0 ? (
          <FriendlyEmpty compact icon={<SearchX />} tone="bg-amber-100 text-amber-700 dark:bg-amber-500/15 dark:text-amber-300" title={`Nic pro „${q}“`}>
            Zkus kratší část čísla výkresu nebo jméno zákazníka.
          </FriendlyEmpty>
        ) : (
          <>
            <p className="px-1 text-xs text-muted-foreground">{drawings.length} z {all.length} výkresů</p>
            <ul className="divide-y rounded-xl border">
              {drawings.map((d) => {
                const t = typeStyle(d.fileType);
                return (
                  <li key={d.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2.5">
                    <span className={cn("flex h-9 w-9 shrink-0 items-center justify-center rounded-lg", t.badge)} title={t.label}>
                      <t.icon className="h-4 w-4" />
                    </span>
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="font-mono text-sm font-semibold">{d.number}</span>
                        <span className="rounded bg-blue-100 px-1.5 py-0.5 text-[10px] font-semibold text-blue-800 dark:bg-blue-500/15 dark:text-blue-300">rev. {d.revision}</span>
                        <span className={cn("rounded px-1.5 py-0.5 text-[10px] font-semibold", t.badge)}>{t.label}</span>
                        {anon[d.id] && <FileAnonBadge status={anon[d.id].status as AnonUiStatus} reviewed={anon[d.id].reviewed} reason={anon[d.id].reason} />}
                      </div>
                      <p className="truncate text-xs text-muted-foreground">
                        {[d.title || null, d.customer !== "—" ? d.customer : null, d.material !== "—" ? d.material : null, d.dimensions !== "—" ? d.dimensions : null, d.qty ? `${d.qty} ks` : null]
                          .filter(Boolean).join(" · ") || "bez údajů"}
                      </p>
                    </div>
                    <span className="flex shrink-0 flex-col items-end gap-1">
                      {d.jobId && (
                        <Link
                          href={`/orders/${d.jobId}?tab=dokumenty`}
                          className="inline-flex items-center gap-1 rounded-full bg-sky-100 px-2 py-0.5 text-[11px] font-semibold text-sky-800 hover:bg-sky-200 dark:bg-sky-500/15 dark:text-sky-300"
                          title="Zakázka, ze které výkres pochází (focení dokladů)"
                        >
                          <Briefcase className="h-3 w-3" /> {d.jobNumber ?? "Zakázka"}
                        </Link>
                      )}
                      {d.jobFileId && (
                        <a
                          href={`/api/jobs/files/${d.jobFileId}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-flex items-center gap-1 text-[11px] font-medium text-muted-foreground hover:text-foreground"
                          aria-label={`Soubor výkresu ${d.number}`}
                        >
                          <Paperclip className="h-3 w-3" /> soubor
                        </a>
                      )}
                      {anon[d.id]?.status === "done" && (
                        <a
                          href={`/api/drawings/anonymize/${anon[d.id].fileId}/download${anon[d.id].table === "drawings" ? "?table=drawings" : ""}`}
                          className="inline-flex items-center gap-1 text-[11px] font-semibold text-primary hover:underline"
                          aria-label={`Stáhnout výkres ${d.number} pro dodavatele (anonymizovaný)`}
                        >
                          <Download className="h-3 w-3" /> pro dodavatele
                        </a>
                      )}
                      <span className="text-[11px] text-muted-foreground">{formatDate(d.uploadedAt)}</span>
                    </span>
                    {/* štítky pod řádkem na celou šířku (na mobilu je pravý sloupec nemačká) */}
                    <DrawingSpecChips spec={d.spec} className="basis-full pl-12" testId={`drawing-spec-${d.number}`} />
                  </li>
                );
              })}
            </ul>
          </>
        )}
      </section>
    </div>
  );
}
