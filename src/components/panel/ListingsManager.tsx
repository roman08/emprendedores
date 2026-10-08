import { useEffect, useRef, useState, type SyntheticEvent } from 'react';
import { supabase } from '../../lib/supabase';
import { formatPrice } from '../../lib/format';
import { BRAND } from '../../lib/brand';
import { uploadImage, removeImage } from '../../lib/upload';
import ShareMenu from './SocialShare';

const MAX_IMAGES = 5;
type Img = { id: string; url: string; position: number };
// Foto en edición: guardada (id + position en BD) o pendiente de subir (file + preview local)
type Photo = {
  key: string; id?: string; url: string; pos?: number; file?: File;
  state: 'saved' | 'pending' | 'uploading' | 'error'; error?: string;
};
type Saved = { title: string; slug: string; status: string };

const AVAILABILITY: Record<string, string> = { available: 'Disponible', sold_out: 'Agotado', on_demand: 'Sobre pedido' };

export default function ListingsManager({ userId, businessId, categories }: {
  userId: string; businessId: string; categories: { id: number; name: string }[];
}) {
  const [items, setItems] = useState<any[]>([]);
  const [editing, setEditing] = useState<any | 'new' | null>(null);
  const [loading, setLoading] = useState(true);
  const [notice, setNotice] = useState<(Saved & { text: string }) | { text: string; slug?: undefined } | null>(null);

  async function load() {
    const { data } = await supabase.from('listings').select('*, listing_images(id,url,position)')
      .eq('business_id', businessId).order('created_at', { ascending: false });
    setItems(data ?? []);
    setLoading(false);
  }
  useEffect(() => { load(); }, [businessId]);

  if (editing)
    return <ListingForm userId={userId} businessId={businessId} categories={categories}
      listing={editing === 'new' ? null : editing}
      onDone={(saved) => {
        setNotice(saved ? { ...saved, text: saved.status === 'published' ? `"${saved.title}" está publicada.` : `Borrador "${saved.title}" guardado.` } : null);
        setEditing(null); load();
      }} />;

  async function remove(l: any) {
    if (!confirm(`¿Eliminar "${l.title}"?`)) return;
    // Pausar primero para que el guard de "última foto" no bloquee el borrado en cascada
    if (l.status === 'published') await supabase.from('listings').update({ status: 'paused' }).eq('id', l.id);
    const { error } = await supabase.from('listings').delete().eq('id', l.id);
    if (error) return alert(error.message);
    // Las filas ya no existen: borra los archivos de Storage para no dejar huérfanos
    await Promise.allSettled((l.listing_images ?? []).map((i: Img) => removeImage('listing-images', i.url)));
    setNotice({ text: `"${l.title}" se eliminó.` });
    load();
  }

  async function toggle(l: any) {
    const status = l.status === 'published' ? 'paused' : 'published';
    const { error } = await supabase.from('listings').update({ status }).eq('id', l.id);
    if (error) alert(error.message);
    load();
  }

  const badge: Record<string, string> = { published: 'bg-brand-50 text-brand-700', draft: 'bg-amber-50 text-amber-700', paused: 'bg-surface text-muted' };
  const label: Record<string, string> = { published: 'Publicado', draft: 'Borrador', paused: 'Pausado' };

  return (
    <div>
      <div className="mb-4 flex items-center justify-between">
        <h2 className="text-lg font-bold">Mis productos y servicios</h2>
        <button className="btn btn-primary" onClick={() => { setNotice(null); setEditing('new'); }}>+ Nueva publicación</button>
      </div>
      {notice && (
        <div role="status" className="mb-4 flex flex-wrap items-center justify-between gap-2 rounded-lg bg-brand-50 px-4 py-3 text-sm text-brand-700">
          <span>{notice.text}</span>
          <span className="flex items-center gap-3">
            {notice.slug && (notice as Saved).status === 'published' && <a href={`/p/${notice.slug}`} target="_blank" rel="noopener" className="font-semibold underline">Ver publicación</a>}
            <button type="button" aria-label="Cerrar aviso" className="text-lg leading-none" onClick={() => setNotice(null)}>×</button>
          </span>
        </div>
      )}
      {loading ? <p className="text-muted">Cargando…</p> : items.length === 0 ? (
        <div className="card p-10 text-center text-muted">Aún no tienes publicaciones. ¡Crea la primera!</div>
      ) : (
        <ul className="space-y-3">
          {items.map((l) => {
            const img = [...l.listing_images].sort((a: Img, b: Img) => a.position - b.position)[0]?.url;
            return (
              <li key={l.id} className="card flex flex-wrap items-center gap-3 p-3 sm:flex-nowrap sm:gap-4">
                <div className="h-16 w-20 shrink-0 overflow-hidden rounded-xl bg-surface">{img && <img src={img} alt="" className={`h-full w-full object-cover ${l.availability === 'sold_out' ? 'opacity-50 grayscale' : ''}`} />}</div>
                <div className="min-w-0 flex-1">
                  <p className="line-clamp-2 font-semibold sm:truncate">{l.title}</p>
                  <p className="text-sm text-muted">{formatPrice(l.price)} · <span className={`rounded-full px-2 py-0.5 text-xs ${badge[l.status]}`}>{label[l.status]}</span>
                    {l.availability && l.availability !== 'available' && <span className="ml-1 rounded-full bg-surface px-2 py-0.5 text-xs">{AVAILABILITY[l.availability]}</span>}</p>
                </div>
                <div className="flex w-full flex-wrap items-center gap-2 sm:w-auto sm:flex-nowrap">
                {l.status === 'published' && <a href={`/p/${l.slug}`} target="_blank" className="btn btn-ghost hidden sm:inline-flex">Ver</a>}
                {l.status === 'published' && (
                  <ShareMenu data={{
                    url: `${location.origin}/p/${l.slug}`,
                    title: l.title,
                    text: `${l.title} · ${formatPrice(l.price)}. Mira esta publicación en ${BRAND.name}:`,
                  }} />
                )}
                <button className="btn btn-ghost" onClick={() => toggle(l)}>{l.status === 'published' ? 'Pausar' : 'Publicar'}</button>
                <button className="btn btn-ghost" onClick={() => { setNotice(null); setEditing(l); }}>Editar</button>
                <button className="btn btn-ghost !text-red-600" onClick={() => remove(l)}>Borrar</button>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

function ListingForm({ userId, businessId, categories, listing, onDone }: {
  userId: string; businessId: string; categories: { id: number; name: string }[]; listing: any | null;
  onDone: (saved?: Saved) => void;
}) {
  const [f, setF] = useState({
    title: listing?.title ?? '',
    description: listing?.description ?? '',
    type: listing?.type ?? 'product',
    price: listing?.price?.toString() ?? '',
    category_id: listing?.category_id ?? '',
    availability: listing?.availability ?? 'available',
  });
  const [photos, setPhotos] = useState<Photo[]>(() =>
    [...(listing?.listing_images ?? [])].sort((a: Img, b: Img) => a.position - b.position)
      .map((i: Img) => ({ key: i.id, id: i.id, url: i.url, pos: i.position, state: 'saved' as const })));
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState('');
  const [error, setError] = useState('');
  const [live, setLive] = useState('');
  const [preview, setPreview] = useState(false);
  const [bizName, setBizName] = useState('Tu negocio');
  // Si el primer guardado crea la publicación pero algo falla después, el reintento la reutiliza
  const idRef = useRef<string | undefined>(listing?.id);
  const slugRef = useRef<string | undefined>(listing?.slug);
  const photosRef = useRef(photos);
  photosRef.current = photos;
  const set = (k: string, v: unknown) => setF((p) => ({ ...p, [k]: v }));
  const total = photos.length;
  const patch = (key: string, p: Partial<Photo>) => setPhotos((all) => all.map((x) => (x.key === key ? { ...x, ...p } : x)));

  useEffect(() => {
    supabase.from('businesses').select('name').eq('id', businessId).maybeSingle().then(({ data }) => { if (data?.name) setBizName(data.name); });
    // Libera las vistas previas locales al salir
    return () => photosRef.current.forEach((p) => { if (p.file) URL.revokeObjectURL(p.url); });
  }, [businessId]);

  useEffect(() => {
    if (!preview) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setPreview(false); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [preview]);

  function pick(list: FileList | null) {
    if (!list) return;
    const room = MAX_IMAGES - photos.length;
    const added: Photo[] = Array.from(list).filter((x) => x.type.startsWith('image/')).slice(0, room)
      .map((file) => ({ key: crypto.randomUUID(), url: URL.createObjectURL(file), file, state: 'pending' as const }));
    if (added.length < list.length) setError(`Solo se aceptan imágenes y hasta ${MAX_IMAGES} fotos por publicación.`);
    if (added.length) setPhotos((p) => [...p, ...added]);
  }

  function move(idx: number, to: number) {
    if (to < 0 || to >= photos.length) return;
    setPhotos((p) => { const n = [...p]; [n[idx], n[to]] = [n[to], n[idx]]; return n; });
    setLive(to === 0 ? `Foto ${idx + 1} ahora es la portada.` : `Foto movida a la posición ${to + 1}.`);
  }

  function makeCover(idx: number) {
    setPhotos((p) => [p[idx], ...p.filter((_, j) => j !== idx)]);
    setLive('La foto ahora es la portada.');
  }

  async function dropPhoto(p: Photo) {
    if (p.state !== 'saved') {
      if (p.file) URL.revokeObjectURL(p.url);
      return setPhotos((all) => all.filter((x) => x.key !== p.key));
    }
    if (listing?.status === 'published' && photos.length <= 1)
      return setError('Una publicación activa necesita al menos una foto. Agrega otra antes de borrar esta.');
    const { error } = await supabase.from('listing_images').delete().eq('id', p.id!);
    if (error) return setError(error.message);
    await removeImage('listing-images', p.url).catch(() => {});   // fila borrada: no dejar el archivo huérfano
    setPhotos((all) => all.filter((x) => x.key !== p.key));
  }

  async function save(e: SyntheticEvent, publish: boolean) {
    e.preventDefault();
    setError('');
    // "Publicar" es un botón type="button": no pasa por la validación nativa del formulario, se valida aquí
    const title = f.title.trim();
    if (title.length < 3 || title.length > 120) return setError('El título debe tener entre 3 y 120 caracteres.');
    if (f.price !== '' && (!Number.isFinite(Number(f.price)) || Number(f.price) < 0)) return setError('El precio no puede ser negativo.');
    if (publish && total === 0) return setError('Agrega al menos una foto para publicar.');
    setBusy(true);
    try {
      const row = {
        title,
        description: f.description.trim() || null,
        type: f.type,
        price: f.price === '' ? null : Number(f.price),
        category_id: f.category_id === '' ? null : Number(f.category_id),
        availability: f.availability,
      };
      let id = idRef.current;
      if (id) {
        const { error } = await supabase.from('listings').update(row).eq('id', id);
        if (error) throw error;
      } else {
        const { data, error } = await supabase.from('listings').insert({ ...row, business_id: businessId, status: 'draft' }).select('id,slug').single();
        if (error) throw error;
        id = idRef.current = data.id;
        slugRef.current = data.slug;
      }

      // Copia de trabajo: el orden final lo define la posición en este arreglo
      const work = photosRef.current.map((p) => ({ ...p }));
      const queue = work.filter((p) => p.file && p.state !== 'saved');
      let failed = 0, n = 0;
      for (const p of queue) {
        n++;
        setProgress(`Subiendo foto ${n} de ${queue.length}…`);
        patch(p.key, { state: 'uploading', error: undefined });
        let url: string | undefined;
        try {
          url = await uploadImage('listing-images', userId, p.file!, id);
          const { data, error } = await supabase.from('listing_images')
            .insert({ listing_id: id, url, position: work.indexOf(p) }).select('id').single();
          if (error) throw error;
          const done = { id: data.id, pos: work.indexOf(p), state: 'saved' as const, file: undefined, error: undefined };
          URL.revokeObjectURL(p.url);
          Object.assign(p, done, { url });
          patch(p.key, { ...done, url });
        } catch (err: any) {
          // Si el archivo llegó a Storage pero la fila no se guardó, bórralo
          if (url) await removeImage('listing-images', url).catch(() => {});
          const msg = err?.message ?? 'No se pudo subir.';
          p.state = 'error';
          patch(p.key, { state: 'error', error: msg });
          failed++;
        }
      }
      if (failed) throw new Error(`${failed === 1 ? 'Una foto no se pudo subir' : `${failed} fotos no se pudieron subir`}. Quítalas o reintenta; las demás ya quedaron guardadas.`);

      // Persiste el orden (la portada es la posición 0)
      setProgress('Guardando orden…');
      const changed = work.filter((p, i) => p.id && p.pos !== i);
      const results = await Promise.all(changed.map((p) => supabase.from('listing_images').update({ position: work.indexOf(p) }).eq('id', p.id!)));
      const bad = results.find((r) => r.error);
      if (bad?.error) throw bad.error;
      work.forEach((p, i) => patch(p.key, { pos: i }));

      if (publish) {
        const { error } = await supabase.from('listings').update({ status: 'published' }).eq('id', id!);
        if (error) throw error;
      }
      onDone({ title: row.title, slug: slugRef.current ?? '', status: publish ? 'published' : (listing?.status ?? 'draft') });
    } catch (err: any) {
      setError(err.message ?? 'No se pudo guardar.');
      setBusy(false);
      setProgress('');
    }
  }

  return (
    <form className="space-y-6" onSubmit={(e) => save(e, listing?.status === 'published')}>
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-bold">{listing ? 'Editar publicación' : 'Nueva publicación'}</h2>
        <button type="button" className="btn btn-ghost" onClick={() => onDone()}>← Volver</button>
      </div>
      <section className="card space-y-4 p-6">
        <div className="grid gap-4 sm:grid-cols-2">
          <div><label className="label" htmlFor="lf-type">Tipo</label>
            <select id="lf-type" className="input" value={f.type} onChange={(e) => set('type', e.target.value)}>
              <option value="product">Producto</option><option value="service">Servicio</option></select></div>
          <div><label className="label" htmlFor="lf-cat">Categoría</label>
            <select id="lf-cat" className="input" value={f.category_id} onChange={(e) => set('category_id', e.target.value)}>
              <option value="">Selecciona…</option>
              {categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select></div>
        </div>
        <div><label className="label" htmlFor="lf-title">Título *</label>
          <input id="lf-title" className="input" required minLength={3} maxLength={120} value={f.title} onChange={(e) => set('title', e.target.value)} placeholder="Ej. Pastel de chocolate para 20 personas" /></div>
        <div><label className="label" htmlFor="lf-desc">Descripción</label>
          <textarea id="lf-desc" className="input min-h-32" value={f.description} onChange={(e) => set('description', e.target.value)} /></div>
        <div className="grid gap-4 sm:grid-cols-2">
          <div><label className="label" htmlFor="lf-price">Precio (MXN)</label>
            <input id="lf-price" className="input" type="number" min="0" step="0.01" value={f.price} onChange={(e) => set('price', e.target.value)} placeholder="Vacío = Consultar" /></div>
          <div><label className="label" htmlFor="lf-avail">Disponibilidad</label>
            <select id="lf-avail" className="input" value={f.availability} onChange={(e) => set('availability', e.target.value)}>
              <option value="available">Disponible</option><option value="on_demand">Sobre pedido</option><option value="sold_out">Agotado</option></select></div>
        </div>
      </section>

      <section className="card space-y-3 p-6">
        <div><h3 className="font-bold">Fotos * <span className="text-sm font-normal text-muted">({total}/{MAX_IMAGES}) — al menos 1 para publicar; la primera es la portada</span></h3></div>
        <ul className="flex flex-wrap gap-3">
          {photos.map((p, idx) => (
            <li key={p.key} className={`w-28 ${p.state === 'error' ? 'text-red-700' : ''}`}>
              <div className={`relative h-24 w-28 overflow-hidden rounded-xl border ${p.state === 'error' ? 'border-red-500' : p.file ? 'border-brand-500' : 'border-line'}`}>
                <img src={p.url} alt={`Foto ${idx + 1}${idx === 0 ? ' (portada)' : ''}`} className={`h-full w-full object-cover ${p.state === 'uploading' ? 'opacity-50' : ''}`} />
                {idx === 0 && <span className="absolute left-1 top-1 rounded-full bg-brand-600 px-2 py-0.5 text-[11px] font-semibold text-white">Portada</span>}
                {p.state === 'uploading' && <span className="absolute inset-0 grid place-items-center bg-white/60 text-xs font-medium text-ink">Subiendo…</span>}
                <button type="button" aria-label={`Quitar foto ${idx + 1}`} disabled={busy} onClick={() => dropPhoto(p)} className="absolute right-1 top-1 rounded-full bg-black/60 px-2 text-white disabled:opacity-50">×</button>
              </div>
              <div className="mt-1 flex items-center justify-between gap-1">
                <button type="button" aria-label={`Mover foto ${idx + 1} a la izquierda`} disabled={busy || idx === 0} onClick={() => move(idx, idx - 1)} className="btn btn-ghost !px-2 !py-1 disabled:opacity-30">◀</button>
                <button type="button" aria-label={`Mover foto ${idx + 1} a la derecha`} disabled={busy || idx === photos.length - 1} onClick={() => move(idx, idx + 1)} className="btn btn-ghost !px-2 !py-1 disabled:opacity-30">▶</button>
              </div>
              {idx > 0 && <button type="button" disabled={busy} onClick={() => makeCover(idx)} className="mt-0.5 w-full text-xs font-medium text-brand-700 underline disabled:opacity-50">Hacer portada</button>}
              {p.state === 'pending' && <p className="mt-0.5 text-xs text-muted">Por subir</p>}
              {p.state === 'error' && <p role="alert" className="mt-0.5 text-xs">{p.error}</p>}
            </li>
          ))}
          {total < MAX_IMAGES && (
            <li className="flex gap-2">
              <label className="grid h-24 w-28 cursor-pointer place-items-center rounded-xl border-2 border-dashed border-line text-center text-sm text-muted focus-within:ring-2 focus-within:ring-brand-500 hover:border-brand-500 hover:text-brand-700">
                + Agregar
                <input type="file" accept="image/*" multiple className="sr-only" onChange={(e) => { pick(e.target.files); e.target.value = ''; }} />
              </label>
              {/* En celular abre directamente la cámara trasera */}
              <label className="grid h-24 w-28 cursor-pointer place-items-center rounded-xl border-2 border-dashed border-line text-center text-sm text-muted focus-within:ring-2 focus-within:ring-brand-500 hover:border-brand-500 hover:text-brand-700 sm:hidden">
                Tomar foto
                <input type="file" accept="image/*" capture="environment" className="sr-only" onChange={(e) => { pick(e.target.files); e.target.value = ''; }} />
              </label>
            </li>
          )}
        </ul>
        <p className="sr-only" role="status" aria-live="polite">{live}</p>
      </section>

      {error && <p role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
      {busy && progress && <p role="status" className="text-sm text-muted">{progress}</p>}
      <div className="flex flex-wrap gap-3">
        {listing?.status === 'published' ? (
          <button className="btn btn-primary" disabled={busy}>{busy ? 'Guardando…' : 'Guardar cambios'}</button>
        ) : (
          <>
            <button type="button" className="btn btn-primary" disabled={busy} onClick={(e) => save(e, true)}>{busy ? 'Guardando…' : 'Publicar'}</button>
            <button className="btn btn-ghost" disabled={busy}>Guardar borrador</button>
          </>
        )}
        <button type="button" className="btn btn-outline" onClick={() => setPreview(true)}>Vista previa</button>
      </div>

      {preview && <PreviewModal f={f} cover={photos[0]?.url} images={photos.map((p) => p.url)} bizName={bizName} onClose={() => setPreview(false)} />}
    </form>
  );
}

/** Replica visual de ListingCard.astro y de la ficha p/[slug].astro con los datos aún sin guardar. */
function PreviewModal({ f, cover, images, bizName, onClose }: {
  f: { title: string; type: string; price: string; availability: string; description: string };
  cover?: string; images: string[]; bizName: string; onClose: () => void;
}) {
  const soldOut = f.availability === 'sold_out';
  const onDemand = f.availability === 'on_demand';
  const title = f.title.trim() || 'Título de tu publicación';
  const price = f.price === '' ? null : Number(f.price);
  const closeRef = useRef<HTMLButtonElement>(null);
  useEffect(() => { closeRef.current?.focus(); }, []);
  const badges = (
    <>
      {soldOut && <span className="rounded-full bg-gray-900/80 px-2.5 py-1 text-xs font-semibold text-white">Agotado</span>}
      {onDemand && <span className="rounded-full bg-amber-100 px-2.5 py-1 text-xs font-semibold text-amber-800">Sobre pedido</span>}
    </>
  );

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/50 p-4" onClick={onClose}>
      <div role="dialog" aria-modal="true" aria-label="Vista previa de la publicación" className="max-h-full w-full max-w-3xl overflow-y-auto rounded-2xl bg-white p-5" onClick={(e) => e.stopPropagation()}>
        <div className="mb-4 flex items-center justify-between">
          <h3 className="font-bold">Vista previa</h3>
          <button ref={closeRef} type="button" className="btn btn-ghost" onClick={onClose}>Cerrar</button>
        </div>
        <div className="grid gap-6 md:grid-cols-[16rem_1fr]">
          <div>
            <p className="label">Así se ve en la tienda y en Explorar</p>
            <div className="card overflow-hidden">
              <div className="relative aspect-[4/3] overflow-hidden bg-surface">
                {cover ? <img src={cover} alt="" className={`h-full w-full object-cover ${soldOut ? 'opacity-50 grayscale' : ''}`} />
                  : <span className="grid h-full place-items-center text-sm text-muted">Sin foto</span>}
                {(soldOut || onDemand) && <span className="absolute left-2 top-2">{badges}</span>}
              </div>
              <div className="p-4">
                <p className="line-clamp-2 font-semibold leading-snug">{title}</p>
                <p className="mt-1 text-lg font-bold text-brand-700">{formatPrice(price)}</p>
                <p className="mt-2 truncate text-xs text-muted">{bizName}
                  {f.type === 'service' && <span className="ml-1 rounded-full bg-brand-50 px-2 py-0.5 text-brand-700">Servicio</span>}</p>
              </div>
            </div>
          </div>
          <div>
            <p className="label">Así se ve la ficha</p>
            <div className="card p-5">
              {cover && <img src={cover} alt="" className={`mb-2 aspect-[4/3] w-full rounded-xl object-cover ${soldOut ? 'opacity-50 grayscale' : ''}`} />}
              {images.length > 1 && <div className="mb-3 flex gap-2 overflow-x-auto">{images.slice(1).map((u, i) => <img key={i} src={u} alt="" className="h-14 w-16 shrink-0 rounded-lg object-cover" />)}</div>}
              <span className="rounded-full bg-brand-50 px-2.5 py-1 text-xs font-semibold text-brand-700">{f.type === 'service' ? 'Servicio' : 'Producto'}</span>
              <span className="ml-2">{badges}</span>
              <h4 className="mt-3 text-xl font-bold leading-tight">{title}</h4>
              <p className="mt-1 text-2xl font-extrabold text-brand-700">{formatPrice(price)}</p>
              <span className="btn btn-wa mt-4 w-full">{soldOut ? 'Preguntar cuándo habrá' : 'Contactar por WhatsApp'}</span>
              {f.description.trim() && <p className="mt-4 line-clamp-4 whitespace-pre-line text-sm text-muted">{f.description}</p>}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
