import { Star, Clock } from "lucide-react";
import { PageHeader } from "@/components/page-header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { QuickAddDialog } from "@/components/quick-add-dialog";
import { createSupplier } from "@/app/actions/crm";
import { getSuppliers } from "@/lib/data/queries";

export default async function SuppliersPage() {
  const suppliers = await getSuppliers();
  return (
    <div className="space-y-6">
      <PageHeader
        title="Dodavatelé"
        description="Technologie, materiály, ceny a dodací lhůty pro kooperace."
        actions={
          <QuickAddDialog
            triggerLabel="Nový dodavatel"
            title="Nový dodavatel"
            action={createSupplier}
            fields={[
              { name: "name", label: "Název", required: true, placeholder: "Hofmann Tools GmbH" },
              { name: "country", label: "Země", placeholder: "DE" },
              { name: "email", label: "E-mail", type: "email" },
              { name: "technologies", label: "Technologie (oddělené čárkou)", placeholder: "Kalení, Povlakování" },
              { name: "materials", label: "Materiály (oddělené čárkou)", placeholder: "1.2343, 1.2379" },
              { name: "leadDays", label: "Dodací lhůta (dní)", type: "number" },
            ]}
          />
        }
      />

      {suppliers.length === 0 && (
        <Card>
          <CardContent className="py-8 text-center text-sm text-muted-foreground">
            Zatím žádní dodavatelé. Přidej prvního přes tlačítko Nový dodavatel.
          </CardContent>
        </Card>
      )}

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
