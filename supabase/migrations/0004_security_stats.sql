-- Seguridad, anti-spam y estadísticas confiables.
-- Idempotente: se puede ejecutar más de una vez.

-- =====================================================================
-- 1) Estadísticas: deduplicación por visitante y día
-- =====================================================================
-- Decisión sobre visitor_id:
--  * Vistas (view): lo genera el navegador (uuid en localStorage) y se envía a track_event().
--  * Clics de WhatsApp / mapa: pasan por rutas del servidor (/ir/...) que derivan un
--    identificador anónimo (hash de IP + user-agent + día, con sal secreta opcional) y lo
--    registran con la service role mediante track_event_server().
-- Con solo la clave anon un visitante determinado siempre podrá inventar visitor_id; esto
-- sube mucho el costo de inflar cifras (dedupe, tope diario por visitante, validación de
-- la publicación, exclusión del dueño) pero no es un sistema antifraude absoluto.

alter table events add column if not exists visitor_id text;
alter table events add column if not exists day date;

-- Rellena el día de los eventos previos (hora de Tabasco = Ciudad de México) y fija el default
update events set day = (created_at at time zone 'America/Mexico_City')::date where day is null;
alter table events alter column day set default ((now() at time zone 'America/Mexico_City')::date);
alter table events alter column day set not null;

alter table events drop constraint if exists events_visitor_id_len;
alter table events add constraint events_visitor_id_len
  check (visitor_id is null or char_length(visitor_id) between 8 and 80);

-- Un evento por (publicación, tipo, visitante, día); los eventos de tienda (sin publicación) por negocio
create unique index if not exists events_dedupe_listing
  on events (listing_id, kind, visitor_id, day)
  where listing_id is not null and visitor_id is not null;
create unique index if not exists events_dedupe_business
  on events (business_id, kind, visitor_id, day)
  where listing_id is null and visitor_id is not null;
create index if not exists events_visitor_day on events (visitor_id, day) where visitor_id is not null;

-- Función interna con toda la lógica; no se expone a la API
drop function if exists track_event(uuid, uuid, text);

create or replace function _record_event(p_listing uuid, p_business uuid, p_kind text, p_visitor text)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_business uuid;
  v_owner uuid;
begin
  if p_kind is null or p_kind not in ('view','whatsapp_click','map_click') then return; end if;
  if p_visitor is null or char_length(p_visitor) not between 8 and 80 then return; end if;

  if p_listing is not null then
    -- El negocio se deriva de la publicación: se ignora el p_business del cliente
    select l.business_id, b.owner_id into v_business, v_owner
      from listings l join businesses b on b.id = l.business_id
     where l.id = p_listing and l.status = 'published' and b.status = 'active';
  elsif p_business is not null and p_kind <> 'view' then
    -- Clic a nivel tienda (sin publicación)
    select b.id, b.owner_id into v_business, v_owner
      from businesses b where b.id = p_business and b.status = 'active';
  end if;
  if v_business is null then return; end if;

  -- No cuentan el dueño ni los administradores
  if auth.uid() is not null and (auth.uid() = v_owner or is_admin()) then return; end if;

  -- Tope diario por visitante (frena scripts que rotan publicaciones)
  if (select count(*) from events
       where visitor_id = p_visitor
         and day = (now() at time zone 'America/Mexico_City')::date) >= 300 then
    return;
  end if;

  insert into events (listing_id, business_id, kind, visitor_id)
  values (p_listing, v_business, p_kind, p_visitor)
  on conflict do nothing;
end $$;

revoke all on function _record_event(uuid, uuid, text, text) from public, anon, authenticated;

-- API pública para el navegador: solo vistas de publicaciones.
-- p_business se conserva por compatibilidad con llamadores anteriores y se ignora.
create or replace function track_event(
  p_listing uuid, p_business uuid, p_kind text, p_visitor text default null)
returns void language sql security definer set search_path = public as $$
  select _record_event(p_listing, null, p_kind, p_visitor)
  where p_kind = 'view' and p_listing is not null;
$$;
revoke all on function track_event(uuid, uuid, text, text) from public;
grant execute on function track_event(uuid, uuid, text, text) to anon, authenticated;

-- API solo para el servidor (service role): clics de WhatsApp y mapa desde /ir/*
create or replace function track_event_server(
  p_listing uuid, p_business uuid, p_kind text, p_visitor text)
returns void language sql security definer set search_path = public as $$
  select _record_event(p_listing, p_business, p_kind, p_visitor)
  where p_kind in ('whatsapp_click','map_click');
$$;
revoke all on function track_event_server(uuid, uuid, text, text) from public, anon, authenticated;
grant execute on function track_event_server(uuid, uuid, text, text) to service_role;

-- =====================================================================
-- 2) Anti-spam y límites en publicaciones
-- =====================================================================
create or replace function listings_antispam() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_status text;
  v_open int;
  v_today int;
begin
  if is_admin() then return new; end if;

  if new.description is not null and char_length(new.description) > 4000 then
    raise exception 'La descripción es demasiado larga (máximo 4000 caracteres)'
      using errcode = 'check_violation';
  end if;
  if char_length(new.title) > 120 then
    raise exception 'El título es demasiado largo (máximo 120 caracteres)'
      using errcode = 'check_violation';
  end if;

  if tg_op = 'UPDATE' and new.business_id is distinct from old.business_id then
    raise exception 'No puedes mover una publicación a otro negocio'
      using errcode = 'check_violation';
  end if;

  -- Cuenta suspendida: no crea ni publica
  if tg_op = 'INSERT' or new.status = 'published' then
    select status into v_status from businesses where id = new.business_id;
    if v_status = 'suspended' then
      raise exception 'Tu cuenta está suspendida y no puedes crear ni publicar contenido. Contáctanos para revisarla'
        using errcode = 'insufficient_privilege';
    end if;
  end if;

  if tg_op = 'INSERT' then
    select count(*) into v_today from listings
     where business_id = new.business_id
       and (created_at at time zone 'America/Mexico_City')::date = (now() at time zone 'America/Mexico_City')::date;
    if v_today >= 20 then
      raise exception 'Alcanzaste el máximo de 20 publicaciones creadas por día. Inténtalo mañana'
        using errcode = 'check_violation';
    end if;
  end if;

  -- Tope de publicaciones activas + borradores (las pausadas no cuentan)
  if new.status in ('draft','published')
     and (tg_op = 'INSERT' or old.status = 'paused') then
    select count(*) into v_open from listings
     where business_id = new.business_id and status in ('draft','published');
    if v_open >= 50 then
      raise exception 'Alcanzaste el máximo de 50 publicaciones activas y borradores. Pausa o elimina alguna para continuar'
        using errcode = 'check_violation';
    end if;
  end if;

  return new;
end $$;

drop trigger if exists listings_antispam on listings;
create trigger listings_antispam before insert or update on listings
  for each row execute function listings_antispam();

-- =====================================================================
-- 3) Límites y protecciones en negocios
-- =====================================================================
create or replace function businesses_antispam() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  -- Nadie cambia el dueño de un negocio (ni siquiera un administrador)
  if tg_op = 'UPDATE' and new.owner_id is distinct from old.owner_id then
    raise exception 'No se puede cambiar el dueño de un negocio'
      using errcode = 'insufficient_privilege';
  end if;

  if is_admin() then return new; end if;

  -- Una cuenta suspendida no puede editar su negocio
  if tg_op = 'UPDATE' and old.status = 'suspended' then
    raise exception 'Tu cuenta está suspendida y no puedes modificar tu negocio. Contáctanos para revisarla'
      using errcode = 'insufficient_privilege';
  end if;

  -- Solo se validan los campos nuevos o modificados (no rompe datos existentes)
  if (tg_op = 'INSERT' or new.name is distinct from old.name) and char_length(new.name) > 100 then
    raise exception 'El nombre del negocio es demasiado largo (máximo 100 caracteres)'
      using errcode = 'check_violation';
  end if;
  if (tg_op = 'INSERT' or new.description is distinct from old.description)
     and char_length(coalesce(new.description,'')) > 2000 then
    raise exception 'La descripción del negocio es demasiado larga (máximo 2000 caracteres)'
      using errcode = 'check_violation';
  end if;
  if (tg_op = 'INSERT' or new.address_text is distinct from old.address_text)
     and char_length(coalesce(new.address_text,'')) > 300 then
    raise exception 'La dirección es demasiado larga (máximo 300 caracteres)'
      using errcode = 'check_violation';
  end if;
  return new;
end $$;

drop trigger if exists businesses_antispam on businesses;
create trigger businesses_antispam before insert or update on businesses
  for each row execute function businesses_antispam();

-- =====================================================================
-- 4) Estadísticas del panel en una sola llamada
-- =====================================================================
-- Devuelve {"totals": {view, whatsapp_click, map_click},
--           "listings": [{id, title, slug, view, whatsapp_click, map_click, total}, ...top 10]}
create or replace function my_stats(p_days int default 30)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  v_biz uuid;
  v_since timestamptz := now() - make_interval(days => greatest(1, least(coalesce(p_days, 30), 365)));
  v_totals jsonb;
  v_listings jsonb;
begin
  select id into v_biz from businesses where owner_id = auth.uid();
  if v_biz is null then
    return jsonb_build_object(
      'totals', jsonb_build_object('view', 0, 'whatsapp_click', 0, 'map_click', 0),
      'listings', '[]'::jsonb);
  end if;

  select jsonb_build_object(
           'view',           count(*) filter (where kind = 'view'),
           'whatsapp_click', count(*) filter (where kind = 'whatsapp_click'),
           'map_click',      count(*) filter (where kind = 'map_click'))
    into v_totals
    from events
   where business_id = v_biz and created_at >= v_since;

  select coalesce(jsonb_agg(to_jsonb(t) order by t.total desc, t.title), '[]'::jsonb)
    into v_listings
    from (
      select l.id, l.title, l.slug,
             count(*) filter (where e.kind = 'view')           as "view",
             count(*) filter (where e.kind = 'whatsapp_click') as whatsapp_click,
             count(*) filter (where e.kind = 'map_click')      as map_click,
             count(*)                                          as total
        from listings l
        join events e on e.listing_id = l.id and e.created_at >= v_since
       where l.business_id = v_biz
       group by l.id, l.title, l.slug
       order by count(*) desc, l.title
       limit 10
    ) t;

  return jsonb_build_object('totals', v_totals, 'listings', v_listings);
end $$;

revoke all on function my_stats(int) from public, anon;
grant execute on function my_stats(int) to authenticated;
