-- Canal de contacto: mensajes enviados desde /contacto (dudas, reportes, derechos ARCO, publicidad)
-- Idempotente: se puede ejecutar más de una vez.

create table if not exists contact_messages (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  email text not null,
  kind text not null default 'otro',
  message text not null,
  status text not null default 'new',
  user_id uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'contact_messages_name_len_chk') then
    alter table contact_messages add constraint contact_messages_name_len_chk
      check (char_length(btrim(name)) between 1 and 120);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'contact_messages_email_len_chk') then
    alter table contact_messages add constraint contact_messages_email_len_chk
      check (char_length(email) between 5 and 254 and position('@' in email) > 1);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'contact_messages_kind_chk') then
    alter table contact_messages add constraint contact_messages_kind_chk
      check (kind in ('duda', 'problema', 'arco', 'publicidad', 'otro'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'contact_messages_message_len_chk') then
    alter table contact_messages add constraint contact_messages_message_len_chk
      check (char_length(btrim(message)) between 1 and 2000);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'contact_messages_status_chk') then
    alter table contact_messages add constraint contact_messages_status_chk
      check (status in ('new', 'read', 'done'));
  end if;
end $$;

create index if not exists contact_messages_status_created_idx on contact_messages (status, created_at desc);
create index if not exists contact_messages_email_created_idx on contact_messages (lower(email), created_at desc);

-- Anti-spam: máximo 5 mensajes por hora por correo y 100 por hora en total (freno a quien rota correos).
-- Corre como definer porque la lectura de la tabla está reservada a admin por RLS.
create or replace function contact_messages_rate_limit() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_count int;
begin
  -- Fecha, estado y usuario los fija el servidor, nunca el cliente (si no, se podría
  -- enviar con created_at antiguo para que el límite de abajo no cuente el mensaje)
  new.created_at := now();
  new.status := 'new';
  new.user_id := auth.uid();

  select count(*) into v_count from contact_messages m
  where m.created_at > now() - interval '1 hour'
    and lower(m.email) = lower(new.email);
  if v_count >= 5 then
    raise exception 'Has enviado demasiados mensajes. Inténtalo de nuevo más tarde.'
      using errcode = 'check_violation';
  end if;
  select count(*) into v_count from contact_messages m
  where m.created_at > now() - interval '1 hour';
  if v_count >= 100 then
    raise exception 'Hay demasiados mensajes en este momento. Inténtalo de nuevo más tarde.'
      using errcode = 'check_violation';
  end if;
  return new;
end $$;

revoke all on function contact_messages_rate_limit() from public, anon, authenticated;

drop trigger if exists contact_messages_rate_limit_trg on contact_messages;
create trigger contact_messages_rate_limit_trg before insert on contact_messages
  for each row execute function contact_messages_rate_limit();

-- ---------- RLS ----------
alter table contact_messages enable row level security;

drop policy if exists "contacto crear" on contact_messages;
create policy "contacto crear" on contact_messages for insert to anon, authenticated
  with check (
    status = 'new'
    and char_length(btrim(name)) between 1 and 120
    and char_length(btrim(message)) between 1 and 2000
    and char_length(email) between 5 and 254
  );

drop policy if exists "contacto admin sel" on contact_messages;
create policy "contacto admin sel" on contact_messages for select to authenticated using (is_admin());

drop policy if exists "contacto admin upd" on contact_messages;
create policy "contacto admin upd" on contact_messages for update to authenticated
  using (is_admin()) with check (is_admin());

drop policy if exists "contacto admin del" on contact_messages;
create policy "contacto admin del" on contact_messages for delete to authenticated using (is_admin());

-- Grants explícitos: anon solo inserta los 4 campos del formulario; admin (authenticated + RLS) gestiona.
-- Sin privilegio sobre id/created_at/status/user_id, el cliente no puede falsearlos.
revoke all on contact_messages from public, anon, authenticated;
grant insert (name, email, kind, message) on contact_messages to anon, authenticated;
grant select, delete on contact_messages to authenticated;
grant update (status) on contact_messages to authenticated;
