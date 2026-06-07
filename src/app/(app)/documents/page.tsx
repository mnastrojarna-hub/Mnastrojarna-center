import { FileText, ReceiptText, Truck, Eye, Archive } from "lucide-react";
import { PageHeader } from "@/components/page-header";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";

const docs = [
  { type: "faktura", title: "Faktura — daňový doklad", desc: "Náležitosti dle zák. 235/2004 Sb. (DUZP, VS, rekapitulace DPH).", icon: ReceiptText },
  { type: "nabidka", title: "Cenová nabídka", desc: "Branded nabídka s položkami a DPH.", icon: FileText },
  { type: "dodaci-list", title: "Dodací list", desc: "Dodací list s podpisovými poli.", icon: Truck },
];

export default function DocumentsPage() {
  return (
    <div className="space-y-6">
      <PageHeader
        title="Dokumenty"
        description="Generování a archiv firemních dokladů v PDF — s logem a brandem MNástrojárna."
      />

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {docs.map((d) => (
          <Card key={d.type}>
            <CardHeader className="pb-3">
              <div className="flex items-center gap-2">
                <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary/10 text-primary">
                  <d.icon className="h-5 w-5" />
                </div>
                <CardTitle className="text-base">{d.title}</CardTitle>
              </div>
              <CardDescription className="pt-1">{d.desc}</CardDescription>
            </CardHeader>
            <CardContent className="flex gap-2">
              <Button asChild size="sm">
                <a href={`/api/pdf/${d.type}`} target="_blank" rel="noopener noreferrer">
                  <Eye className="h-4 w-4" /> Náhled PDF
                </a>
              </Button>
              <Button asChild size="sm" variant="outline">
                <a href={`/api/pdf/${d.type}`} download>
                  Stáhnout
                </a>
              </Button>
            </CardContent>
          </Card>
        ))}
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Archive className="h-4 w-4 text-muted-foreground" /> Archiv vystavených dokladů
          </CardTitle>
          <CardDescription>
            Každý vystavený doklad se ukládá do archivu (tabulka <code>documents</code> + Supabase Storage)
            a je dohledatelný u zákazníka i zakázky.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex items-center justify-between rounded-lg border border-dashed p-4 text-sm text-muted-foreground">
            <span>Zatím žádné vystavené doklady — vytvoř fakturu z dokončené zakázky.</span>
            <Badge variant="muted">0 dokladů</Badge>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
