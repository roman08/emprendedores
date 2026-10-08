import { useState } from 'react';

interface Props { title: string; label?: string }

/** Copia texto con Clipboard API y, si no existe, con un textarea temporal. */
export async function copyText(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch { /* se intenta el fallback */ }
  try {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.setAttribute('readonly', '');
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    const ok = document.execCommand('copy');
    ta.remove();
    return ok;
  } catch {
    return false;
  }
}

export default function ShareButtons({ title, label = 'Compartir' }: Props) {
  const [copied, setCopied] = useState<'ok' | 'fail' | null>(null);
  // La URL absoluta se toma de la página actual (sin hash).
  const url = () => location.href.split('#')[0];
  const canShare = typeof navigator !== 'undefined' && typeof navigator.share === 'function';

  async function copy() {
    setCopied((await copyText(url())) ? 'ok' : 'fail');
    setTimeout(() => setCopied(null), 2500);
  }

  async function nativeShare() {
    try {
      await navigator.share({ title, url: url() });
    } catch { /* el usuario canceló */ }
  }

  const wa = () => `https://wa.me/?text=${encodeURIComponent(`${title} ${url()}`)}`;

  return (
    <div className="flex flex-wrap items-center gap-2" aria-label={label}>
      <a href="#" onClick={(e) => { e.preventDefault(); window.open(wa(), '_blank', 'noopener'); }} className="btn btn-wa flex-1 !py-2 text-sm sm:flex-none">
        Compartir por WhatsApp
      </a>
      <button type="button" onClick={copy} className="btn btn-outline flex-1 !py-2 text-sm sm:flex-none">Copiar enlace</button>
      {canShare && <button type="button" onClick={nativeShare} className="btn btn-ghost flex-1 !py-2 text-sm sm:flex-none">Más opciones</button>}
      <span role="status" aria-live="polite" className="text-sm font-medium text-brand-700">
        {copied === 'ok' && '¡Enlace copiado!'}
        {copied === 'fail' && 'No se pudo copiar. Copia la dirección del navegador.'}
      </span>
    </div>
  );
}
