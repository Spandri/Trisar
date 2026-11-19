import { modellGesperrt, modellSperren } from './verstehen.ts';
import { nurDeutsch } from './glaetten.ts';
// Freie Antworten (Umschalter "Frei" im KI-Assistenten, 13.11.): Fragen beantwortet das Modell auf dem
// Mac mini selbst, mit den Live-Daten der Dispo als Grundlage. Nur fuer reine Auskunft (Absicht frage /
// sonstiges). Aktionen wie Buchen, Dienst oder Loeschen laufen weiter ueber die festen Regeln mit Rueckfrage,
// damit das freie Modell nichts veraendern kann. Liefert null, wenn es nicht klappt, dann antworten die Regeln.

// deno-lint-ignore-file no-explicit-any

const DISPO_ROLLEN = new Set(['dispo', 'dispatcher', 'admin', 'koordinator', 'coordinator', 'pruefung']);

const berlin = (d: Date) => {
  const t = new Intl.DateTimeFormat('de-DE', { timeZone: 'Europe/Berlin', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', weekday: 'long' })
    .formatToParts(d).reduce((a: any, p) => ({ ...a, [p.type]: p.value }), {});
  return { tag: `${t.year}-${t.month}-${t.day}`, uhr: `${t.hour}:${t.minute}`, wochentag: t.weekday, text: `${t.weekday}, ${t.day}.${t.month}. ${t.hour}:${t.minute}` };
};

const uhr = (v: any) => (v ? String(v).slice(0, 5) : null);

// Entfernung in Metern (Haversine), um eine Position einem eigenen Ort zuzuordnen.
const meter = (a: number, b: number, c: number, d: number) => {
  const r = 6371000, f = Math.PI / 180;
  const x = Math.sin(((c - a) * f) / 2) ** 2 + Math.cos(a * f) * Math.cos(c * f) * Math.sin(((d - b) * f) / 2) ** 2;
  return 2 * r * Math.asin(Math.sqrt(x));
};

const minuten = (v: any) => (v ? Number(String(v).slice(0, 2)) * 60 + Number(String(v).slice(3, 5)) : null);
const gleicherOrt = (a: any, b: any) => {
  const n = (s: any) => String(s || '').toLowerCase().replace(/[^a-z0-9äöüß]/g, '');
  return Boolean(n(a) && n(b) && (n(a).includes(n(b)) || n(b).includes(n(a))));
};
const STATUS = {
  offen: ['pending', 'assigned', 'offen', 'new', 'requested', 'offered', 'zugewiesen', 'accepted'],
  beimGast: ['at_pickup', 'pickup', 'beim_pickup', 'beim pickup'],
  unterwegs: ['in_progress', 'unterwegs', 'started', 'on_trip', 'ongoing', 'active'],
  fertig: ['done', 'completed', 'arrived', 'beendet'],
};

/** Stand einer Fahrt als fertiger Satz (18.11.). Das kleine Modell rechnete aus Rohstatus und Planzeit falsch:
 *  "faehrt um 19:45 los" um 20:48, "ist in Bad Wiessee" waehrend der Fahrer noch am Flughafen stand. Darum stehen
 *  hier echte Abfahrt (GPS), erwartete bzw. echte Ankunft und der Abgleich Fahrer-Position mit dem Abholort. */
const fahrtStand = (j: any, jetztMin: number | null, fahrerOrt: string | null) => {
  const st = String(j.status || '').toLowerCase();
  const ab = j.abfahrt_echt ? berlin(new Date(j.abfahrt_echt)).uhr : null;
  const an = j.ankunft_echt ? berlin(new Date(j.ankunft_echt)).uhr : null;
  const erwartet = j.ankunft_erwartet ? berlin(new Date(j.ankunft_erwartet)).uhr : null;
  const spaetestens = minuten(j.etd_bis) ?? minuten(j.etd);
  const ueber = jetztMin != null && spaetestens != null && jetztMin > spaetestens ? jetztMin - spaetestens : 0;
  const zuSpaet = ueber > 0 ? `, die Startzeit ist seit ${ueber} Minuten vorbei` : '';
  if (STATUS.fertig.includes(st)) {
    return `erledigt${ab ? `, losgefahren um ${ab}` : ''}${an ? `, angekommen um ${an}` : ''}`;
  }
  if (STATUS.unterwegs.includes(st)) {
    if (j.abfahrt_quelle !== 'gps' && gleicherOrt(fahrerOrt, j.pickup_name)) {
      return `noch nicht losgefahren. Der Fahrer hat ${ab ? `um ${ab} ` : ''}auf Unterwegs gedrückt, steht laut GPS aber noch am Abholort ${fahrerOrt}${zuSpaet}`;
    }
    return `mit Gast unterwegs${ab ? `, losgefahren um ${ab}` : ''}${erwartet ? `, Ankunft am Ziel voraussichtlich um ${erwartet}` : ''}`;
  }
  if (STATUS.beimGast.includes(st)) return `Fahrer ist beim Gast, noch nicht losgefahren${zuSpaet}`;
  if (['cancelled', 'canceled', 'storniert', 'refused'].includes(st)) return 'storniert';
  return `noch nicht losgefahren${fahrerOrt ? `, Fahrer ist gerade ${fahrerOrt.startsWith('unterwegs') ? fahrerOrt : `bei ${fahrerOrt}`}` : ''}${zuSpaet}`;
};

/** Live-Daten fuer das Modell: Fahrer (Status, Ort, Dienst heute, Fahrzeug) und Fahrten heute und morgen. */
const lageLaden = async (admin: any) => {
  const jetzt = berlin(new Date());
  const morgen = berlin(new Date(Date.now() + 86400000)).tag;
  const [profile, fahrzeuge, positionen, orte, dienste, fahrten] = await Promise.all([
    admin.from('profiles').select('id, first_name, last_name, role, is_dispo, driver_activity_state, vehicle_id'),
    admin.from('vehicles').select('id, license_plate, brand_model'),
    admin.from('driver_live_locations').select('driver_id, lat, lng, updated_at'),
    admin.from('orte').select('name, lat, lng, radius_rein_m'),
    admin.from('driver_service_requests').select('driver_id, service_date, service_start_time, service_end_time, status')
      .eq('service_date', jetzt.tag),
    admin.from('jobs').select('ride_date, etd, etd_bis, pickup_name, dropoff_name, status, driver_id, passengers, abfahrt_echt, abfahrt_quelle, ankunft_echt, ankunft_erwartet')
      .in('ride_date', [jetzt.tag, morgen]).neq('status', 'cancelled').order('ride_date').order('etd').limit(80),
  ]);
  const fahrer = (profile.data || []).filter((p: any) => !p.is_dispo && !DISPO_ROLLEN.has(String(p.role || '').toLowerCase()));
  const name = new Map(fahrer.map((p: any) => [p.id, [p.first_name, p.last_name].filter(Boolean).join(' ').trim()]));
  const auto = new Map((fahrzeuge.data || []).map((v: any) => [v.id, [v.license_plate, v.brand_model].filter(Boolean).join(' ')]));
  const pos = new Map<string, any>((positionen.data || []).map((p: any) => [p.driver_id, p]));
  const ortVon = (p: any) => {
    if (!p || p.lat == null || p.lng == null) return null;
    let best: any = null;
    for (const o of orte.data || []) {
      if (o.lat == null || o.lng == null) continue;
      const m = meter(Number(p.lat), Number(p.lng), Number(o.lat), Number(o.lng));
      if (m <= Math.max(300, Number(o.radius_rein_m) || 0) && (!best || m < best.m)) best = { name: o.name, m };
    }
    return best ? best.name : 'unterwegs, nicht an einem bekannten Ort';
  };
  const jetztMin = Number(jetzt.uhr.slice(0, 2)) * 60 + Number(jetzt.uhr.slice(3, 5));
  const dienstVon = new Map((dienste.data || []).filter((d: any) => ['accepted', 'assigned', 'approved'].includes(String(d.status || '').toLowerCase()))
    .map((d: any) => [d.driver_id, `${uhr(d.service_start_time) || '?'} bis ${uhr(d.service_end_time) || '?'}`]));
  // Fahrer, die "Unterwegs" gedrueckt haben, laut GPS aber noch am Abholort stehen (Joris 17.11.).
  const wartetAmStart = new Set((fahrten.data || [])
    .filter((j: any) => STATUS.unterwegs.includes(String(j.status || '').toLowerCase()) && j.abfahrt_quelle !== 'gps'
      && pos.get(j.driver_id) && gleicherOrt(ortVon(pos.get(j.driver_id)), j.pickup_name))
    .map((j: any) => j.driver_id));
  return {
    jetzt: jetzt.text,
    fahrer: fahrer.map((p: any) => ({
      name: name.get(p.id),
      status: wartetAmStart.has(p.id) ? 'steht noch am Abholort, noch nicht losgefahren' : (p.driver_activity_state || 'unbekannt'),
      ort: ortVon(pos.get(p.id)),
      ortStand: pos.get(p.id)?.updated_at ? berlin(new Date(pos.get(p.id).updated_at)).uhr : null,
      dienstHeute: dienstVon.get(p.id) || 'kein Dienst',
      fahrzeug: auto.get(p.vehicle_id) || null,
    })),
    fahrten: (fahrten.data || []).map((j: any) => ({
      tag: j.ride_date === jetzt.tag ? 'heute' : 'morgen',
      // Startfenster ist die Zeit zum Losfahren. "19:45 bis 21:00" las das Modell als Ankunft um 21:00 (17.11.).
      losfahren: j.etd_bis ? `zwischen ${uhr(j.etd)} und ${uhr(j.etd_bis)}` : `um ${uhr(j.etd)}`,
      von: j.pickup_name, nach: j.dropoff_name,
      fahrer: name.get(j.driver_id) || 'noch kein Fahrer',
      stand: fahrtStand(j, j.ride_date === jetzt.tag ? jetztMin : null, pos.get(j.driver_id) ? ortVon(pos.get(j.driver_id)) : null),
      gaeste: Array.isArray(j.passengers) ? j.passengers.join(', ') : (j.passengers || null),
    })),
  };
};

const SYSTEM = `Du bist der Assistent der TRISAR-Dispo (Chauffeurdienst). Antworte auf Deutsch, kurz und natürlich gesprochen,
höchstens drei Sätze, ohne Listen, Aufzählungszeichen oder Sonderzeichen, Uhrzeiten wie "14:30".
Nutze ausschließlich die Daten unten. Steht etwas nicht darin, sag ehrlich, dass du es nicht weißt. Erfinde nichts.
Bei Fahrten gilt das Feld stand, es ist schon mit der aktuellen Uhrzeit abgeglichen. losfahren ist die geplante Zeit zum Losfahren, nie die Ankunft.
Rechne keine Ankunftszeit selbst aus. Nenne eine Ankunft nur, wenn sie im Feld stand steht.
Du kannst nichts buchen oder ändern. Will der Disponent etwas ändern, sag ihm, er soll es als Auftrag formulieren.
Ist nicht klar, wer gemeint ist (er, sie, der, die ohne Namen im Gespräch), frag nach dem Namen und nenne niemanden auf Verdacht.
Du heißt TRISAR-Assistent. Nenne nie den Hersteller oder den Namen eines Sprachmodells.
Sprich den Disponenten mit du an, nie mit Sie. Behaupte nie, du hättest etwas gebucht, gesendet, geändert oder gelöscht.`;

/** Freie Antwort auf eine Frage. Null, wenn Modell oder Daten nicht klappen. */
export const freieAntwort = async (admin: any, vm: { url: string; modell: string }, frage: string,
  verlauf: { role: string; text: string }[] = []): Promise<string | null> => {
  if (modellGesperrt()) return null;
  try {
    const lage = await lageLaden(admin);
    const daten = JSON.stringify(lage);
    // Gleiche Kontextgroesse wie verstehen.ts (4096), sonst laedt der Mac mini das Modell neu (15.11.).
    // Nur bei sehr viel Lage-Daten 8192, damit nichts abgeschnitten wird.
    const umfang = SYSTEM.length + daten.length + verlauf.reduce((n, m) => n + String(m.text || '').length, 0) + frage.length;
    const r = await fetch(`${vm.url.replace(/\/$/, '')}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      signal: AbortSignal.timeout(25000),
      body: JSON.stringify({
        model: vm.modell,
        stream: false,
        keep_alive: -1,
        think: false,
        options: { temperature: 0.3, num_ctx: umfang / 3 + 500 > 4000 ? 8192 : 4096 },
        messages: [
          { role: 'system', content: `${SYSTEM}\n\nDaten:\n${daten}` },
          ...verlauf.map((m) => ({ role: m.role, content: m.text })),
          { role: 'user', content: frage },
        ],
      }),
    });
    if (!r.ok) return null;
    const j = await r.json();
    const text = String(j?.message?.content || '').trim();
    // Rutscht das Modell ins Chinesische, bleibt nur der deutsche Teil. Ist der zu kurz: ehrliche Antwort.
    return text ? (nurDeutsch(text) ?? 'Das weiß ich nicht. Dazu habe ich keine Daten.') : null;
  } catch (fehler) {
    // Frist gerissen: Modell 2 Minuten ueberspringen (verstehen.ts), damit die naechsten Fragen nicht warten.
    if (fehler instanceof Error && /timeout|abort/i.test(`${fehler.name} ${fehler.message}`)) modellSperren();
    return null;
  }
};
