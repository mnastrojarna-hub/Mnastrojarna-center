/**
 * Fakturační a firemní údaje vystavovatele dokladů — Mnástrojárna s.r.o.
 * Používá se na fakturách, dodacích listech, nabídkách (náležitosti dle českých zákonů).
 *
 * Hodnoty níže jsou výchozí; skutečné údaje se vyplňují v průvodci nastavením
 * (Nastavení → Firemní údaje) a před každým generováním dokladu je přepíše
 * refreshCompanyFromSettings() z lib/company-server.
 */

export const COMPANY = {
  name: "MNástrojárna s.r.o.",
  slogan: "místo pro Vaši kooperaci…",

  // Sídlo (fakturační adresa)
  address: {
    street: "Varšavská 715/36",
    city: "Praha 2",
    zip: "120 00",
    country: "Česká republika",
  },

  // Korespondenční / doručovací adresa
  correspondence: {
    street: "Mezná 9",
    city: "Mezná",
    zip: "393 01",
    country: "Česká republika",
  },

  ico: "04304080",
  dic: "CZ04304080",
  vatPayer: true, // plátce DPH

  // Kontakty (doplň dle skutečnosti)
  email: "obchod@mnastrojarna.cz",
  phone: "",
  web: "www.mnastrojarna.cz",

  // Bankovní spojení (doplň přes Nastavení / integrace)
  bank: {
    accountName: "MNástrojárna s.r.o.",
    accountNumber: "",
    iban: "",
    swift: "",
    bankName: "",
  },

  // Zápis v obchodním rejstříku (doplň dle skutečnosti)
  registration: "Spisová značka — doplnit (Městský soud v Praze)",

  // Branding
  colors: {
    red: "#E03930",
    anthracite: "#272425",
    grey: "#6C6D6F",
  },
};

/** Sazby DPH v ČR. */
export const VAT_RATES = {
  standard: 21,
  reduced1: 12,
  zero: 0,
} as const;

export const DEFAULT_VAT_RATE = VAT_RATES.standard;

export function formatCompanyAddressLine(): string {
  const a = COMPANY.address;
  return `${a.street}, ${a.zip} ${a.city}`;
}
