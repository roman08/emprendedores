-- Carga el negocio "Moriah Studio" y sus 3 servicios en la cuenta de administrador.
-- NO es una migración: se ejecuta una sola vez, a mano, en el SQL Editor de Supabase.
--
-- ANTES DE EJECUTARLO
--   1) Cambia v_whatsapp (más abajo) por tu número de WhatsApp a 10 dígitos, sin +52 ni espacios.
--   2) Verifica que el sitio ya sirva las imágenes (si no, las fotos saldrán rotas):
--        https://porlaesquina.netlify.app/moriah/moriah-pagina-web.webp
--      Esas imágenes viven en public/moriah/ del repositorio: hay que haber hecho push y esperar el despliegue.
--   3) Si cambias de dominio, ajusta v_site o corrige las URLs después (ver el final del archivo).
--
-- Detalles: las fotos se enlazan desde el propio sitio (no desde Storage), así que no tienen miniatura
-- (las tarjetas usan la foto completa de ~50 KB) y borrar la publicación no intenta borrar archivos.
-- Si prefieres usar el flujo normal (Storage + miniaturas), sube las 3 imágenes desde el panel con docs/moriah-demo/textos.md.

do $$
declare
  v_whatsapp text := 'REEMPLAZA_POR_TU_NUMERO';          -- <-- 10 dígitos, p. ej. 9141234567
  v_site     text := 'https://porlaesquina.netlify.app';  -- <-- dirección del sitio, sin "/" final
  v_email    text := 'rmcentinela@gmail.com';             -- cuenta dueña del negocio (la de administrador)
  v_owner uuid;
  v_muni  int;
  v_cat   int;
  v_biz   uuid;
  v_list  uuid;
  r record;
begin
  if v_whatsapp !~ '^[0-9]{10}$' then
    raise exception 'Escribe tu WhatsApp a 10 dígitos en v_whatsapp (sin +52 ni espacios). No se creó nada.';
  end if;

  select id into v_owner from auth.users where email = v_email;
  if v_owner is null then
    raise exception 'No existe una cuenta con el correo %: no se creó nada.', v_email;
  end if;

  if exists (select 1 from businesses where owner_id = v_owner) then
    raise exception 'Esa cuenta ya tiene un negocio (cada cuenta puede tener uno). No se creó nada.';
  end if;

  select id into v_muni from municipalities where slug = 'cunduacan';
  select id into v_cat  from categories     where slug = 'servicios-profesionales';
  if v_muni is null or v_cat is null then
    raise exception 'Faltan datos base (municipio Cunduacán o categoría Servicios profesionales). Ejecuta las migraciones 0001 y 0015.';
  end if;

  insert into businesses (owner_id, name, slug, description, whatsapp, municipality_id, has_physical_store)
  values (
    v_owner, 'Moriah Studio', '',
    'Agencia digital de Cunduacán, Tabasco. Ayudamos a negocios locales a tener presencia en internet y a recibir más clientes por WhatsApp: páginas web, catálogos digitales con código QR y diseño de logotipos. Trabajamos de forma cercana, con propuestas a la medida de cada negocio.',
    '52' || v_whatsapp, v_muni, false
  )
  returning id into v_biz;

  -- Las publicaciones se crean como borrador, se les agrega la foto y luego se publican
  -- (la base exige al menos una foto para publicar).
  for r in
    select * from (values
      ('Página web para tu negocio',
       'Una página web sencilla y profesional para que tus clientes te encuentren en internet.

Incluye:
• Diseño adaptado a celular
• Tus productos o servicios, con fotos
• Botón directo a tu WhatsApp
• Ubicación en el mapa y horarios

Escríbenos por WhatsApp y te contamos cómo sería la tuya.',
       '/moriah/moriah-pagina-web.webp'),
      ('Catálogo digital con código QR',
       'Tu catálogo de productos en un solo enlace y un código QR, listo para compartir por WhatsApp o pegar en tu local.

Tus clientes ven tus productos con fotos y precios, y te escriben directo. Sin descargar nada.

Pide más información por WhatsApp.',
       '/moriah/moriah-catalogo-qr.webp'),
      ('Logotipo e identidad visual',
       'Diseñamos el logotipo de tu negocio y su identidad visual: colores y versiones para redes sociales y para imprimir.

Una imagen profesional para que tu negocio se vea y se recuerde.

Cuéntanos de tu negocio por WhatsApp y empezamos.',
       '/moriah/moriah-logotipo.webp')
    ) as t(title, description, img)
  loop
    insert into listings (business_id, type, title, slug, description, price, category_id, status)
    values (v_biz, 'service', r.title, '', r.description, null, v_cat, 'draft')
    returning id into v_list;

    insert into listing_images (listing_id, url, position) values (v_list, v_site || r.img, 0);

    update listings set status = 'published' where id = v_list;
  end loop;

  raise notice 'Listo: negocio Moriah Studio con 3 servicios publicados.';
end $$;

-- VERIFICACIÓN (solo lectura): debe mostrar 1 negocio y 3 publicaciones "published"
select b.name, b.slug, l.title, l.status, l.slug as slug_publicacion
from businesses b join listings l on l.business_id = b.id
where b.name = 'Moriah Studio'
order by l.created_at;

-- SI MÁS ADELANTE CAMBIAS DE DOMINIO, corrige las URLs de las fotos (ajusta los dos valores):
-- update listing_images
--    set url = replace(url, 'https://porlaesquina.netlify.app', 'https://tudominio.com')
--  where url like 'https://porlaesquina.netlify.app/moriah/%';
