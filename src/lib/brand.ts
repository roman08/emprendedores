// Identidad de marca: UN solo lugar para nombre, eslogan y datos legales.
// Lo usan el layout, el logo, los mensajes para compartir y las páginas legales (términos y privacidad).
// Si cambias `name` o `themeColor`, regenera iconos e imagen OG: node scripts/make-icons.mjs && node scripts/make-og.mjs
// (los scripts leen los textos desde este archivo). Los colores del sitio viven en src/styles/global.css (--color-brand-*).

// Dominio público: PUBLIC_SITE_URL o SITE_URL; si faltan queda vacío y se usa el origen de la petición.
const envSite = (
  (typeof process !== 'undefined' ? process.env?.PUBLIC_SITE_URL || process.env?.SITE_URL : '') ||
  (import.meta.env as Record<string, string | undefined>).PUBLIC_SITE_URL ||
  (import.meta.env as Record<string, string | undefined>).SITE_URL ||
  ''
)
  .trim()
  .replace(/\/$/, '');

export const BRAND = {
  /** Nombre de la marca. */
  name: 'Por la Esquina',
  /** Versión corta para el manifiesto y espacios reducidos. */
  shortName: 'Por la Esquina',
  tagline: 'Negocios locales a un mensaje',
  /** Meta description por defecto de todo el sitio. */
  description: 'Descubre negocios, productos y servicios de emprendedores locales y contáctalos directo por WhatsApp.',

  // --- Datos legales: COMPLETAR antes del lanzamiento (los usan términos y privacidad) ---
  /** Razón social o nombre completo de la persona responsable del sitio. */
  legalName: '',
  /** Correo para dudas, derechos ARCO y reportes. */
  contactEmail: '',
  /** Domicilio de la persona responsable (el aviso de privacidad lo exige en México). */
  address: '',
  jurisdiction: 'Tabasco, México',
  /** Fecha de la última actualización de los textos legales. Actualízala al cambiarlos. */
  updatedAt: '8 de octubre de 2026',

  /** Dominio sin protocolo (p. ej. "tudominio.com"); sale de PUBLIC_SITE_URL / SITE_URL. */
  domain: envSite.replace(/^https?:\/\//, ''),
  /** URL completa del sitio ("https://tudominio.com") o vacío si no está configurada. */
  site: envSite,
  /** Color de la barra del navegador en móvil; debe coincidir con brand-600. */
  themeColor: '#0e8571',
} as const;

/** Título de página: "Sección · Marca" o "Marca · Eslogan" en la portada. */
export function pageTitle(title?: string): string {
  return title ? `${title} · ${BRAND.name}` : `${BRAND.name} · ${BRAND.tagline}`;
}
