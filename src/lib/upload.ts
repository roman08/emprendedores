import imageCompression from 'browser-image-compression';
import { supabase } from './supabase';

/** Comprime a WebP (máx. ~0.8 MB / 1600 px) y sube al bucket. Devuelve la URL pública. */
export async function uploadImage(bucket: 'listing-images' | 'business-media', userId: string, file: File, folder = '') {
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
  return supabase.storage.from(bucket).getPublicUrl(path).data.publicUrl;
}

/** Borra el archivo del bucket a partir de su URL pública (best effort). */
export async function removeImage(bucket: 'listing-images' | 'business-media', url: string) {
  const marker = `/${bucket}/`;
  const i = url.indexOf(marker);
  if (i === -1) return;
  await supabase.storage.from(bucket).remove([decodeURIComponent(url.slice(i + marker.length))]);
}
