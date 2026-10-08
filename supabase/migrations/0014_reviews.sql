-- Reseñas de negocios con moderación
-- Idempotente: se puede ejecutar más de una vez.
--
-- Diseño de privacidad: la tabla NO es legible por el público (así no se expone user_id).
-- La lectura pública pasa por funciones SECURITY DEFINER que devuelven solo el nombre
-- visible del autor (primer nombre + inicial) y nunca user_id ni correo.

-- ---------- Tabla ----------
create table if not exists reviews (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references businesses(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  rating smallint not null check (rating between 1 and 5),
  body text check (body is null or char_length(body) <= 600),
  owner_reply text check (owner_reply is null or char_length(owner_reply) between 1 and 600),
  replied_at timestamptz,
  status text not null default 'visible' check (status in ('visible','hidden')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (business_id, user_id)
);

create index if not exists reviews_business_idx on reviews (business_id, status, created_at desc);
create index if not exists reviews_user_idx on reviews (user_id, created_at desc);
create index if not exists reviews_status_idx on reviews (status, created_at desc);

-- ---------- Triggers ----------
-- Alta: estado y respuesta fijados por el servidor, antigüedad mínima de cuenta y tope diario.
-- Corre como definer para leer auth.users y contar reseñas sin depender de la RLS.
create or replace function reviews_guard_insert() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid();
  v_created timestamptz;
  v_n int;
begin
  new.body := nullif(btrim(new.body), '');
  -- v_uid nulo = rol de servicio / consola SQL: sin restricciones de anti-spam
  if v_uid is not null then
    new.status := 'visible';
    new.owner_reply := null;
    new.replied_at := null;
    if new.user_id <> v_uid then
      raise exception 'No puedes reseñar en nombre de otra persona' using errcode = '42501';
    end if;
    if exists (select 1 from businesses b where b.id = new.business_id and b.owner_id = v_uid) then
      raise exception 'No puedes reseñar tu propio negocio' using errcode = 'check_violation';
    end if;
    select u.created_at into v_created from auth.users u where u.id = v_uid;
    if v_created is null or v_created > now() - interval '10 minutes' then
      raise exception 'Tu cuenta es muy reciente. Inténtalo de nuevo en unos minutos.' using errcode = 'check_violation';
    end if;
    select count(*) into v_n from reviews r
    where r.user_id = v_uid and r.created_at > now() - interval '1 day';
    if v_n >= 10 then
      raise exception 'Llegaste al máximo de 10 reseñas por día. Inténtalo mañana.' using errcode = 'check_violation';
    end if;
  end if;
  return new;
end $$;

drop trigger if exists reviews_guard_insert_trg on reviews;
create trigger reviews_guard_insert_trg before insert on reviews
  for each row execute function reviews_guard_insert();

-- Edición: cada rol solo puede tocar sus columnas.
--   admin  -> solo status (moderación)
--   autor  -> solo rating y body
--   dueño  -> solo owner_reply / replied_at, una única vez y sobre reseñas visibles
create or replace function reviews_guard_update() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid();
begin
  -- Nunca cambian
  new.business_id := old.business_id;
  new.user_id := old.user_id;
  new.created_at := old.created_at;
  new.body := nullif(btrim(new.body), '');

  if v_uid is null then
    return new;                                   -- rol de servicio / consola SQL
  elsif current_setting('app.review_reply', true) = '1'
        and exists (select 1 from businesses b where b.id = old.business_id and b.owner_id = v_uid) then
    -- Solo se llega aquí desde reply_to_review(), que marca la transacción
    new.rating := old.rating;
    new.body := old.body;
    new.status := old.status;
    if old.status <> 'visible' then
      raise exception 'Esta reseña no está disponible' using errcode = 'check_violation';
    end if;
    if old.owner_reply is not null then
      raise exception 'Ya respondiste esta reseña' using errcode = 'check_violation';
    end if;
    new.owner_reply := nullif(btrim(new.owner_reply), '');
    if new.owner_reply is null then
      raise exception 'Escribe una respuesta' using errcode = 'check_violation';
    end if;
    new.replied_at := now();
  elsif is_admin() then
    new.rating := old.rating;
    new.body := old.body;
    new.owner_reply := old.owner_reply;
    new.replied_at := old.replied_at;
  elsif old.user_id = v_uid then
    new.status := old.status;
    new.owner_reply := old.owner_reply;
    new.replied_at := old.replied_at;
  else
    raise exception 'No autorizado' using errcode = '42501';
  end if;
  return new;
end $$;

drop trigger if exists reviews_guard_update_trg on reviews;
create trigger reviews_guard_update_trg before update on reviews
  for each row execute function reviews_guard_update();

drop trigger if exists reviews_updated on reviews;
create trigger reviews_updated before update on reviews
  for each row execute function set_updated_at();

revoke all on function reviews_guard_insert() from public, anon, authenticated;
revoke all on function reviews_guard_update() from public, anon, authenticated;

-- ---------- RLS ----------
alter table reviews enable row level security;

-- La tabla solo la leen el autor (su propia reseña, aunque esté oculta) y el admin.
-- El público lee las visibles mediante las funciones de más abajo (sin user_id).
drop policy if exists "resena lectura" on reviews;
create policy "resena lectura" on reviews for select
  using (user_id = auth.uid() or is_admin());

drop policy if exists "resena crear" on reviews;
create policy "resena crear" on reviews for insert to authenticated
  with check (
    user_id = auth.uid()
    and exists (select 1 from businesses b
                where b.id = business_id and b.status = 'active' and b.owner_id <> auth.uid())
  );

drop policy if exists "resena editar autor" on reviews;
create policy "resena editar autor" on reviews for update to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());

drop policy if exists "resena editar admin" on reviews;
create policy "resena editar admin" on reviews for update to authenticated
  using (is_admin()) with check (is_admin());

drop policy if exists "resena borrar" on reviews;
create policy "resena borrar" on reviews for delete to authenticated
  using (user_id = auth.uid() or is_admin());

-- Privilegios de columna: defensa en profundidad además de los triggers
revoke all on reviews from anon, authenticated;
grant select, delete on reviews to authenticated;
grant insert (business_id, user_id, rating, body) on reviews to authenticated;
grant update (rating, body, status) on reviews to authenticated;

-- ---------- Funciones públicas ----------
-- Nombre visible: primer nombre + inicial del último apellido. Nunca el correo.
create or replace function review_author_name(p_full_name text) returns text
language sql immutable set search_path = public as $$
  with parts as (
    select regexp_split_to_array(btrim(regexp_replace(coalesce(p_full_name, ''), '\s+', ' ', 'g')), ' ') as a
  )
  select case
    when a[1] is null or a[1] = '' then 'Usuario'
    when array_length(a, 1) = 1 then left(a[1], 30)
    else left(a[1], 30) || ' ' || upper(left(a[array_length(a, 1)], 1)) || '.'
  end
  from parts;
$$;

-- Resumen: promedio, total y distribución por estrellas (solo reseñas visibles de negocios activos)
create or replace function business_rating_summary(p_business uuid)
returns table (avg_rating numeric, review_count int, star_1 int, star_2 int, star_3 int, star_4 int, star_5 int)
language sql stable security definer set search_path = public as $$
  select round(avg(r.rating)::numeric, 1),
         count(*)::int,
         (count(*) filter (where r.rating = 1))::int,
         (count(*) filter (where r.rating = 2))::int,
         (count(*) filter (where r.rating = 3))::int,
         (count(*) filter (where r.rating = 4))::int,
         (count(*) filter (where r.rating = 5))::int
  from reviews r
  join businesses b on b.id = r.business_id and b.status = 'active'
  where r.business_id = p_business and r.status = 'visible';
$$;

-- Lista pública paginada. No devuelve user_id. p_exclude_mine omite la reseña de quien consulta.
create or replace function list_business_reviews(
  p_business uuid,
  p_limit int default 10,
  p_offset int default 0,
  p_exclude_mine boolean default false
) returns table (
  id uuid, rating smallint, body text, owner_reply text, replied_at timestamptz,
  created_at timestamptz, author_name text
)
language sql stable security definer set search_path = public as $$
  select r.id, r.rating, r.body, r.owner_reply, r.replied_at, r.created_at,
         review_author_name(p.full_name)
  from reviews r
  join businesses b on b.id = r.business_id and b.status = 'active'
  left join profiles p on p.id = r.user_id
  where r.business_id = p_business
    and r.status = 'visible'
    and (not p_exclude_mine or r.user_id is distinct from auth.uid())
  order by r.created_at desc, r.id
  limit greatest(1, least(coalesce(p_limit, 10), 50))
  offset greatest(0, coalesce(p_offset, 0));
$$;

-- El dueño responde una sola vez a una reseña visible de su negocio
create or replace function reply_to_review(p_review uuid, p_reply text) returns void
language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid();
  v_reply text := nullif(btrim(coalesce(p_reply, '')), '');
begin
  if v_uid is null then
    raise exception 'Inicia sesión para responder' using errcode = '42501';
  end if;
  if v_reply is null or char_length(v_reply) > 600 then
    raise exception 'La respuesta debe tener entre 1 y 600 caracteres' using errcode = 'check_violation';
  end if;
  if not exists (
    select 1 from reviews r join businesses b on b.id = r.business_id
    where r.id = p_review and b.owner_id = v_uid and r.status = 'visible'
  ) then
    raise exception 'No puedes responder esta reseña' using errcode = '42501';
  end if;
  perform set_config('app.review_reply', '1', true);
  update reviews set owner_reply = v_reply where id = p_review;
  perform set_config('app.review_reply', '', true);
end $$;

revoke all on function review_author_name(text) from public, anon, authenticated;
revoke all on function business_rating_summary(uuid) from public, anon, authenticated;
revoke all on function list_business_reviews(uuid, int, int, boolean) from public, anon, authenticated;
revoke all on function reply_to_review(uuid, text) from public, anon, authenticated;
grant execute on function business_rating_summary(uuid) to anon, authenticated;
grant execute on function list_business_reviews(uuid, int, int, boolean) to anon, authenticated;
grant execute on function reply_to_review(uuid, text) to authenticated;
-- review_author_name la usan las funciones definer (propiedad de postgres), no hace falta exponerla

-- ---------- Reportes de reseñas ----------
alter table reports add column if not exists review_id uuid references reviews(id) on delete cascade;
create index if not exists reports_review_idx on reports (review_id) where review_id is not null;

alter table reports drop constraint if exists reports_target_chk;
alter table reports add constraint reports_target_chk
  check (listing_id is not null or business_id is not null or review_id is not null);

drop policy if exists "reporte crear" on reports;
create policy "reporte crear" on reports for insert
  with check (listing_id is not null or business_id is not null or review_id is not null);

-- Anti-abuso: máximo 5 reportes por hora sobre el mismo contenido (ahora incluye reseñas)
create or replace function reports_rate_limit() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $
declare
  v_count int;
begin
  -- Fijados por el servidor (0011): un created_at antiguo enviado por el cliente evadía el límite
  new.created_at := now();
  new.resolved := false;
  select count(*) into v_count from reports r
  where r.created_at > now() - interval '1 hour'
    and ((new.listing_id is not null and r.listing_id = new.listing_id)
      or (new.business_id is not null and r.business_id = new.business_id)
      or (new.review_id is not null and r.review_id = new.review_id));
  if v_count >= 5 then
    raise exception 'Demasiados reportes sobre este contenido. Inténtalo más tarde.'
      using errcode = 'check_violation';
  end if;
  return new;
end $$;
