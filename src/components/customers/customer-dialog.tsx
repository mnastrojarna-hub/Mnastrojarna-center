"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  Building2, Contact, Loader2, Lock, MapPin, Pencil, Plus, ReceiptText, Save, UserRound,
} from "lucide-react";
import { useAccess } from "@/components/access-provider";
import { Dialog, DialogContent, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Button, type ButtonProps } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Field, FormSection, SelectInput } from "@/components/customers/form-bits";
import { createCustomer, updateCustomer } from "@/app/actions/crm";
import {
  EMPTY_CUSTOMER_FORM, customerFormFromView, validateCustomerForm,
  type CustomerField, type CustomerFormValues, type CustomerView,
} from "@/components/customers/model";
import { cn } from "@/lib/utils";

export interface OwnerOption {
  id: string;
  name: string;
  role?: string;
}

/**
 * „Nový zákazník" / „Upravit zákazníka" — všechny údaje firmy na jednom místě.
 * Číslo zákazníka (ZK0001) přidělí systém sám, jde ho ale později přepsat.
 */
export function CustomerDialog({
  customer,
  owners,
  defaultOwnerId,
  label,
  variant,
  size,
  className,
  iconOnly = false,
  openAfterCreate = true,
}: {
  /** Bez zákazníka = založení nového. */
  customer?: CustomerView;
  owners: OwnerOption[];
  /** Obchodník předvyplněný u nového zákazníka (obvykle přihlášený). */
  defaultOwnerId?: string;
  label?: string;
  variant?: ButtonProps["variant"];
  size?: ButtonProps["size"];
  className?: string;
  iconOnly?: boolean;
  /** Po založení otevřít kartu zákazníka. */
  openAfterCreate?: boolean;
}) {
  const router = useRouter();
  const { role } = useAccess();
  const editing = Boolean(customer);
  // #25: obchodníka zákazníka vybírá jen super admin; zaměstnanec obchodníkem zákazníka není (bez předvyplnění)
  const ownerEditable = role === "super_admin";
  const presetOwner = role === "zamestnanec" ? "" : defaultOwnerId ?? "";
  const initial = React.useMemo<CustomerFormValues>(
    () => (customer ? customerFormFromView(customer) : { ...EMPTY_CUSTOMER_FORM, ownerId: presetOwner }),
    [customer, presetOwner],
  );
  const [open, setOpen] = React.useState(false);
  const [values, setValues] = React.useState<CustomerFormValues>(initial);
  const [touched, setTouched] = React.useState(false);
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [duplicateId, setDuplicateId] = React.useState<string | null>(null);

  const errors = touched ? validateCustomerForm(values) : {};
  const dirty = JSON.stringify(values) !== JSON.stringify(initial);

  function reset() {
    setValues(initial);
    setTouched(false);
    setError(null);
    setDuplicateId(null);
  }

  function set<K extends CustomerField>(key: K, v: CustomerFormValues[K]) {
    setValues((cur) => ({ ...cur, [key]: v }));
    setError(null);
    setDuplicateId(null);
  }

  function requestClose() {
    if (busy) return;
    if (dirty && !window.confirm("Zahodit neuložené změny?")) return;
    setOpen(false);
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setTouched(true);
    const errs = validateCustomerForm(values);
    const first = Object.keys(errs)[0];
    if (first) {
      document.getElementById(`cust-${first}`)?.focus();
      return;
    }
    setBusy(true);
    setError(null);
    const res = customer ? await updateCustomer(customer.id, values) : await createCustomer(values);
    setBusy(false);
    if (!res.ok) {
      setError(res.error ?? "Uložení se nepovedlo.");
      setDuplicateId(res.duplicateId ?? null);
      return;
    }
    setOpen(false);
    const newId = !customer && "id" in res ? res.id : undefined;
    if (newId && openAfterCreate) router.push(`/customers/${newId}`);
    else router.refresh();
  }

  const owner = owners.find((o) => o.id === values.ownerId);
  const fid = (k: CustomerField) => `cust-${k}`;
  const input = (k: Exclude<CustomerField, "ownerId">, props: React.InputHTMLAttributes<HTMLInputElement> = {}) => (
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
          reset();
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
          aria-label={iconOnly ? (editing ? `Upravit ${customer?.name}` : "Nový zákazník") : undefined}
          title={iconOnly ? (editing ? "Upravit zákazníka" : "Nový zákazník") : undefined}
        >
          {editing ? <Pencil /> : <Plus />}
          {!iconOnly && (label ?? (editing ? "Upravit" : "Nový zákazník"))}
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
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-green-600 text-white">
            <Building2 className="h-5 w-5" />
          </span>
          <div className="min-w-0">
            <DialogTitle>{editing ? `Upravit zákazníka ${customer?.customerNumber ?? ""}`.trim() : "Nový zákazník"}</DialogTitle>
            <p className="text-xs text-muted-foreground">
              {editing
                ? "Změny se hned projeví na nových dokladech (nabídky, potvrzení, faktury)."
                : "Stačí název — zbytek doplníš kdykoli. Zákazníka umí založit i AI z vyfocené objednávky."}
            </p>
          </div>
        </div>

        <form onSubmit={submit} className="flex min-h-0 flex-1 flex-col" noValidate>
          <div className="flex-1 space-y-6 overflow-y-auto px-4 py-4 scrollbar-thin sm:px-6">
            <FormSection icon={<Building2 />} tone="bg-green-100 text-green-700 dark:bg-green-500/15 dark:text-green-300" title="Firma">
              <Field id={fid("name")} label="Název firmy" required error={errors.name} className="sm:col-span-2">
                {input("name", { placeholder: "Strojmetal a.s.", autoFocus: !editing, autoComplete: "organization" })}
              </Field>
              <Field id={fid("ico")} label="IČO" error={errors.ico} hint="8 číslic, podle něj AI pozná zákazníka na dokladech.">
                {input("ico", { inputMode: "numeric", placeholder: "45274649" })}
              </Field>
              <Field id={fid("dic")} label="DIČ" error={errors.dic}>
                {input("dic", { placeholder: "CZ45274649" })}
              </Field>
              <Field
                id={fid("customerNumber")}
                label="Naše číslo zákazníka"
                error={errors.customerNumber}
                hint={editing ? "Prázdné = ponechat stávající číslo." : "Nevyplňuj — přidělí se samo (ZK0001…)."}
              >
                {input("customerNumber", { placeholder: editing ? customer?.customerNumber ?? "ZK…" : "přidělí se samo" })}
              </Field>
              {ownerEditable ? (
                <Field id="cust-ownerId" label="Obchodník" hint={owner ? `Zákazníka má na starosti ${owner.name}.` : "Kdo zákazníka obchodně vede."}>
                  <SelectInput id="cust-ownerId" value={values.ownerId} onChange={(e) => set("ownerId", e.target.value)}>
                    <option value="">— bez obchodníka —</option>
                    {owners.map((o) => (
                      <option key={o.id} value={o.id}>{o.name}</option>
                    ))}
                  </SelectInput>
                </Field>
              ) : (
                <div className="space-y-1" data-field="owner-readonly">
                  <span className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
                    Obchodník <Lock className="h-3 w-3" aria-label="jen pro čtení" />
                  </span>
                  <p className="flex min-h-10 items-center rounded-md border border-dashed px-3 text-sm text-muted-foreground">
                    {owner?.name ?? (values.ownerId ? "—" : "— bez obchodníka —")}
                  </p>
                  <p className="text-[11px] text-muted-foreground">Obchodníka zákazníka mění jen super admin.</p>
                </div>
              )}
            </FormSection>

            <FormSection icon={<Contact />} tone="bg-sky-100 text-sky-700 dark:bg-sky-500/15 dark:text-sky-300" title="Kontakt" hint="Další kontaktní osoby přidáš na kartě zákazníka.">
              <Field id={fid("contactPerson")} label="Kontaktní osoba">
                {input("contactPerson", { placeholder: "Ing. Jana Nováková", autoComplete: "name" })}
              </Field>
              <Field id={fid("email")} label="E-mail" error={errors.email}>
                {input("email", { type: "email", inputMode: "email", placeholder: "nakup@firma.cz", autoComplete: "email" })}
              </Field>
              <Field id={fid("phone")} label="Telefon">
                {input("phone", { type: "tel", inputMode: "tel", placeholder: "+420 777 123 456", autoComplete: "tel" })}
              </Field>
              <Field id={fid("website")} label="Web" error={errors.website}>
                {input("website", { inputMode: "url", placeholder: "firma.cz" })}
              </Field>
            </FormSection>

            <FormSection icon={<MapPin />} tone="bg-violet-100 text-violet-700 dark:bg-violet-500/15 dark:text-violet-300" title="Adresa">
              <Field id={fid("street")} label="Ulice a číslo" className="sm:col-span-2">
                {input("street", { placeholder: "Průmyslová 1520/12", autoComplete: "street-address" })}
              </Field>
              <Field id={fid("city")} label="Město">
                {input("city", { placeholder: "Brno", autoComplete: "address-level2" })}
              </Field>
              <div className="grid grid-cols-2 gap-3">
                <Field id={fid("zip")} label="PSČ">
                  {input("zip", { inputMode: "numeric", placeholder: "602 00", autoComplete: "postal-code" })}
                </Field>
                <Field id={fid("country")} label="Země">
                  {input("country", { placeholder: "CZ", autoComplete: "country" })}
                </Field>
              </div>
              <Field id={fid("deliveryAddress")} label="Dodací adresa" hint="Jen když se dodává jinam než na sídlo." className="sm:col-span-2">
                <Textarea
                  id={fid("deliveryAddress")}
                  rows={2}
                  value={values.deliveryAddress}
                  onChange={(e) => set("deliveryAddress", e.target.value)}
                  placeholder="Sklad Hala B, Výrobní 4, 602 00 Brno"
                  className="min-h-[60px]"
                />
              </Field>
            </FormSection>

            <FormSection icon={<ReceiptText />} tone="bg-amber-100 text-amber-800 dark:bg-amber-500/15 dark:text-amber-300" title="Obchodní podmínky">
              <Field id={fid("paymentTermsDays")} label="Splatnost faktur (dní)" error={errors.paymentTermsDays} hint="Předvyplní se na fakturách.">
                {input("paymentTermsDays", { inputMode: "numeric", placeholder: "30" })}
              </Field>
              <Field
                id={fid("supplierNumberAtCustomer")}
                label="Naše číslo dodavatele u zákazníka"
                hint="Zákazník nás vede pod tímto číslem — tiskne se na doklady."
              >
                {input("supplierNumberAtCustomer", { placeholder: "např. 100245" })}
              </Field>
              <Field id={fid("note")} label="Poznámka" className="sm:col-span-2">
                <Textarea
                  id={fid("note")}
                  rows={3}
                  value={values.note}
                  onChange={(e) => set("note", e.target.value)}
                  placeholder="Např. faktury posílat na fakturace@…, výkresy vždy v PDF i STEP…"
                />
              </Field>
            </FormSection>
          </div>

          <div className="border-t bg-background/95 px-4 py-3 sm:px-6">
            {error && (
              <div className="mb-2 rounded-lg bg-destructive/10 px-3 py-2 text-sm text-destructive">
                {error}{" "}
                {duplicateId && (
                  <Link href={`/customers/${duplicateId}`} className="font-semibold underline" onClick={() => setOpen(false)}>
                    Otevřít existujícího zákazníka
                  </Link>
                )}
              </div>
            )}
            <div className="flex flex-col-reverse gap-2 sm:flex-row sm:items-center sm:justify-end">
              <span className="mr-auto hidden items-center gap-1.5 text-xs text-muted-foreground sm:flex">
                <UserRound className="h-3.5 w-3.5" /> Zákazníky vidí a upravuje celý tým.
              </span>
              <Button type="button" variant="ghost" onClick={requestClose} disabled={busy}>Zrušit</Button>
              <Button type="submit" variant="success" disabled={busy}>
                {busy ? <Loader2 className="animate-spin" /> : <Save />}
                {editing ? "Uložit změny" : "Založit zákazníka"}
              </Button>
            </div>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
