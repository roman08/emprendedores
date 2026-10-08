import { useEffect, useRef, useState } from 'react';
import { copyText } from '../ShareButtons';

interface ShareData {
  url: string;
  /** Título corto (asunto del correo, título de Web Share) */
  title: string;
  /** Mensaje listo para publicar; el enlace se agrega al final */
  text: string;
}

const enc = encodeURIComponent;

const NETWORKS: { key: string; label: string; color: string; badge: string; href: (d: ShareData) => string }[] = [
  { key: 'whatsapp', label: 'WhatsApp', color: '#25D366', badge: 'W', href: (d) => `https://wa.me/?text=${enc(`${d.text} ${d.url}`)}` },
  { key: 'facebook', label: 'Facebook', color: '#1877F2', badge: 'f', href: (d) => `https://www.facebook.com/sharer/sharer.php?u=${enc(d.url)}&quote=${enc(d.text)}` },
  { key: 'x', label: 'X (Twitter)', color: '#111111', badge: 'X', href: (d) => `https://twitter.com/intent/tweet?text=${enc(d.text)}&url=${enc(d.url)}` },
  { key: 'telegram', label: 'Telegram', color: '#229ED9', badge: 'T', href: (d) => `https://t.me/share/url?url=${enc(d.url)}&text=${enc(d.text)}` },
  { key: 'email', label: 'Correo', color: '#5d6b76', badge: '@', href: (d) => `mailto:?subject=${enc(d.title)}&body=${enc(`${d.text}\n${d.url}`)}` },
];

const ITEM = 'flex w-full items-center gap-2 rounded-lg border border-line px-3 py-2 text-sm font-medium transition hover:bg-surface';

/** Botones de redes + copiar enlace/texto. Instagram y TikTok no permiten compartir por enlace: se ofrece copiar el texto. */
export function SocialActions({ data, onShared }: { data: ShareData; onShared?: () => void }) {
  const [msg, setMsg] = useState('');
  const canShare = typeof navigator !== 'undefined' && typeof navigator.share === 'function';

  function say(t: string) {
    setMsg(t);
    setTimeout(() => setMsg(''), 2500);
  }
  async function copy(what: 'url' | 'text') {
    const ok = await copyText(what === 'url' ? data.url : `${data.text}\n${data.url}`);
    say(ok ? (what === 'url' ? '¡Enlace copiado!' : '¡Texto copiado! Pégalo en Instagram o TikTok.') : 'No se pudo copiar.');
    if (ok) onShared?.();
  }
  async function nativeShare() {
    try { await navigator.share({ title: data.title, text: data.text, url: data.url }); onShared?.(); } catch { /* cancelado */ }
  }

  return (
    <div>
      <ul className="grid grid-cols-2 gap-2">
        {NETWORKS.map((n) => (
          <li key={n.key}>
            <a href={n.href(data)} target="_blank" rel="noopener noreferrer" onClick={() => onShared?.()} className={ITEM}>
              <span aria-hidden="true" className="grid h-5 w-5 place-items-center rounded text-xs font-bold text-white" style={{ background: n.color }}>{n.badge}</span>
              {n.label}
            </a>
          </li>
        ))}
        <li><button type="button" onClick={() => copy('url')} className={ITEM}><span aria-hidden="true">🔗</span> Copiar enlace</button></li>
        <li><button type="button" onClick={() => copy('text')} className={ITEM}><span aria-hidden="true">📋</span> Copiar texto</button></li>
        {canShare && (
          <li className="col-span-2"><button type="button" onClick={nativeShare} className={ITEM}>Más opciones (Instagram, TikTok…)</button></li>
        )}
      </ul>
      <p role="status" aria-live="polite" className="mt-2 min-h-5 text-xs font-medium text-brand-700">{msg}</p>
    </div>
  );
}

/** Botón "Compartir" con menú desplegable; se cierra con clic fuera o Escape. */
export default function ShareMenu({ data, onShared }: { data: ShareData; onShared?: () => void }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => { if (!ref.current?.contains(e.target as Node)) setOpen(false); };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  return (
    <div ref={ref} className="relative">
      <button type="button" className="btn btn-outline !py-2" aria-expanded={open} aria-haspopup="true" onClick={() => setOpen((v) => !v)}>
        <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <circle cx="18" cy="5" r="3" /><circle cx="6" cy="12" r="3" /><circle cx="18" cy="19" r="3" /><path d="M8.6 13.5l6.8 4M15.4 6.5l-6.8 4" />
        </svg>
        Compartir
      </button>
      {open && (
        <div className="absolute right-0 top-full z-20 mt-2 w-72 rounded-2xl border border-line bg-white p-3 shadow-xl">
          <SocialActions data={data} onShared={onShared} />
        </div>
      )}
    </div>
  );
}
