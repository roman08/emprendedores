-- Búsqueda de calidad: español + sin acentos + tolerancia a errores de escritura
create extension if not exists unaccent;
create extension if not exists pg_trgm;

-- unaccent no es IMMUTABLE; este wrapper (con search_path fijo) permite usarlo en índices
create or replace function immutable_unaccent(txt text) returns text
language sql immutable parallel safe strict
set search_path = public, extensions
as $$ select unaccent($1) $$;

-- Índices sobre expresiones inmutables (acelera filtros por título/negocio y futuras consultas)
create index if not exists listings_title_unaccent_trgm_idx
  on listings using gin (immutable_unaccent(lower(title)) gin_trgm_ops);
create index if not exists listings_fts_idx
  on listings using gin (to_tsvector('spanish', immutable_unaccent(coalesce(title, '') || ' ' || coalesce(description, ''))));
create index if not exists businesses_name_unaccent_trgm_idx
  on businesses using gin (immutable_unaccent(lower(name)) gin_trgm_ops);

-- Devuelve los ids de publicaciones ordenados (destacadas, relevancia, recientes) y el total.
-- SECURITY INVOKER (por defecto): respeta la RLS de quien consulta.
create or replace function search_listings(
  p_q text default null,
  p_category int default null,
  p_municipality int default null,
  p_type text default null,
  p_limit int default 24,
  p_offset int default 0
) returns table (listing_id uuid, total bigint)
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
  -- Normaliza: minúsculas, sin acentos, solo letras/dígitos
  v_q := trim(regexp_replace(immutable_unaccent(lower(left(coalesce(p_q, ''), 80))), '[^a-z0-9]+', ' ', 'g'));

  if v_q <> '' then
    -- Cada palabra como prefijo (pastel:* & choco:*); los tokens ya son [a-z0-9]
    select string_agg(t || ':*', ' & ')
      into v_txt
      from unnest((regexp_split_to_array(v_q, ' +'))[1:8]) as t;
    v_tsq := to_tsquery('spanish', v_txt);
  end if;

  return query
  select s.listing_id, (count(*) over ())::bigint
  from (
    select l.id as listing_id,
           l.created_at,
           (l.featured_until is not null and l.featured_until > now()) as feat,
           coalesce(ts_rank_cd(d.vec, v_tsq), 0)::float8
             + case when v_q = '' then 0 else word_similarity(v_q, d.short)::float8 end as score
    from listings l
    join businesses b on b.id = l.business_id
    left join categories c on c.id = l.category_id
    cross join lateral (
      select to_tsvector('spanish', immutable_unaccent(concat_ws(' ', l.title, l.description, b.name, c.name))) as vec,
             lower(immutable_unaccent(concat_ws(' ', l.title, b.name, c.name))) as short
    ) d
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
  order by s.feat desc, s.score desc, s.created_at desc
  limit v_limit offset v_offset;
end $$;

-- "¿Quisiste decir…?": corrige cada palabra con la más parecida del catálogo visible.
-- Devuelve null si no hay corrección distinta de lo escrito.
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

grant execute on function search_listings(text, int, int, text, int, int) to anon, authenticated;
grant execute on function suggest_search(text) to anon, authenticated;
