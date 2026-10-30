import { describe, it, expect } from "vitest";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import {
  renderInvoicePdf, renderQuotePdf, renderDeliveryNotePdf, renderConfirmationPdf,
  sampleInvoice, sampleQuote, sampleDeliveryNote, sampleConfirmation,
} from "./render";
import { renderPurchaseOrderPdf, samplePurchaseOrder } from "./render-purchase";
import { pdfText as rawPdfText, squash } from "@/test/pdf-text";
import type { PartyInfo } from "./types";

/**
 * Regrese „mizející písmena": v JEDNOM procesu (Vercel instance renderuje víc dokladů) se po dokladu
 * s tučnými písmeny s diakritikou (Č, Ž, Ý, Ř …) v dalších dokladech ztrácela obyčejná tučná písmena
 * (faktura „CENA / MJ" → „ENA / MJ", „CELKEM" → „ELKEM", nabídka „Cenová" → „enová",
 * OV „Pozor: změna" → „Po or: měna"). Příčina: fontkit drží jeden objekt glyfu na písmo a proces;
 * podmnožina písma u složeného glyfu (Č = C + háček) založí glyf „C" bez znaků (codePoints = [])
 * a textkit ho v dalším dokladu při řádkování zahodí. Test proto renderuje všechny doklady za sebou
 * (sekvence z matice chyby: DL → faktura → nabídka → potvrzení → OV a znovu dokola) a u každého
 * hlídá, že je v textu PDF každé očekávané slovo — tučné popisky velkými písmeny i jména s diakritikou.
 */

const SAVE_DIR = process.env.PDF_GLYPH_DIR;

const CUSTOMER: PartyInfo = {
  name: "Strojírny Čelákovice Žďár ŘÍČANY s.r.o.",
  street: "Ždírecká 124",
  zip: "250 88",
  city: "Čelákovice",
  country: "CZ",
  ico: "45274649",
  dic: "CZ45274649",
};

const PEOPLE = {
  contactPerson: "Jiří Čížek",
  customerContact: "Ing. Žaneta Řezníčková",
  deliveryAddress: "Strojírny Čelákovice Žďár ŘÍČANY s.r.o.\nHala Č — příjem\nŽdírecká 124\n250 88 Čelákovice",
};

/** Text všech stran bez mezer (písmena s letterSpacing jdou z PDF po jednom). */
async function pdfText(buf: Buffer): Promise<string> {
  return squash(await rawPdfText(buf));
}

type Kind = "dl" | "inv" | "q" | "conf" | "po";

const COMMON = ["Strojírny Čelákovice Žďár ŘÍČANY s.r.o.", "Ždírecká 124", "Mnástrojárna", "místo pro Vaši kooperaci"];

const EXPECT: Record<Kind, string[]> = {
  dl: [
    ...COMMON, "Dodací list", "MÍSTO DODÁNÍ", "POČET POLOŽEK", "CELKEM", "BALENÍ", "HMOTNOST", "KONTROLA",
    "PŘEVZAL (ODBĚRATEL)", "PŘEDAL (DODAVATEL)", "VYŘIZUJE", "Jiří Čížek", "Žaneta Řezníčková", "Hala Č — příjem",
    "Frézovaný profil Ř-12, Ž-ocel", "Čep Ø 20 — CNC",
  ],
  inv: [
    ...COMMON, "DAŇOVÝ DOKLAD", "Faktura", "CENA / MJ", "CELKEM BEZ DPH", "REKAPITULACE DPH", "SAZBA", "ZÁKLAD",
    "PLATEBNÍ ÚDAJE", "K úhradě", "VAR. SYMBOL", "SPLATNOST", "DUZP", "Žaneta Řezníčková", "Čep Ø 20 — CNC", "Frézovaný profil Ř-12, Ž-ocel",
  ],
  q: [
    ...COMMON, "Cenová nabídka", "PODMÍNKY NABÍDKY", "CENA / MJ", "CELKEM BEZ DPH", "VAŠE POPTÁVKA", "VYŘIZUJE", "ZÁKAZNÍK",
    "PLATNOST DO", "Jiří Čížek", "Frézovaný profil Ř-12, Ž-ocel", "Výroba frézovaných dílů — Žďár",
  ],
  conf: [
    ...COMMON, "Potvrzení objednávky", "POTVRZENÝ TERMÍN DODÁNÍ", "DLE NABÍDKY", "VYŘIZUJE", "CENA / MJ", "CELKEM BEZ DPH",
    "Vaši objednávku jsme přijali", "Jiří Čížek", "Frézovaný profil Ř-12, Ž-ocel",
  ],
  po: [
    "Mnástrojárna", "OBJEDNÁVKA DODAVATELI", "Objednávka", "Č. VÝKRESU", "CENA / MJ", "CELKEM BEZ DPH",
    "DODACÍ A PLATEBNÍ PODMÍNKY", "POŽADOVANÝ TERMÍN DODÁNÍ", "POKYNY PRO DODAVATELE", "Celkem s DPH",
    "Pozor: změna rozměru dle revize C", "Frézy Ø 12 — Žďár", "Prosíme o potvrzení objednávky",
    "Kovoobrábění Hrubý Čáslav s.r.o.", "obchod@mnastrojarna.cz",
  ],
};

const ITEMS = [
  {
    drawingNumber: "VK-ČŽ-2291", revision: "C", description: "Frézovaný profil Ř-12, Ž-ocel", material: "1.2379 (X153CrMoV12)",
    quantity: 5, unit: "ks", unitPrice: 3000, vatRate: 21,
  },
  { description: "Čep Ø 20 — CNC", quantity: 10, unit: "ks", unitPrice: 1000, vatRate: 21 },
];

async function render(kind: Kind): Promise<Buffer> {
  switch (kind) {
    case "dl":
      return renderDeliveryNotePdf({
        ...sampleDeliveryNote(), ...PEOPLE, customer: CUSTOMER,
        items: ITEMS.map(({ description, quantity, unit, drawingNumber, revision, material }) => ({ description, quantity, unit, drawingNumber, revision, material })),
      });
    case "inv":
      return renderInvoicePdf({ ...sampleInvoice(), ...PEOPLE, customer: CUSTOMER, items: ITEMS });
    case "q":
      return renderQuotePdf({ ...sampleQuote(), ...PEOPLE, customer: CUSTOMER, items: ITEMS, subject: "Výroba frézovaných dílů — Žďár" });
    case "conf":
      return renderConfirmationPdf({ ...sampleConfirmation(), ...PEOPLE, customer: CUSTOMER, items: ITEMS });
    case "po": {
      const s = samplePurchaseOrder();
      return renderPurchaseOrderPdf({
        ...s,
        supplier: { ...s.supplier, name: "Kovoobrábění Hrubý Čáslav s.r.o." },
        items: [
          { ...ITEMS[0], note: "Pozor: změna rozměru dle revize C" },
          { description: "Frézy Ø 12 — Žďár", quantity: 3, unit: "ks", unitPrice: 450, vatRate: 21 },
        ],
      });
    }
  }
}

// Pořadí pokrývá všechny rozbité dvojice z matice (dl→inv/q/conf/po, inv→q/conf/po) i opakování.
const SEQUENCE: Kind[] = ["dl", "inv", "q", "conf", "po", "inv", "dl", "q", "inv", "conf", "dl", "po", "q", "po", "conf", "inv"];

describe("PDF: písmena nemizí po dokladu s diakritikou (jeden proces, víc dokladů)", () => {
  it("sekvence DL → faktura → nabídka → potvrzení → OV …: každé očekávané slovo je v textu", async () => {
    const missing: string[] = [];
    for (const [i, kind] of SEQUENCE.entries()) {
      const buf = await render(kind);
      if (SAVE_DIR) {
        mkdirSync(SAVE_DIR, { recursive: true });
        writeFileSync(path.join(SAVE_DIR, `${String(i).padStart(2, "0")}-${kind}.pdf`), buf);
      }
      const text = await pdfText(buf);
      for (const word of EXPECT[kind]) {
        if (!text.includes(squash(word))) missing.push(`#${i} ${kind}: „${word}"`);
      }
    }
    expect(missing).toEqual([]);
  }, 180_000);

  it("souběžné rendery (víc požadavků v jedné instanci) — žádné chybějící písmo", async () => {
    const kinds: Kind[] = ["dl", "inv", "q", "conf", "po", "dl", "inv"];
    const bufs = await Promise.all(kinds.map((k) => render(k)));
    const missing: string[] = [];
    for (const [i, buf] of bufs.entries()) {
      const text = await pdfText(buf);
      for (const word of EXPECT[kinds[i]]) if (!text.includes(squash(word))) missing.push(`${kinds[i]}: „${word}"`);
    }
    expect(missing).toEqual([]);
  }, 180_000);
});
