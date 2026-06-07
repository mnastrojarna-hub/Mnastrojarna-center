"use client";

import * as React from "react";
import { ChevronDown, ChevronRight, ReceiptText, Truck, Cog, MapPin, FileBox, CalendarClock, AlertTriangle } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { OrderStatusBadge } from "@/components/status-badge";
import { type OrderItem, orderStatusOrder } from "@/lib/mock-data";
import { cn, formatCZK, formatDate } from "@/lib/utils";

export function OrderBook({ orders }: { orders: OrderItem[] }) {
  const [open, setOpen] = React.useState<string | null>(orders[0]?.id ?? null);

  return (
    <Card>
      <CardContent className="p-0">
        <div className="divide-y">
          {orders.map((o) => {
            const expanded = open === o.id;
            const overdue = isOverdue(o);
            return (
              <div key={o.id}>
                <button
                  onClick={() => setOpen(expanded ? null : o.id)}
                  className="flex w-full items-center gap-3 px-4 py-3 text-left transition-colors hover:bg-muted/50"
                >
                  {expanded ? <ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground" /> : <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />}
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-medium">{o.number}</span>
                      <OrderStatusBadge status={o.status} />
                      {overdue && o.status !== "Dokončeno" && (
                        <span className="inline-flex items-center gap-1 text-xs font-medium text-destructive">
                          <AlertTriangle className="h-3 w-3" /> po termínu
                        </span>
                      )}
                    </div>
                    <p className="truncate text-xs text-muted-foreground">{o.customer} · {o.title}</p>
                  </div>
                  <div className="hidden shrink-0 items-center gap-1.5 text-xs text-muted-foreground sm:flex">
                    <CalendarClock className="h-3.5 w-3.5" /> {o.dueDate ? formatDate(o.dueDate) : "—"}
                  </div>
                  <span className="shrink-0 text-sm font-semibold">{formatCZK(o.value)}</span>
                </button>

                {expanded && (
                  <div className="space-y-4 bg-muted/30 px-4 pb-4 pt-1 sm:px-10">
                    <StageTimeline status={o.status} />

                    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                      <Info icon={<FileBox className="h-4 w-4" />} label="Výkres / materiál" value={`${o.drawing ?? "—"} · ${o.material ?? "—"}`} />
                      <Info icon={<Cog className="h-4 w-4" />} label="Technologie" value={o.technology ?? "—"} />
                      <Info icon={<MapPin className="h-4 w-4" />} label="Místo výroby" value={o.location ?? "—"} />
                      <Info icon={<FileBox className="h-4 w-4" />} label="Množství" value={o.quantity ? `${o.quantity} ks` : "—"} />
                      <Info icon={<CalendarClock className="h-4 w-4" />} label="Termín dodání" value={o.dueDate ? formatDate(o.dueDate) : "—"} />
                      <Info icon={<Cog className="h-4 w-4" />} label="Obchodník" value={o.owner} />
                    </div>

                    {o.requirements && (
                      <div className="rounded-lg border bg-background p-3 text-sm">
                        <span className="font-medium">Specifické požadavky: </span>
                        <span className="text-muted-foreground">{o.requirements}</span>
                      </div>
                    )}

                    <div className="flex flex-wrap gap-2">
                      <Button asChild size="sm">
                        <a href={`/api/pdf/order/${o.id}?type=faktura`} target="_blank" rel="noopener noreferrer">
                          <ReceiptText className="h-4 w-4" /> Faktura PDF
                        </a>
                      </Button>
                      <Button asChild size="sm" variant="outline">
                        <a href={`/api/pdf/order/${o.id}?type=dodaci-list`} target="_blank" rel="noopener noreferrer">
                          <Truck className="h-4 w-4" /> Dodací list PDF
                        </a>
                      </Button>
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </CardContent>
    </Card>
  );
}

function StageTimeline({ status }: { status: OrderItem["status"] }) {
  const current = orderStatusOrder.indexOf(status);
  return (
    <div className="flex items-center gap-1 overflow-x-auto scrollbar-thin py-1">
      {orderStatusOrder.map((s, i) => {
        const done = i < current;
        const active = i === current;
        return (
          <React.Fragment key={s}>
            <div
              className={cn(
                "flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium whitespace-nowrap",
                active ? "bg-primary text-primary-foreground" : done ? "bg-success/15 text-success" : "bg-muted text-muted-foreground",
              )}
            >
              {s}
            </div>
            {i < orderStatusOrder.length - 1 && <div className={cn("h-px w-3 shrink-0", done ? "bg-success" : "bg-border")} />}
          </React.Fragment>
        );
      })}
    </div>
  );
}

function Info({ icon, label, value }: { icon: React.ReactNode; label: string; value: string }) {
  return (
    <div className="flex items-start gap-2">
      <span className="mt-0.5 text-muted-foreground">{icon}</span>
      <div className="min-w-0">
        <div className="text-[11px] text-muted-foreground">{label}</div>
        <div className="truncate text-sm font-medium">{value}</div>
      </div>
    </div>
  );
}

function isOverdue(o: OrderItem): boolean {
  if (!o.dueDate) return false;
  return new Date(o.dueDate).getTime() < Date.now();
}
