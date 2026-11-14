/**
 * Bezpečnost `mncad serve` (CAD-HEADLESS-NAVRH.md kap. 3.2) – výchozí stav, ne volba:
 *
 * * **token povinný** – bez `--token-file` se vygeneruje 32 bajtů (`crypto.randomBytes`) do `~/.config/mncad/token`
 *   (práva 0600, složka 0700) a cesta se vypíše na stderr; požadavek bez platného `Authorization: Bearer` → 401;
 * * **původ** – hlavička `Origin` (jakákoli) nebo `Sec-Fetch-Site` mimo `none`/`same-origin` → 403 (CSRF z cizí stránky);
 * * **DNS rebinding** – `Host` musí být `127.0.0.1:<port>`, `localhost:<port>`, `[::1]:<port>` nebo místní adresa
 *   naslouchání (`--host 127.0.0.2` → `127.0.0.2:<port>`) → jinak 403;
 * * **jen JSON** – `POST /run` jen s `Content-Type: application/json` (415 jinak), tělo nejvýš 64 MB (413);
 * * **jiná adresa než loopback** jen s `--allow-remote` a výslovným `--token-file` (jinak chyba použití, kód 3).
 *
 * Odpovědi nenesou žádné hlavičky CORS – preflight `OPTIONS` prohlížeče nikdy nedostane povolení.
 */
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { tr } from "../i18n";
import { UsageError } from "./args";

/** největší tělo požadavku (B) */
export const BODY_MAX = 64 * 1024 * 1024;
/** nejkratší přípustný token (znaky) */
export const TOKEN_MIN = 16;

export const isLoopbackHost = (h: string) => /^(127(?:\.\d{1,3}){3}|localhost|::1|\[::1\])$/i.test(h.trim());

/** výchozí soubor tokenu: `$XDG_CONFIG_HOME/mncad/token`, jinak `~/.config/mncad/token` */
export function defaultTokenFile(env: Record<string, string | undefined> = process.env, home = os.homedir()): string {
  const base = env.XDG_CONFIG_HOME && path.isAbsolute(env.XDG_CONFIG_HOME) ? env.XDG_CONFIG_HOME : path.join(home, ".config");
  return path.join(base, "mncad", "token");
}

export type TokenInfo = { token: string; file: string; created: boolean };

/**
 * Token serveru. `tokenFile` zadaný: musí existovat, nesmí být čitelný pro skupinu ani ostatní (jako klíče SSH) a mít
 * aspoň `TOKEN_MIN` znaků. Bez zadání: výchozí soubor; neexistuje-li, vygeneruje se (0600).
 */
export function loadOrCreateToken(tokenFile: string | undefined, env: Record<string, string | undefined> = process.env, home = os.homedir()): TokenInfo {
  const file = tokenFile ? path.resolve(tokenFile) : defaultTokenFile(env, home);
  if (!fs.existsSync(file)) {
    if (tokenFile) throw new UsageError(tr("soubor tokenu „{0}“ neexistuje", file));
    fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
    const token = crypto.randomBytes(32).toString("base64url");
    const fd = fs.openSync(file, "wx", 0o600);
    try {
      fs.writeFileSync(fd, token + "\n");
    } finally {
      fs.closeSync(fd);
    }
    fs.chmodSync(file, 0o600);
    return { token, file, created: true };
  }
  const st = fs.statSync(file);
  if (!st.isFile()) throw new UsageError(tr("soubor tokenu „{0}“ není soubor", file));
  if (process.platform !== "win32" && st.mode & 0o077) throw new UsageError(tr("soubor tokenu „{0}“ mohou číst i jiní uživatelé (práva {1}) – nastavte chmod 600", file, (st.mode & 0o777).toString(8)));
  const token = fs.readFileSync(file, "utf8").trim();
  if (token.length < TOKEN_MIN || /\s/.test(token)) throw new UsageError(tr("token v „{0}“ je kratší než {1} znaků nebo obsahuje mezery", file, TOKEN_MIN));
  return { token, file, created: false };
}

/** Kontrola adresy naslouchání: jiná než loopback jen s `--allow-remote` a výslovným `--token-file`. */
export function validateBind(host: string, allowRemote: boolean, tokenFile: string | undefined): void {
  if (isLoopbackHost(host)) return;
  if (!allowRemote) throw new UsageError(tr("adresa „{0}“ není místní (loopback) – naslouchat na síti jde jen s --allow-remote a --token-file", host));
  if (!tokenFile) throw new UsageError(tr("--allow-remote vyžaduje výslovný --token-file (token se negeneruje automaticky)"));
}

export type SecurityConfig = {
  token: string;
  port: number;
  /** adresa naslouchání (`--host`); místní (127.x.x.x, localhost, ::1) se přidá k povoleným hodnotám Host */
  bind?: string;
  /** s `--allow-remote`: adresa naslouchání a další názvy hostitele (`--allow-host`); bez výčtu u 0.0.0.0 jakýkoli Host s portem */
  remote?: { bind: string; hosts: string[] };
};

/** přípustné hodnoty hlavičky Host */
export function allowedHosts(cfg: SecurityConfig): Set<string> | null {
  const p = cfg.port;
  const s = new Set([`127.0.0.1:${p}`, `localhost:${p}`, `[::1]:${p}`]);
  const hostPort = (h: string) => `${h.includes(":") && !h.startsWith("[") ? `[${h}]` : h}:${p}`;
  if (cfg.bind && isLoopbackHost(cfg.bind)) s.add(hostPort(cfg.bind.trim().toLowerCase()));
  if (cfg.remote) {
    const bind = cfg.remote.bind.toLowerCase();
    const wild = bind === "0.0.0.0" || bind === "::" || bind === "[::]";
    if (wild && !cfg.remote.hosts.length) return null;
    if (!wild) s.add(`${bind.includes(":") && !bind.startsWith("[") ? `[${bind}]` : bind}:${p}`);
    for (const h of cfg.remote.hosts) s.add(h.includes(":") && !h.startsWith("[") && /:\d+$/.test(h) ? h : `${h}:${p}`);
  }
  return s;
}

/** porovnání tokenů v konstantním čase */
export function tokenEquals(a: string, b: string): boolean {
  const x = crypto.createHash("sha256").update(a).digest();
  const y = crypto.createHash("sha256").update(b).digest();
  return crypto.timingSafeEqual(x, y) && a.length === b.length;
}

export type Rejection = { status: 401 | 403 | 413 | 415; code: string; message: string };
type Headers = Record<string, string | string[] | undefined>;
const one = (h: string | string[] | undefined) => (Array.isArray(h) ? h[0] : h);

/**
 * Kontrola hlaviček každého požadavku (pořadí: Host → Origin → Sec-Fetch-Site → token). Vrací odmítnutí, nebo null.
 * Typ obsahu a velikost těla kontroluje `checkBody` (jen `POST /run`).
 */
export function checkRequest(headers: Headers, cfg: SecurityConfig): Rejection | null {
  const host = (one(headers.host) ?? "").trim().toLowerCase();
  const hosts = allowedHosts(cfg);
  const hostOk = hosts ? hosts.has(host) : new RegExp(`:${cfg.port}$`).test(host);
  if (!hostOk) return { status: 403, code: "host", message: tr("hlavička Host „{0}“ není povolená (ochrana proti DNS rebinding)", host || "—") };
  if (headers.origin !== undefined) return { status: 403, code: "origin", message: tr("požadavky z prohlížeče (hlavička Origin) nejsou povolené") };
  const sfs = one(headers["sec-fetch-site"]);
  if (sfs !== undefined && !["none", "same-origin"].includes(sfs.trim().toLowerCase())) return { status: 403, code: "sec-fetch-site", message: tr("Sec-Fetch-Site „{0}“ není povolené", sfs) };
  const auth = one(headers.authorization) ?? "";
  const m = /^Bearer\s+(\S+)\s*$/i.exec(auth);
  if (!m || !tokenEquals(m[1], cfg.token)) return { status: 401, code: "token", message: tr("chybí nebo neplatný token (Authorization: Bearer …)") };
  return null;
}

/** `POST /run`: jen `application/json` (s volitelným charset) a tělo do `BODY_MAX` */
export function checkBody(headers: Headers, max = BODY_MAX): Rejection | null {
  const ct = (one(headers["content-type"]) ?? "").toLowerCase();
  if (!/^application\/json\s*(;\s*charset\s*=\s*"?utf-8"?\s*)?$/.test(ct.trim())) return { status: 415, code: "content-type", message: tr("tělo musí být application/json, ne „{0}“", ct || "—") };
  const len = Number(one(headers["content-length"]));
  if (Number.isFinite(len) && len > max) return { status: 413, code: "too-large", message: tr("tělo je větší než {0} MB", Math.round(max / 1048576)) };
  return null;
}
