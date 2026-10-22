# Napojení Supabase přes Git (automatický deploy)

Tento návod ti umožní, aby se **každá změna v adresáři `supabase/`** (migrace databáze
i Edge Functions) po pushnutí do gitu **automaticky nahrála** do tvého Supabase projektu.

Projekt: **`cqdhkzvzxdnzutizsjuz`** → <https://cqdhkzvzxdnzutizsjuz.supabase.co>

---

## TL;DR — co se děje

1. Změny DB píšu jako SQL soubory do `supabase/migrations/`.
2. Po pushu na branch se spustí GitHub Action `.github/workflows/supabase-deploy.yml`.
3. Action se přihlásí k tvému projektu a spustí `supabase db push` + `supabase functions deploy`.

Aby to fungovalo, musíš **jednorázově** přidat 3 GitHub Secrets (vidíš je jen ty, nikdy nejdou do kódu).

---

## Krok 1 — Vytvoř Access Token

1. Otevři <https://supabase.com/dashboard/account/tokens>
2. **Generate new token**, pojmenuj např. `github-ci`, zkopíruj hodnotu (`sbp_…`).
   - Token se zobrazí jen jednou.

## Krok 2 — Najdi heslo k databázi

- Dashboard → projekt → **Project Settings → Database → Database password**.
- Pokud ho neznáš, dej **Reset database password** a zkopíruj nové.

## Krok 3 — Přidej GitHub Secrets

V repozitáři **`mnastrojarna-hub/Mnastrojarna-center`**:

`Settings → Secrets and variables → Actions → New repository secret`

| Název secretu | Hodnota |
| --- | --- |
| `SUPABASE_ACCESS_TOKEN` | token z kroku 1 (`sbp_…`) |
| `SUPABASE_DB_PASSWORD` | heslo z kroku 2 |
| `SUPABASE_PROJECT_ID` | `cqdhkzvzxdnzutizsjuz` |

Hotovo. Při dalším pushu se migrace nahrají automaticky. Stav uvidíš v záložce **Actions**.

> Bez těchto secretů se deploy **bezpečně přeskočí** (workflow nespadne) a vše pojede dál.

---

## Runtime klíče (aplikace ↔ Supabase)

Aplikace se připojuje přes tyto proměnné. Lokálně jsou v `.env.local` (mimo git),
na produkci je nastav ve **Vercel → Project → Settings → Environment Variables**:

| Proměnná | K čemu | Kam |
| --- | --- | --- |
| `NEXT_PUBLIC_SUPABASE_URL` | URL projektu | klient i server (veřejné) |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | publishable klíč (`sb_publishable_…`) | klient i server (veřejné, chráněno RLS) |
| `SUPABASE_SECRET_KEY` | servisní klíč (`sb_secret_…`) | **jen server**, obchází RLS — nikdy do gitu/klienta |

Publishable a URL jsou bezpečné pro prohlížeč. Servisní klíč (`sb_secret_…`) získáš v
`Project Settings → API` a patří **pouze** do serverových env (Vercel), ne do `NEXT_PUBLIC_*`.

---

## Přihlašování (Supabase Auth) — povinné nastavení po nasazení

Dashboard → projekt → **Authentication**:

1. **URL Configuration**
   - **Site URL** = veřejná adresa aplikace (`<APP_URL>`, např. `https://mnastrojarna.vercel.app`).
   - **Redirect URLs** → přidej `<APP_URL>/auth/callback` (a pro lokální vývoj `http://localhost:3000/auth/callback`).
     Bez toho nefunguje odkaz z e-mailu pro obnovu hesla.
   - Stejnou adresu nastav v proměnné `NEXT_PUBLIC_APP_URL` na Vercelu.
2. **Vypni veřejnou registraci** — *Authentication → Sign In / Providers → Email*:
   **„Allow new users to sign up" = OFF**. Nové účty zakládá **super admin** v aplikaci
   (Uživatelé → Nový uživatel, počáteční heslo, vynucená změna po prvním přihlášení).
   Účet bez profilu v aplikaci je stejně neaktivní a nic neuvidí.
3. **(Volitelné) Šablona e-mailu pro obnovu hesla** — *Authentication → Emails → Reset Password*.
   Aplikace posílá vlastní 6místný kód přes SMTP firemní schránky. Když SMTP chybí, použije se e-mail
   Supabase — aby fungoval i kód (ne jen odkaz), doplň do šablony `{{ .Token }}`, např.:

   ```html
   <h2>Obnovení hesla — Mnástrojárna</h2>
   <p>Tvůj kód: <strong>{{ .Token }}</strong> (platí 15 minut)</p>
   <p>Nebo klikni: <a href="{{ .ConfirmationURL }}">nastavit nové heslo</a></p>
   ```

## Úložiště souborů

Bucket **`job-files`** (doklady, fotky, výkresy a 3D modely zakázek) **vytváří migrace**
`supabase/migrations/20261022090000_kniha_zakazek.sql` — ručně nic nezakládej. Je soukromý; aplikace
nahrává přes podepsané URL a soubory vydává jen přihlášeným (`/api/jobs/files/<id>`). Starší bucket
`documents` (archiv výkresů, PDF) zakládá migrace `…_documents_storage.sql`.

## Automatické stahování pošty (cron)

1. Na Vercelu nastav proměnnou **`CRON_SECRET`** (libovolný dlouhý náhodný řetězec).
2. Plánovač volá **`GET <APP_URL>/api/cron/sync-mail`** s hlavičkou `Authorization: Bearer <CRON_SECRET>`.
   - Vercel Cron posílá hlavičku sám, stačí v `vercel.json`:
     ```json
     { "crons": [{ "path": "/api/cron/sync-mail", "schedule": "*/10 * * * *" }] }
     ```
     (na plánu Hobby jde jen 1× denně — pak použij externí plánovač, např. cron-job.org, se stejnou hlavičkou).
   - Bez `CRON_SECRET` endpoint odpoví 503 a nic nestahuje; se špatným tajemstvím 401.
3. Uživatelé si poštu mohou kdykoli stáhnout i ručně tlačítkem v Přijaté poště.

## Bezpečnost dat

Aplikace čte a zapisuje servisním klíčem (`SUPABASE_SECRET_KEY`, obchází RLS) a oprávnění kontroluje sama
v každé stránce, server action i API route (`src/lib/auth/session.ts`). RLS politiky v migracích zůstávají
jako druhá vrstva pro přímý přístup s publishable klíčem. Servisní klíč nikdy nedávej do `NEXT_PUBLIC_*`.

---

## Alternativa — nativní GitHub integrace Supabase

Místo Action lze v dashboardu zapnout **Project Settings → Integrations → GitHub** a propojit
repo. Pak Supabase spouští migrace z `supabase/migrations/` sám. Stačí jedno z řešení;
v repu je připravená Action varianta (nezávislá na nastavení dashboardu).

---

## Jak píšu migrace

- Každá změna = nový soubor `supabase/migrations/<timestamp>_nazev.sql`.
- Po nasazení aktualizuji stav v `SUPABASE_BACKEND_STATE.md` (přehled tabulek, RLS, funkcí).
- SQL nejdřív uvidíš v chatu, do gitu jde až po odsouhlasení / ověření.
