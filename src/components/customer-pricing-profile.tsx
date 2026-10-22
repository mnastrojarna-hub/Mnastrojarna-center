"use client";

import * as React from "react";
import { Loader2, TrendingUp, Check } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { updateCustomerPricingProfile } from "@/app/actions/crm";
import type { Customer } from "@/lib/supabase/database.types";

/**
 * Zákaznický cenový profil: individuální marže, cenová hladina, obchodní
 * priorita, platební morálka, rizikovost, roční obrat, opakovaný zákazník.
 * AI Nacenění profil automaticky načítá a promítá do strategie a marže.
 */
export function CustomerPricingProfile({ customer }: { customer: Customer }) {
  const [form, setForm] = React.useState({
    marginPercent: customer.margin_percent != null ? String(customer.margin_percent) : "",
    priceLevel: customer.price_level ?? "",
    businessPriority: customer.business_priority ?? "",
    paymentMorale: customer.payment_morale ?? "",
    riskLevel: customer.risk_level ?? "",
    annualRevenueCzk: customer.annual_revenue_czk != null ? String(customer.annual_revenue_czk) : "",
    repeatCustomer: customer.repeat_customer ?? false,
  });
  const [busy, setBusy] = React.useState(false);
  const [saved, setSaved] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  const set = (k: keyof typeof form, v: string | boolean) => {
    setForm((f) => ({ ...f, [k]: v }));
    setSaved(false);
  };

  const save = async () => {
    setBusy(true); setError(null);
    const res = await updateCustomerPricingProfile({ id: customer.id, ...form });
    setBusy(false);
    if (res.ok) setSaved(true);
    else setError(res.error ?? "Chyba ukládání.");
  };

  const sel = "h-9 w-full rounded-md border border-input bg-background px-2 text-sm";

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center gap-2 text-base">
          <TrendingUp className="h-4 w-4 text-muted-foreground" /> Cenový profil (AI nacenění)
        </CardTitle>
        <CardDescription>
          Profil se automaticky promítá do každé kalkulace: individuální marže má přednost,
          priorita/riziko/hladina posouvají cenovou strategii.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          <Field label="Individuální marže (%)">
            <Input value={form.marginPercent} onChange={(e) => set("marginPercent", e.target.value)} type="number" placeholder="výchozí dle parametrů" />
          </Field>
          <Field label="Cenová hladina">
            <select className={sel} value={form.priceLevel} onChange={(e) => set("priceLevel", e.target.value)}>
              <option value="">— standard —</option>
              <option value="nizka">Nízká (konkurenční trh)</option>
              <option value="standard">Standard</option>
              <option value="premium">Prémiová</option>
            </select>
          </Field>
          <Field label="Obchodní priorita">
            <select className={sel} value={form.businessPriority} onChange={(e) => set("businessPriority", e.target.value)}>
              <option value="">— neurčeno —</option>
              <option value="nizka">Nízká</option>
              <option value="stredni">Střední</option>
              <option value="vysoka">Vysoká (atraktivní)</option>
              <option value="strategicky">Strategický zákazník</option>
            </select>
          </Field>
          <Field label="Platební morálka">
            <select className={sel} value={form.paymentMorale} onChange={(e) => set("paymentMorale", e.target.value)}>
              <option value="">— neurčeno —</option>
              <option value="vyborna">Výborná</option>
              <option value="dobra">Dobrá</option>
              <option value="prumerna">Průměrná</option>
              <option value="spatna">Špatná (zdraží)</option>
            </select>
          </Field>
          <Field label="Rizikovost">
            <select className={sel} value={form.riskLevel} onChange={(e) => set("riskLevel", e.target.value)}>
              <option value="">— neurčeno —</option>
              <option value="nizke">Nízké</option>
              <option value="stredni">Střední</option>
              <option value="vysoke">Vysoké (zdraží)</option>
            </select>
          </Field>
          <Field label="Roční obrat (Kč)">
            <Input value={form.annualRevenueCzk} onChange={(e) => set("annualRevenueCzk", e.target.value)} type="number" placeholder="např. 1 500 000" />
          </Field>
        </div>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={form.repeatCustomer} onChange={(e) => set("repeatCustomer", e.target.checked)} className="h-4 w-4 rounded border-input" />
          Opakovaný zákazník (opakovatelné zakázky → příznivější cena)
        </label>
        {error && <p className="text-xs text-destructive">{error}</p>}
        <div className="flex items-center gap-2">
          <Button size="sm" onClick={save} disabled={busy}>
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : null} Uložit profil
          </Button>
          {saved && <span className="inline-flex items-center gap-1 text-xs text-success"><Check className="h-3.5 w-3.5" /> Uloženo — platí pro další nacenění.</span>}
        </div>
      </CardContent>
    </Card>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1.5">
      <label className="text-xs font-medium text-muted-foreground">{label}</label>
      {children}
    </div>
  );
}
