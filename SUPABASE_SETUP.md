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

## Alternativa — nativní GitHub integrace Supabase

Místo Action lze v dashboardu zapnout **Project Settings → Integrations → GitHub** a propojit
repo. Pak Supabase spouští migrace z `supabase/migrations/` sám. Stačí jedno z řešení;
v repu je připravená Action varianta (nezávislá na nastavení dashboardu).

---

## Jak píšu migrace

- Každá změna = nový soubor `supabase/migrations/<timestamp>_nazev.sql`.
- Po nasazení aktualizuji stav v `SUPABASE_BACKEND_STATE.md` (přehled tabulek, RLS, funkcí).
- SQL nejdřív uvidíš v chatu, do gitu jde až po odsouhlasení / ověření.
