-- Výkres → položka zakázky a archiv výkresů (napojení, Krok B): výslovný stav tepelného zpracování
-- a povrchových úprav, kroky úprav v pořadí (s hodnotami) a zdroj každé skupiny údajů.
-- Logika: src/lib/jobs/drawing-spec.ts (specColumns, mergeSpecPatch).
--  - heat_status / surface_status: uvedeno | bez (výkres přečten, úprava na něm není) | nezjisteno (nečitelné / bez AI)
--  - heat_steps / surface_steps: [{kind, value, unit, depthMm, note}] / [{kind, spec, thicknessUm}] v pořadí z výkresu
--  - spec_sources: {"material_group":"ai","heat":"rucne",…} — „rucne" = zadal člověk, AI ho nepřepíše
-- Vše idempotentní (add column if not exists, constraint jen když chybí).

do $$
declare
  t text;
begin
  foreach t in array array['drawings', 'order_items'] loop
    execute format('alter table %I add column if not exists heat_status    text', t);
    execute format('alter table %I add column if not exists surface_status text', t);
    execute format('alter table %I add column if not exists heat_steps     jsonb', t);
    execute format('alter table %I add column if not exists surface_steps  jsonb', t);
    execute format('alter table %I add column if not exists spec_sources   jsonb not null default ''{}''::jsonb', t);

    if not exists (select 1 from pg_constraint where conname = t || '_heat_status_check' and conrelid = t::regclass) then
      execute format('alter table %I add constraint %I check (heat_status is null or heat_status in (''uvedeno'', ''bez'', ''nezjisteno''))',
        t, t || '_heat_status_check');
    end if;
    if not exists (select 1 from pg_constraint where conname = t || '_surface_status_check' and conrelid = t::regclass) then
      execute format('alter table %I add constraint %I check (surface_status is null or surface_status in (''uvedeno'', ''bez'', ''nezjisteno''))',
        t, t || '_surface_status_check');
    end if;
    if not exists (select 1 from pg_constraint where conname = t || '_treatment_steps_check' and conrelid = t::regclass) then
      execute format('alter table %I add constraint %I check ((heat_steps is null or jsonb_typeof(heat_steps) = ''array'') and (surface_steps is null or jsonb_typeof(surface_steps) = ''array'') and jsonb_typeof(spec_sources) = ''object'')',
        t, t || '_treatment_steps_check');
    end if;

    execute format($c$comment on column %I.heat_status is 'Tepelné zpracování: uvedeno | bez (výkres přečten, TZ není) | nezjisteno (doplnit)'$c$, t);
    execute format($c$comment on column %I.surface_status is 'Povrchová úprava: uvedeno | bez (výkres přečten, PÚ není) | nezjisteno (doplnit)'$c$, t);
    execute format($c$comment on column %I.heat_steps is 'Kroky TZ v pořadí: [{kind, value, unit, depthMm, note}] (drawing-spec.ts HeatStep)'$c$, t);
    execute format($c$comment on column %I.surface_steps is 'Kroky PÚ v pořadí: [{kind, spec, thicknessUm}] (drawing-spec.ts SurfaceStep)'$c$, t);
    execute format($c$comment on column %I.spec_sources is 'Zdroj skupin údajů z výkresu: {material_group|material_designation|weight|blank|heat|surface|notes: ai|rucne}'$c$, t);
  end loop;
end $$;

notify pgrst, 'reload schema';
