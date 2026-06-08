import "server-only";
import Anthropic from "@anthropic-ai/sdk";
import type { EmailCategory, PriorityLevel } from "@/lib/supabase/database.types";
import { getAiConfig } from "@/lib/settings";

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

// ── Oceňování dle výkresu (jako technolog) ──────────────────
export interface PriceOperation {
  name: string;            // operace (frézování, soustružení, broušení, EDM…)
  machine_minutes: number; // strojní čas / ks
  setup_minutes: number;   // seřízení (na dávku)
}
export interface PricingParams {
  hourlyRate?: number;       // Kč/h stroj
  handlingRate?: number;     // Kč/h manipulace
  marginPercent?: number;    // výchozí marže %
  inflationPercent?: number; // roční inflace pro historické ceny
  transportDefault?: number; // výchozí doprava
}
export interface PriceEstimate {
  material: string;
  blank_weight_kg: number;          // váha polotovaru
  removed_weight_kg: number;        // úběr materiálu
  operations: PriceOperation[];
  handling_minutes: number;         // manipulace / ks
  transport_cost: number;           // doprava na zakázku
  material_cost_per_piece: number;
  surface_treatment_cost: number;   // povrchová úprava / ks
  heat_treatment_cost: number;      // tepelné zpracování / ks
  cooperation_cost_per_piece: number;
  labor_rate_per_hour: number;
  margin_percent: number;
  unit_price: number;
  total_price: number;
  lead_time_days: number;
  historical_used: boolean;         // použita historická cena + inflace
  historical_note: string;
  confidence: number;
  reasoning: string;
  needs_clarification: string[];
}

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
  quantity: number;
  customer?: string;
  requirements?: string;
  drawingText?: string;
  params?: PricingParams;
  historical?: { found: boolean; note?: string; unitPrice?: number };
  rules?: string;
}): Promise<PriceEstimate> {
  const { apiKey, model } = await getAiConfig();
  if (!apiKey) {
    return {
      material: input.material || "—",
      blank_weight_kg: 0, removed_weight_kg: 0,
      operations: [], handling_minutes: 0, transport_cost: 0,
      material_cost_per_piece: 0, surface_treatment_cost: 0, heat_treatment_cost: 0,
      cooperation_cost_per_piece: 0, labor_rate_per_hour: 0, margin_percent: 0,
      unit_price: 0, total_price: 0, lead_time_days: 0,
      historical_used: false, historical_note: "",
      confidence: 0,
      reasoning: "AI není nakonfigurováno — doplň Claude API klíč v Nastavení → Integrace.",
      needs_clarification: ["Claude API klíč"],
    };
  }

  const numProp = { type: "number" };
  const schema = {
    type: "object",
    additionalProperties: false,
    properties: {
      material: { type: "string" },
      blank_weight_kg: numProp,
      removed_weight_kg: numProp,
      operations: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: false,
          properties: { name: { type: "string" }, machine_minutes: numProp, setup_minutes: numProp },
          required: ["name", "machine_minutes", "setup_minutes"],
        },
      },
      handling_minutes: numProp,
      transport_cost: numProp,
      material_cost_per_piece: numProp,
      surface_treatment_cost: numProp,
      heat_treatment_cost: numProp,
      cooperation_cost_per_piece: numProp,
      labor_rate_per_hour: numProp,
      margin_percent: numProp,
      unit_price: numProp,
      total_price: numProp,
      lead_time_days: { type: "integer" },
      historical_used: { type: "boolean" },
      historical_note: { type: "string" },
      confidence: numProp,
      reasoning: { type: "string" },
      needs_clarification: { type: "array", items: { type: "string" } },
    },
    required: [
      "material", "blank_weight_kg", "removed_weight_kg", "operations", "handling_minutes", "transport_cost",
      "material_cost_per_piece", "surface_treatment_cost", "heat_treatment_cost", "cooperation_cost_per_piece",
      "labor_rate_per_hour", "margin_percent", "unit_price", "total_price", "lead_time_days",
      "historical_used", "historical_note", "confidence", "reasoning", "needs_clarification",
    ],
  };

  const p = input.params ?? {};
  const paramLines =
    `PARAMETRY (použij je): hodinová sazba ${p.hourlyRate ?? 1200} Kč/h, manipulace ${p.handlingRate ?? 600} Kč/h, ` +
    `výchozí marže ${p.marginPercent ?? 15} %, inflace ${p.inflationPercent ?? 5} %/rok, doprava ${p.transportDefault ?? 500} Kč.`;
  const hist = input.historical?.found
    ? `HISTORIE: tento výkres se už vyráběl — původní cena/ks ${input.historical.unitPrice ?? "?"} Kč (${input.historical.note ?? ""}). ` +
      `Vyjdi z ní a navyš o inflaci; historical_used=true.`
    : "HISTORIE: díl se dle dostupných dat dříve nevyráběl.";

  const message = await new Anthropic({ apiKey }).messages.create({
    model,
    max_tokens: 3500,
    thinking: { type: "adaptive" },
    output_config: { effort: "high", format: { type: "json_schema", schema } },
    system:
      "Jsi špičkový technolog a kalkulant CNC nástrojárny Mnástrojárna. Oceň díl jako při reálné kalkulaci a postupuj komplexně: " +
      "z váhy polotovaru spočítej náklad na materiál, urči úběr, rozepiš technologické operace a jejich strojní i seřizovací čas, " +
      "započítej manipulaci a dopravu, kooperace zvlášť (povrchová úprava, tepelné zpracování), zohledni počty přesných rozměrů " +
      "(úzké tolerance a tepelka cenu zvyšují), množstevní efekt i konkrétního zákazníka. Pokud existuje historická cena, vyjdi z ní + inflace. " +
      "Použij zadané PARAMETRY. Ceny v CZK. Buď realistický; u nejistot sniž confidence a doplň needs_clarification." +
      (input.rules ? `\n\n${input.rules}` : ""),
    messages: [
      {
        role: "user",
        content:
          `Výkres: ${input.drawingNumber ?? "—"}\nTyp dílu: ${input.partType ?? "?"}\nTyp zakázky: ${input.orderType ?? "?"}\n` +
          `Materiál: ${input.material ?? "neuvedeno"}\nPolotovar: ${input.blankDimensions ?? "?"} (váha ${input.blankWeightKg ?? "?"} kg)\n` +
          `Váha hotového dílu: ${input.finishedWeightKg ?? "?"} kg\nPovrchová úprava: ${input.surfaceTreatment ?? "—"}\nTepelná úprava: ${input.heatTreatment ?? "—"}\n` +
          `Jakosti povrchů: ${(input.surfaceQualities ?? []).join(", ") || "—"}\nTechnologie: ${(input.machiningTechnologies ?? []).join(", ") || "—"}\n` +
          `Tolerance před tepelkou: ${JSON.stringify(input.tolerancesBeforeHt ?? {})}\nTolerance po tepelce: ${JSON.stringify(input.tolerancesAfterHt ?? {})}\n` +
          `Množství: ${input.quantity} ks\nZákazník: ${input.customer ?? "—"}\nPožadavky: ${input.requirements ?? "—"}\n\n` +
          `${paramLines}\n${hist}\n\n${input.drawingText ?? ""}`,
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
      "tolerances_before_ht", "tolerances_after_ht", "quantity", "customer", "requirements",
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
      "technologie obrábění; a POČTY přesných rozměrů rozdělené dle nejtěsnější tolerance do skupin ≤0,005 / ≤0,01 / ≤0,04 / ≤0,1 mm, a to ZVLÁŠŤ pro rozměry " +
      "kontrolované před tepelným zpracováním a po něm; množství a zákazníka. Co nelze z výkresu přečíst, nech prázdné/0 a uveď v needs_clarification, sniž confidence. Nehádej." +
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
