/**
 * Nastavení e-mailových schránek — čistý modul (bez server-only, bez sítě), sdílí ho UI i server.
 *
 *  - předvolby poskytovatelů (hosting90 — ověřená jména serverů a porty, Gmail, Microsoft 365, jiný),
 *  - normalizace a validace konfigurace (test, uložení i stahování používají stejnou funkci),
 *  - hesla: prázdné pole = beze změny (nové heslo jen výslovně), hesla se NEořezávají,
 *  - šifrování podle portu (993/995/465 = TLS, 143/110/587/25/366 = STARTTLS),
 *  - kandidáti pro „Najít nastavení automaticky" a české vysvětlení chyb podle příčiny.
 *
 * Pole `imap_*` jsou obecně „příchozí server" — u POP3 (`incoming_protocol: "pop3"`) platí stejně.
 */
import type { MailboxConfig, MailboxProvider } from "@/lib/supabase/database.types";

export type TlsMode = "tls" | "starttls";
export type IncomingProtocol = "imap" | "pop3";
export type MailProto = IncomingProtocol | "smtp";
export type PresetId = "hosting90" | "gmail" | "m365" | "other";

export interface MailEndpoint {
  protocol: MailProto;
  host: string;
  port: number;
  tls: TlsMode;
  /** Šifrovat, ale neověřovat jméno v certifikátu (jen po výslovném souhlasu uživatele). */
  skipNameCheck?: boolean;
  /** Proč tento kandidát (pro tabulku „co se zkoušelo"). */
  why?: string;
}

export interface MailPreset {
  id: PresetId | "test";
  label: string;
  description: string;
  imap: MailEndpoint[];
  pop3: MailEndpoint[];
  smtp: MailEndpoint[];
  /** Přihlašovací jméno = celá e-mailová adresa. */
  loginIsEmail: boolean;
  notes: string[];
}

const ep = (protocol: MailProto, host: string, port: number, tls: TlsMode, why: string): MailEndpoint => ({ protocol, host, port, tls, why });

/**
 * hosting90 — oficiální nastavení (docs.hosting90.cz, „První kroky: POP3/IMAP/SMTP" a „Outlook 2013/2016"):
 * IMAP mail.hosting90.cz 993 SSL / 143, POP3 995 SSL / 110, SMTP smtp.hosting90.cz 465 SSL / 587, 366, 25 TLS.
 * Platí pro VŠECHNY domény na hosting90 (nastrojarstvi.com, mnastrojarna.cz …). mail.<vlastní doména>
 * vede na stejný server, ale „neumožňuje využít SSL" — certifikát je vystavený na mail.hosting90.cz.
 */
export const HOSTING90_IMAP_HOST = "mail.hosting90.cz";
export const HOSTING90_SMTP_HOST = "smtp.hosting90.cz";

export const PRESETS: Record<PresetId, MailPreset> = {
  hosting90: {
    id: "hosting90",
    label: "hosting90 (vlastní doména)",
    description:
      "Firemní schránky na hosting90 — @nastrojarstvi.com, @mnastrojarna.cz i jakákoli další doména. Server je vždy mail.hosting90.cz / smtp.hosting90.cz, uživatel = celá adresa.",
    imap: [
      ep("imap", HOSTING90_IMAP_HOST, 993, "tls", "hosting90 IMAP (SSL/TLS)"),
      ep("imap", HOSTING90_IMAP_HOST, 143, "starttls", "hosting90 IMAP (STARTTLS)"),
    ],
    pop3: [
      ep("pop3", HOSTING90_IMAP_HOST, 995, "tls", "hosting90 POP3 (SSL/TLS)"),
      ep("pop3", HOSTING90_IMAP_HOST, 110, "starttls", "hosting90 POP3 (STARTTLS)"),
    ],
    smtp: [
      ep("smtp", HOSTING90_SMTP_HOST, 465, "tls", "hosting90 SMTP (SSL/TLS)"),
      ep("smtp", HOSTING90_SMTP_HOST, 587, "starttls", "hosting90 SMTP (STARTTLS)"),
      ep("smtp", HOSTING90_SMTP_HOST, 366, "starttls", "hosting90 SMTP (alternativní port 366)"),
      ep("smtp", HOSTING90_SMTP_HOST, 25, "starttls", "hosting90 SMTP (port 25)"),
    ],
    loginIsEmail: true,
    notes: [
      "Server mail.<vaše doména> u hosting90 SSL neumí (certifikát nesedí) — proto mail.hosting90.cz.",
      "V Outlooku (POP3) zapni „Ponechat kopii zpráv na serveru“, jinak aplikace v INBOXu nic nenajde. Lepší je přepnout Outlook také na IMAP mail.hosting90.cz, port 993.",
    ],
  },
  gmail: {
    id: "gmail",
    label: "Gmail / Google Workspace",
    description: "IMAP imap.gmail.com, SMTP smtp.gmail.com. Google vyžaduje heslo aplikace (zapnuté dvoufázové ověření).",
    imap: [ep("imap", "imap.gmail.com", 993, "tls", "Gmail IMAP")],
    pop3: [ep("pop3", "pop.gmail.com", 995, "tls", "Gmail POP3")],
    smtp: [
      ep("smtp", "smtp.gmail.com", 465, "tls", "Gmail SMTP (SSL/TLS)"),
      ep("smtp", "smtp.gmail.com", 587, "starttls", "Gmail SMTP (STARTTLS)"),
    ],
    loginIsEmail: true,
    notes: ["Běžné heslo k účtu Google odmítne — vytvoř „heslo aplikace“ (Účet Google → Zabezpečení → Hesla aplikací)."],
  },
  m365: {
    id: "m365",
    label: "Microsoft 365 (Exchange Online) — Graph",
    description:
      "Jen pro schránky v Microsoft 365. Ne pro Outlook v počítači napojený na hosting90 — tam zvol hosting90.",
    imap: [],
    pop3: [],
    smtp: [],
    loginIsEmail: true,
    notes: [
      "IMAP/POP/SMTP s heslem je v Microsoft 365 vypnuté (jen OAuth) — aplikace čte poštu přes Microsoft Graph.",
      "Azure Portal → Microsoft Entra ID → Registrace aplikací → Nová registrace; zkopíruj Application (client) ID a Directory (tenant) ID.",
      "Certifikáty a tajné kódy → Nový tajný klíč → zkopíruj HODNOTU (Value), ne jeho ID.",
      "Oprávnění API → Microsoft Graph → Oprávnění aplikace: Mail.Read (a Mail.Send pro odesílání) → „Udělit souhlas správce“.",
    ],
  },
  other: {
    id: "other",
    label: "Jiný poskytovatel (IMAP/POP3/SMTP)",
    description: "Ruční zadání serverů. Nevíš? Vyplň e-mail a heslo a klikni na „Najít nastavení automaticky“.",
    imap: [],
    pop3: [],
    smtp: [],
    loginIsEmail: false,
    notes: [],
  },
};

export const PRESET_IDS: PresetId[] = ["hosting90", "m365", "gmail", "other"];

export function isPresetId(v: unknown): v is PresetId {
  return typeof v === "string" && (PRESET_IDS as string[]).includes(v);
}

/** Typ schránky v DB podle předvolby (enum mailbox_provider: imap | outlook | gmail). */
export function providerForPreset(id: PresetId): MailboxProvider {
  return id === "m365" ? "outlook" : id === "gmail" ? "gmail" : "imap";
}

/** Předvolba uložené schránky (starší schránky bez `preset` podle typu / serveru). */
export function presetOf(provider: MailboxProvider, config: Partial<MailboxConfig> | null | undefined): PresetId {
  const c = config ?? {};
  if (isPresetId(c.preset)) return c.preset;
  if (provider === "outlook") return "m365";
  if (provider === "gmail") return "gmail";
  const host = String(c.imap_host ?? "").toLowerCase();
  if (/(^|\.)hosting90\.(cz|net|sk|eu|com)$/.test(host)) return "hosting90";
  return "other";
}

// ── Porty a šifrování ───────────────────────────────────────
const TLS_PORTS = new Set([993, 995, 465]);
const STARTTLS_PORTS = new Set([143, 110, 587, 25, 366, 2525]);

/** Šifrování podle portu: známý port = jeden režim, neznámý = vyzkoušet oba. */
export function tlsModesForPort(port: number): TlsMode[] {
  if (TLS_PORTS.has(port)) return ["tls"];
  if (STARTTLS_PORTS.has(port)) return ["starttls"];
  return ["tls", "starttls"];
}

/** Výchozí režim pro port (993/995/465 TLS, jinak STARTTLS u známých, TLS u neznámých). */
export function defaultTlsForPort(port: number): TlsMode {
  return tlsModesForPort(port)[0];
}

export function defaultPort(protocol: MailProto, tls: TlsMode = "tls"): number {
  if (protocol === "imap") return tls === "tls" ? 993 : 143;
  if (protocol === "pop3") return tls === "tls" ? 995 : 110;
  return tls === "tls" ? 465 : 587;
}

/** Protokol, kterému port patří (pro upozornění „port 995 je POP3"). */
export function protocolOfPort(port: number): MailProto | null {
  if (port === 993 || port === 143) return "imap";
  if (port === 995 || port === 110) return "pop3";
  if (port === 465 || port === 587 || port === 25 || port === 366 || port === 2525) return "smtp";
  return null;
}

export const PROTO_LABEL: Record<MailProto, string> = { imap: "IMAP", pop3: "POP3", smtp: "SMTP" };
export const TLS_LABEL: Record<TlsMode, string> = { tls: "SSL/TLS", starttls: "STARTTLS" };

export function isLoopbackHost(host: string): boolean {
  const h = host.toLowerCase();
  return h === "localhost" || h === "::1" || /^127\./.test(h) || h.endsWith(".localhost");
}

// ── Normalizace ─────────────────────────────────────────────
export function domainOf(email: string): string {
  return (String(email ?? "").split("@")[1] ?? "").trim().toLowerCase().replace(/\.$/, "");
}

export function normalizeEmail(email: unknown): string {
  return String(email ?? "").trim().toLowerCase();
}

export const EMAIL_RE = /^[^\s@<>"]+@[^\s@<>"]+\.[^\s@<>"]+$/;

/**
 * Název serveru z toho, co uživatel vložil: bez mezer, protokolu (imap://, https://), cesty,
 * koncové tečky; malými písmeny. Port za dvojtečkou vrátí zvlášť.
 */
export function normalizeHost(raw: unknown): { host: string; port?: number } {
  let s = String(raw ?? "").trim().toLowerCase();
  s = s.replace(/^[a-z][a-z0-9+.-]*:\/\//, ""); // imap://, ssl://, https://
  s = s.replace(/^[^@/]*@/, ""); // user@host
  s = s.split(/[/?#]/)[0];
  s = s.replace(/\s+/g, "");
  let port: number | undefined;
  const m = /^(.*?):(\d{1,5})$/.exec(s);
  if (m && !s.includes("::")) {
    s = m[1];
    port = Number(m[2]);
  }
  s = s.replace(/^\[|\]$/g, "").replace(/\.+$/, "");
  return { host: s, ...(port ? { port } : {}) };
}

/** Platný název serveru nebo IP adresa. */
export function isValidHost(host: string): boolean {
  if (!host || host.length > 253) return false;
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(host)) return host.split(".").every((p) => Number(p) <= 255);
  if (host.includes(":")) return /^[0-9a-f:]+$/.test(host); // IPv6
  if (host === "localhost") return true;
  return /^(?=.{1,253}$)([a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)(\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)+$/.test(host);
}

const PLAIN_KEYS = ["ms_graph_client_id", "ms_graph_tenant_id"] as const;
export const SECRET_KEYS = ["imap_password", "smtp_password", "ms_graph_client_secret"] as const;
export type SecretKey = (typeof SECRET_KEYS)[number];

function cleanPort(v: unknown): number | undefined | null {
  if (v === undefined || v === null || String(v).trim() === "") return undefined;
  const n = Number(String(v).trim());
  return Number.isInteger(n) && n >= 1 && n <= 65535 ? n : null;
}

/** Heslo: jen bez konců řádků (vložené z poznámek). Mezery na okrajích se NEořezávají — mohou být součástí hesla. */
export function cleanSecret(v: unknown): string | undefined {
  if (typeof v !== "string") return undefined;
  const s = v.replace(/[\r\n]+/g, "");
  return s === "" ? undefined : s;
}

function cleanUser(v: unknown): string | undefined {
  const s = String(v ?? "").trim();
  if (!s) return undefined;
  return s.includes("@") ? s.toLowerCase() : s;
}

export interface NormalizeResult {
  config: MailboxConfig;
  errors: string[];
  notes: string[];
}

/**
 * Jediná normalizace konfigurace pro test, uložení i stahování. Neznámé klíče zahodí,
 * servery vyčistí, porty převede na čísla, šifrování ověří; hesla nechá beze změny.
 */
export function normalizeMailboxConfig(input: Partial<MailboxConfig> | null | undefined): NormalizeResult {
  const src = (input ?? {}) as Record<string, unknown>;
  const out: MailboxConfig = {};
  const errors: string[] = [];
  const notes: string[] = [];

  if (isPresetId(src.preset)) out.preset = src.preset;
  const proto = src.incoming_protocol === "pop3" ? "pop3" : src.incoming_protocol === "imap" ? "imap" : undefined;
  if (proto) out.incoming_protocol = proto;

  for (const side of ["imap", "smtp"] as const) {
    const label = side === "imap" ? "příchozí" : "odchozí";
    const { host, port: hostPort } = normalizeHost(src[`${side}_host`]);
    if (host) {
      if (!isValidHost(host)) errors.push(`Neplatný ${label} server „${String(src[`${side}_host`]).trim()}“ — zadej jen název serveru, např. ${side === "imap" ? HOSTING90_IMAP_HOST : HOSTING90_SMTP_HOST}.`);
      else out[`${side}_host`] = host;
    }
    const port = cleanPort(src[`${side}_port`]);
    if (port === null) errors.push(`Neplatný ${label} port „${String(src[`${side}_port`])}“ (1–65535).`);
    else if (port) out[`${side}_port`] = port;
    else if (hostPort) out[`${side}_port`] = hostPort;
    const user = cleanUser(src[`${side}_user`]);
    if (user) out[`${side}_user`] = user;
    const tlsVal = src[`${side}_tls`];
    if (tlsVal === "tls" || tlsVal === "starttls") out[`${side}_tls`] = tlsVal;
    if (src[`${side}_skip_name_check`] === true || src[`${side}_skip_name_check`] === "true") out[`${side}_skip_name_check`] = true;
  }

  // POP3 port v poli příchozí pošty bez zvoleného protokolu → POP3 (nastavení z Outlooku)
  if (!out.incoming_protocol && out.imap_port && protocolOfPort(out.imap_port) === "pop3") {
    out.incoming_protocol = "pop3";
    notes.push(`Port ${out.imap_port} patří POP3 — příchozí pošta se stáhne přes POP3.`);
  }
  if (out.incoming_protocol === "imap" && out.imap_port && protocolOfPort(out.imap_port) === "pop3") {
    notes.push(`Port ${out.imap_port} je POP3, ne IMAP (IMAP = 993 SSL / 143 STARTTLS).`);
  }

  for (const key of PLAIN_KEYS) {
    const v = String(src[key] ?? "").trim();
    if (v) out[key] = v;
  }
  for (const key of SECRET_KEYS) {
    const v = cleanSecret(src[key]);
    if (v !== undefined) out[key] = v;
  }
  if (out.smtp_password && out.smtp_password === out.imap_password) delete out.smtp_password; // = stejné jako příchozí
  return { config: out, errors, notes };
}

export interface SecretChanges {
  imap_password?: string;
  smtp_password?: string;
  ms_graph_client_secret?: string;
}

/**
 * Spojí novou konfiguraci s uloženými tajnými údaji. Prázdné / chybějící = beze změny.
 * SMTP heslo stejné jako příchozí se neukládá zvlášť (při změně hesla schránky platí nové pro obě).
 */
export function mergeMailboxSecrets(prev: MailboxConfig | null | undefined, next: MailboxConfig, changes: SecretChanges = {}): MailboxConfig {
  const p = prev ?? {};
  const out: MailboxConfig = { ...next };
  for (const key of SECRET_KEYS) {
    const changed = cleanSecret(changes[key]) ?? cleanSecret(next[key]);
    if (changed !== undefined) out[key] = changed;
    else if (p[key]) out[key] = p[key];
    else delete out[key];
  }
  const smtpExplicit = cleanSecret(changes.smtp_password) ?? cleanSecret(next.smtp_password);
  if (!smtpExplicit && p.smtp_password && p.smtp_password === p.imap_password) delete out.smtp_password;
  if (out.smtp_password && out.smtp_password === out.imap_password) delete out.smtp_password;
  return out;
}

/** Popisný přehled změn bez hesel (audit log). */
export function describeConfigChanges(prev: MailboxConfig | null | undefined, next: MailboxConfig): Record<string, unknown> {
  const p = (prev ?? {}) as Record<string, unknown>;
  const n = next as Record<string, unknown>;
  const changes: Record<string, unknown> = {};
  const keys = new Set([...Object.keys(p), ...Object.keys(n)]);
  for (const k of keys) {
    if ((SECRET_KEYS as readonly string[]).includes(k)) {
      if (p[k] !== n[k]) changes[k] = n[k] ? (p[k] ? "změněno" : "nastaveno") : "odebráno";
      continue;
    }
    if (JSON.stringify(p[k]) !== JSON.stringify(n[k])) changes[k] = { from: p[k] ?? null, to: n[k] ?? null };
  }
  return changes;
}

// ── Efektivní nastavení ─────────────────────────────────────
export interface ResolvedEndpoint extends MailEndpoint {
  user: string;
  password: string;
}

/** Příchozí server ze schránky (uživatel výchozí = e-mail). null = chybí server nebo heslo. */
export function resolveIncoming(config: MailboxConfig | null | undefined, email: string): ResolvedEndpoint | null {
  const c = config ?? {};
  if (!c.imap_host || !c.imap_password) return null;
  const protocol: IncomingProtocol = c.incoming_protocol === "pop3" ? "pop3" : "imap";
  const port = Number(c.imap_port) || defaultPort(protocol, c.imap_tls ?? "tls");
  return {
    protocol,
    host: c.imap_host,
    port,
    tls: c.imap_tls ?? defaultTlsForPort(port),
    skipNameCheck: c.imap_skip_name_check === true || undefined,
    user: c.imap_user || normalizeEmail(email),
    password: c.imap_password,
  };
}

/** Odchozí server (uživatel = SMTP → příchozí → e-mail, heslo = SMTP → příchozí). */
export function resolveSmtp(config: MailboxConfig | null | undefined, email: string): ResolvedEndpoint | null {
  const c = config ?? {};
  const password = c.smtp_password || c.imap_password;
  if (!c.smtp_host || !password) return null;
  const port = Number(c.smtp_port) || 465;
  return {
    protocol: "smtp",
    host: c.smtp_host,
    port,
    tls: c.smtp_tls ?? defaultTlsForPort(port),
    skipNameCheck: c.smtp_skip_name_check === true || undefined,
    user: c.smtp_user || c.imap_user || normalizeEmail(email),
    password,
  };
}

/**
 * Co schránce chybí ke stahování (prázdné = kompletní). `hasSecret` umožní kontrolu i v UI,
 * kam se hesla neposílají.
 */
export function mailboxMissing(
  provider: MailboxProvider,
  config: Partial<MailboxConfig> | null | undefined,
  hasSecret: (key: SecretKey) => boolean = (k) => Boolean((config ?? {})[k]),
): string[] {
  const c = config ?? {};
  const missing: string[] = [];
  if (provider === "outlook") {
    if (!c.ms_graph_client_id) missing.push("Client ID");
    if (!c.ms_graph_tenant_id) missing.push("Tenant ID");
    if (!hasSecret("ms_graph_client_secret")) missing.push("Client Secret");
    return missing;
  }
  if (!c.imap_host) missing.push("příchozí server");
  if (!hasSecret("imap_password")) missing.push("heslo");
  return missing;
}

export interface ValidateInput {
  provider: MailboxProvider;
  email: string;
  config: MailboxConfig;
  /** Která hesla už jsou uložená (u úpravy). */
  stored?: Partial<Record<SecretKey, boolean>>;
}

/** Kontrola před uložením — vrací českou chybu, nebo null. */
export function validateMailboxConfig({ provider, email, config, stored = {} }: ValidateInput): string | null {
  const mail = normalizeEmail(email);
  if (!mail) return "Zadej e-mailovou adresu schránky.";
  if (!EMAIL_RE.test(mail)) return "Neplatná e-mailová adresa schránky.";
  const has = (k: SecretKey) => Boolean(config[k]) || Boolean(stored[k]);
  const preset = presetOf(provider, config);
  if (provider === "outlook") {
    const missing = mailboxMissing(provider, config, has);
    return missing.length ? `Microsoft 365 (Graph): doplň ${missing.join(", ")}.` : null;
  }
  if (!config.imap_host) return "Doplň příchozí server (např. mail.hosting90.cz) — nebo klikni na „Najít nastavení automaticky“.";
  if (!config.imap_port) return "Doplň port příchozího serveru (IMAP 993, POP3 995).";
  if (!has("imap_password")) return "Doplň heslo ke schránce.";
  const user = config.imap_user || mail;
  if ((preset === "hosting90" || preset === "gmail") && !user.includes("@")) {
    return `Uživatel musí být celá e-mailová adresa (např. ${mail}), ne jen „${user}“.`;
  }
  if (config.smtp_host && !config.smtp_port) return "Doplň port odchozího serveru (SMTP 465 nebo 587).";
  if (config.smtp_user && (preset === "hosting90" || preset === "gmail") && !config.smtp_user.includes("@")) {
    return `Uživatel SMTP musí být celá e-mailová adresa (např. ${mail}).`;
  }
  return null;
}

// ── Kandidáti pro automatické zjištění ──────────────────────
/** Je host jen alias vlastní domény (mail./imap./pop3./smtp.<doména>)? U hosting90 na něj nesedí certifikát. */
export function isOwnDomainAlias(host: string, email: string): boolean {
  const d = domainOf(email);
  const h = normalizeHost(host).host;
  return Boolean(d) && (h === d || (/^(mail|imap|imaps|pop|pop3|pop3s|smtp|posta|webmail)\./.test(h) && h.endsWith(`.${d}`)));
}

export interface CandidateInput {
  email: string;
  /** Zadaný příchozí server (volitelně), port a protokol. */
  host?: string;
  port?: number;
  protocol?: IncomingProtocol;
  tls?: TlsMode;
  smtpHost?: string;
  smtpPort?: number;
  smtpTls?: TlsMode;
}

export interface CandidateContext {
  preset: MailPreset | null;
  /** Poštovní servery z MX záznamu domény. */
  mxHosts?: string[];
}

function dedupe(list: MailEndpoint[]): MailEndpoint[] {
  const seen = new Set<string>();
  return list.filter((e) => {
    const k = `${e.protocol}:${e.host.toLowerCase()}:${e.port}:${e.tls}:${e.skipNameCheck ? 1 : 0}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

function forHost(protocol: MailProto, host: string, why: string, ports?: number[], tls?: TlsMode): MailEndpoint[] {
  const std: Record<MailProto, number[]> = { imap: [993, 143], pop3: [995, 110], smtp: [465, 587, 25] };
  const out: MailEndpoint[] = [];
  for (const port of ports ?? std[protocol]) {
    for (const mode of tls ? [tls] : tlsModesForPort(port)) out.push({ protocol, host, port, tls: mode, why });
  }
  return out;
}

/**
 * Kandidáti v pořadí priority: IMAP před POP3 (POP3 jen když IMAP nejde), ověřená jména
 * poskytovatele před odvozenými; zadaný server a port jako první volba uživatele.
 */
export function buildCandidates(input: CandidateInput, ctx: CandidateContext): { incoming: MailEndpoint[]; smtp: MailEndpoint[] } {
  const d = domainOf(input.email);
  const preset = ctx.preset;
  const known = Boolean(preset && (preset.imap.length || preset.pop3.length || preset.smtp.length));
  const entered = input.host ? normalizeHost(input.host).host : "";
  const enteredAlias = entered && preset?.id === "hosting90" && isOwnDomainAlias(entered, input.email);
  const enteredPort = input.port && Number.isInteger(input.port) ? input.port : undefined;
  const portProto = enteredPort ? protocolOfPort(enteredPort) : null;
  const imap: MailEndpoint[] = [];
  const pop3: MailEndpoint[] = [];
  const mx = (ctx.mxHosts ?? []).map((h) => normalizeHost(h).host).filter((h) => h && !/antispam|mx\d*\.|protection\.outlook|aspmx|google/.test(h));

  // 1) zadaný server (u hosting90 alias vlastní domény až za ověřenými jmény)
  const pushEntered = () => {
    if (!entered) return;
    const enteredProto: IncomingProtocol = input.protocol ?? (portProto === "pop3" ? "pop3" : "imap");
    if (enteredPort && portProto !== "smtp") {
      // zadaný port (POP3 port v IMAP poli přeložíme: 995 → 993, 110 → 143 — a POP3 zkusíme taky)
      (enteredProto === "pop3" ? pop3 : imap).push(...forHost(enteredProto, entered, "zadaný server a port", [enteredPort], input.tls));
    }
    imap.push(...forHost("imap", entered, "zadaný server"));
    pop3.push(...forHost("pop3", entered, "zadaný server"));
  };
  if (!enteredAlias) pushEntered();
  // 2) předvolba poskytovatele (ověřená jména serverů)
  if (preset) {
    imap.push(...preset.imap);
    pop3.push(...preset.pop3);
  }
  if (enteredAlias) pushEntered();
  // 3) odvozená jména (jen u neznámého poskytovatele — u hosting90 vedou imap./pop3. na web)
  if (!known && d) {
    imap.push(...forHost("imap", `mail.${d}`, `mail.${d}`), ...forHost("imap", `imap.${d}`, `imap.${d}`));
    pop3.push(...forHost("pop3", `mail.${d}`, `mail.${d}`), ...forHost("pop3", `pop3.${d}`, `pop3.${d}`), ...forHost("pop3", `pop.${d}`, `pop.${d}`));
    for (const h of mx.slice(0, 2)) {
      imap.push(...forHost("imap", h, "server z MX záznamu"));
      pop3.push(...forHost("pop3", h, "server z MX záznamu"));
    }
  }

  const smtp: MailEndpoint[] = [];
  const smtpEntered = input.smtpHost ? normalizeHost(input.smtpHost).host : "";
  if (smtpEntered) {
    if (input.smtpPort) smtp.push(...forHost("smtp", smtpEntered, "zadaný server a port", [input.smtpPort], input.smtpTls));
    smtp.push(...forHost("smtp", smtpEntered, "zadaný server"));
  }
  if (preset) smtp.push(...preset.smtp);
  if (!known && d) {
    smtp.push(...forHost("smtp", `smtp.${d}`, `smtp.${d}`), ...forHost("smtp", `mail.${d}`, `mail.${d}`));
  }
  if (entered && !enteredAlias && !known) smtp.push(...forHost("smtp", entered, "stejný server jako příchozí"));

  return { incoming: dedupe([...imap, ...pop3]).slice(0, 24), smtp: dedupe(smtp).slice(0, 12) };
}

/**
 * Jména serveru z certifikátu, která zkusit místo zadaného (nesedí-li jméno): přesná jména
 * a IP adresy; zástupné *.example.cz → <první část zadaného>.example.cz.
 */
export function certCandidateHosts(originalHost: string, certNames: string[]): string[] {
  const first = normalizeHost(originalHost).host.split(".")[0] || "mail";
  const out: string[] = [];
  for (const raw of certNames) {
    const n = raw.trim().toLowerCase().replace(/\.$/, "");
    if (!n) continue;
    if (n.startsWith("*.")) out.push(`${first}.${n.slice(2)}`);
    else out.push(n);
  }
  return [...new Set(out)].filter((h) => h !== normalizeHost(originalHost).host && isValidHost(h)).slice(0, 4);
}

/** SAN z certifikátu („DNS:a, IP Address:1.2.3.4") → seznam jmen. */
export function parseSubjectAltNames(san: string | undefined, cn?: string): string[] {
  const names = String(san ?? "")
    .split(",")
    .map((s) => s.trim())
    .map((s) => s.replace(/^(DNS|IP Address):/i, "").trim())
    .filter(Boolean);
  if (!names.length && cn) names.push(cn);
  return [...new Set(names.map((n) => n.toLowerCase()))];
}

// ── Detekce poskytovatele z DNS ─────────────────────────────
export const HOSTING90_RE = /(^|\.)hosting90\.(cz|net|sk|eu|com)\.?$/i;
const M365_RE = /\.mail\.protection\.outlook\.com\.?$/i;
const GOOGLE_RE = /(^|\.)(google|googlemail)\.com\.?$/i;

export interface DnsEvidence {
  mx: string[];
  ns: string[];
  /** IP adresy mail.<doména>. */
  mailIps?: string[];
  /** IP adresy mail.hosting90.cz. */
  hosting90Ips?: string[];
}

/** Poskytovatel podle DNS: MX hosting90 / M365 / Google, bez MX podle NS, nebo shoda IP mail.<doména> s mail.hosting90.cz. */
export function presetFromDns(ev: DnsEvidence): PresetId | null {
  if (ev.mx.some((h) => HOSTING90_RE.test(h))) return "hosting90";
  if (ev.mx.some((h) => M365_RE.test(h))) return "m365";
  if (ev.mx.some((h) => GOOGLE_RE.test(h))) return "gmail";
  const ips = new Set(ev.hosting90Ips ?? []);
  if ((ev.mailIps ?? []).some((ip) => ips.has(ip))) return "hosting90";
  if (!ev.mx.length && ev.ns.some((h) => HOSTING90_RE.test(h))) return "hosting90";
  return null;
}

// ── Chyby ───────────────────────────────────────────────────
export type MailErrorKind =
  | "dns" | "refused" | "timeout" | "greeting" | "tls_hostname" | "tls_untrusted" | "tls_protocol"
  | "no_starttls" | "auth" | "no_inbox" | "reset" | "graph_secret" | "graph_client" | "graph_tenant"
  | "graph_expired" | "graph_forbidden" | "graph_mailbox" | "other";

interface ErrLike {
  code?: string;
  message?: string;
  responseText?: string;
  response?: string;
  responseCode?: number;
  authenticationFailed?: boolean;
  serverResponseCode?: string;
  command?: string;
}

/** Příčina chyby z imapflow / nodemailer / node:net / node:tls / vlastního POP3 klienta. */
export function classifyMailError(err: unknown): MailErrorKind {
  const e = (err ?? {}) as ErrLike;
  const code = String(e.code ?? "");
  const msg = `${e.message ?? ""} ${e.responseText ?? ""} ${e.response ?? ""}`;
  if (code === "NO_INBOX" || e.serverResponseCode === "NONEXISTENT" || /\[NONEXISTENT\]|mailbox does not exist|no such mailbox/i.test(msg)) return "no_inbox";
  if (
    e.authenticationFailed || code === "EAUTH" || code === "AUTH" || e.responseCode === 535 || e.serverResponseCode === "AUTHENTICATIONFAILED" ||
    /AUTHENTICATIONFAILED|authentication failed|invalid credentials|LOGIN failed|Invalid login|\[AUTH\]|Username and Password not accepted|bad credentials/i.test(msg)
  ) return "auth";
  if (code === "NO_STARTTLS" || /does not support STARTTLS|STARTTLS.*not (supported|available)|Encryption required/i.test(msg)) return "no_starttls";
  if (code === "ENOTFOUND" || code === "EAI_AGAIN" || code === "EDNS" || code === "ENODATA" || /ENOTFOUND|EAI_AGAIN|getaddrinfo/.test(msg)) return "dns";
  if (code === "ECONNREFUSED" || /ECONNREFUSED/.test(msg)) return "refused";
  if (code === "ERR_TLS_CERT_ALTNAME_INVALID" || code === "TLS_HOSTNAME" || /does not match certificate's altnames|altnames|Hostname\/IP does not match/i.test(msg)) return "tls_hostname";
  if (
    /SELF_SIGNED|UNABLE_TO_VERIFY|CERT_HAS_EXPIRED|UNABLE_TO_GET_ISSUER|CERT_UNTRUSTED|TLS_UNTRUSTED/.test(code) ||
    /self[- ]signed|unable to verify|certificate has expired|unable to get local issuer/i.test(msg)
  ) return "tls_untrusted";
  if (code === "GREETING_TIMEOUT" || /Greeting never received|Failed to receive greeting|Invalid greeting|neposlal pozdrav/i.test(msg)) return "greeting";
  if (/^ERR_SSL_/.test(code) || code === "ETLS" || code === "EPROTO" || /wrong version number|packet length too long|unknown protocol|ssl3_get_record|tls_get_more_records|handshake failure/i.test(msg)) return "tls_protocol";
  if (code === "CONNECT_TIMEOUT" || code === "ETIMEDOUT" || code === "ETIMEOUT" || code === "TIMEOUT" || /timed? ?out|in required time|Connection timeout|časový limit/i.test(msg)) return "timeout";
  if (code === "ECONNRESET" || code === "EPIPE" || code === "NoConnection" || code === "ECONNECTION" || /ECONNRESET|socket hang up|Connection closed|unexpectedly closed/i.test(msg)) return "reset";
  return "other";
}

/** Krátký surový text ze serveru (bez stack trace) pro doplnění hlášky. */
export function rawErrorText(err: unknown): string {
  const e = (err ?? {}) as ErrLike;
  const txt = String(e.responseText || e.response || e.message || "").replace(/\s+/g, " ").trim();
  return txt.length > 200 ? `${txt.slice(0, 200)}…` : txt;
}

export interface DescribeContext {
  endpoint: Pick<MailEndpoint, "protocol" | "host" | "port" | "tls">;
  raw?: string;
  /** Doporučené jméno serveru (z certifikátu / poskytovatele). */
  suggestion?: string;
  certNames?: string[];
  user?: string;
}

/** Česká hláška s radou podle příčiny. */
export function describeMailError(kind: MailErrorKind, ctx: DescribeContext): string {
  const { endpoint: e } = ctx;
  const where = `${e.host}:${e.port}`;
  const proto = PROTO_LABEL[e.protocol];
  const isGmail = /gmail|google/.test(e.host);
  const isH90 = HOSTING90_RE.test(e.host);
  const fallbackHost = e.protocol === "smtp" ? HOSTING90_SMTP_HOST : HOSTING90_IMAP_HOST;
  switch (kind) {
    case "dns":
      return `Server „${e.host}“ neexistuje (DNS ho nezná) — zkontroluj název serveru. U hosting90 je to ${fallbackHost}.`;
    case "refused":
      return `Port ${e.port} na serveru ${e.host} je zavřený (spojení odmítnuto) — ${proto} bývá na portu ${e.protocol === "imap" ? "993 (SSL) nebo 143 (STARTTLS)" : e.protocol === "pop3" ? "995 (SSL) nebo 110 (STARTTLS)" : "465 (SSL) nebo 587 (STARTTLS)"}.`;
    case "timeout":
      return `Server ${where} neodpovídá (časový limit) — špatný server nebo port, případně spojení blokuje firewall.`;
    case "greeting":
      return `Server ${where} se neohlásil jako ${proto} — nesedí protokol nebo šifrování k portu (IMAP 993/143, POP3 995/110, SMTP 465/587).`;
    case "tls_hostname": {
      const names = ctx.certNames?.length ? ` (certifikát je vystavený na: ${ctx.certNames.slice(0, 3).join(", ")})` : "";
      const fix = ctx.suggestion;
      return (
        `Certifikát serveru nesedí na název ${e.host}${names}.` +
        (fix ? ` Použij správný název serveru poskytovatele: ${fix}.` : "") +
        (!isH90 && fix !== fallbackHost ? ` U hosting90 je správný server ${fallbackHost} (vlastní doména mail.<doména> SSL neumí).` : "")
      );
    }
    case "tls_untrusted":
      return `Certifikát serveru ${e.host} není důvěryhodný (vlastní podpis, vypršel, nebo neznámá certifikační autorita).`;
    case "tls_protocol":
      return `Na ${where} nesedí šifrování — port 993/995/465 je SSL/TLS, 143/110/587 STARTTLS.`;
    case "no_starttls":
      return `Server ${where} nenabízí šifrování STARTTLS — heslo nešifrovaně neposíláme. Zkus port ${e.protocol === "imap" ? 993 : e.protocol === "pop3" ? 995 : 465} (SSL/TLS).`;
    case "auth":
      return (
        `Přihlášení odmítnuto — server ${e.host} nepřijal uživatele nebo heslo${ctx.user ? ` (uživatel ${ctx.user})` : ""}. ` +
        (isGmail
          ? "Google vyžaduje heslo aplikace (ne běžné heslo k účtu)."
          : "Uživatel musí být CELÁ e-mailová adresa (např. jmeno@nastrojarstvi.com) a heslo je heslo ke schránce (u hosting90 z administrace schránky).") +
        (ctx.raw ? ` Odpověď serveru: „${ctx.raw}“.` : "")
      );
    case "no_inbox":
      return `Přihlášení proběhlo, ale složka INBOX (Doručená pošta) na serveru nebyla nalezena.`;
    case "reset":
      return `Server ${where} ukončil spojení — nejspíš nesedí protokol nebo šifrování k portu.`;
    case "graph_secret":
      return "Microsoft odmítl tajný klíč — vlož HODNOTU tajného klíče (Value), ne jeho ID (Secret ID).";
    case "graph_client":
      return "Client ID v tomto tenantu neexistuje — zkontroluj Application (client) ID.";
    case "graph_tenant":
      return "Špatný Tenant ID — zkontroluj Directory (tenant) ID.";
    case "graph_expired":
      return "Tajný klíč aplikace vypršel — vytvoř nový v Certifikáty a tajné kódy.";
    case "graph_forbidden":
      return "Chybí oprávnění Mail.Read (Application) nebo souhlas správce — Oprávnění API → Udělit souhlas správce.";
    case "graph_mailbox":
      return "Schránka v Microsoft 365 neexistuje — pošta je nejspíš u hosting90, zvol předvolbu hosting90.";
    default:
      return `${proto} ${where}: ${ctx.raw || "neznámá chyba"}`;
  }
}

/** Chyba Microsoft Graph / Entra ID (AADSTS kódy) → příčina. */
export function classifyGraphError(status: number, detail: string): MailErrorKind {
  if (/AADSTS7000215/.test(detail)) return "graph_secret";
  if (/AADSTS700016/.test(detail)) return "graph_client";
  if (/AADSTS90002|AADSTS900023|AADSTS90013/.test(detail)) return "graph_tenant";
  if (/AADSTS7000222/.test(detail)) return "graph_expired";
  if (status === 403 || /ErrorAccessDenied|Authorization_RequestDenied/.test(detail)) return "graph_forbidden";
  if (status === 404 || /ErrorInvalidUser|MailboxNotEnabledForRESTAPI|ResourceNotFound/.test(detail)) return "graph_mailbox";
  return "other";
}

// ── Výsledky diagnostiky (sdílené typy UI ↔ server) ─────────
export type DiagStepId = "dns" | "tcp" | "tls" | "login" | "inbox" | "token" | "graph_inbox";

export const STEP_LABEL: Record<DiagStepId, string> = {
  dns: "DNS",
  tcp: "Spojení",
  tls: "Šifrování",
  login: "Přihlášení",
  inbox: "Schránka INBOX",
  token: "Přihlášení aplikace",
  graph_inbox: "Doručená pošta",
};

export interface DiagStep {
  id: DiagStepId;
  ok: boolean;
  ms?: number;
  detail?: string;
}

export interface DiagResult {
  ok: boolean;
  endpoint?: MailEndpoint;
  steps: DiagStep[];
  kind?: MailErrorKind;
  error?: string;
  /** Počet zpráv v INBOXu (IMAP/POP3/Graph). */
  messages?: number;
  certNames?: string[];
}

export interface DetectAttempt {
  endpoint: MailEndpoint;
  ok: boolean;
  stage: "probe" | "login";
  kind?: MailErrorKind;
  message?: string;
  ms: number;
}

export interface DetectResult {
  ok: boolean;
  preset: PresetId | "test" | null;
  presetLabel?: string;
  evidence: string[];
  incoming?: MailEndpoint & { messages?: number };
  smtp?: MailEndpoint;
  attempts: DetectAttempt[];
  /** Fungovalo by jen bez ověření jména v certifikátu — čeká na výslovné potvrzení. */
  needsConfirmation?: { endpoint: MailEndpoint; certNames: string[]; smtp?: MailEndpoint };
  error?: string;
  smtpError?: string;
  /** Návrh konfigurace k uložení (bez hesla). */
  config?: MailboxConfig;
}

/** Konfigurace z nalezených serverů (pro uložení schránky). */
export function configFromDetection(
  base: MailboxConfig,
  incoming: MailEndpoint,
  smtp: MailEndpoint | undefined,
  preset: PresetId | "test" | null,
): MailboxConfig {
  const out: MailboxConfig = { ...base };
  out.incoming_protocol = incoming.protocol === "pop3" ? "pop3" : "imap";
  out.imap_host = incoming.host;
  out.imap_port = incoming.port;
  out.imap_tls = incoming.tls;
  if (incoming.skipNameCheck) out.imap_skip_name_check = true;
  else delete out.imap_skip_name_check;
  if (smtp) {
    out.smtp_host = smtp.host;
    out.smtp_port = smtp.port;
    out.smtp_tls = smtp.tls;
    if (smtp.skipNameCheck) out.smtp_skip_name_check = true;
    else delete out.smtp_skip_name_check;
  }
  if (preset && isPresetId(preset)) out.preset = preset;
  return out;
}

export function endpointLabel(e: Pick<MailEndpoint, "protocol" | "host" | "port" | "tls" | "skipNameCheck">): string {
  return `${PROTO_LABEL[e.protocol]} ${e.host}:${e.port} ${TLS_LABEL[e.tls]}${e.skipNameCheck ? " (bez ověření jména)" : ""}`;
}
