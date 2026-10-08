import { useEffect, useState } from 'react';
import QRCode from 'qrcode';
import { copyText } from '../ShareButtons';
import { SocialActions } from './SocialShare';

interface Props { business: { name: string; slug: string }; onShared: () => void }

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

export default function ShareCard({ business, onShared }: Props) {
  const url = `${location.origin}/n/${business.slug}`;
  const [qr, setQr] = useState('');
  const [msg, setMsg] = useState('');
  const canShare = typeof navigator.share === 'function';

  useEffect(() => {
    QRCode.toDataURL(url, { width: 640, margin: 2, errorCorrectionLevel: 'M' }).then(setQr).catch(() => setQr(''));
  }, [url]);

  function say(text: string) {
    setMsg(text);
    setTimeout(() => setMsg(''), 2500);
  }

  async function copy() {
    if (await copyText(url)) { say('¡Enlace copiado!'); onShared(); }
    else say('No se pudo copiar. Selecciona el enlace y cópialo.');
  }

  async function share() {
    try { await navigator.share({ title: business.name, url }); onShared(); } catch { /* cancelado */ }
  }

  function download() {
    const a = document.createElement('a');
    a.href = qr;
    a.download = `qr-${business.slug}.png`;
    a.click();
    onShared();
  }

  function print() {
    const w = window.open('', '_blank');
    if (!w) { say('Permite las ventanas emergentes para imprimir.'); return; }
    w.document.write(`<!doctype html><html lang="es"><head><meta charset="utf-8"><title>${esc(business.name)}</title>
<style>body{font-family:system-ui,sans-serif;text-align:center;margin:0;padding:48px}h1{font-size:44px;margin:0 0 8px}p{font-size:22px;margin:8px 0}img{width:420px;max-width:100%;margin:24px auto}small{color:#555;word-break:break-all}</style></head>
<body><h1>Escríbenos por WhatsApp</h1><p><strong>${esc(business.name)}</strong></p><img src="${qr}" alt="Código QR de la tienda"><p>Escanea y mira nuestro catálogo</p><small>${esc(url)}</small>
<script>window.onload=function(){window.print()}<\/script></body></html>`);
    w.document.close();
    onShared();
  }

  return (
    <section className="card mb-6 p-5" aria-labelledby="share-title">
      <h2 id="share-title" className="font-bold">Comparte tu tienda</h2>
      <p className="mt-1 text-sm text-muted">Envía tu enlace o pega el código QR en tu local para que te encuentren.</p>
      <div className="mt-4 grid gap-5 sm:grid-cols-[1fr_auto]">
        <div>
          <label htmlFor="store-url" className="label">Enlace de tu tienda</label>
          <input id="store-url" readOnly value={url} onFocus={(e) => e.currentTarget.select()} className="input" />
          <div className="mt-3 flex flex-wrap gap-2">
            <button type="button" onClick={copy} className="btn btn-primary !py-2 text-sm">Copiar enlace</button>
            {canShare && <button type="button" onClick={share} className="btn btn-outline !py-2 text-sm">Compartir</button>}
            <button type="button" onClick={download} disabled={!qr} className="btn btn-outline !py-2 text-sm">Descargar QR (PNG)</button>
            <button type="button" onClick={print} disabled={!qr} className="btn btn-ghost !py-2 text-sm">Versión imprimible</button>
          </div>
          <p role="status" aria-live="polite" className="mt-2 min-h-5 text-sm font-medium text-brand-700">{msg}</p>
          <p className="mb-2 mt-3 text-sm font-semibold">Compartir en redes</p>
          <SocialActions onShared={onShared} data={{
            url,
            title: business.name,
            text: `Conoce ${business.name} y escríbenos por WhatsApp:`,
          }} />
        </div>
        <div className="grid h-40 w-40 place-items-center justify-self-center rounded-xl border border-line bg-white p-2">
          {qr ? <img src={qr} alt={`Código QR de la tienda ${business.name}`} className="h-full w-full" /> : <span className="text-xs text-muted">Generando QR…</span>}
        </div>
      </div>
    </section>
  );
}
