import "server-only";
import { existsSync, readFileSync } from "node:fs";
import type Anthropic from "@anthropic-ai/sdk";
import { getAiConfig } from "@/lib/settings";
import { refreshCompanyFromSettings } from "@/lib/company-server";
import { getAgentInstructions } from "@/lib/ai/corrections";
import { callStructured, routeDeadline } from "@/lib/ai/ai-call";
import { AI_NOT_CONFIGURED } from "@/lib/ai/document-reader";
import { fakeBatchDir, isFakeCapture, safeBatchFile } from "@/lib/ai/fake-capture";
import { PARTY_SCHEMA, normalizePartyExtract, partySystemPrompt, type PartyExtract } from "@/lib/parties/party-extract";
import type { PartyKind } from "@/lib/contacts/roles";
import type { AiUsage } from "@/lib/jobs/capture-batch-types";

/**
 * AI čtení JEN firmy (zákazník / dodavatel) z fotek, PDF a textu (e-mail, vložený podpis).
 * Konvence jako supplier-invoice-reader (callStructured, termín, pravidla agenta „capture").
 *
 * TESTOVACÍ HÁČEK (AI_FAKE_CAPTURE): <dir>/batch/party-<kind>.json → party.json → prázdný výsledek.
 * V produkci proměnnou NENASTAVOVAT.
 */

const PARTY_MAX_TOKENS = 8_000;

export interface ReadPartyInput {
  kind: PartyKind;
  /** Obrázky / PDF (už připravené bloky). */
  blocks: Anthropic.ContentBlockParam[];
  /** Texty (e-maily, vložený text) s popiskem. */
  texts: { label: string; text: string }[];
  deadline?: number;
  clientSignal?: AbortSignal | null;
}

function readJson(file: string | null): unknown {
  if (!file || !existsSync(file)) return null;
  try {
    return JSON.parse(readFileSync(file, "utf8"));
  } catch {
    return null;
  }
}

export function fakePartyRaw(kind: PartyKind): unknown {
  const dir = fakeBatchDir();
  if (!dir) return {};
  return readJson(safeBatchFile(dir, `party-${kind}`)) ?? readJson(safeBatchFile(dir, "party")) ?? {};
}

async function bestEffort(fn: () => Promise<string>): Promise<string> {
  try {
    return await fn();
  } catch {
    return "";
  }
}

/** Přečte firmu z podkladů. Bez API klíče hází AI_NOT_CONFIGURED. */
export async function readParty(input: ReadPartyInput): Promise<{ party: PartyExtract; usage: AiUsage | null }> {
  if (isFakeCapture()) return { party: normalizePartyExtract(fakePartyRaw(input.kind), input.kind), usage: null };
  const { apiKey, model } = await getAiConfig();
  if (!apiKey) throw new Error(AI_NOT_CONFIGURED);
  if (!input.blocks.length && !input.texts.length) throw new Error("Chybí podklad — vyfoť nebo nahraj doklad, nebo vlož text.");
  await bestEffort(async () => { await refreshCompanyFromSettings(); return ""; });
  const extra = await bestEffort(() => getAgentInstructions("capture"));
  const content: Anthropic.ContentBlockParam[] = [...input.blocks];
  for (const t of input.texts) content.push({ type: "text", text: `${t.label}:\n<<<\n${t.text}\n>>>` });
  const who = input.kind === "customer" ? "zákazníka" : "dodavatele";
  const many = input.blocks.length + input.texts.length > 1 ? "Všechny přílohy patří k jedné firmě (stránky / různé podklady). " : "";
  content.push({ type: "text", text: `${many}Vytáhni údaje ${who} a vrať je dle schématu.` });
  const res = await callStructured({
    apiKey,
    model,
    systemStable: partySystemPrompt(input.kind),
    systemExtra: extra,
    content,
    schema: PARTY_SCHEMA,
    effort: "medium",
    maxTokens: PARTY_MAX_TOKENS,
    deadline: input.deadline ?? routeDeadline(),
    clientSignal: input.clientSignal ?? null,
  });
  return { party: normalizePartyExtract(res.data, input.kind), usage: res.usage };
}
