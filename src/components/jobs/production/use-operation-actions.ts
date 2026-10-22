"use client";

import * as React from "react";
import { advanceJobOperation, moveJobOperation, setJobOperationStatus } from "@/app/actions/production";
import { OPERATION_STATUSES, type OperationStatus } from "@/lib/jobs/operations";
import { operationDisplayName } from "@/lib/jobs/production";
import type { JobOperation } from "@/lib/jobs/production-types";
import { useJobDetail } from "@/components/jobs/detail/detail-context";
import { useProduction, useRunner } from "./production-context";
import { moveLocal, primaryAction, withStatus } from "./production-helpers";

/**
 * Akce jedné operace: hlavní tlačítko (Začít / Hotovo), změna stavu z menu
 * a posun v pořadí. Vše optimisticky — při chybě se vrátí a ukáže důvod.
 */
export function useOperationActions(op: JobOperation) {
  const { ops, setOps, today } = useProduction();
  const { notify } = useJobDetail();
  const { run, isBusy } = useRunner();
  const restore = React.useCallback(
    () => setOps((list) => list.map((o) => (o.id === op.id ? op : o))),
    [op, setOps],
  );

  const advance = React.useCallback(async () => {
    const pa = primaryAction(op.status);
    if (!pa) return;
    setOps((list) => withStatus(list, op.id, pa.next, today));
    const res = await run(`adv:${op.id}`, () => advanceJobOperation(op.id), { rollback: restore });
    if (!res) return;
    if (res.nextId) {
      const next = ops.find((o) => o.id === res.nextId);
      setOps((list) => withStatus(list, res.nextId as string, "probiha", today));
      notify("success", `${op.label}: hotovo ✓ · Navazuje: ${next ? operationDisplayName(next) : "další operace"}`);
      return;
    }
    if (res.status === "hotovo") {
      const left = ops.filter((o) => o.id !== op.id && o.status !== "hotovo" && o.status !== "preskoceno");
      notify("success", left.length ? `${op.label}: hotovo ✓` : "Výroba je hotová ✓ — můžeš dodávat zákazníkovi.");
      return;
    }
    notify("success", `${operationDisplayName(op)}: probíhá`);
  }, [op, ops, setOps, today, run, restore, notify]);

  const setStatus = React.useCallback(async (status: OperationStatus) => {
    if (status === op.status) return;
    setOps((list) => withStatus(list, op.id, status, today));
    await run(`st:${op.id}`, () => setJobOperationStatus(op.id, status), {
      success: `${op.label}: ${OPERATION_STATUSES[status].label}`,
      rollback: restore,
    });
  }, [op, setOps, today, run, restore]);

  const move = React.useCallback(async (direction: "up" | "down") => {
    let before: JobOperation[] | null = null;
    setOps((list) => {
      const moved = moveLocal(list, op.id, direction);
      if (!moved) return list;
      before = list;
      return moved;
    });
    await run(`mv:${op.id}`, () => moveJobOperation(op.id, direction), {
      rollback: () => {
        if (before) setOps(before);
      },
    });
  }, [op.id, setOps, run]);

  return {
    advance,
    setStatus,
    move,
    advancing: isBusy(`adv:${op.id}`),
    busy: isBusy(`adv:${op.id}`) || isBusy(`st:${op.id}`) || isBusy(`mv:${op.id}`),
  };
}
