// Detecta los navegadores integrados de apps (Facebook, Messenger, Instagram, TikTok…).
// Google bloquea el inicio de sesión (OAuth) dentro de ellos ("disallowed_useragent"), y el enlace de un post de
// Facebook se abre justamente ahí: en esos casos hay que pedir que abran la página en Chrome o Safari.
// Devuelve el nombre de la app o null si es un navegador normal.

const APPS: [RegExp, string][] = [
  [/FBAN|FBAV|FB_IAB|FBIOS|FBSS/i, 'Facebook'],
  [/Instagram/i, 'Instagram'],
  [/musical_ly|BytedanceWebview|TikTok|ByteLocale/i, 'TikTok'],
  [/Snapchat/i, 'Snapchat'],
  [/LinkedInApp/i, 'LinkedIn'],
  [/Twitter|TwitterAndroid/i, 'X (Twitter)'],
  [/\bLine\//i, 'LINE'],
];

export function detectInAppBrowser(ua: string = typeof navigator === 'undefined' ? '' : navigator.userAgent): string | null {
  for (const [re, name] of APPS) if (re.test(ua)) return name;
  // WebView genérico de Android ("; wv)")
  if (/Android/i.test(ua) && /;\s*wv\)/i.test(ua)) return 'esta aplicación';
  // WebView de iOS: WebKit sin el token "Safari" (Safari, Chrome y Firefox en iOS sí lo incluyen)
  if (/(iPhone|iPod|iPad)/i.test(ua) && /AppleWebKit/i.test(ua) && !/Safari/i.test(ua)) return 'esta aplicación';
  return null;
}
