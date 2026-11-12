-- ============================================================
-- 20261109120000 — Šponer odesílá cenové nabídky bez schvalování (9. 11.)
-- Majitel: „nově šponer nebude potřebovat schvalovat odesílání cenových nabídek"
--
-- Jednorázově (značka quote_approval_sponer_off_v1): Šponer → profiles.quote_needs_approval = false.
-- Trigger trg_profiles_quote_approval_after (20261030200000) hned přepočte jeho NEODESLANÉ čekající nabídky
-- (navrh_ai / ke_schvaleni bez schválení) → už schválení nepotřebují, může je odeslat sám.
-- Odeslané, přijaté, zamítnuté a schválené nabídky se nemění. Režim AI nabídek (quote_ai_needs_approval) beze změny.
-- Shoda jména / e-mailu jako 20261109100000 (stage_change_sponer_v1); když není právě jeden, nic se nenastaví —
-- super admin to přepne ve Správě uživatelů („Nabídky musí schválit super admin").
-- Idempotentní: druhé spuštění nic nezmění (značka). Pozdější ruční změna ve Správě uživatelů se nepřepíše.
-- ============================================================

do $$
declare
  v_new    boolean;
  v_ids    uuid[];
  v_rows   text;
  v_before integer;
  v_after  integer;
begin
  insert into integration_settings (key, category, label, is_secret, value)
  values ('quote_approval_sponer_off_v1', 'ai_access', 'Šponer odesílá nabídky bez schvalování (9. 11.)', false, 'done')
  on conflict (key) do nothing
  returning true into v_new;
  if not coalesce(v_new, false) then
    raise notice 'Šponer bez schvalování nabídek: nastavení už proběhlo dřív — beze změny.';
    return;
  end if;
  select array_agg(p.id order by p.created_at), string_agg(coalesce(p.full_name, '') || ' <' || coalesce(p.email, '') || '>', ', ')
    into v_ids, v_rows
    from profiles p
   where p.full_name ilike '%šponer%' or p.full_name ilike '%sponer%' or p.email ilike '%sponer%';
  if coalesce(array_length(v_ids, 1), 0) = 1 then
    select count(*) into v_before from quotes q
     where q.created_by = v_ids[1] and q.admin_approval_required and q.approved_by is null
       and q.status in ('navrh_ai', 'ke_schvaleni') and q.sent_at is null;
    -- trigger trg_profiles_quote_approval_after hned přepočte jeho čekající nabídky
    update profiles set quote_needs_approval = false where id = v_ids[1] and quote_needs_approval;
    select count(*) into v_after from quotes q
     where q.created_by = v_ids[1] and q.admin_approval_required and q.approved_by is null
       and q.status in ('navrh_ai', 'ke_schvaleni') and q.sent_at is null;
    raise notice 'Šponer bez schvalování nabídek: % — odesílá sám; % čekajících nabídek už schválení nepotřebuje.',
      v_rows, v_before - v_after;
  else
    raise notice 'Šponer bez schvalování nabídek: Šponera nelze jednoznačně určit (nalezeno %: %) — nic nenastaveno, přepni ve Správě uživatelů.',
      coalesce(array_length(v_ids, 1), 0), coalesce(v_rows, '—');
  end if;
end $$;
