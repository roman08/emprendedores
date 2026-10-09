/**
 * Indicador de carga entre páginas. Las páginas públicas son SSR y consultan Supabase antes de responder,
 * así que entre el toque y la página nueva puede pasar un momento: se muestra una barra arriba
 * (#nav-progress en Base.astro) y se atenúan los [data-busy-dim]. Los botones de envío reciben aria-busy (spinner).
 * Solo se activa si la carga tarda más de DELAY ms, para no parpadear en navegaciones rápidas.
 */
const DELAY = 120;
const SAFETY = 15000; // si la navegación nunca llega (cancelada, sin red), se apaga sola
let timer: number | undefined;
let safety: number | undefined;
let busyBtn: HTMLElement | null = null;

function start(btn?: HTMLElement | null) {
  clearTimeout(timer);
  timer = window.setTimeout(() => {
    document.documentElement.setAttribute('data-navigating', '');
    if (btn) { busyBtn = btn; btn.setAttribute('aria-busy', 'true'); }
  }, DELAY);
  clearTimeout(safety);
  safety = window.setTimeout(stop, SAFETY);
}

function stop() {
  clearTimeout(timer);
  clearTimeout(safety);
  document.documentElement.removeAttribute('data-navigating');
  busyBtn?.removeAttribute('aria-busy');
  busyBtn = null;
}

// Enlaces internos que cambian de página (no anclas, ni pestañas nuevas, ni descargas, ni /ir/ que redirige afuera)
document.addEventListener('click', (e) => {
  if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
  const a = (e.target as Element | null)?.closest?.('a[href]') as HTMLAnchorElement | null;
  if (!a || a.target && a.target !== '_self' || a.hasAttribute('download')) return;
  const url = new URL(a.href, location.href);
  if (url.origin !== location.origin || url.pathname.startsWith('/ir/')) return;
  if (url.pathname === location.pathname && url.search === location.search) return; // mismo destino o solo #ancla
  start();
});

// Formularios GET (búsqueda, filtros): los de React hacen preventDefault y no navegan
document.addEventListener('submit', (e) => {
  const form = e.target as HTMLFormElement;
  if ((form.method || 'get').toLowerCase() !== 'get' || form.target === '_blank') return;
  // Se revisa después de los demás manejadores, por si alguno cancela el envío
  setTimeout(() => {
    if (e.defaultPrevented) return;
    const submitter = (e as SubmitEvent).submitter as HTMLElement | null;
    start(submitter && submitter.classList.contains('btn') ? submitter : null);
  });
});

// Volver con el botón Atrás (bfcache) o al cambiar de página: no dejar la barra pegada
window.addEventListener('pageshow', stop);
window.addEventListener('pagehide', stop);

export { start as startNavProgress, stop as stopNavProgress };
