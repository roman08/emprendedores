-- Horarios de atención por día:
-- {"mon": {"closed": false, "open": "09:00", "close": "18:00"}, ..., "sun": {"closed": true, ...}}
-- null = el negocio no publica horario.
alter table businesses
  add column if not exists hours jsonb
  check (hours is null or jsonb_typeof(hours) = 'object');
