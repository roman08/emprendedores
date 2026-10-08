// /ir/whatsapp/<id-publicacion>  o  /ir/whatsapp/tienda?negocio=<id-negocio>
// Oculta el número del HTML, registra el clic en el servidor y redirige a wa.me.
import type { APIRoute } from 'astro';
import { supabase } from '../../../lib/supabase';
import { waLink } from '../../../lib/format';
import { BRAND } from '../../../lib/brand';
import { isUuid, notFound, redirect, trackClick } from '../_shared';

export const GET: APIRoute = async (ctx) => {
  const { id } = ctx.params;
  const negocio = ctx.url.searchParams.get('negocio');

  if (negocio !== null) {
    if (!isUuid(negocio)) return notFound();
    const { data: b } = await supabase
      .from('businesses').select('id,name,whatsapp').eq('id', negocio).eq('status', 'active').maybeSingle();
    if (!b) return notFound();
    await trackClick(ctx, 'whatsapp_click', { business: b.id });
    return redirect(waLink(b.whatsapp, `Hola ${b.name}, los encontré en ${BRAND.name}.`));
  }

  if (!isUuid(id)) return notFound();
  const { data: l } = await supabase
    .from('listings')
    .select('*, businesses(name,whatsapp,status)')  // * para tolerar columnas añadidas por otras migraciones (availability)
    .eq('id', id).eq('status', 'published').maybeSingle();
  const b = l?.businesses as unknown as { name: string; whatsapp: string; status: string } | null;
  if (!l || !b || b.status !== 'active') return notFound();
  await trackClick(ctx, 'whatsapp_click', { listing: l.id, business: l.business_id });
  const soldOut = (l as any).availability === 'sold_out';
  return redirect(waLink(b.whatsapp, soldOut
    ? `Hola ${b.name}, vi "${l.title}" en ${BRAND.name}. ¿Cuándo volverá a estar disponible?`
    : `Hola ${b.name}, vi "${l.title}" en ${BRAND.name} y me interesa. ¿Está disponible?`));
};
