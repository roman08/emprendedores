import { useEffect, useState } from 'react';
import { isFavorite, onChange, toggle, type FavKind } from '../lib/favorites';

interface Props { kind: FavKind; id: string; label?: string; className?: string }

const MSG = {
  added: 'Guardado en favoritos',
  removed: 'Quitado de favoritos',
  full: 'Llegaste al límite de guardados. Quita alguno para agregar más.',
};

/** Corazón para guardar una publicación o un negocio en el navegador (sin cuenta). */
export default function FavoriteButton({ kind, id, label, className = '' }: Props) {
  const [on, setOn] = useState(false);
  const [msg, setMsg] = useState('');

  // El estado real solo se conoce en el navegador: se lee tras hidratar y se sincroniza entre pestañas.
  useEffect(() => {
    const sync = () => setOn(isFavorite(kind, id));
    sync();
    return onChange(sync);
  }, [kind, id]);

  function click() {
    const r = toggle(kind, id);
    setOn(r === 'added' || (r === 'full' && on));
    setMsg('');
    setTimeout(() => setMsg(MSG[r]), 30);
  }

  return (
    <>
      <button
        type="button"
        onClick={click}
        aria-pressed={on}
        aria-label={on ? 'Quitar de favoritos' : 'Guardar en favoritos'}
        title={on ? 'Quitar de favoritos' : 'Guardar en favoritos'}
        className={`inline-flex h-11 min-w-11 items-center justify-center gap-2 rounded-full border border-line bg-white px-2.5 text-sm font-semibold text-gray-700 hover:bg-surface focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-600 motion-safe:transition motion-safe:active:scale-90 ${on ? 'text-rose-700' : ''} ${className}`}
      >
        <svg viewBox="0 0 24 24" width="20" height="20" fill={on ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" className={on ? 'text-rose-600' : ''}>
          <path d="M20.8 4.6a5.5 5.5 0 0 0-7.8 0L12 5.7l-1-1.1a5.5 5.5 0 0 0-7.8 7.8l1 1.1L12 21.2l7.8-7.7 1-1.1a5.5 5.5 0 0 0 0-7.8z" />
        </svg>
        {label && <span>{on ? 'Guardado' : label}</span>}
      </button>
      <span role="status" aria-live="polite" className="sr-only">{msg}</span>
    </>
  );
}
