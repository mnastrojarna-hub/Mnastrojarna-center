"use client";

import * as React from "react";
import { AlertTriangle, ArrowLeftRight, Info, Paperclip, Plus, ShoppingCart, Sparkles, Trash2, Truck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import type { ComboOption } from "@/components/jobs/book/combobox";
import { AI_FIELD, AiMark, ConfidenceMeter, DuplicateNotice, FieldLabel, TONES, ToggleRow } from "@/components/jobs/capture/capture-parts";
import { PartyPicker } from "@/components/jobs/capture/capture-review-form";
import { BATCH_TYPES } from "@/lib/jobs/capture-batch";
import type { ReviewItem, ReviewOptions } from "@/lib/jobs/capture-review";
import type { BatchDocReview, BusinessDocState, SupplierQuoteLineState } from "@/lib/jobs/capture-batch-types";
import { cn } from "@/lib/utils";

type BusinessReview = Extract<BatchDocReview, { kind: "business" }>;

/**
 * Sekce obchodního dokladu v kontrole dávky: jen pole dokladu (číslo, datum, poznámka,
 * dodavatel u dodavatelských dokladů, přepínače účinků, řádky nabídky dodavatele).
 * Údaje zakázky jsou jednou nahoře ve skupině.
 */
export function CaptureDocForm({
  doc, state, onChange, margins, options, idPrefix, groupItems, onToggleRow, onChangeType, disabled,
}: {
  doc: BusinessReview;
  state: BusinessDocState;
  onChange: (s: BusinessDocState) => void;
  margins: boolean;
  options: ReviewOptions;
  idPrefix: string;
  /** Položky skupiny (pro „Nová položka?" u nespárovaných řádků). */
  groupItems: ReviewItem[];
  onToggleRow: (row: ReviewItem, on: boolean) => void;
  /** „Změnit druh…" — zpět do Roztřídění s výběrem druhu. */
  onChangeType: () => void;
  disabled?: boolean;
}) {
  const meta = BATCH_TYPES[state.type];
  const set = (patch: Partial<BusinessDocState>) => onChange({ ...state, ...patch });
  const ai = (field: "documentNumber" | "documentDate") => doc.aiUsed && Boolean(doc.initial[field]) && state[field] === doc.initial[field];
  const supplierOptions = React.useMemo<ComboOption[]>(() => options.suppliers.map((s) => ({ value: s.id, label: s.name })), [options.suppliers]);
  const flags = doc.flags;
  const proformaOrCredit = flags.includes("proforma") || flags.includes("credit_note");
  const effects = !state.fileOnly;

  return (
    <div className="space-y-3">
      {doc.aiUsed ? (
        <div className="space-y-1.5">
          {doc.confidence !== null && <ConfidenceMeter value={doc.confidence} />}
          {doc.summary && <p className="text-sm text-foreground/80">{doc.summary}</p>}
        </div>
      ) : (
        doc.reason && <p className="text-xs text-sky-800 dark:text-sky-200">{doc.reason}</p>
      )}
      {doc.needsClarification.length > 0 && (
        <ul className="space-y-1 rounded-xl border border-amber-200 bg-amber-50 p-2.5 text-xs text-amber-900 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-100">
          {doc.needsClarification.map((t, i) => (
            <li key={i} className="flex items-start gap-1.5"><AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-500" />{t}</li>
          ))}
        </ul>
      )}
      {flags.includes("complaint") && (
        <p className="flex items-start gap-1.5 rounded-xl bg-red-50 p-2.5 text-xs text-red-800 dark:bg-red-500/10 dark:text-red-200">
          <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" /> Vypadá to na reklamaci — zkontroluj s obchodníkem.
        </p>
      )}
      {doc.duplicateOf && (
        <DuplicateNotice dup={doc.duplicateOf} value={state.onDuplicate} onChange={(onDuplicate) => set({ onDuplicate })} />
      )}

      <div className="grid gap-2.5 sm:grid-cols-2">
        <div>
          <FieldLabel htmlFor={`${idPrefix}-number`} extra={ai("documentNumber") ? <AiMark /> : undefined}>Číslo dokladu</FieldLabel>
          <Input
            id={`${idPrefix}-number`}
            value={state.documentNumber}
            maxLength={60}
            onChange={(e) => set({ documentNumber: e.target.value })}
            className={cn("font-mono", ai("documentNumber") && AI_FIELD)}
            autoComplete="off"
            disabled={disabled}
          />
        </div>
        <div>
          <FieldLabel htmlFor={`${idPrefix}-date`} extra={ai("documentDate") ? <AiMark /> : undefined}>Datum dokladu</FieldLabel>
          <Input
            id={`${idPrefix}-date`}
            type="date"
            value={state.documentDate}
            onChange={(e) => set({ documentDate: e.target.value })}
            className={cn("dark:[color-scheme:dark]", ai("documentDate") && AI_FIELD)}
            disabled={disabled}
          />
        </div>
      </div>

      {meta.side === "supplier" && (
        <div>
          <p className="mb-1.5 flex items-center gap-1.5 text-xs font-semibold text-lime-700 dark:text-lime-400">
            <Truck className="h-3.5 w-3.5" /> Dodavatel
          </p>
          <PartyPicker
            idPrefix={`${idPrefix}-sup`}
            kind="supplier"
            choice={state.supplier}
            docParty={doc.docSupplier}
            match={doc.supplierMatch}
            options={supplierOptions}
            aiUsed={doc.aiUsed}
            onChange={(supplier) => set({ supplier })}
          />
        </div>
      )}

      {effects && state.type === "dodaci_list_my" && (
        <ToggleRow
          id={`${idPrefix}-confirm`}
          label="Potvrzený zákazníkem (podpis / razítko)"
          hint={flags.includes("signed") ? "AI na dokladu vidí podpis nebo razítko převzetí." : "Zapni, když zákazník převzetí potvrdil."}
          checked={state.confirmDelivered}
          onChange={(confirmDelivered) => set({ confirmDelivered })}
          disabled={disabled}
        />
      )}

      {effects && state.type === "faktura_my" && (
        proformaOrCredit ? (
          <p className="flex items-start gap-1.5 rounded-xl bg-sky-50 p-2.5 text-xs text-sky-900 dark:bg-sky-500/10 dark:text-sky-100">
            <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            {flags.includes("proforma") ? "Zálohová (proforma) faktura" : "Dobropis"} — jen se přiloží, fakturace zakázky se nemění.
          </p>
        ) : (
          <>
            <div className="max-w-xs">
              <FieldLabel htmlFor={`${idPrefix}-due`}>Splatnost</FieldLabel>
              <Input id={`${idPrefix}-due`} type="date" value={state.invoiceDueDate} onChange={(e) => set({ invoiceDueDate: e.target.value })} className="dark:[color-scheme:dark]" disabled={disabled} />
            </div>
            <ToggleRow
              id={`${idPrefix}-paid`}
              label="Zaplaceno — zakázka je dokončená"
              hint="Posune zakázku do stavu Dokončeno."
              checked={state.paidComplete}
              onChange={(paidComplete) => set({ paidComplete })}
              disabled={disabled}
            />
          </>
        )
      )}

      {effects && state.type === "nabidka_dodavatel" && (
        margins ? (
          <QuoteLines
            idPrefix={idPrefix}
            lines={state.quoteLines}
            aiUsed={doc.aiUsed}
            onChange={(quoteLines) => set({ quoteLines })}
            disabled={disabled}
            selectWinner={state.selectWinner}
            onSelectWinner={(selectWinner) => set({ selectWinner })}
          />
        ) : (
          <p className="flex items-start gap-1.5 rounded-xl bg-lime-50 p-2.5 text-xs text-lime-900 dark:bg-lime-500/10 dark:text-lime-100">
            <ShoppingCart className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            Nabídka se přiloží jako soubor a počká v Nákupu na zapsání kolegou s přístupem k nákupním cenám.
          </p>
        )
      )}

      {effects && margins && (state.type === "potvrzeni_dodavatel" || state.type === "dodaci_list_dodavatel") && (
        <ToggleRow
          id={`${idPrefix}-po`}
          label={state.type === "potvrzeni_dodavatel" ? "Objednávku dodavateli označit jako potvrzenou" : "Objednávku dodavateli označit jako dodanou"}
          hint={flags.includes("partial") ? "Dílčí dodávka — zapni jen, když je dodáno vše." : "Podle čísla naší objednávky na dokladu."}
          checked={state.advancePurchaseOrder}
          onChange={(advancePurchaseOrder) => set({ advancePurchaseOrder })}
          disabled={disabled}
        />
      )}

      {effects && state.type === "faktura_dodavatel" && (
        <p className="flex items-start gap-1.5 rounded-xl bg-lime-50 p-2.5 text-xs text-lime-900 dark:bg-lime-500/10 dark:text-lime-100">
          <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" /> Faktura dodavatele se přiloží k zakázce — částky zkontroluj v Nákupu.
        </p>
      )}

      {effects && doc.unmatchedRows.length > 0 && (
        <div className="rounded-xl border border-teal-200 p-2.5 dark:border-teal-500/30">
          <p className="mb-1.5 text-xs font-semibold text-teal-800 dark:text-teal-300">Řádky, které nejsou v položkách zakázky — přidat jako nové?</p>
          <ul className="space-y-1.5">
            {doc.unmatchedRows.map((row) => {
              const on = groupItems.some((i) => i.key === row.key);
              return (
                <li key={row.key}>
                  <ToggleRow
                    id={`${idPrefix}-row-${row.key}`}
                    label={[row.drawingNumber, row.name].filter(Boolean).join(" · ") || "Položka bez názvu"}
                    hint={[row.quantity && `${row.quantity} ${row.unit || "ks"}`, row.material].filter(Boolean).join(" · ") || undefined}
                    checked={on}
                    onChange={(v) => onToggleRow(row, v)}
                    disabled={disabled}
                  />
                </li>
              );
            })}
          </ul>
        </div>
      )}

      <div>
        <FieldLabel htmlFor={`${idPrefix}-note`}>Poznámka k dokladu</FieldLabel>
        <Textarea
          id={`${idPrefix}-note`}
          value={state.docNote}
          onChange={(e) => set({ docNote: e.target.value })}
          placeholder="Např. ručně psané poznámky, razítko převzetí…"
          rows={2}
          maxLength={2000}
          className="min-h-[38px]"
          disabled={disabled}
        />
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <ToggleRow
          id={`${idPrefix}-fileonly`}
          label={<span className="inline-flex items-center gap-1.5"><Paperclip className="h-3.5 w-3.5" /> Jen přiložit jako soubor</span>}
          hint="Bez zápisu údajů a změn v zakázce."
          checked={state.fileOnly}
          onChange={(fileOnly) => set({ fileOnly })}
          disabled={disabled}
        />
        <Button type="button" variant="ghost" size="sm" onClick={onChangeType} disabled={disabled} className="text-muted-foreground">
          <ArrowLeftRight /> Změnit druh…
        </Button>
      </div>
    </div>
  );
}

function QuoteLines({
  idPrefix, lines, aiUsed, onChange, disabled, selectWinner, onSelectWinner,
}: {
  idPrefix: string;
  lines: SupplierQuoteLineState[];
  aiUsed: boolean;
  onChange: (l: SupplierQuoteLineState[]) => void;
  disabled?: boolean;
  selectWinner: boolean;
  onSelectWinner: (v: boolean) => void;
}) {
  const setLine = (i: number, patch: Partial<SupplierQuoteLineState>) => onChange(lines.map((l, n) => (n === i ? { ...l, ...patch } : l)));
  const cell = (i: number, l: SupplierQuoteLineState, f: keyof SupplierQuoteLineState, label: string, cls: string, extra: React.InputHTMLAttributes<HTMLInputElement> = {}) => (
    <div className={cls}>
      <label htmlFor={`${idPrefix}-q${i}-${f}`} className="mb-0.5 block text-[10px] font-medium uppercase tracking-wide text-muted-foreground">{label}</label>
      <Input
        id={`${idPrefix}-q${i}-${f}`}
        value={String(l[f] ?? "")}
        onChange={(e) => setLine(i, { [f]: e.target.value } as Partial<SupplierQuoteLineState>)}
        className={cn("h-8 px-2 text-sm", aiUsed && AI_FIELD)}
        autoComplete="off"
        disabled={disabled}
        {...extra}
      />
    </div>
  );
  return (
    <div className="space-y-2">
      <p className="flex items-center gap-1.5 text-xs font-semibold text-lime-700 dark:text-lime-400">
        <ShoppingCart className="h-3.5 w-3.5" /> Řádky nabídky → Nákup
        {aiUsed && lines.length > 0 && <Sparkles className="h-3 w-3 text-fuchsia-500" />}
      </p>
      {lines.length === 0 && <p className="text-xs text-muted-foreground">Bez řádků — nabídka se zapíše jen s dokladem.</p>}
      <ol className="space-y-2">
        {lines.map((l, i) => (
          <li key={l.key} className="rounded-xl border p-2.5">
            <div className="mb-1.5 flex items-center justify-between gap-2">
              <span className="flex items-center gap-1.5 text-xs font-semibold">
                <span className={cn("flex h-5 w-5 items-center justify-center rounded-full text-[10px]", TONES.lime)}>{i + 1}</span>
                {l.drawingNumber || l.name || "Řádek"}
              </span>
              <Button type="button" variant="ghost" size="icon-sm" className="h-7 w-7 text-red-600 dark:text-red-400" disabled={disabled} onClick={() => onChange(lines.filter((_, n) => n !== i))} aria-label="Odebrat řádek nabídky">
                <Trash2 />
              </Button>
            </div>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-6">
              {cell(i, l, "drawingNumber", "Výkres", "col-span-1 sm:col-span-2", { className: cn("h-8 px-2 font-mono text-sm", aiUsed && AI_FIELD) })}
              {cell(i, l, "name", "Název", "col-span-1 sm:col-span-2")}
              {cell(i, l, "material", "Materiál", "col-span-2 sm:col-span-2")}
              {cell(i, l, "quantity", "Množství", "col-span-1", { inputMode: "decimal", className: cn("h-8 px-2 text-right text-sm tabular-nums", aiUsed && AI_FIELD) })}
              {cell(i, l, "unit", "MJ", "col-span-1")}
              {cell(i, l, "unitPrice", "Nákup / MJ", "col-span-2", { inputMode: "decimal", className: cn("h-8 px-2 text-right text-sm tabular-nums", aiUsed && AI_FIELD) })}
            </div>
          </li>
        ))}
      </ol>
      <Button
        type="button"
        variant="outline"
        size="sm"
        disabled={disabled}
        onClick={() => onChange([...lines, { key: `new-${Date.now()}`, drawingNumber: "", name: "", material: "", quantity: "1", unit: "ks", unitPrice: "" }])}
      >
        <Plus /> Přidat řádek
      </Button>
      <ToggleRow
        id={`${idPrefix}-winner`}
        label="Vybrat jako vítěznou nabídku"
        hint="Nákupní cena a dodavatel zakázky se převezmou z této nabídky."
        checked={selectWinner}
        onChange={onSelectWinner}
        disabled={disabled}
      />
    </div>
  );
}
