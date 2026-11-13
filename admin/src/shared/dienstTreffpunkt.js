// Treffpunkt und Notiz beim Dienststart (Tabelle dienst_treffpunkt, Migration 20261113140000).
// Die Dispo waehlt beim Dienste planen einen eigenen Ort (orte) oder tippt eine Adresse,
// der Fahrer sieht den Ort in der Dienststart-Karte und beim Antippen auf der Karte.
import { geocodeAddress } from '../services/tomtomRoute';

// Eingabe im Blatt: { text, ortId } wie beim Standby-Ort, dazu die Notiz.
export const LEERER_TREFFPUNKT = { text: '', ortId: '' };

// Gespeicherter Treffpunkt -> Eingabe im Blatt.
export const treffpunktZurEingabe = (zeile) => ({
  text: zeile?.ort_id ? (zeile?.name || '') : (zeile?.adresse || zeile?.name || ''),
  ortId: zeile?.ort_id || '',
});

// Vergleichsschluessel: hat die Dispo Ort oder Notiz geaendert?
export const treffpunktSchluessel = (eingabe, notiz) => JSON.stringify([
  String(eingabe?.ortId || ''), String(eingabe?.text || '').trim(), String(notiz || '').trim(),
]);

// Eingabe -> Zeile fuer dienst_treffpunkt (ohne dienst_id). Eigener Ort: Koordinaten aus orte,
// sonst Adresse suchen (TomTom). null = nichts gesetzt. { fehler } = Adresse nicht gefunden.
export async function treffpunktAufloesen(eingabe, notiz, orte = []) {
  const text = String(eingabe?.text || '').trim();
  const notizText = String(notiz || '').trim();
  if (!text && !notizText) return null;
  const zeile = { ort_id: null, name: null, adresse: null, lat: null, lng: null, notiz: notizText || null };
  if (text) {
    const eigener = eingabe?.ortId ? (orte || []).find((o) => String(o.id) === String(eingabe.ortId)) : null;
    if (eigener) {
      Object.assign(zeile, { ort_id: eigener.id, name: eigener.name, adresse: eigener.adresse || null, lat: eigener.lat ?? null, lng: eigener.lng ?? null });
    } else {
      const pos = await geocodeAddress(text);
      if (!pos) return { fehler: 'Treffpunkt nicht gefunden. Bitte genauer eingeben oder einen eigenen Ort wählen.' };
      Object.assign(zeile, { name: text.split(',')[0].trim(), adresse: text, lat: pos.lat, lng: pos.lon });
    }
  }
  return zeile;
}

// Fuer diese Dienste speichern (oder entfernen, wenn zeile null ist).
export async function treffpunktSpeichern(client, dienstIds, zeile) {
  const ids = (dienstIds || []).filter(Boolean);
  if (!ids.length) return { error: null };
  if (!zeile) return client.from('dienst_treffpunkt').delete().in('dienst_id', ids);
  const jetzt = new Date().toISOString();
  return client.from('dienst_treffpunkt').upsert(ids.map((id) => ({ dienst_id: id, ...zeile, aktualisiert: jetzt })));
}
