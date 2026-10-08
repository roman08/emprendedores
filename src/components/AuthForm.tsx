import { useCallback, useEffect, useRef, useState, type SyntheticEvent } from 'react';
import { supabase } from '../lib/supabase';
import { authError } from '../lib/authErrors';

type Mode = 'login' | 'register' | 'recover' | 'reset';

const SITE_KEY = import.meta.env.PUBLIC_TURNSTILE_SITE_KEY;

declare global {
  interface Window {
    turnstile?: {
      render: (el: HTMLElement, opts: Record<string, unknown>) => string;
      reset: (id?: string) => void;
      remove: (id?: string) => void;
    };
  }
}

/** Captcha Turnstile opcional: sin PUBLIC_TURNSTILE_SITE_KEY no renderiza nada y el token queda indefinido. */
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

  // Los tokens son de un solo uso: tras cada intento se pide uno nuevo
  const reset = useCallback(() => {
    setToken(undefined);
    if (widget.current) window.turnstile?.reset(widget.current);
  }, []);

  return { box, token, reset, enabled: !!SITE_KEY };
}

export default function AuthForm({ mode }: { mode: Mode }) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [name, setName] = useState('');
  const [accepted, setAccepted] = useState(false);
  const [error, setError] = useState('');
  const [info, setInfo] = useState('');
  const [busy, setBusy] = useState(false);
  // reset: null = comprobando, true = hay sesión de recuperación, false = enlace inválido o vencido
  const [recovery, setRecovery] = useState<boolean | null>(null);
  const captcha = useTurnstile();
  const register = mode === 'register';
  const login = mode === 'login';

  useEffect(() => {
    if (mode === 'reset') {
      // El enlace del correo trae la sesión de recuperación; supabase-js la procesa al cargar
      const { data: sub } = supabase.auth.onAuthStateChange((event, session) => {
        if (event === 'PASSWORD_RECOVERY' || session) setRecovery(true);
      });
      supabase.auth.getSession().then(({ data }) => { if (data.session) setRecovery(true); });
      const t = setTimeout(() => setRecovery((r) => (r === null ? false : r)), 2500);
      return () => { sub.subscription.unsubscribe(); clearTimeout(t); };
    }
    if (mode === 'recover') return;
    // Si ya hay sesión, no tiene sentido ver login/registro
    supabase.auth.getSession().then(({ data }) => { if (data.session) location.replace('/panel'); });
  }, [mode]);

  async function submit(e: SyntheticEvent) {
    e.preventDefault();
    setError('');
    setInfo('');
    if (register && !accepted) { setError('Debes aceptar los Términos y el Aviso de privacidad.'); return; }
    if (mode === 'reset' && password !== confirm) { setError('Las contraseñas no coinciden.'); return; }
    if (captcha.enabled && !captcha.token && mode !== 'reset') { setError('Completa la verificación de seguridad.'); return; }
    setBusy(true);
    const captchaToken = captcha.token;

    if (register) {
      const { data, error } = await supabase.auth.signUp({
        email,
        password,
        options: { data: { full_name: name }, emailRedirectTo: `${location.origin}/panel`, captchaToken },
      });
      if (error) setError(authError(error));
      else if (data.session) location.href = '/panel';
      else setInfo('Te enviamos un correo para confirmar tu cuenta. Ábrelo y vuelve aquí.');
    } else if (login) {
      const { error } = await supabase.auth.signInWithPassword({ email, password, options: { captchaToken } });
      if (error) setError(authError(error));
      else location.href = '/panel';
    } else if (mode === 'recover') {
      const { error } = await supabase.auth.resetPasswordForEmail(email, { redirectTo: `${location.origin}/restablecer`, captchaToken });
      // Mensaje neutro: no revela si el correo existe. Solo se muestran fallos de captcha o límite de envíos.
      if (error && (error.status === 429 || /captcha|rate/i.test(`${error.code ?? ''} ${error.message}`))) setError(authError(error));
      else setInfo('Si ese correo está registrado, te enviamos un enlace para crear una nueva contraseña. Revisa también tu carpeta de spam.');
    } else {
      const { error } = await supabase.auth.updateUser({ password });
      if (error) setError(authError(error));
      else location.href = '/panel';
    }
    if (captcha.enabled && mode !== 'reset') captcha.reset();
    setBusy(false);
  }

  async function google() {
    if (register && !accepted) { setError('Debes aceptar los Términos y el Aviso de privacidad.'); return; }
    await supabase.auth.signInWithOAuth({ provider: 'google', options: { redirectTo: `${location.origin}/panel` } });
  }

  if (mode === 'reset' && recovery !== true) {
    return (
      <div className="card w-full max-w-md space-y-4 p-8">
        <h1 className="text-2xl font-extrabold">Nueva contraseña</h1>
        {recovery === null
          ? <p className="text-sm text-muted">Verificando tu enlace…</p>
          : <>
            <p role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">El enlace no es válido o ya venció. Solicita uno nuevo.</p>
            <a className="btn btn-primary w-full" href="/recuperar">Recuperar contraseña</a>
          </>}
      </div>
    );
  }

  const titles: Record<Mode, [string, string]> = {
    login: ['Bienvenido de nuevo', 'Ingresa para administrar tu negocio.'],
    register: ['Crea tu cuenta gratis', 'Publica tus productos o servicios y recibe clientes por WhatsApp.'],
    recover: ['Recupera tu contraseña', 'Escribe tu correo y te enviaremos un enlace para crear una nueva.'],
    reset: ['Nueva contraseña', 'Elige una contraseña de al menos 8 caracteres.'],
  };
  const social = login || register;
  const showEmail = mode !== 'reset';
  const showPassword = mode !== 'recover';
  const submitLabel = { login: 'Ingresar', register: 'Crear cuenta', recover: 'Enviar enlace', reset: 'Guardar contraseña' }[mode];

  return (
    <form onSubmit={submit} className="card w-full max-w-md space-y-4 p-8">
      <h1 className="text-2xl font-extrabold">{titles[mode][0]}</h1>
      <p className="text-sm text-muted">{titles[mode][1]}</p>
      {social && <>
        <button type="button" onClick={google} className="btn btn-ghost w-full">Continuar con Google</button>
        <div className="flex items-center gap-3 text-xs text-muted"><hr className="flex-1 border-line" />o<hr className="flex-1 border-line" /></div>
      </>}
      {register && (
        <div><label className="label" htmlFor="auth-name">Tu nombre</label>
          <input id="auth-name" className="input" required value={name} onChange={(e) => setName(e.target.value)} autoComplete="name" /></div>
      )}
      {showEmail && (
        <div><label className="label" htmlFor="auth-email">Correo electrónico</label>
          <input id="auth-email" className="input" type="email" required value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" /></div>
      )}
      {showPassword && (
        <div>
          <div className="flex items-baseline justify-between">
            <label className="label" htmlFor="auth-password">{mode === 'reset' ? 'Nueva contraseña' : 'Contraseña'}</label>
            {login && <a className="text-xs font-semibold text-brand-700" href="/recuperar">¿Olvidaste tu contraseña?</a>}
          </div>
          <input id="auth-password" className="input" type="password" required minLength={8} value={password} onChange={(e) => setPassword(e.target.value)}
            autoComplete={login ? 'current-password' : 'new-password'} />
          {(register || mode === 'reset') && <p className="mt-1 text-xs text-muted">Mínimo 8 caracteres.</p>}
        </div>
      )}
      {mode === 'reset' && (
        <div><label className="label" htmlFor="auth-confirm">Confirma la contraseña</label>
          <input id="auth-confirm" className="input" type="password" required minLength={8} value={confirm} onChange={(e) => setConfirm(e.target.value)} autoComplete="new-password" /></div>
      )}
      {register && (
        <label className="flex items-start gap-2 text-sm text-muted">
          <input type="checkbox" required className="mt-1" checked={accepted} onChange={(e) => setAccepted(e.target.checked)} />
          <span>Acepto los <a className="font-semibold text-brand-700" href="/terminos" target="_blank" rel="noopener">Términos</a> y el{' '}
            <a className="font-semibold text-brand-700" href="/privacidad" target="_blank" rel="noopener">Aviso de privacidad</a>.</span>
        </label>
      )}
      {captcha.enabled && mode !== 'reset' && <div ref={captcha.box} />}
      {error && <p role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
      {info && <p role="status" className="rounded-lg bg-brand-50 px-3 py-2 text-sm text-brand-700">{info}</p>}
      <button className="btn btn-primary w-full" disabled={busy}>{busy ? 'Un momento…' : submitLabel}</button>
      <p className="text-center text-sm text-muted">
        {register ? <>¿Ya tienes cuenta? <a className="font-semibold text-brand-700" href="/ingresar">Ingresa</a></>
          : login ? <>¿Eres nuevo? <a className="font-semibold text-brand-700" href="/registro">Regístrate gratis</a></>
          : <a className="font-semibold text-brand-700" href="/ingresar">Volver a ingresar</a>}
      </p>
    </form>
  );
}
