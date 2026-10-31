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

## Rychlost: region serveru a ověřování přihlášení (povinné po nasazení)

**1. Region funkcí Vercelu MUSÍ být u databáze.** Každá stránka posílá do Supabase několik dotazů
za sebou; každý jde přes síť server → databáze. Výchozí region Vercelu je `iad1` (Washington), projekt
Supabase `cqdhkzvzxdnzutizsjuz` běží v **AWS eu-west-1 (Irsko)** (zjištěno z adresy databáze
`db.cqdhkzvzxdnzutizsjuz.supabase.co`) → ~75 ms na každý dotaz navíc. Proto `vercel.json` nastavuje
`"regions": ["dub1"]` (Dublin = stejné místo jako databáze, ~1–2 ms).

- Ověř: **Supabase → Project Settings → General → Region** (má být *West EU (Ireland)* / `eu-west-1`).
  Pokud je jiný, změň `regions` ve `vercel.json`: Frankfurt `eu-central-1` → `fra1`, Londýn `eu-west-2` →
  `lhr1`, Paříž `eu-west-3` → `cdg1`, Stockholm `eu-north-1` → `arn1`, USA východ `us-east-1` → `iad1`.
- Po nasazení zkontroluj **Vercel → Project → Settings → Functions → Function Region** (musí ukazovat
  totéž; hodnota z `vercel.json` má přednost) a v logu funkce sloupec region.

**2. Ověření přihlášení bez síťového volání.** Aplikace ověřuje podpis přihlašovacího tokenu lokálně
(`src/lib/supabase/verified-claims.ts`) — dřív šly na každé zobrazení stránky 2 dotazy na Supabase Auth.
Aby to fungovalo, nastav **jedno** z:

- (doporučeno) **Supabase → Project Settings → JWT Keys → přepnout na asymetrické klíče** (ECC P-256:
  „Create standby key" → „Rotate keys"; starý klíč zůstane platný pro už vydané tokeny). Veřejný klíč si
  aplikace stáhne sama (JWKS), nic dalšího se nenastavuje.
- nebo do Vercel env (jen server) `SUPABASE_JWT_SECRET` = *Legacy JWT secret* ze stejné stránky.

Bez toho vše funguje dál, jen ověření přihlášení zůstane síťovým voláním (jako dřív). Deaktivace účtu
platí okamžitě (profil se čte při každém požadavku); odhlášení na jiném zařízení platí nejpozději
do vypršení tokenu (výchozí 1 h) — stejně jako pro databázi (PostgREST ověřuje token také jen podpisem).

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

## E-mailové schránky (hosting90, Microsoft 365)

Nastavení → **E-mailové schránky** → Přidat schránku: zvol předvolbu, vyplň e-mail a heslo a klikni na
**„Najít nastavení automaticky"** — aplikace sama vyzkouší servery a porty a vyplní první fungující kombinaci.

| Poskytovatel | Příchozí | Odchozí | Uživatel |
| --- | --- | --- | --- |
| **hosting90** (nastrojarstvi.com, mnastrojarna.cz i jiná doména) | IMAP `mail.hosting90.cz` 993 SSL/TLS (nebo 143 STARTTLS); POP3 995 / 110 | `smtp.hosting90.cz` 465 SSL/TLS (nebo 587 STARTTLS) | celá adresa |
| Gmail | `imap.gmail.com` 993 | `smtp.gmail.com` 465 | celá adresa + **heslo aplikace** |
| Microsoft 365 | Microsoft Graph (Client ID, Tenant ID, Secret) | Graph | — |

- **Proč ne `mail.<vlastní doména>`:** u hosting90 vede na stejný server, ale certifikát je vystavený na
  `mail.hosting90.cz` („neumožňuje využít SSL") — šifrované spojení s ověřením certifikátu selže na všech portech.
  Aplikace to pozná a sama použije `mail.hosting90.cz`; uložený server se při stahování sám opraví.
- Šifrování podle portu (993/995/465 TLS, 143/110/587 STARTTLS); heslo nikdy nejde nešifrovaně. Pokud certifikát
  serveru nesedí na jeho název a jiný název nefunguje, aplikace nabídne „přesto šifrovat bez ověření jména" jen
  po výslovném potvrzení.
- POP3 schránka se stahuje bez mazání ze serveru (UIDL). Outlook (POP3) musí mít zapnuté **„Ponechat kopii zpráv na
  serveru"**, jinak je INBOX prázdný — nejlépe přepnout i Outlook na IMAP `mail.hosting90.cz`, port 993.
- **Microsoft 365:** Entra ID → Registrace aplikací → Nová; oprávnění API Microsoft Graph typu *Application*:
  `Mail.Read` (a `Mail.Send` pro odesílání) → **Udělit souhlas správce**; Certifikáty a tajné kódy → nový tajný klíč
  → zkopíruj **Value** (ne Secret ID). IMAP/SMTP s heslem M365 nepodporuje.
- Stav stahování, poslední chyba a poslední test jsou u každé schránky (Nastavení, Přijatá pošta, Můj účet);
  tabulka `mailbox_status` (migrace `20261023120000_schranky_diagnostika.sql`).

## Automatické stahování pošty (cron)

1. Na Vercelu nastav proměnnou **`CRON_SECRET`** (libovolný dlouhý náhodný řetězec, např. `openssl rand -hex 32`)
   a znovu nasaď. Bez ní `/api/cron/sync-mail` vrací **503** a nic se automaticky nestahuje.
2. `vercel.json` v repu obsahuje cron **`17 5 * * *`** (1× denně v 5:17 UTC) — to je maximum plánu **Hobby**
   (častější výraz, např. `*/10 * * * *`, na Hobby **shodí nasazení**). Vercel Cron posílá
   `Authorization: Bearer <CRON_SECRET>` sám. Na plánu **Pro** lze dát `*/5 * * * *`.
3. Častěji i na Hobby — externí plánovač volá `GET https://<APP_URL>/api/cron/sync-mail` s hlavičkou
   `Authorization: Bearer <CRON_SECRET>`, např. Supabase `pg_cron` + `pg_net` (SQL editor):
   ```sql
   create extension if not exists pg_cron; create extension if not exists pg_net;
   select vault.create_secret('<CRON_SECRET>', 'mail_cron_secret');
   select cron.schedule('sync-mail', '*/5 * * * *', $$
     select net.http_get(url := 'https://mnastrojarna-center.vercel.app/api/cron/sync-mail',
       headers := jsonb_build_object('Authorization', 'Bearer ' ||
         (select decrypted_secret from vault.decrypted_secrets where name = 'mail_cron_secret')),
       timeout_milliseconds := 290000) $$);
   -- kontrola: select * from cron.job_run_details order by start_time desc limit 5;
   ```
   (nebo cron-job.org se stejnou hlavičkou).
4. Navíc se pošta stáhne sama při otevření Přijaté pošty (je-li poslední stažení starší než 5 min) a kdykoli
   tlačítkem „Stáhnout poštu". Stahuje se inkrementálně (IMAP UID / POP3 UIDL) — nic se neztratí ani při
   denním cronu; dávka, která se nestihne v časovém limitu (`maxDuration` 300 s), se dostáhne příště.

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
