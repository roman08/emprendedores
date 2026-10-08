-- Búsqueda de publicaciones ordenada de la más cercana a la más lejana al visitante.
-- Distancia (haversine, km): si el negocio tiene local con pin se usa su ubicación exacta;
-- si no (servicios a domicilio, en línea), se usa el centro de su municipio como aproximación;
-- sin ninguna de las dos queda al final. No usa PostGIS.

create or replace function haversine_km(
  lat1 double precision, lng1 double precision, lat2 double precision, lng2 double precision
) returns double precision
language sql immutable parallel safe
as $$
  select (6371 * 2 * asin(least(1, sqrt(
    power(sin(radians(lat2 - lat1) / 2), 2)
    + cos(radians(lat1)) * cos(radians(lat2)) * power(sin(radians(lng2 - lng1) / 2), 2)
  ))))::double precision
$$;

-- Misma búsqueda que search_listings (0005) con distancia como criterio principal de orden.
-- SECURITY INVOKER: respeta la RLS de quien consulta. Devuelve ids, total, distancia y si es exacta.
create or replace function search_listings_near(
  p_q text default null,
  p_category int default null,
  p_municipality int default null,
  p_type text default null,
  p_lat double precision default null,
  p_lng double precision default null,
  p_limit int default 24,
  p_offset int default 0
) returns table (listing_id uuid, total bigint, distance_km double precision, exact boolean)
language plpgsql stable
set search_path = public, extensions
as $$
declare
  v_q text;
  v_txt text;
  v_tsq tsquery;
  v_limit int := least(greatest(coalesce(p_limit, 24), 1), 60);
  v_offset int := greatest(coalesce(p_offset, 0), 0);
begin
  if p_lat is null or p_lng is null or p_lat not between -90 and 90 or p_lng not between -180 and 180 then
    raise exception 'Coordenadas inválidas' using errcode = 'invalid_parameter_value';
  end if;

  v_q := trim(regexp_replace(immutable_unaccent(lower(left(coalesce(p_q, ''), 80))), '[^a-z0-9]+', ' ', 'g'));

  if v_q <> '' then
    select string_agg(t || ':*', ' & ')
      into v_txt
      from unnest((regexp_split_to_array(v_q, ' +'))[1:8]) as t;
    v_tsq := to_tsquery('spanish', v_txt);
  end if;

  return query
  select s.listing_id, (count(*) over ())::bigint, s.dist, s.is_exact
  from (
    select l.id as listing_id,
           l.created_at,
           (l.featured_until is not null and l.featured_until > now()) as feat,
           coalesce(ts_rank_cd(d.vec, v_tsq), 0)::float8
             + case when v_q = '' then 0 else word_similarity(v_q, d.short)::float8 end as score,
           case when g.glat is null or g.glng is null then null
                else haversine_km(p_lat, p_lng, g.glat, g.glng) end as dist,
           (b.has_physical_store and b.lat is not null and b.lng is not null) as is_exact
    from listings l
    join businesses b on b.id = l.business_id
    left join municipalities m on m.id = b.municipality_id
    left join categories c on c.id = l.category_id
    cross join lateral (
      select to_tsvector('spanish', immutable_unaccent(concat_ws(' ', l.title, l.description, b.name, c.name))) as vec,
             lower(immutable_unaccent(concat_ws(' ', l.title, b.name, c.name))) as short
    ) d
    cross join lateral (
      select case when b.has_physical_store and b.lat is not null and b.lng is not null then b.lat else m.lat end as glat,
             case when b.has_physical_store and b.lat is not null and b.lng is not null then b.lng else m.lng end as glng
    ) g
    where l.status = 'published'
      and (p_category is null or l.category_id = p_category)
      and (p_municipality is null or b.municipality_id = p_municipality)
      and (p_type is null or p_type = '' or l.type = p_type)
      and (
        v_q = ''
        or d.vec @@ v_tsq
        or (length(v_q) >= 3 and word_similarity(v_q, d.short) >= 0.45)
      )
  ) s
  order by s.dist asc nulls last, s.feat desc, s.score desc, s.created_at desc
  limit v_limit offset v_offset;
end $$;

revoke all on function search_listings_near(text, int, int, text, double precision, double precision, int, int) from public;
grant execute on function search_listings_near(text, int, int, text, double precision, double precision, int, int) to anon, authenticated;
