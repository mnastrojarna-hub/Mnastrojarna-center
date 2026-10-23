"use client";

import * as React from "react";
import {
  CalendarClock, CalendarCheck, CalendarRange, Truck, ShieldAlert, AlertTriangle, Info, Siren, type LucideIcon,
} from "lucide-react";
import { deadlineInfo, DEADLINE_BADGE } from "@/lib/jobs/deadlines";
import { ActorStamp } from "@/components/flow-status/actor-stamp";
import type { ChangeStamp } from "@/lib/jobs/flow-status";
import type { JobDetail } from "@/lib/jobs/types";
import { cn } from "@/lib/utils";
import { JobField } from "./inline-field";
import {
  DEADLINE_COLUMNS, DEADLINE_FIELDS, deadlineWarnings, dateTone, relativeDays, longDate, isReceived, type DeadlineField,
} from "./detail-helpers";

const ICONS: Record<DeadlineField, { icon: LucideIcon; cls: string }> = {
  customerRequiredDate: { icon: CalendarClock, cls: "text-sky-600 dark:text-sky-400" },
  dueDate: { icon: CalendarCheck, cls: "text-indigo-600 dark:text-indigo-400" },
  expectedDeliveryDate: { icon: CalendarRange, cls: "text-teal-600 dark:text-teal-400" },
  supplierPromisedDate: { icon: Truck, cls: "text-orange-600 dark:text-orange-400" },
  maxToleratedDate: { icon: ShieldAlert, cls: "text-red-600 dark:text-red-400" },
};

const TILE: Record<ReturnType<typeof dateTone>, string> = {
  none: "border-dashed bg-muted/20",
  done: "bg-muted/40",
  ok: "border-green-200 bg-green-50/60 dark:border-green-500/25 dark:bg-green-500/5",
  soon: "border-amber-300 bg-amber-50 dark:border-amber-500/40 dark:bg-amber-500/10",
  today: "border-orange-300 bg-orange-50 dark:border-orange-500/40 dark:bg-orange-500/10",
  past: "border-red-300 bg-red-50 dark:border-red-500/40 dark:bg-red-500/10",
};

const CHIP: Record<ReturnType<typeof dateTone>, string> = {
  none: "",
  done: "bg-muted text-muted-foreground",
  ok: "bg-green-100 text-green-800 dark:bg-green-500/15 dark:text-green-300",
  soon: "bg-amber-100 text-amber-800 dark:bg-amber-500/15 dark:text-amber-300",
  today: "bg-orange-500 text-white",
  past: "bg-red-600 text-white",
};

const WARN: Record<"info" | "warn" | "danger", { icon: LucideIcon; cls: string }> = {
  info: { icon: Info, cls: "border-sky-200 bg-sky-50 text-sky-800 dark:border-sky-500/30 dark:bg-sky-500/10 dark:text-sky-300" },
  warn: { icon: AlertTriangle, cls: "border-amber-300 bg-amber-50 text-amber-900 dark:border-amber-500/40 dark:bg-amber-500/10 dark:text-amber-200" },
  danger: { icon: Siren, cls: "border-red-300 bg-red-50 text-red-800 dark:border-red-500/40 dark:bg-red-500/10 dark:text-red-200" },
};

/** Panel termínů — všech pět termínů upravitelných na místě + varování + kdo termín naposledy změnil. */
export function DeadlinePanel({ job, fieldStamps }: { job: JobDetail; fieldStamps?: Record<string, ChangeStamp> }) {
  const info = deadlineInfo(job);
  const warnings = deadlineWarnings(job);
  const received = isReceived(job.stage, job.receivedAt);

  return (
    <section aria-label="Termíny" className="rounded-xl border bg-card p-4 shadow-sm">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <h2 className="flex items-center gap-2 text-sm font-semibold">
          <CalendarClock className="h-4 w-4 text-indigo-500" /> Termíny
        </h2>
        {info.state !== "none" && (
          <span className={cn("inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-semibold", DEADLINE_BADGE[info.state])}>
            {info.state === "done" ? "Dodáno" : `Dodat ${longDate(info.date) ?? ""}`}
            {info.state !== "done" && <span className="font-normal opacity-90">· {info.label}</span>}
          </span>
        )}
        {info.state === "none" && (
          <span className="text-xs text-muted-foreground">Zatím bez termínu — doplň, ať ho hlídáme.</span>
        )}
      </div>

      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-5">
        {DEADLINE_FIELDS.map((f) => {
          const value = job[f.key];
          let tone = dateTone(value, job.stage);
          if (f.key === "supplierPromisedDate" && received && value) tone = "done";
          const { icon, cls } = ICONS[f.key];
          const main = f.key === "dueDate";
          return (
            <div
              key={f.key}
              className={cn(
                "rounded-lg border p-2.5 transition",
                TILE[tone],
                main && "col-span-2 sm:col-span-1 ring-1 ring-indigo-500/20",
              )}
            >
              <JobField
                field={f.key}
                label={f.label}
                value={value}
                kind="date"
                icon={icon}
                iconClass={cls}
                placeholder="Doplnit datum"
                size={main ? "md" : "sm"}
                display={(v) => <span className="font-semibold">{longDate(v) ?? v}</span>}
              />
              <div className="mt-1 flex min-h-[18px] flex-wrap items-center gap-1">
                {value && tone !== "none" && (
                  <span className={cn("rounded-full px-1.5 py-px text-[10px] font-semibold", CHIP[tone])}>
                    {tone === "done" ? "splněno" : relativeDays(value)}
                  </span>
                )}
                {!value && <span className="text-[10px] leading-tight text-muted-foreground">{f.hint}</span>}
              </div>
              {fieldStamps?.[DEADLINE_COLUMNS[f.key]] && (
                <ActorStamp stamp={fieldStamps[DEADLINE_COLUMNS[f.key]]} verb="změna" short className="mt-0.5 max-w-full" />
              )}
            </div>
          );
        })}
      </div>

      {warnings.length > 0 && (
        <ul className="mt-3 space-y-1.5">
          {warnings.map((w, i) => {
            const W = WARN[w.tone];
            const Icon = W.icon;
            return (
              <li key={i} className={cn("flex items-start gap-2 rounded-lg border px-3 py-2 text-sm", W.cls)}>
                <Icon className="mt-0.5 h-4 w-4 shrink-0" />
                <span>{w.text}</span>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
