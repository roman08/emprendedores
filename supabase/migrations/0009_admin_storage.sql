-- Endurecimiento del panel de admin: el admin puede listar y borrar objetos de Storage
-- (las políticas de 0001 solo permiten borrar en la carpeta del propio usuario).

-- ---------- Políticas de Storage para admin ----------
-- Las políticas se combinan con OR: no alteran "media lectura" / "media borrar" / "media subir".
drop policy if exists "media admin lectura" on storage.objects;
create policy "media admin lectura" on storage.objects for select to authenticated
  using (bucket_id in ('listing-images','business-media') and is_admin());

drop policy if exists "media admin borrar" on storage.objects;
create policy "media admin borrar" on storage.objects for delete to authenticated
  using (bucket_id in ('listing-images','business-media') and is_admin());

-- ---------- Huérfanos con tamaño (solo admin) ----------
-- Misma lógica que orphan_storage_objects() (0006) pero añade el tamaño en bytes.
-- Se limita a 500 filas por llamada; la UI muestra el total real aparte.
create or replace function admin_orphan_objects()
returns table (bucket_id text, name text, size bigint, created_at timestamptz)
language plpgsql stable security definer set search_path = public, storage as $$
begin
  if not is_admin() then
    raise exception 'Solo administradores' using errcode = 'insufficient_privilege';
  end if;
  return query
    select o.bucket_id::text, o.name::text,
           coalesce((o.metadata->>'size')::bigint, 0), o.created_at
    from orphan_storage_objects() x
    join storage.objects o on o.bucket_id = x.bucket_id and o.name = x.name
    order by o.created_at
    limit 500;
end $$;

revoke all on function admin_orphan_objects() from public, anon;
grant execute on function admin_orphan_objects() to authenticated;
