"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Award, Contact, Factory, Loader2, Pencil, Plus, Save, Wrench } from "lucide-react";
import { Dialog, DialogContent, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Button, type ButtonProps } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Field, FormSection } from "@/components/customers/form-bits";
import { StarRatingInput, TagInput } from "@/components/suppliers/tag-input";
import { createSupplier, updateSupplier } from "@/app/actions/crm";
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

/** „Nový dodavatel" / „Upravit dodavatele" — kooperace, technologie, materiály, hodnocení. */
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

  const errors = touched ? validateSupplierForm(values) : {};
  const dirty = JSON.stringify(values) !== JSON.stringify(initial);

  function set<K extends SupplierField>(key: K, v: SupplierFormValues[K]) {
    setValues((cur) => ({ ...cur, [key]: v }));
    setError(null);
  }

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
    setBusy(true);
    setError(null);
    const res = supplier ? await updateSupplier(supplier.id, values) : await createSupplier(values);
    setBusy(false);
    if (!res.ok) {
      setError(res.error ?? "Uložení se nepovedlo.");
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
      className={cn(errors[k] && "border-destructive focus-visible:ring-destructive")}
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
      >
        <div className="flex items-start gap-3 border-b px-4 py-3 pr-12 sm:px-6">
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-orange-600 text-white">
            <Factory className="h-5 w-5" />
          </span>
          <div className="min-w-0">
            <DialogTitle>{editing ? "Upravit dodavatele" : "Nový dodavatel"}</DialogTitle>
            <p className="text-xs text-muted-foreground">
              Technologie a materiály piš jako štítky — podle nich se pak hledá, kdo co umí.
            </p>
          </div>
        </div>

        <form onSubmit={submit} className="flex min-h-0 flex-1 flex-col" noValidate>
          <div className="flex-1 space-y-6 overflow-y-auto px-4 py-4 scrollbar-thin sm:px-6">
            <FormSection icon={<Factory />} tone="bg-orange-100 text-orange-700 dark:bg-orange-500/15 dark:text-orange-300" title="Firma">
              <Field id={fid("name")} label="Název" required error={errors.name} className="sm:col-span-2">
                {text("name", { placeholder: "Kalírna Brno s.r.o.", autoFocus: !editing, autoComplete: "organization" })}
              </Field>
              <Field id={fid("ico")} label="IČO" error={errors.ico}>
                {text("ico", { inputMode: "numeric", placeholder: "12345678" })}
              </Field>
              <Field id={fid("dic")} label="DIČ">
                {text("dic", { placeholder: "CZ12345678" })}
              </Field>
              <Field id={fid("address")} label="Adresa" className="sm:col-span-2">
                {text("address", { placeholder: "Hlavní 12, 602 00 Brno", autoComplete: "street-address" })}
              </Field>
              <Field id={fid("country")} label="Země">
                {text("country", { placeholder: "CZ" })}
              </Field>
              <Field id={fid("leadDays")} label="Obvyklá dodací lhůta (dní)" error={errors.leadDays}>
                {text("leadDays", { inputMode: "numeric", placeholder: "14" })}
              </Field>
            </FormSection>

            <FormSection icon={<Contact />} tone="bg-sky-100 text-sky-700 dark:bg-sky-500/15 dark:text-sky-300" title="Kontakt">
              <Field id={fid("contactPerson")} label="Kontaktní osoba">
                {text("contactPerson", { placeholder: "Pavel Dvořák", autoComplete: "name" })}
              </Field>
              <Field id={fid("email")} label="E-mail" error={errors.email}>
                {text("email", { type: "email", inputMode: "email", placeholder: "obchod@kalirna.cz", autoComplete: "email" })}
              </Field>
              <Field id={fid("phone")} label="Telefon">
                {text("phone", { type: "tel", inputMode: "tel", placeholder: "+420 777 123 456", autoComplete: "tel" })}
              </Field>
              <Field id={fid("website")} label="Web">
                {text("website", { inputMode: "url", placeholder: "kalirna.cz" })}
              </Field>
            </FormSection>

            <FormSection icon={<Wrench />} tone="bg-violet-100 text-violet-700 dark:bg-violet-500/15 dark:text-violet-300" title="Co umí" hint="Enter nebo čárka přidá štítek.">
              <Field id={fid("technologies")} label="Technologie" className="sm:col-span-2">
                <TagInput
                  id={fid("technologies")}
                  value={values.technologies}
                  onChange={(v) => set("technologies", v)}
                  placeholder="Frézování, Soustružení, Kalení…"
                  suggestions={suggestions.technologies}
                />
              </Field>
              <Field id={fid("materials")} label="Materiály" className="sm:col-span-2">
                <TagInput
                  id={fid("materials")}
                  value={values.materials}
                  onChange={(v) => set("materials", v)}
                  placeholder="1.2343, AL 7075, nerez…"
                  suggestions={suggestions.materials}
                  colored={false}
                />
              </Field>
              <Field id={fid("certifications")} label="Certifikace" className="sm:col-span-2">
                <TagInput
                  id={fid("certifications")}
                  value={values.certifications}
                  onChange={(v) => set("certifications", v)}
                  placeholder="ISO 9001, IATF 16949…"
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
                  placeholder="Např. drží termíny, kalí do 60 HRC, minimální zakázka 2 000 Kč…"
                />
              </Field>
            </FormSection>
          </div>

          <div className="border-t bg-background/95 px-4 py-3 sm:px-6">
            {error && <p className="mb-2 rounded-lg bg-destructive/10 px-3 py-2 text-sm text-destructive">{error}</p>}
            <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
              <Button type="button" variant="ghost" onClick={requestClose} disabled={busy}>Zrušit</Button>
              <Button type="submit" variant="success" disabled={busy}>
                {busy ? <Loader2 className="animate-spin" /> : <Save />}
                {editing ? "Uložit změny" : "Založit dodavatele"}
              </Button>
            </div>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
