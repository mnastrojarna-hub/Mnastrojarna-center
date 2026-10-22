import Link from "next/link";
import {
  BrainCircuit, ClipboardList, Database, FileBox, FileText, GraduationCap, Search, SearchX, ShoppingCart, Sparkles,
} from "lucide-react";
import { PageHeader } from "@/components/page-header";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { QuoteStatusBadge } from "@/components/status-badge";
import { StageBadge } from "@/components/jobs/stage-badge";
import { FriendlyEmpty } from "@/components/customers/friendly-empty";
import { requireFeature, getAccess } from "@/lib/auth/session";
import { createOperatorClient, isSupabaseConfigured } from "@/lib/supabase/server";
import { isJobStage } from "@/lib/jobs/stages";
import { one } from "@/lib/jobs/mapping";
import type { JobStage } from "@/lib/supabase/database.types";
import { cn, formatCZK, formatDate } from "@/lib/utils";

/** Jedna nalezená cena z historie (položka nabídky nebo objednávky). */
interface HistoryHit {
  id: string;
  kind: "nabidka" | "objednavka";
  drawing: string | null;
  name: string | null;
  material: string | null;
  qty: number;
  unit: string;
  unitPrice: number | null;
  docNumber: string;
  quoteStatus: string | null;
  stage: JobStage | null;
  customer: string | null;
  jobId: string | null;
  createdAt: string;
}

type Embed<T> = T | T[] | null | undefined;

/** Hledaný výraz bezpečný pro filtr PostgRESTu (bez oddělovačů a zástupných znaků). */
function safeTerm(q: string): string {
  return q.replace(/[,()*%\\"'`]/g, " ").replace(/\s+/g, " ").trim().slice(0, 80);
}

/** Hledání v historii cen: položky nabídek a objednávek podle čísla výkresu, názvu nebo materiálu. */
async function searchHistory(q: string): Promise<HistoryHit[]> {
  const term = safeTerm(q);
  if (!term || !isSupabaseConfigured()) return [];
  try {
    const db = await createOperatorClient();
    const filter = ["drawing_number", "name", "material", "description"].map((c) => `${c}.ilike.%${term}%`).join(",");
    const [quoteItems, orderItems] = await Promise.all([
      db
        .from("quote_items")
        .select("id, quantity, unit, unit_price, drawing_number, name, material, description, quote:quotes!quote_id(number, status, created_at, job_id, customer:customers!customer_id(name))")
        .or(filter)
        .limit(40),
      db
        .from("order_items")
        .select("id, quantity, unit, unit_price, drawing_number, name, material, description, created_at, job:orders!order_id(id, number, status, created_at, customer:customers!customer_id(name))")
        .or(filter)
        .limit(40),
    ]);
    type QI = {
      id: string; quantity: number; unit: string | null; unit_price: number | null; drawing_number: string | null;
      name: string | null; material: string | null; description: string | null;
      quote?: Embed<{ number: string | null; status: string; created_at: string; job_id: string | null; customer?: Embed<{ name: string }> }>;
    };
    type OI = Omit<QI, "quote"> & {
      created_at: string;
      job?: Embed<{ id: string; number: string | null; status: string; created_at: string; customer?: Embed<{ name: string }> }>;
    };
    const hits: HistoryHit[] = [];
    for (const r of (quoteItems.data ?? []) as QI[]) {
      const qt = one(r.quote);
      hits.push({
        id: `q-${r.id}`, kind: "nabidka", drawing: r.drawing_number, name: r.name ?? r.description, material: r.material,
        qty: Number(r.quantity ?? 0), unit: r.unit ?? "ks", unitPrice: r.unit_price === null ? null : Number(r.unit_price),
        docNumber: qt?.number ?? "—", quoteStatus: qt?.status ?? null, stage: null,
        customer: one(qt?.customer)?.name ?? null, jobId: qt?.job_id ?? null, createdAt: qt?.created_at ?? "",
      });
    }
    for (const r of (orderItems.data ?? []) as OI[]) {
      const job = one(r.job);
      hits.push({
        id: `o-${r.id}`, kind: "objednavka", drawing: r.drawing_number, name: r.name ?? r.description, material: r.material,
        qty: Number(r.quantity ?? 0), unit: r.unit ?? "ks", unitPrice: r.unit_price === null ? null : Number(r.unit_price),
        docNumber: job?.number ?? "—", quoteStatus: null, stage: job && isJobStage(job.status) ? job.status : null,
        customer: one(job?.customer)?.name ?? null, jobId: job?.id ?? null, createdAt: job?.created_at ?? r.created_at,
      });
    }
    return hits.sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, 40);
  } catch {
    return [];
  }
}

async function getStats() {
  const empty = { knowledge: 0, quotes: 0, drawings: 0, jobs: 0, examples: 0, corrections: 0 };
  if (!isSupabaseConfigured()) return empty;
  try {
    const db = await createOperatorClient();
    const count = (t: string) => db.from(t).select("id", { count: "exact", head: true });
    const [k, q, d, j, e, c] = await Promise.all([
      count("knowledge_documents"), count("quotes"), count("drawings"), count("orders"),
      count("ai_training_examples"), count("ai_corrections"),
    ]);
    return {
      knowledge: k.count ?? 0, quotes: q.count ?? 0, drawings: d.count ?? 0, jobs: j.count ?? 0,
      examples: e.count ?? 0, corrections: c.count ?? 0,
    };
  } catch {
    return empty;
  }
}

export default async function KnowledgePage({ searchParams }: { searchParams: Promise<{ q?: string | string[] }> }) {
  await requireFeature("knowledge");
  const { can } = await getAccess();
  const sp = await searchParams;
  const q = (typeof sp.q === "string" ? sp.q : "").slice(0, 120);
  const [stats, hits] = await Promise.all([getStats(), searchHistory(q)]);
  const priced = hits.filter((h) => h.unitPrice !== null);
  const last = priced[0] ?? null;

  const tiles = [
    { label: "Zakázek v knize", value: stats.jobs, icon: ClipboardList, tone: "bg-orange-500 text-white", tile: "bg-orange-50/70 dark:bg-orange-500/[0.07]" },
    { label: "Nabídek v historii", value: stats.quotes, icon: FileText, tone: "bg-violet-500 text-white", tile: "bg-violet-50/70 dark:bg-violet-500/[0.07]" },
    { label: "Výkresů v archivu", value: stats.drawings, icon: FileBox, tone: "bg-indigo-500 text-white", tile: "bg-indigo-50/70 dark:bg-indigo-500/[0.07]" },
    { label: "Doklady, ze kterých se AI učí", value: stats.examples, icon: GraduationCap, tone: "bg-fuchsia-600 text-white", tile: "bg-fuchsia-50/70 dark:bg-fuchsia-500/[0.07]" },
    { label: "Naučené korekce", value: stats.corrections, icon: BrainCircuit, tone: "bg-pink-600 text-white", tile: "bg-pink-50/70 dark:bg-pink-500/[0.07]" },
    { label: "Znalostních dokumentů", value: stats.knowledge, icon: Database, tone: "bg-slate-600 text-white", tile: "bg-slate-100/80 dark:bg-slate-500/[0.10]" },
  ];

  return (
    <div className="space-y-5">
      <PageHeader
        title="Znalostní databáze"
        description="Historie cen z nabídek a objednávek, výkresy a to, co se AI naučila z tvých oprav. Z toho AI čerpá při další poptávce."
        actions={
          <>
            {can("drawings") && (
              <Button asChild variant="outline"><Link href="/drawings"><FileBox /> Archiv výkresů</Link></Button>
            )}
            {can("ai_tuning") && (
              <Button asChild variant="outline"><Link href="/tuning"><GraduationCap /> Ladění AI</Link></Button>
            )}
          </>
        }
      />

      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 xl:grid-cols-6">
        {tiles.map((t) => (
          <div key={t.label} className={cn("flex items-center gap-3 rounded-2xl border p-3", t.tile)}>
            <span className={cn("flex h-9 w-9 shrink-0 items-center justify-center rounded-xl", t.tone)}><t.icon className="h-4 w-4" /></span>
            <div className="min-w-0">
              <div className="text-lg font-bold leading-tight">{t.value}</div>
              <div className="text-[11px] leading-tight text-muted-foreground">{t.label}</div>
            </div>
          </div>
        ))}
      </div>

      <section className="space-y-4 rounded-2xl border bg-card p-4 shadow-sm">
        <div className="flex items-start gap-2.5">
          <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-pink-100 text-pink-700 dark:bg-pink-500/15 dark:text-pink-300">
            <Search className="h-4 w-4" />
          </span>
          <div>
            <h2 className="text-base font-semibold">Najdi poslední cenu / podobný díl</h2>
            <p className="text-xs text-muted-foreground">Hledá v položkách všech nabídek a objednávek podle čísla výkresu, názvu dílu nebo materiálu.</p>
          </div>
        </div>
        <form className="relative" action="/knowledge">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input name="q" placeholder="Číslo výkresu, název dílu nebo materiál (např. VK-2291, příruba, 1.2379)…" className="h-11 pl-9" defaultValue={q} />
        </form>

        {!q && (
          <FriendlyEmpty compact icon={<BrainCircuit />} tone="bg-pink-100 text-pink-700 dark:bg-pink-500/15 dark:text-pink-300" title="Zadej, co hledáš">
            Výsledky jsou z tvých skutečných nabídek a objednávek — žádná ukázková data. Čím víc dokladů vyfotíte, tím víc toho AI ví.
          </FriendlyEmpty>
        )}
        {q && hits.length === 0 && (
          <FriendlyEmpty compact icon={<SearchX />} tone="bg-amber-100 text-amber-700 dark:bg-amber-500/15 dark:text-amber-300" title={`Nic pro „${q}“`}>
            Historie se plní s každou nabídkou a objednávkou v Knize zakázek. Zkus kratší část čísla výkresu.
          </FriendlyEmpty>
        )}

        {last && (
          <div className="flex flex-wrap items-center gap-3 rounded-xl border border-emerald-200 bg-emerald-50 p-3 dark:border-emerald-500/30 dark:bg-emerald-500/10">
            <Sparkles className="h-5 w-5 shrink-0 text-emerald-600 dark:text-emerald-400" />
            <div className="min-w-0 flex-1 text-sm">
              <div className="font-semibold text-emerald-800 dark:text-emerald-200">
                Poslední cena: {formatCZK(last.unitPrice ?? 0)} / {last.unit}
              </div>
              <div className="text-xs text-emerald-700/80 dark:text-emerald-300/80">
                {[last.drawing, last.customer, `${last.kind === "nabidka" ? "nabídka" : "zakázka"} ${last.docNumber}`, last.createdAt ? formatDate(last.createdAt) : null].filter(Boolean).join(" · ")}
              </div>
            </div>
          </div>
        )}

        {hits.length > 0 && (
          <ul className="space-y-1.5">
            {hits.map((h) => {
              const body = (
                <>
                  <span
                    className={cn(
                      "flex h-8 w-8 shrink-0 items-center justify-center rounded-lg",
                      h.kind === "nabidka" ? "bg-violet-100 text-violet-700 dark:bg-violet-500/15 dark:text-violet-300" : "bg-orange-100 text-orange-700 dark:bg-orange-500/15 dark:text-orange-300",
                    )}
                    title={h.kind === "nabidka" ? "Položka nabídky" : "Položka objednávky"}
                  >
                    {h.kind === "nabidka" ? <FileText className="h-4 w-4" /> : <ShoppingCart className="h-4 w-4" />}
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="truncate font-mono text-sm font-semibold">{h.drawing ?? h.name ?? "položka"}</span>
                      {h.quoteStatus && <QuoteStatusBadge status={h.quoteStatus} />}
                      {h.stage && <StageBadge stage={h.stage} size="xs" />}
                    </div>
                    <p className="truncate text-xs text-muted-foreground">
                      {[h.drawing ? h.name : null, h.material, h.customer, `${h.kind === "nabidka" ? "nabídka" : "zakázka"} ${h.docNumber}`,
                        `${h.qty} ${h.unit}`, h.createdAt ? formatDate(h.createdAt) : null].filter(Boolean).join(" · ")}
                    </p>
                  </div>
                  <span className={cn("shrink-0 text-sm font-semibold", h.unitPrice === null && "font-normal text-muted-foreground")}>
                    {h.unitPrice !== null ? `${formatCZK(h.unitPrice)}/${h.unit}` : "bez ceny"}
                  </span>
                </>
              );
              return (
                <li key={h.id}>
                  {h.jobId ? (
                    <Link href={`/orders/${h.jobId}`} className="flex items-center gap-3 rounded-xl border p-2.5 transition hover:border-foreground/20 hover:shadow-sm">{body}</Link>
                  ) : (
                    <div className="flex items-center gap-3 rounded-xl border p-2.5">{body}</div>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </div>
  );
}
