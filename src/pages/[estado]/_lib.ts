// Utilidades de las páginas de ubicación (/estado, /estado/municipio, /estado/municipio/categoria).
// El guion bajo evita que Astro lo trate como ruta.
import { supabase } from '../../lib/supabase';

export const PAGE_SIZE = 24;
const SELECT = 'id,slug,title,price,type,availability,listing_images(url,position),businesses!inner(name,municipality_id,municipalities(name))';

export interface Geo {
  state: { id: number; name: string; slug: string };
  municipalities: { id: number; name: string; slug: string; state_id: number }[];
  mun?: { id: number; name: string; slug: string; state_id: number };
}

// Devuelve null si el estado (o el municipio) no existe
export async function loadGeo(estado: string | undefined, municipio?: string): Promise<Geo | null> {
  if (!estado || !/^[a-z0-9-]{1,80}$/.test(estado)) return null;
  if (municipio !== undefined && !/^[a-z0-9-]{1,80}$/.test(municipio)) return null;
  const { data: state } = await supabase.from('states').select('id,name,slug').eq('slug', estado).maybeSingle();
  if (!state) return null;
  const { data: muns } = await supabase.from('municipalities').select('id,name,slug,state_id').eq('state_id', state.id).order('name');
  const municipalities = muns ?? [];
  if (municipio === undefined) return { state, municipalities };
  const mun = municipalities.find((m) => m.slug === municipio);
  return mun ? { state, municipalities, mun } : null;
}

export interface Counts {
  listings: number;
  businesses: number;
  byCategory: Map<number, number>;
  byMunicipality: Map<number, number>;
}

// Conteos de publicaciones publicadas en los municipios dados (una sola consulta, tope 5,000 filas)
export async function loadCounts(munIds: number[]): Promise<Counts> {
  const out: Counts = { listings: 0, businesses: 0, byCategory: new Map(), byMunicipality: new Map() };
  if (munIds.length === 0) return out;
  const { data } = await supabase
    .from('listings')
    .select('category_id,business_id,businesses!inner(municipality_id)')
    .eq('status', 'published')
    .in('businesses.municipality_id', munIds)
    .limit(5000);
  const biz = new Set<string>();
  for (const r of (data ?? []) as any[]) {
    out.listings++;
    biz.add(r.business_id);
    if (r.category_id != null) out.byCategory.set(r.category_id, (out.byCategory.get(r.category_id) ?? 0) + 1);
    const m = r.businesses?.municipality_id;
    if (m != null) out.byMunicipality.set(m, (out.byMunicipality.get(m) ?? 0) + 1);
  }
  out.businesses = biz.size;
  return out;
}

// Publicaciones de un municipio (y categoría opcional). RPC con respaldo por consulta directa.
export async function loadListings(munId: number, catId: number | null, page: number) {
  const { data: hits, error } = await supabase.rpc('search_listings', {
    p_q: null,
    p_category: catId,
    p_municipality: munId,
    p_type: null,
    p_limit: PAGE_SIZE,
    p_offset: (page - 1) * PAGE_SIZE,
  });
  if (!error) {
    const rows = (hits ?? []) as { listing_id: string; total: number }[];
    const count = Number(rows[0]?.total ?? 0);
    let listings: any[] = [];
    if (rows.length) {
      const { data } = await supabase.from('listings').select(SELECT).in('id', rows.map((r) => r.listing_id));
      const byId = new Map((data ?? []).map((l: any) => [l.id, l]));
      listings = rows.map((r) => byId.get(r.listing_id)).filter(Boolean);
    }
    return { listings, count };
  }
  let fb = supabase
    .from('listings')
    .select(SELECT, { count: 'exact' })
    .eq('status', 'published')
    .eq('businesses.municipality_id', munId)
    .order('featured_until', { ascending: false, nullsFirst: false })
    .order('created_at', { ascending: false })
    .range((page - 1) * PAGE_SIZE, page * PAGE_SIZE - 1);
  if (catId) fb = fb.eq('category_id', catId);
  const res = await fb;
  return { listings: (res.data ?? []) as any[], count: res.count ?? 0 };
}

// Últimas publicaciones de varios municipios (página de estado)
export async function loadLatest(munIds: number[], limit = 12) {
  if (munIds.length === 0) return [];
  const { data } = await supabase
    .from('listings')
    .select(SELECT)
    .eq('status', 'published')
    .in('businesses.municipality_id', munIds)
    .order('featured_until', { ascending: false, nullsFirst: false })
    .order('created_at', { ascending: false })
    .limit(limit);
  return (data ?? []) as any[];
}

export function parsePage(raw: string | null): number {
  const n = Math.floor(Number(raw ?? 1));
  return Number.isFinite(n) ? Math.min(Math.max(1, n), 500) : 1;
}
