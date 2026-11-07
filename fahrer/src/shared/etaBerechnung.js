import { useEffect, useState } from 'react';

// Ankunftszeit (ETA) einer Fahrt aus Sicht des Fahrers.
//  - unterwegs und frische Live-Restfahrzeit vom Tracker/Handy: jetzt + Restfahrzeit
//  - noch nicht losgefahren: spaetere von geplanter Abfahrt und jetzt, plus Fahrzeit
//    (wer verspaetet beim Gast losfaehrt, kommt auch spaeter an)
//  - sonst geplante Abfahrt plus Fahrzeit, aber nie vor jetzt

const UNTERWEGS = new Set(['in_progress', 'unterwegs', 'started', 'on_trip', 'ongoing', 'active']);
const LIVE_MAX_ALTER_MS = 10 * 60 * 1000;

const heuteIso = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const uhrzeit = (d) => `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;

const zeitAmTag = (hhmm, rideDate, jetzt) => {
  const m = /^(\d{1,2}):(\d{2})/.exec(String(hhmm || ''));
  if (!m) return null;
  const tag = /^\d{4}-\d{2}-\d{2}$/.test(String(rideDate || '')) ? rideDate : heuteIso(jetzt);
  const [y, mo, d] = tag.split('-').map(Number);
  return new Date(y, mo - 1, d, Number(m[1]), Number(m[2]), 0, 0);
};

export const berechneEta = (job, routeDurationMins, jetzt = new Date()) => {
  const dauer = Number(routeDurationMins) > 0 ? Number(routeDurationMins) : 0;
  const status = String(job?.status || '').trim().toLowerCase();
  const abfahrtGeplant = zeitAmTag(job?.etd, job?.rideDate, jetzt);

  if (UNTERWEGS.has(status)) {
    const rest = Number(job?.extDriverToDropoffDurationInTrafficMins || job?.extDriverToDropoffDurationMins);
    const sync = Date.parse(job?.extDriverToDropoffLastSyncAt || '');
    if (Number.isFinite(rest) && rest >= 0 && Number.isFinite(sync) && jetzt.getTime() - sync < LIVE_MAX_ALTER_MS) {
      return uhrzeit(new Date(jetzt.getTime() + rest * 60_000));
    }
  }
  if (!abfahrtGeplant) return null;
  const start = abfahrtGeplant.getTime() < jetzt.getTime() && abfahrtGeplant.toDateString() === jetzt.toDateString()
    ? jetzt
    : abfahrtGeplant;
  return uhrzeit(new Date(start.getTime() + dauer * 60_000));
};

// Tatsaechliche Losfahrzeit: noch nicht losgefahren und schon spaet dran -> jetzt.
export const berechneAbfahrt = (job, jetzt = new Date()) => {
  const status = String(job?.status || '').trim().toLowerCase();
  const geplant = zeitAmTag(job?.etd, job?.rideDate, jetzt);
  if (!geplant) return null;
  if (!UNTERWEGS.has(status) && geplant.getTime() < jetzt.getTime() && geplant.toDateString() === jetzt.toDateString()) {
    return uhrzeit(jetzt);
  }
  return uhrzeit(geplant);
};

// Restfahrzeit in Minuten fuer die Anzeige "-X min Fahrt".
export const restFahrzeit = (job, routeDurationMins, jetzt = new Date()) => {
  const status = String(job?.status || '').trim().toLowerCase();
  if (UNTERWEGS.has(status)) {
    const rest = Number(job?.extDriverToDropoffDurationInTrafficMins || job?.extDriverToDropoffDurationMins);
    const sync = Date.parse(job?.extDriverToDropoffLastSyncAt || '');
    if (Number.isFinite(rest) && rest >= 0 && Number.isFinite(sync) && jetzt.getTime() - sync < LIVE_MAX_ALTER_MS) return rest;
  }
  return Number(routeDurationMins) > 0 ? Number(routeDurationMins) : 0;
};

// Laesst die Ansicht jede halbe Minute neu rechnen, damit die ETA mitlaeuft.
export const useJetzt = (intervallMs = 30_000) => {
  const [jetzt, setJetzt] = useState(() => new Date());
  useEffect(() => {
    const id = window.setInterval(() => setJetzt(new Date()), intervallMs);
    return () => window.clearInterval(id);
  }, [intervallMs]);
  return jetzt;
};
