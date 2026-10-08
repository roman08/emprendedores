import { useEffect, useRef, useState } from 'react';
import 'leaflet/dist/leaflet.css';
import { supabase } from '../lib/supabase';
import { openStatus, parseHours } from '../lib/hours';
import { initials, safeHttpUrl } from '../lib/format';

interface Cat { id: number; name: string }
interface Muni { id: number; name: string; lat: number | null; lng: number | null }
interface Props { categories: Cat[]; municipalities: Muni[] }

interface Business {
  id: string; name: string; slug: string; logo_url: string | null; municipality_name: string | null;
  address_text: string | null; lat: number; lng: number; verified: boolean; hours: unknown;
  distance_km: number; published_count: number; cover_url: string | null;
}
interface Origin { lat: number; lng: number; label: string }

const RADIUS_OPTIONS = [1, 3, 5, 10, 25];

function fmtDistance(km: number): string {
  return km < 1 ? `a ${Math.max(10, Math.round((km * 1000) / 10) * 10)} m` : `a ${km.toFixed(1)} km`;
}

const directionsUrl = (b: { lat: number; lng: number }) =>
  `https://www.google.com/maps/dir/?api=1&destination=${b.lat},${b.lng}`;

export default function NearbyFinder({ categories, municipalities }: Props) {
  const [origin, setOrigin] = useState<Origin | null>(null);
  const [radius, setRadius] = useState(10);
  const [category, setCategory] = useState('');
  const [view, setView] = useState<'list' | 'map'>('list');
  const [locating, setLocating] = useState(false);
  const [geoError, setGeoError] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [results, setResults] = useState<Business[] | null>(null);
  const reqId = useRef(0);

  const munisWithCoords = municipalities.filter((m) => m.lat !== null && m.lng !== null);

  function useMyLocation() {
    setGeoError('');
    if (!('geolocation' in navigator)) {
      setGeoError('Tu navegador no permite obtener la ubicación. Elige tu municipio en la lista.');
      return;
    }
    setLocating(true);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setLocating(false);
        setOrigin({ lat: pos.coords.latitude, lng: pos.coords.longitude, label: 'tu ubicación' });
      },
      (err) => {
        setLocating(false);
        setGeoError(
          err.code === err.PERMISSION_DENIED
            ? 'No diste permiso para usar tu ubicación. Puedes activarlo en el navegador o elegir tu municipio abajo.'
            : err.code === err.TIMEOUT
              ? 'Tardó demasiado en obtener tu ubicación. Inténtalo de nuevo o elige tu municipio.'
              : 'No pudimos obtener tu ubicación. Elige tu municipio en la lista.',
        );
      },
      { enableHighAccuracy: false, timeout: 10000, maximumAge: 60000 },
    );
  }

  function pickMunicipality(id: string) {
    const m = munisWithCoords.find((x) => String(x.id) === id);
    if (!m || m.lat === null || m.lng === null) return;
    setGeoError('');
    setOrigin({ lat: m.lat, lng: m.lng, label: `el centro de ${m.name}` });
  }

  // Busca cada vez que cambia el origen, el radio o la categoría
  useEffect(() => {
    if (!origin) return;
    const id = ++reqId.current;
    setLoading(true);
    setError('');
    (async () => {
      const { data, error: err } = await supabase.rpc('nearby_businesses', {
        p_lat: origin.lat,
        p_lng: origin.lng,
        p_radius_km: radius,
        p_category: category ? Number(category) : null,
        p_limit: 40,
      });
      if (id !== reqId.current) return; // llegó una respuesta más vieja
      setLoading(false);
      if (err) {
        const missing = err.code === 'PGRST202' || err.code === '42883' || /function/i.test(err.message ?? '');
        setError(
          missing
            ? 'Esta función aún no está disponible. Inténtalo más tarde.'
            : 'No pudimos cargar los negocios. Revisa tu conexión e inténtalo de nuevo.',
        );
        setResults(null);
        return;
      }
      setResults((data ?? []) as Business[]);
    })();
  }, [origin, radius, category]);

  return (
    <div>
      <section className="card p-5">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
          <button type="button" className="btn btn-primary" onClick={useMyLocation} disabled={locating}>
            {locating ? 'Buscando tu ubicación…' : 'Usar mi ubicación'}
          </button>
          <span className="text-sm text-muted">o</span>
          <div className="flex-1">
            <label className="sr-only" htmlFor="nf-muni">Municipio</label>
            <select id="nf-muni" className="input" defaultValue="" onChange={(e) => pickMunicipality(e.target.value)}>
              <option value="" disabled>Elige tu municipio</option>
              {munisWithCoords.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
            </select>
          </div>
        </div>
        <p className="mt-3 text-xs text-muted">
          Tu ubicación no se guarda; solo se usa para buscar negocios cerca de ti.
        </p>
        {geoError && <p role="alert" className="mt-3 rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-800">{geoError}</p>}
      </section>

      {origin && (
        <>
          <div className="mt-5 grid gap-3 sm:grid-cols-3">
            <div>
              <label className="label" htmlFor="nf-radius">Distancia</label>
              <select id="nf-radius" className="input" value={radius} onChange={(e) => setRadius(Number(e.target.value))}>
                {RADIUS_OPTIONS.map((r) => <option key={r} value={r}>Hasta {r} km</option>)}
              </select>
            </div>
            <div>
              <label className="label" htmlFor="nf-cat">Categoría</label>
              <select id="nf-cat" className="input" value={category} onChange={(e) => setCategory(e.target.value)}>
                <option value="">Todas las categorías</option>
                {categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
            </div>
            <div>
              <span className="label">Vista</span>
              <div className="flex gap-2" role="group" aria-label="Vista de resultados">
                <button type="button" className={`btn flex-1 ${view === 'list' ? 'btn-primary' : 'btn-outline'}`}
                  aria-pressed={view === 'list'} onClick={() => setView('list')}>Lista</button>
                <button type="button" className={`btn flex-1 ${view === 'map' ? 'btn-primary' : 'btn-outline'}`}
                  aria-pressed={view === 'map'} onClick={() => setView('map')}>Mapa</button>
              </div>
            </div>
          </div>

          <p className="mt-5 text-sm text-muted" aria-live="polite">
            {loading
              ? 'Buscando negocios…'
              : results
                ? `${results.length === 1 ? '1 negocio' : `${results.length} negocios`} cerca de ${origin.label}`
                : ''}
          </p>

          {error && (
            <div role="alert" className="card mt-3 p-6 text-center">
              <p className="font-semibold">{error}</p>
              <button type="button" className="btn btn-outline mt-3" onClick={() => setOrigin({ ...origin })}>Reintentar</button>
            </div>
          )}

          {!error && results && results.length === 0 && !loading && (
            <div className="card mt-3 p-8 text-center">
              <p className="font-semibold">No encontramos negocios en este radio.</p>
              <p className="mt-2 text-sm text-muted">Prueba con una distancia mayor o sin filtro de categoría.</p>
              {radius < 25 && (
                <button type="button" className="btn btn-outline mt-4" onClick={() => setRadius(25)}>Ampliar a 25 km</button>
              )}
            </div>
          )}

          {!error && results && results.length > 0 && view === 'list' && (
            <ul className="mt-3 grid gap-4 sm:grid-cols-2">{results.map((b) => <ResultCard key={b.id} b={b} />)}</ul>
          )}
          {/* El mapa se muestra aunque no haya resultados, para ver al menos tu punto de partida */}
          {!error && results && view === 'map' && <ResultsMap origin={origin} results={results} />}
        </>
      )}

      {!origin && !geoError && (
        <p className="mt-6 text-center text-sm text-muted">Elige cómo buscar para ver los negocios con local cerca de ti.</p>
      )}
    </div>
  );
}

function ResultCard({ b }: { b: Business }) {
  const status = openStatus(parseHours(b.hours));
  const img = safeHttpUrl(b.logo_url) ?? safeHttpUrl(b.cover_url);
  return (
    <li className="card flex flex-col gap-3 p-4">
      <div className="flex items-start gap-3">
        {img ? (
          <img src={img} alt="" loading="lazy" className="h-14 w-14 shrink-0 rounded-xl border border-line object-cover" />
        ) : (
          <span aria-hidden="true" className="grid h-14 w-14 shrink-0 place-items-center rounded-xl bg-brand-50 text-lg font-bold text-brand-700">{initials(b.name)}</span>
        )}
        <div className="min-w-0 flex-1">
          <p className="truncate font-semibold">
            {b.name}
            {b.verified && <span className="ml-2 rounded-full bg-brand-50 px-2 py-0.5 text-xs text-brand-700">Verificado</span>}
          </p>
          <p className="truncate text-xs text-muted">
            {b.municipality_name ?? 'Tabasco'} · {fmtDistance(b.distance_km)}
          </p>
          {b.address_text && <p className="truncate text-xs text-muted">{b.address_text}</p>}
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        {status && (
          <span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${status.open ? 'bg-green-100 text-green-800' : 'bg-gray-100 text-gray-700'}`}>
            {status.open ? 'Abierto' : 'Cerrado'}
          </span>
        )}
        <span className="text-xs text-muted">
          {b.published_count === 1 ? '1 publicación' : `${b.published_count} publicaciones`}
        </span>
      </div>
      <div className="mt-auto flex gap-2">
        <a className="btn btn-primary flex-1" href={`/n/${encodeURIComponent(b.slug)}`}>Ver tienda</a>
        <a className="btn btn-outline flex-1" href={directionsUrl(b)} target="_blank" rel="noopener noreferrer">Cómo llegar</a>
      </div>
    </li>
  );
}

function ResultsMap({ origin, results }: { origin: Origin; results: Business[] }) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let map: import('leaflet').Map | undefined;
    let cancelled = false;
    (async () => {
      const L = (await import('leaflet')).default;
      if (cancelled || !ref.current) return;
      // Leaflet exige centro y zoom antes de agregar capas; sin esto lanza "Set map center and zoom first" y el mapa queda vacío
      map = L.map(ref.current, { scrollWheelZoom: false }).setView([origin.lat, origin.lng], 13);
      L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
        attribution: '&copy; OpenStreetMap',
        maxZoom: 19,
      }).addTo(map);

      const points: [number, number][] = [[origin.lat, origin.lng]];
      L.circleMarker([origin.lat, origin.lng], { radius: 9, color: '#1d4ed8', fillColor: '#3b82f6', fillOpacity: 0.9 })
        .addTo(map)
        .bindPopup(origin.label === 'tu ubicación' ? 'Tu ubicación' : `Centro de ${origin.label.replace('el centro de ', '')}`);

      for (const b of results) {
        points.push([b.lat, b.lng]);
        // Popup armado con nodos DOM (textContent) para no interpretar HTML de usuarios
        const box = document.createElement('div');
        const title = document.createElement('strong');
        title.textContent = b.name;
        const dist = document.createElement('div');
        dist.textContent = fmtDistance(b.distance_km);
        const link = document.createElement('a');
        link.href = `/n/${encodeURIComponent(b.slug)}`;
        link.textContent = 'Ver tienda';
        box.append(title, dist, link);
        L.circleMarker([b.lat, b.lng], { radius: 10, color: '#0e8571', fillColor: '#14a38b', fillOpacity: 0.9 })
          .addTo(map)
          .bindPopup(box);
      }
      map.invalidateSize();
      if (points.length > 1) map.fitBounds(L.latLngBounds(points), { padding: [30, 30], maxZoom: 16 });
    })().catch(() => { /* si Leaflet falla, queda el contenedor vacío en vez de romper la página */ });
    return () => { cancelled = true; map?.remove(); };
  }, [origin, results]);

  return <div ref={ref} style={{ height: 420 }} className="z-0 mt-3 w-full overflow-hidden rounded-2xl border border-line" />;
}
