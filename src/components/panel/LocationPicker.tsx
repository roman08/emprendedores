import { useEffect, useId, useRef, useState } from 'react';
import 'leaflet/dist/leaflet.css';
import { geocode } from '../../lib/geocode';

interface Props {
  lat: number | null;
  lng: number | null;
  address: string;
  center: [number, number];
  onChange: (v: { lat: number; lng: number }) => void;
  onAddress: (v: string) => void;
}

/** Dirección -> pin en el mapa (geocodificación OSM). El pin se puede arrastrar o fijar con un clic. */
export default function LocationPicker({ lat, lng, address, center, onChange, onAddress }: Props) {
  const addrId = useId();
  const ref = useRef<HTMLDivElement>(null);
  const mapRef = useRef<import('leaflet').Map | undefined>(undefined);
  const markerRef = useRef<import('leaflet').Marker | undefined>(undefined);
  const leaflet = useRef<typeof import('leaflet') | undefined>(undefined);
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;
  const [msg, setMsg] = useState('');
  const [busy, setBusy] = useState(false);

  function place(L: typeof import('leaflet'), map: import('leaflet').Map, la: number, ln: number) {
    if (markerRef.current) markerRef.current.setLatLng([la, ln]);
    else {
      const icon = L.divIcon({
        className: '',
        html: '<div style="width:22px;height:22px;border-radius:50% 50% 50% 0;background:#0e8571;border:3px solid #fff;box-shadow:0 2px 6px rgba(0,0,0,.4);transform:rotate(-45deg)"></div>',
        iconSize: [22, 22],
        iconAnchor: [11, 22],
      });
      const m = L.marker([la, ln], { draggable: true, icon }).addTo(map);
      m.on('dragend', () => {
        const p = m.getLatLng();
        onChangeRef.current({ lat: p.lat, lng: p.lng });
      });
      markerRef.current = m;
    }
  }

  useEffect(() => {
    let alive = true;
    (async () => {
      const L = (await import('leaflet')).default;
      if (!alive || !ref.current) return;
      leaflet.current = L;
      const start: [number, number] = lat !== null && lng !== null ? [lat, lng] : center;
      const map = L.map(ref.current).setView(start, lat !== null ? 17 : 14);
      L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', { attribution: '&copy; OpenStreetMap', maxZoom: 19 }).addTo(map);
      map.on('click', (e) => {
        place(L, map, e.latlng.lat, e.latlng.lng);
        onChangeRef.current({ lat: e.latlng.lat, lng: e.latlng.lng });
      });
      mapRef.current = map;
      if (lat !== null && lng !== null) place(L, map, lat, lng);
    })();
    return () => {
      alive = false;
      mapRef.current?.remove();
      mapRef.current = undefined;
      markerRef.current = undefined;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function search() {
    if (!address.trim()) return;
    setBusy(true);
    setMsg('');
    try {
      const hit = await geocode(address, { country: 'mx' });
      if (!hit) {
        setMsg('No encontramos esa dirección. Haz clic en el mapa para colocar el pin manualmente.');
      } else {
        const la = hit.lat, ln = hit.lng;
        mapRef.current?.setView([la, ln], 17);
        if (leaflet.current && mapRef.current) place(leaflet.current, mapRef.current, la, ln);
        onChange({ lat: la, lng: ln });
        setMsg('Ubicación encontrada. Arrastra el pin si necesitas ajustarla.');
      }
    } catch {
      setMsg('No pudimos buscar la dirección. Coloca el pin con un clic en el mapa.');
    }
    setBusy(false);
  }

  return (
    <div className="space-y-3">
      <div>
        <label htmlFor={addrId} className="label">Dirección del local</label>
        <div className="flex gap-2">
          <input id={addrId} maxLength={300} className="input" value={address} onChange={(e) => onAddress(e.target.value)}
            placeholder="Calle, número, colonia, Cunduacán, Tabasco"
            onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); search(); } }} />
          <button type="button" className="btn btn-ghost shrink-0" onClick={search} disabled={busy}>{busy ? 'Buscando…' : 'Ubicar'}</button>
        </div>
        {msg && <p className="mt-1.5 text-xs text-muted">{msg}</p>}
      </div>
      <div ref={ref} className="z-0 h-72 w-full overflow-hidden rounded-2xl border border-line" />
      <p className="text-xs text-muted">
        {lat !== null ? 'Pin colocado ✔ — arrástralo o haz clic para moverlo.' : 'Haz clic en el mapa para colocar el pin si no encuentras tu dirección.'}
      </p>
    </div>
  );
}
