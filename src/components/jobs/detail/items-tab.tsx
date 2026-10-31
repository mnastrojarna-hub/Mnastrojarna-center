"use client";

import * as React from "react";
import { Save, Undo2, Loader2, AlertCircle, Copy, Merge } from "lucide-react";
import { Button } from "@/components/ui/button";
import { saveJobItems } from "@/app/actions/jobs";
import { mergeDuplicateItems } from "@/app/actions/item-duplicates";
import { findDuplicateItems } from "@/lib/jobs/item-pairing";
import type { JobItem } from "@/lib/jobs/types";
import { useJobDetail } from "./detail-context";
import { ItemsEditor } from "./items-editor";
import { DrawingRevisionStrip } from "./drawing-revision-strip";
import { MailOverridesPanel } from "@/components/jobs/communication/mail-overrides-panel";
import { draftToItemInput, draftsSignature, isBlankDraft, itemToDraft, validateDrafts, type ItemDraft } from "./detail-helpers";

function itemLabel(it: JobItem): string {
  return [`${it.position + 1}`, it.drawingNumber, it.revision ? `rev. ${it.revision}` : "", it.name || it.description].filter(Boolean).join(" ");
}

/**
 * „Vypadá to na duplicitní položky (2) — Sloučit" (majitel 30. 10., Z-2026-022): stejný / podobný název,
 * počet i cena a jen jedna s výkresem, nebo součet položek = 2× hodnota zakázky. Nikdy samo — jedno ťuknutí,
 * server dvojice ověří znovu a zapíše to do historie.
 */
export function DuplicateItemsBanner({ items, value, currency }: { items: JobItem[]; value: number | null; currency: string }) {
  const { jobId, notify, refresh } = useJobDetail();
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const pairs = React.useMemo(() => findDuplicateItems(items, { orderTotal: value }), [items, value]);
  if (!pairs.length) return null;
  const byId = new Map(items.map((i) => [i.id, i]));
  const sum = items.reduce((s, i) => s + (Number(i.quantity) || 0) * (Number(i.unitPrice) || 0), 0);
  const fmt = (n: number) => new Intl.NumberFormat("cs-CZ", { style: "currency", currency: /^[A-Z]{3}$/.test(currency) ? currency : "CZK", maximumFractionDigits: 2 }).format(n);
  const after = sum - pairs.reduce((s, p) => {
    const d = byId.get(p.dropId);
    return s + (d ? (Number(d.quantity) || 0) * (Number(d.unitPrice) || 0) : 0);
  }, 0);

  async function merge() {
    setBusy(true);
    setError(null);
    try {
      const res = await mergeDuplicateItems(jobId, pairs.map((p) => ({ keepId: p.keepId, dropId: p.dropId })));
      if (!res.ok) {
        setError(res.error);
        return;
      }
      notify("success", `Sloučeno: ${res.merged} ${res.merged === 1 ? "duplicitní položka" : res.merged < 5 ? "duplicitní položky" : "duplicitních položek"}.`);
      refresh();
    } catch {
      setError("Spojení se nepovedlo — zkus to znovu.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="rounded-xl border border-amber-300 bg-amber-50 p-3 text-sm dark:border-amber-500/40 dark:bg-amber-500/10" data-testid="duplicate-items">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0 space-y-1">
          <p className="flex items-start gap-1.5 font-semibold text-amber-900 dark:text-amber-200">
            <Copy className="mt-0.5 h-4 w-4 shrink-0" /> Vypadá to na duplicitní položky ({pairs.length})
          </p>
          <ul className="space-y-0.5 text-xs text-amber-900/90 dark:text-amber-200/90">
            {pairs.map((p) => {
              const k = byId.get(p.keepId);
              const d = byId.get(p.dropId);
              return (
                <li key={p.dropId} className="break-words">
                  {d ? itemLabel(d) : "?"} = <span className="font-medium">{k ? itemLabel(k) : "?"}</span> <span className="opacity-80">({p.reason})</span>
                </li>
              );
            })}
          </ul>
          {sum > 0 && (
            <p className="text-xs tabular-nums text-amber-900/90 dark:text-amber-200/90" data-testid="duplicate-totals">
              Součet položek {fmt(sum)}{value ? ` · hodnota zakázky ${fmt(value)}` : ""} · po sloučení {fmt(after)}
            </p>
          )}
          {error && <p role="alert" className="text-xs text-red-600 dark:text-red-400">{error}</p>}
        </div>
        <Button type="button" size="sm" className="h-10 shrink-0 sm:h-9" onClick={() => void merge()} disabled={busy} data-testid="duplicate-merge">
          {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Merge className="h-4 w-4" />} Sloučit
        </Button>
      </div>
      <p className="mt-1.5 text-[11px] text-amber-900/70 dark:text-amber-200/70">
        Zůstane položka s číslem výkresu, revizí a materiálem; odkazy (objednávky dodavatelům, technologie, dodací listy, faktury, dokumenty) se na ni přesunou.
      </p>
    </div>
  );
}

/** Záložka Položky — upravitelná tabulka, „Uložit položky" → saveJobItems. */
export function ItemsTab({ items, currency, value, onDirtyChange }: { items: JobItem[]; currency: string; value?: number | null; onDirtyChange?: (dirty: boolean) => void }) {
  const { jobId, perms, notify, refresh } = useJobDetail();
  const toDrafts = React.useCallback((list: JobItem[]) => list.map((it) => itemToDraft(it)), []);
  const [drafts, setDrafts] = React.useState<ItemDraft[]>(() => toDrafts(items));
  const [base, setBase] = React.useState<JobItem[]>(items);
  const [saving, setSaving] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  // podpis právě uložených položek — platí, dokud nedorazí data ze serveru
  const [savedSig, setSavedSig] = React.useState<string | null>(null);

  const baseSig = React.useMemo(() => draftsSignature(toDrafts(base)), [base, toDrafts]);
  const sig = draftsSignature(drafts);
  // štítky z výkresu (materiál, hmotnost, TZ / PÚ) — podle id položky (= klíč konceptu)
  const specs = React.useMemo(() => Object.fromEntries(items.map((it) => [it.id, it.spec ?? null])), [items]);
  const dirty = sig !== (savedSig ?? baseSig);

  // nová data ze serveru: když nic neupravuju (nebo jsem právě uložil), převezmu je
  if (items !== base) {
    setBase(items);
    if (savedSig !== null) {
      if (sig === savedSig) setDrafts(toDrafts(items));
      setSavedSig(null);
    } else if (!dirty) {
      setDrafts(toDrafts(items));
    }
  }

  React.useEffect(() => {
    onDirtyChange?.(dirty);
  }, [dirty, onDirtyChange]);

  React.useEffect(() => {
    if (!dirty) return;
    const warn = (e: BeforeUnloadEvent) => {
      e.preventDefault();
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);

  async function save() {
    const bad = validateDrafts(drafts);
    if (bad) {
      setError(bad);
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const input = drafts.filter((d) => !isBlankDraft(d)).map((d) => draftToItemInput(d, perms.margins));
      const res = await saveJobItems(jobId, input);
      if (!res.ok) {
        setError(res.error ?? "Položky se nepodařilo uložit.");
        return;
      }
      notify("success", `Položky uloženy (${input.length}).`);
      // po uložení převzít stav ze serveru (nová id položek)
      const kept = drafts.filter((d) => !isBlankDraft(d));
      setDrafts(kept);
      setSavedSig(draftsSignature(kept));
      refresh();
    } catch {
      setError("Spojení se nepovedlo — zkus to znovu.");
    } finally {
      setSaving(false);
    }
  }

  function discard() {
    setSavedSig(null);
    setDrafts(toDrafts(items));
    setError(null);
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm text-muted-foreground">
          Díly zakázky. Ceny vyplňuje člověk — AI se z nich jen učí.
          {!perms.margins && " Nákupní ceny vidí jen obchodník a admin."}
        </p>
      </div>

      <MailOverridesPanel />

      {!dirty && <DuplicateItemsBanner items={items} value={value ?? null} currency={currency} />}

      {/* revize výkresů: aktuální revize, „rev. změněna", Nová revize… (Aktualizace výkresu) */}
      {!dirty && <DrawingRevisionStrip items={items} />}

      <ItemsEditor
        drafts={drafts}
        onChange={(next) => {
          setDrafts(next);
          setError(null);
        }}
        columns={{ revision: true, purchase: perms.margins, currency }}
        specs={specs}
      />

      {error && (
        <p role="alert" className="flex items-start gap-1.5 text-sm text-red-600 dark:text-red-400">
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" /> {error}
        </p>
      )}

      {(dirty || saving) && (
        <div className="sticky bottom-20 z-20 flex flex-col gap-2 rounded-xl border border-amber-300 bg-amber-50/95 px-4 py-3 shadow-lg backdrop-blur dark:border-amber-500/40 dark:bg-amber-950/80 sm:flex-row sm:items-center sm:justify-between md:bottom-4">
          <span className="text-sm font-medium text-amber-900 dark:text-amber-200">Máš neuložené změny v položkách.</span>
          <div className="flex gap-2">
            <Button type="button" variant="ghost" onClick={discard} disabled={saving}>
              <Undo2 className="h-4 w-4" /> Zahodit
            </Button>
            <Button type="button" variant="success" onClick={() => void save()} disabled={saving}>
              {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />} Uložit položky
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
