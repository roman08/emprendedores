-- Búsqueda de NEGOCIOS (no solo publicaciones): incluye negocios activos aunque todavía no tengan
-- publicaciones, para que aparezcan en /explorar, la portada y las páginas de municipio.
-- Busca en nombre y descripción del negocio, su municipio y las categorías de sus publicaciones.
-- Con p_lat/p_lng ordena por distancia (pin del local o, si no hay, centro del municipio, como 0012).
-- SECURITY INVOKER (por defecto): respeta la RLS de quien consulta. NUNCA devuelve el whatsapp.

create index if not exists businesses_fts_idx
  on businesses using gin (to_tsvector('spanish', immutable_unaccent(coalesce(name, '') || ' ' || coalesce(description, ''))));

create or replace function search_businesses(
  p_q text default null,
  p_category int default null,
  p_municipality int default null,
  p_lat double precision default null,
  p_lng double precision default null,
  p_limit int default 24,
  p_offset int default 0
) returns table (business_id uuid, total bigint, distance_km double precision, exact boolean, published_count bigint)
language plpgsql stable
set search_path = public, extensions
as $$
declare
  v_q text;
  v_txt text;
  v_tsq tsquery;
  v_near boolean := p_lat is not null and p_lng is not null;
  v_limit int := least(greatest(coalesce(p_limit, 24), 1), 60);
  v_offset int := greatest(coalesce(p_offset, 0), 0);
begin
  if v_near and (p_lat not between -90 and 90 or p_lng not between -180 and 180) then
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
  select s.id, (count(*) over ())::bigint, s.dist, s.is_exact, s.pub
  from (
    select b.id,
           b.created_at,
           b.verified,
           coalesce(ts_rank_cd(d.vec, v_tsq), 0)::float8
             + case when v_q = '' then 0 else word_similarity(v_q, d.short)::float8 end as score,
           case when not v_near or g.glat is null or g.glng is null then null
                else haversine_km(p_lat, p_lng, g.glat, g.glng) end as dist,
           (b.has_physical_store and b.lat is not null and b.lng is not null) as is_exact,
           k.pub
    from businesses b
    left join municipalities m on m.id = b.municipality_id
    cross join lateral (
      select count(*)::bigint as pub,
             string_agg(distinct c.name, ' ') as cats
        from listings l
        left join categories c on c.id = l.category_id
       where l.business_id = b.id and l.status = 'published'
    ) k
    cross join lateral (
      select to_tsvector('spanish', immutable_unaccent(concat_ws(' ', b.name, b.description, m.name, k.cats))) as vec,
             lower(immutable_unaccent(concat_ws(' ', b.name, k.cats))) as short
    ) d
    cross join lateral (
      select case when b.has_physical_store and b.lat is not null and b.lng is not null then b.lat else m.lat end as glat,
             case when b.has_physical_store and b.lat is not null and b.lng is not null then b.lng else m.lng end as glng
    ) g
    where b.status = 'active'
      and (p_municipality is null or b.municipality_id = p_municipality)
      and (p_category is null or exists (
            select 1 from listings l
             where l.business_id = b.id and l.status = 'published' and l.category_id = p_category))
      and (
        v_q = ''
        or d.vec @@ v_tsq
        or (length(v_q) >= 3 and word_similarity(v_q, d.short) >= 0.45)
      )
  ) s
  order by case when v_near then s.dist end asc nulls last,
           s.score desc, s.verified desc, (s.pub > 0) desc, s.created_at desc
  limit v_limit offset v_offset;
end $$;

revoke all on function search_businesses(text, int, int, double precision, double precision, int, int) from public;
grant execute on function search_businesses(text, int, int, double precision, double precision, int, int) to anon, authenticated;

-- "¿Quisiste decir…?" (0005) también conoce los nombres de negocios sin publicaciones
create or replace function suggest_search(p_q text) returns text
language plpgsql stable
set search_path = public, extensions
as $$
declare
  v_q text;
  v_words text[];
  v_tok text;
  v_best text;
  v_out text[] := '{}';
begin
  v_q := trim(regexp_replace(immutable_unaccent(lower(left(coalesce(p_q, ''), 80))), '[^a-z0-9]+', ' ', 'g'));
  if v_q = '' then return null; end if;

  select array_agg(distinct w)
    into v_words
    from (
      select unnest(regexp_split_to_array(
               lower(immutable_unaccent(concat_ws(' ', l.title, b.name, c.name))), '[^a-z0-9]+')) as w
      from listings l
      join businesses b on b.id = l.business_id
      left join categories c on c.id = l.category_id
      where l.status = 'published'
      union all
      select unnest(regexp_split_to_array(lower(immutable_unaccent(b.name)), '[^a-z0-9]+'))
      from businesses b
      where b.status = 'active'
    ) x
    where length(w) >= 3;

  if v_words is null then return null; end if;

  foreach v_tok in array (regexp_split_to_array(v_q, ' +'))[1:8] loop
    v_best := null;
    if length(v_tok) >= 4 and not (v_tok = any (v_words)) then
      select w into v_best
        from unnest(v_words) as w
        where similarity(w, v_tok) >= 0.4
        order by similarity(w, v_tok) desc, w
        limit 1;
    end if;
    v_out := v_out || coalesce(v_best, v_tok);
  end loop;

  if array_to_string(v_out, ' ') = v_q then return null; end if;
  return array_to_string(v_out, ' ');
end $$;

grant execute on function suggest_search(text) to anon, authenticated;
