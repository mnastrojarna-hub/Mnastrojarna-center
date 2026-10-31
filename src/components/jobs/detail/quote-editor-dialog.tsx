"use client";

import * as React from "react";
import { FilePlus2, Pencil, Loader2, CalendarDays, Clock, Truck, Wallet, StickyNote, Type } from "lucide-react";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { createJobQuote, updateJobQuote } from "@/app/actions/jobs";
import { useAccess } from "@/components/access-provider";
import { quoteApproverWho, quoteAwaitsText, userNeedsQuoteApproval } from "@/lib/jobs/flow-status";
import { useJobDetail } from "./detail-context";
import { DialogHead, ErrorBox } from "./confirm-dialog";
import { ItemsEditor } from "./items-editor";
import { quoteFormToInput, validateQuoteForm, type QuoteFormState } from "./detail-helpers";

function Field({ label, icon: Icon, children, hint }: { label: string; icon: typeof Clock; children: React.ReactNode; hint?: string }) {
  return (
    <label className="block space-y-1">
      <span className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
        <Icon className="h-3.5 w-3.5 text-violet-500" /> {label}
      </span>
      {children}
      {hint && <span className="block text-[11px] text-muted-foreground">{hint}</span>}
    </label>
  );
}

/**
 * Nová nabídka (předvyplněná z položek zakázky) nebo úprava existující.
 * Ceny doplní člověk; DPH 21 %, platnost +30 dní.
 */
export function QuoteEditorDialog({
  open, onOpenChange, initial, quoteId, quoteNumber, approved, currency = "CZK", authorId,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  initial: QuoteFormState;
  /** Úprava existující nabídky; bez něj se zakládá nová. */
  quoteId?: string;
  quoteNumber?: string;
  approved?: boolean;
  currency?: string;
  /** Autor upravované nabídky (kdo ji schválí — vlastní nikdo). Nová nabídka = přihlášený. */
  authorId?: string | null;
}) {
  const { jobId, perms, notify, refresh } = useJobDetail();
  const access = useAccess();
  const superAdmin = access.role === "super_admin";
  // 31. 10.: uživatel bez schvalování (profil) vystavuje a odesílá jako super admin — jen bez znovuschválení;
  // nikdy nic neodesílá sám — zákazníkovi nabídku pošle až tlačítkem „Odeslat zákazníkovi"
  const selfApproves = !userNeedsQuoteApproval(access);
  // kdo nabídku schválí: schvalovatelé z dat (bez autora) + super admin — „V. Volný nebo super admin"
  const who = quoteApproverWho(access.quoteApprovers, quoteId ? authorId ?? null : access.userId) ?? "super admin";
  const [form, setForm] = React.useState<QuoteFormState>(initial);
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [wasOpen, setWasOpen] = React.useState(open);
  // při každém otevření začít od výchozích hodnot
  if (open !== wasOpen) {
    setWasOpen(open);
    if (open) {
      setForm(initial);
      setError(null);
    }
  }
  const editing = Boolean(quoteId);
  const set = <K extends keyof QuoteFormState>(k: K, v: QuoteFormState[K]) => setForm((f) => ({ ...f, [k]: v }));

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const bad = validateQuoteForm(form);
    if (bad) {
      setError(bad);
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const input = quoteFormToInput(form, perms.margins);
      const res = quoteId ? await updateJobQuote(quoteId, input) : await createJobQuote(jobId, input);
      if (!res.ok) {
        setError(res.error ?? "Nabídku se nepodařilo uložit.");
        return;
      }
      const number = "number" in res && typeof res.number === "string" ? res.number : quoteNumber;
      // #25: nabídku uživatele se schvalováním schvaluje super admin / schvalovatel; ostatní schválení nepotřebují
      // (31. 10.: nic se neodesílá samo — „teď ji odešli“ je jen nápověda k tlačítku Odeslat zákazníkovi)
      const reset = "approvalReset" in res && res.approvalReset === true;
      const pending = "needsApproval" in res && res.needsApproval === true;
      // (starší server bez needsApproval u úpravy: zrušené schválení = čeká se na nové)
      const resetPending = reset && (!("needsApproval" in res) || pending);
      notify(
        "success",
        editing
          ? resetPending ? `Nabídka upravena — změnu musí znovu schválit ${who}.` : `Nabídka ${number ?? ""} uložena.`
          : pending
            ? `Nabídka ${number ?? ""} vytvořena — ${quoteAwaitsText(who === "super admin" ? null : who)}.`
            : `Nabídka ${number ?? ""} vytvořena — teď ji odešli.`,
      );
      onOpenChange(false);
      refresh();
    } catch {
      setError("Spojení se nepovedlo — zkus to znovu.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(o) => !busy && onOpenChange(o)}>
      <DialogContent aria-describedby={undefined} className="top-[3%] max-h-[94vh] w-[calc(100%-1rem)] overflow-y-auto sm:top-[5%] sm:max-w-5xl">
        <DialogHead
          icon={editing ? Pencil : FilePlus2}
          tone="bg-violet-100 text-violet-700 dark:bg-violet-500/15 dark:text-violet-300"
          title={editing ? `Upravit nabídku ${quoteNumber ?? ""}` : "Nová nabídka"}
          subtitle={
            editing
              ? superAdmin ? "Úprava schválené nabídky ji rovnou znovu schválí (tvým jménem)."
                : selfApproves ? "Tvé nabídky schválení nepotřebují — po uložení ji vystavíš nebo odešleš tlačítkem Odeslat zákazníkovi."
                : `Každá změna zruší schválení — nabídku pak znovu schválí ${who}.`
              : superAdmin ? "Předvyplněno z položek zakázky. Doplň ceny a ulož."
                : selfApproves ? "Předvyplněno z položek zakázky. Doplň ceny a ulož — schválení nepotřebuje, zákazníkovi ji pošleš tlačítkem Odeslat zákazníkovi."
                : `Předvyplněno z položek zakázky. Doplň ceny a ulož — před odesláním ji schválí ${who}.`
          }
        />
        <form onSubmit={submit} className="space-y-5 p-4 sm:p-5" noValidate>
          <ErrorBox error={error} />
          {editing && approved && !superAdmin && (
            <p className="rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-900 dark:bg-amber-500/10 dark:text-amber-200">
              {selfApproves
                ? `Nabídka je schválená. Když ji změníš, schválení se zruší — nabídku kolegy, který potřebuje schválení, pak znovu schválí ${who}.`
                : `Nabídka je schválená. Když ji změníš, bude zase neschválená a odeslat ji půjde až po novém schválení ${who === "super admin" ? "super adminem" : `(${who})`}.`}
            </p>
          )}
          <Field label="Název nabídky" icon={Type}>
            <Input value={form.title} onChange={(e) => set("title", e.target.value)} placeholder="název nabídky (co nabízíme)" className="placeholder:italic" />
          </Field>

          <ItemsEditor
            drafts={form.items}
            onChange={(items) => {
              set("items", items);
              setError(null);
            }}
            columns={{ vat: true, purchase: perms.margins, currency }}
            emptyHint="Nabídka potřebuje aspoň jednu položku."
          />

          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <Field label="Platnost do" icon={CalendarDays}>
              <Input type="date" value={form.validUntil} onChange={(e) => set("validUntil", e.target.value)} />
            </Field>
            <Field label="Dodací lhůta (dní)" icon={Clock} hint="Od přijetí objednávky.">
              <Input inputMode="numeric" value={form.leadTimeDays} onChange={(e) => set("leadTimeDays", e.target.value)} placeholder="např. 21" />
            </Field>
            <Field label="Dodací podmínky" icon={Truck}>
              <Input value={form.deliveryTerms} onChange={(e) => set("deliveryTerms", e.target.value)} placeholder="např. DAP, naše doprava" />
            </Field>
            <Field label="Platební podmínky" icon={Wallet}>
              <Input value={form.paymentTerms} onChange={(e) => set("paymentTerms", e.target.value)} placeholder="např. splatnost 14 dní" />
            </Field>
          </div>
          <Field label="Poznámka na nabídce" icon={StickyNote}>
            <Textarea rows={2} value={form.note} onChange={(e) => set("note", e.target.value)} placeholder="Zobrazí se zákazníkovi na PDF." />
          </Field>

          <div className="sticky bottom-0 -mx-4 -mb-4 flex flex-col-reverse gap-2 border-t bg-popover/95 px-4 py-3 backdrop-blur sm:-mx-5 sm:-mb-5 sm:flex-row sm:justify-end sm:px-5">
            <Button type="button" variant="ghost" onClick={() => onOpenChange(false)} disabled={busy}>Zrušit</Button>
            <Button type="submit" variant="success" disabled={busy}>
              {busy && <Loader2 className="h-4 w-4 animate-spin" />}
              {editing ? "Uložit nabídku" : "Vytvořit nabídku"}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
