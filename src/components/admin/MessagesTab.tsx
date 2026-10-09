import { useState } from 'react';
import { RowsSkeleton } from '../Loading';
import { supabase } from '../../lib/supabase';
import { Pagination, useConfirm, useNotice, usePaged } from './shared';

type Status = 'new' | 'read' | 'done';

const FILTERS: [Status, string][] = [['new', 'Nuevos'], ['read', 'Leídos'], ['done', 'Atendidos']];
const KIND: Record<string, string> = {
  duda: 'Duda', problema: 'Reportar un problema', arco: 'Derechos ARCO', publicidad: 'Publicidad', otro: 'Otro',
};

export default function MessagesTab() {
  const [status, setStatus] = useState<Status>('new');
  const [busy, setBusy] = useState<string | null>(null);
  const { notify, node: noticeNode } = useNotice();
  const { confirm, node: dialogNode } = useConfirm();

  const { items, total, page, setPage, loading, reload } = usePaged<any>((from, to) =>
    supabase.from('contact_messages')
      .select('id,name,email,kind,message,status,created_at', { count: 'exact' })
      .eq('status', status)
      .order('created_at', { ascending: false })
      .range(from, to),
  status, (m) => notify(`No se pudieron cargar los mensajes: ${m}`, 'error'));

  async function setState(m: any, next: Status) {
    setBusy(m.id);
    const { error } = await supabase.from('contact_messages').update({ status: next }).eq('id', m.id);
    setBusy(null);
    if (error) return notify(error.message, 'error');
    notify(next === 'done' ? 'Mensaje marcado como atendido.' : next === 'read' ? 'Mensaje marcado como leído.' : 'Mensaje marcado como nuevo.');
    reload();
  }

  async function remove(m: any) {
    if (!(await confirm({
      title: '¿Borrar este mensaje?',
      body: `El mensaje de ${m.name} se eliminará de forma permanente.`,
      confirmLabel: 'Borrar', danger: true,
    }))) return;
    setBusy(m.id);
    const { error } = await supabase.from('contact_messages').delete().eq('id', m.id);
    setBusy(null);
    if (error) return notify(error.message, 'error');
    notify('Mensaje borrado.');
    reload();
  }

  return (
    <div>
      {noticeNode}
      {dialogNode}
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-lg font-bold">Mensajes de contacto</h2>
        <div role="group" aria-label="Filtrar por estado" className="flex gap-1">
          {FILTERS.map(([k, label]) => (
            <button key={k} type="button" aria-pressed={status === k} onClick={() => setStatus(k)}
              className={`btn ${status === k ? 'btn-primary' : 'btn-ghost'} !px-3 !py-1.5`}>{label}</button>
          ))}
        </div>
      </div>
      {loading ? <RowsSkeleton /> : items.length === 0 ? (
        <div className="card p-10 text-center text-muted">No hay mensajes en esta lista.</div>
      ) : (
        <ul className="space-y-3">
          {items.map((m) => (
            <li key={m.id} className="card p-4">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-sm font-semibold">{m.name} <span className="font-normal text-muted">· {KIND[m.kind] ?? m.kind}</span></p>
                  <a href={`mailto:${encodeURIComponent(m.email)}`} className="break-all text-sm text-brand-700 hover:underline">{m.email}</a>
                  <p className="text-xs text-muted">{new Date(m.created_at).toLocaleString('es-MX')}</p>
                </div>
              </div>
              <p className="mt-2 whitespace-pre-line break-words rounded-xl bg-surface p-3 text-sm">{m.message}</p>
              <div className="mt-3 flex flex-wrap gap-2 border-t border-line pt-3">
                {m.status === 'new' && (
                  <button className="btn btn-ghost !px-3 !py-1.5" disabled={busy === m.id} onClick={() => setState(m, 'read')}>Marcar leído</button>
                )}
                {m.status !== 'done' && (
                  <button className="btn btn-primary !px-3 !py-1.5" disabled={busy === m.id} onClick={() => setState(m, 'done')}>Marcar atendido</button>
                )}
                {m.status !== 'new' && (
                  <button className="btn btn-ghost !px-3 !py-1.5" disabled={busy === m.id} onClick={() => setState(m, 'new')}>Marcar como nuevo</button>
                )}
                <button className="btn btn-ghost !px-3 !py-1.5 !text-red-700" disabled={busy === m.id} onClick={() => remove(m)}>Borrar</button>
              </div>
            </li>
          ))}
        </ul>
      )}
      <Pagination page={page} total={total} onPage={setPage} loading={loading} />
    </div>
  );
}
