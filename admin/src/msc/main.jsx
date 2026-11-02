// Separate Ansicht (nicht Teil der Demo-Navigation, nicht deployt): spielt die
// Tagespläne der Engine auf den MSC-Musterdaten in der Tageskarte der Demo ab.
// Daten: msc-plaene.json, erzeugt mit OR-Modell/engine_prototyp/karten_export.py.
// Je Tag zwei Pläne zum Vergleich: händische Disposition und TRISAR.
import { StrictMode, useMemo, useState } from 'react';
import { createRoot } from 'react-dom/client';
import '../index.css';
import { KARTE } from '../shared/karte/maplibreKarte';
import EinsatzTagKarte from './MscTagKarte';
import daten from './msc-plaene.json';

// Orte der Musterdaten haben feste Koordinaten: die Adresssuche der Karte
// bekommt sie direkt, statt Namen wie "Hotel Vier Jahreszeiten" zu suchen.
const ORTE = new Map(Object.entries(daten.orte));
class MscGeocoder {
  geocode(anfrage, rueckmeldung) {
    const punkt = ORTE.get(anfrage?.address);
    if (punkt) {
      rueckmeldung?.([{ geometry: { location: new KARTE.LatLng(punkt.lat, punkt.lng) } }], 'OK');
      return;
    }
    new KARTE.Geocoder().geocode(anfrage, rueckmeldung);
  }
}
window.trisarKarte = { ...KARTE, Geocoder: MscGeocoder };

const LIME = '#e3f654';
const zahl = (n, stellen = 0) => new Intl.NumberFormat('de-DE', { maximumFractionDigits: stellen }).format(n);

// Fahrzeugbedarf = Spitze der gleichzeitig eingesetzten Fahrzeuge (ein Fahrzeug kann am Tag
// mehrere Dienste fahren, deshalb nicht die Zahl der Dienste). Fahrerstunden = Summe der Dienste.
const bedarf = (plan) => {
  const vs = plan.vorschlaege;
  let spitze = 0;
  for (let m = 0; m < 1440; m += 5) {
    spitze = Math.max(spitze, vs.filter((v) => v.startMinutes <= m && m <= v.endMinutes).length);
  }
  return { spitze, stunden: vs.reduce((summe, v) => summe + (v.endMinutes - v.startMinutes), 0) / 60 };
};

function Kennzahl({ titel, a, b, einheit = '' }) {
  const diff = a ? ((b / a) - 1) * 100 : 0;
  return (
    <div className="flex items-baseline justify-between gap-3 text-[13px]">
      <span className="text-white/60">{titel}</span>
      <span className="tabular-nums text-white">
        {zahl(a)} → <b>{zahl(b)}</b>{einheit}
        <span className="ml-2" style={{ color: diff <= 0 ? LIME : '#FF6F63' }}>{diff > 0 ? '+' : ''}{zahl(diff, 0)} %</span>
      </span>
    </div>
  );
}

function MscKarte() {
  const [tagIndex, setTagIndex] = useState(3);
  const [variante, setVariante] = useState('trisar');
  const [signal, setSignal] = useState(0);
  const [zu, setZu] = useState(false);
  const tag = daten.tage[tagIndex];
  const mitE = Boolean(tag.trisar_e);
  const mitDeleg = Boolean(tag.delegationen?.vorschlaege?.length);
  const plan = (variante === 'delegationen' && !tag.delegationen?.vorschlaege?.length ? null : tag[variante]) || tag.trisar;
  const drivers = useMemo(() => plan.vorschlaege.map((v, i) => ({
    id: v.driverId, lat: daten.betriebssitz.lat, lng: daten.betriebssitz.lng, driverNumber: i + 1,
  })), [plan]);
  // Tagesdatum nur für die Anzeige oben rechts: nächster Donnerstag bis Sonntag.
  const tagIso = useMemo(() => {
    const d = new Date();
    d.setDate(d.getDate() + ((4 - d.getDay() + 7) % 7) + tagIndex);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  }, [tagIndex]);
  const vergleich = variante === 'haendisch' || variante === 'delegationen' || !tag[variante] ? 'trisar' : variante;
  const deleg = variante === 'delegationen' && mitDeleg ? tag.delegationen : null;
  const h = tag.haendisch.kennzahlen;
  const s = tag[vergleich].kennzahlen;
  const hb = useMemo(() => bedarf(tag.haendisch), [tag]);
  const sb = useMemo(() => bedarf(tag[vergleich]), [tag, vergleich]);
  const ladeInfo = tag.trisar_e?.laden;

  return (
    <div className="relative w-screen h-dvh overflow-hidden bg-black" style={{ fontFamily: 'Space Grotesk, sans-serif' }}>
      <EinsatzTagKarte
        key={`${tagIndex}-${variante}`}
        tagIso={tagIso}
        vorschlaege={plan.vorschlaege}
        drivers={drivers}
        kameraSignal={signal}
        onZurueck={() => setSignal((x) => x + 1)}
      />
      <div className="absolute z-[90] left-4 bottom-4 w-[340px] max-w-[calc(100vw-32px)] bg-black/90 rounded-xl p-4 border border-white/10 text-white">
        <div className="flex items-center justify-between">
          <p className="text-[11px] tracking-[0.5px] uppercase" style={{ color: LIME }}>
            Simulation · MSC-Muster{daten.datensatz === 'msc_lang' ? ' + Tegernsee, Oberpfaffenhofen' : ''} (erfundene Daten)
          </p>
          <button type="button" onClick={() => setZu((x) => !x)} className="text-[12px] font-bold px-2" style={{ color: LIME }}>
            {zu ? 'Einblenden' : 'Ausblenden'}
          </button>
        </div>
        <div className={zu ? 'hidden' : ''}>
        <div className="mt-3 grid grid-cols-4 gap-1">
          {daten.tage.map((t, i) => (
            <button key={t.tag} type="button" onClick={() => setTagIndex(i)}
              className="h-9 rounded-full text-[13px] font-bold"
              style={i === tagIndex ? { background: LIME, color: '#000' } : { background: '#1a1a1a', color: '#fff' }}>
              {t.tag.slice(0, 2)}
            </button>
          ))}
        </div>
        <div className="mt-2 grid grid-cols-3 gap-1">
          {[['haendisch', 'Händisch'], ['trisar', 'TRISAR'], ['trisar_e', 'TRISAR E']].map(([wert, text]) => (
            <button key={wert} type="button" onClick={() => setVariante(wert)}
              disabled={(wert === 'trisar_e' && !mitE) || (wert === 'delegationen' && !mitDeleg)}
              title={wert === 'trisar_e' && !mitE ? 'Daten mit Laden werden noch berechnet' : undefined}
              className="h-9 rounded-full text-[13px] font-bold disabled:opacity-40"
              style={wert === variante ? { background: LIME, color: '#000' } : { background: '#1a1a1a', color: '#fff' }}>
              {text}
            </button>
          ))}
        </div>
        {deleg ? (
          <div className="mt-3 text-[13px] text-white/80 space-y-2">
            <p>
              {tag.tag}: 6 Delegationsfahrzeuge (BMW i7, fester Fahrer, den ganzen Tag), über Nacht nur zu 50 % geladen,
              mit Fernfahrten (Tegernsee, Oberpfaffenhofen, Flughafen).
            </p>
            <p>
              <b style={{ color: LIME }}>Smart (Engine):</b> {deleg.vergleich.smartStopps} kurze Ladestopps, vorab in Wartezeiten gelegt, 0 min Verspätung.
            </p>
            <p>
              <b className="text-[#FF6F63]">Reaktiv (heute):</b> {deleg.vergleich.reaktivStopps} Ladestopps erst unter 25 % Akku,
              {' '}{deleg.vergleich.reaktivVerspaetung} min Verspätung bei den Gästen{deleg.vergleich.reaktivLeer ? `, ${deleg.vergleich.reaktivLeer}× Akku leer` : ''}.
            </p>
            <p className="text-[12px] text-white/50">Auf der Karte: smarter Plan. Ladesäulen aus dem Ladesäulenregister der Bundesnetzagentur. Auf ein ladendes Auto tippen zeigt Säule, Leistung und Akku.</p>
          </div>
        ) : null}
        <p className={`mt-3 text-[13px] text-white/60 ${deleg ? 'hidden' : ''}`}>
          {tag.tag}: {tag.fahrtwuensche} Fahrtwünsche, händisch → {vergleich === 'trisar_e' ? 'TRISAR reine E-Flotte' : 'TRISAR'}
        </p>
        <div className={`mt-2 space-y-1 ${deleg ? 'hidden' : ''}`}>
          <Kennzahl titel="Fahrzeuge im Einsatz (Spitze)" a={hb.spitze} b={sb.spitze} />
          <Kennzahl titel="Fahrerstunden" a={hb.stunden} b={sb.stunden} einheit=" h" />
          <Kennzahl titel="km gesamt" a={h.km_gesamt} b={s.km_gesamt} />
          <Kennzahl titel="Leer-km" a={h.km_leer} b={s.km_leer} />
          <Kennzahl titel="CO₂" a={h.co2_kg} b={s.co2_kg} einheit=" kg" />
        </div>
        {vergleich === 'trisar_e' && ladeInfo ? (
          <p className="mt-2 text-[12px] text-white/70">
            {ladeInfo.stopps !== undefined ? (
              <>
                Jedes E-Auto startet mit 30–80 % Akku. Die Engine plant je Auto, wann und wo es in Wartezeiten
                {' '}lädt: {ladeInfo.stopps} Ladestopps bei {ladeInfo.eFahrzeuge} E-Autos
                {ladeInfo.nichtMachbar ? `, ${ladeInfo.nichtMachbar} Auto braucht Ersatz` : ''}. Jeder Pin ist ein Fahrzeug.
              </>
            ) : `Laden: ${ladeInfo.park}× im eigenen Ladepark Garching, ${ladeInfo.unterwegs}× an öffentlichen Säulen.`}
          </p>
        ) : null}
        <p className="mt-2 text-[12px] text-white/50">
          TRISAR: {s.gruppen_oepnv} Gruppen per ÖPNV, {s.gruppen_rad} per Rad (nicht auf der Karte). Zurück-Knopf = Karte einpassen.
        </p>
        </div>
      </div>
    </div>
  );
}

createRoot(document.getElementById('root')).render(<StrictMode><MscKarte /></StrictMode>);
