// Mehrfachauswahl von Fahrern (Kaestchen oben rechts auf der Karte).
// Einmal markiert, gilt die Auswahl in der ganzen Dispo:
//   Karte          markierte Fahrer normal, alle anderen blass
//   Alle Fahrer    dieselben Fahrer ausgewaehlt
//   Fahrzeuge      die Fahrzeuge dieser Fahrer markiert
//   Fahrten        nur Fahrten dieser Fahrer
//   Fahrt anlegen  diese Fahrer schon eingetragen
//   KI-Assistent   Vermerk ueber der Eingabe, Fragen beziehen sich auf sie
// Haelt den Stand fuer die Sitzung (sessionStorage), damit ein Neuladen ihn nicht verliert.
import { useSyncExternalStore } from 'react';

const SCHLUESSEL = 'trisar.fahrerMarkierung.v1';
const LEER = Object.freeze({ aktiv: false, fahrer: [], flaggen: [] });
const flaggenListe = (w) => (Array.isArray(w) ? w.map((x) => String(x || '').trim()).filter(Boolean) : []);

const normal = (eintrag) => ({
  id: String(eintrag?.id || '').trim(),
  name: String(eintrag?.name || '').trim(),
  vehicleId: String(eintrag?.vehicleId || '').trim(),
});

const laden = () => {
  try {
    const roh = JSON.parse(sessionStorage.getItem(SCHLUESSEL) || 'null');
    if (!roh || typeof roh !== 'object') return LEER;
    const fahrer = (Array.isArray(roh.fahrer) ? roh.fahrer : []).map(normal).filter((f) => f.id);
    return { aktiv: Boolean(roh.aktiv), fahrer, flaggen: flaggenListe(roh.flaggen) };
  } catch {
    return LEER;
  }
};

let stand = laden();
const hoerer = new Set();

const setzen = (neu) => {
  stand = { aktiv: Boolean(neu.aktiv), fahrer: neu.fahrer.map(normal).filter((f) => f.id), flaggen: flaggenListe(neu.flaggen) };
  try {
    sessionStorage.setItem(SCHLUESSEL, JSON.stringify(stand));
  } catch {
    // ohne Speicher gilt die Auswahl nur bis zum Neuladen
  }
  hoerer.forEach((fn) => fn());
};

export const fahrerMarkierung = {
  lesen: () => stand,
  ids: () => stand.fahrer.map((f) => f.id),
  // Nur wenn der Modus an ist und jemand markiert ist, wirkt die Auswahl in den anderen Ansichten.
  wirkt: () => stand.aktiv && stand.fahrer.length > 0,
  modusSetzen: (aktiv) => setzen({ aktiv, fahrer: aktiv ? stand.fahrer : [] }),
  umschalten: (fahrer) => {
    const id = String(fahrer?.id || '').trim();
    if (!id) return;
    const drin = stand.fahrer.some((f) => f.id === id);
    setzen({ aktiv: true, fahrer: drin ? stand.fahrer.filter((f) => f.id !== id) : [...stand.fahrer, fahrer] });
  },
  // Ganze Liste ersetzen (z. B. Auswahl in Alle Fahrer). Leere Liste laesst den Modus an.
  ersetzen: (fahrer) => setzen({ aktiv: stand.aktiv || fahrer.length > 0, fahrer }),
  // Namen und Fahrzeuge nachtragen, sobald eine Ansicht die Fahrerdaten kennt.
  ergaenzen: (liste) => {
    const nachId = new Map((liste || []).map((f) => [String(f?.id || '').trim(), f]));
    let geaendert = false;
    const fahrer = stand.fahrer.map((f) => {
      const neu = nachId.get(f.id);
      if (!neu) return f;
      const name = String(neu.name || '').trim() || f.name;
      const vehicleId = String(neu.vehicleId || '').trim() || f.vehicleId;
      if (name === f.name && vehicleId === f.vehicleId) return f;
      geaendert = true;
      return { ...f, name, vehicleId };
    });
    if (geaendert) setzen({ aktiv: stand.aktiv, fahrer, flaggen: stand.flaggen });
  },
  // Flaggen als Auswahl (Flaggenfilter auf der Karte): alle Fahrer mit diesen Flaggen gelten als markiert,
  // angezeigt werden die Flaggen statt der Namen. Leere Flaggenliste hebt sie auf.
  flaggenSetzen: (flaggen, fahrer) => {
    const liste = flaggenListe(flaggen);
    if (!liste.length) {
      if (stand.flaggen.length) setzen({ aktiv: false, fahrer: [], flaggen: [] });
      return;
    }
    setzen({ aktiv: true, fahrer: fahrer || [], flaggen: liste });
  },
  leeren: () => setzen({ aktiv: false, fahrer: [], flaggen: [] }),
};

const abonnieren = (fn) => {
  hoerer.add(fn);
  return () => hoerer.delete(fn);
};

export const useFahrerMarkierung = () => useSyncExternalStore(abonnieren, fahrerMarkierung.lesen);
