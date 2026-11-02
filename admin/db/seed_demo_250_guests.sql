-- Demo-Seed: 250 randomisierte Gaeste
-- Fuegt 250 individuelle Fake-Gaeste in public.guests ein.
-- Enthalten: Name, E-Mail, Telefon, Adresse, Sprache, Merkmale, Notizen.
--
-- Ausfuehrung: Supabase SQL Editor

begin;

create extension if not exists pgcrypto;

insert into public.guests (
  first_name,
  last_name,
  email,
  phone,
  company,
  street,
  street_number,
  city,
  zip,
  language,
  notes,
  note_text,
  is_vip,
  vip_status,
  needs_accessibility,
  needs_child_seat,
  needs_second_child_seat,
  needs_luggage,
  rides_count,
  trip_count,
  ride_count
)
select
  seeded.first_name,
  seeded.last_name,
  seeded.email,
  seeded.phone,
  seeded.company,
  seeded.street,
  seeded.street_number,
  seeded.city,
  seeded.zip,
  seeded.language,
  seeded.note_text,
  seeded.note_text,
  seeded.is_vip,
  seeded.is_vip,
  seeded.needs_accessibility,
  seeded.needs_child_seat,
  seeded.needs_second_child_seat,
  seeded.needs_luggage,
  seeded.rides_count,
  seeded.trip_count,
  seeded.ride_count
from (
  select
    gs,
    (array[
      'Emma','Mia','Lina','Sofia','Hannah','Lea','Lara','Clara','Nora','Anna',
      'Marie','Paula','Lena','Julia','Sarah','Mila','Ella','Emilia','Johanna','Amelie',
      'Felix','Luca','Noah','Milan','Ben'
    ])[1 + ((gs - 1) % 25)] as first_name,
    (array[
      'Müller','Schmidt','Schneider','Fischer','Weber','Meyer','Wagner','Becker','Schulz','Hoffmann',
      'Schäfer','Koch','Bauer','Richter','Klein','Wolf','Schröder','Neumann','Schwarz','Zimmermann',
      'Braun','Krüger','Hofmann','Hartmann','Lange','Schmitt','Werner','Schmitz','Krause','Meier',
      'Lehmann','Schmid','Schulze','Maier','Köhler','Herrmann','König','Walter','Mayer','Huber',
      'Kaiser','Fuchs','Peters','Lang','Scholz','Möller','Weiß','Jung','Hahn','Keller',
      'Vogel','Schubert','Roth','Frank','Friedrich','Beck','Günther','Berger','Winkler','Lorenz',
      'Baumann','Schuster','Kraus','Böhm','Simon','Franke','Albrecht','Winter','Ludwig','Martin',
      'Krämer','Schumacher','Vogt','Stein','Jäger','Otto','Sommer','Groß','Seidel','Heinrich',
      'Brandt','Haas','Schreiber','Graf','Schulte','Dietrich','Ziegler','Kuhn','Pohl','Engel',
      'Horn','Busch','Bergmann','Thomas','Sauer','Arnold','Wolff','Pfeiffer','Voigt','Günter',
      'Binder','Kühn','Riedel','Schenk','Schilling','Krebs','Wirth','Merten','Ulrich','Börner',
      'Sattler','Haase','Pabst','Zeller','Rieger','Gärtner','Berg','Schramm','Link','Kiefer',
      'Wenzel','Menzel','Geiger','Kunz','Ebert','Barth','Kraft','Kopp','Renner','Moser',
      'Kolb','Bach','Stark','Adam','Blank','Bender','Brunner','Reinhardt','Heinemann','Lindner',
      'Reuter','Sander','Kochan','Dreyer','Klaus','Jakob','Merkel','Wegner','Kahl','Kirchner',
      'Heller','Franz','Schade','Rupp','Urban','Mahn','Freitag','Korb','Reichelt','Auer',
      'Moll','Rudolph','Knoll','Eisele','Fromm','Klinger','Rausch','Ahrens','Kossmann','Opitz',
      'Preuß','Schober','Thiel','Kämmerer','Rösler','Hildebrandt','Munk','Döring','Pohlmann','Eilers',
      'Niemann','Steiger','Büttner','Maaß','Maring','Löffler','Witte','Senger','Wagnerer','Korn',
      'Süß','Karg','Veit','Bachmann','Rabe','Tiede','Heuer','Bartsch','Kretschmer','Tesch',
      'Böttcher','Volk','Kanzler','Kühne','Mader','Keil','Noll','Petzold','Wacker','Riemer',
      'Böcker','Jost','Hein','Eichhorn','Thoma','Wulf','Specht','Kahlert','Brehm','Niemeyer',
      'Ruppert','Hinz','Habermann','Witt','Burkhardt','Ramm','Krohn','Bähr','Ahrendt','Lauer',
      'Petersen','Mahnke','Ritter','Haack','Sailer','Schäffer','Kipp','Fröhlich','Bickel','Beyer',
      'Seifert','Kunze','Eckert','Harder','Rohde','Hepp','Wächter','Hager','Endres','Kunzmann','Lemm'
    ])[gs] as last_name,
    (array[
      'Acme Events GmbH','Hotel Bavaria','Messe Service AG','Airport Services Munich',
      'Event Logistics GmbH','Premium Travel GmbH','City Transfer GmbH','Executive Mobility AG',
      'Studio Nord GmbH','Summit Operations GmbH'
    ])[1 + ((gs - 1) % 10)] as company,
    (array[
      'Rosenstraße','Bahnhofstraße','Lindenweg','Gartenstraße','Hauptstraße',
      'Parkallee','Schillerstraße','Goethestraße','Sonnenweg','Bergstraße',
      'Isarweg','Maximilianstraße'
    ])[1 + ((gs - 1) % 12)] as street,
    (((gs * 7) % 140) + 1)::text as street_number,
    (array[
      'München','Augsburg','Nürnberg','Regensburg','Ingolstadt',
      'Rosenheim','Freising','Landshut','Passau','Kempten',
      'Erding','Dachau'
    ])[1 + (((gs * 3) - 1) % 12)] as city,
    lpad((80000 + ((gs * 29) % 1999))::text, 5, '0') as zip,
    (array['Deutsch','Deutsch','Deutsch','Englisch','Italienisch','Französisch'])[1 + ((gs - 1) % 6)] as language,
    format('+49 15%s %07s', ((gs - 1) % 9) + 1, 2000000 + gs) as phone,
    case when (gs % 11 = 0) then true else false end as is_vip,
    case when (gs % 17 = 0) then true else false end as needs_accessibility,
    case when (gs % 9 = 0) then true else false end as needs_child_seat,
    case when (gs % 27 = 0) then true else false end as needs_second_child_seat,
    case when (gs % 5 = 0) then true else false end as needs_luggage,
    ((gs * 7) % 36) as rides_count,
    ((gs * 5) % 24) as trip_count,
    ((gs * 7) % 36) as ride_count,
    (array[
      'Bitte 5 Minuten vor Abfahrt anrufen.',
      'Gast bevorzugt ruhige Fahrt ohne Musik.',
      'Kunde kommt mit viel Gepaeck.',
      'Treffpunkt an der Rezeption.',
      'Abholung am Seiteneingang.',
      'Bitte Kindersitz pruefen.',
      'Gast spricht nur Englisch.',
      'Kontaktperson vor Ort informieren.',
      'Kunde ist VIP, diskrete Abwicklung.',
      'Verspaetungen bitte direkt melden.'
    ])[1 + ((gs - 1) % 10)] as note_template
  from generate_series(1, 250) as gs
) base
cross join lateral (
  select
    base.first_name,
    base.last_name,
    format(
      '%s.%s.%s@gast-demo.local',
      lower(regexp_replace(translate(base.first_name, 'äöüÄÖÜß', 'aouAOUs'), '[^a-zA-Z0-9]+', '', 'g')),
      lower(regexp_replace(translate(base.last_name, 'äöüÄÖÜß', 'aouAOUs'), '[^a-zA-Z0-9]+', '', 'g')),
      lpad(base.gs::text, 3, '0')
    ) as email,
    base.phone,
    base.company,
    base.street,
    base.street_number,
    base.city,
    base.zip,
    base.language,
    base.is_vip,
    base.needs_accessibility,
    base.needs_child_seat,
    base.needs_second_child_seat,
    base.needs_luggage,
    base.rides_count,
    base.trip_count,
    base.ride_count,
    format('%s [Demo-Gast #%s]', base.note_template, lpad(base.gs::text, 3, '0')) as note_text
) seeded;

commit;

-- Optionaler Check:
-- select count(*) from public.guests where lower(coalesce(email,'')) like '%@gast-demo.local';
