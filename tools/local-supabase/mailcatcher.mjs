#!/usr/bin/env node
// Lokální "mail catcher": SMTP server (bez TLS, přijme jakýkoli AUTH) + HTTP API pro testy.
//
//   SMTP  127.0.0.1:54325   (MAIL_SMTP_PORT)
//   HTTP  127.0.0.1:54324   (MAIL_HTTP_PORT)
//     GET    /messages                    → [{id, from, to, subject, text, html, date, otp}]  (?to=<email> filtr)
//     GET    /messages/latest?to=<email>  → poslední zpráva (404, když není; ?wait=<ms> počká)
//     GET    /messages/:id                → jedna zpráva
//     DELETE /messages                    → smaže vše (?to=<email> jen pro adresáta)
//     GET    /templates/<soubor>          → e-mailové šablony pro GoTrue
//     GET    /health                      → {"ok":true}
import http from "node:http";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";
import { SMTPServer } from "smtp-server";
import { simpleParser } from "mailparser";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const TEMPLATES = path.join(HERE, "templates");
const SMTP_PORT = Number(process.env.MAIL_SMTP_PORT ?? 54325);
const HTTP_PORT = Number(process.env.MAIL_HTTP_PORT ?? 54324);
const MAX_MESSAGES = 2000;

/** @type {Array<Record<string, any>>} */
const messages = [];
const waiters = new Set();

const norm = (s) => String(s ?? "").trim().toLowerCase();
const addrList = (a) => (a ? (Array.isArray(a) ? a : [a]).flatMap((x) => x.value ?? []).map((v) => norm(v.address)) : []);

function store(msg) {
  messages.push(msg);
  if (messages.length > MAX_MESSAGES) messages.splice(0, messages.length - MAX_MESSAGES);
  for (const w of [...waiters]) w(msg);
  console.log(`[mail] ${msg.date} ${msg.from} → ${msg.to.join(", ")} | ${msg.subject}`);
}

function makeSmtp() {
  return new SMTPServer({
    secure: false,
    disabledCommands: ["STARTTLS"],
    authOptional: true,
    allowInsecureAuth: true,
    logger: false,
    banner: "local-supabase mail catcher",
    size: 50 * 1024 * 1024,
    onAuth(auth, _session, cb) {
      cb(null, { user: auth.username || "anonymous" });
    },
    onData(stream, session, cb) {
      simpleParser(stream)
        .then((parsed) => {
          const envelopeTo = (session.envelope.rcptTo ?? []).map((r) => norm(r.address));
          const to = [...new Set([...envelopeTo, ...addrList(parsed.to), ...addrList(parsed.cc)])];
          const text = parsed.text ?? "";
          const html = typeof parsed.html === "string" ? parsed.html : "";
          const otp = (text.match(/\b(\d{6})\b/) ?? html.replace(/<[^>]+>/g, " ").match(/\b(\d{6})\b/) ?? [])[1] ?? null;
          store({
            id: randomUUID(),
            from: parsed.from?.text ?? norm(session.envelope.mailFrom?.address),
            envelopeFrom: norm(session.envelope.mailFrom?.address),
            to,
            subject: parsed.subject ?? "",
            text,
            html,
            otp,
            date: (parsed.date ?? new Date()).toISOString(),
            receivedAt: new Date().toISOString(),
            attachments: (parsed.attachments ?? []).map((a) => ({
              filename: a.filename,
              contentType: a.contentType,
              size: a.size,
            })),
            auth: session.user ?? null,
          });
          cb();
        })
        .catch((err) => {
          console.error("[mail] parse error", err);
          cb(err);
        });
    },
  });
}

function listenBoth(make, port, label) {
  // 127.0.0.1 povinně; ::1 jen pokud je IPv6 k dispozici
  for (const host of ["127.0.0.1", "::1"]) {
    const srv = make();
    srv.on("error", (err) => {
      if (host === "::1") return; // IPv6 není → ignorovat
      console.error(`[${label}] ${host}:${port}`, err);
      process.exit(1);
    });
    srv.listen(port, host, () => console.log(`[${label}] listening on ${host}:${port}`));
  }
}

const matchesTo = (m, to) => !to || m.to.includes(norm(to));

function send(res, status, body, type = "application/json; charset=utf-8") {
  res.writeHead(status, {
    "content-type": type,
    "access-control-allow-origin": "*",
    "access-control-allow-methods": "GET, DELETE, OPTIONS",
    "access-control-allow-headers": "*",
  });
  res.end(typeof body === "string" || Buffer.isBuffer(body) ? body : JSON.stringify(body));
}

async function handler(req, res) {
  const url = new URL(req.url, "http://localhost");
  const p = url.pathname.replace(/\/+$/, "") || "/";
  const to = url.searchParams.get("to");
  try {
    if (req.method === "OPTIONS") return send(res, 204, "");
    if (p === "/health") return send(res, 200, { ok: true, messages: messages.length });
    if (p === "/messages" && req.method === "GET") return send(res, 200, messages.filter((m) => matchesTo(m, to)));
    if (p === "/messages" && req.method === "DELETE") {
      const keep = to ? messages.filter((m) => !matchesTo(m, to)) : [];
      const removed = messages.length - keep.length;
      messages.splice(0, messages.length, ...keep);
      return send(res, 200, { deleted: removed });
    }
    if (p === "/messages/latest" && req.method === "GET") {
      const since = url.searchParams.get("since"); // ISO čas – jen novější zprávy
      const ok = (m) => matchesTo(m, to) && (!since || m.receivedAt > since);
      const found = [...messages].reverse().find(ok);
      if (found) return send(res, 200, found);
      const wait = Math.min(Number(url.searchParams.get("wait") ?? 0) || 0, 60000);
      if (!wait) return send(res, 404, { error: "no message", to });
      const msg = await new Promise((resolve) => {
        const timer = setTimeout(() => {
          waiters.delete(w);
          resolve(null);
        }, wait);
        const w = (m) => {
          if (!ok(m)) return;
          clearTimeout(timer);
          waiters.delete(w);
          resolve(m);
        };
        waiters.add(w);
      });
      return msg ? send(res, 200, msg) : send(res, 404, { error: "no message", to });
    }
    const one = p.match(/^\/messages\/([0-9a-f-]{36})$/);
    if (one && req.method === "GET") {
      const m = messages.find((x) => x.id === one[1]);
      return m ? send(res, 200, m) : send(res, 404, { error: "not found" });
    }
    const tpl = p.match(/^\/templates\/([\w.-]+)$/);
    if (tpl && req.method === "GET") {
      const file = path.join(TEMPLATES, tpl[1]);
      return send(res, 200, await readFile(file), "text/html; charset=utf-8");
    }
    return send(res, 404, { error: "not found" });
  } catch (err) {
    return send(res, err?.code === "ENOENT" ? 404 : 500, { error: String(err?.message ?? err) });
  }
}

listenBoth(makeSmtp, SMTP_PORT, "smtp");
listenBoth(() => http.createServer(handler), HTTP_PORT, "http");

for (const sig of ["SIGINT", "SIGTERM"]) process.on(sig, () => process.exit(0));
