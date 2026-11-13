// Feste Testdaten fuer den KI-Testsatz. Datum relativ zu heute (Europe/Berlin), damit
// "heute" und "morgen" in den Faellen immer stimmen. Keine echten Kundendaten.

export const tagBerlin = (plus = 0) => {
  const d = new Date(Date.now() + plus * 86400000);
  return d.toLocaleDateString('sv-SE', { timeZone: 'Europe/Berlin' });
};

export const ID = {
  dispo: '00000000-0000-4000-8000-000000000001',
  stefano: '00000000-0000-4000-8000-000000000011',
  tim: '00000000-0000-4000-8000-000000000012',
  marvin: '00000000-0000-4000-8000-000000000013',
  anna: '00000000-0000-4000-8000-000000000014',
  fahrtEngel: '00000000-0000-4000-8000-000000000101',
  fahrtMueller: '00000000-0000-4000-8000-000000000102',
  fahrtOffen: '00000000-0000-4000-8000-000000000103',
  fahrtMorgen: '00000000-0000-4000-8000-000000000104',
  fahrtTim: '00000000-0000-4000-8000-000000000105',
  fahrtAnnaFrueh: '00000000-0000-4000-8000-000000000106',
  fahrtAnnaAcht: '00000000-0000-4000-8000-000000000107',
  dienstStefano: '00000000-0000-4000-8000-000000000201',
};

export const testdaten = (ollamaUrl: string, ollamaModell: string, verstehenModell = '') => {
  const heute = tagBerlin(0);
  const morgen = tagBerlin(1);
  const uebermorgen = tagBerlin(2);
  const jetzt = new Date().toISOString();
  return {
    integration_settings: [
      { key: 'ollama_url', value: ollamaUrl },
      { key: 'ollama_model', value: ollamaModell },
      // Verstehen per Modell (verstehen.ts). Leer: nur Regeln wie vor dem Umbau.
      ...(verstehenModell ? [{ key: 'ollama_model_verstehen', value: verstehenModell }] : []),
    ],
    profiles: [
      { id: ID.dispo, first_name: 'Dispo', last_name: 'Zentrale', role: 'dispo', is_dispo: true, driver_number: null },
      { id: ID.stefano, first_name: 'Stefano', last_name: 'Spandri', role: 'driver', driver_number: 1, phone: '+49 151 1', vehicle_id: 'v1', service_start_time: '08:00', service_end_time: null },
      { id: ID.tim, first_name: 'Tim', last_name: 'Schedler', role: 'driver', driver_number: 113, phone: '+49 151 2', vehicle_id: 'v2' },
      { id: ID.marvin, first_name: 'Marvin', last_name: 'Keller', role: 'driver', driver_number: 112, phone: '+49 151 3', vehicle_id: null },
      { id: ID.anna, first_name: 'Anna', last_name: 'Berger', role: 'driver', driver_number: 5, phone: '+49 151 4', vehicle_id: 'v3' },
    ],
    vehicles: [
      { id: 'v1', license_plate: 'M-TR 101', brand_model: 'BMW 7er', trim: 'Limousine', color: 'schwarz' },
      { id: 'v2', license_plate: 'M-TR 102', brand_model: 'Mercedes V-Klasse', trim: 'Van', color: 'schwarz', range_km: 312, battery_fuel_percent: 54 },
      { id: 'v3', license_plate: 'M-TR 103', brand_model: 'BMW X5', trim: 'SUV', color: 'grau' },
    ],
    guests: [
      { id: 'g1', first_name: 'Horst', last_name: 'Engel' },
      { id: 'g2', first_name: 'Markus', last_name: 'Müller' },
      { id: 'g3', first_name: 'Julia', last_name: 'Weber', phone: '+49 170 333', company: 'BMW Group', needs_child_seat: true },
    ],
    job_guests: [
      { job_id: ID.fahrtEngel, guest_id: 'g1', is_main_contact: true },
      { job_id: ID.fahrtMueller, guest_id: 'g2', is_main_contact: true },
      { job_id: ID.fahrtMorgen, guest_id: 'g3', is_main_contact: true },
    ],
    jobs: [
      { id: ID.fahrtEngel, ride_date: heute, etd: '10:30:00', status: 'assigned', driver_id: ID.stefano, convoy_id: null,
        pickup_name: 'Hotel Bayerischer Hof', pickup_address: 'Promenadeplatz 2-6, München',
        dropoff_name: 'Flughafen München Terminal 2', dropoff_address: 'Terminalstraße Mitte, Flughafen München',
        passengers: ['Horst Engel'], anonymous_guests: 0,
        // Diese Fahrt hat Routendaten wie live (Dauer, Koordinaten), die anderen nicht.
        ext_route_duration_mins: 38, route_von: { lat: 48.14037, lon: 11.57348 }, route_nach: { lat: 48.3537, lon: 11.7858 } },
      { id: ID.fahrtMueller, ride_date: heute, etd: '14:00:00', status: 'assigned', driver_id: ID.stefano, convoy_id: null,
        pickup_name: 'Flughafen München Terminal 1', pickup_address: 'Flughafen München',
        dropoff_name: 'Messe München', dropoff_address: 'Messegelände, München',
        passengers: ['Markus Müller'], anonymous_guests: 1 },
      { id: ID.fahrtTim, ride_date: heute, etd: '09:00:00', status: 'assigned', driver_id: ID.tim, convoy_id: null,
        pickup_name: 'Hauptbahnhof München', pickup_address: 'Bayerstraße 10a, München',
        dropoff_name: 'Hotel Vier Jahreszeiten', dropoff_address: 'Maximilianstraße 17, München',
        passengers: [], anonymous_guests: 2 },
      { id: ID.fahrtOffen, ride_date: heute, etd: '18:00:00', status: 'pending', driver_id: null, convoy_id: null,
        pickup_name: 'Messe München', pickup_address: 'Messegelände, München',
        dropoff_name: 'Hotel Bayerischer Hof', dropoff_address: 'Promenadeplatz 2-6, München',
        passengers: [], anonymous_guests: 3 },
      { id: ID.fahrtMorgen, ride_date: morgen, etd: '07:15:00', status: 'assigned', driver_id: ID.anna, convoy_id: null,
        pickup_name: 'Hotel Bayerischer Hof', pickup_address: 'Promenadeplatz 2-6, München',
        dropoff_name: 'Flughafen München Terminal 2', dropoff_address: 'Flughafen München',
        passengers: ['Julia Weber'], anonymous_guests: 0 },
      // Uebermorgen zwei Fahrten fuer Anna, die zweite ist nach der ersten nicht zu schaffen.
      { id: ID.fahrtAnnaFrueh, ride_date: uebermorgen, etd: '07:00:00', status: 'assigned', driver_id: ID.anna, convoy_id: null,
        pickup_name: 'Hauptbahnhof München', pickup_address: 'Bayerstraße 10a, München',
        dropoff_name: 'Flughafen München Terminal 2', dropoff_address: 'Flughafen München',
        passengers: [], anonymous_guests: 1 },
      { id: ID.fahrtAnnaAcht, ride_date: uebermorgen, etd: '08:00:00', status: 'assigned', driver_id: ID.anna, convoy_id: null,
        pickup_name: 'Flughafen München Terminal 1', pickup_address: 'Flughafen München',
        dropoff_name: 'Messe München', dropoff_address: 'Messegelände, München',
        passengers: [], anonymous_guests: 2 },
    ],
    // Eigene Orte wie im Karten Filter.
    orte: [
      { id: 'o1', name: 'Hotel Bayerischer Hof', adresse: 'Promenadeplatz 2-6, 80333 München', lat: 48.14037, lng: 11.57348, radius_rein_m: 50, radius_raus_m: 120 },
      { id: 'o2', name: 'Hauptbahnhof München', adresse: 'Bayerstraße 10a, 80335 München', lat: 48.1402, lng: 11.5601, radius_rein_m: 80, radius_raus_m: 200 },
      { id: 'o3', name: 'Flughafen München Terminal 1', adresse: 'Nordallee, 85356 München-Flughafen', lat: 48.3515, lng: 11.7766, radius_rein_m: 150, radius_raus_m: 300 },
      { id: 'o4', name: 'Flughafen München Terminal 2', adresse: 'Terminalstraße Mitte, 85356 München-Flughafen', lat: 48.3537, lng: 11.7858, radius_rein_m: 150, radius_raus_m: 300 },
      { id: 'o5', name: 'Messe München', adresse: 'Messegelände, 81829 München', lat: 48.136, lng: 11.695, radius_rein_m: 150, radius_raus_m: 300 },
      { id: 'o6', name: 'Hotel Vier Jahreszeiten', adresse: 'Maximilianstraße 17, 80539 München', lat: 48.1391, lng: 11.5819, radius_rein_m: 50, radius_raus_m: 120 },
    ],
    job_notes: [],
    convoy_assignments: [],
    convoys: [],
    driver_live_locations: [
      { driver_id: ID.stefano, lat: 48.1405, lng: 11.5735, captured_at: jetzt, active_job_id: null },
      { driver_id: ID.tim, lat: 48.1402, lng: 11.5600, captured_at: jetzt, active_job_id: ID.fahrtTim },
    ],
    driver_service_requests: [
      { id: ID.dienstStefano, driver_id: ID.stefano, service_date: heute, service_start_time: '08:00:00', service_end_time: null, status: 'accepted', created_at: jetzt },
      // Stefano gestern Nachtdienst, fuer "Lösch den Dienststart von gestern".
      { id: 'dienst-stefano-gestern', driver_id: ID.stefano, service_date: tagBerlin(-1), service_start_time: '22:00:00', service_end_time: '23:30:00', status: 'accepted', created_at: jetzt },
      // Anna morgen mit Pause, fuer Dienst- und Pausenfragen.
      { id: 'dienst-anna', driver_id: ID.anna, service_date: tagBerlin(1), service_start_time: '07:00:00', service_end_time: '15:00:00', status: 'accepted', created_at: jetzt },
    ],
    obd_tracker: [
      { imei: '350000000000003', nummer: 3, vehicle_id: 'v1' },
      { imei: '350000000000004', nummer: 4, vehicle_id: null },
    ],
    dienst_pausen: [{ dienst_id: 'dienst-anna', pausen: [{ von: '11:30', bis: '12:00' }] }],
    // Stundenzettel heute: Tim bestaetigt 8 h, Marvin offen 6:30 h.
    stundenzettel: [
      { id: 'z1', driver_id: ID.tim, datum: heute, arbeits_min: 480, status: 'bestaetigt', angepasst: false },
      { id: 'z2', driver_id: ID.marvin, datum: heute, arbeits_min: 390, status: 'eingereicht', angepasst: true },
    ],
    ki_protokoll: [],
    job_notes: [],
    jobs_archive: [],
    // Standby morgen am Kongress: Tim und Marvin. Fuer Standby anzeigen, loeschen, verschieben.
    standby: [{ id: 'sb1', datum: tagBerlin(1), von: '10:00:00', bis: '18:00:00', ort_name: 'Kongress', adresse: 'Messe München' }],
    standby_fahrer: [{ standby_id: 'sb1', driver_id: ID.tim, status: 'angefragt' }, { standby_id: 'sb1', driver_id: ID.marvin, status: 'angefragt' }],
  };
};
