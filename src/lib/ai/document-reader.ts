import "server-only";
import { readFile } from "node:fs/promises";
import Anthropic from "@anthropic-ai/sdk";
import { getAiConfig } from "@/lib/settings";
import { COMPANY } from "@/lib/company";
import { refreshCompanyFromSettings } from "@/lib/company-server";
import { getAgentInstructions } from "@/lib/ai/corrections";
import { buildCaptureLearningPrompt } from "@/lib/jobs/training";
import { normalizeExtracted } from "@/lib/jobs/extracted-normalize";
import type { CaptureDocKind, ExtractedBusinessDoc } from "@/lib/jobs/capture-types";

/**
 * AI čtení obchodního dokladu z fotky / PDF („Vyfoť doklad → zakázka se vyplní sama“).
 * Claude (vision + structured outputs) vrátí ExtractedBusinessDoc; výsledek vždy
 * projde normalizeExtracted, takže volající dostane úplný a uklizený objekt.
 *
 * TESTOVACÍ HÁČEK: když je nastavena proměnná prostředí AI_FAKE_CAPTURE na cestu
 * k JSON souboru (např. src/lib/jobs/__fixtures__/capture/objednavka-strojmetal.json),
 * API se nevolá a vrátí se normalizovaný obsah souboru — E2E testy tak běží bez
 * Claude API klíče. V produkci proměnnou NENASTAVOVAT.
 */

export interface ReadDocumentFile {
  /** image/jpeg | image/png | image/webp | image/gif | application/pdf */
  mediaType: string;
  /** Base64 bez prefixu „data:…;base64,“. */
  dataBase64: string;
}

export interface ReadDocumentInput {
  /** Více souborů = stránky JEDNOHO dokladu (v pořadí). */
  files: ReadDocumentFile[];
  /** Nápověda z kontextu (doklad nahrávaný přímo v kartě zakázky apod.). */
  hint?: { jobNumber?: string; customerName?: string; expectedKind?: CaptureDocKind };
}

const IMAGE_TYPES = ["image/jpeg", "image/png", "image/gif", "image/webp"] as const;
type ImageType = (typeof IMAGE_TYPES)[number];
const MAX_FILES = 20;

export const AI_NOT_CONFIGURED = "AI není nakonfigurováno — doplň Claude API klíč v Nastavení.";

const DOC_KIND_ENUM: CaptureDocKind[] = [
  "poptavka", "nabidka", "objednavka", "potvrzeni", "dodaci_list", "faktura", "vykres", "ostatni",
];

const str = (description?: string) => (description ? { type: "string", description } : { type: "string" });
const num = (description?: string) => (description ? { type: "number", description } : { type: "number" });

const PARTY_FIELDS = ["name", "ico", "dic", "street", "city", "zip", "country", "email", "phone", "contactPerson"];
const partySchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    name: str("Název firmy"),
    ico: str("IČO jen číslice"),
    dic: str("DIČ včetně prefixu země"),
    street: str(), city: str(), zip: str(),
    country: str("Kód země ISO (CZ, DE, SK…)"),
    email: str(), phone: str(),
    contactPerson: str("Kontaktní osoba / vyřizuje"),
  },
  required: PARTY_FIELDS,
};

const ITEM_FIELDS = ["drawingNumber", "revision", "name", "description", "material", "quantity", "unit", "unitPrice", "deliveryDate"];
const itemSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    drawingNumber: str("Číslo výkresu / artiklu přesně"),
    revision: str("Revize / index výkresu"),
    name: str("Název dílu"),
    description: str(),
    material: str(),
    quantity: num("Množství (0 = neuvedeno)"),
    unit: str("ks, kg, m, sada…"),
    unitPrice: num("Cena za MJ bez DPH (0 = neuvedeno)"),
    deliveryDate: str("RRRR-MM-DD nebo prázdné"),
  },
  required: ITEM_FIELDS,
};

const DOC_FIELDS = [
  "docKind", "issuer", "documentNumber", "documentDate", "customer", "supplier",
  "customerOrderNumber", "customerInquiryNumber", "ourQuoteNumber", "ourJobNumber",
  "ourOrderConfirmationNumber", "supplierNumberAtCustomer", "requiredDeliveryDate",
  "promisedDeliveryDate", "items", "totalWithoutVat", "currency", "paymentTerms",
  "deliveryTerms", "note", "summary", "confidence", "needsClarification",
];

/** JSON schéma = přesně ExtractedBusinessDoc (vše povinné, prázdné = "" / 0). */
export const BUSINESS_DOC_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    docKind: { type: "string", enum: DOC_KIND_ENUM },
    issuer: { type: "string", enum: ["zakaznik", "my", "dodavatel", "neznamy"] },
    documentNumber: str("Číslo tohoto dokladu dle vystavitele"),
    documentDate: str("Datum vystavení RRRR-MM-DD"),
    customer: partySchema,
    supplier: partySchema,
    customerOrderNumber: str(),
    customerInquiryNumber: str(),
    ourQuoteNumber: str(),
    ourJobNumber: str(),
    ourOrderConfirmationNumber: str(),
    supplierNumberAtCustomer: str(),
    requiredDeliveryDate: str("RRRR-MM-DD"),
    promisedDeliveryDate: str("RRRR-MM-DD"),
    items: { type: "array", items: itemSchema },
    totalWithoutVat: num("Celkem bez DPH (0 = neuvedeno)"),
    currency: str("CZK, EUR…"),
    paymentTerms: str(),
    deliveryTerms: str(),
    note: str("Ručně psané poznámky, razítka"),
    summary: str("1–2 věty česky"),
    confidence: num("0–1"),
    needsClarification: { type: "array", items: { type: "string" } },
  },
  required: DOC_FIELDS,
};

function systemPrompt(): string {
  const us = `${COMPANY.name} (IČO ${COMPANY.ico}, DIČ ${COMPANY.dic})`;
  return [
    `Jsi obchodní back-office firmy ${us} — nástrojárna a obchodně-kooperační firma (CNC obrábění, nástroje, kooperace). ` +
      "Přečti přiložený obchodní doklad (fotka z mobilu nebo PDF) a vrať strukturovaná data podle schématu, " +
      "aby se zakázka v Knize zakázek vyplnila sama a spárovala se správnou zakázkou.",

    "DRUH DOKLADU (docKind): poptavka, nabidka, objednavka, potvrzeni (potvrzení objednávky), dodaci_list, faktura, " +
      "vykres (samotný výkres bez obchodních údajů), ostatni.",

    "VYSTAVITEL (issuer):\n" +
      "- zakaznik = doklad vystavil náš zákazník nám (poptávka, objednávka zákazníka…).\n" +
      `- my = doklad vystavila naše firma ${COMPANY.name} — naše nabídka, potvrzení objednávky, dodací list, faktura, ` +
      "nebo naše objednávka / poptávka u dodavatele. Poznáš podle našeho názvu, IČO či loga v hlavičce.\n" +
      "- dodavatel = doklad vystavil náš dodavatel / kooperant nám (jeho nabídka, potvrzení naší objednávky, dodací list, faktura).\n" +
      "- neznamy = nelze určit.",

    "STRANY:\n" +
      `- customer = VŽDY konečný zákazník (odběratel), NIKDY naše vlastní firma ${COMPANY.name}. U dokladu od zákazníka ` +
      "je to vystavitel; u našeho dokladu odběratel / příjemce. U dokladu od dodavatele (a u naší objednávky dodavateli) " +
      "vyplň jen tehdy, je-li konečný zákazník na dokladu uveden (např. dodací adresa), jinak nech prázdné.\n" +
      "- supplier = jen u dokladů od dodavatele a u naší objednávky / poptávky dodavateli (dodavatel / adresát). Jinak prázdné.\n" +
      "- IČO jen číslice, DIČ včetně prefixu země (CZ12345678). Kontaktní osoba = „vyřizuje“, „Ansprechpartner“, „k rukám“.",

    "ČÍSLA DOKLADŮ — přepiš přesně znak po znaku, nic nedomýšlej:\n" +
      "- documentNumber = číslo tohoto dokladu dle vystavitele.\n" +
      "- customerOrderNumber = číslo objednávky odběratele: u objednávky zákazníka její číslo; u našeho dokladu číslo " +
      "objednávky zákazníka, na kterou odkazuje („Vaše objednávka č.“, „Ihre Bestellung“); u dokladu od dodavatele a u naší " +
      "objednávky dodavateli číslo NAŠÍ objednávky u dodavatele.\n" +
      "- customerInquiryNumber = číslo poptávky zákazníka (RFQ, Anfrage).\n" +
      "- ourQuoteNumber = číslo NAŠÍ nabídky (např. NAB-2026-031), na kterou doklad odkazuje („dle nabídky č.“, " +
      "„Ihr Angebot“, „Your quotation“); u naší nabídky její vlastní číslo. Nabídka dodavatele sem NEPATŘÍ.\n" +
      "- ourJobNumber = naše číslo zakázky (Z-2026-014), je-li na dokladu (např. „Vaše značka“, „Ihr Zeichen“).\n" +
      "- ourOrderConfirmationNumber = číslo našeho potvrzení objednávky.\n" +
      "- supplierNumberAtCustomer = číslo, pod kterým nás zákazník vede jako dodavatele („číslo dodavatele“, " +
      "„Lieferanten-Nr.“, „Vendor No.“, „Kreditor-Nr.“) — jen na dokladu zákazníka.\n" +
      "- Čísla výkresů a artiklů patří jen do položek (drawingNumber) — nikdy je nezaměňuj za číslo objednávky či nabídky.",

    "DATA ve formátu RRRR-MM-DD (12.3.2026 → 2026-03-12). documentDate = datum vystavení; requiredDeliveryDate = termín " +
      "dodání požadovaný zákazníkem; promisedDeliveryDate = potvrzený / slíbený termín (náš u našeho potvrzení či nabídky, " +
      "dodavatele u jeho dokladu). Týden („KW 14/2026“, „týden 14“) převeď na pondělí toho týdne a uveď to v needsClarification.",

    "POLOŽKY: každý řádek dokladu = jedna položka — drawingNumber (číslo výkresu / artiklu), revision (index, rev.), " +
      "name (název dílu), description, material, quantity, unit, unitPrice (cena za MJ bez DPH, 0 = neuvedeno), " +
      "deliveryDate (termín u položky). totalWithoutVat = celkem bez DPH (0 = neuvedeno); currency jako ISO kód (CZK, EUR).",

    "Ručně psané poznámky, razítka a podpisy přepiš do note (např. „ručně: dodat s atestem 3.1“). " +
      "summary = 1–2 věty česky, co doklad je a co z něj plyne pro zakázku.",

    "KVALITA: co nelze spolehlivě přečíst, nech prázdné / 0 — nikdy nedomýšlej. Při rozmazané, oříznuté nebo neúplné " +
      "fotce sniž confidence (0–1) a do needsClarification napiš česky a konkrétně, co má člověk ověřit.",
  ].join("\n\n");
}

function hintText(hint: ReadDocumentInput["hint"]): string {
  if (!hint) return "";
  const parts: string[] = [];
  if (hint.jobNumber) parts.push(`doklad nahrává uživatel u zakázky ${hint.jobNumber}`);
  if (hint.customerName) parts.push(`očekávaný zákazník: ${hint.customerName}`);
  if (hint.expectedKind) parts.push(`očekávaný druh dokladu: ${hint.expectedKind}`);
  if (!parts.length) return "";
  return `\n\nNÁPOVĚDA Z KONTEXTU (jen orientačně — pokud doklad říká něco jiného, platí doklad): ${parts.join("; ")}.`;
}

function fileBlock(file: ReadDocumentFile): Anthropic.ContentBlockParam {
  const mediaType = file.mediaType.toLowerCase() === "image/jpg" ? "image/jpeg" : file.mediaType.toLowerCase();
  const data = file.dataBase64.replace(/^data:[^;]+;base64,/, "").replace(/\s+/g, "");
  if (mediaType === "application/pdf") {
    return { type: "document", source: { type: "base64", media_type: "application/pdf", data } };
  }
  if ((IMAGE_TYPES as readonly string[]).includes(mediaType)) {
    return { type: "image", source: { type: "base64", media_type: mediaType as ImageType, data } };
  }
  throw new Error(`Nepodporovaný formát souboru (${file.mediaType}) — nahraj JPG, PNG, WEBP nebo PDF.`);
}

async function readFakeCapture(path: string): Promise<ExtractedBusinessDoc> {
  const raw = await readFile(path, "utf8");
  return normalizeExtracted(JSON.parse(raw));
}

async function bestEffort(fn: () => Promise<string>): Promise<string> {
  try {
    return await fn();
  } catch {
    return "";
  }
}

/**
 * Je čtení dokladů k dispozici? (API klíč, nebo testovací AI_FAKE_CAPTURE.)
 * Oprávnění uživatele (super admin / profiles.ai_access / ai_capture_for_all
 * a hlavní vypínač AI) kontroluje volající — tady jen technická dostupnost.
 */
export async function isDocumentReaderConfigured(): Promise<boolean> {
  if (process.env.AI_FAKE_CAPTURE) return true;
  return Boolean((await getAiConfig()).apiKey);
}

/**
 * Přečte doklad (1..n stránek) a vrátí normalizovaná data.
 * Bez API klíče hází chybu AI_NOT_CONFIGURED (route pak nabídne ruční vyplnění).
 */
export async function readBusinessDocument(input: ReadDocumentInput): Promise<ExtractedBusinessDoc> {
  const fake = process.env.AI_FAKE_CAPTURE;
  if (fake) return readFakeCapture(fake);

  const { apiKey, model } = await getAiConfig();
  if (!apiKey) throw new Error(AI_NOT_CONFIGURED);

  if (!input.files.length) throw new Error("Chybí soubor dokladu.");
  if (input.files.length > MAX_FILES) throw new Error(`Doklad může mít nejvýš ${MAX_FILES} stránek.`);
  const blocks = input.files.map(fileBlock);

  await bestEffort(async () => { await refreshCompanyFromSettings(); return ""; });
  const [rules, learning] = await Promise.all([
    bestEffort(() => getAgentInstructions("capture")),
    bestEffort(() => buildCaptureLearningPrompt()),
  ]);
  const system = [systemPrompt(), rules, learning].filter(Boolean).join("\n\n");

  const pages = input.files.length > 1
    ? `Přílohy 1–${input.files.length} jsou stránky JEDNOHO dokladu v tomto pořadí. `
    : "";

  const message = await new Anthropic({ apiKey }).messages.create({
    model,
    max_tokens: 16000,
    thinking: { type: "adaptive" },
    output_config: { effort: "high", format: { type: "json_schema", schema: BUSINESS_DOC_SCHEMA } },
    system,
    messages: [
      {
        role: "user",
        content: [
          ...blocks,
          {
            type: "text",
            text: `${pages}Přečti doklad a vrať strukturovaná data dle schématu.${hintText(input.hint)}`,
          },
        ],
      },
    ],
  });

  if (message.stop_reason === "refusal") throw new Error("AI odmítla doklad zpracovat — vyplň údaje ručně.");
  if (message.stop_reason === "max_tokens") throw new Error("AI odpověď byla useknutá — zkus doklad nahrát znovu.");

  const text = message.content
    .filter((b): b is Anthropic.TextBlock => b.type === "text")
    .map((b) => b.text)
    .join("");
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error("AI vrátila nečitelnou odpověď — zkus doklad nahrát znovu.");
  }
  return normalizeExtracted(parsed);
}
