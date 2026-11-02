-- ============================================================
-- Objednávka dodavateli — odchylky od výkresu (majitel 2. 11.): „Pokud vystavím objednávku a jsou tam
-- nějaké opravy oproti výkresu, musí se to zanést do textu objednávky i mailu."
--
--  * purchase_order_items.drawing_deviations — potvrzený seznam odchylek položky (pokyny zákazníka
--    z e-mailu nadřazené výkresu, oprava zakázky, nová revize, ruční doplnění). NULL = automaticky
--    (seznam se sestaví při tisku / odeslání ze zdrojů zakázky); pole = potvrzeno v dialogu objednávky
--    (vypnuté položky mají "off": true, nové odchylky ze zdrojů se k potvrzenému seznamu přidají).
-- Idempotentní (jde pustit znovu).
-- ============================================================

alter table purchase_order_items add column if not exists drawing_deviations jsonb;

do $$ begin
  alter table purchase_order_items add constraint purchase_order_items_drawing_deviations_check
    check (drawing_deviations is null or (jsonb_typeof(drawing_deviations) = 'array' and jsonb_array_length(drawing_deviations) <= 40));
exception when duplicate_object then null; end $$;

comment on column purchase_order_items.drawing_deviations is
  'Odchylky od výkresu potvrzené v dialogu objednávky ([{key, source, label, value, drawingValue?, was?, off?}]); NULL = automaticky ze zdrojů zakázky.';
