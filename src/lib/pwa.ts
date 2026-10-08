// Cliente de la app instalable: registra el service worker y gestiona el flujo de instalación.
// Elementos que controla (los define PwaInstall.astro y otras páginas):
//   [data-install]        botones de instalar: visibles solo si se puede instalar y la app no está instalada
//   #install-banner       aviso discreto (2.ª visita en adelante, descartable 14 días)
//   #ios-install-dialog   instrucciones para iPhone/iPad

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

const KEY_VISITS = 'pwa:visits';
const KEY_DISMISSED = 'pwa:dismissed';
const DISMISS_DAYS = 14;

function read(key: string): string | null {
  try { return localStorage.getItem(key); } catch { return null; }
}
function write(key: string, value: string) {
  try { localStorage.setItem(key, value); } catch { /* almacenamiento bloqueado: no pasa nada */ }
}

export function isStandalone(): boolean {
  return window.matchMedia('(display-mode: standalone)').matches || (navigator as Navigator & { standalone?: boolean }).standalone === true;
}

export function isIOS(): boolean {
  const ua = navigator.userAgent;
  // iPadOS 13+ se identifica como Mac pero con pantalla táctil
  return /iphone|ipad|ipod/i.test(ua) || (ua.includes('Macintosh') && navigator.maxTouchPoints > 1);
}

/** Safari de iOS (los demás navegadores de iOS no pueden "Agregar a inicio" en versiones antiguas). */
function isIOSSafari(): boolean {
  const ua = navigator.userAgent;
  return isIOS() && /safari/i.test(ua) && !/crios|fxios|edgios|opios/i.test(ua);
}

export function initPwa() {
  // 1) Service worker, solo en producción para no cachear mientras se desarrolla
  if ('serviceWorker' in navigator && import.meta.env.PROD) {
    window.addEventListener('load', () => {
      navigator.serviceWorker.register('/sw.js').catch(() => { /* sin SW la web funciona igual */ });
    });
  }

  // 2) Visitas (para decidir cuándo mostrar el aviso)
  const visits = Number(read(KEY_VISITS) ?? 0) + 1;
  write(KEY_VISITS, String(visits));

  const buttons = () => document.querySelectorAll<HTMLElement>('[data-install]');
  const banner = document.getElementById('install-banner');
  const iosDialog = document.getElementById('ios-install-dialog') as HTMLDialogElement | null;

  let deferred: BeforeInstallPromptEvent | null = null;
  const installed = () => isStandalone() || read('pwa:installed') === '1';
  const canInstall = () => !installed() && (deferred !== null || isIOSSafari());

  function refresh() {
    const ok = canInstall();
    buttons().forEach((b) => { b.hidden = !ok; });
    if (!ok && banner) banner.hidden = true;
  }

  function dismissedRecently(): boolean {
    const t = Number(read(KEY_DISMISSED) ?? 0);
    return t > 0 && Date.now() - t < DISMISS_DAYS * 864e5;
  }

  // El aviso espera a que no esté el banner de cookies para no taparse entre sí
  function maybeShowBanner(tries = 0) {
    if (!banner || !canInstall() || visits < 2 || dismissedRecently()) return;
    const cookieBanner = document.getElementById('cc-title');
    if (cookieBanner && cookieBanner.offsetParent !== null && tries < 15) {
      setTimeout(() => maybeShowBanner(tries + 1), 2000);
      return;
    }
    banner.hidden = false;
  }

  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault(); // guardamos el evento para lanzarlo desde nuestro botón
    deferred = e as BeforeInstallPromptEvent;
    refresh();
    maybeShowBanner();
  });

  window.addEventListener('appinstalled', () => {
    write('pwa:installed', '1');
    deferred = null;
    refresh();
  });

  document.addEventListener('click', async (e) => {
    const target = (e.target as Element).closest<HTMLElement>('[data-install]');
    if (!target) return;
    if (deferred) {
      const ev = deferred;
      deferred = null; // el evento solo puede usarse una vez
      await ev.prompt();
      const { outcome } = await ev.userChoice;
      if (outcome === 'dismissed') write(KEY_DISMISSED, String(Date.now()));
      refresh();
    } else if (isIOSSafari() && iosDialog?.showModal) {
      iosDialog.showModal();
    }
  });

  document.getElementById('install-dismiss')?.addEventListener('click', () => {
    write(KEY_DISMISSED, String(Date.now()));
    if (banner) banner.hidden = true;
  });
  document.getElementById('ios-install-close')?.addEventListener('click', () => iosDialog?.close());
  iosDialog?.addEventListener('click', (e) => { if (e.target === iosDialog) iosDialog.close(); });

  refresh();
  maybeShowBanner();
}
