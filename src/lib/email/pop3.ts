import net from "node:net";
import tls from "node:tls";

/**
 * Minimální POP3 klient (RFC 1939 + STLS z RFC 2595 + UIDL) — jen čtení, NIKDY nemaže
 * (kopie zůstává na serveru). Heslo jde jen šifrovaně: přímé TLS (995) nebo povinné STLS (110).
 * Bez závislostí; chyby nesou `code` (AUTH, NO_STARTTLS, GREETING_TIMEOUT, TIMEOUT, …) pro
 * classifyMailError().
 */

export interface Pop3Options {
  host: string;
  port: number;
  tls: "tls" | "starttls";
  /** Jméno pro ověření certifikátu (výchozí host); false = neověřovat jméno (výslovný souhlas). */
  checkName?: string | false;
  /** Vlastní CA (testy). */
  ca?: string | Buffer | (string | Buffer)[];
  /** Časový limit jednoho kroku (ms). */
  timeoutMs?: number;
}

export class Pop3Error extends Error {
  code: string;
  responseText?: string;
  authenticationFailed?: boolean;
  constructor(message: string, code: string, responseText?: string) {
    super(message);
    this.code = code;
    this.responseText = responseText;
    if (code === "AUTH") this.authenticationFailed = true;
  }
}

/** Odstraní tečkování řádků (dot-stuffing) z víceřádkové odpovědi. */
export function unstuffLines(body: Buffer): Buffer {
  const text = body.toString("latin1");
  const lines = text.split("\r\n").map((l) => (l.startsWith("..") ? l.slice(1) : l));
  return Buffer.from(lines.join("\r\n"), "latin1");
}

/** „1 abc\r\n2 def" → [{ n: 1, uid: "abc" }, …] */
export function parseUidl(body: string): { n: number; uid: string }[] {
  return body
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean)
    .map((l) => {
      const [n, ...rest] = l.split(/\s+/);
      return { n: Number(n), uid: rest.join(" ") };
    })
    .filter((x) => Number.isInteger(x.n) && x.n > 0 && x.uid);
}

type Waiter = { multi: boolean; resolve: (r: { line: string; body?: Buffer }) => void; reject: (e: Error) => void };

export class Pop3Client {
  private socket: net.Socket | tls.TLSSocket;
  private buf = Buffer.alloc(0);
  private waiters: Waiter[] = [];
  private closed = false;
  private timeoutMs: number;
  secure = false;

  private constructor(socket: net.Socket | tls.TLSSocket, timeoutMs: number) {
    this.socket = socket;
    this.timeoutMs = timeoutMs;
    this.bind(socket);
  }

  private bind(socket: net.Socket | tls.TLSSocket) {
    socket.on("data", (d: Buffer) => this.onData(d));
    socket.on("error", (err: NodeJS.ErrnoException) => this.fail(err));
    socket.on("close", () => {
      this.fail(new Pop3Error("Server ukončil spojení.", "ECONNRESET"));
      this.closed = true;
    });
    socket.setTimeout(this.timeoutMs, () => {
      this.fail(new Pop3Error(`Server neodpověděl do ${Math.round(this.timeoutMs / 1000)} s (časový limit).`, "TIMEOUT"));
      socket.destroy();
    });
  }

  private fail(err: Error) {
    if (this.closed && this.waiters.length === 0) return;
    const w = this.waiters.splice(0);
    for (const x of w) x.reject(err);
  }

  private onData(d: Buffer) {
    this.buf = Buffer.concat([this.buf, d]);
    while (this.waiters.length) {
      const w = this.waiters[0];
      const eol = this.buf.indexOf("\r\n");
      if (eol < 0) return;
      const line = this.buf.subarray(0, eol).toString("utf8");
      if (!w.multi || !line.startsWith("+OK")) {
        this.buf = this.buf.subarray(eol + 2);
        this.waiters.shift();
        w.resolve({ line });
        continue;
      }
      // víceřádková odpověď končí „\r\n.\r\n"
      const rest = this.buf.subarray(eol + 2);
      let end = -1;
      if (rest.subarray(0, 3).toString("latin1") === ".\r\n") end = 0;
      else {
        const i = rest.indexOf("\r\n.\r\n");
        if (i >= 0) end = i + 2;
      }
      if (end < 0) return;
      const body = rest.subarray(0, end === 0 ? 0 : end - 2);
      this.buf = rest.subarray(end + 3);
      this.waiters.shift();
      w.resolve({ line, body: unstuffLines(body) });
    }
  }

  private read(multi: boolean): Promise<{ line: string; body?: Buffer }> {
    return new Promise((resolve, reject) => {
      this.waiters.push({ multi, resolve, reject });
      this.onData(Buffer.alloc(0));
    });
  }

  private async cmd(command: string, multi = false): Promise<{ line: string; body?: Buffer }> {
    if (this.closed) throw new Pop3Error("Spojení je zavřené.", "ECONNRESET");
    const p = this.read(multi);
    this.socket.write(`${command}\r\n`);
    return p;
  }

  private static tlsOpts(o: Pop3Options): tls.ConnectionOptions {
    const name = o.checkName === undefined ? o.host : o.checkName;
    return {
      servername: name && !net.isIP(name) ? name : undefined,
      ca: o.ca as tls.ConnectionOptions["ca"],
      minVersion: "TLSv1.2",
      checkServerIdentity: (_host, cert) => (name === false ? undefined : tls.checkServerIdentity(name, cert)),
    };
  }

  /** Spojení + pozdrav (+ STLS). Heslo se v této fázi neposílá. */
  static async connect(o: Pop3Options): Promise<Pop3Client> {
    const timeoutMs = o.timeoutMs ?? 8000;
    const socket: net.Socket | tls.TLSSocket = await new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        s.destroy();
        reject(new Pop3Error(`Spojení s ${o.host}:${o.port} se nenavázalo do ${Math.round(timeoutMs / 1000)} s.`, "CONNECT_TIMEOUT"));
      }, timeoutMs);
      const s =
        o.tls === "tls"
          ? tls.connect({ host: o.host, port: o.port, ...Pop3Client.tlsOpts(o) }, () => { clearTimeout(timer); resolve(s); })
          : net.connect({ host: o.host, port: o.port }, () => { clearTimeout(timer); resolve(s); });
      s.once("error", (err) => { clearTimeout(timer); reject(err); });
    });
    const client = new Pop3Client(socket, timeoutMs);
    client.secure = o.tls === "tls";
    let greeting: { line: string };
    try {
      greeting = await client.read(false);
    } catch (err) {
      client.close();
      if ((err as Pop3Error).code === "TIMEOUT") throw new Pop3Error("Server se neohlásil jako POP3 (žádný pozdrav).", "GREETING_TIMEOUT");
      throw err;
    }
    if (!greeting.line.startsWith("+OK")) {
      client.close();
      throw new Pop3Error(`Neočekávaný pozdrav serveru: ${greeting.line.slice(0, 120)}`, "GREETING_TIMEOUT", greeting.line);
    }
    if (o.tls === "starttls") {
      const r = await client.cmd("STLS");
      if (!r.line.startsWith("+OK")) {
        client.close();
        throw new Pop3Error("Server nenabízí šifrování STLS (STARTTLS).", "NO_STARTTLS", r.line);
      }
      await client.upgrade(o);
    }
    return client;
  }

  private async upgrade(o: Pop3Options) {
    const raw = this.socket;
    raw.removeAllListeners("data");
    raw.removeAllListeners("error");
    raw.removeAllListeners("close");
    raw.setTimeout(0);
    const secure: tls.TLSSocket = await new Promise((resolve, reject) => {
      const s = tls.connect({ socket: raw, ...Pop3Client.tlsOpts(o) }, () => resolve(s));
      s.once("error", reject);
    });
    this.buf = Buffer.alloc(0);
    this.socket = secure;
    this.secure = true;
    this.bind(secure);
  }

  async login(user: string, pass: string): Promise<void> {
    if (!this.secure) throw new Pop3Error("Spojení není šifrované — heslo neposílám.", "NO_STARTTLS");
    const u = await this.cmd(`USER ${user}`);
    if (!u.line.startsWith("+OK")) throw new Pop3Error("Server odmítl uživatele.", "AUTH", u.line.replace(/^-ERR\s*/, ""));
    const p = await this.cmd(`PASS ${pass}`);
    if (!p.line.startsWith("+OK")) throw new Pop3Error("Server odmítl přihlášení.", "AUTH", p.line.replace(/^-ERR\s*/, ""));
  }

  async stat(): Promise<{ count: number; size: number }> {
    const r = await this.cmd("STAT");
    const m = /^\+OK\s+(\d+)\s+(\d+)/.exec(r.line);
    if (!m) throw new Pop3Error(`STAT selhal: ${r.line}`, "PROTOCOL", r.line);
    return { count: Number(m[1]), size: Number(m[2]) };
  }

  async uidl(): Promise<{ n: number; uid: string }[]> {
    const r = await this.cmd("UIDL", true);
    if (!r.line.startsWith("+OK")) throw new Pop3Error("Server nepodporuje UIDL.", "PROTOCOL", r.line);
    return parseUidl(r.body?.toString("latin1") ?? "");
  }

  /** Celá zpráva (RFC 822). Nic nemaže. */
  async retr(n: number): Promise<Buffer> {
    const r = await this.cmd(`RETR ${n}`, true);
    if (!r.line.startsWith("+OK")) throw new Pop3Error(`Zprávu ${n} nelze stáhnout: ${r.line}`, "PROTOCOL", r.line);
    return r.body ?? Buffer.alloc(0);
  }

  async quit(): Promise<void> {
    try {
      if (!this.closed) await this.cmd("QUIT");
    } catch {
      // ignorovat
    } finally {
      this.close();
    }
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    this.waiters.splice(0);
    this.socket.destroy();
  }
}
