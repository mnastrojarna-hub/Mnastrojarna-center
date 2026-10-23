import "server-only";
import Anthropic from "@anthropic-ai/sdk";
import type { BetaMessageStreamParams } from "@anthropic-ai/sdk/resources/beta/messages/messages";
import type { AiFailure, AiUsage } from "@/lib/jobs/capture-batch-types";

/**
 * Společné volání Claude API pro čtení dokladů (roztřídění dávky, vytěžení dokladu, výkres):
 * vždy streaming (vysoké max_tokens bez rizika HTTP timeoutu), adaptivní thinking, strukturovaný
 * výstup (JSON schéma), explicitní effort, termín požadavku podle limitu route (Vercel maxDuration)
 * a server-side fallback u modelů, které ho podporují. Chyby se třídí na AiFailure s českou hláškou.
 * Nikdy budget_tokens, temperature / top_p / top_k ani prefill (na současných modelech 400).
 */

/** Modely se server-side fallbackem při odmítnutí (beta server-side-fallback-2026-07-01). */
export const FALLBACK_MODELS = ["claude-opus-5-5", "claude-opus-5", "claude-fable-5-1", "claude-sonnet-5-5"];
export const FALLBACK_BETA = "server-side-fallback-2026-07-01";

/** Route má maxDuration 300 s — práce musí skončit do 270 s, aby zbyl čas na záložní odpověď. */
export const ROUTE_BUDGET_MS = 270_000;
/** Rezerva na zpracování odpovědi po volání. */
const CALL_MARGIN_MS = 5_000;
/** Opakovat se vyplatí jen s dostatkem času na druhý pokus. */
const RETRY_MIN_LEFT_MS = 150_000;

export type AiEffort = "low" | "medium" | "high" | "xhigh" | "max";

export const AI_FAILURE_MESSAGE: Record<AiFailure, string> = {
  spend_limit: "AI vyčerpala měsíční limit — vyplň ručně.",
  rate_limit: "AI je právě přetížená požadavky — zkus to za chvíli, nebo vyplň ručně.",
  overloaded: "AI je teď přetížená — zkus to za chvíli, nebo vyplň ručně.",
  timeout: "AI nestihla doklad přečíst včas — vyplň ručně, nebo to zkus znovu.",
  refusal: "AI odmítla doklad zpracovat — vyplň údaje ručně.",
  max_tokens: "AI odpověď byla useknutá — zkus doklad nahrát znovu.",
  invalid_request: "AI požadavek odmítla (soubor je pro ni nečitelný nebo příliš velký) — vyplň ručně.",
  auth: "Claude API klíč je neplatný — oprav ho v Nastavení, zatím vyplň ručně.",
  other: "AI doklad nepřečetla — vyplň údaje ručně.",
};

const OUTPUT_CONFIG_MESSAGE = "Nastavený model nepodporuje strukturovaný výstup — změň model v Nastavení.";

/** Chyba volání AI s typem selhání (hláška je vždy česky a bez tajných údajů). */
export class AiCallError extends Error {
  readonly failure: AiFailure;
  readonly usage: AiUsage | null;
  constructor(failure: AiFailure, message?: string, usage: AiUsage | null = null) {
    super(message ?? AI_FAILURE_MESSAGE[failure]);
    this.name = "AiCallError";
    this.failure = failure;
    this.usage = usage;
  }
}

function errorBody(err: unknown): { code: string; message: string } {
  const e = err as { error?: unknown; message?: unknown } | null;
  const body = e && typeof e.error === "object" && e.error ? (e.error as Record<string, unknown>) : {};
  const inner = body.error && typeof body.error === "object" ? (body.error as Record<string, unknown>) : body;
  const code = typeof inner.error_code === "string" ? inner.error_code : typeof body.error_code === "string" ? body.error_code : "";
  const message = [inner.message, e?.message].filter((x) => typeof x === "string").join(" ");
  return { code, message };
}

/** Selhání AI podle typované chyby SDK (+ tělo chyby kvůli limitu útraty). */
export function classifyAiError(err: unknown): AiFailure {
  if (err instanceof AiCallError) return err.failure;
  const { code, message } = errorBody(err);
  if (code === "enforced_spend_limit_reached" || /reached your specified API usage limits/i.test(message)) return "spend_limit";
  if (err instanceof Anthropic.APIConnectionTimeoutError) return "timeout";
  if (err instanceof Anthropic.APIUserAbortError) return "timeout";
  if (err instanceof Anthropic.AuthenticationError || err instanceof Anthropic.PermissionDeniedError) return "auth";
  if (err instanceof Anthropic.RateLimitError) return "rate_limit";
  if (err instanceof Anthropic.BadRequestError || err instanceof Anthropic.UnprocessableEntityError) return "invalid_request";
  if (err instanceof Anthropic.InternalServerError) {
    const status = (err as { status?: number }).status;
    return status === 529 || /overloaded/i.test(message) ? "overloaded" : "other";
  }
  if (err instanceof Anthropic.APIError) {
    const status = (err as { status?: number }).status;
    if (status === 529) return "overloaded";
    if (status === 402) return "spend_limit";
  }
  if (err instanceof Error && (err.name === "AbortError" || err.name === "TimeoutError")) return "timeout";
  return "other";
}

/** Česká hláška k chybě AI (400 kvůli output_config = špatný model v Nastavení). */
export function aiFailureMessage(err: unknown): string {
  const failure = classifyAiError(err);
  if (failure === "invalid_request" && /output_config|json_schema|structured/i.test(errorBody(err).message)) {
    return OUTPUT_CONFIG_MESSAGE;
  }
  if (err instanceof AiCallError) return err.message;
  // vlastní chyby (chybí soubor, AI není nastavené…) mají českou hlášku samy
  if (failure === "other" && err instanceof Error && !(err instanceof Anthropic.AnthropicError)) return err.message;
  return AI_FAILURE_MESSAGE[failure];
}

/** Smí se po chybě zkusit znovu (limit útraty, klíč, odmítnutí ne). */
export function isRetryable(failure: AiFailure): boolean {
  return failure === "rate_limit" || failure === "overloaded" || failure === "other" || failure === "max_tokens";
}

/**
 * Parametry jednoho volání podle termínu route: timeout do termínu (− rezerva), opakování jen
 * se ≥ 150 s v záloze, abort při termínu (a u /analyze i při zrušení klientem). null = už není čas.
 */
export function callOptions(
  deadline: number,
  now: number = Date.now(),
  clientSignal?: AbortSignal | null,
): { timeout: number; maxRetries: number; signal: AbortSignal } | null {
  const left = deadline - now;
  if (left <= CALL_MARGIN_MS + 1_000) return null;
  const signals = [AbortSignal.timeout(left)];
  if (clientSignal) signals.push(clientSignal);
  return {
    timeout: left - CALL_MARGIN_MS,
    maxRetries: left > RETRY_MIN_LEFT_MS ? 1 : 0,
    signal: signals.length > 1 ? AbortSignal.any(signals) : signals[0],
  };
}

/** Termín pro práci v route (start + 270 s). */
export function routeDeadline(start: number = Date.now()): number {
  return start + ROUTE_BUDGET_MS;
}

export function usageOf(u: unknown): AiUsage {
  const o = (u && typeof u === "object" ? u : {}) as Record<string, unknown>;
  const n = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : 0);
  return {
    input: n(o.input_tokens),
    output: n(o.output_tokens),
    cacheRead: n(o.cache_read_input_tokens),
    cacheWrite: n(o.cache_creation_input_tokens),
  };
}

export function addUsage(a: AiUsage | null, b: AiUsage | null): AiUsage | null {
  if (!a) return b;
  if (!b) return a;
  return { input: a.input + b.input, output: a.output + b.output, cacheRead: a.cacheRead + b.cacheRead, cacheWrite: a.cacheWrite + b.cacheWrite };
}

export interface StructuredCallInput {
  apiKey: string;
  model: string;
  /** Stabilní blok (firma + pravidla) — cachuje se. */
  systemStable: string;
  /** Proměnlivý blok (učení, pravidla agenta) — za cache bodem. */
  systemExtra?: string;
  content: Anthropic.ContentBlockParam[];
  schema: Record<string, unknown>;
  effort: AiEffort;
  maxTokens: number;
  deadline: number;
  /** Abort klienta (jen /analyze — uživatel přestal chtít platit). */
  clientSignal?: AbortSignal | null;
}

export interface StructuredCallResult {
  data: unknown;
  usage: AiUsage;
  model: string;
}

/** Tělo požadavku (čistá funkce kvůli testům). */
export function buildRequestBody(input: Omit<StructuredCallInput, "apiKey" | "deadline" | "clientSignal">): Anthropic.MessageStreamParams {
  const system: Anthropic.TextBlockParam[] = [
    { type: "text", text: input.systemStable, cache_control: { type: "ephemeral" } },
  ];
  if (input.systemExtra?.trim()) system.push({ type: "text", text: input.systemExtra });
  return {
    model: input.model,
    max_tokens: input.maxTokens,
    thinking: { type: "adaptive" },
    output_config: { effort: input.effort, format: { type: "json_schema", schema: input.schema } },
    system,
    messages: [{ role: "user", content: input.content }],
  };
}

export function usesServerFallback(model: string): boolean {
  return FALLBACK_MODELS.includes(model);
}

type AnyBlock = { type: string; text?: string };

/** JSON z textových bloků; po server-side fallbacku platí text za posledním přepnutím. */
export function parseStructuredText(content: AnyBlock[]): unknown {
  const texts = content.filter((b) => b.type === "text").map((b) => b.text ?? "");
  const lastFallback = content.map((b) => b.type).lastIndexOf("fallback");
  const attempts = [texts.join("")];
  if (lastFallback >= 0) {
    attempts.push(content.slice(lastFallback + 1).filter((b) => b.type === "text").map((b) => b.text ?? "").join(""));
  }
  for (const t of attempts) {
    try {
      return JSON.parse(t);
    } catch {
      // další pokus
    }
  }
  throw new AiCallError("other", "AI vrátila nečitelnou odpověď — zkus doklad nahrát znovu.");
}

/** Jedno volání se strukturovaným výstupem (streaming, termín, fallback, kontrola stop_reason). */
export async function callStructured(input: StructuredCallInput): Promise<StructuredCallResult> {
  const opts = callOptions(input.deadline, Date.now(), input.clientSignal);
  if (!opts) throw new AiCallError("timeout");
  const body = buildRequestBody(input);
  const client = new Anthropic({ apiKey: input.apiKey });
  let message: { content: AnyBlock[]; stop_reason: string | null; usage: unknown; model: string };
  if (usesServerFallback(input.model)) {
    message = await client.beta.messages
      .stream({ ...(body as BetaMessageStreamParams), betas: [FALLBACK_BETA], fallbacks: "default" }, opts)
      .finalMessage();
  } else {
    message = await client.messages.stream(body, opts).finalMessage();
  }
  const usage = usageOf(message.usage);
  if (message.stop_reason === "refusal") throw new AiCallError("refusal", undefined, usage);
  if (message.stop_reason === "max_tokens") throw new AiCallError("max_tokens", undefined, usage);
  return { data: parseStructuredText(message.content), usage, model: message.model };
}
