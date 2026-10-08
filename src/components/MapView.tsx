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
      // El nombre lo escribe el dueño del negocio: se pasa como nodo DOM con textContent (un string se interpretaría como HTML)
      const popup = document.createElement('strong');
      popup.textContent = label ?? 'Ubicación';
      L.circleMarker([lat, lng], { radius: 10, color: '#0e8571', fillColor: '#14a38b', fillOpacity: 0.9 })
        .addTo(map)
        .bindPopup(popup);
      // Si el contenedor cambió de tamaño al hidratar, Leaflet debe recalcular o el mapa queda en blanco
      requestAnimationFrame(() => map?.invalidateSize());
    })();
    return () => { map?.remove(); };
  }, [lat, lng, label]);

  return <div ref={ref} style={{ height }} className="z-0 w-full overflow-hidden rounded-2xl border border-line" />;
}
