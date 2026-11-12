// Fahrer-Ansicht der Dispo: ein Klick auf einen Fahrer zeigt seinen Ablauf statt der Stammdaten.
// Ablauf wie der Verlauf der Fahrer-App: unter jedem Datum zuerst die Stundenerfassung (auch bestaetigte),
// dann je Dienst Dienststart, Fahrten mit Pausenstart und Pausenende dazwischen, Dienstende.
// Oben rechts Export: alle Stunden des Fahrers als Excel. Darunter "Dienste" (FahrerDienste).

import { Fragment, useEffect, useMemo, useState } from 'react';
import { supabase } from '../../services/supabase';
import { DEMO_MODE } from '../../datenquelle';
import BackCircleButton from '../ui/BackCircleButton';
import TrisarFooter from '../ui/TrisarFooter';
import { useI18n } from '../../i18n';
import { RideCard, TagTrenner, getRideDriverEntries } from './AnkuenfteView';
import FahrerDienste, { dienstAbschnittHoehe } from './FahrerDienste';
import { StundenKarte, hatStundenKarte, useDispoStunden } from './FahrerStundenKarten';
import { ExportKnopf, alleStundenExportieren } from './StundenExport';

const HINTERGRUND = {
  background: 'radial-gradient(ellipse 141.42% 102.21% at 0% 0%, #0048cf 0%, #00369b 11.415%, #002468 22.83%, #001b4e 28.537%, #001234 34.244%, #00091a 39.952%, #00050d 42.805%, #000000 45.659%, #000000 83.626%, #000000 100%)',
};
const FEHLT = 'fahrer fehlt';

const isoTag = (wert) => {
  const roh = String(wert || '').slice(0, 10);
  if (/^\d{4}-\d{2}-\d{2}$/.test(roh)) return roh;
  const de = roh.match(/^(\d{2})\.(\d{2})\.(\d{4})$/);
  return de ? `${de[3]}-${de[2]}-${de[1]}` : '';
};
// Ablauf ab gestern: nach Mitternacht und fuer offene Stunden soll der Dienst von gestern noch sichtbar sein.
const gesternIso = () => new Date(Date.now() - 86400000).toLocaleDateString('sv-SE', { timeZone: 'Europe/Berlin' });
const hmMin = (hm) => {
  const m = String(hm || '').match(/^(\d{1,2}):(\d{2})/);
  return m ? Number(m[1]) * 60 + Number(m[2]) : null;
};
const minuten = (ride) => hmMin(ride?.startZeit) ?? Number.POSITIVE_INFINITY;
const hm = (wert) => String(wert || '').slice(0, 5);

const LIME = '#E3F654';
const ROT = '#ff6f63';
const GRAU = '#868687';
const DIENST_STATUS = ['accepted', 'assigned', 'approved'];

// Zeile wie im Verlauf der Fahrer-App: Rahmen und Text in einer Farbe.
const StatusZeile = ({ text, farbe }) => (
  <div className="w-full h-12 px-4 flex items-center border" style={{ borderColor: farbe }}>
    <span className="text-2xl font-bold leading-6 tracking-wide font-['Space_Grotesk']" style={{ color: farbe }}>{text}</span>
  </div>
);

// Kommende Dienste (ab morgen) mit ihren geplanten Pausen. Bis heute kommen sie aus stunden_verlauf.
const useKommendeDienste = (fahrerId) => {
  const [dienste, setDienste] = useState([]);
  useEffect(() => {
    let aktiv = true;
    if (DEMO_MODE || !fahrerId) return () => { aktiv = false; };
    (async () => {
      const heute = new Date().toLocaleDateString('sv-SE', { timeZone: 'Europe/Berlin' });
      const { data } = await supabase.from('driver_service_requests')
        .select('id, service_date, service_start_time, service_end_time, status')
        .eq('driver_id', fahrerId).gt('service_date', heute).order('service_date').limit(30);
      const liste = (data || []).filter((d) => DIENST_STATUS.includes(String(d.status || '').toLowerCase()));
      const ids = liste.map((d) => d.id);
      const { data: p } = ids.length ? await supabase.from('dienst_pausen').select('dienst_id, pausen').in('dienst_id', ids) : { data: [] };
      const pausenJe = Object.fromEntries((p || []).map((x) => [x.dienst_id, x.pausen || []]));
      if (aktiv) {
        setDienste(liste.map((d) => ({
          id: d.id, datum: d.service_date, beginn: hm(d.service_start_time), ende: hm(d.service_end_time), pausen: pausenJe[d.id] || [],
        })));
      }
    })();
    return () => { aktiv = false; };
  }, [fahrerId]);
  return dienste;
};

// Wie in der Fahrtenliste: Karte -> Daten fuer "Fahrt bearbeiten".
const zuEditDaten = (ride) => {
  const id = String(ride?.rideId || ride?.id || '').trim();
  const namen = getRideDriverEntries(ride).filter((n) => String(n || '').trim().toLowerCase() !== FEHLT);
  return {
    rideId: id,
    id,
    sourceView: 'fahrerAnsicht',
    datum: String(ride.date || '').slice(0, 10),
    startZeit: String(ride.startZeit || ride.time?.new || ride.time?.time || ride.time?.original || ''),
    start: String(ride.start || ''),
    ziel: String(ride.ziel || ''),
    konvoi: ride.konvoi || '',
    anzahlFahrzeuge: String(ride.anzahlFahrzeuge || ''),
    fahrerNamen: namen.length > 0 ? namen : [''],
    anzahlFahrgaeste: String(ride.anzahlFahrgaeste || '1'),
    anonymeGaeste: String(ride.anonymeGaeste || '0'),
    fahrgaeste: ride.fahrgaeste || ride.name || '',
    flugnummer: String(ride.flugnummer || ''),
    zugnummer: String(ride.zugnummer || ''),
    anzahlKinder: String(ride.anzahlKinder || '0'),
    aktuellerStatus: ride.aktuellerStatus || 'offen',
    notes: ride.dispoNote ?? ride.note ?? '',
    aiBooked: Boolean(ride.aiBooked),
  };
};

const Abschnitt = ({ children, zahl }) => (
  <div className="mt-[32px] flex items-baseline justify-between font-['Space_Grotesk']">
    <span className="text-[#e3f654] text-[26px] font-bold tracking-[-0.5px]">{children}</span>
    {zahl != null ? <span className="text-[13px] font-medium text-white/50">{zahl}</span> : null}
  </div>
);

export default function FahrerAnsichtView({ driver, rides = [], onBack, onRideSelect = () => {}, onOpenVehicle = null }) {
  const { t, locale } = useI18n();
  const [dienstAnzahl, setDienstAnzahl] = useState(0);
  const [exportLaeuft, setExportLaeuft] = useState(false);
  const fahrerId = String(driver?.id || '').trim();
  const name = String(driver?.name || '').trim() || 'Fahrer';
  const stunden = useDispoStunden(fahrerId, 14);
  const kommende = useKommendeDienste(fahrerId);

  const exportieren = async () => {
    setExportLaeuft(true);
    const r = await alleStundenExportieren(fahrerId);
    setExportLaeuft(false);
    if (!r.ok) window.alert(r.meldung);
  };

  // Alle Dienste: bis heute aus stunden_verlauf (mit Stunden), danach die kommenden.
  const dienste = useMemo(() => [
    ...(stunden.eintraege || []).filter((e) => e?.dienst).map((e) => ({
      id: e.dienst.id, datum: e.dienst.datum, beginn: e.dienst.beginn, ende: e.dienst.ende, pausen: e.dienst.pausen || [], eintrag: e,
    })),
    ...kommende,
  ], [stunden.eintraege, kommende]);

  // Ablauf ab gestern. Aeltere Tage nur, solange dort Stunden noch nicht bestaetigt sind.
  const tage = useMemo(() => {
    const ab = gesternIso();
    const offen = (d) => d.eintrag && hatStundenKarte(d.eintrag) && d.eintrag.zettel?.status !== 'bestaetigt';
    const zeigen = (tag) => !tag || tag >= ab || dienste.some((d) => d.datum === tag && offen(d));
    const gesehen = new Set();
    const fahrten = rides
      .filter((ride) => Array.isArray(ride?.fahrerIds) && ride.fahrerIds.includes(fahrerId))
      .filter((ride) => {
        const id = String(ride?.id || '');
        if (gesehen.has(id)) return false;
        gesehen.add(id);
        return zeigen(isoTag(ride?.date));
      });
    const nachTag = new Map();
    const tag = (iso) => {
      const k = iso || '9999-99-99';
      if (!nachTag.has(k)) nachTag.set(k, []);
      return nachTag.get(k);
    };
    // Dienstfenster in Minuten ab Tagesbeginn, ueber Mitternacht hinaus verlaengert.
    const rahmen = dienste.filter((d) => zeigen(d.datum)).map((d) => {
      const von = hmMin(d.beginn);
      let bis = hmMin(d.ende);
      if (von != null && bis != null && bis <= von) bis += 1440;
      return { art: 'dienst', datum: d.datum, von, bis, dienst: d, fahrten: [] };
    });
    rahmen.forEach((r) => tag(r.datum).push(r));
    fahrten.forEach((ride) => {
      const iso = isoTag(ride?.date);
      const m = minuten(ride);
      const r = rahmen.find((d) => d.datum === iso && d.von != null && d.bis != null && m >= d.von && m <= d.bis);
      if (r) r.fahrten.push(ride);
      else tag(iso).push({ art: 'fahrt', datum: iso, von: m, ride });
    });
    return [...nachTag.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([iso, eintraege]) => ({ iso, eintraege: eintraege.sort((a, b) => (a.von ?? 1e9) - (b.von ?? 1e9)) }));
  }, [rides, fahrerId, dienste]);
  const fahrtenAnzahl = tage.reduce((n, tg) => n + tg.eintraege.reduce((k, e) => k + (e.art === 'fahrt' ? 1 : e.fahrten.length), 0), 0);

  const fahrtKarte = (ride, index) => (
    <RideCard
      key={ride.id || index}
      {...ride}
      time={ride.displayTime || ride.time}
      onClick={() => onRideSelect(zuEditDaten(ride))}
    />
  );

  // Ein Dienst: Dienststart, Fahrten und Pausen nach Uhrzeit, Dienstende.
  const dienstBlock = (r) => {
    const d = r.dienst;
    const pausenZeilen = (d.pausen || []).flatMap((p, i) => {
      const von = hmMin(p.von);
      let bis = hmMin(p.bis);
      if (von != null && bis != null && bis < von) bis += 1440;
      return [
        { art: 'pause', key: `ps${i}`, m: von ?? -1, text: `Pausenstart ${hm(p.von)}` },
        { art: 'pause', key: `pe${i}`, m: (bis ?? von ?? -1) + 0.5, text: `Pausenende ${hm(p.bis)}` },
      ];
    });
    // Pausen vor dem Dienstbeginn (Mitternacht) nach hinten schieben.
    pausenZeilen.forEach((z) => { if (r.von != null && z.m < r.von) z.m += 1440; });
    const zeilen = [
      ...r.fahrten.map((ride, i) => ({ art: 'fahrt', key: `f${ride.id || i}`, m: minuten(ride), ride })),
      ...pausenZeilen,
    ].sort((a, b) => a.m - b.m);
    return (
      <div key={d.id} className="flex flex-col gap-3">
        <StatusZeile text={`Dienststart ${d.beginn || '--:--'}`} farbe={LIME} />
        {zeilen.map((z) => (z.art === 'fahrt' ? fahrtKarte(z.ride, z.key) : <StatusZeile key={z.key} text={z.text} farbe={GRAU} />))}
        <StatusZeile text={`Dienstende ${d.ende || '--:--'}`} farbe={ROT} />
      </div>
    );
  };

  const zeile = [
    driver?.vehicle ? String(driver.vehicle) : 'Kein Fahrzeug',
    driver?.serviceStartTime || driver?.serviceEndTime
      ? `Dienst ${driver?.serviceStartTime || '?'}–${driver?.serviceEndTime || '?'}`
      : null,
  ].filter(Boolean).join(' · ');

  return (
    <>
      <div className="w-[min(402px,100vw)] h-dvh relative mx-auto overflow-hidden" style={HINTERGRUND}>
        <div className="h-full overflow-y-auto overscroll-none px-5 pt-[60px] pb-[100px]">
          <div className="flex items-center justify-between">
            <BackCircleButton onClick={onBack} />
            <ExportKnopf onClick={exportieren} busy={exportLaeuft} />
          </div>

          <div className="mt-[30px] text-[#e3f654] text-[42px] leading-[42px] font-bold font-['Space_Grotesk'] break-words">{name}</div>
          {/* Fahrzeug antippen: Fahrzeug bearbeiten (12.11.). */}
          {driver?.vehicleId && onOpenVehicle ? (
            <button type="button" onClick={() => onOpenVehicle(driver.vehicleId)} className="mt-[6px] text-left text-[16px] font-medium font-['Space_Grotesk'] text-white/70">
              <span className="underline decoration-[#e3f654] underline-offset-4 text-[#e3f654]">{driver?.vehicle || 'Fahrzeug'}</span>
              {zeile.includes(' · ') ? ` · ${zeile.split(' · ').slice(1).join(' · ')}` : ''}
            </button>
          ) : (
            <div className="mt-[6px] text-[16px] font-medium font-['Space_Grotesk'] text-white/70">{zeile}</div>
          )}

          <Abschnitt zahl={fahrtenAnzahl || null}>Ablauf</Abschnitt>
          <div className="mt-[14px] space-y-3">
            {tage.map((tg, index) => (
              <Fragment key={tg.iso}>
                {tg.iso !== '9999-99-99' ? <TagTrenner iso={tg.iso} locale={locale} erster={index === 0} /> : null}
                {/* Stundenerfassung immer als erstes unter dem Datum. */}
                {tg.eintraege.filter((e) => e.art === 'dienst' && e.dienst.eintrag && hatStundenKarte(e.dienst.eintrag)).map((e) => (
                  <div key={`stunden-${e.dienst.id}`} className="pb-[6px]"><StundenKarte eintrag={e.dienst.eintrag} stunden={stunden} /></div>
                ))}
                {tg.eintraege.map((e, i) => (e.art === 'fahrt' ? fahrtKarte(e.ride, `${tg.iso}-${i}`) : dienstBlock(e)))}
              </Fragment>
            ))}
            {tage.length === 0 ? (
              <div className="py-4 text-[#e3f654] text-base font-medium font-['Space_Grotesk'] opacity-70">Keine Fahrten und Dienste ab gestern.</div>
            ) : null}
          </div>

          {/* FahrerDienste setzt sich selbst absolut (left 20, Breite 362): Rahmen in voller Seitenbreite. */}
          <div className="relative mt-[32px] -mx-5" style={{ height: `${dienstAbschnittHoehe(dienstAnzahl)}px` }}>
            <FahrerDienste t={t} fahrerId={fahrerId} fahrerName={name} top={0} onAnzahl={setDienstAnzahl} />
          </div>

        </div>
      </div>
      <TrisarFooter className="fixed bottom-0 left-1/2 -translate-x-1/2 w-[min(402px,100vw)] h-10 bg-black z-[40]" />
    </>
  );
}
