#!/usr/bin/env node
// Lokální API gateway (náhrada Kongu ze Supabase) — bez závislostí.
//
//   http://localhost:54321/rest/v1/*     → PostgREST  127.0.0.1:54330
//   http://localhost:54321/auth/v1/*     → GoTrue     127.0.0.1:54331
//   http://localhost:54321/storage/v1/*  → Storage    127.0.0.1:54332
//   http://localhost:54321/health        → stav upstreamů
//
// Chová se jako Kong: CORS (vč. preflight), a když chybí Authorization a je zadán
// `apikey`, doplní `Authorization: Bearer <apikey>`.
import http from "node:http";

const PORT = Number(process.env.GATEWAY_PORT ?? 54321);
const ROUTES = [
  { prefix: "/rest/v1", port: Number(process.env.POSTGREST_PORT ?? 54330), name: "rest" },
  { prefix: "/auth/v1", port: Number(process.env.GOTRUE_PORT ?? 54331), name: "auth" },
  { prefix: "/storage/v1", port: Number(process.env.STORAGE_PORT ?? 54332), name: "storage" },
];
const agent = new http.Agent({ keepAlive: true, maxSockets: 256 });

const HOP_BY_HOP = new Set([
  "connection",
  "keep-alive",
  "proxy-authenticate",
  "proxy-authorization",
  "te",
  "trailer",
  "transfer-encoding",
  "upgrade",
]);

function corsHeaders(req) {
  const origin = req.headers.origin;
  return {
    "access-control-allow-origin": origin || "*",
    ...(origin ? { "access-control-allow-credentials": "true", vary: "Origin" } : {}),
    "access-control-allow-methods": "GET, HEAD, POST, PUT, PATCH, DELETE, OPTIONS",
    "access-control-allow-headers":
      req.headers["access-control-request-headers"] ||
      "authorization, x-client-info, apikey, content-type, content-profile, accept-profile, prefer, range, x-upsert, cache-control, x-supabase-api-version, x-region",
    "access-control-expose-headers":
      "content-range, content-length, content-type, content-location, location, preference-applied, range-unit, x-total-count, x-supabase-api-version, etag, sb-gateway-version",
    "access-control-max-age": "3600",
  };
}

function json(res, req, status, body) {
  res.writeHead(status, { "content-type": "application/json; charset=utf-8", ...corsHeaders(req) });
  res.end(JSON.stringify(body));
}

function probe(port) {
  return new Promise((resolve) => {
    const r = http.get({ host: "127.0.0.1", port, path: "/", timeout: 1500, agent }, (res) => {
      res.resume();
      resolve(res.statusCode ?? 0);
    });
    r.on("error", () => resolve(0));
    r.on("timeout", () => {
      r.destroy();
      resolve(0);
    });
  });
}

async function handle(req, res) {
  const url = req.url || "/";
  if (req.method === "OPTIONS") {
    res.writeHead(204, corsHeaders(req));
    return res.end();
  }
  if (url === "/health" || url === "/") {
    const statuses = {};
    for (const r of ROUTES) statuses[r.name] = await probe(r.port);
    return json(res, req, 200, { ok: true, upstreams: statuses });
  }
  const route = ROUTES.find((r) => url === r.prefix || url.startsWith(r.prefix + "/") || url.startsWith(r.prefix + "?"));
  if (!route) return json(res, req, 404, { message: "no Route matched with those values", path: url });

  let upstreamPath = url.slice(route.prefix.length) || "/";
  if (!upstreamPath.startsWith("/")) upstreamPath = "/" + upstreamPath;

  const headers = {};
  for (const [k, v] of Object.entries(req.headers)) {
    if (!HOP_BY_HOP.has(k) && k !== "host") headers[k] = v;
  }
  if (!headers.authorization && headers.apikey) headers.authorization = `Bearer ${headers.apikey}`;
  headers.host = `127.0.0.1:${route.port}`;
  headers["x-forwarded-host"] = req.headers.host || `localhost:${PORT}`;
  headers["x-forwarded-proto"] = "http";
  headers["x-forwarded-port"] = String(PORT);
  headers["x-forwarded-prefix"] = route.prefix;
  headers["x-forwarded-for"] = [req.headers["x-forwarded-for"], req.socket.remoteAddress].filter(Boolean).join(", ");

  const up = http.request(
    { host: "127.0.0.1", port: route.port, method: req.method, path: upstreamPath, headers, agent },
    (upRes) => {
      const out = {};
      for (const [k, v] of Object.entries(upRes.headers)) {
        if (HOP_BY_HOP.has(k) || k.startsWith("access-control-")) continue;
        out[k] = v;
      }
      Object.assign(out, corsHeaders(req), { "sb-gateway-version": "local" });
      res.writeHead(upRes.statusCode || 502, upRes.statusMessage, out);
      upRes.pipe(res);
    },
  );
  up.on("error", (err) => {
    if (res.headersSent) return res.destroy(err);
    json(res, req, 502, { message: `upstream ${route.name} unavailable`, error: String(err.message) });
  });
  res.on("close", () => {
    if (!res.writableFinished) up.destroy();
  });
  req.pipe(up);
}

function upgrade(_req, socket) {
  // Realtime (websocket) lokálně neběží
  socket.end("HTTP/1.1 501 Not Implemented\r\nconnection: close\r\n\r\n");
}

for (const host of ["127.0.0.1", "::1"]) {
  const s = http.createServer(handle);
  s.on("upgrade", upgrade);
  s.requestTimeout = 0; // velké uploady (storage) bez časového limitu
  s.keepAliveTimeout = 65000;
  s.headersTimeout = 66000;
  s.on("error", (err) => {
    if (host === "::1") return; // IPv6 není k dispozici
    console.error(`[gateway] ${host}:${PORT}`, err);
    process.exit(1);
  });
  s.listen(PORT, host, () => console.log(`[gateway] listening on http://${host.includes(":") ? `[${host}]` : host}:${PORT}`));
}

for (const sig of ["SIGINT", "SIGTERM"]) process.on(sig, () => process.exit(0));
