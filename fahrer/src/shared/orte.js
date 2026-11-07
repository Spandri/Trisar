// Eigene Orte der Dispo (Tabelle orte, hier nur lesen). Hat eine Fahrt
// pickup_ort_id/dropoff_ort_id, zeigt die App bei Start/Ziel das Icon des Orts.
// Die Statusregel (Radien) rechnet die DB, nicht die App.
// Fehlt die Tabelle (Demo, Migration noch nicht da), bleibt die Liste leer.
import { supabase } from './supabase/client';

const ORT_ICON_GRAU = {
  pin: '/icon/_Icon_Grau/Pin_Nav_Trisar_Icons_01_grau.svg',
  haus: '/icon/_Icon_Grau/House_Nav_Trisar_01_grau.svg',
  flughafen_abflug: '/icon/_Icon_Grau/Plain_Abflug_Trisar_Icons_01_grau.svg',
  flughafen_landung: '/icon/_Icon_Grau/Plain_Landen_Trisar_Icons_01_grau.svg',
  fahrzeug: '/icon/_Icon_Grau/Vehicle_Nav_Trisar_01_grau.svg',
  stern: '/icon/_Icon_Grau/Stern_Trisar_Icon_01_grau.svg',
};

let orteNachId = new Map();
let ladeLauf = null;
let geladen = false;

// Einmal laden und merken. Schlug es fehl oder kennt der Speicher eine der
// gesuchten IDs nicht (neuer Ort), beim naechsten Aufruf neu laden.
export const orteLaden = (gesuchteIds = []) => {
  const fehlt = (Array.isArray(gesuchteIds) ? gesuchteIds : [])
    .some((id) => id && !orteNachId.has(String(id)));
  if (geladen && !fehlt) return Promise.resolve(orteNachId);
  if (ladeLauf) return ladeLauf;
  ladeLauf = (async () => {
    try {
      const { data, error } = await supabase.from('orte').select('id, name, adresse, lat, lng, icon');
      if (!error && Array.isArray(data)) {
        orteNachId = new Map(data.filter((ort) => ort?.id).map((ort) => [String(ort.id), ort]));
        geladen = true;
      }
    } catch {
      // ohne Orte weiter
    } finally {
      ladeLauf = null;
    }
    return orteNachId;
  })();
  return ladeLauf;
};

export const ortNachId = (id) => {
  const schluessel = String(id || '').trim();
  return schluessel ? orteNachId.get(schluessel) || null : null;
};

// Icon eines Orts (grau, wie in der Fahrt). Ohne Ort: null, dann gilt das Textmuster.
export const ortIconUrl = (icon) => (icon ? ORT_ICON_GRAU[icon] || ORT_ICON_GRAU.pin : null);

export const ortIconFuer = (location) => (location?.ortId ? ortIconUrl(location.ortIcon || 'pin') : null);
