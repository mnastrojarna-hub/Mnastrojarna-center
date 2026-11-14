/**
 * `mncad serve` – místní HTTP API (CAD-HEADLESS-NAVRH.md kap. 3.2).
 *
 * ```
 * POST /run     Content-Type: application/json   Authorization: Bearer <token>
 * { "script": "…", "strict": false, "formats": ["step","pdf"], "share": { "view": "model", "days": 10 } | false,
 *   "files": { "ref.step": "<base64>" }, "open": ["a.mncad"], "return": "base64" | "paths", "full": false, "lang": "cs",
 *   "session": "id", "timeoutSec": 120, "budget": 2048 }
 * → 200 RunReport (+ files[].base64 | files[].path); HTTP 200 i při ✗ (ok:false)
 *   400 špatný požadavek · 401 token · 403 původ/Host · 404 · 405 · 413 tělo > 64 MB · 415 jiný Content-Type
 *   429 fronta plná · 504 časový limit · 507 limit paměti · 500 pád vlákna
 * GET /health · GET /help · DELETE /session/<id>
 * ```
 *
 * Relace a vlákna: každá relace je připnutá k jednomu vláknu (MemoryWorkspace i mezipaměti jádra žijí tam); požadavky
 * jedné relace běží za sebou. Bez `session` = jednorázové vlákno. `--jobs N` = nejvýš N živých vláken; další požadavky čekají
 * ve frontě (nejvýš 8, pak 429). Nečinné vlákno skončí po `--idle-timeout` (výchozí 15 min), při limitu paměti nebo pádu;
 * relace se po každém požadavku uloží (`ws.save()` do paměti serveru), takže další požadavek ji obnoví v novém vlákně.
 * Volné vlákno cizí relace se uvolní (relace zůstane uložená), když je potřeba místo pro jinou relaci. Vlákno má jeden
 * jazyk (texty jádra v jeho mezipaměti stavby): požadavek relace v jiném `lang` ji obnoví v novém vlákně toho jazyka.
 *
 * Ukončení (SIGINT/SIGTERM, `close()`): server přestane přijímat, běžící požadavky se přeruší (hlídač → 500 s RunReport
 * ✗ `run.interrupted`), čekající ve frontě dostanou 503, pak se zavřou spojení a vlákna – nic nečeká na doběhnutí skriptu.
 *
 * Vstupy jen z `body.files` (FileSource v paměti) – server nečte disk; výstupy do paměti (base64) nebo s `--out` do
 * `<out>/<relace|běh>/` přes FileSink CLI (cesta vždy uvnitř `--out`).
 */
import crypto from "node:crypto";
import http from "node:http";
import path from "node:path";
import { CAD_LANGS, setLang, tr, type CadLang } from "../i18n";
import { finalizeReport, formatFull, OVERFLOW_FILE } from "../engine/protocol";
import { safeFileName, sha256Hex } from "../engine/host";
import type { OutFile, RunReport } from "../engine/protocol-types";
import { parseFormats, parseStrict, UsageError, type ServeArgs, type StrictOpt } from "./args";
import { CliFileSink, isInside, prepareOutDir } from "./file-sink";
import type { JobRequest } from "./job";
import type { Io } from "./main";
import { cliVersion, jobInit } from "./main";
import { BODY_MAX, checkBody, checkRequest, loadOrCreateToken, validateBind, type SecurityConfig } from "./serve-security";
import { httpStatusFor, JobThread, type Outcome } from "./watchdog";

/** nejvíc čekajících požadavků (pak 429) */
export const QUEUE_MAX = 8;
const SESSION_RE = /^[A-Za-z0-9_-]{1,64}$/;

type Slot = { thread: JobThread; lang: CadLang; session: Session | null; busy: boolean; lastUsed: number; idle?: ReturnType<typeof setTimeout> };
type Session = { id: string; saved: Uint8Array | null; slot: Slot | null; chain: Promise<unknown>; lastUsed: number };

export type RunBody = {
  script: string;
  strict?: boolean | string[];
  formats?: string[] | "auto" | "none";
  share?: false | { view?: "model" | "drawing"; days?: number };
  files?: Record<string, string>;
  open?: string[];
  return?: "base64" | "paths";
  full?: boolean;
  notes?: boolean;
  lang?: CadLang;
  session?: string;
  timeoutSec?: number;
  budget?: number;
  doc?: string;
  allDocs?: boolean;
  noOutputOnError?: boolean;
};

class BadRequest extends Error {}
/** server se ukončuje – požadavek ve frontě dostane 503 */
class ShuttingDown extends Error {}

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);

/** Kontrola a převod těla `POST /run` (400 při chybě). */
export function parseRunBody(raw: unknown): { body: RunBody; strict: StrictOpt; files: Record<string, Uint8Array> } {
  if (!isObj(raw)) throw new BadRequest(tr("tělo musí být objekt JSON"));
  const known = new Set(["script", "strict", "formats", "share", "files", "open", "return", "full", "notes", "lang", "session", "timeoutSec", "budget", "doc", "allDocs", "noOutputOnError"]);
  for (const k of Object.keys(raw)) if (!known.has(k)) throw new BadRequest(tr("neznámé pole „{0}“", k));
  const b = raw as RunBody;
  if (typeof b.script !== "string") throw new BadRequest(tr("pole „{0}“ musí být {1}", "script", "string"));
  const bool = (k: keyof RunBody) => {
    if (b[k] !== undefined && typeof b[k] !== "boolean") throw new BadRequest(tr("pole „{0}“ musí být {1}", k, "boolean"));
  };
  for (const k of ["full", "notes", "allDocs", "noOutputOnError"] as const) bool(k);
  let strict: StrictOpt = false;
  if (b.strict === true) strict = true;
  else if (Array.isArray(b.strict)) strict = parseStrict(b.strict.map(String).join(","));
  else if (b.strict !== undefined && b.strict !== false) throw new BadRequest(tr("pole „{0}“ musí být {1}", "strict", "boolean | string[]"));
  if (b.formats !== undefined) {
    try {
      parseFormats(Array.isArray(b.formats) ? b.formats.map(String).join(",") : String(b.formats));
    } catch (e) {
      throw new BadRequest((e as Error).message);
    }
  }
  if (b.share !== undefined && b.share !== false) {
    if (!isObj(b.share)) throw new BadRequest(tr("pole „{0}“ musí být {1}", "share", "false | { view, days }"));
    if (b.share.view !== undefined && b.share.view !== "model" && b.share.view !== "drawing") throw new BadRequest(tr("pole „{0}“ musí být {1}", "share.view", "model | drawing"));
    if (b.share.days !== undefined && !(Number.isInteger(b.share.days) && b.share.days >= 1 && b.share.days <= 90)) throw new BadRequest(tr("pole „{0}“ musí být {1}", "share.days", "1–90"));
  }
  if (b.open !== undefined && !(Array.isArray(b.open) && b.open.every((x) => typeof x === "string"))) throw new BadRequest(tr("pole „{0}“ musí být {1}", "open", "string[]"));
  if (b.return !== undefined && b.return !== "base64" && b.return !== "paths") throw new BadRequest(tr("pole „{0}“ musí být {1}", "return", "base64 | paths"));
  if (b.lang !== undefined && !CAD_LANGS.some((l) => l.id === b.lang)) throw new BadRequest(tr("neznámý jazyk „{0}“ – cs, en, de", String(b.lang)));
  if (b.session !== undefined && !(typeof b.session === "string" && SESSION_RE.test(b.session))) throw new BadRequest(tr("pole „{0}“ musí být {1}", "session", "[A-Za-z0-9_-]{1,64}"));
  if (b.timeoutSec !== undefined && !(Number.isInteger(b.timeoutSec) && b.timeoutSec >= 1 && b.timeoutSec <= 86_400)) throw new BadRequest(tr("pole „{0}“ musí být {1}", "timeoutSec", "1–86400"));
  if (b.budget !== undefined && !(Number.isInteger(b.budget) && b.budget >= 1)) throw new BadRequest(tr("pole „{0}“ musí být {1}", "budget", "integer ≥ 1"));
  if (b.doc !== undefined && typeof b.doc !== "string") throw new BadRequest(tr("pole „{0}“ musí být {1}", "doc", "string"));
  const files: Record<string, Uint8Array> = {};
  if (b.files !== undefined) {
    if (!isObj(b.files)) throw new BadRequest(tr("pole „{0}“ musí být {1}", "files", "{ name: base64 }"));
    for (const [name, v] of Object.entries(b.files)) {
      let clean: string;
      try {
        clean = safeFileName(name);
      } catch {
        throw new BadRequest(tr("název vstupního souboru „{0}“ není přípustný", name));
      }
      if (clean !== name) throw new BadRequest(tr("název vstupního souboru „{0}“ není přípustný", name));
      if (typeof v !== "string" || !/^[A-Za-z0-9+/=_-]*$/.test(v.replace(/\s+/g, ""))) throw new BadRequest(tr("soubor „{0}“ není base64", name));
      files[name] = new Uint8Array(Buffer.from(v, "base64"));
    }
  }
  return { body: b, strict, files };
}

function send(res: http.ServerResponse, status: number, body: unknown, headers: Record<string, string> = {}) {
  const data = typeof body === "string" ? body : JSON.stringify(body);
  res.writeHead(status, {
    "content-type": typeof body === "string" ? "text/markdown; charset=utf-8" : "application/json; charset=utf-8",
    "cache-control": "no-store",
    "x-content-type-options": "nosniff",
    "content-length": Buffer.byteLength(data),
    ...headers,
  });
  res.end(data);
}
const fail = (res: http.ServerResponse, status: number, code: string, message: string, headers: Record<string, string> = {}) => send(res, status, { error: code, message }, headers);

function readBody(req: http.IncomingMessage, max: number): Promise<Buffer | "too-large"> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let n = 0;
    let over = false;
    req.on("data", (c: Buffer) => {
      if (over) return;
      n += c.length;
      if (n > max) {
        over = true;
        resolve("too-large");
        req.resume();
        return;
      }
      chunks.push(c);
    });
    req.on("end", () => !over && resolve(Buffer.concat(chunks)));
    req.on("error", reject);
  });
}

/**
 * Složka výstupů požadavku `<out>/<relace|běh>/` pro `return: "paths"`: vytvoří se a její skutečná cesta (`realpath`)
 * musí ležet přímo v `--out` – odkaz `session-x → /jinde` se odmítne (zápisy by unikly z `--out`).
 */
export function sessionOutDir(outRoot: string, sub: string): string {
  const real = prepareOutDir(path.join(outRoot, sub));
  if (!isInside(outRoot, real) || path.dirname(real) !== outRoot) throw new Error(tr("výstupní složka „{0}“ míří mimo --out", sub));
  return real;
}

export type ServerHandle = { url: string; port: number; tokenFile: string; close(): Promise<void>; stats(): { threads: number; busy: number; queue: number; sessions: number } };

/** Spustí server; vrací ovladač (testy) – `serveMain` na něm čeká do SIGINT/SIGTERM. */
export async function startServer(a: ServeArgs, io: Io): Promise<ServerHandle> {
  validateBind(a.host, a.allowRemote, a.tokenFile);
  const tok = loadOrCreateToken(a.tokenFile, io.env);
  if (tok.created) io.stderr(tr("mncad serve: vygenerován token do „{0}“ (práva 0600)", tok.file));
  const outRoot = a.out !== undefined ? prepareOutDir(path.resolve(io.cwd, a.out)) : null;
  const sessions = new Map<string, Session>();
  const slots: Slot[] = [];
  const waiters: (() => void)[] = [];
  let inflight = 0;
  let running = 0;
  const version = cliVersion(io.entry);
  const cfg: SecurityConfig = { token: tok.token, port: a.port, bind: a.host, ...(a.allowRemote ? { remote: { bind: a.host, hosts: a.allowHosts } } : {}) };
  let closing = false;
  const handlers = new Set<Promise<unknown>>();

  const spawn = (lang: CadLang): Slot => {
    const thread = new JobThread({ entry: io.entry, init: jobInit(io, lang), maxMemMB: a.maxMem, rssGuard: false });
    const slot: Slot = { thread, lang, session: null, busy: false, lastUsed: Date.now() };
    slots.push(slot);
    void thread.ready.catch(() => undefined);
    thread.worker.once("exit", () => drop(slot));
    return slot;
  };
  const drop = (slot: Slot) => {
    if (slot.idle) clearTimeout(slot.idle);
    const i = slots.indexOf(slot);
    if (i >= 0) slots.splice(i, 1);
    if (slot.session?.slot === slot) slot.session.slot = null;
    wake();
  };
  const wake = () => {
    const w = waiters.shift();
    w?.();
  };
  const retire = async (slot: Slot) => {
    drop(slot);
    await slot.thread.close().catch(() => undefined);
  };

  /** volné vlákno pro relaci (připnuté), nebo nové; čeká, když je dosaženo `--jobs` a žádné vlákno nejde uvolnit */
  const acquire = async (session: Session | null, lang: CadLang): Promise<{ slot: Slot; fresh: boolean }> => {
    for (;;) {
      if (closing) throw new ShuttingDown();
      if (session?.slot && !session.slot.thread.dead && !session.slot.busy && session.slot.lang !== lang) {
        // jiný jazyk: mezipaměť stavby vlákna drží texty jádra v původním jazyce → relace se obnoví v novém vlákně
        await retire(session.slot);
        continue;
      }
      if (session?.slot && !session.slot.thread.dead && !session.slot.busy) {
        const s = session.slot;
        if (s.idle) clearTimeout(s.idle);
        s.busy = true;
        return { slot: s, fresh: false };
      }
      const live = slots.filter((s) => !s.thread.dead);
      if (live.length < a.jobs) {
        const s = spawn(lang);
        s.busy = true;
        s.session = session;
        if (session) session.slot = s;
        return { slot: s, fresh: true };
      }
      const idle = live.filter((s) => !s.busy).sort((x, y) => x.lastUsed - y.lastUsed)[0];
      if (idle) {
        await retire(idle);
        continue;
      }
      await new Promise<void>((res) => waiters.push(res));
    }
  };
  const release = (slot: Slot, keep: boolean) => {
    slot.busy = false;
    slot.lastUsed = Date.now();
    if (!keep || slot.thread.dead) {
      void retire(slot);
      return;
    }
    slot.idle = setTimeout(() => void retire(slot), a.idleTimeout * 1000);
    slot.idle.unref?.();
    wake();
  };

  async function handleRun(req: http.IncomingMessage, res: http.ServerResponse) {
    const bad = checkBody(req.headers);
    if (bad) return fail(res, bad.status, bad.code, bad.message);
    const raw = await readBody(req, BODY_MAX);
    if (raw === "too-large") return fail(res, 413, "too-large", tr("tělo je větší než {0} MB", Math.round(BODY_MAX / 1048576)));
    let parsed: ReturnType<typeof parseRunBody>;
    try {
      parsed = parseRunBody(JSON.parse(raw.toString("utf8")));
    } catch (e) {
      return fail(res, 400, "bad-request", e instanceof SyntaxError ? tr("tělo není platný JSON: {0}", e.message) : (e as Error).message);
    }
    const { body, strict, files } = parsed;
    if (body.return === "paths" && !outRoot) return fail(res, 400, "bad-request", tr("return: \"paths\" vyžaduje server spuštěný s --out"));
    if (inflight - running >= QUEUE_MAX) return fail(res, 429, "queue-full", tr("fronta je plná ({0} čekajících požadavků)", QUEUE_MAX), { "retry-after": "5" });
    const lang = body.lang ?? a.lang;
    inflight++;
    let session: Session | null = null;
    if (body.session) {
      session = sessions.get(body.session) ?? { id: body.session, saved: null, slot: null, chain: Promise.resolve(), lastUsed: Date.now() };
      sessions.set(session.id, session);
    }
    const work = async () => {
      const { slot, fresh } = await acquire(session, lang);
      running++;
      const sub = session ? `session-${session.id}` : `run-${Date.now().toString(36)}-${crypto.randomBytes(3).toString("hex")}`;
      let outDir: string | null = null;
      if (body.return === "paths" && outRoot) {
        try {
          outDir = sessionOutDir(outRoot, sub);
        } catch (e) {
          running--;
          release(slot, !!session);
          throw new BadRequest((e as Error).message);
        }
      }
      const timeoutSec = Math.min(body.timeoutSec ?? (a.timeout || 86_400), a.timeout || 86_400);
      const jr: JobRequest = {
        script: body.script,
        lang,
        strict,
        open: body.open ?? [],
        formats: body.formats === undefined ? "auto" : parseFormats(Array.isArray(body.formats) ? body.formats.join(",") : body.formats),
        ...(body.doc !== undefined ? { doc: body.doc } : {}),
        allDocs: !!body.allDocs,
        noOutputOnError: !!body.noOutputOnError,
        share: body.share ? { view: body.share.view ?? "model", days: body.share.days ?? 10 } : false,
        inputs: { kind: "memory", files },
        out: outDir ? { kind: "dir", dir: outDir } : { kind: "memory" },
        resume: fresh && session ? session.saved : null,
        saveSession: !!session,
        allowEmpty: !!session,
      };
      let outcome: Outcome;
      try {
        outcome = await slot.thread.run(jr, { deadline: Date.now() + timeoutSec * 1000, timeoutSec, lang });
      } finally {
        running--;
      }
      if (outcome.kind === "done" && session && outcome.session) session.saved = outcome.session;
      if (session) session.lastUsed = Date.now();
      release(slot, outcome.kind === "done" && !!session);
      return { outcome, outDir };
    };
    const p = session ? session.chain.then(work, work) : work();
    if (session) session.chain = p.catch(() => undefined);
    try {
      let got: Awaited<typeof p>;
      try {
        got = await p;
      } catch (e) {
        if (e instanceof ShuttingDown) return fail(res, 503, "shutting-down", tr("server se ukončuje"));
        if (e instanceof BadRequest) return fail(res, 400, "bad-request", e.message);
        throw e;
      }
      const { outcome, outDir } = got;
      setLang(lang);
      if (outcome.kind === "failed") return fail(res, 400, "bad-request", outcome.error);
      const fin = finalizeReport(outcome.report, { budget: body.budget, notes: body.notes, full: body.full });
      const outFiles: (OutFile & { mime?: string })[] = [];
      const doneFiles = outcome.kind === "done" ? outcome.files : outcome.report.files.map((file) => ({ file, data: undefined as Uint8Array | undefined }));
      for (const f of doneFiles) {
        const o: OutFile = { ...f.file };
        if (outDir) o.path = f.file.path ?? path.join(outDir, f.file.name);
        else {
          delete o.path;
          if (f.data) o.base64 = Buffer.from(f.data).toString("base64");
        }
        outFiles.push(o);
      }
      if (fin.overflow) {
        const full = new TextEncoder().encode(formatFull(fin) + "\n");
        const o: OutFile = { name: OVERFLOW_FILE, format: "txt", bytes: full.length, sha256: await sha256Hex(full), doc: "" };
        // pevný soubor přes FileSink CLI: rename nahradí případný symbolický odkaz, jeho cíl se nepřepíše
        if (outDir) o.path = CliFileSink.create(sessionOutDir(outRoot!, path.basename(outDir))).writeFixed(OVERFLOW_FILE, full);
        else o.base64 = Buffer.from(full).toString("base64");
        outFiles.push(o);
      }
      const report: RunReport = { ...fin, files: outFiles };
      send(res, httpStatusFor(outcome), report);
    } finally {
      inflight--;
    }
  }

  const server = http.createServer((req, res) => {
    const h = (async () => {
      if (closing) return fail(res, 503, "shutting-down", tr("server se ukončuje"), { connection: "close" });
      const rej = checkRequest(req.headers, cfg);
      if (rej) return fail(res, rej.status, rej.code, rej.message, rej.status === 401 ? { "www-authenticate": 'Bearer realm="mncad"' } : {});
      const url = new URL(req.url ?? "/", "http://localhost");
      const p = url.pathname.replace(/\/+$/, "") || "/";
      if (p === "/run") {
        if (req.method !== "POST") return fail(res, 405, "method", tr("metoda {0} není povolená", req.method ?? "?"), { allow: "POST" });
        return handleRun(req, res);
      }
      if (p === "/health") {
        if (req.method !== "GET") return fail(res, 405, "method", tr("metoda {0} není povolená", req.method ?? "?"), { allow: "GET" });
        const live = slots.filter((s) => !s.thread.dead);
        return send(res, 200, { ok: true, version, node: process.version, threads: live.length, busy: live.filter((s) => s.busy).length, jobs: a.jobs, queue: Math.max(0, inflight - running), sessions: sessions.size, memMB: Math.round(process.memoryUsage().rss / 1048576) });
      }
      if (p === "/help") {
        if (req.method !== "GET") return fail(res, 405, "method", tr("metoda {0} není povolená", req.method ?? "?"), { allow: "GET" });
        const { AGENT_GUIDE } = await import("../agent-guide");
        return send(res, 200, AGENT_GUIDE);
      }
      const sm = /^\/session\/([^/]+)$/.exec(p);
      if (sm) {
        if (req.method !== "DELETE") return fail(res, 405, "method", tr("metoda {0} není povolená", req.method ?? "?"), { allow: "DELETE" });
        let id: string;
        try {
          id = decodeURIComponent(sm[1]);
        } catch {
          return fail(res, 400, "bad-request", tr("neplatné kódování adresy „{0}“", sm[1].slice(0, 80)));
        }
        if (!SESSION_RE.test(id)) return fail(res, 400, "bad-request", tr("pole „{0}“ musí být {1}", "session", "[A-Za-z0-9_-]{1,64}"));
        const s = sessions.get(id);
        if (!s) return fail(res, 404, "not-found", tr("relace „{0}“ neexistuje", id));
        sessions.delete(s.id);
        if (s.slot) {
          const slot = s.slot;
          s.slot = null;
          if (slot.busy) await slot.thread.interrupt();
          await retire(slot);
        }
        res.writeHead(204, { "cache-control": "no-store" });
        return res.end();
      }
      return fail(res, 404, "not-found", tr("neznámá adresa {0}", p));
    })().catch((e) => {
      if (!res.headersSent) fail(res, 500, "internal", (e as Error).message);
      else res.destroy();
    });
    handlers.add(h);
    void h.finally(() => handlers.delete(h));
  });
  server.requestTimeout = 0;
  server.headersTimeout = 60_000;
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(a.port, a.host, () => resolve());
  });
  const addr = server.address() as { port: number };
  cfg.port = addr.port;
  const shownHost = a.host.includes(":") ? `[${a.host}]` : a.host;
  const url = `http://${shownHost}:${addr.port}`;
  return {
    url,
    port: addr.port,
    tokenFile: tok.file,
    stats: () => ({ threads: slots.length, busy: slots.filter((s) => s.busy).length, queue: Math.max(0, inflight - running), sessions: sessions.size }),
    /**
     * Ukončení bez čekání na skripty: přestat přijímat, přerušit běžící (→ 500 s RunReport ✗ run.interrupted), frontě 503,
     * počkat na odeslání odpovědí (nejvýš 3 s), zavřít spojení a vlákna.
     */
    async close() {
      closing = true;
      const closed = new Promise<void>((r) => server.close(() => r()));
      server.closeIdleConnections?.();
      for (const w of waiters.splice(0)) w();
      await Promise.all(slots.filter((s) => s.busy).map((s) => s.thread.interrupt()));
      const settle = Promise.allSettled([...handlers]);
      await Promise.race([settle, new Promise((r) => setTimeout(r, 3000).unref?.())]);
      server.closeAllConnections?.();
      await closed;
      await Promise.all(slots.slice().map((s) => s.thread.close().catch(() => undefined)));
    },
  };
}

/** `mncad serve` až do SIGINT/SIGTERM (kód 130) */
export async function serveMain(a: ServeArgs, io: Io): Promise<number> {
  let h: ServerHandle;
  try {
    h = await startServer(a, io);
  } catch (e) {
    if (e instanceof UsageError) throw e;
    io.stderr(tr("mncad serve: server nelze spustit: {0}", (e as Error).message));
    return 3;
  }
  io.stdout(JSON.stringify({ url: h.url, port: h.port, tokenFile: h.tokenFile, version: cliVersion(io.entry) }));
  io.stderr(tr("mncad serve: naslouchá na {0} (token: {1}; Ctrl+C ukončí)", h.url, h.tokenFile));
  await new Promise<void>((resolve) => {
    const off = io.onSignal?.(() => {
      off?.();
      resolve();
    });
    if (!off) resolve();
  });
  await h.close();
  return 130;
}
