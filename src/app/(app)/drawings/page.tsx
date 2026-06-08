import { Upload, FileBox, Sparkles } from "lucide-react";
import { PageHeader } from "@/components/page-header";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from "@/components/ui/table";
import { getDrawings } from "@/lib/data/queries";
import { formatDate } from "@/lib/utils";

const typeVariant: Record<string, "default" | "secondary" | "success" | "warning"> = {
  PDF: "warning",
  STEP: "default",
  DXF: "secondary",
  IMG: "success",
};

export default async function DrawingsPage() {
  const drawings = await getDrawings();
  return (
    <div className="space-y-6">
      <PageHeader
        title="Archiv výkresů"
        description="PDF / STEP / DXF. AI z výkresu vytáhne číslo, revizi, materiál, rozměry i tolerance."
        actions={
          <Button>
            <Upload className="h-4 w-4" /> Nahrát výkres
          </Button>
        }
      />

      <Card className="border-dashed">
        <CardContent className="flex flex-col items-center justify-center gap-2 py-8 text-center">
          <div className="flex h-12 w-12 items-center justify-center rounded-full bg-primary/10 text-primary">
            <FileBox className="h-6 w-6" />
          </div>
          <div className="text-sm font-medium">Přetáhni výkresy sem</div>
          <p className="max-w-sm text-xs text-muted-foreground">
            <Sparkles className="inline h-3 w-3 text-primary" /> AI automaticky rozpozná metadata,
            zkontroluje duplicity a založí revizi.
          </p>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Číslo výkresu</TableHead>
                <TableHead>Rev.</TableHead>
                <TableHead>Zákazník</TableHead>
                <TableHead>Materiál</TableHead>
                <TableHead>Rozměry</TableHead>
                <TableHead className="text-right">Ks</TableHead>
                <TableHead>Typ</TableHead>
                <TableHead>Nahráno</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {drawings.length === 0 && (
                <TableRow>
                  <TableCell colSpan={8} className="py-8 text-center text-sm text-muted-foreground">
                    Zatím žádné výkresy v archivu.
                  </TableCell>
                </TableRow>
              )}
              {drawings.map((d) => (
                <TableRow key={d.id}>
                  <TableCell className="font-medium">{d.number}</TableCell>
                  <TableCell>
                    <Badge variant="outline">{d.revision}</Badge>
                  </TableCell>
                  <TableCell>{d.customer}</TableCell>
                  <TableCell className="text-muted-foreground">{d.material}</TableCell>
                  <TableCell className="text-muted-foreground">{d.dimensions}</TableCell>
                  <TableCell className="text-right">{d.qty}</TableCell>
                  <TableCell>
                    <Badge variant={typeVariant[d.fileType] ?? "secondary"}>{d.fileType}</Badge>
                  </TableCell>
                  <TableCell className="text-muted-foreground">{formatDate(d.uploadedAt)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
