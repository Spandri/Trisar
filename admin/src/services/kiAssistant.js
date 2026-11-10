import { supabase } from './supabase';
import { DEMO_MODE } from '../datenquelle';

// Letzte Fahrer und Fahrten des Gespraechs, damit Rueckfragen wie "und seine Nummer?" funktionieren.
let gespraechsKontext = null;

// Der Server laedt die Daten bei jeder Frage frisch, es gibt hier nichts mehr zu verwerfen.
export const invalidateDatabaseAssistantCache = () => {};

const getDriverDisplayName = (profile) => [profile?.first_name, profile?.last_name].filter(Boolean).join(' ').trim();

const toTimeMinutes = (value) => {
  const match = String(value || '').trim().match(/^(\d{1,2}):(\d{2})/);
  if (!match) return null;
  const h = Number.parseInt(match[1], 10);
  const m = Number.parseInt(match[2], 10);
  if (!Number.isFinite(h) || !Number.isFinite(m)) return null;
  if (h < 0 || h > 23 || m < 0 || m > 59) return null;
  return h * 60 + m;
};

// --- DEMO-VORSCHAU: geskripteter KI-Assistent ----------------------------
// Das lokale Sprachmodell ist in der Online-Demo nicht erreichbar. Statt einer
// pauschalen Absage erkennt der Assistent genau eine Beispielanfrage (die das
// Tutorial eintippt) und liefert dafuer eine echte Buchungs-Vorschau im selben
// Format wie der LLM-Planer. Alle anderen Nachrichten bekommen einen festen,
// uebersetzten Hinweis (answerKey, die View uebersetzt).
export const KI_DEMO_ANFRAGE = 'Bitte buche morgen um 10:30 eine Fahrt für Katharina Vogel vom Hotel Bayerischer Hof zum Flughafen München Terminal 2.';

const KI_DEMO_TIPP_VERZOEGERUNG_MS = 1300;
const KI_DEMO_HINWEIS_VERZOEGERUNG_MS = 900;
const KI_DEMO_ZEIT = '10:30';
const KI_DEMO_GAST = 'Katharina Vogel';
const KI_DEMO_START = 'Hotel Bayerischer Hof';
// Kurzname wie bei den uebrigen Flughafenfahrten (orte.json kennt ihn, Karte und
// Distanzen funktionieren) — passt auch in die Vorschaukarte ohne Ueberlappung.
const KI_DEMO_ZIEL = 'MUC Terminal 2';
// Bevorzugte Fahrer (bekannt aus der Summit-Kolonne, alle mit Fahrzeug).
// Stefano Spandri ist morgen bereits mehrfach verplant und bleibt aussen vor.
const KI_DEMO_FAHRER_KANDIDATEN = ['Aaron Adler', 'Simone Schäfer', 'Elif Şahin'];
// Mindestabstand zu anderen Fahrten des Fahrers am selben Tag.
const KI_DEMO_KONFLIKT_PUFFER_MIN = 120;

const normalizeDemoPrompt = (value) => String(value || '')
  .toLowerCase()
  .replace(/\s+/g, ' ')
  .trim()
  .replace(/[\s.!?…]+$/g, '')
  .trim();

export const isKiDemoAnfrage = (prompt) => normalizeDemoPrompt(prompt) === normalizeDemoPrompt(KI_DEMO_ANFRAGE);

const wait = (ms) => new Promise((resolve) => { setTimeout(resolve, ms); });

// "Morgen" auf Basis der lokalen Uhr — genauso rechnet die Datumsverschiebung
// im Demo-Client (Basistag = lokales Heute) und die Fahrtenliste.
const getLocalTomorrowIsoDate = () => {
  const now = new Date();
  const tomorrow = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
  return `${tomorrow.getFullYear()}-${String(tomorrow.getMonth() + 1).padStart(2, '0')}-${String(tomorrow.getDate()).padStart(2, '0')}`;
};

const pickKiDemoDriver = async (rideDate) => {
  const fallback = { name: KI_DEMO_FAHRER_KANDIDATEN[0], vehicle: '' };
  try {
    const { data: profiles } = await supabase.from('profiles').select('id, first_name, last_name, vehicle_id');
    const { data: dayJobs } = await supabase.from('jobs').select('id, driver_id, etd').eq('ride_date', rideDate);
    const jobIds = (dayJobs || []).map((job) => job.id);
    const { data: assignments } = jobIds.length > 0
      ? await supabase.from('convoy_assignments').select('job_id, driver_id').in('job_id', jobIds)
      : { data: [] };
    const etdByJobId = new Map((dayJobs || []).map((job) => [String(job.id), job.etd]));
    const demoMinutes = toTimeMinutes(KI_DEMO_ZEIT);
    const busyMinutesByDriver = new Map();
    const addBusy = (driverId, etd) => {
      const minutes = toTimeMinutes(etd);
      if (!driverId || minutes == null) return;
      const key = String(driverId);
      if (!busyMinutesByDriver.has(key)) busyMinutesByDriver.set(key, []);
      busyMinutesByDriver.get(key).push(minutes);
    };
    (dayJobs || []).forEach((job) => addBusy(job.driver_id, job.etd));
    (assignments || []).forEach((row) => addBusy(row.driver_id, etdByJobId.get(String(row.job_id))));

    for (const candidateName of KI_DEMO_FAHRER_KANDIDATEN) {
      const profile = (profiles || []).find((row) => getDriverDisplayName(row) === candidateName);
      if (!profile) continue;
      const busy = busyMinutesByDriver.get(String(profile.id)) || [];
      const hasConflict = demoMinutes != null
        && busy.some((minutes) => Math.abs(minutes - demoMinutes) < KI_DEMO_KONFLIKT_PUFFER_MIN);
      if (hasConflict) continue;
      let vehicle = '';
      if (profile.vehicle_id) {
        const { data: vehicleRow } = await supabase
          .from('vehicles')
          .select('brand_model, trim, license_plate')
          .eq('id', profile.vehicle_id)
          .maybeSingle();
        if (vehicleRow) {
          const model = [vehicleRow.brand_model, vehicleRow.trim].filter(Boolean).join(' ');
          vehicle = vehicleRow.license_plate ? `${model} (${vehicleRow.license_plate})` : model;
        }
      }
      return { name: candidateName, vehicle };
    }
  } catch {
    // Demo: bei Fehlern mit dem Standardfahrer weiter
  }
  return fallback;
};

const buildKiDemoBookingAnswer = async () => {
  const rideDate = getLocalTomorrowIsoDate();
  const driver = await pickKiDemoDriver(rideDate);
  const proposal = {
    payload: {
      datum: rideDate,
      startZeit: KI_DEMO_ZEIT,
      start: KI_DEMO_START,
      ziel: KI_DEMO_ZIEL,
      fahrgaeste: KI_DEMO_GAST,
      anonymeGaeste: '0',
      fahrerNamen: [driver.name],
      konvoi: '',
      flugnummer: '',
      notes: '',
      aktuellerStatus: 'offen',
    },
  };
  const answerVars = {
    guest: KI_DEMO_GAST,
    date: `${rideDate.slice(8, 10)}.${rideDate.slice(5, 7)}.`,
    time: KI_DEMO_ZEIT,
    start: KI_DEMO_START,
    ziel: KI_DEMO_ZIEL,
    driver: driver.name,
    vehicle: driver.vehicle || 'BMW',
  };
  return {
    answer: `Gern. Ich habe die Fahrt für ${answerVars.guest} vorbereitet: morgen, ${answerVars.date}, um ${answerVars.time} Uhr, ${answerVars.start} → ${answerVars.ziel}. ${answerVars.driver} ist zu der Zeit frei und fährt den ${answerVars.vehicle}. Soll ich die Fahrt so buchen?`,
    answerKey: 'assist.demoBookingAnswer',
    answerVars,
    action: {
      type: 'booking_proposal',
      proposal: proposal.payload,
    },
    meta: { demo: true },
  };
};

// Weitere Beispielfragen der Demo. Die Antworten kommen aus den aktuellen
// Demo-Daten, nicht aus festen Texten: wer im Tutorial vorher etwas veraendert
// hat, sieht das auch hier.
export const KI_DEMO_FRAGE_OHNE_FAHRER = 'Welche Fahrten haben morgen noch keinen Fahrer?';
export const KI_DEMO_FRAGE_AKKU = 'Welche Fahrzeuge müssen heute noch laden oder tanken?';

const formatiereDatum = (iso) => `${iso.slice(8, 10)}.${iso.slice(5, 7)}.`;
const kurzerOrt = (name, adresse) => String(name || adresse || '').split(',')[0].trim() || '–';

const antwortOhneFahrer = async () => {
  const morgen = getLocalTomorrowIsoDate();
  const { data: fahrten } = await supabase
    .from('jobs')
    .select('id, etd, pickup_name, pickup_address, dropoff_name, dropoff_address, driver_id, status')
    .eq('ride_date', morgen);
  const { data: zuweisungen } = await supabase.from('convoy_assignments').select('job_id');
  const mitKolonne = new Set((zuweisungen || []).map((row) => String(row.job_id)));
  const offen = (fahrten || [])
    .filter((fahrt) => !fahrt.driver_id && !mitKolonne.has(String(fahrt.id)) && String(fahrt.status || '').toLowerCase() !== 'cancelled')
    .sort((a, b) => String(a.etd || '').localeCompare(String(b.etd || '')));
  if (!offen.length) {
    return { answer: `Morgen, ${formatiereDatum(morgen)}, sind alle Fahrten vergeben.`, meta: { demo: true } };
  }
  const beispiele = offen.slice(0, 3)
    .map((fahrt) => `${String(fahrt.etd || '').slice(0, 5)} Uhr: ${kurzerOrt(fahrt.pickup_name, fahrt.pickup_address)} → ${kurzerOrt(fahrt.dropoff_name, fahrt.dropoff_address)}`)
    .join('\n');
  return {
    answer: `Morgen, ${formatiereDatum(morgen)}, sind ${offen.length} Fahrten noch ohne Fahrer. Die nächsten sind:\n${beispiele}\nSoll ich passende freie Fahrer vorschlagen?`,
    meta: { demo: true },
  };
};

const antwortAkku = async () => {
  const { data: fahrzeuge } = await supabase
    .from('vehicles')
    .select('license_plate, brand_model, trim, fuel_type, battery_fuel_percent, range_km');
  const knapp = (fahrzeuge || [])
    .filter((fz) => Number.isFinite(Number(fz.battery_fuel_percent)) && Number(fz.battery_fuel_percent) < 30)
    .map((fz) => ({
      ...fz,
      prozent: Math.round(Number(fz.battery_fuel_percent)),
      // range_km ist die volle Reichweite, uebrig ist ihr Anteil am Stand.
      rest: Math.round(((Number(fz.range_km) || 0) * Number(fz.battery_fuel_percent)) / 100),
      elektrisch: /elektro|hybrid/i.test(String(fz.fuel_type || '')),
    }))
    .sort((a, b) => a.rest - b.rest);
  if (!knapp.length) {
    return { answer: 'Alle Fahrzeuge sind mindestens zu 30 % geladen oder getankt. Heute muss keines an die Säule.', meta: { demo: true } };
  }
  const zeile = (fz) => `${fz.license_plate || '–'} (${[fz.brand_model, fz.trim].filter(Boolean).join(' ')}): ${fz.prozent} %, noch etwa ${fz.rest} km`;
  const laden = knapp.filter((fz) => fz.elektrisch);
  const tanken = knapp.filter((fz) => !fz.elektrisch);
  const block = (titel, liste) => {
    if (!liste.length) return '';
    const mehr = liste.length > 3 ? `\nund ${liste.length - 3} weitere` : '';
    return `${titel} (${liste.length}):\n${liste.slice(0, 3).map(zeile).join('\n')}${mehr}`;
  };
  return {
    answer: [
      `${knapp.length} Fahrzeuge stehen unter 30 %. Die knappsten zuerst.`,
      block('Laden', laden),
      block('Tanken', tanken),
      'Am besten vor der nächsten längeren Fahrt erledigen.',
    ].filter(Boolean).join('\n\n'),
    meta: { demo: true },
  };
};

// Telefonnummer eines Fahrers ueber seine Nummer, etwa "Welche Telefonnummer
// hat Fahrer 10?". Die Nummer steht in der Antwort, die Ansicht macht sie klickbar.
export const KI_DEMO_FRAGE_TELEFON = 'Welche Telefonnummer hat Fahrer 10?';
const TELEFON_FRAGE_RE = /telefon(?:nummer)?|handynummer|nummer von|erreiche/i;
const FAHRERNUMMER_RE = /fahrer(?:in)?\s*(?:nr\.?|nummer)?\s*#?\s*(\d{1,3})/i;

const antwortTelefon = async (prompt) => {
  const treffer = String(prompt || '').match(FAHRERNUMMER_RE);
  const nummer = treffer ? Number(treffer[1]) : null;
  if (!Number.isFinite(nummer)) return null;
  const { data: profile } = await supabase
    .from('profiles')
    .select('first_name, last_name, phone, driver_number, role, is_dispo')
    .eq('driver_number', nummer);
  const fahrer = (profile || []).find((row) => row.is_dispo !== true) || (profile || [])[0];
  if (!fahrer) {
    return { answer: `Eine Fahrerin oder einen Fahrer mit der Nummer ${nummer} gibt es nicht.`, meta: { demo: true } };
  }
  const name = getDriverDisplayName(fahrer) || `Fahrer ${nummer}`;
  if (!String(fahrer.phone || '').trim()) {
    return { answer: `Fahrer ${nummer} ist ${name}. Eine Telefonnummer ist nicht hinterlegt.`, meta: { demo: true } };
  }
  return {
    answer: `Fahrer ${nummer} ist ${name}.\nTelefon: ${String(fahrer.phone).trim()}`,
    meta: { demo: true },
  };
};

const DEMO_FRAGEN = [
  {
    frage: KI_DEMO_FRAGE_TELEFON,
    passt: (text) => TELEFON_FRAGE_RE.test(text) && FAHRERNUMMER_RE.test(text),
    antwort: antwortTelefon,
  },
  { frage: KI_DEMO_FRAGE_OHNE_FAHRER, antwort: antwortOhneFahrer },
  { frage: KI_DEMO_FRAGE_AKKU, antwort: antwortAkku },
];

export const askDatabaseAssistant = async ({ prompt, chatHistory = [], offenerVorschlag = null, letzteFahrtId = null }) => {
  const trimmedPrompt = String(prompt || '').trim();
  if (!trimmedPrompt) return 'Bitte stelle eine Frage.';

  // Im Betrieb antwortet der Server (dispo-admin, Aktion ki_frage), das Modell laeuft im Tailnet.
  if (!DEMO_MODE) {
    const { data, error } = await supabase.functions.invoke('dispo-admin', {
      body: {
        aktion: 'ki_frage',
        frage: trimmedPrompt,
        verlauf: chatHistory,
        kontext: gespraechsKontext,
        offenerVorschlag,
        letzteFahrtId,
      },
    });
    if (error) throw error;
    gespraechsKontext = data?.kontext ?? gespraechsKontext;
    return data;
  }

  // DEMO-VORSCHAU: kein LLM — nur die Beispielanfrage wird beantwortet.
  if (isKiDemoAnfrage(trimmedPrompt)) {
    const [result] = await Promise.all([buildKiDemoBookingAnswer(), wait(KI_DEMO_TIPP_VERZOEGERUNG_MS)]);
    return result;
  }
  const beispielFrage = DEMO_FRAGEN.find((eintrag) => (
    normalizeDemoPrompt(eintrag.frage) === normalizeDemoPrompt(trimmedPrompt)
    || (typeof eintrag.passt === 'function' && eintrag.passt(trimmedPrompt))
  ));
  if (beispielFrage) {
    try {
      const antwort = await beispielFrage.antwort(trimmedPrompt);
      if (antwort) return antwort;
    } catch {
      // Demo: faellt auf den Hinweis unten zurueck
    }
  }
  await wait(KI_DEMO_HINWEIS_VERZOEGERUNG_MS);
  return {
    answer: 'Das ist eine Demo-Version. Auf freie Nachrichten kann der KI-Assistent hier leider nicht antworten. Eine Beispielbuchung zeigt das Tutorial.',
    answerKey: 'assist.demoNotice',
    meta: { demo: true },
  };
};
