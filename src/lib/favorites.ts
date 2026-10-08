/**
 * Favoritos ("Guardados") sin cuenta: viven solo en el navegador (localStorage), sin backend.
 * Si el almacenamiento está bloqueado, se conservan en memoria mientras dure la página.
 */
export type FavKind = 'listing' | 'business';
export interface Favorites { listings: string[]; businesses: string[] }
export type ToggleResult = 'added' | 'removed' | 'full';

export const FAV_KEY = 'fav';
export const FAV_VERSION = 1;
export const FAV_LIMIT = 200;
export const FAV_EVENT = 'favorites:changed';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const isUuid = (v: unknown): v is string => typeof v === 'string' && UUID_RE.test(v);

/** Solo uuids válidos, en minúsculas, sin repetidos y hasta `max`. */
export function cleanIds(input: unknown, max = FAV_LIMIT): string[] {
  if (!Array.isArray(input)) return [];
  const out: string[] = [];
  for (const v of input) {
    if (!isUuid(v)) continue;
    const id = v.toLowerCase();
    if (!out.includes(id)) out.push(id);
    if (out.length >= max) break;
  }
  return out;
}

/** Lee ?ids=a,b,c de un enlace compartido (validado y limitado). */
export function parseSharedIds(raw: string | null | undefined, max = 50): string[] {
  return raw ? cleanIds(raw.split(','), max) : [];
}

let memory: Favorites = { listings: [], businesses: [] };

function read(): Favorites {
  try {
    const raw = localStorage.getItem(FAV_KEY);
    let data: any = null;
    try { data = raw ? JSON.parse(raw) : null; } catch { /* JSON dañado: se trata como vacío */ }
    if (!data || typeof data !== 'object' || data.v !== FAV_VERSION) {
      memory = { listings: [], businesses: [] };
      return memory;
    }
    memory = { listings: cleanIds(data.listings), businesses: cleanIds(data.businesses) };
  } catch { /* almacenamiento bloqueado o JSON dañado: se usa la memoria */ }
  return memory;
}

function write(f: Favorites): void {
  memory = f;
  try {
    localStorage.setItem(FAV_KEY, JSON.stringify({ v: FAV_VERSION, listings: f.listings, businesses: f.businesses }));
  } catch { /* sin almacenamiento: queda en memoria */ }
  try {
    window.dispatchEvent(new CustomEvent(FAV_EVENT));
  } catch { /* sin window (SSR) */ }
}

const listOf = (f: Favorites, kind: FavKind) => (kind === 'listing' ? f.listings : f.businesses);

export function getFavorites(): Favorites {
  const f = read();
  return { listings: [...f.listings], businesses: [...f.businesses] };
}

export function isFavorite(kind: FavKind, id: string): boolean {
  return listOf(read(), kind).includes(id.toLowerCase());
}

export function countFavorites(): number {
  const f = read();
  return f.listings.length + f.businesses.length;
}

/** Agrega o quita. Los más recientes quedan primero. 'full' si ya se alcanzó el límite. */
export function toggle(kind: FavKind, id: string): ToggleResult {
  const key = id.toLowerCase();
  const cur = getFavorites();
  const list = listOf(cur, kind);
  const i = list.indexOf(key);
  if (i >= 0) {
    list.splice(i, 1);
    write(cur);
    return 'removed';
  }
  if (!isUuid(key) || list.length >= FAV_LIMIT) return 'full';
  list.unshift(key);
  write(cur);
  return 'added';
}

/** Quita varios ids de una vez (p. ej. elementos que ya no existen). */
export function removeMany(kind: FavKind, ids: string[]): void {
  if (ids.length === 0) return;
  const cur = getFavorites();
  const drop = new Set(ids.map((x) => x.toLowerCase()));
  const next = listOf(cur, kind).filter((x) => !drop.has(x));
  if (kind === 'listing') cur.listings = next; else cur.businesses = next;
  write(cur);
}

/** Avisa de cambios en esta pestaña y en las demás (evento 'storage'). Devuelve la función para cancelar. */
export function onChange(cb: () => void): () => void {
  const onStorage = (e: StorageEvent) => { if (e.key === null || e.key === FAV_KEY) cb(); };
  window.addEventListener(FAV_EVENT, cb);
  window.addEventListener('storage', onStorage);
  return () => {
    window.removeEventListener(FAV_EVENT, cb);
    window.removeEventListener('storage', onStorage);
  };
}
