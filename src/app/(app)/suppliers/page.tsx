import { Plus, Star, Sparkles, Clock } from "lucide-react";
import { PageHeader } from "@/components/page-header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { suppliers } from "@/lib/mock-data";

export default function SuppliersPage() {
  return (
    <div className="space-y-6">
      <PageHeader
        title="Dodavatelé"
        description="Technologie, materiály, ceny a dodací lhůty. AI doporučí nejvhodnějšího dodavatele."
        actions={
          <Button>
            <Plus className="h-4 w-4" /> Nový dodavatel
          </Button>
        }
      />

      <Card className="border-primary/30 bg-primary/5">
        <CardContent className="flex items-start gap-3 p-4">
          <Sparkles className="mt-0.5 h-5 w-5 shrink-0 text-primary" />
          <div className="text-sm">
            <div className="font-medium">Doporučení AI pro výkres VK-2291 (1.2379)</div>
            <p className="text-muted-foreground">
              Nejvýhodnější: <b className="text-foreground">Hofmann Tools GmbH</b> — nejlepší historická
              cena materiálu, dodání do 7 dní, hodnocení 4,7.
            </p>
          </div>
        </CardContent>
      </Card>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {suppliers.map((s) => (
          <Card key={s.id} className="transition-colors hover:border-primary/30">
            <CardHeader className="pb-3">
              <div className="flex items-center justify-between">
                <CardTitle className="text-base">{s.name}</CardTitle>
                <Badge variant="secondary">{s.country}</Badge>
              </div>
              <div className="flex items-center gap-3 text-xs text-muted-foreground">
                <span className="flex items-center gap-1 text-warning">
                  <Star className="h-3.5 w-3.5 fill-current" /> {s.rating.toFixed(1)}
                </span>
                <span className="flex items-center gap-1">
                  <Clock className="h-3.5 w-3.5" /> {s.leadDays} dní
                </span>
              </div>
            </CardHeader>
            <CardContent className="space-y-2">
              <div className="flex flex-wrap gap-1">
                {s.technologies.map((t) => (
                  <Badge key={t} variant="outline">
                    {t}
                  </Badge>
                ))}
              </div>
              <div className="flex flex-wrap gap-1">
                {s.materials.map((m) => (
                  <Badge key={m} variant="muted">
                    {m}
                  </Badge>
                ))}
              </div>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}
