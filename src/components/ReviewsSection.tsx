import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import { LoadingState } from './Loading';
import { supabase } from '../lib/supabase';

const PAGE = 10;
const MAX = 600;
const REASONS = ['Contenido ofensivo', 'Reseña falsa o spam', 'Datos personales', 'Otro'];

type Summary = {
  avg_rating: number | null; review_count: number;
  star_1: number; star_2: number; star_3: number; star_4: number; star_5: number;
};
type Review = {
  id: string; rating: number; body: string | null; owner_reply: string | null;
  replied_at: string | null; created_at: string; author_name: string;
};
type Mine = {
  id: string; rating: number; body: string | null; status: 'visible' | 'hidden';
  owner_reply: string | null; replied_at: string | null; created_at: string;
};
type DbError = { code?: string; message: string };

/** 4.5 -> "4,5" */
const fmt = (n: number) => n.toFixed(1).replace('.', ',');
const fmtDate = (iso: string) => new Date(iso).toLocaleDateString('es-MX', { year: 'numeric', month: 'long', day: 'numeric' });

/** Los errores de reglas de negocio (check/permiso) vienen en español desde la base; el resto se generaliza. */
function friendly(error: DbError, fallback: string) {
  if (error.code === '23505') return 'Ya dejaste una reseña en este negocio. Puedes editarla.';
  if (error.code === '23514' || error.code === '42501') return error.message;
  return fallback;
}

const STAR_PATH = 'M12 2.5l2.94 5.96 6.58.96-4.76 4.64 1.12 6.55L12 17.52l-5.88 3.09 1.12-6.55L2.48 9.42l6.58-.96L12 2.5z';

function StarShape({ className }: { className: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} fill="currentColor" aria-hidden="true"><path d={STAR_PATH} /></svg>
  );
}

/** Estrellas de solo lectura, con relleno parcial. Se anuncia como "4,5 de 5". */
function Stars({ value, size = 'h-5 w-5' }: { value: number; size?: string }) {
  const pct = Math.max(0, Math.min(5, value)) / 5 * 100;
  const row = (cls: string) => Array.from({ length: 5 }, (_, i) => <StarShape key={i} className={`${size} shrink-0 ${cls}`} />);
  return (
    <span role="img" aria-label={`${fmt(value)} de 5`} className="relative inline-flex">
      <span className="inline-flex text-gray-300" aria-hidden="true">{row('')}</span>
      <span className="absolute inset-y-0 left-0 inline-flex overflow-hidden text-accent" style={{ width: `${pct}%` }} aria-hidden="true">{row('')}</span>
    </span>
  );
}

/** Selector de calificación con radios nativos (teclado: flechas). */
function StarInput({ value, onChange, name }: { value: number; onChange: (n: number) => void; name: string }) {
  return (
    <div role="radiogroup" aria-label="Tu calificación" className="inline-flex gap-1">
      {[1, 2, 3, 4, 5].map((n) => (
        <label key={n} className="cursor-pointer">
          <input type="radio" name={name} className="peer sr-only" checked={value === n} onChange={() => onChange(n)} required />
          <span className="sr-only">{n} {n === 1 ? 'estrella' : 'estrellas'}</span>
          <StarShape className={`h-9 w-9 rounded transition peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-brand-600 ${n <= value ? 'text-accent' : 'text-gray-300 hover:text-amber-300'}`} />
        </label>
      ))}
    </div>
  );
}

function ReportReview({ reviewId, onClose }: { reviewId: string; onClose: () => void }) {
  const [reason, setReason] = useState(REASONS[0]);
  const [details, setDetails] = useState('');
  const [sending, setSending] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState('');
  const ref = useRef<HTMLDivElement>(null);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;

  useEffect(() => {
    const root = ref.current!;
    const focusable = () => Array.from(root.querySelectorAll<HTMLElement>('button, select, textarea')).filter((el) => !el.hasAttribute('disabled'));
    focusable()[0]?.focus();
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') { closeRef.current(); return; }
      if (e.key !== 'Tab') return;
      const els = focusable();
      if (!els.length) return;
      const first = els[0], last = els[els.length - 1];
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    }
    document.addEventListener('keydown', onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.removeEventListener('keydown', onKey); document.body.style.overflow = prev; };
  }, [done]);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (sending) return;
    setSending(true); setError('');
    const { error } = await supabase.from('reports').insert({ review_id: reviewId, reason, details: details.trim() || null });
    setSending(false);
    if (error) { setError('No pudimos enviar tu reporte. Inténtalo de nuevo en un rato.'); return; }
    setDone(true);
  }

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/40 p-4" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div ref={ref} role="dialog" aria-modal="true" aria-labelledby="rvrep-title" className="card w-full max-w-md p-6">
        {done ? (
          <div className="text-center">
            <h2 id="rvrep-title" className="text-lg font-bold">Gracias por avisarnos</h2>
            <p className="mt-2 text-sm text-muted">Revisaremos tu reporte lo antes posible.</p>
            <button type="button" className="btn btn-primary mt-5 w-full" onClick={onClose}>Cerrar</button>
          </div>
        ) : (
          <form onSubmit={submit}>
            <h2 id="rvrep-title" className="text-lg font-bold">Reportar esta reseña</h2>
            <p className="mt-1 text-sm text-muted">Cuéntanos qué está mal. Tu reporte es anónimo.</p>
            <label className="label mt-4" htmlFor="rvrep-reason">Motivo</label>
            <select id="rvrep-reason" className="input" value={reason} onChange={(e) => setReason(e.target.value)}>
              {REASONS.map((r) => <option key={r}>{r}</option>)}
            </select>
            <label className="label mt-4" htmlFor="rvrep-details">Detalles (opcional)</label>
            <textarea id="rvrep-details" className="input" rows={4} maxLength={1000} value={details} onChange={(e) => setDetails(e.target.value)} placeholder="Ayúdanos con más contexto" />
            {error && <p role="alert" className="mt-3 text-sm text-red-700">{error}</p>}
            <div className="mt-5 flex justify-end gap-2">
              <button type="button" className="btn btn-ghost" onClick={onClose}>Cancelar</button>
              <button type="submit" className="btn btn-primary" disabled={sending} aria-busy={sending}>{sending ? 'Enviando…' : 'Enviar reporte'}</button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}

function Counter({ n }: { n: number }) {
  return <span className={`text-xs ${n >= MAX ? 'font-semibold text-red-700' : 'text-muted'}`}>{n}/{MAX}</span>;
}

function ReviewCard({ r, isOwner, onReplied }: { r: Review; isOwner: boolean; onReplied: () => void }) {
  const [reporting, setReporting] = useState(false);
  const [replying, setReplying] = useState(false);
  const [reply, setReply] = useState('');
  const [sending, setSending] = useState(false);
  const [error, setError] = useState('');
  const triggerRef = useRef<HTMLButtonElement>(null);

  async function sendReply(e: FormEvent) {
    e.preventDefault();
    if (sending || !reply.trim()) return;
    setSending(true); setError('');
    const { error } = await supabase.rpc('reply_to_review', { p_review: r.id, p_reply: reply.trim() });
    setSending(false);
    if (error) { setError(friendly(error, 'No pudimos publicar tu respuesta. Inténtalo de nuevo.')); return; }
    setReplying(false);
    onReplied();
  }

  return (
    <li className="card p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <Stars value={r.rating} size="h-4 w-4" />
          <span className="text-sm font-semibold">{r.author_name}</span>
        </div>
        <time className="text-xs text-muted" dateTime={r.created_at}>{fmtDate(r.created_at)}</time>
      </div>
      {r.body && <p className="mt-2 whitespace-pre-line break-words text-sm">{r.body}</p>}

      {r.owner_reply && (
        <div className="mt-3 rounded-xl bg-surface p-3 text-sm">
          <p className="text-xs font-semibold text-brand-700">Respuesta del negocio{r.replied_at ? ` · ${fmtDate(r.replied_at)}` : ''}</p>
          <p className="mt-1 whitespace-pre-line break-words">{r.owner_reply}</p>
        </div>
      )}

      {isOwner && !r.owner_reply && !replying && (
        <button type="button" className="btn btn-ghost mt-3 !px-3 !py-1.5" onClick={() => setReplying(true)}>Responder</button>
      )}
      {replying && (
        <form onSubmit={sendReply} className="mt-3">
          <label className="label" htmlFor={`rv-reply-${r.id}`}>Tu respuesta pública (solo puedes responder una vez)</label>
          <textarea id={`rv-reply-${r.id}`} className="input" rows={3} maxLength={MAX} value={reply} onChange={(e) => setReply(e.target.value)} required />
          <div className="mt-1 flex justify-end"><Counter n={reply.length} /></div>
          {error && <p role="alert" className="mt-2 text-sm text-red-700">{error}</p>}
          <div className="mt-3 flex justify-end gap-2">
            <button type="button" className="btn btn-ghost" onClick={() => setReplying(false)}>Cancelar</button>
            <button type="submit" className="btn btn-primary" disabled={sending || !reply.trim()}>{sending ? 'Publicando…' : 'Publicar respuesta'}</button>
          </div>
        </form>
      )}

      <div className="mt-3 text-right">
        <button ref={triggerRef} type="button" onClick={() => setReporting(true)}
          className="inline-flex items-center gap-1.5 text-xs text-muted underline-offset-2 hover:text-ink hover:underline focus-visible:outline-2 focus-visible:outline-brand-600">
          <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M5 21V4" /><path d="M5 4h12l-2 4 2 4H5" /></svg>
          Reportar<span className="sr-only"> reseña de {r.author_name}</span>
        </button>
      </div>
      {reporting && <ReportReview reviewId={r.id} onClose={() => { setReporting(false); triggerRef.current?.focus(); }} />}
    </li>
  );
}

export default function ReviewsSection({ businessId }: { businessId: string }) {
  const [uid, setUid] = useState<string | null | undefined>(undefined); // undefined = comprobando sesión
  const [isOwner, setIsOwner] = useState(false);
  const [summary, setSummary] = useState<Summary | null>(null);
  const [items, setItems] = useState<Review[]>([]);
  const [hasMore, setHasMore] = useState(false);
  const [mine, setMine] = useState<Mine | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState('');
  const [editing, setEditing] = useState(false);
  const [rating, setRating] = useState(0);
  const [body, setBody] = useState('');
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState('');
  const [confirmDel, setConfirmDel] = useState(false);
  const [notice, setNotice] = useState('');
  const seq = useRef(0);

  const load = useCallback(async (userId: string | null) => {
    const id = ++seq.current;
    setError('');
    const [sum, list, own, biz] = await Promise.all([
      supabase.rpc('business_rating_summary', { p_business: businessId }),
      supabase.rpc('list_business_reviews', { p_business: businessId, p_limit: PAGE + 1, p_offset: 0, p_exclude_mine: true }),
      userId
        ? supabase.from('reviews').select('id,rating,body,status,owner_reply,replied_at,created_at').eq('business_id', businessId).eq('user_id', userId).maybeSingle()
        : Promise.resolve({ data: null, error: null }),
      userId
        ? supabase.from('businesses').select('id').eq('id', businessId).eq('owner_id', userId).maybeSingle()
        : Promise.resolve({ data: null, error: null }),
    ]);
    if (id !== seq.current) return;
    if (sum.error || list.error) { setError('No pudimos cargar las reseñas.'); setLoading(false); return; }
    const rows = (list.data ?? []) as Review[];
    setSummary(((sum.data ?? [])[0] as Summary | undefined) ?? null);
    setItems(rows.slice(0, PAGE));
    setHasMore(rows.length > PAGE);
    setMine((own.data as Mine | null) ?? null);
    setIsOwner(!!biz.data);
    setLoading(false);
  }, [businessId]);

  useEffect(() => {
    let alive = true;
    supabase.auth.getSession().then(({ data }) => {
      if (!alive) return;
      const u = data.session?.user.id ?? null;
      setUid(u);
      load(u);
    });
    return () => { alive = false; };
  }, [load]);

  async function loadMore() {
    if (loadingMore) return;
    setLoadingMore(true);
    const { data, error } = await supabase.rpc('list_business_reviews', { p_business: businessId, p_limit: PAGE + 1, p_offset: items.length, p_exclude_mine: true });
    setLoadingMore(false);
    if (error) { setError('No pudimos cargar más reseñas.'); return; }
    const rows = (data ?? []) as Review[];
    setItems((prev) => [...prev, ...rows.slice(0, PAGE)]);
    setHasMore(rows.length > PAGE);
  }

  function startEdit() {
    if (!mine) return;
    setRating(mine.rating); setBody(mine.body ?? ''); setFormError(''); setEditing(true);
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (saving || !uid) return;
    if (rating < 1) { setFormError('Elige una calificación de 1 a 5 estrellas.'); return; }
    setSaving(true); setFormError('');
    const text = body.trim() || null;
    const { error } = mine
      ? await supabase.from('reviews').update({ rating, body: text }).eq('id', mine.id)
      : await supabase.from('reviews').insert({ business_id: businessId, user_id: uid, rating, body: text });
    setSaving(false);
    if (error) { setFormError(friendly(error, 'No pudimos guardar tu reseña. Inténtalo de nuevo.')); return; }
    setNotice(mine ? 'Reseña actualizada.' : '¡Gracias por tu reseña!');
    setEditing(false); setRating(0); setBody('');
    load(uid);
  }

  async function remove() {
    if (!mine || !uid) return;
    setSaving(true); setFormError('');
    const { error } = await supabase.from('reviews').delete().eq('id', mine.id);
    setSaving(false);
    if (error) { setFormError('No pudimos eliminar tu reseña. Inténtalo de nuevo.'); return; }
    setConfirmDel(false); setNotice('Tu reseña fue eliminada.');
    load(uid);
  }

  const count = summary?.review_count ?? 0;
  const dist = summary ? [summary.star_5, summary.star_4, summary.star_3, summary.star_2, summary.star_1] : [];

  const form = (
    <form onSubmit={submit} className="card p-4">
      <h3 className="font-bold">{mine ? 'Edita tu reseña' : 'Deja tu reseña'}</h3>
      <div className="mt-3"><StarInput value={rating} onChange={setRating} name="rv-rating" /></div>
      <label className="label mt-4" htmlFor="rv-body">Comentario (opcional)</label>
      <textarea id="rv-body" className="input" rows={4} maxLength={MAX} value={body} onChange={(e) => setBody(e.target.value)}
        placeholder="Cuenta cómo fue tu experiencia con este negocio" />
      <div className="mt-1 flex justify-end"><Counter n={body.length} /></div>
      {formError && <p role="alert" className="mt-2 text-sm text-red-700">{formError}</p>}
      <div className="mt-3 flex justify-end gap-2">
        {mine && <button type="button" className="btn btn-ghost" onClick={() => setEditing(false)}>Cancelar</button>}
        <button type="submit" className="btn btn-primary" disabled={saving} aria-busy={saving}>{saving ? 'Guardando…' : mine ? 'Guardar cambios' : 'Publicar reseña'}</button>
      </div>
    </form>
  );

  return (
    <section id="resenas" aria-labelledby="rv-title" className="mt-10 scroll-mt-20">
      <h2 id="rv-title" className="text-lg font-bold">Reseñas{count > 0 ? ` (${count})` : ''}</h2>

      <div role="status" aria-live="polite" className="empty:hidden">
        {notice && <p className="mt-3 rounded-xl bg-brand-50 px-4 py-3 text-sm font-medium text-brand-700">{notice}</p>}
      </div>

      {loading ? (
        <LoadingState label="Cargando reseñas…" className="!justify-start !py-4" />
      ) : error && !summary ? (
        <div className="mt-3 card p-4" role="alert">
          <p className="text-sm text-red-700">{error}</p>
          <button type="button" className="btn btn-ghost mt-3" onClick={() => { setLoading(true); load(uid ?? null); }}>Reintentar</button>
        </div>
      ) : (
        <>
          {count > 0 && summary?.avg_rating != null && (
            <div className="mt-4 card flex flex-col gap-5 p-4 sm:flex-row sm:items-center">
              <div className="text-center sm:w-40">
                <p className="text-4xl font-extrabold">{fmt(summary.avg_rating)}</p>
                <div className="mt-1 flex justify-center"><Stars value={summary.avg_rating} /></div>
                <p className="mt-1 text-sm text-muted">{count} {count === 1 ? 'reseña' : 'reseñas'}</p>
              </div>
              <ul className="flex-1 space-y-1.5" aria-label="Distribución de calificaciones">
                {dist.map((n, i) => (
                  <li key={i} className="flex items-center gap-2 text-sm">
                    <span className="w-14 shrink-0 text-muted">{5 - i} {5 - i === 1 ? 'estrella' : 'estrellas'}</span>
                    <span className="h-2 flex-1 overflow-hidden rounded-full bg-surface" aria-hidden="true">
                      <span className="block h-full rounded-full bg-accent" style={{ width: `${count ? (n / count) * 100 : 0}%` }} />
                    </span>
                    <span className="w-8 shrink-0 text-right text-muted">{n}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          <div className="mt-4 space-y-3">
            {uid === undefined ? null : uid === null ? (
              <div className="card p-4 text-sm">
                <p><a href="/ingresar" className="font-semibold text-brand-700 hover:underline">Inicia sesión</a> o <a href="/registro" className="font-semibold text-brand-700 hover:underline">crea una cuenta</a> para dejar tu reseña.</p>
              </div>
            ) : isOwner ? (
              <p className="card p-4 text-sm text-muted">Este es tu negocio: no puedes reseñarlo, pero sí responder a cada reseña una vez.</p>
            ) : editing || !mine ? form : (
              <div className="card border-brand-200 p-4">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="text-sm font-semibold">Tu reseña</p>
                  <time className="text-xs text-muted" dateTime={mine.created_at}>{fmtDate(mine.created_at)}</time>
                </div>
                <div className="mt-1"><Stars value={mine.rating} size="h-4 w-4" /></div>
                {mine.body && <p className="mt-2 whitespace-pre-line break-words text-sm">{mine.body}</p>}
                {mine.status === 'hidden' && (
                  <p className="mt-2 rounded-xl bg-amber-50 p-3 text-sm text-amber-900">Un moderador ocultó tu reseña: solo tú la ves.</p>
                )}
                {mine.owner_reply && (
                  <div className="mt-3 rounded-xl bg-surface p-3 text-sm">
                    <p className="text-xs font-semibold text-brand-700">Respuesta del negocio</p>
                    <p className="mt-1 whitespace-pre-line break-words">{mine.owner_reply}</p>
                  </div>
                )}
                {formError && <p role="alert" className="mt-2 text-sm text-red-700">{formError}</p>}
                {confirmDel ? (
                  <div className="mt-3 flex flex-wrap items-center gap-2 text-sm" role="alert">
                    <span>¿Eliminar tu reseña?</span>
                    <button type="button" className="btn btn-primary !bg-red-600 !px-3 !py-1.5 hover:!bg-red-700" disabled={saving} onClick={remove}>Sí, eliminar</button>
                    <button type="button" className="btn btn-ghost !px-3 !py-1.5" onClick={() => setConfirmDel(false)}>Cancelar</button>
                  </div>
                ) : (
                  <div className="mt-3 flex gap-2">
                    <button type="button" className="btn btn-ghost !px-3 !py-1.5" onClick={startEdit}>Editar</button>
                    <button type="button" className="btn btn-ghost !px-3 !py-1.5 !text-red-700" onClick={() => setConfirmDel(true)}>Eliminar</button>
                  </div>
                )}
              </div>
            )}
          </div>

          {count === 0 && !mine ? (
            <p className="mt-4 text-muted">Sé el primero en dejar una reseña de este negocio.</p>
          ) : items.length > 0 && (
            <ul className="mt-4 space-y-3">
              {items.map((r) => <ReviewCard key={r.id} r={r} isOwner={isOwner} onReplied={() => load(uid ?? null)} />)}
            </ul>
          )}

          {error && <p role="alert" className="mt-3 text-sm text-red-700">{error}</p>}
          {hasMore && (
            <div className="mt-4 text-center">
              <button type="button" className="btn btn-ghost" disabled={loadingMore} aria-busy={loadingMore} onClick={loadMore}>{loadingMore ? 'Cargando…' : 'Ver más reseñas'}</button>
            </div>
          )}
        </>
      )}
    </section>
  );
}
