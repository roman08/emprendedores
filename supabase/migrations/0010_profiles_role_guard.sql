-- SEGURIDAD: la política "perfil editar" (0001) permitía que cualquier usuario actualizara su propia fila
-- de profiles, incluida la columna role, y se volviera admin con un simple UPDATE desde el navegador.
-- Este trigger bloquea el cambio de role salvo para un admin real o para el SQL Editor / service role
-- (en esos casos auth.uid() es null, así que "update profiles set role='admin' ..." sigue funcionando).
create or replace function public.profiles_protect_role() returns trigger
language plpgsql
security invoker
set search_path = public
as $$
begin
  if new.role is distinct from old.role and auth.uid() is not null and not public.is_admin() then
    raise exception 'No puedes cambiar tu rol' using errcode = '42501';
  end if;
  if new.id is distinct from old.id then
    raise exception 'No puedes cambiar el id del perfil' using errcode = '42501';
  end if;
  return new;
end;
$$;

drop trigger if exists profiles_protect_role on public.profiles;
create trigger profiles_protect_role
  before update on public.profiles
  for each row execute function public.profiles_protect_role();
