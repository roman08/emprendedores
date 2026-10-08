import { useId, useState, type SyntheticEvent } from 'react';
import { supabase } from '../../lib/supabase';
import { normalizeWhatsapp, safeMapsUrl } from '../../lib/format';
import { uploadImage } from '../../lib/upload';
import LocationPicker from './LocationPicker';
import HoursEditor from './HoursEditor';
import { parseHours, validateDay, DAYS, type Hours } from '../../lib/hours';

interface Props {
  userId: string;
  business: any | null;
  municipalities: { id: number; name: string; lat: number | null; lng: number | null }[];
  onSaved: (b: any) => void;
}

/** Selector de archivo con aspecto de botón y texto en español (el <input type=file> nativo depende del idioma del navegador). */
function FilePick({ id, label, file, onPick }: { id: string; label: string; file: File | null; onPick: (f: File | null) => void }) {
  return (
    <div>
      <label htmlFor={id} className="label">{label}</label>
      <div className="flex flex-wrap items-center gap-3">
        <label className="btn btn-ghost cursor-pointer focus-within:outline-2 focus-within:outline-offset-2 focus-within:outline-brand-600">
          Elegir imagen
          <input id={id} type="file" accept="image/*" className="sr-only" onChange={(e) => onPick(e.target.files?.[0] ?? null)} />
        </label>
        <span className="min-w-0 truncate text-sm text-muted">{file ? file.name : 'Ninguna imagen elegida'}</span>
      </div>
    </div>
  );
}

export default function BusinessForm({ userId, business, municipalities, onSaved }: Props) {
  const uid = useId();
  const [f, setF] = useState({
    name: business?.name ?? '',
    description: business?.description ?? '',
    whatsapp: business?.whatsapp ? business.whatsapp.replace(/^52/, '') : '',
    // Sin negocio previo, la lista (ordenada por nombre) empezaría en Balancán: se propone Cunduacán, la ciudad del piloto
    municipality_id: business?.municipality_id ?? (municipalities.find((m) => m.name === 'Cunduacán') ?? municipalities[0])?.id ?? null,
    instagram: business?.instagram ?? '',
    facebook: business?.facebook ?? '',
    website: business?.website ?? '',
    has_physical_store: business?.has_physical_store ?? false,
    address_text: business?.address_text ?? '',
    lat: business?.lat ?? (null as number | null),
    lng: business?.lng ?? (null as number | null),
    google_maps_url: business?.google_maps_url ?? '',
  });
  const [hours, setHours] = useState<Hours | null>(parseHours(business?.hours));
  const [logo, setLogo] = useState<File | null>(null);
  const [banner, setBanner] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [ok, setOk] = useState(false);
  const set = (k: string, v: unknown) => setF((p) => ({ ...p, [k]: v }));
  const mun = municipalities.find((m) => m.id === Number(f.municipality_id));
  const center: [number, number] = mun?.lat ? [mun.lat, mun.lng!] : [18.0667, -93.1667];

  async function submit(e: SyntheticEvent) {
    e.preventDefault();
    setError('');
    setOk(false);
    const wa = normalizeWhatsapp(f.whatsapp);
    if (!/^\d{12}$/.test(wa)) return setError('Escribe tu WhatsApp a 10 dígitos (sin +52).');
    if (hours) {
      const bad = DAYS.find((d) => validateDay(hours[d.key]));
      if (bad) return setError(`Revisa el horario del ${bad.label.toLowerCase()}: ${validateDay(hours[bad.key])}`);
    }
    if (f.has_physical_store && f.google_maps_url.trim() && !safeMapsUrl(f.google_maps_url.trim())) {
      return setError('El enlace de mapa debe ser de Google Maps (maps.app.goo.gl, google.com/maps), OpenStreetMap o Waze.');
    }
    setBusy(true);
    try {
      const row: Record<string, unknown> = {
        name: f.name.trim(),
        description: f.description.trim() || null,
        whatsapp: wa,
        municipality_id: Number(f.municipality_id),
        instagram: f.instagram.trim() || null,
        facebook: f.facebook.trim() || null,
        website: f.website.trim() || null,
        has_physical_store: f.has_physical_store,
        address_text: f.has_physical_store ? f.address_text.trim() || null : null,
        lat: f.has_physical_store ? f.lat : null,
        lng: f.has_physical_store ? f.lng : null,
        google_maps_url: f.has_physical_store ? f.google_maps_url.trim() || null : null,
        hours,
      };
      if (logo) row.logo_url = await uploadImage('business-media', userId, logo, 'logo');
      if (banner) row.banner_url = await uploadImage('business-media', userId, banner, 'banner');

      const q = business
        ? supabase.from('businesses').update(row).eq('id', business.id)
        : supabase.from('businesses').insert({ ...row, owner_id: userId });
      const { data, error } = await q.select('*').single();
      if (error) throw error;
      setLogo(null);
      setBanner(null);
      setOk(true);
      onSaved(data);
    } catch (err: any) {
      setError(err.message ?? 'No se pudo guardar.');
    }
    setBusy(false);
  }

  return (
    <form onSubmit={submit} className="space-y-6">
      <section className="card space-y-4 p-6">
        <h2 className="text-lg font-bold">Datos del negocio</h2>
        <div><label htmlFor={`${uid}-name`} className="label">Nombre del negocio *</label>
          <input id={`${uid}-name`} className="input" required maxLength={100} value={f.name} onChange={(e) => set('name', e.target.value)} /></div>
        <div><label htmlFor={`${uid}-desc`} className="label">Descripción</label>
          <textarea id={`${uid}-desc`} maxLength={2000} className="input min-h-28" value={f.description} onChange={(e) => set('description', e.target.value)}
            placeholder="¿Qué ofreces? ¿Qué te hace diferente?" /></div>
        <div className="grid gap-4 sm:grid-cols-2">
          <div><label htmlFor={`${uid}-wa`} className="label">WhatsApp (10 dígitos) *</label>
            <div className="flex"><span className="grid place-items-center rounded-l-xl border border-r-0 border-line bg-surface px-3 text-sm text-muted">+52</span>
              <input id={`${uid}-wa`} className="input !rounded-l-none" required inputMode="numeric" value={f.whatsapp} onChange={(e) => set('whatsapp', e.target.value)} placeholder="9141234567" /></div></div>
          <div><label htmlFor={`${uid}-mun`} className="label">Municipio *</label>
            <select id={`${uid}-mun`} className="input" value={f.municipality_id ?? ''} onChange={(e) => set('municipality_id', e.target.value)}>
              {municipalities.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
            </select></div>
        </div>
      </section>

      <section className="card space-y-4 p-6">
        <div><h2 className="text-lg font-bold">Imagen de marca <span className="text-sm font-normal text-muted">(opcional)</span></h2>
          <p className="text-sm text-muted">Si no tienes logo o banner, mostraremos uno con tus iniciales.</p></div>
        <div className="grid gap-4 sm:grid-cols-2">
          <div><FilePick id={`${uid}-logo`} label="Logo" file={logo} onPick={setLogo} />
            {business?.logo_url && !logo && <img src={business.logo_url} alt="" className="mt-2 h-16 w-16 rounded-xl object-cover" />}</div>
          <div><FilePick id={`${uid}-banner`} label="Banner" file={banner} onPick={setBanner} />
            {business?.banner_url && !banner && <img src={business.banner_url} alt="" className="mt-2 h-16 w-full rounded-xl object-cover" />}</div>
        </div>
      </section>

      <section className="card space-y-4 p-6">
        <h2 className="text-lg font-bold">Ubicación</h2>
        <label className="flex items-center gap-3 text-sm font-medium">
          <input type="checkbox" className="h-4 w-4 accent-brand-600" checked={f.has_physical_store} onChange={(e) => set('has_physical_store', e.target.checked)} />
          Tengo un local físico donde atiendo clientes
        </label>
        <p className="-mt-2 text-xs text-muted">Los negocios con local y pin en el mapa aparecen en "Cerca de mí".</p>
        {f.has_physical_store && (
          <>
            <LocationPicker lat={f.lat} lng={f.lng} address={f.address_text} center={center}
              onChange={(v) => setF((p) => ({ ...p, lat: v.lat, lng: v.lng }))} onAddress={(v) => set('address_text', v)} />
            <div><label htmlFor={`${uid}-maps`} className="label">Enlace de Google Maps <span className="font-normal text-muted">(opcional)</span></label>
              <input id={`${uid}-maps`} className="input" type="url" maxLength={500} value={f.google_maps_url} onChange={(e) => set('google_maps_url', e.target.value)} placeholder="https://maps.app.goo.gl/…" /></div>
          </>
        )}
      </section>

      <section className="card space-y-4 p-6">
        <h2 className="text-lg font-bold">Horarios de atención <span className="text-sm font-normal text-muted">(opcional)</span></h2>
        <HoursEditor value={hours} onChange={setHours} />
      </section>

      <section className="card space-y-4 p-6">
        <h2 className="text-lg font-bold">Redes<span className="text-sm font-normal text-muted">(opcional)</span></h2>
        <div className="grid gap-4 sm:grid-cols-3">
          <div><label htmlFor={`${uid}-ig`} className="label">Instagram</label><input id={`${uid}-ig`} maxLength={100} className="input" value={f.instagram} onChange={(e) => set('instagram', e.target.value)} placeholder="@minegocio" /></div>
          <div><label htmlFor={`${uid}-fb`} className="label">Facebook</label><input id={`${uid}-fb`} maxLength={300} className="input" type="url" value={f.facebook} onChange={(e) => set('facebook', e.target.value)} /></div>
          <div><label htmlFor={`${uid}-web`} className="label">Sitio web</label><input id={`${uid}-web`} maxLength={300} className="input" type="url" value={f.website} onChange={(e) => set('website', e.target.value)} /></div>
        </div>
      </section>

      {error && <p role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
      {ok && <p className="rounded-lg bg-brand-50 px-3 py-2 text-sm text-brand-700">Guardado ✔</p>}
      <button className="btn btn-primary" disabled={busy}>{busy ? 'Guardando…' : business ? 'Guardar cambios' : 'Crear mi negocio'}</button>
    </form>
  );
}
