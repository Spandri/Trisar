-- Dacia Duster (3. Generation, ab 06/24) mit Tank und WLTP-Verbrauch (19.11.2026).
-- HSN 8212 / TSN AFR (Hybrid 140) und die anderen Duster-Typen stehen schon in kba_typen ("Dacia DUSTER"),
-- die Variante passt ohne Gross-/Kleinschreibung zu "Dacia Duster". Nur Zeilen mit ADAC-Detailseite.
insert into public.fahrzeug_varianten
  (modell, variante, generation, kraftstoff, tank_l, verbrauch_l_100km, akku_kwh, verbrauch_kwh_100km, quelle)
values
  ('Dacia Duster', 'Hybrid 140', 'III 06/24-10/25', 'Super 95', 50, 5.0, null, null, 'https://www.adac.de/rund-ums-fahrzeug/autokatalog/marken-modelle/dacia/duster/3generation/332538/'),
  ('Dacia Duster', 'TCe 130', 'III 06/24-04/25', 'Super 95', 50, 5.5, null, null, 'https://www.adac.de/rund-ums-fahrzeug/autokatalog/marken-modelle/dacia/duster/3generation/332524/'),
  ('Dacia Duster', 'mild hybrid 130', 'III 04/25-10/25', 'Super 95', 50, 5.5, null, null, 'https://www.adac.de/rund-ums-fahrzeug/autokatalog/marken-modelle/dacia/duster/3generation/339605/'),
  ('Dacia Duster', 'hybrid 155', 'III ab 10/25', 'Super 95', 50, 4.7, null, null, 'https://www.adac.de/rund-ums-fahrzeug/autokatalog/marken-modelle/dacia/duster/3generation/345061/')
on conflict (modell, variante, generation) do update
  set kraftstoff = excluded.kraftstoff, tank_l = excluded.tank_l, verbrauch_l_100km = excluded.verbrauch_l_100km,
      akku_kwh = excluded.akku_kwh, verbrauch_kwh_100km = excluded.verbrauch_kwh_100km, quelle = excluded.quelle;
