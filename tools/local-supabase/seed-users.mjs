#!/usr/bin/env node
// Idempotentně založí testovací uživatele přes GoTrue admin API (přes gateway, servisním klíčem)
// a pro jistotu nastaví jejich řádky v public.profiles přímo SQL.
//
//   node tools/local-supabase/seed-users.mjs          (stack musí běžet: start.sh)
//   node tools/local-supabase/seed-users.mjs --json   → JSON se seznamem uživatelů
import { execFileSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { serviceRoleKey } from "./keys.mjs";

const URL_BASE = process.env.SUPABASE_URL ?? "http://localhost:54321";
const DB_URL = process.env.SUPABASE_DB_URL ?? "postgres://postgres:postgres@127.0.0.1:54322/postgres";
const PSQL = process.env.PSQL ?? (() => {
  try {
    execFileSync("/usr/lib/postgresql/16/bin/psql", ["--version"], { stdio: "ignore" });
    return "/usr/lib/postgresql/16/bin/psql";
  } catch {
    return "psql";
  }
})();

export const SEED_USERS = [
  { email: "admin@local.test", password: "Admin123!", role: "super_admin", full_name: "Super Admin" },
  { email: "obchod@local.test", password: "Obchod123!", role: "obchodnik", full_name: "Petr Obchodník" },
  { email: "dilna@local.test", password: "Dilna123!", role: "zamestnanec", full_name: "Jana Zaměstnanec" },
];

const headers = {
  apikey: serviceRoleKey,
  authorization: `Bearer ${serviceRoleKey}`,
  "content-type": "application/json",
};

async function api(method, path, body) {
  const res = await fetch(`${URL_BASE}/auth/v1${path}`, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let data;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = text;
  }
  if (!res.ok) throw new Error(`${method} ${path} → ${res.status}: ${typeof data === "string" ? data : JSON.stringify(data)}`);
  return data;
}

async function findUserByEmail(email) {
  for (let page = 1; page < 100; page++) {
    const data = await api("GET", `/admin/users?page=${page}&per_page=200`);
    const users = data?.users ?? [];
    const hit = users.find((u) => (u.email ?? "").toLowerCase() === email.toLowerCase());
    if (hit) return hit;
    if (users.length < 200) return null;
  }
  return null;
}

const sqlLit = (s) => `'${String(s).replace(/'/g, "''")}'`;

export async function seedUsers({ quiet = false } = {}) {
  const out = [];
  for (const u of SEED_USERS) {
    const attrs = {
      email: u.email,
      password: u.password,
      email_confirm: true,
      role: "authenticated", // JWT claim "role" (DB role pro PostgREST/storage)
      user_metadata: { full_name: u.full_name, role: u.role },
      // novější handle_new_user() bere roli z app_metadata a aktivní účet podle "invited"
      app_metadata: { role: u.role, invited: true },
    };
    let user = await findUserByEmail(u.email);
    let action;
    if (user) {
      user = await api("PUT", `/admin/users/${user.id}`, attrs);
      action = "aktualizován";
    } else {
      user = await api("POST", "/admin/users", attrs);
      action = "vytvořen";
    }
    out.push({ id: user.id, email: u.email, password: u.password, role: u.role, full_name: u.full_name, action });
  }

  const values = out
    .map((u) => `(${sqlLit(u.id)}::uuid, ${sqlLit(u.email)}, ${sqlLit(u.full_name)}, ${sqlLit(u.role)}::user_role)`)
    .join(",\n  ");
  const sql = `
insert into public.profiles (id, email, full_name, role)
values
  ${values}
on conflict (id) do update
  set email = excluded.email, full_name = excluded.full_name, role = excluded.role, active = true;
select id || '|' || email || '|' || role from public.profiles where email in (${out.map((u) => sqlLit(u.email)).join(", ")}) order by email;
`;
  const rows = execFileSync(PSQL, ["-X", "-qAt", "-v", "ON_ERROR_STOP=1", DB_URL], { input: sql, encoding: "utf8" })
    .trim()
    .split("\n")
    .filter(Boolean);
  if (rows.length !== SEED_USERS.length) throw new Error(`profiles: očekáváno ${SEED_USERS.length} řádků, nalezeno ${rows.length}`);

  if (!quiet) {
    for (const u of out) console.log(`  ${u.action.padEnd(12)} ${u.email.padEnd(20)} ${u.password.padEnd(12)} ${u.role.padEnd(12)} ${u.id}`);
  }
  return out;
}

const isMain = process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1]);
if (isMain) {
  const json = process.argv.includes("--json");
  seedUsers({ quiet: json })
    .then((users) => {
      if (json) console.log(JSON.stringify(users, null, 2));
      else console.log(`[seed-users] OK — ${users.length} uživatelé připraveni`);
    })
    .catch((err) => {
      console.error("[seed-users] CHYBA:", err.message);
      process.exit(1);
    });
}
