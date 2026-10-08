import { useEffect, useState } from 'react';
import { supabase } from '../../lib/supabase';

export type PanelTab = 'listings' | 'business' | 'stats';

const key = (businessId: string) => `emprendedores:shared:${businessId}`;

export function readShared(businessId: string): boolean {
  try { return localStorage.getItem(key(businessId)) === '1'; } catch { return false; }
}

export function markShared(businessId: string) {
  try { localStorage.setItem(key(businessId), '1'); } catch { /* sin almacenamiento */ }
}

interface Props {
  business: any;
  shared: boolean;
  /** Cambia cuando el usuario cambia de pestaña, para volver a contar publicaciones. */
  refreshKey: string;
  onGo: (tab: PanelTab) => void;
}

export default function Checklist({ business, shared, refreshKey, onGo }: Props) {
  const [published, setPublished] = useState<number | null>(null);

  useEffect(() => {
    supabase.from('listings').select('id', { count: 'exact', head: true })
      .eq('business_id', business.id).eq('status', 'published')
      .then((r) => setPublished(r.count ?? 0));
  }, [business.id, refreshKey]);

  const steps: { label: string; done: boolean; action: string; tab: PanelTab }[] = [
    { label: 'Completa tu perfil (descripción y municipio)', done: !!business.description?.trim() && !!business.municipality_id, action: 'Editar perfil', tab: 'business' },
    { label: 'Configura tu horario de atención', done: !!business.hours, action: 'Agregar horario', tab: 'business' },
    { label: 'Publica tu primer producto o servicio', done: (published ?? 0) > 0, action: 'Publicar', tab: 'listings' },
    { label: 'Comparte tu tienda con tus clientes', done: shared, action: 'Compartir', tab: 'listings' },
  ];
  const doneCount = steps.filter((s) => s.done).length;
  if (published === null || doneCount === steps.length) return null;
  const pct = Math.round((doneCount / steps.length) * 100);

  return (
    <section className="card mb-6 p-5" aria-labelledby="checklist-title">
      <div className="flex items-center justify-between gap-3">
        <h2 id="checklist-title" className="font-bold">Activa tu tienda</h2>
        <span className="text-sm font-semibold text-brand-700">{doneCount} de {steps.length}</span>
      </div>
      <div className="mt-3 h-2 overflow-hidden rounded-full bg-brand-50" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct} aria-label="Progreso de activación">
        <div className="h-full rounded-full bg-brand-500 transition-all" style={{ width: `${pct}%` }} />
      </div>
      <ul className="mt-4 space-y-2">
        {steps.map((s) => (
          <li key={s.label} className="flex items-center gap-3 text-sm">
            <span aria-hidden="true" className={`grid h-5 w-5 shrink-0 place-items-center rounded-full text-xs ${s.done ? 'bg-brand-600 text-white' : 'border border-line text-transparent'}`}>✓</span>
            <span className={`flex-1 ${s.done ? 'text-muted line-through' : ''}`}>{s.label}<span className="sr-only">{s.done ? ' (completado)' : ' (pendiente)'}</span></span>
            {!s.done && <button type="button" onClick={() => onGo(s.tab)} className="font-semibold text-brand-700 hover:underline">{s.action}</button>}
          </li>
        ))}
      </ul>
    </section>
  );
}
