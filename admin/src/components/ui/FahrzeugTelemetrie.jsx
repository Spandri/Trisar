import React, { useEffect, useState } from 'react';
import { supabase } from '../../services/supabase';
import { useI18n } from '../../i18n';
import { useFahrzeugTelemetrie, telemetrieZeilen, EVENT_KEYS } from '../../shared/fahrzeugTelemetrie';

// Fahrzeugdaten aus dem OBD-Tracker, live je Fahrer. Dunkle Variante fuer das
// Fahrerprofil auf der Karte. Ohne Daten zeigt der Block nur einen Hinweis.
export default function FahrzeugTelemetrie({ driverId }) {
  const { t } = useI18n();
  const { live, events } = useFahrzeugTelemetrie(supabase, driverId);
  const zeilen = telemetrieZeilen(live, t);

  return (
    <div className="mt-[18px] mx-[18px] border-t border-[#3a3b2a] pt-[14px] font-['Space_Grotesk']">
      <div className="text-[#E3F654] text-[13px] leading-none font-bold uppercase tracking-[0.5px]">
        {t('telemetrie.title')}
      </div>
      {zeilen.length === 0 ? (
        <div className="mt-[10px] text-[#8d8d8d] text-[14px]">{t('telemetrie.none')}</div>
      ) : (
        <div className="mt-[10px] grid grid-cols-3 gap-x-[10px] gap-y-[12px]">
          {zeilen.map((z) => (
            <div key={z.key} className="min-w-0">
              <div className="text-[#8d8d8d] text-[11px] leading-none truncate">{z.label}</div>
              <div className={`mt-[4px] text-[18px] leading-none font-bold truncate ${z.warn ? 'text-[#ff6b57]' : 'text-[#D6D6D6]'}`}>{z.value}</div>
            </div>
          ))}
        </div>
      )}
      {events.length > 0 ? (
        <div className="mt-[12px] text-[#8d8d8d] text-[11px] leading-[1.4]">
          {events.map((e) => (
            <div key={e.id} className="truncate">
              {e.zeit} · {t(EVENT_KEYS[e.event_type] || 'telemetrie.ev.unknown')}{e.value != null && e.event_type === 'overspeeding' ? ` (${Math.round(e.value)} km/h)` : ''}
            </div>
          ))}
        </div>
      ) : null}
      {live?.captured_at ? (
        <div className="mt-[10px] text-[#5f6130] text-[11px] leading-none">{t('telemetrie.updated', { zeit: live.zeit })}</div>
      ) : null}
    </div>
  );
}
