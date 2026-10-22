#!/usr/bin/env node
// Generuje HS256 JWT klíče (anon / service_role) pro lokální Supabase stack.
// Klíče jsou deterministické (pevné iat/exp) → po každém startu stejné.
//
//   node tools/local-supabase/keys.mjs          → ANON_KEY=… / SERVICE_ROLE_KEY=…
//   node tools/local-supabase/keys.mjs --json   → {"anon":"…","service_role":"…"}
//   import { signJwt, anonKey, serviceRoleKey } from "./keys.mjs"
import { createHmac } from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const JWT_SECRET =
  process.env.LOCAL_SUPABASE_JWT_SECRET ?? "super-secret-jwt-token-with-at-least-32-characters-long";

const b64url = (input) =>
  Buffer.from(typeof input === "string" ? input : JSON.stringify(input))
    .toString("base64")
    .replace(/=+$/, "")
    .replace(/\+/g, "-")
    .replace(/\//g, "_");

export function signJwt(payload, secret = JWT_SECRET) {
  const head = b64url({ alg: "HS256", typ: "JWT" });
  const body = b64url(payload);
  const sig = createHmac("sha256", secret).update(`${head}.${body}`).digest("base64url");
  return `${head}.${body}.${sig}`;
}

const IAT = 1735689600; // 2025-01-01
const EXP = 4102444800; // 2100-01-01

export const anonKey = signJwt({ iss: "supabase-demo", role: "anon", iat: IAT, exp: EXP });
export const serviceRoleKey = signJwt({ iss: "supabase-demo", role: "service_role", iat: IAT, exp: EXP });

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  if (process.argv.includes("--json")) {
    process.stdout.write(JSON.stringify({ anon: anonKey, service_role: serviceRoleKey }) + "\n");
  } else {
    process.stdout.write(`ANON_KEY=${anonKey}\nSERVICE_ROLE_KEY=${serviceRoleKey}\n`);
  }
}
