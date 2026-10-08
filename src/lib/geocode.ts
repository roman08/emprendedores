// Geocodificador intercambiable: dirección -> coordenadas. Se elige con PUBLIC_GEOCODER
// ('nominatim' por defecto | 'maptiler' | 'geoapify'). Si falta la clave del proveedor elegido, cae a nominatim.
// Las claves PUBLIC_* viajan al navegador: restríngelas por dominio en el panel de cada proveedor.

export interface GeocodeResult { lat: number; lng: number; label?: string }
export interface GeocodeOptions { country?: string; signal?: AbortSignal; timeoutMs?: number }

type Provider = (q: string, country: string, signal: AbortSignal) => Promise<GeocodeResult | null>;

const num = (v: unknown): number | null => {
  const n = typeof v === 'string' || typeof v === 'number' ? Number(v) : NaN;
  return Number.isFinite(n) ? n : null;
};

async function getJson(url: string, signal: AbortSignal, headers?: Record<string, string>): Promise<unknown> {
  const res = await fetch(url, { signal, headers });
  if (!res.ok) throw new Error(`geocode ${res.status}`);
  return res.json();
}

const nominatim: Provider = async (q, country, signal) => {
  const url = `https://nominatim.openstreetmap.org/search?format=json&limit=1&countrycodes=${encodeURIComponent(country)}&q=${encodeURIComponent(q)}`;
  const data = (await getJson(url, signal, { 'Accept-Language': 'es' })) as Array<{ lat?: string; lon?: string; display_name?: string }>;
  const hit = Array.isArray(data) ? data[0] : undefined;
  const lat = num(hit?.lat), lng = num(hit?.lon);
  return lat === null || lng === null ? null : { lat, lng, label: hit?.display_name };
};

const maptiler = (key: string): Provider => async (q, country, signal) => {
  const url = `https://api.maptiler.com/geocoding/${encodeURIComponent(q)}.json?key=${encodeURIComponent(key)}&limit=1&country=${encodeURIComponent(country)}&language=es`;
  const data = (await getJson(url, signal)) as { features?: Array<{ center?: number[]; place_name?: string }> };
  const hit = data.features?.[0];
  const lng = num(hit?.center?.[0]), lat = num(hit?.center?.[1]); // GeoJSON: [lng, lat]
  return lat === null || lng === null ? null : { lat, lng, label: hit?.place_name };
};

const geoapify = (key: string): Provider => async (q, country, signal) => {
  const url = `https://api.geoapify.com/v1/geocode/search?text=${encodeURIComponent(q)}&filter=countrycode:${encodeURIComponent(country)}&lang=es&limit=1&format=json&apiKey=${encodeURIComponent(key)}`;
  const data = (await getJson(url, signal)) as { results?: Array<{ lat?: number; lon?: number; formatted?: string }> };
  const hit = data.results?.[0];
  const lat = num(hit?.lat), lng = num(hit?.lon);
  return lat === null || lng === null ? null : { lat, lng, label: hit?.formatted };
};

function pickProvider(): Provider {
  const name = (import.meta.env.PUBLIC_GEOCODER ?? 'nominatim').toLowerCase();
  const mt = import.meta.env.PUBLIC_MAPTILER_KEY;
  const ga = import.meta.env.PUBLIC_GEOAPIFY_KEY;
  if (name === 'maptiler' && mt) return maptiler(mt);
  if (name === 'geoapify' && ga) return geoapify(ga);
  return nominatim;
}

/** Devuelve la primera coincidencia o null si no hay. Lanza si hay timeout o error de red/proveedor. */
export async function geocode(q: string, { country = 'mx', signal, timeoutMs = 8000 }: GeocodeOptions = {}): Promise<GeocodeResult | null> {
  const text = q.trim();
  if (!text) return null;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  const onAbort = () => ctrl.abort();
  signal?.addEventListener('abort', onAbort);
  try {
    return await pickProvider()(text, country.toLowerCase(), ctrl.signal);
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', onAbort);
  }
}
