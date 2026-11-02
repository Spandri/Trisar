// Import von Fahrten und Fahrgästen aus Excel- (.xlsx/.xls) und CSV-Dateien.
// Spalten werden über ihre Überschrift erkannt (deutsch oder englisch), die
// Reihenfolge in der Datei ist damit egal.

import * as XLSX from 'xlsx';

const norm = (value) => String(value ?? '').trim();
const normKey = (value) => norm(value).toLowerCase().replace(/[^a-z0-9äöüß]/g, '');

// Kopfzeilen-Synonyme je Zielfeld
const RIDE_COLUMNS = {
  rideDate: ['datum', 'date', 'fahrtdatum', 'ridedate'],
  etd: ['zeit', 'uhrzeit', 'etd', 'abfahrt', 'time'],
  pickup: ['start', 'von', 'abholung', 'pickup', 'startadresse', 'pickupaddress'],
  dropoff: ['ziel', 'nach', 'zielort', 'dropoff', 'zieladresse', 'dropoffaddress'],
  flightNumber: ['flug', 'flugnummer', 'flightnumber', 'flight'],
  trainNumber: ['zug', 'zugnummer', 'trainnumber', 'train'],
  passengers: ['gäste', 'gaeste', 'passagiere', 'personen', 'passengers', 'guests'],
  note: ['notiz', 'hinweis', 'bemerkung', 'note', 'notes'],
  tripType: ['typ', 'art', 'type', 'triptype'],
};

const GUEST_COLUMNS = {
  firstName: ['vorname', 'firstname'],
  lastName: ['nachname', 'name', 'lastname', 'familienname'],
  email: ['email', 'emailadresse', 'mail'],
  phone: ['telefon', 'telefonnummer', 'phone', 'mobil', 'handy'],
  company: ['firma', 'unternehmen', 'company'],
  street: ['straße', 'strasse', 'street'],
  streetNumber: ['hausnummer', 'nr', 'streetnumber'],
  zip: ['plz', 'postleitzahl', 'zip', 'postcode'],
  city: ['stadt', 'ort', 'city'],
  language: ['sprache', 'language'],
  notes: ['notiz', 'hinweis', 'bemerkung', 'note', 'notes'],
  isVip: ['vip', 'isvip', 'vipstatus'],
};

// Häufigstes Trennzeichen der Kopfzeile bestimmen (Semikolon ist in
// deutschen Excel-Exporten üblich, Komma und Tab kommen ebenfalls vor).
const detectSeparator = (text) => {
  const firstLine = String(text || '').split(/\r?\n/)[0] || '';
  const counts = [';', ',', '\t'].map((sep) => [sep, firstLine.split(sep).length - 1]);
  const [best] = counts.sort((a, b) => b[1] - a[1]);
  return best[1] > 0 ? best[0] : ';';
};

const readWorkbookRows = async (file) => {
  const name = String(file?.name || '').toLowerCase();
  const isCsv = name.endsWith('.csv') || /csv|text\/plain/.test(String(file?.type || ''));
  let workbook;

  if (isCsv) {
    // CSV als UTF-8-Text lesen — als Bytes interpretiert XLSX Umlaute falsch.
    const text = (await file.text()).replace(/^\uFEFF/, '');
    workbook = XLSX.read(text, { type: 'string', cellDates: true, raw: false, FS: detectSeparator(text) });
  } else {
    const buffer = await file.arrayBuffer();
    workbook = XLSX.read(buffer, { type: 'array', cellDates: true, raw: false });
  }

  const sheetName = workbook.SheetNames[0];
  if (!sheetName) return [];
  // header: 1 => Zeilen als Arrays, damit wir die Kopfzeile selbst zuordnen.
  return XLSX.utils.sheet_to_json(workbook.Sheets[sheetName], { header: 1, blankrows: false, defval: '' });
};

// Kopfzeile auf Zielfelder abbilden: { feld: spaltenIndex }
const mapHeader = (headerRow, columnMap) => {
  const mapping = {};
  headerRow.forEach((cell, index) => {
    const key = normKey(cell);
    if (!key) return;
    Object.entries(columnMap).forEach(([field, synonyms]) => {
      if (mapping[field] != null) return;
      if (synonyms.includes(key)) mapping[field] = index;
    });
  });
  return mapping;
};

const cell = (row, index) => (index == null ? '' : norm(row[index]));

const toIsoDate = (value) => {
  const text = norm(value);
  if (!text) return '';
  if (/^\d{4}-\d{2}-\d{2}/.test(text)) return text.slice(0, 10);
  // deutsche Schreibweise 31.12.2026 oder 31.12.26
  const de = text.match(/^(\d{1,2})\.(\d{1,2})\.(\d{2,4})/);
  if (de) {
    const [, d, m, y] = de;
    const year = y.length === 2 ? `20${y}` : y;
    return `${year}-${m.padStart(2, '0')}-${d.padStart(2, '0')}`;
  }
  const parsed = new Date(text);
  if (!Number.isNaN(parsed.getTime())) {
    return `${parsed.getFullYear()}-${String(parsed.getMonth() + 1).padStart(2, '0')}-${String(parsed.getDate()).padStart(2, '0')}`;
  }
  return '';
};

const toClock = (value) => {
  const text = norm(value);
  const match = text.match(/(\d{1,2})[:.](\d{2})/);
  if (!match) return '';
  const hours = Number.parseInt(match[1], 10);
  const minutes = Number.parseInt(match[2], 10);
  if (!Number.isFinite(hours) || hours > 23 || minutes > 59) return '';
  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`;
};

const shortName = (address) => norm(address).split(',')[0] || norm(address);
const isTruthy = (value) => /^(ja|yes|true|x|1)$/i.test(norm(value));

export const IMPORT_TEMPLATES = {
  rides: 'Datum;Zeit;Start;Ziel;Flugnummer;Gäste;Notiz',
  guests: 'Vorname;Nachname;E-Mail;Telefon;Firma;Straße;Hausnummer;PLZ;Stadt;Sprache;VIP;Notiz',
};

// Liest eine Datei und liefert { rows, warnings } mit fertigen Datensätzen.
export const parseImportFile = async (file, mode) => {
  const warnings = [];
  const raw = await readWorkbookRows(file);
  if (raw.length === 0) return { rows: [], warnings: ['Die Datei enthält keine Zeilen.'] };

  const columnMap = mode === 'guests' ? GUEST_COLUMNS : RIDE_COLUMNS;
  const mapping = mapHeader(raw[0], columnMap);
  if (Object.keys(mapping).length === 0) {
    return {
      rows: [],
      warnings: [`Keine bekannten Spalten gefunden. Erwartete Kopfzeile: ${IMPORT_TEMPLATES[mode]}`],
    };
  }

  const rows = [];
  for (let i = 1; i < raw.length; i += 1) {
    const row = raw[i];
    if (!row || row.every((value) => !norm(value))) continue;
    const lineNumber = i + 1;

    if (mode === 'guests') {
      const firstName = cell(row, mapping.firstName);
      const lastName = cell(row, mapping.lastName);
      if (!firstName && !lastName) {
        warnings.push(`Zeile ${lineNumber}: ohne Namen übersprungen.`);
        continue;
      }
      rows.push({
        first_name: firstName,
        last_name: lastName,
        email: cell(row, mapping.email) || null,
        phone: cell(row, mapping.phone) || null,
        company: cell(row, mapping.company) || null,
        street: cell(row, mapping.street) || null,
        street_number: cell(row, mapping.streetNumber) || null,
        zip: cell(row, mapping.zip) || null,
        city: cell(row, mapping.city) || null,
        language: cell(row, mapping.language) || 'Deutsch',
        notes: cell(row, mapping.notes) || null,
        note_text: cell(row, mapping.notes) || null,
        is_vip: isTruthy(cell(row, mapping.isVip)),
        vip_status: isTruthy(cell(row, mapping.isVip)),
      });
      continue;
    }

    const pickup = cell(row, mapping.pickup);
    const dropoff = cell(row, mapping.dropoff);
    const etd = toClock(cell(row, mapping.etd));
    if (!pickup || !dropoff) {
      warnings.push(`Zeile ${lineNumber}: Start oder Ziel fehlt, übersprungen.`);
      continue;
    }
    if (!etd) {
      warnings.push(`Zeile ${lineNumber}: keine gültige Uhrzeit, übersprungen.`);
      continue;
    }
    const rideDate = toIsoDate(cell(row, mapping.rideDate));
    const flightNumber = cell(row, mapping.flightNumber).toUpperCase();
    const passengers = Number.parseInt(cell(row, mapping.passengers), 10);

    rows.push({
      ride_date: rideDate || null,
      etd,
      pickup_name: shortName(pickup),
      pickup_address: pickup,
      dropoff_name: shortName(dropoff),
      dropoff_address: dropoff,
      flight_number: flightNumber || null,
      train_number: cell(row, mapping.trainNumber) || null,
      passengers: Number.isFinite(passengers) ? passengers : null,
      trip_type: /airport|flug/i.test(cell(row, mapping.tripType)) ? 'airport' : 'normal',
      note: cell(row, mapping.note) || null,
      status: 'open',
    });
  }

  if (rows.length === 0 && warnings.length === 0) {
    warnings.push('Keine gültigen Datensätze gefunden.');
  }
  return { rows, warnings };
};
