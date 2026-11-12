// Flugnummer eines Buchungsvorschlags des KI-Assistenten pruefen (Funktion flight-validate, wie beim
// Speichern in den Apps). Ist der Flug nicht bestaetigt, bekommt der Vorschlag flugUnbestaetigt und die
// Antwort einen Hinweis. Buchen speichert dann trotzdem, mit Flugnummer aber ohne Flugdaten
// (Apps: flugOhnePruefung), Nicht buchen verwirft, Antippen oeffnet das Formular zum Anpassen.
// Ohne Server-Umgebung (Testsatz) wird nicht geprueft.

// deno-lint-ignore-file no-explicit-any

export type FlugErgebnis = { gueltig: boolean; grund: string } | null;

export const flugPruefen = async (nummer: string, datum: string, hinweis = ''): Promise<FlugErgebnis> => {
  const url = Deno.env.get('SUPABASE_URL');
  const schluessel = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (!url || !schluessel || !nummer || !datum) return null;
  const iata = String(hinweis || '').match(/\b([A-Z]{3})\b/)?.[1] || '';
  try {
    const r = await fetch(`${url.replace(/\/$/, '')}/functions/v1/flight-validate`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${schluessel}`, apikey: schluessel, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        flight_number: nummer.replace(/\s+/g, '').toUpperCase(),
        ride_date: datum,
        require_lufthansa_group: false,
        ...(iata ? { target_airport_iata: iata } : {}),
      }),
      signal: AbortSignal.timeout(15000),
    });
    const d = await r.json().catch(() => ({}));
    if (d?.valid === true) return { gueltig: true, grund: '' };
    const grund = d?.reason === 'flight_not_found' ? 'nicht gefunden'
      : d?.reason === 'invalid_format' ? 'ungültige Flugnummer'
      : d?.reason === 'multiple_matches' ? 'mehrere Flüge mit dieser Nummer'
      : String(d?.message || d?.error || 'Prüfung nicht möglich');
    return { gueltig: false, grund };
  } catch {
    return { gueltig: false, grund: 'Prüfung gerade nicht möglich' };
  }
};

const datumText = (iso: string) => {
  const [j, m, t] = String(iso || '').split('-');
  return j && m && t ? `${Number(t)}.${Number(m)}.` : iso;
};

export const flugHinweis = (nummer: string, datum: string, grund: string) => `Flug ${nummer} konnte ich für den ${datumText(datum)} nicht bestätigen (${grund}). `
  + 'Mit Buchen speichere ich die Fahrt trotzdem, mit Flugnummer aber ohne Flugdaten. Mit Nicht buchen verwirfst du sie, '
  + 'oder du tippst auf die Karte und passt sie an.';
