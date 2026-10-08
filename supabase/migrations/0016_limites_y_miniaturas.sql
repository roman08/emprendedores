-- Límites de la primera versión (plan gratuito) y soporte de miniaturas.
-- Idempotente. Redefine funciones de 0011 (los triggers que las usan ya existen y las toman solas).
--
--   * 12 publicaciones por negocio (activas + pausadas + borradores) en lugar de 200 (y sin el tope de 50 de 0004/0011)
--   * 10 publicaciones nuevas por día por negocio (antes 20)
--   * 4 fotos por publicación (antes 10 en la base)
--   * Las miniaturas viven en Storage junto a cada foto con el sufijo ".t.webp"
--     (p. ej. <uid>/<listing>/<uuid>.webp y <uid>/<listing>/<uuid>.t.webp); no tienen fila propia en listing_images,
--     así que la detección de archivos huérfanos las considera referenciadas si su foto principal lo está.
--
-- Para cambiar los límites más adelante: nueva migración que redefina estas funciones con otros números.

-- ---------------------------------------------------------------------
-- 1) Publicaciones: topes por negocio y por día
-- ---------------------------------------------------------------------
create or replace function listings_antispam() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_status text;
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
    if v_today >= 10 then
      raise exception 'Alcanzaste el máximo de 10 publicaciones creadas por día. Inténtalo mañana'
        using errcode = 'check_violation';
    end if;

    -- Cuentan todas (activas, pausadas y borradores): pausar no libera espacio
    select count(*) into v_total from listings where business_id = new.business_id;
    if v_total >= 12 then
      raise exception 'Llegaste al máximo de 12 publicaciones por negocio. Elimina alguna para crear otra'
        using errcode = 'check_violation';
    end if;
  end if;

  return new;
end $$;

-- ---------------------------------------------------------------------
-- 2) Fotos: máximo 4 por publicación
-- ---------------------------------------------------------------------
create or replace function listing_images_limit() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if auth.uid() is not null and not is_admin()
     and (select count(*) from listing_images where listing_id = new.listing_id) >= 4 then
    raise exception 'Una publicación admite como máximo 4 fotos' using errcode = 'check_violation';
  end if;
  if char_length(new.url) > 500 then
    raise exception 'La URL de la foto es demasiado larga' using errcode = 'check_violation';
  end if;
  return new;
end $$;

-- ---------------------------------------------------------------------
-- 3) Archivos huérfanos: una miniatura (.t.webp) está en uso si lo está su foto principal
-- ---------------------------------------------------------------------
create or replace function orphan_storage_objects()
returns table (bucket_id text, name text, created_at timestamptz)
language plpgsql stable security definer set search_path = public, storage, pg_temp as $$
begin
  if not is_admin() then
    raise exception 'Solo administradores' using errcode = 'insufficient_privilege';
  end if;
  return query
    select o.bucket_id::text, o.name::text, o.created_at
    from storage.objects o
    where o.created_at < now() - interval '1 hour'
      and (
        (o.bucket_id = 'listing-images' and not exists (
          select 1 from listing_images li
          where li.url like '%/listing-images/' || o.name
             or li.url like '%/listing-images/' || regexp_replace(o.name, '[.]t[.]webp$', '.webp')))
        or
        (o.bucket_id = 'business-media' and not exists (
          select 1 from businesses b
          where b.logo_url like '%/business-media/' || o.name
             or b.banner_url like '%/business-media/' || o.name))
      )
    order by o.created_at;
end $$;

revoke all on function orphan_storage_objects() from public, anon;
grant execute on function orphan_storage_objects() to authenticated;
