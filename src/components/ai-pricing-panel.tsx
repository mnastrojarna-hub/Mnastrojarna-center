"use client";

import * as React from "react";
import {
  Sparkles, Loader2, Calculator, FileText, AlertCircle, Upload, History,
  Box, Timer, TrendingUp, ShieldCheck, Check,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { AiConfidence } from "@/components/ai-confidence";
import { CorrectionButton } from "@/components/correction-button";
import { submitAiQuote, type SubmitQuoteResult } from "@/app/actions/ai-quote";
import { submitPricingFeedback } from "@/app/actions/pricing";
import { STRATEGY_LABEL } from "@/lib/pricing/strategy";
import { LEAD_MODE_LABEL } from "@/lib/pricing/lead-time";
import { formatCZK } from "@/lib/utils";

interface Tol { t005: number; t01: number; t04: number; t1: number }
interface Extracted {
  part_name: string; part_type: string; order_type: string;
  drawing_number: string; revision: string; material: string;
  blank_dimensions: string; blank_weight_kg: number; finished_weight_kg: number; removed_weight_kg: number;
  surface_treatment: string; heat_treatment: string;
  surface_qualities: string[]; machining_technologies: string[];
  tolerances_before_ht: Tol; tolerances_after_ht: Tol;
  geom_tolerance_count: number; thread_count: number; hole_count: number; pocket_count: number;
  quantity: number; customer: string; requirements: string; summary: string;
  confidence: number; needs_clarification: string[];
}
interface Operation {
  name: string; machine: string;
  machine_minutes: number; setup_minutes: number; programming_minutes: number;
  first_piece_minutes: number; inspection_minutes: number;
  cost_per_piece: number; cooperation: boolean;
}
interface Estimate {
  material: string;
  blank_type: string; blank_dimensions: string;
  blank_weight_kg: number; part_weight_kg: number; removed_weight_kg: number;
  material_utilization_percent: number;
  material_cost_per_piece: number; material_surcharge_note: string;
  operations: Operation[];
  complexity_coefficient: number; scrap_risk_percent: number;
  time_per_piece_min: number; time_total_min: number;
  handling_minutes: number; transport_cost: number;
  surface_treatment_cost: number; heat_treatment_cost: number; cooperation_cost_per_piece: number;
  labor_rate_per_hour: number; production_cost_per_piece: number;
  margin_percent: number; strategy_level: number;
  unit_price: number; total_price: number;
  lead_time_days: number; lead_time_mode: "expres" | "rychly" | "standard" | "dlouhy";
  expedite_surcharge_percent: number;
  historical_used: boolean; historical_note: string; price_stability_note: string;
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
  const [features, setFeatures] = React.useState({ threads: "", holes: "", pockets: "", geomTol: "" });
  const [strategy, setStrategy] = React.useState("5");
  const [leadMode, setLeadMode] = React.useState("");
  const [extracted, setExtracted] = React.useState<Extracted | null>(null);
  const [estimate, setEstimate] = React.useState<Estimate | null>(null);
  const [calcId, setCalcId] = React.useState<string | null>(null);
  const [historical, setHistorical] = React.useState<{ found: boolean; unitPrice?: number; note?: string } | null>(null);
  const [quote, setQuote] = React.useState<Quote | null>(null);
  const [loading, setLoading] = React.useState<"" | "price" | "quote" | "all">("");
  const [extracting, setExtracting] = React.useState(false);
  const [autoMsg, setAutoMsg] = React.useState<string | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const fileRef = React.useRef<HTMLInputElement>(null);

  const upd = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
    setForm((f) => ({ ...f, [k]: e.target.value }));
  const updF = (k: keyof typeof features) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setFeatures((f) => ({ ...f, [k]: e.target.value }));

  // Bohatá data z výkresu + parametry strategie do požadavku na ocenění
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
    threadCount: Number(features.threads) || extracted?.thread_count || 0,
    holeCount: Number(features.holes) || extracted?.hole_count || 0,
    pocketCount: Number(features.pockets) || extracted?.pocket_count || 0,
    geomToleranceCount: Number(features.geomTol) || extracted?.geom_tolerance_count || 0,
    strategyLevel: Number(strategy) || 5,
    leadMode: leadMode || undefined,
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
        setFeatures({
          threads: x.thread_count ? String(x.thread_count) : "",
          holes: x.hole_count ? String(x.hole_count) : "",
          pockets: x.pocket_count ? String(x.pocket_count) : "",
          geomTol: x.geom_tolerance_count ? String(x.geom_tolerance_count) : "",
        });
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
      else { setEstimate(data.estimate); setHistorical(data.historical ?? null); setCalcId(data.calculationId ?? null); }
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
      if (data.historical) setHistorical(data.historical);
      if (data.calculationId) setCalcId(data.calculationId);
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
          <Sparkles className="h-4 w-4 text-primary" /> AI Nacenění CNC výroby
        </CardTitle>
        <CardDescription>
          Nahraj výkres → AI vytáhne technologická data (polotovar, materiál, tolerance, prvky) a nacení v plném rozsahu:
          polotovar a využití materiálu, operace s časy, složitost, sériovost, strategie, termín i ochrana proti cenovým výkyvům.
          Všechny hodnoty lze korigovat — systém se z oprav učí.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          <Field label="Číslo výkresu"><Input value={form.drawingNumber} onChange={upd("drawingNumber")} placeholder="např. VK-1234" /></Field>
          <Field label="Materiál"><Input value={form.material} onChange={upd("material")} placeholder="např. 1.2379 / C45 / 1.4301" /></Field>
          <Field label="Rozměry polotovaru"><Input value={form.dimensions} onChange={upd("dimensions")} placeholder="⌀50 × 120 / 120 × 80 × 25 mm" /></Field>
          <Field label="Množství (ks)"><Input value={form.quantity} onChange={upd("quantity")} type="number" placeholder="50" /></Field>
          <Field label="Zákazník"><Input value={form.customer} onChange={upd("customer")} placeholder="Název firmy (načte cenový profil)" /></Field>
          <Field label="E-mail zákazníka (pro odeslání)"><Input value={form.customerEmail} onChange={upd("customerEmail")} type="email" placeholder="nepovinné" /></Field>
        </div>

        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          <Field label="Cenová strategie (1–10)">
            <select value={strategy} onChange={(e) => setStrategy(e.target.value)}
              className="h-9 w-full rounded-md border border-input bg-background px-2 text-sm">
              {Array.from({ length: 10 }, (_, i) => i + 1).map((l) => (
                <option key={l} value={l}>{l} — {STRATEGY_LABEL[l]}</option>
              ))}
            </select>
          </Field>
          <Field label="Požadovaný termín">
            <select value={leadMode} onChange={(e) => setLeadMode(e.target.value)}
              className="h-9 w-full rounded-md border border-input bg-background px-2 text-sm">
              <option value="">Automaticky (dle kalkulace)</option>
              {(["expres", "rychly", "standard", "dlouhy"] as const).map((m) => (
                <option key={m} value={m}>{LEAD_MODE_LABEL[m]}</option>
              ))}
            </select>
          </Field>
          <Field label="Prvky dílu (závity · otvory · kapsy · geom. tolerance)">
            <div className="flex gap-1.5">
              <Input value={features.threads} onChange={updF("threads")} type="number" placeholder="záv." title="Počet závitů" />
              <Input value={features.holes} onChange={updF("holes")} type="number" placeholder="otv." title="Počet otvorů" />
              <Input value={features.pockets} onChange={updF("pockets")} type="number" placeholder="kap." title="Počet kapes" />
              <Input value={features.geomTol} onChange={updF("geomTol")} type="number" placeholder="geo" title="Počet geometrických tolerancí" />
            </div>
          </Field>
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
            Naceň → nabídka → ulož &amp; zařaď{form.customerEmail ? " & odešli" : ""}
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
            Historie: díl se už naceňoval{historical.note ? ` (${historical.note})` : ""}{historical.unitPrice ? ` — poslední cena/ks ${formatCZK(historical.unitPrice)}` : ""}. Kalkulace z ní vychází (inflace + limit cenového skoku).
          </div>
        )}

        {estimate && (
          <EstimateView
            e={estimate}
            calcId={calcId}
            context={`Výkres ${form.drawingNumber}, ${form.material}, ${form.quantity} ks. ${form.requirements}`}
          />
        )}
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
        <Info label="Prvky dílu" value={`závity ${x.thread_count ?? 0} · otvory ${x.hole_count ?? 0} · kapsy ${x.pocket_count ?? 0} · geom. tol. ${x.geom_tolerance_count ?? 0}`} />
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

const LEAD_MODE_SHORT: Record<string, string> = {
  expres: "Expres", rychly: "Rychlý", standard: "Standard", dlouhy: "Dlouhý",
};

function EstimateView({ e, calcId, context }: { e: Estimate; calcId: string | null; context: string }) {
  return (
    <div className="space-y-4 rounded-lg border bg-muted/30 p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-2 text-sm font-semibold">
          Kalkulace technologa
          <Badge variant="secondary"><TrendingUp className="h-3 w-3" /> strategie {e.strategy_level}/10</Badge>
          {e.historical_used && <Badge variant="warning"><History className="h-3 w-3" /> dle historie</Badge>}
        </div>
        <AiConfidence value={e.confidence} />
      </div>

      {/* Hlavní čísla */}
      <div className="grid gap-2 sm:grid-cols-3">
        <Stat label="Nabídková cena / ks" value={formatCZK(e.unit_price)} accent />
        <Stat label="Celkem" value={formatCZK(e.total_price)} accent />
        <Stat label="Termín" value={`${e.lead_time_days} dní (${LEAD_MODE_SHORT[e.lead_time_mode] ?? e.lead_time_mode})${e.expedite_surcharge_percent ? ` · +${e.expedite_surcharge_percent} % expres` : ""}`} />
        <Stat label="Výrobní náklady / ks" value={formatCZK(e.production_cost_per_piece)} />
        <Stat label="Marže" value={`${e.margin_percent} %`} />
        <Stat label="Riziko zmetků" value={`${e.scrap_risk_percent} %`} />
      </div>

      {/* Polotovar a materiál */}
      <div className="rounded-lg border bg-background p-3">
        <div className="mb-2 flex items-center gap-1.5 text-xs font-semibold"><Box className="h-3.5 w-3.5 text-muted-foreground" /> Polotovar a materiál</div>
        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4 text-sm">
          <Info label="Polotovar" value={`${e.blank_type} ${e.blank_dimensions}`} />
          <Info label="Hmotnost polotovar / díl" value={`${e.blank_weight_kg} kg / ${e.part_weight_kg} kg`} />
          <Info label="Odpad · využití materiálu" value={`${e.removed_weight_kg} kg · ${e.material_utilization_percent} %`} />
          <Info label="Materiál / ks" value={`${formatCZK(e.material_cost_per_piece)}${e.material_surcharge_note ? ` (${e.material_surcharge_note})` : ""}`} />
        </div>
      </div>

      {/* Operace */}
      {e.operations.length > 0 && (
        <div className="rounded-lg border bg-background p-3">
          <div className="mb-2 flex items-center gap-1.5 text-xs font-semibold"><Timer className="h-3.5 w-3.5 text-muted-foreground" /> Operace a časy</div>
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="text-left text-muted-foreground">
                  <th className="py-1 pr-2 font-medium">Operace</th>
                  <th className="px-2 py-1 text-right font-medium">min/ks</th>
                  <th className="px-2 py-1 text-right font-medium">Seřízení</th>
                  <th className="px-2 py-1 text-right font-medium">Program.</th>
                  <th className="px-2 py-1 text-right font-medium">1. kus</th>
                  <th className="px-2 py-1 text-right font-medium">Kontrola/ks</th>
                  <th className="px-2 py-1 text-right font-medium">Kč/ks</th>
                </tr>
              </thead>
              <tbody>
                {e.operations.map((op, i) => (
                  <tr key={i} className="border-t">
                    <td className="py-1.5 pr-2">
                      {op.name}{op.cooperation && <Badge variant="outline" className="ml-1.5">kooperace</Badge>}
                    </td>
                    <td className="px-2 py-1.5 text-right">{op.cooperation ? "—" : op.machine_minutes}</td>
                    <td className="px-2 py-1.5 text-right">{op.cooperation ? "—" : `${op.setup_minutes} min`}</td>
                    <td className="px-2 py-1.5 text-right">{op.cooperation ? "—" : `${op.programming_minutes} min`}</td>
                    <td className="px-2 py-1.5 text-right">{op.cooperation ? "—" : `${op.first_piece_minutes} min`}</td>
                    <td className="px-2 py-1.5 text-right">{op.cooperation ? "—" : `${op.inspection_minutes} min`}</td>
                    <td className="px-2 py-1.5 text-right font-medium">{formatCZK(op.cost_per_piece)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="mt-2 grid gap-2 sm:grid-cols-3 text-sm">
            <Info label="Složitost dílu" value={`koeficient ×${e.complexity_coefficient}`} />
            <Info label="Čas / ks" value={`${e.time_per_piece_min} min`} />
            <Info label="Čas na zakázku" value={`${Math.round(e.time_total_min / 60 * 10) / 10} h`} />
          </div>
        </div>
      )}

      {/* Vedlejší náklady */}
      <div className="grid gap-2 sm:grid-cols-3">
        <Stat label="Povrch / tepelka / ks" value={`${formatCZK(e.surface_treatment_cost)} / ${formatCZK(e.heat_treatment_cost)}`} />
        <Stat label="Manipulace · doprava" value={`${e.handling_minutes} min · ${formatCZK(e.transport_cost)}`} />
        <Stat label="Kooperace / ks" value={formatCZK(e.cooperation_cost_per_piece)} />
      </div>

      {e.price_stability_note && (
        <div className="flex items-start gap-2 rounded-lg border border-warning/40 bg-warning/5 p-3 text-xs">
          <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-warning" />
          <span><span className="font-medium">Ochrana proti cenovým výkyvům:</span> {e.price_stability_note}</span>
        </div>
      )}

      {e.reasoning && (
        <details className="rounded-lg border bg-background p-3">
          <summary className="cursor-pointer text-xs font-semibold">Zdůvodnění kalkulace</summary>
          <p className="mt-2 whitespace-pre-wrap text-xs leading-relaxed text-muted-foreground">{e.reasoning}</p>
        </details>
      )}

      {e.needs_clarification.length > 0 && (
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="text-xs font-medium text-warning">K doplnění:</span>
          {e.needs_clarification.map((n, i) => <Badge key={i} variant="warning">{n}</Badge>)}
        </div>
      )}

      <PricingFeedback e={e} calcId={calcId} context={context} />
    </div>
  );
}

/** Korekce kalkulace: cena/termín/marže + poznámka → systém se učí. */
function PricingFeedback({ e, calcId, context }: { e: Estimate; calcId: string | null; context: string }) {
  const [open, setOpen] = React.useState(false);
  const [price, setPrice] = React.useState("");
  const [days, setDays] = React.useState("");
  const [margin, setMargin] = React.useState("");
  const [note, setNote] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const [done, setDone] = React.useState(false);
  const [err, setErr] = React.useState<string | null>(null);

  if (done) {
    return (
      <div className="flex items-center gap-1.5 border-t pt-2 text-xs text-success">
        <Check className="h-3.5 w-3.5" /> Korekce uložena — promítne se do dalších kalkulací.
      </div>
    );
  }

  if (!open) {
    return (
      <div className="border-t pt-2">
        <button onClick={() => setOpen(true)} className="text-xs text-muted-foreground hover:text-primary">
          ✎ Cena, termín nebo marže jinak? Oprav a ulož pro příště (AI se naučí)
        </button>
      </div>
    );
  }

  const save = async () => {
    setBusy(true); setErr(null);
    const res = await submitPricingFeedback({
      calculationId: calcId,
      context,
      aiUnitPrice: e.unit_price,
      aiLeadTimeDays: e.lead_time_days,
      aiMarginPercent: e.margin_percent,
      userUnitPrice: price ? Number(price) : undefined,
      userLeadTimeDays: days ? Number(days) : undefined,
      userMarginPercent: margin ? Number(margin) : undefined,
      note: note.trim() || undefined,
    });
    setBusy(false);
    if (res.ok) setDone(true);
    else setErr(res.error ?? "Chyba ukládání korekce.");
  };

  return (
    <div className="space-y-2 rounded-lg border border-primary/30 bg-primary/5 p-3">
      <div className="text-xs font-medium">Korekce kalkulace — uloží se k dílu i jako pravidlo pro AI</div>
      <div className="grid gap-2 sm:grid-cols-3">
        <Field label={`Cena / ks (AI: ${formatCZK(e.unit_price)})`}>
          <Input value={price} onChange={(ev) => setPrice(ev.target.value)} type="number" placeholder="správná cena" />
        </Field>
        <Field label={`Termín dní (AI: ${e.lead_time_days})`}>
          <Input value={days} onChange={(ev) => setDays(ev.target.value)} type="number" placeholder="správný termín" />
        </Field>
        <Field label={`Marže % (AI: ${e.margin_percent})`}>
          <Input value={margin} onChange={(ev) => setMargin(ev.target.value)} type="number" placeholder="správná marže" />
        </Field>
      </div>
      <Input value={note} onChange={(ev) => setNote(ev.target.value)} placeholder="Důvod / pravidlo k zapamatování (např. drátovka u nás 750 Kč/h)" />
      {err && <p className="text-xs text-destructive">{err}</p>}
      <div className="flex gap-2">
        <Button size="sm" onClick={save} disabled={busy}>
          {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : null} Uložit korekci
        </Button>
        <Button size="sm" variant="ghost" onClick={() => setOpen(false)}>Zrušit</Button>
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
