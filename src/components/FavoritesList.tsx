import { useEffect, useMemo, useRef, useState } from 'react';
import { supabase } from '../lib/supabase';
import { formatPrice, initials } from '../lib/format';
import { getFavorites, isFavorite, onChange, parseSharedIds, removeMany, toggle, type FavKind } from '../lib/favorites';
import { copyText } from './ShareButtons';

const SHARE_MAX = 50;
// Nunca se pide la columna whatsapp: el número no sale en HTML ni JSON.
const LISTING_SELECT = 'id,slug,title,price,type,availability,listing_images(url,position),businesses(name,municipalities(name))';
const BUSINESS_SELECT = 'id,slug,name,logo_url,description,municipalities(name)';

type Listing = {
  id: string; slug: string; title: string; price: number | null; type: string; availability: string;
  listing_images: { url: string; position: number }[] | null;
  businesses: { name: string; municipalities: { name: string } | null } | null;
};
type Business = { id: string; slug: string; name: string; logo_url: string | null; description: string | null; municipalities: { name: string } | null };

const HEART = 'M20.8 4.6a5.5 5.5 0 0 0-7.8 0L12 5.7l-1-1.1a5.5 5.5 0 0 0-7.8 7.8l1 1.1L12 21.2l7.8-7.7 1-1.1a5.5 5.5 0 0 0 0-7.8z';

function Heart({ on, kind, id, shared, onToggle }: { on: boolean; kind: FavKind; id: string; shared: boolean; onToggle: (kind: FavKind, id: string) => void }) {
  const label = shared ? (on ? 'Quitar de mis favoritos' : 'Guardar en mis favoritos') : 'Quitar de favoritos';
  return (
    <button
      type="button"
      onClick={() => onToggle(kind, id)}
      aria-pressed={on}
      aria-label={label}
      title={label}
      className="absolute right-1 top-1 grid h-11 w-11 place-items-center rounded-full text-gray-700 focus-visible:outline-2 focus-visible:outline-offset-0 focus-visible:outline-brand-600"
    >
      <span className="grid h-8 w-8 place-items-center rounded-full bg-white/90 shadow-sm motion-safe:transition motion-safe:active:scale-90">
        <svg viewBox="0 0 24 24" width="18" height="18" fill={on ? '#e11d48' : 'none'} stroke={on ? '#e11d48' : 'currentColor'} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={HEART} /></svg>
      </span>
    </button>
  );
}

function ListingItem({ l, ...heart }: { l: Listing; on: boolean; shared: boolean; onToggle: (kind: FavKind, id: string) => void }) {
  const img = [...(l.listing_images ?? [])].sort((a, b) => a.position - b.position)[0]?.url;
  const place = l.businesses?.municipalities?.name;
  const soldOut = l.availability === 'sold_out';
  return (
    <li className="group relative">
      <a href={`/p/${l.slug}`} className="card block h-full overflow-hidden transition group-hover:shadow-md">
        <div className="relative aspect-[4/3] overflow-hidden bg-surface">
          {img && <img src={img} alt={l.title} loading="lazy" className={`h-full w-full object-cover ${soldOut ? 'opacity-50 grayscale' : ''}`} />}
          {soldOut && <span className="absolute left-2 top-2 rounded-full bg-gray-900/80 px-2.5 py-1 text-xs font-semibold text-white">Agotado</span>}
          {l.availability === 'on_demand' && <span className="absolute left-2 top-2 rounded-full bg-amber-100 px-2.5 py-1 text-xs font-semibold text-amber-800">Sobre pedido</span>}
        </div>
        <div className="p-4">
          <p className="line-clamp-2 font-semibold leading-snug">{l.title}</p>
          <p className="mt-1 text-lg font-bold text-brand-700">{formatPrice(l.price)}</p>
          <p className="mt-2 truncate text-xs text-muted">
            {l.businesses?.name}{place ? ` · ${place}` : ''}
            {l.type === 'service' && <span className="ml-1 rounded-full bg-brand-50 px-2 py-0.5 text-brand-700">Servicio</span>}
          </p>
        </div>
      </a>
      <Heart kind="listing" id={l.id} {...heart} />
    </li>
  );
}

function BusinessItem({ b, ...heart }: { b: Business; on: boolean; shared: boolean; onToggle: (kind: FavKind, id: string) => void }) {
  return (
    <li className="group relative">
      <a href={`/n/${b.slug}`} className="card flex h-full items-center gap-4 p-4 pr-14 transition group-hover:shadow-md">
        {b.logo_url
          ? <img src={b.logo_url} alt="" className="h-14 w-14 shrink-0 rounded-xl object-cover" loading="lazy" />
          : <span className="grid h-14 w-14 shrink-0 place-items-center rounded-xl bg-brand-100 text-lg font-bold text-brand-700">{initials(b.name)}</span>}
        <span className="min-w-0">
          <span className="block truncate font-semibold">{b.name}</span>
          <span className="block text-sm text-muted">{b.municipalities?.name ?? 'Tabasco'}</span>
          {b.description && <span className="mt-0.5 line-clamp-1 block text-xs text-muted">{b.description}</span>}
        </span>
      </a>
      <Heart kind="business" id={b.id} {...heart} />
    </li>
  );
}

/** Lista de guardados: los propios (localStorage) o una lista compartida (?ids=…&n=…), siempre solo lectura en la base. */
export default function FavoritesList() {
  const [ready, setReady] = useState(false);
  const [shared, setShared] = useState<{ listings: string[]; businesses: string[] } | null>(null);
  const [own, setOwn] = useState({ listings: [] as string[], businesses: [] as string[] });
  const [listings, setListings] = useState<Record<string, Listing>>({});
  const [businesses, setBusinesses] = useState<Record<string, Business>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [copied, setCopied] = useState('');
  const [retry, setRetry] = useState(0);
  const checked = useRef(new Set<string>());
  const [, bump] = useState(0);

  // Solo en el navegador: lista compartida en la URL y favoritos propios, sincronizados entre pestañas.
  useEffect(() => {
    const q = new URLSearchParams(location.search);
    const l = parseSharedIds(q.get('ids'), SHARE_MAX);
    const b = parseSharedIds(q.get('n'), SHARE_MAX);
    if (l.length + b.length > 0) setShared({ listings: l, businesses: b });
    setOwn(getFavorites());
    setReady(true);
    return onChange(() => { setOwn(getFavorites()); bump((n) => n + 1); });
  }, []);

  const view = shared ?? own;
  const key = `${view.listings.join(',')}|${view.businesses.join(',')}`;

  useEffect(() => {
    if (!ready) return;
    const needL = view.listings.filter((id) => !checked.current.has(`l${id}`));
    const needB = view.businesses.filter((id) => !checked.current.has(`b${id}`));
    if (needL.length + needB.length === 0) { setLoading(false); return; }
    let cancelled = false;
    setLoading(true);
    setError('');
    (async () => {
      const [rl, rb] = await Promise.all([
        needL.length ? supabase.from('listings').select(LISTING_SELECT).in('id', needL).eq('status', 'published') : Promise.resolve({ data: [] as Listing[], error: null }),
        needB.length ? supabase.from('businesses').select(BUSINESS_SELECT).in('id', needB).eq('status', 'active') : Promise.resolve({ data: [] as Business[], error: null }),
      ]);
      if (cancelled) return;
      if (rl.error || rb.error) {
        setError('No pudimos cargar tus guardados. Revisa tu conexión e inténtalo de nuevo.');
        setLoading(false);
        return;
      }
      const lData = (rl.data ?? []) as unknown as Listing[];
      const bData = (rb.data ?? []) as unknown as Business[];
      setListings((p) => ({ ...p, ...Object.fromEntries(lData.map((x) => [x.id, x])) }));
      setBusinesses((p) => ({ ...p, ...Object.fromEntries(bData.map((x) => [x.id, x])) }));
      needL.forEach((id) => checked.current.add(`l${id}`));
      needB.forEach((id) => checked.current.add(`b${id}`));
      // Lo que ya no existe (o se despublicó) se limpia de los favoritos propios.
      if (!shared) {
        removeMany('listing', needL.filter((id) => !lData.some((x) => x.id === id)));
        removeMany('business', needB.filter((id) => !bData.some((x) => x.id === id)));
      }
      setLoading(false);
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, key, retry]);

  const shownListings = useMemo(() => view.listings.map((id) => listings[id]).filter(Boolean), [key, listings]);
  const shownBusinesses = useMemo(() => view.businesses.map((id) => businesses[id]).filter(Boolean), [key, businesses]);
  const total = shownListings.length + shownBusinesses.length;

  const onToggle = (kind: FavKind, id: string) => { toggle(kind, id); };
  const isOn = (kind: FavKind, id: string) => (shared ? isFavorite(kind, id) : true);

  async function share() {
    const f = getFavorites();
    const q = new URLSearchParams();
    if (f.listings.length) q.set('ids', f.listings.slice(0, SHARE_MAX).join(','));
    if (f.businesses.length) q.set('n', f.businesses.slice(0, SHARE_MAX).join(','));
    const url = `${location.origin}/favoritos?${q.toString()}`;
    setCopied((await copyText(url)) ? 'ok' : 'fail');
    setTimeout(() => setCopied(''), 3000);
  }

  if (!ready || (loading && total === 0)) {
    return <p role="status" className="py-16 text-center text-muted">Cargando tus guardados…</p>;
  }

  if (error) {
    return (
      <div role="alert" className="card mx-auto max-w-md p-6 text-center">
        <p className="text-sm text-red-700">{error}</p>
        <button type="button" onClick={() => setRetry((n) => n + 1)} className="btn btn-primary mt-4">Reintentar</button>
      </div>
    );
  }

  if (total === 0) {
    return (
      <div className="card mx-auto max-w-md p-8 text-center">
        <svg viewBox="0 0 24 24" width="40" height="40" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" className="mx-auto text-brand-600"><path d={HEART} /></svg>
        <h2 className="mt-3 text-lg font-bold">{shared ? 'Esta lista ya no tiene elementos disponibles' : 'Aún no guardas nada'}</h2>
        <p className="mt-1 text-sm text-muted">
          {shared ? 'Es posible que los productos o negocios ya no estén publicados.' : 'Toca el corazón en un producto, servicio o negocio para tenerlo a la mano. Se guarda solo en este navegador.'}
        </p>
        <div className="mt-5 flex flex-col justify-center gap-2 sm:flex-row">
          <a href="/explorar" className="btn btn-primary">Explorar</a>
          <a href="/cerca" className="btn btn-ghost">Ver cerca de mí</a>
        </div>
      </div>
    );
  }

  return (
    <div>
      {shared && (
        <p className="mb-6 rounded-xl bg-brand-50 px-4 py-3 text-sm text-brand-800">
          Estás viendo una lista compartida. Toca el corazón para guardar algo en tus favoritos. <a href="/favoritos" className="font-semibold underline">Ver mis guardados</a>
        </p>
      )}
      {!shared && (
        <div className="mb-6 flex flex-wrap items-center gap-3">
          <button type="button" onClick={share} className="btn btn-outline !py-2 text-sm">Compartir mi lista</button>
          <span role="status" aria-live="polite" className="text-sm font-medium text-brand-700">
            {copied === 'ok' && '¡Enlace copiado! Cualquiera puede abrirlo.'}
            {copied === 'fail' && 'No se pudo copiar el enlace.'}
          </span>
          {(own.listings.length > SHARE_MAX || own.businesses.length > SHARE_MAX) && (
            <span className="text-xs text-muted">El enlace incluye hasta {SHARE_MAX} de cada tipo.</span>
          )}
        </div>
      )}
      {shownListings.length > 0 && (
        <section aria-labelledby="fav-prod">
          <h2 id="fav-prod" className="text-lg font-bold">Productos y servicios ({shownListings.length})</h2>
          <ul className="mt-4 grid grid-cols-2 gap-4 md:grid-cols-3 lg:grid-cols-4">
            {shownListings.map((l) => <ListingItem key={l.id} l={l} on={isOn('listing', l.id)} shared={!!shared} onToggle={onToggle} />)}
          </ul>
        </section>
      )}
      {shownBusinesses.length > 0 && (
        <section aria-labelledby="fav-neg" className="mt-10">
          <h2 id="fav-neg" className="text-lg font-bold">Negocios ({shownBusinesses.length})</h2>
          <ul className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {shownBusinesses.map((b) => <BusinessItem key={b.id} b={b} on={isOn('business', b.id)} shared={!!shared} onToggle={onToggle} />)}
          </ul>
        </section>
      )}
    </div>
  );
}
