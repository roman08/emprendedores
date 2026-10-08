import { useEffect, useRef } from 'react';
import 'leaflet/dist/leaflet.css';

interface Props { lat: number; lng: number; label?: string; height?: number }

export default function MapView({ lat, lng, label, height = 240 }: Props) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let map: import('leaflet').Map | undefined;
    (async () => {
      const L = (await import('leaflet')).default;
      if (!ref.current) return;
      map = L.map(ref.current, { scrollWheelZoom: false }).setView([lat, lng], 16);
      L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
        attribution: '&copy; OpenStreetMap',
        maxZoom: 19,
      }).addTo(map);
      L.circleMarker([lat, lng], { radius: 10, color: '#0e8571', fillColor: '#14a38b', fillOpacity: 0.9 })
        .addTo(map)
        .bindPopup(label ?? 'Ubicación');
    })();
    return () => { map?.remove(); };
  }, [lat, lng, label]);

  return <div ref={ref} style={{ height }} className="z-0 w-full overflow-hidden rounded-2xl border border-line" />;
}
