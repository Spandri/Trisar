/* eslint-disable react-refresh/only-export-components -- Block, Seite und Export gehoeren zusammen. */
// Fahrtenbuch auf der Fahrzeug-Seite der Dispo.
// - FahrtenbuchBlock: heller Block zwischen Fahrzeugdaten und Schadensbericht (Kilometerstand, heute,
//   Monat, letzte drei Eintraege). Ohne Eintraege bleibt er weg. Tipp oeffnet die Seite.
// - FahrtenbuchSeite: alle Eintraege im Zeitraum, nach Tagen, mit Export (Excel, PDF, CSV).
// Daten: Datenbank-Funktion fahrtenbuch_lesen (haengt an der Fahrgestellnummer, nicht am Kennzeichen).
// Export: dispo-admin, Aktion fahrtenbuch_export.

import React, { useEffect, useState } from 'react';
import { supabase } from '../../../services/supabase';
import { useI18n } from '../../../i18n';
import ZurueckKnopf from '../../ui/ZurueckKnopf';
import TrisarFooter from '../../ui/TrisarFooter';

const LIME = '#E3F654';
const schrift = { fontFamily: 'Space Grotesk' };
const isoTag = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const zahl = (w) => (w === null || w === undefined || w === '' || !Number.isFinite(Number(w)) ? null : Number(w));

export const kmText = (wert, genau = true) => {
  const n = zahl(wert);
  if (n === null) return '';
  const text = genau
    ? n.toLocaleString('de-DE', { minimumFractionDigits: 1, maximumFractionDigits: 1 })
    : Math.round(n).toLocaleString('de-DE');
  return `${genau ? '' : 'ca. '}${text} km`;
};
const kmGanz = (wert) => {
  const n = zahl(wert);
  return n === null ? '–' : Math.round(n).toLocaleString('de-DE');
};
const uhr = (iso) => (iso
  ? new Date(iso).toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Berlin' })
  : '');
const tagText = (iso, locale) => {
  const [j, m, t] = String(iso).split('-').map(Number);
  const d = new Date(j, m - 1, t);
  return `${d.toLocaleDateString(locale || 'de-DE', { weekday: 'short' })} ${String(t).padStart(2, '0')}.${String(m).padStart(2, '0')}.`;
};

export function useFahrtenbuch(vehicleId, von = null, bis = null) {
  const [daten, setDaten] = useState(null);
  useEffect(() => {
    let aktiv = true;
    if (!vehicleId) return undefined;
    supabase.rpc('fahrtenbuch_lesen', { p_vehicle: vehicleId, p_von: von, p_bis: bis })
      .then(({ data }) => { if (aktiv) setDaten(data || null); });
    return () => { aktiv = false; };
  }, [vehicleId, von, bis]);
  return daten;
}

export async function fahrtenbuchExportieren({ vehicleId, von, bis, format }) {
  const { data, error } = await supabase.functions.invoke('dispo-admin', {
    body: { aktion: 'fahrtenbuch_export', vehicle_id: vehicleId, von, bis, format },
  });
  if (error || !data?.datei) return { ok: false };
  const bytes = Uint8Array.from(atob(data.datei), (c) => c.charCodeAt(0));
  const datei = new File([bytes], data.dateiname, { type: data.typ });
  if (navigator.canShare?.({ files: [datei] })) {
    try { await navigator.share({ files: [datei], title: data.dateiname }); return { ok: true }; } catch { /* abgebrochen: herunterladen */ }
  }
  const url = URL.createObjectURL(datei);
  const a = document.createElement('a');
  a.href = url; a.download = data.dateiname; a.click();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
  return { ok: true };
}

const ArtMarke = ({ art }) => {
  const { t } = useI18n();
  const gast = art === 'gast';
  return (
    <span
      className="inline-block h-[16px] px-[6px] text-[10px] leading-[16px] font-bold tracking-[-0.3px]"
      style={{ ...schrift, background: gast ? LIME : '#ececec', color: '#1c1c1d' }}
    >
      {t(gast ? 'fahrtenbuch.guest' : 'fahrtenbuch.empty')}
    </span>
  );
};

// Eine Zeile: Uhrzeit links, Strecke in der Mitte, km rechts. Auf der Seite mit Ende und Kilometerstand.
const Zeile = ({ z, voll = false }) => (
  <div className="flex gap-[10px] py-[9px] border-t border-[#dddcdc]" style={schrift}>
    <div className="w-[38px] shrink-0 text-[12px] leading-[1.35] text-[rgba(28,28,29,0.5)]">
      <div>{uhr(z.beginn)}</div>
      {voll ? <div>{uhr(z.ende)}</div> : null}
    </div>
    <div className="flex-1 min-w-0">
      <ArtMarke art={z.art} />
      <div className="mt-[3px] text-[13px] leading-[1.25] font-bold text-[#1c1c1d] truncate">
        {[z.von, z.nach].filter(Boolean).join(' → ')}
      </div>
      {z.fahrer || (voll && zahl(z.km_start) !== null && zahl(z.km_ende) !== null) ? (
        <div className="mt-[2px] text-[11px] leading-[1.25] text-[rgba(28,28,29,0.5)] truncate">
          {[z.fahrer, voll && zahl(z.km_start) !== null && zahl(z.km_ende) !== null ? `${kmGanz(z.km_start)} → ${kmGanz(z.km_ende)}` : null]
            .filter(Boolean).join(' · ')}
        </div>
      ) : null}
    </div>
    <div className="shrink-0 text-right text-[13px] leading-[1.25] font-bold text-[#1c1c1d] whitespace-nowrap">
      {kmText(z.km, z.genau !== false)}
    </div>
  </div>
);

const Wert = ({ label, wert }) => (
  <div className="min-w-0">
    <div className="text-[rgba(28,28,29,0.5)] text-[11px] leading-none truncate">{label}</div>
    <div className="mt-[5px] text-[18px] leading-none font-bold text-[#1c1c1d] truncate">{wert}</div>
  </div>
);

export function FahrtenbuchBlock({ vehicleId, blockRef, top, onOeffnen }) {
  const { t, locale } = useI18n();
  const daten = useFahrtenbuch(vehicleId);
  if (!daten || !(daten.anzahl > 0)) return null;
  const monat = new Date().toLocaleDateString(locale || 'de-DE', { month: 'long' });

  return (
    <button
      type="button"
      ref={blockRef}
      onClick={onOeffnen}
      className="absolute left-1/2 -translate-x-1/2 w-[353px] bg-white p-[29px] text-left"
      style={{ top: `${top}px`, ...schrift }}
      data-tutorial="fahrtenbuch"
    >
      <div className="flex items-center justify-between">
        <span className="text-[#1c1c1d] text-[20px] leading-none tracking-[-0.5px] font-bold">{t('fahrtenbuch.title')}</span>
        <img src="/icon/_Icon_Schwarz/Arrow_Trisar_Icons_01.svg" alt="" className="w-[26px] h-[15px]" />
      </div>
      <div className="w-full h-[1px] bg-[#dddcdc] mt-[12px] mb-[14px]" />
      <div className="grid grid-cols-3 gap-x-[10px] mb-[14px]">
        <Wert label={t('telemetrie.odometer')} wert={kmGanz(daten.km_stand)} />
        <Wert label={t('fahrtenbuch.today')} wert={`${kmGanz(daten.km_heute)} km`} />
        <Wert label={monat} wert={`${kmGanz(daten.km_monat)} km`} />
      </div>
      {(daten.zeilen || []).slice(0, 3).map((z) => <Zeile key={z.id} z={z} />)}
    </button>
  );
}

const Datum = ({ label, value, onChange }) => (
  <label className="flex flex-col gap-[3px] flex-1 min-w-0">
    <span className="text-[10px] font-medium text-white/50" style={schrift}>{label}</span>
    <input
      type="date"
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className="h-[38px] w-full bg-black border border-white/30 px-2 text-[14px] font-medium text-white outline-none focus:border-[#E3F654]"
      style={schrift}
    />
  </label>
);

export function FahrtenbuchSeite({ vehicleId, schliessen }) {
  const { t, locale } = useI18n();
  const heute = new Date();
  const [von, setVon] = useState(isoTag(new Date(heute.getFullYear(), heute.getMonth(), 1)));
  const [bis, setBis] = useState(isoTag(heute));
  const gueltig = Boolean(von && bis && von <= bis);
  const daten = useFahrtenbuch(vehicleId, gueltig ? von : null, gueltig ? bis : null);
  const [busy, setBusy] = useState('');
  const [fehler, setFehler] = useState(false);

  const exportieren = async (format) => {
    setBusy(format); setFehler(false);
    const r = await fahrtenbuchExportieren({ vehicleId, von, bis, format });
    setBusy(''); setFehler(!r.ok);
  };

  // Zeilen nach Tagen, neuester Tag oben.
  const tage = [];
  for (const z of daten?.zeilen || []) {
    const letzter = tage[tage.length - 1];
    if (letzter && letzter.tag === z.tag) { letzter.zeilen.push(z); letzter.km += zahl(z.km) || 0; }
    else tage.push({ tag: z.tag, zeilen: [z], km: zahl(z.km) || 0 });
  }

  return (
    <div className="fixed inset-0 z-[70] bg-black overflow-y-auto overscroll-none flex justify-center" style={schrift}>
      <div className="relative w-[min(402px,100vw)] min-h-full px-[24.5px] pt-[130px] pb-[90px]">
        <ZurueckKnopf onClick={schliessen} marker="fahrtenbuch-zurueck" oben={60} />
        <div className="absolute left-[86px] right-[24px] top-[62px]">
          <div className="text-[26px] leading-none font-bold tracking-[-0.5px]" style={{ color: LIME }}>{t('fahrtenbuch.title')}</div>
          <div className="mt-[6px] text-[13px] leading-none text-white/60 truncate">
            {[daten?.kennzeichen, daten?.vin].filter(Boolean).join(' · ')}
          </div>
        </div>

        <div className="flex gap-2">
          <Datum label={t('fahrtenbuch.from')} value={von} onChange={setVon} />
          <Datum label={t('fahrtenbuch.to')} value={bis} onChange={setBis} />
        </div>
        <div className="mt-[10px] flex gap-2">
          {['xlsx', 'pdf', 'csv'].map((f) => (
            <button
              key={f}
              type="button"
              disabled={!gueltig || Boolean(busy)}
              onClick={() => exportieren(f)}
              className={`flex-1 h-[38px] text-[13px] font-bold disabled:opacity-50 ${busy === f ? 'animate-pulse' : ''}`}
              style={{ border: `1px solid ${LIME}`, color: LIME }}
            >
              {f === 'xlsx' ? 'Excel' : f.toUpperCase()}
            </button>
          ))}
        </div>
        {fehler ? <div className="mt-[8px] text-[13px] text-[#ff6b57]">{t('fahrtenbuch.exportFailed')}</div> : null}

        <div className="mt-[14px] bg-white p-[20px]">
          <div className="grid grid-cols-3 gap-x-[10px]">
            <Wert label={t('fahrtenbuch.total')} wert={`${kmGanz(daten?.km_gesamt)} km`} />
            <Wert label={t('fahrtenbuch.guest')} wert={`${kmGanz(daten?.km_gast)} km`} />
            <Wert label={t('fahrtenbuch.empty')} wert={`${kmGanz(daten?.km_leer)} km`} />
          </div>
        </div>

        {tage.map((tag) => (
          <div key={tag.tag} className="mt-[10px] bg-white px-[20px] pt-[16px] pb-[8px]">
            <div className="flex items-baseline justify-between pb-[10px]">
              <span className="text-[15px] leading-none font-bold tracking-[-0.5px] text-[#1c1c1d]">{tagText(tag.tag, locale)}</span>
              <span className="text-[13px] leading-none font-bold text-[rgba(28,28,29,0.5)]">{kmGanz(tag.km)} km</span>
            </div>
            {tag.zeilen.map((z) => <Zeile key={z.id} z={z} voll />)}
          </div>
        ))}
        {daten && tage.length === 0 ? (
          <div className="mt-[10px] bg-white p-[20px] text-[14px] font-bold text-[rgba(28,28,29,0.5)]">{t('fahrtenbuch.none')}</div>
        ) : null}
      </div>
      <TrisarFooter className="fixed left-0 right-0 bottom-0 h-10 bg-black z-30" />
    </div>
  );
}
