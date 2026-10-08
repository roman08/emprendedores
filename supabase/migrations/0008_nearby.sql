-- "Negocios cerca de mí": búsqueda por distancia sin PostGIS (caja envolvente + haversine exacta)

-- Índice parcial: solo negocios con local y pin en el mapa
create index if not exists businesses_geo_idx
  on businesses (lat, lng)
  where has_physical_store and lat is not null;

-- SECURITY INVOKER (por defecto): respeta la RLS de quien consulta (solo negocios activos y publicaciones publicadas).
-- Solo devuelve campos públicos: NUNCA el whatsapp.
create or replace function nearby_businesses(
  p_lat double precision,
  p_lng double precision,
  p_radius_km double precision default 25,
  p_category int default null,
  p_limit int default 40
) returns table (
  id uuid,
  name text,
  slug text,
  logo_url text,
  municipality_name text,
  address_text text,
  lat double precision,
  lng double precision,
  verified boolean,
  hours jsonb,
  distance_km double precision,
  published_count bigint,
  cover_url text
)
language plpgsql stable
set search_path = public
as $$
declare
  v_limit int := least(greatest(coalesce(p_limit, 40), 1), 60);
  v_dlat double precision;
  v_dlng double precision;
begin
  if p_lat is null or p_lng is null or p_lat not between -90 and 90 or p_lng not between -180 and 180 then
    raise exception 'Coordenadas inválidas' using errcode = 'invalid_parameter_value';
  end if;
  if p_radius_km is null or p_radius_km < 0.5 or p_radius_km > 100 then
    raise exception 'El radio debe estar entre 0.5 y 100 km' using errcode = 'invalid_parameter_value';
  end if;

  -- Caja envolvente: 1 grado de latitud ~ 111.32 km; la longitud se encoge con el coseno de la latitud
  v_dlat := p_radius_km / 111.32;
  v_dlng := p_radius_km / (111.32 * greatest(cos(radians(p_lat)), 0.01));

  return query
  select s.id, s.name, s.slug, s.logo_url, s.municipality_name, s.address_text, s.lat, s.lng,
         s.verified, s.hours, s.distance_km,
         (select count(*) from listings l where l.business_id = s.id and l.status = 'published')::bigint,
         (select li.url
            from listings l
            join listing_images li on li.listing_id = l.id
           where l.business_id = s.id and l.status = 'published'
           order by l.created_at desc, li.position asc
           limit 1)
  from (
    select b.id, b.name, b.slug, b.logo_url, m.name as municipality_name, b.address_text, b.lat, b.lng,
           b.verified, b.hours,
           (6371 * 2 * asin(least(1, sqrt(
              power(sin(radians(b.lat - p_lat) / 2), 2)
              + cos(radians(p_lat)) * cos(radians(b.lat)) * power(sin(radians(b.lng - p_lng) / 2), 2)
           ))))::double precision as distance_km
    from businesses b
    left join municipalities m on m.id = b.municipality_id
    where b.has_physical_store
      and b.lat is not null and b.lng is not null
      and b.status = 'active'
      and b.lat between p_lat - v_dlat and p_lat + v_dlat
      and b.lng between p_lng - v_dlng and p_lng + v_dlng
      and (p_category is null or exists (
            select 1 from listings l
             where l.business_id = b.id and l.status = 'published' and l.category_id = p_category))
  ) s
  where s.distance_km <= p_radius_km
  order by s.distance_km asc, s.name asc
  limit v_limit;
end $$;

revoke all on function nearby_businesses(double precision, double precision, double precision, int, int) from public;
grant execute on function nearby_businesses(double precision, double precision, double precision, int, int) to anon, authenticated;
