import { test, expect, type Page } from '@playwright/test';
import { watch, blockThirdParty, seedSession, mockRestAll, hydrated } from './helpers';

test.beforeEach(async ({ page }) => {
  await blockThirdParty(page);
});

/** Responde a /auth/v1/* con (status, body) y registra las llamadas. NUNCA llega a Supabase real. */
async function mockAuth(page: Page, respond: (path: string, body: any) => { status: number; body: unknown }) {
  const calls: { path: string; body: any }[] = [];
  await page.route('**/auth/v1/**', async (route) => {
    const u = new URL(route.request().url());
    let body: any = null;
    try { body = route.request().postData() ? JSON.parse(route.request().postData()!) : null; } catch { /* */ }
    const path = u.pathname.replace('/auth/v1/', '') + u.search;
    if (route.request().method() === 'OPTIONS') return route.fulfill({ status: 204, headers: { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': '*' } });
    calls.push({ path, body });
    const r = respond(path, body);
    return route.fulfill({ status: r.status, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: JSON.stringify(r.body) });
  });
  return calls;
}

test.describe('Header segun sesion', () => {
  test('sin sesion: Ingresar y Publica gratis visibles; Mi panel y Salir ocultos', async ({ page }) => {
    await page.goto('/');
    const nav = page.locator('header nav');
    await expect(nav.getByRole('link', { name: 'Ingresar' })).toBeVisible();
    await expect(nav.getByRole('link', { name: 'Publica gratis' })).toBeVisible();
    await expect(nav.getByRole('link', { name: 'Mi panel' })).toBeHidden();
    await expect(nav.getByRole('button', { name: 'Salir' })).toBeHidden();
    await expect(page.locator('html')).toHaveAttribute('data-auth', 'out');
  });

  test('con sesion falsa: Mi panel y Salir visibles; Ingresar y Publica gratis ocultos', async ({ page }) => {
    await seedSession(page);
    await mockRestAll(page);
    await page.goto('/');
    const nav = page.locator('header nav');
    await expect(nav.getByRole('link', { name: 'Mi panel' })).toBeVisible();
    await expect(nav.getByRole('button', { name: 'Salir' })).toBeVisible();
    await expect(nav.getByRole('link', { name: 'Ingresar' })).toBeHidden();
    await expect(nav.getByRole('link', { name: 'Publica gratis' })).toBeHidden();
    // Los CTA de la home apuntan a /panel
    await expect(page.locator('a[data-cta]').first()).toHaveAttribute('href', '/panel');
  });

  test('Salir limpia la sesion y vuelve a la home como visitante', async ({ page }) => {
    await seedSession(page);
    await mockRestAll(page);
    await page.goto('/como-funciona');
    await expect(page.locator('html')).toHaveAttribute('data-auth', 'in');
    // El manejador de "Salir" se registra al cargar el script del layout
    await expect(async () => {
      await page.locator('header').getByRole('button', { name: 'Salir' }).click();
      await page.waitForURL('**/', { timeout: 2000 });
    }).toPass({ timeout: 15000 });
    await page.waitForLoadState('load');
    const keys = await page.evaluate(() => Object.keys(localStorage).filter((k) => /^sb-.*-auth-token$/.test(k)));
    expect(keys).toEqual([]);
    await expect(page.locator('html')).toHaveAttribute('data-auth', 'out');
    await expect(page.locator('header nav').getByRole('link', { name: 'Ingresar' })).toBeVisible();
  });

  test('con sesion, Mi panel y Salir caben en la pantalla de 390px', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await seedSession(page);
    await mockRestAll(page);
    await page.goto('/como-funciona');
    const box = await page.locator('header').getByRole('button', { name: 'Salir' }).boundingBox();
    expect(box!.x + box!.width).toBeLessThanOrEqual(390);
  });

  test('en movil (360px) el header no desborda horizontalmente', async ({ page }) => {
    // Regresion corregida: .btn (global.css) estaba fuera de @layer y pisaba la utilidad 'hidden' => Explorar y Cerca de mi se veian siempre.
    await page.setViewportSize({ width: 360, height: 740 });
    await page.goto('/');
    const sw = await page.evaluate(() => document.documentElement.scrollWidth);
    expect(sw).toBeLessThanOrEqual(360);
  });
});

test.describe('Redirecciones de acceso', () => {
  test('/panel sin sesion -> /ingresar', async ({ page }) => {
    await page.goto('/panel');
    await page.waitForURL('**/ingresar', { waitUntil: 'commit', timeout: 30000 });
    await expect(page.getByRole('heading', { name: 'Bienvenido de nuevo' })).toBeVisible();
  });

  test('/admin sin sesion -> /ingresar', async ({ page }) => {
    await page.goto('/admin');
    await page.waitForURL('**/ingresar');
  });

  for (const p of ['/ingresar', '/registro']) {
    test(`${p} con sesion -> /panel`, async ({ page }) => {
      await seedSession(page);
      await mockRestAll(page);
      await page.goto(p);
      await page.waitForURL('**/panel');
    });
  }

  test('/recuperar con sesion NO redirige (se puede cambiar contrasena)', async ({ page }) => {
    await seedSession(page);
    await mockRestAll(page);
    await page.goto('/recuperar');
    await expect(page.getByRole('heading', { name: 'Recupera tu contraseña' })).toBeVisible();
    expect(new URL(page.url()).pathname).toBe('/recuperar');
  });
});

test.describe('Login', () => {
  test('credenciales invalidas -> mensaje en espanol, sin salir de la pagina', async ({ page }) => {
    const calls = await mockAuth(page, () => ({ status: 400, body: { code: 'invalid_credentials', error_code: 'invalid_credentials', message: 'Invalid login credentials', msg: 'Invalid login credentials' } }));
    await page.goto('/ingresar');
    await expect(async () => {
      await page.getByLabel('Correo electrónico').fill('qa@example.invalid');
      await page.getByLabel('Contraseña', { exact: true }).fill('incorrecta123');
      await page.getByRole('button', { name: 'Ingresar', exact: true }).click();
      await expect(page.getByRole('alert')).toBeVisible({ timeout: 2000 });
    }).toPass({ timeout: 15000 });
    await expect(page.getByRole('alert')).toHaveText('Correo o contraseña incorrectos.');
    expect(calls.some((c) => c.path.startsWith('token?grant_type=password'))).toBe(true);
    expect(new URL(page.url()).pathname).toBe('/ingresar');
    await expect(page.getByRole('button', { name: 'Ingresar', exact: true })).toBeEnabled();
  });

  test('correo sin confirmar, limite de intentos y red caida: mensajes en espanol', async ({ page }) => {
    const cases: [number, any, string][] = [
      [400, { code: 'email_not_confirmed', message: 'Email not confirmed' }, 'Confirma tu correo antes de ingresar.'],
      [429, { code: 'over_request_rate_limit', message: 'rate limit' }, 'Demasiados intentos.'],
    ];
    let i = 0;
    await mockAuth(page, () => ({ status: cases[i][0], body: cases[i][1] }));
    await page.goto('/ingresar');
    await expect(page.getByLabel('Correo electrónico')).toBeVisible();
    await page.waitForTimeout(500);
    for (i = 0; i < cases.length; i++) {
      await expect(async () => {
        await page.getByLabel('Correo electrónico').fill('qa@example.invalid');
        await page.getByLabel('Contraseña', { exact: true }).fill('incorrecta123');
        await page.getByRole('button', { name: 'Ingresar', exact: true }).click();
        await expect(page.getByRole('alert')).toContainText(cases[i][2], { timeout: 2000 });
      }).toPass({ timeout: 15000 });
    }
  });

  test('error de red muestra mensaje de conexion en espanol', async ({ page }) => {
    await page.route('**/auth/v1/**', (r) => r.abort('failed'));
    await page.goto('/ingresar');
    await expect(async () => {
      await page.getByLabel('Correo electrónico').fill('qa@example.invalid');
      await page.getByLabel('Contraseña', { exact: true }).fill('incorrecta123');
      await page.getByRole('button', { name: 'Ingresar', exact: true }).click();
      await expect(page.getByRole('alert')).toBeVisible({ timeout: 2000 });
    }).toPass({ timeout: 15000 });
    const t = await page.getByRole('alert').innerText();
    // Mensaje en espanol (no el "Failed to fetch" crudo)
    expect(t).not.toMatch(/failed to fetch|TypeError/i);
  });

  test('validacion del cliente: correo vacio/invalido y contrasena corta no envian nada', async ({ page }) => {
    const calls = await mockAuth(page, () => ({ status: 400, body: { message: 'x' } }));
    await page.goto('/ingresar');
    await page.waitForLoadState('networkidle');
    await page.getByLabel('Correo electrónico').fill('no-es-correo');
    await page.getByLabel('Contraseña', { exact: true }).fill('12345678');
    await page.getByRole('button', { name: 'Ingresar', exact: true }).click();
    await page.getByLabel('Correo electrónico').fill('qa@example.invalid');
    await page.getByLabel('Contraseña', { exact: true }).fill('corta');
    await page.getByRole('button', { name: 'Ingresar', exact: true }).click();
    await page.waitForTimeout(500);
    expect(calls.filter((c) => c.path.startsWith('token'))).toEqual([]);
    const invalid = await page.locator('input:invalid').count();
    expect(invalid).toBeGreaterThan(0);
  });

  test('login correcto (respuesta simulada) redirige a /panel', async ({ page }) => {
    const { buildSession } = await import('../helpers/mockSupabase');
    const s = buildSession('entrepreneur') as any;
    s.user.identities = [{ provider: 'email' }];
    await mockRestAll(page);
    await mockAuth(page, (p) => (p.startsWith('token') ? { status: 200, body: s } : p.startsWith('user') ? { status: 200, body: s.user } : { status: 204, body: {} }));
    await page.goto('/ingresar');
    await expect(async () => {
      await page.getByLabel('Correo electrónico').fill('qa@example.invalid');
      await page.getByLabel('Contraseña', { exact: true }).fill('correcta1234');
      await page.getByRole('button', { name: 'Ingresar', exact: true }).click();
      await page.waitForURL('**/panel', { timeout: 3000 });
    }).toPass({ timeout: 15000 });
  });

  test('enlaces cruzados: olvide contrasena y registro', async ({ page }) => {
    await page.goto('/ingresar');
    await expect(page.getByRole('link', { name: '¿Olvidaste tu contraseña?' })).toHaveAttribute('href', '/recuperar');
    await expect(page.getByRole('link', { name: 'Regístrate gratis' })).toHaveAttribute('href', '/registro');
  });
});

test.describe('Registro', () => {
  test('campos requeridos, casilla de terminos y enlaces legales', async ({ page }) => {
    await page.goto('/registro');
    await expect(page.getByRole('heading', { name: 'Crea tu cuenta gratis' })).toBeVisible();
    for (const l of ['Tu nombre', 'Correo electrónico', 'Contraseña']) await expect(page.getByLabel(l, { exact: true })).toBeVisible();
    await expect(page.getByRole('checkbox')).toBeVisible();
    await expect(page.getByRole('main').getByRole('link', { name: 'Términos' })).toHaveAttribute('href', '/terminos');
    await expect(page.getByRole('main').getByRole('link', { name: 'Aviso de privacidad' })).toHaveAttribute('href', '/privacidad');
    await expect(page.getByText('Mínimo 8 caracteres.')).toBeVisible();
  });

  test('sin aceptar terminos no se envia el registro (nativo) y Google exige aceptar (mensaje en espanol)', async ({ page }) => {
    const calls = await mockAuth(page, () => ({ status: 400, body: { message: 'bloqueado' } }));
    await page.goto('/registro');
    await page.waitForLoadState('networkidle');
    await page.getByLabel('Tu nombre').fill('Persona QA');
    await page.getByLabel('Correo electrónico').fill('qa@example.invalid');
    await page.getByLabel('Contraseña', { exact: true }).fill('clave-segura-1');
    await page.getByRole('button', { name: 'Crear cuenta' }).click();
    await page.waitForTimeout(400);
    expect(calls).toEqual([]);
    await expect(async () => {
      await page.getByRole('button', { name: 'Continuar con Google' }).click();
      await expect(page.getByRole('alert')).toBeVisible({ timeout: 1500 });
    }).toPass({ timeout: 15000 });
    await expect(page.getByRole('alert')).toHaveText('Debes aceptar los Términos y el Aviso de privacidad.');
    expect(calls).toEqual([]);
  });

  test('registro con correo ya existente -> mensaje en espanol', async ({ page }) => {
    await mockAuth(page, () => ({ status: 422, body: { code: 'user_already_exists', message: 'User already registered' } }));
    await page.goto('/registro');
    await hydrated(page);
    await expect(async () => {
      await page.getByLabel('Tu nombre').fill('Persona QA');
      await page.getByLabel('Correo electrónico').fill('qa@example.invalid');
      await page.getByLabel('Contraseña', { exact: true }).fill('clave-segura-1');
      await page.getByRole('checkbox').check();
      await page.getByRole('button', { name: 'Crear cuenta' }).click();
      await expect(page.getByRole('alert')).toBeVisible({ timeout: 2000 });
    }).toPass({ timeout: 15000 });
    await expect(page.getByRole('alert')).toContainText('Ese correo ya está registrado');
  });

  test('contrasena debil -> mensaje en espanol', async ({ page }) => {
    await mockAuth(page, () => ({ status: 422, body: { code: 'weak_password', message: 'Password should be at least 8 characters' } }));
    await page.goto('/registro');
    await hydrated(page);
    await expect(async () => {
      await page.getByLabel('Tu nombre').fill('Persona QA');
      await page.getByLabel('Correo electrónico').fill('qa@example.invalid');
      await page.getByLabel('Contraseña', { exact: true }).fill('12345678');
      await page.getByRole('checkbox').check();
      await page.getByRole('button', { name: 'Crear cuenta' }).click();
      await expect(page.getByRole('alert')).toBeVisible({ timeout: 2000 });
    }).toPass({ timeout: 15000 });
    await expect(page.getByRole('alert')).toContainText('muy débil');
  });

  test('registro con confirmacion de correo muestra aviso (sin sesion)', async ({ page }) => {
    const calls = await mockAuth(page, () => ({ status: 200, body: { id: '00000000-0000-4000-8000-000000000009', aud: 'authenticated', email: 'qa@example.invalid', identities: [{}] } }));
    await page.goto('/registro');
    await hydrated(page);
    await expect(async () => {
      await page.getByLabel('Tu nombre').fill('Persona QA');
      await page.getByLabel('Correo electrónico').fill('qa@example.invalid');
      await page.getByLabel('Contraseña', { exact: true }).fill('clave-segura-1');
      await page.getByRole('checkbox').check();
      await page.getByRole('button', { name: 'Crear cuenta' }).click();
      await expect(page.getByRole('status')).toBeVisible({ timeout: 2000 });
    }).toPass({ timeout: 15000 });
    await expect(page.getByRole('status')).toContainText('Te enviamos un correo para confirmar tu cuenta');
    expect(calls.find((c) => c.path.startsWith('signup'))!.body.data.full_name).toBe('Persona QA');
  });
});

test.describe('Recuperar y restablecer', () => {
  test('recuperar: mensaje neutro (no revela si el correo existe)', async ({ page }) => {
    const calls = await mockAuth(page, () => ({ status: 200, body: {} }));
    await page.goto('/recuperar');
    await expect(async () => {
      await page.getByLabel('Correo electrónico').fill('nadie@example.invalid');
      await page.getByRole('button', { name: 'Enviar enlace' }).click();
      await expect(page.getByRole('status')).toBeVisible({ timeout: 2000 });
    }).toPass({ timeout: 15000 });
    await expect(page.getByRole('status')).toContainText('Si ese correo está registrado');
    expect(calls.some((c) => c.path.startsWith('recover'))).toBe(true);
  });

  test('recuperar: mismo mensaje aunque el servidor diga "user not found"', async ({ page }) => {
    await mockAuth(page, () => ({ status: 400, body: { code: 'user_not_found', message: 'User not found' } }));
    await page.goto('/recuperar');
    await expect(async () => {
      await page.getByLabel('Correo electrónico').fill('nadie@example.invalid');
      await page.getByRole('button', { name: 'Enviar enlace' }).click();
      await expect(page.getByRole('status')).toBeVisible({ timeout: 2000 });
    }).toPass({ timeout: 15000 });
    await expect(page.getByRole('status')).toContainText('Si ese correo está registrado');
  });

  test('recuperar: limite de envios muestra error en espanol', async ({ page }) => {
    await mockAuth(page, () => ({ status: 429, body: { code: 'over_email_send_rate_limit', message: 'email rate limit exceeded' } }));
    await page.goto('/recuperar');
    await expect(async () => {
      await page.getByLabel('Correo electrónico').fill('qa@example.invalid');
      await page.getByRole('button', { name: 'Enviar enlace' }).click();
      await expect(page.getByRole('alert')).toBeVisible({ timeout: 2000 });
    }).toPass({ timeout: 15000 });
    await expect(page.getByRole('alert')).toContainText('Demasiados intentos');
  });

  test('restablecer sin enlace valido: aviso y enlace a /recuperar', async ({ page }) => {
    await page.goto('/restablecer');
    await expect(page.getByText('Verificando tu enlace…')).toBeVisible();
    await expect(page.getByRole('alert')).toContainText('El enlace no es válido o ya venció', { timeout: 6000 });
    await expect(page.getByRole('link', { name: 'Recuperar contraseña' })).toHaveAttribute('href', '/recuperar');
  });

  test('restablecer con sesion de recuperacion: contrasenas distintas -> error; iguales -> /panel', async ({ page }) => {
    await seedSession(page);
    const { buildSession } = await import('../helpers/mockSupabase');
    const s = buildSession('entrepreneur') as any;
    await mockRestAll(page);
    const calls = await mockAuth(page, () => ({ status: 200, body: s.user }));
    await page.goto('/restablecer');
    await expect(page.getByRole('heading', { name: 'Nueva contraseña' })).toBeVisible();
    await expect(page.getByLabel('Nueva contraseña')).toBeVisible();
    await page.getByLabel('Nueva contraseña').fill('nueva-clave-1');
    await page.getByLabel('Confirma la contraseña').fill('otra-clave-123');
    await page.getByRole('button', { name: 'Guardar contraseña' }).click();
    await expect(page.getByRole('alert')).toHaveText('Las contraseñas no coinciden.');
    expect(calls.filter((c) => c.path.startsWith('user') && c.body?.password)).toEqual([]);
    await page.getByLabel('Confirma la contraseña').fill('nueva-clave-1');
    await page.getByRole('button', { name: 'Guardar contraseña' }).click();
    await page.waitForURL('**/panel');
  });
});

test.describe('Consola en paginas de autenticacion', () => {
  for (const p of ['/ingresar', '/registro', '/recuperar']) {
    test(`${p} sin errores de consola ni hidratacion`, async ({ page }) => {
      const w = watch(page);
      await page.goto(p);
      await page.waitForLoadState('networkidle');
      expect(w.errors).toEqual([]);
    });
  }
});
