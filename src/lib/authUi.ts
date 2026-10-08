import { supabase } from './supabase';

/**
 * Sincroniza la UI pública con la sesión (que vive en el navegador):
 * - html[data-auth] controla qué elementos [data-guest] / [data-user] se ven (ver global.css)
 * - [data-cta] apunta a /panel si hay sesión y a /registro si no
 * - [data-logout] cierra sesión
 */
function apply(loggedIn: boolean) {
  document.documentElement.dataset.auth = loggedIn ? 'in' : 'out';
  document.querySelectorAll<HTMLAnchorElement>('a[data-cta]').forEach((a) => {
    a.href = loggedIn ? '/panel' : '/registro';
  });
}

supabase.auth.getSession().then(({ data }) => apply(!!data.session));
supabase.auth.onAuthStateChange((_event, session) => apply(!!session));

document.querySelectorAll<HTMLElement>('[data-logout]').forEach((el) =>
  el.addEventListener('click', async () => {
    await supabase.auth.signOut();
    location.href = '/';
  }),
);
