-- Genaue Stelle eines Schadens auf der Fahrzeug-Aufsicht, damit Dispo und Fahrer-App
-- das Auto mit dem Punkt zeigen koennen. Koordinaten wie beim Melden: Aufsicht 120 x 240,
-- Front oben. {"x": 34.5, "y": 51.2, "bauteil": "reifen"}

alter table public.vehicle_damages
  add column if not exists stelle jsonb;

-- Alte Meldungen kennen nur den Bereich (Kuerzel vor dem Gedankenstrich in part_name):
-- Punkt in die Mitte dieses Bereichs setzen.
update public.vehicle_damages d
set stelle = jsonb_build_object('x', b.x, 'y', b.y, 'geschaetzt', true)
from (values
  ('VL', 20, 40), ('V', 60, 40), ('VR', 100, 40),
  ('L', 20, 120), ('Dach', 60, 120), ('R', 100, 120),
  ('HL', 20, 200), ('H', 60, 200), ('HR', 100, 200)
) as b(kuerzel, x, y)
where d.stelle is null
  and trim(split_part(coalesce(d.part_name, ''), '–', 1)) = b.kuerzel;
