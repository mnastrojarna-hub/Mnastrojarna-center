-- Denní limit nákladů AI anonymizace 50 USD (rozhodnutí majitele 30. 10.: „Denní limit dej na 50 usd").
-- Idempotentní: nastaví výchozí hodnotu sloupce i stávající řádek nastavení.
alter table drawing_anon_settings alter column daily_usd set default 50;
insert into drawing_anon_settings (id) values (1) on conflict do nothing;
update drawing_anon_settings set daily_usd = 50, updated_at = now() where id = 1 and daily_usd <> 50;
