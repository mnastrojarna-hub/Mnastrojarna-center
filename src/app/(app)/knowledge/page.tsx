import Link from "next/link";
import { BrainCircuit, Search, FileText, Database, FileBox } from "lucide-react";
import { PageHeader } from "@/components/page-header";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { createOperatorClient, isSupabaseConfigured } from "@/lib/supabase/server";
import { formatCZK, formatDate } from "@/lib/utils";

interface HistoryHit {
  id: string;
  drawing: string;
  quote: string;
  status: string;
  qty: number;
  unitPrice: number | null;
  createdAt: string;
}

/** Fulltextové hledání v historii nabídek (podle čísla výkresu / názvu). */
async function searchHistory(q: string): Promise<HistoryHit[]> {
  if (!q.trim() || !isSupabaseConfigured()) return [];
  try {
    const db = await createOperatorClient();
    const { data } = await db
      .from("quote_items")
      .select("id, quantity, unit_price, quotes(number, status, created_at), drawings(drawing_number, material)")
      .or(`drawing_number.ilike.%${q.trim()}%,material.ilike.%${q.trim()}%`, { foreignTable: "drawings" })
      .limit(10);
    type Row = {
      id: string; quantity: number; unit_price: number | null;
      quotes?: { number: string; status: string; created_at: string } | null;
      drawings?: { drawing_number: string; material: string | null } | null;
    };
    return ((data ?? []) as Row[])
      .filter((r) => r.drawings)
      .map((r) => ({
        id: r.id,
        drawing: `${r.drawings?.drawing_number}${r.drawings?.material ? ` · ${r.drawings.material}` : ""}`,
        quote: r.quotes?.number ?? "—",
        status: r.quotes?.status ?? "—",
        qty: r.quantity,
        unitPrice: r.unit_price ? Number(r.unit_price) : null,
        createdAt: r.quotes?.created_at ?? "",
      }));
  } catch {
    return [];
  }
}

async function getStats() {
  const empty = { knowledge: 0, quotes: 0, drawings: 0 };
  if (!isSupabaseConfigured()) return empty;
  try {
    const db = await createOperatorClient();
    const [k, q, d] = await Promise.all([
      db.from("knowledge_documents").select("id", { count: "exact", head: true }),
      db.from("quotes").select("id", { count: "exact", head: true }),
      db.from("drawings").select("id", { count: "exact", head: true }),
    ]);
    return { knowledge: k.count ?? 0, quotes: q.count ?? 0, drawings: d.count ?? 0 };
  } catch {
    return empty;
  }
}

export default async function KnowledgePage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string }>;
}) {
  const { q = "" } = await searchParams;
  const [stats, hits] = await Promise.all([getStats(), searchHistory(q)]);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Znalostní databáze"
        description="Historie nabídek, zakázek a výkresů. AI z ní čerpá při hledání podobných dílů a cen (RAG)."
        actions={
          <Button asChild variant="outline">
            <Link href="/drawings">Nahrát výkresy / historii</Link>
          </Button>
        }
      />

      <div className="grid gap-3 sm:grid-cols-3">
        {[
          { label: "Nabídek v historii", value: String(stats.quotes), icon: FileText },
          { label: "Výkresů v archivu", value: String(stats.drawings), icon: FileBox },
          { label: "Znalostních dokumentů", value: String(stats.knowledge), icon: Database },
        ].map((s) => (
          <Card key={s.label}>
            <CardContent className="flex items-center gap-3 p-4">
              <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-success/10 text-success">
                <s.icon className="h-5 w-5" />
              </div>
              <div>
                <div className="text-lg font-semibold">{s.value}</div>
                <div className="text-xs text-muted-foreground">{s.label}</div>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Najdi podobný díl / cenu</CardTitle>
          <CardDescription>
            Hledá v reálné historii nabídek podle čísla výkresu nebo materiálu.
            Stejnou znalost používá AI při naceňování.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <form className="relative" action="/knowledge">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              name="q"
              placeholder="Číslo výkresu nebo materiál (např. VK-2291 nebo 1.2379)…"
              className="pl-9"
              defaultValue={q}
            />
          </form>

          {q && hits.length === 0 && (
            <p className="py-4 text-center text-sm text-muted-foreground">
              Nic nenalezeno pro dotaz <b>{q}</b>. Historie se plní s každou nabídkou a nahraným výkresem.
            </p>
          )}
          {!q && (
            <p className="flex items-center gap-2 py-4 text-center text-sm text-muted-foreground">
              <BrainCircuit className="h-4 w-4" />
              Zadej dotaz — výsledky pocházejí z tvých skutečných nabídek, žádná ukázková data.
            </p>
          )}

          <div className="space-y-2">
            {hits.map((h) => (
              <div
                key={h.id}
                className="flex items-center justify-between gap-3 rounded-lg border p-3 transition-colors hover:border-primary/30"
              >
                <div className="min-w-0">
                  <div className="truncate text-sm font-medium">{h.drawing}</div>
                  <div className="text-xs text-muted-foreground">
                    Nabídka {h.quote} · {h.qty} ks{h.createdAt ? ` · ${formatDate(h.createdAt)}` : ""}
                  </div>
                </div>
                <div className="flex shrink-0 items-center gap-3">
                  <span className="text-sm font-semibold">
                    {h.unitPrice ? `${formatCZK(h.unitPrice)}/ks` : "bez ceny"}
                  </span>
                  <Badge variant="secondary">{h.status}</Badge>
                </div>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
