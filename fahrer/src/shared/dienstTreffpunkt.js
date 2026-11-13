// Treffpunkt und Notiz beim Dienststart (Tabelle dienst_treffpunkt, die Dispo setzt sie beim
// Dienste planen). Gleich in iOS DienstTreffpunkt.swift und Android DienstTreffpunkt.kt.
import { ortIconUrl, ortNachId } from './orte';
import { ortIconGrau } from './ortIcons';

// Zeile aus dienst_treffpunkt -> Treffpunkt der App. Ohne Ort und Notiz: null.
export const treffpunktAusZeile = (zeile) => {
  if (!zeile) return null;
  const lat = Number(zeile.lat);
  const lng = Number(zeile.lng);
  const punkt = Number.isFinite(lat) && Number.isFinite(lng) && !(lat === 0 && lng === 0) ? { lat, lng } : null;
  const name = String(zeile.name || '').trim();
  const adresse = String(zeile.adresse || '').trim();
  const notiz = String(zeile.notiz || '').trim();
  if (!name && !adresse && !notiz) return null;
  return { ortId: zeile.ort_id || null, name: name || adresse.split(',')[0].trim(), adresse, punkt, notiz, aktualisiert: zeile.aktualisiert || null };
};

// Graues Icon wie bei Start und Ziel einer Fahrt: eigener Ort mit seinem Icon, sonst nach dem Namen.
export const treffpunktIcon = (tp) => {
  const eigener = tp?.ortId ? ortNachId(tp.ortId) : null;
  if (eigener?.icon) return ortIconUrl(eigener.icon);
  const text = `${tp?.name || ''} ${tp?.adresse || ''}`.toLowerCase();
  if (/\b(hotel|hof|resort|hostel|inn|motel|suite|residence)\b/.test(text)) return ortIconGrau('hotel');
  if (/muc|flughafen|airport|terminal/.test(text)) return ortIconGrau('flughafen_landung');
  if (/messe/.test(text)) return ortIconGrau('messe_halle');
  return ortIconGrau('pin');
};

// Ort im Format der Fahrten (from/to), fuer Karte und Navigation.
export const treffpunktAlsOrt = (tp) => (tp ? {
  name: tp.name,
  address: tp.adresse || tp.name,
  ortId: tp.ortId || undefined,
  routenPunkt: tp.punkt || undefined,
} : null);
