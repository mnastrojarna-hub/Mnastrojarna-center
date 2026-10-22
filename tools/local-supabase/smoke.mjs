#!/usr/bin/env node
// Smoke test lokálního Supabase stacku se SKUTEČNOU knihovnou @supabase/supabase-js z node_modules aplikace.
//   node tools/local-supabase/smoke.mjs     (předtím: start.sh + seed-users.mjs)
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { anonKey, serviceRoleKey } from "./keys.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(HERE, "../..");
const appRequire = createRequire(path.join(REPO_ROOT, "package.json"));
const { createClient } = appRequire("@supabase/supabase-js");
const sbVersion = appRequire("@supabase/supabase-js/package.json").version;

const URL_BASE = process.env.SUPABASE_URL ?? "http://localhost:54321";
const MAIL_API = process.env.LOCAL_MAIL_API ?? "http://127.0.0.1:54324";
const opts = { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } };
const newClient = (key) => createClient(URL_BASE, key, opts);

let passed = 0;
const t0 = Date.now();
async function check(label, fn) {
  const s = Date.now();
  try {
    const info = await fn();
    passed++;
    console.log(`  ✓ ${label}${info ? ` — ${info}` : ""} (${Date.now() - s} ms)`);
  } catch (err) {
    console.error(`  ✗ ${label}\n    ${err?.stack ?? err}`);
    console.error(`\nSMOKE FAILED (${passed} OK před chybou)`);
    process.exit(1);
  }
}
function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}
const ok = (res, what) => {
  if (res.error) throw new Error(`${what}: ${res.error.message ?? JSON.stringify(res.error)}`);
  return res.data;
};

async function signedInClient(email, password) {
  const c = newClient(anonKey);
  const data = ok(await c.auth.signInWithPassword({ email, password }), `signIn ${email}`);
  assert(data.session?.access_token, `žádná session pro ${email}`);
  return c;
}

const ts = Date.now();
const svc = newClient(serviceRoleKey);

console.log(`local-supabase smoke — ${URL_BASE} — @supabase/supabase-js ${sbVersion}`);

// ── (a) servisní klíč: REST, embed, RPC ─────────────────────
console.log("(a) PostgREST se servisním klíčem");
await check("from('profiles').select('*')", async () => {
  const rows = ok(await svc.from("profiles").select("*"), "profiles");
  assert(Array.isArray(rows), "není pole");
  const roles = rows.map((r) => r.role);
  assert(roles.includes("super_admin") && roles.includes("obchodnik") && roles.includes("zamestnanec"),
    `chybí seed role (spusť seed-users.mjs): ${roles.join(",")}`);
  return `${rows.length} profilů`;
});
let customerId, orderId;
await check("insert customers + orders (servisní klíč)", async () => {
  const c = ok(await svc.from("customers").insert({ name: `Smoke s.r.o. ${ts}`, ico: "12345678" }).select().single(), "customers insert");
  customerId = c.id;
  const o = ok(
    await svc.from("orders").insert({ number: `SMOKE-${ts}`, customer_id: c.id, title: "Smoke zakázka" }).select().single(),
    "orders insert",
  );
  orderId = o.id;
  return `order ${o.number}`;
});
await check("from('orders').select('*, customers(name)') (embed)", async () => {
  const rows = ok(await svc.from("orders").select("*, customers(name)").eq("id", orderId), "orders embed");
  assert(rows.length === 1, `očekáván 1 řádek, je ${rows.length}`);
  assert(rows[0].customers?.name === `Smoke s.r.o. ${ts}`, `embed customers.name = ${JSON.stringify(rows[0].customers)}`);
  return `customers.name = "${rows[0].customers.name}"`;
});
await check("rpc('next_doc_number', {p_prefix:'TST'})", async () => {
  const n1 = ok(await svc.rpc("next_doc_number", { p_prefix: "TST" }), "rpc");
  const n2 = ok(await svc.rpc("next_doc_number", { p_prefix: "TST" }), "rpc");
  assert(/^TST-\d{4}-\d{3,}$/.test(n1), `nečekaný formát: ${n1}`);
  assert(n1 !== n2, "čítač se nezvýšil");
  return `${n1}, ${n2}`;
});

// ── (b) auth: admin.createUser + signInWithPassword + getUser ─
console.log("(b) GoTrue: admin API a přihlášení");
const email = `smoke-${ts}@local.test`;
const pw1 = "Smoke123!";
const pw2 = "Smoke456!";
let userId;
await check("auth.admin.createUser", async () => {
  const d = ok(await svc.auth.admin.createUser({ email, password: pw1, email_confirm: true, user_metadata: { full_name: "Smoke Test" } }), "createUser");
  userId = d.user.id;
  assert(d.user.role === "authenticated", `user.role = "${d.user.role}" (GOTRUE_JWT_DEFAULT_GROUP_NAME?)`);
  return userId;
});
await check("signInWithPassword (anon klient) + auth.getUser()", async () => {
  const c = await signedInClient(email, pw1);
  const d = ok(await c.auth.getUser(), "getUser");
  assert(d.user.id === userId, `getUser vrátil ${d.user.id}`);
  const { data: s } = await c.auth.getSession();
  const claims = JSON.parse(Buffer.from(s.session.access_token.split(".")[1], "base64url").toString());
  assert(claims.role === "authenticated", `JWT role claim = "${claims.role}"`);
  return `${d.user.email}, JWT role=${claims.role}`;
});

// ── (c) obnova hesla OTP kódem z e-mailu ─────────────────────
console.log("(c) obnova hesla přes mail catcher");
let token;
await check("resetPasswordForEmail → e-mail s 6místným kódem", async () => {
  await fetch(`${MAIL_API}/messages?to=${encodeURIComponent(email)}`, { method: "DELETE" });
  const anon = newClient(anonKey);
  ok(await anon.auth.resetPasswordForEmail(email, { redirectTo: "http://localhost:3000/reset-hesla" }), "resetPasswordForEmail");
  const res = await fetch(`${MAIL_API}/messages/latest?to=${encodeURIComponent(email)}&wait=15000`);
  assert(res.ok, `mail catcher: e-mail nedorazil (${res.status})`);
  const msg = await res.json();
  token = msg.otp ?? (msg.text.match(/\b(\d{6})\b/) ?? [])[1];
  assert(/^\d{6}$/.test(token ?? ""), `v e-mailu není 6místný kód: ${msg.text.slice(0, 200)}`);
  assert(/verify\?token=/.test(msg.html), "v e-mailu chybí ConfirmationURL");
  return `"${msg.subject}" od ${msg.from}, kód ${token}`;
});
await check("verifyOtp({type:'recovery'}) + updateUser({password})", async () => {
  const c = newClient(anonKey);
  const d = ok(await c.auth.verifyOtp({ email, token, type: "recovery" }), "verifyOtp");
  assert(d.session?.access_token, "verifyOtp nevrátil session");
  ok(await c.auth.updateUser({ password: pw2 }), "updateUser");
  return "heslo změněno";
});
await check("přihlášení novým heslem (a staré nefunguje)", async () => {
  await signedInClient(email, pw2);
  const bad = await newClient(anonKey).auth.signInWithPassword({ email, password: pw1 });
  assert(bad.error, "staré heslo stále funguje");
  return "OK";
});

// ── (d) storage ──────────────────────────────────────────────
console.log("(d) Storage");
const objPath = `smoke/${ts}.txt`;
const content = `Mnástrojárna smoke ${ts} — žluťoučký kůň`;
await check("bucket 'documents' existuje (z migrace) / vytvoření", async () => {
  const g = await svc.storage.getBucket("documents");
  if (!g.error) return `public=${g.data.public}`;
  ok(await svc.storage.createBucket("documents", { public: false }), "createBucket");
  return "vytvořen";
});
await check("upload (servisní klíč)", async () => {
  const d = ok(await svc.storage.from("documents").upload(objPath, Buffer.from(content), { contentType: "text/plain; charset=utf-8", upsert: true }), "upload");
  return d.path;
});
await check("download", async () => {
  const blob = ok(await svc.storage.from("documents").download(objPath), "download");
  const text = await blob.text();
  assert(text === content, `obsah nesedí: ${text}`);
  return `${blob.size} B`;
});
await check("createSignedUrl + GET podepsané URL", async () => {
  const d = ok(await svc.storage.from("documents").createSignedUrl(objPath, 60), "createSignedUrl");
  assert(d.signedUrl.startsWith(`${URL_BASE}/storage/v1/object/sign/documents/`), `signedUrl: ${d.signedUrl}`);
  const res = await fetch(d.signedUrl);
  assert(res.ok, `GET signedUrl → ${res.status}`);
  assert((await res.text()) === content, "obsah podepsané URL nesedí");
  return d.signedUrl.replace(/token=.*/, "token=…");
});
await check("list + upload/download jako přihlášený uživatel (RLS storage.objects)", async () => {
  const listed = ok(await svc.storage.from("documents").list("smoke", { search: String(ts) }), "list");
  assert(listed.some((f) => f.name === `${ts}.txt`), "soubor není v list()");
  const u = await signedInClient("obchod@local.test", "Obchod123!");
  const p2 = `smoke/${ts}-obchod.txt`;
  ok(await u.storage.from("documents").upload(p2, Buffer.from("obchod"), { contentType: "text/plain" }), "upload jako obchodník");
  const blob = ok(await u.storage.from("documents").download(p2), "download jako obchodník");
  assert((await blob.text()) === "obchod", "obsah nesedí");
  const anonUp = await newClient(anonKey).storage.from("documents").upload(`smoke/${ts}-anon.txt`, Buffer.from("x"));
  assert(anonUp.error, "anon nesmí nahrávat do documents");
  ok(await svc.storage.from("documents").remove([objPath, p2]), "remove");
  return `list ${listed.length} soubor(ů), anon upload odmítnut`;
});

// ── (d2) přímý upload z prohlížeče přes podepsanou upload URL ─
console.log("(d2) Storage: createSignedUploadUrl + uploadToSignedUrl (bucket job-files)");
const bigPath = `smoke/${ts}-velky.bin`;
const bigBytes = Buffer.alloc(5 * 1024 * 1024);
for (let i = 0; i < bigBytes.length; i += 4096) bigBytes.writeUInt32LE((i * 2654435761) >>> 0, i);
const sha = async (buf) => Buffer.from(await crypto.subtle.digest("SHA-256", buf)).toString("hex");
let uploadToken;
await check("bucket 'job-files' existuje (z migrace 20261022090000_kniha_zakazek)", async () => {
  const g = ok(await svc.storage.getBucket("job-files"), "getBucket job-files");
  return `public=${g.public}`;
});
await check("createSignedUploadUrl (server, servisní klíč)", async () => {
  const d = ok(await svc.storage.from("job-files").createSignedUploadUrl(bigPath), "createSignedUploadUrl");
  assert(d.token && d.signedUrl.includes("/storage/v1/object/upload/sign/job-files/"), `signedUrl: ${d.signedUrl}`);
  uploadToken = d.token;
  return d.signedUrl.replace(/token=.*/, "token=…");
});
await check("CORS preflight pro PUT na upload/sign (jako prohlížeč)", async () => {
  const reqHeaders = "authorization, apikey, x-client-info, content-type, x-upsert, cache-control";
  const res = await fetch(`${URL_BASE}/storage/v1/object/upload/sign/job-files/${bigPath}?token=${uploadToken}`, {
    method: "OPTIONS",
    headers: { Origin: "http://localhost:3000", "Access-Control-Request-Method": "PUT", "Access-Control-Request-Headers": reqHeaders },
  });
  assert(res.status === 204 || res.status === 200, `preflight → ${res.status}`);
  assert(res.headers.get("access-control-allow-origin") === "http://localhost:3000", "allow-origin");
  assert(/\bPUT\b/.test(res.headers.get("access-control-allow-methods") ?? ""), "allow-methods bez PUT");
  const allowed = (res.headers.get("access-control-allow-headers") ?? "").toLowerCase();
  for (const h of reqHeaders.split(", ")) assert(allowed.includes(h), `allow-headers bez ${h}`);
  return `${res.status}, allow-headers: ${allowed}`;
});
await check("uploadToSignedUrl (anon klient, 5 MB Blob → multipart jako z prohlížeče)", async () => {
  const anon = newClient(anonKey);
  const blob = new Blob([bigBytes], { type: "application/octet-stream" });
  const d = ok(await anon.storage.from("job-files").uploadToSignedUrl(bigPath, uploadToken, blob), "uploadToSignedUrl");
  assert(d.path === bigPath, `path: ${d.path}`);
  return `${(bigBytes.length / 1048576).toFixed(0)} MB → ${d.fullPath ?? d.path}`;
});
await check("download nahraného souboru (obchodník) + kontrola SHA-256", async () => {
  const u = await signedInClient("obchod@local.test", "Obchod123!");
  const blob = ok(await u.storage.from("job-files").download(bigPath), "download job-files");
  const got = Buffer.from(await blob.arrayBuffer());
  assert(got.length === bigBytes.length, `velikost ${got.length} ≠ ${bigBytes.length}`);
  assert((await sha(got)) === (await sha(bigBytes)), "SHA-256 nesedí");
  return `${got.length} B, SHA-256 OK`;
});
await check("PUT na podepsanou upload URL s Origin (CORS hlavičky v odpovědi, Buffer/raw tělo)", async () => {
  const p = `smoke/${ts}-raw.txt`;
  const d = ok(await svc.storage.from("job-files").createSignedUploadUrl(p, { upsert: true }), "createSignedUploadUrl upsert");
  const res = await fetch(d.signedUrl, {
    method: "PUT",
    headers: { Origin: "http://localhost:3000", apikey: anonKey, "x-upsert": "true", "content-type": "text/plain", "cache-control": "max-age=3600" },
    body: "raw upload",
  });
  const body = await res.text();
  assert(res.ok, `PUT → ${res.status}: ${body}`);
  assert(res.headers.get("access-control-allow-origin") === "http://localhost:3000", "chybí allow-origin v odpovědi");
  const back = ok(await svc.storage.from("job-files").download(p), "download raw");
  assert((await back.text()) === "raw upload", "obsah nesedí");
  ok(await svc.storage.from("job-files").remove([p, bigPath]), "remove job-files");
  return `${res.status} ${body}`;
});

// ── (e) RLS ──────────────────────────────────────────────────
console.log("(e) RLS");
await check("obchodník: profiles → jen vlastní řádek (auth.uid() + role authenticated)", async () => {
  const u = await signedInClient("obchod@local.test", "Obchod123!");
  const rows = ok(await u.from("profiles").select("id, email, role"), "profiles (obchodník)");
  assert(rows.length === 1 && rows[0].email === "obchod@local.test" && rows[0].role === "obchodnik",
    `obchodník vidí: ${JSON.stringify(rows)}`);
  return `1 řádek (${rows[0].role})`;
});
await check("obchodník: integration_settings → 0 řádků", async () => {
  const u = await signedInClient("obchod@local.test", "Obchod123!");
  const rows = ok(await u.from("integration_settings").select(), "integration_settings (obchodník)");
  assert(rows.length === 0, `obchodník vidí ${rows.length} řádků`);
  return "0 řádků";
});
await check("super admin: integration_settings → > 0 řádků (kontrola opačné strany)", async () => {
  const u = await signedInClient("admin@local.test", "Admin123!");
  const rows = ok(await u.from("integration_settings").select(), "integration_settings (admin)");
  assert(rows.length > 0, "admin nevidí nic");
  return `${rows.length} řádků`;
});
await check("anon: profiles → 0 řádků", async () => {
  const rows = ok(await newClient(anonKey).from("profiles").select("*"), "profiles anon");
  assert(rows.length === 0, `anon vidí ${rows.length} profilů`);
  return "0 řádků";
});

// ── úklid ────────────────────────────────────────────────────
await check("úklid testovacích dat", async () => {
  ok(await svc.from("orders").delete().eq("id", orderId), "delete order");
  ok(await svc.from("customers").delete().eq("id", customerId), "delete customer");
  ok(await svc.auth.admin.deleteUser(userId), "deleteUser");
  return "OK";
});

console.log(`\nSMOKE OK — ${passed} kontrol prošlo za ${((Date.now() - t0) / 1000).toFixed(1)} s`);
