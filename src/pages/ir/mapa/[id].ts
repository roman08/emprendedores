// /ir/mapa/<id-publicacion>  o  /ir/mapa/tienda?negocio=<id-negocio>
// Registra el clic en "Cómo llegar" en el servidor y redirige al mapa del negocio.
import type { APIRoute } from 'astro';
import { supabase } from '../../../lib/supabase';
import { mapsLink } from '../../../lib/format';
import { isUuid, notFound, redirect, trackClick } from '../_shared';

// Solo se redirige a http(s): descarta esquemas raros guardados en google_maps_url
const isHttp = (u: string | null | undefined): u is string => !!u && /^https?:\/\//i.test(u);

export const GET: APIRoute = async (ctx) => {
  const { id } = ctx.params;
  const negocio = ctx.url.searchParams.get('negocio');
  const cols = 'id,lat,lng,google_maps_url,status';

  if (negocio !== null) {
    if (!isUuid(negocio)) return notFound();
    const { data: b } = await supabase.from('businesses').select(cols).eq('id', negocio).eq('status', 'active').maybeSingle();
    const url = b && mapsLink(b);
    if (!b || !isHttp(url)) return notFound();
    await trackClick(ctx, 'map_click', { business: b.id });
    return redirect(url);
  }

  if (!isUuid(id)) return notFound();
  const { data: l } = await supabase
    .from('listings')
    .select(`id,business_id,businesses(${cols})`)
    .eq('id', id).eq('status', 'published').maybeSingle();
  const b = l?.businesses as unknown as { lat: number | null; lng: number | null; google_maps_url: string | null; status: string } | null;
  const url = b && b.status === 'active' ? mapsLink(b) : null;
  if (!l || !isHttp(url)) return notFound();
  await trackClick(ctx, 'map_click', { listing: l.id, business: l.business_id });
  return redirect(url);
};
