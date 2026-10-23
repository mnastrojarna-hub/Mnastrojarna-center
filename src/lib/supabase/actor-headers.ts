/**
 * Kdo změnu dělá — hlavičky pro servisního klienta Supabase (čistý modul, bez server-only).
 *
 * DB (app_ctx / app_actor) hlavičkám věří JEN u servisní role: session klient ani anon je
 * nepodvrhnou. Hlavičky jsou vždy ASCII; poznámka ke změně jde jako base64url(UTF-8).
 */

export type ActorKind = "user" | "ai" | "system";
export type ActorVia = "rucne" | "ai" | "foto" | "email" | "automaticky" | "import" | "cron";
export type ChangeVia = ActorVia | "rest" | "db";

export interface ActorContext {
  /** profiles.id — jen z ověřené session nebo explicitně ze serveru (AI za vlastníka schránky…). */
  id: string | null;
  kind: ActorKind;
  via?: ActorVia;
  /** AI agent: capture | email-ingest | ai-quote | cron-mail … — ^[a-z0-9_-]{1,40}$ */
  agent?: string | null;
  /** Výchozí crypto.randomUUID() — jeden na klienta (= na akci); slouží ke sloučení stage událostí. */
  requestId?: string;
}

export const ACTOR_HEADER = {
  id: "x-actor-id",
  kind: "x-actor-kind",
  via: "x-actor-via",
  agent: "x-actor-agent",
  request: "x-actor-request",
  note: "x-change-note",
} as const;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const AGENT_RE = /^[a-z0-9_-]{1,40}$/;
const KINDS: readonly ActorKind[] = ["user", "ai", "system"];
const VIAS: readonly ActorVia[] = ["rucne", "ai", "foto", "email", "automaticky", "import", "cron"];
const DEFAULT_VIA: Record<ActorKind, ActorVia> = { user: "rucne", ai: "ai", system: "automaticky" };
/** Max. délka poznámky (stejně jako app_change_note v DB). */
export const CHANGE_NOTE_MAX = 500;

export const SYSTEM_ACTOR: ActorContext = { id: null, kind: "system", via: "automaticky" };

export function isActorKind(v: unknown): v is ActorKind {
  return typeof v === "string" && (KINDS as readonly string[]).includes(v);
}

export function isActorVia(v: unknown): v is ActorVia {
  return typeof v === "string" && (VIAS as readonly string[]).includes(v);
}

/** Přihlášený uživatel (z checkFeature / getSessionUser) jako autor změny. */
export function userActor(user: { id: string } | null | undefined, via: ActorVia = "rucne"): ActorContext {
  return user?.id ? { id: user.id, kind: "user", via } : { ...SYSTEM_ACTOR };
}

/** AI jednající za uživatele (onBehalfOf) nebo sama za sebe (null). */
export function aiActor(onBehalfOf: string | null, agent: string, via: ActorVia = "ai"): ActorContext {
  return { id: onBehalfOf, kind: "ai", via, agent };
}

/** Plánovač (cron) — „Systém (plánovač)". */
export function cronActor(agent = "cron"): ActorContext {
  return { id: null, kind: "system", via: "cron", agent };
}

function newRequestId(): string {
  const c = (globalThis as { crypto?: { randomUUID?: () => string } }).crypto;
  if (c?.randomUUID) return c.randomUUID();
  // záloha bez Web Crypto (nemělo by nastat — Node 18+ i prohlížeče ho mají)
  const hex = Array.from({ length: 32 }, () => Math.floor(Math.random() * 16).toString(16)).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-a${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
}

/** Hlavičky pro servisního klienta. Neplatné hodnoty vynechá (DB pak bere „Systém"). Vždy ASCII. */
export function actorHeaders(actor: ActorContext | null | undefined): Record<string, string> {
  const a = actor ?? SYSTEM_ACTOR;
  const kind: ActorKind = isActorKind(a.kind) ? a.kind : "system";
  const via: ActorVia = isActorVia(a.via) ? a.via : DEFAULT_VIA[kind];
  const request = typeof a.requestId === "string" && UUID_RE.test(a.requestId) ? a.requestId : newRequestId();
  const out: Record<string, string> = {
    [ACTOR_HEADER.kind]: kind,
    [ACTOR_HEADER.via]: via,
    [ACTOR_HEADER.request]: request.toLowerCase(),
  };
  if (typeof a.id === "string" && UUID_RE.test(a.id)) out[ACTOR_HEADER.id] = a.id.toLowerCase();
  if (typeof a.agent === "string" && AGENT_RE.test(a.agent)) out[ACTOR_HEADER.agent] = a.agent;
  return out;
}

function toBase64(bytes: Uint8Array): string {
  const B = (globalThis as { Buffer?: { from(b: Uint8Array): { toString(enc: string): string } } }).Buffer;
  if (B) return B.from(bytes).toString("base64");
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin);
}

function fromBase64(value: string): Uint8Array {
  const B = (globalThis as { Buffer?: { from(s: string, enc: string): Uint8Array } }).Buffer;
  if (B) return new Uint8Array(B.from(value, "base64"));
  const bin = atob(value);
  return Uint8Array.from(bin, (ch) => ch.charCodeAt(0));
}

/** Poznámka ke změně → base64url(UTF-8); ořez na 500 znaků PŘED kódováním; prázdná → null. */
export function encodeChangeNote(note: string | null | undefined): string | null {
  if (typeof note !== "string") return null;
  const clean = Array.from(note.trim()).slice(0, CHANGE_NOTE_MAX).join("").trim();
  if (!clean) return null;
  return toBase64(new TextEncoder().encode(clean)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/** Zrcadlo app_change_note (testy): base64url → text, neplatné → null. */
export function decodeChangeNote(value: string): string | null {
  if (typeof value !== "string" || !/^[A-Za-z0-9_-]{1,1400}$/.test(value)) return null;
  let b = value.replace(/-/g, "+").replace(/_/g, "/");
  b += "=".repeat((4 - (b.length % 4)) % 4);
  try {
    const text = new TextDecoder("utf-8", { fatal: true }).decode(fromBase64(b)).trim();
    return text ? Array.from(text).slice(0, CHANGE_NOTE_MAX).join("") : null;
  } catch {
    return null;
  }
}

/** Poznámka k jednomu dotazu: q.setHeader("x-change-note", …). Bez poznámky vrátí q beze změny. */
export function withChangeNote<Q extends { setHeader(name: string, value: string): Q }>(q: Q, note?: string | null): Q {
  const encoded = encodeChangeNote(note);
  return encoded ? q.setHeader(ACTOR_HEADER.note, encoded) : q;
}
