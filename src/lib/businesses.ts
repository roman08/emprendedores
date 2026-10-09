// Negocios en listados (explorar, portada, municipios), incluidos los que aún no tienen publicaciones.
// Solo columnas públicas: NUNCA el whatsapp (lo lee /ir/whatsapp en el servidor).
import { supabase } from './supabase';

export const BUSINESS_SELECT = 'id,slug,name,description,logo_url,banner_url,verified,hours,has_physical_store,municipalities(name)';

export interface BusinessSearch {
  q?: string | null;
  category?: number | null;
  municipality?: number | null;
  lat?: number | null;
  lng?: number | null;
  limit: number;
  offset?: number;
}

// Búsqueda por RPC (search_businesses, migración 0017); si aún no existe, respaldo simple por nombre.
// published_count y la distancia llegan en cada negocio para la tarjeta.
export async function searchBusinesses(o: BusinessSearch): Promise<{ businesses: any[]; count: number; near: boolean }> {
  const near = o.lat != null && o.lng != null;
  const { data: hits, error } = await supabase.rpc('search_businesses', {
    p_q: o.q || null,
    p_category: o.category ?? null,
    p_municipality: o.municipality ?? null,
    p_lat: near ? o.lat : null,
    p_lng: near ? o.lng : null,
    p_limit: o.limit,
    p_offset: o.offset ?? 0,
  });

  if (!error) {
    const rows = (hits ?? []) as { business_id: string; total: number; distance_km: number | null; exact: boolean; published_count: number }[];
    const count = Number(rows[0]?.total ?? 0);
    if (rows.length === 0) return { businesses: [], count, near };
    const { data } = await supabase.from('businesses').select(BUSINESS_SELECT).in('id', rows.map((r) => r.business_id));
    const byId = new Map((data ?? []).map((b: any) => [b.id, b]));
    const businesses = rows
      .map((r) => {
        const b = byId.get(r.business_id);
        return b ? { ...b, published_count: Number(r.published_count ?? 0), distance_km: r.distance_km ?? null, distance_exact: r.exact ?? false } : null;
      })
      .filter(Boolean);
    return { businesses, count, near };
  }

  // Respaldo: sin filtro por categoría (los negocios no tienen una propia) ni distancia
  if (o.category) return { businesses: [], count: 0, near: false };
  let fb = supabase
    .from('businesses')
    .select(`${BUSINESS_SELECT},listings(count)`, { count: 'exact' })
    .eq('status', 'active')
    .order('verified', { ascending: false })
    .order('created_at', { ascending: false })
    .range(o.offset ?? 0, (o.offset ?? 0) + o.limit - 1);
  if (o.q) fb = fb.ilike('name', `%${o.q.replace(/[%,()\\]/g, ' ')}%`);
  if (o.municipality) fb = fb.eq('municipality_id', o.municipality);
  const res = await fb;
  return { businesses: (res.data ?? []).map(withCount), count: res.count ?? 0, near: false };
}

// Últimos negocios registrados (portada). La RLS ya limita el conteo a publicaciones publicadas.
export async function latestBusinesses(limit = 8): Promise<any[]> {
  const { data } = await supabase
    .from('businesses')
    .select(`${BUSINESS_SELECT},listings(count)`)
    .eq('status', 'active')
    .order('created_at', { ascending: false })
    .limit(limit);
  return (data ?? []).map(withCount);
}

function withCount(b: any) {
  const { listings, ...rest } = b;
  return { ...rest, published_count: Number(listings?.[0]?.count ?? 0) };
}
