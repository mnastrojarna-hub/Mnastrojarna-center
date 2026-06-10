import "server-only";
import { COMPANY } from "@/lib/company";
import { getSetting } from "@/lib/settings";

/**
 * Přepíše firemní údaje (COMPANY) hodnotami z Nastavení → Firemní údaje.
 * Volat před generováním dokladů (PDF) a odesíláním e-mailů,
 * aby na výstupech byly skutečné údaje zadané v aplikaci.
 */
export async function refreshCompanyFromSettings(): Promise<void> {
  const [name, street, city, zip, ico, dic, email, phone, web, account, iban, bankName, registration] =
    await Promise.all([
      getSetting("company_name"),
      getSetting("company_street"),
      getSetting("company_city"),
      getSetting("company_zip"),
      getSetting("company_ico"),
      getSetting("company_dic"),
      getSetting("company_email"),
      getSetting("company_phone"),
      getSetting("company_web"),
      getSetting("company_bank_account"),
      getSetting("company_iban"),
      getSetting("company_bank_name"),
      getSetting("company_registration"),
    ]);

  if (name) COMPANY.name = name;
  if (street) COMPANY.address.street = street;
  if (city) COMPANY.address.city = city;
  if (zip) COMPANY.address.zip = zip;
  if (ico) COMPANY.ico = ico;
  if (dic) COMPANY.dic = dic;
  if (email) COMPANY.email = email;
  if (phone) COMPANY.phone = phone;
  if (web) COMPANY.web = web;
  if (account) COMPANY.bank.accountNumber = account;
  if (iban) COMPANY.bank.iban = iban;
  if (bankName) COMPANY.bank.bankName = bankName;
  if (registration) COMPANY.registration = registration;
}
