-- Výkres: skupina materiálu, hmotnost dílu i polotovaru, tepelné zpracování, povrchové úpravy,
-- tvrdost a poznámky z výkresu — na archivu výkresů (drawings) i na položce zakázky (order_items).
-- Výpočet: src/lib/jobs/material-groups.ts (skupiny, úpravy) a src/lib/jobs/blank-weight.ts (polotovar).
-- Stav dodání materiálu (+QT, T6, ČSN 15 142.7…) je zvlášť v material_condition — heat_treatment jsou jen operace.
-- Vše nullable a idempotentní (add column if not exists, constraint jen když chybí).

do $$
declare
  t text;
begin
  foreach t in array array['drawings', 'order_items'] loop
    execute format('alter table %I add column if not exists material_group       text', t);
    execute format('alter table %I add column if not exists material_designation text', t);
    execute format('alter table %I add column if not exists weight_kg            numeric(12,3)', t);
    execute format('alter table %I add column if not exists blank_weight_kg      numeric(12,3)', t);
    execute format('alter table %I add column if not exists blank_dims           text', t);
    execute format('alter table %I add column if not exists blank_shape          text', t);
    execute format('alter table %I add column if not exists heat_treatment       text', t);
    execute format('alter table %I add column if not exists surface_treatment    text', t);
    execute format('alter table %I add column if not exists hardness             text', t);
    execute format('alter table %I add column if not exists drawing_notes        text', t);
    execute format('alter table %I add column if not exists weight_source        text', t);
    execute format('alter table %I add column if not exists material_condition   text', t);

    if not exists (select 1 from pg_constraint where conname = t || '_weight_source_check' and conrelid = t::regclass) then
      execute format('alter table %I add constraint %I check (weight_source is null or weight_source in (''vykres'', ''odhad'', ''rucne''))',
        t, t || '_weight_source_check');
    end if;
    if not exists (select 1 from pg_constraint where conname = t || '_weights_nonneg_check' and conrelid = t::regclass) then
      execute format('alter table %I add constraint %I check ((weight_kg is null or weight_kg >= 0) and (blank_weight_kg is null or blank_weight_kg >= 0))',
        t, t || '_weights_nonneg_check');
    end if;

    execute format($c$comment on column %I.material_group is 'Skupina materiálu pro přehled: bezna_ocel | zuslechtena_ocel | nastrojova_ocel | slinuty_karbid | nerez | duplex | med | barevne_kovy | litina | hlinik | titan | plasty | ostatni'$c$, t);
    execute format($c$comment on column %I.material_designation is 'Uklizené označení materiálu (ČSN 19 552, 1.2379, 42CrMo4+QT, EN AW-6082…)'$c$, t);
    execute format($c$comment on column %I.weight_kg is 'Hmotnost dílu v kg (zdroj ve weight_source)'$c$, t);
    execute format($c$comment on column %I.blank_weight_kg is 'Hmotnost polotovaru v kg — vždy odhad z rozměrů a hustoty'$c$, t);
    execute format($c$comment on column %I.blank_dims is 'Rozměr polotovaru (Ø70 × 130 mm, 125 × 90 × 35 mm…)'$c$, t);
    execute format($c$comment on column %I.blank_shape is 'Tvar polotovaru: kulatina | trubka | sestihran | ctyrhran | plocha_tyc | prirez | plech (výpalek) | odlitek'$c$, t);
    execute format($c$comment on column %I.heat_treatment is 'Tepelné zpracování z výkresu (kalení, zušlechtění, cementace, nitridace…)'$c$, t);
    execute format($c$comment on column %I.surface_treatment is 'Povrchové úpravy z výkresu (zinek, elox, černění, chrom, nikl, lak, PVD…)'$c$, t);
    execute format($c$comment on column %I.hardness is 'Tvrdost z výkresu (58-60 HRC, min. 600 HV1…)'$c$, t);
    execute format($c$comment on column %I.drawing_notes is 'Poznámky / popis z výkresu'$c$, t);
    execute format($c$comment on column %I.weight_source is 'Zdroj weight_kg: vykres | odhad | rucne'$c$, t);
    execute format($c$comment on column %I.material_condition is 'Stav dodání materiálu (+QT, +A, +N, T6, ČSN .6/.7/.8…) — NENÍ operace tepelného zpracování'$c$, t);
  end loop;
end $$;

-- Rychlý přehled / filtr archivu výkresů podle skupiny materiálu
create index if not exists idx_drawings_material_group on drawings(material_group);

notify pgrst, 'reload schema';
