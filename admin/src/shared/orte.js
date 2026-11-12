// Eigene Orte der Dispo (Tabelle orte) mit Reinfahr-/Rausfahr-Radius und Icon,
// dazu die Standard-Radien fuer alle anderen Adressen (orte_standard).
// Die Statusregel rechnet die DB, hier wird nur gelesen, gepflegt und angezeigt.
// Fehlt die Tabelle (Demo, Migration noch nicht da), bleibt die Liste einfach leer.
import { useSyncExternalStore } from 'react';
import { DEMO_MODE, supabase } from '../services/supabase';

// grau fuer Listen und Fahrten, lime fuer gewaehlt, schwarz auf dem Lime-Kreis der Karte (Figma 2826-12363).
const ICON = (ordner, datei) => `/icon/${ordner}/${datei}.svg`;
const ALTE_ICONS = [
  { key: 'pin', grau: ICON('_Icon_Grau', 'Pin_Nav_Trisar_Icons_01_grau'), lime: ICON('_Icon_Lime', 'Pin_Nav_Trisar_Icons_01_Lime'), schwarz: ICON('_Icon_Schwarz', 'Pin_Nav_Trisar_Icons_01') },
  { key: 'haus', grau: ICON('_Icon_Grau', 'House_Nav_Trisar_01_grau'), lime: ICON('_Icon_Lime', 'House_Nav_Trisar_01_Lime'), schwarz: ICON('_Icon_Schwarz', 'House_Nav_Trisar_01') },
  { key: 'flughafen_abflug', grau: ICON('_Icon_Grau', 'Plain_Abflug_Trisar_Icons_01_grau'), lime: ICON('_Icon_Lime', 'Plain_Abflug_Trisar_Icons_01_Lime'), schwarz: ICON('_Icon_Schwarz', 'Plain_Abflug_Trisar_Icons_01') },
  { key: 'flughafen_landung', grau: ICON('_Icon_Grau', 'Plain_Landen_Trisar_Icons_01_grau'), lime: ICON('_Icon_Lime', 'Plain_Landen_Trisar_Icons_01_Lime'), schwarz: ICON('_Icon_Schwarz', 'Plain_Landen_Trisar_Icons_01') },
  { key: 'fahrzeug', grau: ICON('_Icon_Grau', 'Vehicle_Nav_Trisar_01_grau'), lime: ICON('_Icon_Lime', 'Vehicle_Nav_Trisar_01_Lime'), schwarz: ICON('_Icon_Schwarz', 'vehicle-car-small') },
  { key: 'stern', grau: ICON('_Icon_Grau', 'Stern_Trisar_Icon_01_grau'), lime: ICON('_Icon_Lime', 'Stern_Trisar_Icon_01_Lime'), schwarz: ICON('_Icon_Schwarz', 'Stern_Trisar_Icon_01_schwarz') },
];
// Neue Icons aus werkzeuge/icons-neu: Schluessel, Dateiname, Beschriftung.
const NEUE_ICONS = [
  ['hotel', 'Hotel_Trisar_Icons_01', 'Hotel'],
  ['bett', 'Bett_Trisar_Icons_01', 'Bett'],
  ['flughafen_tower', 'Flughafen_Tower_Trisar_Icons_01', 'Flughafen Tower'],
  ['bahnhof_zug', 'Bahnhof_Zug_Trisar_Icons_01', 'Bahnhof Zug'],
  ['u_bahn', 'U_Bahn_Trisar_Icons_01', 'U-Bahn'],
  ['bus', 'Bus_Trisar_Icons_01', 'Bus'],
  ['taxi', 'Taxi_Trisar_Icons_01', 'Taxi'],
  ['auto', 'Auto_Trisar_Icons_01', 'Auto'],
  ['shuttle_van', 'Shuttle_Van_Trisar_Icons_01', 'Shuttle Van'],
  ['messe_halle', 'Messe_Halle_Trisar_Icons_01', 'Messe Halle'],
  ['restaurant', 'Restaurant_Trisar_Icons_01', 'Restaurant'],
  ['bar', 'Bar_Trisar_Icons_01', 'Bar'],
  ['kaffee', 'Kaffee_Trisar_Icons_01', 'Kaffee'],
  ['buero', 'Buero_Trisar_Icons_01', 'Büro'],
  ['zuhause', 'Zuhause_Trisar_Icons_01', 'Zuhause'],
  ['krankenhaus', 'Krankenhaus_Trisar_Icons_01', 'Krankenhaus'],
  ['parkplatz', 'Parkplatz_Trisar_Icons_01', 'Parkplatz'],
  ['tankstelle', 'Tankstelle_Trisar_Icons_01', 'Tankstelle'],
  ['einkaufen', 'Einkaufen_Trisar_Icons_01', 'Einkaufen'],
  ['berge', 'Berge_Trisar_Icons_01', 'Berge'],
  ['hafen_schiff', 'Hafen_Schiff_Trisar_Icons_01', 'Hafen Schiff'],
  ['flughafen_terminal', 'Flughafen_Terminal_Trisar_Icons_01', 'Flughafen Terminal'],
  ['bahnhof_gebaeude', 'Bahnhof_Gebaeude_Trisar_Icons_01', 'Bahnhof Gebäude'],
  ['kongress', 'Kongress_Trisar_Icons_01', 'Kongress'],
  ['stadion', 'Stadion_Trisar_Icons_01', 'Stadion'],
  ['museum_bank', 'Museum_Bank_Trisar_Icons_01', 'Museum Bank'],
  ['rathaus', 'Rathaus_Trisar_Icons_01', 'Rathaus'],
  ['kirche', 'Kirche_Trisar_Icons_01', 'Kirche'],
  ['burg_schloss', 'Burg_Schloss_Trisar_Icons_01', 'Burg Schloss'],
  ['universitaet', 'Universitaet_Trisar_Icons_01', 'Universität'],
  ['fabrik', 'Fabrik_Trisar_Icons_01', 'Fabrik'],
  ['lager', 'Lager_Trisar_Icons_01', 'Lager'],
  ['garage_werkstatt', 'Garage_Werkstatt_Trisar_Icons_01', 'Garage Werkstatt'],
  ['stadt_hochhaeuser', 'Stadt_Hochhaeuser_Trisar_Icons_01', 'Stadt Hochhäuser'],
  ['hochhaus', 'Hochhaus_Trisar_Icons_01', 'Hochhaus'],
  ['parkhaus', 'Parkhaus_Trisar_Icons_01', 'Parkhaus'],
  ['ladestation', 'Ladestation_Trisar_Icons_01', 'Ladestation'],
  ['geschaeft', 'Geschaeft_Trisar_Icons_01', 'Geschäft'],
  ['apotheke', 'Apotheke_Trisar_Icons_01', 'Apotheke'],
  ['sicherheit_polizei', 'Sicherheit_Polizei_Trisar_Icons_01', 'Sicherheit Polizei'],
  ['botschaft', 'Botschaft_Trisar_Icons_01', 'Botschaft'],
  ['festzelt', 'Festzelt_Trisar_Icons_01', 'Festzelt'],
  ['fernsehturm', 'Fernsehturm_Trisar_Icons_01', 'Fernsehturm'],
  ['bruecke', 'Bruecke_Trisar_Icons_01', 'Brücke'],
  ['fitness', 'Fitness_Trisar_Icons_01', 'Fitness'],
  ['kino', 'Kino_Trisar_Icons_01', 'Kino'],
  ['biergarten', 'Biergarten_Trisar_Icons_01', 'Biergarten'],
  ['uhr', 'Uhr_Trisar_Icons_01', 'Uhr'],
  ['kalender', 'Kalender_Trisar_Icons_01', 'Kalender'],
  ['tag_sonne', 'Tag_Sonne_Trisar_Icons_01', 'Tag Sonne'],
  ['nacht_mond', 'Nacht_Mond_Trisar_Icons_01', 'Nacht Mond'],
  ['regen_schirm', 'Regen_Schirm_Trisar_Icons_01', 'Regen Schirm'],
  ['ziel_flagge', 'Ziel_Flagge_Trisar_Icons_01', 'Ziel Flagge'],
  ['route', 'Route_Trisar_Icons_01', 'Route'],
  ['navigation', 'Navigation_Trisar_Icons_01', 'Navigation'],
  ['lenkrad_fahrer', 'Lenkrad_Fahrer_Trisar_Icons_01', 'Lenkrad Fahrer'],
  ['schluessel', 'Schluessel_Trisar_Icons_01', 'Schlüssel'],
  ['fahrrad', 'Fahrrad_Trisar_Icons_01', 'Fahrrad'],
  ['rollkoffer', 'Rollkoffer_Trisar_Icons_01', 'Rollkoffer'],
  ['ticket', 'Ticket_Trisar_Icons_01', 'Ticket'],
  ['vip_krone', 'Vip_Krone_Trisar_Icons_01', 'VIP Krone'],
  ['musik_band', 'Musik_Band_Trisar_Icons_01', 'Musik Band'],
  ['mikrofon_kongress', 'Mikrofon_Kongress_Trisar_Icons_01', 'Mikrofon Kongress'],
  ['international', 'International_Trisar_Icons_01', 'International'],
  ['kreditkarte', 'Kreditkarte_Trisar_Icons_01', 'Kreditkarte'],
  ['dokument', 'Dokument_Trisar_Icons_01', 'Dokument'],
  ['glocke', 'Glocke_Trisar_Icons_01', 'Glocke'],
  ['schloss', 'Schloss_Trisar_Icons_01', 'Schloss'],
  ['info', 'Info_Trisar_Icons_01', 'Info'],
  ['warnung', 'Warnung_Trisar_Icons_01', 'Warnung'],
  ['check', 'Check_Trisar_Icons_01', 'Check'],
  ['schliessen', 'Schliessen_Trisar_Icons_01', 'Schließen'],
  ['plus', 'Plus_Trisar_Icons_01', 'Plus']
].map(([key, datei, label]) => ({
  key,
  label,
  grau: ICON('_Icon_Grau', `${datei}_grau`),
  lime: ICON('_Icon_Lime', `${datei}_Lime`),
  schwarz: ICON('_Icon_Schwarz', datei),
}));
export const ORT_ICONS = [...ALTE_ICONS, ...NEUE_ICONS];
const ICON_NACH_KEY = new Map(ORT_ICONS.map((eintrag) => [eintrag.key, eintrag]));

// Schwarzes Symbol fuer den Lime-Kreis auf der Karte.
export const ortIconSchwarz = (icon) => (ICON_NACH_KEY.get(String(icon || '')) || ICON_NACH_KEY.get('pin')).schwarz;
export const ORT_KREIS_URL = '/icon/_Icon_Karte/Ort_Kreis_Trisar_01.svg';
export const ORT_RING_URL = '/icon/_Icon_Karte/Ort_Ring_Trisar_01.png';

export const ortIconUrl = (icon, aktiv = false) => {
  const eintrag = ICON_NACH_KEY.get(String(icon || '')) || ICON_NACH_KEY.get('pin');
  return aktiv ? eintrag.lime : eintrag.grau;
};

export const STANDARD_RADIEN = { radius_rein_m: 50, radius_raus_m: 100 };
export const RADIUS_REIN_MIN = 10;
export const RADIUS_REIN_MAX = 5000;
export const RADIUS_RAUS_MIN = 11;
export const RADIUS_RAUS_MAX = 10000;

const ORTE_SPALTEN = 'id, name, adresse, lat, lng, radius_rein_m, radius_raus_m, icon';

// --- gemeinsamer Stand fuer alle Ansichten -------------------------------

let stand = { orte: [], standard: { ...STANDARD_RADIEN }, geladen: false };
const zuhoerer = new Set();
let ladeLauf = null;
let kanal = null;

const melden = () => zuhoerer.forEach((rueckmeldung) => rueckmeldung(stand));
const setzen = (teil) => {
  stand = { ...stand, ...teil };
  melden();
};

const nachName = (a, b) => String(a?.name || '').localeCompare(String(b?.name || ''), 'de', { sensitivity: 'base' });

const zeileNormal = (zeile) => ({
  id: String(zeile?.id || ''),
  name: String(zeile?.name || '').trim(),
  adresse: String(zeile?.adresse || '').trim(),
  lat: Number(zeile?.lat),
  lng: Number(zeile?.lng),
  radius_rein_m: Number(zeile?.radius_rein_m) || STANDARD_RADIEN.radius_rein_m,
  radius_raus_m: Number(zeile?.radius_raus_m) || STANDARD_RADIEN.radius_raus_m,
  icon: ICON_NACH_KEY.has(zeile?.icon) ? zeile.icon : 'pin',
});

export const orteNeuLaden = () => {
  if (ladeLauf) return ladeLauf;
  ladeLauf = (async () => {
    try {
      const [orteErgebnis, standardErgebnis] = await Promise.all([
        supabase.from('orte').select(ORTE_SPALTEN).order('name', { ascending: true }),
        supabase.from('orte_standard').select('radius_rein_m, radius_raus_m').limit(1),
      ]);
      const orte = !orteErgebnis?.error && Array.isArray(orteErgebnis?.data)
        ? orteErgebnis.data.map(zeileNormal).filter((ort) => ort.id && Number.isFinite(ort.lat) && Number.isFinite(ort.lng)).sort(nachName)
        : [];
      const standardZeile = !standardErgebnis?.error && Array.isArray(standardErgebnis?.data) ? standardErgebnis.data[0] : null;
      const standard = standardZeile
        ? {
          radius_rein_m: Number(standardZeile.radius_rein_m) || STANDARD_RADIEN.radius_rein_m,
          radius_raus_m: Number(standardZeile.radius_raus_m) || STANDARD_RADIEN.radius_raus_m,
        }
        : stand.standard;
      setzen({ orte, standard, geladen: true });
    } catch {
      setzen({ geladen: true });
    } finally {
      ladeLauf = null;
    }
    return stand;
  })();
  return ladeLauf;
};

const kanalStarten = () => {
  if (kanal || typeof supabase?.channel !== 'function') return;
  try {
    kanal = supabase
      .channel('dispo-orte')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'orte' }, () => orteNeuLaden())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'orte_standard' }, () => orteNeuLaden())
      .subscribe();
  } catch {
    kanal = null;
  }
};

export const orteStand = () => stand;
export const ortNachId = (id) => {
  const schluessel = String(id || '').trim();
  if (!schluessel) return null;
  return stand.orte.find((ort) => ort.id === schluessel) || null;
};

const abonnieren = (rueckmeldung) => {
  zuhoerer.add(rueckmeldung);
  if (!stand.geladen) orteNeuLaden();
  kanalStarten();
  return () => {
    zuhoerer.delete(rueckmeldung);
  };
};

export const useOrte = () => useSyncExternalStore(abonnieren, orteStand, orteStand);

// --- Vorschlaege beim Fahrt erstellen -----------------------------------

const klein = (text) => String(text || '').trim().toLocaleLowerCase('de-DE');

// Eigene Orte zum Getippten: erst Namen, die damit beginnen, dann Namen mit
// einem Wort, das damit beginnt. Ohne Gross/klein, schon ab einem Buchstaben.
export const orteZurEingabe = (orte, eingabe, hoechstens = 5) => {
  const suche = klein(eingabe);
  if (!suche) return [];
  const anfang = [];
  const wortAnfang = [];
  (Array.isArray(orte) ? orte : []).forEach((ort) => {
    const name = klein(ort?.name);
    if (!name) return;
    if (name.startsWith(suche)) anfang.push(ort);
    else if (name.split(/[\s\-/,.()]+/).some((wort) => wort.startsWith(suche))) wortAnfang.push(ort);
  });
  return [...anfang, ...wortAnfang].slice(0, hoechstens);
};

// --- Pflege durch die Dispo ---------------------------------------------

const fehlerArt = (fehler) => {
  const text = `${fehler?.code || ''} ${fehler?.message || ''}`;
  if (/23505|orte_name_eindeutig|duplicate key/i.test(text)) return 'doppelt';
  if (/23514|raus_groesser_rein|check constraint/i.test(text)) return 'radien';
  return 'fehler';
};

export const radienPruefen = (rein, raus) => {
  const r = Number(rein);
  const a = Number(raus);
  if (!Number.isInteger(r) || r < RADIUS_REIN_MIN || r > RADIUS_REIN_MAX) return 'rein';
  if (!Number.isInteger(a) || a < RADIUS_RAUS_MIN || a > RADIUS_RAUS_MAX) return 'raus';
  if (a <= r) return 'radien';
  return '';
};

export const ortSpeichern = async (ort) => {
  const daten = {
    name: String(ort?.name || '').trim(),
    adresse: String(ort?.adresse || '').trim(),
    lat: Number(ort?.lat),
    lng: Number(ort?.lng),
    radius_rein_m: Number(ort?.radius_rein_m),
    radius_raus_m: Number(ort?.radius_raus_m),
    icon: ICON_NACH_KEY.has(ort?.icon) ? ort.icon : 'pin',
  };
  const doppelt = stand.orte.some((anderer) => anderer.id !== ort?.id && klein(anderer.name) === klein(daten.name));
  if (doppelt) return { ok: false, art: 'doppelt' };
  const ergebnis = ort?.id
    ? await supabase.from('orte').update(daten).eq('id', ort.id).select(ORTE_SPALTEN)
    : await supabase.from('orte').insert(daten).select(ORTE_SPALTEN);
  if (ergebnis?.error) return { ok: false, art: fehlerArt(ergebnis.error), meldung: ergebnis.error.message || '' };
  const zeile = Array.isArray(ergebnis?.data) ? ergebnis.data[0] : ergebnis?.data;
  if (ort?.id && !zeile) return { ok: false, art: 'fehler', meldung: '' };
  const neu = zeileNormal(zeile || { ...daten, id: ort?.id });
  setzen({ orte: [...stand.orte.filter((anderer) => anderer.id !== neu.id), neu].sort(nachName) });
  orteNeuLaden();
  return { ok: true, ort: neu };
};

export const ortLoeschen = async (id) => {
  const ergebnis = await supabase.from('orte').delete().eq('id', id);
  if (ergebnis?.error) return { ok: false, art: 'fehler', meldung: ergebnis.error.message || '' };
  setzen({ orte: stand.orte.filter((ort) => ort.id !== id) });
  orteNeuLaden();
  return { ok: true };
};

export const standardSpeichern = async (rein, raus) => {
  const daten = { radius_rein_m: Number(rein), radius_raus_m: Number(raus) };
  const ergebnis = await supabase.from('orte_standard').update(daten).eq('id', true).select('radius_rein_m, radius_raus_m');
  if (ergebnis?.error) return { ok: false, art: fehlerArt(ergebnis.error), meldung: ergebnis.error.message || '' };
  // Ohne Dispo-Recht aendert die DB still keine Zeile. In der Demo gibt es die Tabelle nicht.
  if (!DEMO_MODE && Array.isArray(ergebnis?.data) && ergebnis.data.length === 0) return { ok: false, art: 'fehler', meldung: '' };
  setzen({ standard: daten });
  return { ok: true };
};
