-- Cuenta: eliminación de la cuenta propia.
-- Borra al usuario autenticado de auth.users; las FKs en cascada eliminan
-- perfil, negocio, publicaciones, etc. Los archivos de Storage los borra el cliente antes.
create or replace function public.delete_my_account()
returns void
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  uid uuid := auth.uid();
begin
  if uid is null then
    raise exception 'No autenticado' using errcode = '28000';
  end if;
  delete from auth.users where id = uid;
end;
$$;

revoke all on function public.delete_my_account() from public;
revoke execute on function public.delete_my_account() from anon;
grant execute on function public.delete_my_account() to authenticated;
