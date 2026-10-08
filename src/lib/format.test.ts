import { describe, expect, it } from 'vitest';
import { ldJson, safeMapsUrl, thumbUrl } from './format';

describe('thumbUrl', () => {
  const base = 'https://x.supabase.co/storage/v1/object/public/listing-images/uid/lid/abc-123.webp';
  it('apunta a la miniatura junto a la foto', () => {
    expect(thumbUrl(base)).toBe(base.replace('.webp', '.t.webp'));
    expect(thumbUrl(`${base}?v=2`)).toBe(base.replace('.webp', '.t.webp') + '?v=2');
  });
  it('no toca una miniatura, otros buckets ni valores vacíos', () => {
    const t = base.replace('.webp', '.t.webp');
    expect(thumbUrl(t)).toBe(t);
    const logo = 'https://x.supabase.co/storage/v1/object/public/business-media/uid/logo/a.webp';
    expect(thumbUrl(logo)).toBe(logo);
    expect(thumbUrl(null)).toBe('');
    expect(thumbUrl(undefined)).toBe('');
  });
});

describe('ldJson', () => {
  it('no deja pasar "<" ni ">" (no se puede cerrar el script)', () => {
    const out = ldJson({ name: '</script><img src=x onerror=alert(1)>' });
    expect(out).not.toContain('<');
    expect(out).not.toContain('>');
    expect(out.toLowerCase()).not.toContain('</script');
  });

  it('el JSON resultante sigue siendo equivalente al original', () => {
    const data = { name: '</script> & "x"    ', n: 3, list: ['<b>'] };
    expect(JSON.parse(ldJson(data))).toEqual(data);
  });
});

describe('safeMapsUrl', () => {
  it('acepta enlaces de mapas conocidos', () => {
    expect(safeMapsUrl('https://www.google.com/maps/place/x')).toBe('https://www.google.com/maps/place/x');
    expect(safeMapsUrl('https://maps.app.goo.gl/abc123')).toBe('https://maps.app.goo.gl/abc123');
    expect(safeMapsUrl('https://goo.gl/maps/abc')).toBe('https://goo.gl/maps/abc');
    expect(safeMapsUrl('https://www.openstreetmap.org/?mlat=1&mlon=2')).not.toBeNull();
    expect(safeMapsUrl('https://waze.com/ul?ll=1,2')).not.toBeNull();
  });

  it('rechaza otros sitios, esquemas raros y trucos de host', () => {
    expect(safeMapsUrl('https://sitio-malicioso.example')).toBeNull();
    expect(safeMapsUrl('https://www.google.com.evil.example/maps')).toBeNull();
    expect(safeMapsUrl('https://evil.example/?https://www.google.com/maps')).toBeNull();
    expect(safeMapsUrl('https://www.google.com@evil.example/maps')).toBeNull();
    expect(safeMapsUrl('http://www.google.com/maps')).toBeNull();
    expect(safeMapsUrl('javascript:alert(1)')).toBeNull();
    expect(safeMapsUrl('')).toBeNull();
    expect(safeMapsUrl(null)).toBeNull();
  });
});
