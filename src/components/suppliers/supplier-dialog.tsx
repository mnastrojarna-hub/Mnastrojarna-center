"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Award, Factory, Loader2, Pencil, Plus, Save, Wrench } from "lucide-react";
import Link from "next/link";
import { Dialog, DialogContent, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Button, type ButtonProps } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { EmailSuggestInput } from "@/components/mail/recipient-field";
import { PartyBookEditor } from "@/components/contacts/party-book-editor";
import { usePartyBookDraft } from "@/components/contacts/use-party-book";
import { Field, FormSection } from "@/components/customers/form-bits";
import { StarRatingInput, TagInput } from "@/components/suppliers/tag-input";
import { createSupplier, updateSupplier } from "@/app/actions/crm";
import {
  AresButton, AresNoteText, DuplicateNotice, PartyAutofill, filledClass, useAresLookup,
} from "@/components/contacts/party-autofill";
import {
  SUPPLIER_FIELD_LABELS, applyAresToSupplierForm, applyToSupplierForm, filledSummary, mergeContactsIntoDraft, type FilledFrom,
} from "@/lib/parties/autofill";
import { icoDigits, isValidIco, type AresCompany } from "@/lib/ares/ares";
import type { PartyAutofillData, PartyDuplicate } from "@/lib/parties/autofill-types";
import {
  EMPTY_SUPPLIER_FORM, supplierFormFromView, validateSupplierForm,
  type SupplierField, type SupplierFormValues, type SupplierView,
} from "@/components/suppliers/model";
import { cn } from "@/lib/utils";

export interface SupplierSuggestions {
  technologies: string[];
  materials: string[];
  certifications: string[];
}

const NO_SUGGESTIONS: SupplierSuggestions = { technologies: [], materials: [], certifications: [] };

/** Vzor v prázdném poli = jen nápověda (kurzíva), nikdy hodnota, která by vypadala jako data. */
const HINT = "placeholder:italic placeholder:text-muted-foreground/80";

/**
 * „Nový dodavatel" / „Upravit dodavatele" — kooperace, technologie, materiály, hodnocení, všechny kontaktní
 * osoby a „Kam posílat" (poptávky, objednávky, faktury, běžná pošta). Uloží se vše najednou.
 */
export function SupplierDialog({
  supplier,
  suggestions = NO_SUGGESTIONS,
  label,
  variant,
  size,
  className,
  iconOnly = false,
}: {
  supplier?: SupplierView;
  suggestions?: SupplierSuggestions;
  label?: string;
  variant?: ButtonProps["variant"];
  size?: ButtonProps["size"];
  className?: string;
  iconOnly?: boolean;
}) {
  const router = useRouter();
  const editing = Boolean(supplier);
  const initial = React.useMemo<SupplierFormValues>(
    () => (supplier ? supplierFormFromView(supplier) : { ...EMPTY_SUPPLIER_FORM }),
    [supplier],
  );
  const [open, setOpen] = React.useState(false);
  const [values, setValues] = React.useState<SupplierFormValues>(initial);
  const [touched, setTouched] = React.useState(false);
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [duplicateId, setDuplicateId] = React.useState<string | null>(null);
  // nový dodavatel uložený, ale kontakty ne → další „Uložit" už jen upraví
  const [createdId, setCreatedId] = React.useState<string | null>(null);
  const book = usePartyBookDraft("supplier", supplier?.id ?? null, open);
  // „Vyplnit z dokladu" / ARES: která pole vyplnila AI / registr (zvýraznění do první ruční úpravy)
  const [filled, setFilled] = React.useState<Partial<Record<SupplierField, FilledFrom>>>({});
  const [found, setFound] = React.useState<PartyDuplicate | null>(null);
  const valuesRef = React.useRef(values);
  valuesRef.current = values;
  const draftRef = React.useRef(book.draft);
  draftRef.current = book.draft;
  const autoIco = React.useRef<string | null>(null);

  const errors = touched ? validateSupplierForm(values) : {};
  const dirty = JSON.stringify(values) !== JSON.stringify(initial) || book.dirty;

  function set<K extends SupplierField>(key: K, v: SupplierFormValues[K]) {
    setValues((cur) => ({ ...cur, [key]: v }));
    setError(null);
    setDuplicateId(null);
    setFilled((f) => (f[key] ? { ...f, [key]: undefined } : f));
  }

  function mark(next: Partial<Record<SupplierField, FilledFrom>>): string[] {
    setFilled((f) => ({ ...f, ...next }));
    return (Object.keys(next) as SupplierField[]).map((k) => SUPPLIER_FIELD_LABELS[k] ?? k);
  }

  function applyAres(company: AresCompany, duplicate: PartyDuplicate | null): string {
    const res = applyAresToSupplierForm(valuesRef.current, company);
    valuesRef.current = res.values;
    setValues(res.values);
    setFound(duplicate);
    setError(null);
    return filledSummary(mark(res.filled), 0, 0);
  }

  function applyDoc(data: PartyAutofillData): string {
    const res = applyToSupplierForm(valuesRef.current, data, editing ? "edit" : "new");
    valuesRef.current = res.values;
    setValues(res.values);
    let added = { contacts: 0, roles: 0 };
    if (draftRef.current) {
      const merged = mergeContactsIntoDraft(draftRef.current, data.contacts, data.roleEmails);
      draftRef.current = merged.draft;
      book.setDraft(merged.draft);
      added = { contacts: merged.addedContacts, roles: merged.addedRoles };
    }
    setFound(data.duplicate);
    setError(null);
    autoIco.current = icoDigits(res.values.ico);
    return filledSummary(mark(res.filled), added.contacts, added.roles);
  }

  const ares = useAresLookup("supplier", supplier?.id ?? createdId, applyAres);
  const aresLookup = ares.lookup;
  const aresReset = ares.reset;

  // nový dodavatel: po napsání platného IČO (a bez názvu) se ARES zeptá sám
  React.useEffect(() => {
    if (!open || editing) return;
    const digits = values.ico.replace(/\D/g, "");
    if (digits.length !== 8 || !isValidIco(digits) || values.name.trim() || autoIco.current === digits) return;
    autoIco.current = digits;
    void aresLookup(digits);
  }, [open, editing, values.ico, values.name, aresLookup]);

  function requestClose() {
    if (busy) return;
    if (dirty && !window.confirm("Zahodit neuložené změny?")) return;
    setOpen(false);
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setTouched(true);
    const errs = validateSupplierForm(values);
    const first = Object.keys(errs)[0];
    if (first) {
      document.getElementById(`sup-${first}`)?.focus();
      return;
    }
    const prepared = book.prepare();
    if ("error" in prepared) {
      setError(prepared.error);
      return;
    }
    setBusy(true);
    setError(null);
    const targetId = supplier?.id ?? createdId;
    const res = targetId ? await updateSupplier(targetId, values, prepared.input) : await createSupplier(values, prepared.input);
    setBusy(false);
    if (!res.ok) {
      setError(res.error ?? "Uložení se nepovedlo.");
      setDuplicateId((res as { duplicateId?: string }).duplicateId ?? null);
      const newId = !supplier ? (res as { id?: string }).id ?? null : null;
      if (newId && res.partySaved) setCreatedId(newId);
      return;
    }
    setOpen(false);
    router.refresh();
  }

  const fid = (k: SupplierField) => `sup-${k}`;
  const text = (k: "name" | "ico" | "dic" | "address" | "country" | "email" | "phone" | "contactPerson" | "website" | "leadDays", props: React.InputHTMLAttributes<HTMLInputElement> = {}) => (
    <Input
      id={fid(k)}
      value={values[k]}
      onChange={(e) => set(k, e.target.value)}
      aria-invalid={Boolean(errors[k])}
      aria-describedby={errors[k] ? `${fid(k)}-error` : undefined}
      className={cn(HINT, filledClass(filled[k]), errors[k] && "border-destructive focus-visible:ring-destructive")}
      data-filled={filled[k]}
      {...props}
    />
  );

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        if (o) {
          setValues(initial);
          setTouched(false);
          setError(null);
          setDuplicateId(null);
          setCreatedId(null);
          setFilled({});
          setFound(null);
          autoIco.current = null;
          aresReset();
          setOpen(true);
        } else requestClose();
      }}
    >
      <DialogTrigger asChild>
        <Button
          type="button"
          variant={variant ?? (editing ? "outline" : "default")}
          size={size ?? (iconOnly ? "icon-sm" : "default")}
          className={className}
          aria-label={iconOnly ? (editing ? `Upravit ${supplier?.name}` : "Nový dodavatel") : undefined}
          title={iconOnly ? (editing ? "Upravit dodavatele" : "Nový dodavatel") : undefined}
        >
          {editing ? <Pencil /> : <Plus />}
          {!iconOnly && (label ?? (editing ? "Upravit" : "Nový dodavatel"))}
        </Button>
      </DialogTrigger>
      <DialogContent
        aria-describedby={undefined}
        onInteractOutside={(e) => {
          if (dirty || busy) e.preventDefault();
        }}
        className={cn(
          "top-0 flex h-[100dvh] max-w-3xl flex-col overflow-hidden rounded-none",
          "sm:top-[4vh] sm:h-auto sm:max-h-[92vh] sm:w-[calc(100%-2rem)] sm:rounded-xl",
        )}
        data-testid="supplier-dialog"
      >
        <div className="flex items-start gap-3 border-b px-4 py-3 pr-12 sm:px-6">
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-orange-600 text-white">
            <Factory className="h-5 w-5" />
          </span>
          <div className="min-w-0">
            <DialogTitle>{editing ? "Upravit dodavatele" : "Nový dodavatel"}</DialogTitle>
            <p className="text-xs text-muted-foreground">
              {editing
                ? "Technologie a materiály piš jako štítky — podle nich se pak hledá, kdo co umí."
                : "Vyfoť nebo nahraj cokoli od dodavatele — AI vyplní údaje a IČO ověří v ARES. Zakládá se jen dodavatel, žádná zakázka."}
            </p>
          </div>
        </div>

        <form onSubmit={submit} className="flex min-h-0 flex-1 flex-col" noValidate>
          <div className="flex-1 space-y-6 overflow-y-auto overflow-x-hidden px-4 py-4 scrollbar-thin sm:px-6">
            <div className="space-y-3">
              <PartyAutofill kind="supplier" exceptId={supplier?.id ?? createdId} compact={editing} onApply={applyDoc} onApplyAres={applyAres} />
              <DuplicateNotice kind="supplier" duplicate={found} onOpen={() => setOpen(false)} />
            </div>
            <FormSection icon={<Factory />} tone="bg-orange-100 text-orange-700 dark:bg-orange-500/15 dark:text-orange-300" title="Firma">
              <Field id={fid("name")} label="Název" required error={errors.name} className="sm:col-span-2">
                {text("name", { placeholder: "název firmy", autoFocus: !editing, autoComplete: "organization" })}
              </Field>
              <Field
                id={fid("ico")}
                label="IČO"
                error={errors.ico}
                hint={<AresNoteText note={ares.note} fallback="Napiš IČO — ARES doplní název, DIČ a adresu." />}
              >
                <div className="flex gap-2 [&>input]:min-w-0 [&>input]:flex-1">
                  {text("ico", { inputMode: "numeric", placeholder: "8 číslic" })}
                  <AresButton busy={ares.busy} disabled={!icoDigits(values.ico)} onClick={() => void aresLookup(values.ico)} testId="sup-ares" />
                </div>
              </Field>
              <Field id={fid("dic")} label="DIČ">
                {text("dic", { placeholder: "CZ + číslo" })}
              </Field>
              <Field id={fid("address")} label="Adresa" className="sm:col-span-2">
                {text("address", { placeholder: "ulice, PSČ a město", autoComplete: "street-address" })}
              </Field>
              <Field id={fid("country")} label="Země">
                {text("country", { placeholder: "kód země" })}
              </Field>
              <Field id={fid("leadDays")} label="Obvyklá dodací lhůta (dní)" error={errors.leadDays}>
                {text("leadDays", { inputMode: "numeric", placeholder: "počet dní" })}
              </Field>
              <Field id={fid("email")} label="E-mail firmy" error={errors.email} hint="Obecná adresa — použije se, když účel nemá vlastní.">
                <EmailSuggestInput
                  id={fid("email")}
                  value={values.email}
                  onChange={(v) => set("email", v)}
                  context={supplier ? { supplierId: supplier.id } : null}
                  placeholder="obecný e-mail firmy"
                  className={cn(filledClass(filled.email), errors.email && "border-destructive focus-visible:ring-destructive")}
                />
              </Field>
              <Field id={fid("phone")} label="Telefon firmy">
                {text("phone", { type: "tel", inputMode: "tel", placeholder: "telefon na firmu", autoComplete: "tel" })}
              </Field>
              <Field id={fid("website")} label="Web" className="sm:col-span-2">
                {text("website", { inputMode: "url", placeholder: "web" })}
              </Field>
            </FormSection>

            <PartyBookEditor
              kind="supplier"
              partyId={supplier?.id ?? createdId}
              draft={book.draft}
              onChange={book.setDraft}
              partyEmail={values.email.trim() || null}
              loadError={book.loadError}
              schemaMissing={book.schemaMissing}
              idPrefix="sup"
            />

            <FormSection icon={<Wrench />} tone="bg-violet-100 text-violet-700 dark:bg-violet-500/15 dark:text-violet-300" title="Co umí" hint="Enter nebo čárka přidá štítek.">
              <Field id={fid("technologies")} label="Technologie" className="sm:col-span-2">
                <TagInput
                  id={fid("technologies")}
                  value={values.technologies}
                  onChange={(v) => set("technologies", v)}
                  placeholder="technologie (frézování, kalení…)"
                  suggestions={suggestions.technologies}
                />
              </Field>
              <Field id={fid("materials")} label="Materiály" className="sm:col-span-2">
                <TagInput
                  id={fid("materials")}
                  value={values.materials}
                  onChange={(v) => set("materials", v)}
                  placeholder="materiály (označení oceli, slitiny…)"
                  suggestions={suggestions.materials}
                  colored={false}
                />
              </Field>
              <Field id={fid("certifications")} label="Certifikace" className="sm:col-span-2">
                <TagInput
                  id={fid("certifications")}
                  value={values.certifications}
                  onChange={(v) => set("certifications", v)}
                  placeholder="certifikace"
                  suggestions={suggestions.certifications}
                  colored={false}
                />
              </Field>
            </FormSection>

            <FormSection icon={<Award />} tone="bg-amber-100 text-amber-800 dark:bg-amber-500/15 dark:text-amber-300" title="Hodnocení a poznámka">
              <Field id={fid("rating")} label="Jak jsme spokojeni" error={errors.rating} className="sm:col-span-2">
                <StarRatingInput id={fid("rating")} value={values.rating} onChange={(v) => set("rating", v)} />
              </Field>
              <Field id={fid("note")} label="Poznámka" className="sm:col-span-2">
                <Textarea
                  id={fid("note")}
                  rows={3}
                  value={values.note}
                  onChange={(e) => set("note", e.target.value)}
                  placeholder="poznámka pro tým (spolehlivost, limity, minimální zakázka…)"
                  className={HINT}
                />
              </Field>
            </FormSection>
          </div>

          <div className="border-t bg-background/95 px-4 py-3 sm:px-6">
            {error && (
              <p className="mb-2 rounded-lg bg-destructive/10 px-3 py-2 text-sm text-destructive" role="alert" data-testid="supplier-dialog-error">
                {error}{" "}
                {duplicateId && (
                  <Link href={`/suppliers?q=${encodeURIComponent(values.ico.trim() || values.name.trim())}`} className="font-semibold underline" onClick={() => setOpen(false)}>
                    Ukázat existujícího dodavatele
                  </Link>
                )}
              </p>
            )}
            <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
              <Button type="button" variant="ghost" onClick={requestClose} disabled={busy}>Zrušit</Button>
              <Button type="submit" variant="success" disabled={busy || book.loading}>
                {busy ? <Loader2 className="animate-spin" /> : <Save />}
                {editing || createdId ? "Uložit změny" : "Založit dodavatele"}
              </Button>
            </div>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
