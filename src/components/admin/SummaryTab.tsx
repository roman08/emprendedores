import { useEffect, useState } from 'react';
import { supabase } from '../../lib/supabase';
import { formatBytes, removePaths, useConfirm, useNotice } from './shared';

type Stats = {
  businesses: number; businesses_suspended: number; listings_published: number;
  reports_pending: number; events_30d: number; views_30d: number; whatsapp_30d: number;
};
type Orphan = { bucket_id: 'listing-images' | 'business-media'; name: string; size: number; created_at: string };
const key = (o: Orphan) => `${o.bucket_id}/${o.name}`;

export default function SummaryTab() {
  const [s, setS] = useState<Stats | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    supabase.rpc('admin_stats').then(({ data, error }) => {
      if (error) setError(error.message); else setS(data as Stats);
    });
  }, []);

  if (error) return <p role="alert" className="text-sm text-red-600">No se pudieron cargar las cifras: {error}</p>;

  const tiles: [string, string, string?][] = [
    ['businesses', 'Negocios', s ? `${s.businesses_suspended} suspendidos` : undefined],
    ['listings_published', 'Publicaciones publicadas'],
    ['reports_pending', 'Reportes pendientes'],
    ['events_30d', 'Eventos (30 días)', s ? `${s.views_30d} visitas · ${s.whatsapp_30d} clics a WhatsApp` : undefined],
  ];

  return (
    <div className="space-y-8">
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {tiles.map(([k, label, hint]) => (
          <div key={k} className="card p-5">
            <p className="text-3xl font-extrabold text-brand-700">{s ? (s as any)[k] : '…'}</p>
            <p className="mt-1 text-sm font-medium">{label}</p>
            {hint && <p className="mt-0.5 text-xs text-muted">{hint}</p>}
          </div>
        ))}
      </div>
      <OrphansTool />
    </div>
  );
}

/** Archivos de Storage que ninguna fila referencia (subidas abandonadas, borrados antiguos). */
function OrphansTool() {
  const [items, setItems] = useState<Orphan[] | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const { notify, node: noticeNode } = useNotice();
  const { confirm, node: dialogNode } = useConfirm();

  async function scan() {
    setBusy(true);
    const { data, error } = await supabase.rpc('admin_orphan_objects');
    setBusy(false);
    if (error) return notify(`No se pudo revisar Storage: ${error.message}`, 'error');
    const rows = ((data ?? []) as Orphan[]).map((o) => ({ ...o, size: Number(o.size) || 0 }));
    setItems(rows);
    setSelected(new Set());
    notify(rows.length ? `Se encontraron ${rows.length} archivos huérfanos.` : 'No hay archivos huérfanos.');
  }

  function toggle(o: Orphan) {
    setSelected((prev) => { const n = new Set(prev); const k = key(o); if (n.has(k)) n.delete(k); else n.add(k); return n; });
  }
  const allSelected = !!items?.length && selected.size === items.length;

  async function removeSelected() {
    const chosen = (items ?? []).filter((o) => selected.has(key(o)));
    if (!chosen.length) return;
    const bytes = chosen.reduce((a, o) => a + o.size, 0);
    if (!(await confirm({
      title: `¿Borrar ${chosen.length} archivo${chosen.length === 1 ? '' : 's'} huérfano${chosen.length === 1 ? '' : 's'}?`,
      body: `Se liberarán ${formatBytes(bytes)} de Storage. Esta acción no se puede deshacer.`,
      confirmLabel: 'Borrar archivos', danger: true,
    }))) return;
    setBusy(true);
    try {
      let removed = 0;
      for (const bucket of ['listing-images', 'business-media'] as const) {
        removed += await removePaths(bucket, chosen.filter((o) => o.bucket_id === bucket).map((o) => o.name));
      }
      setItems((prev) => (prev ?? []).filter((o) => !selected.has(key(o))));
      setSelected(new Set());
      notify(`Archivos eliminados: ${removed} de ${chosen.length}.`);
    } catch (e: any) {
      notify(e.message ?? 'No se pudieron borrar los archivos.', 'error');
    } finally { setBusy(false); }
  }

  return (
    <section aria-labelledby="orph-h" className="card p-5">
      {noticeNode}
      {dialogNode}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 id="orph-h" className="text-lg font-bold">Archivos huérfanos</h2>
          <p className="text-sm text-muted">Imágenes en Storage que ya no pertenecen a ningún negocio ni publicación (más de 1 hora de antigüedad).</p>
        </div>
        <button className="btn btn-ghost" disabled={busy} onClick={scan}>{busy && !items ? 'Revisando…' : items ? 'Volver a revisar' : 'Buscar huérfanos'}</button>
      </div>

      {items && items.length > 0 && (
        <div className="mt-4">
          <div className="mb-2 flex flex-wrap items-center justify-between gap-3 text-sm">
            <label className="flex items-center gap-2">
              <input type="checkbox" checked={allSelected} onChange={() => setSelected(allSelected ? new Set() : new Set(items.map(key)))} />
              Seleccionar todos ({items.length}{items.length >= 500 ? '+' : ''})
            </label>
            <button className="btn btn-primary !bg-red-600 hover:!bg-red-700" disabled={busy || selected.size === 0} onClick={removeSelected}>
              Borrar seleccionados ({selected.size})
            </button>
          </div>
          <ul className="max-h-96 divide-y divide-line overflow-y-auto rounded-xl border border-line">
            {items.map((o) => (
              <li key={key(o)} className="flex items-center gap-3 px-3 py-2 text-sm">
                <input type="checkbox" id={`orph-${key(o)}`} checked={selected.has(key(o))} onChange={() => toggle(o)} />
                <label htmlFor={`orph-${key(o)}`} className="min-w-0 flex-1 break-all">
                  <span className="font-mono text-xs">{o.bucket_id}/{o.name}</span>
                  <span className="block text-xs text-muted">{new Date(o.created_at).toLocaleString('es-MX')}</span>
                </label>
                <span className="shrink-0 text-xs text-muted">{formatBytes(o.size)}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
      {items && items.length === 0 && <p className="mt-4 text-sm text-muted">Storage está limpio.</p>}
    </section>
  );
}
