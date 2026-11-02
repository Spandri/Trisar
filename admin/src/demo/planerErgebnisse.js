// Echte Ergebnisse des CP-SAT-Planers fuer die Demo.
//
// Die Demo laeuft ohne Server, der Planer (admin-app-lokal/optimizer) ist dort
// nicht erreichbar. Damit der KI-Planer trotzdem zeigt, was die echte Planung
// liefert, wurden die in der Demo waehlbaren Faelle (Strategie x Starttag x
// Zeitraum, mit frischen Daten und nach dem Dispo-Tutorial) vorab mit dem
// echten Planer gerechnet — mit genau den Anfragen, die die Oberflaeche
// schickt. Die Antworten enthalten nur IDs und Uhrzeiten, keine Kalenderdaten;
// sie passen deshalb auch nach der taeglichen Datumsverschiebung der Demo.
// "Heute" liegt in einer eigenen Datei (planer-ergebnisse-heute.json).
// Erzeugt mit werkzeuge/planer-ergebnisse (siehe README dort).
//
// Suche (siehe planerSchluessel.js):
//   genau      Fingerabdruck der Anfrage gleich: der Planer bekaeme dieselbe
//              Aufgabe. In der Demo angelegte Fahrten werden ueber ihren
//              Inhalt der aktuellen ID zugeordnet.
//   angepasst  Tag und Einstellungen gleich, sonst etwas anders (z. B. andere
//              Ruhezeiten nach angenommenen Diensten, eigene Fahrten): der
//              naechstliegende gerechnete Plan, auf die aktuelle Lage gebracht.
//              Ruhezeiten werden eingehalten, indem Dienste an fuer den Solver
//              gleichwertige Fahrer wandern (gleicher Zielwert). Geht das nicht,
//              an einen Fahrer, in dessen Dienstgrenzen sie passen (zulaessig,
//              nur die Fairness-Wertung kann abweichen). Was sich auch so nicht
//              loesen laesst, bleibt offen — ebenso neue Fahrten.
// Ohne Treffer (z. B. eigene Planungsregeln) liefert die Suche null.

import {
  anfrageSchluessel,
  fahrerFenster,
  fahrerKennung,
  fahrerProfilHash,
  fahrtMerkmalHash,
  isoTag,
  OHNE_RUHEZEITEN,
  tagAbstand,
} from './planerSchluessel';

// Die Ergebnisse sind gross — erst laden, wenn wirklich geplant wird.
const laden = (lader) => {
  let versprechen = null;
  return () => {
    if (!versprechen) {
      versprechen = lader()
        .then((modul) => modul?.default || modul)
        .catch(() => null);
    }
    return versprechen;
  };
};
const daten = laden(() => import('./data/planer-ergebnisse.json'));
const heuteDaten = laden(() => import('./data/planer-ergebnisse-heute.json'));

const SPAETBLOCK = '#B';
const kopie = (wert) => JSON.parse(JSON.stringify(wert));
const liste = (x) => (Array.isArray(x) ? x : []);
const fahrtKennung = (fahrt) => String(fahrt?.id || fahrt?.ride_id || '').trim();

const uhrzeitMinuten = (text) => {
  const treffer = /^(\d{1,2}):(\d{2})/.exec(String(text || ''));
  return treffer ? Number(treffer[1]) * 60 + Number(treffer[2]) : null;
};

const fensterMinuten = (wert) => {
  if (wert == null || wert === '') return null;
  if (typeof wert === 'number') return Math.trunc(wert);
  const text = String(wert).trim();
  if (text.includes(':')) return uhrzeitMinuten(text);
  return Number.isFinite(Number(text)) ? Math.trunc(Number(text)) : null;
};

// Fahrten, die beim Rechnen andere IDs hatten (in der Demo angelegt), ueber
// ihren Inhalt den aktuellen Fahrten zuordnen.
const idsZuordnen = (antwortRoh, neueFahrten, rides) => {
  const antwort = kopie(antwortRoh);
  const merkmalVon = neueFahrten || {};
  const aktuell = new Set(rides.map(fahrtKennung));
  const imPlan = new Set([
    ...liste(antwort.suggestions).flatMap((v) => liste(v.assigned_ride_ids)),
    ...liste(antwort.unassigned_ride_ids),
  ].map(String));
  const freiNachMerkmal = new Map();
  rides.forEach((fahrt) => {
    const id = fahrtKennung(fahrt);
    if (imPlan.has(id)) return;
    const merkmal = fahrtMerkmalHash(fahrt);
    freiNachMerkmal.set(merkmal, [...(freiNachMerkmal.get(merkmal) || []), id]);
  });
  const ersetzen = (id) => {
    const text = String(id);
    if (aktuell.has(text) || !merkmalVon[text]) return text;
    return (freiNachMerkmal.get(merkmalVon[text]) || []).shift() || text;
  };
  liste(antwort.suggestions).forEach((vorschlag) => {
    vorschlag.assigned_ride_ids = liste(vorschlag.assigned_ride_ids).map(ersetzen);
  });
  antwort.unassigned_ride_ids = liste(antwort.unassigned_ride_ids).map(ersetzen);
  return antwort;
};

const flottenKennzahlen = (plaene, vorher) => {
  const mitFahrzeug = plaene.filter((p) => p?.vehicle_id);
  const km = (auswahl) => auswahl.reduce((summe, p) => summe + (Number(p?.shift_km) || 0), 0);
  const evKm = km(mitFahrzeug.filter((p) => p?.is_ev));
  const co2JeKm = Number(vorher?.ev_km) > 0 ? Number(vorher.co2_saved_kg) / Number(vorher.ev_km) : 0.15;
  return {
    ...(vorher || {}),
    ev_shift_count: mitFahrzeug.filter((p) => p?.is_ev).length,
    combustion_shift_count: mitFahrzeug.filter((p) => !p?.is_ev).length,
    unassigned_shift_count: plaene.length - mitFahrzeug.length,
    total_km: Math.round(km(plaene) * 10) / 10,
    ev_km: Math.round(evKm * 10) / 10,
    co2_saved_kg: Math.round(evKm * co2JeKm * 10) / 10,
  };
};

// Plan auf die aktuelle Lage bringen (wie werkzeuge/planer-ergebnisse/planer_ableiten.py):
//   - nur Fahrten, die es gibt
//   - Dienste eines Fahrers, der sein Ruhezeitfenster verletzt, gehen an einen
//     freien, fuer den Solver gleichwertigen Fahrer (Paarung ueber augmentierende
//     Pfade). Zulaessig je Fahrt exakt nach der Solver-Regel, wenn die Grenzen
//     vorab gerechnet sind (fenster), sonst ueber die Dienstzeiten.
//   - was sich nicht loesen laesst, entfaellt; Fahrten ohne Dienst bleiben offen
const anpassen = (antwort, { drivers, rides, fenster, profile }) => {
  const vorhanden = new Set(rides.map(fahrtKennung));
  const fahrerNachId = new Map(drivers.map((f) => [fahrerKennung(f), f]));
  const profilVon = (id) => {
    const eintrag = profile?.[id];
    if (eintrag) {
      return {
        basis: `p${eintrag[0]}`,
        mitKopie: `k${eintrag[1]}`,
        wieHaupt: eintrag[2] === 1,
        rest: eintrag[3] != null ? `r${eintrag[3]}` : null,
        hoechst: eintrag[4],
        mindest: eintrag[5],
      };
    }
    const fahrer = fahrerNachId.get(id);
    const hash = fahrer ? fahrerProfilHash(fahrer) : `unbekannt:${id}`;
    return { basis: hash, mitKopie: `${hash}+`, wieHaupt: false, rest: null };
  };

  const vorschlaege = liste(antwort.suggestions).filter((vorschlag) => {
    const ids = liste(vorschlag.assigned_ride_ids).map(String).filter((id) => vorhanden.has(id));
    vorschlag.assigned_ride_ids = ids;
    vorschlag.assigned_rides_count = ids.length;
    return ids.length > 0;
  });

  const bloecke = new Map();
  vorschlaege.forEach((vorschlag) => {
    const id = String(vorschlag.driver_id || '');
    bloecke.set(id, [...(bloecke.get(id) || []), vorschlag]);
  });

  const zulaessig = (fahrer, dienste) => {
    const frueh = fensterMinuten(fahrerFenster(fahrer).frueh);
    const spaet = fensterMinuten(fahrerFenster(fahrer).spaet);
    if (frueh == null && spaet == null) return true;
    return dienste.every((dienst) => {
      if (fenster) {
        return liste(dienst.assigned_ride_ids).every((id) => {
          const grenze = fenster[id];
          if (!grenze) return false;
          return (frueh == null || grenze[0] >= frueh) && (spaet == null || grenze[1] <= spaet);
        });
      }
      const start = uhrzeitMinuten(dienst.service_start);
      const ende = uhrzeitMinuten(dienst.service_end);
      return !(frueh != null && start != null && start < frueh) && !(spaet != null && ende != null && ende > spaet);
    });
  };

  const einheitenBilden = (trennen) => {
    const einheiten = [];
    bloecke.forEach((dienste, id) => {
      if (trennen.has(id)) {
        dienste.forEach((dienst) => einheiten.push({
          schluessel: `${id}|${dienst.split_block === 'late' ? 'spaet' : 'frueh'}`,
          id,
          dienste: [dienst],
          mitKopie: false,
        }));
      } else {
        einheiten.push({ schluessel: id, id, dienste, mitKopie: dienste.some((d) => d.split_block === 'late') });
      }
    });
    return einheiten;
  };

  // Notfall-Tausch (nur fuer sonst unloesbare Dienste): anderer Fahrer mit
  // gleichen Zonen/VIP/Stunden, in dessen Hoechst- und Mindestdauer die Dienste
  // passen. Zulaessig fuer den Solver; nur die Fairness-Wertung kann abweichen.
  const passtLocker = (einheit, id) => {
    const eigenes = profilVon(einheit.id);
    const p = profilVon(id);
    if (!p.rest || p.rest !== eigenes.rest) return false;
    const dauern = einheit.dienste.map((d) => (uhrzeitMinuten(d.service_end) ?? 0) - (uhrzeitMinuten(d.service_start) ?? 0));
    const summe = dauern.reduce((a, b) => a + b, 0);
    return dauern.every((m) => m >= p.mindest && m <= p.hoechst) && summe <= p.hoechst;
  };

  const paaren = (einheiten, locker = new Set()) => {
    const alleIds = drivers.map(fahrerKennung);
    const kandidaten = new Map();
    einheiten.forEach((einheit) => {
      const eigenes = profilVon(einheit.id);
      const soll = einheit.mitKopie ? eigenes.mitKopie : eigenes.basis;
      const reihe = [einheit.id, ...alleIds.filter((id) => id !== einheit.id)];
      const gleichwertig = reihe.filter((id) => {
        const fahrer = fahrerNachId.get(id);
        if (!fahrer) return false;
        const p = profilVon(id);
        return (einheit.mitKopie ? p.mitKopie : p.basis) === soll && zulaessig(fahrer, einheit.dienste);
      });
      const notfall = locker.has(einheit.schluessel)
        ? reihe.filter((id) => !gleichwertig.includes(id) && fahrerNachId.get(id)
          && passtLocker(einheit, id) && zulaessig(fahrerNachId.get(id), einheit.dienste))
        : [];
      kandidaten.set(einheit.schluessel, [...gleichwertig, ...notfall]);
    });
    const belegt = new Map(); // Fahrer-ID -> Einheit
    einheiten.forEach((einheit) => {
      if (kandidaten.get(einheit.schluessel).includes(einheit.id) && !belegt.has(einheit.id)) {
        belegt.set(einheit.id, einheit.schluessel);
      }
    });
    const zuordnen = (schluessel, gesehen) => {
      for (const kandidat of kandidaten.get(schluessel)) {
        if (gesehen.has(kandidat)) continue;
        gesehen.add(kandidat);
        if (!belegt.has(kandidat) || zuordnen(belegt.get(kandidat), gesehen)) {
          belegt.set(kandidat, schluessel);
          return true;
        }
      }
      return false;
    };
    const offen = [];
    einheiten.forEach((einheit) => {
      if ([...belegt.values()].includes(einheit.schluessel)) return;
      if (!zuordnen(einheit.schluessel, new Set())) offen.push(einheit.schluessel);
    });
    const zuordnung = new Map([...belegt.entries()].map(([fahrerId, schluessel]) => [schluessel, fahrerId]));
    return { zuordnung, alleGepaart: offen.length === 0, offen };
  };
  const gepaarteDienste = (ergebnis, liste2) => liste2
    .filter((e) => ergebnis.zuordnung.has(e.schluessel))
    .reduce((summe, e) => summe + e.dienste.length, 0);

  let getrennt = new Set();
  let einheiten = einheitenBilden(getrennt);
  let ergebnis = paaren(einheiten);
  if (!ergebnis.alleGepaart) {
    // Geteilte Dienste trennen, wenn der Spaetblock-Platz wie ein Hauptblock wirkt.
    const trennbar = new Set([...bloecke.entries()]
      .filter(([id, dienste]) => dienste.length > 1 && profilVon(id).wieHaupt)
      .map(([id]) => id));
    if (trennbar.size) {
      const zweiteEinheiten = einheitenBilden(trennbar);
      const zweiter = paaren(zweiteEinheiten);
      if (gepaarteDienste(zweiter, zweiteEinheiten) >= gepaarteDienste(ergebnis, einheiten)) {
        getrennt = trennbar;
        einheiten = zweiteEinheiten;
        ergebnis = zweiter;
      }
    }
  }
  if (!ergebnis.alleGepaart) {
    const notfall = paaren(einheiten, new Set(ergebnis.offen));
    if (gepaarteDienste(notfall, einheiten) > gepaarteDienste(ergebnis, einheiten)) ergebnis = notfall;
  }
  const { zuordnung } = ergebnis;

  // Umschreiben: neuer Fahrer je Dienst; getrennte Spaetbloecke werden Hauptbloecke.
  const ziel = new Map();
  const planZiel = new Map();
  einheiten.forEach((einheit) => {
    const neu = zuordnung.get(einheit.schluessel);
    einheit.dienste.forEach((dienst) => {
      const spaetBleibt = !getrennt.has(einheit.id) && dienst.split_block === 'late';
      ziel.set(dienst, neu ? { id: neu, spaet: spaetBleibt } : null);
      const alt = dienst.split_block === 'late' ? `${einheit.id}${SPAETBLOCK}` : einheit.id;
      planZiel.set(alt, neu ? `${neu}${spaetBleibt ? SPAETBLOCK : ''}` : null);
    });
  });

  const PRAEFIX_SPAET = 'Geteilter Dienst · Spätblock';
  const PRAEFIX_FRUEH = 'Geteilter Dienst · Frühblock';
  antwort.suggestions = vorschlaege
    .filter((dienst) => ziel.get(dienst))
    .map((dienst) => {
      const { id, spaet } = ziel.get(dienst);
      let note = String(dienst.note || '');
      [PRAEFIX_SPAET, PRAEFIX_FRUEH].forEach((praefix) => {
        if (note.startsWith(`${praefix} — `)) note = note.slice(praefix.length + 3);
        else if (note === praefix) note = '';
      });
      return {
        ...dienst,
        driver_id: id,
        driver_name: String(fahrerNachId.get(id)?.name || '').trim() || dienst.driver_name,
        split_block: spaet ? 'late' : null,
        note,
      };
    });
  const anzahl = new Map();
  antwort.suggestions.forEach((dienst) => anzahl.set(dienst.driver_id, (anzahl.get(dienst.driver_id) || 0) + 1));
  antwort.suggestions.forEach((dienst) => {
    if ((anzahl.get(dienst.driver_id) || 0) < 2) return;
    const praefix = dienst.split_block === 'late' ? PRAEFIX_SPAET : PRAEFIX_FRUEH;
    dienst.note = dienst.note ? `${praefix} — ${dienst.note}` : praefix;
  });
  antwort.suggestions.sort((a, b) => `${a.service_start || ''}|${a.driver_name || ''}`
    .localeCompare(`${b.service_start || ''}|${b.driver_name || ''}`));

  const verplant = new Set(antwort.suggestions.flatMap((v) => v.assigned_ride_ids));
  antwort.unassigned_ride_ids = rides.map(fahrtKennung).filter((id) => !verplant.has(id));

  const plaeneVorher = liste(antwort.vehicle_plans);
  if (plaeneVorher.length) {
    const plaene = plaeneVorher
      .map((plan) => {
        const alt = String(plan?.driver_id || '');
        if (!planZiel.has(alt)) return plan;
        const neu = planZiel.get(alt);
        return neu ? { ...plan, driver_id: neu } : null;
      })
      .filter(Boolean);
    if (plaene.length !== plaeneVorher.length) antwort.fleet_kpis = flottenKennzahlen(plaene, antwort.fleet_kpis);
    antwort.vehicle_plans = plaene;
  }

  antwort.kpis = {
    ...(antwort.kpis || {}),
    unassigned_ride_count: antwort.unassigned_ride_ids.length,
    // Wie der Solver: jeder Dienstblock zaehlt (geteilte Dienste doppelt).
    active_driver_count: antwort.suggestions.length,
  };
  return antwort;
};

// Heute-Daten: Gruppen je Strategie und Zustand, Varianten je Fahrten-Fingerabdruck.
const heuteEintraege = (heute) => liste(heute?.gruppen).flatMap((gruppe) => Object.entries(gruppe.varianten || {})
  .map(([fahrten, index]) => ({
    tag: 0,
    einstellungen: gruppe.einstellungen,
    fahrer: gruppe.fahrer,
    ruhe: gruppe.ruhe,
    fahrzeuge: gruppe.fahrzeuge,
    neueFahrten: gruppe.neueFahrten,
    fahrten,
    antwort: heute.antworten[index],
  })));

export const echtenPlanFinden = async ({ serviceDate, settings, drivers, rides, vehicles }) => {
  if (!serviceDate) return null;
  const tag = tagAbstand(serviceDate, isoTag());
  const [basis, heute] = await Promise.all([daten(), tag === 0 ? heuteDaten() : Promise.resolve(null)]);
  const eintraege = tag === 0 ? heuteEintraege(heute) : liste(basis?.eintraege);
  if (!eintraege.length) return null;

  const fahrer = liste(drivers);
  const fahrten = liste(rides);
  const schluessel = anfrageSchluessel({ tag, settings, drivers: fahrer, rides: fahrten, vehicles: liste(vehicles) });
  const passend = eintraege.filter((e) => e.tag === schluessel.tag && e.einstellungen === schluessel.einstellungen);
  if (!passend.length) return null;
  const gleich = (eintrag, feld) => eintrag[feld] === schluessel[feld];

  const genau = passend.find((e) => ['fahrer', 'ruhe', 'fahrten', 'fahrzeuge'].every((feld) => gleich(e, feld)));
  if (genau) return { antwort: idsZuordnen(genau.antwort, genau.neueFahrten, fahrten), treffer: 'genau' };

  // Heute: die Variante zu den bekannten Fahrten waehlen (eigene neue Fahrten
  // herausgerechnet) — sonst waere jede Variante gleich weit weg.
  let kandidaten = passend;
  if (tag === 0) {
    const bekannt = new Set(passend.flatMap((e) => [
      ...liste(e.antwort?.suggestions).flatMap((v) => liste(v.assigned_ride_ids)),
      ...liste(e.antwort?.unassigned_ride_ids),
    ]).map(String));
    const neuMerkmale = new Set(passend.flatMap((e) => Object.values(e.neueFahrten || {})));
    const nurBekannte = fahrten.filter((f) => bekannt.has(fahrtKennung(f)) || neuMerkmale.has(fahrtMerkmalHash(f)));
    const ohneNeue = anfrageSchluessel({ tag, settings, drivers: fahrer, rides: nurBekannte, vehicles: liste(vehicles) }).fahrten;
    const variante = passend.filter((e) => e.fahrten === ohneNeue);
    if (variante.length) kandidaten = variante;
  }
  // Naechstliegender Plan: gleiche Fahrten zaehlen am meisten, dann Fahrer, Ruhezeiten.
  const naechster = kandidaten
    .map((e) => ({
      e,
      punkte: (gleich(e, 'fahrten') ? 8 : 0) + (gleich(e, 'fahrer') ? 4 : 0) + (gleich(e, 'ruhe') ? 2 : 0)
        + (e.ruhe === OHNE_RUHEZEITEN ? 1 : 0),
    }))
    .sort((a, b) => b.punkte - a.punkte)[0].e;
  const antwort = anpassen(idsZuordnen(naechster.antwort, naechster.neueFahrten, fahrten), {
    drivers: fahrer,
    rides: fahrten,
    fenster: basis?.fahrtFenster?.[`${schluessel.tag}|${schluessel.einstellungen}|${schluessel.fahrten}`] || null,
    profile: basis?.fahrerProfile?.[`${schluessel.einstellungen}|${schluessel.fahrer}`] || null,
  });
  return { antwort, treffer: 'angepasst' };
};

export default echtenPlanFinden;
