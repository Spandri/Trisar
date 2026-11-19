// Blauer Standortpunkt der Dispo auf der Karte (17.11.2026): wie in Apple/Google Maps,
// blauer Punkt mit weissem Rand, ruhig (kein Pulsieren, kein Genauigkeitskreis), ohne Beschriftung.
// Ohne Standort kein Punkt.
import * as maplibregl from 'maplibre-gl';

const PUNKT_STIL = [
  'width:18px', 'height:18px', 'border-radius:50%', 'background:#1A73E8',
  'border:3px solid #fff', 'box-shadow:0 0 0 1px rgba(0,0,0,.15), 0 1px 4px rgba(0,0,0,.35)',
  'box-sizing:border-box', 'pointer-events:none',
].join(';');

const HOF_STIL = [
  'position:absolute', 'left:50%', 'top:50%', 'transform:translate(-50%,-50%)', 'border-radius:50%',
  'background:rgba(26,115,232,.15)', 'border:1px solid rgba(26,115,232,.35)', 'pointer-events:none',
].join(';');

const HOF_ZEIGEN = false;

// Meter je Pixel bei Zoom z und Breite lat (Web-Mercator, 512er Kacheln wie MapLibre)
const meterJePixel = (lat, zoom) => (40075016.686 * Math.cos((lat * Math.PI) / 180)) / (512 * 2 ** zoom);

export class EigenerPunkt {
  constructor(karte) {
    this.karte = karte; // maplibregl.Map
    this.element = document.createElement('div');
    this.element.style.cssText = 'position:relative;width:18px;height:18px;pointer-events:none';
    this.hof = document.createElement('div');
    this.hof.style.cssText = HOF_STIL;
    const punkt = document.createElement('div');
    punkt.style.cssText = PUNKT_STIL;
    this.element.append(this.hof, punkt);
    this.marker = new maplibregl.Marker({ element: this.element, anchor: 'center' });
    this.stand = null;
    this.drauf = false;
    this.zoomGeaendert = () => this.hofSetzen();
    karte.on('zoom', this.zoomGeaendert);
  }

  setzen(stand) {
    this.stand = stand;
    if (!stand) { this.marker.remove(); this.drauf = false; return; }
    this.marker.setLngLat([stand.lng, stand.lat]);
    if (!this.drauf) { this.marker.addTo(this.karte); this.drauf = true; }
    this.hofSetzen();
  }

  hofSetzen() {
    // Nur ein ruhiger Punkt (User 17.11.): kein Genauigkeitskreis.
    if (!HOF_ZEIGEN || !this.stand?.genau) { this.hof.style.display = 'none'; return; }
    const px = (2 * this.stand.genau) / meterJePixel(this.stand.lat, this.karte.getZoom());
    // Nur zeigen, wenn der Kreis groesser als der Punkt ist
    this.hof.style.display = px > 22 ? 'block' : 'none';
    this.hof.style.width = `${Math.min(px, 600)}px`;
    this.hof.style.height = `${Math.min(px, 600)}px`;
  }

  entfernen() {
    this.karte.off('zoom', this.zoomGeaendert);
    this.marker.remove();
  }
}
