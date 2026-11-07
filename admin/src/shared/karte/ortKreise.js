// Radien eines eigenen Orts auf der Karte: innen der Reinfahr-Radius (gefuellt,
// transparent), aussen der Rausfahr-Radius (nur Rand, gestrichelt). Dazu ein
// kleines Schild mit Name und Radien ueber dem Pin.
// Arbeitet auf der Karte aus maplibreKarte.js (window.trisarKarte.Map).
import * as maplibregl from 'maplibre-gl';

const LIME = '#E3F654';
const ERDRADIUS_M = 6371008.8;

const kreisPolygon = (lat, lng, radiusMeter, schritte = 72) => {
  const punkte = [];
  const breite = (lat * Math.PI) / 180;
  for (let i = 0; i <= schritte; i += 1) {
    const winkel = (i / schritte) * 2 * Math.PI;
    const dy = (radiusMeter * Math.cos(winkel)) / ERDRADIUS_M;
    const dx = (radiusMeter * Math.sin(winkel)) / (ERDRADIUS_M * Math.cos(breite));
    punkte.push([lng + (dx * 180) / Math.PI, lat + (dy * 180) / Math.PI]);
  }
  return { type: 'Feature', properties: {}, geometry: { type: 'Polygon', coordinates: [punkte] } };
};

const leer = { type: 'FeatureCollection', features: [] };

// Ebenen einmal je Karte anlegen, danach nur die Daten tauschen.
const ebenenAnlegen = (map, kennung) => {
  const rein = `${kennung}-rein`;
  const raus = `${kennung}-raus`;
  if (!map.getSource(rein)) map.addSource(rein, { type: 'geojson', data: leer });
  if (!map.getSource(raus)) map.addSource(raus, { type: 'geojson', data: leer });
  if (!map.getLayer(`${rein}-flaeche`)) {
    map.addLayer({ id: `${rein}-flaeche`, type: 'fill', source: rein, paint: { 'fill-color': LIME, 'fill-opacity': 0.18 } });
  }
  if (!map.getLayer(`${rein}-rand`)) {
    map.addLayer({ id: `${rein}-rand`, type: 'line', source: rein, paint: { 'line-color': LIME, 'line-width': 1.5, 'line-opacity': 0.9 } });
  }
  if (!map.getLayer(`${raus}-rand`)) {
    map.addLayer({
      id: `${raus}-rand`,
      type: 'line',
      source: raus,
      paint: { 'line-color': LIME, 'line-width': 2, 'line-opacity': 0.9, 'line-dasharray': [3, 2] },
    });
  }
};

// karte: Instanz aus maplibreKarte.js. ort: { lat, lng, radius_rein_m, radius_raus_m } oder null.
export const ortKreiseZeigen = (karte, ort, kennung = 'ort-kreise') => {
  if (!karte?.karte || typeof karte.bereit !== 'function') return;
  karte.bereit(() => {
    const map = karte.karte;
    try {
      ebenenAnlegen(map, kennung);
      const lat = Number(ort?.lat);
      const lng = Number(ort?.lng);
      const gueltig = ort && Number.isFinite(lat) && Number.isFinite(lng);
      const rein = Math.max(0, Number(ort?.radius_rein_m) || 0);
      const raus = Math.max(0, Number(ort?.radius_raus_m) || 0);
      map.getSource(`${kennung}-rein`)?.setData(gueltig && rein > 0 ? kreisPolygon(lat, lng, rein) : leer);
      map.getSource(`${kennung}-raus`)?.setData(gueltig && raus > 0 ? kreisPolygon(lat, lng, raus) : leer);
    } catch {
      // Karte schon abgebaut
    }
  });
};

export const ortKreiseAusblenden = (karte, kennung = 'ort-kreise') => ortKreiseZeigen(karte, null, kennung);

// Schild mit Name und Radien ueber dem Pin, im Stil der Kartenblasen.
export const ortSchildBauen = () => {
  const element = document.createElement('div');
  Object.assign(element.style, {
    pointerEvents: 'none',
    background: '#000000',
    border: `2px solid ${LIME}`,
    padding: '4px 8px',
    fontFamily: 'Space Grotesk, sans-serif',
    whiteSpace: 'nowrap',
    textAlign: 'center',
    lineHeight: '1.25',
  });
  const name = document.createElement('div');
  Object.assign(name.style, { color: LIME, fontSize: '13px', fontWeight: '700' });
  const radien = document.createElement('div');
  Object.assign(radien.style, { color: LIME, opacity: '0.6', fontSize: '11px', fontWeight: '500' });
  element.append(name, radien);
  const marker = new maplibregl.Marker({ element, anchor: 'bottom', offset: [0, -22] });
  return {
    zeigen(karte, ort, radienText) {
      if (!karte?.karte || !ort) return;
      name.textContent = ort.name || '';
      radien.textContent = radienText || '';
      marker.setLngLat([Number(ort.lng), Number(ort.lat)]);
      marker.addTo(karte.karte);
    },
    ausblenden() {
      marker.remove();
    },
  };
};
