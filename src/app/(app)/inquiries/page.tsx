import Link from "next/link";
import { ArrowRight, MessageSquareQuote } from "lucide-react";
import { PageHeader } from "@/components/page-header";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from "@/components/ui/table";
import { AiConfidence } from "@/components/ai-confidence";
import { getEmails, getQuotes } from "@/lib/data/queries";
import { relativeTime } from "@/lib/utils";

export default async function InquiriesPage() {
  const [emails, quotes] = await Promise.all([getEmails(), getQuotes()]);
  const inquiries = emails.filter((e) => e.category === "Poptávka");

  return (
    <div className="space-y-6">
      <PageHeader
        title="Poptávky"
        description="Každá poptávka z pošty. Tok: poptávka → nacenění → nabídka → potvrzení → zakázka."
        actions={
          <Button asChild variant="outline" size="sm">
            <Link href="/pricing">Pokračovat na Nacenění <ArrowRight className="h-3.5 w-3.5" /></Link>
          </Button>
        }
      />

      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Od</TableHead>
                <TableHead>Předmět</TableHead>
                <TableHead>Zákazník</TableHead>
                <TableHead>Přijato</TableHead>
                <TableHead>AI jistota</TableHead>
                <TableHead>Stav</TableHead>
                <TableHead />
              </TableRow>
            </TableHeader>
            <TableBody>
              {inquiries.length === 0 && (
                <TableRow>
                  <TableCell colSpan={7} className="py-10 text-center text-sm text-muted-foreground">
                    <MessageSquareQuote className="mx-auto mb-2 h-8 w-8 opacity-40" />
                    Žádné poptávky. Objeví se tu automaticky, jakmile AI v poště rozpozná poptávku.
                  </TableCell>
                </TableRow>
              )}
              {inquiries.map((e) => (
                <TableRow key={e.id}>
                  <TableCell className="font-medium">{e.from}</TableCell>
                  <TableCell className="max-w-[280px] truncate">{e.subject}</TableCell>
                  <TableCell className="text-muted-foreground">{e.customer ?? "—"}</TableCell>
                  <TableCell className="text-muted-foreground">{relativeTime(e.receivedAt)}</TableCell>
                  <TableCell><AiConfidence value={e.aiConfidence} /></TableCell>
                  <TableCell>
                    {e.hasDraft ? (
                      <Badge variant="warning">odpověď čeká na schválení</Badge>
                    ) : (
                      <Badge variant="success">zpracováno</Badge>
                    )}
                  </TableCell>
                  <TableCell className="text-right">
                    <Button asChild variant="ghost" size="sm">
                      <Link href="/inbox">Otevřít</Link>
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {quotes.length > 0 && (
        <p className="text-xs text-muted-foreground">
          Z poptávek zatím vzniklo {quotes.length} nabídek — viz{" "}
          <Link href="/quotes" className="text-primary hover:underline">Nabídky</Link>.
        </p>
      )}
    </div>
  );
}
