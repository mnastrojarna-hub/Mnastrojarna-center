# Lokální Supabase stack (bez Dockeru)

Reprodukovatelné lokální prostředí kompatibilní se Supabase pro E2E testy aplikace.
Běží skutečné binárky ze Supabase image na ghcr.io (PostgREST, GoTrue, storage-api)
+ systémový PostgreSQL 16 s pgvector. Data a binárky jsou v `.local-supabase/` (gitignored).

## Příkazy

```bash
tools/local-supabase/download.sh        # stáhne binárky (ghcr.io, ~250 MB, idempotentní; volá ho i start.sh)
tools/local-supabase/start.sh           # spustí vše na pozadí, aplikuje migrace, vypíše env
node tools/local-supabase/seed-users.mjs  # založí testovací uživatele (idempotentní)
node tools/local-supabase/smoke.mjs       # smoke test s @supabase/supabase-js z node_modules aplikace
tools/local-supabase/psql.sh            # psql do lokální DB (další argumenty → psql)
tools/local-supabase/stop.sh            # zastaví vše (data zůstanou)
tools/local-supabase/reset.sh [--start] # stop + smazání dat (bin/ zůstává); --start = znovu start + seed
```

Spuštění aplikace proti lokálnímu stacku:

```bash
set -a; source .local-supabase/env; set +a; npm run dev
```

## Porty

| Služba | Port | Poznámka |
| --- | --- | --- |
| API gateway | **54321** | `/rest/v1` → PostgREST, `/auth/v1` → GoTrue, `/storage/v1` → Storage; CORS; `apikey` → `Authorization` |
| PostgreSQL 16 | 54322 | `postgres/postgres`, DB `postgres` |
| Mail catcher HTTP | 54324 | `GET /messages`, `GET /messages/latest?to=<email>[&wait=ms]`, `DELETE /messages` |
| Mail catcher SMTP | 54325 | bez TLS (STARTTLS vypnuto), přijme libovolný login |
| PostgREST 12.2.12 | 54330 | |
| GoTrue v2.180.0 | 54331 | autoconfirm, OTP v šablonách e-mailů (`{{ .Token }}`) |
| storage-api v1.84.17 | 54332 | FILE backend v `.local-supabase/storage` |

## Proměnné prostředí (`.local-supabase/env`)

```
NEXT_PUBLIC_SUPABASE_URL=http://localhost:54321
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=<anon JWT>
SUPABASE_SECRET_KEY=<service_role JWT>
```

Klíče jsou deterministické HS256 JWT (`keys.mjs`, secret
`super-secret-jwt-token-with-at-least-32-characters-long`) — jen pro lokální vývoj!
Soubor obsahuje i `SUPABASE_DB_URL`, `LOCAL_MAIL_API`, `SMTP_HOST`, `SMTP_PORT`.

## Testovací uživatelé (`seed-users.mjs`)

| E-mail | Heslo | Role |
| --- | --- | --- |
| admin@local.test | Admin123! | super_admin |
| obchod@local.test | Obchod123! | obchodnik |
| dilna@local.test | Dilna123! | zamestnanec |

## Migrace

`start.sh` aplikuje `supabase/migrations/*.sql` v lexikálním pořadí, každý soubor v jedné transakci
(`psql -1`, `ON_ERROR_STOP=1`) jako `postgres` — obdoba `supabase db push`. Aplikované soubory se
evidují v `supabase_migrations.schema_migrations`, opakovaný start aplikuje jen nové.
Selhání migrace vypíše soubor a chybu a skončí; `SKIP_FAILED_MIGRATIONS=1` ji přeskočí.
Změněnou (už aplikovanou) migraci lokálně znovu neaplikuje → `reset.sh --start`.

## Jak to funguje / omezení

- Postgres běží pod uživatelem `postgres` (pokud skript běží jako root), `fsync=off` (testovací DB).
- Role a schémata jako na Supabase (`anon`, `authenticated`, `service_role`, `authenticator`,
  `supabase_auth_admin`, `supabase_storage_admin`, schémata `auth`, `storage`, `extensions`);
  `uuid-ossp`/`pgcrypto` ve schématu `extensions`, `vector` v `public`.
- storage-api je Alpine (musl) Node aplikace — spouští se přibaleným musl loaderem a Node z image.
- Realtime, Edge Functions, GraphQL, Studio a imgproxy (transformace obrázků) lokálně neběží.
- Vše poslouchá jen na loopbacku (127.0.0.1, případně ::1).
