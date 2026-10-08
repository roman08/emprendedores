import { useState } from 'react';
import { supabase } from '../../lib/supabase';
import { Pagination, likeTerm, listingImagePaths, removePaths, storagePath, useConfirm, useDebounced, useNotice, usePaged } from './shared';

type Filter = 'all' | 'active' | 'suspended' | 'verified';

export default function BusinessesTab() {
  const [q, setQ] = useState('');
  const [filter, setFilter] = useState<Filter>('all');
  const [busy, setBusy] = useState<string | null>(null);
  const { notify, node: noticeNode } = useNotice();
  const { confirm, node: dialogNode } = useConfirm();

  const term = likeTerm(useDebounced(q));
  const { items, setItems, total, page, setPage, loading, reload } = usePaged<any>((from, to) => {
    let query = supabase.from('businesses')
      .select('id,name,slug,status,verified,logo_url,banner_url,created_at,municipalities(name)', { count: 'exact' });
    if (term) query = query.or(`name.ilike.%${term}%,slug.ilike.%${term}%`);
    if (filter === 'verified') query = query.eq('verified', true);
    else if (filter !== 'all') query = query.eq('status', filter);
    return query.order('created_at', { ascending: false }).range(from, to);
  }, `${term}|${filter}`, (m) => notify(`No se pudieron cargar los negocios: ${m}`, 'error'));

  async function patch(b: any, fields: Record<string, unknown>, okMsg: string) {
    setBusy(b.id);
    const { error } = await supabase.from('businesses').update(fields).eq('id', b.id);
    setBusy(null);
    if (error) return notify(error.message, 'error');
    setItems((prev) => prev.map((x) => (x.id === b.id ? { ...x, ...fields } : x)));
    notify(okMsg);
  }

  async function toggleStatus(b: any) {
    const suspend = b.status === 'active';
    if (suspend && !(await confirm({
      title: `¿Suspender "${b.name}"?`,
      body: 'Su tienda y sus publicaciones dejarán de ser visibles. Puedes reactivarla después.',
      confirmLabel: 'Suspender', danger: true,
    }))) return;
    patch(b, { status: suspend ? 'suspended' : 'active' }, suspend ? `"${b.name}" fue suspendido.` : `"${b.name}" fue reactivado.`);
  }

  async function remove(b: any) {
    if (!(await confirm({
      title: `¿Borrar "${b.name}" definitivamente?`,
      body: 'Se eliminarán el negocio, todas sus publicaciones y sus fotos. Esta acción no se puede deshacer.',
      confirmLabel: 'Borrar todo', danger: true,
    }))) return;
    setBusy(b.id);
    try {
      const { data: ls, error: e1 } = await supabase.from('listings').select('id,status').eq('business_id', b.id);
      if (e1) throw e1;
      const ids = (ls ?? []).map((l) => l.id as string);
      const media = [b.logo_url, b.banner_url].map((u) => storagePath('business-media', u)).filter((p): p is string => !!p);
      const photos = await listingImagePaths(ids);
      // Pausar primero para que el guard de "última foto" no bloquee el borrado en cascada
      if ((ls ?? []).some((l) => l.status === 'published')) {
        const { error } = await supabase.from('listings').update({ status: 'paused' }).eq('business_id', b.id);
        if (error) throw error;
      }
      // Primero las filas: si falla, no se pierden archivos de un negocio que sigue existiendo
      const { error } = await supabase.from('businesses').delete().eq('id', b.id);
      if (error) throw error;
      let files = 0, warn = '';
      try { files = (await removePaths('business-media', media)) + (await removePaths('listing-images', photos)); }
      catch (e: any) { warn = ` Algunos archivos no se pudieron borrar (${e.message}); revísalos en "Archivos huérfanos".`; }
      notify(`Negocio borrado. Archivos eliminados de Storage: ${files}.${warn}`, warn ? 'error' : 'ok');
      reload();
    } catch (e: any) {
      notify(e.message ?? 'No se pudo borrar el negocio.', 'error');
    } finally { setBusy(null); }
  }

  return (
    <div>
      {noticeNode}
      {dialogNode}
      <div className="mb-4 flex flex-wrap gap-3">
        <div className="min-w-[200px] flex-1">
          <label className="sr-only" htmlFor="adm-b-q">Buscar negocio</label>
          <input id="adm-b-q" type="search" className="input" placeholder="Buscar por nombre…" value={q} onChange={(e) => setQ(e.target.value)} />
        </div>
        <div>
          <label className="sr-only" htmlFor="adm-b-f">Filtrar</label>
          <select id="adm-b-f" className="input" value={filter} onChange={(e) => setFilter(e.target.value as Filter)}>
            <option value="all">Todos</option><option value="active">Activos</option>
            <option value="suspended">Suspendidos</option><option value="verified">Verificados</option>
          </select>
        </div>
      </div>
      {loading ? <p className="text-muted" role="status">Cargando…</p> : items.length === 0 ? (
        <div className="card p-10 text-center text-muted">Sin resultados.</div>
      ) : (
        <ul className="space-y-3">
          {items.map((b) => (
            <li key={b.id} className="card flex flex-wrap items-center justify-between gap-3 p-4">
              <div className="min-w-0">
                <a href={`/n/${b.slug}`} target="_blank" rel="noopener" className="font-semibold hover:underline">{b.name}</a>
                {b.verified && <span title="Verificado" className="ml-1 text-brand-600">✔<span className="sr-only"> Verificado</span></span>}
                <p className="text-xs text-muted">
                  {b.municipalities?.name ?? 'Tabasco'} · {new Date(b.created_at).toLocaleDateString('es-MX')}
                  <span className={`ml-2 rounded-full px-2 py-0.5 font-semibold ${b.status === 'active' ? 'bg-brand-50 text-brand-700' : 'bg-red-50 text-red-700'}`}>
                    {b.status === 'active' ? 'Activo' : 'Suspendido'}
                  </span>
                </p>
              </div>
              <div className="flex flex-wrap gap-2">
                <button className="btn btn-ghost" disabled={busy === b.id}
                  onClick={() => patch(b, { verified: !b.verified }, b.verified ? 'Verificación retirada.' : `"${b.name}" fue verificado.`)}>
                  {b.verified ? 'Quitar verificación' : 'Verificar'}
                </button>
                <button className="btn btn-ghost" disabled={busy === b.id} onClick={() => toggleStatus(b)}>
                  {b.status === 'active' ? 'Suspender' : 'Reactivar'}
                </button>
                <button className="btn btn-ghost !text-red-700" disabled={busy === b.id} onClick={() => remove(b)}>Borrar</button>
              </div>
            </li>
          ))}
        </ul>
      )}
      <Pagination page={page} total={total} onPage={setPage} loading={loading} />
    </div>
  );
}
