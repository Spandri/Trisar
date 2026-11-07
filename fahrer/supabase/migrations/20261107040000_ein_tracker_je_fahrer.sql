-- Ein Fahrer darf hoechstens einen aktiven OBD-Tracker haben (eine IMEI hat ohnehin
-- nur einen Fahrer, imei ist Primaerschluessel). Die Dispo schaltet beim Speichern alte
-- Zuordnungen des Fahrers erst ab und setzt dann die neue, das bleibt damit erlaubt.
-- Alles andere (zwei Tracker gleichzeitig aktiv beim selben Fahrer) lehnt die DB ab.
create unique index if not exists imei_driver_map_ein_aktiver_je_fahrer
  on public.imei_driver_map (driver_id)
  where is_active;
