"use client";

import * as React from "react";
import { Sparkles, Loader2, Calculator, FileText, AlertCircle, Upload } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { AiConfidence } from "@/components/ai-confidence";
import { submitAiQuote, type SubmitQuoteResult } from "@/app/actions/ai-quote";
import { formatCZK } from "@/lib/utils";

interface Estimate {
  material: string;
  operations: { name: string; machine_minutes: number; setup_minutes: number }[];
  material_cost_per_piece: number;
  cooperation_cost_per_piece: number;
  labor_rate_per_hour: number;
  margin_percent: number;
  unit_price: number;
  total_price: number;
  lead_time_days: number;
  confidence: number;
  reasoning: string;
  needs_clarification: string[];
}
interface Quote {
  items: { description: string; quantity: number; unit: string; unit_price: number; vat_rate: number }[];
  lead_time_days: number;
  valid_until_days: number;
  cover_email: string;
  note: string;
}

export function AiPricingPanel() {
  const [form, setForm] = React.useState({
    drawingNumber: "VK-2291",
    material: "1.2379",
    dimensions: "120 × 80 × 25 mm",
    quantity: "50",
    customer: "Strojmetal a.s.",
    customerEmail: "",
    requirements: "Tolerance H7, kalení 58-60 HRC, povrch Ra 0,8",
  });
  const [estimate, setEstimate] = React.useState<Estimate | null>(null);
  const [quote, setQuote] = React.useState<Quote | null>(null);
  const [loading, setLoading] = React.useState<"" | "price" | "quote" | "all">("");
  const [extracting, setExtracting] = React.useState(false);
  const [extractMsg, setExtractMsg] = React.useState<string | null>(null);
  const [autoMsg, setAutoMsg] = React.useState<string | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const fileRef = React.useRef<HTMLInputElement>(null);

  const processAll = async () => {
    setLoading("all"); setError(null); setAutoMsg(null); setQuote(null);
    try {
      const res = await fetch("/api/ai/process-inquiry", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...form, quantity: Number(form.quantity), autoSend: !!form.customerEmail }),
      });
      const data = await res.json();
      if (data.error) { setError(data.error); return; }
      if (data.estimate) setEstimate(data.estimate);
      if (data.quote) setQuote(data.quote);
      const r = data.result;
      if (r?.ok) {
        setAutoMsg(
          `Nabídka ${r.number} naceněna, vygenerována${r.archived ? ", archivována (PDF)" : ""} a ` +
          (r.sent ? "odeslána zákazníkovi." : "zařazena ke schválení.") + (r.sentReason ? ` (${r.sentReason})` : ""),
        );
      } else if (r?.error) {
        setAutoMsg(`Naceněno a vytvořeno, ale uložení: ${r.error}`);
      } else {
        setAutoMsg("Naceněno a vytvořena nabídka (uložení vyžaduje Supabase servisní klíč).");
      }
    } catch { setError("Nepodařilo se zpracovat."); }
    finally { setLoading(""); }
  };

  const onFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setExtracting(true); setExtractMsg(null); setError(null);
    try {
      const fd = new FormData();
      fd.append("file", file);
      const res = await fetch("/api/ai/extract", { method: "POST", body: fd });
      const data = await res.json();
      if (data.error) { setError(data.error); }
      else {
        const x = data.extracted;
        setForm((f) => ({
          ...f,
          drawingNumber: x.drawing_number || f.drawingNumber,
          material: x.material || f.material,
          dimensions: x.dimensions || f.dimensions,
          quantity: x.quantity ? String(x.quantity) : f.quantity,
          customer: x.customer || f.customer,
          requirements: x.requirements || f.requirements,
        }));
        setExtractMsg(`Přečteno z přílohy (${Math.round((x.confidence ?? 0) * 100)} % jistota). Zkontroluj a naceň.`);
      }
    } catch { setError("Nepodařilo se přečíst přílohu."); }
    finally { setExtracting(false); if (fileRef.current) fileRef.current.value = ""; }
  };

  const upd = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
    setForm((f) => ({ ...f, [k]: e.target.value }));

  const price = async () => {
    setLoading("price"); setError(null); setQuote(null);
    try {
      const res = await fetch("/api/ai/price", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...form, quantity: Number(form.quantity) }),
      });
      const data = await res.json();
      if (data.error) setError(data.error); else setEstimate(data.estimate);
    } catch { setError("Nepodařilo se spojit s AI."); }
    finally { setLoading(""); }
  };

  const makeQuote = async () => {
    setLoading("quote"); setError(null);
    try {
      const inquiry = `Výkres ${form.drawingNumber}, materiál ${form.material}, ${form.dimensions}, ${form.quantity} ks. ${form.requirements}`;
      const res = await fetch("/api/ai/quote", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...form, inquiry, withPricing: !estimate, quantity: Number(form.quantity) }),
      });
      const data = await res.json();
      if (data.error) setError(data.error);
      else { setQuote(data.quote); if (data.estimate) setEstimate(data.estimate); }
    } catch { setError("Nepodařilo se spojit s AI."); }
    finally { setLoading(""); }
  };

  return (
    <Card className="border-primary/30">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <Sparkles className="h-4 w-4 text-primary" /> AI ocenění dle výkresu (jako technolog)
        </CardTitle>
        <CardDescription>
          AI ocení díl jako kalkulant — materiál, operace, časy, marže → cena. Pak z toho vytvoří nabídku.
          Chování laď v Nastavení → Pravidla AI agentů (vždy/nikdy).
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          <Field label="Číslo výkresu"><Input value={form.drawingNumber} onChange={upd("drawingNumber")} /></Field>
          <Field label="Materiál"><Input value={form.material} onChange={upd("material")} /></Field>
          <Field label="Rozměry"><Input value={form.dimensions} onChange={upd("dimensions")} /></Field>
          <Field label="Množství (ks)"><Input value={form.quantity} onChange={upd("quantity")} type="number" /></Field>
          <Field label="Zákazník"><Input value={form.customer} onChange={upd("customer")} /></Field>
          <Field label="E-mail zákazníka (pro odeslání)"><Input value={form.customerEmail} onChange={upd("customerEmail")} type="email" placeholder="nepovinné" /></Field>
        </div>
        <Field label="Specifické požadavky">
          <Textarea value={form.requirements} onChange={upd("requirements")} className="min-h-[60px]" />
        </Field>

        <div className="flex flex-wrap items-center gap-2">
          <input
            ref={fileRef}
            type="file"
            accept="application/pdf,image/png,image/jpeg,image/webp"
            onChange={onFile}
            className="hidden"
          />
          <Button variant="secondary" onClick={() => fileRef.current?.click()} disabled={extracting}>
            {extracting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}
            Načíst z přílohy (PDF/výkres)
          </Button>
          {extractMsg && <span className="text-xs text-success">{extractMsg}</span>}
        </div>

        <div className="rounded-lg border border-primary/40 bg-primary/5 p-3">
          <div className="mb-2 text-sm font-medium">AI od A do Z jedním klikem</div>
          <Button onClick={processAll} disabled={loading !== ""}>
            {loading === "all" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
            Naceň → vytvoř nabídku → ulož &amp; zařaď ke schválení{form.customerEmail ? " &amp; odešli" : ""}
          </Button>
          {autoMsg && <p className="mt-2 text-sm text-success">{autoMsg}</p>}
        </div>

        <div className="flex flex-wrap gap-2">
          <Button variant="outline" onClick={price} disabled={loading !== ""}>
            {loading === "price" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Calculator className="h-4 w-4" />}
            Naceň jako technolog
          </Button>
          <Button variant="outline" onClick={makeQuote} disabled={loading !== ""}>
            {loading === "quote" ? <Loader2 className="h-4 w-4 animate-spin" /> : <FileText className="h-4 w-4" />}
            Vygenerovat nabídku
          </Button>
        </div>

        {error && (
          <div className="flex items-start gap-2 rounded-lg bg-destructive/10 p-3 text-sm text-destructive">
            <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" /> {error}
          </div>
        )}

        {estimate && <EstimateView e={estimate} />}
        {quote && <QuoteView q={quote} />}
        {quote && <SubmitBar quote={quote} customer={form.customer} />}
      </CardContent>
    </Card>
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
      customer,
      customerEmail: email || undefined,
      items: quote.items,
      coverEmail: quote.cover_email,
      leadTimeDays: quote.lead_time_days,
      validUntilDays: quote.valid_until_days,
      autoSend,
    });
    setResult(res);
    setBusy("");
  };

  return (
    <div className="space-y-2 rounded-lg border p-3">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
        <Input
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="E-mail zákazníka (pro odeslání)"
          type="email"
          className="sm:max-w-xs"
        />
        <div className="flex gap-2">
          <Button size="sm" onClick={() => submit(false)} disabled={busy !== ""}>
            {busy === "save" ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
            Uložit & zařadit ke schválení
          </Button>
          <Button size="sm" variant="outline" onClick={() => submit(true)} disabled={busy !== "" || !email}>
            {busy === "send" ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
            Odeslat zákazníkovi
          </Button>
        </div>
      </div>
      {result && (
        <p className={result.ok ? "text-sm text-success" : "text-sm text-destructive"}>
          {result.ok
            ? `Nabídka ${result.number} uložena${result.archived ? " a archivována (PDF)" : ""}` +
              (result.sent ? " a odeslána zákazníkovi." : result.sentReason ? ` · odeslání: ${result.sentReason}` : ".")
            : result.error}
        </p>
      )}
    </div>
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

function EstimateView({ e }: { e: Estimate }) {
  return (
    <div className="space-y-3 rounded-lg border bg-muted/30 p-4">
      <div className="flex items-center justify-between">
        <div className="text-sm font-semibold">Kalkulace technologa</div>
        <AiConfidence value={e.confidence} />
      </div>
      <div className="grid gap-2 sm:grid-cols-3">
        <Stat label="Cena / ks" value={formatCZK(e.unit_price)} accent />
        <Stat label="Celkem" value={formatCZK(e.total_price)} accent />
        <Stat label="Dodací lhůta" value={`${e.lead_time_days} dní`} />
        <Stat label="Materiál" value={e.material} />
        <Stat label="Materiál / ks" value={formatCZK(e.material_cost_per_piece)} />
        <Stat label="Kooperace / ks" value={formatCZK(e.cooperation_cost_per_piece)} />
        <Stat label="Sazba práce" value={`${formatCZK(e.labor_rate_per_hour)}/h`} />
        <Stat label="Marže" value={`${e.margin_percent} %`} />
      </div>
      {e.operations.length > 0 && (
        <div>
          <div className="mb-1 text-xs font-medium text-muted-foreground">Operace</div>
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
        <div className="rounded border bg-background p-3 text-xs leading-relaxed text-muted-foreground whitespace-pre-wrap">
          {q.cover_email}
        </div>
      )}
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
