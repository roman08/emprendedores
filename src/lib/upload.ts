import imageCompression from 'browser-image-compression';
import { supabase } from './supabase';

type Bucket = 'listing-images' | 'business-media';

const thumbPath = (path: string) => path.replace(/\.webp$/, '.t.webp');

/**
 * Comprime a WebP y sube al bucket. Devuelve la URL pública de la foto principal.
 * En listing-images sube además una miniatura (~480 px, ~20 KB) con el sufijo ".t.webp" para las tarjetas: así cada
 * listado transfiere ~10 veces menos datos (el plan gratuito de Supabase limita la transferencia mensual).
 */
export async function uploadImage(bucket: Bucket, userId: string, file: File, folder = '') {
  const small = await imageCompression(file, {
    // 1200 px de lado largo basta para la ficha (se muestra a ~800 px) y pesa ~40 % menos que 1600 px
    maxSizeMB: 0.5,
    maxWidthOrHeight: 1200,
    useWebWorker: true,
    fileType: 'image/webp',
  });
  const path = `${userId}/${folder ? folder + '/' : ''}${crypto.randomUUID()}.webp`;
  const { error } = await supabase.storage.from(bucket).upload(path, small, { contentType: 'image/webp', cacheControl: '31536000' });
  if (error) throw error;

  if (bucket === 'listing-images') {
    // La miniatura es una optimización: si falla, la tarjeta usa la foto completa
    try {
      const thumb = await imageCompression(file, { maxSizeMB: 0.06, maxWidthOrHeight: 480, useWebWorker: true, fileType: 'image/webp' });
      await supabase.storage.from(bucket).upload(thumbPath(path), thumb, { contentType: 'image/webp', cacheControl: '31536000' });
    } catch { /* sin miniatura */ }
  }
  return supabase.storage.from(bucket).getPublicUrl(path).data.publicUrl;
}

/** Borra el archivo (y su miniatura, si es de listing-images) a partir de su URL pública (best effort). */
export async function removeImage(bucket: Bucket, url: string) {
  const marker = `/${bucket}/`;
  const i = url.indexOf(marker);
  if (i === -1) return;
  const path = decodeURIComponent(url.slice(i + marker.length).split('?')[0]);
  await supabase.storage.from(bucket).remove(bucket === 'listing-images' ? [path, thumbPath(path)] : [path]);
}
