"use client";

import * as React from "react";
import Link from "next/link";
import { Send, Bot, UserCheck, ChevronDown, Wand2 } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { CorrectionButton } from "@/components/correction-button";
import type { SentItem } from "@/lib/data/types";
import { cn, relativeTime } from "@/lib/utils";

const TYPE_FILTERS = ["Vše", "E-mail odpověď", "Nabídka", "Objednávka dodavateli", "Upomínka"] as const;

export function SentList({ items }: { items: SentItem[] }) {
  const [filter, setFilter] = React.useState<(typeof TYPE_FILTERS)[number]>("Vše");
  const [openId, setOpenId] = React.useState<string | null>(null);

  const filtered = items.filter((i) => filter === "Vše" || i.type === filter);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-1.5">
        {TYPE_FILTERS.map((f) => (
          <button
            key={f}
            onClick={() => setFilter(f)}
            className={cn(
              "rounded-full border px-3 py-1 text-xs font-medium transition-colors",
              filter === f
                ? "border-primary bg-primary/10 text-primary"
                : "text-muted-foreground hover:bg-accent hover:text-foreground",
            )}
          >
            {f}
          </button>
        ))}
      </div>

      {filtered.length === 0 && (
        <Card>
          <CardContent className="space-y-3 py-10 text-center text-sm text-muted-foreground">
            <Send className="mx-auto h-8 w-8 opacity-40" />
            <p className="font-medium text-foreground">Zatím nic neodešlo.</p>
            <p>
              Jakmile schválíš odpověď či nabídku (nebo ji odešle plná automatika),
              objeví se tady — včetně přesného textu.
            </p>
            <Button asChild variant="outline" size="sm">
              <Link href="/dashboard">Otevřít frontu ke schválení</Link>
            </Button>
          </CardContent>
        </Card>
      )}

      <div className="space-y-2">
        {filtered.map((item) => (
          <Card key={item.id}>
            <CardContent className="p-3">
              <div className="flex items-start gap-3">
                <div className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-muted text-muted-foreground">
                  <Send className="h-4 w-4" />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="truncate text-sm font-medium">{item.title}</span>
                    <Badge variant="secondary">{item.type}</Badge>
                    {item.auto ? (
                      <Badge variant="warning"><Bot className="h-3 w-3" /> automatika</Badge>
                    ) : (
                      <Badge variant="success"><UserCheck className="h-3 w-3" /> schváleno člověkem</Badge>
                    )}
                  </div>
                  <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                    {item.target && <span>komu: <span className="font-medium text-foreground">{item.target}</span></span>}
                    <span>· {relativeTime(item.sentAt)}</span>
                    {item.body && (
                      <button
                        onClick={() => setOpenId(openId === item.id ? null : item.id)}
                        className="inline-flex items-center gap-0.5 font-medium text-foreground/70 hover:text-foreground"
                      >
                        {openId === item.id ? "Skrýt text" : "Zobrazit odeslaný text"}
                        <ChevronDown className={cn("h-3.5 w-3.5 transition-transform", openId === item.id && "rotate-180")} />
                      </button>
                    )}
                  </div>
                </div>
              </div>

              {openId === item.id && item.body && (
                <div className="mt-3 space-y-2 border-t pt-3">
                  <pre className="whitespace-pre-wrap rounded-md bg-muted/40 p-3 font-sans text-sm">{item.body}</pre>
                  <CorrectionButton
                    agentKey={item.rawType === "email_reply" ? "email" : "quote"}
                    field="content"
                    context={`Odesláno (${item.type}): ${item.title} → ${item.target}`}
                    aiValue={item.body}
                    label="Nemělo to tak odejít? Napiš správnou verzi (AI se naučí)"
                    multiline
                  />
                </div>
              )}
            </CardContent>
          </Card>
        ))}
      </div>

      {items.length > 0 && (
        <p className="text-xs text-muted-foreground">
          <Wand2 className="mr-1 inline h-3.5 w-3.5" />
          U každé odeslané zprávy můžeš zpětně zapsat, jak měla vypadat — korekce se vloží
          do promptů a AI se příště zachová podle tebe.
        </p>
      )}
    </div>
  );
}
