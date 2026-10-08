import { beforeEach, describe, expect, it, vi } from 'vitest';
import { FAV_KEY, FAV_LIMIT, cleanIds, countFavorites, getFavorites, isFavorite, onChange, parseSharedIds, removeMany, toggle } from './favorites';

const uuid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;

function fakeStorage(blocked = false) {
  const data = new Map<string, string>();
  return {
    data,
    getItem: (k: string) => { if (blocked) throw new Error('blocked'); return data.get(k) ?? null; },
    setItem: (k: string, v: string) => { if (blocked) throw new Error('blocked'); data.set(k, v); },
    removeItem: (k: string) => { data.delete(k); },
  };
}

let storage: ReturnType<typeof fakeStorage>;
beforeEach(() => {
  storage = fakeStorage();
  vi.stubGlobal('localStorage', storage);
  vi.stubGlobal('window', new EventTarget());
  storage.data.clear();
  removeMany('listing', getFavorites().listings);
  removeMany('business', getFavorites().businesses);
});

describe('favoritos', () => {
  it('agrega, consulta y quita, con lo más reciente primero', () => {
    expect(toggle('listing', uuid(1))).toBe('added');
    expect(toggle('listing', uuid(2))).toBe('added');
    expect(isFavorite('listing', uuid(1))).toBe(true);
    expect(isFavorite('business', uuid(1))).toBe(false);
    expect(getFavorites().listings).toEqual([uuid(2), uuid(1)]);
    expect(toggle('listing', uuid(1))).toBe('removed');
    expect(isFavorite('listing', uuid(1))).toBe(false);
    expect(countFavorites()).toBe(1);
  });

  it('persiste con versión de esquema y descarta datos dañados o ajenos', () => {
    toggle('business', uuid(3));
    expect(JSON.parse(storage.data.get(FAV_KEY)!)).toEqual({ v: 1, listings: [], businesses: [uuid(3)] });
    storage.data.set(FAV_KEY, '{no es json');
    expect(getFavorites()).toEqual({ listings: [], businesses: [] });
    storage.data.set(FAV_KEY, JSON.stringify({ v: 99, listings: [uuid(1)], businesses: [] }));
    expect(getFavorites().listings).toEqual([]);
  });

  it('ignora al leer valores que no son uuid', () => {
    storage.data.set(FAV_KEY, JSON.stringify({ v: 1, listings: [uuid(1), 'x', 5, "<script>", uuid(1)], businesses: 'no' }));
    expect(getFavorites()).toEqual({ listings: [uuid(1)], businesses: [] });
  });

  it('rechaza ids inválidos y respeta el límite', () => {
    expect(toggle('listing', 'no-uuid')).toBe('full');
    for (let i = 1; i <= FAV_LIMIT; i++) expect(toggle('listing', uuid(i))).toBe('added');
    expect(toggle('listing', uuid(FAV_LIMIT + 1))).toBe('full');
    expect(getFavorites().listings).toHaveLength(FAV_LIMIT);
    expect(toggle('listing', uuid(1))).toBe('removed');
  });

  it('removeMany quita varios ids', () => {
    toggle('listing', uuid(1)); toggle('listing', uuid(2)); toggle('listing', uuid(3));
    removeMany('listing', [uuid(1), uuid(3)]);
    expect(getFavorites().listings).toEqual([uuid(2)]);
  });

  it('funciona en memoria si localStorage está bloqueado', () => {
    vi.stubGlobal('localStorage', fakeStorage(true));
    expect(toggle('listing', uuid(7))).toBe('added');
    expect(isFavorite('listing', uuid(7))).toBe(true);
  });

  it('onChange avisa al cambiar, ante un evento storage y deja de avisar al cancelar', () => {
    const cb = vi.fn();
    const off = onChange(cb);
    toggle('listing', uuid(1));
    expect(cb).toHaveBeenCalledTimes(1);
    const ev = new Event('storage') as Event & { key?: string };
    ev.key = FAV_KEY;
    (window as unknown as EventTarget).dispatchEvent(ev);
    expect(cb).toHaveBeenCalledTimes(2);
    off();
    toggle('listing', uuid(2));
    expect(cb).toHaveBeenCalledTimes(2);
  });
});

describe('ids compartidos', () => {
  it('cleanIds filtra, normaliza y limita', () => {
    expect(cleanIds([uuid(1).toUpperCase(), uuid(1), 'x'])).toEqual([uuid(1)]);
    expect(cleanIds('no es lista')).toEqual([]);
  });

  it('parseSharedIds valida y limita a 50', () => {
    const many = Array.from({ length: 80 }, (_, i) => uuid(i + 1)).join(',');
    expect(parseSharedIds(many)).toHaveLength(50);
    expect(parseSharedIds(`${uuid(1)},basura,${uuid(2)}`)).toEqual([uuid(1), uuid(2)]);
    expect(parseSharedIds(null)).toEqual([]);
  });
});
