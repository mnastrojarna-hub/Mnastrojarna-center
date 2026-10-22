# Kniha zakázek — příručka pro každého

Kniha zakázek je hlavní obrazovka aplikace. **Každá zakázka = jeden řádek.** K řádku patří všechno:
poptávka, nabídky, objednávka zákazníka, potvrzení, dodací listy, faktury, výkresy, 3D modely, fotky
i celá historie. Klikni na řádek a otevře se karta zakázky.

Na nic se nemusíš učit zpaměti — barvy, ikonky a nápovědy ti řeknou, co dělat dál.

---

## 1. Záložky knihy

| Záložka | Co v ní je |
| --- | --- |
| **Objednávky** (výchozí) | Vše, co zákazník objednal — od objednávky po fakturu, včetně pozastavených a reklamací. |
| **Poptávky & nabídky** | Fáze před objednávkou: poptávka, nacenění, odeslaná nabídka. |
| **Dokončené** | Uzavřené a zaplacené zakázky. |
| **Nerealizované & zrušené** | Prohrané nabídky a zrušené zakázky. |
| **Vše** | Celá kniha. |

Pod záložkami jsou **barevné chipy stavů** — ťuknutím vyfiltruješ jen zakázky v daném stavu (jde jich
vybrat víc). Dlaždice nahoře („Po termínu", „Termín do 7 dní"…) fungují jako rychlé filtry.
Hledání najde číslo zakázky, zákazníka, číslo objednávky / poptávky zákazníka i číslo výkresu.

## 2. Stavy a jejich barvy

| Barva | Stav | Co to znamená |
| --- | --- | --- |
| 🔵 nebesky modrá | **Poptávka** | Zákazník poptal díl — čeká na nacenění. |
| 🟡 jantarová | **Nacenění** | Připravujeme cenu (dává ji člověk, AI se zatím jen učí). |
| 🟣 fialová | **Nabídka odeslaná** | Nabídka odešla — čekáme na objednávku. |
| 🟠 oranžová | **Objednávka** | Zákazník objednal — potvrď objednávku. |
| 🔷 indigo | **Potvrzená objednávka** | Potvrzeno zákazníkovi, termín slíben. |
| 🟨 žlutá | **Ve výrobě** | Vyrábí se — u nás nebo u dodavatele. |
| 🩵 tyrkysová | **Dodáno k nám** | Díly dorazily od dodavatele. |
| 🟢 modrozelená | **Na skladě** *(volitelné)* | Leží u nás, čeká na expedici. |
| 🩷 purpurová | **Montáž** *(volitelné)* | Montáž / kompletace před dodáním. |
| 🟩 zelená | **Dodáno zákazníkovi** | Předáno — vystav fakturu. |
| 🟢 smaragdová | **Vyfakturováno** | Faktura vystavena, čeká se na úhradu. |
| ⚪ šedá | **Dokončeno** | Uzavřeno a zaplaceno. |
| ◻️ šedá | **Pozastaveno** | Zakázka stojí (čeká na zákazníka / dodavatele). |
| 🌸 růžová | **Reklamace** | Zákazník reklamuje — řeš přednostně. |
| 🪨 kamenná | **Nerealizováno** | Zákazník neobjednal. |
| 🔴 červená | **Zrušeno** | Zakázka zrušena. |

Stav posuneš tlačítkem **„Posunout →"** na kartě zakázky nebo výběrem v barevném odznaku. AI posouvá stav
jen **dopředu** (nikdy zpět) a speciální stavy (pozastaveno, reklamace, nerealizováno, zrušeno) nikdy nemění sama.

**Termíny** — rozhoduje *potvrzený termín zákazníkovi*, jinak *požadovaný termín zákazníkem*. Odznak termínu je
zelený (v pohodě), jantarový (do 7 dní), oranžový (dnes) a červený (po termínu; plně červený po *maximálním
tolerovaném termínu*). Když dodavatel slíbil později, než jsme slíbili zákazníkovi, karta tě upozorní.

## 3. Barvy tlačítek

- **Červené** tlačítko **odešle něco ven** (zákazníkovi nebo dodavateli) — např. „Vyfotit doklad" je červené
  proto, aby bylo vidět, ale samo nic neodesílá; odeslání nabídky / potvrzení e-mailem je vždy červené.
- **Zelené** tlačítko uloží nebo potvrdí — nic neodejde z firmy.
- **Tmavé / obrysové** tlačítko otevře formulář nebo přejde jinam.

## 4. Jak vyfotit doklad 📷

1. V Knize zakázek ťukni na **„📷 Vyfotit doklad"** (na mobilu je velký foťák i uprostřed spodní lišty).
   Na mobilu se otevře fotoaparát, na počítači výběr souboru (fotka nebo PDF).
2. Vícestránkový doklad: vyfoť všechny stránky za sebou, pak **Pokračovat**.
   - Foť rovně, celý list, bez stínu a odlesku. Stačí obyčejné denní světlo.
3. AI doklad přečte (pár sekund) a pozná:
   - **druh**: poptávka, nabídka, objednávka, potvrzení, dodací list, faktura, výkres…
   - **kdo ho vystavil**: zákazník, my, nebo dodavatel (např. *naše* faktura vs. faktura *od dodavatele*);
   - všechny údaje: čísla dokladů, data, termíny, položky, čísla výkresů, množství, ceny, firmu (IČO, adresa).
4. Zobrazí se **formulář ke kontrole** — vlevo náhled fotky, vpravo přečtené údaje. Zkontroluj hlavně
   zákazníka, zakázku, čísla a termíny. Co nesedí, přepiš.
5. **„Uložit do knihy"** — doklad se uloží k zakázce (záložka Dokumenty), údaje se propíší do zakázky
   a stav se posune (např. objednávka zákazníka → stav Objednávka).

Nemáš AI povolenou? Postup je stejný, jen formulář vyplníš sám vedle náhledu fotky. Nevadí — **AI se učí
i z tvého vyplnění** a příště to zvládne sama.

Doklad můžeš vyfotit i přímo **na kartě zakázky** — pak se uloží rovnou k ní.

## 5. Jak AI najde správnou zakázku

AI porovná přečtený doklad s rozpracovanými zakázkami a u návrhu vždy napíše **proč** („podle čísla
objednávky zákazníka PO-4500021877"). Od nejsilnější shody:

1. **Naše číslo zakázky** (Z-2026-001) nebo **číslo naší nabídky** na dokladu.
2. **Číslo objednávky zákazníka** nebo **číslo poptávky zákazníka** — jen u stejného zákazníka.
3. U dokladů od dodavatele: **naše číslo objednávky u dodavatele**.
4. **Stejná čísla výkresů** u stejného zákazníka (nebo dodavatele).
5. Slabá shoda: stejný zákazník a zakázka ve stavu, který k dokladu sedí.

Když si AI není jistá, nabídne **víc možností** a vybereš sám — nebo zvolíš **„Založit novou zakázku"**.
Zákazníka hledá podle **IČO → DIČ → názvu**; když ho nenajde, založí ho (dostane číslo ZK…) i s adresou.
Pozor na upozornění „zakázka patří jinému zákazníkovi" nebo „zakázka je uzavřená".

## 6. Opravy — vše jde změnit ručně

- **Na kartě zakázky** klikni na libovolný údaj (termín, číslo objednávky, obchodník…) a přepiš ho.
  Každá změna se zapíše do **Historie** (kdo, kdy, co z čeho na co).
- **Položky** (výkresy, množství, ceny) upravíš v záložce Položky.
- **Nabídky**: zakázka jich může mít víc. Nová verze starou **archivuje** (zůstane dohledatelná). U každé
  nabídky je vidět, kdo ji zadal a kdo schválil.
- **Dokumenty**: nová verze souboru starou archivuje; špatně zařazený doklad přesuneš změnou druhu.
- **Zákazníci a dodavatelé**: v adresáři tlačítko **Upravit** (tužka). Kontaktní osoby přidáš na kartě zákazníka.
- Každá tvoje oprava toho, co přečetla AI, se uloží jako **korekce** — AI stejnou chybu příště neudělá.

## 7. Kdo co vidí

| | Super admin | Obchodník | Zaměstnanec |
| --- | :---: | :---: | :---: |
| Kniha zakázek, poptávky, nabídky, potvrzení, dokumenty | ✅ | ✅ | ✅ |
| Zákazníci a dodavatelé (i úpravy) | ✅ | ✅ | ✅ |
| Pošta | všechny schránky | jen svou | jen svou |
| Nákupní ceny a marže | ✅ | ✅ | — |
| Provize | všech | jen své | — |
| AI čtení dokladů z fotky | ✅ | když povolí admin | když povolí admin |
| AI přehled, AI asistent, znalostní databáze, archiv výkresů, ladění AI | ✅ | — | — |
| Uživatelé a nastavení | ✅ | — | — |

**Ceny dává vždy člověk.** AI zatím jen sleduje, jak naceňujete, a učí se.

## 8. Rychlé tipy

- **⌘K / Ctrl K** (nebo lupa nahoře) — najde zakázku podle čísla, zákazníka, čísla objednávky zákazníka či
  výkresu; nabízí i rychlé akce „Vyfotit doklad" a „Nová zakázka".
- **„+ Nová zakázka"** — ruční založení, když doklad nemáš (stačí zákazník a název, zbytek kdykoli doplníš).
- Nového zákazníka nemusíš zakládat ručně — vyfoť jeho objednávku a AI ho založí sama.
- Zapomenuté heslo: na přihlašovací stránce **„Zapomenuté heslo?"** → přijde 6místný kód na e-mail.
