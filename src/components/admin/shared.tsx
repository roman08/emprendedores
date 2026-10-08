import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { supabase } from '../../lib/supabase';

export const PAGE_SIZE = 25;

/** Escapa los comodines de LIKE y quita los caracteres con significado en la sintaxis de .or() de PostgREST. */
export function likeTerm(raw: string) {
  return raw.trim().slice(0, 80).replace(/[,()"'\\]/g, ' ').replace(/[%_]/g, (c) => '\\' + c).replace(/\s+/g, ' ').trim();
}

export function useDebounced<T>(value: T, ms = 300) {
  const [v, setV] = useState(value);
  useEffect(() => { const t = setTimeout(() => setV(value), ms); return () => clearTimeout(t); }, [value, ms]);
  return v;
}

type Result<T> = PromiseLike<{ data: T[] | null; count: number | null; error: { message: string } | null }>;

/**
 * Lista paginada en servidor. `run` recibe el rango (from, to) y debe devolver la consulta con count exact.
 * Al cambiar `filterKey` vuelve a la primera página; las respuestas viejas se descartan.
 */
export function usePaged<T>(run: (from: number, to: number) => Result<T>, filterKey: string, onError: (msg: string) => void) {
  const [state, setState] = useState({ key: filterKey, page: 0 });
  const page = state.key === filterKey ? state.page : 0;
  const setPage = useCallback((p: number) => setState({ key: filterKey, page: p }), [filterKey]);
  const [items, setItems] = useState<T[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [tick, setTick] = useState(0);
  const seq = useRef(0);
  const runRef = useRef(run);
  runRef.current = run;
  const errRef = useRef(onError);
  errRef.current = onError;

  useEffect(() => {
    const id = ++seq.current;
    setLoading(true);
    runRef.current(page * PAGE_SIZE, page * PAGE_SIZE + PAGE_SIZE - 1).then(({ data, count, error }) => {
      if (id !== seq.current) return;
      if (error) { errRef.current(error.message); setItems([]); setTotal(0); setLoading(false); return; }
      const n = count ?? 0;
      // Si se vació la última página (p. ej. tras borrar), retrocede
      if ((data ?? []).length === 0 && n > 0 && page > 0) { setPage(Math.ceil(n / PAGE_SIZE) - 1); return; }
      setItems(data ?? []); setTotal(n); setLoading(false);
    });
  }, [page, filterKey, tick, setPage]);

  const reload = useCallback(() => setTick((t) => t + 1), []);
  return { items, setItems, total, page, setPage, loading, reload };
}

export function Pagination({ page, total, onPage, loading }: { page: number; total: number; onPage: (p: number) => void; loading?: boolean }) {
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const from = total === 0 ? 0 : page * PAGE_SIZE + 1;
  const to = Math.min(total, (page + 1) * PAGE_SIZE);
  return (
    <nav aria-label="Paginación" className="mt-4 flex flex-wrap items-center justify-between gap-3 text-sm">
      <p className="text-muted" aria-live="polite">
        {total === 0 ? '0 resultados' : `Mostrando ${from}–${to} de ${total}`}
      </p>
      <div className="flex items-center gap-2">
        <button type="button" className="btn btn-ghost" disabled={loading || page === 0} onClick={() => onPage(page - 1)}>Anterior</button>
        <span className="text-muted">Página {page + 1} de {pages}</span>
        <button type="button" className="btn btn-ghost" disabled={loading || page + 1 >= pages} onClick={() => onPage(page + 1)}>Siguiente</button>
      </div>
    </nav>
  );
}

/** Aviso visible y anunciado a lector de pantalla (éxito o error). */
export function useNotice() {
  const [notice, setNotice] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const notify = useCallback((text: string, kind: 'ok' | 'error' = 'ok') => {
    setNotice({ kind, text });
    clearTimeout(timer.current);
    if (kind === 'ok') timer.current = setTimeout(() => setNotice(null), 6000);
  }, []);
  useEffect(() => () => clearTimeout(timer.current), []);
  const node = (
    <div role={notice?.kind === 'error' ? 'alert' : 'status'} aria-live={notice?.kind === 'error' ? 'assertive' : 'polite'} className="mb-4 empty:hidden">
      {notice && (
        <p className={`flex items-start justify-between gap-3 rounded-xl px-4 py-3 text-sm font-medium ${notice.kind === 'ok' ? 'bg-brand-50 text-brand-700' : 'bg-red-50 text-red-700'}`}>
          <span>{notice.text}</span>
          <button type="button" className="font-semibold underline" onClick={() => setNotice(null)}>Cerrar</button>
        </p>
      )}
    </div>
  );
  return { notify, node };
}

type ConfirmOpts = { title: string; body?: ReactNode; confirmLabel: string; danger?: boolean };

/** Modal de confirmación accesible (reemplaza window.confirm): foco atrapado, Esc cancela, devuelve el foco. */
export function useConfirm() {
  const [req, setReq] = useState<(ConfirmOpts & { resolve: (ok: boolean) => void }) | null>(null);
  const confirm = useCallback((opts: ConfirmOpts) => new Promise<boolean>((resolve) => setReq({ ...opts, resolve })), []);
  const close = (ok: boolean) => { req?.resolve(ok); setReq(null); };

  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!req) return;
    const prev = document.activeElement as HTMLElement | null;
    const box = ref.current!;
    const focusables = () => Array.from(box.querySelectorAll<HTMLElement>('button:not([disabled])'));
    focusables()[0]?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { e.preventDefault(); req.resolve(false); setReq(null); return; }
      if (e.key !== 'Tab') return;
      const f = focusables();
      if (!f.length) return;
      const first = f[0], last = f[f.length - 1];
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    };
    document.addEventListener('keydown', onKey);
    const overflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.removeEventListener('keydown', onKey); document.body.style.overflow = overflow; prev?.focus?.(); };
  }, [req]);

  const node = req && (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/50 p-4 sm:items-center" onMouseDown={(e) => { if (e.target === e.currentTarget) close(false); }}>
      <div ref={ref} role="alertdialog" aria-modal="true" aria-labelledby="adm-dlg-t" aria-describedby="adm-dlg-d" className="card w-full max-w-md bg-white p-6 shadow-xl">
        <h2 id="adm-dlg-t" className="text-lg font-extrabold">{req.title}</h2>
        <div id="adm-dlg-d" className="mt-2 text-sm text-muted">{req.body}</div>
        <div className="mt-6 flex flex-wrap justify-end gap-2">
          <button type="button" className="btn btn-ghost" onClick={() => close(false)}>Cancelar</button>
          <button type="button" className={`btn ${req.danger ? 'btn-primary !bg-red-600 hover:!bg-red-700' : 'btn-primary'}`} onClick={() => close(true)}>{req.confirmLabel}</button>
        </div>
      </div>
    </div>
  );
  return { confirm, node };
}

type Bucket = 'listing-images' | 'business-media';

/**
 * Extrae la ruta de objeto de una URL pública de Storage; null si no es de ese bucket.
 * Con ownerId solo devuelve rutas dentro de la carpeta de ese dueño: las URLs de logo/banner/fotos las escribe el dueño
 * y podrían apuntar a archivos de otra persona; el admin (que puede borrar cualquier objeto) no debe borrarlos.
 */
export function storagePath(bucket: Bucket, url: string | null | undefined, ownerId?: string | null) {
  if (!url) return null;
  const marker = `/${bucket}/`;
  const i = url.indexOf(marker);
  if (i === -1) return null;
  try {
    const path = decodeURIComponent(url.slice(i + marker.length).split('?')[0]);
    if (ownerId !== undefined && (!ownerId || path.split('/')[0] !== ownerId || path.includes('..'))) return null;
    return path;
  } catch { return null; }
}

/** Borra rutas de un bucket en lotes. Devuelve cuántos objetos se eliminaron (los ya inexistentes no cuentan ni fallan). */
export async function removePaths(bucket: Bucket, paths: string[]) {
  const unique = [...new Set(paths)];
  let removed = 0;
  for (let i = 0; i < unique.length; i += 100) {
    const { data, error } = await supabase.storage.from(bucket).remove(unique.slice(i, i + 100));
    if (error) throw error;
    removed += data?.length ?? 0;
  }
  return removed;
}

/** Imágenes de publicaciones (por ids) -> rutas del bucket listing-images. */
export async function listingImagePaths(listingIds: string[], ownerId?: string | null) {
  if (!listingIds.length) return [];
  const { data, error } = await supabase.from('listing_images').select('url').in('listing_id', listingIds);
  if (error) throw error;
  // Cada foto trae su miniatura (.t.webp); removePaths ignora las que no existan
  return (data ?? [])
    .map((r) => storagePath('listing-images', r.url, ownerId))
    .filter((p): p is string => !!p)
    .flatMap((p) => [p, p.replace(/\.webp$/, '.t.webp')]);
}

export function formatBytes(n: number) {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(2)} MB`;
}
