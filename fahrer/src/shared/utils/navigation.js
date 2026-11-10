// Navigations-Link fuer eine Fahrt. Oeffnet Google Maps mit Route vom aktuellen Standort
// ueber den Gast (Zwischenziel) zum Endort. Auf dem iPhone springt der Link in die
// Google-Maps-App, wenn sie installiert ist, sonst in den Browser.
import { adresseFuerNavigation } from '../adresseKurz';


// Ein Ort als Zieltext: Koordinaten wenn vorhanden, sonst Name + Adresse.
const toDestination = (location) => {
  if (!location || typeof location !== 'object') return '';
  const lat = Number(location.lat ?? location.latitude);
  const lng = Number(location.lng ?? location.longitude);
  if (Number.isFinite(lat) && Number.isFinite(lng)) return `${lat},${lng}`;
  // Eigener Ort der Dispo: nur die Adresse. Den Ortsnamen ("Mercedes Event Location") kennt Maps nicht.
  if (location.ortId && String(location.address || '').trim()) return adresseFuerNavigation('', location.address);
  return adresseFuerNavigation(location.name, location.address);
};

// Route: aktueller Standort -> Gast (waypoint) -> Endort (destination).
// Fehlt der Endort, geht die Route nur bis zum Gast. Ohne brauchbare Orte kein Link.
export const getRouteNavigationUrl = (pickup, dropoff, zwischenstopps = []) => {
  const pickupText = toDestination(pickup);
  const dropoffText = toDestination(dropoff);
  if (!pickupText && !dropoffText) return '';
  const params = new URLSearchParams({ api: '1', travelmode: 'driving' });
  if (pickupText && dropoffText) {
    // Google Maps erlaubt 9 Zwischenziele, der Gast zaehlt mit.
    const stopps = (Array.isArray(zwischenstopps) ? zwischenstopps : []).map((t) => String(t || '').trim()).filter(Boolean).slice(0, 8);
    params.set('waypoints', [pickupText, ...stopps].join('|'));
    params.set('destination', dropoffText);
  } else {
    params.set('destination', dropoffText || pickupText);
  }
  return `https://www.google.com/maps/dir/?${params.toString()}`;
};

// Einzelziel, falls irgendwo nur ein Ort verlinkt werden soll.
export const getNavigationUrl = (location) => getRouteNavigationUrl(location, null);
