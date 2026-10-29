import "server-only";
import net from "node:net";
import tls from "node:tls";
import { promises as dnsp, Resolver } from "node:dns";
import type { ImapFlow } from "imapflow";
import { Pop3Client } from "@/lib/email/pop3";
import {
  authMethodOf, PRESETS, buildCandidates, certCandidateHosts, classifyGraphError, classifyMailError, configFromDetection,
  describeMailError, domainOf, isValidHost, parseSubjectAltNames, presetFromDns, rawErrorText, HOSTING90_IMAP_HOST,
  type DetectAttempt, type DetectResult, type DiagResult, type DiagStep, type IncomingProtocol, type MailEndpoint,
  type IncomingEndpoint, type MailErrorKind, type MailPreset, type MailProto, type PresetId, type ResolvedEndpoint, type TlsMode,
} from "@/lib/email/mail-config";
import type { MailboxConfig } from "@/lib/supabase/database.types";

/**
 * Síťová část nastavení schránky: postupná diagnostika (DNS → spojení → šifrování → přihlášení →
 * INBOX), přihlášení IMAP / POP3 / SMTP se správným šifrováním podle portu, krátké časové limity
 * (Vercel) a „Najít nastavení automaticky" — kandidáti se nejdřív paralelně ověří BEZ hesla
 * (jen spojení + certifikát), heslo dostane jen server s platným šifrováním; při odmítnutém hesle
 * se hned končí (opakované pokusy by u hosting90 mohly zablokovat IP).
 */

export interface NetOptions {
  /** Časový limit jednoho kroku (ms). */
  timeoutMs?: number;
  /** Vlastní CA (jen testy; v aplikaci NODE_EXTRA_CA_CERTS). */
  ca?: string | Buffer;
}

const DEFAULT_TIMEOUT = 8000;

function tlsIdentity(ep: Pick<MailEndpoint, "host" | "skipNameCheck">, ca?: string | Buffer): tls.ConnectionOptions {
  return {
    servername: net.isIP(ep.host) ? undefined : ep.host,
    minVersion: "TLSv1.2",
    ...(ca ? { ca: [ca] } : {}),
    // Ověřit vždy jméno ZADANÉHO serveru (i u IP adresy); bez ověření jména jen po výslovném souhlasu
    checkServerIdentity: (_h: string, cert: tls.PeerCertificate) => (ep.skipNameCheck ? undefined : tls.checkServerIdentity(ep.host, cert)),
  };
}

function withTimeout<T>(p: Promise<T>, ms: number, code: string, message: string): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  return Promise.race([
    p,
    new Promise<T>((_, reject) => {
      timer = setTimeout(() => reject(Object.assign(new Error(message), { code })), ms);
    }),
  ]).finally(() => clearTimeout(timer));
}

// ── Sonda bez hesla: DNS → TCP → TLS (+ pozdrav, STARTTLS) ──
export interface ProbeResult {
  endpoint: MailEndpoint;
  ok: boolean;
  steps: DiagStep[];
  kind?: MailErrorKind;
  error?: string;
  certNames?: string[];
  /** Řetěz certifikátu je důvěryhodný (nesedí nanejvýš jméno). */
  chainOk?: boolean;
  nameOk?: boolean;
  ms: number;
}

const GREETING_OK: Record<MailProto, RegExp> = { imap: /^\* (OK|PREAUTH)/i, pop3: /^\+OK/, smtp: /^220[ -]/ };

function readLine(socket: net.Socket | tls.TLSSocket, ms: number, multiSmtp = false): Promise<string> {
  return new Promise((resolve, reject) => {
    let buf = "";
    const timer = setTimeout(() => done(Object.assign(new Error("Server neposlal pozdrav (časový limit)."), { code: "GREETING_TIMEOUT" })), ms);
    const onData = (d: Buffer) => {
      buf += d.toString("latin1");
      const lines = buf.split("\r\n");
      if (lines.length < 2) return;
      if (multiSmtp) {
        const last = lines.slice(0, -1).find((l) => /^\d{3} /.test(l));
        if (!last) return;
        return done(null, last);
      }
      done(null, lines[0]);
    };
    const onErr = (err: Error) => done(err);
    const onClose = () => done(Object.assign(new Error("Server ukončil spojení."), { code: "ECONNRESET" }));
    function done(err: Error | null, line?: string) {
      clearTimeout(timer);
      socket.off("data", onData);
      socket.off("error", onErr);
      socket.off("close", onClose);
      if (err) reject(err);
      else resolve(line ?? "");
    }
    socket.on("data", onData);
    socket.once("error", onErr);
    socket.once("close", onClose);
  });
}

function tlsHandshake(opts: tls.ConnectionOptions, ms: number): Promise<tls.TLSSocket> {
  return new Promise((resolve, reject) => {
    const s = tls.connect({ ...opts, rejectUnauthorized: false }, () => {
      clearTimeout(timer);
      resolve(s);
    });
    const timer = setTimeout(() => {
      s.destroy();
      reject(Object.assign(new Error("Šifrované spojení se nenavázalo (časový limit)."), { code: "TIMEOUT" }));
    }, ms);
    s.once("error", (err) => {
      clearTimeout(timer);
      reject(err);
    });
  });
}

/** Ověří server BEZ hesla: překlad jména, spojení, šifrování a certifikát, pozdrav protokolu. */
export async function probeEndpoint(ep: MailEndpoint, opts: NetOptions = {}): Promise<ProbeResult> {
  const t0 = Date.now();
  const ms = opts.timeoutMs ?? DEFAULT_TIMEOUT;
  const steps: DiagStep[] = [];
  const fail = (kind: MailErrorKind, err: unknown, extra: Partial<ProbeResult> = {}): ProbeResult => ({
    endpoint: ep,
    ok: false,
    steps,
    kind,
    error: describeMailError(kind, { endpoint: ep, raw: rawErrorText(err), certNames: extra.certNames }),
    ms: Date.now() - t0,
    ...extra,
  });

  // 1) DNS
  let address = ep.host;
  const s0 = Date.now();
  if (!net.isIP(ep.host)) {
    if (!isValidHost(ep.host)) {
      steps.push({ id: "dns", ok: false, detail: "neplatný název serveru" });
      return fail("dns", { code: "ENOTFOUND" });
    }
    try {
      const res = await withTimeout(dnsp.lookup(ep.host, { all: true }), Math.min(ms, 5000), "EAI_AGAIN", "DNS neodpovědělo");
      address = res[0]?.address ?? ep.host;
      steps.push({ id: "dns", ok: true, ms: Date.now() - s0, detail: res.map((r) => r.address).slice(0, 2).join(", ") });
    } catch (err) {
      steps.push({ id: "dns", ok: false, ms: Date.now() - s0, detail: "server neexistuje" });
      return fail("dns", err);
    }
  } else steps.push({ id: "dns", ok: true, ms: 0, detail: "IP adresa" });

  // 2) TCP
  const s1 = Date.now();
  let socket: net.Socket;
  try {
    socket = await new Promise<net.Socket>((resolve, reject) => {
      const s = net.connect({ host: address, port: ep.port });
      const timer = setTimeout(() => {
        s.destroy();
        reject(Object.assign(new Error("Spojení se nenavázalo (časový limit)."), { code: "CONNECT_TIMEOUT" }));
      }, ms);
      s.once("connect", () => { clearTimeout(timer); resolve(s); });
      s.once("error", (err) => { clearTimeout(timer); reject(err); });
    });
    steps.push({ id: "tcp", ok: true, ms: Date.now() - s1, detail: `${address}:${ep.port}` });
  } catch (err) {
    const kind = classifyMailError(err);
    steps.push({ id: "tcp", ok: false, ms: Date.now() - s1, detail: kind === "refused" ? "port zavřený" : "neodpovídá" });
    return fail(kind === "dns" ? "dns" : kind === "refused" ? "refused" : "timeout", err);
  }

  // 3) TLS (přímo, nebo po pozdravu + STARTTLS)
  const s2 = Date.now();
  if (ep.tls === "none") {
    // „Žádné" (Outlook): jen pozdrav; STARTTLS použije až odeslání, nabídne-li ho server
    try {
      const greet = await readLine(socket, ms, ep.protocol === "smtp");
      socket.destroy();
      if (!GREETING_OK[ep.protocol].test(greet)) {
        steps.push({ id: "tls", ok: false, ms: Date.now() - s2, detail: `server není ${ep.protocol.toUpperCase()}` });
        return fail("greeting", { message: greet.slice(0, 80) });
      }
    } catch (err) {
      socket.destroy();
      steps.push({ id: "tls", ok: false, ms: Date.now() - s2, detail: "bez pozdravu" });
      return fail("greeting", err);
    }
    steps.push({ id: "tls", ok: true, ms: Date.now() - s2, detail: "bez SSL — STARTTLS, nabídne-li ho server (jako Outlook „Žádné“)" });
    return { endpoint: ep, ok: true, steps, ms: Date.now() - t0 };
  }
  let secure: tls.TLSSocket | null = null;
  try {
    if (ep.tls === "starttls") {
      const greet = await readLine(socket, ms, ep.protocol === "smtp");
      if (!GREETING_OK[ep.protocol].test(greet)) {
        steps.push({ id: "tls", ok: false, ms: Date.now() - s2, detail: `server není ${ep.protocol.toUpperCase()}` });
        socket.destroy();
        return fail("greeting", { message: greet.slice(0, 80) });
      }
      let ok: boolean;
      if (ep.protocol === "imap") {
        socket.write("a1 STARTTLS\r\n");
        let line = await readLine(socket, ms);
        while (line.startsWith("*")) line = await readLine(socket, ms);
        ok = /^a1 OK/i.test(line);
      } else if (ep.protocol === "pop3") {
        socket.write("STLS\r\n");
        ok = /^\+OK/.test(await readLine(socket, ms));
      } else {
        socket.write("EHLO mnastrojarna-center\r\n");
        await readLine(socket, ms, true);
        socket.write("STARTTLS\r\n");
        ok = /^220/.test(await readLine(socket, ms, true));
      }
      if (!ok) {
        steps.push({ id: "tls", ok: false, ms: Date.now() - s2, detail: "STARTTLS nenabízí" });
        socket.destroy();
        return fail("no_starttls", { code: "NO_STARTTLS" });
      }
      socket.removeAllListeners("data");
      secure = await tlsHandshake({ socket, ...tlsIdentity(ep, opts.ca), checkServerIdentity: () => undefined }, ms);
    } else {
      // řetěz certifikátu a jméno hodnotíme zvlášť (kvůli radě „použij jméno z certifikátu")
      secure = await tlsHandshake({ socket, ...tlsIdentity(ep, opts.ca), checkServerIdentity: () => undefined }, ms);
    }
  } catch (err) {
    socket.destroy();
    const kind = classifyMailError(err);
    steps.push({ id: "tls", ok: false, ms: Date.now() - s2, detail: kind === "greeting" ? "bez pozdravu" : "šifrování selhalo" });
    return fail(kind === "other" || kind === "reset" ? "tls_protocol" : kind, err);
  }

  const cert = secure.getPeerCertificate();
  const certNames = parseSubjectAltNames(cert?.subjectaltname, cert?.subject?.CN as string | undefined);
  const chainOk = secure.authorized;
  const nameErr = cert && Object.keys(cert).length ? tls.checkServerIdentity(ep.host, cert) : new Error("bez certifikátu");
  const nameOk = !nameErr;
  const proto = secure.getProtocol() ?? "TLS";

  // pozdrav až po TLS (přímé TLS) — pozná i POP3 server na IMAP portu
  if (ep.tls === "tls" && chainOk && (nameOk || ep.skipNameCheck)) {
    try {
      const greet = await readLine(secure, ms, ep.protocol === "smtp");
      if (!GREETING_OK[ep.protocol].test(greet)) {
        secure.destroy();
        steps.push({ id: "tls", ok: false, ms: Date.now() - s2, detail: `${proto}, ale server není ${ep.protocol.toUpperCase()}` });
        return fail("greeting", { message: greet.slice(0, 80) }, { certNames, chainOk, nameOk });
      }
    } catch (err) {
      secure.destroy();
      steps.push({ id: "tls", ok: false, ms: Date.now() - s2, detail: `${proto}, bez pozdravu` });
      return fail("greeting", err, { certNames, chainOk, nameOk });
    }
  }
  secure.destroy();

  if (!chainOk) {
    steps.push({ id: "tls", ok: false, ms: Date.now() - s2, detail: `certifikát nedůvěryhodný (${secure.authorizationError ?? "?"})` });
    return fail("tls_untrusted", { code: String(secure.authorizationError ?? "TLS_UNTRUSTED") }, { certNames, chainOk, nameOk });
  }
  if (!nameOk && !ep.skipNameCheck) {
    steps.push({ id: "tls", ok: false, ms: Date.now() - s2, detail: `certifikát je pro: ${certNames.slice(0, 3).join(", ")}` });
    return fail("tls_hostname", nameErr, { certNames, chainOk, nameOk });
  }
  steps.push({
    id: "tls",
    ok: true,
    ms: Date.now() - s2,
    detail: `${proto} ${ep.tls === "starttls" ? "STARTTLS" : "SSL/TLS"}${nameOk ? ", certifikát OK" : ", BEZ ověření jména v certifikátu"}`,
  });
  return { endpoint: ep, ok: true, steps, certNames, chainOk, nameOk, ms: Date.now() - t0 };
}

// ── Přihlášení ──────────────────────────────────────────────
export interface Credentials {
  user: string;
  pass: string;
  /** Jen SMTP: vynutit mechanismus AUTH (PLAIN / LOGIN); bez něj první nabízený serverem. */
  method?: "PLAIN" | "LOGIN";
}

export function imapOptions(ep: MailEndpoint, auth: Credentials, opts: NetOptions = {}) {
  const ms = opts.timeoutMs ?? DEFAULT_TIMEOUT;
  return {
    host: ep.host,
    port: ep.port,
    secure: ep.tls === "tls",
    doSTARTTLS: ep.tls === "starttls" ? true : undefined, // STARTTLS povinně — heslo nikdy nešifrovaně
    servername: net.isIP(ep.host) ? undefined : ep.host,
    auth,
    logger: false as const,
    connectionTimeout: ms,
    greetingTimeout: ms,
    socketTimeout: 60_000,
    disableAutoIdle: true,
    tls: tlsIdentity(ep, opts.ca),
  };
}

/** Přihlášení IMAP + počet zpráv v INBOXu. `keepOpen` vrátí otevřeného klienta (stahování). */
export async function imapLogin(
  ep: MailEndpoint,
  auth: Credentials,
  opts: NetOptions & { keepOpen?: boolean } = {},
): Promise<{ messages: number; client?: ImapFlow }> {
  const { ImapFlow } = await import("imapflow");
  const client = new ImapFlow(imapOptions(ep, auth, opts));
  client.on("error", () => {}); // bez posluchače by pozdější „error" shodil proces
  try {
    await client.connect();
    let messages = 0;
    try {
      const st = await client.status("INBOX", { messages: true });
      messages = st.messages ?? 0;
    } catch (err) {
      throw Object.assign(new Error(rawErrorText(err) || "INBOX nenalezen"), { code: "NO_INBOX" });
    }
    if (opts.keepOpen) return { messages, client };
    await client.logout().catch(() => client.close());
    return { messages };
  } catch (err) {
    try { client.close(); } catch { /* už zavřeno */ }
    throw err;
  }
}

export async function pop3Login(
  ep: MailEndpoint,
  auth: Credentials,
  opts: NetOptions & { keepOpen?: boolean } = {},
): Promise<{ messages: number; client?: Pop3Client }> {
  const client = await Pop3Client.connect({
    host: ep.host,
    port: ep.port,
    tls: ep.tls === "tls" ? "tls" : "starttls", // příchozí pošta vždy šifrovaně
    checkName: ep.skipNameCheck ? false : ep.host,
    ca: opts.ca,
    timeoutMs: opts.timeoutMs ?? DEFAULT_TIMEOUT,
  });
  try {
    await client.login(auth.user, auth.pass);
    const { count } = await client.stat();
    if (opts.keepOpen) return { messages: count, client };
    await client.quit();
    return { messages: count };
  } catch (err) {
    client.close();
    throw err;
  }
}

/**
 * SMTP transport: 465 SSL/TLS, STARTTLS povinně, nebo „bez SSL" (jen výslovná volba — Outlook
 * „Žádné"): STARTTLS se použije, když ho server nabídne; certifikát se pak neověřuje (uživatel
 * šifrování nepožadoval — i tak je to lepší než heslo úplně nešifrovaně).
 */
export async function smtpTransport(ep: MailEndpoint, auth: Credentials, opts: NetOptions = {}) {
  const nodemailer = (await import("nodemailer")).default;
  const ms = opts.timeoutMs ?? 10_000;
  const plain = ep.tls === "none";
  return nodemailer.createTransport({
    host: ep.host,
    port: ep.port,
    secure: ep.tls === "tls",
    requireTLS: ep.tls === "starttls", // STARTTLS povinně — heslo nikdy nešifrovaně
    // forceAuth: po nepovedeném STARTTLS nodemailer nezná nabídku AUTH z EHLO a přihlášení by vynechal (→ 530)
    ...(plain ? { opportunisticTLS: true, forceAuth: true } : {}),
    auth: { user: auth.user, pass: auth.pass, ...(auth.method ? { method: auth.method } : {}) },
    ...(auth.method ? { authMethod: auth.method } : {}),
    connectionTimeout: ms,
    greetingTimeout: ms,
    socketTimeout: 30_000,
    tls: plain ? { ...tlsIdentity(ep, opts.ca), rejectUnauthorized: false, checkServerIdentity: () => undefined } : tlsIdentity(ep, opts.ca),
  });
}

export async function smtpLogin(ep: MailEndpoint, auth: Credentials, opts: NetOptions = {}): Promise<void> {
  const transport = await smtpTransport(ep, auth, opts);
  try {
    await transport.verify();
  } finally {
    transport.close();
  }
}

async function loginAny(ep: MailEndpoint, auth: Credentials, opts: NetOptions): Promise<number | undefined> {
  if (ep.protocol === "imap") return (await imapLogin(ep, auth, opts)).messages;
  if (ep.protocol === "pop3") return (await pop3Login(ep, auth, opts)).messages;
  await smtpLogin(ep, auth, opts);
  return undefined;
}

// ── Test připojení po krocích ───────────────────────────────
/** Diagnostika jednoho serveru: DNS → spojení → šifrování → přihlášení → INBOX (+ počet zpráv). */
export async function diagnoseEndpoint(ep: ResolvedEndpoint & { authMethod?: Credentials["method"] }, opts: NetOptions = {}): Promise<DiagResult> {
  const endpoint: MailEndpoint = { protocol: ep.protocol, host: ep.host, port: ep.port, tls: ep.tls, skipNameCheck: ep.skipNameCheck };
  const probe = await probeEndpoint(endpoint, opts);
  const steps = [...probe.steps];
  if (!probe.ok) {
    let suggestion: string | undefined;
    if (probe.kind === "tls_hostname" && probe.certNames?.length) {
      // jméno z certifikátu, které jde přeložit (zástupné / interní názvy přeskočit)
      const names = certCandidateHosts(ep.host, probe.certNames);
      for (const n of names) {
        const ok = net.isIP(n) || (await withTimeout(dnsp.lookup(n), 2000, "ETIMEOUT", "DNS").then(() => true, () => false));
        if (ok) { suggestion = n; break; }
      }
      suggestion ??= names[0];
    }
    const error = probe.kind
      ? describeMailError(probe.kind, { endpoint, certNames: probe.certNames, suggestion, raw: probe.kind === "other" ? probe.error : undefined })
      : probe.error;
    return { ok: false, endpoint, steps, kind: probe.kind, error, certNames: probe.certNames };
  }
  const t = Date.now();
  try {
    const messages = await loginAny(endpoint, { user: ep.user, pass: ep.password, ...(ep.authMethod ? { method: ep.authMethod } : {}) }, opts);
    steps.push({ id: "login", ok: true, ms: Date.now() - t, detail: ep.user });
    if (ep.protocol !== "smtp") steps.push({ id: "inbox", ok: true, detail: `${messages ?? 0} zpráv` });
    return { ok: true, endpoint, steps, messages, certNames: probe.certNames };
  } catch (err) {
    const kind = classifyMailError(err);
    if (kind === "no_inbox") {
      steps.push({ id: "login", ok: true, ms: Date.now() - t, detail: ep.user });
      steps.push({ id: "inbox", ok: false, detail: "INBOX nenalezen" });
    } else steps.push({ id: "login", ok: false, ms: Date.now() - t, detail: kind === "auth" ? "odmítnuto" : "selhalo" });
    return {
      ok: false,
      endpoint,
      steps,
      kind,
      error: describeMailError(kind, { endpoint, raw: rawErrorText(err), user: ep.user }),
      certNames: probe.certNames,
      ...(ep.protocol === "smtp" ? { authMethod: authMethodOf(err) ?? ep.authMethod } : {}),
    };
  }
}

// ── Microsoft Graph ─────────────────────────────────────────
async function graphDetail(res: Response): Promise<string> {
  try {
    const j = (await res.json()) as { error_description?: string; error?: { code?: string; message?: string } | string };
    if (j.error_description) return j.error_description.split(/\r?\n/)[0];
    if (typeof j.error === "object" && j.error) return `${j.error.code ?? ""} ${j.error.message ?? ""}`.trim();
    return typeof j.error === "string" ? j.error : "";
  } catch {
    return "";
  }
}

export async function graphError(res: Response, what: string): Promise<Error & { kind: MailErrorKind }> {
  const detail = await graphDetail(res);
  const kind = classifyGraphError(res.status, detail);
  const hint = kind === "other" ? "" : ` — ${describeMailError(kind, { endpoint: { protocol: "imap", host: "graph.microsoft.com", port: 443, tls: "tls" } })}`;
  return Object.assign(new Error(`${what} (HTTP ${res.status})${detail ? `: ${detail}` : ""}${hint}`), { kind });
}

export async function graphToken(cfg: { clientId: string; clientSecret: string; tenantId: string }, timeoutMs = 10_000): Promise<string> {
  const params = new URLSearchParams({
    client_id: cfg.clientId,
    client_secret: cfg.clientSecret,
    scope: "https://graph.microsoft.com/.default",
    grant_type: "client_credentials",
  });
  const res = await fetch(`https://login.microsoftonline.com/${encodeURIComponent(cfg.tenantId)}/oauth2/v2.0/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: params,
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!res.ok) throw await graphError(res, "Microsoft odmítl přihlášení aplikace");
  const data = (await res.json()) as { access_token?: string };
  if (!data.access_token) throw new Error("Microsoft nevrátil přístupový token.");
  return data.access_token;
}

export async function diagnoseGraph(cfg: MailboxConfig, email: string): Promise<DiagResult> {
  const steps: DiagStep[] = [];
  const t = Date.now();
  let token: string;
  try {
    token = await graphToken({ clientId: cfg.ms_graph_client_id!, clientSecret: cfg.ms_graph_client_secret!, tenantId: cfg.ms_graph_tenant_id! });
    steps.push({ id: "token", ok: true, ms: Date.now() - t });
  } catch (err) {
    steps.push({ id: "token", ok: false, ms: Date.now() - t });
    return { ok: false, steps, kind: (err as { kind?: MailErrorKind }).kind ?? classifyMailError(err), error: err instanceof Error ? err.message : "Graph chyba" };
  }
  const t2 = Date.now();
  try {
    const res = await fetch(
      `https://graph.microsoft.com/v1.0/users/${encodeURIComponent(email)}/mailFolders/inbox?$select=totalItemCount`,
      { headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(10_000) },
    );
    if (!res.ok) throw await graphError(res, "Doručená pošta není dostupná");
    const j = (await res.json()) as { totalItemCount?: number };
    steps.push({ id: "graph_inbox", ok: true, ms: Date.now() - t2, detail: `${j.totalItemCount ?? 0} zpráv` });
    return { ok: true, steps, messages: j.totalItemCount ?? 0 };
  } catch (err) {
    steps.push({ id: "graph_inbox", ok: false, ms: Date.now() - t2 });
    return { ok: false, steps, kind: (err as { kind?: MailErrorKind }).kind ?? classifyMailError(err), error: err instanceof Error ? err.message : "Graph chyba" };
  }
}

// ── Poskytovatel podle domény ───────────────────────────────
interface TestProvider {
  domains: string[];
  label?: string;
  imap?: Omit<MailEndpoint, "protocol">[];
  pop3?: Omit<MailEndpoint, "protocol">[];
  smtp?: Omit<MailEndpoint, "protocol">[];
}

/** Testovací poskytovatelé (E2E): MAIL_TEST_PROVIDERS='[{"domains":["x.test"],"imap":[…]}]'. V produkci nenastaveno. */
function testPreset(domain: string): MailPreset | null {
  const raw = process.env.MAIL_TEST_PROVIDERS;
  if (!raw) return null;
  try {
    const list = JSON.parse(raw) as TestProvider[];
    const hit = list.find((p) => p.domains?.map((d) => d.toLowerCase()).includes(domain));
    if (!hit) return null;
    const map = (proto: MailProto, l?: Omit<MailEndpoint, "protocol">[]) =>
      (l ?? []).map((e) => ({ protocol: proto, host: e.host, port: Number(e.port), tls: e.tls as TlsMode, why: e.why ?? `${hit.label ?? "testovací poskytovatel"}` }));
    return {
      id: "test",
      label: hit.label ?? "Testovací poskytovatel",
      description: "E2E",
      imap: map("imap", hit.imap),
      pop3: map("pop3", hit.pop3),
      smtp: map("smtp", hit.smtp),
      loginIsEmail: true,
      notes: [],
    };
  } catch {
    return null;
  }
}

export interface DetectedProvider {
  id: PresetId | "test" | null;
  preset: MailPreset | null;
  evidence: string[];
  mxHosts: string[];
}

/** Poskytovatel pošty domény podle MX / NS / IP (DNS funguje i na Vercelu). */
export async function detectProvider(email: string, timeoutMs = 3000): Promise<DetectedProvider> {
  const domain = domainOf(email);
  if (!domain) return { id: null, preset: null, evidence: [], mxHosts: [] };
  const test = testPreset(domain);
  if (test) return { id: "test", preset: test, evidence: [`testovací poskytovatel pro ${domain}`], mxHosts: [] };
  const resolver = new Resolver({ timeout: Math.min(timeoutMs, 2500), tries: 1 });
  const cap = <T>(p: Promise<T>) => withTimeout(p, timeoutMs, "ETIMEOUT", "DNS timeout");
  const [mx, ns, mailA, h90A] = await Promise.allSettled([
    cap(new Promise<{ exchange: string; priority: number }[]>((res, rej) => resolver.resolveMx(domain, (e, v) => (e ? rej(e) : res(v))))),
    cap(new Promise<string[]>((res, rej) => resolver.resolveNs(domain, (e, v) => (e ? rej(e) : res(v))))),
    cap(dnsp.lookup(`mail.${domain}`, { all: true })),
    cap(dnsp.lookup(HOSTING90_IMAP_HOST, { all: true })),
  ]);
  const mxHosts = mx.status === "fulfilled" ? mx.value.sort((a, b) => a.priority - b.priority).map((m) => m.exchange) : [];
  const nsHosts = ns.status === "fulfilled" ? ns.value : [];
  const mailIps = mailA.status === "fulfilled" ? mailA.value.map((a) => a.address) : [];
  const h90Ips = h90A.status === "fulfilled" ? h90A.value.map((a) => a.address) : [];
  const evidence: string[] = [];
  if (mxHosts.length) evidence.push(`MX ${domain}: ${mxHosts.join(", ")}`);
  if (nsHosts.length) evidence.push(`NS ${domain}: ${nsHosts.join(", ")}`);
  if (mailIps.length) evidence.push(`mail.${domain} → ${mailIps.join(", ")}${mailIps.some((ip) => h90Ips.includes(ip)) ? " (= mail.hosting90.cz)" : ""}`);
  const id = presetFromDns({ mx: mxHosts, ns: nsHosts, mailIps, hosting90Ips: h90Ips });
  return { id, preset: id ? PRESETS[id] : null, evidence, mxHosts };
}

// ── Najít nastavení automaticky ─────────────────────────────
export interface DetectInput {
  email: string;
  password: string;
  /** Volitelně zadaný server / port / protokol (např. z Outlooku). */
  host?: string;
  port?: number;
  protocol?: IncomingProtocol;
  smtpHost?: string;
  smtpPort?: number;
  /** Šifrování zadaného odchozího serveru (ručně; `none` = Outlook „Žádné"). */
  smtpTls?: TlsMode;
  /** Jiné uživatelské jméno než e-mail (výjimečně). */
  user?: string;
  /** Uživatel výslovně potvrdil šifrované spojení bez ověření jména v certifikátu. */
  allowNameMismatch?: boolean;
  /** Předvolba zvolená v UI — použije se, když ji DNS nepotvrdí (např. DNS nedostupné). */
  preset?: PresetId;
}

export interface DetectOptions extends NetOptions {
  /** Celkový čas (ms) — drž pod maxDuration route. */
  budgetMs?: number;
  loginTimeoutMs?: number;
}

async function mapLimit<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let i = 0;
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, async () => {
      while (i < items.length) {
        const idx = i++;
        out[idx] = await fn(items[idx]);
      }
    }),
  );
  return out;
}

const keyOf = (e: MailEndpoint) => `${e.protocol}:${e.host}:${e.port}:${e.tls}`;

/**
 * Vyzkouší kandidáty a vrátí první fungující kombinaci příchozího (IMAP, jinak POP3) a odchozího
 * (SMTP) serveru + tabulku pokusů. Heslo jde jen na servery s platným šifrováním.
 */
export async function detectMailSettings(input: DetectInput, opts: DetectOptions = {}): Promise<DetectResult> {
  const t0 = Date.now();
  const budget = opts.budgetMs ?? 40_000;
  const left = () => budget - (Date.now() - t0);
  const probeMs = Math.min(opts.timeoutMs ?? 6000, 6000);
  const loginMs = opts.loginTimeoutMs ?? 10_000;
  const netOpts: NetOptions = { ca: opts.ca };
  const attempts: DetectAttempt[] = [];
  const auth: Credentials = { user: (input.user || input.email).trim().toLowerCase(), pass: input.password };

  const detected = await detectProvider(input.email);
  const hinted = !detected.preset && (input.preset === "hosting90" || input.preset === "gmail");
  const provider: DetectedProvider = hinted
    ? { ...detected, id: input.preset!, preset: PRESETS[input.preset!], evidence: [...detected.evidence, `zvolená předvolba ${PRESETS[input.preset!].label}`] }
    : detected;
  const base: DetectResult = { ok: false, preset: provider.id, presetLabel: provider.preset?.label, evidence: provider.evidence, attempts };
  if (provider.id === "m365" && !input.host) {
    return { ...base, error: "Doména používá Microsoft 365 — IMAP s heslem je tam vypnutý. Zvol předvolbu „Microsoft 365 (Graph)“ a vyplň Client ID, Tenant ID a tajný klíč." };
  }

  const cands = buildCandidates(
    { email: input.email, host: input.host, port: input.port, protocol: input.protocol, smtpHost: input.smtpHost, smtpPort: input.smtpPort, smtpTls: input.smtpTls },
    { preset: provider.preset, mxHosts: provider.mxHosts },
  );

  // 1) sondy bez hesla — paralelně
  const probes = new Map<string, ProbeResult>();
  const runProbes = async (list: MailEndpoint[]) => {
    const todo = list.filter((e) => !probes.has(keyOf(e)));
    const res = await mapLimit(todo, 16, (e) => probeEndpoint(e, { ...netOpts, timeoutMs: Math.max(1500, Math.min(probeMs, left() - 2000)) }));
    for (const r of res) {
      probes.set(keyOf(r.endpoint), r);
      attempts.push({ endpoint: r.endpoint, ok: r.ok, stage: "probe", kind: r.kind, message: r.ok ? r.steps.at(-1)?.detail : r.error, ms: r.ms });
    }
  };
  await runProbes([...cands.incoming, ...cands.smtp]);

  // 2) nesedí jméno v certifikátu → nejdřív jména z certifikátu (a ověřená jména poskytovatele)
  const expand = (list: MailEndpoint[]): MailEndpoint[] => {
    const out: MailEndpoint[] = [];
    for (const e of list) {
      out.push(e);
      const p = probes.get(keyOf(e));
      if (p?.kind === "tls_hostname" && p.chainOk && p.certNames?.length) {
        for (const host of certCandidateHosts(e.host, p.certNames)) out.push({ ...e, host, why: `jméno z certifikátu serveru ${e.host}` });
      }
    }
    const seen = new Set<string>();
    return out.filter((e) => (seen.has(keyOf(e)) ? false : (seen.add(keyOf(e)), true)));
  };
  const incoming = expand(cands.incoming);
  const smtp = expand(cands.smtp);
  if (left() > 6000) await runProbes([...incoming, ...smtp]);

  const passing = (list: MailEndpoint[]) => list.filter((e) => probes.get(keyOf(e))?.ok);
  const mismatchOnly = (list: MailEndpoint[]) =>
    list.filter((e) => {
      const p = probes.get(keyOf(e));
      return p && !p.ok && p.kind === "tls_hostname" && p.chainOk;
    });

  // 3) přihlášení — v pořadí priority, při odmítnutém hesle konec
  type LoginOutcome = { endpoint: MailEndpoint; messages?: number } | { authError: string } | null;
  const tryLogin = async (list: MailEndpoint[], max: number): Promise<LoginOutcome> => {
    let n = 0;
    for (const e of list) {
      if (n >= max || left() < 3000) break;
      n++;
      const t = Date.now();
      try {
        const messages = await loginAny(e, auth, { ...netOpts, timeoutMs: Math.min(loginMs, left() - 1000) });
        attempts.push({ endpoint: e, ok: true, stage: "login", message: messages !== undefined ? `přihlášeno, ${messages} zpráv` : "přihlášeno", ms: Date.now() - t });
        return { endpoint: e, messages };
      } catch (err) {
        const kind = classifyMailError(err);
        const message = describeMailError(kind, { endpoint: e, raw: rawErrorText(err), user: auth.user });
        attempts.push({ endpoint: e, ok: false, stage: "login", kind, message, ms: Date.now() - t });
        if (kind === "auth") return { authError: message };
      }
    }
    return null;
  };

  let inc = await tryLogin(passing(incoming), 4);
  const confirm: { endpoint?: MailEndpoint; smtp?: MailEndpoint; certNames: string[] } = { certNames: [] };
  if (!inc || !("endpoint" in inc)) {
    const mm = mismatchOnly(incoming)[0];
    if (!inc && mm) {
      const names = probes.get(keyOf(mm))?.certNames ?? [];
      if (input.allowNameMismatch) inc = await tryLogin([{ ...mm, skipNameCheck: true, why: "bez ověření jména (potvrzeno)" }], 1);
      else {
        confirm.endpoint = { ...mm, skipNameCheck: true };
        confirm.certNames = names;
      }
    }
  }
  if (inc && "authError" in inc) {
    return { ...base, error: inc.authError };
  }

  let out: { endpoint: MailEndpoint } | null = null;
  let smtpError: string | undefined;
  const smtpRes = await tryLogin(passing(smtp), 3);
  if (smtpRes && "endpoint" in smtpRes) out = { endpoint: smtpRes.endpoint };
  else if (smtpRes && "authError" in smtpRes) smtpError = smtpRes.authError;
  else {
    const mm = mismatchOnly(smtp)[0];
    if (mm) {
      if (input.allowNameMismatch) {
        const r = await tryLogin([{ ...mm, skipNameCheck: true, why: "bez ověření jména (potvrzeno)" }], 1);
        if (r && "endpoint" in r) out = { endpoint: r.endpoint };
        else if (r && "authError" in r) smtpError = r.authError;
      } else {
        confirm.smtp = { ...mm, skipNameCheck: true };
        if (!confirm.certNames.length) confirm.certNames = probes.get(keyOf(mm))?.certNames ?? [];
      }
    }
    if (!out && !smtpError) smtpError = "Odchozí server (SMTP) se nepodařilo najít — odesílání z aplikace nepůjde, stahování ano.";
  }

  const found = inc && "endpoint" in inc ? inc : null;
  const needsConfirmation = !found && confirm.endpoint ? { endpoint: confirm.endpoint, smtp: confirm.smtp, certNames: confirm.certNames } : undefined;
  if (!found) {
    const best =
      attempts.find((a) => a.stage === "login" && !a.ok && a.endpoint.protocol !== "smtp") ??
      attempts.find((a) => a.kind === "tls_hostname" && a.endpoint.protocol !== "smtp") ??
      attempts.find((a) => !a.ok && a.endpoint.protocol !== "smtp");
    return {
      ...base,
      needsConfirmation,
      smtpError,
      error: needsConfirmation
        ? `Šifrované spojení funguje, ale certifikát serveru nesedí na jeho název (je vystavený na: ${needsConfirmation.certNames.slice(0, 3).join(", ") || "?"}). Můžeš ho přesto používat bez ověření jména — potvrď to výslovně.`
        : best?.message ?? "Žádný příchozí server se nepodařilo najít.",
    };
  }
  const config = configFromDetection({ imap_user: auth.user }, found.endpoint, out?.endpoint, provider.id);
  return {
    ...base,
    ok: true,
    incoming: { ...found.endpoint, messages: found.messages },
    smtp: out?.endpoint,
    smtpError: out ? undefined : smtpError,
    config,
  };
}

/** Ověřená jména poskytovatele (pro samoopravu uložené schránky při síťové / TLS chybě). */
export async function providerFallbacks(email: string, protocol: IncomingProtocol | "smtp"): Promise<MailEndpoint[]> {
  const p = await detectProvider(email);
  if (!p.preset) return [];
  if (protocol === "smtp") return p.preset.smtp;
  // IMAP i POP3 (IMAP přednostně)
  return protocol === "imap" ? [...p.preset.imap, ...p.preset.pop3] : [...p.preset.pop3, ...p.preset.imap];
}

/** Přihlásí se k uloženému serveru; při chybě sítě / šifrování (NE hesla) zkusí ověřená jména poskytovatele. */
export async function connectWithFallback<T>(
  stored: ResolvedEndpoint,
  email: string,
  connect: (ep: MailEndpoint, auth: Credentials) => Promise<T>,
  opts: { budgetMs?: number; ca?: string | Buffer } = {},
): Promise<{ result: T; endpoint: IncomingEndpoint; healed: boolean }> {
  const t0 = Date.now();
  const auth = { user: stored.user, pass: stored.password };
  const first: IncomingEndpoint = { protocol: stored.protocol, host: stored.host, port: stored.port, tls: stored.tls === "tls" ? "tls" : "starttls", skipNameCheck: stored.skipNameCheck };
  try {
    return { result: await connect(first, auth), endpoint: first, healed: false };
  } catch (err) {
    const kind = classifyMailError(err);
    if (kind === "auth" || kind === "no_inbox") throw err;
    const queue = (await providerFallbacks(email, stored.protocol as IncomingProtocol | "smtp")).filter((e) => keyOf(e) !== keyOf(first));
    const tried = new Set<string>([keyOf(first)]);
    while (queue.length) {
      const ep = queue.shift()!;
      if (tried.has(keyOf(ep))) continue;
      tried.add(keyOf(ep));
      if (Date.now() - t0 > (opts.budgetMs ?? 25_000)) break;
      const probe = await probeEndpoint(ep, { timeoutMs: 5000, ca: opts.ca });
      if (!probe.ok) {
        // certifikát poskytovatele je na jiné jméno → zkusit jména z certifikátu
        if (probe.kind === "tls_hostname" && probe.chainOk && probe.certNames?.length) {
          queue.unshift(...certCandidateHosts(ep.host, probe.certNames).map((host) => ({ ...ep, host })));
        }
        continue;
      }
      try {
        return { result: await connect(ep, auth), endpoint: { ...ep, tls: ep.tls === "tls" ? "tls" : "starttls" }, healed: true };
      } catch (e2) {
        if (classifyMailError(e2) === "auth") throw e2;
      }
    }
    throw err;
  }
}

/** Popis chyby připojení pro uložení / zobrazení u schránky. */
export function describeConnectError(err: unknown, ep: MailEndpoint, user?: string): { kind: MailErrorKind; message: string } {
  const kind = classifyMailError(err);
  return { kind, message: describeMailError(kind, { endpoint: ep, raw: rawErrorText(err), user }) };
}
