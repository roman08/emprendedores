import { useEffect, useState } from 'react';
import { supabase } from '../../lib/supabase';
import { Pagination, useConfirm, useNotice, usePaged } from './shared';

type Status = 'all' | 'visible' | 'hidden';

/** focusId: reseña a mostrar sola (llega desde un reporte); null = lista normal. */
export default function ReviewsTab({ focusId = null, onClearFocus }: { focusId?: string | null; onClearFocus?: () => void }) {
  const [status, setStatus] = useState<Status>('all');
  const [rating, setRating] = useState('all');
  const [busy, setBusy] = useState<string | null>(null);
  const [names, setNames] = useState<Record<string, string>>({});
  const { notify, node: noticeNode } = useNotice();
  const { confirm, node: dialogNode } = useConfirm();

  const { items, total, page, setPage, loading, reload } = usePaged<any>((from, to) => {
    let query = supabase.from('reviews')
      .select('id,user_id,rating,body,owner_reply,status,created_at,business_id,businesses(name,slug)', { count: 'exact' });
    if (focusId) query = query.eq('id', focusId);
    else {
      if (status !== 'all') query = query.eq('status', status);
      if (rating !== 'all') query = query.eq('rating', Number(rating));
    }
    return query.order('created_at', { ascending: false }).range(from, to);
  }, `${focusId ?? ''}|${status}|${rating}`, (m) => notify(`No se pudieron cargar las reseñas: ${m}`, 'error'));

  // Nombre del autor (solo el nombre del perfil, nunca el correo)
  useEffect(() => {
    const ids = [...new Set(items.map((r) => r.user_id as string))].filter((id) => !(id in names));
    if (!ids.length) return;
    supabase.from('profiles').select('id,full_name').in('id', ids).then(({ data }) => {
      setNames((prev) => {
        const next = { ...prev };
        for (const id of ids) next[id] = '';
        for (const p of data ?? []) next[p.id] = (p.full_name ?? '').trim();
        return next;
      });
    });
  }, [items, names]);

  async function toggle(r: any) {
    const next = r.status === 'visible' ? 'hidden' : 'visible';
    setBusy(r.id);
    const { error } = await supabase.from('reviews').update({ status: next }).eq('id', r.id);
    setBusy(null);
    if (error) return notify(error.message, 'error');
    notify(next === 'hidden' ? 'Reseña ocultada.' : 'Reseña visible de nuevo.');
    reload();
  }

  async function remove(r: any) {
    if (!(await confirm({
      title: '¿Eliminar esta reseña?',
      body: 'Se borra de forma permanente, junto con los reportes que tenga. Para quitarla solo de la vista pública, mejor ocúltala.',
      confirmLabel: 'Eliminar', danger: true,
    }))) return;
    setBusy(r.id);
    const { error } = await supabase.from('reviews').delete().eq('id', r.id);
    setBusy(null);
    if (error) return notify(error.message, 'error');
    notify('Reseña eliminada.');
    reload();
  }

  return (
    <div>
      {noticeNode}
      {dialogNode}
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-lg font-bold">{focusId ? 'Reseña reportada' : 'Reseñas'}</h2>
        {focusId && <button className="btn btn-ghost" onClick={onClearFocus}>Ver todas las reseñas</button>}
      </div>
      {!focusId && (
        <div className="mb-4 grid gap-3 sm:grid-cols-2">
          <div>
            <label className="label" htmlFor="adm-rv-status">Estado</label>
            <select id="adm-rv-status" className="input" value={status} onChange={(e) => setStatus(e.target.value as Status)}>
              <option value="all">Todas</option>
              <option value="visible">Visibles</option>
              <option value="hidden">Ocultas</option>
            </select>
          </div>
          <div>
            <label className="label" htmlFor="adm-rv-rating">Calificación</label>
            <select id="adm-rv-rating" className="input" value={rating} onChange={(e) => setRating(e.target.value)}>
              <option value="all">Todas</option>
              {[5, 4, 3, 2, 1].map((n) => <option key={n} value={n}>{n} {n === 1 ? 'estrella' : 'estrellas'}</option>)}
            </select>
          </div>
        </div>
      )}
      {loading ? <p className="text-muted" role="status">Cargando…</p> : items.length === 0 ? (
        <div className="card p-10 text-center text-muted">No hay reseñas con esos filtros.</div>
      ) : (
        <ul className="space-y-3">
          {items.map((r) => (
            <li key={r.id} className="card p-4">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-sm font-semibold">
                    <span aria-label={`${r.rating} de 5`}>{'★'.repeat(r.rating)}{'☆'.repeat(5 - r.rating)}</span>
                    <span className={`ml-2 rounded-full px-2 py-0.5 text-xs font-semibold ${r.status === 'visible' ? 'bg-brand-50 text-brand-700' : 'bg-red-50 text-red-700'}`}>
                      {r.status === 'visible' ? 'Visible' : 'Oculta'}
                    </span>
                  </p>
                  <p className="text-xs text-muted">
                    {names[r.user_id] || 'Sin nombre'} · {new Date(r.created_at).toLocaleString('es-MX')}
                  </p>
                </div>
                <div className="flex flex-wrap gap-2">
                  <button className="btn btn-ghost !px-3 !py-1.5" disabled={busy === r.id} onClick={() => toggle(r)}>
                    {r.status === 'visible' ? 'Ocultar' : 'Mostrar'}
                  </button>
                  <button className="btn btn-ghost !px-3 !py-1.5 !text-red-700" disabled={busy === r.id} onClick={() => remove(r)}>Eliminar</button>
                </div>
              </div>
              {r.body ? <p className="mt-2 whitespace-pre-line break-words rounded-xl bg-surface p-3 text-sm">{r.body}</p>
                : <p className="mt-2 text-sm text-muted">Sin comentario.</p>}
              {r.owner_reply && (
                <p className="mt-2 whitespace-pre-line break-words border-l-2 border-brand-200 pl-3 text-sm text-muted">
                  <span className="font-semibold text-ink">Respuesta del negocio: </span>{r.owner_reply}
                </p>
              )}
              <p className="mt-3 text-sm">
                <span className="text-muted">Negocio: </span>
                {r.businesses
                  ? <a href={`/n/${r.businesses.slug}#resenas`} target="_blank" rel="noopener" className="font-medium text-brand-700 hover:underline">{r.businesses.name}</a>
                  : <span className="text-muted">eliminado</span>}
              </p>
            </li>
          ))}
        </ul>
      )}
      <Pagination page={page} total={total} onPage={setPage} loading={loading} />
    </div>
  );
}
