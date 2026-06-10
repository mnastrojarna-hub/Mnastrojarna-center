"use client";

import * as React from "react";
import { Sparkles, Loader2, Calculator, FileText, AlertCircle, Upload, History } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { AiConfidence } from "@/components/ai-confidence";
import { CorrectionButton } from "@/components/correction-button";
import { submitAiQuote, type SubmitQuoteResult } from "@/app/actions/ai-quote";
import { formatCZK } from "@/lib/utils";

interface Tol { t005: number; t01: number; t04: number; t1: number }
interface Extracted {
  part_name: string; part_type: string; order_type: string;
  drawing_number: string; revision: string; material: string;
  blank_dimensions: string; blank_weight_kg: number; finished_weight_kg: number; removed_weight_kg: number;
  surface_treatment: string; heat_treatment: string;
  surface_qualities: string[]; machining_technologies: string[];
  tolerances_before_ht: Tol; tolerances_after_ht: Tol;
  quantity: number; customer: string; requirements: string; summary: string;
  confidence: number; needs_clarification: string[];
}
interface Estimate {
  material: string; blank_weight_kg: number; removed_weight_kg: number;
  operations: { name: string; machine_minutes: number; setup_minutes: number }[];
  handling_minutes: number; transport_cost: number;
  material_cost_per_piece: number; surface_treatment_cost: number; heat_treatment_cost: number;
  cooperation_cost_per_piece: number; labor_rate_per_hour: number; margin_percent: number;
  unit_price: number; total_price: number; lead_time_days: number;
  historical_used: boolean; historical_note: string;
  confidence: number; reasoning: string; needs_clarification: string[];
}
interface Quote {
  items: { description: string; quantity: number; unit: string; unit_price: number; vat_rate: number }[];
  lead_time_days: number; valid_until_days: number; cover_email: string; note: string;
}

const PART_TYPE: Record<string, string> = {
  obrabeny_dil: "Obráběný díl", plech: "Plech", svarenec: "Svařenec", vykovek: "Výkovek", odlitek: "Odlitek", jine: "Jiné",
};
const ORDER_TYPE: Record<string, string> = {
  vyroba_dilu: "Výroba dílu", nastroj_na_dil: "Nástroj na výrobu dílu", uprava_dilu: "Úprava dodaného dílu",
};

export function AiPricingPanel() {
  const [form, setForm] = React.useState({
    drawingNumber: "", material: "", dimensions: "",
    quantity: "", customer: "", customerEmail: "",
    requirements: "",
  });
  const [extracted, setExtracted] = React.useState<Extracted | null>(null);
  const [estimate, setEstimate] = React.useState<Estimate | null>(null);
  const [historical, setHistorical] = React.useState<{ found: boolean; unitPrice?: number; note?: string } | null>(null);
  const [quote, setQuote] = React.useState<Quote | null>(null);
  const [loading, setLoading] = React.useState<"" | "price" | "quote" | "all">("");
  const [extracting, setExtracting] = React.useState(false);
  const [autoMsg, setAutoMsg] = React.useState<string | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const fileRef = React.useRef<HTMLInputElement>(null);

  const upd = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
    setForm((f) => ({ ...f, [k]: e.target.value }));

  // Bohatá data z výkresu do požadavku na ocenění
  const richBody = () => ({
    ...form,
    quantity: Number(form.quantity),
    blankDimensions: extracted?.blank_dimensions || form.dimensions,
    partType: extracted?.part_type,
    orderType: extracted?.order_type,
    blankWeightKg: extracted?.blank_weight_kg,
    finishedWeightKg: extracted?.finished_weight_kg,
    surfaceTreatment: extracted?.surface_treatment,
    heatTreatment: extracted?.heat_treatment,
    surfaceQualities: extracted?.surface_qualities,
    machiningTechnologies: extracted?.machining_technologies,
    tolerancesBeforeHt: extracted?.tolerances_before_ht,
    tolerancesAfterHt: extracted?.tolerances_after_ht,
  });

  const onFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setExtracting(true); setError(null);
    try {
      const fd = new FormData(); fd.append("file", file);
      const res = await fetch("/api/ai/extract", { method: "POST", body: fd });
      const data = await res.json();
      if (data.error) setError(data.error);
      else {
        const x: Extracted = data.extracted;
        setExtracted(x);
        setForm((f) => ({
          ...f,
          drawingNumber: x.drawing_number || f.drawingNumber,
          material: x.material || f.material,
          dimensions: x.blank_dimensions || f.dimensions,
          quantity: x.quantity ? String(x.quantity) : f.quantity,
          customer: x.customer || f.customer,
          requirements: x.requirements || f.requirements,
        }));
      }
    } catch { setError("Nepodařilo se přečíst přílohu."); }
    finally { setExtracting(false); if (fileRef.current) fileRef.current.value = ""; }
  };

  const price = async () => {
    setLoading("price"); setError(null); setQuote(null);
    try {
      const res = await fetch("/api/ai/price", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(richBody()) });
      const data = await res.json();
      if (data.error) setError(data.error);
      else { setEstimate(data.estimate); setHistorical(data.historical ?? null); }
    } catch { setError("Nepodařilo se spojit s AI."); }
    finally { setLoading(""); }
  };

  const makeQuote = async () => {
    setLoading("quote"); setError(null);
    try {
      const inquiry = `Výkres ${form.drawingNumber}, materiál ${form.material}, ${form.dimensions}, ${form.quantity} ks. ${form.requirements}`;
      const res = await fetch("/api/ai/quote", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...richBody(), inquiry, withPricing: !estimate }) });
      const data = await res.json();
      if (data.error) setError(data.error);
      else { setQuote(data.quote); if (data.estimate) setEstimate(data.estimate); }
    } catch { setError("Nepodařilo se spojit s AI."); }
    finally { setLoading(""); }
  };

  const processAll = async () => {
    setLoading("all"); setError(null); setAutoMsg(null); setQuote(null);
    try {
      const res = await fetch("/api/ai/process-inquiry", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...richBody(), autoSend: !!form.customerEmail }) });
      const data = await res.json();
      if (data.error) { setError(data.error); return; }
      if (data.estimate) setEstimate(data.estimate);
      if (data.quote) setQuote(data.quote);
      const r = data.result;
      if (r?.ok) setAutoMsg(`Nabídka ${r.number} naceněna, vytvořena${r.archived ? ", archivována" : ""} a ${r.sent ? "odeslána." : "zařazena ke schválení."}`);
      else if (r?.error) setAutoMsg(`Naceněno, ale uložení: ${r.error}`);
      else setAutoMsg("Naceněno a vytvořena nabídka (uložení vyžaduje servisní klíč).");
    } catch { setError("Nepodařilo se zpracovat."); }
    finally { setLoading(""); }
  };

  return (
    <Card className="border-primary/30">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <Sparkles className="h-4 w-4 text-primary" /> AI ocenění dle výkresu (jako technolog)
        </CardTitle>
        <CardDescription>
          Nahraj výkres → AI vytáhne kompletní technologická data (typ dílu, polotovar, váhy, tolerance, úpravy) a ocení jako kalkulant.
          Vše lze opravit, AI se z korekcí učí. Parametry (sazby, marže, inflace) laď v Nacenění / Ladění & korekce.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          <Field label="Číslo výkresu"><Input value={form.drawingNumber} onChange={upd("drawingNumber")} placeholder="např. VK-1234" /></Field>
          <Field label="Materiál"><Input value={form.material} onChange={upd("material")} placeholder="např. 1.2379" /></Field>
          <Field label="Rozměry polotovaru"><Input value={form.dimensions} onChange={upd("dimensions")} placeholder="např. 120 × 80 × 25 mm" /></Field>
          <Field label="Množství (ks)"><Input value={form.quantity} onChange={upd("quantity")} type="number" placeholder="50" /></Field>
          <Field label="Zákazník"><Input value={form.customer} onChange={upd("customer")} placeholder="Název firmy" /></Field>
          <Field label="E-mail zákazníka (pro odeslání)"><Input value={form.customerEmail} onChange={upd("customerEmail")} type="email" placeholder="nepovinné" /></Field>
        </div>
        <Field label="Specifické požadavky">
          <Textarea value={form.requirements} onChange={upd("requirements")} className="min-h-[60px]" />
        </Field>

        <div className="flex flex-wrap items-center gap-2">
          <input ref={fileRef} type="file" accept="application/pdf,image/png,image/jpeg,image/webp" onChange={onFile} className="hidden" />
          <Button variant="secondary" onClick={() => fileRef.current?.click()} disabled={extracting}>
            {extracting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}
            Načíst z výkresu (PDF/obrázek)
          </Button>
        </div>

        {extracted && <ExtractedView x={extracted} drawingNumber={form.drawingNumber} />}

        <div className="rounded-lg border border-primary/40 bg-primary/5 p-3">
          <div className="mb-2 text-sm font-medium">AI od A do Z jedním klikem</div>
          <Button onClick={processAll} disabled={loading !== ""}>
            {loading === "all" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
            Naceň → nabídka → ulož &amp; zařaď{form.customerEmail ? " &amp; odešli" : ""}
          </Button>
          {autoMsg && <p className="mt-2 text-sm text-success">{autoMsg}</p>}
        </div>

        <div className="flex flex-wrap gap-2">
          <Button variant="outline" onClick={price} disabled={loading !== ""}>
            {loading === "price" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Calculator className="h-4 w-4" />} Naceň jako technolog
          </Button>
          <Button variant="outline" onClick={makeQuote} disabled={loading !== ""}>
            {loading === "quote" ? <Loader2 className="h-4 w-4 animate-spin" /> : <FileText className="h-4 w-4" />} Vygenerovat nabídku
          </Button>
        </div>

        {error && (
          <div className="flex items-start gap-2 rounded-lg bg-destructive/10 p-3 text-sm text-destructive">
            <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" /> {error}
          </div>
        )}

        {historical?.found && (
          <div className="flex items-center gap-2 rounded-lg border border-warning/40 bg-warning/5 p-3 text-sm">
            <History className="h-4 w-4 text-warning" />
            Historie: díl se už naceňoval{historical.note ? ` (${historical.note})` : ""}{historical.unitPrice ? ` — původní cena/ks ${formatCZK(historical.unitPrice)}` : ""}. AI z ní vyjde + inflace.
          </div>
        )}

        {estimate && <EstimateView e={estimate} context={`Výkres ${form.drawingNumber}, ${form.material}, ${form.quantity} ks, ${form.requirements}`} />}
        {quote && <QuoteView q={quote} />}
        {quote && <SubmitBar quote={quote} customer={form.customer} />}
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

function tolLine(t: Tol) {
  return `≤0,005: ${t.t005} · ≤0,01: ${t.t01} · ≤0,04: ${t.t04} · ≤0,1: ${t.t1}`;
}

function ExtractedView({ x, drawingNumber }: { x: Extracted; drawingNumber: string }) {
  return (
    <div className="space-y-3 rounded-lg border bg-muted/30 p-4">
      <div className="flex items-center justify-between">
        <div className="text-sm font-semibold">Přečteno z výkresu</div>
        <AiConfidence value={x.confidence} />
      </div>
      <div className="flex flex-wrap gap-1.5">
        {x.part_name && <Badge variant="default">{x.part_name}</Badge>}
        <Badge variant="secondary">{PART_TYPE[x.part_type] ?? x.part_type}</Badge>
        <Badge variant="outline">{ORDER_TYPE[x.order_type] ?? x.order_type}</Badge>
      </div>
      <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3 text-sm">
        <Info label="Materiál" value={x.material || "—"} />
        <Info label="Polotovar" value={`${x.blank_dimensions || "—"} (${x.blank_weight_kg || "?"} kg)`} />
        <Info label="Hotový díl / úběr" value={`${x.finished_weight_kg || "?"} kg / úběr ${x.removed_weight_kg || "?"} kg`} />
        <Info label="Povrchová úprava" value={x.surface_treatment || "—"} />
        <Info label="Tepelná úprava" value={x.heat_treatment || "—"} />
        <Info label="Jakosti povrchů" value={x.surface_qualities?.join(", ") || "—"} />
        <Info label="Technologie" value={x.machining_technologies?.join(", ") || "—"} />
        <Info label="Přesné rozměry — před tepelkou" value={tolLine(x.tolerances_before_ht)} />
        <Info label="Přesné rozměry — po tepelce" value={tolLine(x.tolerances_after_ht)} />
      </div>
      {x.needs_clarification?.length > 0 && (
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="text-xs font-medium text-warning">K doplnění:</span>
          {x.needs_clarification.map((n, i) => <Badge key={i} variant="warning">{n}</Badge>)}
        </div>
      )}
      <div className="border-t pt-2">
        <CorrectionButton agentKey="extraction" field="drawing" context={`Výkres ${drawingNumber}`} aiValue={`${PART_TYPE[x.part_type]}, ${x.material}, polotovar ${x.blank_dimensions}`} label="Přečteno špatně? Oprav (AI se naučí)" multiline />
      </div>
    </div>
  );
}

function EstimateView({ e, context }: { e: Estimate; context: string }) {
  return (
    <div className="space-y-3 rounded-lg border bg-muted/30 p-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2 text-sm font-semibold">
          Kalkulace technologa
          {e.historical_used && <Badge variant="warning"><History className="h-3 w-3" /> dle historie + inflace</Badge>}
        </div>
        <AiConfidence value={e.confidence} />
      </div>
      <div className="grid gap-2 sm:grid-cols-3">
        <Stat label="Cena / ks" value={formatCZK(e.unit_price)} accent />
        <Stat label="Celkem" value={formatCZK(e.total_price)} accent />
        <Stat label="Dodací lhůta" value={`${e.lead_time_days} dní`} />
        <Stat label="Materiál / ks" value={formatCZK(e.material_cost_per_piece)} />
        <Stat label="Polotovar / úběr" value={`${e.blank_weight_kg} / ${e.removed_weight_kg} kg`} />
        <Stat label="Povrch / tepelka" value={`${formatCZK(e.surface_treatment_cost)} / ${formatCZK(e.heat_treatment_cost)}`} />
        <Stat label="Manipulace" value={`${e.handling_minutes} min`} />
        <Stat label="Doprava" value={formatCZK(e.transport_cost)} />
        <Stat label="Sazba / marže" value={`${formatCZK(e.labor_rate_per_hour)}/h · ${e.margin_percent} %`} />
      </div>
      {e.operations.length > 0 && (
        <div>
          <div className="mb-1 text-xs font-medium text-muted-foreground">Technologické operace</div>
          <div className="space-y-1">
            {e.operations.map((op, i) => (
              <div key={i} className="flex items-center justify-between rounded border bg-background px-2 py-1 text-xs">
                <span>{op.name}</span>
                <span className="text-muted-foreground">{op.machine_minutes} min stroj · {op.setup_minutes} min seřízení</span>
              </div>
            ))}
          </div>
        </div>
      )}
      {e.reasoning && <p className="text-xs text-muted-foreground">{e.reasoning}</p>}
      {e.needs_clarification.length > 0 && (
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="text-xs font-medium text-warning">K doplnění:</span>
          {e.needs_clarification.map((n, i) => <Badge key={i} variant="warning">{n}</Badge>)}
        </div>
      )}
      <div className="border-t pt-2">
        <CorrectionButton agentKey="pricing" field="price" context={context} aiValue={`cena/ks ${e.unit_price} Kč, marže ${e.margin_percent} %, lhůta ${e.lead_time_days} d`} label="Cena/výpočet špatně? Oprav (AI se naučí)" multiline />
      </div>
    </div>
  );
}

function QuoteView({ q }: { q: Quote }) {
  const total = q.items.reduce((s, it) => s + it.quantity * it.unit_price * (1 + it.vat_rate / 100), 0);
  return (
    <div className="space-y-3 rounded-lg border border-primary/30 bg-primary/5 p-4">
      <div className="text-sm font-semibold">Návrh nabídky (AI)</div>
      <div className="space-y-1">
        {q.items.map((it, i) => (
          <div key={i} className="flex items-center justify-between rounded border bg-background px-2 py-1.5 text-sm">
            <span className="flex-1 truncate">{it.description}</span>
            <span className="px-2 text-muted-foreground">{it.quantity} {it.unit}</span>
            <span className="font-medium">{formatCZK(it.unit_price)}/{it.unit}</span>
          </div>
        ))}
      </div>
      <div className="flex items-center justify-between text-sm">
        <span className="text-muted-foreground">Lhůta {q.lead_time_days} dní · platnost {q.valid_until_days} dní</span>
        <span className="font-semibold text-primary">Celkem s DPH {formatCZK(total)}</span>
      </div>
      {q.cover_email && (
        <div className="rounded border bg-background p-3 text-xs leading-relaxed text-muted-foreground whitespace-pre-wrap">{q.cover_email}</div>
      )}
    </div>
  );
}

function SubmitBar({ quote, customer }: { quote: Quote; customer: string }) {
  const [email, setEmail] = React.useState("");
  const [busy, setBusy] = React.useState<"" | "save" | "send">("");
  const [result, setResult] = React.useState<SubmitQuoteResult | null>(null);

  const submit = async (autoSend: boolean) => {
    setBusy(autoSend ? "send" : "save");
    setResult(null);
    const res = await submitAiQuote({
      customer, customerEmail: email || undefined, items: quote.items,
      coverEmail: quote.cover_email, leadTimeDays: quote.lead_time_days, validUntilDays: quote.valid_until_days, autoSend,
    });
    setResult(res); setBusy("");
  };

  return (
    <div className="space-y-2 rounded-lg border p-3">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
        <Input value={email} onChange={(e) => setEmail(e.target.value)} placeholder="E-mail zákazníka (pro odeslání)" type="email" className="sm:max-w-xs" />
        <div className="flex gap-2">
          <Button size="sm" onClick={() => submit(false)} disabled={busy !== ""}>
            {busy === "save" ? <Loader2 className="h-4 w-4 animate-spin" /> : null} Uložit &amp; zařadit ke schválení
          </Button>
          <Button size="sm" variant="outline" onClick={() => submit(true)} disabled={busy !== "" || !email}>
            {busy === "send" ? <Loader2 className="h-4 w-4 animate-spin" /> : null} Odeslat zákazníkovi
          </Button>
        </div>
      </div>
      {result && (
        <p className={result.ok ? "text-sm text-success" : "text-sm text-destructive"}>
          {result.ok
            ? `Nabídka ${result.number} uložena${result.archived ? " a archivována (PDF)" : ""}` + (result.sent ? " a odeslána." : result.sentReason ? ` · odeslání: ${result.sentReason}` : ".")
            : result.error}
        </p>
      )}
    </div>
  );
}

function Info({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-[11px] text-muted-foreground">{label}</div>
      <div className="text-sm font-medium">{value}</div>
    </div>
  );
}

function Stat({ label, value, accent }: { label: string; value: string; accent?: boolean }) {
  return (
    <div className="rounded-lg bg-background p-2">
      <div className="text-[11px] text-muted-foreground">{label}</div>
      <div className={accent ? "text-sm font-semibold text-primary" : "text-sm font-medium"}>{value}</div>
    </div>
  );
}
