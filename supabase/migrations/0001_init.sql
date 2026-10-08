-- Portal de emprendedores: esquema inicial
create extension if not exists unaccent;
create extension if not exists pg_trgm;

-- ---------- Geografía (país > estado > municipio) ----------
create table countries (
  id serial primary key,
  code text unique not null,            -- MX
  name text not null,
  phone_prefix text not null,           -- 52
  currency text not null,               -- MXN
  default_lat double precision,
  default_lng double precision
);

create table states (
  id serial primary key,
  country_id int not null references countries(id),
  name text not null,
  slug text not null,
  unique (country_id, slug)
);

create table municipalities (
  id serial primary key,
  state_id int not null references states(id),
  name text not null,
  slug text not null,
  lat double precision,
  lng double precision,
  unique (state_id, slug)
);

create table categories (
  id serial primary key,
  parent_id int references categories(id),
  name text not null,
  slug text unique not null,
  icon text,
  sort int not null default 0
);

-- ---------- Usuarios ----------
create table profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  full_name text,
  role text not null default 'entrepreneur' check (role in ('entrepreneur','admin')),
  created_at timestamptz not null default now()
);

create or replace function is_admin() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from profiles where id = auth.uid() and role = 'admin');
$$;

create or replace function handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into profiles (id, full_name)
  values (new.id, coalesce(new.raw_user_meta_data->>'full_name', ''));
  return new;
end $$;

create trigger on_auth_user_created after insert on auth.users
  for each row execute function handle_new_user();

-- ---------- Utilidades ----------
create or replace function slugify(txt text) returns text
language sql stable as $$
  select trim(both '-' from regexp_replace(lower(unaccent(coalesce(txt,''))), '[^a-z0-9]+', '-', 'g'));
$$;

create or replace function set_updated_at() returns trigger
language plpgsql as $$
begin new.updated_at = now(); return new; end $$;

-- ---------- Negocios (1 por usuario en el MVP) ----------
create table businesses (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null unique references auth.users(id) on delete cascade,
  name text not null,
  slug text unique not null,
  description text,
  whatsapp text not null check (whatsapp ~ '^[0-9]{10,15}$'),  -- con lada de país, solo dígitos
  logo_url text,                      -- opcional
  banner_url text,                    -- opcional
  instagram text,
  facebook text,
  website text,
  has_physical_store boolean not null default false,
  address_text text,                  -- opcional
  lat double precision check (lat between -90 and 90),
  lng double precision check (lng between -180 and 180),
  google_maps_url text,               -- opcional
  municipality_id int references municipalities(id),
  verified boolean not null default false,
  status text not null default 'active' check (status in ('active','suspended')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check ((lat is null) = (lng is null))
);
create index on businesses (municipality_id);
create index on businesses using gin (name gin_trgm_ops);

create or replace function businesses_before_write() returns trigger
language plpgsql as $$
begin
  if new.slug is null or new.slug = '' then
    new.slug := slugify(new.name) || '-' || substr(replace(gen_random_uuid()::text,'-',''),1,5);
  end if;
  return new;
end $$;
create trigger businesses_slug before insert on businesses
  for each row execute function businesses_before_write();
create trigger businesses_updated before update on businesses
  for each row execute function set_updated_at();

-- Evita que el dueño se auto-verifique o reactive una cuenta suspendida
create or replace function businesses_protect_admin_fields() returns trigger
language plpgsql as $$
begin
  if not is_admin() then
    new.verified := old.verified;
    new.status := old.status;
    new.owner_id := old.owner_id;
  end if;
  return new;
end $$;
create trigger businesses_protect before update on businesses
  for each row execute function businesses_protect_admin_fields();

-- ---------- Publicaciones ----------
create table listings (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references businesses(id) on delete cascade,
  type text not null check (type in ('product','service')),
  title text not null check (char_length(title) between 3 and 120),
  slug text unique not null,
  description text,
  price numeric(12,2) check (price >= 0),   -- null = "consultar"
  category_id int references categories(id),
  status text not null default 'draft' check (status in ('draft','published','paused')),
  featured_until timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index on listings (status, created_at desc);
create index on listings (category_id);
create index on listings (business_id);
create index on listings using gin (title gin_trgm_ops);

create table listing_images (
  id uuid primary key default gen_random_uuid(),
  listing_id uuid not null references listings(id) on delete cascade,
  url text not null,
  position int not null default 0
);
create index on listing_images (listing_id, position);

create or replace function listings_before_write() returns trigger
language plpgsql as $$
begin
  if tg_op = 'INSERT' and (new.slug is null or new.slug = '') then
    new.slug := slugify(new.title) || '-' || substr(replace(gen_random_uuid()::text,'-',''),1,5);
  end if;
  if tg_op = 'UPDATE' and not is_admin() then
    new.featured_until := old.featured_until;   -- solo admin destaca publicaciones
  end if;
  -- Fotos obligatorias: no se puede publicar sin al menos una imagen
  if new.status = 'published' and
     not exists (select 1 from listing_images where listing_id = new.id) then
    raise exception 'Una publicación necesita al menos una foto para publicarse'
      using errcode = 'check_violation';
  end if;
  return new;
end $$;
create trigger listings_slug_and_photos before insert or update on listings
  for each row execute function listings_before_write();
create trigger listings_updated before update on listings
  for each row execute function set_updated_at();

-- Una publicación activa no puede quedarse sin fotos
-- (si la publicación se está borrando en cascada, se permite)
create or replace function guard_last_image() returns trigger
language plpgsql as $$
begin
  if exists (select 1 from listings where id = old.listing_id and status = 'published')
     and not exists (select 1 from listing_images where listing_id = old.listing_id and id <> old.id) then
    raise exception 'No puedes borrar la última foto de una publicación activa';
  end if;
  return old;
end $$;
create trigger listing_images_guard before delete on listing_images
  for each row execute function guard_last_image();

-- ---------- Métricas y reportes ----------
create table events (
  id bigserial primary key,
  listing_id uuid references listings(id) on delete cascade,
  business_id uuid references businesses(id) on delete cascade,
  kind text not null check (kind in ('view','whatsapp_click','map_click')),
  created_at timestamptz not null default now()
);
create index on events (business_id, kind, created_at);
create index on events (listing_id, kind);

create or replace function track_event(p_listing uuid, p_business uuid, p_kind text)
returns void language sql security definer set search_path = public as $$
  insert into events (listing_id, business_id, kind)
  select p_listing,
         coalesce(p_business, (select business_id from listings where id = p_listing)),
         p_kind
  where p_kind in ('view','whatsapp_click','map_click');
$$;

create table reports (
  id uuid primary key default gen_random_uuid(),
  listing_id uuid references listings(id) on delete cascade,
  business_id uuid references businesses(id) on delete cascade,
  reason text not null,
  details text,
  resolved boolean not null default false,
  created_at timestamptz not null default now()
);

-- ---------- RLS ----------
alter table countries enable row level security;
alter table states enable row level security;
alter table municipalities enable row level security;
alter table categories enable row level security;
alter table profiles enable row level security;
alter table businesses enable row level security;
alter table listings enable row level security;
alter table listing_images enable row level security;
alter table events enable row level security;
alter table reports enable row level security;

create policy "pais lectura" on countries for select using (true);
create policy "estado lectura" on states for select using (true);
create policy "municipio lectura" on municipalities for select using (true);
create policy "cat lectura" on categories for select using (true);
create policy "estado admin" on states for all using (is_admin()) with check (is_admin());
create policy "municipio admin" on municipalities for all using (is_admin()) with check (is_admin());
create policy "cat admin" on categories for all using (is_admin()) with check (is_admin());

create policy "perfil propio" on profiles for select using (id = auth.uid() or is_admin());
create policy "perfil editar" on profiles for update using (id = auth.uid())
  with check (id = auth.uid());

create policy "negocio lectura" on businesses for select
  using (status = 'active' or owner_id = auth.uid() or is_admin());
create policy "negocio crear" on businesses for insert
  with check (owner_id = auth.uid() and verified = false and status = 'active');
create policy "negocio editar" on businesses for update
  using (owner_id = auth.uid() or is_admin())
  with check (owner_id = auth.uid() or is_admin());
create policy "negocio borrar" on businesses for delete
  using (owner_id = auth.uid() or is_admin());

create policy "pub lectura" on listings for select using (
  (status = 'published' and exists (select 1 from businesses b where b.id = business_id and b.status = 'active'))
  or exists (select 1 from businesses b where b.id = business_id and b.owner_id = auth.uid())
  or is_admin());
create policy "pub escribir" on listings for all
  using (exists (select 1 from businesses b where b.id = business_id and b.owner_id = auth.uid()) or is_admin())
  with check (exists (select 1 from businesses b where b.id = business_id and b.owner_id = auth.uid()) or is_admin());

-- La visibilidad de imágenes hereda la RLS de listings (subconsulta con las políticas del usuario)
create policy "img lectura" on listing_images for select
  using (exists (select 1 from listings l where l.id = listing_id));
create policy "img escribir" on listing_images for all
  using (exists (select 1 from listings l join businesses b on b.id = l.business_id
                 where l.id = listing_id and b.owner_id = auth.uid()) or is_admin())
  with check (exists (select 1 from listings l join businesses b on b.id = l.business_id
                 where l.id = listing_id and b.owner_id = auth.uid()) or is_admin());

create policy "eventos dueño" on events for select using (
  exists (select 1 from businesses b where b.id = business_id and b.owner_id = auth.uid()) or is_admin());
create policy "reporte crear" on reports for insert with check (true);
create policy "reporte admin" on reports for select using (is_admin());
create policy "reporte admin upd" on reports for update using (is_admin());

-- ---------- Storage ----------
insert into storage.buckets (id, name, public) values
  ('listing-images','listing-images', true),
  ('business-media','business-media', true)
on conflict do nothing;

create policy "media lectura" on storage.objects for select
  using (bucket_id in ('listing-images','business-media'));
create policy "media subir" on storage.objects for insert to authenticated
  with check (bucket_id in ('listing-images','business-media')
              and (storage.foldername(name))[1] = auth.uid()::text);
create policy "media borrar" on storage.objects for delete to authenticated
  using (bucket_id in ('listing-images','business-media')
         and (storage.foldername(name))[1] = auth.uid()::text);

-- ---------- Datos semilla ----------
insert into countries (code,name,phone_prefix,currency,default_lat,default_lng)
  values ('MX','México','52','MXN',18.0667,-93.1667);
insert into states (country_id,name,slug) select id,'Tabasco','tabasco' from countries where code='MX';
insert into municipalities (state_id,name,slug,lat,lng)
  select s.id, m.name, m.slug, m.lat, m.lng from states s,
  (values ('Cunduacán','cunduacan',18.0667,-93.1667),
          ('Villahermosa','villahermosa',17.9892,-92.9475),
          ('Comalcalco','comalcalco',18.2631,-93.2058),
          ('Jalpa de Méndez','jalpa-de-mendez',18.1769,-93.0600),
          ('Nacajuca','nacajuca',18.1700,-93.0158),
          ('Paraíso','paraiso',18.3972,-93.2128)) as m(name,slug,lat,lng)
  where s.slug='tabasco';

insert into categories (name,slug,icon,sort) values
  ('Comida y bebidas','comida-y-bebidas','utensils',1),
  ('Repostería y pasteles','reposteria-y-pasteles','cake',2),
  ('Ropa y calzado','ropa-y-calzado','shirt',3),
  ('Belleza y cuidado personal','belleza','sparkles',4),
  ('Hogar y decoración','hogar-y-decoracion','home',5),
  ('Artesanías','artesanias','palette',6),
  ('Tecnología y reparaciones','tecnologia','laptop',7),
  ('Servicios profesionales','servicios-profesionales','briefcase',8),
  ('Educación y clases','educacion','book',9),
  ('Eventos y fiestas','eventos','party',10),
  ('Construcción y oficios','oficios','wrench',11),
  ('Mascotas','mascotas','paw',12),
  ('Salud y bienestar','salud','heart',13),
  ('Campo y agro','campo','leaf',14),
  ('Otros','otros','grid',99);
