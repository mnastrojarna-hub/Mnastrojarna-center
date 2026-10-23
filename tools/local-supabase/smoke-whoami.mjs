#!/usr/bin/env node
// Smoke „kdo to udělal" po nasazení: předá PostgREST hlavičky autora (x-actor-*) až do DB?
//   node tools/local-supabase/smoke-whoami.mjs [<url> <secret_key> [<publishable_key>]]
//   bez argumentů čte NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SECRET_KEY / NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY
//   volitelně SMOKE_EMAIL + SMOKE_PASSWORD = ověří i session (podvržená x-actor-id se ignoruje).
// Kontroluje app_whoami(): servisní klíč s hlavičkami → ctx „app" a autor z hlavičky; bez hlaviček →
// „service"; session → autor = přihlášený; anon → bez práva. Nic nezapisuje.
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const appRequire = createRequire(path.join(path.resolve(HERE, "../.."), "package.json"));
const { createClient } = appRequire("@supabase/supabase-js");

const [argUrl, argSecret, argAnon] = process.argv.slice(2);
const URL_BASE = argUrl ?? process.env.NEXT_PUBLIC_SUPABASE_URL ?? "http://localhost:54321";
const SECRET = argSecret ?? process.env.SUPABASE_SECRET_KEY;
const ANON = argAnon ?? process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
if (!SECRET) {
  console.error("Chybí servisní klíč (argument nebo SUPABASE_SECRET_KEY).");
  process.exit(2);
}
const auth = { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false };
const client = (key, headers = {}) => createClient(URL_BASE, key, { auth, global: { headers } });

let failed = 0;
function check(label, cond, info) {
  console.log(`  ${cond ? "✓" : "✗"} ${label}${info ? ` — ${info}` : ""}`);
  if (!cond) failed++;
}

async function whoami(c) {
  const { data, error } = await c.rpc("app_whoami");
  if (error) throw Object.assign(new Error(error.message), { code: error.code });
  return data;
}

const plain = client(SECRET);
const { data: prof, error: pErr } = await plain.from("profiles").select("id, full_name").limit(1).maybeSingle();
if (pErr || !prof) {
  console.error(`Nelze načíst profil pro test: ${pErr?.message ?? "žádný profil"}`);
  process.exit(1);
}
const note = Buffer.from("Smoke ✓ — ž", "utf8").toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const request = "11111111-2222-4333-8444-555555555555";

console.log(`Smoke „kdo to udělal" → ${URL_BASE}`);
const app = await whoami(client(SECRET, {
  "x-actor-id": prof.id, "x-actor-kind": "user", "x-actor-via": "rucne", "x-actor-request": request, "x-change-note": note,
}));
check("servisní klíč + hlavičky → ctx app", app?.ctx === "app", JSON.stringify(app));
check("autor z hlavičky", app?.actor === prof.id, prof.full_name ?? prof.id);
check("request id a poznámka (UTF-8)", app?.request === request && app?.note === "Smoke ✓ — ž");
check("servisní role rozpoznaná", app?.service === true);

const svc = await whoami(plain);
check("servisní klíč bez hlaviček → ctx service, bez autora", svc?.ctx === "service" && svc?.actor === null, JSON.stringify(svc));

const ai = await whoami(client(SECRET, { "x-actor-kind": "ai", "x-actor-agent": "email-ingest" }));
check("AI bez uživatele → kind ai, agent", ai?.kind === "ai" && ai?.agent === "email-ingest" && ai?.via === "ai");

if (ANON) {
  try {
    await whoami(client(ANON, { "x-actor-id": prof.id, "x-actor-kind": "user" }));
    check("anon nesmí app_whoami", false);
  } catch (err) {
    check("anon nesmí app_whoami (42501)", err.code === "42501", err.code);
  }
  const email = process.env.SMOKE_EMAIL;
  const password = process.env.SMOKE_PASSWORD;
  if (email && password) {
    // podvrh: cizí profil v hlavičce (jiný než přihlášený)
    const { data: other } = await plain.from("profiles").select("id").neq("email", email.toLowerCase()).limit(1).maybeSingle();
    const s = client(ANON, { "x-actor-id": other?.id ?? prof.id, "x-actor-kind": "system" });
    const { data: login, error } = await s.auth.signInWithPassword({ email, password });
    if (error) check("přihlášení pro test session", false, error.message);
    else {
      const me = await whoami(s);
      check("session: autor = přihlášený, podvržená hlavička se ignoruje",
        me?.ctx === "session" && me?.actor === login.user.id && me?.kind === "user", JSON.stringify(me));
      await s.auth.signOut({ scope: "local" }).catch(() => undefined);
    }
  }
}

if (failed) {
  console.error(`\nSMOKE WHOAMI SELHAL (${failed}) — autor změn by se v DB nezapsal („Systém").`);
  process.exit(1);
}
console.log("\nSMOKE WHOAMI OK");
