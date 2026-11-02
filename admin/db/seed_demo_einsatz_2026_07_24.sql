-- =============================================================
-- Demo-Einsatz "Mobility Innovation Summit 2026" (BMW Welt)
-- Freitag 2026-07-24 + Samstag 2026-07-25
-- Alle Einsatz-Fahrten stehen auf 'assigned' (bzw. 'pending' ohne Fahrer).
-- Kurz vor der Demo (Fr ~13:45) zusaetzlich ausfuehren:
--   demo_go_live_2026_07_24.sql  (setzt Vormittag = done, 13:30/14:00 = in_progress)
-- 12 Fahrer (inkl. Stefano Spandri), Dienstplan-Anfragen,
-- ~60 Fahrten (Flughafen, Hotels, Gala-Dinner), 1 Konvoi,
-- 36 Gaeste, etwas Historie vom 18.07.
--
-- Ausfuehrung: Supabase SQL Editor oder psql (Port 54322).
-- Idempotent: kann mehrfach ausgefuehrt werden.
-- Backup der vorherigen Daten:
--   fahrer-app-lokal/db/backups/backup_before_demo_seed_20260723.sql
-- =============================================================

begin;

create extension if not exists "uuid-ossp";

-- ------------------------------------------------------------
-- 0) Alte Testdaten entfernen (alles vor dem 18.07.2026)
-- ------------------------------------------------------------
delete from public.convoy_assignments a using public.jobs j
  where a.job_id = j.id and j.ride_date < date '2026-07-18';
delete from public.job_guests g using public.jobs j
  where g.job_id = j.id and j.ride_date < date '2026-07-18';
delete from public.job_notes n using public.jobs j
  where n.job_id = j.id and j.ride_date < date '2026-07-18';
delete from public.jobs where ride_date < date '2026-07-18';
delete from public.convoys c
  where not exists (select 1 from public.jobs j where j.convoy_id = c.id);
delete from public.driver_service_requests where service_date < date '2026-07-18';
-- Reste frueherer Seed-Laeufe mit verschobenen Daten entfernen
delete from public.driver_service_requests where service_date = date '2026-07-26';

-- ------------------------------------------------------------
-- 1) Fahrer-Auswahl: Stefano Spandri (rn 0) + 11 Demo-Fahrer
-- ------------------------------------------------------------
create temporary table _ef (
  rn int primary key,
  driver_id uuid not null,
  vehicle_id uuid,
  fri_start time not null,
  fri_end time not null,
  sat_start time not null,
  sat_end time not null
) on commit drop;

insert into _ef (rn, driver_id, vehicle_id, fri_start, fri_end, sat_start, sat_end)
select 0, p.id, p.vehicle_id, time '13:30', time '22:30', time '09:00', time '18:00'
from public.profiles p
where p.first_name = 'Stefano' and p.last_name = 'Spandri';

-- Jeder Vorname nur einmal, Nachnamen gemischt (Hash-basiert, deterministisch)
with pool as (
  select distinct on (p.first_name) p.id, p.vehicle_id
  from public.profiles p
  where p.role = 'fahrer'
    and p.vehicle_id is not null
    and p.last_name <> 'Spandri'
  order by p.first_name, abs(hashtext(p.id::text))
), picked as (
  select id, vehicle_id, row_number() over (order by abs(hashtext(id::text))) as rn
  from pool
)
insert into _ef (rn, driver_id, vehicle_id, fri_start, fri_end, sat_start, sat_end)
select
  rn, id, vehicle_id,
  case when rn <= 5 then time '08:00' else time '13:30' end,
  case when rn <= 5 then time '17:00' else time '22:30' end,
  time '09:00',
  time '18:00'
from picked
where rn <= 11;

-- ------------------------------------------------------------
-- 2) Orte
-- ------------------------------------------------------------
create temporary table _loc (
  key text primary key,
  name text not null,
  address text not null
) on commit drop;

insert into _loc (key, name, address) values
  ('muc_t1',  'MUC Terminal 1',                    'Flughafen München Terminal 1, Nordallee 25, 85356 München-Flughafen'),
  ('muc_t2',  'MUC Terminal 2',                    'Flughafen München Terminal 2, Terminalstraße Mitte 18, 85356 München-Flughafen'),
  ('hbf',     'München Hbf',                       'Hauptbahnhof, Bayerstraße 10a, 80335 München'),
  ('bay_hof', 'Hotel Bayerischer Hof',             'Promenadeplatz 2-6, 80333 München'),
  ('charles', 'The Charles Hotel',                 'Sophienstraße 28, 80333 München'),
  ('andaz',   'Andaz Munich Schwabinger Tor',      'Leopoldstraße 170, 80804 München'),
  ('vier_jz', 'Hotel Vier Jahreszeiten Kempinski', 'Maximilianstraße 17, 80539 München'),
  ('bmw_welt','BMW Welt',                          'Am Olympiapark 1, 80809 München'),
  ('loewen',  'Löwenbräukeller',                   'Nymphenburger Straße 2, 80335 München'),
  ('kaefer',  'Käfer-Schänke',                     'Prinzregentenstraße 73, 81675 München');

-- ------------------------------------------------------------
-- 3) Gaeste (36, deterministische IDs)
-- ------------------------------------------------------------
create temporary table _guest (
  gn int primary key,
  guest_id uuid not null,
  first_name text not null,
  last_name text not null,
  company text,
  email text not null,
  language text not null,
  is_vip boolean not null
) on commit drop;

insert into _guest (gn, guest_id, first_name, last_name, company, email, language, is_vip)
select
  v.gn,
  uuid_generate_v5('6ba7b812-9dad-11d1-80b4-00c04fd430c8'::uuid, 'trisar-einsatz-guest-' || v.email),
  v.first_name, v.last_name, v.company, v.email, v.language, v.is_vip
from (values
  ( 1, 'Katharina', 'Vogel',       'Innoterra AG',                   'k.vogel@innoterra-ag.de',           'Deutsch',  true),
  ( 2, 'Jonas',     'Weißhaupt',   'Quantik Systems GmbH',           'j.weisshaupt@quantik-systems.de',   'Deutsch',  false),
  ( 3, 'Miriam',    'Steinbach',   'Quantik Systems GmbH',           'm.steinbach@quantik-systems.de',    'Deutsch',  false),
  ( 4, 'Martin',    'Aldenhoven',  'Institut für Mobilitätsforschung','aldenhoven@ifm-institut.de',       'Deutsch',  true),
  ( 5, 'Sarah',     'Lindner',     'NeoDrive Mobility GmbH',         's.lindner@neodrive-mobility.de',    'Deutsch',  false),
  ( 6, 'Tobias',    'Reinhardt',   'NeoDrive Mobility GmbH',         't.reinhardt@neodrive-mobility.de',  'Deutsch',  false),
  ( 7, 'Claire',    'Dubois',      'Altermotive SAS',                'c.dubois@altermotive.fr',           'Englisch', false),
  ( 8, 'James',     'Whitfield',   'Kestrel Ventures Ltd.',          'j.whitfield@kestrel-ventures.com',  'Englisch', true),
  ( 9, 'Elena',     'Rossi',       'Movia Italia S.p.A.',            'e.rossi@movia-italia.it',           'Englisch', false),
  (10, 'Henrik',    'Johansson',   'Nordcell AB',                    'h.johansson@nordcell.se',           'Englisch', false),
  (11, 'Anna-Lena', 'Brandt',      'Meridian Capital Partners',      'al.brandt@meridian-capital.de',     'Deutsch',  false),
  (12, 'Felix',     'Obermaier',   'Meridian Capital Partners',      'f.obermaier@meridian-capital.de',   'Deutsch',  false),
  (13, 'Stephan',   'Krieger',     'Krieger & Partner',              's.krieger@krieger-partner.de',      'Deutsch',  true),
  (14, 'Nadia',     'El-Sayed',    'Fahrwerk Labs GmbH',             'n.elsayed@fahrwerk-labs.de',        'Deutsch',  false),
  (15, 'Lukas',     'Steinmetz',   'Fahrwerk Labs GmbH',             'l.steinmetz@fahrwerk-labs.de',      'Deutsch',  false),
  (16, 'Isabelle',  'Moreau',      'Altermotive SAS',                'i.moreau@altermotive.fr',           'Englisch', false),
  (17, 'Marta',     'Kowalska',    'Velotex Sp. z o.o.',             'm.kowalska@velotex.pl',             'Englisch', false),
  (18, 'Georg',     'Wieland',     'Wieland Logistik KG',            'g.wieland@wieland-logistik.de',     'Deutsch',  false),
  (19, 'Franziska', 'Ebner',       'Alpenwind Energie AG',           'f.ebner@alpenwind-energie.de',      'Deutsch',  false),
  (20, 'Daniel',    'Brugger',     'Alpenwind Energie AG',           'd.brugger@alpenwind-energie.de',    'Deutsch',  false),
  (21, 'Sophie',    'Hartmann',    'Freie Journalistin',             'sophie.hartmann@posteo.de',         'Deutsch',  false),
  (22, 'Mateo',     'Álvarez',     'Ibermotion S.L.',                'm.alvarez@ibermotion.es',           'Englisch', false),
  (23, 'Charlotte', 'Kessler',     'Verband Neue Mobilität e.V.',    'c.kessler@vnm-verband.de',          'Deutsch',  true),
  (24, 'Maximilian','Falk',        'Falk Automotive GmbH',           'm.falk@falk-automotive.de',         'Deutsch',  false),
  (25, 'Yuki',      'Tanaka',      'Sakura Mobility K.K.',           'y.tanaka@sakura-mobility.jp',       'Englisch', true),
  (26, 'Oliver',    'Bergström',   'Nordcell AB',                    'o.bergstroem@nordcell.se',          'Englisch', false),
  (27, 'Hannah',    'Roth',        'Rothwerk Design Studio',         'h.roth@rothwerk-design.de',         'Deutsch',  false),
  (28, 'Sebastian', 'Nowak',       'Velotex Sp. z o.o.',             's.nowak@velotex.pl',                'Englisch', false),
  (29, 'Ingrid',    'Sommerfeld',  'Institut für Mobilitätsforschung','sommerfeld@ifm-institut.de',       'Deutsch',  false),
  (30, 'Patrick',   'Maier',       'Maier & Söhne GmbH',             'p.maier@maier-soehne.de',           'Deutsch',  false),
  (31, 'Vera',      'Lehmann',     'Lehmann Consulting',             'v.lehmann@lehmann-consulting.de',   'Deutsch',  false),
  (32, 'Thomas',    'Egger',       'Egger Präzisionstechnik',        't.egger@egger-praezision.de',       'Deutsch',  false),
  (33, 'Aisha',     'Rahman',      'Crescent Mobility Ltd.',         'a.rahman@crescent-mobility.com',    'Englisch', false),
  (34, 'Nils',      'Petersen',    'Hanse Fleet GmbH',               'n.petersen@hanse-fleet.de',         'Deutsch',  false),
  (35, 'Julia',     'Schwarzmann', 'Schwarzmann PR',                 'j.schwarzmann@schwarzmann-pr.de',   'Deutsch',  false),
  (36, 'Andreas',   'Kofler',      'Tirol Transfer GmbH',            'a.kofler@tirol-transfer.at',        'Deutsch',  false)
) as v(gn, first_name, last_name, company, email, language, is_vip);

insert into public.guests (id, first_name, last_name, email, phone, company, language, is_vip, created_at, updated_at)
select
  g.guest_id, g.first_name, g.last_name, g.email,
  format('+49 160 %s', 4100000 + g.gn * 137),
  g.company, g.language, g.is_vip,
  timestamptz '2026-07-14 09:00:00+02', now()
from _guest g
on conflict (id) do update
set first_name = excluded.first_name,
    last_name  = excluded.last_name,
    email      = excluded.email,
    company    = excluded.company,
    language   = excluded.language,
    is_vip     = excluded.is_vip,
    updated_at = now();

-- ------------------------------------------------------------
-- 4) Fahrten-Spezifikation
--    day: 0 = 18.07. (Historie, done), 1 = Fr 25.07., 2 = Sa 26.07.
--    drv: 0 = Stefano, 1-11 = Demo-Fahrer, null = offen (pending)
-- ------------------------------------------------------------
create temporary table _spec (
  spec text primary key,
  drv int,
  day int not null,
  etd time not null,
  trip text not null,
  pick text not null,
  dropoff text not null,
  fno text,
  forig text,
  vip boolean not null,
  lug boolean not null,
  cseat boolean not null,
  gcount int not null,
  anon int not null
) on commit drop;

insert into _spec values
  -- Stefano Spandri: Freitag
  ('s1', 0, 1, '14:30', 'airport', 'muc_t2', 'bay_hof', 'LH 2085', 'Berlin (BER)',     true,  true,  false, 1, 0),
  ('s2', 0, 1, '16:45', 'airport', 'muc_t1', 'charles', 'EW 812',  'Düsseldorf (DUS)', false, true,  false, 2, 0),
  ('s3', 0, 1, '18:30', 'normal',  'bay_hof', 'loewen',  null, null, true,  false, false, 3, 0),
  ('s4', 0, 1, '21:15', 'normal',  'loewen',  'bay_hof', null, null, true,  false, false, 3, 0),
  -- Stefano Spandri: Samstag
  ('s5', 0, 2, '09:45', 'normal',  'bay_hof', 'bmw_welt', null, null, true,  false, false, 1, 0),
  ('s6', 0, 2, '13:15', 'normal',  'bmw_welt', 'charles', null, null, false, false, false, 2, 0),
  ('s7', 0, 2, '15:30', 'airport', 'charles', 'muc_t2', 'LH 2094', null, false, true,  false, 2, 0),
  ('s8', 0, 2, '17:10', 'airport', 'bay_hof', 'muc_t2', 'LH 2098', null, true,  true,  false, 1, 0),
  -- Fahrer 1
  ('a1', 1, 1, '09:15', 'airport', 'muc_t2', 'bay_hof', 'LH 2059', 'Hamburg (HAM)',   false, true,  false, 2, 0),
  ('a2', 1, 1, '11:00', 'airport', 'muc_t1', 'andaz',   'AF 1622', 'Paris (CDG)',     false, true,  false, 1, 0),
  ('a3', 1, 1, '13:30', 'normal',  'hbf',    'charles',  null, null, false, false, false, 2, 0),
  ('a4', 1, 1, '15:45', 'airport', 'muc_t2', 'vier_jz', 'OS 115',  'Wien (VIE)',      false, false, false, 2, 0),
  ('a5', 1, 2, '09:00', 'normal',  'bay_hof', 'bmw_welt', null, null, false, false, false, 2, 0),
  ('a6', 1, 2, '14:00', 'airport', 'andaz',   'muc_t2', 'LH 2090', null, false, true,  false, 2, 0),
  ('a7', 1, 2, '16:20', 'airport', 'charles', 'muc_t1', 'AF 1623', null, false, true,  false, 1, 0),
  -- Fahrer 2
  ('b1', 2, 1, '08:45', 'airport', 'muc_t2', 'charles', 'LH 106',  'Frankfurt (FRA)', false, true,  false, 1, 0),
  ('b2', 2, 1, '10:30', 'airport', 'muc_t1', 'bay_hof', 'BA 950',  'London (LHR)',    true,  true,  false, 2, 0),
  ('b3', 2, 1, '14:00', 'airport', 'muc_t2', 'andaz',   'LX 1102', 'Zürich (ZRH)',    false, false, false, 1, 0),
  ('k1', 2, 1, '15:15', 'airport', 'muc_t2', 'bay_hof', 'LH 2087', 'Berlin (BER)',    true,  true,  false, 3, 2),
  ('b4', 2, 1, '17:30', 'normal',  'hbf',    'bay_hof',  null, null, false, false, false, 2, 0),
  ('b5', 2, 2, '09:15', 'normal',  'charles', 'bmw_welt', null, null, false, false, false, 2, 0),
  ('b6', 2, 2, '13:45', 'airport', 'bay_hof', 'muc_t1', 'BA 951',  null, false, true,  false, 2, 0),
  ('b7', 2, 2, '16:45', 'airport', 'vier_jz', 'muc_t2', 'LH 2444', null, false, true,  false, 1, 0),
  -- Fahrer 3
  ('c1', 3, 1, '09:30', 'airport', 'muc_t1', 'vier_jz', 'KL 1793', 'Amsterdam (AMS)', false, true,  false, 2, 0),
  ('c2', 3, 1, '12:15', 'airport', 'muc_t2', 'bay_hof', 'LH 2081', 'Hamburg (HAM)',   false, false, false, 1, 0),
  ('c3', 3, 1, '15:00', 'normal',  'bmw_welt', 'charles', null, null, false, false, false, 1, 0),
  ('c4', 3, 1, '17:35', 'airport', 'muc_t2', 'charles', 'SN 2585', 'Brüssel (BRU)',   false, true,  false, 2, 0),
  ('c5', 3, 2, '09:30', 'normal',  'andaz',  'bmw_welt', null, null, false, false, false, 1, 0),
  ('c6', 3, 2, '14:30', 'airport', 'vier_jz', 'muc_t2', 'KL 1796', null, false, true,  false, 2, 0),
  ('c7', 3, 2, '17:00', 'airport', 'bay_hof', 'muc_t2', 'OS 118',  null, false, false, false, 1, 0),
  -- Fahrer 4
  ('d1', 4, 1, '10:00', 'airport', 'muc_t2', 'andaz',   'LO 379',  'Warschau (WAW)',  false, false, false, 1, 0),
  ('d2', 4, 1, '13:00', 'normal',  'hbf',    'vier_jz',  null, null, false, false, false, 2, 0),
  ('d3', 4, 1, '17:15', 'airport', 'muc_t1', 'bay_hof', 'IB 3190', 'Madrid (MAD)',    false, true,  false, 2, 0),
  ('d4', 4, 2, '10:00', 'normal',  'vier_jz', 'bmw_welt', null, null, false, false, false, 2, 0),
  ('d5', 4, 2, '15:15', 'airport', 'charles', 'muc_t2', 'LX 1113', null, false, true,  false, 2, 0),
  -- Fahrer 5
  ('e1', 5, 1, '08:30', 'normal',  'hbf',    'bmw_welt', null, null, false, false, false, 1, 0),
  ('e2', 5, 1, '11:30', 'airport', 'muc_t2', 'charles', 'AZ 434',  'Mailand (LIN)',   false, false, true,  2, 1),
  ('e3', 5, 1, '14:30', 'airport', 'muc_t1', 'andaz',   'SK 657',  'Kopenhagen (CPH)',false, true,  false, 1, 0),
  ('e4', 5, 2, '09:45', 'normal',  'bay_hof', 'bmw_welt', null, null, false, false, false, 1, 0),
  ('e5', 5, 2, '14:45', 'airport', 'andaz',   'muc_t1', 'IB 3193', null, false, true,  false, 2, 0),
  ('e6', 5, 2, '17:20', 'normal',  'bmw_welt', 'hbf',    null, null, false, false, false, 2, 0),
  -- Fahrer 6
  ('f1', 6, 1, '15:00', 'airport', 'muc_t2', 'vier_jz', 'LH 2229', 'Berlin (BER)',    false, true,  false, 2, 0),
  ('f2', 6, 1, '18:15', 'normal',  'vier_jz', 'loewen',  null, null, false, false, false, 3, 0),
  ('f3', 6, 1, '21:30', 'normal',  'loewen',  'vier_jz', null, null, false, false, false, 3, 0),
  ('f4', 6, 2, '10:15', 'normal',  'charles', 'bmw_welt', null, null, false, false, false, 2, 0),
  ('f5', 6, 2, '15:00', 'airport', 'bay_hof', 'muc_t2', 'SN 2588', null, false, true,  false, 1, 0),
  -- Fahrer 7 (Samstag abgelehnt, nur Freitag)
  ('q1', 7, 1, '14:45', 'airport', 'muc_t1', 'charles', 'VY 1810', 'Barcelona (BCN)', false, true,  false, 2, 0),
  ('q2', 7, 1, '18:20', 'normal',  'charles', 'loewen',  null, null, false, false, false, 3, 0),
  ('q3', 7, 1, '21:20', 'normal',  'loewen',  'charles', null, null, false, false, false, 3, 0),
  -- Fahrer 8
  ('r1', 8, 1, '16:15', 'airport', 'muc_t2', 'bay_hof', 'A3 802',  'Athen (ATH)',     false, false, false, 1, 0),
  ('r2', 8, 1, '18:35', 'normal',  'andaz',  'loewen',   null, null, false, false, false, 2, 0),
  ('r3', 8, 1, '21:40', 'normal',  'loewen', 'andaz',    null, null, false, false, false, 2, 0),
  ('r4', 8, 2, '09:20', 'normal',  'vier_jz', 'bmw_welt', null, null, false, false, false, 1, 0),
  ('r5', 8, 2, '14:15', 'airport', 'bay_hof', 'muc_t2', 'LO 380',  null, false, true,  false, 2, 0),
  ('r6', 8, 2, '16:50', 'airport', 'andaz',   'muc_t2', 'A3 803',  null, false, false, false, 1, 0),
  -- Fahrer 9
  ('t1', 9, 1, '15:30', 'normal',  'hbf',     'bay_hof', null, null, false, false, false, 2, 0),
  ('t2', 9, 1, '18:00', 'normal',  'bmw_welt', 'loewen', null, null, false, false, false, 2, 0),
  ('t3', 9, 1, '21:00', 'normal',  'loewen',  'bay_hof', null, null, false, false, false, 3, 0),
  ('t4', 9, 2, '13:30', 'normal',  'bmw_welt', 'bay_hof', null, null, false, false, false, 2, 0),
  ('t5', 9, 2, '16:00', 'normal',  'charles', 'hbf',     null, null, false, false, false, 2, 0),
  -- Fahrer 10
  ('u1', 10, 1, '17:00', 'airport', 'muc_t2', 'charles', 'TP 554', 'Lissabon (LIS)',  false, true,  false, 2, 0),
  ('u2', 10, 1, '18:40', 'normal',  'bay_hof', 'loewen',  null, null, false, false, false, 3, 0),
  ('u3', 10, 1, '21:45', 'normal',  'loewen',  'bay_hof', null, null, false, false, false, 2, 0),
  ('u4', 10, 2, '09:10', 'normal',  'andaz',   'bmw_welt', null, null, false, false, false, 2, 0),
  ('u5', 10, 2, '13:20', 'airport', 'vier_jz', 'muc_t1', 'TP 555', null, false, true,  false, 2, 0),
  ('u6', 10, 2, '16:30', 'normal',  'bmw_welt', 'bay_hof', null, null, false, false, false, 3, 0),
  -- Fahrer 11
  ('v1', 11, 1, '16:40', 'airport', 'muc_t1', 'andaz',  'U2 8189', 'London (LGW)',    false, false, false, 2, 0),
  ('v2', 11, 1, '18:50', 'normal',  'vier_jz', 'loewen',  null, null, false, false, false, 2, 0),
  ('v3', 11, 1, '21:35', 'normal',  'loewen',  'vier_jz', null, null, false, false, false, 2, 0),
  ('v4', 11, 2, '09:50', 'normal',  'bay_hof', 'bmw_welt', null, null, false, false, false, 2, 0),
  ('v5', 11, 2, '14:50', 'airport', 'charles', 'muc_t2', 'U2 8190', null, false, true,  false, 2, 0),
  -- Offene Fahrten (noch keinem Fahrer zugewiesen)
  ('x1', null, 1, '17:40', 'airport', 'muc_t2', 'bay_hof', 'LH 2083', 'Hamburg (HAM)', false, true,  false, 1, 0),
  ('x2', null, 1, '19:00', 'normal',  'hbf',    'andaz',    null, null, false, false, false, 1, 1),
  ('x3', null, 1, '20:15', 'normal',  'bmw_welt', 'bay_hof', null, null, false, false, false, 2, 0),
  ('x4', null, 2, '11:00', 'airport', 'muc_t2', 'bmw_welt', 'LH 104', 'Frankfurt (FRA)', false, false, false, 2, 0),
  ('x5', null, 2, '15:45', 'airport', 'bay_hof', 'muc_t2', 'EW 813',  null, false, true,  false, 1, 0),
  ('x6', null, 2, '17:45', 'airport', 'vier_jz', 'muc_t1', 'LH 2446', null, false, true,  false, 1, 0),
  -- Historie 18.07. (abgeschlossen)
  ('h1', 0, 0, '14:00', 'airport', 'muc_t2', 'bay_hof', 'LH 2083', 'Hamburg (HAM)',   false, true,  false, 2, 0),
  ('h2', 0, 0, '17:30', 'normal',  'bay_hof', 'kaefer',  null, null, false, false, false, 2, 0),
  ('h3', 0, 0, '21:00', 'normal',  'kaefer',  'bay_hof', null, null, false, false, false, 2, 0),
  ('h4', 1, 0, '15:00', 'airport', 'muc_t1', 'andaz',   'AF 1620', 'Paris (CDG)',     false, true,  false, 1, 0),
  ('h5', 3, 0, '16:15', 'normal',  'hbf',    'charles',  null, null, false, false, false, 2, 0),
  ('h6', 5, 0, '10:30', 'airport', 'bay_hof', 'muc_t2', 'LH 2084', null, false, true,  false, 2, 0);

-- ------------------------------------------------------------
-- 5) Jobs einfuegen
-- ------------------------------------------------------------
create temporary table _job (
  spec text primary key,
  job_id uuid not null,
  driver_id uuid,
  day int not null,
  etd time not null,
  gcount int not null
) on commit drop;

insert into _job (spec, job_id, driver_id, day, etd, gcount)
select
  s.spec,
  uuid_generate_v5('6ba7b812-9dad-11d1-80b4-00c04fd430c8'::uuid, 'trisar-einsatz-0725-' || s.spec),
  f.driver_id,
  s.day, s.etd, s.gcount
from _spec s
left join _ef f on f.rn = s.drv;

insert into public.jobs (
  id, driver_id, vehicle_id, trip_type,
  pickup_name, pickup_address, dropoff_name, dropoff_address,
  ride_date, etd, flight_number, flight_origin,
  status, is_vip, needs_child_seat, needs_accessibility, needs_luggage,
  anonymous_guests, waiting_time_mins,
  created_at, updated_at
)
select
  j.job_id,
  j.driver_id,
  f.vehicle_id,
  s.trip,
  lp.name, lp.address,
  ld.name, ld.address,
  (case s.day when 0 then date '2026-07-18' when 1 then date '2026-07-24' else date '2026-07-25' end),
  s.etd,
  s.fno, s.forig,
  (case
     when s.day = 0 then 'done'
     when s.drv is null then 'pending'
     else 'assigned'
   end),
  s.vip, s.cseat, false, s.lug,
  s.anon, 0,
  timestamptz '2026-07-19 09:00:00+02' + make_interval(mins => abs(hashtext(s.spec)) % 4320),
  now()
from _spec s
join _job j on j.spec = s.spec
left join _ef f on f.rn = s.drv
join _loc lp on lp.key = s.pick
join _loc ld on ld.key = s.dropoff
on conflict (id) do update
set driver_id = excluded.driver_id,
    vehicle_id = excluded.vehicle_id,
    trip_type = excluded.trip_type,
    pickup_name = excluded.pickup_name,
    pickup_address = excluded.pickup_address,
    dropoff_name = excluded.dropoff_name,
    dropoff_address = excluded.dropoff_address,
    ride_date = excluded.ride_date,
    etd = excluded.etd,
    flight_number = excluded.flight_number,
    flight_origin = excluded.flight_origin,
    status = excluded.status,
    is_vip = excluded.is_vip,
    needs_child_seat = excluded.needs_child_seat,
    needs_luggage = excluded.needs_luggage,
    anonymous_guests = excluded.anonymous_guests,
    updated_at = now();

-- ------------------------------------------------------------
-- 6) Konvoi "Delegation Berlin" (Job k1, 3 Fahrzeuge)
-- ------------------------------------------------------------
insert into public.convoys (id, name, created_at)
values (
  uuid_generate_v5('6ba7b812-9dad-11d1-80b4-00c04fd430c8'::uuid, 'trisar-einsatz-0725-konvoi-1'),
  'Konvoi Delegation Berlin',
  timestamptz '2026-07-21 11:00:00+02'
)
on conflict (id) do update set name = excluded.name;

update public.jobs j
set convoy_id = uuid_generate_v5('6ba7b812-9dad-11d1-80b4-00c04fd430c8'::uuid, 'trisar-einsatz-0725-konvoi-1'),
    updated_at = now()
from _job x
where x.spec = 'k1' and j.id = x.job_id;

delete from public.convoy_assignments a
using _job x
where x.spec = 'k1' and a.job_id = x.job_id;

insert into public.convoy_assignments (job_id, driver_id, guest_names, response_status, responded_at, created_at)
select x.job_id, f.driver_id,
       case f.rn
         when 2 then array['James Whitfield']
         when 4 then array['Yuki Tanaka']
         else array['Stephan Krieger']
       end,
       case f.rn when 2 then 'accepted' when 4 then 'accepted' else 'pending' end,
       case when f.rn in (2, 4) then timestamptz '2026-07-22 10:15:00+02' else null end,
       timestamptz '2026-07-21 11:05:00+02'
from _job x
join _ef f on f.rn in (2, 4, 10)
where x.spec = 'k1';

-- ------------------------------------------------------------
-- 7) Gaeste den Fahrten zuordnen
--    Stefanos Fahrten + Konvoi: kuratiert. Rest: rotierend (Gaeste 4-36).
-- ------------------------------------------------------------
create temporary table _links (
  job_id uuid not null,
  guest_id uuid not null,
  pos int not null,
  primary key (job_id, guest_id)
) on commit drop;

-- Kuratierte Zuordnung
insert into _links (job_id, guest_id, pos)
select j.job_id, g.guest_id, m.pos
from (values
  ('s1', 1, 1), ('s2', 2, 1), ('s2', 3, 2),
  ('s3', 1, 1), ('s3', 2, 2), ('s3', 3, 3),
  ('s4', 1, 1), ('s4', 2, 2), ('s4', 3, 3),
  ('s5', 1, 1), ('s6', 2, 1), ('s6', 3, 2),
  ('s7', 2, 1), ('s7', 3, 2), ('s8', 1, 1),
  ('h1', 11, 1), ('h1', 12, 2),
  ('h2', 11, 1), ('h2', 12, 2),
  ('h3', 11, 1), ('h3', 12, 2),
  ('k1', 8, 1), ('k1', 25, 2), ('k1', 13, 3)
) as m(spec, gn, pos)
join _job j on j.spec = m.spec
join _guest g on g.gn = m.gn;

-- Rotierende Zuordnung fuer alle uebrigen Fahrten (Gaeste 4-36)
with remaining as (
  select j.job_id, j.gcount,
         row_number() over (order by j.day, j.etd, j.spec) - 1 as seq
  from _job j
  where j.spec not in ('s1','s2','s3','s4','s5','s6','s7','s8','h1','h2','h3','k1')
)
insert into _links (job_id, guest_id, pos)
select r.job_id, g.guest_id, p.pos
from remaining r
cross join lateral generate_series(1, r.gcount) as p(pos)
join _guest g on g.gn = 4 + ((r.seq * 3 + (p.pos - 1)) % 33)
on conflict do nothing;

delete from public.job_guests jg using _job j where jg.job_id = j.job_id;

insert into public.job_guests (job_id, guest_id, is_main_contact)
select job_id, guest_id, (pos = 1) from _links;

update public.jobs j
set passengers = p.names
from (
  select l.job_id,
         array_agg(g.first_name || ' ' || g.last_name order by l.pos) as names
  from _links l
  join _guest g on g.guest_id = l.guest_id
  group by l.job_id
) p
where j.id = p.job_id;

-- ------------------------------------------------------------
-- 8) Notizen zu einzelnen Fahrten
-- ------------------------------------------------------------
delete from public.job_notes n using _job j where n.job_id = j.job_id;

insert into public.job_notes (job_id, note_text, created_at)
select j.job_id, m.note, timestamptz '2026-07-22 14:30:00+02'
from (values
  ('s1', 'VIP-Gast: Empfang an der Gepäckausgabe, Schild „Dr. Vogel / Summit 2026“'),
  ('s2', 'Gäste melden sich nach der Landung telefonisch'),
  ('s7', '3 Gepäckstücke – wegen Messeverkehr 15 Min. früher losfahren'),
  ('k1', 'Delegation reist gemeinsam, 3 Fahrzeuge. Ansprechpartner: Hr. Whitfield')
) as m(spec, note)
join _job j on j.spec = m.spec;

-- ------------------------------------------------------------
-- 9) Dienstplan-Anfragen (Fr + Sa je Fahrer) + Historie
-- ------------------------------------------------------------
create temporary table _dsr (
  rn int not null,
  service_date date not null,
  s_start time not null,
  s_end time not null,
  status text not null,
  refusal text,
  primary key (rn, service_date)
) on commit drop;

insert into _dsr (rn, service_date, s_start, s_end, status, refusal)
select f.rn, date '2026-07-24', f.fri_start, f.fri_end,
       'accepted', null
from _ef f;

insert into _dsr (rn, service_date, s_start, s_end, status, refusal)
select f.rn, date '2026-07-25', f.sat_start, f.sat_end,
       case f.rn
         when 0 then 'pending'
         when 2 then 'pending'
         when 7 then 'refused'
         else 'accepted'
       end,
       case f.rn when 7 then 'Privater Termin – bitte für Samstag nicht einplanen' end
from _ef f;

-- Historie: Dienste am 18.07. fuer Stefano und Fahrer 1
insert into _dsr (rn, service_date, s_start, s_end, status, refusal) values
  (0, date '2026-07-18', time '13:00', time '22:00', 'accepted', null),
  (1, date '2026-07-18', time '08:00', time '17:00', 'accepted', null);

insert into public.driver_service_requests (
  id, driver_id, service_date, service_start_time, service_end_time,
  status, requested_by, refusal_reason, note, responded_at, created_at, updated_at
)
select
  uuid_generate_v5('6ba7b812-9dad-11d1-80b4-00c04fd430c8'::uuid,
                   format('trisar-einsatz-dsr-%s-%s', d.rn, d.service_date)),
  f.driver_id,
  d.service_date, d.s_start, d.s_end,
  d.status,
  'Disposition',
  d.refusal,
  case when d.service_date >= date '2026-07-24'
       then 'Einsatz „Mobility Innovation Summit 2026“ – BMW Welt' end,
  case when d.status in ('accepted', 'refused')
       then timestamptz '2026-07-21 12:00:00+02' + make_interval(mins => (d.rn * 37) % 600)
       end,
  timestamptz '2026-07-21 09:30:00+02',
  now()
from _dsr d
join _ef f on f.rn = d.rn
on conflict (id) do update
set driver_id = excluded.driver_id,
    service_start_time = excluded.service_start_time,
    service_end_time = excluded.service_end_time,
    status = excluded.status,
    refusal_reason = excluded.refusal_reason,
    note = excluded.note,
    responded_at = excluded.responded_at,
    updated_at = now();

-- ------------------------------------------------------------
-- 10) Dienstfenster im Profil (naechster Einsatztag = Freitag)
-- ------------------------------------------------------------
update public.profiles p
set service_start_time = f.fri_start,
    service_end_time = f.fri_end,
    updated_at = now()
from _ef f
where p.id = f.driver_id;

-- ------------------------------------------------------------
-- Ergebnis-Check
-- ------------------------------------------------------------
select
  (select count(*) from _ef) as fahrer,
  (select count(*) from _job) as fahrten_gesamt,
  (select count(*) from _job where day = 1) as fahrten_freitag,
  (select count(*) from _job where day = 2) as fahrten_samstag,
  (select count(*) from _job j join _spec s on s.spec = j.spec where s.drv is null) as offene_fahrten,
  (select count(*) from _links) as gast_zuordnungen,
  (select count(*) from _dsr) as dienstplan_anfragen;

commit;
