import React from 'react';
import { supabase } from '../../../shared/supabase/client';
import { useI18n } from '../../../i18n';
import { useFahrzeugTelemetrie, telemetrieZeilen, EVENT_KEYS } from '../../../shared/fahrzeugTelemetrie';

// Fahrzeugdaten aus dem OBD-Tracker auf der Fahrzeug-Seite. Helle Variante im
// Stil der uebrigen Bloecke. Ohne Daten bleibt der Block weg (rendert null).
export default function FahrzeugTelemetrie({ driverId, blockRef, top }) {
  const { t } = useI18n();
  const { live, events } = useFahrzeugTelemetrie(supabase, driverId);
  const zeilen = telemetrieZeilen(live, t);
  if (zeilen.length === 0) return null;

  return (
    <div
      ref={blockRef}
      className="absolute left-1/2 -translate-x-1/2 w-[353px] bg-white p-[29px]"
      style={{ top: `${top}px` }}
      data-tutorial="fahrzeugdaten"
    >
      <div className="text-[#1c1c1d] text-[20px] leading-none tracking-[-0.5px] font-bold">{t('telemetrie.title')}</div>
      <div className="w-full h-[1px] bg-[#dddcdc] mt-[12px] mb-[14px]" />
      <div className="grid grid-cols-3 gap-x-[10px] gap-y-[14px]">
        {zeilen.map((z) => (
          <div key={z.key} className="min-w-0">
            <div className="text-[rgba(28,28,29,0.5)] text-[11px] leading-none truncate">{z.label}</div>
            <div className={`mt-[5px] text-[18px] leading-none font-bold truncate ${z.warn ? 'text-[#d9381e]' : 'text-[#1c1c1d]'}`}>{z.value}</div>
          </div>
        ))}
      </div>
      {events.length > 0 ? (
        <div className="mt-[14px] text-[rgba(28,28,29,0.6)] text-[12px] leading-[1.5]">
          {events.map((e) => (
            <div key={e.id} className="truncate">{e.zeit} · {t(EVENT_KEYS[e.event_type] || 'telemetrie.ev.unknown')}</div>
          ))}
        </div>
      ) : null}
      {live?.zeit ? <div className="mt-[10px] text-[rgba(28,28,29,0.35)] text-[11px] leading-none">{t('telemetrie.updated', { zeit: live.zeit })}</div> : null}
    </div>
  );
}
