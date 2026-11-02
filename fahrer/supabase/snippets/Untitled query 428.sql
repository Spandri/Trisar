with addresses as (
  select * from (
    values
      (1, 'Hotel Bayerischer Hof', 'Promenadeplatz 2-6, 80333 München'),
      (2, 'Flughafen München', 'Terminalstraße Mitte 18, 85356 München-Flughafen'),
      (3, 'Ernastrasse 5', 'Ernastraße 5, 80992 München'),
      (4, 'Hans Jakob Strasse 5', 'Hans-Jakob-Straße 5, 81825 München'),
      (5, 'Odeonsplatz', 'Odeonsplatz, 80539 München'),
      (6, 'Arcisstrasse 21', 'Arcisstraße 21, 80333 München'),
      (7, 'Hotel Vier Jahreszeiten', 'Maximilianstraße 17, 80539 München')
  ) as t(id, location_name, location_address)
),
guests as (
  select * from (
    values
      (1, 'Max Mustermann'),
      (2, 'Anna Schneider'),
      (3, 'Lukas Wagner'),
      (4, 'Sofia Becker'),
      (5, 'David Hoffmann'),
      (6, 'Mia Fischer'),
      (7, 'Noah Weber'),
      (8, 'Emilia Klein'),
      (9, 'Paul Richter'),
      (10, 'Lea Zimmermann')
  ) as g(id, guest_name)
),
rides as (
  select
    i,
    date '2026-05-07' as ride_date,
    (timestamp '2026-05-07 06:00' + (i * interval '24 minute'))::time as etd,
    'pending'::text as status,
    ((i % 7) + 1) as pickup_id,
    (((i + 3) % 7) + 1) as dropoff_id,
    ((i % 10) + 1) as guest_id
  from generate_series(0, 39) as s(i)
)
insert into public.jobs (
  ride_date,
  etd,
  status,
  pickup_name,
  pickup_address,
  dropoff_name,
  dropoff_address
)
select
  r.ride_date,
  r.etd,
  r.status,
  p.location_name || ' • Gast: ' || g.guest_name as pickup_name,
  p.location_address as pickup_address,
  d.location_name as dropoff_name,
  d.location_address as dropoff_address
from rides r
join addresses p on p.id = r.pickup_id
join addresses d on d.id = r.dropoff_id
join guests g on g.id = r.guest_id
order by r.etd;
