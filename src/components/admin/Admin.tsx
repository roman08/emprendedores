import { useEffect, useState } from 'react';
import { supabase } from '../../lib/supabase';
import SummaryTab from './SummaryTab';
import BusinessesTab from './BusinessesTab';
import ListingsTab from './ListingsTab';
import ReportsTab from './ReportsTab';

type Tab = 'summary' | 'businesses' | 'listings' | 'reports';
type Access = 'loading' | 'ok' | 'denied';

export default function Admin() {
  const [access, setAccess] = useState<Access>('loading');
  const [tab, setTab] = useState<Tab>('summary');

  useEffect(() => {
    supabase.auth.getSession().then(async ({ data }) => {
      if (!data.session) { location.replace('/ingresar'); return; }
      const { data: p } = await supabase.from('profiles').select('role').eq('id', data.session.user.id).maybeSingle();
      setAccess(p?.role === 'admin' ? 'ok' : 'denied');
    });
  }, []);

  if (access === 'loading') return <p className="p-10 text-center text-muted">Cargando…</p>;
  if (access === 'denied')
    return (
      <div className="mx-auto max-w-md px-4 py-16 text-center">
        <h1 className="text-2xl font-extrabold">Acceso denegado</h1>
        <p className="mt-2 text-muted">Esta sección es solo para administradores.</p>
        <a href="/panel" className="btn btn-primary mt-6">Ir a mi panel</a>
      </div>
    );

  const tabs: [Tab, string][] = [['summary', 'Resumen'], ['businesses', 'Negocios'], ['listings', 'Publicaciones'], ['reports', 'Reportes']];

  return (
    <div className="mx-auto max-w-5xl px-4 py-8">
      <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-extrabold">Administración</h1>
        <a href="/panel" className="btn btn-ghost">Volver a mi panel</a>
      </div>
      <div role="tablist" className="mb-6 flex gap-1 overflow-x-auto border-b border-line">
        {tabs.map(([k, label]) => (
          <button key={k} role="tab" aria-selected={tab === k} onClick={() => setTab(k)}
            className={`-mb-px whitespace-nowrap border-b-2 px-4 py-2.5 text-sm font-semibold ${tab === k ? 'border-brand-600 text-brand-700' : 'border-transparent text-muted hover:text-ink'}`}>{label}</button>
        ))}
      </div>
      {tab === 'summary' && <SummaryTab />}
      {tab === 'businesses' && <BusinessesTab />}
      {tab === 'listings' && <ListingsTab />}
      {tab === 'reports' && <ReportsTab />}
    </div>
  );
}
