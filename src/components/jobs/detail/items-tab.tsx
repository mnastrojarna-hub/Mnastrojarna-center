"use client";

import * as React from "react";
import { Save, Undo2, Loader2, AlertCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { saveJobItems } from "@/app/actions/jobs";
import type { JobItem } from "@/lib/jobs/types";
import { useJobDetail } from "./detail-context";
import { ItemsEditor } from "./items-editor";
import { draftToItemInput, draftsSignature, isBlankDraft, itemToDraft, validateDrafts, type ItemDraft } from "./detail-helpers";

/** Záložka Položky — upravitelná tabulka, „Uložit položky" → saveJobItems. */
export function ItemsTab({ items, currency, onDirtyChange }: { items: JobItem[]; currency: string; onDirtyChange?: (dirty: boolean) => void }) {
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

      <ItemsEditor
        drafts={drafts}
        onChange={(next) => {
          setDrafts(next);
          setError(null);
        }}
        columns={{ revision: true, purchase: perms.margins, currency }}
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
