import type { APIRoute } from 'astro';

export const GET: APIRoute = ({ site, url }) => {
  const origin = (site ?? url).origin;
  const body = [
    'User-agent: *',
    'Allow: /',
    'Disallow: /panel',
    'Disallow: /admin',
    'Disallow: /favoritos',
    'Disallow: /flyer',
    'Disallow: /ir/',
    'Disallow: /api/',
    '',
    `Sitemap: ${origin}/sitemap.xml`,
    '',
  ].join('\n');
  return new Response(body, { headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'public, max-age=3600' } });
};
