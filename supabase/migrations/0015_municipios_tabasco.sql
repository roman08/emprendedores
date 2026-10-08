-- Los 17 municipios de Tabasco (0001 solo sembró 6).
-- Idempotente: inserta los que faltan y corrige nombre/coordenadas de los existentes por (state_id, slug).
-- Las coordenadas son el centro aproximado de la cabecera municipal; sirven de punto de partida en
-- "Cerca de mí" y de aproximación de distancia para negocios sin local con pin.
-- "Villahermosa" es la cabecera del municipio de Centro; se conserva el slug para no romper enlaces.

insert into municipalities (state_id, name, slug, lat, lng)
select s.id, m.name, m.slug, m.lat, m.lng
from states s,
(values
  ('Balancán',                  'balancan',        17.8036, -91.5272),
  ('Cárdenas',                  'cardenas',        18.0011, -93.3753),
  ('Centla (Frontera)',         'centla',          18.5336, -92.6475),
  ('Villahermosa (Centro)',     'villahermosa',    17.9892, -92.9475),
  ('Comalcalco',                'comalcalco',      18.2631, -93.2058),
  ('Cunduacán',                 'cunduacan',       18.0667, -93.1667),
  ('Emiliano Zapata',           'emiliano-zapata', 17.7425, -91.7678),
  ('Huimanguillo',              'huimanguillo',    17.8333, -93.3917),
  ('Jalapa',                    'jalapa',          17.7167, -92.8125),
  ('Jalpa de Méndez',           'jalpa-de-mendez', 18.1769, -93.0600),
  ('Jonuta',                    'jonuta',          18.0906, -92.1411),
  ('Macuspana',                 'macuspana',       17.7597, -92.5969),
  ('Nacajuca',                  'nacajuca',        18.1700, -93.0158),
  ('Paraíso',                   'paraiso',         18.3972, -93.2128),
  ('Tacotalpa',                 'tacotalpa',       17.5953, -92.8267),
  ('Teapa',                     'teapa',           17.5472, -92.9500),
  ('Tenosique',                 'tenosique',       17.4747, -91.4244)
) as m(name, slug, lat, lng)
where s.slug = 'tabasco'
on conflict (state_id, slug) do update
  set name = excluded.name,
      lat  = excluded.lat,
      lng  = excluded.lng;
