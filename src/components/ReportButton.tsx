import { useEffect, useRef, useState, type FormEvent } from 'react';
import { supabase } from '../lib/supabase';

const REASONS = ['Contenido inapropiado', 'Estafa o engaño', 'Producto prohibido', 'Información falsa', 'Otro'];

type Props = { listingId?: string; businessId?: string; label?: string };

export default function ReportButton({ listingId, businessId, label = 'Reportar' }: Props) {
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState(REASONS[0]);
  const [details, setDetails] = useState('');
  const [sending, setSending] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState('');
  const dialogRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);

  function close() {
    setOpen(false);
    triggerRef.current?.focus();
  }

  // Foco inicial, cierre con Escape y foco atrapado dentro del modal
  useEffect(() => {
    if (!open) return;
    const root = dialogRef.current!;
    const focusable = () => Array.from(root.querySelectorAll<HTMLElement>('button, select, textarea, a[href]')).filter((el) => !el.hasAttribute('disabled'));
    focusable()[0]?.focus();
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') { close(); return; }
      if (e.key !== 'Tab') return;
      const els = focusable();
      if (els.length === 0) return;
      const first = els[0], last = els[els.length - 1];
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    }
    document.addEventListener('keydown', onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.removeEventListener('keydown', onKey); document.body.style.overflow = prev; };
  }, [open]);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (sending || done) return;
    setSending(true);
    setError('');
    const { error } = await supabase.from('reports').insert({
      listing_id: listingId ?? null,
      business_id: listingId ? null : businessId ?? null,
      reason,
      details: details.trim() || null,
    });
    setSending(false);
    if (error) { setError('No pudimos enviar tu reporte. Inténtalo de nuevo en un rato.'); return; }
    setDone(true);
  }

  return (
    <>
      <button ref={triggerRef} type="button" onClick={() => { setOpen(true); setDone(false); setError(''); }}
        className="inline-flex items-center gap-1.5 text-xs text-muted underline-offset-2 hover:text-ink hover:underline focus-visible:outline-2 focus-visible:outline-brand-600">
        <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M5 21V4" /><path d="M5 4h12l-2 4 2 4H5" />
        </svg>
        {label}
      </button>

      {open && (
        <div className="fixed inset-0 z-50 grid place-items-center bg-black/40 p-4" onMouseDown={(e) => { if (e.target === e.currentTarget) close(); }}>
          <div ref={dialogRef} role="dialog" aria-modal="true" aria-labelledby="report-title" className="card w-full max-w-md p-6">
            {done ? (
              <div className="text-center">
                <h2 id="report-title" className="text-lg font-bold">Gracias por avisarnos</h2>
                <p className="mt-2 text-sm text-muted">Revisaremos tu reporte lo antes posible.</p>
                <button type="button" className="btn btn-primary mt-5 w-full" onClick={close}>Cerrar</button>
              </div>
            ) : (
              <form onSubmit={submit}>
                <h2 id="report-title" className="text-lg font-bold">{listingId ? 'Reportar esta publicación' : 'Reportar este negocio'}</h2>
                <p className="mt-1 text-sm text-muted">Cuéntanos qué está mal. Tu reporte es anónimo para el vendedor.</p>
                <label className="label mt-4" htmlFor="report-reason">Motivo</label>
                <select id="report-reason" className="input" value={reason} onChange={(e) => setReason(e.target.value)}>
                  {REASONS.map((r) => <option key={r}>{r}</option>)}
                </select>
                <label className="label mt-4" htmlFor="report-details">Detalles (opcional)</label>
                <textarea id="report-details" className="input" rows={4} maxLength={1000} value={details}
                  onChange={(e) => setDetails(e.target.value)} placeholder="Ayúdanos con más contexto" />
                {error && <p role="alert" className="mt-3 text-sm text-red-600">{error}</p>}
                <div className="mt-5 flex justify-end gap-2">
                  <button type="button" className="btn btn-ghost" onClick={close}>Cancelar</button>
                  <button type="submit" className="btn btn-primary" disabled={sending} aria-busy={sending}>{sending ? 'Enviando…' : 'Enviar reporte'}</button>
                </div>
              </form>
            )}
          </div>
        </div>
      )}
    </>
  );
}
