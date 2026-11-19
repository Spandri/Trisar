// Fahrzeugangaben fuer Fahrzeug-Seite und Fahrzeugkarte: Was wir nicht wissen,
// wird nicht gezeigt (kein "–", keine leere graue Bildflaeche). Gleiche Regeln
// in iOS (FahrzeugKarte.swift) und Android (FahrzeugKarte.kt).
import { DEMO_MODE } from '../datenquelle';

const text = (v) => (typeof v === 'string' ? v.trim() : '');
const zahl = (v) => {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

export const fahrzeugAngaben = (vehicle) => {
  const sitze = zahl(vehicle?.seat_count);
  const fuellstand = zahl(vehicle?.battery_fuel_percent);
  return {
    kennzeichen: text(vehicle?.license_plate),
    vin: text(vehicle?.vin),
    bild: text(vehicle?.image_url),
    modell: text(vehicle?.brand_model),
    ausstattung: text(vehicle?.trim),
    kraftstoff: text(vehicle?.fuel_type),
    farbe: text(vehicle?.color),
    sitze: sitze && sitze > 0 ? sitze : null,
    fuellstand,
    // Energie-Kachel nur mit echtem Fuellstand (Demo rechnet einen aus der VIN).
    energie: fuellstand !== null || DEMO_MODE,
  };
};

export const hatKacheln = (a) => Boolean(a.kraftstoff || a.farbe || a.energie || a.sitze);

// Fahrzeugkarte der Startseite (362 breit). Liefert Positionen und Hoehe aus
// den vorhandenen Angaben. Mit allem: Hoehe 268 wie bisher.
export const kartenRaster = (a, { bildOben = 63, bildDa = Boolean(a.bild) } = {}) => {
  let y = 52;
  const r = {};
  if (a.vin) { r.vin = 51.97; y = 68; }
  if (bildDa) { r.bild = bildOben; y = bildOben + 114.91; }
  if (hatKacheln(a)) { r.kacheln = y + 17.65; y = r.kacheln + 52; return { ...r, hoehe: y + 20.35 }; }
  return { ...r, hoehe: y + 16 };
};

// Fahrzeugblock der Fahrzeug-Seite (353 breit). Mit allem: Hoehe 332 wie bisher.
export const blockRaster = (a, { bildDa = Boolean(a.bild) } = {}) => {
  let y = 52;
  const r = {};
  if (a.vin) { r.vin = 51.97; y = 68; }
  if (bildDa) { r.bild = 75; y = 197; }
  if (a.modell) { r.modell = y + 13; y = r.modell + 20; }
  if (a.ausstattung) { r.ausstattung = a.modell ? y : y + 8; y = r.ausstattung + 16; }
  if (hatKacheln(a)) { r.kacheln = y + 24; y = r.kacheln + 52; return { ...r, hoehe: y + 10 }; }
  return { ...r, hoehe: y + 16 };
};

// --- Standortquelle -------------------------------------------------------
// driver_live_locations hat eine Zeile je Fahrer. Wer zuletzt schreibt, steht drin:
// das Teltonika-Gateway (source teltonika_fmb010) oder die Fahrer-App (driver_app_live,
// iOS/Android eigene Kennung).
const OBD_QUELLE = /(teltonika|fmb\d*|obd|telematik|telematics|tracker)/i;
export const istObdQuelle = (quelle) => OBD_QUELLE.test(String(quelle || ''));

// 'gerade eben', 'vor 3 Min.', 'vor 2 Std.', 'vor 4 Tagen'
export const standortAlter = (erfasst, t, jetzt = Date.now()) => {
  const zeit = erfasst ? new Date(erfasst).getTime() : NaN;
  if (!Number.isFinite(zeit)) return '';
  const min = Math.max(0, Math.floor((jetzt - zeit) / 60000));
  if (min < 1) return t('vehicle.ageNow');
  if (min < 60) return t('vehicle.ageMin', { n: min });
  const std = Math.floor(min / 60);
  if (std < 24) return t('vehicle.ageHours', { n: std });
  const tage = Math.floor(std / 24);
  return t(tage === 1 ? 'vehicle.ageDay' : 'vehicle.ageDays', { n: tage });
};

