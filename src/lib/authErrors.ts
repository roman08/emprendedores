/** Traduce los errores comunes de Supabase Auth al español. */
export function authError(err: { message?: string; code?: string; status?: number } | null | undefined): string {
  if (!err) return '';
  const msg = (err.message ?? '').toLowerCase();
  const code = err.code ?? '';

  if (code === 'invalid_credentials' || msg.includes('invalid login credentials')) return 'Correo o contraseña incorrectos.';
  if (code === 'email_not_confirmed' || msg.includes('email not confirmed')) return 'Confirma tu correo antes de ingresar. Revisa tu bandeja de entrada.';
  if (code === 'user_already_exists' || msg.includes('already registered') || msg.includes('already been registered'))
    return 'Ese correo ya está registrado. Intenta ingresar o recuperar tu contraseña.';
  if (code === 'weak_password' || msg.includes('weak') || msg.includes('at least 6') || msg.includes('at least 8'))
    return 'La contraseña es muy débil. Usa mínimo 8 caracteres, mezclando letras y números.';
  if (code === 'same_password' || msg.includes('different from the old'))
    return 'La nueva contraseña debe ser distinta a la actual.';
  if (code === 'over_request_rate_limit' || code === 'over_email_send_rate_limit' || err.status === 429 || msg.includes('rate limit') || msg.includes('too many'))
    return 'Demasiados intentos. Espera unos minutos e inténtalo de nuevo.';
  if (code === 'captcha_failed' || msg.includes('captcha')) return 'No pudimos verificar que eres una persona. Recarga el captcha e inténtalo otra vez.';
  if (code === 'session_not_found' || code === 'session_expired' || msg.includes('session')) return 'Tu sesión expiró. Vuelve a ingresar.';
  if (msg.includes('failed to fetch') || msg.includes('network')) return 'No hay conexión. Revisa tu internet e inténtalo de nuevo.';
  if (msg.includes('invalid') && msg.includes('email')) return 'Escribe un correo válido.';
  return 'Ocurrió un error inesperado. Inténtalo de nuevo.';
}
