#!/usr/bin/env node
// Testovací poštovní server (IMAP + POP3 + SMTP) pro integrační a E2E testy nastavení schránky.
// Bez závislostí — jen Node (net/tls) a `openssl` (vygeneruje vlastní CA a certifikáty).
//
//   node tools/e2e/mail-test-server.mjs [--dir .local-supabase/mail-test] [--base 24000]
//
// Vypíše JSON s porty a cestou k CA (aplikaci spusť s NODE_EXTRA_CA_CERTS=<ca>). Ukončení: Ctrl+C / SIGTERM.
// Programově: `const srv = await startMailTestServer({ dir, base })` → { ports, caFile, events, close() }.
//
// Certifikáty záměrně NEsedí na „localhost" (jako mail.<vlastní doména> u hosting90):
//   main     — SAN DNS:mail.hosting90.test + IP:127.0.0.1 → přes 127.0.0.1 OK, přes localhost „nesedí jméno"
//   nameonly — SAN jen DNS:mail.hosting90.test (nepřeložitelné) → zbývá jen „přesto bez ověření jména"
//
// Porty (base = 24000): IMAPS +993, IMAP/STARTTLS +143, POP3S +995, POP3/STLS +110, SMTPS +465,
// SMTP/STARTTLS +587, „němý" server +999 (přijme spojení, nic nepošle); nameonly: IMAPS +1993,
// POP3S +1995, SMTPS +1465. Port +998 je vždy zavřený. CLI navíc HTTP ovládání +80 (GET /events, /sent).
import http from "node:http";
import net from "node:net";
import tls from "node:tls";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

export const ACCOUNTS = [
  { user: "jmeno@nastrojarstvi.test", pass: "Spravne-Heslo-1", imap: true, pop3: true },
  { user: "pop@pop3only.test", pass: "Pop3-Heslo-1", imap: false, pop3: true },
  { user: "kolega@mnastrojarna.test", pass: "Kolega-Heslo-1", imap: true, pop3: true },
  { user: "cert@jinycert.test", pass: "Cert-Heslo-1", imap: true, pop3: true },
  // E2E 18 (Pošta A): vlastní schránka v Můj účet, stažení celé schránky, odpovědi, Odeslané
  { user: "posta@nastrojarstvi.test", pass: "Posta-Heslo-1", imap: true, pop3: true },
  // E2E 20 (Pošta B): komunikace k zakázce
  { user: "zakazky@nastrojarstvi.test", pass: "Zakazky-Heslo-1", imap: true, pop3: true },
  // E2E 22: obchodník a zaměstnanec si schránku připojí sami (Můj účet), oprava zastaralého SMTP hesla
  { user: "obchod22@nastrojarstvi.test", pass: "Obchod22-Heslo-1", imap: true, pop3: true },
  { user: "dilna22@nastrojarstvi.test", pass: "Dilna22-Heslo-1", imap: true, pop3: true },
  // src/lib/email/smtp-heal.integration.test.ts: zastaralé vlastní SMTP heslo (535) → heslo schránky
  { user: "smtpheal@nastrojarstvi.test", pass: "Smtpheal-Heslo-1", imap: true, pop3: true },
  // Pošta D: podpis s logem (src/lib/email/mail-d.integration.test.ts) a E2E 25 (kategorie, podpis, mobil)
  { user: "podpis@nastrojarstvi.test", pass: "Podpis-Heslo-1", imap: true, pop3: true },
  // Pošta E: fronta K odeslání + „Přijmout a odeslat" (src/lib/email/mail-e.integration.test.ts) a E2E 26
  // (obchodník si v Pošta → Nastavení pošty sám nastaví schránku, živá pošta)
  { user: "outbox@nastrojarstvi.test", pass: "Outbox-Heslo-1", imap: true, pop3: true },
  { user: "vit26@nastrojarstvi.test", pass: "Vit26-Heslo-1", imap: true, pop3: true },
  { user: "podpis25@nastrojarstvi.test", pass: "Podpis25-Heslo-1", imap: true, pop3: true },
  // E2E 39: poptávky dodavatelům — schránka zaměstnance se „Smí poptávat dodavatele" (odpověď dodavatele s PD-…)
  { user: "poptavky39@nastrojarstvi.test", pass: "Poptavky39-Heslo-1", imap: true, pop3: true },
];

function makeMessages(user) {
  const domain = user.split("@")[1];
  const base = Date.UTC(2026, 9, 20, 8, 0, 0);
  const list = [
    { from: "Jan Dvořák <dvorak@strojmetal.test>", subject: "Poptávka hřídele 50 ks", body: "Dobrý den,\r\nposílám poptávku na 50 ks hřídelí dle výkresu H-100.\r\n.tečka na začátku řádku\r\nS pozdravem Jan" },
    { from: "Eva Nová <eva@firma.test>", subject: "Objednávka 4500123", body: "Objednáváme 20 ks přírub P-20.\r\nTermín 14 dní." },
    { from: "Dodavatel <nabidky@ocel.test>", subject: "Nabídka materiálu", body: "Cena tyče 42CrMo4 je 180 Kč/kg." },
  ];
  // jmeno@ má „čisté" předměty, ostatní účty s předponou (E2E rozliší, čí pošta je vidět)
  const local = user.split("@")[0];
  const prefix = local === "jmeno" ? "" : `${local[0].toUpperCase()}${local.slice(1)}: `;
  return list.map((m0, i) => {
    const m = { ...m0, subject: `${prefix}${m0.subject}` };
    const date = new Date(base + i * 3600_000);
    const subj = /[^\x20-\x7e]/.test(m.subject) ? `=?UTF-8?B?${Buffer.from(m.subject).toString("base64")}?=` : m.subject;
    const fromEnc = m.from.replace(/^([^<]+)</, (_, name) => (/[^\x20-\x7e]/.test(name) ? `=?UTF-8?B?${Buffer.from(name.trim()).toString("base64")}?= <` : `${name}<`));
    const raw = Buffer.from(
      [
        `Message-ID: <e2e-${i + 1}.${user.replace(/[^a-z0-9]/gi, "")}@${domain}>`,
        `Date: ${date.toUTCString().replace("GMT", "+0000")}`,
        `From: ${fromEnc}`,
        `To: ${user}`,
        `Subject: ${subj}`,
        "MIME-Version: 1.0",
        "Content-Type: text/plain; charset=utf-8",
        "Content-Transfer-Encoding: 8bit",
        "",
        m.body,
        "",
      ].join("\r\n"),
      "utf8",
    );
    return { uid: i + 1, raw, date, from: m.from, subject: subj, to: user, messageId: `<e2e-${i + 1}.${user.replace(/[^a-z0-9]/gi, "")}@${domain}>` };
  });
}

/** Zpráva z RFC 822 zdroje (APPEND do Odeslaných): hlavičky pro ENVELOPE. */
function messageFromRaw(raw, uid) {
  const text = raw.toString("latin1");
  const end = text.search(/\r?\n\r?\n/);
  const head = (end >= 0 ? text.slice(0, end) : text).replace(/\r?\n[ \t]+/g, " ");
  const h = {};
  for (const line of head.split(/\r?\n/)) {
    const i = line.indexOf(":");
    if (i > 0) { const k = line.slice(0, i).trim().toLowerCase(); if (!(k in h)) h[k] = line.slice(i + 1).trim(); }
  }
  const date = h.date ? new Date(h.date) : new Date();
  return {
    uid, raw, date: Number.isNaN(date.getTime()) ? new Date() : date,
    from: h.from ?? "", subject: h.subject ?? "", to: (h.to ?? "").split(",")[0]?.trim() ?? "", messageId: h["message-id"] ?? `<append-${uid}@test>`,
  };
}

/**
 * Nová zpráva (UTF-8 předmět i jméno jako encoded-word; volitelně In-Reply-To / References a přílohy
 * jako multipart/mixed s base64).
 */
function buildMessage(user, uid, { subject, body = "Text", from = "Nový <novy@zakaznik.test>", inReplyTo, references, attachments = [], date = new Date(), messageId, cc }) {
  const enc = (s) => (/[^\x20-\x7e]/.test(s) ? `=?UTF-8?B?${Buffer.from(s).toString("base64")}?=` : s);
  const fromEnc = from.replace(/^([^<]+)</, (_, name) => `${enc(name.trim())} <`);
  const id = messageId ?? `<e2e-new-${uid}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@test>`;
  const head = [
    `Message-ID: ${id}`, `Date: ${date.toUTCString().replace("GMT", "+0000")}`, `From: ${fromEnc}`, `To: ${user}`,
    ...(cc ? [`Cc: ${cc}`] : []), `Subject: ${enc(subject)}`,
    ...(inReplyTo ? [`In-Reply-To: ${inReplyTo}`] : []), ...(references ? [`References: ${references}`] : []), "MIME-Version: 1.0",
  ];
  let raw;
  if (attachments.length) {
    const b = `b-${uid}-${Date.now()}`;
    const parts = [
      `--${b}\r\nContent-Type: text/plain; charset=utf-8\r\nContent-Transfer-Encoding: 8bit\r\n\r\n${body}\r\n`,
      ...attachments.map((a) => {
        const b64 = Buffer.from(a.content).toString("base64").replace(/.{1,76}/g, "$&\r\n");
        return `--${b}\r\nContent-Type: ${a.contentType ?? "application/octet-stream"}; name="${a.filename}"\r\nContent-Disposition: attachment; filename="${a.filename}"\r\nContent-Transfer-Encoding: base64\r\n\r\n${b64}`;
      }),
      `--${b}--\r\n`,
    ];
    raw = Buffer.from([...head, `Content-Type: multipart/mixed; boundary="${b}"`, "", parts.join("")].join("\r\n"), "utf8");
  } else {
    raw = Buffer.from([...head, "Content-Type: text/plain; charset=utf-8", "Content-Transfer-Encoding: 8bit", "", body, ""].join("\r\n"), "utf8");
  }
  return { uid, raw, date, from: fromEnc, subject: enc(subject), to: user, messageId: id };
}

// ── Certifikáty ─────────────────────────────────────────────
function ensureCerts(dir) {
  fs.mkdirSync(dir, { recursive: true });
  const f = (n) => path.join(dir, n);
  const run = (args) => execFileSync("openssl", args, { stdio: ["ignore", "ignore", "pipe"] });
  if (!fs.existsSync(f("ca.crt"))) {
    run(["req", "-x509", "-newkey", "rsa:2048", "-nodes", "-keyout", f("ca.key"), "-out", f("ca.crt"), "-days", "60",
      "-subj", "/CN=Mnastrojarna E2E Mail CA", "-addext", "basicConstraints=critical,CA:TRUE", "-addext", "keyUsage=critical,keyCertSign,cRLSign"]);
  }
  const leaf = (name, san) => {
    if (fs.existsSync(f(`${name}.crt`))) return;
    run(["req", "-newkey", "rsa:2048", "-nodes", "-keyout", f(`${name}.key`), "-out", f(`${name}.csr`), "-subj", "/CN=mail.hosting90.test"]);
    fs.writeFileSync(f(`${name}.ext`), `subjectAltName=${san}\nbasicConstraints=CA:FALSE\nextendedKeyUsage=serverAuth\n`);
    run(["x509", "-req", "-in", f(`${name}.csr`), "-CA", f("ca.crt"), "-CAkey", f("ca.key"), "-CAcreateserial", "-out", f(`${name}.crt`), "-days", "60", "-extfile", f(`${name}.ext`)]);
  };
  leaf("main", "DNS:mail.hosting90.test,IP:127.0.0.1");
  leaf("nameonly", "DNS:mail.hosting90.test");
  const pair = (name) => ({ key: fs.readFileSync(f(`${name}.key`)), cert: fs.readFileSync(f(`${name}.crt`)) });
  return { caFile: f("ca.crt"), main: pair("main"), nameonly: pair("nameonly") };
}

// ── Řádkové spojení s možností STARTTLS ─────────────────────
class Conn {
  constructor(socket, secureContext, onLine, events, proto) {
    this.secureContext = secureContext;
    this.onLine = onLine;
    this.events = events;
    this.proto = proto;
    this.buf = Buffer.alloc(0);
    this.literal = null; // { need, parts } u IMAP literálu
    this.secure = socket instanceof tls.TLSSocket;
    this.attach(socket);
  }
  attach(socket) {
    this.socket = socket;
    socket.on("data", (d) => this.onData(d));
    socket.on("error", () => {});
  }
  write(s) {
    if (!this.socket.destroyed) this.socket.write(s);
  }
  upgrade() {
    const raw = this.socket;
    raw.removeAllListeners("data");
    const secure = new tls.TLSSocket(raw, { isServer: true, secureContext: tls.createSecureContext(this.secureContext) });
    this.buf = Buffer.alloc(0);
    this.secure = true;
    this.attach(secure);
  }
  onData(d) {
    this.buf = Buffer.concat([this.buf, d]);
    for (;;) {
      if (this.literal) {
        if (this.buf.length < this.literal.need) return;
        this.lastLiteral = Buffer.from(this.buf.subarray(0, this.literal.need)); // APPEND: zpráva beze změny
        const lit = this.buf.subarray(0, this.literal.need).toString("utf8");
        this.buf = this.buf.subarray(this.literal.need);
        this.literal.parts.push(JSON.stringify(lit));
        const parts = this.literal.parts;
        this.literal = null;
        this.pending = parts;
        continue;
      }
      const idx = this.buf.indexOf("\r\n");
      if (idx < 0) return;
      const line = this.buf.subarray(0, idx).toString("utf8");
      this.buf = this.buf.subarray(idx + 2);
      const parts = this.pending ?? [];
      this.pending = null;
      const m = this.proto === "imap" ? /\{(\d+)(\+?)\}$/.exec(line) : null;
      if (m) {
        parts.push(line.slice(0, m.index));
        this.literal = { need: Number(m[1]), parts };
        if (!m[2]) this.write("+ go ahead\r\n");
        continue;
      }
      parts.push(line);
      try {
        this.onLine(parts.join(""), this);
      } catch (err) {
        this.events.push({ type: "error", proto: this.proto, message: String(err) });
      }
    }
  }
}

function findAccount(user, pass, proto) {
  const acc = ACCOUNTS.find((a) => a.user.toLowerCase() === String(user ?? "").toLowerCase());
  if (!acc || acc.pass !== pass) return null;
  if (proto === "imap" && !acc.imap) return null;
  if (proto === "pop3" && !acc.pop3) return null;
  return acc;
}

// ── IMAP ────────────────────────────────────────────────────
function tokenize(s) {
  const out = [];
  let i = 0;
  while (i < s.length) {
    const ch = s[i];
    if (ch === " ") { i++; continue; }
    if (ch === '"') {
      let j = i + 1, v = "";
      while (j < s.length && s[j] !== '"') { if (s[j] === "\\") j++; v += s[j]; j++; }
      out.push(v); i = j + 1; continue;
    }
    if (ch === "(" || ch === ")") { out.push(ch); i++; continue; }
    let j = i;
    let depth = 0;
    while (j < s.length && (depth > 0 || (s[j] !== " " && s[j] !== "(" && s[j] !== ")"))) {
      if (s[j] === "[") depth++;
      if (s[j] === "]") depth--;
      j++;
    }
    out.push(s.slice(i, j)); i = j;
  }
  return out;
}

function inSet(set, n, max) {
  return set.split(",").some((part) => {
    const [a, b] = part.split(":");
    const lo = a === "*" ? max : Number(a);
    if (b === undefined) return n === lo;
    const hi = b === "*" ? max : Number(b);
    return n >= Math.min(lo, hi) && n <= Math.max(lo, hi);
  });
}

const q = (s) => (s === null || s === undefined ? "NIL" : JSON.stringify(String(s)));
function addr(str) {
  const m = /^\s*(.*?)\s*<([^>]+)>\s*$/.exec(str) ?? [null, "", str.trim()];
  const [mbox, host] = m[2].split("@");
  return `((${m[1] ? q(m[1]) : "NIL"} NIL ${q(mbox)} ${q(host)}))`;
}
function envelope(msg) {
  return `(${q(msg.date.toUTCString())} ${q(msg.subject)} ${addr(msg.from)} ${addr(msg.from)} ${addr(msg.from)} ${addr(msg.to)} NIL NIL NIL ${q(msg.messageId)})`;
}
function imapDate(d) {
  const mon = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"][d.getUTCMonth()];
  const p = (n) => String(n).padStart(2, "0");
  return `${p(d.getUTCDate())}-${mon}-${d.getUTCFullYear()} ${p(d.getUTCHours())}:${p(d.getUTCMinutes())}:${p(d.getUTCSeconds())} +0000`;
}

/** Složka účtu: INBOX, nebo „Sent" (SPECIAL-USE \Sent — sem ukládá aplikace kopie odeslaných přes APPEND). */
function folderOf(name) {
  const n = String(name ?? "").replace(/^"|"$/g, "");
  if (n.toUpperCase() === "INBOX") return "INBOX";
  if (n === "Sent") return "Sent";
  return null;
}

function imapHandler(state, mailboxes, events, sentBoxes) {
  const caps = (conn) =>
    `IMAP4rev1 ID NAMESPACE${conn.secure ? "" : " STARTTLS LOGINDISABLED"}`;
  const box = (folder = state.folder) => (folder === "Sent" ? sentBoxes.get(state.user) : mailboxes.get(state.user));
  return (line, conn) => {
    const sp = line.indexOf(" ");
    const tag = sp < 0 ? line : line.slice(0, sp);
    let rest = sp < 0 ? "" : line.slice(sp + 1);
    let cmd = rest.split(" ")[0].toUpperCase();
    rest = rest.slice(cmd.length + 1);
    let uidMode = false;
    if (cmd === "UID") {
      uidMode = true;
      cmd = rest.split(" ")[0].toUpperCase();
      rest = rest.slice(cmd.length + 1);
    }
    const ok = (t = "completed") => conn.write(`${tag} OK ${cmd} ${t}\r\n`);
    switch (cmd) {
      case "CAPABILITY": conn.write(`* CAPABILITY ${caps(conn)}\r\n`); return ok();
      case "NOOP": case "CHECK": case "ENABLE": case "EXPUNGE": case "STORE": return ok();
      case "ID": conn.write('* ID ("name" "mnastrojarna-e2e")\r\n'); return ok();
      case "NAMESPACE": conn.write('* NAMESPACE (("" ".")) NIL NIL\r\n'); return ok();
      case "LOGOUT": conn.write("* BYE bye\r\n"); ok(); return conn.socket.end();
      case "STARTTLS":
        if (conn.secure) return conn.write(`${tag} BAD already secure\r\n`);
        conn.write(`${tag} OK Begin TLS negotiation now\r\n`);
        return conn.upgrade();
      case "LOGIN": case "AUTHENTICATE": {
        let user, pass;
        if (cmd === "LOGIN") [user, pass] = tokenize(rest);
        else {
          const [mech, initial] = tokenize(rest);
          if (String(mech).toUpperCase() !== "PLAIN" || !initial) return conn.write(`${tag} NO unsupported\r\n`);
          const parts = Buffer.from(initial, "base64").toString("utf8").split("\0");
          user = parts[1]; pass = parts[2];
        }
        events.push({ type: "auth", proto: "imap", user, secure: conn.secure, port: conn.socket.localPort });
        if (!conn.secure) {
          events.push({ type: "plaintext-auth", proto: "imap", user });
          return conn.write(`${tag} NO [PRIVACYREQUIRED] LOGIN disabled before STARTTLS\r\n`);
        }
        const acc = findAccount(user, pass, "imap");
        if (!acc) return conn.write(`${tag} NO [AUTHENTICATIONFAILED] Authentication failed.\r\n`);
        state.user = acc.user;
        return conn.write(`${tag} OK [CAPABILITY ${caps(conn)}] Logged in\r\n`);
      }
      case "LIST": case "LSUB": {
        if (!state.user) return conn.write(`${tag} NO not authenticated\r\n`);
        const [, pattern] = tokenize(rest);
        if (pattern === "") conn.write('* LIST (\\Noselect) "." ""\r\n');
        else {
          conn.write('* LIST (\\HasNoChildren) "." INBOX\r\n');
          conn.write('* LIST (\\HasNoChildren \\Sent) "." Sent\r\n');
        }
        return ok();
      }
      case "APPEND": {
        if (!state.user) return conn.write(`${tag} NO not authenticated\r\n`);
        const [name] = tokenize(rest);
        const folder = folderOf(name);
        if (!folder) return conn.write(`${tag} NO [TRYCREATE] Mailbox does not exist\r\n`);
        const raw = conn.lastLiteral ?? Buffer.alloc(0);
        const list = box(folder);
        const uid = (list.at(-1)?.uid ?? 0) + 1;
        list.push(messageFromRaw(raw, uid));
        events.push({ type: "append", user: state.user, folder, uid, size: raw.length });
        return conn.write(`${tag} OK [APPENDUID 1700000000 ${uid}] APPEND completed\r\n`);
      }
      case "SELECT": case "EXAMINE": case "STATUS": {
        if (!state.user) return conn.write(`${tag} NO not authenticated\r\n`);
        const [name] = tokenize(rest);
        const folder = folderOf(name);
        if (!folder) return conn.write(`${tag} NO [NONEXISTENT] Mailbox does not exist\r\n`);
        const msgs = box(folder);
        const uidNext = (msgs.at(-1)?.uid ?? 0) + 1;
        if (cmd === "STATUS") {
          conn.write(`* STATUS ${folder} (MESSAGES ${msgs.length} UIDNEXT ${uidNext} UIDVALIDITY 1700000000 UNSEEN 0)\r\n`);
          return ok();
        }
        state.folder = folder;
        state.selected = true;
        conn.write(`* FLAGS (\\Seen \\Answered \\Flagged \\Deleted \\Draft)\r\n* OK [PERMANENTFLAGS ()] ok\r\n* ${msgs.length} EXISTS\r\n* 0 RECENT\r\n`);
        conn.write(`* OK [UIDVALIDITY 1700000000] ok\r\n* OK [UIDNEXT ${uidNext}] ok\r\n`);
        return conn.write(`${tag} OK [${cmd === "SELECT" ? "READ-WRITE" : "READ-ONLY"}] ${cmd} completed\r\n`);
      }
      case "CLOSE": case "UNSELECT": state.selected = false; return ok();
      case "SEARCH": {
        if (!state.selected) return conn.write(`${tag} NO no mailbox selected\r\n`);
        const msgs = box();
        const t = tokenize(rest);
        const maxUid = msgs.at(-1)?.uid ?? 0;
        let found = msgs.map((m, i) => ({ m, seq: i + 1 }));
        const ui = t.findIndex((x) => String(x).toUpperCase() === "UID");
        if (ui >= 0) found = found.filter(({ m }) => inSet(t[ui + 1], m.uid, maxUid));
        // HEADER <pole> <hodnota> (dohledání zprávy podle Message-ID)
        const hi = t.findIndex((x) => String(x).toUpperCase() === "HEADER");
        if (hi >= 0) {
          const name = String(t[hi + 1] ?? "").toLowerCase();
          const value = String(t[hi + 2] ?? "").toLowerCase();
          found = found.filter(({ m }) => {
            const head = m.raw.toString("utf8").split(/\r?\n\r?\n/)[0];
            return head.split(/\r?\n/).some((l) => l.toLowerCase().startsWith(`${name}:`) && l.toLowerCase().includes(value));
          });
        }
        conn.write(`* SEARCH${found.map(({ m, seq }) => ` ${uidMode ? m.uid : seq}`).join("")}\r\n`);
        return ok();
      }
      case "FETCH": {
        if (!state.selected) return conn.write(`${tag} NO no mailbox selected\r\n`);
        const msgs = box();
        const set = rest.split(" ")[0];
        const items = rest.slice(set.length + 1).toUpperCase();
        const max = uidMode ? (msgs.at(-1)?.uid ?? 0) : msgs.length;
        msgs.forEach((m, i) => {
          const seq = i + 1;
          if (!inSet(set, uidMode ? m.uid : seq, max)) return;
          const parts = [];
          if (uidMode || items.includes("UID")) parts.push(`UID ${m.uid}`);
          if (items.includes("FLAGS")) parts.push("FLAGS ()");
          if (items.includes("INTERNALDATE")) parts.push(`INTERNALDATE "${imapDate(m.date)}"`);
          if (items.includes("RFC822.SIZE")) parts.push(`RFC822.SIZE ${m.raw.length}`);
          if (items.includes("ENVELOPE")) parts.push(`ENVELOPE ${envelope(m)}`);
          const body = /BODY(?:\.PEEK)?\[\](?:<(\d+)\.(\d+)>)?/.exec(items);
          let lit = null;
          if (body) {
            const start = body[1] ? Number(body[1]) : 0;
            const len = body[2] ? Number(body[2]) : m.raw.length;
            lit = m.raw.subarray(start, start + len);
            parts.push(`BODY[]${body[1] ? `<${start}>` : ""} {${lit.length}}`);
          }
          if (lit) {
            conn.write(`* ${seq} FETCH (${parts.join(" ")}\r\n`);
            conn.socket.write(lit);
            conn.write(")\r\n");
          } else conn.write(`* ${seq} FETCH (${parts.join(" ")})\r\n`);
        });
        return ok();
      }
      default:
        return conn.write(`${tag} BAD unknown command ${cmd}\r\n`);
    }
  };
}

// ── POP3 ────────────────────────────────────────────────────
function pop3Handler(state, mailboxes, events) {
  return (line, conn) => {
    const [cmdRaw, ...args] = line.split(" ");
    const cmd = cmdRaw.toUpperCase();
    const msgs = () => mailboxes.get(state.user) ?? [];
    const uidl = (m) => `uidl-${m.uid}-${state.user.split("@")[0]}`;
    switch (cmd) {
      case "CAPA":
        return conn.write(`+OK Capability list follows\r\nUSER\r\nUIDL\r\nTOP\r\n${conn.secure ? "" : "STLS\r\n"}.\r\n`);
      case "STLS":
        if (conn.secure) return conn.write("-ERR already secure\r\n");
        conn.write("+OK Begin TLS negotiation\r\n");
        return conn.upgrade();
      case "USER":
        if (!conn.secure) events.push({ type: "plaintext-auth", proto: "pop3", user: args[0] });
        state.pendingUser = args.join(" ");
        return conn.write("+OK\r\n");
      case "PASS": {
        events.push({ type: "auth", proto: "pop3", user: state.pendingUser, secure: conn.secure, port: conn.socket.localPort });
        if (!conn.secure) return conn.write("-ERR [AUTH] Plaintext authentication disallowed\r\n");
        const acc = findAccount(state.pendingUser, args.join(" "), "pop3");
        if (!acc) return conn.write("-ERR [AUTH] Authentication failed.\r\n");
        state.user = acc.user;
        return conn.write("+OK Logged in.\r\n");
      }
      case "STAT": {
        if (!state.user) return conn.write("-ERR not authenticated\r\n");
        return conn.write(`+OK ${msgs().length} ${msgs().reduce((s, m) => s + m.raw.length, 0)}\r\n`);
      }
      case "LIST": case "UIDL": {
        if (!state.user) return conn.write("-ERR not authenticated\r\n");
        const val = (m) => (cmd === "UIDL" ? uidl(m) : m.raw.length);
        if (args[0]) {
          const m = msgs()[Number(args[0]) - 1];
          return conn.write(m ? `+OK ${args[0]} ${val(m)}\r\n` : "-ERR no such message\r\n");
        }
        return conn.write(`+OK\r\n${msgs().map((m, i) => `${i + 1} ${val(m)}\r\n`).join("")}.\r\n`);
      }
      case "RETR": case "TOP": {
        if (!state.user) return conn.write("-ERR not authenticated\r\n");
        const m = msgs()[Number(args[0]) - 1];
        if (!m) return conn.write("-ERR no such message\r\n");
        let text = m.raw.toString("utf8");
        if (cmd === "TOP") text = text.slice(0, text.indexOf("\r\n\r\n") + 4);
        const stuffed = text.replace(/\r\n$/, "").split("\r\n").map((l) => (l.startsWith(".") ? `.${l}` : l)).join("\r\n");
        return conn.write(`+OK ${m.raw.length} octets\r\n${stuffed}\r\n.\r\n`);
      }
      case "DELE":
        events.push({ type: "pop3-dele", user: state.user, n: args[0] });
        return conn.write("-ERR deleting is disabled on the test server\r\n");
      case "NOOP": case "RSET": return conn.write("+OK\r\n");
      case "QUIT": conn.write("+OK bye\r\n"); return conn.socket.end();
      default: return conn.write("-ERR unknown command\r\n");
    }
  };
}

// ── SMTP ────────────────────────────────────────────────────
function smtpHandler(state, events, sent) {
  return (line, conn) => {
    if (state.data) {
      if (line === ".") {
        state.data = false;
        sent.push({ from: state.from, to: state.to, raw: state.lines.join("\r\n") });
        state.lines = [];
        return conn.write("250 OK queued\r\n");
      }
      state.lines.push(line.startsWith("..") ? line.slice(1) : line);
      return;
    }
    if (state.authLogin) {
      const step = state.authLogin;
      if (step.stage === "user") { step.user = Buffer.from(line, "base64").toString("utf8"); step.stage = "pass"; return conn.write("334 UGFzc3dvcmQ6\r\n"); }
      state.authLogin = null;
      return finishAuth(step.user, Buffer.from(line, "base64").toString("utf8"));
    }
    const cmd = line.split(" ")[0].toUpperCase();
    function finishAuth(user, pass) {
      events.push({ type: "auth", proto: "smtp", user, secure: conn.secure, port: conn.socket.localPort });
      if (!conn.secure) {
        events.push({ type: "plaintext-auth", proto: "smtp", user });
        return conn.write("538 5.7.11 Encryption required\r\n");
      }
      const acc = findAccount(user, pass, "smtp");
      if (!acc) return conn.write("535 5.7.8 Error: authentication failed\r\n");
      state.user = acc.user;
      return conn.write("235 2.7.0 Authentication successful\r\n");
    }
    switch (cmd) {
      case "EHLO": case "HELO":
        return conn.write(`250-mail.hosting90.test\r\n250-PIPELINING\r\n250-8BITMIME\r\n${conn.secure ? "250-AUTH PLAIN LOGIN\r\n" : "250-STARTTLS\r\n"}250 SMTPUTF8\r\n`);
      case "STARTTLS":
        if (conn.secure) return conn.write("503 already secure\r\n");
        conn.write("220 2.0.0 Ready to start TLS\r\n");
        return conn.upgrade();
      case "AUTH": {
        const [, mech, initial] = line.split(" ");
        if (String(mech).toUpperCase() === "PLAIN") {
          if (!initial) { state.authPlain = true; return conn.write("334 \r\n"); }
          const p = Buffer.from(initial, "base64").toString("utf8").split("\0");
          return finishAuth(p[1], p[2]);
        }
        if (String(mech).toUpperCase() === "LOGIN") {
          state.authLogin = { stage: "user" };
          if (initial) { state.authLogin = { stage: "pass", user: Buffer.from(initial, "base64").toString("utf8") }; return conn.write("334 UGFzc3dvcmQ6\r\n"); }
          return conn.write("334 VXNlcm5hbWU6\r\n");
        }
        return conn.write("504 unsupported\r\n");
      }
      case "MAIL": if (!state.user) return conn.write("530 auth required\r\n"); state.from = line; state.to = []; return conn.write("250 OK\r\n");
      case "RCPT": state.to.push(line); return conn.write("250 OK\r\n");
      case "DATA": state.data = true; state.lines = []; return conn.write("354 End data with <CR><LF>.<CR><LF>\r\n");
      case "RSET": case "NOOP": return conn.write("250 OK\r\n");
      case "QUIT": conn.write("221 bye\r\n"); return conn.socket.end();
      default:
        if (state.authPlain) {
          state.authPlain = false;
          const p = Buffer.from(line, "base64").toString("utf8").split("\0");
          return finishAuth(p[1], p[2]);
        }
        return conn.write("502 unknown\r\n");
    }
  };
}

// ── Start ───────────────────────────────────────────────────
export async function startMailTestServer({ dir = path.join(os.tmpdir(), "mnastrojarna-mail-test"), base = 24000, host = "127.0.0.1" } = {}) {
  const certs = ensureCerts(dir);
  const mailboxes = new Map(ACCOUNTS.map((a) => [a.user, makeMessages(a.user)]));
  const sentBoxes = new Map(ACCOUNTS.map((a) => [a.user, []])); // IMAP složka „Sent" (\Sent), plní ji APPEND
  const events = [];
  const sent = [];
  const servers = [];
  const sockets = new Set();
  const greet = { imap: (secure) => `* OK [CAPABILITY IMAP4rev1 ID NAMESPACE${secure ? "" : " STARTTLS LOGINDISABLED"}] Mnastrojarna E2E IMAP ready\r\n`, pop3: "+OK Mnastrojarna E2E POP3 ready\r\n", smtp: "220 mail.hosting90.test ESMTP E2E\r\n" };

  const listen = (port, proto, mode, ctxName = "main") =>
    new Promise((resolve, reject) => {
      const ctx = certs[ctxName];
      const onSocket = (sock) => {
        sockets.add(sock);
        sock.on("close", () => sockets.delete(sock));
        if (proto === "blackhole") { sock.on("error", () => {}); return; }
        const state = {};
        const handler = proto === "imap" ? imapHandler(state, mailboxes, events, sentBoxes) : proto === "pop3" ? pop3Handler(state, mailboxes, events) : smtpHandler(state, events, sent);
        const conn = new Conn(sock, ctx, handler, events, proto);
        events.push({ type: "connect", proto, port, secure: conn.secure });
        conn.write(typeof greet[proto] === "function" ? greet[proto](conn.secure) : greet[proto]);
      };
      const srv = mode === "tls" ? tls.createServer({ ...ctx }, onSocket) : net.createServer(onSocket);
      srv.on("tlsClientError", () => {});
      srv.once("error", reject);
      srv.listen(port, host, () => { servers.push(srv); resolve(); });
    });

  const ports = {
    imaps: base + 993, imap: base + 143, pop3s: base + 995, pop3: base + 110, smtps: base + 465, smtp: base + 587,
    blackhole: base + 999, closed: base + 998, nameonlyImaps: base + 1993, nameonlyPop3s: base + 1995, nameonlySmtps: base + 1465,
  };
  try {
    await listen(ports.imaps, "imap", "tls");
    await listen(ports.imap, "imap", "plain");
    await listen(ports.pop3s, "pop3", "tls");
    await listen(ports.pop3, "pop3", "plain");
    await listen(ports.smtps, "smtp", "tls");
    await listen(ports.smtp, "smtp", "plain");
    await listen(ports.blackhole, "blackhole", "plain");
    await listen(ports.nameonlyImaps, "imap", "tls", "nameonly");
    await listen(ports.nameonlyPop3s, "pop3", "tls", "nameonly");
    await listen(ports.nameonlySmtps, "smtp", "tls", "nameonly");
  } catch (err) {
    await Promise.all(servers.map((s) => new Promise((r) => s.close(() => r()))));
    throw err;
  }

  return {
    ports,
    caFile: certs.caFile,
    accounts: ACCOUNTS,
    events,
    sent,
    /**
     * Přidá zprávu do INBOXu (test inkrementálního stahování, odpověď zákazníka s In-Reply-To,
     * příloha). Vrací UID; `lastMessageId` = její Message-ID.
     */
    addMessage(user, opts) {
      const list = mailboxes.get(user);
      const uid = (list.at(-1)?.uid ?? 0) + 1;
      const msg = buildMessage(user, uid, opts);
      list.push(msg);
      this.lastMessageId = msg.messageId;
      return uid;
    },
    lastMessageId: null,
    /** Hromadně `count` zpráv („Archiv 1"…), data rozložená do minulosti po `stepHours` (fetch-all). */
    addMessages(user, count, { prefix = "Archiv", stepHours = 6, from = "Archiv <archiv@zakaznik.test>" } = {}) {
      const list = mailboxes.get(user);
      const now = Date.now();
      for (let i = 0; i < count; i++) {
        const uid = (list.at(-1)?.uid ?? 0) + 1;
        list.push(buildMessage(user, uid, { subject: `${prefix} ${i + 1}`, body: `Zpráva ${i + 1} z archivu.`, from, date: new Date(now - (count - i) * stepHours * 3600_000) }));
      }
      return list.length;
    },
    /** Zprávy složky („INBOX" / „Sent") — kontrola kopií odeslaných (APPEND). */
    folder(user, name = "Sent") {
      return (name === "Sent" ? sentBoxes.get(user) : mailboxes.get(user)) ?? [];
    },
    async close() {
      for (const s of sockets) s.destroy();
      await Promise.all(servers.map((s) => new Promise((r) => s.close(() => r()))));
    },
  };
}

/**
 * Testovací „poskytovatelé" pro aplikaci (MAIL_TEST_PROVIDERS): jako předvolba hosting90 — ověřená
 * jména serverů. Záměrně „localhost" (certifikát nesedí → aplikace musí najít 127.0.0.1 z certifikátu).
 */
export function e2eProviders(p) {
  const h = (port, tls) => ({ host: "localhost", port, tls });
  return [
    { domains: ["nastrojarstvi.test", "mnastrojarna.test"], label: "hosting90 (test)",
      imap: [h(p.imaps, "tls"), h(p.imap, "starttls")], pop3: [h(p.pop3s, "tls"), h(p.pop3, "starttls")], smtp: [h(p.smtps, "tls"), h(p.smtp, "starttls")] },
    { domains: ["pop3only.test"], label: "jen POP3 (test)",
      imap: [{ host: "127.0.0.1", port: p.closed, tls: "tls" }], pop3: [{ host: "127.0.0.1", port: p.pop3s, tls: "tls" }], smtp: [{ host: "127.0.0.1", port: p.smtps, tls: "tls" }] },
    { domains: ["jinycert.test"], label: "cizí certifikát (test)",
      imap: [h(p.nameonlyImaps, "tls")], pop3: [], smtp: [h(p.nameonlySmtps, "tls")] },
  ];
}

// CLI
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const arg = (name, def) => {
    const i = process.argv.indexOf(name);
    return i >= 0 ? process.argv[i + 1] : def;
  };
  const dir = path.resolve(arg("--dir", path.join(os.tmpdir(), "mnastrojarna-mail-test")));
  const base = Number(arg("--base", process.env.MAIL_TEST_BASE ?? 24000));
  const srv = await startMailTestServer({ dir, base });
  // Ovládání pro E2E (jen 127.0.0.1): GET /events (pokusy o přihlášení…), GET /sent (zprávy přijaté přes SMTP),
  // GET /folder?user=&name=Sent (složka na IMAP serveru), POST /add?user=&count=&prefix= (hromadně do INBOXu),
  // POST /message?user= s JSON { subject, body, from, inReplyTo, references, attachments:[{filename, contentType, base64}] }
  const control = http.createServer((req, res) => {
    const url = new URL(req.url ?? "/", "http://127.0.0.1");
    const reply = (code, body) => { res.writeHead(code, { "Content-Type": "application/json" }); res.end(JSON.stringify(body)); };
    const user = url.searchParams.get("user") ?? "";
    if (req.method === "POST" && (url.pathname === "/add" || url.pathname === "/message")) {
      let data = "";
      req.on("data", (c) => { data += c; });
      req.on("end", () => {
        if (!srv.folder(user, "INBOX").length && !ACCOUNTS.some((a) => a.user === user)) return reply(404, { error: "unknown user" });
        if (url.pathname === "/add") {
          const total = srv.addMessages(user, Number(url.searchParams.get("count") ?? 10), { prefix: url.searchParams.get("prefix") ?? "Archiv" });
          return reply(200, { total });
        }
        try {
          const j = JSON.parse(data || "{}");
          const attachments = (j.attachments ?? []).map((a) => ({ filename: a.filename, contentType: a.contentType, content: Buffer.from(a.base64 ?? "", "base64") }));
          const uid = srv.addMessage(user, { ...j, attachments });
          return reply(200, { uid, messageId: srv.lastMessageId });
        } catch (err) {
          return reply(400, { error: String(err) });
        }
      });
      return;
    }
    const body = url.pathname === "/events"
      ? srv.events
      : url.pathname === "/sent"
        // ?full=1 = celý zdroj zprávy (E2E 25: HTML podpis a vložené logo)
        ? srv.sent.map(({ from, to, raw }) => ({ from, to, raw: url.searchParams.get("full") === "1" ? raw : raw.slice(0, 4000) }))
        : url.pathname === "/folder"
          ? srv.folder(user, url.searchParams.get("name") ?? "Sent").map((m) => ({ uid: m.uid, subject: m.subject, messageId: m.messageId, raw: m.raw.toString("utf8").slice(0, 6000) }))
          : null;
    reply(body ? 200 : 404, body ?? { error: "not found" });
  });
  const controlPort = base + 80;
  await new Promise((resolve, reject) => { control.once("error", reject); control.listen(controlPort, "127.0.0.1", resolve); });
  srv.ports.control = controlPort;
  const info = { pid: process.pid, caFile: srv.caFile, ports: srv.ports, accounts: ACCOUNTS.map(({ user, pass, imap, pop3 }) => ({ user, pass, imap, pop3 })) };
  fs.writeFileSync(path.join(dir, "server.json"), JSON.stringify(info, null, 2));
  // Hodnota MAIL_TEST_PROVIDERS pro aplikaci (E2E 12): domény testovacích účtů → servery tohoto procesu
  fs.writeFileSync(path.join(dir, "providers.json"), JSON.stringify(e2eProviders(srv.ports)));
  console.log(JSON.stringify(info));
  const stop = async () => { control.close(); await srv.close(); process.exit(0); };
  process.on("SIGTERM", stop);
  process.on("SIGINT", stop);
}
