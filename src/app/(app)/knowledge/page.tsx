import { Upload, BrainCircuit, Search, FileText, Database } from "lucide-react";
import { PageHeader } from "@/components/page-header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";

const samples = [
  { q: "Frézovaný díl 1.2379, 120×80, 50 ks", price: "od 1 180 Kč/ks", source: "NAB-2025-204", match: "94 %" },
  { q: "Soustružený čep Ø40, 1.2343", price: "od 640 Kč/ks", source: "NAB-2025-188", match: "89 %" },
  { q: "Formová deska 1.2311, 300×200", price: "od 28 500 Kč", source: "NAB-2024-301", match: "86 %" },
];

export default function KnowledgePage() {
  return (
    <div className="space-y-6">
      <PageHeader
        title="Znalostní databáze"
        description="Historie nabídek, objednávek a faktur. AI najde podobný díl, cenu i dodavatele (RAG)."
        actions={
          <Button>
            <Upload className="h-4 w-4" /> Nahrát historii
          </Button>
        }
      />

      <div className="grid gap-3 sm:grid-cols-3">
        {[
          { label: "Indexovaných nabídek", value: "1 284", icon: FileText },
          { label: "Embeddingů (pgvector)", value: "38 920", icon: Database },
          { label: "Pokrytí historie", value: "2019–2026", icon: BrainCircuit },
        ].map((s) => (
          <Card key={s.label}>
            <CardContent className="flex items-center gap-3 p-4">
              <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10 text-primary">
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
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              placeholder="Popiš díl, materiál, rozměry…"
              className="pl-9"
              defaultValue="frézovaný díl 1.2379 120x80 50ks"
            />
          </div>
          <div className="space-y-2">
            {samples.map((s) => (
              <div
                key={s.source}
                className="flex items-center justify-between gap-3 rounded-lg border p-3 transition-colors hover:border-primary/30"
              >
                <div className="min-w-0">
                  <div className="truncate text-sm font-medium">{s.q}</div>
                  <div className="text-xs text-muted-foreground">Zdroj: {s.source}</div>
                </div>
                <div className="flex shrink-0 items-center gap-3">
                  <span className="text-sm font-semibold">{s.price}</span>
                  <Badge variant="success">{s.match}</Badge>
                </div>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
