-- Standby-Fahrten in Alle Fahrten (12.11.2026): die Dispo bildet die Fahrten aus standby_ereignis
-- (gast_drin = losgefahren, abgesetzt = Rueckweg, zurueck = wieder am Event) und braucht sie live.
do $$
begin
  begin execute 'alter publication supabase_realtime add table public.standby_ereignis'; exception when others then null; end;
end $$;
