-- Correcciones de seguridad de la revisión de QA (SEC-03, 04, 07, 08, 10, 11, 12, 18).
-- Idempotente: se puede ejecutar más de una vez. Ejecútala DESPUÉS de 0010 y antes de 0012 (o en cualquier momento
-- si ya corriste 0012-0014; si corriste 0014 antes de que esta versión existiera, vuelve a ejecutar 0014 después).
-- No toca datos existentes: todas las validaciones nuevas aplican solo a filas nuevas o a campos que se modifican.
-- Convención: auth.uid() nulo = SQL Editor / service role, que siguen sin restricciones de moderación.

-- =====================================================================
-- 1) SEC-03: nadie se vuelve admin desde el navegador (refuerza 0010)
-- =====================================================================
-- Mismo trigger de 0010 (por si 0010 no se hubiera ejecutado) + tope de nombre.
create or replace function public.profiles_protect_role() returns trigger
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
begin
  if new.role is distinct from old.role and auth.uid() is not null and not public.is_admin() then
    raise exception 'No puedes cambiar tu rol' using errcode = '42501';
  end if;
  if new.id is distinct from old.id then
    raise exception 'No puedes cambiar el id del perfil' using errcode = '42501';
  end if;
  if new.full_name is distinct from old.full_name and char_length(coalesce(new.full_name, '')) > 100 then
    raise exception 'El nombre es demasiado largo (máximo 100 caracteres)' using errcode = 'check_violation';
  end if;
  return new;
end;
$$;

drop trigger if exists profiles_protect_role on public.profiles;
create trigger profiles_protect_role
  before update on public.profiles
  for each row execute function public.profiles_protect_role();

-- Defensa en profundidad: el navegador solo puede actualizar full_name (el rol se cambia desde el SQL Editor)
revoke update on public.profiles from anon, authenticated;
grant update (full_name) on public.profiles to authenticated;

-- =====================================================================
-- 2) SEC-04: el dueño no fija featured_until, slug ni created_at al crear
-- =====================================================================
create or replace function listings_before_write() returns trigger
language plpgsql set search_path = public, pg_temp as $$
begin
  if tg_op = 'INSERT' and (new.slug is null or new.slug = '') then
    new.slug := slugify(new.title) || '-' || substr(replace(gen_random_uuid()::text,'-',''),1,5);
  end if;
  if auth.uid() is not null and not is_admin() then
    if tg_op = 'INSERT' then
      -- El cliente no elige destacado, slug ni fecha de creación (el tope diario y los listados dependen de ellos)
      new.featured_until := null;
      new.created_at := now();
      new.slug := slugify(new.title) || '-' || substr(replace(gen_random_uuid()::text,'-',''),1,5);
    else
      new.featured_until := old.featured_until;   -- solo admin destaca publicaciones
      new.created_at := old.created_at;
      new.slug := old.slug;
    end if;
  end if;
  -- Fotos obligatorias: no se puede publicar sin al menos una imagen
  if new.status = 'published' and
     not exists (select 1 from listing_images where listing_id = new.id) then
    raise exception 'Una publicación necesita al menos una foto para publicarse'
      using errcode = 'check_violation';
  end if;
  return new;
end $$;

-- Negocios: slug y created_at los fija el servidor
create or replace function businesses_before_write() returns trigger
language plpgsql set search_path = public, pg_temp as $$
begin
  if auth.uid() is not null and not is_admin() then
    new.slug := null;
    new.created_at := now();
  end if;
  if new.slug is null or new.slug = '' then
    new.slug := slugify(new.name) || '-' || substr(replace(gen_random_uuid()::text,'-',''),1,5);
  end if;
  return new;
end $$;

create or replace function businesses_protect_admin_fields() returns trigger
language plpgsql set search_path = public, pg_temp as $$
begin
  if auth.uid() is not null and not is_admin() then
    new.verified := old.verified;
    new.status := old.status;
    new.owner_id := old.owner_id;
    new.slug := old.slug;
    new.created_at := old.created_at;
  end if;
  return new;
end $$;

-- Publicaciones: mismo límite de 0004 + tope total (las pausadas no contaban y permitían filas ilimitadas)
create or replace function listings_antispam() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_status text;
  v_open int;
  v_today int;
  v_total int;
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
    select count(*) into v_total from listings where business_id = new.business_id;
    if v_total >= 200 then
      raise exception 'Alcanzaste el máximo de 200 publicaciones por negocio. Elimina alguna para continuar'
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

-- =====================================================================
-- 3) SEC-07 y SEC-12: validación de enlaces y tamaños en negocios (solo campos nuevos o modificados)
-- =====================================================================
create or replace function businesses_antispam() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
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

  -- SEC-07: /ir/mapa redirige a este enlace, así que solo se aceptan servicios de mapas conocidos.
  -- Debe coincidir con safeMapsUrl() de src/lib/format.ts.
  if (tg_op = 'INSERT' or new.google_maps_url is distinct from old.google_maps_url)
     and coalesce(new.google_maps_url, '') <> ''
     and new.google_maps_url !~* '^https://((www[.])?google[.][a-z]{2,3}([.][a-z]{2})?/maps|maps[.]google[.][a-z]{2,3}([.][a-z]{2})?(/|$|[?])|maps[.]app[.]goo[.]gl(/|$|[?])|goo[.]gl/maps|(www[.])?openstreetmap[.]org(/|$|[?])|(www[.])?waze[.]com(/|$|[?])|maps[.]apple[.]com(/|$|[?]))' then
    raise exception 'El enlace de mapa debe ser de Google Maps, OpenStreetMap, Waze o Apple Maps'
      using errcode = 'check_violation';
  end if;

  -- SEC-12: tamaños (hours lo carga /cerca para hasta 60 negocios a la vez)
  if (tg_op = 'INSERT' or new.google_maps_url is distinct from old.google_maps_url)
     and char_length(coalesce(new.google_maps_url,'')) > 500 then
    raise exception 'El enlace de mapa es demasiado largo (máximo 500 caracteres)' using errcode = 'check_violation';
  end if;
  if (tg_op = 'INSERT' or new.instagram is distinct from old.instagram)
     and char_length(coalesce(new.instagram,'')) > 100 then
    raise exception 'El Instagram es demasiado largo (máximo 100 caracteres)' using errcode = 'check_violation';
  end if;
  if (tg_op = 'INSERT' or new.facebook is distinct from old.facebook)
     and char_length(coalesce(new.facebook,'')) > 300 then
    raise exception 'El enlace de Facebook es demasiado largo (máximo 300 caracteres)' using errcode = 'check_violation';
  end if;
  if (tg_op = 'INSERT' or new.website is distinct from old.website)
     and char_length(coalesce(new.website,'')) > 300 then
    raise exception 'El sitio web es demasiado largo (máximo 300 caracteres)' using errcode = 'check_violation';
  end if;
  if (tg_op = 'INSERT' or new.logo_url is distinct from old.logo_url)
     and char_length(coalesce(new.logo_url,'')) > 500 then
    raise exception 'La URL del logo es demasiado larga' using errcode = 'check_violation';
  end if;
  if (tg_op = 'INSERT' or new.banner_url is distinct from old.banner_url)
     and char_length(coalesce(new.banner_url,'')) > 500 then
    raise exception 'La URL del banner es demasiado larga' using errcode = 'check_violation';
  end if;
  if (tg_op = 'INSERT' or new.hours is distinct from old.hours)
     and new.hours is not null and pg_column_size(new.hours) > 4000 then
    raise exception 'El horario es demasiado grande' using errcode = 'check_violation';
  end if;
  return new;
end $$;

-- SEC-12: máximo de fotos por publicación también en la base (el cliente permite 5)
create or replace function listing_images_limit() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if auth.uid() is not null and not is_admin()
     and (select count(*) from listing_images where listing_id = new.listing_id) >= 10 then
    raise exception 'Una publicación admite como máximo 10 fotos' using errcode = 'check_violation';
  end if;
  if char_length(new.url) > 500 then
    raise exception 'La URL de la foto es demasiado larga' using errcode = 'check_violation';
  end if;
  return new;
end $$;

drop trigger if exists listing_images_limit on listing_images;
create trigger listing_images_limit before insert on listing_images
  for each row execute function listing_images_limit();

-- =====================================================================
-- 4) SEC-08: reportes y eventos anónimos con tope real
-- =====================================================================
-- created_at y resolved los fija el servidor: antes un reporte con created_at antiguo no contaba en el límite de 5/hora.
-- (0014 vuelve a definir esta función con las reseñas; mantiene estas dos líneas.)
create or replace function reports_rate_limit() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_count int;
begin
  new.created_at := now();
  new.resolved := false;
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

-- Eventos: además del tope por visitante (que el cliente elige), tope por publicación/negocio, tipo y día
create or replace function _record_event(p_listing uuid, p_business uuid, p_kind text, p_visitor text)
returns void language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_business uuid;
  v_owner uuid;
  v_day date := (now() at time zone 'America/Mexico_City')::date;
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
  if (select count(*) from events where visitor_id = p_visitor and day = v_day) >= 300 then
    return;
  end if;

  -- Tope diario por destino y tipo (frena a quien rota visitor_id para inflar métricas o llenar la tabla)
  if p_listing is not null then
    if (select count(*) from events where listing_id = p_listing and kind = p_kind and day = v_day) >= 1000 then
      return;
    end if;
  elsif (select count(*) from events where business_id = v_business and listing_id is null and kind = p_kind and day = v_day) >= 1000 then
    return;
  end if;

  insert into events (listing_id, business_id, kind, visitor_id)
  values (p_listing, v_business, p_kind, p_visitor)
  on conflict do nothing;
end $$;

revoke all on function _record_event(uuid, uuid, text, text) from public, anon, authenticated;

-- =====================================================================
-- 5) SEC-11: buckets con límite de tamaño y tipo; listado de objetos solo del dueño y del admin
-- =====================================================================
-- El cliente comprime a WebP (máx. ~0.8 MB). El límite deja margen.
update storage.buckets
   set file_size_limit = 2097152,
       allowed_mime_types = array['image/webp','image/jpeg','image/png']
 where id in ('listing-images','business-media');

-- Los buckets son públicos: las URL /object/public/... no necesitan policy de select.
-- La policy abierta "media lectura" permitía a cualquiera (anon) listar carpetas y archivos de todos.
drop policy if exists "media lectura" on storage.objects;
drop policy if exists "media lectura propia" on storage.objects;
create policy "media lectura propia" on storage.objects for select to authenticated
  using (bucket_id in ('listing-images','business-media')
         and (storage.foldername(name))[1] = auth.uid()::text);
-- El admin conserva "media admin lectura" (0009).

-- =====================================================================
-- 6) SEC-18: search_path con pg_temp en las funciones SECURITY DEFINER y EXECUTE de admin_stats
-- =====================================================================
do $$
declare
  r record;
begin
  for r in
    select * from (values
      ('public.is_admin()',                              'public, pg_temp'),
      ('public.handle_new_user()',                       'public, pg_temp'),
      ('public.track_event(uuid,uuid,text,text)',       'public, pg_temp'),
      ('public.track_event_server(uuid,uuid,text,text)','public, pg_temp'),
      ('public.my_stats(integer)',                       'public, pg_temp'),
      ('public.admin_stats()',                           'public, pg_temp'),
      ('public.orphan_storage_objects()',                'public, storage, pg_temp'),
      ('public.admin_orphan_objects()',                  'public, storage, pg_temp'),
      ('public.delete_my_account()',                     'public, auth, pg_temp')
    ) as t(sig, path)
  loop
    if to_regprocedure(r.sig) is not null then
      execute format('alter function %s set search_path = %s', r.sig, r.path);
    end if;
  end loop;
end $$;

-- 0003 ya lo pedía, pero en la base real anon conservaba EXECUTE (Supabase concede por defecto)
revoke execute on function public.admin_stats() from public, anon;
grant execute on function public.admin_stats() to authenticated;
