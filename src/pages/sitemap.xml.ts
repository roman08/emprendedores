import type { APIRoute } from 'astro';
import { supabase } from '../lib/supabase';

// Un sitemap admite hasta 50,000 URLs; nos limitamos a 5,000 en un solo archivo.
// Si el catálogo la supera, hay que convertir esto en un índice de sitemaps (sitemap-index) paginado.
const MAX_URLS = 5000;
const BATCH = 1000; // tope por consulta de Supabase

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;');

interface Entry { path: string; lastmod?: string }

async function fetchAll(table: 'businesses' | 'listings', filters: Record<string, string>, limit: number): Promise<{ slug: string; updated_at: string }[]> {
  const rows: { slug: string; updated_at: string }[] = [];
  while (rows.length < limit) {
    let q = supabase.from(table).select('slug,updated_at');
    for (const [k, v] of Object.entries(filters)) q = q.eq(k, v);
    const { data, error } = await q.order('updated_at', { ascending: false }).range(rows.length, rows.length + BATCH - 1);
    if (error || !data || data.length === 0) break;
    rows.push(...data);
    if (data.length < BATCH) break;
  }
  return rows.slice(0, limit);
}

export const GET: APIRoute = async ({ site, url }) => {
  const origin = (site ?? url).origin;

  const [{ data: categories }, businesses, listings] = await Promise.all([
    supabase.from('categories').select('id,slug'),
    fetchAll('businesses', { status: 'active' }, MAX_URLS),
    fetchAll('listings', { status: 'published' }, MAX_URLS),
  ]);

  // Páginas de ubicación: solo con al menos 1 publicación (evita contenido delgado)
  const locationPaths: string[] = [];
  const { data: geoRows } = await supabase.from('municipalities').select('id,slug,states(slug)');
  const { data: pubRows } = await supabase
    .from('listings')
    .select('category_id,businesses!inner(municipality_id)')
    .eq('status', 'published')
    .limit(5000);
  const catSlug = new Map((categories ?? []).map((c: any) => [c.id, c.slug]));
  const munPairs = new Set<string>();
  for (const r of (pubRows ?? []) as any[]) if (r.businesses?.municipality_id != null) munPairs.add(`${r.businesses.municipality_id}:${r.category_id ?? ''}`);
  const seenStates = new Set<string>();
  for (const m of (geoRows ?? []) as any[]) {
    const st = m.states?.slug;
    if (!st) continue;
    const cats = [...munPairs].filter((k) => k.startsWith(`${m.id}:`)).map((k) => k.split(':')[1]);
    if (cats.length === 0) continue;
    if (!seenStates.has(st)) { seenStates.add(st); locationPaths.push(`/${st}`); }
    locationPaths.push(`/${st}/${m.slug}`);
    for (const c of new Set(cats)) if (c && catSlug.get(Number(c))) locationPaths.push(`/${st}/${m.slug}/${catSlug.get(Number(c))}`);
  }

  const entries: Entry[] = [
    { path: '/' },
    { path: '/explorar' },
    { path: '/como-funciona' },
    { path: '/cerca' },
    ...locationPaths.map((path) => ({ path })),
    ...(categories ?? []).map((c) => ({ path: `/explorar?categoria=${c.slug}` })),
    ...businesses.map((b) => ({ path: `/n/${b.slug}`, lastmod: b.updated_at })),
    ...listings.map((l) => ({ path: `/p/${l.slug}`, lastmod: l.updated_at })),
  ].slice(0, MAX_URLS);

  const xml =
    '<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n' +
    entries
      .map((e) => `  <url><loc>${esc(origin + e.path)}</loc>${e.lastmod ? `<lastmod>${new Date(e.lastmod).toISOString()}</lastmod>` : ''}</url>`)
      .join('\n') +
    '\n</urlset>\n';

  return new Response(xml, { headers: { 'Content-Type': 'application/xml; charset=utf-8', 'Cache-Control': 'public, max-age=3600' } });
};
