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

// Routenpunkte der Dispo (jobs.routen_punkte, 15.11.): {lat, lng, nach}, nach = Abschnitt
// (0 = Abholung bis Stopp 1, k = nach Stopp k). Als Koordinaten in ihren Abschnitt einreihen.
const punktText = (p) => `${Number(p.lat).toFixed(6)},${Number(p.lng ?? p.lon).toFixed(6)}`;
const mitRoutenPunkten = (stopps, routenPunkte) => {
  const punkte = (Array.isArray(routenPunkte) ? routenPunkte : [])
    .filter((p) => Number.isFinite(Number(p?.lat)) && Number.isFinite(Number(p?.lng ?? p?.lon)));
  if (punkte.length === 0) return stopps;
  const folge = [];
  for (let abschnitt = 0; abschnitt <= stopps.length; abschnitt += 1) {
    punkte.filter((p) => Math.min(Math.max(0, Math.floor(Number(p.nach) || 0)), stopps.length) === abschnitt)
      .forEach((p) => folge.push(punktText(p)));
    if (abschnitt < stopps.length) folge.push(stopps[abschnitt]);
  }
  return folge;
};

// Route: aktueller Standort -> Gast (waypoint) -> Endort (destination).
// Fehlt der Endort, geht die Route nur bis zum Gast. Ohne brauchbare Orte kein Link.
export const getRouteNavigationUrl = (pickup, dropoff, zwischenstopps = [], routenPunkte = []) => {
  const pickupText = toDestination(pickup);
  const dropoffText = toDestination(dropoff);
  if (!pickupText && !dropoffText) return '';
  const params = new URLSearchParams({ api: '1', travelmode: 'driving' });
  if (pickupText && dropoffText) {
    // Google Maps erlaubt 9 Zwischenziele, der Gast zaehlt mit.
    const stopps = (Array.isArray(zwischenstopps) ? zwischenstopps : []).map((t) => String(t || '').trim()).filter(Boolean).slice(0, 8);
    params.set('waypoints', [pickupText, ...mitRoutenPunkten(stopps, routenPunkte)].slice(0, 9).join('|'));
    params.set('destination', dropoffText);
  } else {
    params.set('destination', dropoffText || pickupText);
  }
  return `https://www.google.com/maps/dir/?${params.toString()}`;
};

// Einzelziel, falls irgendwo nur ein Ort verlinkt werden soll.
export const getNavigationUrl = (location) => getRouteNavigationUrl(location, null);
