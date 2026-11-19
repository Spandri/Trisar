-- Tracker-Anschluss (18.11.2026): Ist noch keine Fahrt bekannt (z. B. Auto steht seit vor dem Ausrollen),
-- zaehlt der erste Datensatz als Beginn des Stillstands. So wird ein geparkter OBD-Tracker nach 30 min
-- erkannt, ohne erst eine Fahrt abzuwarten.
create or replace function public.tracker_anschluss_erkennen()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  t public.obd_tracker%rowtype;
  v_spannung numeric := new.ext_voltage_v;
  v_kmh numeric := nullif(new.raw_io ->> '24', '')::numeric;
  v_zeit timestamptz := coalesce(new.captured_at, now());
  v_erkannt text;
begin
  select * into t from public.obd_tracker where imei = new.imei;
  if not found then
    return new;
  end if;
  if coalesce(v_kmh, 0) > 5 or coalesce(new.obd_speed_kph, 0) > 5 or t.letzte_fahrt_am is null then
    update public.obd_tracker set letzte_fahrt_am = v_zeit where imei = new.imei;
    t.letzte_fahrt_am := v_zeit;
  end if;
  if t.anschluss_quelle = 'hand' then
    return new;
  end if;

  if nullif(btrim(coalesce(new.vin, '')), '') is not null or coalesce(new.rpm, 0) > 0 then
    v_erkannt := 'obd';
  elsif v_spannung is not null and v_spannung < 3 then
    v_erkannt := 'usbc';
  elsif v_spannung is not null and v_spannung > 11 and coalesce(v_kmh, 0) <= 5
        and v_zeit - t.letzte_fahrt_am > interval '30 minutes' then
    v_erkannt := 'obd';
  end if;

  if v_erkannt is not null and v_erkannt is distinct from t.anschluss then
    perform public.tracker_anschluss_setzen(new.imei, v_erkannt, 'auto');
  end if;
  return new;
end;
$$;
