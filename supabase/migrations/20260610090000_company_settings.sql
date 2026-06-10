-- ============================================================
-- 0017 — Firemní údaje v nastavení (onboarding přes UI)
-- Vystavovatel dokladů: jdou na nabídky, faktury a dodací listy.
-- ============================================================

insert into integration_settings (key, category, label, is_secret, value) values
  ('company_name',          'firma', 'Název firmy',                    false, 'MNástrojárna s.r.o.'),
  ('company_street',        'firma', 'Ulice a č.p. (sídlo)',           false, 'Varšavská 715/36'),
  ('company_city',          'firma', 'Město',                          false, 'Praha 2'),
  ('company_zip',           'firma', 'PSČ',                            false, '120 00'),
  ('company_ico',           'firma', 'IČO',                            false, '04304080'),
  ('company_dic',           'firma', 'DIČ',                            false, 'CZ04304080'),
  ('company_email',         'firma', 'Firemní e-mail',                 false, 'obchod@mnastrojarna.cz'),
  ('company_phone',         'firma', 'Telefon',                        false, null),
  ('company_web',           'firma', 'Web',                            false, 'www.mnastrojarna.cz'),
  ('company_bank_account',  'firma', 'Číslo účtu',                     false, null),
  ('company_iban',          'firma', 'IBAN',                           false, null),
  ('company_bank_name',     'firma', 'Banka',                          false, null),
  ('company_registration',  'firma', 'Zápis v OR (spisová značka)',    false, null)
on conflict (key) do nothing;
