# CNC SALES OS – AI Obchodní a E-mailový Systém pro Nástrojárnu

## Vize projektu

Vytvoř produkční webovou aplikaci nasaditelnou na Vercel.

Cílem je vybudovat AI asistovanou kancelář pro nástrojárnu a obchodní firmu, která automatizuje většinu administrativní práce související s:

* e-maily
* poptávkami
* nabídkami
* objednávkami
* dodavateli
* zákazníky
* fakturami
* výkresovou dokumentací
* provizemi obchodníků
* archivací dat

Dlouhodobým cílem je vytvořit systém, který bude fungovat jako kombinace:

* CRM
* ERP
* E-mailového klienta
* Dokumentového systému
* AI asistenta

Většina rutinní kancelářské práce má být automatizována pomocí AI.

---

## Design systému

Systém musí působit jako moderní SaaS aplikace.

Inspirace:

* Linear
* Notion
* Stripe Dashboard
* Superhuman
* Raycast
* Slack

Požadavky:

* čisté moderní UI
* rychlé načítání
* minimum kliknutí
* dark mode
* light mode
* responzivní design
* použitelný na mobilu i desktopu

UX musí být navrženo tak, aby obchodník většinu práce zvládl během několika minut denně.

---

## Technologie

Frontend:

* Next.js 15 (App Router)
* React
* TypeScript
* Tailwind CSS
* ShadCN UI

Backend:

* **Supabase** (PostgreSQL + Auth + Storage + Realtime + Edge Functions)
* Next.js Server Actions
* API Routes
* TypeScript

Databáze:

* **Supabase PostgreSQL**
* pgvector (embeddings / RAG)
* Row Level Security (role a oprávnění na úrovni DB)

Autentizace:

* **Supabase Auth** (role: super_admin / obchodnik / zamestnanec)

Souborové úložiště:

* **Supabase Storage** (výkresy, PDF, přílohy e-mailů)

Nasazení:

* Vercel

E-mail (připojení):

* **Outlook / Microsoft 365** (Graph API)
* **IMAP/SMTP přes hosting90** (firemní schránka)

AI:

* **Claude API (Anthropic)** — již dostupné, sdílí klíč s Claude Code
* Embeddings + pgvector (Vector Database v Supabase)
* RAG nad historickými nabídkami / objednávkami / e-maily

OCR:

* PDF OCR
* OCR obrázků
* Extrakce textu z PDF (výkresy → metadata)

---

## Branding (dle logomanuálu `mnastrojarna_logomanual_5_4.pdf`)

Firma: **Mnástrojárna s.r.o.** — slogan *„místo pro Vaši kooperaci…"*

Barvy:

| Barva | HEX | RGB | CMYK |
| --- | --- | --- | --- |
| Korporátní červená | `#E03930` | 244 57 48 | 0 94 100 0 |
| Antracit | `#272425` | 39 36 37 | 0 0 0 100 |
| Korporátní šedá | `#6C6D6F` | 108 109 111 | 0 0 0 70 |

Písma:

* **Roboto** (light / regular / bold) — delší bloky textu → použito jako hlavní UI font
* Audimat (nadpisy) — není na Google Fonts, v UI nahrazeno Roboto

Logo: symbol frézy (šrafovaný štít v korporátní červené) + wordmark „Mnástrojárna".
V aplikaci: `src/components/logo.tsx` (vektorová rekreace), favicon `src/app/icon.svg`.

---

## Režim provozu (KLÍČOVÉ)

Systém má pro každou automatizovanou akci jeden ze dvou režimů:

1. **Plná automatika (100 %)** — AI provede akci sama (kategorizace, odpověď, nacenění, párování) bez zásahu člověka.
2. **Automatika se schválením** — AI vše připraví, ale akce čeká ve **frontě ke schválení**; uživatel ji jedním klikem schválí, upraví, nebo zamítne.

Princip UX: **AI dělá vše automaticky, člověk pouze ručně koriguje.** Výchozí stav je vyplněno/navrženo AI — uživatel pouze potvrzuje výjimky.

Režim lze nastavit globálně i per-modul (např. kategorizace e-mailů = plná automatika, odesílání nabídek = se schválením).

---

## Uživatelské role

### Super Admin

Vidí vše.

Může:

* spravovat uživatele
* nastavovat AI
* vidět všechny zakázky
* vidět všechny provize
* měnit oprávnění
* upravovat data

---

### Obchodník

Vidí pouze:

* své zákazníky
* své nabídky
* své objednávky
* své provize

Nemůže:

* vidět provize ostatních

---

### Zaměstnanec

Vidí pouze přidělené úkoly.

Nemá přístup k citlivým obchodním datům.

---

## Modul 1 – AI Email Centrum

Připojení:

* Gmail
* Microsoft 365
* IMAP

Automatické stahování pošty.

Každý příchozí email musí být automaticky analyzován AI.

Kategorie:

* Poptávka
* Objednávka
* Nabídka dodavatele
* Potvrzení objednávky
* Faktura
* Upomínka
* Reklamace
* Technická dokumentace
* Spam

Ke každému emailu přiřadit:

* kategorii
* prioritu
* důležitost
* zákazníka
* dodavatele
* obchodníka
* související nabídku
* související objednávku

Spam automaticky filtrovat.

---

## Modul 2 – CRM zákazníků

Evidovat:

* název firmy
* kontaktní osoby
* emaily
* telefony
* IČ
* DIČ
* zemi
* obchodníka

Historie:

* nabídky
* objednávky
* komunikace
* dokumentace

---

## Modul 3 – Databáze dodavatelů

Ukládat:

* kontakty
* technologie
* materiály
* certifikace
* ceny
* dodací lhůty

AI musí umět doporučit vhodného dodavatele.

---

## Modul 4 – Archiv výkresů

Podporované soubory:

* PDF
* STEP
* DXF
* obrázky

Funkce:

* verzování
* historie revizí
* detekce duplicit
* archivace

AI automaticky vytahuje:

* číslo výkresu
* revizi
* materiál
* rozměry
* tolerance
* množství

Vyhledávání podle:

* čísla výkresu
* zákazníka
* materiálu
* klíčových slov

---

## Modul 5 – Generátor nabídek

Po přijetí poptávky:

AI automaticky vytvoří návrh nabídky.

Vyplní:

* zákazníka
* položky
* čísla výkresů
* počty kusů
* termín dodání

Automaticky generovat:

* číslo nabídky
* PDF nabídku
* e-mail k odeslání

První verze:

uživatel doplní cenu.

Budoucí verze:

AI navrhne cenu na základě historie.

---

## Modul 6 – Správa objednávek

Po přijetí objednávky:

AI automaticky:

* rozpozná nabídku
* spáruje zákazníka
* vytvoří zakázku

Stavy:

* přijato
* nacenění
* objednáno
* ve výrobě
* expedováno
* dokončeno

---

## Modul 7 – Automatické odpovědi

AI připravuje odpovědi.

Například:

* Poptávka přijata.
* Objednávka přijata.
* Faktura přijata.
* Požadavek na cenovou nabídku dodavateli.

Uživatel pouze schválí odeslání.

Později možnost plné automatizace.

---

## Modul 8 – Provize obchodníků

Každý obchodník má:

* vlastní smlouvu
* vlastní procenta
* vlastní pravidla

Automaticky počítat:

* obrat
* marži
* provizi

Přehled:

* měsíc
* kvartál
* rok

---

## Modul 9 – Historická znalostní databáze

Nahrávání:

* starých nabídek
* objednávek
* faktur
* emailů

AI vytváří znalostní databázi.

Při nové poptávce najde:

* podobný díl
* podobnou nabídku
* podobnou cenu
* podobného dodavatele

---

## Modul 10 – Firemní AI Asistent

Příklady dotazů:

* Najdi poslední cenu tohoto výkresu.
* Najdi podobný díl.
* Kdo dodával tento materiál nejlevněji?
* Jaká byla poslední marže u zákazníka?
* Kolik vydělal obchodník tento měsíc?

---

## Dashboard

Přehled po přihlášení:

* nové poptávky
* nové objednávky
* čekající nabídky
* upomínky
* faktury
* úkoly
* provize
* obchodní výkon

Vše na jedné obrazovce.

---

## Vyhledávání

Jedno globální vyhledávání přes:

* emaily
* zákazníky
* dodavatele
* nabídky
* objednávky
* faktury
* výkresy

Musí fungovat podobně jako Spotlight nebo Raycast.

---

## Bezpečnost

Povinné:

* audit log
* historie změn
* šifrování
* role a oprávnění
* automatické zálohy
* GDPR

---

## Budoucí vývoj

### Fáze 2

* automatické nacenění
* doporučení dodavatelů
* predikce marže

### Fáze 3

* účetnictví
* sklad
* výroba

### Fáze 4

* plně autonomní obchodní kancelář

Architektura musí být navržena tak, aby šla rozšiřovat bez zásadního přepracování.

Nejprve navrhni databázi, Prisma modely, API architekturu, UX, UI a následně začni implementovat MVP.
