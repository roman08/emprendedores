-- Extras de publicaciones: disponibilidad y detección de archivos huérfanos

-- ---------- Disponibilidad ----------
alter table listings
  add column if not exists availability text not null default 'available';

-- check idempotente (add column if not exists no re-agrega la restricción)
alter table listings drop constraint if exists listings_availability_check;
alter table listings
  add constraint listings_availability_check
  check (availability in ('available','sold_out','on_demand'));

comment on column listings.availability is
  'Disponibilidad: available = en existencia, sold_out = agotado, on_demand = sobre pedido';

-- ---------- Archivos huérfanos en Storage (solo lectura, solo admin) ----------
-- Lista objetos de los buckets que ninguna fila referencia:
--   listing-images -> listing_images.url
--   business-media -> businesses.logo_url / businesses.banner_url
-- Uso (como admin): select * from orphan_storage_objects();
-- No borra nada: revisa el resultado y elimina desde el panel de Storage si procede.
-- Se ignoran objetos de menos de 1 hora para no marcar subidas en curso.
create or replace function orphan_storage_objects()
returns table (bucket_id text, name text, created_at timestamptz)
language plpgsql stable security definer set search_path = public, storage as $$
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
          where li.url like '%/listing-images/' || o.name))
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
