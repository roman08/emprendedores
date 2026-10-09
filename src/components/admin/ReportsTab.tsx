import { useState } from 'react';
import { RowsSkeleton } from '../Loading';
import { supabase } from '../../lib/supabase';
import { Pagination, likeTerm, useConfirm, useDebounced, useNotice, usePaged } from './shared';

export default function ReportsTab() {
  const [showResolved, setShowResolved] = useState(false);
  const [q, setQ] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const { notify, node: noticeNode } = useNotice();
  const { confirm, node: dialogNode } = useConfirm();

  const term = likeTerm(useDebounced(q));
  const { items, total, page, setPage, loading, reload } = usePaged<any>((from, to) => {
    let query = supabase.from('reports')
      .select('id,reason,details,resolved,created_at,listing_id,business_id,review_id,reviews(id,rating,body,status),listings(id,title,slug,status,business_id,businesses(id,name,slug,status)),businesses(id,name,slug,status)', { count: 'exact' })
      .eq('resolved', showResolved);
    if (term) query = query.or(`reason.ilike.%${term}%,details.ilike.%${term}%`);
    return query.order('created_at', { ascending: false }).range(from, to);
  }, `${term}|${showResolved}`, (m) => notify(`No se pudieron cargar los reportes: ${m}`, 'error'));

  async function resolve(r: any) {
    setBusy(r.id);
    const { error } = await supabase.from('reports').update({ resolved: !r.resolved }).eq('id', r.id);
    setBusy(null);
    if (error) return notify(error.message, 'error');
    notify(r.resolved ? 'Reporte reabierto.' : 'Reporte marcado como resuelto.');
    reload();
  }

  async function unpublish(r: any) {
    if (!(await confirm({
      title: `¿Despublicar "${r.listings.title}"?`,
      body: 'La publicación dejará de ser visible hasta que su dueño la vuelva a publicar.',
      confirmLabel: 'Despublicar', danger: true,
    }))) return;
    setBusy(r.id);
    const { error } = await supabase.from('listings').update({ status: 'paused' }).eq('id', r.listings.id);
    setBusy(null);
    if (error) return notify(error.message, 'error');
    notify('Publicación despublicada.');
    reload();
  }

  async function suspend(r: any, b: any) {
    if (!(await confirm({
      title: `¿Suspender "${b.name}"?`,
      body: 'Su tienda y sus publicaciones dejarán de ser visibles.',
      confirmLabel: 'Suspender', danger: true,
    }))) return;
    setBusy(r.id);
    const { error } = await supabase.from('businesses').update({ status: 'suspended' }).eq('id', b.id);
    setBusy(null);
    if (error) return notify(error.message, 'error');
    notify(`"${b.name}" fue suspendido.`);
    reload();
  }

  return (
    <div>
      {noticeNode}
      {dialogNode}
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-lg font-bold">{showResolved ? 'Reportes resueltos' : 'Reportes pendientes'}</h2>
        <button className="btn btn-ghost" onClick={() => setShowResolved((v) => !v)}>
          {showResolved ? 'Ver pendientes' : 'Ver resueltos'}
        </button>
      </div>
      <div className="mb-4">
        <label className="sr-only" htmlFor="adm-r-q">Buscar reporte</label>
        <input id="adm-r-q" type="search" className="input" placeholder="Buscar por motivo o detalle…" value={q} onChange={(e) => setQ(e.target.value)} />
      </div>
      {loading ? <RowsSkeleton /> : items.length === 0 ? (
        <div className="card p-10 text-center text-muted">No hay reportes {showResolved ? 'resueltos' : 'pendientes'}{term ? ' con esa búsqueda' : ''}.</div>
      ) : (
        <ul className="space-y-3">
          {items.map((r) => {
            const l = r.listings;
            const b = l?.businesses ?? r.businesses;
            return (
              <li key={r.id} className="card p-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="text-sm font-semibold">{r.reason}</p>
                    <p className="text-xs text-muted">{new Date(r.created_at).toLocaleString('es-MX')}</p>
                  </div>
                  <button className="btn btn-primary" disabled={busy === r.id} onClick={() => resolve(r)}>
                    {r.resolved ? 'Reabrir' : 'Marcar resuelto'}
                  </button>
                </div>
                {r.details && <p className="mt-2 whitespace-pre-line rounded-xl bg-surface p-3 text-sm">{r.details}</p>}
                <p className="mt-3 text-sm">
                  <span className="text-muted">{r.review_id ? 'Reseña: ' : l ? 'Publicación: ' : 'Negocio: '}</span>
                  {r.review_id ? (
                    r.reviews
                      ? <a href={`/admin#reviews/${r.review_id}`} className="font-medium text-brand-700 hover:underline">Ver reseña de {r.reviews.rating} {r.reviews.rating === 1 ? 'estrella' : 'estrellas'}{r.reviews.status === 'hidden' ? ' (oculta)' : ''} para moderar</a>
                      : <span className="text-muted">contenido eliminado</span>
                  ) : l ? (
                    l.status === 'published'
                      ? <a href={`/p/${l.slug}`} target="_blank" rel="noopener" className="font-medium text-brand-700 hover:underline">{l.title}</a>
                      : <span className="font-medium">{l.title} <span className="text-xs text-muted">({l.status === 'paused' ? 'pausada' : 'no publicada'})</span></span>
                  ) : b ? (
                    <a href={`/n/${b.slug}`} target="_blank" rel="noopener" className="font-medium text-brand-700 hover:underline">{b.name}</a>
                  ) : <span className="text-muted">contenido eliminado</span>}
                  {l && b && <span className="text-muted"> · {b.name}</span>}
                </p>
                {(l?.status === 'published' || (b && b.status === 'active')) && (
                  <div className="mt-3 flex flex-wrap gap-2 border-t border-line pt-3">
                    {l?.status === 'published' && (
                      <button className="btn btn-ghost !px-3 !py-1.5" disabled={busy === r.id} onClick={() => unpublish(r)}>Despublicar publicación</button>
                    )}
                    {b && b.status === 'active' && (
                      <button className="btn btn-ghost !px-3 !py-1.5 !text-red-700" disabled={busy === r.id} onClick={() => suspend(r, b)}>Suspender negocio</button>
                    )}
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}
      <Pagination page={page} total={total} onPage={setPage} loading={loading} />
    </div>
  );
}
