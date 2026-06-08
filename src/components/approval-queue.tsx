"use client";

import * as React from "react";
import { Check, X, Mail, FileText, Factory, Tag, Bot } from "lucide-react";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { AiConfidence } from "@/components/ai-confidence";
import { useAutomation } from "@/components/automation-provider";
import { approvalQueue as fallbackQueue, type ApprovalItem } from "@/lib/mock-data";
import { resolveApproval } from "@/app/actions/approvals";
import { CorrectionButton } from "@/components/correction-button";
import { relativeTime } from "@/lib/utils";

function agentKeyForType(type: ApprovalItem["type"]): string {
  switch (type) {
    case "E-mail odpověď": return "email";
    case "Nabídka": return "quote";
    case "Objednávka dodavateli": return "quote";
    case "Kategorizace": return "email";
    default: return "confirmation";
  }
}

const typeIcon: Record<ApprovalItem["type"], React.ReactNode> = {
  "E-mail odpověď": <Mail className="h-4 w-4" />,
  Nabídka: <FileText className="h-4 w-4" />,
  "Objednávka dodavateli": <Factory className="h-4 w-4" />,
  Kategorizace: <Tag className="h-4 w-4" />,
};

export function ApprovalQueue({
  compact = false,
  initialItems,
}: {
  compact?: boolean;
  initialItems?: ApprovalItem[];
}) {
  const { mode } = useAutomation();
  const [items, setItems] = React.useState(initialItems ?? fallbackQueue);

  const resolve = (id: string, action: "approved" | "rejected") => {
    setItems((prev) => prev.filter((i) => i.id !== id)); // optimistická aktualizace
    void resolveApproval(id, action); // best-effort perzistence
  };

  const approveAll = () => {
    const ids = items.map((i) => i.id);
    setItems([]);
    ids.forEach((id) => void resolveApproval(id, "approved"));
  };

  return (
    <Card>
      <CardHeader className="flex-row items-center justify-between space-y-0">
        <div className="flex items-center gap-2">
          <CardTitle className="text-base">Fronta ke schválení</CardTitle>
          {items.length > 0 && (
            <Badge variant="warning">{items.length}</Badge>
          )}
        </div>
        {mode === "full" ? (
          <span className="flex items-center gap-1.5 text-xs font-medium text-success">
            <Bot className="h-3.5 w-3.5" /> Plná automatika
          </span>
        ) : (
          items.length > 0 && (
            <Button variant="ghost" size="sm" onClick={approveAll}>Schválit vše</Button>
          )
        )}
      </CardHeader>
      <CardContent className="space-y-2">
        {mode === "full" && (
          <div className="rounded-lg border border-dashed bg-success/5 p-3 text-xs text-muted-foreground">
            V režimu <span className="font-medium text-success">plné automatiky</span> AI tyto akce
            odesílá sama. Přepni na <span className="font-medium text-primary">Se schválením</span>,
            pokud chceš každou akci nejprve potvrdit.
          </div>
        )}

        {items.length === 0 && (
          <div className="py-6 text-center text-sm text-muted-foreground">
            Vše vyřízeno. 🎉 Žádné čekající akce.
          </div>
        )}

        {items.map((item) => (
          <div
            key={item.id}
            className="flex items-start gap-3 rounded-lg border bg-card p-3 transition-colors hover:border-primary/30"
          >
            <div className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-primary/10 text-primary">
              {typeIcon[item.type]}
            </div>
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <span className="truncate text-sm font-medium">{item.title}</span>
                <AiConfidence value={item.aiConfidence} />
              </div>
              {!compact && <p className="mt-0.5 text-sm text-muted-foreground">{item.summary}</p>}
              <div className="mt-1 flex items-center gap-2 text-xs text-muted-foreground">
                <Badge variant="secondary">{item.type}</Badge>
                <span className="truncate">{item.target}</span>
                <span>· {relativeTime(item.createdAt)}</span>
              </div>
              {!compact && (
                <div className="mt-1">
                  <CorrectionButton
                    agentKey={agentKeyForType(item.type)}
                    field="content"
                    context={`${item.type}: ${item.title} (${item.target})`}
                    aiValue={item.summary}
                    label="Špatně? Oprav (AI se naučí)"
                  />
                </div>
              )}
            </div>
            <div className="flex shrink-0 items-center gap-1">
              <Button variant="ghost" size="icon-sm" aria-label="Zamítnout" onClick={() => resolve(item.id, "rejected")}>
                <X className="h-4 w-4" />
              </Button>
              <Button variant="success" size="icon-sm" aria-label="Schválit" onClick={() => resolve(item.id, "approved")}>
                <Check className="h-4 w-4" />
              </Button>
            </div>
          </div>
        ))}
      </CardContent>
    </Card>
  );
}
