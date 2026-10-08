export const CURRENCY = 'MXN';
export const PHONE_PREFIX = '52';

export function formatPrice(price: number | null): string {
  if (price === null || price === undefined) return 'Consultar precio';
  return new Intl.NumberFormat('es-MX', { style: 'currency', currency: CURRENCY }).format(price);
}

/** Normaliza lo que escribe el usuario a dígitos con lada de país (MX: 52 + 10 dígitos). */
export function normalizeWhatsapp(input: string): string {
  const digits = input.replace(/\D/g, '');
  return digits.length === 10 ? PHONE_PREFIX + digits : digits;
}

export function waLink(number: string, text: string): string {
  return `https://wa.me/${number}?text=${encodeURIComponent(text)}`;
}

export function mapsLink(b: { lat: number | null; lng: number | null; google_maps_url: string | null }) {
  if (b.google_maps_url) return b.google_maps_url;
  if (b.lat !== null && b.lng !== null) return `https://www.google.com/maps?q=${b.lat},${b.lng}`;
  return null;
}

/** Devuelve la URL solo si es http(s); evita esquemas como javascript: en enlaces escritos por usuarios. */
export function safeHttpUrl(u: string | null | undefined): string | null {
  if (!u) return null;
  const s = u.trim();
  if (/^https?:\/\//i.test(s)) return s;
  // Sin esquema ("negocio.com"): se asume https, siempre que no traiga otro esquema (algo:)
  return /^[a-z][a-z0-9+.-]*:/i.test(s) ? null : `https://${s}`;
}

export function initials(name: string): string {
  return name.split(/\s+/).slice(0, 2).map((w) => w[0]?.toUpperCase() ?? '').join('');
}

/** JSON para <script type="application/ld+json">: escapa "<" para que un texto de usuario no pueda cerrar la etiqueta. */
export function ldJson(data: unknown): string {
  return JSON.stringify(data).replace(/</g, '\u003c');
}

/** Valor seguro para un url() de CSS en línea: solo http(s) y con los caracteres especiales codificados. */
export function cssUrl(u: string | null | undefined): string | null {
  const s = safeHttpUrl(u);
  // encodeURIComponent deja pasar ' ( ) sin codificar, por eso se codifica a mano
  return s ? `url("${s.replace(/["'()\\<>\s]/g, (c) => '%' + c.charCodeAt(0).toString(16).padStart(2, '0'))}")` : null;
}
