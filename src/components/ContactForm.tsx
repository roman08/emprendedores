import { useCallback, useEffect, useRef, useState, type SyntheticEvent } from 'react';
import { supabase } from '../lib/supabase';

const SITE_KEY = import.meta.env.PUBLIC_TURNSTILE_SITE_KEY;
const MAX = 2000;

const KINDS: [string, string][] = [
  ['duda', 'Duda'],
  ['problema', 'Reportar un problema'],
  ['arco', 'Ejercer derechos ARCO'],
  ['publicidad', 'Publicidad'],
  ['otro', 'Otro'],
];

/** Captcha Turnstile opcional (mismo patrón que AuthForm): sin PUBLIC_TURNSTILE_SITE_KEY no renderiza nada. */
function useTurnstile() {
  const box = useRef<HTMLDivElement>(null);
  const widget = useRef<string | undefined>(undefined);
  const [token, setToken] = useState<string | undefined>();

  useEffect(() => {
    if (!SITE_KEY) return;
    let cancelled = false;
    const mount = () => {
      if (cancelled || !box.current || !window.turnstile || widget.current) return;
      widget.current = window.turnstile.render(box.current, {
        sitekey: SITE_KEY,
        callback: (t: string) => setToken(t),
        'expired-callback': () => setToken(undefined),
        'error-callback': () => setToken(undefined),
      });
    };
    if (window.turnstile) mount();
    else {
      let s = document.querySelector<HTMLScriptElement>('script[data-turnstile]');
      if (!s) {
        s = document.createElement('script');
        s.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';
        s.async = true;
        s.defer = true;
        s.dataset.turnstile = '1';
        document.head.appendChild(s);
      }
      s.addEventListener('load', mount);
    }
    return () => {
      cancelled = true;
      if (widget.current) window.turnstile?.remove(widget.current);
      widget.current = undefined;
    };
  }, []);

  const reset = useCallback(() => {
    setToken(undefined);
    if (widget.current) window.turnstile?.reset(widget.current);
  }, []);

  return { box, token, reset, enabled: !!SITE_KEY };
}

export default function ContactForm({ initialKind = 'duda' }: { initialKind?: string }) {
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [kind, setKind] = useState(KINDS.some(([k]) => k === initialKind) ? initialKind : 'duda');
  const [message, setMessage] = useState('');
  const [accepted, setAccepted] = useState(false);
  const [trap, setTrap] = useState('');
  const [error, setError] = useState('');
  const [sent, setSent] = useState(false);
  const [busy, setBusy] = useState(false);
  const captcha = useTurnstile();

  // Si hay sesión, se precarga el correo para ahorrar un paso
  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      const mail = data.session?.user.email;
      if (mail) setEmail((cur) => cur || mail);
    });
  }, []);

  async function submit(e: SyntheticEvent) {
    e.preventDefault();
    setError('');
    if (!accepted) { setError('Debes aceptar el Aviso de privacidad.'); return; }
    if (captcha.enabled && !captcha.token) { setError('Completa la verificación de seguridad.'); return; }
    // Campo trampa: un humano no lo ve ni lo llena. Se simula éxito sin enviar nada.
    if (trap) { setSent(true); return; }
    setBusy(true);
    const { error: err } = await supabase.from('contact_messages').insert({
      name: name.trim(),
      email: email.trim(),
      kind,
      message: message.trim(),
    });
    setBusy(false);
    if (captcha.enabled) captcha.reset();
    if (err) {
      setError(err.code === '23514' && /demasiados/i.test(err.message)
        ? 'Has enviado demasiados mensajes. Inténtalo de nuevo más tarde.'
        : 'No pudimos enviar tu mensaje. Revisa los datos e inténtalo de nuevo.');
      return;
    }
    setSent(true);
  }

  if (sent) {
    return (
      <div className="card space-y-3 p-8" role="status">
        <h2 className="text-xl font-extrabold">Mensaje enviado</h2>
        <p className="text-muted">Gracias por escribirnos. Revisaremos tu mensaje y, si hace falta, te responderemos al correo que indicaste.</p>
        <a className="btn btn-ghost" href="/">Volver al inicio</a>
      </div>
    );
  }

  return (
    <form onSubmit={submit} className="card space-y-4 p-6 sm:p-8">
      <div>
        <label className="label" htmlFor="ct-name">Nombre</label>
        <input id="ct-name" className="input" required maxLength={120} value={name} onChange={(e) => setName(e.target.value)} autoComplete="name" />
      </div>
      <div>
        <label className="label" htmlFor="ct-email">Correo para responderte</label>
        <input id="ct-email" className="input" type="email" required maxLength={254} value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" />
      </div>
      <div>
        <label className="label" htmlFor="ct-kind">Tipo de solicitud</label>
        <select id="ct-kind" className="input" value={kind} onChange={(e) => setKind(e.target.value)}>
          {KINDS.map(([k, label]) => <option key={k} value={k}>{label}</option>)}
        </select>
        {kind === 'arco' && (
          <p className="mt-1 text-xs text-muted">Indica qué derecho quieres ejercer (acceso, rectificación, cancelación u oposición) y el correo con el que te registraste. Podemos pedirte que acredites tu identidad.</p>
        )}
      </div>
      <div>
        <label className="label" htmlFor="ct-message">Mensaje</label>
        <textarea id="ct-message" className="input min-h-36" required maxLength={MAX} value={message} onChange={(e) => setMessage(e.target.value)} aria-describedby="ct-count" />
        <p id="ct-count" className="mt-1 text-right text-xs text-muted">{message.length} / {MAX}</p>
      </div>
      {/* Honeypot: fuera de pantalla y fuera del orden de tabulación */}
      <div aria-hidden="true" className="absolute -left-[9999px] h-0 w-0 overflow-hidden">
        <label htmlFor="ct-web">No llenes este campo</label>
        <input id="ct-web" name="website" tabIndex={-1} autoComplete="off" value={trap} onChange={(e) => setTrap(e.target.value)} />
      </div>
      <label className="flex items-start gap-2 text-sm text-muted">
        <input type="checkbox" required className="mt-1" checked={accepted} onChange={(e) => setAccepted(e.target.checked)} />
        <span>He leído el <a className="font-semibold text-brand-700" href="/privacidad" target="_blank" rel="noopener">Aviso de privacidad</a> y acepto que usen mis datos para atender esta solicitud.</span>
      </label>
      {captcha.enabled && <div ref={captcha.box} />}
      {error && <p role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
      <button className="btn btn-primary w-full sm:w-auto" disabled={busy}>{busy ? 'Enviando…' : 'Enviar mensaje'}</button>
    </form>
  );
}
