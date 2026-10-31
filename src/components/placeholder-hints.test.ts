import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";

/**
 * Majitel 31. 10.: vzory v prázdných polích („firma.cz", „Sklad Hala B, Výrobní 4…", IČO, jména, telefony,
 * e-maily, účty) vypadaly jako uložená data. Ve formulářích zákazníka, dodavatele, kontaktů, nastavení
 * a firemních údajů smí být jen neutrální nápověda (kurzívou), nikdy hodnota, která vypadá jako data.
 */
const FILES = [
  "customers/customer-dialog.tsx",
  "customers/contacts-manager.tsx",
  "suppliers/supplier-dialog.tsx",
  "contacts/party-book-editor.tsx",
  "contacts/role-emails.tsx",
  "users/add-user-dialog.tsx",
  "account/profile-form.tsx",
  "setup-wizard.tsx",
  "settings/drawing-anon-settings.tsx",
  "mail/signature-editor.tsx",
  "customer-pricing-profile.tsx",
  "approval-queue.tsx",
  "flow/document-send-dialog.tsx",
];

const FAKE: [string, RegExp][] = [
  ["e-mailová adresa", /[\w.-]+@[\w-]+\.\w/],
  ["telefon", /\+\d{3}|\d{3} \d{3}/],
  ["číslo (IČO, účet, PSČ…)", /\d{3}/],
  ["právní forma", /s\.r\.o|a\.s\./],
  ["doména", /\b[\w-]+\.cz\b/],
  ["konkrétní místo / jméno", /Brno|Praha|Hala|Mezná|Nov[aá]k|Dvořák|Svoboda|Strojmetal|Kalírna|STROJMETAL|Komerční banka/],
];

function placeholders(src: string): string[] {
  const out: string[] = [];
  for (const m of src.matchAll(/placeholder(?:=|:\s*)(?:"([^"]*)"|\{"([^"]*)"\}|\{([^}]*)\})/g)) {
    const raw = m[1] ?? m[2] ?? m[3] ?? "";
    // výraz: posuzujeme jen textové literály v něm (proměnné = skutečná data, např. web firmy)
    if (m[3] !== undefined) out.push(...[...raw.matchAll(/"([^"]*)"/g)].map((x) => x[1]));
    else out.push(raw);
  }
  return out;
}

describe("vzory v polích formulářů vypadají jako nápověda, ne jako data", () => {
  for (const rel of FILES) {
    it(rel, () => {
      const src = fs.readFileSync(path.join(__dirname, rel), "utf8");
      const list = placeholders(src);
      expect(list.length).toBeGreaterThan(0);
      for (const p of list) {
        for (const [what, re] of FAKE) expect(re.test(p), `${rel}: vzor „${p}“ vypadá jako ${what}`).toBe(false);
      }
    });
  }
});
