// Koordinaten, die eine Fahrt schon mitbringt, fuer die Fahrtkarte. Reihenfolge wie
// trisar_evaluate_job_status: Pin des eigenen Orts, dann der TomTom-Payload der Fahrt
// (von/nach), dann die Anfahrts-Payloads. Nur ohne sie wird die Adresse gesucht.

const punktAus = (wert) => {
  if (!wert || typeof wert !== 'object') return null;
  const lat = Number(wert.lat);
  const lng = Number(wert.lng ?? wert.lon);
  if (!Number.isFinite(lat) || !Number.isFinite(lng) || (lat === 0 && lng === 0)) return null;
  return { lat, lng };
};

export const fahrtRoutenPunkte = (dbJob, startOrt, zielOrt) => ({
  von: punktAus(startOrt) || punktAus(dbJob?.ext_route_payload?.von) || punktAus(dbJob?.ext_driver_to_pickup_payload?.nach),
  nach: punktAus(zielOrt) || punktAus(dbJob?.ext_route_payload?.nach) || punktAus(dbJob?.ext_driver_to_dropoff_payload?.nach),
});

// Als Text "lat,lng": so bleibt der Wert fuer die Abhaengigkeiten der Karte stabil,
// und die Karte nimmt ihn direkt als Koordinate.
export const routenOrtText = (ort) => {
  const punkt = punktAus(ort?.routenPunkt);
  return punkt ? `${punkt.lat},${punkt.lng}` : '';
};
