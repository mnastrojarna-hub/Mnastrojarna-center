import "server-only";
import Anthropic from "@anthropic-ai/sdk";
import type { EmailCategory, PriorityLevel } from "@/lib/supabase/database.types";
import { getAiConfig } from "@/lib/settings";
import type {
  CustomerPricingProfile, HistoricalPrice, PriceBreakdown,
  PricingParams as PricingParamsV2,
} from "@/lib/pricing/types";
import {
  breakdownToEstimate, breakdownPromptSummary,
  type PriceEstimateV2, type PriceOperationV2,
} from "@/lib/pricing/convert";

/**
 * AI vrstva nad Claude API (Anthropic). Klíč a model se berou z nastavení
 * (DB integration_settings → fallback na ANTHROPIC_API_KEY v env).
 * Bez klíče funkce vrací bezpečný fallback, aby appka běžela i bez AI.
 */

export async function isAiConfigured() {
  return Boolean((await getAiConfig()).apiKey);
}

function textOf(message: Anthropic.Message): string {
  return message.content
    .filter((b): b is Anthropic.TextBlock => b.type === "text")
    .map((b) => b.text)
    .join("");
}

// ── Kategorizace e-mailu ────────────────────────────────────
export interface EmailAnalysis {
  category: EmailCategory;
  priority: PriorityLevel;
  importance: number; // 0–100
  is_spam: boolean;
  summary: string;
  confidence: number; // 0–1
}

const CATEGORY_ENUM: EmailCategory[] = [
  "poptavka", "objednavka", "nabidka_dodavatele", "potvrzeni_objednavky",
  "faktura", "upominka", "reklamace", "technicka_dokumentace", "spam", "ostatni",
];

export async function categorizeEmail(input: {
  from: string;
  subject: string;
  body: string;
  rules?: string; // firemní pravidla (VŽDY/NIKDY/pokyny) z ai_agent_rules
}): Promise<EmailAnalysis> {
  const { apiKey, model } = await getAiConfig();
  if (!apiKey) {
    return {
      category: "ostatni",
      priority: "stredni",
      importance: 50,
      is_spam: false,
      summary: "AI není nakonfigurováno (doplň Claude API klíč v Nastavení).",
      confidence: 0,
    };
  }

  const schema = {
    type: "object",
    additionalProperties: false,
    properties: {
      category: { type: "string", enum: CATEGORY_ENUM },
      priority: { type: "string", enum: ["nizka", "stredni", "vysoka"] },
      importance: { type: "integer" },
      is_spam: { type: "boolean" },
      summary: { type: "string" },
      confidence: { type: "number" },
    },
    required: ["category", "priority", "importance", "is_spam", "summary", "confidence"],
  };

  const message = await new Anthropic({ apiKey }).messages.create({
    model,
    max_tokens: 1024,
    output_config: {
      effort: "low",
      format: { type: "json_schema", schema },
    },
    system:
      "Jsi asistent nástrojárny Mnástrojárna. Klasifikuj příchozí e-mail do jedné z kategorií " +
      "a urči prioritu, důležitost (0–100), zda jde o spam, krátké shrnutí česky a confidence (0–1). " +
      "Kategorie: poptavka, objednavka, nabidka_dodavatele, potvrzeni_objednavky, faktura, upominka, " +
      "reklamace, technicka_dokumentace, spam, ostatni." +
      (input.rules ? `\n\n${input.rules}` : ""),
    messages: [
      {
        role: "user",
        content: `Od: ${input.from}\nPředmět: ${input.subject}\n\n${input.body}`,
      },
    ],
  });

  return JSON.parse(textOf(message)) as EmailAnalysis;
}

// ── Návrh odpovědi na e-mail ────────────────────────────────
export async function draftReply(input: {
  from: string;
  subject: string;
  body: string;
  category?: string;
  rules?: string;
}): Promise<string> {
  const { apiKey, model } = await getAiConfig();
  if (!apiKey) {
    return "Dobrý den,\n\nděkujeme za Vaši zprávu. (Návrh vygeneruje AI po doplnění Claude API klíče v Nastavení.)\n\nS pozdravem,\nMNástrojárna s.r.o.";
  }

  const message = await new Anthropic({ apiKey }).messages.create({
    model,
    max_tokens: 1500,
    output_config: { effort: "medium" },
    system:
      "Jsi obchodní asistent firmy Mnástrojárna s.r.o. (nástrojárna). Napiš zdvořilou, věcnou " +
      "odpověď v češtině na příchozí e-mail. Bez vymýšlení cen a termínů — pokud chybí, napiš, že " +
      "je doplníme. Podpis: 'S pozdravem, Mnástrojárna s.r.o.'. Vrať pouze tělo e-mailu." +
      (input.rules ? `\n\n${input.rules}` : ""),
    messages: [
      {
        role: "user",
        content: `Kategorie: ${input.category ?? "neznámá"}\nOd: ${input.from}\nPředmět: ${input.subject}\n\n${input.body}`,
      },
    ],
  });

  return textOf(message).trim();
}

// ── Firemní AI asistent (Q&A) ───────────────────────────────
export async function askAssistant(input: {
  question: string;
  context?: string;
}): Promise<string> {
  const { apiKey, model } = await getAiConfig();
  if (!apiKey) {
    return "AI asistent zatím není aktivní — doplň Claude API klíč v Nastavení → Integrace. Po nastavení odpovím nad tvými daty (RAG: nabídky, objednávky, výkresy).";
  }

  const message = await new Anthropic({ apiKey }).messages.create({
    model,
    max_tokens: 2000,
    thinking: { type: "adaptive" },
    output_config: { effort: "medium" },
    system:
      "Jsi firemní AI asistent nástrojárny Mnástrojárna s.r.o. Odpovídáš česky, stručně a konkrétně " +
      "na dotazy o zákaznících, nabídkách, objednávkách, výkresech, dodavatelích a provizích. " +
      "Pokud nemáš data, řekni to a navrhni, kde je v systému najít.",
    messages: [
      {
        role: "user",
        content: input.context
          ? `Kontext z databáze:\n${input.context}\n\nDotaz: ${input.question}`
          : input.question,
      },
    ],
  });

  return textOf(message).trim();
}

// ── Oceňování dle výkresu (jako technolog) — Nacenění v2 ────
// AI dostane deterministickou BASELINE kalkulaci a rafinuje ji.
// Výstup má jednotný tvar PriceEstimateV2 (sdílený s kalkulačním jádrem).
export type PriceEstimate = PriceEstimateV2;
export type PriceOperation = PriceOperationV2;

export async function priceDrawing(input: {
  drawingNumber?: string;
  partType?: string;
  orderType?: string;
  material?: string;
  blankDimensions?: string;
  blankWeightKg?: number;
  finishedWeightKg?: number;
  surfaceTreatment?: string;
  heatTreatment?: string;
  surfaceQualities?: string[];
  machiningTechnologies?: string[];
  tolerancesBeforeHt?: Record<string, number>;
  tolerancesAfterHt?: Record<string, number>;
  geomToleranceCount?: number;
  threadCount?: number;
  holeCount?: number;
  pocketCount?: number;
  quantity: number;
  customer?: string;
  customerProfile?: CustomerPricingProfile | null;
  requirements?: string;
  drawingText?: string;
  params: PricingParamsV2;
  baseline: PriceBreakdown;
  history?: HistoricalPrice[];
  rules?: string;
}): Promise<PriceEstimate> {
  const { apiKey, model } = await getAiConfig();
  if (!apiKey) {
    // Bez AI klíče naceňuje deterministické jádro — systém zůstává funkční.
    const est = breakdownToEstimate(input.baseline);
    est.reasoning = "Naceněno deterministickým kalkulačním jádrem (AI klíč není nastaven — doplň v Nastavení → Integrace pro rafinaci AI).\n\n" + est.reasoning;
    return est;
  }

  const numProp = { type: "number" };
  const opSchema = {
    type: "object",
    additionalProperties: false,
    properties: {
      name: { type: "string" },
      machine: { type: "string" },
      machine_minutes: numProp,
      setup_minutes: numProp,
      programming_minutes: numProp,
      first_piece_minutes: numProp,
      inspection_minutes: numProp,
      cost_per_piece: numProp,
      cooperation: { type: "boolean" },
    },
    required: ["name", "machine", "machine_minutes", "setup_minutes", "programming_minutes", "first_piece_minutes", "inspection_minutes", "cost_per_piece", "cooperation"],
  };
  const schema = {
    type: "object",
    additionalProperties: false,
    properties: {
      material: { type: "string" },
      blank_type: { type: "string" },
      blank_dimensions: { type: "string" },
      blank_weight_kg: numProp,
      part_weight_kg: numProp,
      removed_weight_kg: numProp,
      material_utilization_percent: numProp,
      material_cost_per_piece: numProp,
      material_surcharge_note: { type: "string" },
      operations: { type: "array", items: opSchema },
      complexity_coefficient: numProp,
      scrap_risk_percent: numProp,
      time_per_piece_min: numProp,
      time_total_min: numProp,
      handling_minutes: numProp,
      transport_cost: numProp,
      surface_treatment_cost: numProp,
      heat_treatment_cost: numProp,
      cooperation_cost_per_piece: numProp,
      labor_rate_per_hour: numProp,
      production_cost_per_piece: numProp,
      margin_percent: numProp,
      strategy_level: { type: "integer" },
      unit_price: numProp,
      total_price: numProp,
      lead_time_days: { type: "integer" },
      lead_time_mode: { type: "string", enum: ["expres", "rychly", "standard", "dlouhy"] },
      expedite_surcharge_percent: numProp,
      historical_used: { type: "boolean" },
      historical_note: { type: "string" },
      price_stability_note: { type: "string" },
      confidence: numProp,
      reasoning: { type: "string" },
      needs_clarification: { type: "array", items: { type: "string" } },
    },
    required: [
      "material", "blank_type", "blank_dimensions", "blank_weight_kg", "part_weight_kg", "removed_weight_kg",
      "material_utilization_percent", "material_cost_per_piece", "material_surcharge_note", "operations",
      "complexity_coefficient", "scrap_risk_percent", "time_per_piece_min", "time_total_min",
      "handling_minutes", "transport_cost", "surface_treatment_cost", "heat_treatment_cost",
      "cooperation_cost_per_piece", "labor_rate_per_hour", "production_cost_per_piece",
      "margin_percent", "strategy_level", "unit_price", "total_price",
      "lead_time_days", "lead_time_mode", "expedite_surcharge_percent",
      "historical_used", "historical_note", "price_stability_note",
      "confidence", "reasoning", "needs_clarification",
    ],
  };

  const p = input.params;
  const paramLines =
    `PARAMETRY: stroj ${p.hourlyRate} Kč/h, manipulace ${p.handlingRate} Kč/h, programování ${p.programmingRate} Kč/h, ` +
    `seřizování ${p.setupRate} Kč/h, kontrola ${p.inspectionRate} Kč/h, výchozí marže ${p.marginPercent} %, ` +
    `inflace ${p.inflationPercent} %/rok, doprava ${p.transportDefault} Kč, doprava materiálu ${p.materialTransport} Kč, ` +
    `strategie ${p.strategyLevel}/10, vytížení výroby ${p.utilizationPercent} %, max. cenový skok vs. historie ±${p.maxPriceStepPct} %, ` +
    `přirážky: expres +${p.expressSurchargePct} %, rychlý termín +${p.fastSurchargePct} %, země výroby ${p.countryCode}.`;

  const hist = input.history?.length
    ? "HISTORIE DÍLU (nejnovější první — vyjdi z ní + inflace, drž cenový skok v limitu, historical_used=true):\n" +
      input.history.map((h) => `  - ${h.unitPrice} Kč/ks (${new Date(h.date).toLocaleDateString("cs-CZ")}${h.note ? `, ${h.note}` : ""})`).join("\n")
    : "HISTORIE: díl se dle dostupných dat dříve nevyráběl.";

  const cp = input.customerProfile;
  const customerLines = cp
    ? `ZÁKAZNICKÝ PROFIL: ${cp.name ?? input.customer ?? "—"} · individuální marže ${cp.marginPercent ?? "—"} % · ` +
      `cenová hladina ${cp.priceLevel ?? "standard"} · priorita ${cp.businessPriority ?? "—"} · ` +
      `platební morálka ${cp.paymentMorale ?? "—"} · riziko ${cp.riskLevel ?? "—"} · ` +
      `roční obrat ${cp.annualRevenueCzk ?? "—"} Kč · opakovaný zákazník: ${cp.repeatCustomer ? "ano" : "ne"}`
    : `ZÁKAZNÍK: ${input.customer ?? "—"} (bez cenového profilu v CRM)`;

  const message = await new Anthropic({ apiKey }).messages.create({
    model,
    max_tokens: 6000,
    thinking: { type: "adaptive" },
    output_config: { effort: "high", format: { type: "json_schema", schema } },
    system:
      "Jsi špičkový technolog a kalkulant CNC nástrojárny Mnástrojárna. Dostaneš data výkresu, parametry, zákaznický profil, " +
      "historii dílu a BASELINE deterministické kalkulace. Vyjdi z baseline a uprav ji tam, kde tvá technologická expertíza říká jinak " +
      "(každou odchylku zdůvodni v reasoning). Pokrýváš celý rozsah: návrh polotovaru (typ, rozměr s přídavky, hmotnost, odpad, využití), " +
      "materiálové náklady s přirážkami, technologické operace s časy (seřízení, programování, 1. kus, série/ks, kontrola), " +
      "koeficient složitosti a riziko zmetkovitosti, sériovost (amortizace fixů), cenovou strategii 1–10 a zákaznický profil, " +
      "termín dodání (expres/rychlý/standard/dlouhý + přirážka za zkrácení) a stabilitu ceny vůči historii (žádné skoky nad limit). " +
      "Ceny v CZK. Buď realistický; u nejistot sniž confidence a doplň needs_clarification. " +
      "reasoning piš česky, strukturovaně po krocích kalkulace." +
      (input.rules ? `\n\n${input.rules}` : ""),
    messages: [
      {
        role: "user",
        content:
          `Výkres: ${input.drawingNumber ?? "—"}\nTyp dílu: ${input.partType ?? "?"}\nTyp zakázky: ${input.orderType ?? "?"}\n` +
          `Materiál: ${input.material ?? "neuvedeno"}\nPolotovar (zadání): ${input.blankDimensions ?? "?"} (váha ${input.blankWeightKg ?? "?"} kg)\n` +
          `Váha hotového dílu: ${input.finishedWeightKg ?? "?"} kg\nPovrchová úprava: ${input.surfaceTreatment ?? "—"}\nTepelná úprava: ${input.heatTreatment ?? "—"}\n` +
          `Jakosti povrchů: ${(input.surfaceQualities ?? []).join(", ") || "—"}\nTechnologie: ${(input.machiningTechnologies ?? []).join(", ") || "—"}\n` +
          `Tolerance před tepelkou: ${JSON.stringify(input.tolerancesBeforeHt ?? {})}\nTolerance po tepelce: ${JSON.stringify(input.tolerancesAfterHt ?? {})}\n` +
          `Geometrické tolerance: ${input.geomToleranceCount ?? 0} · Závity: ${input.threadCount ?? 0} · Otvory: ${input.holeCount ?? 0} · Kapsy: ${input.pocketCount ?? 0}\n` +
          `Množství: ${input.quantity} ks\nPožadavky: ${input.requirements ?? "—"}\n\n` +
          `${customerLines}\n\n${paramLines}\n\n${hist}\n\n${breakdownPromptSummary(input.baseline)}\n\n${input.drawingText ?? ""}`,
      },
    ],
  });

  return JSON.parse(textOf(message)) as PriceEstimate;
}

// ── Generování nabídky z poptávky ───────────────────────────
export interface GeneratedQuote {
  items: { description: string; quantity: number; unit: string; unit_price: number; vat_rate: number }[];
  lead_time_days: number;
  valid_until_days: number;
  cover_email: string;
  note: string;
}

export async function generateQuote(input: {
  customer: string;
  inquiry: string;
  estimate?: PriceEstimate;
  rules?: string;
}): Promise<GeneratedQuote> {
  const { apiKey, model } = await getAiConfig();
  if (!apiKey) {
    return {
      items: [],
      lead_time_days: 0,
      valid_until_days: 30,
      cover_email: "Nabídku vygeneruje AI po doplnění Claude API klíče v Nastavení.",
      note: "",
    };
  }

  const schema = {
    type: "object",
    additionalProperties: false,
    properties: {
      items: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: false,
          properties: {
            description: { type: "string" },
            quantity: { type: "number" },
            unit: { type: "string" },
            unit_price: { type: "number" },
            vat_rate: { type: "number" },
          },
          required: ["description", "quantity", "unit", "unit_price", "vat_rate"],
        },
      },
      lead_time_days: { type: "integer" },
      valid_until_days: { type: "integer" },
      cover_email: { type: "string" },
      note: { type: "string" },
    },
    required: ["items", "lead_time_days", "valid_until_days", "cover_email", "note"],
  };

  const message = await new Anthropic({ apiKey }).messages.create({
    model,
    max_tokens: 2000,
    output_config: { effort: "medium", format: { type: "json_schema", schema } },
    system:
      "Jsi obchodník nástrojárny Mnástrojárna. Z poptávky a kalkulace technologa sestav cenovou nabídku " +
      "(položky s cenami, dodací lhůta, platnost) a průvodní e-mail v češtině. Sazba DPH 21 %." +
      (input.rules ? `\n\n${input.rules}` : ""),
    messages: [
      {
        role: "user",
        content:
          `Zákazník: ${input.customer}\nPoptávka: ${input.inquiry}\n` +
          (input.estimate
            ? `\nKalkulace technologa: cena/ks ${input.estimate.unit_price} CZK, celkem ${input.estimate.total_price} CZK, ` +
              `lhůta ${input.estimate.lead_time_days} dní, materiál ${input.estimate.material}.`
            : ""),
      },
    ],
  });

  return JSON.parse(textOf(message)) as GeneratedQuote;
}

// ── Potvrzení (poptávka / objednávka / faktura) ─────────────
export async function generateConfirmation(input: {
  kind: "poptavka" | "objednavka" | "faktura";
  reference: string;
  customer: string;
  rules?: string;
}): Promise<string> {
  const { apiKey, model } = await getAiConfig();
  if (!apiKey) {
    return `Dobrý den,\n\npotvrzujeme přijetí (${input.reference}). (Plný text vygeneruje AI po doplnění klíče.)\n\nS pozdravem,\nMNástrojárna s.r.o.`;
  }

  const message = await new Anthropic({ apiKey }).messages.create({
    model,
    max_tokens: 900,
    output_config: { effort: "low" },
    system:
      "Jsi asistent nástrojárny Mnástrojárna. Napiš krátké zdvořilé potvrzení v češtině. " +
      "Podpis: 'S pozdravem, MNástrojárna s.r.o.'. Vrať pouze tělo e-mailu." +
      (input.rules ? `\n\n${input.rules}` : ""),
    messages: [
      {
        role: "user",
        content: `Typ potvrzení: ${input.kind}\nReference: ${input.reference}\nZákazník: ${input.customer}`,
      },
    ],
  });

  return textOf(message).trim();
}

// ── Čtení z přílohy (výkres / objednávka) přes Claude vision ─
export interface ToleranceCounts {
  t005: number; // ≤ 0,005 mm
  t01: number;  // ≤ 0,01 mm
  t04: number;  // ≤ 0,04 mm
  t1: number;   // ≤ 0,1 mm
}
export interface ExtractedDocument {
  doc_type: "poptavka" | "objednavka" | "vykres" | "faktura" | "ostatni";
  part_name: string;
  part_type: "obrabeny_dil" | "plech" | "svarenec" | "vykovek" | "odlitek" | "jine";
  order_type: "vyroba_dilu" | "nastroj_na_dil" | "uprava_dilu";
  drawing_number: string;
  revision: string;
  material: string;
  blank_dimensions: string;     // rozměry polotovaru
  blank_weight_kg: number;      // váha polotovaru
  finished_weight_kg: number;   // váha hotového obrobku
  removed_weight_kg: number;    // úběr (polotovar − hotový)
  surface_treatment: string;    // povrchová úprava
  heat_treatment: string;       // tepelná úprava
  surface_qualities: string[];  // jakosti povrchů (Ra)
  machining_technologies: string[];
  tolerances_before_ht: ToleranceCounts; // počty přesných rozměrů před tepelkou
  tolerances_after_ht: ToleranceCounts;  // po tepelce
  geom_tolerance_count: number; // geometrické tolerance (rovinnost, souosost…)
  thread_count: number;         // počet závitů
  hole_count: number;           // počet otvorů
  pocket_count: number;         // počet kapes
  quantity: number;
  customer: string;
  requirements: string;
  summary: string;
  confidence: number;
  needs_clarification: string[];
}

function emptyTol(): ToleranceCounts { return { t005: 0, t01: 0, t04: 0, t1: 0 }; }

export async function extractFromDocument(input: {
  mediaType: string; // application/pdf | image/png | image/jpeg | image/webp
  dataBase64: string;
  rules?: string;
}): Promise<ExtractedDocument> {
  const { apiKey, model } = await getAiConfig();
  if (!apiKey) {
    return {
      doc_type: "ostatni", part_name: "", part_type: "jine", order_type: "vyroba_dilu",
      drawing_number: "", revision: "", material: "", blank_dimensions: "",
      blank_weight_kg: 0, finished_weight_kg: 0, removed_weight_kg: 0,
      surface_treatment: "", heat_treatment: "", surface_qualities: [], machining_technologies: [],
      tolerances_before_ht: emptyTol(), tolerances_after_ht: emptyTol(),
      geom_tolerance_count: 0, thread_count: 0, hole_count: 0, pocket_count: 0,
      quantity: 0, customer: "", requirements: "",
      summary: "AI není nakonfigurováno — doplň Claude API klíč v Nastavení → Integrace.",
      confidence: 0, needs_clarification: ["Claude API klíč"],
    };
  }

  const tolSchema = {
    type: "object", additionalProperties: false,
    properties: { t005: { type: "integer" }, t01: { type: "integer" }, t04: { type: "integer" }, t1: { type: "integer" } },
    required: ["t005", "t01", "t04", "t1"],
  };
  const schema = {
    type: "object",
    additionalProperties: false,
    properties: {
      doc_type: { type: "string", enum: ["poptavka", "objednavka", "vykres", "faktura", "ostatni"] },
      part_name: { type: "string" },
      part_type: { type: "string", enum: ["obrabeny_dil", "plech", "svarenec", "vykovek", "odlitek", "jine"] },
      order_type: { type: "string", enum: ["vyroba_dilu", "nastroj_na_dil", "uprava_dilu"] },
      drawing_number: { type: "string" },
      revision: { type: "string" },
      material: { type: "string" },
      blank_dimensions: { type: "string" },
      blank_weight_kg: { type: "number" },
      finished_weight_kg: { type: "number" },
      removed_weight_kg: { type: "number" },
      surface_treatment: { type: "string" },
      heat_treatment: { type: "string" },
      surface_qualities: { type: "array", items: { type: "string" } },
      machining_technologies: { type: "array", items: { type: "string" } },
      tolerances_before_ht: tolSchema,
      tolerances_after_ht: tolSchema,
      geom_tolerance_count: { type: "integer" },
      thread_count: { type: "integer" },
      hole_count: { type: "integer" },
      pocket_count: { type: "integer" },
      quantity: { type: "integer" },
      customer: { type: "string" },
      requirements: { type: "string" },
      summary: { type: "string" },
      confidence: { type: "number" },
      needs_clarification: { type: "array", items: { type: "string" } },
    },
    required: [
      "doc_type", "part_name", "part_type", "order_type", "drawing_number", "revision", "material",
      "blank_dimensions", "blank_weight_kg", "finished_weight_kg", "removed_weight_kg",
      "surface_treatment", "heat_treatment", "surface_qualities", "machining_technologies",
      "tolerances_before_ht", "tolerances_after_ht",
      "geom_tolerance_count", "thread_count", "hole_count", "pocket_count",
      "quantity", "customer", "requirements",
      "summary", "confidence", "needs_clarification",
    ],
  };

  const isPdf = input.mediaType === "application/pdf";
  const source = { type: "base64" as const, media_type: input.mediaType, data: input.dataBase64 };
  const fileBlock = (isPdf
    ? { type: "document", source }
    : { type: "image", source }) as Anthropic.ContentBlockParam;

  const message = await new Anthropic({ apiKey }).messages.create({
    model,
    max_tokens: 3000,
    thinking: { type: "adaptive" },
    output_config: { effort: "high", format: { type: "json_schema", schema } },
    system:
      "Jsi zkušený technik/technolog nástrojárny Mnástrojárna. Z přiloženého výkresu/dokumentu vytáhni KOMPLETNÍ technologická data: " +
      "název dílu; typ dílu (obráběný díl/plech/svařenec/výkovek/odlitek); typ zakázky (výroba dílu / nástroj na výrobu dílu / pouze úprava dílu dodaného zákazníkem); " +
      "číslo výkresu a revizi; materiál; rozměry a odhad váhy polotovaru; odhad váhy hotového dílu a úběr; povrchovou a tepelnou úpravu; jakosti povrchů (Ra); " +
      "technologie obrábění; POČTY přesných rozměrů rozdělené dle nejtěsnější tolerance do skupin ≤0,005 / ≤0,01 / ≤0,04 / ≤0,1 mm, a to ZVLÁŠŤ pro rozměry " +
      "kontrolované před tepelným zpracováním a po něm; počet geometrických tolerancí (rovinnost, kolmost, souosost, házení…); počet závitů; počet otvorů; počet kapes; " +
      "množství a zákazníka. Co nelze z výkresu přečíst, nech prázdné/0 a uveď v needs_clarification, sniž confidence. Nehádej." +
      (input.rules ? `\n\n${input.rules}` : ""),
    messages: [
      {
        role: "user",
        content: [fileBlock, { type: "text", text: "Přečti výkres jako technolog a vrať kompletní strukturovaná data dle schématu." }],
      },
    ],
  });

  return JSON.parse(textOf(message)) as ExtractedDocument;
}
