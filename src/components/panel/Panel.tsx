import { useEffect, useState } from 'react';
import type { Session } from '@supabase/supabase-js';
import { supabase } from '../../lib/supabase';
import { BRAND } from '../../lib/brand';
import BusinessForm from './BusinessForm';
import ListingsManager from './ListingsManager';
import Checklist, { readShared, markShared } from './Checklist';
import ShareCard from './ShareCard';
import AccountTab from './AccountTab';

type Tab = 'listings' | 'business' | 'stats' | 'account';

export default function Panel() {
  const [session, setSession] = useState<Session | null>(null);
  const [ready, setReady] = useState(false);
  const [business, setBusiness] = useState<any | null>(null);
  const [municipalities, setMunicipalities] = useState<any[]>([]);
  const [categories, setCategories] = useState<any[]>([]);
  const [tab, setTab] = useState<Tab>('listings');
  const [isAdmin, setIsAdmin] = useState(false);
  const [shared, setShared] = useState(false);

  useEffect(() => {
    supabase.auth.getSession().then(async ({ data }) => {
      if (!data.session) { location.replace('/ingresar'); return; }
      setSession(data.session);
      supabase.from('profiles').select('role').eq('id', data.session.user.id).maybeSingle()
        .then(({ data: p }) => setIsAdmin(p?.role === 'admin'));
      const [b, m, c] = await Promise.all([
        supabase.from('businesses').select('*').eq('owner_id', data.session.user.id).maybeSingle(),
        supabase.from('municipalities').select('id,name,lat,lng').order('name'),
        supabase.from('categories').select('id,name').order('sort'),
      ]);
      setBusiness(b.data);
      if (b.data) setShared(readShared(b.data.id));
      setMunicipalities(m.data ?? []);
      setCategories(c.data ?? []);
      setReady(true);
    });
  }, []);

  if (!ready || !session) return <p className="p-10 text-center text-muted">Cargando tu panel…</p>;
  const userId = session.user.id;

  async function logout() {
    await supabase.auth.signOut();
    location.href = '/';
  }

  const tabs: [Tab, string][] = [['listings', 'Publicaciones'], ['business', 'Mi negocio'], ['stats', 'Estadísticas'], ['account', 'Cuenta']];

  return (
    <div className="mx-auto max-w-4xl px-4 py-8">
      <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-extrabold">{business ? business.name : 'Configura tu negocio'}</h1>
          <p className="text-sm text-muted">{session.user.email}</p>
        </div>
        <div className="flex gap-2">
          {business && (
            <a href={`/n/${business.slug}`} target="_blank" rel="noopener" className="btn btn-outline">
              <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M3 9l1.5-5h15L21 9" /><path d="M4 9v11h16V9" /><path d="M9 20v-6h6v6" />
              </svg>
              Ver mi tienda
              <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M7 17L17 7" /><path d="M8 7h9v9" />
              </svg>
            </a>
          )}
          {isAdmin && <a href="/admin" className="btn btn-ghost">Admin</a>}
          <button onClick={logout} className="btn btn-ghost">Salir</button>
        </div>
      </div>

      {!business ? (
        <>
          <p className="mb-4 rounded-xl bg-brand-50 px-4 py-3 text-sm text-brand-700">Primero cuéntanos sobre tu negocio. Después podrás publicar tus productos o servicios.</p>
          <BusinessForm userId={userId} business={null} municipalities={municipalities} onSaved={setBusiness} />
          {/* Quien aún no crea su negocio también puede cambiar su contraseña o eliminar su cuenta */}
          <details className="mt-8">
            <summary className="cursor-pointer text-sm font-semibold text-muted hover:text-ink">Cuenta</summary>
            <div className="mt-4"><AccountTab user={session.user} /></div>
          </details>
        </>
      ) : (
        <>
          <Checklist business={business} shared={shared} refreshKey={tab} onGo={setTab} />
          <div role="tablist" className="mb-6 flex gap-1 overflow-x-auto border-b border-line">
            {tabs.map(([k, label]) => (
              <button key={k} role="tab" aria-selected={tab === k} onClick={() => setTab(k)}
                className={`-mb-px min-h-11 whitespace-nowrap border-b-2 px-4 py-2.5 text-sm font-semibold ${tab === k ? 'border-brand-600 text-brand-700' : 'border-transparent text-muted hover:text-ink'}`}>{label}</button>
            ))}
          </div>
          {tab === 'listings' && <ShareCard business={business} onShared={() => { markShared(business.id); setShared(true); }} />}
          {tab === 'listings' && (
            <p className="mb-6 text-sm text-muted">
              ¿Conoces a otro emprendedor?{' '}
              <a
                href={`https://wa.me/?text=${encodeURIComponent(`Hola, publiqué mi negocio gratis en ${BRAND.name} y me está funcionando. Aquí te explico cómo hacerlo: ${location.origin}/guia`)}`}
                target="_blank" rel="noopener noreferrer"
                className="font-semibold text-brand-700 underline">Invitarlo por WhatsApp</a>
            </p>
          )}
          {tab === 'listings' && <ListingsManager userId={userId} businessId={business.id} categories={categories} />}
          {tab === 'business' && <BusinessForm userId={userId} business={business} municipalities={municipalities} onSaved={setBusiness} />}
          {tab === 'stats' && <Stats businessId={business.id} />}
          {tab === 'account' && <AccountTab user={session.user} />}
        </>
      )}
    </div>
  );
}

function Stats({ businessId }: { businessId: string }) {
  type Row = { id: string; title: string; slug: string; view: number; whatsapp_click: number; map_click: number };
  const [c, setC] = useState<Record<string, number> | null>(null);
  const [rows, setRows] = useState<Row[]>([]);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    // Una sola RPC (my_stats, filtrada por auth.uid()) con totales y el top 10 por publicación
    supabase.rpc('my_stats', { p_days: 30 }).then(({ data, error }) => {
      if (error || !data) { setFailed(true); return; }
      setC(data.totals);
      setRows(data.listings ?? []);
    });
  }, [businessId]);

  const tiles: [string, string][] = [['view', 'Visitas a tus publicaciones'], ['whatsapp_click', 'Clics a WhatsApp'], ['map_click', 'Clics en “Cómo llegar”']];
  return (
    <div>
      <p className="mb-4 text-sm text-muted">Últimos 30 días</p>
      <div className="grid gap-4 sm:grid-cols-3">
        {tiles.map(([k, label]) => (
          <div key={k} className="card p-5">
            <p className="text-3xl font-extrabold text-brand-700">{c ? c[k] : '…'}</p>
            <p className="mt-1 text-sm text-muted">{label}</p>
          </div>
        ))}
      </div>
      {failed && <p className="mt-4 text-sm text-red-600">No pudimos cargar tus estadísticas. Inténtalo de nuevo más tarde.</p>}
      {rows.length > 0 && (
        <div className="card mt-6 overflow-x-auto">
          <table className="w-full text-left text-sm">
            <caption className="px-4 pt-4 text-left text-sm font-semibold">Tus publicaciones con más movimiento</caption>
            <thead className="text-xs text-muted">
              <tr>
                <th scope="col" className="px-4 py-2 font-medium">Publicación</th>
                <th scope="col" className="px-3 py-2 text-right font-medium">Visitas</th>
                <th scope="col" className="px-3 py-2 text-right font-medium">WhatsApp</th>
                <th scope="col" className="px-4 py-2 text-right font-medium">Mapa</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id} className="border-t border-line">
                  <td className="max-w-[16rem] truncate px-4 py-2.5"><a href={`/p/${r.slug}`} target="_blank" rel="noopener" className="hover:underline">{r.title}</a></td>
                  <td className="px-3 py-2.5 text-right">{r.view}</td>
                  <td className="px-3 py-2.5 text-right">{r.whatsapp_click}</td>
                  <td className="px-4 py-2.5 text-right">{r.map_click}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <p className="mt-4 text-xs text-muted">Cada visitante se cuenta una vez por día y publicación. Tus propias visitas no se cuentan.</p>
    </div>
  );
}
