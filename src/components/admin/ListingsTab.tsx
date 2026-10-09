import { useState } from 'react';
import { RowsSkeleton } from '../Loading';
import { supabase } from '../../lib/supabase';
import { formatPrice } from '../../lib/format';
import { Pagination, likeTerm, listingImagePaths, removePaths, useConfirm, useDebounced, useNotice, usePaged } from './shared';

const LABEL: Record<string, string> = { published: 'Publicado', draft: 'Borrador', paused: 'Pausado' };
const BADGE: Record<string, string> = { published: 'bg-brand-50 text-brand-700', draft: 'bg-amber-50 text-amber-700', paused: 'bg-surface text-muted' };

export default function ListingsTab() {
  const [status, setStatus] = useState('all');
  const [q, setQ] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const { notify, node: noticeNode } = useNotice();
  const { confirm, node: dialogNode } = useConfirm();

  const term = likeTerm(useDebounced(q));
  const { items, setItems, total, page, setPage, loading, reload } = usePaged<any>(async (from, to) => {
    let query = supabase.from('listings')
      .select('id,slug,title,price,status,featured_until,created_at,businesses(name,slug,owner_id)', { count: 'exact' });
    if (status !== 'all') query = query.eq('status', status);
    if (term) {
      // Coincide por título o por nombre del negocio (se resuelven primero los ids de negocios)
      const { data: bs } = await supabase.from('businesses').select('id').ilike('name', `%${term}%`).limit(100);
      const ids = (bs ?? []).map((b) => b.id as string);
      query = query.or(ids.length ? `title.ilike.%${term}%,business_id.in.(${ids.join(',')})` : `title.ilike.%${term}%`);
    }
    return query.order('created_at', { ascending: false }).range(from, to);
  }, `${term}|${status}`, (m) => notify(`No se pudieron cargar las publicaciones: ${m}`, 'error'));

  async function patch(l: any, fields: Record<string, unknown>, okMsg: string) {
    setBusy(l.id);
    const { error } = await supabase.from('listings').update(fields).eq('id', l.id);
    setBusy(null);
    if (error) return notify(error.message, 'error');
    setItems((prev) => prev.map((x) => (x.id === l.id ? { ...x, ...fields } : x)));
    notify(okMsg);
  }

  async function remove(l: any) {
    if (!(await confirm({
      title: `¿Borrar "${l.title}" definitivamente?`,
      body: 'Se eliminarán la publicación y sus fotos. Esta acción no se puede deshacer.',
      confirmLabel: 'Borrar', danger: true,
    }))) return;
    setBusy(l.id);
    try {
      // Reúne las rutas de las fotos antes de que el borrado en cascada elimine las filas
      const paths = await listingImagePaths([l.id], l.businesses?.owner_id ?? null);
      // Pausar primero para que el guard de "última foto" no bloquee el borrado en cascada
      if (l.status === 'published') {
        const { error } = await supabase.from('listings').update({ status: 'paused' }).eq('id', l.id);
        if (error) throw error;
      }
      const { error } = await supabase.from('listings').delete().eq('id', l.id);
      if (error) throw error;
      let files = 0, warn = '';
      try { files = await removePaths('listing-images', paths); }
      catch (e: any) { warn = ` Algunas fotos no se pudieron borrar (${e.message}); revísalas en "Archivos huérfanos".`; }
      notify(`Publicación borrada. Archivos eliminados de Storage: ${files}.${warn}`, warn ? 'error' : 'ok');
      reload();
    } catch (e: any) {
      notify(e.message ?? 'No se pudo borrar la publicación.', 'error');
    } finally { setBusy(null); }
  }

  const feature = (l: any, days: number | null) =>
    patch(l, { featured_until: days ? new Date(Date.now() + days * 864e5).toISOString() : null },
      days ? `"${l.title}" destacada por ${days} días.` : 'Se quitó el destacado.');
  const isFeatured = (l: any) => l.featured_until && new Date(l.featured_until) > new Date();

  return (
    <div>
      {noticeNode}
      {dialogNode}
      <div className="mb-4 flex flex-wrap gap-3">
        <div className="min-w-[200px] flex-1">
          <label className="sr-only" htmlFor="adm-l-q">Buscar publicación</label>
          <input id="adm-l-q" type="search" className="input" placeholder="Buscar por título o negocio…" value={q} onChange={(e) => setQ(e.target.value)} />
        </div>
        <div>
          <label className="sr-only" htmlFor="adm-l-s">Estado</label>
          <select id="adm-l-s" className="input" value={status} onChange={(e) => setStatus(e.target.value)}>
            <option value="all">Todos los estados</option>
            <option value="published">Publicadas</option><option value="paused">Pausadas</option><option value="draft">Borradores</option>
          </select>
        </div>
      </div>
      {loading ? <RowsSkeleton /> : items.length === 0 ? (
        <div className="card p-10 text-center text-muted">Sin resultados.</div>
      ) : (
        <ul className="space-y-3">
          {items.map((l) => (
            <li key={l.id} className="card p-4">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  {l.status === 'published'
                    ? <a href={`/p/${l.slug}`} target="_blank" rel="noopener" className="font-semibold hover:underline">{l.title}</a>
                    : <span className="font-semibold">{l.title}</span>}
                  <p className="text-xs text-muted">
                    {l.businesses?.name} · {formatPrice(l.price)}
                    <span className={`ml-2 rounded-full px-2 py-0.5 font-semibold ${BADGE[l.status]}`}>{LABEL[l.status]}</span>
                    {isFeatured(l) && <span className="ml-2 rounded-full bg-amber-50 px-2 py-0.5 font-semibold text-amber-700">
                      Destacada hasta {new Date(l.featured_until).toLocaleDateString('es-MX')}</span>}
                  </p>
                </div>
                <div className="flex flex-wrap gap-2">
                  {l.status === 'published' && (
                    <button className="btn btn-ghost" disabled={busy === l.id} onClick={() => patch(l, { status: 'paused' }, `"${l.title}" fue despublicada.`)}>Despublicar</button>
                  )}
                  <button className="btn btn-ghost !text-red-700" disabled={busy === l.id} onClick={() => remove(l)}>Borrar</button>
                </div>
              </div>
              <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-line pt-3 text-xs">
                <span className="text-muted">Destacar:</span>
                <button className="btn btn-ghost !px-3 !py-1.5" disabled={busy === l.id} onClick={() => feature(l, 7)}>7 días</button>
                <button className="btn btn-ghost !px-3 !py-1.5" disabled={busy === l.id} onClick={() => feature(l, 30)}>30 días</button>
                {isFeatured(l) && <button className="btn btn-ghost !px-3 !py-1.5" disabled={busy === l.id} onClick={() => feature(l, null)}>Quitar</button>}
              </div>
            </li>
          ))}
        </ul>
      )}
      <Pagination page={page} total={total} onPage={setPage} loading={loading} />
    </div>
  );
}
