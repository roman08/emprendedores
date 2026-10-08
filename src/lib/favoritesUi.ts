import { countFavorites, isFavorite, onChange, toggle, type FavKind } from './favorites';

/**
 * Parte ligera de favoritos para todas las páginas (sin React):
 * - corazones de las tarjetas: botones [data-fav-id][data-fav-kind] con un único listener delegado
 * - contador de "Guardados" en header y pie: [data-fav-count]
 */
export const MESSAGES = {
  added: 'Guardado en favoritos',
  removed: 'Quitado de favoritos',
  full: 'Llegaste al límite de guardados. Quita alguno para agregar más.',
};

let live: HTMLElement | null = null;
export function announce(text: string) {
  if (!live) {
    live = document.createElement('div');
    live.setAttribute('role', 'status');
    live.setAttribute('aria-live', 'polite');
    live.className = 'sr-only';
    document.body.appendChild(live);
  }
  live.textContent = '';
  setTimeout(() => { if (live) live.textContent = text; }, 30);
}

function sync() {
  document.querySelectorAll<HTMLElement>('[data-fav-id]').forEach((el) => {
    const on = isFavorite((el.dataset.favKind as FavKind) ?? 'listing', el.dataset.favId!);
    el.setAttribute('aria-pressed', String(on));
    el.setAttribute('aria-label', on ? 'Quitar de favoritos' : 'Guardar en favoritos');
  });
  const n = countFavorites();
  document.querySelectorAll<HTMLElement>('[data-fav-count]').forEach((el) => {
    el.textContent = n > 99 ? '99+' : String(n);
    el.hidden = n === 0;
  });
  document.querySelectorAll<HTMLElement>('[data-fav-link]').forEach((el) => {
    el.setAttribute('aria-label', n > 0 ? `Guardados (${n})` : 'Guardados');
  });
}

document.addEventListener('click', (e) => {
  const btn = (e.target as Element | null)?.closest<HTMLElement>('[data-fav-id]');
  if (!btn) return;
  // El corazón vive sobre una tarjeta enlazada: no debe navegar.
  e.preventDefault();
  e.stopPropagation();
  const result = toggle((btn.dataset.favKind as FavKind) ?? 'listing', btn.dataset.favId!);
  announce(MESSAGES[result]);
});

sync();
onChange(sync);
