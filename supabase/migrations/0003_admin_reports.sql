-- Panel de administración y reportes
-- Idempotente: se puede ejecutar más de una vez.

-- ---------- Reportes: validaciones ----------
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'reports_target_chk') then
    alter table reports add constraint reports_target_chk
      check (listing_id is not null or business_id is not null) not valid;
  end if;
  if not exists (select 1 from pg_constraint where conname = 'reports_reason_len_chk') then
    alter table reports add constraint reports_reason_len_chk
      check (char_length(reason) between 1 and 80) not valid;
  end if;
  if not exists (select 1 from pg_constraint where conname = 'reports_details_len_chk') then
    alter table reports add constraint reports_details_len_chk
      check (details is null or char_length(details) <= 1000) not valid;
  end if;
end $$;

create index if not exists reports_resolved_created_idx on reports (resolved, created_at desc);
create index if not exists reports_listing_idx on reports (listing_id) where listing_id is not null;
create index if not exists reports_business_idx on reports (business_id) where business_id is not null;

-- Anti-abuso: máximo 5 reportes por hora sobre la misma publicación/negocio.
-- Corre como definer porque la lectura de reports está reservada a admin por RLS.
create or replace function reports_rate_limit() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_count int;
begin
  select count(*) into v_count from reports r
  where r.created_at > now() - interval '1 hour'
    and ((new.listing_id is not null and r.listing_id = new.listing_id)
      or (new.business_id is not null and r.business_id = new.business_id));
  if v_count >= 5 then
    raise exception 'Demasiados reportes sobre este contenido. Inténtalo más tarde.'
      using errcode = 'check_violation';
  end if;
  return new;
end $$;

drop trigger if exists reports_rate_limit_trg on reports;
create trigger reports_rate_limit_trg before insert on reports
  for each row execute function reports_rate_limit();

-- La política abierta se reemplaza por una que exige un objetivo
drop policy if exists "reporte crear" on reports;
create policy "reporte crear" on reports for insert
  with check (listing_id is not null or business_id is not null);

-- Admin puede borrar reportes (limpieza)
drop policy if exists "reporte admin del" on reports;
create policy "reporte admin del" on reports for delete using (is_admin());

-- ---------- Eventos: lectura admin (ya cubierta por "eventos dueño", se deja explícita) ----------
drop policy if exists "eventos admin" on events;
create policy "eventos admin" on events for select using (is_admin());

-- ---------- Estadísticas globales para el panel admin ----------
create or replace function admin_stats() returns jsonb
language plpgsql stable security definer set search_path = public as $$
begin
  if not is_admin() then
    raise exception 'Acceso denegado' using errcode = '42501';
  end if;
  return jsonb_build_object(
    'businesses', (select count(*) from businesses),
    'businesses_suspended', (select count(*) from businesses where status = 'suspended'),
    'listings_published', (select count(*) from listings where status = 'published'),
    'reports_pending', (select count(*) from reports where not resolved),
    'events_30d', (select count(*) from events where created_at > now() - interval '30 days'),
    'views_30d', (select count(*) from events where kind = 'view' and created_at > now() - interval '30 days'),
    'whatsapp_30d', (select count(*) from events where kind = 'whatsapp_click' and created_at > now() - interval '30 days')
  );
end $$;

revoke all on function admin_stats() from public, anon;
grant execute on function admin_stats() to authenticated;

-- Índices para las listas del panel admin
create index if not exists businesses_created_idx on businesses (created_at desc);
create index if not exists events_created_idx on events (created_at);
